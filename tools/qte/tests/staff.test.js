// node staff.test.js
// a) honest players simulated from the rules (same draws and state machine as
//    the trainer, frame-quantised timeouts, late timers, pauses, resets),
//    checked at every submit and at the end of every attempt;
// b) forgeries, each of which must come out invalid, held for review, or with
//    a proven score below what it claims;
// c) the real staff.iife.js in a vm with a stub DOM, coarse/jumping clocks,
//    hidden tabs and a random player (see "suite c" below).
// Env: SEED=n, ONLY=honest|forgeries|iife, IIFE_RUNS=n, STAFF_IIFE=<path>, DUMP=1.
'use strict';
require('./_paths.js');
const Q = require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const R = Q.trainers.staff;
if (!R || typeof R.check !== 'function') { console.log('FAIL staff rules did not register'); process.exit(1); }

// ── deterministic randomness ──────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(+process.env.SEED || 20260922);
function N() { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }
function logn(med, sig) { return med * Math.exp(sig * N()); }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function r2(v) { return Math.round(v * 100) / 100; }
function r4(v) { return Math.round(v * 10000) / 10000; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

// setTimeout lateness on a busy page
function late() { const u = rnd(); return u < 0.9 ? rnd() * 4 : u < 0.99 ? rnd() * 40 : rnd() * 120; }

// rAF frames: a fixed rate with dropped frames and the odd long one.
function Frames(hz) {
  const iv = 1000 / hz; let f = rnd() * iv;
  return {
    atOrAfter(t) {
      while (f < t) {
        f += iv;
        const u = rnd();
        if (u < 0.02) f += iv * 2;           // dropped frames
        else if (u < 0.023) f += 50;         // a 50 ms stall
      }
      return f;
    },
  };
}

// ── skill levels ──────────────────────────────────────────────────────────────
// react: round start to first grab; back: a placed tile to the next grab
// (move up, find a rune); drag: grab to release; sd: grab/drop scatter in
// tile sizes; wrong: share of drops on a wrong slot; miss: dropped short.
const SKILLS = {
  new:   { react: 420, back: 620, drag: 430, sd: 0.21, wrong: 0.09, miss: 0.05 },
  avg:   { react: 320, back: 460, drag: 340, sd: 0.19, wrong: 0.05, miss: 0.03 },
  good:  { react: 270, back: 360, drag: 270, sd: 0.17, wrong: 0.03, miss: 0.02 },
  top:   { react: 230, back: 270, drag: 210, sd: 0.15, wrong: 0.02, miss: 0.015 },
  elite: { react: 200, back: 210, drag: 170, sd: 0.13, wrong: 0.012, miss: 0.01 },
  // faster than anyone on the board today: the margin for the thresholds
  god:   { react: 180, back: 170, drag: 130, sd: 0.11, wrong: 0.01, miss: 0.01 },
};

// ── one simulated run (one Start) ─────────────────────────────────────────────
// Returns the checks to make: every submit (a new local best) and the end of
// every attempt, each with the log exactly as the trainer would have it.
function simRun(o) {
  const type = 'staff' + (o.comp ? '-comp' : '');
  const S = o.skill;
  const frames = Frames(o.hz);
  const out = [];
  let attempt = 0;
  let log = newLog(0);
  let closed = false;
  let streak = 0, best = o.best;
  let xAt = rnd() < o.pX ? 2000 + rnd() * 120000 : Infinity;
  function newLog(a) { return { v: 1, rv: Q.RULES_VER, type: type, a: a, env: { w: o.w, h: Math.round(o.w * 0.6), mob: o.mob, ping: o.ping }, ev: [] }; }
  function ev(code, t) {
    if (closed) return;
    const e = [code, Math.max(0, Math.round(t))];
    for (let i = 2; i < arguments.length; i++) { const f = arguments[i]; e.push(typeof f === 'number' ? r4(f) : f); }
    log.ev.push(e);
  }
  function snap(claimed, kind) { out.push({ type, log: clone(log), claimed, kind, platform: o.mob ? 'M' : 'C' }); }
  function dur() { return R.timerDur(streak, o.comp) * 1000; }
  function draw() {
    const len = R.patternLen(streak, o.comp), pat = [];
    for (let i = 0; i < len; i++) pat.push(R.KEYS[Math.floor(rnd() * R.KEYS.length)]);
    const a = pat.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = a[i]; a[i] = a[j]; a[j] = tmp; }
    return { pat, bank: a };
  }

  let now = 1 + rnd() * 6;          // the Start click handler
  let cause = 0;
  let rounds = 0;
  const mobF = o.mob ? 1.15 : 1;

  for (;;) {
    // ── a round ──
    let d = draw();
    let timerStart = now;
    ev('R', now, cause, streak, d.pat.join(''), d.bank.join(''), Math.round(dur()));
    rounds++;
    let where, fill, filled, held;
    function reset() { where = d.bank.map(() => -1); fill = d.pat.map(() => -1); filled = 0; held = -1; }
    reset();
    let fT = frames.atOrAfter(timerStart + dur());
    let pauseAt = rnd() < o.pPause ? now + rnd() * dur() * 0.97 : Infinity;
    let t = now, first = true, result = null;

    // Everything that can happen before the player's next input at tn.
    // Returns 'time' | 'gone' (paused for good) | 'reset' (resumed, new runes) | null.
    function interrupts(tn) {
      for (;;) {
        const m = Math.min(fT, pauseAt, xAt);
        if (m >= tn) return null;
        if (m === xAt) {
          ev('X', xAt); streak = 0; best = 0; xAt = Infinity;
          fT = frames.atOrAfter(timerStart + dur());
          continue;
        }
        if (m === fT) { ev('E', fT, 'time'); t = fT; return 'time'; }
        // paused mid-round
        const tp = pauseAt; pauseAt = Infinity;
        const left = Math.max(0, dur() - (tp - timerStart));   // what the trainer keeps (ms, float)
        ev('P', tp); held = -1;
        if (rnd() < 0.1) return 'gone';                        // never came back
        const tU = tp + logn(4000, 1.2);
        if (xAt < tU) { ev('X', xAt); streak = 0; best = 0; xAt = Infinity; }
        ev('U', tU);
        d = draw(); reset();
        timerStart = tU - (dur() - left);
        ev('R', tU, 3, streak, d.pat.join(''), d.bank.join(''), Math.round(left));
        rounds++;
        fT = frames.atOrAfter(timerStart + dur());
        t = tU; first = true;
        return 'reset';
      }
    }

    play: for (;;) {
      if (filled === d.pat.length) { result = 'win'; break; }
      const avail = [];
      for (let i = 0; i < where.length; i++) if (where[i] === -1) avail.push(i);
      if (!avail.length) {                                     // a tile was lost: wait for the timer
        const x = interrupts(Infinity);
        if (x === 'reset') continue;
        result = x; break;
      }
      // grab
      let wait;
      if (first && o.anticipate && t === now && cause !== 0) {
        // clicks ahead of a round it knows is coming; a press before the round
        // does nothing and is repeated
        wait = 40 + 60 * N();
        while (wait < 0) wait += logn(130, 0.3);
      } else wait = (first ? logn(S.react, 0.25) : logn(S.back * (0.85 + 0.03 * d.pat.length), 0.3)) * mobF;
      let tg = t + wait;
      let x = interrupts(tg);
      if (x === 'reset') continue; if (x) { result = x; break; }
      t = tg;
      const gx = N() * S.sd, gy = N() * S.sd;
      if (Math.abs(gx) > 0.5 || Math.abs(gy) > 0.5) { first = false; t += logn(120, 0.3); continue; } // missed the tile
      // sometimes lift a placed tile back out and put it straight back
      let tile, from = -1;
      if (filled > 0 && rnd() < 0.01) {
        const placed = []; for (let s = 0; s < fill.length; s++) if (fill[s] >= 0) placed.push(s);
        from = pick(placed); tile = fill[from]; fill[from] = -1; filled--;
      } else tile = pick(avail);
      ev('L', t, tile, from, r2(gx), r2(gy));
      where[tile] = -3; held = tile; first = false;
      // a second press while holding (another button / finger): the first tile is lost
      if (rnd() < 0.002) {
        const others = []; for (let i = 0; i < where.length; i++) if (where[i] === -1) others.push(i);
        if (others.length) {
          const t2 = t + logn(150, 0.3);
          x = interrupts(t2);
          if (x === 'reset') continue; if (x) { result = x; break; }
          t = t2;
          const t2i = pick(others);
          let ax, ay;                                          // only a press on a tile picks one up
          do { ax = N() * S.sd; ay = N() * S.sd; } while (Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5);
          ev('L', t, t2i, -1, r2(ax), r2(ay));
          where[tile] = -2; tile = t2i; where[tile] = -3; held = tile;
        }
      }
      // drag and drop
      const td = t + logn(S.drag, 0.3) * mobF;
      x = interrupts(td);
      if (x === 'reset') continue; if (x) { result = x; break; }
      t = td; held = -1;
      const rune = d.bank[tile];
      const empty = []; for (let s = 0; s < fill.length; s++) if (fill[s] < 0) empty.push(s);
      let slot = -1;
      if (from >= 0) slot = from;
      else if (rnd() < S.wrong) slot = pick(empty);
      else { for (const s of empty) if (d.pat[s] === rune) { slot = s; break; } }
      const dx = N() * S.sd, dy = N() * S.sd;
      if (slot < 0 || rnd() < S.miss || Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        ev('D', t, tile, -1, 0); where[tile] = -1; continue;
      }
      if (d.pat[slot] !== rune) { ev('D', t, tile, slot, 0, r2(dx), r2(dy)); where[tile] = -1; continue; }
      ev('D', t, tile, slot, 1, r2(dx), r2(dy));
      where[tile] = slot; fill[slot] = tile; filled++;
    }

    if (result === 'win') {
      streak++;
      if (streak > best) { best = streak; snap(streak, 'submit'); }
      const tn = t + R.GAP_WIN + late();
      if (xAt < tn) { ev('X', xAt); streak = 0; best = 0; xAt = Infinity; }
      if (rnd() < o.pHide || rounds > 900) {                  // panel hidden between rounds: the run ends
        ev('E', t + rnd() * 900, 'hide'); closed = true;
        snap(streak, 'end');
        break;
      }
      now = tn; cause = 1;
      continue;
    }
    if (result === 'gone') { snap(streak, 'end'); break; }
    // timeout: the attempt is over
    snap(streak, 'end');
    if (attempt + 1 >= o.attempts) break;
    now = t + R.GAP_FAIL + late();
    if (xAt < now) { ev('X', xAt); best = 0; xAt = Infinity; }   // reset in the restart gap: logged after the E
    attempt++; log = newLog(attempt); streak = 0; cause = 2;
  }
  return out;
}

// ── suite a: honest players ───────────────────────────────────────────────────
function honest() {
  const skills = Object.keys(SKILLS);
  let runs = 0, checks = 0, invalid = 0, review = 0, mismatch = 0, runsReviewed = 0, maxScore = 0, maxEv = 0, maxBytes = 0;
  const margins = { cycleMed: 1e9, cycleSd: 1e9, dragSd: 1e9, dropSd: 1e9, liftSd: 1e9, fixZ: -1e9, pairZ: -1e9, keyP: 1, slotP: 1, layoutP: 1, pausesMinusWins: -1e9 };
  const fails = [], reviews = [];
  for (let k = 0; k < 2400; k++) {
    const sk = skills[k % skills.length];
    const base = SKILLS[sk], S = {};
    for (const key in base) S[key] = base[key] * (0.85 + rnd() * 0.3);    // each person a little different
    const long = rnd() < 0.35;
    const o = {
      comp: (k >> 1) % 2 === 1, mob: rnd() < 0.3, hz: pick([60, 60, 60, 120, 144, 30]),
      ping: pick([0, 150, 300]), w: pick([360, 800, 1280, 1920]), skill: S,
      best: rnd() < 0.5 ? 0 : Math.floor(rnd() * 8),
      attempts: long ? 5 + Math.floor(rnd() * 25) : 1 + Math.floor(rnd() * 3),
      // (0.25: someone who keeps switching trainers mid-round)
      pPause: pick([0, 0.02, 0.08, 0.25]), pHide: pick([0, 0.005, 0.02]), pX: 0.02,
      anticipate: (sk === 'top' || sk === 'elite') && rnd() < 0.3,
    };
    const list = simRun(o);
    runs++;
    let rev = false;
    for (const c of list) {
      checks++;
      maxEv = Math.max(maxEv, c.log.ev.length);
      const r = Q.check(c.type, c.log, { platform: c.platform, claimed: c.claimed });
      if (r.verdict === 'invalid') { invalid++; if (fails.length < 5) fails.push([sk, c.kind, c.claimed, r.reasons]); }
      else if (r.score !== c.claimed) { mismatch++; if (fails.length < 5) fails.push([sk, c.kind, 'claimed ' + c.claimed + ' got ' + r.score, r.reasons, r.stats]); }
      if (r.verdict === 'review') { review++; rev = true; if (reviews.length < 5) reviews.push([sk, c.kind, c.claimed, r.reasons]); }
      if (r.verdict !== 'invalid') maxScore = Math.max(maxScore, r.score);
      maxBytes = Math.max(maxBytes, JSON.stringify(c.log).length);
      const st = r.stats;
      margins.slotP = Math.min(margins.slotP, Number(st.slotP)); margins.layoutP = Math.min(margins.layoutP, Number(st.layoutP));
      if ((st.pauses || 0) >= 5) margins.pausesMinusWins = Math.max(margins.pausesMinusWins, st.pauses - st.wins);
      if (st.wins >= 10) {
        if (st.cycleMed !== undefined) margins.cycleMed = Math.min(margins.cycleMed, st.cycleMed);
        if (st.cycleSd !== undefined) margins.cycleSd = Math.min(margins.cycleSd, st.cycleSd);
        if (st.dragSd !== undefined) margins.dragSd = Math.min(margins.dragSd, st.dragSd);
        if (st.dropSdX !== undefined) margins.dropSd = Math.min(margins.dropSd, st.dropSdX, st.dropSdY);
        if (st.liftSdX !== undefined) margins.liftSd = Math.min(margins.liftSd, st.liftSdX, st.liftSdY);
        margins.fixZ = Math.max(margins.fixZ, st.fixZ); margins.pairZ = Math.max(margins.pairZ, st.pairZ);
        margins.keyP = Math.min(margins.keyP, Number(st.keyP));
      }
    }
    if (rev) runsReviewed++;
  }
  const rate = runsReviewed / runs;
  const ok = invalid === 0 && mismatch === 0 && rate <= 0.005;
  console.log((ok ? 'PASS' : 'FAIL') + ' honest: ' + runs + ' runs, ' + checks + ' checks, invalid ' + invalid +
    ', score mismatch ' + mismatch + ', review ' + review + ' checks / ' + runsReviewed + ' runs (' + (rate * 100).toFixed(2) +
    '%), best score ' + maxScore + ', longest log ' + maxEv + ' events / ' + maxBytes + ' bytes');
  console.log('    closest honest values (runs with >= 10 wins): ' + JSON.stringify(margins));
  for (const f of fails) console.log('   ', JSON.stringify(f));
  for (const f of reviews) console.log('    review:', JSON.stringify(f));
  return { ok, runs, invalid, review: runsReviewed, mismatch };
}

// ── suite b: forgeries ────────────────────────────────────────────────────────
// An honest log to start from: a good casual player's submit at streak >= 12.
function honestBase(comp, minScore, skill) {
  for (let tries = 0; tries < 400; tries++) {
    const list = simRun({ comp, mob: false, hz: 60, ping: 0, w: 1280, skill: skill || SKILLS.good, best: 0, attempts: 3,
      pPause: 0, pHide: 0, pX: 0 });
    let bestC = null;
    for (const c of list) if (c.kind === 'submit' && c.claimed >= minScore && (!bestC || c.claimed > bestC.claimed)) bestC = c;
    if (bestC) return bestC;
  }
  throw new Error('no honest base log reached ' + minScore);
}

// A bot's log, built like simRun but with the bot's own timing and aim.
function botLog(comp, rounds, timing) {
  const type = 'staff' + (comp ? '-comp' : '');
  const log = { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: 1280, h: 768, mob: false, ping: 0 }, ev: [] };
  let t = 3, streak = 0, lastWin = 0;
  const push = (e) => { e[1] = Math.round(e[1]); log.ev.push(e); };
  for (let k = 0; k < rounds; k++) {
    const len = R.patternLen(streak, comp), pat = [];
    for (let i = 0; i < len; i++) pat.push(R.KEYS[Math.floor(rnd() * 10)]);
    const bank = pat.slice();
    for (let i = bank.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = bank[i]; bank[i] = bank[j]; bank[j] = x; }
    if (k > 0) t = lastWin + 1000 + timing.gap();
    push(['R', t, k ? 1 : 0, streak, pat.join(''), bank.join(''), R.timerDur(streak, comp) * 1000]);
    const used = bank.map(() => false);
    for (let s = 0; s < len; s++) {
      let tile = -1;
      for (let i = 0; i < len; i++) if (!used[i] && bank[i] === pat[s]) { tile = i; break; }
      used[tile] = true;
      t += s === 0 ? timing.react() : timing.back();
      push(['L', t, tile, -1, timing.off(), timing.off()]);
      t += timing.drag();
      push(['D', t, tile, s, 1, timing.off(), timing.off()]);
    }
    streak++; lastWin = t;
  }
  return { type, log, claimed: streak };
}

function forgeries() {
  const results = [];
  function judge(name, f, want) {
    const r = Q.check(f.type, f.log, { platform: 'C', claimed: f.claimed });
    // want: 'reject' (invalid or review) or 'cut' (anything, but proven score below the claim)
    const caught = want === 'cut'
      ? (r.verdict !== 'valid' || r.score < f.claimed)
      : (r.verdict === 'invalid' || r.verdict === 'review');
    results.push({ name, verdict: r.verdict + (want === 'cut' ? ' score ' + r.score + '/' + f.claimed : ''), caught, why: r.reasons[0] || (caught ? '' : JSON.stringify(r.stats)) });
  }
  const base = honestBase(false, 12, SKILLS.top);
  const baseC = honestBase(true, 8, SKILLS.top);
  const L = () => clone(base);

  // 1. no events + a claim
  judge('no events + claim 15', { type: 'staff', log: { v: 1, rv: 1, type: 'staff', a: 0, env: {}, ev: [] }, claimed: 15 }, 'reject');
  // 2. a claim above the logged points
  { const f = L(); f.claimed += 6; judge('claim 6 above the logged points', f, 'cut'); }
  // 3. an honest log played at double speed
  { const f = L(); f.log.ev.forEach((e) => { e[1] = Math.round(e[1] * 0.5); }); judge('honest log, times x0.5', f, 'reject'); }
  // 4. a wrong rune judged placed
  {
    const f = L(); let done = false;
    for (const e of f.log.ev) if (e[0] === 'D' && e[3] >= 0 && e[4] === 0) { e[4] = 1; done = true; break; }
    if (!done) { // no wrong drop in the base: make one
      let rr = null;
      for (const e of f.log.ev) { if (e[0] === 'R') rr = e; if (e[0] === 'D' && e[4] === 1) { const bank = rr[5]; const other = bank.split('').findIndex((c, i) => c !== bank[e[2]]); if (other >= 0) { e[2] = other; done = true; break; } } }
    }
    judge('outcome flipped (wrong rune marked placed)', f, 'reject');
  }
  // 4b. a matching rune judged wrong
  { const f = L(); for (const e of f.log.ev) if (e[0] === 'D' && e[4] === 1) { e[4] = 0; break; } judge('outcome flipped (placed marked wrong)', f, 'reject'); }
  // 5. rounds with the wrong number of runes for the streak
  {
    const f = L(); let n = 0;
    for (const e of f.log.ev) if (e[0] === 'R' && ++n === 6) { e[4] = e[4].slice(0, 3); e[5] = e[5].slice(0, 3); }
    judge('a round shorter than the streak gives', f, 'reject');
  }
  { const f = L(); for (const e of f.log.ev) if (e[0] === 'R') { e[4] = 'Z' + e[4].slice(1); e[5] = 'Z' + e[5].slice(1); break; } judge('a rune that is not in the set', f, 'reject'); }
  { const f = L(); for (const e of f.log.ev) if (e[0] === 'R') { e[5] = e[5].replace(/./, e[5][0] === 'A' ? 'B' : 'A'); break; } judge('a bank that is not the round\'s runes', f, 'reject'); }
  { const f = L(); for (const e of f.log.ev) if (e[0] === 'R' && e[2] === 1) { e[6] += 3000; break; } judge('a round timer longer than the rules', f, 'reject'); }
  // 6. cherry-picked easiest targets: every round one rune, bank in slot order
  {
    const f = botLog(false, 14, humanTiming());
    for (const e of f.log.ev) if (e[0] === 'R') { e[4] = 'A'.repeat(e[4].length); e[5] = e[4]; }
    judge('cherry-picked targets (one rune per round)', f, 'reject');
  }
  {
    const f = botLog(false, 14, humanTiming());
    // distinct runes (no duplicates), and the bank already in slot order
    for (const e of f.log.ev) if (e[0] === 'R') { const s = R.KEYS.slice(0, e[4].length).join(''); e[4] = s; e[5] = s; }
    // re-point the drops at the right tiles (tile i -> slot i)
    fixDrops(f.log);
    judge('cherry-picked targets (bank already in slot order)', f, 'reject');
  }
  {
    const f = botLog(false, 16, humanTiming());
    // two runes per round, a different pair each round: every rune about as
    // common as the others, but rounds full of repeats
    let k = 0;
    for (const e of f.log.ev) if (e[0] === 'R') {
      const a = R.KEYS[k % 10], b = R.KEYS[(k + 3) % 10]; k++;
      let s = ''; for (let i = 0; i < e[4].length; i++) s += i % 2 ? b : a;
      e[4] = s; e[5] = s.split('').sort(() => rnd() - 0.5).join('');
    }
    fixDrops(f.log);
    judge('cherry-picked targets (two runes per round)', f, 'reject');
  }
  // 7. a perfect bot: instant, dead-centre
  judge('perfect bot (instant, dead centre)', botLog(false, 15, { gap: () => 0, react: () => 1, back: () => 60, drag: () => 60, off: () => 0 }), 'reject');
  judge('perfect aim, human timing', botLog(false, 15, Object.assign(humanTiming(), { off: () => 0 })), 'reject');
  // 8. a metronome
  judge('metronome bot', botLog(false, 15, { gap: () => 5, react: () => 250, back: () => 300, drag: () => 200, off: humanTiming().off }), 'reject');
  judge('metronome bot (comp)', botLog(true, 12, { gap: () => 5, react: () => 250, back: () => 300, drag: () => 200, off: humanTiming().off }), 'reject');
  // 9. superhuman speed
  judge('superhuman (~40 ms per move)', botLog(false, 15, { gap: () => rnd() * 20, react: () => logn(40, 0.3), back: () => logn(40, 0.3), drag: () => logn(40, 0.3), off: humanTiming().off }), 'reject');
  judge('fast bot (~40 ms reactions, human moves)', botLog(false, 25, { gap: () => rnd() * 3, react: () => logn(40, 0.2), back: () => logn(120, 0.2), drag: () => logn(90, 0.2), off: humanTiming().off }), 'reject');
  // 10. impossible order
  {
    const f = L();
    const i = f.log.ev.findIndex((e) => e[0] === 'D');
    const tmp = f.log.ev[i]; f.log.ev[i] = f.log.ev[i - 1]; f.log.ev[i - 1] = tmp;
    const t0 = f.log.ev[i - 1][1]; f.log.ev[i - 1][1] = f.log.ev[i][1]; f.log.ev[i][1] = t0;
    judge('a drop before its pick-up', f, 'reject');
  }
  {
    const f = L();
    // the next round logged before the last drop of the round before it
    const k = f.log.ev.findIndex((e, j) => j > 0 && e[0] === 'R' && e[2] === 1);
    const prev = f.log.ev[k - 1];
    f.log.ev.splice(k - 1, 1); f.log.ev.splice(k, 0, prev);
    const tt = f.log.ev[k - 1][1]; f.log.ev[k - 1][1] = f.log.ev[k][1]; f.log.ev[k][1] = tt;
    judge('next round before the round was cleared', f, 'reject');
  }
  // 11. a replayed honest log with a higher claim
  { const f = clone(baseC); f.claimed = f.claimed * 3; judge('replayed honest log, claim x3', f, 'cut'); }
  // 12. trainer specific
  {
    const f = L(); let rr = -1, first = null, lastL = null;
    // the same tile placed in two slots (picked up and dropped again)
    for (const e of f.log.ev) {
      if (e[0] === 'R') { rr++; first = null; }
      if (e[0] === 'L') lastL = e;
      if (rr === 5 && e[0] === 'D' && e[4] === 1) { if (!first) first = e; else { e[2] = first[2]; lastL[2] = first[2]; lastL[3] = -1; break; } }
    }
    judge('one tile placed twice', f, 'reject');
  }
  {
    const f = L();
    // round 8 cleared 2 s after its timer ran out (the timeout left out)
    let seen = 0;
    for (let i = 0; i < f.log.ev.length; i++) {
      const e = f.log.ev[i];
      if (e[0] === 'R' && ++seen === 8) {
        const lim = e[1] + e[6] + 2000;
        let j = i + 1; while (j < f.log.ev.length && f.log.ev[j][0] !== 'R') j++;
        // push this round's last event and everything after it later
        const shift = Math.max(0, lim - f.log.ev[j - 1][1]);
        for (let q = j - 1; q < f.log.ev.length; q++) f.log.ev[q][1] += shift;
        break;
      }
    }
    judge('a round cleared 2 s after its timer', f, 'cut');
  }
  {
    // paused 6 s into an 8 s round (2 s left), resumed with the full 8 s
    const f = { type: 'staff', claimed: 1, log: { v: 1, rv: 1, type: 'staff', a: 0, env: { w: 1280, h: 768, mob: false, ping: 0 }, ev: [
      ['R', 3, 0, 0, 'AB', 'BA', 8000], ['P', 6003], ['U', 20000], ['R', 20000, 3, 0, 'EF', 'FE', 8000],
      ['L', 26000, 0, -1, 0.1, -0.2], ['D', 26300, 0, 1, 1, 0.05, 0.1], ['L', 27400, 1, -1, -0.2, 0.1], ['D', 27700, 1, 0, 1, 0.2, -0.1],
    ] } };
    judge('resume with more time than was left', f, 'reject');
  }
  { const f = L(); const r0 = f.log.ev[0]; f.log.a = Math.floor(r0[1] / R.ATTEMPT_MIN) + 3; r0[2] = 2; judge('attempt ' + f.log.a + ' starting ' + r0[1] + ' ms into the run', f, 'reject'); }
  { const f = L(); for (const e of f.log.ev) if (e[0] === 'D' && e[4] === 1) { e[5] = 0.9; break; } judge('a drop outside the slot', f, 'reject'); }
  { const f = L(); for (const e of f.log.ev) if (e[0] === 'R' && e[2] === 1) { e[3] += 1; break; } judge('a round at the wrong streak', f, 'reject'); }
  { const g = L(); g.log.ev.splice(2, 0, ['E', g.log.ev[1][1], 'time']); judge('a timeout before the timer ran out', g, 'reject'); }
  { const f = L(); const e = f.log.ev.find((x) => x[0] === 'R' && x[2] === 1); e[2] = 3; judge('a resumed round with no pause', f, 'reject'); }
  { const f = L(); f.log.ev.push(['Q', f.log.ev[f.log.ev.length - 1][1]]); judge('an unknown event', f, 'reject'); }
  { const f = L(); f.log.type = 'staff-comp'; f.type = 'staff-comp'; judge('a casual log sent as comp', f, 'reject'); }

  // ── added in review ──
  // 13. time for free: pause and resume again and again at one moment, each
  //     time claiming the 150 ms coarse-clock allowance, until the round's
  //     timer is full again (then play it out slowly)
  judge('chained pause/resume to refill the timer', chainLog(false, 14), 'reject');
  // 14. easy layouts a modified client could pick
  {
    const f = botLog(false, 20, fastHuman());
    for (const e of f.log.ev) if (e[0] === 'R') e[5] = e[4].split('').reverse().join('');
    fixDrops(f.log);
    judge('bank always the slots reversed', f, 'reject');
  }
  {
    const f = botLog(false, 20, fastHuman());
    for (const e of f.log.ev) if (e[0] === 'R') { const L = e[4].length; e[5] = e[4].slice(1) + e[4][0]; if (L < 2) e[5] = e[4]; }
    fixDrops(f.log);
    judge('bank always the slots shifted by one', f, 'reject');
  }
  {
    const f = botLog(false, 20, fastHuman());
    for (const e of f.log.ev) if (e[0] === 'R') {
      const s = 'ABEFHNRUWX'.slice(0, e[4].length);
      e[4] = s; e[5] = s.split('').sort(() => rnd() - 0.5).join('');
    }
    fixDrops(f.log);
    judge('the same runes in the same slots every round', f, 'reject');
  }
  judge('re-rolled (pause/resume) until the bank sits over its slots', rerollLog(false, 20), 'reject');
  // 15. wrong types and odd values
  const mut = (name, fn) => { const f = L(); fn(f.log.ev, f); judge(name, f, 'reject'); };
  mut('ok given as true', (ev) => { ev.find((e) => e[0] === 'D' && e[4] === 1)[4] = true; });
  mut('tile given as a string', (ev) => { const e = ev.find((x) => x[0] === 'L'); e[2] = String(e[2]); });
  mut('timer given as a string', (ev) => { ev[0][6] = '8000'; });
  mut('pattern given as an array', (ev) => { ev[0][4] = ev[0][4].split(''); });
  mut('NaN tile (JSON null)', (ev) => { const e = ev.find((x) => x[0] === 'L'); e[2] = null; });
  mut('tile 1e9', (ev) => { const e = ev.find((x) => x[0] === 'L'); e[2] = 1e9; });
  mut('slot -2', (ev) => { ev.find((e) => e[0] === 'D')[3] = -2; });
  mut('offset 1e300', (ev) => { ev.find((e) => e[0] === 'D' && e[4] === 1)[5] = 1e300; });
  mut('a duplicated drop', (ev) => { const i = ev.findIndex((e) => e[0] === 'D'); ev.splice(i + 1, 0, ev[i].slice()); });
  mut('a duplicated next round', (ev) => { const i = ev.findIndex((e, j) => j > 0 && e[0] === 'R'); ev.splice(i + 1, 0, ev[i].slice()); });
  mut('an end with a number for a reason', (ev) => { ev.push(['E', ev[ev.length - 1][1], 5]); });
  mut('attempt number as a string', (ev, f) => { f.log.a = '0'; });
  mut('a negative time', (ev) => { ev[0][1] = -5; });
  mut('streak field -1', (ev) => { ev[0][3] = -1; });
  mut('a lowercase rune', (ev) => { ev[0][4] = ev[0][4].toLowerCase(); ev[0][5] = ev[0][5].toLowerCase(); });
  {
    // the rounds after an end do not count
    const f = L(); let wins = 0, cut = -1;
    for (let i = 0; i < f.log.ev.length; i++) { const e = f.log.ev[i]; if (e[0] === 'R' && e[2] === 1 && ++wins === 5) { cut = i; break; } }
    f.log.ev.splice(cut, 0, ['E', f.log.ev[cut][1], 'hide']);
    judge('rounds played on after an end', f, 'cut');
  }
  { const f = L(); f.claimed = 1000000; judge('a claim of a million', f, 'cut'); }
  { const f = L(); f.log.ev.forEach((e) => { e[1] = e[1] * 2; }); judge('honest log, times x2 (rounds past their timers)', f, 'cut'); }

  let ok = true;
  for (const x of results) { if (!x.caught) ok = false; }
  console.log((ok ? 'PASS' : 'FAIL') + ' forgeries: ' + results.filter((x) => x.caught).length + '/' + results.length + ' caught');
  for (const x of results) console.log('    ' + (x.caught ? 'ok  ' : 'MISS') + ' ' + x.name + ' -> ' + x.verdict + (x.why ? ' (' + x.why + ')' : ''));
  return { ok, results };
}

// A quick but human player: fast enough for 9 runes in the 5 s timer.
function fastHuman() {
  return { gap: () => late(), react: () => logn(260, 0.2), back: () => logn(260, 0.2), drag: () => logn(190, 0.2), off: () => r2(Math.max(-0.5, Math.min(0.5, N() * 0.17))) };
}
function humanTiming() {
  return { gap: () => late(), react: () => logn(280, 0.25), back: () => logn(330, 0.3), drag: () => logn(260, 0.3), off: () => r2(Math.max(-0.5, Math.min(0.5, N() * 0.17))) };
}
function drawRound(len) {
  const pat = []; for (let i = 0; i < len; i++) pat.push(R.KEYS[Math.floor(rnd() * 10)]);
  const bank = pat.slice();
  for (let i = bank.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = bank[i]; bank[i] = bank[j]; bank[j] = x; }
  return { pat: pat.join(''), bank: bank.join('') };
}
// Plays a round of a hand-made log with human timing; returns the time of the win.
function placeAll(log, t, pat, bank, tm) {
  const used = bank.split('').map(() => false);
  for (let s = 0; s < pat.length; s++) {
    let tile = -1; for (let i = 0; i < bank.length; i++) if (!used[i] && bank[i] === pat[s]) { tile = i; break; }
    used[tile] = true;
    t += s === 0 ? tm.react() : tm.back();
    log.ev.push(['L', Math.round(t), tile, -1, tm.off(), tm.off()]);
    t += tm.drag();
    log.ev.push(['D', Math.round(t), tile, s, 1, tm.off(), tm.off()]);
  }
  return t;
}
// From streak 8 on (the timer at its floor), each round: wait until 100 ms
// before the timer runs out, then pause/resume at that moment over and over,
// each time with 140 ms more than was left, until the timer is full again;
// then play the round at a slow human pace.
function chainLog(comp, rounds) {
  const type = 'staff' + (comp ? '-comp' : '');
  const log = { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: 1280, h: 768, mob: false, ping: 0 }, ev: [] };
  const tm = humanTiming(); let t = 3, streak = 0;
  for (let k = 0; k < rounds; k++) {
    const len = R.patternLen(streak, comp), dur = R.timerDur(streak, comp) * 1000;
    let d = drawRound(len);
    if (k > 0) t += 1000 + tm.gap();
    log.ev.push(['R', Math.round(t), k ? 1 : 0, streak, d.pat, d.bank, dur]);
    if (streak >= 8) {
      const tp = Math.round(t) + dur - 100;
      let left = 100;
      while (left < dur) {
        left = Math.min(dur, left + 140);
        d = drawRound(len);
        log.ev.push(['P', tp], ['U', tp], ['R', tp, 3, streak, d.pat, d.bank, left]);
      }
      t = tp;
    }
    const per = (dur - 600) / len;                       // uses the whole (refilled) timer
    t = placeAll(log, t, d.pat, d.bank, { react: () => logn(per * 0.5, 0.1), back: () => logn(per * 0.55, 0.1), drag: () => logn(per * 0.4, 0.1), off: tm.off });
    streak++;
  }
  return { type, log, claimed: streak };
}
// Resume re-draws the round: pause/resume (at a human pace, the timer is
// frozen meanwhile) until the bank has at least 3 runes over their own slots.
function rerollLog(comp, rounds) {
  const type = 'staff' + (comp ? '-comp' : '');
  const log = { v: 1, rv: Q.RULES_VER, type, a: 0, env: { w: 1280, h: 768, mob: false, ping: 0 }, ev: [] };
  const tm = fastHuman(); let t = 3, streak = 0;
  const fixed = (d) => { let x = 0; for (let i = 0; i < d.pat.length; i++) if (d.pat[i] === d.bank[i]) x++; return x; };
  for (let k = 0; k < rounds; k++) {
    const len = R.patternLen(streak, comp), dur = R.timerDur(streak, comp) * 1000;
    let d = drawRound(len);
    if (k > 0) t += 1000 + tm.gap();
    log.ev.push(['R', Math.round(t), k ? 1 : 0, streak, d.pat, d.bank, dur]);
    let tS = t, tries = 0;
    while (len >= 5 && fixed(d) < 3 && tries++ < 200 && dur - (t + 60 - tS) > dur / 2) {
      t += 60; const left = Math.round(dur - (t - tS));
      log.ev.push(['P', Math.round(t)]);
      t += logn(900, 0.3);
      d = drawRound(len);
      log.ev.push(['U', Math.round(t)], ['R', Math.round(t), 3, streak, d.pat, d.bank, left]);
      tS = t - (dur - left);
    }
    t = placeAll(log, t, d.pat, d.bank, tm);
    streak++;
  }
  return { type, log, claimed: streak };
}
// After rewriting a round's runes, point every placement at a tile of the right rune.
function fixDrops(log) {
  let bank = '', pat = '', used = null;
  for (const e of log.ev) {
    if (e[0] === 'R') { pat = e[4]; bank = e[5]; used = bank.split('').map(() => false); }
    if (e[0] === 'L') e._slotFor = null;
    if (e[0] === 'D' && e[4] === 1) {
      let tile = -1;
      for (let i = 0; i < bank.length; i++) if (!used[i] && bank[i] === pat[e[3]]) { tile = i; break; }
      used[tile] = true;
      e[2] = tile;
    }
  }
  // the L before each D picks up the same tile
  for (let i = 1; i < log.ev.length; i++) if (log.ev[i][0] === 'D' && log.ev[i - 1][0] === 'L') log.ev[i - 1][2] = log.ev[i][2];
  for (const e of log.ev) delete e._slotFor;
}

// ── suite c: the real IIFE ────────────────────────────────────────────────────
// staff.iife.js runs in a vm context with a stub DOM, a scheduler (timers that
// fire late, rAF at 30-144 Hz with dropped frames and stalls, a hidden browser
// tab that stops rAF), and a clock that can be coarse (up to 100 ms, as in
// privacy modes) and can jump between two reads (a GC pause inside the game's
// code). A random player drags tiles (right, wrong, nowhere, off the canvas, a
// second press while holding, lifting placed tiles), hides and shows the panel
// at any moment (mid-round, mid-drag, in the gaps, right after a timeout),
// resumes, presses Start again, resets scores, walks away for over an hour, or
// pauses overnight. Every submitted log must be valid with score = claim; every
// attempt's full log must not be invalid.
const vm = require('vm');
const fs = require('fs');
const pathM = require('path');
const RULES_PATH = '@qte-scratch/wt2/js/qte-rules.js';
const SRC = {
  rules: fs.readFileSync(RULES_PATH, 'utf8'),
  staff: fs.readFileSync(pathM.join(__dirname, 'staff.rules.js'), 'utf8'),
  iife: fs.readFileSync(process.env.STAFF_IIFE || pathM.join(__dirname, 'staff.iife.js'), 'utf8'),
};

function page(o) {
  let clock = 5000 + rnd() * 5000;
  const q = o.quantum;
  const W = {};
  W.window = W;
  W.IS_MOBILE = !!o.mob;
  W.innerWidth = o.w; W.innerHeight = 800;
  W.performance = {
    now() {
      clock += rnd() * 0.02;                                   // code runs
      if (rnd() < o.gcP) clock += 5 + rnd() * 80;              // a GC pause between two reads
      return q ? Math.floor(clock / q) * q : clock;
    },
  };
  // the game's own Math.random from the seeded stream, so a failure repeats
  const M = Object.create(Math); M.random = rnd;
  W.Date = Date; W.Math = M; W.Promise = Promise; W.JSON = JSON; W.Object = Object; W.Array = Array;
  let timers = [], rafs = [], rafId = 0, tid = 0, lastFrame = clock, tabHiddenUntil = -1;
  W.setTimeout = (fn, ms) => { timers.push({ id: ++tid, at: clock + ms + late(), fn }); return tid; };
  W.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
  W.requestAnimationFrame = (fn) => { rafs.push({ id: ++rafId, fn }); return rafId; };
  W.cancelAnimationFrame = (id) => { rafs = rafs.filter((r) => r.id !== id); };
  const winL = {};
  W.addEventListener = (t, fn) => { (winL[t] = winL[t] || []).push(fn); };
  W.dispatchEvent = (e) => { (winL[e.type] || []).forEach((fn) => fn(e)); return true; };
  const store = {};
  W.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  W._playQteSfx = () => { if (rnd() < o.sfxThrow) throw new Error('audio'); };
  W._qteCompMode = !!o.comp;
  const submits = [];
  W._sbSubmitScore = (type, score, packet) => { submits.push({ type, score, log: packet.log, at: clock }); };
  W._sbStartQteRun = () => Promise.resolve(null);
  W.console = { log() {} };
  const css = o.css;                                            // CSS px per canvas px
  function el(id) {
    const ls = {};
    return {
      id, style: {}, textContent: '', width: 0, height: 0,
      addEventListener: (t, fn) => { (ls[t] = ls[t] || []).push(fn); },
      // a listener that throws is reported by the browser, not passed on
      fire(t, e) { (ls[t] || []).forEach((fn) => { try { fn(e); } catch (err) { if (err.message !== 'audio') throw err; } }); },
      click() { this.fire('click', {}); },
      parentElement: { clientWidth: o.wrap },
      getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
      getBoundingClientRect() { return { left: 30, top: 200, width: this.width * css, height: this.height * css }; },
    };
  }
  const els = {};
  W.document = { getElementById: (id) => (els[id] = els[id] || el(id)) };
  vm.createContext(W);
  vm.runInContext(SRC.rules, W);
  vm.runInContext(SRC.staff, W);
  vm.runInContext(SRC.iife, W);

  function step(until) {
    // everything scheduled up to `until`, in time order
    for (;;) {
      let next = until, kind = null;
      for (const t of timers) if (t.at < next) { next = t.at; kind = 't'; }
      let fAt = Infinity;
      if (rafs.length) {
        const iv = 1000 / o.hz;
        fAt = lastFrame + iv;
        if (fAt < clock) fAt = lastFrame + Math.ceil((clock - lastFrame) / iv) * iv;
        const u = rnd();
        if (u < 0.02) fAt += iv * 2; else if (u < 0.023) fAt += 50 + rnd() * 250;
        if (fAt < tabHiddenUntil) fAt = tabHiddenUntil + rnd() * iv;
        if (fAt < next) { next = fAt; kind = 'f'; }
      }
      if (!kind) { if (until > clock) clock = until; return; }
      if (next > clock) clock = next;
      if (kind === 't') {
        const t = timers.reduce((a, b) => (b.at < a.at ? b : a));
        timers = timers.filter((x) => x !== t);
        if (clock < tabHiddenUntil) { t.at = Math.max(tabHiddenUntil, Math.ceil(clock / 1000) * 1000); timers.push(t); continue; }
        t.fn();
      } else {
        lastFrame = clock;
        const fr = rafs; rafs = [];
        for (const r of fr) r.fn(clock);
      }
    }
  }
  return {
    W, els, submits,
    get clock() { return clock; },
    step,
    hideTab(ms) { tabHiddenUntil = clock + ms; },
    setHz(hz) { o.hz = hz; },
    get tabHidden() { return clock < tabHiddenUntil; },
  };
}

// The random player. Reads the round from the log (as the bot does) and aims
// at the stub canvas like a person.
function monkey(o) {
  const P = page(o);
  const W = P.W, canvas = P.els['staff-qte-canvas'];
  const startBtn = P.els['staff-qte-start-btn'], resumeBtn = P.els['staff-qte-resume-btn'];
  const logs = new Set();
  let shown = true, holding = false, nextHideAt = P.clock + logn(o.hideEvery, 0.8);
  function run() { return W.QteRules.Run.current; }
  // the panel shown again, sometimes at another width (the trainer resizes on show)
  function show() { if (rnd() < 0.2) canvas.parentElement.clientWidth = pick([360, 520, 700, 1000, 1400]); W._onStaffQteShow(); }
  function geom(len) {
    const CW = canvas.width, scale = CW / 520, TW = Math.round(46 * scale);
    const BANK_Y = Math.round(32 * scale), SLOT_Y = Math.round(210 * scale);
    const x0 = (CW - (len * TW + (len - 1) * 8)) / 2;
    const at = (i, y, jx, jy) => ({ clientX: 30 + (x0 + i * (TW + 8) + TW / 2 + jx * TW) * o.css, clientY: 200 + (y + TW / 2 + jy * TW) * o.css });
    return { bank: (i, jx, jy) => at(i, BANK_Y, jx, jy), slot: (i, jx, jy) => at(i, SLOT_Y, jx, jy), nowhere: () => ({ clientX: 30 + 5 * o.css, clientY: 200 + (SLOT_Y + TW + 30) * o.css }) };
  }
  // the live round, as the log has it
  function round() {
    const r = run(); if (!r) return null;
    logs.add(r.log);
    const ev = r.log.ev;
    let k = ev.length - 1; while (k >= 0 && ev[k][0] !== 'R') k--;
    if (k < 0) return null;
    const R0 = ev[k], len = R0[4].length, where = [], fill = [];
    for (let i = 0; i < len; i++) { where.push(-1); fill.push(-1); }
    let held = -1, live = true;
    for (let j = k + 1; j < ev.length; j++) {
      const e = ev[j];
      if (e[0] === 'L') { if (e[3] >= 0) fill[e[3]] = -1; if (held >= 0) where[held] = -2; held = e[2]; where[held] = -3; }
      else if (e[0] === 'D') { held = -1; if (e[4] === 1) { fill[e[3]] = e[2]; where[e[2]] = e[3]; } else where[e[2]] = -1; }
      else if (e[0] === 'P' || e[0] === 'E') live = false;
    }
    if (fill.every((x) => x >= 0)) live = false;                  // cleared: the gap before the next round
    return { pat: R0[4], bank: R0[5], len, where, fill, held, live, t: R0[1] };
  }
  const jit = () => Math.max(-0.49, Math.min(0.49, N() * o.sd));
  function pt(type, p) {
    const e = Object.assign({ preventDefault() {} }, p);
    if (o.mob) {
      const tt = type === 'mousedown' ? 'touchstart' : type === 'mouseup' ? 'touchend' : type === 'mousemove' ? 'touchmove' : null;
      if (tt) {
        const touch = { clientX: p.clientX, clientY: p.clientY };
        canvas.fire(tt, { preventDefault() {}, touches: tt === 'touchend' ? [] : [touch], changedTouches: [touch] });
        // a browser that still sends the tap's compatibility mouse events
        if (tt === 'touchend' && rnd() < 0.05) { canvas.fire('mousedown', e); canvas.fire('mouseup', e); }
        return;
      }
    }
    canvas.fire(type, e);
  }

  let until = P.clock + o.minutes * 60000;
  let idleUntil = o.idleAt ? P.clock + o.idleAt : Infinity, idleDone = false, nightDone = false, renewed = 0;
  while (P.clock < until) {
    let wait = logn(o.pace, 0.35);
    if (rnd() < 0.03) wait = 30 + rnd() * 60;                   // a hurried move now and then
    P.step(P.clock + wait);
    if (P.tabHidden) continue;
    // walk away for over an hour: the trainer keeps restarting itself
    if (!idleDone && P.clock > idleUntil) {
      idleDone = true; holding = false;
      const hz = o.hz; P.setHz(4);                                // (cheaper; timeouts just land later)
      const rBefore = run(), away = 65 * 60000 + rnd() * 30 * 60000;
      P.step(P.clock + away); until += away;
      P.setHz(hz);
      if (run() !== rBefore) renewed++;
      continue;
    }
    // pause overnight in the middle of a round, then come back and resume
    if (o.night && !nightDone && P.clock > until - o.minutes * 30000) {
      const rr = round();
      if (rr && rr.live && shown) {
        nightDone = true; W._onStaffQteHide(); shown = false; holding = false;
        P.step(P.clock + 13 * 3600000); until += 13 * 3600000; show(); shown = true;
        continue;
      }
    }
    if (rnd() < o.tabP) { P.hideTab(1000 + rnd() * 30000); continue; }
    if (P.clock > nextHideAt) {                                   // the panel hidden at any moment
      nextHideAt = P.clock + logn(o.hideEvery, 0.8);
      W._onStaffQteHide(); shown = false; holding = false;
      P.step(P.clock + (rnd() < 0.3 ? 200 + rnd() * 600 : logn(3000, 1)));
      show(); shown = true;
      continue;
    }
    if (rnd() < o.resetP) { W.dispatchEvent({ type: 'alb-scores-reset' }); continue; }
    // the staff tab clicked while on it (or matchmaking's second show): the
    // canvas hides and Start shows while the run goes on unseen
    if (rnd() < 0.003) { show(); continue; }
    if (resumeBtn.style.display === '') { resumeBtn.click(); continue; }
    if (startBtn.style.display !== 'none') {
      if (rnd() < 0.3) W._qteCompMode = !W._qteCompMode;         // the mode button works while Start shows
      startBtn.click(); continue;
    }
    const rr = round();
    if (!rr || !rr.live || canvas.style.display === 'none') { holding = false; continue; }
    if (P.clock - (P.W.QteRules.Run.current.t0 + rr.t) > o.giveUpMs) continue;   // let this one time out
    const g = geom(rr.len);
    if (rr.held >= 0 && holding) {
      const u = rnd();
      if (u < 0.02) { canvas.fire('mouseleave', { preventDefault() {} }); holding = false; continue; }
      if (u < 0.03) {                                             // a second press while holding
        const avail = []; for (let i = 0; i < rr.len; i++) if (rr.where[i] === -1) avail.push(i);
        if (avail.length) { pt('mousedown', g.bank(pick(avail), jit(), jit())); continue; }
      }
      pt('mousemove', g.slot(0, 0, 0));
      const rune = rr.bank[rr.held], empty = [];
      for (let s = 0; s < rr.len; s++) if (rr.fill[s] < 0) empty.push(s);
      let target = null;
      const v = rnd();
      if (v < 0.05) target = g.nowhere();
      else if (v < 0.12 && empty.length) target = g.slot(pick(empty), jit(), jit());
      else if (v < 0.15) target = g.slot(Math.floor(rnd() * rr.len), pick([-0.5, 0.5]), pick([-0.5, 0.5]));   // the slot's very edge
      else {
        let s = -1; for (const x of empty) if (rr.pat[x] === rune) { s = x; break; }
        target = s >= 0 ? g.slot(s, jit(), jit()) : g.nowhere();
      }
      pt('mouseup', target); holding = false;
      continue;
    }
    // pick something up
    const avail = []; for (let i = 0; i < rr.len; i++) if (rr.where[i] === -1) avail.push(i);
    const placed = []; for (let s = 0; s < rr.len; s++) if (rr.fill[s] >= 0) placed.push(s);
    const u = rnd();
    if (u < 0.04 && placed.length) pt('mousedown', g.slot(pick(placed), jit(), jit()));
    else if (u < 0.07) pt('mousedown', g.nowhere());
    else if (avail.length) pt('mousedown', g.bank(pick(avail), u < 0.09 ? pick([-0.5, 0.5]) : jit(), jit()));
    else continue;
    holding = true;
  }
  const r = run(); if (r) logs.add(r.log);
  return { submits: P.submits, logs: Array.from(logs), comp: !!o.comp, mob: !!o.mob, renewed, night: nightDone };
}

function iifeSuite() {
  const res = { runs: 0, submits: 0, logs: 0, unsendable: 0, invalid: 0, review: 0, mismatch: 0, maxClaim: 0, overMaxT: 0, renewed: 0, nights: 0 };
  const bad = [];
  const n = +process.env.IIFE_RUNS || 160;
  for (let k = 0; k < n; k++) {
    const kind = k % 8;
    const o = {
      comp: k % 2 === 1, mob: rnd() < 0.3, hz: pick([30, 60, 60, 120, 144]),
      quantum: pick([0, 0.005, 0.1, 1, 16.667, 100, 100]), gcP: pick([0, 0.01, 0.05]),
      w: 1280, wrap: pick([360, 700, 1000, 1400]), css: pick([1, 1, 0.8, 1.25]),
      sd: 0.12 + rnd() * 0.08, pace: 180 + rnd() * 120, minutes: 3 + rnd() * 6,
      hideEvery: pick([15000, 40000, 120000]), tabP: 0.002, resetP: 0.001, sfxThrow: pick([0, 0, 0.01]),
      giveUpMs: rnd() < 0.2 ? 3000 + rnd() * 4000 : Infinity,
      idleAt: kind === 6 ? 60000 : 0, night: kind === 7,
    };
    if (kind === 5) Object.assign(o, { pace: 135 + rnd() * 25, hideEvery: 600000, tabP: 0.0003, minutes: 12 });   // a quick player, long streaks
    const out = monkey(o);
    res.runs++; res.renewed += out.renewed; if (out.night) res.nights++;
    const platform = out.mob ? 'M' : 'C';
    for (const s of out.submits) {
      res.submits++;
      const endMs = s.log.ev.length ? s.log.ev[s.log.ev.length - 1][1] : 0;
      if (endMs > Q.LIMITS.MAX_T) res.overMaxT++;
      const r = Q.check(s.type, s.log, { platform, claimed: s.score });
      res.maxClaim = Math.max(res.maxClaim, s.score);
      if (r.verdict === 'invalid') { res.invalid++; bad.unshift(['submit', k, s.score, o, r.reasons]); }
      else if (r.verdict === 'review') { res.review++; bad.unshift(['submit review', k, s.score, r.reasons]); }
      else if (r.score !== s.score) {
        res.mismatch++; if (bad.length < 6) bad.push(['submit score', s.score, r.score, r.reasons, r.stats]);
        if (process.env.DUMP) console.log('run', k, JSON.stringify(o), JSON.stringify(s.log));
      }
    }
    for (const log of out.logs) {
      res.logs++;
      if (!log.ev.length) continue;
      // a round paused overnight: the trainer never sends this log (see submit())
      if (log.ev[log.ev.length - 1][1] > Q.LIMITS.MAX_T) { res.unsendable++; continue; }
      const r = Q.check(log.type, log, { platform, claimed: 0 });
      if (r.verdict === 'invalid') { res.invalid++; if (bad.length < 6) bad.push(['attempt log', o.quantum, o.gcP, r.reasons, JSON.stringify(log.ev.slice(0, 3))]); }
    }
  }
  const ok = res.invalid === 0 && res.review === 0 && res.mismatch === 0 && res.overMaxT === 0 && res.submits > n;
  console.log((ok ? 'PASS' : 'FAIL') + ' real IIFE: ' + JSON.stringify(res));
  for (const b of bad) console.log('   ', JSON.stringify(b).slice(0, 600));
  return { ok, res };
}

// ONLY=honest|forgeries|iife runs one suite (the others count as passed).
const only = process.env.ONLY || '';
const skip = { ok: true, results: [], res: null };
const h = !only || only === 'honest' ? honest() : skip;
const f = !only || only === 'forgeries' ? forgeries() : skip;
const c = !only || only === 'iife' ? iifeSuite() : skip;
const pass = h.ok && f.ok && c.ok;
console.log(pass ? 'ALL PASS' : 'FAILED');
module.exports = { honest: h, forgeries: f.results, iife: c.res, monkey, page, simRun, SKILLS };
process.exitCode = pass ? 0 : 1;
