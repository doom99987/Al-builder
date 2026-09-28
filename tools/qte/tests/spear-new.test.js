// node tools/qte/tests/spear-new.test.js      (SPEAR_NEW_RUNS=n: honest runs, default 2400)
// 0) the rules' own maths: the path table, the target draw (every draw passes
//    the check's placement test; kinds and shapes come out uniform), curves;
// a) honest players simulated frame by frame on a true-time axis: the IIFE's
//    state machine re-implemented (sim), vsync frames at 30-240 Hz with drops,
//    main-thread stalls, coarse clocks, the ping delay, pauses (panel and tab)
//    mid-slider, resizes, touch, and a modelled hand (Fitts moves, aim scatter,
//    a lagging, wobbling slider follow, lapses, stray clicks, double taps);
// b) forgeries: edited logs and modified clients (bots, loaded draws);
// c) the REAL IIFE (spear-new.iife.js) in a stub page (vm), driven by the same
//    players and the same frame/stall/ping/pause machinery, plus scripted
//    scenarios (Start mid-run, the time cut, the log budget cut, no rules file);
// d) the page bot (spear-new.bot.js) playing the real IIFE.
// Exit 1 on any failure.
'use strict';
require('./_paths.js');
const fs = require('fs'), path = require('path'), vm = require('vm');
const Q = require(path.join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const R = Q.trainers['spear-new'];
if (!R || typeof R.check !== 'function') { console.log('FAIL spear-new rules did not register'); process.exit(1); }

let failures = 0;
function fail(msg) { failures++; console.log('FAIL ' + msg); }

// ── randomness ──────────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function gauss(rng) { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
function lognorm(rng, med, sig) { return med * Math.exp(sig * gauss(rng)); }
function uni(rng, a, b) { return a + (b - a) * rng(); }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
const clone = x => JSON.parse(JSON.stringify(x));

function check(log, claimed, platform) {
  return Q.check(log.type, log, { platform: platform || (log.env && log.env.mob ? 'M' : 'C'), claimed });
}
function cut(log, len) { return { v: log.v, rv: log.rv, type: log.type, a: log.a, env: log.env, ev: log.ev.slice(0, len) }; }

// ── 0) the rules' maths ─────────────────────────────────────────────────────
{
  // the path table: ends, constant-speed ball, arc length close to the curve's
  const tg = { kind: 1, x: 120, y: 300, ex: 330, ey: 260, o1: -150, o2: -120 };
  const p = R.path(tg);
  const b0 = R.ballAt(p, 0), b1 = R.ballAt(p, 1), bh = R.ballAt(p, 0.5);
  if (b0.x !== 120 || b0.y !== 300 || b1.x !== 330 || b1.y !== 260) fail('path: the ball does not start and end on the slider\'s ends');
  let maxStep = 0, minStep = 1e9, prevB = b0;
  for (let k = 1; k <= 200; k++) { const b = R.ballAt(p, k / 200); const s = Math.hypot(b.x - prevB.x, b.y - prevB.y); maxStep = Math.max(maxStep, s); minStep = Math.min(minStep, s); prevB = b; }
  if (maxStep / minStep > 1.02) fail('path: the ball does not move at a constant speed (' + minStep.toFixed(3) + '..' + maxStep.toFixed(3) + ' px a step)');
  // a fine sampling of the true Bezier
  const L = Math.hypot(tg.ex - tg.x, tg.ey - tg.y), nx = -(tg.ey - tg.y) / L, ny = (tg.ex - tg.x) / L;
  let fine = 0, px = tg.x, py = tg.y;
  for (let k = 1; k <= 20000; k++) {
    const t = k / 20000, u = 1 - t;
    const x = u * u * u * tg.x + 3 * u * u * t * (tg.x + nx * tg.o1) + 3 * u * t * t * (tg.ex + nx * tg.o2) + t * t * t * tg.ex;
    const y = u * u * u * tg.y + 3 * u * u * t * (tg.y + ny * tg.o1) + 3 * u * t * t * (tg.ey + ny * tg.o2) + t * t * t * tg.ey;
    fine += Math.hypot(x - px, y - py); px = x; py = y;
  }
  console.log(`path maths: table length ${p.len.toFixed(2)} px vs the curve ${fine.toFixed(2)} px; mid-ball (${bh.x.toFixed(1)}, ${bh.y.toFixed(1)}); step ratio ${(maxStep / minStep).toFixed(4)}`);
  if (Math.abs(p.len - fine) / fine > 0.005) fail('path: the table is not the curve');
  // the draw: every target passes the check's placement test; kinds and shapes uniform
  const u = mulberry32(4242);
  let n = 0, bad = 0, first = 0, firstSl = 0, rest = 0, restSl = 0;
  const lenU = [], bowU = [], dirs = [];
  for (let k = 0; k < 6000; k++) {
    const mob = u() < 0.4;
    const W = R.canvasW(pick(u, mob ? [264, 300, 344, 390, 414, 624, 768] : [480, 504, 624, 800, 924, 1400]));
    const H = R.canvasH(W, mob || W < 480), r = R.radius(W, H, mob), m = Math.min(W, H);
    let prev = null;
    for (let j = 0; j < 8; j++) {
      const t = R.drawTarget(u, j === 0, prev, W, H, r);
      n++;
      if (R.targetOk(t, prev, W, H, r) !== null) bad++;
      if (j === 0) { first++; if (t.kind === 1) firstSl++; } else { rest++; if (t.kind === 1) restSl++; }
      if (t.kind === 1) {
        lenU.push((Math.hypot(t.ex - t.x, t.ey - t.y) / m - R.LEN_MIN) / (R.LEN_MAX - R.LEN_MIN));
        bowU.push((Math.abs(t.o1) / m - R.BOW_MIN) / (R.BOW_MAX - R.BOW_MIN), (Math.abs(t.o2) / m - R.BOW_MIN) / (R.BOW_MAX - R.BOW_MIN));
      }
      prev = t;
    }
  }
  const pl = Q.stats.ksUniform(lenU).p, pb = Q.stats.ksUniform(bowU).p;
  console.log(`draw maths: ${n} targets, ${bad} refused by the check, first-of-round sliders ${firstSl}/${first}, others ${(restSl / rest).toFixed(4)} sliders (p ${R.SLIDER_P}); KS p length ${pl.toFixed(3)}, bow ${pb.toFixed(3)}`);
  if (bad) fail('the draw makes targets the check refuses');
  if (firstSl !== first) fail('a round opened with a circle');
  if (Math.abs(restSl / rest - R.SLIDER_P) > 0.01) fail('slider share is not ' + R.SLIDER_P);
  if (pl < 1e-3 || pb < 1e-3) fail('honest slider shapes are not uniform: the luck test would hold honest runs');
  // curves at a few streaks
  const cv = s => [R.targets(s, false), R.timerMs(s, false), R.travMs(s, false), R.targets(s, true), R.timerMs(s, true), R.travMs(s, true)].join(',');
  if (cv(0) !== '6,7500,550,8,7000,450' || cv(12) !== '12,6300,430,14,5800,330' || cv(40) !== '12,6000,350,14,5500,300') fail('curves: ' + cv(0) + ' / ' + cv(12) + ' / ' + cv(40));
  for (const w of [0, 100, 264, 500, 924, 5000]) { const W = R.canvasW(w); if (W < R.W_MIN || W > R.W_MAX) fail('canvasW(' + w + ') = ' + W); }
}

// ── the page's clock, frames, timers ────────────────────────────────────────
function makeEnv(seed, grain) {
  const rng = mulberry32(seed);
  const env = { clock: 2000 + rng() * 8000, grain: grain || 0, rafs: [], rafId: 0, timers: [], tseq: 0 };
  env.perf = () => env.grain ? Math.floor(env.clock / env.grain) * env.grain : env.clock;
  env.stamp = v => env.grain ? Math.floor(v / env.grain) * env.grain : v;
  env.raf = fn => { env.rafs.push({ id: ++env.rafId, fn }); return env.rafId; };
  env.caf = id => { for (let i = env.rafs.length - 1; i >= 0; i--) if (env.rafs[i].id === id) env.rafs.splice(i, 1); };
  env.setTimeout = (fn, ms) => { env.timers.push({ at: env.clock + Math.max(0, +ms || 0), seq: ++env.tseq, fn }); return env.tseq; };
  return env;
}

// ── the trainer, as the IIFE runs it (a re-implementation, same order) ──────
// o: { comp, mob, wrap, cssScale, ping, gameRng, mods: { draw, autoFollow } }
function makeSim(env, o) {
  const comp = !!o.comp, MOB = !!o.mob, mods = o.mods || {};
  const drawTarget = mods.draw || R.drawTarget;
  const G = { wrap: o.wrap, scale: o.cssScale || 1, runs: [] };
  let W = 0, H = 0, rad = R.R_MIN;
  let running = false, gameStarted = false, paused = false, phase = 'idle', score = 0;
  let targets = [], paths = [], active = 0;
  let held = false, heldId = null, gPress = 0, lastS = 0, ptrX = 0, ptrY = 0;
  let gameT = 0, g10 = 0, d10 = 0, R0 = 0, gC = 0, timer10 = 0, trav10 = 0;
  let animFrame = null, lastTime = 0;
  let run = null, logBytes = 0, highscore = 0;

  function newRun() {
    const t0 = env.perf(), type = 'spear-new' + (comp ? '-comp' : '');
    const r = { type, t0, closed: false, subs: [], log: { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: G.wrap + 40, h: 820, mob: MOB, ping: o.ping | 0 }, ev: [] } };
    r.now = () => Math.max(0, Math.round(env.perf() - r.t0));
    r.ev = function (code) {
      const e = [code, r.now()];
      for (let i = 1; i < arguments.length; i++) { const f = arguments[i]; e.push(typeof f === 'number' ? Math.round(f * 10000) / 10000 : f); }
      if (!r.closed && r.log.ev.length < Q.LIMITS.MAX_EVENTS) r.log.ev.push(e);
    };
    r.submit = s => r.subs.push({ len: r.log.ev.length, score: s });
    r.close = () => { r.closed = true; };
    r.shadow = [];
    G.runs.push(r);
    return r;
  }
  function ev() {
    if (o.shadow && run && !run.closed) {     // what the screen shows, past any log cut (tests only)
      const e = [arguments[0], run.now()];
      for (let i = 1; i < arguments.length; i++) { const f = arguments[i]; e.push(typeof f === 'number' ? Math.round(f * 10000) / 10000 : f); }
      run.shadow.push(e);
    }
    if (!run || run.closed || logBytes > R.LOG_BUDGET) return;
    if (run.now() > Q.LIMITS.MAX_T - R.LOG_T_MARGIN) { run.close(); return; }
    const L = run.log.ev, n = L.length;
    run.ev.apply(run, arguments);
    if (L.length > n) logBytes += JSON.stringify(L[n]).length + 1;
  }
  const Gt = () => g10 / 10, Dt = () => d10 / 10;
  function submit(val) { if (run && !run.closed && run.now() <= Q.LIMITS.MAX_T) run.submit(val); }
  function updateHs(val) { if (val > highscore) { highscore = val; submit(val); } }
  function resizeCanvas() {
    const w = R.canvasW(G.wrap), h = R.canvasH(w, MOB || w < 480);
    if (w === W && h === H) return false;
    W = w; H = h; rad = R.radius(W, H, MOB);
    return true;
  }
  function startRound() {
    if (resizeCanvas()) ev('Z', W, H);
    timer10 = R.timerMs(score, comp) * 10; trav10 = R.travMs(score, comp) * 10;
    R0 = g10; active = 0; held = false; heldId = null; targets = []; paths = [];
    const n = R.targets(score, comp);
    let prev = null;
    for (let k = 0; k < n; k++) {
      const tg = drawTarget(o.gameRng, k === 0, prev, W, H, rad);
      targets.push(tg); paths.push(tg.kind === 1 ? R.path(tg) : null); prev = tg;
    }
    ev('R', Gt(), Dt(), score);
    for (const tg of targets) { if (tg.kind === 1) ev('T', 1, tg.x, tg.y, tg.ex, tg.ey, tg.o1, tg.o2); else ev('T', 0, tg.x, tg.y); }
    phase = 'play';
  }
  function completeTarget() {
    active++;
    if (active < targets.length) return;
    score++;
    ev('C', Gt(), score);
    phase = 'gap'; gC = g10;
    updateHs(score);
  }
  function stepRound() {
    if (held) {
      const b = R.ballAt(paths[active], R.frac(g10, gPress, trav10));
      if (mods.autoFollow) {           // a modified client: the pointer is put on the ball
        ptrX = R.px(b.x + mods.autoFollow.noise * gauss(mods.autoFollow.rng));
        ptrY = R.px(b.y + mods.autoFollow.noise * gauss(mods.autoFollow.rng));
      }
      if (R.dist(ptrX, ptrY, b.x, b.y) > R.FOLLOW_K * rad) { ev('E', 'far', Gt(), Dt(), ptrX, ptrY); endRun(); return; }
      if (g10 - gPress >= trav10) {
        ev('F', Gt(), Dt(), ptrX, ptrY);
        held = false; heldId = null;
        completeTarget();
        if (phase !== 'play') return;
      } else if (g10 - lastS >= R.SAMPLE_MS * 10) {
        ev('M', Gt(), Dt(), ptrX, ptrY);
        lastS = g10;
      }
    }
    if (g10 - R0 >= timer10) { ev('E', 'time', Gt(), Dt()); endRun(); }
  }
  function gameLoop(now) {
    if (!running) return;
    const dt = Math.min(Math.max(0, now - lastTime), R.DT_MAX) * (mods.clockScale || 1);   // clockScale: a slowed client
    if (now > lastTime) lastTime = now;
    gameT += dt;
    const g = Math.round(gameT * 10);
    d10 = g - g10; g10 = g;
    if (phase === 'gap') { if (g10 - gC >= R.ROUND_GAP * 10) startRound(); }
    else if (phase === 'play') stepRound();
    if (!running) return;
    animFrame = env.raf(gameLoop);
  }
  function endRun() {
    env.caf(animFrame);
    running = false; gameStarted = false; held = false; heldId = null;
    updateHs(score);
    if (run) run.close();
  }
  function startGame() {
    env.caf(animFrame);
    if (run) run.close();
    run = newRun();
    logBytes = 0; gameT = 0; g10 = 0; d10 = 0; gC = 0;
    score = 0; phase = 'gap'; targets = []; paths = []; active = 0; held = false; heldId = null;
    resizeCanvas();
    ev('Z', W, H);
    running = true; gameStarted = true; paused = false;
    lastTime = env.perf();
    animFrame = env.raf(gameLoop);
  }
  function pauseRun() {
    if (!running) return;
    env.caf(animFrame);
    running = false; paused = true; held = false; heldId = null;
    ev('P', Gt());
  }
  function resumeRun() {
    if (!paused) return;
    paused = false; running = true;
    ev('U', Gt());
    lastTime = env.perf();
    animFrame = env.raf(gameLoop);
  }
  function onDown(x, y, id) {
    if (!running || phase !== 'play' || held) return;
    const tg = targets[active];
    if (!tg) return;
    const px = R.px(x), py = R.px(y);
    if (R.dist(px, py, tg.x, tg.y) > R.HIT_K * rad) return;
    ev('K', Gt(), active, px, py);
    if (tg.kind === 0) { completeTarget(); return; }
    held = true; heldId = id; gPress = g10; lastS = g10; ptrX = px; ptrY = py;
  }
  function onMove(x, y, id) { if (!held || id !== heldId) return; ptrX = R.px(x); ptrY = R.px(y); }
  function onUp(id) { if (!running || !held || id !== heldId) return; ev('E', 'up', Gt()); endRun(); }
  function later(fn) { const ping = o.ping || 0; if (ping > 0) env.setTimeout(fn, ping); else fn(); }
  function canvasPos(e) {
    const rc = G.rect();
    if (!(rc.width > 0 && rc.height > 0)) return null;
    const x = (e.clientX - rc.left) * W / rc.width, y = (e.clientY - rc.top) * H / rc.height;
    return isFinite(x) && isFinite(y) ? { x, y } : null;
  }

  G.start = startGame;
  G.resume = resumeRun;
  G.hide = () => { if (running) pauseRun(); };
  G.show = () => {};
  G.setWrap = w => { G.wrap = w; };
  G.rect = () => ({ left: 11, top: 47, width: W * G.scale, height: H * G.scale });
  G.run = () => run;
  G.down = e => { if (e.button > 0 || !running) return; const p = canvasPos(e), id = e.pointerId; if (p) later(() => onDown(p.x, p.y, id)); };
  G.move = e => { if (!running) return; const p = canvasPos(e), id = e.pointerId; if (p) later(() => onMove(p.x, p.y, id)); };
  G.up = e => { const id = e.pointerId; later(() => onUp(id)); };
  G.allRuns = () => G.runs.map(r => ({ type: r.type, log: r.log, closed: r.closed, subs: r.subs }));
  G.view = o.shadow ? () => (run ? run.shadow : []) : null;
  return G;
}

// ── the REAL trainer in a stub page ─────────────────────────────────────────
const SRC = {
  core: fs.readFileSync(path.join(__dirname, '@qte-scratch/wt2/js/qte-rules.js'), 'utf8'),
  part: fs.readFileSync(path.join(__dirname, 'spear-new.rules.js'), 'utf8'),
  iife: fs.readFileSync(path.join(__dirname, 'spear-new.iife.js'), 'utf8'),
  bot: fs.readFileSync(path.join(__dirname, 'spear-new.bot.js'), 'utf8'),
};
function stubCtx2d() {
  const grad = () => ({ addColorStop() {} });
  return new Proxy({}, {
    get: (t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient') ? grad : k === 'measureText' ? () => ({ width: 10 }) : (k in t ? t[k] : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
// o: { comp, mob, wrap, cssScale, ping, gameRng, selfcheck, noRules, budget, maxT }
function makeReal(env, o) {
  const els = {}, lis = new Map(), docL = {}, winL = {};
  function el(id, extra) {
    const e = Object.assign({ id, style: {}, textContent: '', addEventListener(t, f) { const m = lis.get(e) || {}; (m[t] = m[t] || []).push(f); lis.set(e, m); } }, extra || {});
    els[id] = e; return e;
  }
  const wrap = { clientWidth: o.wrap };
  const G = { scale: o.cssScale || 1, submits: [] };
  const canvas = el('spear-new-qte-canvas', { width: 0, height: 0, parentElement: wrap, getContext: () => stubCtx2d(),
    getBoundingClientRect: () => ({ left: 11, top: 47, width: canvas.width * G.scale, height: canvas.height * G.scale }), setPointerCapture() {} });
  const panel = el('qte-panel-spear-new', { style: { display: 'flex' } });
  for (const id of ['spear-new-qte-status', 'spear-new-qte-streak', 'spear-new-qte-highscore', 'spear-new-qte-start-btn', 'spear-new-qte-resume-btn']) el(id);
  const store = new Map([['alb:qte-selfcheck', o.selfcheck ? '1' : '0']]);
  const doc = { hidden: false, getElementById: id => els[id] || null, addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); } };
  const M = Object.create(Math); M.random = o.gameRng;
  const errors = [];
  const sb = {
    console: { log() {}, error: (...a) => errors.push(a.join(' ')), warn() {} },
    Math: M, JSON, Promise, Object, Array, Number, String, Set, Map, Error, isFinite, parseInt, Proxy,
    setTimeout: env.setTimeout, clearTimeout() {},
    performance: { now: env.perf },
    document: doc,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    requestAnimationFrame: env.raf, cancelAnimationFrame: env.caf,
    addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); },
    innerWidth: 1280, innerHeight: 800, IS_MOBILE: !!o.mob,
    _qteCompMode: !!o.comp, _albPing: o.ping || 0,
    _sbStartQteRun: () => null,
    _sbSubmitScore: (type, score, packet) => { G.submits.push({ type, score, log: packet.log }); return null; },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(SRC.core, sb);
  if (!o.noRules) vm.runInContext(SRC.part, sb);
  const QQ = sb.QteRules;
  if (!o.noRules) {
    if (o.budget) QQ.trainers['spear-new'].LOG_BUDGET = o.budget;
    if (o.maxT) QQ.LIMITS.MAX_T = o.maxT;
    if (o.maxEvents) QQ.LIMITS.MAX_EVENTS = o.maxEvents;
  }
  G.view = null;
  if (o.shadow) {
    // every event the trainer hands its run, past the run's event cap: what
    // the screen shows (tests only)
    const start0 = QQ.Run.start;
    QQ.Run.start = function (type, opts) {
      const run = start0.call(this, type, opts), ev0 = run.ev;
      run.shadow = [];
      run.ev = function () {
        const e = [arguments[0], run.now()];
        for (let i = 1; i < arguments.length; i++) { const f = arguments[i]; e.push(typeof f === 'number' ? Math.round(f * 10000) / 10000 : f); }
        if (!run.closed) run.shadow.push(e);
        return ev0.apply(run, arguments);
      };
      return run;
    };
    G.view = () => { const r = QQ.Run.current; return r ? r.shadow : []; };
  }
  vm.runInContext(SRC.iife, sb);
  G.sb = sb; G.els = els; G.errors = errors; G.store = store; G.QQ = QQ;
  const fire = (target, type, e) => { const m = lis.get(target); if (m && m[type]) for (const f of m[type]) f(e); };
  const pe = (e, type) => Object.assign({ button: 0, pointerType: o.mob ? 'touch' : 'mouse', cancelable: true, preventDefault() {} }, e);
  G.start = () => fire(els['spear-new-qte-start-btn'], 'click', { preventDefault() {} });
  G.resume = () => fire(els['spear-new-qte-resume-btn'], 'click', { preventDefault() {} });
  G.hide = how => {
    if (how === 'tab') { doc.hidden = true; for (const f of docL.visibilitychange || []) f({}); }
    else { panel.style.display = 'none'; if (sb._onSpearNewQteHide) sb._onSpearNewQteHide(); }
  };
  G.show = how => {
    if (how === 'tab') { doc.hidden = false; for (const f of docL.visibilitychange || []) f({}); }
    else { panel.style.display = 'flex'; if (sb._onSpearNewQteShow) sb._onSpearNewQteShow(); }
  };
  G.setWrap = w => { wrap.clientWidth = w; for (const f of winL.resize || []) f({}); };
  G.rect = () => canvas.getBoundingClientRect();
  G.run = () => QQ.Run.current;
  G.down = e => fire(canvas, 'pointerdown', pe(e));
  G.move = e => fire(canvas, 'pointermove', pe(e));
  G.up = e => fire(canvas, 'pointerup', pe(e));
  G.cancel = e => fire(canvas, 'pointercancel', pe(e));
  G.canvas = canvas;
  if (sb._onSpearNewQteShow) sb._onSpearNewQteShow();
  return G;
}

// ── a hand on the pointer ───────────────────────────────────────────────────
// Reads the game from the run's own log (as a person reads the screen) and
// acts through pointer events. p: player params (see playerFor).
function makePlayer(game, env, o, rng, sched) {
  const p = o.player, MOB = !!o.mob, ping = o.ping || 0, comp = !!o.comp;
  let runObj = null, seen = 0;
  let W = 0, H = 0, rad = R.R_MIN, tgs = [], paths = [], active = 0, phase = 'pre', over = false, paused = false;
  let heldLog = false, gP = 0, syncG = 0, syncT = 0, trav = 500, rounds = 0, actAt = 0, firstPending = false;
  let px = 0, py = 0, down = false, downId = 0, nextId = 1, lastUpAt = -1e9, lastPressAt = -1e9, kSeenAt = 0;
  let pressPending = false, pressTok = 0, tracking = null, retry = 0;
  const st = { presses: 0, strays: 0, misses: 0, dbl: 0, lapses: 0 };
  function reset() {
    tgs = []; paths = []; active = 0; phase = 'pre'; over = false; paused = false; heldLog = false;
    pressPending = false; pressTok++; tracking = null; retry = 0;
  }
  function observe() {
    const r = game.run();
    if (!r) return;
    if (r !== runObj) { runObj = r; seen = 0; reset(); if (down) release(downId, env.clock); }
    const L = game.view ? game.view() : r.log.ev;
    for (; seen < L.length; seen++) {
      const e = L[seen];
      switch (e[0]) {
        case 'Z': W = e[2]; H = e[3]; rad = R.radius(W, H, MOB); break;
        case 'R': phase = 'play'; tgs = []; paths = []; active = 0; heldLog = false; trav = R.travMs(e[4], comp); actAt = env.clock; firstPending = true; break;
        case 'T': { const tg = e[2] === 1 ? { kind: 1, x: e[3], y: e[4], ex: e[5], ey: e[6], o1: e[7], o2: e[8] } : { kind: 0, x: e[3], y: e[4] }; tgs.push(tg); paths.push(tg.kind ? R.path(tg) : null); break; }
        case 'K': if (tgs[e[3]] && tgs[e[3]].kind === 0) { active++; actAt = env.clock; retry = 0; } else { heldLog = true; gP = e[2]; syncG = e[2]; syncT = env.clock; kSeenAt = env.clock; retry = 0; } break;
        case 'M': syncG = e[2]; syncT = env.clock; break;
        case 'F': heldLog = false; active++; actAt = env.clock; sliderDone(); break;
        case 'C': phase = 'gap'; rounds = e[3]; break;
        case 'P': paused = true; heldLog = false; break;
        case 'U': paused = false; break;
        case 'E': over = true; tracking = null; break;
      }
    }
    if (over && down && !tracking) release(downId, env.clock + 60);
    plan();
  }
  function quit() { return rounds >= o.maxRounds; }
  function plan() {
    if (over || paused || phase !== 'play' || quit() || pressPending || heldLog || down) return;
    if (!tgs.length || active >= tgs.length) return;
    const k = active, tg = tgs[k];
    const HIT = R.HIT_K * rad;
    let at;
    if (p.bot) at = actAt + p.bot.rt;
    else {
      const D = Math.hypot(tg.x - px, tg.y - py);
      const fitts = p.fa + p.fb * Math.log2(1 + D / (2 * HIT));
      const delay = firstPending ? lognorm(rng, p.react, 0.2) + fitts : Math.max(p.cyc, fitts) * lognorm(rng, 1, 0.15);
      at = actAt + delay;
      if (retry) at = env.clock + uni(rng, 60, 160);
    }
    if (p.bot && p.bot.cadence) at = Math.max(at, lastPressAt + p.bot.cadence);
    firstPending = false;
    at = Math.max(at, env.clock + 0.5, lastUpAt + (p.bot ? 1 : 25));
    pressPending = true;
    const tok = ++pressTok;
    if (!p.bot && rng() < p.stray) {            // a stray click off the target first
      const sx = uni(rng, 0, W), sy = uni(rng, 0, H);
      if (Math.hypot(sx - tg.x, sy - tg.y) > HIT * 2) { st.strays++; tap(Math.max(env.clock + 0.5, at - uni(rng, 60, 200)), sx, sy); }
    }
    sched(at, tau => press(tok, k, tau));
  }
  function tap(at, x, y) {
    sched(at, tau => {
      if (down) return;
      const id = MOB ? nextId++ : 1;
      pointer('down', x, y, id); sched(tau + uni(rng, 40, 110), t2 => { pointer('up', x, y, id); lastUpAt = t2; });
    });
  }
  function pointer(kind, x, y, id) {
    const rc = game.rect();
    const e = { clientX: rc.left + x * rc.width / W, clientY: rc.top + y * rc.height / H, pointerId: id };
    if (kind === 'down') game.down(e); else if (kind === 'move') game.move(e); else game.up(e);
  }
  function press(tok, k, tau) {
    if (tok !== pressTok) return;
    pressPending = false;
    if (over || paused || active !== k || heldLog || down || phase !== 'play') { plan(); return; }
    const tg = tgs[k];
    const sig = p.bot ? p.bot.aim : p.aim * rad * (retry ? 0.6 : 1);
    px = tg.x + gauss(rng) * sig; py = tg.y + gauss(rng) * sig;
    const id = MOB ? nextId++ : 1;
    if (!MOB) pointer('move', px, py, id);
    pointer('down', px, py, id);
    down = true; downId = id; st.presses++; lastPressAt = tau;
    if (tg.kind === 0) {
      const hold = p.bot ? p.bot.hold : uni(rng, 35, 120);
      sched(tau + hold, t2 => release(id, t2));
      if (MOB && !p.bot && rng() < 0.03) { st.dbl++; tap(tau + hold + uni(rng, 15, 40), px, py); }
    } else {
      tracking = { k, id, t0: tau, ox: 0, oy: 0, lag: p.bot ? 0 : p.lag + gauss(rng) * p.lagJ, last: tau };
      sched(tau + 1000 / p.inHz, t2 => trackTick(id, t2));
      if (!p.bot && rng() < p.lapse) { st.lapses++; sched(tau + ping + uni(rng, 0.1, 0.9) * trav, t2 => { if (tracking && tracking.id === id) { tracking = null; release(id, t2); } }); }
    }
    // no press logged? the hand noticed nothing happened: let go and try again
    const tokK = pressTok;
    sched(tau + ping + uni(rng, 130, 230), t2 => {
      if (tokK !== pressTok || over || paused || active !== k) return;
      if (tg.kind === 1 && heldLog) return;
      st.misses++; retry++;
      if (down && downId === id) { tracking = null; release(id, t2); }
      else plan();
    });
  }
  function trackTick(id, tau) {
    const tr = tracking;
    if (!tr || tr.id !== id || !down || over || paused) return;
    const tg = tgs[tr.k];
    if (!tg || tg.kind !== 1) return;
    // game time since the press when this move is judged (after the ping), less
    // the hand's lag; the eye reads the ball's speed (a stall or a coarse clock
    // slows it down)
    const since = syncT - kSeenAt;
    const rate = heldLog && since >= 60 ? Math.max(0.3, Math.min(1, (syncG - gP) / since)) : 1;
    const prog = heldLog ? (syncG - gP) + (tau + ping - syncT) * rate - tr.lag : (tau - tr.t0) - tr.lag;
    const b = R.ballAt(paths[tr.k], prog / trav);
    const dt = Math.max(0, tau - tr.last); tr.last = tau;
    const a = Math.exp(-dt / p.trkTc), s = p.trk * Math.sqrt(1 - a * a);
    tr.ox = tr.ox * a + s * gauss(rng); tr.oy = tr.oy * a + s * gauss(rng);
    px = b.x + tr.ox * rad; py = b.y + tr.oy * rad;
    pointer('move', px, py, id);
    sched(tau + 1000 / p.inHz, t2 => trackTick(id, t2));
  }
  function sliderDone() {
    const tr = tracking; tracking = null;
    if (!tr) return;
    const id = tr.id;
    sched(env.clock + (p.bot ? p.bot.hold : uni(rng, 20, 110)), t2 => release(id, t2));
  }
  function release(id, tau) {
    if (!down || downId !== id) return;
    sched(tau, t2 => {
      if (!down || downId !== id) return;
      down = false; lastUpAt = t2;
      pointer('up', px, py, id);
      plan();
    });
  }
  function onPause() {
    pressTok++; pressPending = false; tracking = null;
    if (down) release(downId, env.clock + uni(rng, 5, 80));
  }
  function onResume() { actAt = env.clock + uni(rng, 100, 300); firstPending = true; retry = 0; plan(); }
  return { observe, onPause, onResume, st, isOver: () => over };
}

// Player params from a skill in [0, 1].
function playerFor(rng, skill, mob) {
  return {
    react: 330 - 130 * skill,
    cyc: uni(rng, 70, 110) + (1 - skill) * 50,
    fa: uni(rng, 20, 60) + (1 - skill) * 70, fb: 60 + (1 - skill) * 90,
    aim: ((mob ? 0.3 : 0.2) + (1 - skill) * 0.25) * uni(rng, 0.8, 1.2),
    lag: uni(rng, -5, 20) + (1 - skill) * 30, lagJ: uni(rng, 4, 12),
    trk: (0.12 + 0.28 * (1 - skill)) * uni(rng, 0.8, 1.2), trkTc: uni(rng, 50, 120),
    lapse: 0.002 + 0.02 * (1 - skill),
    stray: 0.02,
    inHz: mob ? pick(rng, [60, 120]) : pick(rng, [125, 250]),
  };
}

// ── the page around it: frames, stalls, timers, the hand, the UI ────────────
// o: { hz, drop, stallRate, grain, ping, pauses: [{at, dur, how}], resizes: [{at, wrap}],
//      restartAt, endAfter, player, maxRounds, ... }
function drive(game, env, o, seed) {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const P = 1000 / o.hz, vs0 = env.clock + rng() * P, start = env.clock;
  const stalls = [];
  if (o.stallRate > 0) {
    let x = env.clock;
    for (let i = 0; i < 4000; i++) {
      x += -Math.log(1 - rng()) / o.stallRate;
      const d = rng() < 0.7 ? uni(rng, 20, 80) : rng() < 0.85 ? uni(rng, 80, 300) : uni(rng, 300, 800);
      stalls.push([x, x + d]); x += d;
      if (x > start + (o.endAfter || 3e6)) break;
    }
  }
  let si = 0;
  const stallEnd = x => { while (si < stalls.length && stalls[si][1] <= x - 5000) si++; for (let k = si; k < stalls.length && stalls[k][0] <= x; k++) if (x < stalls[k][1]) return stalls[k][1] + 0.05; return x; };
  const agenda = [];
  let seq = 0;
  const sched = (tau, fn) => { agenda.push({ at: stallEnd(Math.max(tau, env.clock)), phys: tau, fn, seq: seq++ }); };
  const player = makePlayer(game, env, o, mulberry32(seed * 31 + 7), sched);
  const ui = [];
  for (const q of o.pauses || []) {
    ui.push({ at: start + q.at, fn: () => { game.hide(q.how); player.observe(); player.onPause(); } });
    ui.push({ at: start + q.at + q.dur, fn: () => { game.show(q.how); } });
    ui.push({ at: start + q.at + q.dur + uni(rng, q.short ? 20 : 250, q.short ? 90 : 1500), fn: () => { game.resume(); player.observe(); player.onResume(); } });
  }
  for (const z of o.resizes || []) ui.push({ at: start + z.at, fn: () => game.setWrap(z.wrap) });
  if (o.restartAt) ui.push({ at: start + o.restartAt, fn: () => { game.start(); } });
  for (const u of ui) sched(u.at, u.fn);

  let frameAt = null;
  function schedFrame(after) {
    let k = Math.floor((after - vs0) / P) + 1;
    while (rng() < o.drop) k++;
    let v = vs0 + k * P, cb = v + uni(rng, 0.1, 2.5);
    const s = stallEnd(cb);
    if (s !== cb) { cb = s + uni(rng, 0.1, 1); v = vs0 + Math.floor((cb - vs0) / P) * P; }
    frameAt = { cb, stamp: env.stamp(v) };
  }
  game.start();
  player.observe();
  const endAt = start + (o.endAfter || 3e6);
  let guard = 0;
  while (guard++ < 2e7) {
    if (env.rafs.length && !frameAt) schedFrame(env.clock);
    const tf = env.rafs.length && frameAt ? frameAt.cb : Infinity;
    let ti = -1, tt = Infinity;
    for (let i = 0; i < env.timers.length; i++) { const x = env.timers[i]; if (x.at < tt || (x.at === tt && x.seq < env.timers[ti].seq)) { tt = x.at; ti = i; } }
    let ai = -1, ta = Infinity;
    for (let i = 0; i < agenda.length; i++) { const x = agenda[i]; if (x.at < ta || (x.at === ta && x.seq < agenda[ai].seq)) { ta = x.at; ai = i; } }
    const tn = Math.min(tf, tt, ta);
    if (tn === Infinity || tn > endAt) break;
    if (ta <= tt && ta <= tf) { const a = agenda.splice(ai, 1)[0]; env.clock = Math.max(env.clock, a.at); a.fn(a.phys); }
    else if (tt <= tf) { const t = env.timers.splice(ti, 1)[0]; env.clock = Math.max(env.clock, stallEnd(t.at)); t.fn(); }
    else { env.clock = Math.max(env.clock, frameAt.cb); const due = env.rafs; env.rafs = []; const s = frameAt.stamp; frameAt = null; for (const x of due) x.fn(s); }
    player.observe();
    if (player.isOver() && !env.timers.length && !agenda.some(a => a.at > env.clock - 1 && a.at < env.clock + 2000)) break;
  }
  return { player };
}

// ── run configs ─────────────────────────────────────────────────────────────
function honestConfig(i) {
  const rng = mulberry32(0x51ea7 + 7919 * i);
  const mob = rng() < 0.3;
  const skill = Math.pow(rng(), 0.6);
  const wrap = mob ? pick(rng, [264, 344, 360, 390, 414, 624, 768]) : pick(rng, [504, 624, 800, 924, 924, 1100, 1400]);
  const hz = mob ? pick(rng, [60, 60, 90, 120]) : pick(rng, [30, 60, 60, 60, 75, 120, 144, 144, 240]);
  const pauses = [];
  if (rng() < 0.25) {
    const n = 1 + Math.floor(rng() * 3); let at = 0;
    for (let k = 0; k < n; k++) { at += uni(rng, 300, 60000); const dur = uni(rng, 200, 20000); pauses.push({ at, dur, how: rng() < 0.5 ? 'tab' : 'panel' }); at += dur + 2000; }
  }
  const resizes = rng() < 0.08 ? [{ at: uni(rng, 500, 60000), wrap: pick(rng, mob ? [344, 414, 624] : [504, 800, 1400]) }] : [];
  const long = rng() < 0.08;
  return {
    comp: rng() < 0.5, mob, wrap, cssScale: pick(rng, [1, 1, 0.8, 1.25]), hz,
    drop: hz === 30 ? 0.02 : pick(rng, [0.002, 0.01, 0.03, 0.08]),
    stallRate: pick(rng, [0, 1 / 60000, 1 / 20000, 1 / 5000]),
    grain: pick(rng, [0, 0, 0, 0.1, 1, 16.67]),
    ping: pick(rng, [0, 0, 0, 0, 30, 80, 150]),
    pauses, resizes, maxRounds: long ? 40 + Math.floor(rng() * 60) : 2 + Math.floor(rng() * 30),
    player: playerFor(rng, skill, mob), skill,
    seed: (i * 2654435761) >>> 0,
  };
}
function simRun(cfg, extraMods) {
  const env = makeEnv(cfg.seed, cfg.grain);
  const game = makeSim(env, Object.assign({}, cfg, { gameRng: mulberry32(cfg.seed + 101), mods: extraMods || cfg.mods }));
  const d = drive(game, env, cfg, cfg.seed);
  return { runs: game.allRuns(), player: d.player };
}
function realRun(cfg) {
  const env = makeEnv(cfg.seed, cfg.grain);
  const game = makeReal(env, Object.assign({}, cfg, { gameRng: mulberry32(cfg.seed + 101) }));
  const d = drive(game, env, cfg, cfg.seed);
  return { game, player: d.player, run: game.run() };
}
const provenOf = log => log.ev.filter(e => e[0] === 'C').length;
// a modified client that puts the pointer on the ball each frame (noise: px SD)
const follow = (noise, seed) => ({ autoFollow: { noise, rng: mulberry32(seed || 5) } });

// ── a) honest ───────────────────────────────────────────────────────────────
const N = +(process.env.SPEAR_NEW_RUNS || 2400);
let inv = 0, rev = 0, mism = 0, checks = 0, sumScore = 0, maxScore = 0, maxBytes = 0, maxEvents = 0, worstPerRound = 0;
const scoreHist = {}, ends = {}, reasons = {};
const cover = { pause: 0, pauseMidSlider: 0, resize: 0, ping: 0, mob: 0, comp: 0, stall: 0, coarse: 0, strays: 0, dblTaps: 0, misses: 0, lapses: 0, quit: 0 };
const near = { folMin: 1e9, aimMin: 1e9, rtFastMax: 0, rtMedMin: 1e9, ivSdMin: 1e9, clusterMax: 0, pMin: 1, clampedMax: 0, ratioMin: 1e9, maxGap: 0 };
function margins(r) {
  const s = r.stats; if (r.verdict === 'invalid') return;
  if (s.samples >= R.PERSON.FOL_N) near.folMin = Math.min(near.folMin, s.followMean);
  if (s.presses >= R.PERSON.AIM_N) near.aimMin = Math.min(near.aimMin, s.aimRmsPx);
  if (s.presses >= R.PERSON.RT_N) { near.rtFastMax = Math.max(near.rtFastMax, s.rtFastShare); near.rtMedMin = Math.min(near.rtMedMin, s.rtMedMs); }
  if (s.ivN >= R.PERSON.STEADY_N) near.ivSdMin = Math.min(near.ivSdMin, s.ivSdMs);
  if (s.ivN >= R.PERSON.CLUSTER_N) near.clusterMax = Math.max(near.clusterMax, s.ivClusterShare);
  if (s.drawPMinLog10 != null) near.pMin = Math.min(near.pMin, Math.pow(10, s.drawPMinLog10));
  if (s.clampedShare != null && s.samples >= R.PERSON.SLOW_N) near.clampedMax = Math.max(near.clampedMax, s.clampedShare);
  if (s.gameToWall != null && s.rounds >= 6) near.ratioMin = Math.min(near.ratioMin, s.gameToWall);
  near.maxGap = Math.max(near.maxGap, s.maxGapMs || 0);
}
const samples = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const cfg = honestConfig(i);
  const out = simRun(cfg);
  const run = out.runs[0], log = run.log, score = provenOf(log);
  const tests = [[log, score]];
  if (run.subs.length > 1) { const s = run.subs[Math.floor(run.subs.length / 2)]; tests.push([cut(log, s.len), s.score]); }
  for (const [lg, claimed] of tests) {
    checks++;
    const r = check(lg, claimed);
    margins(r);
    if (r.verdict === 'invalid') { inv++; if (inv <= 5) console.log('honest invalid', i, r.reasons, JSON.stringify(cfg).slice(0, 400)); }
    else if (r.verdict === 'review') { rev++; for (const x of r.reasons) { const k = x.replace(/\d[\d.e+-]*/g, '#'); reasons[k] = (reasons[k] || 0) + 1; } if (rev <= 8) console.log('honest review', i, 'skill', cfg.skill.toFixed(2), r.reasons, JSON.stringify(r.stats)); }
    if (r.verdict !== 'invalid' && r.score !== claimed) { mism++; if (mism <= 5) console.log('honest mismatch', i, claimed, r.score, r.reasons); }
  }
  const last = log.ev[log.ev.length - 1];
  const why = last[0] === 'E' ? last[2] : 'cut';
  ends[why] = (ends[why] || 0) + 1;
  sumScore += score; maxScore = Math.max(maxScore, score);
  scoreHist[score >= 40 ? '40+' : score >= 20 ? '20-39' : score >= 10 ? '10-19' : String(score)] = (scoreHist[score >= 40 ? '40+' : score >= 20 ? '20-39' : score >= 10 ? '10-19' : String(score)] || 0) + 1;
  const bytes = JSON.stringify(log).length;
  maxBytes = Math.max(maxBytes, bytes); maxEvents = Math.max(maxEvents, log.ev.length);
  if (score >= 3) worstPerRound = Math.max(worstPerRound, JSON.stringify(log.ev).length / (score + 1));
  const ev = log.ev;
  if (ev.some(e => e[0] === 'P')) cover.pause++;
  for (let q = 1; q < ev.length; q++) if (ev[q][0] === 'P' && (ev[q - 1][0] === 'M' || ev[q - 1][0] === 'K')) { let j = q - 1; while (j > 0 && ev[j][0] === 'M') j--; if (ev[j][0] === 'K') { cover.pauseMidSlider++; break; } }
  if (ev.filter(e => e[0] === 'Z').length > 1) cover.resize++;
  if (cfg.ping) cover.ping++; if (cfg.mob) cover.mob++; if (cfg.comp) cover.comp++; if (cfg.stallRate) cover.stall++; if (cfg.grain >= 1) cover.coarse++;
  cover.strays += out.player.st.strays; cover.dblTaps += out.player.st.dbl; cover.misses += out.player.st.misses; cover.lapses += out.player.st.lapses;
  if (score >= cfg.maxRounds) cover.quit++;
  if (samples.length < 60 && score >= 3) samples.push({ cfg, log, score, subs: run.subs });
}
const revRate = rev / checks;
console.log(`honest: ${checks} checks of ${N} simulated runs - invalid ${inv}, review ${rev} (${(revRate * 100).toFixed(3)}%), score mismatch ${mism}; mean score ${(sumScore / N).toFixed(1)}, max ${maxScore}; biggest log ${maxBytes} B / ${maxEvents} events (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
console.log('honest ends ' + JSON.stringify(ends) + ', scores ' + JSON.stringify(scoreHist));
console.log('honest coverage ' + JSON.stringify(cover));
console.log('honest margins (threshold): follow mean min ' + near.folMin.toFixed(3) + ' r (' + R.PERSON.FOL_MEAN + '), aim RMS min ' + near.aimMin.toFixed(2) + ' px (' + R.PERSON.AIM_PX + '), presses<' + R.PERSON.RT_MS + 'ms share max ' + near.rtFastMax.toFixed(3) + ' (' + R.PERSON.RT_SHARE + '), reaction median min ' + near.rtMedMin.toFixed(0) + ' ms, press interval SD min ' + near.ivSdMin.toFixed(1) + ' ms (' + R.PERSON.STEADY_SD + '), 2 ms cluster share max ' + near.clusterMax.toFixed(3) + ' (' + R.PERSON.CLUSTER_SHARE + '), draw p min ' + near.pMin.toExponential(1) + ' (' + R.PERSON.LUCK_P + '), clamped share max ' + near.clampedMax.toFixed(2) + ' (' + R.PERSON.SLOW_SHARE + '), game/wall min ' + near.ratioMin.toFixed(3) + ' (' + R.PERSON.RATIO_MIN + '), largest sample gap ' + near.maxGap + ' ms (bound ' + (R.SAMPLE_MS + R.DT_MAX) + ')');
if (Object.keys(reasons).length) console.log('honest review reasons: ' + JSON.stringify(reasons));
console.log('log size: worst ' + worstPerRound.toFixed(0) + ' B per round played (budget ' + R.LOG_BUDGET + ' B -> ~' + Math.floor(R.LOG_BUDGET / Math.max(1, worstPerRound)) + ' rounds before the cut)');
if (inv) fail('honest runs rejected: ' + inv);
if (mism) fail('honest score mismatches: ' + mism);
if (revRate > 0.001) fail('honest review rate ' + (revRate * 100).toFixed(3) + '%');
if (near.maxGap > R.SAMPLE_MS + R.DT_MAX) fail('an honest sample gap over the bound');
if (!cover.pauseMidSlider || !cover.resize || !cover.strays || !cover.misses || !cover.lapses) fail('honest coverage has a hole: ' + JSON.stringify(cover));

// Streaks the modelled players reach (report only): strong (skill 0.8) and
// elite (skill 1) hands, desktop, no pauses, each mode, capped at 150 rounds.
{
  const K = +(process.env.SPEAR_NEW_STREAK_RUNS || 60);
  const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
  const parts = [], t2 = Date.now();
  for (const [label, skill] of [['strong', 0.8], ['elite', 1]]) for (const comp of [false, true]) {
    const sc = [];
    for (let k = 0; k < K; k++) {
      const cfg = Object.assign(honestConfig(500000 + k), { comp, mob: false, wrap: 924, pauses: [], resizes: [], ping: 0, maxRounds: 150 });
      cfg.player = playerFor(mulberry32(600000 + k), skill, false);
      sc.push(provenOf(simRun(cfg).runs[0].log));
    }
    parts.push(`${label} ${comp ? 'comp' : 'casual'} median ${q(sc, 0.5)}, p95 ${q(sc, 0.95)}, max ${Math.max(...sc)}`);
  }
  console.log(`streaks (report only, ${K} runs each, cap 150): ${parts.join('; ')} (${((Date.now() - t2) / 1000).toFixed(1)} s)`);
}
// A marathon past the byte budget (a strong hand, its slider-follow done by the
// sim with a human-sized wobble so it never tires): the log stays under
// LIMITS, and the submits past the cut are posted at what the log proves.
{
  const cfg = Object.assign(honestConfig(7), { comp: false, mob: false, wrap: 924, hz: 144, drop: 0.005, stallRate: 0, grain: 0, ping: 0, pauses: [], resizes: [], maxRounds: 175, seed: 777, shadow: true, endAfter: 3.6e6 });
  cfg.player = Object.assign(playerFor(mulberry32(1), 1, false), { lapse: 0, stray: 0, aim: 0.15, cyc: 60, fa: 10, fb: 40 });
  const out = simRun(cfg, follow(6, 77));
  const run = out.runs[0], log = run.log, proven = provenOf(log), played = run.subs.length ? run.subs[run.subs.length - 1].score : 0;
  const bytes = JSON.stringify(log).length;
  const r = check(log, played);
  console.log(`marathon: played ${played} rounds; the log stopped at ${log.ev.length} events, ${bytes} B (${(bytes / Math.max(1, proven)).toFixed(0)} B/round, ${(log.ev.length / Math.max(1, proven)).toFixed(0)} events/round), proves ${proven} -> ${r.verdict} ${r.score}${r.stats.capped ? ' (capped)' : ''} ${r.reasons.join(' | ')}`);
  if (r.verdict === 'invalid' || r.score !== proven) fail('marathon: ' + r.verdict + ' ' + r.score + ' ' + r.reasons);
  if (!(played > proven) || bytes > Q.LIMITS.MAX_BYTES - 20000 || log.ev.length > Q.LIMITS.MAX_EVENTS) fail('marathon: the log does not stop under LIMITS');
}
{
  // the byte budget: a log cut where the trainer stops logging proves the rounds before the cut
  const saved = R.LOG_BUDGET;
  R.LOG_BUDGET = 12000;
  try {
    const cfg = Object.assign(honestConfig(11), { comp: false, mob: false, wrap: 924, hz: 60, drop: 0.005, stallRate: 0, grain: 0, ping: 0, pauses: [], resizes: [], maxRounds: 30, seed: 4242, shadow: true });
    cfg.player = Object.assign(playerFor(mulberry32(2), 1, false), { lapse: 0, lag: 0, trk: 0.1, aim: 0.15 });
    const out = simRun(cfg);
    const run = out.runs[0], proven = provenOf(run.log), played = run.subs.length ? run.subs[run.subs.length - 1].score : 0;
    const r = check(run.log, played);
    console.log(`budget cut: played ${played}, log ${JSON.stringify(run.log.ev).length} B proves ${proven} -> ${r.verdict} ${r.score} ${r.stats.capped ? '(capped)' : ''}`);
    if (!(played > proven) || r.verdict === 'invalid' || r.score !== proven) fail('budget cut: ' + r.verdict + ' ' + r.score + ' ' + r.reasons);
    // and a claim above the proof without the cut is refused
    const small = cut(run.log, run.subs[0].len);
    if (check(small, played).verdict !== 'invalid') fail('budget cut: a short log with a big claim passed');
  } finally { R.LOG_BUDGET = saved; }
}
// Tor / resist-fingerprinting clocks floored to 100 ms: frames get a step of
// 0 or a clamped 50, the game honestly runs at half speed. Legal, held.
{
  const cfg = Object.assign(honestConfig(21), { grain: 100, hz: 60, stallRate: 0, maxRounds: 12, pauses: [], resizes: [] });
  cfg.player = Object.assign(playerFor(mulberry32(3), 0.9, cfg.mob), { lapse: 0 });
  const out = simRun(cfg), log = out.runs[0].log, sc = provenOf(log);
  const r = check(log, sc);
  console.log(`100 ms clock: ${sc} rounds -> ${r.verdict} ${r.score} ${r.reasons.join(' | ')}`);
  if (r.verdict === 'invalid' || r.score !== sc) fail('100 ms clock: ' + r.verdict + ' ' + r.reasons);
}

// ── b) forgeries ────────────────────────────────────────────────────────────
const forg = [];
function expectCaught(name, log, claimed, allowLow, asType) {
  const r = asType ? Q.check(asType, log, { platform: 'C', claimed }) : check(log, claimed);
  const ok = r.verdict !== 'valid' || (allowLow && r.score < claimed);
  forg.push({ name, verdict: r.verdict });
  console.log(`  ${ok ? 'ok  ' : 'MISS'} ${name}: ${r.verdict} score ${r.score}/${claimed} ${r.reasons.slice(0, 2).join(' | ')}`);
  if (!ok) fail('forgery passed: ' + name);
  return r;
}
const base = samples.find(s => s.score >= 4 && s.log.ev.some(e => e[0] === 'M') && s.log.ev.some(e => e[0] === 'T' && e[2] === 0) && s.log.ev[s.log.ev.length - 1][0] === 'E') || samples[0];
const H0 = base.log, S0 = base.score;
console.log('forgeries (base honest run: ' + S0 + ' rounds, ' + H0.ev.length + ' events, ends ' + JSON.stringify(H0.ev[H0.ev.length - 1]) + '):');
{ const r0 = check(H0, S0); if (r0.verdict !== 'valid' || r0.score !== S0) fail('base run not valid: ' + r0.reasons); }
const idxOf = (L, code, n) => { let k = -1; for (let q = 0; q < L.ev.length; q++) if (L.ev[q][0] === code && ++k === (n || 0)) return q; return -1; };
const mut = (name, fn, claimed) => { const L = clone(H0); if (fn(L) === false) { console.log('  skip ' + name); return; } expectCaught(name, L, claimed == null ? S0 : claimed); };
const gIx = e => (e[0] === 'E' ? 3 : 2);
const hasG = e => !'ZT'.includes(e[0]);

// claims, replays, clocks
expectCaught('no events + claim', { v: 1, rv: 1, type: H0.type, a: 0, env: H0.env, ev: [] }, 5);
expectCaught('claim above the logged points', H0, S0 + 3);
expectCaught('replayed honest log, higher claim', clone(H0), S0 + 1);
mut('run clock x0.5 (time compressed)', L => { for (const e of L.ev) e[1] = Math.round(e[1] * 0.5); });
mut('all times x0.5 (game clock too)', L => { for (const e of L.ev) { e[1] = Math.round(e[1] * 0.5); if (hasG(e)) { e[gIx(e)] = Math.round(e[gIx(e)] * 5) / 10; if ('RMF'.includes(e[0]) || (e[0] === 'E' && e[2] !== 'up')) e[gIx(e) + 1] = Math.round(e[gIx(e) + 1] * 5) / 10; } } });
mut('game clock x1.2 (slower sliders, longer rounds)', L => { for (const e of L.ev) if (hasG(e)) { e[gIx(e)] = Math.round(e[gIx(e)] * 12) / 10; if ('RMF'.includes(e[0]) || (e[0] === 'E' && e[2] !== 'up')) e[gIx(e) + 1] = Math.round(e[gIx(e) + 1] * 12) / 10; } });
mut('every event at one time', L => { for (const e of L.ev) e[1] = 5000; });
// inputs between frames
mut('a press moved between two frames', L => {
  for (let q = 0; q < L.ev.length - 1; q++) {
    const a = L.ev[q], b = L.ev[q + 1];
    if (a[0] === 'K' && 'MFR'.includes(b[0]) && b[3] >= 2) { a[2] = Math.round((b[2] - b[3] / 2) * 10) / 10; return; }
  }
  return false;
});
mut('a follow sample skipped (gap over the bound)', L => { const q = L.ev.findIndex((e, j) => e[0] === 'M' && L.ev[j + 1][0] === 'M'); if (q < 0) return false; L.ev.splice(q, 1); });
mut('a follow sample logged early', L => { const q = L.ev.findIndex((e, j) => e[0] === 'M' && L.ev[j - 1][0] === 'M'); if (q < 0) return false; const p = L.ev[q - 1]; L.ev.splice(q, 0, ['M', p[1], Math.round((p[2] + 1) * 10) / 10, 1, p[4], p[5]]); });
mut('a follow sample pulled off the ball', L => { const q = idxOf(L, 'M', 2); if (q < 0) return false; L.ev[q][4] += 80; });
mut('follow samples removed', L => { L.ev = L.ev.filter(e => e[0] !== 'M'); });
mut('the slider end moved earlier', L => { const q = idxOf(L, 'F'); if (q < 0) return false; const k = L.ev.slice(0, q).reverse().find(e => e[0] === 'K'); L.ev[q][2] = Math.round((k[2] + 100) * 10) / 10; L.ev[q][1] = Math.max(L.ev[q - 1][1], L.ev[q][1]); });
// invented hits and hidden fails
{
  const endRun = samples.find(s => { const l = s.log.ev[s.log.ev.length - 1]; return l[0] === 'E' && l[2] === 'far'; });
  if (endRun) {
    const L = clone(endRun.log), e = L.ev.pop();
    L.ev.push(['F', e[1], e[3], e[4], e[5], e[6]]);
    expectCaught('slider break rewritten as its end', L, endRun.score);
    const L2 = clone(endRun.log), e2 = L2.ev[L2.ev.length - 1];
    // move the pointer onto the ball: the break did not happen
    let k = null, rd = 0, ti = [];
    for (const x of L2.ev) { if (x[0] === 'Z') rd = R.radius(x[2], x[3], !!L2.env.mob); if (x[0] === 'R') ti = []; if (x[0] === 'T') ti.push(x); if (x[0] === 'K') k = x; }
    const tgE = ti[k[3]], pth = R.path({ x: tgE[3], y: tgE[4], ex: tgE[5], ey: tgE[6], o1: tgE[7], o2: tgE[8] });
    const sc = L2.ev.filter(x => x[0] === 'R').pop()[4];
    const b = R.ballAt(pth, R.frac(Math.round(e2[3] * 10), Math.round(k[2] * 10), R.travMs(sc, /-comp$/.test(L2.type)) * 10));
    e2[5] = R.px(b.x); e2[6] = R.px(b.y);
    expectCaught('slider break moved onto the ball', L2, endRun.score);
    void rd;
  } else console.log('  skip slider-break forgeries (no honest run ended far)');
  const timeRun = samples.find(s => { const l = s.log.ev[s.log.ev.length - 1]; return l[0] === 'E' && l[2] === 'time'; });
  if (timeRun) {
    const L = clone(timeRun.log); L.ev.pop();
    L.ev.push(['C', L.ev[L.ev.length - 1][1], L.ev[L.ev.length - 1][gIx(L.ev[L.ev.length - 1])], timeRun.score + 1]);
    expectCaught('timed-out round claimed as cleared', L, timeRun.score + 1);
    const L2 = clone(timeRun.log); L2.ev.pop();
    expectCaught('timer end removed, claim +1', L2, timeRun.score + 1);
  }
  const upRun = samples.find(s => { const l = s.log.ev[s.log.ev.length - 1]; return l[0] === 'E' && l[2] === 'up'; });
  if (upRun) { const L = clone(upRun.log); const e = L.ev.pop(); L.ev.push(['F', e[1], e[3], 16.7, 0, 0]); expectCaught('early release rewritten as the end', L, upRun.score); }
}
mut('a press off its target', L => { const q = idxOf(L, 'K', 1); L.ev[q][4] += 200; });
mut('a press on the wrong target', L => { const q = idxOf(L, 'K', 1); L.ev[q][3] += 1; });
mut('an extra press', L => { const q = idxOf(L, 'K', 2); L.ev.splice(q + 1, 0, L.ev[q].slice()); });
mut('a press removed', L => { const q = idxOf(L, 'K', 3); L.ev.splice(q, 1); });
mut('a round clear removed', L => { const q = idxOf(L, 'C', 1); L.ev.splice(q, 1); });
mut('a round clear duplicated', L => { const q = idxOf(L, 'C', 1); L.ev.splice(q + 1, 0, L.ev[q].slice()); });
mut('a round start removed', L => { const q = idxOf(L, 'R', 1); L.ev.splice(q, 1); });
mut('a round logged with a lower streak (easier curves)', L => { const q = idxOf(L, 'R', 2); L.ev[q][4] = 0; });
mut('next round before the 800 ms gap', L => { const q = idxOf(L, 'R', 2); L.ev[q][2] = Math.round((L.ev[q][2] - 400) * 10) / 10; });
// edited draws
mut('a circle moved', L => { const q = L.ev.findIndex(e => e[0] === 'T' && e[2] === 0); L.ev[q][3] += 60; });
mut('a round opened with a circle', L => { const q = idxOf(L, 'T'); L.ev[q] = ['T', L.ev[q][1], 0, L.ev[q][3], L.ev[q][4]]; });
mut('a slider turned into a circle', L => { const q = L.ev.findIndex((e, j) => e[0] === 'T' && e[2] === 1 && L.ev[j - 1][0] === 'T'); if (q < 0) return false; L.ev[q] = ['T', L.ev[q][1], 0, L.ev[q][3], L.ev[q][4]]; });
mut('a slider shortened', L => { const q = idxOf(L, 'T'); const e = L.ev[q]; e[5] = Math.round((e[3] + (e[5] - e[3]) * 0.5) * 10) / 10; e[6] = Math.round((e[4] + (e[6] - e[4]) * 0.5) * 10) / 10; });
mut('a slider bow flattened', L => { const q = idxOf(L, 'T'); L.ev[q][7] = Math.round(L.ev[q][7] * 0.3 * 10) / 10; L.ev[q][8] = Math.round(L.ev[q][8] * 0.3 * 10) / 10; });
mut('a slider bowed both ways', L => { const q = idxOf(L, 'T'); L.ev[q][8] = -L.ev[q][8]; });
mut('a target on the character', L => { const q = L.ev.findIndex(e => e[0] === 'T' && e[2] === 0); const z = L.ev.slice(0, q).reverse().find(e => e[0] === 'Z'); L.ev[q][3] = z[2] / 2; L.ev[q][4] = z[3] / 2; });
mut('a target on top of the one before', L => { const q = L.ev.findIndex((e, j) => e[0] === 'T' && e[2] === 0 && L.ev[j - 1][0] === 'T' && L.ev[j - 1][2] === 0); if (q < 0) return false; L.ev[q][3] = L.ev[q - 1][3] + 5; L.ev[q][4] = L.ev[q - 1][4]; });
mut('a round with a target missing', L => { const q = L.ev.findIndex((e, j) => e[0] === 'T' && L.ev[j + 1][0] === 'K'); L.ev.splice(q, 1); });
mut('a round with an extra target', L => { const q = L.ev.findIndex((e, j) => e[0] === 'T' && L.ev[j + 1][0] === 'K'); L.ev.splice(q + 1, 0, L.ev[q].slice()); });
// canvas
mut('canvas 1000 wide', L => { L.ev[0][2] = 1000; L.ev[0][3] = 540; });
mut('canvas height that does not fit its width', L => { L.ev[0][3] += 30; });
mut('canvas resized mid-round', L => { const q = idxOf(L, 'K', 2); L.ev.splice(q, 0, ['Z', L.ev[q][1], L.ev[0][2], L.ev[0][3]]); });
mut('first canvas size removed', L => { L.ev.splice(0, 1); });
// pauses
mut('resume at another game time', L => { const q = idxOf(L, 'K', 3); L.ev.splice(q + 1, 0, ['P', L.ev[q][1], L.ev[q][2]], ['U', L.ev[q][1] + 500, L.ev[q][2] + 300]); });
mut('play while paused', L => { const q = idxOf(L, 'K', 3); L.ev.splice(q, 0, ['P', L.ev[q][1], L.ev[q - 1][gIx(L.ev[q - 1])] || L.ev[q][2]]); });
// field types and ranges
mut('game time as a string', L => { const q = idxOf(L, 'K', 1); L.ev[q][2] = String(L.ev[q][2]); });
mut('game time off the 0.1 ms grid', L => { const q = idxOf(L, 'K', 1); L.ev[q][2] += 0.03; });
mut('negative game time', L => { const q = idxOf(L, 'K', 1); L.ev[q][2] = -5; });
mut('frame step of 80 ms', L => { const q = idxOf(L, 'M', 1); if (q < 0) return false; L.ev[q][3] = 80; });
mut('negative frame step', L => { const q = idxOf(L, 'M', 1); if (q < 0) return false; L.ev[q][3] = -1; });
mut('pointer x null', L => { const q = idxOf(L, 'M', 1); if (q < 0) return false; L.ev[q][4] = null; });
mut('pointer x 1e9', L => { const q = idxOf(L, 'K', 1); L.ev[q][4] = 1e9; });
mut('target index as a string', L => { const q = idxOf(L, 'K', 1); L.ev[q][3] = String(L.ev[q][3]); });
mut('target kind 2', L => { const q = idxOf(L, 'T', 1); L.ev[q][2] = 2; });
mut('round count as a string', L => { const q = idxOf(L, 'C'); L.ev[q][3] = String(L.ev[q][3]); });
mut('unknown end reason', L => { const q = L.ev.length - 1; if (L.ev[q][0] !== 'E') return false; L.ev[q][2] = 'lag'; });
mut('events after the end', L => { const l = L.ev[L.ev.length - 1]; if (l[0] !== 'E') return false; L.ev.push(['C', l[1] + 5, l[3], S0 + 1]); }, S0 + 1);
mut('unknown event code', L => { const q = idxOf(L, 'K', 1); L.ev.splice(q, 0, ['X', L.ev[q][1], L.ev[q][2]]); });
// the envelope
mut('log version 2', L => { L.v = 2; });
{ const L = clone(H0); L.type = 'spear-new-comp'; expectCaught('log for another type, sent as ' + H0.type, L, S0, false, H0.type); }
expectCaught('log sent as the other mode', clone(H0), S0, false, /-comp$/.test(H0.type) ? 'spear-new' : 'spear-new-comp');
mut('env with 9 fields', L => { for (let k = 0; k < 9; k++) L.env['f' + k] = k; });
mut('env with a long string', L => { L.env.w = 'x'.repeat(40); });
mut('event with 15 fields', L => { const q = idxOf(L, 'K', 1); while (L.ev[q].length < 15) L.ev[q].push(0); });
mut('event code of 4 letters', L => { const q = idxOf(L, 'K', 1); L.ev[q][0] = 'KKKK'; });
mut('fractional run time', L => { const q = idxOf(L, 'K', 1); L.ev[q][1] += 0.5; });
mut('run time going back', L => { const q = idxOf(L, 'K', 3); L.ev[q][1] = L.ev[q - 1][1] - 50; });
mut('a 40-letter string field', L => { const q = idxOf(L, 'K', 1); L.ev[q].push('y'.repeat(40)); });
mut('attempt -1', L => { L.a = -1; });
mut('events not an array', L => { L.ev = { 0: L.ev[0] }; });
mut('an object as a field', L => { const q = idxOf(L, 'K', 1); L.ev[q][4] = { x: 1 }; });
mut('too many events', L => { while (L.ev.length <= Q.LIMITS.MAX_EVENTS) L.ev.push(L.ev[L.ev.length - 1].slice()); });

// Modified clients and bots: the sim plays them, so every rule holds.
function botRun(name, cfgMod, extraMods, claimedFn) {
  const cfg = Object.assign(honestConfig(3), { comp: false, mob: false, wrap: 924, hz: 60, drop: 0.005, stallRate: 0, grain: 0, ping: 0, pauses: [], resizes: [], maxRounds: 12, seed: 99173 });
  cfg.player = Object.assign(playerFor(mulberry32(9), 1, false), { lapse: 0 });
  cfgMod(cfg);
  const out = simRun(cfg, extraMods);
  const log = out.runs[0].log, sc = provenOf(log);
  return expectCaught(name + ' (' + sc + ' rounds)', log, claimedFn ? claimedFn(sc) : sc);
}
botRun('perfect bot (instant presses on the centre, pointer on the ball)', c => { c.player.bot = { rt: 0, aim: 0, hold: 1 }; }, follow(0));
botRun('slider script (human presses, pointer put on the ball)', c => { c.player.trk = 0; }, follow(0.3));
botRun('press script (aim on the centre, human timing)', c => { c.player.aim = 0.005; });
botRun('instant presses (5 ms after each target shows, human aim)', c => { c.player.bot = { rt: 5, aim: 6, hold: 30 }; });
botRun('metronome (a press every 700 ms)', c => { c.player.bot = { rt: 0, aim: 6, hold: 40, cadence: 700 }; c.player.lag = 5; c.player.trk = 0.2; });
// a client that redraws a slider (other than a round's first) as a circle when it can
botRun('cherry-picked: few sliders', c => { c.maxRounds = 40; }, { draw: (u, first, prev, W, H, r) => {
  for (let k = 0; k < 4; k++) { const t = R.drawTarget(u, first, prev, W, H, r); if (first || t.kind === 0 || k === 3) return t; }
} });
// a client that keeps redrawing until a slider is near the shortest
botRun('cherry-picked: short sliders', c => { c.maxRounds = 40; }, { draw: (u, first, prev, W, H, r) => {
  const m = Math.min(W, H);
  for (let k = 0; k < 40; k++) {
    const t = R.drawTarget(u, first, prev, W, H, r);
    if (t.kind === 0 || Math.hypot(t.ex - t.x, t.ey - t.y) < (R.LEN_MIN + 0.03) * m) return t;
  }
  return R.drawTarget(u, first, prev, W, H, r);
} });
botRun('slow motion (12 fps: every frame at the clamp)', c => { c.hz = 12; c.drop = 0; c.maxRounds = 12; });
botRun('slowed client (game clock at 65%, frames look normal)', c => { c.maxRounds = 12; }, { clockScale: 0.65 });
botRun('pause spammer (P..U under 100 ms)', c => { c.pauses = []; for (let k = 0; k < 5; k++) c.pauses.push({ at: 3000 + k * 7000, dur: 5, how: 'panel', short: true }); c.maxRounds = 8; });
console.log(`forgeries: ${forg.length} tried, ${failures ? failures + ' failure(s) so far' : 'all caught'}`);

// ── c) the REAL IIFE in a stub page ─────────────────────────────────────────
{
  const NR = Math.max(80, N >> 4);
  let ri = 0, rr = 0, rm = 0, nlog = 0, nsub = 0, top = 0, restarts = 0, pausesSeen = 0, zs = 0;
  const t1 = Date.now();
  for (let k = 0; k < NR; k++) {
    const cfg = honestConfig(100000 + k);
    cfg.selfcheck = k % 10 === 0;
    if (k % 12 === 5) { cfg.restartAt = uni(mulberry32(k), 3000, 30000); restarts++; }
    if (k % 7 === 3 && !cfg.pauses.length) cfg.pauses = [{ at: uni(mulberry32(k + 9), 1500, 20000), dur: uni(mulberry32(k + 3), 300, 5000), how: k % 2 ? 'tab' : 'panel' }];
    const out = realRun(cfg);
    const g = out.game;
    if (g.errors.length) fail('real IIFE logged errors: ' + g.errors.slice(0, 2).join(' | '));
    const logs = g.submits.map(s => [s.log, s.score, 'submit']);
    const runs = new Set(g.submits.map(s => s.log.type));
    void runs;
    logs.push([clone(out.run.log), provenOf(out.run.log), 'final']);
    pausesSeen += out.run.log.ev.filter(e => e[0] === 'P').length;
    zs += Math.max(0, out.run.log.ev.filter(e => e[0] === 'Z').length - 1);
    let bi = false, br = false;
    for (const [lg, cl, what] of logs) {
      nlog++; if (what === 'submit') nsub++;
      const r = check(lg, cl);
      top = Math.max(top, cl);
      if (r.verdict === 'invalid') { bi = true; if (ri < 3) console.log('real IIFE invalid', what, r.reasons, JSON.stringify(cfg).slice(0, 300)); }
      if (r.verdict === 'review') { br = true; if (rr < 3) console.log('real IIFE review', what, r.reasons, JSON.stringify(r.stats)); }
      if (r.verdict !== 'invalid' && r.score !== cl) { rm++; if (rm < 3) console.log('real IIFE mismatch', what, r.score, cl, r.reasons); }
    }
    if (bi) ri++; if (br) rr++;
  }
  console.log(`real IIFE: ${NR} runs (${restarts} with a Start mid-run, ${pausesSeen} pauses, ${zs} mid-run resizes), ${nlog} logs checked (${nsub} submits), invalid ${ri}, review ${rr}, mismatch ${rm}, top ${top} (${((Date.now() - t1) / 1000).toFixed(1)} s)`);
  if (ri) fail('real IIFE honest runs invalid: ' + ri);
  if (rm) fail('real IIFE score mismatches: ' + rm);
  if (rr / NR > 0.01) fail('real IIFE review rate ' + rr / NR);
}
// Same seeds, same page: the sim and the real IIFE write the same log.
{
  let same = 0, tried = 0;
  for (let k = 0; k < 12; k++) {
    const cfg = honestConfig(200000 + k);
    const a = simRun(cfg).runs[0].log, b = realRun(cfg).run.log;
    tried++;
    if (JSON.stringify(a.ev) === JSON.stringify(b.ev)) same++;
    else if (tried - same <= 2) {
      let q = 0; while (q < a.ev.length && JSON.stringify(a.ev[q]) === JSON.stringify(b.ev[q])) q++;
      console.log('  sim vs real differ at event ' + q + ': ' + JSON.stringify(a.ev[q]) + ' vs ' + JSON.stringify(b.ev[q]));
    }
  }
  console.log(`sim = real IIFE: ${same}/${tried} logs identical event for event`);
  if (same !== tried) fail('the simulator and the real IIFE diverge');
}
// Scripted: the time cut, the log budget cut, and no rules file.
{
  const cfg = Object.assign(honestConfig(300001), { maxRounds: 50, pauses: [], restartAt: 0 });
  cfg.player = Object.assign(playerFor(mulberry32(4), 1, cfg.mob), { lapse: 0, lag: 0, trk: 0.1 });
  cfg.maxT = R.LOG_T_MARGIN + 25000; cfg.endAfter = 60000;
  const out = realRun(cfg), lg = clone(out.run.log);
  const lastT = lg.ev.length ? lg.ev[lg.ev.length - 1][1] : 0, bad = Q.validateLog(lg);
  const r = check(lg, provenOf(lg));
  console.log(`time cut: run closed ${out.run.closed}, last event at ${lastT} ms (cut at ${cfg.maxT - R.LOG_T_MARGIN}), ${out.game.submits.length} submits (last ${out.game.submits.length ? out.game.submits[out.game.submits.length - 1].score : '-'}) -> ${r.verdict} ${r.score}`);
  if (!out.run.closed || bad || lastT > cfg.maxT - R.LOG_T_MARGIN + 100 || r.verdict === 'invalid') fail('time cut: ' + (bad || r.reasons.join(' | ')));
  for (const s of out.game.submits) if (s.log.ev.length && s.log.ev[s.log.ev.length - 1][1] > cfg.maxT - R.LOG_T_MARGIN + 100) fail('time cut: a submit after the cut');
}
// The caps on the real trainer: its byte budget and the run's event cap
// (lowered here; the check is run with the same numbers). Past the event cap
// the hand reads a shadow of every event the trainer made, so it plays on and
// the submits claim more than the log proves. The byte budget stops the
// trainer before its run sees an event, so there the hand stops with the log
// (the sim above plays on past that cut); what is checked is where it stops.
const evBytes = ev => ev.reduce((n, e) => n + JSON.stringify(e).length + 1, 0);
for (const cap of [{ budget: 12000 }, { maxEvents: 400 }]) {
  const cfg = Object.assign(honestConfig(300002), { maxRounds: 30, pauses: [], restartAt: 0, mob: false, comp: false, wrap: 924, stallRate: 0, shadow: true }, cap);
  cfg.player = Object.assign(playerFor(mulberry32(5), 1, false), { lapse: 0, lag: 0, trk: 0.1, aim: 0.15 });
  const out = realRun(cfg), g = out.game;
  const proven = provenOf(out.run.log);
  let okAll = g.submits.length > 0, maxSub = 0;
  const savedB = R.LOG_BUDGET, savedE = Q.LIMITS.MAX_EVENTS;
  if (cap.budget) R.LOG_BUDGET = cap.budget;
  if (cap.maxEvents) Q.LIMITS.MAX_EVENTS = cap.maxEvents;
  try {
    for (const s of g.submits) {
      maxSub = Math.max(maxSub, s.score);
      const r = check(s.log, s.score);
      if (r.verdict === 'invalid' || r.score > s.score) { okAll = false; console.log('  capped submit', s.score, r.verdict, r.score, r.reasons); }
    }
  } finally { R.LOG_BUDGET = savedB; Q.LIMITS.MAX_EVENTS = savedE; }
  const L = out.run.log.ev, b = evBytes(L);
  console.log(`${cap.budget ? 'byte budget' : 'event cap'} cut (real IIFE): log of ${L.length} events, ${b} B, proves ${proven}; ${g.submits.length} submits up to ${maxSub}, all ${okAll ? 'pass' : 'NOT all pass'}`);
  if (!okAll) fail('cap on the real IIFE: a submit fails ' + JSON.stringify(cap));
  if (cap.maxEvents && !(maxSub > proven && L.length === cap.maxEvents)) fail('event cap on the real IIFE: no play past the cap');
  if (cap.budget && !(b > cap.budget && evBytes(L.slice(0, -1)) <= cap.budget)) fail('byte budget on the real IIFE: logging did not stop right past the budget');
}
{
  const env = makeEnv(1, 0);
  try {
    const g = makeReal(env, { wrap: 800, gameRng: mulberry32(1), noRules: true });
    console.log('IIFE without the spear-new rules: stops quietly' + (g.errors.length ? ' (says so on the console)' : ''));
    if (!g.errors.length) fail('IIFE without its rules says nothing');
  } catch (e) { fail('IIFE throws without its rules: ' + e.message); }
}

// ── d) the page bot on the REAL IIFE (async, like the browser harness) ──────
async function botOnReal(opts) {
  const env = makeEnv(opts.seed, 0);
  const game = makeReal(env, { comp: opts.comp, mob: false, wrap: opts.wrap, cssScale: opts.cssScale, ping: 0, gameRng: mulberry32(opts.seed + 1), selfcheck: true });
  const rng = mulberry32(opts.seed + 2);
  vm.runInContext(SRC.bot, game.sb);
  const ctx = {
    comp: !!opts.comp, target: opts.target,
    byId: id => game.els[id] || null,
    click: e => { if (e === game.els['spear-new-qte-start-btn']) game.start(); else if (e === game.els['spear-new-qte-resume-btn']) game.resume(); },
    key() {},
    mouse: (type, cx, cy) => {
      const e = { clientX: cx, clientY: cy, pointerId: 1 };
      if (type === 'pointerdown') game.down(e); else if (type === 'pointermove') game.move(e); else if (type === 'pointerup') game.up(e);
    },
    sleep: ms => new Promise(res => env.setTimeout(res, ms)),
    until: async (fn, ms) => { const end = env.clock + ms; while (env.clock < end) { const v = fn(); if (v) return v; await ctx.sleep(8); } return fn() || null; },
    run: () => game.run(),
    lastEv: code => { const r = game.run(); if (!r) return null; for (let i = r.log.ev.length - 1; i >= 0; i--) if (r.log.ev[i][0] === code) return r.log.ev[i]; return null; },
    human: (m, sd) => Math.max(0, m + sd * gauss(rng)),
    log() {},
  };
  let result = null, done = false, err = null;
  game.sb.__qteBots['spear-new'](ctx).then(r => { result = r; done = true; }, e => { err = e; done = true; });
  const P = 1000 / 60;
  let nextFrame = env.clock + P;
  while (!done && env.clock < 2e6) {
    env.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const tt = env.timers.length ? env.timers[0].at : Infinity;
    if (tt <= nextFrame) { const t = env.timers.shift(); env.clock = Math.max(env.clock, t.at); t.fn(); }
    else { env.clock = nextFrame; const due = env.rafs; env.rafs = []; for (const x of due) x.fn(env.clock); nextFrame = env.clock + (rng() < 0.03 ? 2 * P : P); }
    await new Promise(r => setImmediate(r));
  }
  if (err) throw err;
  return { result, game, run: game.run() };
}

(async () => {
  const cases = [
    { seed: 11, comp: false, wrap: 924, cssScale: 1, target: 3 },
    { seed: 12, comp: true, wrap: 624, cssScale: 0.8, target: 2 },
    { seed: 13, comp: false, wrap: 504, cssScale: 1.25, target: 2 },
  ];
  let ok = 0;
  for (const c of cases) {
    const out = await botOnReal(c);
    const pts = out.result ? out.result.points : -1;
    const r = check(clone(out.run.log), pts);
    let subsOk = out.game.submits.length > 0;
    for (const s of out.game.submits) { const rs = check(s.log, s.score); if (rs.verdict === 'invalid' || rs.score !== s.score) subsOk = false; }
    const selfOk = out.game.sb.QteRules.Run.lastSelfCheck && out.game.sb.QteRules.Run.lastSelfCheck.result.verdict !== 'invalid';
    console.log(`  page bot on the real IIFE ${out.run.type} wrap=${c.wrap}: ${pts} rounds, ${out.run.log.ev.length} events -> ${r.verdict} ${r.score}; ${out.game.submits.length} submits ${subsOk ? 'ok' : 'BAD'}, self-check ${selfOk ? 'ok' : 'BAD'} ${r.reasons.join(' | ')}`);
    if (r.verdict !== 'invalid' && r.score === pts && subsOk && selfOk && pts >= c.target) ok++;
    else fail('page bot case ' + c.seed + ': ' + r.verdict + ' ' + r.score + '/' + pts + ' ' + r.reasons.join(' | '));
  }
  console.log(`page bot: ${ok}/${cases.length} runs of the verbatim trainer checked valid`);
  console.log(failures ? `FAILED (${failures})` : 'OK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('FAIL page bot harness: ' + (e && e.stack || e)); process.exit(1); });
