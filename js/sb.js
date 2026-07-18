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
  // Admin access is tied to Supabase user IDs so it survives username changes.
  // To find IDs: SELECT p.username, u.id FROM profiles p JOIN auth.users u ON u.id = p.id WHERE p.username IN ('Lycoris','TheAgentsOfRoblox');
  const ADMIN_IDS = new Set([
    'a508b4b7-1d32-4511-a609-4a80ded49681', // Lycoris
    '3a376365-2f03-4e4f-8c5f-6b8020271809', // TheAgentsOfRoblox
  ]);
  function isAdmin() { return !!currentUser && ADMIN_IDS.has(currentUser.id); }

  // Permanently banned — hidden from ban list, cannot be unbanned through the panel
  // Seeded with hardcoded values; DB-loaded entries are added in loadBannedCache()
  const PERMA_BANNED = new Set(['NIGGER']);

  // ---- profanity filter ----
  // Mirrors the chat moderation list in trades.js — keep both in sync.
  // Multi-word phrases are skipped for username checks (usernames can't contain spaces).
  const PROFANITY_LIST = [
    // f-word family
    'fuck','fucking','fucked','fucker','fucks',
    'fuckhead','fuckface','fuckwit','fuckoff',
    'motherfucker','motherfucking','clusterfuck','dumbfuck',
    // s-word family
    'shit','shitting','shithead','shitstain','shitface',
    'bullshit','horseshit','dipshit',
    // b-words
    'bitch','bitches','bitching','bitchass',
    'bastard',
    // c-words
    'cunt','cunting','cocksucker',
    'cock','cockhead',
    // d-word
    'dick','dickhead','dickface',
    // a-words
    'ass','asshole','assholes','arsehole','arseholes',
    'asshat','asswipe','assfuck','assclown','assface',
    'jackass','dumbass','smartass',
    // other profanity
    'pussy','pussies',
    'prick',
    'whore','whorish',
    'slut','slutty','slutting',
    'skank',
    'thot',
    'twat','twatface',
    'wanker','wanking',
    'piss','pissing','pisser','pisshead',
    // sexual
    'cum','cumshot','cumming','cumslut',
    'jizz','jizzing',
    'tit','tits','titties','titty',
    'boob','boobs',
    'boner',
    'blowjob','handjob','rimjob',
    'ballsack','nutsack',
    // racial slurs — anti-Black
    'nigger','nigga','nigg',
    'coon','darkie','blackie',
    'jigaboo','sambo','pickaninny','spook',
    // racial slurs — anti-Latino
    'spic','beaner','wetback',
    // racial slurs — anti-Asian
    'chink','gook','zipperhead','slope',
    // racial slurs — anti-Arab
    'towelhead','raghead','sandnigger',
    // racial slurs — anti-South Asian
    'paki',
    // racial slurs — anti-Indigenous
    'redskin','injun','squaw',
    // racial slurs — anti-Jewish
    'kike','heeb','hymie','jewboy','sheeny',
    // other slurs
    'polack','polak','gypo','gyp','wop','dago',
    // gender / sexuality slurs
    'faggot','fag','tranny','trannies','shemale','ladyboy','troon',
    'homo','dyke','lesbo','poofter','poof','fudgepacker',
    // disability slurs
    'retard','retarded','spaz','spastic','mongoloid','cripple',
    // abuse
    'abuser','_abuser','abuse','abusing','abused','abuses','abusive',
    'childabuser','animalabuser',
    // self-harm
    'kys','kms',
    // extremist
    '1488',
    // csam-adjacent
    'loli','lolita','jailbait',
    'pedo','pedophile','paedophile',
    // nsfw
    'porn','porno','pornography',
    'hentai',
    'nude','nudes',
    'rape','raping','raped','rapist',
    'anal',
    'masturbate','masturbating','masturbation',
    'dildo','bdsm','xxx',
  ];

  function containsProfanity(str) {
    const lower = str.toLowerCase();
    return PROFANITY_LIST.some(w => lower.includes(w));
  }

  // ---- ban helpers ----
  let _bannedSet        = null;       // Set of banned usernames (normal ban — username based)
  let _permaBannedIdSet = new Set();  // Set of perma-banned UUIDs (uuid based)

  async function loadBannedCache() {
    const bansRes = await sb.from('banned_usernames').select('username');
    _bannedSet = new Set((bansRes.data || []).map(r => r.username));
    try {
      const { data: permaData } = await sb.from('perma_banned_usernames').select('username, user_id');
      (permaData || []).forEach(r => {
        PERMA_BANNED.add(r.username);
        if (r.user_id) _permaBannedIdSet.add(r.user_id);
        // Also block the username from future registrations
        const lname = r.username.toLowerCase();
        if (!PROFANITY_LIST.includes(lname)) PROFANITY_LIST.push(lname);
      });
    } catch (_) {}
  }

  function isBannedCached(username) {
    return _bannedSet ? _bannedSet.has(username) : false;
  }

  // Normal ban: username check. Perma ban: UUID check.
  async function checkIfBanned(userId, username) {
    if (userId && _permaBannedIdSet.has(userId)) return true;
    if (_bannedSet) return _bannedSet.has(username);
    const { data } = await sb.from('banned_usernames').select('username').eq('username', username).maybeSingle();
    return !!data;
  }

  // Load ban cache immediately so leaderboard filtering is ready
  loadBannedCache();

  // ---- monthly local-HS reset ----
  // Each QTE stores highscores in localStorage and only submits to the server
  // when a new local high is achieved. After a monthly wipe those stale values
  // gate new submissions. Reset them whenever the month rolls over.
  // Deferred to window.load so qte.js listeners are registered before the event fires.
  window.addEventListener('load', function checkMonthlyReset() {
    const MONTH_KEY = 'alb:hs-month';
    const stored = localStorage.getItem(MONTH_KEY);
    const now    = new Date().toISOString().slice(0, 7); // "2026-05"
    if (stored !== now) {
      localStorage.setItem(MONTH_KEY, now);
      window.dispatchEvent(new Event('alb-scores-reset'));
    }
  });

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
      reconcileServerScores();
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
    // Let other modules (bank sync, etc.) react to login/logout/session restore.
    window.dispatchEvent(new Event('alb-auth-changed'));
  });

  // ---- email validation ----
  // Common typos of popular providers -> the address the user almost certainly meant.
  const EMAIL_TYPOS = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com',
    'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gnail.com': 'gmail.com',
    'gamil.com': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com',
    'hotmal.com': 'hotmail.com', 'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com',
    'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yhaoo.com': 'yahoo.com',
    'icloud.co': 'icloud.com', 'icloud.con': 'icloud.com'
  };

  function validateEmail(email) {
    // Standard format check: local@domain.tld with a real TLD (2+ letters).
    if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email)) {
      throw new Error('Please enter a valid email address.');
    }
    const domain = email.split('@')[1].toLowerCase();
    if (EMAIL_TYPOS[domain]) {
      throw new Error(`Did you mean @${EMAIL_TYPOS[domain]}? Please check your email.`);
    }
  }

  // ---- sign up ----
  async function signUp(email, password, username) {
    validateEmail(email);
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
      // Check ban before allowing login (UUID-first, username fallback)
      const banned = await checkIfBanned(data.user.id, username);
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

  // ---- anti-cheat: session IDs keyed by qte_type, consumed on submission ----
  const _sessionIds = {};

  // Called by each QTE trainer when the player clicks Start.
  // Fires a server-side timestamp so submit_score can validate elapsed time.
  async function startQteSession(qteType) {
    if (!currentUser) return;
    const { data, error } = await sb.rpc('start_qte_session', {
      p_user_id:  currentUser.id,
      p_qte_type: qteType,
    });
    if (error) { console.warn('[sb] startQteSession error', error.message); return; }
    _sessionIds[qteType] = data;
  }

  // ---- submit score — server validates session timing before accepting ----
  // The session is NOT consumed on success: scores submit on every new high
  // DURING a run (streak 1, 2, 3 …), so the same session must cover all of
  // them. Consuming it after the first submission made every later (higher)
  // score get dropped, freezing leaderboard entries at the first new high.
  async function submitScore(qteType, score) {
    if (!currentUser || !score) return;
    const sessionId = _sessionIds[qteType] ?? null;
    if (!sessionId) { console.warn('[sb] submitScore: no valid session for', qteType, '— score not saved'); return; }
    const { error } = await sb.rpc('submit_score', {
      p_user_id:    currentUser.id,
      p_qte_type:   qteType,
      p_score:      score,
      p_platform:   PLATFORM,
      p_month:      currentMonth(),
      p_session_id: sessionId,
    });
    if (error) {
      console.error('[sb] submitScore error', qteType, score, error.message);
      // Session likely rejected/expired server-side — re-arm so the next high can submit
      delete _sessionIds[qteType];
      startQteSession(qteType);
      return;
    }
    console.log('[sb] submitScore ok', qteType, score, PLATFORM);
    // upsert personal best — only update if new score is higher
    const { data: pb, error: pbErr } = await sb.from('personal_bests')
      .select('score')
      .eq('user_id', currentUser.id)
      .eq('qte_type', qteType)
      .maybeSingle();
    if (pbErr) return; // can't verify the existing best — don't risk overwriting it
    if (!pb || score > pb.score) {
      await sb.from('personal_bests').upsert(
        { user_id: currentUser.id, qte_type: qteType, score, platform: PLATFORM, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,qte_type' }
      );
    }
  }

  // ---- fetch the current user's all-time personal best for a QTE ----
  async function fetchMyBest(qteType) {
    if (!currentUser) return null;
    const { data } = await sb.from('personal_bests')
      .select('score, platform')
      .eq('user_id', currentUser.id)
      .eq('qte_type', qteType)
      .maybeSingle();
    return data || null;
  }

  // ---- current month key e.g. "2026-05" ----
  function currentMonth() { return new Date().toISOString().slice(0, 7); }

  // ---- reconcile local bests vs the server leaderboard ----
  // QTE trainers only submit when a score beats the LOCAL stored best. If the
  // server's monthly entry fell behind the local best (the old single-use
  // session bug dropped submissions), any score below the local best — even
  // one far above the server entry — was never re-submitted, so the
  // leaderboard stayed frozen. On load, if any local best is ahead of the
  // server, reset the local bests so submissions flow again as the player
  // climbs back up.
  let _reconciledScores = false;
  async function reconcileServerScores() {
    if (_reconciledScores || !currentUser) return;
    _reconciledScores = true;
    const { data, error } = await sb.from('leaderboard')
      .select('qte_type, score')
      .eq('user_id', currentUser.id)
      .eq('score_month', currentMonth());
    if (error) { _reconciledScores = false; return; }
    const serverBest = {};
    (data || []).forEach(r => { serverBest[r.qte_type] = Math.max(serverBest[r.qte_type] || 0, r.score || 0); });
    let stale = false;
    Object.keys(localStorage).forEach(key => {
      let type = null, m;
      if      ((m = key.match(/^alb:(.+)-hs-comp$/))) type = m[1] + '-comp';
      else if ((m = key.match(/^alb:(.+)-hs-v2$/)))   type = m[1];
      else if ((m = key.match(/^alb:(.+)-hs$/)))      type = m[1];
      if (!type) return;
      const local = parseInt(localStorage.getItem(key), 10) || 0;
      if (local > (serverBest[type] || 0)) stale = true;
    });
    if (stale) {
      console.log('[sb] local bests are ahead of the server leaderboard — resetting local bests so scores re-submit');
      window.dispatchEvent(new Event('alb-scores-reset'));
    }
  }

  // ---- fetch top-10 for a QTE (current month only) ----
  // platform: 'all' (no filter) | 'M' | 'C'
  // profileMap: optional pre-fetched { userId: profileObj } — avoids redundant DB calls
  async function fetchLeaderboard(qteType, platform, profileMap) {
    let query = sb
      .from('leaderboard')
      .select('user_id, score, platform')
      .eq('qte_type', qteType)
      .eq('score_month', currentMonth())
      .order('score', { ascending: false })
      .limit(50);
    if (platform && platform !== 'all') query = query.eq('platform', platform);
    const { data, error } = await query;
    if (error) { console.error('[sb] fetchLeaderboard error', error.message); return []; }
    const rows = data || [];
    let pm = profileMap;
    if (!pm) {
      const ids = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
      const { data: profs } = ids.length
        ? await sb.from('profiles').select('id, username, avatar_url').in('id', ids)
        : { data: [] };
      pm = Object.fromEntries((profs || []).map(p => [p.id, p]));
    }
    return rows
      .map(r => ({
        user_id:    r.user_id,
        username:   pm[r.user_id]?.username   || '???',
        avatar_url: pm[r.user_id]?.avatar_url || null,
        score:      r.score,
        platform:   r.platform || null,
      }))
      .filter(r => !isBannedCached(r.username))
      .slice(0, 10);
  }

  // ---- fetch all-time record holder for a single QTE ----
  async function fetchRecord(qteType) {
    const { data, error } = await sb
      .from('leaderboard_records')
      .select('score, platform, user_id')
      .eq('qte_type', qteType)
      .maybeSingle();
    if (error) { console.error('[sb] fetchRecord error', error.message); return null; }
    if (!data) return null;
    const { data: prof } = await sb
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', data.user_id)
      .maybeSingle();
    if (!prof?.username) return null;
    return {
      user_id:    data.user_id,
      username:   prof.username,
      avatar_url: prof.avatar_url || null,
      score:      data.score,
      platform:   data.platform || null,
    };
  }

  // ---- batch fetch records for multiple QTE types (2 queries total) ----
  async function fetchRecordsBatch(qteTypes) {
    const { data: recs, error } = await sb
      .from('leaderboard_records')
      .select('qte_type, score, platform, user_id')
      .in('qte_type', qteTypes);
    if (error) { console.error('[sb] fetchRecordsBatch error', error.message); return {}; }
    if (!recs || !recs.length) return {};

    const userIds = [...new Set(recs.map(r => r.user_id).filter(Boolean))];
    const { data: profs, error: profsErr } = await sb
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', userIds);
    if (profsErr) { console.error('[sb] fetchRecordsBatch profiles error', profsErr.message); return {}; }
    const profMap = Object.fromEntries((profs || []).map(p => [p.id, p]));

    const result = {};
    for (const r of recs) {
      const prof = profMap[r.user_id];
      if (!prof?.username) continue;
      result[r.qte_type] = {
        user_id:    r.user_id,
        username:   prof.username,
        avatar_url: prof.avatar_url || null,
        score:      r.score,
        platform:   r.platform || null,
      };
    }
    return result;
  }

  // ---- fetch the current user's rank for a QTE (current month only) ----
  // platform: 'all' | 'M' | 'C' — rank is computed within that subset
  async function fetchMyRank(qteType, platform) {
    if (!currentUser) return null;
    let mineQ = sb.from('leaderboard')
      .select('score, platform')
      .eq('user_id', currentUser.id)
      .eq('qte_type', qteType)
      .eq('score_month', currentMonth());
    if (platform && platform !== 'all') mineQ = mineQ.eq('platform', platform);
    const { data: mine } = await mineQ.maybeSingle();
    if (!mine) return null;
    let aboveQ = sb.from('leaderboard')
      .select('*', { count: 'exact', head: true })
      .eq('qte_type', qteType)
      .eq('score_month', currentMonth())
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
  // For values interpolated into a JS string inside an inline onclick attribute:
  // strip quotes/backslashes (JS-string breakout) then HTML-escape (attribute breakout).
  function escAttrJs(s) {
    return esc(String(s == null ? '' : s).replace(/['"\\]/g, ''));
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
        `<span class="sb-orb-wrap">` +
          renderAvatar(username, avatar_url, 32,
            `title="${esc(username)}" onclick="window._toggleProfileMenu(event)"`) +
          (isAdmin() ? `<span id="sb-admin-report-dot" class="sb-report-dot" style="display:none"></span>` : '') +
        `</span>`;
      window._syncNotifBell?.();
      window._syncMsgBadge?.();
      window._reportsSyncBadges?.();
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
      <button class="sb-menu-item" onclick="window._closeProfileMenu();window._overlayToggle?.()">UI Overlay</button>
      <button class="sb-menu-item sb-menu-item-trackers" onclick="window._toggleTrackerSubmenu(event)">Trackers <span class="sb-submenu-arrow" id="sb-trackers-arrow">&#9656;</span></button>
      <div class="sb-submenu" id="sb-trackers-submenu" style="display:none">
        <button class="sb-menu-item sb-menu-item-venia" onclick="window._closeProfileMenu();window._veniaTrackerOpen?.()">&#9711;&nbsp; Venia Orb Tracker</button>
        <button class="sb-menu-item sb-menu-item-petent" onclick="window._closeProfileMenu();window._petentTrackerOpen?.()">&#9632;&nbsp; Petent Tracker</button>
        <button class="sb-menu-item sb-menu-item-astra" onclick="window._closeProfileMenu();window._astraTrackerOpen?.()">&#9733;&nbsp; Astra Tracker</button>
        <button class="sb-menu-item sb-menu-item-amorus" onclick="window._closeProfileMenu();window._amorusTrackerOpen?.()">&#9670;&nbsp; Amorus Tracker</button>
      </div>
      <button class="sb-menu-item sb-menu-item-bank" onclick="window._closeProfileMenu();window._bankOpen?.()">Bank</button>
      ${isAdmin() ? `<div class="sb-menu-divider"></div><button class="sb-menu-item sb-menu-item-admin" onclick="window._openAdminPanel()">&#9760;&nbsp; Admin Panel <span id="sb-menu-report-badge" class="sb-report-badge" style="display:none"></span></button>` : ''}
      <div class="sb-menu-divider"></div>
      <button class="sb-menu-item sb-menu-item-danger" onclick="window._sbSignOut()">&#10148;&nbsp; Logout</button>`;
    document.body.appendChild(menu);
    window._reportsSyncBadges?.();
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

  function toggleTrackerSubmenu(e) {
    e?.stopPropagation();
    const sub   = document.getElementById('sb-trackers-submenu');
    const arrow = document.getElementById('sb-trackers-arrow');
    if (!sub) return;
    const open = sub.style.display !== 'none';
    sub.style.display = open ? 'none' : 'block';
    if (arrow) arrow.innerHTML = open ? '&#9656;' : '&#9662;';
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
      <button class="auth-btn sb-btn-full sb-btn-toggle-pw" id="sb-toggle-pw-btn" onclick="window._togglePasswordFields()">Change Password</button>
      <div id="sb-pw-fields" style="display:none;margin-top:10px">
        <input class="sb-input" id="sb-old-pass" type="password" placeholder="Current password" autocomplete="current-password">
        <input class="sb-input" id="sb-new-pass" type="password" placeholder="New password" autocomplete="new-password">
        <input class="sb-input" id="sb-conf-pass" type="password" placeholder="Confirm new password" autocomplete="new-password">
        <div class="sb-err" id="sb-pw-err"></div>
        <button class="auth-btn sb-btn-full" id="sb-pw-btn" onclick="window._changePassword()">Confirm Change</button>
      </div>
      <div class="sb-menu-divider" style="margin:16px 0 12px"></div>
      <p class="sb-field-label">Privacy &amp; Terms Consent</p>
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
    // Close on backdrop press (not click): a click fires on the backdrop even
    // when a text-selection drag merely ends there, closing the modal mid-edit.
    m.onclick = null;
    m.onmousedown = e => { if (e.target === m) closeModal(); };
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

    const [rows, myRank, record, myBest] = await Promise.all([
      loadBannedCache().then(() => fetchLeaderboard(type, platform)).catch(() => []),
      currentUser ? fetchMyRank(type, platform).catch(() => null) : Promise.resolve(null),
      fetchRecord(type).catch(() => null),
      currentUser ? fetchMyBest(type).catch(() => null) : Promise.resolve(null),
    ]);

    if (!document.getElementById('sb-lb-body')) return; // modal closed

    const myName = currentProfile?.username || null;

    // Record holder pinned at top — separate from monthly rank numbering
    const recordRowHtml = record ? `
      <tr class="sb-lb-record-row${myName === record.username ? ' sb-lb-me' : ''}">
        <td>👑</td>
        <td><div class="lb-player-cell">${renderAvatar(record.username, record.avatar_url, 22, `data-orb="1" onclick="window._openUserProfile({username:'${escAttrJs(record.username)}'})"`)}<span>${esc(record.username)}</span></div></td>
        <td style="white-space:nowrap"><b>${record.score}</b> ${platformBadge(record.platform)}</td>
      </tr>` : '';

    if (!rows.length && !record) {
      body.innerHTML = mode === 'comp'
        ? '<p class="sb-empty">No competitive scores this month — be the first!</p>'
        : '<p class="sb-empty">No scores this month — be the first!</p>';
      return;
    }

    const inTop10 = myName && rows.some(r => r.username === myName);
    const pbHtml = myBest ? ` &mdash; PB: <b>${myBest.score}</b>` : '';
    let myRankHtml = '';
    if (currentUser && !inTop10 && myRank) {
      myRankHtml = `<p class="sb-my-rank">Your rank: <b>#${myRank.rank}</b> &mdash; streak <b>${myRank.score}</b>${pbHtml}</p>`;
    } else if (currentUser && !inTop10 && !myRank) {
      myRankHtml = `<p class="sb-my-rank">You have no score yet this month.${myBest ? ` Your PB: <b>${myBest.score}</b>` : ''}</p>`;
    }

    const monthlyRows = rows;
    let rank = 0;
    const monthlyRowsHtml = monthlyRows.map(r => {
      rank++;
      return `
      <tr class="${myName === r.username ? 'sb-lb-me' : ''}">
        <td>${rank}</td>
        <td><div class="lb-player-cell">${renderAvatar(r.username, r.avatar_url, 22, `data-orb="1" onclick="window._openUserProfile({username:'${escAttrJs(r.username)}'})"`)}<span>${esc(r.username)}</span></div></td>
        <td style="white-space:nowrap"><b>${r.score}</b> ${platformBadge(r.platform)}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `<table class="sb-lb-table">
      <thead><tr><th>#</th><th>Player</th><th>Streak</th></tr></thead>
      <tbody>${recordRowHtml}${monthlyRowsHtml || `<tr><td colspan="3" class="sb-empty" style="text-align:center">No scores this month</td></tr>`}</tbody>
    </table>
    ${myRankHtml}
    ${currentUser && inTop10 && myBest ? `<p class="sb-my-rank">Your PB: <b>${myBest.score}</b></p>` : ''}
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
  const QTE_TYPES = ['dagger', 'spear', 'sword', 'fist', 'staff', 'axe', 'hammer', 'dodge', 'thorian', 'thorian-new', 'dagger-new'];
  const QTE_LABELS = { 'thorian-new': 'Thorian (New)', 'dagger-new': 'Dagger (New)' };
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
    try {
    await loadBannedCache();
    const allTypes = QTE_TYPES.map(t => t + suffix);

    // Step 1: fetch all leaderboard rows + all records in parallel (no JOINs)
    // No global LIMIT — month + type filter already bounds the result set,
    // and a global limit would starve lower-scoring QTE types.
    let lbQuery = sb
      .from('leaderboard')
      .select('user_id, score, platform, qte_type')
      .in('qte_type', allTypes)
      .eq('score_month', currentMonth())
      .order('score', { ascending: false });
    if (plat && plat !== 'all') lbQuery = lbQuery.eq('platform', plat);

    const [lbRes, recordMap] = await Promise.all([
      lbQuery,
      fetchRecordsBatch(allTypes).catch(() => ({})),
    ]);

    if (lbRes.error) console.error('[sb] loadAllLeaderboards lb error', lbRes.error.message);

    // Step 2: batch fetch all profiles needed
    const lbRows = lbRes.data || [];
    const allUserIds = [...new Set([
      ...lbRows.map(r => r.user_id),
      ...Object.values(recordMap).map(r => r.user_id),
    ].filter(Boolean))];
    const { data: profs, error: profsErr } = allUserIds.length
      ? await sb.from('profiles').select('id, username, avatar_url').in('id', allUserIds)
      : { data: [], error: null };
    if (profsErr) console.error('[sb] loadAllLeaderboards profiles error', profsErr.message);
    const pm = Object.fromEntries((profs || []).map(p => [p.id, p]));

    // Step 3: group leaderboard rows by qte_type, top 10 each
    const grouped = {};
    for (const r of lbRows) {
      if (!grouped[r.qte_type]) grouped[r.qte_type] = [];
      if (grouped[r.qte_type].length >= 10) continue;
      const username = pm[r.user_id]?.username || '???';
      if (isBannedCached(username)) continue;
      grouped[r.qte_type].push({
        user_id:    r.user_id,
        username,
        avatar_url: pm[r.user_id]?.avatar_url || null,
        score:      r.score,
        platform:   r.platform || null,
      });
    }
    // Patch recordMap with full profile data
    for (const [qt, rec] of Object.entries(recordMap)) {
      const p = pm[rec.user_id];
      if (p) { rec.username = p.username; rec.avatar_url = p.avatar_url || null; }
    }

    const myName = currentProfile?.username || null;
    grid.innerHTML = QTE_TYPES.map((type) => {
      const rec = recordMap[type + suffix];
      const monthRows = grouped[type + suffix] || [];
      const recordRowHtml = rec ? `
        <tr class="sb-lb-record-row${myName && myName === rec.username ? ' sb-lb-me' : ''}">
          <td class="all-lb-rank">👑</td>
          <td class="all-lb-name"><div class="lb-player-cell">${renderAvatar(rec.username, rec.avatar_url, 20, `data-orb="1" onclick="window._openUserProfile({username:'${escAttrJs(rec.username)}'})"`)}<span>${esc(rec.username)}</span></div></td>
          <td class="all-lb-score"><b>${rec.score}</b> ${platformBadge(rec.platform)}</td>
        </tr>` : '';
      const filteredRows = monthRows;
      const monthlyHtml = filteredRows.length
        ? filteredRows.map((r, i) => `
            <tr class="${myName && myName === r.username ? 'sb-lb-me' : ''}">
              <td class="all-lb-rank">${i + 1}</td>
              <td class="all-lb-name"><div class="lb-player-cell">${renderAvatar(r.username, r.avatar_url, 20, `data-orb="1" onclick="window._openUserProfile({username:'${escAttrJs(r.username)}'})"`)}<span>${esc(r.username)}</span></div></td>
              <td class="all-lb-score"><b>${r.score}</b> ${platformBadge(r.platform)}</td>
            </tr>`).join('')
        : (!rec ? `<tr><td colspan="3" class="all-lb-empty">No scores this month</td></tr>` : '');
      return `
        <div class="all-lb-card">
          <div class="all-lb-card-title">${QTE_LABELS[type] || cap(type)}</div>
          <table class="sb-lb-table all-lb-table">
            <thead><tr><th>#</th><th>Player</th><th>Streak</th></tr></thead>
            <tbody>${recordRowHtml}${monthlyHtml}</tbody>
          </table>
        </div>`;
    }).join('');
    } catch (e) {
      console.error('[sb] loadAllLeaderboards error', e);
      grid.innerHTML = '<p class="sb-empty">Failed to load leaderboards. Please refresh.</p>';
    }
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
  let _adminTab = 'actions';

  function adminSetStatus(msg, ok = false) {
    const el = document.getElementById('sb-admin-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? '#66ddaa' : '#ff8888';
  }

  function adminSwitchTab(tab) {
    _adminTab = tab;
    document.querySelectorAll('.sb-admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.sb-admin-panel').forEach(p => p.style.display = p.dataset.panel === tab ? 'block' : 'none');
  }

  async function openAdminPanel() {
    closeProfileMenu();
    if (!isAdmin()) return;
    const { data: bans } = await sb.from('banned_usernames').select('username').order('username');
    const banRows = _renderBanRows(bans || []);
    openModal(`
      <button class="sb-close" onclick="window._closeModal()">&times;</button>
      <div class="sb-admin-header">
        <span class="sb-admin-crown">&#9760;</span>
        <span class="sb-admin-title">Admin Panel</span>
      </div>
      <div class="sb-admin-tabs">
        <button class="sb-admin-tab active" data-tab="actions" onclick="window._adminSwitchTab('actions')">User Actions</button>
        <button class="sb-admin-tab" data-tab="banned" onclick="window._adminSwitchTab('banned')">Banned (${(bans||[]).length})</button>
        <button class="sb-admin-tab" data-tab="listings" onclick="window._adminSwitchTab('listings');window._adminLoadListings()">Listings</button>
        <button class="sb-admin-tab" data-tab="tools" onclick="window._adminSwitchTab('tools')">Tools</button>
        <button class="sb-admin-tab" data-tab="reports" onclick="window._adminSwitchTab('reports');window._reportsLoadAdmin&&window._reportsLoadAdmin()">Reports <span id="sb-admin-reports-badge" class="sb-report-badge" style="display:none"></span></button>
      </div>
      <div id="sb-admin-status" class="sb-admin-status"></div>

      <div class="sb-admin-panel" data-panel="actions" style="display:block">
        <div class="sb-admin-search-row">
          <input id="sb-admin-uname" class="sb-input" type="text" placeholder="Enter username…" autocomplete="off" maxlength="20"
            onkeydown="if(event.key==='Enter') window._adminLookup()">
          <button class="sb-admin-search-btn" onclick="window._adminLookup()">Search</button>
        </div>
        <div id="sb-admin-user-card" class="sb-admin-user-card" style="display:none">
          <div class="sb-admin-user-info">
            <div id="sb-admin-avatar-wrap"></div>
            <div>
              <div id="sb-admin-uname-display" class="sb-admin-uname-display"></div>
              <div id="sb-admin-user-meta" class="sb-admin-user-meta"></div>
            </div>
          </div>
          <div class="sb-admin-actions">
            <button class="sb-admin-action-btn sb-admin-btn-ban" onclick="window._adminBanUser()">🚫 Ban</button>
            <button class="sb-admin-action-btn sb-admin-btn-perma" onclick="window._adminPermaBanUser()">🔒 Perma Ban</button>
            <button class="sb-admin-action-btn sb-admin-btn-scores" onclick="window._adminClearScores()">📊 Clear All Scores</button>
            <button class="sb-admin-action-btn sb-admin-btn-scores-one" onclick="window._adminClearOneScore()">🎯 Clear Specific Score</button>
            <button class="sb-admin-action-btn sb-admin-btn-listings" onclick="window._adminDeleteListings()">🗑 Delete Listings</button>
            <button class="sb-admin-action-btn sb-admin-btn-wipe" onclick="window._adminBanAndWipe()">☠ Ban + Wipe All</button>
          </div>
        </div>
      </div>

      <div class="sb-admin-panel" data-panel="banned" style="display:none">
        <div id="sb-admin-ban-rows" class="sb-admin-ban-list">${banRows}</div>
      </div>

      <div class="sb-admin-panel" data-panel="listings" style="display:none">
        <div class="sb-admin-search-row">
          <input id="sb-admin-listing-filter" class="sb-input" type="text" placeholder="Filter by username…" autocomplete="off"
            oninput="window._adminFilterListings(this.value)">
        </div>
        <div id="sb-admin-listing-rows" class="sb-admin-listing-list">
          <div class="sb-admin-empty">Switch to this tab to load listings.</div>
        </div>
      </div>

      <div class="sb-admin-panel" data-panel="tools" style="display:none">
        <button id="sb-ban-profanity-btn" class="sb-admin-tool-btn" onclick="window._banAllProfanityUsers()">
          🔍 Scan &amp; Ban All Profanity Usernames
        </button>
        <button id="sb-purge-expired-btn" class="sb-admin-tool-btn" onclick="window._adminPurgeExpired(this)">
          🗑 Purge Expired Trades &amp; Parties
        </button>
      </div>

      <div class="sb-admin-panel" data-panel="reports" style="display:none">
        <div class="sb-admin-search-row">
          <input id="sb-reports-search" class="sb-input" type="text" placeholder="Filter by username…" autocomplete="off"
            oninput="window._reportsFilter && window._reportsFilter(this.value)">
          <button class="sb-admin-search-btn" onclick="window._reportsClearAll && window._reportsClearAll()">Clear All</button>
        </div>
        <div id="sb-admin-reports-list" class="sb-admin-reports-list"><div class="sb-admin-empty">Open the tab to load reports.</div></div>
      </div>
    `);
    document.querySelector('.sb-modal-box')?.classList.add('sb-admin-modal-box');
    _adminTab = 'actions';
    _adminCurrentUser = null;
    window._reportsSyncBadges?.();
  }

  let _adminCurrentUser = null; // { username, id }

  function _renderBanRows(bans) {
    const visible = (bans || []).filter(b => !PERMA_BANNED.has(b.username));
    if (!visible.length) return '<div class="sb-admin-empty">No banned users.</div>';
    return visible.map(b =>
      `<div class="sb-admin-ban-row" data-ban="${esc(b.username)}">
        <span>${esc(b.username)}</span>
        <div style="display:flex;gap:6px">
          <button class="sb-admin-unban-btn" onclick="window._unbanUser('${esc(b.username)}')">Unban</button>
          <button class="sb-admin-perma-btn" onclick="window._adminPermaBanUser('${esc(b.username)}')">🔒 Perma Ban</button>
        </div>
      </div>`
    ).join('');
  }

  async function adminLookup() {
    if (!isAdmin()) return;
    const name = (document.getElementById('sb-admin-uname')?.value || '').trim();
    if (!name) { adminSetStatus('Enter a username.'); return; }
    adminSetStatus('Searching…');
    document.getElementById('sb-admin-user-card').style.display = 'none';
    document.getElementById('sb-admin-results')?.remove();

    const { data: profiles } = await sb.from('profiles')
      .select('id, username, created_at')
      .ilike('username', `%${name}%`)
      .order('username')
      .limit(20);

    if (!profiles?.length) { adminSetStatus('No users found.'); return; }
    adminSetStatus('');

    // If exact match, load directly
    if (profiles.length === 1) { adminLoadUserCard(profiles[0]); return; }

    // Otherwise show a results list
    const list = document.createElement('div');
    list.id = 'sb-admin-results';
    list.className = 'sb-admin-results';
    list.innerHTML = profiles.map(p =>
      `<div class="sb-admin-result-row" onclick="window._adminSelectUser('${esc(p.id)}')">
        ${renderAvatar(p.username, null, 22)}
        <span>${esc(p.username)}</span>
      </div>`
    ).join('');
    document.getElementById('sb-admin-user-card').insertAdjacentElement('beforebegin', list);
  }

  async function adminSelectUser(userId) {
    document.getElementById('sb-admin-results')?.remove();
    adminSetStatus('Loading…');
    const { data: profile } = await sb.from('profiles')
      .select('id, username, created_at').eq('id', userId).maybeSingle();
    if (!profile) { adminSetStatus('User not found.'); return; }
    adminLoadUserCard(profile);
  }

  async function adminLoadUserCard(profile) {
    _adminCurrentUser = profile;
    const [{ count: scoreCount }, { count: listingCount }] = await Promise.all([
      sb.from('leaderboard').select('*', { count: 'exact', head: true }).eq('user_id', profile.id),
      sb.from('trade_listings').select('*', { count: 'exact', head: true }).eq('username', profile.username),
    ]);
    const joined = profile.created_at ? new Date(profile.created_at).toLocaleDateString() : 'Unknown';
    const card = document.getElementById('sb-admin-user-card');
    document.getElementById('sb-admin-avatar-wrap').innerHTML = renderAvatar(profile.username, null, 36);
    document.getElementById('sb-admin-uname-display').textContent = profile.username;
    document.getElementById('sb-admin-user-meta').innerHTML =
      `Joined: ${joined} &nbsp;·&nbsp; Scores: ${scoreCount ?? 0} &nbsp;·&nbsp; Listings: ${listingCount ?? 0}`;
    card.style.display = 'block';
    const isBanned = isBannedCached(profile.username);
    const isPerma  = PERMA_BANNED.has(profile.username);
    const banBtn   = card.querySelector('.sb-admin-btn-ban');
    const permaBtn = card.querySelector('.sb-admin-btn-perma');
    if (banBtn) {
      banBtn.textContent    = isPerma ? '🔒 Perma Banned' : (isBanned ? '✅ Unban' : '🚫 Ban');
      banBtn.dataset.banned = isBanned || isPerma ? '1' : '0';
      banBtn.disabled       = isPerma;
    }
    if (permaBtn) {
      permaBtn.disabled    = isPerma;
      permaBtn.textContent = isPerma ? '🔒 Perma Banned' : '🔒 Perma Ban';
    }
    adminSetStatus('');
  }

  async function adminBanUser() {
    if (!isAdmin() || !_adminCurrentUser) return;
    if (PERMA_BANNED.has(_adminCurrentUser.username)) {
      adminSetStatus(`${_adminCurrentUser.username} is permanently banned.`); return;
    }
    const banBtn = document.querySelector('.sb-admin-btn-ban');
    const isBanned = banBtn?.dataset.banned === '1';
    const { username } = _adminCurrentUser;
    if (isBanned) {
      await sb.from('banned_usernames').delete().eq('username', username);
      _bannedSet?.delete(username);
      banBtn.textContent = '🚫 Ban'; banBtn.dataset.banned = '0';
      adminSetStatus(`${username} unbanned.`, true);
      _refreshBannedTab(username, 'remove');
    } else {
      const { error } = await sb.from('banned_usernames').upsert({ username }, { onConflict: 'username' });
      if (error) { adminSetStatus(error.message); return; }
      _bannedSet?.add(username);
      banBtn.textContent = '✅ Unban'; banBtn.dataset.banned = '1';
      adminSetStatus(`${username} banned.`, true);
      _refreshBannedTab(username, 'add');
    }
  }

  async function adminPermaBanUser(usernameArg, userIdArg) {
    if (!isAdmin()) return;
    const username = usernameArg || _adminCurrentUser?.username;
    const userId   = userIdArg   || _adminCurrentUser?.id || null;
    if (!username) return;
    if (PERMA_BANNED.has(username)) { adminSetStatus(`${username} is already permanently banned.`); return; }
    if (!confirm(`Permanently ban "${username}"? This cannot be undone from the panel.`)) return;

    adminSetStatus('Applying permanent ban…');
    const { error: e1 } = await sb.from('perma_banned_usernames')
      .insert({ username, user_id: userId || null });
    if (e1 && !e1.message?.includes('duplicate')) { adminSetStatus(e1.message); return; }
    await sb.from('banned_usernames')
      .upsert({ username, user_id: userId || null }, { onConflict: 'username' });

    PERMA_BANNED.add(username);
    _bannedSet?.add(username);
    if (userId) _permaBannedIdSet.add(userId);
    // Block the username from future registrations via the profanity filter
    const lname = username.toLowerCase();
    if (!PROFANITY_LIST.includes(lname)) PROFANITY_LIST.push(lname);

    // Remove from the ban list UI (perma banned are hidden there)
    _refreshBannedTab(username, 'remove');

    // Update action buttons if this user is currently displayed
    if (_adminCurrentUser?.username === username) {
      const banBtn   = document.querySelector('.sb-admin-btn-ban');
      const permaBtn = document.querySelector('.sb-admin-btn-perma');
      if (banBtn)   { banBtn.textContent = '🔒 Perma Banned'; banBtn.disabled = true; banBtn.dataset.banned = '1'; }
      if (permaBtn) { permaBtn.textContent = '🔒 Perma Banned'; permaBtn.disabled = true; }
    }
    adminSetStatus(`${username} permanently banned.`, true);
  }

  // ── Admin: trade listings tab ────────────────────────────────
  let _adminListings = [];

  async function adminLoadListings() {
    if (!isAdmin()) return;
    const rowsEl = document.getElementById('sb-admin-listing-rows');
    if (!rowsEl) return;
    rowsEl.innerHTML = '<div class="sb-admin-empty">Loading…</div>';
    const { data, error } = await sb.from('trade_listings')
      .select('id, username, type, items, lf_items, item, lf, gold_offer, gold_want, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { rowsEl.innerHTML = `<div class="sb-admin-empty">${esc(error.message)}</div>`; return; }
    _adminListings = data || [];
    _adminRenderListingRows(_adminListings);
  }

  function _adminRenderListingRows(listings) {
    const rowsEl = document.getElementById('sb-admin-listing-rows');
    if (!rowsEl) return;
    if (!listings.length) { rowsEl.innerHTML = '<div class="sb-admin-empty">No listings found.</div>'; return; }
    rowsEl.innerHTML = listings.map(l => {
      const items = Array.isArray(l.items) ? l.items.map(i => `${i.qty > 1 ? i.qty + 'x ' : ''}${i.item}`).join(', ') : (l.item || '—');
      const lf    = Array.isArray(l.lf_items) ? l.lf_items.map(i => `${i.qty > 1 ? i.qty + 'x ' : ''}${i.item}`).join(', ') : (l.lf || '—');
      const age   = l.created_at ? new Date(l.created_at).toLocaleDateString() : '';
      return `<div class="sb-admin-listing-row" data-lid="${esc(l.id)}">
        <div class="sb-admin-listing-info">
          <span class="sb-admin-listing-user">${esc(l.username)}</span>
          <span class="sb-admin-listing-type ${l.type === 'buying' ? 'sb-listing-buying' : 'sb-listing-selling'}">${esc(l.type)}</span>
          <span class="sb-admin-listing-items">${esc(items)}</span>
          ${lf !== '—' ? `<span class="sb-admin-listing-lf">LF: ${esc(lf)}</span>` : ''}
          <span class="sb-admin-listing-age">${age}</span>
        </div>
        <button class="sb-admin-del-listing-btn" onclick="window._adminDeleteListing('${esc(l.id)}')">🗑</button>
      </div>`;
    }).join('');
  }

  function adminFilterListings(query) {
    const q = (query || '').toLowerCase().trim();
    const filtered = q ? _adminListings.filter(l => l.username?.toLowerCase().includes(q)) : _adminListings;
    _adminRenderListingRows(filtered);
  }

  async function adminDeleteListing(listingId) {
    if (!isAdmin()) return;
    const row = document.querySelector(`.sb-admin-listing-row[data-lid="${listingId}"]`);
    const { error } = await sb.from('trade_listings').delete().eq('id', listingId);
    if (error) { adminSetStatus(error.message); return; }
    _adminListings = _adminListings.filter(l => l.id !== listingId);
    row?.remove();
    const rowsEl = document.getElementById('sb-admin-listing-rows');
    if (rowsEl && !rowsEl.querySelector('.sb-admin-listing-row'))
      rowsEl.innerHTML = '<div class="sb-admin-empty">No listings found.</div>';
    adminSetStatus('Listing removed.', true);
  }

  async function adminClearScores() {
    if (!isAdmin() || !_adminCurrentUser) return;
    adminSetStatus('Clearing scores…');
    const { error } = await sb.rpc('admin_clear_all_scores', { p_user_id: _adminCurrentUser.id });
    if (error) { adminSetStatus(error.message); return; }
    await sb.from('personal_bests').delete().eq('user_id', _adminCurrentUser.id);
    adminSetStatus(`Scores cleared for ${_adminCurrentUser.username}.`, true);
  }

  const _ALL_QTE_TYPES = ['dagger','spear','sword','fist','staff','axe','hammer','dodge','thorian','thorian-new','dagger-comp','spear-comp','sword-comp','fist-comp','staff-comp','axe-comp','hammer-comp','dodge-comp','thorian-comp','thorian-new-comp'];

  function adminClearOneScore() {
    if (!isAdmin() || !_adminCurrentUser) return;
    // Remove any existing picker
    document.getElementById('sb-admin-score-picker')?.remove();
    const wrap = document.querySelector('.sb-admin-actions');
    if (!wrap) return;
    const picker = document.createElement('div');
    picker.id = 'sb-admin-score-picker';
    picker.style.cssText = 'margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
    picker.innerHTML = `
      <select id="sb-admin-score-qte" class="sb-input" style="flex:1;min-width:140px;font-size:12px">
        ${_ALL_QTE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
      </select>
      <button class="sb-admin-action-btn sb-admin-btn-scores-one" style="margin:0" onclick="window._adminDoDeleteOneScore()">Delete</button>
      <button class="sb-admin-action-btn" style="margin:0;background:#333" onclick="document.getElementById('sb-admin-score-picker')?.remove()">✕</button>`;
    wrap.appendChild(picker);
  }

  async function adminDoDeleteOneScore() {
    if (!isAdmin() || !_adminCurrentUser) return;
    const qteType = document.getElementById('sb-admin-score-qte')?.value;
    if (!qteType) return;
    adminSetStatus(`Clearing ${qteType} score for ${_adminCurrentUser.username}…`);
    const uid = _adminCurrentUser.id;
    const uname = _adminCurrentUser.username;
    const { error } = await sb.rpc('admin_clear_user_score', { p_user_id: uid, p_qte_type: qteType });
    document.getElementById('sb-admin-score-picker')?.remove();
    if (error) { adminSetStatus(error.message); return; }
    await sb.from('personal_bests').delete().eq('user_id', uid).eq('qte_type', qteType);
    adminSetStatus(`${qteType} score cleared for ${uname}.`, true);
  }

  async function adminDeleteListings() {
    if (!isAdmin() || !_adminCurrentUser) return;
    adminSetStatus('Deleting listings…');
    const { error } = await sb.rpc('admin_delete_listings', { p_username: _adminCurrentUser.username });
    if (error) { adminSetStatus(error.message); return; }
    adminSetStatus(`Trade listings deleted for ${_adminCurrentUser.username}.`, true);
  }

  async function adminBanAndWipe() {
    if (!isAdmin() || !_adminCurrentUser) return;
    adminSetStatus('Wiping user…');
    await Promise.all([
      sb.from('banned_usernames').upsert({ username: _adminCurrentUser.username }, { onConflict: 'username' }),
      sb.rpc('admin_clear_all_scores', { p_user_id: _adminCurrentUser.id }),
      sb.rpc('admin_delete_listings',  { p_username: _adminCurrentUser.username }),
      sb.from('personal_bests').delete().eq('user_id', _adminCurrentUser.id),
    ]);
    _bannedSet?.add(_adminCurrentUser.username);
    const banBtn = document.querySelector('.sb-admin-btn-ban');
    if (banBtn) { banBtn.textContent = '✅ Unban'; banBtn.dataset.banned = '1'; }
    adminSetStatus(`${_adminCurrentUser.username} banned + all data wiped.`, true);
    _refreshBannedTab(_adminCurrentUser.username, 'add');
  }

  function _refreshBannedTab(username, action) {
    const rowsEl = document.getElementById('sb-admin-ban-rows');
    if (!rowsEl) return;
    if (action === 'add' && !PERMA_BANNED.has(username) && !rowsEl.querySelector(`[data-ban="${username}"]`)) {
      rowsEl.querySelector('.sb-admin-empty')?.remove();
      const div = document.createElement('div');
      div.className = 'sb-admin-ban-row';
      div.dataset.ban = username;
      div.innerHTML = `<span>${esc(username)}</span><div style="display:flex;gap:6px"><button class="sb-admin-unban-btn" onclick="window._unbanUser('${esc(username)}')">Unban</button><button class="sb-admin-perma-btn" onclick="window._adminPermaBanUser('${esc(username)}',null)">🔒 Perma Ban</button></div>`;
      rowsEl.appendChild(div);
    } else if (action === 'remove') {
      rowsEl.querySelector(`[data-ban="${username}"]`)?.remove();
      if (!rowsEl.children.length) rowsEl.innerHTML = '<div class="sb-admin-empty">No banned users.</div>';
    }
  }

  async function unbanUser(username) {
    if (!isAdmin()) return;
    if (PERMA_BANNED.has(username)) return;
    await sb.from('banned_usernames').delete().eq('username', username);
    _bannedSet?.delete(username);
    _refreshBannedTab(username, 'remove');
    adminSetStatus(`${username} unbanned.`, true);
  }

  async function adminPurgeExpired(btn) {
    if (!isAdmin()) return;
    if (!confirm('Purge all expired trades (>2 days) and parties (open >5 h, full >2 days)?')) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Purging…'; }
    adminSetStatus('Purging expired records…');

    const { error } = await sb.rpc('purge_expired_listings');
    if (error) {
      adminSetStatus('Error: ' + error.message);
    } else {
      adminSetStatus('Expired records purged.', true);
    }
    if (btn) { btn.disabled = false; btn.textContent = '🗑 Purge Expired Trades & Parties'; }
  }

  async function banAllProfanityUsers() {
    if (!isAdmin()) return;
    const btn = document.getElementById('sb-ban-profanity-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
    const { data: profiles } = await sb.from('profiles').select('username');
    const dirty = (profiles || []).filter(p => p.username && containsProfanity(p.username)).map(p => p.username);
    if (!dirty.length) {
      adminSetStatus('No profanity usernames found.', true);
      if (btn) { btn.disabled = false; btn.textContent = '🔍 Scan & Ban All Profanity Usernames'; }
      return;
    }
    const { error } = await sb.from('banned_usernames').upsert(dirty.map(u => ({ username: u })), { onConflict: 'username' });
    if (error) { adminSetStatus(error.message); if (btn) { btn.disabled = false; btn.textContent = '🔍 Scan & Ban All Profanity Usernames'; } return; }
    dirty.forEach(u => _bannedSet?.add(u));
    dirty.forEach(u => _refreshBannedTab(u, 'add'));
    adminSetStatus(`Banned ${dirty.length} user(s): ${dirty.join(', ')}`, true);
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Scan & Ban All Profanity Usernames'; }
  }

  window._sbSignOut          = () => signOut();
  window._openAuthModal      = openAuthModal;
  window._openLeaderboard    = openLeaderboard;
  window._closeModal         = closeModal;
  window._submitAuth         = submitAuth;
  window._sbSubmitScore      = submitScore;
  window._sbStartQteSession  = startQteSession;
  window._sbGetUsername      = () => currentProfile?.username || null;
  window._sbGetUserId        = () => currentUser?.id ?? null;
  window._sbGetAvatar        = () => currentProfile?.avatar_url || null;
  window._sbAvatar           = renderAvatar; // reuse leaderboard avatar renderer (sb.js renderAvatar)
  window._toggleProfileMenu  = toggleProfileMenu;
  window._closeProfileMenu   = closeProfileMenu;
  window._toggleTrackerSubmenu = toggleTrackerSubmenu;
  window._openSettings       = openSettings;
  window._saveUsername       = saveUsername;
  window._changePassword     = changePassword;
  window._togglePasswordFields = function () {
    const fields = document.getElementById('sb-pw-fields');
    const btn    = document.getElementById('sb-toggle-pw-btn');
    if (!fields) return;
    const open = fields.style.display === 'none';
    fields.style.display = open ? 'block' : 'none';
    if (btn) btn.textContent = open ? 'Cancel Password Change' : 'Change Password';
  };
  window._uploadAvatar       = uploadAvatar;
  window._deleteAccount        = deleteAccount;
  window._confirmDeleteAccount = confirmDeleteAccount;
  window._showConsentFromSettings = () => window._showChatConsentModal?.(() => openSettings());
  window._loadAllLeaderboards  = loadAllLeaderboards;
  window._openAdminPanel         = openAdminPanel;
  window._adminSwitchTab         = adminSwitchTab;
  window._adminLoadListings      = adminLoadListings;
  window._adminFilterListings    = adminFilterListings;
  window._adminDeleteListing     = adminDeleteListing;
  window._adminLookup            = adminLookup;
  window._adminSelectUser        = adminSelectUser;
  window._adminBanUser           = adminBanUser;
  window._adminPermaBanUser      = adminPermaBanUser;
  window._adminClearScores       = adminClearScores;
  window._adminClearOneScore     = adminClearOneScore;
  window._adminDoDeleteOneScore  = adminDoDeleteOneScore;
  window._adminDeleteListings    = adminDeleteListings;
  window._adminBanAndWipe        = adminBanAndWipe;
  window._unbanUser              = unbanUser;
  window._banAllProfanityUsers   = banAllProfanityUsers;
  window._adminPurgeExpired      = adminPurgeExpired;
  window._sbIsAdmin              = isAdmin;
  window._sbAdminIds             = [...ADMIN_IDS];
  // Ping every admin via the existing notification bell (used by the report system).
  window._sbNotifyAdmins         = async function (title, body, meta) {
    try {
      const meId = currentUser?.id || null;
      const rows = [...ADMIN_IDS].filter(id => id !== meId).map(id => ({
        user_id: id, title, body: body || null, meta: meta || null
      }));
      if (rows.length) await sb.from('notifications').insert(rows);
    } catch (_) {}
  };
  window._sbProfanityList        = PROFANITY_LIST; // live reference — mutations are reflected immediately

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
