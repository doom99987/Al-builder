-- Matchmaking, when it comes back: hardened bodies and the re-grants
-- ============================================================================
-- DO NOT RUN THIS while matchmaking is disabled. supabase/lockdown2.sql
-- revoked every mm_* function and every write on mm_queue because the
-- feature is off (index.html, "Matchmaking is disabled"). This file is the
-- other half: run it, after rpc-anon-lockout.sql, when the UI is switched
-- back on. It is idempotent.
--
-- What it fixes, found by the 2026-09-22 audit with the feature off:
--   1. mm_apply_result let the host claim a win against an opponent who had
--      never joined the match (queue sniping: pair yourself with any queued
--      player by calling mm_create_match directly, skip the broadcast the
--      client relies on, wait 15 s, report a win with a self-written round
--      log). A win now needs the opponent's heartbeat stamp on the match.
--   2. A NULL winner slipped past every rule (NULL comparisons do not branch)
--      and ended an unrated match with no winner. Refused outright.
--   3. The round log had no size cap. 4 KB is plenty for a best-of-three.
--   4. mm_queue rows carried client-chosen created_at / seen_at, so a queued
--      row could be made to never go stale. A trigger stamps both.
--   5. mm_report_disconnect left a match that nobody joined active forever.
-- ============================================================================

begin;

create or replace function public.mm_apply_result(match uuid, winner uuid, p_rounds jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m        mm_matches;
  me       uuid := auth.uid();
  host     uuid;
  won_by   int;
  opp_seen timestamptz;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if winner is null then raise exception 'winner required'; end if;
  if p_rounds is not null and (jsonb_typeof(p_rounds) <> 'array' or pg_column_size(p_rounds) > 4096) then
    raise exception 'bad round log';
  end if;

  select * into m from mm_matches where id = match for update;
  if m.id is null or m.status = 'done' then return; end if;
  if me <> m.p1_id and me <> m.p2_id then return; end if;
  if winner <> m.p1_id and winner <> m.p2_id then return; end if;

  host := least(m.p1_id, m.p2_id);

  -- (1) Only the host may report a win. `winner <> me` is a concession, and
  --     anyone may concede - that is what mm_abandon_match does.
  if winner = me and me <> host then
    raise exception 'only the host may report the winner of a match';
  end if;

  -- (3) A match cannot legitimately be WON this fast.
  if winner = me and m.created_at > now() - interval '15 seconds' then
    raise exception 'match ended implausibly quickly';
  end if;

  -- (4) A win can only be claimed against an opponent who joined the match:
  --     enterMatch pings first thing (js/matchmaking.js), so a real opponent
  --     always has a stamp, and a queue-sniped one never does.
  opp_seen := case when me = m.p1_id then m.p2_seen_at else m.p1_seen_at end;
  if winner = me and opp_seen is null then
    raise exception 'opponent never joined this match';
  end if;

  -- (2) A claimed ranked win must carry a log that supports it.
  if m.mode = 'ranked' and winner = me then
    if p_rounds is null then
      raise exception 'a ranked result must include its round log';
    end if;
    select count(*) into won_by
      from jsonb_array_elements(p_rounds) r
     where r ->> 'w' = winner::text;
    if won_by < 2 then
      raise exception 'round log does not support the reported winner';
    end if;
  end if;

  perform mm_settle(match, winner, p_rounds);
end;
$$;

create or replace function public.mm_report_disconnect(match uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m        mm_matches;
  me       uuid := auth.uid();
  opp_seen timestamptz;
begin
  if me is null then return null; end if;

  select * into m from mm_matches where id = match for update;
  if m.id is null then return null; end if;
  if me <> m.p1_id and me <> m.p2_id then return null; end if;
  if m.status = 'done' then return m.winner_id; end if;
  if m.created_at > now() - interval '20 seconds' then return null; end if;

  opp_seen := case when me = m.p1_id then m.p2_seen_at else m.p1_seen_at end;

  -- (5) Never pinged: an old client, or nobody there. After two minutes the
  --     match is void - no winner, no rating change - instead of active forever.
  if opp_seen is null then
    if m.created_at < now() - interval '2 minutes' then
      update mm_matches
         set status = 'done', ended_at = now(), winner_id = null, p1_rr_delta = 0, p2_rr_delta = 0
       where id = match;
    end if;
    return null;
  end if;

  if opp_seen > now() - interval '30 seconds' then return null; end if;

  perform mm_settle(match, me, null);
  return me;
end;
$$;

-- (4) The database stamps the queue row; the client's clock is not consulted.
create or replace function public.mm_queue_stamp() returns trigger
language plpgsql
as $$
begin
  new.seen_at := now();
  new.created_at := case when tg_op = 'INSERT' then now() else old.created_at end;
  return new;
end;
$$;
drop trigger if exists mm_queue_stamp on public.mm_queue;
create trigger mm_queue_stamp before insert or update on public.mm_queue
  for each row execute function public.mm_queue_stamp();

-- The queue takes writes again, own rows only; reads stay own-row (set by
-- lockdown2.sql) - the client never lists the queue, it asks mm_queue_counts.
grant insert, update, delete on table public.mm_queue to authenticated;
drop policy if exists mm_queue_write_own on public.mm_queue;
create policy mm_queue_write_own on public.mm_queue for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Hand the functions back to signed-in players. create or replace above kept
-- the revokes from lockdown2.sql in place, so this is the only grant.
revoke all on function public.mm_apply_result(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mm_report_disconnect(uuid)         from public, anon, authenticated;
grant execute on function public.mm_create_match(uuid)              to authenticated;
grant execute on function public.mm_apply_result(uuid, uuid, jsonb) to authenticated;
grant execute on function public.mm_abandon_match(uuid)             to authenticated;
grant execute on function public.mm_report_disconnect(uuid)         to authenticated;
grant execute on function public.mm_match_ping(uuid)                to authenticated;
grant execute on function public.mm_queue_counts()                  to authenticated;
-- mm_settle stays callable by nobody; the definers above reach it.

notify pgrst, 'reload schema';

commit;
