// =============================================================================
// AL BUILDER — matchmaking.js
// Head-to-head QTE duels. Two logged-in players queue for the same QTE and play
// best-of-3: first to make a mistake loses the round; if neither fails within the
// 90s round timer the higher streak wins. Unrated (name+avatar) or Ranked (RR ladder).
//
// Reuses the existing QTE engines (js/qte.js) via window._qteMatch — the engines run
// in "match mode": report streaks + signal a mistake, never write the Training board.
// Realtime via Supabase broadcast + presence (same pattern as party.js). The "host"
// (smaller user id) is authoritative for round results and rating updates.
// =============================================================================
(function () {
  'use strict';

  const ROUND_MS    = 90000;  // 90s per round
  const WIN_ROUNDS  = 2;      // best of 3
  const PROGRESS_MS = 180;    // throttle for live streak broadcasts
  const FAIL_GRACE  = 350;    // ms to wait after a fail to catch a near-simultaneous fail
  const PLACEMENT_GAMES = 3;  // first N ranked games are hidden placement/calibration matches
  const PROVISIONAL_RR  = 600;// hidden starting RR used to seed + match unplaced players
  // Practice-bot difficulty: streak target range (minT..maxT) + pace ms/point (minP..maxP).
  const BOT_DIFF = {
    easy:   { label: 'Easy',   minT: 2, maxT: 5,  minP: 1100, maxP: 1600 },
    medium: { label: 'Medium', minT: 4, maxT: 10, minP: 750,  maxP: 1200 },
    hard:   { label: 'Hard',   minT: 9, maxT: 18, minP: 430,  maxP: 780  },
  };

  // QTE registry — panel id, start-button id, show/hide hook suffix, label, group.
  const QTES = [
    { id: 'dagger',      label: 'Dagger',  group: 'old', hook: 'Dagger'     },
    { id: 'spear',       label: 'Spear',   group: 'old', hook: 'Spear'      },
    { id: 'sword',       label: 'Sword',   group: 'old', hook: 'Sword'      },
    { id: 'fist',        label: 'Fist',    group: 'old', hook: 'Fist'       },
    { id: 'staff',       label: 'Staff',   group: 'old', hook: 'Staff'      },
    { id: 'axe',         label: 'Axe',     group: 'old', hook: 'Axe'        },
    { id: 'hammer',      label: 'Hammer',  group: 'old', hook: 'Hammer'     },
    { id: 'dodge',       label: 'Dodge',   group: 'old', hook: 'Dodge'      },
    { id: 'thorian',     label: 'Thorian', group: 'old', hook: 'Thorian'    },
    { id: 'thorian-new', label: 'Thorian', group: 'new', hook: 'ThorianNew' },
    { id: 'dagger-new',  label: 'Dagger',  group: 'new', hook: 'DaggerNew'  },
  ];
  const qteById = id => QTES.find(q => q.id === id);
  const qteLabel = id => { const q = qteById(id); return q ? (q.label + (q.group === 'new' ? ' (New)' : '')) : id; };

  // ── Rank model (Valorant-style ladder, arcane names) ────────────────────────
  const TIERS = ['Initiate','Apprentice','Adept','Evoker','Mystic','Sage','Magus','Luminary','Transcendent'];
  const TIER_COLORS = {
    Initiate:'#8a8f98', Apprentice:'#7d9b76', Adept:'#5fb0a7', Evoker:'#5b8dd9',
    Mystic:'#8b6fd0', Sage:'#c06fd0', Magus:'#d08b4f', Luminary:'#e0c24f', Transcendent:'#e85d9b'
  };
  const ROMAN = { 1:'I', 2:'II', 3:'III' };
  const TIER_SPAN = 300; // 3 divisions x 100 RR
  function rankFromRR(rr) {
    rr = Math.max(0, rr | 0);
    const topStart = (TIERS.length - 1) * TIER_SPAN; // Transcendent threshold
    if (rr >= topStart) return { tier: 'Transcendent', label: 'Transcendent', rrInDiv: rr - topStart, pct: 100, top: true };
    const ti = Math.floor(rr / TIER_SPAN);
    const inTier = rr - ti * TIER_SPAN;
    const div = Math.floor(inTier / 100) + 1;
    const rrInDiv = inTier % 100;
    return { tier: TIERS[ti], label: TIERS[ti] + ' ' + ROMAN[div], rrInDiv, pct: rrInDiv, top: false };
  }

  // Full ladder reference modal (the "View Rank Ladder" button).
  function showRanksModal() {
    const placed = isPlaced(me.games);
    const myTi = placed ? Math.min(Math.floor(me.rr / TIER_SPAN), TIERS.length - 1) : -1;
    const myDiv = (placed && myTi < TIERS.length - 1) ? Math.floor((me.rr - myTi * TIER_SPAN) / 100) + 1 : 0;

    let rows = '';
    for (let ti = TIERS.length - 1; ti >= 0; ti--) {
      const name = TIERS[ti];
      const color = TIER_COLORS[name] || '#888';
      const isTop = ti === TIERS.length - 1;
      const base = ti * TIER_SPAN;
      let divs;
      if (isTop) {
        divs = `<span class="mm-rank-div ${myTi === ti ? 'cur' : ''}">${base}+ RR</span>`;
      } else {
        divs = [3, 2, 1].map(d => {
          const lo = base + (d - 1) * 100;
          const cur = (ti === myTi && d === myDiv) ? 'cur' : '';
          return `<span class="mm-rank-div ${cur}">${ROMAN[d]} &middot; ${lo}-${lo + 99}</span>`;
        }).join('');
      }
      rows += `<div class="mm-rank-tier ${ti === myTi ? 'mine' : ''}" style="--tc:${color}">
        <div class="mm-rank-tier-name"><span class="mm-rank-chip"></span>${name}</div>
        <div class="mm-rank-divs">${divs}</div>
      </div>`;
    }
    const note = placed
      ? `You are <b>${esc(rankFromRR(me.rr).label)}</b> &bull; ${rankFromRR(me.rr).rrInDiv} RR`
      : `Finish your placement matches (${Math.min(me.games, PLACEMENT_GAMES)}/${PLACEMENT_GAMES}) to earn a rank.`;

    const o = document.createElement('div');
    o.className = 'mm-modal-overlay';
    o.id = 'mm-ranks-modal';
    o.innerHTML = `<div class="mm-modal">
      <div class="mm-modal-head">
        <h3>Rank Ladder</h3>
        <button class="mm-modal-close" id="mm-ranks-close">&times;</button>
      </div>
      <div class="mm-modal-note">${note}</div>
      <div class="mm-rank-ladder">${rows}</div>
      <div class="mm-modal-foot">Win matches to climb; lose to drop. Each division is 100 RR.</div>
    </div>`;
    document.body.appendChild(o);
    const close = () => o.remove();
    o.addEventListener('mousedown', e => { if (e.target === o) close(); });
    o.querySelector('#mm-ranks-close').onclick = close;
  }

  // ── Module state ────────────────────────────────────────────────────────────
  let sb = null;
  let me = null;                 // { id, name, avatar, rr }
  let mode = 'unrated';
  let view = 'idle';             // idle | searching | match
  let queueChan = null, matchChan = null;
  let matchId = null, isHost = false, opp = null; // opp = { id, name, avatar, rr }
  let matching = false, queueStart = 0;

  // per-match
  let roundNo = 1;
  let wins = {};                 // { [userId]: roundsWon }
  let streaks = {};              // { [userId]: latest streak }
  let fails = {};                // { [userId]: failTimestamp }
  let roundActive = false, roundResolved = false, matchResolved = false;
  let deadline = 0, started = false, oppReady = false;
  let isBot = false, botTimer = null, botTarget = 0, botDifficulty = 'medium';  // practice-vs-bot mode
  let myReported = 0, lastProgressSent = 0;
  let timerTick = null, hostTimeoutT = null, failAdjT = null, oppGoneT = null;
  let roundLog = [];             // host-recorded per-round scores -> persisted for reports

  // ── Small helpers ───────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function avatar(name, url, size) { return window._sbAvatar ? window._sbAvatar(name, url, size) : `<div class="mm-av-fallback">${esc((name||'?').charAt(0))}</div>`; }
  function bcast(event, payload) { if (matchChan) matchChan.send({ type: 'broadcast', event, payload: payload || {} }); }

  async function fetchMyRating() {
    try {
      const { data } = await sb.from('mm_ratings').select('rr, placement_games').eq('user_id', me.id).maybeSingle();
      return { rr: data ? (data.rr | 0) : 0, games: data ? (data.placement_games | 0) : 0 };
    } catch (_) { return { rr: 0, games: 0 }; }
  }
  // Whether a player has finished their placement games.
  const isPlaced = games => (games | 0) >= PLACEMENT_GAMES;
  // RR value used for matchmaking: unplayed players match around the provisional seed.
  function matchRR(rr, games) { return (games | 0) === 0 ? PROVISIONAL_RR : (rr | 0); }
  // Header label for a side: placements banner until calibrated, else the tier.
  function rankLabelFor(rr, games) {
    return isPlaced(games) ? rankFromRR(rr).label : ('Placements ' + Math.min(games | 0, PLACEMENT_GAMES) + '/' + PLACEMENT_GAMES);
  }

  // ── Entry point (called by switchPage) ──────────────────────────────────────
  window._mmLoad = async function () {
    sb = window._sbClient;
    const uid = window._sbGetUserId && window._sbGetUserId();
    if (!sb || !uid) { renderLogin(); return; }
    me = { id: uid, name: (window._sbGetUsername && window._sbGetUsername()) || 'You', avatar: (window._sbGetAvatar && window._sbGetAvatar()) || null, rr: 0, games: 0 };
    const r = await fetchMyRating(); me.rr = r.rr; me.games = r.games;
    if (view === 'idle') renderHome();
  };

  window._mmLeavePage = function () {
    if (view === 'searching') cancelQueue();
    else if (view === 'match') teardownMatch(true);
    view = 'idle';
  };

  // ── Screens ─────────────────────────────────────────────────────────────────
  function root() { return $('mm-root'); }

  function renderLogin() {
    root().innerHTML = `<div class="mm-center">
      <div class="mm-panel">
        <div class="mm-eyebrow">Head-to-head duels</div>
        <h2 class="mm-title">Matchmaking</h2>
        <p class="mm-sub">Log in to duel other players in head-to-head QTE matches.</p>
        <button class="mm-btn mm-btn-primary" onclick="window._openAuthModal && window._openAuthModal('login')">Log In</button>
      </div></div>`;
  }

  function renderHome() {
    view = 'idle';
    const rk = rankFromRR(me.rr);
    const groups = ['old', 'new'].map(g => {
      const btns = QTES.filter(q => q.group === g).map(q =>
        `<button class="mm-qte-btn tab" data-qte="${q.id}">${esc(q.label)}</button>`).join('');
      return `<div class="mm-qte-group">
        <div class="mm-qte-group-label">${g === 'old' ? 'Old' : 'New'}</div>
        <div class="mm-qte-row">${btns}</div>
      </div>`;
    }).join('');

    root().innerHTML = `<div class="mm-center">
      <div class="mm-panel mm-home">
        <div class="mm-eyebrow">Head-to-head duels</div>
        <h2 class="mm-title">Matchmaking</h2>
        <div class="mm-mode-toggle">
          <button class="mm-mode-btn ${mode==='unrated'?'active':''}" data-mode="unrated">Unrated</button>
          <button class="mm-mode-btn ${mode==='ranked'?'active':''}" data-mode="ranked">Ranked</button>
          <button class="mm-mode-btn ${mode==='bot'?'active':''}" data-mode="bot">Practice Bot</button>
        </div>
        <div class="mm-bot-diff" id="mm-bot-diff" style="${mode==='bot'?'':'display:none'}">
          <span class="mm-bot-diff-label">Bot difficulty</span>
          <div class="mm-diff-row">
            ${['easy','medium','hard'].map(d => `<button class="mm-diff-btn ${botDifficulty===d?'active':''}" data-diff="${d}">${BOT_DIFF[d].label}</button>`).join('')}
          </div>
        </div>
        <div class="mm-rank-line" id="mm-rank-line" style="${mode==='ranked'?'':'display:none'}">
          ${isPlaced(me.games)
            ? `Your rank: <b>${esc(rk.label)}</b> &bull; ${rk.rrInDiv} RR`
            : `<b>Placement matches</b> &bull; ${Math.min(me.games, PLACEMENT_GAMES)}/${PLACEMENT_GAMES} played &mdash; win games to set your rank`}
        </div>
        <button class="mm-btn mm-ranks-btn" id="mm-ranks-btn" style="${mode==='ranked'?'':'display:none'}">&#9733; View Rank Ladder</button>
        <p class="mm-sub">${mode==='bot' ? 'Pick a QTE to practice against a bot.' : 'Pick a QTE to enter the queue.'}</p>
        <div class="mm-qte-picker">${groups}</div>
      </div></div>`;

    root().querySelectorAll('.mm-mode-btn').forEach(b => b.onclick = () => { mode = b.dataset.mode; renderHome(); });
    root().querySelectorAll('.mm-qte-btn').forEach(b => b.onclick = () => startQueue(b.dataset.qte));
    root().querySelectorAll('.mm-diff-btn').forEach(b => b.onclick = () => { botDifficulty = b.dataset.diff; renderHome(); });
    const rb = $('mm-ranks-btn'); if (rb) rb.onclick = showRanksModal;
  }

  function renderSearching(qte) {
    root().innerHTML = `<div class="mm-center">
      <div class="mm-panel mm-searching">
        <div class="mm-spinner"></div>
        <h2 class="mm-title">Searching…</h2>
        <p class="mm-sub">${mode === 'ranked' ? 'Ranked' : 'Unrated'} &bull; ${esc(qteLabel(qte))}</p>
        <div class="mm-queue-count" id="mm-queue-count">1 player in queue</div>
        <button class="mm-btn" id="mm-cancel-btn">Cancel</button>
      </div></div>`;
    $('mm-cancel-btn').onclick = () => { cancelQueue(); renderHome(); };
  }

  function updateQueueCount() {
    const el = $('mm-queue-count');
    if (!el || !queueChan) return;
    const n = Object.keys(queueChan.presenceState() || {}).length || 1;
    el.textContent = n + (n === 1 ? ' player in queue' : ' players in queue');
  }

  // ── Queue + matching ────────────────────────────────────────────────────────
  let curQte = null;
  async function startQueue(qte) {
    if (mode === 'bot') { enterBotMatch(qte); return; }
    curQte = qte; view = 'searching'; matching = false; queueStart = Date.now();
    const r = await fetchMyRating(); me.rr = r.rr; me.games = r.games;
    const snap = matchRR(me.rr, me.games); // RR used for matchmaking
    renderSearching(qte);
    // Register in the queue table (atomic pairing uses these rows).
    try {
      await sb.from('mm_queue').upsert({
        user_id: me.id, username: me.name, avatar_url: me.avatar,
        mode, qte, rating: snap, created_at: new Date().toISOString()
      });
    } catch (e) { /* ignore; presence still drives discovery */ }

    queueChan = sb.channel('mm-q-' + mode + '-' + qte, { config: { presence: { key: me.id } } });
    queueChan
      .on('broadcast', { event: 'matched' }, ({ payload }) => {
        if (!payload || matching) return;
        if (payload.guest !== me.id) return;          // only the intended guest acts
        matching = true;
        enterMatch(payload.matchId, { id: payload.host, name: payload.hostName, avatar: payload.hostAvatar, rr: payload.hostRR, games: payload.hostGames | 0 }, false);
      })
      .on('presence', { event: 'sync' }, () => { updateQueueCount(); tryMatch(); })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await queueChan.track({ id: me.id, name: me.name, avatar: me.avatar, rr: snap, games: me.games });
      });
  }

  function rrWindow() {
    // Widen the acceptable RR gap over time: 150 + 50 every 4s, uncapped after ~30s.
    const secs = (Date.now() - queueStart) / 1000;
    return mode === 'ranked' ? (150 + Math.floor(secs / 4) * 50) : Infinity;
  }

  async function tryMatch() {
    if (matching || !queueChan || view !== 'searching') return;
    const state = queueChan.presenceState();
    const peers = [];
    Object.keys(state).forEach(key => {
      const meta = state[key] && state[key][0];
      if (meta && meta.id && meta.id !== me.id) peers.push(meta);
    });
    if (!peers.length) return;
    // Only the smallest-id player in the room initiates, to avoid double-pairing.
    const smallestPeer = peers.reduce((a, b) => (a.id < b.id ? a : b));
    if (me.id > smallestPeer.id) return; // someone smaller will initiate
    // Eligible by RR window (unrated → everyone). Compare matchmaking snapshots.
    const mySnap = matchRR(me.rr, me.games);
    const win = rrWindow();
    const eligible = peers.filter(p => Math.abs((p.rr | 0) - mySnap) <= win)
                          .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!eligible.length) return;
    const target = eligible[0];
    matching = true;
    let newId = null;
    try {
      const { data, error } = await sb.rpc('mm_create_match', { other: target.id });
      if (error) throw error;
      newId = data;
    } catch (e) { matching = false; return; }
    if (!newId) { matching = false; return; } // opponent already left/matched
    // Tell the guest which match to join. Await so the message is flushed to the
    // server before we tear down the queue channel in enterMatch().
    try {
      await queueChan.send({ type: 'broadcast', event: 'matched', payload: {
        matchId: newId, guest: target.id,
        host: me.id, hostName: me.name, hostAvatar: me.avatar, hostRR: mySnap, hostGames: me.games
      }});
    } catch (_) {}
    enterMatch(newId, { id: target.id, name: target.name, avatar: target.avatar, rr: target.rr | 0, games: target.games | 0 }, true);
  }

  function cancelQueue() {
    try { sb && sb.from('mm_queue').delete().eq('user_id', me.id); } catch (_) {}
    if (queueChan) { try { sb.removeChannel(queueChan); } catch (_) {} queueChan = null; }
    matching = false;
  }

  // ── Match ───────────────────────────────────────────────────────────────────
  function enterMatch(id, opponent, host) {
    if (queueChan) { try { sb.removeChannel(queueChan); } catch (_) {} queueChan = null; }
    try { sb.from('mm_queue').delete().eq('user_id', me.id); } catch (_) {}

    view = 'match'; matchId = id; isHost = host; opp = opponent;
    roundNo = 1; wins = { [me.id]: 0, [opp.id]: 0 }; matchResolved = false; started = false; oppReady = false; roundLog = [];

    renderArena();
    mountQte(curQte);
    window._qteMatch = {
      active: false, qte: curQte,
      report: s => onLocalReport(s),
      fail: () => onLocalFail(),
    };
    if (window._qteGuard) window._qteGuard.onFlag = onGuardFlag;

    matchChan = sb.channel('mm-match-' + id, { config: { presence: { key: me.id } } });
    matchChan
      .on('broadcast', { event: 'ready' },        ({ payload }) => onOppReady(payload))
      .on('broadcast', { event: 'round-start' },  ({ payload }) => { if (!isHost) doRoundStart(payload.round, payload.startedAt); })
      .on('broadcast', { event: 'progress' },     ({ payload }) => onOppProgress(payload))
      .on('broadcast', { event: 'fail' },         ({ payload }) => onOppFail(payload))
      .on('broadcast', { event: 'round-result' }, ({ payload }) => { if (!isHost) applyRoundResult(payload.winnerId); })
      .on('broadcast', { event: 'match-result' }, ({ payload }) => { if (!isHost) showMatchOverlay(payload.winnerId); })
      .on('broadcast', { event: 'abandon' },      ({ payload }) => { if (payload && payload.by === opp.id) onOppAbandon(); })
      .on('presence', { event: 'leave' }, ({ key }) => { if (key === opp.id) onOppPresenceLeave(); })
      .on('presence', { event: 'sync' }, () => {
        const st = matchChan.presenceState();
        if (st[me.id] && st[opp.id]) { oppReady = true; maybeStartMatch(); } // presence backup for the ready handshake
        if (st[opp.id] && oppGoneT) { clearTimeout(oppGoneT); oppGoneT = null; }
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await matchChan.track({ id: me.id });
          bcast('ready', { id: me.id });
        }
      });
  }

  // Round 1 starts once BOTH players are confirmed present. We confirm via an
  // explicit ready handshake (primary) and presence sync (backup), because
  // presence timing alone can miss the join on one side.
  function onOppReady(payload) {
    if (!payload || payload.id !== opp.id) return;
    if (!oppReady) { oppReady = true; bcast('ready', { id: me.id }); } // echo so our ready is heard even if sent early
    maybeStartMatch();
  }
  function maybeStartMatch() {
    if (isHost && !started && oppReady) { started = true; sendRoundStart(); }
  }

  // Practice vs a local simulated opponent. No queue, no realtime, no rating change.
  function enterBotMatch(qte) {
    curQte = qte; view = 'match'; isBot = true; isHost = true; matchId = null;
    opp = { id: '__bot__', name: 'Practice Bot (' + (BOT_DIFF[botDifficulty] || BOT_DIFF.medium).label + ')', avatar: null, rr: 0, games: PLACEMENT_GAMES };
    roundNo = 1; wins = { [me.id]: 0, [opp.id]: 0 }; roundLog = [];
    matchResolved = false; started = true; oppReady = true;
    renderArena();
    mountQte(curQte);
    window._qteMatch = { active: false, qte: curQte, report: s => onLocalReport(s), fail: () => onLocalFail() };
    if (window._qteGuard) window._qteGuard.onFlag = onGuardFlag;
    setTimeout(() => { if (view === 'match' && isBot) sendRoundStart(); }, 900);
  }

  // Drives the bot during a round: it climbs a streak at a steady pace until it
  // reaches a randomly chosen target, then "slips up" (fails) — giving you a real
  // opponent to outlast. If the round timer ends first it just stops where it is.
  function startBotRound() {
    clearInterval(botTimer);
    const cfg = BOT_DIFF[botDifficulty] || BOT_DIFF.medium;
    botTarget = cfg.minT + Math.floor(Math.random() * (cfg.maxT - cfg.minT + 1));
    const pace = cfg.minP + Math.random() * (cfg.maxP - cfg.minP); // ms per point
    streaks[opp.id] = 0; setOppStreak(0); setOppStatus('playing');
    botTimer = setInterval(() => {
      if (!roundActive || roundResolved) { clearInterval(botTimer); return; }
      streaks[opp.id] = (streaks[opp.id] | 0) + 1;
      setOppStreak(streaks[opp.id]);
      if (fails[me.id]) hostAdjudicate('progress'); // I already slipped; bot may pass my score
      if (streaks[opp.id] >= botTarget) {
        clearInterval(botTimer);
        fails[opp.id] = Date.now();
        setOppStatus('failed');
        scheduleFailAdjudication();
      }
    }, pace);
  }

  function playerHeader(p, sideRR, sideGames) {
    const rankHtml = (mode === 'ranked')
      ? `<div class="mm-rank-badge">${esc(rankLabelFor(sideRR, sideGames))}${isPlaced(sideGames) ? ` <span class="mm-rank-rr">${rankFromRR(sideRR).rrInDiv} RR</span>` : ''}</div>`
      : '';
    // The opponent's orb is clickable to open their profile / report them (not the bot, not yourself).
    const isOpp = p && opp && p.id === opp.id && opp.id !== '__bot__' && !isBot;
    const avHtml = avatar(p.name, p.avatar, 40);
    // Strip quotes/backslashes (JS-string context) then HTML-escape (attribute context) —
    // opp.name arrives via realtime presence/broadcast and is attacker-controlled.
    const safeAttr = s => esc(String(s == null ? '' : s).replace(/['"\\]/g, ''));
    const av = isOpp
      ? `<span class="mm-orb-click" title="View profile" onclick="window._openUserProfile({userId:'${safeAttr(opp.id)}',username:'${safeAttr(opp.name)}',matchId:'${safeAttr(matchId || '')}'})">${avHtml}</span>`
      : avHtml;
    return `<div class="mm-head">
      ${av}
      <div class="mm-head-info"><div class="mm-head-name">${esc(p.name)}</div>${rankHtml}</div>
    </div>`;
  }

  function renderArena() {
    root().innerHTML = `<div class="mm-arena">
      <div class="mm-arena-top">
        <button class="mm-btn mm-leave-btn" id="mm-leave-btn">Leave</button>
        <div class="mm-scoreboard">
          <span class="mm-pips" id="mm-pips-me"></span>
          <div class="mm-timer" id="mm-timer">1:30</div>
          <span class="mm-pips" id="mm-pips-opp"></span>
        </div>
        <div class="mm-roundno" id="mm-roundno">Round 1</div>
      </div>
      <div class="mm-boxes">
        <div class="mm-box mm-box-me">
          ${playerHeader(me, me.rr, me.games)}
          <div class="mm-qte-host" id="mm-qte-mount"></div>
          <div class="mm-streak-tag" id="mm-my-streak">Streak: 0</div>
        </div>
        <div class="mm-vs" aria-hidden="true"><span class="mm-vs-line"></span><span class="mm-vs-text">VS</span><span class="mm-vs-line"></span></div>
        <div class="mm-box mm-box-opp">
          ${playerHeader(opp, opp.rr, opp.games)}
          <div class="mm-opp-view">
            <div class="mm-opp-status" id="mm-opp-status"><span class="mm-status-dot waiting"></span> Waiting…</div>
            <div class="mm-opp-streak" id="mm-opp-streak">0</div>
            <div class="mm-opp-streak-label">streak</div>
          </div>
          <div class="mm-streak-tag">&nbsp;</div>
        </div>
      </div>
      <div class="mm-overlay" id="mm-overlay" style="display:none"></div>
    </div>`;
    $('mm-leave-btn').onclick = () => { teardownMatch(true); renderHome(); };
    updatePips();
  }

  // ── QTE panel relocation ────────────────────────────────────────────────────
  let mountedQte = null, prevParent = null;
  function mountQte(qte) {
    const panel = $('qte-panel-' + qte);
    const mount = $('mm-qte-mount');
    if (!panel || !mount) return;
    prevParent = panel.parentNode;
    mount.appendChild(panel);
    panel.style.display = 'flex';
    panel.style.flex = '1';
    panel.style.flexDirection = 'column';
    mountedQte = qte;
    const hook = window['_on' + qteById(qte).hook + 'QteShow'];
    if (typeof hook === 'function') { try { hook(); } catch (_) {} }
    // Re-run the resize after layout settles so the canvas fills the (larger) box.
    requestAnimationFrame(() => { if (typeof hook === 'function') { try { hook(); } catch (_) {} } });
  }
  function unmountQte() {
    if (!mountedQte) return;
    const qte = mountedQte;
    const panel = $('qte-panel-' + qte);
    const hide = window['_on' + qteById(qte).hook + 'QteHide'];
    if (typeof hide === 'function') { try { hide(); } catch (_) {} }
    if (panel) {
      panel.style.display = 'none';
      panel.style.flex = '';
      panel.style.flexDirection = '';
      (prevParent || document.querySelector('.qte-content') || document.body).appendChild(panel);
    }
    mountedQte = null;
  }
  function beginLocalQte() {
    const q = mountedQte; if (!q) return;
    const start = $(q + '-qte-start-btn');
    const resume = $(q + '-qte-resume-btn');
    if (resume) resume.style.display = 'none';
    if (start) { start.style.display = ''; start.click(); }
    // The QTE engines ignore keypresses while a <button> is the focused element,
    // so make sure nothing button-like keeps focus after the programmatic start.
    if (document.activeElement && document.activeElement.blur) { try { document.activeElement.blur(); } catch (_) {} }
    const mount = $('mm-qte-mount');
    if (mount) { try { mount.setAttribute('tabindex', '-1'); mount.focus({ preventScroll: true }); } catch (_) {} }
  }
  function stopLocalQte() {
    const q = mountedQte; if (!q) return;
    const hide = window['_on' + qteById(q).hook + 'QteHide'];
    if (typeof hide === 'function') { try { hide(); } catch (_) {} }
  }

  // ── Round lifecycle ─────────────────────────────────────────────────────────
  function sendRoundStart() {
    roundResolved = false;
    const startedAt = Date.now();
    bcast('round-start', { round: roundNo, startedAt });
    doRoundStart(roundNo, startedAt);
  }

  function doRoundStart(round, startedAt) {
    if (window._qteGuard) window._qteGuard.reset(); // clean slate for macro detection each round
    roundNo = round; roundActive = true; roundResolved = false;
    fails = {}; streaks[me.id] = 0; streaks[opp.id] = 0; myReported = 0; lastProgressSent = 0;
    deadline = startedAt + ROUND_MS;
    $('mm-roundno').textContent = 'Round ' + roundNo;
    setMyStreak(0); setOppStreak(0);
    const myTag = $('mm-my-streak'); if (myTag) myTag.classList.remove('mm-guard-note');
    setMyStatusPlaying(); setOppStatus('playing');
    hideOverlay();
    window._qteMatch.active = true;
    beginLocalQte();
    startTimerDisplay();
    if (isBot) startBotRound();
    if (isHost) scheduleHostTimeout();
  }

  function startTimerDisplay() {
    clearInterval(timerTick);
    const upd = () => {
      const left = Math.max(0, deadline - Date.now());
      const s = Math.ceil(left / 1000);
      const el = $('mm-timer');
      if (el) { el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); el.classList.toggle('low', s <= 10); }
      if (left <= 0) clearInterval(timerTick);
    };
    upd();
    timerTick = setInterval(upd, 250);
  }

  function scheduleHostTimeout() {
    clearTimeout(hostTimeoutT);
    hostTimeoutT = setTimeout(() => { if (!roundResolved) hostAdjudicate('timeout'); }, Math.max(0, deadline - Date.now()));
  }
  function scheduleFailAdjudication() {
    if (failAdjT || roundResolved) return;
    failAdjT = setTimeout(() => { failAdjT = null; hostAdjudicate('fail'); }, FAIL_GRACE);
  }

  // A mistake CAPS a player's score (they stop scoring) but does not by itself
  // lose the round — the round is lost by whoever has the lower score. So a player
  // who slips while ahead still wins unless the opponent passes their frozen score.
  function hostAdjudicate(reason) {
    if (!isHost || roundResolved) return;
    const meDone = !!fails[me.id], oppDone = !!fails[opp.id];
    const a = streaks[me.id] | 0, b = streaks[opp.id] | 0;
    // Decide on the timer, or once both players have slipped.
    if (reason === 'timeout' || (meDone && oppDone)) { decideRound(a, b); return; }
    // One player has slipped (capped); the other is still playing. The slipped
    // player only loses once the other actually passes their score.
    if (meDone && !oppDone) { if (b > a) resolveRound(opp.id); }
    else if (oppDone && !meDone) { if (a > b) resolveRound(me.id); }
  }

  function decideRound(a, b) {
    if (a > b) resolveRound(me.id);
    else if (b > a) resolveRound(opp.id);
    else if (a === 0 && b === 0) resolveRound(Math.random() < 0.5 ? me.id : opp.id); // neither scored
    else resolveRound(null); // equal positive scores -> replay
  }

  function resolveRound(winnerId) {
    if (roundResolved) return;
    roundResolved = true;
    clearTimeout(hostTimeoutT); clearTimeout(failAdjT); failAdjT = null;
    bcast('round-result', { round: roundNo, winnerId });
    applyRoundResult(winnerId);
  }

  function applyRoundResult(winnerId) {
    roundResolved = true; roundActive = false;
    clearInterval(timerTick); clearTimeout(hostTimeoutT); clearTimeout(failAdjT); failAdjT = null;
    clearInterval(botTimer);
    if (window._qteMatch) window._qteMatch.active = false;
    stopLocalQte();
    if (winnerId) { wins[winnerId] = (wins[winnerId] | 0) + 1; updatePips(); }
    // Host records the round's scores (host is always p1) for the match history / reports.
    if (isHost && winnerId) roundLog.push({ r: roundNo, p1: streaks[me.id] | 0, p2: streaks[opp.id] | 0, w: winnerId });
    showRoundOverlay(winnerId);
    if (isHost) {
      setTimeout(() => {
        if (matchResolved) return;
        if (winnerId === null) { sendRoundStart(); return; }     // tie → replay same round
        if ((wins[me.id] | 0) >= WIN_ROUNDS || (wins[opp.id] | 0) >= WIN_ROUNDS) {
          endMatch((wins[me.id] | 0) >= WIN_ROUNDS ? me.id : opp.id);
        } else { roundNo++; sendRoundStart(); }
      }, 2600);
    }
  }

  function endMatch(winnerId) {
    if (matchResolved) return;
    matchResolved = true; roundActive = false;
    clearInterval(timerTick); clearTimeout(hostTimeoutT); clearTimeout(failAdjT); clearInterval(botTimer);
    if (window._qteMatch) window._qteMatch.active = false;
    stopLocalQte();
    if (isHost && !isBot) {
      bcast('match-result', { winnerId });
      sb.rpc('mm_apply_result', { match: matchId, winner: winnerId, p_rounds: roundLog }).then(() => refreshMyRR());
    }
    showMatchOverlay(winnerId);
  }

  async function refreshMyRR() { const r = await fetchMyRating(); me.rr = r.rr; me.games = r.games; }

  // ── Local QTE events (from window._qteMatch) ────────────────────────────────
  function onLocalReport(streak) {
    if (!roundActive) return;
    myReported = Math.max(myReported, streak | 0);
    streaks[me.id] = myReported;
    setMyStreak(myReported);
    const now = Date.now();
    if (now - lastProgressSent >= PROGRESS_MS) { lastProgressSent = now; bcast('progress', { streak: myReported }); }
    // If the opponent already slipped, my gains may now pass their capped score.
    if (isHost && fails[opp.id]) hostAdjudicate('progress');
  }
  // Macro detection fired mid-round (qte-guard.js). The guard already calls
  // _qteMatch.fail(), which forfeits the round through the normal path — this
  // hook only explains WHY in the player's own box.
  function onGuardFlag() {
    const tag = $('mm-my-streak');
    if (tag) { tag.textContent = 'Automated input detected — round forfeited'; tag.classList.add('mm-guard-note'); }
  }

  function onLocalFail() {
    if (!roundActive || fails[me.id]) return;
    fails[me.id] = Date.now();
    streaks[me.id] = myReported;
    bcast('fail', { at: fails[me.id], streak: myReported });
    setMyStatusFailed();
    if (window._qteMatch) window._qteMatch.active = false;
    stopLocalQte();
    if (isHost) scheduleFailAdjudication();
  }

  // ── Opponent events ─────────────────────────────────────────────────────────
  function onOppProgress(p) {
    if (!p) return;
    streaks[opp.id] = p.streak | 0;
    setOppStreak(p.streak | 0);
    setOppStatus('playing');
    // If I already slipped, the opponent's gains may now pass my capped score.
    if (isHost && fails[me.id]) hostAdjudicate('progress');
  }
  function onOppFail(p) {
    if (!p || fails[opp.id]) return;
    fails[opp.id] = p.at || Date.now();
    streaks[opp.id] = p.streak | 0;
    setOppStreak(p.streak | 0);
    setOppStatus('failed');
    if (isHost) scheduleFailAdjudication();
  }
  function onOppAbandon() {
    if (matchResolved) return;
    matchResolved = true;
    clearInterval(timerTick); clearTimeout(hostTimeoutT); clearTimeout(failAdjT);
    if (window._qteMatch) window._qteMatch.active = false;
    stopLocalQte();
    showMatchOverlay(me.id, 'Opponent left');
  }
  function onOppPresenceLeave() {
    if (matchResolved || !started) return;
    clearTimeout(oppGoneT);
    oppGoneT = setTimeout(() => {
      if (matchResolved) return;
      const st = matchChan && matchChan.presenceState();
      if (st && st[opp.id]) return; // came back
      matchResolved = true;
      clearInterval(timerTick); clearTimeout(hostTimeoutT); clearTimeout(failAdjT);
      if (window._qteMatch) window._qteMatch.active = false;
      stopLocalQte();
      sb.rpc('mm_apply_result', { match: matchId, winner: me.id }).then(() => refreshMyRR());
      showMatchOverlay(me.id, 'Opponent disconnected');
    }, 5000);
  }

  // ── UI updates ──────────────────────────────────────────────────────────────
  function setMyStreak(v) { const el = $('mm-my-streak'); if (el) el.textContent = 'Streak: ' + v; }
  function setOppStreak(v) { const el = $('mm-opp-streak'); if (el) el.textContent = v; }
  function setOppStatus(s) {
    const el = $('mm-opp-status'); if (!el) return;
    if (s === 'failed') el.innerHTML = '<span class="mm-status-dot failed"></span> Mistake!';
    else el.innerHTML = '<span class="mm-status-dot playing"></span> Playing';
  }
  function setMyStatusPlaying() { const b = $('mm-box-me') || document.querySelector('.mm-box-me'); if (b) b.classList.remove('failed'); }
  function setMyStatusFailed() { const b = document.querySelector('.mm-box-me'); if (b) b.classList.add('failed'); }
  function updatePips() {
    const pip = n => '●'.repeat(n) + '○'.repeat(Math.max(0, WIN_ROUNDS - n));
    const m = $('mm-pips-me'), o = $('mm-pips-opp');
    if (m) m.textContent = pip(wins[me.id] | 0);
    if (o) o.textContent = pip(wins[opp.id] | 0);
  }
  function hideOverlay() { const o = $('mm-overlay'); if (o) o.style.display = 'none'; }
  function showRoundOverlay(winnerId) {
    const o = $('mm-overlay'); if (!o) return;
    let txt, cls;
    if (winnerId === null) { txt = "Draw — replay!"; cls = 'draw'; }
    else if (winnerId === me.id) { txt = 'You won the round!'; cls = 'win'; }
    else { txt = 'You lost the round'; cls = 'lose'; }
    o.className = 'mm-overlay ' + cls;
    o.innerHTML = `<div class="mm-overlay-card"><div class="mm-overlay-big">${txt}</div></div>`;
    o.style.display = 'flex';
  }
  function showMatchOverlay(winnerId, note) {
    const o = $('mm-overlay'); if (!o) return;
    const won = winnerId === me.id;
    let rrLine = '';
    if (mode === 'ranked') rrLine = `<div class="mm-overlay-sub">${won ? 'RR gained' : 'RR adjusted'} — see your new rank in the menu.</div>`;
    o.className = 'mm-overlay ' + (won ? 'win' : 'lose');
    const canReport = opp && opp.id && opp.id !== '__bot__' && !isBot;
    o.innerHTML = `<div class="mm-overlay-card">
      <div class="mm-overlay-big">${won ? 'Victory!' : 'Defeat'}</div>
      ${note ? `<div class="mm-overlay-sub">${esc(note)}</div>` : ''}
      ${rrLine}
      <button class="mm-btn mm-btn-primary" id="mm-back-btn">Back to menu</button>
      ${canReport ? `<button class="mm-btn mm-report-btn" id="mm-report-btn">&#9873; Report opponent</button>` : ''}
    </div>`;
    o.style.display = 'flex';
    const back = $('mm-back-btn');
    if (back) back.onclick = async () => { teardownMatch(false); try { await refreshMyRR(); } catch (_) {} renderHome(); };
    const rep = $('mm-report-btn');
    if (rep && canReport) rep.onclick = () => window._openUserProfile({ userId: opp.id, username: opp.name, matchId });
  }

  // ── Teardown ────────────────────────────────────────────────────────────────
  function teardownMatch(abandon) {
    clearInterval(timerTick); clearTimeout(hostTimeoutT); clearTimeout(failAdjT); clearTimeout(oppGoneT); clearInterval(botTimer);
    if (abandon && !isBot && matchId && !matchResolved) {
      try { sb.rpc('mm_abandon_match', { match: matchId }); } catch (_) {}
      bcast('abandon', { by: me.id });
    }
    if (window._qteMatch) window._qteMatch.active = false;
    window._qteMatch = null;
    if (window._qteGuard) window._qteGuard.onFlag = null;
    unmountQte();
    if (matchChan) { try { sb.removeChannel(matchChan); } catch (_) {} matchChan = null; }
    matchId = null; isHost = false; isBot = false; opp = null; started = false; matchResolved = false;
    roundActive = false; roundResolved = false; wins = {}; streaks = {}; fails = {};
    view = 'idle';
  }

  // Re-render the Matchmaking tab when auth state changes (login/logout) so the
  // user doesn't have to switch tabs to refresh. Only acts while idle on this page.
  (function watchAuth() {
    const c = window._sbClient;
    if (!c || !c.auth || !c.auth.onAuthStateChange) { setTimeout(watchAuth, 500); return; }
    c.auth.onAuthStateChange(() => {
      const onPage = document.getElementById('page-matchmaking')?.classList.contains('active');
      if (onPage && view === 'idle') { try { window._mmLoad(); } catch (_) {} }
    });
  })();

  // Best-effort cleanup if the tab closes mid-search/match.
  window.addEventListener('beforeunload', () => {
    try {
      if (view === 'searching') sb && sb.from('mm_queue').delete().eq('user_id', me.id);
      if (view === 'match' && matchId && !matchResolved) sb && sb.rpc('mm_abandon_match', { match: matchId });
    } catch (_) {}
  });
})();
