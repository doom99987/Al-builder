-- Lock the score and ban tables, and put every admin action behind the database
-- ============================================================================
-- Run this whole file in the Supabase SQL editor. It is idempotent, and it does
-- not need to know what the dashboard-made policies currently say: it drops
-- every policy on the tables it covers and writes the ones it wants.
--
-- ORDER OF THE DAY - it matters:
--   1. supabase/qte-scores.sql  (submit_score learns to write personal_bests)
--   2. this file                (which takes that write away from the site)
--   3. the VERIFY queries at the end
--   4. push the site (js/sb.js ?v=114), then hard-reload before touching the
--      admin panel: a cached older panel writes the tables directly and would
--      be refused - and its unban button ignores the refusal and says
--      "unbanned" anyway.
--   5. section 5, by hand, once you have read its list.
-- The other way round (site first) leaves a window where nobody writes
-- personal_bests at all, and those bests are not recovered later.
--
-- BEFORE YOU RUN, two looks at things this file cannot see.
--
-- (i) Three dashboard-made functions keep their bodies here; only who may call
--     them changes. If one is SECURITY INVOKER and touches a table locked
--     below, it would start failing for every caller:
--
--   select proname, prosecdef as definer, left(prosrc, 300) as body
--     from pg_proc
--    where proname in ('delete_own_account', 'soft_delete_conversation', 'purge_expired_listings');
--
--     definer = true is what you want. If one is false and its body names
--     leaderboard, leaderboard_records, personal_bests or qte_sessions,
--     recreate it as `security definer set search_path = public` first.
--
-- (ii) The user_id columns must be uuid (they are, unless a table was made
--      with text ids by hand); otherwise the personal_bests policy below does
--      not compile and the whole file rolls back, harmlessly:
--
--   select table_name, column_name, data_type from information_schema.columns
--    where table_schema = 'public' and column_name = 'user_id'
--      and table_name in ('personal_bests', 'perma_banned_usernames', 'banned_usernames',
--                         'leaderboard', 'leaderboard_records', 'qte_sessions');
--
-- WHY. The owner showed two things from a browser console, signed in as an
-- ordinary account:
--
--   1. Scores written straight into the leaderboard, skipping submit_score and
--      its session-timing check.
--   2. Any account banned, perma-banned, or unbanned.
--
-- Both were the same mistake. The site's admin panel talked to the ban tables
-- directly (sb.from('banned_usernames').upsert(...)), guarded by isAdmin() in
-- js/sb.js, which is a check on the CLIENT: it decides whether to draw the
-- button, not whether the database accepts the write. For the database to
-- accept those writes from an admin, the tables had to accept them from every
-- signed-in user, and they did. The score tables were the same shape:
-- personal_bests was written by the client after each accepted score, so it
-- took writes from anyone, and nothing said the leaderboard tables were any
-- tighter.
--
-- WHAT CHANGES
--   1. Six tables become read-only through the API: leaderboard,
--      leaderboard_records, personal_bests, banned_usernames,
--      perma_banned_usernames, qte_sessions. No insert/update/delete policy
--      exists on any of them and the table privileges are revoked, so it takes
--      two separate mistakes to open them again. Only SECURITY DEFINER functions
--      write to them, and each of those checks who is calling.
--   2. Ban, unban, perma-ban and the profanity sweep are functions that refuse
--      anyone but a site admin, on the server. A ban now also locks the account
--      in Supabase Auth (banned_until) and ends its sessions, so it holds even
--      for a client that skips the site's own login check.
--   3. admin_clear_all_scores, admin_clear_user_score and admin_delete_listings
--      are recreated with the same admin check. purge_expired_listings is only
--      reachable through admin_purge_expired, which adds the check.
--   4. Every function here is revoked from PUBLIC and anon and granted back to
--      authenticated on purpose (see rpc-anon-lockout.sql for why a bare grant
--      is not a restriction).
--   5. Bans that already exist are NOT locked by this file (see section 5 for
--      why, and for the three statements that do it once you have looked).
--
-- WHAT IT DOES NOT DO. A score that arrives through submit_score with a real
-- session and a plausible elapsed time still cannot be told from a human run:
-- the trainers run in the browser, so the server only ever sees what the
-- browser reports. This file closes the doors that skipped that check; it does
-- not make the check itself smarter than time-per-point.
-- ============================================================================

begin;

-- ── 1. the admin list, in one place ─────────────────────────────────────────
-- testers.sql inlines the two UUIDs in is_site_admin(). The ban functions need
-- to ask the same question about a user who is NOT the caller (so an admin can
-- never be banned), so the list moves into a function of its own and
-- is_site_admin() reads it. Re-running testers.sql later would put the inline
-- version back, which answers the same for the caller, so nothing breaks.
--
-- These two are the only functions this file does not drop first: the RLS
-- policies on testers (testers.sql) and reports bind to is_site_admin() by
-- OID, and CREATE OR REPLACE with the same signature keeps it.
create or replace function public.site_admin_ids() returns uuid[]
language sql
immutable
as $$
  select array[
    'a508b4b7-1d32-4511-a609-4a80ded49681'::uuid,  -- Lycoris
    '3a376365-2f03-4e4f-8c5f-6b8020271809'::uuid   -- TheAgentsOfRoblox
  ];
$$;

-- SECURITY INVOKER, as testers.sql explains: auth.uid() reads the request's
-- JWT, so there is nothing to escalate. Which is also why site_admin_ids() is
-- granted to the API roles below - the RLS policies on testers evaluate this
-- function AS THE REQUEST ROLE, and a function that role may not execute inside
-- it fails the whole query with "permission denied".
--
-- coalesce: with no JWT, auth.uid() is NULL, `NULL = any(...)` is NULL, and a
-- plpgsql `if not NULL` does not branch (rpc-anon-lockout.sql, BUG 2). This
-- answers false, never NULL, and every guard below still says `is not true`.
create or replace function public.is_site_admin() returns boolean
language sql
stable
as $$
  select coalesce(auth.uid() = any (public.site_admin_ids()), false);
$$;

-- ── 2. the tables: read-only through the API ────────────────────────────────
-- Every policy on each table is dropped by name from pg_policies, so whatever
-- the dashboard made over the years goes, then the one policy each table needs
-- is created. The privileges are revoked as well: a policy only matters once
-- the role has the table privilege, so with both gone a future "for all using
-- (true)" policy added by hand would still not open the table on its own.
do $$
declare
  t text;
  r record;
begin
  foreach t in array array['leaderboard', 'leaderboard_records', 'personal_bests',
                           'banned_usernames', 'perma_banned_usernames', 'qte_sessions'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'table public.% does not exist', t;
    end if;
    execute format('alter table public.%I enable row level security', t);
    for r in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- The boards and the ban lists are public reading: the leaderboard page works
-- signed out, and the site filters banned names out of it client-side. (The
-- ids in the ban tables hide nothing - profiles maps every name to its id for
-- anyone who asks, and the site itself does exactly that.)
grant select on table public.leaderboard, public.leaderboard_records,
                      public.banned_usernames, public.perma_banned_usernames
  to anon, authenticated;

create policy leaderboard_read            on public.leaderboard            for select using (true);
create policy leaderboard_records_read    on public.leaderboard_records    for select using (true);
create policy banned_usernames_read       on public.banned_usernames       for select using (true);
create policy perma_banned_usernames_read on public.perma_banned_usernames for select using (true);

-- personal_bests is each player's own. The site reads only the signed-in
-- player's row (fetchMyBest in js/sb.js); the public boards are the two tables
-- above, so a visitor has no business with anyone's activity timestamps.
grant select on table public.personal_bests to authenticated;
create policy personal_bests_read on public.personal_bests for select using (auth.uid() = user_id);

-- qte_sessions gets no grant and no policy at all. start_qte_session and
-- submit_score reach it as their definer; nobody else has any business there.

-- A ban records who it was, not just what they were called at the time. The
-- perma table already carries user_id (the site reads it); the plain one may
-- not, depending on when it was made.
alter table public.banned_usernames       add column if not exists user_id uuid;
alter table public.perma_banned_usernames add column if not exists user_id uuid;

-- ── 3. this file's functions: dropped by name, then created ─────────────────
-- Every overload of every function defined below goes first - including the
-- dashboard-made admin_clear_all_scores / admin_clear_user_score /
-- admin_delete_listings, whose bodies this file cannot see - so what runs is
-- exactly what is written here, and a changed return type on a re-run is not
-- an error. (CREATE OR REPLACE refuses to change a return type.)
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname in ('lock_auth_user', 'user_id_for_username', 'check_ban_target',
                         'admin_ban_user', 'admin_perma_ban_user', 'admin_unban_user', 'admin_ban_usernames',
                         'rebuild_leaderboard_record', 'admin_clear_all_scores', 'admin_clear_user_score',
                         'admin_delete_listings', 'admin_purge_expired')
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

-- ── helpers (not callable from the API) ──
-- Lock or unlock the account in Supabase Auth. banned_until is what GoTrue
-- checks on every sign-in ("User is banned") and token refresh ("Invalid
-- Refresh Token: User Banned"), so a locked account cannot get a new session;
-- ending the current ones means the lock bites at the next refresh (an access
-- token already issued lives out its hour - submit_score checks the ban tables
-- too, so that hour buys nothing on the boards).
--
-- Not 'infinity': a far-future timestamp is what the Supabase dashboard itself
-- writes, and some drivers refuse to read an infinite one back. To lift it by
-- hand: Authentication > Users > the account > Unban, or
--   update auth.users set banned_until = null where id = '<uuid>';
--
-- Returns 'ok', 'no_account' (nothing in auth.users by that id - a reserved
-- name, or an account since deleted) or 'failed' (auth.users could not be
-- written; the reason goes to the Postgres log, Logs > Postgres, as a warning,
-- which is the only place it can go from inside a swallowed error). It never
-- raises: the ban row that called it must stand whatever Auth said.
create function public.lock_auth_user(p_user uuid, p_lock boolean) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then return 'no_account'; end if;
  if not exists (select 1 from auth.users where id = p_user) then return 'no_account'; end if;
  if p_lock then
    update auth.users set banned_until = now() + interval '100 years' where id = p_user;
    -- Ending the sessions is the nice-to-have; the lock above is the ban.
    begin
      delete from auth.sessions where user_id = p_user;   -- refresh tokens cascade
    exception when others then
      raise warning 'lock_auth_user(%, %): could not end sessions: %', p_user, p_lock, sqlerrm;
    end;
  else
    update auth.users set banned_until = null where id = p_user;
  end if;
  return 'ok';
exception when others then
  raise warning 'lock_auth_user(%, %): %', p_user, p_lock, sqlerrm;
  return 'failed';
end;
$$;

-- Who a username belongs to, for a ban that arrived without an id.
create function public.user_id_for_username(p_username text) returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from profiles where username = p_username limit 1;
$$;

-- The checks every ban shares. An id, when given, must be the account that
-- carries that name right now: the panel once sent the id of whichever user
-- its card showed together with the name of a different row, and a definer
-- function believes what it is told. Without an id the name is looked up, and
-- a name nobody has is banned as a name (reserved).
create function public.check_ban_target(p_username text, p_user_id uuid) returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := p_user_id;
begin
  if p_username is null or btrim(p_username) = '' then raise exception 'username required'; end if;
  if p_user_id is not null
     and not exists (select 1 from profiles where id = p_user_id and username = p_username) then
    raise exception '% is not the account that id belongs to', p_username;
  end if;
  if v_user is null then v_user := public.user_id_for_username(p_username); end if;
  if v_user = any (public.site_admin_ids()) then raise exception 'an admin cannot be banned'; end if;
  return v_user;
end;
$$;

-- ── 4. bans ─────────────────────────────────────────────────────────────────
-- Each returns a short status the panel shows:
--   'ok'               banned and the account is locked in Auth
--   'ok_no_account'    banned by name; there is no Auth account to lock (a
--                      reserved name, or an account since deleted)
--   'ok_no_auth_lock'  banned in the tables, but Auth did not take the lock -
--                      the site's login check still applies; the Postgres log
--                      says why, and Authentication > Users > Ban user does it
--                      by hand
-- and raises for anything that must not happen, so the panel shows the message.
create function public.admin_ban_user(p_username text, p_user_id uuid default null) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if public.is_site_admin() is not true then raise exception 'admin only'; end if;
  v_user := public.check_ban_target(p_username, p_user_id);

  insert into banned_usernames (username, user_id) values (p_username, v_user)
  on conflict (username) do update set user_id = coalesce(excluded.user_id, banned_usernames.user_id);

  return case public.lock_auth_user(v_user, true)
           when 'ok' then 'ok' when 'no_account' then 'ok_no_account' else 'ok_no_auth_lock' end;
end;
$$;

create function public.admin_perma_ban_user(p_username text, p_user_id uuid default null) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if public.is_site_admin() is not true then raise exception 'admin only'; end if;
  v_user := public.check_ban_target(p_username, p_user_id);

  -- Not ON CONFLICT: the table may or may not carry a unique index on username,
  -- and this must not depend on which. user_id IS unique there (one perma row
  -- per account), so a renamed account already in the table keeps its row and
  -- the new name goes in as a name alone - nobody can register it, and the
  -- account is already covered by id.
  if not exists (select 1 from perma_banned_usernames where username = p_username) then
    insert into perma_banned_usernames (username, user_id)
    values (p_username, case when exists (select 1 from perma_banned_usernames where user_id = v_user)
                             then null else v_user end);
  else
    update perma_banned_usernames set user_id = v_user
     where username = p_username and user_id is null
       and not exists (select 1 from perma_banned_usernames where user_id = v_user);
  end if;

  insert into banned_usernames (username, user_id) values (p_username, v_user)
  on conflict (username) do update set user_id = coalesce(excluded.user_id, banned_usernames.user_id);

  return case public.lock_auth_user(v_user, true)
           when 'ok' then 'ok' when 'no_account' then 'ok_no_account' else 'ok_no_auth_lock' end;
end;
$$;

-- A perma ban cannot be lifted here, by design (the panel says the same). Lift
-- it in the SQL editor by deleting the perma row first, then calling this.
-- Returns 'ok', or 'not_banned' when there was no row to remove (in which case
-- Auth is left alone).
create function public.admin_unban_user(p_username text) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  n      int;
begin
  if public.is_site_admin() is not true then raise exception 'admin only'; end if;
  if p_username is null or btrim(p_username) = '' then raise exception 'username required'; end if;
  if exists (select 1 from perma_banned_usernames where username = p_username) then
    raise exception '% is permanently banned', p_username;
  end if;

  select user_id into v_user from banned_usernames where username = p_username;
  delete from banned_usernames where username = p_username;
  get diagnostics n = row_count;
  if n = 0 then return 'not_banned'; end if;

  if v_user is null then v_user := public.user_id_for_username(p_username); end if;

  -- Unlock only an account with no ban of any kind still standing against it
  -- (another plain row under an old name, or a perma row).
  if v_user is not null
     and not exists (select 1 from banned_usernames       where user_id = v_user)
     and not exists (select 1 from perma_banned_usernames where user_id = v_user) then
    perform public.lock_auth_user(v_user, false);
  end if;
  return 'ok';
end;
$$;

-- The profanity sweep: the panel scans usernames and sends the list. Returns
-- the names it actually banned - an admin's name is skipped, whatever the
-- filter thought of it - so the panel reports what happened, not what it asked.
create function public.admin_ban_usernames(p_usernames text[]) returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  u      text;
  banned text[] := array[]::text[];
begin
  if public.is_site_admin() is not true then raise exception 'admin only'; end if;
  foreach u in array coalesce(p_usernames, array[]::text[]) loop
    if u is null or btrim(u) = '' then continue; end if;
    if public.user_id_for_username(u) = any (public.site_admin_ids()) then continue; end if;
    perform public.admin_ban_user(u, null);
    banned := banned || u;
  end loop;
  return banned;
end;
$$;

-- ── 5. bans that already exist: a step for the owner, not for this file ─────
-- Rows made before this file may carry no user_id, and their accounts were
-- never locked in Auth. This file does NOT lock them on its own: the perma
-- table's stored ids were written by the panel bug section 3 fixes (it could
-- send one account's id with another row's name), and the profanity sweep
-- matched substrings ('ass' catches Cassie), so an old row may name an innocent
-- account - and an Auth lock is not something to hand out on trust. Look, then
-- lock. AFTER this file has run:
--
--  (1) See who each existing row would lock. The site keyed old bans on the
--      SIGNUP name (auth.users.raw_user_meta_data->>'username'), which a
--      profile rename does not change, so both names are shown. A stored_id
--      that matches neither profile_id nor signup_id is the panel bug: fix or
--      delete that row by hand before going on.
--
--   select b.username, b.user_id as stored_id, p.id as profile_id, u.id as signup_id, 'plain' as kind
--     from public.banned_usernames b
--     left join public.profiles p on p.username = b.username
--     left join auth.users u on u.raw_user_meta_data->>'username' = b.username
--   union all
--   select b.username, b.user_id, p.id, u.id, 'perma'
--     from public.perma_banned_usernames b
--     left join public.profiles p on p.username = b.username
--     left join auth.users u on u.raw_user_meta_data->>'username' = b.username
--   order by 5, 1;
--
--  (2) Fill in the ids the rows are missing - by signup name first, then by
--      profile name. An account banned under two names (it renamed itself)
--      gets its id on ONE row per table: perma_banned_usernames.user_id is
--      unique, and the other name stays a name-only row, which is all it needs
--      to be.
--
--   update public.banned_usernames b set user_id = u.id from auth.users u
--    where b.user_id is null and u.raw_user_meta_data->>'username' = b.username
--      and not exists (select 1 from public.banned_usernames x where x.user_id = u.id);
--   update public.banned_usernames b set user_id = p.id from public.profiles p
--    where b.user_id is null and p.username = b.username
--      and not exists (select 1 from public.banned_usernames x where x.user_id = p.id);
--   update public.perma_banned_usernames b set user_id = u.id from auth.users u
--    where b.user_id is null and u.raw_user_meta_data->>'username' = b.username
--      and not exists (select 1 from public.perma_banned_usernames x where x.user_id = u.id);
--   update public.perma_banned_usernames b set user_id = p.id from public.profiles p
--    where b.user_id is null and p.username = b.username
--      and not exists (select 1 from public.perma_banned_usernames x where x.user_id = p.id);
--
--  (3) Lock every account a ban row now names - never an admin:
--
--   select user_id, public.lock_auth_user(user_id, true) as result
--     from (select user_id from public.banned_usernames       where user_id is not null
--           union
--           select user_id from public.perma_banned_usernames where user_id is not null) ids
--    where user_id <> all (public.site_admin_ids());
--
-- Until (2) runs, an old name-only ban holds where it always did: the site's
-- login check (by signup name), and submit_score (by profile name AND signup
-- name, qte-scores.sql). What (2)+(3) add is the Auth lock, and a ban that
-- follows the account through a rename.

-- ── 6. the other admin actions ──────────────────────────────────────────────
-- After a wipe, the all-time record for each affected trainer is rebuilt from
-- the best row still on the monthly board, so the crown passes on rather than
-- vanishing; if no row is left the record is simply gone until the next run.
create function public.rebuild_leaderboard_record(p_qte_type text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  best record;
begin
  delete from leaderboard_records where qte_type = p_qte_type;
  select user_id, score, platform into best
    from leaderboard where qte_type = p_qte_type
   order by score desc limit 1;
  if found then
    insert into leaderboard_records (qte_type, score, platform, user_id)
    values (p_qte_type, best.score, best.platform, best.user_id);
  end if;
end;
$$;

create function public.admin_clear_all_scores(p_user_id uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  n integer;
begin
  if public.is_site_admin() is not true then raise exception 'admin only'; end if;
  if p_user_id is null then raise exception 'user id required'; end if;
  delete from leaderboard where user_id = p_user_id;
  get diagnostics n = row_count;
  delete from personal_bests where user_id = p_user_id;
  for t in select qte_type from leaderboard_records where user_id = p_user_id loop
    perform public.rebuild_leaderboard_record(t.qte_type);
  end loop;
  return n;
end;
$$;

create function public.admin_clear_user_score(p_user_id uuid, p_qte_type text) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if public.is_site_admin() is not true then raise exception 'admin only'; end if;
  if p_user_id is null or p_qte_type is null then raise exception 'user id and trainer required'; end if;
  delete from leaderboard where user_id = p_user_id and qte_type = p_qte_type;
  get diagnostics n = row_count;
  delete from personal_bests where user_id = p_user_id and qte_type = p_qte_type;
  if exists (select 1 from leaderboard_records where user_id = p_user_id and qte_type = p_qte_type) then
    perform public.rebuild_leaderboard_record(p_qte_type);
  end if;
  return n;
end;
$$;

create function public.admin_delete_listings(p_username text) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if public.is_site_admin() is not true then raise exception 'admin only'; end if;
  if p_username is null then raise exception 'username required'; end if;
  delete from trade_listings where username = p_username;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- purge_expired_listings keeps its dashboard-made body (it is only ever asked
-- to delete records that have expired); what changes is that only this wrapper
-- can reach it, and the wrapper asks who is calling.
create function public.admin_purge_expired() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_site_admin() is not true then raise exception 'admin only'; end if;
  if to_regproc('public.purge_expired_listings') is null then
    raise exception 'purge_expired_listings() does not exist';
  end if;
  perform public.purge_expired_listings();
end;
$$;

-- ── 7. grants: nothing by default, then exactly what the site calls ─────────
-- Every function above was created with EXECUTE granted to PUBLIC, because that
-- is what Postgres does. Take it away from every overload of every function
-- named here - including the dashboard-made ones this file did not rewrite -
-- and hand it back one role at a time.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname in (
         -- this file
         'site_admin_ids', 'is_site_admin', 'lock_auth_user', 'user_id_for_username', 'check_ban_target',
         'admin_ban_user', 'admin_perma_ban_user', 'admin_unban_user', 'admin_ban_usernames',
         'rebuild_leaderboard_record', 'admin_clear_all_scores', 'admin_clear_user_score',
         'admin_delete_listings', 'admin_purge_expired',
         -- dashboard-made, reached only through a definer or by signed-in users
         'purge_expired_listings', 'delete_own_account', 'soft_delete_conversation',
         'qte_score_cap', 'qte_min_seconds', 'start_qte_session', 'submit_score')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- What a signed-in user may call. The admin_* functions check for an admin
-- inside; an ordinary account calling one gets "admin only" and nothing else.
grant execute on function public.admin_ban_user(text, uuid)         to authenticated;
grant execute on function public.admin_perma_ban_user(text, uuid)   to authenticated;
grant execute on function public.admin_unban_user(text)             to authenticated;
grant execute on function public.admin_ban_usernames(text[])        to authenticated;
grant execute on function public.admin_clear_all_scores(uuid)       to authenticated;
grant execute on function public.admin_clear_user_score(uuid, text) to authenticated;
grant execute on function public.admin_delete_listings(text)        to authenticated;
grant execute on function public.admin_purge_expired()              to authenticated;
grant execute on function public.start_qte_session(uuid, text)      to authenticated;
grant execute on function public.submit_score(uuid, text, integer, text, text, uuid) to authenticated;

-- is_site_admin and site_admin_ids must stay executable by anon and
-- authenticated: the RLS policies on testers (and reports) call is_site_admin()
-- as the request role, is_site_admin is SECURITY INVOKER, and that role must be
-- allowed to execute what it calls. It answers false for anon, which is the
-- point. (The client itself uses its own ADMIN_IDS list, js/sb.js, and never
-- calls either; the two UUIDs are already in that file.)
grant execute on function public.is_site_admin()  to anon, authenticated;
grant execute on function public.site_admin_ids() to anon, authenticated;

-- Self-service functions with bodies made in the dashboard: signed-in only.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname in ('delete_own_account', 'soft_delete_conversation')
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- lock_auth_user, user_id_for_username, check_ban_target,
-- rebuild_leaderboard_record, purge_expired_listings, qte_score_cap,
-- qte_min_seconds: deliberately granted to nobody. They run only inside
-- definer functions, which execute as their owner and need no grant (and the
-- SQL editor, as the owner, may call lock_auth_user for section 5).

notify pgrst, 'reload schema';

commit;

-- ── VERIFY - run each, read the output ──────────────────────────────────────
-- (a) Nothing but a SELECT policy on the six tables:
--
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public'
--      and tablename in ('leaderboard','leaderboard_records','personal_bests',
--                        'banned_usernames','perma_banned_usernames','qte_sessions')
--    order by 1, 2;
--
--   Expect five rows, all cmd = SELECT, and none for qte_sessions.
--
-- (b) No write privilege for the API roles on those tables:
--
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('leaderboard','leaderboard_records','personal_bests',
--                         'banned_usernames','perma_banned_usernames','qte_sessions')
--      and grantee in ('anon','authenticated')
--    order by 1, 2, 3;
--
--   Expect nine rows, all SELECT: anon + authenticated on four tables, and
--   authenticated alone on personal_bests. None for qte_sessions.
--
-- (c) What anon can still execute. Trigger functions are left out - PostgREST
--     cannot call them. Expect is_site_admin, site_admin_ids, ping_online and
--     top_supporters; anything else in the list is reachable by anyone on the
--     internet and needs a revoke:
--
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prokind = 'f'
--      and p.prorettype <> 'trigger'::regtype
--      and has_function_privilege('anon', p.oid, 'execute')
--    order by 1;
--
-- (d) The same for a signed-in account. Every row is a function any account
--     may call; the ones that write the locked tables must all check who is
--     calling (submit_score / start_qte_session take their identity from the
--     JWT, the admin_* ones refuse non-admins):
--
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prokind = 'f'
--      and p.prorettype <> 'trigger'::regtype
--      and has_function_privilege('authenticated', p.oid, 'execute')
--    order by 1;
--
-- (e) Any OTHER definer function that writes a locked table - an old monthly
--     reset, an old ban helper - is a door this file does not know about.
--     Expect only names from this file and qte-scores.sql:
--
--   select p.proname
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef
--      and p.prosrc ~* 'leaderboard|personal_bests|banned_usernames|qte_sessions'
--    order by 1;
--
-- (f) From the site, signed in as a NON-admin, in the console:
--
--   await _sbClient.rpc('admin_ban_user', { p_username: 'anyone' })
--     -> error.message 'admin only'
--   await _sbClient.from('leaderboard').insert({ user_id: (await _sbClient.auth.getUser()).data.user.id,
--     qte_type: 'fist', score: 999, platform: 'C', score_month: '2026-09' })
--     -> error.code '42501' (permission denied)
--   await _sbClient.from('banned_usernames').delete().eq('username', 'anyone')
--     -> error.code '42501'
--   await _sbClient.from('testers').select('user_id')
--     -> data [] and NO error (the is_site_admin / site_admin_ids grants hold)
