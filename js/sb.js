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
    const { data } = await sb.from('profiles').select('username, avatar_url').eq('id', userId).maybeSingle();
    return data || null;
  }

  async function refreshSession() {
    const { data: { user } } = await sb.auth.getUser();
    currentUser    = user || null;
    currentProfile = currentUser ? await getProfile(currentUser.id) : null;
    renderAuthBar();
  }

  sb.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user ?? null;
    if (currentUser) {
      currentProfile = await getProfile(currentUser.id);
      // Auto-create profile for OAuth users (e.g. Discord) on first login
      if (!currentProfile) {
        const meta = currentUser.user_metadata || {};
        const username = (meta.full_name || meta.name || meta.username || currentUser.email || 'user')
          .replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 20);
        await sb.from('profiles').upsert({ id: currentUser.id, username }, { onConflict: 'id' });
        currentProfile = { username };
      }
    } else {
      currentProfile = null;
    }
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

    // Store username in auth metadata so a trigger can create the profile
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { username } }
    });
    if (error) throw new Error(error.message);
    const user = data?.user;
    if (!user) throw new Error('Registration failed — please try again.');

    // Try to insert profile — may fail if email confirmation is on (user not authed yet),
    // in that case the trigger or post-login flow will handle it.
    if (data.session) {
      // Authenticated immediately (email confirmation disabled)
      const { error: pe } = await sb.from('profiles').upsert({ id: user.id, username }, { onConflict: 'id' });
      if (pe) throw new Error('Profile save failed: ' + pe.message);
      currentUser    = user;
      currentProfile = { username };
      renderAuthBar();
    } else {
      // Email confirmation required — profile will be created by trigger or on first login
      throw new Error('Account created! Check your email to confirm, then log in.');
    }

    return username;
  }

  // ---- sign in ----
  async function signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    currentUser = data.user;
    currentProfile = await getProfile(data.user.id);
    // If profile missing (e.g. created before trigger was set up), create it now
    if (!currentProfile) {
      const meta = data.user.user_metadata || {};
      const username = meta.username || data.user.email.split('@')[0];
      await sb.from('profiles').upsert({ id: data.user.id, username }, { onConflict: 'id' });
      currentProfile = { username };
    }
    renderAuthBar();
    return currentProfile.username;
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

  // ---- avatar upload ----
  async function uploadAvatar(input) {
    const file = input.files?.[0];
    if (!file) return;
    const statusEl = document.getElementById('sb-avatar-status');
    if (file.size > 3 * 1024 * 1024) {
      if (statusEl) { statusEl.style.color = '#ff8888'; statusEl.textContent = 'Max 3 MB.'; }
      return;
    }
    if (statusEl) { statusEl.style.color = '#aaa'; statusEl.textContent = 'Uploading…'; }

    const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
    const path = `${currentUser.id}/avatar.${ext}`;

    // Remove old avatar files first (other extensions)
    await sb.storage.from('avatars').remove([
      `${currentUser.id}/avatar.jpg`,
      `${currentUser.id}/avatar.jpeg`,
      `${currentUser.id}/avatar.png`,
      `${currentUser.id}/avatar.webp`,
      `${currentUser.id}/avatar.gif`,
    ]).catch(() => {});

    const { error: upErr } = await sb.storage.from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      if (statusEl) { statusEl.style.color = '#ff8888'; statusEl.textContent = upErr.message; }
      return;
    }

    const { data: { publicUrl } } = sb.storage.from('avatars').getPublicUrl(path);
    const displayUrl = `${publicUrl}?v=${Date.now()}`;

    await sb.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUser.id);
    currentProfile.avatar_url = displayUrl;
    renderAuthBar();

    // Refresh the avatar in the settings modal without closing it
    const label = document.querySelector('.sb-avatar-upload-label');
    if (label) {
      const oldAvatar = label.querySelector('.sb-avatar');
      if (oldAvatar) oldAvatar.outerHTML = renderAvatar(name, displayUrl, 72);
    }
    if (statusEl) { statusEl.style.color = '#88ee88'; statusEl.textContent = 'Photo updated!'; }
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
        errEl.style.color = msg.startsWith('Account created') ? '#88ee88' : '';
      }
    } finally {
      if (!success && btn && btn.isConnected) {
        btn.disabled = false;
        btn.textContent = mode === 'register' ? 'Register' : 'Login';
      }
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
  window._sbSignOut          = () => signOut();
  window._openAuthModal      = openAuthModal;
  window._openLeaderboard    = openLeaderboard;
  window._closeModal         = closeModal;
  window._submitAuth         = submitAuth;
  window._sbSubmitScore      = submitScore;
  window._sbGetUsername      = () => currentProfile?.username || null;
  window._toggleProfileMenu  = toggleProfileMenu;
  window._openSettings       = openSettings;
  window._saveUsername       = saveUsername;
  window._sendPasswordReset  = sendPasswordReset;
  window._uploadAvatar       = uploadAvatar;

  // Boot
  refreshSession();
})();
