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
  let _authLock      = false; // prevents onAuthStateChange from overwriting during signUp

  // ---- profile helpers ----
  async function getProfile(userId) {
    const { data } = await sb.from('profiles').select('username, avatar_url').eq('id', userId).maybeSingle();
    return data || null;
  }

  async function ensureProfile(user) {
    const profile = await getProfile(user.id);
    if (profile) return profile;
    const username = user.email.split('@')[0].replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 20);
    await sb.from('profiles').upsert({ id: user.id, username }, { onConflict: 'id' });
    return await getProfile(user.id);
  }

  // Open modal immediately if recovery link detected in URL (all Supabase formats)
  (function () {
    const hash   = new URLSearchParams(window.location.hash.slice(1));
    const search = new URLSearchParams(window.location.search);
    const isRecovery = hash.get('type') === 'recovery'   // implicit flow: #type=recovery
      || search.get('type') === 'recovery'                // token_hash flow: ?type=recovery
      || (search.has('code') && !search.has('error'));    // PKCE flow: ?code=...
    if (isRecovery) {
      openSetNewPasswordModal();
    }
  })();

  sb.auth.onAuthStateChange((_event, session) => {
    if (_event === 'PASSWORD_RECOVERY') {
      // Only open if user hasn't already started typing (modal not yet shown)
      if (!document.getElementById('np-pass')) openSetNewPasswordModal();
      return;
    }
    if (_authLock) return;
    currentUser = session?.user ?? null;
    if (currentUser) {
      const username = currentUser.user_metadata?.username
        || currentUser.email.split('@')[0].replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 20);
      currentProfile = { username };
      renderAuthBar();
      // Load full profile from DB to get avatar_url and saved username
      getProfile(currentUser.id).then(profile => {
        if (profile && currentUser) {
          currentProfile = profile;
          renderAuthBar();
        }
      });
    } else {
      currentProfile = null;
      renderAuthBar();
    }
  });

  // ---- sign up ----
  async function signUp(email, password, username) {
    if (!username) throw new Error('Username is required.');
    if (username.length < 3)  throw new Error('Username must be at least 3 characters.');
    if (username.length > 20) throw new Error('Username must be 20 characters or fewer.');
    if (!/^[a-zA-Z0-9_\-]+$/.test(username)) throw new Error('Username: letters, numbers, _ and - only.');

    _authLock = true;
    try {
      // Pass username in metadata so the DB trigger creates the profile
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { username } }
      });
      if (error) throw new Error(error.message);
      const user = data?.user;
      if (!user) throw new Error('Registration failed — please try again.');
      if (!data.session) throw new Error('Check your email to confirm your account, then log in.');

      // Profile is created by DB trigger — just set local state
      currentUser    = user;
      currentProfile = { username };
      renderAuthBar();
      clearLocalScores();
    } finally {
      _authLock = false;
    }
  }

  // ---- sign in ----
  async function signIn(email, password) {
    _authLock = true;
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      currentUser    = data.user;
      const username = data.user.user_metadata?.username
        || data.user.email.split('@')[0].replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 20);
      currentProfile = { username };
      renderAuthBar();
      clearLocalScores();
      // Load full profile to get avatar_url
      const profile = await getProfile(currentUser.id);
      if (profile) { currentProfile = profile; renderAuthBar(); }
    } finally {
      _authLock = false;
    }
  }

  // ---- clear local QTE scores (called on login/register) ----
  function clearLocalScores() {
    Object.keys(localStorage).filter(k => /^alb:[a-z]+-hs$/.test(k))
      .forEach(k => localStorage.removeItem(k));
    window.dispatchEvent(new Event('alb-scores-reset'));
  }

  // ---- sign out ----
  async function signOut() {
    await sb.auth.signOut();
    currentUser = null; currentProfile = null;
    renderAuthBar();
  }

  // ---- submit score — server decides if it's a new best ----
  async function submitScore(qteType, score) {
    if (!currentUser || !score) return;
    const { error } = await sb.rpc('submit_score', {
      p_user_id: currentUser.id,
      p_qte_type: qteType,
      p_score: score
    });
    if (error) console.error('[sb] submitScore error', qteType, score, error.message);
    else console.log('[sb] submitScore ok', qteType, score);
  }

  // ---- fetch top-10 for a QTE ----
  async function fetchLeaderboard(qteType) {
    const { data, error } = await sb
      .from('leaderboard')
      .select('score, profiles(username, avatar_url)')
      .eq('qte_type', qteType)
      .order('score', { ascending: false })
      .limit(10);
    if (error) { console.error('[sb] fetchLeaderboard error', error.message); return []; }
    return (data || []).map(r => ({
      username:   r.profiles?.username   || '???',
      avatar_url: r.profiles?.avatar_url || null,
      score:      r.score,
    }));
  }

  // ---- fetch the current user's rank for a QTE ----
  async function fetchMyRank(qteType) {
    if (!currentUser) return null;
    // Get own score first
    const { data: mine } = await sb.from('leaderboard')
      .select('score').eq('user_id', currentUser.id).eq('qte_type', qteType).maybeSingle();
    if (!mine) return null;
    // Count how many players have a strictly higher score
    const { count } = await sb.from('leaderboard')
      .select('*', { count: 'exact', head: true })
      .eq('qte_type', qteType)
      .gt('score', mine.score);
    return { rank: (count || 0) + 1, score: mine.score };
  }

  // ================================================================
  //  UI helpers
  // ================================================================
  const _ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => _ESC_MAP[c]);
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Avatar background color derived from username
  function avatarColor(name) {
    const palette = ['#5544cc','#2266bb','#1e8c6e','#b05a10','#aa2266','#993333','#1a6699'];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return palette[Math.abs(h) % palette.length];
  }

  // Returns an avatar div — shows profile image if url set, otherwise initials
  function renderAvatar(name, url, size, extraAttrs) {
    const color   = avatarColor(name);
    const initial = name.charAt(0).toUpperCase();
    const fs      = Math.round(size * 0.44);
    const inner   = url
      ? `<img src="${esc(url)}" class="sb-avatar-img" alt="" onerror="this.style.display='none'">${initial}`
      : initial;
    return `<div class="sb-avatar" style="background:${color};width:${size}px;height:${size}px;font-size:${fs}px" ${extraAttrs || ''}>${inner}</div>`;
  }

  // ---- auth bar ----
  function renderAuthBar() {
    closeProfileMenu();
    if (typeof window._updateDisclaimerForUser === 'function') {
      window._updateDisclaimerForUser(currentUser?.id ?? null);
    }
    const bar = document.getElementById('auth-bar');
    if (!bar) return;
    if (currentUser && currentProfile) {
      const { username, avatar_url } = currentProfile;
      bar.innerHTML = renderAvatar(username, avatar_url, 32,
        `title="${esc(username)}" onclick="window._toggleProfileMenu(event)"`);
    } else {
      bar.innerHTML =
        `<button class="auth-btn" onclick="window._openAuthModal('login')">Login</button>` +
        `<button class="auth-btn" onclick="window._openAuthModal('register')">Register</button>`;
    }
  }

  // ---- profile dropdown menu ----
  let _menuOpen = false;

  function toggleProfileMenu(e) {
    e?.stopPropagation();
    _menuOpen ? closeProfileMenu() : openProfileMenu();
  }

  function openProfileMenu() {
    closeProfileMenu();
    const avatar = document.querySelector('.sb-avatar');
    if (!avatar) return;
    const name = currentProfile?.username || '';
    const url  = currentProfile?.avatar_url || null;
    const menu = document.createElement('div');
    menu.id = 'sb-profile-menu';
    menu.className = 'sb-profile-menu';
    menu.innerHTML = `
      <div class="sb-menu-header">
        ${renderAvatar(name, url, 40)}
        <span class="sb-menu-name">${esc(name)}</span>
      </div>
      <div class="sb-menu-divider"></div>
      <button class="sb-menu-item" onclick="window._openSettings()">&#9881;&nbsp; Settings</button>
      <div class="sb-menu-divider"></div>
      <button class="sb-menu-item sb-menu-item-danger" onclick="window._sbSignOut()">&#10148;&nbsp; Logout</button>`;
    document.body.appendChild(menu);
    // Position below avatar
    const r = avatar.getBoundingClientRect();
    menu.style.top   = (r.bottom + 6) + 'px';
    menu.style.right = (window.innerWidth - r.right) + 'px';
    _menuOpen = true;
    setTimeout(() => document.addEventListener('click', _onMenuOutside), 0);
  }

  function _onMenuOutside(e) {
    const menu   = document.getElementById('sb-profile-menu');
    const avatar = document.querySelector('.sb-avatar');
    if (menu && !menu.contains(e.target) && !avatar?.contains(e.target)) closeProfileMenu();
  }

  function closeProfileMenu() {
    document.getElementById('sb-profile-menu')?.remove();
    document.removeEventListener('click', _onMenuOutside);
    _menuOpen = false;
  }

  // ---- settings modal ----
  function openSettings() {
    closeProfileMenu();
    const name = currentProfile?.username || '';
    const url  = currentProfile?.avatar_url || null;
    openModal(`
      <button class="sb-close" onclick="window._closeModal()">&times;</button>
      <h3 class="sb-title">Account Settings</h3>

      <div class="sb-avatar-upload-wrap">
        <label class="sb-avatar-upload-label" title="Click to change photo">
          ${renderAvatar(name, url, 72)}
          <div class="sb-avatar-cam">&#128247;</div>
          <input type="file" id="sb-avatar-file" accept="image/png,image/jpeg,image/webp,image/gif"
                 style="display:none" onchange="window._uploadAvatar(this)">
        </label>
        <span class="sb-avatar-hint" id="sb-avatar-status">Click photo to change</span>
      </div>

      <p class="sb-field-label">Username</p>
      <input class="sb-input" id="sb-new-uname" type="text" maxlength="20"
             value="${esc(name)}" autocomplete="off">
      <div class="sb-err" id="sb-settings-err"></div>
      <button class="auth-btn sb-submit" onclick="window._saveUsername()">Save Username</button>
      <div class="sb-menu-divider" style="margin:16px 0 12px"></div>
      <button class="auth-btn sb-btn-full" onclick="window._sendPasswordReset()">Send Password Reset Email</button>
      <div class="sb-menu-divider" style="margin:12px 0"></div>
      <button class="auth-btn auth-btn-out sb-btn-full" onclick="window._sbSignOut();window._closeModal()">Logout</button>
    `);
  }

  // ---- avatar crop modal ----
  function showCropModal(file, onApply) {
    const SIZE   = 280;
    const EXPORT = 200;
    const img    = new Image();
    const url    = URL.createObjectURL(file);

    openModal(`
      <button class="sb-close" onclick="window._closeModal()">&times;</button>
      <h3 class="sb-title" style="margin-bottom:10px">Crop Photo</h3>
      <div style="display:flex;justify-content:center;margin-bottom:10px">
        <canvas id="crop-cv" width="${SIZE}" height="${SIZE}"
          style="border-radius:50%;cursor:grab;display:block;touch-action:none;max-width:100%"></canvas>
      </div>
      <div style="display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:6px">
        <span style="font-size:12px;color:#888">Zoom</span>
        <input type="range" id="crop-zoom" min="1" max="3" step="0.01" value="1"
          style="flex:1;max-width:180px;accent-color:#66aaff">
      </div>
      <p style="font-size:11px;color:#555;text-align:center;margin:0 0 14px">Drag to reposition</p>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="auth-btn" id="crop-apply-btn" onclick="window._cropApply()">Apply</button>
        <button class="auth-btn auth-btn-out" onclick="window._closeModal()">Cancel</button>
      </div>
    `);

    let scale = 1, ox = 0, oy = 0, baseScale = 1;
    let dragging = false, dragX = 0, dragY = 0, startOx = 0, startOy = 0;
    let lastDist = 0;

    function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function clampOff() {
      const w = img.width  * baseScale * scale;
      const h = img.height * baseScale * scale;
      ox = clampNum(ox, SIZE - w, 0);
      oy = clampNum(oy, SIZE - h, 0);
    }

    function draw() {
      const cv = document.getElementById('crop-cv');
      if (!cv) return;
      const ctx = cv.getContext('2d');
      const w = img.width  * baseScale * scale;
      const h = img.height * baseScale * scale;
      clampOff();
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, ox, oy, w, h);
      // darken outside circle
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.rect(0, 0, SIZE, SIZE);
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
    }

    img.onload = () => {
      baseScale = Math.max(SIZE / img.width, SIZE / img.height);
      ox = (SIZE - img.width  * baseScale) / 2;
      oy = (SIZE - img.height * baseScale) / 2;
      draw();

      const cv = document.getElementById('crop-cv');
      const zs = document.getElementById('crop-zoom');
      if (!cv) return;

      zs?.addEventListener('input', () => {
        const ns = parseFloat(zs.value);
        const ratio = ns / scale;
        ox = SIZE / 2 + (ox - SIZE / 2) * ratio;
        oy = SIZE / 2 + (oy - SIZE / 2) * ratio;
        scale = ns;
        draw();
      });

      cv.addEventListener('pointerdown', e => {
        dragging = true;
        dragX = e.clientX; dragY = e.clientY;
        startOx = ox; startOy = oy;
        cv.setPointerCapture(e.pointerId);
        cv.style.cursor = 'grabbing';
      });
      cv.addEventListener('pointermove', e => {
        if (!dragging) return;
        ox = startOx + (e.clientX - dragX);
        oy = startOy + (e.clientY - dragY);
        draw();
      });
      cv.addEventListener('pointerup',     () => { dragging = false; cv.style.cursor = 'grab'; });
      cv.addEventListener('pointercancel', () => { dragging = false; cv.style.cursor = 'grab'; });

      cv.addEventListener('touchmove', e => {
        if (e.touches.length !== 2) return;
        e.preventDefault();
        const dx   = e.touches[0].clientX - e.touches[1].clientX;
        const dy   = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (lastDist) {
          const ns    = clampNum(scale * (dist / lastDist), 1, 3);
          const ratio = ns / scale;
          ox = SIZE / 2 + (ox - SIZE / 2) * ratio;
          oy = SIZE / 2 + (oy - SIZE / 2) * ratio;
          scale = ns;
          if (zs) zs.value = scale;
          draw();
        }
        lastDist = dist;
      }, { passive: false });
      cv.addEventListener('touchend', () => { lastDist = 0; });
    };

    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;

    window._cropApply = () => {
      const btn = document.getElementById('crop-apply-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
      const ec = document.createElement('canvas');
      ec.width = EXPORT; ec.height = EXPORT;
      const ectx = ec.getContext('2d');
      ectx.beginPath();
      ectx.arc(EXPORT / 2, EXPORT / 2, EXPORT / 2, 0, Math.PI * 2);
      ectx.clip();
      const r = EXPORT / SIZE;
      ectx.drawImage(img, ox * r, oy * r,
        img.width * baseScale * scale * r,
        img.height * baseScale * scale * r);
      ec.toBlob(blob => {
        URL.revokeObjectURL(url);
        onApply(blob);
      }, 'image/jpeg', 0.92);
    };
  }

  // ---- avatar upload ----
  async function uploadAvatar(input) {
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    if (file.size > 10 * 1024 * 1024) {
      const statusEl = document.getElementById('sb-avatar-status');
      if (statusEl) { statusEl.style.color = '#ff8888'; statusEl.textContent = 'Max 10 MB.'; }
      return;
    }

    showCropModal(file, async (blob) => {
      openModal(`<h3 class="sb-title" style="padding:28px 0">Uploading…</h3>`);

      const path = `${currentUser.id}/avatar.jpg`;
      await sb.storage.from('avatars').remove([
        `${currentUser.id}/avatar.jpg`,
        `${currentUser.id}/avatar.jpeg`,
        `${currentUser.id}/avatar.png`,
        `${currentUser.id}/avatar.webp`,
        `${currentUser.id}/avatar.gif`,
      ]).catch(() => {});

      const { error: upErr } = await sb.storage.from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) {
        openModal(`
          <button class="sb-close" onclick="window._closeModal()">&times;</button>
          <p style="color:#ff8888;padding:16px 0;text-align:center">${esc(upErr.message)}</p>
        `);
        return;
      }

      const { data: { publicUrl } } = sb.storage.from('avatars').getPublicUrl(path);
      const { error: profErr } = await sb.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUser.id);
      if (profErr) {
        openModal(`
          <button class="sb-close" onclick="window._closeModal()">&times;</button>
          <p style="color:#ff8888;padding:16px 0;text-align:center">Saved photo but couldn't update profile:<br>${esc(profErr.message)}</p>
        `);
        return;
      }
      currentProfile.avatar_url = publicUrl;
      renderAuthBar();
      closeModal();
    });
  }

  async function saveUsername() {
    const errEl   = document.getElementById('sb-settings-err');
    const newName = (document.getElementById('sb-new-uname')?.value || '').trim();
    if (!newName) { if (errEl) errEl.textContent = 'Enter a username.'; return; }
    if (newName.length < 3) { if (errEl) errEl.textContent = 'At least 3 characters.'; return; }
    if (!/^[a-zA-Z0-9_\-]+$/.test(newName)) { if (errEl) errEl.textContent = 'Letters, numbers, _ and - only.'; return; }
    if (newName === currentProfile?.username) { closeModal(); return; }
    const btn = document.querySelector('.sb-submit');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    const { data: taken } = await sb.from('profiles').select('id').eq('username', newName).maybeSingle();
    if (taken) {
      if (errEl) errEl.textContent = 'Username already taken.';
      if (btn) { btn.disabled = false; btn.textContent = 'Save Username'; }
      return;
    }
    const { error } = await sb.from('profiles').update({ username: newName }).eq('id', currentUser.id);
    if (error) {
      if (errEl) errEl.textContent = error.message;
      if (btn) { btn.disabled = false; btn.textContent = 'Save Username'; }
      return;
    }
    currentProfile.username = newName;
    renderAuthBar();
    closeModal();
  }

  async function sendPasswordReset() {
    if (!currentUser?.email) return;
    const errEl = document.getElementById('sb-settings-err');
    const { error } = await sb.auth.resetPasswordForEmail(currentUser.email);
    if (errEl) {
      if (error) { errEl.textContent = error.message; }
      else        { errEl.style.color = '#88ee88'; errEl.textContent = 'Reset email sent!'; }
    }
  }

  function openForgotPasswordModal() {
    openModal(`
      <h2 class="sb-title">Reset Password</h2>
      <p style="font-size:0.85rem;color:#b0a8c8;margin-bottom:10px">Enter your account email and we'll send a reset link.</p>
      <input class="sb-input" id="fp-email" type="email" placeholder="Email" autocomplete="email" />
      <div class="sb-err" id="fp-err"></div>
      <button class="auth-btn sb-submit" onclick="window._submitForgotPassword()">Send Reset Email</button>
      <p class="sb-switch"><button class="sb-link" onclick="window._openAuthModal('login')">Back to Login</button></p>
    `);
    setTimeout(() => {
      const el = document.getElementById('fp-email');
      if (el) {
        el.focus();
        el.addEventListener('keydown', e => { if (e.key === 'Enter') window._submitForgotPassword(); });
      }
    }, 50);
  }

  async function submitForgotPassword() {
    const emailEl = document.getElementById('fp-email');
    const errEl   = document.getElementById('fp-err');
    if (!emailEl || !errEl) return;
    const email = emailEl.value.trim();
    if (!email) { errEl.textContent = 'Please enter your email.'; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/'
    });
    if (error) {
      errEl.textContent = error.message;
    } else {
      errEl.style.color = '#88ee88';
      errEl.textContent = 'Reset email sent! Check your inbox.';
      emailEl.disabled = true;
      document.querySelector('.sb-submit') && (document.querySelector('.sb-submit').disabled = true);
    }
  }

  // ---- set new password (after clicking reset link) ----
  function openSetNewPasswordModal() {
    openModal(`
      <h2 class="sb-title">Set New Password</h2>
      <p style="font-size:0.85rem;color:#b0a8c8;margin-bottom:10px">Enter your new password below.</p>
      <input class="sb-input" id="np-pass" type="password" placeholder="New password" autocomplete="new-password" />
      <div class="sb-err" id="np-err"></div>
      <button class="auth-btn sb-submit" onclick="window._submitNewPassword()">Set Password</button>
    `);
    setTimeout(() => {
      const el = document.getElementById('np-pass');
      if (el) {
        el.focus();
        el.addEventListener('keydown', e => { if (e.key === 'Enter') window._submitNewPassword(); });
      }
    }, 50);
  }

  async function submitNewPassword() {
    const passEl = document.getElementById('np-pass');
    const errEl  = document.getElementById('np-err');
    if (!passEl || !errEl) return;
    const pass = passEl.value;
    if (!pass || pass.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }
    const btn = document.querySelector('.sb-submit');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    errEl.textContent = '';
    const { error } = await sb.auth.updateUser({ password: pass });
    if (error) {
      errEl.style.color = '#ff8888';
      errEl.textContent = error.message;
      if (btn) { btn.disabled = false; btn.textContent = 'Set Password'; }
    } else {
      errEl.style.color = '#88ee88';
      errEl.textContent = 'Password updated! You are now logged in.';
      passEl.disabled = true;
      if (btn) btn.disabled = true;
      setTimeout(() => closeModal(), 2000);
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
      ${!isReg ? `<p class="sb-switch" style="margin-top:4px"><button class="sb-link" onclick="window._openForgotPassword()">Forgot password?</button></p>` : ''}
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
    let success = false;
    try {
      if (mode === 'register') await signUp(email, pass, uname);
      else                     await signIn(email, pass);
      success = true;
      closeModal();
    } catch (e) {
      const msg = e.message || 'Something went wrong.';
      if (errEl) {
        errEl.textContent = msg;
        errEl.style.color = msg.startsWith('Account created') ? '#88ee88' : '#ff8888';
      } else {
        alert(msg);
      }
    } finally {
      if (!success && btn && btn.isConnected) {
        btn.disabled = false;
        btn.textContent = mode === 'register' ? 'Register' : 'Login';
      }
    }
  }

  // ---- leaderboard modal ----
  async function _renderLbContent(qteType, mode) {
    const type = mode === 'comp' ? qteType + '-comp' : qteType;
    const body = document.getElementById('sb-lb-body');
    if (!body) return;
    body.innerHTML = '<div class="sb-loading">Loading&hellip;</div>';

    const [rows, myRank] = await Promise.all([
      fetchLeaderboard(type),
      currentUser ? fetchMyRank(type) : Promise.resolve(null)
    ]);

    if (!document.getElementById('sb-lb-body')) return; // modal closed
    if (!rows.length) {
      body.innerHTML = mode === 'comp'
        ? '<p class="sb-empty">No competitive scores yet — be the first!</p>'
        : '<p class="sb-empty">No scores yet — be the first!</p>';
      return;
    }

    const myName = currentProfile?.username || null;
    const inTop10 = myName && rows.some(r => r.username === myName);
    let myRankHtml = '';
    if (currentUser && !inTop10 && myRank) {
      myRankHtml = `<p class="sb-my-rank">Your rank: <b>#${myRank.rank}</b> &mdash; streak <b>${myRank.score}</b></p>`;
    } else if (currentUser && !inTop10 && !myRank) {
      myRankHtml = `<p class="sb-my-rank">You have no score yet for this QTE.</p>`;
    }

    body.innerHTML = `<table class="sb-lb-table">
      <thead><tr><th>#</th><th>Player</th><th>Streak</th></tr></thead>
      <tbody>${rows.map((r, i) => `
        <tr${myName === r.username ? ' class="sb-lb-me"' : ''}>
          <td>${i + 1}</td>
          <td><div class="lb-player-cell">${renderAvatar(r.username, r.avatar_url, 22)}<span>${esc(r.username)}</span></div></td>
          <td><b>${r.score}</b></td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${myRankHtml}
    ${currentUser ? '' : '<p class="sb-empty">Login to submit your scores!</p>'}`;
  }

  async function openLeaderboard(qteType) {
    const initMode = window._qteCompMode ? 'comp' : 'casual';
    openModal(`
      <button class="sb-close" onclick="window._closeModal()">&times;</button>
      <h3 class="sb-title">${cap(qteType)} Leaderboard</h3>
      <div class="sb-lb-tabs">
        <button class="sb-lb-tab${initMode === 'casual' ? ' active' : ''}" onclick="window._lbShowTab('${qteType}','casual',this)">Casual</button>
        <button class="sb-lb-tab comp-tab${initMode === 'comp' ? ' active' : ''}" onclick="window._lbShowTab('${qteType}','comp',this)">Competitive</button>
      </div>
      <div id="sb-lb-body"><div class="sb-loading">Loading&hellip;</div></div>
    `);
    await _renderLbContent(qteType, initMode);
  }

  // ---- all leaderboards view ----
  const QTE_TYPES = ['dagger', 'spear', 'sword', 'fist', 'staff', 'axe', 'hammer', 'dodge'];

  async function loadAllLeaderboards(mode) {
    const grid = document.getElementById('all-lb-grid');
    if (!grid) return;

    // Determine mode from arg or active tab
    if (!mode) {
      const activeTab = document.querySelector('.all-lb-mode-tab.active');
      mode = activeTab?.dataset.mode || 'casual';
    }
    const suffix = mode === 'comp' ? '-comp' : '';

    grid.innerHTML = '<div class="sb-loading">Loading&hellip;</div>';
    const results = await Promise.all(QTE_TYPES.map(t => fetchLeaderboard(t + suffix)));

    grid.innerHTML = QTE_TYPES.map((type, idx) => {
      const rows = results[idx];
      const myName = currentProfile?.username || null;
      const rowsHtml = rows.length
        ? rows.map((r, i) => `
            <tr${myName && myName === r.username ? ' class="sb-lb-me"' : ''}>
              <td class="all-lb-rank">${i + 1}</td>
              <td class="all-lb-name"><div class="lb-player-cell">${renderAvatar(r.username, r.avatar_url, 20)}<span>${esc(r.username)}</span></div></td>
              <td class="all-lb-score"><b>${r.score}</b></td>
            </tr>`).join('')
        : `<tr><td colspan="3" class="all-lb-empty">No scores yet</td></tr>`;
      return `
        <div class="all-lb-card">
          <div class="all-lb-card-title">${cap(type)}</div>
          <table class="sb-lb-table all-lb-table">
            <thead><tr><th>#</th><th>Player</th><th>Streak</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`;
    }).join('');
  }

  // ================================================================
  //  Globals (called from HTML onclick and from scripts.js)
  // ================================================================
  window._sbSignOut          = () => signOut();
  window._openAuthModal      = openAuthModal;
  window._openLeaderboard    = openLeaderboard;
  window._closeModal         = closeModal;
  window._submitAuth         = submitAuth;
  window._sbSubmitScore      = submitScore;
  window._sbGetUsername      = () => currentProfile?.username || null;
  window._sbGetUserId        = () => currentUser?.id ?? null;
  window._toggleProfileMenu  = toggleProfileMenu;
  window._openSettings       = openSettings;
  window._saveUsername       = saveUsername;
  window._sendPasswordReset  = sendPasswordReset;
  window._uploadAvatar       = uploadAvatar;
  window._loadAllLeaderboards  = loadAllLeaderboards;
  window._switchLbMode = function (btn) {
    document.querySelectorAll('.all-lb-mode-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    loadAllLeaderboards(btn.dataset.mode);
  };
  window._lbShowTab = async (qteType, mode, btn) => {
    document.querySelectorAll('.sb-lb-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    await _renderLbContent(qteType, mode);
  };
  window._openForgotPassword   = openForgotPasswordModal;
  window._submitForgotPassword = submitForgotPassword;
  window._submitNewPassword    = submitNewPassword;

  // Boot: onAuthStateChange fires INITIAL_SESSION and handles session restoration
})();
