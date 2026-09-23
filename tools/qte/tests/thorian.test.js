// thorian.test.js - node thorian.test.js
// Runs the REAL trainer (thorian.iife.js) against a fake DOM and a virtual
// clock: rAF at 30-144 Hz with dropped frames and stalls, late timers, the
// ping simulator's delayed keys, touch, pauses, resizes. Simulated players
// read the targets from the run's log (like the page bot) and press keys with
// human reaction times and timing error. The logs checked are the ones the
// IIFE itself wrote and submitted. Then forgeries, each must be refused/held.
'use strict';
require('./_paths.js');
const fs = require('fs');
const path = require('path');

const Q = require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const T = Q.trainers.thorian;
if (!T || typeof T.check !== 'function') { console.error('thorian rules not registered'); process.exit(1); }

const IIFE_SRC = fs.readFileSync(process.env.THIIFE || path.join(__dirname, 'thorian.iife.js'), 'utf8');   // THIIFE: try another build
const IIFE = new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame',
  'setTimeout', 'IS_MOBILE', 'QteRules', 'Math', 'console', IIFE_SRC);

let failures = 0;
function fail(msg) { failures++; console.log('FAIL ' + msg); }

// ── seeded randomness ───────────────────────────────────────────────────────
function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}
function mkRng(seed) { const r = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0); for (let i = 0; i < 20; i++) r(); return r; }
function normal(rng) { let u = 0; while (!u) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
function lognormal(rng, median, sigma) { return median * Math.exp(sigma * normal(rng)); }
function pick(rng, a) { return a[Math.floor(rng() * a.length)]; }

// ── the virtual browser ─────────────────────────────────────────────────────
let CUR = null;   // the world whose clock performance.now() reads
// opts.clamp: a coarse clock (privacy browsers): performance.now() and the rAF
// stamps are rounded down to that many ms.
function coarse(W, x) { const c = W.opts.clamp; return c ? Math.floor(x / c) * c : x; }
Object.defineProperty(globalThis, 'performance', { value: { now: () => (CUR ? coarse(CUR, CUR.now) : 0) }, configurable: true, writable: true });
const LS = {};
const lsStub = { getItem: k => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); }, removeItem: k => { delete LS[k]; } };
Object.defineProperty(globalThis, 'localStorage', { value: lsStub, configurable: true, writable: true });
globalThis._sbSubmitScore = function (type, score, packet) { if (CUR) CUR.submits.push({ type, score, log: packet.log }); };

function Heap() { this.a = []; }
Heap.prototype.push = function (x) {
  const a = this.a; a.push(x); let i = a.length - 1;
  while (i > 0) { const p = (i - 1) >> 1; if (less(a[p], a[i])) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
};
Heap.prototype.pop = function () {
  const a = this.a, top = a[0], last = a.pop();
  if (a.length) {
    a[0] = last; let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < a.length && less(a[l], a[m])) m = l;
      if (r < a.length && less(a[r], a[m])) m = r;
      if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
    }
  }
  return top;
};
function less(x, y) { return x.t < y.t || (x.t === y.t && x.seq < y.seq); }

const noop = function () {};
const CTX = { save: noop, restore: noop, fillText: noop, fillRect: noop, clearRect: noop, strokeRect: noop,
  beginPath: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop, closePath: noop, fill: noop, arc: noop };

// opts: { seed, comp, mobile, wrapW, hz, dropP, stallP, lateP, ping, randFor }
function World(opts) {
  const W = this;
  W.opts = opts;
  W.rng = mkRng(opts.seed * 7919 + 13);          // the browser's own jitter
  W.now = 1000 + W.rng() * 5000;
  W.seq = 0; W.q = new Heap(); W.submits = []; W.done = false;
  W.period = 1000 / opts.hz; W.phase = W.rng() * W.period;
  W.rafs = new Map(); W.rafId = 0; W.frameQueued = false;
  W.wrap = { clientWidth: opts.wrapW };
  const canvas = { width: 300, height: 150, style: {}, getContext: () => CTX, parentElement: W.wrap,
    parentNode: { insertBefore: noop }, nextSibling: null };
  function el() { return { textContent: '', style: { display: '' }, _l: {}, addEventListener(t, f) { this._l[t] = f; } }; }
  W.els = {
    'thorian-qte-canvas': canvas, 'thorian-qte-status': el(), 'thorian-qte-streak': el(), 'thorian-qte-highscore': el(),
    'thorian-qte-start-btn': el(), 'thorian-qte-resume-btn': el(),
    'page-qte': { classList: { contains: c => c === 'active' } }, 'qte-panel-thorian': { style: { display: 'flex' } },
  };
  W.els['thorian-qte-resume-btn'].style.display = 'none';
  W.keyL = []; W.touch = {};
  const doc = {
    getElementById: id => W.els[id] || null,
    addEventListener: (t, f) => { if (t === 'keydown') W.keyL.push(f); },
    createElement: () => ({
      className: '', innerHTML: '',
      querySelectorAll: () => ['up', 'left', 'right'].map(d => ({ dataset: { dir: d }, addEventListener(t, f) { W.touch[d] = f; } })),
    }),
  };
  const win = { addEventListener: noop, _qteCompMode: !!opts.comp, QteRules: Q };
  W.win = win;
  const rafFn = cb => { const id = ++W.rafId; W.rafs.set(id, cb); W.queueFrame(); return id; };
  const cafFn = id => { W.rafs.delete(id); };
  const stFn = (fn, d) => { W.at(W.now + Math.max(0, d || 0) + W.late(), fn); return 0; };
  const M = Object.create(Math);
  const rr = mkRng(opts.seed * 104729 + 7);
  M.random = opts.randFor ? opts.randFor(rr) : rr;
  CUR = W;
  IIFE(win, doc, lsStub, rafFn, cafFn, stFn, !!opts.mobile, Q, M, { error: noop, log: noop });
}
World.prototype.at = function (t, fn) { this.q.push({ t, seq: this.seq++, fn }); };
World.prototype.late = function () {
  const r = this.rng();
  if (r < this.opts.lateP) return 10 + this.rng() * 90;   // a busy tab
  return this.rng() * 4;
};
World.prototype.queueFrame = function () {
  if (this.frameQueued) return;
  this.frameQueued = true;
  const W = this, p = W.period;
  let k = Math.floor((W.now - W.phase) / p) + 1;
  if (W.rng() < W.opts.dropP) k += 1 + Math.floor(W.rng() * 3);   // dropped frames
  // The browser tab hidden for a while (no hide hook): no frames, timers run on.
  if (W.opts.bgFreezeP && W.rng() < W.opts.bgFreezeP) k += Math.floor((1000 + W.rng() * 14000) / p);
  const vt = W.phase + k * p;
  W.at(vt, () => {
    W.frameQueued = false;
    // A rAF stamp is the frame's start, which can predate the moment the
    // callback was asked for (Chrome); never before the previous stamp.
    let ts = vt;
    if (W.opts.earlyTs && W.rng() < 0.3) ts = Math.max(W.lastTs || 0, vt - p * W.rng());
    ts = coarse(W, ts);
    W.lastTs = ts;
    W.now = Math.max(W.now, vt) + 0.2 + W.rng() * 1.5;
    const cbs = Array.from(W.rafs.entries()); W.rafs.clear();
    for (const [, cb] of cbs) cb(ts);
    if (W.rng() < W.opts.stallP) W.now += 60 + W.rng() * 200;       // a long task
    if (W.agent) W.agent.tick();
  });
};
World.prototype.runUntil = function (tEnd) {
  CUR = this;
  while (this.q.a.length && !this.done) {
    const x = this.q.pop();
    if (x.t > tEnd) break;
    this.now = Math.max(this.now, x.t);
    x.fn();
  }
};
World.prototype.run = function () { return Q.Run.current; };
World.prototype.clickStart = function () { this.els['thorian-qte-start-btn']._l.click(); };
World.prototype.clickResume = function () { const f = this.els['thorian-qte-resume-btn']._l.click; if (f) f(); };
// A key press by the player at wall time `when`: delivered after the ping sim's delay.
World.prototype.press = function (when, dir, onDeliver) {
  const W = this;
  if (W.opts.mobile) {
    W.at(when, () => { W.touch[dir]({ preventDefault: noop }); if (onDeliver) onDeliver(); });
    return;
  }
  const key = pick(W.rng, { up: ['ArrowUp', 'w', 'W'], left: ['ArrowLeft', 'a'], right: ['ArrowRight', 'd'] }[dir]);
  const delay = W.opts.ping > 0 ? W.opts.ping + W.late() : 0;
  W.at(when + delay, () => {
    const e = { key, preventDefault: noop };
    for (const f of W.keyL) f(e);
    if (onDeliver) onDeliver();
  });
};

// ── the players ─────────────────────────────────────────────────────────────
const DIRS = ['up', 'left', 'right'];
// p: { rtMed, rtSig, sdT, phi, phiSd, after, afterSd, lapse, adapt, fidget, maxRounds,
//      pauses, fixed: null | 'lead' | 'spawn' | 'block' | 'mid' }
function Agent(W, p, rng) {
  this.W = W; this.p = p; this.rng = rng;
  this.idx = 0; this.hs = []; this.next = 0; this.bar = 2; this.planned = 2;
  this.gen = 0; this.wins = 0; this.stop = false; this.paused = false; this.lastPress = 0; this.pressN = 0;
  this.G = null; this.v = 0; this.round = -1;
}
Agent.prototype.tick = function () {
  const run = this.W.run();
  if (!run) return;
  if (run !== this.runRef) {        // a new Start: a new log
    if (this.runRef) { for (; this.idx < this.runRef.log.ev.length; this.idx++) this.see(this.runRef.log.ev[this.idx]); }
    this.runRef = run; this.idx = 0; this.hs = []; this.next = 0; this.bar = 2; this.planned = 2; this.gen++;
  }
  const ev = run.log.ev;
  for (; this.idx < ev.length; this.idx++) this.see(ev[this.idx]);
};
Agent.prototype.see = function (e) {
  const W = this.W, p = this.p;
  switch (e[0]) {
    case 'G':
      this.hs = []; this.next = 0; this.round = e[2]; this.G = T.geom(e[3]);
      this.v = T.speed(e[2], W.opts.comp) / 1000; this.planned = this.bar;
      break;
    case 'Z': this.G = T.geom(e[2]); break;
    case 'H': {
      const o = T.offset(this.G, e[3]);
      const pa = T.path(this.G, o);
      const tw = this.W.run().t0 + e[1];   // log times count from Start
      const h = { id: this.hs.length, side: e[2], tH: tw, cW: tw + (pa.contact / this.v - e[5]) / (p.pace || 1), res: false, seen: false, gen: this.gen };
      this.hs.push(h);
      const rt = p.fixed === 'spawn' ? p.rtMed : Math.max(60, lognormal(this.rng, p.rtMed, p.rtSig));
      const gen = this.gen;
      W.at(W.now + rt, () => { if (gen !== this.gen) return; h.seen = true; this.plan(); });
      break;
    }
    case 'B': case 'X': case 'O': {
      const h = this.hs[e[2]];
      if (h) { h.res = true; h.resW = this.W.run().t0 + e[1]; if (h.then) this.pressAt(W.now + p.after, h.then.dir); }
      if (p.home >= 0 && !this.stop && this.hs.every(x => x.res) && this.planned !== p.home) {
        this.planned = p.home; this.pressAt(W.now + Math.max(80, lognormal(this.rng, 220, 0.3)), DIRS[p.home]);
      }
      break;
    }
    case 'K': this.bar = e[2]; break;
    case 'W':
      if (W.onWin) W.onWin(e);
      this.wins++; this.hs = []; this.next = 0;
      if (this.wins >= p.maxRounds) this.stop = true;
      break;
    case 'E': if (W.onEnd) W.onEnd(e); else W.done = true; break;
  }
};
Agent.prototype.plan = function () {
  const W = this.W, p = this.p, rng = this.rng;
  while (this.next < this.hs.length && this.hs[this.next].seen) {
    const j = this.hs[this.next++];
    if (this.stop || j.res) continue;
    if (j.side === this.planned) continue;
    const prev = this.hs[j.id - 1];
    let earliest = W.now;
    if (p.fixed === 'block') {                  // a bot: a fixed delay after it sees the previous block
      if (prev && !prev.res) prev.then = { dir: DIRS[j.side] };
      else this.pressAt(W.now + p.after, DIRS[j.side]);
      this.planned = j.side;
      continue;
    }
    if (prev && !prev.res && prev.side !== j.side) earliest = Math.max(earliest, prev.cW + (p.fixed && p.fixed !== 'asap' ? p.after : Math.max(5, p.after + p.afterSd * normal(rng))));
    const latest = j.cW - 15;
    let eff;
    if (p.fixed === 'lead') eff = j.cW - p.lead;
    else if (p.fixed === 'spawn') eff = j.tH + p.rtMed;
    else if (p.fixed === 'block') eff = earliest;
    else if (p.fixed === 'asap') eff = earliest + Math.abs(p.sdT * normal(rng));
    else if (p.fixed === 'mid') eff = latest > earliest ? (earliest + latest) / 2 : earliest;
    else {
      const phi = Math.min(1, Math.max(0, p.phi + p.phiSd * normal(rng)));
      eff = (latest > earliest ? earliest + phi * (latest - earliest) : earliest) + p.sdT * normal(rng);
    }
    let when = eff - (W.opts.ping || 0) * p.adapt;
    when = Math.max(W.now + 1, when);
    let dir = DIRS[j.side];
    const lapse = rng() < p.lapse;
    if (lapse) {
      if (rng() < 0.5) { this.planned = j.side; continue; }   // forgot this one
      dir = pick(rng, DIRS.filter(d => d !== DIRS[j.side]));
      this.pressAt(when, dir);
      this.pressAt(when + Math.max(120, 220 + 40 * normal(rng)), DIRS[j.side]);   // noticed, corrected
    } else this.pressAt(when, dir);
    this.planned = j.side;
  }
};
Agent.prototype.pressAt = function (when, dir) {
  const W = this.W, gen = this.gen, n = ++this.pressN;
  W.at(when, () => {
    if (gen !== this.gen) return;
    this.lastPress = W.now;
    W.press(W.now, dir);
    // held key: auto-repeat until another key goes down
    if (!W.opts.mobile && this.rng() < 0.1) {
      const reps = 1 + Math.floor(this.rng() * 4);
      for (let r = 0; r < reps; r++) W.at(W.now + 500 + 33 * r, () => { if (this.pressN === n && gen === this.gen) W.press(W.now, dir); });
    }
  });
};
Agent.prototype.fidget = function () {
  const W = this.W;
  if (W.done) return;
  const open = this.hs.some(h => !h.res);
  if (!open && !this.paused && !this.stop && this.round >= 0) {
    const d = pick(this.rng, DIRS);
    this.planned = DIRS.indexOf(d);
    this.pressAt(W.now, d);
  }
  W.at(W.now + 120 + this.rng() * 300, () => this.fidget());
};
Agent.prototype.schedulePause = function (tFromNow) {
  const W = this.W, rng = this.rng;
  W.at(W.now + tFromNow, () => {
    if (W.done) return;
    const tp = W.now;
    W.win._onThorianQteHide();
    this.paused = true; this.gen++;
    const away = this.p.hopper ? 300 + rng() * 2500 : 300 + rng() * 15000;
    W.at(W.now + away, () => {
      if (rng() < 0.25) W.wrap.clientWidth = pick(rng, [464, 464, 420, 380, 340]);
      W.win._onThorianQteShow();
      W.at(W.now + 200 + rng() * 1500, () => {
        const shift = W.now - tp;
        W.clickResume();
        // a slip: straight back to another tab and back again, before a frame
        if (rng() < 0.15) { W.win._onThorianQteHide(); W.win._onThorianQteShow(); W.clickResume(); }
        this.paused = false;
        for (const h of this.hs) if (!h.res) { h.cW += shift; h.tH += shift; h.seen = false; }
        this.next = 0; while (this.next < this.hs.length && this.hs[this.next].res) this.next++;
        this.planned = this.bar;
        const gen = this.gen;
        for (const h of this.hs) if (!h.res) W.at(W.now + lognormal(rng, this.p.rtMed, this.p.rtSig), () => { if (gen !== this.gen) return; h.seen = true; this.plan(); });
        if (this.pausesLeft > 0) { this.pausesLeft--; this.schedulePause(this.p.hopper ? 3000 + rng() * 9000 : 5000 + rng() * 60000); }
      });
    });
  });
};

function humanParams(rng, skill) {
  return {
    rtMed: 320 - 100 * skill + 30 * normal(rng) * 0.3, rtSig: 0.18 + 0.08 * rng(),
    sdT: 70 - 55 * skill, phi: 0.2 + 0.4 * rng(), phiSd: 0.15 + 0.15 * rng(),
    after: 20 + 40 * rng(), afterSd: 15 + 25 * (1 - skill),
    lapse: 0.06 * (1 - skill) + 0.002, adapt: rng() * 0.8,
    fidget: rng() < 0.2, fixed: null,
    home: rng() < 0.2 ? Math.floor(rng() * 3) : -1,   // turns the bar back to a favourite side when idle
  };
}

// One Start, played to the end. Returns the submits and the full final log.
function simulate(o) {
  const rng = mkRng(o.seed);
  for (const k in LS) delete LS[k];
  const W = new World(o);
  const ag = new Agent(W, o.player, mkRng(o.seed * 31 + 5));
  W.agent = ag;
  W.at(W.now + 50, () => { W.clickStart(); ag.tick(); });
  if (o.player.fidget) W.at(W.now + 300, () => ag.fidget());
  ag.pausesLeft = o.pauses || 0;
  if (ag.pausesLeft > 0) { ag.pausesLeft--; ag.schedulePause(1000 + rng() * 40000); }
  if (o.showWhileRunning) W.at(W.now + 3000 + rng() * 20000, () => { W.wrap.clientWidth = pick(rng, [464, 400, 360]); W.win._onThorianQteShow(); });
  // The pause trick: another tab and straight back every spamPause ms, so the
  // strip countdown (700 ms after each Resume) never runs out.
  if (o.spamPause) {
    const spam = () => {
      if (W.done) return;
      W.win._onThorianQteHide(); W.win._onThorianQteShow(); W.clickResume();
      W.at(W.now + o.spamPause, spam);
    };
    W.at(W.now + 50 + o.spamPause, spam);
  }
  W.runUntil(W.now + (o.maxMs || 3.6e6));
  const run = W.run();
  CUR = null;
  return { submits: W.submits, full: run && run.log, wins: ag.wins, type: 'thorian' + (o.comp ? '-comp' : '') };
}

function checkLog(type, log, claimed) {
  return Q.check(type, log, { platform: 'C', claimed });
}

const MINS = {}, COV = { rounds: 0, dead: 0, pauseRound: 0, pauseGap: 0, resize: 0, offscreen: 0, hits: 0, keysInGap: 0, ping: 0, touch: 0, comp: 0, hz30: 0, hz144: 0,
  clock100: 0, slowDevice: 0, bgTab: 0, hopper: 0, earlyTs: 0 };
function cover(log, o) {
  let gap = false;
  for (const e of log.ev) {
    if (e[0] === 'W') { COV.rounds++; gap = true; } else if (e[0] === 'G') gap = false;
    else if (e[0] === 'P') gap ? COV.pauseGap++ : COV.pauseRound++;
    else if (e[0] === 'Z') COV.resize++;
    else if (e[0] === 'O') COV.offscreen++;
    else if (e[0] === 'X') COV.hits++;
    else if (e[0] === 'K' && gap) COV.keysInGap++;
    else if (e[0] === 'E' && e[2] === 'dead') COV.dead++;
  }
  if (o.ping) COV.ping++; if (o.mobile) COV.touch++; if (o.comp) COV.comp++; if (o.hz === 30) COV.hz30++; if (o.hz === 144) COV.hz144++;
  if (o.clamp === 100) COV.clock100++; if (o.hz < 20) COV.slowDevice++; if (o.bgFreezeP) COV.bgTab++; if (o.player.hopper) COV.hopper++; if (o.earlyTs) COV.earlyTs++;
}
function trackMin(r) {
  const s = r.stats;
  for (const k of ['marginSdMs', 'spawnDelaySdMs', 'prevDelaySdMs', 'phaseSd']) if (s.marginN >= 40 && typeof s[k] === 'number' && s[k] > 0 && !(MINS[k] <= s[k])) MINS[k] = s[k];
  if (s.coldN >= 8 && !(MINS.coldMedianMs <= s.coldMedianMs)) MINS.coldMedianMs = s.coldMedianMs;
  for (const k of ['sidesP', 'repeatP', 'offsetsP']) if (s[k] !== undefined && !(MINS[k] <= +s[k])) MINS[k] = +s[k];
  if (typeof s.gamePace === 'number' && !(MINS.gamePace <= s.gamePace)) MINS.gamePace = s.gamePace;
}
// ── a) honest players ───────────────────────────────────────────────────────
function honestSuite() {
  const N = +process.env.THN || 2200;
  let invalid = 0, review = 0, mismatch = 0, runs = 0, checked = 0;
  let maxBytes = 0, maxEv = 0, maxRounds = 0, bytesTop = 0;
  const reasons = {};
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const rng = mkRng(1000 + i);
    const mobile = rng() < 0.2;
    const skill = i < 40 ? 1 : Math.pow(rng(), 0.7);
    const player = humanParams(rng, skill);
    player.maxRounds = i < 40 ? 25 + Math.floor(rng() * 20) : (rng() < 0.3 ? 1 + Math.floor(rng() * 3) : 3 + Math.floor(rng() * 12));
    const o = {
      seed: 1000 + i, comp: rng() < 0.5, mobile, player,
      wrapW: mobile ? pick(rng, [296, 320, 344, 360, 390, 414, 250]) : pick(rng, [464, 464, 464, 600, 420, 380]),
      hz: pick(rng, [60, 60, 60, 120, 144, 75, 30]), dropP: 0.02 + rng() * 0.05, stallP: rng() * 0.004, lateP: 0.03,
      ping: mobile ? 0 : (i < 40 ? 0 : pick(rng, [0, 0, 150, 300])),
      pauses: rng() < 0.25 ? 1 + Math.floor(rng() * 3) : 0,
      showWhileRunning: rng() < 0.03,
    };
    if (i < 40) { o.pauses = 0; o.hz = pick(rng, [60, 144]); o.dropP = 0.01; o.stallP = 0.0005; }
    else {
      o.earlyTs = rng() < 0.3;
      const x = rng();
      if (x < 0.05) o.clamp = 100;                        // privacy browser: 100 ms clocks
      else if (x < 0.10) o.clamp = pick(rng, [1, 16.67]);
      else if (x < 0.14) { o.hz = pick(rng, [12, 15]); o.dropP = 0.01; }   // a slow device
      if (rng() < 0.04) o.bgFreezeP = 0.002;              // switches browser tab now and then
      if (rng() < 0.06) { player.hopper = true; o.pauses = 2 + Math.floor(rng() * 4); }   // flips between QTE tabs a lot
    }
    const res = simulate(o);
    runs++;
    const all = rng() < 0.08;   // every submit of some runs, the last of all
    const toCheck = all ? res.submits : res.submits.slice(-1);
    for (const s of toCheck) {
      checked++;
      const r = checkLog(s.type, s.log, s.score);
      trackMin(r);
      if (r.verdict === 'invalid') { invalid++; reasons[r.reasons[0]] = (reasons[r.reasons[0]] || 0) + 1; if (invalid <= 5) dumpFail(o, s, r); }
      else if (r.verdict === 'review') { review++; reasons[r.reasons[0]] = (reasons[r.reasons[0]] || 0) + 1; }
      if (r.verdict !== 'invalid' && r.score !== s.score) { mismatch++; if (mismatch <= 3) console.log('  mismatch', s.score, r.score, r.stats); }
    }
    if (res.full) {                                  // the log after the end (E), too
      cover(res.full, o);
      const r = checkLog(res.type, res.full, res.wins);
      if (r.verdict === 'invalid') { invalid++; reasons['(full) ' + r.reasons[0]] = (reasons['(full) ' + r.reasons[0]] || 0) + 1; if (invalid <= 5) dumpFail(o, { log: res.full, score: res.wins }, r); }
      const bytes = JSON.stringify(res.full).length;
      if (bytes > maxBytes) { maxBytes = bytes; }
      maxEv = Math.max(maxEv, res.full.ev.length);
      if (res.wins > maxRounds) { maxRounds = res.wins; bytesTop = bytes; }
    }
  }
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`honest: ${runs} runs, ${checked} submits checked: invalid ${invalid}, review ${review} (${(100 * review / checked).toFixed(2)}%), score mismatch ${mismatch}; ` +
    `largest log ${maxBytes} B / ${maxEv} events; longest run ${maxRounds} rounds = ${bytesTop} B; ${sec}s`);
  for (const k in reasons) console.log('   ', reasons[k], 'x', k);
  console.log('    lowest honest person-check numbers: ' + JSON.stringify(MINS));
  console.log('    coverage: ' + JSON.stringify(COV));
  if (invalid) fail('honest runs judged invalid');
  if (mismatch) fail('honest score mismatch');
  if (review / checked > 0.005) fail('honest review rate over 0.5%');
  return { runs, invalid, review, mismatch, checked };
}
function dumpFail(o, s, r) {
  console.log('  INVALID honest', JSON.stringify({ seed: o.seed, comp: o.comp, hz: o.hz, ping: o.ping, mobile: o.mobile, wrapW: o.wrapW }), r.reasons);
  const m = /event (\d+)/.exec(r.reasons[0] || '');
  if (m) { const k = +m[1]; console.log('   ', JSON.stringify(s.log.ev.slice(Math.max(0, k - 12), k + 2))); }
}

// ── b) forgeries ────────────────────────────────────────────────────────────
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function refused(r, claimed) { return r.verdict !== 'valid' || r.score <= Math.floor(claimed / 2); }

function forgerySuite() {
  const out = [];
  function expect(name, type, log, claimed, want) {
    const r = checkLog(type, log, claimed);
    const ok = want ? r.verdict === want : refused(r, claimed);
    out.push({ name, verdict: r.verdict + ' ' + r.score + '/' + claimed + ' - ' + (r.reasons[0] || '') });
    if (!ok) fail('forgery "' + name + '" got ' + r.verdict + ' score ' + r.score + ' (claimed ' + claimed + ') ' + JSON.stringify(r.reasons) + ' ' + JSON.stringify(r.stats));
  }
  // a solid honest base run with some hits in it
  let base = null;
  for (let s = 50000; s < 50100 && !base; s++) {
    const rng = mkRng(s);
    const player = humanParams(rng, 0.8); player.maxRounds = 6; player.fidget = false;
    const res = simulate({ seed: s, comp: false, player, wrapW: 464, hz: 60, dropP: 0.02, stallP: 0, lateP: 0.02, ping: 0 });
    const last = res.submits[res.submits.length - 1];
    if (last && last.score >= 5 && last.log.ev.some(e => e[0] === 'X') && checkLog(last.type, last.log, last.score).verdict === 'valid') base = last;
  }
  if (!base) { fail('no honest base run for the forgeries'); return out; }
  const type = base.type, L = base.log, N = base.score;
  const idxOf = (code, from) => { for (let i = from || 0; i < L.ev.length; i++) if (L.ev[i][0] === code) return i; return -1; };

  expect('no events + claim', type, Object.assign(clone(L), { ev: [] }), 5, 'invalid');
  expect('claim above the logged points', type, clone(L), N + 3, 'invalid');
  expect('replayed honest log, higher claim', type, clone(L), N + 1, 'invalid');
  { const f = clone(L); f.ev.forEach(e => { e[1] = Math.round(e[1] * 0.5); if (e[0] === 'H') { e[4] = Math.round(e[4] * 5) / 10; e[5] = Math.round(e[5] * 5) / 10; } if ('BXOK'.includes(e[0])) e[3] = Math.round(e[3] * 5) / 10; if (e[0] === 'W' || e[0] === 'P') e[2] = Math.round(e[2] * 5) / 10; });
    expect('all times scaled x0.5', type, f, N); }
  { const f = clone(L); f.ev.forEach(e => { e[1] = Math.round(e[1] * 0.5); }); expect('wall times scaled x0.5', type, f, N); }
  { const f = clone(L); const k = idxOf('X'); f.ev[k][0] = 'B'; expect('a logged miss marked as a block', type, f, N, 'invalid'); }
  { const f = clone(L); f.ev = f.ev.filter(e => e[0] !== 'X'); expect('hits removed from the log', type, f, N, 'invalid'); }
  { const f = clone(L); const k = idxOf('H'); f.ev[k][3] = 160; expect('a heart off its lane (u 160 of 0..99)', type, f, N, 'invalid'); }
  { const f = clone(L); const k = idxOf('H'); f.ev[k][2] = 3; expect('a heart from a 4th side', type, f, N, 'invalid'); }
  { // drop the 2nd heart of round 2 (and its outcome), renumbering the rest
    const f = clone(L); const g0 = idxOf('G', idxOf('W') + 1), w = idxOf('W', g0);
    const out2 = [];
    let hN = 0;
    f.ev.forEach((e, i) => {
      if (i > g0 && i < w) {
        if (e[0] === 'H') { hN++; if (hN === 2) return; }
        if ('BXO'.includes(e[0])) { if (e[2] === 1) return; if (e[2] > 1) e[2]--; }
      }
      out2.push(e);
    });
    f.ev = out2; expect('a heart left out of a strip', type, f, N, 'invalid'); }
  { const f = clone(L); const k = idxOf('H'); const e = clone(f.ev[k]); f.ev.splice(k + 1, 0, e); expect('an extra heart in the same frame', type, f, N, 'invalid'); }
  { const f = clone(L); const k = idxOf('H'); f.ev[k][4] = Math.max(0, f.ev[k][4] - 400); f.ev[k][5] = 16.7; expect('a strip started early', type, f, N, 'invalid'); }
  { const f = clone(L); const k = idxOf('H'); f.ev[k][5] = 90; expect('a 90 ms frame step', type, f, N, 'invalid'); }
  { const f = clone(L); const k = idxOf('W'); f.ev[k][2] -= 1500; expect('a round won early (game clock)', type, f, N, 'invalid'); }
  { const f = clone(L); const k = idxOf('W'); const w = f.ev.splice(k, 1)[0]; const k2 = idxOf('H'); w[1] = f.ev[k2][1]; f.ev.splice(k2, 0, w); expect('impossible order: a win before the round\'s hearts', type, f, N, 'invalid'); }
  { const f = clone(L); const kb = idxOf('B'); const b = f.ev.splice(kb, 1)[0]; const kh = idxOf('H'); f.ev.splice(kh, 0, b); b[1] = f.ev[kh + 1][1]; expect('impossible order: a block before its heart', type, f, N, 'invalid'); }
  { const f = clone(L); const kw = idxOf('W'); f.ev.splice(kw + 1, 0, ['P', f.ev[kw][1] + 100, f.ev[kw][2]], ['U', f.ev[kw][1] + 400], ['W', f.ev[kw][1] + 450, f.ev[kw][2]]);
    expect('free point: pause/resume in the gap, round won twice', type, f, N + 1, 'invalid'); }
  { const f = clone(L); const kx = idxOf('X'); const g = f.ev.find(e => e[0] === 'G'); void g;
    // a third life: a second hit in the round and play on
    const e = f.ev[kx]; let kh = -1; for (let i = kx + 1; i < f.ev.length && f.ev[i][0] !== 'W'; i++) if (f.ev[i][0] === 'B') { kh = i; break; }
    if (kh > 0) { f.ev[kh][0] = 'X'; } void e; expect('two hits in a round and play on', type, f, N, 'invalid'); }
  { const f = clone(L); f.ev.find(e => e[0] === 'G')[3] = 900; expect('a canvas the page cannot make (900 px)', type, f, N, 'invalid'); }
  { const f = clone(L); const k = idxOf('H'); for (let z = 0; z < 7; z++) f.ev.splice(k, 0, ['Z', f.ev[k][1], z % 2 ? 440 : 400]); expect('resized 7 times (unjudged hearts)', type, f, N); }
  { const f = clone(L); const kb = idxOf('B'); f.ev[kb][3] += 600; for (let i = kb + 1; i < f.ev.length && f.ev[i][1] < f.ev[kb][1]; i++); expect('a block logged after the heart passed the bar', type, f, N, 'invalid'); }
  { const f = clone(L); const k = idxOf('K', idxOf('G', 1)); f.ev.splice(k + 1, 0, ['K', f.ev[k][1], f.ev[k][2], f.ev[k][3]]); expect('a bar turn to where it already points', type, f, N, 'invalid'); }
  expect('casual log checked as competitive', type + '-comp', Object.assign(clone(L), { type: type + '-comp' }), N, 'invalid');

  // ── hand-written logs (review round 2) ──
  const mk = ev => ({ v: 1, rv: 1, type, a: 0, env: clone(L.env), ev });
  { // the rounds' timers and nothing else: no hearts were ever made
    const ev = []; let t = 0;
    for (let s = 0; s < 10; s++) { const R = T.roundSecs(s) * 1000; ev.push(['G', t, s, 440]); t += R + 5; ev.push(['W', t, R + 5]); t += 1600; }
    expect('rounds with no hearts at all (G, W only)', type, mk(ev), 10, 'invalid');
    const e2 = clone(ev); e2.splice(1, 0, ['K', 300, 1, 0]);
    expect('no hearts, one bar turn', type, mk(e2), 10, 'invalid');
  }
  { // the same, with a pause every 650 ms of game time so no strip ever starts
    const ev = []; let t = 0;
    for (let s = 0; s < 10; s++) {
      const R = T.roundSecs(s) * 1000; ev.push(['G', t, s, 440]);
      let g = 0; const t0 = t;
      while (g + 650 < R) { g += 650; t = Math.max(t + 1, t0 + g + 30); ev.push(['P', t, g]); t += 400; ev.push(['U', t]); }
      t += R - g + 5; ev.push(['W', t, R + 5]); t += 1600;
    }
    expect('no hearts: paused before every strip (hand-written)', type, mk(ev), 10);
  }
  { // targets reused: round 1 played again as rounds 6, 7 ...
    const f = clone(L); const g0 = idxOf('G'), w0 = idxOf('W');
    let t = f.ev[f.ev.length - 1][1] + 1700;
    for (let s = N; s < N + 4; s++) {
      const base0 = L.ev[g0][1];
      for (let i = g0; i <= w0; i++) { const e = clone(L.ev[i]); e[1] = t + (e[1] - base0); if (e[0] === 'G') e[2] = s; f.ev.push(e); }
      t = f.ev[f.ev.length - 1][1] + 1700;
    }
    expect('the first round\'s log reused as later rounds', type, f, N + 4, 'invalid');
  }
  // fields of the wrong type or size
  const kH = idxOf('H'), kK = idxOf('K'), kB = idxOf('B'), kW = idxOf('W');
  const badFields = [
    ['G rounds as a string', f => { f.ev[0][2] = '0'; }],
    ['G size 440.5', f => { f.ev[0][3] = 440.5; }],
    ['G size negative', f => { f.ev[0][3] = -440; }, true],
    ['H side as a boolean', f => { f.ev[kH][2] = true; }],
    ['H offset null', f => { f.ev[kH][3] = null; }],
    ['H game time as a string', f => { f.ev[kH][4] = String(f.ev[kH][4]); }],
    ['H game time negative', f => { f.ev[kH][4] = -100; f.ev[kH][5] = 0; }],
    ['H frame step negative', f => { f.ev[kH][5] = -16.7; }],
    ['H with an extra field', f => { f.ev[kH].push(1); }],
    ['K direction 1.5', f => { f.ev[kK][2] = 1.5; }],
    ['K direction 3', f => { f.ev[kK][2] = 3; }],
    ['K game time as "NaN"', f => { f.ev[kK][3] = 'NaN'; }],
    ['B heart id as a string', f => { f.ev[kB][2] = String(f.ev[kB][2]); }],
    ['B heart id -1', f => { f.ev[kB][2] = -1; }],
    ['B for heart 1e9', f => { f.ev[kB][2] = 1e9; }],
    ['W game time 1e12', f => { f.ev[kW][2] = 1e12; }],
    ['W game time as a string', f => { f.ev[kW][2] = String(f.ev[kW][2]); }],
    ['a negative wall time', f => { f.ev[kH][1] = -5; }],
    ['wall times all 0', f => { f.ev.forEach(e => { e[1] = 0; }); }],
    ['unknown event code', f => { f.ev.splice(kH, 0, ['ZZZ', f.ev[kH][1]]); }],
    ['a pause with a string game time', f => { f.ev.splice(kK + 1, 0, ['P', f.ev[kK][1], 'x']); }],
    ['E with a number for its reason', f => { f.ev.push(['E', f.ev[f.ev.length - 1][1], 5]); f.ev.push(['G', f.ev[f.ev.length - 1][1] + 2000, N, 440]); }],
    ['an event after E', f => { const t = f.ev[f.ev.length - 1][1]; f.ev.push(['E', t, 'reset'], ['K', t + 1, f.ev[kK][2] === 0 ? 1 : 0, 0]); }],
    ['E dead with lives left', f => { f.ev.push(['E', f.ev[f.ev.length - 1][1], 'dead']); }],
    ['a W logged twice', f => { f.ev.splice(kW + 1, 0, clone(f.ev[kW])); }],
    ['a G logged twice', f => { f.ev.splice(1, 0, clone(f.ev[0])); }],
    ['a heart blocked twice', f => { f.ev.splice(kB + 1, 0, clone(f.ev[kB])); }],
    ['a heart made twice (same id reused)', f => { f.ev.splice(kH + 1, 0, clone(f.ev[kH])); }],
    ['round numbers skip (G 0, then G 2)', f => { const k = idxOf('G', 1); f.ev[k][2] = 2; }],
    ['resume without a pause', f => { f.ev.splice(kK + 1, 0, ['U', f.ev[kK][1]]); }],
  ];
  for (const [name, mut, soft] of badFields) { const f = clone(L); mut(f); expect(name, type, f, N, soft ? undefined : 'invalid'); }
  { // padded to the event cap with no-op resizes, to make the log look cut
    const f = clone(L); const k = idxOf('W');
    const pad = []; for (let i = f.ev.length; i < Q.LIMITS.MAX_EVENTS; i++) pad.push(['Z', f.ev[k][1], f.ev[0][3]]);
    f.ev.splice(k + 1, 0, ...pad);
    expect('padded to the event cap, claim 50', type, f, 50);
  }

  // Bots and cheat clients, played through the real trainer.
  function botRun(name, seed, tweak, o2) {
    const rng = mkRng(seed);
    const player = humanParams(rng, 1); player.maxRounds = 8; player.fidget = false; player.lapse = 0; player.home = -1;
    Object.assign(player, tweak);
    const res = simulate(Object.assign({ seed, comp: false, player, wrapW: 464, hz: 60, dropP: 0.02, stallP: 0, lateP: 0.02, ping: 0, maxMs: 600000 }, o2 || {}));
    const last = res.submits[res.submits.length - 1];
    if (!last) { fail(name + ': the bot scored nothing'); return; }
    expect(name + ' (' + last.score + ' rounds)', last.type, last.log, last.score, 'review');
  }
  botRun('perfect bot: every turn mid-window, no error', 61001, { fixed: 'mid', after: 0 });
  botRun('perfect bot at 144 Hz', 61002, { fixed: 'mid', after: 0 }, { hz: 144 });
  botRun('metronome bot: every turn 60 ms before contact', 61003, { fixed: 'lead', lead: 60, after: 0 });
  botRun('metronome bot at 144 Hz', 61010, { fixed: 'lead', lead: 60, after: 0 }, { hz: 144 });
  botRun('metronome bot at 30 Hz', 61011, { fixed: 'lead', lead: 60, after: 0 }, { hz: 30 });
  botRun('fixed-delay bot: every turn 60 ms after it sees the previous block', 61005, { fixed: 'block', after: 60 });
  botRun('superhuman reactions (~40 ms)', 61006, { fixed: 'asap', rtMed: 40, rtSig: 0.2, sdT: 10, after: 80, afterSd: 15 });
  // cheat client: side draws rigged towards repeats (no turn needed)
  function rigged(pRepeat) {
    return rr => {
      let last = 0, calls = 0;
      return () => {
        calls++;
        const st = new Error().stack.split('\n')[2] || '';
        if (/gameLoop/.test(st)) {   // the side draw
          if (rr() < pRepeat) return (last + rr()) / 3;
          last = Math.floor(rr() * 3); return (last + rr()) / 3;
        }
        return rr();
      };
    };
  }
  botRun('cherry-picked sides: 75% repeats (a human plays it)', 61007, { fixed: null }, { randFor: rigged(0.75) });
  botRun('cherry-picked sides: always the same side', 61008, { fixed: null }, { randFor: rigged(1) });
  botRun('rigged offset draws (all dead centre)', 61009, { fixed: null }, { randFor: rr => () => { const st = new Error().stack.split('\n')[2] || ''; return /spawnHeart/.test(st) ? 0.5 : rr(); } });

  // The real page, played with tricks it allows.
  botRun('slow motion: the page held at 5 fps (a human plays it)', 61012, { fixed: null, pace: 0.25 }, { hz: 5, dropP: 0, maxMs: 2400000 });
  botRun('slow motion: the page held at 6 fps (a human plays it)', 61013, { fixed: null, pace: 0.3 }, { hz: 6, dropP: 0, maxMs: 2400000 });
  {
    const rng = mkRng(61014);
    const player = humanParams(rng, 0.5); player.maxRounds = 99; player.fidget = false;
    const res = simulate({ seed: 61014, comp: false, player, wrapW: 464, hz: 60, dropP: 0.02, stallP: 0, lateP: 0.02, ping: 0, spamPause: 450, maxMs: 240000 });
    const last = res.submits[res.submits.length - 1];
    if (!last || last.score < 3) fail('pause trick: the page did not give free rounds (' + (last && last.score) + ')');
    else expect('pause trick through the real page: paused every 450 ms (' + last.score + ' rounds, no hearts)', last.type, last.log, last.score);
  }

  const bad = out.filter(x => /^valid/.test(x.verdict)).length;
  console.log(`forgeries: ${out.length} tried, ${out.length - bad} refused or held`);
  for (const x of out) console.log('    ' + x.name + ' -> ' + x.verdict);
  return out;
}

// ── c) the IIFE parses, and the rules file is self-contained ────────────────
try { new Function(IIFE_SRC); console.log('parse: thorian.iife.js ok'); } catch (e) { fail('thorian.iife.js does not parse: ' + e.message); }

// ── a2) a run longer than the log can hold ─────────────────────────────────
// The run keeps logging until the event cap, then stops; every later submit
// sends the cut log. It must still check out, scoring the rounds it shows.
function capSuite() {
  const keep = Q.LIMITS.MAX_EVENTS;
  Q.LIMITS.MAX_EVENTS = 700;
  let n = 0, cutSeen = 0;
  try {
    for (let s = 0; s < 6; s++) {
      const rng = mkRng(70000 + s);
      const player = humanParams(rng, 1); player.maxRounds = 20; player.lapse = 0;
      const res = simulate({ seed: 70000 + s, comp: s % 2 === 1, player, wrapW: 464, hz: 60, dropP: 0.02, stallP: 0, lateP: 0.02, ping: 0 });
      for (const sub of res.submits) {
        n++;
        const r = checkLog(sub.type, sub.log, sub.score);
        const shown = sub.log.ev.filter(e => e[0] === 'W').length;
        if (sub.log.ev.length >= Q.LIMITS.MAX_EVENTS) cutSeen++;
        if (r.verdict !== 'valid' || r.score !== Math.min(sub.score, shown)) fail('cut log: ' + r.verdict + ' ' + r.score + ' (claimed ' + sub.score + ', shown ' + shown + ') ' + JSON.stringify(r.reasons));
      }
    }
  } finally { Q.LIMITS.MAX_EVENTS = keep; }
  if (!cutSeen) fail('cut log: no submit reached the cap');
  console.log(`event cap: ${n} submits of runs cut at 700 events (${cutSeen} cut) all valid, scored as far as the log shows`);
}
capSuite();

// ── a3) starting again quickly ─────────────────────────────────────────────
// (1) Die, flick to another tab and back, Start again inside the 1.9 s
//     game-over pause: the old pause's timer must not switch the new run's
//     keys off or show Start over it.
// (2) Start pressed while a run's loop is still queued (matchmaking clicks
//     Start itself): one loop only, so a round is never won twice in a frame.
function restartSuite() {
  let n = 0;
  for (let s = 0; s < 40; s++) {
    const quick = s % 2 === 0;
    const rng = mkRng(80000 + s);
    const player = humanParams(rng, 0.4); player.maxRounds = 99; player.fidget = false;
    for (const k in LS) delete LS[k];
    const o = { seed: 80000 + s, comp: s % 4 < 2, player, wrapW: 464, hz: pick(rng, [60, 144, 30]), dropP: 0.03, stallP: 0, lateP: 0.03, ping: 0 };
    const W = new World(o);
    const ag = new Agent(W, player, mkRng(s * 31 + 9));
    W.agent = ag;
    let restarts = 0, runs = 0, keysOff = 0;
    W.onEnd = e => {
      if (!quick) {
        if (runs >= 2 && e[2] !== 'restart') W.done = true;
        else if (s % 4 === 3 && e[2] === 'dead') W.at(W.now + 2500, () => { W.clickStart(); runs++; });   // died before a win
        return;
      }
      if (restarts >= 1 || e[2] !== 'dead') { if (e[2] !== 'restart') W.done = true; return; }
      restarts++;
      W.at(W.now + 150 + rng() * 600, () => {
        W.win._onThorianQteHide(); W.win._onThorianQteShow(); W.clickStart(); runs++;
        W.at(W.now + 2500, () => { if (W.els['thorian-qte-start-btn'].style.display !== 'none') keysOff++; });
      });
    };
    W.at(W.now + 50, () => { W.clickStart(); runs++; ag.tick(); });
    // mid-run: at a random moment, or just after a round is won (in the 1.6 s gap)
    if (!quick && s % 4 === 1) W.at(W.now + 1000 + rng() * 6000, () => { W.clickStart(); runs++; });
    if (!quick && s % 4 === 3) W.onWin = () => { if (runs < 2) W.at(W.now + 100 + rng() * 1300, () => { W.clickStart(); runs++; }); };
    W.runUntil(W.now + 3.6e6);
    CUR = null;
    if (keysOff) fail('quick restart: Start shown over the new run');
    const byRun = new Map();
    for (const sub of W.submits) byRun.set(sub.log, sub);
    for (const sub of W.submits) {
      n++;
      const r = checkLog(sub.type, sub.log, sub.score);
      const wins = sub.log.ev.filter(e => e[0] === 'W').length;
      if (r.verdict !== 'valid' || r.score !== sub.score || wins !== sub.score) fail('restart (' + (quick ? 'quick' : 'mid-run') + ' seed ' + o.seed + '): ' + r.verdict + ' ' + r.score + '/' + sub.score + ' W=' + wins + ' ' + JSON.stringify(r.reasons));
    }
    if (runs < 2) fail('restart: the second Start never came (seed ' + o.seed + ')');
  }
  console.log(`restarts: ${n} submits from 40 runs started again (quick after a death / mid-run) all valid`);
}
restartSuite();

// ── a4) pauses at every kind of moment ─────────────────────────────────────
// A pause right after a frame, every 0.3-3 s of play, sometimes resized while
// away: over many runs this lands on every scheduler state (a strip's first
// frame, its last heart, the round's first frame, the frame a round is won).
// Nothing may be rejected or held; the score may only stop early when the
// pauses held the hearts off too often in one round.
function pauseStress() {
  let n = 0, stopped = 0, pauses = 0;
  for (let s = 0; s < 120; s++) {
    const rng = mkRng(90000 + s);
    const player = humanParams(rng, 0.9); player.maxRounds = 6 + Math.floor(rng() * 8); player.fidget = rng() < 0.3;
    for (const k in LS) delete LS[k];
    const o = { seed: 90000 + s, comp: s % 2 === 0, mobile: s % 5 === 0, player, wrapW: 464, hz: pick(rng, [60, 144, 30, 12]), dropP: 0.03, stallP: 0.002, lateP: 0.05,
      ping: s % 3 === 0 ? 150 : 0, clamp: s % 7 === 0 ? 100 : 0 };
    const W = new World(o);
    const ag = new Agent(W, player, mkRng(s * 17 + 3));
    W.agent = ag;
    const hop = () => {
      if (W.done) return;
      // right after the next frame: hook the agent's per-frame tick once
      const tick0 = ag.tick.bind(ag);
      ag.tick = function () {
        tick0(); ag.tick = tick0;
        if (W.done) return;
        W.win._onThorianQteHide(); pauses++;
        W.at(W.now + 20 + rng() * 400, () => {
          if (rng() < 0.15) W.wrap.clientWidth = pick(rng, [464, 420, 380]);
          W.win._onThorianQteShow(); W.clickResume();
          ag.gen++; ag.planned = ag.bar;
          for (const h of ag.hs) if (!h.res) { h.seen = false; h.cW += 400; }
          ag.next = 0; while (ag.next < ag.hs.length && ag.hs[ag.next].res) ag.next++;
          const gen = ag.gen;
          for (const h of ag.hs) if (!h.res) W.at(W.now + lognormal(rng, player.rtMed, player.rtSig), () => { if (gen !== ag.gen) return; h.seen = true; ag.plan(); });
          W.at(W.now + 300 + rng() * 2700, hop);
        });
      };
    };
    W.at(W.now + 50, () => { W.clickStart(); ag.tick(); });
    W.at(W.now + 50 + rng() * 2000, hop);
    W.runUntil(W.now + 3.6e6);
    CUR = null;
    for (const sub of W.submits) {
      n++;
      const r = checkLog(sub.type, sub.log, sub.score);
      if (r.stats.stoppedCounting) stopped++;
      if (r.verdict !== 'valid' || (r.score !== sub.score && !r.stats.stoppedCounting)) {
        fail('pause stress seed ' + o.seed + ': ' + r.verdict + ' ' + r.score + '/' + sub.score + ' ' + JSON.stringify(r.reasons));
        const m = /event (\d+)/.exec(r.reasons[0] || ''); if (m) console.log('   ', JSON.stringify(sub.log.ev.slice(Math.max(0, +m[1] - 10), +m[1] + 2)));
      }
    }
  }
  console.log(`pause stress: ${pauses} pauses right after a frame, ${n} submits: none rejected or held (${stopped} stopped counting: pauses held the hearts off)`);
}
pauseStress();

const H = honestSuite();
const F = forgerySuite();
void H; void F;
if (failures) { console.log(failures + ' failure(s)'); process.exit(1); }
console.log('all thorian tests passed');
