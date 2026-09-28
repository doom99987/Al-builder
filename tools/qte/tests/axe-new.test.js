// Node test for the axe-new check (axe-new.rules.js) and trainer (axe-new.iife.js).
//   node axe-new.test.js [honestRuns]
// a) honest simulation: a frame-by-frame model of the axe-new IIFE driven by
//    simulated players (30-240 Hz, long tasks, ping, panel and tab pauses,
//    mobile, coarse clocks, resets); every log, and the log at every new high,
//    must check out at its own score.
// b) hand-built real-player cases the simulation meets only by chance.
// c) forgeries: each must be invalid, held for review, or score far below.
// d) the REAL IIFE in a stub DOM with a virtual clock, played from its own log.
// Exit code 1 on any failure.
'use strict';
require('./_paths.js');
const path = require('path');
const Q = require(path.join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const A = Q.trainers['axe-new'];
if (!A || typeof A.check !== 'function') { console.log('FAIL axe-new rules not registered'); process.exit(1); }

let failures = 0;
function fail(msg) { failures++; console.log('FAIL ' + msg); }

// ── seeded randomness ─────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mkNormal(R) {
  return function () {
    let u = 0, v = 0;
    while (u === 0) u = R();
    while (v === 0) v = R();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}
const lerp = (a, b, s) => a + (b - a) * s;
const r4 = x => Math.round(x * 1e4) / 1e4;

// ── players ───────────────────────────────────────────────────────────────────
// skill 0 = new, 1 = top of the board.
function humanPlayer(R, skill) {
  const N = mkNormal(R);
  return {
    kind: 'human',
    rtMed: lerp(330, 210, skill) + (R() - 0.5) * 40,
    rtSig: lerp(0.3, 0.15, R()),
    sigma0: lerp(220, 35, skill) * lerp(0.85, 1.2, R()),   // ms, timing the first tap of the burst
    weber: lerp(0.06, 0.02, skill),                         // ...growing with how far ahead it is timed
    aimSd: lerp(0.5, 0.18, skill),                          // x zone half-width
    miscount: lerp(0.06, 0.004, skill),
    tapMu: lerp(75, 160, R()),                              // ms between taps in a burst
    tapMin: lerp(95, 60, skill),                            // fastest tapping when a round is short
    tapCv: lerp(0.04, 0.2, R()),
    marginLo: lerp(100, 250, R()), marginHi: lerp(300, 650, R()),
    // 'burst': wait for an empty bar, then time n taps to land on the zone;
    // 'pump': tap the count that lands nearest right away (no timing).
    style: R() < lerp(0.5, 0.05, skill) ? 'pump' : 'burst',
    look: lerp(0.15, 0.7, R()),             // a last look near the end (and a correcting tap)
    warm: R() < 0.2 ? R() * 0.4 : 0,        // chance of a habit tap at the round start
    gap: R() < 0.25 ? R() * 0.5 : 0,        // chance of tapping during the 700 ms wait
    adapt: lerp(0.5, 1, R()),               // how much of the ping the player allows for
    jitterMs: 2,                            // input dispatch jitter
    // Some players learn the fixed 700 ms wait and tap as the next round
    // starts (anticipation, no reaction): first tap ~R + off, SD sd.
    antic: R() < 0.15 ? { off: lerp(-20, 80, R()), sd: lerp(20, 60, R()) } : null,
    N,
  };
}

// ── the client model (mirrors axe-new.iife.js) ────────────────────────────────
function simRun(cfg) {
  const R = cfg.rng, N = mkNormal(R);
  const comp = !!cfg.comp, ping = cfg.ping | 0, Pd = 1000 / cfg.hz;
  const pl = cfg.player;
  const zr = cfg.zoneRand || R;
  const q = []; let seq = 0;
  function push(t, type, d) { q.push({ t, s: seq++, type, d }); }
  function pop() {
    let bi = 0;
    for (let i = 1; i < q.length; i++) if (q[i].t < q[bi].t || (q[i].t === q[bi].t && q[i].s < q[bi].s)) bi = i;
    return q.splice(bi, 1)[0];
  }
  // main-thread stalls: 'busy' (a long task: frames and inputs wait) or
  // 'sleep' (the machine stopped with no visibilitychange: no frames, no player)
  const stalls = [];
  function inStall(t) { for (const s of stalls) if (t >= s.a && t < s.b) return s; return null; }
  function addStall(a, len, sleep) {
    const last = stalls.length ? stalls[stalls.length - 1].b : 0;
    if (a <= last) return;
    stalls.push({ a, b: a + len, sleep });
    if (sleep) push(a + len + reaction(), 'plan', { why: 'back' });
  }

  // coarse clock: performance.now() (and rAF stamps) floored to clockQ ms
  const CQ = cfg.clockQ || 0;
  const pn = x => CQ ? Math.floor(x / CQ) * CQ : x;
  const T0 = pn(1000 + R() * 5000);
  const type = 'axe-new' + (comp ? '-comp' : '');
  const log = { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: 1280, h: 720, mob: !!cfg.mobile, ping }, ev: [] };
  let closed = false;
  function logEv(x, code, ...f) {
    if (closed || log.ev.length >= Q.LIMITS.MAX_EVENTS) return;
    const e = [code, Math.max(0, Math.round(pn(x) - T0))];
    for (const v of f) e.push(typeof v === 'number' ? Math.round(v * 10000) / 10000 : v);
    log.ev.push(e);
  }

  let running = false, gameStarted = false, paused = false, live = false, gapPaused = false;
  let streak = 0, fill = 0, lastTime = 0, roundEndTime = 0, pauseRem = 0, zoneMin = 0, zoneMax = 0;
  let gapEndAt = 0, gapLeft = 0;
  let rafId = 0, gapId = 0, planId = 0, rounds = 0, done = false, inflight = 0;
  const snaps = [];          // log length at each new high (each is a mid-run submit)
  const cancelAt = {};
  const src = cfg.mobile ? (R() < 0.5 ? 't' : 'b') : 'k';
  const lag = src === 'k' ? ping : 0;       // the ping simulator delays keys only

  function requestFrame(X, sameFrameOK) {
    let stamp, exec;
    if (sameFrameOK && R() < 0.3) {
      // the frame already queued when the handler ran: its stamp is older than
      // lastTime (dt < 0, clamped to 0) - by part of a frame, or under jank by
      // a long task, in which case taps can be handled before that frame runs
      const jank = R() < 0.1;
      stamp = jank ? X - 20 - R() * 280 : Math.floor(X / Pd) * Pd;
      exec = jank && R() < 0.5 ? X + 250 + R() * 400 : X + 0.1 + R() * 0.9;
    } else {
      stamp = (Math.floor(X / Pd) + 1) * Pd;
      if (R() < cfg.dropRate) stamp += Pd * (1 + Math.floor(R() * 3));
      exec = stamp + R() * 1.5;
    }
    rafId++; push(exec, 'frame', { id: rafId, stamp });
  }
  function cancelFrame() { rafId++; }

  function startRound(X, why) {
    fill = 0;
    const z = A.zone(A.C_MIN + zr() * A.C_SPAN, A.size(streak, comp));
    zoneMin = z[0]; zoneMax = z[1];
    const dur = A.timer(streak, comp) * 1000;
    logEv(X, 'R', streak, zoneMin, zoneMax, why);     // logged first, then the clock is read
    roundEndTime = pn(X + 0.002) + dur;
    live = true;
    rounds++;
    // things that may happen in this round
    if (R() < cfg.stallRate) addStall(X + R() * (dur + 300), R() < 0.1 ? 500 + R() * 2000 : 40 + R() * 460, false);
    if (cfg.sleepRate && R() < cfg.sleepRate) addStall(X + R() * dur, 5000 + R() * 115000, true);
    const pauses = R() < cfg.pauseRate ? (R() < 0.3 ? 2 : 1) : 0;
    for (let p = 0; p < pauses; p++) {
      // the panel or the browser tab hidden (the IIFE pauses either way)
      const h = X + R() * (dur + 700);
      push(h, 'hide', {});
      // some come straight back (tab away and back, Resume) inside the 700 ms wait
      push(h + (R() < 0.3 ? 250 + R() * 500 : 300 + R() * 20000), 'resume', {});
    }
    if (cfg.resetRate && R() < cfg.resetRate) push(X + R() * dur, 'reset', {});
    push(X + reaction(), 'plan', { why: 'round' });
  }
  function reaction() {
    if (pl.reactMs != null) return pl.reactMs;
    return pl.rtMed * Math.exp(pl.rtSig * N());
  }

  function evaluate(X) {
    const inZone = fill >= zoneMin && fill <= zoneMax;
    live = false;
    logEv(X, 'J', fill, inZone ? 1 : 0);
    if (!inZone) {
      logEv(X, 'E', fill < zoneMin ? 'low' : 'high');
      running = paused = false; closed = true; done = true;
      return;
    }
    streak++;
    snaps.push(log.ev.length);
    if (streak >= cfg.maxRounds) { done = true; return; }
    armGap(X + 0.5, A.GAP_MS);
    if (pl.gap && R() < pl.gap) {
      const k = 1 + Math.floor(R() * 3);
      for (let i = 0; i < k; i++) press(X + 100 + R() * 590, -1);
    }
    if (pl.antic) press(X + A.GAP_MS + pl.antic.off + pl.antic.sd * N() - pl.adapt * lag, -1);
  }
  function armGap(X, ms) {
    gapEndAt = pn(X) + ms;
    const late = R() < 0.05 ? R() * 100 : R() * 4;
    gapId++; push(X + ms + late, 'gap', { id: gapId });
  }

  function press(phys, plan) {
    inflight++;
    const d = lag > 0 ? phys + lag + R() * 4 + (R() < 0.03 ? R() * 60 : 0) : phys + R() * pl.jitterMs;
    push(d, 'input', { phys, plan });
    // a worn key switch (or a double touch): a second tap right after
    if (cfg.chatter && R() < cfg.chatter) push(d + 4 + R() * 25, 'input', { phys, plan, bounce: true });
  }

  // The player looks at the bar at time Tp and plans the rest of the round.
  function plan(Tp) {
    if (!running || paused || !live) return;
    const myPlan = ++planId;
    const Tend = roundEndTime;                        // the player reads the timer bar
    const c = (zoneMin + zoneMax) / 2, half = (zoneMax - zoneMin) / 2;
    const g = c + N() * pl.aimSd * half;
    const Lg = lag * pl.adapt;                        // the input delay the player allows for
    const E0 = Tp + lag;                               // earliest delivery
    let f0 = fill, mu = pl.tapMu;
    const margin = lerp(pl.marginLo, pl.marginHi, R());
    const times = [];
    if (pl.warm && R() < pl.warm) { times.push(Tp); f0 = Math.min(1, f0 + A.PRESS); }
    const tz = E0 + f0 / A.DRAIN * 1000;               // the bar is empty by then
    function burst(muX, marginX) {                     // n taps from an empty bar, landing on g at the end
      for (let n = 1; n <= 12; n++) {
        const tau = (A.PRESS * n - g) / A.DRAIN * 1000;
        if (tau < (n - 1) * muX * 1.15 + marginX) continue;
        if (Tend - tau < Math.max(E0 + (times.length ? muX : 0), tz)) return null;
        return { n, tau, d1: Tend - tau };
      }
      return null;
    }
    let p = null;
    if (pl.style === 'burst') {
      p = burst(mu, margin);
      if (!p) { mu = Math.max(pl.tapMin, mu * 0.7); p = burst(mu, 60 + R() * 60); }   // short round: hurry
    }
    if (p) {
      const sd = pl.sigma0 + pl.weber * p.tau;
      let phys = p.d1 - Lg + N() * sd;
      const floorT = Tp + (times.length ? 60 : 0);
      if (phys < floorT) phys = floorT;
      let n = p.n;
      if (R() < pl.miscount) n += R() < 0.5 ? -1 : 1;
      let tt = phys;
      for (let i = 0; i < n; i++) { times.push(tt); tt += Math.max(35, mu * (1 + pl.tapCv * N())); }
    } else {
      // No room for a timed burst (or a pumper): tap the count that ends nearest g, now.
      mu = Math.max(pl.tapMin, mu * (pl.style === 'pump' ? 1 : 0.75));
      const d0 = E0 + (times.length ? mu : 0);
      const fAt = Math.max(0, f0 - A.DRAIN * (d0 - E0) / 1000);
      let n = Math.max(0, Math.round((g - fAt + A.DRAIN * (Tend - d0) / 1000) / A.PRESS));
      if (R() < pl.miscount) n += R() < 0.5 ? -1 : 1;
      let tt = Math.max(Tp, d0 - lag + 20 * N());
      for (let i = 0; i < n; i++) { times.push(tt); tt += Math.max(35, mu * (1 + pl.tapCv * N())); }
    }
    for (const t of times) press(t, myPlan);
    if (R() < pl.look) push(Math.max(Tp + 50, Tend - lerp(250, 700, R())), 'look', { plan: myPlan });
  }
  // A last look: the bar will end below the zone and one more tap lands closer.
  function look(X, planNo) {
    if (!running || paused || !live || inflight > 0 || cancelAt[planNo] !== undefined) return;
    const proj = Math.max(0, fill - A.DRAIN * Math.max(0, roundEndTime - X) / 1000);
    const c = (zoneMin + zoneMax) / 2;
    if (proj < zoneMin && Math.abs(proj + A.PRESS - c) < Math.abs(proj - c)) press(X + 80 + R() * 80 - pl.adapt * lag * 0.5, planNo);
  }

  function cancelPlans(H) { for (let i = 1; i <= planId; i++) if (cancelAt[i] === undefined) cancelAt[i] = H; }

  // ── start ──
  running = gameStarted = true; paused = false; fill = 0;
  lastTime = T0;
  startRound(T0 + 0.05, 's');
  requestFrame(T0 + 0.1, true);

  let guard = 0;
  while (q.length && !done) {
    if (++guard > 5e6) throw new Error('sim runaway');
    const e = pop();
    const X = e.t;
    const st = inStall(X);
    if (st) {
      if (e.type === 'frame') { const s2 = Math.ceil(st.b / Pd) * Pd; push(s2 + R() * 1.5, 'frame', { id: e.d.id, stamp: s2 }); continue; }
      if (e.type === 'input') { if (st.sleep) { if (!e.d.bounce) inflight--; continue; } push(st.b + 0.01, 'input', e.d); continue; }
      if (e.type === 'gap') { push(st.b + R() * 5, 'gap', e.d); continue; }
      if (e.type === 'plan' || e.type === 'look') { if (!st.sleep) push(st.b + 1, e.type, e.d); continue; }
      if (e.type === 'hide' || e.type === 'resume' || e.type === 'reset') { push(st.b + 1 + R() * 50, e.type, e.d); continue; }
    }
    if (e.type === 'frame') {
      if (e.d.id !== rafId || !running) continue;
      const sq = pn(e.d.stamp);
      const upTo = Math.min(sq, roundEndTime);
      const dt = Math.min(Math.max(0, upTo - lastTime) / 1000, A.DT_MAX);
      if (upTo > lastTime) lastTime = upTo;
      fill = Math.max(0, fill - A.DRAIN * dt);
      if (sq >= roundEndTime) { evaluate(X); continue; }
      requestFrame(X, false);
    } else if (e.type === 'gap') {
      if (e.d.id !== gapId) continue;
      if (running) { startRound(X, 'n'); lastTime = pn(X + 0.02); requestFrame(X + 0.03, true); }
    } else if (e.type === 'input') {
      if (!e.d.bounce) inflight--;
      if (e.d.plan > 0 && cancelAt[e.d.plan] !== undefined && e.d.phys >= cancelAt[e.d.plan]) continue;
      if (!running || paused) continue;
      if (!live) { logEv(X, 'G'); continue; }
      fill = Math.min(1, fill + A.PRESS);
      logEv(X, 'K', fill, src);
    } else if (e.type === 'plan') {
      plan(X);
    } else if (e.type === 'look') {
      look(X, e.d.plan);
    } else if (e.type === 'hide') {
      if (paused || !running) continue;
      cancelFrame(); running = false; paused = true;
      pauseRem = Math.max(0, roundEndTime - pn(X));
      if (!live) { gapPaused = true; gapLeft = Math.max(0, gapEndAt - pn(X)); gapId++; }
      logEv(X + 0.002, 'P');                              // logged after the clock is read
      cancelPlans(X);
    } else if (e.type === 'resume') {
      if (!paused) continue;
      logEv(X, 'U');                                      // logged before the clock is read
      paused = false; running = true; lastTime = pn(X + 0.002);
      roundEndTime = pn(X + 0.002) + pauseRem;
      if (gapPaused) { gapPaused = false; armGap(X + 0.003, gapLeft); }
      else { push(X + reaction(), 'plan', { why: 'resume' }); requestFrame(X + 0.04, true); }
    } else if (e.type === 'reset') {
      if (gameStarted && (running || paused)) { logEv(X, 'E', 'x'); closed = true; }
      done = true;
    }
  }
  return { log, streak, rounds, snaps };
}

// ── a) honest simulation ──────────────────────────────────────────────────────
function honestSuite(RUNS) {
  const MIXED = Math.round(RUNS * 0.7), LONG = Math.round(RUNS * 0.2), PAUSY = RUNS - MIXED - LONG;
  const R = mulberry32(20260928);
  let invalid = 0, review = 0, mismatch = 0, snapBad = 0, totalHits = 0, maxHits = 0, events = 0, maxEv = 0, long20 = 0;
  let bytesPerRound = 0, maxBytes = 0, anticRuns = 0, sleeps = 0, pausesLogged = 0, gapTaps = 0;
  const reasons = {};
  const buckets = { new: 0, mid: 0, good: 0, top: 0 };
  // how close honest runs come to each person check
  const edge = { offSd: Infinity, ivSd: Infinity, zonesP: 1, drainEff: Infinity, lateShare: 0, lateHits: 0, lateMaxMs: 0 };
  for (let i = 0; i < RUNS; i++) {
    const kind = i < MIXED ? 'mixed' : i < MIXED + LONG ? 'long' : 'pausy';
    const bucket = kind === 'mixed' ? ['new', 'mid', 'good', 'top'][i % 4] : 'top';
    const skill = kind === 'mixed' ? { new: 0.05, mid: 0.4, good: 0.7, top: 0.95 }[bucket] + (R() - 0.5) * 0.1 : 0.85 + R() * 0.15;
    const cfg = {
      rng: mulberry32(1000 + i),
      comp: kind === 'long' ? R() < 0.3 : R() < 0.5,
      ping: [0, 0, 150, 300][Math.floor(R() * 4)],
      hz: [30, 60, 60, 60, 120, 144, 240][Math.floor(R() * 7)],
      mobile: R() < 0.25,
      dropRate: 0.005 + R() * 0.05,
      stallRate: R() < 0.5 ? 0.02 : 0.12,
      sleepRate: R() < 0.1 ? 0.01 : 0,
      pauseRate: kind === 'pausy' ? 0.2 + R() * 0.3 : R() < 0.5 ? 0.01 : 0.06,
      resetRate: R() < 0.05 ? 0.02 : 0,
      chatter: R() < 0.1 ? R() * 0.3 : 0,
      maxRounds: kind === 'long' ? 400 : R() < 0.8 ? 150 : 40,
      clockQ: (() => { const c = R(); return c < 0.05 ? 1000 / 60 : c < 0.08 ? 100 : 0; })(),
    };
    cfg.player = humanPlayer(mulberry32(5000 + i), Math.max(0, Math.min(1, skill)));
    const sim = simRun(cfg);
    if (kind === 'mixed') buckets[bucket] += sim.streak;
    if (sim.streak >= 20) long20++;
    totalHits += sim.streak; maxHits = Math.max(maxHits, sim.streak);
    events += sim.log.ev.length; maxEv = Math.max(maxEv, sim.log.ev.length);
    if (cfg.sleepRate) sleeps++;
    for (const e of sim.log.ev) { if (e[0] === 'P') pausesLogged++; else if (e[0] === 'G') gapTaps++; }
    const r = Q.check(sim.log.type, sim.log, { platform: cfg.mobile ? 'M' : 'C', claimed: sim.streak });
    const st = r.stats;
    if (st.hits >= A.PERSON.ACC_MIN_N && st.offSdMs != null) edge.offSd = Math.min(edge.offSd, st.offSdMs);
    if (st.tapIvSdMs != null && st.presses >= 60 && !st.coarseClock) edge.ivSd = Math.min(edge.ivSd, st.tapIvSdMs);
    if (st.coarseClock) edge.coarse = (edge.coarse || 0) + 1;
    { const cs = sim.log.ev.filter(e => e[0] === 'R').map(e => ((e[3] + e[4]) / 2 - A.C_MIN) / A.C_SPAN);
      if (cs.length >= A.PERSON.KS_MIN_N) edge.zonesP = Math.min(edge.zonesP, Q.stats.ksUniform(cs).p); }
    if (st.drainEff != null && st.drainS >= A.PERSON.DRAIN_MIN_S) edge.drainEff = Math.min(edge.drainEff, st.drainEff);
    if (st.lateHits) { edge.lateHits = Math.max(edge.lateHits, st.lateHits); if (st.hits >= 10) edge.lateShare = Math.max(edge.lateShare, st.lateHits / st.hits); }
    if (st.lateMaxMs != null) edge.lateMaxMs = Math.max(edge.lateMaxMs, st.lateMaxMs);
    if (r.verdict === 'invalid') {
      invalid++;
      if (invalid <= 5) console.log('  honest invalid #' + i, r.reasons.join(' | '), JSON.stringify(cfg, (k, v) => (k === 'rng' || k === 'player' || k === 'N') ? undefined : v));
    } else if (r.verdict === 'review') {
      review++;
      const k = r.reasons[0].replace(/[0-9.e+-]+/g, '#');
      reasons[k] = (reasons[k] || 0) + 1;
      if (review <= 5) console.log('  honest review #' + i, r.reasons.join(' | '), JSON.stringify(r.stats));
    }
    if (r.verdict !== 'invalid' && r.score !== sim.streak) {
      mismatch++;
      if (mismatch <= 5) console.log('  honest mismatch #' + i, r.score, sim.streak);
    }
    // the mid-run submits: the log as it was at each new high (every one for
    // one run in ten, else the last) must check out at that score
    const which = i % 10 === 0 ? sim.snaps.map((n, j) => j) : (sim.snaps.length ? [sim.snaps.length - 1] : []);
    for (const j of which) {
      const snap = { v: 1, rv: sim.log.rv, type: sim.log.type, a: 0, env: sim.log.env, ev: sim.log.ev.slice(0, sim.snaps[j]) };
      const r2 = Q.check(snap.type, snap, { platform: 'C', claimed: j + 1 });
      if (r2.verdict === 'invalid' || r2.score !== j + 1) {
        snapBad++;
        if (snapBad <= 3) console.log('  snapshot bad #' + i + ' at ' + (j + 1), r2.verdict, r2.score, r2.reasons.join(' | '));
      }
    }
    const bytes = JSON.stringify(sim.log).length;
    if (sim.rounds) bytesPerRound = Math.max(bytesPerRound, bytes / sim.rounds);
    maxBytes = Math.max(maxBytes, bytes);
    if (cfg.player.antic) anticRuns++;
  }
  const revRate = review / RUNS;
  console.log(`honest: ${RUNS} runs (${MIXED} mixed, ${LONG} long top-player, ${PAUSY} pause-heavy), invalid ${invalid}, review ${review} (${(revRate * 100).toFixed(2)}%), score mismatch ${mismatch}, snapshot failures ${snapBad}; ` +
    `hits mean ${(totalHits / RUNS).toFixed(1)} max ${maxHits}, ${long20} runs >= 20 hits (mixed runs by skill new/mid/good/top: ${(buckets.new / (MIXED / 4)).toFixed(1)}/${(buckets.mid / (MIXED / 4)).toFixed(1)}/${(buckets.good / (MIXED / 4)).toFixed(1)}/${(buckets.top / (MIXED / 4)).toFixed(1)}); ` +
    `events mean ${(events / RUNS).toFixed(0)} max ${maxEv}`);
  console.log(`  closest honest runs came to review: offset SD ${edge.offSd.toFixed(1)} ms (review < ${A.PERSON.ACC_MAX_SD_MS}), tap SD ${edge.ivSd.toFixed(1)} ms (< ${A.PERSON.STEADY_MAX_SD_MS}), ` +
    `zones p ${edge.zonesP.toExponential(1)} (< ${A.PERSON.KS_ALPHA}), drain ${edge.drainEff.toFixed(2)} (< ${A.PERSON.DRAIN_MIN_EFF}), ` +
    `late hits max ${edge.lateHits} / share ${edge.lateShare.toFixed(2)} (>= ${A.PERSON.LATE_MIN_N} and ${A.PERSON.LATE_SHARE}), latest judgement ${edge.lateMaxMs.toFixed(0)} ms after the timer`);
  console.log(`  ${anticRuns} runs by anticipating players, ${sleeps} with machine sleeps, ${edge.coarse || 0} logs on a 100 ms clock (no metronome check), ${pausesLogged} pauses and ${gapTaps} gap taps logged; log size max ${maxBytes} bytes, max ${bytesPerRound.toFixed(0)} bytes per round`);
  if (Object.keys(reasons).length) console.log('  review reasons:', JSON.stringify(reasons));
  if (invalid) fail('honest runs rejected: ' + invalid);
  if (mismatch) fail('honest score mismatches: ' + mismatch);
  if (snapBad) fail('honest mid-run snapshots failed: ' + snapBad);
  if (revRate > 0.001) fail('honest review rate ' + (revRate * 100).toFixed(2) + '% > 0.1%');
  return { runs: RUNS, invalid, review, mismatch };
}

// ── a2) hand-built logs ──────────────────────────────────────────────────────
// A careful forger's log: legal events, exact drain, human-looking noise.
// Options: rounds, comp, seed, centre(k,R), aimSd (x half-width), timeSd (ms),
// iv(R) tap spacing, durScale (<1 cuts rounds short), pausePairs (zero-length
// P/U after each R), gapPause (P/U right after each hit), gapMs (hit -> next R),
// forceHit, late(k) (judged that many ms after the timer, bar frozen since
// freeze(k) ms before it).
function forgeLog(o) {
  const R = mulberry32(o.seed || 1), N = mkNormal(R);
  const comp = !!o.comp, type = 'axe-new' + (comp ? '-comp' : '');
  const ev = []; let t = 0, hits = 0;
  const aimSd = o.aimSd != null ? o.aimSd : 0.25, timeSd = o.timeSd != null ? o.timeSd : 60;
  const iv = o.iv || (() => Math.max(55, 115 + 20 * N()));
  for (let k = 0; k < o.rounds; k++) {
    const sz = A.size(k, comp), dur = A.timer(k, comp) * 1000 * (o.durScale || 1);
    const rT = t, tEnd = rT + dur;
    const lateMs = o.late ? o.late(k) : 0, frz = o.freeze ? o.freeze(k) : 0;
    const tStop = tEnd - frz;                           // the bar drains until here
    const z = A.zone(o.centre ? o.centre(k, R) : A.C_MIN + R() * A.C_SPAN, sz);
    const zMin = z[0], zMax = z[1], c = (zMin + zMax) / 2;
    ev.push(['R', rT, k, r4(zMin), r4(zMax), k ? 'n' : 's']);
    if (o.pausePairs) for (let p = 0; p < o.pausePairs; p++) ev.push(['P', t], ['U', t]);
    let g = c + aimSd * (sz / 2) * N();
    if (o.forceHit) g = Math.min(zMax - 0.006, Math.max(zMin + 0.006, g));
    // a timed burst from an empty bar if it fits, else taps at once and a
    // slower drain (legal: frames can run late) to land on g
    let n = 0, gaps = [], t1 = 0, u = 1;
    for (let m = 1; m <= 12; m++) {
      const gs = []; for (let i = 0; i < m - 1; i++) gs.push(iv(R));
      const span = gs.reduce((a, b) => a + b, 0), tau = (A.PRESS * m - g) / A.DRAIN * 1000;
      if (tau < span + 150) continue;
      if (tStop - tau >= rT + 250) { n = m; gaps = gs; t1 = tStop - tau; }
      break;
    }
    if (n) {
      let noise = timeSd ? timeSd * N() : 0;
      if (o.forceHit) noise = Math.max(-40, Math.min(40, noise));
      t1 = Math.max(rT + 250, Math.round(t1 + noise));
    } else {
      n = Math.max(1, Math.ceil(g / A.PRESS)); gaps = []; for (let i = 0; i < n - 1; i++) gaps.push(iv(R));
      t1 = rT + 250;
      u = Math.max(0, Math.min(1, (A.PRESS * n - g) / (A.DRAIN * (tStop - t1) / 1000)));
    }
    let tt = t1, f = 0, lastT = t1;
    for (let i = 0; i < n; i++) {
      if (i > 0) { tt = Math.round(tt + gaps[i - 1]); f = Math.max(0, f - u * A.DRAIN * (tt - lastT) / 1000); }
      f = Math.min(1, f + A.PRESS); lastT = tt;
      ev.push(['K', tt, r4(f), 'k']);
    }
    const tJ = Math.max(Math.round(tEnd), lastT) + (lateMs ? Math.round(lateMs) : Math.floor(R() * 16));
    const fj = Math.max(0, f - u * A.DRAIN * Math.max(0, tStop - lastT) / 1000);
    const fr = r4(fj), hit = fr >= r4(zMin) && fr <= r4(zMax);
    ev.push(['J', tJ, fr, hit ? 1 : 0]);
    if (!hit) { ev.push(['E', tJ, fr <= r4(zMin) ? 'low' : 'high']); break; }
    hits++;
    if (o.gapPause) ev.push(['P', tJ + 1], ['U', tJ + 1]);
    t = tJ + (o.gapMs != null ? o.gapMs : A.GAP_MS + Math.floor(R() * 5));
  }
  return { log: { v: 1, rv: 1, type, a: 0, env: { w: 1280, h: 720, mob: false, ping: 0 }, ev }, hits };
}
const mkLog = (ev, type) => ({ v: 1, rv: 1, type: type || 'axe-new', a: 0, env: { w: 1280, h: 720, mob: false, ping: 0 }, ev });
// taps n at t0 + 100 ms each, each after the full drain since the last: [K...] and the last fill
function tapsAt(t0, n, step) {
  const ev = []; let f = 0; step = step || 100;
  for (let i = 0; i < n; i++) { f = i ? f - A.DRAIN * step / 1000 + A.PRESS : A.PRESS; ev.push(['K', t0 + step * i, r4(f), 'k']); }
  return { ev, f, tLast: t0 + step * (n - 1) };
}

// Real-player cases the simulation reaches only by chance, built by hand.
function safetySuite() {
  let n = 0;
  function must(name, log, claimed, want) {
    n++;
    const r = Q.check(log.type, log, { platform: 'C', claimed });
    const ok = r.verdict === 'valid' && r.score === want;
    console.log('  safety: ' + name + ' -> ' + r.verdict + ' ' + r.score + (r.reasons[0] ? ' (' + r.reasons[0].slice(0, 90) + ')' : ''));
    if (!ok) fail('real-player case rejected: ' + name + ' -> ' + r.verdict + ' ' + r.score + ' (want valid ' + want + ') ' + r.reasons.join(' | '));
  }
  // A tap handled during a long task, before the first frame of the round
  // runs (that frame is stamped before the round start: dt clamped to 0).
  { const b = tapsAt(20, 7);
    const fj = r4(b.f - A.DRAIN * (2600 - b.tLast) / 1000);
    must('taps before a janked first frame', mkLog([['R', 0, 0, r4(fj - 0.08), r4(fj + 0.1), 's']].concat(b.ev, [['J', 2605, fj, 1]])), 1, 1); }
  // Paused in the wait and straight back: the rest of the wait runs.
  { const g = forgeLog({ seed: 50, rounds: 2, forceHit: true }).log; const j = g.ev.findIndex(e => e[0] === 'J'); const h = g.ev[j][1];
    const ev = g.ev.slice(0, j + 1).concat([['P', h + 100], ['U', h + 450]]);
    const shift = (h + 450 + 600) - g.ev[j + 1][1];
    for (const e of g.ev.slice(j + 1)) ev.push([e[0], e[1] + shift].concat(e.slice(2)));
    const hits = g.ev.filter(e => e[0] === 'J' && e[3] === 1).length;
    must('pause 100 ms into the wait, Resume 350 ms later', mkLog(ev), hits, hits); }
  // Reset (Start clicked by matchmaking) while paused in the wait.
  { const g = forgeLog({ seed: 51, rounds: 1, forceHit: true }).log; const h = g.ev[g.ev.length - 1][1];
    must('reset while paused between rounds', mkLog(g.ev.concat([['P', h + 100], ['E', h + 5000, 'x']])), 1, 1); }
  // Five pauses in one round (panel and tab), each resumed, judged 110 ms early (coarse clock).
  { const ev = [['R', 0, 0, 0, 0, 's']]; let t = 0;
    for (let p = 0; p < 5; p++) { ev.push(['P', t + 100], ['U', t + 5100]); t += 5100; }
    // unpaused: 500 ms between the pauses, then taps from +600, judged at 2600 - 110
    const b = tapsAt(t + 600, 6);
    const fj = r4(b.f - A.DRAIN * (t + 2600 - 500 - 110 - b.tLast) / 1000);
    ev[0] = ['R', 0, 0, r4(fj - 0.08), r4(fj + 0.1), 's'];
    must('five pauses in one round, judged 110 ms early (coarse clock)', mkLog(ev.concat(b.ev, [['J', t + 2600 - 500 - 110, fj, 1]])), 1, 1); }
  // A long task (2 s) across the timer's end: the bar froze in the zone, a tap
  // queued behind the task is handled before the judging frame.
  { const b = tapsAt(1000, 5);
    const fStall = b.f - A.DRAIN * (2200 - b.tLast) / 1000;              // frames stop at 2200
    const fTap = r4(fStall - 0.005 + A.PRESS);                             // the queued tap, after one clamped frame's worth
    const ev = [['R', 0, 0, r4(fTap - 0.1), r4(fTap + 0.08), 's']].concat(b.ev, [['K', 4200, fTap, 'k'], ['J', 4201, fTap, 1]]);
    must('tap handled 1.6 s after the timer, before the judging frame (long task)', mkLog(ev), 1, 1); }
  // The machine slept for a minute mid-round with no visibilitychange (no
  // frames, no pause): the bar froze in the zone, judged a minute late.
  { const g = forgeLog({ seed: 52, rounds: 25, forceHit: true, late: k => k === 3 ? 60000 : 0, freeze: k => k === 3 ? 400 : 0 });
    must('machine asleep a minute mid-round, bar frozen in the zone', g.log, 25, 25); }
  // Three rounds judged late behind long stalls in a 25-point run (under the review line).
  { const g = forgeLog({ seed: 55, rounds: 25, forceHit: true, late: k => (k % 8 === 4) ? 900 : 0, freeze: k => (k % 8 === 4) ? 300 : 0 });
    must('three hits judged ~0.9 s late behind stalls', g.log, 25, 25); }
  // A run so long run.ev stopped at MAX_EVENTS; each later high still submits.
  { const g = forgeLog({ seed: 53, rounds: 2600, forceHit: true });
    const l = g.log; l.ev = l.ev.slice(0, Q.LIMITS.MAX_EVENTS);
    const proven = l.ev.filter(e => e[0] === 'J' && e[3] === 1).length;
    must('log cut at MAX_EVENTS, higher claim', l, g.hits, proven);
    console.log('    (' + proven + ' of ' + g.hits + ' points in the first ' + Q.LIMITS.MAX_EVENTS + ' events; ' + JSON.stringify(l).length + ' bytes)'); }
  // A bar tapped to the cap (1.0) and drained into a high zone.
  { const ev = [['R', 0, 0, 0.84, 0.94, 's']]; let f = 0;
    for (let i = 0; i < 10; i++) { f = Math.min(1, i ? f - A.DRAIN * 0.08 + A.PRESS : A.PRESS); ev.push(['K', 300 + 80 * i, r4(f), 'k']); }
    const fj = r4(f - A.DRAIN * (2600 - 1020) / 1000);
    ev[0] = ['R', 0, 0, r4(fj - 0.12), r4(fj + 0.06), 's'];
    must('tapped to the cap, drained into the zone', mkLog(ev.concat([['J', 2610, fj, 1]])), 1, 1); }
  return n;
}

// ── b) forgeries ──────────────────────────────────────────────────────────────
function clone(log) { return JSON.parse(JSON.stringify(log)); }
function goodLong(seed, extra, minHits) {
  // a strong honest player's long run to forge from
  for (let s = seed; s < seed + 400; s++) {
    const cfg = Object.assign({ rng: mulberry32(s), comp: false, ping: 0, hz: 60, mobile: false, dropRate: 0.01, stallRate: 0, pauseRate: 0, maxRounds: 40 }, extra || {});
    cfg.player = cfg.player || humanPlayer(mulberry32(s + 7), 0.95);
    const sim = simRun(cfg);
    if (sim.streak >= (minHits || 30)) return sim;
  }
  throw new Error('no long honest run');
}
function forgerySuite() {
  const results = [];
  function expect(name, log, claimed, env) {
    const r = Q.check(log.type, log, Object.assign({ platform: 'C', claimed }, env || {}));
    const ok = r.verdict === 'invalid' || r.verdict === 'review' || r.score <= claimed / 2;
    results.push({ name, verdict: r.verdict + (r.verdict === 'valid' ? ' score ' + r.score : ''), reason: r.reasons[0] || '' });
    if (!ok) fail('forgery accepted: ' + name + ' -> ' + r.verdict + ' ' + r.score + ' ' + JSON.stringify(r.stats));
    return r;
  }
  const base = goodLong(777);
  const baseR = Q.check(base.log.type, base.log, { platform: 'C', claimed: base.streak });
  if (baseR.verdict !== 'valid') fail('forgery base run is not valid: ' + baseR.reasons.join(' | '));

  // 1. no events + a claim
  expect('no events + claim', { v: 1, rv: 1, type: 'axe-new', a: 0, env: { w: 0, h: 0, mob: false, ping: 0 }, ev: [] }, 12);
  // 2. claim above the logged points
  expect('claim above the logged points', clone(base.log), base.streak + 5);
  // 3. time compressed
  { const l = clone(base.log); l.ev.forEach(e => { e[1] = Math.round(e[1] * 0.5); }); expect('times scaled x0.5', l, base.streak); }
  { const l = clone(base.log); l.ev.forEach(e => { e[1] = Math.round(e[1] * 0.9); }); expect('times scaled x0.9', l, base.streak); }
  // 4. invented hits: the final miss marked a hit, a hit flipped
  { const l = clone(base.log); let j = -1; for (let i = l.ev.length - 1; i >= 0; i--) if (l.ev[i][0] === 'J' && l.ev[i][3] === 0) { j = i; break; }
    if (j < 0) { // base ended by cap: move the last hit's fill out of the zone instead
      for (let i = l.ev.length - 1; i >= 0; i--) if (l.ev[i][0] === 'J') { j = i; break; }
      l.ev[j][2] = 0.2; expect('hit logged with a fill outside the zone', l, base.streak);
    } else { l.ev[j][3] = 1; l.ev.splice(j + 1, 1); expect('miss flipped to hit', l, base.streak + 1); } }
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'J' && e[3] === 1); l.ev[i][3] = 0; expect('hit flipped to miss mid-run', l, base.streak); }
  { const g = forgeLog({ seed: 73, rounds: 30, forceHit: true }); const l = clone(g.log); const tl = l.ev[l.ev.length - 1][1], k = g.hits, sz = A.size(k, false);
    l.ev.push(['R', tl + 705, k, r4(0.62 - sz / 2), r4(0.62 + sz / 2), 'n'], ['J', tl + 705 + A.timer(k, false) * 1000 + 5, 0.62, 1]);
    expect('an invented round (R + J, no taps)', l, g.hits + 1); }
  // 5. edited draws: zone outside the range / wrong width / wrong count / moved
  { const l = clone(base.log); const i = l.ev.findIndex((e, k) => k > 3 && e[0] === 'R'); const w = l.ev[i][4] - l.ev[i][3]; l.ev[i][3] = r4(0.93 - w / 2); l.ev[i][4] = r4(0.93 + w / 2); expect('zone centre above the draw range', l, base.streak); }
  { const l = clone(base.log); const i = l.ev.findIndex((e, k) => k > 3 && e[0] === 'R'); const w = l.ev[i][4] - l.ev[i][3]; l.ev[i][3] = r4(0.45 - w / 2); l.ev[i][4] = r4(0.45 + w / 2); expect('zone centre below the draw range', l, base.streak); }
  // one round's draw just outside the range, played legally as a hit (only the range check can see it)
  { const g = forgeLog({ seed: 71, rounds: 30, forceHit: true, centre: (k, R) => k === 5 ? 0.465 : A.C_MIN + R() * A.C_SPAN }); expect('one zone drawn below the range (centre 0.465), played as a hit', g.log, g.hits); }
  { const g = forgeLog({ seed: 72, rounds: 30, forceHit: true, centre: (k, R) => k === 5 ? 0.88 : A.C_MIN + R() * A.C_SPAN }); expect('one zone drawn above the range (centre 0.88), played as a hit', g.log, g.hits); }
  { const l = clone(base.log); l.ev.forEach(e => { if (e[0] === 'R' && e[2] >= 5) { const c = (e[3] + e[4]) / 2; e[3] = r4(c - 0.09); e[4] = r4(c + 0.09); } }); expect('zones wider than the streak allows', l, base.streak); }
  { const l = clone(base.log); const i = l.ev.findIndex((e, k) => k > 3 && e[0] === 'R'); l.ev.splice(i, 1); expect('a round with no zone (draw missing)', l, base.streak); }
  { const l = clone(base.log); const i = l.ev.findIndex((e, k) => k > 3 && e[0] === 'R'); l.ev.splice(i + 1, 0, l.ev[i].slice()); expect('two zones for one round', l, base.streak); }
  { const l = clone(base.log); l.ev.forEach(e => { if (e[0] === 'R' && e[2] > 0) e[2] -= 1; }); expect('rounds claim a lower streak (easier curve)', l, base.streak); }
  { const l = clone(base.log); l.type = 'axe-new-comp'; expect('casual log sent as competitive', l, base.streak); }
  { const g = forgeLog({ seed: 70, rounds: 30, forceHit: true }); const l = clone(g.log); l.type = 'axe'; expect('an axe-new log sent as the old axe', l, g.hits); }
  // 6. cherry-picked easiest targets: zones only at the bottom of the range
  { const sim = goodLong(900, { zoneRand: (() => { const z = mulberry32(3); return () => z() * 0.06; })() }); expect('cherry-picked zones (all low)', sim.log, sim.streak); }
  // 7. perfect bot: exact plan, no timing or aim error, fast taps
  { const p = humanPlayer(mulberry32(11), 1); Object.assign(p, { sigma0: 0, weber: 0, aimSd: 0, miscount: 0, adapt: 1, warm: 0, gap: 0, antic: null, style: 'burst', look: 0, tapMu: 45, tapMin: 40, tapCv: 0.1, marginLo: 40, marginHi: 60 });
    const sim = goodLong(1200, { player: p, hz: 144 }); expect('perfect bot (zero error)', sim.log, sim.streak); }
  // 8. metronome bot: taps exactly evenly spaced
  { const p = humanPlayer(mulberry32(12), 0.95); Object.assign(p, { tapCv: 0, jitterMs: 1, tapMu: 110, antic: null, style: 'burst' });
    const sim = goodLong(1400, { player: p }); expect('metronome bot', sim.log, sim.streak); }
  // 9. (no reaction check: a first tap right at a round start is anticipation
  //    of the fixed 700 ms wait, and on the shortest comp timers the way to
  //    reach the middle zones. Such logs are accepted at the points they prove.)
  // 10. times fine, order impossible
  { const l = clone(base.log); const j = l.ev.findIndex(e => e[0] === 'J'); const k = j - 1; const t = l.ev[j][1]; l.ev[j][1] = l.ev[k][1]; l.ev[k][1] = t; const tmp = l.ev[j]; l.ev[j] = l.ev[k]; l.ev[k] = tmp; expect('last tap and judgement swapped', l, base.streak); }
  { const l = clone(base.log); const j = l.ev.findIndex(e => e[0] === 'R' && e[5] === 'n'); const e = l.ev.splice(j, 1)[0]; l.ev.splice(j - 1, 0, [e[0], l.ev[j - 2][1], e[2], e[3], e[4], e[5]]); expect('next round before the hit', l, base.streak); }
  { const l = clone(base.log); l.ev.unshift(['J', 0, 0.5, 1]); expect('judgement before the first round', l, base.streak); }
  // 11. replayed honest log, higher claim
  expect('replayed honest log, higher claim', clone(base.log), base.streak * 2);
  { const l = clone(base.log); const cut = l.ev.findIndex((e, i) => e[0] === 'J' && e[3] === 1 && l.ev.slice(0, i + 1).filter(x => x[0] === 'J').length === 10);
    l.ev = l.ev.slice(0, cut + 1); expect('the 10-point snapshot replayed, claim ' + base.streak, l, base.streak); }
  // 12. the bar: inputs the page could not have produced
  // last tap leaves the bar at 0.625 at 1900; by 2600 it can only be down to ~0.535
  { const b = tapsAt(1500, 5); expect('judged fill above the last tap (bar rose with no tap)', mkLog([['R', 0, 0, 0.55, 0.73, 's']].concat(b.ev, [['J', 2600, r4(b.f + 0.01), 1]])), 1); }
  { const b = tapsAt(1500, 5); expect('judged fill drained faster than 0.10/s', mkLog([['R', 0, 0, 0.46, 0.64, 's']].concat(b.ev, [['J', 2600, r4(b.f - 0.1), 1]])), 1); }
  { const missed = goodLong(2000, { maxRounds: 150, player: humanPlayer(mulberry32(21), 0.5) }, 5);
    const l = clone(missed.log); const j = l.ev.findIndex(e => e[0] === 'J' && e[3] === 0);
    if (j < 0) fail('no miss to forge from');
    else { const t = l.ev[j]; l.ev[j] = l.ev[j + 1]; l.ev[j + 1] = t; l.ev[j][1] = t[1]; expect('end logged before its judgement (same time)', l, missed.streak); }
    const l2 = clone(missed.log); l2.ev[l2.ev.length - 1][2] = l2.ev[l2.ev.length - 1][2] === 'low' ? 'high' : 'low';
    expect('end reason contradicts the judged fill', l2, missed.streak); }
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'K'); l.ev[i][2] = r4(l.ev[i][2] + A.PRESS); expect('a tap worth two', l, base.streak); }
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'K'); l.ev[i][2] = r4(l.ev[i][2] - 0.05); expect('a tap worth less than a tap', l, base.streak); }
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'J' && e[3] === 1); const t = l.ev[i][1];
    l.ev.splice(i + 1, 0, ['P', t + 10], ['U', t + 20], ['J', t + 30, l.ev[i][2], 1]); expect('pause-in-gap re-judge (the old axe bug)', l, base.streak + 1); }
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'R' && e[5] === 'n'); const gapStart = l.ev.slice(0, i).reverse().find(e => e[0] === 'J')[1];
    const shift = l.ev[i][1] - (gapStart + 300); for (let k = i; k < l.ev.length; k++) l.ev[k][1] -= shift; expect('gap cut to 300 ms', l, base.streak); }
  // inputs where no input can be handled
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'K'); const t = l.ev[i][1]; l.ev.splice(i, 0, ['P', t]); l.ev.splice(i + 2, 0, ['U', t]); expect('a tap logged while paused', l, base.streak); }
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'J' && e[3] === 1); l.ev.splice(i + 1, 0, ['K', l.ev[i][1], r4(l.ev[i][2] + A.PRESS), 'k']); expect('a round tap after the judging frame (same ms)', l, base.streak); }
  { const l = clone(base.log); l.ev.splice(1, 0, ['G', l.ev[0][1]]); expect('a between-rounds tap inside a live round', l, base.streak); }
  { const l = clone(base.log); l.ev.unshift(['K', 0, 0.125, 'k']); expect('a tap before the first round', l, base.streak); }
  // a log where the bar never drains: zones picked to sit on a multiple of 0.125
  { const ev = []; let t = 0; const zr = mulberry32(99); let k = 0;
    for (; k < 30; k++) {
      const sz = A.size(k, false); const n = 5 + Math.floor(zr() * 2); const c = A.PRESS * n - (zr() * 0.8) * sz / 2;
      ev.push(['R', t, k, r4(c - sz / 2), r4(c + sz / 2), k ? 'n' : 's']);
      let tt = t + 300 + Math.floor(zr() * 300), f = 0;
      for (let p = 0; p < n; p++) { f = r4(f + A.PRESS); ev.push(['K', tt, f, 'k']); tt += 100 + Math.floor(zr() * 60); }
      t += A.timer(k, false) * 1000 + 10; ev.push(['J', t, f, 1]); t += 710;
    }
    expect('bar never drains', { v: 1, rv: 1, type: 'axe-new', a: 0, env: { w: 1, h: 1, mob: false, ping: 0 }, ev }, 30); }
  // the bar stopped in the zone (a debugger / alert() freeze before each judgement)
  expect('bar frozen in the zone before every judgement (judged 0.8 s late)',
    forgeLog({ seed: 40, rounds: 40, forceHit: true, late: () => 800, freeze: () => 300 }).log, 40);
  expect('bar frozen before every 5th judgement (judged 0.5 s late)',
    forgeLog({ seed: 41, rounds: 40, forceHit: true, late: k => k % 5 === 2 ? 500 : 0, freeze: k => k % 5 === 2 ? 300 : 0 }).log, 40);
  { const l = clone(base.log); l.ev.push(['K', l.ev[l.ev.length - 1][1] + 5, 0.125, 'k']); expect('events after the end', l, base.streak); }
  { const l = clone(base.log); for (let k = 0; k < l.ev.length; k++) l.ev[k][1] += 5000; expect('first round long after Start', l, base.streak); }

  // 13. time compression through pauses (the server clock is the only thing
  //     that makes a forged run take real time, so no log may be shorter than
  //     the rounds and waits it claims)
  expect('zero-length pauses stacked in every round, rounds cut to 30%',
    forgeLog({ seed: 31, rounds: 40, pausePairs: 60, durScale: 0.3 }).log, 40);
  expect('zero-length pauses stacked in every round, rounds cut to 90%',
    forgeLog({ seed: 32, rounds: 40, pausePairs: 60, durScale: 0.9 }).log, 40);
  expect('pause + resume in every wait, next round at once (skips 700 ms)',
    forgeLog({ seed: 33, rounds: 40, gapPause: true, gapMs: 20 }).log, 40);
  expect('pause + resume in every wait, next round 400 ms after the hit',
    forgeLog({ seed: 34, rounds: 40, gapPause: true, gapMs: 400 }).log, 40);
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'R' && e[5] === 'n'); l.ev[i][5] = 'g';
    expect('a round marked g (an unknown round kind)', l, base.streak); }
  // 14. minimal and hand-made logs
  { const ev = []; let t = 0;
    for (let k = 0; k < 20; k++) { const sz = A.size(k, false); ev.push(['R', t, k, r4(0.6 - sz / 2), r4(0.6 + sz / 2), k ? 'n' : 's']); t += A.timer(k, false) * 1000; ev.push(['J', t, 0.6, 1]); t += 700; }
    expect('R + J only, no taps', { v: 1, rv: 1, type: 'axe-new', a: 0, env: { w: 1, h: 1, mob: false, ping: 0 }, ev }, 20); }
  expect('same zone every round (a draw reused)', forgeLog({ seed: 35, rounds: 40, centre: () => 0.6 }).log, 40);
  expect('identical timing every round (no aim or timing error)', forgeLog({ seed: 36, rounds: 40, aimSd: 0, timeSd: 0 }).log, 40);
  expect('taps exactly 100 ms apart', forgeLog({ seed: 37, rounds: 40, iv: () => 100 }).log, 40);
  // 15. out-of-range values and malformed events
  { const g = forgeLog({ seed: 38, rounds: 30 }); const l = g.log; const bump = (i, fn) => { const x = clone(l); fn(x.ev[i], x); return x; };
    const kI = l.ev.findIndex(e => e[0] === 'K'), jI = l.ev.findIndex(e => e[0] === 'J'), rI = 0;
    const cl = g.hits || 30;
    expect('fill as a string', bump(kI, e => { e[2] = String(e[2]); }), cl);
    expect('hit as true', bump(jI, e => { e[3] = true; }), cl);
    expect('fill null (NaN in JSON)', bump(jI, e => { e[2] = null; }), cl);
    expect('negative fill', bump(jI, e => { e[2] = -0.5; }), cl);
    expect('huge fill', bump(kI, e => { e[2] = 1e300; }), cl);
    expect('fill 1.5 (past the cap)', bump(kI, e => { e[2] = 1.5; }), cl);
    expect('huge zone', bump(rI, e => { e[4] = 1e300; }), cl);
    expect('zone off the track (0.95 to 1.13)', bump(rI, e => { e[3] = 0.95; e[4] = 1.13; }), cl);
    expect('streak 0.5', bump(rI, e => { e[2] = 0.5; }), cl);
    expect('negative time', bump(kI, (e, x) => { for (let i = 0; i < kI; i++) x.ev[i][1] = -5; e[1] = -5; }), cl);
    expect('fractional time', bump(kI, e => { e[1] += 0.5; }), cl);
    expect('extra field on a tap', bump(kI, e => { e.push(1); }), cl);
    expect('tap source unknown', bump(kI, e => { e[3] = 'bot'; }), cl);
    expect('unknown event code', (() => { const x = clone(l); x.ev.splice(3, 0, ['Z', x.ev[2][1]]); return x; })(), cl);
    expect('judgement duplicated', (() => { const x = clone(l); x.ev.splice(jI + 1, 0, x.ev[jI].slice()); return x; })(), cl);
    expect('resume with no pause', (() => { const x = clone(l); x.ev.splice(2, 0, ['U', x.ev[1][1]]); return x; })(), cl);
    expect('reset before any round', (() => { const x = clone(l); x.ev.unshift(['E', 0, 'x']); return x; })(), cl);
    expect('end twice', (() => { const x = clone(l); x.ev.push(['E', x.ev[x.ev.length - 1][1], 'x'], ['E', x.ev[x.ev.length - 1][1], 'x']); return x; })(), cl);
    expect('a million claimed', clone(l), 1e6);
    expect('log for another trainer', (() => { const x = clone(l); x.type = 'axe-new-comp'; return x; })(), cl);
    // the envelope
    expect('envelope: version 2', Object.assign(clone(l), { v: 2 }), cl);
    expect('envelope: type does not match the claim', Object.assign(clone(l), { type: 'axe' }), cl);
    expect('envelope: attempt -1', Object.assign(clone(l), { a: -1 }), cl);
    expect('envelope: env with 9 fields', (() => { const x = clone(l); for (let i = 0; i < 6; i++) x.env['k' + i] = i; return x; })(), cl);
    expect('envelope: env string too long', (() => { const x = clone(l); x.env.w = 'x'.repeat(40); return x; })(), cl);
    expect('envelope: env is an array', Object.assign(clone(l), { env: [] }), cl);
    expect('envelope: 20001 events', (() => { const x = clone(l); const last = x.ev[x.ev.length - 1][1]; while (x.ev.length <= Q.LIMITS.MAX_EVENTS) x.ev.push(['G', last]); return x; })(), cl);
    expect('envelope: event with a 4-letter code', bump(kI, e => { e[0] = 'KKKK'; }), cl);
    expect('envelope: event with 15 fields', bump(kI, e => { while (e.length < 17) e.push(0); }), cl);
    expect('envelope: a 40-character string field', bump(kI, e => { e[3] = 'k'.repeat(40); }), cl);
    expect('envelope: an object field', bump(kI, e => { e[2] = { v: 0.5 }; }), cl);
    expect('envelope: time past twelve hours', bump(l.ev.length - 1, e => { e[1] = Q.LIMITS.MAX_T + 1; }), cl);
    expect('envelope: time goes back', (() => { const x = clone(l); const i = x.ev.findIndex((e, j) => j > 2 && e[0] === 'K'); x.ev[i][1] = x.ev[i - 1][1] - 5; return x; })(), cl);
    expect('envelope: log is an array', [].concat(clone(l).ev), cl);
  }

  for (const x of results) console.log('  forgery: ' + x.name + ' -> ' + x.verdict + (x.reason ? ' (' + x.reason.slice(0, 90) + ')' : ''));
  console.log(`forgeries: ${results.length} tried, ${results.filter(x => !/^valid/.test(x.verdict)).length} invalid or review`);
  return results;
}

// ── d) the REAL IIFE (axe-new.iife.js) in a stub DOM ──────────────────────────
// The simulator above is a re-implementation; this drives the shipped code:
// a virtual clock, rAF with vsync stamps (sometimes before the Start/Resume
// stamp), setTimeout with lateness, main-thread stalls, the ping delay, coarse
// (privacy) timers, panel hide + show + Resume and browser-tab hide +
// Resume at random moments, a second Start while a run is live (matchmaking),
// resizes, a scores reset, mobile touches (canvas and TAP button), key
// chatter, and a player who reads the zones from the run's own log. Every
// submitted snapshot and every final log must check out.
const vm = require('vm'), fs = require('fs');
const SRC = {
  rules: fs.readFileSync('@qte-scratch/wt2/js/qte-rules.js', 'utf8'),
  part: fs.readFileSync(path.join(__dirname, 'axe-new.rules.js'), 'utf8'),
  iife: fs.readFileSync(path.join(__dirname, 'axe-new.iife.js'), 'utf8'),
};
// every canvas call the trainer makes; anything else throws (a typo, a missing stub)
function ctxStub() {
  const c = {};
  for (const m of ['clearRect', 'fillRect', 'strokeRect', 'fillText']) c[m] = () => {};
  return c;
}
function realIife(o) {
  const R = mulberry32(o.seed), N = mkNormal(R);
  const U = (a, b) => a + (b - a) * R();
  let clock = 5000 + R() * 50000;                                  // true time, ms
  const coarse = o.coarse || 0;
  const perfNow = () => coarse ? Math.floor(clock / coarse) * coarse : clock;
  // main-thread stalls
  const stalls = [];
  { let x = clock; for (let i = 0; i < 300; i++) { x += -Math.log(1 - R()) * 1000 / o.lagRate; const d = R() < 0.7 ? U(20, 60) : R() < 0.85 ? U(60, 250) : U(250, 900); stalls.push([x, x + d]); x += d; } }
  const inStall = (x) => { for (const s of stalls) { if (x >= s[0] && x < s[1]) return s; if (s[0] > x) break; } return null; };
  const later = (x) => { const s = inStall(x); return s ? s[1] + U(0.05, 0.3) : x; };
  // frames
  const T = 1000 / o.hz, vs0 = clock + R() * T;
  function nextFrame(after) {
    let n = Math.floor((after - vs0) / T) + 1, ts = vs0 + n * T, cb = ts + U(0.2, 1.5);
    const s = inStall(cb); if (s) { ts = vs0 + Math.floor((s[1] - vs0) / T) * T; cb = s[1] + U(0.1, 1); }
    if (R() < 0.2) ts -= U(0, T);            // a stamp from before the callback's own frame
    return { ts, cb };
  }
  const rafQ = []; let rafSeq = 0, frame = null;
  const timers = []; let timerSeq = 0;
  const els = {};
  function el(id) {
    return els[id] || (els[id] = { id, style: {}, textContent: '', width: 0, height: 0, _l: {},
      addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }, getContext: () => ctxStub(),
      parentElement: { clientWidth: 360 + Math.floor(R() * 700) }, classList: { contains: () => true } });
  }
  const docL = {}, winL = {};
  const submits = [], finals = [];
  const doc = { hidden: false, getElementById: el, addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); }, activeElement: { tagName: 'BODY' } };
  const M = Object.create(Math); M.random = mulberry32(o.seed * 7 + 1);   // the page's zone draws, seeded
  const sb = {
    console, Math: M, JSON, Promise, Object, Array, Number, String, Set, Map, Error, isFinite, parseInt,
    setTimeout: (fn, ms) => { const id = ++timerSeq; timers.push({ id, at: later(clock + Math.max(0, ms || 0) + (R() < 0.05 ? U(4, 40) : U(0, 4))), fn }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex(x => x.id === id); if (i >= 0) timers.splice(i, 1); },
    performance: { now: perfNow },
    document: doc,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (f) => { if (!rafQ.length) frame = nextFrame(clock); rafQ.push({ id: ++rafSeq, f }); return rafSeq; },
    cancelAnimationFrame: (id) => { const i = rafQ.findIndex(x => x.id === id); if (i >= 0) rafQ.splice(i, 1); },
    addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); },
    innerWidth: 1280, innerHeight: 800, IS_MOBILE: !!o.mobile,
    _qteCompMode: !!o.comp, _albPing: o.ping || 0,
    _sbStartQteRun: () => Promise.resolve(null),
    _sbSubmitScore: (type, score, packet) => { submits.push({ type, score, log: packet.log }); return Promise.resolve(true); },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(SRC.rules, sb); vm.runInContext(SRC.part, sb); vm.runInContext(SRC.iife, sb);
  const QQ = sb.QteRules, RR = QQ.trainers['axe-new'];
  const click = (id) => { for (const f of (el(id)._l.click || [])) f({}); };
  const fire = (L, t, e) => { for (const f of (L[t] || [])) f(e || {}); };

  // actions: { at, kind, gen }
  const acts = [];
  const add = (at, kind, x) => acts.push(Object.assign({ at, kind }, x || {}));
  sb._onAxeNewQteShow();
  click('axe-new-qte-start-btn');
  let run = QQ.Run.current, gen = 0, restarted = false;
  const lag = o.mobile ? 0 : (o.ping || 0);
  for (const [a, d, kind] of o.pauses || []) { add(clock + a, kind === 'tab' ? 'vhide' : 'hide'); add(clock + a + d, kind === 'tab' ? 'vshow' : 'show'); }
  if (o.restartAt) add(clock + o.restartAt, 'restart');
  if (o.resizeAt) add(clock + o.resizeAt, 'resize');
  if (o.resetScoresAt) add(clock + o.resetScoresAt, 'scoresReset');

  function readLog() {
    const s = { Rr: null, lastK: null, pausedSinceR: 0, judged: false, over: false, nR: 0, nU: 0, nJ: 0, hits: 0, lastJ: null };
    let pAt = -1;
    for (const e of run.log.ev) {
      if (e[0] === 'R') { s.Rr = e; s.lastK = null; s.pausedSinceR = 0; s.judged = false; s.nR++; }
      else if (e[0] === 'K') s.lastK = e;
      else if (e[0] === 'P') pAt = e[1];
      else if (e[0] === 'U') { if (pAt >= 0 && !s.judged) s.pausedSinceR += e[1] - pAt; pAt = -1; s.nU++; }
      else if (e[0] === 'J') { s.judged = true; s.nJ++; s.lastJ = e; if (e[3] === 1) s.hits++; }
      else if (e[0] === 'E') s.over = true;
    }
    return s;
  }
  function plan() {
    const s = readLog();
    if (s.over || !s.Rr || s.judged) return;
    const k = s.Rr[2], zMin = s.Rr[3], zMax = s.Rr[4];
    const now = clock - run.t0;
    const endT = s.Rr[1] + RR.timer(k, !!o.comp) * 1000 + s.pausedSinceR;
    const f = s.lastK ? Math.max(0, s.lastK[2] - RR.DRAIN * (now - s.lastK[1]) / 1000) : 0;
    const c = (zMin + zMax) / 2, g = c + N() * o.aim * (zMax - zMin) / 2;
    const mu = o.tapMu, taps = [];
    let best = null;
    const tz = now + lag + f / RR.DRAIN * 1000;
    for (let n = 1; n <= 12; n++) {
      const tau = (RR.PRESS * n - g) / RR.DRAIN * 1000;
      if (tau < (n - 1) * mu * 1.2 + 120) continue;
      if (endT - tau >= Math.max(now + lag + 30, tz)) best = { n, d1: endT - tau };
      break;
    }
    if (best) {
      let tt = best.d1 - lag + N() * o.sigma;
      for (let i = 0; i < best.n; i++) { taps.push(tt); tt += Math.max(40, mu * (1 + 0.12 * N())); }
    } else {
      const d0 = now + lag;
      const n = Math.max(0, Math.round((g - f + RR.DRAIN * (endT - d0) / 1000) / RR.PRESS));
      let tt = now + U(0, 30);
      for (let i = 0; i < n; i++) { taps.push(tt); tt += Math.max(40, mu * (1 + 0.12 * N())); }
    }
    for (const t of taps) add(run.t0 + Math.max(now, t), 'tap', { gen });
    if (R() < 0.4) add(run.t0 + Math.max(now + 50, endT - U(250, 600)), 'look', { gen });
  }
  function look() {
    const s = readLog();
    if (s.over || !s.Rr || s.judged || acts.some(a => a.kind === 'tap' || a.kind === 'key' || a.kind === 'touch')) return;
    const now = clock - run.t0, endT = s.Rr[1] + RR.timer(s.Rr[2], !!o.comp) * 1000 + s.pausedSinceR;
    const f = s.lastK ? Math.max(0, s.lastK[2] - RR.DRAIN * (endT - s.lastK[1]) / 1000) : 0;
    const c = (s.Rr[3] + s.Rr[4]) / 2;
    if (f < s.Rr[3] && Math.abs(f + RR.PRESS - c) < Math.abs(f - c)) add(clock + U(60, 160), 'tap', { gen });
  }
  function tap() {
    // the handler runs after the ping delay (keys only) and any stall
    if (o.mobile) add(later(clock + U(0, 2)), 'touch', { target: R() < 0.5 ? 'axe-new-qte-canvas' : 'axe-new-tap-btn' });
    else {
      const h = later(clock + (lag ? lag + (R() < 0.95 ? U(0, 4) : U(4, 60)) : U(0, 1)));
      add(h, 'key');
      if (o.chatter && R() < o.chatter) add(h + U(4, 25), 'key');       // a worn switch: a second keydown
    }
  }

  let seen = readLog(), overAt = -1, guard = 0;
  add(clock + U(200, 350), 'plan', { gen });
  const endAt = clock + (o.capMs || 150000);
  while (guard++ < 3e6) {
    let ai = -1, ta = Infinity;
    for (let i = 0; i < acts.length; i++) if (acts[i].at < ta) { ta = acts[i].at; ai = i; }
    let ti = -1, tt = Infinity;
    for (let i = 0; i < timers.length; i++) if (timers[i].at < tt) { tt = timers[i].at; ti = i; }
    const tf = rafQ.length ? frame.cb : Infinity;
    const tn = Math.min(ta, tt, tf);
    if (tn === Infinity || tn > endAt) break;
    if (tf === tn) {
      clock = frame.cb;
      const q = rafQ.splice(0);                 // callbacks queued before this frame
      const ts = coarse ? Math.floor(frame.ts / coarse) * coarse : frame.ts;
      frame = nextFrame(clock);
      for (const x of q) x.f(ts);
    } else if (tt === tn) {
      clock = tt;
      const x = timers.splice(ti, 1)[0]; x.fn();
    } else {
      const a = acts.splice(ai, 1)[0];
      clock = a.at;
      if (a.gen !== undefined && a.gen !== gen) continue;
      if (a.kind === 'tap') tap();
      else if (a.kind === 'key') fire(docL, 'keydown', { code: 'Space', repeat: false, preventDefault() {} });
      else if (a.kind === 'touch') { for (const f of (el(a.target)._l.touchstart || [])) f({ preventDefault() {} }); }
      else if (a.kind === 'plan') plan();
      else if (a.kind === 'look') look();
      else if (a.kind === 'hide') { sb._onAxeNewQteHide(); gen++; }
      else if (a.kind === 'show') { sb._onAxeNewQteShow(); add(clock + U(300, 1500), 'resumeClick'); }
      else if (a.kind === 'vhide') { doc.hidden = true; fire(docL, 'visibilitychange'); gen++; }
      else if (a.kind === 'vshow') { doc.hidden = false; fire(docL, 'visibilitychange'); add(clock + U(300, 1500), 'resumeClick'); }
      else if (a.kind === 'resumeClick') { click('axe-new-qte-resume-btn'); }
      else if (a.kind === 'resize') fire(winL, 'resize');
      else if (a.kind === 'scoresReset') fire(winL, 'alb-scores-reset');
      else if (a.kind === 'restart') {          // matchmaking-style Start while the run is live
        finals.push({ type: run.type, log: run.log });
        click('axe-new-qte-start-btn'); run = QQ.Run.current; gen++; restarted = true; seen = readLog();
        add(clock + U(200, 350), 'plan', { gen });
        continue;
      }
    }
    // what the player sees next: a new round, a Resume, a judgement
    const s = readLog();
    if (s.nR > seen.nR || (s.nU > seen.nU && !s.judged)) add(clock + U(180, 350), 'plan', { gen });
    if (s.nJ > seen.nJ && s.lastJ[3] === 1) {
      if (o.antic) add(clock + 700 + U(-30, 90) - lag, 'tap', { gen });                 // anticipating the next round
      if (R() < 0.15) add(clock + U(100, 650), 'tap', { gen });                        // a tap in the wait
    }
    seen = s;
    if (s.over && overAt < 0) overAt = clock;
    if (overAt >= 0 && clock > overAt + 1500) break;
  }
  finals.push({ type: run.type, log: run.log });
  return { submits, finals, restarted };
}

function realSuite(NR) {
  const R = mulberry32(777001);
  const U = (a, b) => a + (b - a) * R();
  const pick = a => a[Math.floor(R() * a.length)];
  let ri = 0, rr = 0, rm = 0, nsub = 0, top = 0, restarts = 0, rp = 0, rend = 0, nK = 0, nG = 0, mob = 0;
  for (let n = 0; n < NR; n++) {
    const o = {
      seed: 90000 + n,
      comp: R() < 0.5, hz: pick([30, 60, 60, 60, 120, 144, 240]), lagRate: pick([0.05, 0.3, 1.5]),
      ping: pick([0, 0, 150, 300]), sigma: pick([25, 50, 90, 160]), aim: pick([0.15, 0.3, 0.5]), tapMu: U(70, 150),
      coarse: R() < 0.8 ? 0 : R() < 0.5 ? 1000 / 60 : 100, chatter: R() < 0.2 ? U(0.05, 0.3) : 0,
      mobile: R() < 0.25, antic: R() < 0.2, pauses: [], capMs: U(40000, 150000),
    };
    if (o.mobile) mob++;
    if (R() < 0.5) {
      const np = 1 + Math.floor(R() * 4);
      for (let k = 0; k < np; k++) o.pauses.push([U(300, 60000), R() < 0.4 ? U(200, 900) : U(900, 15000), R() < 0.5 ? 'tab' : 'panel']);
      o.pauses.sort((a, b) => a[0] - b[0]);
      for (let k = 1; k < np; k++) o.pauses[k][0] = Math.max(o.pauses[k][0], o.pauses[k - 1][0] + o.pauses[k - 1][1] + 2000);
    }
    if (R() < 0.1) { o.restartAt = U(1500, 30000); restarts++; }
    if (R() < 0.2) o.resizeAt = U(500, 30000);
    if (R() < 0.1) o.resetScoresAt = U(3000, 30000);
    let out;
    try { out = realIife(o); }
    catch (e) { fail('real IIFE threw: ' + (e && e.stack || e)); continue; }
    const logs = out.submits.map(x => [x.type, x.log, x.score]);
    for (const f of out.finals) {
      rp += f.log.ev.filter(e => e[0] === 'P').length;
      nK += f.log.ev.filter(e => e[0] === 'K').length; nG += f.log.ev.filter(e => e[0] === 'G').length;
      if (f.log.ev.some(e => e[0] === 'E')) rend++;
      logs.push([f.type, f.log, f.log.ev.filter(e => e[0] === 'J' && e[3] === 1).length]);
    }
    let bi = false, br = false;
    for (const [ty, lg, cl] of logs) {
      const r = Q.check(ty, lg, { platform: o.mobile ? 'M' : 'C', claimed: cl });
      nsub++; top = Math.max(top, cl);
      if (r.verdict === 'invalid') { bi = true; if (ri < 3) console.log('  real IIFE invalid', r.reasons, JSON.stringify(o)); }
      if (r.verdict === 'review') { br = true; if (rr < 3) console.log('  real IIFE review', r.reasons, JSON.stringify(r.stats)); }
      if (r.verdict !== 'invalid' && r.score !== cl) { rm++; if (rm < 3) console.log('  real IIFE mismatch', r.score, cl, r.reasons, JSON.stringify(o)); }
    }
    if (bi) ri++; if (br) rr++;
  }
  console.log(`real IIFE: ${NR} runs (${mob} mobile, ${restarts} with a Start mid-run, ${rp} pauses logged, ${rend} logs ended, ${nK} taps and ${nG} gap taps), ${nsub} logs checked, invalid ${ri}, review ${rr}, score mismatch ${rm}, top ${top}`);
  if (ri) fail('real IIFE honest runs invalid: ' + ri);
  if (rm) fail('real IIFE score mismatches: ' + rm);
  if (rr / NR > 0.005) fail('real IIFE review rate ' + rr / NR);
  if (!nG) fail('real IIFE: no gap taps were exercised');
  if (!rp) fail('real IIFE: no pauses were exercised');
  return { runs: NR, invalid: ri, review: rr };
}

// The IIFE's own behaviour, beyond the log: mode fixed at Start, highscores, a
// Start over a live run, hidden-tab pause, Too low / Too high.
function iifeBehaviour() {
  function boot(extra) {
    let clock = 1000, tid = 0;
    const els = {}, docL = {}, winL = {}, timers = [], rafQ = [], store = {}, submits = [];
    function el(id) {
      return els[id] || (els[id] = { id, style: {}, textContent: '', _l: {}, addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
        getContext: () => ctxStub(), parentElement: { clientWidth: 900 }, classList: { contains: () => true } });
    }
    const doc = { hidden: false, getElementById: el, addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); }, activeElement: { tagName: 'BODY' } };
    const sb = Object.assign({
      console, Math, JSON, Promise, Object, Array, Number, String, Error, isFinite, parseInt,
      setTimeout: (fn, ms) => { timers.push({ id: ++tid, at: clock + ms, fn }); return tid; },
      clearTimeout: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
      performance: { now: () => clock }, document: doc,
      localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
      requestAnimationFrame: f => { rafQ.push(f); return rafQ.length; }, cancelAnimationFrame: () => { rafQ.length = 0; },
      addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); },
      innerWidth: 1280, innerHeight: 800, IS_MOBILE: false, _qteCompMode: false, _albPing: 0,
      _sbStartQteRun: () => Promise.resolve(null),
      _sbSubmitScore: (type, score) => { submits.push([type, score]); return Promise.resolve(true); },
    }, extra || {});
    sb.window = sb; vm.createContext(sb);
    vm.runInContext(SRC.rules, sb); vm.runInContext(SRC.part, sb); vm.runInContext(SRC.iife, sb);
    const api = {
      sb, el, store, submits,
      get run() { return sb.QteRules.Run.current; },
      click: id => { for (const f of (el(id)._l.click || [])) f({}); },
      key: () => { for (const f of (docL.keydown || [])) f({ code: 'Space', repeat: false, preventDefault() {} }); },
      hold: () => { for (const f of (docL.keydown || [])) f({ code: 'Space', repeat: true, preventDefault() {} }); },
      vis: h => { doc.hidden = h; for (const f of (docL.visibilitychange || [])) f(); },
      // advance the virtual clock, running frames every 16 ms and due timers
      step: ms => {
        const end = clock + ms;
        while (clock < end) {
          clock = Math.min(end, clock + 16);
          for (;;) {
            const i = timers.findIndex(t => t.at <= clock);
            if (i < 0) break;
            timers.splice(i, 1)[0].fn();
          }
          const q = rafQ.splice(0); for (const f of q) f(clock);
        }
      },
      stepUntil: (pred, max) => { for (let t = 0; t < max && !pred(); t += 16) api.step(16); },
    };
    return api;
  }
  const ev = x => x.run.log.ev;
  const count = (x, c) => ev(x).filter(e => e[0] === c).length;
  // play one round up to its judgement: taps so the bar ends in the zone, or empty ('low'), or full ('high')
  function playRound(g, aimAt) {
    const all = ev(g), ri = all.map(e => e[0]).lastIndexOf('R'), Rr = all[ri];
    let paused = 0, pAt = -1;
    for (const e of all.slice(ri)) { if (e[0] === 'P') pAt = e[1]; else if (e[0] === 'U' && pAt >= 0) { paused += e[1] - pAt; pAt = -1; } }
    const dur = A.timer(Rr[2], /-comp$/.test(g.run.type)) * 1000, endAt = Rr[1] + dur + paused, nJ = count(g, 'J');
    if (aimAt === 'high') { while (g.run.now() < endAt - 40) { g.key(); g.step(96); } }
    else if (aimAt !== 'low') {
      const c = (Rr[3] + Rr[4]) / 2;
      let n = 1; while ((A.PRESS * n - c) / A.DRAIN * 1000 < (n - 1) * 64 + 100) n++;
      const tau = (A.PRESS * n - c) / A.DRAIN * 1000;
      g.step(Math.max(0, endAt - tau - g.run.now()));
      for (let i = 0; i < n; i++) { g.key(); g.step(64); }
    }
    g.stepUntil(() => count(g, 'J') > nJ, dur + 1000);
  }
  let bad = 0;
  const want = (ok, what) => { if (!ok) { bad++; fail('IIFE behaviour: ' + what); } };
  { // casual run: hits, submits, highscore, then a low miss ends it
    const g = boot();
    g.sb._onAxeNewQteShow(); g.click('axe-new-qte-start-btn');
    want(g.el('axe-new-qte-canvas').style.display === '' && g.el('axe-new-qte-start-btn').style.display === 'none', 'Start shows the canvas and hides Start');
    want(g.run.type === 'axe-new', 'a casual run is typed axe-new');
    g.sb._qteCompMode = true;                    // flipped mid-run: the run keeps its mode
    playRound(g); g.stepUntil(() => count(g, 'R') === 2, 1000); playRound(g);
    const hits = ev(g).filter(e => e[0] === 'J' && e[3] === 1).length;
    want(hits === 2, 'two aimed rounds are two hits (got ' + hits + ')');
    want(ev(g).filter(e => e[0] === 'R').every(e => Math.abs((e[4] - e[3]) - A.size(e[2], false)) < 2e-4), 'the mode stays casual for the run');
    want(g.el('axe-new-qte-streak').textContent === 'Streak: 2', 'the streak reads Streak: 2');
    want(g.store['alb:axe-new-hs'] === '2' && g.el('axe-new-qte-highscore').textContent === 'Best: 2', 'the casual best is stored and shown');
    want(g.submits.length === 2 && g.submits[1][0] === 'axe-new' && g.submits[1][1] === 2, 'each new high submits through the run');
    const n0 = ev(g).length;
    g.key(); g.hold(); g.hold();
    want(ev(g).length === n0 + 1 && ev(g)[n0][0] === 'G', 'a tap between rounds logs G, auto-repeat is ignored');
    g.stepUntil(() => count(g, 'R') === 3, 1000); playRound(g, 'low');
    const e = ev(g);
    want(e[e.length - 1][0] === 'E' && e[e.length - 1][2] === 'low' && g.el('axe-new-qte-status').textContent === 'Too low!', 'an empty bar ends the run: Too low!');
    const r = Q.check('axe-new', g.run.log, { platform: 'C', claimed: 2 });
    want(r.verdict !== 'invalid' && r.score === 2, 'the finished log checks out at 2 (' + r.verdict + ' ' + r.score + ' ' + r.reasons.join('|') + ')');
    g.step(1000);
    want(g.el('axe-new-qte-start-btn').style.display === '' && g.el('axe-new-qte-canvas').style.display === 'none', 'Start returns 900 ms after the miss');
  }
  { // comp run, Too high, tab hidden -> paused -> Resume
    const g = boot({ _qteCompMode: true });
    g.sb._onAxeNewQteShow(); g.click('axe-new-qte-start-btn');
    want(g.run.type === 'axe-new-comp', 'a comp run is typed axe-new-comp');
    g.step(500); g.vis(true);
    want(ev(g)[ev(g).length - 1][0] === 'P' && g.el('axe-new-qte-resume-btn').style.display === '', 'a hidden tab pauses the round and offers Resume');
    g.step(5000); g.vis(false);
    want(ev(g).filter(e => e[0] === 'J').length === 0, 'the round timer holds while the tab is hidden');
    g.click('axe-new-qte-resume-btn');
    want(ev(g)[ev(g).length - 1][0] === 'U', 'Resume logs U');
    playRound(g, 'high');
    const e = ev(g);
    want(e[e.length - 1][0] === 'E' && e[e.length - 1][2] === 'high' && g.el('axe-new-qte-status').textContent === 'Too high!', 'a full bar ends the run: Too high!');
    want(!('alb:axe-new-hs-comp' in g.store), 'no comp best without a hit');
  }
  { // a Start over a live run ends that run with E x; the panel hidden and shown pauses
    const g = boot();
    g.sb._onAxeNewQteShow(); g.click('axe-new-qte-start-btn');
    const first = g.run;
    g.step(300); g.sb._onAxeNewQteHide();
    want(ev(g)[ev(g).length - 1][0] === 'P', 'hiding the panel pauses');
    g.sb._onAxeNewQteShow();
    want(g.el('axe-new-qte-resume-btn').style.display === '' && g.el('axe-new-qte-canvas').style.display === '', 'showing it again offers Resume');
    g.click('axe-new-qte-resume-btn'); g.step(200);
    g.sb._onAxeNewQteShow();
    want(g.el('axe-new-qte-canvas').style.display === '' && g.el('axe-new-qte-start-btn').style.display === 'none', 'the tab clicked again keeps a live run');
    g.click('axe-new-qte-start-btn');
    want(first.log.ev[first.log.ev.length - 1][0] === 'E' && first.log.ev[first.log.ev.length - 1][2] === 'x' && first.closed, 'a Start over a live run ends it with E x');
    want(g.run !== first && ev(g)[0][0] === 'R' && ev(g)[0][5] === 's', 'and starts a new run');
    const r = Q.check('axe-new', first.log, { platform: 'C', claimed: 0 });
    want(r.verdict === 'valid', 'the reset log is valid (' + r.reasons.join('|') + ')');
  }
  { // the mobile TAP button and canvas touches
    const g = boot({ IS_MOBILE: true });
    g.sb._onAxeNewQteShow(); g.click('axe-new-qte-start-btn');
    want(g.el('axe-new-tap-btn').style.display === '', 'the TAP button shows on mobile');
    for (const f of g.el('axe-new-tap-btn')._l.touchstart) f({ preventDefault() {} });
    for (const f of g.el('axe-new-qte-canvas')._l.touchstart) f({ preventDefault() {} });
    const ks = ev(g).filter(e => e[0] === 'K');
    want(ks.length === 2 && ks[0][3] === 'b' && ks[1][3] === 't', 'TAP button and canvas taps log src b and t');
  }
  console.log(`IIFE behaviour: ${bad ? bad + ' problem(s)' : 'Start/pause/Resume/tab hide/restart/mode/highscore/Too low/Too high/mobile all as specified'}`);
}

// ── run ───────────────────────────────────────────────────────────────────────
const t0 = Date.now();
const h = honestSuite(+process.argv[2] || 20000);
safetySuite();
const f = forgerySuite();
{ // what a careful forger is left with: a legal log still takes (almost) the real time
  const g = forgeLog({ seed: 60, rounds: 60, forceHit: true });
  const r = Q.check(g.log.type, g.log, { platform: 'C', claimed: g.hits });
  let floor = 0, legal = 0;
  for (let k = 0; k < g.hits; k++) { floor += A.timer(k, false) * 1000 + (k ? A.GAP_MS : 0); legal += A.timer(k, false) * 1000 - A.TOL.JUDGE_EARLY_MS + (k ? A.GAP_MS - A.TOL.GAP_EARLY_MS : 0); }
  console.log(`careful forger (legal, human-looking, 60 rounds): ${r.verdict} ${r.score} - known limit; the shortest legal log for ${g.hits} points is ${(legal / 1000).toFixed(1)} s vs ${(floor / 1000).toFixed(1)} s of real rounds (${(100 * (1 - legal / floor)).toFixed(1)}% shorter), and the server's clock holds it to that`);
  if (r.verdict === 'invalid') fail('the careful-forger generator writes illegal logs: ' + r.reasons.join(' | '));
}
const rs = realSuite(400);
iifeBehaviour();
{ // loaded without js/qte-rules.js: the IIFE must stop quietly, not throw (a throw would end qte.js there)
  const el = () => ({ style: {}, addEventListener() {}, getContext: () => ctxStub(), parentElement: { clientWidth: 400 } });
  const sb = { console: { error() {} }, document: { getElementById: el, addEventListener() {} }, localStorage: { getItem: () => null }, addEventListener() {}, IS_MOBILE: false };
  sb.window = sb; vm.createContext(sb);
  try { vm.runInContext(SRC.iife, sb); console.log('IIFE without qte-rules.js: stops quietly'); }
  catch (e) { fail('IIFE throws without qte-rules.js: ' + e.message); }
}
console.log(`summary: honest ${h.runs} runs (invalid ${h.invalid}, review ${h.review}, mismatch ${h.mismatch}); real IIFE ${rs.runs} runs (invalid ${rs.invalid}, review ${rs.review}); forgeries ${f.length}; ${failures ? failures + ' FAILURE(S)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
