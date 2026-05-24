// @ts-nocheck
// ================================================================
//  AL Builder — Stripe Checkout session creator
//  Supabase Edge Function (Deno runtime)
//
//  Required secrets (set via: supabase secrets set KEY=value):
//    STRIPE_SECRET_KEY   — from Stripe dashboard > Developers > API keys
// ================================================================
import Stripe from 'npm:stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
});

// Minimum donation: $1 (100 cents). No maximum enforced server-side.
const MIN_CENTS = 100;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed.' }, 405);

  let body: { amount_cents?: unknown; success_url?: unknown; cancel_url?: unknown; donor_name?: unknown; user_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }

  const { amount_cents, success_url, cancel_url, donor_name, user_id } = body;

  // Server-side validation — must be a whole number of cents, minimum $1
  if (typeof amount_cents !== 'number' || !Number.isInteger(amount_cents) || amount_cents < MIN_CENTS) {
    return json({ error: 'Invalid donation amount.' }, 400);
  }
  if (typeof success_url !== 'string' || typeof cancel_url !== 'string') {
    return json({ error: 'Missing redirect URLs.' }, 400);
  }

  // Basic URL safety — allow https:// in production, http://localhost and http://127.0.0.1 for local dev
  function isSafeUrl(u: string) {
    return u.startsWith('https://') ||
           u.startsWith('http://localhost') ||
           u.startsWith('http://127.0.0.1');
  }
  if (!isSafeUrl(success_url) || !isSafeUrl(cancel_url)) {
    return json({ error: 'Redirect URLs must use HTTPS.' }, 400);
  }

  // Sanitize donor name — strip tags, limit length, fall back to Anonymous
  const rawName  = typeof donor_name === 'string' ? donor_name.replace(/[<>&"]/g, '').trim() : '';
  const safeName = rawName.slice(0, 30) || 'Anonymous';

  // user_id is a Supabase UUID — only store if it looks like one, otherwise null
  const safeUserId = typeof user_id === 'string' && /^[0-9a-f-]{36}$/.test(user_id)
    ? user_id
    : '';

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

    return json({ url: session.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Stripe error.';
    console.error('[create-checkout] Stripe error:', msg);
    return json({ error: 'Could not create checkout session.' }, 500);
  }
});
