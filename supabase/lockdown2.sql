-- Lock the rest: parties, notifications, messages, listings, profiles, shared builds, avatars
-- ============================================================================
-- Run this whole file in the Supabase SQL editor, after supabase/lockdown.sql.
-- It is idempotent: every table it covers has its policies dropped by name and
-- rewritten, whatever the dashboard made over the years.
--
-- WHY. With the score and ban tables closed (lockdown.sql), the live database
-- was probed again as an ANONYMOUS visitor - no account, just the anon key
-- that ships in the page - and these answered:
--
--   party_listings    insert, update, delete   all allowed
--   party_members     update, delete           allowed
--   party_messages    update, delete           allowed (and every message readable)
--   party_requests    update, delete           allowed
--   notifications     insert                   allowed - for ANY user_id
--   shared_builds     insert                   allowed - including the delete
--                                              markers the gallery honours
--
-- So anyone on the internet could close or delete every party, kick every
-- member, wipe party chat, push a "message from the admins" into any account's
-- bell, and hide any community build from the gallery with one marker row.
-- None of that is "take control", but all of it is somebody else's data. The
-- tables anon could not touch (profiles, direct_messages, trade_listings,
-- reports, vaults, builds) have policies this repo cannot read, so they are
-- rewritten here as well, on the same rule: a row is written by the account it
-- belongs to, or by a site admin, and by nobody else.
--
-- WHAT CHANGES, table by table
--   profiles           read by all; insert/update only your own row; username
--                      unique and shaped like the site requires.
--   notifications      read/update/delete only your own; insert only signed in,
--                      and every row now records who sent it (sender_id, set by
--                      the database, not the caller).
--   direct_messages    read by the two participants (and an admin, for
--                      moderation); insert only as yourself; update only your
--                      own conversations; no delete (soft-delete RPC).
--   trade_listings     read by all; write only your own (admins any).
--   party_listings     read by all; create only as host; update by host, a
--                      current member (leaving sets the status) or an admin,
--                      and never re-hosted; no delete (the site closes them).
--   party_members      read by all; join as yourself or be added by the host;
--                      leave yourself, or be removed by the host or an admin.
--   party_requests     visible to requester and host; written by the requester,
--                      answered by the host.
--   party_messages     members and host only, read and write; delete your own
--                      (host and admin any).
--   shared_builds      read by all; inserts stay open to visitors (share links
--                      and community uploads need no account) EXCEPT delete
--                      markers, which only an admin or the build's signed-in
--                      owner may write; ids and payloads get a size cap.
--   storage: avatars   public to read; write only under your own user-id folder;
--                      images only, 5 MB.
--   reports            same rules as reports.sql, through is_site_admin().
--   matchmaking        switched off at the database as well as the UI: every
--                      mm_* function revoked, queue and match log own-row only
--                      (see supabase/matchmaking-return.sql for the way back).
--   vaults, builds     size caps on the JSON every Banks visitor downloads.
--   soft_delete_conversation is recreated to take its identity from the JWT
--                      (it accepted a p_me parameter) - only if direct_messages
--                      is shaped as this file expects; otherwise it says so.
--
-- BEFORE YOU RUN. Two looks, then run the file; if a statement fails, the
-- part it is in rolls back (part 1 is the public schema, part 2 the bucket).
--
-- (i) The vault and build JSON gets a size cap. See the largest rows, and if
--     any is near a cap (256 KB public vault, 1 MB full vault, 1 MB builds),
--     raise that cap below before running - its next save would be refused:
--
--   select 'player_vaults' as t, max(pg_column_size((slots::text)::jsonb)) from public.player_vaults
--   union all select 'player_vaults_full', max(pg_column_size((slots::text)::jsonb)) from public.player_vaults_full
--   union all select 'player_builds', max(pg_column_size((builds::text)::jsonb)) from public.player_builds;
--
-- (ii) The signup trigger must survive RLS on profiles. It does if it is a
--      definer owned by postgres; the file also grants the auth service its
--      own insert policy in case it is not:
--
--   select t.tgname, p.proname, p.prosecdef as definer, pg_get_userbyid(p.proowner) as owner
--     from pg_trigger t join pg_proc p on p.oid = t.tgfoid
--    where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;
-- ============================================================================

begin;

-- A row this audit's own probe left behind (an empty payload under the id
-- '______probe', proof that anon could insert). Nothing else refers to it.
delete from public.shared_builds where id = '______probe';

-- ── helper: reset one table ─────────────────────────────────────────────────
-- Enable RLS, drop every policy, take every privilege away from the API roles.
-- What each table gets back is spelled out below it.
create or replace function pg_temp.reset_table(t text) returns void
language plpgsql
as $$
declare
  r record;
begin
  if to_regclass('public.' || t) is null then
    raise exception 'table public.% does not exist', t;
  end if;
  execute format('alter table public.%I enable row level security', t);
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
    execute format('drop policy %I on public.%I', r.policyname, t);
  end loop;
  execute format('revoke all on table public.%I from public, anon, authenticated', t);
end;
$$;

-- ── profiles ────────────────────────────────────────────────────────────────
select pg_temp.reset_table('profiles');
grant select on table public.profiles to anon, authenticated;
grant insert on table public.profiles to authenticated;
-- Column by column: the six things the site lets a player change about
-- themselves, and nothing else (not id, not created_at, not a column added
-- later that nobody thought to protect).
grant update (username, avatar_url, chat_consent_at, chat_consent_version, party_class, attached_build)
  on table public.profiles to authenticated;

create policy profiles_read on public.profiles for select using (true);
create policy profiles_insert_own on public.profiles for insert to authenticated
  with check (auth.uid() = id);
create policy profiles_update_own on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);
-- The profile row is created at signup by a trigger on auth.users. If that
-- trigger runs as the auth service rather than as its definer, RLS would now
-- refuse it and every signup would fail with "Database error saving new
-- user". Harmless if the trigger is a definer (it bypasses RLS anyway).
grant insert on table public.profiles to supabase_auth_admin;
create policy profiles_insert_signup on public.profiles for insert to supabase_auth_admin
  with check (true);

-- One account per name. The site checked this in the browser only, which is a
-- check a console skips; two accounts with one name would share a leaderboard
-- identity and confuse a ban by name.
create unique index if not exists profiles_username_unique on public.profiles (username);

-- One name per reader, whatever the case: "Fool" and "fool" read as the same
-- player, and a ban or a report by name must never land on the wrong one. And
-- a perma-banned name stays retired in any case, even after its account is
-- deleted. The trigger stops any NEW clash. The unique index below is the
-- hard guarantee; it can only be built once no two names already differ
-- by case alone (there is one such pair live: fool / Fool).
create or replace function public.profiles_username_guard() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.username is null or (tg_op = 'UPDATE' and new.username is not distinct from old.username) then
    return new;
  end if;
  if exists (select 1 from profiles p where lower(p.username) = lower(new.username) and p.id <> new.id) then
    raise exception 'username "%" is taken', new.username using errcode = '23505';
  end if;
  if exists (select 1 from perma_banned_usernames b
              where lower(b.username) = lower(new.username) and b.user_id is distinct from new.id) then
    raise exception 'username "%" is not allowed', new.username using errcode = '23514';
  end if;
  -- A plain ban reserves its name as well: an old name-only ban would
  -- otherwise land on whoever registered the name next.
  if exists (select 1 from banned_usernames b
              where lower(b.username) = lower(new.username) and b.user_id is distinct from new.id) then
    raise exception 'username "%" is not allowed', new.username using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_username_guard() from public, anon, authenticated;
drop trigger if exists profiles_username_guard on public.profiles;
create trigger profiles_username_guard before insert or update on public.profiles
  for each row execute function public.profiles_username_guard();

do $$
declare
  v_pairs text;
begin
  select string_agg(names, '; ') into v_pairs
    from (select string_agg(username || ' (' || id || ')', ' / ' order by created_at) as names
            from public.profiles group by lower(username) having count(*) > 1) d;
  if v_pairs is null then
    create unique index if not exists profiles_username_lower_unique on public.profiles (lower(username));
  else
    raise notice 'profiles: names that differ only by case: % - the trigger stops new ones. Rename one of each pair (e.g. update public.profiles set username = ''Fool_2'' where id = ''<the later id>''), then run: create unique index profiles_username_lower_unique on public.profiles (lower(username));', v_pairs;
  end if;
end $$;

-- The shape the site's form enforces, now enforced where it counts. Every
-- existing name already fits (checked against the live table before this was
-- written: 1070 names, 3-20 characters, all [A-Za-z0-9_-]), so this validates.
-- Every profile has a name (none is NULL live). Without this a NULL name
-- passes the shape check below - a CHECK is only refused when it is false -
-- and a nameless account's posts would keep whatever name it sent.
alter table public.profiles alter column username set not null;
alter table public.profiles drop constraint if exists profiles_username_shape;
alter table public.profiles add constraint profiles_username_shape
  check (username ~ '^[A-Za-z0-9_-]{3,20}$');

-- An avatar is a picture in our own bucket. The column took any string, and
-- every viewer's browser - an admin's included - fetched it as <img src>: a
-- tracking pixel on someone else's server, fired at the moment the admin
-- opened a report about you. NOT VALID: new writes only; the site also stops
-- drawing an avatar from anywhere else (renderAvatar in js/sb.js).
alter table public.profiles drop constraint if exists profiles_avatar_url_bucket;
alter table public.profiles add constraint profiles_avatar_url_bucket
  check (avatar_url is null
         or avatar_url like 'https://mpqohagljmvwftwqumnh.supabase.co/storage/v1/object/public/avatars/%') not valid;

-- ── notifications ───────────────────────────────────────────────────────────
-- The site legitimately writes notifications INTO OTHER accounts (party
-- requests, reports to the admins), so the insert cannot demand
-- user_id = auth.uid(). It demands a signed-in sender, and records who: a
-- forged "message from the admins" now carries the forger's id.
alter table public.notifications add column if not exists sender_id uuid default auth.uid();

select pg_temp.reset_table('notifications');
grant select, insert, delete on table public.notifications to authenticated;
grant update (read) on table public.notifications to authenticated;   -- marking read is the only edit

create policy notifications_read_own on public.notifications for select to authenticated
  using (auth.uid() = user_id);
-- The identity fields inside meta are what the bell ACTS on (open a DM with
-- sender_id headed with sender_username, accept requester_id's party request
-- shown as requester_name); if present, each must be the caller and the
-- caller's own name. A forged title is still possible - and now signed.
create policy notifications_insert_signed_in on public.notifications for insert to authenticated
  with check (auth.uid() is not null and sender_id = auth.uid() and user_id is not null
              and coalesce(meta->>'sender_id',    auth.uid()::text) = auth.uid()::text
              and coalesce(meta->>'requester_id', auth.uid()::text) = auth.uid()::text
              and (meta->>'sender_username' is null
                   or meta->>'sender_username' = (select p.username from public.profiles p where p.id = auth.uid()))
              and (meta->>'requester_name' is null
                   or meta->>'requester_name' = (select p.username from public.profiles p where p.id = auth.uid())));
create policy notifications_update_own on public.notifications for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy notifications_delete_own on public.notifications for delete to authenticated
  using (auth.uid() = user_id);

-- ── direct_messages ─────────────────────────────────────────────────────────
select pg_temp.reset_table('direct_messages');
grant select, insert on table public.direct_messages to authenticated;
-- A sent message does not change: only its read flag. Who has hidden a
-- conversation (deleted_for) is written by the soft-delete function as its
-- definer, never by the client - a sender who could write it would hide
-- their own messages from the other side.
grant update (read) on table public.direct_messages to authenticated;

create policy dm_read_participants on public.direct_messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id or public.is_site_admin());
create policy dm_insert_as_sender on public.direct_messages for insert to authenticated
  with check (auth.uid() = sender_id and recipient_id <> sender_id);
-- Only the recipient marks a message read - a sender who could would send
-- messages that never raise the other side's unread badge. Hiding a
-- conversation goes through soft_delete_conversation (below). Nothing else on
-- a message changes after it is sent.
create policy dm_update_recipient on public.direct_messages for update to authenticated
  using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);
-- No delete policy: messages stay for moderation (the site soft-deletes).

-- ── trade_listings ──────────────────────────────────────────────────────────
select pg_temp.reset_table('trade_listings');
grant select on table public.trade_listings to anon, authenticated;
grant insert, delete on table public.trade_listings to authenticated;
grant update (type, items, lf_items, description, status) on table public.trade_listings to authenticated;

create policy tl_read on public.trade_listings for select using (true);
create policy tl_insert_own on public.trade_listings for insert to authenticated
  with check (auth.uid() = user_id);
create policy tl_update_own on public.trade_listings for update to authenticated
  using (auth.uid() = user_id or public.is_site_admin())
  with check (auth.uid() = user_id or public.is_site_admin());
create policy tl_delete_own on public.trade_listings for delete to authenticated
  using (auth.uid() = user_id or public.is_site_admin());

-- ── party_listings ──────────────────────────────────────────────────────────
select pg_temp.reset_table('party_listings');
grant select on table public.party_listings to anon, authenticated;
grant insert on table public.party_listings to authenticated;
grant update (status) on table public.party_listings to authenticated;   -- open / full / closed is all that ever changes

create policy pl_read on public.party_listings for select using (true);
create policy pl_insert_as_host on public.party_listings for insert to authenticated
  with check (auth.uid() = host_id);
-- Host or admin, and only the status column (the grant above). A member who
-- leaves a full party used to set it back to open themselves; the site deletes
-- their member row FIRST, so by the time it updates the listing they are no
-- longer a member and no policy could let them. The trigger below reopens
-- the party for them instead.
create policy pl_update on public.party_listings for update to authenticated
  using (auth.uid() = host_id or public.is_site_admin())
  with check (auth.uid() = host_id or public.is_site_admin());
-- No delete policy: the site closes a party (status), it never deletes the row.

create or replace function public.party_member_left() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update party_listings
     set status = 'open'
   where id = old.party_id and status = 'full'
     and (select count(*) from party_members where party_id = old.party_id) < party_size;
  return old;
end;
$$;
revoke all on function public.party_member_left() from public, anon, authenticated;
drop trigger if exists party_member_left on public.party_members;
create trigger party_member_left after delete on public.party_members
  for each row execute function public.party_member_left();

-- ── party_members ───────────────────────────────────────────────────────────
select pg_temp.reset_table('party_members');
grant select on table public.party_members to anon, authenticated;
grant insert, delete on table public.party_members to authenticated;

create policy pm_read on public.party_members for select using (true);
-- Every way into a party goes through the host: they add themselves when they
-- open it and add a requester when they accept (the invite link files a
-- request too). A self-insert would be a way past the request - and a host
-- adding just anyone would put that account "in a party" it never asked for,
-- which blocks it from hosting or joining another. So: the host, adding
-- themselves or an account with a pending request for that party.
create policy pm_insert on public.party_members for insert to authenticated
  with check (public.is_site_admin()
              or (auth.uid() = (select l.host_id from public.party_listings l where l.id = party_members.party_id)
                  and (user_id = auth.uid()
                       or exists (select 1 from public.party_requests r
                                   where r.party_id = party_members.party_id
                                     and r.requester_id = party_members.user_id
                                     and r.status = 'pending'))));
create policy pm_delete on public.party_members for delete to authenticated
  using (auth.uid() = user_id
         or auth.uid() = (select l.host_id from public.party_listings l where l.id = party_members.party_id)
         or public.is_site_admin());

-- ── party_requests ──────────────────────────────────────────────────────────
select pg_temp.reset_table('party_requests');
grant select, insert, update, delete on table public.party_requests to authenticated;

create policy pr_read on public.party_requests for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = host_id or public.is_site_admin());
-- The requester files it, naming the party's real host (the site's upsert
-- sends host_id; a wrong one would route the request to someone else).
create policy pr_insert on public.party_requests for insert to authenticated
  with check (auth.uid() = requester_id and status = 'pending'
              and host_id = (select l.host_id from public.party_listings l where l.id = party_requests.party_id));
-- The host answers a request (accepted / rejected); the requester may only
-- re-file it as pending (the upsert path) - never accept themselves, and
-- never re-address it to another host.
create policy pr_update on public.party_requests for update to authenticated
  using (auth.uid() = requester_id or auth.uid() = host_id or public.is_site_admin())
  with check ((auth.uid() = host_id or public.is_site_admin()
               or (auth.uid() = requester_id and status = 'pending'))
              and host_id = (select l.host_id from public.party_listings l where l.id = party_requests.party_id));
create policy pr_delete on public.party_requests for delete to authenticated
  using (auth.uid() = requester_id or auth.uid() = host_id or public.is_site_admin());

-- A policy cannot compare a row with what it was, and the host passes
-- pr_update for every request to their party - so without this a host could
-- rewrite a request's requester_id to anyone, set it back to pending, and
-- then add that account as a member (pm_insert trusts a pending request).
-- Who asked, and for which party, never changes; only the requester re-files
-- a request as pending. (The site's upsert re-sends party_id, host_id and
-- requester_id with the values they already have, which passes.)
create or replace function public.party_request_pin() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.party_id is distinct from old.party_id
     or new.requester_id is distinct from old.requester_id
     or new.host_id is distinct from old.host_id then
    raise exception 'a party request''s party and people are fixed';
  end if;
  if new.status = 'pending' and old.status is distinct from 'pending'
     and auth.uid() is distinct from old.requester_id and not public.is_site_admin() then
    raise exception 'only the requester can re-file a request';
  end if;
  return new;
end;
$$;
revoke all on function public.party_request_pin() from public, anon, authenticated;
drop trigger if exists party_request_pin on public.party_requests;
create trigger party_request_pin before update on public.party_requests
  for each row execute function public.party_request_pin();

-- ── party_messages ──────────────────────────────────────────────────────────
-- Party chat was readable by anyone on the internet, private parties included.
-- It is the party's now: members, the host, and an admin.
select pg_temp.reset_table('party_messages');
grant select, insert, delete on table public.party_messages to authenticated;

create policy pmsg_read on public.party_messages for select to authenticated
  using (public.is_site_admin()
         or exists (select 1 from public.party_members m
                     where m.party_id = party_messages.party_id and m.user_id = auth.uid())
         or auth.uid() = (select l.host_id from public.party_listings l where l.id = party_messages.party_id));
create policy pmsg_insert on public.party_messages for insert to authenticated
  with check (auth.uid() = sender_id
              and (exists (select 1 from public.party_members m
                            where m.party_id = party_messages.party_id and m.user_id = auth.uid())
                   or auth.uid() = (select l.host_id from public.party_listings l where l.id = party_messages.party_id)));
create policy pmsg_delete on public.party_messages for delete to authenticated
  using (auth.uid() = sender_id
         or auth.uid() = (select l.host_id from public.party_listings l where l.id = party_messages.party_id)
         or public.is_site_admin());

-- Live chat used to travel on a public Realtime broadcast channel named after
-- the party: anyone could listen to any party and inject lines under any
-- name, and none of the rules above applied. The site now receives chat as
-- database changes on this table, which Realtime delivers only to a
-- subscriber pmsg_read lets see the row - and the row carries the stamped
-- name, not the sender's say-so.
do $$
begin
  alter publication supabase_realtime add table public.party_messages;
exception when duplicate_object then null;
end $$;

-- ── shared_builds ───────────────────────────────────────────────────────────
-- Share links and community uploads are made without an account, so inserts
-- stay open to visitors. The gallery hides a build when it sees a marker row
-- {_deleted:'true', _buildId} - and anyone could write one. Now only an admin
-- can, or the signed-in account that uploaded the build (js/builds.js records
-- its id as payload._ownerId from this release on; older uploads have no
-- owner and are the admin's to remove).
select pg_temp.reset_table('shared_builds');
grant select, insert on table public.shared_builds to anon, authenticated;

create policy sb_read on public.shared_builds for select using (true);
-- shared_builds.payload, qualified: inside the subquery an unqualified
-- `payload` would be t's column, and the rule would then test the wrong row.
create policy sb_insert on public.shared_builds for insert to anon, authenticated
  with check (
    coalesce(shared_builds.payload->>'_deleted', '') <> 'true'
    or public.is_site_admin()
    or (auth.uid() is not null
        and exists (select 1 from public.shared_builds t
                     where t.id = shared_builds.payload->>'_buildId'
                       and t.payload->>'_ownerId' = auth.uid()::text))
  );
-- No update or delete for the API roles: the table is append-only by design.

-- A visitor chooses the id and sends the payload; keep both within reason.
-- NOT VALID: applies to rows written from now on, never re-checks old ones.
alter table public.shared_builds drop constraint if exists shared_builds_id_len;
alter table public.shared_builds add constraint shared_builds_id_len check (length(id) <= 64) not valid;
alter table public.shared_builds drop constraint if exists shared_builds_payload_size;
alter table public.shared_builds add constraint shared_builds_payload_size check (pg_column_size(payload) <= 262144) not valid;

-- Who uploaded a build is the database's word, not the payload's: a visitor
-- could credit a gallery build to any player (_submittedBy) or claim to own
-- one (_ownerId, which the marker rule above trusts). Both are rewritten
-- from the JWT on the way in; a signed-out upload is "Anonymous" with no
-- owner. A delete marker is cut down to what a marker is - otherwise a row
-- carrying both _deleted and _community would pass the marker rule AND be
-- listed in the gallery with any credit it liked. (RLS checks the row after
-- this trigger, so the marker rule still sees _deleted and _buildId.)
create or replace function public.stamp_shared_build() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(new.payload) = 'object' and new.payload->>'_deleted' = 'true' then
    new.payload := jsonb_strip_nulls(jsonb_build_object(
      '_deleted', 'true', '_buildId', new.payload->>'_buildId', '_fp', new.payload->>'_fp'));
    return new;
  end if;
  if jsonb_typeof(new.payload) = 'object' then
    new.payload := new.payload - '_ownerId';
    if auth.uid() is not null then
      new.payload := new.payload || jsonb_build_object('_ownerId', auth.uid()::text);
    end if;
    if new.payload->>'_community' = 'true' then
      new.payload := new.payload || jsonb_build_object('_submittedBy',
        coalesce((select p.username from public.profiles p where p.id = auth.uid()), 'Anonymous'));
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_shared_build() from public, anon, authenticated;
drop trigger if exists stamp_shared_build on public.shared_builds;
create trigger stamp_shared_build before insert on public.shared_builds
  for each row execute function public.stamp_shared_build();

-- Likes and delete markers per build, for the builds on one gallery page. The
-- gallery used to download every like and marker row in one capped query, so
-- enough fake likes pushed the markers out of it and deleted builds came
-- back. This answers one row per requested build, however many rows exist.
-- A btree entry is capped at ~2.7 KB, and until now anyone could insert any
-- payload: a junk like/marker with an enormous _buildId would make the index
-- below fail and roll the whole file back. Real build ids are under 40
-- characters; a like or marker pointing at a longer one points at nothing.
delete from public.shared_builds where length(payload->>'_buildId') > 64;
create index if not exists shared_builds_build_id on public.shared_builds ((payload->>'_buildId'));
-- The gallery lists the newest community builds first; the server now dates
-- every row (stamp_insert_defaults below), so the order cannot be gamed.
create index if not exists shared_builds_community_created
  on public.shared_builds (created_at desc) where payload->>'_community' = 'true';
create or replace function public.build_meta(p_ids text[], p_fp text default null)
returns table (build_id text, likes bigint, deleted boolean, liked boolean)
language sql
stable
set search_path = public
as $$
  select d.b,
         count(s.id) filter (where s.payload->>'_like' = 'true'),
         coalesce(bool_or(s.payload->>'_deleted' = 'true'), false),
         coalesce(bool_or(s.payload->>'_like' = 'true' and s.payload->>'_fp' = p_fp), false)
    from (select distinct b from unnest(p_ids[1:300]) as b where length(b) <= 64) as d
    left join shared_builds s on s.payload->>'_buildId' = d.b
   group by d.b;
$$;
revoke all on function public.build_meta(text[], text) from public, anon, authenticated;
grant execute on function public.build_meta(text[], text) to anon, authenticated;

-- ── reports: the admin list in one place ────────────────────────────────────
-- reports.sql inlines the two admin UUIDs in three policies. Same rules,
-- through is_site_admin(), so a change to the list cannot miss a copy.
drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select to authenticated
  using (auth.uid() = reporter_id or public.is_site_admin());
drop policy if exists reports_admin_update on public.reports;
create policy reports_admin_update on public.reports for update to authenticated
  using (public.is_site_admin()) with check (public.is_site_admin());
drop policy if exists reports_admin_delete on public.reports;
create policy reports_admin_delete on public.reports for delete to authenticated
  using (public.is_site_admin());

-- ── soft_delete_conversation: identity from the JWT ─────────────────────────
-- The site calls it as rpc('soft_delete_conversation', { p_me, p_other }). A
-- function that believes p_me lets any account hide any other account's
-- conversations. This version keeps the signature and ignores p_me. It is only
-- written if direct_messages.deleted_for is jsonb (the shape the site's own
-- query implies: .not('deleted_for', 'cs', '["<id>"]')); otherwise the file
-- prints the definition to check by hand.
do $$
declare
  v_type text;
  r      record;
begin
  select data_type into v_type from information_schema.columns
   where table_schema = 'public' and table_name = 'direct_messages' and column_name = 'deleted_for';
  if v_type = 'jsonb' then
    for r in
      select p.oid::regprocedure as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'soft_delete_conversation'
    loop
      execute format('drop function %s', r.sig);
    end loop;
    create function public.soft_delete_conversation(p_me uuid, p_other uuid) returns void
    language sql
    security definer
    set search_path = public
    as $f$
      update direct_messages
         set deleted_for = coalesce(deleted_for, '[]'::jsonb) || to_jsonb(auth.uid()::text)
       where auth.uid() is not null
         and ((sender_id = auth.uid() and recipient_id = p_other)
              or (sender_id = p_other and recipient_id = auth.uid()))
         and not coalesce(deleted_for, '[]'::jsonb) ? auth.uid()::text;
    $f$;
    revoke all on function public.soft_delete_conversation(uuid, uuid) from public, anon, authenticated;
    grant execute on function public.soft_delete_conversation(uuid, uuid) to authenticated;
  else
    -- The old function stays; if it runs as its caller it needs to write the
    -- column on both sides of a conversation, so only in this case does the
    -- client role keep that grant, and a participants' update policy.
    grant update (deleted_for) on table public.direct_messages to authenticated;
    create policy dm_update_hide on public.direct_messages for update to authenticated
      using (auth.uid() = sender_id or auth.uid() = recipient_id)
      with check (auth.uid() = sender_id or auth.uid() = recipient_id);
    raise notice 'direct_messages.deleted_for is % - soft_delete_conversation left as is (and update(deleted_for) kept for it); check it with: select pg_get_functiondef(p.oid) from pg_proc p where p.proname = ''soft_delete_conversation''', coalesce(v_type, 'missing');
  end if;
end $$;

-- ── matchmaking: switched off at the database too ───────────────────────────
-- The matchmaking UI is disabled (index.html), but every mm_* function and
-- the mm_queue table were still open to any signed-in account. With the
-- functions reachable, one account could pair itself against any player left
-- in the queue and claim the win without the other side ever seeing a match:
-- the host-only rule keys on uuid order, and nothing required the opponent to
-- have joined. Nobody needs any of it while the UI is off, so it is revoked
-- here. supabase/matchmaking-return.sql has the hardened bodies and the
-- re-grants for when the feature comes back.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname in ('mm_create_match', 'mm_apply_result', 'mm_abandon_match', 'mm_report_disconnect',
                         'mm_match_ping', 'mm_queue_counts', 'mm_settle')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- The queue and the match log were readable by anyone on the internet
-- (a queued player's id, name and avatar; every match's rounds and heartbeat
-- stamps), and the queue took writes with client-chosen timestamps. Read your
-- own rows; write nothing until the feature returns. Ratings stay public, as a
-- board is.
select pg_temp.reset_table('mm_queue');
select pg_temp.reset_table('mm_matches');
select pg_temp.reset_table('mm_ratings');
select pg_temp.reset_table('online_heartbeats');   -- ping_online reaches it as its definer; nobody else does
grant select on table public.mm_queue to authenticated;
create policy mm_queue_read_own on public.mm_queue for select to authenticated
  using (auth.uid() = user_id or public.is_site_admin());
grant select on table public.mm_matches to authenticated;
create policy mm_match_read_own on public.mm_matches for select to authenticated
  using (auth.uid() = p1_id or auth.uid() = p2_id or public.is_site_admin());
grant select on table public.mm_ratings to anon, authenticated;
create policy mm_ratings_read on public.mm_ratings for select using (true);

-- ── size caps on JSON the whole world downloads ─────────────────────────────
-- player_vaults.slots is read by every visitor of the Banks page (200 rows at
-- a time) and was bounded only by the client; one account could make every
-- Banks visit pull megabytes. NOT VALID: new writes only, no re-check of old
-- rows. (banks.sql / builds.sql define these columns as jsonb.)
-- The caps sit well above anything real (the site itself caps saved builds
-- at 512 KB on the client); the header's pre-flight query shows the largest
-- rows so a cap is never set under an existing vault, whose next save would
-- otherwise be refused with only a console warning.
alter table public.player_vaults drop constraint if exists player_vaults_shape;
alter table public.player_vaults add constraint player_vaults_shape
  check (jsonb_typeof(slots) = 'array' and pg_column_size(slots) <= 262144) not valid;
alter table public.player_vaults_full drop constraint if exists player_vaults_full_shape;
alter table public.player_vaults_full add constraint player_vaults_full_shape
  check (jsonb_typeof(slots) = 'array' and pg_column_size(slots) <= 1048576) not valid;
alter table public.player_builds drop constraint if exists player_builds_size;
alter table public.player_builds add constraint player_builds_size
  check (pg_column_size(builds) <= 1048576) not valid;

-- ── display names come from the profile, not from the request ──────────────
-- Listings, messages, parties and requests carry the actor's name as a plain
-- column the client filled in - so a signed-in account could post as anyone
-- by sending that name. A BEFORE trigger overwrites the name with the
-- profile's, keyed on the id column the policy has already pinned to the
-- caller (or, for party_members, to the member being added).
create or replace function public.stamp_profile_name() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid := (to_jsonb(new)->>tg_argv[1])::uuid;
  v_name text;
begin
  select username into v_name from profiles where id = v_id;
  if v_name is null then
    -- Fails closed: a new row is never left with the name the client sent.
    -- An old row whose account is gone keeps the name it was stored with.
    if tg_op = 'INSERT' then
      raise exception 'no profile name for %', v_id using errcode = '23514';
    end if;
    v_name := to_jsonb(old)->>tg_argv[0];
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], v_name));
  return new;
end;
$$;
revoke all on function public.stamp_profile_name() from public, anon, authenticated;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('trade_listings',  'username',       'user_id'),
      ('direct_messages', 'sender_name',    'sender_id'),
      ('direct_messages', 'recipient_name', 'recipient_id'),
      ('party_listings',  'host_name',      'host_id'),
      ('party_members',   'username',       'user_id'),
      ('party_messages',  'sender_name',    'sender_id'),
      ('party_requests',  'requester_name', 'requester_id'),
      ('reports',         'reporter_name',  'reporter_id'),
      ('reports',         'reported_name',  'reported_id'),
      ('mm_queue',        'username',       'user_id')
    ) as v(tbl, name_col, id_col)
  loop
    if to_regclass('public.' || t.tbl) is null then continue; end if;
    -- One trigger per name column (a table can carry two names).
    execute format('drop trigger if exists stamp_profile_name on public.%I', t.tbl);
    execute format('drop trigger if exists %I on public.%I', 'stamp_' || t.name_col, t.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.stamp_profile_name(%L, %L)',
                   'stamp_' || t.name_col, t.tbl, t.name_col, t.id_col);
  end loop;
end $$;

-- ── the server's clock, not the sender's ───────────────────────────────────
-- A notification or message took whatever created_at and read flag it was
-- sent with: thirty notifications dated 2999 and marked read pushed a
-- player's real ones out of the bell with no badge. Set on the way in.
create or replace function public.stamp_insert_defaults() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new := jsonb_populate_record(new,
           jsonb_build_object('created_at', now())
           || case when to_jsonb(new) ? 'read' then jsonb_build_object('read', false) else '{}'::jsonb end);
  return new;
end;
$$;
revoke all on function public.stamp_insert_defaults() from public, anon, authenticated;
do $$
declare
  t text;
begin
  foreach t in array array['notifications', 'direct_messages', 'party_messages', 'shared_builds'] loop
    execute format('drop trigger if exists stamp_insert_defaults on public.%I', t);
    execute format('create trigger stamp_insert_defaults before insert on public.%I for each row execute function public.stamp_insert_defaults()', t);
    -- Rows a client already dated in the future stay on top forever: bring
    -- them back to now.
    execute format('update public.%I set created_at = now() where created_at > now() + interval ''5 minutes''', t);
  end loop;
end $$;

-- ── one open report per pair ────────────────────────────────────────────────
-- Each report also rings every admin's bell; without this an account could
-- file the same report a thousand times. Only created when the table has no
-- duplicate open pairs already (otherwise the index cannot be built and the
-- file says so instead of failing).
do $$
begin
  if to_regclass('public.reports') is null then return; end if;
  if exists (select 1 from public.reports where status = 'open'
              group by reporter_id, reported_id having count(*) > 1) then
    raise notice 'reports: duplicate open reports exist - resolve them, then run: create unique index reports_one_open_per_pair on public.reports (reporter_id, reported_id) where status = ''open'';';
  else
    create unique index if not exists reports_one_open_per_pair
      on public.reports (reporter_id, reported_id) where status = 'open';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- ── part 2: the avatars bucket - its own transaction ────────────────────────
-- storage.objects belongs to Supabase's storage service, and on newer projects
-- the SQL editor's postgres role can be refused ("must be owner of table
-- objects"). Kept apart so a refusal here cannot roll back everything above.
-- If it is refused: make the same four policies in Dashboard > Storage >
-- Policies (bucket avatars: SELECT for everyone; INSERT, UPDATE and DELETE for
-- authenticated where (storage.foldername(name))[1] = auth.uid()::text) and
-- set the size and mime limits in the bucket's settings.
--
-- The site writes <user id>/avatar.jpg. Only policies that mention this bucket
-- are replaced; any other bucket's policies are left alone - so read VERIFY
-- (e): a broad pre-existing policy that does not name the bucket would still
-- open it, since policies are OR-ed.
begin;

do $$
declare
  r record;
begin
  for r in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and (coalesce(qual, '') || coalesce(with_check, '')) like '%avatars%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

create policy avatars_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- The site uploads a cropped JPEG; the bucket took any file of any size.
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'avatars';

commit;

-- ── VERIFY - run each, read the output ──────────────────────────────────────
-- (e) The bucket's policies - expect the four avatars_* rows and nothing
--     broader (a policy without a bucket_id test opens every bucket):
--
--   select policyname, cmd, roles, qual, with_check from pg_policies
--    where schemaname = 'storage' and tablename = 'objects' order by 1;
--   select file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars';
--
-- (a) Every write policy names the caller or an admin - nothing "using (true)"
--     on an insert/update/delete:
--
--   select tablename, policyname, cmd, coalesce(with_check, qual) as rule
--     from pg_policies
--    where schemaname = 'public' and cmd <> 'SELECT'
--      and tablename in ('profiles','notifications','direct_messages','trade_listings',
--                        'party_listings','party_members','party_requests','party_messages','shared_builds')
--    order by 1, 3, 2;
--
--   Expect every rule to mention auth.uid() or is_site_admin(); the one
--   shared_builds insert rule is the marker rule above.
--
-- (b) The two dashboard-made functions, printed so you can read them once.
--     delete_own_account must delete only auth.uid()'s rows; the soft-delete
--     one, if this file left it alone, must not act on p_me:
--
--   select p.proname, p.prosecdef as definer, pg_get_functiondef(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('delete_own_account', 'soft_delete_conversation');
--
--     And the trigger that creates a profile at signup. It copies the signup
--     name from raw_user_meta_data, which a signup request can set to anything;
--     the profiles_username_shape constraint above refuses a bad one, so the
--     trigger must not swallow that error silently (a signup with no profile):
--
--   select tgname, pg_get_triggerdef(t.oid), pg_get_functiondef(t.tgfoid)
--     from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;
--
-- (c) From the site, signed OUT, in the console (all four must be refused):
--
--   await _sbClient.from('party_listings').delete().eq('id', '00000000-0000-0000-0000-000000000000')
--     -> error.code '42501'
--   await _sbClient.from('notifications').insert({ user_id: '<any real id>', title: 'x' })
--     -> error.code '42501'
--   await _sbClient.from('shared_builds').insert({ id: 'zz-probe', payload: { _deleted: 'true', _buildId: 'anything' } })
--     -> error.code '42501' (new row violates row-level security policy)
--   await _sbClient.from('party_messages').select('id').limit(1)
--     -> error.code '42501'
--
-- (d) Signed in as an ordinary account: the party page, the bell, the trade
--     board and a DM thread all still work; a community upload still works;
--     deleting someone ELSE's community build (from a console) is refused.
