// node thorian-new.test.js
// a) honest players simulated from the rules with the IIFE's exact state
//    machine and log calls; b) forgeries; c) exit 1 on any failure.
'use strict';
require('./_paths.js');
const Q = require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const R = Q.trainers['thorian-new'];

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

// ── the trainer, as the IIFE runs it, driven by a simulated player ──────────
// o: { seed, comp, W, skill, hz, dropP, stallP, pauses:[{at,dur,resizeW,releaseInPause}],
//      midResize:[{at,W}], maxRounds, mob, ping, bot:{...} , purpleP, mulDraw, gapDraw }
function simulate(o) {
  const rng = mulberry32(o.seed);                 // the game's Math.random
  const pr = mulberry32((o.seed * 7919 + 13) | 0); // player, frames
  const type = 'thorian-new' + (o.comp ? '-comp' : '');
  const log = { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: o.W + 48, h: 820, mob: !!o.mob, ping: o.ping | 0 }, ev: [] };
  let wall = 0, closed = false, logBytes = 0;
  function ev(code) {
    if (closed || logBytes > R.LOG_BUDGET) return;
    const e = [code, Math.max(0, Math.round(wall))];
    for (let i = 1; i < arguments.length; i++) { const f = arguments[i]; e.push(typeof f === 'number' ? Math.round(f * 10000) / 10000 : f); }
    if (log.ev.length < Q.LIMITS.MAX_EVENTS) { log.ev.push(e); logBytes += JSON.stringify(e).length + 1; }
  }

  let W = Math.min(o.W, 900), H = R.canvasH(W);
  let targets = [], yellows = [], held = null, dragOX = 0, dragOY = 0;
  let running = false, gameStarted = false, paused = false;
  let score = 0, round = 1, lives = R.LIVES, gameTimer = R.GAME_SECS, spawnTimer = 0, yellowSpawnTimer = 0;
  let lastTime = 0, transitioning = false, transitionTimer = 0;
  let gameT = 0, lastDt = 0, orbN = 0, yelN = 0;
  let over = false, stop = false;
  const snaps = [];
  const gMs = () => R.ms(gameT), dMs = () => R.ms(lastDt);
  const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

  function resizeCanvas(w) {
    const pw = W, ph = H;
    W = Math.min(w, 900); H = R.canvasH(W);
    if (W !== pw || H !== ph) ev('Z', W, H);
  }
  function spawnTarget() {
    const used = new Set(targets.map(t => t.col));
    const free = [0, 1, 2, 3, 4].filter(c => !used.has(c));
    if (!free.length) return null;
    let col = free[Math.floor(rng() * free.length)];
    if (o.colBias && rng() < o.colBias) {
      // a modified client: put the orb in a column through a resting diamond
      const easy = free.filter(c => yellows.some(y => y !== held && Math.abs(y.x - R.colX(W, c)) < R.DROP_R));
      if (easy.length) col = easy[Math.floor(rng() * easy.length)];
    }
    const u1 = rng(), purple = o.purpleP != null ? u1 < o.purpleP : R.isPurple(u1);
    const mul = o.mulDraw ? o.mulDraw(rng()) : R.orbMul(rng());
    const t = { x: R.colX(W, col), y: R.spawnY(H), col, type: purple ? 'purple' : 'red', vy: -R.orbSpeed(round, o.comp) * mul, mul, k: orbN++ };
    targets.push(t); return t;
  }
  function spawnYellow() {
    const used = new Set(yellows.map(y => y.col));
    const free = [0, 1, 2, 3, 4].filter(c => !used.has(c));
    if (!free.length) return null;
    const col = free[Math.floor(rng() * free.length)];
    const y = R.yelY(H, rng());
    const yl = { x: R.colX(W, col), y, col, life: o.lifeDraw ? o.lifeDraw(rng()) : R.yelLife(rng()), j: yelN++, born: wall };
    yl.life0 = yl.life; yellows.push(yl); return yl;
  }
  function onRoundComplete() {
    score++; round++; transitioning = true; transitionTimer = R.TRANSITION_S;
    ev('C', gMs(), dMs(), score);
    snaps.push({ len: log.ev.length, score });
    if (score >= o.maxRounds) stop = true;
  }
  function onGameOver(why) {
    running = false; ev('E', why, gMs()); closed = true; over = true;
  }
  function gameLoop(now) {
    if (!running) return;
    const dt = Math.min(Math.max(0, now - lastTime) / 1000, R.DT_MAX);
    if (now > lastTime) lastTime = now;
    gameT += dt; lastDt = dt;
    if (transitioning) {
      transitionTimer -= dt;
      if (transitionTimer <= 0) {
        transitioning = false; gameTimer = R.GAME_SECS; lives = R.LIVES;
        targets = []; yellows = []; held = null; spawnTimer = 0; yellowSpawnTimer = 0;
        ev('R', gMs(), dMs(), round);
      } else return;
    }
    gameTimer -= dt;
    if (gameTimer <= 0) { onRoundComplete(); return; }
    spawnTimer -= dt;
    if (spawnTimer <= 0 && targets.length < R.MAX_TARGETS) {
      const t = spawnTarget();
      spawnTimer = o.gapDraw ? o.gapDraw(rng()) : R.orbGap(rng());
      if (t) ev('O', gMs(), dMs(), t.col, t.type === 'purple' ? 1 : 0, t.mul, spawnTimer);
    }
    yellowSpawnTimer -= dt;
    if (yellowSpawnTimer <= 0 && yellows.length < R.MAX_YELLOWS) {
      const y = spawnYellow();
      yellowSpawnTimer = R.yelGap(rng());
      if (y) ev('Y', gMs(), dMs(), y.col, y.y, y.life0, yellowSpawnTimer);
    }
    targets = targets.filter(t => {
      t.y += t.vy * dt;
      if (t.y < R.ESC_Y) {
        ev('X', gMs(), t.k);
        if (t.type === 'purple') { lives--; if (lives <= 0) { onGameOver('X'); return false; } }
        return false;
      }
      return true;
    });
    yellows = yellows.filter(y => {
      if (y === held) return true;
      y.life -= dt;
      if (y.life > 0) return true;
      ev('V', gMs(), y.j); return false;
    });
  }
  function tryStartDrag(pos) {
    if (!gameStarted || !running || held) return false;
    for (const y of yellows) {
      if (dist2(pos.x, pos.y, y.x, y.y) < R.GRAB_R2) {
        held = y; dragOX = pos.x - y.x; dragOY = pos.y - y.y;
        ev('G', gMs(), y.j, R.px(pos.x), R.px(pos.y));
        return true;
      }
    }
    return false;
  }
  function moveDrag(pos) {
    if (!held) return;
    held.x = Math.max(R.PLAYER_R, Math.min(W - R.PLAYER_R, pos.x - dragOX));
    held.y = Math.max(R.PLAYER_R, Math.min(H - R.PLAYER_R, pos.y - dragOY));
  }
  function releaseDrag() {
    if (!held) return;
    const hx = R.px(held.x), hy = R.px(held.y);
    let hit = false;
    targets = targets.filter(t => {
      if (hit) return true;
      if (dist2(held.x, held.y, t.x, t.y) < R.DROP_R2) {
        hit = true;
        ev('L', gMs(), hx, hy, t.k);
        const hh = held;
        yellows = yellows.filter(y => y !== hh); held = null;
        if (t.type === 'red') onGameOver('D');
        return false;
      }
      return true;
    });
    if (held) { ev('L', gMs(), hx, hy, -1); held = null; }
  }
  function mouseLeave() { if (held) ev('D', gMs(), R.px(held.x), R.px(held.y)); held = null; }
  function hide() { if (paused) return; if (gameStarted && running) { running = false; paused = true; ev('P', gMs()); } }
  function resume() { if (!paused) return; paused = false; running = true; ev('U', gMs()); firstFrame = true; }

  // ── the player ──
  const sk = o.skill, B = o.bot || null;
  const P = {
    rtMed: B && B.rt != null ? B.rt : 330 - 110 * sk, rtSig: B ? (B.rtSig || 0) : 0.3 - 0.1 * sk,
    planMed: B && B.plan != null ? B.plan : 210 - 80 * sk, planSig: B ? (B.rtSig || 0) : 0.25,
    fA: B && B.fA != null ? B.fA : 70, fB: B && B.fB != null ? B.fB : 170 - 90 * sk,
    sClick: B && B.sClick != null ? B.sClick : 9 - 4 * sk,
    sPos: B && B.sPos != null ? B.sPos : 13 - 7 * sk,
    sT: B && B.sT != null ? B.sT : 45 - 25 * sk,
    leaveP: B ? 0 : 0.004, hesitP: B ? 0 : 0.03,
    // Tapping in place: click a diamond as a purple orb rises through it.
    tapPref: B && B.tapPref != null ? B.tapPref : (o.tapPref || 0),
    sTap: B && B.sTap != null ? B.sTap : (o.sTap != null ? o.sTap : 60 - 45 * sk),
    clickMed: B && B.click != null ? B.click : (o.clickMed || 85),
    aimFrac: B ? 1 : (o.aimFrac != null ? o.aimFrac : 0.5),   // 1: times the release, 0: times the press
  };
  const fitts = d => P.fA + P.fB * Math.log2(1 + d / 40);
  let px = W / 2, py = H / 2, act = null, lastActAt = 0;
  function at(delay) { // when the next action happens
    if (B && B.cadence) { lastActAt = Math.max(lastActAt + B.cadence, wall + 1); return lastActAt; }
    return wall + delay;
  }
  function decide() {
    if (act || !running || paused || over) return;
    if (transitioning) {
      if (held && pr() < 0.004) act = { type: 'here', at: wall + uni(pr, 150, 400) };
      return;
    }
    if (!held && P.tapPref > 0 && pr() < P.tapPref) {
      let bestT = null, bestAt = Infinity;
      for (const y of yellows) {
        for (const t of targets) {
          if (t.type !== 'purple' || Math.abs(t.x - y.x) > 25 || t.y <= y.y) continue;
          const tr = (t.y - y.y) / -t.vy * 1000;       // ms until it is centred on the diamond
          const reach = (B ? P.rtMed : lognorm(pr, P.rtMed, P.rtSig)) + fitts(Math.hypot(y.x - px, y.y - py));
          if (tr < reach + 60 || y.life * 1000 < tr + 150) continue;
          if (tr < bestAt) { bestAt = tr; bestT = { y, t }; }
        }
      }
      if (bestT) {
        const cd = B ? P.clickMed : lognorm(pr, P.clickMed, 0.3);
        act = { type: 'tapdown', y: bestT.y, cd, at: wall + bestAt - cd * P.aimFrac + gauss(pr) * P.sTap };
        return;
      }
    }
    if (!held && o.spam && pr() < 0.7) {
      // a nervous clicker: clicks the diamond under the pointer again and again
      let near = null, nd = 1e9;
      for (const y of yellows) { const d = Math.hypot(y.x - px, y.y - py); if (d < nd) { nd = d; near = y; } }
      if (near) { act = { type: 'tapdown', y: near, cd: lognorm(pr, 70, 0.3), at: wall + uni(pr, 90, 220) }; return; }
    }
    if (!held) {
      let best = null, bd = 1e9;
      for (const y of yellows) {
        if (y.life < 0.35) continue;
        const d = Math.hypot(y.x - px, y.y - py);
        if (d < bd) { bd = d; best = y; }
      }
      if (!best) return;
      let delay = lognorm(pr, P.rtMed, P.rtSig) + fitts(bd);
      if (pr() < P.hesitP) delay += uni(pr, 200, 1500);
      act = { type: 'grab', y: best, at: at(delay) };
    } else {
      let best = null, bt = 1e9;
      for (const t of targets) {
        if (t.type !== 'purple') continue;
        const left = (t.y - R.ESC_Y) / -t.vy * 1000;
        const need = P.planMed + fitts(Math.hypot(t.x - held.x, t.y - held.y)) + 80;
        if (left < need) continue;
        if (left < bt) { bt = left; best = t; }
      }
      if (!best) return;
      const delay = lognorm(pr, P.planMed, P.planSig) + fitts(Math.hypot(best.x - held.x, best.y - held.y));
      act = { type: 'release', o: best, at: at(delay), park: !!o.tapOnly };
    }
  }
  function doAct() {
    const a = act; act = null;
    if (!running && a.type !== 'here') return;
    if (a.type === 'wait') return;
    if (a.type === 'grab') {
      const aim = a.y;
      px = aim.x + gauss(pr) * P.sClick; py = aim.y + gauss(pr) * P.sClick;
      if (!tryStartDrag({ x: px, y: py })) act = { type: 'wait', at: wall + uni(pr, 60, 160) };
      return;
    }
    if (a.type === 'here') { if (held) releaseDrag(); return; }
    if (a.type === 'tapdown') {
      px = a.y.x + gauss(pr) * P.sClick; py = a.y.y + gauss(pr) * P.sClick;
      // o.hwTap: a touchpad with tap-to-click sends down and up together
      if (tryStartDrag({ x: px, y: py })) act = { type: 'tapup', at: wall + (o.hwTap ? uni(pr, 0, 1.5) : Math.max(8, a.cd)) };
      else act = { type: 'wait', at: wall + uni(pr, 60, 160) };
      return;
    }
    if (a.type === 'tapup') {
      if (!held) return;
      if (!B && pr() < 0.5) moveDrag({ x: px + gauss(pr) * 1.5, y: py + gauss(pr) * 1.5 });   // the hand jiggles
      releaseDrag();
      return;
    }
    // release onto the target orb as it is drawn now, with a person's error
    if (!held) return;
    const t = a.o;
    if (targets.indexOf(t) < 0) return;           // it is gone: pick again
    let ex = gauss(pr) * P.sPos, ey = gauss(pr) * P.sPos + gauss(pr) * P.sT / 1000 * t.vy;
    if (a.park) {
      // park the diamond in the orb's column ahead of it, to tap it later
      ex = gauss(pr) * 3; ey = t.vy * uni(pr, 0.5, 1.2);
      if (t.y + ey < R.PLAYER_R + 5) return;
      if (targets.some(u => Math.hypot(u.x - (t.x + ex), u.y - (t.y + ey)) < R.DROP_R + 4)) return;
    }
    px = t.x + ex + dragOX; py = t.y + ey + dragOY;
    moveDrag({ x: px, y: py });
    if (pr() < P.leaveP) mouseLeave(); else releaseDrag();
  }

  // ── frames, pauses, resizes ──
  const pauses = (o.pauses || []).slice().sort((a, b) => a.at - b.at);
  const resizes = (o.midResize || []).slice().sort((a, b) => a.at - b.at);
  let firstFrame = true, doubleChain = !!o.doubleChain;
  const frameMs = 1000 / o.hz;
  function nextInterval() {
    let iv = frameMs * (1 + gauss(pr) * 0.03);
    if (pr() < o.dropP) iv *= uni(pr, 2, 4);
    if (pr() < o.stallP) iv += uni(pr, 150, 4000);   // tab in the background, no pause
    return Math.max(1, iv);
  }
  // Start
  ev('Z', W, H); ev('R', gMs(), dMs(), round);
  gameStarted = true; running = true;
  let nextFrame = uni(pr, 1, frameMs);
  const MAX_WALL = (o.maxRounds + 2) * 17000 + 200000;
  while (!over && !stop && wall < MAX_WALL) {
    const tAct = act ? act.at : Infinity;
    const tPause = pauses.length ? pauses[0].at : Infinity;
    const tRes = resizes.length ? resizes[0].at : Infinity;
    if (tPause <= nextFrame && tPause <= tAct && tPause <= tRes) {
      const p = pauses.shift();
      wall = Math.max(wall, p.at);
      if (!running) continue;
      hide(); act = null; doubleChain = false;
      if (held && p.releaseInPause) { wall += uni(pr, 5, 40); moveDrag({ x: held.x + dragOX + gauss(pr) * 20, y: held.y + dragOY + gauss(pr) * 20 }); releaseDrag(); }
      if (over) break;
      wall += p.dur;
      if (p.resizeW) resizeCanvas(p.resizeW);
      wall += uni(pr, 200, 1200);
      resume();
      nextFrame = wall + uni(pr, 1, frameMs);
      continue;
    }
    if (tRes <= nextFrame && tRes <= tAct) {
      const z = resizes.shift(); wall = Math.max(wall, z.at);
      if (running) resizeCanvas(z.W);
      continue;
    }
    if (tAct < nextFrame) { wall = Math.max(wall, tAct); doAct(); continue; }
    const ts = nextFrame;
    wall = Math.max(wall, ts + uni(pr, 0.1, 2.5));
    if (running) {
      // o.doubleChain: a second rAF chain left over from an earlier Start (see
      // notes): the stale chain runs first each frame, the live one second
      // with the same stamp (dt = 0). A pause cancels one of the two.
      if (doubleChain && firstFrame) { lastTime = ts - uni(pr, 5, 80); gameLoop(ts); }
      if (firstFrame) { lastTime = ts; firstFrame = false; }
      gameLoop(ts);
      if (doubleChain) gameLoop(ts);
      decide();
    }
    nextFrame = ts + nextInterval();
  }
  return { log, score, snaps, over };
}

// ── run configs ──
function honestConfig(i) {
  const rng = mulberry32(1000003 * (i + 1));
  const skill = Math.pow(rng(), 0.7);                 // new .. top of the board
  const W = pick(rng, [320, 360, 390, 412, 600, 768, 820, 900, 900, 900]);
  const hz = pick(rng, [60, 60, 60, 60, 60, 120, 144, 30, 75]);
  const pauses = [];
  if (rng() < 0.25) {
    const n = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) pauses.push({ at: uni(rng, 500, 120000), dur: uni(rng, 300, 30000), resizeW: rng() < 0.35 ? pick(rng, [360, 600, 900, 1100, 500]) : 0, releaseInPause: rng() < 0.3 });
  }
  const midResize = rng() < 0.05 ? [{ at: uni(rng, 1000, 60000), W: pick(rng, [400, 700, 900]) }] : [];
  if (i % 10 === 9) {
    // a pure tapper with rhythm-game timing: never drags, clicks the diamond as
    // a purple orb passes through it (the slowest orbs give pixel-tight drops)
    return {
      seed: (i * 2654435761) | 0, comp: rng() < 0.7, W, skill: 0.7 + 0.3 * rng(), hz, dropP: uni(rng, 0.002, 0.02), stallP: 0,
      pauses, midResize: [], maxRounds: 40, mob: W < 500, ping: 0, doubleChain: false,
      tapPref: 1, tapOnly: true, clickMed: uni(rng, 30, 110), sTap: uni(rng, 7, 30), aimFrac: uni(rng, 0.6, 1),
      hwTap: rng() < 0.4,   // tap-to-click touchpad: 0-1.5 ms "holds"
    };
  }
  return {
    seed: (i * 2654435761) | 0, comp: rng() < 0.5, W, skill, hz,
    dropP: hz === 30 ? 0.05 : uni(rng, 0.002, 0.02), stallP: rng() < 0.2 ? 0.0005 : 0,
    pauses, midResize, maxRounds: 3 + Math.floor(rng() * 38), mob: W < 500, ping: pick(rng, [0, 150, 300]), doubleChain: rng() < 0.03,
    tapPref: pick(rng, [0, 0, 0.5, 0.5, 0.8, 0.95]), clickMed: rng() < 0.15 ? uni(rng, 30, 45) : uni(rng, 60, 120),
    sTap: rng() < 0.1 ? uni(rng, 8, 14) : undefined, aimFrac: rng(),
    tapOnly: false, spam: rng() < 0.06,
    hwTap: rng() < 0.1,
  };
}

function check(log, claimed) {
  const comp = /-comp$/.test(log.type);
  return Q.check(log.type, log, { comp, platform: log.env.mob ? 'M' : 'C', claimed });
}
function cut(log, len) { return { v: log.v, rv: log.rv, type: log.type, a: log.a, env: log.env, ev: log.ev.slice(0, len) }; }
function clone(log) { return JSON.parse(JSON.stringify(log)); }

// ── a) honest ────────────────────────────────────────────────────────────────
const N = 2400;
let inv = 0, rev = 0, mism = 0, runs = 0, maxScore = 0, sumScore = 0, maxBytes = 0, maxEvents = 0;
const scoreHist = {};
const feat = { pause: 0, relInPause: 0, relInTrans: 0, resizeMid: 0, leave: 0, redEnd: 0, escEnd: 0, stall: 0, dZeroSpawn: 0, doubleChain: 0, comp: 0, maxRoundsHit: 0 };
function features(cfg, out) {
  const ev = out.log.ev; let p = false, tr = false, z = 0;
  if (cfg.doubleChain) feat.doubleChain++; if (cfg.comp) feat.comp++; if (!out.over) feat.maxRoundsHit++;
  if (ev.some(e => e[0] === 'P')) feat.pause++;
  for (const e of ev) {
    if (e[0] === 'P') p = true; if (e[0] === 'U') p = false; if (e[0] === 'C') tr = true; if (e[0] === 'R') tr = false;
    if (e[0] === 'L' && p) feat.relInPause++; if (e[0] === 'L' && tr && !p) feat.relInTrans++;
    if (e[0] === 'Z') z++; if (e[0] === 'D') feat.leave++;
    if ((e[0] === 'O' || e[0] === 'Y') && e[3] === 0 && e[2] > 0) feat.dZeroSpawn++;
    if (e[0] === 'E') { if (e[2] === 'D') feat.redEnd++; else feat.escEnd++; }
  }
  if (z > 1) feat.resizeMid++;
  if (cfg.stallP > 0) feat.stall++;
}
const samples = [];
// closest honest approach to each review threshold
const near = { tauMin: 1e9, grabFastMax: 0, farFastMax: 0, longDragFastMax: 0, dragMedMax: 0, clusterMax: 0, sdMin: 1e9, pMin: 1, clampedMax: 0 };
function margins(r) {
  const st = r.stats; if (r.verdict === 'invalid') return;
  if (st.nCatch >= R.PERSON.ACC_N) near.tauMin = Math.min(near.tauMin, st.offMeanMs);
  if (st.nGrab >= R.PERSON.MIN_N) near.grabFastMax = Math.max(near.grabFastMax, st.grabFastShare);
  if (st.nFar >= R.PERSON.FAR_N) near.farFastMax = Math.max(near.farFastMax, st.farFastShare);
  if (st.nLongDrag >= R.PERSON.MIN_N) near.longDragFastMax = Math.max(near.longDragFastMax, st.longDragFastShare);
  if (st.nCatch >= R.PERSON.MIN_N) near.dragMedMax = Math.max(near.dragMedMax, st.dragMed);
  near.clusterMax = Math.max(near.clusterMax, st.clusterMax); if (st.sdMin < 1e9) near.sdMin = Math.min(near.sdMin, st.sdMin);
  if (st.drawPMinLog10 != null) near.pMin = Math.min(near.pMin, Math.pow(10, st.drawPMinLog10));
  if (st.clampedShare != null && (st.catches || 0) >= 0) near.clampedMax = Math.max(near.clampedMax, st.clampedShare);
}
const t0 = Date.now();
let worstPerRound = 0;
for (let i = 0; i < N; i++) {
  const cfg = honestConfig(i);
  const out = simulate(cfg);
  const tests = [[out.log, out.score]];
  if (out.snaps.length) { const s = out.snaps[Math.floor(out.snaps.length / 2)]; tests.push([cut(out.log, s.len), s.score]); }
  for (const [lg, claimed] of tests) {
    runs++;
    const r = check(lg, claimed);
    margins(r);
    if (r.verdict === 'invalid') { inv++; if (inv <= 5) console.log('honest invalid', i, JSON.stringify(cfg).slice(0, 300), r.reasons); }
    else if (r.verdict === 'review') { rev++; if (rev <= 8) console.log('honest review', i, 'skill', cfg.skill.toFixed(2), 'hz', cfg.hz, r.reasons, JSON.stringify(r.stats)); }
    if (r.verdict !== 'invalid' && r.score !== claimed) { mism++; if (mism <= 5) console.log('honest mismatch', i, claimed, r.score, r.reasons); }
  }
  features(cfg, out);
  maxScore = Math.max(maxScore, out.score); sumScore += out.score;
  scoreHist[out.score] = (scoreHist[out.score] || 0) + 1;
  const bytes = JSON.stringify(out.log).length;
  if (bytes > maxBytes) maxBytes = bytes;
  maxEvents = Math.max(maxEvents, out.log.ev.length);
  if (samples.length < 40 && out.score >= 3) samples.push({ cfg, out });
  if (out.score >= 2) { const b = JSON.stringify(out.log.ev).length / (out.score + 1); if (b > worstPerRound) worstPerRound = b; }
}
const revRate = rev / runs;
console.log(`honest: ${runs} checks of ${N} simulated runs - invalid ${inv}, review ${rev} (${(revRate * 100).toFixed(2)}%), score mismatch ${mism}; mean score ${(sumScore / N).toFixed(1)}, max ${maxScore}, biggest log ${maxBytes} B / ${maxEvents} events (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
console.log('honest margins (threshold): tau mean min ' + near.tauMin.toFixed(1) + ' ms (' + R.PERSON.ACC_MEAN_MS + '), grab<100ms share max ' + near.grabFastMax.toFixed(2) + ' (' + R.PERSON.GRAB_FAST_SHARE + '), far-new-grab<150ms share max ' + near.farFastMax.toFixed(2) + ' (' + R.PERSON.FAR_SHARE + '), long-drag<40ms share max ' + near.longDragFastMax.toFixed(2) + ' (' + R.PERSON.HOLD_FAST_SHARE + '), drag median max ' + near.dragMedMax.toFixed(2) + ' px/ms (' + R.PERSON.DRAG_PX_MS + '), 4ms-cluster share max ' + near.clusterMax.toFixed(2) + ' (' + R.PERSON.CLUSTER_SHARE + '), interval SD min ' + near.sdMin.toFixed(1) + ' ms (' + R.PERSON.STEADY_SD + '), draw p min ' + near.pMin.toExponential(1) + ' (' + R.PERSON.LUCK_P + '), clamped-frame share max ' + near.clampedMax.toFixed(2) + ' (' + R.PERSON.SLOW_SHARE + ')');
console.log('log size: worst ' + worstPerRound.toFixed(0) + ' B per round played (budget ' + R.LOG_BUDGET + ' B -> ~' + Math.floor(R.LOG_BUDGET / worstPerRound) + ' rounds before the cut)');
console.log('honest coverage: ' + JSON.stringify(feat) + ' scores ' + JSON.stringify(scoreHist));
if (inv) fail('honest runs rejected: ' + inv);
if (mism) fail('honest score mismatches: ' + mism);
if (revRate > 0.005) fail('honest review rate ' + (revRate * 100).toFixed(2) + '%');

// Bytes per round, to size the worst case: a long top-skill run.
{
  const out = simulate({ seed: 777, comp: true, W: 900, skill: 1, hz: 144, dropP: 0.01, stallP: 0, pauses: [], midResize: [], maxRounds: 60, mob: false, ping: 0 });
  const bytes = JSON.stringify(out.log.ev).length;
  const r = check(out.log, out.score);
  console.log(`long run: ${out.score} rounds, ${out.log.ev.length} events, ${bytes} B (${(bytes / Math.max(1, out.score)).toFixed(0)} B/round) -> ${r.verdict} ${r.score}`);
  if (r.verdict === 'invalid' || r.score !== out.score) fail('long run: ' + r.verdict + ' ' + r.score + ' ' + r.reasons);
}
// The byte budget: a log cut where the trainer stops logging proves the rounds before the cut.
{
  const out = simulate({ seed: 4242, comp: false, W: 900, skill: 1, hz: 60, dropP: 0.01, stallP: 0, pauses: [], midResize: [], maxRounds: 30, mob: false, ping: 0 });
  const saved = R.LOG_BUDGET;
  // replay with a tiny budget: same seeds, so the same game until the cut
  R.LOG_BUDGET = 20000;
  const cutRun = simulate({ seed: 4242, comp: false, W: 900, skill: 1, hz: 60, dropP: 0.01, stallP: 0, pauses: [], midResize: [], maxRounds: 30, mob: false, ping: 0 });
  const r = check(cutRun.log, cutRun.score);   // the check reads the same budget
  R.LOG_BUDGET = saved;
  const proven = cutRun.log.ev.filter(e => e[0] === 'C').length;
  console.log(`budget cut: played ${cutRun.score}, log ${JSON.stringify(cutRun.log.ev).length} B proves ${proven} -> ${r.verdict} ${r.score}`);
  if (r.verdict === 'invalid' || r.score !== proven) fail('budget cut: ' + r.verdict + ' ' + r.score + ' ' + r.reasons);
  void out;
}
// Review fix: touchpads with tap-to-click send mousedown and mouseup together,
// so a player who taps diamonds in place has 0-1.5 ms "holds" every time.
// Those used to trip the hold-time evenness test. Tappers and spam-clickers.
{
  let rv = 0, iv = 0, mm = 0, n = 0, checked = 0;
  for (let i = 0; i < 400; i++) {
    const cr = mulberry32(31337 + i);
    const cfg = { seed: 5000 + i, comp: i % 2 === 0, W: pick(cr, [360, 412, 768, 900, 900]), skill: 0.6 + 0.4 * cr(), hz: pick(cr, [60, 60, 120, 144]), dropP: 0.005, stallP: 0,
      pauses: [], midResize: [], maxRounds: 25, mob: false, ping: 0, hwTap: true };
    if (i % 2) Object.assign(cfg, { tapPref: 1, tapOnly: true, clickMed: 50, sTap: uni(cr, 7, 30), aimFrac: uni(cr, 0.6, 1) });
    else Object.assign(cfg, { tapPref: 0.8, spam: true, aimFrac: cr() });
    const out = simulate(cfg);
    const tests = [[out.log, out.score]];
    if (out.snaps.length) { const s = out.snaps[out.snaps.length - 1]; tests.push([cut(out.log, s.len), s.score]); }
    for (const [lg, claimed] of tests) {
      n++;
      const r = check(lg, claimed);
      if ((r.stats.nGrab || 0) >= 20) checked++;
      margins(r);
      if (r.verdict === 'invalid') { iv++; if (iv <= 3) console.log('hw-tap invalid', i, r.reasons); }
      else if (r.verdict === 'review') { rv++; if (rv <= 3) console.log('hw-tap review', i, r.reasons); }
      if (r.verdict !== 'invalid' && r.score !== claimed) mm++;
    }
  }
  console.log(`tap-to-click players: ${n} checks (${checked} with 20+ grabs) - invalid ${iv}, review ${rv}, mismatch ${mm}`);
  if (iv || rv || mm) fail('tap-to-click players: invalid ' + iv + ', review ' + rv + ', mismatch ' + mm);
}
// Review fix: the diamond's position can go NaN in the game (a finger still
// moving on the canvas after the panel was hidden reads a 0x0 rect). It is
// logged as null; such a diamond can never hit or be grabbed again, and the
// run goes on. An honest miss whose diamond is never grabbed again, rewritten
// that way, must stay valid with the same score.
{
  let done = 0;
  for (const s of samples) {
    const L = clone(s.out.log), ev = L.ev;
    let at = -1, j = -1, heldJ = -1;
    for (let q = 0; q < ev.length && at < 0; q++) {
      const e = ev[q];
      if (e[0] === 'G') heldJ = e[3];
      if (e[0] === 'L' && e[5] === -1 && !ev.slice(q + 1).some(x => x[0] === 'G' && x[3] === heldJ)) { at = q; j = heldJ; }
    }
    if (at < 0) continue;
    ev[at][3] = null; ev[at][4] = null;
    const r = check(L, s.out.score);
    if (r.verdict !== 'valid' || r.score !== s.out.score || r.stats.lostDiamonds !== 1) fail('lost diamond (null release) of diamond ' + j + ': ' + r.verdict + ' ' + r.score + '/' + s.out.score + ' ' + r.reasons);
    const L2 = clone(L); L2.ev[at][5] = 0;
    const r2 = check(L2, s.out.score);
    if (r2.verdict !== 'invalid') fail('a hit with a lost diamond passed: ' + r2.verdict);
    // and a later grab of the lost diamond is impossible
    const L3 = clone(L); const g = L3.ev.findIndex((e, q) => q > at && e[0] === 'G');
    if (g > 0) {
      const y = L3.ev.slice(0, at).find(e => e[0] === 'G' && e[3] === j);
      L3.ev[g] = ['G', L3.ev[g][1], L3.ev[g][2], j, y[4], y[5]];
      const r3 = check(L3, s.out.score);
      if (r3.verdict !== 'invalid') fail('a grab of a lost diamond passed: ' + r3.verdict);
    }
    if (++done >= 10) break;
  }
  console.log(`lost diamonds: ${done} honest logs with a null release checked`);
  if (!done) fail('no honest miss to turn into a lost diamond');
}

// ── b) forgeries ─────────────────────────────────────────────────────────────
const base = samples.find(s => s.out.score >= 4 && s.out.log.ev.some(e => e[0] === 'L' && e[5] === -1) && s.out.log.ev.some(e => e[0] === 'X')) || samples[0];
const H0 = base.out.log, S0 = base.out.score;
const forg = [];
function expectCaught(name, log, claimed, allowLow) {
  const r = check(log, claimed);
  const ok = r.verdict !== 'valid' || (allowLow && r.score < claimed);
  forg.push(name);
  console.log(`  ${ok ? 'ok  ' : 'MISS'} ${name}: ${r.verdict} score ${r.score}/${claimed} ${r.reasons.slice(0, 2).join(' | ')}`);
  if (!ok) fail('forgery passed: ' + name);
  return r;
}
console.log('forgeries (base honest run: ' + S0 + ' rounds, ' + H0.ev.length + ' events):');
{ const r0 = check(H0, S0); if (r0.verdict !== 'valid' || r0.score !== S0) fail('base run not valid: ' + r0.reasons); }

expectCaught('no events + claim', { v: 1, rv: 1, type: H0.type, a: 0, env: H0.env, ev: [] }, 5);
expectCaught('claim above the logged points', H0, S0 + 3);
expectCaught('replayed honest log, higher claim', clone(H0), S0 + 1);
{
  const L = clone(H0); for (const e of L.ev) { e[1] = Math.round(e[1] * 0.5); if (typeof e[2] === 'number' && e[0] !== 'Z') e[2] = Math.round(e[2] * 5) / 10; if ('ROYC'.includes(e[0])) e[3] = Math.round(e[3] * 5) / 10; if (e[0] === 'E') e[3] = Math.round(e[3] * 5) / 10; }
  expectCaught('all times scaled x0.5', L, S0);
}
{ const L = clone(H0); for (const e of L.ev) e[1] = Math.round(e[1] * 0.5); expectCaught('run clock scaled x0.5 (game clock kept)', L, S0); }
// A logged miss with orbs on screen: [log, event index, an orb on screen then].
// (Every orb on screen was out of reach, or the game would have hit it.)
function missWithOrbs(lg) {
  let n = -1, W = 0, H = 0, round = 0, play = false; const gone = new Set(), orbs = [];
  const comp = /-comp$/.test(lg.type);
  for (let i = 0; i < lg.ev.length; i++) {
    const x = lg.ev[i];
    if (x[0] === 'Z') { W = x[2]; H = x[3]; }
    if (x[0] === 'R') { for (let q = 0; q <= n; q++) gone.add(q); round = x[4]; play = true; }
    if (x[0] === 'C') play = false;
    if (x[0] === 'O') { n++; orbs[n] = { x: R.colX(W, x[4]), y0: R.spawnY(H), v: R.orbSpeed(round, comp) * x[6], o: x[2] - x[3] }; }
    if (x[0] === 'X') gone.add(x[3]);
    if (x[0] === 'L' && x[5] >= 0) gone.add(x[5]);
    if (x[0] === 'L' && x[5] === -1 && play) for (let q = n; q >= 0; q--) if (!gone.has(q)) {
      const o = orbs[q];
      return [i, q, o.x, o.y0 - o.v * (x[2] - o.o) / 1000];
    }
  }
  return null;
}
{
  let src = null, at = null;
  for (const s of samples) { const m = missWithOrbs(s.out.log); if (m) { src = s.out; at = m; break; } }
  if (!src) fail('no miss to flip');
  else {
    const L = clone(src.log); L.ev[at[0]][5] = at[1];
    expectCaught('logged miss flipped to a hit', L, src.score);
    // a forger who also moves the diamond onto that orb: the catch itself now
    // fits, but the orb's later escape (or the diamond's later life) does not
    const L2 = clone(src.log); const e = L2.ev[at[0]];
    e[3] = Math.round(at[2] * 10) / 10; e[4] = Math.max(26, Math.round(at[3] * 10) / 10); e[5] = at[1];
    expectCaught('miss rewritten as a catch at the orb', L2, src.score);
  }
}
{ const L = clone(H0); const e = L.ev.find(x => x[0] === 'L' && x[5] >= 0); e[5] = -1; expectCaught('logged catch flipped to a miss', L, S0); }
{ const L = clone(H0); const e = L.ev.find(x => x[0] === 'O'); e[6] = 0.5; expectCaught('orb speed multiplier out of range', L, S0); }
{ const L = clone(H0); const e = L.ev.filter(x => x[0] === 'O')[3]; e[7] = 2.0; expectCaught('orb gap out of range', L, S0); }
{ const L = clone(H0); const i = L.ev.findIndex((x, j) => x[0] === 'O' && j > 20); L.ev.splice(i, 1); expectCaught('an orb removed from the log', L, S0); }
{ const L = clone(H0); const i = L.ev.findIndex((x, j) => x[0] === 'O' && j > 20); const d = L.ev[i].slice(); d[4] = (d[4] + 1) % 5; L.ev.splice(i + 1, 0, d); expectCaught('an extra orb in the same frame', L, S0); }
{ const L = clone(H0); const i = L.ev.findIndex((x, j) => x[0] === 'Y' && j > 20); L.ev.splice(i, 1); expectCaught('a diamond removed from the log', L, S0); }
{ const L = clone(H0); const e = L.ev.find(x => x[0] === 'Y'); e[6] = 9; expectCaught('diamond life out of range', L, S0); }
{ // hide the escape of a purple that did not end the run
  const L = clone(H0); const pur = new Set(); let n = -1;
  for (const e of L.ev) { if (e[0] === 'O') { n++; if (e[5] === 1) pur.add(n); } }
  const i = L.ev.findIndex(e => e[0] === 'X' && pur.has(e[3]) && L.ev[L.ev.indexOf(e) + 1][0] !== 'E');
  if (i >= 0) { L.ev.splice(i, 1); expectCaught('purple escape removed', L, S0); }
}
{ const L = clone(H0); const i = L.ev.findIndex(e => e[0] === 'C'); const e = L.ev[i]; e[2] -= 1500; expectCaught('round shortened to 13.5 s', L, S0); }
{ const L = clone(H0); const i = L.ev.findIndex(e => e[0] === 'G'); const t = L.ev[i]; L.ev[i] = L.ev[i + 1]; L.ev[i + 1] = t; expectCaught('release logged before its grab (order)', L, S0); }
{ const L = clone(H0); const i = L.ev.findIndex(e => e[0] === 'C'); const j = L.ev.findIndex((e, q) => q > i && e[0] === 'O'); const c = L.ev.splice(i, 1)[0]; L.ev.splice(j, 0, c); expectCaught('round end moved after the next round began', L, S0); }
{ const L = clone(H0); const e = L.ev.find(x => x[0] === 'G'); e[4] += 200; expectCaught('grab far from any diamond', L, S0); }
{ const L = clone(H0); L.ev[0][3] = 360; expectCaught('canvas height does not match its width', L, S0); }
{ const L = clone(H0); const i = L.ev.findIndex(e => e[0] === 'C'); L.ev.splice(i + 1, 0, ['O', L.ev[i][1], L.ev[i][2], 0, 0, 1, 1, 1]); expectCaught('orb during the transition', L, S0); }
{ // a lost run with its end cut off and more rounds appended from another run
  const lost = samples.find(s => s.out.over && s.out.log.ev[s.out.log.ev.length - 1][2] === 'X');
  if (lost) { const L = clone(lost.out.log); L.ev.pop(); const c = L.ev.filter(e => e[0] === 'C').length; expectCaught('second escape without the run ending', L, c + 1, true); }
}
{ // red drop changed to a miss and the end removed
  const redRun = samples.find(s => s.out.over && s.out.log.ev[s.out.log.ev.length - 1][2] === 'D');
  if (redRun) { const L = clone(redRun.out.log); L.ev.pop(); const l = L.ev[L.ev.length - 1]; l[5] = -1; expectCaught('red drop rewritten as a miss', L, redRun.out.score); }
}
{ const L = clone(H0); const i = L.ev.findIndex(e => e[0] === 'E'); if (i > 0) { L.ev.push(['O', L.ev[i][1] + 5, L.ev[i][3] + 16, 16, 0, 1, 1, 1]); expectCaught('events after the end', L, S0); } }

// ── review: more hand-written forgeries ──
{
  const idxOf = (L, code, n) => { let k = -1; for (let q = 0; q < L.ev.length; q++) if (L.ev[q][0] === code && ++k === (n || 0)) return q; return -1; };
  const mut = (name, fn, claimed) => { const L = clone(H0); if (fn(L) === false) return; expectCaught(name, L, claimed == null ? S0 : claimed); };
  // minimal logs
  expectCaught('minimal: start, one spawn each, round end', { v: 1, rv: 1, type: H0.type, a: 0, env: H0.env,
    ev: [['Z', 0, 900, 342], ['R', 0, 0, 0, 1], ['O', 0, 0, 0, 2, 1, 1, 1.2], ['Y', 0, 0, 0, 2, 100, 6, 0.7], ['C', 15000, 15000, 16, 1]] }, 1);
  expectCaught('minimal: rounds only', { v: 1, rv: 1, type: H0.type, a: 0, env: H0.env,
    ev: [['Z', 0, 900, 342], ['R', 0, 0, 0, 1], ['C', 15000, 15000, 16, 1], ['R', 16000, 16000, 16, 2], ['C', 31000, 31000, 16, 2]] }, 2);
  // wrong field types, NaN-like strings, huge and negative numbers
  mut('column as a string', L => { L.ev[idxOf(L, 'O', 2)][4] = '1'; });
  mut('game time as a string', L => { L.ev[idxOf(L, 'O', 2)][2] = String(L.ev[idxOf(L, 'O', 2)][2]); });
  mut('game time "NaN"', L => { L.ev[idxOf(L, 'G')][2] = 'NaN'; });
  mut('purple flag as true', L => { L.ev[idxOf(L, 'O', 1)][5] = true; });
  mut('release outcome as a string', L => { const q = L.ev.findIndex(e => e[0] === 'L' && e[5] >= 0); L.ev[q][5] = String(L.ev[q][5]); });
  mut('release position as a string', L => { const q = idxOf(L, 'L'); L.ev[q][3] = String(L.ev[q][3]); });
  mut('round count as a string', L => { const q = idxOf(L, 'C'); L.ev[q][4] = '1'; });
  mut('canvas width as a string', L => { L.ev[0][2] = String(L.ev[0][2]); });
  mut('canvas 1e9 wide', L => { L.ev[0][2] = 1e9; L.ev[0][3] = 360; });
  mut('end reason as a number', L => { const q = idxOf(L, 'E'); if (q < 0) return false; L.ev[q][2] = 1; });
  mut('huge game time', L => { L.ev[idxOf(L, 'G')][2] = 1e12; });
  mut('negative game time', L => { L.ev[idxOf(L, 'O', 3)][2] = -5; });
  mut('negative frame step', L => { L.ev[idxOf(L, 'O', 3)][3] = -16; });
  mut('frame step of 5 s', L => { L.ev[idxOf(L, 'O', 3)][3] = 5000; });
  mut('orb index -2 in a release', L => { const q = idxOf(L, 'L'); L.ev[q][5] = -2; });
  mut('null orb draw', L => { L.ev[idxOf(L, 'O', 2)][6] = null; });
  // duplicates and reuse
  mut('duplicate round end', L => { const q = idxOf(L, 'C'); L.ev.splice(q + 1, 0, L.ev[q].slice()); });
  mut('duplicate escape', L => { const q = idxOf(L, 'X'); if (q < 0) return false; L.ev.splice(q + 1, 0, L.ev[q].slice()); });
  mut('duplicate grab', L => { const q = idxOf(L, 'G'); L.ev.splice(q + 1, 0, L.ev[q].slice()); });
  mut('duplicate release', L => { const q = idxOf(L, 'L'); L.ev.splice(q + 1, 0, L.ev[q].slice()); });
  mut('duplicate orb spawn', L => { const q = idxOf(L, 'O', 4); L.ev.splice(q + 1, 0, L.ev[q].slice()); });
  mut('an orb caught twice', L => {
    const a = L.ev.findIndex(e => e[0] === 'L' && e[5] >= 0); const b = L.ev.findIndex((e, q) => q > a && e[0] === 'L');
    if (b < 0) return false; L.ev[b][5] = L.ev[a][5]; L.ev[b][3] = L.ev[a][3]; L.ev[b][4] = L.ev[a][4];
  });
  mut('a caught diamond grabbed again', L => {
    const a = L.ev.findIndex(e => e[0] === 'L' && e[5] >= 0); let j = -1;
    for (let q = a; q >= 0; q--) if (L.ev[q][0] === 'G') { j = L.ev[q][3]; break; }
    const b = L.ev.findIndex((e, q) => q > a && e[0] === 'G'); if (b < 0) return false; L.ev[b][3] = j;
  });
  // required events skipped
  mut('first canvas size removed', L => { L.ev.splice(0, 1); });
  mut('second round start removed', L => { L.ev.splice(idxOf(L, 'R', 1), 1); });
  mut('first diamond removed', L => { L.ev.splice(idxOf(L, 'Y'), 1); });
  mut('a diamond expiry removed', L => { const q = idxOf(L, 'V', 2); if (q < 0) return false; L.ev.splice(q, 1); });
  mut('the end removed, then a round appended', L => {
    const q = idxOf(L, 'E'); if (q < 0) return false; L.ev.splice(q, 1);
    const last = L.ev[L.ev.length - 1]; L.ev.push(['C', last[1] + 15000, 99999999, 16, S0 + 1]);
  }, S0 + 1);
  // stretched, compressed, identical timings
  mut('all times x2', L => { for (const e of L.ev) { e[1] *= 2; if (e[0] !== 'Z') { if (e[0] === 'E') e[3] = Math.round(e[3] * 20) / 10; else e[2] = Math.round(e[2] * 20) / 10; } } });
  mut('game clock x1.1 (a faster round)', L => { for (const e of L.ev) { if (e[0] === 'Z') continue; if (e[0] === 'E') e[3] = Math.round(e[3] * 11) / 10; else e[2] = Math.round(e[2] * 11) / 10; } });
  mut('every event at one time', L => { for (const e of L.ev) e[1] = 16000 * (S0 + 1); });
  mut('frame steps all zero', L => { for (const e of L.ev) if ('ROYC'.includes(e[0]) && e[2] > 0) e[3] = 0; });
  // lost-diamond abuse
  mut('a catch logged with a null position', L => { const q = L.ev.findIndex(e => e[0] === 'L' && e[5] >= 0); L.ev[q][3] = null; L.ev[q][4] = null; });
  mut('a grab with a null pointer', L => { const q = idxOf(L, 'G'); L.ev[q][4] = null; });
}
// A narrow canvas (a squeezed or zoomed desktop window): one parked diamond
// reaches several columns. Legal, but held.
{
  const r = botRun('narrow canvas (150 px)', null, { seed: 99174, skill: 1, W: 150, tapPref: 0, aimFrac: 0.8, maxRounds: 6 });
  if (!r.reasons.some(x => /canvas only/.test(x))) fail('narrow canvas: not held for its width');
}
// A modified client that puts orbs in the columns of resting diamonds.
botRun('cherry-picked: orbs in the columns of resting diamonds', null, { skill: 0.8, tapPref: 0.7, colBias: 0.5, maxRounds: 12 });

// Consistent logs from bots and loaded dice: the sim plays them, so every rule holds.
function botRun(name, bot, extra, claimedFn) {
  const cfg = Object.assign({ seed: 99173, comp: false, W: 900, skill: 1, hz: 60, dropP: 0.005, stallP: 0, pauses: [], midResize: [], maxRounds: 12, mob: false, ping: 0, bot }, extra || {});
  const out = simulate(cfg);
  return expectCaught(name + ' (' + out.score + ' rounds)', out.log, out.score);
}
botRun('perfect bot (instant, zero error)', { rt: 0.5, plan: 0.5, fA: 0, fB: 0, sClick: 0, sPos: 0, sT: 0 });
botRun('metronome bot (fixed 350 ms cadence, human aim)', { rt: 1, plan: 1, fA: 0, fB: 0, sClick: 5, sPos: 7, sT: 20, cadence: 350 });
botRun('perfect tap bot (releases as the orb is centred)', { rt: 1, plan: 1, fA: 0, fB: 0, sClick: 3, sPos: 7, sT: 20, tapPref: 1, sTap: 0, click: 20 });
botRun('superhuman reactions (~40 ms)', { rt: 40, plan: 30, rtSig: 0.1, fA: 5, fB: 5, sClick: 6, sPos: 8, sT: 20 });
botRun('cherry-picked: few purple orbs', null, { skill: 0.6, purpleP: 0.35 });
botRun('cherry-picked: slowest orbs only', null, { skill: 0.6, mulDraw: u => R.orbMul(u * 0.08) });
botRun('cherry-picked: longest orb gaps only', null, { skill: 0.6, gapDraw: u => R.orbGap(0.9 + u * 0.1) });
botRun('cherry-picked: longest-lived diamonds', null, { skill: 0.6, lifeDraw: u => R.yelLife(0.92 + u * 0.08) });
botRun('slow motion (8 fps, every frame clamped)', null, { skill: 0.7, hz: 8, dropP: 0 });

console.log(`forgeries: ${forg.length} tried, ${failures ? failures + ' failure(s) overall' : 'all caught'}`);

// ── d) the REAL trainer code in a fake page, played by thorian-new.bot.js ────
// A fake clock drives requestAnimationFrame (60 Hz with drops), timers and the
// bot's sleeps; the IIFE's own log is checked, and so is every packet it
// submitted (with the score it claimed).
async function realIife(opts) {
  const fs = require('fs');
  const src = fs.readFileSync(__dirname + '/thorian-new.iife.js', 'utf8');
  const botSrc = fs.readFileSync(__dirname + '/thorian-new.bot.js', 'utf8');
  const rng = mulberry32(opts.seed);
  let now = 1000;
  const timers = [];            // {at, fn}
  let rafs = [], rafId = 0;
  const listeners = new Map();  // el -> {type: [fn]}
  function el(id, extra) {
    const e = Object.assign({ id, style: {}, textContent: '', addEventListener(type, fn) { const m = listeners.get(e) || {}; (m[type] = m[type] || []).push(fn); listeners.set(e, m); } }, extra || {});
    return e;
  }
  const noop = () => {};
  const ctx2d = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : (k in t ? t[k] : noop)), set: (t, k, v) => { t[k] = v; return true; } });
  const wrap = { clientWidth: opts.W };
  const canvas = el('thorian-new-qte-canvas', { width: 0, height: 0, parentElement: wrap, getContext: () => ctx2d, getBoundingClientRect() { return { left: 10, top: 20, width: canvas.width * opts.cssScale, height: canvas.height * opts.cssScale }; } });
  const els = { 'thorian-new-qte-canvas': canvas };
  for (const id of ['thorian-new-qte-status', 'thorian-new-qte-streak', 'thorian-new-qte-highscore', 'thorian-new-qte-start-btn', 'thorian-new-qte-resume-btn']) els[id] = el(id);
  const store = new Map([['alb:qte-selfcheck', '1']]);
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const submits = [];
  const G = globalThis;
  const saved = {};
  for (const k of ['window', 'document', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', '_qteCompMode', '_sbSubmitScore', '__qteBots']) saved[k] = Object.getOwnPropertyDescriptor(G, k);
  const def = (k, v) => Object.defineProperty(G, k, { value: v, configurable: true, writable: true });
  def('window', G);
  def('document', { getElementById: id => els[id] || null });
  def('localStorage', localStorage);
  def('performance', { now: () => now });
  def('requestAnimationFrame', fn => { rafs.push({ id: ++rafId, fn }); return rafId; });
  def('cancelAnimationFrame', id => { rafs = rafs.filter(r => r.id !== id); });
  def('_qteCompMode', !!opts.comp);
  def('_sbSubmitScore', (type, score, packet) => { submits.push({ type, score, log: packet.log, self: Q.Run.lastSelfCheck }); });
  def('__qteBots', {});
  const fakeTimeout = (fn, ms) => { timers.push({ at: now + (ms || 0), fn }); return timers.length; };
  G.addEventListener = G.addEventListener || noop;
  try {
    (new Function('setTimeout', src))(fakeTimeout);             // the trainer, verbatim
    (new Function(botSrc))();                                    // the bot, verbatim
    const sleep = ms => new Promise(res => timers.push({ at: now + Math.max(0, ms), fn: res }));
    const ctx = {
      comp: !!opts.comp, target: opts.target,
      byId: id => els[id] || null,
      click: e => { const m = listeners.get(e); if (m && m.click) m.click.forEach(f => f({ preventDefault: noop })); },
      key: noop,
      mouse: (type, cx, cy, target) => { const m = listeners.get(target); if (m && m[type]) m[type].forEach(f => f({ clientX: cx, clientY: cy, preventDefault: noop })); },
      sleep,
      until: async (fn, ms) => { const end = now + ms; while (now < end) { if (fn()) return true; await sleep(10); } return !!fn(); },
      run: () => Q.Run.current,
      lastEv: code => { const r = Q.Run.current; if (!r) return null; for (let i = r.log.ev.length - 1; i >= 0; i--) if (r.log.ev[i][0] === code) return r.log.ev[i]; return null; },
      human: (m, sd) => Math.max(0, m + sd * gauss(rng)),
      log: () => {},
      // for scripted scenarios (opts.bot)
      hide: () => G._onThorianNewQteHide(),
      show: () => G._onThorianNewQteShow(),
      resume: () => ctx.click(els['thorian-new-qte-resume-btn']),
      setCss: s => { opts.cssScale = s; },
      els, store, fakeNow: () => now,
    };
    G._onThorianNewQteShow();
    let result = null, done = false, err = null;
    (opts.bot ? opts.bot(ctx) : G.__qteBots['thorian-new'](ctx)).then(r => { result = r; done = true; }, e => { err = e; done = true; });
    let nextFrame = now + 16.7, paused = false;
    let pauseAt = opts.pauseAt ? now + opts.pauseAt : Infinity;
    const maxNow = opts.maxNow || 3.6e6;
    while (!done && now < maxNow) {
      timers.sort((a, b) => a.at - b.at);
      const tt = timers.length ? timers[0].at : Infinity;
      if (!paused && pauseAt <= Math.min(nextFrame, tt)) {
        // switch tab away and back, maybe on a resized window, then Resume
        now = Math.max(now, pauseAt); G._onThorianNewQteHide(); paused = true;
        timers.push({ at: now + (opts.pauseMs || 4000), fn: () => { if (opts.resizeTo) wrap.clientWidth = opts.resizeTo; G._onThorianNewQteShow(); ctx.click(els['thorian-new-qte-resume-btn']); } });
        pauseAt = Infinity;
        continue;
      }
      if (tt <= nextFrame) { const t = timers.shift(); now = Math.max(now, t.at); t.fn(); }
      else {
        now = nextFrame;
        const due = rafs; rafs = [];
        for (const r of due) r.fn(now);
        nextFrame = now + (rng() < 0.02 ? 16.7 * (2 + Math.floor(rng() * 3)) : 16.7);
        if (paused && rafs.length) paused = false;
      }
      await new Promise(r => setImmediate(r));
    }
    if (err) throw err;
    return { result, run: Q.Run.current, submits, store };
  } finally {
    for (const k of Object.keys(saved)) { if (saved[k]) Object.defineProperty(G, k, saved[k]); else delete G[k]; }
  }
}

// ── e) scripted scenarios on the REAL trainer (review fixes) ─────────────────
// The game as the run's log tells it; orbs at the last logged frame (frozen
// at the round-end frame during the transition).
function logState(run) {
  const comp = /-comp$/.test(run.type), ev = run.log.ev;
  let W = 0, H = 0, round = 0, score = 0, phase = 'pre', over = false, lastG = 0, frozen = Infinity;
  let orbs = [], yels = [], held = null, nO = 0, nY = 0;
  for (const e of ev) {
    const c = e[0];
    if (c === 'Z') { W = e[2]; H = e[3]; continue; }
    const g = c === 'E' ? e[3] : e[2]; lastG = g;
    if (c === 'R') { round = e[4]; phase = 'play'; orbs = []; yels = []; held = null; frozen = Infinity; }
    else if (c === 'O') orbs.push({ k: nO++, x: R.colX(W, e[4]), y0: R.spawnY(H), v: R.orbSpeed(round, comp) * e[6], o: e[2] - e[3], purple: e[5] === 1 });
    else if (c === 'Y') yels.push({ j: nY++, x: R.colX(W, e[4]), y: e[5] });
    else if (c === 'X') orbs = orbs.filter(o => o.k !== e[3]);
    else if (c === 'V') yels = yels.filter(y => y.j !== e[3]);
    else if (c === 'G') held = yels.find(y => y.j === e[3]) || null;
    else if (c === 'L' || c === 'D') {
      if (held) { held.x = e[3]; held.y = e[4]; }
      if (c === 'L' && e[5] >= 0) { orbs = orbs.filter(o => o.k !== e[5]); yels = yels.filter(y => y !== held); }
      held = null;
    }
    else if (c === 'C') { score = e[4]; phase = 'trans'; frozen = e[2] - e[3]; }
    else if (c === 'E') over = true;
  }
  for (const o of orbs) o.y = o.y0 - o.v * (Math.min(lastG, frozen) - o.o) / 1000;
  return { W, H, round, score, phase, over, orbs, yels, held };
}
function canvasMouse(ctx, type, x, y) {
  const cv = ctx.byId('thorian-new-qte-canvas'), rc = cv.getBoundingClientRect();
  ctx.mouse(type, rc.left + x * rc.width / cv.width, rc.top + y * rc.height / cv.height, cv);
}

// A: game over while paused, then Resume. The original lets the finished game
// run on (its rAF restarts); the next round it "completes" used to be
// submitted with a log that ends at the game over (claim > proof: invalid).
async function zombieBot(ctx) {
  const botDone = window.__qteBots['thorian-new'](Object.assign({}, ctx, { target: 1 }));
  const run0 = () => ctx.run();
  if (!(await ctx.until(() => run0() && run0().log.ev.some(e => e[0] === 'C'), 60000))) { await botDone; return { points: 0, staged: false, why: 'no round' }; }
  await ctx.sleep(420);                                   // the page bot has stopped playing
  const run = run0(), s = logState(run);
  if (s.over || s.phase !== 'trans' || s.held) { await botDone; return { points: s.score, staged: false, why: 'state' }; }
  let red = null, pt = null;
  for (const o of s.orbs) {
    if (o.purple) continue;
    const x = Math.max(R.PLAYER_R, Math.min(s.W - R.PLAYER_R, o.x)), y = Math.max(R.PLAYER_R, Math.min(s.H - R.PLAYER_R, o.y));
    const first = s.orbs.find(q => Math.hypot(q.x - x, q.y - y) < R.DROP_R);
    if (first === o) { red = o; pt = { x, y }; break; }
  }
  const d = s.yels[0];
  if (!red || !d) { await botDone; return { points: s.score, staged: false, why: 'no red orb on screen' }; }
  canvasMouse(ctx, 'mousedown', d.x, d.y);
  const s2 = logState(run);
  if (!s2.held) { await botDone; return { points: s.score, staged: false, why: 'no grab' }; }
  const ox = d.x - s2.held.x, oy = d.y - s2.held.y;
  ctx.hide();                                             // panel hidden: paused
  canvasMouse(ctx, 'mousemove', pt.x + ox, pt.y + oy);    // the hand keeps dragging
  canvasMouse(ctx, 'mouseup', pt.x + ox, pt.y + oy);      // on the red orb: game over, while paused
  const ended = logState(run).over;
  ctx.show(); ctx.resume();                               // Resume is still offered
  await ctx.sleep(3000);
  await botDone;
  return { points: s.score, staged: ended };
}

// B: the diamond's position goes NaN (a pointer read off a 0x0 canvas while
// the panel is hidden), then the run goes on.
async function lostBot(ctx) {
  ctx.click(ctx.byId('thorian-new-qte-start-btn'));
  await ctx.until(() => ctx.run() && ctx.run().log.ev.some(e => e[0] === 'Y'), 3000);
  await ctx.sleep(1200);
  const run = ctx.run(), s = logState(run), d = s.yels[0];
  if (!d) return { points: 0, staged: false };
  canvasMouse(ctx, 'mousedown', d.x, d.y);
  if (!logState(run).held) return { points: 0, staged: false };
  ctx.hide();
  ctx.setCss(0);                                          // the canvas measures 0 x 0
  const rc = ctx.byId('thorian-new-qte-canvas').getBoundingClientRect();
  ctx.mouse('mousemove', rc.left, rc.top, ctx.byId('thorian-new-qte-canvas'));
  ctx.mouse('mouseup', rc.left, rc.top, ctx.byId('thorian-new-qte-canvas'));
  ctx.setCss(1); ctx.show(); ctx.resume();
  await ctx.until(() => logState(run).over, 60000);
  return { points: logState(run).score, staged: run.log.ev.some(e => e[0] === 'L' && e[3] === null) };
}

async function scenarios() {
  const hsKey = 'alb:thorian-new-hs-v2';
  function submitsOk(out, label) {
    let ok = true;
    for (const s of out.submits) {
      const lg = JSON.parse(JSON.stringify(s.log));            // what the server receives
      const rs = Q.check(s.type, lg, { platform: 'C', claimed: s.score });
      if (rs.verdict === 'invalid' || rs.score !== s.score) { ok = false; fail(label + ': submitted ' + s.score + ' -> ' + rs.verdict + ' ' + rs.score + ' ' + rs.reasons.join(' | ')); }
    }
    return ok;
  }
  // A
  let staged = 0;
  for (let k = 0; k < 12 && staged < 2; k++) {
    const out = await realIife({ seed: 900 + k, comp: false, W: 900, cssScale: 1, target: 1, bot: zombieBot, maxNow: 400000 });
    submitsOk(out, 'zombie resume');
    if (!out.result || !out.result.staged) continue;
    staged++;
    const lg = JSON.parse(JSON.stringify(out.run.log)), last = lg.ev[lg.ev.length - 1];
    const r = Q.check(out.run.type, lg, { platform: 'C', claimed: out.result.points });
    const hs = +out.store.get(hsKey);
    console.log(`  zombie resume: red drop while paused ended the run (${last[0]} ${last[2]}), local best ${hs}, ${out.submits.length} submit(s) (max ${Math.max(0, ...out.submits.map(s => s.score))}), log -> ${r.verdict} ${r.score}`);
    if (last[0] !== 'E' || last[2] !== 'D') fail('zombie resume: log does not end with the red drop');
    if (r.verdict === 'invalid') fail('zombie resume: log ' + r.reasons.join(' | '));
    if (out.submits.some(s => s.score > out.result.points)) fail('zombie resume: a round after the game over was submitted');
  }
  if (!staged) fail('zombie resume: never staged (no red orb on screen in the transition)');
  // B
  let lost = 0;
  for (let k = 0; k < 6 && lost < 2; k++) {
    const out = await realIife({ seed: 950 + k, comp: k % 2 === 1, W: 600, cssScale: 1, target: 0, bot: lostBot, maxNow: 200000 });
    submitsOk(out, 'lost diamond');
    if (!out.result || !out.result.staged) continue;
    lost++;
    const lg = JSON.parse(JSON.stringify(out.run.log));
    const r = Q.check(out.run.type, lg, { platform: 'C', claimed: out.result.points });
    console.log(`  lost diamond (NaN position) in the real trainer: ${lg.ev.length} events -> ${r.verdict} ${r.score}, lostDiamonds ${r.stats.lostDiamonds}`);
    if (r.verdict === 'invalid' || r.stats.lostDiamonds !== 1) fail('lost diamond: ' + r.verdict + ' ' + r.reasons.join(' | '));
  }
  if (!lost) fail('lost diamond: never staged');
  // C: a run kept going past QteRules.LIMITS.MAX_T (lowered here so the cut
  // lands 20 s in): logging stops and the run closes before any event could
  // pass the limit, and nothing after the cut is submitted.
  const savedMax = Q.LIMITS.MAX_T;
  Q.LIMITS.MAX_T = R.LOG_T_MARGIN + 20000;
  try {
    const out = await realIife({ seed: 990, comp: false, W: 900, cssScale: 1, target: 3, maxNow: 150000 });
    const lg = JSON.parse(JSON.stringify(out.run.log));
    const bad = Q.validateLog(lg), lastT = lg.ev.length ? lg.ev[lg.ev.length - 1][1] : 0;
    const r = Q.check(out.run.type, lg, { platform: 'C', claimed: 0 });
    console.log(`  time cut: run closed ${out.run.closed}, last event at ${lastT} ms (cut ${Q.LIMITS.MAX_T - R.LOG_T_MARGIN}), ${out.submits.length} submit(s), log -> ${r.verdict} ${r.score}`);
    if (!out.run.closed || bad || lastT > Q.LIMITS.MAX_T - R.LOG_T_MARGIN + 100 || r.verdict === 'invalid') fail('time cut: ' + (bad || r.reasons.join(' | ')));
    submitsOk(out, 'time cut');
  } finally { Q.LIMITS.MAX_T = savedMax; }
}

(async () => {
  const cases = [
    { seed: 11, comp: false, W: 900, cssScale: 1, target: 3 },
    { seed: 12, comp: true, W: 412, cssScale: 0.8, target: 2, pauseAt: 9000, resizeTo: 700 },
    { seed: 13, comp: false, W: 600, cssScale: 1.25, target: 2, pauseAt: 22000 },
  ];
  for (let k = 0; k < 9; k++) {
    const cr = mulberry32(700 + k);
    cases.push({ seed: 20 + k, comp: k % 2 === 1, W: pick(cr, [340, 412, 600, 900]), cssScale: pick(cr, [1, 0.75, 1.5]), target: 2 + (k % 3),
      pauseAt: k % 3 === 0 ? 0 : (k % 3 === 1 ? 15000 + cr() * 1000 : 3000 + cr() * 25000), resizeTo: k === 4 ? 360 : (k === 7 ? 900 : 0) });
  }
  let ok = 0;
  for (const c of cases) {
    const out = await realIife(c);
    const run = out.run, pts = out.result ? out.result.points : -1;
    const r = Q.check(run.type, run.log, { platform: 'C', claimed: pts });
    const good = r.verdict !== 'invalid' && r.score === pts;
    let subsOk = out.submits.length > 0;
    for (const s of out.submits) {
      const rs = Q.check(s.type, s.log, { platform: 'C', claimed: s.score });
      if (rs.verdict === 'invalid' || rs.score !== s.score) subsOk = false;
      if (!s.self || s.self.result.verdict === 'invalid') subsOk = false;
    }
    console.log(`  real IIFE ${run.type} W=${c.W}${c.pauseAt ? ' +pause' : ''}${c.resizeTo ? '+resize' : ''}: bot ${pts} rounds, ${run.log.ev.length} events -> ${r.verdict} ${r.score}; ${out.submits.length} submits ${subsOk ? 'ok' : 'BAD'} ${r.reasons.join(' | ')}`);
    if (good && subsOk && pts >= c.target) ok++; else fail('real IIFE case ' + c.seed + ': ' + r.verdict + ' ' + r.score + '/' + pts + ' ' + r.reasons.join(' | '));
  }
  console.log(`real IIFE: ${ok}/${cases.length} bot runs of the verbatim trainer checked valid`);
  await scenarios();
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('FAIL real IIFE harness: ' + (e && e.stack || e)); process.exit(1); });
