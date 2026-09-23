// Node test for the hammer rules: node hammer.test.js
// a) honest players simulated from the rules through the same state machine
//    as the IIFE (event-driven: frames, timers, ping simulator, pauses);
// b) forgeries; c) exit 1 on any failure.
'use strict';
require('./_paths.js');
const Q = require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const H = Q.trainers.hammer;
if (!H) { console.error('hammer rules did not register'); process.exit(1); }

// ── seeded randomness ──
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(+(process.env.HAMMER_SEED || 12345));
const U = (a, b) => a + (b - a) * rnd();
function normal() { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const N = (m, s) => m + s * normal();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const r4 = (x) => typeof x === 'number' ? Math.round(x * 10000) / 10000 : x;

// A coarse clock (privacy settings: Firefox resistFingerprinting / Tor clamp
// performance.now() and rAF stamps to 16.67 or 100 ms; 1 ms is common).
// Firefox jitters the clamp: each step has its own random rounding point, so
// a time rounds down or up (still monotone).
function quantizer(q) {
  if (!q) return (x) => x;
  const mid = (k) => { const s = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
  return (x) => { const k = Math.floor(x / q); return (x - k * q) < mid(k) * q ? k * q : (k + 1) * q; };
}

// ── a log writer that behaves like QteRules.Run ──
function makeRun(type, t0, env, qz) {
  const log = { v: 1, rv: Q.RULES_VER, type, a: 0, env, ev: [] };
  let closed = false;
  const q0 = qz(t0);
  return {
    log,
    ev(now, code, ...f) { if (!closed && log.ev.length < Q.LIMITS.MAX_EVENTS) log.ev.push([code, Math.max(0, Math.round(qz(now) - q0)), ...f.map(r4)]); },
    close() { closed = true; },
    snap() { return { v: 1, rv: log.rv, type, a: 0, env, ev: log.ev.slice() }; },
  };
}

// ── frames: vsync grid with jitter, drops and rare stalls; callbacks a little after the stamp ──
// Long tasks (pJank): the frame's callback runs late but keeps its vsync stamp
// (a stale stamp), frames are skipped while the main thread is blocked, and an
// input that arrives during the task is handled only when it ends - just before
// that stale frame (defer). That is the case where the bar leads the hold.
function Frames(p, start) {
  const f = [], raw = [], c = [], jank = [];
  const qz = quantizer(p.clockQ);
  let t = start - U(0, p.interval);
  function grow() {
    let iv = p.interval + N(0, 0.15);
    const x = rnd();
    if (x < p.pStall) iv = U(200, 3000);                      // tab hidden / long jank
    else if (x < p.pStall + p.pDrop) iv = p.interval * Math.floor(U(2, 6)); // dropped frames
    t += Math.max(1, iv);
    const jk = rnd() < (p.pJank || 0);
    const cb = jk ? t + U(20, 160) : t + (rnd() < 0.9 ? U(0.2, 2) : U(2, 8));
    f.push(qz(t)); raw.push(t); c.push(cb); jank.push(jk);
    if (jk) t += Math.floor((cb - t) / p.interval) * p.interval;   // next stamp: the first vsync after the task
  }
  return {
    // first index whose callback runs after time x
    after(x) { while (!c.length || c[c.length - 1] <= x) grow(); let lo = 0, hi = c.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] > x) hi = m; else lo = m + 1; } return lo; },
    f(j) { while (f.length <= j) grow(); return f[j]; },
    c(j) { while (c.length <= j) grow(); return c[j]; },
    // when an input arriving at x is handled (after a long task that holds the main thread)
    defer(x) { const j = this.after(x); return jank[j] && raw[j] < x ? c[j] - 0.5 : x; },
    qz,
  };
}

// ── one honest run, event-driven, mirroring the IIFE ──
function simulate(pl) {
  const comp = pl.comp, type = 'hammer' + (comp ? '-comp' : '');
  const t0 = 1000;
  const frames = Frames(pl, t0);
  const run = makeRun(type, t0, { w: 1280, h: 720, mob: pl.touch, ping: pl.ping }, frames.qz);
  const q = []; let seq = 0;
  const at = (t, fn) => { q.push({ t, s: seq++, fn }); };
  // game state (IIFE)
  let running = true, paused = false, holding = false, inSuccessDelay = false, streak = 0;
  let zoneMin = 0, zoneMax = 0, zoneC = 0;
  let clickT = t0;             // lastTime override from Start/Resume (real time of the click)
  let holdId = 0, holdStart = 0, holdJ0 = 0, prevStamp = 0;
  let ended = false; const hitLens = [];
  let roundId = 0;
  // player state
  let keyDown = false;
  const lag = () => pl.touch || pl.ping === 0 ? U(0.5, 8) : pl.ping + (rnd() < 0.97 ? U(0, 4) : U(4, 100));

  const speed = () => H.speed(streak, comp);
  function startRound(now, why) {
    holding = false; inSuccessDelay = false; holdId++;
    const size = H.size(streak, comp);
    const center = H.C_MIN + rnd() * H.C_SPAN;
    zoneMin = Math.max(0.05, center - size / 2);
    zoneMax = Math.min(0.95, zoneMin + size);
    zoneMin = zoneMax - size;
    zoneC = center;
    roundId++;
    run.ev(now, 'R', streak, zoneMin, zoneMax, why);
    agentRound(now);
  }
  // fill of the current hold after all frames whose callback ran before x
  function fillAt(x) {
    let fill = 0, n = 0, j = holdJ0, prev = prevStamp;
    const sp = speed();
    while (frames.c(j) < x) {
      const dt = Math.min((frames.f(j) - prev) / 1000, H.DT_MAX);
      prev = frames.f(j);
      fill = Math.min(1, fill + sp * dt); if (dt > 0) n++;      // the IIFE counts frames that moved the bar
      if (fill >= 1) return { fill, n, over: frames.c(j) };
      j++;
    }
    return { fill, n, over: 0 };
  }
  function beginHold(now, src) {
    if (holding) return;
    holding = true; holdId++;
    holdStart = now;
    holdJ0 = frames.after(now);
    prevStamp = clickT > (holdJ0 > 0 ? frames.c(holdJ0 - 1) : -1e9) ? frames.qz(clickT) : frames.f(holdJ0 - 1);
    run.ev(now, 'D', src);
    // overfill watcher
    const id = holdId;
    const o = fillAt(1e15);
    at(o.over, () => { if (holding && holdId === id && running) { holding = false; onRelease(o.over, 'o', o); } });
    agentHold(now);
  }
  function onRelease(now, cause, st) {
    if (!running || inSuccessDelay) return;
    const s = st || fillAt(now);
    const fill = s.fill;
    const inZone = fill >= zoneMin && fill <= zoneMax;
    run.ev(now, 'X', fill, s.n, cause, inZone ? 1 : 0);
    if (!inZone) {
      run.ev(now, 'E', fill < zoneMin ? 'early' : 'late');
      running = paused = false; holding = false; inSuccessDelay = false;
      run.close(); ended = true;
      return;
    }
    streak++;
    inSuccessDelay = true;
    hitLens.push([run.log.ev.length, streak]);   // what run.submit(streak) would send
    const late = rnd() < 0.95 ? U(0, 4) : (rnd() < 0.8 ? U(4, 100) : U(100, 1000));
    at(now + H.GAP_MS + late, (tt) => { if (running) startRound(tt, 'n'); });
    agentHit(now);
  }
  // input handlers (arrival times)
  function keydown(now) { if (!running || paused || inSuccessDelay) return; beginHold(now, pl.touch ? pl.src : 'k'); }
  function keyup(now) { if (!running || paused || !holding) return; holding = false; onRelease(now, pl.touch ? pl.src : 'k'); }
  function hide(now) {
    if (paused) return;
    if (running) { running = false; paused = true; holding = false; run.ev(now, 'P'); agentPause(now); }
  }
  function resume(now) {
    if (!paused) return;
    paused = false; running = true; holding = false; clickT = now;
    run.ev(now, 'U');
    startRound(now, 'u');
  }

  // ── the player ──
  function physDown(p) {
    // p = physical time. Keys go through the ping simulator (its copies keep
    // e.repeat, so OS auto-repeat of a held Space is ignored at any ping).
    if (keyDown) return;
    keyDown = true;
    at(frames.defer(p + lag()), keydown);
  }
  function physUp(p) {
    if (!keyDown) return;
    keyDown = false;
    at(frames.defer(p + lag()), keyup);
  }
  function latency() {
    let l = Math.exp(Math.log(pl.latMed) + 0.25 * normal());
    if (rnd() < 0.08) l += U(0, 2000);
    return l;
  }
  function agentRound(now) {
    if (ended) return;
    const rid = roundId;
    if (keyDown) {
      // held through the gap / pressed too early: the held key does nothing
      // (repeats are ignored): notice, let go, press again
      // (unless a delayed copy of the press has started a hold after all)
      const p = now + U(250, 450);
      at(p, () => {
        if (roundId !== rid || holding || ended) return;
        physUp(p);
        const p2 = p + U(100, 250);
        at(p2, () => { if (roundId === rid && !ended && !paused) physDown(p2); });
      });
    } else {
      const p = now + latency();
      at(p, () => { if (roundId === rid && !ended && !paused) physDown(p); });
    }
    maybePause(now);
  }
  function agentHold(now) {
    const id = holdId, rid = roundId;
    const sp = speed();
    let target;
    if (streak >= pl.cap) target = now + U(40, 120);           // done: let it go early on purpose
    else {
      // A calibrated player: the release lands, on average, in the middle of
      // the time the drawn bar shows the frame nearest the zone centre (the
      // trainer judges the last drawn fill), then the player's timing error.
      const aim = zoneC;
      let fill = 0, j = holdJ0, prev = prevStamp, T = 0;
      for (let k = 0; k < 100000; k++) {
        const dt = Math.min((frames.f(j) - prev) / 1000, H.DT_MAX);
        const nf = fill + sp * dt;
        if (nf >= aim) {
          const jj = (nf - aim <= aim - fill || j === holdJ0) ? j : j - 1;
          T = (frames.c(jj) + frames.c(jj + 1)) / 2;
          break;
        }
        fill = nf; prev = frames.f(j); j++;
      }
      const holdMs = T - now;
      const sd = Math.sqrt(pl.sigma * pl.sigma + (pl.weber * holdMs) * (pl.weber * holdMs));
      let e = N(pl.biasMs, sd);
      if (rnd() < pl.lapse) e += N(0, 4 * sd);                 // lapse
      target = T + e;
    }
    // target is when the handler should run; the physical release is one lag earlier
    const l = pl.touch || pl.ping === 0 ? U(0.5, 8) : pl.ping + 2;
    const p = Math.max(now + 1, target - l);
    at(p, () => { if (holdId === id && roundId === rid) physUp(p); });
  }
  function agentHit(now) {
    const rid = roundId;
    if (pl.holdThrough && !pl.touch && rnd() < 0.5) {
      // taps again right after the hit and keeps holding into the next round
      const p = now + U(150, 600);
      at(p, () => { if (roundId === rid && !ended && !paused) physDown(p); });
    } else if (pl.anticipate) {
      // presses on the 700 ms rhythm instead of reacting to the new zone
      const p = now + H.GAP_MS + N(pl.antAim, pl.antSd) - (pl.touch ? 0 : pl.ping);
      at(Math.max(now, p), () => { if (!ended && !paused && !keyDown) physDown(Math.max(now, p)); });
    }
    maybePause(now);
  }
  function agentPause(now) {
    if (keyDown) { const p = now + U(100, 300); at(p, () => physUp(p)); }
    const dur = rnd() < 0.6 ? U(120, 700) : U(1000, 20000);
    at(frames.defer(now + dur), resume);
  }
  function maybePause(now) {
    if (rnd() < pl.pPause) at(now + U(0, 1800), hide);
  }

  // Start
  startRound(t0 + U(0.1, 3), 's');
  let guard = 0;
  while (q.length && !ended && guard++ < 5e6) {
    let bi = 0;
    for (let i = 1; i < q.length; i++) if (q[i].t < q[bi].t || (q[i].t === q[bi].t && q[i].s < q[bi].s)) bi = i;
    const it = q.splice(bi, 1)[0];
    it.fn(it.t);
  }
  return { log: run.log, hitLens, score: streak };
}

function randomPlayer(i, top) {
  const touch = rnd() < 0.2;
  const fps = touch ? pick([60, 60, 60, 120]) : pick([60, 60, 60, 60, 60, 60, 60, 144, 144, 120, 240, 75, 30]);
  const ping = touch ? 0 : pick([0, 0, 150, 300]);
  // skill: timing SD of a release, ms (top-of-board .. new), plus a Weber share
  // that grows with the hold (the far end of the bar is harder to time)
  const tier = top ? rnd() * 0.3 : rnd();          // top: the top-of-board tier only
  const sigma = tier < 0.3 ? U(4.5, 12) : tier < 0.7 ? U(12, 28) : U(28, 70);
  const weber = tier < 0.3 ? U(0, 0.008) : U(0.004, 0.02);
  const longRun = top || rnd() < 0.35;
  return {
    comp: rnd() < 0.5, touch, src: pick(['t', 'b']), ping,
    interval: 1000 / fps, pDrop: U(0, 0.04), pStall: rnd() < 0.3 ? 1 / 3000 : 0,
    pJank: rnd() < 0.3 ? U(0.002, 0.03) : 0,                 // long tasks: stale frame stamps, input handled late
    clockQ: pick([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 16.67, 100]),   // coarse timers (privacy settings)
    sigma, weber, biasMs: tier < 0.3 ? N(0, 3) : N(0, 8), lapse: tier < 0.3 ? U(0.001, 0.006) : U(0.01, 0.03),
    latMed: U(220, 320),
    holdThrough: rnd() < 0.15,
    // Anticipators press on the 700 ms rhythm (the zone does not change when to
    // press). A press that lands in the gap is ignored, so they aim just after
    // it; the tightest self-timed ~0.7 s interval people produce has an SD of
    // about 2 % (14 ms, trained musicians).
    anticipate: rnd() < 0.25, antAim: U(15, 140), antSd: U(14, 50),
    pPause: pick([0, 0, 0, 0.01, 0.03, 0.08, 0.2]),
    cap: top ? Math.floor(U(150, 900)) : longRun ? Math.floor(U(100, 700)) : Math.floor(U(3, 100)),
  };
}

let failures = 0;
function fail(msg) { failures++; console.error('FAIL: ' + msg); }

// ── a) honest ──
const RUNS = +(process.env.HAMMER_RUNS || 2400);
const TOP_RUNS = +(process.env.HAMMER_TOP_RUNS || 600);   // extra runs by top players aiming for long streaks
let invalid = 0, review = 0, mismatch = 0, total = 0, maxScore = 0, sumScore = 0, snapChecks = 0, snapReview = 0, long = 0, heldRuns = 0;
const reviewWhy = {};
const honestSamples = [];
let ksN = 0, ks01 = 0, ks0005 = 0;
const near = { offSd: 1e9, lattice: 1e9, zonesP: 1, fastShare: 0, pressSd: 1e9, gaveUpP: 1, gaveUpMaxN: 0, gaveUpRuns: 0 };
const tol = { fillLead: -1e9, gapShort: -1e9, resumeLate: 0 };
for (let i = 0; i < RUNS + TOP_RUNS; i++) {
  const pl = randomPlayer(i, i >= RUNS);
  const out = simulate(pl);
  total++;
  maxScore = Math.max(maxScore, out.score); sumScore += out.score; if (out.score >= 100) long++;
  const type = out.log.type;
  const r = Q.check(type, out.log, { platform: pl.touch ? 'M' : 'C', claimed: out.score });
  if (r.verdict === 'invalid') { invalid++; if (invalid <= 5) console.error('honest invalid', r.reasons, JSON.stringify(pl)); }
  else if (r.verdict === 'review') { review++; if (process.env.HAMMER_VERBOSE) { console.error('honest review', r.reasons, JSON.stringify(r.stats), JSON.stringify(pl)); require('fs').writeFileSync(require('path').join(require('os').tmpdir(), 'hammer-review-' + review + '.json'), JSON.stringify(out.log)); } reviewWhy[r.reasons[0].replace(/[\d.]+/g, '#')] = (reviewWhy[r.reasons[0].replace(/[\d.]+/g, '#')] || 0) + 1; }
  if (r.verdict !== 'invalid') {
    // closest honest approach to each review threshold
    const st = r.stats, hits = st.hits || 0, P = H.PERSON;
    if (hits >= P.ACC_MIN_N) near.offSd = Math.min(near.offSd, st.offSdMs);
    if (st.latticeRatio !== undefined) near.lattice = Math.min(near.lattice, st.latticeRatio);
    if (hits >= P.KS_MIN_N) { const zp = +st.zonesP; near.zonesP = Math.min(near.zonesP, zp); ksN++; if (zp < 0.01) ks01++; if (zp < 0.0005) ks0005++; }
    const presses = (st.rounds || 0);
    if (st.pressFastShare !== undefined && presses >= P.LAT_MIN_N) near.fastShare = Math.max(near.fastShare, st.pressFastShare);
    if (st.pressSdMs !== undefined && presses >= P.STEADY_MIN_N) near.pressSd = Math.min(near.pressSd, st.pressSdMs);
    if (st.gaveUpP !== undefined) { near.gaveUpRuns++; near.gaveUpP = Math.min(near.gaveUpP, +st.gaveUpP); near.gaveUpMaxN = Math.max(near.gaveUpMaxN, st.gaveUp); }
    // timing tolerances: how far the bar led the hold, how early a timer round read, how late a resume round
    let k = 0, d = 0;
    const timers = [];                                // hits whose 700 ms timer is pending, oldest first
    for (const e of out.log.ev) {
        if (e[0] === 'R') { k = e[2]; if (e[5] === 'n' && timers.length) tol.gapShort = Math.max(tol.gapShort, timers.shift() + H.GAP_MS - e[1]); }
        else if (e[0] === 'D') d = e[1];
        else if (e[0] === 'X') { tol.fillLead = Math.max(tol.fillLead, e[2] / H.speed(k, out.log.type !== 'hammer') * 1000 - (e[1] - d)); if (e[5] === 1) timers.push(e[1]); }
    }
    for (let i = 1; i < out.log.ev.length; i++) if (out.log.ev[i][0] === 'R' && out.log.ev[i][5] === 'u') tol.resumeLate = Math.max(tol.resumeLate, out.log.ev[i][1] - out.log.ev[i - 1][1]);
  }
  if (r.verdict !== 'invalid' && r.score !== out.score) { mismatch++; if (mismatch <= 5) console.error('honest mismatch', r.score, out.score, r.reasons); }
  // submits happen at hits (each new local best): check the last one and a few others
  const hl = out.hitLens, idx = hl.length ? [hl.length - 1] : [];
  for (let k = 0; k < 3 && hl.length > 1; k++) idx.push(Math.floor(rnd() * hl.length));
  let anyHeld = r.verdict === 'review';
  for (const j of idx) {
    const [len, claimed] = hl[j];
    const snap = { v: 1, rv: out.log.rv, type, a: 0, env: out.log.env, ev: out.log.ev.slice(0, len) };
    const r2 = Q.check(type, snap, { platform: 'C', claimed });
    snapChecks++;
    if (r2.verdict === 'invalid' || r2.score !== claimed) { mismatch++; if (mismatch <= 5) console.error('snapshot', r2.reasons, r2.score, claimed); }
    else if (r2.verdict === 'review') { snapReview++; anyHeld = true; }
  }
  if (anyHeld) heldRuns++;
  if (out.score >= 25 && honestSamples.length < 40) honestSamples.push({ pl, out });
}
console.log(`honest: ${total} runs (mean score ${(sumScore / total).toFixed(1)}, max ${maxScore}, ${long} runs >= 100; ${snapChecks} mid-run submits checked, ${snapReview} held): invalid ${invalid}, review ${review} (${(100 * review / total).toFixed(2)}%), score mismatch ${mismatch}; runs with any submit held ${heldRuns} (${(100 * heldRuns / total).toFixed(2)}%)` + (review ? ' ' + JSON.stringify(reviewWhy) : ''));
console.log(`  zone-draw KS on hits: ${ksN} runs tested, ${ks01} with p < 0.01, ${ks0005} with p < 0.0005 (uniform draws: ~1% and ~0.05%; review below 1e-5)`);
console.log('  closest honest approach: ' + JSON.stringify(near, (k, v) => typeof v === 'number' ? +v.toPrecision(3) : v) + ' vs thresholds ' + JSON.stringify(H.PERSON));
console.log(`  timing tolerances used: bar ahead of the hold ${tol.fillLead.toFixed(1)} ms (FILL_SLACK ${H.TOL.FILL_SLACK_MS}), timer round early ${tol.gapShort.toFixed(0)} ms (GAP_EARLY ${H.TOL.GAP_EARLY_MS}), resume round late ${tol.resumeLate} ms (RESUME ${H.TOL.RESUME_MS})`);
if (tol.fillLead > H.TOL.FILL_SLACK_MS || tol.gapShort > H.TOL.GAP_EARLY_MS || tol.resumeLate > H.TOL.RESUME_MS) fail('an honest log went past a timing tolerance');
if (invalid) fail('honest runs invalid');
if (mismatch) fail('honest score mismatch');
if (heldRuns / total > 0.005) fail('honest review rate above 0.5%');

// ── a2) honest edge cases the simulator cannot reach by chance ──
{
  const env = { w: 1280, h: 720, mob: false, ping: 0 };
  const L = (type, ev) => ({ v: 1, rv: 1, type, a: 0, env, ev });
  const sz0 = H.size(0, false), sz1 = H.size(1, false);
  const edge = [
    // an old run's 700 ms timer fires 600 ms into a new Start: an extra round, no hit behind it
    ['stray timer from the previous run', L('hammer', [['R', 1, 0, 0.5, 0.5 + sz0, 's'], ['R', 600, 0, 0.6, 0.6 + sz0, 'n'],
      ['D', 900, 'k'], ['X', 3000, 0.64, 126, 'k', 1]]), 1, 1],
    // left the panel during the 700 ms gap and resumed inside it: the resume round, then the timer's round
    ['resume inside the gap (two rounds for one hit)', L('hammer', [['R', 1, 0, 0.5, 0.5 + sz0, 's'], ['D', 300, 'k'], ['X', 2200, 0.55, 114, 'k', 1],
      ['P', 2400], ['U', 2700], ['R', 2700, 1, 0.6, 0.6 + sz1, 'u'], ['D', 2800, 'k'], ['R', 2903, 1, 0.52, 0.52 + sz1, 'n'],
      ['D', 3200, 'k'], ['X', 4900, 0.56, 102, 'k', 1]]), 2, 2],
    // Space pressed between the Resume click and the first frame: the first dt is negative
    ['negative fill on the first frame after Resume', L('hammer', [['R', 1, 0, 0.5, 0.5 + sz0, 's'], ['P', 200], ['U', 5000],
      ['R', 5000, 0, 0.6, 0.6 + sz0, 'u'], ['D', 5004, 'k'], ['X', 5010, -0.004, 1, 'k', 0], ['E', 5010, 'early']]), 0, 0],
    // a release rounded onto the zone edge by run.ev's 4 dp: a hit that logs fill === zoneMin
    ['hit logged exactly on the zone edge', L('hammer', [['R', 1, 0, 0.5, 0.5 + sz0, 's'], ['D', 300, 'k'], ['X', 2000, 0.5, 102, 'k', 1]]), 1, 1],
    // a miss rounded onto the zone edge (true fill 0.49996 < zoneMin 0.49997; both log 0.5)
    ['miss logged exactly on the zone edge', L('hammer', [['R', 1, 0, 0.5, 0.5 + sz0, 's'], ['D', 300, 'k'], ['X', 2000, 0.5, 102, 'k', 0], ['E', 2000, 'early']]), 0, 0],
    // 20 Hz (throttled laptop), Space handled at the end of a long task, just
    // before a frame with a stale stamp: that frame adds a clamped 50 ms and
    // the next one another 50 ms, nearly all from before the press. The bar
    // leads the press->release time by ~100 ms.
    ['bar ~100 ms ahead of the hold (press during a long task)', L('hammer', [['R', 1, 0, 0.5, 0.5 + sz0, 's'], ['D', 1000, 'k'],
      ['X', 2733, r4(0.3 * 1.833), 37, 'k', 1]]), 1, 1],
    // Resume clicked during a 2 s long task: the first frame's dt is -2 s (not
    // clamped), and a tap in that window logs a very negative fill (an early miss).
    ['very negative fill after Resume in a long task', L('hammer', [['R', 1, 0, 0.5, 0.5 + sz0, 's'], ['D', 300, 'k'], ['X', 2200, 0.55, 114, 'k', 1],
      ['P', 3000], ['U', 9000], ['R', 9000, 1, 0.6, 0.6 + sz1, 'u'], ['D', 9001, 'k'], ['X', 9040, -0.65, 0, 'k', 0], ['E', 9040, 'early']]), 1, 1],
    // Tor / resistFingerprinting: every time is a multiple of 100 ms, rAF too, so
    // the bar moves one clamped 50 ms step per 100 ms (half speed).
    ['100 ms privacy clock', L('hammer', [['R', 0, 0, 0.5, 0.5 + sz0, 's'], ['D', 300, 'k'], ['X', 4000, 0.555, 37, 'k', 1],
      ['R', 4700, 1, 0.47, r4(0.47 + sz1), 'n'], ['D', 4900, 'k'], ['X', 8100, 0.52, 32, 'k', 1]]), 2, 2],
  ];
  // run.ev stops writing at MAX_EVENTS: a player who pauses/resumes endlessly
  const full = [['R', 1, 0, 0.5, 0.5 + sz0, 's']];
  for (let t = 10; full.length < Q.LIMITS.MAX_EVENTS; t += 1000) { const a = 0.45 + 0.35 * rnd() - sz0 / 2; full.push(['P', t], ['U', t + 500], ['R', t + 500, 0, r4(a), r4(a + sz0), 'u']); }
  full.length = Q.LIMITS.MAX_EVENTS;
  edge.push(['log cut at MAX_EVENTS (claim above what it shows)', L('hammer', full), 3, 0]);
  let bad = 0;
  for (const [name, log, claimed, want] of edge) {
    const r = Q.check(log.type, log, { platform: 'C', claimed });
    if (r.verdict !== 'valid' || r.score !== want) { bad++; fail(`edge "${name}" -> ${r.verdict} ${r.score} ${r.reasons.join('; ')}`); }
  }
  console.log(`edge: ${edge.length} honest edge cases, ${bad} failed`);
}
// ── b) forgeries ──
const clone = (x) => JSON.parse(JSON.stringify(x));
function verdictOf(log, claimed, type) { return Q.check(type || log.type, log, { platform: 'C', claimed }); }
const forgeries = [];
function expect(name, r, claimed, want) {
  // want: 'invalid' | 'review' | 'caught' (invalid, review, or score far below the claim)
  const caught = r.verdict === 'invalid' || r.verdict === 'review' || r.score <= claimed / 2;
  const ok = want === 'invalid' ? r.verdict === 'invalid' : want === 'review' ? r.verdict !== 'valid' : caught;
  forgeries.push({ name, verdict: r.verdict + ' (score ' + r.score + '/' + claimed + ') ' + (r.reasons[0] || '') });
  if (!ok) fail(`forgery "${name}" -> ${r.verdict} score ${r.score} ${r.reasons.join('; ')}`);
}

// A base honest log with a decent score.
const base = honestSamples.find((s) => s.out.score >= 30 && s.pl.ping === 0) || honestSamples[0];
const bLog = base.out.log, bScore = base.out.score;

expect('no events + claim', verdictOf({ v: 1, rv: 1, type: 'hammer', a: 0, env: { w: 0, h: 0, mob: false, ping: 0 }, ev: [] }, 12), 12, 'invalid');
expect('claim above the logged points', verdictOf(bLog, bScore + 5), bScore + 5, 'invalid');
{
  const L = clone(bLog); L.ev.forEach((e) => { e[1] = Math.round(e[1] * 0.5); });
  expect('honest log, times x0.5', verdictOf(L, bScore), bScore, 'invalid');
}
{
  const L = clone(bLog); L.ev.forEach((e) => { e[1] = Math.round(e[1] * 0.8); });
  expect('honest log, times x0.8', verdictOf(L, bScore), bScore, 'invalid');
}
{
  // the final miss marked as a hit (and its end removed)
  const L = clone(bLog); const i = L.ev.length - 2;
  L.ev[i][5] = 1; L.ev.pop();
  expect('logged miss flipped to hit', verdictOf(L, bScore + 1), bScore + 1, 'invalid');
}
{
  const L = clone(bLog); const i = L.ev.findIndex((e, k) => e[0] === 'R' && k > 10);
  const sz = L.ev[i][4] - L.ev[i][3]; L.ev[i][3] = r4(0.9 - sz / 2); L.ev[i][4] = r4(0.9 + sz / 2);
  expect('zone centre outside [0.45, 0.80)', verdictOf(L, bScore), bScore, 'invalid');
}
{
  const L = clone(bLog); const i = L.ev.findIndex((e, k) => e[0] === 'R' && k > 10);
  L.ev[i][3] = r4(L.ev[i][3] - 0.02);
  expect('zone wider than the streak allows', verdictOf(L, bScore), bScore, 'invalid');
}
{
  const L = clone(bLog); const i = L.ev.findIndex((e, k) => e[0] === 'R' && k > 10);
  L.ev[i][2] += 3;
  expect('round streak does not match the hits', verdictOf(L, bScore), bScore, 'invalid');
}

// A generic forger: writes a clean log from a policy.
function forge(o) {
  const comp = !!o.comp, type = 'hammer' + (comp ? '-comp' : '');
  const ev = []; let t = 2, k = 0;
  const frame = o.frame || 1000 / 60;
  const push = (e) => { e[1] = Math.round(e[1]); ev.push(e.map(r4)); };
  for (let i = 0; i < o.hits; i++) {
    const size = H.size(k, comp), sp = H.speed(k, comp);
    const c = o.centre ? o.centre(i) : H.C_MIN + rnd() * H.C_SPAN;
    const zmax = c - size / 2 + size, zmin = zmax - size;
    push(['R', t, k, zmin, zmax, i === 0 ? 's' : 'n']);
    const d = t + o.latency(i);
    push(['D', d, 'k']);
    let fill = o.fill ? o.fill(c, sp, frame, zmin, zmax) : c + o.offsetMs(i) * sp / 1000;
    fill = Math.min(zmax, Math.max(zmin, fill));
    const n = Math.max(1, Math.round(fill / sp * 1000 / frame));
    const x = d + fill / sp * 1000 + (o.holdExtra ? o.holdExtra() : U(0, frame));
    push(['X', x, fill, n, 'k', 1]);
    k++;
    t = x + H.GAP_MS + U(0, 3);
  }
  return { v: 1, rv: 1, type, a: 0, env: { w: 1280, h: 720, mob: false, ping: o.ping || 0 }, ev };
}
const humanLat = () => Math.exp(Math.log(260) + 0.25 * normal());
const humanOff = () => N(0, 18);

{
  const L = forge({ hits: 60, latency: humanLat, offsetMs: humanOff });
  const r = verdictOf(L, 60);
  if (r.verdict !== 'valid') fail('the forger\'s human-like baseline should be valid (else forgeries prove nothing): ' + r.reasons);
  forgeries.push({ name: 'control: forger with human-like numbers (cannot catch)', verdict: r.verdict + ' (score ' + r.score + '/60)' });
}
expect('cherry-picked easiest zones (centres < 0.50)', verdictOf(forge({ hits: 40, latency: humanLat, offsetMs: humanOff, centre: () => U(0.45, 0.5) }), 40), 40, 'review');
expect('perfect bot (every release at the zone centre)', verdictOf(forge({ hits: 40, latency: humanLat, offsetMs: () => 0 }), 40), 40, 'review');
expect('frame-exact bot (release on the frame nearest the centre, 60 Hz)', verdictOf(forge({
  hits: 90, latency: humanLat,
  fill: (c, sp, fr) => { const st = sp * fr / 1000; return Math.round(c / st) * st; },
}), 90), 90, 'review');
expect('metronome bot (press 250 ms after every round)', verdictOf(forge({ hits: 40, latency: () => 250, offsetMs: humanOff }), 40), 40, 'review');
expect('instant presses (~15 ms after every round)', verdictOf(forge({ hits: 40, latency: () => Math.abs(N(15, 6)), offsetMs: humanOff }), 40), 40, 'review');
{
  const L = forge({ hits: 30, latency: humanLat, offsetMs: humanOff });
  const i = L.ev.findIndex((e, k) => e[0] === 'D' && k > 10); const tmp = L.ev[i]; L.ev[i] = L.ev[i - 1]; L.ev[i - 1] = tmp;
  const tt = L.ev[i][1]; L.ev[i][1] = L.ev[i - 1][1]; L.ev[i - 1][1] = tt;          // keep times sorted
  expect('impossible order (press before its round)', verdictOf(L, 30), 30, 'invalid');
}
{
  const L = forge({ hits: 30, latency: humanLat, offsetMs: humanOff });
  const i = L.ev.findIndex((e, k) => e[0] === 'D' && k > 10); L.ev.splice(i, 1);
  expect('release with no press', verdictOf(L, 30), 30, 'invalid');
}
{
  const L = forge({ hits: 30, latency: humanLat, offsetMs: humanOff });
  // next round 300 ms after a hit instead of 700
  const i = L.ev.findIndex((e, k) => e[0] === 'R' && k > 10);
  const shift = 400; for (let k = i; k < L.ev.length; k++) L.ev[k][1] -= shift;
  // no pending 700 ms timer: counting stops there (a stray timer from an old run is the only honest source)
  expect('round starts 300 ms after a hit', verdictOf(L, 30), 30, 'caught');
}
expect('replayed honest log with a higher claim', verdictOf(clone(bLog), bScore * 2), bScore * 2, 'invalid');
{
  const L = forge({ hits: 30, latency: humanLat, offsetMs: humanOff, holdExtra: () => -250 });
  expect('holds shorter than the bar needs', verdictOf(L, 30), 30, 'invalid');
}
{
  const L = forge({ hits: 30, latency: humanLat, offsetMs: humanOff });
  L.ev.forEach((e) => { if (e[0] === 'X') e[3] = 3; });
  expect('too few frames for the fill', verdictOf(L, 30), 30, 'invalid');
}
{
  const L = clone(bLog); const e = L.ev[L.ev.length - 1]; e[2] = e[2] === 'early' ? 'late' : 'early';
  expect('end reason contradicts the release', verdictOf(L, bScore), bScore, 'invalid');
}
{
  const L = clone(bLog); const last = L.ev[L.ev.length - 1][1];
  L.ev.push(['R', last + 800, bScore, 0.5, 0.5 + H.size(bScore, false), 'n']);
  expect('events after the end', verdictOf(L, bScore), bScore, 'invalid');
}
{
  const L = forge({ hits: 30, latency: humanLat, offsetMs: humanOff });
  const i = L.ev.findIndex((e, k) => e[0] === 'R' && k > 10); L.ev[i][5] = 'u';
  expect('resume round with no pause', verdictOf(L, 30), 30, 'invalid');
}
{
  const L = forge({ hits: 30, latency: humanLat, offsetMs: humanOff });
  const i = L.ev.findIndex((e, k) => e[0] === 'X' && k > 10); L.ev[i][2] = 1; L.ev[i][4] = 'o'; L.ev[i][5] = 0;
  expect('overfill miss recorded as the run going on', verdictOf(L, 30), 30, 'invalid');
}
{
  // rerolls: extra timer rounds with no hit behind them, late in the run
  const L = forge({ hits: 30, latency: humanLat, offsetMs: humanOff });
  const i = L.ev.findIndex((e, k) => e[0] === 'R' && e[1] > 8000);
  const e = L.ev[i]; L.ev.splice(i, 0, ['R', e[1], e[2], e[3], e[4], 'n']);
  const r = verdictOf(L, 30);
  expect('extra timer rounds to reroll zones (score stops there)', r, 30, 'caught');
}
{
  const L = clone(bLog); L.type = 'hammer-comp';
  expect('casual log submitted as comp', verdictOf(L, bScore, 'hammer-comp'), bScore, 'invalid');
}
{
  const L = forge({ hits: 30, latency: humanLat, offsetMs: humanOff });
  const i = L.ev.findIndex((e, k) => e[0] === 'X' && k > 10); L.ev[i][2] = r4(L.ev[i][2] + 0.2);
  expect('hit logged outside the zone', verdictOf(L, 30), 30, 'invalid');
}
{
  const L = forge({ hits: 30, latency: humanLat, offsetMs: humanOff });
  L.ev.unshift(['P', 0]);
  expect('pause before Start', verdictOf(L, 30), 30, 'invalid');
}

{
  // Pause/Resume re-rolls the zone in the real trainer. A forger (or a player
  // leaving and resuming whenever the zone is far) keeps only near zones.
  const ev = []; let t = 3, k = 0;
  const push = (e) => { e[1] = Math.round(e[1]); ev.push(e.map(r4)); };
  const zone = (c, sz) => { const b = c - sz / 2 + sz; return [b - sz, b]; };
  for (let i = 0; i < 60; i++) {
    const sz = H.size(k, false), sp = H.speed(k, false);
    let c = H.C_MIN + rnd() * H.C_SPAN, z = zone(c, sz);
    push(['R', t, k, z[0], z[1], i === 0 ? 's' : 'n']);
    while (c > 0.58) {
      t += U(150, 400); push(['P', t]);
      t += U(300, 900); push(['U', t]);
      c = H.C_MIN + rnd() * H.C_SPAN; z = zone(c, sz);
      push(['R', t, k, z[0], z[1], 'u']);
    }
    const d = t + humanLat(); push(['D', d, 'k']);
    const fill = Math.min(z[1], Math.max(z[0], c + humanOff() * sp / 1000));
    const x = d + fill / sp * 1000 + U(0, 16); push(['X', x, fill, Math.round(fill / sp * 60), 'k', 1]);
    k++; t = x + H.GAP_MS + U(0, 3);
  }
  const L = { v: 1, rv: 1, type: 'hammer', a: 0, env: { w: 1280, h: 720, mob: false, ping: 0 }, ev };
  expect('pause/resume to re-roll every far zone (keeps centres < 0.58)', verdictOf(L, 60), 60, 'review');
}
{
  // the same 60 hits but with the far zones' rounds simply deleted from the log
  const ev = []; let t = 3, k = 0;
  const push = (e) => { e[1] = Math.round(e[1]); ev.push(e.map(r4)); };
  for (let i = 0; i < 60; i++) {
    const sz = H.size(k, true), sp = H.speed(k, true);
    const c = U(0.45, 0.6), zb = c - sz / 2 + sz, za = zb - sz;
    push(['R', t, k, za, zb, i === 0 ? 's' : 'n']);
    const d = t + humanLat(); push(['D', d, 'k']);
    const fill = Math.min(zb, Math.max(za, c + humanOff() * sp / 1000));
    const x = d + fill / sp * 1000 + U(0, 16); push(['X', x, fill, Math.round(fill / sp * 60), 'k', 1]);
    k++; t = x + H.GAP_MS + U(0, 3);
  }
  const L = { v: 1, rv: 1, type: 'hammer-comp', a: 0, env: { w: 1280, h: 720, mob: false, ping: 0 }, ev };
  expect('comp: only near zones (centres < 0.60), far rounds cut out', verdictOf(L, 60), 60, 'review');
}
{
  // a comp log that keeps the casual (slower, wider) difficulty after streak 10
  const L = forge({ hits: 30, comp: true, latency: humanLat, offsetMs: humanOff });
  const i = L.ev.findIndex((e) => e[0] === 'R' && e[2] === 12);
  const e = L.ev[i], c = (e[3] + e[4]) / 2, sz = H.size(12, false);
  e[3] = r4(c - sz / 2); e[4] = r4(c + sz / 2);
  expect('comp log with a casual-size zone at streak 12', verdictOf(L, 30), 30, 'invalid');
}
{
  // hold ended by the bar reaching the end, logged as a key release inside the zone
  const L = forge({ hits: 30, latency: humanLat, offsetMs: humanOff });
  const i = L.ev.findIndex((e, k) => e[0] === 'X' && k > 10);
  L.ev[i][2] = 1;
  expect('full bar logged as a hit', verdictOf(L, 30), 30, 'invalid');
}
// ── b2) malformed and hand-written logs ──
{
  const good = () => forge({ hits: 30, latency: humanLat, offsetMs: humanOff });
  const at = (L, code, nth) => { let n = 0; for (let i = 0; i < L.ev.length; i++) if (L.ev[i][0] === code && n++ === nth) return i; return -1; };
  const mut = (name, fn, want) => { const L = good(); fn(L); expect(name, verdictOf(L, 30), 30, want || 'invalid'); };
  mut('streak field as a string ("5")', (L) => { const i = at(L, 'R', 5); L.ev[i][2] = String(L.ev[i][2]); });
  mut('fill as a string ("0.55")', (L) => { const i = at(L, 'X', 5); L.ev[i][2] = String(L.ev[i][2]); });
  mut('fill as the string "NaN"', (L) => { L.ev[at(L, 'X', 5)][2] = 'NaN'; });
  mut('fill as the string "Infinity"', (L) => { L.ev[at(L, 'X', 5)][2] = 'Infinity'; });
  mut('fill null', (L) => { L.ev[at(L, 'X', 5)][2] = null; });
  mut('hit as true instead of 1', (L) => { L.ev[at(L, 'X', 5)][5] = true; });
  mut('fractional frame count', (L) => { L.ev[at(L, 'X', 5)][3] += 0.5; });
  mut('negative frame count', (L) => { L.ev[at(L, 'X', 5)][3] = -40; });
  mut('huge frame count', (L) => { L.ev[at(L, 'X', 5)][3] = 1e9; });
  mut('huge fill (1e300)', (L) => { L.ev[at(L, 'X', 5)][2] = 1e300; });
  mut('huge streak in a round', (L) => { L.ev[at(L, 'R', 5)][2] = 1e9; });
  mut('negative fill logged as a hit', (L) => { L.ev[at(L, 'X', 5)][2] = -0.5; });
  mut('negative time', (L) => { L.ev[0][1] = -5; });
  mut('a round with no reason', (L) => { L.ev[at(L, 'R', 5)].length = 5; });
  mut('lower-case event code', (L) => { L.ev[at(L, 'X', 5)][0] = 'x'; });
  mut('unknown event code', (L) => { const i = at(L, 'X', 5); L.ev.splice(i, 0, ['Z', L.ev[i][1]]); });
  mut('a hit ended by an overfill', (L) => { const i = at(L, 'X', 5); L.ev[i][4] = 'o'; });
  mut('duplicate hit (the same X twice)', (L) => { const i = at(L, 'X', 5); L.ev.splice(i + 1, 0, L.ev[i].slice()); });
  mut('duplicate press', (L) => { const i = at(L, 'D', 5); L.ev.splice(i + 1, 0, L.ev[i].slice()); });
  mut('two Start rounds', (L) => { const i = at(L, 'R', 5); L.ev[i][5] = 's'; });
  mut('first round is a timer round', (L) => { L.ev[0][5] = 'n'; });
  mut('Start round an hour in', (L) => { const d = 3600000; L.ev.forEach((e) => { e[1] += d; }); });
  mut('resume with no pause before it', (L) => { const i = at(L, 'R', 5); L.ev.splice(i, 0, ['U', L.ev[i][1]]); L.ev[i + 1][5] = 'u'; });
  mut('events after the end', (L) => { const i = at(L, 'X', 8); L.ev[i][2] = 0.2; L.ev[i][5] = 0; L.ev.splice(i + 1, 0, ['E', L.ev[i][1], 'early']); });
  {
    // a duplicated timer round an hour... no: well after the first 2 s - counting stops there
    const L = good(); const i = at(L, 'R', 10); L.ev.splice(i + 1, 0, L.ev[i].slice());
    expect('duplicate timer round (re-roll) mid-run', verdictOf(L, 30), 30, 'caught');
  }
  expect('minimal log: one hit, claim 50', verdictOf({ v: 1, rv: 1, type: 'hammer', a: 0, env: {}, ev: [['R', 0, 0, 0.5, 0.6, 's'], ['D', 250, 'k'], ['X', 2100, 0.55, 111, 'k', 1]] }, 50), 50, 'invalid');
  expect('same zone every round (one target reused)', verdictOf(forge({ hits: 40, latency: humanLat, offsetMs: humanOff, centre: () => 0.6 }), 40), 40, 'review');
  {
    // 30 real-looking hits, then a timer round with no hit behind it (counting
    // stops), then 200 invented hits the check never reads
    const L = good(); const last = L.ev[L.ev.length - 1][1];
    const tail = forge({ hits: 200, latency: humanLat, offsetMs: humanOff });
    L.ev.push(['R', last + 5000, 30, 0.5, r4(0.5 + H.size(30, false)), 'n']);   // the last hit's timer
    L.ev.push(['R', last + 5400, 30, 0.6, r4(0.6 + H.size(30, false)), 'n']);   // no timer behind it
    tail.ev.slice(1).forEach((e) => { e[1] += last + 6000; L.ev.push(e); });
    expect('stop point, then 200 invented hits', verdictOf(L, 230), 230, 'caught');
  }
  {
    // a log padded to MAX_EVENTS with pauses (counting stops at the cut) and a big claim
    const ev = [['R', 1, 0, 0.5, 0.5 + H.size(0, false), 's']];
    for (let t = 10; ev.length < Q.LIMITS.MAX_EVENTS; t += 1000) ev.push(['P', t], ['U', t + 500], ['R', t + 500, 0, r4(0.45 + 0.35 * rnd() - H.size(0, false) / 2), 0, 'u']);
    ev.length = Q.LIMITS.MAX_EVENTS; ev.forEach((e) => { if (e[0] === 'R') e[4] = r4(e[3] + H.size(0, false)); });
    expect('log padded to MAX_EVENTS, claim 1000', verdictOf({ v: 1, rv: 1, type: 'hammer', a: 0, env: {}, ev }, 1000), 1000, 'caught');
  }
}
{
  // The re-roll exploit on the REAL client (it logs honestly): leave the panel
  // whenever the zone is far (centre > 0.72, the far 23 %) and Resume for a new
  // one. Over 100 hits (~30 re-rolls) the hit zones alone are barely unlikely
  // (p ~ 1e-4); the zones given up are all far, which chance never does.
  const ev = []; let t = 3, k = 0;
  const push = (e) => { e[1] = Math.round(e[1]); ev.push(e.map(r4)); };
  const zone = (c, sz) => { const b = c - sz / 2 + sz; return [b - sz, b]; };
  for (let i = 0; i < 100; i++) {
    const sz = H.size(k, false), sp = H.speed(k, false);
    let c = H.C_MIN + rnd() * H.C_SPAN, z = zone(c, sz);
    push(['R', t, k, z[0], z[1], i === 0 ? 's' : 'n']);
    while (c > 0.72) {
      t += U(300, 700); push(['P', t]);
      t += U(800, 2500); push(['U', t]);
      c = H.C_MIN + rnd() * H.C_SPAN; z = zone(c, sz);
      push(['R', t, k, z[0], z[1], 'u']);
    }
    const d = t + humanLat(); push(['D', d, 'k']);
    const fill = Math.min(z[1], Math.max(z[0], c + humanOff() * sp / 1000));
    const x = d + fill / sp * 1000 + U(0, 16); push(['X', x, fill, Math.round(fill / sp * 60), 'k', 1]);
    k++; t = x + H.GAP_MS + U(0, 3);
  }
  const L = { v: 1, rv: 1, type: 'hammer', a: 0, env: { w: 1280, h: 720, mob: false, ping: 0 }, ev };
  const r = verdictOf(L, 100);
  expect('real client: pause to re-roll only far zones (> 0.72), 100 hits', r, 100, 'review');
  if (r.verdict === 'review' && !/given up/.test(r.reasons.join(' '))) fail('re-roll exploit caught, but not by the given-up zones check: ' + r.reasons);
}
forgeries.forEach((f) => console.log('  forgery: ' + f.name + ' -> ' + f.verdict));
console.log(`forgeries: ${forgeries.length} checked, ${failures ? 'with failures' : 'all caught (except the control)'}`);

if (process.env.HAMMER_JSON) require('fs').writeFileSync(process.env.HAMMER_JSON, JSON.stringify({ honest: { runs: total, invalid, review, scoreMismatch: mismatch }, forgeries }, null, 1));
if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('hammer: all ok');
