// sword-new.test.js - node sword-new.test.js   (N=40000 NI=4000 NL=600 node sword-new.test.js for the long version)
// a) honest players simulated through the trainer's own state machine (frame
//    rates 30-240 Hz, dropped frames, long tasks, coarse clocks, the ping sim,
//    touch, pauses from the panel, the page and the browser tab)
// a2) long runs by the best players into max difficulty; a3) a run that fills
//    the log (MAX_EVENTS) stays under MAX_BYTES and still checks out
// b) forgeries, each must come out invalid, review, or scored far below the claim
// c) the real IIFE (sword-new.iife.js) in a fake DOM with a virtual clock,
//    played by a person watching the canvas: every submit and every whole log
//    checked, plus targeted scenarios (a pause across the between-rounds timer,
//    Start inside the fail reset, a Resume behind a stale frame, the browser
//    tab hidden mid-round, the QTE page left mid-round)
// exit code 1 on any failure
'use strict';
require('./_paths.js');
const fs = require('fs'), path = require('path');
const Q = require(path.join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const SN = Q.trainers['sword-new'];
if (!SN || typeof SN.check !== 'function') { console.log('FAIL sword-new rules not registered'); process.exit(1); }
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
function r4(f) { return typeof f === 'number' ? Math.round(f * 10000) / 10000 : f; }
const ZS = SN.ZONE_START, MW = SN.MARKER_W;

// ── the honest simulator ────────────────────────────────────────────────────
// Mirrors the IIFE (sword-new.iife.js): startGame, startRound, gameLoop,
// onPress, onRoundSuccess, triggerFail, pauseRun (panel hidden, QTE page left,
// browser tab hidden), resumeGame; the page's rAF / setTimeout / ping-sim
// timing (key copies run _albPing ms + setTimeout lateness after the physical
// press); and a player who watches the markers and times each press, with
// error, drift, lapses and reaction limits. o.slowMo (forgery only) feeds
// gameLoop rAF timestamps running at that fraction of real time.
function simulate(rng, o) {
  const type = 'sword-new' + (o.comp ? '-comp' : '');
  const log = { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: o.mob ? 390 : 1280, h: 800, mob: !!o.mob, ping: o.key ? o.ping : 0 }, ev: [] };
  const snaps = [];
  const q = o.quantum || 0;                       // coarse performance.now (privacy modes)
  const Pd = 1000 / o.hz, phase = rng() * Pd;
  const T0 = 1000 + rng() * 1e6;                  // performance.now at Start
  const clock = w => { const p = T0 + w; return q ? Math.floor(p / q) * q : p; };
  let wall = 0;
  const runT0 = clock(0);
  const ev = (code, ...f) => { if (log.ev.length < Q.LIMITS.MAX_EVENTS) log.ev.push([code, Math.max(0, Math.round(clock(wall) - runT0)), ...f.map(r4)]); };

  // trainer state
  let running = false, gameStarted = false, paused = false, streak = 0, lastTime = 0;
  let markers = [], lead = 0, roundPending = false, roundGT = 0, roundDue = false, speed = 0, zoneW = 0;
  let ended = false, stuck = false, pageAway = false;

  // page timing
  let frameAt = null, frameNow = 0;               // pending rAF: callback time, timestamp
  let timerAt = null;                             // the 800 ms round timer
  let presses = [];                               // { t: handler time, k, phys, pred }, sorted by t
  let pauseEv = null;                             // { kind, back, resume }
  let nextPauseAt = o.pauseRate ? expo(rng, 1 / o.pauseRate) : Infinity;
  let slowPrevReal = null, slowNow = 0;           // slow-motion rAF wrapper

  // player
  let intent = [], obsStart = 0, watching = true, roundDrift = 0;
  const react = () => o.reactMed * Math.exp(0.22 * normal(rng));
  // track per real second, as seen: frames longer than 50 ms (15 fps) run the
  // game clock slow, and a person times what they see
  const vEff = () => speed * (o.slowMo || 1) * Math.min(1, SN.DT_MAX * 1000 * o.hz / 1000);

  function nextVsync(t) { return phase + Pd * Math.floor((t - phase) / Pd + 1); }
  function requestFrame(fromClick) {
    let fb = fromClick ? nextVsync(wall - 4) : nextVsync(wall);
    // A Start / Resume click handled while an older frame was still pending
    // behind a long task: that frame's timestamp is from before the click
    // (the trainer clamps that dt to 0).
    if (fromClick && rng() < (o.jankP || 0)) fb = wall - uni(rng, 20, 400);
    else {
      while (rng() < o.dropP) fb += Pd;             // missed vsyncs
      if (rng() < (o.taskRate || 0) * Pd) fb += uni(rng, 40, 400);   // a long task (per ms rate)
    }
    const fe = Math.max(wall + 0.05, fb + uni(rng, 0, 2));
    frameAt = fe; frameNow = clock(fb);
  }

  // anticipated: started by the 800 ms timer, which the player sees coming
  function startRound(anticipated) {
    roundPending = false;
    const n = SN.markers(streak, o.comp);
    speed = SN.speed(streak, o.comp); zoneW = SN.zoneW(streak, o.comp);
    const gaps = [];
    for (let i = 0; i < n - 1; i++) gaps.push(SN.drawGap(o.gapRng ? o.gapRng() : rng()));
    markers = SN.starts(gaps, n).map(x0 => ({ x0, x: x0, stopped: false }));
    lead = 0; roundGT = 0;
    ev('R', streak, n, ...gaps);
    intent = []; obsStart = anticipated ? wall - SN.ROUND_DELAY : wall; roundDrift = o.drift * normal(rng);
  }
  function triggerFail() { running = false; paused = false; roundPending = false; ended = true; }
  function onRoundSuccess() {
    streak++;
    snaps.push({ len: log.ev.length, claimed: streak });
    roundPending = true;
    let late = rng() < 0.95 ? uni(rng, 0, 4) : uni(rng, 4, 100);
    if (pauseEv && pauseEv.kind === 'tab') late += uni(rng, 0, 1000);   // background timer throttling
    timerAt = wall + SN.ROUND_DELAY + late;
  }
  function onPress() {
    if (!running || paused || roundPending) return;
    const m = markers[lead];
    if (!m) return;
    m.stopped = true;
    const hit = SN.inZone(m.x, ZS, zoneW);
    ev('K', lead, m.x, roundGT, hit ? 1 : 0);
    if (!hit) { ev('E', 'zone'); triggerFail(); return; }
    lead++;
    if (lead >= markers.length) onRoundSuccess();
  }
  function pauseRun() {
    if (!gameStarted || !running || paused) return;
    frameAt = null; running = false; paused = true; ev('P');
  }
  function gameLoop(now) {
    if (!running) return;
    if (pageAway) { pauseRun(); return; }
    const dt = Math.min(Math.max(0, now - lastTime) / 1000, SN.DT_MAX);
    if (now > lastTime) lastTime = now;
    if (!roundPending) {
      roundGT += dt * 1000;
      for (let i = lead; i < markers.length; i++) markers[i].x = SN.pos(markers[i].x0, speed, roundGT);
      const m = markers[lead];
      if (m && SN.pastZone(m.x, ZS, zoneW)) { ev('E', 'slow', lead, m.x, roundGT); triggerFail(); return; }
      if (roundGT >= SN.TIMER_MS) { ev('E', 'time', roundGT); triggerFail(); return; }
    }
    requestFrame(false);
  }
  // the player, after each frame is drawn: commits to a press ~220 ms ahead,
  // and while the press is still more than a motor delay away, follows the
  // marker (a stall - a long frame clamped to 50 ms - moves the press later)
  function plan() {
    if (!running || roundPending || ended || !watching || pauseEv) return;
    const v = vEff();
    const zc = ZS + zoneW / 2;
    const adapt = o.key ? o.adapt * o.ping : 0;
    for (const p of presses) {
      if (p.k < lead || p.fixed || p.phys - wall <= o.motor) continue;
      const now = wall + (zc - (markers[p.k].x + MW / 2)) / v * 1000;
      const d = now - p.pred;
      if (Math.abs(d) > 1) { p.pred = now; p.phys += d; p.t += d; }
    }
    presses.sort((a, b) => a.t - b.t);
    for (let k = lead; k < markers.length; k++) {
      if (intent[k]) continue;
      const c = markers[k].x + MW / 2;
      const predicted = wall + (zc - c) / v * 1000;
      if (predicted - wall > 220 + adapt) break;
      intent[k] = true;
      if (rng() < o.forgetP) continue;              // never presses: too slow
      let err = o.bias + roundDrift + o.sd * normal(rng);
      if (rng() < o.lapseP) err *= 4;
      let physical = predicted + err - adapt;
      physical = Math.max(physical, obsStart + react(), wall);
      let lag;
      if (o.key) lag = o.ping > 0 ? o.ping + (rng() < 0.97 ? uni(rng, 0, 4) : uni(rng, 4, 100)) : uni(rng, 0, o.jitter == null ? 2 : o.jitter);
      else lag = uni(rng, 0, o.jitter == null ? 8 : o.jitter);   // touch: no ping sim
      addPress({ t: physical + lag, k, phys: physical, pred: predicted });
      if (rng() < o.doubleP) addPress({ t: physical + lag + uni(rng, 30, 120), k: k + 1, fixed: true });
    }
  }
  function addPress(p) { presses.push(p); presses.sort((a, b) => a.t - b.t); }
  function cancelPlans() { intent = intent.map((x, k) => (markers[k] && markers[k].stopped) ? x : false); }

  // Start click
  wall = 0;
  running = true; gameStarted = true; paused = false; roundPending = false;
  lastTime = clock(wall);
  startRound(false);
  requestFrame(true);

  const MAX_WALL = o.maxWall || 90 * 60 * 1000;
  let guard = 0;
  while (!ended && wall < MAX_WALL && guard++ < 2e7) {
    let tNext = Infinity, what = null;
    const cand = (t, w) => { if (t != null && t < tNext) { tNext = t; what = w; } };
    if (running && frameAt != null) cand(frameAt, 'frame');
    cand(timerAt, 'timer');
    if (presses.length) cand(presses[0].t, 'press');
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
      plan();
    } else if (what === 'timer') {
      timerAt = null;
      if (running) startRound(true);
      else if (paused && roundPending) { roundDue = true; stuck = true; }   // fired while paused: the round starts on Resume
    } else if (what === 'press') {
      presses.shift();
      onPress();
    } else if (what === 'pause') {                  // panel hidden, browser tab hidden, or the QTE page left
      nextPauseAt = Infinity;
      const kind = pick(rng, ['panel', 'panel', 'tab', 'page']);
      presses = presses.filter(p => p.t <= wall);   // later keys: nowhere to go
      cancelPlans();
      if (kind === 'page') pageAway = true;         // the next frame pauses
      else pauseRun();
      pauseEv = { kind, back: wall + o.pauseMs(), resume: null };
    } else if (what === 'back') {                   // panel / tab / page shown again
      pageAway = false;
      const pe = pauseEv; pe.back = null;
      if (paused) pe.resume = wall + uni(rng, 250, 2500);
      else { pauseEv = null; nextPauseAt = o.pauseRate ? wall + expo(rng, 1 / o.pauseRate) : Infinity; obsStart = wall; }   // page left and back between two frames
    } else if (what === 'resume') {
      pauseEv = null;
      nextPauseAt = o.pauseRate ? wall + expo(rng, 1 / o.pauseRate) : Infinity;
      paused = false; running = true; lastTime = clock(wall);
      ev('U');
      if (roundDue) { roundDue = false; startRound(false); }
      requestFrame(true);
      slowPrevReal = null;
      obsStart = wall;
    }
    if (streak >= o.maxRounds && watching) {
      if (o.walkAway) break;                        // closes the tab after the last point
      watching = false; presses = [];               // stops pressing, lets it run past
    }
  }
  return { log, snaps, streak, stuck };
}

const SKILLS = [
  { sd: 60, lapse: 0.03 }, { sd: 45, lapse: 0.02 }, { sd: 35, lapse: 0.015 }, { sd: 27, lapse: 0.01 },
  { sd: 20, lapse: 0.008 }, { sd: 15, lapse: 0.005 }, { sd: 11, lapse: 0.004 }, { sd: 8, lapse: 0.003 },
  { sd: 6, lapse: 0.002 },                          // top of the board
];
function honestOpts(rng) {
  const mob = rng() < 0.25;
  const comp = rng() < 0.5;
  const skill = pick(rng, SKILLS);
  const ping = pick(rng, [0, 0, 0, 150, 300]);
  const hz = rng() < 0.02 ? 15 : pick(rng, [60, 60, 60, 60, 120, 144, 144, 240, 30]);   // 15 fps: dt 67 ms clamped to 50, the game runs at 75%
  const weak = rng() < 0.1;
  const len = rng();
  const quantum = rng() < 0.02 ? 16.67 : (rng() < 0.01 ? 100 : (rng() < 0.05 ? 1 : 0));
  return {
    comp, mob, key: !mob || rng() < 0.05, ping, hz, quantum,
    dropP: weak ? uni(rng, 0.02, 0.06) : uni(rng, 0.001, 0.01),
    taskRate: weak ? 1 / uni(rng, 3000, 10000) : 1 / uni(rng, 20000, 120000),
    sd: skill.sd * uni(rng, 0.85, 1.15), drift: skill.sd * uni(rng, 0, 0.6), bias: 15 * normal(rng), lapseP: skill.lapse,
    forgetP: 0.001, doubleP: mob ? 0.004 : 0.001,
    adapt: uni(rng, 0.5, 1.0),
    reactMed: uni(rng, 220, 320),
    motor: uni(rng, 100, 180),                      // a press this close is committed
    pauseRate: rng() < 0.25 ? 1 / uni(rng, 15000, 120000) : 0,
    pauseMs: () => rng() < 0.3 ? uni(rng, 0, 400) : uni(rng, 400, 30000),
    jankP: rng() < 0.2 ? 0.3 : 0.02,
    maxRounds: len < 0.3 ? 3 + Math.floor(rng() * 15) : len < 0.7 ? 20 + Math.floor(rng() * 40) : 60 + Math.floor(rng() * 240),
    walkAway: rng() < 0.5,
  };
}
// a script on the real client: presses on the predicted ideal moment
function botOpts(rng, extra) {
  return Object.assign(honestOpts(rng), {
    sd: 0, drift: 0, bias: 0, lapseP: 0, forgetP: 0, doubleP: 0, pauseRate: 0,
    walkAway: true, quantum: 0, key: true, ping: 0, reactMed: 150, jitter: 1, motor: 0, taskRate: 0,
  }, extra);
}

function runCheck(log, claimed) {
  return Q.check(log.type, log, { platform: log.env && log.env.mob ? 'M' : 'C', claimed });
}
function prefix(log, len) { return Object.assign({}, log, { ev: log.ev.slice(0, len) }); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

// ── a) honest ───────────────────────────────────────────────────────────────
const N_HONEST = +(process.env.N || 3000);
const honest = { runs: 0, invalid: 0, review: 0, scoreMismatch: 0 };
const keep = [];                                   // honest runs to forge from
let maxScore = 0, sumScore = 0, maxEv = 0, maxBytes = 0, stuckN = 0, pausedRuns = 0;
const tails = { ivMad: [], offMad: [], ratio: [], gapsP: [] };
{
  const rng = mulberry32(12345);
  for (let n = 0; n < N_HONEST; n++) {
    const o = honestOpts(rng);
    const sim = simulate(rng, o);
    if (sim.stuck) stuckN++;
    if (sim.log.ev.some(e => e[0] === 'P')) pausedRuns++;
    const tests = [{ log: sim.log, claimed: sim.streak }];
    if (sim.snaps.length) {
      const sp = sim.snaps[Math.floor(rng() * sim.snaps.length)];
      tests.push({ log: prefix(sim.log, sp.len), claimed: sp.claimed });
    }
    for (const tc of tests) {
      honest.runs++;
      const r = runCheck(tc.log, tc.claimed);
      if (r.verdict === 'invalid') { honest.invalid++; fail('honest invalid: ' + r.reasons.join('; ') + ' ' + JSON.stringify({ comp: o.comp, mob: o.mob, hz: o.hz, q: o.quantum, ping: o.ping })); }
      else if (r.verdict === 'review') { honest.review++; if (honest.review <= 12) console.log('  honest review: ' + r.reasons.join('; ') + ' sd=' + o.sd.toFixed(1) + ' hz=' + o.hz + ' q=' + o.quantum + ' ping=' + o.ping + ' score=' + tc.claimed); }
      if (r.score !== tc.claimed) { honest.scoreMismatch++; fail('honest score ' + r.score + ' != claimed ' + tc.claimed + ' ' + r.reasons.join('; ')); }
      if (tc.log === sim.log) {
        if (r.stats.ivN >= SN.RV.IV_N) tails.ivMad.push(r.stats.ivMadMs);
        if (r.stats.hits >= SN.RV.ACC_N) tails.offMad.push(r.stats.offMadMs);
        if (r.stats.clockRatio != null && sim.streak >= SN.RV.SLOW_N && !r.stats.coarseClock) tails.ratio.push(r.stats.clockRatio);
        if (r.stats.gapsP != null) {                // the stat is rounded to 3 dp: recompute
          const d = []; for (const e of tc.log.ev) if (e[0] === 'R') for (let j = 4; j < e.length; j++) d.push((e[j] - SN.GAP_MIN) / (SN.GAP_MAX - SN.GAP_MIN));
          tails.gapsP.push(Q.stats.ksUniform(d).p);
        }
      }
    }
    maxScore = Math.max(maxScore, sim.streak); sumScore += sim.streak; maxEv = Math.max(maxEv, sim.log.ev.length);
    maxBytes = Math.max(maxBytes, JSON.stringify(sim.log).length);
    if (keep.length < 600) keep.push({ sim, o });
  }
  const rate = honest.review / honest.runs;
  console.log(`honest: ${honest.runs} checks (${N_HONEST} runs, ${pausedRuns} with pauses), invalid ${honest.invalid}, review ${honest.review} (${(rate * 100).toFixed(3)}%), score mismatch ${honest.scoreMismatch}; mean score ${(sumScore / N_HONEST).toFixed(1)}, max ${maxScore}, max events ${maxEv}, max bytes ${maxBytes}, rounds started on Resume ${stuckN}`);
  const lo = (a, k) => a.length ? Math.min(...a).toFixed(k) : '-';
  console.log(`  lowest over honest runs: ivMad ${lo(tails.ivMad, 2)} ms (n=${tails.ivMad.length}, threshold ${SN.RV.IV_MAD}), offMad ${lo(tails.offMad, 2)} ms (n=${tails.offMad.length}, threshold ${SN.RV.ACC_MAD}), clockRatio ${lo(tails.ratio, 3)} (n=${tails.ratio.length}, threshold ${SN.RV.SLOW_RATIO}), gapsP ${tails.gapsP.length ? Math.min(...tails.gapsP).toExponential(1) : '-'} (threshold ${SN.RV.KS_ALPHA})`);
  if (honest.invalid || honest.scoreMismatch || rate > 0.001) { failures++; console.log('  FAIL honest suite (review rate must be <= 0.1%)'); }
  if (!stuckN) fail('honest: no round was started on Resume (the paused-timer path went untested)');
}

// a2) long runs by the best players, into max difficulty (hundreds of rounds)
{
  const rng = mulberry32(4711);
  const st = { runs: 0, invalid: 0, review: 0, mism: 0, maxS: 0, maxBytes: 0, minIv: Infinity, minOff: Infinity };
  for (let n = 0; n < +(process.env.NL || 60); n++) {
    const o = Object.assign(honestOpts(rng), { mob: rng() < 0.2, comp: rng() < 0.5, key: true, sd: uni(rng, 5, 12), drift: uni(rng, 0, 4), bias: 6 * normal(rng),
      lapseP: 0.0005, forgetP: 0, maxRounds: 400, walkAway: true, maxWall: 4 * 3600 * 1000,
      ping: 0, hz: pick(rng, [60, 144, 240]), dropP: 0.0002, taskRate: 1 / 600000, jankP: 0.01, doubleP: 0 });   // a machine that seldom hitches
    const sim = simulate(rng, o);
    const r = runCheck(sim.log, sim.streak);
    st.runs++; st.maxS = Math.max(st.maxS, sim.streak); st.maxBytes = Math.max(st.maxBytes, JSON.stringify(sim.log).length);
    if (r.stats.ivMadMs != null && r.stats.ivN >= SN.RV.IV_N) st.minIv = Math.min(st.minIv, r.stats.ivMadMs);
    if (r.stats.offMadMs != null && r.stats.hits >= SN.RV.ACC_N) st.minOff = Math.min(st.minOff, r.stats.offMadMs);
    if (r.verdict === 'invalid') { st.invalid++; fail('long honest run invalid: ' + r.reasons.join('; ')); }
    else if (r.verdict === 'review') { st.review++; console.log('  long honest run review: ' + r.reasons.join('; ') + ' sd=' + o.sd.toFixed(1)); }
    if (r.score !== sim.streak) { st.mism++; fail('long honest run score ' + r.score + ' != ' + sim.streak); }
  }
  console.log(`long runs (best players, sigma 5-12 ms): ${st.runs} runs, invalid ${st.invalid}, review ${st.review}, mismatch ${st.mism}; best ${st.maxS} rounds, max log ${st.maxBytes} bytes; lowest ivMad ${st.minIv.toFixed(1)} ms, lowest offMad ${st.minOff.toFixed(1)} ms`);
  if (st.review > 0) fail('long honest runs held for review');
}

// a2b) slow machines: 15 fps (67 ms frames, each dt clamped to 50) honestly
// runs the game clock at 75% of the wall; that must stay valid
{
  const rng = mulberry32(1515);
  let n = 0, rev = 0, inv = 0, minRatio = Infinity;
  for (let i = 0; i < 40; i++) {
    const o = Object.assign(honestOpts(rng), { hz: 15, sd: uni(rng, 8, 20), lapseP: 0.002, forgetP: 0, doubleP: 0, maxRounds: 60, walkAway: true, quantum: 0, taskRate: 0, dropP: 0.002 });
    const sim = simulate(rng, o);
    const r = runCheck(sim.log, sim.streak);
    if (sim.streak < SN.RV.SLOW_N) continue;
    n++; minRatio = Math.min(minRatio, r.stats.clockRatio);
    if (r.verdict === 'invalid') { inv++; fail('15 fps honest run invalid: ' + r.reasons.join('; ')); }
    else if (r.verdict === 'review') { rev++; fail('15 fps honest run held: ' + r.reasons.join('; ')); }
  }
  console.log(`15 fps machines: ${n} runs of ${SN.RV.SLOW_N}+ rounds, invalid ${inv}, review ${rev}; lowest clock ratio ${minRatio.toFixed(3)} (threshold ${SN.RV.SLOW_RATIO})`);
  if (n < 10) fail('15 fps: too few runs long enough to test the clock ratio (' + n + ')');
}

// a3) a run long enough to fill the log (MAX_EVENTS): the size stays under
// MAX_BYTES with room for the ticket, and the full log still checks out (it
// proves fewer rounds than the claim, which only a full log may do)
{
  const rng = mulberry32(99);
  const o = Object.assign(honestOpts(rng), { comp: true, mob: false, key: true, sd: 4, drift: 0, bias: 0, lapseP: 0, forgetP: 0, doubleP: 0,
    pauseRate: 0, quantum: 0, ping: 0, hz: 144, dropP: 0, taskRate: 0, jankP: 0, maxRounds: 5000, walkAway: true, maxWall: 12 * 3600 * 1000 });
  const sim = simulate(rng, o);
  const bytes = JSON.stringify({ ticket: 'x'.repeat(200), attempt: 0, log: sim.log }).length;
  const r = runCheck(sim.log, sim.streak);
  const tHours = sim.log.ev[sim.log.ev.length - 1][1] / 3600000;
  console.log(`full log: ${sim.streak} rounds played, ${sim.log.ev.length} events, ${bytes} bytes with the envelope (limit ${Q.LIMITS.MAX_BYTES}), ${tHours.toFixed(2)} h; check: ${r.verdict}, proves ${r.score} of ${sim.streak}`);
  if (sim.log.ev.length < Q.LIMITS.MAX_EVENTS) fail('full log: the run did not fill the log (' + sim.log.ev.length + ' events)');
  if (bytes > Q.LIMITS.MAX_BYTES - 16384) fail('full log: ' + bytes + ' bytes, too close to MAX_BYTES');
  if (r.verdict === 'invalid' || r.score < 1000) fail('full log: ' + r.verdict + ' ' + r.score + ' ' + r.reasons.join('; '));
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
function bestKeep(pred) { return keep.filter(k => pred(k)).sort((a, b) => b.sim.streak - a.sim.streak)[0]; }
function zoneOf(s, comp) { return { x: ZS, w: SN.zoneW(s, comp) }; }
function roundGeom(R0, comp) {                        // from a logged R: speed, zone, marker starts
  const s = R0[2], n = R0[3], gaps = R0.slice(4, 4 + n - 1);
  return { s, n, gaps, v: SN.speed(s, comp), z: zoneOf(s, comp), x0: SN.starts(gaps, n) };
}
{
  const rng = mulberry32(999);
  const good = bestKeep(k => k.sim.streak >= 15 && !k.o.quantum && !k.sim.log.ev.some(e => e[0] === 'P'));
  const base = good.sim.log, claim = good.sim.streak, bcomp = /-comp$/.test(base.type);
  const endMiss = bestKeep(k => { const ev = k.sim.log.ev; const l = ev[ev.length - 1]; return l && l[0] === 'E' && l[2] === 'zone' && k.sim.streak >= 5; });
  const endSlow = bestKeep(k => { const ev = k.sim.log.ev; const l = ev[ev.length - 1]; return l && l[0] === 'E' && l[2] === 'slow' && k.sim.streak >= 3; });
  console.log(`  forgery bases: ${base.type} ${claim} rounds / ${base.ev.length} events; zone miss at ${endMiss.sim.streak}; too slow at ${endSlow ? endSlow.sim.streak : '-'}`);

  // 1. no events + a claim
  expectCaught('no events + claim', { v: 1, rv: 1, type: 'sword-new', a: 0, env: { w: 1280, h: 700, mob: false, ping: 0 }, ev: [] }, 25);
  // 2. claim above the logged points
  expectCaught('claim above logged points', base, claim + 10);
  // 3. times compressed
  { const l = clone(base); l.ev.forEach(e => { e[1] = Math.round(e[1] * 0.5); }); expectCaught('honest log, times x0.5', l, claim); }
  { const l = clone(base); l.ev.forEach(e => { e[1] = Math.round(e[1] * 0.8); }); expectCaught('honest log, times x0.8', l, claim); }
  // 4. invented hits: a logged miss marked as a hit
  {
    const l = clone(endMiss.sim.log); const k = l.ev[l.ev.length - 2]; k[5] = 1; l.ev.pop();
    expectCaught('miss flipped to hit', l, endMiss.sim.streak + 1, { frac: endMiss.sim.streak / (endMiss.sim.streak + 1) });
    const l2 = clone(endMiss.sim.log); l2.ev[l2.ev.length - 2][5] = 1;
    expectCaught('miss flipped to hit, end kept', l2, endMiss.sim.streak);
  }
  { // a miss rewritten as a centred hit: its game time moved to the zone, its
    // press time kept. Caught when the move is beyond the clock tolerance; a
    // near miss moved a few ms is a script writing its own log (known limit).
    const cands = [];
    for (const k of keep) {
      const ev = k.sim.log.ev, l = ev[ev.length - 1];
      if (!l || l[0] !== 'E' || l[2] !== 'zone' || k.sim.streak < 3) continue;
      const K = ev[ev.length - 2], g = roundGeom(ev.filter(e => e[0] === 'R').pop(), /-comp$/.test(k.sim.log.type));
      const gt = ((g.z.x + g.z.w / 2 - MW / 2) - g.x0[K[2]]) / g.v * 1000;
      cands.push({ k, gt, move: gt - K[4] });
    }
    cands.sort((a, b) => b.move - a.move);
    const rewrite = c => { const l = clone(c.k.sim.log); l.ev.pop(); const K = l.ev[l.ev.length - 1]; const g = roundGeom(l.ev.filter(e => e[0] === 'R').pop(), /-comp$/.test(l.type)); K[4] = r4(c.gt); K[3] = r4(SN.pos(g.x0[K[2]], g.v, c.gt)); K[5] = 1; return l; };
    const far = cands.find(c => c.move >= 300), near = cands.filter(c => c.move > 0).pop();
    if (far) { const s = far.k.sim.streak, lastOfRound = far.k.sim.log.ev[far.k.sim.log.ev.length - 2][2] === SN.markers(s, /-comp$/.test(far.k.sim.log.type)) - 1;
      expectCaught('miss rewritten as a centred hit, game time moved ' + Math.round(far.move) + ' ms, press time kept', rewrite(far), s + (lastOfRound ? 1 : 0), lastOfRound ? { frac: s / (s + 1) } : null); }
    { // the same, built: a round's first press logged 300 ms before its marker could have reached the zone
      const l = clone(base); const Rs = l.ev.filter(e => e[0] === 'R'); const R5 = Rs[5];
      const K = l.ev.find((e, i) => i > l.ev.indexOf(R5) && e[0] === 'K');
      K[1] = Math.max(R5[1], R5[1] + Math.round(K[4]) - 300);
      expectCaught('an early press logged as a hit (game time 300 ms ahead of its press)', l, claim);
    }
    if (near) { const r = runCheck(rewrite(near), near.k.sim.streak); console.log('  known limit - a near miss rewritten as a hit (game time moved ' + Math.round(near.move) + ' ms): ' + r.verdict); }
  }
  if (endSlow) { // a "too slow" end replaced by a hit on the zone
    const l = clone(endSlow.sim.log); const E = l.ev.pop(); const g = roundGeom(l.ev.filter(e => e[0] === 'R').pop(), /-comp$/.test(l.type));
    const gt = r4(((g.z.x + g.z.w / 2 - MW / 2) - g.x0[E[3]]) / g.v * 1000);
    l.ev.push(['K', E[1], E[3], r4(SN.pos(g.x0[E[3]], g.v, gt)), gt, 1]);
    expectCaught('"too slow" end replaced by a hit', l, endSlow.sim.streak + 1, { frac: endSlow.sim.streak / (endSlow.sim.streak + 1) });
  }
  // 5. edited draws / targets outside the rules
  { const l = clone(base); const R0 = l.ev.find(e => e[0] === 'R'); R0[4] = 0.45; expectCaught('gap above range', l, claim); }
  { const l = clone(base); const R0 = l.ev.find(e => e[0] === 'R'); R0[4] = 0.15; expectCaught('gap below range', l, claim); }
  { const l = clone(base); const R0 = l.ev.filter(e => e[0] === 'R')[4]; R0[5] = r4(Math.min(0.38, R0[5] + 0.05)); expectCaught('one gap edited in range (markers not where the log says)', l, claim); }
  { const l = clone(base); const Rs = l.ev.filter(e => e[0] === 'R'); const Rx = Rs[Rs.length - 1]; Rx[3] -= 1; Rx.pop(); expectCaught('one marker fewer than the streak makes', l, claim); }
  { const l = clone(base); const Rs = l.ev.filter(e => e[0] === 'R'); const Rx = Rs[Rs.length - 1]; Rx[3] += 1; Rx.push(0.3); expectCaught('one marker more than the streak makes', l, claim); }
  { const l = clone(base); l.type = bcomp ? 'sword-new' : 'sword-new-comp'; expectCaught('mode swapped', l, claim); }
  { const l = clone(base); const Rs = l.ev.filter(e => e[0] === 'R'); Rs[3][2] = 9; expectCaught('round logged with the wrong streak', l, claim); }
  // 6. cherry-picked easiest draws (widest gaps only), otherwise honest play
  {
    const o = Object.assign(honestOpts(mulberry32(7)), { comp: false, mob: false, sd: 25, drift: 5, bias: 0, lapseP: 0, forgetP: 0, doubleP: 0, pauseRate: 0, maxRounds: 30, walkAway: true, quantum: 0, hz: 60, dropP: 0.003, key: true, ping: 0 });
    const g = mulberry32(8); o.gapRng = () => 0.9 + 0.1 * g();
    const sim = simulate(mulberry32(9), o);
    expectCaught('cherry-picked widest gaps (score ' + sim.streak + ')', sim.log, sim.streak);
  }
  // 7. perfect bot on the real client: presses at the predicted ideal moment,
  //    judged on the last drawn frame (the moment falls between frames)
  for (const hz of [60, 144, 240]) {
    const sim = simulate(mulberry32(11 + hz), botOpts(mulberry32(10 + hz), { comp: true, mob: false, hz, dropP: 0.002, maxRounds: 40 }));
    expectCaught('perfect bot, real client ' + hz + ' Hz (score ' + sim.streak + ')', sim.log, sim.streak);
  }
  { const sim = simulate(mulberry32(31), botOpts(mulberry32(30), { comp: false, mob: true, key: false, hz: 60, dropP: 0.004, maxRounds: 40 }));
    expectCaught('perfect bot, real mobile client (score ' + sim.streak + ')', sim.log, sim.streak); }
  { const sim = simulate(mulberry32(33), botOpts(mulberry32(32), { comp: false, hz: 60, dropP: 0.002, maxRounds: 40, key: true, ping: 150, adapt: 1 }));
    expectCaught('perfect bot, real client through the ping sim (score ' + sim.streak + ')', sim.log, sim.streak); }
  // 7b. perfect bot writing the log (marker centre on zone centre, clock kept consistent)
  { const l = forgePerfect(base, 0, () => 0); expectCaught('perfect bot, forged log', l, claim); }
  { const nr = mulberry32(5); const l = forgePerfect(base, 0, () => 0.6 * normal(nr)); expectCaught('near-perfect forged log (0.6 ms noise)', l, claim); }
  // inputs between frames: every press at its ideal instant, the marker judged
  // on a 60 Hz frame before it (game time off the frame grid is not checked;
  // the press rhythm gives it away)
  { const nr = mulberry32(6); const l = forgePerfect(base, 0, () => -nr() * 16.67, true); expectCaught('presses between frames at the ideal instants (forged log)', l, claim); }
  // 8. metronome bot: a press every 300 ms from each round start
  {
    expectCaught('metronome bot (honest outcomes)', forgeMetronome(rng, false, 300), 30);
    expectCaught('metronome bot (outcomes marked hit)', forgeMetronome(rng, true, 300), 30);
  }
  // 8b. constant-lag bot: every press 25 ms after the ideal moment, exact
  { const l = forgePerfect(base, 25, () => 0); expectCaught('constant-lag bot (25 ms late, no spread)', l, claim); }
  // 9. superhuman reactions: first press of each round logged 40 ms after the round starts
  {
    const l = clone(base);
    let tR = 0, first = false;
    for (const e of l.ev) {
      if (e[0] === 'R') { tR = e[1]; first = true; }
      else if (e[0] === 'K' && first) { e[1] = tR + 40; first = false; }
    }
    l.ev.sort((a, b) => a[1] - b[1]);
    expectCaught('superhuman reaction (first press 40 ms after round start)', l, claim);
  }
  // 10. impossible order with fine times
  { const l = clone(base); const ks = l.ev.filter(e => e[0] === 'K'); const a = ks[1], b = ks[2]; const t = a[2]; a[2] = b[2]; b[2] = t; expectCaught('two presses swapped marker indices', l, claim); }
  { const l = clone(base); const i = l.ev.findIndex(e => e[0] === 'K'); const kk = l.ev.splice(i, 1)[0]; kk[1] = 0; l.ev.unshift(kk); expectCaught('press before any round', l, claim); }
  { const l = clone(base); const ri = l.ev.findIndex((e, i) => e[0] === 'R' && i > 0); l.ev[ri][1] = l.ev[ri - 1][1] + 100; expectCaught('next round 100 ms after the last hit', l, claim); }
  { const l = clone(base); const ki = l.ev.findIndex(e => e[0] === 'K'); l.ev.splice(ki, 0, ['P', l.ev[ki][1]]); l.ev.splice(ki + 2, 0, ['U', l.ev[ki + 1][1]]); expectCaught('press while paused', l, claim); }
  { const l = clone(base); const ri = l.ev.findIndex((e, i) => e[0] === 'R' && i > 0); const k2 = l.ev.findIndex((e, i) => i > ri && e[0] === 'K' && e[2] === 1); const r2 = clone(l.ev[ri]); r2[1] = l.ev[k2][1]; l.ev.splice(k2 + 1, 0, r2); expectCaught('a second round started mid-round', l, claim); }
  { const l = clone(endMiss.sim.log); const c = /-comp$/.test(l.type); const s = endMiss.sim.streak, n = SN.markers(s, c); const last = l.ev[l.ev.length - 1][1]; l.ev.push(['R', last + 900, s, n, ...new Array(n - 1).fill(0.3)]); expectCaught('events after the end', l, s + 1, { frac: s / (s + 1) }); }
  { const l = clone(base); const ki = l.ev.findIndex(e => e[0] === 'K'); l.ev.splice(ki, 1); expectCaught('a press removed (marker skipped)', l, claim); }
  { const l = clone(base); const ki = l.ev.findIndex(e => e[0] === 'K' && e[2] === 0); l.ev[ki][2] = 1; expectCaught('the first press logged on the second marker', l, claim); }
  // 11. replayed honest log, higher claim
  expectCaught('replayed honest log, claim x2', base, claim * 2);
  { const sp = good.sim.snaps[Math.floor(good.sim.snaps.length / 2)]; expectCaught('replayed half-way snapshot, full claim', prefix(base, sp.len), claim); }
  // 12. trainer specific
  { const l = clone(base); const k = l.ev.find(e => e[0] === 'K'); k[4] = r4(k[4] * 0.5); expectCaught('marker x not reachable in its game time', l, claim); }
  { // speed hack: markers really moved at 80% speed; x and game time logged as they were
    const l = clone(base); let g = null;
    for (const e of l.ev) {
      if (e[0] === 'R') g = roundGeom(e, bcomp);
      else if (e[0] === 'K') e[4] = r4((e[3] - g.x0[e[2]]) / (0.8 * g.v) * 1000);
    }
    expectCaught('speed hack (markers at 80%, x and game time as seen)', l, claim);
  }
  { // slow motion: rAF timestamps at half speed, the player gets twice the time
    const o = Object.assign(honestOpts(mulberry32(21)), { comp: true, mob: false, sd: 30, drift: 5, bias: 0, lapseP: 0.005, forgetP: 0, doubleP: 0, pauseRate: 0, maxRounds: 40, walkAway: true, quantum: 0, hz: 60, dropP: 0.003, key: true, ping: 0, slowMo: 0.5 });
    const sim = simulate(mulberry32(22), o);
    expectCaught('slow-motion client (game clock x0.5, score ' + sim.streak + ')', sim.log, sim.streak);
    const o2 = Object.assign({}, o, { slowMo: 0.6 });
    const sim2 = simulate(mulberry32(23), o2);
    expectCaught('slow-motion client (game clock x0.6, score ' + sim2.streak + ')', sim2.log, sim2.streak);
  }
  { // wall clock compressed so the rounds come back to back
    const l = clone(base); let off = 0, prevT = 0; for (const e of l.ev) { if (e[0] === 'R' && e[1] > 0) { off += Math.min(600, e[1] - prevT - 150); } prevT = e[1]; e[1] -= off; }
    expectCaught('pending time between rounds cut', l, claim);
  }
  { const l = clone(base); const k = l.ev.filter(e => e[0] === 'K')[3]; k[3] = r4(k[3] + 0.3); expectCaught('logged x moved into nowhere', l, claim); }
  { const l = clone(base); const k = l.ev.filter(e => e[0] === 'K')[5]; k[3] = r4(k[3] + 0.001); expectCaught('logged x nudged 0.001 of the track', l, claim); }
  { // a pause whose U comes late swallows wall time: game time must still fit
    const l = clone(base); const ki = l.ev.findIndex((e, i) => i > 5 && e[0] === 'K'); const t = l.ev[ki][1]; l.ev.splice(ki, 0, ['P', t - 1500], ['U', t - 1]); l.ev.sort((a, b) => a[1] - b[1]);
    expectCaught('fake pause inside a round (hides reaction time)', l, claim);
  }
  { // "too slow" forged while the marker is still short of the zone's end
    const l = clone(base); const ri = l.ev.map(e => e[0]).lastIndexOf('R');
    const cut = l.ev.slice(0, ri + 1); const R0 = cut[ri]; const g = roundGeom(R0, bcomp);
    const gs = r4((ZS - 0.05 - g.x0[0]) / g.v * 1000);          // marker 0 just short of the zone
    cut.push(['E', R0[1] + Math.ceil(gs) + 10, 'slow', 0, r4(SN.pos(g.x0[0], g.v, gs)), gs]);
    expectCaught('"too slow" end with the marker still before the zone', { ...l, ev: cut }, claim);
  }
  { // the timer end forged early
    const l = clone(base); const ri = l.ev.map(e => e[0]).lastIndexOf('R');
    const cut = l.ev.slice(0, ri + 1); cut.push(['E', cut[ri][1] + 1000, 'time', 990]);
    expectCaught('timer end 990 ms into a 3400 ms timer', { ...l, ev: cut }, claim);
  }
  { // a press after the timer: a whole extra 3.4 s of game time in one round
    const l = clone(base); const k = l.ev.filter(e => e[0] === 'K')[2]; const g = roundGeom(l.ev.filter((e, i) => e[0] === 'R' && i < l.ev.indexOf(k)).pop(), bcomp);
    k[4] = r4(k[4] + 3400); k[3] = r4(SN.pos(g.x0[k[2]], g.v, k[4]));
    expectCaught('press 3.4 s later in game time than it was', l, claim);
  }
  { // game time runs backwards between two presses
    const l = clone(base); const ks = l.ev.filter(e => e[0] === 'K' && e[2] >= 1); const k = ks[4]; const g = roundGeom(l.ev.filter((e, i) => e[0] === 'R' && i < l.ev.indexOf(k)).pop(), bcomp);
    k[4] = r4(k[4] - 400); k[3] = r4(SN.pos(g.x0[k[2]], g.v, k[4])); k[5] = SN.inZone(k[3], ZS, g.z.w) ? 1 : 0;
    expectCaught('game time 400 ms back between two presses', l, claim);
  }
  // 13. duplicates, identical timings, stretched time
  { const l = clone(base); const ki = l.ev.findIndex(e => e[0] === 'K' && e[5] === 1); l.ev.splice(ki + 1, 0, clone(l.ev[ki])); expectCaught('a hit logged twice', l, claim); }
  { const l = clone(base); const ri = l.ev.findIndex(e => e[0] === 'R'); l.ev.splice(ri + 1, 0, clone(l.ev[ri])); expectCaught('a round logged twice', l, claim); }
  { // every press of a round logged at the time of the round's last press
    const l = clone(base); let ks = [];
    const flush = () => { if (ks.length) { const tl = ks[ks.length - 1][1]; ks.forEach(k => { k[1] = tl; }); } ks = []; };
    for (const e of l.ev) { if (e[0] === 'R') flush(); else if (e[0] === 'K') ks.push(e); else if (e[0] === 'P' || e[0] === 'U') ks = []; }
    flush();
    expectCaught('identical timings (a round\'s presses all at one time)', l, claim);
  }
  { const l = clone(base); l.ev.forEach(e => { e[1] *= 2; }); expectCaught('honest log, times x2 (stretched)', l, claim); }
  // 14. huge, negative, NaN-like and wrongly typed fields
  const mutate = (name, fn, cl) => { const l = clone(base); fn(l); expectCaught(name, l, cl == null ? claim : cl); };
  const firstK = l => l.ev.find(e => e[0] === 'K'), firstR = l => l.ev.find(e => e[0] === 'R');
  mutate('huge x', l => { firstK(l)[3] = 1e300; });
  mutate('huge game time', l => { const k = firstK(l); k[4] = 1e12; k[3] = r4(-MW + SN.speed(0, bcomp) * 1e9); });
  mutate('huge streak', l => { firstR(l)[2] = 1e9; });
  mutate('huge marker count', l => { firstR(l)[3] = 1e9; });
  mutate('huge gap', l => { firstR(l)[4] = 1e308; });
  mutate('negative gap', l => { firstR(l)[5] = -0.3; });
  mutate('negative game time', l => { const k = firstK(l); k[4] = -500; });
  mutate('negative marker index', l => { firstK(l)[2] = -1; });
  mutate('negative streak', l => { firstR(l)[2] = -1; });
  mutate('fractional marker index', l => { firstK(l)[2] = 0.5; });
  mutate('NaN-like string gap', l => { firstR(l)[4] = 'NaN'; });
  mutate('numeric-string x', l => { const k = firstK(l); k[3] = String(k[3]); });
  mutate('string hit flag', l => { firstK(l)[5] = '1'; });
  mutate('boolean hit flag', l => { firstK(l)[5] = true; });
  mutate('string streak', l => { firstR(l)[2] = '0'; });
  mutate('null marker count', l => { firstR(l)[3] = null; });
  mutate('object field', l => { firstK(l)[3] = { x: 1 }; });
  mutate('Infinity-like huge time', l => { firstK(l)[1] = 1e15; });
  mutate('a round start removed (presses fall into the last round)', l => { const ri = l.ev.map(e => e[0]).indexOf('R', 3); l.ev.splice(ri, 1); });
  mutate('a hit logged as a miss', l => { const k = l.ev.find(e => e[0] === 'K'); k[5] = 0; });
  mutate('a press with an extra field', l => { firstK(l).push(1); });
  mutate('a pause with a field', l => { const ki = l.ev.findIndex(e => e[0] === 'K'); l.ev.splice(ki, 0, ['P', l.ev[ki][1], 0], ['U', l.ev[ki][1]]); });
  mutate('unknown event code', l => { const ki = l.ev.findIndex(e => e[0] === 'K'); l.ev.splice(ki, 0, ['Z', l.ev[ki][1], 900]); });
  mutate('unknown end reason', l => { l.ev.push(['E', l.ev[l.ev.length - 1][1] + 10, 'quit']); });
  // 15. a script that writes the whole log itself, gaps reused every round
  { const g = mulberry32(61); const fixed = [0, 1, 2, 3, 4, 5, 6].map(() => r4(0.22 + 0.16 * g()));
    const l = forgeHuman(mulberry32(62), 60, () => fixed, 15);
    expectCaught('forged log, one set of gaps reused every round (score ' + l.score + ')', l.log, l.score); }
  { const l = forgeHuman(mulberry32(64), 60, n => new Array(n).fill(0.38), 15);
    expectCaught('forged log, every gap the widest (score ' + l.score + ')', l.log, l.score); }
  // 16. pauses as a loophole: a 0 ms P/U after every hit must not hide the
  //     press rhythm, nor buy game time
  { const sim = simulate(mulberry32(71), botOpts(mulberry32(70), { comp: false, hz: 60, dropP: 0.002, maxRounds: 40 }));
    const l = withPauses(clone(sim.log), 0); expectCaught('perfect bot + 0 ms pause after every hit (score ' + sim.streak + ')', l, sim.streak); }
  { const sim = simulate(mulberry32(73), botOpts(mulberry32(72), { comp: false, hz: 60, dropP: 0.002, maxRounds: 40 }));
    const l = withPauses(clone(sim.log), 250); expectCaught('perfect bot + 250 ms pause after every hit (score ' + sim.streak + ')', l, sim.streak); }
  { const l = withPauses(clone(base), 0); l.ev.forEach(e => { e[1] = Math.round(e[1] * 0.7); }); expectCaught('times x0.7 behind 0 ms pauses after every hit', l, claim); }
  // 17. envelope abuse (the core refuses these before the trainer's check runs)
  expectCore('log for another trainer (sword) sent as sword-new', 'sword-new', Object.assign(clone(base), { type: 'sword' }), claim);
  expectCore('casual log sent as comp', bcomp ? 'sword-new' : 'sword-new-comp', clone(base), claim);
  expectCore('unknown trainer type', 'sword-newer', clone(base), claim);
  expectCore('log version 2', base.type, Object.assign(clone(base), { v: 2 }), claim);
  expectCore('negative attempt number', base.type, Object.assign(clone(base), { a: -1 }), claim);
  expectCore('log is an array', base.type, clone(base.ev), claim);
  expectCore('env with too many fields', base.type, Object.assign(clone(base), { env: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 } }), claim);
  expectCore('env with a long string', base.type, Object.assign(clone(base), { env: { w: 'x'.repeat(40) } }), claim);
  expectCore('env with an object', base.type, Object.assign(clone(base), { env: { w: { x: 1 } } }), claim);
  { const l = clone(base); l.ev[1][0] = 'KKKK'; expectCore('event with a long code', base.type, l, claim); }
  { const l = clone(base); l.ev[1] = l.ev[1].concat(new Array(14).fill(0)); expectCore('event with too many fields', base.type, l, claim); }
  { const l = clone(base); l.ev[2][1] += 0.5; expectCore('event at a fractional time', base.type, l, claim); }
  { const l = clone(base); l.ev[3][1] = l.ev[2][1] - 50; expectCore('event going back in time', base.type, l, claim); }
  { const l = clone(base); l.ev[1][1] = Q.LIMITS.MAX_T + 1; for (let i = 2; i < l.ev.length; i++) l.ev[i][1] = Q.LIMITS.MAX_T + 1; expectCore('times past the twelve-hour limit', base.type, l, claim); }
  { const l = clone(base); while (l.ev.length <= Q.LIMITS.MAX_EVENTS) l.ev.push(['U', l.ev[l.ev.length - 1][1]]); expectCore('more than MAX_EVENTS events', base.type, l, claim); }
  { const l = clone(base); l.ev[1][2] = 'x'.repeat(40); expectCore('a long string field', base.type, l, claim); }
  { const l = clone(base); l.ev[1][3] = [1, 2]; expectCore('an array field', base.type, l, claim); }
}

// A script writing the log itself: fresh gaps (or the given ones), presses at
// the ideal moment plus Gaussian error of sdMs, times kept consistent.
function forgeHuman(rng, rounds, gapsFn, sdMs) {
  const log = { v: 1, rv: 1, type: 'sword-new', a: 0, env: { w: 1280, h: 700, mob: false, ping: 0 }, ev: [] };
  let t = 0, s = 0;
  for (let r = 0; r < rounds; r++) {
    const n = SN.markers(s, false), v = SN.speed(s, false), z = zoneOf(s, false);
    const gs = gapsFn ? gapsFn(n) : null;
    const gaps = []; for (let k = 0; k < n - 1; k++) gaps.push(gs ? gs[k % gs.length] : SN.drawGap(rng()));
    log.ev.push(['R', t, s, n, ...gaps]);
    const x0 = SN.starts(gaps, n);
    let ok = true, tl = t, pg = 0;
    for (let k = 0; k < n; k++) {
      const gT = Math.max(pg, r4(((z.x + z.w / 2 - MW / 2) - x0[k]) / v * 1000 + sdMs * normal(rng)));
      const x = r4(SN.pos(x0[k], v, gT)), hit = SN.inZone(x, z.x, z.w);
      tl = Math.max(tl, t + Math.ceil(gT) + 8); pg = gT;
      log.ev.push(['K', tl, k, x, gT, hit ? 1 : 0]);
      if (!hit) { log.ev.push(['E', tl, 'zone']); ok = false; break; }
    }
    if (!ok) break;
    s++; t = tl + 805;
  }
  return { log, score: s };
}
// Rewrite every press in an honest log to land at the ideal moment + lag,
// with the game time that puts it there (and the clock kept consistent).
// wallIdeal: the press time is the ideal instant itself (a bot pressing on the
// moment, judged on an earlier frame): t = R + ideal + 20.
function forgePerfect(src, lagMs, noise, wallIdeal) {
  const l = clone(src);
  const comp = /-comp$/.test(l.type);
  let g = null, tR = 0;
  for (const e of l.ev) {
    if (e[0] === 'R') { g = roundGeom(e, comp); tR = e[1]; }
    else if (e[0] === 'K') {
      const ideal = ((g.z.x + g.z.w / 2 - MW / 2) - g.x0[e[2]]) / g.v * 1000 + lagMs;
      const gT = ideal + noise();
      e[4] = r4(gT); e[3] = r4(SN.pos(g.x0[e[2]], g.v, gT)); e[5] = SN.inZone(e[3], g.z.x, g.z.w) ? 1 : 0;
      if (wallIdeal) e[1] = Math.round(tR + ideal + 20);
    }
  }
  // drop everything after the first miss the rewrite made, and a stale end
  const out = [];
  for (const e of l.ev) {
    if (e[0] === 'E') continue;
    out.push(e);
    if (e[0] === 'K' && e[5] === 0) { out.push(['E', e[1], 'zone']); break; }
  }
  l.ev = out;
  // keep the clock ahead of game time: a press's t >= its round's R t + gT
  let shift = 0; tR = 0;
  for (const e of l.ev) {
    e[1] += shift;
    if (e[0] === 'R') tR = e[1];
    if (e[0] === 'K' && e[1] < tR + e[4]) { const d = Math.ceil(tR + e[4] - e[1]); shift += d; e[1] += d; }
  }
  return l;
}
function forgeMetronome(rng, markHit, period) {
  const l = { v: 1, rv: 1, type: 'sword-new', a: 0, env: { w: 1280, h: 700, mob: false, ping: 0 }, ev: [] };
  let t = 0, s = 0;
  for (let round = 0; round < 30; round++) {
    const n = SN.markers(s, false), v = SN.speed(s, false), z = zoneOf(s, false);
    const gaps = []; for (let k = 0; k < n - 1; k++) gaps.push(SN.drawGap(rng()));
    l.ev.push(['R', t, s, n, ...gaps]);
    const x0 = SN.starts(gaps, n);
    let ok = true;
    for (let k = 0; k < n; k++) {
      const gT = period * (k + 2);
      const x = r4(SN.pos(x0[k], v, gT));
      const hit = SN.inZone(x, z.x, z.w);
      l.ev.push(['K', t + gT, k, x, gT, markHit ? 1 : (hit ? 1 : 0)]);
      if (!hit && !markHit) { l.ev.push(['E', t + gT, 'zone']); ok = false; break; }
    }
    if (!ok) break;
    s++; t += period * (n + 2) + 900;
  }
  return l;
}
// ['P', t] ['U', t + durMs] after every hit that is not a round's last,
// shifting later events by durMs
function withPauses(l, durMs) {
  const out = []; let shift = 0, n = 0, left = 0;
  for (const e0 of l.ev) {
    const e = e0.slice(); e[1] += shift; out.push(e);
    if (e[0] === 'R') left = e[3];
    if (e[0] === 'K' && e[5] === 1 && --left > 0) { out.push(['P', e[1]], ['U', e[1] + durMs]); shift += durMs; n++; }
  }
  l.ev = out;
  return l;
}
const caught = forg.filter(f => f.ok).length;
console.log(`forgeries: ${forg.length} built, ${caught} caught`);
for (const f of forg) console.log('  ' + (f.ok ? 'ok   ' : 'MISS ') + f.name + ': ' + f.verdict);
{ // the known limit: a script writing a whole log with fresh random gaps and
  // human-sized error (sigma 15 ms) cannot be told from a person by the log
  const l = forgeHuman(mulberry32(63), 60, null, 15);
  const r = runCheck(l.log, l.score);
  console.log('  known limit - forged log with fresh gaps and 15 ms of human error: ' + r.verdict + ', score ' + r.score + ' (the SQL clock and record checks are what bound it)');
}

// ── c) the real IIFE (sword-new.iife.js) in a fake DOM with a virtual clock ──
// Frames tick on vsync; a frame's callbacks get its vsync time as timestamp but
// may run late (a long task): events queued meanwhile (clicks, keys, timers)
// run first, which is how an honest Start/Resume meets a stale frame. Timers
// can be late, frames dropped, clocks coarse, keys delayed by the ping sim.
// The player watches the drawn canvas (never the closure: the track, the zone
// and the moving markers, found by their colours) and presses with human
// error. Every submit, and every run's whole log, is checked.
const IIFE_SRC = fs.readFileSync(path.join(__dirname, 'sword-new.iife.js'), 'utf8');
try { new Function(IIFE_SRC); console.log('iife: parses'); } catch (err) { fail('sword-new.iife.js does not parse: ' + err.message); }
{
  const lines = IIFE_SRC.replace(/\n$/, '').split('\n');
  if (lines[lines.length - 1] !== '})();' || lines.slice(0, -1).includes('})();')) fail('iife: the block must end with its only "})();" line');
}
// The colours the IIFE draws the track, the zone and the moving markers with.
const COL_TRACK = 'rgba(58,58,62,0.92)', COL_ZONE = 'rgba(138,196,190,0.95)', COL_MOVING = 'rgba(226,226,226,0.97)';
for (const c of [COL_TRACK, COL_ZONE, COL_MOVING]) if (IIFE_SRC.indexOf("'" + c + "'") < 0) fail('iife: the colour ' + c + ' the suite reads is not in the IIFE');

const iifeLogs = [];                                 // every run's log, with what the page showed
let runSerial = 0, iifeTicks = 0, iifeWall = 0;
(function () {
  const origStart = Q.Run.start;
  Q.Run.start = function () {
    const run = origStart.apply(this, arguments);
    run._serial = ++runSerial;
    iifeLogs.push({ run, cleared: 0, world: null });
    return run;
  };
})();
globalThis._playQteSfx = () => {};
globalThis._qteMatch = null;

function swordWorld(seed, o) {
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
    if (document.hidden) { if (cbs.size || o.continuous) { const e = at(now + 200, () => { if (!tickEv) scheduleTick(); }); void e; } return; }   // no frames in a hidden tab
    iifeTicks++;
    const list = [...cbs.values()]; cbs.clear();
    drawVT = V;
    for (const cb of list) cb(clk(V));
    drawVT = null;
    if (list.length) plan();
    if (cbs.size || o.continuous) scheduleTick();
  }
  const rafV = cb => { const id = ++rafId; cbs.set(id, cb); scheduleTick(); return id; };
  const cafV = id => { cbs.delete(id); };
  const perfV = { now: () => clk(now) };
  // DOM
  let streakCb = null;
  function el(id, tag) {
    let text = '';
    return {
      id, tagName: tag || 'DIV', style: { display: '' }, className: '', children: [], _h: {}, isContentEditable: false,
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      get textContent() { return text; },
      set textContent(v) { text = String(v); if (id === 'sword-new-qte-streak' && streakCb) streakCb(text); },
      appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
      addEventListener(type, fn) { (this._h[type] = this._h[type] || []).push(fn); },
      fire(type, ev) { (this._h[type] || []).slice().forEach(fn => fn(ev || { preventDefault() {} })); },
    };
  }
  const wrap = el('wrap'); wrap.clientWidth = o.clientW;
  const canvas = el('sword-new-qte-canvas', 'CANVAS');
  let cwv = 300;   // HTMLCanvasElement.width: unsigned long, out of range -> 300
  Object.defineProperty(canvas, 'width', { get: () => cwv, set: v => { const u = Number(v) >>> 0; cwv = u > 2147483647 ? 300 : u; } });
  canvas.height = 150;
  wrap.appendChild(canvas);
  let frameCur = null, frameSeen = null, draws = 0;
  const ctxImpl = {
    clearRect() { draws++; frameCur = { track: null, zone: null, moving: [], vT: drawVT }; if (drawVT != null) frameSeen = frameCur; },
    fillRect(x, y, w) {
      const f = frameCur; if (!f) return;
      const st = this.fillStyle;
      if (st === COL_TRACK) f.track = { x, w };
      else if (st === COL_ZONE) f.zone = { x, w };
      else if (st === COL_MOVING) f.moving.push(x + w);   // right edge (a marker is clipped at the left end)
    },
    createLinearGradient() { return { addColorStop() {} }; },
    measureText(t) { return { width: String(t).length * 7 }; },
  };
  const ctx = new Proxy(ctxImpl, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  canvas.getContext = () => ctx;
  const ids = {};
  ['sword-new-qte-status', 'sword-new-qte-streak', 'sword-new-qte-highscore', 'page-qte', 'qte-panel-sword-new'].forEach(id => { ids[id] = el(id); });
  ids['sword-new-qte-start-btn'] = el('sword-new-qte-start-btn', 'BUTTON');
  ids['sword-new-qte-resume-btn'] = el('sword-new-qte-resume-btn', 'BUTTON');
  ids['sword-new-tap-btn'] = el('sword-new-tap-btn', 'BUTTON');
  ids['sword-new-qte-canvas'] = canvas;
  ids['page-qte'].classList.add('active');
  const panel = ids['qte-panel-sword-new']; panel.style.display = 'flex';
  const startBtn = ids['sword-new-qte-start-btn'], resumeBtn = ids['sword-new-qte-resume-btn'], tapBtn = ids['sword-new-tap-btn'];
  resumeBtn.style.display = 'none'; tapBtn.style.display = 'none';
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
  globalThis._albPing = o.ping || 0;
  globalThis._qteCompMode = !!o.comp;
  const submits = [];
  globalThis._sbStartQteRun = () => Promise.resolve({ run: 'r', ticket: 't' });
  globalThis._sbSubmitScore = (type, score, packet) => { submits.push({ type, score, packet }); };
  Q.Run.current = null;
  const firstLog = iifeLogs.length;
  // the page's Math.random (the IIFE's gap draws) seeded, so a failure replays
  const realRandom = Math.random;
  Math.random = mulberry32(seed * 7919 + 13);

  new Function('window', 'document', 'localStorage', 'IS_MOBILE', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'performance', IIFE_SRC)(
    globalThis, document, localStorage, !!o.mob, setTimeoutV, clearTimeoutV, rafV, cafV, MO, perfV);
  const hide = globalThis._onSwordNewQteHide, show = globalThis._onSwordNewQteShow;
  if (typeof hide !== 'function' || typeof show !== 'function') { fail('iife: no show/hide hooks'); return { submits, logs: [] }; }
  if (!draws) fail('iife: nothing drawn at load');

  const cur = () => Q.Run.current;
  const entry = () => { const r = cur(); return r ? iifeLogs.find(x => x.run === r) : null; };
  streakCb = text => { const m = /Streak: (\d+)/.exec(text); const e = entry(); if (m && e) { e.cleared = Math.max(e.cleared, +m[1]); onClear(+m[1]); } };
  const fireWin = type => (winH[type] || []).slice().forEach(fn => fn({}));
  const fireDoc = (type, ev) => (docH[type] || []).slice().forEach(fn => fn(ev || {}));

  // the player
  let playing = false, away = false, done = false, runsStarted = 0;
  const planned = new Set(), follow = new Map(); let presses = [], hist = [];
  const W = {
    now: () => now, at, rng, o, cur, entry, canvas, startBtn, resumeBtn, tapBtn, panel, wrap, document,
    start() { startBtn.fire('click'); runsStarted++; playing = true; },
    resume() { resumeBtn.fire('click'); },
    hide() { hide(); panel.style.display = 'none'; killPresses(); },
    show() { panel.style.display = 'flex'; show(); },
    reshow() { show(); },                           // the open tab clicked again: the run plays on
    tabHide() { document.hidden = true; fireDoc('visibilitychange'); killPresses(); },
    tabShow() { document.hidden = false; fireDoc('visibilitychange'); if (!tickEv && (cbs.size || o.continuous)) scheduleTick(); },
    leavePage() { ids['page-qte'].classList.remove('active'); killPresses(); },
    backPage() { ids['page-qte'].classList.add('active'); },
    resize(w) { wrap.clientWidth = w; fireWin('resize'); },
    staleTick(ms) { if (tickEv) tickEv.dead = true; tickEv = null; const V = now - ms; tickEv = at(now + 1, () => runTick(V)); },
    stopPlaying() { playing = false; killPresses(); },
    press() { press(); },
    key(repeat) { fireDoc('keydown', { code: 'Space', key: ' ', repeat: !!repeat, preventDefault() {} }); },
    setDone() { done = true; },
  };
  function killPresses() { presses.forEach(e => { e.dead = true; }); presses = []; planned.clear(); follow.clear(); hist = []; }
  function press() {
    if (o.mob && !o.key) {
      const tgt = rng() < 0.5 && tapBtn.style.display !== 'none' ? tapBtn : canvas;
      tgt.fire('touchstart', { preventDefault() {} });
      return;
    }
    const e = { code: 'Space', key: ' ', repeat: false, preventDefault() {} };
    const dispatch = ev => fireDoc('keydown', ev);
    if (o.ping > 0) setTimeoutV(() => dispatch(Object.assign({}, e)), o.ping);   // core.js: swallowed, a copy later
    else dispatch(e);
  }
  function plan() {
    if (!playing || away || document.hidden || panel.style.display === 'none' || !ids['page-qte'].classList.contains('active')) return;
    const f = frameSeen; if (!f || f.vT == null || !f.track || !f.zone) return;
    const r = cur(); if (!r || r.closed) return;
    const ev = r.log.ev;
    let ri = -1; for (let i = ev.length - 1; i >= 0; i--) if (ev[i][0] === 'R') { ri = i; break; }
    if (ri < 0) return;
    let hits = 0; for (let i = ri + 1; i < ev.length; i++) if (ev[i][0] === 'K' && ev[i][5] === 1) hits++;
    const s = ev[ri][2], comp = /-comp$/.test(r.type);
    const tw = f.track.w, mwPx = Math.max(3, MW * tw);
    const zc = f.zone.x + f.zone.w / 2;
    // the speed the markers appear to move at: a person times what they see
    // (a coarse clock or dropped frames slow the game clock down)
    let v = SN.speed(s, comp) * tw;
    if (f.moving.length) {
      const lk = r._serial + ':' + ri + ':' + hits;
      hist = hist.filter(h => h.key === lk && f.vT - h.V <= 400);
      hist.push({ key: lk, V: f.vT, x: f.moving[0] });
      const h0 = hist[0], dT = f.vT - h0.V;
      if (dT >= 120 && f.moving[0] > h0.x) v = (f.moving[0] - h0.x) / dT * 1000;
    }
    // a player with the ping sim on learns to press that much early
    const pingAdj = o.key && o.ping ? o.adapt * o.ping : 0;
    const crossAt = xr => f.vT + (zc - (xr - mwPx / 2)) / v * 1000 - pingAdj;
    // follow the markers: a planned press still more than a motor delay away
    // moves with what this frame shows (a stalled frame pushes it later)
    for (const [key, p] of follow) {
      if (p.e.dead || p.e.t <= now) { follow.delete(key); continue; }
      const kp = key.split(':');
      if (+kp[0] !== r._serial || +kp[1] !== ri) { follow.delete(key); continue; }
      const j = +kp[2] - hits;
      if (j < 0 || j >= f.moving.length || p.e.t - now <= o.motor) continue;
      const tc = crossAt(f.moving[j]), d = tc - p.tCross;
      if (Math.abs(d) > 1) { p.e.dead = true; presses = presses.filter(x => x !== p.e); p.e = schedulePress(Math.max(now + 1, p.e.t + d)); p.tCross = tc; }
    }
    f.moving.forEach((xr, j) => {
      const key = r._serial + ':' + ri + ':' + (hits + j);
      if (planned.has(key)) return;
      const tCross = crossAt(xr);
      if (tCross - now > 250) return;
      planned.add(key);
      if (rng() < 0.001) return;                    // never presses this one
      let err = o.bias + o.sd * normal(rng);
      if (rng() < o.lapseP) err *= 4;
      follow.set(key, { e: schedulePress(Math.max(now + 1, tCross + err)), tCross });
    });
  }
  function schedulePress(t) {
    const e = at(t, () => { presses = presses.filter(p => p !== e); if (playing && !away) press(); });
    presses.push(e);
    return e;
  }
  function onClear(n) {
    if (n >= o.maxRounds) {
      if (o.walkAway) { done = true; return; }
      W.stopPlaying();
    }
    if (o.onClear) o.onClear(W, n);
    else if (rng() < (o.pendPauseP || 0)) pauseFor(pick(rng, ['panel', 'tab', 'page']), uni(rng, 0, 780), uni(rng, 900, 6000));
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
        at(now + uni(rng, 250, 2500), () => { away = false; if (resumeBtn.style.display !== 'none') W.resume(); });
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
      } else if (r && !playing && !r.closed && live && rng() < 0.002) done = true;
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
  const logs = iifeLogs.slice(firstLog);
  logs.forEach(x => { x.world = o; });
  iifeWall += now;
  return { submits, logs };
}

function iifeOpts(rng) {
  const mob = rng() < 0.25, skill = pick(rng, SKILLS);
  return {
    mob, comp: rng() < 0.5, key: !mob || rng() < 0.1,
    hz: pick(rng, [60, 60, 60, 120, 144, 144, 240, 30]),
    quantum: rng() < 0.05 ? 100 : (rng() < 0.05 ? 16.67 : (rng() < 0.1 ? 1 : 0)),
    clientW: rng() < 0.03 ? pick(rng, [10, 150]) : pick(rng, mob ? [320, 344, 374, 414] : [320, 444, 584, 724, 900, 924, 1200]),
    ping: mob ? 0 : pick(rng, [0, 0, 0, 150, 300]),
    jankRate: rng() < 0.2 ? 1 / 10000 : 1 / 120000, dropP: rng() < 0.1 ? 0.03 : 0.003, adapt: uni(rng, 0.9, 1.0), timerLateP: 0.02, continuous: rng() < 0.6,
    sd: skill.sd * uni(rng, 0.85, 1.15), bias: 12 * normal(rng), lapseP: skill.lapse, motor: uni(rng, 100, 180),
    maxRounds: rng() < 0.5 ? 3 + Math.floor(rng() * 12) : 15 + Math.floor(rng() * 45), walkAway: rng() < 0.3,
    maxRuns: 1 + Math.floor(rng() * 3),
    pauseRate: rng() < 0.5 ? 1 / uni(rng, 8000, 60000) : 0, reshowRate: rng() < 0.15 ? 1 / uni(rng, 10000, 40000) : 0,
    resizeRate: rng() < 0.15 ? 1 / uni(rng, 10000, 40000) : 0, liveRestartP: rng() < 0.05 ? 0.0005 : 0,
    pendPauseP: rng() < 0.3 ? 0.15 : 0, resizeP: 0.3,
    maxWall: 8 * 60 * 1000,
  };
}
// How far game time ran ahead of the clock (since R, and hit to hit), against
// the rules' GT_AHEAD tolerance.
function maxAhead(log) {
  let tR = 0, pT = 0, pG = 0, paused = 0, pAt = -1, pR = 0, pP = 0, m = -Infinity;
  for (const e of log.ev) {
    if (e[0] === 'P') pAt = e[1];
    else if (e[0] === 'U' && pAt >= 0) { paused += e[1] - pAt; pAt = -1; }
    else if (e[0] === 'R') { tR = pT = e[1]; pG = 0; pR = pP = paused; }
    else if (e[0] === 'K' || (e[0] === 'E' && e[2] === 'slow')) {
      const g = e[0] === 'K' ? e[4] : e[5];
      m = Math.max(m, g - (e[1] - tR - (paused - pR)), (g - pG) - (e[1] - pT - (paused - pP)));
      if (e[0] === 'K' && e[5] === 1) { pT = e[1]; pG = g; pP = paused; }
    }
  }
  return m;
}
let aheadMax = -Infinity;
{
  const t1 = Date.now();
  const N_IIFE = +(process.env.NI || 800);
  const rng = mulberry32(777);
  const st = { worlds: 0, submits: 0, subBad: 0, subReview: 0, logs: 0, logInvalid: 0, logReview: 0, logMismatch: 0, maxScore: 0, dueResumes: 0, restarts: 0, pauses: 0, mob: 0, ends: {} };
  for (let w = 0; w < N_IIFE; w++) {
    const o = iifeOpts(rng);
    const res = swordWorld(1000 + w, o);
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
      else if (r.verdict === 'review') st.logReview++;
      if (r.score !== x.cleared) { st.logMismatch++; if (st.logMismatch < 6) fail('iife whole log score ' + r.score + ' != cleared ' + x.cleared + ' ' + r.reasons.join('; ')); }
      aheadMax = Math.max(aheadMax, maxAhead(log));
      st.pauses += log.ev.filter(e => e[0] === 'P').length;
      const last = log.ev[log.ev.length - 1];
      const end = last && last[0] === 'E' ? last[2] : 'open';
      st.ends[end] = (st.ends[end] || 0) + 1;
      for (let i = 1; i < log.ev.length; i++) if (log.ev[i][0] === 'R' && log.ev[i - 1][0] === 'U') st.dueResumes++;
    }
  }
  console.log(`iife: ${st.worlds} page loads (${st.mob} mobile), ${st.logs} runs (${st.restarts} restarts), ${st.submits} submits: bad ${st.subBad}, review ${st.subReview}; whole logs: invalid ${st.logInvalid}, review ${st.logReview}, score != cleared ${st.logMismatch}; ends ${JSON.stringify(st.ends)}; best ${st.maxScore}; pauses ${st.pauses}, rounds started on Resume ${st.dueResumes}; game time at most ${aheadMax.toFixed(1)} ms ahead of the clock (tolerance ${SN.T.GT_AHEAD}); ${(iifeWall / 60000).toFixed(0)} min of play, ${iifeTicks} frames, ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  if (st.submits < 100) fail('iife: too few submits (' + st.submits + ')');
  if ((st.subReview + st.logReview) / (st.submits + st.logs) > 0.001) fail('iife: review rate too high');
  if (!st.dueResumes) fail('iife: no round was started on Resume (the paused-timer path went untested)');
  if (!st.ends.slow || !st.ends.zone) fail('iife: the runs never ended by ' + (!st.ends.slow ? '"too slow"' : 'a miss'));
}

// Targeted: the scenarios the pause and restart code is about, on the real IIFE.
{
  const base = { mob: false, comp: false, key: true, hz: 60, quantum: 0, clientW: 924, ping: 0, jankRate: 0, dropP: 0, adapt: 1, timerLateP: 0, continuous: true,
    sd: 12, bias: 0, lapseP: 0, motor: 150, maxRounds: 99, walkAway: false, maxRuns: 1, pauseRate: 0, reshowRate: 0, resizeRate: 0, pendPauseP: 0, resizeP: 0, maxWall: 60000 };
  const verdictOf = x => Q.check(x.run.log.type, x.run.log, { platform: 'C', claimed: x.cleared });
  // 1. left the panel / the page / the browser tab inside the 800 ms after a
  //    clear, back after the timer: the next round starts on Resume
  for (const kind of ['panel', 'page', 'tab']) {
    let did = false;
    const o = Object.assign({}, base, { maxRounds: 4, walkAway: true, onClear(W, n) {
      if (n !== 1 || did) return; did = true;
      W.at(W.now() + 200, () => {
        if (kind === 'panel') W.hide(); else if (kind === 'tab') W.tabHide(); else W.leavePage();
        W.at(W.now() + 3000, () => {
          if (kind === 'panel') W.show(); else if (kind === 'tab') W.tabShow(); else W.backPage();
          W.at(W.now() + 500, () => W.resume());
        });
      });
    } });
    const res = swordWorld(51, o);
    const x = res.logs[0], ev = x.run.log.ev;
    const iu = ev.findIndex(e => e[0] === 'U');
    const r = verdictOf(x);
    if (iu < 0 || !ev[iu + 1] || ev[iu + 1][0] !== 'R' || ev[iu + 1][2] !== 1 || x.cleared < 2 || r.verdict !== 'valid' || r.score !== x.cleared) fail(kind + ' left across the between-rounds timer: run did not go on (' + JSON.stringify(ev.slice(Math.max(0, iu - 2), iu + 3)) + ', cleared ' + x.cleared + ', ' + r.verdict + ')');
    else console.log('  ok   ' + kind + ' left across the between-rounds timer: the round starts on Resume, run went on to ' + x.cleared);
  }
  // 2. the browser tab / the QTE page left mid-round: P at once (tab) or at the
  //    next frame (page), Resume goes on in the same round
  for (const kind of ['tab', 'page']) {
    let did = false;
    const o = Object.assign({}, base, { maxRounds: 4, walkAway: true, onClear(W, n) {
      if (n !== 1 || did) return; did = true;
      const wait = () => { const ev = W.cur().log.ev; const ri = ev.map(e => e[0]).lastIndexOf('R'); if (ev[ri][2] === 1 && ev.slice(ri).some(e => e[0] === 'K')) {
        if (kind === 'tab') W.tabHide(); else W.leavePage();
        W.at(W.now() + 5000, () => { if (kind === 'tab') W.tabShow(); else W.backPage(); W.at(W.now() + 700, () => W.resume()); });
      } else W.at(W.now() + 5, wait); };
      W.at(W.now() + 5, wait);
    } });
    const res = swordWorld(55, o);
    const x = res.logs[0], ev = x.run.log.ev;
    const ip = ev.findIndex(e => e[0] === 'P'), r = verdictOf(x);
    const midRound = ip > 0 && ev.slice(0, ip).reverse().find(e => e[0] === 'R' || (e[0] === 'K' && e[5] === 1))[0] === 'K';
    if (ip < 0 || !midRound || x.cleared < 2 || r.verdict !== 'valid' || r.score !== x.cleared) fail(kind + ' hidden mid-round: ' + JSON.stringify(ev.slice(Math.max(0, ip - 2), ip + 4)) + ' cleared ' + x.cleared + ' ' + r.verdict + ' ' + r.reasons.join('; '));
    else console.log('  ok   ' + (kind === 'tab' ? 'browser tab' : 'QTE page') + ' left mid-round: paused, the round went on after Resume, run went on to ' + x.cleared);
  }
  // 3. the tab clicked again mid-run, then a fail, then Start inside the 900 ms
  //    fail reset: the new run must not be stopped by the old reset
  {
    let phase = 0, tFail = 0;
    const o = Object.assign({}, base, { script(W) {
      const r = W.cur();
      if (phase === 0 && !r) { W.start(); W.stopPlaying(); phase = 1; }
      else if (phase === 1 && W.now() > 1500) { W.reshow(); phase = 2; }
      else if (phase === 2 && r.log.ev.some(e => e[0] === 'E')) { tFail = W.now(); W.start(); W.stopPlaying(); phase = 3; }
      else if (phase === 3 && W.now() > tFail + 15000) W.setDone();
    } });
    const res = swordWorld(52, o);
    const second = res.logs[1];
    const ok = second && second.run.log.ev.some(e => e[0] === 'R') && second.run.log.ev[second.run.log.ev.length - 1][0] === 'E';
    if (!ok) fail('Start inside the fail reset: the new run was stopped silently (' + (second ? JSON.stringify(second.run.log.ev.map(e => e[0])) : 'no second run') + ')');
    else console.log('  ok   tab clicked again mid-run, then Start inside the 900 ms fail reset: the new run plays on (ended by ' + second.run.log.ev[second.run.log.ev.length - 1][2] + ')');
  }
  // 4. Resume handled while a 500 ms-old frame is still pending (a long task):
  //    that frame's dt is clamped to 0, so game time never goes back, and a
  //    press right after Resume is judged where the marker was
  for (const mode of ['press', 'play on']) {
    let did = false;
    const res0 = swordWorld(53, Object.assign({}, base, { maxRounds: 4, walkAway: true, onClear(W, n) {
      if (n !== 1 || did) return; did = true;
      const wait = () => { const ev = W.cur().log.ev; const ri = ev.map(e => e[0]).lastIndexOf('R'); if (ev[ri][2] === 1 && ev.slice(ri).some(e => e[0] === 'K')) {
        W.hide(); W.at(W.now() + 1000, () => { W.show(); W.at(W.now() + 400, () => { W.staleTick(500); W.resume(); if (mode === 'press') W.at(W.now() + 30, () => W.press()); }); });
      } else W.at(W.now() + 5, wait); };
      W.at(W.now() + 5, wait);
    } }));
    const x = res0.logs[0];
    const r = verdictOf(x);
    let back = false, prevG = -1;
    for (const e of x.run.log.ev) { if (e[0] === 'R') prevG = -1; else if (e[0] === 'K') { if (e[4] < prevG) back = true; prevG = e[4]; } }
    if (back || r.verdict !== 'valid' || r.score !== x.cleared) fail('stale frame at Resume (' + mode + '): ' + r.verdict + ' ' + r.score + '/' + x.cleared + (back ? ' game time went back' : '') + ' ' + r.reasons.join('; ') + ' ' + JSON.stringify(x.run.log.ev.slice(-4)));
    else console.log('  ok   Resume with a 500 ms-old frame pending (' + mode + '): log ' + r.verdict + ', score ' + r.score + ', game time never went back');
  }
  // 5. resizes mid-run change nothing in the log (positions are track fractions)
  {
    let did = 0;
    const o = Object.assign({}, base, { maxRounds: 6, walkAway: true, onClear(W, n) { if (did < 3) { did++; W.resize([320, 1200, 584][did - 1]); } } });
    const res = swordWorld(54, o);
    const x = res.logs[0], r = verdictOf(x);
    if (r.verdict !== 'valid' || r.score !== x.cleared || x.cleared < 6) fail('resizes mid-run: ' + r.verdict + ' ' + r.score + '/' + x.cleared + ' ' + r.reasons.join('; '));
    else console.log('  ok   three resizes mid-run: log valid, ' + x.cleared + ' rounds');
  }
  // 6. held Space: one press, then auto-repeat keydowns that must not stop
  //    the markers behind it
  {
    let phase = 0;
    const o = Object.assign({}, base, { maxWall: 20000, script(W) {
      if (phase === 0 && !W.cur()) {
        W.start(); W.stopPlaying(); phase = 1;
        // marker 0's centre crosses the zone centre ~695 ms after Start
        const ideal = ((ZS + SN.zoneW(0, false) / 2 - MW / 2) + MW) / SN.speed(0, false) * 1000;
        W.at(W.now() + ideal + 10, () => { W.key(false); for (let k = 1; k <= 30; k++) W.at(W.now() + k * 33, () => W.key(true)); });
      } else if (phase === 1 && W.now() > 8000) W.setDone();
    } });
    const res = swordWorld(56, o);
    const ev = res.logs[0].run.log.ev, ks = ev.filter(e => e[0] === 'K');
    const r = Q.check(res.logs[0].run.log.type, res.logs[0].run.log, { platform: 'C', claimed: 0 });
    if (ks.length !== 1 || ks[0][5] !== 1 || ev[ev.length - 1][2] !== 'slow' || r.verdict === 'invalid') fail('held Space: ' + ks.length + ' presses logged (want 1 hit, then "too slow"), ' + r.verdict + ' ' + JSON.stringify(ev.slice(-3)));
    else console.log('  ok   held Space: one press, 30 auto-repeats ignored (the run ended by ' + ev[ev.length - 1][2] + ')');
  }
}
// Held Space and the TAP button, directly
{
  const o = { mob: true, comp: false, key: false, hz: 60, quantum: 0, clientW: 374, ping: 0, jankRate: 0, dropP: 0, adapt: 1, timerLateP: 0, continuous: true,
    sd: 10, bias: 0, lapseP: 0, motor: 150, maxRounds: 5, walkAway: true, maxRuns: 1, pauseRate: 0, reshowRate: 0, resizeRate: 0, pendPauseP: 0, resizeP: 0, maxWall: 60000 };
  const res = swordWorld(57, o);
  const x = res.logs[0], r = x && Q.check(x.run.log.type, x.run.log, { platform: 'M', claimed: x.cleared });
  if (!x || x.cleared < 5 || r.verdict !== 'valid') fail('mobile taps (canvas and TAP button): ' + (x ? x.cleared + ' ' + r.verdict + ' ' + r.reasons.join('; ') : 'no run'));
  else console.log('  ok   mobile: taps on the canvas and the TAP button played ' + x.cleared + ' rounds, log valid');
}

// ── d) sword-new.bot.js against the real IIFE (a vm page, async fake clock) ──
// The harness bot (tools/qte/harness.html?t=sword-new) drives the page with the
// same ctx; here it plays the shipped rules + IIFE, and every submit it
// produces (and the page's own self-check) must be valid.
async function botSuite(nRuns) {
  const vm = require('vm');
  const srcs = [fs.readFileSync('@qte-scratch/wt2/js/qte-rules.js', 'utf8'),
    fs.readFileSync(path.join(__dirname, 'sword-new.rules.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'sword-new.iife.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'sword-new.bot.js'), 'utf8')];
  let bad = 0, reached = 0, checked = 0;
  for (let k = 0; k < nRuns; k++) {
    const rnd = mulberry32(7000 + k);
    const comp = k % 2 === 1, ping = [0, 0, 150][k % 3];
    const clock = { now: 3000 }, period = [1000 / 60, 1000 / 144, 1000 / 30][k % 3];
    let seq = 0; const q = [];
    const push = (at, fn) => { const it = { at, s: ++seq, fn, dead: false }; q.push(it); return it; };
    const pop = () => { let bi = 0; for (let i = 1; i < q.length; i++) if (q[i].at < q[bi].at || (q[i].at === q[bi].at && q[i].s < q[bi].s)) bi = i; return q.splice(bi, 1)[0]; };
    const ctx2d = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), measureText: t => ({ width: String(t).length * 7 }) },
      { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
    const els = {};
    const el = id => els[id] || (els[id] = {
      id, tagName: /btn$/.test(id) ? 'BUTTON' : 'DIV', style: { display: id === 'qte-panel-sword-new' ? 'flex' : (/resume|tap/.test(id) ? 'none' : '') }, textContent: '', width: 300, height: 150,
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
    sb.__qteBots['sword-new'](ctx).then(r => { done = true; result = r; }, e => { done = true; result = e; });
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
  console.log('all sword-new tests passed');
})();
