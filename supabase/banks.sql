-- Banks ----------------------------------------------------------------------
-- Public bank slots (js/bank.js). Each user has one row holding ONLY the slots
-- they marked public: [{ name, items: [{ name, qty }] }]. Private slots never
-- leave the browser (localStorage), so a read-all policy is safe by design.
-- Run this in the Supabase SQL editor.

create table if not exists banks (
  user_id    uuid primary key references auth.users on delete cascade,
  slots      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table banks enable row level security;

-- Anyone (logged in or not) may view public bank slots.
drop policy if exists banks_read on banks;
create policy banks_read on banks for select using (true);

-- Users manage only their own row.
drop policy if exists banks_insert on banks;
create policy banks_insert on banks for insert
  with check (auth.uid() = user_id);

drop policy if exists banks_update on banks;
create policy banks_update on banks for update
  using (auth.uid() = user_id);

drop policy if exists banks_delete on banks;
create policy banks_delete on banks for delete
  using (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select on banks to anon, authenticated;
grant insert, update, delete on banks to authenticated;
