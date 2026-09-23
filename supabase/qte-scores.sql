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
--   5. (2026-09-22, owner's choice) The server cannot watch a run: anyone can
--      start a session, wait, and send a number. So the numbers that matter
--      are checked by a person. The cap is twice the trainer's all-time record
--      (never under 50). A score that would beat the record, or jump to the
--      monthly #1 at more than 1.5x the current #1, is HELD in score_reviews
--      instead of posted; admins are notified and approve or reject it in the
--      admin panel (admin_review_score). Ordinary climbing never waits.
-- ============================================================================

begin;

-- Has qte-verified-step2.sql closed the old score path? (It marks both
-- functions.) Remembered for this transaction: submit_score is dropped and
-- re-created below, which loses the mark, and neither may be granted again.
select set_config('alb.qte_legacy_closed',
  case when coalesce(obj_description(to_regprocedure('public.submit_score(uuid, text, integer, text, text, uuid)')::oid, 'pg_proc'), '')
            like 'closed by qte-verified-step2%' then 'on' else 'off' end, true);

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
do $$ begin
  if current_setting('alb.qte_legacy_closed', true) is distinct from 'on' then
    grant execute on function public.start_qte_session(uuid, text) to authenticated;
  end if;
end $$;

-- ── 2b. the cap: twice the trainer's all-time record, never under 50 ───────
-- The old qte_score_cap was dashboard-made with fixed numbers far above real
-- play (a 600 on dagger, where the record is 17, went straight through). This
-- one follows the record, so it rises as approved records do and never needs
-- editing. Every overload of the old one goes first (its signature is unknown).
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'qte_score_cap'
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

create function public.qte_score_cap(p_type text) returns integer
language sql
stable
set search_path = public
as $$
  select greatest(50, 2 * coalesce((select r.score from leaderboard_records r where r.qte_type = p_type), 0))::integer;
$$;
revoke all on function public.qte_score_cap(text) from public, anon, authenticated;

-- ── 2c. the review hold ─────────────────────────────────────────────────────
-- One pending row per player and trainer, carrying the best score of the run
-- that triggered it. Readable by its player (the site says "held") and by the
-- admins; written only by submit_score and admin_review_score.
create table if not exists public.score_reviews (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  qte_type     text not null,
  score        integer not null,
  platform     text not null,
  score_month  text not null,
  reason       text not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_by  uuid,
  reviewed_at  timestamptz
);
create unique index if not exists score_reviews_one_pending
  on public.score_reviews (user_id, qte_type) where status = 'pending';

do $$
declare
  r record;
begin
  alter table public.score_reviews enable row level security;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'score_reviews' loop
    execute format('drop policy %I on public.score_reviews', r.policyname);
  end loop;
  revoke all on table public.score_reviews from public, anon, authenticated;
end $$;
grant select on table public.score_reviews to authenticated;
create policy score_reviews_read on public.score_reviews for select to authenticated
  using (auth.uid() = user_id or public.is_site_admin());

-- An admin approves (the score is posted exactly as submit_score would have
-- posted it) or rejects (nothing is posted). The player is told either way.
-- p_score is the score the admin was SHOWN: a pending row keeps climbing while
-- its run goes on, and an approval must never post more than was looked at.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'admin_review_score'
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

create function public.admin_review_score(p_id uuid, p_approve boolean, p_score integer) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r score_reviews%rowtype;
begin
  if public.is_site_admin() is not true then raise exception 'admin only'; end if;
  select * into r from score_reviews where id = p_id and status = 'pending' for update;
  if not found then raise exception 'no pending score with that id'; end if;
  if p_approve and r.score is distinct from p_score then
    raise exception 'the score is now % - reload the list and look again', r.score;
  end if;
  if p_approve and (exists (select 1 from perma_banned_usernames b where b.user_id = r.user_id)
                    or exists (select 1 from banned_usernames b where b.user_id = r.user_id)) then
    raise exception 'that account has been banned since - reject it instead';
  end if;

  if p_approve then
    insert into leaderboard (user_id, qte_type, score, platform, score_month)
    values (r.user_id, r.qte_type, r.score, r.platform, r.score_month)
    on conflict (user_id, qte_type, platform, score_month)
    do update set score = greatest(leaderboard.score, excluded.score);

    insert into leaderboard_records (qte_type, score, platform, user_id)
    values (r.qte_type, r.score, r.platform, r.user_id)
    on conflict (qte_type) do update
      set score = excluded.score, platform = excluded.platform, user_id = excluded.user_id
    where excluded.score > leaderboard_records.score;

    insert into personal_bests (user_id, qte_type, score, platform, updated_at)
    values (r.user_id, r.qte_type, r.score, r.platform, now())
    on conflict (user_id, qte_type) do update
      set score = excluded.score, platform = excluded.platform, updated_at = now()
    where excluded.score > personal_bests.score;
  end if;

  update score_reviews
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  if to_regclass('public.notifications') is not null then
    insert into notifications (user_id, title, body, meta)
    values (r.user_id,
            case when p_approve then 'Your score was approved' else 'Your score was not approved' end,
            r.score || ' on ' || r.qte_type,
            jsonb_build_object('type', 'score_review', 'qte_type', r.qte_type, 'score', r.score, 'approved', p_approve));
  end if;
  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;
revoke all on function public.admin_review_score(uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.admin_review_score(uuid, boolean, integer) to authenticated;

-- The review hold asks "what is this month's best on this trainer" on every
-- submission; without this it scans the whole board each time.
create index if not exists leaderboard_type_month_score on public.leaderboard (qte_type, score_month, score desc);

-- ── 3. score submission ─────────────────────────────────────────────────────
-- The ban check below reads banned_usernames.user_id, which lockdown.sql adds;
-- added here too so this file works on its own, in either order.
alter table public.banned_usernames add column if not exists user_id uuid;

-- Returns one of: 'ok' | 'held' | 'no_session' | 'capped' | 'too_fast'
-- | 'wrong_user' | 'bad_input' | 'banned'.
-- js/sb.js retries 'no_session' with a fresh session, and stops retrying (and
-- tells the player) for 'capped', 'too_fast', 'bad_input' and 'banned', which
-- will never change for the score in hand. 'held' is taken (no retry): the
-- score waits in score_reviews for an admin. A client too old to read the
-- status ignores it and behaves exactly as before.
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
    v_record  INTEGER;
    v_top     INTEGER;
    v_reason  TEXT;
    v_new     BOOLEAN;
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

    -- Hard score cap: twice the trainer's record, never under 50 (2b above).
    -- COALESCE keeps it a cap even if the function ever answers NULL - a
    -- `p_score > NULL` is not TRUE and would skip the check entirely.
    IF p_score IS NULL OR p_score <= 0 THEN RETURN 'capped'; END IF;
    IF p_score > COALESCE(qte_score_cap(p_qte_type), 0) THEN RETURN 'capped'; END IF;

    -- Timing check - a higher score needs proportionally more elapsed time,
    -- so reusing the session across one run is safe. See qte_min_seconds for
    -- where each trainer's floor comes from.
    v_elapsed := EXTRACT(EPOCH FROM (now() - v_session.started_at));
    IF v_elapsed < qte_min_seconds(p_qte_type, p_score) THEN RETURN 'too_fast'; END IF;

    -- The review hold (2c above). A new all-time record always waits for an
    -- admin (a trainer with no record yet: anything over 10). So does a score
    -- more than half again above everyone ELSE's best this month (and at
    -- least 5 over it). Measured against other players, not the caller's own
    -- row: against their own row a made-up score could climb unheld in 1.5x
    -- steps, one call at a time.
    SELECT r.score INTO v_record FROM leaderboard_records r WHERE r.qte_type = p_qte_type;
    SELECT max(l.score) INTO v_top FROM leaderboard l
     WHERE l.qte_type = p_qte_type AND l.score_month = v_month AND l.user_id <> v_user;
    IF p_score > GREATEST(COALESCE(v_record, 0), CASE WHEN v_record IS NULL THEN 10 ELSE 0 END) THEN
      v_reason := 'new all-time record (record was ' || COALESCE(v_record::text, 'none') || ')';
    ELSIF v_top IS NOT NULL AND p_score > v_top * 1.5 AND p_score - v_top >= 5 THEN
      v_reason := 'far ahead of this month''s field (best of the others: ' || v_top || ')';
    END IF;
    IF v_reason IS NOT NULL THEN
      INSERT INTO score_reviews (user_id, qte_type, score, platform, score_month, reason)
      VALUES (v_user, p_qte_type, p_score, p_platform, v_month, v_reason)
      ON CONFLICT (user_id, qte_type) WHERE status = 'pending'
      DO UPDATE SET score = GREATEST(score_reviews.score, EXCLUDED.score),
                    platform = CASE WHEN EXCLUDED.score > score_reviews.score THEN EXCLUDED.platform ELSE score_reviews.platform END,
                    score_month = CASE WHEN EXCLUDED.score > score_reviews.score THEN EXCLUDED.score_month ELSE score_reviews.score_month END,
                    submitted_at = now()
      RETURNING (xmax = 0) INTO v_new;
      -- Ring the admins once per held run, not once per point of it.
      IF v_new AND to_regclass('public.notifications') IS NOT NULL AND to_regproc('public.site_admin_ids') IS NOT NULL THEN
        INSERT INTO notifications (user_id, title, body, meta)
        SELECT a, 'Score held for review',
               coalesce((SELECT p.username FROM profiles p WHERE p.id = v_user), 'A player') || ': ' || p_score || ' on ' || p_qte_type || ' - ' || v_reason,
               jsonb_build_object('type', 'score_review', 'qte_type', p_qte_type, 'score', p_score)
          FROM unnest(public.site_admin_ids()) AS a
         WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a);   -- a missing admin account must not fail the submit
      END IF;
      RETURN 'held';
    END IF;

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
--
-- Once qte-verified-step2.sql has run, scores go only through the bright-service
-- edge function: then this file leaves submit_score closed (and marked).
revoke all on function public.submit_score(uuid, text, integer, text, text, uuid) from public, anon, authenticated;
do $$ begin
  if current_setting('alb.qte_legacy_closed', true) is distinct from 'on' then
    grant execute on function public.submit_score(uuid, text, integer, text, text, uuid) to authenticated;
  else
    comment on function public.submit_score(uuid, text, integer, text, text, uuid) is 'closed by qte-verified-step2.sql';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- ── after running: records worth a look ─────────────────────────────────────
-- The cap is twice the record and the hold compares against the record, so a
-- made-up record weakens both. Look at each trainer's record and its holder:
--
--   select r.qte_type, r.score, p.username, r.platform
--     from public.leaderboard_records r left join public.profiles p on p.id = r.user_id
--    order by r.qte_type;
--
-- One you do not believe: clear that player's score on that trainer from the
-- admin panel (User Actions > clear one score). admin_clear_user_score passes
-- the record to the best remaining score on the board.

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
