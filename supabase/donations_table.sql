-- ================================================================
--  AL Builder — Donations table
--  Run this in: Supabase Dashboard > SQL Editor
--
--  Stores minimal data — no card numbers, no emails, no names.
--  Only Stripe's payment intent ID and the amount, for your records.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.donations (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  stripe_payment_id TEXT        NOT NULL UNIQUE,   -- for refund lookups
  amount_cents      INTEGER     NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 500000),
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security — nobody can read or write this table directly from the browser.
-- Only the webhook Edge Function (which runs with the service role key) can insert rows.
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

-- Explicitly deny all access — service role bypasses RLS automatically.
CREATE POLICY "donations: no public access" ON public.donations
  FOR ALL USING (false);
