-- ===========================================================================
-- AL BUILDER - Player reporting system
-- Run this whole file once in the Supabase SQL editor (Dashboard > SQL > New query).
-- Requires matchmaking.sql to have been run first (references mm_matches).
-- Safe to re-run.
--
--   reports  - player reports (cheating / misconduct); admins read + resolve
-- Also: adds mm_matches.rounds (per-round scores) and extends mm_apply_result to
-- persist them, so cheating-in-a-match reports can show the match scores.
--
-- NOTE: the admin UUIDs in the policies below MUST match ADMIN_IDS in js/sb.js.
-- ===========================================================================

-- Per-round score log on matches (e.g. [{"r":1,"p1":8,"p2":5,"w":"<uuid>"}, ...]).
alter table mm_matches add column if not exists rounds jsonb;

-- Replace mm_apply_result with a version that also stores the round scores.
-- (Drop the old 2-arg form so the new default-arg form fully replaces it; the
--  2-arg callers like mm_abandon_match resolve to the new form via the default.)
drop function if exists mm_apply_result(uuid, uuid);
create or replace function mm_apply_result(match uuid, winner uuid, p_rounds jsonb default null)
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
           p1_rr_delta = 0, p2_rr_delta = 0,
           rounds = coalesce(p_rounds, rounds)
     where id = match;
    return;
  end if;

  -- Seed new ranked players at a provisional RR so placement games can calibrate.
  insert into mm_ratings (user_id, rr) values (winner, 600) on conflict (user_id) do nothing;
  insert into mm_ratings (user_id, rr) values (loser,  600) on conflict (user_id) do nothing;
  select rr, placement_games into rw, pw from mm_ratings where user_id = winner;
  select rr, placement_games into rl, pl from mm_ratings where user_id = loser;

  ew := 1.0 / (1.0 + power(10, (rl - rw)::float / 400.0));
  kw := case when pw < 3 then 120 else 40 end;
  kl := case when pl < 3 then 120 else 40 end;
  dw := round(kw * (1 - ew));
  dl := round(kl * (1 - ew));
  if dw < 10 then dw := 10; end if;

  update mm_ratings set rr = rr + dw,              wins   = wins   + 1,
         placement_games = placement_games + 1, updated_at = now() where user_id = winner;
  update mm_ratings set rr = greatest(0, rr - dl), losses = losses + 1,
         placement_games = placement_games + 1, updated_at = now() where user_id = loser;

  update mm_matches
     set winner_id = winner, status = 'done', ended_at = now(),
         p1_rr_delta = case when winner = m.p1_id then dw else -dl end,
         p2_rr_delta = case when winner = m.p2_id then dw else -dl end,
         rounds = coalesce(p_rounds, rounds)
   where id = match;
end;
$$;

grant execute on function mm_apply_result(uuid, uuid, jsonb) to authenticated;

-- Reports -------------------------------------------------------------------
create table if not exists reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid not null references auth.users on delete cascade,
  reporter_name text,
  reported_id   uuid not null references auth.users on delete cascade,
  reported_name text,
  reason        text not null check (reason in ('cheating','misconduct')),
  detail        text,
  match_id      uuid references mm_matches on delete set null,
  status        text not null default 'open' check (status in ('open','reviewed','dismissed')),
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz
);
create index if not exists reports_status_idx on reports (status, created_at desc);

alter table reports enable row level security;

-- A user may file a report as themselves.
drop policy if exists reports_insert on reports;
create policy reports_insert on reports for insert
  with check (auth.uid() = reporter_id);

-- The reporter can read their own report; admins can read all.
-- (These UUIDs MUST stay in sync with ADMIN_IDS in js/sb.js.)
drop policy if exists reports_read on reports;
create policy reports_read on reports for select using (
  auth.uid() = reporter_id
  or auth.uid() in (
    'a508b4b7-1d32-4511-a609-4a80ded49681',
    '3a376365-2f03-4e4f-8c5f-6b8020271809'
  )
);

-- Only admins may resolve (update) reports.
drop policy if exists reports_admin_update on reports;
create policy reports_admin_update on reports for update using (
  auth.uid() in (
    'a508b4b7-1d32-4511-a609-4a80ded49681',
    '3a376365-2f03-4e4f-8c5f-6b8020271809'
  )
);

grant usage on schema public to anon, authenticated;
grant select, insert, update on reports to authenticated;

-- Live updates for the admin badge (optional; the bell ping already works without it).
do $$ begin
  alter publication supabase_realtime add table reports;
exception when duplicate_object then null; end $$;
