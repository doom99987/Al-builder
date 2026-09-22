// @ts-nocheck
// ================================================================
//  AL Builder — Stripe Checkout session creator
//  Supabase Edge Function (Deno runtime)
//
//  Required secrets (set via: supabase secrets set KEY=value):
//    STRIPE_SECRET_KEY   — from Stripe dashboard > Developers > API keys
// ================================================================
import Stripe from 'npm:stripe@14';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
});

// Minimum donation: $1 (100 cents). No maximum enforced server-side.
const MIN_CENTS = 100;

// Only the site itself may call this, and only the site may be redirected to
// after payment. With '*' and "any https URL", anyone could mint a genuine
// checkout page under AL Builder's Stripe branding that sends the payer to a
// page of their choosing afterwards, and credit the donation to themselves.
const SITE_ORIGINS = new Set([
  'https://arcanelineagebuilder.com',
  'https://www.arcanelineagebuilder.com',
]);
function isLocalDev(origin: string) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

// The browser only accepts the answer if the header names its own origin, so
// an allowed origin is echoed (the site, or a local dev server); anything
// else gets the site's origin and its browser refuses the response.
function corsFor(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = SITE_ORIGINS.has(origin) || isLocalDev(origin) ? origin : 'https://arcanelineagebuilder.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
    'Vary': 'Origin',
  };
}

// cors is required, so a response without the request's CORS headers cannot
// be written by accident (the browser would drop it without saying why).
function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  // CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed.' }, 405, cors);

  let body: { amount_cents?: unknown; success_url?: unknown; cancel_url?: unknown; donor_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON.' }, 400, cors);
  }

  const { amount_cents, success_url, cancel_url, donor_name } = body;

  // Server-side validation — must be a whole number of cents, minimum $1
  if (typeof amount_cents !== 'number' || !Number.isInteger(amount_cents) || amount_cents < MIN_CENTS) {
    return json({ error: 'Invalid donation amount.' }, 400, cors);
  }
  if (typeof success_url !== 'string' || typeof cancel_url !== 'string') {
    return json({ error: 'Missing redirect URLs.' }, 400, cors);
  }

  // The redirect targets must be the site (or a local dev server). Parsed as
  // URLs, not prefix-matched: 'http://localhost.evil.example' starts with
  // 'http://localhost' and is not local.
  function isSafeUrl(u: string) {
    try {
      const origin = new URL(u).origin;
      return SITE_ORIGINS.has(origin) || isLocalDev(origin);
    } catch {
      return false;
    }
  }
  if (!isSafeUrl(success_url) || !isSafeUrl(cancel_url)) {
    return json({ error: 'Redirect URLs must point at the site.' }, 400, cors);
  }

  // Sanitize donor name — strip tags, limit length, fall back to Anonymous
  const rawName  = typeof donor_name === 'string' ? donor_name.replace(/[<>&"]/g, '').trim() : '';
  const safeName = rawName.slice(0, 30) || 'Anonymous';

  // Derive user_id from the caller's verified JWT — never trust the body value,
  // or anyone could attribute donations to another account. The client sends the
  // logged-in user's access token as the Authorization bearer (anon key for guests).
  let safeUserId = '';
  const authToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (authToken && authToken !== Deno.env.get('SUPABASE_ANON_KEY')) {
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
      );
      const { data } = await supabase.auth.getUser(authToken);
      if (data?.user?.id) safeUserId = data.user.id;
    } catch (_) { /* invalid/expired token → treat as anonymous */ }
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'AL Builder — Thank You!',
            description: 'Support the AL Builder project. Every dollar helps keep it running.',
          },
          unit_amount: amount_cents,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url,
      cancel_url,
      // No billing_address_collection — minimises data collected
      billing_address_collection: 'auto',
      // Don't pre-fill anything — no PII passed from our side
      metadata: { donor_name: safeName, user_id: safeUserId },
    });

    return json({ url: session.url }, 200, cors);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Stripe error.';
    console.error('[create-checkout] Stripe error:', msg);
    return json({ error: 'Could not create checkout session.' }, 500, cors);
  }
});
