// dagger-new: honest simulation + forgeries against QteRules.check.
// node dagger-new.test.js [runs]
'use strict';
require('./_paths.js');
const Q = require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const R = Q.trainers['dagger-new'];

let failures = 0;
function fail(msg) { failures++; console.log('FAIL ' + msg); }

// ── seeded randomness ──
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(12345);
const U = (a, b) => a + (b - a) * rng();
function N(m, s) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
function wpick(pairs) { let x = rng(), s = 0; for (const [v, w] of pairs) { s += w; if (x < s) return v; } return pairs[pairs.length - 1][0]; }

// ── the simulator: the IIFE's state machine, frame by frame, with a player ──
// o = { comp, hz, lagRate, ping, mobile, player, pauses:[[at,dur|Infinity]], hides:[[at,dur]], phaseU, capMs }
function simulate(o) {
  const TAU = 2 * Math.PI;
  const PERF0 = 40000 + rng() * 100000;         // performance.now() at Run.start
  const type = 'dagger-new' + (o.comp ? '-comp' : '');
  const log = { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: 1280, h: 800, mob: !!o.mobile, ping: o.ping }, ev: [] };
  let closed = false;
  const snaps = [];
  function ev(at, code, ...f) {
    if (closed) return;
    const e = [code, Math.max(0, Math.round(at - PERF0))];
    for (const x of f) e.push(typeof x === 'number' ? Math.round(x * 10000) / 10000 : x);
    log.ev.push(e);
  }
  function snapshot() { return { v: log.v, rv: log.rv, type: log.type, a: log.a, env: log.env, ev: log.ev.slice() }; }

  // frames / main-thread blocks / tab-hidden spans
  const T = 1000 / o.hz, vs0 = PERF0 + rng() * T;
  const cap = PERF0 + (o.capMs || 600000);
  const blocks = [];
  { let x = PERF0; while (x < cap) { x += -Math.log(1 - rng()) * 1000 / Math.max(o.lagRate, 1e-6); const d = wpick([[U(20, 60), 0.7], [U(60, 200), 0.25], [U(200, 600), 0.05]]); blocks.push([x, x + d]); x += d; } }
  const hides = (o.hides || []).map(([a, d]) => [PERF0 + a, PERF0 + a + d]);
  function inSpan(spans, x) { for (const s of spans) { if (x >= s[0] && x < s[1]) return s; if (s[0] > x) break; } return null; }
  function afterBlocks(x) { const b = inSpan(blocks, x); return b ? b[1] + 0.2 : x; }
  function nextFrame(after, allowPrev) {
    let n = Math.floor((after - vs0) / T) + 1, ts = vs0 + n * T, cb = ts + U(0.2, 1.5);
    if (allowPrev && rng() < 0.3) { ts = vs0 + (n - 1) * T; cb = after + U(0.1, 1); }
    for (let guard = 0; guard < 50; guard++) {
      const h = inSpan(hides, cb);
      if (h) { n = Math.floor((h[1] - vs0) / T) + 1; ts = vs0 + n * T; cb = ts + U(0.2, 1.5); continue; }
      const b = inSpan(blocks, cb);
      if (b) { ts = vs0 + Math.floor((b[1] - vs0) / T) * T; cb = b[1] + U(0.1, 1); continue; }
      break;
    }
    return { ts, cb };
  }

  // game state (the IIFE)
  const comp = !!o.comp;
  const maxLives = comp ? R.LIVES_COMP : R.LIVES_MAX;
  let score = 0, level = 1, hitsLvl = 0, lives = maxLives, timeLeft = R.TIMER_MAX;
  let bars = [], gameT = 0, spawnT = 0, running = true, paused = false, over = false;
  let lastPressMs = 0, lastTime, frame = null, lastFrameTs = PERF0;
  const phaseU = o.phaseU || (() => rng());
  function spawn(at) {
    const count = R.bars(level), spd = R.speed(level, comp);
    const phase = R.drawPhase(level, phaseU(level));
    spawnT = gameT; bars = [];
    for (let i = 0; i < count; i++) { const base = R.barBase(level, phase, i); bars.push({ k: i, base, angle: base, speed: spd }); }
    ev(at, 'L', level, phase, gameT * 1000);
  }
  function gameOver(at, why) {
    running = false; over = true; frame = null;
    ev(at, 'E', why, gameT * 1000);
    closed = true;
  }
  const start = PERF0 + U(0.2, 3);
  spawn(PERF0 + U(0.05, 0.2));
  lastTime = start;
  frame = nextFrame(start, true);

  // player
  const P = o.player;
  let err = 0, gen = 0, pending = 0, waiting = false, lastPhys = -1e9, idle = false;
  const actions = [];
  function addAction(a) { actions.push(a); }
  function planAt(at) { addAction({ at, kind: 'plan', gen }); }
  function react() { return P.reactMed * Math.exp(N(0, P.reactSdLog)); }
  function onPress(h, act) {
    if (!running || paused) return null;
    if (h - lastPressMs < R.MIN_PRESS_MS) return null;
    lastPressMs = h;
    const zh = R.zoneHalf(level);
    const idx = bars.findIndex(b => R.angDist(b.angle, R.NEEDLE) <= zh);
    ev(h, 'K', gameT * 1000, idx === -1 ? -1 : bars[idx].k);
    if (idx === -1) {
      lives--; timeLeft = Math.max(0, timeLeft - R.MISS_COST);
      if (lives <= 0 || timeLeft <= 0) gameOver(h, 'M');
      return 'miss';
    }
    bars.splice(idx, 1); score++; hitsLvl++;
    timeLeft = Math.min(timeLeft + R.HIT_BONUS, R.TIMER_MAX);
    snaps.push({ claimed: score, log: snapshot() });
    if (hitsLvl >= R.hitsNeeded(level)) {
      level++; hitsLvl = 0; lives = Math.min(lives + 1, maxLives); timeLeft = R.TIMER_MAX;
      spawn(h);
      return 'level';
    }
    return 'hit';
  }
  // candidate centre times (wall) for the remaining bars, from the last frame
  function arrivals(d) {
    const out = [];
    for (const b of bars) {
      const tau = R.normalise(R.NEEDLE - b.angle) / b.speed * 1000;
      for (let n = -1; n <= 2; n++) out.push({ at: lastFrameTs + tau + n * TAU / b.speed * 1000, b });
    }
    return out.filter(x => x.at >= d).sort((a, b) => a.at - b.at);
  }
  function doPlan(d) {
    if (!running || paused || idle) return;
    if (hitsLvl + pending >= R.hitsNeeded(level) || (pending > 0 && P.waitPending)) { waiting = true; return; }
    if (!bars.length) { idle = true; if (rng() < 0.4) schedulePress(d + U(200, 800), false); return; }
    if (rng() < P.pQuit) { idle = true; return; }
    if (P.pHold && rng() < P.pHold) {
      // holds Space: first keydown, then OS auto-repeat (500 ms delay, ~30/s)
      const s0 = d + U(0, 100), len = U(400, 2000);
      schedulePress(s0, false);
      for (let x = s0 + 500; x < s0 + len; x += 1000 / 30 + N(0, 0.3)) schedulePress(x, false);
      lastPhys = s0 + len; planAt(s0 + len + react());
      return;
    }
    let cands = arrivals(d + P.lead).filter(x => x.at >= lastPhys + P.tapGap);
    if (P.pressAt) cands = cands.filter(x => P.pressAt(x, level) >= Math.max(d, lastPhys + P.tapGap));
    if (!cands.length) { planAt(d + 50); return; }
    let c = cands[0];
    if (cands.length > 1 && rng() < P.pSkip) c = cands[1];
    let phys;
    if (P.pressAt) phys = P.pressAt(c, level);
    else {
      err = P.rho * err + Math.sqrt(1 - P.rho * P.rho) * N(0, P.sigma);
      phys = c.at + P.bias + err - P.pingComp * o.ping;
    }
    phys = Math.max(phys, d);
    schedulePress(phys, true);
    if (rng() < P.pStray) schedulePress(phys + U(150, 500), false);
    if (P.metronome && hitsLvl + pending < R.hitsNeeded(level)) {
      // open loop: keep pressing at the bar period, no more looking
      const per = TAU / R.bars(level) / R.speed(level, comp) * 1000;
      let x = phys, need = R.hitsNeeded(level) - hitsLvl - pending;
      while (need-- > 0) { x += per; schedulePress(Math.round(x), true); }
      waiting = true;
      return;
    }
    lastPhys = phys;
    planAt(phys + 1);
  }
  function schedulePress(phys, counted) {
    let h = phys + o.ping + (o.ping > 0 ? wpick([[U(0, 4), 0.95], [U(4, 100), 0.05]]) : 0);
    if (inSpan(hides, phys)) return;
    h = afterBlocks(h);
    if (counted) pending++;
    addAction({ at: h, phys, kind: 'press', gen, counted });
    if (o.mobile && rng() < 0.01) addAction({ at: afterBlocks(h + U(0, 350)), phys, kind: 'press', gen, counted: false });
  }
  for (const [a, d] of o.pauses || []) { addAction({ at: PERF0 + a, kind: 'pause' }); if (isFinite(d)) addAction({ at: PERF0 + a + d, kind: 'resume' }); }
  for (const [hs, he] of hides) { addAction({ at: hs, kind: 'hide' }); addAction({ at: he, kind: 'show' }); }
  planAt(start + react());

  let guard = 0;
  while (!over && guard++ < 2e6) {
    let ai = -1, ta = Infinity;
    for (let i = 0; i < actions.length; i++) if (actions[i].at < ta) { ta = actions[i].at; ai = i; }
    const tf = (running && frame) ? frame.cb : Infinity;
    if (tf === Infinity && ta === Infinity) break;
    if (Math.min(tf, ta) > cap) break;
    if (tf <= ta) {
      const ts = frame.ts;
      const dt = Math.min(Math.max(0, ts - lastTime) / 1000, R.DT_MAX);
      if (ts > lastTime) lastTime = ts;
      gameT += dt; timeLeft -= dt;
      if (timeLeft <= 0) { timeLeft = 0; gameOver(frame.cb, 'T'); break; }
      for (const b of bars) b.angle = R.barAngle(b.base, b.speed, gameT - spawnT);
      lastFrameTs = ts;
      frame = nextFrame(frame.cb, false);
      continue;
    }
    const a = actions.splice(ai, 1)[0];
    if (a.kind === 'plan') { if (a.gen === gen) doPlan(a.at); continue; }
    if (a.kind === 'press') {
      if (a.counted && a.gen === gen) pending--;
      const res = onPress(a.at, a);
      if (over) break;
      if (res === 'level') { gen++; pending = 0; waiting = false; idle = false; lastPhys = a.phys; planAt(a.at + react()); }
      else if (waiting && pending <= 0 && a.gen === gen) { waiting = false; planAt(a.at + react()); }
      continue;
    }
    if (a.kind === 'pause') {
      if (running) { running = false; paused = true; frame = null; ev(a.at, 'P', gameT * 1000); gen++; pending = 0; waiting = false; }
      continue;
    }
    if (a.kind === 'resume') {
      if (paused) { paused = false; running = true; ev(a.at, 'U'); lastTime = a.at + U(0, 0.5); frame = nextFrame(lastTime, true); planAt(a.at + react() + 300); }
      continue;
    }
    if (a.kind === 'hide') { gen++; pending = 0; waiting = false; continue; }
    if (a.kind === 'show') { if (running) planAt(a.at + react() + 200); continue; }
  }
  return { log, snaps, score, type, over };
}

// ── players ──
function human(skill, ping) {
  const S = {
    new:  { sigma: [60, 100], bias: 30, stray: 0.05, gap: [200, 260], react: [300, 340], comp: [0, 0.8], skip: 0.12, quit: 0.04, hold: 0.03 },
    mid:  { sigma: [35, 60],  bias: 20, stray: 0.03, gap: [180, 230], react: [250, 300], comp: [0.3, 1], skip: 0.08, quit: 0.02, hold: 0.01 },
    good: { sigma: [20, 35],  bias: 12, stray: 0.015, gap: [160, 200], react: [220, 270], comp: [0.6, 1], skip: 0.05, quit: 0.01, hold: 0 },
    top:  { sigma: [6, 20],   bias: 8,  stray: 0.005, gap: [150, 175], react: [200, 240], comp: [0.8, 1], skip: 0.03, quit: 0.005, hold: 0 },
    // beyond the best rhythm-game players (osu! UR 40-70 = SD 4-7 ms), with drifting (autocorrelated) error
    elite: { sigma: [4, 7],   bias: 5,  stray: 0.003, gap: [145, 165], react: [190, 230], comp: [0.9, 1], skip: 0.02, quit: 0.002, hold: 0, rho: 0.75 },
  }[skill];
  return {
    sigma: U(...S.sigma), bias: N(0, S.bias), rho: U(0, S.rho || 0.5), pStray: S.stray, tapGap: U(...S.gap), pHold: S.hold,
    reactMed: U(...S.react), reactSdLog: U(0.15, 0.3), pingComp: U(...S.comp), pSkip: S.skip, pQuit: S.quit, lead: U(80, 140),
  };
}
function honestOpts() {
  // DN_SKILL=top node dagger-new.test.js 5000  - stress the person checks with one skill only
  const skill = process.env.DN_SKILL || wpick([['new', 0.25], ['mid', 0.3], ['good', 0.23], ['top', 0.19], ['elite', 0.03]]);
  const ping = pick([0, 0, 150, 300]);
  const o = {
    comp: rng() < 0.5, hz: wpick([[60, 0.55], [120, 0.15], [144, 0.2], [240, 0.05], [30, 0.05]]),
    lagRate: wpick([[0.05, 0.4], [0.3, 0.4], [1.5, 0.2]]), ping, mobile: rng() < 0.25,
    player: human(skill, ping), pauses: [], hides: [], skill,
  };
  if (rng() < 0.15) { const n = rng() < 0.3 ? 2 : 1; for (let i = 0; i < n; i++) o.pauses.push([U(300, 40000), rng() < 0.03 ? Infinity : U(300, 30000)]); o.pauses.sort((a, b) => a[0] - b[0]); }
  if (rng() < 0.1) o.hides.push([U(500, 40000), U(500, 20000)]);
  if (rng() < 0.1) o.capMs = U(1000, 8000);           // short runs: the tab is closed early
  return o;
}

function checkLog(type, log, claimed) { return Q.check(type, log, { platform: 'C', claimed }); }

// ── a) honest ──
const RUNS = +process.argv[2] || 2400;
let inv = 0, rev = 0, mism = 0, snapsChecked = 0, maxEv = 0, topScore = 0;
const reasons = {};
const bySkill = {};
const statTail = {};
for (let n = 0; n < RUNS; n++) {
  const o = honestOpts();
  const s = simulate(o);
  maxEv = Math.max(maxEv, s.log.ev.length);
  topScore = Math.max(topScore, s.score);
  const checks = s.snaps.map(x => [x.log, x.claimed]);
  checks.push([s.log, s.score]);
  let runRev = false, runInv = false;
  for (const [lg, cl] of checks) {
    snapsChecked++;
    const r = checkLog(s.type, lg, cl);
    if (r.verdict === 'invalid') { runInv = true; if (inv < 5) console.log('honest invalid', r.reasons, JSON.stringify(o.player), o.hz, o.ping); }
    if (r.verdict === 'review') { runRev = true; for (const x of r.reasons) reasons[x.replace(/[\d.]+/g, '#')] = (reasons[x.replace(/[\d.]+/g, '#')] || 0) + 1; }
    if (r.verdict !== 'invalid' && r.score !== cl) { mism++; if (mism < 5) console.log('mismatch', r.score, cl, r.reasons); }
  }
  if (runInv) inv++;
  if (runRev) rev++;
  if (process.env.DN_STATS) { const r = checkLog(s.type, s.log, s.score); for (const k of ['offSdMs', 'lockShare', 'ivSdMs', 'offTightShare']) if (typeof r.stats[k] === 'number' && r.stats.hits >= 20) (statTail[k] = statTail[k] || []).push(r.stats[k]); }
  const b = bySkill[o.skill] = bySkill[o.skill] || { n: 0, sum: 0, max: 0 };
  b.n++; b.sum += s.score; b.max = Math.max(b.max, s.score);
}
const revRate = rev / RUNS;
console.log(`honest: ${RUNS} runs (${snapsChecked} logs checked), invalid ${inv}, review ${rev} (${(revRate * 100).toFixed(2)}%), score mismatch ${mism}, max events ${maxEv}, top score ${topScore}; ` +
  Object.entries(bySkill).map(([k, v]) => `${k} avg ${(v.sum / v.n).toFixed(1)} max ${v.max}`).join(', '));
if (Object.keys(reasons).length) console.log('  review reasons:', reasons);
for (const [k, a] of Object.entries(statTail)) { a.sort((x, y) => x - y); console.log(`  ${k}: n ${a.length}, min ${a[0].toFixed(2)}, p1 ${a[Math.floor(a.length * 0.01)].toFixed(2)}, median ${a[a.length >> 1].toFixed(2)}, max ${a[a.length - 1].toFixed(2)}`); }
if (inv) fail('honest runs invalid: ' + inv);
if (mism) fail('honest score mismatches: ' + mism);
if (revRate > 0.005) fail('honest review rate ' + revRate);

// a2) pause-heavy honest play: strong players who leave and come back 4-12
// times a run (pauses as short as a quick tab-away-and-back, 250 ms). The
// lock/metronome checks and the clock lead now run across pauses.
{
  const N2 = Math.max(200, RUNS >> 2);
  let i2 = 0, r2 = 0, m2 = 0;
  for (let n = 0; n < N2; n++) {
    const o = honestOpts();
    o.player = human(wpick([['top', 0.5], ['elite', 0.3], ['good', 0.2]]), o.ping); o.capMs = 0; o.hides = [];
    o.pauses = []; const np = 4 + Math.floor(rng() * 9);
    for (let k = 0; k < np; k++) o.pauses.push([U(300, 60000), wpick([[U(250, 600), 0.4], [U(600, 5000), 0.5], [U(5000, 60000), 0.1]])]);
    o.pauses.sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < o.pauses.length; k++) o.pauses[k][0] = Math.max(o.pauses[k][0], o.pauses[k - 1][0] + o.pauses[k - 1][1] + 400);
    const s = simulate(o);
    const checks = s.snaps.map(x => [x.log, x.claimed]); checks.push([s.log, s.score]);
    let ri = false, rr = false;
    for (const [lg, cl] of checks) {
      const r = checkLog(s.type, lg, cl);
      if (r.verdict === 'invalid') { ri = true; if (i2 < 3) console.log('pause-heavy invalid', r.reasons); }
      if (r.verdict === 'review') { rr = true; if (r2 < 3) console.log('pause-heavy review', r.reasons, r.stats); }
      if (r.verdict !== 'invalid' && r.score !== cl) m2++;
    }
    if (ri) i2++; if (rr) r2++;
  }
  console.log(`honest, pause-heavy: ${N2} runs, invalid ${i2}, review ${r2}, score mismatch ${m2}`);
  if (i2) fail('pause-heavy honest runs invalid: ' + i2);
  if (m2) fail('pause-heavy honest score mismatches: ' + m2);
  if (r2 / N2 > 0.005) fail('pause-heavy honest review rate ' + r2 / N2);
}

// ── b) forgeries ──
// Own seed and the full skill mix: the forgeries must not depend on how many
// honest runs were drawn before them or on DN_SKILL.
rng = mulberry32(424242);
delete process.env.DN_SKILL;
const results = [];
function expect(name, type, log, claimed, want) {
  const r = checkLog(type, log, claimed);
  const ok = r.verdict === 'invalid' || r.verdict === 'review' || (want === 'low' && r.score <= claimed / 2);
  results.push({ name, verdict: r.verdict, score: r.score, claimed, why: r.reasons[0] || '' });
  if (process.env.DN_DEBUG && name.indexOf(process.env.DN_DEBUG) >= 0) console.log('  [debug]', name, r.reasons, JSON.stringify(r.stats));
  if (!ok) fail(`forgery "${name}" passed as ${r.verdict} (score ${r.score}, claimed ${claimed})`);
  return r;
}
const clone = (x) => JSON.parse(JSON.stringify(x));

// A long honest run to build log-edit forgeries from.
function longHonest(comp) {
  for (let i = 0; i < 500; i++) {
    const o = honestOpts(); o.comp = comp; o.player = human('top', 0); o.ping = 0; o.pauses = []; o.hides = []; o.capMs = 0; o.hz = 60; o.lagRate = 0.05;
    const s = simulate(o);
    const r = checkLog(s.type, s.log, s.score);
    if (s.score >= 40 && r.verdict === 'valid' && s.log.ev.some(e => e[0] === 'K' && e[3] === -1)) return s;
  }
  throw new Error('no long honest run');
}
const H = longHonest(false);
const HC = longHonest(true);
console.log(`  base logs: casual ${H.score} pts / ${H.log.ev.length} ev, comp ${HC.score} pts / ${HC.log.ev.length} ev`);

// 1 no events + claim
{ const l = clone(H.log); l.ev = []; expect('no events + claim', H.type, l, 30); }
// 2 claim above the logged points
expect('claim above logged points', H.type, H.log, H.score + 5);
// 3 times scaled x0.5
{ const l = clone(H.log); for (const e of l.ev) e[1] = Math.round(e[1] * 0.5); expect('times scaled x0.5', H.type, l, H.score); }
// 4 outcomes flipped
{ const l = clone(H.log); const i = l.ev.findIndex(e => e[0] === 'K' && e[3] === -1); l.ev[i][3] = 0; expect('miss flipped to hit', H.type, l, H.score + 1); }
{ // hit flipped to miss (take a hit well inside the zone)
  const l = clone(H.log); let lvl = 0, ph = 0, gs = 0;
  let idx = -1;
  for (let i = 0; i < l.ev.length; i++) {
    const e = l.ev[i];
    if (e[0] === 'L') { lvl = e[2]; ph = e[3]; gs = e[4]; }
    if (e[0] === 'K' && e[3] >= 0 && lvl > 2) { const a = R.barAngle(R.barBase(lvl, ph, e[3]), R.speed(lvl, false), (e[2] - gs) / 1000); if (R.angDist(a, R.NEEDLE) < R.zoneHalf(lvl) * 0.5) { idx = i; break; } }
  }
  l.ev[idx][3] = -1; expect('hit flipped to miss', H.type, l, H.score);
}
// 5 targets outside range / wrong count
{ const l = clone(H.log); const i = l.ev.findIndex((e, j) => j > 0 && e[0] === 'L'); l.ev[i][3] = R.phaseHi(l.ev[i][2]) + 0.02; expect('phase outside the spawn gap', H.type, l, H.score); }
{ const l = clone(H.log); const i = l.ev.findIndex(e => e[0] === 'L' && e[2] === 3); const k = l.ev.findIndex((e, j) => j > i && e[0] === 'K' && e[3] >= 0); l.ev[k][3] = 3; expect('hit on a bar that does not exist (k = count)', H.type, l, H.score); }
{ const l = clone(H.log); const i = l.ev.findIndex((e, j) => j > 0 && e[0] === 'L'); l.ev.splice(i, 1); expect('level-up with no new bars', H.type, l, H.score); }
{ const l = clone(H.log); const i = l.ev.findIndex((e, j) => j > 0 && e[0] === 'L'); l.ev[i][2] += 1; expect('bars for the wrong level', H.type, l, H.score); }
{ // same bar hit twice in a level
  const l = clone(H.log); const i = l.ev.findIndex(e => e[0] === 'L' && e[2] === 4);
  const ks = []; for (let j = i + 1; j < l.ev.length && l.ev[j][0] !== 'L'; j++) if (l.ev[j][0] === 'K' && l.ev[j][3] >= 0) ks.push(j);
  l.ev[ks[1]][3] = l.ev[ks[0]][3]; expect('same bar hit twice', H.type, l, H.score);
}
// 6 cherry-picked easiest spawns (played by a good human)
{
  let s = null;
  for (let i = 0; i < 200 && !s; i++) {
    const o = honestOpts(); o.comp = false; o.player = human('top', 0); o.ping = 0; o.pauses = []; o.hides = []; o.capMs = 0;
    o.phaseU = () => rng() * 0.04;
    const x = simulate(o); if (x.log.ev.filter(e => e[0] === 'L').length >= 6) s = x;
  }
  expect('cherry-picked easiest spawns', s.type, s.log, s.score);
}
// 7 perfect bot on the page (presses at the exact centre, frame-quantised judging)
function botOpts(comp, extra) {
  const o = { comp, hz: 60, lagRate: 0.05, ping: 0, mobile: false, pauses: [], hides: [],
    player: Object.assign({ sigma: 0, bias: 0, rho: 0, pStray: 0, tapGap: 141, reactMed: 1, reactSdLog: 0, pingComp: 0, pSkip: 0, pQuit: 0, lead: 0 }, extra || {}) };
  return o;
}
for (const comp of [false, true]) for (const hz of [60, 144]) {
  const o = botOpts(comp); o.hz = hz; const s = simulate(o);
  expect(`perfect bot (${comp ? 'comp' : 'casual'}, ${hz} Hz, ${s.score} pts)`, s.type, s.log, s.score);
}
// 8 metronome bot: one look per level, then presses every bar period, open loop
for (const comp of [false, true]) {
  const o = botOpts(comp, { metronome: true, bias: 5, reactMed: 250 }); const s = simulate(o);
  expect(`metronome bot (${comp ? 'comp' : 'casual'}, ${s.score} pts)`, s.type, s.log, s.score);
}
// naive fixed-interval spammer (170 ms, no looking): harmless, scores almost nothing
{
  const o = botOpts(false); o.player.pressAt = null;
  const l = [];
  const s = simulate(Object.assign(o, { player: Object.assign(o.player, { pressAt: (c, lv) => c.at, sigma: 0 }) }));
  expect(`perfect bot via pressAt hook (${s.score} pts)`, s.type, s.log, s.score);
}
// 9 superhuman reactions: 40 ms after each spawn / 40 ms after a bar enters the zone
for (const comp of [false, true]) {
  const o = botOpts(comp, { reactMed: 40, pressAt: (c, lv) => c.at - R.zoneHalf(lv) / R.speed(lv, comp) * 1000 + 40 });
  const s = simulate(o);
  expect(`reacts 40 ms after zone entry (${comp ? 'comp' : 'casual'}, ${s.score} pts)`, s.type, s.log, s.score);
}
{ // log edit: first press after each level-up 40 ms after the spawn
  const l = clone(H.log); let lastL = -1;
  for (let i = 0; i < l.ev.length; i++) { const e = l.ev[i]; if (e[0] === 'L' && i > 0) lastL = e[1]; else if (e[0] === 'K' && lastL >= 0) { e[1] = lastL + 40; lastL = -1; } }
  for (let i = 1; i < l.ev.length; i++) if (l.ev[i][1] < l.ev[i - 1][1]) l.ev[i][1] = l.ev[i - 1][1];
  expect('first press 40 ms after each spawn (log edit)', H.type, l, H.score);
}
// 10 impossible order with fine times
{ const l = clone(H.log); const i = l.ev.findIndex((e, j) => j > 0 && e[0] === 'L'); const t = l.ev[i][1]; [l.ev[i - 1], l.ev[i]] = [l.ev[i], l.ev[i - 1]]; l.ev[i - 1][1] = t; l.ev[i][1] = t; expect('new bars before the clearing hit', H.type, l, H.score); }
{ const l = clone(H.log); const i = l.ev.findIndex(e => e[0] === 'K' && e[1] > 3000); l.ev.splice(i, 0, ['P', l.ev[i][1], l.ev[i][2]]); l.ev.splice(i + 2, 0, ['U', l.ev[i + 1][1]]); expect('press while paused', H.type, l, H.score); }
{ const l = clone(H.log); const last = l.ev[l.ev.length - 1]; l.ev.push(['K', last[1] + 200, last[3], 0]); expect('press after the end', H.type, l, H.score + 1); }
{ const l = clone(H.log); const i = l.ev.findIndex(e => e[0] === 'K' && e[1] > 2000); l.ev.splice(i, 0, ['U', l.ev[i][1]]); expect('resume without pause', H.type, l, H.score); }
// 11 replayed honest log with a higher claim (the log a real run sent at 30 points, claiming 77)
{ const sn = H.snaps.find(x => x.claimed === 30); expect('replayed 30-point log, claim 77', H.type, clone(sn.log), 77); }
// partial time compression (x0.8): the game clock gains on the wall
{ const l = clone(H.log); for (const e of l.ev) e[1] = Math.round(e[1] * 0.8); expect('times scaled x0.8', H.type, l, H.score, 'low'); }
// 12 trainer-specific
{ const l = clone(H.log); for (const e of l.ev) { if (e[0] === 'K' || e[0] === 'P') e[2] *= 1.5; if (e[0] === 'L' || e[0] === 'E') e[e.length - 1] *= 1.5; } expect('game clock faster than the wall clock', H.type, l, H.score); }
{ const l = clone(H.log); const i = l.ev.findIndex(e => e[0] === 'K' && e[1] > 3000); for (let j = i; j < l.ev.length; j++) { l.ev[j][1] += 11000; if (l.ev[j][0] === 'K' || l.ev[j][0] === 'P') l.ev[j][2] += 11000; else if (l.ev[j][0] === 'L' || l.ev[j][0] === 'E') l.ev[j][l.ev[j].length - 1] += 11000; } expect('press after the timer ran out', H.type, l, H.score); }
{ // comp keeps going after a miss
  const l = clone(HC.log); const i = l.ev.findIndex(e => e[0] === 'K' && e[3] === -1);
  const e = l.ev[i]; l.ev.splice(i + 1); l.ev.push(['K', e[1] + 300, e[2] + 300, 0]);
  expect('comp keeps playing after its miss', HC.type, l, HC.score);
}
expect('casual log submitted as comp', 'dagger-new-comp', clone(H.log), H.score);
// A script that writes a whole log from the rules (legal by construction):
// each level it takes the earliest bar centre >= 150 ms after its last press.
//   err(lv): judged offset from the centre, game ms; wall(g): wall ms for game ms g
//   extra12: also try a 12th hit at level 12 (the 78th point)
function writeLog(comp, o) {
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const l = { v: 1, rv: 1, type: 'dagger-new' + (comp ? '-comp' : ''), a: 0, env: { w: 1280, h: 800, mob: false, ping: 0 }, ev: [] };
  let g = 0, lastT = -1e9, pts = 0;
  const wall = o.wall || ((x) => Math.round(x + 25));
  for (let lv = 1; lv <= (o.levels || 12); lv++) {
    const ph = R.drawPhase(lv, o.u ? o.u(lv) : rng());
    l.ev.push(['L', lv === 1 ? 0 : lastT, lv, ph, r4(g)]);
    const v = R.speed(lv, comp), n = R.bars(lv), gs = g, per = 2 * Math.PI / v * 1000, left = new Set();
    for (let k = 0; k < n; k++) left.add(k);
    const need = lv === 12 ? (o.extra12 ? 12 : 11) : lv;
    for (let h = 0; h < need; h++) {
      let best = null;
      for (const k of (left.size ? left : [0])) {
        let at = gs + R.normalise(R.NEEDLE - R.barBase(lv, ph, k)) / v * 1000;
        while (at < g + 150) at += per;
        if (!best || at < best.at) best = { k, at };
      }
      const lim = Math.min(0.8 * R.zoneHalf(lv) / v * 1000, 100);
      const gp = best.at + Math.max(-lim, Math.min(lim, o.err ? o.err(lv, v, h) : 0));
      g = gp; const t = Math.max(wall(g), lastT + 141); lastT = t;
      l.ev.push(['K', t, r4(g), best.k]); left.delete(best.k); pts++;
    }
  }
  return { log: l, pts };
}
{ const w = writeLog(false, { extra12: true }); expect(`78 points (12 hits at level 12)`, 'dagger-new', w.log, w.pts); }
for (const comp of [false, true]) {
  const w = writeLog(comp, {});
  expect(`written log, every press at the exact centre (${comp ? 'comp' : 'casual'}, ${w.pts} pts)`, w.log.type, w.log, w.pts);
}
{ // written, with a small fixed-looking jitter (uniform +-1 ms): still machine-tight
  const w = writeLog(false, { err: () => (rng() - 0.5) * 2 });
  expect(`written log, +-1 ms jitter (${w.pts} pts)`, w.log.type, w.log, w.pts);
}
{ // written like a page bot: pressed at each centre instant, judged on the last 60 Hz frame before it
  const F = 1000 / 60; let u = 0;
  const w = writeLog(false, { err: () => (u = rng() * F, -u), wall: (x) => Math.round(x + u + 25) });
  expect(`written log, centre-instant presses judged on 60 Hz frames (${w.pts} pts)`, w.log.type, w.log, w.pts);
}
{ // written metronome: a fixed interval per level, 2 ms longer than the bar spacing (drifts, so not locked to the bars)
  const w = writeLog(false, { err: (lv, v, h) => 2 * h - lv });
  expect(`written metronome with 2 ms/press drift (${w.pts} pts)`, w.log.type, w.log, w.pts);
}
{ // written with the easiest phases (u ~ 0: bar 0 arrives first, soonest)
  const w = writeLog(false, { u: () => rng() * 0.02, err: () => N(0, 20) });
  expect(`written log, cherry-picked phases with human noise (${w.pts} pts)`, w.log.type, w.log, w.pts);
}
{ // timer: level 3's presses a whole number of bar revolutions (> 12 s) later - bars line up, timer does not
  const w = writeLog(false, { levels: 3, err: () => N(0, 20) });
  const l = w.log; const i = l.ev.findIndex(e => e[0] === 'L' && e[2] === 3);
  const per = 2 * Math.PI / R.speed(3, false) * 1000, sh = Math.ceil(12000 / per) * per;
  for (let j = i + 1; j < l.ev.length; j++) { l.ev[j][1] += Math.ceil(sh); l.ev[j][2] = Math.round((l.ev[j][2] + sh) * 1e4) / 1e4; }
  expect('level 3 pressed 12+ s late (bars line up, timer ran out)', l.type, l, w.pts);
}
{ const l = clone(H.log); l.ev.splice(l.ev.length - 1); l.ev.push(['L', l.ev[l.ev.length - 1][1], 13, 0.2, 0]); expect('bars for level 13', H.type, l, H.score); }
{ // the run ends "by the timer" with time left
  const l = clone(H.log); const i = l.ev.findIndex((e, j) => e[0] === 'K' && e[1] > 5000 && l.ev[j + 1][0] === 'K');
  l.ev.splice(i + 1); const last = l.ev[i];
  l.ev.push(['E', last[1] + 20, 'T', last[2] + 10]);
  expect('timer end with time left', H.type, l, l.ev.filter(e => e[0] === 'K' && e[3] >= 0).length);
}
// ── review round 2: pauses as a loophole ──
// Zero-length P/U pairs used to open a new "play segment" each, and every
// segment granted its own 150 ms lead of game clock over wall clock, and hid
// every consecutive-hit pair from the lock and metronome checks.
function withPauses(log, every, durMs) {
  // insert ['P', t, g] ['U', t + dur] after every `every`-th K (shifting later events by dur)
  const out = []; let n = 0, shift = 0;
  for (const e0 of log.ev) {
    const e = e0.slice(); e[1] += shift; out.push(e);
    if (e[0] === 'K' && ++n % every === 0) { out.push(['P', e[1], e[2]]); out.push(['U', e[1] + durMs]); shift += durMs; }
  }
  // a pause cannot sit between a clearing hit and its new bars: move it after the L
  for (let i = 0; i < out.length - 2; i++) if (out[i][0] === 'P' && out[i + 2] && out[i + 2][0] === 'L') { const L = out.splice(i + 2, 1)[0]; L[1] = out[i][1]; out.splice(i, 0, L); }
  log.ev = out; return log;
}
{ // compressed wall clock: each press 140 ms of wall after the last, the game 350 ms, with a 0 ms pause after every press
  const w = writeLog(false, { err: () => N(0, 20), wall: null });
  const l = w.log; let lastT = 0, lastG = 0;
  for (const e of l.ev) { if (e[0] === 'K') { const dg = e[2] - lastG; e[1] = Math.max(lastT + 141, Math.round(lastT + dg - 140)); lastT = e[1]; lastG = e[2]; } else if (e[0] === 'L') e[1] = lastT; }
  withPauses(l, 1, 0);
  const tEnd = l.ev[l.ev.length - 1][1], gEnd = lastG;
  expect(`compressed wall clock via 0 ms pauses after every press (${w.pts} pts, wall ${(tEnd / 1000).toFixed(1)} s for ${(gEnd / 1000).toFixed(1)} s of game)`, l.type, l, w.pts);
}
{ // page bot (centre-instant, 60 Hz frames) that "pauses" for 0 ms after every hit, hiding it from the lock check
  const F = 1000 / 60; let u = 0;
  const w = writeLog(false, { err: () => (u = rng() * F, -u), wall: (x) => Math.round(x + u + 25) });
  withPauses(w.log, 1, 0);
  expect(`centre-instant 60 Hz presses + 0 ms pause after every press (${w.pts} pts)`, w.log.type, w.log, w.pts);
}
{ // the same with 200 ms pauses (the pause time is off the game clock)
  const F = 1000 / 60; let u = 0;
  const w = writeLog(false, { err: () => (u = rng() * F, -u), wall: (x) => Math.round(x + u + 25) });
  withPauses(w.log, 1, 200);
  expect(`centre-instant 60 Hz presses + 200 ms pause after every press (${w.pts} pts)`, w.log.type, w.log, w.pts);
}
{ // written metronome hidden behind a pause after every press
  const w = writeLog(false, { err: (lv, v, h) => 2 * h - lv });
  withPauses(w.log, 1, 0);
  expect(`written metronome + 0 ms pause after every press (${w.pts} pts)`, w.log.type, w.log, w.pts);
}
{ // 60 ms pauses, each buying (under the old per-segment rule) 150 ms of lead: 90 ms net per press
  const w = writeLog(false, { err: () => N(0, 20), wall: null });
  const l = w.log; let lastT = 0, lastG = 0;
  for (const e of l.ev) { if (e[0] === 'K') { const dg = e[2] - lastG; e[1] = Math.max(lastT + 141, Math.round(lastT + dg - 140)); lastT = e[1]; lastG = e[2]; } else if (e[0] === 'L') e[1] = lastT; }
  withPauses(l, 1, 60);
  const last = l.ev[l.ev.length - 1];
  expect(`compressed wall clock via 60 ms pauses (${w.pts} pts, wall ${(last[1] / 1000).toFixed(1)} s for ${(lastG / 1000).toFixed(1)} s of game)`, l.type, l, w.pts);
}

// informational: scripts whose error looks like a person's are NOT caught by design
{ // presses a fixed 25 ms after each frame: a uniform 0-17 ms error (SD 4.8 ms), inside elite-human range
  const F = 1000 / 60;
  const w = writeLog(false, { err: () => -rng() * F, wall: (x) => Math.round(x + 25) });
  const r = checkLog(w.log.type, w.log, w.pts);
  console.log(`  (info) written log, frame-locked presses (uniform 17 ms error): ${r.verdict} ${r.score}/${w.pts}`);
}
{
  const w = writeLog(false, { err: () => N(0, 20) });
  const r = checkLog(w.log.type, w.log, w.pts);
  console.log(`  (info) written log with human-sized noise: ${r.verdict} ${r.score}/${w.pts} - not detectable from the log alone; the SQL record hold is the backstop`);
}

const bad = results.filter(x => !(x.verdict === 'invalid' || x.verdict === 'review' || x.score <= x.claimed / 2));
console.log(`forgeries: ${results.length} tried, ${results.length - bad.length} caught (` +
  results.filter(x => x.verdict === 'invalid').length + ' invalid, ' + results.filter(x => x.verdict === 'review').length + ' review)');
for (const x of results) console.log(`  ${x.verdict.padEnd(7)} ${String(x.score).padStart(3)}/${String(x.claimed).padEnd(3)} ${x.name} :: ${x.why}`);

// ── c) the REAL IIFE (dagger-new.iife.js) in a stub DOM ──
// The simulator above is a re-implementation; this drives the shipped code:
// virtual clock, rAF with vsync stamps (sometimes before the Start/Resume
// stamp), main-thread stalls, the ping delay, coarse (privacy) timers, panel
// hide + Resume at random moments, a second Start while a run is live
// (matchmaking), and a player who reads the bars from the run's own log.
// Every submitted snapshot and every final log must check out.
function realIife(o) {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const src = {
    rules: fs.readFileSync('@qte-scratch/wt2/js/qte-rules.js', 'utf8'),
    part: fs.readFileSync(path.join(__dirname, 'dagger-new.rules.js'), 'utf8'),
    iife: fs.readFileSync(path.join(__dirname, 'dagger-new.iife.js'), 'utf8'),
  };
  let clock = 5000 + rng() * 50000;                                  // true time, ms
  const coarse = o.coarse || 0;
  const perfNow = () => coarse ? Math.floor(clock / coarse) * coarse : clock;
  const rafQ = []; let rafId = 0;
  const els = {};
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  function el(id) {
    return els[id] || (els[id] = { id, style: {}, textContent: '', width: 0, height: 0, _l: {},
      addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }, getContext: () => ctx2d,
      parentElement: { clientWidth: 416 }, classList: { contains: () => true } });
  }
  const docL = {};
  const submits = [], finals = [];
  const sb = {
    console, Math, JSON, Promise, Object, Array, Number, String, Set, Map, Error, isFinite, parseInt,
    setTimeout: () => 0, clearTimeout: () => {},
    performance: { now: perfNow },
    document: { getElementById: el, addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); }, activeElement: { tagName: 'BODY' } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (f) => { rafQ.push({ id: ++rafId, f }); return rafId; },
    cancelAnimationFrame: (id) => { const i = rafQ.findIndex(x => x.id === id); if (i >= 0) rafQ.splice(i, 1); },
    addEventListener() {}, innerWidth: 1280, innerHeight: 800, IS_MOBILE: false,
    _qteCompMode: !!o.comp, _albPing: o.ping || 0,
    _sbStartQteRun: () => Promise.resolve(null),
    _sbSubmitScore: (type, score, packet) => { submits.push({ type, score, log: packet.log }); return Promise.resolve(true); },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(src.rules, sb); vm.runInContext(src.part, sb); vm.runInContext(src.iife, sb);
  const QQ = sb.QteRules, RR = QQ.trainers['dagger-new'];
  const click = (id) => { for (const f of (el(id)._l.click || [])) f({}); };
  const key = () => { for (const f of (docL.keydown || [])) f({ code: 'Space', preventDefault() {} }); };

  // frames and stalls
  const T = 1000 / o.hz; const vs0 = clock + rng() * T;
  const stalls = [];
  { let x = clock; for (let i = 0; i < 400; i++) { x += -Math.log(1 - rng()) * 1000 / o.lagRate; const d = wpick([[U(20, 60), 0.7], [U(60, 250), 0.25], [U(250, 700), 0.05]]); stalls.push([x, x + d]); x += d; } }
  const inStall = (x) => { for (const s of stalls) { if (x >= s[0] && x < s[1]) return s; if (s[0] > x) break; } return null; };
  const later = (x) => { const s = inStall(x); return s ? s[1] + 0.3 : x; };
  function nextFrame(after) {
    let n = Math.floor((after - vs0) / T) + 1, ts = vs0 + n * T, cb = ts + U(0.2, 1.5);
    const s = inStall(cb); if (s) { ts = vs0 + Math.floor((s[1] - vs0) / T) * T; cb = s[1] + U(0.1, 1); }
    if (rng() < 0.2) ts -= U(0, T);            // a stamp from before the callback's own frame
    return { ts, cb };
  }

  // actions: { at, kind }
  const acts = [];
  const add = (at, kind, x) => acts.push(Object.assign({ at, kind }, x || {}));
  click('dagger-new-qte-start-btn');
  let run = QQ.Run.current, frame = nextFrame(clock), paused = false, pendingPress = false;
  if (o.restartAt) add(clock + o.restartAt, 'restart');
  for (const [a, d] of o.pauses || []) { add(clock + a, 'hide'); add(clock + a + d, 'resume'); }
  const sigma = o.sigma, bias = N(0, 8);
  let lastPlan = clock, lastPress = -1e9;
  add(clock + U(200, 400), 'plan');

  function readLog() {
    const s = { L: null, hit: new Set(), sync: null, over: false };
    for (const e of run.log.ev) {
      if (e[0] === 'L') { s.L = e; s.hit = new Set(); s.sync = { t: e[1], g: e[4] }; }
      else if (e[0] === 'K') { if (e[3] >= 0) s.hit.add(e[3]); s.sync = { t: e[1], g: e[2] }; }
      else if (e[0] === 'P') s.sync = { t: e[1], g: e[2] };
      else if (e[0] === 'U') s.sync = { t: e[1], g: s.sync.g };
      else if (e[0] === 'E') s.over = true;
    }
    return s;
  }
  function plan() {
    const s = readLog(); if (s.over || paused) return;
    const lv = s.L[2], ph = s.L[3], gS = s.L[4], v = RR.speed(lv, !!o.comp), per = 2 * Math.PI / v * 1000;
    const tNow = clock - run.t0, gNow = s.sync.g + (tNow - s.sync.t);
    let best = Infinity;
    for (let k = 0; k < RR.bars(lv); k++) {
      if (s.hit.has(k)) continue;
      let tau = RR.normalise(RR.NEEDLE - RR.barAngle(RR.barBase(lv, ph, k), v, (gNow - gS) / 1000)) / v * 1000;
      while (tau < 150 || clock + tau < lastPress + o.gap) tau += per;
      best = Math.min(best, tau);
    }
    if (best === Infinity) { add(clock + U(300, 900), 'press'); return; }  // level 12 with no bars: a stray press
    const at = clock + best + bias + N(0, sigma);
    add(Math.max(clock + 1, at), 'press'); pendingPress = true;
  }

  let guard = 0;
  const endAt = clock + (o.capMs || 400000);
  while (guard++ < 3e6) {
    let ai = -1, ta = Infinity;
    for (let i = 0; i < acts.length; i++) if (acts[i].at < ta) { ta = acts[i].at; ai = i; }
    const tf = rafQ.length ? frame.cb : Infinity;
    const tn = Math.min(ta, tf);
    if (tn === Infinity || tn > endAt) break;
    if (tf <= ta) {
      clock = frame.cb;
      const q = rafQ.splice(0);                 // callbacks queued before this frame
      const ts = coarse ? Math.floor(frame.ts / coarse) * coarse : frame.ts;
      for (const x of q) x.f(ts);
      frame = nextFrame(clock);
      continue;
    }
    const a = acts.splice(ai, 1)[0];
    clock = a.at;
    if (a.kind === 'press') {
      pendingPress = false;
      // physical press now; the handler runs after the ping delay and any stall
      const h = later(clock + (o.ping ? o.ping + wpick([[U(0, 4), 0.95], [U(4, 60), 0.05]]) : 0));
      add(h, 'key'); lastPress = clock;
      add(clock + U(120, 260), 'plan');
      if (o.mashy && rng() < 0.1) add(clock + U(20, 200), 'key');   // a bounce / double tap
      continue;
    }
    if (a.kind === 'key') { key(); continue; }
    if (a.kind === 'plan') { if (!pendingPress) plan(); continue; }
    if (a.kind === 'hide') { sb._onDaggerNewQteHide(); paused = !!(run.log.ev.length && run.log.ev[run.log.ev.length - 1][0] === 'P') || paused; continue; }
    if (a.kind === 'resume') { click('dagger-new-qte-resume-btn'); paused = false; add(clock + U(250, 500), 'plan'); continue; }
    if (a.kind === 'restart') {                 // matchmaking-style Start while the run is live
      finals.push({ type: run.type, log: run.log, closed: run.closed });
      click('dagger-new-qte-start-btn'); run = QQ.Run.current; paused = false; pendingPress = false; add(clock + U(200, 400), 'plan');
      continue;
    }
    if (readLog().over && !acts.some(x => x.kind === 'key')) break;
  }
  finals.push({ type: run.type, log: run.log, closed: run.closed });
  return { submits, finals };
}
{
  const NR = Math.max(60, RUNS >> 4);
  let ri = 0, rr = 0, rm = 0, nsub = 0, top = 0, restarts = 0, rp = 0, rend = 0;
  for (let n = 0; n < NR; n++) {
    const o = {
      comp: rng() < 0.5, hz: pick([30, 60, 60, 120, 144, 240]), lagRate: pick([0.05, 0.3, 1.5]),
      ping: pick([0, 0, 150, 300]), sigma: pick([6, 15, 30, 60]), gap: U(150, 220),
      coarse: wpick([[0, 0.8], [1000 / 60, 0.1], [100, 0.1]]), mashy: rng() < 0.2, pauses: [],
    };
    if (rng() < 0.4) { const np = 1 + Math.floor(rng() * 4); for (let k = 0; k < np; k++) o.pauses.push([U(200, 50000), U(250, 8000)]); o.pauses.sort((a, b) => a[0] - b[0]); for (let k = 1; k < np; k++) o.pauses[k][0] = Math.max(o.pauses[k][0], o.pauses[k - 1][0] + o.pauses[k - 1][1] + 300); }
    if (rng() < 0.1) { o.restartAt = U(1000, 20000); restarts++; }
    const out = realIife(o);
    const logs = out.submits.map(x => [x.type, x.log, x.score]);
    for (const f of out.finals) { rp += f.log.ev.filter(e => e[0] === 'P').length; if (f.log.ev.some(e => e[0] === 'E')) rend++; }
    for (const f of out.finals) logs.push([f.type, f.log, f.log.ev.filter(e => e[0] === 'K' && e[3] >= 0).length]);
    let bi = false, br = false;
    for (const [ty, lg, cl] of logs) {
      if (!cl) continue;
      const r = checkLog(ty, lg, cl);
      nsub++; top = Math.max(top, cl);
      if (r.verdict === 'invalid') { bi = true; if (ri < 3) console.log('real IIFE invalid', r.reasons, JSON.stringify(o)); }
      if (r.verdict === 'review') { br = true; if (rr < 3) console.log('real IIFE review', r.reasons, JSON.stringify(r.stats)); }
      if (r.verdict !== 'invalid' && r.score !== cl) { rm++; if (rm < 3) console.log('real IIFE mismatch', r.score, cl, r.reasons, JSON.stringify(o)); }
    }
    if (bi) ri++; if (br) rr++;
  }
  console.log(`real IIFE: ${NR} runs (${restarts} with a Start mid-run, ${rp} pauses logged, ${rend} logs ended), ${nsub} logs checked, invalid ${ri}, review ${rr}, score mismatch ${rm}, top ${top}`);
  if (ri) fail('real IIFE honest runs invalid: ' + ri);
  if (rm) fail('real IIFE score mismatches: ' + rm);
  if (rr / NR > 0.005) fail('real IIFE review rate ' + rr / NR);
}

{ // loaded without js/qte-rules.js: the IIFE must stop quietly, not throw (a throw would end qte.js there)
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const el = () => ({ style: {}, addEventListener() {}, getContext: () => new Proxy({}, { get: () => () => {} }), parentElement: { clientWidth: 400 } });
  const sb = { console: { error() {} }, document: { getElementById: el, addEventListener() {} }, localStorage: { getItem: () => null }, addEventListener() {} };
  sb.window = sb; vm.createContext(sb);
  try { vm.runInContext(fs.readFileSync(path.join(__dirname, 'dagger-new.iife.js'), 'utf8'), sb); console.log('IIFE without qte-rules.js: stops quietly'); }
  catch (e) { fail('IIFE throws without qte-rules.js: ' + e.message); }
}

console.log(failures ? `FAILED (${failures})` : 'OK');
process.exit(failures ? 1 : 0);
