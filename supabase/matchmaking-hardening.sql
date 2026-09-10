-- Matchmaking result hardening ------------------------------------------------
--
-- READY TO RUN. Paste the whole file into the Supabase SQL editor. It is
-- idempotent (every object is `create or replace` / `if not exists`), so
-- re-running it is safe.
--
-- ===========================================================================
-- THE PROBLEM
-- ===========================================================================
-- mm_apply_result (live version in reports.sql:21) validates that the CALLER is
-- a participant and that the WINNER is a participant, and nothing else:
--
--     if auth.uid() <> m.p1_id and auth.uid() <> m.p2_id then return; end if;
--     if winner <> m.p1_id and winner <> m.p2_id then return; end if;
--
-- Match ids reach both clients (js/matchmaking.js:305 host, :269 guest), and
-- mm_matches is world-readable (matchmaking.sql:67, `using (true)`). So either
-- player can open a console mid-match and call:
--
--     _sbClient.rpc('mm_apply_result', { match: '<id>', winner: '<their own id>' })
--
-- and win. Whoever calls first wins, because the second call sees status='done'
-- and returns. Placement K is 120 (reports.sql:63), so that is ~120 RR a go.
--
-- ===========================================================================
-- WHAT THIS DOES
-- ===========================================================================
-- Results are still adjudicated on the client, so they cannot be made fully
-- trustworthy without a server that watches the match. This does not fix that.
-- It closes the cheap forgeries and makes the rest cost more:
--
--   1. Only the host may report a WIN. Anyone may CONCEDE. Conceding is what
--      abandoning is, so mm_abandon_match keeps working, and a guest can no
--      longer claim a win out from under the host.
--
--   2. A ranked win claimed by the caller must carry a round log that supports
--      it - at least two rounds recorded as won by them. Forging a win now
--      means forging a consistent log rather than one RPC argument. A
--      concession is exempt: the conceding player is not claiming anything,
--      and an abandoned match has no completed rounds to show.
--
--   3. A claimed win on a match less than 15 seconds old is rejected. A real
--      QTE match cannot finish that fast; instant-win scripts can. Conceding
--      that fast is allowed - rage-quitting is legal, it just loses.
--
--   4. DISCONNECT = LOSS, verified server-side. Both clients stamp a per-match
--      heartbeat (mm_match_ping). If your opponent goes dark you call
--      mm_report_disconnect, and the SERVER checks that their heartbeat really
--      is stale before awarding you the win. You cannot claim a disconnect
--      against a player who is still sitting there heartbeating - the timestamp
--      it is measured against is one THEY wrote.
--
-- The host can still cheat by forging a round log. Closing that needs
-- server-side adjudication, which is a different piece of work.
--
-- The host is already defined as the smaller of the two uuids - see the comment
-- at matchmaking.sql:82, "The smaller-uid player (the host) calls this" - so no
-- schema change is needed to identify them.

-- ===========================================================================
-- Per-match liveness
-- ===========================================================================
-- Without this a disconnect claim is unverifiable, and it is the easiest
-- forgery of all: "my opponent vanished, give me the win" needs no round log.
-- With it, the claim is checked against something the OTHER player wrote.
alter table mm_matches add column if not exists p1_seen_at timestamptz;
alter table mm_matches add column if not exists p2_seen_at timestamptz;

-- Timings, and why. The client pings every 10s (MM_PING_MS in matchmaking.js),
-- so 30s of silence is three missed pings: long enough to ride out a hiccup or
-- a backgrounded tab, short enough that nobody sits waiting on a dead opponent.

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
  select * into m from mm_matches where id = match;
  if m.id is null or m.status <> 'active' then return; end if;
  if me = m.p1_id then
    update mm_matches set p1_seen_at = now() where id = match;
  elsif me = m.p2_id then
    update mm_matches set p2_seen_at = now() where id = match;
  end if;
end;
$$;

grant execute on function mm_match_ping(uuid) to authenticated;

-- ===========================================================================
-- Settlement, with no authorisation checks of its own
-- ===========================================================================
-- Split out so that both the player-facing mm_apply_result and the
-- server-verified mm_report_disconnect can settle a match without one having to
-- impersonate the other. auth.uid() is unchanged inside a security-definer
-- function, so mm_report_disconnect could not simply call mm_apply_result -
-- rule (1) would reject it for being a guest claiming a win.
--
-- Granted to nobody. Callable only from the two functions below, which run as
-- the definer.
create or replace function mm_settle(match uuid, winner uuid, p_rounds jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m     mm_matches;
  loser uuid;
  rw int; rl int; pw int; pl int;
  ew float; kw int; kl int; dw int; dl int;
begin
  select * into m from mm_matches where id = match for update;
  if m.id is null or m.status = 'done' then return; end if;
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

revoke all on function mm_settle(uuid, uuid, jsonb) from public;
revoke all on function mm_settle(uuid, uuid, jsonb) from anon, authenticated;

-- ===========================================================================
-- Player-reported results
-- ===========================================================================
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
  select * into m from mm_matches where id = match;
  if m.id is null or m.status = 'done' then return; end if;

  -- Caller and winner must both be in this match (unchanged).
  if me <> m.p1_id and me <> m.p2_id then return; end if;
  if winner <> m.p1_id and winner <> m.p2_id then return; end if;

  host := least(m.p1_id, m.p2_id);

  -- (1) Only the host may report a win. `winner <> me` is a concession, and
  --     anyone may concede - that is exactly what mm_abandon_match does, and a
  --     concession can only ever hurt the caller.
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

grant execute on function mm_apply_result(uuid, uuid, jsonb) to authenticated;

-- ===========================================================================
-- Disconnect = loss
-- ===========================================================================
-- Returns the WINNER of the match, or null if it is not decidable yet. Null is
-- not an error condition - the client polls this while it waits out a possible
-- reconnect.
--
-- Returning the winner rather than a bool covers a case that happens on every
-- ordinary tab close: the leaver's beforeunload fires mm_abandon_match, which
-- concedes and settles the match, but the 'abandon' realtime broadcast does not
-- survive the unload - so the surviving client never hears it and comes here
-- instead, to a match that is already done and already won. It needs to be told
-- that, not told "nothing happened".
--
-- The only thing that makes the live case safe is that staleness is measured
-- against a timestamp the OPPONENT wrote. A player who is still in the match is
-- still pinging, so a forged claim against them returns null and costs the
-- caller nothing but time.
--
-- A null opponent heartbeat means their client predates mm_match_ping. Refuse
-- rather than award: during a rollout, every old client would otherwise look
-- permanently dead and be free RR. See ROLLOUT below.
drop function if exists mm_report_disconnect(uuid);
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

grant execute on function mm_report_disconnect(uuid) to authenticated;

-- ===========================================================================
-- ROLLOUT
-- ===========================================================================
-- Order does not matter much, but understand the in-between states:
--
--   SQL applied, old JS still cached
--     Normal wins and concessions keep working - the old client already sends
--     p_rounds on the host win path (js/matchmaking.js:740) and
--     mm_abandon_match already concedes, so rules (1)-(3) are satisfied by code
--     that exists today.
--
--     RANKED DISCONNECTS DO NOT SETTLE. The old disconnect path calls
--     mm_apply_result with {match, winner} and no p_rounds, so rule (2) raises
--     'a ranked result must include its round log'. js/sb.js creates the client
--     without throwOnError and the call site is a bare .then(), so the refusal
--     is discarded: the survivor is shown 'Victory!' and an RR line, and no RR
--     actually moves. The match stays status='active' forever. Unrated
--     disconnects still settle, because rule (2) is ranked-only.
--
--     (An earlier draft of this note blamed rule (1) and a guest claiming a
--     win. That was wrong - a guest never reaches the disconnect path at all,
--     because `started` was only ever set on the host. It is the HOST's claim
--     that gets refused, for want of a round log.)
--
--   New JS, SQL not yet applied
--     mm_match_ping and mm_report_disconnect do not exist, so those RPCs error,
--     the client swallows it and falls back to ending the match locally with no
--     RR change. Nothing breaks.
--
-- Once both are out, dropping out of a match is a loss for the player who
-- dropped.
--
-- CHECK FIRST - the RR maths in mm_settle is copied verbatim from the live
-- function in reports.sql. If you have edited that function in the dashboard
-- since, diff it before running, because this replaces it:
--   select pg_get_functiondef('mm_apply_result(uuid,uuid,jsonb)'::regprocedure);
--
-- mm_matches.created_at already exists and is `not null default now()`
-- (matchmaking.sql:36), so the timing checks need no migration.
--
-- The rule violations raise rather than returning silently, so a refusal
-- reaches the client as an error instead of a result that quietly does nothing.
