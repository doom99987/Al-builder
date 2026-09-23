// Node test for the yarthul-new rules (QteRules.trainers['yarthul-new']).
//   node yarthul-new.test.js [honestRuns]
// a) honest players simulated frame by frame from the rules (the IIFE's own
//    loop, ported), with the exact log the IIFE writes: 0 invalid, 0 score
//    mismatch, review <= 0.5%;
// b) forgeries: each must be invalid, held for review, or score far below claim;
// c) the real IIFE (yarthul-new.iife.js) run in a stub DOM, played by the same
//    simulated people: every submitted packet must pass with its claim.
// Adversarial review additions: window drags (many resizes, several between two
// frames) in the honest mix; forgeries by resize floods, resize teleports,
// pauses as cover for slow motion, reused meteors, events after 'X'; a restless
// player (thousands of key changes: no drift), lucky personal bests (fewer aimed
// meteors than average: not held), and the IIFE past its log budget ('X').
// Exit code 1 on any failure.
'use strict';
require('./_paths.js');
const fs = require('fs');
const path = require('path');
const Q = require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const T = Q.trainers['yarthul-new'];
const K = T.K, GE = T.geom;

let failures = 0;
function fail(msg) { failures++; console.log('FAIL ' + msg); }

// ── randomness ────────────────────────────────────────────────────────────────
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
function uni(rng, a, b) { return a + (b - a) * rng(); }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
const round4 = f => (typeof f === 'number' ? Math.round(f * 10000) / 10000 : f);
const gms = s => Math.round(s * 10000) / 10;
const px1 = x => Math.round(x * 10) / 10;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

// ── people ────────────────────────────────────────────────────────────────────
// A person sees the game `rt` ms late (meteors made since then are unseen),
// misjudges positions a little, and plans a move: stay, or hold left/right for
// a chosen time and let go. The plan with the most room wins, with a pull back
// to the middle of the platform. A started move is held to its planned end
// unless it turns out to run into something. Now and then they zone out. Keys
// are pressed and released with motor jitter; switching sides rolls from one
// key to the other (sometimes both are down for a moment).
function makePersona(rng, level) {
  return {
    level,
    rtMean: clamp(320 - 100 * level + 18 * gauss(rng), 200, 380),
    rtSd: uni(rng, 0.06, 0.16),
    posSd: uni(rng, 1, 4) + 7 * (1 - level),
    mSd: uni(rng, 1, 4) + 7 * (1 - level),
    margin: uni(rng, 8, 30),
    centerW: uni(rng, 2, 8),
    horizon: 700 + 300 * level + uni(rng, -50, 50),
    decMs: uni(rng, 35, 75),
    lapseRate: Math.max(0.005, 0.12 - 0.115 * level + 0.01 * gauss(rng)), // per second
    lapseMs: [150, 400 + 400 * (1 - level)],
    motorSd: uni(rng, 10, 35),
    holdSd: uni(rng, 0.05, 0.20),       // relative error on a planned hold
    roll: [uni(rng, -30, -5), uni(rng, 10, 45)],
    tapNoise: uni(rng, 0, 0.01),         // a stray tap now and then
  };
}

const HOLDS = [0.07, 0.12, 0.2, 0.3, 0.45, 0.65, 0.9];

// world: { W(), H(), gameAt(wallMs) -> gms|null, pxAt(gms), meteorsAt(gms) -> [{x,y,vx,vy,r}] }
function makeHuman(p, rng, speedFn) {
  let intent = 0, lapseUntil = -1, planEnd = 0, planHold = 0;
  // what my hands did (key direction from time t), to know how far I moved since what I see
  const hands = [{ t: -1e9, dir: 0 }];
  function moved(t0, t1, S) {
    let d = 0;
    for (let i = 0; i < hands.length; i++) {
      const a = Math.max(t0, hands[i].t), b = Math.min(t1, i + 1 < hands.length ? hands[i + 1].t : t1);
      if (b > a) d += hands[i].dir * S * (b - a) / 1000;
    }
    return d;
  }
  function note(ev) {
    // key state after these events, at their times
    for (const e of ev.slice().sort((x, y) => x.t - y.t)) {
      const prev = hands[hands.length - 1];
      let l = prev.l || false, r = prev.r || false;
      if (e.key === 'L') l = e.down; else r = e.down;
      hands.push({ t: e.t, dir: (r ? 1 : 0) - (l ? 1 : 0), l, r });
    }
    if (hands.length > 200) hands.splice(0, 100);
  }
  function keyOf(d) { return d < 0 ? 'L' : 'R'; }
  // min clearance (px beyond touching) of a plan: hold c for `hold` s, then stop
  // (the key acts after a motor delay `dly`, until then the flame goes on as `c0`)
  function clearance(ms, px0, c, hold, S, L, Rt, yP, top, H, hz, c0, dly) {
    c0 = c0 || 0; dly = dly || 0;
    let best = 60;
    for (const m of ms) {
      const R0 = m.r + GE.playerR(H);
      const ta = Math.max(0, (yP - R0 - 40 - m.y) / m.vy), tb = Math.min(hz, (Math.min(top, yP + R0) - m.y) / m.vy);
      if (tb < ta) continue;
      if (Math.abs(m.x - px0) > S * (Math.min(tb, hold) + dly) + Math.abs(m.vx) * tb + R0 + 60) continue;
      for (let s = 0; s <= 10; s++) {
        const tau = ta + (tb - ta) * s / 10;
        const x = tau < dly ? clamp(px0 + c0 * S * tau, L, Rt) : clamp(clamp(px0 + c0 * S * dly, L, Rt) + c * S * Math.min(tau - dly, hold), L, Rt);
        const dx = m.x + m.vx * tau - x, dy = m.y + m.vy * tau - yP;
        const d = Math.sqrt(dx * dx + dy * dy) - R0;
        if (d < best) best = d;
      }
    }
    return best;
  }
  function press(td, from, to) {
    const out = [];
    const m1 = td + Math.abs(gauss(rng)) * p.motorSd + 25;
    if (from !== 0 && to !== 0) {
      out.push({ t: m1, key: keyOf(from), down: false });
      out.push({ t: Math.max(td + 5, m1 + uni(rng, p.roll[0], p.roll[1])), key: keyOf(to), down: true });
    } else if (from !== 0) out.push({ t: m1, key: keyOf(from), down: false });
    else if (to !== 0) out.push({ t: m1, key: keyOf(to), down: true });
    return out;
  }
  return {
    get intent() { return intent; },
    decide(td, world) {
      if (td < lapseUntil) {
        // zoned out: a held key is still let go around when planned
        if (intent !== 0 && td >= planEnd) { const ev = press(td, intent, 0); intent = 0; note(ev); return ev; }
        return [];
      }
      if (rng() < p.lapseRate * p.decMs / 1000) { lapseUntil = td + uni(rng, p.lapseMs[0], p.lapseMs[1]); return []; }
      const rt = Math.max(p.rtFloor || 140, p.rtMean * Math.exp(p.rtSd * gauss(rng)));
      const gp = world.gameAt(td - rt);
      if (gp === null) return [];
      const W = world.W(), H = world.H();
      const S = speedFn(W);
      const L = GE.platLeft(W), Rt = GE.platRight(W), yP = GE.playerY(H), top = GE.platTop(H);
      const lead = rt / 1000;
      // where I am now: seen rt ago, moved since as I was holding
      const remaining = intent !== 0 ? Math.max(0, (planEnd - td) / 1000) : 0;
      let px0 = world.pxAt(gp) + moved(td - rt, td, S) + p.posSd * gauss(rng);
      px0 = clamp(px0, L, Rt);
      const hz = p.horizon / 1000;
      const ms = [];
      for (const m of world.meteorsAt(gp)) {
        const y = m.y + m.vy * lead;
        if (y > top) continue;
        ms.push({ x: m.x + m.vx * lead + p.mSd * gauss(rng), y, vx: m.vx, vy: m.vy, r: m.r });
      }
      const mid = (L + Rt) / 2, half = (Rt - L) / 2;
      const endCost = x => p.centerW * Math.abs(x - mid) / half;
      // a move under way: keep it unless it now runs into something
      if (intent !== 0 && td < planEnd) {
        const cur = clearance(ms, px0, intent, remaining, S, L, Rt, yP, top, H, hz);
        if (cur >= Math.min(p.margin * 0.4, 6)) return [];
      }
      if (intent !== 0 && td >= planEnd) {
        // the planned hold is over: let go (then plan again next time)
        const ev = press(td, intent, 0); intent = 0; note(ev); return ev;
      }
      // plan
      let bestC = 0, bestH = 0, bestV = -Infinity;
      const dly = 0.06;
      const worth = cl => (cl < p.margin ? 2 * cl - p.margin : Math.min(cl, p.margin + 30));
      const stay = clearance(ms, px0, 0, 0, S, L, Rt, yP, top, H, hz);
      const off = Math.abs(px0 - mid) / half;
      if (stay >= p.margin && off < 0.55 && intent === 0) return [];
      bestV = worth(stay) - endCost(px0) + 3;
      for (const c of [-1, 1]) {
        for (const h of HOLDS) {
          const cl = clearance(ms, px0, c, h, S, L, Rt, yP, top, H, hz, 0, dly);
          const xe = clamp(px0 + c * S * h, L, Rt);
          const v = worth(cl) - endCost(xe) - h;
          if (v > bestV) { bestV = v; bestC = c; bestH = h; }
        }
      }
      if (rng() < p.tapNoise) { bestC = pick(rng, [-1, 1]); bestH = pick(rng, HOLDS.slice(0, 3)); }
      if (p.debug) p.debug.push({ td, gp, rt, px0, stay, bestC, bestH, bestV, intent, n: ms.length });
      if (bestC === intent) return [];
      const ev = press(td, intent, bestC);
      note(ev);
      intent = bestC;
      if (bestC !== 0) {
        const tDown = ev[ev.length - 1].t;
        planHold = Math.max(0.04, bestH * (1 + p.holdSd * gauss(rng)));
        planEnd = tDown + planHold * 1000;
      }
      return ev;
    },
  };
}

// A script that sees every meteor the frame it is made and dodges by the
// smallest move that keeps it `margin` px clear (forgeries).
function makeBot(opts, speedFn) {
  let intent = 0;
  return {
    get intent() { return intent; },
    decide(td, world) {
      const gp = world.gameAt(td - (opts.lag || 0));
      if (gp === null) return [];
      const W = world.W(), H = world.H(), S = speedFn(W);
      const L = GE.platLeft(W), Rt = GE.platRight(W), yP = GE.playerY(H), top = GE.platTop(H);
      const lead = (opts.lag || 0) / 1000;
      const px0 = world.pxAt(gp) + intent * S * lead;
      const ms = world.meteorsAt(gp);
      const cands = [0, intent || 1, -(intent || 1)], score = [99, 99, 99];
      for (const m of ms) {
        const R0 = m.r + GE.playerR(H);
        const mx = m.x + m.vx * lead, my = m.y + m.vy * lead;
        for (let c = 0; c < 3; c++) {
          for (let s = 0; s <= 40; s++) {
            const tau = s * 0.02;
            const yy = my + m.vy * tau;
            if (yy >= top) break;
            const x = clamp(px0 + cands[c] * S * tau, L, Rt);
            const dx = mx + m.vx * tau - x, dy = yy - yP;
            const d = Math.sqrt(dx * dx + dy * dy) - R0;
            if (d < score[c]) score[c] = d;
          }
        }
      }
      let bestC = cands[0];
      if (score[0] < opts.margin) bestC = score[1] >= score[2] ? cands[1] : cands[2];
      if (bestC === intent) return [];
      const out = [];
      if (intent !== 0) out.push({ t: td + 0.5, key: intent < 0 ? 'L' : 'R', down: false });
      if (bestC !== 0) out.push({ t: td + 0.6, key: bestC < 0 ? 'L' : 'R', down: true });
      intent = bestC;
      return out;
    },
  };
}

// Toggles left/right every `period` ms, whatever falls (forgeries).
function makeMetronome(period) {
  let intent = 0, next = 300;
  return {
    get intent() { return intent; },
    decide(td) {
      if (td < next) return [];
      next += period;
      const to = intent === 1 ? -1 : 1, out = [];
      if (intent !== 0) out.push({ t: td + 0.2, key: intent < 0 ? 'L' : 'R', down: false });
      out.push({ t: td + 0.3, key: to < 0 ? 'L' : 'R', down: true });
      intent = to;
      return out;
    },
  };
}

// ── the trainer, ported frame by frame from yarthul-new.iife.js ──────────────
// cfg: { seed, comp, W0, ping, mobile, frames: {period, jitter, dropP, q}, negFirst,
//        pauses: [{at, dur}], resize: {at, W} | null, quitAfter, controller(world, rng),
//        cherry: 'x' | null, maxWall }
function simulate(cfg) {
  const rng = mulberry(cfg.seed);
  const grng = mulberry((cfg.seed * 7919 + 13) >>> 0);
  const comp = !!cfg.comp;
  const type = 'yarthul-new' + (comp ? '-comp' : '');
  const log = { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: cfg.W0 + 40, h: 900, mob: !!cfg.mobile, ping: cfg.ping }, ev: [] };
  let now = 0;
  // logEv: the same size budget as the IIFE, ended by 'X'
  let logBytes = 0, logFull = false;
  function ev(code, ...f) {
    if (logFull) return;
    const est = JSON.stringify([code, ...f]).length + 10;
    if (logBytes + est > K.LOG_BUDGET || log.ev.length >= Q.LIMITS.MAX_EVENTS - 1) {
      logFull = true; log.ev.push(['X', Math.max(0, Math.round(now))]); return;
    }
    logBytes += est;
    log.ev.push([code, Math.max(0, Math.round(now)), ...f.map(round4)]);
  }

  let W = cfg.W0, H = T.canvasH(W);
  const platformTop = () => H * K.PLATFORM_TOP_FRAC;
  const platformLeft = () => (W - W * K.PLATFORM_WIDTH_FRAC) / 2;
  const platformRight = () => platformLeft() + W * K.PLATFORM_WIDTH_FRAC;
  const clampPlayer = () => { playerX = Math.min(Math.max(playerX, platformLeft()), platformRight()); };

  // startGame()
  let stage = 1, score = 0, stageTimer = T.stageDuration(1), meteors = [], spawnAccum = 0;
  let transitioning = false, transitionTimer = 0, playerX = W / 2, moveLeft = false, moveRight = false;
  let running = true, gameT = 0, loggedDir = 0, hiddenLog = false, ended = null;
  const submits = [];
  now = uni(rng, 0.02, 0.2);
  ev('S', W, H);
  let lastTime = now + uni(rng, 0.05, 0.4);   // startLoop's performance.now()

  // world for the controller: frame history and meteor records
  const hCb = [], hG = [], hPx = [];
  const recs = [];
  const world = {
    W: () => W, H: () => H,
    gameAt(w) {
      let lo = 0, hi = hCb.length - 1;
      if (hi < 0 || hCb[0] > w) return null;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (hCb[m] <= w) lo = m; else hi = m - 1; }
      return hG[lo];
    },
    pxAt(g) {
      let lo = 0, hi = hG.length - 1;
      if (hi < 0) return playerX;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (hG[m] <= g) lo = m; else hi = m - 1; }
      return hPx[lo];
    },
    meteorsAt(g) {
      const out = [];
      for (let i = Math.max(0, recs.length - 60); i < recs.length; i++) {
        const m = recs[i];
        if (m.gs >= g || (m.gone !== null && m.gone <= g)) continue;
        const tt = (g - m.gs) / 1000;
        out.push({ x: m.x0 + m.vx * tt, y: m.y0 + m.vy * tt, vx: m.vx, vy: m.vy, r: m.r });
      }
      return out;
    },
  };
  const ctl = cfg.controller(world, rng);

  function threatens(u1, u2) {
    // used only by the cherry-picking forgery
    const spd = T.fallSpeedFrac(stage, comp) * H, r = H * K.METEOR_R_FRAC;
    const vx = (u2 * 2 - 1) * T.driftFrac(comp) * spd, y0 = -r * K.SPAWN_Y_R;
    const R0 = r + GE.playerR(H), Tt = (GE.playerY(H) - y0) / spd;
    if (cfg.cherryBand) {   // keep a band of the platform clear
      const xl = u1 * W + vx * Tt, m0 = R0 * 1.6 + (cfg.cherryPad || 0);
      return xl > cfg.cherryBand[0] - m0 && xl < cfg.cherryBand[1] + m0;
    }
    const dir = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
    const ext = cfg.cherryStill ? playerX : clamp(playerX + dir * K.PLAYER_SPEED_FRAC * W * Tt, platformLeft(), platformRight());
    return Math.abs(u1 * W + vx * Tt - ext) < R0 * 1.6 + (cfg.cherryPad || 0);
  }

  let drawIdx = 0; const cycle = [];
  function spawnMeteor(lagMs, g0) {
    const spd = T.fallSpeedFrac(stage, comp) * H;
    const r = H * K.METEOR_R_FRAC;
    let u1 = grng(), u2 = grng();
    // drawCycle: the same N meteors over and over (reused targets)
    if (cfg.drawCycle) { const k = drawIdx++ % cfg.drawCycle; if (!cycle[k]) cycle[k] = [u1, u2]; u1 = cycle[k][0]; u2 = cycle[k][1]; }
    // cherry: re-draw meteors aimed at the flame (cherryP: only that share of them)
    if (cfg.cherry) { let n = 0; while (threatens(u1, u2) && n++ < 50 && (cfg.cherryP === undefined || rng() < cfg.cherryP)) { u1 = grng(); u2 = grng(); } }
    const m = { x: u1 * W, y: -r * K.SPAWN_Y_R, vx: (u2 * 2 - 1) * T.driftFrac(comp) * spd, vy: spd, r: r };
    meteors.push(m);
    ev('M', Math.floor(u1 * K.U_SCALE), Math.floor(u2 * K.U_SCALE), Math.round(lagMs * 10));
    m.rec = { gs: g0 * 1000, x0: m.x, y0: m.y, vx: m.vx, vy: m.vy, r: r, gone: null };
    recs.push(m.rec);
  }
  function updateMeteors(dt) {
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.y >= platformTop()) { m.rec.gone = gameT * 1000; meteors.splice(i, 1); }
      else if (m.x < -m.r * 4 || m.x > W + m.r * 4) { m.rec.gone = gameT * 1000; meteors.splice(i, 1); }
    }
  }
  function checkCollision() {
    const h = H * K.PLAYER_H_FRAC, w = h * 0.45;
    const p = { x: playerX, y: platformTop() - h * 0.45, r: w * K.PLAYER_HIT_FRAC };
    for (const m of meteors) if (Math.hypot(m.x - p.x, m.y - p.y) <= m.r + p.r) return true;
    return false;
  }
  let leaveAt = Infinity;
  function onStageCleared(cb) {
    score = stage;
    ev('C', stage, gms(gameT));
    submits.push({ claimed: stage, n: log.ev.length });
    stage++;
    for (const m of meteors) m.rec.gone = gameT * 1000;
    meteors = [];
    spawnAccum = 0;
    transitioning = true;
    transitionTimer = K.TRANSITION_SECS;
    if (cfg.quitAfter && score >= cfg.quitAfter && leaveAt === Infinity) leaveAt = cb + uni(rng, 50, 3000);
  }
  function frame(ts, cb) {
    const dt = Math.min((ts - lastTime) / 1000, K.DT_CAP);
    lastTime = ts;
    if (cb >= leaveAt) { ev('E', 'abandon'); running = false; ended = 'abandon'; return; }
    const g0 = gameT;
    gameT += dt;
    if (transitioning) {
      transitionTimer -= dt;
      if (transitionTimer <= 0) {
        transitioning = false;
        stageTimer = T.stageDuration(stage);
        ev('B', stage, gms(g0), gms(gameT));
      }
    } else {
      const acc0 = spawnAccum;
      spawnAccum += dt * 1000;
      const iv = T.spawnIntervalMs(stage, comp);
      let k = 0;
      while (spawnAccum >= iv) { k++; spawnMeteor(k * iv - acc0, g0); spawnAccum -= iv; }
    }
    const dir = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
    if (dir !== loggedDir) { loggedDir = dir; ev('D', gms(g0), dir, px1(playerX)); }
    playerX += dir * K.PLAYER_SPEED_FRAC * W * dt;
    clampPlayer();
    updateMeteors(dt);
    if (!transitioning) {
      if (checkCollision()) { ev('E', 'hit', gms(gameT)); running = false; ended = 'hit'; return; }
      stageTimer -= dt;
      if (stageTimer <= 0) onStageCleared(cb);
    }
    hCb.push(cb); hG.push(gameT * 1000); hPx.push(playerX);
  }

  // ── the event loop ──
  const fp = cfg.frames;
  const quant = t => (fp.q ? Math.floor(t / fp.q) * fp.q : t);
  let fr = lastTime + uni(rng, 0.5, fp.period);
  let ts = cfg.negFirst ? lastTime - uni(rng, 0, 12) : quant(fr);
  let nextDec = uni(rng, 0, 60) + 150;
  let lastDeliv = 0;
  const deliveries = [];
  const pauses = (cfg.pauses || []).slice();
  const resizes = (cfg.resizes || (cfg.resize ? [cfg.resize] : [])).slice().sort((a, b) => a.at - b.at);
  const maxWall = cfg.maxWall || 3.6e6;
  let firstFrame = true;
  while (running) {
    let cb = Math.max(fr, lastTime) + uni(rng, 0.1, 1.5);
    // a hidden tab: no frames until it is shown again
    if (pauses.length && pauses[0].at < cb) {
      const p = pauses.shift();
      const at = Math.max(p.at, now);
      // decisions and deliveries up to the hide
      runInputs(at);
      now = at;
      if (running && !hiddenLog) { hiddenLog = true; ev('P'); }
      // keys held at the hide: the keyup is often lost
      if (rng() < 0.5) { /* flags stick */ } else { moveLeft = moveRight = false; }
      const back = at + p.dur;
      // deliveries during the pause still land
      runDeliveries(back);
      now = back;
      if (running && hiddenLog) { hiddenLog = false; ev('U'); }
      nextDec = back + uni(rng, 200, 600);
      fr = back + uni(rng, 0.5, fp.period);
      ts = quant(fr);
      continue;
    }
    // resizes before this frame (a window drag fires several between two frames)
    while (resizes.length && resizes[0].at < cb) {
      const rz = resizes.shift();
      runInputs(rz.at);
      now = Math.max(now, rz.at);
      const oldW = W, oldH = H;
      W = T.canvasW(rz.W); H = T.canvasH(W);
      if (!playerX) playerX = W / 2;
      clampPlayer();
      if (running && (W !== oldW || H !== oldH)) ev('Z', gms(gameT), W, H, px1(playerX));
    }
    runInputs(cb);
    now = cb;
    frame(ts, cb);
    firstFrame = false;
    if (cb > maxWall) { if (running) { now = cb + 1; ev('E', 'abandon'); running = false; ended = 'abandon'; } break; }
    // next frame
    let per = fp.period * (1 + (rng() * 2 - 1) * fp.jitter);
    if (rng() < fp.dropP) per += uni(rng, 20, 350);
    fr = fr + per;
    ts = quant(fr);
  }
  return { log, score, submits, ended, gameT };

  function runDeliveries(upTo) {
    deliveries.sort((a, b) => a.t - b.t);
    while (deliveries.length && deliveries[0].t < upTo) {
      const d = deliveries.shift();
      if (d.key === 'L') moveLeft = d.down; else moveRight = d.down;
    }
  }
  function runInputs(upTo) {
    while (nextDec < upTo) {
      const td = nextDec;
      nextDec += (ctl.decMs || 50) * uni(rng, 0.8, 1.2);
      const evs = ctl.c.decide(td, world);
      for (const e of evs) {
        let t = e.t;
        if (!cfg.mobile && cfg.ping > 0) {
          // the ping simulator: a setTimeout(ping) per key event, sometimes late
          let late = uni(rng, 0, 4);
          if (rng() < 0.01) late += uni(rng, 10, 100);
          t = Math.max(lastDeliv, t + cfg.ping + late);
          lastDeliv = t;
        }
        deliveries.push({ t: t, key: e.key, down: e.down });
      }
    }
    runDeliveries(upTo);
  }
}

// ── configs ────────────────────────────────────────────────────────────────────
const FRAME_PROFILES = [
  { w: 45, f: { period: 1000 / 60, jitter: 0.03, dropP: 0.003 } },
  { w: 12, f: { period: 1000 / 120, jitter: 0.04, dropP: 0.002 } },
  { w: 12, f: { period: 1000 / 144, jitter: 0.04, dropP: 0.002 } },
  { w: 6, f: { period: 1000 / 75, jitter: 0.03, dropP: 0.003 } },
  { w: 6, f: { period: 1000 / 30, jitter: 0.08, dropP: 0.01 } },      // a struggling laptop
  { w: 4, f: { period: 1000 / 60, jitter: 0.05, dropP: 0.08 } },      // a busy tab: many long frames
  { w: 4, f: { period: 1000 / 60, jitter: 0.02, dropP: 0.003, q: 1 } },   // 1 ms timer precision
  { w: 3, f: { period: 1000 / 60, jitter: 0.02, dropP: 0.003, q: 16.67 } }, // coarse timers (resistFingerprinting)
  { w: 2, f: { period: 1000 / 15, jitter: 0.15, dropP: 0.02 } },      // very slow device: dt clamp in play
  { w: 1, f: { period: 1000 / 60, jitter: 0.02, dropP: 0.003, q: 100 } },   // 100 ms timers: most frames count 0 ms
];
function pickProfile(rng) {
  let tot = 0; for (const p of FRAME_PROFILES) tot += p.w;
  let x = rng() * tot;
  for (const p of FRAME_PROFILES) { x -= p.w; if (x <= 0) return p.f; }
  return FRAME_PROFILES[0].f;
}
function honestCfg(i) {
  const rng = mulberry(1000003 * (i + 1));
  const mobile = rng() < 0.15;
  const W0 = mobile ? pick(rng, [320, 344, 360, 375, 390, 412, 430]) : pick(rng, [900, 900, 900, 860, 800, 760, 700, 640, 600, 560, 520, 480]);
  const elite = rng() < 0.12;
  const level = elite ? 1 : Math.pow(rng(), 0.8);
  const per = makePersona(rng, level);
  if (elite) {
    // top of the board: quick eyes, steady hands, rarely zones out
    per.rtMean = uni(rng, 150, 210); per.rtFloor = 120; per.horizon = uni(rng, 950, 1150); per.decMs = uni(rng, 30, 50);
    per.lapseRate = uni(rng, 0.002, 0.01); per.posSd = uni(rng, 1, 2.5); per.mSd = uni(rng, 1, 2.5); per.margin = uni(rng, 12, 26); per.tapNoise = 0.002;
  }
  const ping = mobile ? 0 : pick(rng, [0, 0, 0, 50, 100, 150, 150, 300]);
  const pauses = [];
  if (rng() < 0.12) { const n = 1 + Math.floor(rng() * 3); let at = uni(rng, 500, 20000); for (let k = 0; k < n; k++) { pauses.push({ at, dur: uni(rng, 200, 30000) }); at += uni(rng, 2000, 40000); } }
  let resize = null;
  if (rng() < 0.06) resize = { at: uni(rng, 1000, 60000), W: mobile ? pick(rng, [640, 700, 740, 800]) : pick(rng, [900, 700, 560, 480, 820]) };
  const quitAfter = rng() < 0.15 ? 1 + Math.floor(rng() * 12) : 0;
  // A window dragged mid-run: 0.3-3 s of resize events every 2-40 ms (often
  // several between two frames), the width wandering, sometimes past 900.
  let resizes = null;
  if (rng() < 0.06) {
    resizes = resize ? [resize] : [];
    let at = uni(rng, 800, 40000), w = W0 + 40;
    const end = at + uni(rng, 300, 3000), lo = mobile ? 300 : 360;
    while (at < end) { w = clamp(Math.round(w + uni(rng, -45, 45)), lo, 1100); resizes.push({ at, W: w }); at += uni(rng, 2, 40); }
  }
  const cfg = {
    seed: (i * 2654435761) >>> 0,
    comp: rng() < 0.5, W0, ping, mobile, frames: pickProfile(rng),
    negFirst: rng() < 0.3, pauses, resize, resizes, quitAfter, maxWall: 900000,
    level, elite, persona: per,
    controller: (world, r2) => ({ c: makeHuman(per, r2, W => K.PLAYER_SPEED_FRAC * W), decMs: per.decMs }),
  };
  return cfg;
}

// A log written without playing (forgeries): 60 fps frames, the flame parked
// (no keys), fresh uniform draws, every stage timed right. zEvery: a resize
// every N ms of game time, flipping to zW (default 899: same height) and back;
// zBack: both resizes at the same instant.
function forgeLog(opts) {
  const comp = !!opts.comp, W0 = opts.W || 900, rng = mulberry(opts.seed || 1);
  const ev = [], fr = 1000 / 60, r1 = x => Math.round(x * 10) / 10;
  let g = 0, W = W0, fx = W0 / 2, nextZ = opts.zEvery || Infinity, flip = false;
  const wall = () => Math.round(g + 40);
  const resize = (w) => {
    W = w; if (!fx) fx = W / 2; fx = clamp(fx, GE.platLeft(W), GE.platRight(W));
    ev.push(['Z', wall(), r1(g), W, T.canvasH(W), r1(fx)]);
  };
  // teleport: the flame jumps between the middle and x = 250 by resizing to a
  // narrow canvas and straight back (clamps), whenever a meteor is coming
  const ms = [], H0 = T.canvasH(W0), yP = GE.playerY(H0), R0 = H0 * K.METEOR_R_FRAC + GE.playerR(H0), top = GE.platTop(H0);
  const danger = (x) => ms.some(m => { for (let tau = 0; tau <= 200; tau += 10) { const tt = (g + tau - m.gs) / 1000, my = m.y0 + m.vy * tt; if (my >= top) return false; const dx = m.x0 + m.vx * tt - x, dy = my - yP; if (dx * dx + dy * dy < (R0 + 12) * (R0 + 12)) return true; } return false; });
  let teleports = 0;
  ev.push(['S', 10, W, T.canvasH(W)]);
  for (let n = 1; n <= opts.stages; n++) {
    const dur = T.stageDuration(n) * 1000, iv = T.spawnIntervalMs(n, comp);
    let clock0 = 0;
    if (n > 1) {
      const cleared = g; let b0 = g;
      while (b0 + fr - cleared < 1500) b0 += fr;
      g = b0 + fr;
      ev.push(['B', wall(), n, r1(b0), r1(g)]);
      clock0 = b0;
    }
    let acc = 0;
    for (;;) {
      if (g >= nextZ) {
        if (opts.zBack) { resize(opts.zW || 899); resize(W0); }
        else { flip = !flip; resize(flip ? (opts.zW || 899) : W0); }
        nextZ += opts.zEvery;
      }
      const a0 = acc; acc += fr; let k = 0;
      while (acc >= iv) {
        k++;
        const u1 = rng(), u2 = rng(), vy = T.fallSpeedFrac(n, comp) * H0;
        ev.push(['M', wall(), Math.floor(u1 * 1e4), Math.floor(u2 * 1e4), Math.round((k * iv - a0) * 10)]);
        ms.push({ gs: g, x0: (Math.floor(u1 * 1e4) + 0.5) / 1e4 * W0, y0: -H0 * K.METEOR_R_FRAC * K.SPAWN_Y_R, vx: ((Math.floor(u2 * 1e4) + 0.5) / 1e4 * 2 - 1) * T.driftFrac(comp) * vy, vy });
        acc -= iv;
      }
      if (opts.teleport && danger(fx)) {
        const to = fx > 400 ? 250 : W0 / 2;
        if (!danger(to)) {
          if (to === W0 / 2) { resize(0); resize(W0); } else { resize(Math.round(to / 0.81)); resize(W0); }
          teleports++;
        }
      }
      g += fr;
      if (g - clock0 >= dur) { ev.push(['C', wall(), n, r1(g)]); ms.length = 0; break; }
    }
  }
  return { v: 1, rv: 1, type: 'yarthul-new' + (comp ? '-comp' : ''), a: 0, env: { w: 940, h: 900, mob: false, ping: 0 }, ev, teleports };
}

function sliceLog(log, n) { return { v: log.v, rv: log.rv, type: log.type, a: log.a, env: log.env, ev: log.ev.slice(0, n) }; }
function cloneLog(log) { return JSON.parse(JSON.stringify(log)); }
function check(log, claimed, platform) { return Q.check(log.type, log, { platform: platform || 'C', claimed }); }

// ── c) the real IIFE in a stub DOM ───────────────────────────────────────────
function runIife(opts) {
  const src = fs.readFileSync(path.join(__dirname, 'yarthul-new.iife.js'), 'utf8');
  const rng = mulberry(opts.seed);
  let clock = 1000 + rng() * 1000;
  const perf = { now: () => clock };
  Object.defineProperty(globalThis, 'performance', { value: perf, configurable: true, writable: true });
  const listeners = {}, winListeners = {};
  let rafCb = null, rafId = 0;
  const grad = { addColorStop() {} };
  const ctx2d = new Proxy({}, { get(t, p) { if (p in t) return t[p]; return function () { return grad; }; }, set(t, p, v) { t[p] = v; return true; } });
  const wrap = { clientWidth: opts.W0 };
  const el = () => ({ textContent: '', style: { display: '' }, _l: {}, addEventListener(type, fn) { this._l[type] = fn; } });
  const canvas = { getContext: () => ctx2d, parentElement: wrap, parentNode: { insertBefore() {} }, style: {}, width: 0, height: 0 };
  const els = {
    'yarthul-new-qte-canvas': canvas,
    'yarthul-new-qte-status': el(), 'yarthul-new-qte-streak': el(), 'yarthul-new-qte-highscore': el(),
    'yarthul-new-qte-start-btn': el(), 'yarthul-new-qte-resume-btn': el(),
    'page-qte': { classList: { contains: c => c === 'active' } },
    'qte-panel-yarthul-new': { style: { display: 'flex' } },
  };
  const documentStub = {
    hidden: false, activeElement: null,
    getElementById: id => els[id] || null,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    createElement: () => ({ className: '', innerHTML: '', querySelectorAll: () => [] }),
  };
  const store = new Map();
  const localStorageStub = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const windowStub = { _qteCompMode: !!opts.comp, addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); } };
  const packets = [];
  globalThis._sbSubmitScore = (type, score, packet) => { packets.push({ type, score, log: JSON.parse(JSON.stringify(packet.log)) }); };
  // the IIFE's meteor draws, seeded so a run can be repeated
  const realRandom = Math.random;
  Math.random = mulberry((opts.seed * 2246822519) >>> 0);
  try { return runIifeInner(); } finally { Math.random = realRandom; delete globalThis._sbSubmitScore; }
  function runIifeInner() {
  const f = new Function('document', 'window', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'QteRules', 'IS_MOBILE', src);
  f(documentStub, windowStub, localStorageStub, cb => { rafCb = cb; return ++rafId; }, () => { rafCb = null; }, Q, !!opts.mobile);
  // show the panel, then Start
  windowStub._onYarthulNewQteShow();
  els['yarthul-new-qte-start-btn']._l.click();
  const run = Q.Run.current;
  const dispatch = (type, key) => { for (const fn of listeners[type] || []) fn({ key, preventDefault() {} }); };

  // world rebuilt from the run's own log (as the page bot does)
  const W = () => lw.W, H = () => lw.H;
  const lw = logWorld(run, opts.comp);
  const world = {
    W, H,
    gameAt: w => lw.gameAt(w),
    pxAt: g => lw.pxAt(g),
    meteorsAt: g => lw.meteorsAt(g),
  };
  const per = makePersona(rng, opts.level);
  const human = makeHuman(per, rng, w => K.PLAYER_SPEED_FRAC * w);
  let nextDec = 200, pending = [], lastDeliv = 0, frames = 0;
  let hidden = opts.pauseAt ? { at: opts.pauseAt, dur: opts.pauseDur } : null;
  let resize = opts.resizeAt ? { at: opts.resizeAt, W: opts.resizeW } : null;
  const period = opts.period;
  let fr = clock + rng() * period;
  while (rafCb && run.now() < opts.maxMs) {
    const rel = fr - run.t0;
    if (hidden && rel >= hidden.at) {
      clock = run.t0 + hidden.at; documentStub.hidden = true; for (const fn of listeners.visibilitychange || []) fn({});
      clock += hidden.dur; documentStub.hidden = false; for (const fn of listeners.visibilitychange || []) fn({});
      fr = clock + rng() * period; hidden = null; continue;
    }
    if (resize && rel >= resize.at) {
      clock = run.t0 + resize.at; wrap.clientWidth = resize.W; for (const fn of winListeners.resize || []) fn({}); resize = null;
    }
    // decisions and key deliveries up to this frame
    while (nextDec < rel) {
      lw.sync();
      const evs = human.decide(nextDec, world);
      for (const e of evs) { const t = Math.max(lastDeliv, e.t + opts.ping + (opts.ping ? rng() * 4 : 0)); lastDeliv = t; pending.push({ t, key: e.key, down: e.down }); }
      nextDec += per.decMs * (0.8 + 0.4 * rng());
    }
    pending.sort((a, b) => a.t - b.t);
    while (pending.length && pending[0].t < rel) {
      const d = pending.shift(); clock = Math.max(clock, run.t0 + d.t);
      dispatch(d.down ? 'keydown' : 'keyup', d.key === 'L' ? 'a' : 'd');
    }
    clock = Math.max(clock, fr + 0.3);
    const cb = rafCb; rafCb = null;
    cb(fr);
    frames++;
    fr += period * (1 + (rng() - 0.5) * 0.06) + (rng() < 0.004 ? 50 + rng() * 200 : 0);
    lw.sync();
  }
  // leave the panel if still running
  if (rafCb) windowStub._onYarthulNewQteHide();
  return { run, packets, frames, finalLog: run.log };
  }
}

// Rebuild the meteors and the flame's path from a run's log (what a page bot sees).
function logWorld(run, comp) {
  const st = { W: 0, H: 0, n: 1, acc: 0, j: 0, i: 0, pcs: [], ms: [], anchors: [] };
  function pxAt(g) {
    let p = st.pcs[0]; if (!p) return st.W / 2;
    for (let k = st.pcs.length - 1; k >= 0; k--) if (st.pcs[k].g <= g) { p = st.pcs[k]; break; }
    return clamp(p.x + p.dir * K.PLAYER_SPEED_FRAC * p.W * (g - p.g) / 1000, GE.platLeft(p.W), GE.platRight(p.W));
  }
  return {
    get W() { return st.W; }, get H() { return st.H; },
    sync() {
      const ev = run.log.ev;
      for (; st.i < ev.length; st.i++) {
        const e = ev[st.i];
        if (e[0] === 'S') { st.W = e[2]; st.H = e[3]; st.pcs.push({ g: 0, x: st.W / 2, dir: 0, W: st.W }); st.anchors.push([e[1], 0]); }
        else if (e[0] === 'M') {
          st.j++;
          const gs = st.acc + st.j * T.spawnIntervalMs(st.n, comp) - e[4] / 10;
          const vy = T.fallSpeedFrac(st.n, comp) * st.H, r = st.H * K.METEOR_R_FRAC;
          st.ms.push({ gs, x0: (e[2] + 0.5) / K.U_SCALE * st.W, y0: -r * K.SPAWN_Y_R, vx: (((e[3] + 0.5) / K.U_SCALE) * 2 - 1) * T.driftFrac(comp) * vy, vy, r, top: GE.platTop(st.H), stage: st.n });
          st.anchors.push([e[1], gs]);
        } else if (e[0] === 'D') { st.pcs.push({ g: e[2], x: pxAt(e[2]), dir: e[3], W: st.W }); st.anchors.push([e[1], e[2]]); }
        else if (e[0] === 'Z') { const x = pxAt(e[2]); st.W = e[3]; st.H = e[4]; st.pcs.push({ g: e[2], x: clamp(x, GE.platLeft(st.W), GE.platRight(st.W)), dir: st.pcs[st.pcs.length - 1].dir, W: st.W }); }
        else if (e[0] === 'C') { for (const m of st.ms) if (m.stage === st.n) m.gone = e[3]; st.n++; st.anchors.push([e[1], e[3]]); }
        else if (e[0] === 'B') { st.acc = e[4]; st.j = 0; st.anchors.push([e[1], e[4]]); }
        else if (e[0] === 'U') { st.anchors.push([e[1], null]); }
      }
    },
    // game ms at wall ms (since the run's Start), from the newest anchor at or before it
    gameAt(w) {
      let a = null;
      for (let k = st.anchors.length - 1; k >= 0; k--) if (st.anchors[k][0] <= w) { a = st.anchors[k]; break; }
      if (!a) return null;
      let g = a[1];
      if (g === null) { for (let k = st.anchors.length - 1; k >= 0; k--) if (st.anchors[k][1] !== null && st.anchors[k][0] <= w) { g = st.anchors[k][1]; break; } return g; }
      return g + Math.min(w - a[0], 200);
    },
    pxAt,
    meteorsAt(g) {
      const out = [];
      for (let k = Math.max(0, st.ms.length - 60); k < st.ms.length; k++) {
        const m = st.ms[k];
        if (m.gs >= g || (m.gone !== undefined && m.gone <= g)) continue;
        const tt = (g - m.gs) / 1000, y = m.y0 + m.vy * tt;
        if (y >= m.top) continue;
        out.push({ x: m.x0 + m.vx * tt, y, vx: m.vx, vy: m.vy, r: m.r });
      }
      return out;
    },
  };
}

function main() {
// ── a) honest ──────────────────────────────────────────────────────────────────
const N_HONEST = +(process.argv[2] || 2000);
const t0 = Date.now();
let hInvalid = 0, hReview = 0, hMismatch = 0, hRuns = 0;
const stagesHist = {};
const reviewReasons = {};
let maxLogBytes = 0, maxLogEvents = 0, maxStage = 0;
const honestLogs = [];
const cal = {};
for (let i = 0; i < N_HONEST; i++) {
  const cfg = honestCfg(i);
  const res = simulate(cfg);
  hRuns++;
  stagesHist[res.score] = (stagesHist[res.score] || 0) + 1;
  if (res.score > maxStage) maxStage = res.score;
  const bytes = JSON.stringify(res.log).length;
  if (bytes > maxLogBytes) maxLogBytes = bytes;
  if (res.log.ev.length > maxLogEvents) maxLogEvents = res.log.ev.length;
  const plat = cfg.mobile ? 'M' : 'C';
  const checks = [[res.log, res.score, res.score]];
  if (res.submits.length) {
    const s = res.submits[res.submits.length - 1];
    checks.push([sliceLog(res.log, s.n), s.claimed, s.claimed]);
    if (res.submits.length > 2) { const s2 = res.submits[Math.floor(res.submits.length / 2)]; checks.push([sliceLog(res.log, s2.n), s2.claimed, s2.claimed]); }
  }
  let inv = false, rev = false, mis = false;
  for (const [lg, claimed, expect] of checks) {
    const r = check(lg, claimed, plat);
    if (r.verdict === 'invalid') { inv = true; if (hInvalid < 5) console.log('  honest invalid #' + i, JSON.stringify(r.reasons), JSON.stringify({ comp: cfg.comp, W: cfg.W0, ping: cfg.ping, fr: cfg.frames, neg: cfg.negFirst, pauses: cfg.pauses.length, resize: cfg.resize, drag: cfg.resizes ? cfg.resizes.length : 0 })); }
    else if (r.score !== expect) { mis = true; if (hMismatch < 5) console.log('  honest mismatch #' + i, r.score, expect, JSON.stringify(r.reasons)); }
    if (r.verdict === 'review') { rev = true; for (const why of r.reasons) { const k = why.replace(/[0-9.e+-]+/g, '#'); reviewReasons[k] = (reviewReasons[k] || 0) + 1; } if (hReview < 8) console.log('  honest review #' + i, JSON.stringify(r.reasons), 'level', cfg.level.toFixed(2), 'stages', res.score); }
  }
  {
    const r = check(res.log, res.score, plat), st = r.stats;
    const lo = (k, v) => { if (typeof v === 'number' && (cal[k] === undefined || v < cal[k])) cal[k] = v; };
    const hi = (k, v) => { if (typeof v === 'number' && (cal[k] === undefined || v > cal[k])) cal[k] = v; };
    lo('min drawP', Math.min(st.drawXp === undefined ? 1 : +st.drawXp, st.drawVp === undefined ? 1 : +st.drawVp));
    if (st.threatP !== undefined) lo('min threatP', +st.threatP);
    if (st.reactP !== undefined) lo('min reactP', +st.reactP);
    lo('min keyIntervalCv', st.keyIntervalCv);
    if (st.reactFastThreat !== undefined) hi('max react excess', st.reactFastThreat - st.reactFastOther);
    if (st.keyChanges >= 21) lo('min keyIntervalSd', st.keyIntervalSd);
    if (st.closeCalls >= 20) hi('max closeTight share', st.closeTight / st.closeCalls);
    hi('max maxOverlapMs', st.maxOverlapMs);
    hi('max repeatedMeteors', st.repeatedMeteors || 0);
    hi('max resizeBursts', st.resizeBursts || 0);
    if (st.threatsExpected >= 8) lo('min threats/expected', st.threats / st.threatsExpected);
    hi('max grazes', st.grazes);
    if (res.score >= 3) lo('min speedMedian', st.speedMedian);
    if (st.oneFrameHolds !== undefined && st.keyChanges >= 40) hi('max oneFrame share', st.oneFrameHolds / (st.keyChanges / 2));
  }
  if (inv) hInvalid++;
  if (rev) hReview++;
  if (mis) hMismatch++;
  if (res.score >= 4 && honestLogs.length < 60) honestLogs.push({ cfg, res });
}
const reviewRate = hReview / hRuns;
console.log('honest: ' + hRuns + ' runs, invalid ' + hInvalid + ', review ' + hReview + ' (' + (reviewRate * 100).toFixed(2) + '%), score mismatch ' + hMismatch +
  ', max stage ' + maxStage + ', max log ' + maxLogEvents + ' events / ' + Math.round(maxLogBytes / 1024) + ' KB, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
const hist = Object.keys(stagesHist).map(Number).sort((a, b) => a - b).map(k => k + ':' + stagesHist[k]).join(' ');
console.log('  stages reached: ' + hist);
if (Object.keys(reviewReasons).length) console.log('  review reasons: ' + JSON.stringify(reviewReasons));
console.log('  closest honest runs came to the person checks: ' + JSON.stringify(cal));
if (hInvalid) fail('honest runs judged invalid: ' + hInvalid);
if (hMismatch) fail('honest runs with a score mismatch: ' + hMismatch);
if (reviewRate > 0.005) fail('honest review rate ' + (reviewRate * 100).toFixed(2) + '% > 0.5%');
if (honestLogs.length < 20) fail('too few long honest runs for the forgeries: ' + honestLogs.length);

// ── b) forgeries ──────────────────────────────────────────────────────────────
const forg = [];
function expectCaught(name, log, claimed, opts) {
  opts = opts || {};
  const r = check(log, claimed);
  const far = r.score <= Math.floor(claimed / 2) && claimed > 0;
  const ok = r.verdict === 'invalid' || r.verdict === 'review' || far;
  forg.push({ name, verdict: r.verdict + ' (score ' + r.score + ' of ' + claimed + ')' + (r.reasons.length ? ': ' + r.reasons[0] : '') });
  if (!ok) fail('forgery passed: ' + name + ' -> ' + r.verdict + ' ' + r.score + '/' + claimed + ' ' + JSON.stringify(r.stats));
  return r;
}
function longest(k) { return honestLogs.filter(h => !h.res.log.ev.some(e => e[0] === 'Z' || e[0] === 'P')).sort((a, b) => b.res.score - a.res.score)[k || 0]; }
const base = longest(0);
const baseLog = base.res.log, baseScore = base.res.score;
const gIdx = { D: [2], C: [3], B: [3, 4], Z: [2], E: [3] };

// 1. no events + a claim
expectCaught('no events + claim', { v: 1, rv: 1, type: 'yarthul-new', a: 0, env: { w: 900, h: 800, mob: false, ping: 0 }, ev: [] }, 7);
// 2. a claim above the logged stages
expectCaught('claim above the log', cloneLog(baseLog), baseScore + 3);
// 3. honest log, every time x0.5 (wall and game)
{
  const L = cloneLog(baseLog);
  for (const e of L.ev) { e[1] = Math.round(e[1] * 0.5); for (const j of (gIdx[e[0]] || [])) if (typeof e[j] === 'number') e[j] = Math.round(e[j] * 0.5 * 10) / 10; }
  expectCaught('all times x0.5', L, baseScore);
  const L2 = cloneLog(baseLog);
  for (const e of L2.ev) e[1] = Math.round(e[1] * 0.5);
  expectCaught('wall times x0.5', L2, baseScore);
}
// 4. a hit marked as a miss: aim one meteor of stage 2 straight at the flame
{
  const L = cloneLog(baseLog);
  const res = T.check ? null : null;
  // find a meteor in stage 2 and move its x onto the flame's path
  let stageNo = 1, j = 0, accStart = 0, done = false;
  const comp = /-comp$/.test(L.type);
  let W = L.ev[0][2], H = L.ev[0][3];
  // replay the flame's path from D events (no resize in this log is assumed; skip if any)
  const hasZ = L.ev.some(e => e[0] === 'Z');
  const pcs = [{ g: 0, x: W / 2, dir: 0 }];
  const pxAt = g => { let p = pcs[0]; for (const q of pcs) if (q.g <= g) p = q; return clamp(p.x + p.dir * K.PLAYER_SPEED_FRAC * W * (g - p.g) / 1000, GE.platLeft(W), GE.platRight(W)); };
  for (let i = 0; i < L.ev.length && !done; i++) {
    const e = L.ev[i];
    if (e[0] === 'D') pcs.push({ g: e[2], x: pxAt(e[2]), dir: e[3] });
    if (e[0] === 'C') { stageNo++; }
    if (e[0] === 'B') { accStart = e[4]; j = 0; }
    if (e[0] === 'M') {
      j++;
      if (stageNo >= 2 && j === 5 && !hasZ) {
        const iv = T.spawnIntervalMs(stageNo, comp), gs = accStart + j * iv - e[4] / 10;
        const vy = T.fallSpeedFrac(stageNo, comp) * H, r = H * K.METEOR_R_FRAC, y0 = -r * K.SPAWN_Y_R;
        const Tt = (GE.playerY(H) - y0) / vy;
        // the flame's x at the crossing, from the rest of the honest log
        let pcs2 = pcs.slice();
        for (let k = i + 1; k < L.ev.length; k++) { const f = L.ev[k]; if (f[0] === 'D') { if (f[2] > gs + Tt * 1000) break; pcs.push({ g: f[2], x: pxAt(f[2]), dir: f[3] }); } }
        const fx = pxAt(gs + Tt * 1000);
        pcs.length = 0; for (const q of pcs2) pcs.push(q);
        const uv = (e[3] + 0.5) / K.U_SCALE, vx = (uv * 2 - 1) * T.driftFrac(comp) * vy;
        const x0 = fx - vx * Tt;
        const u1 = Math.floor(x0 / W * K.U_SCALE);
        if (u1 >= 0 && u1 < K.U_SCALE) { e[2] = u1; done = true; }
      }
    }
  }
  if (!done) fail('could not build the hit-as-miss forgery');
  expectCaught('a hit marked as a miss (meteor aimed at the flame, no E)', L, baseScore);
}
// 5. targets outside range / wrong count
{
  const L = cloneLog(baseLog); const m = L.ev.find(e => e[0] === 'M'); m[2] = 10000;
  expectCaught('meteor x draw out of range', L, baseScore);
  const L2 = cloneLog(baseLog); const m2 = L2.ev.filter(e => e[0] === 'M')[3]; m2[4] = 900;
  expectCaught('meteor spawned 90 ms into a frame', L2, baseScore);
  const L3 = cloneLog(baseLog); const k3 = L3.ev.findIndex((e, i) => e[0] === 'M' && i > 20); L3.ev.splice(k3, 1);
  expectCaught('one meteor left out', L3, baseScore);
  const L4 = cloneLog(baseLog); const k4 = L4.ev.findIndex((e, i) => e[0] === 'M' && i > 20); L4.ev.splice(k4, 0, L4.ev[k4].slice());
  expectCaught('one meteor too many', L4, baseScore);
  const L5 = cloneLog(baseLog); L5.ev = L5.ev.filter(e => e[0] !== 'M');
  expectCaught('no meteors at all', L5, baseScore);
  const L6 = cloneLog(baseLog); L6.type = /-comp$/.test(L6.type) ? L6.type.slice(0, -5) : L6.type + '-comp';
  expectCaught('replayed under the other mode', L6, baseScore);
}
// 6. cherry-picked targets: a player standing still, meteors aimed at the flame re-drawn
{
  // (a lucky honest best has about 0.6 of the expected aimed meteors, so the
  // test needs a long enough run to tell: 9 stages here)
  const cfg = honestCfg(7); cfg.seed = 99; cfg.cherry = 'x'; cfg.comp = false; cfg.W0 = 900; cfg.quitAfter = 9; cfg.pauses = []; cfg.resize = null; cfg.resizes = null; cfg.frames = FRAME_PROFILES[0].f;
  cfg.controller = () => ({ c: { decide: () => [] }, decMs: 50 });
  const res = simulate(cfg);
  expectCaught('cherry-picked meteors (standing still, ' + res.score + ' stages)', res.log, res.score);
  const cfg2 = honestCfg(11); cfg2.seed = 1234; cfg2.cherry = 'x'; cfg2.quitAfter = 9; cfg2.pauses = []; cfg2.resize = null; cfg2.resizes = null; cfg2.W0 = 800; cfg2.ping = 0; cfg2.mobile = false;
  cfg2.controller = (w, r) => ({ c: makeHuman(makePersona(r, 0.3), r, W => K.PLAYER_SPEED_FRAC * W), decMs: 50 });
  const res2 = simulate(cfg2);
  expectCaught('cherry-picked meteors (a weak player, ' + res2.score + ' stages)', res2.log, res2.score);
}
// 7. perfect bot: sees each meteor the frame it is made, skims it by 1 px
function botRun(seed, comp, opts, quit) {
  const cfg = { seed, comp, W0: 900, ping: 0, mobile: false, frames: FRAME_PROFILES[0].f, negFirst: false, pauses: [], resize: null, quitAfter: quit, maxWall: 900000,
    controller: (w, r) => ({ c: opts.metronome ? makeMetronome(opts.metronome) : makeBot(opts, W => K.PLAYER_SPEED_FRAC * W), decMs: opts.decMs || 16.6667 }) };
  return simulate(cfg);
}
{
  const r1 = botRun(501, false, { margin: 1, lag: 0 }, 8);
  expectCaught('perfect bot, casual (' + r1.score + ' stages, ' + r1.ended + ')', r1.log, r1.score);
  const r2 = botRun(502, true, { margin: 1, lag: 0 }, 8);
  expectCaught('perfect bot, comp (' + r2.score + ' stages, ' + r2.ended + ')', r2.log, r2.score);
  const r3 = botRun(503, false, { margin: 12, lag: 40 }, 8);
  expectCaught('bot reacting in 40 ms with a 12 px margin (' + r3.score + ' stages, ' + r3.ended + ')', r3.log, r3.score);
  const r3b = botRun(504, true, { margin: 25, lag: 60 }, 8);
  expectCaught('bot reacting in 60 ms with a 25 px margin, comp (' + r3b.score + ' stages, ' + r3b.ended + ')', r3b.log, r3b.score);
}
// 8. superhuman reactions: the human model with 40 ms reactions and no error
{
  const cfg = honestCfg(3); cfg.seed = 777; cfg.quitAfter = 8; cfg.pauses = []; cfg.resize = null; cfg.resizes = null; cfg.ping = 0; cfg.mobile = false; cfg.W0 = 900;
  const per = makePersona(mulberry(5), 1); per.rtMean = 40; per.rtSd = 0.05; per.posSd = 0; per.mSd = 0; per.lapseRate = 0; per.motorSd = 0; per.tapNoise = 0; per.decMs = 16;
  per.rtFloor = 30;
  cfg.controller = (w, r) => { const h = makeHuman(per, r, W => K.PLAYER_SPEED_FRAC * W); return { c: { decide: (td, world) => { const ev = h.decide(td, world); for (const e of ev) e.t = td + 1; return ev; } }, decMs: 16 }; };
  const res = simulate(cfg);
  expectCaught('superhuman reactions ~40 ms (' + res.score + ' stages, ' + res.ended + ')', res.log, res.score);
}
// 9. metronome: keys flipped every 400 ms, and meteors re-drawn so it survives
{
  const cfg = { seed: 4242, comp: false, W0: 900, ping: 0, mobile: false, frames: FRAME_PROFILES[0].f, negFirst: false, pauses: [], resize: null, quitAfter: 6, maxWall: 900000, cherry: 'x', cherryPad: 90, cherryStill: true,
    controller: () => ({ c: makeMetronome(150), decMs: 5 }) };
  const res = simulate(cfg);
  expectCaught('metronome bot (150 ms) + meteors re-drawn clear of it (' + res.score + ' stages)', res.log, res.score);
  const cfg2 = Object.assign({}, cfg, { cherry: null, seed: 4243 });
  const res2 = simulate(cfg2);
  const L = cloneLog(base.res.log);
  // an honest log whose key changes were moved onto a 400 ms grid
  let k = 0; for (const e of L.ev) if (e[0] === 'D') { e[2] = 300 + 400 * k++; }
  L.ev.sort((a, b) => a[1] - b[1]);
  expectCaught('honest meteors, keys moved onto a 400 ms grid', L, baseScore);
}
// 10. times fine, order impossible
{
  const L = cloneLog(baseLog); const iC = L.ev.findIndex(e => e[0] === 'C'); const iB = L.ev.findIndex(e => e[0] === 'B');
  const b = L.ev.splice(iB, 1)[0]; L.ev.splice(iC, 0, b); b[1] = L.ev[iC + 1][1];
  expectCaught('a stage begun before the last was cleared', L, baseScore);
  const L2 = cloneLog(baseLog); const iC2 = L2.ev.findIndex(e => e[0] === 'C' && e[2] === 2);
  // move the stage-2 clear ahead of its last three meteors (times kept in order)
  const c2 = L2.ev.splice(iC2, 1)[0]; let at = iC2 - 1, seen = 0; while (seen < 3) { if (L2.ev[at][0] === 'M') seen++; at--; } L2.ev.splice(at + 1, 0, c2); c2[1] = L2.ev[at][1];
  expectCaught('stage cleared before its last meteors', L2, baseScore);
  const L3 = cloneLog(baseLog); const iB3 = L3.ev.findIndex(e => e[0] === 'B'); const m3 = L3.ev.find((e, i) => e[0] === 'M' && i > iB3).slice(); m3[1] = L3.ev[iB3 - 1][1]; L3.ev.splice(iB3, 0, m3);
  expectCaught('a meteor during the stage banner', L3, baseScore);
  const L4 = cloneLog(baseLog); L4.ev.push(['E', L4.ev[L4.ev.length - 1][1], 'abandon']); L4.ev.push(['C', L4.ev[L4.ev.length - 1][1] + 5000, baseScore + 1, 99999999]);
  expectCaught('a stage cleared after the run ended', L4, baseScore + 1);
  const L5 = cloneLog(baseLog); const cs = L5.ev.filter(e => e[0] === 'C'); cs[1][2] = 3;
  expectCaught('stage numbers skip', L5, baseScore);
}
// 10b. slow motion: the same honest log, every wall time tripled
{
  const L = cloneLog(baseLog); for (const e of L.ev) e[1] = e[1] * 3;
  expectCaught('played in slow motion (wall clock x3)', L, baseScore);
}
// 11. a replayed honest log with a higher claim
expectCaught('replayed honest log, claim +1', cloneLog(baseLog), baseScore + 1);
// 12. trainer-specific
{
  const L = cloneLog(baseLog); const d = L.ev.find(e => e[0] === 'D'); d[4] += 80;
  expectCaught('flame teleported (logged x off its path)', L, baseScore);
  const L2 = cloneLog(baseLog); for (const e of L2.ev) if (e[0] === 'M') e[3] = e[2] < 5000 ? 0 : 9999;
  expectCaught('drift steered away from the middle', L2, baseScore);
  const L3 = cloneLog(baseLog); L3.ev.splice(1, 0, ['Z', L3.ev[1][1], 0, 900, 300, 450]);
  expectCaught('resize to a size the canvas never has', L3, baseScore);
  const L4 = cloneLog(baseLog); for (const e of L4.ev) if (e[0] === 'C' || e[0] === 'B') { for (const j of gIdx[e[0]]) e[j] -= 400 * (e[0] === 'C' ? e[2] : e[2] - 1); }
  expectCaught('stages shortened by 400 ms each', L4, baseScore);
  const L5 = cloneLog(baseLog); for (const e of L5.ev) if (e[0] === 'D') e[3] = 0; // every key change nulled (the flame never moves)
  expectCaught('keys removed (flame parked in the middle)', L5, baseScore);
}
// 13. resizes: a flood of them used to switch the collision replay off (every
//     meteor whose fall spanned a resize was skipped). A parked flame, honest
//     draws, a resize every 40 / 100 ms between two widths of the same height.
{
  for (const z of [40, 100]) expectCaught('resize flood every ' + z + ' ms, flame parked (12 stages)', forgeLog({ stages: 12, zEvery: z, seed: 5 }), 12);
  // resize to a small canvas and straight back at the same game time, to have
  // meteors dropped in a canvas no frame ever used
  expectCaught('resize pairs 900->560->900 at one instant, flame parked (12 stages)', forgeLog({ stages: 12, zEvery: 50, zW: 560, zBack: true, seed: 6 }), 12);
  // the same log with no resizes, for scale
  expectCaught('no resizes, flame parked (12 stages)', forgeLog({ stages: 12, seed: 5 }), 12);
  // resizes as a free dodge: the flame teleported by resize clamps
  const tl = forgeLog({ stages: 10, seed: 7, teleport: true });
  expectCaught('flame teleported by resizing whenever a meteor comes (' + tl.teleports + ' times, 10 stages)', tl, 10);
}
// 13b. reused targets: the same 60 meteors over and over, dodged by a person
{
  const cfg = honestCfg(21); cfg.seed = 2121; cfg.drawCycle = 60; cfg.quitAfter = 6; cfg.pauses = []; cfg.resize = null; cfg.resizes = null; cfg.W0 = 900; cfg.mobile = false;
  const per = makePersona(mulberry(21), 0.9);
  cfg.controller = (w, r2) => ({ c: makeHuman(per, r2, W => K.PLAYER_SPEED_FRAC * W), decMs: per.decMs });
  const res = simulate(cfg);
  const r = expectCaught('the same 60 meteors reused (' + res.score + ' stages)', res.log, res.score);
  if (res.score >= 2 && !r.reasons.some(x => /repeat/.test(x))) fail('reused meteors not named: ' + JSON.stringify(r.reasons));
}
// 14. pauses as cover: slow motion (wall clock x3) with every stage marked as
//     hidden, while its frames kept running
{
  const L = cloneLog(baseLog);
  for (const e of L.ev) e[1] = e[1] * 3;
  const out = [];
  for (let i = 0; i < L.ev.length; i++) {
    const e = L.ev[i];
    if (e[0] === 'C') out.push(['U', e[1]]);
    out.push(e);
    if ((e[0] === 'S' || e[0] === 'B') && i + 1 < L.ev.length) out.push(['P', e[1]]);
  }
  L.ev = out;
  expectCaught('slow motion (x3) with every stage marked hidden', L, baseScore);
}
// 15. the log-full marker: a truncated log proves what it holds; nothing may follow 'X'
{
  const L = cloneLog(baseLog);
  const iC = L.ev.findIndex(e => e[0] === 'C' && e[2] === 5);
  L.ev = L.ev.slice(0, iC + 40); L.ev.push(['X', L.ev[L.ev.length - 1][1]]);
  const r = check(L, baseScore);
  if (r.verdict === 'invalid' || r.score !== 5) fail('log ending in X: ' + r.verdict + ' ' + r.score + ' ' + JSON.stringify(r.reasons));
  const L2 = cloneLog(L); L2.ev.push(['C', L2.ev[L2.ev.length - 1][1] + 10, 6, 99999]);
  expectCaught('a stage cleared after X', L2, 6);
}

console.log('forgeries: ' + forg.length + ' built, ' + forg.filter(f => !/^valid/.test(f.verdict) || / \(score 0 of [1-9]/.test(f.verdict)).length + ' caught');
for (const f of forg) console.log('  ' + f.name + ' -> ' + f.verdict);

// ── long runs: structure only ──────────────────────────────────────────────────
// A script that also re-draws meteors aimed at it survives as long as asked: its
// logs are held for review, but must never be invalid and must prove every stage.
{
  const t2 = Date.now();
  const longs = [
    { comp: true, W0: 900, frames: { period: 1000 / 144, jitter: 0.04, dropP: 0.01 }, pauses: [{ at: 90000, dur: 8000 }], resize: { at: 200000, W: 700 } },
    { comp: false, W0: 390, frames: { period: 1000 / 30, jitter: 0.08, dropP: 0.02 }, pauses: [], resize: null, mobile: true },
    { comp: true, W0: 640, frames: { period: 1000 / 60, jitter: 0.02, dropP: 0.003, q: 100 }, pauses: [], resize: null },
  ];
  let bad = 0, maxKB = 0, maxEv = 0, maxSt = 0;
  longs.forEach((l, i) => {
    const cfg = Object.assign({ seed: 606 + i, ping: 0, negFirst: true, quitAfter: 35, maxWall: 3.6e6, cherry: 'x', cherryPad: 30,
      controller: () => ({ c: makeBot({ margin: 8, lag: 0 }, W => K.PLAYER_SPEED_FRAC * W), decMs: 16.67 }) }, l);
    const res = simulate(cfg);
    const r = check(res.log, res.score, l.mobile ? 'M' : 'C');
    const kb = JSON.stringify(res.log).length / 1024;
    if (kb > maxKB) maxKB = kb; if (res.log.ev.length > maxEv) maxEv = res.log.ev.length; if (res.score > maxSt) maxSt = res.score;
    if (r.verdict === 'invalid' || r.score !== res.score || res.score < 30) { bad++; console.log('  long run', i, res.score, r.verdict, r.score, JSON.stringify(r.reasons.slice(0, 2))); }
  });
  console.log('long runs: ' + longs.length + ' runs to stage ' + maxSt + ', invalid/mismatch ' + bad + ', largest log ' + maxEv + ' events / ' + Math.round(maxKB) + ' KB, ' + ((Date.now() - t2) / 1000).toFixed(1) + ' s');
  if (bad) fail('long runs judged invalid or mis-scored: ' + bad);
}

// ── honest edge cases ─────────────────────────────────────────────────────────
// A restless player: a key change every 25-90 ms for 20+ stages (meteors aimed
// at the flame re-drawn so it lives that long; that part is held for review).
// The flame's path must not drift from the logged x: 0.1 ms rounding of
// thousands of key times used to add up (random walk) past the 2 px limit.
{
  const cfg = { seed: 8080, comp: false, W0: 900, ping: 0, mobile: false, frames: FRAME_PROFILES[2].f, negFirst: true, pauses: [], resize: null,
    quitAfter: 22, maxWall: 3.6e6, cherry: 'x', cherryBand: [400, 500], cherryPad: 10,
    controller: (world, rng) => {
      let intent = 0, next = 300;
      return { decMs: 10, c: { decide(td) {
        if (td < next) return [];
        next = td + uni(rng, 25, 90);
        const g = world.gameAt(td), px = g === null ? 450 : world.pxAt(g);
        // jiggle inside 420..480 (the band the meteors leave clear), never at an edge
        let to = px < 425 ? 1 : px > 475 ? -1 : (rng() < 0.5 ? -1 : 1);
        if (rng() < 0.3) to = 0;
        if (to === intent) return [];
        const out = [];
        if (intent !== 0) out.push({ t: td + 1, key: intent < 0 ? 'L' : 'R', down: false });
        if (to !== 0) out.push({ t: td + 2, key: to < 0 ? 'L' : 'R', down: true });
        intent = to; return out;
      } } };
    } };
  const res = simulate(cfg);
  const r = check(res.log, res.score);
  const nD = res.log.ev.filter(e => e[0] === 'D').length;
  // how far the old reconstruction (never re-anchored) would have drifted
  let W = res.log.ev[0][2], p = { g: 0, x: W / 2, dir: 0 }, drift = 0, edge = 0;
  const at = g => clamp(p.x + p.dir * K.PLAYER_SPEED_FRAC * W * (g - p.g) / 1000, GE.platLeft(W), GE.platRight(W));
  for (const e of res.log.ev) if (e[0] === 'D') { const w = at(e[2]); drift = Math.max(drift, Math.abs(w - e[4])); if (Math.abs(e[4] - GE.platLeft(W)) < 1 || Math.abs(e[4] - GE.platRight(W)) < 1) edge++; p = { g: e[2], x: w, dir: e[3] }; }
  console.log('restless player: ' + res.score + ' stages, ' + nD + ' key changes (' + edge + ' at an edge), -> ' + r.verdict + ' ' + r.score + (r.stats.stoppedAt ? ' STOPPED ' + r.stats.stoppedAt : '') + '; unanchored path drift ' + drift.toFixed(2) + ' px');
  if (r.verdict === 'invalid' || r.score !== res.score || r.stats.stoppedAt) fail('restless player cut short: ' + r.verdict + ' ' + r.score + '/' + res.score + ' ' + JSON.stringify(r.reasons));
  if (nD < 4000) fail('restless player made too few key changes to test drift: ' + nD);
}
// A lucky personal best: of a weak player's thousands of runs the best one had
// fewer deadly meteors than usual. Model: 60% of the meteors aimed at the flame
// re-drawn. Must not be held for "too few aimed meteors".
{
  let held = 0, worst = 1;
  for (let s = 0; s < 6; s++) {
    const cfg = honestCfg(40 + s); cfg.seed = 3100 + s; cfg.cherry = 'x'; cfg.cherryP = 0.6; cfg.quitAfter = 30; cfg.pauses = []; cfg.resize = null; cfg.resizes = null;
    cfg.W0 = s % 2 ? 900 : 480; cfg.mobile = false; cfg.comp = s % 3 === 0;
    const per = makePersona(mulberry(77 + s), 0.85);
    cfg.controller = (w, r2) => ({ c: makeHuman(per, r2, W => K.PLAYER_SPEED_FRAC * W), decMs: per.decMs });
    const res = simulate(cfg);
    const r = check(res.log, res.score);
    if (r.stats.threatP !== undefined) worst = Math.min(worst, +r.stats.threatP);
    console.log('  lucky best: ' + res.score + ' stages, ' + r.stats.threats + ' aimed of ' + (+r.stats.threatsExpected).toFixed(1) + ' expected, p ' + r.stats.threatP + ' -> ' + r.verdict);
    if (r.reasons.some(x => /aimed at the flame/.test(x))) { held++; console.log('  lucky best held', res.score, JSON.stringify(r.reasons)); }
  }
  console.log('lucky personal bests (60% of aimed meteors missing): 6 runs, held ' + held + ', lowest threat p ' + worst.toExponential(1));
  if (held) fail('lucky personal bests held for review: ' + held);
}

// ── c) the real IIFE in a stub DOM, played by the same simulated people ─────
{
  const t1 = Date.now();
  const variants = [];
  for (let i = 0; i < 40; i++) {
    const r = mulberry(31337 + i);
    variants.push({
      seed: 777 + i, comp: i % 2 === 1, W0: pick(r, [900, 800, 640, 480, 360]), level: 0.4 + 0.6 * r(),
      period: pick(r, [1000 / 60, 1000 / 60, 1000 / 144, 1000 / 30]), ping: pick(r, [0, 0, 150, 300]),
      pauseAt: r() < 0.3 ? 2000 + r() * 20000 : 0, pauseDur: 500 + r() * 5000,
      resizeAt: r() < 0.2 ? 1000 + r() * 20000 : 0, resizeW: pick(r, [900, 700, 520]),
      mobile: i % 7 === 3, maxMs: 240000,
    });
  }
  let pk = 0, pkBad = 0, pkMis = 0, pkRev = 0, runs = 0, stagesMax = 0;
  for (const v of variants) {
    const out = runIife(v);
    runs++;
    for (const p of out.packets) {
      pk++;
      if (p.type !== 'yarthul-new' + (v.comp ? '-comp' : '')) { pkBad++; console.log('  iife: wrong type ' + p.type); continue; }
      const r = Q.check(p.type, p.log, { platform: 'C', claimed: p.score });
      if (r.score > stagesMax) stagesMax = r.score;
      if (r.verdict === 'invalid') { pkBad++; if (pkBad < 5) console.log('  iife packet invalid', JSON.stringify(r.reasons), JSON.stringify(v)); }
      else if (r.score !== p.score) { pkMis++; if (pkMis < 5) console.log('  iife packet mismatch', r.score, p.score, JSON.stringify(r.reasons)); }
      if (r.verdict === 'review') { pkRev++; console.log('  iife packet review', JSON.stringify(r.reasons)); }
    }
    // the whole final log too
    const fl = out.finalLog;
    const last = out.packets.length ? out.packets[out.packets.length - 1].score : 0;
    const rf = Q.check(fl.type, fl, { platform: 'C', claimed: last });
    if (rf.verdict === 'invalid' || rf.score !== last) { pkBad++; console.log('  iife final log', rf.verdict, rf.score, last, JSON.stringify(rf.reasons)); }
    const endEv = fl.ev[fl.ev.length - 1];
    if (!endEv || endEv[0] !== 'E') { pkBad++; console.log('  iife log does not end with E', JSON.stringify(endEv)); }
  }
  // A long run past the log's size budget (shrunk here to 12 KB): the IIFE ends
  // the log with 'X' and plays on; later submits carry the full log and claim
  // more than it proves. They must count what it proves, never be rejected.
  {
    const saved = K.LOG_BUDGET;
    K.LOG_BUDGET = 12000;
    let sawX = 0, after = 0, xBad = 0;
    try {
      for (let s = 0; s < 4; s++) {
        const out = runIife({ seed: 9100 + s, comp: s % 2 === 1, W0: 900, level: 1, period: 1000 / 60, ping: 0, pauseAt: 0, resizeAt: 0, mobile: false, maxMs: 240000 });
        const fl = out.finalLog, last = fl.ev[fl.ev.length - 1];
        if (last && last[0] === 'X') sawX++;
        const bytes = JSON.stringify(fl.ev).length;
        if (bytes > 12000 + 200) { xBad++; console.log('  log over its budget: ' + bytes); }
        for (const p of out.packets) {
          const r = Q.check(p.type, p.log, { platform: 'C', claimed: p.score });
          const proven = p.log.ev.filter(e => e[0] === 'C').length;
          if (r.verdict === 'invalid' || r.score !== Math.min(p.score, proven)) { xBad++; console.log('  over-budget packet', p.score, r.verdict, r.score, proven, JSON.stringify(r.reasons)); }
          if (p.score > proven) after++;
        }
      }
    } finally { K.LOG_BUDGET = saved; }
    console.log('iife past the log budget: ' + sawX + ' of 4 logs ended in X, ' + after + ' submits after it, bad ' + xBad);
    if (xBad) fail('submits past the log budget mis-judged: ' + xBad);
    if (!sawX || !after) fail('the log-budget test never reached the budget');
  }
  console.log('iife: ' + runs + ' runs of the real IIFE, ' + pk + ' submits checked, invalid ' + pkBad + ', mismatch ' + pkMis + ', review ' + pkRev + ', max stage ' + stagesMax + ', ' + ((Date.now() - t1) / 1000).toFixed(1) + ' s');
  if (pkBad) fail('real IIFE produced logs the check rejects: ' + pkBad);
  if (pkMis) fail('real IIFE score mismatches: ' + pkMis);
  if (pk < 20) fail('real IIFE runs produced too few submits: ' + pk);
}

if (failures) { console.log('FAILED: ' + failures); process.exit(1); }
console.log('ALL PASS');

}

module.exports = { Q, T, K, GE, mulberry, gauss, uni, pick, makePersona, makeHuman, makeBot, makeMetronome, simulate, honestCfg, FRAME_PROFILES, check, sliceLog, cloneLog, runIife, logWorld };
if (require.main === module) main();
