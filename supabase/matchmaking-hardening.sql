-- Matchmaking result hardening ------------------------------------------------
--
-- NOT YET APPLIED. Review this before running it: it changes live ranked play,
-- and unlike the JavaScript in this repo it has not been executed or tested
-- anywhere. Run it in the Supabase SQL editor when you are ready.
--
-- THE PROBLEM
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
-- WHAT THIS DOES AND DOES NOT DO
-- Be clear-eyed: results are adjudicated on the client, so they cannot be made
-- trustworthy without a server that watches the match. This does not fix that.
-- It removes the cheapest version of the attack and makes the rest cost more:
--
--   1. A non-host may only report a result in which they LOSE. That is exactly
--      what abandoning is, so mm_abandon_match keeps working, and it means a
--      guest can no longer claim a win at all. It cannot hurt anyone but
--      themselves.
--   2. A ranked result must carry a round log that actually supports the
--      winner - at least two rounds recorded as won by them. Forging a win now
--      means forging a consistent log rather than one RPC argument.
--   3. A match that ends within 15 seconds of being created is rejected. A real
--      QTE match cannot finish that fast, and instant-win scripts do.
--
-- The host can still cheat by forging a round log. Closing that needs
-- server-side adjudication, which is a different piece of work.
--
-- The host is already defined as the smaller of the two uuids - see the comment
-- at matchmaking.sql:82, "The smaller-uid player (the host) calls this" - so no
-- schema change is needed to identify them.

create or replace function mm_apply_result(match uuid, winner uuid, p_rounds jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m       mm_matches;
  loser   uuid;
  me      uuid := auth.uid();
  host    uuid;
  won_by  int;
  rw int; rl int; pw int; pl int;
  ew float; kw int; kl int; dw int; dl int;
begin
  select * into m from mm_matches where id = match for update;
  if m.id is null or m.status = 'done' then return; end if;

  -- Caller and winner must both be in this match (unchanged).
  if me <> m.p1_id and me <> m.p2_id then return; end if;
  if winner <> m.p1_id and winner <> m.p2_id then return; end if;

  host  := least(m.p1_id, m.p2_id);
  loser := case when winner = m.p1_id then m.p2_id else m.p1_id end;

  -- (1) Only the host reports a win. Anyone may concede.
  --     This is what stops a guest claiming the match out from under the host,
  --     and it is what mm_abandon_match relies on: it awards the win to the
  --     OTHER player, so the caller is always the loser there.
  if me <> host and winner <> loser then
    raise exception 'only the host may report the winner of a match';
  end if;
  if me <> host and loser <> me then
    raise exception 'a guest may only concede their own match';
  end if;

  -- (3) A match cannot legitimately finish this fast.
  if m.created_at > now() - interval '15 seconds' then
    raise exception 'match ended implausibly quickly';
  end if;

  if m.mode <> 'ranked' then
    update mm_matches
       set winner_id = winner, status = 'done', ended_at = now(),
           p1_rr_delta = 0, p2_rr_delta = 0,
           rounds = coalesce(p_rounds, rounds)
     where id = match;
    return;
  end if;

  -- (2) Ranked results must carry a log that supports the winner. A concession
  --     is exempt - the loser is not claiming anything, and an abandoned match
  --     has no completed rounds to show.
  if me = host then
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

  update mm_ratings set rr = rr + dw, wins = wins + 1,
         placement_games = placement_games + 1, updated_at = now()
   where user_id = winner;
  update mm_ratings set rr = greatest(0, rr - dl), losses = losses + 1,
         placement_games = placement_games + 1, updated_at = now()
   where user_id = loser;

  update mm_matches
     set winner_id = winner, status = 'done', ended_at = now(),
         p1_rr_delta = case when m.p1_id = winner then dw else -dl end,
         p2_rr_delta = case when m.p2_id = winner then dw else -dl end,
         rounds = coalesce(p_rounds, rounds)
   where id = match;
end;
$$;

grant execute on function mm_apply_result(uuid, uuid, jsonb) to authenticated;

-- ONE DECISION HAS TO BE MADE BEFORE THIS CAN BE APPLIED
--
-- js/matchmaking.js:696 - the opponent-disconnected path - has the REMAINING
-- player claim the win for themselves:
--
--     sb.rpc('mm_apply_result', { match: matchId, winner: me.id })
--
-- Under rule (1) a guest doing that is refused, so applying this as-is means a
-- guest whose opponent disconnects can no longer be awarded the win.
--
-- That is not an accident of the rule; it is the same hole. "My opponent
-- vanished, give me the win" is unverifiable server-side, and it is the easiest
-- forgery of all: disconnect-claim needs no round log. mm_abandon_match is not
-- a drop-in replacement either - it awards the win to the OTHER player, which
-- is the disconnecting player conceding, not the survivor claiming.
--
-- So pick one before running this:
--
--   (a) A disconnect voids the match. Add an mm_void_match(match) RPC that any
--       participant may call, setting status='done' with both deltas 0 and no
--       winner, and point matchmaking.js:696 at it. Nobody gains RR from a
--       disconnect, and the free-win route closes completely. Simplest, and it
--       is what this file assumes.
--   (b) Keep disconnect-wins and accept that they are forgeable. Then relax
--       rule (1) to allow a non-host to claim a win, and this file only buys
--       you rules (2) and (3).
--   (c) Adjudicate on the server. The only real fix, and much more work.
--
-- ALSO CHECK
--
-- The RR maths above is copied from the live function in reports.sql. Diff it
-- against what is actually deployed first - if you have edited that function in
-- the dashboard since, this overwrites your changes:
--   select pg_get_functiondef('mm_apply_result(uuid,uuid,jsonb)'::regprocedure);
--
-- mm_matches.created_at already exists and is `not null default now()`
-- (matchmaking.sql:36), so the timing check needs no migration.
--
-- These raise instead of returning silently, so a refusal reaches the client
-- as an error rather than a result that quietly does nothing. Check how
-- js/matchmaking.js surfaces an rpc error before rolling out.
