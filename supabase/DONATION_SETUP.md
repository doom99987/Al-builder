# Donation Button Setup Guide

Everything is pre-built. Follow these steps when you're ready to go live.

---

## Step 1 — Create a Stripe account

1. Go to https://stripe.com and sign up (or log in)
2. Complete identity verification so payouts are enabled
3. Make sure you're in **Live mode** (toggle in the top-left of the dashboard) before going live. Use **Test mode** first.

---

## Step 2 — Get your Stripe API keys

In the Stripe dashboard: **Developers → API keys**

- **Publishable key** — starts with `pk_live_...` (not needed for this setup)
- **Secret key** — starts with `sk_live_...` — **NEVER put this in client code**

---

## Step 3 — Deploy the Edge Functions

Make sure you have the Supabase CLI installed:
```
npm install -g supabase
supabase login
```

From the project root (`Al-builder/`):
```
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook
```

---

## Step 4 — Set the secrets

```
supabase secrets set STRIPE_SECRET_KEY=sk_live_YOUR_KEY_HERE
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET_HERE
```

The `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — you don't need to set those.

---

## Step 5 — Set up the Stripe Webhook

In the Stripe dashboard: **Developers → Webhooks → Add endpoint**

- **Endpoint URL:**
  ```
  https://mpqohagljmvwftwqumnh.supabase.co/functions/v1/stripe-webhook
  ```
- **Events to listen for:**
  - `checkout.session.completed`

After saving, click the webhook and copy the **Signing secret** (starts with `whsec_...`).
Paste it into the `supabase secrets set` command from Step 4.

---

## Step 6 — Run the donations table SQL

In the Supabase Dashboard → SQL Editor, paste and run the contents of `donations_table.sql`.

---

## Step 7 — Run the RLS SQL (if you haven't already)

If you haven't run the main RLS policies yet, do that too (the block from the security audit).

---

## Step 8 — Test in Stripe Test Mode

1. Switch Stripe to **Test mode**
2. Use test key `sk_test_...` in the secrets temporarily
3. Add `js/donation.js` to `index.html` temporarily:
   ```html
   <script src="js/donation.js?v=1"></script>
   ```
4. Open browser console and call: `window._openDonationModal()`
5. Pick an amount, click Donate
6. Use Stripe's test card: `4242 4242 4242 4242`, any future date, any CVC
7. Should redirect back with `?donated=1` and show the thank-you modal
8. Check Stripe dashboard → Payments to confirm it logged
9. Check Supabase → Table Editor → donations to confirm the row was inserted

---

## Step 9 — Go live

1. Switch back to **Live mode** keys in both Stripe and Supabase secrets
2. Add the script tag to `index.html` **without** a button yet — it'll be silently available
3. When you want to show the button, add it to your HTML and it calls `window._openDonationModal()`

---

## What's protected and how

| Threat | Protection |
|---|---|
| Someone sends an arbitrary amount | Edge function rejects anything not in the preset list |
| Fake webhook events | Stripe HMAC signature verified before any processing |
| Card data exposure | Stripe Checkout — card data never touches your server |
| Direct DB donation inserts | RLS policy blocks all public access; only service role (webhook) can insert |
| Secret key exposure | Only stored as Supabase secret, never in client code |
| Duplicate webhook replay | `UNIQUE` constraint on `stripe_payment_id` — duplicate ignored |

---

## Adding the button (when ready)

Add to `index.html`:
```html
<script src="js/donation.js?v=1"></script>
```

Then wherever you want the button:
```html
<button onclick="window._openDonationModal()">Donate</button>
```

That's it.
