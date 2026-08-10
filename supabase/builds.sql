-- Saved builds (account-linked) ----------------------------------------------
-- Backs js/saved-builds.js. One row per user holding every saved build:
--   [{ id, name, ts, fav, state }]
-- This is the cross-device source of truth. The browser keeps the same array in
-- localStorage under 'alb:saved-builds' so the builder still works logged out;
-- the client reconciles the two last-writer-wins on `updated_at`, exactly the
-- way js/bank.js reconciles player_vaults_full.
--
-- Unlike player_vaults there is NO world-readable projection here. Saved builds
-- are private; sharing a build with the community goes through shared_builds.
--
-- Safe to re-run.

create table if not exists player_builds (
  user_id    uuid primary key references auth.users on delete cascade,
  builds     jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Server-side backstop for the client's _MAX_SAVED_BUILDS cap. Guards against a
-- runaway client writing an unbounded blob. Keep the number here in step with
-- _MAX_SAVED_BUILDS in js/saved-builds.js.
alter table player_builds drop constraint if exists player_builds_shape;
alter table player_builds add constraint player_builds_shape
  check (jsonb_typeof(builds) = 'array' and jsonb_array_length(builds) <= 50);

alter table player_builds enable row level security;

-- Owner-only on every operation. auth.uid() is wrapped in a subselect so the
-- planner evaluates it once per query instead of once per row.
drop policy if exists player_builds_select on player_builds;
create policy player_builds_select on player_builds for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists player_builds_insert on player_builds;
create policy player_builds_insert on player_builds for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists player_builds_update on player_builds;
create policy player_builds_update on player_builds for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists player_builds_delete on player_builds;
create policy player_builds_delete on player_builds for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on player_builds to authenticated;
