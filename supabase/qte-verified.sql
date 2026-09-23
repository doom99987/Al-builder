-- QTE scores: verified runs
-- ============================================================================
-- Run this whole file in the Supabase SQL editor AFTER qte-scores.sql and
-- lockdown.sql. It is idempotent and only ADDS: the old submit_score keeps
-- working until qte-verified-step2.sql closes it.
--
-- WHY. submit_score trusted the number it was sent. Anyone signed in could
-- start a session in the console, wait out the time floor and post any score
-- under the cap (the owner did exactly that on 2026-09-22).
--
-- THE OWNER'S DESIGN
--   · Start: start_qte_run makes the run and a SECRET SEED for it. The seed
--     never leaves the database (qte_sessions has no API grant at all); the
--     browser gets a ticket signed with it (HMAC-SHA256 of run:user:trainer).
--   · Play: the trainer logs every target and every input (js/qte-rules.js).
--   · Submit: the browser sends ticket + log to the bright-service edge function,
--     which checks the log against the trainer's rules (same file) and calls
--     qte_accept_run with the result, as service_role. Only service_role can
--     call it, so a score can no longer be posted without passing the check.
--   · No ticket, a wrong ticket, a log that breaks the rules, or a log longer
--     than the run has existed: REJECTED, automatically.
--   · Too accurate / too fast for a person / too lucky (the edge function's
--     verdict 'review'), or far above the all-time record: HELD for an admin.
--   · Everything else is VALID and goes on the board by itself - new records
--     included. The admin only sees the unusual runs.
--
-- RUNBOOK (order matters)
--   1. this file
--   2. supabase functions deploy bright-service          (from the repo root)
--   3. push the site (js/qte-rules.js, js/qte.js, js/sb.js)
--   4. a day later, once the new pages are the ones in use:
--      supabase/qte-verified-step2.sql  (closes the old submit_score)
-- ============================================================================

begin;

-- pgcrypto is preinstalled on Supabase, in the extensions schema.
create extension if not exists pgcrypto with schema extensions;
do $$
begin
  if to_regprocedure('extensions.hmac(text,text,text)') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'pgcrypto is not in the extensions schema - run: create extension pgcrypto with schema extensions';
  end if;
end $$;

-- ── 1. the run: a secret seed, the attempts seen, the last submission ──────
alter table public.qte_sessions add column if not exists seed           text;
alter table public.qte_sessions add column if not exists last_attempt   integer not null default -1;
alter table public.qte_sessions add column if not exists last_submit_at timestamptz;
alter table public.qte_sessions add column if not exists rejects        integer not null default 0;

-- The ticket for a run. Internal: the definer functions below call it; no API
-- role may (it would hand out tickets for any seed it was given).
create or replace function public.qte_ticket(p_run uuid, p_user uuid, p_type text, p_seed text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(extensions.hmac(p_run::text || ':' || p_user::text || ':' || p_type, p_seed, 'sha256'), 'hex');
$$;
revoke all on function public.qte_ticket(uuid, uuid, text, text) from public, anon, authenticated;

-- ── 2. start a run ──────────────────────────────────────────────────────────
-- Returns { run, ticket } - never the seed. Same guards as start_qte_session:
-- identity from the JWT, trainer id shape, a purge of this player's idle
-- runs, and at most 60 starts a minute.
--
-- The purge counts from the last submission, not the start: fist and staff
-- restart by themselves under one Start, so a run can stay in play for hours.
-- (qte_log_prints is defined in section 4b below; the function body only
-- resolves it when it runs.)
create or replace function public.start_qte_run(p_qte_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
  v_seed text;
begin
  if v_user is null then return null; end if;
  if p_qte_type is null or length(p_qte_type) > 32
     or p_qte_type !~ '^[a-z]+(-new)?(-comp)?$' then return null; end if;

  -- Twelve hours: a log's times may run that long (QteRules.LIMITS.MAX_T),
  -- and a run in play submits only when its best improves.
  delete from qte_sessions
   where user_id = v_user and used = false
     and coalesce(last_submit_at, started_at) < now() - interval '12 hours';
  delete from qte_log_prints where at < now() - interval '90 days';

  if (select count(*) from qte_sessions
       where user_id = v_user and started_at > now() - interval '1 minute') >= 60 then
    return null;
  end if;

  v_seed := encode(extensions.gen_random_bytes(32), 'hex');
  insert into qte_sessions (user_id, qte_type, seed)
  values (v_user, p_qte_type, v_seed)
  returning id into v_id;

  return jsonb_build_object('run', v_id, 'ticket', public.qte_ticket(v_id, v_user, p_qte_type, v_seed));
end;
$$;
revoke all on function public.start_qte_run(text) from public, anon, authenticated;
grant execute on function public.start_qte_run(text) to authenticated;

-- (The old start_qte_session is left as it is - this file must not grant it
-- back after qte-verified-step2.sql has closed it. Its purge counts from the
-- start, so a player on an old page and a new one at once can lose a run in
-- play for over an hour; step 2 ends that.)

-- ── 3. what an admin sees on a held run ─────────────────────────────────────
-- detail: the edge function's reasons and numbers, and the run's log.
alter table public.score_reviews add column if not exists detail jsonb;

-- ── 4. rejected runs, for the owner to look at ──────────────────────────────
-- A real player's run should never land here; if one does, it is a rule to
-- loosen. Only runs with a valid ticket are recorded (junk without one is not
-- worth a row), at most 30 an hour per player, kept 30 days. Admins can read
-- it; nothing else can touch it.
create table if not exists public.qte_run_rejects (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  user_id   uuid not null,
  run_id    uuid,
  qte_type  text not null,
  claimed   integer,
  reasons   jsonb,
  stats     jsonb,
  rules_ver integer
);
create index if not exists qte_run_rejects_at on public.qte_run_rejects (at);
create index if not exists qte_run_rejects_user_at on public.qte_run_rejects (user_id, at);

do $$
declare
  r record;
begin
  alter table public.qte_run_rejects enable row level security;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'qte_run_rejects' loop
    execute format('drop policy %I on public.qte_run_rejects', r.policyname);
  end loop;
  revoke all on table public.qte_run_rejects from public, anon, authenticated;
  revoke all on sequence public.qte_run_rejects_id_seq from public, anon, authenticated;
end $$;
grant select on table public.qte_run_rejects to authenticated;
create policy qte_run_rejects_admin_read on public.qte_run_rejects for select to authenticated
  using (public.is_site_admin());

-- ── 4b. log fingerprints ────────────────────────────────────────────────────
-- The browser picks its own targets, so a log is not tied to the run it was
-- played in: an honest log could be sent again under a new ticket and pass
-- every check. The edge function hashes a log's first 24 events (targets AND
-- times, so two honest runs never share one) and the first run to post a
-- print owns it, kept 90 days. This stops a log sent again AS IT IS; it does
-- not stop one re-timed by hand (a millisecond changes the print) - that
-- would need the server to choose the targets, which the owner's design
-- (the seed stays on the server) rules out. Such a log still has to pass the
-- whole check and the run's clock.
create table if not exists public.qte_log_prints (
  print  text primary key,
  run_id uuid not null,
  at     timestamptz not null default now()
);
create index if not exists qte_log_prints_at on public.qte_log_prints (at);
do $$
declare
  r record;
begin
  alter table public.qte_log_prints enable row level security;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'qte_log_prints' loop
    execute format('drop policy %I on public.qte_log_prints', r.policyname);
  end loop;
  revoke all on table public.qte_log_prints from public, anon, authenticated;
end $$;

-- ── 5. posting a score (shared) ─────────────────────────────────────────────
-- Everything after "this run is genuine": the ban check, the hold, and the
-- three writes. Internal: only the definer functions call it.
-- p_review: a reason to hold (from the edge function), or null.
create or replace function public._qte_post_verified(
  p_user     uuid,
  p_qte_type text,
  p_score    integer,
  p_platform text,
  p_review   text,
  p_detail   jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month  text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_record integer;
  v_reason text := p_review;
  v_new    boolean;
begin
  if p_score is null or p_score <= 0 then return 'rejected'; end if;

  -- Banned: by id, and by either name an old ban row may carry (as submit_score).
  if exists (select 1 from perma_banned_usernames where user_id = p_user)
     or exists (select 1 from banned_usernames where user_id = p_user)
     or exists (select 1 from banned_usernames b join profiles p on p.username = b.username where p.id = p_user)
     or exists (select 1 from banned_usernames b join auth.users u
                  on u.raw_user_meta_data->>'username' = b.username where u.id = p_user)
  then return 'banned'; end if;

  -- Too high: well past the all-time record (half again and at least 5 more),
  -- or over 50 on a trainer with no record yet. A verified run that merely
  -- beats the record posts by itself.
  select r.score into v_record from leaderboard_records r where r.qte_type = p_qte_type;
  if v_reason is null then
    if v_record is null and p_score > 50 then
      v_reason := 'no record yet on this trainer, and above 50';
    elsif v_record is not null and p_score > greatest(ceil(v_record * 1.5)::integer, v_record + 5) then
      v_reason := 'far above the all-time record (' || v_record || ')';
    end if;
  end if;

  if v_reason is not null then
    insert into score_reviews (user_id, qte_type, score, platform, score_month, reason, detail)
    values (p_user, p_qte_type, p_score, p_platform, v_month, left(v_reason, 500), p_detail)
    on conflict (user_id, qte_type) where status = 'pending'
    do update set score       = greatest(score_reviews.score, excluded.score),
                  platform    = case when excluded.score > score_reviews.score then excluded.platform    else score_reviews.platform    end,
                  score_month = case when excluded.score > score_reviews.score then excluded.score_month else score_reviews.score_month end,
                  reason      = case when excluded.score > score_reviews.score then excluded.reason      else score_reviews.reason      end,
                  detail      = case when excluded.score > score_reviews.score then excluded.detail      else score_reviews.detail      end,
                  submitted_at = now()
    returning (xmax = 0) into v_new;
    -- Ring the admins once per held run, not once per point of it.
    if v_new and to_regclass('public.notifications') is not null and to_regproc('public.site_admin_ids') is not null then
      insert into notifications (user_id, title, body, meta)
      select a, 'Score held for review',
             coalesce((select p.username from profiles p where p.id = p_user), 'A player') || ': ' || p_score || ' on ' || p_qte_type || ' - ' || left(v_reason, 200),
             jsonb_build_object('type', 'score_review', 'qte_type', p_qte_type, 'score', p_score)
        from unnest(public.site_admin_ids()) as a
       where exists (select 1 from auth.users u where u.id = a);
    end if;
    return 'held';
  end if;

  insert into leaderboard (user_id, qte_type, score, platform, score_month)
  values (p_user, p_qte_type, p_score, p_platform, v_month)
  on conflict (user_id, qte_type, platform, score_month)
  do update set score = greatest(leaderboard.score, excluded.score);

  insert into leaderboard_records (qte_type, score, platform, user_id)
  values (p_qte_type, p_score, p_platform, p_user)
  on conflict (qte_type) do update
    set score = excluded.score, platform = excluded.platform, user_id = excluded.user_id
  where excluded.score > leaderboard_records.score;

  insert into personal_bests (user_id, qte_type, score, platform, updated_at)
  values (p_user, p_qte_type, p_score, p_platform, now())
  on conflict (user_id, qte_type) do update
    set score = excluded.score, platform = excluded.platform, updated_at = now()
  where excluded.score > personal_bests.score;

  return 'ok';
end;
$$;
revoke all on function public._qte_post_verified(uuid, text, integer, text, text, jsonb) from public, anon, authenticated;

-- ── 6. accept a checked run (edge function only) ────────────────────────────
-- Called by supabase/functions/bright-service with the service_role key, after
-- QteRules.check(). Re-checks what only the database knows: that the run is
-- this player's, for this trainer, that the ticket was signed with ITS seed,
-- and that the log does not claim more time than the run has existed.
--
-- p_score:   the points the log proves; the claim p_claimed can only lower it.
-- p_verdict: 'valid' or 'review' ('invalid' never reaches here).
-- p_print:   sha-256 of the log's first 24 events (null for a shorter log).
-- p_ticket_at: the log's clock when the ticket arrived (see the clock check).
-- Returns: 'ok' | 'held' | 'rejected' | 'stale' | 'banned' | 'bad_input'
-- (Older versions are dropped first: a changed signature is a second
-- function, which would keep its grants.)
drop function if exists public.qte_accept_run(uuid, uuid, text, text, text, integer, integer, integer, bigint, text, jsonb, jsonb, jsonb, integer);
drop function if exists public.qte_accept_run(uuid, uuid, text, text, text, integer, integer, integer, bigint, text, jsonb, jsonb, jsonb, integer, text);
create or replace function public.qte_accept_run(
  p_user      uuid,
  p_run       uuid,
  p_ticket    text,
  p_qte_type  text,
  p_platform  text,
  p_attempt   integer,
  p_claimed   integer,
  p_score     integer,
  p_end_ms    bigint,
  p_verdict   text,
  p_reasons   jsonb,
  p_stats     jsonb,
  p_log       jsonb,
  p_rules_ver integer,
  p_print     text,
  p_ticket_at integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s         qte_sessions%rowtype;
  v_elapsed numeric;
  v_score   integer;
  v_review  text;
  v_owner   uuid;
begin
  if p_user is null or p_run is null or p_ticket is null then return 'rejected'; end if;
  if p_qte_type is null or p_qte_type !~ '^[a-z]+(-new)?(-comp)?$' then return 'bad_input'; end if;
  if p_platform is null or p_platform not in ('M', 'C') then return 'bad_input'; end if;
  if p_verdict is null or p_verdict not in ('valid', 'review') then return 'rejected'; end if;

  select * into s from qte_sessions where id = p_run for update;
  if not found or s.user_id <> p_user or s.used or s.qte_type <> p_qte_type then return 'rejected'; end if;
  -- An old-style session has no seed: it was never authorised for this path.
  if s.seed is null or p_ticket <> public.qte_ticket(s.id, s.user_id, s.qte_type, s.seed) then return 'rejected'; end if;

  -- The log's clock runs from the Start click, before the server made the
  -- run: by the time the ticket reached the browser (p_ticket_at, the log's
  -- clock then; at most a minute is believed) plus 3 s. A log longer than
  -- the run has existed was not played in it.
  v_elapsed := extract(epoch from (now() - s.started_at)) * 1000;
  if p_end_ms is null or p_end_ms < 0
     or p_end_ms > v_elapsed + least(greatest(coalesce(p_ticket_at, 0), 0), 60000) + 3000 then return 'rejected'; end if;

  -- A late retry from an attempt the run has moved past is not an error.
  if p_attempt is null or p_attempt < s.last_attempt then return 'stale'; end if;

  -- A log another run already posted (4b) was not played in this one.
  if p_print is not null then
    if p_print !~ '^[0-9a-f]{64}$' then return 'bad_input'; end if;
    insert into qte_log_prints (print, run_id) values (p_print, p_run) on conflict (print) do nothing;
    select run_id into v_owner from qte_log_prints where print = p_print;
    if v_owner is distinct from p_run then return 'rejected'; end if;
  end if;

  update qte_sessions
     set last_attempt = greatest(last_attempt, p_attempt), last_submit_at = now()
   where id = s.id;

  v_score := least(coalesce(p_claimed, 0), coalesce(p_score, 0));
  if v_score <= 0 then return 'rejected'; end if;

  if p_verdict = 'review' then
    select 'verified run held: ' || string_agg(x, '; ')
      into v_review
      from (select jsonb_array_elements_text(coalesce(p_reasons, '[]'::jsonb)) as x limit 5) q;
    v_review := coalesce(v_review, 'verified run held for review');
  end if;

  return public._qte_post_verified(
    p_user, p_qte_type, v_score, p_platform, v_review,
    jsonb_build_object('claimed', p_claimed, 'proven', p_score, 'verdict', p_verdict,
                       'reasons', public.qte_short_reasons(p_reasons),
                       'stats', case when octet_length(coalesce(p_stats, 'null'::jsonb)::text) > 4096 then null else p_stats end,
                       'rules_ver', p_rules_ver, 'attempt', p_attempt, 'log', p_log));
end;
$$;
revoke all on function public.qte_accept_run(uuid, uuid, text, text, text, integer, integer, integer, bigint, text, jsonb, jsonb, jsonb, integer, text, integer) from public, anon, authenticated;
grant execute on function public.qte_accept_run(uuid, uuid, text, text, text, integer, integer, integer, bigint, text, jsonb, jsonb, jsonb, integer, text, integer) to service_role;

-- ── 7. record a rejected run (edge function only) ───────────────────────────
-- Only for a genuine ticket. The rejected ATTEMPT is closed (its later, longer
-- logs come back 'stale'); a trainer that restarts by itself goes on with its
-- next attempt. Five rejections close the whole run, so one ticket cannot be
-- used to try log after log.
--
-- What is stored is bounded whatever the edge function sends: 20 reasons of
-- 200 characters, stats up to 4 KB; at most 30 rows an hour per player (the
-- count is taken under a per-player lock, so parallel submits cannot pass it).
create or replace function public.qte_short_reasons(p jsonb) returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(left(x, 200)), '[]'::jsonb)
    from (select jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) as x limit 20) q;
$$;
revoke all on function public.qte_short_reasons(jsonb) from public, anon, authenticated;

drop function if exists public.qte_note_reject(uuid, uuid, text, text, integer, jsonb, jsonb, integer);
create or replace function public.qte_note_reject(
  p_user      uuid,
  p_run       uuid,
  p_ticket    text,
  p_qte_type  text,
  p_attempt   integer,
  p_claimed   integer,
  p_reasons   jsonb,
  p_stats     jsonb,
  p_rules_ver integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s qte_sessions%rowtype;
begin
  if p_user is null or p_run is null or p_ticket is null then return; end if;
  select * into s from qte_sessions where id = p_run for update;
  if not found or s.user_id <> p_user or s.seed is null
     or p_ticket <> public.qte_ticket(s.id, s.user_id, s.qte_type, s.seed) then return; end if;

  update qte_sessions
     set last_attempt = greatest(last_attempt, coalesce(p_attempt, 0) + 1),
         rejects      = rejects + 1,
         used         = used or rejects + 1 >= 5
   where id = s.id;

  perform pg_advisory_xact_lock(hashtext('qte_note_reject:' || p_user::text));
  delete from qte_run_rejects where at < now() - interval '30 days';
  if (select count(*) from qte_run_rejects where user_id = p_user and at > now() - interval '1 hour') >= 30 then return; end if;
  insert into qte_run_rejects (user_id, run_id, qte_type, claimed, reasons, stats, rules_ver)
  values (p_user, p_run, s.qte_type, p_claimed, public.qte_short_reasons(p_reasons),
          case when octet_length(coalesce(p_stats, 'null'::jsonb)::text) > 4096 then null else p_stats end, p_rules_ver);
end;
$$;
revoke all on function public.qte_note_reject(uuid, uuid, text, text, integer, integer, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.qte_note_reject(uuid, uuid, text, text, integer, integer, jsonb, jsonb, integer) to service_role;

notify pgrst, 'reload schema';

commit;

-- ── after running: checks ───────────────────────────────────────────────────
-- (a) the seed is unreadable from the API (expect: permission denied / 42501):
--       await _sbClient.from('qte_sessions').select('seed').limit(1)
-- (b) a start hands back a run and a ticket, and no seed:
--       await _sbClient.rpc('start_qte_run', { p_qte_type: 'dagger' })
-- (c) nobody but the edge function can accept a run (expect 42501):
--       await _sbClient.rpc('qte_accept_run', {})
-- (d) rejected runs, newest first - each one is a rule to look at:
--       select at, qte_type, claimed, reasons, stats from public.qte_run_rejects order by at desc limit 50;
