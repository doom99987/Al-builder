-- Lock the RPCs to signed-in players -------------------------------------------
--
-- RUN THIS. It is idempotent and safe to re-run. It fixes a hole that predates
-- matchmaking-hardening.sql and that hardening did not close.
--
-- ===========================================================================
-- THE HOLE
-- ===========================================================================
-- Found by probing the live database as an anonymous visitor: every matchmaking
-- RPC answered. mm_queue_counts and ping_online were the only two that refused,
-- and they are the only two anywhere in supabase/*.sql that carry a
-- `revoke ... from public`.
--
--   anon rpc mm_apply_result      -> OK
--   anon rpc mm_report_disconnect -> OK
--   anon rpc mm_match_ping        -> OK
--   anon rpc mm_settle            -> 42501 permission denied   (has a revoke)
--   anon rpc mm_queue_counts      -> 42501 permission denied   (has a revoke)
--
-- Two independent bugs stack up here, and either one alone is enough.
--
-- BUG 1 - Postgres grants EXECUTE on a new function to PUBLIC by default.
--   `grant execute on function f() to authenticated` does not take anything
--   away; it re-states a privilege PUBLIC already has. Every function without
--   an explicit revoke is callable by the anon role, which on this project means
--   callable by anyone on the internet with the project URL and the publishable
--   anon key - both of which ship in the page source.
--
-- BUG 2 - the participant checks are not null-safe.
--   Every one of them is written as
--
--       if me <> m.p1_id and me <> m.p2_id then return; end if;
--
--   For an anonymous caller auth.uid() is NULL, and `NULL <> x` evaluates to
--   NULL, not TRUE. An `if` only branches on TRUE. So the guard does not fire
--   and the function carries on with me = NULL.
--
-- Combined, in mm_apply_result: the participant check falls through, and every
-- rule added by matchmaking-hardening.sql is gated on `winner = me`, which is
-- NULL and therefore never TRUE - so the host-only rule, the round-log rule and
-- the 15-second rule are all skipped. An anonymous caller reaches mm_settle with
-- a winner of their choosing:
--
--     rpc('mm_apply_result', { match: <any active id>, winner: <either player> })
--
-- Match ids are world-readable (matchmaking.sql:67, `using (true)`), so they can
-- be listed. That is arbitrary decision of any live ranked match, at full RR,
-- with no account required. mm_abandon_match is the same shape: `other` resolves
-- through a NULL comparison to p1_id, handing p1 the win.
--
-- This is not new today. The pre-hardening mm_apply_result (reports.sql:43) had
-- the identical `auth.uid() <> ... then return` shape and no revoke either. What
-- is new is that hardening claimed to make result reporting trustworthy, and
-- against an anonymous caller it did not.
--
-- ===========================================================================
-- THE FIX
-- ===========================================================================
-- Both layers, because either one is a single edit away from being undone:
--   (1) revoke EXECUTE from PUBLIC on every function, then grant deliberately;
--   (2) make every function refuse a NULL auth.uid() outright.

-- ---------------------------------------------------------------------------
-- (1) Take away the default PUBLIC grant, then hand it back on purpose.
-- ---------------------------------------------------------------------------
-- The 2-arg form should already be gone (reports.sql:19 drops it), but an old
-- deploy may still have it, and it is the unhardened original.
drop function if exists mm_apply_result(uuid, uuid);

revoke all on function mm_apply_result(uuid, uuid, jsonb) from public;
revoke all on function mm_abandon_match(uuid)             from public;
revoke all on function mm_create_match(uuid)              from public;
revoke all on function mm_match_ping(uuid)                from public;
revoke all on function mm_report_disconnect(uuid)         from public;
revoke all on function mm_settle(uuid, uuid, jsonb)       from public;
revoke all on function mm_queue_counts()                  from public;
revoke all on function ping_online(text)                  from public;
revoke all on function public.is_site_admin()             from public;

-- Signed-in players only.
grant execute on function mm_apply_result(uuid, uuid, jsonb) to authenticated;
grant execute on function mm_abandon_match(uuid)             to authenticated;
grant execute on function mm_create_match(uuid)              to authenticated;
grant execute on function mm_match_ping(uuid)                to authenticated;
grant execute on function mm_report_disconnect(uuid)         to authenticated;
grant execute on function mm_queue_counts()                  to authenticated;

-- Deliberately reachable by logged-out visitors:
--   ping_online     drives the online counter on every page for everyone.
--   is_site_admin   is read by the client to decide whether to show admin UI;
--                   it returns false for anon, which is the whole point.
grant execute on function ping_online(text)      to anon, authenticated;
grant execute on function public.is_site_admin() to anon, authenticated;

-- mm_settle stays callable by nobody. It does the RR maths with no checks of
-- its own; mm_apply_result and mm_report_disconnect reach it as the definer.
-- (Already revoked in matchmaking-hardening.sql - restated so this file alone
--  is sufficient.)
revoke all on function mm_settle(uuid, uuid, jsonb) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- (2) Refuse a NULL caller explicitly, so a stray grant is not game over.
-- ---------------------------------------------------------------------------
-- These are the same functions as in matchmaking-hardening.sql and
-- matchmaking.sql, with `if me is null then ...` added and nothing else changed.

create or replace function mm_match_ping(match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m  mm_matches;
  me uuid := auth.uid();
begin
  if me is null then return; end if;
  select * into m from mm_matches where id = match;
  if m.id is null or m.status <> 'active' then return; end if;
  if me = m.p1_id then
    update mm_matches set p1_seen_at = now() where id = match;
  elsif me = m.p2_id then
    update mm_matches set p2_seen_at = now() where id = match;
  end if;
end;
$$;

create or replace function mm_apply_result(match uuid, winner uuid, p_rounds jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m      mm_matches;
  me     uuid := auth.uid();
  host   uuid;
  won_by int;
begin
  -- Without this, every `winner = me` rule below silently evaluates to NULL and
  -- is skipped, and the participant check below does not fire either.
  if me is null then raise exception 'not authenticated'; end if;

  select * into m from mm_matches where id = match;
  if m.id is null or m.status = 'done' then return; end if;

  if me <> m.p1_id and me <> m.p2_id then return; end if;
  if winner <> m.p1_id and winner <> m.p2_id then return; end if;

  host := least(m.p1_id, m.p2_id);

  -- (1) Only the host may report a win. `winner <> me` is a concession, and
  --     anyone may concede - that is what mm_abandon_match does, and it can only
  --     ever hurt the caller.
  if winner = me and me <> host then
    raise exception 'only the host may report the winner of a match';
  end if;

  -- (3) A match cannot legitimately be WON this fast.
  if winner = me and m.created_at > now() - interval '15 seconds' then
    raise exception 'match ended implausibly quickly';
  end if;

  -- (2) A claimed ranked win must carry a log that supports it.
  if m.mode = 'ranked' and winner = me then
    if p_rounds is null or jsonb_typeof(p_rounds) <> 'array' then
      raise exception 'a ranked result must include its round log';
    end if;
    select count(*) into won_by
      from jsonb_array_elements(p_rounds) r
     where r ->> 'w' = winner::text;
    if won_by < 2 then
      raise exception 'round log does not support the reported winner';
    end if;
  end if;

  perform mm_settle(match, winner, p_rounds);
end;
$$;

create or replace function mm_report_disconnect(match uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m        mm_matches;
  me       uuid := auth.uid();
  opp_seen timestamptz;
begin
  -- Without this, `me = m.p1_id` is NULL, opp_seen takes the p1 branch by
  -- default, and mm_settle is reached with a NULL winner - which ends an active
  -- unrated match with no winner at all. Pure griefing, no account needed.
  if me is null then return null; end if;

  select * into m from mm_matches where id = match for update;
  if m.id is null then return null; end if;
  if me <> m.p1_id and me <> m.p2_id then return null; end if;

  -- Already settled - by their concession, or by a result reported just before
  -- they dropped. Report what actually happened, whichever way it went.
  if m.status = 'done' then return m.winner_id; end if;

  -- Not before the match has had a chance to be real.
  if m.created_at > now() - interval '20 seconds' then return null; end if;

  opp_seen := case when me = m.p1_id then m.p2_seen_at else m.p1_seen_at end;

  -- Never pinged: an old client. Cannot be told apart from a dead one.
  if opp_seen is null then return null; end if;

  -- Still alive.
  if opp_seen > now() - interval '30 seconds' then return null; end if;

  perform mm_settle(match, me, null);
  return me;
end;
$$;

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
  -- Without this, `me = m.p1_id` is NULL, `other` falls to the else branch and
  -- resolves to p1_id, and an anonymous caller hands p1 the win.
  if me is null then return; end if;

  select * into m from mm_matches where id = match for update;
  if m.id is null or m.status = 'done' then return; end if;
  if me <> m.p1_id and me <> m.p2_id then return; end if;
  other := case when me = m.p1_id then m.p2_id else m.p1_id end;
  perform mm_apply_result(match, other);
end;
$$;

-- create or replace resets nothing about privileges on an EXISTING function,
-- but it does apply the default PUBLIC grant to one it had to create. Revoke
-- again after, so this file is correct whichever way each function went.
revoke all on function mm_match_ping(uuid)                from public;
revoke all on function mm_apply_result(uuid, uuid, jsonb) from public;
revoke all on function mm_report_disconnect(uuid)         from public;
revoke all on function mm_abandon_match(uuid)             from public;

grant execute on function mm_match_ping(uuid)                to authenticated;
grant execute on function mm_apply_result(uuid, uuid, jsonb) to authenticated;
grant execute on function mm_report_disconnect(uuid)         to authenticated;
grant execute on function mm_abandon_match(uuid)             to authenticated;

-- ===========================================================================
-- VERIFY - run this after, and read the output
-- ===========================================================================
-- Every row it returns is a function the anon role can still execute. The only
-- two that belong in the list are ping_online and is_site_admin.
--
--   select p.proname,
--          pg_get_function_identity_arguments(p.oid) as args,
--          has_function_privilege('anon', p.oid, 'execute') as anon_can_call
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and has_function_privilege('anon', p.oid, 'execute')
--    order by 1;
--
-- If anything other than ping_online and is_site_admin appears, it is reachable
-- by anyone on the internet and needs a revoke.
--
-- NOTE FOR ANY FUNCTION ADDED LATER: `grant execute ... to authenticated` is
-- not a restriction. A new function is world-executable the moment it is
-- created. Pair every create with a revoke from public.
