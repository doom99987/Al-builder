// ================================================================
//  AL Builder — Donation flow
//  NOT wired to any button yet — add the script tag and call
//  window._openDonationModal() from a button when ready.
// ================================================================
(function () {
  'use strict';

  // Edge function URL — matches your Supabase project
  const CHECKOUT_URL = 'https://mpqohagljmvwftwqumnh.supabase.co/functions/v1/create-checkout';
  // Anon key is safe to include here — it's already public in sb.js
  const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wcW9oYWdsam12d2Z0d3F1bW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMzg1NzEsImV4cCI6MjA5MzYxNDU3MX0.WfU88Ell1Q6jCcef2YiohxIeTHBNfruIxYWoa1QRCUc';

  const PRESETS = [
    { label: '$1',  cents: 100 },
    { label: '$3',  cents: 300 },
    { label: '$5',  cents: 500 },
    { label: '$10', cents: 1000 },
    { label: '$20', cents: 2000 },
    { label: '$50', cents: 5000 },
  ];

  // Allowed amounts mirrored from the edge function — client can't sneak in other values
  const ALLOWED_CENTS = new Set(PRESETS.map(p => p.cents));

  let _selected  = null; // currently selected amount in cents
  let _donorName = '';  // optional display name

  // ---- inject styles once ----
  function _injectStyles() {
    if (document.getElementById('don-styles')) return;
    const s = document.createElement('style');
    s.id = 'don-styles';
    s.textContent = `
      .don-grid   { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:14px; }
      .don-amt    { background:#2a2a2a; border:1px solid #444; color:#ccc; border-radius:5px;
                    padding:8px 0; font-size:15px; cursor:pointer; transition:border-color .15s,color .15s; }
      .don-amt:hover     { border-color:#888; color:#fff; }
      .don-amt.don-on    { border-color:#7a60dd; color:#fff; background:#2d2040; }
      .don-submit        { width:100%; padding:10px; background:#7a60dd; border:none; border-radius:5px;
                           color:#fff; font-size:15px; cursor:pointer; transition:opacity .15s; }
      .don-submit:disabled { opacity:.45; cursor:default; }
      .don-submit:not(:disabled):hover { opacity:.85; }
      .don-note   { color:#555; font-size:11px; margin:10px 0 0; text-align:center; }
      .don-err    { color:#ff8888; font-size:12px; min-height:16px; margin-bottom:8px; }
      .don-name   { width:100%; box-sizing:border-box; background:#1a1a1a; border:1px solid #333; color:#ccc;
                    border-radius:5px; padding:8px 10px; font-size:13px; margin-bottom:10px; outline:none; }
      .don-name:focus { border-color:#7a60dd; }
      .don-name-label { font-size:11px; color:#555; margin-bottom:5px; display:block; }
    `;
    document.head.appendChild(s);
  }

  // ---- modal ----
  function openDonationModal() {
    if (document.getElementById('donation-modal')) return;
    _injectStyles();
    _selected  = null;
    _donorName = (typeof window._sbGetUsername === 'function' && window._sbGetUsername()) || '';

    const overlay = document.createElement('div');
    overlay.id = 'donation-modal';
    overlay.className = 'sb-modal-overlay';
    overlay.innerHTML = `
      <div class="sb-modal-box" style="max-width:320px">
        <button class="sb-close" onclick="window._closeDonationModal()">&times;</button>
        <h2 style="color:#ccc;font-size:17px;margin:0 0 4px">Support AL Builder</h2>
        <p style="color:#777;font-size:12px;margin:0 0 14px;line-height:1.5">
          Helps keep the site running. No account needed.<br>
          We never see your card details — Stripe handles everything.
        </p>
        <div class="don-grid">
          ${PRESETS.map(p => `
            <button class="don-amt" data-cents="${p.cents}" onclick="window._donPick(${p.cents})">${p.label}</button>
          `).join('')}
        </div>
        <label class="don-name-label">Your name on the leaderboard (optional)</label>
        <input id="don-name-input" class="don-name" type="text" maxlength="30"
               placeholder="Anonymous"
               value="${_donorName.replace(/"/g, '&quot;')}"
               oninput="window._donNameChange(this.value)">
        <div id="don-err" class="don-err"></div>
        <button id="don-submit" class="don-submit" onclick="window._donSubmit()" disabled>Donate</button>
        <p class="don-note">Powered by Stripe &nbsp;·&nbsp; Secure &amp; encrypted</p>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) window._closeDonationModal(); });
  }

  function closeDonationModal() {
    document.getElementById('donation-modal')?.remove();
    _selected  = null;
    _donorName = '';
  }

  function nameChange(val) {
    _donorName = val;
  }

  function pickAmount(cents) {
    // Extra client-side guard — must be in the allowed set
    if (!ALLOWED_CENTS.has(cents)) return;
    _selected = cents;
    document.querySelectorAll('.don-amt').forEach(b => {
      b.classList.toggle('don-on', +b.dataset.cents === cents);
    });
    const btn = document.getElementById('don-submit');
    if (btn) btn.disabled = false;
  }

  // Returns true if the donor name contains a word from sb.js's shared profanity list
  function _nameHasProfanity(name) {
    const list = Array.isArray(window._sbProfanityList) ? window._sbProfanityList : [];
    const lower = name.toLowerCase();
    return list.some(w => lower.includes(w));
  }

  async function submitDonation() {
    if (!_selected || !ALLOWED_CENTS.has(_selected)) return;

    const errEl = document.getElementById('don-err');
    const btn   = document.getElementById('don-submit');
    if (errEl) errEl.textContent = '';
    if (btn)   { btn.disabled = true; btn.textContent = 'Redirecting to Stripe…'; }

    const base       = window.location.origin + window.location.pathname;
    const successUrl = base + '?donated=1';
    const cancelUrl  = base + '?donated=cancel';

    const nameInput = document.getElementById('don-name-input');
    const donorName = (nameInput ? nameInput.value.trim() : _donorName.trim()) || 'Anonymous';

    if (_nameHasProfanity(donorName)) {
      if (errEl) errEl.textContent = 'Please use an appropriate display name.';
      if (btn)   { btn.disabled = false; btn.textContent = 'Donate'; }
      return;
    }

    try {
      const res = await fetch(CHECKOUT_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey':        ANON_KEY,
        },
        body: JSON.stringify({
          amount_cents: _selected,
          success_url:  successUrl,
          cancel_url:   cancelUrl,
          donor_name:   donorName,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start checkout.');

      // Redirect to Stripe's hosted payment page — we never handle card data
      window.location.href = data.url;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.';
      if (errEl) errEl.textContent = msg;
      if (btn)   { btn.disabled = false; btn.textContent = 'Donate'; }
    }
  }

  // ---- handle return from Stripe ----
  function _checkReturn() {
    const p = new URLSearchParams(window.location.search);
    const v = p.get('donated');
    if (!v) return;

    // Clean the query string from the URL immediately
    history.replaceState({}, '', window.location.pathname);

    if (v === '1') {
      // Small delay so the page renders first
      setTimeout(() => {
        _injectStyles();
        const overlay = document.createElement('div');
        overlay.className = 'sb-modal-overlay';
        overlay.innerHTML = `
          <div class="sb-modal-box" style="max-width:300px;text-align:center">
            <button class="sb-close" onclick="this.closest('.sb-modal-overlay').remove()">&times;</button>
            <div style="font-size:40px;margin-bottom:8px">💜</div>
            <h2 style="color:#ccc;margin:0 0 8px">Thank you!</h2>
            <p style="color:#888;font-size:13px;margin:0">Your donation is hugely appreciated and helps keep AL Builder running.</p>
          </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        // Reload the leaderboard after verify-donation has had time to write the row
        setTimeout(() => {
          if (typeof window._loadDonorLeaderboard === 'function') {
            window._loadDonorLeaderboard('home-donors-list');
          }
        }, 3000);
      }, 400);
    }
    // cancelled — do nothing, user just came back to the page
  }

  _checkReturn();

  // ---- donation leaderboard ----
  async function loadDonorLeaderboard(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const sb = window._sbClient;
    if (!sb) {
      el.innerHTML = '<div class="don-lb-empty">Sign in to see supporters.</div>';
      return;
    }

    el.innerHTML = '<div class="don-lb-loading">Loading...</div>';

    const { data, error } = await sb
      .from('donations')
      .select('donor_name, amount_cents')
      .order('amount_cents', { ascending: false })
      .limit(10);

    if (error || !data) {
      el.innerHTML = '<div class="don-lb-empty">Could not load supporters.</div>';
      return;
    }

    if (!data.length) {
      el.innerHTML = '<div class="don-lb-empty">Be the first to support!</div>';
      return;
    }

    const medals = ['', '', '']; // gold, silver, bronze for top 3
    el.innerHTML = data.map((row, i) => {
      const medal  = medals[i] || '';
      const dollars = (row.amount_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
      const name   = row.donor_name || 'Anonymous';
      return `<div class="don-lb-row">
        <span class="don-lb-rank">${medal || (i + 1)}</span>
        <span class="don-lb-name">${name.replace(/</g, '&lt;')}</span>
        <span class="don-lb-amt">${dollars}</span>
      </div>`;
    }).join('');
  }

  // Expose to global scope — call these from a button when ready
  window._openDonationModal    = openDonationModal;
  window._closeDonationModal   = closeDonationModal;
  window._donPick              = pickAmount;
  window._donSubmit            = submitDonation;
  window._donNameChange        = nameChange;
  window._loadDonorLeaderboard = loadDonorLeaderboard;
})();
