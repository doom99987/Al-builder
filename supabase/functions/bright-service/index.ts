// @ts-nocheck
// ================================================================
//  AL Builder — QTE score check
//  Supabase Edge Function (Deno runtime)
//
//  Deploy:  supabase functions deploy bright-service
//  No secrets to set: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
//  provided to every edge function by Supabase.
//
//  The browser sends { run, ticket, qte_type, platform, attempt, score, log }.
//  This function:
//    1. identifies the player from their JWT (never from the body);
//    2. runs the trainer's check on the log (../_shared/qte-rules.js - a
//       byte-identical copy of the site's js/qte-rules.js);
//    3. hands the verdict to qte_accept_run (supabase/qte-verified.sql), which
//       checks the ticket against the run's secret seed and the log's length
//       against the run's age, then posts, holds or refuses.
//  Only this function holds the key that may call qte_accept_run, so a score
//  cannot reach the board without its log passing the check.
// ================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import '../_shared/qte-rules.js';

const Q = globalThis.QteRules;

const SITE_ORIGINS = new Set([
  'https://arcanelineagebuilder.com',
  'https://www.arcanelineagebuilder.com',
]);
function isLocalDev(origin: string) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function corsFor(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = SITE_ORIGINS.has(origin) || isLocalDev(origin) ? origin : 'https://arcanelineagebuilder.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
    'Vary': 'Origin',
  };
}
function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// The body, read no further than MAX_BYTES (a byte count, not characters):
// null when it is bigger.
async function readCapped(req: Request): Promise<string | null> {
  const max = Q.LIMITS.MAX_BYTES;
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { try { await reader.cancel(); } catch (_) {} return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  try {
    return await handle(req, cors);
  } catch (e) {
    // Never a bare 500: the browser needs the CORS headers to read the answer.
    console.error('[bright-service] unexpected', e && e.message);
    return json({ status: 'retry' }, 503, cors);
  }
});

async function handle(req: Request, cors: Record<string, string>) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST')    return json({ status: 'bad_input' }, 405, cors);

  // Size first, before parsing anything.
  const raw = await readCapped(req);
  if (raw === null) return json({ status: 'rejected', reason: 'log too large' }, 200, cors);

  // Who is asking: the JWT, never the body.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ status: 'no_session' }, 401, cors);
  let userId = null;
  try { const { data: who } = await admin.auth.getUser(jwt); userId = who?.user?.id || null; } catch (_) { userId = null; }
  if (!userId) return json({ status: 'no_session' }, 401, cors);

  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ status: 'bad_input' }, 200, cors); }
  const { run, ticket, qte_type, platform, attempt, score, log, ticket_at } = body || {};

  // No ticket, no run: this run was never started with the server.
  if (typeof run !== 'string' || !UUID.test(run) || typeof ticket !== 'string' || !/^[0-9a-f]{64}$/.test(ticket)) {
    return json({ status: 'rejected', reason: 'no ticket for this run' }, 200, cors);
  }
  if (typeof qte_type !== 'string' || !/^[a-z]+(-new)?(-comp)?$/.test(qte_type) || qte_type.length > 32
      || (platform !== 'M' && platform !== 'C')
      || !Number.isInteger(attempt) || attempt < 0 || attempt > 100000
      || !Number.isInteger(score) || score < 1 || score > 1000000
      || (log && typeof log === 'object' && log.a !== attempt)) {
    return json({ status: 'bad_input' }, 200, cors);
  }

  const res = Q.check(qte_type, log, { platform, claimed: score });
  const rulesVer = Number.isInteger(log?.rv) && log.rv >= 0 && log.rv <= 1000000 ? log.rv : null;
  const ticketAt = Number.isInteger(ticket_at) && ticket_at >= 0 && ticket_at <= 3600000 ? ticket_at : null;

  if (res.verdict === 'invalid' || res.score <= 0) {
    // Recorded (with a genuine ticket only) so a rule that trips real
    // players shows up in qte_run_rejects; the run is closed.
    // (An rpc() builder only has then(): await it, never .catch() it.)
    const { error: nrErr } = await admin.rpc('qte_note_reject', {
      p_user: userId, p_run: run, p_ticket: ticket, p_qte_type: qte_type, p_attempt: attempt, p_claimed: score,
      p_reasons: res.reasons, p_stats: res.stats, p_rules_ver: rulesVer,
    });
    if (nrErr) console.error('[bright-service] qte_note_reject', nrErr.message);
    return json({ status: 'rejected', reason: (res.reasons[0] || 'the run could not be verified').slice(0, 200) }, 200, cors);
  }

  // The first 24 events, times included: two honest runs never share them,
  // and a log sent again under a new ticket does (qte_log_prints).
  let print = null;
  if (Array.isArray(log?.ev) && log.ev.length >= 24) {
    const bytes = new TextEncoder().encode(JSON.stringify(log.ev.slice(0, 24)));
    print = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  }

  const { data: status, error } = await admin.rpc('qte_accept_run', {
    p_user: userId, p_run: run, p_ticket: ticket, p_qte_type: qte_type, p_platform: platform,
    p_attempt: attempt, p_claimed: score, p_score: res.score, p_end_ms: res.endMs,
    p_verdict: res.verdict, p_reasons: res.reasons, p_stats: res.stats,
    p_log: log,   // stored only if the run is held, for the admin to look at
    p_rules_ver: rulesVer,
    p_print: print,
    p_ticket_at: ticketAt,
  });
  if (error) {
    console.error('[bright-service] qte_accept_run', error.message);
    return json({ status: 'retry' }, 503, cors);
  }
  return json({ status, score: Math.min(score, res.score), claimed: score }, 200, cors);
}
