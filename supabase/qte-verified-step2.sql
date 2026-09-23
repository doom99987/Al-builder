-- QTE scores: close the old way in (step 2 of qte-verified.sql's runbook)
-- ============================================================================
-- Run this AFTER qte-verified.sql, `supabase functions deploy bright-service`, and
-- the site push - once the new pages are the ones in use (a day is plenty:
-- open tabs are told to reload by version.json).
--
-- Until this runs, submit_score still takes a number from any signed-in
-- caller, under the old cap/timing/hold rules. After it, the ONLY way onto the
-- board is the bright-service edge function, which checks the run's log.
--
-- An old cached page that still calls these gets "permission denied"; sb.js
-- keeps that score and says "still trying" - it cannot post it any more.
--
-- To undo (re-open the old path):
--   comment on function public.submit_score(uuid, text, integer, text, text, uuid) is null;
--   comment on function public.start_qte_session(uuid, text) is null;
--   grant execute on function public.submit_score(uuid, text, integer, text, text, uuid) to authenticated;
--   grant execute on function public.start_qte_session(uuid, text) to authenticated;
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.qte_accept_run(uuid, uuid, text, text, text, integer, integer, integer, bigint, text, jsonb, jsonb, jsonb, integer, text, integer)') is null then
    raise exception 'run supabase/qte-verified.sql first';
  end if;
end $$;

revoke all on function public.submit_score(uuid, text, integer, text, text, uuid) from public, anon, authenticated;
revoke all on function public.start_qte_session(uuid, text) from public, anon, authenticated;
-- The mark lockdown.sql and qte-scores.sql read before granting these again:
-- re-running either of them must not re-open the old way in.
comment on function public.submit_score(uuid, text, integer, text, text, uuid) is 'closed by qte-verified-step2.sql';
comment on function public.start_qte_session(uuid, text) is 'closed by qte-verified-step2.sql';

notify pgrst, 'reload schema';

commit;

-- Check (expect 42501 / permission denied for both):
--   await _sbClient.rpc('submit_score', { p_user_id: null, p_qte_type: 'dagger', p_score: 1, p_platform: 'C', p_month: '2026-09', p_session_id: null })
--   await _sbClient.rpc('start_qte_session', { p_user_id: null, p_qte_type: 'dagger' })
