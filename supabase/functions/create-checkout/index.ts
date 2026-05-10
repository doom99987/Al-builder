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

// Only these preset amounts are accepted — prevents arbitrary billing
const ALLOWED_CENTS = new Set([100, 300, 500, 1000, 2000, 5000]);

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

  let body: { amount_cents?: unknown; success_url?: unknown; cancel_url?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }

  const { amount_cents, success_url, cancel_url } = body;

  // Strict server-side validation — client cannot pass arbitrary amounts
  if (typeof amount_cents !== 'number' || !ALLOWED_CENTS.has(amount_cents)) {
    return json({ error: 'Invalid donation amount.' }, 400);
  }
  if (typeof success_url !== 'string' || typeof cancel_url !== 'string') {
    return json({ error: 'Missing redirect URLs.' }, 400);
  }

  // Basic URL safety — only allow https:// redirects
  if (!success_url.startsWith('https://') || !cancel_url.startsWith('https://')) {
    return json({ error: 'Redirect URLs must use HTTPS.' }, 400);
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
    });

    return json({ url: session.url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Stripe error.';
    console.error('[create-checkout] Stripe error:', msg);
    return json({ error: 'Could not create checkout session.' }, 500);
  }
});
