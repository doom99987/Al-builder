// ============================================================
//  AL Builder — Supabase: accounts + QTE leaderboards
//  Replace SUPABASE_URL and SUPABASE_ANON_KEY below.
// ============================================================
(function () {
  'use strict';

  const SUPABASE_URL      = 'https://mpqohagljmvwftwqumnh.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wcW9oYWdsam12d2Z0d3F1bW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMzg1NzEsImV4cCI6MjA5MzYxNDU3MX0.WfU88Ell1Q6jCcef2YiohxIeTHBNfruIxYWoa1QRCUc';

  if (!window.supabase) { console.warn('sb.js: Supabase CDN not loaded'); return; }
  // flowType: 'implicit' is required for password reset links clicked from email clients on mobile.
  // PKCE stores a verifier in sessionStorage of the requesting tab — clicking the link in a different
  // browser/tab (the email app) loses that verifier and the code exchange silently fails.
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { flowType: 'implicit' }
  });

  // Platform tag sent with every score ('M' = mobile, 'C' = desktop)
  const IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod|Touch/i.test(navigator.userAgent);
  const PLATFORM  = IS_MOBILE ? 'M' : 'C';

  // ---- admin ----
  const ADMIN_USERNAME = 'doom99987';

  // ---- profanity filter ----
  // Checked as substrings (case-insensitive) against the full username.
  const PROFANITY_LIST = [
    'fuck','shit','cunt','nigger','nigga','faggot','fag','bitch','cock','pussy',
    'asshole','bastard','dick','whore','slut','retard','twat','prick','wank',
    'kike','spic','chink','gook','tranny','rape','nonce','pedo','pedophile',
  ];

  function containsProfanity(str) {
    const lower = str.toLowerCase();
    return PROFANITY_LIST.some(w => lower.includes(w));
  }

  // ---- ban helpers ----
  let _bannedSet = null; // cached Set of banned usernames

  async function loadBannedCache() {
    const { data } = await sb.from('banned_usernames').select('username');
    _bannedSet = new Set((data || []).map(r => r.username));
  }

  function isBannedCached(username) {
    return _bannedSet ? _bannedSet.has(username) : false;
  }

  async function checkIfBanned(username) {
    if (_bannedSet) return _bannedSet.has(username);
    const { data } = await sb.from('banned_usernames').select('username').eq('username', username).maybeSingle();
    return !!data;
  }

  // Load ban cache immediately so leaderboard filtering is ready
  loadBannedCache();

  // ---- state ----
  let currentUser    = null;
  let currentProfile = null; // { username }
  let _authLock      = false; // prevents onAuthStateChange from overwriting during signUp
  let _lbPlatform    = 'all'; // active platform filter inside the per-QTE leaderboard modal

  // ---- profile helpers ----
  async function getProfile(userId) {
    const { data } = await sb.from('profiles').select('username, avatar_url').eq('id', userId).maybeSingle();
    return data || null;
  }

  async function ensureProfile(user) {
    const profile = await getProfile(user.id);
    if (profile) return profile;
    const base = user.email.split('@')[0].replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 17);
    for (let i = 0; i <= 9; i++) {
      const username = i === 0 ? base : base + i;
      const { error } = await sb.from('profiles').upsert({ id: user.id, username }, { onConflict: 'id' });
      if (!error) break;
      if (error.code !== '23505') break; // unexpected error, stop retrying
    }
    return await getProfile(user.id);
  }

  // Open modal immediately if this looks like a recovery redirect.
  // With flowType:'implicit', Supabase puts tokens in the hash (#access_token=...&type=recovery).
  // Keep fallbacks for token_hash and ?code= in case the project setting ever changes.
  function _checkRecoveryURL() {
    const hash   = new URLSearchParams(window.location.hash.slice(1));
    const search = new URLSearchParams(window.location.search);
    const isRecovery = hash.get('type') === 'recovery'
      || search.get('type') === 'recovery'
      || (search.has('code') && !search.has('error'));
    if (isRecovery) openSetNewPasswordModal();
  }
  _checkRecoveryURL();
  // Also handle same-page hash navigation (e.g. email link opens in an already-loaded tab)
  window.addEventListener('hashchange', _checkRecoveryURL);

  sb.auth.onAuthStateChange((_event, session) => {
    if (_event === 'PASSWORD_RECOVERY') return; // handled inside openSetNewPasswordModal
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
    if (containsProfanity(username)) throw new Error('That username is not allowed.');

    // Check uniqueness before creating auth account
    const { data: taken } = await sb.from('profiles').select('id').eq('username', username).maybeSingle();
    if (taken) throw new Error('Username already taken.');

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
      // Check ban before allowing login
      const banned = await checkIfBanned(username);
      if (banned) {
        await sb.auth.signOut();
        currentUser = null;
        throw new Error('Your account has been banned.');
      }
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
      p_user_id:  currentUser.id,
      p_qte_type: qteType,
      p_score:    score,
      p_platform: PLATFORM,   // 'M' or 'C'
    });
    if (error) console.error('[sb] submitScore error', qteType, score, error.message);
    else console.log('[sb] submitScore ok', qteType, score, PLATFORM);
  }

  // ---- fetch top-10 for a QTE ----
  // platform: 'all' (no filter) | 'M' | 'C'
  async function fetchLeaderboard(qteType, platform) {
    // Fetch extra rows to absorb any that get filtered out for bans
    let query = sb
      .from('leaderboard')
      .select('score, platform, profiles(username, avatar_url)')
      .eq('qte_type', qteType)
      .order('score', { ascending: false })
      .limit(50);
    if (platform && platform !== 'all') query = query.eq('platform', platform);
    const { data, error } = await query;
    if (error) { console.error('[sb] fetchLeaderboard error', error.message); return []; }
    return (data || [])
      .map(r => ({
        username:   r.profiles?.username   || '???',
        avatar_url: r.profiles?.avatar_url || null,
        score:      r.score,
        platform:   r.platform || null,
      }))
      .filter(r => !isBannedCached(r.username))
      .slice(0, 10);
  }

  // ---- fetch the current user's rank for a QTE ----
  // platform: 'all' | 'M' | 'C' — rank is computed within that subset
  async function fetchMyRank(qteType, platform) {
    if (!currentUser) return null;
    // Get own score (must match the requested platform filter)
    let mineQ = sb.from('leaderboard')
      .select('score, platform')
      .eq('user_id', currentUser.id)
      .eq('qte_type', qteType);
    if (platform && platform !== 'all') mineQ = mineQ.eq('platform', platform);
    const { data: mine } = await mineQ.maybeSingle();
    if (!mine) return null;
    // Count players ranked above within the same platform subset
    let aboveQ = sb.from('leaderboard')
      .select('*', { count: 'exact', head: true })
      .eq('qte_type', qteType)
      .gt('score', mine.score);
    if (platform && platform !== 'all') aboveQ = aboveQ.eq('platform', platform);
    const { count } = await aboveQ;
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
      bar.innerHTML =
        `<button class="notif-bell-btn" id="notif-bell-btn" onclick="window._toggleNotifs()" title="Notifications">` +
          `&#9993;<span id="notif-badge" style="display:none">0</span>` +
        `</button>` +
        renderAvatar(username, avatar_url, 32,
          `title="${esc(username)}" onclick="window._toggleProfileMenu(event)"`);
      window._syncNotifBell?.();
      window._syncMsgBadge?.();
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
      ${name === ADMIN_USERNAME ? `<div class="sb-menu-divider"></div><button class="sb-menu-item sb-menu-item-admin" onclick="window._openAdminPanel()">&#9760;&nbsp; Admin Panel</button>` : ''}
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
  async function openSettings() {
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
      <p class="sb-field-label">Change Password</p>
      <input class="sb-input" id="sb-old-pass" type="password" placeholder="Current password" autocomplete="current-password">
      <input class="sb-input" id="sb-new-pass" type="password" placeholder="New password" autocomplete="new-password">
      <input class="sb-input" id="sb-conf-pass" type="password" placeholder="Confirm new password" autocomplete="new-password">
      <div class="sb-err" id="sb-pw-err"></div>
      <button class="auth-btn sb-btn-full" id="sb-pw-btn" onclick="window._changePassword()">Change Password</button>
      <div class="sb-menu-divider" style="margin:16px 0 12px"></div>
      <p class="sb-field-label">Messaging Consent</p>
      <div id="sb-consent-status" class="sb-consent-status">Loading...</div>
      <div class="sb-menu-divider" style="margin:12px 0"></div>
      <button class="auth-btn auth-btn-out sb-btn-full" onclick="window._sbSignOut();window._closeModal()">Logout</button>
      <div class="sb-menu-divider" style="margin:12px 0"></div>
      <button class="auth-btn sb-btn-full sb-btn-delete-account" onclick="window._deleteAccount()">Delete Account</button>
    `);
    // Load consent status
    if (currentUser) {
      const { data } = await sb.from('profiles').select('chat_consent_at, chat_consent_version').eq('id', currentUser.id).maybeSingle();
      const el = document.getElementById('sb-consent-status');
      if (!el) return;
      if (data?.chat_consent_at) {
        const date = new Date(data.chat_consent_at).toLocaleDateString();
        el.innerHTML = `<span style="color:#88cc88">&#10003; Consented on ${date}</span>
          <button class="sb-consent-withdraw-btn" onclick="window._withdrawChatConsent()">Withdraw</button>`;
      } else {
        el.innerHTML = `<span style="color:#888">Not consented — messaging disabled.</span>
          <button class="sb-consent-grant-btn" onclick="window._showConsentFromSettings()">Give Consent</button>`;
      }
    }
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
    if (containsProfanity(newName)) { if (errEl) errEl.textContent = 'That username is not allowed.'; return; }
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

  async function changePassword() {
    const errEl  = document.getElementById('sb-pw-err');
    const btn    = document.getElementById('sb-pw-btn');
    const oldVal = document.getElementById('sb-old-pass')?.value || '';
    const newVal = document.getElementById('sb-new-pass')?.value || '';
    const confVal= document.getElementById('sb-conf-pass')?.value || '';
    if (!errEl) return;
    errEl.style.color = '#ff8888';
    if (!oldVal) { errEl.textContent = 'Enter your current password.'; return; }
    if (newVal.length < 6) { errEl.textContent = 'New password must be at least 6 characters.'; return; }
    if (newVal !== confVal) { errEl.textContent = 'Passwords do not match.'; return; }
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    // Re-authenticate to verify current password
    const { error: authErr } = await sb.auth.signInWithPassword({ email: currentUser.email, password: oldVal });
    if (authErr) {
      errEl.textContent = 'Current password is incorrect.';
      if (btn) { btn.disabled = false; btn.textContent = 'Change Password'; }
      return;
    }
    const { error: updateErr } = await sb.auth.updateUser({ password: newVal });
    if (updateErr) {
      errEl.textContent = updateErr.message;
      if (btn) { btn.disabled = false; btn.textContent = 'Change Password'; }
      return;
    }
    errEl.style.color = '#88ee88';
    errEl.textContent = 'Password changed!';
    if (btn) { btn.disabled = true; btn.textContent = 'Changed'; }
    document.getElementById('sb-old-pass').value  = '';
    document.getElementById('sb-new-pass').value  = '';
    document.getElementById('sb-conf-pass').value = '';
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
    const _hsh   = new URLSearchParams(window.location.hash.slice(1));
    const _srch  = new URLSearchParams(window.location.search);
    const _tokenHash   = _srch.get('token_hash');
    const _code        = _srch.get('code');
    const _accessToken = _hsh.get('access_token');

    openModal(`
      <h2 class="sb-title">Set New Password</h2>
      <p id="np-status" style="font-size:0.85rem;color:#b0a8c8;margin-bottom:10px">Verifying reset link…</p>
      <input class="sb-input" id="np-pass" type="password" placeholder="New password" autocomplete="new-password" disabled />
      <div class="sb-err" id="np-err"></div>
      <button class="auth-btn sb-submit" id="np-btn" onclick="window._submitNewPassword()" disabled>Verifying…</button>
    `);

    let _done = false;

    function _enable() {
      if (_done) return; _done = true;
      const passEl   = document.getElementById('np-pass');
      const btn      = document.getElementById('np-btn');
      const statusEl = document.getElementById('np-status');
      if (!passEl) return;
      passEl.disabled = false; passEl.focus();
      passEl.addEventListener('keydown', e => { if (e.key === 'Enter') window._submitNewPassword(); });
      if (btn)      { btn.disabled = false; btn.textContent = 'Set Password'; }
      if (statusEl) statusEl.textContent = 'Enter your new password below.';
    }

    function _fail(msg) {
      if (_done) return; _done = true;
      const statusEl = document.getElementById('np-status');
      const btn      = document.getElementById('np-btn');
      if (!statusEl) return;
      statusEl.style.color = '#ff8888';
      statusEl.textContent = (msg || 'Reset link expired — please request a new one.');
      if (btn) btn.remove();
    }

    // Path 1: token_hash format (?token_hash=xxx&type=recovery) — newer Supabase
    if (_tokenHash) {
      sb.auth.verifyOtp({ token_hash: _tokenHash, type: 'recovery' })
        .then(({ data, error }) => {
          if (error) _fail('Link error: ' + error.message);
          else if (data?.session) _enable();
          else _fail();
        })
        .catch(e => _fail('Error: ' + e.message));
      return;
    }

    // Path 2: PKCE code (?code=xxx)
    if (_code) {
      sb.auth.exchangeCodeForSession(window.location.href)
        .then(({ error }) => {
          if (error) _fail('Code error: ' + error.message);
          else _enable();
        })
        .catch(e => _fail('Error: ' + e.message));
      return;
    }

    // Path 3: implicit hash tokens (#access_token=...&type=recovery)
    // Do NOT wait for Supabase to process the hash internally — extract the tokens
    // ourselves and call setSession directly to avoid initialization timing issues.
    if (_accessToken) {
      const _refreshToken = _hsh.get('refresh_token') || '';
      sb.auth.setSession({ access_token: _accessToken, refresh_token: _refreshToken })
        .then(({ data, error }) => {
          if (error) _fail('Session error: ' + error.message);
          else if (data?.session) _enable();
          else _fail();
        })
        .catch(e => _fail('Error: ' + e.message));
      return;
    }

    // Path 4: fallback — shouldn't reach here, but listen + poll just in case
    const _unsub = sb.auth.onAuthStateChange((evt) => {
      if (evt === 'PASSWORD_RECOVERY' || evt === 'SIGNED_IN') {
        _unsub.data.subscription.unsubscribe();
        clearInterval(_poll);
        _enable();
      }
    });

    let _attempts = 0;
    const _poll = setInterval(async () => {
      _attempts++;
      const { data } = await sb.auth.getSession();
      if (data.session) {
        clearInterval(_poll);
        _unsub.data.subscription.unsubscribe();
        _enable();
      } else if (_attempts >= 20) {
        clearInterval(_poll);
        _unsub.data.subscription.unsubscribe();
        _fail();
      }
    }, 500);
  }

  async function submitNewPassword() {
    const passEl = document.getElementById('np-pass');
    const errEl  = document.getElementById('np-err');
    if (!passEl || !errEl) return;
    const pass = passEl.value;
    if (!pass || pass.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }
    const btn = document.getElementById('np-btn');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    errEl.textContent = '';
    const { error } = await sb.auth.updateUser({ password: pass });
    if (error) {
      errEl.style.color = '#ff8888';
      errEl.textContent = error.message;
      if (btn) { btn.disabled = false; btn.textContent = 'Set Password'; }
    } else {
      errEl.style.color = '#88ee88';
      errEl.textContent = 'Password updated! You are now logged in. Click anywhere outside to close.';
      passEl.disabled = true;
      if (btn) btn.disabled = true;
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

  // Render a small M/C platform badge (null-safe — legacy scores have no tag)
  function platformBadge(p) {
    if (!p) return '';
    const label = p === 'M' ? 'M' : 'C';
    return `<span class="lb-plat lb-plat-${label.toLowerCase()}" title="${p === 'M' ? 'Mobile' : 'Desktop'}">${label}</span>`;
  }

  // ---- leaderboard modal ----
  // platform: 'all' | 'M' | 'C'
  async function _renderLbContent(qteType, mode, platform) {
    platform = platform || _lbPlatform || 'all';
    const type = mode === 'comp' ? qteType + '-comp' : qteType;
    const body = document.getElementById('sb-lb-body');
    if (!body) return;
    body.innerHTML = '<div class="sb-loading">Loading&hellip;</div>';

    const [rows, myRank] = await Promise.all([
      fetchLeaderboard(type, platform),
      currentUser ? fetchMyRank(type, platform) : Promise.resolve(null)
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
          <td><b>${r.score}</b> ${platformBadge(r.platform)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${myRankHtml}
    ${currentUser ? '' : '<p class="sb-empty">Login to submit your scores!</p>'}`;
  }

  async function openLeaderboard(qteType) {
    _lbPlatform = 'all'; // reset filter each time the modal opens
    const initMode = window._qteCompMode ? 'comp' : 'casual';
    openModal(`
      <button class="sb-close" onclick="window._closeModal()">&times;</button>
      <h3 class="sb-title">${cap(qteType)} Leaderboard</h3>
      <div class="sb-lb-tabs">
        <button class="sb-lb-tab${initMode === 'casual' ? ' active' : ''}" onclick="window._lbShowTab('${qteType}','casual',this)">Casual</button>
        <button class="sb-lb-tab comp-tab${initMode === 'comp' ? ' active' : ''}" onclick="window._lbShowTab('${qteType}','comp',this)">Competitive</button>
      </div>
      <div class="lb-plat-tabs">
        <button class="lb-plat-tab active"   onclick="window._lbSetPlatform('${qteType}','${initMode}','all',this)">All</button>
        <button class="lb-plat-tab lb-plat-m" onclick="window._lbSetPlatform('${qteType}','${initMode}','M',this)">Mobile</button>
        <button class="lb-plat-tab lb-plat-c" onclick="window._lbSetPlatform('${qteType}','${initMode}','C',this)">PC</button>
      </div>
      <div id="sb-lb-body"><div class="sb-loading">Loading&hellip;</div></div>
    `);
    await _renderLbContent(qteType, initMode, 'all');
  }

  // ---- all leaderboards view ----
  const QTE_TYPES = ['dagger', 'spear', 'sword', 'fist', 'staff', 'axe', 'hammer', 'dodge'];
  let _allLbPlatform = 'all'; // active platform filter on the all-leaderboards page

  async function loadAllLeaderboards(mode, platform) {
    const grid = document.getElementById('all-lb-grid');
    if (!grid) return;

    // Resolve mode from arg or active tab
    if (!mode) {
      const activeTab = document.querySelector('.all-lb-mode-tab.active');
      mode = activeTab?.dataset.mode || 'casual';
    }
    // Resolve platform from arg or module state
    if (platform !== undefined) _allLbPlatform = platform;
    const plat = _allLbPlatform;

    const suffix = mode === 'comp' ? '-comp' : '';

    grid.innerHTML = '<div class="sb-loading">Loading&hellip;</div>';
    const results = await Promise.all(QTE_TYPES.map(t => fetchLeaderboard(t + suffix, plat)));

    const myName = currentProfile?.username || null;
    grid.innerHTML = QTE_TYPES.map((type, idx) => {
      const rows = results[idx];
      const rowsHtml = rows.length
        ? rows.map((r, i) => `
            <tr${myName && myName === r.username ? ' class="sb-lb-me"' : ''}>
              <td class="all-lb-rank">${i + 1}</td>
              <td class="all-lb-name"><div class="lb-player-cell">${renderAvatar(r.username, r.avatar_url, 20)}<span>${esc(r.username)}</span></div></td>
              <td class="all-lb-score"><b>${r.score}</b> ${platformBadge(r.platform)}</td>
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
  window._sbClient           = sb; // shared authenticated client for other modules
  function deleteAccount() {
    const overlay = document.createElement('div');
    overlay.id = 'sb-delete-confirm-overlay';
    overlay.className = 'sb-delete-confirm-overlay';
    overlay.innerHTML = `
      <div class="sb-delete-confirm-box">
        <h3 class="sb-delete-confirm-title">Delete Account</h3>
        <p class="sb-delete-confirm-body">This will permanently delete your account and all associated data. <strong>This cannot be undone.</strong></p>
        <p class="sb-delete-confirm-body" style="margin-top:6px">Type <strong>DELETE</strong> to confirm:</p>
        <input class="sb-input" id="sb-delete-confirm-input" type="text" placeholder="DELETE" autocomplete="off" style="margin-top:8px">
        <div class="sb-err" id="sb-delete-confirm-err"></div>
        <div class="sb-delete-confirm-actions">
          <button class="auth-btn sb-btn-delete-account" onclick="window._confirmDeleteAccount()">Delete My Account</button>
          <button class="auth-btn auth-btn-out" onclick="document.getElementById('sb-delete-confirm-overlay').remove()">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('sb-delete-confirm-input')?.focus();
  }

  async function confirmDeleteAccount() {
    const input = document.getElementById('sb-delete-confirm-input');
    const errEl = document.getElementById('sb-delete-confirm-err');
    if (!input || input.value.trim() !== 'DELETE') {
      if (errEl) errEl.textContent = 'Type DELETE exactly to confirm.';
      return;
    }
    if (errEl) errEl.textContent = '';
    try {
      const { error } = await sb.rpc('delete_own_account');
      if (error) throw error;
      await sb.auth.signOut();
      document.getElementById('sb-delete-confirm-overlay')?.remove();
      window._closeModal?.();
      renderAuthBar(null, null);
    } catch (e) {
      if (errEl) errEl.textContent = e.message || 'Failed to delete account.';
    }
  }

  // ---- admin panel ----
  async function openAdminPanel() {
    closeProfileMenu();
    if (currentProfile?.username !== ADMIN_USERNAME) return;
    // Load current ban list
    const { data: bans } = await sb.from('banned_usernames').select('username').order('username');
    const banRows = (bans || []).map(b =>
      `<div class="sb-admin-ban-row"><span>${esc(b.username)}</span><button class="sb-admin-unban-btn" onclick="window._unbanUser('${esc(b.username)}')">Unban</button></div>`
    ).join('') || '<div class="sb-admin-empty">No banned users.</div>';
    openModal(`
      <div class="sb-modal-title">Admin Panel</div>
      <div class="sb-form-group">
        <label class="sb-label">Ban username</label>
        <input id="sb-ban-input" class="sb-input" type="text" placeholder="Username to ban" autocomplete="off" maxlength="20">
        <div id="sb-ban-err" class="sb-error"></div>
      </div>
      <button class="sb-submit sb-ban-btn" onclick="window._banUser()">Ban User</button>
      <button id="sb-ban-profanity-btn" class="sb-submit sb-ban-profanity-btn" onclick="window._banAllProfanityUsers()">Ban All Profanity Users</button>
      <div class="sb-admin-ban-list">
        <div class="sb-admin-ban-list-title">Currently Banned</div>
        <div id="sb-admin-ban-rows">${banRows}</div>
      </div>
      <button class="sb-cancel" onclick="window._closeModal()">Close</button>
    `);
  }

  async function banUser() {
    if (currentProfile?.username !== ADMIN_USERNAME) return;
    const errEl = document.getElementById('sb-ban-err');
    const input = document.getElementById('sb-ban-input');
    const name  = (input?.value || '').trim();
    if (!name) { if (errEl) errEl.textContent = 'Enter a username.'; return; }
    // Check user exists
    const { data: profile } = await sb.from('profiles').select('id').eq('username', name).maybeSingle();
    if (!profile) { if (errEl) errEl.textContent = 'User not found.'; return; }
    const { error } = await sb.from('banned_usernames').upsert({ username: name }, { onConflict: 'username' });
    if (error) { if (errEl) errEl.textContent = error.message; return; }
    _bannedSet?.add(name);
    // Refresh ban list in the modal
    const rowsEl = document.getElementById('sb-admin-ban-rows');
    if (rowsEl) {
      const existing = rowsEl.querySelector(`[data-ban="${name}"]`);
      if (!existing) {
        const div = document.createElement('div');
        div.className = 'sb-admin-ban-row';
        div.dataset.ban = name;
        div.innerHTML = `<span>${esc(name)}</span><button class="sb-admin-unban-btn" onclick="window._unbanUser('${esc(name)}')">Unban</button>`;
        rowsEl.querySelector('.sb-admin-empty')?.remove();
        rowsEl.appendChild(div);
      }
    }
    if (input) input.value = '';
    if (errEl) { errEl.style.color = '#66ddaa'; errEl.textContent = `${name} has been banned.`; }
  }

  async function unbanUser(username) {
    if (currentProfile?.username !== ADMIN_USERNAME) return;
    await sb.from('banned_usernames').delete().eq('username', username);
    _bannedSet?.delete(username);
    // Remove from UI
    document.querySelector(`[data-ban="${username}"]`)?.remove();
    const rowsEl = document.getElementById('sb-admin-ban-rows');
    if (rowsEl && !rowsEl.children.length) {
      rowsEl.innerHTML = '<div class="sb-admin-empty">No banned users.</div>';
    }
  }

  async function banAllProfanityUsers() {
    if (currentProfile?.username !== ADMIN_USERNAME) return;
    const errEl = document.getElementById('sb-ban-err');
    const btn   = document.getElementById('sb-ban-profanity-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
    // Fetch all usernames (paginate if needed, profiles table shouldn't be huge)
    const { data: profiles } = await sb.from('profiles').select('username');
    const dirty = (profiles || []).filter(p => p.username && containsProfanity(p.username)).map(p => p.username);
    if (!dirty.length) {
      if (errEl) { errEl.style.color = '#66ddaa'; errEl.textContent = 'No profanity usernames found.'; }
      if (btn) { btn.disabled = false; btn.textContent = 'Ban All Profanity Users'; }
      return;
    }
    const rows = dirty.map(u => ({ username: u }));
    const { error } = await sb.from('banned_usernames').upsert(rows, { onConflict: 'username' });
    if (error) {
      if (errEl) errEl.textContent = error.message;
      if (btn) { btn.disabled = false; btn.textContent = 'Ban All Profanity Users'; }
      return;
    }
    dirty.forEach(u => _bannedSet?.add(u));
    if (errEl) { errEl.style.color = '#66ddaa'; errEl.textContent = `Banned ${dirty.length} user(s): ${dirty.join(', ')}`; }
    // Reload the ban rows in the modal
    const rowsEl = document.getElementById('sb-admin-ban-rows');
    if (rowsEl) {
      dirty.forEach(name => {
        if (!rowsEl.querySelector(`[data-ban="${name}"]`)) {
          const div = document.createElement('div');
          div.className = 'sb-admin-ban-row';
          div.dataset.ban = name;
          div.innerHTML = `<span>${esc(name)}</span><button class="sb-admin-unban-btn" onclick="window._unbanUser('${esc(name)}')">Unban</button>`;
          rowsEl.querySelector('.sb-admin-empty')?.remove();
          rowsEl.appendChild(div);
        }
      });
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Ban All Profanity Users'; }
  }

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
  window._changePassword     = changePassword;
  window._uploadAvatar       = uploadAvatar;
  window._deleteAccount        = deleteAccount;
  window._confirmDeleteAccount = confirmDeleteAccount;
  window._showConsentFromSettings = () => window._showChatConsentModal?.(() => openSettings());
  window._loadAllLeaderboards  = loadAllLeaderboards;
  window._openAdminPanel         = openAdminPanel;
  window._banUser                = banUser;
  window._unbanUser              = unbanUser;
  window._banAllProfanityUsers   = banAllProfanityUsers;

  // Switch casual/competitive on the all-lb page (preserves platform filter)
  window._switchLbMode = function (btn) {
    document.querySelectorAll('.all-lb-mode-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    loadAllLeaderboards(btn.dataset.mode);
  };

  // Switch M/C/All platform filter on the all-lb page
  window._switchAllLbPlatform = function (btn) {
    document.querySelectorAll('.all-lb-plat-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    loadAllLeaderboards(undefined, btn.dataset.platform);
  };

  // Switch casual/competitive inside the per-QTE leaderboard modal
  window._lbShowTab = async (qteType, mode, btn) => {
    document.querySelectorAll('.sb-lb-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    // Update onclick on platform tabs so they carry the new mode
    document.querySelectorAll('.lb-plat-tab').forEach(t => {
      const plat = t.dataset.platform;
      t.onclick = () => window._lbSetPlatform(qteType, mode, plat, t);
    });
    await _renderLbContent(qteType, mode, _lbPlatform);
  };

  // Switch platform filter inside the per-QTE leaderboard modal
  window._lbSetPlatform = async (qteType, mode, platform, btn) => {
    _lbPlatform = platform;
    document.querySelectorAll('.lb-plat-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    await _renderLbContent(qteType, mode, platform);
  };
  window._openForgotPassword   = openForgotPasswordModal;
  window._submitForgotPassword = submitForgotPassword;
  window._submitNewPassword    = submitNewPassword;

  // ================================================================
  //  Shared build storage (short URLs)
  // ================================================================
  const _SB_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  async function saveSharedBuild(payloadObj) {
    const rawName = (payloadObj.n && payloadObj.n !== 'Untitled') ? payloadObj.n : 'Untitled';
    const nameSlug = rawName.replace(/[^A-Za-z0-9]/g, '').slice(0, 16) || 'Untitled';
    const rawUser = currentProfile?.username || '';
    const userSlug = rawUser.replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
    const prefix = userSlug ? userSlug + '-' + nameSlug : nameSlug;
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = Array.from({length: 4}, () => _SB_CHARS[Math.floor(Math.random() * 62)]).join('');
      const id = prefix + '-' + suffix;
      const { error } = await sb.from('shared_builds').insert({ id, payload: payloadObj });
      if (!error) return id;
      if (error.code !== '23505') { console.error('[sb] saveSharedBuild error:', error); return null; }
    }
    return null;
  }
  async function loadSharedBuild(id) {
    const { data, error } = await sb.from('shared_builds').select('payload').eq('id', id).maybeSingle();
    if (error) { console.error('[sb] loadSharedBuild error:', error); return null; }
    if (!data) return null;
    return data.payload;
  }
  window._saveSharedBuild = saveSharedBuild;
  window._loadSharedBuild = loadSharedBuild;

  // Boot: onAuthStateChange fires INITIAL_SESSION and handles session restoration
})();
