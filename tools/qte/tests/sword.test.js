// sword.test.js - node sword.test.js   (N=40000 NI=4000 node sword.test.js for more runs)
// a) honest players simulated through the trainer's own state machine
// b) forgeries, each must come out invalid, review, or scored far below the claim
// c) the real IIFE (sword.iife.js) in a fake DOM with a virtual clock, played
//    by a person watching the canvas: every submit and every whole log checked,
//    plus the scenarios behind the reviewer's fixes (stuck round after a pause,
//    stale fail reset, a Resume handled behind a long task)
// exit code 1 on any failure
'use strict';
require('./_paths.js');
const Q = require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const SW = Q.trainers.sword;
if (!SW || typeof SW.check !== 'function') { console.log('FAIL sword rules not registered'); process.exit(1); }

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

// ── the honest simulator ────────────────────────────────────────────────────
// Mirrors the IIFE (sword.iife.js): startGame, startRound, gameLoop,
// onSpacePress, onRoundSuccess, triggerFail, _onSwordQteHide/_onSwordQteShow,
// resumeGame; the page's rAF / setTimeout / ping-sim timing (key copies run
// _albPing ms + setTimeout lateness after the physical press); browser tabs
// in the background (rAF stops, timers throttled, no P); and a player who
// watches the bars and times each press, with error, drift, lapses and
// reaction limits. o.slowMo (forgery only) feeds gameLoop rAF timestamps
// running at that fraction of real time.
function simulate(rng, o) {
  const type = 'sword' + (o.comp ? '-comp' : '');
  const log = { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: o.cw + 24, h: 800, mob: o.mob, ping: o.key ? o.ping : o.ping }, ev: [] };
  const snaps = [];
  const q = o.quantum || 0;                       // coarse performance.now (privacy modes)
  const Pd = 1000 / o.hz, phase = rng() * Pd;
  const T0 = 1000 + rng() * 1e6;                  // performance.now at Start
  const clock = w => { const p = T0 + w; return q ? Math.floor(p / q) * q : p; };
  let wall = 0;
  let runT0 = clock(0);
  const ev = (code, ...f) => { log.ev.push([code, Math.max(0, Math.round(clock(wall) - runT0)), ...f.map(r4)]); };

  // trainer state
  let running = false, gameStarted = false, paused = false, streak = 0, lastTime = 0;
  let bars = [], currentBar = 0, roundPending = false, roundGT = 0;
  let cw = o.cw, trackX = SW.PAD, trackW = cw - 2 * SW.PAD, zoneX = 0, zoneW = 0;
  let ended = false, stuck = false, roundDue = false;

  // page timing
  let frameAt = null, frameNow = 0;               // pending rAF: callback time, timestamp
  let timerAt = null;                             // the 800 ms round timer
  let presses = [];                               // handler times, sorted
  let hidden = null;                              // [start, end] browser tab in the background
  let pauseEv = null;                             // { show, resume }
  let nextPauseAt = o.pauseRate ? expo(rng, 1 / o.pauseRate) : Infinity;
  let nextHiddenAt = o.hiddenRate ? expo(rng, 1 / o.hiddenRate) : Infinity;
  let nextReshowAt = o.reshowRate ? expo(rng, 1 / o.reshowRate) : Infinity;
  let slowPrevReal = null, slowNow = 0;           // slow-motion rAF wrapper

  // player
  let intent = [], obsStart = 0, watching = true, roundDrift = 0;
  const react = () => o.reactMed * Math.exp(0.22 * normal(rng));
  const vEff = () => SW.speed(streak, o.comp, o.mob) * (o.slowMo || 1);   // px per real second

  function nextVsync(t) { return phase + Pd * Math.floor((t - phase) / Pd + 1); }
  function requestFrame(fromClick) {
    let fb = fromClick ? nextVsync(wall - 4) : nextVsync(wall);
    // A Start / Resume click handled while an older frame was still pending
    // behind a long task: that frame's timestamp is from before the click, so
    // the first dt is negative by up to the length of the task.
    if (fromClick && rng() < (o.jankP || 0)) fb = wall - uni(rng, 20, 400);
    else if (rng() < o.dropP) fb += uni(rng, 20, 150);
    const fe = Math.max(wall + 0.05, fb + uni(rng, 0, 2));
    frameAt = fe; frameNow = clock(fb);
  }

  function startRound() {
    roundPending = false;
    const z = SW.zone(trackW, streak, o.comp, o.mob);
    zoneX = z.x; zoneW = z.w;
    const count = SW.bars(streak, o.comp, o.mob);
    bars = []; currentBar = 0; roundGT = 0;
    const gaps = [];
    let xPos = trackX - SW.BAR_W;
    for (let i = 0; i < count; i++) {
      bars.push({ x: xPos, stopped: false, inZone: false });
      const gap = SW.GAP_MIN + (o.gapRng ? o.gapRng() : rng()) * (SW.GAP_MAX - SW.GAP_MIN);
      gaps.push(gap);
      xPos -= gap;
    }
    ev('R', streak, cw, count, ...gaps);
    intent = []; obsStart = wall; roundDrift = o.drift * normal(rng);
  }
  function triggerFail() { running = false; paused = false; roundPending = false; ended = true; }
  function onRoundSuccess() {
    streak++;
    snaps.push({ len: log.ev.length, claimed: streak });
    roundPending = true;
    let late = rng() < 0.95 ? uni(rng, 0, 4) : uni(rng, 4, 100);
    if (hidden && wall + 800 < hidden[1]) late += uni(rng, 0, 1000);   // background timer throttling
    timerAt = wall + SW.ROUND_DELAY + late;
  }
  function onSpacePress() {
    if (!running || paused || roundPending) return;
    const cur = bars[currentBar];
    if (!cur || cur.stopped) return;
    cur.stopped = true;
    cur.inZone = SW.inZone(cur.x, zoneX, zoneW);
    ev('K', currentBar, cur.x, roundGT, cur.inZone ? 1 : 0);
    if (!cur.inZone) { ev('E', 'zone'); triggerFail(); return; }
    currentBar++;
    if (currentBar >= bars.length) onRoundSuccess();
  }
  function gameLoop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, SW.DT_MAX);
    lastTime = now;
    if (!roundPending) {
      const speed = SW.speed(streak, o.comp, o.mob);
      for (const b of bars) if (!b.stopped) b.x += speed * dt;
      roundGT += dt * 1000;
      const cur = bars[currentBar];
      if (cur && !cur.stopped && SW.pastEnd(cur.x, trackW)) {
        ev('E', 'slow', currentBar, cur.x, roundGT);
        triggerFail();
        return;
      }
    }
    requestFrame(false);
  }
  // the player, after each frame is drawn
  function plan() {
    if (!running || roundPending || ended || !watching || hidden) return;
    const v = vEff();
    const zc = zoneX + zoneW / 2;
    const adapt = o.key ? o.adapt * o.ping : 0;
    for (let k = currentBar; k < bars.length; k++) {
      if (intent[k]) continue;
      const c = bars[k].x + SW.BAR_W / 2;
      const predicted = wall + (zc - c) / v * 1000;
      if (predicted - wall > 220 + adapt) break;
      intent[k] = true;
      if (rng() < o.forgetP) continue;              // never presses: too slow
      let err = o.bias + roundDrift + o.sd * normal(rng);
      if (rng() < o.lapseP) err *= 4;
      let physical = predicted + err - adapt;
      physical = Math.max(physical, obsStart + react(), wall);
      let handler = physical;
      if (o.key) handler += o.ping > 0 ? o.ping + (rng() < 0.97 ? uni(rng, 0, 4) : uni(rng, 4, 100)) : uni(rng, 0, o.jitter == null ? 2 : o.jitter);
      else handler += uni(rng, 0, o.jitter == null ? 8 : o.jitter);   // touch: no ping sim
      addPress(handler);
      if (rng() < o.doubleP) addPress(handler + uni(rng, 30, 120));
    }
  }
  function addPress(t) { presses.push(t); presses.sort((a, b) => a - b); }
  function cancelPlans() {
    intent = intent.map((x, k) => (bars[k] && bars[k].stopped) ? x : false);
  }

  // Start click
  wall = 0; runT0 = clock(0);
  running = true; gameStarted = true; paused = false; roundPending = false;
  lastTime = clock(wall);
  startRound();
  requestFrame(true);

  const MAX_WALL = o.maxWall || 90 * 60 * 1000;
  let guard = 0;
  while (!ended && wall < MAX_WALL && guard++ < 5e6) {
    let tNext = Infinity, what = null;
    const cand = (t, w) => { if (t != null && t < tNext) { tNext = t; what = w; } };
    if (running && frameAt != null && !hidden) cand(frameAt, 'frame');
    if (hidden) cand(hidden[1], 'unhide');
    cand(timerAt, 'timer');
    if (presses.length) cand(presses[0], 'press');
    if (!pauseEv && !hidden) cand(nextPauseAt, 'hide');
    if (pauseEv) { cand(pauseEv.show, 'show'); cand(pauseEv.resume, 'resume'); }
    if (!pauseEv && !hidden && running) { cand(nextHiddenAt, 'hidden'); cand(nextReshowAt, 'reshow'); }
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
      if (running) startRound();
      else if (paused) { roundDue = true; stuck = true; }   // fired while paused: the round starts on Resume
    } else if (what === 'press') {
      presses.shift();
      onSpacePress();
    } else if (what === 'hide') {                   // another QTE tab clicked
      nextPauseAt = Infinity;
      if (gameStarted && running) {
        frameAt = null; running = false; paused = true; ev('P');
        presses = presses.filter(t => t <= wall);   // later keys: panel hidden, ignored
        cancelPlans();
        pauseEv = { show: wall + o.pauseMs(), resume: null };
      }
    } else if (what === 'show') {                   // sword tab clicked again
      const pe = pauseEv; pe.show = null;
      if (rng() < o.resizeP) {
        const ncw = pick(rng, o.mob ? [296, 320, 350, 390] : [296, 420, 560, 700, 876, 900]);
        const before = cw; cw = ncw; trackW = cw - 2 * SW.PAD;
        if ((running || paused) && cw !== before) ev('Z', cw);
      }
      pe.resume = wall + uni(rng, 250, 2500);
    } else if (what === 'resume') {
      pauseEv = null;
      nextPauseAt = o.pauseRate ? wall + expo(rng, 1 / o.pauseRate) : Infinity;
      paused = false; running = true; lastTime = clock(wall);
      ev('U');
      if (roundDue) { roundDue = false; startRound(); }
      requestFrame(true);
      slowPrevReal = null;
      obsStart = wall;
    } else if (what === 'reshow') {                 // the already-open sword tab clicked mid-run:
      nextReshowAt = Infinity;                      // resize, canvas hidden, the run goes on
      if (rng() < 0.5) {
        const ncw = pick(rng, o.mob ? [296, 320, 350, 390] : [296, 420, 560, 700, 876, 900]);
        const before = cw; cw = ncw; trackW = cw - 2 * SW.PAD;
        if (cw !== before) ev('Z', cw);
      }
    } else if (what === 'hidden') {                 // browser tab in the background
      nextHiddenAt = o.hiddenRate ? wall + expo(rng, 1 / o.hiddenRate) + 60000 : Infinity;
      hidden = [wall, wall + uni(rng, 1000, 20000)];
      presses = presses.filter(t => t <= wall + 1);
      cancelPlans();
      if (timerAt != null && timerAt < hidden[1]) timerAt += uni(rng, 0, 1000);
    } else if (what === 'unhide') {
      hidden = null;
      if (running && frameAt != null) requestFrame(false);
      obsStart = wall;
    }
    if (streak >= o.maxRounds && watching) {
      if (o.walkAway) break;                        // closes the tab after the last point
      watching = false; presses = [];               // stops pressing, lets it run off
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
  const hz = pick(rng, [60, 60, 60, 60, 120, 144, 144, 240, 30]);
  const weak = rng() < 0.1;
  const len = rng();
  const quantum = rng() < 0.02 ? 16.67 : (rng() < 0.01 ? 100 : (rng() < 0.05 ? 1 : 0));
  return {
    comp, mob, key: !mob || rng() < 0.05, ping, hz, quantum,
    cw: pick(rng, mob ? [296, 320, 350, 390] : [296, 420, 560, 700, 876, 900, 900]),
    dropP: weak ? uni(rng, 0.02, 0.06) : uni(rng, 0.001, 0.01),
    sd: skill.sd * uni(rng, 0.85, 1.15), drift: skill.sd * uni(rng, 0, 0.6), bias: 15 * normal(rng), lapseP: skill.lapse,
    forgetP: 0.001, doubleP: mob ? 0.004 : 0.001,
    adapt: uni(rng, 0.5, 1.0),
    reactMed: uni(rng, 220, 320),
    pauseRate: rng() < 0.2 ? 1 / uni(rng, 20000, 120000) : 0,
    pauseMs: () => uni(rng, 400, 30000),
    hiddenRate: rng() < 0.1 ? 1 / uni(rng, 30000, 180000) : 0,
    reshowRate: rng() < 0.03 ? 1 / uni(rng, 20000, 60000) : 0,
    resizeP: 0.3,
    jankP: rng() < 0.2 ? 0.3 : 0.02,
    maxRounds: len < 0.3 ? 3 + Math.floor(rng() * 15) : len < 0.7 ? 20 + Math.floor(rng() * 40) : 60 + Math.floor(rng() * 240),
    walkAway: rng() < 0.5,
  };
}
// a script on the real client: presses on the predicted ideal moment
function botOpts(rng, extra) {
  return Object.assign(honestOpts(rng), {
    sd: 0, drift: 0, bias: 0, lapseP: 0, forgetP: 0, doubleP: 0, pauseRate: 0, hiddenRate: 0, reshowRate: 0,
    walkAway: true, quantum: 0, key: true, ping: 0, reactMed: 150, jitter: 1,
  }, extra);
}

function runCheck(log, claimed) {
  return Q.check(log.type, log, { platform: log.env.mob ? 'M' : 'C', claimed });
}
function prefix(log, len) { return Object.assign({}, log, { ev: log.ev.slice(0, len) }); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

// ── a) honest ───────────────────────────────────────────────────────────────
const N_HONEST = +(process.env.N || 3000);
const honest = { runs: 0, invalid: 0, review: 0, scoreMismatch: 0 };
const keep = [];                                   // honest runs to forge from
let maxScore = 0, sumScore = 0, maxEv = 0, maxBytes = 0, stuckN = 0;
const bySkill = {};
{
  const rng = mulberry32(12345);
  for (let n = 0; n < N_HONEST; n++) {
    const o = honestOpts(rng);
    const sim = simulate(rng, o);
    if (sim.stuck) stuckN++;
    const tests = [{ log: sim.log, claimed: sim.streak }];
    if (sim.snaps.length) {
      const sp = sim.snaps[Math.floor(rng() * sim.snaps.length)];
      tests.push({ log: prefix(sim.log, sp.len), claimed: sp.claimed });
    }
    for (const tc of tests) {
      honest.runs++;
      const r = runCheck(tc.log, tc.claimed);
      if (r.verdict === 'invalid') { honest.invalid++; fail('honest invalid: ' + r.reasons.join('; ') + ' ' + JSON.stringify({ comp: o.comp, mob: o.mob, cw: o.cw, hz: o.hz, q: o.quantum, ping: o.ping })); }
      else if (r.verdict === 'review') { honest.review++; if (honest.review <= 12) console.log('  honest review: ' + r.reasons.join('; ') + ' sd=' + o.sd.toFixed(1) + ' hz=' + o.hz + ' q=' + o.quantum + ' ping=' + o.ping + ' score=' + tc.claimed); }
      if (r.score !== tc.claimed) { honest.scoreMismatch++; fail('honest score ' + r.score + ' != claimed ' + tc.claimed + ' ' + r.reasons.join('; ')); }
      if (tc.log === sim.log && r.stats.ivMadMs != null && r.stats.ivN >= 20) {
        const k = Math.round(o.sd / 5) * 5; (bySkill[k] = bySkill[k] || []).push(r.stats.ivMadMs);
      }
    }
    maxScore = Math.max(maxScore, sim.streak); sumScore += sim.streak; maxEv = Math.max(maxEv, sim.log.ev.length);
    maxBytes = Math.max(maxBytes, JSON.stringify(sim.log).length);
    if (keep.length < 600) keep.push({ sim, o });
  }
  const rate = honest.review / honest.runs;
  console.log(`honest: ${honest.runs} checks (${N_HONEST} runs), invalid ${honest.invalid}, review ${honest.review} (${(rate * 100).toFixed(2)}%), score mismatch ${honest.scoreMismatch}; mean score ${(sumScore / N_HONEST).toFixed(1)}, max ${maxScore}, max events ${maxEv}, max bytes ${maxBytes}, rounds started on Resume ${stuckN}`);
  const lows = Object.keys(bySkill).sort((a, b) => a - b).map(k => 'sd~' + k + ': min ivMad ' + Math.min(...bySkill[k]).toFixed(1));
  console.log('  lowest press-interval MAD by skill: ' + lows.join(', '));
  if (honest.invalid || honest.scoreMismatch || rate > 0.005) { failures++; console.log('  FAIL honest suite'); }
}

// a2) long runs by the best players, into max difficulty (hundreds of rounds)
{
  const rng = mulberry32(4711);
  const st = { runs: 0, invalid: 0, review: 0, mism: 0, maxS: 0, maxBytes: 0, minIv: Infinity, minOff: Infinity };
  for (let n = 0; n < +(process.env.NL || 60); n++) {
    const o = Object.assign(honestOpts(rng), { mob: rng() < 0.2, comp: rng() < 0.5, key: true, sd: uni(rng, 6, 14), drift: uni(rng, 0, 4), bias: 8 * normal(rng),
      lapseP: 0.001, forgetP: 0, maxRounds: 400, walkAway: true, maxWall: 4 * 3600 * 1000,
      ping: 0, hz: pick(rng, [60, 144, 240]), dropP: 0.0002, jankP: 0.01, doubleP: 0 });   // a machine that seldom hitches
    o.cw = o.mob ? 390 : 900;
    const sim = simulate(rng, o);
    const r = runCheck(sim.log, sim.streak);
    st.runs++; st.maxS = Math.max(st.maxS, sim.streak); st.maxBytes = Math.max(st.maxBytes, JSON.stringify(sim.log).length);
    if (r.stats.ivMadMs != null && r.stats.ivN >= 20) st.minIv = Math.min(st.minIv, r.stats.ivMadMs);
    if (r.stats.offMadMs != null && r.stats.hits >= 30) st.minOff = Math.min(st.minOff, r.stats.offMadMs);
    if (r.verdict === 'invalid') { st.invalid++; fail('long honest run invalid: ' + r.reasons.join('; ')); }
    else if (r.verdict === 'review') { st.review++; console.log('  long honest run review: ' + r.reasons.join('; ') + ' sd=' + o.sd.toFixed(1)); }
    if (r.score !== sim.streak) { st.mism++; fail('long honest run score ' + r.score + ' != ' + sim.streak); }  }
  console.log(`long runs (best players, sigma 6-14 ms): ${st.runs} runs, invalid ${st.invalid}, review ${st.review}, mismatch ${st.mism}; best ${st.maxS} rounds, max log ${st.maxBytes} bytes; lowest ivMad ${st.minIv.toFixed(1)} ms, lowest offMad ${st.minOff.toFixed(1)} ms`);
  if (st.review > 0) fail('long honest runs held for review');
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
function bestKeep(pred) { return keep.filter(k => pred(k)).sort((a, b) => b.sim.streak - a.sim.streak)[0]; }
{
  const rng = mulberry32(999);
  const good = bestKeep(k => k.sim.streak >= 15 && !k.o.quantum);
  const base = good.sim.log, claim = good.sim.streak;
  const endMiss = bestKeep(k => { const ev = k.sim.log.ev; const l = ev[ev.length - 1]; return l && l[0] === 'E' && l[2] === 'zone' && k.sim.streak >= 5; });

  // 1. no events + a claim
  expectCaught('no events + claim', { v: 1, rv: 1, type: 'sword', a: 0, env: { w: 900, h: 700, mob: false, ping: 0 }, ev: [] }, 25);
  // 2. claim above the logged points
  expectCaught('claim above logged points', base, claim + 10, { frac: claim / (claim + 10) });
  // 3. times x0.5
  { const l = clone(base); l.ev.forEach(e => { e[1] = Math.round(e[1] * 0.5); }); expectCaught('honest log, times x0.5', l, claim); }
  // 4. a logged miss marked as a hit
  {
    const l = clone(endMiss.sim.log); const k = l.ev[l.ev.length - 2]; k[5] = 1; l.ev.pop();
    expectCaught('miss flipped to hit', l, endMiss.sim.streak + 1, { frac: endMiss.sim.streak / (endMiss.sim.streak + 1) });
    const l2 = clone(endMiss.sim.log); l2.ev[l2.ev.length - 2][5] = 1;
    expectCaught('miss flipped to hit, end kept', l2, endMiss.sim.streak);
  }
  // 5. targets outside the rules
  { const l = clone(base); const R0 = l.ev.find(e => e[0] === 'R'); R0[5] = 150; expectCaught('gap above range', l, claim); }
  { const l = clone(base); const R0 = l.ev.find(e => e[0] === 'R'); R0[5] = 40; expectCaught('gap below range', l, claim); }
  { const l = clone(base); const Rs = l.ev.filter(e => e[0] === 'R'); const Rx = Rs[Rs.length - 1]; Rx[4] -= 1; Rx.pop(); expectCaught('one bar fewer than the streak makes', l, claim); }
  { const l = clone(base); const Rs = l.ev.filter(e => e[0] === 'R'); const Rx = Rs[Rs.length - 1]; Rx[4] += 1; Rx.push(100); expectCaught('one bar more than the streak makes', l, claim); }
  { const l = clone(base); l.env.mob = !l.env.mob; expectCaught('platform tables swapped (mob flag flipped)', l, claim); }
  { const l = clone(base); l.type = base.type.endsWith('-comp') ? 'sword' : 'sword-comp'; expectCaught('mode swapped', l, claim); }
  { const l = clone(base); l.ev.filter(e => e[0] === 'R').forEach(e => { e[3] = 1400; }); expectCaught('canvas wider than 900', l, claim); }
  { const l = clone(base); const Rs = l.ev.filter(e => e[0] === 'R'); Rs[3][2] = 9; expectCaught('round logged with the wrong streak', l, claim); }
  // 6. cherry-picked easiest targets (widest gaps only), otherwise honest play
  {
    const o = Object.assign(honestOpts(mulberry32(7)), { comp: false, mob: false, cw: 900, sd: 25, drift: 5, bias: 0, lapseP: 0, forgetP: 0, doubleP: 0, pauseRate: 0, hiddenRate: 0, reshowRate: 0, maxRounds: 30, walkAway: true, quantum: 0, hz: 60, dropP: 0.003, key: true, ping: 0 });
    const g = mulberry32(8); o.gapRng = () => 0.9 + 0.1 * g();
    const sim = simulate(mulberry32(9), o);
    expectCaught('cherry-picked widest gaps', sim.log, sim.streak);
  }
  // 7. perfect bot on the real client: presses at the predicted ideal moment
  for (const hz of [60, 144, 240]) {
    const sim = simulate(mulberry32(11 + hz), botOpts(mulberry32(10 + hz), { comp: true, mob: false, cw: 900, hz, dropP: 0.002, maxRounds: 40 }));
    expectCaught('perfect bot, real client ' + hz + ' Hz (score ' + sim.streak + ')', sim.log, sim.streak);
  }
  { const sim = simulate(mulberry32(31), botOpts(mulberry32(30), { comp: false, mob: true, key: false, cw: 350, hz: 60, dropP: 0.004, maxRounds: 40 }));
    expectCaught('perfect bot, real mobile client (score ' + sim.streak + ')', sim.log, sim.streak); }
  // 7b. perfect bot writing the log (bar centre on zone centre, clock kept consistent)
  { const l = forgePerfect(base, 0, () => 0); expectCaught('perfect bot, forged log', l, claim); }
  { const nr = mulberry32(5); const l = forgePerfect(base, 0, () => 0.6 * normal(nr)); expectCaught('near-perfect forged log (0.6 ms noise)', l, claim); }
  // 8. metronome bot: a press every 250 ms from each round start
  {
    expectCaught('metronome bot (honest outcomes)', forgeMetronome(rng, false, 250), 30);
    expectCaught('metronome bot (outcomes marked hit)', forgeMetronome(rng, true, 250), 30);
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
  { const l = clone(base); const ks = l.ev.filter(e => e[0] === 'K'); const a = ks[1], b = ks[2]; const t = a[2]; a[2] = b[2]; b[2] = t; expectCaught('two presses swapped bar indices', l, claim); }
  { const l = clone(base); const i = l.ev.findIndex(e => e[0] === 'K'); const kk = l.ev.splice(i, 1)[0]; kk[1] = 0; l.ev.unshift(kk); expectCaught('press before any round', l, claim); }
  { const l = clone(base); const ri = l.ev.findIndex((e, i) => e[0] === 'R' && i > 0); l.ev[ri][1] = l.ev[ri - 1][1] + 100; expectCaught('next round 100 ms after the last hit', l, claim); }
  { const l = clone(base); const ki = l.ev.findIndex(e => e[0] === 'K'); l.ev.splice(ki, 0, ['P', l.ev[ki][1]]); l.ev.splice(ki + 2, 0, ['U', l.ev[ki + 1][1]]); expectCaught('press while paused', l, claim); }
  { const l = clone(base); const ri = l.ev.findIndex((e, i) => e[0] === 'R' && i > 0); const k2 = l.ev.findIndex((e, i) => i > ri && e[0] === 'K' && e[2] === 1); const r2 = clone(l.ev[ri]); r2[1] = l.ev[k2][1]; l.ev.splice(k2 + 1, 0, r2); expectCaught('a second round started mid-round', l, claim); }
  { const l = clone(endMiss.sim.log); const last = l.ev[l.ev.length - 1][1]; l.ev.push(['R', last + 900, endMiss.sim.streak, 900, SW.bars(endMiss.sim.streak, /-comp$/.test(l.type), l.env.mob), ...new Array(SW.bars(endMiss.sim.streak, /-comp$/.test(l.type), l.env.mob)).fill(100)]); expectCaught('events after the end', l, endMiss.sim.streak + 1, { frac: endMiss.sim.streak / (endMiss.sim.streak + 1) }); }
  { const l = clone(base); const ki = l.ev.findIndex(e => e[0] === 'K'); l.ev.splice(ki, 1); expectCaught('a press removed (bar skipped)', l, claim); }
  // 11. replayed honest log, higher claim
  expectCaught('replayed honest log, claim x2', base, claim * 2);
  // 12. trainer specific
  { const l = clone(base); const k = l.ev.find(e => e[0] === 'K'); k[4] = k[4] * 0.5; expectCaught('bar x not reachable in its game time', l, claim); }
  { // speed hack: bars really moved at 80% speed; x and gT logged as they were
    const l = clone(base); const comp = /-comp$/.test(l.type), mob = l.env.mob; let x0 = [], v = 0;
    for (const e of l.ev) {
      if (e[0] === 'R') { v = SW.speed(e[2], comp, mob); x0 = []; let xp = SW.PAD - SW.BAR_W; for (let k = 0; k < e[4]; k++) { x0.push(xp); xp -= e[5 + k]; } }
      else if (e[0] === 'K') { e[4] = r4((e[3] - x0[e[2]]) / (0.8 * v) * 1000); }
    }
    expectCaught('speed hack (bars at 80%, x and gT as seen)', l, claim);
  }
  { // slow motion: rAF timestamps at half speed, player gets twice the time
    const o = Object.assign(honestOpts(mulberry32(21)), { comp: true, mob: false, cw: 900, sd: 30, drift: 5, bias: 0, lapseP: 0.005, forgetP: 0, doubleP: 0, pauseRate: 0, hiddenRate: 0, reshowRate: 0, maxRounds: 40, walkAway: true, quantum: 0, hz: 60, dropP: 0.003, key: true, ping: 0, slowMo: 0.5 });
    const sim = simulate(mulberry32(22), o);
    expectCaught('slow-motion client (game clock x0.5, score ' + sim.streak + ')', sim.log, sim.streak);
  }
  { // wall clock compressed so the rounds come back to back
    const l = clone(base); let off = 0, prevT = 0; for (const e of l.ev) { if (e[0] === 'R' && e[1] > 0) { off += Math.min(600, e[1] - prevT - 150); } prevT = e[1]; e[1] -= off; }
    expectCaught('pending time between rounds cut', l, claim);
  }
  { const l = clone(base); const k = l.ev.filter(e => e[0] === 'K')[3]; k[3] += 400; expectCaught('logged x moved into nowhere', l, claim); }
  { const l = clone(base); l.ev.splice(3, 0, ['Z', l.ev[2][1], 5000]); expectCaught('resize beyond 900 px', l, claim); }
  { // a pause whose U comes late swallows wall time: gT must still fit
    const l = clone(base); const ki = l.ev.findIndex((e, i) => i > 5 && e[0] === 'K'); const t = l.ev[ki][1]; l.ev.splice(ki, 0, ['P', t - 1500], ['U', t - 1]); l.ev.sort((a, b) => a[1] - b[1]);
    expectCaught('fake pause inside a round (hides reaction time)', l, claim);
  }
  { // slow end forged while the bar is still on the track
    const l = clone(base); const last = l.ev[l.ev.length - 1]; const ri = l.ev.map(e => e[0]).lastIndexOf('R');
    const cut = l.ev.slice(0, ri + 1); const R0 = cut[ri]; cut.push(['E', R0[1] + 500, 'slow', 0, r4(SW.PAD - SW.BAR_W + SW.speed(R0[2], /-comp$/.test(l.type), l.env.mob) * 0.5), 500]);
    void last; expectCaught('slow end with the bar still on the track', { ...l, ev: cut }, claim);
  }
  { // tiny canvas: points stop counting (not a reason to reject)
    const l = clone(base); l.ev.filter(e => e[0] === 'R').forEach(e => { e[3] = 60; });
    expectCaught('canvas 60 px wide', l, claim);
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
  const mutate = (name, fn) => { const l = clone(base); fn(l); expectCaught(name, l, claim); };
  const firstK = l => l.ev.find(e => e[0] === 'K'), firstR = l => l.ev.find(e => e[0] === 'R');
  mutate('huge x', l => { firstK(l)[3] = 1e300; });
  mutate('huge game time', l => { const k = firstK(l); k[4] = 1e12; k[3] = 40 + SW.speed(0, /-comp$/.test(l.type), l.env.mob) * 1e9; });
  mutate('huge canvas width', l => { firstR(l)[3] = 1e9; });
  mutate('huge streak', l => { firstR(l)[2] = 1e9; });
  mutate('huge gap', l => { firstR(l)[5] = 1e308; });
  mutate('negative gap', l => { firstR(l)[6] = -100; });
  mutate('negative canvas width', l => { firstR(l)[3] = -24; });
  mutate('negative bar index', l => { firstK(l)[2] = -1; });
  mutate('negative streak', l => { firstR(l)[2] = -1; });
  mutate('NaN-like string gap', l => { firstR(l)[5] = 'NaN'; });
  mutate('numeric-string x', l => { const k = firstK(l); k[3] = String(k[3]); });
  mutate('string hit flag', l => { firstK(l)[5] = '1'; });
  mutate('boolean hit flag', l => { firstK(l)[5] = true; });
  mutate('string streak', l => { firstR(l)[2] = '0'; });
  mutate('null bar count', l => { firstR(l)[4] = null; });
  mutate('object field', l => { firstK(l)[3] = { x: 1 }; });
  mutate('Infinity-like huge time', l => { firstK(l)[1] = 1e15; });
  mutate('a round start removed (presses fall into the last round)', l => { const ri = l.ev.map(e => e[0]).indexOf('R', 3); l.ev.splice(ri, 1); });
  mutate('a hit logged as a miss', l => { const k = l.ev.find(e => e[0] === 'K'); k[5] = 0; });
  // 15. a script that writes the whole log itself, gaps reused every round
  { const g = mulberry32(61); const fixed = [0, 1, 2, 3, 4, 5, 6, 7].map(() => 75 + 55 * g());
    const l = forgeHuman(mulberry32(62), 60, () => fixed, 15);
    expectCaught('forged log, one set of gaps reused every round (score ' + l.score + ')', l.log, l.score); }
}
// A script writing the log itself: fresh gaps (or the given ones), presses at
// the ideal moment plus Gaussian error of sdMs, times kept consistent.
function forgeHuman(rng, rounds, gapsFn, sdMs) {
  const log = { v: 1, rv: 1, type: 'sword', a: 0, env: { w: 924, h: 700, mob: false, ping: 0 }, ev: [] };
  let t = 0, s = 0;
  for (let r = 0; r < rounds; r++) {
    const n = SW.bars(s, false, false), v = SW.speed(s, false, false), z = SW.zone(800, s, false, false);
    const gs = gapsFn ? gapsFn(n) : null;
    const gaps = []; for (let k = 0; k < n; k++) gaps.push(r4(gs ? gs[k % gs.length] : 75 + 55 * rng()));
    log.ev.push(['R', t, s, 900, n, ...gaps]);
    let xp = 40, ok = true, tl = t;
    for (let k = 0; k < n; k++) {
      const gT = r4((z.x + z.w / 2 - 5 - xp) / v * 1000 + sdMs * normal(rng));
      const x = r4(xp + v * gT / 1000), hit = SW.inZone(x, z.x, z.w);
      tl = Math.max(tl, t + Math.ceil(gT) + 8);
      log.ev.push(['K', tl, k, x, gT, hit ? 1 : 0]);
      if (!hit) { log.ev.push(['E', tl, 'zone']); ok = false; break; }
      xp -= gaps[k];
    }
    if (!ok) break;
    s++; t = tl + 805;
  }
  return { log, score: s };
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

// Rewrite every press in an honest log to land at the ideal moment + lag,
// with the game time that puts it there (and the clock kept consistent).
function forgePerfect(src, lagMs, noise) {
  const l = clone(src);
  const comp = /-comp$/.test(l.type), mob = l.env.mob;
  let x0 = [], v = 0, zc = 0, zx = 0, zw = 0;
  for (const e of l.ev) {
    if (e[0] === 'R') {
      v = SW.speed(e[2], comp, mob);
      const z = SW.zone(e[3] - 2 * SW.PAD, e[2], comp, mob); zx = z.x; zw = z.w; zc = z.x + z.w / 2;
      x0 = []; let xp = SW.PAD - SW.BAR_W; for (let k = 0; k < e[4]; k++) { x0.push(xp); xp -= e[5 + k]; }
    } else if (e[0] === 'K') {
      const gT = ((zc - SW.BAR_W / 2) - x0[e[2]]) / v * 1000 + lagMs + noise();
      e[4] = r4(gT); e[3] = r4(x0[e[2]] + v * gT / 1000); e[5] = SW.inZone(e[3], zx, zw) ? 1 : 0;
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
  let tR = 0, shift = 0;
  for (const e of l.ev) {
    e[1] += shift;
    if (e[0] === 'R') tR = e[1];
    if (e[0] === 'K' && e[1] < tR + e[4]) { const d = Math.ceil(tR + e[4] - e[1]); shift += d; e[1] += d; }
  }
  return l;
}
function forgeMetronome(rng, markHit, period) {
  const l = { v: 1, rv: 1, type: 'sword', a: 0, env: { w: 924, h: 700, mob: false, ping: 0 }, ev: [] };
  let t = 0, s = 0;
  for (let round = 0; round < 30; round++) {
    const n = SW.bars(s, false, false), v = SW.speed(s, false, false);
    const z = SW.zone(800, s, false, false);
    const gaps = []; for (let k = 0; k < n; k++) gaps.push(r4(75 + 55 * rng()));
    l.ev.push(['R', t, s, 900, n, ...gaps]);
    let xp = 40, ok = true;
    for (let k = 0; k < n; k++) {
      const gT = period * (k + 2) + 400;
      const x = r4(xp + v * gT / 1000);
      const hit = SW.inZone(x, z.x, z.w);
      l.ev.push(['K', t + gT, k, x, gT, markHit ? 1 : (hit ? 1 : 0)]);
      if (!hit && !markHit) { l.ev.push(['E', t + gT, 'zone']); ok = false; break; }
      xp -= gaps[k];
    }
    if (!ok) break;
    s++; t += period * (n + 2) + 400 + 900;
  }
  return l;
}

// ── c) the real IIFE (sword.iife.js) in a fake DOM with a virtual clock ──────
// Frames tick on vsync; a frame's callbacks get its vsync time as timestamp but
// may run late (a long task): events queued meanwhile (clicks, keys, timers)
// run first, which is how an honest Start/Resume gets a negative first dt.
// Timers can be late, frames dropped, clocks coarse, keys delayed by the ping
// sim. The player watches the drawn canvas (never the closure) and presses
// with human error. Every submit, and every run's whole log, is checked.
const fs = require('fs'), path = require('path');
const IIFE_SRC = fs.readFileSync(path.join(__dirname, 'sword.iife.js'), 'utf8');
try { new Function(IIFE_SRC); console.log('iife: parses'); } catch (err) { fail('sword.iife.js does not parse: ' + err.message); }

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
globalThis.addEventListener = () => {};
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
    const late = rng() < (o.timerLateP || 0.01) ? uni(rng, 5, 300) : uni(rng, 0, 3);
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
    tickEv = null; lastTickRun = now; iifeTicks++;
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
      set textContent(v) { text = String(v); if (id === 'sword-qte-streak' && streakCb) streakCb(text); },
      appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
      addEventListener(type, fn) { (this._h[type] = this._h[type] || []).push(fn); },
      fire(type, ev) { (this._h[type] || []).slice().forEach(fn => fn(ev || { preventDefault() {} })); },
    };
  }
  const wrap = el('wrap'); wrap.clientWidth = o.clientW;
  const canvas = el('sword-qte-canvas', 'CANVAS');
  let cwv = 300;   // HTMLCanvasElement.width: unsigned long, out of range -> 300
  Object.defineProperty(canvas, 'width', { get: () => cwv, set: v => { const u = Number(v) >>> 0; cwv = u > 2147483647 ? 300 : u; } });
  canvas.height = 150;
  wrap.appendChild(canvas);
  let frameCur = null, frameSeen = null;
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    clearRect() { frameCur = { zoneX: 0, zoneW: 0, moving: [], vT: drawVT }; if (drawVT != null) frameSeen = frameCur; },
    fillRect(x, y, w) {
      const f = frameCur; if (!f) return;
      if (this.fillStyle === 'rgba(150,150,175,0.28)') { f.zoneX = x; f.zoneW = w; }
      else if (this.fillStyle === '#ffffff' || this.fillStyle === 'rgba(200,200,255,0.4)') f.moving.push(x);
    },
    strokeRect() {},
  };
  canvas.getContext = () => ctx;
  const ids = {};
  ['sword-qte-status', 'sword-qte-streak', 'sword-qte-highscore', 'page-qte', 'qte-panel-sword'].forEach(id => { ids[id] = el(id); });
  ids['sword-qte-start-btn'] = el('sword-qte-start-btn', 'BUTTON');
  ids['sword-qte-resume-btn'] = el('sword-qte-resume-btn', 'BUTTON');
  ids['sword-qte-canvas'] = canvas;
  ids['page-qte'].classList.add('active');
  const panel = ids['qte-panel-sword']; panel.style.display = 'flex';
  const startBtn = ids['sword-qte-start-btn'], resumeBtn = ids['sword-qte-resume-btn'];
  resumeBtn.style.display = 'none';
  const docH = {};
  const document = {
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
  globalThis.IS_MOBILE = !!o.mob;
  globalThis._albPing = o.ping || 0;
  globalThis._qteCompMode = !!o.comp;
  const submits = [];
  globalThis._sbStartQteRun = () => Promise.resolve({ run: 'r', ticket: 't' });
  globalThis._sbSubmitScore = (type, score, packet) => { submits.push({ type, score, packet }); };
  Q.Run.current = null;
  const firstLog = iifeLogs.length;

  new Function('window', 'document', 'localStorage', 'IS_MOBILE', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'performance', IIFE_SRC)(
    globalThis, document, localStorage, !!o.mob, setTimeoutV, clearTimeoutV, rafV, cafV, MO, perfV);
  const hide = globalThis._onSwordQteHide, show = globalThis._onSwordQteShow;
  const tapBtn = o.mob ? canvas.parentElement.children.find(c => c.tagName === 'BUTTON') : null;
  if (o.mob && !tapBtn) fail('iife: no TAP button on mobile');

  const cur = () => Q.Run.current;
  const entry = () => { const r = cur(); return r ? iifeLogs.find(x => x.run === r) : null; };
  streakCb = text => { const m = /Streak: (\d+)/.exec(text); const e = entry(); if (m && e) { e.cleared = Math.max(e.cleared, +m[1]); onClear(+m[1]); } };

  // the player
  let playing = false, away = false, done = false, runsStarted = 0;
  const planned = new Set(); let presses = [], hist = [];
  const W = {
    now: () => now, at, rng, o, cur, entry, canvas, startBtn, resumeBtn, panel, wrap,
    start() { startBtn.fire('click'); runsStarted++; playing = true; },
    resume() { resumeBtn.fire('click'); },
    hide() { hide(); panel.style.display = 'none'; killPresses(); },
    show() { panel.style.display = 'flex'; show(); },
    reshow() { show(); },
    staleTick(ms) { if (tickEv) tickEv.dead = true; tickEv = null; const V = now - ms; tickEv = at(now + 1, () => runTick(V)); },
    stopPlaying() { playing = false; killPresses(); },
    press() { press(); },
    setDone() { done = true; },
  };
  function killPresses() { presses.forEach(e => { e.dead = true; }); presses = []; planned.clear(); hist = []; }
  function press() {
    if (o.mob && !o.key) {
      const tgt = tapBtn && rng() < 0.5 ? tapBtn : canvas;
      tgt.fire('touchstart', { preventDefault() {} });
      return;
    }
    const e = { code: 'Space', key: ' ', repeat: false, preventDefault() {} };
    const dispatch = ev => (docH.keydown || []).forEach(fn => fn(ev));
    if (o.ping > 0) setTimeoutV(() => dispatch(Object.assign({}, e)), o.ping);   // core.js: swallowed, a copy later
    else dispatch(e);
  }
  function plan() {
    if (!playing || away || canvas.style.display === 'none' || panel.style.display === 'none') return;
    const f = frameSeen; if (!f || f.vT == null) return;
    const r = cur(); if (!r || r.closed) return;
    const ev = r.log.ev;
    let ri = -1; for (let i = ev.length - 1; i >= 0; i--) if (ev[i][0] === 'R') { ri = i; break; }
    if (ri < 0) return;
    let hits = 0; for (let i = ri + 1; i < ev.length; i++) if (ev[i][0] === 'K' && ev[i][5] === 1) hits++;
    const s = ev[ri][2], comp = /-comp$/.test(r.type);
    const zc = f.zoneX + f.zoneW / 2;
    // the speed the bars appear to move at: a person times what they see
    // (a coarse clock or dropped frames slow the game clock down)
    let v = SW.speed(s, comp, !!o.mob);
    if (f.moving.length) {
      const lk = r._serial + ':' + ri + ':' + hits;
      hist = hist.filter(h => h.key === lk && f.vT - h.V <= 400);
      hist.push({ key: lk, V: f.vT, x: f.moving[0] });
      const h0 = hist[0], dT = f.vT - h0.V;
      if (dT >= 120 && f.moving[0] > h0.x) v = (f.moving[0] - h0.x) / dT * 1000;
    }
    f.moving.forEach((x, j) => {
      const key = r._serial + ':' + ri + ':' + (hits + j);
      if (planned.has(key)) return;
      // a player with the ping sim on learns to press that much early
      const tCross = f.vT + (zc - (x + SW.BAR_W / 2)) / v * 1000 - (o.key && o.ping ? o.adapt * o.ping : 0);
      if (tCross - now > 250) return;
      planned.add(key);
      if (rng() < 0.001) return;                    // never presses this one
      let err = o.bias + o.sd * normal(rng);
      if (rng() < o.lapseP) err *= 4;
      const e = at(Math.max(now + 1, tCross + err), () => { presses = presses.filter(p => p !== e); if (playing && !away) press(); });
      presses.push(e);
    });
  }
  function onClear(n) {
    if (n >= o.maxRounds) {
      if (o.walkAway) { done = true; return; }
      W.stopPlaying();
    }
    if (o.onClear) o.onClear(W, n);
    else if (rng() < (o.pendPauseP || 0)) pauseFor(uni(rng, 0, 780), uni(rng, 900, 6000));
  }
  function pauseFor(after, dur) {
    at(now + after, () => {
      if (away || done) return;
      away = true; W.hide();
      at(now + dur, () => {
        if (rng() < o.resizeP) wrap.clientWidth = pick(rng, o.mob ? [320, 344, 374, 414] : [320, 444, 584, 724, 900, 924, 1200]);
        W.show();
        at(now + uni(rng, 250, 2500), () => { away = false; if (resumeBtn.style.display !== 'none') W.resume(); });
      });
    });
  }
  // the page around the player: pauses, the sword tab clicked again, restarts
  let nextPause = o.pauseRate ? expo(rng, 1 / o.pauseRate) : Infinity;
  let nextReshow = o.reshowRate ? expo(rng, 1 / o.reshowRate) : Infinity;
  function brain() {
    if (done) return;
    const r = cur();
    const live = r && !r.closed && startBtn.style.display === 'none' && resumeBtn.style.display === 'none';
    if (o.script) o.script(W);
    else if (!away) {
      if (!r && startBtn.style.display !== 'none') W.start();
      else if (r && (r.closed || !playing) && startBtn.style.display !== 'none' && canvas.style.display === 'none') {
        if (runsStarted < o.maxRuns && rng() < 0.05) W.start(); else if (runsStarted >= o.maxRuns || !playing) done = true;
      } else if (live && now > nextPause) {
        nextPause = now + expo(rng, 1 / o.pauseRate);
        pauseFor(0, rng() < 0.3 ? uni(rng, 300, 1500) : uni(rng, 1500, 30000));
      } else if (live && now > nextReshow) {
        nextReshow = now + expo(rng, 1 / o.reshowRate);
        if (rng() < o.resizeP) wrap.clientWidth = pick(rng, o.mob ? [320, 344, 374, 414] : [320, 444, 584, 724, 900, 924, 1200]);
        W.reshow();                                   // canvas hidden, run goes on, Start shown
        away = true;
        at(now + uni(rng, 200, 2500), () => { away = false; if (rng() < 0.7 && runsStarted < o.maxRuns) W.start(); else W.stopPlaying(); });
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
    sd: skill.sd * uni(rng, 0.85, 1.15), bias: 12 * normal(rng), lapseP: skill.lapse,
    maxRounds: rng() < 0.5 ? 3 + Math.floor(rng() * 12) : 15 + Math.floor(rng() * 45), walkAway: rng() < 0.3,
    maxRuns: 1 + Math.floor(rng() * 3),
    pauseRate: rng() < 0.5 ? 1 / uni(rng, 8000, 60000) : 0, reshowRate: rng() < 0.15 ? 1 / uni(rng, 10000, 40000) : 0,
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
    else if (e[0] === 'K' || (e[0] === 'E' && e[2] === 'slow')) {
      const g = e[0] === 'K' ? e[4] : e[5];
      m = Math.max(m, g - (e[1] - tR - (paused - pR)), (g - pG) - (e[1] - pT - (paused - pP)));
      if (e[0] === 'K' && e[5] === 1) { pT = e[1]; pG = g; pP = paused; }
    }
  }
  return m;
}
let aheadMax = -Infinity;
function gtBackwards(log) {   // an honest negative dt that the old rules called invalid
  let maxG = -Infinity, n = 0;
  for (const e of log.ev) {
    if (e[0] === 'R') maxG = -Infinity;
    else if (e[0] === 'K' || (e[0] === 'E' && e[2] === 'slow')) {
      const g = e[0] === 'K' ? e[4] : e[5];
      if (g < -150 || g < maxG - 150) n++;
      maxG = Math.max(maxG, g);
    }
  }
  return n;
}
{
  const t1 = Date.now();
  const N_IIFE = +(process.env.NI || 800);
  const rng = mulberry32(777);
  const st = { worlds: 0, submits: 0, subBad: 0, subReview: 0, logs: 0, logInvalid: 0, logReview: 0, logMismatch: 0, maxScore: 0, back: 0, dueResumes: 0, restarts: 0, resizes: 0, pauses: 0, mob: 0 };
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
      const stopped = log.ev.some(e => e[0] === 'R' && e[3] < 100);
      const r = Q.check(log.type, log, { platform: o.mob ? 'M' : 'C', claimed: x.cleared });
      if (r.verdict === 'invalid') { st.logInvalid++; if (st.logInvalid < 6) fail('iife whole log invalid: ' + r.reasons.join('; ') + ' ' + JSON.stringify(o)); }
      else if (r.verdict === 'review') st.logReview++;
      if (r.score !== x.cleared && !stopped) { st.logMismatch++; if (st.logMismatch < 6) fail('iife whole log score ' + r.score + ' != cleared ' + x.cleared + ' ' + r.reasons.join('; ')); }
      st.back += gtBackwards(log);
      aheadMax = Math.max(aheadMax, maxAhead(log));
      st.pauses += log.ev.filter(e => e[0] === 'P').length;
      st.resizes += log.ev.filter(e => e[0] === 'Z').length;
      for (let i = 1; i < log.ev.length; i++) if (log.ev[i][0] === 'R' && log.ev[i - 1][0] === 'U') st.dueResumes++;
    }
  }
  console.log(`iife: ${st.worlds} page loads (${st.mob} mobile), ${st.logs} runs (${st.restarts} restarts), ${st.submits} submits: bad ${st.subBad}, review ${st.subReview}; whole logs: invalid ${st.logInvalid}, review ${st.logReview}, score != cleared ${st.logMismatch}; best ${st.maxScore}; pauses ${st.pauses}, resizes ${st.resizes}, rounds started on Resume ${st.dueResumes}, backwards game time ${st.back}; game time at most ${aheadMax.toFixed(1)} ms ahead of the clock (tolerance ${SW.T.GT_AHEAD}); ${(iifeWall / 60000).toFixed(0)} min of play, ${iifeTicks} frames, ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  if (st.submits < 100) fail('iife: too few submits (' + st.submits + ')');
  if ((st.subReview + st.logReview) / (st.submits + st.logs) > 0.005) fail('iife: review rate too high');
  if (!st.dueResumes) fail('iife: no round was started on Resume (the stuck-round path went untested)');
}

// Targeted: the scenarios the fixes are about, on the real IIFE.
{
  const base = { mob: false, comp: false, key: true, hz: 60, quantum: 0, clientW: 924, ping: 0, jankRate: 0, dropP: 0, adapt: 1, timerLateP: 0, continuous: true,
    sd: 12, bias: 0, lapseP: 0, maxRounds: 99, walkAway: false, maxRuns: 1, pauseRate: 0, reshowRate: 0, pendPauseP: 0, resizeP: 0, maxWall: 60000 };
  // 1. left the panel inside the 800 ms after a clear, back after the timer: the next round starts on Resume
  {
    let paused = false;
    const o = Object.assign({}, base, { maxRounds: 4, walkAway: true, onClear(W, n) {
      if (n !== 1 || paused) return; paused = true;
      W.at(W.now() + 200, () => { W.hide(); W.at(W.now() + 3000, () => { W.show(); W.at(W.now() + 500, () => W.resume()); }); });
    } });
    const res = swordWorld(51, o);
    const x = res.logs[0], ev = x.run.log.ev;
    const iu = ev.findIndex(e => e[0] === 'U');
    const r = Q.check(x.run.log.type, x.run.log, { platform: 'C', claimed: x.cleared });
    if (iu < 0 || !ev[iu + 1] || ev[iu + 1][0] !== 'R' || ev[iu + 1][2] !== 1 || x.cleared < 2 || r.verdict !== 'valid' || r.score !== x.cleared) fail('pause across the between-rounds timer: run did not go on (' + JSON.stringify(ev.slice(Math.max(0, iu - 2), iu + 3)) + ', cleared ' + x.cleared + ', ' + r.verdict + ')');
    else console.log('  ok   pause across the between-rounds timer: the round starts on Resume, run went on to ' + x.cleared);
  }
  // 2. sword tab clicked again mid-run, the hidden run fails, Start inside 900 ms: the new run must not be stopped by the old reset
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
    else console.log('  ok   Start inside the 900 ms fail reset: the new run plays on (ended by ' + second.run.log.ev[second.run.log.ev.length - 1][2] + ')');
  }
  // 3. Resume handled while a 500 ms-old frame is still pending (a long task):
  //    the first dt is -500 ms, the bars step back, and a press right after
  //    Resume is judged at that game time - a miss with game time 500 ms
  //    behind the last hit. The run's log must stay valid (the old rules
  //    called it invalid: 'game time went backwards').
  for (const mode of ['miss', 'play on']) {
    let did = false;
    const res0 = swordWorld(53, Object.assign({}, base, { maxRounds: 4, walkAway: true, onClear(W, n) {
      if (n !== 1 || did) return; did = true;
      const wait = () => { const ev = W.cur().log.ev; const ri = ev.map(e => e[0]).lastIndexOf('R'); if (ev[ri][2] === 1 && ev.slice(ri).some(e => e[0] === 'K')) {
        W.hide(); W.at(W.now() + 1000, () => { W.show(); W.at(W.now() + 400, () => { W.staleTick(500); W.resume(); if (mode === 'miss') W.at(W.now() + 30, () => W.press()); }); });
      } else W.at(W.now() + 5, wait); };
      W.at(W.now() + 5, wait);
    } }));
    const x = res0.logs[0];
    const r = Q.check(x.run.log.type, x.run.log, { platform: 'C', claimed: x.cleared });
    const back = gtBackwards(x.run.log);
    if ((mode === 'miss' && !back) || r.verdict !== 'valid' || r.score !== x.cleared) fail('stale frame at Resume (' + mode + '): ' + r.verdict + ' ' + r.score + '/' + x.cleared + ' back=' + back + ' ' + r.reasons.join('; ') + ' ' + JSON.stringify(x.run.log.ev.slice(-4)));
    else console.log('  ok   Resume with a 500 ms-old frame pending (' + mode + '): log ' + r.verdict + ', score ' + r.score + (back ? ', game time went back' : ''));
  }
}

if (failures) { console.log('FAILED (' + failures + ')'); process.exit(1); }
console.log('all sword tests passed');
