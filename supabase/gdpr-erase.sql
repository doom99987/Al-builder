-- GDPR requests: find a player, show what is held on them, erase it
-- ============================================================================
-- Run this file ONCE in the Supabase SQL editor to install three functions,
-- after supabase/lockdown.sql and lockdown2.sql. It changes no data by itself.
-- Then, per request, in the SQL editor:
--
--   1. Find the account (by email, username in any case, or id):
--        select * from public.gdpr_find_user('someone@example.com');
--
--   2. See everything held on it - the answer to an ACCESS request (Art. 15),
--      and the check before an erasure. Each row is one table; `row_data` is
--      the data itself as JSON (right-click the cell to copy it for the player):
--        select * from public.gdpr_user_data('<user id>');
--
--   3. Erase it - the answer to an ERASURE request / withdrawn consent
--      (Art. 17). One transaction: all of it goes, or nothing does. The second
--      argument must be ERASE followed by the username exactly, so a wrong id
--      pasted by mistake stops here:
--        select * from public.gdpr_erase_user('<user id>', 'ERASE TheirName');
--
--      It returns one line per table with the rows removed, plus two lines
--      you act on by hand:
--        storage: avatars    their picture files - delete the folder
--                            <user id> in Dashboard > Storage > avatars
--                            (Supabase does not let SQL delete stored files)
--        auth.users          'deleted' - or, if the delete was refused, delete
--                            the user in Dashboard > Authentication > Users
--
-- WHAT STAYS, and why (say this in your reply to the player):
--   - donations: the payment itself is kept for accounting (and Stripe keeps
--     its own copy); the row is anonymised - no account link, name
--     "Anonymous". Deleting payment records is deliberately not offered.
--   - ban records: by default a ban on their NAME stays (so the name cannot be
--     re-registered to dodge it), but the link to the account is removed.
--     Pass keep_ban_names => false to delete those rows too:
--        select * from public.gdpr_erase_user('<id>', 'ERASE TheirName', keep_ban_names => false);
--   - share links made while signed out, and likes (keyed by a browser
--     fingerprint, not an account) cannot be traced to a person and stay.
--
-- The functions are revoked from every API role: only the SQL editor (and the
-- service key) can call them. They run with the caller's rights, so even a
-- grant added by mistake would give an ordinary account nothing.
-- ============================================================================

begin;

-- ── 1. find ─────────────────────────────────────────────────────────────────
create or replace function public.gdpr_find_user(p_query text)
returns table (user_id uuid, username text, email text, signed_up timestamptz, last_sign_in timestamptz)
language sql
stable
set search_path = public
as $$
  select u.id, p.username, u.email::text, u.created_at, u.last_sign_in_at
    from auth.users u
    left join public.profiles p on p.id = u.id
   where lower(u.email) = lower(btrim(p_query))
      or lower(p.username) = lower(btrim(p_query))
      or lower(u.raw_user_meta_data->>'username') = lower(btrim(p_query))
      or u.id::text = btrim(p_query);
$$;

-- ── the one list of where a player's data lives ─────────────────────────────
-- $1 = the account id (uuid), $2 = its username, $3 = the id as text; every
-- condition runs against the table aliased as x.
-- ORDER MATTERS for the erase: children before parents, profile and account
-- last. A table missing from this project is skipped (and says so); a
-- condition naming a column that does not exist is an ERROR, which rolls the
-- whole erase back - a typo must never pass for "nothing to erase".
-- A name is only matched on rows that carry no account id: names change hands,
-- and a row that records its account belongs to that account, whatever it is
-- called. notifications.sender_id exists once lockdown2.sql has run; it is
-- read through to_jsonb(x) so the condition parses either way.
-- Add a line here whenever a new table stores anything about a player.
create or replace function public.gdpr_targets()
returns table (ord int, tbl text, cond text, how text)
language sql
immutable
as $$
  values
    ( 1, 'party_messages',         'sender_id = $1 or party_id in (select l.id from public.party_listings l where l.host_id = $1)', 'delete'),
    ( 2, 'party_requests',         'requester_id = $1 or host_id = $1',                                                            'delete'),
    ( 3, 'party_members',          'user_id = $1 or party_id in (select l.id from public.party_listings l where l.host_id = $1)',  'delete'),
    ( 4, 'party_listings',         'host_id = $1',                                                                                 'delete'),
    ( 5, 'direct_messages',        'sender_id = $1 or recipient_id = $1',                                                          'delete'),
    ( 6, 'notifications',          'user_id = $1 or to_jsonb(x)->>''sender_id'' = $3 or meta->>''sender_id'' = $3 or meta->>''requester_id'' = $3 or meta->>''reported_id'' = $3', 'delete'),
    ( 7, 'trade_listings',         'user_id = $1',                                                                                 'delete'),
    ( 8, 'shared_builds',          'payload->>''_ownerId'' = $3 or (payload->>''_ownerId'' is null and payload->>''_community'' = ''true'' and payload->>''_submittedBy'' = $2)', 'builds'),
    ( 9, 'reports',                'reporter_id = $1 or reported_id = $1',                                                         'delete'),
    (10, 'leaderboard',            'user_id = $1',                                                                                 'delete'),
    (11, 'personal_bests',         'user_id = $1',                                                                                 'delete'),
    (12, 'qte_sessions',           'user_id = $1',                                                                                 'delete'),
    (12, 'qte_run_rejects',        'user_id = $1',                                                                                 'delete'),
    (12, 'score_reviews',          'user_id = $1',                                                                                 'delete'),
    (13, 'leaderboard_records',    'user_id = $1',                                                                                 'records'),
    (14, 'player_vaults',          'user_id = $1',                                                                                 'delete'),
    (15, 'player_vaults_full',     'user_id = $1',                                                                                 'delete'),
    (16, 'player_builds',          'user_id = $1',                                                                                 'delete'),
    (17, 'mm_queue',               'user_id = $1',                                                                                 'delete'),
    (18, 'mm_matches',             'p1_id = $1 or p2_id = $1',                                                                     'delete'),
    (19, 'mm_ratings',             'user_id = $1',                                                                                 'delete'),
    (20, 'testers',                'user_id = $1',                                                                                 'delete'),
    (21, 'donations',              'user_id = $1',                                                                                 'anonymise'),
    (22, 'banned_usernames',       'user_id = $1 or (user_id is null and username = $2)',                                          'bans'),
    (23, 'perma_banned_usernames', 'user_id = $1 or (user_id is null and username = $2)',                                          'bans'),
    (24, 'profiles',               'id = $1',                                                                                      'delete')
$$;

-- ── 2. access: everything held on a player ──────────────────────────────────
create or replace function public.gdpr_user_data(p_user uuid)
returns table (source text, row_count bigint, row_data jsonb)
language plpgsql
set search_path = public
as $$
declare
  t      record;
  v_name text;
begin
  select p.username into v_name from public.profiles p where p.id = p_user;
  if v_name is null then
    select u.raw_user_meta_data->>'username' into v_name from auth.users u where u.id = p_user;
  end if;

  source := 'auth.users';
  select count(*), jsonb_agg(jsonb_build_object(
           'id', u.id, 'email', u.email, 'signed_up', u.created_at, 'last_sign_in', u.last_sign_in_at,
           'email_confirmed', u.email_confirmed_at, 'banned_until', u.banned_until, 'signup_name', u.raw_user_meta_data->>'username'))
    into row_count, row_data
    from auth.users u where u.id = p_user;
  return next;

  for t in select * from public.gdpr_targets() order by ord loop
    source := t.tbl;
    if to_regclass('public.' || t.tbl) is null then
      row_count := null; row_data := to_jsonb('not in this project'::text);
    else
      execute format('select count(*), jsonb_agg(to_jsonb(x)) from public.%I x where %s', t.tbl, t.cond)
        into row_count, row_data using p_user, v_name, p_user::text;
    end if;
    return next;
  end loop;

  -- Notifications written before lockdown2.sql record no sender, and some
  -- carry the name only in their text ("X left your party"). A text match can
  -- hit another player, so these are shown for a person to judge, never
  -- erased automatically.
  source := 'notifications - older rows that mention the name (review by hand)';
  row_count := null; row_data := null;
  -- (only for a name of the site's shape: a signup name is unchecked, and a
  -- regex character in it would abort the query)
  if v_name ~ '^[A-Za-z0-9_-]+$' and to_regclass('public.notifications') is not null then
    select count(*), jsonb_agg(to_jsonb(n)) into row_count, row_data
      from public.notifications n
     where to_jsonb(n)->>'sender_id' is null and n.user_id <> p_user
       and (coalesce(n.title, '') || ' ' || coalesce(n.body, '')) ~ ('(^|[^A-Za-z0-9_-])' || v_name || '($|[^A-Za-z0-9_-])');
  end if;
  return next;

  source := 'storage: avatars';
  begin
    select count(*), jsonb_agg(o.name) into row_count, row_data
      from storage.objects o
     where o.bucket_id = 'avatars' and (storage.foldername(o.name))[1] = p_user::text;
  exception when others then
    row_count := null; row_data := to_jsonb(sqlerrm);
  end;
  return next;
end;
$$;

-- ── 3. erasure ──────────────────────────────────────────────────────────────
create or replace function public.gdpr_erase_user(p_user uuid, p_confirm text, keep_ban_names boolean default true)
returns table (item text, rows_affected bigint)
language plpgsql
set search_path = public
as $$
declare
  t        record;
  v_name   text;
  v_builds text[];
  v_types  text[];
  n        bigint;
begin
  if p_user is null then raise exception 'user id required'; end if;
  if to_regproc('public.site_admin_ids') is not null and p_user = any (public.site_admin_ids()) then
    raise exception 'refusing to erase a site admin account';
  end if;

  select p.username into v_name from public.profiles p where p.id = p_user;
  if v_name is null then
    select u.raw_user_meta_data->>'username' into v_name from auth.users u where u.id = p_user;
  end if;
  if p_confirm is distinct from 'ERASE ' || coalesce(v_name, p_user::text) then
    raise exception 'confirmation must be exactly: ERASE %', coalesce(v_name, p_user::text);
  end if;

  for t in select * from public.gdpr_targets() order by ord loop
    item := t.tbl;
    n := null;
    -- A missing TABLE is skipped and says so. A missing COLUMN is an error
    -- that rolls the whole erase back: a typo in gdpr_targets must never be
    -- reported as "nothing to erase".
    if to_regclass('public.' || t.tbl) is null then
      item := t.tbl || ' (not in this project)';
    else
      if t.how = 'delete' then
        execute format('delete from public.%I x where %s', t.tbl, t.cond) using p_user, v_name, p_user::text;
        get diagnostics n = row_count;

      elsif t.how = 'builds' then
        -- Their gallery builds, then every like and delete marker pointing at
        -- them (those carry a build id, not a person).
        execute format('select array_agg(x.id) from public.shared_builds x where %s', t.cond)
          into v_builds using p_user, v_name, p_user::text;
        delete from public.shared_builds where id = any (coalesce(v_builds, '{}'));
        get diagnostics n = row_count;
        delete from public.shared_builds where payload->>'_buildId' = any (coalesce(v_builds, '{}'));

      elsif t.how = 'records' then
        -- An all-time record passes to the best score still on the board.
        select array_agg(qte_type) into v_types from public.leaderboard_records where user_id = p_user;
        delete from public.leaderboard_records where user_id = p_user;
        get diagnostics n = row_count;
        if v_types is not null and to_regproc('public.rebuild_leaderboard_record') is not null then
          perform public.rebuild_leaderboard_record(x) from unnest(v_types) as x;
        end if;

      elsif t.how = 'anonymise' then
        execute format('update public.%I x set user_id = null, donor_name = ''Anonymous'' where %s', t.tbl, t.cond)
          using p_user, v_name, p_user::text;
        get diagnostics n = row_count;
        item := t.tbl || ' (anonymised, kept for accounting)';

      elsif t.how = 'bans' then
        if keep_ban_names then
          execute format('update public.%I set user_id = null where user_id = $1', t.tbl) using p_user;
          get diagnostics n = row_count;
          item := t.tbl || ' (name kept reserved, account link removed)';
        else
          execute format('delete from public.%I x where %s', t.tbl, t.cond) using p_user, v_name, p_user::text;
          get diagnostics n = row_count;
        end if;
      end if;
    end if;
    rows_affected := n;
    return next;
  end loop;

  -- Older notifications naming them in text only: counted, left for a person
  -- (see gdpr_user_data - a text match can hit another player).
  item := 'notifications - older rows that mention the name: review them in gdpr_user_data and delete by hand';
  rows_affected := null;
  if v_name ~ '^[A-Za-z0-9_-]+$' and to_regclass('public.notifications') is not null then
    -- (alias nt, not n: n is this function's row counter)
    select count(*) into rows_affected
      from public.notifications nt
     where to_jsonb(nt)->>'sender_id' is null and nt.user_id <> p_user
       and (coalesce(nt.title, '') || ' ' || coalesce(nt.body, '')) ~ ('(^|[^A-Za-z0-9_-])' || v_name || '($|[^A-Za-z0-9_-])');
  end if;
  return next;

  -- Stored files cannot be deleted from SQL on Supabase: list them.
  item := 'storage: avatars - delete folder ' || p_user::text || ' in Dashboard > Storage > avatars';
  begin
    select count(*) into rows_affected from storage.objects o
     where o.bucket_id = 'avatars' and (storage.foldername(o.name))[1] = p_user::text;
  exception when others then
    rows_affected := null;
  end;
  return next;

  -- The account itself (sessions, identities and login go with it).
  begin
    delete from auth.users where id = p_user;
    get diagnostics n = row_count;
    item := case when n > 0 then 'auth.users deleted' else 'auth.users (no account with that id)' end;
    rows_affected := n;
  exception when others then
    item := 'auth.users NOT deleted (' || sqlerrm || ') - delete the user in Dashboard > Authentication > Users';
    rows_affected := 0;
  end;
  return next;
end;
$$;

-- Nobody but the SQL editor. (A fresh CREATE hands EXECUTE to PUBLIC.)
revoke all on function public.gdpr_find_user(text)                    from public, anon, authenticated;
revoke all on function public.gdpr_targets()                          from public, anon, authenticated;
revoke all on function public.gdpr_user_data(uuid)                    from public, anon, authenticated;
revoke all on function public.gdpr_erase_user(uuid, text, boolean)    from public, anon, authenticated;

commit;
