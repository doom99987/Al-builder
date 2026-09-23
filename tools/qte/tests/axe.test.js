// Node test for the axe check (axe.rules.js).
//   node axe.test.js
// a) honest simulation: a frame-by-frame model of the axe IIFE (axe.iife.js)
//    driven by simulated players; the log it writes is checked.
// b) forgeries: each must be invalid, held for review, or score far below.
// Exit code 1 on any failure.
'use strict';
require('./_paths.js');
const Q = require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const A = Q.trainers.axe;
if (!A || typeof A.check !== 'function') { console.log('FAIL axe rules not registered'); process.exit(1); }

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

// ── players ───────────────────────────────────────────────────────────────────
// skill 0 = new, 1 = top of the board.
function humanPlayer(R, skill) {
  const N = mkNormal(R);
  return {
    kind: 'human',
    rtMed: lerp(320, 220, skill) + (R() - 0.5) * 40,
    rtSig: lerp(0.3, 0.15, R()),
    sigma0: lerp(260, 40, skill) * lerp(0.85, 1.2, R()),   // ms, timing the start of the last burst
    weber: lerp(0.06, 0.02, skill),
    aimSd: lerp(0.5, 0.18, skill),                          // x zone half-width
    miscount: lerp(0.06, 0.004, skill),
    tapMu: lerp(90, 200, R()),
    tapMin: lerp(95, 70, skill),            // fastest tapping when a round is short
    tapCv: lerp(0.05, 0.2, R()),
    marginLo: lerp(150, 400, R()), marginHi: lerp(450, 900, R()),
    warm: R() < 0.3 ? R() * 0.3 : 0,        // chance of a "feel" press at round start
    gap: R() < 0.25 ? R() * 0.5 : 0,        // chance of pressing during the 700 ms gap
    adapt: lerp(0.5, 1, R()),               // how much of the ping the player allows for
    jitterMs: 2,                            // input dispatch jitter
    // Some players learn the fixed 700 ms wait and press as the next round
    // starts (anticipation, no reaction): first press ~R + off, SD sd.
    antic: R() < 0.15 ? { off: lerp(-20, 80, R()), sd: lerp(20, 60, R()) } : null,
    N,
  };
}

// ── the client model (mirrors axe.iife.js) ────────────────────────────────────
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
  const stalls = [];
  function inStall(t) { for (const s of stalls) if (t >= s.a && t < s.b) return s; return null; }

  // coarse clock: performance.now() (and rAF stamps) floored to clockQ ms
  const CQ = cfg.clockQ || 0;
  const pn = x => CQ ? Math.floor(x / CQ) * CQ : x;
  const T0 = pn(1000 + R() * 5000);
  const type = 'axe' + (comp ? '-comp' : '');
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
  let rafId = 0, gapId = 0, planId = 0, rounds = 0, snapLen = 0, done = false;
  const snaps = [];          // log length at each new high (each is a mid-run submit)
  const cancelAt = {};
  const src = cfg.mobile ? (R() < 0.5 ? 't' : 'b') : 'k';

  function requestFrame(X, sameFrameOK) {
    let stamp, exec;
    if (sameFrameOK && R() < 0.3) {
      // the frame already queued when the handler ran: its stamp is older than
      // lastTime (dt < 0) - by part of a frame, or under jank by a long task,
      // in which case presses can be handled before that frame's callback runs
      const jank = R() < 0.1;
      stamp = jank ? X - 20 - R() * 280 : Math.floor(X / Pd) * Pd;
      exec = jank && R() < 0.5 ? X + 250 + R() * 400 : X + 0.1 + R() * 0.9;
    }
    else {
      stamp = (Math.floor(X / Pd) + 1) * Pd;
      if (R() < cfg.dropRate) stamp += Pd * (1 + Math.floor(R() * 3));
      exec = stamp + R() * 1.5;
    }
    rafId++; push(exec, 'frame', { id: rafId, stamp });
  }
  function cancelFrame() { rafId++; }

  function startRound(X, why) {
    fill = 0;
    const size = A.size(streak, comp);
    const center = A.C_MIN + zr() * A.C_SPAN;
    zoneMin = Math.max(0.05, center - size / 2);
    zoneMax = Math.min(0.95, zoneMin + size);
    zoneMin = zoneMax - size;
    const dur = A.timer(streak, comp) * 1000;
    logEv(X, 'R', streak, zoneMin, zoneMax, why);     // logged first, then the clock is read
    roundEndTime = pn(X + 0.002) + dur;
    live = true;
    rounds++;
    // things that may happen in this round
    if (R() < cfg.stallRate) {
      const a = X + 100 + R() * dur, last = stalls.length ? stalls[stalls.length - 1].b : 0;
      if (a > last) {
        const hidden = R() < 0.2;
        const b = a + (hidden ? 1000 + R() * 9000 : 60 + R() * 440);
        stalls.push({ a, b, hidden });
        if (hidden) push(b + reaction(), 'plan', { why: 'stall' });
      }
    }
    // the browser tab hidden for minutes (alt-tab): no frames, no keys, NOT a pause
    if (cfg.longHideRate && R() < cfg.longHideRate) {
      const a = X + 100 + R() * dur, last = stalls.length ? stalls[stalls.length - 1].b : 0;
      if (a > last) { const b = a + 30000 + R() * 270000; stalls.push({ a, b, hidden: true }); push(b + reaction(), 'plan', { why: 'stall' }); }
    }
    const pauses = R() < cfg.pauseRate ? (R() < 0.3 ? 2 : 1) : 0;
    for (let p = 0; p < pauses; p++) {
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
    snapLen = log.ev.length; snaps.push(snapLen);
    if (streak >= cfg.maxRounds) { done = true; return; }
    armGap(X + 0.5, A.GAP_MS);
    if (pl.gap && R() < pl.gap) {
      const k = 1 + Math.floor(R() * 3);
      for (let i = 0; i < k; i++) press(X + 100 + R() * 590, -1);
    }
    if (pl.antic) press(X + A.GAP_MS + pl.antic.off + pl.antic.sd * N() - pl.adapt * ping, -1);
  }
  function armGap(X, ms) {
    gapEndAt = pn(X) + ms;
    const late = R() < 0.05 ? R() * 100 : R() * 4;
    gapId++; push(X + ms + late, 'gap', { id: gapId });
  }

  function press(phys, plan) {
    let d;
    if (ping > 0) d = phys + ping + R() * 4 + (R() < 0.03 ? R() * 60 : 0);
    else d = phys + R() * pl.jitterMs;
    push(d, 'input', { phys, plan });
  }

  // The player looks at the bar at time Tp and plans the rest of the round.
  function plan(Tp) {
    if (!running || paused || !live) return;
    planId++;
    const myPlan = planId;
    const Tend = roundEndTime;
    const half = (zoneMax - zoneMin) / 2, c = (zoneMin + zoneMax) / 2;
    const g = c + N() * pl.aimSd * half;
    const L = ping;                                  // true input lag
    const E0 = Tp + L;                               // earliest delivery
    let f0 = fill;
    let warmPhys = null;
    let margin = lerp(pl.marginLo, pl.marginHi, R());
    let mu = pl.tapMu;
    function zeroPlan(f0x, E0x) {
      const tz = Tp + f0x / A.DRAIN * 1000;
      const earliest = Math.max(E0x, tz);
      for (let n = 1; n <= 14; n++) {
        const tau = (A.PRESS * n - g) / A.DRAIN * 1000;
        if (tau < (n - 1) * mu * 1.15 + margin) continue;
        const tf = Tend - tau;
        if (tf < earliest) return null;
        return { n, tau, tf };
      }
      return null;
    }
    let p = null;
    if (pl.alwaysWarm) { warmPhys = Tp; f0 = f0 + A.PRESS; }
    else if (pl.warm && R() < pl.warm) {
      const wp = zeroPlan(f0 + A.PRESS, E0 + 1);
      if (wp) { warmPhys = Tp; f0 = f0 + A.PRESS; p = wp; }
    }
    if (!p) p = zeroPlan(f0, E0);
    if (!p) {   // short round: hurry - tap faster and finish closer to the end
      mu = Math.max(pl.tapMin || 75, mu * 0.65); margin = 60 + R() * 60;
      p = zeroPlan(f0, E0);
    }
    if (warmPhys != null) press(warmPhys, myPlan);
    let n, times = [];
    if (p) {
      n = p.n;
      const sd = pl.sigma0 + pl.weber * p.tau;
      let tf = p.tf + N() * sd;
      let phys = tf - pl.adapt * ping;
      if (phys < Tp) phys = Tp;
      if (R() < pl.miscount) n += R() < 0.5 ? -1 : 1;
      let tt = phys;
      for (let i = 0; i < n; i++) {
        times.push(tt);
        tt += Math.max(35, mu * (1 + pl.tapCv * N()));
      }
    } else {
      // No room to let the bar empty: add presses to what is there, at once.
      const fE = Math.max(0, f0 - A.DRAIN * (E0 - Tp) / 1000);
      const endNoPress = fE - A.DRAIN * (Tend - E0) / 1000;
      n = Math.max(0, Math.round((g - endNoPress) / A.PRESS));
      let tt = Tp;
      for (let i = 0; i < n; i++) { times.push(tt); tt += Math.max(35, mu * (1 + pl.tapCv * N())); }
    }
    for (const t of times) press(t, myPlan);
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
      if (e.type === 'input') { if (st.hidden) continue; push(st.b + 0.01, 'input', e.d); continue; }
      if (e.type === 'gap') { push(st.b + R() * 5, 'gap', e.d); continue; }
      if (e.type === 'plan') { if (!st.hidden) push(st.b + 1, 'plan', e.d); continue; }
      if (e.type === 'hide' || e.type === 'resume' || e.type === 'reset') { push(st.b + 1 + R() * 50, e.type, e.d); continue; }
    }
    if (e.type === 'frame') {
      if (e.d.id !== rafId || !running) continue;
      const sq = pn(e.d.stamp);
      const dt = Math.min((sq - lastTime) / 1000, A.DT_MAX);
      lastTime = sq;
      fill = Math.max(0, fill - A.DRAIN * dt);
      if (sq >= roundEndTime) { evaluate(X); continue; }
      requestFrame(X, false);
    } else if (e.type === 'gap') {
      if (e.d.id !== gapId) continue;
      if (running) { startRound(X, 'n'); lastTime = pn(X + 0.02); requestFrame(X + 0.03, true); }
    } else if (e.type === 'input') {
      if (e.d.plan > 0 && cancelAt[e.d.plan] !== undefined && e.d.phys >= cancelAt[e.d.plan]) continue;
      if (!running || paused) continue;
      fill = Math.min(1, fill + A.PRESS);
      if (live) logEv(X, 'K', fill, src); else logEv(X, 'G');
    } else if (e.type === 'plan') {
      plan(X);
    } else if (e.type === 'hide') {
      if (paused) continue;
      if (gameStarted && running) {
        cancelFrame(); running = false; paused = true;
        pauseRem = Math.max(0, roundEndTime - pn(X));
        if (!live) { gapPaused = true; gapLeft = Math.max(0, gapEndAt - pn(X)); gapId++; }
        logEv(X + 0.002, 'P');                              // logged after the clock is read
        cancelPlans(X);
      } else { done = true; }
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
  return { log, streak, rounds, snapLen, snaps };
}

// ── a) honest simulation ──────────────────────────────────────────────────────
// the old reaction check's numbers, shown as a diagnostic only
const FAST_MIN_N = 20, FAST_FLOOR_MS = 100, FAST_SHARE = 0.5;
function honestSuite() {
  const MIXED = 2400, LONG = 600, RUNS = MIXED + LONG;
  const R = mulberry32(20260922);
  let invalid = 0, review = 0, mismatch = 0, snapBad = 0, totalHits = 0, maxHits = 0, events = 0, maxEv = 0, long20 = 0;
  let bytesPerHit = 0, maxBytes = 0, anticRuns = 0;
  const reasons = {};
  const buckets = { new: 0, mid: 0, good: 0, top: 0 };
  // how close honest runs come to each person check
  const edge = { offSd: Infinity, ivSd: Infinity, fastShare: 0, zonesP: 1, drainEff: Infinity };
  for (let i = 0; i < RUNS; i++) {
    const isLong = i >= MIXED;
    const bucket = isLong ? 'top' : ['new', 'mid', 'good', 'top'][i % 4];
    const skill = isLong ? 0.9 + R() * 0.1 : { new: 0.05, mid: 0.4, good: 0.7, top: 0.95 }[bucket] + (R() - 0.5) * 0.1;
    const cfg = {
      rng: mulberry32(1000 + i),
      comp: isLong ? R() < 0.25 : R() < 0.5,
      ping: [0, 0, 150, 300][Math.floor(R() * 4)],
      hz: [60, 60, 60, 120, 144, 30][Math.floor(R() * 6)],
      mobile: R() < 0.25,
      dropRate: 0.005 + R() * 0.05,
      stallRate: R() < 0.5 ? 0.02 : 0.1,
      pauseRate: R() < 0.5 ? 0.01 : 0.06,
      resetRate: R() < 0.05 ? 0.02 : 0,
      longHideRate: R() < 0.1 ? 0.05 : 0,
      maxRounds: R() < 0.8 ? 150 : 40,
      clockQ: (() => { const c = R(); return c < 0.05 ? 1000 / 60 : c < 0.08 ? 100 : 0; })(),
    };
    cfg.player = humanPlayer(mulberry32(5000 + i), Math.max(0, Math.min(1, skill)));
    const sim = simRun(cfg);
    if (!isLong) buckets[bucket] += sim.streak;
    if (sim.streak >= 20) long20++;
    totalHits += sim.streak; maxHits = Math.max(maxHits, sim.streak);
    events += sim.log.ev.length; maxEv = Math.max(maxEv, sim.log.ev.length);
    const r = Q.check(sim.log.type, sim.log, { platform: cfg.mobile ? 'M' : 'C', claimed: sim.streak });
    const st = r.stats;
    if (st.hits >= A.PERSON.ACC_MIN_N && st.offSdMs != null) edge.offSd = Math.min(edge.offSd, st.offSdMs);
    if (st.pressIvSdMs != null && st.presses >= 60) edge.ivSd = Math.min(edge.ivSd, st.pressIvSdMs);
    if (st.zonesP != null) edge.zonesP = Math.min(edge.zonesP, st.zonesP);
    if (st.drainEff != null && st.drainS >= A.PERSON.DRAIN_MIN_S) edge.drainEff = Math.min(edge.drainEff, st.drainEff);
    { // share of fast first presses (the old reaction check; anticipators show why it is gone)
      let rT = -1, eligible = false, gp = false, first = false, n = 0, fast = 0;
      for (const e of sim.log.ev) {
        if (e[0] === 'R') { rT = e[1]; eligible = e[5] === 'n' && !gp; gp = false; first = false; }
        else if (e[0] === 'G') gp = true;
        else if (e[0] === 'K' && !first) { first = true; if (eligible) { n++; if (e[1] - rT < FAST_FLOOR_MS) fast++; } }
      }
      if (n >= FAST_MIN_N) edge.fastShare = Math.max(edge.fastShare, fast / n);
    }
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
    if (sim.streak) bytesPerHit = Math.max(bytesPerHit, bytes / Math.max(1, sim.rounds));
    maxBytes = Math.max(maxBytes, bytes);
    if (r.stats.firstPressMedMs != null && cfg.player.antic) anticRuns++;
  }
  const revRate = review / RUNS;
  console.log(`honest: ${RUNS} runs, invalid ${invalid}, review ${review} (${(revRate * 100).toFixed(2)}%), score mismatch ${mismatch}, snapshot failures ${snapBad}; ` +
    `hits mean ${(totalHits / RUNS).toFixed(1)} max ${maxHits}, ${long20} runs >= 20 hits (mixed runs by skill new/mid/good/top: ${(buckets.new / (MIXED / 4)).toFixed(1)}/${(buckets.mid / (MIXED / 4)).toFixed(1)}/${(buckets.good / (MIXED / 4)).toFixed(1)}/${(buckets.top / (MIXED / 4)).toFixed(1)}); ` +
    `events mean ${(events / RUNS).toFixed(0)} max ${maxEv}`);
  console.log(`  closest honest runs came to review: offset SD ${edge.offSd.toFixed(1)} ms (review < ${A.PERSON.ACC_MAX_SD_MS}), press SD ${edge.ivSd.toFixed(1)} ms (< ${A.PERSON.STEADY_MAX_SD_MS}), ` +
    `fast share ${edge.fastShare.toFixed(2)} (>= ${FAST_SHARE}), zones p ${edge.zonesP.toExponential(1)} (< ${A.PERSON.KS_ALPHA}), drain ${edge.drainEff.toFixed(2)} (< ${A.PERSON.DRAIN_MIN_EFF})`);
  console.log(`  ${anticRuns} runs by anticipating players; log size max ${maxBytes} bytes, max ${bytesPerHit.toFixed(0)} bytes per round`);
  if (Object.keys(reasons).length) console.log('  review reasons:', JSON.stringify(reasons));
  if (invalid) fail('honest runs rejected: ' + invalid);
  if (mismatch) fail('honest score mismatches: ' + mismatch);
  if (snapBad) fail('honest mid-run snapshots failed: ' + snapBad);
  if (revRate > 0.005) fail('honest review rate ' + (revRate * 100).toFixed(2) + '% > 0.5%');
  return { runs: RUNS, invalid, review, mismatch };
}

// ── a2) hand-built logs ──────────────────────────────────────────────────────
// A careful forger's log: legal events, exact drain, human-looking noise.
// Options: rounds, comp, seed, centre(k,R), aimSd (x half-width), timeSd (ms),
// iv(R) press spacing, durScale (<1 cuts rounds short), pausePairs (zero-length
// P/U after each R), gapPause (P/U right after each hit), gapMs (hit -> next R),
// forceHit, hideRound/hideMs (a browser tab hidden that long with the bar
// frozen in the zone - not a pause).
function forgeLog(o) {
  const R = mulberry32(o.seed || 1), N = mkNormal(R);
  const comp = !!o.comp, type = 'axe' + (comp ? '-comp' : '');
  const r4 = x => Math.round(x * 1e4) / 1e4;
  const ev = []; let t = 0, hits = 0;
  const aimSd = o.aimSd != null ? o.aimSd : 0.25, timeSd = o.timeSd != null ? o.timeSd : 60;
  const iv = o.iv || (Rr => Math.max(60, 130 + 25 * N()));
  for (let k = 0; k < o.rounds; k++) {
    const sz = A.size(k, comp), dur = A.timer(k, comp) * 1000 * (o.durScale || 1);
    const rT = t, tEnd = rT + dur;
    const hide = o.hideRound === k;
    let c = o.centre ? o.centre(k, R) : A.C_MIN + R() * A.C_SPAN;
    const rIdx = ev.length; ev.push(null);
    if (o.pausePairs) for (let p = 0; p < o.pausePairs; p++) ev.push(['P', t], ['U', t]);
    let n, gaps, t1;
    if (hide) { n = 7; gaps = [130, 130, 130, 130, 130, 130]; t1 = rT + 300; }
    else {
      let g = c + aimSd * (sz / 2) * N();
      if (o.forceHit) g = Math.min(c + sz / 2 - 0.006, Math.max(c - sz / 2 + 0.006, g));
      for (n = 1; ; n++) {
        gaps = []; for (let i = 0; i < n - 1; i++) gaps.push(iv(R));
        const span = gaps.reduce((a, b) => a + b, 0), tau = (A.PRESS * n - g) / A.DRAIN * 1000;
        if (tau >= span + 150) break;
      }
      let noise = timeSd ? timeSd * N() : 0;
      if (o.forceHit) noise = Math.max(-40, Math.min(40, noise));
      t1 = tEnd - (A.PRESS * n - g) / A.DRAIN * 1000 + noise;
      t1 = Math.max(rT + 200, Math.round(t1));
    }
    let tt = t1, f = 0, lastT = t1;
    for (let i = 0; i < n; i++) {
      if (i > 0) { tt = Math.round(tt + gaps[i - 1]); f = Math.max(0, f - A.DRAIN * (tt - lastT) / 1000); }
      f = Math.min(1, f + A.PRESS); lastT = tt;
      ev.push(['K', tt, r4(f), 'k']);
    }
    let tJ, fj;
    if (hide) { tJ = lastT + o.hideMs; fj = f - 0.003; c = fj; }
    else { tJ = Math.round(tEnd) + Math.floor(R() * 16); fj = Math.max(0, f - A.DRAIN * (tJ - lastT) / 1000); }
    let zMin = Math.max(0.05, c - sz / 2); const zMax = Math.min(0.95, zMin + sz); zMin = zMax - sz;
    ev[rIdx] = ['R', rT, k, r4(zMin), r4(zMax), k ? 'n' : 's'];
    const fr = r4(fj), hit = fr >= r4(zMin) && fr <= r4(zMax);
    ev.push(['J', tJ, fr, hit ? 1 : 0]);
    if (!hit) { ev.push(['E', tJ, fr <= r4(zMin) ? 'low' : 'high']); break; }
    hits++;
    if (o.gapPause) ev.push(['P', tJ + 1], ['U', tJ + 1]);
    t = tJ + (o.gapMs != null ? o.gapMs : A.GAP_MS + Math.floor(R() * 5));
  }
  return { log: { v: 1, rv: 1, type, a: 0, env: { w: 1280, h: 720, mob: false, ping: 0 }, ev }, hits };
}
const mkLog = (ev, type) => ({ v: 1, rv: 1, type: type || 'axe', a: 0, env: { w: 1280, h: 720, mob: false, ping: 0 }, ev });

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
  // A press handled during a long task, before the first frame after the round
  // start runs; that frame's stamp predates the start, so it raises the bar.
  { const ev = [['R', 0, 0, 0.45, 0.56, 's'], ['K', 300, 0.09, 'k']];
    let f = 0.09 + 0.015;                                        // the negative-dt frame
    for (let i = 1; i < 9; i++) { f = f - 0.006 + 0.09; ev.push(['K', 300 + 100 * i, Math.round(f * 1e4) / 1e4, 'k']); }
    ev.push(['J', 6000, Math.round((f - 0.06 * 4.9) * 1e4) / 1e4, 1]);
    must('press before a janked first frame (bar rises after it)', mkLog(ev), 1, 1); }
  // Paused in the wait and straight back: the rest of the wait runs.
  { const g = forgeLog({ seed: 50, rounds: 2, forceHit: true }).log; const j = g.ev.findIndex(e => e[0] === 'J'); const h = g.ev[j][1];
    const ev = g.ev.slice(0, j + 1).concat([['P', h + 100], ['U', h + 450]]);
    const shift = (h + 450 + 600) - g.ev[j + 1][1];
    for (const e of g.ev.slice(j + 1)) ev.push([e[0], e[1] + shift].concat(e.slice(2)));
    must('pause 100 ms into the wait, Resume 350 ms later', mkLog(ev), g.ev.filter(e => e[0] === 'J' && e[3] === 1).length, g.ev.filter(e => e[0] === 'J' && e[3] === 1).length); }
  // Reset (Start clicked by matchmaking) while paused in the wait.
  { const g = forgeLog({ seed: 51, rounds: 1, forceHit: true }).log; const h = g.ev[g.ev.length - 1][1];
    must('reset while paused between rounds', mkLog(g.ev.concat([['P', h + 100], ['E', h + 5000, 'x']])), 1, 1); }
  // Five pauses in one round, each resumed, under a coarse clock.
  { const ev = [['R', 0, 0, 0.45, 0.56, 's']]; let t = 0;
    for (let p = 0; p < 5; p++) { ev.push(['P', t + 200], ['U', t + 5200]); t += 5200; }
    let f = 0; const k0 = t + 3000;
    for (let i = 0; i < 9; i++) { f = i ? f - 0.006 + 0.09 : 0.09; ev.push(['K', k0 + 100 * i, Math.round(f * 1e4) / 1e4, 'k']); }
    // unpaused: 1000 ms between the pauses + 3000 + 800 of presses, judged at 6000 - 110
    const fj = Math.round((f - 0.06 * (6000 - 1000 - 110 - 3000 - 800) / 1000) * 1e4) / 1e4;
    ev[0] = ['R', 0, 0, Math.round((fj - 0.05) * 1e4) / 1e4, Math.round((fj + 0.06) * 1e4) / 1e4, 's'];
    ev.push(['J', t + 6000 - 1000 - 110, fj, 1]);
    must('five pauses in one round, judged 110 ms early (coarse clock)', mkLog(ev), 1, 1); }
  // A browser tab hidden for five minutes mid-round (no frames: the bar
  // freezes in the zone - not a pause), then a normal run.
  { const g = forgeLog({ seed: 52, rounds: 25, forceHit: true, hideRound: 2, hideMs: 300000 });
    must('tab hidden 5 min mid-round, bar frozen in the zone', g.log, g.hits, g.hits); }
  // A run so long run.ev stopped at MAX_EVENTS; each later high still submits.
  { const g = forgeLog({ seed: 53, rounds: 2400, forceHit: true });
    const l = g.log; l.ev = l.ev.slice(0, Q.LIMITS.MAX_EVENTS);
    const proven = l.ev.filter(e => e[0] === 'J' && e[3] === 1).length;
    must('log cut at MAX_EVENTS, higher claim', l, g.hits, proven);
    console.log('    (' + proven + ' of ' + g.hits + ' points in the first ' + Q.LIMITS.MAX_EVENTS + ' events; ' + JSON.stringify(l).length + ' bytes)'); }
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
  expect('no events + claim', { v: 1, rv: 1, type: 'axe', a: 0, env: { w: 0, h: 0, mob: false, ping: 0 }, ev: [] }, 12);
  // 2. claim above the logged points
  expect('claim above the logged points', clone(base.log), base.streak + 5);
  // 3. times scaled x0.5
  { const l = clone(base.log); l.ev.forEach(e => { e[1] = Math.round(e[1] * 0.5); }); expect('times scaled x0.5', l, base.streak); }
  // 4. outcome flipped: the final miss marked a hit (and its end dropped)
  { const l = clone(base.log); let j = -1; for (let i = l.ev.length - 1; i >= 0; i--) if (l.ev[i][0] === 'J' && l.ev[i][3] === 0) { j = i; break; }
    if (j < 0) { // base ended by cap: flip the last hit's fill out of the zone instead
      for (let i = l.ev.length - 1; i >= 0; i--) if (l.ev[i][0] === 'J') { j = i; break; }
      l.ev[j][2] = 0.2; expect('hit logged with a fill outside the zone', l, base.streak);
    } else { l.ev[j][3] = 1; l.ev.splice(j + 1, 1); expect('miss flipped to hit', l, base.streak + 1); } }
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'J' && e[3] === 1); l.ev[i][3] = 0; expect('hit flipped to miss mid-run', l, base.streak); }
  // 5. targets outside the range / wrong width / wrong count
  { const l = clone(base.log); const i = l.ev.findIndex((e, k) => k > 3 && e[0] === 'R'); const w = l.ev[i][4] - l.ev[i][3]; l.ev[i][3] = 0.88; l.ev[i][4] = 0.88 + w; expect('zone centre above the draw range', l, base.streak); }
  { const l = clone(base.log); l.ev.forEach(e => { if (e[0] === 'R' && e[2] >= 5) { const c = (e[3] + e[4]) / 2; e[3] = c - 0.05; e[4] = c + 0.05; } }); expect('zones wider than the streak allows', l, base.streak); }
  { const l = clone(base.log); const i = l.ev.findIndex((e, k) => k > 3 && e[0] === 'R'); l.ev.splice(i, 1); expect('a round with no zone (target missing)', l, base.streak); }
  { const l = clone(base.log); const i = l.ev.findIndex((e, k) => k > 3 && e[0] === 'R'); l.ev.splice(i + 1, 0, l.ev[i].slice()); expect('two zones for one round', l, base.streak); }
  { const l = clone(base.log); l.ev.forEach(e => { if (e[0] === 'R' && e[2] > 0) e[2] -= 1; }); expect('rounds claim a lower streak (easier curve)', l, base.streak); }
  { const l = clone(base.log); l.type = 'axe-comp'; expect('casual log sent as competitive', l, base.streak); }
  // 6. cherry-picked easiest targets: zones only at the bottom of the range
  { const sim = goodLong(900, { zoneRand: (() => { const z = mulberry32(3); return () => z() * 0.06; })() }); expect('cherry-picked zones (all low)', sim.log, sim.streak); }
  // 7. perfect bot: exact plan, no timing or aim error
  { const p = humanPlayer(mulberry32(11), 1); Object.assign(p, { sigma0: 0, weber: 0, aimSd: 0, miscount: 0, adapt: 1, warm: 0, gap: 0, antic: null });
    const sim = goodLong(1200, { player: p, hz: 144 }); expect('perfect bot (zero error)', sim.log, sim.streak); }
  // 8. metronome bot: presses exactly evenly spaced
  { const p = humanPlayer(mulberry32(12), 0.95); Object.assign(p, { tapCv: 0, jitterMs: 1, tapMu: 110, antic: null });
    const sim = goodLong(1400, { player: p }); expect('metronome bot', sim.log, sim.streak); }
  // 9. (no reaction check: a first press right at a round start is anticipation
  //    of the fixed 700 ms wait, and it decides nothing - see the honest
  //    anticipating players. Such logs are accepted at the points they prove.)
  // 10. times fine, order impossible
  { const l = clone(base.log); const j = l.ev.findIndex(e => e[0] === 'J'); const k = j - 1; const t = l.ev[j][1]; l.ev[j][1] = l.ev[k][1]; l.ev[k][1] = t; const tmp = l.ev[j]; l.ev[j] = l.ev[k]; l.ev[k] = tmp; expect('last press and judgement swapped', l, base.streak); }
  { const l = clone(base.log); const j = l.ev.findIndex((e, k) => e[0] === 'R' && e[5] === 'n'); const e = l.ev.splice(j, 1)[0]; l.ev.splice(j - 1, 0, [e[0], l.ev[j - 2][1], e[2], e[3], e[4], e[5]]); expect('next round before the hit', l, base.streak); }
  { const l = clone(base.log); l.ev.unshift(['J', 0, 0.5, 1]); expect('judgement before the first round', l, base.streak); }
  // 11. replayed honest log, higher claim
  expect('replayed honest log, higher claim', clone(base.log), base.streak * 2);
  // 12. axe-specific
  // a judged fill nudged inside its zone: up (no press did it) or down (faster than the drain)
  function zoneOf(l, i) { for (let k = i; k >= 0; k--) if (l.ev[k][0] === 'R') return l.ev[k]; }
  function sixPresses(t0) { const ev = []; let f = 0; for (let i = 0; i < 6; i++) { f = i ? f - 0.006 + 0.09 : 0.09; ev.push(['K', t0 + 100 * i, Math.round(f * 1e4) / 1e4, 'k']); } return ev; }
  // last press leaves 0.51 at 4500; by 6000 the bar is at ~0.42 (a miss) - logged as 0.52
  expect('judged fill above the last press (still in zone)', mkLog([['R', 0, 0, 0.45, 0.56, 's']].concat(sixPresses(4000), [['J', 6000, 0.52, 1]])), 1);
  // last press leaves 0.51 at 5900; by 6000 the bar can only be down to ~0.49 - logged as 0.46
  expect('judged fill drained faster than 0.06/s (still in zone)', mkLog([['R', 0, 0, 0.45, 0.56, 's']].concat(sixPresses(5400), [['J', 6000, 0.46, 1]])), 1);
  { const missed = goodLong(2000, { maxRounds: 150, player: humanPlayer(mulberry32(21), 0.5) }, 5);
    const l = clone(missed.log); const j = l.ev.findIndex(e => e[0] === 'J' && e[3] === 0);
    if (j < 0) fail('no miss to forge from');
    else { const t = l.ev[j]; l.ev[j] = l.ev[j + 1]; l.ev[j + 1] = t; l.ev[j][1] = t[1]; expect('end logged before its judgement (same time)', l, missed.streak); }
    const l2 = clone(missed.log); l2.ev[l2.ev.length - 1][2] = l2.ev[l2.ev.length - 1][2] === 'low' ? 'high' : 'low';
    expect('end reason contradicts the judged fill', l2, missed.streak); }
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'K'); l.ev[i][2] = Math.round((l.ev[i][2] + 0.09) * 1e4) / 1e4; expect('a press worth two', l, base.streak); }
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'J' && e[3] === 1); const t = l.ev[i][1];
    l.ev.splice(i + 1, 0, ['P', t + 10], ['U', t + 20], ['J', t + 30, l.ev[i][2], 1]); expect('pause-in-gap re-judge (old bug)', l, base.streak + 1); }
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'R' && e[5] === 'n'); const gapStart = l.ev.slice(0, i).reverse().find(e => e[0] === 'J')[1];
    const shift = l.ev[i][1] - (gapStart + 300); for (let k = i; k < l.ev.length; k++) l.ev[k][1] -= shift; expect('gap cut to 300 ms', l, base.streak); }
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'K'); const t = l.ev[i][1]; l.ev.splice(i, 0, ['P', t]); l.ev.splice(i + 2, 0, ['U', t]); expect('a press logged while paused', l, base.streak); }
  { const l = clone(base.log); const i = l.ev.findIndex(e => e[0] === 'J' && e[3] === 1); l.ev.splice(i + 1, 0, ['K', l.ev[i][1] + 5, 0.09, 'k']); expect('a round press in the gap', l, base.streak); }
  // a log where the bar never drains: zones picked to sit on a multiple of 0.09
  { const ev = []; let t = 0; const zr = mulberry32(99); let k = 0;
    for (; k < 30; k++) {
      const sz = A.size(k, false); const n = 6 + Math.floor(zr() * 3); const c = A.PRESS * n + (zr() - 0.5) * sz * 0.8;
      ev.push(['R', t, k, Math.round((c - sz / 2) * 1e4) / 1e4, Math.round((c + sz / 2) * 1e4) / 1e4, k ? 'n' : 's']);
      let tt = t + 300 + Math.floor(zr() * 400), f = 0;
      for (let p = 0; p < n; p++) { f = Math.round((f + A.PRESS) * 1e4) / 1e4; ev.push(['K', tt, f, 'k']); tt += 120 + Math.floor(zr() * 60); }
      t += A.timer(k, false) * 1000 + 10; ev.push(['J', t, f, 1]); t += 710;
    }
    expect('bar never drains', { v: 1, rv: 1, type: 'axe', a: 0, env: { w: 1, h: 1, mob: false, ping: 0 }, ev }, 30); }
  { const l = clone(base.log); l.ev.push(['K', l.ev[l.ev.length - 1][1] + 5, 0.09, 'k']); expect('events after the end', l, base.streak); }
  { const l = clone(base.log); l.ev[0][1] = 5000; for (let k = 1; k < l.ev.length; k++) l.ev[k][1] += 5000; expect('first round long after Start', l, base.streak); }

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
    expect('a round marked g (the dropped resume-round kind)', l, base.streak); }
  // 14. minimal and hand-made logs
  { const ev = []; let t = 0;
    for (let k = 0; k < 20; k++) { const sz = A.size(k, false); ev.push(['R', t, k, 0.6 - sz / 2, 0.6 + sz / 2, k ? 'n' : 's']); t += A.timer(k, false) * 1000; ev.push(['J', t, 0.6, 1]); t += 700; }
    expect('R + J only, no presses', { v: 1, rv: 1, type: 'axe', a: 0, env: { w: 1, h: 1, mob: false, ping: 0 }, ev }, 20); }
  expect('same zone every round (a target reused)', forgeLog({ seed: 35, rounds: 40, centre: () => 0.6 }).log, 40);
  expect('identical timing every round (no aim or timing error)', forgeLog({ seed: 36, rounds: 40, aimSd: 0, timeSd: 0 }).log, 40);
  expect('presses exactly 120 ms apart', forgeLog({ seed: 37, rounds: 40, iv: () => 120 }).log, 40);
  { const g = forgeLog({ seed: 38, rounds: 30 }); const l = g.log; const bump = (i, fn) => { const x = clone(l); fn(x.ev[i], x); return x; };
    const kI = l.ev.findIndex(e => e[0] === 'K'), jI = l.ev.findIndex(e => e[0] === 'J'), rI = 0;
    expect('fill as a string', bump(kI, e => { e[2] = String(e[2]); }), 30);
    expect('hit as true', bump(jI, e => { e[3] = true; }), 30);
    expect('fill null (NaN in JSON)', bump(jI, e => { e[2] = null; }), 30);
    expect('negative fill', bump(jI, e => { e[2] = -0.5; }), 30);
    expect('huge fill', bump(kI, e => { e[2] = 1e300; }), 30);
    expect('huge zone', bump(rI, e => { e[4] = 1e300; }), 30);
    expect('streak 0.5', bump(rI, e => { e[2] = 0.5; }), 30);
    expect('negative time', bump(kI, (e, x) => { for (let i = 0; i < kI; i++) x.ev[i][1] = -5; e[1] = -5; }), 30);
    expect('fractional time', bump(kI, e => { e[1] += 0.5; }), 30);
    expect('extra field on a press', bump(kI, e => { e.push(1); }), 30);
    expect('press source unknown', bump(kI, e => { e[3] = 'bot'; }), 30);
    expect('unknown event code', (() => { const x = clone(l); x.ev.splice(3, 0, ['Z', x.ev[2][1]]); return x; })(), 30);
    expect('judgement duplicated', (() => { const x = clone(l); x.ev.splice(jI + 1, 0, x.ev[jI].slice()); return x; })(), 30);
    expect('resume with no pause', (() => { const x = clone(l); x.ev.splice(2, 0, ['U', x.ev[1][1]]); return x; })(), 30);
    expect('reset before any round', (() => { const x = clone(l); x.ev.unshift(['E', 0, 'x']); return x; })(), 30);
    expect('end twice', (() => { const x = clone(l); x.ev.push(['E', x.ev[x.ev.length - 1][1], 'x'], ['E', x.ev[x.ev.length - 1][1], 'x']); return x; })(), 30);
    expect('a million claimed', clone(l), 1e6);
    expect('log for another trainer', (() => { const x = clone(l); x.type = 'axe-comp'; return x; })(), 30);
  }

  for (const x of results) console.log('  forgery: ' + x.name + ' -> ' + x.verdict + (x.reason ? ' (' + x.reason.slice(0, 90) + ')' : ''));
  console.log(`forgeries: ${results.length} tried, ${results.filter(x => !/^valid/.test(x.verdict)).length} invalid or review`);
  return results;
}

// ── c) run ───────────────────────────────────────────────────────────────────
const t0 = Date.now();
const h = honestSuite();
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
console.log(`summary: honest ${h.runs} runs (invalid ${h.invalid}, review ${h.review}, mismatch ${h.mismatch}); forgeries ${f.length}; ${failures ? failures + ' FAILURE(S)' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
