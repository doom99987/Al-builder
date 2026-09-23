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
  // Who is an admin is the SERVER's answer: public.is_site_admin(), over the
  // table public.site_admins (supabase/admin-server.sql), which no browser can
  // read. This file names no admin. It asks at sign-in, and again before the
  // admin panel opens.
  //
  // The flag only decides which buttons to draw. A player who flips it in dev
  // tools gets a panel of buttons that all fail: every admin action is an
  // admin_* function that checks is_site_admin() in the database, and the
  // admin-only tables (reports, score_reviews, testers, qte_run_rejects) answer
  // anyone else with nothing.
  let _isAdmin = false;
  function isAdmin() { return !!currentUser && _isAdmin; }
  async function loadAdminFlag() {
    const uid = currentUser?.id;
    if (!uid) { _isAdmin = false; return false; }
    let ok = false;
    try {
      const { data, error } = await sb.rpc('is_site_admin');
      ok = !error && data === true;
    } catch (e) { ok = false; }
    // The account can change while this is in flight; a late answer must not
    // make the next account an admin.
    if (currentUser && currentUser.id === uid) _isAdmin = ok;
    return isAdmin();
  }

  // ---- tester ----
  // A tester gets exactly ONE thing an ordinary account does not — the AI panel.
  // No admin panel, no reports, no moderation, no elevated read or write
  // anywhere. Every other feature keeps asking isAdmin(), so listing someone
  // here cannot widen anything but the AI.
  //
  // Granted from the admin panel and stored in the `testers` table, not in a
  // list here: a list in this file can only be changed by editing and
  // redeploying the site. See supabase/testers.sql — RLS is what makes the
  // toggle safe, since only an admin can insert or delete a row.
  //
  // This flag is a CONVENIENCE, not the boundary. It decides whether to draw a
  // menu item; the database decides who may grant the role.
  let _isTester = false;
  function isTester() { return !!currentUser && _isTester; }

  // One indexed lookup per sign-in. RLS lets a user read only their own row, so
  // this cannot be used to probe anyone else's status.
  async function loadTesterFlag() {
    const uid = currentUser?.id;
    if (!uid) { _isTester = false; return; }
    const { data, error } = await sb.from('testers')
      .select('user_id').eq('user_id', uid).maybeSingle();
    // A missing table means supabase/testers.sql has not been run yet. Degrade
    // to "nobody is a tester" rather than throwing: admins keep the AI either
    // way, so the site stays usable while the migration is pending.
    if (error) {
      // Quiet for ordinary users — they are not testers either way and a console
      // error helps nobody. Loud enough that an admin debugging this can see it.
      _isTester = false;
      if (isAdmin()) console.warn('[testers] own-status lookup failed:', error);
      return;
    }
    // The account can change while this is in flight — sign out, or a fast
    // switch — and a late reply must not grant the new one anything.
    if (currentUser && currentUser.id === uid) _isTester = !!data;
  }

  // The single question the AI panel asks. Admins keep access without needing to
  // appear in both lists.
  function canUseAI() { return isAdmin() || isTester(); }

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

  // Banned in a username only as the whole name or a whole piece of it, never
  // inside a word: two letters turn up everywhere ("CPU", "EpicPlayer"). The
  // chat filter blocks the same word on word boundaries (trades.js _BLOCK_LIST).
  const PROFANITY_TOKENS = ['cp'];

  // ---- unicode folding ----
  // Text that reads as a banned word without being one, to a filter: fullwidth
  // and styled letters (ｎ, 𝐧), accents and stacked marks (ñ, n̶), invisible
  // characters between letters (zero-width, bidi controls, soft hyphen), and
  // look-alike letters from other scripts (Cyrillic а е о р с, Greek ο ρ ...).
  // foldChar maps ONE character to one plain character where it can and keeps
  // case; foldText also drops the invisibles. Usernames are ASCII-only on the
  // server (lockdown2.sql), so this matters most for chat (trades.js).
  const CONFUSABLES = {
    'а':'a','в':'b','е':'e','ё':'e','з':'3','к':'k','м':'m','н':'h','о':'o','п':'n','р':'p','с':'c','т':'t',
    'у':'y','х':'x','ь':'b','і':'i','ї':'i','ј':'j','ѕ':'s','ԁ':'d','ԛ':'q','ԝ':'w','һ':'h','ɡ':'g','ɑ':'a',
    'α':'a','β':'b','γ':'y','ε':'e','η':'n','ι':'i','κ':'k','μ':'u','ν':'v','ο':'o','ρ':'p','τ':'t','υ':'u',
    'χ':'x','ω':'w','ı':'i','ł':'l','ø':'o','đ':'d','ħ':'h','ŋ':'n',
  };
  function foldChar(c) {
    const lower = c.toLowerCase();
    let base = lower.normalize('NFKD').replace(/\p{M}/gu, '');
    if (base.length === 1) base = CONFUSABLES[base] || base;
    else if (!base) base = /\p{M}/u.test(lower) ? '' : lower;   // a lone stacked mark folds to nothing
    return c === lower ? base : base.toUpperCase();
  }
  function foldText(s) {
    return Array.from(String(s || '').replace(/\p{Cf}/gu, '')).map(foldChar).join('');
  }

  // The whole name, and its pieces: split on _ - and other separators, on
  // camelCase (iLoveCP -> i Love CP), on a capital run before a word
  // (XXLover -> XX Lover), and between letters and digits (cp123 -> cp 123;
  // a digit run such as 1488 is a piece of its own).
  function nameTokens(name) {
    const s = foldText(name);
    const tokens = new Set([s.toLowerCase()]);
    (s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').match(/[A-Za-z]+|[0-9]+/g) || [])
      .forEach(t => tokens.add(t.toLowerCase()));
    return tokens;
  }

  // Matched anywhere in a name, even inside a longer word: strings that are
  // never innocent. Every other word on the list counts only as the whole
  // name or a whole piece of it, so Assassin, Cassandra, Analyst, Peacock and
  // Scunthorpe are all fine while ass_kicker and PeaCock are not.
  const PROFANITY_ANYWHERE = [
    'nigg', 'fuck', 'faggot', 'retard', 'pedophile', 'paedophile', 'jailbait', 'tranny', 'shemale',
    'jigaboo', 'pickaninny', 'wetback', 'towelhead', 'raghead', 'zipperhead', 'childporn', 'csam',
    'cumshot', 'blowjob', 'handjob', 'rimjob', 'masturbat', 'whore', 'bitch', 'porn', 'hentai', 'dildo', '1488',
    'shit', 'slut', 'jizz', 'twat', 'kike', 'chink', 'gook', 'cumdump', 'dickhead', 'dicksuck', 'dickrid',
    'cocksuck', 'cockrid', 'pussyslay', 'childrap', 'kidrap', 'assmunch', 'analsex', 'bigdick', 'pissboy',
  ];
  // Stems too short to match anywhere without catching a real word, with the
  // one letter that makes them innocent ruled out: Scunthorpe, swanky.
  const PROFANITY_ANYWHERE_RX = [/(?<!s)cunt/, /(?<!s)wank/];
  // Left whole-token-only on purpose, because they sit inside common words:
  // dick (Dickens), cock (Peacock), ass (Assassin), anal (Analyst), rape
  // (Grape), cum (Cucumber), piss, tit (Titan).

  // The word that makes a name unusable, or null. One rule for signup and
  // rename (containsProfanity) and for the admin's ban sweep (usernameProfanity).
  function profanityHit(name) {
    const tokens = nameTokens(name);
    const folded = foldText(name).toLowerCase();
    const rx = PROFANITY_ANYWHERE_RX.find(r => r.test(folded));
    return PROFANITY_LIST.find(w => tokens.has(w))
        || PROFANITY_TOKENS.find(w => tokens.has(w))
        || PROFANITY_ANYWHERE.find(w => folded.includes(w))
        || (rx ? rx.source.replace(/^\(\?<!s\)/, '') : null)
        || null;
  }

  function containsProfanity(str) {
    return !!profanityHit(str);
  }

  // The admin's ban sweep uses the same rule as signup and rename (owner,
  // 2026-09-22: ban the word, not a word that contains it). "Assassin" holds
  // "ass" and is a class, "Cassie" and "Titan" are names; "ass_kicker",
  // "ChildAbuser" and "bigdick" are not. Returns the word that matched, or null.
  function usernameProfanity(name) {
    return profanityHit(name);
  }

  // ---- ban helpers ----
  let _bannedSet        = null;       // Set of banned usernames (normal ban — username based)
  let _bannedIdSet      = new Set();  // ...and the accounts those rows name (lockdown.sql fills user_id)
  let _permaBannedIdSet = new Set();  // Set of perma-banned UUIDs (uuid based)

  // A banned name is reserved, exactly and in any case - not fed into
  // PROFANITY_LIST, which is shared with the chat filter: banning "bob" used
  // to censor "bob" in every chat message.
  //
  // A ban row that records its account (user_id) bans THAT account, by id: its
  // name only reserves the name. Matching such a row by name would land the ban
  // on whoever holds the name later. Only an old row with no id is a ban by name.
  let _bannedNameIds = new Map();   // lower(name) -> user_id or null
  async function loadBannedCache() {
    const bansRes = await sb.from('banned_usernames').select('username, user_id');
    _bannedSet = new Set((bansRes.data || []).map(r => r.username));
    _bannedNameIds = new Map((bansRes.data || []).map(r => [String(r.username).toLowerCase(), r.user_id || null]));
    (bansRes.data || []).forEach(r => { if (r.user_id) _bannedIdSet.add(r.user_id); });
    try {
      const { data: permaData } = await sb.from('perma_banned_usernames').select('username, user_id');
      (permaData || []).forEach(r => {
        PERMA_BANNED.add(r.username);
        if (r.user_id) _permaBannedIdSet.add(r.user_id);
      });
    } catch (_) {}
  }

  // Signup and rename refuse any banned name, perma or plain, in any case
  // (the server's profiles_username_guard says the same).
  function isPermaBannedName(name) {
    const lower = String(name || '').toLowerCase();
    for (const n of PERMA_BANNED) if (n.toLowerCase() === lower) return true;
    return _bannedNameIds.has(lower);
  }

  function isBannedCached(username) {
    return _bannedSet ? _bannedSet.has(username) : false;
  }

  // Bans are applied by admin_ban_user / admin_perma_ban_user / admin_unban_user
  // (supabase/lockdown.sql), which refuse anyone but a site admin on the server
  // and also lock the account in Supabase Auth. The status they return says how
  // far the ban got; anything but a plain 'ok' is worth showing the admin.
  function banNote(status) {
    if (status === 'ok_no_auth_lock') return ' Auth did not lock the account (the site’s login check still applies). Ban it by hand: Supabase › Authentication › Users › Ban user; the Postgres log has the reason.';
    if (status === 'ok_no_account')   return ' No Auth account to lock (a reserved name, or an account since deleted).';
    return '';
  }

  // By account first (perma bans, and plain bans since they record user_id),
  // then by name for an old row that has none.
  async function checkIfBanned(userId, username) {
    if (userId && (_permaBannedIdSet.has(userId) || _bannedIdSet.has(userId))) return true;
    const lower = String(username || '').toLowerCase();
    if (_bannedSet) return _bannedNameIds.has(lower) && _bannedNameIds.get(lower) === null;
    const { data } = await sb.from('banned_usernames').select('username, user_id').ilike('username', lower.replace(/[\\%_]/g, m => '\\' + m));
    return (data || []).some(r => !r.user_id);
  }

  // Load ban cache immediately so leaderboard filtering is ready
  const _bannedReady = loadBannedCache().catch(() => {});

  // A session restored from storage (a reload, a second tab) never passes the
  // login form, which is where the ban check lived. The Auth lock
  // (lockdown.sql) stops a banned account refreshing its token, but a token
  // already issued lives up to an hour, and an old name-only ban has no lock at
  // all. So a restored session is checked too, under both names it can carry.
  async function enforceBanOnRestore(user, profileName) {
    await _bannedReady;
    if (!user || !currentUser || currentUser.id !== user.id) return;
    // The profile name is the account's name; the signup name in the metadata
    // is only a fallback when the profile could not be read (a rename never
    // updates it, so it can be a name someone else now holds).
    const banned = await checkIfBanned(user.id, profileName || user.user_metadata?.username || '');
    if (!banned || !currentUser || currentUser.id !== user.id) return;
    await sb.auth.signOut();
    currentUser = null; currentProfile = null;
    resetScoreState();
    renderAuthBar();
    alert('Your account has been banned.');
  }

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
    // supabase-js refreshes the access token roughly hourly and fires this with
    // the same user. Running the full login path for it made every open tab
    // re-fetch its profile and tester flag and — via the alb-auth-changed
    // dispatch below — re-download the whole bank and saved-builds jsonb blobs,
    // once an hour, to arrive at exactly the state it already had. Take the new
    // handle and stop. Anything that genuinely changed the user still falls
    // through, because the id comparison fails.
    if (_event === 'TOKEN_REFRESHED' && currentUser && session?.user?.id === currentUser.id) {
      currentUser = session.user;
      return;
    }
    currentUser = session?.user ?? null;
    if (currentUser) {
      const username = currentUser.user_metadata?.username
        || currentUser.email.split('@')[0].replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 20);
      currentProfile = { username };
      _isTester = false;          // never carry the last account's role over
      _isAdmin  = false;
      loadTesterFlag();
      // The server's answer arrives after the bar is drawn: redraw it for an
      // admin, and tell the modules that draw admin-only controls.
      loadAdminFlag().then(admin => {
        if (!admin) return;
        renderAuthBar();
        window.dispatchEvent(new Event('alb-admin-changed'));
      });
      renderAuthBar();
      reconcileServerScores();
      // Load full profile from DB to get avatar_url and saved username
      const restoredUser = currentUser;
      getProfile(currentUser.id).then(profile => {
        if (profile && currentUser) {
          currentProfile = profile;
          renderAuthBar();
        }
        enforceBanOnRestore(restoredUser, profile?.username);
      });
    } else {
      currentProfile = null;
      _isTester = false;
      _isAdmin  = false;
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

  // Names are unique regardless of case on the server (supabase/lockdown2.sql):
  // "Fool" is taken if "fool" is. ilike is the API's case-insensitive match and
  // _ is its one-character wildcard, so escape it (and \ and %).
  async function usernameTaken(name, exceptId) {
    let q = sb.from('profiles').select('id').ilike('username', String(name).replace(/[\\%_]/g, m => '\\' + m)).limit(1);
    if (exceptId) q = q.neq('id', exceptId);
    const { data } = await q;
    return !!(data && data.length);
  }

  // ---- sign up ----
  async function signUp(email, password, username) {
    validateEmail(email);
    if (!username) throw new Error('Username is required.');
    if (username.length < 3)  throw new Error('Username must be at least 3 characters.');
    if (username.length > 20) throw new Error('Username must be 20 characters or fewer.');
    if (!/^[a-zA-Z0-9_\-]+$/.test(username)) throw new Error('Username: letters, numbers, _ and - only.');
    if (containsProfanity(username) || isPermaBannedName(username)) throw new Error('That username is not allowed.');
    // The server's minimum is set in Supabase Auth settings; keep this equal.
    if (String(password || '').length < 8) throw new Error('Password must be at least 8 characters.');

    // Check uniqueness before creating auth account
    if (await usernameTaken(username)) throw new Error('Username already taken.');

    _authLock = true;
    try {
      // Pass username in metadata so the DB trigger creates the profile
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { username } }
      });
      // The profile row is made by a trigger at signup; when the database
      // refuses the name (taken in another case, or the shape rule) GoTrue can
      // only say "Database error saving new user".
      if (error) throw new Error(/database error saving new user/i.test(error.message || '')
        ? 'That username cannot be used (it may be taken). Try another.' : error.message);
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
      // A ban is enforced by Supabase Auth itself (banned_until, set by
      // admin_ban_user in supabase/lockdown.sql): GoTrue answers "User is
      // banned" and issues no session. The table check below stays for a ban
      // recorded by name only, or one Auth could not be told about.
      if (error) throw new Error(/banned/i.test(error.message || '') ? 'Your account has been banned.' : error.message);
      currentUser    = data.user;
      const username = data.user.user_metadata?.username
        || data.user.email.split('@')[0].replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 20);
      // Check ban before allowing login: by account first, then by the
      // account's CURRENT name (the profile's; the signup name only when the
      // profile cannot be read - a rename never updates it).
      const profile = await getProfile(currentUser.id);
      await _bannedReady;
      const banned = await checkIfBanned(data.user.id, profile?.username || username);
      if (banned) {
        await sb.auth.signOut();
        currentUser = null;
        throw new Error('Your account has been banned.');
      }
      currentProfile = profile || { username };
      renderAuthBar();
      clearLocalScores();
    } finally {
      _authLock = false;
    }
  }

  // ---- clear local QTE scores (called on login/register) ----
  function clearLocalScores() {
    Object.keys(localStorage).filter(k => /^alb:[a-z]+-hs$/.test(k))
      .forEach(k => localStorage.removeItem(k));
    resetScoreState();
    window.dispatchEvent(new Event('alb-scores-reset'));
  }

  // ---- sign out ----
  async function signOut() {
    await sb.auth.signOut();
    currentUser = null; currentProfile = null;
    resetScoreState();
    renderAuthBar();
  }

  // ---- anti-cheat: session IDs keyed by qte_type ----
  const _sessionIds = {};
  const _arming     = {};   // qteType -> the start_qte_session call in flight

  // Called by each QTE trainer when the player clicks Start.
  // Fires a server-side timestamp so submit_score can validate elapsed time.
  //
  // Returns the promise, and remembers it while it is in flight, so a score
  // from the first seconds of the run can WAIT for the session instead of being
  // thrown away: the trainers do not await this (js/qte.js:556 and siblings),
  // the run starts immediately, and the first hit can beat the round trip.
  function startQteSession(qteType) {
    if (!currentUser) return Promise.resolve(null);
    if (_arming[qteType]) return _arming[qteType];
    // Drop the previous run's id straight away. The server times a score from
    // its session's start, so letting a new run's first hits be validated
    // against the last run's session would date them from before this run.
    delete _sessionIds[qteType];
    const p = (async () => {
      const { data, error } = await sb.rpc('start_qte_session', {
        p_user_id:  currentUser.id,
        p_qte_type: qteType,
      });
      if (error) { console.warn('[sb] startQteSession error', error.message); return null; }
      _sessionIds[qteType] = data;
      return data;
    })();
    _arming[qteType] = p;
    const done = () => {
      delete _arming[qteType];
      // A score from an earlier run may still be waiting for a session.
      if (_pending[qteType]) pumpScore(qteType);
    };
    p.then(done, done);
    return p;
  }

  // ---- verified runs (supabase/qte-verified.sql) ----
  // Each Start asks the server for a run: { run, ticket }. The server keeps
  // the run's secret seed; the ticket is signed with it and goes back with
  // every score of that run, together with the run's log (js/qte-rules.js).
  // Called by QteRules.Run.start; the run does not wait for it.
  //
  // Resolves to { run, ticket }, or { legacy: sessionId } while
  // qte-verified.sql has not been run yet (the old path still works), or null
  // (signed out, offline, too many starts) - a run with no ticket cannot be
  // verified, so its scores are not saved.
  const TICKET_TIMEOUT_MS = 10000;
  function startQteRun(qteType) {
    if (!currentUser) return Promise.resolve(null);
    const ask = (async () => {
      const { data, error } = await sb.rpc('start_qte_run', { p_qte_type: qteType });
      if (error) {
        if (isMissingFunction(error)) {
          const id = await startQteSession(qteType);
          return id ? { legacy: id } : null;
        }
        console.warn('[sb] start_qte_run error', error.message);
        return null;
      }
      if (!data || typeof data.run !== 'string' || typeof data.ticket !== 'string') return null;
      return { run: data.run, ticket: data.ticket };
    })().catch(e => { console.warn('[sb] start_qte_run threw', e && e.message); return null; });
    // A hung request must not hold a score (and the queue behind it) forever.
    const timeout = new Promise(res => setTimeout(() => res(null), TICKET_TIMEOUT_MS));
    return Promise.race([ask, timeout]);
  }
  // PostgREST's "no such function" (the SQL has not been run yet).
  function isMissingFunction(error) {
    return !!error && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message || ''));
  }

  // ---- submit score — server validates session timing before accepting ----
  // The trainers call this on EVERY new high of a run (streak 1, 2, 3 … 31),
  // so this is where a run's scores are kept honest:
  //   · one send at a time per QTE type, always carrying the highest score;
  //   · a score counts as sent only once the server has ACCEPTED it;
  //   · a send that fails, or that finds no session, is retried, never dropped.
  // Before this, every new high fired its own unordered RPC, a score was marked
  // as sent before the server had seen it, and any score that arrived while a
  // session was being armed or re-armed was discarded with a console warning —
  // a competitive run that reached 31 could leave the board holding 2.
  //
  // Each call carries the run's packet (ticket + log) from QteRules.Run; the
  // Storage.setItem hook in js/core.js that used to submit casual scores a
  // second time, with no log, is gone.
  const _pending   = {};   // qteType -> highest score still to send
  const _packet    = {};   // qteType -> that score's run packet { ticket, attempt, log } (QteRules.Run)
  const _confirmed = {};   // qteType -> highest score the server has accepted
  const _posted    = {};   // qteType -> what the server actually posted for the last accepted send
  const _sending   = {};   // qteType -> true while an RPC is in flight
  const _retryN    = {};   // qteType -> retries spent on the pending score
  const _retryT    = {};   // qteType -> retry timer
  const SCORE_RETRY_MS = [1500, 4000, 10000];

  // packet: from QteRules.Run (js/qte-rules.js) - the run's ticket promise,
  // attempt number and log. The score and the log travel together: a higher
  // score replaces both.
  function submitScore(qteType, score, packet) {
    if (!currentUser || !score) return Promise.resolve(false);
    if (score <= (_confirmed[qteType] || 0)) return Promise.resolve(true);
    if (score <= (_pending[qteType] || 0))   return Promise.resolve(false);
    _pending[qteType] = score;
    _packet[qteType]  = packet || null;
    _retryN[qteType]  = 0;
    if (_retryT[qteType]) { clearTimeout(_retryT[qteType]); _retryT[qteType] = null; }
    return pumpScore(qteType);
  }

  // Sends the pending score, then whatever higher score arrived while it was in
  // flight. Resolves true once the server holds the highest value offered.
  async function pumpScore(qteType) {
    if (_sending[qteType]) return false;   // the send in flight will pick up the newest value
    const score = _pending[qteType];
    if (!score) return false;
    const packet = _packet[qteType] || null;
    _sending[qteType] = true;
    delete _posted[qteType];
    let outcome = 'retry';
    try { outcome = await sendScore(qteType, score, packet); }
    catch (e) { console.error('[sb] submitScore threw', qteType, score, e && e.message); }
    finally { _sending[qteType] = false; }
    // 'refused' is the server saying it will never take this score. Retrying
    // only spends requests, so drop it — but do NOT record it as confirmed.
    if (outcome === 'refused') {
      if ((_pending[qteType] || 0) <= score) { delete _pending[qteType]; delete _packet[qteType]; return false; }
      return pumpScore(qteType);   // a higher score (a longer log) arrived meanwhile
    }
    if (outcome !== 'accepted') { scheduleScoreRetry(qteType); return false; }
    // A verified run can post less than was claimed (the log proves fewer
    // points); remember what was posted, so a later run can still beat it.
    _confirmed[qteType] = Math.max(_confirmed[qteType] || 0, _posted[qteType] ?? score);
    _retryN[qteType] = 0;
    if ((_pending[qteType] || 0) <= score) { delete _pending[qteType]; delete _packet[qteType]; return true; }
    return pumpScore(qteType);
  }

  // What a rejection means for the score in hand. A stale or missing session is
  // worth another go with a fresh one; a verdict about the score itself (too
  // fast for the game, above the trainer's cap) will never change.
  const _heldToldAt = {};   // qteType -> when the player was last told a score is held
  const SCORE_REFUSALS = {
    too_fast:  'Score not saved: it came in faster than this trainer allows.',
    capped:    'Score not saved: above the maximum this trainer accepts.',
    bad_input: 'Score not saved: the server did not recognise this trainer.',
    banned:    'Score not saved: this account is banned.',
    rejected:  'Score not saved: the run could not be verified.',
  };
  const _lowerToldAt = {};   // qteType -> when the player was last told a score posted lower

  // 'accepted' | 'retry' | 'refused'
  async function sendScore(qteType, score, packet) {
    if (packet && packet.ticket) return sendVerified(qteType, score, packet);
    return sendLegacy(qteType, score, null);
  }

  // A run from QteRules.Run: its ticket and log go to the qte-submit edge
  // function, which checks the log and posts through qte_accept_run.
  async function sendVerified(qteType, score, packet) {
    let t = null;
    try { t = await packet.ticket; } catch (e) { t = null; }
    if (!t) {
      // No run was made on the server at this Start (signed out then, offline,
      // or too many starts). Nothing can vouch for this run's scores.
      console.warn('[sb] submitScore: no ticket for this run of', qteType, '- not saved', score);
      scoreToast('Score not saved: this run was not started with the server. Check your connection and press Start again.');
      return 'refused';
    }
    // qte-verified.sql not run yet: the old path, with an old-style session.
    if (t.legacy) return sendLegacy(qteType, score, t.legacy);

    const body = { run: t.run, ticket: t.ticket, qte_type: qteType, platform: PLATFORM,
                   attempt: packet.attempt | 0, score, log: packet.log };
    let data = null, error = null;
    try { ({ data, error } = await sb.functions.invoke('qte-submit', { body })); }
    catch (e) { console.error('[sb] qte-submit threw', qteType, score, e && e.message); return 'retry'; }
    if (error) {
      const code = error.context && error.context.status;
      // The function is not deployed yet: to the old path, the run is an
      // ordinary session (same table), so the score is not lost meanwhile.
      if (code === 404) return sendLegacy(qteType, score, t.run);
      console.error('[sb] qte-submit error', qteType, score, code, error.message);
      return 'retry';
    }
    const status = data && typeof data.status === 'string' ? data.status : 'retry';
    if (status === 'ok') {
      const posted = Number.isInteger(data.score) ? data.score : score;
      _posted[qteType] = posted;
      if (posted < score) {
        console.warn('[sb] submitScore posted lower', qteType, score, '->', posted);
        const now = Date.now();
        if (!_lowerToldAt[qteType] || now - _lowerToldAt[qteType] > 60000) {
          _lowerToldAt[qteType] = now;
          scoreToast('Score saved as ' + posted + ' - the run could only be checked that far.');
        }
      } else console.log('[sb] submitScore ok (verified)', qteType, score, PLATFORM);
      return 'accepted';
    }
    if (status === 'held') {
      console.log('[sb] submitScore held for review', qteType, score);
      const now = Date.now();
      if (!_heldToldAt[qteType] || now - _heldToldAt[qteType] > 60000) {
        _heldToldAt[qteType] = now;
        scoreToast('Score held for review - it goes on the board once an admin approves it.');
      }
      return 'accepted';
    }
    if (status === 'stale') return 'accepted';        // an older attempt of a run that moved on
    if (SCORE_REFUSALS[status]) {
      console.warn('[sb] submitScore refused', qteType, score, status, data && data.reason);
      scoreToast(SCORE_REFUSALS[status]);
      return 'refused';
    }
    return 'retry';
  }

  // The old path: submit_score with a session id. Used before
  // qte-verified.sql / the qte-submit function are live; closed for good by
  // qte-verified-step2.sql.
  async function sendLegacy(qteType, score, fixedSession) {
    let sessionId = fixedSession || (_sessionIds[qteType] ?? null);
    // No session yet: the trainer's Start call may still be in flight, or the
    // last one was rejected. Wait for one rather than losing the score.
    if (!sessionId) {
      await startQteSession(qteType);
      sessionId = _sessionIds[qteType] ?? null;
    }
    if (!sessionId) { console.warn('[sb] submitScore: no session for', qteType, '— keeping', score, 'to retry'); return 'retry'; }
    const { data, error } = await sb.rpc('submit_score', {
      p_user_id:    currentUser.id,
      p_qte_type:   qteType,
      p_score:      score,
      p_platform:   PLATFORM,
      p_month:      currentMonth(),
      p_session_id: sessionId,
    });
    if (error) {
      console.error('[sb] submitScore error', qteType, score, error.message);
      // Keep the session. The server times a score from the moment its session
      // started, so a transport error must not cost us that clock: re-arming
      // here would date a streak of 31 from a few milliseconds ago and the
      // retry would be refused as impossibly fast. Only the server saying the
      // session itself is gone (below) is worth a fresh one.
      return 'retry';
    }
    // The server answers with a status. A deployment that still returns void
    // says nothing at all — and that silence, which made a discarded score look
    // exactly like a stored one, is the whole reason this contract exists.
    const status = typeof data === 'string' ? data : 'ok';
    // A new record, or a big jump to this month's #1, waits for an admin
    // (supabase/qte-scores.sql, score_reviews). The server has the score, so
    // there is nothing to retry; say so once per run, not once per point.
    if (status === 'held') {
      console.log('[sb] submitScore held for review', qteType, score);
      const now = Date.now();
      if (!_heldToldAt[qteType] || now - _heldToldAt[qteType] > 60000) {
        _heldToldAt[qteType] = now;
        scoreToast('Score held for review - it goes on the board once an admin approves it.');
      }
      return 'accepted';
    }
    if (status !== 'ok') {
      console.warn('[sb] submitScore refused', qteType, score, status);
      if (!SCORE_REFUSALS[status]) { delete _sessionIds[qteType]; return 'retry'; }
      scoreToast(SCORE_REFUSALS[status]);
      return 'refused';
    }
    console.log('[sb] submitScore ok', qteType, score, PLATFORM);
    return 'accepted';
  }

  function scheduleScoreRetry(qteType) {
    const n = _retryN[qteType] || 0;
    if (n >= SCORE_RETRY_MS.length) {
      // Out of attempts for now. The score STAYS pending: the next new high,
      // the next run's Start, or the tab being hidden will offer it again.
      console.warn('[sb] submitScore: holding', _pending[qteType], 'for', qteType, '— the server would not take it');
      scoreToast('Score not saved yet — still trying.');
      return;
    }
    _retryN[qteType] = n + 1;
    if (_retryT[qteType]) clearTimeout(_retryT[qteType]);
    _retryT[qteType] = setTimeout(() => { _retryT[qteType] = null; pumpScore(qteType); }, SCORE_RETRY_MS[n]);
  }

  // The personal best is written by submit_score itself, in the same call that
  // accepts the score. This file used to upsert personal_bests after each
  // accepted send, which meant the table took writes from any signed-in user —
  // anyone could file anyone's best straight in. supabase/lockdown.sql made
  // every score table read-only through the API; the client only reads them.

  // Borrowed from the anti-macro guard so a lost score is as visible as a
  // blocked one. Missing until qte-guard.js loads, which is after this file.
  function scoreToast(msg) {
    try { if (window._qteGuard && window._qteGuard.toast) window._qteGuard.toast(msg); } catch (e) {}
  }

  // A run usually ends with the player leaving the page. Give anything still
  // pending one more chance on the way out.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    Object.keys(_pending).forEach(t => pumpScore(t));
  });

  // Sign-out must not leave one account's scores queued against the next one.
  function resetScoreState() {
    Object.keys(_retryT).forEach(t => { if (_retryT[t]) clearTimeout(_retryT[t]); });
    [_pending, _confirmed, _sending, _retryN, _retryT, _sessionIds, _arming]
      .forEach(o => Object.keys(o).forEach(k => { delete o[k]; }));
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
  // QTE trainers only submit when a score beats the LOCAL stored best, so a
  // best that never reached the server gates every later run: the player cannot
  // beat it, nothing is sent, and the board stays frozen below it. This used to
  // wipe the local bests so the player could climb back up — which threw a real
  // score away. Offer them to the server instead, and only fall back to the
  // wipe for the ones it will not take.
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
    const behind = [];
    Object.keys(localStorage).forEach(key => {
      let type = null, m;
      if      ((m = key.match(/^alb:(.+)-hs-comp$/))) type = m[1] + '-comp';
      else if ((m = key.match(/^alb:(.+)-hs-v2$/)))   type = m[1];
      else if ((m = key.match(/^alb:(.+)-hs$/)))      type = m[1];
      if (!type) return;
      const local = parseInt(localStorage.getItem(key), 10) || 0;
      if (local > (serverBest[type] || 0)) behind.push({ type, local });
    });
    if (!behind.length) return;
    console.log('[sb] local bests the server never took — re-submitting:',
                behind.map(b => b.type + ' ' + b.local).join(', '));
    const results = await Promise.all(behind.map(b => submitScore(b.type, b.local)));
    if (results.some(r => !r)) {
      // The server would not take them — a session rule we cannot see from here.
      // Clear the local bests so climbing back up submits normally again.
      console.log('[sb] some local bests were refused — resetting them so scores re-submit as you climb');
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
    // One row per platform, so on the 'all' filter a player who has played on
    // both has TWO rows. maybeSingle() errors on that and returns nothing, which
    // told dual-platform players they had no score at all — take their best row.
    let mineQ = sb.from('leaderboard')
      .select('score, platform')
      .eq('user_id', currentUser.id)
      .eq('qte_type', qteType)
      .eq('score_month', currentMonth());
    if (platform && platform !== 'all') mineQ = mineQ.eq('platform', platform);
    const { data: mine } = await mineQ.order('score', { ascending: false }).limit(1).maybeSingle();
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
  // Also drops bidi embedding/override/isolate controls: one U+202E in a name
  // or message flips the text after it, so "Lycoris" can be drawn from
  // "sirocyL" and the rest of the line reads backwards.
  function esc(s) {
    return String(s).replace(/[\u202A-\u202E\u2066-\u2069]/g, '').replace(/[&<>"']/g, c => _ESC_MAP[c]);
  }
  // An avatar is drawn only from our own bucket. profiles.avatar_url is a
  // string its owner can set to anything through the API, and every viewer's
  // browser fetched it as <img src> - a tracking pixel on someone else's
  // server, fired at the moment an admin opened a report about them. The
  // database refuses other origins for new writes (supabase/lockdown2.sql);
  // this covers rows written before that, and every renderer in the site.
  const AVATAR_URL_PREFIX = SUPABASE_URL + '/storage/v1/object/public/avatars/';
  function safeAvatarUrl(u) {
    return typeof u === 'string' && u.startsWith(AVATAR_URL_PREFIX) ? u : null;
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
    url = safeAvatarUrl(url);
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
      ${canUseAI() ? `<div class="sb-menu-divider"></div><button class="sb-menu-item sb-menu-item-ai" onclick="window._closeProfileMenu();window._openBuildAI?.()">&#10022;&nbsp; AI</button>` : ''}${isAdmin() ? `<button class="sb-menu-item sb-menu-item-admin" onclick="window._openAdminPanel()">&#9760;&nbsp; Admin Panel <span id="sb-menu-report-badge" class="sb-report-badge" style="display:none"></span></button>` : ''}
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
    if (newName.length > 20) { if (errEl) errEl.textContent = 'At most 20 characters.'; return; }
    if (!/^[a-zA-Z0-9_\-]+$/.test(newName)) { if (errEl) errEl.textContent = 'Letters, numbers, _ and - only.'; return; }
    if (containsProfanity(newName) || isPermaBannedName(newName)) { if (errEl) errEl.textContent = 'That username is not allowed.'; return; }
    if (newName === currentProfile?.username) { closeModal(); return; }
    const btn = document.querySelector('.sb-submit');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    if (await usernameTaken(newName, currentUser.id)) {
      if (errEl) errEl.textContent = 'Username already taken.';
      if (btn) { btn.disabled = false; btn.textContent = 'Save Username'; }
      return;
    }
    const { error } = await sb.from('profiles').update({ username: newName }).eq('id', currentUser.id);
    if (error) {
      if (errEl) errEl.textContent = error.code === '23505' ? 'Username already taken.'
        : error.code === '23514' ? 'That username is not allowed.' : error.message;
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
    if (newVal.length < 8) { errEl.textContent = 'New password must be at least 8 characters.'; return; }
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
      <input class="sb-input" id="np-pass2" type="password" placeholder="Confirm new password" autocomplete="new-password" disabled />
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
      const pass2El  = document.getElementById('np-pass2');
      passEl.disabled = false; passEl.focus();
      if (pass2El) pass2El.disabled = false;
      [passEl, pass2El].forEach(el => el && el.addEventListener('keydown', e => { if (e.key === 'Enter') window._submitNewPassword(); }));
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
    if (!pass || pass.length < 8) { errEl.style.color = '#ff8888'; errEl.textContent = 'Password must be at least 8 characters.'; return; }
    if (pass !== (document.getElementById('np-pass2')?.value || '')) { errEl.style.color = '#ff8888'; errEl.textContent = 'Passwords do not match.'; return; }
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
      const pass2El = document.getElementById('np-pass2');
      if (pass2El) pass2El.disabled = true;
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
      ${isReg ? `<input class="sb-input" id="sb-pass2" type="password" placeholder="Confirm password" autocomplete="new-password">` : ''}
      <div class="sb-err" id="sb-err"></div>
      <button class="auth-btn sb-submit" onclick="window._submitAuth('${mode}')">${isReg ? 'Register' : 'Login'}</button>
      <p class="sb-switch">${isReg ? 'Already have an account?' : "Don't have an account?"}
        <button class="sb-link" onclick="window._openAuthModal('${isReg ? 'login' : 'register'}')">${isReg ? 'Login' : 'Register'}</button></p>
      ${!isReg ? `<p class="sb-switch" style="margin-top:4px"><button class="sb-link" onclick="window._openForgotPassword()">Forgot password?</button></p>` : ''}
    `);
    // Allow Enter to submit
    setTimeout(() => {
      document.querySelectorAll('#sb-uname,#sb-email,#sb-pass,#sb-pass2').forEach(el => {
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
    // A typo in a new password is a locked-out account: make them type it twice.
    if (mode === 'register' && pass !== (document.getElementById('sb-pass2')?.value || '')) {
      if (errEl) { errEl.style.color = '#ff8888'; errEl.textContent = 'Passwords do not match.'; }
      return;
    }
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
        <td style="white-space:nowrap"><b>${esc(String(record.score))}</b> ${platformBadge(record.platform)}</td>
      </tr>` : '';

    if (!rows.length && !record) {
      body.innerHTML = mode === 'comp'
        ? '<p class="sb-empty">No competitive scores this month — be the first!</p>'
        : '<p class="sb-empty">No scores this month — be the first!</p>';
      return;
    }

    const inTop10 = myName && rows.some(r => r.username === myName);
    const pbHtml = myBest ? ` &mdash; PB: <b>${esc(String(myBest.score))}</b>` : '';
    let myRankHtml = '';
    if (currentUser && !inTop10 && myRank) {
      myRankHtml = `<p class="sb-my-rank">Your rank: <b>#${esc(String(myRank.rank))}</b> &mdash; streak <b>${esc(String(myRank.score))}</b>${pbHtml}</p>`;
    } else if (currentUser && !inTop10 && !myRank) {
      myRankHtml = `<p class="sb-my-rank">You have no score yet this month.${myBest ? ` Your PB: <b>${esc(String(myBest.score))}</b>` : ''}</p>`;
    }

    const monthlyRows = rows;
    let rank = 0;
    const monthlyRowsHtml = monthlyRows.map(r => {
      rank++;
      return `
      <tr class="${myName === r.username ? 'sb-lb-me' : ''}">
        <td>${rank}</td>
        <td><div class="lb-player-cell">${renderAvatar(r.username, r.avatar_url, 22, `data-orb="1" onclick="window._openUserProfile({username:'${escAttrJs(r.username)}'})"`)}<span>${esc(r.username)}</span></div></td>
        <td style="white-space:nowrap"><b>${esc(String(r.score))}</b> ${platformBadge(r.platform)}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `<table class="sb-lb-table">
      <thead><tr><th>#</th><th>Player</th><th>Streak</th></tr></thead>
      <tbody>${recordRowHtml}${monthlyRowsHtml || `<tr><td colspan="3" class="sb-empty" style="text-align:center">No scores this month</td></tr>`}</tbody>
    </table>
    ${myRankHtml}
    ${currentUser && inTop10 && myBest ? `<p class="sb-my-rank">Your PB: <b>${esc(String(myBest.score))}</b></p>` : ''}
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
  const QTE_TYPES = ['dagger', 'spear', 'sword', 'fist', 'staff', 'axe', 'hammer', 'dodge', 'thorian', 'thorian-new', 'dagger-new', 'yarthul-new'];
  const QTE_LABELS = { 'thorian-new': 'Thorian (New)', 'dagger-new': 'Dagger (New)', 'yarthul-new': "Yar'Thul (New)" };
  let _allLbPlatform = 'all'; // active platform filter on the all-leaderboards page

  // switchPage calls this on every visit to the Leaderboards tab, and it is the
  // only page that costs an anonymous visitor anything: measured 22.3 KB per
  // nav (leaderboard 14.7 + profiles 6.0 + records 1.2 + ban tables 0.4),
  // identical on every revisit. A short TTL keeps the tab feeling live while
  // making tab-flipping free. The Refresh button bypasses it.
  const ALL_LB_TTL_MS = 60000;
  let _allLbLast = { key: '', at: 0 };

  async function loadAllLeaderboards(mode, platform, force) {
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

    // Serve the rendered grid again if nothing about the request changed and it
    // is still fresh. grid.children guards the case where a previous attempt
    // failed and left only the error paragraph behind.
    const _lbKey = mode + '|' + plat;
    if (!force && _allLbLast.key === _lbKey && grid.children.length
        && Date.now() - _allLbLast.at < ALL_LB_TTL_MS) return;

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
          <td class="all-lb-score"><b>${esc(String(rec.score))}</b> ${platformBadge(rec.platform)}</td>
        </tr>` : '';
      const filteredRows = monthRows;
      const monthlyHtml = filteredRows.length
        ? filteredRows.map((r, i) => `
            <tr class="${myName && myName === r.username ? 'sb-lb-me' : ''}">
              <td class="all-lb-rank">${i + 1}</td>
              <td class="all-lb-name"><div class="lb-player-cell">${renderAvatar(r.username, r.avatar_url, 20, `data-orb="1" onclick="window._openUserProfile({username:'${escAttrJs(r.username)}'})"`)}<span>${esc(r.username)}</span></div></td>
              <td class="all-lb-score"><b>${esc(String(r.score))}</b> ${platformBadge(r.platform)}</td>
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
    _allLbLast = { key: _lbKey, at: Date.now() };
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
        <p class="sb-delete-confirm-body">This will permanently delete your account and its associated data. Donation records may be kept for the supporters list and our financial records. <strong>This cannot be undone.</strong></p>
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
    // Ask the server again rather than trust the flag: it may be stale (the
    // role removed since sign-in), and it lives in a page anyone can edit.
    if (!(await loadAdminFlag())) { renderAuthBar(); return; }
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
        <button class="sb-admin-tab" data-tab="testers" onclick="window._adminSwitchTab('testers');window._adminLoadTesters()">Testers</button>
        <button class="sb-admin-tab" data-tab="listings" onclick="window._adminSwitchTab('listings');window._adminLoadListings()">Listings</button>
        <button class="sb-admin-tab" data-tab="held" onclick="window._adminSwitchTab('held');window._adminLoadHeldScores()">Held scores</button>
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
              <button type="button" id="sb-admin-uuid" class="sb-admin-uuid" title="Copy user ID" onclick="window._adminCopyUuid()"></button>
            </div>
          </div>
          <div class="sb-admin-actions">
            <button class="sb-admin-action-btn sb-admin-btn-ban" onclick="window._adminBanUser()">🚫 Ban</button>
            <button class="sb-admin-action-btn sb-admin-btn-perma" onclick="window._adminPermaBanUser()">🔒 Perma Ban</button>
            <button class="sb-admin-action-btn sb-admin-btn-scores" onclick="window._adminClearScores()">📊 Clear All Scores</button>
            <button class="sb-admin-action-btn sb-admin-btn-scores-one" onclick="window._adminClearOneScore()">🎯 Clear Specific Score</button>
            <button class="sb-admin-action-btn sb-admin-btn-tester" onclick="window._adminToggleTester()">&#10022; Make Tester</button>
            <button class="sb-admin-action-btn sb-admin-btn-listings" onclick="window._adminDeleteListings()">🗑 Delete Listings</button>
            <button class="sb-admin-action-btn sb-admin-btn-wipe" onclick="window._adminBanAndWipe()">☠ Ban + Wipe All</button>
          </div>
        </div>
      </div>

      <div class="sb-admin-panel" data-panel="banned" style="display:none">
        <div id="sb-admin-ban-rows" class="sb-admin-ban-list">${banRows}</div>
      </div>
      <div class="sb-admin-panel" data-panel="held" style="display:none">
        <div id="sb-admin-held-rows" class="sb-admin-ban-list"><div class="sb-admin-empty">Loading…</div></div>
      </div>

      <div class="sb-admin-panel" data-panel="testers" style="display:none">
        <div id="sb-admin-tester-rows" class="sb-admin-ban-list">
          <div class="sb-admin-empty">Switch to this tab to load testers.</div>
        </div>
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
          <button class="sb-admin-unban-btn" onclick="window._unbanUser('${escAttrJs(b.username)}')">Unban</button>
          <button class="sb-admin-perma-btn" onclick="window._adminPermaBanUser('${escAttrJs(b.username)}')">🔒 Perma Ban</button>
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
      `<div class="sb-admin-result-row" onclick="window._adminSelectUser('${escAttrJs(p.id)}')">
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
    // The ID, one click from the clipboard - for adding an admin by hand
    // (public.site_admins, SQL editor) or looking a player up in SQL.
    const uuidEl = document.getElementById('sb-admin-uuid');
    if (uuidEl) { uuidEl.textContent = profile.id; uuidEl.classList.remove('copied'); }
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
    // Tester status for the selected user. Admins can read every row.
    const testerBtn = card.querySelector('.sb-admin-btn-tester');
    if (testerBtn) {
      testerBtn.disabled = true;                     // until the answer arrives
      const { data: t, error: tErr } = await sb.from('testers')
        .select('user_id').eq('user_id', profile.id).maybeSingle();
      // Guard the same race as the card itself: the admin can select someone
      // else while this is in flight, and a late reply must not relabel the
      // button for the wrong person.
      if (_adminCurrentUser && _adminCurrentUser.id === profile.id) {
        setTesterBtn(testerBtn, !!t, tErr || null);
      }
    }
    adminSetStatus('');
  }

  // Everyone who currently has the tester role.
  //
  // Two queries rather than one embedded select: testers.user_id references
  // auth.users, not profiles, so PostgREST has no foreign key to embed across.
  // This is the same shape the leaderboard already uses for the same reason.
  async function adminLoadTesters() {
    if (!isAdmin()) return;
    const box = document.getElementById('sb-admin-tester-rows');
    if (!box) return;
    box.innerHTML = '<div class="sb-admin-empty">Loading…</div>';

    const { data: rows, error } = await sb.from('testers')
      .select('user_id, granted_by, granted_at')
      .order('granted_at', { ascending: false });
    if (error) {
      box.innerHTML = `<div class="sb-admin-empty">Could not load testers: ${esc(error.message)}` +
                      ` (${esc(error.code || '?')}). ${esc(testerErrorHint(error.code))}</div>`;
      return;
    }
    if (!rows || !rows.length) {
      box.innerHTML = '<div class="sb-admin-empty">Nobody has the tester role yet.</div>';
      return;
    }

    // Resolve names for the testers AND for whoever granted each one, in a
    // single lookup.
    const ids = [...new Set(rows.flatMap(r => [r.user_id, r.granted_by]).filter(Boolean))];
    const { data: profs } = await sb.from('profiles').select('id, username').in('id', ids);
    const nameOf = {};
    for (const pr of profs || []) nameOf[pr.id] = pr.username;

    box.innerHTML = rows.map(r => {
      // An account can be deleted while the row survives, and a username we
      // cannot resolve must not silently render as blank.
      const who     = nameOf[r.user_id] || '(deleted account)';
      const by      = r.granted_by ? (nameOf[r.granted_by] || '(unknown)') : '—';
      const when    = r.granted_at ? new Date(r.granted_at).toLocaleDateString() : '—';
      return `<div class="sb-admin-ban-row" data-tester="${esc(r.user_id)}">
        <div>
          <div>${esc(who)}</div>
          <div class="sb-admin-tester-meta">${esc(when)} &nbsp;·&nbsp; by ${esc(by)}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="sb-admin-uuid" title="Copy user ID"
            onclick="window._adminCopyRowUuid(this, '${escAttrJs(r.user_id)}')">${esc(r.user_id)}</button>
          <button class="sb-admin-unban-btn" onclick="window._adminRevokeTester('${escAttrJs(r.user_id)}', this)">Revoke</button>
        </div>
      </div>`;
    }).join('');
  }

  // Revoke from the list, without needing to look the person up first.
  async function adminRevokeTester(userId, btn) {
    if (!isAdmin() || !userId) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Revoking…'; }
    const { error } = await sb.from('testers').delete().eq('user_id', userId);
    if (error) {
      if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
      adminSetStatus(`Could not revoke: ${error.message}`);
      return;
    }
    document.querySelector(`.sb-admin-ban-row[data-tester="${userId}"]`)?.remove();
    // The list may now be empty, and an empty box with no message reads as a
    // loading failure.
    const box = document.getElementById('sb-admin-tester-rows');
    if (box && !box.querySelector('.sb-admin-ban-row')) {
      box.innerHTML = '<div class="sb-admin-empty">Nobody has the tester role yet.</div>';
    }
    // Revoking your own role from this list must not leave the menu disagreeing.
    if (userId === currentUser?.id) _isTester = false;
    // The user card may be showing this same person.
    if (_adminCurrentUser && _adminCurrentUser.id === userId) {
      setTesterBtn(document.querySelector('.sb-admin-btn-tester'), false, null);
    }
  }

  // Copy straight off a list row. Same job as the card's chip, different button.
  async function adminCopyRowUuid(btn, userId) {
    if (!isAdmin() || !btn) return;
    try { await navigator.clipboard.writeText(userId); }
    catch (e) { return; }                 // no clipboard: leave the ID readable
    const prev = btn.textContent;
    btn.textContent = 'Copied \u2713';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = prev; btn.classList.remove('copied'); }, 1200);
  }

  // One place that decides how the button reads, so the load path and the
  // toggle path can never disagree about it.
  //
  // `err` is the Supabase error, not a boolean. The first version of this took a
  // boolean and rendered every failure as "Testers table missing" — which is one
  // possible cause out of several, stated with total confidence, and it sends
  // whoever reads it to look in the wrong place. A missing GRANT and a stale
  // PostgREST schema cache both look identical from here.
  function setTesterBtn(btn, isTesterNow, err) {
    if (!btn) return;
    btn.dataset.tester = isTesterNow ? '1' : '0';
    btn.disabled       = !!err;
    if (err) {
      const code = err.code || '?';
      btn.textContent = '\u2726 Tester lookup failed (' + code + ')';
      btn.title = (err.message || 'unknown error') + '\n\n' + testerErrorHint(code);
      console.warn('[testers] lookup failed:', err);
    } else {
      btn.textContent = isTesterNow ? '\u2726 Remove Tester' : '\u2726 Make Tester';
      btn.title = '';
    }
  }

  // The three failures that actually happen after running supabase/testers.sql,
  // and what each one means. Shown in the button's tooltip.
  function testerErrorHint(code) {
    if (code === '42P01') return 'The table does not exist. Run supabase/testers.sql.';
    if (code === '42501') return 'Permission denied. The table exists but anon/authenticated ' +
                                 'have no GRANT on it — re-run the GRANT lines in supabase/testers.sql.';
    if (code === 'PGRST205' || code === 'PGRST202')
      return 'PostgREST has not picked the table up yet. Run:  notify pgrst, \'reload schema\';  ' +
             'or restart the API from the Supabase dashboard.';
    return 'See the browser console for the full error.';
  }

  async function adminToggleTester() {
    if (!isAdmin() || !_adminCurrentUser) return;
    const btn = document.querySelector('.sb-admin-btn-tester');
    const on  = btn?.dataset.tester === '1';
    const { id, username } = _adminCurrentUser;
    adminSetStatus(on ? `Removing tester from ${username}…` : `Making ${username} a tester…`);
    const { error } = on
      ? await sb.from('testers').delete().eq('user_id', id)
      : await sb.from('testers').insert({ user_id: id, granted_by: currentUser?.id ?? null });
    if (error) {
      // RLS refuses a non-admin here, so this is a real failure worth showing
      // rather than swallowing — the button must not claim a change that the
      // database rejected.
      adminSetStatus(`Could not change tester status: ${error.message}`);
      return;
    }
    // Only relabel if this is still the user on screen.
    if (_adminCurrentUser && _adminCurrentUser.id === id) setTesterBtn(btn, !on, null);
    adminSetStatus(on ? `${username} is no longer a tester.` : `${username} is now a tester.`, true);
    // Keep the Testers tab honest if it has already been loaded behind this one.
    if (document.querySelector('#sb-admin-tester-rows .sb-admin-ban-row') ||
        document.querySelector('#sb-admin-tester-rows .sb-admin-empty')) adminLoadTesters();
    // An admin can toggle their OWN account; keep the in-memory flag honest so
    // the profile menu does not disagree with the database until a reload.
    if (id === currentUser?.id) _isTester = !on;
  }

  async function adminCopyUuid() {
    if (!isAdmin() || !_adminCurrentUser) return;
    const el = document.getElementById('sb-admin-uuid');
    if (!el) return;
    const id = _adminCurrentUser.id;
    let copied = false;
    try {
      await navigator.clipboard.writeText(id);
      copied = true;
    } catch (e) {
      // The clipboard API needs a secure context and can be refused outright.
      // Selecting the text leaves Ctrl+C one keystroke away rather than leaving
      // the admin with a chip that silently does nothing.
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e2) { /* nothing further to try */ }
    }
    el.textContent = copied ? 'Copied \u2713' : 'Press Ctrl+C to copy';
    el.classList.toggle('copied', copied);
    // Restore from _adminCurrentUser rather than from a saved string: the admin
    // can select a different user while this timer is pending, and putting the
    // previous user's ID back would be worse than showing nothing.
    setTimeout(() => {
      const cur = _adminCurrentUser && _adminCurrentUser.id;
      if (cur) el.textContent = cur;
      el.classList.remove('copied');
    }, copied ? 1200 : 2600);
  }

  async function adminBanUser() {
    if (!isAdmin() || !_adminCurrentUser) return;
    if (PERMA_BANNED.has(_adminCurrentUser.username)) {
      adminSetStatus(`${_adminCurrentUser.username} is permanently banned.`); return;
    }
    const banBtn = document.querySelector('.sb-admin-btn-ban');
    const isBanned = banBtn?.dataset.banned === '1';
    const { username, id } = _adminCurrentUser;
    if (isBanned) {
      const { data: status, error } = await sb.rpc('admin_unban_user', { p_username: username });
      if (error) { adminSetStatus(error.message); return; }
      _bannedSet?.delete(username);
      banBtn.textContent = '🚫 Ban'; banBtn.dataset.banned = '0';
      adminSetStatus(status === 'not_banned' ? `${username} was not banned.` : `${username} unbanned.`, true);
      _refreshBannedTab(username, 'remove');
    } else {
      const { data: banStatus, error } = await sb.rpc('admin_ban_user', { p_username: username, p_user_id: id || null });
      if (error) { adminSetStatus(error.message); return; }
      _bannedSet?.add(username);
      banBtn.textContent = '✅ Unban'; banBtn.dataset.banned = '1';
      adminSetStatus(`${username} banned.${banNote(banStatus)}`, true);
      _refreshBannedTab(username, 'add');
    }
  }

  async function adminPermaBanUser(usernameArg, userIdArg) {
    if (!isAdmin()) return;
    const username = usernameArg || _adminCurrentUser?.username;
    // Only borrow the User Actions card's id when it is the same account: the
    // Banned tab passes a name alone, and the card may be showing someone else.
    // (The server refuses a mismatched pair too; this keeps the panel honest.)
    const userId   = userIdArg || (_adminCurrentUser?.username === username ? _adminCurrentUser.id : null);
    if (!username) return;
    if (PERMA_BANNED.has(username)) { adminSetStatus(`${username} is already permanently banned.`); return; }
    if (!confirm(`Permanently ban "${username}"? This cannot be undone from the panel.`)) return;

    adminSetStatus('Applying permanent ban…');
    const { data: banStatus, error } = await sb.rpc('admin_perma_ban_user', { p_username: username, p_user_id: userId || null });
    if (error) { adminSetStatus(error.message); return; }

    PERMA_BANNED.add(username);   // reserved by exact name (isPermaBannedName), and by the server
    _bannedSet?.add(username);
    if (userId) _permaBannedIdSet.add(userId);

    // Remove from the ban list UI (perma banned are hidden there)
    _refreshBannedTab(username, 'remove');

    // Update action buttons if this user is currently displayed
    if (_adminCurrentUser?.username === username) {
      const banBtn   = document.querySelector('.sb-admin-btn-ban');
      const permaBtn = document.querySelector('.sb-admin-btn-perma');
      if (banBtn)   { banBtn.textContent = '🔒 Perma Banned'; banBtn.disabled = true; banBtn.dataset.banned = '1'; }
      if (permaBtn) { permaBtn.textContent = '🔒 Perma Banned'; permaBtn.disabled = true; }
    }
    adminSetStatus(`${username} permanently banned.${banNote(banStatus)}`, true);
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
        <button class="sb-admin-del-listing-btn" onclick="window._adminDeleteListing('${escAttrJs(l.id)}')">🗑</button>
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
    // The function clears the monthly rows, the personal bests and the all-time
    // records in one go; the client no longer touches those tables.
    const { error } = await sb.rpc('admin_clear_all_scores', { p_user_id: _adminCurrentUser.id });
    if (error) { adminSetStatus(error.message); return; }
    adminSetStatus(`Scores cleared for ${_adminCurrentUser.username}.`, true);
  }

  const _ALL_QTE_TYPES = ['dagger','spear','sword','fist','staff','axe','hammer','dodge','thorian','thorian-new','dagger-new','yarthul-new','dagger-comp','spear-comp','sword-comp','fist-comp','staff-comp','axe-comp','hammer-comp','dodge-comp','thorian-comp','thorian-new-comp','dagger-new-comp','yarthul-new-comp'];

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
    // The ban first, on its own: it is the call that can refuse (an admin, or a
    // card gone stale under a rename), and a refusal must not arrive after the
    // scores and listings are already gone.
    const { data: banStatus, error: banErr } = await sb.rpc('admin_ban_user',
      { p_username: _adminCurrentUser.username, p_user_id: _adminCurrentUser.id });
    if (banErr) { adminSetStatus(banErr.message); return; }
    const results = await Promise.all([
      sb.rpc('admin_clear_all_scores', { p_user_id: _adminCurrentUser.id }),
      sb.rpc('admin_delete_listings',  { p_username: _adminCurrentUser.username }),
    ]);
    _bannedSet?.add(_adminCurrentUser.username);
    const banBtn = document.querySelector('.sb-admin-btn-ban');
    if (banBtn) { banBtn.textContent = '✅ Unban'; banBtn.dataset.banned = '1'; }
    _refreshBannedTab(_adminCurrentUser.username, 'add');
    const failed = results.find(r => r.error);
    if (failed) { adminSetStatus(`${_adminCurrentUser.username} banned, but the wipe failed: ${failed.error.message}`); return; }
  }

  function _refreshBannedTab(username, action) {
    const rowsEl = document.getElementById('sb-admin-ban-rows');
    if (!rowsEl) return;
    if (action === 'add' && !PERMA_BANNED.has(username) && !rowsEl.querySelector(`[data-ban="${username}"]`)) {
      rowsEl.querySelector('.sb-admin-empty')?.remove();
      const div = document.createElement('div');
      div.className = 'sb-admin-ban-row';
      div.dataset.ban = username;
      div.innerHTML = `<span>${esc(username)}</span><div style="display:flex;gap:6px"><button class="sb-admin-unban-btn" onclick="window._unbanUser('${escAttrJs(username)}')">Unban</button><button class="sb-admin-perma-btn" onclick="window._adminPermaBanUser('${escAttrJs(username)}',null)">🔒 Perma Ban</button></div>`;
      rowsEl.appendChild(div);
    } else if (action === 'remove') {
      rowsEl.querySelector(`[data-ban="${username}"]`)?.remove();
      if (!rowsEl.children.length) rowsEl.innerHTML = '<div class="sb-admin-empty">No banned users.</div>';
    }
  }

  async function unbanUser(username) {
    if (!isAdmin()) return;
    if (PERMA_BANNED.has(username)) return;
    const { data: status, error } = await sb.rpc('admin_unban_user', { p_username: username });
    if (error) { adminSetStatus(error.message); return; }
    _bannedSet?.delete(username);
    _refreshBannedTab(username, 'remove');
    adminSetStatus(status === 'not_banned' ? `${username} was not banned.` : `${username} unbanned.`, true);
  }

  // ── Admin: held scores ───────────────────────────────────────
  // A new all-time record, or a big jump to a monthly #1, is held by
  // submit_score until an admin looks (supabase/qte-scores.sql). Approving
  // posts it exactly as submit_score would have; rejecting posts nothing.
  // Both are admin_review_score, which checks for an admin on the server.
  async function adminLoadHeldScores() {
    if (!isAdmin()) return;
    const rowsEl = document.getElementById('sb-admin-held-rows');
    if (!rowsEl) return;
    const { data, error } = await sb.from('score_reviews')
      .select('id, user_id, qte_type, score, platform, reason, submitted_at')
      .eq('status', 'pending').order('submitted_at', { ascending: true }).limit(200);
    if (error) { rowsEl.innerHTML = `<div class="sb-admin-empty">${esc(error.message)}</div>`; return; }
    if (!data || !data.length) { rowsEl.innerHTML = '<div class="sb-admin-empty">No scores waiting.</div>'; return; }
    const ids = [...new Set(data.map(r => r.user_id))];
    const { data: profs } = await sb.from('profiles').select('id, username').in('id', ids);
    const name = Object.fromEntries((profs || []).map(p => [p.id, p.username]));
    rowsEl.innerHTML = data.map(r => `<div class="sb-admin-ban-row" data-held="${esc(r.id)}">
        <span><b>${esc(name[r.user_id] || r.user_id)}</b> &mdash; ${esc(String(r.score))} on ${esc(r.qte_type)} ${platformBadge(r.platform)}
          <br><small style="color:#888">${esc(r.reason)} &middot; ${esc(new Date(r.submitted_at).toLocaleString())}</small></span>
        <div style="display:flex;gap:6px">
          <button class="sb-admin-unban-btn" onclick="window._adminReviewScore('${escAttrJs(r.id)}', true, this, ${Number(r.score) | 0})">Approve</button>
          <button class="sb-admin-perma-btn" onclick="window._adminReviewScore('${escAttrJs(r.id)}', false, this, ${Number(r.score) | 0})">Reject</button>
        </div>
      </div>`).join('');
  }

  // shownScore: the score on the row the admin clicked. The server refuses an
  // approval if the pending score has moved since (its run went on).
  async function adminReviewScore(id, approve, btn, shownScore) {
    if (!isAdmin() || !id) return;
    if (btn) btn.disabled = true;
    const { error } = await sb.rpc('admin_review_score', { p_id: id, p_approve: !!approve, p_score: shownScore });
    if (error) {
      adminSetStatus(error.message);
      if (btn) btn.disabled = false;
      if (/score is now/.test(error.message)) adminLoadHeldScores();   // show the current figure
      return;
    }
    document.querySelector(`.sb-admin-ban-row[data-held="${CSS.escape(id)}"]`)?.remove();
    const rowsEl = document.getElementById('sb-admin-held-rows');
    if (rowsEl && !rowsEl.querySelector('.sb-admin-ban-row')) rowsEl.innerHTML = '<div class="sb-admin-empty">No scores waiting.</div>';
    adminSetStatus(approve ? 'Score approved and posted.' : 'Score rejected.', true);
  }

  async function adminPurgeExpired(btn) {
    if (!isAdmin()) return;
    if (!confirm('Purge all expired trades (>2 days) and parties (open >5 h, full >2 days)?')) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Purging…'; }
    adminSetStatus('Purging expired records…');

    const { error } = await sb.rpc('admin_purge_expired');
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
    const resetBtn = () => { if (btn) { btn.disabled = false; btn.textContent = '🔍 Scan & Ban All Profanity Usernames'; } };
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
    // Every profile, a page at a time: one request is capped at the project's
    // max-rows (1000), and past 1000 accounts the rest were never checked.
    let profiles = [];
    for (let from = 0; ; ) {
      const { data, error } = await sb.from('profiles').select('username').order('id').range(from, from + 999);
      if (error) { adminSetStatus('Scan failed: ' + error.message); resetBtn(); return; }
      if (!data || !data.length) break;
      profiles = profiles.concat(data);
      from += data.length;
    }
    // Whole tokens only (usernameProfanity), and remember which word it was so
    // the admin can see why each name is on the list.
    const why = {};
    profiles.forEach(p => { const w = p.username && usernameProfanity(p.username); if (w) why[p.username] = w; });
    const dirty = Object.keys(why);
    if (!dirty.length) {
      adminSetStatus(`No profanity usernames found (${profiles.length} checked).`, true);
      resetBtn();
      return;
    }
    // A ban locks the account in Auth; show the list and the reason first.
    if (!confirm(`Ban ${dirty.length} account(s)?\n\n` + dirty.map(u => `${u}  (${why[u]})`).join('\n'))) {
      adminSetStatus('Sweep cancelled.', true);
      resetBtn();
      return;
    }
    // The function answers with the names it actually banned - an admin's name
    // is skipped whatever the filter thought of it - so report those, not the
    // list that was sent.
    const { data: bannedNames, error } = await sb.rpc('admin_ban_usernames', { p_usernames: dirty });
    if (error) { adminSetStatus(error.message); if (btn) { btn.disabled = false; btn.textContent = '🔍 Scan & Ban All Profanity Usernames'; } return; }
    const done = Array.isArray(bannedNames) ? bannedNames : dirty;
    done.forEach(u => _bannedSet?.add(u));
    done.forEach(u => _refreshBannedTab(u, 'add'));
    const skipped = dirty.filter(u => !done.includes(u));
    adminSetStatus(`Banned ${done.length} user(s): ${done.map(u => `${u} (${why[u]})`).join(', ') || '—'}` +
      (skipped.length ? ` · skipped (admin): ${skipped.join(', ')}` : ''), true);
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Scan & Ban All Profanity Usernames'; }
  }

  window._sbSignOut          = () => signOut();
  window._openAuthModal      = openAuthModal;
  window._openLeaderboard    = openLeaderboard;
  window._closeModal         = closeModal;
  window._submitAuth         = submitAuth;
  window._sbSubmitScore      = submitScore;
  window._sbStartQteSession  = startQteSession;
  window._sbStartQteRun      = startQteRun;     // QteRules.Run.start (js/qte-rules.js)
  window._sbGetUsername      = () => currentProfile?.username || null;
  window._sbGetUserId        = () => currentUser?.id ?? null;
  window._sbGetAvatar        = () => currentProfile?.avatar_url || null;
  window._sbAvatar           = renderAvatar; // reuse leaderboard avatar renderer (sb.js renderAvatar)
  window._sbSafeAvatarUrl    = safeAvatarUrl; // trades.js / party.js draw avatars through the same rule
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
  // The Refresh button means "I want it now", so it forces past the TTL.
  window._lbRefresh            = () => loadAllLeaderboards(null, undefined, true);
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
  window._adminCopyUuid          = adminCopyUuid;
  window._adminToggleTester      = adminToggleTester;
  window._adminLoadTesters       = adminLoadTesters;
  window._adminRevokeTester      = adminRevokeTester;
  window._adminCopyRowUuid       = adminCopyRowUuid;
  window._adminDeleteListings    = adminDeleteListings;
  window._adminBanAndWipe        = adminBanAndWipe;
  window._unbanUser              = unbanUser;
  window._banAllProfanityUsers   = banAllProfanityUsers;
  window._adminPurgeExpired      = adminPurgeExpired;
  window._adminLoadHeldScores    = adminLoadHeldScores;
  window._adminReviewScore       = adminReviewScore;
  window._sbIsAdmin              = isAdmin;
  window._sbIsTester             = isTester;
  window._sbCanUseAI             = canUseAI;
  // No admin list is exported, and none exists here: a new report rings the
  // admins from the database (trigger reports_notify_admins, admin-server.sql).
  window._sbProfanityList        = PROFANITY_LIST; // live reference — mutations are reflected immediately
  window._sbFoldChar             = foldChar;       // trades.js folds chat through the same table

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
