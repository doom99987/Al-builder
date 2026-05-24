// @ts-nocheck
// ================================================================
//  AL Builder — Stripe webhook receiver
//  Supabase Edge Function (Deno runtime)
//
//  Required secrets:
//    STRIPE_SECRET_KEY       — Stripe dashboard > Developers > API keys
//    STRIPE_WEBHOOK_SECRET   — Stripe dashboard > Developers > Webhooks > signing secret
//
//  Stripe events to enable on the webhook endpoint:
//    checkout.session.completed
// ================================================================
import Stripe from 'npm:stripe@14';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
});
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

// Service-role client — bypasses RLS so the webhook can write to donations table
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    console.warn('[stripe-webhook] Missing stripe-signature header');
    return new Response('Missing signature', { status: 400 });
  }

  // Read raw body — must NOT be parsed before verification
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    // constructEventAsync verifies the HMAC signature — this is the critical security step.
    // If the signature is wrong (tampered payload or wrong secret), it throws.
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[stripe-webhook] Signature verification failed:', msg);
    return new Response(`Webhook verification failed: ${msg}`, { status: 400 });
  }

  // Only handle completed checkout sessions
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.CheckoutSession;

    // Only log actually-paid sessions (not e.g. bank transfers still pending)
    if (session.payment_status === 'paid' && session.payment_intent) {
      const rawDonorName = typeof session.metadata?.donor_name === 'string'
        ? session.metadata.donor_name.trim()
        : '';
      const donorName = rawDonorName.slice(0, 30) || 'Anonymous';

      const { error } = await supabase.from('donations').insert({
        stripe_payment_id: String(session.payment_intent),
        amount_cents:      session.amount_total ?? 0,
        donor_name:        donorName,
      });
      if (error) {
        // Log but don't return 500 — Stripe would retry, causing duplicates.
        // The UNIQUE constraint on stripe_payment_id already prevents duplicate rows.
        if (error.code !== '23505') {
          console.error('[stripe-webhook] DB insert error:', error.message);
        }
      } else {
        console.log('[stripe-webhook] Donation logged:', session.payment_intent, session.amount_total);
      }
    }
  }

  // Always return 200 so Stripe doesn't retry unnecessarily
  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
