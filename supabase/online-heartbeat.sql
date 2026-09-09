-- Online-now counter: heartbeat table + RPC -----------------------------------
--
-- RUN THIS BEFORE DEPLOYING THE MATCHING index.html CHANGE. The client calls
-- ping_online() and falls back to leaving the counter alone if the function is
-- missing, so deploying in the other order is not fatal - the counter just
-- shows its optimistic 1 until this lands.
--
-- WHY THIS REPLACED REALTIME PRESENCE
-- The counter used a Supabase Realtime presence channel that every visitor
-- joined, logged in or not. Presence fans out: each join and leave sends a
-- presence_diff to EVERY connected client, so both the number of events and the
-- number of recipients grow with N, and cost grows with N squared.
--
-- Measured on the live site by hooking the websocket, 09 Sep 2026:
--     355 bytes per presence_diff, ~31 diffs/min per client
--     0.67 MB/hour per client at 93 concurrent
--     -> 12.256 GB billed in one day, 99.6% of the project's entire egress
--        (PostgREST was 43 MB, Storage 184 KB, Auth 889 KB on the same day)
--
-- A decorative number was the whole bill, and it also held one websocket per
-- anonymous visitor against the 200-concurrent-connection cap.
--
-- This design is O(N): a client's cost is one small request a minute no matter
-- how many other people are online. At 210 concurrent that is roughly 150 MB a
-- day rather than ~7.6 GB, and it keeps that shape as the site grows.

create table if not exists online_heartbeats (
  fp      text        primary key,
  seen_at timestamptz not null default now()
);

-- The count below is a range scan on seen_at; the primary key serves the upsert.
create index if not exists online_heartbeats_seen_at_idx
  on online_heartbeats (seen_at desc);

-- Nothing reaches this table except through the function, which is security
-- definer and therefore runs as the owner. No policies are defined on purpose:
-- the fingerprint list is not something clients should be able to read, and the
-- only thing anyone needs from it is the count.
alter table online_heartbeats enable row level security;

create or replace function ping_online(p_fp text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  -- The fingerprint is client-supplied, so bound it. 64 is far more than the
  -- 'fp_' + base36 ids the site generates, and it stops anyone using this table
  -- as free storage.
  if p_fp is null or length(p_fp) = 0 or length(p_fp) > 64 then
    raise exception 'invalid fingerprint';
  end if;

  insert into online_heartbeats (fp, seen_at)
  values (p_fp, now())
  on conflict (fp) do update set seen_at = now();

  -- Sweep occasionally rather than on every call. The count already ignores
  -- stale rows, so this is purely about table size, and sweeping on every ping
  -- would multiply write volume for no benefit. At 200 visitors pinging once a
  -- minute this runs roughly twice a minute, which is ample - rows are bounded
  -- by distinct recent visitors, not by time.
  if random() < 0.01 then
    delete from online_heartbeats where seen_at < now() - interval '10 minutes';
  end if;

  -- 90s rather than 60s: a client that is a little late, or was throttled by a
  -- background tab for a tick, should not flicker out of the count.
  select count(*) into n
    from online_heartbeats
   where seen_at > now() - interval '90 seconds';

  return n;
end;
$$;

revoke all on function ping_online(text) from public;
grant execute on function ping_online(text) to anon, authenticated;

-- OPTIONAL, if you have pg_cron enabled. The in-function sweep above already
-- keeps the table bounded, so this is belt and braces for a project that goes
-- quiet for a long stretch and leaves rows sitting around:
--
--   select cron.schedule('sweep-online-heartbeats', '*/10 * * * *',
--     $$delete from online_heartbeats where seen_at < now() - interval '10 minutes'$$);

-- VERIFY
--   select ping_online('fp_test');            -- returns a count, >= 1
--   select count(*) from online_heartbeats;   -- one row per recent visitor
--   select * from online_heartbeats order by seen_at desc limit 5;
--
-- A note on what this can and cannot do: the fingerprint comes from the
-- browser, so the count is inflatable by anyone willing to call the RPC with
-- made-up ids. That was equally true of the presence key it replaces, and it is
-- a decorative number - not worth defending with rate limiting that would cost
-- more than the thing it protects.
