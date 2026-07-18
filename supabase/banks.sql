-- Player vaults (public bank slots) ------------------------------------------
-- Backs js/bank.js. Each user has one row holding ONLY the slots they marked
-- public: [{ name, items: [{ name, qty }] }]. Private slots never leave the
-- browser (localStorage), so a read-all policy is safe by design.
--
-- NOTE: the table is named player_vaults (NOT "banks") on purpose — ad blockers
-- block REST URLs containing /banks (ERR_BLOCKED_BY_CLIENT), which broke the
-- Banks tab for users with blockers.
--
-- If you already created the old `banks` table, just run the rename:
--   alter table if exists banks rename to player_vaults;
-- Otherwise run the full script below.

alter table if exists banks rename to player_vaults;

create table if not exists player_vaults (
  user_id    uuid primary key references auth.users on delete cascade,
  slots      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table player_vaults enable row level security;

-- Anyone (logged in or not) may view public bank slots.
drop policy if exists banks_read on player_vaults;
drop policy if exists vaults_read on player_vaults;
create policy vaults_read on player_vaults for select using (true);

-- Users manage only their own row.
drop policy if exists banks_insert on player_vaults;
drop policy if exists vaults_insert on player_vaults;
create policy vaults_insert on player_vaults for insert
  with check (auth.uid() = user_id);

drop policy if exists banks_update on player_vaults;
drop policy if exists vaults_update on player_vaults;
create policy vaults_update on player_vaults for update
  using (auth.uid() = user_id);

drop policy if exists banks_delete on player_vaults;
drop policy if exists vaults_delete on player_vaults;
create policy vaults_delete on player_vaults for delete
  using (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select on player_vaults to anon, authenticated;
grant insert, update, delete on player_vaults to authenticated;

-- Full account bank ----------------------------------------------------------
-- One row per user holding ALL slots (private included):
--   [{ name, items: [{ name, qty, sharded?, shards? }], public }]
-- This is the cross-device source of truth; player_vaults above stays as the
-- world-readable projection of just the public slots. RLS restricts every
-- operation to the owner, so private slots are never visible to anyone else.

create table if not exists player_vaults_private (
  user_id    uuid primary key references auth.users on delete cascade,
  slots      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table player_vaults_private enable row level security;

drop policy if exists vaults_priv_select on player_vaults_private;
create policy vaults_priv_select on player_vaults_private for select
  using (auth.uid() = user_id);

drop policy if exists vaults_priv_insert on player_vaults_private;
create policy vaults_priv_insert on player_vaults_private for insert
  with check (auth.uid() = user_id);

drop policy if exists vaults_priv_update on player_vaults_private;
create policy vaults_priv_update on player_vaults_private for update
  using (auth.uid() = user_id);

drop policy if exists vaults_priv_delete on player_vaults_private;
create policy vaults_priv_delete on player_vaults_private for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on player_vaults_private to authenticated;
