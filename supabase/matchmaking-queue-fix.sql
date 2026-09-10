-- Matchmaking queue: liveness + a way to see who is waiting --------------------
--
-- Safe to run on a live project. It adds a column, backfills it, adds one
-- function, and replaces mm_create_match with the same logic plus a staleness
-- guard. Nothing here changes how a match is scored.
--
-- TWO PROBLEMS THIS ADDRESSES
--
-- 1. THE QUEUE NEVER EMPTIED. mm_queue rows are deleted on cancel and on match,
--    but closing the tab deletes nothing. Measured 09 Sep 2026: 52 rows, median
--    age 436 hours, oldest 2177 hours, 51 of 52 older than a day. Against 7
--    matches in the table's entire lifetime.
--
-- 2. YOU COULD NOT SEE WHERE ANYONE WAS WAITING. Pairing runs off realtime
--    presence on 'mm-q-<mode>-<qte>', so two players must be subscribed to the
--    SAME channel at the SAME moment. There are 12 QTEs x 2 modes = 24 buckets,
--    and the only way to find out whether anyone was in one was to join it and
--    wait. With a small player base that is close to unmatchable by chance.
--
--    mm_queue_counts() below makes the queue visible before you commit to it,
--    so players can converge on a bucket that already has someone in it. That
--    is the actual fix for "nobody ever gets matched" - the rest is hygiene.

-- ── liveness ────────────────────────────────────────────────────────────────
-- Deliberately NOT `add column ... not null default now()`: that would stamp
-- every one of the existing stale rows as brand new and they would all look
-- live. Add it nullable, backfill from created_at so real ages survive, then
-- tighten.
alter table mm_queue add column if not exists seen_at timestamptz;
update mm_queue set seen_at = created_at where seen_at is null;
alter table mm_queue alter column seen_at set default now();
alter table mm_queue alter column seen_at set not null;

create index if not exists mm_queue_seen_at_idx on mm_queue (seen_at desc);

-- Clear the backlog once, now that ages are accurate.
delete from mm_queue where seen_at < now() - interval '5 minutes';

-- ── who is waiting, without joining ─────────────────────────────────────────
-- Returns {"unrated|dagger": 3, "ranked|spear": 1} - an object rather than rows
-- because the client indexes straight into it and it keeps the payload small.
-- Only rows seen in the last 60s count; the client heartbeats every 25s while
-- queued, so a live player is always well inside that window and a closed tab
-- disappears from the count within a minute.
create or replace function mm_queue_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  res jsonb;
begin
  -- Sweep on a fraction of calls. The filter below already ignores stale rows,
  -- so this is only about table size.
  if random() < 0.05 then
    delete from mm_queue where seen_at < now() - interval '5 minutes';
  end if;

  select coalesce(jsonb_object_agg(mode || '|' || qte, n), '{}'::jsonb)
    into res
    from (
      select mode, qte, count(*)::int as n
        from mm_queue
       where seen_at > now() - interval '60 seconds'
       group by mode, qte
    ) s;

  return res;
end;
$$;

revoke all on function mm_queue_counts() from public;
-- The matchmaking page is behind a login, so authenticated is enough.
grant execute on function mm_queue_counts() to authenticated;

-- ── pairing: refuse to match a ghost ────────────────────────────────────────
-- Unchanged from matchmaking.sql:83 except for the staleness guard. Pairing is
-- driven by presence, so both players are normally live by definition; this
-- stops a leftover row being turned into a match against someone who is gone.
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

  perform 1 from mm_queue where user_id in (me, other) order by user_id for update;

  select * into my_row    from mm_queue where user_id = me;
  select * into other_row from mm_queue where user_id = other;

  if my_row.user_id is null or other_row.user_id is null then
    return null;
  end if;
  if my_row.mode <> other_row.mode or my_row.qte <> other_row.qte then
    return null;
  end if;
  if my_row.seen_at    < now() - interval '60 seconds'
  or other_row.seen_at < now() - interval '60 seconds' then
    delete from mm_queue
     where user_id in (me, other)
       and seen_at < now() - interval '60 seconds';
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

grant execute on function mm_create_match(uuid) to authenticated;

-- VERIFY
--   select count(*) from mm_queue;                 -- should drop to ~0
--   select mm_queue_counts();                      -- {} with nobody queued
--   select mode, qte, seen_at from mm_queue order by seen_at desc limit 10;
--
-- WHAT THIS DOES NOT DO
-- It does not change the bucketing. Twelve QTEs across two modes is a lot of
-- ways for two people to miss each other, and the counts make that navigable
-- rather than solving it. If matchmaking stays quiet once players can see where
-- everyone is, the next lever is fewer buckets - one queue per mode with the
-- QTE chosen after pairing, or letting a long wait widen to any QTE the way
-- rrWindow() already widens the rating gap.
