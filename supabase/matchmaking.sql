-- ===========================================================================
-- AL BUILDER - Matchmaking schema
-- Run this whole file once in the Supabase SQL editor (Dashboard > SQL > New query).
-- Safe to re-run: tables use IF NOT EXISTS, policies/functions are dropped and recreated.
--
-- Tables:
--   mm_queue    - players currently searching (one row per user; popped on match)
--   mm_matches  - created matches; also serves as match history
--   mm_ratings  - one global ranked rating (RR) per player
-- RPCs (SECURITY DEFINER - the only way clients write matches/ratings):
--   mm_create_match(other)         - atomically pops both queue rows + inserts a match
--   mm_apply_result(match, winner) - records the result + applies ELO to RR (ranked only)
--   mm_abandon_match(match)        - awards the win to the other player when one leaves
-- ===========================================================================

-- Tables --------------------------------------------------------------------
create table if not exists mm_queue (
  user_id    uuid primary key references auth.users on delete cascade,
  username   text not null,
  avatar_url text,
  mode       text not null check (mode in ('unrated','ranked')),
  qte        text not null,
  rating     int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists mm_matches (
  id          uuid primary key default gen_random_uuid(),
  mode        text not null,
  qte         text not null,
  p1_id uuid not null, p1_name text, p1_avatar text,
  p2_id uuid not null, p2_name text, p2_avatar text,
  winner_id   uuid,
  p1_rr_delta int, p2_rr_delta int,
  status      text not null default 'active' check (status in ('active','done','abandoned')),
  created_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index if not exists mm_matches_players_idx on mm_matches (p1_id, p2_id);

create table if not exists mm_ratings (
  user_id    uuid primary key references auth.users on delete cascade,
  rr         int  not null default 0,
  wins       int  not null default 0,
  losses     int  not null default 0,
  updated_at timestamptz not null default now()
);

-- Number of ranked games played so far. The first 3 are placement/calibration
-- games: rank is hidden and RR moves quickly (see mm_apply_result).
alter table mm_ratings add column if not exists placement_games int not null default 0;

-- Row-Level Security --------------------------------------------------------
alter table mm_queue   enable row level security;
alter table mm_matches enable row level security;
alter table mm_ratings enable row level security;

-- Queue: world-readable (for discovery), but a player may only write their own row.
drop policy if exists mm_queue_read on mm_queue;
create policy mm_queue_read on mm_queue for select using (true);
drop policy if exists mm_queue_self on mm_queue;
create policy mm_queue_self on mm_queue for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Matches and ratings: world-readable; all writes go through the RPCs below.
drop policy if exists mm_match_read on mm_matches;
create policy mm_match_read on mm_matches for select using (true);
drop policy if exists mm_ratings_read on mm_ratings;
create policy mm_ratings_read on mm_ratings for select using (true);

-- Table privileges. Tables created from raw SQL do not always inherit Supabase's
-- default grants, so grant them explicitly (RLS policies above still apply on top).
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on mm_queue to authenticated;
grant select on mm_queue   to anon;
grant select on mm_matches to anon, authenticated;
grant select on mm_ratings to anon, authenticated;

-- RPC: atomic pairing -------------------------------------------------------
-- The smaller-uid player (the host) calls this with the opponent id.
-- Locks both queue rows, validates same mode+qte, deletes them, inserts the match.
-- Returns the new match id, or NULL if either player already left/was matched.
create or replace function mm_create_match(other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me        uuid := auth.uid();
  my_row    mm_queue;
  other_row mm_queue;
  new_id    uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if other is null or other = me then return null; end if;

  -- Lock both queue rows in a deterministic (user_id) order to avoid deadlocks.
  perform 1 from mm_queue where user_id in (me, other) order by user_id for update;

  select * into my_row    from mm_queue where user_id = me;
  select * into other_row from mm_queue where user_id = other;

  if my_row.user_id is null or other_row.user_id is null then
    return null;
  end if;
  if my_row.mode <> other_row.mode or my_row.qte <> other_row.qte then
    return null;
  end if;

  delete from mm_queue where user_id in (me, other);

  insert into mm_matches (mode, qte, p1_id, p1_name, p1_avatar, p2_id, p2_name, p2_avatar)
  values (my_row.mode, my_row.qte,
          my_row.user_id,    my_row.username,    my_row.avatar_url,
          other_row.user_id, other_row.username, other_row.avatar_url)
  returning id into new_id;

  return new_id;
end;
$$;

-- RPC: record result + apply RR (ELO) ---------------------------------------
-- Called once by the host when the match ends. Idempotent (no-op if already done).
-- Unrated: just records winner/status. Ranked: applies a symmetric ELO RR delta
-- (K=40, min 10) and clamps RR at 0.
create or replace function mm_apply_result(match uuid, winner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m     mm_matches;
  loser uuid;
  rw    int;
  rl    int;
  pw    int;
  pl    int;
  ew    float;
  kw    int;
  kl    int;
  dw    int;
  dl    int;
begin
  select * into m from mm_matches where id = match for update;
  if m.id is null or m.status = 'done' then return; end if;
  -- Only a participant may report the result.
  if auth.uid() <> m.p1_id and auth.uid() <> m.p2_id then return; end if;
  if winner <> m.p1_id and winner <> m.p2_id then return; end if;
  loser := case when winner = m.p1_id then m.p2_id else m.p1_id end;

  if m.mode <> 'ranked' then
    update mm_matches
       set winner_id = winner, status = 'done', ended_at = now(),
           p1_rr_delta = 0, p2_rr_delta = 0
     where id = match;
    return;
  end if;

  -- Seed new ranked players at a provisional RR so placement games can calibrate
  -- them up or down from a neutral middle point.
  insert into mm_ratings (user_id, rr) values (winner, 600) on conflict (user_id) do nothing;
  insert into mm_ratings (user_id, rr) values (loser,  600) on conflict (user_id) do nothing;
  select rr, placement_games into rw, pw from mm_ratings where user_id = winner;
  select rr, placement_games into rl, pl from mm_ratings where user_id = loser;

  -- Expected score for the winner. Players still in their first 3 (placement)
  -- games use a much larger K so their RR converges quickly toward true skill.
  ew := 1.0 / (1.0 + power(10, (rl - rw)::float / 400.0));
  kw := case when pw < 3 then 120 else 40 end;
  kl := case when pl < 3 then 120 else 40 end;
  dw := round(kw * (1 - ew));            -- RR the winner gains
  dl := round(kl * (1 - ew));            -- RR the loser drops
  if dw < 10 then dw := 10; end if;

  update mm_ratings set rr = rr + dw,              wins   = wins   + 1,
         placement_games = placement_games + 1, updated_at = now() where user_id = winner;
  update mm_ratings set rr = greatest(0, rr - dl), losses = losses + 1,
         placement_games = placement_games + 1, updated_at = now() where user_id = loser;

  update mm_matches
     set winner_id = winner, status = 'done', ended_at = now(),
         p1_rr_delta = case when winner = m.p1_id then dw else -dl end,
         p2_rr_delta = case when winner = m.p2_id then dw else -dl end
   where id = match;
end;
$$;

-- RPC: mark a match abandoned (player left / closed tab mid-match) -----------
-- Either participant may call this; awards the win to the other player.
create or replace function mm_abandon_match(match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m     mm_matches;
  me    uuid := auth.uid();
  other uuid;
begin
  select * into m from mm_matches where id = match for update;
  if m.id is null or m.status = 'done' then return; end if;
  if me <> m.p1_id and me <> m.p2_id then return; end if;
  other := case when me = m.p1_id then m.p2_id else m.p1_id end;
  perform mm_apply_result(match, other);
end;
$$;

grant execute on function mm_create_match(uuid)       to authenticated;
grant execute on function mm_apply_result(uuid, uuid) to authenticated;
grant execute on function mm_abandon_match(uuid)      to authenticated;
