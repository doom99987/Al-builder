// duraelis.test.js - node duraelis.test.js   (N=20000 NI=3000 NL=400 NB=40 node duraelis.test.js for the long version)
// a) honest players simulated through the trainer's own state machine (frame
//    rates 15-240 Hz, dropped frames, long tasks, coarse clocks, the ping sim,
//    touch, pauses from the panel, the page and the browser tab), each one
//    seeing the spotlights, working out the shift, pressing with human timing,
//    misreading, missing the wrap, slipping, and correcting
// a2) long runs by the best players into the hardest tables; a2b) 15 fps
//    machines; a3) a run that fills the log (MAX_EVENTS) stays under MAX_BYTES
//    and still checks out
// b) forgeries, each must come out invalid, review, or scored far below the claim
// c) the real IIFE (duraelis.iife.js) in a fake DOM with a virtual clock,
//    played by a person watching the canvas (the souls, the spotlights and the
//    timer, read by their colours): every submit and every whole log checked,
//    plus targeted scenarios (pauses across the intro and the between-rounds
//    timer, the board hidden while paused, a Start inside the end's reset, a
//    Resume behind a stale frame, resizes, held keys, arrows, the fight result
//    line, the mobile D-pad and swipes)
// d) tools/qte/bots/duraelis.bot.js against the shipped rules + IIFE in a vm page
// exit code 1 on any failure
'use strict';
require('./_paths.js');
const fs = require('fs'), path = require('path');
const Q = require(path.join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const D = Q.trainers['duraelis'];
if (!D || typeof D.check !== 'function') { console.log('FAIL duraelis rules not registered'); process.exit(1); }
const T_START = Date.now();

let failures = 0;
function fail(msg) { failures++; if (failures < 40) console.log('  FAIL ' + msg); }

// ── randomness ──────────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rng) { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
function uni(rng, a, b) { return a + (b - a) * rng(); }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function expo(rng, mean) { return -Math.log(1 - rng()) * mean; }
function logn(rng, med, sig) { return med * Math.exp(sig * normal(rng)); }
function r4(f) { return typeof f === 'number' ? Math.round(f * 10000) / 10000 : f; }
const KEYS4 = ['W', 'A', 'S', 'D'];

// ── the person: how they turn a needed offset into presses ──────────────────
// The offset (ox, oy) the souls still need, as the person reads the board:
// the cheapest one that puts every soul on a spotlight.
function neededOffset(mask, spots) {
  let best = null;
  for (let oy = 0; oy < D.ROWS; oy++) for (let ox = 0; ox < D.COLS; ox++) {
    if (D.translate(mask, ox, oy) !== spots) continue;
    if (!best || D.stepCost(ox, oy) < D.stepCost(best[0], best[1])) best = [ox, oy];
  }
  return best;
}
// The keys a person presses for an offset: the short way round, unless they
// miss the wrap (then three D for one A, three S for one W); either way for
// two columns or rows; sideways or up/down first at random.
function humanKeys(rng, ox, oy, o) {
  const h = [], v = [];
  if (ox === 1) h.push('D');
  else if (ox === 2) { const k = rng() < 0.5 ? 'D' : 'A'; h.push(k, k); }
  else if (ox === 3) { if (rng() < o.blindP) h.push('D', 'D', 'D'); else h.push('A'); }
  if (oy === 1) v.push('S');
  else if (oy === 2) { const k = rng() < 0.5 ? 'S' : 'W'; v.push(k, k); }
  else if (oy === 3) { if (rng() < o.blindP) v.push('S', 'S', 'S'); else v.push('W'); }
  return rng() < 0.5 ? h.concat(v) : v.concat(h);
}
// A misread: the person goes for the wrong offset - mostly one cell off on one
// axis, sometimes a different match altogether.
function misread(rng, ox, oy) {
  for (let tries = 0; tries < 20; tries++) {
    let a = ox, b = oy;
    if (rng() < 0.6) { if (rng() < 0.5) a = (a + (rng() < 0.5 ? 1 : D.COLS - 1)) % D.COLS; else b = (b + (rng() < 0.5 ? 1 : D.ROWS - 1)) % D.ROWS; }
    else { a = Math.floor(rng() * D.COLS); b = Math.floor(rng() * D.ROWS); }
    if ((a !== ox || b !== oy) && (a || b)) return [a, b];
  }
  return [(ox + 1) % D.COLS, oy];
}
// One plan: the keys and when each is pressed (physical, from the decision).
function makePlan(rng, mask, spots, o, fix) {
  const need = neededOffset(mask, spots);
  if (!need) return { keys: [], dts: [] };
  let off = need;
  const n = D.popcount(mask);
  if (rng() < o.misP * (1 + 0.15 * (n - 1)) * (fix ? 0.5 : 1)) off = misread(rng, need[0], need[1]);
  const keys = humanKeys(rng, off[0], off[1], o);
  if (keys.length && rng() < o.slipP) { const i = Math.floor(rng() * keys.length); keys.splice(i, 0, keys[i]); }   // a double tap
  const dts = [];
  for (let i = 0; i < keys.length; i++) {
    if (i === 0) { dts.push(0); continue; }
    let iki = logn(rng, o.ikiMed, o.ikiSig) * (keys[i] === keys[i - 1] ? 0.85 : 1);
    if (rng() < 0.03) iki *= uni(rng, 2, 4);           // a hesitation
    dts.push(dts[i - 1] + Math.max(25, iki));
  }
  return { keys, dts };
}
// How long a person needs from seeing the board to the first press.
function decideMs(rng, mask, spots, o, again) {
  const n = D.popcount(mask), need = neededOffset(mask, spots);
  const cost = need ? D.stepCost(need[0], need[1]) : 0;
  let ms = logn(rng, o.rtMed, o.rtSig) * (1 + o.perSoul * (n - 1)) * (1 + (o.costF == null ? 0.1 : o.costF) * Math.max(0, cost - 1));
  if (again) ms *= 0.75;                                // after a pause: the board was seen once already
  if (rng() < o.lapseP) ms *= uni(rng, 2, 4);
  return ms;
}

// ── the honest simulator ────────────────────────────────────────────────────
// Mirrors the IIFE (duraelis.iife.js): startGame (the intro timer), startRound
// (spawns, the shift), gameLoop (the round's clock and the flare), step,
// flare (a clear, or a life and the unlit souls), the between-rounds timer,
// endRun, pauseRun (panel hidden, QTE page left, browser tab hidden),
// resumeGame; the page's rAF / setTimeout / ping-sim timing (a key copy runs
// _albPing ms + setTimeout lateness after the physical press). o.slowMo
// (forgery only) feeds gameLoop rAF timestamps running at that fraction of
// real time; o.shiftRng / o.spawnRng (forgery only) replace the draws.
function simulate(rng, o) {
  const type = 'duraelis' + (o.comp ? '-comp' : '');
  const log = { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: o.mob ? 390 : 1280, h: 800, mob: !!o.mob, ping: o.key ? o.ping : 0 }, ev: [] };
  const snaps = [];
  const q = o.quantum || 0;                       // coarse performance.now (privacy modes)
  const Pd = 1000 / o.hz, phase0 = rng() * Pd;
  const T0 = 1000 + rng() * 1e6;                  // performance.now at Start
  const clock = w => { const p = T0 + w; return q ? Math.floor(p / q) * q : p; };
  let wall = 0;
  const runT0 = clock(0);
  const ev = (code, ...f) => { if (log.ev.length < Q.LIMITS.MAX_EVENTS) log.ev.push([code, Math.max(0, Math.round(clock(wall) - runT0)), ...f.map(r4)]); };

  // trainer state
  let running = false, gameStarted = false, paused = false, phase = 'idle';
  let clears = 0, lives = D.LIVES, roundsPlayed = 0, soulMask = 0, spotMask = 0, roundT = 0, roundGT = 0, roundDue = false, lastTime = 0;
  let ended = false, stuck = false, pageAway = false, roundNo = 0;

  // page timing
  let frameAt = null, frameNow = 0;               // pending rAF: callback time, timestamp
  let timerAt = null;                             // the intro / between-rounds timer
  let presses = [];                               // { t: handler time, k }, sorted by t
  let acts = [];                                  // the player's own clock: { t, fn }
  let pauseEv = null;                             // { kind, back, resume }
  let nextPauseAt = o.pauseRate ? expo(rng, 1 / o.pauseRate) : Infinity;
  let slowPrevReal = null, slowNow = 0;

  // player
  let watching = true, seenRound = -1, again = false, fullAt = -1;

  function nextVsync(t) { return phase0 + Pd * Math.floor((t - phase0) / Pd + 1); }
  function requestFrame(fromClick) {
    let fb = fromClick ? nextVsync(wall - 4) : nextVsync(wall);
    if (fromClick && rng() < (o.jankP || 0)) fb = wall - uni(rng, 20, 400);   // a stale frame behind a long task
    else {
      while (rng() < o.dropP) fb += Pd;             // missed vsyncs
      if (rng() < (o.taskRate || 0) * Pd) fb += uni(rng, 40, 400);   // a long task (per ms rate)
    }
    frameAt = Math.max(wall + 0.05, fb + uni(rng, 0, 2)); frameNow = clock(fb);
  }
  function timerLate() { let late = rng() < 0.95 ? uni(rng, 0, 4) : uni(rng, 4, 100); if (pauseEv && pauseEv.kind === 'tab') late += uni(rng, 0, 1000); return late; }

  function startRound() {
    roundDue = false;
    const n = D.souls(clears, o.comp);
    while (D.popcount(soulMask) < n) {
      const u = D.drawU(o.spawnRng ? o.spawnRng() : rng());
      const c = D.spawnCell(soulMask, u);
      soulMask |= 1 << c;
      ev('N', c, u);
    }
    const u = D.drawU(o.shiftRng ? o.shiftRng() : rng());
    const sh = D.shiftOf(u);
    spotMask = D.translate(soulMask, sh[0], sh[1]);
    roundT = D.timerMs(clears, o.comp); roundGT = 0; phase = 'round'; roundNo++;
    ev('R', clears, lives, n, roundT, soulMask, sh[0], sh[1], u);
  }
  function step(k) {
    if (!running || paused || phase !== 'round') return;
    soulMask = D.move(soulMask, k);
    ev('K', k, roundGT, soulMask);
  }
  function flare() {
    const lit = soulMask & spotMask;
    ev('F', roundGT, lit);
    roundsPlayed++; phase = 'gap';
    if (lit === soulMask) { clears++; snaps.push({ len: log.ev.length, claimed: clears }); }
    else { lives = Math.max(0, lives - D.popcount(soulMask & ~lit)); soulMask = lit; }
    spotMask = 0;
    if (lives <= 0) { ev('E', 'lives'); running = false; paused = false; phase = 'over'; ended = true; return; }
    timerAt = wall + D.GAP_MS + timerLate();
  }
  function pauseRun() {
    if (!gameStarted || !running || paused) return;
    frameAt = null; running = false; paused = true; ev('P');
  }
  function gameLoop(now) {
    if (!running) return;
    if (pageAway) { pauseRun(); return; }
    const dt = Math.min(Math.max(0, now - lastTime) / 1000, D.DT_MAX);
    if (now > lastTime) lastTime = now;
    if (phase === 'round') { roundGT += dt * 1000; if (roundGT >= roundT) flare(); }
    if (running) requestFrame(false);
  }
  // the player, after each drawn frame: the first frame of a round shows the
  // spotlights; the decision comes a human time later
  function look() {
    if (!watching || ended || pauseEv || !running || phase !== 'round' || seenRound === roundNo) return;
    seenRound = roundNo;
    const rn = roundNo;
    if (rng() < o.guessP) {                        // a jump at the first sight: a random key, then a look
      const at = wall + uni(rng, 90, 220);
      acts.push({ t: at, fn: () => { if (roundNo !== rn) return; recheck(rn, press(pick(rng, KEYS4), at)); } });
      return;
    }
    const at = wall + decideMs(rng, soulMask, spotMask, o, again);
    again = false;
    acts.push({ t: at, fn: () => decide(rn, false) });
  }
  function decide(rn, fix) {
    if (roundNo !== rn || phase !== 'round' || !watching || pauseEv) return;
    const p = makePlan(rng, soulMask, spotMask, o, fix);
    if (!p.keys.length) return;
    let landed = wall;
    for (let i = 0; i < p.keys.length; i++) landed = Math.max(landed, press(p.keys[i], wall + p.dts[i]));
    recheck(rn, landed);
  }
  // a look after the last press has landed and been drawn: solved, or plan a fix
  function recheck(rn, landed) {
    const at = landed + D.STEP_MS + logn(rng, o.rt2Med, 0.3);
    acts.push({ t: at, fn: () => {
      if (roundNo !== rn || phase !== 'round' || !watching || pauseEv) return;
      if (soulMask === spotMask) return;
      decide(rn, true);
    } });
  }
  function press(k, phys) {
    let lag;
    if (o.key) lag = o.ping > 0 ? o.ping + (rng() < 0.97 ? uni(rng, 0, 4) : uni(rng, 4, 100)) : uni(rng, 0, o.jitter == null ? 2 : o.jitter);
    else lag = uni(rng, 0, o.jitter == null ? 8 : o.jitter);   // touch: no ping sim
    const t = Math.max(phys, wall) + lag;
    presses.push({ t, k });
    presses.sort((a, b) => a.t - b.t);
    return t;
  }

  // Start click
  wall = 0;
  running = true; gameStarted = true; paused = false; phase = 'intro';
  lastTime = clock(wall);
  timerAt = wall + D.INTRO_MS + timerLate();
  requestFrame(true);

  const MAX_WALL = o.maxWall || 90 * 60 * 1000;
  let guard = 0;
  while (!ended && wall < MAX_WALL && guard++ < 3e7) {
    let tNext = Infinity, what = null;
    const cand = (t, w) => { if (t != null && t < tNext) { tNext = t; what = w; } };
    if (running && frameAt != null) cand(frameAt, 'frame');
    cand(timerAt, 'timer');
    if (presses.length) cand(presses[0].t, 'press');
    let ai = -1;
    for (let i = 0; i < acts.length; i++) if (acts[i].t < tNext) { tNext = acts[i].t; what = 'act'; ai = i; }
    if (!pauseEv && running) cand(nextPauseAt, 'pause');
    if (pauseEv) { cand(pauseEv.back, 'back'); cand(pauseEv.resume, 'resume'); }
    if (what === null) break;
    wall = Math.max(wall, tNext);

    if (what === 'frame') {
      frameAt = null;
      let now = frameNow;
      if (o.slowMo) {
        if (slowPrevReal === null) slowNow = lastTime; else slowNow += o.slowMo * (frameNow - slowPrevReal);
        slowPrevReal = frameNow; now = slowNow;
      }
      gameLoop(now);
      look();
    } else if (what === 'timer') {
      timerAt = null;
      if (running) startRound();
      else if (paused && (phase === 'intro' || phase === 'gap')) { roundDue = true; stuck = true; }   // fired while paused: the round starts on Resume
    } else if (what === 'press') {
      step(presses.shift().k);
    } else if (what === 'act') {
      const a = acts.splice(ai, 1)[0];
      a.fn();
    } else if (what === 'pause') {                  // panel hidden, browser tab hidden, or the QTE page left
      nextPauseAt = Infinity;
      const kind = pick(rng, ['panel', 'panel', 'tab', 'page']);
      presses = presses.filter(p => p.t <= wall);   // later keys: nowhere to go
      acts = [];
      if (kind === 'page') pageAway = true;         // the next frame pauses
      else pauseRun();
      pauseEv = { kind, back: wall + o.pauseMs(), resume: null };
    } else if (what === 'back') {                   // panel / tab / page shown again
      pageAway = false;
      const pe = pauseEv; pe.back = null;
      if (paused) pe.resume = wall + uni(rng, 250, 2500);
      else { pauseEv = null; nextPauseAt = o.pauseRate ? wall + expo(rng, 1 / o.pauseRate) : Infinity; seenRound = -1; again = true; }   // page left and back between two frames
    } else if (what === 'resume') {
      pauseEv = null;
      nextPauseAt = o.pauseRate ? wall + expo(rng, 1 / o.pauseRate) : Infinity;
      paused = false; running = true; lastTime = clock(wall);
      ev('U');
      if (roundDue && (phase === 'intro' || phase === 'gap')) startRound();
      roundDue = false;
      requestFrame(true);
      slowPrevReal = null;
      seenRound = -1; again = true;                 // the board was hidden: look again
    }
    if (clears >= o.maxRounds && watching) {
      if (o.walkAway) break;                        // closes the tab after the last point
      watching = false; presses = []; acts = [];    // stops pressing: the lights take the lives
    }
    if (o.afterFull != null && log.ev.length >= Q.LIMITS.MAX_EVENTS) {   // a3: play on a little past the full log
      if (fullAt < 0) fullAt = clears;
      else if (clears >= fullAt + o.afterFull) break;
    }
  }
  return { log, snaps, clears, stuck, lives };
}

const SKILLS = [   // rt: median ms from the spotlights to the first press (one soul); iki: press to press
  { rt: 1000, iki: 210, mis: 0.20, blind: 0.6,  rt2: 520 },
  { rt: 850,  iki: 190, mis: 0.15, blind: 0.45, rt2: 470 },
  { rt: 720,  iki: 170, mis: 0.11, blind: 0.35, rt2: 430 },
  { rt: 620,  iki: 155, mis: 0.08, blind: 0.25, rt2: 400 },
  { rt: 540,  iki: 140, mis: 0.06, blind: 0.15, rt2: 370 },
  { rt: 470,  iki: 125, mis: 0.04, blind: 0.08, rt2: 340 },
  { rt: 410,  iki: 110, mis: 0.03, blind: 0.04, rt2: 310 },
  { rt: 360,  iki: 100, mis: 0.02, blind: 0.02, rt2: 290 },
  { rt: 320,  iki: 90,  mis: 0.015, blind: 0.01, rt2: 270 },   // top of the board
];
function honestOpts(rng) {
  const mob = rng() < 0.25;
  const comp = rng() < 0.5;
  const sk = pick(rng, SKILLS);
  const ping = pick(rng, [0, 0, 0, 150, 300]);
  const hz = rng() < 0.02 ? 15 : pick(rng, [60, 60, 60, 60, 120, 144, 144, 240, 30]);   // 15 fps: dt 67 ms clamped to 50, the game runs at 75%
  const weak = rng() < 0.1;
  const len = rng();
  const quantum = rng() < 0.02 ? 16.67 : (rng() < 0.01 ? 100 : (rng() < 0.05 ? 1 : 0));
  const f = uni(rng, 0.85, 1.15);
  return {
    comp, mob, key: !mob || rng() < 0.05, ping, hz, quantum,
    dropP: weak ? uni(rng, 0.02, 0.06) : uni(rng, 0.001, 0.01),
    taskRate: weak ? 1 / uni(rng, 3000, 10000) : 1 / uni(rng, 20000, 120000),
    rtMed: sk.rt * f, rtSig: uni(rng, 0.22, 0.4), perSoul: uni(rng, 0.08, 0.16),
    ikiMed: sk.iki * uni(rng, 0.85, 1.2) * (mob ? 1.3 : 1), ikiSig: uni(rng, 0.22, 0.4),
    misP: sk.mis, blindP: sk.blind, slipP: mob ? 0.015 : 0.008, guessP: uni(rng, 0, 0.02), lapseP: 0.02,
    rt2Med: sk.rt2 * f,
    pauseRate: rng() < 0.25 ? 1 / uni(rng, 15000, 120000) : 0,
    pauseMs: () => rng() < 0.3 ? uni(rng, 0, 400) : uni(rng, 400, 30000),
    jankP: rng() < 0.2 ? 0.3 : 0.02,
    maxRounds: len < 0.4 ? 3 + Math.floor(rng() * 12) : len < 0.8 ? 15 + Math.floor(rng() * 30) : 45 + Math.floor(rng() * 100),
    walkAway: rng() < 0.5,
  };
}
// a solver on the real client: reads the board at once, the fewest presses,
// a key timer
function botOpts(rng, extra) {
  return Object.assign(honestOpts(rng), {
    rtMed: 20, rtSig: 0.05, perSoul: 0, costF: 0, ikiMed: 40, ikiSig: 0.01, misP: 0, blindP: 0, slipP: 0, guessP: 0, lapseP: 0, rt2Med: 50,
    pauseRate: 0, walkAway: true, quantum: 0, key: true, ping: 0, jitter: 1, taskRate: 0,
  }, extra);
}

function runCheck(log, claimed) {
  return Q.check(log.type, log, { platform: log.env && log.env.mob ? 'M' : 'C', claimed });
}
function prefix(log, len) { return Object.assign({}, log, { ev: log.ev.slice(0, len) }); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

// ── a) honest ───────────────────────────────────────────────────────────────
const N_HONEST = +(process.env.N || 2000);
const honest = { runs: 0, invalid: 0, review: 0, scoreMismatch: 0 };
const keep = [];                                   // honest runs to forge from
let maxScore = 0, sumScore = 0, maxEv = 0, maxBytes = 0, stuckN = 0, pausedRuns = 0, endedN = 0;
const tails = { rtMed: [], rtMad: [], ivMad: [], ivSd: [], ratio: [], shiftP: [], spawnP: [], easyP: [], sameP: [], optRt: [], pausedShare: [] };
let optAll = 0, ivMadLow = 0, ivLowSd = Infinity;
{
  const rng = mulberry32(12345);
  for (let n = 0; n < N_HONEST; n++) {
    const o = honestOpts(rng);
    const sim = simulate(rng, o);
    if (sim.stuck) stuckN++;
    if (sim.lives <= 0) endedN++;
    if (sim.log.ev.some(e => e[0] === 'P')) pausedRuns++;
    const tests = [{ log: sim.log, claimed: sim.clears }];
    if (sim.snaps.length) {
      const sp = sim.snaps[Math.floor(rng() * sim.snaps.length)];
      tests.push({ log: prefix(sim.log, sp.len), claimed: sp.claimed });
    }
    for (const tc of tests) {
      honest.runs++;
      const r = runCheck(tc.log, tc.claimed);
      if (r.verdict === 'invalid') { honest.invalid++; fail('honest invalid: ' + r.reasons.join('; ') + ' ' + JSON.stringify({ comp: o.comp, mob: o.mob, hz: o.hz, q: o.quantum, ping: o.ping })); }
      else if (r.verdict === 'review') { honest.review++; if (honest.review <= 12) console.log('  honest review: ' + r.reasons.join('; ') + ' rt=' + o.rtMed.toFixed(0) + ' hz=' + o.hz + ' q=' + o.quantum + ' ping=' + o.ping + ' score=' + tc.claimed); }
      if (r.score !== tc.claimed) { honest.scoreMismatch++; fail('honest score ' + r.score + ' != claimed ' + tc.claimed + ' ' + r.reasons.join('; ')); }
      if (tc.log === sim.log) {
        const st = r.stats;
        if (st.rtN >= D.RV.RT_N) tails.rtMed.push(st.rtMedMs);
        if (st.rtN >= D.RV.RTV_N && !st.coarseClock) tails.rtMad.push(st.rtMadMs);
        if (st.ivN >= D.RV.IV_N && !st.coarseClock) { tails.ivMad.push(st.ivMadMs); tails.ivSd.push(st.ivSdMs); if (st.ivMadMs < D.RV.IV_MAD) { ivMadLow++; ivLowSd = Math.min(ivLowSd, st.ivSdMs); } }
        if (st.clockRatio != null && st.rounds >= D.RV.SLOW_N && !st.coarseClock) tails.ratio.push(st.clockRatio);
        if (st.optN >= D.RV.OPT_N) { if (st.optShare >= D.RV.OPT_SHARE) { optAll++; tails.optRt.push(st.rtMedMs); } }
        if (st.rounds >= D.RV.PAUSE_N) tails.pausedShare.push(st.pausedRounds / st.rounds);
        // the p stats are rounded to 3 dp: recompute
        const NS = D.SHIFTS.length, us = [], sp = []; let easy = 0; const cnt = new Array(NS).fill(0);
        for (const e of tc.log.ev) { if (e[0] === 'R') { us.push(e[9]); cnt[Math.floor(e[9] * NS)]++; if (D.stepCost(e[7], e[8]) === 1) easy++; } else if (e[0] === 'N') sp.push(e[3]); }
        if (us.length >= D.RV.KS_N) tails.shiftP.push(Q.stats.ksUniform(us).p);
        if (sp.length >= D.RV.SPAWN_N) tails.spawnP.push(Q.stats.ksUniform(sp).p);
        if (us.length >= D.RV.LUCK_N) {
          tails.easyP.push(Q.stats.binomUpper(us.length, easy, D.ONE_PRESS / NS));
          tails.sameP.push(Math.min(1, NS * Q.stats.binomUpper(us.length, Math.max(...cnt), 1 / NS)));
        }
      }
    }
    maxScore = Math.max(maxScore, sim.clears); sumScore += sim.clears; maxEv = Math.max(maxEv, sim.log.ev.length);
    maxBytes = Math.max(maxBytes, JSON.stringify(sim.log).length);
    if (keep.length < 800) keep.push({ sim, o });
  }
  const rate = honest.review / honest.runs;
  console.log(`honest: ${honest.runs} checks (${N_HONEST} runs, ${pausedRuns} with pauses, ${endedN} played to the last life), invalid ${honest.invalid}, review ${honest.review} (${(rate * 100).toFixed(3)}%), score mismatch ${honest.scoreMismatch}; mean score ${(sumScore / N_HONEST).toFixed(1)}, max ${maxScore}, max events ${maxEv}, max bytes ${maxBytes}, rounds started on Resume ${stuckN}`);
  const lo = (a, k) => a.length ? Math.min(...a).toFixed(k) : '-';
  const loE = a => a.length ? Math.min(...a).toExponential(1) : '-';
  console.log(`  lowest over honest runs: rtMed ${lo(tails.rtMed, 0)} ms (n=${tails.rtMed.length}, threshold ${D.RV.RT_MED}), rtMad ${lo(tails.rtMad, 1)} ms (n=${tails.rtMad.length}, threshold ${D.RV.RT_MAD}), ivMad ${lo(tails.ivMad, 1)} ms (n=${tails.ivMad.length}, threshold ${D.RV.IV_MAD}; ${ivMadLow} runs under it, their lowest SD ${ivMadLow ? ivLowSd.toFixed(1) : '-'} ms), ivSd ${lo(tails.ivSd, 1)} ms (threshold ${D.RV.IV_SD}), clockRatio ${lo(tails.ratio, 3)} (n=${tails.ratio.length}, threshold ${D.RV.SLOW_RATIO})`);
  console.log(`  lowest p: shift KS ${loE(tails.shiftP)} (n=${tails.shiftP.length}), spawn KS ${loE(tails.spawnP)} (n=${tails.spawnP.length}), easy shifts ${loE(tails.easyP)}, one shift ${loE(tails.sameP)} (n=${tails.easyP.length}; threshold ${D.RV.KS_ALPHA})`);
  console.log(`  every round in the fewest presses (>= ${D.RV.OPT_N} rounds): ${optAll} runs, lowest median first press among them ${lo(tails.optRt, 0)} ms (threshold ${D.RV.OPT_RT}); highest share of rounds paused ${tails.pausedShare.length ? Math.max(...tails.pausedShare).toFixed(2) : '-'} (threshold ${D.RV.PAUSE_SHARE})`);
  if (honest.invalid || honest.scoreMismatch || rate > 0) { failures++; console.log('  FAIL honest suite (no honest run may be invalid or held)'); }
  if (!stuckN) fail('honest: no round was started on Resume (the paused-timer path went untested)');
  if (!endedN) fail('honest: no run was played to the last life');
}

// a2) long runs by the best players, into the hardest tables (hundreds of rounds)
{
  const rng = mulberry32(4711);
  const st = { runs: 0, invalid: 0, review: 0, mism: 0, maxS: 0, maxBytes: 0, minRt: Infinity, minIv: Infinity, minIvSd: Infinity, minRtMad: Infinity };
  for (let n = 0; n < +(process.env.NL || 40); n++) {
    const sk = SKILLS[SKILLS.length - 1 - Math.floor(rng() * 2)];
    const o = Object.assign(honestOpts(rng), { mob: rng() < 0.2, comp: rng() < 0.5, key: true, rtMed: sk.rt * uni(rng, 0.9, 1.05), ikiMed: sk.iki, misP: sk.mis, blindP: sk.blind, rt2Med: sk.rt2,
      lapseP: 0.005, guessP: 0.002, maxRounds: 400, walkAway: true, maxWall: 4 * 3600 * 1000,
      ping: 0, hz: pick(rng, [60, 144, 240]), dropP: 0.0002, taskRate: 1 / 600000, jankP: 0.01, pauseRate: 0 });
    const sim = simulate(rng, o);
    const r = runCheck(sim.log, sim.clears);
    st.runs++; st.maxS = Math.max(st.maxS, sim.clears); st.maxBytes = Math.max(st.maxBytes, JSON.stringify(sim.log).length);
    if (r.stats.rtN >= D.RV.RT_N) st.minRt = Math.min(st.minRt, r.stats.rtMedMs);
    if (r.stats.rtN >= D.RV.RTV_N && !r.stats.coarseClock) st.minRtMad = Math.min(st.minRtMad, r.stats.rtMadMs);
    if (r.stats.ivN >= D.RV.IV_N && !r.stats.coarseClock) { st.minIv = Math.min(st.minIv, r.stats.ivMadMs); st.minIvSd = Math.min(st.minIvSd, r.stats.ivSdMs); }
    if (r.verdict === 'invalid') { st.invalid++; fail('long honest run invalid: ' + r.reasons.join('; ')); }
    else if (r.verdict === 'review') { st.review++; console.log('  long honest run review: ' + r.reasons.join('; ') + ' rt=' + o.rtMed.toFixed(0)); }
    if (r.score !== sim.clears) { st.mism++; fail('long honest run score ' + r.score + ' != ' + sim.clears); }
  }
  console.log(`long runs (best players): ${st.runs} runs, invalid ${st.invalid}, review ${st.review}, mismatch ${st.mism}; best ${st.maxS} rounds, max log ${st.maxBytes} bytes; lowest rtMed ${st.minRt.toFixed(0)} ms, rtMad ${st.minRtMad.toFixed(1)} ms, ivMad ${st.minIv.toFixed(1)} ms, ivSd ${st.minIvSd.toFixed(1)} ms (clocks finer than 100 ms)`);
  if (st.review > 0) fail('long honest runs held for review');
}

// a2b) slow machines: 15 fps (67 ms frames, each dt clamped to 50) honestly
// runs the game clock at 75% of the wall; that must stay valid
{
  const rng = mulberry32(1515);
  let n = 0, rev = 0, inv = 0, minRatio = Infinity;
  for (let i = 0; i < 30; i++) {
    const o = Object.assign(honestOpts(rng), { hz: 15, maxRounds: 40, walkAway: true, quantum: 0, taskRate: 0, dropP: 0.002, pauseRate: 0 });
    const sim = simulate(rng, o);
    const r = runCheck(sim.log, sim.clears);
    if (r.stats.rounds < D.RV.SLOW_N) continue;
    n++; minRatio = Math.min(minRatio, r.stats.clockRatio);
    if (r.verdict === 'invalid') { inv++; fail('15 fps honest run invalid: ' + r.reasons.join('; ')); }
    else if (r.verdict === 'review') { rev++; fail('15 fps honest run held: ' + r.reasons.join('; ')); }
  }
  console.log(`15 fps machines: ${n} runs of ${D.RV.SLOW_N}+ rounds, invalid ${inv}, review ${rev}; lowest clock ratio ${minRatio.toFixed(3)} (threshold ${D.RV.SLOW_RATIO})`);
  if (n < 10) fail('15 fps: too few runs long enough to test the clock ratio (' + n + ')');
}

// a3) a run long enough to fill the log (MAX_EVENTS): the size stays under
// MAX_BYTES with room for the ticket, and the full log still checks out (it
// proves fewer rounds than the claim, which only a full log may do)
{
  const rng = mulberry32(99);
  const o = Object.assign(honestOpts(rng), { comp: true, mob: false, key: true, rtMed: 300, rtSig: 0.1, perSoul: 0.04, ikiMed: 100, ikiSig: 0.2, misP: 0, blindP: 0, slipP: 0, guessP: 0, lapseP: 0,
    pauseRate: 0, quantum: 0, ping: 0, hz: 144, dropP: 0, taskRate: 0, jankP: 0, maxRounds: 100000, walkAway: true, maxWall: 12 * 3600 * 1000, afterFull: 10 });
  const sim = simulate(rng, o);
  const bytes = JSON.stringify({ ticket: 'x'.repeat(200), attempt: 0, log: sim.log }).length;
  const r = runCheck(sim.log, sim.clears);
  const tHours = sim.log.ev[sim.log.ev.length - 1][1] / 3600000;
  console.log(`full log: ${sim.clears} rounds cleared, ${sim.log.ev.length} events, ${bytes} bytes with the envelope (limit ${Q.LIMITS.MAX_BYTES}), ${tHours.toFixed(2)} h; check: ${r.verdict}, proves ${r.score} of ${sim.clears}${r.reasons.length ? ' - ' + r.reasons.join('; ') : ''}`);
  if (sim.log.ev.length < Q.LIMITS.MAX_EVENTS) fail('full log: the run did not fill the log (' + sim.log.ev.length + ' events)');
  if (bytes > Q.LIMITS.MAX_BYTES - 16384) fail('full log: ' + bytes + ' bytes, too close to MAX_BYTES');
  if (r.verdict !== 'valid' || r.score < 1000) fail('full log: ' + r.verdict + ' ' + r.score + ' ' + r.reasons.join('; '));
}
// ── b) forgeries ────────────────────────────────────────────────────────────
const forg = [];
function expectCaught(name, log, claimed, opts) {
  const r = runCheck(log, claimed);
  const far = r.score <= Math.floor(claimed * ((opts && opts.frac) || 0.5));
  const ok = r.verdict === 'invalid' || r.verdict === 'review' || far;
  forg.push({ name, ok, verdict: r.verdict + (r.verdict === 'valid' ? ' (score ' + r.score + ' of ' + claimed + ')' : '') + (r.reasons[0] ? ' - ' + r.reasons[0] : '') });
  if (!ok) fail('forgery passed: ' + name + ' -> ' + r.verdict + ' ' + r.score + '/' + claimed + ' ' + r.reasons.join('; ') + ' ' + JSON.stringify(r.stats));
  return r;
}
function expectCore(name, type, log, claimed) {       // envelope abuse: judged before the trainer's check
  const r = Q.check(type, log, { platform: 'C', claimed });
  const ok = r.verdict === 'invalid';
  forg.push({ name, ok, verdict: r.verdict + (r.reasons[0] ? ' - ' + r.reasons[0] : '') });
  if (!ok) fail('forgery passed: ' + name + ' -> ' + r.verdict + ' ' + r.score + '/' + claimed + ' ' + r.reasons.join('; '));
}
function bestKeep(pred) { return keep.filter(k => pred(k)).sort((a, b) => b.sim.clears - a.sim.clears)[0]; }
const isComp = l => /-comp$/.test(l.type);
const idxOf = (l, pred, from) => { for (let i = from || 0; i < l.ev.length; i++) if (pred(l.ev[i], i)) return i; return -1; };
// the R before event i, and that round's spotlights
function roundAt(l, i) { for (let j = i; j >= 0; j--) if (l.ev[j][0] === 'R') return { j, R: l.ev[j], spots: D.translate(l.ev[j][6], l.ev[j][7], l.ev[j][8]) }; return null; }
// the souls' mask just before event i (the last R/K mask of its round)
function maskBefore(l, i) { let m = 0; for (let j = 0; j < i; j++) { const e = l.ev[j]; if (e[0] === 'R') m = e[6]; else if (e[0] === 'K') m = e[4]; } return m; }
function failedAt(l, i) { const e = l.ev[i]; return e[0] === 'F' && e[3] !== maskBefore(l, i); }

// A script writing the whole log itself: its own draws (o.spawnU / o.shiftU
// replace them), the fewest presses, times from o.rt / o.iki, every clock
// rule kept. o.pauseEach: a P/U inside every round.
function forgeWritten(rng, o) {
  const comp = !!o.comp;
  const log = { v: 1, rv: 1, type: 'duraelis' + (comp ? '-comp' : ''), a: 0, env: { w: 1280, h: 700, mob: false, ping: 0 }, ev: [] };
  let t = D.INTRO_MS + 5, s = 0, lives = D.LIVES, mask = 0;
  for (let round = 0; round < o.rounds; round++) {
    const n = D.souls(s, comp);
    while (D.popcount(mask) < n) { const u = D.drawU(o.spawnU ? o.spawnU(rng) : rng()); const c = D.spawnCell(mask, u); mask |= 1 << c; log.ev.push(['N', t, c, u]); }
    const u = D.drawU(o.shiftU ? o.shiftU(rng) : rng()), sh = D.shiftOf(u), spots = D.translate(mask, sh[0], sh[1]), T = D.timerMs(s, comp);
    log.ev.push(['R', t, s, lives, n, T, mask, sh[0], sh[1], u]);
    let tk = t, paused = 0;
    if (o.pauseEach) { const tp = t + 50; log.ev.push(['P', tp], ['U', tp + o.pauseEach]); paused = o.pauseEach; tk += o.pauseEach + 50; }
    const keys = o.skip && o.skip.has(round) ? [] : (D.solveKeys(mask, spots) || []);
    tk += Math.round(o.rt(rng));
    for (let i = 0; i < keys.length; i++) {
      if (i) tk += Math.max(1, Math.round(o.iki(rng)));
      const g = r4(Math.max(0, tk - t - paused - 8));        // the game clock a frame behind the wall
      if (g >= T) break;
      mask = D.move(mask, keys[i]);
      log.ev.push(['K', tk, keys[i], g, mask]);
    }
    const gF = r4(T + 5), tFl = Math.max(tk, t + paused + Math.ceil(gF) + 6), lit = mask & spots;
    log.ev.push(['F', tFl, gF, lit]);
    if (lit === mask) s++;
    else { lives = Math.max(0, lives - D.popcount(mask & ~lit)); mask = lit; if (!lives) { log.ev.push(['E', tFl, 'lives']); break; } }
    t = tFl + D.GAP_MS + 3;
  }
  return { log, score: s };
}
const human = { rt: r => logn(r, 650, 0.35), iki: r => logn(r, 150, 0.3) };
{
  const good = bestKeep(k => k.sim.clears >= 15 && !k.o.quantum && !k.sim.log.ev.some(e => e[0] === 'P') && k.sim.log.ev.filter(e => e[0] === 'K').length >= 40);
  const base = good.sim.log, claim = good.sim.clears, bcomp = isComp(base);
  // a run with a lost life and rounds after it
  const withFail = bestKeep(k => { const l = k.sim.log, ev = l.ev; return k.sim.clears >= 6 && !k.o.quantum && !ev.some(e => e[0] === 'P') && ev.some((e, i) => failedAt(l, i) && ev.slice(i + 1).some(x => x[0] === 'R')); });
  const ended = bestKeep(k => { const ev = k.sim.log.ev; const l = ev[ev.length - 1]; return l && l[0] === 'E' && k.sim.clears >= 4 && !ev.some(e => e[0] === 'P'); });
  console.log(`  forgery bases: ${base.type} ${claim} rounds / ${base.ev.length} events; a lost life mid-run at ${withFail.sim.clears}; ended at ${ended.sim.clears}`);
  const wl = withFail.sim.log, fIdx = idxOf(wl, (e, i) => failedAt(wl, i)), wClaim = withFail.sim.clears;

  // 1. no events + a claim
  expectCaught('no events + claim', { v: 1, rv: 1, type: 'duraelis', a: 0, env: { w: 1280, h: 700, mob: false, ping: 0 }, ev: [] }, 25);
  // 2. claim above the logged points
  expectCaught('claim above logged points', base, claim + 10);
  // 3. times compressed: the rounds' timers run in less wall time
  { const l = clone(base); l.ev.forEach(e => { e[1] = Math.round(e[1] * 0.5); }); expectCaught('honest log, times x0.5', l, claim); }
  { const l = clone(base); l.ev.forEach(e => { e[1] = Math.round(e[1] * 0.8); }); expectCaught('honest log, times x0.8', l, claim); }
  // 4. a lost round claimed as cleared
  { const l = clone(wl); l.ev[fIdx][3] = maskBefore(l, fIdx); expectCaught('a lost round\'s flare marked all lit', l, wClaim + 1, { frac: wClaim / (wClaim + 1) }); }
  { // ... and the souls moved onto the spotlights by its last press
    const l = clone(wl); const rr = roundAt(l, fIdx);
    const ks = []; for (let i = rr.j + 1; i < fIdx; i++) if (l.ev[i][0] === 'K') ks.push(l.ev[i]);
    if (ks.length) { ks[ks.length - 1][4] = rr.spots; l.ev[fIdx][3] = rr.spots; expectCaught('a lost round: its last press teleports the souls onto the spotlights', l, wClaim + 1, { frac: wClaim / (wClaim + 1) }); }
    else { const R0 = l.ev[rr.j]; l.ev.splice(fIdx, 0, ['K', l.ev[fIdx][1] - 1, 'D', r4(R0[5] - 20), rr.spots]); l.ev[fIdx + 1][3] = rr.spots; expectCaught('a lost round: a press added that teleports the souls onto the spotlights', l, wClaim + 1, { frac: wClaim / (wClaim + 1) }); }
  }
  // 5. presses edited
  { const l = clone(base); const ki = idxOf(l, (e, i) => e[0] === 'K' && e[4] !== roundAt(l, i).spots); l.ev[ki][4] = roundAt(l, ki).spots; expectCaught('a press that puts the souls straight on the spotlights', l, claim); }
  { const l = clone(base); const ki = idxOf(l, e => e[0] === 'K', 20); l.ev.splice(ki, 1); expectCaught('a press removed', l, claim); }
  { const l = clone(base); const ki = idxOf(l, e => e[0] === 'K', 20); const k = l.ev[ki]; k[2] = k[2] === 'D' ? 'A' : 'D'; expectCaught('a press with its key swapped', l, claim); }
  { const l = clone(base); const fi = idxOf(l, e => e[0] === 'F', 10); const K = clone(l.ev[idxOf(l, e => e[0] === 'K')]); K[1] = l.ev[fi][1] + 50; K[3] = l.ev[fi][2]; l.ev.splice(fi + 1, 0, K); l.ev.sort((a, b) => a[1] - b[1]); expectCaught('a press after the flare', l, claim); }
  { const l = clone(base); const ki = idxOf(l, e => e[0] === 'K', 10); const rr = roundAt(l, ki); l.ev[ki][3] = rr.R[5] + 10; expectCaught('a press logged after the round timer', l, claim); }
  { const l = clone(base); const ki = idxOf(l, (e, i) => e[0] === 'K' && i > 10 && l.ev[i - 1][0] === 'K'); l.ev[ki][3] = r4(Math.max(0, l.ev[ki - 1][3] - 300)); expectCaught('game time 300 ms back between two presses', l, claim); }
  { const l = clone(base); const ki = idxOf(l, (e, i) => e[0] === 'K' && i > 10 && l.ev[i - 1][0] === 'R'); const rr = roundAt(l, ki); l.ev[ki][3] = r4(l.ev[ki][1] - rr.R[1] + 300); expectCaught('a press with game time 300 ms ahead of its clock', l, claim); }
  { const l = clone(base); const ki = idxOf(l, e => e[0] === 'K', 10); l.ev.splice(ki + 1, 0, clone(l.ev[ki])); expectCaught('a press logged twice', l, claim); }
  // 6. the flare edited
  { const l = clone(base); const fi = idxOf(l, e => e[0] === 'F', 10); const rr = roundAt(l, fi); l.ev[fi][2] = rr.R[5] - 500; expectCaught('the lights flared 500 ms before the timer ran out', l, claim); }
  { const l = clone(base); const fi = idxOf(l, e => e[0] === 'F', 10); const rr = roundAt(l, fi); l.ev[fi][2] = rr.R[5] + 300; for (let i = fi; i < l.ev.length; i++) l.ev[i][1] += 300; expectCaught('the lights flared 300 ms after the timer (300 ms more to press)', l, claim); }
  { const l = clone(base); const fi = idxOf(l, e => e[0] === 'F', 10); l.ev.splice(fi + 1, 0, clone(l.ev[fi])); expectCaught('a flare logged twice', l, claim); }
  { const l = clone(base); const fi = idxOf(l, e => e[0] === 'F', 10); l.ev.splice(fi, 1); expectCaught('a flare removed (two rounds in one)', l, claim); }
  { const l = clone(base); const fi = idxOf(l, e => e[0] === 'F', 10); l.ev[fi][3] |= 1 << D.freeCells(maskBefore(l, fi))[0]; expectCaught('a lit soul that is not there', l, claim); }
  // 7. rounds edited
  { const l = clone(base); const R0 = l.ev[idxOf(l, e => e[0] === 'R', 5)]; R0[5] += 1000; expectCaught('a round timer 1 s longer than the table', l, claim); }
  { const l = clone(base); const R0 = l.ev[idxOf(l, e => e[0] === 'R' && e[2] >= 3)]; R0[4] -= 1; expectCaught('one soul fewer than the table', l, claim); }
  { const l = clone(base); const R0 = l.ev[idxOf(l, e => e[0] === 'R', 5)]; R0[7] = 0; R0[8] = 0; expectCaught('a zero shift', l, claim); }
  { const l = clone(base); const R0 = l.ev[idxOf(l, e => e[0] === 'R', 5)]; const NS = D.SHIFTS.length; R0[9] = r4(((Math.floor(R0[9] * NS) + 1) % NS + 0.5) / NS); expectCaught('a shift its draw does not pick', l, claim); }
  { const l = clone(base); const R0 = l.ev[idxOf(l, e => e[0] === 'R' && !(e[7] === 1 && e[8] === 0), 5)]; R0[9] = 0.01; R0[7] = 1; R0[8] = 0; expectCaught('a round\'s shift rewritten to one press (draw and shift agree)', l, claim); }
  { const l = clone(base); const R0 = l.ev[idxOf(l, e => e[0] === 'R', 5)]; R0[2] += 1; expectCaught('round logged with the wrong cleared count', l, claim); }
  { const l = clone(base); l.type = bcomp ? 'duraelis' : 'duraelis-comp'; expectCaught('mode swapped', l, claim); }
  { const l = clone(base); const ri = idxOf(l, (e, i) => e[0] === 'R' && i > 5); let fi = ri; while (l.ev[fi][0] !== 'F') fi--; const d = l.ev[ri][1] - (l.ev[fi][1] + 100); for (let i = fi + 1; i < l.ev.length; i++) l.ev[i][1] -= d; expectCaught('next round 100 ms after the flare', l, claim); }
  { const l = clone(base); const d = l.ev[idxOf(l, e => e[0] === 'R')][1] - 200; l.ev.forEach(e => { e[1] = Math.max(0, e[1] - d); }); expectCaught('the first round 200 ms after Start', l, claim); }
  { const l = clone(base); const ri = idxOf(l, e => e[0] === 'R', 5); l.ev.splice(ri + 1, 0, clone(l.ev[ri])); expectCaught('a round logged twice', l, claim); }
  { const l = clone(base); const ri = idxOf(l, (e, i) => e[0] === 'R' && i > 3); l.ev.splice(ri, 1); expectCaught('a round start removed', l, claim); }
  // 8. spawns and carried souls
  { const l = clone(base); const ni = idxOf(l, (e, i) => e[0] === 'N' && i > 3); const R1 = l.ev[idxOf(l, e => e[0] === 'R', ni)]; l.ev[ni][2] = D.cellsOf(R1[6] & ~(1 << l.ev[ni][2]))[0]; expectCaught('a soul spawned on an occupied cell', l, claim); }
  { const l = clone(base); const ni = idxOf(l, (e, i) => e[0] === 'N' && i > 3); l.ev[ni][3] = r4((l.ev[ni][3] + 0.5) % 1); expectCaught('a spawn not where its draw puts it', l, claim); }
  { const l = clone(base); const ni = idxOf(l, (e, i) => e[0] === 'N' && i > 3); l.ev.splice(ni, 1); expectCaught('a spawn removed (a soul from nowhere)', l, claim); }
  { const l = clone(base); const ni = idxOf(l, (e, i) => e[0] === 'N' && i > 3); const R1 = l.ev[idxOf(l, e => e[0] === 'R', ni)]; const N2 = ['N', l.ev[ni][1], D.freeCells(R1[6])[0], 0]; l.ev.splice(ni + 1, 0, N2); expectCaught('one spawn more than the table', l, claim); }
  { const l = clone(base); const ri = idxOf(l, (e, i) => e[0] === 'R' && i > 3 && e[2] > 0 && l.ev[i - 1][0] === 'F'); const R1 = l.ev[ri]; const cs = D.cellsOf(R1[6]), fr = D.freeCells(R1[6]); R1[6] = (R1[6] & ~(1 << cs[0])) | (1 << fr[0]); expectCaught('a saved soul moved between rounds', l, claim); }
  // 9. lives
  { const l = clone(wl); const ri = idxOf(l, e => e[0] === 'R', fIdx); l.ev[ri][3] += 1; expectCaught('a lost life not counted in the next round', l, wClaim); }
  { const l = clone(ended.sim.log); const s = ended.sim.clears; l.ev.pop(); const lastF = l.ev[l.ev.length - 1]; let mm = lastF[3]; const n = D.souls(s, isComp(l)), t2 = lastF[1] + 700;
    while (D.popcount(mm) < n) { const c = D.spawnCell(mm, 0.5); mm |= 1 << c; l.ev.push(['N', t2, c, 0.5]); }
    l.ev.push(['R', t2, s, 0, n, D.timerMs(s, isComp(l)), mm, 1, 0, 0.01]); expectCaught('a round after the third life (its end removed)', l, s + 1, { frac: s / (s + 1) }); }
  { const l = clone(ended.sim.log); l.ev.push(['R', l.ev[l.ev.length - 1][1] + 700, ended.sim.clears, 0, 1, 4000, 1, 1, 0, 0.01]); expectCaught('events after the end', l, ended.sim.clears + 1, { frac: ended.sim.clears / (ended.sim.clears + 1) }); }
  { const l = clone(base); const fi = idxOf(l, e => e[0] === 'F', 5); l.ev.splice(fi + 1, 0, ['E', l.ev[fi][1], 'lives']); expectCaught('an end with lives left', l, claim); }
  { // a round that left several flames in the dark charged as one life
    let src = null, at2 = -1;
    for (const k of keep) {
      const l = k.sim.log;
      const i = l.ev.findIndex((e, j) => e[0] === 'F' && D.popcount(maskBefore(l, j) & ~e[3]) >= 2 && l.ev.slice(j + 1).some(x => x[0] === 'R'));
      if (i >= 0 && !k.o.quantum) { src = k.sim; at2 = i; break; }
    }
    if (!src) { const w = forgeWritten(mulberry32(91), Object.assign({ comp: true, rounds: 10, skip: new Set([2]) }, human)); src = { log: w.log, clears: w.score }; at2 = w.log.ev.findIndex((e, j) => e[0] === 'F' && D.popcount(maskBefore(w.log, j) & ~e[3]) >= 2); }
    const l = clone(src.log), dark = D.popcount(maskBefore(l, at2) & ~l.ev[at2][3]);
    for (let j = at2 + 1; j < l.ev.length; j++) if (l.ev[j][0] === 'R') l.ev[j][3] += dark - 1;
    const endAt = l.ev.findIndex(e => e[0] === 'E'); if (endAt > at2) l.ev.splice(endAt, 1);
    expectCaught('a round that lost ' + dark + ' flames charged as one life', l, src.clears);
  }
  { // three flames lost in one round with three lives: the run must end there
    let w = null;
    for (let sd = 93; sd < 140 && !w; sd++) {
      const c = forgeWritten(mulberry32(sd), Object.assign({ comp: true, rounds: 12, skip: new Set([2]) }, human));
      const i = c.log.ev.findIndex((e, j) => e[0] === 'F' && D.popcount(maskBefore(c.log, j) & ~e[3]) >= 3);
      if (i >= 0 && c.log.ev[i + 1] && c.log.ev[i + 1][0] === 'E' && c.score === 2) w = { c, i };
    }
    if (!w) fail('no written log lost three flames at once');
    else {
      const l = clone(w.c.log); l.ev.splice(w.i + 1, 1);      // the end removed: play on
      const tF = l.ev[w.i][1]; let mm = l.ev[w.i][3]; const n = D.souls(2, true), t2 = tF + 700;
      while (D.popcount(mm) < n) { const c = D.spawnCell(mm, 0.5); mm |= 1 << c; l.ev.push(['N', t2, c, 0.5]); }
      l.ev.push(['R', t2, 2, 2, n, D.timerMs(2, true), mm, 1, 0, 0.01]);
      expectCaught('three flames lost at once, the run played on with two lives', l, 3, { frac: 2 / 3 });
    }
  }
  // 10. pauses
  { const l = clone(base); const ki = idxOf(l, e => e[0] === 'K', 5); l.ev.splice(ki, 0, ['P', l.ev[ki][1]]); l.ev.splice(ki + 2, 0, ['U', l.ev[ki + 1][1]]); expectCaught('press while paused', l, claim); }
  { const l = clone(base); const ri = idxOf(l, e => e[0] === 'R', 5); l.ev.splice(ri, 0, ['P', l.ev[ri][1]]); l.ev.splice(ri + 2, 0, ['U', l.ev[ri + 1][1]]); expectCaught('a round started while paused', l, claim); }
  { const r = forgeWritten(mulberry32(81), Object.assign({ rounds: 40, pauseEach: 4000 }, human)); expectCaught('paused inside every round (written log, score ' + r.score + ')', r.log, r.score); }
  // 11. cherry-picked draws, otherwise honest play
  { const o = Object.assign(honestOpts(mulberry32(7)), { comp: false, mob: false, pauseRate: 0, maxRounds: 30, walkAway: true, quantum: 0, hz: 60, key: true, ping: 0, rtMed: 600 });
    const g = mulberry32(8), EASY = D.SHIFTS.map((s, i) => D.stepCost(s[0], s[1]) === 1 ? i : -1).filter(i => i >= 0);
    o.shiftRng = () => (pick(g, EASY) + g()) / D.SHIFTS.length;
    const sim = simulate(mulberry32(9), o); expectCaught('cherry-picked one-press shifts (score ' + sim.clears + ')', sim.log, sim.clears); }
  { const o = Object.assign(honestOpts(mulberry32(17)), { comp: true, mob: false, pauseRate: 0, maxRounds: 30, walkAway: true, quantum: 0, hz: 60, key: true, ping: 0, rtMed: 600 });
    const g = mulberry32(18); o.shiftRng = () => g() / D.SHIFTS.length;
    const sim = simulate(mulberry32(19), o); expectCaught('the same shift every round (score ' + sim.clears + ')', sim.log, sim.clears); }
  { const o = Object.assign(honestOpts(mulberry32(27)), { comp: true, mob: false, pauseRate: 0, maxRounds: 40, walkAway: true, quantum: 0, hz: 60, key: true, ping: 0, rtMed: 400, rtSig: 0.2, ikiMed: 120, misP: 0, blindP: 0, slipP: 0, guessP: 0, lapseP: 0 });
    o.spawnRng = () => 0;
    const sim = simulate(mulberry32(29), o); expectCaught('every soul spawned on the first free cell (score ' + sim.clears + ')', sim.log, sim.clears); }
  { const r = forgeWritten(mulberry32(83), Object.assign({ rounds: 40, shiftU: () => 0.5 }, human)); expectCaught('written log, one draw for every shift (score ' + r.score + ')', r.log, r.score); }
  // 12. solvers on the real client: read the board at once, the fewest presses
  for (const hz of [60, 144, 240]) {
    const sim = simulate(mulberry32(11 + hz), botOpts(mulberry32(10 + hz), { comp: true, mob: false, hz, dropP: 0.002, maxRounds: 30 }));
    expectCaught('solver, real client ' + hz + ' Hz (score ' + sim.clears + ')', sim.log, sim.clears);
  }
  { const sim = simulate(mulberry32(31), botOpts(mulberry32(30), { comp: false, mob: true, key: false, hz: 60, dropP: 0.004, maxRounds: 30 }));
    expectCaught('solver, real mobile client (score ' + sim.clears + ')', sim.log, sim.clears); }
  { const sim = simulate(mulberry32(33), botOpts(mulberry32(32), { comp: false, hz: 60, dropP: 0.002, maxRounds: 30, key: true, ping: 150 }));
    expectCaught('solver through the ping sim at 150 ms (score ' + sim.clears + ')', sim.log, sim.clears); }
  { const sim = simulate(mulberry32(35), botOpts(mulberry32(34), { comp: false, hz: 60, dropP: 0.002, maxRounds: 30, rtMed: 400, rtSig: 0.005 }));
    expectCaught('solver waiting a fixed 400 ms (score ' + sim.clears + ')', sim.log, sim.clears); }
  { const sim = simulate(mulberry32(37), botOpts(mulberry32(36), { comp: false, hz: 60, dropP: 0.002, maxRounds: 30, rtMed: 500, rtSig: 0.3, perSoul: 0.1, costF: 0.1, ikiMed: 60, ikiSig: 0.005 }));
    expectCaught('solver with a person\'s first press but a key timer (score ' + sim.clears + ')', sim.log, sim.clears); }
  { const sim = simulate(mulberry32(39), botOpts(mulberry32(38), { comp: true, hz: 144, dropP: 0.002, maxRounds: 30, rtMed: 160, rtSig: 0.3, perSoul: 0.05, costF: 0.1, ikiMed: 110, ikiSig: 0.3 }));
    expectCaught('solver with a person\'s timing, fast (score ' + sim.clears + ')', sim.log, sim.clears); }
  { const r = forgeWritten(mulberry32(85), { rounds: 40, rt: () => 30, iki: () => 40 }); expectCaught('written log, instant presses (score ' + r.score + ')', r.log, r.score); }
  // 13. slow motion and stretched time
  { const o = Object.assign(honestOpts(mulberry32(21)), { comp: true, mob: false, pauseRate: 0, maxRounds: 30, walkAway: true, quantum: 0, hz: 60, dropP: 0.003, key: true, ping: 0, slowMo: 0.5 });
    const sim = simulate(mulberry32(22), o); expectCaught('slow-motion client (game clock x0.5, score ' + sim.clears + ')', sim.log, sim.clears);
    const sim2 = simulate(mulberry32(23), Object.assign({}, o, { slowMo: 0.6 })); expectCaught('slow-motion client (game clock x0.6, score ' + sim2.clears + ')', sim2.log, sim2.clears); }
  { const l = clone(base); l.ev.forEach(e => { e[1] *= 2; }); expectCaught('honest log, times x2 (stretched)', l, claim); }
  // 14. replays and timings
  expectCaught('replayed honest log, claim x2', base, claim * 2);
  { const sp = good.sim.snaps[Math.floor(good.sim.snaps.length / 2)]; expectCaught('replayed half-way snapshot, full claim', prefix(base, sp.len), claim); }
  { const l = clone(base); let ks = [];
    const flush = () => { if (ks.length > 1) { const tl = ks[ks.length - 1][1]; ks.forEach(k => { k[1] = tl; }); } ks = []; };
    for (const e of l.ev) { if (e[0] === 'R') flush(); else if (e[0] === 'K') ks.push(e); }
    flush();
    expectCaught('identical timings (a round\'s presses all at one time)', l, claim); }
  // 15. huge, negative, NaN-like and wrongly typed fields
  const mutate = (name, fn, cl) => { const l = clone(base); fn(l); expectCaught(name, l, cl == null ? claim : cl); };
  const firstK = l => l.ev.find(e => e[0] === 'K'), firstR = l => l.ev.find(e => e[0] === 'R'), firstN = l => l.ev.find(e => e[0] === 'N'), firstF = l => l.ev.find(e => e[0] === 'F');
  mutate('huge game time', l => { firstK(l)[3] = 1e12; });
  mutate('huge mask', l => { firstR(l)[6] = 1e9; });
  mutate('mask with a 17th cell', l => { firstR(l)[6] |= 1 << D.CELLS; });
  mutate('huge cleared count', l => { firstR(l)[2] = 1e9; });
  mutate('huge timer', l => { firstR(l)[5] = 1e9; });
  mutate('negative game time', l => { firstK(l)[3] = -500; });
  mutate('negative cell', l => { firstN(l)[2] = -1; });
  mutate('cell 16', l => { firstN(l)[2] = D.CELLS; });
  mutate('fractional cell', l => { firstN(l)[2] = 0.5; });
  mutate('draw of 1', l => { firstR(l)[9] = 1; });
  mutate('negative draw', l => { firstN(l)[3] = -0.1; });
  mutate('NaN-like string draw', l => { firstR(l)[9] = 'NaN'; });
  mutate('numeric-string mask', l => { const k = firstK(l); k[4] = String(k[4]); });
  mutate('lowercase key', l => { const k = firstK(l); k[2] = k[2].toLowerCase(); });
  mutate('arrow key name', l => { firstK(l)[2] = 'ArrowUp'; });
  mutate('key "constructor"', l => { firstK(l)[2] = 'constructor'; });
  mutate('boolean lit', l => { firstF(l)[3] = true; });
  mutate('string lives', l => { firstR(l)[3] = '3'; });
  mutate('null soul count', l => { firstR(l)[4] = null; });
  mutate('object field', l => { firstK(l)[4] = { m: 1 }; });
  mutate('shift dx 4', l => { firstR(l)[7] = 4; });
  mutate('shift dy -1', l => { firstR(l)[8] = -1; });
  mutate('shift dy 4', l => { firstR(l)[8] = D.ROWS; });
  mutate('Infinity-like huge time', l => { firstK(l)[1] = 1e15; });
  mutate('a press with an extra field', l => { firstK(l).push(1); });
  mutate('a round with a field missing', l => { firstR(l).pop(); });
  mutate('a pause with a field', l => { const ki = l.ev.findIndex(e => e[0] === 'K'); l.ev.splice(ki, 0, ['P', l.ev[ki][1], 0], ['U', l.ev[ki][1]]); });
  mutate('unknown event code', l => { const ki = l.ev.findIndex(e => e[0] === 'K'); l.ev.splice(ki, 0, ['Z', l.ev[ki][1], 900]); });
  mutate('unknown end reason', l => { l.ev.push(['E', l.ev[l.ev.length - 1][1] + 10, 'quit']); });
  // 16. envelope abuse (the core refuses these before the trainer's check runs)
  expectCore('log for another trainer (sword-new) sent as duraelis', 'duraelis', Object.assign(clone(base), { type: 'sword-new' }), claim);
  expectCore('casual log sent as comp', bcomp ? 'duraelis' : 'duraelis-comp', clone(base), claim);
  expectCore('unknown trainer type', 'duraeliss', clone(base), claim);
  expectCore('log version 2', base.type, Object.assign(clone(base), { v: 2 }), claim);
  expectCore('negative attempt number', base.type, Object.assign(clone(base), { a: -1 }), claim);
  expectCore('log is an array', base.type, clone(base.ev), claim);
  expectCore('env with too many fields', base.type, Object.assign(clone(base), { env: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 } }), claim);
  expectCore('env with a long string', base.type, Object.assign(clone(base), { env: { w: 'x'.repeat(40) } }), claim);
  expectCore('env with an object', base.type, Object.assign(clone(base), { env: { w: { x: 1 } } }), claim);
  { const l = clone(base); l.ev[1][0] = 'KKKK'; expectCore('event with a long code', base.type, l, claim); }
  { const l = clone(base); l.ev[1] = l.ev[1].concat(new Array(14).fill(0)); expectCore('event with too many fields', base.type, l, claim); }
  { const l = clone(base); l.ev[2][1] += 0.5; expectCore('event at a fractional time', base.type, l, claim); }
  { const l = clone(base); const i = idxOf(l, (e, j) => j > 3 && e[1] > l.ev[j - 1][1] + 60); l.ev[i][1] = l.ev[i - 1][1] - 50; expectCore('event going back in time', base.type, l, claim); }
  { const l = clone(base); for (let i = 1; i < l.ev.length; i++) l.ev[i][1] = Q.LIMITS.MAX_T + 1; expectCore('times past the twelve-hour limit', base.type, l, claim); }
  { const l = clone(base); while (l.ev.length <= Q.LIMITS.MAX_EVENTS) l.ev.push(['U', l.ev[l.ev.length - 1][1]]); expectCore('more than MAX_EVENTS events', base.type, l, claim); }
  { const l = clone(base); l.ev[1][2] = 'x'.repeat(40); expectCore('a long string field', base.type, l, claim); }
  { const l = clone(base); l.ev[1][3] = [1, 2]; expectCore('an array field', base.type, l, claim); }
}
const caught = forg.filter(f => f.ok).length;
console.log(`forgeries: ${forg.length} built, ${caught} caught`);
for (const f of forg) console.log('  ' + (f.ok ? 'ok   ' : 'MISS ') + f.name + ': ' + f.verdict);
{ // the known limits: a script with a person's timing and its own fresh draws
  // cannot be told from a person by the log
  const w = forgeWritten(mulberry32(87), Object.assign({ rounds: 60 }, human));
  const r = runCheck(w.log, w.score);
  console.log('  known limit - written log, fresh draws, the fewest presses at a person\'s pace (median 650 ms): ' + r.verdict + ', score ' + r.score + ' (the SQL clock and record checks are what bound it)');
  const sim = simulate(mulberry32(41), botOpts(mulberry32(40), { comp: false, hz: 60, dropP: 0.002, maxRounds: 30, rtMed: 450, rtSig: 0.3, perSoul: 0.1, costF: 0.1, ikiMed: 130, ikiSig: 0.3 }));
  const r2 = runCheck(sim.log, sim.clears);
  console.log('  known limit - solver on the real client at a person\'s pace (median 450 ms + 10% a soul): ' + r2.verdict + ', score ' + r2.score);
}
// ── c) the real IIFE (duraelis.iife.js) in a fake DOM with a virtual clock ──
// Frames tick on vsync; a frame's callbacks get its vsync time as timestamp but
// may run late (a long task): events queued meanwhile (clicks, keys, timers)
// run first, which is how an honest Start/Resume meets a stale frame. Timers
// can be late, frames dropped, clocks coarse, keys delayed by the ping sim.
// The player watches the drawn canvas (never the closure: the board, the
// spotlight pools, the soul cores and the timer bar, found by their colours),
// works out the shift and presses with a person's timing and mistakes. Every
// submit, every run's whole log, and the fight result line are checked.
const IIFE_SRC = fs.readFileSync(path.join(__dirname, 'duraelis.iife.js'), 'utf8');
try { new Function(IIFE_SRC); console.log('iife: parses'); } catch (err) { fail('duraelis.iife.js does not parse: ' + err.message); }
{
  const lines = IIFE_SRC.replace(/\n$/, '').split('\n');
  if (lines[lines.length - 1] !== '})();' || lines.slice(0, -1).includes('})();')) fail('iife: the block must end with its only "})();" line');
}
// The colours the IIFE draws the board, the spotlight pools, the soul cores
// and the round's timer with.
const COL_BOARD = 'rgba(255,255,255,0.025)', COL_POOL = 'rgba(255,255,255,0.62)', COL_CORE = '#fbf8ff', COL_TIMER = '#b4b4be', COL_TIMER_LOW = '#ee8855';
for (const c of [COL_BOARD, COL_POOL, COL_CORE, COL_TIMER, COL_TIMER_LOW]) if (IIFE_SRC.indexOf("'" + c + "'") < 0) fail('iife: the colour ' + c + ' the suite reads is not in the IIFE');
const RESULT_TEXT = lost => lost <= 0 ? 'Flawless: 0 DMG taken, Duraelis stunned for 3 turns'
  : lost < D.LIVES ? lost + ' ' + (lost === 1 ? 'life' : 'lives') + ' lost: you take reduced damage' : 'All lives lost: full damage';
// What the result line must say for a log: lives lost in its first 6 flares,
// or all of them if it ended sooner; null if it never got that far.
function expectedResult(log) {
  let m = 0, n = 0, lost = 0, ended = false;
  for (const e of log.ev) {
    if (e[0] === 'R') m = e[6]; else if (e[0] === 'K') m = e[4];
    else if (e[0] === 'F') { if (n < D.FIGHT_ROUNDS) { n++; lost += D.popcount(m & ~e[3]); } m = e[3]; }
    else if (e[0] === 'E') ended = true;
  }
  if (n >= D.FIGHT_ROUNDS) return RESULT_TEXT(Math.min(lost, D.LIVES));
  return ended ? RESULT_TEXT(D.LIVES) : null;
}

const iifeLogs = [];                                 // every run's log, with what the page showed
let runSerial = 0, iifeTicks = 0, iifeWall = 0;
(function () {
  const origStart = Q.Run.start;
  Q.Run.start = function () {
    const run = origStart.apply(this, arguments);
    run._serial = ++runSerial;
    iifeLogs.push({ run, cleared: 0, world: null, result: null });
    return run;
  };
})();
globalThis._playQteSfx = () => {};
globalThis._qteMatch = null;

const KEY_EV = { W: ['w', 'KeyW', 'ArrowUp'], A: ['a', 'KeyA', 'ArrowLeft'], S: ['s', 'KeyS', 'ArrowDown'], D: ['d', 'KeyD', 'ArrowRight'] };
function duraWorld(seed, o) {
  const rng = mulberry32(seed);
  let now = 0;
  const T0 = 5000 + rng() * 1e5, q = o.quantum || 0;
  const clk = t => { const p = T0 + t; return q ? Math.floor(p / q) * q : p; };
  // event queue
  let seq = 0; const queue = [];
  const at = (t, fn) => { const e = { t, s: ++seq, fn, dead: false }; queue.push(e); return e; };
  function popNext() {
    let bi = -1;
    for (let i = queue.length - 1; i >= 0; i--) {
      const e = queue[i];
      if (e.dead) { queue.splice(i, 1); if (bi > i) bi--; continue; }
      if (bi < 0 || e.t < queue[bi].t || (e.t === queue[bi].t && e.s < queue[bi].s)) bi = i;
    }
    return bi < 0 ? null : queue.splice(bi, 1)[0];
  }
  // timers
  const timers = new Map(); let tid = 0;
  function setTimeoutV(fn, ms) {
    const id = ++tid;
    let late = rng() < (o.timerLateP || 0.01) ? uni(rng, 5, 300) : uni(rng, 0, 3);
    if (document.hidden) late += uni(rng, 0, 1000);   // background tabs throttle timers
    timers.set(id, at(now + Math.max(0, +ms || 0) + late, () => { timers.delete(id); fn(); }));
    return id;
  }
  function clearTimeoutV(id) { const e = timers.get(id); if (e) { e.dead = true; timers.delete(id); } }
  // frames
  const Pd = 1000 / o.hz, vPhase = rng() * Pd;
  const cbs = new Map(); let rafId = 0, tickEv = null, lastTickRun = -1e9, drawVT = null;
  const nextVsyncAfter = t => vPhase + Pd * (Math.floor((t - vPhase) / Pd) + 1);
  function scheduleTick() {
    if (tickEv) return;
    let V = nextVsyncAfter(Math.max(now, lastTickRun));
    while (rng() < o.dropP) V += Pd;
    const lag = rng() < (o.jankRate || 0) * Pd ? uni(rng, 40, 400) : uni(rng, 0.2, 3);   // long tasks, jankRate per ms
    const Vs = V; tickEv = at(V + lag, () => runTick(Vs));
  }
  function runTick(V) {
    tickEv = null; lastTickRun = now;
    if (document.hidden) { if (cbs.size || o.continuous) at(now + 200, () => { if (!tickEv) scheduleTick(); }); return; }   // no frames in a hidden tab
    iifeTicks++;
    const list = [...cbs.values()]; cbs.clear();
    drawVT = V;
    for (const cb of list) cb(clk(V));
    drawVT = null;
    if (list.length) look();
    if (cbs.size || o.continuous) scheduleTick();
  }
  const rafV = cb => { const id = ++rafId; cbs.set(id, cb); scheduleTick(); return id; };
  const cafV = id => { cbs.delete(id); };
  const perfV = { now: () => clk(now) };
  // DOM
  let streakCb = null, resultCb = null;
  function el(id, tag) {
    let text = '';
    return {
      id, tagName: tag || 'DIV', style: { display: '' }, className: '', children: [], _h: {}, isContentEditable: false,
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      get textContent() { return text; },
      set textContent(v) { text = String(v); if (id === 'duraelis-qte-streak' && streakCb) streakCb(text); if (id === 'duraelis-qte-result' && resultCb) resultCb(text); },
      appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
      addEventListener(type, fn) { (this._h[type] = this._h[type] || []).push(fn); },
      fire(type, ev) { (this._h[type] || []).slice().forEach(fn => fn(ev || { preventDefault() {} })); },
    };
  }
  const wrap = el('wrap'); wrap.clientWidth = o.clientW;
  const canvas = el('duraelis-qte-canvas', 'CANVAS');
  let cwv = 300;   // HTMLCanvasElement.width: unsigned long, out of range -> 300
  Object.defineProperty(canvas, 'width', { get: () => cwv, set: v => { const u = Number(v) >>> 0; cwv = u > 2147483647 ? 300 : u; } });
  canvas.height = 150;
  wrap.appendChild(canvas);
  // the canvas, as the player sees it: the board, the pools, the cores, the timer
  let frameCur = null, frameSeen = null, draws = 0, pausedDraws = { n: 0, shown: 0 };
  // the run's R count, kept up as the log grows (a frame must not scan the log)
  let cR = { run: null, len: 0, n: 0 };
  const countR = () => { const r = Q.Run.current; if (!r) return 0; if (cR.run !== r || r.log.ev.length < cR.len) cR = { run: r, len: 0, n: 0 }; const ev = r.log.ev; for (; cR.len < ev.length; cR.len++) if (ev[cR.len][0] === 'R') cR.n++; return cR.n; };
  const ctxImpl = {
    clearRect() { draws++; frameCur = { board: null, spots: [], cores: [], timer: false, vT: drawVT, nR: countR(), run: Q.Run.current }; if (drawVT != null) frameSeen = frameCur; },
    fillRect(x, y, w, h) {
      const f = frameCur; if (!f) return;
      const st = this.fillStyle;
      if (st === COL_BOARD) f.board = { x, y, w, h };
      else if (st === COL_TIMER || st === COL_TIMER_LOW) f.timer = true;
    },
    beginPath() { this._arc = null; },
    arc(x, y) { this._arc = { x, y }; },
    fill() {
      const f = frameCur; if (!f) return;
      const st = this.fillStyle;
      if (st === COL_CORE && this._arc) f.cores.push(this._arc);
      else if (st && st._stops && st._stops[0] === COL_POOL) f.spots.push({ x: st._x, y: st._y });
    },
    createRadialGradient(x, y) { return { _x: x, _y: y, _stops: [], addColorStop(p, c) { this._stops.push(c); } }; },
    createLinearGradient() { return { addColorStop() {} }; },
    measureText(t) { return { width: String(t).length * 7 }; },
  };
  const ctx = new Proxy(ctxImpl, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  canvas.getContext = () => ctx;
  const ids = {};
  ['duraelis-qte-status', 'duraelis-qte-streak', 'duraelis-qte-highscore', 'duraelis-qte-result', 'page-qte', 'qte-panel-duraelis', 'duraelis-dpad'].forEach(id => { ids[id] = el(id); });
  for (const id of ['duraelis-qte-start-btn', 'duraelis-qte-resume-btn', 'duraelis-dpad-up', 'duraelis-dpad-left', 'duraelis-dpad-down', 'duraelis-dpad-right']) ids[id] = el(id, 'BUTTON');
  ids['duraelis-qte-canvas'] = canvas;
  ids['page-qte'].classList.add('active');
  const panel = ids['qte-panel-duraelis']; panel.style.display = 'flex';
  const startBtn = ids['duraelis-qte-start-btn'], resumeBtn = ids['duraelis-qte-resume-btn'], dpad = ids['duraelis-dpad'];
  resumeBtn.style.display = 'none'; dpad.style.display = 'none';
  const PAD = { W: ids['duraelis-dpad-up'], A: ids['duraelis-dpad-left'], S: ids['duraelis-dpad-down'], D: ids['duraelis-dpad-right'] };
  const docH = {}, winH = {};
  const document = {
    hidden: false,
    getElementById: id => ids[id] || null,
    createElement: t => el('', String(t).toUpperCase()),
    addEventListener: (type, fn) => { (docH[type] = docH[type] || []).push(fn); },
    activeElement: { tagName: 'BODY', isContentEditable: false },
  };
  const store = {};
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  class MO { observe() {} }
  // globals the rules file and Run read
  Object.defineProperty(globalThis, 'performance', { value: perfV, configurable: true, writable: true });
  globalThis.addEventListener = (type, fn) => { (winH[type] = winH[type] || []).push(fn); };
  globalThis.IS_MOBILE = !!o.mob;
  if (o.pointer) globalThis.PointerEvent = function PointerEvent() {}; else delete globalThis.PointerEvent;
  globalThis._albPing = o.ping || 0;
  globalThis._qteCompMode = !!o.comp;
  const submits = [];
  globalThis._sbStartQteRun = () => Promise.resolve({ run: 'r', ticket: 't' });
  globalThis._sbSubmitScore = (type, score, packet) => { submits.push({ type, score, packet }); };
  Q.Run.current = null;
  const firstLog = iifeLogs.length;
  // the page's Math.random (the IIFE's draws) seeded, so a failure replays
  const realRandom = Math.random;
  Math.random = mulberry32(seed * 7919 + 13);

  new Function('window', 'document', 'localStorage', 'IS_MOBILE', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'performance', IIFE_SRC)(
    globalThis, document, localStorage, !!o.mob, setTimeoutV, clearTimeoutV, rafV, cafV, MO, perfV);
  const hide = globalThis._onDuraelisQteHide, show = globalThis._onDuraelisQteShow;
  if (typeof hide !== 'function' || typeof show !== 'function') { fail('iife: no show/hide hooks'); return { submits, logs: [] }; }
  if (!draws) fail('iife: nothing drawn at load');

  const cur = () => Q.Run.current;
  const entry = () => { const r = cur(); return r ? iifeLogs.find(x => x.run === r) : null; };
  streakCb = text => { const m = /Cleared: (\d+)/.exec(text); const e = entry(); if (m && e && +m[1] > e.cleared) { e.cleared = +m[1]; onClear(+m[1]); } };
  resultCb = text => { const e = entry(); if (e && text) e.result = text; };
  const fireWin = type => (winH[type] || []).slice().forEach(fn => fn({}));
  const fireDoc = (type, ev) => (docH[type] || []).slice().forEach(fn => fn(ev || {}));

  // the player
  let playing = false, away = false, done = false, runsStarted = 0;
  const touches = { pad: 0, swipe: 0 };
  let mine = null;                                  // the round the player is on: { key, decided }
  let pending = [];                                 // scheduled player events (killed on a pause)
  const W = {
    now: () => now, at, rng, o, cur, entry, canvas, startBtn, resumeBtn, panel, wrap, document, ids, frame: () => frameCur, seen: () => frameSeen,
    start() { startBtn.fire('click'); runsStarted++; playing = true; },
    resume() { resumeBtn.fire('click'); },
    hide() { hide(); panel.style.display = 'none'; killPlans(); },
    show() { panel.style.display = 'flex'; show(); },
    reshow() { show(); },                           // the open tab clicked again: the run plays on
    tabHide() { document.hidden = true; fireDoc('visibilitychange'); killPlans(); },
    tabShow() { document.hidden = false; fireDoc('visibilitychange'); if (!tickEv && (cbs.size || o.continuous)) scheduleTick(); },
    leavePage() { ids['page-qte'].classList.remove('active'); killPlans(); },
    backPage() { ids['page-qte'].classList.add('active'); },
    resize(w) { wrap.clientWidth = w; fireWin('resize'); },
    staleTick(ms) { if (tickEv) tickEv.dead = true; tickEv = null; const V = now - ms; tickEv = at(now + 1, () => runTick(V)); },
    stopPlaying() { playing = false; killPlans(); },
    startPlaying() { playing = true; },
    key(k, repeat, extra) { fireDoc('keydown', Object.assign({ key: KEY_EV[k][0], code: KEY_EV[k][1], repeat: !!repeat, preventDefault() {} }, extra || {})); },
    press(k) { press(k); },
    tap(k) { tapKey(k); },
    pad: k => PAD[k],
    setDone() { done = true; },
  };
  function killPlans() { pending.forEach(e => { e.dead = true; }); pending = []; mine = null; }
  function later(t, fn) { const e = at(t, () => { pending = pending.filter(x => x !== e); fn(); }); pending.push(e); return e; }
  // One press, as this player makes it. Returns when it lands in the page.
  // one tap on an arrow key, the events in a real browser's order
  function tapKey(k) {
    const b = PAD[k], ev = { preventDefault() {}, cancelable: true, pointerType: 'touch', button: 0 };
    if (o.pointer) b.fire('pointerdown', ev);
    b.fire('touchstart', ev);
    b.fire('click', ev);
  }
  function press(k) {
    if (o.mob && !o.key) {
      const pad = o.touch === 'dpad' || (o.touch !== 'swipe' && rng() < 0.7);
      if (pad && dpad.style.display !== 'none') { touches.pad++; tapKey(k); return now; }
      touches.swipe++;
      const d = { W: [0, -60], A: [-60, 0], S: [0, 60], D: [60, 0] }[k], x0 = uni(rng, 80, 300), y0 = uni(rng, 80, 200);
      canvas.fire('touchstart', { touches: [{ clientX: x0, clientY: y0 }], preventDefault() {} });
      const t = now + uni(rng, 60, 140);
      at(t, () => canvas.fire('touchend', { changedTouches: [{ clientX: x0 + d[0] + uni(rng, -8, 8), clientY: y0 + d[1] + uni(rng, -8, 8) }], preventDefault() {} }));
      return t;
    }
    const arrow = o.arrows === true || (o.arrows === 'mix' && rng() < 0.5);
    const e = { key: arrow ? KEY_EV[k][2] : (rng() < 0.03 ? KEY_EV[k][0].toUpperCase() : KEY_EV[k][0]), code: arrow ? KEY_EV[k][2] : KEY_EV[k][1], repeat: false, preventDefault() {} };
    const dispatch = ev => fireDoc('keydown', ev);
    if (o.ping > 0) { setTimeoutV(() => dispatch(Object.assign({}, e)), o.ping); return now + o.ping; }   // core.js: swallowed, a copy later
    dispatch(e);
    return now;
  }
  // The board as drawn: the souls' and the spotlights' cells, or null while a
  // soul is between cells (a step, a spawn flying in) or no round is drawn.
  function readBoard(f) {
    if (!f || !f.board || !f.timer || f.vT == null) return null;
    const r = cur(); if (!r || f.run !== r || f.nR !== countR()) return null;
    const cw = f.board.w / D.COLS, ch = f.board.h / D.ROWS;
    const cellOf = p => {
      const cx = (p.x - f.board.x) / cw - 0.5, cy = (p.y - f.board.y) / ch - 0.5, ix = Math.round(cx), iy = Math.round(cy);
      if (Math.abs(cx - ix) > 0.01 || Math.abs(cy - iy) > 0.01) return -2;
      return ix < 0 || ix >= D.COLS || iy < 0 || iy >= D.ROWS ? -1 : ix + D.COLS * iy;
    };
    let souls = 0, spots = 0;
    for (const p of f.cores) { const c = cellOf(p); if (c === -2) return null; if (c >= 0) souls |= 1 << c; }
    for (const p of f.spots) { const c = cellOf(p); if (c < 0) return null; spots |= 1 << c; }
    if (!souls || D.popcount(souls) !== D.popcount(spots)) return null;
    return { souls, spots };
  }
  // after each frame: the first sight of a round's spotlights starts the clock
  function look() {
    if (!playing || away || done || document.hidden || panel.style.display === 'none' || !ids['page-qte'].classList.contains('active')) return;
    const f = frameSeen; if (!f || !f.timer || f.vT == null) return;
    const r = cur(); if (!r || r.closed || f.run !== r) return;
    const key = r._serial + ':' + f.nR;
    if (mine && mine.key === key) return;
    const b = readBoard(f);
    mine = { key };
    if (rng() < o.guessP) { const t = now + uni(rng, 90, 220); later(t, () => { if (!mine || mine.key !== key) return; recheck(key, press(pick(rng, KEYS4))); }); return; }
    const n = b ? D.popcount(b.souls) : 2;
    let ms = logn(rng, o.rtMed, o.rtSig) * (1 + o.perSoul * (n - 1));
    if (rng() < o.lapseP) ms *= uni(rng, 2, 4);
    later(now + ms, () => decide(key, false, 0));
  }
  function liveKey() { const r = cur(); return r && !r.closed ? r._serial + ':' + countR() : null; }
  function roundOpen() { const r = cur(); if (!r) return false; const ev = r.log.ev; for (let i = ev.length - 1; i >= 0; i--) { if (ev[i][0] === 'F') return false; if (ev[i][0] === 'R') return true; } return false; }
  function decide(key, fix, tries) {
    if (!playing || away || !mine || mine.key !== key || liveKey() !== key || !roundOpen()) return;
    const b = readBoard(frameSeen);
    if (!b) { if (tries < 60) later(now + 16, () => decide(key, fix, tries + 1)); return; }   // between cells: look again
    if (b.souls === b.spots) return;                // solved: wait for the flare
    const p = makePlan(rng, b.souls, b.spots, o, fix);
    if (!p.keys.length) return;
    const t0 = now;
    let landed = now;
    p.keys.forEach((k, i) => {
      if (i === 0) landed = Math.max(landed, press(k));
      else later(t0 + p.dts[i], () => { if (playing && !away) press(k); });
    });
    landed = Math.max(landed, t0 + p.dts[p.dts.length - 1] + (o.ping || 0) + 150);
    recheck(key, landed);
  }
  function recheck(key, landed) {
    later(landed + D.STEP_MS + logn(rng, o.rt2Med, 0.3), () => decide(key, true, 0));
  }
  function onClear(n) {
    if (n >= o.maxRounds) {
      if (o.walkAway) { done = true; return; }
      W.stopPlaying();
    }
    if (o.onClear) o.onClear(W, n);
    else if (rng() < (o.pendPauseP || 0)) pauseFor(pick(rng, ['panel', 'tab', 'page']), uni(rng, 0, 560), uni(rng, 900, 6000));
  }
  const WIDTHS = o.mob ? [320, 344, 374, 414] : [320, 444, 584, 724, 900, 924, 1200];
  function pauseFor(kind, after, dur) {
    at(now + after, () => {
      if (away || done) return;
      away = true;
      if (kind === 'panel') W.hide(); else if (kind === 'tab') W.tabHide(); else W.leavePage();
      at(now + dur, () => {
        if (rng() < o.resizeP) wrap.clientWidth = pick(rng, WIDTHS);
        if (kind === 'panel') W.show(); else if (kind === 'tab') W.tabShow(); else W.backPage();
        at(now + uni(rng, 250, 2500), () => { away = false; mine = null; if (resumeBtn.style.display !== 'none') W.resume(); });
      });
    });
  }
  // the page around the player: pauses, resizes, the tab clicked again, restarts
  let nextPause = o.pauseRate ? expo(rng, 1 / o.pauseRate) : Infinity;
  let nextReshow = o.reshowRate ? expo(rng, 1 / o.reshowRate) : Infinity;
  let nextResize = o.resizeRate ? expo(rng, 1 / o.resizeRate) : Infinity;
  function brain() {
    if (done) return;
    const r = cur();
    const live = r && !r.closed && startBtn.style.display === 'none' && resumeBtn.style.display === 'none';
    if (o.script) o.script(W);
    else if (!away) {
      if (!r && startBtn.style.display !== 'none') W.start();
      else if (r && r.closed && startBtn.style.display !== 'none') {
        if (runsStarted < o.maxRuns && rng() < 0.05) W.start(); else if (runsStarted >= o.maxRuns) done = true;
      } else if (r && !playing && !r.closed && live && rng() < 0.001) done = true;
      else if (live && now > nextPause) {
        nextPause = now + expo(rng, 1 / o.pauseRate);
        pauseFor(pick(rng, ['panel', 'panel', 'tab', 'page']), 0, rng() < 0.3 ? uni(rng, 300, 1500) : uni(rng, 1500, 30000));
      } else if (live && now > nextReshow) {
        nextReshow = now + expo(rng, 1 / o.reshowRate);
        W.reshow();
      } else if (now > nextResize) {
        nextResize = now + expo(rng, 1 / o.resizeRate);
        W.resize(pick(rng, WIDTHS));
      } else if (live && o.liveRestartP && rng() < o.liveRestartP && runsStarted < o.maxRuns) {
        W.start();                                    // a Start while the run is live (matchmaking clicks it)
      }
    }
    at(now + 100, brain);
  }
  at(uni(rng, 100, 1500), brain);
  if (o.continuous) scheduleTick();
  let guard = 0;
  while (!done && now < o.maxWall && guard++ < 5e6) {
    const e = popNext(); if (!e) break;
    now = Math.max(now, e.t);
    e.fn();
  }
  Math.random = realRandom;
  delete globalThis.PointerEvent;
  if (dpad.style.display !== (o.mob ? '' : 'none')) fail('arrow keys ' + (o.mob ? 'hidden on a touch screen' : 'shown without touch') + ' at the end of a world');
  const logs = iifeLogs.slice(firstLog);
  logs.forEach(x => { x.world = o; });
  iifeWall += now;
  return { submits, logs, touches };
}

function iifeOpts(rng) {
  const mob = rng() < 0.25, sk = pick(rng, SKILLS), f = uni(rng, 0.85, 1.15);
  return {
    mob, comp: rng() < 0.5, key: !mob || rng() < 0.1, arrows: pick(rng, [false, false, true, 'mix']), pointer: rng() < 0.8,
    hz: pick(rng, [60, 60, 60, 120, 144, 144, 240, 30]),
    quantum: rng() < 0.05 ? 100 : (rng() < 0.05 ? 16.67 : (rng() < 0.1 ? 1 : 0)),
    clientW: rng() < 0.03 ? pick(rng, [10, 150]) : pick(rng, mob ? [320, 344, 374, 414] : [320, 444, 584, 724, 900, 924, 1200]),
    ping: mob ? 0 : pick(rng, [0, 0, 0, 150, 300]),
    jankRate: rng() < 0.2 ? 1 / 10000 : 1 / 120000, dropP: rng() < 0.1 ? 0.03 : 0.003, timerLateP: 0.02, continuous: rng() < 0.6,
    rtMed: sk.rt * f, rtSig: uni(rng, 0.22, 0.4), perSoul: uni(rng, 0.08, 0.16),
    ikiMed: sk.iki * uni(rng, 0.85, 1.2) * (mob ? 1.3 : 1), ikiSig: uni(rng, 0.22, 0.4),
    misP: sk.mis, blindP: sk.blind, slipP: mob ? 0.015 : 0.008, guessP: uni(rng, 0, 0.02), lapseP: 0.02, rt2Med: sk.rt2 * f,
    maxRounds: rng() < 0.5 ? 3 + Math.floor(rng() * 10) : 12 + Math.floor(rng() * 30), walkAway: rng() < 0.3,
    maxRuns: 1 + Math.floor(rng() * 3),
    pauseRate: rng() < 0.5 ? 1 / uni(rng, 8000, 60000) : 0, reshowRate: rng() < 0.15 ? 1 / uni(rng, 10000, 40000) : 0,
    resizeRate: rng() < 0.15 ? 1 / uni(rng, 10000, 40000) : 0, liveRestartP: rng() < 0.05 ? 0.0005 : 0,
    pendPauseP: rng() < 0.3 ? 0.15 : 0, resizeP: 0.3,
    maxWall: 8 * 60 * 1000,
  };
}
// How far game time ran ahead of the clock (since R, and press to press),
// against the rules' GT_AHEAD tolerance.
function maxAhead(log) {
  let tR = 0, pT = 0, pG = 0, paused = 0, pAt = -1, pR = 0, pP = 0, m = -Infinity;
  for (const e of log.ev) {
    if (e[0] === 'P') pAt = e[1];
    else if (e[0] === 'U' && pAt >= 0) { paused += e[1] - pAt; pAt = -1; }
    else if (e[0] === 'R') { tR = pT = e[1]; pG = 0; pR = pP = paused; }
    else if (e[0] === 'K' || e[0] === 'F') {
      const g = e[0] === 'K' ? e[3] : e[2];
      m = Math.max(m, g - (e[1] - tR - (paused - pR)), (g - pG) - (e[1] - pT - (paused - pP)));
      if (e[0] === 'K') { pT = e[1]; pG = g; pP = paused; }
    }
  }
  return m;
}
let aheadMax = -Infinity;
{
  const t1 = Date.now();
  const N_IIFE = +(process.env.NI || 250);
  const rng = mulberry32(777);
  const st = { worlds: 0, submits: 0, subBad: 0, subReview: 0, logs: 0, logInvalid: 0, logReview: 0, logMismatch: 0, maxScore: 0, dueResumes: 0, restarts: 0, pauses: 0, mob: 0, ends: {}, results: 0, resultBad: 0, keys: 0, fails: 0, souls: 0 };
  for (let w = 0; w < N_IIFE; w++) {
    const o = iifeOpts(rng);
    const res = duraWorld(1000 + w, o);
    st.worlds++; if (o.mob) st.mob++;
    if (res.logs.length > 1) st.restarts += res.logs.length - 1;
    for (const s of res.submits) {
      st.submits++;
      const r = Q.check(s.type, s.packet.log, { platform: o.mob ? 'M' : 'C', claimed: s.score });
      st.maxScore = Math.max(st.maxScore, s.score);
      if (r.verdict === 'invalid' || r.score !== s.score) { st.subBad++; if (st.subBad < 6) fail('iife submit ' + s.type + ' ' + s.score + ' -> ' + r.verdict + ' ' + r.score + ' ' + r.reasons.join('; ') + ' ' + JSON.stringify(o)); }
      else if (r.verdict === 'review') { st.subReview++; if (st.subReview < 4) console.log('  iife submit review: ' + r.reasons.join('; ')); }
    }
    for (const x of res.logs) {
      const log = x.run.log;
      st.logs++;
      const r = Q.check(log.type, log, { platform: o.mob ? 'M' : 'C', claimed: x.cleared });
      if (r.verdict === 'invalid') { st.logInvalid++; if (st.logInvalid < 6) fail('iife whole log invalid: ' + r.reasons.join('; ') + ' ' + JSON.stringify(o)); }
      else if (r.verdict === 'review') { st.logReview++; if (st.logReview < 4) console.log('  iife whole log review: ' + r.reasons.join('; ')); }
      if (r.score !== x.cleared) { st.logMismatch++; if (st.logMismatch < 6) fail('iife whole log score ' + r.score + ' != cleared ' + x.cleared + ' ' + r.reasons.join('; ')); }
      aheadMax = Math.max(aheadMax, maxAhead(log));
      st.pauses += log.ev.filter(e => e[0] === 'P').length;
      st.keys += log.ev.filter(e => e[0] === 'K').length;
      st.fails += r.stats.fails || 0; st.souls += r.stats.soulsLost || 0;
      const last = log.ev[log.ev.length - 1];
      const end = last && last[0] === 'E' ? last[2] : 'open';
      st.ends[end] = (st.ends[end] || 0) + 1;
      for (let i = 1; i < log.ev.length; i++) if ((log.ev[i][0] === 'R' || log.ev[i][0] === 'N') && log.ev[i - 1][0] === 'U') st.dueResumes++;
      const want = expectedResult(log);
      if (want !== null || x.result !== null) {
        st.results++;
        if (want !== x.result) { st.resultBad++; if (st.resultBad < 4) fail('fight result line: "' + x.result + '", the log says "' + want + '"'); }
      }
    }
  }
  console.log(`iife: ${st.worlds} page loads (${st.mob} mobile), ${st.logs} runs (${st.restarts} restarts), ${st.submits} submits: bad ${st.subBad}, review ${st.subReview}; whole logs: invalid ${st.logInvalid}, review ${st.logReview}, score != cleared ${st.logMismatch}; ends ${JSON.stringify(st.ends)}; best ${st.maxScore}; ${st.keys} presses, ${st.fails} rounds lost (${st.souls} flames, a life each), ${st.pauses} pauses, rounds started on Resume ${st.dueResumes}; fight result lines ${st.results} (wrong ${st.resultBad}); game time at most ${aheadMax.toFixed(1)} ms ahead of the clock (tolerance ${D.T.GT_AHEAD}); ${(iifeWall / 60000).toFixed(0)} min of play, ${iifeTicks} frames, ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  if (st.submits < 100) fail('iife: too few submits (' + st.submits + ')');
  if (st.subReview + st.logReview) fail('iife: honest page runs held for review');
  if (!st.dueResumes) fail('iife: no round was started on Resume (the paused-timer path went untested)');
  if (!st.ends.lives) fail('iife: no run was played to the last life');
  if (!st.results) fail('iife: no run reached the fight result');
}
// Targeted: the scenarios the pause, restart, input and result code is about, on the real IIFE.
{
  const base = { mob: false, comp: false, key: true, arrows: false, hz: 60, quantum: 0, clientW: 924, ping: 0, jankRate: 0, dropP: 0, timerLateP: 0, continuous: true,
    rtMed: 500, rtSig: 0.25, perSoul: 0.1, ikiMed: 140, ikiSig: 0.25, misP: 0, blindP: 0, slipP: 0, guessP: 0, lapseP: 0, rt2Med: 350,
    maxRounds: 99, walkAway: false, maxRuns: 1, pauseRate: 0, reshowRate: 0, resizeRate: 0, pendPauseP: 0, resizeP: 0, maxWall: 60000 };
  const verdictOf = x => Q.check(x.run.log.type, x.run.log, { platform: x.world && x.world.mob ? 'M' : 'C', claimed: x.cleared });
  const codes = ev => ev.map(e => e[0]).join('');
  const lastR = ev => { for (let i = ev.length - 1; i >= 0; i--) if (ev[i][0] === 'R') return i; return -1; };
  const show = (name, okIf, detail) => { if (!okIf) fail(name + ': ' + detail); else console.log('  ok   ' + name + (detail && okIf ? ' - ' + detail : '')); };
  // 1. left the panel / the page / the browser tab inside the 600 ms after a
  //    flare, back after the timer: the next round starts on Resume
  for (const kind of ['panel', 'page', 'tab']) {
    let did = false;
    const o = Object.assign({}, base, { maxRounds: 4, walkAway: true, onClear(W, n) {
      if (n !== 1 || did) return; did = true;
      W.at(W.now() + 100, () => {
        if (kind === 'panel') W.hide(); else if (kind === 'tab') W.tabHide(); else W.leavePage();
        W.at(W.now() + 3000, () => {
          if (kind === 'panel') W.show(); else if (kind === 'tab') W.tabShow(); else W.backPage();
          W.at(W.now() + 500, () => W.resume());
        });
      });
    } });
    const res = duraWorld(51, o);
    const x = res.logs[0], ev = x.run.log.ev, iu = ev.findIndex(e => e[0] === 'U');
    let j = iu + 1; while (ev[j] && ev[j][0] === 'N') j++;
    const r = verdictOf(x);
    show(kind + ' left across the between-rounds timer: the round starts on Resume',
      iu > 0 && ev[j] && ev[j][0] === 'R' && ev[j][1] === ev[iu][1] && ev[j][2] === 1 && x.cleared >= 2 && r.verdict === 'valid' && r.score === x.cleared,
      'run went on to ' + x.cleared + ' (' + r.verdict + ') ' + JSON.stringify(ev.slice(Math.max(0, iu - 2), j + 1)));
  }
  // 2. the browser tab / the QTE page left mid-round: P at once (tab) or at the
  //    next frame (page); the board is hidden while paused, keys do nothing,
  //    and Resume goes on in the same round
  for (const kind of ['tab', 'page']) {
    let did = false, hidden = null;
    const o = Object.assign({}, base, { maxRounds: 4, walkAway: true, onClear(W, n) {
      if (n !== 1 || did) return; did = true;
      const wait = () => { const ev = W.cur().log.ev; const ri = lastR(ev); if (ri >= 0 && ev[ri][2] === 1 && ev.slice(ri).some(e => e[0] === 'K')) {
        if (kind === 'tab') W.tabHide(); else W.leavePage();
        W.at(W.now() + 200, () => { const f = W.frame(); hidden = f ? { spots: f.spots.length, cores: f.cores.length } : null; W.key('D'); W.key('S'); });
        W.at(W.now() + 5000, () => { if (kind === 'tab') W.tabShow(); else W.backPage(); W.at(W.now() + 700, () => W.resume()); });
      } else W.at(W.now() + 5, wait); };
      W.at(W.now() + 5, wait);
    } });
    const res = duraWorld(55, o);
    const x = res.logs[0], ev = x.run.log.ev, ip = ev.findIndex(e => e[0] === 'P'), iu = ev.findIndex(e => e[0] === 'U'), r = verdictOf(x);
    const midRound = ip > 0 && ev.slice(0, ip).reverse().find(e => e[0] === 'R' || e[0] === 'F')[0] === 'R';
    const sameRound = iu > ip && ev.slice(iu + 1).find(e => e[0] === 'F' || e[0] === 'R')[0] === 'F';
    show((kind === 'tab' ? 'browser tab' : 'QTE page') + ' left mid-round: paused, the board hidden, keys ignored, the round goes on after Resume',
      ip > 0 && iu === ip + 1 && midRound && sameRound && hidden && hidden.spots === 0 && hidden.cores === 0 && x.cleared >= 2 && r.verdict === 'valid' && r.score === x.cleared,
      'run went on to ' + x.cleared + ' (' + r.verdict + ' ' + r.reasons.join('; ') + '), drawn while paused ' + JSON.stringify(hidden) + ' ' + JSON.stringify(ev.slice(Math.max(0, ip - 2), iu + 2)));
  }
  // 3. the panel left during the intro, back after it: the first round starts on Resume
  {
    let phase = 0;
    const o = Object.assign({}, base, { maxRounds: 3, walkAway: true, script(W) {
      if (phase === 0 && !W.cur()) { W.start(); phase = 1; W.at(W.now() + 300, () => { W.hide(); W.at(W.now() + 3000, () => { W.show(); W.at(W.now() + 400, () => { W.resume(); phase = 2; }); }); }); }
      else if (phase === 2 && W.cur().log.ev.filter(e => e[0] === 'F').length >= 3) W.setDone();
    } });
    const res = duraWorld(58, o);
    const x = res.logs[0], ev = x.run.log.ev, r = verdictOf(x);
    show('panel left during the intro: the first round starts on Resume', /^PUN+R/.test(codes(ev)) && ev[1][1] === ev[2][1] && r.verdict === 'valid' && r.score === x.cleared,
      codes(ev).slice(0, 12) + ' ' + r.verdict + ' ' + r.reasons.join('; '));
  }
  // 4. the third life lost, then Start inside the end's reset: the new run is
  //    not stopped by the old run's reset
  {
    let phase = 0, tEnd = 0;
    const o = Object.assign({}, base, { script(W) {
      const r = W.cur();
      if (phase === 0 && !r) { W.start(); W.stopPlaying(); phase = 1; }
      else if (phase === 1 && r.log.ev.some(e => e[0] === 'E')) { tEnd = W.now(); W.at(W.now() + 300, () => { W.start(); W.stopPlaying(); }); phase = 2; }
      else if (phase === 2 && W.now() > tEnd + 20000) W.setDone();
    } });
    const res = duraWorld(52, o);
    const first = res.logs[0], second = res.logs[1];
    const ok = first && /E$/.test(codes(first.run.log.ev)) && second && second.run.log.ev.filter(e => e[0] === 'F').length === 3 && /E$/.test(codes(second.run.log.ev));
    show('third life lost, then Start inside the end reset: the new run plays on to its own end', ok, second ? codes(second.run.log.ev) : 'no second run');
  }
  // 5. Resume handled while a 500 ms-old frame is still pending (a long task):
  //    that frame's dt is clamped to 0, so game time never goes back
  for (const mode of ['press', 'play on']) {
    let did = false;
    const res0 = duraWorld(53, Object.assign({}, base, { maxRounds: 4, walkAway: true, onClear(W, n) {
      if (n !== 1 || did) return; did = true;
      const wait = () => { const ev = W.cur().log.ev; const ri = lastR(ev); if (ri >= 0 && ev[ri][2] === 1 && ev.slice(ri).some(e => e[0] === 'K')) {
        W.hide(); W.at(W.now() + 1000, () => { W.show(); W.at(W.now() + 400, () => { W.staleTick(500); W.resume(); if (mode === 'press') W.at(W.now() + 30, () => W.press('A')); }); });
      } else W.at(W.now() + 5, wait); };
      W.at(W.now() + 5, wait);
    } }));
    const x = res0.logs[0], r = verdictOf(x);
    let back = false, prevG = -1;
    for (const e of x.run.log.ev) { if (e[0] === 'R') prevG = -1; else if (e[0] === 'K' || e[0] === 'F') { const g = e[0] === 'K' ? e[3] : e[2]; if (g < prevG) back = true; prevG = g; } }
    show('Resume with a 500 ms-old frame pending (' + mode + '): game time never went back', !back && r.verdict === 'valid' && r.score === x.cleared, r.verdict + ' ' + r.score + '/' + x.cleared + ' ' + r.reasons.join('; '));
  }
  // 6. resizes mid-run change nothing in the log (cells are grid positions)
  {
    let did = 0;
    const o = Object.assign({}, base, { maxRounds: 6, walkAway: true, onClear(W) { if (did < 3) { did++; W.resize([320, 1200, 584][did - 1]); } } });
    const x = duraWorld(54, o).logs[0], r = verdictOf(x);
    show('three resizes mid-run: the log checks out', r.verdict === 'valid' && r.score === x.cleared && x.cleared >= 6, x.cleared + ' rounds, ' + r.verdict);
  }
  // 7. a held key: one keydown, then 30 auto-repeats that must not step again
  {
    let phase = 0;
    const o = Object.assign({}, base, { maxWall: 20000, script(W) {
      if (phase === 0 && !W.cur()) { W.start(); W.stopPlaying(); phase = 1; }
      else if (phase === 1 && W.cur().log.ev.some(e => e[0] === 'R')) {
        phase = 2;
        W.at(W.now() + 700, () => { W.key('D', false); for (let k = 1; k <= 30; k++) W.at(W.now() + k * 33, () => W.key('D', true)); });
      } else if (phase === 2 && W.cur().log.ev.some(e => e[0] === 'F')) W.setDone();
    } });
    const x = duraWorld(56, o).logs[0], ev = x.run.log.ev, ks = ev.filter(e => e[0] === 'K');
    show('held key: one step, 30 auto-repeats ignored', ks.length === 1 && Q.check(x.run.log.type, x.run.log, { platform: 'C', claimed: 0 }).verdict !== 'invalid', ks.length + ' presses logged');
  }
  // 8. arrows through the ping sim play like WASD
  {
    const x = duraWorld(59, Object.assign({}, base, { arrows: true, ping: 150, maxRounds: 5, walkAway: true })).logs[0], r = verdictOf(x);
    show('arrow keys through the ping sim (150 ms)', x.cleared >= 5 && r.verdict === 'valid' && x.run.log.ev.some(e => e[0] === 'K'), x.cleared + ' rounds, ' + r.verdict + ' ' + r.reasons.join('; '));
  }
  // 9. keys outside a round (the intro, the gap after a flare) and with Ctrl /
  //    Alt / Meta held do nothing
  {
    let phase = 0;
    const o = Object.assign({}, base, { maxWall: 30000, script(W) {
      const r = W.cur();
      if (phase === 0 && !r) { W.start(); W.stopPlaying(); phase = 1; W.at(W.now() + 300, () => W.key('D')); }
      else if (phase === 1 && r.log.ev.some(e => e[0] === 'R')) { phase = 2; W.at(W.now() + 400, () => { W.key('A', false, { ctrlKey: true }); W.key('S', false, { altKey: true }); W.key('W', false, { metaKey: true }); }); }
      else if (phase === 2 && r.log.ev.some(e => e[0] === 'F')) { phase = 3; W.at(W.now() + 150, () => W.key('A')); }
      else if (phase === 3 && r.log.ev.filter(e => e[0] === 'R').length >= 2) W.setDone();
    } });
    const x = duraWorld(60, o).logs[0];
    show('keys during the intro, the gap and with Ctrl/Alt/Meta held: nothing logged, nothing moved', !x.run.log.ev.some(e => e[0] === 'K'), codes(x.run.log.ev));
  }
  // 10. the fight result line after round 6 (and at an early end)
  {
    const flawless = duraWorld(61, Object.assign({}, base, { maxRounds: 7, walkAway: true, maxWall: 120000 })).logs[0];
    show('six rounds cleared: "' + RESULT_TEXT(0) + '"', flawless.result === RESULT_TEXT(0) && flawless.cleared >= 6, 'line: ' + flawless.result);
    // the player sits out round 1 (one flame in casual, two in comp), then plays
    const sitOut = (seed, comp) => { let off = 0; return duraWorld(seed, Object.assign({}, base, { comp, maxWall: 120000, script(W) {
      const r = W.cur();
      if (!r) { W.start(); W.stopPlaying(); off = 1; return; }
      const nF = r.log.ev.filter(e => e[0] === 'F').length;
      if (nF === 1 && off === 1) { W.startPlaying(); off = 2; }
      else if (nF >= 7 || r.closed) W.setDone();
    } })).logs[0]; };
    const one = sitOut(62, false);
    show('one flame lost in six rounds: "' + RESULT_TEXT(1) + '"', one.result === RESULT_TEXT(1) && expectedResult(one.run.log) === RESULT_TEXT(1) && one.run.log.ev.filter(e => e[0] === 'R')[1][3] === 2, 'line: ' + one.result);
    let two = null;
    for (let sd = 70; sd < 90 && !two; sd++) {
      const x = sitOut(sd, true), ev = x.run.log.ev, fi = ev.findIndex(e => e[0] === 'F');
      if (fi >= 0 && D.popcount(maskBefore(x.run.log, fi) & ~ev[fi][3]) === 2 && expectedResult(x.run.log) === RESULT_TEXT(2)) two = x;
    }
    show('two flames lost in one round: two lives, "' + RESULT_TEXT(2) + '"', two && two.result === RESULT_TEXT(2) && expectedResult(two.run.log) === RESULT_TEXT(2) && two.run.log.ev.filter(e => e[0] === 'R')[1][3] === 1,
      two ? 'line: ' + two.result + ', round 2 logged with ' + two.run.log.ev.filter(e => e[0] === 'R')[1][3] + ' lives' : 'no seed left both flames dark');
    // three flames in the dark at once with three lives: the run ends on that flare
    let three = null;
    for (let sd = 90; sd < 130 && !three; sd++) {
      let off = 0;
      const x = duraWorld(sd, Object.assign({}, base, { comp: true, maxWall: 90000, script(W) {
        const r = W.cur();
        if (!r) { W.start(); return; }
        const fs2 = r.log.ev.filter(e => e[0] === 'F').length;
        if (fs2 === 2 && off === 0) { W.stopPlaying(); off = 1; }
        if (r.closed) W.setDone();
      } })).logs[0];
      const ev = x.run.log.ev, fis = ev.map((e, j) => e[0] === 'F' ? j : -1).filter(j => j >= 0);
      if (x.cleared === 2 && fis.length === 3 && D.popcount(maskBefore(x.run.log, fis[2]) & ~ev[fis[2]][3]) >= 3) three = x;
    }
    const tEv = three ? three.run.log.ev : [];
    show('three flames lost at once: the run ends on that flare, "' + RESULT_TEXT(3) + '"', three && tEv[tEv.length - 1][0] === 'E' && tEv[tEv.length - 2][0] === 'F' && three.result === RESULT_TEXT(3)
      && Q.check(three.run.log.type, three.run.log, { platform: 'C', claimed: 2 }).verdict === 'valid', three ? codes(tEv).slice(-8) + ' ' + three.result : 'no seed lost three at once');
    let p0 = 0;
    const none = duraWorld(63, Object.assign({}, base, { maxWall: 60000, script(W) { if (!W.cur() && !p0) { W.start(); W.stopPlaying(); p0 = 1; } else if (W.cur() && W.cur().closed && W.now() > 20000) W.setDone(); } })).logs[0];
    show('every round lost (one flame each): "' + RESULT_TEXT(3) + '" after round 3', none.result === RESULT_TEXT(3) && /FEF?$|E$/.test(codes(none.run.log.ev)) && none.run.log.ev.filter(e => e[0] === 'F').length === 3, 'line: ' + none.result + ' ' + codes(none.run.log.ev));
  }
}
// The on-screen arrow keys: shown on a touch screen from the moment the panel
// opens and through the whole QTE; one tap = one step (pointerdown, then the
// touchstart and the click a browser sends after it; or touchstart and click
// where there are no pointer events); rapid taps all count; taps in the intro
// or while paused do nothing; each tap flashes its key.
for (const pointer of [true, false]) {
  const seen = {}, flash = {};
  let phase = 0;
  const o = { mob: true, comp: false, key: false, pointer, hz: 60, quantum: 0, clientW: 374, ping: 0, jankRate: 0, dropP: 0, timerLateP: 0, continuous: true,
    rtMed: 600, rtSig: 0.25, perSoul: 0.1, ikiMed: 190, ikiSig: 0.25, misP: 0, blindP: 0, slipP: 0, guessP: 0, lapseP: 0, rt2Med: 400,
    maxRounds: 99, walkAway: false, maxRuns: 1, pauseRate: 0, reshowRate: 0, resizeRate: 0, pendPauseP: 0, resizeP: 0, maxWall: 60000,
    script(W) {
      const pad = W.ids['duraelis-dpad'], vis = () => pad.style.display !== 'none';
      const r = W.cur();
      if (phase === 0) { seen.load = vis(); W.start(); W.stopPlaying(); phase = 1; W.at(W.now() + 300, () => { seen.intro = vis(); W.tap('D'); }); }
      else if (phase === 1 && r.log.ev.some(e => e[0] === 'R')) {
        phase = 2;
        W.at(W.now() + 300, () => {
          seen.round = vis(); W.tap('D'); flash.on = W.pad('D').classList.contains('pressed');
          W.at(W.now() + 200, () => { flash.off = !W.pad('D').classList.contains('pressed'); });
          W.at(W.now() + 400, () => { W.tap('W'); W.at(W.now() + 40, () => W.tap('A')); W.at(W.now() + 80, () => W.tap('S')); });
          W.at(W.now() + 700, () => { W.hide(); W.at(W.now() + 300, () => { W.show(); seen.paused = vis(); W.tap('D'); W.at(W.now() + 300, () => W.resume()); }); });
        });
      } else if (phase === 2 && r.log.ev.some(e => e[0] === 'E')) {
        phase = 3; seen.over = vis();
        W.at(W.now() + 3000, () => { seen.idle = vis() && W.startBtn.style.display !== 'none'; W.setDone(); });
      }
    } };
  const x = duraWorld(64 + (pointer ? 0 : 1), o).logs[0];
  const ks = x.run.log.ev.filter(e => e[0] === 'K').map(e => e[2]).join('');
  const r = Q.check(x.run.log.type, x.run.log, { platform: 'M', claimed: x.cleared });
  const allSeen = ['load', 'intro', 'round', 'paused', 'over', 'idle'].every(k => seen[k] === true);
  const name = 'arrow keys (' + (pointer ? 'pointer events' : 'touch events only') + '): shown at load, in the intro, the round, a pause, the end and after it; one step a tap, rapid taps all count, nothing in the intro or paused, the flash';
  if (ks !== 'DWAS' || !allSeen || flash.on !== true || flash.off !== true || r.verdict === 'invalid') fail(name + ': presses "' + ks + '" seen ' + JSON.stringify(seen) + ' flash ' + JSON.stringify(flash) + ' ' + r.verdict + ' ' + r.reasons.join('; '));
  else console.log('  ok   ' + name + ' (presses ' + ks + ', log ' + r.verdict + ')');
}
// The arrow keys stay hidden without touch
{
  const res = duraWorld(66, { mob: false, comp: false, key: true, hz: 60, quantum: 0, clientW: 924, ping: 0, jankRate: 0, dropP: 0, timerLateP: 0, continuous: true,
    rtMed: 500, rtSig: 0.25, perSoul: 0.1, ikiMed: 140, ikiSig: 0.25, misP: 0, blindP: 0, slipP: 0, guessP: 0, lapseP: 0, rt2Med: 350,
    maxRounds: 2, walkAway: true, maxRuns: 1, pauseRate: 0, reshowRate: 0, resizeRate: 0, pendPauseP: 0, resizeP: 0, maxWall: 30000 });
  if (!res.logs[0] || res.logs[0].cleared < 2) fail('desktop run with the arrow keys hidden did not play');
  else console.log('  ok   no touch: the arrow keys stay hidden, the keyboard plays (' + res.logs[0].cleared + ' rounds)');
}
// The mobile arrow keys and swipes on the board, directly
for (const touch of ['dpad', 'swipe']) {
  const o = { mob: true, comp: false, key: false, touch, pointer: true, hz: 60, quantum: 0, clientW: 374, ping: 0, jankRate: 0, dropP: 0, timerLateP: 0, continuous: true,
    rtMed: 600, rtSig: 0.25, perSoul: 0.1, ikiMed: 190, ikiSig: 0.25, misP: 0, blindP: 0, slipP: 0, guessP: 0, lapseP: 0, rt2Med: 400,
    maxRounds: 6, walkAway: true, maxRuns: 1, pauseRate: 0, reshowRate: 0, resizeRate: 0, pendPauseP: 0, resizeP: 0, maxWall: 90000 };
  const res = duraWorld(57, o);
  const x = res.logs[0], r = x && Q.check(x.run.log.type, x.run.log, { platform: 'M', claimed: x.cleared });
  const used = touch === 'dpad' ? res.touches.pad : res.touches.swipe;
  if (!x || x.cleared < 6 || r.verdict !== 'valid' || !used) fail('mobile ' + touch + ': ' + (x ? x.cleared + ' ' + r.verdict + ' ' + r.reasons.join('; ') + ' ' + JSON.stringify(res.touches) : 'no run'));
  else console.log('  ok   mobile, ' + (touch === 'dpad' ? 'the arrow keys' : 'swipes on the board') + ': ' + used + ' touches played ' + x.cleared + ' rounds, log valid');
}

// ── d) duraelis.bot.js against the real IIFE (a vm page, async fake clock) ──
// The harness bot (tools/qte/harness.html?t=duraelis) drives the page with the
// same ctx; here it plays the shipped rules + IIFE, and every submit it
// produces (and the page's own self-check) must be valid.
async function botSuite(nRuns) {
  const vm = require('vm');
  const srcs = [fs.readFileSync('@qte-scratch/wt2/js/qte-rules.js', 'utf8'),
    fs.readFileSync(path.join(__dirname, 'duraelis.rules.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'duraelis.iife.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'duraelis.bot.js'), 'utf8')];
  let bad = 0, reached = 0, checked = 0;
  for (let k = 0; k < nRuns; k++) {
    const rnd = mulberry32(7000 + k);
    const comp = k % 2 === 1, ping = [0, 0, 150][k % 3];
    const clock = { now: 3000 }, period = [1000 / 60, 1000 / 144, 1000 / 30][k % 3];
    let seq = 0; const q = [];
    const push = (at, fn) => { const it = { at, s: ++seq, fn, dead: false }; q.push(it); return it; };
    const pop = () => { let bi = 0; for (let i = 1; i < q.length; i++) if (q[i].at < q[bi].at || (q[i].at === q[bi].at && q[i].s < q[bi].s)) bi = i; return q.splice(bi, 1)[0]; };
    const ctx2d = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), measureText: t => ({ width: String(t).length * 7 }) },
      { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
    const els = {};
    const el = id => els[id] || (els[id] = {
      id, tagName: /btn$|dpad-/.test(id) ? 'BUTTON' : 'DIV', style: { display: id === 'qte-panel-duraelis' ? 'flex' : (/resume|dpad$/.test(id) ? 'none' : '') }, textContent: '', width: 300, height: 150,
      classList: { contains: c => id === 'page-qte' && c === 'active', add() {}, remove() {}, toggle() {} },
      listeners: {}, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      parentElement: { clientWidth: 924 }, getContext: () => ctx2d,
    });
    const docL = {}, store = {}, subs = [];
    const sb = {
      document: { hidden: false, body: {}, getElementById: el, addEventListener: (t, f) => { (docL[t] = docL[t] || []).push(f); }, activeElement: { tagName: 'BODY' } },
      localStorage: { getItem: x => (x === 'alb:qte-selfcheck' ? '1' : x in store ? store[x] : null), setItem: (x, v) => { store[x] = String(v); }, removeItem: x => { delete store[x]; } },
      performance: { now: () => clock.now },
      requestAnimationFrame: cb => { const ts = Math.ceil(clock.now / period + 1e-9) * period; return push(ts + uni(rnd, 0.1, 1), () => cb(ts)); },
      cancelAnimationFrame: it => { if (it) it.dead = true; },
      setTimeout: (f, d) => push(clock.now + (d || 0) + uni(rnd, 0, 3), f),
      clearTimeout: it => { if (it) it.dead = true; },
      innerWidth: 1280, innerHeight: 720, _albPing: ping, _qteCompMode: comp,
      _sbSubmitScore: (type, score, packet) => { subs.push({ type, score, packet }); },
      _sbStartQteRun: () => Promise.resolve(null),
      addEventListener() {}, dispatchEvent() {}, console: { log() {}, error: console.error },
      __rand: mulberry32(55000 + k),
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext('Math.random = function () { return __rand(); }; const IS_MOBILE = false;', sb);
    for (const s of srcs) vm.runInContext(s, sb);
    const keydown = e => { for (const f of docL.keydown || []) f(e); };
    const ctx = {
      comp, target: 3 + (k % 4),
      byId: el,
      click: e => { for (const f of (e.listeners.click || [])) f({}); },
      key: (key, code, type) => {
        if (type === 'up') return;
        const e = { key, code, repeat: false, preventDefault() {} };
        if (ping > 0) push(clock.now + ping + uni(rnd, 0, 3), () => keydown(e)); else keydown(e);   // the ping sim
      },
      mouse() {},
      sleep: ms => new Promise(res => push(clock.now + Math.max(0, ms), res)),
      until: async (fn, ms) => { const end = clock.now + (ms || 10000); for (;;) { const v = fn(); if (v) return v; if (clock.now >= end) return null; await ctx.sleep(8); } },
      run: () => sb.QteRules.Run.current,
      lastEv: code => { const r = sb.QteRules.Run.current; if (!r) return null; const ev = r.log.ev; for (let i = ev.length - 1; i >= 0; i--) if (ev[i][0] === code) return ev[i]; return null; },
      human: (m, s) => Math.max(0, m + s * normal(rnd)),
      log() {},
    };
    let done = false, result = null;
    sb.__qteBots['duraelis'](ctx).then(r => { done = true; result = r; }, e => { done = true; result = e; });
    const limit = clock.now + 10 * 60 * 1000;
    while (!done && clock.now < limit) {
      for (let i = 0; i < 5; i++) await Promise.resolve();
      if (done || !q.length) break;
      const it = pop();
      if (it.dead) continue;
      if (it.at > clock.now) clock.now = it.at;
      it.fn();
    }
    for (let i = 0; i < 20; i++) await Promise.resolve();
    if (!done || !result || typeof result.points !== 'number') { bad++; console.log('  bot run', k, 'did not finish', result); continue; }
    if (result.points >= ctx.target) reached++;
    for (const s of subs) {
      checked++;
      const r = sb.QteRules.check(s.type, s.packet.log, { platform: 'C', claimed: s.score });
      if (r.verdict !== 'valid' || r.score !== s.score) { bad++; if (bad <= 5) console.log('  bot run', k, s.score, '->', r.verdict, r.score, r.reasons); }
    }
    const sc = sb.QteRules.Run.lastSelfCheck;
    if (subs.length && (!sc || sc.result.verdict !== 'valid')) { bad++; console.log('  bot run', k, 'self-check', sc && sc.result); }
    const fin = sb.QteRules.Run.current.log.ev;
    if (fin[fin.length - 1][0] !== 'E') { bad++; console.log('  bot run', k, 'the run did not end after the target'); }
  }
  console.log(`bot: ${nRuns} runs, ${checked} submits checked - bad ${bad}, reached target ${reached}/${nRuns}`);
  if (bad) fail('bot runs failed: ' + bad);
  if (reached < nRuns * 0.75) fail('bot reached its target in only ' + reached + ' of ' + nRuns);
}

(async () => {
  try { await botSuite(+(process.env.NB || 12)); } catch (e) { fail('bot suite crashed: ' + (e && e.stack || e)); }
  console.log(`time: ${((Date.now() - T_START) / 1000).toFixed(1)} s`);
  if (failures) { console.log('FAILED (' + failures + ')'); process.exit(1); }
  console.log('all duraelis tests passed');
})();
