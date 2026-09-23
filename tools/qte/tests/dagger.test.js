// Node test for the dagger check (dagger.rules.js).
//   node dagger.test.js [runs]
// a) honest players simulated from the rules, through a copy of the trainer's
//    state machine (js/qte.js DAGGER IIFE) driven by a frame / timer / key
//    event queue, writing the log the IIFE writes;
// b) forgeries, each of which must come out invalid, held, or far below its claim.
'use strict';
require('./_paths.js');
const Q = require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const R = Q.trainers.dagger;
const TAU = Math.PI * 2;

let failed = false;
function fail(msg) { failed = true; console.log('FAIL ' + msg); }

// ── randomness ──────────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// A coarse clock as Firefox's reduceTimerPrecision with jitter makes it: time
// is clamped to a multiple of g, and rounded UP to the next multiple once it
// passes a per-bucket pseudo-random midpoint. Monotonic; it can read up to g
// ahead of the real time, or up to g behind.
function coarsen(x, g) {
  const k = Math.floor(x / g);
  const mid = g * (((Math.imul(k | 0, 2654435761) >>> 0) % 1000) / 1000);
  return x - k * g >= mid ? (k + 1) * g : k * g;
}
function tools(rnd) {
  const gauss = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rnd()); };
  return {
    gauss,
    U: (a, b) => a + (b - a) * rnd(),
    logn: (med, s) => med * Math.exp(s * gauss()),
    pick: a => a[Math.floor(rnd() * a.length)],
  };
}

// ── event queue ─────────────────────────────────────────────────────────────
function makeQueue() {
  const items = []; let seq = 0;
  return {
    push(at, fn) {
      const it = { at, seq: seq++, fn, dead: false };
      let lo = 0, hi = items.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; const m = items[mid]; if (m.at < at || (m.at === at && m.seq < it.seq)) lo = mid + 1; else hi = mid; }
      items.splice(lo, 0, it);
      return it;
    },
    pop() { return items.shift(); },
    get size() { return items.length; },
  };
}

// ── the simulator ───────────────────────────────────────────────────────────
// o: { seed, comp, player, period, dropP, stallP, pauses: [{at, dur, never}],
//      gameRand(rnd) -> () => number (the IIFE's Math.random), best }
function simulate(o) {
  const rnd = mulberry32(o.seed);
  const { gauss, U, logn } = tools(rnd);
  const gameRand = o.gameRand ? o.gameRand(rnd) : rnd;
  const pl = o.player;
  const comp = !!o.comp;
  const q = makeQueue();
  const period = o.period || 1000 / 60;
  const phase = rnd() * period;
  const dropP = o.dropP == null ? 0.01 : o.dropP;
  const stallP = o.stallP == null ? 0.001 : o.stallP;
  const keyboard = !pl.mobile;
  const ping = keyboard ? (pl.ping || 0) : 0;
  const pingEff = ping * (pl.pingComp || 1);
  let now = 1000 + rnd() * 5000;
  // o.coarse: performance.now() coarsened to buckets of this many ms with
  // jittered edges (Firefox resistFingerprinting / LibreWolf / Tor use 100 or
  // 16.67). o.coarseRaf: rAF stamps coarsened the same way (else exact).
  const pc = o.coarse ? x => coarsen(x, o.coarse) : x => x;
  const pnow = () => pc(now);
  const t0 = now, t0c = pc(now);

  // trainer state (names as in js/qte.js)
  let running = false, gameStarted = false, paused = false, streak = 0, rings = [], currentRing = 0;
  let roundPending = false, pendingTimer = null, roundEndTime = 0, lastTime = 0, roundGT = 0;
  let rafItem = null, lastFrameTs = now;
  let closed = false, ended = false;
  const log = { v: 1, rv: Q.RULES_VER, type: 'dagger' + (comp ? '-comp' : ''), a: 0,
    env: { w: 1280, h: 720, mob: !keyboard, ping: ping }, ev: [] };
  const subs = [];
  let best = o.best || 0;
  const info = { frames: 0, drops: 0, negDt: 0, maxGap: 0 };

  function ev(code, ...f) {
    if (closed || log.ev.length >= Q.LIMITS.MAX_EVENTS) return;
    const e = [code, Math.max(0, Math.round(pnow() - t0c))];
    for (const x of f) e.push(typeof x === 'number' ? Math.round(x * 10000) / 10000 : x);
    log.ev.push(e);
  }
  function snapshot() { return { v: 1, rv: log.rv, type: log.type, a: 0, env: log.env, ev: log.ev.slice() }; }
  function nextTick(x) { return phase + Math.ceil((x - phase) / period) * period; }
  function timer(d, fn) {
    const late = rnd() < 0.05 ? U(5, 100) : U(-0.9, 4);
    return q.push(now + d + late, fn);
  }
  function requestFrame(fromClick) {
    let ts;
    const nt = nextTick(now + 0.001);
    if (fromClick && rnd() < 0.4 && now - (nt - period) < 4) { ts = nt - period; info.negDt++; }
    else {
      ts = nt;
      if (rnd() < dropP) { ts += period * (1 + Math.floor(rnd() * 3)); info.drops++; }
      if (rnd() < stallP) { ts = nextTick(ts + U(40, 250)); info.drops++; }
    }
    const cb = Math.max(ts, now) + U(0.05, 1.5);
    // o.ahead: a browser that stamps the frame with the NEXT vsync (up to a
    // frame ahead of performance.now() when the callback runs)
    let stamp = o.ahead && ts >= now ? ts + period * U(0.5, 1) : ts;
    if (o.coarse && o.coarseRaf) stamp = pc(stamp);
    return q.push(cb, () => { rafItem = null; gameLoop(stamp); });
  }

  // ── the IIFE ──
  function startRound() {
    roundPending = false;
    const count = R.ringCount(streak, comp);
    rings = [];
    for (let i = 0; i < count; i++) {
      const spd = R.ringSpeed(streak, i, count, comp) * (gameRand() < 0.5 ? 1 : -1);
      const startGap = R.startGap(gameRand());
      rings.push({ start: startGap, vel: spd });
    }
    currentRing = count - 1;
    roundGT = 0;
    roundEndTime = pnow() + R.C.ROUND_MS;
    ev('R', streak, ...rings.map(r => r.vel > 0 ? r.start : -r.start));
    human.onRound();
  }
  function gameLoop(ts) {
    if (!running) return;
    info.frames++;
    const dtMs = Math.min(ts - lastTime, R.C.DT_MAX_MS);
    if (ts - lastTime > info.maxGap) info.maxGap = ts - lastTime;
    lastTime = ts; lastFrameTs = ts;
    if (!roundPending) {
      roundGT += dtMs;
      const secsLeft = Math.max(0, (roundEndTime - ts) / 1000);
      if (secsLeft <= 0) { triggerFail('time'); return; }
    }
    drawFrame(ts);
    rafItem = requestFrame(false);
  }
  function drawFrame(ts) {
    const ring = rings[currentRing];
    if (ring && ring.expandFrom !== undefined && Math.min((ts - ring.expandStart) / R.C.EXPAND_MS, 1) >= 1) delete ring.expandFrom;
  }
  function onSpacePress(src) {
    if (!running || paused || roundPending) return 'ignored';
    const ring = rings[currentRing];
    if (!ring || ring.expandFrom !== undefined) return 'ignored';
    const gT = R.roundG(roundGT);
    const hit = R.judge(ring.start, ring.vel, gT, streak, comp).hit;
    ev('K', currentRing, gT, hit ? 1 : 0, src);
    if (!hit) { triggerFail('miss'); return 'miss'; }
    ring._acc = now;
    rings.splice(currentRing, 1);
    currentRing = rings.length - 1;
    if (rings.length === 0) { onRoundSuccess(); return 'hit'; }
    rings[currentRing].expandFrom = 1;
    rings[currentRing].expandStart = pnow();
    return 'hit';
  }
  function onRoundSuccess() {
    streak++;
    if (streak > best) { best = streak; subs.push({ claimed: streak, log: snapshot() }); }
    roundPending = true;
    if (pendingTimer) pendingTimer.dead = true;
    pendingTimer = timer(R.C.ROUND_GAP_MS, () => { pendingTimer = null; if (running) startRound(); });
  }
  function triggerFail(why) {
    if (!running && !gameStarted) return;
    running = paused = roundPending = false;
    ev('E', why);
    closed = true; ended = true;
  }
  function hide() {
    if (paused) return;
    if (gameStarted && running) {
      if (rafItem) { rafItem.dead = true; rafItem = null; }
      running = false; paused = true;
      ev('P');
      if (pendingTimer) { pendingTimer.dead = true; pendingTimer = null; }
    }
  }
  function show() { if (paused) drawFrame(pnow()); }
  function resume() {
    if (!paused) return;
    paused = false; running = true;
    ev('U');
    lastTime = pnow();
    if (roundPending && !pendingTimer) pendingTimer = timer(R.C.RESUME_GAP_MS, () => { pendingTimer = null; if (running) startRound(); });
    rafItem = requestFrame(true);
  }

  // ── the player ──
  const H = { gen: 0, hold: false, holdGen: 0, pauseGen: 0 };
  function deliver(src, tag) {
    // keys go through the ping simulator (setTimeout(ping)); touch does not
    let at = now + U(0.02, 0.6);
    if (keyboard && ping > 0) {
      at = now + ping + (rnd() < 0.05 ? U(4, 40) : U(0, 4));
      src = src === 'r' ? 'q' : 'p';      // the IIFE marks the simulator's delayed copies
    }
    q.push(at, () => {
      if (ended) return;
      const res = onSpacePress(src);
      human.after(res, tag);
    });
    if (!keyboard && rnd() < (pl.doubleFire || 0)) {
      q.push(now + U(60, 350), () => { if (ended) return; const res = onSpacePress('c'); human.after(res, 'dbl'); });
    }
  }
  function physical(at, tag) {
    const g = H.gen;
    q.push(Math.max(at, now), () => { if (g !== H.gen || paused || ended) return; deliver(keyboard ? 'k' : 't', tag); });
  }
  function later(at, fn) { const g = H.gen; q.push(Math.max(at, now), () => { if (g !== H.gen || paused || ended) return; fn(); }); }
  function startHold(at) {
    H.hold = true; const hg = ++H.holdGen;
    q.push(Math.max(at, now), () => {
      if (!H.hold || hg !== H.holdGen || paused || ended) return;
      deliver('k', 'hold');
      const rep = at + U(400, 600);
      const tick = t => q.push(t, () => {
        if (!H.hold || hg !== H.holdGen || paused || ended) return;
        deliver('r', 'hold');
        tick(t + 1000 / 30);
      });
      tick(rep);
    });
  }
  function release(at) { const hg = H.holdGen; q.push(Math.max(at, now), () => { if (hg === H.holdGen) H.hold = false; }); }
  function stopping() { return streak >= pl.maxRounds; }

  function planCW(ring, kind) {
    const lockEnd = ring.expandFrom !== undefined ? ring.expandStart + R.C.EXPAND_MS : now;
    const lead = kind === 'round' ? U(60, 200) : U(30, 150);
    const earliest = Math.max(now + lead + pingEff, lockEnd + U(10, 80) + (kind === 'resume' ? 0 : 0));
    const Gnow = roundGT + (now - lastFrameTs);
    const Gear = Gnow + (earliest - now);
    const v = ring.vel;
    const m = Math.ceil((ring.start + v * Gear / 1000) / TAU);
    const Gc = (m * TAU - ring.start) * 1000 / v;
    const tc = earliest + (Gc - Gear);
    let err = pl.bias + pl.sigma * gauss();
    if (rnd() < pl.lapse) err += pl.sigma * 4 * gauss();
    physical(tc + err - pingEff, 'plan');
  }
  function planCCW(ring, kind) {
    const lockEnd = ring.expandFrom !== undefined ? ring.expandStart + R.C.EXPAND_MS : now;
    if (kind === 'resume') { physical(now + logn(pl.react, pl.reactSd), 'plan'); return; }
    if (pl.style === 'mash') {
      const start = now + U(40, 120);
      const pp = U(70, 140);
      let t = start;
      const pg = H.pauseGen;
      for (let k = 0; k < 14; k++) {
        q.push(Math.max(t, now), () => {
          if (pg !== H.pauseGen || paused || ended) return;
          if (ring._acc != null && now - ring._acc > pl.obs) return; // saw it pass: stop mashing
          deliver(keyboard ? 'k' : 't', 'mash');
        });
        t += pp * (1 + 0.15 * gauss());
      }
      return;
    }
    if (pl.style === 'hold') { if (!H.hold) startHold(now + U(40, 120)); return; }
    physical(Math.max(now, lockEnd - pingEff * rnd()) + logn(pl.ccwWait, 0.35), 'plan');
  }
  function decide(kind) {
    if (!running || paused || roundPending || !rings.length || stopping()) return;
    const ring = rings[currentRing];
    if (ring.vel < 0) planCCW(ring, kind); else planCW(ring, kind);
  }
  const human = {
    onRound() {
      H.gen++; H.hold = false;
      if (stopping()) return;
      const seeAt = nextTick(now + 0.001) + U(0.05, 1.5);
      const ring = rings[currentRing];
      if (ring.vel < 0) physical(seeAt + logn(pl.react, pl.reactSd), 'plan');
      else later(seeAt + U(120, 250), () => decide('round'));
    },
    after(res, tag) {
      if (res === 'hit') {
        if (roundPending) { if (H.hold) release(now + U(60, 200)); return; }
        const next = rings[currentRing];
        if (H.hold && next.vel > 0) release(now + U(40, 160));
        if (H.hold && next.vel < 0) return;          // the held key takes it
        H.gen++;                                     // drop leftovers of the last plan (mash keeps its own guard)
        later(now + U(30, 120), () => decide('next'));
      } else if (res === 'ignored' && tag === 'plan') {
        later(now + U(150, 250), () => decide('retry'));
      }
    },
  };

  // pauses
  for (const p of (o.pauses || [])) {
    const hAt = t0 + p.at;
    q.push(hAt, () => {
      if (ended) return;
      if (!gameStarted || !(running || paused)) return;
      H.gen++; H.pauseGen++; H.hold = false;
      hide();
      if (p.never) { q.push(hAt + 1, () => { ended = true; }); return; }
      const uAt = hAt + p.dur;
      q.push(Math.max(hAt + 5, uAt - U(200, 1500)), () => { if (!ended) show(); });
      q.push(uAt, () => {
        if (ended) return;
        resume();
        H.gen++;
        later(now + U(300, 800), () => decide('resume'));
      });
    });
  }

  // Start
  running = gameStarted = true;
  lastTime = pnow();
  startRound();
  rafItem = requestFrame(true);

  const limit = t0 + 40 * 60 * 1000;
  while (!ended && q.size) {
    const it = q.pop();
    if (it.dead) continue;
    if (it.at > limit) break;
    now = it.at;
    it.fn();
  }
  return { log, streak, subs, info };
}

// mash players track which ring they are mashing for: patch after() to record it
// (kept simple: the mash guard above stops when the ring changed and obs passed)

// ── players ─────────────────────────────────────────────────────────────────
function makePlayer(rnd, level, cfg) {
  const { gauss, U, pick } = tools(rnd);
  const lerp = (a, b) => a + (b - a) * level;
  const mobile = !!cfg.mobile;
  const ping = mobile ? 0 : cfg.ping;
  let style = rnd() < 0.6 ? 'wait' : (rnd() < 0.65 ? 'mash' : 'hold');
  if (style === 'hold' && (ping > 0 || mobile)) style = 'wait';
  return {
    level,
    sigma: lerp(60, 9) * U(0.85, 1.15),
    bias: gauss() * lerp(16, 6),
    react: U(220, 320),
    reactSd: U(0.15, 0.3),
    ccwWait: U(120, 260),
    lapse: lerp(0.03, 0.003),
    style,
    obs: U(90, 200),
    ping,
    pingComp: U(0.92, 1.04),
    mobile,
    doubleFire: mobile ? 0.03 : 0,
    maxRounds: cfg.maxRounds != null ? cfg.maxRounds : pick([5, 10, 15, 20, 30, 45, 60, 1e9]),
  };
}
function makePauses(rnd, prob) {
  const { U } = tools(rnd);
  const out = [];
  if (rnd() >= prob) return out;
  const n = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const r = rnd();
    const dur = r < 0.5 ? U(150, 2000) : (r < 0.85 ? U(2000, 7000) : U(7000, 60000));
    out.push({ at: U(0, 90000), dur, never: rnd() < 0.04 });
  }
  return out.sort((a, b) => a.at - b.at);
}

function check(log, claimed, comp) {
  return Q.check(log.type, log, { platform: log.env.mob ? 'M' : 'C', claimed });
}

// ── a) honest ───────────────────────────────────────────────────────────────
function honestSuite(runs) {
  const rnd = mulberry32(12345);
  const { pick, U } = tools(rnd);
  let n = 0, invalid = 0, review = 0, mismatch = 0, checks = 0;
  const reasons = {};
  const byLevel = {};
  let maxScore = 0, maxEvents = 0, maxBytes = 0;
  const offSds = [];
  const cov = {};
  let minCcwP = 1, minKsP = 1;
  for (let k = 0; k < runs; k++) {
    // the last fifth: strong players with no stopping point (long runs)
    const long = k >= runs * 0.8;
    const comp = rnd() < 0.5;
    const mobile = !long && rnd() < 0.2;
    const cfg = { mobile, ping: pick(long ? [0, 0, 150] : [0, 0, 150, 300]), maxRounds: long ? 150 : undefined };
    const level = long ? U(0.8, 1) : Math.sqrt(rnd());
    const player = makePlayer(rnd, level, cfg);
    const hz = pick([60, 60, 60, 120, 144, 30]);
    const coarse = rnd() < 0.125 ? pick([100, 100, 16.67, 1]) : 0;
    const sim = simulate({
      seed: 1000 + k, comp, player,
      period: 1000 / hz,
      dropP: pick([0, 0.002, 0.01, 0.04]),
      stallP: pick([0, 0.0002, 0.001, 0.004]),
      pauses: makePauses(rnd, 0.35),
      ahead: rnd() < 0.2,
      // one run in eight on a coarsened clock (privacy browsers)
      coarse: coarse,
      coarseRaf: rnd() < 0.5,
    });
    if (coarse) cov['coarse' + coarse] = (cov['coarse' + coarse] || 0) + 1;
    n++;
    const bucket = level < 0.25 ? 'new' : level < 0.5 ? 'mid' : level < 0.8 ? 'good' : 'top';
    byLevel[bucket] = byLevel[bucket] || { runs: 0, review: 0, score: 0 };
    byLevel[bucket].runs++; byLevel[bucket].score += sim.streak;
    maxScore = Math.max(maxScore, sim.streak);
    maxEvents = Math.max(maxEvents, sim.log.ev.length);
    maxBytes = Math.max(maxBytes, JSON.stringify(sim.log).length);
    // what gets checked: the last submission, one earlier one, and the whole log
    const todo = [{ log: sim.log, claimed: sim.streak, final: true }];
    if (sim.subs.length) todo.push(sim.subs[sim.subs.length - 1]);
    if (sim.subs.length > 2) todo.push(sim.subs[Math.floor(rnd() * (sim.subs.length - 1))]);
    let runReview = false;
    {
      const ev = sim.log.ev, last = ev[ev.length - 1];
      if (last[0] === 'E') cov['end ' + last[2]] = (cov['end ' + last[2]] || 0) + 1; else cov['end open'] = (cov['end open'] || 0) + 1;
      if (ev.some(e => e[0] === 'P')) cov.paused = (cov.paused || 0) + 1;
      if (ev.some(e => e[0] === 'K' && e[5] === 'r')) cov.keyRepeat = (cov.keyRepeat || 0) + 1;
      if (ev.some(e => e[0] === 'K' && e[5] === 'c')) cov.dblClick = (cov.dblClick || 0) + 1;
      if (ev.some(e => e[0] === 'K' && e[3] < 0)) cov.negG = (cov.negG || 0) + 1;
      if (sim.info.maxGap > 50) cov.clampedFrames = (cov.clampedFrames || 0) + 1;
    }
    for (const s of todo) {
      checks++;
      const r = check(s.log, s.claimed, comp);
      if (r.verdict === 'invalid') {
        invalid++;
        if (invalid <= 5) console.log('  honest invalid:', r.reasons[0], 'seed', 1000 + k, JSON.stringify(sim.info));
      }
      if (r.score !== s.claimed) {
        mismatch++;
        if (mismatch <= 5) console.log('  honest mismatch: claimed', s.claimed, 'score', r.score, r.reasons, r.stats.stopReason, 'seed', 1000 + k);
      }
      if (r.verdict === 'review') {
        runReview = true;
        for (const why of r.reasons) reasons[why.replace(/[\d.]+/g, '#')] = (reasons[why.replace(/[\d.]+/g, '#')] || 0) + 1;
      }
      if (s.final && r.stats.offSd != null && r.stats.cwHits >= 20) offSds.push(r.stats.offSd);
      if (s.final && r.stats.lateAfterResume) cov.lateAfterResume = (cov.lateAfterResume || 0) + 1;
      if (s.final && r.stats.ccwP != null) minCcwP = Math.min(minCcwP, +r.stats.ccwP);
      if (s.final && r.stats.startKsP != null) minKsP = Math.min(minKsP, +r.stats.startKsP);
    }
    if (runReview) { review++; byLevel[bucket].review++; }
  }
  const rate = review / n;
  offSds.sort((a, b) => a - b); if (process.env.DBG) console.log('offSd n', offSds.length, 'q', [0.001,0.01,0.05,0.5].map(p => offSds[Math.floor(p*offSds.length)].toFixed(1)).join(' '), '<6:', offSds.filter(x=>x<6).length, '<7:', offSds.filter(x=>x<7).length);
  console.log(`honest: ${n} runs (${checks} checks) - invalid ${invalid}, review ${review} (${(rate * 100).toFixed(2)}%), score mismatch ${mismatch}; max score ${maxScore}, max events ${maxEvents}, max log ${maxBytes} B; min offSd ${offSds[0] && offSds[0].toFixed(1)} ms`);
  for (const b of Object.keys(byLevel)) console.log(`  ${b}: ${byLevel[b].runs} runs, mean score ${(byLevel[b].score / byLevel[b].runs).toFixed(1)}, review ${byLevel[b].review}`);
  if (Object.keys(reasons).length) console.log('  review reasons:', reasons);
  console.log('  coverage:', JSON.stringify(cov), 'min ccwP', minCcwP.toExponential(1), 'min startKsP', minKsP.toExponential(1));
  if (invalid) fail('honest runs judged invalid: ' + invalid);
  if (mismatch) fail('honest runs with a score mismatch: ' + mismatch);
  if (rate > 0.005) fail('honest review rate ' + (rate * 100).toFixed(2) + '% > 0.5%');
  return { runs: n, invalid, review, mismatch };
}

// ── b) forgeries ────────────────────────────────────────────────────────────
function goodRun(seedBase, comp, minScore, extra) {
  const rnd = mulberry32(seedBase);
  for (let k = 0; k < 400; k++) {
    const player = Object.assign(makePlayer(rnd, 0.9, { ping: 0, maxRounds: minScore + 3 }), { style: 'wait' }, extra || {});
    const sim = simulate(Object.assign({ seed: seedBase * 7 + k, comp, player, dropP: 0.01 }, extra && extra.sim || {}));
    if (sim.streak >= minScore) return sim;
  }
  throw new Error('no run reached ' + minScore);
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function lastSub(sim) { return sim.subs[sim.subs.length - 1]; }

function forgerySuite() {
  const out = [];
  function expect(name, log, claimed, comp) {
    const r = check(log, claimed, comp);
    const ok = r.verdict === 'invalid' || r.verdict === 'review' || r.score <= claimed / 2;
    out.push({ name, verdict: r.verdict + ' (score ' + r.score + '/' + claimed + ') ' + (r.reasons[0] || r.stats.stopReason || ''), ok });
    if (!ok) fail('forgery passed: ' + name + ' -> ' + r.verdict + ' ' + r.score + '/' + claimed + ' ' + JSON.stringify(r.stats));
    return r;
  }
  const base = goodRun(77, false, 12);
  const baseC = goodRun(78, true, 12);
  const sub = lastSub(base);

  // sanity: the base logs are fine
  const r0 = check(sub.log, sub.claimed, false);
  if (r0.verdict !== 'valid' || r0.score !== sub.claimed) fail('base run not valid: ' + JSON.stringify(r0));

  expect('no events + claim', { v: 1, rv: 1, type: 'dagger', a: 0, env: {}, ev: [] }, 10, false);
  expect('claim above the logged points', sub.log, sub.claimed + 3, false);
  expect('replayed honest log, higher claim', lastSub(baseC).log, lastSub(baseC).claimed + 1, true);
  {
    const l = clone(sub.log); for (const e of l.ev) e[1] = Math.round(e[1] * 0.5);
    expect('times scaled x0.5', l, sub.claimed, false);
  }
  {
    // an honest run that ended on a miss: mark the miss a hit and go on
    const rnd = mulberry32(99);
    let sim;
    for (let k = 0; k < 200; k++) {
      sim = simulate({ seed: 5000 + k, comp: false, player: makePlayer(rnd, 0.3, { ping: 0, maxRounds: 1e9 }) });
      if (sim.streak >= 3 && sim.log.ev[sim.log.ev.length - 1][2] === 'miss') break;
    }
    const l = clone(sim.log); l.ev.pop();
    const k = l.ev[l.ev.length - 1]; k[4] = 1;
    // finish the round with passes 300 ms apart so the claim is one more
    let t = k[1], i = k[2] - 1, G = k[3];
    while (i >= 0) { t += 300; G += 300; l.ev.push(['K', t, i, Math.round(G * 100) / 100, 1, 'k']); i--; }
    expect('outcome flipped (miss marked hit)', l, sim.streak + 1, false);
  }
  {
    const l = clone(sub.log); const e = l.ev.find(x => x[0] === 'R' && x[2] === 3); e[3] = e[3] > 0 ? 1.0 : -1.0;
    expect('target outside the start range', l, sub.claimed, false);
  }
  {
    const l = clone(sub.log); const e = l.ev.find(x => x[0] === 'R' && x[2] === 4); e.pop();
    expect('wrong ring count for the streak', l, sub.claimed, false);
  }
  {
    const l = clone(sub.log); const e = l.ev.find(x => x[0] === 'R' && x[2] === 2); e[2] = 1;
    expect('round streak field wrong', l, sub.claimed, false);
  }
  {
    // every ring counter-clockwise (the free ones): the draw that picks direction always >= 0.5
    const sim = goodRun(81, false, 10, { sim: { gameRand: rnd => { let c = 0; return () => (c++ % 2 === 0 ? 0.5 + 0.5 * rnd() : rnd()); } } });
    const s = lastSub(sim); expect('cherry-picked: all rings counter-clockwise', s.log, s.claimed, false);
  }
  {
    // 80% counter-clockwise, over a long run
    const sim = goodRun(82, true, 25, { sim: { gameRand: rnd => { let c = 0; return () => (c++ % 2 === 0 ? (rnd() < 0.8 ? 0.75 : 0.25) : rnd()); } } });
    const s = lastSub(sim); expect('cherry-picked: 80% counter-clockwise', s.log, s.claimed, true);
  }
  {
    // start angles all near 1.4*PI (the gap starts closest to the arrow)
    const sim = goodRun(83, false, 12, { sim: { gameRand: rnd => { let c = 0; return () => (c++ % 2 === 0 ? rnd() : 0.97 + 0.03 * rnd()); } } });
    const s = lastSub(sim); expect('cherry-picked: nearest start angles', s.log, s.claimed, false);
  }
  {
    const l = clone(sub.log); for (const e of l.ev) if (e[0] === 'R') for (let j = 3; j < e.length; j++) e[j] = -Math.abs(e[j]);
    expect('ring directions rewritten to counter-clockwise', l, sub.claimed, false);
  }
  {
    // perfect bot in a real browser: zero error, no ping, 144 Hz
    const sim = goodRun(84, true, 15, { sigma: 0, bias: 0, lapse: 0, sim: { period: 1000 / 144, dropP: 0, stallP: 0 } });
    const s = lastSub(sim); expect('perfect bot (144 Hz, zero error)', s.log, s.claimed, true);
  }
  {
    const sim = goodRun(85, true, 15, { sigma: 0, bias: 0, lapse: 0, sim: { period: 1000 / 60, dropP: 0, stallP: 0 } });
    const s = lastSub(sim); expect('perfect bot (60 Hz, zero error)', s.log, s.claimed, true);
  }
  {
    // perfect log: every clockwise press at the exact centre of the gap
    const l = clone(sub.log); let rd = null;
    for (const e of l.ev) {
      if (e[0] === 'R') rd = { s: e[2], n: e.length - 3, gs: e.slice(3) };
      if (e[0] === 'K' && rd.gs[e[2]] > 0) {
        const v = R.ringSpeed(rd.s, e[2], rd.n, false), st = rd.gs[e[2]];
        const m = Math.round((st + v * e[3] / 1000) / TAU);
        e[3] = Math.round((m * TAU - st) * 1000 / v * 100) / 100;
      }
    }
    expect('perfect log (every press at the centre)', l, sub.claimed, false);
  }
  {
    // metronome: every press of a round 260 ms apart, rounds exactly 800 ms apart,
    // game time bent (lag) and start angles picked so each clockwise press lands
    const rnd = mulberry32(86); const ev = []; let t = 0, s = 0;
    for (; s < 15; s++) {
      const n = R.ringCount(s, false); const tR = t; const gs = []; const presses = [];
      let prevG = 0;
      for (let k = 0; k < n; k++) {
        const i = n - 1 - k; const tk = tR + 700 + k * 260; const W = tk - tR;
        let dir = rnd() < 0.5 ? 1 : -1; const v = R.ringSpeed(s, i, n, false);
        let st, G;
        let found = false;
        for (let tries = 0; tries < 5000 && !found; tries++) {
          st = R.startGap(rnd()); G = W;
          if (dir < 0) { found = true; break; }
          const m = Math.floor((st + v * W / 1000) / TAU); G = Math.round((m * TAU - st) * 1000 / v * 100) / 100;
          if (m >= 1 && G >= prevG && G <= W) found = true;
        }
        if (!found) { dir = -1; G = W; }   // no clockwise ring fits the beat: draw a free one
        prevG = G; gs[i] = dir * st; presses.push(['K', tk, i, G, 1, 'k']);
      }
      ev.push(['R', tR, s, ...gs.map(x => x)]);
      for (const p of presses) ev.push(p);
      t = presses[presses.length - 1][1] + 800;
    }
    expect('metronome bot', { v: 1, rv: 1, type: 'dagger', a: 0, env: {}, ev }, s, false);
  }
  {
    const sim = goodRun(87, false, 25, { react: 40, reactSd: 0.1 });
    const s = lastSub(sim); expect('superhuman reactions (~40 ms)', s.log, s.claimed, false);
  }
  {
    // impossible order: a press before its round
    const l = clone(sub.log); const i = l.ev.findIndex(x => x[0] === 'R' && x[2] === 5);
    const a = l.ev[i], b = l.ev[i + 1]; const ta = a[1]; l.ev[i] = b; l.ev[i + 1] = a; b[1] = ta; a[1] = ta;
    expect('order: press before its round', l, sub.claimed, false);
  }
  {
    // impossible order: a press while paused
    const l = clone(sub.log); const i = l.ev.findIndex((x, j) => x[0] === 'K' && j > 20);
    l.ev.splice(i + 1, 0, ['U', l.ev[i][1]]); l.ev.splice(i, 0, ['P', l.ev[i][1]]);
    expect('order: press while paused', l, sub.claimed, false);
  }
  {
    // two rings of a round swapped
    const l = clone(sub.log); const i = l.ev.findIndex(x => x[0] === 'R' && x[2] === 6);
    const k1 = l.ev[i + 1], k2 = l.ev[i + 2]; const tmp = k1[2]; k1[2] = k2[2]; k2[2] = tmp;
    expect('order: rings pressed out of turn', l, sub.claimed, false);
  }
  {
    const l = clone(sub.log); const k = l.ev.find((x, j) => x[0] === 'K' && l.ev[j - 1][0] === 'K' && j > 10);
    k[3] += 2000;
    expect('game time ahead of the clock', l, sub.claimed, false);
  }
  for (const gapMs of [50, 140]) {
    // every later event shifted so this press comes gapMs after the last one
    const l = clone(sub.log); const j = l.ev.findIndex((x, j) => x[0] === 'K' && l.ev[j - 1][0] === 'K' && j > 10);
    const d = l.ev[j][1] - (l.ev[j - 1][1] + gapMs); for (let m = j; m < l.ev.length; m++) l.ev[m][1] -= d;
    expect('press ' + gapMs + ' ms into the 220 ms zoom-in lockout', l, sub.claimed, false);
  }
  {
    const l = clone(sub.log); const j = l.ev.findIndex(x => x[0] === 'R' && x[2] === 5);
    for (let m = j; m < l.ev.length; m++) l.ev[m][1] -= 500;
    expect('round started 300 ms after the last', l, sub.claimed, false);
  }
  {
    // presses long after the round's deadline (no pause): points stop counting there
    const l = clone(sub.log); const j = l.ev.findIndex(x => x[0] === 'R' && x[2] === 2);
    for (let m = j + 2; m < l.ev.length; m++) l.ev[m][1] += 9000;
    expect('press after the 8 s deadline', l, sub.claimed, false);
  }
  {
    const l = clone(sub.log); l.type = 'dagger-comp';
    expect('casual log sent as comp', l, sub.claimed, true);
  }
  {
    const l = clone(sub.log); const n = R.ringCount(sub.claimed, false);
    l.ev.push(['R', l.ev[l.ev.length - 1][1] + 900, sub.claimed, ...Array(n).fill(R.startGap(0.5))]); l.ev.push(['E', l.ev[l.ev.length - 1][1] + 50, 'miss']);
    expect('miss end without a missed press', l, sub.claimed, false);
  }
  {
    const l = clone(sub.log); l.ev.push(['E', l.ev[l.ev.length - 1][1] + 900, 'time']); l.ev.push(['R', l.ev[l.ev.length - 1][1] + 900, sub.claimed, ...Array(R.ringCount(sub.claimed, false)).fill(R.startGap(0.5))]);
    expect('events after the end', l, sub.claimed, false);
  }
  // ── review additions ──
  const firstK = l => l.ev.find((x, j) => x[0] === 'K' && j > 10);
  for (const [name, f] of [
    ['G as a string', k => { k[3] = String(k[3]); }],
    ['G "NaN"', k => { k[3] = 'NaN'; }],
    ['G huge (1e15)', k => { k[3] = 1e15; }],
    ['hit as true', k => { k[4] = true; }],
    ['ring index as a string', k => { k[2] = String(k[2]); }],
    ['G with more than 2 dp', k => { k[3] = k[3] + 0.001; }],
    ['source null', k => { k[5] = null; }],
    ['source dropped', k => { k.length = 5; }],
    ['extra field on a press', k => { k.push(1); }],
  ]) {
    const l = clone(sub.log); f(firstK(l));
    expect('wrong field: ' + name, l, sub.claimed, false);
  }
  {
    // G hugely negative: the walk stops there, nothing after it counts
    const l = clone(sub.log); firstK(l)[3] = -1e9;
    expect('G hugely negative', l, sub.claimed, false);
  }
  {
    const l = clone(sub.log); const e = l.ev.find(x => x[0] === 'R' && x[2] === 3); e[2] = 1e9;
    expect('streak 1e9', l, sub.claimed, false);
  }
  {
    const l = clone(sub.log); const e = l.ev.find(x => x[0] === 'R' && x[2] === 3); e[3] = e[3] > 0 ? 1e300 : -1e300;
    expect('start angle 1e300', l, sub.claimed, false);
  }
  {
    const l = clone(sub.log); const e = l.ev.find(x => x[0] === 'R' && x[2] === 3); e[3] = e[3] > 0 ? '2.5' : '-2.5';
    expect('start angle as a string', l, sub.claimed, false);
  }
  {
    // a press logged twice (same time)
    const l = clone(sub.log); const j = l.ev.findIndex((x, j) => x[0] === 'K' && j > 10);
    l.ev.splice(j + 1, 0, l.ev[j].slice());
    expect('duplicate press', l, sub.claimed, false);
  }
  {
    // a round logged twice (re-rolled targets)
    const l = clone(sub.log); const j = l.ev.findIndex(x => x[0] === 'R' && x[2] === 4);
    l.ev.splice(j + 1, 0, l.ev[j].slice());
    expect('duplicate round', l, sub.claimed, false);
  }
  {
    // only rounds, no presses
    const l = clone(sub.log); l.ev = l.ev.filter(x => x[0] === 'R');
    expect('rounds with no presses', l, sub.claimed, false);
  }
  {
    // presses stripped of their rounds after the first
    const l = clone(sub.log); let seen = false; l.ev = l.ev.filter(x => x[0] !== 'R' || (!seen && (seen = true)));
    expect('rounds skipped', l, sub.claimed, false);
  }
  {
    // a pause with no resume, then play on
    const l = clone(sub.log); const j = l.ev.findIndex((x, j) => x[0] === 'K' && j > 10);
    l.ev.splice(j + 1, 0, ['P', l.ev[j][1]]);
    expect('pause never resumed, play goes on', l, sub.claimed, false);
  }
  {
    // resume with no pause
    const l = clone(sub.log); const j = l.ev.findIndex((x, j) => x[0] === 'K' && j > 10);
    l.ev.splice(j + 1, 0, ['U', l.ev[j][1]]);
    expect('resume without a pause', l, sub.claimed, false);
  }
  {
    // negative time / time going back (validateLog)
    const l = clone(sub.log); l.ev[3][1] = -5;
    expect('negative event time', l, sub.claimed, false);
    const l2 = clone(sub.log); l2.ev[5][1] = l2.ev[4][1] - 10;
    expect('time going back', l2, sub.claimed, false);
  }
  {
    // the same start angle for every ring, presses placed human-like (SD 12 ms)
    const rnd = mulberry32(88); const { gauss } = tools(rnd); const ev = []; let t = 0;
    const st = R.startGap(0.8);
    for (let s = 0; s < 14; s++) {
      const n = R.ringCount(s, false); const tR = t; const gs = []; const ks = [];
      let tk = tR + 250;
      for (let k = 0; k < n; k++) {
        const i = n - 1 - k; const dir = rnd() < 0.5 ? 1 : -1; gs[i] = dir * st;
        let G = tk - tR;
        if (dir > 0) {
          const v = R.ringSpeed(s, i, n, false);
          const m = Math.ceil((st + v * G / 1000) / TAU);
          const half = (R.gapSize(s, false) / 2 + R.hitExtra()) / v * 1000 * 0.8;
          G = Math.round(((m * TAU - st) * 1000 / v + Math.max(-half, Math.min(half, 12 * gauss()))) * 100) / 100;
          tk = tR + Math.ceil(G);
        }
        ks.push(['K', tk, i, G, 1, 'k']); tk += 230 + Math.floor(rnd() * 200);
      }
      ev.push(['R', tR, s, ...gs], ...ks);
      t = ks[ks.length - 1][1] + 800;
    }
    const l = { v: 1, rv: 1, type: 'dagger', a: 0, env: {}, ev };
    const r = expect('one start angle reused for every ring', l, 14, false);
    if (r.verdict === 'valid' && r.score === 14) fail('reused start angle scored in full');
  }
  {
    // superhuman reactions hidden behind zero-length pauses before each first press
    const sim = goodRun(87, false, 25, { react: 40, reactSd: 0.1 });
    const s = lastSub(sim); const l = clone(s.log); const out2 = [];
    for (let j = 0; j < l.ev.length; j++) {
      const e = l.ev[j];
      if (e[0] === 'K' && l.ev[j - 1][0] === 'R') out2.push(['P', e[1]], ['U', e[1]]);
      out2.push(e);
    }
    l.ev = out2;
    expect('fast reactions behind 0 ms pauses', l, s.claimed, false);
  }
  {
    // padded to MAX_EVENTS (pause pairs in a round gap) to unlock a claim above
    // the rounds it proves; and the check must stay fast at that size
    const l = clone(sub.log); const j = l.ev.findIndex((x, j) => x[0] === 'R' && x[2] === 4);
    const tp = l.ev[j - 1][1] + 1; const pad = [];
    while (l.ev.length + pad.length < Q.LIMITS.MAX_EVENTS) pad.push(['P', tp], ['U', tp]);
    const room = Q.LIMITS.MAX_EVENTS - l.ev.length;
    l.ev.splice(j, 0, ...pad.slice(0, room & ~1));
    if (room & 1) l.ev.push(['P', l.ev[l.ev.length - 1][1]]);   // an odd one out: a last pause (legal: the run ends paused)
    const t0 = Date.now();
    expect('padded to MAX_EVENTS, claim 500', l, 500, false);
    const ms = Date.now() - t0;
    if (ms > 500) fail('check of a MAX_EVENTS log took ' + ms + ' ms');
  }
  {
    // 20000 presses in one endless late round (P/U between them): the walk is
    // one pass, so a hostile log cannot make the edge function spin
    const g = R.startGap(0.5); const ev = [['R', 0, 0, ...Array(2).fill(-g)]];
    let t = 9000; ev.push(['K', t, 1, 300, 1, 'k']);
    while (ev.length < Q.LIMITS.MAX_EVENTS - 3) { t += 10; ev.push(['P', t], ['U', t + 5]); t += 5; }
    ev.push(['K', t + 10, 0, 300, 1, 'k']);   // a second late pass: pausedIn() walks every pause once
    const t0 = Date.now();
    const r = Q.check('dagger', { v: 1, rv: 1, type: 'dagger', a: 0, env: {}, ev }, { claimed: 1 });
    const ms = Date.now() - t0;
    out.push({ name: 'MAX_EVENTS of pauses (timing)', verdict: r.verdict + ' in ' + ms + ' ms', ok: ms < 500 });
    if (ms > 500) fail('check of a 20000-pause log took ' + ms + ' ms');
  }

  const bad = out.filter(x => !x.ok).length;
  console.log(`forgeries: ${out.length} - caught ${out.length - bad}, passed ${bad}`);
  for (const f of out) console.log(`  ${f.ok ? 'ok  ' : 'MISS'} ${f.name}: ${f.verdict}`);
  return out;
}

// ── c) a few fixed cases a real client produces ──────────────────────────────
function edgeSuite() {
  let n = 0;
  function want(name, log, claimed, verdict, score) {
    n++;
    const r = Q.check(log.type, log, { claimed });
    if (r.verdict !== verdict || r.score !== score) fail(`edge ${name}: ${r.verdict} ${r.score} ${r.reasons}`);
  }
  const g = R.startGap(0.5);
  const base = (ev, type) => ({ v: 1, rv: 1, type: type || 'dagger', a: 0, env: {}, ev });
  // counter-clockwise rings, presses right after the lockout, resume in the gap -> 400 ms
  want('ccw round + resume gap', base([
    ['R', 0, 0, -g, -g], ['K', 300, 1, 290, 1, 'k'], ['K', 520, 0, 505, 1, 'r'],
    ['P', 600], ['U', 5000], ['R', 5400, 1, -g, -g, -g], ['K', 5700, 2, 290, 1, 'k'],
  ]), 1, 'valid', 1);
  // a press judged right after Resume, past the deadline (no frame yet)
  want('late press after resume', base([
    ['R', 0, 0, -g, -g], ['K', 300, 1, 290, 1, 'k'], ['P', 400], ['U', 9000], ['K', 9010, 0, 300, 1, 'k'],
  ]), 1, 'valid', 1);
  // negative game time after Start (first frame before the click)
  want('negative first dt', base([
    ['R', 0, 0, -g, -g], ['K', 5, 1, -8.33, 1, 'k'], ['K', 240, 0, 220, 1, 'k'],
  ]), 1, 'valid', 1);
  // abandoned while paused
  want('ends paused', base([['R', 0, 0, -g, -g], ['K', 300, 1, 290, 1, 'k'], ['P', 400]]), 0, 'valid', 0);

  // ── review fixes: coarse clocks, timing tolerances, strict fields ──
  const two = (t1, G1, t2, G2, s2) => base([['R', 0, 0, -g, -g], ['K', t1, 1, G1, 1, 'k'], ['K', t2, 0, G2, 1, s2 || 'k']]);
  // lockout: 200 ms apart is what a 100 ms-coarse clock with exact rAF stamps
  // can log; 140 cannot come from a normal client but is only a stop; 90: invalid
  want('lockout 200 (coarse clock)', two(300, 290, 500, 480), 1, 'valid', 1);
  want('lockout 140 -> stop, not invalid', two(300, 290, 440, 430), 1, 'valid', 0);
  want('lockout 90 -> invalid', two(300, 290, 390, 380), 1, 'invalid', 0);
  // round gap read through a 100 ms-coarse clock (600 logged for an 800 ms timer)
  const gap = d => base([['R', 0, 0, -g, -g], ['K', 300, 1, 290, 1, 'k'], ['K', 520, 0, 505, 1, 'k'], ['R', 520 + d, 1, -g, -g, -g]]);
  want('round gap 600 (coarse clock)', gap(600), 1, 'valid', 1);
  want('round gap 500 -> invalid', gap(500), 1, 'invalid', 0);
  const rgap = d => base([['R', 0, 0, -g, -g], ['K', 300, 1, 290, 1, 'k'], ['K', 520, 0, 505, 1, 'k'], ['P', 600], ['U', 3000], ['R', 3000 + d, 1, -g, -g, -g]]);
  want('resume gap 200 (coarse clock)', rgap(200), 1, 'valid', 1);
  want('resume gap 100 -> invalid', rgap(100), 1, 'invalid', 0);
  // game time ahead of the clock: 250 fits two coarse readings, 400 stops, 1500 is invalid
  want('G ahead 250', two(300, 550, 600, 850), 1, 'valid', 1);
  want('G ahead 400 -> stop', two(300, 290, 600, 1000), 1, 'valid', 0);
  want('G ahead 1500 -> invalid', two(300, 290, 600, 2100), 1, 'invalid', 0);
  // game time going back: after a Resume a whole slow frame; without one, a stop
  want('G back 400 after resume', base([['R', 0, 0, -g, -g], ['K', 300, 1, 500, 1, 'k'], ['P', 350], ['U', 3000], ['K', 3050, 0, 100, 1, 'k']]), 1, 'valid', 1);
  want('G back 400 with no resume -> stop', two(600, 500, 900, 100), 1, 'valid', 0);
  want('G back 400 on the first press of the run (Start)', base([['R', 0, 0, -g, -g], ['K', 30, 1, -400, 1, 'k'], ['K', 300, 0, 200, 1, 'k']]), 1, 'valid', 1);
  // sources
  want('ping-copy sources p / q', two(300, 290, 520, 505, 'q'), 1, 'valid', 1);
  want('source "constructor" -> invalid', two(300, 290, 520, 505, 'constructor'), 1, 'invalid', 0);
  want('source "toString" -> invalid', two(300, 290, 520, 505, 'toString'), 1, 'invalid', 0);
  want('source missing -> invalid', base([['R', 0, 0, -g, -g], ['K', 300, 1, 290, 1]]), 0, 'invalid', 0);
  want('source a number -> invalid', two(300, 290, 520, 505, 1), 1, 'invalid', 0);
  // strict shapes
  want('pause with a field -> invalid', base([['R', 0, 0, -g, -g], ['P', 100, 'x'], ['U', 900]]), 0, 'invalid', 0);
  want('resume with a field -> invalid', base([['R', 0, 0, -g, -g], ['P', 100], ['U', 900, 1]]), 0, 'invalid', 0);
  want('end with two fields -> invalid', base([['R', 0, 0, -g, -g], ['E', 8100, 'time', 5]]), 0, 'invalid', 0);
  // a coarse clock's log (every time on the 100 ms grid) skips the reaction check
  {
    const ev = []; let t = 0;
    for (let s = 0; s < 8; s++) {
      const n = R.ringCount(s, false);
      ev.push(['R', t, s, ...Array(n).fill(-g)]);
      for (let k = 0; k < n; k++) { t += k ? 300 : 100; ev.push(['K', t, n - 1 - k, t - ev[ev.length - 1 - k][1], 1, 'k']); }
      t += 800;
    }
    // G = time since R for every press (fix the K's G after building)
    let tR = 0; for (const e of ev) { if (e[0] === 'R') tR = e[1]; else e[3] = e[1] - tR; }
    const r = Q.check('dagger', base(ev), { claimed: 8 });
    n++;
    if (r.verdict !== 'review' || !/too lucky/.test(r.reasons.join())) fail('edge coarse grid log: ' + r.verdict + ' ' + r.reasons);
    if (r.stats.coarseClock !== 10 || r.reasons.some(x => /reactions/.test(x))) fail('edge coarse grid: reaction check not skipped ' + JSON.stringify(r.stats));
  }
  console.log(`edges: ${n} fixed cases`);
}

// ── d) the real IIFE (dagger.iife.js) in a VM with a fake DOM and clock ──────
// Plays it with a scripted player that reads the targets from the run's log,
// and checks every packet it submits (and the final log).
function iifeSuite(nRuns) {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const WT = '@qte-scratch/wt2/js/';
  const srcRules = fs.readFileSync(WT + 'qte-rules.js', 'utf8');
  const srcMine = fs.readFileSync(path.join(__dirname, 'dagger.rules.js'), 'utf8');
  const srcIife = fs.readFileSync(path.join(__dirname, 'dagger.iife.js'), 'utf8');
  let bad = 0, checked = 0, maxScore = 0, reviews = 0;
  for (let k = 0; k < nRuns; k++) {
    const rnd = mulberry32(9000 + k);
    const { gauss, U } = tools(rnd);
    const comp = k % 2 === 1;
    const clock = { now: 5000 + rnd() * 1000 };
    const q = makeQueue();
    const period = [1000 / 60, 1000 / 144, 1000 / 30][k % 3];
    const nextTick = x => Math.ceil(x / period + 1e-9) * period;
    const ctxStub = new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
    const els = {};
    const el = id => els[id] || (els[id] = {
      id, style: { display: id === 'qte-panel-dagger' ? 'flex' : '' }, textContent: '', width: 0, height: 0,
      classList: { contains: c => id === 'page-qte' && c === 'active', add() {}, remove() {}, toggle() {} },
      listeners: {}, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      parentElement: { clientWidth: 600, clientHeight: 700 }, getContext: () => ctxStub,
    });
    const docL = {};
    const store = {};
    const subs = [];
    const sb = {
      document: { getElementById: el, addEventListener: (t, f) => { (docL[t] = docL[t] || []).push(f); }, activeElement: { tagName: 'BODY' } },
      localStorage: { getItem: x => (x in store ? store[x] : null), setItem: (x, v) => { store[x] = String(v); }, removeItem: x => { delete store[x]; } },
      performance: { now: () => clock.now },
      requestAnimationFrame: cb => { const ts = nextTick(clock.now + (rnd() < 0.02 ? 40 : 0)); return q.push(ts + U(0.1, 1), () => cb(ts)); },
      cancelAnimationFrame: it => { if (it) it.dead = true; },
      setTimeout: (f, d) => q.push(clock.now + (d || 0) + U(0, 3), f),
      clearTimeout: it => { if (it) it.dead = true; },
      innerWidth: 1280, innerHeight: 720, _albPing: 0, _qteCompMode: comp,
      _sbSubmitScore: (type, score, packet) => { subs.push({ type, score, packet }); },
      _sbStartQteRun: () => Promise.resolve(null),
      addEventListener() {}, dispatchEvent() {}, console,
    };
    sb.window = sb;
    vm.createContext(sb);
    // the page's Math.random (the IIFE's target draws) seeded, so a failure replays
    sb.__rand = mulberry32(55000 + k);
    vm.runInContext('Math.random = function () { return __rand(); }; const IS_MOBILE = false;', sb);
    vm.runInContext(srcRules, sb);
    vm.runInContext(srcMine, sb);
    vm.runInContext(srcIife, sb);
    const QR = sb.QteRules, RR = QR.trainers.dagger;
    const target = 4 + Math.floor(rnd() * 10);
    const pauseAt = rnd() < 0.5 ? clock.now + U(1000, 30000) : Infinity;
    let pending = null, pausedNow = false;
    const press = () => { for (const f of docL.keydown) f({ code: 'Space', repeat: false, preventDefault() {} }); };
    el('dagger-qte-start-btn').listeners.click[0]();
    const run = QR.Run.current;
    function plan() {
      if (pending || pausedNow) return;
      const ev = run.log.ev; const last = ev[ev.length - 1];
      if (!last || last[0] === 'E') return;
      let iR = -1; for (let i = ev.length - 1; i >= 0; i--) if (ev[i][0] === 'R') { iR = i; break; }
      const Rv = ev[iR], n = Rv.length - 3, s = Rv[2];
      if (s >= target) return;                            // stop: let the time run out
      let hits = 0, lastK = null;
      for (let i = iR + 1; i < ev.length; i++) if (ev[i][0] === 'K') { hits++; lastK = ev[i]; }
      if (hits >= n) return;                              // between rounds
      const idx = n - 1 - hits, g = Rv[3 + idx];
      const tR = run.t0 + Rv[1];
      const paused = QR.pausedBetween(ev, Rv[1], clock.now - run.t0);
      const earliest = Math.max(clock.now + 60, lastK ? run.t0 + lastK[1] + 240 : tR + 250);
      let at;
      if (g < 0) at = earliest + U(100, 250);
      else {
        const v = RR.ringSpeed(s, idx, n, comp), st = g;
        const Gear = earliest - tR - paused;
        const m = Math.ceil((st + v * Gear / 1000) / TAU);
        at = tR + paused + (m * TAU - st) * 1000 / v + 8 + gauss() * 8;
      }
      pending = q.push(Math.max(at, clock.now), () => { pending = null; press(); });
    }
    const limit = clock.now + 30 * 60 * 1000;
    let didPause = false;
    while (q.size && clock.now < limit) {
      const it = q.pop();
      if (it.dead) continue;
      if (!didPause && it.at > pauseAt) {
        didPause = true; clock.now = pauseAt;
        sb._onDaggerQteHide(); pausedNow = true; if (pending) { pending.dead = true; pending = null; }
        const dur = U(300, 12000);
        q.push(pauseAt + dur * 0.5, () => sb._onDaggerQteShow());
        q.push(pauseAt + dur, () => { pausedNow = false; el('dagger-qte-resume-btn').listeners.click[0](); });
        if (it.dead) continue;
      }
      if (it.at > clock.now) clock.now = it.at;
      it.fn();
      plan();
      const ev = run.log.ev;
      if (ev.length && ev[ev.length - 1][0] === 'E' && !q.size) break;
    }
    const final = run.log;
    let streak = 0, need = 0, got = 0;
    for (const e of final.ev) {
      if (e[0] === 'R') { need = e.length - 3; got = 0; }
      if (e[0] === 'K' && e[4] === 1 && ++got === need) streak++;
    }
    const todo = subs.map(x => ({ log: x.packet.log, claimed: x.score, type: x.type }));
    todo.push({ log: final, claimed: Math.max(0, streak), type: final.type });
    for (const t of todo) {
      checked++;
      const r = QR.check(t.type, t.log, { claimed: t.claimed });
      maxScore = Math.max(maxScore, r.score);
      if (r.verdict === 'review') reviews++;
      if (r.verdict === 'invalid' || r.score !== t.claimed || t.type !== 'dagger' + (comp ? '-comp' : '')) {
        bad++;
        if (bad <= 5) console.log('  iife run', k, t.type, 'claimed', t.claimed, '->', r.verdict, r.score, r.reasons, r.stats.stopReason);
      }
    }
  }
  console.log(`real IIFE: ${nRuns} runs, ${checked} checks - bad ${bad}, review ${reviews}, max score ${maxScore}`);
  if (bad) fail('real IIFE logs failed the check: ' + bad);
}

// ── e) dagger.bot.js against the real IIFE (same fake page, async fake clock) ──
async function botSuite(nRuns) {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const WT = '@qte-scratch/wt2/js/';
  const srcs = [fs.readFileSync(WT + 'qte-rules.js', 'utf8'),
    fs.readFileSync(path.join(__dirname, 'dagger.rules.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'dagger.iife.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'dagger.bot.js'), 'utf8')];
  let bad = 0, reached = 0, checked = 0;
  for (let k = 0; k < nRuns; k++) {
    const rnd = mulberry32(7000 + k);
    const { gauss, U } = tools(rnd);
    const comp = k % 2 === 0;
    const clock = { now: 3000 };
    const q = makeQueue();
    const period = [1000 / 60, 1000 / 144, 1000 / 30][k % 3];
    const nextTick = x => Math.ceil(x / period + 1e-9) * period;
    const ctxStub = new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
    const els = {};
    const el = id => els[id] || (els[id] = {
      id, style: { display: id === 'qte-panel-dagger' ? 'flex' : (id === 'dagger-tap-btn' ? 'none' : '') }, textContent: '', width: 0, height: 0,
      classList: { contains: c => id === 'page-qte' && c === 'active', add() {}, remove() {}, toggle() {} },
      listeners: {}, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      parentElement: { clientWidth: 600, clientHeight: 700 }, getContext: () => ctxStub,
    });
    const docL = {}, store = {}, subs = [];
    const sb = {
      document: { getElementById: el, addEventListener: (t, f) => { (docL[t] = docL[t] || []).push(f); }, activeElement: { tagName: 'BODY' } },
      localStorage: { getItem: x => (x === 'alb:qte-selfcheck' ? '1' : x in store ? store[x] : null), setItem: (x, v) => { store[x] = String(v); }, removeItem: x => { delete store[x]; } },
      performance: { now: () => clock.now },
      requestAnimationFrame: cb => { const ts = nextTick(clock.now); return q.push(ts + U(0.1, 1), () => cb(ts)); },
      cancelAnimationFrame: it => { if (it) it.dead = true; },
      setTimeout: (f, d) => q.push(clock.now + (d || 0) + U(0, 3), f),
      clearTimeout: it => { if (it) it.dead = true; },
      innerWidth: 1280, innerHeight: 720, _albPing: [0, 150][k % 2], _qteCompMode: comp,
      _sbSubmitScore: (type, score, packet) => { subs.push({ type, score, packet }); },
      _sbStartQteRun: () => Promise.resolve(null),
      addEventListener() {}, dispatchEvent() {}, console: { log() {} },
    };
    sb.window = sb;
    vm.createContext(sb);
    // the page's Math.random (the IIFE's target draws) seeded, so a failure replays
    sb.__rand = mulberry32(55000 + k);
    vm.runInContext('Math.random = function () { return __rand(); }; const IS_MOBILE = false;', sb);
    for (const s of srcs) vm.runInContext(s, sb);
    // the ping simulator: keys reach the trainer _albPing ms late
    const keydown = e => { for (const f of docL.keydown || []) f(e); };
    const ctx = {
      comp, target: 5 + (k % 6),
      byId: el,
      click: e => { for (const f of (e.listeners.click || [])) f({}); },
      key: (key, code, type) => {
        if (type === 'up') return;
        const e = { key, code, repeat: false, preventDefault() {} };
        if (sb._albPing > 0) q.push(clock.now + sb._albPing + U(0, 3), () => keydown(e)); else keydown(e);
      },
      mouse() {},
      sleep: ms => new Promise(res => q.push(clock.now + Math.max(0, ms), res)),
      until: async (fn, ms) => { const end = clock.now + ms; for (;;) { const v = fn(); if (v) return v; if (clock.now >= end) throw new Error('timeout'); await ctx.sleep(10); } },
      run: () => sb.QteRules.Run.current,
      lastEv: code => { const ev = sb.QteRules.Run.current.log.ev; for (let i = ev.length - 1; i >= 0; i--) if (ev[i][0] === code) return ev[i]; return null; },
      human: (m, s) => Math.max(0, m + s * gauss()),
      log() {},
    };
    let done = false, result = null;
    sb.__qteBots.dagger(ctx).then(r => { done = true; result = r; }, e => { done = true; result = e; });
    const limit = clock.now + 20 * 60 * 1000;
    while (!done && clock.now < limit) {
      for (let i = 0; i < 5; i++) await Promise.resolve();
      if (done || !q.size) break;
      const it = q.pop();
      if (it.dead) continue;
      if (it.at > clock.now) clock.now = it.at;
      it.fn();
    }
    for (let i = 0; i < 20; i++) await Promise.resolve();
    if (!done || !result || typeof result.points !== 'number') { bad++; console.log('  bot run', k, 'did not finish', result); continue; }
    if (result.points >= ctx.target) reached++;
    for (const s of subs) {
      checked++;
      const r = sb.QteRules.check(s.type, s.packet.log, { claimed: s.score });
      if (r.verdict !== 'valid' || r.score !== s.score) { bad++; if (bad <= 5) console.log('  bot run', k, s.score, '->', r.verdict, r.score, r.reasons); }
    }
    const sc = sb.QteRules.Run.lastSelfCheck;
    if (subs.length && (!sc || sc.result.verdict !== 'valid')) { bad++; console.log('  bot run', k, 'self-check', sc && sc.result); }
  }
  console.log(`bot: ${nRuns} runs, ${checked} submits checked - bad ${bad}, reached target ${reached}/${nRuns}`);
  if (bad) fail('bot runs failed: ' + bad);
  if (reached < nRuns * 0.8) fail('bot reached its target in only ' + reached + ' of ' + nRuns);
}

// ── f) scripted IIFE scenarios (the review's fixes) ─────────────────────────
// A fake page like iifeSuite's, driven step by step. opts.rand: the page's
// Math.random (the IIFE's target draws); opts.rules: false leaves the
// dagger rules out.
function makePage(opts) {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const WT = '@qte-scratch/wt2/js/';
  const clock = { now: 5000 };
  const q = makeQueue();
  const period = 1000 / 60;
  const ctxStub = new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
  const els = {};
  const el = id => els[id] || (els[id] = {
    id, style: { display: id === 'qte-panel-dagger' ? 'flex' : '' }, textContent: '', width: 0, height: 0,
    classList: { contains: c => id === 'page-qte' && c === 'active', add() {}, remove() {}, toggle() {} },
    listeners: {}, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    parentElement: { clientWidth: 600, clientHeight: 700 }, getContext: () => ctxStub,
  });
  const docL = {}, store = {}, subs = [];
  const sb = {
    document: { getElementById: el, addEventListener: (t, f) => { (docL[t] = docL[t] || []).push(f); }, activeElement: { tagName: 'BODY' } },
    localStorage: { getItem: x => (x in store ? store[x] : null), setItem: (x, v) => { store[x] = String(v); }, removeItem: x => { delete store[x]; } },
    performance: { now: () => clock.now },
    requestAnimationFrame: cb => { const ts = Math.ceil(clock.now / period + 1e-9) * period; return q.push(ts + 0.5, () => cb(ts)); },
    cancelAnimationFrame: it => { if (it) it.dead = true; },
    setTimeout: (f, d) => q.push(clock.now + (d || 0) + 1, f),
    clearTimeout: it => { if (it) it.dead = true; },
    innerWidth: 1280, innerHeight: 720, _albPing: 0, _qteCompMode: !!opts.comp,
    _sbSubmitScore: (type, score, packet) => { subs.push({ type, score, packet }); },
    _sbStartQteRun: () => Promise.resolve(null),
    addEventListener() {}, dispatchEvent() {}, console,
    __rand: opts.rand || Math.random,
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext('Math.random = function () { return __rand(); }; const IS_MOBILE = false;', sb);
  vm.runInContext(fs.readFileSync(WT + 'qte-rules.js', 'utf8'), sb);
  if (opts.rules !== false) vm.runInContext(fs.readFileSync(path.join(__dirname, 'dagger.rules.js'), 'utf8'), sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'dagger.iife.js'), 'utf8'), sb);
  const page = {
    sb, clock, subs, store, el,
    until(t) { while (q.size) { const it = q.pop(); if (it.dead) continue; if (it.at > t) { q.push(it.at, it.fn); break; } clock.now = Math.max(clock.now, it.at); it.fn(); } clock.now = Math.max(clock.now, t); },
    wait(ms) { page.until(clock.now + ms); },
    key(extra) { const e = extra && extra.code ? extra : Object.assign({ code: 'Space', repeat: false, preventDefault() {} }, extra || {}); for (const f of docL.keydown || []) f(e); },
    start() { el('dagger-qte-start-btn').listeners.click[0](); },
    resume() { el('dagger-qte-resume-btn').listeners.click[0](); },
    run() { return sb.QteRules.Run.current; },
    ev() { return sb.QteRules.Run.current.log.ev; },
    check(log, claimed, type) { return sb.QteRules.check(type || log.type, log, { claimed }); },
  };
  return page;
}

function scenarioSuite() {
  let n = 0;
  const ok = (cond, what) => { n++; if (!cond) fail('scenario: ' + what); };
  const ccw = () => 0.9;                  // every direction draw >= 0.5: counter-clockwise; start 0.6+0.72
  // clear the round in play with CCW rings: a press every 300 ms
  const clearRound = p => { const ev = p.ev(); let iR = ev.length - 1; while (ev[iR][0] !== 'R') iR--; const n = ev[iR].length - 3; for (let k = 0; k < n; k++) { p.wait(300); p.key(); } };

  // 1. Start clicked in the between-round gap (the Dagger tab clicked again shows Start)
  {
    const p = makePage({ rand: ccw });
    p.start(); p.wait(100); clearRound(p);           // round 0 cleared: 800 ms timer pending
    p.wait(200); p.sb._onDaggerQteShow();            // same tab clicked: Start shows, run goes on
    p.start();                                       // new run while the old timer is pending
    p.wait(2000);                                    // the old timer would fire in here
    const ev = p.ev();
    ok(ev.filter(e => e[0] === 'R').length === 1, 'Start in the gap: one round 1 in the new run, got ' + JSON.stringify(ev));
    clearRound(p); p.wait(1500); clearRound(p);
    const last = p.subs[p.subs.length - 1];
    const r = p.check(last.packet.log, last.score);
    ok(r.verdict !== 'invalid' && r.score === last.score, 'Start in the gap: submit ' + r.verdict + ' ' + r.score + '/' + last.score + ' ' + r.reasons);
  }
  // 2. Mode switched mid-run: the local best and the board stay the run's
  {
    const p = makePage({ rand: ccw, comp: false });
    p.start(); p.wait(100);
    p.sb._qteCompMode = true;                        // toggled after Start showed (see 1)
    clearRound(p);
    ok(p.store['alb:dagger-hs'] === '1' && !p.store['alb:dagger-hs-comp'], 'mode switch: local best under ' + JSON.stringify(p.store));
    ok(p.subs.length === 1 && p.subs[0].type === 'dagger', 'mode switch: submitted as ' + (p.subs[0] && p.subs[0].type));
    const r = p.check(p.subs[0].packet.log, 1);
    ok(r.verdict !== 'invalid' && r.score === 1, 'mode switch: ' + r.verdict + ' ' + r.score);
  }
  // 3. Ping-simulator copies are marked p / q
  {
    const p = makePage({ rand: ccw });
    const copies = new WeakSet(); p.sb._albIsPingCopy = e => copies.has(e);
    p.start(); p.wait(300);
    const e1 = { code: 'Space', repeat: false, preventDefault() {} }; copies.add(e1); p.key(e1);
    p.wait(300);
    const e2 = { code: 'Space', repeat: true, preventDefault() {} }; copies.add(e2); p.key(e2);
    const ks = p.ev().filter(e => e[0] === 'K').map(e => e[5]).join('');
    ok(ks === 'pq', 'ping copies logged as ' + ks);
    const last = p.subs[p.subs.length - 1];
    ok(last && p.check(last.packet.log, last.score).verdict === 'valid', 'ping copies: submit valid');
  }
  // 4. A run resumed after more than MAX_T is not submitted (it could only be refused)
  {
    const p = makePage({ rand: ccw });
    p.start(); p.wait(100); clearRound(p);
    const before = p.subs.length;
    p.wait(100); p.sb._onDaggerQteHide();            // paused in the gap
    p.clock.now += p.sb.QteRules.LIMITS.MAX_T + 60000;
    p.sb._onDaggerQteShow(); p.resume(); p.wait(600); clearRound(p);
    ok(p.subs.length === before, 'MAX_T: submitted ' + (p.subs.length - before) + ' more');
    ok(p.store['alb:dagger-hs'] === '2', 'MAX_T: local best still counts');
  }
  // 5. Missing rules: the IIFE returns quietly (the trainers after it still load)
  {
    let threw = null;
    try { makePage({ rules: false }); } catch (e) { threw = e; }
    ok(!threw, 'missing rules: IIFE threw ' + (threw && threw.message));
  }
  // 6. Pause at every state of a round (zoom-in, gap, right after a fail) and
  //    resume: every packet checks out
  {
    let bad = 0;
    for (let k = 0; k < 40; k++) {
      const rr = mulberry32(300 + k);
      const p = makePage({ rand: () => (rr() < 0.8 ? 0.9 : rr()) });
      p.start();
      for (let step = 0; step < 60; step++) {
        const a = rr();
        if (a < 0.55) { p.wait(150 + rr() * 300); p.key(); }
        else if (a < 0.7) { p.wait(rr() * 250); p.sb._onDaggerQteHide(); p.wait(50 + rr() * 9000); p.sb._onDaggerQteShow(); p.wait(rr() * 300); p.resume(); }
        else if (a < 0.8) { p.wait(rr() * 800); p.key({ repeat: true }); }
        else { p.wait(rr() * 1200); }
        if (p.run().closed) break;
      }
      for (const s of p.subs) {
        const r = p.check(s.packet.log, s.score);
        if (r.verdict === 'invalid' || r.score !== s.score) { bad++; if (bad <= 3) console.log('  scenario pause-anywhere', k, s.score, r.verdict, r.score, r.reasons, r.stats.stopReason); }
      }
      const r = p.check(p.run().log, 0);
      if (r.verdict === 'invalid') { bad++; if (bad <= 3) console.log('  scenario pause-anywhere final', k, r.reasons); }
    }
    ok(bad === 0, 'pause anywhere: ' + bad + ' bad packets');
  }
  console.log(`scenarios: ${n} checks`);
}

// ── g) elite players: the accuracy check's false-review rate ─────────────────
// Players with a true spread of 7-9 ms (beyond the best human visual timing
// reported) on 144 / 240 Hz screens, no stopping point; every submission is
// checked (runs capped at 60 rounds to keep the test quick). The target is at
// most 0.5% of runs held.
function eliteSuite(nRuns) {
  const rnd = mulberry32(4242);
  const { U, pick } = tools(rnd);
  let held = 0, checks = 0, invalid = 0, hits = 0;
  const why = {};
  for (let k = 0; k < nRuns; k++) {
    const comp = rnd() < 0.5;
    const player = Object.assign(makePlayer(rnd, 1, { ping: 0, maxRounds: 60 }), { sigma: U(7, 9), lapse: 0.002, style: 'wait' });
    const sim = simulate({ seed: 90000 + k, comp, player, period: 1000 / pick([144, 240]), dropP: 0.002, stallP: 0 });
    let runHeld = false;
    for (const s of sim.subs.concat([{ log: sim.log, claimed: sim.streak }])) {
      checks++;
      const r = check(s.log, s.claimed, comp);
      if (r.verdict === 'invalid') invalid++;
      if (r.verdict === 'review') { runHeld = true; for (const x of r.reasons) why[x.replace(/[\d.]+/g, '#')] = (why[x.replace(/[\d.]+/g, '#')] || 0) + 1; }
      if (s.log === sim.log) hits += r.stats.cwHits || 0;
    }
    if (runHeld) held++;
  }
  console.log(`elite: ${nRuns} runs (${checks} checks, ${(hits / nRuns).toFixed(0)} CW hits a run) - held ${held} (${(held / nRuns * 100).toFixed(2)}%), invalid ${invalid}`, Object.keys(why).length ? why : '');
  if (invalid) fail('elite runs invalid: ' + invalid);
  if (held / nRuns > 0.005) fail('elite review rate ' + (held / nRuns * 100).toFixed(2) + '% > 0.5%');
}

const runs = parseInt(process.argv[2] || '2400', 10);
(async () => {
  const t0 = Date.now();
  honestSuite(runs);
  forgerySuite();
  edgeSuite();
  scenarioSuite();
  iifeSuite(60);
  await botSuite(parseInt(process.env.BOT_RUNS || '24', 10));
  eliteSuite(parseInt(process.env.ELITE_RUNS || '600', 10));
  console.log(`${failed ? 'FAILED' : 'PASSED'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('FAIL crashed:', e && e.stack || e); process.exit(1); });
