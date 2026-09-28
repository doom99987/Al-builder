// hammer-new: honest simulation + forgeries + the real IIFE against QteRules.check.
// node hammer-new.test.js [runs]
//   a) honest players, simulated through the IIFE's state machine frame by
//      frame (30-240 Hz, main-thread stalls, stale rAF stamps, coarse clocks,
//      ping, pauses, focus loss, mobile): 0 invalid, review <= ~0.1%;
//   b) forgeries: invented clears, edited holds / zones / draws, time
//      compressed, inputs between frames, replays, malformed values, envelope
//      abuse, and page bots: refused (invalid) or held (review);
//   c) the REAL IIFE (hammer-new.iife.js, cut out of js/qte.js by _paths.js)
//      in a stub DOM with a virtual clock, played from its own log: every
//      submit and every final log checks out.
// Exit 1 on any failure.
'use strict';
require('./_paths.js');
const path = require('path');
const Q = require(path.join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const R = Q.trainers['hammer-new'];
if (!R || typeof R.check !== 'function') { console.log('FAIL hammer-new rules did not register'); process.exit(1); }

let failures = 0;
function fail(msg) { failures++; console.log('FAIL ' + msg); }
const T0 = Date.now();

// ── seeded randomness ──
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(+(process.env.HN_SEED || 20260928));
const U = (a, b) => a + (b - a) * rng();
function N(m, s) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
function wpick(pairs) { let x = rng(), s = 0; for (const [v, w] of pairs) { s += w; if (x < s) return v; } return pairs[pairs.length - 1][0]; }
const r4 = (x) => typeof x === 'number' ? Math.round(x * 10000) / 10000 : x;
const clone = (x) => JSON.parse(JSON.stringify(x));
function checkLog(type, log, claimed) { return Q.check(type, log, { platform: 'C', claimed }); }

// A coarse clock (privacy settings: Firefox resistFingerprinting / Tor clamp
// performance.now() and rAF stamps to 16.67 or 100 ms; 1 ms is common), with a
// jittered rounding point per step (still monotone).
function quantizer(q) {
  if (!q) return (x) => x;
  const mid = (k) => { const s = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
  return (x) => { const k = Math.floor(x / q); return (x - k * q) < mid(k) * q ? k * q : (k + 1) * q; };
}
// Main-thread stalls: sorted [start, end) spans, looked up by binary search.
function makeStalls(from, to, rate, sizes) {
  const out = [];
  let x = from;
  while (x < to) { x += -Math.log(1 - rng()) * 1000 / Math.max(rate, 1e-6); const d = wpick(sizes); out.push([x, x + d]); x += d; }
  return (at) => {
    let lo = 0, hi = out.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (out[m][1] <= at) lo = m + 1; else if (out[m][0] > at) hi = m - 1; else return out[m]; }
    return null;
  };
}

// ── a) the simulator: the IIFE's state machine, frame by frame, with a player ──
// o = { comp, hz, lagRate, ping, mobile, src, coarse, player, pauses:[[at,dur]], blurs:[[at,dur]], capMs, zoneU }
function simulate(o) {
  const P = o.player;
  const comp = !!o.comp, type = 'hammer-new' + (comp ? '-comp' : '');
  const PERF0 = 40000 + rng() * 100000;          // performance.now() at Run.start
  const qz = quantizer(o.coarse || 0), Q0 = qz(PERF0);
  const log = { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: 1280, h: 800, mob: !!o.mobile, ping: o.ping }, ev: [] };
  const snaps = [];
  let closed = false;
  function ev(at, code, ...f) {
    if (closed || log.ev.length >= Q.LIMITS.MAX_EVENTS) return;
    const e = [code, Math.max(0, Math.round(qz(at) - Q0))];
    for (const x of f) e.push(r4(x));
    log.ev.push(e);
  }
  const snapshot = () => ({ v: 1, rv: log.rv, type, a: 0, env: log.env, ev: log.ev.slice() });

  // frames: a vsync grid; a callback held by a stall runs after it with a stale stamp
  const FT = 1000 / o.hz, vs0 = PERF0 + rng() * FT;
  const cap = PERF0 + (o.capMs || 900000);
  const stall = makeStalls(PERF0, cap + 60000, o.lagRate, [[U(20, 60), 0.7], [U(60, 200), 0.25], [U(200, 600), 0.05]]);
  const afterStall = (x) => { const b = stall(x); return b ? b[1] + 0.2 : x; };
  function nextFrame(after, allowPrev) {
    let n = Math.floor((after - vs0) / FT) + 1, ts = vs0 + n * FT, cb = ts + U(0.2, 1.5);
    if (allowPrev && rng() < 0.3) { ts = vs0 + (n - 1) * FT; cb = after + U(0.1, 1); }
    for (let guard = 0; guard < 50; guard++) {
      const b = stall(cb);
      if (b) { ts = vs0 + Math.floor((b[1] - vs0) / FT) * FT; cb = b[1] + U(0.1, 1); continue; }
      break;
    }
    return { ts, cb };
  }

  // ── the game (mirrors hammer-new.iife.js) ──
  let running = true, paused = false, over = false, phase = 'idle', holding = false;
  let streak = 0, fill = 0, progress = 0, inZone = false, zMin = 0, zMax = 0, roundLen = 0;
  let gameT = 0, roundT = 0, wonT = 0, lastTime = 0, frame = null, lastFrameTs = PERF0;
  const zoneU = o.zoneU || (() => rng());
  function startRound(at) {
    const z = R.drawZone(streak, comp, zoneU(streak));
    zMin = z[0]; zMax = z[1];
    roundLen = R.timer(streak, comp);
    fill = 0; progress = 0; inZone = false; roundT = gameT; phase = 'play';
    ev(at, 'R', streak, zMin, zMax, gameT * 1000);
    onRound(at);
  }
  function setHold(at, on, src) {
    if (!running || paused || (phase !== 'play' && phase !== 'won')) return false;
    if (holding === on) return false;
    holding = on;
    ev(at, on ? 'D' : 'X', gameT * 1000, src);
    return true;
  }
  function runFrame(fr) {
    const now = qz(fr.ts);
    const dt = Math.min(Math.max(0, now - lastTime) / 1000, R.DT_MAX);
    if (now > lastTime) lastTime = now;
    const g0 = gameT;
    gameT += dt;
    lastFrameTs = fr.cb;
    if (phase === 'play' && dt > 0) {
      fill = R.move(fill, holding ? 1 : -1, dt);
      const inz = R.inZone(fill, zMin, zMax);
      if (inz !== inZone) { inZone = inz; ev(fr.cb, 'Z', g0 * 1000, gameT * 1000, inz ? 1 : 0); onZone(fr.cb, inz); }
      progress = R.progress(progress, inz, dt);
      if (progress >= 1) {
        progress = 1; phase = 'won'; wonT = gameT; streak++;
        ev(fr.cb, 'S', g0 * 1000, gameT * 1000);
        snaps.push({ claimed: streak, n: log.ev.length });
        onClear(fr.cb);
      } else if (gameT - roundT >= roundLen) {
        ev(fr.cb, 'E', 'time', g0 * 1000, gameT * 1000);
        phase = 'lost'; running = false; over = true; closed = true;
        return;
      }
    } else if (phase === 'won' && gameT - wonT >= R.GAP_MS / 1000) startRound(fr.cb);
    if (frameHook) frameHook(fr.cb);
  }

  // ── the player ──
  const acts = [];
  const add = (a) => { acts.push(a); };
  const lagKey = o.mobile ? 0 : o.ping;
  const src = o.mobile ? o.src : 'k';
  let gen = 0, keyDown = false, lastPhys = -1e9, lastHandler = -1e9, inFlight = 0, tapping = false, stopped = false, away = false;
  let frameHook = P.frameHook ? (cb) => P.frameHook(cb, api) : null;
  const react = () => P.reactMed * Math.exp(N(0, P.reactSdLog));
  const aim = () => Math.min(0.95, Math.max(0.05, P.a + N(0, P.tv)));
  // what the player sees: the last frame's fill, moving on at the bar's speed
  const fillNow = (x) => R.move(fill, holding ? 1 : -1, Math.max(0, x - lastFrameTs) / 1000);
  const api = { get fill() { return fill; }, get holding() { return holding; }, get zMin() { return zMin; }, get zMax() { return zMax; },
    get phase() { return phase; }, get keyDown() { return keyDown; }, get streak() { return streak; }, key: (at, down) => sendKey(at, down), rng };

  function sendKey(at, down) {
    keyDown = down; lastPhys = at; inFlight++;
    let h = at + (lagKey ? lagKey + wpick([[U(0, 4), 0.95], [U(4, 60), 0.05]]) : 0);
    h = Math.max(afterStall(h), lastHandler + 0.05); lastHandler = h;
    add({ at: h, kind: 'key', down });
  }
  function tapDur(x, holdSeg) {
    const c = (zMin + zMax) / 2, hw = (zMax - zMin) / 2, err = Math.max(-1.5, Math.min(1.5, (c - fillNow(x)) / hw));
    const base = P.period / 2;
    let d = base * (1 + (holdSeg ? 1 : -1) * P.kappa * err);
    d = Math.min(Math.max(d, P.minSeg), 2.5 * base);
    d += N(0, Math.sqrt(P.sig0 * P.sig0 + (P.cv * d) * (P.cv * d)));
    // a hand's fastest tap is not one fixed duration either
    return d >= P.minSeg * 0.8 ? d : P.minSeg * 0.8 + Math.abs(N(0, P.sig0));
  }
  function replan(now) {
    gen++;
    if (over || !running || paused || stopped || away || inFlight > 0 || P.frameHook) return;
    if (phase === 'won') {
      if (P.pre && !keyDown) {
        const left = R.GAP_MS - (gameT - wonT) * 1000;
        add({ at: now + Math.max(0, left) + N(P.antAim, P.antSd) - P.pingComp * lagKey, kind: 'phys', down: true, gen });
      }
      return;
    }
    if (phase !== 'play') return;
    const c = (zMin + zMax) / 2, hw = (zMax - zMin) / 2, f = fillNow(now);
    const target = holding ? c + hw * aim() : c - hw * aim();
    const dist = holding ? target - f : f - target;
    let phys;
    if (dist <= 0) phys = now + 0.6 * react();
    else {
      const x = now + dist / R.RATE * 1000, dur = x - now;
      let sd = Math.sqrt(P.sigma * P.sigma + (P.weber * dur) * (P.weber * dur));
      if (rng() < P.lapse) sd *= 4;
      phys = x + P.bias + N(0, sd) - P.pingComp * lagKey;
    }
    if (phys < lastPhys + P.minSeg) phys = lastPhys + P.minSeg + Math.abs(N(0, 6));   // as fast as the hand goes, give or take
    if (phys < now + 1) phys = now + 20 + Math.abs(N(0, 40));                          // already late (a big input delay): act, not on a clock
    add({ at: phys, kind: 'phys', down: !holding, gen });
  }
  function onRound(at) {
    tapping = false;
    if (stopped || away || P.frameHook) return;
    gen++;
    if (inFlight > 0) return;                    // a press made in the gap is on its way
    if (holding) replan(at);
    else add({ at: at + react() + (keyDown ? 150 : 0), kind: 'phys', down: true, gen });
  }
  function onClear(at) {
    tapping = false; gen++;
    if (P.frameHook) return;
    if (streak >= P.cap) { stopped = true; if (keyDown) add({ at: at + U(100, 400), kind: 'phys', down: false, gen }); return; }
    P.pre = rng() < P.preP;
    if (P.pre) {
      if (!keyDown) add({ at: at + R.GAP_MS + N(P.antAim, P.antSd) - P.pingComp * lagKey, kind: 'phys', down: true, gen });
    } else if (keyDown) add({ at: at + U(100, 400), kind: 'phys', down: false, gen });
  }
  function onZone(cb, inz) {
    if (inz || tapping || stopped || P.frameHook) return;
    add({ at: cb + P.reactOut, kind: 'check', gen });   // the fill left the zone: correct it if no toggle is coming
  }

  for (const [a, d] of o.pauses || []) { add({ at: PERF0 + a, kind: 'pause' }); if (isFinite(d)) add({ at: PERF0 + a + d, kind: 'resume' }); }
  for (const [a, d] of o.blurs || []) add({ at: PERF0 + a, kind: 'blur', dur: d });

  // Start
  const start = PERF0 + U(0.2, 3);
  lastTime = qz(start); phase = 'play';
  startRound(PERF0 + U(0.05, 0.2));
  frame = nextFrame(start, true);

  let guard = 0;
  while (!over && guard++ < 5e6) {
    let ai = -1, ta = Infinity;
    for (let i = 0; i < acts.length; i++) if (acts[i].at < ta) { ta = acts[i].at; ai = i; }
    const tf = (running && frame) ? frame.cb : Infinity;
    if (tf === Infinity && ta === Infinity) break;
    if (Math.min(tf, ta) > cap) break;
    if (tf <= ta) {
      runFrame(frame);
      if (!over) frame = nextFrame(frame.cb, false);
      continue;
    }
    const a = acts.splice(ai, 1)[0];
    if (a.kind === 'key') {
      inFlight--;
      const ok = setHold(a.at, a.down, src);
      if (P.frameHook) continue;
      if (ok && P.tap && !tapping && phase === 'play' && !a.down && inZone) {
        tapping = true;                           // from now on this round: open-loop taps
        add({ at: lastPhys + tapDur(a.at, false), kind: 'phys', down: true, gen, tap: true });
        continue;
      }
      if (tapping) continue;
      if (ok || (inFlight === 0 && keyDown !== holding)) replan(a.at + 1);
      continue;
    }
    if (a.kind === 'phys') {
      if (a.gen !== gen || stopped && a.down || away) continue;
      if (keyDown === a.down) { sendKey(a.at, !a.down); a.at += U(60, 110); }   // the game missed a change: lift / press again
      sendKey(a.at, a.down);
      if (a.tap && tapping && !stopped) add({ at: a.at + tapDur(a.at, a.down), kind: 'phys', down: !a.down, gen, tap: true });
      continue;
    }
    if (a.kind === 'check') {
      if (a.gen !== gen || phase !== 'play' || paused || away || inFlight > 0) continue;
      if ((holding && fill > zMax) || (!holding && fill < zMin)) { gen++; add({ at: a.at, kind: 'phys', down: !holding, gen }); }
      continue;
    }
    if (a.kind === 'replan') { if (a.gen === gen) replan(a.at); continue; }
    if (a.kind === 'pause') {
      if (running && !over) {
        running = false; paused = true; holding = false; frame = null;
        ev(a.at, 'P', gameT * 1000);
        gen++; tapping = false;
        if (keyDown) { keyDown = false; }
      }
      continue;
    }
    if (a.kind === 'resume') {
      if (paused) {
        paused = false; running = true;
        ev(a.at, 'U');
        lastTime = qz(a.at); frame = nextFrame(a.at, true);
        gen++; tapping = false;
        add({ at: a.at + react() + 150, kind: 'replan', gen });
      }
      continue;
    }
    if (a.kind === 'blur') {
      if (running && !over) {
        if (holding) setHold(a.at, false, 'w');
        gen++; tapping = false; keyDown = false; away = true;
        add({ at: a.at + a.dur, kind: 'back' });
      }
      continue;
    }
    if (a.kind === 'back') { away = false; gen++; add({ at: a.at + react(), kind: 'replan', gen }); continue; }
  }
  const snapLogs = snaps.map(s => ({ claimed: s.claimed, log: { v: 1, rv: log.rv, type, a: 0, env: log.env, ev: log.ev.slice(0, s.n) } }));
  return { log, snaps: snapLogs, score: streak, type, over };
}

// ── players ──
const TIERS = {
  new:   { sigma: [45, 90], weber: [0.02, 0.05],  a: [0.3, 0.85], tv: [0.2, 0.45], lapse: [0.02, 0.05],  react: [260, 340], pre: [0, 0.2],    minSeg: [70, 110], cap: [2, 40] },
  mid:   { sigma: [28, 50], weber: [0.015, 0.04], a: [0.3, 0.8],  tv: [0.15, 0.4], lapse: [0.01, 0.03],  react: [230, 300], pre: [0.1, 0.5],  minSeg: [60, 100], cap: [3, 80] },
  good:  { sigma: [16, 30], weber: [0.01, 0.03],  a: [0.3, 0.75], tv: [0.1, 0.35], lapse: [0.005, 0.02], react: [210, 280], pre: [0.3, 0.8],  minSeg: [55, 90],  cap: [5, 150] },
  top:   { sigma: [9, 18],  weber: [0.008, 0.02], a: [0.25, 0.7], tv: [0.08, 0.3], lapse: [0.003, 0.01], react: [190, 260], pre: [0.6, 1],    minSeg: [50, 80],  cap: [10, 300] },
  // beyond the best players seen in rhythm games: 5-10 ms timing SD, turn points held to 5-20 % of the zone
  elite: { sigma: [5, 10],  weber: [0.005, 0.015], a: [0.2, 0.65], tv: [0.05, 0.2], lapse: [0.001, 0.005], react: [180, 240], pre: [0.8, 1], minSeg: [45, 70],  cap: [20, 500] },
};
function human(skill, ping) {
  const S = TIERS[skill];
  const tap = rng() < (ping >= 150 ? 0.5 : 0.2);   // with a big input delay, tapping in a rhythm is the way to play
  return {
    skill, sigma: U(...S.sigma), weber: U(...S.weber), a: U(...S.a), tv: U(...S.tv), lapse: U(...S.lapse),
    reactMed: U(...S.react), reactSdLog: U(0.12, 0.3), reactOut: U(170, 300), preP: U(...S.pre), antAim: U(-250, 60), antSd: U(20, 80),
    minSeg: U(...S.minSeg), bias: N(0, 8), pingComp: U(0.3, 1), cap: Math.floor(U(...S.cap)),
    // tapping style: hold / let-go in a rhythm (period ms), steering the fill with the duty cycle.
    // Motor timing: SD = sqrt(sig0^2 + (cv * duration)^2), sig0 >= 4 ms even for the best.
    tap, period: U(110, 240), kappa: U(0.3, 0.9), sig0: U(4, 10), cv: U(0.03, 0.08),
  };
}
function honestOpts(skill) {
  skill = skill || process.env.HN_SKILL || wpick([['new', 0.2], ['mid', 0.3], ['good', 0.25], ['top', 0.2], ['elite', 0.05]]);
  const mobile = rng() < 0.2;
  const ping = mobile ? 0 : pick([0, 0, 0, 150, 300]);
  const o = {
    comp: rng() < 0.5, hz: wpick([[60, 0.5], [120, 0.12], [144, 0.18], [240, 0.06], [30, 0.07], [75, 0.05], [20, 0.02]]),
    lagRate: wpick([[0.05, 0.4], [0.3, 0.4], [1.5, 0.2]]), ping, mobile, src: pick(['t', 'b']),
    coarse: wpick([[0, 0.85], [1, 0.05], [16.67, 0.06], [100, 0.04]]),
    player: human(skill, ping), pauses: [], blurs: [], skill,
  };
  if (rng() < 0.15) { const n = rng() < 0.3 ? 2 : 1; for (let i = 0; i < n; i++) o.pauses.push([U(300, 60000), rng() < 0.03 ? Infinity : U(250, 30000)]); o.pauses.sort((a, b) => a[0] - b[0]); }
  for (let k = 1; k < o.pauses.length; k++) o.pauses[k][0] = Math.max(o.pauses[k][0], o.pauses[k - 1][0] + o.pauses[k - 1][1] + 400);
  if (rng() < 0.03) o.blurs.push([U(1000, 60000), U(300, 3000)]);
  if (rng() < 0.1) o.capMs = U(2000, 20000);          // short runs: the tab is closed early
  return o;
}

// ── a) honest ──
const RUNS = +process.argv[2] || 2400;
function honestBatch(n, optsFn, label) {
  let inv = 0, rev = 0, mism = 0, logs = 0, maxEv = 0, maxBytes = 0, top = 0, sum = 0;
  const reasons = {}, bySkill = {};
  const near = { segSd: 1e9, fastShare: 0, turnSd: 1e9, turnFrames: 1e9, zonesP: 1, gamePerWall: 1e9 };
  for (let k = 0; k < n; k++) {
    const o = optsFn();
    const s = simulate(o);
    maxEv = Math.max(maxEv, s.log.ev.length); top = Math.max(top, s.score); sum += s.score;
    const checks = s.snaps.length <= 30 ? s.snaps.slice() : s.snaps.filter((x, j) => j % Math.ceil(s.snaps.length / 30) === 0);
    checks.push({ log: s.log, claimed: s.score });
    let ri = false, rr = false;
    for (const x of checks) {
      logs++;
      const r = checkLog(s.type, x.log, x.claimed);
      if (r.verdict === 'invalid') { ri = true; if (inv < 5) console.log('  ' + label + ' invalid', r.reasons, JSON.stringify(o.player), o.hz, o.ping, o.coarse); }
      if (r.verdict === 'review') { rr = true; for (const w of r.reasons) { const key = w.replace(/[\d.]+(e-?\d+)?/g, '#'); reasons[key] = (reasons[key] || 0) + 1; } }
      if (r.verdict !== 'invalid' && r.score !== x.claimed) { mism++; if (mism < 5) console.log('  ' + label + ' mismatch', r.score, x.claimed, r.reasons); }
    }
    const rf = checkLog(s.type, s.log, s.score), st = rf.stats;
    if (rf.verdict !== 'invalid') {
      if (st.segDf >= R.H.SEG_MIN) {
        near.segSd = Math.min(near.segSd, st.segSdMs);
        if (st.segSdMedMs !== undefined && st.segSdMedMs < (near.segSdMed === undefined ? 1e9 : near.segSdMed)) {
          near.segSdMed = st.segSdMedMs;
          if (process.env.HN_NEAR) console.log('  [near] segSdMed', st.segSdMedMs, 'coarse', o.coarse, 'hz', o.hz, 'ping', o.ping, 'mobile', o.mobile, 'lag', o.lagRate, JSON.stringify(o.player));
        }
        if (!st.coarseClock) {
          if (st.fastShare > near.fastShare && process.env.HN_NEAR) console.log('  [near] fastShare', st.fastShare, JSON.stringify(st), JSON.stringify(o));
          near.fastShare = Math.max(near.fastShare, st.fastShare);
        }
      }
      if (st.turnDf >= R.H.TURN_MIN) { near.turnSd = Math.min(near.turnSd, st.turnSdMs); if (st.frameMs <= R.H.LATTICE_FRAME_MS) near.turnFrames = Math.min(near.turnFrames, st.turnFrames); }
      if (st.zonesP !== undefined) near.zonesP = Math.min(near.zonesP, +st.zonesP);
      const lastT = s.log.ev.length ? s.log.ev[s.log.ev.length - 1][1] : 0;
      if (st.gamePerWall !== undefined && lastT >= 60000 && o.coarse !== 100) near.gamePerWall = Math.min(near.gamePerWall, st.gamePerWall);
    }
    maxBytes = Math.max(maxBytes, JSON.stringify(s.log).length);
    if (ri) inv++;
    if (rr) rev++;
    const b = bySkill[o.skill] = bySkill[o.skill] || { n: 0, sum: 0, max: 0 };
    b.n++; b.sum += s.score; b.max = Math.max(b.max, s.score);
  }
  console.log(`${label}: ${n} runs (${logs} logs checked), invalid ${inv}, review ${rev} (${(100 * rev / n).toFixed(2)}%), score mismatch ${mism}, ` +
    `mean score ${(sum / n).toFixed(1)}, top ${top}, max events ${maxEv}, max log ${(maxBytes / 1024).toFixed(0)} KB; ` +
    Object.entries(bySkill).map(([k, v]) => `${k} avg ${(v.sum / v.n).toFixed(1)} max ${v.max}`).join(', '));
  if (Object.keys(reasons).length) console.log('  review reasons:', reasons);
  console.log('  closest honest approach: ' + JSON.stringify(near, (k, v) => typeof v === 'number' ? +v.toPrecision(3) : v));
  return { inv, rev, mism, n, maxBytes, maxEv };
}
{
  const a = honestBatch(RUNS, () => honestOpts(), 'honest');
  if (a.inv) fail('honest runs invalid: ' + a.inv);
  if (a.mism) fail('honest score mismatches: ' + a.mism);
  if (a.rev / a.n > 0.0015) fail('honest review rate ' + (a.rev / a.n));
  if (a.maxBytes > 900000) fail('an honest log is ' + a.maxBytes + ' bytes (MAX_BYTES 1 MB with the envelope)');
}
// a2) the best players, long runs, pause-heavy
{
  const b = honestBatch(Math.max(200, RUNS >> 3), () => {
    const o = honestOpts(wpick([['top', 0.5], ['elite', 0.5]]));
    o.capMs = 0; o.player.cap = 1e9;
    return o;
  }, 'honest, top/elite, uncapped');
  if (b.inv) fail('top/elite honest runs invalid: ' + b.inv);
  if (b.mism) fail('top/elite honest score mismatches: ' + b.mism);
  if (b.rev / b.n > 0.005) fail('top/elite honest review rate ' + (b.rev / b.n));
  const c = honestBatch(Math.max(150, RUNS >> 4), () => {
    const o = honestOpts(wpick([['good', 0.3], ['top', 0.4], ['elite', 0.3]]));
    o.capMs = 0; o.pauses = []; const np = 4 + Math.floor(rng() * 9);
    for (let k = 0; k < np; k++) o.pauses.push([U(300, 90000), wpick([[U(250, 600), 0.4], [U(600, 5000), 0.5], [U(5000, 60000), 0.1]])]);
    o.pauses.sort((x, y) => x[0] - y[0]);
    for (let k = 1; k < o.pauses.length; k++) o.pauses[k][0] = Math.max(o.pauses[k][0], o.pauses[k - 1][0] + o.pauses[k - 1][1] + 400);
    return o;
  }, 'honest, pause-heavy');
  if (c.inv) fail('pause-heavy honest runs invalid: ' + c.inv);
  if (c.mism) fail('pause-heavy honest score mismatches: ' + c.mism);
  if (c.rev / c.n > 0.005) fail('pause-heavy honest review rate ' + (c.rev / c.n));
}

// A round played frame-exactly (60 Hz unless o.dt) from a hold / let-go
// schedule [[game ms, +1 | -1], ...], logged the way the IIFE logs it, wall
// time t = t0 + (g - g0) + lag. It ends by the rules (S / E), or, with
// o.clearAt, by a forged S on the first frame ending at or after that game ms.
function playFrames(ev, o) {
  const dtMs = o.dt || 1000 / 60, a = o.a, b = o.b, t0 = o.t0 === undefined ? o.g0 : o.t0;
  const T = (g) => Math.round(t0 + (g - o.g0) + (o.lag || 0));
  let g = o.g0, f = 0, p = 0, inz = false, dir = o.held ? 1 : -1;
  const sched = o.sched.slice();
  if (o.logR !== false) ev.push(['R', T(g), o.k, a, b, r4(g)]);
  for (let n = 0; n < 5000; n++) {
    while (sched.length && sched[0][0] <= g + 1e-9) { const s = sched.shift(); if (s[1] !== dir) { dir = s[1]; ev.push([dir > 0 ? 'D' : 'X', T(g) + 3, r4(g), 'k']); } }
    const g0 = g; g += dtMs;
    f = R.move(f, dir, dtMs / 1000);
    const z = R.inZone(f, a, b);
    if (z !== inz) { inz = z; ev.push(['Z', T(g), r4(g0), r4(g), z ? 1 : 0]); }
    p = R.progress(p, z, dtMs / 1000);
    if (o.clearAt !== undefined) { if (g >= o.clearAt) { ev.push(['S', T(g), r4(g0), r4(g)]); return { g, won: true, dir, p }; } continue; }
    if (p >= 1) { ev.push(['S', T(g), r4(g0), r4(g)]); return { g, won: true, dir, p }; }
    if (g - o.g0 >= o.T) { ev.push(['E', T(g), 'time', r4(g0), r4(g)]); return { g, won: false, dir, p }; }
  }
  throw new Error('round never ended');
}
// A schedule that presses at g0 + pressAt, lets go at the zone's centre, then taps 75 / 75 ms to hover.
function hoverSched(g0, a, b, pressAt, until) {
  const c = (a + b) / 2, rel = g0 + pressAt + c / R.RATE * 1000;
  const s = [[g0 + pressAt, 1], [rel, -1]];
  for (let x = rel + 40; x < until; x += 150) s.push([x, 1], [x + 75, -1]);
  return s;
}

// ── a3) honest edge cases the simulator reaches only rarely ──
{
  const W0 = R.width(0, false), T0ms = R.timer(0, false) * 1000;
  const L = (ev, type) => ({ v: 1, rv: 1, type: type || 'hammer-new', a: 0, env: { w: 1280, h: 800, mob: false, ping: 0 }, ev });
  const edge = [];
  { // hover a wide zone: press, let go in it, then small taps
    const ev = []; const a = 0.5, b = r4(a + W0);
    const res = playFrames(ev, { g0: 0, k: 0, a, b, T: T0ms, lag: 5, sched: hoverSched(0, a, b, 0, 7000) });
    if (!res.won) fail('edge setup: the hover round was not won');
    edge.push(['plain round, hover by tapping', L(ev), 1, 1]);
  }
  { // Space held through the clear and the 700 ms wait: the next round's fill rises from its first frame
    const ev = []; const a = 0.45, b = r4(a + W0), F = 1000 / 60;
    const r1 = playFrames(ev, { g0: 0, k: 0, a, b, T: T0ms, lag: 5, sched: hoverSched(0, a, b, 0, 7000) });
    if (r1.dir < 0) { const gp = r1.g + 12 * F; ev.push(['D', Math.round(gp + 5) + 3, r4(gp), 'k']); }   // pressed during the wait
    const g = r1.g + 42 * F;                                                                           // the wait: 42 frames = 700 ms
    const a2 = 0.3, b2 = r4(a2 + R.width(1, false));
    const s2 = hoverSched(g, a2, b2, 0, g + 7000); s2.shift();                                          // already held: no press
    const r2 = playFrames(ev, { g0: g, k: 1, a: a2, b: b2, T: R.timer(1, false) * 1000, lag: 5, held: true, sched: s2 });
    if (!r1.won || !r2.won) fail('edge setup: the held-through rounds were not won');
    edge.push(['Space held through the wait', L(ev), 2, 2]);
  }
  { // the fill pinned at the top (1.0), then let down into the zone
    const ev = []; const a = 0.55, b = r4(a + W0);
    const sched = [[0, 1], [2600, -1]]; for (let x = 3350; x < 7000; x += 150) sched.push([x, 1], [x + 75, -1]);
    const res = playFrames(ev, { g0: 0, k: 0, a, b, T: T0ms, lag: 5, sched });
    if (!res.won) fail('edge setup: the pinned-fill round was not won');
    edge.push(['fill held at the top, then down into the zone', L(ev), 1, 1]);
  }
  { // never pressed: a time-out with the fill at 0
    const ev = []; const res = playFrames(ev, { g0: 0, k: 0, a: 0.5, b: r4(0.5 + W0), T: T0ms, lag: 5, sched: [] });
    if (res.won) fail('edge: a round with no press was won');
    edge.push(['never pressed: time-out', L(ev), 0, 0]);
  }
  { // 100 ms privacy clock: every frame is a clamped 50 ms, every t a multiple of 100
    const ev = []; const a = 0.48, b = r4(a + W0);
    const sched = [[0, 1], [1200, -1]]; for (let x = 1300; x < 7000; x += 200) sched.push([x, 1], [x + 100, -1]);
    const res = playFrames(ev, { g0: 0, k: 0, a, b, T: T0ms, lag: 0, dt: 50, sched });
    for (const e of ev) e[1] = Math.ceil(e[1] * 2 / 100) * 100;     // the wall runs twice as long as the game
    if (!res.won) fail('edge setup: the privacy-clock round was not won');
    edge.push(['100 ms privacy clock (half speed)', L(ev), 1, 1]);
  }
  { // every draw clearable with margin: the highest zone start reached at RATE, plus FILL_S in the
    // zone, fits in the round timer less 0.5 s, for every streak 0-60 in both modes
    let worst = Infinity, at = '';
    for (const comp of [false, true]) for (let k = 0; k <= 60; k++) {
      const w = R.width(k, comp), zTop = R.drawZone(k, comp, 1 - 1e-12)[0];   // u -> 1: the highest zone start drawn
      const zMax = Math.max(zTop, Math.min(R.C_MAX - w / 2, R.EDGE_HI - w));
      const need = zMax / R.RATE + R.FILL_S, slack = R.timer(k, comp) - 0.5 - need;
      if (slack < worst) { worst = slack; at = (comp ? 'comp' : 'casual') + ' k ' + k; }
      if (slack < 0) fail(`${comp ? 'comp' : 'casual'} streak ${k}: the highest zone (start ${zMax.toFixed(4)}) needs ${need.toFixed(3)} s, timer ${R.timer(k, comp)} s less 0.5 s`);
    }
    console.log(`  every draw clearable: least slack beyond the 0.5 s margin ${worst.toFixed(3)} s (${at})`);
  }
  { // paused mid-round while holding (P drops the hold), resumed, pressed again
    const ev = []; const a = 0.5;
    ev.push(['R', 1, 0, a, r4(a + W0), 0], ['D', 300, 300, 'k'], ['P', 700, 690, ], ['U', 5000]);
    // 690 game ms held: fill 0.3243; after the pause it falls from there
    ev.push(['D', 5400, 1090, 'k']);   // fell 400 ms to 0.1363, rises again
    edge.push(['pause while holding, resume, press again', L(ev), 0, 0]);
  }
  { // a very long casual run (each round held from its first frame, hovered with taps) that run.ev cut
    // at MAX_EVENTS: the trainer plays on and claims more than the log shows
    const ev = []; let g = 0, k = 0, held = false; const F = 1000 / 60;
    while (ev.length < Q.LIMITS.MAX_EVENTS) {
      const z = R.drawZone(k, false, rng()), c = (z[0] + z[1]) / 2;
      let won = null;
      for (let tries = 0; tries < 50 && !won; tries++) {
        const tmp = [], rel = g + c / R.RATE * 1000 + N(0, 10), s = [[g, 1], [rel, -1]];
        for (let x = rel + 40; x < g + 8000; x += 150 + N(0, 8)) { const hd = 75 + N(0, 6); s.push([x, 1], [x + hd, -1]); }
        const res = playFrames(tmp, { g0: g, t0: g + 5, k, a: z[0], b: z[1], T: R.timer(k, false) * 1000, held, sched: s });
        if (res.won) { won = res; for (const e of tmp) ev.push(e); }
      }
      if (!won) { fail('edge setup: the long run lost a round'); break; }
      k++; held = won.dir > 0; g = won.g + 42 * F;
    }
    const full = ev.length, shown = ev.slice(0, Q.LIMITS.MAX_EVENTS).filter(e => e[0] === 'S').length;
    ev.length = Math.min(ev.length, Q.LIMITS.MAX_EVENTS);
    const bytes = JSON.stringify(L(ev)).length;
    if (bytes > 0.95 * Q.LIMITS.MAX_BYTES) fail('a log at MAX_EVENTS is ' + bytes + ' bytes, too close to MAX_BYTES');
    edge.push([`log cut at MAX_EVENTS (${shown} clears shown of ${k}, ${full} events, ${(bytes / 1024).toFixed(0)} KB)`, L(ev), k + 3, shown]);
  }
  let bad = 0;
  for (const [name, log, claimed, want] of edge) {
    const r = checkLog(log.type, log, claimed);
    if (r.verdict !== 'valid' || r.score !== want) { bad++; fail(`edge "${name}" -> ${r.verdict} ${r.score}/${want} ${r.reasons.join('; ')}`); }
  }
  console.log(`edge: ${edge.length} honest edge cases, ${bad} failed`);
}

// ── b) forgeries ──
// Own seed: the forgeries must not depend on how many honest runs came before.
rng = mulberry32(424242);
const results = [];
function expect(name, type, log, claimed, want) {
  // want: 'invalid' | 'review' | undefined = invalid, review, or a score at most half the claim
  const r = checkLog(type, log, claimed);
  const caught = r.verdict === 'invalid' || r.verdict === 'review' || r.score <= claimed / 2;
  const ok = want === 'invalid' ? r.verdict === 'invalid' : want === 'review' ? r.verdict !== 'valid' : caught;
  results.push({ name, verdict: r.verdict, score: r.score, claimed, why: r.reasons[0] || '' });
  if (process.env.HN_DEBUG && name.indexOf(process.env.HN_DEBUG) >= 0) console.log('  [debug]', name, r.reasons, JSON.stringify(r.stats));
  if (!ok) fail(`forgery "${name}" -> ${r.verdict} (score ${r.score}, claimed ${claimed}) ${r.reasons.join('; ')}`);
  return r;
}
// A long honest run to cut forgeries from: a strong player at 60 Hz, no ping,
// whose fill left the zone at least once mid-round.
function longHonest(comp) {
  for (let i = 0; i < 600; i++) {
    const o = honestOpts('elite'); o.comp = comp; o.ping = 0; o.mobile = false; o.pauses = []; o.blurs = []; o.capMs = 0; o.hz = 60; o.lagRate = 0.05; o.coarse = 0;
    o.player = human('elite', 0); o.player.tap = false; o.player.cap = comp ? 14 : 30;
    const s = simulate(o);
    const r = checkLog(s.type, s.log, s.score);
    const exc = s.log.ev.some((e, j) => e[0] === 'Z' && e[4] === 0 && s.log.ev.slice(j + 1, j + 30).some(x => x[0] === 'Z' && x[4] === 1));
    if (s.score >= (comp ? 12 : 25) && r.verdict === 'valid' && exc) return s;
  }
  throw new Error('no long honest run');
}
const HL = longHonest(false), HC = longHonest(true);
console.log(`  base logs: casual ${HL.score} pts / ${HL.log.ev.length} ev, comp ${HC.score} pts / ${HC.log.ev.length} ev`);
const at = (log, code, nth, from) => { let n = 0; for (let i = from || 0; i < log.ev.length; i++) if (log.ev[i][0] === code && n++ === nth) return i; return -1; };

// 1 invented points
{ const l = clone(HL.log); l.ev = []; expect('no events + claim', HL.type, l, 30, 'invalid'); }
expect('claim above the logged points', HL.type, HL.log, HL.score + 5, 'invalid');
expect('replayed log with a higher claim', HL.type, clone(HL.log), HL.score * 2, 'invalid');
{ const sn = HL.snaps.find(x => x.claimed === 10); expect('replayed 10-point log, claim 30', HL.type, clone(sn.log), 30, 'invalid'); }
{ // the failing round turned into a clear at its last frame
  const l = clone(HL.log); const e = l.ev[l.ev.length - 1]; l.ev[l.ev.length - 1] = ['S', e[1], e[3], e[4]];
  expect('time-out rewritten as a clear', HL.type, l, HL.score + 1, 'invalid');
}
// The log up to and including its nth round start, and whether Space was held there.
function cutAtRound(log, nth) {
  const i = at(log, 'R', nth), ev = clone(log.ev.slice(0, i + 1));
  return { ev, R: ev[i], held: readLog(ev).dir > 0 };
}
{ // a round hovered in the zone for 1 s (2.3 s needed), then a clear
  const cut = cutAtRound(HL.log, 6); const [, t0, k, a, b, g0] = cut.R;
  const pressAt = cut.held ? 0 : 150, sched = hoverSched(g0, a, b, pressAt, g0 + 8000);
  if (cut.held) sched.shift();
  playFrames(cut.ev, { g0, t0, k, a, b, lag: 0, held: cut.held, sched, logR: false, clearAt: g0 + pressAt + a / R.RATE * 1000 + 1000 });
  expect('clear after 1 s in the zone (2.3 s needed)', HL.type, Object.assign(clone(HL.log), { ev: cut.ev }), k + 1, 'invalid');
}
{ // a round that waits, enters 1.5 s before its timer, and hovers on to a clear 1.5 s past it
  const cut = cutAtRound(HL.log, 8); const [, t0, k, a, b, g0] = cut.R, Tms = R.timer(k, false) * 1000;
  const sched = [[g0, -1]].concat(hoverSched(g0, a, b, Tms - 1500, g0 + Tms + 4000));
  playFrames(cut.ev, { g0, t0, k, a, b, lag: 0, held: cut.held, sched, logR: false, clearAt: g0 + Tms + 1500 });
  expect('clear 1.5 s past the round timer', HL.type, Object.assign(clone(HL.log), { ev: cut.ev }), k + 1, 'invalid');
}
{ // an excursion out of the zone deleted (Z out ... Z in removed): the fill leaves with no Z
  const l = clone(HL.log);
  const i = l.ev.findIndex((e, j) => e[0] === 'Z' && e[4] === 0 && l.ev.slice(j + 1, j + 30).some(x => x[0] === 'Z' && x[4] === 1));
  const j = l.ev.findIndex((e, q) => q > i && e[0] === 'Z' && e[4] === 1);
  l.ev.splice(j, 1); l.ev.splice(i, 1);
  expect('excursion out of the zone deleted', HL.type, l, HL.score, 'invalid');
}
{ // a Z out logged 150 ms late (more in-zone time)
  const l = clone(HL.log); const i = l.ev.findIndex((e, j) => j > 20 && e[0] === 'Z' && e[4] === 0);
  const e = l.ev[i]; e[2] = r4(e[2] + 150); e[3] = r4(e[3] + 150);
  expect('zone exit logged 150 ms late', HL.type, l, HL.score, 'invalid');
}
{ // a Z in logged 150 ms early
  const l = clone(HL.log); const i = l.ev.findIndex((e, j) => j > 20 && e[0] === 'Z' && e[4] === 1);
  const e = l.ev[i]; e[2] = r4(e[2] - 150); e[3] = r4(e[3] - 150);
  expect('zone entry logged 150 ms early', HL.type, l, HL.score, 'invalid');
}
{ // a release near the zone's top and the press after it deleted (the holds edited): the fill would have gone on up and out
  const l = clone(HL.log);
  const i = l.ev.findIndex((e, j) => {
    if (j < 30 || e[0] !== 'X' || !l.ev[j + 1] || l.ev[j + 1][0] !== 'D') return false;
    const s = readLog(l.ev.slice(0, j + 1));    // still held, the fill would pass the top before that press
    return s.phase === 'play' && s.f <= s.b && s.f + R.RATE * (l.ev[j + 1][2] - e[2]) / 1000 > s.b + 0.005;
  });
  if (i < 0) fail('forgery setup: no release near the zone top');
  l.ev.splice(i, 2);
  expect('a release near the top and its press deleted', HL.type, l, HL.score, 'invalid');
}
{ // a round's approach press moved 150 ms later: its fill reaches the zone later than its Z says
  const l = clone(HL.log); const i = l.ev.findIndex((e, j) => j > 10 && e[0] === 'D' && l.ev[j - 1][0] === 'R' && l.ev[j + 1][0] === 'Z' && l.ev[j + 1][2] - e[2] > 300);
  l.ev[i][1] += 150; l.ev[i][2] = r4(l.ev[i][2] + 150);
  expect('approach press moved 150 ms later', HL.type, l, HL.score, 'invalid');
}
{ // every Z out and its Z in dropped across the run (a fill that never leaves)
  const l = clone(HL.log); l.ev = l.ev.filter((e, j) => !(e[0] === 'Z' && (e[4] === 0 || l.ev.slice(0, j).reverse().find(x => x[0] === 'Z' || x[0] === 'R')[0] === 'Z')));
  expect('all excursions dropped', HL.type, l, HL.score, 'invalid');
}
// 2 edited draws
{ const l = clone(HL.log); const i = at(l, 'R', 6); l.ev[i][3] = r4(l.ev[i][3] - 0.03); expect('zone wider than its streak allows', HL.type, l, HL.score, 'invalid'); }
{ const l = clone(HL.log); const i = at(l, 'R', 6); const w = l.ev[i][4] - l.ev[i][3]; l.ev[i][3] = r4(0.9 - w / 2); l.ev[i][4] = r4(0.9 + w / 2); expect('zone centre outside [0.40, 0.80]', HL.type, l, HL.score, 'invalid'); }
{ const l = clone(HL.log); const i = at(l, 'R', 6); l.ev[i][2] += 3; expect('round streak does not match the clears', HL.type, l, HL.score, 'invalid'); }
expect('casual log submitted as comp', 'hammer-new-comp', Object.assign(clone(HL.log), { type: 'hammer-new-comp' }), HL.score, 'invalid');
expect('comp log submitted as casual', 'hammer-new', Object.assign(clone(HC.log), { type: 'hammer-new' }), HC.score, 'invalid');
{ // cherry-picked easy zones, played by a strong human
  let s = null;
  for (let i = 0; i < 200 && !s; i++) {
    const o = honestOpts('top'); o.comp = false; o.ping = 0; o.pauses = []; o.blurs = []; o.capMs = 0; o.player.cap = 60;
    o.zoneU = () => rng() * 0.12;
    const x = simulate(o); if (x.score >= 25) s = x;
  }
  expect(`cherry-picked zone centres (0.40-0.45), ${s.score} pts`, s.type, s.log, s.score, 'review');
}
// 3 time
{ const l = clone(HL.log); for (const e of l.ev) e[1] = Math.round(e[1] * 0.5); expect('times scaled x0.5', HL.type, l, HL.score, 'invalid'); }
{ const l = clone(HL.log); for (const e of l.ev) e[1] = Math.round(e[1] * 0.8); expect('times scaled x0.8', HL.type, l, HL.score); }
{ // game clock x1.5 (every g field)
  const l = clone(HL.log);
  for (const e of l.ev) { if (e[0] === 'R') e[5] = r4(e[5] * 1.5); else if (e[0] === 'D' || e[0] === 'X' || e[0] === 'P') e[2] = r4(e[2] * 1.5); else if (e[0] === 'Z' || e[0] === 'S') { e[2] = r4(e[2] * 1.5); e[3] = r4(e[3] * 1.5); } else if (e[0] === 'E') { e[3] = r4(e[3] * 1.5); e[4] = r4(e[4] * 1.5); } }
  expect('game clock x1.5', HL.type, l, HL.score, 'invalid');
}
{ // next round 300 game ms after the clear (and the rest shifted)
  const l = clone(HL.log); const i = at(l, 'R', 5); const sh = 400;
  for (let j = i; j < l.ev.length; j++) { const e = l.ev[j]; e[1] -= sh; if (e[0] === 'R') e[5] = r4(e[5] - sh); else if (e[0] === 'D' || e[0] === 'X' || e[0] === 'P') e[2] = r4(e[2] - sh); else if (e[0] === 'Z' || e[0] === 'S') { e[2] = r4(e[2] - sh); e[3] = r4(e[3] - sh); } else if (e[0] === 'E') { e[3] = r4(e[3] - sh); e[4] = r4(e[4] - sh); } }
  expect('next round 300 ms after the clear', HL.type, l, HL.score, 'invalid');
}
// 4 inputs between frames and frame shapes
{ // a release logged inside the frame of the Z before it
  const l = clone(HL.log); const i = l.ev.findIndex((e, j) => j > 20 && e[0] === 'Z' && l.ev[j + 1] && l.ev[j + 1][0] === 'X');
  l.ev[i + 1][2] = r4((l.ev[i][2] + l.ev[i][3]) / 2);
  expect('input between frames (inside the Z frame before it)', HL.type, l, HL.score, 'invalid');
}
{ const l = clone(HL.log); const i = l.ev.findIndex((e, j) => j > 20 && e[0] === 'Z'); l.ev[i][2] = r4(l.ev[i][3] - 80); expect('a Z frame of 80 ms (dt is clamped to 50)', HL.type, l, HL.score, 'invalid'); }
{ const l = clone(HL.log); const i = l.ev.findIndex((e, j) => j > 20 && e[0] === 'Z'); l.ev[i][2] = l.ev[i][3]; expect('a Z frame of 0 ms', HL.type, l, HL.score, 'invalid'); }
{ const l = clone(HL.log); const i = l.ev.findIndex((e, j) => j > 20 && e[0] === 'Z'); l.ev.splice(i + 1, 0, ['Z', l.ev[i][1], l.ev[i][2], l.ev[i][3], 1 - l.ev[i][4]]); expect('two zone changes in one frame', HL.type, l, HL.score, 'invalid'); }
{ const l = clone(HL.log); const i = l.ev.findIndex((e, j) => j > 20 && e[0] === 'Z'); l.ev.splice(i + 1, 0, ['Z', l.ev[i][1] + 30, r4(l.ev[i][3] + 30), r4(l.ev[i][3] + 46), l.ev[i][4]]); expect('a zone change to the state it was in', HL.type, l, HL.score, 'invalid'); }
{ const l = clone(HL.log); const i = l.ev.findIndex((e, j) => j > 20 && e[0] === 'D'); l.ev[i][2] = r4(l.ev[i][2] - 5000); expect('game clock goes back', HL.type, l, HL.score, 'invalid'); }
// 5 order
{ const l = clone(HL.log); const i = l.ev.findIndex((e, j) => j > 20 && e[0] === 'D'); l.ev.splice(i, 0, ['P', l.ev[i][1], l.ev[i][2]]); l.ev.splice(i + 2, 0, ['U', l.ev[i + 1][1]]); expect('press while paused', HL.type, l, HL.score, 'invalid'); }
{ const l = clone(HL.log); const i = l.ev.findIndex((e, j) => j > 20 && e[0] === 'D'); l.ev.splice(i, 0, ['U', l.ev[i][1]]); expect('resume without a pause', HL.type, l, HL.score, 'invalid'); }
{ const l = clone(HL.log); const last = l.ev[l.ev.length - 1]; l.ev.push(['D', last[1] + 200, r4(last[4] + 200), 'k']); expect('press after the end', HL.type, l, HL.score, 'invalid'); }
{ const l = clone(HL.log); const last = l.ev[l.ev.length - 1]; l.ev.push(['R', last[1] + 800, HL.score, 0.5, r4(0.5 + R.width(HL.score, false)), r4(last[4] + 700)]); expect('a round after the end', HL.type, l, HL.score, 'invalid'); }
{ const l = clone(HL.log); const i = l.ev.findIndex((e, j) => j > 20 && e[0] === 'D'); l.ev.splice(i + 1, 0, l.ev[i].slice()); expect('duplicate press', HL.type, l, HL.score, 'invalid'); }
{ const l = clone(HL.log); const i = at(l, 'S', 3); l.ev.splice(i + 1, 0, l.ev[i].slice()); expect('duplicate clear', HL.type, l, HL.score + 1, 'invalid'); }
{ const l = clone(HL.log); l.ev.unshift(['P', 0, 0]); expect('pause before Start', HL.type, l, HL.score, 'invalid'); }
{ const l = clone(HL.log); l.ev[0][1] = 5000; expect('Start round 5 s after Start', HL.type, l, HL.score, 'invalid'); }
// 6 malformed values
{
  const mut = (name, fn) => { const l = clone(HL.log); fn(l); expect(name, HL.type, l, HL.score, 'invalid'); };
  mut('g as a string', (l) => { const i = at(l, 'D', 5); l.ev[i][2] = String(l.ev[i][2]); });
  mut('g as "NaN"', (l) => { l.ev[at(l, 'X', 5)][2] = 'NaN'; });
  mut('g null', (l) => { l.ev[at(l, 'X', 5)][2] = null; });
  mut('g 1e300', (l) => { l.ev[at(l, 'X', 5)][2] = 1e300; });
  mut('streak 1e9', (l) => { l.ev[at(l, 'R', 5)][2] = 1e9; });
  mut('fractional streak', (l) => { l.ev[at(l, 'R', 5)][2] += 0.5; });
  mut('zone as strings', (l) => { const i = at(l, 'R', 5); l.ev[i][3] = String(l.ev[i][3]); });
  mut('unknown input source', (l) => { l.ev[at(l, 'D', 5)][3] = 'z'; });
  mut('focus-loss source on a press', (l) => { l.ev[at(l, 'D', 5)][3] = 'w'; });
  mut('zone state 2', (l) => { l.ev[at(l, 'Z', 5)][4] = 2; });
  mut('zone state true', (l) => { l.ev[at(l, 'Z', 5)][4] = true; });
  mut('an extra field', (l) => { l.ev[at(l, 'X', 5)].push(1); });
  mut('a missing field', (l) => { l.ev[at(l, 'S', 2)].length = 3; });
  mut('end reason not "time"', (l) => { l.ev[l.ev.length - 1][2] = 'hit'; });
  mut('lower-case code', (l) => { l.ev[at(l, 'X', 5)][0] = 'x'; });
  mut('unknown code', (l) => { const i = at(l, 'X', 5); l.ev.splice(i, 0, ['Q', l.ev[i][1]]); });
  mut('negative time', (l) => { l.ev[0][1] = -5; });
  mut('time going back', (l) => { const i = at(l, 'X', 5); l.ev[i][1] = 1; });
  mut('zone below the track edge', (l) => { const i = at(l, 'R', 0); l.ev[i][3] = -0.1; l.ev[i][4] = r4(-0.1 + R.width(0, false)); });
}
// 7 envelope
{
  const env = (name, fn) => { const l = clone(HL.log); fn(l); expect('envelope: ' + name, HL.type, l, HL.score, 'invalid'); };
  env('log type is another trainer', (l) => { l.type = 'hammer'; });
  env('version 2', (l) => { l.v = 2; });
  env('env with 9 fields', (l) => { for (let k = 0; k < 9; k++) l.env['f' + k] = k; });
  env('a 40-char string field', (l) => { l.ev[at(l, 'D', 3)][3] = 'k'.repeat(40); });
  env('a 4-char event code', (l) => { l.ev[at(l, 'D', 3)][0] = 'DOWN'; });
  env('too many events', (l) => { const x = l.ev[l.ev.length - 1]; while (l.ev.length <= Q.LIMITS.MAX_EVENTS) l.ev.push(['U', x[1]]); });
  env('time past MAX_T', (l) => { l.ev[l.ev.length - 1][1] = Q.LIMITS.MAX_T + 1; });
  env('attempt -1', (l) => { l.a = -1; });
  env('an object field', (l) => { l.ev[at(l, 'D', 3)][3] = { k: 1 }; });
}
// 8 pause abuse: 0 ms P/U pairs cannot buy game time ahead of the wall
{
  const l = clone(HL.log); const out = []; let shift = 0;
  for (const e of l.ev) {
    const x = e.slice(); x[1] = Math.round(x[1] * 0.7) - shift; out.push(x);
    if (x[0] === 'X') { const g = x[2]; out.push(['P', x[1], g], ['U', x[1]]); }
  }
  l.ev = out;
  expect('compressed wall clock hidden behind 0 ms pauses', HL.type, l, HL.score);
}
// 9 page bots (the simulator's frame loop, a script reading the game state each frame)
function botOpts(comp, hz, hook, extra) {
  return Object.assign({ comp, hz, lagRate: 0.05, ping: 0, mobile: false, coarse: 0, pauses: [], blurs: [], capMs: 400000,
    player: { frameHook: hook, cap: 1e9 } }, extra || {});
}
// thresholds: release on the frame the fill passes centre + x, press on the one it passes centre - x
function thresholdBot(xFrac, delay) {
  return (cb, g) => {
    if (g.phase === 'won') { if (!g.keyDown && g.rng() < 0.02) g.key(cb + 1, true); return; }
    if (g.phase !== 'play') return;
    const c = (g.zMin + g.zMax) / 2, hw = (g.zMax - g.zMin) / 2;
    if (g.holding && g.keyDown && g.fill >= c + xFrac * hw) g.key(cb + (delay || 0.3), false);
    else if (!g.holding && !g.keyDown && g.fill <= c - xFrac * hw) g.key(cb + (delay || 0.3), true);
  };
}
for (const hz of [60, 144, 240]) {
  const s = simulate(botOpts(false, hz, thresholdBot(0.4)));
  expect(`threshold bot (${hz} Hz, ${s.score} pts)`, s.type, s.log, s.score, 'review');
}
{ const s = simulate(botOpts(true, 60, thresholdBot(0.25))); expect(`threshold bot (comp, 60 Hz, ${s.score} pts)`, s.type, s.log, s.score, 'review'); }
{ // a timer bot: from the frame the fill reaches the zone's centre, hold / let go every 90 ms (setTimeout jitter ~1 ms)
  let armed = false;
  const hook = (cb, g) => {
    if (g.phase === 'won') { armed = false; return; }
    if (g.phase !== 'play' || armed) return;
    if (!g.keyDown && !g.holding) { g.key(cb + 1, true); return; }
    if (g.holding && g.fill >= (g.zMin + g.zMax) / 2) {
      armed = true;
      for (let j = 0; j < 28; j++) g.key(cb + 1 + 90 * j + g.rng() * 1.2, j % 2 === 1);
    }
  };
  const s = simulate(botOpts(false, 144, hook));
  expect(`timer bot, 90 ms holds / let-gos (${s.score} pts)`, s.type, s.log, s.score, 'review');
}
{ // a frame flicker: toggles every frame once in the zone
  const hook = (cb, g) => {
    if (g.phase === 'won') { if (!g.keyDown && g.rng() < 0.02) g.key(cb + 1, true); return; }
    if (g.phase !== 'play') return;
    const c = (g.zMin + g.zMax) / 2;
    if (g.fill < c - 0.01) { if (!g.keyDown) g.key(cb + 0.5, true); }
    else g.key(cb + 0.5, !g.keyDown);
  };
  const s = simulate(botOpts(false, 60, hook));
  expect(`frame-flicker bot (${s.score} pts)`, s.type, s.log, s.score, 'review');
}
{ // slow motion: a human on a page throttled to 10 frames a second (every dt clamped: half speed)
  let s = null;
  for (let i = 0; i < 100 && !s; i++) { const o = honestOpts('good'); o.hz = 10; o.coarse = 0; o.capMs = 0; o.pauses = []; o.player.cap = 1e9; const x = simulate(o); if (x.log.ev[x.log.ev.length - 1][1] > 70000 && x.score >= 5) s = x; }
  expect(`page throttled to 10 fps (${s.score} pts over ${(s.log.ev[s.log.ev.length - 1][1] / 1000).toFixed(0)} s)`, s.type, s.log, s.score, 'review');
}

// informational: a script that toggles like a person is not caught by design
{
  let s = null;
  for (let i = 0; i < 50 && !s; i++) { const o = honestOpts('elite'); o.player.cap = 1e9; o.capMs = 300000; o.pauses = []; const x = simulate(o); if (x.score >= 30) s = x; }
  const r = checkLog(s.type, s.log, s.score);
  console.log(`  (info) human-like elite play, ${s.score} pts: ${r.verdict} - a script with this noise is indistinguishable from the log alone; the SQL record hold is the backstop`);
}

console.log(`forgeries: ${results.length} tried, ` + results.filter(x => x.verdict === 'invalid').length + ' invalid, ' +
  results.filter(x => x.verdict === 'review').length + ' review, ' + results.filter(x => x.verdict === 'valid').length + ' valid (score cut)');
for (const x of results) console.log(`  ${x.verdict.padEnd(7)} ${String(x.score).padStart(3)}/${String(x.claimed).padEnd(3)} ${x.name} :: ${x.why}`);

// ── c) the REAL IIFE (hammer-new.iife.js) in a stub DOM ──
// The simulator above is a re-implementation; this drives the shipped code:
// virtual clock, rAF with vsync stamps (sometimes from before the callback's
// frame, so before the Start / Resume stamp), main-thread stalls, the ping
// delay on keys, coarse (privacy) timers, touch on mobile (canvas and HOLD
// button), panel hide + Resume, the tab hidden, the QTE page left, the window
// losing focus mid-hold, and a second Start while a run is live (matchmaking).
// A player plays from the run's own log. Every submitted snapshot and every
// final log must check out.
const fs = require('fs'), vm = require('vm');
const SRC = {
  core: fs.readFileSync('@qte-scratch/wt2/js/qte-rules.js', 'utf8'),
  part: fs.readFileSync(path.join(__dirname, 'hammer-new.rules.js'), 'utf8'),
  iife: fs.readFileSync(path.join(__dirname, 'hammer-new.iife.js'), 'utf8'),
};
{
  const lines = SRC.iife.replace(/\n$/, '').split('\n');
  if (lines[0] !== JSON.parse(fs.readFileSync(path.join(__dirname, '_heads.json'), 'utf8'))['hammer-new']) fail('the IIFE does not start with its _heads.json line');
  if (lines[lines.length - 1] !== '})();' || lines.slice(0, -1).some(x => x === '})();')) fail('the IIFE does not end at its only "})();" line');
  try { new vm.Script(SRC.iife); console.log('iife: parses (' + lines.length + ' lines)'); } catch (e) { fail('hammer-new.iife.js does not parse: ' + e.message); }
}
// The state a player can read off the log: the zone, the direction, the fill
// at the latest logged game time, and a (wall, game) point to extrapolate from.
function readLog(ev) {
  const s = { phase: 'none', a: 0, b: 0, k: 0, dir: -1, g: 0, f: 0, sync: { t: 0, g: 0 }, over: false, paused: false, rounds: 0 };
  for (const e of ev) {
    const c = e[0];
    if (c === 'R') { s.phase = 'play'; s.k = e[2]; s.a = e[3]; s.b = e[4]; s.g = e[5]; s.f = 0; s.sync = { t: e[1], g: e[5] }; s.rounds++; }
    else if (c === 'D' || c === 'X') { if (s.phase === 'play') { s.f = R.move(s.f, s.dir, (e[2] - s.g) / 1000); s.g = e[2]; } s.dir = c === 'D' ? 1 : -1; s.sync = { t: e[1], g: e[2] }; }
    else if (c === 'Z') { s.f = R.move(s.f, s.dir, (e[3] - s.g) / 1000); s.g = e[3]; s.sync = { t: e[1], g: e[3] }; }
    else if (c === 'S') { s.phase = 'won'; s.sync = { t: e[1], g: e[3] }; }
    else if (c === 'E') s.over = true;
    else if (c === 'P') { if (s.phase === 'play') { s.f = R.move(s.f, s.dir, (e[2] - s.g) / 1000); s.g = e[2]; } s.dir = -1; s.paused = true; s.sync = { t: e[1], g: e[2] }; }
    else if (c === 'U') { s.paused = false; s.sync = { t: e[1], g: s.sync.g }; }
  }
  return s;
}
function fillAt(s, tNow) {
  const gNow = s.sync.g + Math.max(0, tNow - s.sync.t);
  return R.move(s.f, s.dir, Math.max(0, gNow - s.g) / 1000);
}
function realIife(o) {
  let clock = 5000 + rng() * 50000;                                  // true time, ms
  const coarse = o.coarse || 0;
  const perfNow = () => coarse ? Math.floor(clock / coarse) * coarse : clock;
  const rafQ = []; let rafId = 0;
  const els = {};
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  let pageActive = true;
  function el(id) {
    if (els[id]) return els[id];
    const x = els[id] = { id, style: {}, textContent: '', width: 0, height: 0, _l: {}, tagName: /btn/.test(id) ? 'BUTTON' : 'DIV',
      addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }, getContext: () => ctx2d, blur() {},
      parentElement: { clientWidth: o.width || 900 }, classList: { contains: () => (id === 'page-qte' ? pageActive : true), add() {}, remove() {} } };
    if (id === 'qte-panel-hammer-new') x.style.display = 'flex';
    return x;
  }
  const docL = {}, winL = {};
  const submits = [], finals = [];
  const doc = { getElementById: el, addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); }, activeElement: { tagName: 'BODY' }, hidden: false };
  const sb = {
    console, Math, JSON, Promise, Object, Array, Number, String, Set, Map, Error, isFinite, parseInt, Proxy,
    setTimeout: () => 0, clearTimeout: () => {},
    performance: { now: perfNow },
    document: doc,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (f) => { rafQ.push({ id: ++rafId, f }); return rafId; },
    cancelAnimationFrame: (id) => { const i = rafQ.findIndex(x => x.id === id); if (i >= 0) rafQ.splice(i, 1); },
    addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); },
    innerWidth: 1280, innerHeight: 800, IS_MOBILE: !!o.mobile,
    _qteCompMode: !!o.comp, _albPing: o.ping || 0,
    _sbStartQteRun: () => Promise.resolve(null),
    _sbSubmitScore: (type, score, packet) => { submits.push({ type, score, log: packet.log }); return Promise.resolve(true); },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(SRC.core, sb); vm.runInContext(SRC.part, sb); vm.runInContext(SRC.iife, sb);
  const QQ = sb.QteRules;
  const fire = (list, e) => { for (const f of (list || [])) f(e); };
  const click = (id) => fire(el(id)._l.click, {});
  const holdBtn = el('hammer-new-hold-btn');
  function input(down) {
    if (o.mobile) {
      const t = o.src === 'b' ? holdBtn : el('hammer-new-qte-canvas');
      fire(t._l[down ? 'touchstart' : 'touchend'], { preventDefault() {} });
    } else fire(docL[down ? 'keydown' : 'keyup'], { code: 'Space', repeat: false, preventDefault() {} });
  }

  // frames and stalls
  const FT = 1000 / o.hz; const vs0 = clock + rng() * FT;
  const stall = makeStalls(clock, clock + 3e6, o.lagRate, [[U(20, 60), 0.7], [U(60, 250), 0.25], [U(250, 700), 0.05]]);
  const later = (x) => { const s = stall(x); return s ? s[1] + 0.3 : x; };
  function nextFrame(after) {
    let n = Math.floor((after - vs0) / FT) + 1, ts = vs0 + n * FT, cb = ts + U(0.2, 1.5);
    const s = stall(cb); if (s) { ts = vs0 + Math.floor((s[1] - vs0) / FT) * FT; cb = s[1] + U(0.1, 1); }
    if (rng() < 0.2) ts -= U(0, FT);            // a stamp from before the callback's own frame
    return { ts, cb };
  }

  const acts = [];
  const add = (at, kind, x) => acts.push(Object.assign({ at, kind }, x || {}));
  click('hammer-new-qte-start-btn');
  let run = QQ.Run.current, frame = nextFrame(clock);
  let keyDown = false, lastHandler = -1e9, pending = 0, gen = 0, rounds = 0, blurredUntil = -1;
  const lag = o.mobile ? 0 : o.ping;
  if (o.restartAt) add(clock + o.restartAt, 'restart');
  for (const [a, d, how] of o.pauses || []) { add(clock + a, 'hide', { how }); add(clock + a + d, 'resume', { how }); }
  for (const [a, d] of o.blurs || []) add(clock + a, 'blur', { dur: d });
  const sigma = o.sigma, bias = N(0, 6), aimA = U(0.25, 0.7);
  add(clock + U(200, 350), 'plan', { gen });

  function physical(at, down) {
    keyDown = down; pending++;
    const h = Math.max(later(at + (lag ? lag + wpick([[U(0, 4), 0.95], [U(4, 60), 0.05]]) : 0)), lastHandler + 0.05);
    lastHandler = h;
    add(h, 'input', { down });
  }
  function plan() {
    if (pending > 0 || clock < blurredUntil) return;
    const s = readLog(run.log.ev);
    if (s.over || s.paused || run.closed) return;
    const tNow = clock - run.t0;
    if (s.phase === 'won') {                           // press near the next round's start, or wait for it
      if (!keyDown && rng() < 0.5) physical(clock + U(400, 800), true);
      else add(clock + U(150, 300), 'plan', { gen });
      return;
    }
    const newRound = s.rounds !== rounds; rounds = s.rounds;
    if (s.dir < 0 && keyDown) { physical(clock + U(20, 80), false); return; }   // the game dropped the hold (a pause): lift first
    const c = (s.a + s.b) / 2, hw = (s.b - s.a) / 2, f = fillAt(s, tNow);
    const target = s.dir > 0 ? c + hw * Math.max(0.05, Math.min(0.95, aimA + N(0, 0.15))) : c - hw * Math.max(0.05, Math.min(0.95, aimA + N(0, 0.15)));
    const dist = s.dir > 0 ? target - f : f - target;
    let at2 = dist > 0 ? clock + dist / R.RATE * 1000 + bias + N(0, sigma) - lag * 0.8 : clock + (newRound ? U(200, 300) : U(60, 150));
    at2 = Math.max(at2, clock + 1);
    physical(at2, s.dir < 0);
  }

  let guard = 0;
  const endAt = clock + (o.capMs || 300000);
  while (guard++ < 5e6) {
    let ai = -1, ta = Infinity;
    for (let i = 0; i < acts.length; i++) if (acts[i].at < ta) { ta = acts[i].at; ai = i; }
    const tf = rafQ.length ? frame.cb : Infinity;
    const tn = Math.min(ta, tf);
    if (tn === Infinity || tn > endAt) break;
    if (tf <= ta) {
      clock = frame.cb;
      const q = rafQ.splice(0);                 // callbacks queued before this frame
      const ts = coarse ? Math.floor(frame.ts / coarse) * coarse : frame.ts;
      const nBefore = run.log.ev.length;
      for (const x of q) x.f(ts);
      // a round started or ended in this frame: look again
      for (let j = nBefore; j < run.log.ev.length; j++) { const c = run.log.ev[j][0]; if (c === 'R' || c === 'S' || (c === 'Z' && run.log.ev[j][4] === 0)) { gen++; add(clock + U(150, 260), 'plan', { gen }); break; } }
      frame = nextFrame(clock);
      continue;
    }
    const a = acts.splice(ai, 1)[0];
    clock = a.at;
    if (a.kind === 'input') {
      pending--;
      if (clock < blurredUntil) continue;       // the window has no focus: the page never sees it
      input(a.down);
      gen++; add(clock + U(5, 25), 'plan', { gen });
      continue;
    }
    if (a.kind === 'plan') { if (a.gen === gen) plan(); continue; }
    if (a.kind === 'hide') {
      if (a.how === 'tab') { doc.hidden = true; fire(docL.visibilitychange, {}); }
      else if (a.how === 'page') pageActive = false;
      else sb._onHammerNewQteHide();
      continue;
    }
    if (a.kind === 'resume') {
      if (a.how === 'tab') { doc.hidden = false; fire(docL.visibilitychange, {}); }
      else if (a.how === 'page') pageActive = true;
      else sb._onHammerNewQteShow();
      click('hammer-new-qte-resume-btn');
      if (keyDown) physical(clock + U(20, 80), false);
      gen++; add(clock + U(250, 450), 'plan', { gen });
      continue;
    }
    if (a.kind === 'blur') { fire(winL.blur, {}); keyDown = false; blurredUntil = clock + a.dur; gen++; add(blurredUntil + U(150, 300), 'plan', { gen }); continue; }
    if (a.kind === 'restart') {                 // matchmaking-style Start while the run is live
      finals.push({ type: run.type, log: run.log });
      click('hammer-new-qte-start-btn'); run = QQ.Run.current; rounds = 0;
      if (keyDown) physical(clock + U(20, 80), false);
      gen++; add(clock + U(200, 400), 'plan', { gen });
      continue;
    }
  }
  finals.push({ type: run.type, log: run.log });
  return { submits, finals };
}
{
  const NR = Math.max(60, RUNS >> 4);
  let ri = 0, rr = 0, rm = 0, nsub = 0, top = 0, restarts = 0, np = 0, nend = 0, nw = 0, nmob = 0;
  for (let n = 0; n < NR; n++) {
    const mobile = rng() < 0.2;
    const o = {
      comp: rng() < 0.5, hz: pick([30, 60, 60, 120, 144, 240]), lagRate: pick([0.05, 0.3, 1.5]), mobile, src: pick(['t', 'b']),
      ping: mobile ? 0 : pick([0, 0, 150, 300]), sigma: pick([8, 15, 30, 50]),
      coarse: wpick([[0, 0.8], [1000 / 60, 0.1], [100, 0.1]]), pauses: [], blurs: [], width: pick([320, 700, 900]),
    };
    if (rng() < 0.4) {
      const k = 1 + Math.floor(rng() * 4);
      for (let j = 0; j < k; j++) o.pauses.push([U(200, 60000), U(250, 8000), pick(['panel', 'tab', 'page'])]);
      o.pauses.sort((x, y) => x[0] - y[0]);
      for (let j = 1; j < k; j++) o.pauses[j][0] = Math.max(o.pauses[j][0], o.pauses[j - 1][0] + o.pauses[j - 1][1] + 300);
    }
    if (rng() < 0.15) o.blurs.push([U(1000, 40000), U(200, 2000)]);
    if (rng() < 0.1) { o.restartAt = U(1000, 20000); restarts++; }
    if (mobile) nmob++;
    const out = realIife(o);
    const logs = out.submits.map(x => [x.type, x.log, x.score]);
    for (const f of out.finals) {
      np += f.log.ev.filter(e => e[0] === 'P').length; nw += f.log.ev.filter(e => e[0] === 'X' && e[3] === 'w').length;
      if (f.log.ev.some(e => e[0] === 'E')) nend++;
      logs.push([f.type, f.log, f.log.ev.filter(e => e[0] === 'S').length]);
    }
    let bi = false, br = false;
    for (const [ty, lg, cl] of logs) {
      const r = checkLog(ty, lg, cl);
      nsub++; top = Math.max(top, cl);
      if (r.verdict === 'invalid') { bi = true; if (ri < 3) console.log('  real IIFE invalid', r.reasons, JSON.stringify(o)); }
      if (r.verdict === 'review') { br = true; if (rr < 3) console.log('  real IIFE review', r.reasons, JSON.stringify(r.stats)); }
      if (r.verdict !== 'invalid' && r.score !== cl) { rm++; if (rm < 3) console.log('  real IIFE mismatch', r.score, cl, r.reasons, JSON.stringify(o)); }
    }
    if (bi) ri++; if (br) rr++;
  }
  console.log(`real IIFE: ${NR} runs (${nmob} mobile, ${restarts} with a Start mid-run, ${np} pauses, ${nw} focus losses mid-hold, ${nend} logs ended), ${nsub} logs checked, invalid ${ri}, review ${rr}, score mismatch ${rm}, top ${top}`);
  if (ri) fail('real IIFE honest runs invalid: ' + ri);
  if (rm) fail('real IIFE score mismatches: ' + rm);
  if (rr / NR > 0.005) fail('real IIFE review rate ' + rr / NR);
  if (top < 5) fail('real IIFE: the player never got going (top ' + top + ')');
  if (!np) fail('real IIFE: no pause was ever logged');
}

{ // loaded without js/qte-rules.js: the IIFE must stop quietly, not throw (a throw would end qte.js there)
  const el = () => ({ style: {}, addEventListener() {}, getContext: () => new Proxy({}, { get: () => () => {} }), parentElement: { clientWidth: 400 } });
  const sb = { console: { error() {} }, document: { getElementById: el, addEventListener() {} }, localStorage: { getItem: () => null }, addEventListener() {} };
  sb.window = sb; vm.createContext(sb);
  try { vm.runInContext(SRC.iife, sb); console.log('IIFE without qte-rules.js: stops quietly'); }
  catch (e) { fail('IIFE throws without qte-rules.js: ' + e.message); }
}

// ── d) the page bot (tools/qte/bots/hammer-new.bot.js) on the real IIFE ──
// tools/qte/harness.html needs a browser; this plays the same bot through a
// ctx like the harness's, on the stub DOM with a virtual clock (timers, rAF at
// a vsync grid, the ping delay on keys), and checks every submit it causes.
async function botRun(o) {
  let clock = 1000 + rng() * 5000;
  const rafQ = [], timers = [], els = {}, docL = {}, submits = [];
  let rafId = 0;
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  function el(id) {
    if (els[id]) return els[id];
    const x = els[id] = { id, style: {}, textContent: '', width: 0, height: 0, _l: {}, addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
      getContext: () => ctx2d, parentElement: { clientWidth: 900 }, classList: { contains: () => true, add() {}, remove() {} } };
    if (id === 'qte-panel-hammer-new') x.style.display = 'flex';
    return x;
  }
  const sb = {
    console, Math, JSON, Promise, Object, Array, Number, String, Set, Map, Error, isFinite, parseInt, Proxy,
    setTimeout: (f, ms) => { timers.push({ at: clock + (ms || 0), f }); return 0; }, clearTimeout: () => {},
    performance: { now: () => clock },
    document: { getElementById: el, addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); }, activeElement: { tagName: 'BODY' }, hidden: false },
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
  vm.runInContext(SRC.core, sb); vm.runInContext(SRC.part, sb); vm.runInContext(SRC.iife, sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'hammer-new.bot.js'), 'utf8'), sb);
  const fire = (list, e) => { for (const f of (list || [])) f(e); };
  const ctx = {
    comp: !!o.comp, target: o.target,
    byId: el,
    click: (x) => { if (x) fire(x._l.click, {}); },
    key: (k, code, kind) => {        // the ping simulator (core.js) delays both
      const go = (t) => fire(docL[t], { key: k, code, repeat: false, preventDefault() {} });
      const send = (t) => { if (o.ping) timers.push({ at: clock + o.ping + (rng() < 0.95 ? rng() * 4 : 4 + rng() * 40), f: () => go(t) }); else go(t); };
      if (kind === 'down' || kind === 'press') send('keydown');
      if (kind === 'up') send('keyup');
    },
    sleep: (ms) => new Promise(res => timers.push({ at: clock + Math.max(0, ms || 0) + rng() * 2, f: res })),
    until: async (fn, ms) => { const t0 = clock; while (clock - t0 < (ms || 10000)) { const v = fn(); if (v) return v; await ctx.sleep(8); } return null; },
    run: () => sb.QteRules && sb.QteRules.Run.current,
    human: (m, sd) => Math.max(0, N(m, sd)),
    log: () => {},
  };
  let result = null, error = null;
  sb.__qteBots['hammer-new'](ctx).then(r => { result = r; }, e => { error = e; });
  const tick = () => new Promise(r => setImmediate(r));
  const FT = 1000 / o.hz, vs0 = clock + rng() * FT, end = clock + 600000;
  while (!result && !error && clock < end) {
    await tick();
    let ti = -1, ta = Infinity;
    for (let i = 0; i < timers.length; i++) if (timers[i].at < ta) { ta = timers[i].at; ti = i; }
    const tf = rafQ.length ? vs0 + (Math.floor((clock - vs0) / FT) + 1) * FT + 0.5 : Infinity;
    if (tf === Infinity && ta === Infinity) break;
    if (tf <= ta) { clock = tf; const q = rafQ.splice(0); for (const x of q) x.f(tf - 0.5); continue; }
    clock = Math.max(clock, ta); timers.splice(ti, 1)[0].f();
  }
  await tick();
  return { result, error, submits, run: sb.QteRules.Run.current };
}
(async () => {
  let bad = 0, hit = 0, n = 0, pts = [];
  for (const [comp, ping, hz, target] of [[false, 0, 60, 5], [false, 150, 144, 8], [true, 0, 60, 5], [true, 300, 120, 5], [false, 0, 240, 12], [true, 0, 30, 6]]) {
    const out = await botRun({ comp, ping, hz, target });
    n++;
    if (out.error) { bad++; fail('bot threw: ' + (out.error && out.error.stack || out.error)); continue; }
    const p = out.result ? out.result.points : 0; pts.push(p);
    if (p >= target) hit++;
    for (const s of out.submits) {
      const r = checkLog(s.type, s.log, s.score);
      if (r.verdict === 'invalid' || r.score !== s.score) { bad++; fail(`bot submit ${s.type} ${s.score} -> ${r.verdict} ${r.score} ${r.reasons.join('; ')}`); }
      else if (r.verdict === 'review') { bad++; fail(`bot submit held for review: ${r.reasons.join('; ')}`); }
    }
    const rf = checkLog(out.run.type, out.run.log, 0);
    if (rf.verdict !== 'valid') { bad++; fail(`bot final log ${rf.verdict} ${rf.reasons.join('; ')}`); }
  }
  console.log(`page bot on the real IIFE: ${n} runs, points ${pts.join(', ')} (${hit} reached the target), bad ${bad}`);
  if (hit < n / 2) fail('the page bot reached its target in only ' + hit + ' of ' + n + ' runs');

  console.log(`${((Date.now() - T0) / 1000).toFixed(1)} s`);
  console.log(failures ? `FAILED (${failures})` : 'OK');
  process.exit(failures ? 1 : 0);
})();
