-- Admins: decided by the server, listed nowhere a browser can read
-- ============================================================================
-- Run this whole file in the Supabase SQL editor. It is idempotent.
--
-- WHY (owner, 2026-09-22). js/sb.js carried the admin user IDs in plain
-- sight, and the site decided "is this an admin" from that list. Anyone could
-- read the IDs, and anyone could edit their copy of sb.js (browser dev tools,
-- local overrides) to put themselves on the list and open the admin panel.
-- The database also handed the list out: site_admin_ids() was callable by
-- anyone, signed in or not.
--
-- WHAT CHANGES
--   1. The admin list lives in public.site_admins - a table with no API grant
--      and no policy, so no browser can read it. Nothing in the repo names an
--      admin any more; the first run carries over whoever the old
--      site_admin_ids() listed.
--   2. is_site_admin() answers for the CALLER only (from their login token),
--      and is now the only admin question the API will answer. The site asks
--      it at sign-in and again before opening the admin panel.
--      site_admin_ids() is no longer callable from the API at all.
--   3. New reports notify the admins from the database (a trigger), so the
--      browser never needs to know who they are.
--
-- WHAT A FAKED ADMIN FLAG GETS. A player who edits the site's code can still
-- make their own browser DRAW the admin panel - no website can stop that. What
-- it shows them is only what the database answers them, which is what any
-- player can already read: every admin action is an admin_* function that
-- checks is_site_admin() on the server, and the admin-only tables (reports,
-- score_reviews, testers, qte_run_rejects, site_admins) answer them with
-- nothing.
--
-- TO ADD OR REMOVE AN ADMIN (SQL editor only):
--   insert into public.site_admins (user_id, note) values ('<uuid>', '<name>');
--   delete from public.site_admins where user_id = '<uuid>';
-- (An account's id: select id, username from public.profiles where username = '<name>';)
-- ============================================================================

begin;

-- ── 1. the list ─────────────────────────────────────────────────────────────
create table if not exists public.site_admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  note     text
);
-- RLS on and no policy: the API roles see and change nothing, whatever grants
-- a project's defaults hand out.
alter table public.site_admins enable row level security;
revoke all on table public.site_admins from public, anon, authenticated;

-- First run: carry over the accounts the old function listed, so this file
-- names nobody itself.
do $$
declare
  v_old uuid[];
begin
  if not exists (select 1 from public.site_admins) and to_regprocedure('public.site_admin_ids()') is not null then
    execute 'select public.site_admin_ids()' into v_old;
    insert into public.site_admins (user_id, note)
    select distinct a, 'carried over from site_admin_ids()'
      from unnest(coalesce(v_old, '{}'::uuid[])) as a
     where exists (select 1 from auth.users u where u.id = a)
    on conflict do nothing;
  end if;
  if not exists (select 1 from public.site_admins) then
    raise exception 'public.site_admins is empty - add the admin accounts first: insert into public.site_admins (user_id) values (''<uuid>'');';
  end if;
end $$;

-- ── 2. the questions ────────────────────────────────────────────────────────
-- Both read the table as its owner (SECURITY DEFINER), so the caller needs no
-- right to the list. CREATE OR REPLACE keeps each function's OID, which the
-- RLS policies on testers, reports and the lockdown2 tables are bound to.
--
-- site_admin_ids(): for the database's own functions (the ban guard, the
-- score-hold notifications, the GDPR erase). Not callable from the API.
create or replace function public.site_admin_ids() returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(user_id order by user_id), '{}'::uuid[]) from public.site_admins;
$$;
revoke all on function public.site_admin_ids() from public, anon, authenticated;

-- is_site_admin(): "am I an admin?", for the caller's own login only. The RLS
-- policies call it as the request role, so anon and authenticated keep
-- EXECUTE. coalesce: no login means false, never NULL (every guard says
-- `is not true` anyway).
create or replace function public.is_site_admin() returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (select 1 from public.site_admins where user_id = auth.uid()), false);
$$;
revoke all on function public.is_site_admin() from public;
grant execute on function public.is_site_admin() to anon, authenticated;

-- ── 3. reports ring the admins from here ────────────────────────────────────
-- The site used to insert one notification per admin id itself - which meant
-- the page had to carry the ids. The names come from the row as stored (the
-- lockdown2 stamps have already replaced whatever the reporter typed).
do $$
begin
  if to_regclass('public.reports') is null then return; end if;

  execute $f$
    create or replace function public.reports_notify_admins() returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    begin
      if to_regclass('public.notifications') is null then return new; end if;
      insert into notifications (user_id, title, body, meta)
      select a.user_id,
             left('New report: ' || coalesce(new.reporter_name, 'Someone') || ' reported ' || coalesce(new.reported_name, 'a player'), 200),
             left(coalesce(new.reason, '') || coalesce(' - ' || new.detail, ''), 500),
             jsonb_build_object('type', 'report', 'reported_id', new.reported_id, 'reason', new.reason)
        from public.site_admins a
       where a.user_id is distinct from new.reporter_id
         and exists (select 1 from auth.users u where u.id = a.user_id);
      return new;
    end;
    $body$;
  $f$;
  revoke all on function public.reports_notify_admins() from public, anon, authenticated;

  drop trigger if exists reports_notify_admins on public.reports;
  create trigger reports_notify_admins after insert on public.reports
    for each row execute function public.reports_notify_admins();
end $$;

notify pgrst, 'reload schema';

commit;

-- ── after running: checks (browser console, signed in as a NON-admin) ───────
--   await _sbClient.rpc('site_admin_ids')                 -> error (permission denied / not found)
--   await _sbClient.from('site_admins').select('*')       -> error 42501, or []
--   await _sbClient.rpc('is_site_admin')                  -> { data: false }
-- and signed in as an admin:
--   await _sbClient.rpc('is_site_admin')                  -> { data: true }
