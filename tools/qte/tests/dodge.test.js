// Node test for the dodge rules: honest simulation + forgeries + the real IIFE.
//   node dodge.test.js        (exit code 1 on any failure)
//   DODGE_RUNS=30000 node dodge.test.js     more honest simulated runs
//   DODGE_SESSIONS=600 node dodge.test.js   more sessions of the real IIFE
'use strict';
require('./_paths.js');
const fs = require('fs');
const path = require('path');
const SP = '@qte-scratch';
const Q = require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const R = Q.trainers['dodge'];
const S = Q.stats;

let failures = 0;
const SIMSTAT = { frames: 0, ms: 0, events: 0 };
function fail(msg) { failures++; console.log('FAIL ' + msg); }

// ── helpers ─────────────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function normal(rng) { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
function lognormal(rng, median, sl) { return median * Math.exp(sl * normal(rng)); }
function pick(rng, a) { return a[Math.floor(rng() * a.length)]; }
function weighted(rng, pairs) { let x = rng() * pairs.reduce((s, p) => s + p[1], 0); for (const p of pairs) { x -= p[1]; if (x < 0) return p[0]; } return pairs[pairs.length - 1][0]; }
const r4 = x => typeof x === 'number' ? Math.round(x * 10000) / 10000 : x;
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function check(type, log, claimed) { return Q.check(type, log, { platform: log.env && log.env.mob ? 'M' : 'C', claimed }); }

// A browser clock clamped to q ms. Firefox jitters the clamp: each quantum has
// its own random midpoint, a time below it rounds down, above it up (monotonic,
// but a clamped time can sit up to q either side of the true one).
function hash01(k, salt) {
  let h = Math.imul(k | 0, 0x9E3779B1) ^ salt;
  h = Math.imul(h ^ h >>> 16, 0x45d9f3b); h = Math.imul(h ^ h >>> 16, 0x45d9f3b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function mkClock(q, jitter, salt) {
  if (!q) return x => x;
  return x => { const k = Math.floor(x / q); if (!jitter) return k * q; return (x / q - k >= hash01(k, salt) ? k + 1 : k) * q; };
}

// ── honest simulation: the IIFE's state machine, driven by a simulated person ──
// Mirrors dodge.iife.js: one pending launch timer (cleared on pause), rAF frames
// with a 50 ms dt clamp, the ping simulator delaying the key, judging at
// processing time against the last frame's whiteX, a resize on every Show (also
// a Show mid-run from clicking the dodge tab again, with no pause).
function simulate(cfg, rng) {
  const comp = cfg.comp, type = 'dodge' + (comp ? '-comp' : '');
  const START = 1000 + rng() * 1000;             // performance.now() at Start
  const qt = mkClock(cfg.clockQ, cfg.jitter, Math.floor(rng() * 1e9));
  const t0 = qt(START);                          // Run.start's t0
  const log = { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: cfg.trackW + 124 + Math.floor(rng() * 60), h: 800, mob: cfg.mob, ping: cfg.ping }, ev: [] };
  let closed = false;
  function ev(T, code, ...f) { if (closed) return; log.ev.push([code, Math.max(0, Math.round(qt(T) - t0)), ...f.map(r4)]); }

  const q = []; let seq = 0;
  function at(t, kind, data) { const it = { t, kind, data, seq: seq++ }; q.push(it); return it; }
  function cancel(it) { if (!it) return; const i = q.indexOf(it); if (i >= 0) q.splice(i, 1); }
  function popMin() {
    let bi = -1;
    for (let i = 0; i < q.length; i++) if (bi < 0 || q[i].t < q[bi].t || (q[i].t === q[bi].t && q[i].seq < q[bi].seq)) bi = i;
    if (bi < 0) return null;
    return q.splice(bi, 1)[0];
  }

  // trainer state
  let running = false, gameStarted = false, paused = false, inFlight = false, done = false;
  let streak = 0, whiteX = 0, travel = 0, lastTime = 0, yc = R.YC_START, yw = 0, trackW = cfg.trackW;
  let frameItem = null, launchItem = null, frozen = false, rafPending = false, freezeEnd = 0;
  const submits = [];

  // display
  const period = 1000 / cfg.hz, phase = rng() * period;
  function vsyncAfter(t) { return phase + (Math.floor((t - phase) / period) + 1) * period; }
  function requestFrame(now, allowPast) {
    if (frozen) { rafPending = true; return; }
    rafPending = false;
    const prev = vsyncAfter(now) - period;
    if (allowPast && now - prev < 3 && rng() < 0.3) { frameItem = at(now + 0.3, 'frame', prev); return; }  // stamp before the request
    let v = vsyncAfter(now);
    if (rng() < cfg.dropP) v += period * (1 + Math.floor(rng() * (cfg.bigDrops ? 8 : 4)));        // jank
    frameItem = at(v + 0.2 + rng() * 0.5, 'frame', v);
  }
  function lateness() { const x = rng(); return x < 0.9 ? rng() * 2 : x < 0.98 ? 2 + rng() * 18 : 20 + rng() * 100; }
  function scheduleLaunch(now, ms) { cancel(launchItem); launchItem = at(now + ms + lateness(), 'launch', null); }

  // the person
  const human = {
    plan: null, keys: [],
    newPlan(earliest) { this.plan = { err: this.drawErr(), committed: false, earliest }; },
    drawErr() {
      let e = cfg.sigma * normal(rng);
      if (rng() < cfg.lapseP) e += 70 * normal(rng);
      return e;
    },
    onFrame(tCb, ts) {
      const p = this.plan;
      if (!inFlight || !p || p.committed || streak >= cfg.maxPoints) return;
      const sp = R.speed(streak, comp);
      const ideal = 50 + trackW * yc - 5;           // bar centred on the target
      const tArr = ts + Math.max(0, ideal - whiteX) / sp * 1000;
      let keyT = tArr + cfg.bias + period / 2 + p.err - cfg.pingComp * cfg.ping;
      if (keyT - tCb > 120) return;                 // not committed yet: keep tracking
      keyT = Math.max(keyT, p.earliest, tCb);
      p.committed = true;
      this.press(keyT);
    },
    press(keyT) {
      const lag = () => cfg.ping > 0 ? cfg.ping + rng() * 3 : 0;
      this.keys.push(at(keyT + lag() + (cfg.exactKeys ? 0 : rng() * 3), 'key', keyT));
      if (rng() < cfg.holdP) {                      // held Space: auto-repeat
        const hold = 520 + rng() * 250;
        for (let r = 500; r < hold; r += 33) this.keys.push(at(keyT + r + lag() + rng() * 3, 'key', keyT + r));
      }
    },
    cancelFrom(t) { for (const k of this.keys.slice()) if (k.data > t && q.includes(k)) cancel(k); },
    onPause(t) { this.cancelFrom(t); this.plan = null; },
    onResume(t) { if (inFlight) this.newPlan(t + lognormal(rng, 270, 0.25)); },
    onLaunch(t) { this.newPlan(t); },
  };

  function failRun(t) {
    running = paused = false; inFlight = false; cancel(launchItem); launchItem = null;
    closed = true; done = true; gameStarted = true;
  }

  function onFrame(it) {
    SIMSTAT.frames++;
    frameItem = null;
    if (!running) return;
    const now = qt(it.data);
    const dt = Math.min((now - lastTime) / 1000, R.DT_CAP);
    lastTime = now;
    if (inFlight) {
      whiteX += R.speed(streak, comp) * dt;
      travel += dt;
      if (whiteX > 50 + trackW) {
        inFlight = false;
        ev(it.t, 'E', 'slow', whiteX, travel * 1000);
        failRun(it.t);
        return;
      }
    }
    human.onFrame(it.t, now);
    requestFrame(it.t, false);
  }
  function onLaunch(it) {
    launchItem = null;
    if (frozen && rng() < 0.5) { launchItem = at(it.t + rng() * 1000, 'launch', null); return; }  // background throttling
    if (!running) return;
    whiteX = 50; travel = 0; inFlight = true;
    ev(it.t, 'L', streak + 1);
    human.onLaunch(it.t);
  }
  function onKey(it) {
    if (!running || paused || !inFlight) return;
    inFlight = false;
    const yx = 50 + trackW * yc - yw / 2;
    const overlap = whiteX < yx + yw + R.TOL && whiteX + R.BAR_W > yx - R.TOL;
    ev(it.t, 'H', streak + 1, whiteX, travel * 1000, overlap ? 1 : 0, qt(it.t) - lastTime);
    if (!overlap) { ev(it.t, 'E', 'miss'); failRun(it.t); return; }
    streak++;
    submits.push({ len: log.ev.length, score: streak });
    yc = R.nextCenter(yc, rng);
    yw = R.width(streak, trackW, comp);
    ev(it.t, 'T', streak + 1, yc, yw);
    scheduleLaunch(it.t, R.NEXT_LAUNCH_MS);
  }
  function onHide(it) {
    if (done || paused || !(gameStarted && running)) return;
    cancel(frameItem); frameItem = null; rafPending = false;
    cancel(launchItem); launchItem = null;
    running = false; paused = true;
    ev(it.t, 'P');
    human.onPause(it.t);
    at(it.t + it.data.hideDur, 'show', it.data);
  }
  function resizeTo(t, nw) { if (nw !== trackW) { trackW = nw; ev(t, 'Z', trackW); } }
  function onShow(it) {
    if (done) return;
    if (it.data.tiny) {
      // the panel came back at a width under 125 px (the track is 0 or less),
      // then the window grew and the tab was clicked again before Resume
      resizeTo(it.t, R.MIN_TRACK_W + Math.floor(rng() * (100 - R.MIN_TRACK_W)));
      at(it.t + 100 + rng() * 500, 'show', { resize: true });
    } else if (it.data.resize) {
      resizeTo(it.t, Math.max(150, Math.min(800, Math.round(Math.max(trackW, 150) + normal(rng) * 150))));
    }
    if (paused) at(it.t + lognormal(rng, 900, 0.5), 'resume', null);
  }
  function onTabClick(it) {                         // Show with no pause: the run goes on
    if (done || paused) return;
    resizeTo(it.t, Math.max(150, Math.min(800, Math.round(trackW + normal(rng) * 150))));
  }
  function onResume(it) {
    if (!paused || done) return;
    paused = false; running = true;
    lastTime = qt(it.t);
    ev(it.t, 'U');
    requestFrame(it.t, true);
    if (!inFlight) scheduleLaunch(it.t, R.RESUME_LAUNCH_MS);
    else human.onResume(it.t);
  }
  function onFreeze(it) {
    if (done) return;
    frozen = true; freezeEnd = it.t + it.data;
    if (frameItem) { cancel(frameItem); frameItem = null; rafPending = true; }
    human.onPause(it.t);
    at(freezeEnd, 'thaw', null);
  }
  function onThaw(it) {
    frozen = false;
    if (done) return;
    if (rafPending && running) requestFrame(it.t, false);
    if (inFlight && running) human.newPlan(it.t + lognormal(rng, 270, 0.25));
  }

  // Start
  ev(START + 0.05, 'G', trackW);
  running = gameStarted = true;
  yw = R.width(0, trackW, comp);
  ev(START + 0.06, 'T', 1, yc, yw);
  lastTime = qt(START + 0.1);
  requestFrame(START + 0.1, false);
  scheduleLaunch(START + 0.1, R.FIRST_LAUNCH_MS);
  for (const p of cfg.pauses) at(START + p.at, 'hide', p);
  for (const f of cfg.freezes) at(START + f.at, 'freeze', f.dur);
  for (const c of cfg.tabclicks) at(START + c.at, 'tabclick', c);

  const LIMIT = START + 3000000;
  while (!done) {
    const it = popMin();
    if (!it || it.t > LIMIT) break;
    switch (it.kind) {
      case 'frame': onFrame(it); break;
      case 'launch': onLaunch(it); break;
      case 'key': onKey(it); break;
      case 'hide': onHide(it); break;
      case 'show': onShow(it); break;
      case 'tabclick': onTabClick(it); break;
      case 'resume': onResume(it); break;
      case 'freeze': onFreeze(it); break;
      case 'thaw': onThaw(it); break;
    }
  }
  SIMSTAT.ms += (log.ev.length ? log.ev[log.ev.length - 1][1] : 0); SIMSTAT.events += log.ev.length;
  return { type, log, score: streak, submits };
}

const SKILLS = [
  { name: 'new', sigma: 45, lapseP: 0.05 },
  { name: 'casual', sigma: 30, lapseP: 0.03 },
  { name: 'regular', sigma: 20, lapseP: 0.02 },
  { name: 'good', sigma: 14, lapseP: 0.015 },
  { name: 'great', sigma: 10, lapseP: 0.01 },
  { name: 'elite', sigma: 7, lapseP: 0.006 },
  { name: 'top', sigma: 5, lapseP: 0.004 },
];

function randomConfig(i, rng) {
  const skill = SKILLS[i % SKILLS.length];
  const comp = (i >> 1) % 2 === 1;
  const ping = [0, 150, 300][Math.floor(i / 14) % 3];
  const plat = weighted(rng, [['desk', 60], ['laptop', 25], ['phone', 15]]);
  const trackW = plat === 'desk' ? 800 : plat === 'laptop' ? 500 + Math.floor(rng() * 300) : 150 + Math.floor(rng() * 200);
  const hz = weighted(rng, [[60, 50], [120, 10], [144, 20], [165, 5], [240, 5], [75, 4], [30, 6], [15, 2], [12, 1]]);
  const pauses = [];
  if (rng() < 0.2) {
    const n = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) pauses.push({ at: rng() * 60000, hideDur: rng() < 0.2 ? 20 + rng() * 400 : 200 + rng() * 30000, resize: rng() < 0.3, tiny: rng() < 0.05 });
  }
  const tabclicks = [];
  if (rng() < 0.05) for (let k = 0; k < 1 + Math.floor(rng() * 3); k++) tabclicks.push({ at: rng() * 60000 });
  const freezes = [];
  if (rng() < 0.1) freezes.push({ at: rng() * 60000, dur: 300 + rng() * 8000 });
  const clock = weighted(rng, [[[0, false], 82], [[1, false], 3], [[1, true], 3], [[100 / 6, false], 2], [[100 / 6, true], 4], [[100, false], 2], [[100, true], 4]]);
  return {
    skill: skill.name, comp, ping, trackW, mob: plat === 'phone', hz,
    dropP: weighted(rng, [[0.001, 50], [0.01, 35], [0.05, 15]]),
    bigDrops: rng() < 0.2,
    sigma: skill.sigma * (0.85 + rng() * 0.3),
    lapseP: skill.lapseP,
    bias: normal(rng) * 8,
    pingComp: ping ? 0.85 + rng() * 0.15 : 0,
    holdP: rng() < 0.3 ? 0.02 : 0,
    maxPoints: pick(rng, [8, 25, 60, 150, 300]),
    clockQ: clock[0], jitter: clock[1],
    pauses, freezes, tabclicks,
  };
}

// ── a) honest ────────────────────────────────────────────────────────────────
// Every log a run sends is checked: the final one and EVERY new-high prefix (a
// fresh player's first run submits at every point). A run counts as held when
// any of them is held.
const HONEST_RUNS = +process.env.DODGE_RUNS || 2400;
const hon = { runs: 0, checks: 0, invalid: 0, review: 0, mismatch: 0, reasons: {}, bySkill: {} };
const rngH = mulberry32(20260922);
let keepLongLog = null, keepMissLog = null;
for (let i = 0; i < HONEST_RUNS; i++) {
  const cfg = randomConfig(i, rngH);
  const sim = simulate(cfg, rngH);
  hon.runs++;
  const bs = hon.bySkill[cfg.skill] = hon.bySkill[cfg.skill] || { n: 0, sum: 0, max: 0, review: 0 };
  bs.n++; bs.sum += sim.score; bs.max = Math.max(bs.max, sim.score);
  const todo = [{ log: sim.log, claimed: sim.score }];
  for (const s of sim.submits) todo.push({ log: Object.assign({}, sim.log, { ev: sim.log.ev.slice(0, s.len) }), claimed: s.score });
  let reviewed = null;
  for (const c of todo) {
    hon.checks++;
    const r = check(sim.type, c.log, c.claimed);
    if (r.verdict === 'invalid') { hon.invalid++; if (hon.invalid <= 5) console.log('  honest invalid:', JSON.stringify(cfg).slice(0, 300), r.reasons); }
    if (r.verdict !== 'invalid' && r.score !== c.claimed) { hon.mismatch++; if (hon.mismatch <= 5) console.log('  honest mismatch:', c.claimed, r.score, r.reasons, r.stats.stopReason, JSON.stringify(cfg).slice(0, 300)); }
    if (r.verdict === 'review' && !reviewed) reviewed = r;
  }
  if (reviewed) {
    hon.review++; bs.review++;
    for (const why of reviewed.reasons) { const k = why.replace(/[\d.]+/g, '#'); hon.reasons[k] = (hon.reasons[k] || 0) + 1; }
  }
  if (!keepLongLog && sim.score >= 40 && cfg.pauses.length === 0 && !cfg.comp && !cfg.clockQ) keepLongLog = sim;
  if (!keepMissLog && sim.score >= 8 && !cfg.clockQ && sim.log.ev.some(e => e[0] === 'E' && e[2] === 'miss')) keepMissLog = sim;
}
const reviewRate = hon.review / hon.runs;
console.log(`honest: ${hon.runs} runs (${hon.checks} checks: final logs + every new-high prefix) - invalid ${hon.invalid}, review ${hon.review} (${(reviewRate * 100).toFixed(2)}%), score mismatch ${hon.mismatch}`);
console.log(`  simulated ${(SIMSTAT.ms / 3600000).toFixed(1)} h of play, ${SIMSTAT.frames} frames, ${SIMSTAT.events} events`);
for (const k of Object.keys(hon.bySkill)) { const b = hon.bySkill[k]; console.log(`  ${k.padEnd(8)} runs ${b.n}  mean score ${(b.sum / b.n).toFixed(1)}  max ${b.max}  review ${b.review}`); }
if (Object.keys(hon.reasons).length) console.log('  review reasons:', hon.reasons);
if (hon.invalid) fail('honest runs judged invalid: ' + hon.invalid);
if (hon.mismatch) fail('honest score mismatches: ' + hon.mismatch);
if (reviewRate > 0.005) fail('honest review rate ' + (reviewRate * 100).toFixed(2) + '% > 0.5%');
if (!keepLongLog || !keepMissLog) fail('simulation produced no long / miss log to forge from');

// ── a2) honest edge cases, one at a time ─────────────────────────────────────
function expectHonest(name, log, claimed) {
  const r = check(log.type, log, claimed);
  const ok = r.verdict === 'valid' && r.score === claimed;
  if (!ok) fail('honest edge case "' + name + '" -> ' + r.verdict + ' ' + r.score + '/' + claimed + ' ' + JSON.stringify(r.reasons) + ' ' + (r.stats.stopReason || ''));
  console.log(`  ${ok ? 'ok    ' : 'BROKEN'}  ${name.padEnd(62)} ${r.verdict} ${r.score}/${claimed}`);
}
function mkLog(type, ev) { return { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: 924, h: 800, mob: false, ping: 0 }, ev }; }
{
  const w0 = r4(R.width(0, 800, false)), w1 = r4(R.width(1, 800, false));
  const x1 = 50 + 800 * 0.7 - 5, tr1 = (x1 - 50) / R.speed(0, false) * 1000;
  // 100 ms clock with jitter: Start rounded up, the launch rounded down - the
  // 400 ms timer logs as 300. A first submit has only four events.
  expectHonest('first submit on a jittered 100 ms clock (launch logs 100 early)', mkLog('dodge',
    [['G', 0, 800], ['T', 0, 1, 0.7, w0], ['L', 300, 1], ['H', 1800, 1, r4(x1), r4(tr1), 1, 7]]), 1);
  // 16.7 ms clock with jitter: the 550 ms gap can log as 516.7 (+ 1 ms rounding).
  const hT = 1817, l2 = hT + 550 - 34;
  const yc2 = 0.63, x2 = 50 + 800 * yc2 - 5, tr2 = (x2 - 50) / R.speed(1, false) * 1000;
  expectHonest('jittered 16.7 ms clock: the 550 ms gap logs 34 ms short', mkLog('dodge',
    [['G', 0, 800], ['T', 0, 1, 0.7, w0], ['L', 400, 1], ['H', hT, 1, r4(x1), r4(tr1), 1, 3],
     ['T', hT, 2, yc2, w1], ['L', l2, 2], ['H', l2 + Math.round(tr2) - 20, 2, r4(x2), r4(tr2), 1, 5]]), 2);
  // Flown ahead of the logged wall time by 50 + 4q (q = 16.7) = 117 ms.
  expectHonest('flown 117 ms ahead of the logged clock (dt clamp + 16.7 ms jitter)', mkLog('dodge',
    [['G', 0, 800], ['T', 0, 1, 0.7, w0], ['L', 400, 1], ['H', 400 + Math.round(tr1) - 117, 1, r4(x1), r4(tr1), 1, 3]]), 1);
  // The panel came back in a window under 125 px while paused (track -60), then
  // at full width before Resume: the points after it count.
  const ev = [['G', 0, 800], ['T', 0, 1, 0.7, w0], ['L', 400, 1], ['H', 1920, 1, r4(x1), r4(tr1), 1, 3], ['T', 1920, 2, yc2, w1],
    ['P', 2000], ['Z', 2200, -60], ['Z', 2600, 800], ['U', 3000], ['L', 3402, 2]];
  ev.push(['H', 3402 + Math.round(tr2) + 4, 2, r4(x2), r4(tr2), 1, 4]);
  expectHonest('track 0 or less while paused, full width again before Resume', mkLog('dodge', ev), 2);
  // A track under 125 px at Start: the bar leaves it on the first frame.
  expectHonest('Start in a window under 125 px (bar leaves at once)', mkLog('dodge',
    [['G', 0, -100], ['T', 0, 1, 0.7, 5], ['L', 401, 1], ['E', 418, 'slow', 50.2, 0.4]]), 0);
}

// ── b) forgeries ─────────────────────────────────────────────────────────────
// A log built directly (not played): hits at ideal + off(k) ms, targets from yc().
const rngF = mulberry32(777);
function forge(o) {
  const comp = !!o.comp, type = 'dodge' + (comp ? '-comp' : ''), trackW = o.trackW === undefined ? 800 : o.trackW, n = o.n || 40;
  const ev = [['G', 0, trackW], ['T', 0, 1, 0.7, r4(R.width(0, trackW, comp))]];
  let yc = 0.7, pend = 400, t = 0;
  for (let k = 1; k <= n; k++) {
    const sp = R.speed(k - 1, comp), yw = R.width(k - 1, trackW, comp);
    const half = yw / 2 + 12;                                    // stay inside the hit window
    let offPx = (o.off ? o.off(k) : 0) * sp / 1000;
    offPx = Math.max(-half, Math.min(half, offPx));
    const x = Math.max(50, 50 + trackW * yc - 5 + offPx);
    const tr = (x - 50) / sp * 1000;
    let L, H;
    if (o.hAt) { H = o.hAt(k); L = Math.round(H - tr - 10); }
    else { L = Math.round(pend + (o.late ? o.late(k) : 1 + rngF() * 4)); H = Math.round(L + tr + (o.lag ? o.lag(k, tr) : 2 + rngF() * 14)); }
    ev.push(['L', L, k], ['H', H, k, r4(x), r4(o.travel ? o.travel(k, tr, H - L) : tr), 1, r4(o.lf ? o.lf(k) : 0)]);
    yc = o.yc ? o.yc(yc, k) : R.nextCenter(yc, rngF);
    ev.push(['T', H, k + 1, r4(yc), r4(o.yw ? o.yw(k, R.width(k, trackW, comp)) : R.width(k, trackW, comp))]);
    pend = H + 550; t = H;
  }
  return { type, log: { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: trackW + 124, h: 800, mob: false, ping: 0 }, ev }, claimed: n };
}
const human = k => normal(rngF) * 14;
const lfH = k => rngF() * 16;
const firstIdx = (f, pred) => f.log.ev.findIndex(pred);
const this_lf = {};

const forgeries = [];
function F(name, build) { forgeries.push({ name, build }); }

F('no events + claim', () => ({ type: 'dodge', log: { v: 1, rv: 1, type: 'dodge', a: 0, env: {}, ev: [] }, claimed: 10 }));
F('only G and T + claim', () => ({ type: 'dodge', log: mkLog('dodge', [['G', 0, 800], ['T', 0, 1, 0.7, 72]]), claimed: 5 }));
F('claim above the logged points', () => ({ type: keepLongLog.type, log: keepLongLog.log, claimed: keepLongLog.score + 5 }));
F('replayed honest log, higher claim', () => ({ type: keepMissLog.type, log: keepMissLog.log, claimed: keepMissLog.score * 3 }));
F('honest log, times x0.5', () => {
  const log = clone(keepLongLog.log); for (const e of log.ev) e[1] = Math.round(e[1] * 0.5);
  return { type: keepLongLog.type, log, claimed: keepLongLog.score };
});
F('launch gaps squeezed to 300 ms', () => forge({ n: 40, off: human, lf: lfH, late: k => k > 1 ? -250 : 0 }));
F('launch gaps squeezed to 300 ms, every time a multiple of 100', () => {
  const f = forge({ n: 40, off: human, lf: lfH, late: k => k > 1 ? -250 : 0 });
  for (const e of f.log.ev) e[1] = Math.round(e[1] / 100) * 100;
  return f;
});
F('logged miss flipped to hit', () => {
  const log = clone(keepMissLog.log); const ev = log.ev;
  const hi = ev.map(e => e[0]).lastIndexOf('H'); ev[hi][5] = 1; ev.splice(hi + 1, 1);   // drop E miss
  return { type: keepMissLog.type, log, claimed: keepMissLog.score + 1 };
});
F('logged miss flipped to hit + next target', () => {
  const log = clone(keepMissLog.log); const ev = log.ev;
  const hi = ev.map(e => e[0]).lastIndexOf('H'); const h = ev[hi]; h[5] = 1;
  const comp = /-comp$/.test(log.type);
  const prevT = ev.slice(0, hi).reverse().find(e => e[0] === 'T');
  const tw = ev.slice(0, hi).reverse().find(e => e[0] === 'G' || e[0] === 'Z')[2];
  ev[hi + 1] = ['T', h[1], h[2] + 1, prevT[3] > 0.7 ? 0.63 : 0.79, r4(R.width(h[2], tw, comp))];
  return { type: keepMissLog.type, log, claimed: keepMissLog.score + 1 };
});
F('target centre out of range', () => forge({ n: 30, off: human, yc: (p, k) => k === 12 ? 0.9 : R.nextCenter(p, rngF) }));
F('target centre repeated (no 0.06 step)', () => forge({ n: 30, off: human, yc: (p, k) => k === 9 ? p : R.nextCenter(p, rngF) }));
F('first target moved', () => { const f = forge({ n: 20, off: human }); f.log.ev[1][3] = 0.64; return f; });
F('wider targets than the streak allows', () => forge({ n: 30, off: human, yw: (k, w) => w * 1.8 }));
F('missing target after a hit', () => { const f = forge({ n: 30, off: human }); const i = firstIdx(f, e => e[0] === 'T' && e[2] === 15); f.log.ev.splice(i, 1); return f; });
F('extra target', () => { const f = forge({ n: 30, off: human }); const i = firstIdx(f, e => e[0] === 'T' && e[2] === 15); f.log.ev.splice(i + 1, 0, f.log.ev[i].slice()); return f; });
F('cherry-picked easiest targets', () => forge({ n: 40, off: human, yc: (p) => p < 0.65 ? 0.68 : 0.62 }));
// Legal (0.06 step) but always as close to the left as allowed: shortest flights.
F('cherry-picked, subtler (always the nearest end)', () => forge({ n: 60, off: human, lf: lfH, yc: (p) => p >= 0.6805 ? 0.62 + rngF() * Math.min(0.02, p - 0.0605 - 0.62) : p + 0.0605 + rngF() * 0.015 }));
F('perfect bot (zero error)', () => forge({ n: 40 }));
F('perfect bot (zero error), only 20 points', () => forge({ n: 20 }));
// a key fired between frames at the exact moment: bar short of the centre by lf ms
F('perfect bot pressing between frames', () => forge({ n: 25, off: k => -(this_lf[k] = rngF() * 16), lf: k => this_lf[k] }));
F('perfect bot, comp', () => forge({ n: 40, comp: true }));
F('perfect bot with 1 ms jitter', () => forge({ n: 60, off: k => normal(rngF) * 1, lf: k => normal(rngF) * 0.5 }));
F('perfect bot playing the real game (frame-quantised bar, exact keys)', () => {
  const cfg = { comp: false, ping: 0, trackW: 800, mob: false, hz: 60, dropP: 0.001, bigDrops: false, sigma: 0, lapseP: 0,
    bias: -500 / 60, pingComp: 0, holdP: 0, maxPoints: 60, clockQ: 0, pauses: [], freezes: [], tabclicks: [], exactKeys: true };
  const sim = simulate(cfg, rngF);
  return { type: sim.type, log: sim.log, claimed: sim.score };
});
F('press without the frame-time field', () => { const f = forge({ n: 20, off: human }); for (const e of f.log.ev) if (e[0] === 'H') e.pop(); return f; });
F('two launches for one target', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'L' && e[2] === 6); f.log.ev.splice(i + 1, 0, ['L', f.log.ev[i][1] + 5, 6]); return f; });
F('press log with honest times, bar placed ahead of its flight', () => forge({ n: 30, off: human, lf: lfH, travel: (k, tr, wall) => tr - 60 }));
F('metronome bot (equal press intervals)', () => forge({ n: 40, off: human, lf: lfH, hAt: k => 2600 + (k - 1) * 2600 }));
F('superhuman reactions (press 40 ms after launch, bar at the target)', () => forge({ n: 30, off: human, lf: lfH, lag: (k, tr) => 40 - tr }));
F('press 40 ms after launch, travel honest', () => forge({ n: 30, off: human, travel: (k, tr, wall) => 40 }));
F('slow motion: bar at half speed, times honest', () => forge({ n: 40, off: human, lf: lfH, lag: (k, tr) => tr + rngF() * 20 }));
F('impossible order (target before its hit)', () => {
  const f = clone(keepLongLog); const ev = f.log.ev;
  const i = ev.findIndex(e => e[0] === 'H' && e[2] === 10); const tmp = ev[i]; ev[i] = ev[i + 1]; ev[i + 1] = tmp;
  return { type: f.type, log: f.log, claimed: f.score };
});
F('impossible order (press logged before its launch, same ms)', () => {
  const f = forge({ n: 20, off: human, lf: lfH }); const ev = f.log.ev;
  const i = ev.findIndex(e => e[0] === 'L' && e[2] === 5); const L = ev[i], H = ev[i + 1]; H[1] = L[1]; ev[i] = H; ev[i + 1] = L;
  return f;
});
F('launch 100 ms after a hit', () => forge({ n: 30, off: human, late: k => k > 1 ? -450 : 3 }));
F('press while paused', () => { const f = forge({ n: 20, off: human }); const i = firstIdx(f, e => e[0] === 'H' && e[2] === 5); f.log.ev.splice(i, 0, ['P', f.log.ev[i][1]]); f.log.ev.splice(i + 3, 0, ['U', f.log.ev[i + 2][1]]); return f; });
F('launch while paused', () => { const f = forge({ n: 20, off: human }); const i = firstIdx(f, e => e[0] === 'L' && e[2] === 5); f.log.ev.splice(i, 0, ['P', f.log.ev[i][1]]); f.log.ev.splice(i + 2, 0, ['U', f.log.ev[i + 1][1]]); return f; });
F('press with no launch', () => { const f = forge({ n: 20, off: human }); const i = firstIdx(f, e => e[0] === 'L' && e[2] === 5); f.log.ev.splice(i, 1); return f; });
F('duplicate press', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'H' && e[2] === 5); f.log.ev.splice(i + 1, 0, f.log.ev[i].slice()); return f; });
F('duplicate pause', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'T' && e[2] === 5); const t = f.log.ev[i][1]; f.log.ev.splice(i + 1, 0, ['P', t], ['P', t], ['U', t]); return f; });
F('resume with no pause', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'T' && e[2] === 5); f.log.ev.splice(i + 1, 0, ['U', f.log.ev[i][1] + 10]); return f; });
F('events after the end', () => { const f = forge({ n: 20, off: human }); f.log.ev.splice(3 * 10 + 2, 0, ['E', f.log.ev[3 * 10 + 1][1], 'reset']); return f; });
F('unknown event code', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'T' && e[2] === 4); f.log.ev.splice(i + 1, 0, ['X', f.log.ev[i][1]]); return f; });
F('unknown end reason', () => { const f = forge({ n: 20, off: human, lf: lfH }); const t = f.log.ev[f.log.ev.length - 1][1]; f.log.ev.push(['E', t + 5, 'win']); f.claimed = 20; return f; });
F('tiny track (40 px) for short flights', () => forge({ n: 40, trackW: 40, off: human, lf: lfH }));
F('zero track: press the moment the bar launches', () => forge({ n: 40, trackW: 0, off: k => 0, lf: lfH, lag: () => 0 }));
F('track resized to 0 before every flight', () => {
  // Start on 800 px, every flight on a 0 px track (the bar starts on the target),
  // back to 800 px between flights
  const f = forge({ n: 30, trackW: 0, off: k => 0, lf: lfH, lag: () => rngF() * 30 }); const ev = f.log.ev;
  ev[0][2] = 800; ev[1][4] = r4(R.width(0, 800, false));
  for (let i = ev.length - 1; i > 1; i--) {
    if (ev[i][0] === 'L') ev.splice(i, 0, ['Z', ev[i][1], 0]);
    else if (ev[i][0] === 'T') ev.splice(i + 1, 0, ['Z', ev[i][1], 800]);
  }
  return f;
});
F('impossible track width (2000)', () => forge({ n: 30, trackW: 2000, off: human }));
F('impossible track width (-500)', () => forge({ n: 30, trackW: -500, off: human }));
F('fractional track width', () => { const f = forge({ n: 30, off: human, lf: lfH }); f.log.ev[0][2] = 799.5; return f; });
F('bar position not matching its flight', () => forge({ n: 30, off: human, travel: (k, tr) => tr * 0.8 }));
F('comp run with casual (wider) targets', () => { const f = forge({ n: 30, off: human }); f.type = 'dodge-comp'; f.log.type = 'dodge-comp'; return f; });
F('a second Start in one log', () => { const f = forge({ n: 20, off: human }); f.log.ev.splice(8, 0, ['G', f.log.ev[7][1], 800]); return f; });
F('slow end with the bar inside the track', () => { const f = forge({ n: 20, off: human }); const t = f.log.ev[f.log.ev.length - 1][1]; f.log.ev.push(['L', t + 560, 21], ['E', t + 900, 'slow', 400, 600]); return f; });
F('NaN-like strings in a press', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'H' && e[2] === 3); f.log.ev[i][3] = 'NaN'; return f; });
F('number as a string (target centre)', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'T' && e[2] === 4); f.log.ev[i][3] = String(f.log.ev[i][3]); return f; });
F('number as a string (launch k)', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'L' && e[2] === 4); f.log.ev[i][2] = '4'; return f; });
F('hit flag true instead of 1', () => { const f = forge({ n: 20, off: human, lf: lfH }); for (const e of f.log.ev) if (e[0] === 'H') e[5] = true; return f; });
F('hit flag 2', () => { const f = forge({ n: 20, off: human, lf: lfH }); for (const e of f.log.ev) if (e[0] === 'H') e[5] = 2; return f; });
F('huge bar x on a hit', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'H' && e[2] === 2); f.log.ev[i][3] = 1e300; return f; });
F('negative bar x on a hit', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'H' && e[2] === 2); f.log.ev[i][3] = -1e6; return f; });
F('negative target k', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'T' && e[2] === 3); f.log.ev[i][2] = -3; return f; });
F('huge flown time', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'H' && e[2] === 2); f.log.ev[i][4] = 1e12; return f; });
F('null fields in a target', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'T' && e[2] === 3); f.log.ev[i][3] = null; f.log.ev[i][4] = null; return f; });
F('object in a field', () => { const f = forge({ n: 20, off: human, lf: lfH }); const i = firstIdx(f, e => e[0] === 'H' && e[2] === 2); f.log.ev[i][3] = { x: 1 }; return f; });
F('huge claim', () => { const f = forge({ n: 20, off: human, lf: lfH }); f.claimed = 1e9; return f; });

let caught = 0;
for (const fg of forgeries) {
  let f;
  try { f = fg.build(); } catch (err) { fail('forgery "' + fg.name + '" failed to build: ' + err.message); continue; }
  // times must stay non-decreasing for validateLog; a forger would sort them
  const r = check(f.type, f.log, f.claimed);
  const far = f.claimed >= 2 && r.score <= f.claimed / 2;
  const ok = r.verdict === 'invalid' || r.verdict === 'review' || far;
  if (ok) caught++;
  else fail('forgery passed: ' + fg.name + ' -> ' + r.verdict + ' ' + r.score + '/' + f.claimed + ' ' + JSON.stringify(r.reasons));
  console.log(`  ${ok ? 'caught' : 'MISSED'}  ${fg.name.padEnd(62)} ${r.verdict.padEnd(7)} score ${r.score}/${f.claimed}  ${(r.reasons[0] || r.stats.stopReason || '').slice(0, 80)}`);
}
console.log(`forgeries: ${caught}/${forgeries.length} caught`);

// ── c) the IIFE and the bot parse ─────────────────────────────────────────────
const IIFE_SRC = fs.readFileSync(path.join(__dirname, 'dodge.iife.js'), 'utf8');
try { new Function(IIFE_SRC); console.log('iife: parses'); } catch (err) { fail('dodge.iife.js does not parse: ' + err.message); }
try { new Function(fs.readFileSync(path.join(__dirname, 'dodge.bot.js'), 'utf8')); console.log('bot: parses'); } catch (err) { fail('dodge.bot.js does not parse: ' + err.message); }

// ── d) the real IIFE on a virtual clock ───────────────────────────────────────
// Runs dodge.iife.js (and, for the behaviour diff, the original lines 971-1210 of
// js/qte.js) against a fake DOM with virtual time: setTimeout with lateness, rAF
// frames on a vsync grid with drops (all callbacks of a frame share its stamp,
// sometimes a stamp from before the request), clamped / jittered clocks, the
// ping simulator, touch on mobile. A player watches what is DRAWN (the yellow
// and white rects) and presses Space, while random hides / shows / resizes /
// tab clicks / mode toggles / Start and Resume clicks hit the trainer at any
// state. Every submitted log and every run's final log is checked.
const ORIG_SRC = fs.readFileSync(SP + '/wt2/js/qte.js', 'utf8').split('\n').slice(970, 1210).join('\n');

function session(o) {
  const rng = mulberry32(o.seed), rngT = mulberry32(o.seed ^ 0x5bd1e995);
  const out = { runs: [], submits: [], trace: [], truth: new Map(), cover: {} };
  const cover = k => { out.cover[k] = (out.cover[k] || 0) + 1; };
  let now = 0;
  const queue = []; let seq = 0, ids = 1;
  function at(t, fn) { const it = { t: Math.max(t, now), fn, seq: seq++, id: ids++ }; queue.push(it); return it.id; }
  function cancel(id) { const i = queue.findIndex(x => x.id === id); if (i >= 0) queue.splice(i, 1); }
  function pop() {
    let bi = -1;
    for (let i = 0; i < queue.length; i++) { const x = queue[i]; if (bi < 0 || x.t < queue[bi].t || (x.t === queue[bi].t && x.seq < queue[bi].seq)) bi = i; }
    return bi < 0 ? null : queue.splice(bi, 1)[0];
  }
  const clock = mkClock(o.q || 0, !!o.jitter, Math.floor(rng() * 1e9));
  const perf = { now: () => clock(now) };
  const late = () => { const x = rng(); return x < 0.9 ? rng() * 2 : x < 0.98 ? 2 + rng() * 18 : 20 + rng() * 100; };
  const fakeSetTimeout = (fn, ms) => at(now + Math.max(0, +ms || 0) + late(), fn);
  const fakeClearTimeout = id => { if (id != null) cancel(id); };
  const trace = (...a) => { if (o.trace) out.trace.push([Math.round(now * 1000) / 1000, ...a]); };

  // frames
  const period = 1000 / (o.hz || 60), phase = rng() * period;
  let frame = null, inFrame = false, rafIds = 1, player = null;
  const rafFrame = new Map();
  let drawn = { yellow: null, white: null };
  function raf(cb) {
    const id = rafIds++;
    if (!frame) {
      let v = phase + (Math.floor((now - phase) / period) + 1) * period, runAt;
      const prev = v - period;
      if (!inFrame && now - prev < 3 && rng() < 0.3) { v = prev; runAt = now + 0.3; }
      else { if (rng() < (o.dropP || 0.005)) v += period * (1 + Math.floor(rng() * 4)); runAt = v + 0.2 + rng() * 0.5; }
      const f = frame = { v, cbs: new Map() };
      at(runAt, () => {
        if (frame === f) frame = null;
        inFrame = true; drawn = { yellow: null, white: null };
        const ts = clock(f.v);
        if (f.cbs.size) cover('frames');
        for (const [cid, cb] of f.cbs) { rafFrame.delete(cid); cb(ts); }
        inFrame = false;
        if (player) player.onFrame();
      });
    }
    frame.cbs.set(id, cb); rafFrame.set(id, frame);
    return id;
  }
  function caf(id) { const f = rafFrame.get(id); if (f) { f.cbs.delete(id); rafFrame.delete(id); } }

  // DOM
  const store = Object.assign({}, o.storage || {});
  const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  function el(id) {
    const e = { id, h: {}, classList: { contains: () => true }, addEventListener(t, f) { this.h[t] = f; } };
    let text = '', disp = '', color = '';
    Object.defineProperty(e, 'textContent', { get: () => text, set: v => { text = String(v); trace(id, 'text', text); if (e.onText) e.onText(text); } });
    e.style = {};
    Object.defineProperty(e.style, 'display', { get: () => disp, set: v => { disp = v; trace(id, 'display', v); } });
    Object.defineProperty(e.style, 'color', { get: () => color, set: v => { color = v; trace(id, 'color', v); } });
    return e;
  }
  const E = {};
  for (const id of ['dodge-qte-status', 'dodge-qte-streak', 'dodge-qte-highscore', 'dodge-qte-start-btn', 'dodge-qte-resume-btn', 'page-qte', 'qte-panel-dodge']) E[id] = el(id);
  E['dodge-qte-resume-btn'].style.display = 'none';
  E['qte-panel-dodge'].style.display = 'flex';
  let lastFailAt = -1e9, lastHitAt = -1e9, runActive = false;
  E['dodge-qte-streak'].onText = v => { const m = /^Streak: (\d+)$/.exec(v); if (m && QteRules.Run.current) out.truth.set(QteRules.Run.current, Math.max(out.truth.get(QteRules.Run.current) || 0, +m[1])); };
  E['dodge-qte-status'].onText = v => {
    if (v === 'Missed the target!' || v === 'Too slow!') { lastFailAt = now; runActive = false; }
    if (v === 'Hit!') lastHitAt = now;
  };
  const wrap = { clientWidth: o.width || 924 };
  const canvas = el('dodge-qte-canvas'); let cw = 300, ch = 150;
  Object.defineProperty(canvas, 'width', { get: () => cw, set: v => { let u = Number(v) >>> 0; if (u > 2147483647) u = 300; cw = u; trace('canvas', 'width', u); } });
  Object.defineProperty(canvas, 'height', { get: () => ch, set: v => { let u = Number(v) >>> 0; if (u > 2147483647) u = 150; ch = u; } });
  canvas.parentElement = wrap;
  let fill = '';
  const ctx2d = {
    set fillStyle(v) { fill = v; }, get fillStyle() { return fill; },
    clearRect() {},
    fillRect(x, y, w, h) {
      if (fill === '#ffcc00') { drawn.yellow = { x, w }; trace('draw', 'y', x, w); }
      else if (fill === '#ffffff') { drawn.white = x; trace('draw', 'w', x); }
    },
  };
  canvas.getContext = () => ctx2d;
  E['dodge-qte-canvas'] = canvas;
  const keyH = [];
  const doc = { getElementById: id => E[id] || null, addEventListener: (t, f) => { if (t === 'keydown') keyH.push(f); }, activeElement: null };
  const winH = {};
  const win = { QteRules: Q, _qteCompMode: !!o.comp, _qteMatch: null, addEventListener: (t, f) => { (winH[t] = winH[t] || []).push(f); } };

  // globals Run.start reads (root = globalThis), and seeded targets
  const saved = {}, G = {
    performance: perf,
    _sbStartQteRun: () => Promise.resolve('ticket'),
    _sbSubmitScore: (type, score, packet) => { out.submits.push({ type, score, log: packet && packet.log, t: now }); return Promise.resolve(true); },
    _albPing: o.ping || 0,
  };
  const realRandom = Math.random;
  for (const k of Object.keys(G)) { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: G[k], configurable: true, writable: true }); }
  Math.random = rngT;
  QteRules.Run.current = null;
  win._sbSubmitScore = (type, score) => { out.submits.push({ type, score, t: now }); };   // the original IIFE's submit
  win._sbStartQteSession = () => {};
  try {
    new Function('window', 'document', 'localStorage', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'IS_MOBILE', 'QteRules',
      o.original ? ORIG_SRC : IIFE_SRC)(win, doc, ls, perf, raf, caf, fakeSetTimeout, fakeClearTimeout, !!o.mobile, Q);

    // ── the player: watches the drawn frame, presses Space / taps ──
    const vis = id => E[id].style.display !== 'none';
    const shown = () => E['qte-panel-dodge'].style.display !== 'none';
    const canSee = () => shown() && canvas.style.display !== 'none';
    function dispatchKey(repeat) {
      if (o.mobile) { if (canSee() && canvas.h.touchstart) canvas.h.touchstart({ preventDefault() {} }); return; }
      const go = () => { const e = { code: 'Space', key: ' ', repeat: !!repeat, preventDefault() {} }; for (const f of keyH) f(e); };
      if (o.ping > 0) { cover('pingKey'); at(now + o.ping + late(), go); } else go();
    }
    let keyIds = [];
    player = {
      prevWhite: null, prevAt: 0, speed: 0, committed: false,
      onFrame() {
        if (!canSee()) { this.prevWhite = null; return; }
        const w = drawn.white, y = drawn.yellow;
        if (w == null || !y) { this.prevWhite = null; this.committed = false; return; }
        if (this.prevWhite == null || w < this.prevWhite - 1) { this.committed = false; this.speed = 0; }   // a new flight
        else if (w > this.prevWhite && now > this.prevAt) this.speed = (w - this.prevWhite) / (now - this.prevAt);
        this.prevWhite = w; this.prevAt = now;
        if (this.committed || !this.speed) return;
        const tArr = now + (y.x + y.w / 2 - 5 - w) / this.speed;
        if (tArr - now > 150) return;
        this.committed = true;
        const err = (o.sigma || 12) * normal(rng) + (rng() < 0.03 ? 60 * normal(rng) : 0);
        const keyAt = Math.max(now, tArr + err - (o.mobile ? 0 : (o.ping || 0) * 0.9));
        keyIds.push(at(keyAt, () => dispatchKey(false)));
        if (rng() < 0.03) for (let r = 500; r < 700; r += 33) keyIds.push(at(keyAt + r, () => dispatchKey(true)));   // held Space
      },
    };

    // clicks and disruptions
    let pendingStart = null, pendingResume = null, lastStartOrResume = -1e9;
    const END = o.duration || 120000;
    function tick() {
      if (now > END) return;
      const allowStart = !o.original && !o.compare ? true : (now - lastFailAt > 1000 && !runActive);
      if (o.autoStart !== false && pendingStart == null && vis('dodge-qte-start-btn') && shown() && allowStart) {
        pendingStart = at(now + lognormal(rng, 700, 0.6), () => {
          pendingStart = null;
          if (!vis('dodge-qte-start-btn') || !shown() || now > END) return;
          if (o.compare && (now - lastFailAt <= 1000 || runActive)) return;
          if (runActive) cover('midRunStart');
          E['dodge-qte-start-btn'].h.click(); lastStartOrResume = now; runActive = true; cover('start');
          if (!o.original) out.runs.push(QteRules.Run.current);
        });
      }
      if (pendingResume == null && vis('dodge-qte-resume-btn') && shown()) {
        pendingResume = at(now + (rng() < 0.2 ? 30 + rng() * 300 : lognormal(rng, 900, 0.6)), () => {
          pendingResume = null;
          if (!vis('dodge-qte-resume-btn') || !shown()) return;
          E['dodge-qte-resume-btn'].h.click(); lastStartOrResume = now; cover('resume');
        });
      }
    }
    // panel widths: the usual one, any real window (a 280 px phone and up), and
    // rarely a transient under 130 px (the track is then 6 px or less)
    function pickWidth() { return weighted(rng, [[o.width || 924, 60], [280 + Math.floor(rng() * 700), 35], [Math.floor(rng() * 130), o.compare ? 0 : 5]]); }
    function hide(autoShow) {
      if (!shown()) return;
      // listed fix: a pause in the first 400 ms of Start / Resume, or in the 550 ms after a hit
      if (o.compare && (now - lastStartOrResume < 700 || now - lastHitAt < 700)) return;
      E['qte-panel-dodge'].style.display = 'none';
      for (const id of keyIds) cancel(id); keyIds = [];
      win._onDodgeQteHide(); cover('hide');
      if (autoShow !== false) at(now + (rng() < 0.3 ? 20 + rng() * 300 : lognormal(rng, 2000, 1)), show);
    }
    function show() {
      if (shown()) return;
      if (rng() < 0.5) wrap.clientWidth = pickWidth();
      E['qte-panel-dodge'].style.display = 'flex';
      win._onDodgeQteShow(); cover('show');
    }
    function tabClick() {
      if (!shown()) return;
      if (o.compare && runActive) return;                       // listed fix: a Start mid-run after this
      if (rng() < 0.5) wrap.clientWidth = pickWidth();
      win._onDodgeQteShow(); cover('tabClick');
    }
    function toggle() {
      if (o.compare && runActive) return;                       // listed fix: the mode is pinned at Start
      if (!vis('dodge-qte-start-btn')) return;                  // core.js refuses while a Start is hidden
      win._qteCompMode = !win._qteCompMode; cover('toggle');
      for (const f of winH['alb-mode-changed'] || []) f();
    }
    function disrupt() {
      if (now > END) return;
      const a = weighted(rng, [[hide, 50], [tabClick, 15], [toggle, o.toggles === false ? 0 : 10], [() => { for (const f of winH['alb-scores-reset'] || []) f(); cover('scoresReset'); }, 2]]);
      a();
      at(now + (rng() < 0.2 ? rng() * 400 : lognormal(rng, o.disruptMs || 5000, 0.8)), disrupt);
    }
    if (o.disrupt !== false) at(lognormal(rng, 3000, 0.5), disrupt);
    const apiClick = id => { E[id].h.click(); if (id === 'dodge-qte-start-btn' && !o.original) out.runs.push(QteRules.Run.current); };
    if (o.script) o.script({ at, click: apiClick, hide, show, tabClick, toggle, win, wrap, E, truth: out.truth, get now() { return now; }, out });
    for (let guard = 0; guard < 5e7; guard++) {
      const it = pop();
      if (!it || it.t > END + 5000) break;
      now = it.t;
      it.fn();
      tick();
    }
    out.store = store;
    out.hs = E['dodge-qte-highscore'].textContent;
  } finally {
    Math.random = realRandom;
    for (const k of Object.keys(G)) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
  }
  return out;
}

// d1) random sessions of the new IIFE: nothing invalid, nothing short
const SESSIONS = +process.env.DODGE_SESSIONS || 400;
const ses = { n: 0, submits: 0, runs: 0, invalid: 0, mismatch: 0, review: 0, points: 0, cover: {} };
const t0 = Date.now();
for (let s = 0; s < SESSIONS; s++) {
  const rng = mulberry32(9000 + s);
  const q = weighted(rng, [[[0, false], 70], [[1, true], 10], [[100 / 6, true], 10], [[100, true], 10]]);
  // a quarter of the sessions: a skilled player left mostly alone (long runs)
  const calm = s % 4 === 3;
  const o = {
    seed: 9000 + s, comp: rng() < 0.5, hz: pick(rng, [30, 60, 60, 60, 144, 240]), q: q[0], jitter: q[1],
    ping: pick(rng, [0, 0, 0, 120, 300]), width: pick(rng, [924, 924, 700, 420, 300]), mobile: rng() < 0.15,
    sigma: calm ? 4 + rng() * 4 : 4 + rng() * 20, dropP: pick(rng, [0.002, 0.01, 0.05]), duration: calm ? 240000 : 90000,
    disruptMs: calm ? 60000 : pick(rng, [2000, 5000, 15000]),
  };
  const out = session(o);
  ses.n++;
  for (const run of out.runs) ses.maxPoints = Math.max(ses.maxPoints || 0, out.truth.get(run) || 0);
  for (const k in out.cover) ses.cover[k] = (ses.cover[k] || 0) + out.cover[k];
  const todo = out.submits.map(sub => ({ type: sub.type, log: sub.log, claimed: sub.score, what: 'submit' }));
  for (const run of out.runs) todo.push({ type: run.type, log: run.log, claimed: out.truth.get(run) || 0, what: 'final' });
  for (const c of todo) {
    const r = check(c.type, c.log, c.claimed);
    if (c.what === 'submit') ses.submits++; else { ses.runs++; ses.points += c.claimed; }
    for (const e of c.log.ev) if (c.what === 'final') {
      if (e[0] === 'Z') ses.cover.Z = (ses.cover.Z || 0) + 1;
      if (e[0] === 'Z' && e[2] <= 0) ses.cover.Zle0 = (ses.cover.Zle0 || 0) + 1;
      if (e[0] === 'E') ses.cover['E ' + e[2]] = (ses.cover['E ' + e[2]] || 0) + 1;
      if (e[0] === 'H' && e[4] < 0) ses.cover.negFlight = (ses.cover.negFlight || 0) + 1;
    }
    if (r.verdict === 'invalid') { ses.invalid++; if (ses.invalid <= 4) console.log('  IIFE invalid:', c.what, c.claimed, JSON.stringify(o), r.reasons, JSON.stringify(c.log.ev).slice(0, 1500)); }
    else if (r.score !== c.claimed) { ses.mismatch++; if (ses.mismatch <= 4) console.log('  IIFE short:', c.what, c.claimed, r.score, r.stats.stopReason, JSON.stringify(o)); }
    if (r.verdict === 'review') ses.review++;
  }
}
console.log(`IIFE sessions: ${ses.n} (${((Date.now() - t0) / 1000).toFixed(1)} s) - ${ses.runs} runs, ${ses.points} points (best run ${ses.maxPoints}), ${ses.submits} submits: invalid ${ses.invalid}, short ${ses.mismatch}, review ${ses.review}`);
console.log('  covered:', JSON.stringify(ses.cover));
if (ses.invalid) fail('real IIFE logs judged invalid: ' + ses.invalid);
if (ses.mismatch) fail('real IIFE logs scored short: ' + ses.mismatch);
if (ses.review) fail('real IIFE logs held for review: ' + ses.review);
for (const k of ['hide', 'show', 'tabClick', 'toggle', 'resume', 'midRunStart', 'pingKey', 'Z', 'Zle0', 'E miss', 'E slow', 'E reset'])
  if (!ses.cover[k]) fail('IIFE sessions never covered: ' + k);

// d2) behaviour diff: the original IIFE and the new one, same inputs, same targets.
// Everything a player sees (texts, colours, buttons, canvas size, every drawn
// target and bar) and every submit (board, score) must match. The listed changes
// are kept out of these sessions: no pause in the first 400 ms of Start/Resume,
// no Start mid-run, no mode toggle mid-run.
let diffs = 0;
for (let s = 0; s < 40; s++) {
  const rng = mulberry32(5000 + s);
  const qc = pick(rng, [[0, false], [0, false], [100 / 6, true], [100, true]]);
  const o = { seed: 5000 + s, comp: rng() < 0.5, hz: pick(rng, [60, 144, 30]), ping: pick(rng, [0, 150]), width: pick(rng, [924, 500, 300]),
    mobile: rng() < 0.2, sigma: 4 + rng() * 15, duration: 60000, trace: true, compare: true, disruptMs: pick(rng, [2000, 4000, 20000]), q: qc[0], jitter: qc[1] };
  const a = session(Object.assign({}, o, { original: true })), b = session(o);
  const n = Math.max(a.trace.length, b.trace.length);
  let bad = -1;
  for (let i = 0; i < n; i++) if (JSON.stringify(a.trace[i]) !== JSON.stringify(b.trace[i])) { bad = i; break; }
  const subA = JSON.stringify(a.submits.map(x => [x.type, x.score])), subB = JSON.stringify(b.submits.map(x => [x.type, x.score]));
  if (bad >= 0 || subA !== subB) {
    diffs++;
    if (diffs <= 3) console.log('  behaviour differs, seed', o.seed, 'at', bad, '\n    original:', JSON.stringify(a.trace.slice(Math.max(0, bad - 3), bad + 2)), '\n    new:     ', JSON.stringify(b.trace.slice(Math.max(0, bad - 3), bad + 2)), '\n    submits', subA.slice(0, 200), subB.slice(0, 200));
  }
}
console.log(`behaviour diff vs the original IIFE: ${40 - diffs}/40 sessions identical`);
if (diffs) fail('the new IIFE behaves differently from the original in ' + diffs + ' sessions');

// d3) directed: a mode toggle mid-run (the dodge tab clicked again shows Start,
// which lets core.js toggle) must not stop the run's new highs reaching its board.
{
  const out = session({ seed: 42, comp: false, sigma: 3, duration: 40000, disrupt: false, autoStart: false,
    storage: { 'alb:dodge-hs': '3', 'alb:dodge-hs-comp': '100' },
    script: api => {
      api.at(200, () => api.click('dodge-qte-start-btn'));
      // tab clicked again (Start shows mid-run), mode toggled, then away and back:
      // Resume brings the run's canvas back and play goes on
      api.at(2500, () => { api.tabClick(); api.toggle(); api.hide(); });
    } });
  const casual = out.submits.filter(x => x.type === 'dodge').map(x => x.score);
  const ok = casual.includes(4) && !out.submits.some(x => x.type !== 'dodge');
  if (!ok) fail('mode toggled mid-run: casual new highs were not submitted (' + JSON.stringify(out.submits.map(x => [x.type, x.score])) + ')');
  console.log(`  ${ok ? 'ok    ' : 'BROKEN'}  toggle mid-run: casual run still submits its new highs (${casual.join(',')}) to 'dodge'`);
  for (const sub of out.submits) { const r = check(sub.type, sub.log, sub.score); if (r.verdict !== 'valid' || r.score !== sub.score) fail('toggle mid-run submit ' + sub.score + ' -> ' + r.verdict + ' ' + r.score); }
}
// d4) directed: a run paused for 12 hours and resumed never submits a log the
// server must reject (validateLog caps event times at 12 h).
{
  let resumedAt = 0;
  const out = session({ seed: 43, comp: false, sigma: 3, duration: 12 * 3600000 + 60000, disrupt: false, autoStart: false,
    script: api => {
      api.at(200, () => api.click('dodge-qte-start-btn'));
      const poll = () => {
        const run = QteRules.Run.current;
        if (run && (api.truth.get(run) || 0) >= 2) {
          api.hide(false);
          api.at(api.now + 12 * 3600000 + 1000, () => { api.show(); resumedAt = api.now; api.at(api.now + 500, () => api.click('dodge-qte-resume-btn')); });
        } else api.at(api.now + 50, poll);
      };
      api.at(300, poll);
    } });
  const later = out.submits.filter(x => x.t > resumedAt);
  let bad = 0;
  for (const sub of out.submits) { const r = check(sub.type, sub.log, sub.score); if (r.verdict === 'invalid') bad++; }
  const ok = resumedAt > 0 && bad === 0 && later.length === 0 && (out.truth.get(out.runs[0]) || 0) > 2;
  if (!ok) fail('12 h pause: ' + JSON.stringify({ resumedAt, bad, later: later.length, points: out.truth.get(out.runs[0]) }));
  console.log(`  ${ok ? 'ok    ' : 'BROKEN'}  run resumed after 12 h: ${out.truth.get(out.runs[0])} points, ${out.submits.length} submits (none after the resume), none invalid`);
}

console.log(failures ? `FAILED (${failures})` : 'OK');
process.exit(failures ? 1 : 0);
