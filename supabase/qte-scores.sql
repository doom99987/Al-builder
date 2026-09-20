-- QTE leaderboard: session + score submission
-- ============================================================================
-- Run this whole file in the Supabase SQL editor. It is idempotent.
--
-- WHY. Scores were being discarded in silence. Every rejection path in
-- submit_score was a bare RETURN, so PostgREST reported success and the site
-- logged "submitScore ok" for a score the database had thrown away. The rule
-- doing most of the throwing was the timing check: qte_min_seconds was
-- score * 1.0 seconds for every trainer, and competitive spear cannot produce
-- that -- the game itself only presents a target every ~0.85s, falling to
-- ~0.66s (js/qte.js:395-397). Elapsed time grew at 0.85s per point against a
-- requirement of 1.0s per point, so from about streak 3 every submission was
-- dropped. The live board showed exactly that: five players tied at 2, nobody
-- above, while a run had reached 31.
--
-- WHAT CHANGES
--   1. qte_min_seconds gets a floor per trainer and mode, derived from each
--      trainer's own cadence constants in js/qte.js (the fastest a perfect
--      player could possibly score), with ~25% headroom for latency.
--   2. submit_score RETURNS a status instead of dropping scores in silence, so
--      the site can tell the player what happened. js/sb.js reads it.
--   3. Both functions take their identity from auth.uid() instead of trusting
--      p_user_id, which any caller could set to someone else's id.
-- ============================================================================

begin;

-- ── 1. how long a legitimate run needs, per point ───────────────────────────
-- Numbers come from the trainers themselves: fixed post-success delays, spawn
-- intervals, travel time and round timers, taken at their fastest, then cut by
-- about a quarter. The ceiling below each value is the measured floor, so
-- these never reject a real run:
--
--   trainer         casual  comp   measured floor (casual/comp)   shape
--   fist             0.22   0.22   0.30 / 0.30     300ms flash + 600ms restart
--   spear            0.45   0.18   0.60 / 0.46     ring approach + spawn gap
--   sword            0.95   0.90   1.31 / 1.21     bar travel to the zone
--   dagger           0.16   0.33   0.22 / 0.44     220ms ring lockout + 800ms
--   staff            0.75   0.75   1.00 / 1.00     hard 1s gap between rounds
--   axe              2.80   2.40   3.78 / 3.26     round timer, 6s->3s / 5s->2.5s
--   hammer           0.95   0.74   1.33 / 0.99     charge bar + 700ms gap
--   dodge            0.30   0.30   0.61 / 0.55     bar travel; viewport-dependent
--   thorian          6.00   6.00   8.00 / 8.00     round timer
--   thorian-new     11.25  11.25  15.00 / 15.00    15s round timer
--   dagger-new       0.26   0.18   see note        rotating bars, spawn luck
--   yarthul-new      3.75   3.75   5.00 / 5.00     5s stage timer
--
-- dagger-new: its bars spawn at a random angle, so a lucky first spawn can be
-- cleared in ~0.10s (casual) / ~0.07s (comp). Pricing for that would gut the
-- rule, so streaks of 1-2 on a lucky spawn are still refused (~6% of runs).
-- The player's next new high submits normally.
--
-- The ELSE is now the LOWEST floor rather than 1.0. A trainer missing from this
-- list must fail open: yarthul-new was missing and silently inherited 1.0.
create or replace function public.qte_min_seconds(p_type text, p_score integer)
returns numeric
language sql
immutable
as $function$
  select p_score::numeric * case p_type
    when 'fist'             then 0.22
    when 'fist-comp'        then 0.22
    when 'spear'            then 0.45
    when 'spear-comp'       then 0.18
    when 'sword'            then 0.95
    when 'sword-comp'       then 0.90
    when 'dagger'           then 0.16
    when 'dagger-comp'      then 0.33
    when 'staff'            then 0.75
    when 'staff-comp'       then 0.75
    when 'axe'              then 2.80
    when 'axe-comp'         then 2.40
    when 'hammer'           then 0.95
    when 'hammer-comp'      then 0.74
    when 'dodge'            then 0.30
    when 'dodge-comp'       then 0.30
    when 'thorian'          then 6.00
    when 'thorian-comp'     then 6.00
    when 'thorian-new'      then 11.25
    when 'thorian-new-comp' then 11.25
    when 'dagger-new'       then 0.26
    when 'dagger-new-comp'  then 0.18
    when 'yarthul-new'      then 3.75
    when 'yarthul-new-comp' then 3.75
    else 0.16
  end;
$function$;

-- ── 2. session start ────────────────────────────────────────────────────────
-- Identity from the JWT. p_user_id stays in the signature so already-loaded
-- pages keep working, but it is no longer trusted: anyone could pass someone
-- else's id and then submit scores as them.
create or replace function public.start_qte_session(p_user_id uuid, p_qte_type text)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
  DECLARE
    v_id   UUID;
    v_user UUID := auth.uid();
  BEGIN
    IF v_user IS NULL THEN RETURN NULL; END IF;

    -- Purge old unused sessions for this user+type to keep the table small
    DELETE FROM qte_sessions
    WHERE user_id = v_user AND qte_type = p_qte_type
      AND used = false AND started_at < now() - INTERVAL '1 hour';

    INSERT INTO qte_sessions (user_id, qte_type)
    VALUES (v_user, p_qte_type) RETURNING id INTO v_id;
    RETURN v_id;
  END;
$function$;

-- ── 3. score submission ─────────────────────────────────────────────────────
-- Returns one of: 'ok' | 'no_session' | 'capped' | 'too_fast' | 'wrong_user'.
-- js/sb.js retries 'no_session' with a fresh session, and stops retrying (and
-- tells the player) for 'capped' and 'too_fast', which will never change for
-- the score in hand. A client too old to read the status ignores it and
-- behaves exactly as before.
drop function if exists public.submit_score(uuid, text, integer, text, text, uuid);

create function public.submit_score(
  p_user_id    uuid,
  p_qte_type   text,
  p_score      integer,
  p_platform   text,
  p_month      text,
  p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $function$
  DECLARE
    v_session qte_sessions%ROWTYPE;
    v_elapsed NUMERIC;
    v_user    UUID := auth.uid();
  BEGIN
    IF v_user IS NULL THEN RETURN 'no_session'; END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> v_user THEN RETURN 'wrong_user'; END IF;

    -- Validate the session - but DO NOT consume it. One run submits each new
    -- high (streak 1,2,3...), so the same session must cover all of them, and
    -- the elapsed-time check below is timed from when that run started.
    SELECT * INTO v_session FROM qte_sessions
    WHERE id = p_session_id AND user_id = v_user
      AND qte_type = p_qte_type AND used = false;
    IF NOT FOUND THEN RETURN 'no_session'; END IF;

    -- Hard score cap
    IF p_score IS NULL OR p_score <= 0 THEN RETURN 'capped'; END IF;
    IF p_score > qte_score_cap(p_qte_type) THEN RETURN 'capped'; END IF;

    -- Timing check - a higher score needs proportionally more elapsed time,
    -- so reusing the session across one run is safe. See qte_min_seconds for
    -- where each trainer's floor comes from.
    v_elapsed := EXTRACT(EPOCH FROM (now() - v_session.started_at));
    IF v_elapsed < qte_min_seconds(p_qte_type, p_score) THEN RETURN 'too_fast'; END IF;

    -- Monthly leaderboard: one row per user and platform, only ever climbs
    INSERT INTO leaderboard (user_id, qte_type, score, platform, score_month)
    VALUES (v_user, p_qte_type, p_score, p_platform, p_month)
    ON CONFLICT (user_id, qte_type, platform, score_month)
    DO UPDATE SET score = GREATEST(leaderboard.score, EXCLUDED.score);

    -- All-time record
    INSERT INTO leaderboard_records (qte_type, score, platform, user_id)
    VALUES (p_qte_type, p_score, p_platform, v_user)
    ON CONFLICT (qte_type) DO UPDATE
      SET score = EXCLUDED.score, platform = EXCLUDED.platform, user_id = EXCLUDED.user_id
    WHERE EXCLUDED.score > leaderboard_records.score;

    RETURN 'ok';
  END;
$function$;

-- DROP took the old grants with it; only signed-in players may submit.
revoke all on function public.submit_score(uuid, text, integer, text, text, uuid) from public;
grant execute on function public.submit_score(uuid, text, integer, text, text, uuid) to authenticated;

commit;

-- ── check ───────────────────────────────────────────────────────────────────
-- What competitive spear now needs, against what the game can produce
-- (about 1.0 + 0.8 x (score - 1) seconds):
--
--   select s as score,
--          qte_min_seconds('spear-comp', s) as needs_seconds,
--          round(1.0 + 0.8 * (s - 1), 1)    as game_produces_seconds
--   from generate_series(1, 31) s;
--
-- needs_seconds must stay below game_produces_seconds at every row.
