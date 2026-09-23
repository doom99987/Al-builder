// Node test for the spear trainer's check (spear.rules.js).
//   node spear.test.js            (SPEAR_RUNS=n to change the honest count)
// 0) the check's maths (comp tables = the original Math.pow curves; the Gamma
//    tail; spot shares of honest draws uniform, against a brute-force grid);
// a) honest players simulated from the rules, frame by frame, producing the
//    exact log the IIFE writes; b) forgeries; c) the real spear.iife.js in a
//    stub page driven through pauses, resizes, a mid-run Start, a mode switch
//    under a live run, touch taps, restarts and a 12-hour pause, every submit's
//    log checked (SPEAR_IIFE=<file> runs another build); exit 1 on any failure.
'use strict';
require('./_paths.js');
const Q = require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const R = Q.trainers.spear;
if (!R || typeof R.check !== 'function') { console.log('FAIL spear rules did not register'); process.exit(1); }

// ── randomness ───────────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rng(seed) {
  const u = mulberry32(seed);
  const n = () => { let a = 0; while (a === 0) a = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u()); };
  return { u, n, pick: arr => arr[Math.floor(u() * arr.length)], range: (a, b) => a + (b - a) * u(),
    logn: (median, s) => median * Math.exp(s * n()) };
}
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;

// ── the simulator ────────────────────────────────────────────────────────────
// Mirrors js/qte.js SPEAR (spear.iife.js) on a true-time axis: vsync-aligned
// rAF frames (60/120/144 Hz) with drops and rare main-thread stalls, input
// handled before the frame's rAF callbacks, coarse performance clocks, pauses
// at any moment with resizes on show, CSS-scaled canvases, touch double taps.
// o: { comp, mob, W, hz, grain, drop, stallRate, player, pause, quitAt, prefixAt,
//      mods: { spotPick, lateOk, spawnSlow, fakeRetries, bot } }
function simulate(o, seed) {
  const rg = rng(seed), game = rng((seed * 2654435761) >>> 0 ^ 0x5bd1e995);
  const comp = !!o.comp, mob = !!o.mob, mods = o.mods || {};
  const P = 1000 / o.hz, grain = o.grain, base = 1000 + rg.u() * 5000;
  const q = x => Math.floor(x / grain + 1e-9) * grain;
  const t0 = q(base);
  const perf = tau => q(tau + base) - t0;
  const phase = rg.u() * P;
  const vsAtOrBefore = tau => phase + Math.floor((tau - phase) / P) * P;
  const vsAfter = tau => phase + Math.ceil((tau - phase) / P + 1e-9) * P;

  const ev = [];
  let closed = false;
  const log = (tau, code, ...f) => {
    if (closed || ev.length >= Q.LIMITS.MAX_EVENTS) return;
    ev.push([code, Math.max(0, Math.round(perf(tau))), ...f.map(v => typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v)]);
  };

  // stalls (main thread busy): [a, b)
  const stalls = [];
  for (let a = 0; a < 3.6e6;) {
    a += -Math.log(1 - rg.u()) / o.stallRate;
    stalls.push([a, a + rg.range(60, 260)]);
    if (stalls.length > 2000) break;
  }
  let stallIx = 0;
  const stallAt = tau => { while (stallIx < stalls.length && stalls[stallIx][1] <= tau) stallIx++; const s = stalls[stallIx]; return s && s[0] <= tau ? s : null; };

  let W = o.W, H = R.canvasH(W, mob), g = R.geom(H);
  const cssScale = () => { const sx = mob ? 1 : rg.range(0.965, 0.985); return { sx, sy: sx * (H > 340 ? 340 / H : 1) }; };
  let css = cssScale();

  let running = true, paused = false, ended = false, streak = 0, spawnFails = 0, pauseTime = 0;
  let circles = [];
  const plans = [];   // human clicks: {tau, mx, my, cid}
  let cidSeq = 0;
  let snap = null;
  const pl = o.player;

  log(0.01, 'G', W, H);
  let nextSpawn = perf(0.02) + R.C.FIRST_SPAWN;

  // frame scheduling
  let frame = null;   // {ts (perf value), vs (true vsync), cb (true time of callback)}
  function requestFrame(tau, fromInput) {
    let v = vsAtOrBefore(tau);
    if (!(fromInput && tau - v < 0.4 * P && rg.u() < 0.7)) v = vsAfter(tau);
    else if (v < 0) v = vsAfter(tau);
    // dropped vsyncs
    while (rg.u() < o.drop) v += P;
    let cb = Math.max(v, tau) + rg.range(0.2, 3);
    const st = stallAt(cb);
    if (st) { v = vsAfter(st[1]); cb = v + rg.range(0.2, 3); }
    frame = { ts: perf(v), vs: v, cb };
  }
  requestFrame(0.03, true);

  // human
  function plan(c, vsTrue) {
    if (streak + circles.length > o.quitAt + 2) return;         // walked off (stops clicking)
    const d = c.d, open = 1 - g.HT / (g.OUT - g.R);
    let tau;
    if (mods.bot) {
      tau = vsTrue + mods.bot.el(c, g, open, rg) + (frame ? 0 : 0);
    } else {
      const aim = (open + 1) / 2 + pl.bias;
      tau = vsTrue + aim * d + pl.sdT * rg.n();
      if (rg.u() < pl.lapse) tau += pl.lateLapse ? rg.range(pl.lateLapse[0], pl.lateLapse[1]) * d
        : (rg.u() < 0.5 ? -1 : 1) * rg.range(0.25, 0.6) * d;
      const floor = vsTrue + P + rg.logn(pl.react, 0.18) + rg.range(60, 160);
      if (tau < floor) tau = floor + rg.range(0, 20);
    }
    const ps = mods.bot ? mods.bot.pos : pl.sdP;
    const bias = mods.bot ? { sx: 1, sy: 1 } : css;
    const mx = c.x * bias.sx + ps * rg.n(), my = c.y * bias.sy + ps * rg.n();
    plans.push({ tau, mx, my, cid: c.cid });
    if (mob && !mods.bot && rg.u() < 0.03) plans.push({ tau: tau + rg.range(3, 40), mx, my, cid: c.cid, dbl: true });
  }

  // pauses
  const ui = [];
  if (o.pause) {
    let h = 0;
    for (let k = 0; k < o.pause; k++) {
      h += rg.range(500, 40000);
      const show = h + rg.range(200, 20000);
      const resume = show + rg.range(250, 3000);
      ui.push({ tau: h, kind: 'hide' }, { tau: show, kind: 'show' }, { tau: resume, kind: 'resume' });
      h = resume;
    }
  }
  if (o.liveResize) ui.push({ tau: rg.range(2000, 30000), kind: 'show' });   // panel shown again mid-run
  if (mods.stutter) {             // a client that pauses itself over and over (slow motion)
    for (let h = mods.stutter.from || 1500; h < 1.2e6; h += mods.stutter.every + mods.stutter.len) {
      ui.push({ tau: h, kind: 'hide' }, { tau: h + mods.stutter.len, kind: 'resume', extra: mods.stutter.extra || 0 });
    }
  }
  ui.sort((a, b) => a.tau - b.tau);
  const pickState = { lastClick: null };

  function end() { ended = true; running = false; closed = true; }

  function doFrame() {
    const { ts, cb, vs } = frame; frame = null;
    if (!running) return;
    const late = mods.lateOk || 0;
    for (let i = circles.length - 1; i >= 0; i--) {
      const c = circles[i];
      if ((ts - c.st) / c.d >= 1 + late / c.d) {
        log(cb, 'E', 'slow', i, r1(ts - c.st));
        circles.splice(i, 1);
        end(); return;
      }
    }
    if (ts >= nextSpawn && circles.length < R.maxSimul(streak, comp)) {
      const margin = g.margin, minDist = g.minDist;
      let x, y, att = 0, valid = false;
      if (mods.spotPick) {
        const p = mods.spotPick(W, H, g, circles, game, pickState);
        if (p) { x = p.x; y = p.y; valid = true; }
      } else {
        do {
          x = margin + game.u() * (W - margin * 2);
          y = margin + game.u() * (H - margin * 2);
          att++;
          valid = !circles.some(c => Math.hypot(x - c.x, y - c.y) < minDist);
        } while (!valid && att < R.C.TRIES);
      }
      if (valid && mods.spawnSlow && game.u() < mods.spawnSlow.p && !mods.spawnSlow.done) {
        // a client that holds a spawn back: counts it as a failed try
        valid = false;
      }
      if (valid) {
        x = r1(x); y = r1(y);
        const d = R.approach(streak, comp);
        const c = { x, y, st: ts, d, cid: cidSeq++ };
        circles.push(c);
        let nf = spawnFails;
        if (mods.fakeRetries === false && mods.spawnSlow) nf = 0; // hide the held-back tries
        log(cb + 0.004, 'S', r1(ts), x, y, d, nf);
        spawnFails = 0;
        nextSpawn = ts + R.interval(streak, comp);
        plan(c, vs);
      } else {
        spawnFails++;
        nextSpawn = ts + R.C.RETRY_MS;
      }
    }
    requestFrame(cb + 0.01, false);
  }

  function doClick(p, tau) {
    if (!running) return;
    const now = perf(tau);
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      if (Math.hypot(p.mx - c.x, p.my - c.y) > g.reach) continue;
      const el = now - c.st;
      const early = R.isEarly(el, c.d, g);
      log(tau + 0.003, 'K', i, r1(p.mx), r1(p.my), r1(el), early ? 0 : 1);
      pickState.lastClick = { x: p.mx, y: p.my };
      circles.splice(i, 1);
      if (early) { log(tau + 0.005, 'E', 'early'); end(); return; }
      streak++;
      if (streak === o.prefixAt) snap = { ev: ev.map(e => e.slice()), claim: streak };
      return;
    }
  }

  function doUi(u) {
    if (u.kind === 'hide') {
      if (paused || !running) return;
      running = false; paused = true; frame = null;
      pauseTime = perf(u.tau);
      log(u.tau + 0.002, 'P');
    } else if (u.kind === 'show') {
      if (!paused && !running) return;
      if (rg.u() < (paused ? 0.3 : 1)) {
        const W2 = rg.pick(mob ? [351, 390, 412, 600, 744] : [456, 600, 776, 876, 900]);
        const H2 = R.canvasH(W2, mob);
        if (W2 !== W || H2 !== H) { W = W2; H = H2; g = R.geom(H); css = cssScale(); log(u.tau + 0.002, 'G', W, H); }
      }
    } else if (u.kind === 'resume') {
      if (!paused) return;
      const pf = r2(perf(u.tau) - pauseTime + (u.extra || 0));
      for (const c of circles) c.st += pf;
      nextSpawn += pf;
      log(u.tau + 0.002, 'U', pf);
      paused = false; running = true;
      for (const p of plans) p.tau += pf + (mods.bot || mods.stutter ? 0 : 30 * rg.n());
      requestFrame(u.tau + 0.01, true);
    }
  }

  // main loop
  let guard = 0, clock = 0;
  while (!ended && guard++ < 2e6) {
    // earliest pending item
    let best = null, kind = null;
    if (frame && running) { best = frame.cb; kind = 'f'; }
    let pi = -1, ptau = Infinity;
    for (let k = 0; k < plans.length; k++) if (plans[k].tau < ptau) { ptau = plans[k].tau; pi = k; }
    if (pi >= 0 && !paused) {         // nobody clicks a hidden panel; plans move with the resume
      let h = Math.max(ptau, clock + 0.01); const st = stallAt(h); if (st) h = st[1] + 0.05 * (1 + pi % 5);
      if (best === null || h < best) { best = h; kind = 'c'; }
    }
    if (ui.length) ui[0].tau = Math.max(ui[0].tau, clock + 0.01);
    if (ui.length && (best === null || ui[0].tau < best)) { best = ui[0].tau; kind = 'u'; }
    clock = Math.max(clock, best === null ? clock : best);
    if (best === null) break;
    if (kind === 'f') doFrame();
    else if (kind === 'c') {
      const p = plans.splice(pi, 1)[0];
      const live = circles.some(c => c.cid === p.cid);
      if (live || p.dbl) doClick(p, best);
    } else doUi(ui.shift());
    if (!running && !paused) break;
    if (paused && !ui.length) break;           // left for good while paused
  }
  const env = { w: 1000, h: 700, mob, ping: o.ping || 0 };
  const mk = evs => ({ v: 1, rv: Q.RULES_VER, type: 'spear' + (comp ? '-comp' : ''), a: 0, env, ev: evs });
  return { log: mk(ev), claim: streak, prefix: snap ? { log: mk(snap.ev), claim: snap.claim } : null };
}

function check(log, claimed, platform) {
  return Q.check(log.type, log, { platform: platform || 'C', claimed });
}

// ── player / environment draws ───────────────────────────────────────────────
function honestOpts(k, rg) {
  const mob = rg.u() < 0.3;
  const skill = rg.u();                                          // 0 new .. 1 top of board
  const player = {
    sdT: Math.exp(Math.log(60) + (Math.log(7) - Math.log(60)) * skill) * rg.range(0.85, 1.2),
    sdP: (mob ? rg.range(9, 26) : rg.range(4, 22)) * (1.2 - 0.5 * skill),
    bias: rg.range(-0.05, 0.05) * (1 - 0.6 * skill),
    lapse: Math.exp(Math.log(0.06) + (Math.log(0.0008) - Math.log(0.06)) * skill),
    react: rg.range(220, 320),
  };
  const long = rg.u() < 0.15;
  if (k % 100 === 99) {           // a top-of-board marathon
    Object.assign(player, { sdT: rg.range(7, 12), sdP: rg.range(4, 9), bias: 0, lapse: 0.0002, react: rg.range(120, 160) });
    return { comp: rg.u() < 0.5, mob, W: mob ? 744 : 876, hz: 60, grain: 0.1, drop: 0.01, stallRate: 1 / 60000,
      player, pause: 2, quitAt: 2500 + Math.floor(rg.u() * 1500), prefixAt: 1000, ping: 0 };
  }
  return {
    comp: rg.u() < 0.5, mob,
    W: rg.pick(mob ? [351, 390, 412, 600, 744] : [456, 600, 776, 876, 900, 900, 876]),
    hz: rg.pick([60, 60, 60, 120, 144]),
    grain: rg.pick([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 1, 1, 1, 16.67, 16.67, 100]),   // 100: an old resist-fingerprinting clock
    drop: mob && rg.u() < 0.3 ? rg.pick([0.3, 0.5]) : rg.pick([0.003, 0.01, 0.03, 0.08]),
    stallRate: rg.pick([1 / 60000, 1 / 20000, 1 / 5000]),
    player, pause: rg.u() < 0.25 ? 1 + Math.floor(rg.u() * 3) : 0,
    quitAt: long ? 400 + Math.floor(rg.u() * 900) : 20 + Math.floor(rg.u() * 280),
    prefixAt: 1 + Math.floor(rg.u() * 40),
    ping: rg.pick([0, 150, 300]),
    liveResize: rg.u() < 0.05,
  };
}

// required as a module (scratch tools): the simulator only, no test run
if (require.main !== module) { module.exports = { simulate, honestOpts, check }; return; }

let failures = 0;
function fail(msg) { failures++; console.log('  FAIL ' + msg); }

// ── 0) the check's own maths ─────────────────────────────────────────────────
// comp curves: the tables must be exactly what the original Math.pow code gave
for (let s = 0; s <= 400; s++) {
  const x = Math.pow(s / 200, 0.65);
  const want = [Math.min(5 + Math.floor(10 * x), 14), Math.max(500, Math.round(950 - 450 * x)), Math.max(200, Math.round(850 - 650 * x))];
  const got = [R.maxSimul(s, true), R.approach(s, true), R.interval(s, true)];
  if (want.join() !== got.join()) { fail(`comp curves differ from the original at streak ${s}: ${got} vs ${want}`); break; }
  const wc = [Math.min(4 + Math.floor(s / 4), 8), Math.max(850, 1100 - s * 2), Math.max(550, 1000 - s * 10)];
  if (wc.join() !== [R.maxSimul(s, false), R.approach(s, false), R.interval(s, false)].join()) { fail(`casual curves differ at streak ${s}`); break; }
}
// Gamma tail
for (const [n, L, want] of [[1, 3, Math.exp(-3)], [2, 3, Math.exp(-3) * 4], [3, 0.5, Math.exp(-0.5) * (1 + 0.5 + 0.125)], [4000, 4000, 0.5]]) {
  const got = R.gammaUpper(n, L);
  if (Math.abs(got - want) > (n > 100 ? 0.01 : 1e-12)) fail(`gammaUpper(${n}, ${L}) = ${got}, want ${want}`);
}
// spot(): honest draws (rejection sampling, as the trainer does) must give
// uniform ux, uy and w against fixed points, whatever the live set
{
  const gr = rng(99);
  const acc = { ux: [], uy: [], w: [[], [], [], []] };
  let maxErr = 0, maxLnErr = 0;
  for (let k = 0; k < 6000; k++) {
    const mob = gr.u() < 0.4, W = gr.pick(mob ? [351, 390, 412, 600, 744] : [456, 600, 776, 876, 900]), H = R.canvasH(W, mob), g = R.geom(H);
    const n = Math.floor(gr.u() * 9), live = [];
    for (let t = 0; t < 400 && live.length < n; t++) {
      const x = g.margin + gr.u() * (W - 2 * g.margin), y = g.margin + gr.u() * (H - 2 * g.margin);
      if (!live.some(c => Math.hypot(x - c.x, y - c.y) < g.minDist)) live.push({ x: r1(x), y: r1(y) });
    }
    let x, y, ok = false;
    for (let t = 0; t < 2000 && !ok; t++) {
      x = g.margin + gr.u() * (W - 2 * g.margin); y = g.margin + gr.u() * (H - 2 * g.margin);
      ok = !live.some(c => Math.hypot(x - c.x, y - c.y) < g.minDist);
    }
    if (!ok) continue;
    x = r1(x); y = r1(y);   // as the trainer stores and logs it
    // a point anywhere, the oldest and the newest live circle (the new spot
    // can only sit in a ring around those), a point on the box's edge
    const refs = [{ x: gr.range(0, W), y: gr.range(0, H) }, live[0] || { x: W / 2, y: H / 2 }, live[live.length - 1] || { x: gr.range(0, W), y: gr.range(0, H) },
      { x: g.margin + gr.u() * (W - 2 * g.margin), y: g.margin }];
    const sd = R.spot(live, W, H, g, x, y, refs);
    if (sd.ux !== null) acc.ux.push(sd.ux);
    if (sd.uy !== null) acc.uy.push(sd.uy);
    sd.w.forEach((w, j) => acc.w[j].push(w));
    if (k < 80) {   // against a brute-force count on a fine grid
      const b = { xlo: Math.min(g.margin, W - g.margin), xhi: Math.max(g.margin, W - g.margin), ylo: Math.min(g.margin, H - g.margin), yhi: Math.max(g.margin, H - g.margin) };
      const N = 600; let free = 0; const near = [0, 0, 0, 0];
      const dR = refs.map(p => Math.hypot(x - p.x, y - p.y) + 0.15);   // the check pads by 0.15 px (W_PAD)
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const px = b.xlo + (i + 0.5) / N * (b.xhi - b.xlo), py = b.ylo + (j + 0.5) / N * (b.yhi - b.ylo);
        if (live.some(c => Math.hypot(px - c.x, py - c.y) < g.minDist)) continue;
        free++;
        refs.forEach((p, q) => { if (Math.hypot(px - p.x, py - p.y) <= dR[q]) near[q]++; });
      }
      if (free > 1000) sd.w.forEach((w, q) => {
        maxErr = Math.max(maxErr, Math.abs(w - near[q] / free));
        if (near[q] >= 300) maxLnErr = Math.max(maxLnErr, Math.abs(Math.log(w) - Math.log(near[q] / free)));
      });
    }
  }
  const ps = [Q.stats.ksUniform(acc.ux).p, Q.stats.ksUniform(acc.uy).p, ...acc.w.map(a => Q.stats.ksUniform(a).p)];
  // the check sums -ln w: the sums must look like Gamma(n) draws, either way
  const gs = acc.w.map(a => { const L = a.reduce((s, w) => s - Math.log(Math.max(w, 1e-9)), 0); return R.gammaUpper(a.length, L); });
  console.log(`spot maths: ${acc.ux.length} honest draws, KS p ux/uy/w: ${ps.map(p => p.toFixed(3)).join(' ')}; -ln w sums, upper tail p: ${gs.map(p => p.toFixed(3)).join(' ')}; w vs grid max error ${maxErr.toFixed(4)}, ln w ${maxLnErr.toFixed(3)}`);
  if (ps.some(p => p < 1e-3)) fail('spot shares of honest draws are not uniform');
  if (gs.some(p => p < 1e-3)) fail('-ln w of honest draws sums above Gamma(n): honest spots would read as near');
  if (maxErr > 0.015 || maxLnErr > 0.1) fail('areaNear disagrees with a brute-force count');
}

// ── a) honest ────────────────────────────────────────────────────────────────
const RUNS = +(process.env.SPEAR_RUNS || 2400);
const hon = { runs: 0, invalid: 0, review: 0, mismatch: 0, points: 0, maxPts: 0, prefixes: 0, events: 0, maxEv: 0, maxBytes: 0, bpp: 0 };
const reasons = {};
const t0 = Date.now();
const top = rng(20260922);
for (let k = 0; k < RUNS; k++) {
  const o = honestOpts(k, top);
  const res = simulate(o, 1000 + k);
  const outs = [[res.log, res.claim]];
  if (res.prefix) outs.push([res.prefix.log, res.prefix.claim]);
  for (const [lg, cl] of outs) {
    const v = check(lg, cl, o.mob ? 'M' : 'C');
    hon.runs++;
    if (lg === res.log) { hon.points += cl; hon.maxPts = Math.max(hon.maxPts, cl); hon.events += lg.ev.length; hon.maxEv = Math.max(hon.maxEv, lg.ev.length); if (cl >= 500) { const b = JSON.stringify(lg).length; hon.maxBytes = Math.max(hon.maxBytes, b); hon.bpp = Math.max(hon.bpp, b / cl); } }
    else hon.prefixes++;
    if (v.verdict === 'invalid') { hon.invalid++; if (hon.invalid <= 5) console.log('  honest invalid', k, v.reasons, JSON.stringify(o.player)); }
    if (v.verdict === 'review') { hon.review++; for (const x of v.reasons) { const kx = x.replace(/\d[\d.e+-]*/g, '#'); reasons[kx] = (reasons[kx] || 0) + 1; } if (hon.review <= 5) console.log('  honest review', k, v.reasons); }
    if (v.verdict !== 'invalid' && v.score !== cl) { hon.mismatch++; if (hon.mismatch <= 5) console.log('  honest mismatch', k, 'claim', cl, 'score', v.score, v.reasons, v.stats.stopReason); }
  }
}
const revRate = hon.review / hon.runs;
console.log(`honest: ${hon.runs} logs (${RUNS} runs + ${hon.prefixes} mid-run prefixes), invalid ${hon.invalid}, review ${hon.review} (${(100 * revRate).toFixed(2)}%), score mismatch ${hon.mismatch}; mean ${(hon.points / RUNS).toFixed(0)} pts, max ${hon.maxPts} pts, max ${hon.maxEv} events, max ${hon.maxBytes} bytes (${hon.bpp.toFixed(0)} bytes/pt); ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (Object.keys(reasons).length) console.log('  review reasons:', JSON.stringify(reasons));
if (hon.invalid) fail('honest runs rejected');
if (hon.mismatch) fail('honest score mismatch');
if (revRate > 0.005) fail('honest review rate above 0.5%');

// ── b) forgeries ─────────────────────────────────────────────────────────────
const clone = l => JSON.parse(JSON.stringify(l));
const basePlayer = { sdT: 25, sdP: 12, bias: 0, lapse: 0.004, react: 260 };
function base(extra, seed) {
  return simulate(Object.assign({ comp: false, mob: false, W: 876, hz: 60, grain: 0.1, drop: 0.01, stallRate: 1 / 60000,
    player: basePlayer, pause: 0, quitAt: 150, prefixAt: 0 }, extra || {}), seed || 7);
}
// a (forged) run with at least n points
function baseN(extra, n, seed) {
  for (let s = seed; s < seed + 400; s++) { const r = base(extra, s); if (r.claim >= n) return r; }
  throw new Error('no run with ' + n + ' points');
}
// an honest run with at least n points that ends the given way
function honestWith(n, endKind, extra) {
  for (let s = 1; s < 5000; s++) {
    const res = base(extra, s);
    const ev = res.log.ev, last = ev[ev.length - 1];
    if (res.claim < n) continue;
    if (endKind && !(last && last[0] === 'E' && last[2] === endKind)) continue;
    const v = check(res.log, res.claim);
    if (v.verdict !== 'valid') continue;
    return res;
  }
  throw new Error('no honest run found');
}

const forg = [];
// want: 'invalid' | 'review' | 'caught' (invalid or review or score <= claim/2)
//       | a number n: the check must not grant more than n points
function expect(name, log, claimed, want) {
  const v = check(log, claimed);
  const caught = v.verdict === 'invalid' || v.verdict === 'review' || v.score <= claimed / 2;
  const ok = typeof want === 'number' ? (v.verdict !== 'valid' || v.score <= want)
    : want === 'caught' ? caught : v.verdict === want;
  forg.push({ name, verdict: v.verdict, score: v.score, claimed, ok, why: v.reasons[0] || (v.stats.stopReason ? 'stopped: ' + v.stats.stopReason : '') });
  if (!ok) fail(`forgery "${name}" got ${v.verdict} ${v.score}/${claimed}: ${v.reasons.join('; ')}`);
}

const H1 = honestWith(60, 'slow');
const E1 = honestWith(30, 'early');
const PZ = (function () { for (let s = 1; s < 3000; s++) { const r = base({ pause: 2, quitAt: 200 }, s); if (r.claim >= 40 && r.log.ev.some(e => e[0] === 'U') && check(r.log, r.claim).verdict === 'valid') return r; } throw new Error('no paused run'); })();
const COMP = honestWith(60, 'slow', { comp: true });

// 1 no events + claim
expect('no events, claim 40', { v: 1, rv: 1, type: 'spear', a: 0, env: { w: 0, h: 0, mob: false, ping: 0 }, ev: [] }, 40, 'invalid');
{ const l = clone(H1.log); l.ev = [l.ev[0]]; expect('canvas size only, claim 40', l, 40, 'invalid'); }
// 2 claim above the logged points
expect('claim 5 above the log', H1.log, H1.claim + 5, 'invalid');
// 3 times scaled x0.5
{ const l = clone(H1.log);
  for (const e of l.ev) { e[1] = Math.round(e[1] / 2); if (e[0] === 'S') e[2] = r1(e[2] / 2); if (e[0] === 'K') e[5] = r1(e[5] / 2); if (e[0] === 'E' && e[2] === 'slow') e[4] = r1(e[4] / 2); if (e[0] === 'U') e[2] = r2(e[2] / 2); }
  expect('times x0.5', l, H1.claim, 'invalid'); }
{ const l = clone(COMP.log);   // only the log times halved, fields kept
  for (const e of l.ev) e[1] = Math.round(e[1] / 2);
  expect('comp run, event times x0.5', l, COMP.claim, 'invalid'); }
// 4 outcome flipped: the early click marked a hit, its end removed
{ const l = clone(E1.log); l.ev.pop(); const k = l.ev[l.ev.length - 1]; k[6] = 1;
  expect('early click flipped to hit', l, E1.claim + 1, 'invalid'); }
{ const l = clone(H1.log); const k = l.ev.find(e => e[0] === 'K'); k[3] += 200; expect('click out of reach of its circle', l, H1.claim, 'invalid'); }
// 5 targets out of range / wrong for the streak
{ const l = clone(H1.log); const s = l.ev.find(e => e[0] === 'S'); s[3] = 870; expect('circle outside the spawn box', l, H1.claim, 'invalid'); }
{ const l = clone(H1.log); const ss = l.ev.filter(e => e[0] === 'S'); ss[10][5] += 150; expect('approach time not the streak\'s', l, H1.claim, 'invalid'); }
{ const l = clone(COMP.log); const ss = l.ev.filter(e => e[0] === 'S'); for (const s of ss) s[5] = 950;
  expect('comp run with every approach at 950', l, COMP.claim, 'invalid'); }
{ const l = clone(H1.log); const ss = l.ev.filter(e => e[0] === 'S'); ss[3][3] = ss[2][3]; ss[3][4] = ss[2][4];
  expect('circle on top of a live one', l, H1.claim, 'caught'); }
{ // more live circles than the streak allows: 5 spawns in casual at streak 0, no clicks
  const ev = [['G', 0, 876, 333]]; let sp = 300;
  for (let k = 0; k < 5; k++) { ev.push(['S', Math.ceil(sp) + 1, sp, 130 + 150 * k, 150, 1100, 0]); sp += 205; }
  expect('5 live circles at streak 0 (casual cap 4)', { v: 1, rv: 1, type: 'spear', a: 0, env: { mob: false }, ev }, 0, 'invalid'); }
{ const l = clone(H1.log); const ss = l.ev.filter(e => e[0] === 'S'); ss[5][2] = r1(ss[5][2] - 250);
  expect('spawn before the spawn gap', l, H1.claim, 'invalid'); }
{ const l = clone(H1.log); l.ev[0][3] += 40; expect('canvas height not the width\'s', l, H1.claim, 'invalid'); }
{ const l = clone(H1.log); l.type = 'spear-comp'; expect('casual log sent as comp', l, H1.claim, 'invalid'); }
// 6 cherry-picked spots
function centralPick(W, H, g, circles, gm) {       // the most central of four free draws
  let best = null;
  for (let t = 0; t < 40 && !best; t++) {
    for (let k = 0; k < 4; k++) {
      const x = g.margin + gm.u() * (W - 2 * g.margin), y = g.margin + gm.u() * (H - 2 * g.margin);
      if (circles.some(c => Math.hypot(x - c.x, y - c.y) < g.minDist)) continue;
      const dd = Math.abs(x - W / 2);
      if (!best || dd < best.dd) best = { x, y, dd };
    }
  }
  return best;
}
function chainPick(W, H, g, circles, gm) {         // each circle near the last one (little travel)
  for (let t = 0; t < 60; t++) {
    const lx = circles.length ? circles[circles.length - 1].x : W / 2;
    const x = Math.min(W - g.margin, Math.max(g.margin, lx + (gm.u() - 0.5) * 360)), y = g.margin + gm.u() * (H - 2 * g.margin);
    if (!circles.some(c => Math.hypot(x - c.x, y - c.y) < g.minDist)) return { x, y };
  }
  return null;
}
{ const res = baseN({ quitAt: 200, mods: { spotPick: centralPick } }, 60, 11);
  expect(`cherry-picked central spots (${res.claim} pts)`, res.log, res.claim, 'review'); }
{ const res = baseN({ quitAt: 200, mods: { spotPick: chainPick } }, 80, 12);
  expect(`spots chained near the last one (${res.claim} pts)`, res.log, res.claim, 'review'); }
// the nearest of k free spots to a point the player's hand is already at
function nearPick(k, ref) {
  return function (W, H, g, circles, gm, st) {
    const p = ref(circles, st, W, H);
    let best = null, got = 0;
    for (let t = 0; t < 60 * k && got < k; t++) {
      const x = g.margin + gm.u() * (W - 2 * g.margin), y = g.margin + gm.u() * (H - 2 * g.margin);
      if (circles.some(c => Math.hypot(x - c.x, y - c.y) < g.minDist)) continue;
      got++;
      const dd = p ? Math.hypot(x - p.x, y - p.y) : 0;
      if (!best || dd < best.dd) best = { x, y, dd };
    }
    return best;
  };
}
const refClick = (circles, st) => st.lastClick;
const refOldest = circles => circles[0] || null;
for (const [nm, k, ref, comp, n] of [['last click', 3, refClick, false, 150], ['last click', 3, refClick, true, 150], ['oldest live circle', 3, refOldest, true, 150],
  ['oldest live circle', 3, refOldest, false, 150], ['last click', 2, refClick, false, 300], ['last click', 2, refClick, true, 300]]) {
  const res = baseN({ comp, quitAt: n + 100, player: Object.assign({}, basePlayer, { lapse: 0.001 }), mods: { spotPick: nearPick(k, ref) } }, n, 13);
  expect(`${comp ? 'comp ' : ''}spots: nearest of ${k} to the ${nm} (${res.claim} pts)`, res.log, res.claim, 'review');
}
// a marathon that plays straight until spawn 2600, then cherry-picks
{ let n = 0; const late = nearPick(3, refClick);
  const pick = (W, H, g, circles, gm, st) => (++n > 2600 ? late(W, H, g, circles, gm, st) : nearPick(1, refClick)(W, H, g, circles, gm, st));
  const res = baseN({ comp: true, quitAt: 3400, player: Object.assign({}, basePlayer, { sdT: 9, sdP: 6, lapse: 0.00005, react: 130 }), stallRate: 1 / 3.6e6, drop: 0, mods: { spotPick: pick } }, 3300, 41);
  expect(`spots cherry-picked after spawn 2600 (${res.claim} pts)`, res.log, res.claim, 'review'); }
// slow motion: a client that pauses itself (P/U) over and over so the rings stand still half the time
{ const res = baseN({ quitAt: 150, mods: { stutter: { every: 250, len: 250 } } }, 60, 51);
  expect(`self-pausing client, 250 ms on / 250 ms off (${res.claim} pts)`, res.log, res.claim, 'review'); }
{ const res = baseN({ quitAt: 150, mods: { stutter: { every: 1500, len: 400 } } }, 60, 52);
  expect(`self-pausing client, 400 ms every 1.5 s (${res.claim} pts)`, res.log, res.claim, 'review'); }
{ const res = baseN({ quitAt: 150, mods: { stutter: { every: 300, len: 0.5, extra: 19 } } }, 60, 53);
  expect(`zero-length pauses that push rings back 19 ms each (${res.claim} pts)`, res.log, res.claim, 'review'); }
// 7 perfect bot: mid-band, dead centre
{ const res = baseN({ quitAt: 120, mods: { bot: { el: (c, g, open) => c.d * (open + 1) / 2, pos: 0 } } }, 100, 21);
  expect(`perfect bot (${res.claim} pts)`, res.log, res.claim, 'review'); }
// 8 metronome bots: a fixed moment in each circle's life, human-like aim
{ const res = baseN({ quitAt: 120, mods: { bot: { el: (c, g, open, rg) => 0.9 * c.d + 0.4 * rg.n(), pos: 10 } } }, 100, 22);
  expect(`metronome bot, 0.4 ms jitter (${res.claim} pts)`, res.log, res.claim, 'review'); }
{ const res = baseN({ quitAt: 120, mods: { bot: { el: (c, g, open, rg) => c.d - 60 + 1.5 * rg.n(), pos: 10 } } }, 100, 23);
  expect(`fixed 60 ms before close bot (${res.claim} pts)`, res.log, res.claim, 'review'); }
// 9 superhuman: clicks the moment the band opens, ~25 ms in, every time
{ const res = baseN({ quitAt: 120, mods: { bot: { el: (c, g, open, rg) => c.d * open + 25 + 5 * rg.n(), pos: 9 } } }, 60, 24);
  expect(`band-open +25 ms bot, 5 ms jitter (${res.claim} pts)`, res.log, res.claim, 'review'); }
{ const l = clone(H1.log); for (const e of l.ev) if (e[0] === 'K') e[5] = 40;
  expect('hits logged 40 ms after spawn', l, H1.claim, 'invalid'); }
// 10 impossible order
{ const l = clone(H1.log); const ki = l.ev.findIndex(e => e[0] === 'K'); let si = -1;
  for (let j = ki - 1; j >= 0; j--) if (l.ev[j][0] === 'S') { si = j; break; }
  const K = l.ev[ki]; l.ev.splice(ki, 1); l.ev.splice(si, 0, K); K[1] = l.ev[si - 1][1]; K[2] = 0;
  expect('click logged before its circle spawned', l, H1.claim, 'invalid'); }
{ const l = clone(H1.log); const last = l.ev[l.ev.length - 1]; const k = l.ev.filter(e => e[0] === 'K').pop().slice(); k[1] = last[1] + 5; l.ev.push(k);
  expect('click after the run ended', l, H1.claim + 1, 'invalid'); }
{ const l = clone(H1.log); l.ev.splice(20, 0, ['U', l.ev[19][1], 500]); expect('resume without a pause', l, H1.claim, 'invalid'); }
{ const l = clone(H1.log); const ss = l.ev.filter(e => e[0] === 'S'); const tmp = ss[8][2]; ss[8][2] = ss[9][2]; ss[9][2] = tmp;
  expect('frame times swapped between spawns', l, H1.claim, 'invalid'); }
{ const l = clone(PZ.log); const pi = l.ev.findIndex(e => e[0] === 'P'); const P0 = l.ev[pi];
  // a click slipped into the pause
  const k = l.ev.slice(0, pi).filter(e => e[0] === 'K').pop().slice(); k[1] = P0[1];
  l.ev.splice(pi + 1, 0, k);
  expect('click while paused', l, PZ.claim + 1, 'invalid'); }
// 11 replay with a higher claim
expect('replayed honest log, claim x2', H1.log, H1.claim * 2, 'invalid');
// 12 trainer-specific
{ const l = clone(PZ.log); const u = l.ev.find(e => e[0] === 'U'); u[2] += 600; expect('pause shift padded by 600 ms', l, PZ.claim, 'invalid'); }
{ // a client that holds spawns back (fewer circles at once) and says nothing
  const res = baseN({ quitAt: 200, mods: { spawnSlow: { p: 0.6 }, fakeRetries: false } }, 60, 31);
  expect(`spawns held back, hidden (${res.claim} pts)`, res.log, res.claim, 'review'); }
{ // the same, but it claims the held-back spawns as failed placements
  const res = baseN({ quitAt: 200, mods: { spawnSlow: { p: 0.6 } } }, 60, 32);
  expect(`spawns held back as fake retries (${res.claim} pts)`, res.log, res.claim, 'review'); }
{ // a client whose rings close 150 ms late, played by someone who aims late
  const res = baseN({ quitAt: 200, player: Object.assign({}, basePlayer, { bias: 0.16, sdT: 22 }), mods: { lateOk: 150 } }, 60, 33);
  expect(`rings close 150 ms late (${res.claim} pts)`, res.log, res.claim, 'review'); }
{ // the final miss rewritten as a hit 450 ms after the ring closed: no point for it
  const l = clone(H1.log); const e = l.ev.pop();
  const live = []; for (const x of l.ev) { if (x[0] === 'S') live.push(x); if (x[0] === 'K') live.splice(x[2], 1); }
  const c = live[e[3]]; l.ev.push(['K', e[1] + 450, e[3], c[3], c[4], r1(e[4] + 450), 1]);
  expect('final miss rewritten as a hit 450 ms late', l, H1.claim + 1, H1.claim); }
{ // a client that forgives clicks up to 250 ms after the ring closed, used only to survive late slips
  const res = baseN({ quitAt: 300, player: Object.assign({}, basePlayer, { lapse: 0.05, lateLapse: [0.15, 0.35] }), mods: { lateOk: 250 } }, 200, 34);
  expect(`late rescues (${res.claim} pts)`, res.log, res.claim, 'caught'); }
{ const l = clone(H1.log); const ss = l.ev.filter(e => e[0] === 'S'); ss[6][6] = 3;
  expect('retries claimed that the spawn times cannot hold', l, H1.claim, 'invalid'); }
{ // live circle removed from the log (a hard circle dropped): the next click's index no longer fits
  const l = clone(H1.log); const si = l.ev.findIndex((e, i) => i > 40 && e[0] === 'S'); l.ev.splice(si, 1);
  expect('a spawned circle dropped from the log', l, H1.claim, 'caught'); }

// 13) malformed and doctored events: every one rejected or held, never a free score
{
  const at = (l, code, n) => l.ev.filter(e => e[0] === code)[n];
  const muts = [
    ['times x2 (t, sp, el, pf)', l => { for (const e of l.ev) { e[1] *= 2; if (e[0] === 'S') e[2] = r1(e[2] * 2); if (e[0] === 'K') e[5] = r1(e[5] * 2); if (e[0] === 'E' && e[2] === 'slow') e[4] = r1(e[4] * 2); } }],
    ['no canvas size event', l => { l.ev.shift(); }],
    ['a spawn logged twice', l => { const i = l.ev.indexOf(at(l, 'S', 5)); l.ev.splice(i + 1, 0, l.ev[i].slice()); }],
    ['a click logged twice', l => { const i = l.ev.indexOf(at(l, 'K', 5)); l.ev.splice(i + 1, 0, l.ev[i].slice()); }],
    ['a too-early click without its end', l => { l.ev.pop(); }, E1],
    ['an extra field on a spawn', l => { at(l, 'S', 3).push(0); }],
    ['a field on a pause', l => { l.ev.splice(10, 0, ['P', l.ev[9][1], 1]); }],
    ['hit flag 2', l => { at(l, 'K', 4)[6] = 2; }],
    ['hit flag true', l => { at(l, 'K', 4)[6] = true; }],
    ['x as a string', l => { at(l, 'S', 4)[3] = '400'; }],
    ['x as "NaN"', l => { at(l, 'S', 4)[3] = 'NaN'; }],
    ['el null', l => { at(l, 'K', 4)[5] = null; }],
    ['negative x', l => { at(l, 'S', 4)[3] = -400; }],
    ['negative el on a hit', l => { at(l, 'K', 4)[5] = -700; }],
    ['negative spawn frame', l => { at(l, 'S', 0)[2] = -5; }],
    ['negative width', l => { l.ev[0][2] = -876; }],
    ['huge retries count', l => { at(l, 'S', 4)[6] = 1e12; }],
    ['huge el', l => { at(l, 'K', 4)[5] = 1e12; }],
    ['huge x', l => { at(l, 'S', 4)[3] = 1e300; }],
    ['huge width', l => { l.ev[0][2] = 1e9; }],
    ['click index past the live list', l => { at(l, 'K', 4)[2] = 40; }],
    ['click index fractional', l => { at(l, 'K', 4)[2] = 0.5; }],
    ['end reason unknown', l => { l.ev[l.ev.length - 1][2] = 'quit'; }],
    ['"too slow" on a circle not yet closed', l => { const e = l.ev[l.ev.length - 1]; if (e[2] === 'slow') e[4] = r1(e[4] - 200); }],
    ['unknown event code', l => { l.ev.splice(8, 0, ['Z', l.ev[7][1]]); }],
    ['every click on the circle centre', l => { const live = []; for (const e of l.ev) { if (e[0] === 'S') live.push(e); if (e[0] === 'K') { const c = live[e[2]]; e[3] = c[3]; e[4] = c[4]; live.splice(e[2], 1); } } }],
    ['every hit at the same moment of its ring', l => { const live = []; for (const e of l.ev) { if (e[0] === 'S') live.push(e); if (e[0] === 'K') { const c = live[e[2]]; if (e[6] === 1) { e[5] = r1(c[5] * 0.82); e[1] = Math.ceil(c[2] + e[5]); } live.splice(e[2], 1); } } l.ev.sort((a, b) => a[1] - b[1]); }],
  ];
  for (const [name, fn, src] of muts) {
    const b = src || H1, l = clone(b.log);
    fn(l);
    expect(name, l, b.claim, 'caught');
  }
}

let caught = 0;
for (const f of forg) if (f.ok) caught++;
console.log(`forgeries: ${caught}/${forg.length} caught`);
for (const f of forg) console.log(`  ${f.verdict.padEnd(7)} ${String(f.score).padStart(4)}/${String(f.claimed).padEnd(4)} ${f.name}  -- ${f.why}`);

// ── c) the real IIFE in a stub page ──────────────────────────────────────────
// spear.iife.js runs against a fake DOM with a hand-driven clock and rAF. A
// simple human reads each circle from the run's log and clicks (or taps) it;
// a script of page actions runs on top: tab away and back, Resume, the spear
// tab clicked again mid-run (its Start button shows), a mid-run Start (two
// game loops), a mode switch under a live run, a scores reset, a clock that
// jumps while paused, Start again after each fail. Every submit
// (QteRules.Run -> _sbSubmitScore) must check valid with the claimed score,
// for the mode its run started in.
function makePage(opt, seed) {
  const rg = rng(seed);
  // SPEAR_IIFE=<file>: run another build of the IIFE (to prove a test catches a bug)
  const src = require('fs').readFileSync(process.env.SPEAR_IIFE || require('path').join(__dirname, 'spear.iife.js'), 'utf8');
  const pg = { rg, clock: 5000 + rg.u() * 1000, subs: [], raf: [], rafId: 0, timers: [], opt };
  Object.defineProperty(globalThis, 'performance', { value: { now: () => pg.clock }, configurable: true, writable: true });
  function el(id, extra) {
    return Object.assign({ id, style: { display: '' }, textContent: '', checked: false, _l: {},
      addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
      fire(t, e) { (this._l[t] || []).slice().forEach(f => f(e || {})); } }, extra || {});
  }
  const noop = () => {};
  const ctx2d = new Proxy({}, { get: () => noop, set: () => true });
  pg.wrap = { clientWidth: opt.W + 24 };
  pg.canvas = el('spear-qte-canvas', { width: 300, height: 150, parentElement: pg.wrap, getContext: () => ctx2d,
    getBoundingClientRect() { return { left: 17.5, top: 203.25, width: this.width, height: this.height }; } });
  pg.els = { 'spear-qte-canvas': pg.canvas };
  for (const id of ['spear-qte-status', 'spear-qte-streak', 'spear-qte-highscore', 'spear-qte-start-btn', 'spear-qte-resume-btn']) pg.els[id] = el(id);
  pg.store = Object.assign({}, opt.store || {});
  const localStorage = { getItem: k => (k in pg.store ? pg.store[k] : null), setItem: (k, v) => { pg.store[k] = String(v); }, removeItem: k => { delete pg.store[k]; } };
  pg.win = { _qteCompMode: !!opt.comp, _qteMatch: null, _playQteSfx: noop, _l: {},
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    fire(t) { (this._l[t] || []).forEach(f => f({})); } };
  globalThis._sbSubmitScore = (type, score, packet) => { pg.subs.push({ type, score, log: packet.log, run: Q.Run.current }); };
  const fn = new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_MOBILE', 'QteRules', 'setTimeout', src);
  fn(pg.win, { getElementById: id => pg.els[id] || null }, localStorage,
    f => { pg.raf.push({ id: ++pg.rafId, f }); return pg.rafId; },
    id => { pg.raf = pg.raf.filter(x => x.id !== id); },
    !!opt.mob, Q, (f, ms) => { pg.timers.push({ at: pg.clock + ms, f }); });
  return pg;
}
const shown = b => b.style.display !== 'none';
// core.js _toggleQteMode: refused while any Start button is hidden
function toggleMode(pg) {
  if (!shown(pg.els['spear-qte-start-btn'])) return false;
  pg.win._qteCompMode = !pg.win._qteCompMode;
  pg.win.fire('alb-mode-changed');
  return true;
}
// script: [{ at: ms after the page's first Start, act, ... }]
function drive(pg, script, dur) {
  const { rg, opt } = pg;
  const P = 1000 / opt.hz, t00 = pg.clock;
  let nextFrame = pg.clock + P * rg.u();
  let botRun = null, seen = 0, plans = [], g = null, hidden = false, restartAt = Infinity;
  const todo = script.slice().sort((a, b) => a.at - b.at);
  const notes = { runs: 0, toggled: 0, jumps: 0 };
  pg.els['spear-qte-start-btn'].fire('click');
  while (pg.clock < t00 + dur) {
    const run = Q.Run.current;
    if (run !== botRun) { botRun = run; seen = 0; plans = []; notes.runs++; }
    const ev = run.log.ev;
    for (; seen < ev.length; seen++) {
      const e = ev[seen];
      if (e[0] === 'G') g = R.geom(e[3]);
      else if (e[0] === 'S' && ev.filter(x => x[0] === 'K' && x[6] === 1).length < opt.quitAt) {
        const [, , sp, x, y, d] = e, open = d * (1 - g.HT / (g.OUT - g.R));
        let el2 = (open + d) / 2 + opt.sdT * rg.n();
        if (rg.u() < 0.01) el2 += (rg.u() < 0.5 ? -1 : 1) * 0.4 * d;
        plans.push({ at: run.t0 + sp + el2, x: x + 6 * rg.n(), y: y + 6 * rg.n() });
      } else if (e[0] === 'U') for (const p of plans) p.at += e[2];
    }
    // Start again after a fail, when the button is back
    if (opt.restart && run.closed && !hidden && shown(pg.els['spear-qte-start-btn'])) {
      if (restartAt === Infinity) restartAt = pg.clock + rg.range(200, 3000);
      else if (pg.clock >= restartAt) { restartAt = Infinity; pg.els['spear-qte-start-btn'].fire('click'); continue; }
    }
    // page actions
    while (todo.length && pg.clock >= t00 + todo[0].at) {
      const a = todo.shift();
      if (a.act === 'hide') { pg.win._onSpearQteHide(); hidden = true; }
      else if (a.act === 'show') { if (a.W) pg.wrap.clientWidth = a.W + 24; pg.win._onSpearQteShow(); hidden = false; }
      else if (a.act === 'resume') { if (shown(pg.els['spear-qte-resume-btn'])) pg.els['spear-qte-resume-btn'].fire('click'); }
      else if (a.act === 'start') { if (shown(pg.els['spear-qte-start-btn'])) pg.els['spear-qte-start-btn'].fire('click'); }
      else if (a.act === 'mode') { if (toggleMode(pg)) notes.toggled++; }
      else if (a.act === 'reset') pg.win.fire('alb-scores-reset');
      else if (a.act === 'jump') { pg.clock += a.ms; nextFrame = pg.clock + P * rg.u(); notes.jumps++; }
    }
    // the next thing to happen
    let nextPlan = Infinity, pi = -1;
    for (let k = 0; k < plans.length; k++) if (plans[k].at < nextPlan) { nextPlan = plans[k].at; pi = k; }
    let nextTimer = Infinity;
    for (const t of pg.timers) nextTimer = Math.min(nextTimer, t.at);
    const nextAct = todo.length ? t00 + todo[0].at : Infinity;
    const nextRestart = restartAt;
    const tNext = Math.min(nextFrame, hidden ? Infinity : nextPlan, nextTimer, nextAct, nextRestart, t00 + dur);
    pg.clock = Math.max(pg.clock, tNext) + rg.u() * 0.3;
    if (!hidden && pi >= 0 && plans[pi].at <= pg.clock) {
      const p = plans.splice(pi, 1)[0];
      const rect = pg.canvas.getBoundingClientRect();
      if (opt.mob && opt.touch) pg.canvas.fire('touchstart', { preventDefault: () => {}, changedTouches: [{ clientX: rect.left + p.x, clientY: rect.top + p.y }] });
      else pg.canvas.fire('click', { clientX: rect.left + p.x, clientY: rect.top + p.y });
    }
    if (pg.clock >= nextFrame) {
      const q = pg.raf; pg.raf = [];
      const ts = nextFrame;
      for (const x of q) x.f(ts);
      nextFrame += P * (rg.u() < opt.drop ? 2 + Math.floor(rg.u() * 2) : 1);
      if (nextFrame < pg.clock) nextFrame = pg.clock + P * rg.u();
    }
    for (let k = pg.timers.length - 1; k >= 0; k--) if (pg.timers[k].at <= pg.clock) pg.timers.splice(k, 1)[0].f();
  }
  return notes;
}
// every submit of a page: valid, the claimed score proven, the log's type the
// submit's type, times inside the rules' limit
const iife = { pages: 0, runs: 0, subs: 0, bad: 0, points: 0, maxPts: 0 };
function audit(name, pg, extra) {
  iife.pages++;
  let bad = 0;
  for (const s of pg.subs) {
    iife.subs++;
    const v = Q.check(s.type, s.log, { platform: pg.opt.mob ? 'M' : 'C', claimed: s.score });
    const why = v.verdict !== 'valid' ? v.verdict + ' ' + v.reasons.join('; ') : v.score !== s.score ? 'proved ' + v.score : s.log.type !== s.type ? 'log type ' + s.log.type : '';
    if (why) { bad++; iife.bad++; if (iife.bad <= 8) console.log(`  iife ${name}: submit ${s.score} (${s.type}) ${why}`); }
    iife.maxPts = Math.max(iife.maxPts, s.score);
  }
  if (extra) { const e = extra(); if (e) { iife.bad++; console.log(`  iife ${name}: ${e}`); } }
  return bad;
}
const savedPerf = Object.getOwnPropertyDescriptor(globalThis, 'performance');
const pick = (rg, a) => a[Math.floor(rg.u() * a.length)];
// 1) ordinary play: pauses with resizes on show, mobile taps, Start again after fails
for (let k = 0; k < 120; k++) {
  const top2 = rng(777 + k);
  const opt = { comp: k % 2 === 1, mob: k % 5 === 0, touch: true, W: pick(top2, [351, 456, 600, 776, 876]), hz: pick(top2, [60, 120, 144]),
    drop: 0.02, sdT: top2.range(10, 30), quitAt: 30 + Math.floor(top2.u() * 150), restart: true };
  const pg = makePage(opt, 5000 + k), script = [];
  if (k % 3 === 0) {
    for (let h = top2.range(2000, 20000), n = 0; n < 1 + (k % 4); n++) {
      const s = h + top2.range(300, 5000), r = s + top2.range(200, 1500);
      script.push({ at: h, act: 'hide' }, { at: s, act: 'show', W: top2.u() < 0.5 ? pick(top2, [456, 600, 776, 900]) : 0 }, { at: r, act: 'resume' });
      h = r + top2.range(1000, 30000);
    }
  }
  const notes = drive(pg, script, 240000);
  iife.runs += notes.runs;
  audit('play ' + k, pg);
}
// 2) the spear tab clicked again mid-run (Start shows), the mode switched under
//    the run, then Start pressed mid-run: the old run's log stops, a new run
//    starts with two game loops; each run submits for its own mode only
for (let k = 0; k < 30; k++) {
  const top2 = rng(9100 + k);
  // the other mode's best is high: its gate must not hold back this run's highs
  const opt = { comp: k % 2 === 1, mob: false, W: 876, hz: pick(top2, [60, 144]), drop: 0.02, sdT: 15, quitAt: 400, restart: true,
    store: { [k % 2 === 1 ? 'alb:spear-hs' : 'alb:spear-hs-comp']: '10000' } };
  const pg = makePage(opt, 7000 + k);
  const t1 = top2.range(5000, 15000), t2 = t1 + top2.range(500, 8000), t3 = t2 + top2.range(500, 8000);
  const script = [{ at: t1, act: 'show', W: k % 3 ? 0 : 600 }, { at: t1 + 300, act: 'mode' }, { at: t2, act: 'show' }, { at: t3, act: k % 2 ? 'start' : 'mode' },
    { at: t3 + 4000, act: 'hide' }, { at: t3 + 6000, act: 'show' }, { at: t3 + 6500, act: 'resume' }];
  const startMode = !!opt.comp;
  const notes = drive(pg, script, 90000);
  iife.runs += notes.runs;
  audit('tab-again ' + k, pg, () => {
    if (notes.toggled < 1) return 'the mode switch under a live run did not happen';
    if (!pg.subs.length) return 'no submits';
    const run1 = pg.subs[0].run, subs1 = pg.subs.filter(s => s.run === run1);
    const want = 'spear' + (startMode ? '-comp' : '');
    if (subs1.some(s => s.type !== want)) return 'a submit went to the other mode';
    // every new high of the first run was sent: 1, 2, ... n with no gap
    if (subs1.some((s, i) => s.score !== i + 1)) return 'the first run skipped highs: ' + subs1.map(s => s.score).slice(0, 12).join(',');
    if (pg.store[startMode ? 'alb:spear-hs' : 'alb:spear-hs-comp'] !== '10000') return 'the other mode\'s best was changed';
    return '';
  });
}
// 3) tab away at awkward moments: during the fail's 850 ms, at Start before the
//    first circle, in the very frame of a spawn; scores reset mid-run
for (let k = 0; k < 30; k++) {
  const top2 = rng(9300 + k);
  const opt = { comp: k % 2 === 0, mob: k % 4 === 0, touch: true, W: 600, hz: 60, drop: 0.05, sdT: 20, quitAt: 5 + (k % 7), restart: true };
  const pg = makePage(opt, 7300 + k);
  const script = [{ at: k * 7 % 300, act: 'hide' }, { at: 400 + k * 11 % 200, act: 'show' }, { at: 900, act: 'resume' },
    { at: 20000 + k * 97, act: 'reset' }];
  for (let h = 3000 + k * 50; h < 80000; h += 3000 + top2.range(0, 4000)) {
    script.push({ at: h, act: 'hide' }, { at: h + top2.range(0, 900), act: 'show' }, { at: h + 1000 + top2.range(0, 900), act: 'resume' });
  }
  const notes = drive(pg, script, 90000);
  iife.runs += notes.runs;
  audit('awkward ' + k, pg);
}
// 4) left paused past the rules' 12-hour limit, then resumed: no submit may
//    carry times past it (it could only be refused)
for (let k = 0; k < 6; k++) {
  const opt = { comp: k % 2 === 0, mob: false, W: 876, hz: 60, drop: 0.01, sdT: 15, quitAt: 60, restart: false };
  const pg = makePage(opt, 7600 + k);
  drive(pg, [{ at: 8000, act: 'hide' }, { at: 8100, act: 'jump', ms: Q.LIMITS.MAX_T + 60000 * k }, { at: 8200, act: 'show' }, { at: 8600, act: 'resume' }], 60000);
  const before = pg.subs.length;
  audit('12 h pause ' + k, pg, () => {
    const late = pg.subs.filter(s => s.log.ev.some(e => e[1] > Q.LIMITS.MAX_T));
    return late.length ? late.length + ' submits with times past the limit' : before ? '' : 'no submits before the pause';
  });
}
if (savedPerf) Object.defineProperty(globalThis, 'performance', savedPerf);
console.log(`real IIFE: ${iife.pages} pages, ${iife.runs} runs, ${iife.subs} submits checked, ${iife.bad} not right; best ${iife.maxPts}`);
if (iife.bad) fail('the real IIFE wrote a log its check does not accept (or submitted where it should not)');
if (iife.subs < 1000) fail('the real IIFE made too few submits');

console.log(failures ? `FAILED (${failures})` : 'OK');
if (require.main === module) process.exit(failures ? 1 : 0);
module.exports = { simulate, honestOpts, forgeries: forg, honest: hon };
