-- ===========================================================================
-- AL BUILDER - Stop the supporters list from exposing donors' account IDs
-- Run this whole file once in the Supabase SQL editor (Dashboard > SQL > New query).
-- Safe to re-run.
--
-- ORDER MATTERS: run this file, and the CHECK queries at the bottom, BEFORE the
-- matching js/donation.js, js/trades.js, html/privacy.html and index.html changes
-- go live. Pushed first, the page calls a top_supporters() that does not exist
-- yet ("Could not load supporters."), and the updated privacy text ("account IDs
-- are not sent to visitors") is false while the table is still readable. After
-- running it, an anonymous request to /rest/v1/donations should be refused
-- (401/403, permission denied) instead of HTTP 200.
-- ===========================================================================
--
-- THE LEAK
-- The home page's supporters list read the donations table straight from the
-- browser with the public anon key:
--
--     sb.from('donations').select('donor_name, amount_cents, user_id')
--
-- so every visitor received every donation row, including the account ID of
-- anyone who donated while logged in - even when the donation was listed as
-- "Anonymous". Confirmed live as an anonymous visitor (2026-09-15): a HEAD
-- request on /rest/v1/donations answered HTTP 200 with a row count.
--
-- THE FIX
--   (1) top_supporters(): builds the list on the server and returns only what
--       the page shows - a display name and an amount. No account IDs, no
--       per-donation rows, no payment references.
--   (2) The anon and authenticated roles lose all access to the donations
--       table itself. The Stripe webhook writes with the service-role key,
--       which bypasses these grants and RLS, so donations keep being recorded.
--
-- The grouping matches what js/donation.js used to do in the browser:
--   - donations made while logged in (user_id not null) are added together into
--     one entry per account, shown under the donor name of the most recent one;
--   - donations made while logged out are listed one by one;
--   - the list is ordered by amount, largest first.
-- A blank donor name is already stored as 'Anonymous' by the webhook; the
-- coalesce below only guards against an empty or null value.
-- ===========================================================================

create or replace function public.top_supporters(max_rows int default 10)
returns table (donor_name text, amount_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  with entries as (
    -- one entry per logged-in donor, under their most recent donor name
    select
      coalesce(nullif(btrim((array_agg(d.donor_name::text order by d.created_at desc nulls last))[1]), ''), 'Anonymous') as donor_name,
      sum(d.amount_cents)::bigint as amount_cents,
      max(d.created_at) as last_at
    from public.donations d
    where d.user_id is not null
    group by d.user_id

    union all

    -- each logged-out donation on its own
    select
      coalesce(nullif(btrim(d.donor_name::text), ''), 'Anonymous') as donor_name,
      d.amount_cents::bigint as amount_cents,
      d.created_at as last_at
    from public.donations d
    where d.user_id is null
  )
  select e.donor_name, e.amount_cents
  from entries e
  order by e.amount_cents desc, e.last_at desc nulls last
  -- Capped at the 10 entries the page shows, so nobody can ask for more names
  -- than the list displays. Raise this and the max_rows in js/donation.js together.
  limit greatest(1, least(coalesce(max_rows, 10), 10));
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function; take it away, then
-- grant it deliberately to the two roles the website uses.
revoke all on function public.top_supporters(int) from public;
grant execute on function public.top_supporters(int) to anon, authenticated;

-- The table itself: no direct access for website visitors, signed in or not.
-- Revoking the privileges is enough on its own; RLS stays on as a second layer,
-- so a future grant still needs a policy before it exposes any rows.
alter table public.donations enable row level security;
revoke all on table public.donations from anon, authenticated;

-- ===========================================================================
-- CHECK IT WORKED (run these after the file; each should give the result shown)
-- ===========================================================================
--   select has_table_privilege('anon', 'public.donations', 'select');          -- false
--   select has_table_privilege('authenticated', 'public.donations', 'select'); -- false
--   select has_function_privilege('anon', 'public.top_supporters(int)', 'execute'); -- true
--   select * from public.top_supporters(10);   -- donor_name and amount_cents only
-- ===========================================================================
