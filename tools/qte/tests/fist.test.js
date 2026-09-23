// Node test for the fist trainer's rules: node fist.test.js
//   a) honest players simulated from the rules -> 0 invalid, 0 mismatch, review <= 0.5%
//      (fine and coarse performance.now() clocks, ping sim, touch, pauses,
//      keys held through the gap)
//   b) forgeries -> each invalid, review, or scored far below its claim
//   c) the real IIFE (fist.iife.js) driven in a fake DOM: every submit it makes
//      must check valid at exactly the claimed score, and every attempt log it
//      writes must check out (no invalid) - a structured player, then a chaos
//      player that hides / shows / resumes / clicks Start at random moments,
//      with the ping sim, touch, a small log budget and a short run renewal
'use strict';
require('./_paths.js');
const fs = require('fs');
const path = require('path');
const Q = require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
require(require('path').join(__dirname, '..', '..', '..', 'js', 'qte-rules.js'));
const F = Q.trainers.fist;

let failures = 0;
function fail(msg) { failures++; console.log('  FAIL ' + msg); }

// ── randomness ─────────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function normal(rng) { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
function lognormal(rng, median, sigma) { return median * Math.exp(sigma * normal(rng)); }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

function newLog(type, a, env) { return { v: 1, rv: Q.RULES_VER, type, a, env, ev: [] }; }
function copyLog(log, n) { return { v: log.v, rv: log.rv, type: log.type, a: log.a, env: log.env, ev: log.ev.slice(0, n == null ? log.ev.length : n) }; }

// A browser's rounded performance.now(): Firefox-style clamping with jitter
// (each value goes to the tick below or above, at a random midpoint per tick).
function makeClock(p) {
  if (!p) return x => x;
  return x => {
    const b = Math.floor(x / p);
    const mid = (Math.imul((b | 0) ^ 0x5bd1e995, 0x27d4eb2d) >>> 0) / 4294967296 * p;
    return (x - b * p >= mid) ? (b + 1) * p : b * p;
  };
}

// ── a) honest simulation ─────────────────────────────────────────────────────
// Skill: first-key reaction (lognormal median/sigma), key-to-key interval,
// wrong-key rate per key, hesitation rate per key (a long stall mid-sequence).
const SKILLS = {
  new:    { react: 430, sr: 0.30, iv: 280, si: 0.40, err: 0.030,  hes: 0.030 },
  casual: { react: 340, sr: 0.28, iv: 190, si: 0.38, err: 0.012,  hes: 0.015 },
  good:   { react: 290, sr: 0.25, iv: 140, si: 0.35, err: 0.005,  hes: 0.008 },
  top:    { react: 250, sr: 0.22, iv: 100, si: 0.33, err: 0.0015, hes: 0.004 },
  elite:  { react: 220, sr: 0.20, iv: 75,  si: 0.30, err: 0.0004, hes: 0.002 },
};

// One session: Start, then attempts until the player leaves. Writes exactly
// what the IIFE writes, in the IIFE's order, with its timers.
function simSession(rng, P, sink) {
  const type = 'fist' + (P.comp ? '-comp' : '');
  const env = { w: 1280, h: 720, mob: P.mobile, ping: P.ping };
  const sk = P.skill;
  const pingKey = P.mobile ? 0 : P.ping;               // the ping sim delays keys only
  const flagBase = P.mobile ? 2 : (P.ping > 0 ? 4 : 0);
  const reactMed = sk.react + (P.mobile ? 60 : 0);
  const ivMed = sk.iv + (P.mobile ? 50 : 0);
  const J = makeClock(P.clock || 0);
  let now = 500 + rng() * 3000;
  let run = null, attemptOver = false, len = F.LEN_START, streak = 0, best = 0;
  let lastSLen = 0;                                      // log length at the attempt's last S
  let lastKeyD = -1;

  function startRun() { run = { t0: now, attempt: 0, closed: false, log: newLog(type, 0, env) }; lastSLen = 0; }
  function ev(code, ...f) {
    const t = Math.max(0, Math.round(J(now) - J(run.t0)));
    if (!run.closed && run.log.ev.length < Q.LIMITS.MAX_EVENTS) run.log.ev.push([code, t, ...f]);
  }
  function late() { return rng() < 0.02 ? rng() * 100 : rng() * 4; }
  function jit() { return rng() < 0.03 ? rng() * 50 : rng() * 2; }
  function drawSeq() { let s = ''; for (let i = 0; i < len; i++) s += Math.floor(rng() * 4); return s; }
  function keyEv(d, h, f) { lastKeyD = d; if (f) ev('K', d, h, f); else ev('K', d, h); }

  // The player's presses for a sequence shown at `shownAt`: all planned at
  // once (people type a visible sequence without waiting for feedback).
  function plan(seq, shownAt, firstMed, firstSig) {
    const keys = [];
    if (streak >= P.maxPoints) return keys;              // done: let it time out
    let press = shownAt + lognormal(rng, firstMed, firstSig);
    let judged = 0;
    for (let k = 0; k < seq.length; k++) {
      if (k > 0) {
        press += lognormal(rng, ivMed, sk.si);
        if (rng() < sk.hes) {
          const stall = lognormal(rng, 1500, 0.6);
          // sometimes the key is held through the stall: one autorepeat
          if (stall > 600 && !P.mobile && rng() < 0.1) {
            const tr = press + 500 + pingKey + jit();
            judged = Math.max(judged, tr);
            keys.push({ t: judged, d: keys.length ? keys[keys.length - 1].d : +seq[0], f: 1 | (P.ping > 0 ? 4 : 0) });
          }
          press += stall;
        }
      }
      let d = +seq[k];
      if (rng() < sk.err) d = (d + 1 + Math.floor(rng() * 3)) % 4;
      judged = Math.max(judged, press + pingKey + jit());
      keys.push({ t: judged, d, f: flagBase });
    }
    return keys;
  }

  // Plays one round from R (already logged). Returns 'done' | 'fail' | 'time'.
  function playRound(seq) {
    let cur = 0;
    const limit = F.timeLimit(P.comp, len);
    let ticksLeft = limit, segStart = now, tickN = 1;
    let nextTick = segStart + F.TICK_MS + late();
    let pauseAt = rng() < P.pauseP ? now + rng() * limit * 1000 : Infinity;
    let keys = plan(seq, now, reactMed, sk.sr);
    // a key pressed during the gap, delayed by the ping sim past the new R
    if (pingKey > 0 && rng() < 0.005) keys.unshift({ t: now + rng() * Math.min(pingKey, 250), d: Math.floor(rng() * 4), f: flagBase });
    // the last key of the round before, still held: its autorepeat is judged
    // as soon as the new round starts
    if (!P.mobile && lastKeyD >= 0 && rng() < P.holdP) keys.unshift({ t: now + rng() * 40 + pingKey, d: lastKeyD, f: 1 | (P.ping > 0 ? 4 : 0) });
    keys.sort((x, y) => x.t - y.t);
    let ki = 0;
    for (;;) {
      const kt = ki < keys.length ? keys[ki].t : Infinity;
      const next = Math.min(kt, nextTick, pauseAt);
      now = next;
      if (next === nextTick) {
        ticksLeft--;
        if (ticksLeft <= 0) { ev('E', 'time'); return 'time'; }
        tickN++;
        nextTick = segStart + tickN * F.TICK_MS + late();
      } else if (next === pauseAt) {
        ev('P');
        now += 1000 + lognormal(rng, 6000, 1.0);         // away, then Resume
        seq = drawSeq();
        ev('U', seq);
        cur = 0;
        segStart = now; tickN = 1;
        nextTick = segStart + F.TICK_MS + late();
        pauseAt = rng() < 0.2 ? now + rng() * ticksLeft * 1000 : Infinity;
        keys = plan(seq, now, 650, 0.35);                 // hand back from the mouse
        ki = 0;
      } else {
        const k = keys[ki++];
        const h = k.d === +seq[cur] ? 1 : 0;
        keyEv(k.d, h, k.f);
        if (!h) { ev('E', 'fail'); return 'fail'; }
        cur++;
        if (cur === seq.length) return 'done';
      }
    }
  }

  function endAttempt() {
    if (streak > 0) sink({ type, log: copyLog(run.log, lastSLen), claimed: streak, kind: 'final', P });
    sink({ type, log: copyLog(run.log), claimed: streak, kind: 'ended', P, sample: true });
  }

  startRun();
  let attempts = 0;
  for (;;) {
    // startRound
    if (attemptOver) {
      attemptOver = false;
      if (++attempts >= P.maxAttempts) break;           // leaves during the restart: reset, no E
      if (now - run.t0 > F.RENEW_RUN_MS) startRun();
      else { run.attempt++; run.log = newLog(type, run.attempt, env); lastSLen = 0; }
    }
    const seq = drawSeq();
    ev('R', seq);
    const out = playRound(seq);
    if (out === 'done') {
      // leaving the panel during the flash or the gap resets the run
      if (rng() < P.hideP) {
        const at = now + rng() * (F.FLASH_MS + F.NEXT_MS);
        const tS = now + F.FLASH_MS + late();
        if (at >= tS) { now = tS; streak++; len = F.nextLength(len); ev('S', streak); lastSLen = run.log.ev.length; }
        now = Math.max(now, at);
        ev('E', 'hide');
        endAttempt();
        run.closed = true;
        if (rng() < 0.5) break;
        now += 2000 + lognormal(rng, 20000, 1);
        startRun(); len = F.LEN_START; streak = 0; attempts++;
        continue;
      }
      now += F.FLASH_MS + late();
      streak++;
      len = F.nextLength(len);
      ev('S', streak);
      lastSLen = run.log.ev.length;
      if (streak > best) {
        best = streak;
        if (streak <= 12 || streak % 60 === 0) sink({ type, log: copyLog(run.log), claimed: streak, kind: 'submit', P });
      }
      now += F.NEXT_MS + late();
    } else {
      endAttempt();
      streak = 0; len = F.LEN_START; attemptOver = true;
      now += F.RESTART_MS + late();
    }
  }
}

function suiteHonest() {
  const rng = mulberry32(12345);
  const skills = ['new', 'new', 'casual', 'casual', 'casual', 'good', 'good', 'good', 'top', 'top', 'elite'];
  const SESSIONS = 3000;
  const tally = { sessions: 0, checks: 0, invalid: 0, review: 0, mismatch: 0, points: 0, maxPoints: 0, maxEvents: 0, maxBytes: 0 };
  const perKind = {}, perClock = {};
  const examples = [];
  const margins = { reactSd: 1e9, reactMad: 1e9, reactMedian: 1e9, keyIvSd: 1e9, keyIvMad: 1e9, keyIvMedian: 1e9, drawP: 1, stepP: 1 };
  const tickMargins = { reactSameTick: 0, keyIvSameTick: 0, keyIvInTick: 0, reactMedian: 1e9, reactSd: 1e9, keyIvSd: 1e9 };
  const coarseMargins = { reactInTick: 0, keyIvInTick: 0, reactMean: 1e9, keyIvSd: 1e9 };
  const reuse = { reusedArrows: 0, replayedTimings: 0 };
  for (let s = 0; s < SESSIONS; s++) {
    const skillName = pick(rng, skills);
    const P = {
      skill: SKILLS[skillName], skillName,
      comp: rng() < 0.5,
      mobile: rng() < 0.2,
      ping: pick(rng, [0, 0, 0, 150, 300, 500]),
      pauseP: pick(rng, [0, 0.005, 0.03]),
      hideP: pick(rng, [0, 0.002, 0.01]),
      holdP: pick(rng, [0, 0, 0.01, 0.05]),
      clock: pick(rng, [0, 0, 0, 0, 0, 1, 16.667, 100]),
      maxAttempts: 1 + Math.floor(rng() * 8),
      maxPoints: pick(rng, [20, 150, 400, 700]),
    };
    tally.sessions++;
    simSession(rng, P, snap => {
      if (snap.sample && rng() > 0.3) return;
      const r = Q.check(snap.type, snap.log, { platform: P.mobile ? 'M' : 'C', claimed: snap.claimed });
      tally.checks++;
      perKind[snap.kind] = (perKind[snap.kind] || 0) + 1;
      perClock[P.clock] = (perClock[P.clock] || 0) + 1;
      tally.maxEvents = Math.max(tally.maxEvents, snap.log.ev.length);
      if (snap.claimed >= 25 && !r.stats.clockMs) {
        const st = r.stats;
        for (const k of ['reactSd', 'reactMad', 'reactMedian', 'keyIvSd', 'keyIvMad', 'keyIvMedian']) if (st[k] != null) margins[k] = Math.min(margins[k], st[k]);
        if (st.drawP != null) margins.drawP = Math.min(margins.drawP, st.drawP);
        if (st.stepP != null) margins.stepP = Math.min(margins.stepP, st.stepP);
      }
      if (!r.stats.clockMs) for (const k in reuse) if (r.stats[k] > reuse[k]) reuse[k] = r.stats[k];
      if (r.stats.clockMs >= F.COARSE_MS) {
        for (const k of ['reactInTick', 'keyIvInTick']) if (r.stats[k] != null) coarseMargins[k] = Math.max(coarseMargins[k], r.stats[k]);
        for (const k of ['reactMean', 'keyIvSd']) if (r.stats[k] != null && (k !== 'keyIvSd' || snap.claimed >= 25)) coarseMargins[k] = Math.min(coarseMargins[k], r.stats[k]);
      } else if (r.stats.clockMs >= F.TICK_MS_MIN) {
        for (const k of ['reactSameTick', 'keyIvSameTick', 'keyIvInTick']) if (r.stats[k] != null) tickMargins[k] = Math.max(tickMargins[k], r.stats[k]);
        if (snap.claimed >= 25) for (const k of ['reactMedian', 'reactSd', 'keyIvSd']) if (r.stats[k] != null) tickMargins[k] = Math.min(tickMargins[k], r.stats[k]);
      }
      if (snap.claimed > tally.maxPoints) {
        tally.maxPoints = snap.claimed;
        tally.maxBytes = JSON.stringify(snap.log).length;
      }
      if (r.verdict === 'invalid') { tally.invalid++; if (examples.length < 6) examples.push(skillName + ' clock ' + P.clock + ' ' + JSON.stringify(r.reasons)); }
      else if (r.verdict === 'review') { tally.review++; if (examples.length < 6) examples.push(skillName + ' clock ' + P.clock + ' ' + JSON.stringify(r.reasons) + ' ' + JSON.stringify(r.stats)); }
      if (r.verdict !== 'invalid' && r.score !== snap.claimed) { tally.mismatch++; if (examples.length < 6) examples.push('mismatch ' + r.score + ' vs ' + snap.claimed + ' ' + JSON.stringify(r.stats)); }
      tally.points += snap.kind === 'final' ? snap.claimed : 0;
    });
  }
  const reviewRate = tally.review / tally.checks;
  const ok = tally.invalid === 0 && tally.mismatch === 0 && reviewRate <= 0.005;
  console.log((ok ? 'PASS' : 'FAIL') + ' honest: ' + tally.sessions + ' sessions, ' + tally.checks + ' logs checked ' + JSON.stringify(perKind) + ' by clock ' + JSON.stringify(perClock) +
    ' -> invalid ' + tally.invalid + ', review ' + tally.review + ' (' + (100 * reviewRate).toFixed(3) + '%), score mismatch ' + tally.mismatch +
    '; biggest ' + tally.maxPoints + ' pts = ' + tally.maxBytes + ' B, max events ' + tally.maxEvents);
  console.log('    closest honest fine-clock logs (25+ pts): ' + JSON.stringify(margins));
  console.log('    closest honest 1/60 s clock logs: ' + JSON.stringify(tickMargins) + '; 100 ms clock: ' + JSON.stringify(coarseMargins) + '; most reuse (fine clock) ' + JSON.stringify(reuse));
  examples.forEach(x => console.log('    ' + x));
  if (!ok) failures++;
  return tally;
}

// ── b) forgeries ─────────────────────────────────────────────────────────────
// A clean honest log to mutate: a good casual player with no ping.
function honestLog(seed, minPts, overrides) {
  const rng = mulberry32(seed);
  let best = null;
  for (let tries = 0; tries < 200 && !best; tries++) {
    simSession(rng, Object.assign({ skill: SKILLS.good, comp: false, mobile: false, ping: 0, pauseP: 0, hideP: 0, holdP: 0, clock: 0, maxAttempts: 3, maxPoints: 60 }, overrides || {}), snap => {
      if (!best && snap.kind === 'final' && snap.claimed >= minPts) best = snap;
    });
  }
  if (!best) throw new Error('no honest log with ' + minPts + ' points');
  return best;
}

// A made-up log: rounds cleared with the given reaction / interval / arrows,
// engine-minimum gaps. opts.resumeEach: every round is paused and resumed
// (new arrows) before its first key; opts.firstFlag: flags on first keys;
// opts.quant: every time floored to a multiple of this.
function synth(opts) {
  const rng = mulberry32(opts.seed || 7);
  const ev = [];
  let t = 0, len = F.LEN_START;
  const mk = () => Array.from({ length: len }, () => Math.floor(rng() * 4)).join('');
  for (let i = 0; i < opts.points; i++) {
    let s = opts.arrows ? opts.arrows(len, i, rng) : mk();
    ev.push(['R', Math.round(t), s]);
    if (opts.resumeEach) {
      ev.push(['P', Math.round(t) + 1]);
      t += 2;
      s = opts.arrows ? opts.arrows(len, i, rng) : mk();
      ev.push(['U', Math.round(t), s]);
    }
    t += opts.react(rng, i);
    for (let k = 0; k < s.length; k++) {
      if (k) t += opts.iv(rng, i, k);
      const f = k === 0 && opts.firstFlag ? opts.firstFlag : opts.flags;
      if (f) ev.push(['K', Math.round(t), +s[k], 1, f]);
      else ev.push(['K', Math.round(t), +s[k], 1]);
    }
    t = Math.round(t) + (opts.flash == null ? F.FLASH_MS : opts.flash) + (opts.slack == null ? 2 : opts.slack);
    ev.push(['S', t, i + 1]);
    t += (opts.next == null ? F.NEXT_MS : opts.next) + (opts.slack == null ? 2 : opts.slack);
    len = F.nextLength(len);
  }
  if (opts.quant) {
    let last = 0;
    ev.forEach(e => { e[1] = Math.max(last, Math.round(Math.floor(e[1] / opts.quant) * opts.quant)); last = e[1]; });
  }
  return { v: 1, rv: Q.RULES_VER, type: opts.type || 'fist', a: 0, env: { w: 1280, h: 720, mob: false, ping: 0 }, ev };
}
const human = { react: (rng) => lognormal(rng, 280, 0.25), iv: (rng) => lognormal(rng, 130, 0.35) };

function suiteForgeries() {
  const H = honestLog(99, 25);
  const Hc = H.claimed;
  const E = honestLog(5, 3);   // for a failed attempt
  // an attempt that ended on a wrong key
  let failed = null;
  simSession(mulberry32(77), { skill: SKILLS.casual, comp: true, mobile: false, ping: 0, pauseP: 0, hideP: 0, holdP: 0, clock: 0, maxAttempts: 6, maxPoints: 60 }, snap => {
    if (!failed && snap.kind === 'ended' && snap.log.ev.length && snap.log.ev[snap.log.ev.length - 1][2] === 'fail' && snap.claimed >= 3) failed = snap;
  });
  const cases = [];
  function add(name, type, log, claimed) { cases.push({ name, type, log, claimed }); }
  function mut(src, fn) { const l = copyLog(src.log); l.ev = l.ev.map(e => e.slice()); fn(l.ev, l); return l; }
  const firstS = ev => ev.findIndex(x => x[0] === 'S');

  add('no events + claim', 'fist', { v: 1, rv: 1, type: 'fist', a: 0, env: {}, ev: [] }, 10);
  add('claim above the logged points', H.type, copyLog(H.log), Hc + 5);
  add('honest log, times x0.5', H.type, mut(H, ev => ev.forEach(e => { e[1] = Math.round(e[1] * 0.5); })), Hc);
  add('a hit whose key is the wrong arrow', H.type, mut(H, ev => { const e = ev.find(x => x[0] === 'K'); e[2] = (e[2] + 1) % 4; }), Hc);
  if (failed) {
    add('a logged miss marked hit (and its end dropped)', failed.type, mut(failed, ev => {
      const e = ev[ev.length - 2]; e[3] = 1; ev.pop();
    }), failed.claimed + 1);
  }
  add('an arrow outside 0-3', H.type, mut(H, ev => { const e = ev.filter(x => x[0] === 'R')[3]; e[2] = '4' + e[2].slice(1); }), Hc);
  add('one arrow too many for the streak', H.type, mut(H, ev => { const e = ev.filter(x => x[0] === 'R')[2]; e[2] += '0'; }), Hc);
  add('rounds that never grow (all 2 arrows)', 'fist', synth({ points: 20, react: human.react, iv: human.iv, arrows: (len, i, rng) => '' + Math.floor(rng() * 4) + Math.floor(rng() * 4) }), 20);
  add('first round already 5 arrows', 'fist', synth({ points: 10, react: human.react, iv: human.iv, arrows: (len, i, rng) => Array.from({ length: Math.min(len + 3, 9) }, () => Math.floor(rng() * 4)).join('') }), 10);
  add('cherry-picked arrows (all up)', 'fist', synth({ points: 30, react: human.react, iv: human.iv, arrows: len => '0'.repeat(len) }), 30);
  add('cherry-picked arrows (one direction per round)', 'fist', synth({ points: 30, react: human.react, iv: human.iv, arrows: (len, i) => String(i % 4).repeat(len) }), 30);
  add('reused pattern (0123 0123 ...)', 'fist', synth({ points: 30, react: human.react, iv: human.iv, arrows: len => Array.from({ length: len }, (_, k) => k % 4).join('') }), 30);
  add('reused pattern (alternating 0202 ...)', 'fist', synth({ points: 30, react: human.react, iv: human.iv, arrows: len => Array.from({ length: len }, (_, k) => 2 * (k % 2)).join('') }), 30);
  // a pool of 12 fair random strings per length, cycled: counts and steps stay fair
  const pool = {}; const prng = mulberry32(31337);
  for (let L = 2; L <= 9; L++) pool[L] = Array.from({ length: 12 }, () => Array.from({ length: L }, () => Math.floor(prng() * 4)).join(''));
  add('targets reused (a pool of 12 strings per length)', 'fist', synth({ points: 120, react: human.react, iv: human.iv, arrows: (len, i, rng) => pool[len][Math.floor(rng() * 12)] }), 120);
  // one human-looking timing pattern per length, replayed every round
  const pat = {}; const trng = mulberry32(4711);
  for (let L = 2; L <= 9; L++) pat[L] = Array.from({ length: L }, () => Math.round(lognormal(trng, 130, 0.35)));
  add('timings replayed (one human pattern per length)', 'fist', synth({ points: 60, react: human.react, iv: (rng, i, k) => pat[Math.min(i + 2, 9)][k] }), 60);
  add('perfect bot (instant, zero spread)', 'fist', synth({ points: 40, react: () => 1, iv: () => 0, slack: 0 }), 40);
  add('metronome bot (250 ms + 100 ms)', 'fist', synth({ points: 40, react: () => 250, iv: () => 100 }), 40);
  add('metronome bot with 1 ms jitter', 'fist-comp', synth({ type: 'fist-comp', points: 40, react: (rng) => 250 + rng(), iv: (rng) => 100 + rng() }), 40);
  add('metronome under the 40 ms filter (35 ms keys)', 'fist', synth({ points: 40, react: human.react, iv: () => 35 }), 40);
  add('metronome padded with bunched keys and stalls', 'fist', synth({ points: 40, react: human.react, iv: (rng) => { const u = rng(); return u < 0.2 ? 1 : u < 0.3 ? 900 + 600 * rng() : 60; } }), 40);
  add('superhuman reactions (~40 ms)', 'fist', synth({ points: 40, react: (rng) => 40 + 8 * normal(rng), iv: human.iv }), 40);
  add('reactions just over the floor (101-140 ms)', 'fist', synth({ points: 40, react: (rng) => 101 + 39 * rng(), iv: human.iv }), 40);
  add('fixed reaction padded with a few long ones', 'fist', synth({ points: 40, react: (rng) => rng() < 0.2 ? 2500 + 1000 * rng() : 180, iv: human.iv }), 40);
  add('instant reactions hidden behind a pause/resume each round', 'fist', synth({ points: 40, resumeEach: true, react: () => 5, iv: human.iv }), 40);
  add('instant reactions flagged as autorepeat', 'fist', synth({ points: 40, firstFlag: 1, react: () => 5, iv: human.iv }), 40);
  add('keys faster than hands (~15 ms)', 'fist', synth({ points: 40, react: human.react, iv: (rng) => 5 + 20 * rng() }), 40);
  add('coarse-clock bot (100 ms ticks, instant keys)', 'fist', synth({ points: 40, quant: 100, react: () => 5, iv: () => 1 }), 40);
  add('coarse-clock metronome (100 ms ticks, 100 ms keys)', 'fist', synth({ points: 40, quant: 100, react: (rng) => 300 + 100 * Math.floor(rng() * 3), iv: () => 100 }), 40);
  add('coarse-clock bot, keys inside one tick', 'fist', synth({ points: 40, quant: 100, react: human.react, iv: () => 8 }), 40);
  add('1/60 s clock, fixed reaction padded with a few long ones', 'fist', synth({ points: 40, quant: 50 / 3, react: (rng) => rng() < 0.2 ? 2500 + 1000 * rng() : 180, iv: human.iv }), 40);
  add('1/60 s clock metronome (3 ticks) padded with bunched keys and stalls', 'fist', synth({ points: 40, quant: 50 / 3, react: human.react, iv: (rng) => { const u = rng(); return u < 0.1 ? 1 : u < 0.15 ? 900 + 600 * rng() : 50; } }), 40);
  add('1/60 s clock bot, keys inside one tick', 'fist', synth({ points: 40, quant: 50 / 3, react: human.react, iv: () => 6 }), 40);
  add('fine clock, point 200 ms after the last key', 'fist', synth({ points: 20, react: human.react, iv: human.iv, flash: 200, slack: 0 }), 20);
  add('fine clock, next round 500 ms after a point', 'fist', synth({ points: 20, react: human.react, iv: human.iv, next: 500, slack: 0 }), 20);
  add('point scored before its last key', H.type, mut(H, ev => {
    const i = firstS(ev); const tmp = ev[i]; ev[i] = ev[i - 1]; ev[i - 1] = tmp; ev[i - 1][1] = ev[i][1];
  }), Hc);
  add('a key in the gap between rounds', H.type, mut(H, ev => {
    const i = firstS(ev); ev.splice(i + 1, 0, ['K', ev[i][1] + 10, 0, 1]);
  }), Hc);
  add('next round 100 ms after a point', H.type, mut(H, ev => {
    const i = firstS(ev); const shift = ev[i + 1][1] - (ev[i][1] + 100);
    for (let j = i + 1; j < ev.length; j++) ev[j][1] -= shift;
  }), Hc);
  add('resume without a pause', H.type, mut(H, ev => {
    const i = ev.findIndex(x => x[0] === 'R'); ev.splice(i + 1, 0, ['U', ev[i][1], ev[i][2]]);
  }), Hc);
  add('streak number skips ahead', H.type, mut(H, ev => { const e = ev.filter(x => x[0] === 'S')[4]; e[2] += 1; }), Hc);
  add('streak number as a string', H.type, mut(H, ev => { const e = ev.filter(x => x[0] === 'S')[0]; e[2] = String(e[2]); }), Hc);
  add('a duplicated point', H.type, mut(H, ev => { const i = firstS(ev); ev.splice(i + 1, 0, ev[i].slice()); }), Hc);
  add('a duplicated round', H.type, mut(H, ev => { const i = firstS(ev) + 1; ev.splice(i + 1, 0, ev[i].slice()); }), Hc);
  add('a log that does not start with a round', H.type, mut(H, ev => { ev.unshift(['S', 0, 1]); }), Hc);
  add('replayed honest log, higher claim', H.type, copyLog(H.log), Hc * 2);
  add('events after the end', E.type, mut(E, ev => {
    const i = ev.findIndex(x => x[0] === 'E'); if (i < 0) ev.push(['E', ev[ev.length - 1][1] + 1, 'hide']);
    const j = ev.findIndex(x => x[0] === 'E'); const t = ev[j][1];
    ev.splice(j + 1); ev.push(['R', t + 900, '01'], ['K', t + 1200, 0, 1], ['K', t + 1300, 1, 1], ['S', t + 1600, 1]);
  }), 1);
  add('every round far over its timer', 'fist', synth({ points: 20, react: (rng) => 11000 + lognormal(rng, 280, 0.25), iv: human.iv }), 20);
  add('metronome bot hiding behind autorepeat flags', 'fist', synth({ points: 40, react: human.react, iv: (rng) => 90 + rng(), flags: 1 }), 40);
  add('a key judged while paused', H.type, mut(H, ev => {
    const i = ev.findIndex(x => x[0] === 'R'); ev.splice(i + 1, 0, ['P', ev[i][1] + 50], ['K', ev[i][1] + 60, +ev[i][2][0], 1]);
  }), Hc);
  add('two rounds at once (R while live)', H.type, mut(H, ev => {
    const i = ev.findIndex(x => x[0] === 'R'); ev.splice(i + 1, 0, ['R', ev[i][1] + 5, ev[i][2]]);
  }), Hc);
  add('timeout logged on a cleared round', H.type, mut(H, ev => {
    const i = firstS(ev); ev.splice(i, 0, ['E', ev[i - 1][1] + 1, 'time']);
  }), Hc);
  add('fail with no wrong key', E.type, mut(E, ev => { ev.push(['E', ev[ev.length - 1][1] + 5, 'fail']); }), E.claimed);
  add('timeout before the timer', H.type, mut(H, ev => {
    const i = ev.findIndex(x => x[0] === 'R'); ev.splice(i + 1); ev.push(['E', ev[i][1] + 1000, 'time']);
  }), 1);
  add('log for the other mode', 'fist-comp', copyLog(H.log), Hc);
  add('a malformed key event', H.type, mut(H, ev => { const e = ev.find(x => x[0] === 'K'); e.push('x'); }), Hc);
  add('a key with direction -1', H.type, mut(H, ev => { const e = ev.find(x => x[0] === 'K'); e[2] = -1; }), Hc);
  add('a key with a huge direction', H.type, mut(H, ev => { const e = ev.find(x => x[0] === 'K'); e[2] = 1e300; }), Hc);
  add('a key with h=true', H.type, mut(H, ev => { const e = ev.find(x => x[0] === 'K'); e[3] = true; }), Hc);
  add('a key with its direction as a string', H.type, mut(H, ev => { const e = ev.find(x => x[0] === 'K'); e[2] = String(e[2]); }), Hc);
  add('arrows as a number', H.type, mut(H, ev => { const e = ev.find(x => x[0] === 'R'); e[2] = +e[2]; }), Hc);
  add('arrows as null', H.type, mut(H, ev => { const e = ev.find(x => x[0] === 'R'); e[2] = null; }), Hc);
  add('a negative time', H.type, mut(H, ev => { ev[0][1] = -5; }), Hc);
  add('a fractional time', H.type, mut(H, ev => { ev[1][1] += 0.5; }), Hc);
  add('a time over twelve hours', H.type, mut(H, ev => { ev[ev.length - 1][1] = 5e7; }), Hc);
  add('an unknown end reason', E.type, mut(E, ev => { const e = ev.find(x => x[0] === 'E'); if (e) e[2] = 'quit'; else ev.push(['E', ev[ev.length - 1][1] + 1, 'quit']); }), E.claimed);
  add('an object as a field', H.type, mut(H, ev => { const e = ev.find(x => x[0] === 'K'); e[3] = { h: 1 }; }), Hc);

  let bad = 0;
  for (const c of cases) {
    const r = Q.check(c.type, c.log, { platform: 'C', claimed: c.claimed });
    const posted = Math.min(c.claimed, r.score);
    const caught = r.verdict === 'invalid' || r.verdict === 'review' || posted * 2 <= c.claimed;
    c.verdict = r.verdict + (r.verdict === 'valid' ? ' (score ' + r.score + ' of ' + c.claimed + ')' : '') + ': ' + (r.reasons[0] || '');
    if (!caught) { bad++; fail('forgery not caught: ' + c.name + ' -> ' + JSON.stringify(r)); }
  }
  console.log((bad ? 'FAIL' : 'PASS') + ' forgeries: ' + (cases.length - bad) + '/' + cases.length + ' caught');
  cases.forEach(c => console.log('    ' + c.name + ' -> ' + c.verdict));

  // sanity: a made-up but human-like log is fine (the known limit), and the
  // same on a 100 ms clock
  const ok = Q.check('fist', synth({ points: 40, react: human.react, iv: human.iv }), { platform: 'C', claimed: 40 });
  if (ok.verdict !== 'valid' || ok.score !== 40) fail('human-like synthetic log not valid: ' + JSON.stringify(ok));
  for (const qn of [100, 50 / 3]) {
    const okC = Q.check('fist', synth({ points: 40, quant: qn, react: human.react, iv: human.iv }), { platform: 'C', claimed: 40 });
    if (okC.verdict !== 'valid' || okC.score !== 40) fail('human-like synthetic log on a ' + qn + ' ms clock not valid: ' + JSON.stringify(okC));
  }
  return cases;
}

// ── c) the real IIFE in a fake DOM ───────────────────────────────────────────
const IIFE_SRC = fs.readFileSync(path.join(__dirname, 'fist.iife.js'), 'utf8');
new Function(IIFE_SRC);   // parse check

// virtual clock + timers, shared by every world
const vt = (() => {
  const rng = mulberry32(4242);
  let clock = 0, seq = 0;
  const timers = new Map();
  let lateP = 0;                       // chance a timer fires very late (a blocked main thread)
  function addTimer(fn, ms, every) {
    const id = ++seq;
    timers.set(id, { fn, at: clock + Math.max(0, ms | 0) + rng() * 3 + (rng() < lateP ? rng() * 400 : 0), every: every ? ms : 0 });
    return id;
  }
  return {
    rng,
    now: () => clock,
    setLateP: p => { lateP = p; },
    setTimeout: (fn, ms) => addTimer(fn, ms, false),
    setInterval: (fn, ms) => addTimer(fn, ms, true),
    clear: id => { timers.delete(id); },
    advanceTo(target) {
      for (;;) {
        let best = null, bid = 0;
        for (const [id, tm] of timers) if (tm.at <= target && (!best || tm.at < best.at)) { best = tm; bid = id; }
        if (!best) break;
        clock = Math.max(clock, best.at);
        if (best.every) best.at += best.every + rng() * 2 + (rng() < lateP ? rng() * 400 : 0); else timers.delete(bid);
        best.fn();
      }
      clock = Math.max(clock, target);
    },
  };
})();
Object.defineProperty(globalThis, 'performance', { value: { now: () => vt.now() }, configurable: true, writable: true });

// Every log a run writes (each attempt's), for the whole-log checks.
const allLogs = [];
(function () {
  const origStart = Q.Run.start;
  Q.Run.start = function () {
    const run = origStart.apply(this, arguments);
    allLogs.push(run.log);
    const origNew = run.newAttempt;
    run.newAttempt = function () { const a = origNew.apply(run, arguments); allLogs.push(run.log); return a; };
    return run;
  };
})();

const submits = [];
globalThis._qteCompMode = false;
globalThis._sbStartQteRun = () => Promise.resolve({ ticket: 'x' });
globalThis._sbSubmitScore = (type, score, packet) => { submits.push({ type, score, packet, at: vt.now() }); };
globalThis._playQteSfx = () => {};
globalThis.addEventListener = () => {};

// One page load of the trainer: its own fake DOM, the ping sim, the d-pad.
function makeWorld(isMobile) {
  const rng = vt.rng;
  function hasClass(c, cls) { return (' ' + c.className + ' ').indexOf(' ' + cls + ' ') >= 0 || c.classList._s.has(cls); }
  function el(id) {
    const e = {
      id, children: [], style: { display: '' }, className: '', textContent: '', parentNode: null, dataset: {}, _h: {},
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      set innerHTML(v) {
        this.children = [];
        const re = /data-key="(\w+)"/g; let m;
        while ((m = re.exec(v))) { const b = el(''); b.className = 'fist-dpad-btn'; b.dataset.key = m[1]; this.appendChild(b); }
      },
      get innerHTML() { return ''; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      insertBefore(c) { this.children.push(c); c.parentNode = this; return c; },
      querySelectorAll(sel) { const cls = sel.replace(/^\./, ''); return this.children.filter(c => hasClass(c, cls)); },
      addEventListener(type, fn) { (this._h[type] = this._h[type] || []).push(fn); },
      fire(type, ev) { (this._h[type] || []).forEach(fn => fn(ev || {})); },
    };
    return e;
  }
  const ids = {};
  ['fist-qte-bar', 'fist-qte-status', 'fist-qte-streak', 'fist-qte-timer', 'fist-qte-start-btn', 'fist-qte-highscore',
    'fist-qte-avgtime', 'fist-qte-resume-btn', 'page-qte', 'qte-panel-fist'].forEach(id => { ids[id] = el(id); });
  ids['page-qte'].classList.add('active');
  ids['qte-panel-fist'].style.display = 'flex';
  ids['fist-qte-resume-btn'].style.display = 'none';
  el('wrap').appendChild(ids['fist-qte-bar']);
  const docHandlers = {};
  const document = {
    getElementById: id => ids[id] || null,
    createElement: () => el(''),
    addEventListener: (type, fn) => { (docHandlers[type] = docHandlers[type] || []).push(fn); },
    activeElement: { tagName: 'BODY' },
  };
  const store = {};
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  // the ping sim: the real key is swallowed and a copy dispatched later
  const copies = new WeakSet();
  globalThis._albIsPingCopy = e => copies.has(e);
  let ping = 0;

  new Function('window', 'document', 'localStorage', 'IS_MOBILE', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', IIFE_SRC)(
    globalThis, document, localStorage, isMobile, vt.setTimeout, vt.clear, vt.setInterval, vt.clear);
  const hide = globalThis._onFistQteHide, show = globalThis._onFistQteShow;
  const KEYS = [['ArrowUp', 'w', 'W'], ['ArrowDown', 's', 'S'], ['ArrowLeft', 'a', 'A'], ['ArrowRight', 'd', 'D']];
  function dispatch(e) { (docHandlers.keydown || []).forEach(fn => fn(e)); }
  const W = {
    ids, store,
    setPing(p) { ping = p; },
    key(d, repeat) {
      const e = { key: pick(rng, KEYS[d]), repeat: !!repeat, preventDefault() {} };
      if (ping > 0) { vt.setTimeout(() => { const c = Object.assign({}, e); copies.add(c); dispatch(c); }, ping); }
      else dispatch(e);
    },
    touch(d) {
      const btn = W.buttons.find(b => b.dataset.key === KEYS[d][0]);
      btn.fire('touchstart', { preventDefault() {} });
    },
    buttons: [],
    start() { ids['fist-qte-start-btn'].fire('click'); },
    resume() { ids['fist-qte-resume-btn'].fire('click'); },
    // switchQteTab: leaving the fist tab, and coming back to it (which hides first too)
    leave() { hide(); ids['qte-panel-fist'].style.display = 'none'; },
    back() { hide(); ids['qte-panel-fist'].style.display = 'flex'; show(); },
    startVisible() { return ids['fist-qte-start-btn'].style.display !== 'none'; },
    resumeVisible() { return ids['fist-qte-resume-btn'].style.display !== 'none'; },
    scoresReset() { for (const k in store) delete store[k]; },
  };
  if (isMobile) {
    for (const c of ids['fist-qte-bar'].parentNode.children) if (c !== ids['fist-qte-bar']) W.buttons.push(...c.children);
    if (W.buttons.length !== 4) fail('d-pad not built (' + W.buttons.length + ' buttons)');
  }
  return W;
}

function run() { return Q.Run.current; }
// The live round as the log shows it: arrows, next index, and the event that drew them.
function liveState() {
  const r = run(); if (!r) return null;
  const ev = r.log.ev;
  for (let i = ev.length - 1; i >= 0; i--) {
    const c = ev[i][0];
    if (c === 'R' || c === 'U') {
      let cur = 0;
      for (let j = i + 1; j < ev.length; j++) if (ev[j][0] === 'K' && ev[j][3] === 1) cur++;
      return { arrows: ev[i][2], cur, id: ev[i] };
    }
    if (c === 'S' || c === 'E' || c === 'P') return null;
  }
  return null;
}

let iifeChecked = 0, iifeBad = 0, iifeMax = 0;
function checkSubmits() {
  while (submits.length) {
    const s = submits.shift();
    const r = Q.check(s.type, s.packet.log, { platform: 'C', claimed: s.score });
    iifeChecked++;
    iifeMax = Math.max(iifeMax, s.score);
    if (r.verdict !== 'valid' || r.score !== s.score) { iifeBad++; if (iifeBad < 6) fail('IIFE submit ' + s.type + ' ' + s.score + ' -> ' + JSON.stringify(r)); }
  }
}
// Every attempt log written so far, whole: never invalid, never a claim of
// its own points refused, and held for review only rarely.
function checkAllLogs(label) {
  let n = 0, inv = 0, rev = 0, mism = 0;
  for (const log of allLogs) {
    if (!log.ev.length) continue;
    const pts = log.ev.filter(e => e[0] === 'S').length;
    const r = Q.check(log.type, copyLog(log), { platform: 'C', claimed: pts });
    n++;
    if (r.verdict === 'invalid') { inv++; if (inv < 4) fail(label + ' whole log invalid: ' + JSON.stringify(r.reasons) + ' ' + JSON.stringify(log.ev.slice(-8))); }
    else if (r.verdict === 'review') { rev++; if (rev < 3) console.log('    (' + label + ' review: ' + JSON.stringify(r.reasons) + ')'); }
    if (r.verdict !== 'invalid' && r.score !== pts) { mism++; if (mism < 4) console.log('    (' + label + ' scored ' + r.score + ' of ' + pts + ': ' + JSON.stringify(r.stats) + ')'); }
  }
  allLogs.length = 0;
  return { n, inv, rev, mism };
}

// c1) a structured player: many Starts, each with attempts; the local best is
// cleared between so every new high submits.
function suiteIifeStructured() {
  const rng = vt.rng;
  const W = makeWorld(false);
  let hideFlashChecks = 0;
  for (let session = 0; session < 60; session++) {
    globalThis._qteCompMode = session % 2 === 1;
    W.scoresReset();
    W.start();
    const endAt = vt.now() + 60000 + rng() * 240000;
    let lastSeen = null;
    while (vt.now() < endAt) {
      const st = liveState();
      if (!st || st.id === lastSeen) { vt.advanceTo(vt.now() + 20); continue; }
      lastSeen = st.id;
      const arrows = st.arrows;
      const roll = rng();
      vt.advanceTo(vt.now() + lognormal(rng, 260, 0.25));
      if (roll < 0.015) { vt.advanceTo(vt.now() + 9000); continue; }                   // timeout
      const wrongAt = roll < 0.05 ? Math.floor(rng() * arrows.length) : -1;
      const pauseAt = roll > 0.97 ? Math.floor(rng() * arrows.length) : -1;
      let done = true;
      for (let i = 0; i < arrows.length; i++) {
        if (i === pauseAt) { W.leave(); vt.advanceTo(vt.now() + 3000); W.back(); vt.advanceTo(vt.now() + 400); W.resume(); done = false; break; }
        if (i === wrongAt) { W.key((+arrows[i] + 1) % 4); done = false; break; }
        W.key(+arrows[i], rng() < 0.02);
        vt.advanceTo(vt.now() + lognormal(rng, 120, 0.35));
      }
      if (done && rng() < 0.01) {
        // leave during the success flash: no point, no submit, the run is closed
        vt.advanceTo(vt.now() + 100);
        const before = submits.length;
        W.leave();
        vt.advanceTo(vt.now() + 2000);
        if (submits.length !== before) fail('a point was submitted after the run was reset');
        hideFlashChecks++;
        W.back();
        checkSubmits();
        break;
      }
      checkSubmits();
    }
    W.leave(); W.back();
    vt.advanceTo(vt.now() + 1500);
    checkSubmits();
  }
  const whole = checkAllLogs('structured');
  return { hideFlashChecks, whole };
}

// c2) a chaos player: plays the live round like a person, and at random
// moments leaves and comes back, clicks Resume or Start (as matchmaking
// does), changes the ping sim, presses stray keys, stalls to the timeout.
function suiteIifeChaos(isMobile, opts) {
  const rng = vt.rng;
  const W = makeWorld(isMobile);
  const counts = {};
  const did = k => { counts[k] = (counts[k] || 0) + 1; };
  for (let session = 0; session < opts.sessions; session++) {
    globalThis._qteCompMode = rng() < 0.5;
    W.scoresReset();
    W.setPing(isMobile ? 0 : pick(rng, [0, 0, 150, 500]));
    W.start();
    const endAt = vt.now() + opts.minMs + rng() * opts.spanMs;
    let lastSeen = null, plan = [];
    while (vt.now() < endAt) {
      const st = liveState();
      if (st && st.id !== lastSeen) {
        // plan the whole visible sequence, like a person typing it
        lastSeen = st.id;
        plan = [];
        let at = vt.now() + lognormal(rng, st.cur === 0 && st.id[0] === 'U' ? 600 : 260, 0.25);
        for (let k = st.cur; k < st.arrows.length; k++) {
          if (k > st.cur) at += lognormal(rng, 110, 0.35);
          let d = +st.arrows[k];
          if (rng() < 0.004) d = (d + 1 + Math.floor(rng() * 3)) % 4;
          plan.push({ at, d });
        }
        if (rng() < 0.02) plan = [];                                       // stall: the round times out
      }
      const u = rng();
      if (u < 0.006) { did('leave'); W.leave(); vt.advanceTo(vt.now() + rng() * 4000); W.back(); plan = []; }
      else if (u < 0.009) { did('leaveBrief'); W.leave(); W.back(); plan = []; }
      else if (u < 0.011) { did('startClick'); W.start(); plan = []; lastSeen = null; }
      else if (u < 0.013) { did('resumeClick'); W.resume(); plan = []; lastSeen = null; }
      else if (u < 0.015 && !isMobile) { did('ping'); W.setPing(pick(rng, [0, 150, 500])); }
      else if (u < 0.022) { did('stray'); W.key(Math.floor(rng() * 4), rng() < 0.3); }
      else if (plan.length) {
        const p = plan.shift();
        vt.advanceTo(Math.max(vt.now(), p.at));
        if (isMobile && rng() < 0.7) W.touch(p.d); else W.key(p.d, rng() < 0.02);
        did('press');
      } else {
        vt.advanceTo(vt.now() + 30 + rng() * 150);
        if (W.resumeVisible() && rng() < 0.05) { did('resume'); W.resume(); lastSeen = null; }
        else if (W.startVisible() && !W.resumeVisible() && rng() < 0.05) { did('start'); W.start(); lastSeen = null; }
      }
      checkSubmits();
    }
    W.leave(); W.back();
    vt.advanceTo(vt.now() + 1500);
    checkSubmits();
  }
  return { counts, whole: checkAllLogs(opts.label) };
}

function suiteIife() {
  const s = suiteIifeStructured();
  const c1 = suiteIifeChaos(false, { sessions: 40, minMs: 60000, spanMs: 200000, label: 'chaos' });
  const c2 = suiteIifeChaos(true, { sessions: 20, minMs: 60000, spanMs: 120000, label: 'chaos-mobile' });
  // late timers (a blocked main thread) and a short run renewal
  vt.setLateP(0.02);
  const renew = F.RENEW_RUN_MS; F.RENEW_RUN_MS = 20000;
  const c3 = suiteIifeChaos(false, { sessions: 15, minMs: 60000, spanMs: 60000, label: 'chaos-late-renew' });
  F.RENEW_RUN_MS = renew; vt.setLateP(0);
  // a small log budget: attempts outgrow it, stop logging, stop submitting
  const budget = F.LOG_BUDGET; F.LOG_BUDGET = 2500;
  const c4 = suiteIifeChaos(false, { sessions: 10, minMs: 60000, spanMs: 60000, label: 'chaos-budget' });
  F.LOG_BUDGET = budget;
  const wholeOk = [s.whole, c1.whole, c2.whole, c3.whole, c4.whole].every(w => w.inv === 0);
  const reviews = [s.whole, c1.whole, c2.whole, c3.whole, c4.whole].reduce((a, w) => a + w.rev, 0);
  const logsN = [s.whole, c1.whole, c2.whole, c3.whole, c4.whole].reduce((a, w) => a + w.n, 0);
  const mism = [s.whole, c1.whole, c2.whole, c3.whole, c4.whole].reduce((a, w) => a + w.mism, 0);
  const ok = iifeBad === 0 && iifeChecked > 100 && wholeOk && mism === 0 && reviews / logsN <= 0.005 && s.hideFlashChecks > 0;
  console.log((ok ? 'PASS' : 'FAIL') + ' iife: parsed; ' + iifeChecked + ' real submits checked (best ' + iifeMax + '), ' + iifeBad + ' not valid-at-claim; ' +
    logsN + ' whole attempt logs, ' + reviews + ' held; ' + s.hideFlashChecks + ' hide-during-flash resets');
  console.log('    structured ' + JSON.stringify(s.whole) + '; chaos ' + JSON.stringify(c1.whole) + ' ' + JSON.stringify(c1.counts));
  console.log('    chaos-mobile ' + JSON.stringify(c2.whole) + ' ' + JSON.stringify(c2.counts));
  console.log('    chaos-late-renew ' + JSON.stringify(c3.whole) + '; chaos-budget ' + JSON.stringify(c4.whole));
  if (!ok && iifeBad === 0) failures++;
}

// c3) the log budget, measured directly: a perfect player on a tiny budget.
function suiteBudget() {
  const rng = vt.rng;
  const W = makeWorld(false);
  const budget = F.LOG_BUDGET; F.LOG_BUDGET = 3000;
  globalThis._qteCompMode = false;
  W.scoresReset();
  W.setPing(0);
  allLogs.length = 0;
  W.start();
  let lastSeen = null, maxClaim = 0, stalls = 0;
  const endAt = vt.now() + 120000;
  while (vt.now() < endAt) {
    const st = liveState();
    if (!st) {
      // the log is full (no state to read): stall until the timer ends the attempt
      vt.advanceTo(vt.now() + 200); stalls++;
      continue;
    }
    if (st.id === lastSeen) { vt.advanceTo(vt.now() + 20); continue; }
    lastSeen = st.id;
    vt.advanceTo(vt.now() + lognormal(rng, 260, 0.25));
    for (let i = st.cur; i < st.arrows.length; i++) { W.key(+st.arrows[i]); vt.advanceTo(vt.now() + lognormal(rng, 120, 0.35)); }
    while (submits.length) { const s = submits[0]; maxClaim = Math.max(maxClaim, s.score); checkSubmits(); }
  }
  W.leave(); W.back(); vt.advanceTo(vt.now() + 1500); checkSubmits();
  F.LOG_BUDGET = budget;
  const sizes = allLogs.map(l => JSON.stringify(l.ev).length);
  const best = +W.store['alb:fist-hs'] || 0;
  const whole = checkAllLogs('budget');
  const ok = whole.inv === 0 && Math.max(...sizes) <= 3000 && Math.max(...sizes) > 2000 && best > maxClaim && maxClaim > 0;
  console.log((ok ? 'PASS' : 'FAIL') + ' log budget: largest attempt log ' + Math.max(...sizes) + ' B of 3000; local best ' + best + ', highest submitted ' + maxClaim + ' (all valid at claim); ' + JSON.stringify(whole));
  if (!ok) failures++;
}

suiteHonest();
suiteForgeries();
suiteIife();
suiteBudget();
console.log(failures ? 'FAILED (' + failures + ')' : 'ALL PASS');
process.exit(failures ? 1 : 0);
