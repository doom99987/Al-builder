-- ---------------------------------------------------------------------------
-- testers - accounts that can open the AI build panel
-- ---------------------------------------------------------------------------
-- A tester gets exactly ONE thing an ordinary account does not: the AI panel.
-- No admin panel, no reports, no moderation, no elevated read or write of any
-- kind. Everything else in the site still asks isAdmin().
--
-- This lives in the database rather than in a list in js/sb.js because admins
-- grant it from the admin panel. RLS is what makes that safe: only an admin can
-- insert or delete a row, so nobody can grant themselves the role by calling
-- the API directly from a console.
--
-- Run this once in the Supabase SQL editor. It is idempotent - running it again
-- is harmless.

create table if not exists testers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  note       text
);

alter table testers enable row level security;

-- ---------------------------------------------------------------------------
-- Who is an admin is public.is_site_admin(), defined in
-- supabase/admin-server.sql over the table public.site_admins (which no API
-- role can read). This file used to define its own copy with the admin UUIDs
-- written in; re-running it would have put them back.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.site_admins') is null or to_regprocedure('public.is_site_admin()') is null then
    raise exception 'run supabase/admin-server.sql first';
  end if;
end $$;

-- A signed-in user may read their OWN row, which is how the site knows whether
-- to show them the AI item. Admins may read every row, which is how the panel
-- shows a user's current status. Nobody can probe anyone else.
drop policy if exists testers_read on testers;
create policy testers_read on testers for select using (
  auth.uid() = user_id or public.is_site_admin()
);

-- Granting and revoking are admin-only. These two policies are the entire
-- security boundary for this feature.
drop policy if exists testers_admin_insert on testers;
create policy testers_admin_insert on testers for insert
  with check (public.is_site_admin());

drop policy if exists testers_admin_delete on testers;
create policy testers_admin_delete on testers for delete
  using (public.is_site_admin());

-- Deliberately NO update policy. Granting is an insert and revoking is a
-- delete, so there is nothing to edit, and an absent policy denies by default.

-- ---------------------------------------------------------------------------
-- GRANTS. RLS policies alone are NOT enough.
--
-- PostgREST connects as the `anon` or `authenticated` role, and those roles need
-- table-level privileges before a policy is ever consulted. Without this you get
-- "permission denied for table testers" (SQLSTATE 42501) even though the
-- policies above are perfectly correct. Supabase's default privileges usually
-- cover new tables in `public`, but not in every project, and the failure looks
-- nothing like a missing grant from the client.
--
-- `anon` is deliberately left out: an unauthenticated request has no auth.uid(),
-- so testers_read would deny it anyway.
-- ---------------------------------------------------------------------------
grant select, insert, delete on table testers to authenticated;
grant execute on function public.is_site_admin() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Tell PostgREST the table exists.
--
-- The API keeps a cached picture of the schema. A brand new table is invisible
-- to it until that cache reloads, which shows up as PGRST205 - "Could not find
-- the table 'public.testers' in the schema cache" - from a table you can see
-- perfectly well in the SQL editor.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Check it worked:
--
--   select * from testers;                       -- service role: all rows
--
-- NOTE: do NOT test with  select public.is_site_admin();  in the SQL editor. It
-- runs as the service role with no JWT, so auth.uid() is null and the function
-- returns null. That is correct behaviour, not a failure - it only answers true
-- when called from the site with your session.
--
-- Grant by hand if you ever need to, though the admin panel is the intended way:
--
--   insert into testers (user_id) values ('<uuid>');
--   delete from testers where user_id = '<uuid>';
-- ---------------------------------------------------------------------------
