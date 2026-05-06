// ============================================================
//  AL Builder — Supabase: accounts + QTE leaderboards
//  Replace SUPABASE_URL and SUPABASE_ANON_KEY below.
// ============================================================
(function () {
  'use strict';

  const SUPABASE_URL      = 'https://mpqohagljmvwftwqumnh.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wcW9oYWdsam12d2Z0d3F1bW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMzg1NzEsImV4cCI6MjA5MzYxNDU3MX0.WfU88Ell1Q6jCcef2YiohxIeTHBNfruIxYWoa1QRCUc';

  if (!window.supabase) { console.warn('sb.js: Supabase CDN not loaded'); return; }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---- state ----
  let currentUser    = null;
  let currentProfile = null; // { username }

  // ---- profile helpers ----
  async function getProfile(userId) {
    const { data } = await sb.from('profiles').select('username').eq('id', userId).single();
    return data || null;
  }

  async function refreshSession() {
    const { data: { user } } = await sb.auth.getUser();
    currentUser    = user || null;
    currentProfile = currentUser ? await getProfile(currentUser.id) : null;
    renderAuthBar();
  }

  sb.auth.onAuthStateChange(async (_event, session) => {
    currentUser    = session?.user ?? null;
    currentProfile = currentUser ? await getProfile(currentUser.id) : null;
    renderAuthBar();
  });

  // ---- sign up ----
  async function signUp(email, password, username) {
    if (!username) throw new Error('Username is required.');
    if (username.length < 3)  throw new Error('Username must be at least 3 characters.');
    if (username.length > 20) throw new Error('Username must be 20 characters or fewer.');
    if (!/^[a-zA-Z0-9_\-]+$/.test(username)) throw new Error('Username: letters, numbers, _ and - only.');

    const { data: taken } = await sb.from('profiles').select('id').eq('username', username).maybeSingle();
    if (taken) throw new Error('Username already taken.');

    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    const user = data?.user;
    if (!user) throw new Error('Sign-up successful — check your email to confirm your account.');

    const { error: pe } = await sb.from('profiles').insert({ id: user.id, username });
    if (pe) throw new Error(pe.message);

    currentUser    = user;
    currentProfile = { username };
    return username;
  }

  // ---- sign in ----
  async function signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    currentUser    = data.user;
    currentProfile = await getProfile(data.user.id);
    return currentProfile?.username;
  }

  // ---- sign out ----
  async function signOut() {
    await sb.auth.signOut();
    currentUser = null; currentProfile = null;
    renderAuthBar();
  }

  // ---- submit score (upsert personal best) ----
  async function submitScore(qteType, score) {
    if (!currentUser || !score) return;
    const { data: existing } = await sb
      .from('leaderboard')
      .select('score')
      .eq('user_id', currentUser.id)
      .eq('qte_type', qteType)
      .maybeSingle();
    if (existing && existing.score >= score) return; // not a new personal best
    await sb.from('leaderboard').upsert(
      { user_id: currentUser.id, qte_type: qteType, score, achieved_at: new Date().toISOString() },
      { onConflict: 'user_id,qte_type' }
    );
  }

  // ---- fetch top-10 for a QTE ----
  async function fetchLeaderboard(qteType) {
    const { data, error } = await sb
      .from('leaderboard')
      .select('score, achieved_at, profiles(username)')
      .eq('qte_type', qteType)
      .order('score', { ascending: false })
      .limit(10);
    if (error) return [];
    return (data || []).map(r => ({
      username: r.profiles?.username || '???',
      score: r.score,
    }));
  }

  // ================================================================
  //  UI helpers
  // ================================================================
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---- auth bar ----
  function renderAuthBar() {
    const bar = document.getElementById('auth-bar');
    if (!bar) return;
    if (currentUser && currentProfile) {
      bar.innerHTML =
        `<span class="auth-username">&#9654; ${esc(currentProfile.username)}</span>` +
        `<button class="auth-btn auth-btn-sm" onclick="window._sbSignOut()">Logout</button>`;
    } else {
      bar.innerHTML =
        `<button class="auth-btn" onclick="window._openAuthModal('login')">Login</button>` +
        `<button class="auth-btn" onclick="window._openAuthModal('register')">Register</button>`;
    }
  }

  // ---- shared modal ----
  function getModal() { return document.getElementById('sb-modal'); }

  function openModal(html) {
    const m = getModal();
    if (!m) return;
    m.innerHTML = `<div class="sb-modal-box">${html}</div>`;
    m.style.display = 'flex';
    m.onclick = e => { if (e.target === m) closeModal(); };
  }

  function closeModal() {
    const m = getModal();
    if (m) { m.style.display = 'none'; m.innerHTML = ''; }
  }

  // ---- auth modal ----
  function openAuthModal(mode) {
    const isReg = mode === 'register';
    openModal(`
      <button class="sb-close" onclick="window._closeModal()">&times;</button>
      <h3 class="sb-title">${isReg ? 'Create Account' : 'Login'}</h3>
      ${isReg ? `<input class="sb-input" id="sb-uname" type="text" placeholder="Username (3–20 chars)" maxlength="20" autocomplete="off">` : ''}
      <input class="sb-input" id="sb-email" type="email" placeholder="Email" autocomplete="email">
      <input class="sb-input" id="sb-pass"  type="password" placeholder="Password" autocomplete="${isReg ? 'new-password' : 'current-password'}">
      <div class="sb-err" id="sb-err"></div>
      <button class="auth-btn sb-submit" onclick="window._submitAuth('${mode}')">${isReg ? 'Register' : 'Login'}</button>
      <p class="sb-switch">${isReg ? 'Already have an account?' : "Don't have an account?"}
        <button class="sb-link" onclick="window._openAuthModal('${isReg ? 'login' : 'register'}')">${isReg ? 'Login' : 'Register'}</button></p>
    `);
    // Allow Enter to submit
    setTimeout(() => {
      document.querySelectorAll('#sb-uname,#sb-email,#sb-pass').forEach(el => {
        if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') window._submitAuth(mode); });
      });
    }, 0);
  }

  async function submitAuth(mode) {
    const errEl = document.getElementById('sb-err');
    const email = (document.getElementById('sb-email')?.value || '').trim();
    const pass  =  document.getElementById('sb-pass')?.value  || '';
    const uname = (document.getElementById('sb-uname')?.value || '').trim();
    if (!email || !pass) { if (errEl) errEl.textContent = 'Fill in all fields.'; return; }
    const btn = document.querySelector('.sb-submit');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    try {
      if (mode === 'register') await signUp(email, pass, uname);
      else                     await signIn(email, pass);
      closeModal();
    } catch (e) {
      if (errEl) errEl.textContent = e.message || 'Something went wrong.';
      if (btn) { btn.disabled = false; btn.textContent = mode === 'register' ? 'Register' : 'Login'; }
    }
  }

  // ---- leaderboard modal ----
  async function openLeaderboard(qteType) {
    openModal(`
      <button class="sb-close" onclick="window._closeModal()">&times;</button>
      <h3 class="sb-title">${cap(qteType)} Leaderboard</h3>
      <div id="sb-lb-body"><div class="sb-loading">Loading&hellip;</div></div>
    `);
    const rows = await fetchLeaderboard(qteType);
    const body = document.getElementById('sb-lb-body');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<p class="sb-empty">No scores yet — be the first!</p>';
      return;
    }
    const myName = currentProfile?.username || null;
    body.innerHTML = `<table class="sb-lb-table">
      <thead><tr><th>#</th><th>Player</th><th>Streak</th></tr></thead>
      <tbody>${rows.map((r, i) => `
        <tr${myName === r.username ? ' class="sb-lb-me"' : ''}>
          <td>${i === 0 ? '&#127881;' : i + 1}</td>
          <td>${esc(r.username)}</td>
          <td><b>${r.score}</b></td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${currentUser ? '' : '<p class="sb-empty">Login to submit your scores!</p>'}`;
  }

  // ================================================================
  //  Globals (called from HTML onclick and from scripts.js)
  // ================================================================
  window._sbSignOut       = () => signOut();
  window._openAuthModal   = openAuthModal;
  window._openLeaderboard = openLeaderboard;
  window._closeModal      = closeModal;
  window._submitAuth      = submitAuth;
  window._sbSubmitScore   = submitScore;
  window._sbGetUsername   = () => currentProfile?.username || null;

  // Boot
  refreshSession();
})();
