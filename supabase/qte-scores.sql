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
--   4. (with supabase/lockdown.sql) submit_score also writes personal_bests,
--      files the score under the SERVER's month, checks the shape of the
--      trainer id and platform, and refuses a banned account. The client wrote
--      personal_bests itself before, which meant the table took writes from
--      anyone; lockdown.sql makes all the score tables read-only through the API.
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

    -- A trainer id is letters with an optional -new and -comp (QTE_TYPES in
    -- js/sb.js). Anything else is not a trainer and only fills the table.
    IF p_qte_type IS NULL OR length(p_qte_type) > 32
       OR p_qte_type !~ '^[a-z]+(-new)?(-comp)?$' THEN RETURN NULL; END IF;

    -- Purge this player's stale sessions, whatever the trainer, so the table
    -- holds at most an hour of them per account ...
    DELETE FROM qte_sessions
    WHERE user_id = v_user AND used = false AND started_at < now() - INTERVAL '1 hour';

    -- ... and an hour of them is bounded. A run needs a Start, and nobody
    -- starts sixty runs in a minute by hand; a loop in a console does. A
    -- refused session costs that caller the run's scores, which no real player
    -- ever reaches.
    IF (SELECT count(*) FROM qte_sessions
         WHERE user_id = v_user AND started_at > now() - INTERVAL '1 minute') >= 60 THEN
      RETURN NULL;
    END IF;

    INSERT INTO qte_sessions (user_id, qte_type)
    VALUES (v_user, p_qte_type) RETURNING id INTO v_id;
    RETURN v_id;
  END;
$function$;

-- create or replace keeps an existing function's grants, but a fresh create
-- hands EXECUTE to PUBLIC; revoke either way, then grant on purpose.
revoke all on function public.start_qte_session(uuid, text) from public, anon, authenticated;
grant execute on function public.start_qte_session(uuid, text) to authenticated;

-- ── 3. score submission ─────────────────────────────────────────────────────
-- The ban check below reads banned_usernames.user_id, which lockdown.sql adds;
-- added here too so this file works on its own, in either order.
alter table public.banned_usernames add column if not exists user_id uuid;

-- Returns one of: 'ok' | 'no_session' | 'capped' | 'too_fast' | 'wrong_user'
-- | 'bad_input' | 'banned'.
-- js/sb.js retries 'no_session' with a fresh session, and stops retrying (and
-- tells the player) for 'capped', 'too_fast', 'bad_input' and 'banned', which
-- will never change for the score in hand. A client too old to read the status
-- ignores it and behaves exactly as before.
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
    -- The month is the server's, not the caller's. p_month is what the client
    -- believes, and a client can believe anything: next month, to seed a board
    -- before it opens, or a month long gone. Same clock and format as
    -- currentMonth() in js/sb.js, so the site reads back the row this wrote.
    v_month   TEXT := to_char(now() at time zone 'UTC', 'YYYY-MM');
  BEGIN
    IF v_user IS NULL THEN RETURN 'no_session'; END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> v_user THEN RETURN 'wrong_user'; END IF;

    -- The shape of the rest. A trainer id is letters with an optional -new and
    -- -comp (QTE_TYPES in js/sb.js); a platform is M or C. Anything else is not
    -- a run and would only litter the board with rows no page shows.
    IF p_qte_type IS NULL OR p_qte_type !~ '^[a-z]+(-new)?(-comp)?$' THEN RETURN 'bad_input'; END IF;
    IF p_platform IS NULL OR p_platform NOT IN ('M', 'C') THEN RETURN 'bad_input'; END IF;

    -- A banned account keeps an access token for up to an hour after the ban
    -- lands (supabase/lockdown.sql, lock_auth_user). It does not keep the
    -- boards. By id first: a ban by name alone is one profile rename away from
    -- not matching, and a rename is a plain profiles update. Then by the two
    -- names an old row can carry: the profile name, and the SIGNUP name
    -- (user_metadata.username), which is what the site's own login check has
    -- always compared and which a rename does not change.
    IF EXISTS (SELECT 1 FROM perma_banned_usernames WHERE user_id = v_user)
       OR EXISTS (SELECT 1 FROM banned_usernames WHERE user_id = v_user)
       OR EXISTS (SELECT 1 FROM banned_usernames b JOIN profiles p ON p.username = b.username WHERE p.id = v_user)
       OR EXISTS (SELECT 1 FROM banned_usernames b JOIN auth.users u
                    ON u.raw_user_meta_data->>'username' = b.username WHERE u.id = v_user)
    THEN RETURN 'banned'; END IF;

    -- Validate the session - but DO NOT consume it. One run submits each new
    -- high (streak 1,2,3...), so the same session must cover all of them, and
    -- the elapsed-time check below is timed from when that run started.
    SELECT * INTO v_session FROM qte_sessions
    WHERE id = p_session_id AND user_id = v_user
      AND qte_type = p_qte_type AND used = false;
    IF NOT FOUND THEN RETURN 'no_session'; END IF;

    -- Hard score cap. qte_score_cap is dashboard-made; if it answers NULL for a
    -- trainer it does not know, `p_score > NULL` is not TRUE and the cap would
    -- be skipped - so an unknown trainer's cap is 0 and every score is over it.
    IF p_score IS NULL OR p_score <= 0 THEN RETURN 'capped'; END IF;
    IF p_score > COALESCE(qte_score_cap(p_qte_type), 0) THEN RETURN 'capped'; END IF;

    -- Timing check - a higher score needs proportionally more elapsed time,
    -- so reusing the session across one run is safe. See qte_min_seconds for
    -- where each trainer's floor comes from.
    v_elapsed := EXTRACT(EPOCH FROM (now() - v_session.started_at));
    IF v_elapsed < qte_min_seconds(p_qte_type, p_score) THEN RETURN 'too_fast'; END IF;

    -- Monthly leaderboard: one row per user and platform, only ever climbs
    INSERT INTO leaderboard (user_id, qte_type, score, platform, score_month)
    VALUES (v_user, p_qte_type, p_score, p_platform, v_month)
    ON CONFLICT (user_id, qte_type, platform, score_month)
    DO UPDATE SET score = GREATEST(leaderboard.score, EXCLUDED.score);

    -- All-time record
    INSERT INTO leaderboard_records (qte_type, score, platform, user_id)
    VALUES (p_qte_type, p_score, p_platform, v_user)
    ON CONFLICT (qte_type) DO UPDATE
      SET score = EXCLUDED.score, platform = EXCLUDED.platform, user_id = EXCLUDED.user_id
    WHERE EXCLUDED.score > leaderboard_records.score;

    -- Personal best, in the same call as the score it belongs to. The client
    -- wrote this table itself after each accepted score; lockdown.sql took
    -- that away, since a table the client can write is a table anyone can.
    INSERT INTO personal_bests (user_id, qte_type, score, platform, updated_at)
    VALUES (v_user, p_qte_type, p_score, p_platform, now())
    ON CONFLICT (user_id, qte_type) DO UPDATE
      SET score = EXCLUDED.score, platform = EXCLUDED.platform, updated_at = now()
    WHERE EXCLUDED.score > personal_bests.score;

    RETURN 'ok';
  END;
$function$;

-- DROP took the old grants with it and CREATE handed EXECUTE to PUBLIC; only
-- signed-in players may submit. anon and authenticated are named as well as
-- public, in case the project's default privileges grant them explicitly.
revoke all on function public.submit_score(uuid, text, integer, text, text, uuid) from public, anon, authenticated;
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
