// =============================================================================
// AL BUILDER — qte-rules.js
// What a QTE run has to look like to count. One file, loaded by the site and
// by the bright-service edge function (supabase/functions/_shared/qte-rules.js is
// a byte-identical copy - tools/ai/test.js fails if they differ).
//
// HOW A SCORE IS CHECKED (owner's design, 2026-09-22)
//   · Start: the server makes the run and a secret seed for it. The browser
//     gets a ticket signed with that seed, never the seed (start_qte_run,
//     supabase/qte-verified.sql).
//   · Play: the trainer writes a log - every target as it is made, every input
//     as it is judged, pauses, resumes - with times from the run's Start.
//   · Submit: the ticket and the log go to the edge function, which runs the
//     trainer's check() below. No ticket, a wrong ticket, or a log that breaks
//     the trainer's rules: REJECTED. A log that is too accurate, too fast for a
//     person, too lucky, or a score far above the record: HELD for an admin.
//     Anything else: VALID, and it goes on the board by itself.
//   · The browser still picks its own targets (the seed stays on the server),
//     so the checks are about how the run was played - the rules, the timing,
//     and whether the spread of it looks like a person.
//
// A trainer module: QteRules.register('<base>', { check(log, env) -> result })
//   base is the trainer id without -comp ('fist', 'thorian-new' ...).
//   env = { comp: bool, platform: 'M'|'C', claimed: int }
//   result: build with QteRules.result(); see there.
//
// This file must run unchanged in a browser (classic script), in Node
// (require) and in Deno (import for side effects): no DOM at load time, no
// imports, results the same on every engine (plain + - * /, Math.floor/abs/
// min/max/sqrt only in anything that decides a verdict).
// =============================================================================
(function (root) {
  'use strict';

  var Q = root.QteRules || {};
  // Bump when a check changes what it accepts. The client sends the version it
  // logged under; a mismatch is not an error (a cached page is allowed), it is
  // recorded with the result.
  Q.RULES_VER = 1;
  Q.trainers = Q.trainers || {};
  Q.register = function (name, mod) { Q.trainers[name] = mod; };

  // ── limits on a log ─────────────────────────────────────────────────────────
  // The edge function refuses a body over MAX_BYTES before parsing it.
  Q.LIMITS = {
    // A whole request: ticket, envelope and log. Marathon runs on the busier
    // trainers (spear, staff, thorian) write several hundred KB; sb.js spaces
    // re-sends of a growing log out (VERIFIED_GAP_MS).
    MAX_BYTES:  1048576,    // 1 MB
    MAX_EVENTS: 20000,
    // Times count from the Start click, and fist/staff restart by themselves
    // under one Start, so a player who never leaves the panel keeps one run
    // going for hours.
    MAX_T:      43200000,   // twelve hours of run, in ms
    MAX_FIELDS: 12,         // per event, after code and t
    MAX_STR:    32,         // any string field
  };

  // ── the log ────────────────────────────────────────────────────────────────
  // { v: 1, rv: RULES_VER, type: 'dagger-comp', a: attempt,
  //   env: { w, h, mob, ping },
  //   ev: [[code, t, ...fields], ...] }
  // code: a short string the trainer defines ('R', 'K' ...). t: integer ms
  // since the run's Start, never decreasing. fields: finite numbers, short
  // strings, booleans or null.
  //
  // Common codes every trainer uses the same way:
  //   'P'  paused (tab or panel hidden)       ['P', t]
  //   'U'  resumed                            ['U', t]
  //   'E'  the attempt ended                  ['E', t, reason]
  Q.validateLog = function (log) {
    var L = Q.LIMITS;
    if (!log || typeof log !== 'object' || Array.isArray(log)) return 'log is not an object';
    if (log.v !== 1) return 'unknown log version';
    if (!Array.isArray(log.ev)) return 'log has no events';
    if (log.ev.length > L.MAX_EVENTS) return 'log has too many events';
    if (typeof log.a !== 'number' || !isInt(log.a) || log.a < 0 || log.a > 100000) return 'bad attempt number';
    // Every string that can end up in a reason or a stored row is bounded:
    // a rejected log's reasons are kept for the owner to read.
    if (typeof log.type !== 'string' || log.type.length > L.MAX_STR) return 'log has a bad type';
    var env = log.env;
    if (!env || typeof env !== 'object' || Array.isArray(env)) return 'log has no env';
    var keys = Object.keys(env);
    if (keys.length > 8) return 'log env has too many fields';
    for (var k = 0; k < keys.length; k++) {
      var ev0 = env[keys[k]], te = typeof ev0;
      if (keys[k].length > 16) return 'log env has a long field name';
      if (!(ev0 === null || te === 'boolean' || (te === 'number' && isFinite(ev0)) || (te === 'string' && ev0.length <= L.MAX_STR))) return 'log env has a bad field';
    }
    var last = 0;
    for (var i = 0; i < log.ev.length; i++) {
      var e = log.ev[i];
      if (!Array.isArray(e) || e.length < 2 || e.length > L.MAX_FIELDS + 2) return 'event ' + i + ' is malformed';
      if (typeof e[0] !== 'string' || e[0].length < 1 || e[0].length > 3) return 'event ' + i + ' has a bad code';
      var t = e[1];
      if (typeof t !== 'number' || !isInt(t) || t < 0 || t > L.MAX_T) return 'event ' + i + ' has a bad time';
      if (t < last) return 'event ' + i + ' goes back in time';
      last = t;
      for (var j = 2; j < e.length; j++) {
        var f = e[j], tf = typeof f;
        if (f === null || tf === 'boolean') continue;
        if (tf === 'number') { if (!isFinite(f)) return 'event ' + i + ' has a non-finite field'; continue; }
        if (tf === 'string') { if (f.length > L.MAX_STR) return 'event ' + i + ' has a long string'; continue; }
        return 'event ' + i + ' has a field of type ' + tf;
      }
    }
    return null;
  };

  function isInt(n) { return Math.floor(n) === n; }

  // ── results ─────────────────────────────────────────────────────────────────
  // var r = Q.result();
  //   r.score = <points the log proves>;       the server posts min(claimed, r.score)
  //   r.endMs = <time of the last event>;      checked against the server's clock
  //   r.invalid('why')  - the log breaks the rules; the score is rejected
  //   r.review('why')   - the log is legal but too good / too lucky; held
  //   r.stat('name', v) - numbers worth showing an admin
  // invalid wins over review; the first reason of each kind is kept first.
  Q.result = function () {
    var r = {
      verdict: 'valid', score: 0, endMs: 0, reasons: [], stats: {},
      invalid: function (why) { r.verdict = 'invalid'; r.reasons.push('invalid: ' + why); return r; },
      review:  function (why) { if (r.verdict === 'valid') r.verdict = 'review'; r.reasons.push('review: ' + why); return r; },
      stat:    function (k, v) { r.stats[k] = typeof v === 'number' ? Math.round(v * 1000) / 1000 : v; return r; },
    };
    return r;
  };

  // The one entry point the edge function calls. type: 'dagger-comp' etc.
  // Never throws: a crash in a check is 'invalid' with the error as the reason
  // (the edge function records rejections, so a verifier bug shows up there).
  Q.check = function (type, log, env) {
    var out = Q.result();
    try {
      if (typeof type !== 'string' || !/^[a-z]+(-new)?(-comp)?$/.test(type)) return plain(out.invalid('unknown trainer'));
      var comp = /-comp$/.test(type);
      var base = comp ? type.slice(0, -5) : type;
      var mod = Q.trainers[base];
      if (!mod || typeof mod.check !== 'function') return plain(out.invalid('no check for ' + base));
      var bad = Q.validateLog(log);
      if (bad) return plain(out.invalid(bad));
      if (log.type !== type) return plain(out.invalid('log is for ' + log.type + ', not ' + type));
      var e2 = { comp: comp, platform: env && env.platform, claimed: env && env.claimed | 0 };
      var r = mod.check(log, e2);
      if (!r || typeof r.score !== 'number' || !isInt(r.score) || r.score < 0) return plain(out.invalid('check returned no score'));
      var ev = log.ev;
      r.endMs = ev.length ? ev[ev.length - 1][1] : 0;
      if (r.verdict === 'invalid') r.score = 0;
      return plain(r);
    } catch (err) {
      return plain(out.invalid('verifier error: ' + (err && err.message ? err.message : String(err)).slice(0, 120)));
    }
  };
  // What leaves the check is bounded whatever a trainer's check put in it:
  // at most 20 reasons of 200 characters, 60 stats, stat strings of 200.
  function plain(r) {
    var stats = {}, n = 0;
    for (var k in r.stats) {
      if (!Object.prototype.hasOwnProperty.call(r.stats, k) || n++ >= 60) continue;
      var v = r.stats[k];
      stats[String(k).slice(0, 40)] = typeof v === 'string' ? v.slice(0, 200)
        : (v === null || typeof v === 'number' || typeof v === 'boolean') ? v : String(v).slice(0, 200);
    }
    return { verdict: r.verdict, score: r.score, endMs: r.endMs,
             reasons: r.reasons.slice(0, 20).map(function (s) { return String(s).slice(0, 200); }), stats: stats };
  }

  // ── walking a log ───────────────────────────────────────────────────────────
  // Paused time between t0 and t1, from the log's P/U events. Trainers whose
  // clocks stop while paused subtract this; ones whose clocks run on do not.
  Q.pausedBetween = function (ev, t0, t1) {
    var total = 0, pAt = -1;
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (e[1] > t1) break;
      if (e[0] === 'P' && pAt < 0) pAt = e[1];
      else if (e[0] === 'U' && pAt >= 0) { total += Math.max(0, Math.min(e[1], t1) - Math.max(pAt, t0)); pAt = -1; }
    }
    if (pAt >= 0) total += Math.max(0, t1 - Math.max(pAt, t0));
    return total;
  };

  // ── statistics ──────────────────────────────────────────────────────────────
  // Small, deterministic helpers for the "does this look like a person" checks.
  var S = Q.stats = {};
  S.mean = function (a) { if (!a.length) return 0; var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
  S.sd = function (a) {
    if (a.length < 2) return 0;
    var m = S.mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  };
  S.sorted = function (a) { return a.slice().sort(function (x, y) { return x - y; }); };
  S.quantile = function (a, q) {
    if (!a.length) return 0;
    var s = S.sorted(a), pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.min(lo + 1, s.length - 1);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  };
  S.median = function (a) { return S.quantile(a, 0.5); };
  // Median absolute deviation, scaled to match an SD for normal data.
  S.mad = function (a) {
    if (!a.length) return 0;
    var m = S.median(a), d = [];
    for (var i = 0; i < a.length; i++) d.push(Math.abs(a[i] - m));
    return 1.4826 * S.median(d);
  };
  // Differences between neighbours: a[i+1] - a[i].
  S.diffs = function (a) { var d = []; for (var i = 1; i < a.length; i++) d.push(a[i] - a[i - 1]); return d; };
  // P(X >= k) for X ~ Binomial(n, p). Exact sum; n is small (a run's targets).
  S.binomUpper = function (n, k, p) {
    if (k <= 0) return 1;
    if (k > n) return 0;
    // log-space terms to stay finite for n in the thousands
    var lp = Math.log(p), lq = Math.log(1 - p), total = 0;
    var lc = 0;                                   // log C(n, 0)
    for (var i = 0; i <= n; i++) {
      if (i > 0) lc += Math.log(n - i + 1) - Math.log(i);
      if (i >= k) total += Math.exp(lc + i * lp + (n - i) * lq);
    }
    return Math.min(1, total);
  };
  // Two-sided: how unlikely is k successes of n at chance p, either way.
  S.binomTwoSided = function (n, k, p) {
    var up = S.binomUpper(n, k, p), down = 1 - S.binomUpper(n, k + 1, p);
    return Math.min(1, 2 * Math.min(up, down));
  };
  // Kolmogorov-Smirnov distance of samples in [0,1) from the uniform, and an
  // approximate p-value. For "were these targets really random".
  S.ksUniform = function (a) {
    var n = a.length;
    if (!n) return { d: 0, p: 1 };
    var s = S.sorted(a), d = 0;
    for (var i = 0; i < n; i++) {
      var x = Math.min(1, Math.max(0, s[i]));
      d = Math.max(d, (i + 1) / n - x, x - i / n);
    }
    var en = Math.sqrt(n), lam = (en + 0.12 + 0.11 / en) * d, p = 0;
    for (var j = 1; j <= 100; j++) {
      var term = 2 * (j % 2 ? 1 : -1) * Math.exp(-2 * j * j * lam * lam);
      p += term;
      if (Math.abs(term) < 1e-10) break;
    }
    return { d: d, p: Math.min(1, Math.max(0, p)) };
  };

  // ── common "is this a person" checks ────────────────────────────────────────
  // Each returns a reason string when the samples look machine-made, else null.
  // Deliberately loose: a HELD score costs an admin a look, so these fire only
  // far outside what hands produce. Trainers pass their own numbers.
  //
  // tooSteady(intervals, minN, maxSd): n intervals between presses with an SD
  //   under maxSd ms - a metronome (the site's guard uses ±3 ms over 10).
  Q.tooSteady = function (intervals, minN, maxSd) {
    if (intervals.length < minN) return null;
    var sd = S.sd(intervals);
    return sd < maxSd ? 'press timing too even (SD ' + sd.toFixed(1) + ' ms over ' + intervals.length + ')' : null;
  };
  // tooAccurate(offsets, minN, maxSd): how far each press landed from the
  //   ideal moment/position; a person scatters, a script hits the centre.
  Q.tooAccurate = function (offsets, minN, maxSd, unit) {
    if (offsets.length < minN) return null;
    var sd = S.sd(offsets);
    return sd < maxSd ? 'too accurate (spread ' + sd.toFixed(2) + (unit || '') + ' over ' + offsets.length + ')' : null;
  };
  // tooFast(reactions, minN, floorMs, share): at least `share` of reactions
  //   under floorMs - faster than people react to something they just saw.
  Q.tooFast = function (reactions, minN, floorMs, share) {
    if (reactions.length < minN) return null;
    var fast = 0;
    for (var i = 0; i < reactions.length; i++) if (reactions[i] < floorMs) fast++;
    return fast / reactions.length >= share
      ? 'reactions too fast (' + fast + ' of ' + reactions.length + ' under ' + floorMs + ' ms)' : null;
  };
  // tooLucky(p, alpha): the targets this log says it got were this unlikely.
  Q.tooLucky = function (p, alpha, what) {
    return p < alpha ? 'targets too lucky (' + what + ', p=' + p.toExponential(1) + ')' : null;
  };

  // ── the browser side: one run ────────────────────────────────────────────────
  // var run = QteRules.Run.start('dagger-comp');  at Start
  // run.ev('K', ringIdx, angle, hit)             an event, timed now
  // run.submit(score)                             each new high
  // run.newAttempt()                              a trainer that restarts by itself
  // run.close()                                   the run is over (no more submits)
  //
  // start() asks sb.js for a ticket but does not wait for it: the run starts
  // at once and a score waits for the ticket instead (sb.js sendScore).
  // Signed out, in a match, or with no sb.js, submit() is a no-op.
  //
  // ticketAt: the run's clock when the ticket arrived. The server made the
  // run then, a little after this log's clock started; it allows for the gap.
  var Run = Q.Run = { current: null };
  Run.start = function (type, opts) {
    var perf = (typeof performance !== 'undefined' && performance.now) ? performance : Date;
    var t0 = perf.now();
    var inMatch = !!(root._qteMatch && root._qteMatch.active);
    var run = {
      type: type,
      t0: t0,
      attempt: 0,
      closed: false,
      ticket: null,
      ticketAt: null,
      ticketDead: false,
      log: newLog(type, 0),
    };
    function askTicket() {
      run.ticket = (!inMatch && typeof root._sbStartQteRun === 'function') ? root._sbStartQteRun(type) : Promise.resolve(null);
      run.ticketAt = null;
      run.ticketDead = false;
      var mine = run.ticket;
      if (mine && mine.then) mine.then(function (t) {
        if (run.ticket !== mine) return;
        if (t) run.ticketAt = run.now(); else run.ticketDead = true;
      }, function () { if (run.ticket === mine) run.ticketDead = true; });
    }
    run.now = function () { return Math.max(0, Math.round(perf.now() - run.t0)); };
    askTicket();
    run.ev = function (code) {
      var e = [code, run.now()];
      for (var i = 1; i < arguments.length; i++) {
        var f = arguments[i];
        e.push(typeof f === 'number' ? Math.round(f * 10000) / 10000 : f);
      }
      if (!run.closed && run.log.ev.length < Q.LIMITS.MAX_EVENTS) run.log.ev.push(e);
      return e[1];
    };
    run.newAttempt = function () {
      // A run the server never made (signed out at Start, a failed start)
      // takes a fresh one at the next attempt once it can: the new attempt is
      // then attempt 0 of that run, on its clock.
      if (run.ticketDead && typeof root._sbGetUserId === 'function' && root._sbGetUserId()) {
        run.t0 = perf.now();
        run.attempt = 0;
        askTicket();
      } else {
        run.attempt++;
      }
      run.log = newLog(type, run.attempt);
      return run.attempt;
    };
    run.submit = function (score) {
      if (inMatch || !score || typeof root._sbSubmitScore !== 'function') return;
      var ev = run.log.ev;
      var packet = { ticket: run.ticket, attempt: run.attempt, log: snapshot(run.log),
                     ticketAt: function () { return run.ticketAt; },
                     // the attempt is over: sb.js sends it now, not after its gap
                     final: run.closed || (ev.length > 0 && ev[ev.length - 1][0] === 'E') };
      selfCheck(type, packet.log, score);
      return root._sbSubmitScore(type, score, packet);
    };
    run.close = function () {
      run.closed = true;
      if (typeof root._sbFlushScore === 'function') { try { root._sbFlushScore(type); } catch (e) {} }
    };
    Run.current = run;
    return run;
  };

  // core.js declares IS_MOBILE as a top-level const: visible by name to every
  // classic script, but not a property of window.
  function isMobile() {
    try { return typeof IS_MOBILE !== 'undefined' ? !!IS_MOBILE : false; } catch (e) { return false; }
  }
  function newLog(type, attempt) {
    var env = { w: 0, h: 0, mob: false, ping: 0 };
    try {
      env.w = Math.round(root.innerWidth || 0);
      env.h = Math.round(root.innerHeight || 0);
      env.mob = isMobile();
      env.ping = Math.round(root._albPing || 0);
    } catch (e) {}
    return { v: 1, rv: Q.RULES_VER, type: type, a: attempt, env: env, ev: [] };
  }
  function snapshot(log) {
    return { v: log.v, rv: log.rv, type: log.type, a: log.a, env: log.env, ev: log.ev.slice() };
  }
  // Developers: localStorage['alb:qte-selfcheck'] = '1' runs the server's
  // check in the browser on every submit and logs the verdict.
  function selfCheck(type, log, score) {
    var on = false;
    try { on = root.localStorage && root.localStorage.getItem('alb:qte-selfcheck') === '1'; } catch (e) {}
    if (!on) return;
    var r = Q.check(type, log, { platform: isMobile() ? 'M' : 'C', claimed: score });
    (root.console || { log: function () {} }).log('[qte-selfcheck]', type, 'claimed', score, '->', r.verdict, r.score, r.reasons, r.stats);
    Run.lastSelfCheck = { type: type, claimed: score, result: r };
  }

  if (typeof module === 'object' && module && module.exports) module.exports = Q;
  root.QteRules = Q;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// ==== qte-rules part: fist ====
// ── fist ─────────────────────────────────────────────────────────────────────
// Arrow sequences: a round shows L arrows at once (L = 2 at the start of an
// attempt, +1 per point, at most 9); the player types them in order before the
// round timer (whole seconds, see timeLimit) runs out. One point = one round
// cleared, scored when the 300 ms success flash ends. A wrong key or the timer
// ends the attempt; the trainer restarts by itself 900 ms later as a new
// attempt (a new log). Leaving the panel mid-round pauses (the timer keeps its
// whole seconds; Resume draws new arrows); leaving at any other time resets.
//
// Log (js/qte.js, fist IIFE):
//   ['R', t, '0312']        round start, arrows as direction indexes 0-3
//   ['K', t, d, h(, f)]     a key judged: direction, 1 hit / 0 miss, flags
//                           (1 autorepeat, 2 touch, 4 ping-sim copy);
//                           the flags only steer the person checks, never a verdict
//   ['S', t, n]             point n scored (end of the success flash)
//   ['P', t]  ['U', t, '0312']   paused mid-round / resumed with new arrows
//   ['E', t, 'fail'|'time'|'hide']   the attempt ended
(function (Q) {
  'use strict';

  var S = Q.stats;

  var F = {
    // ── the game (read by js/qte.js) ─────────────────────────────────────────
    ARROW_N:      4,
    LEN_START:    2,
    LEN_MAX:      9,
    TICK_MS:      1000,       // the round timer counts whole seconds
    FLASH_MS:     300,        // last key -> point scored
    NEXT_MS:      600,        // point scored -> next round
    RESTART_MS:   900,        // fail / timeout -> next attempt
    RENEW_RUN_MS: 600000,     // a restart after 10 min of run starts a fresh run
    // The trainer stops logging (and submitting) an attempt whose log would
    // pass this many bytes of events, so a marathon streak is posted at the
    // points its log holds instead of being refused whole for its size
    // (Q.LIMITS.MAX_BYTES counts the whole request: ticket, envelope, log).
    LOG_BUDGET:   240000,
    timeLimit: function (comp, len) { return comp ? (len >= 6 ? 4 : 6) : (len >= 8 ? 5 : 8); },
    nextLength: function (len) { return Math.min(len + 1, F.LEN_MAX); },

    // ── tolerances (the check only) ─────────────────────────────────────────
    // Timers never fire early. The log's clock can be coarse, though: browsers
    // round performance.now() (Firefox with resistFingerprinting to 1/60 s,
    // Tor Browser to 100 ms, both with jitter), so two logged times can be up
    // to two ticks closer than the timers were. EARLY_MS covers any clock of
    // 1/60 s or finer; a log whose times all sit on one of CLOCKS (within
    // 1 ms) gets 2 ticks + CLOCK_SLACK_MS when that is more.
    EARLY_MS:     50,
    CLOCK_SLACK_MS: 15,
    CLOCKS:       [100, 50, 20, 50 / 3, 10],
    CLOCK_MIN_EVENTS: 3,      // times after 0 (a point needs R, 2 keys, S)
    TICK_MS_MIN:  10,         // a tick from 10 ms: spreads are judged in ticks
    COARSE_MS:    50,         // a tick from 50 ms: only means and "inside one tick" shares
    // A key judged later than the round timer allows (limit + 1 s per pause,
    // since a pause keeps only the whole seconds left) plus this much: a
    // blocked main thread can do it, so it only stops the count.
    LATE_MS:      1500,
    // A timeout logged this much (+ 2 ticks) before the timer could fire is impossible.
    TIMEOUT_EARLY_MS: 100,

    // ── person checks (review, never invalid) ────────────────────────────────
    REACT_FLOOR_MS:  100,     // first key of a round faster than seeing it
    REACT_FAST_SHARE: 0.25,   //   ... in this share of rounds
    REACT_FAST_MIN_N: 8,
    REACT_SD_MS:     12,      // first-key reaction spread tighter than this (SD)
    REACT_MAD_MS:    8,       //   ... or than this (MAD: padding cannot hide it)
    REACT_MED_MS:    120,     // median first-key reaction under this
    REACT_SD_MIN_N:  20,
    STEADY_SD_MS:    6,       // key-to-key interval spread tighter than this (SD)
    STEADY_MIN_N:    30,
    STEADY_MIN_IV:   40,      //   (SD over intervals of at least this)
    STEADY_MAD_MS:   5,       // MAD of ALL key-to-key intervals under this
    FAST_MEDIAN_MS:  30,      // median key-to-key interval under this
    FAST_MIN_N:      40,
    // On a ticking clock (TICK_MS_MIN .. COARSE_MS) a MAD is mostly the tick's:
    // instead, the largest share of samples on one tick
    TICK_SAME_SHARE:  0.7,
    TICK_SAME_MIN_N:  30,
    TICK_ZERO_SHARE:  0.5,      // share of key-to-key intervals inside one tick
    // On a coarse clock (tick >= COARSE_MS) spreads and medians are the tick's,
    // not the player's; these take their place:
    COARSE_REACT_MEAN_MS: 120,  // mean first-key reaction (each capped at 2 s)
    COARSE_ZERO_SHARE:    0.8,  // share of key-to-key intervals inside one tick
    COARSE_REACT_ZERO:    0.5,  // share of reactions inside one tick
    LUCK_ALPHA:      1e-6,    // arrow draws this unlikely under a fair die
    LUCK_MIN_N:      40,
    // Targets reused: arrow strings of DUP_MIN_LEN+ arrows seen before in the
    // attempt, far more often than a fair die repeats them (a forger cycling a
    // pool of strings keeps the counts fair but not this)
    DUP_MIN_LEN:     6,
    DUP_MIN:         20,
    DUP_FACTOR:      10,
    // Timings replayed: rounds cleared with exactly the same key-to-key
    // intervals (4+ of them, ms for ms) as an earlier round (fine clock only)
    REPLAY_MIN_IV:   4,
    REPLAY_MIN:      5,

    check: check,
  };

  var ARROWS_RE = /^[0-3]+$/;

  // The log's clock tick: the coarsest of F.CLOCKS that every step between
  // two neighbouring times (and from the run's start to the first) is a
  // whole number of, within 1 ms (each time is rounded to whole ms) plus
  // 1 ms per 20 s (a browser's 16.667 is not exactly 50/3), else 1.
  // validateLog has already made the times non-negative integers.
  function clockOf(ev) {
    var nz = 0, i, prev;
    for (i = 0, prev = 0; i < ev.length; prev = ev[i][1], i++) if (ev[i][1] > prev) nz++;
    if (nz < F.CLOCK_MIN_EVENTS) return 1;
    for (var c = 0; c < F.CLOCKS.length; c++) {
      var p = F.CLOCKS[c], ok = true;
      for (i = 0, prev = 0; i < ev.length && ok; prev = ev[i][1], i++) {
        var d = ev[i][1] - prev;
        if (Math.abs(d - p * Math.floor(d / p + 0.5)) > 1 + d / 20000) ok = false;
      }
      if (ok) return p;
    }
    return 1;
  }
  // Largest share of samples on one tick of the clock: within 2 ms of each
  // other (a span of whole ticks, rounded to whole ms at both ends).
  function tickShare(a) {
    if (!a.length) return 0;
    var s = S.sorted(a), lo = 0, best = 0;
    for (var hi = 0; hi < s.length; hi++) {
      while (s[hi] - s[lo] > 2) lo++;
      if (hi - lo + 1 > best) best = hi - lo + 1;
    }
    return best / s.length;
  }
  function shareUnder(a, lim) {
    if (!a.length) return 0;
    var n = 0;
    for (var i = 0; i < a.length; i++) if (a[i] < lim) n++;
    return n / a.length;
  }

  function check(log, env) {
    var r = Q.result();
    var ev = log.ev;
    var comp = !!env.comp;
    var claimed = env.claimed | 0;
    var truncated = ev.length >= Q.LIMITS.MAX_EVENTS;

    var clk = clockOf(ev);
    var mode = clk >= F.COARSE_MS ? 'coarse' : clk >= F.TICK_MS_MIN ? 'tick' : 'fine';
    var early = Math.max(F.EARLY_MS, 2 * clk + F.CLOCK_SLACK_MS);
    var timeoutEarly = F.TIMEOUT_EARLY_MS + 2 * clk;
    var late = F.LATE_MS + 2 * clk;

    // Round state, as the trainer has it.
    var phase = 'start';        // start | live | paused | failed | flash | gap | over
    var len = F.LEN_START, streak = 0, score = 0;
    var seq = '', cur = 0;
    var tR = 0;                 // this round's R
    var tStim = 0;              // when the arrows the next key answers appeared (R or U)
    var tP = 0, pausedMs = 0, nPauseRound = 0;
    var tDone = 0, tS = 0, lastK = -1, lastD = -1;
    var stopped = false;

    // Samples for the person checks.
    var reactions = [], intervals = [], counts = [0, 0, 0, 0], nDraw = 0;
    var steps = [0, 0, 0, 0], nStep = 0, prevArrow = -1;
    var seenSeq = {}, nByLen = [], dupes = 0;           // reused arrow strings
    var seenSig = {}, sigDupes = 0, roundK = [], roundRep = false;   // replayed timings
    var nK = 0, nPause = 0, nRepeat = 0, nTouch = 0, lateKeys = 0, oddRepeats = 0;

    function bad(i, why) { r.invalid('event ' + i + ' (' + ev[i][0] + '): ' + why); }
    function stop(i, why) {
      if (!stopped) { stopped = true; r.stat('stoppedAt', i); r.stat('stoppedWhy', why); }
    }
    function arrowsOk(s) { return typeof s === 'string' && s.length === len && ARROWS_RE.test(s); }
    // Every arrow the attempt drew, as one stream (a resume's redraw included):
    // how often each direction came up, and each step from one arrow to the
    // next (0 = the same again, 1-3 = turned by that much).
    function draw(s) {
      if (s.length >= F.DUP_MIN_LEN) {
        nByLen[s.length] = (nByLen[s.length] || 0) + 1;
        if (seenSeq[s] === 1) dupes++; else seenSeq[s] = 1;
      }
      roundK = []; roundRep = false;
      for (var j = 0; j < s.length; j++) {
        var a = s.charCodeAt(j) - 48;
        counts[a]++;
        nDraw++;
        if (prevArrow >= 0) { steps[(a - prevArrow + 4) % 4]++; nStep++; }
        prevArrow = a;
      }
    }
    function isInt(n) { return typeof n === 'number' && Math.floor(n) === n; }

    for (var i = 0; i < ev.length; i++) {
      var e = ev[i], c = e[0], t = e[1];
      if (phase === 'start' && c !== 'R') { bad(i, 'an attempt starts with a round'); break; }
      if (phase === 'over') { bad(i, 'event after the attempt ended'); break; }

      if (c === 'R') {
        if (e.length !== 3) { bad(i, 'malformed'); break; }
        if (phase === 'gap') {
          if (t - tS < F.NEXT_MS - early) { bad(i, 'next round ' + (t - tS) + ' ms after the point (engine: ' + F.NEXT_MS + ')'); break; }
        } else if (phase !== 'start') { bad(i, 'round started while another was in play'); break; }
        if (!arrowsOk(e[2])) { bad(i, 'arrows ' + JSON.stringify(e[2]) + ' are not ' + len + ' directions'); break; }
        seq = e[2]; cur = 0; draw(seq);
        tR = t; tStim = t; pausedMs = 0; nPauseRound = 0; lastK = -1;
        phase = 'live';

      } else if (c === 'K') {
        if (e.length !== 4 && e.length !== 5) { bad(i, 'malformed'); break; }
        var d = e[2], h = e[3], f = e.length === 5 ? e[4] : 0;
        if (!isInt(d) || d < 0 || d > 3 || (h !== 0 && h !== 1)) { bad(i, 'bad fields'); break; }
        if (e.length === 5 && (!isInt(f) || f < 1 || f > 7)) { bad(i, 'bad flags'); break; }
        if (phase !== 'live') { bad(i, 'key judged while no round was live (' + phase + ')'); break; }
        var hit = (d === seq.charCodeAt(cur) - 48) ? 1 : 0;
        if (h !== hit) { bad(i, 'logged ' + (h ? 'hit' : 'miss') + ' for direction ' + d + ', arrow ' + cur + ' is ' + seq[cur]); break; }
        nK++;
        if (f & 1) nRepeat++;
        if (f & 2) nTouch++;
        // The round timer: whole seconds from R, a pause keeps only the whole
        // seconds left. Later than that plus slack: stop counting here.
        var active = t - tR - pausedMs;
        var limitMs = F.timeLimit(comp, len) * F.TICK_MS + nPauseRound * F.TICK_MS;
        if (active > limitMs + late) { lateKeys++; stop(i, 'key ' + (active - limitMs) + ' ms after the round timer'); }
        // A held key's autorepeat (OS rate, 15-50 ms) is neither a press rhythm
        // nor a reaction, but the flag comes from the client: it only counts
        // when the key repeats the direction of the key judged before it, as a
        // held key does (through the gap too: keys there are not judged).
        var isRep = (f & 1) && lastD >= 0 && d === lastD;
        if (cur === 0) {
          if (!isRep) reactions.push(t - tStim);
        } else if (lastK >= 0 && !isRep) {
          intervals.push(t - lastK);
        }
        if ((f & 1) && !isRep) oddRepeats++;
        lastK = t; lastD = d;
        roundK.push(t); if (f & 1) roundRep = true;
        if (!hit) { phase = 'failed'; continue; }
        cur++;
        if (cur === len) {
          phase = 'flash'; tDone = t;
          if (!roundRep && roundK.length > F.REPLAY_MIN_IV) {
            var sig = S.diffs(roundK).join(',');
            if (seenSig[sig] === 1) sigDupes++; else seenSig[sig] = 1;
          }
        }

      } else if (c === 'S') {
        if (e.length !== 3) { bad(i, 'malformed'); break; }
        if (phase !== 'flash') { bad(i, 'point scored without a cleared round (' + phase + ')'); break; }
        if (t - tDone < F.FLASH_MS - early) { bad(i, 'point ' + (t - tDone) + ' ms after the last key (engine: ' + F.FLASH_MS + ')'); break; }
        streak++;
        if (e[2] !== streak) { bad(i, 'point says streak ' + e[2] + ', log shows ' + streak); break; }
        len = F.nextLength(len);
        if (!stopped) score = streak;
        tS = t;
        phase = 'gap';

      } else if (c === 'P') {
        if (e.length !== 2) { bad(i, 'malformed'); break; }
        if (phase !== 'live') { bad(i, 'pause outside a live round (' + phase + ')'); break; }
        tP = t; nPause++;
        phase = 'paused';

      } else if (c === 'U') {
        if (e.length !== 3) { bad(i, 'malformed'); break; }
        if (phase !== 'paused') { bad(i, 'resume without a pause'); break; }
        if (!arrowsOk(e[2])) { bad(i, 'arrows ' + JSON.stringify(e[2]) + ' are not ' + len + ' directions'); break; }
        pausedMs += t - tP; nPauseRound++;
        seq = e[2]; cur = 0; draw(seq);
        // New arrows: the next key is a reaction to them (a resume cannot be
        // used to keep reactions out of the samples; after a click on Resume
        // they are slow anyway).
        tStim = t; lastK = -1;
        phase = 'live';

      } else if (c === 'E') {
        if (e.length !== 3) { bad(i, 'malformed'); break; }
        var why = e[2];
        if (why === 'fail') {
          if (phase !== 'failed') { bad(i, 'fail without a wrong key'); break; }
        } else if (why === 'time') {
          if (phase !== 'live') { bad(i, 'timeout outside a live round (' + phase + ')'); break; }
          var act = t - tR - pausedMs;
          if (act < F.timeLimit(comp, len) * F.TICK_MS - timeoutEarly) { bad(i, 'timeout after ' + act + ' ms of a ' + F.timeLimit(comp, len) + ' s round'); break; }
        } else if (why === 'hide') {
          if (phase !== 'flash' && phase !== 'gap') { bad(i, 'reset while a round was ' + phase); break; }
        } else { bad(i, 'unknown end ' + JSON.stringify(why)); break; }
        phase = 'over';

      } else {
        bad(i, 'unknown event'); break;
      }
    }
    if (r.verdict === 'invalid') return r;
    if (phase === 'failed' && !truncated) return r.invalid('log ends on a wrong key without its end');

    // The claim: a real client submits right after logging the S it claims.
    var nS = streak;
    if (claimed > 0 && ev.length === 0) return r.invalid('claims ' + claimed + ' with an empty log');
    if (claimed > nS && !truncated) return r.invalid('claims ' + claimed + ', the log scores ' + nS);

    r.score = score;

    // ── stats for an admin ──────────────────────────────────────────────────
    r.stat('points', nS);
    r.stat('keys', nK);
    r.stat('pauses', nPause);
    if (clk > 1) r.stat('clockMs', clk);
    if (nRepeat) r.stat('repeatKeys', nRepeat);
    if (dupes) r.stat('reusedArrows', dupes);
    if (sigDupes && mode === 'fine') r.stat('replayedTimings', sigDupes);
    if (oddRepeats) r.stat('oddRepeats', oddRepeats);
    if (nTouch) r.stat('touchKeys', nTouch);
    if (lateKeys) r.stat('lateKeys', lateKeys);
    if (reactions.length) {
      r.stat('reactMedian', S.median(reactions));
      r.stat('reactSd', S.sd(reactions));
      r.stat('reactMad', S.mad(reactions));
    }
    if (intervals.length) {
      r.stat('keyIvMedian', S.median(intervals));
      r.stat('keyIvSd', S.sd(intervals));
      r.stat('keyIvMad', S.mad(intervals));
    }

    // ── is this a person ────────────────────────────────────────────────────
    // Three clocks (see clockOf): 'fine' (1 ms or better) gets every check;
    // 'tick' (10-20 ms ticks) judges spread as "how many samples share one
    // tick" and speed with floors lowered by two ticks; 'coarse'
    // (50-100 ms ticks) keeps only means and "inside one tick" shares.
    var why2, k;
    var steady = [];
    for (k = 0; k < intervals.length; k++) if (intervals[k] >= F.STEADY_MIN_IV) steady.push(intervals[k]);
    if (mode !== 'coarse') {
      var slack2 = mode === 'tick' ? 2 * clk : 0;
      why2 = Q.tooFast(reactions, F.REACT_FAST_MIN_N, F.REACT_FLOOR_MS - slack2, F.REACT_FAST_SHARE);
      if (why2) r.review(why2);
      why2 = Q.tooAccurate(reactions, F.REACT_SD_MIN_N, F.REACT_SD_MS, ' ms first-key reaction');
      if (why2) r.review(why2);
      if (reactions.length >= F.REACT_SD_MIN_N) {
        var rMed = S.median(reactions);
        if (rMed < F.REACT_MED_MS - slack2) r.review('reactions too fast (median ' + rMed + ' ms over ' + reactions.length + ')');
      }
      why2 = Q.tooSteady(steady, F.STEADY_MIN_N, F.STEADY_SD_MS);
      if (why2) r.review(why2);
    }
    if (mode === 'fine') {
      if (reactions.length >= F.REACT_SD_MIN_N) {
        var rMad = S.mad(reactions);
        if (rMad < F.REACT_MAD_MS) r.review('too accurate (first-key reaction MAD ' + rMad.toFixed(1) + ' ms over ' + reactions.length + ')');
      }
      if (intervals.length >= F.STEADY_MIN_N) {
        var iMad = S.mad(intervals);
        if (iMad < F.STEADY_MAD_MS) r.review('press timing too even (MAD ' + iMad.toFixed(1) + ' ms over ' + intervals.length + ')');
      }
      if (intervals.length >= F.FAST_MIN_N) {
        var med = S.median(intervals);
        if (med < F.FAST_MEDIAN_MS) r.review('keys faster than hands (median ' + med + ' ms over ' + intervals.length + ')');
      }
    } else if (mode === 'tick') {
      if (reactions.length >= F.TICK_SAME_MIN_N) {
        var rSame = tickShare(reactions);
        r.stat('reactSameTick', rSame);
        if (rSame >= F.TICK_SAME_SHARE) r.review('too accurate (' + Math.round(rSame * 100) + '% of ' + reactions.length + ' first-key reactions in one ' + clk.toFixed(1) + ' ms tick)');
      }
      if (intervals.length >= F.TICK_SAME_MIN_N) {
        var iSame = tickShare(intervals);
        r.stat('keyIvSameTick', iSame);
        if (iSame >= F.TICK_SAME_SHARE) r.review('press timing too even (' + Math.round(iSame * 100) + '% of ' + intervals.length + ' key-to-key intervals in one ' + clk.toFixed(1) + ' ms tick)');
      }
      if (intervals.length >= F.FAST_MIN_N) {
        var iZero = shareUnder(intervals, clk / 2);
        r.stat('keyIvInTick', iZero);
        if (iZero >= F.TICK_ZERO_SHARE) r.review('keys faster than hands (' + Math.round(iZero * 100) + '% of ' + intervals.length + ' inside one ' + clk.toFixed(1) + ' ms tick)');
      }
    } else {
      // Every time is a whole number of 50-100 ms ticks: what is left to judge
      // is the mean (rounding both ends of a span is unbiased), how often
      // presses fall inside one tick, and a spread of exactly nothing.
      if (reactions.length >= F.REACT_FAST_MIN_N) {
        var rZero = shareUnder(reactions, clk / 2);
        r.stat('reactInTick', rZero);
        if (rZero >= F.COARSE_REACT_ZERO) r.review('reactions too fast (' + Math.round(rZero * 100) + '% of ' + reactions.length + ' inside one ' + clk + ' ms tick)');
      }
      if (reactions.length >= F.REACT_SD_MIN_N) {
        var sum = 0;
        for (k = 0; k < reactions.length; k++) sum += Math.min(reactions[k], 2000);
        var rMean = sum / reactions.length;
        r.stat('reactMean', rMean);
        if (rMean < F.COARSE_REACT_MEAN_MS) r.review('reactions too fast (mean ' + rMean.toFixed(0) + ' ms over ' + reactions.length + ', ' + clk + ' ms clock)');
      }
      if (intervals.length >= F.FAST_MIN_N) {
        var cZero = shareUnder(intervals, clk / 2);
        r.stat('keyIvInTick', cZero);
        if (cZero >= F.COARSE_ZERO_SHARE) r.review('keys faster than hands (' + Math.round(cZero * 100) + '% of ' + intervals.length + ' inside one ' + clk + ' ms tick)');
      }
      why2 = Q.tooSteady(intervals, F.STEADY_MIN_N, F.STEADY_SD_MS);
      if (why2) r.review(why2);
    }
    // A 9-arrow string comes round again about once per 500 rounds at 9;
    // shorter ones (6-8) come once per attempt (a resume draws again).
    var dupExpected = 0;
    for (var L = 1, p4 = 4; L < nByLen.length; L++, p4 *= 4) if (nByLen[L]) dupExpected += nByLen[L] * (nByLen[L] - 1) / 2 / p4;
    if (dupes >= F.DUP_MIN && dupes > F.DUP_FACTOR * dupExpected + F.DUP_MIN)
      r.review('targets reused (' + dupes + ' arrow strings seen before in the attempt, a fair die gives about ' + dupExpected.toFixed(1) + ')');
    if (mode === 'fine' && sigDupes >= F.REPLAY_MIN)
      r.review('timings replayed (' + sigDupes + ' rounds typed with the exact intervals of an earlier one)');
    // The arrows are drawn fairly (Math.random per arrow): each direction
    // about a quarter, and each step from one arrow to the next (the same
    // again, or turned by 1, 2 or 3) about a quarter.
    if (nDraw >= F.LUCK_MIN_N) {
      var pMin = 1, pStep = 1;
      for (var q = 0; q < 4; q++) {
        pMin = Math.min(pMin, S.binomTwoSided(nDraw, counts[q], 0.25));
        pStep = Math.min(pStep, S.binomTwoSided(nStep, steps[q], 0.25));
      }
      r.stat('drawP', pMin);
      r.stat('stepP', pStep);
      why2 = Q.tooLucky(pMin, F.LUCK_ALPHA, 'direction counts ' + counts.join('/'));
      if (why2) r.review(why2);
      why2 = Q.tooLucky(pStep, F.LUCK_ALPHA, 'arrow-to-arrow steps ' + steps.join('/'));
      if (why2) r.review(why2);
    }
    return r;
  }

  Q.register('fist', F);
})(typeof globalThis !== 'undefined' ? globalThis.QteRules : this.QteRules);

// ==== qte-rules part: spear ====
// ── spear ─────
// Spear trainer ('spear', 'spear-comp'; js/qte.js "SPEAR QTE TRAINER").
// osu!-style: circles appear at random spots with an outer ring that shrinks
// onto them. A click/tap within reach of a live circle (the oldest one in
// reach) while its ring is inside the hit band is a point; the same click
// with the ring still outside the band ('Too early!'), or a circle whose ring
// closes before it is clicked ('Miss! Too slow.'), ends the run. Clicks near
// no circle do nothing and are not logged.
//
// The log (t = ms since the run's Start; frame times are the rAF timestamps
// the game loop used, raw performance clock minus the run's t0):
//   ['G', t, W, H]                 canvas size: at Start, and on a resize while
//                                  the run is live (a resize changes the radius
//                                  and the hit band of circles already alive)
//   ['S', t, sp, x, y, d, nf]      a circle spawned in the frame at sp, at (x, y),
//                                  approach d ms; nf = spawn attempts that found
//                                  no free spot (the +120 ms retries) since the
//                                  previous spawn
//   ['K', t, i, mx, my, el, h]     a click/tap as judged: it took live circle i
//                                  (index in spawn order among the live ones),
//                                  at canvas (mx, my), el = ms since that circle's
//                                  spawn (pauses taken out), h 1 = hit, 0 = early
//   ['E', t, 'early']              right after a K with h 0
//   ['E', t, 'slow', i, el]        live circle i closed in a frame, el of it then
//   ['P', t] / ['U', t, pf]        paused / resumed; pf = the ms (0.01 ms steps)
//                                  every live circle's spawn time and the next
//                                  spawn were pushed back by
//
// check() replays the game on the logged numbers: the live set, the streak,
// the spawn clock (gap, retries, live cap, approach time for the streak), the
// placement rules (box, spacing), the hit test and the ring test, the frame
// that would have closed a circle, the pause shifts, and counts the points.
// Then the "is this a person" checks: timing and aim spread, hits hugging the
// band's first edge, even press gaps, whether the spots were really random
// (each spot's position within the free area it was drawn from, KS-tested;
// and how near it fell to the last spot, the last click and the oldest live
// circle, as a share of the free area, summed over the run), spawns held back,
// retries claimed where the area was free, and pausing no hand could do
// (P..U gaps under 150 ms, or a pause every 30 s of play, 10+ times).
(function (Q) {
  'use strict';
  var S = Q.stats;

  // ── the trainer's rules (js/qte.js reads these) ─────────────────────────────
  var C = {
    FIRST_SPAWN: 300,   // ms from Start to the first spawn
    RETRY_MS: 120,      // a spawn that found no free spot tries again this much later
    TRIES: 30,          // spots drawn per spawn before giving up
    W_MAX: 900,         // canvas.width = min(wrap - 24 || 800, 900)
    W_MIN: 50,          // check only: below this INNER_R < 9 px
    REACH_ADD: 6,       // px of reach past INNER_R + HIT_TOLERANCE
  };

  // Competitive curves. The originals are Math.pow expressions; Math.pow is not
  // bit-identical across JS engines, so both the trainer and the check read
  // these tables (the values V8 gives, streak 0..200; flat after 200).
  var COMP_APPROACH = [950,936,927,921,915,909,904,899,894,890,886,882,878,874,870,866,863,859,856,853,849,846,843,840,837,834,831,828,825,822,819,816,813,810,808,805,802,800,797,794,792,789,787,784,782,779,777,774,772,770,767,765,763,760,758,756,753,751,749,746,744,742,740,738,735,733,731,729,727,725,723,720,718,716,714,712,710,708,706,704,702,700,698,696,694,692,690,688,686,684,682,680,678,676,675,673,671,669,667,665,663,661,660,658,656,654,652,650,649,647,645,643,641,640,638,636,634,632,631,629,627,625,624,622,620,618,617,615,613,612,610,608,607,605,603,601,600,598,596,595,593,591,590,588,587,585,583,582,580,578,577,575,574,572,570,569,567,566,564,562,561,559,558,556,554,553,551,550,548,547,545,544,542,540,539,537,536,534,533,531,530,528,527,525,524,522,521,519,518,516,515,513,512,510,509,507,506,504,503,501,500];
  var COMP_INTERVAL = [850,829,817,808,799,791,783,776,770,763,757,751,746,740,735,729,724,719,714,709,704,700,695,691,686,682,677,673,669,665,661,657,652,648,645,641,637,633,629,625,622,618,614,611,607,603,600,596,593,589,586,583,579,576,572,569,566,563,559,556,553,550,546,543,540,537,534,531,528,525,521,518,515,512,509,506,503,500,498,495,492,489,486,483,480,477,474,472,469,466,463,460,458,455,452,449,447,444,441,438,436,433,430,428,425,422,420,417,415,412,409,407,404,402,399,396,394,391,389,386,384,381,379,376,374,371,369,366,364,361,359,356,354,351,349,347,344,342,339,337,335,332,330,327,325,323,320,318,316,313,311,309,306,304,302,299,297,295,292,290,288,285,283,281,279,276,274,272,270,267,265,263,261,258,256,254,252,250,247,245,243,241,239,236,234,232,230,228,226,223,221,219,217,215,213,211,208,206,204,202,200];
  var COMP_SIMUL = [5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14,14];
  function ci(s) { return s > 200 ? 200 : s; }

  // Max live circles, approach ms and spawn gap ms for streak s.
  function maxSimul(s, comp) { return comp ? COMP_SIMUL[ci(s)] : Math.min(4 + Math.floor(s / 4), 8); }
  function approach(s, comp) { return comp ? COMP_APPROACH[ci(s)] : Math.max(850, 1100 - s * 2); }
  function interval(s, comp) { return comp ? COMP_INTERVAL[ci(s)] : Math.max(550, 1000 - s * 10); }

  // canvas.height for a canvas.width (IS_MOBILE or narrow: the tall shape).
  function canvasH(W, mob) {
    var tall = mob || W < 480;
    return tall ? Math.min(Math.round(W * 0.65), 400) : Math.min(Math.round(W * 0.38), 340);
  }
  // Circle geometry for a canvas.height: INNER_R, OUTER_R_START, HIT_TOLERANCE,
  // the spawn margin, the spacing between live circles and the click reach.
  function geom(H) {
    var R = Math.min(52, Math.round(H * 0.26));
    var OUT = R * 2.2;
    var HT = Math.round(R * (22 / 52));
    return { R: R, OUT: OUT, HT: HT, margin: OUT + 10, minDist: R * 2 + 20, reach: R + HT + C.REACH_ADD };
  }
  // The ring test, as the trainer does it: early while the ring is outside the band.
  function isEarly(el, d, g) {
    var progress = el / d;
    var outerR = g.R + (g.OUT - g.R) * (1 - progress);
    return outerR > g.R + g.HT;
  }

  // ── tolerances (never reasons to reject a real client) ─────────────────────
  var T = {
    EPS_D: 0.25,        // px: x, y, mx, my are logged to 0.1 px
    EPS_EL: 0.15,       // ms: el is logged to 0.1 ms; an outcome this close to the band edge stands
    EPS_T: 0.3,         // ms: frame / spawn times logged to 0.1 ms (pause shifts are exact)
    EPS_K: 1.2,         // ms: t (whole ms) against spawn + el
    K_SLOW: 150,        // ms: a K logged this long after its judged moment: stop counting
                        // (the two clock reads are microseconds apart, but a clock
                        // clamped to 100 ms can tick between them)
    PF_TOL: 20,         // ms: a pause shift against the P..U gap in whole ms (clocks
                        // coarsened to 1 ms, or 16.7 ms under resist-fingerprinting)
    PF_BAD: 150,        // ms: no real clock is this coarse
    LATE_STOP: 400,     // ms past a circle's close with no frame in between: stop counting
    LATE_BIG: 150,      // ms past close: a long main-thread stall at that very moment
    LATE_NOTE: 50,      // ms past close: later than a slow device's next frame (stalls only)
    FRAME_LATE: 100,    // ms a spawn may lag its due moment per frame it waits for (10 fps)
  };

  // ── person checks (review) ─────────────────────────────────────────────────
  var P = {
    TIME_N: 30, TIME_SD: 3.5,       // ms: timing spread of hits (osu! top players ~8-10)
    POS_N: 20, POS_SD: 1,         // px: aim spread around the circle centre
    EDGE_N: 25, EDGE_MS: 40, EDGE_SHARE: 0.6,  // hits in the band's first 40 ms
    GAP_N: 20, GAP_SD: 2,         // ms: gaps between hits (metronome)
    PIT_N: 20, PIT_ALPHA: 1e-5,   // spot draws, KS against uniform
    NEAR_ALPHA: 1e-5,             // spots near a point known before the draw (Gamma tail, exact)
    PIT_MAX: 4000,                // spots examined per log (bounds the check's CPU time;
                                  // MAX_BYTES holds a log to about 3 400 spawns)
    PAUSE_SHORT_MS: 150, PAUSE_SHORT_N: 3,  // P..U gaps no hand makes (three clicks)
    PAUSE_N: 10, PAUSE_PER_MIN: 2,          // a pause every 30 s of play, 10+ times
    LATE_SPAWN_N: 8, LATE_SPAWN_SHARE: 0.25,
    LATE_HIT_N: 10, LATE_HIT_SHARE: 0.15,   // hits after the ring closed
    STALL_LATE_N: 7, STALL_LATE_SHARE: 0.02, // ... by more than LATE_NOTE
    BIG_LATE_N: 3, BIG_LATE_SHARE: 0.005,    // ... by more than LATE_BIG
    FAIL_P: 1e-6, FAIL_N: 2,      // a claimed retry this unlikely, this many times
    FAIL_MAX: 300,                // spawns with claimed retries examined per log (CPU)
  };

  // ── spot-draw geometry ──────────────────────────────────────────────────────
  // The trainer draws x, y uniform in the box and redraws while the spot is
  // closer than minDist to a live circle, so an accepted spot is uniform over
  // the free part of the box. For a spot we compute where it falls in that free
  // area: ux = share of free area left of x, uy = share of the free column at x
  // below y. Real draws give independent uniform (ux, uy).
  function box(W, H, g) {
    var x0 = g.margin, x1 = W - g.margin, y0 = g.margin, y1 = H - g.margin;
    return { xlo: Math.min(x0, x1), xhi: Math.max(x0, x1), ylo: Math.min(y0, y1), yhi: Math.max(y0, y1) };
  }
  // Excluded y-intervals at column xp, merged and clipped to [ylo, yhi].
  function excl(live, xp, md, b) {
    var iv = [];
    for (var i = 0; i < live.length; i++) {
      var dx = xp - live[i].x;
      if (dx >= md || dx <= -md) continue;
      var h = Math.sqrt(md * md - dx * dx);
      var a = Math.max(b.ylo, live[i].y - h), z = Math.min(b.yhi, live[i].y + h);
      if (z > a) iv.push([a, z]);
    }
    iv.sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
    var out = [];
    for (var k = 0; k < iv.length; k++) {
      var last = out[out.length - 1];
      if (last && iv[k][0] <= last[1]) { if (iv[k][1] > last[1]) last[1] = iv[k][1]; }
      else out.push([iv[k][0], iv[k][1]]);
    }
    return out;
  }
  // Free length of column xp below y (y = yhi: the whole column).
  function freeBelow(live, xp, y, md, b) {
    var iv = excl(live, xp, md, b), free = y - b.ylo;
    for (var k = 0; k < iv.length; k++) {
      if (iv[k][0] >= y) break;
      free -= Math.min(iv[k][1], y) - iv[k][0];
    }
    return free;
  }
  function freePoint(live, xp, yp, md) {
    for (var i = 0; i < live.length; i++) {
      var dx = xp - live[i].x, dy = yp - live[i].y;
      if (Math.sqrt(dx * dx + dy * dy) < md) return 0;
    }
    return 1;
  }
  // The free column length is smooth between breakpoints: a disc's x-extent,
  // a disc edge crossing the top or bottom of the box, two disc edges crossing
  // each other. Integrate each smooth piece with composite Simpson.
  function breaks(live, md, b) {
    var p = [b.xlo, b.xhi], i, j;
    for (i = 0; i < live.length; i++) {
      var c = live[i];
      p.push(c.x - md, c.x + md);
      var ys = [b.ylo, b.yhi];
      for (j = 0; j < 2; j++) {
        var dy = c.y - ys[j];
        if (dy < md && dy > -md) { var hh = Math.sqrt(md * md - dy * dy); p.push(c.x - hh, c.x + hh); }
      }
      for (j = i + 1; j < live.length; j++) {
        var ex = live[j].x - c.x, ey = live[j].y - c.y, dd = Math.sqrt(ex * ex + ey * ey);
        if (dd <= 0 || dd >= 2 * md) continue;
        var hk = Math.sqrt(md * md - dd * dd / 4), mx = (c.x + live[j].x) / 2;
        p.push(mx - hk * ey / dd, mx + hk * ey / dd);
      }
    }
    var q = [];
    for (i = 0; i < p.length; i++) if (p[i] >= b.xlo && p[i] <= b.xhi) q.push(p[i]);
    q.sort(function (u, v) { return u - v; });
    var out = [];
    for (i = 0; i < q.length; i++) if (!out.length || q[i] - out[out.length - 1] > 1e-9) out.push(q[i]);
    return out;
  }
  // Composite Simpson after x = a + (z - a)(1 - cos(pi t))/2: the lengths have
  // square-root corners at the breakpoints (a disc's edge turning vertical),
  // which plain Simpson integrates poorly; the substitution smooths them, so a
  // thin sliver of free area next to a circle is measured to within a percent.
  var SIMPSON = 8, W_PAD = 0.15;
  function simpson(fn, a, z) {
    if (z - a <= 1e-12) return 0;
    var half = (z - a) / 2, s = 0;
    for (var k = 1; k < SIMPSON; k++) {
      var th = Math.PI * k / SIMPSON;
      s += (k % 2 ? 4 : 2) * fn(a + half * (1 - Math.cos(th))) * Math.sin(th);
    }
    return s * half * Math.PI / SIMPSON / 3;
  }
  // Free length of column xp inside [a, z] (clipped to the box).
  function freeIn(live, xp, a, z, md, b) {
    if (a < b.ylo) a = b.ylo;
    if (z > b.yhi) z = b.yhi;
    if (z <= a) return 0;
    var iv = excl(live, xp, md, b), free = z - a;
    for (var k = 0; k < iv.length; k++) {
      var lo = iv[k][0] > a ? iv[k][0] : a, hi = iv[k][1] < z ? iv[k][1] : z;
      if (hi > lo) free -= hi - lo;
    }
    return free;
  }
  // Free area within r of (cx, cy). The column length is smooth between the
  // free area's own breakpoints and the x where the ring of radius r crosses
  // the top or bottom of the box or a live circle's edge.
  function areaNear(live, md, b, bp, cx, cy, r) {
    var lo = Math.max(b.xlo, cx - r), hi = Math.min(b.xhi, cx + r), i, j;
    if (!(hi > lo)) return 0;
    var p = [lo, hi];
    for (i = 0; i < bp.length; i++) if (bp[i] > lo && bp[i] < hi) p.push(bp[i]);
    var ys = [b.ylo, b.yhi];
    for (j = 0; j < 2; j++) {
      var dy = cy - ys[j];
      if (dy < r && dy > -r) { var hh = Math.sqrt(r * r - dy * dy); p.push(cx - hh, cx + hh); }
    }
    for (i = 0; i < live.length; i++) {
      var ex = live[i].x - cx, ey = live[i].y - cy, dd = Math.sqrt(ex * ex + ey * ey);
      if (!(dd > 0) || dd >= r + md || dd <= Math.abs(r - md)) continue;
      var aa = (dd * dd + r * r - md * md) / (2 * dd), hk = Math.sqrt(Math.max(0, r * r - aa * aa));
      var px = cx + aa * ex / dd;
      p.push(px - hk * ey / dd, px + hk * ey / dd);
    }
    var q = [];
    for (i = 0; i < p.length; i++) if (p[i] >= lo && p[i] <= hi) q.push(p[i]);
    q.sort(function (u, v) { return u - v; });
    var fn = function (xp) {
      var dx = xp - cx, h2 = r * r - dx * dx, h = h2 > 0 ? Math.sqrt(h2) : 0;
      return freeIn(live, xp, cy - h, cy + h, md, b);
    };
    var area = 0;
    for (i = 0; i + 1 < q.length; i++) if (q[i + 1] - q[i] > 1e-9) area += simpson(fn, q[i], q[i + 1]);
    return area;
  }
  // { f: free share of the box, ux, uy, w } for a spot (x, y); ux/uy null when
  // the box is flat in that direction or the spot sits where nothing is free.
  // refs: points known before the draw (the last spot, the last click, the
  // oldest live circle); w[j] = share of the free area that is at least as near
  // refs[j] as the spot. An honest draw makes each w uniform; a client that
  // picks spots near that point makes it small.
  function spot(live, W, H, g, x, y, refs) {
    var b = box(W, H, g), md = g.minDist, wx = b.xhi - b.xlo, wy = b.yhi - b.ylo;
    var colLen = function (xp) { return wy > 1e-9 ? freeBelow(live, xp, b.yhi, md, b) : freePoint(live, xp, b.ylo, md); };
    var out = { f: 1, ux: null, uy: null, w: [] };
    var j;
    refs = refs || [];
    if (wx > 1e-9) {
      var bp = breaks(live, md, b), total = 0, below = 0;
      for (var k = 0; k + 1 < bp.length; k++) {
        var part = simpson(colLen, bp[k], bp[k + 1]);
        total += part;
        if (x !== null) {
          if (bp[k + 1] <= x) below += part;
          else if (bp[k] < x) below += simpson(colLen, bp[k], x);
        }
      }
      out.f = total / wx / (wy > 1e-9 ? wy : 1);
      if (x !== null && total > 1e-9) {
        out.ux = Math.min(1, Math.max(0, below / total));
        if (wy > 1e-9) {
          for (j = 0; j < refs.length; j++) {
            // + W_PAD: spots are logged to 0.1 px, so one drawn right at a live
            // circle's spacing edge can read a hair inside it (free area 0).
            var ddx = x - refs[j].x, ddy = y - refs[j].y, rr = Math.sqrt(ddx * ddx + ddy * ddy) + W_PAD;
            out.w.push(Math.min(1, Math.max(0, areaNear(live, md, b, bp, refs[j].x, refs[j].y, rr) / total)));
          }
        }
      }
    } else {
      out.f = wy > 1e-9 ? colLen(b.xlo) / wy : colLen(b.xlo);
    }
    if (x !== null && wy > 1e-9) {
      var col = freeBelow(live, x, b.yhi, md, b);
      if (col > 1e-9) out.uy = Math.min(1, Math.max(0, freeBelow(live, x, Math.min(b.yhi, Math.max(b.ylo, y)), md, b) / col));
    }
    return out;
  }
  // P(Gamma(n, 1) >= L): for n draws of -ln(uniform), a sum this large or larger.
  function gammaUpper(n, L) {
    if (n <= 0 || !(L > 0)) return 1;
    var lt = -L, lnL = Math.log(L), terms = [lt], top = lt, k;
    for (k = 1; k < n; k++) { lt += lnL - Math.log(k); terms.push(lt); if (lt > top) top = lt; }
    var sum = 0;
    for (k = 0; k < n; k++) sum += Math.exp(terms[k] - top);
    return Math.min(1, Math.exp(top) * sum);
  }
  function pow30(q) { var p = 1; for (var i = 0; i < C.TRIES; i++) p *= q; return p; }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isInt(v) { return isNum(v) && Math.floor(v) === v; }

  function check(log, env) {
    var r = Q.result(), comp = !!env.comp, ev = log.ev;
    var mob = !!(log.env && log.env.mob);

    var W = 0, H = 0, g = null, geomVer = 0;
    var live = [];              // {st, x, y, d}
    var s = 0;                  // streak (hits logged)
    var score = 0, counting = true;
    var ended = false, paused = false, pAt = 0, pauses = 0, shortPauses = 0, pausedMs = 0;
    var shift = 0;              // sum of pause shifts so far
    var nextSpawn = C.FIRST_SPAWN, eligFrom = 0, lastFrame = -Infinity;
    var spawns = 0, maxLive = 0, pendingEarly = false;
    var prevSet = null, prevGeomVer = -1, prevW = 0, prevH = 0, prevGeom = null;
    var lateSpawns = 0, lateHits = 0, stallLate = 0, bigLate = 0, badFails = 0, failChecks = 0;
    var ux = [], uy = [];
    var lastSpot = null, lastClick = null, nearL = [0, 0, 0], nearN = [0, 0, 0];
    var hitP = [], hitOff = [], hitDx = [], hitDy = [], hitD = [], hitEdge = [], hitGT = [];

    function stop(why, i) {
      if (!counting) return;
      counting = false;
      r.stat('stoppedAt', score);
      r.stat('stopReason', why + ' (event ' + i + ')');
    }
    function eps() { return T.EPS_T; }

    for (var i = 0; i < ev.length; i++) {
      var e = ev[i], code = e[0], t = e[1];
      if (ended) return r.invalid('event ' + i + ' after the run ended');
      if (pendingEarly && code !== 'E') return r.invalid('an early click without its end (event ' + i + ')');
      if (i === 0 && code !== 'G') return r.invalid('the log does not start with the canvas size');

      if (code === 'G') {
        var w2 = e[2], h2 = e[3];
        if (e.length !== 4 || !isInt(w2) || !isInt(h2) || w2 < 0 || w2 > C.W_MAX) return r.invalid('bad canvas size (event ' + i + ')');
        if (h2 !== canvasH(w2, true) && h2 !== canvasH(w2, false)) return r.invalid('canvas height does not fit its width (event ' + i + ')');
        W = w2; H = h2; g = geom(H); geomVer++;
        // A canvas this small has no ring band to speak of (and nobody can play
        // on it): whatever is logged on it proves nothing.
        if (W < C.W_MIN) stop('canvas too small to play (' + W + ' px)', i);
        continue;
      }
      if (code === 'P') {
        if (e.length !== 2 || paused) return r.invalid('pause while paused (event ' + i + ')');
        paused = true; pAt = t;
        continue;
      }
      if (code === 'U') {
        var pf = e[2];
        if (e.length !== 3 || !paused || !isNum(pf) || pf < 0) return r.invalid('resume without a pause (event ' + i + ')');
        var pgap = Math.abs(pf - (t - pAt));
        if (pgap > T.PF_BAD) return r.invalid('pause shift does not match the pause (event ' + i + ')');
        if (pgap > T.PF_TOL) stop('pause shift off by ' + Math.round(pgap) + ' ms', i);
        paused = false; pauses++;
        if (t - pAt < P.PAUSE_SHORT_MS) shortPauses++;
        pausedMs += t - pAt;
        shift += pf;
        for (var u = 0; u < live.length; u++) live[u].st += pf;
        nextSpawn += pf;
        if (eligFrom !== Infinity) eligFrom += pf;
        continue;
      }
      if (paused) return r.invalid('play while paused (event ' + i + ')');

      if (code === 'S') {
        var sp = e[2], x = e[3], y = e[4], d = e[5], nf = e[6];
        if (e.length !== 7 || !isNum(sp) || !isNum(x) || !isNum(y) || !isInt(d) || !isInt(nf) || nf < 0) return r.invalid('bad spawn (event ' + i + ')');
        if (sp < lastFrame - eps()) return r.invalid('frame times go back (event ' + i + ')');
        if (sp > t + 120) stop('spawn frame after its log time', i);
        for (var a = 0; a < live.length; a++) {
          if (sp - live[a].st - live[a].d > eps()) return r.invalid('a circle outlived its ring at a later frame (event ' + i + ')');
        }
        if (live.length >= maxSimul(s, comp)) return r.invalid('more live circles than the streak allows (event ' + i + ')');
        if (d !== approach(s, comp)) return r.invalid('approach time is not the one for the streak (event ' + i + ')');
        if (sp < nextSpawn + nf * C.RETRY_MS - eps()) return r.invalid('spawned before the spawn gap (event ' + i + ')');
        var bx = box(W, H, g);
        if (x < bx.xlo - T.EPS_D || x > bx.xhi + T.EPS_D || y < bx.ylo - T.EPS_D || y > bx.yhi + T.EPS_D) return r.invalid('circle outside the spawn area (event ' + i + ')');
        for (var b2 = 0; b2 < live.length; b2++) {
          var ddx = x - live[b2].x, ddy = y - live[b2].y;
          if (Math.sqrt(ddx * ddx + ddy * ddy) < g.minDist - T.EPS_D) return r.invalid('circle placed on top of a live one (event ' + i + ')');
        }
        // where the spot fell in the free area, and how near it fell to the
        // points a picky client would pull it toward
        if (spawns < P.PIT_MAX) {
          var refs = [], rk = [];
          if (lastSpot) { refs.push(lastSpot); rk.push(0); }
          if (lastClick) { refs.push(lastClick); rk.push(1); }
          if (live.length) { refs.push(live[0]); rk.push(2); }
          var sd = spot(live, W, H, g, x, y, refs);
          if (sd.ux !== null) ux.push(sd.ux);
          if (sd.uy !== null) uy.push(sd.uy);
          for (var rj = 0; rj < sd.w.length; rj++) { nearL[rk[rj]] += -Math.log(Math.max(sd.w[rj], 1e-9)); nearN[rk[rj]]++; }
        }
        lastSpot = { x: x, y: y };
        // retries claimed where the area right after the previous spawn was free
        if (nf > 0 && failChecks < P.FAIL_MAX) {
          failChecks++;
          if (!prevSet) badFails++;
          else if (prevGeomVer === geomVer) {
            var fp = spot(prevSet, prevW, prevH, prevGeom, null, null).f;
            if (pow30(1 - Math.min(1, Math.max(0, fp))) < P.FAIL_P) badFails++;
          }
        }
        // held back: due at max(nextSpawn, when a slot opened), plus retries and frame lag
        var due = Math.max(nextSpawn, eligFrom);
        if (sp - due - nf * C.RETRY_MS > (nf + 1) * T.FRAME_LATE) lateSpawns++;

        live.push({ st: sp, x: x, y: y, d: d });
        spawns++;
        if (live.length > maxLive) maxLive = live.length;
        nextSpawn = sp + interval(s, comp);
        eligFrom = live.length < maxSimul(s, comp) ? sp : Infinity;
        lastFrame = sp;
        prevSet = live.slice(); prevGeomVer = geomVer; prevW = W; prevH = H; prevGeom = g;
        continue;
      }

      if (code === 'K') {
        var ki = e[2], mx = e[3], my = e[4], el = e[5], h = e[6];
        if (e.length !== 7 || !isInt(ki) || ki < 0 || ki >= live.length || !isNum(mx) || !isNum(my) || !isNum(el) || (h !== 0 && h !== 1)) return r.invalid('bad click (event ' + i + ')');
        var c = live[ki], nowH = c.st + el;
        if (t < nowH - T.EPS_K) return r.invalid('click judged later than it was logged (event ' + i + ')');
        if (t > nowH + T.K_SLOW) stop('click logged long after it was judged', i);
        // the oldest live circle in reach takes the click
        for (var j = 0; j < ki; j++) {
          var qx = mx - live[j].x, qy = my - live[j].y;
          if (Math.sqrt(qx * qx + qy * qy) < g.reach - T.EPS_D) return r.invalid('an older circle was in reach of the click (event ' + i + ')');
        }
        var kx = mx - c.x, ky = my - c.y, dist = Math.sqrt(kx * kx + ky * ky);
        if (dist > g.reach + T.EPS_D) return r.invalid('click out of reach of its circle (event ' + i + ')');
        // the ring test
        var open = c.d * (1 - g.HT / (g.OUT - g.R));
        if (Math.abs(el - open) > T.EPS_EL && isEarly(el, c.d, g) !== (h === 0)) return r.invalid('click outcome does not match its timing (event ' + i + ')');
        // circles that should have closed already (no frame ran since?)
        for (var m = 0; m < live.length; m++) {
          if (nowH - live[m].st - live[m].d > T.LATE_STOP) { stop('click after a circle had closed', i); break; }
        }
        if (h === 1 && el > c.d) lateHits++;
        if (h === 1 && el - c.d > T.LATE_NOTE) stallLate++;
        if (h === 1 && el - c.d > T.LATE_BIG) bigLate++;
        live.splice(ki, 1);
        lastClick = { x: mx, y: my };
        if (h === 1) {
          s++;
          if (counting) score++;
          hitP.push(el / c.d); hitOff.push(el - c.d); hitD.push(c.d);
          hitDx.push(kx); hitDy.push(ky); hitEdge.push(el - open); hitGT.push(nowH - shift);
          if (eligFrom === Infinity && live.length < maxSimul(s, comp)) eligFrom = nowH;
        } else {
          pendingEarly = true;
        }
        continue;
      }

      if (code === 'E') {
        var why = e[2];
        if (why === 'early') {
          if (e.length !== 3 || !pendingEarly) return r.invalid('"too early" end without an early click (event ' + i + ')');
          pendingEarly = false; ended = true;
          continue;
        }
        if (why === 'slow') {
          var ei = e[3], eel = e[4];
          if (e.length !== 5 || !isInt(ei) || ei < 0 || ei >= live.length || !isNum(eel)) return r.invalid('bad end (event ' + i + ')');
          var ec = live[ei], F = ec.st + eel;
          if (eel < ec.d - eps()) return r.invalid('"too slow" before the ring closed (event ' + i + ')');
          if (F < lastFrame - eps()) return r.invalid('frame times go back (event ' + i + ')');
          for (var n = ei + 1; n < live.length; n++) {
            if (F - live[n].st - live[n].d > eps()) return r.invalid('the wrong circle closed (event ' + i + ')');
          }
          ended = true;
          continue;
        }
        return r.invalid('unknown end (event ' + i + ')');
      }
      return r.invalid('unknown event ' + code);
    }

    if (pendingEarly && ev.length < Q.LIMITS.MAX_EVENTS) return r.invalid('an early click without its end');
    // Every point claimed is a hit in the log (the only honest gap: a log cut
    // at the event cap).
    if (env.claimed > s && ev.length < Q.LIMITS.MAX_EVENTS - 2) return r.invalid('claim ' + env.claimed + ' above the ' + s + ' points logged');
    r.score = score;

    // ── stats ────────────────────────────────────────────────────────────────
    var md = S.mean(hitD) || 1;
    var sdT = Math.min(S.sd(hitP) * md, S.sd(hitOff));
    var posSd = Math.sqrt((S.sd(hitDx) * S.sd(hitDx) + S.sd(hitDy) * S.sd(hitDy)) / 2);
    var edge = 0; for (var q = 0; q < hitEdge.length; q++) if (hitEdge[q] < P.EDGE_MS) edge++;
    var gaps = S.diffs(hitGT);
    var ksx = S.ksUniform(ux), ksy = S.ksUniform(uy);
    // Each spot is drawn afresh, so it says nothing about the points known
    // before it: w against each of them is uniform (see spot()), -ln w is an
    // exponential draw, and n of them sum to a Gamma(n) draw.
    var NEAR = ['the last spot', 'the last click', 'the oldest circle'];
    var nearP = [];
    for (var nr = 0; nr < 3; nr++) nearP.push(gammaUpper(nearN[nr], nearL[nr]));
    var endT = ev.length ? ev[ev.length - 1][1] : 0;
    var activeMin = Math.max(0, endT - pausedMs) / 60000;
    r.stat('hits', s); r.stat('spawns', spawns); r.stat('pauses', pauses); r.stat('shortPauses', shortPauses);
    r.stat('resizes', geomVer - 1); r.stat('maxLive', maxLive);
    r.stat('W', W); r.stat('H', H);
    r.stat('progressMean', S.mean(hitP)); r.stat('timingSdMs', sdT); r.stat('aimSdPx', posSd);
    r.stat('edgeShare', hitEdge.length ? edge / hitEdge.length : 0);
    r.stat('gapSdMs', S.sd(gaps));
    r.stat('spotPx', ksx.p); r.stat('spotPy', ksy.p);
    r.stat('nearSpotP', nearP[0]); r.stat('nearClickP', nearP[1]); r.stat('nearOldestP', nearP[2]);
    r.stat('lateSpawns', lateSpawns); r.stat('lateHits', lateHits); r.stat('stallLateHits', stallLate); r.stat('bigLateHits', bigLate); r.stat('unlikelyRetries', badFails);

    // ── is this a person ─────────────────────────────────────────────────────
    var why2;
    if (hitP.length >= P.TIME_N && sdT < P.TIME_SD) r.review('timing too even (spread ' + sdT.toFixed(2) + ' ms over ' + hitP.length + ' hits)');
    if (hitDx.length >= P.POS_N && posSd < P.POS_SD) r.review('aim too exact (spread ' + posSd.toFixed(2) + ' px over ' + hitDx.length + ' hits)');
    if (hitEdge.length >= P.EDGE_N && edge / hitEdge.length >= P.EDGE_SHARE) r.review('hits hug the first edge of the band (' + edge + ' of ' + hitEdge.length + ' within ' + P.EDGE_MS + ' ms)');
    if ((why2 = Q.tooSteady(gaps, P.GAP_N, P.GAP_SD))) r.review(why2);
    if (ux.length >= P.PIT_N && (why2 = Q.tooLucky(ksx.p, P.PIT_ALPHA, 'spots across'))) r.review(why2);
    if (uy.length >= P.PIT_N && (why2 = Q.tooLucky(ksy.p, P.PIT_ALPHA, 'spots down'))) r.review(why2);
    for (nr = 0; nr < 3; nr++) {
      if (nearN[nr] >= P.PIT_N && (why2 = Q.tooLucky(nearP[nr], P.NEAR_ALPHA, 'spots near ' + NEAR[nr] + ' over ' + nearN[nr]))) r.review(why2);
    }
    // Pausing takes three clicks (another trainer's tab, this tab, Resume).
    if (shortPauses >= P.PAUSE_SHORT_N) r.review('pauses too short to be clicked (' + shortPauses + ' under ' + P.PAUSE_SHORT_MS + ' ms)');
    if (pauses >= P.PAUSE_N && pauses >= P.PAUSE_PER_MIN * activeMin) r.review('paused over and over (' + pauses + ' pauses in ' + activeMin.toFixed(1) + ' min of play)');
    if (lateSpawns >= P.LATE_SPAWN_N && lateSpawns >= P.LATE_SPAWN_SHARE * spawns) r.review('circles held back (' + lateSpawns + ' of ' + spawns + ' spawns late)');
    if (lateHits >= P.LATE_HIT_N && lateHits >= P.LATE_HIT_SHARE * s) r.review('hits after the ring closed (' + lateHits + ' of ' + s + ')');
    if (stallLate >= P.STALL_LATE_N && stallLate >= P.STALL_LATE_SHARE * s) r.review('hits long after the ring closed (' + stallLate + ' of ' + s + ')');
    if (bigLate >= P.BIG_LATE_N && bigLate >= P.BIG_LATE_SHARE * s) r.review('hits long after the ring closed (' + bigLate + ' over ' + T.LATE_BIG + ' ms)');
    if (badFails >= P.FAIL_N) r.review('spawn retries claimed with room to spare (' + badFails + ')');
    return r;
  }

  Q.register('spear', {
    C: C, T: T, P: P,
    maxSimul: maxSimul, approach: approach, interval: interval,
    canvasH: canvasH, geom: geom, isEarly: isEarly,
    spot: spot, gammaUpper: gammaUpper,
    check: check,
  });
})(typeof globalThis !== 'undefined' ? globalThis.QteRules : this.QteRules);

// ==== qte-rules part: sword ====
// ── sword ─────
// Sword trainer ('sword', 'sword-comp'; js/qte.js "SWORD QTE TRAINER").
// A round sends n bars in from the left, spaced by random gaps. Space / tap
// stops the lead bar, which has to overlap the zone. Clearing every bar of a
// round is one point; the first bar stopped outside the zone, or a lead bar
// that runs off the track, ends the run.
//
// The log (t = ms since the run's Start):
//   ['R', t, s, cw, n, g0 .. g(n-1)]  a round starts: streak s (rounds cleared
//                                     so far), canvas width, bar count, the n
//                                     gap draws in px (the last one is drawn
//                                     but not used, as in the original loop)
//   ['K', t, i, x, gT, hit]           a press, as judged: lead bar i, its x in
//                                     the last drawn frame, the round's game
//                                     time in ms (sum of the clamped frame
//                                     dts since the round started), 1 = in zone
//   ['E', t, 'zone']                  right after a missed K
//   ['E', t, 'slow', i, x, gT]        the lead bar ran off the track
//   ['P', t] / ['U', t]               panel hidden (paused) / Resume clicked
//   ['Z', t, cw]                      canvas resized while a run is live
//
// Bars move x += v*dt each frame, so a bar's x is a pure function of its start
// (from the logged gaps) and the round's game time: check() re-derives it for
// every press, re-judges the zone test, and holds game time to the clock.
(function (Q) {
  'use strict';
  var S = Q.stats;

  // ── constants the trainer reads (js/qte.js) ─────────────────────────────────
  var C = {
    PAD: 50,            // trackX; trackW = canvas.width - 2*PAD
    BAR_W: 10,
    TRACK_H: 26,
    GAP_MIN: 75,        // px between bars in a round: GAP_MIN + rand*(GAP_MAX-GAP_MIN)
    GAP_MAX: 130,
    ZONE_START: 0.70,   // zoneX = PAD + trackW*ZONE_START
    ROUND_DELAY: 800,   // ms from the last hit of a round to the next round
    FAIL_RESET: 900,    // ms from a fail to the Start button coming back
    DT_MAX: 0.05,       // s, frame dt clamp
    CW_MAX: 900,        // canvas.width = min(wrap - 24 || 800, 900)
    CW_MIN: 100,        // below this the track has no length; points stop counting
  };

  // Tables by streak s (rounds cleared), mode and IS_MOBILE. The expressions
  // are the original ones, operation for operation, so both sides get the
  // same doubles.
  function speed(s, comp, mob) {
    return comp
      ? (mob ? Math.min(220 + s * 8, 420) : Math.min(400 + s * 9, 610))
      : (mob ? Math.min(160 + s * 6, 320) : Math.min(300 + s * 10, 520));
  }
  function bars(s, comp, mob) {
    return comp
      ? (mob ? Math.min(3 + Math.floor(s / 3), 6) : Math.min(4 + Math.floor(s / 2), 8))
      : (mob ? Math.min(2 + Math.floor(s / 4), 5) : Math.min(3 + Math.floor(s / 3), 7));
  }
  function zoneFrac(s, comp, mob) {
    return comp
      ? (mob ? Math.max(0.21 - s * 0.007, 0.10) : Math.max(0.14 - s * 0.004, 0.07))
      : (mob ? Math.max(0.28 - s * 0.007, 0.14) : Math.max(0.16 - s * 0.004, 0.10));
  }
  // Zone for a round: computed once at round start from the trackW of then.
  function zone(trackW, s, comp, mob) {
    return { x: C.PAD + trackW * C.ZONE_START, w: trackW * zoneFrac(s, comp, mob) };
  }
  // The hit test: any overlap with the zone, 2 px of grace each side.
  function inZone(x, zoneX, zoneW) {
    return x < zoneX + zoneW + 2 && x + C.BAR_W > zoneX - 2;
  }
  // The "Too slow!" test, against the trackW of now (it follows resizes).
  function pastEnd(x, trackW) {
    return x > C.PAD + trackW + C.BAR_W;
  }

  // ── tolerances (never reasons to reject a real client) ─────────────────────
  var T = {
    X_EPS: 0.05,        // px: logged x vs x0 + v*gT (4 dp rounding of x, gT, gaps)
    EDGE_EPS: 0.001,    // px: a hit flag this close to a zone edge is taken as logged
    GT_AHEAD: 200,      // ms: game time ahead of the clock, since the round's R
                        // and since the round's previous press: between two
                        // events at most two frames can carry time from before
                        // the first (each dt clamped to 50) + coarse clocks
                        // (privacy modes floor performance.now to 16.7 or
                        // 100 ms; at 100 the game clock runs at ~50%) + rounding
    // Game time is NOT held to be positive or to only go forward: Start and
    // Resume set lastTime = performance.now(), and the next rAF timestamp is
    // the frame's begin time, which after a long task can be hundreds of ms
    // earlier - an honest negative dt (the bars step back). Each press is
    // judged on its own x, so a backwards clock gains a log nothing.
    DELAY_EPS: 120,     // ms: next round no sooner than ROUND_DELAY - this
  };
  // ── review thresholds (far outside what hands produce) ─────────────────────
  // Offsets and intervals use the MAD (robust spread, scaled to an SD) so a
  // few dropped frames or double taps cannot hide a machine, and a few wild
  // presses cannot make a person look like one.
  var RV = {
    // where the bar was (in ms of travel) from the zone centre at each hit:
    // the frame alone scatters this (60 Hz: MAD ~6 ms, 144 Hz: ~2.6 ms)
    ACC_N: 30,  ACC_MAD: 1.5,
    // press-to-press time within a round vs the time the gap between the two
    // bars takes to travel: a person's error doubles here (two presses), a
    // script that presses on the ideal moment is exact to the millisecond
    // (a script on the real client: 0.85-1.3 ms; the simulated top tier of
    // players, sigma ~5 ms a press - beyond real hands - never below 3.2 ms
    // in 40,000 runs)
    IV_N: 20,   IV_MAD: 2.0,
    // gap draws not uniform (honest logs: about 1 check in 30,000 falls under
    // 1e-4, so 1e-6; doctored gaps land at 1e-27 and below)
    KS_N: 20,   KS_ALPHA: 1e-6,
    SLOW_N: 8,  SLOW_RATIO: 0.6, SLOW_MIN_WALL: 300, // game clock < 60% of the wall clock
    COARSE_Q: 100, COARSE_SHARE: 0.9, // clocks floored to 100 ms (Tor / resist-
                        // fingerprinting): frames there get dt 0 or a clamped
                        // 100, so the game clock honestly runs at ~50%
  };

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isCw(v) { return isNum(v) && Math.floor(v) === v && v >= 0 && v <= C.CW_MAX; }

  function check(log, env) {
    var r = Q.result();
    var ev = log.ev;
    var comp = !!env.comp;
    var le = log.env || {};
    var mob = le.mob === true;
    var claimed = env.claimed | 0;
    r.stat('claimed', claimed);
    r.stat('mob', mob);
    if (isNum(le.ping)) r.stat('ping', le.ping);
    if (env.platform) r.stat('platform', env.platform);
    if (env.platform && (env.platform === 'M') !== mob) r.stat('platformMismatch', true);
    if (log.a !== 0) r.stat('attempt', log.a);

    var phase = 'idle';          // idle | round | pending | missed | ended
    var paused = false, tP = 0, pausedTotal = 0, pausedAtR = 0;
    var s = 0, proven = 0, stopped = null;
    var cw = 0, curCw = 0, zx = 0, zw = 0, v = 0, n = 0, x0 = [], next = 0, tR = 0, tDone = 0;
    var lastHitT = -1, lastHitBar = -1, pausedSinceHit = false;
    var offsets = [], ivs = [], draws = [], ratios = [], presses = 0, pauses = 0, rounds = 0, resizes = 0;
    var coarse = 0, times = 0;
    var why = null, at = -1;

    function motion(bi, x, g, t) {
      var pred = x0[bi] + v * g / 1000;
      if (Math.abs(pred - x) > T.X_EPS) return 'bar ' + bi + ' is not where its start and the game time put it';
      var wall = t - tR - (pausedTotal - pausedAtR);
      if (g > wall + T.GT_AHEAD) return 'game time ahead of the clock (' + Math.round(g) + ' ms in ' + wall + ' ms)';
      // and press to press: two presses logged at (nearly) one time cannot be
      // a bar's travel apart in game time
      var step = t - prevT - (pausedTotal - pausedAtPrev);
      if (g - prevG > step + T.GT_AHEAD) return 'game time ahead of the clock between presses (' + Math.round(g - prevG) + ' ms in ' + step + ' ms)';
      return null;
    }
    var prevT = 0, prevG = 0, pausedAtPrev = 0;   // the round's R, then its last hit

    for (var i = 0; i < ev.length && !why; i++) {
      var e = ev[i], c = e[0], t = e[1];
      at = i;
      if (t > 0) { times++; if (t % RV.COARSE_Q === 0) coarse++; }
      if (phase === 'ended') { why = 'event after the run ended'; break; }
      if (phase === 'missed' && !(c === 'E' && e[2] === 'zone')) { why = 'a miss not followed by the end of the run'; break; }

      if (c === 'R') {
        if (phase !== 'idle' && phase !== 'pending') { why = 'a round started before the last one was cleared'; break; }
        if (paused) { why = 'a round started while paused'; break; }
        if (e.length < 5) { why = 'malformed round'; break; }
        var rs = e[2], rcw = e[3], rn = e[4];
        if (rs !== s) { why = 'round ' + rs + ' logged after ' + s + ' cleared'; break; }
        if (!isCw(rcw)) { why = 'impossible canvas width'; break; }
        if (rn !== bars(s, comp, mob)) { why = 'wrong bar count for streak ' + s; break; }
        if (e.length !== 5 + rn) { why = 'wrong number of gaps'; break; }
        if (phase === 'pending' && t - tDone < C.ROUND_DELAY - T.DELAY_EPS) { why = 'next round came ' + (t - tDone) + ' ms after the last'; break; }
        cw = curCw = rcw;
        var z = zone(cw - 2 * C.PAD, s, comp, mob);
        zx = z.x; zw = z.w; v = speed(s, comp, mob); n = rn;
        x0 = [];
        var xp = C.PAD - C.BAR_W;
        for (var k = 0; k < rn; k++) {
          var g = e[5 + k];
          if (!isNum(g) || g < C.GAP_MIN || g > C.GAP_MAX) { why = 'bar gap out of range'; break; }
          x0.push(xp);
          xp -= g;
          draws.push((g - C.GAP_MIN) / (C.GAP_MAX - C.GAP_MIN));
        }
        if (why) break;
        if (cw < C.CW_MIN && !stopped) stopped = 'canvas ' + cw + ' px wide';
        next = 0; tR = t; pausedAtR = pausedTotal; phase = 'round'; rounds++;
        prevT = t; prevG = 0; pausedAtPrev = pausedTotal;
        lastHitBar = -1;
      } else if (c === 'K') {
        if (phase !== 'round') { why = 'a press outside a round'; break; }
        if (paused) { why = 'a press while paused'; break; }
        var bi = e[2], x = e[3], gt = e[4], h = e[5];
        if (e.length !== 6 || bi !== next || !isNum(x) || !isNum(gt) || (h !== 0 && h !== 1)) { why = 'malformed or out-of-order press'; break; }
        why = motion(bi, x, gt, t);
        if (why) break;
        presses++;
        var hitNow = inZone(x, zx, zw);
        if (hitNow !== (h === 1)) {
          var nearEdge = Math.abs(x - (zx + zw + 2)) < T.EDGE_EPS || Math.abs(x + C.BAR_W - (zx - 2)) < T.EDGE_EPS;
          if (!nearEdge) { why = h === 1 ? 'a miss logged as a hit' : 'a hit logged as a miss'; break; }
          hitNow = h === 1;
        }
        if (hitNow) {
          offsets.push(((x + C.BAR_W / 2) - (zx + zw / 2)) / v * 1000);
          // press interval vs the travel time of the gap between the two bars
          if (bi > 0 && lastHitBar === bi - 1 && !pausedSinceHit) ivs.push((t - lastHitT) - (x0[bi - 1] - x0[bi]) / v * 1000);
          lastHitBar = bi; lastHitT = t; pausedSinceHit = false;
          prevT = t; prevG = gt; pausedAtPrev = pausedTotal;
          next++;
          if (next === n) {
            s++;
            if (!stopped) proven = s;
            var wall = t - tR - (pausedTotal - pausedAtR);
            if (wall >= RV.SLOW_MIN_WALL) ratios.push(gt / wall);
            phase = 'pending'; tDone = t;
          }
        } else {
          phase = 'missed';
        }
      } else if (c === 'E') {
        var reason = e[2];
        if (reason === 'zone') {
          if (phase !== 'missed' || e.length !== 3) { why = 'a zone miss with no missed press'; break; }
          phase = 'ended';
        } else if (reason === 'slow') {
          if (phase !== 'round' || paused) { why = 'a bar ran off outside a live round'; break; }
          if (e.length !== 6 || e[3] !== next || !isNum(e[4]) || !isNum(e[5])) { why = 'malformed end'; break; }
          why = motion(e[3], e[4], e[5], t);
          if (why) break;
          if (!(e[4] > C.PAD + (curCw - 2 * C.PAD) + C.BAR_W - T.EDGE_EPS)) { why = 'run ended as too slow with the bar still on the track'; break; }
          phase = 'ended';
        } else { why = 'unknown end'; break; }
      } else if (c === 'P') {
        if (paused) { why = 'paused twice'; break; }
        if (phase !== 'round' && phase !== 'pending') { why = 'paused outside a run'; break; }
        paused = true; tP = t; pauses++; pausedSinceHit = true;
      } else if (c === 'U') {
        if (!paused) { why = 'resumed without a pause'; break; }
        pausedTotal += t - tP; paused = false;
      } else if (c === 'Z') {
        if (phase !== 'round' && phase !== 'pending') { why = 'resize outside a run'; break; }
        if (e.length !== 3 || !isCw(e[2])) { why = 'impossible canvas width'; break; }
        curCw = e[2]; resizes++;
      } else {
        why = 'unknown event ' + c;
      }
    }

    if (why) { r.invalid('event ' + at + ': ' + why); r.score = 0; return r; }
    if (claimed > 0 && rounds === 0) { r.invalid('a score with no rounds behind it'); return r; }

    r.score = proven;
    if (stopped) { r.stat('stoppedAt', proven); r.stat('stopped', stopped); }
    r.stat('rounds', s);
    r.stat('presses', presses);
    r.stat('hits', offsets.length);
    r.stat('pauses', pauses);
    if (resizes) r.stat('resizes', resizes);
    r.stat('cw', cw);
    var isCoarse = times >= 20 && coarse / times >= RV.COARSE_SHARE;
    if (isCoarse) r.stat('coarseClock', true);

    // ── is this a person ──
    if (offsets.length) {
      r.stat('offMeanMs', S.mean(offsets));
      r.stat('offSdMs', S.sd(offsets));
      var offMad = S.mad(offsets);
      r.stat('offMadMs', offMad);
      if (offsets.length >= RV.ACC_N && offMad < RV.ACC_MAD) {
        r.review('too accurate (bar-to-zone-centre spread ' + offMad.toFixed(2) + ' ms over ' + offsets.length + ' hits)');
      }
    }
    if (ivs.length) {
      var ivMad = S.mad(ivs);
      r.stat('ivMadMs', ivMad);
      r.stat('ivN', ivs.length);
      if (ivs.length >= RV.IV_N && ivMad < RV.IV_MAD) {
        r.review('press timing matches the bar gaps to ' + ivMad.toFixed(2) + ' ms over ' + ivs.length + ' presses');
      }
    }
    if (draws.length >= RV.KS_N) {
      var ks = S.ksUniform(draws);
      r.stat('gapsP', ks.p);
      var lucky = Q.tooLucky(ks.p, RV.KS_ALPHA, draws.length + ' bar gaps');
      if (lucky) r.review(lucky);
    }
    if (ratios.length) {
      var med = S.median(ratios);
      r.stat('clockRatio', med);
      if (ratios.length >= RV.SLOW_N && med < RV.SLOW_RATIO && !isCoarse) {
        r.review('game clock ran at ' + Math.round(med * 100) + '% of the wall clock over ' + ratios.length + ' rounds');
      }
    }
    return r;
  }

  Q.register('sword', {
    PAD: C.PAD, BAR_W: C.BAR_W, TRACK_H: C.TRACK_H, GAP_MIN: C.GAP_MIN, GAP_MAX: C.GAP_MAX,
    ZONE_START: C.ZONE_START, ROUND_DELAY: C.ROUND_DELAY, FAIL_RESET: C.FAIL_RESET, DT_MAX: C.DT_MAX,
    speed: speed, bars: bars, zoneFrac: zoneFrac, zone: zone, inZone: inZone, pastEnd: pastEnd,
    T: T, RV: RV,
    check: check,
  });
})(typeof globalThis !== 'undefined' ? globalThis.QteRules : this.QteRules);

// ==== qte-rules part: dodge ====
// ── dodge ─────
// Dodge / dodge-comp (js/qte.js, DODGE QTE TRAINER). A white bar flies left to
// right; one press while it overlaps the yellow target is a point, anything
// else ends the run. The trainer reads its curves and timers from here.
//
// The log (times are ms since Start, numbers rounded to 4 dp by run.ev):
//   ['G', t, trackW]                     Start: track width px (canvas.width - 100)
//   ['T', t, k, yc, yw]                  target k made: centre (fraction of the
//                                        track) and width px
//   ['L', t, k]                          the bar for target k launched (x 50, flown 0)
//   ['H', t, k, whiteX, flown, hit, lf]  a press judged while the bar flew: bar x px
//                                        (from the last frame), game ms flown (sum of
//                                        clamped frame dt), 1 hit / 0 miss, and ms
//                                        since that last frame
//   ['Z', t, trackW]                     the track was resized (panel shown again)
//   ['P', t] / ['U', t]                  paused (panel hidden) / resumed (Resume)
//   ['E', t, 'miss']                     after a missed press
//   ['E', t, 'slow', whiteX, flown]      the bar left the track
//   ['E', t, 'reset']                    the run was torn down with no fail
(function (Q) {
  'use strict';

  // ── the rules (read by the trainer) ────────────────────────────────────────
  var PAD = 50, BAR_W = 10, TOL = 8, TRACK_H = 26;
  var YC_START = 0.70, YC_MIN = 0.62, YC_SPAN = 0.18, YC_STEP = 0.06;
  var FIRST_LAUNCH_MS = 400, NEXT_LAUNCH_MS = 550, RESUME_LAUNCH_MS = 400, RESET_MS = 900;
  var DT_CAP = 0.05;                          // gameLoop clamps a frame to 50 ms
  var MAX_TRACK_W = 900 - 2 * PAD;            // canvas.width is capped at 900
  // canvas.width = min(wrap.clientWidth - 24 || 800, 900): clientWidth >= 0, so
  // never under -24 (a browser turns a negative width into 300, but allow either).
  var MIN_TRACK_W = -24 - 2 * PAD;
  // The trainer stops sending new highs this close to the log's time limit (a
  // run left paused for half a day): a later event would fail validateLog.
  var SUBMIT_MAX_MS = Q.LIMITS.MAX_T - 60000;

  // Bar speed px/s while the streak (points so far) is s.
  function speed(s, comp) { return comp ? Math.min(480 + s * 16, 720) : Math.min(370 + s * 12, 580); }
  // Target width px for the streak s on a track trackW px wide.
  function width(s, trackW, comp) {
    return comp ? Math.max(trackW * (0.065 - s * 0.007), BAR_W * 0.5)
                : Math.max(trackW * (0.09 - s * 0.008), BAR_W * 0.5);
  }
  // Next target centre: uniform in [0.62, 0.80), re-drawn while within 0.06 of the last.
  function nextCenter(prev, rand) {
    var next;
    do { next = YC_MIN + rand() * YC_SPAN; } while (Math.abs(next - prev) < YC_STEP);
    return next;
  }

  // ── tolerances ─────────────────────────────────────────────────────────────
  // yc is logged to 4 dp (up to 0.00005 x 800 px = 0.04 px off), whiteX to 4 dp.
  var EPS_PX = 0.06;          // a press this close to a window edge may go either way
  var EPS_YC = 0.00011;       // range / step checks on the 4 dp centre
  var EPS_YW = 0.001;         // width is recomputed exactly; the log has 4 dp
  var X_EPS = 0.05;           // whiteX vs 50 + speed * flown (float sums + rounding)
  // Timers are never early. But each logged time is rounded to 1 ms, and browsers
  // clamp performance.now() (and rAF stamps) to a quantum q: 1 ms, or 16.7 ms /
  // 100 ms under fingerprinting protection - and Firefox jitters the clamp, so a
  // clamped time can sit up to q either side of the true one. Two logged times
  // can then be up to 2q + 1 ms closer than the timer between them: 35 ms at
  // q = 16.7. A 100 ms clock is detected from the log itself (every time a
  // multiple of 100) and gets its own allowance: both times are multiples of
  // 100, so a 550 ms gap logs as >= 400 (150 early) and a 400 ms one as >= 300.
  var TIMER_EARLY_MS = 50;    // earlier than this: stop counting
  var TIMER_BAD_MS = 150;     // earlier than this: impossible
  // Game time flown vs wall time since launch (minus pauses): the first frame after
  // a launch carries up to one clamped frame (50 ms) from before it, rAF stamps are
  // frame starts, and the flown time (rAF stamps) and the wall time (logged times)
  // each carry up to 2q of clamping: at most 50 + 4q + 1 ms over, 118 at q = 16.7.
  // On a 100 ms clock a frame step is >= 100 ms but counts 50, so flown runs at
  // half speed: over <= 50 + 200 - wall / 2, at most 250.
  var TRAVEL_SLACK_MS = 160;  // over this: stop counting
  var TRAVEL_BAD_MS = 400;    // over this: impossible
  var TRAVEL_MIN_MS = -300;   // a rAF stamp before a resume makes a frame's dt a little negative
  var COARSE_MS = 100;        // a log whose every time is a multiple of this: a 100 ms clock
  var COARSE_TIMER_MS = 100;  // more allowance for the launch timers on that clock
  var COARSE_TRAVEL_MS = 150; // more allowance for flown vs wall on that clock
  var LF_CAP_MS = 50;         // 'ms since the last frame' used for accuracy, clamped

  // ── person checks (held for review, far outside real play) ─────────────────
  // Accuracy: press moment (bar position + time since the frame) vs the centre of
  // the hit window, in ms. Hands spread 5-30 ms; a script's key lands within 1-2.
  // 20 hits: a 20-point run already ranks, and the chance an SD of 5 ms
  // (better than any hand) shows under 2.5 over 19 degrees of freedom is ~1e-3.
  var ACC_MIN_N = 20, ACC_MAX_SD_MS = 2.5;
  // Intervals between scoring presses vary with where each target lands (tens to
  // hundreds of ms); equal intervals are a metronome.
  var STEADY_MIN_N = 15, STEADY_MAX_SD_MS = 3.0;
  var DRAW_MIN_N = 10, DRAW_ALPHA = 1e-4;        // targets vs the rejection sampler
  // A canvas under 200 px turns the game into a pure 550 ms rhythm: hold runs
  // with many points scored on such a track.
  var SMALL_TRACK_W = 100, SMALL_TRACK_HITS = 10;
  // Slow motion: the bar's game time vs the clock over a flight. A frame counts at
  // most 50 ms, so only a page under 10 fps for the whole run gets near 0.5 - or a
  // script that slows the bar's frames down. Not judged on a 100 ms clock (its
  // frames advance 50 ms per 100 ms by design).
  var FLIGHT_MIN_N = 20, FLIGHT_MIN_WALL_MS = 200, FLIGHT_MIN_RATIO = 0.5;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isInt(x) { return isNum(x) && Math.floor(x) === x; }

  // Where yc sits in the distribution nextCenter draws from, given prev: 0..1.
  function drawU(yc, prev) {
    var lo = Math.max(YC_MIN, prev - YC_STEP), hi = Math.min(YC_MIN + YC_SPAN, prev + YC_STEP);
    var ex = Math.max(0, hi - lo), total = YC_SPAN - ex;
    var below = yc - YC_MIN;
    if (yc >= hi) below -= ex;
    else if (yc > lo) below = lo - YC_MIN;
    var u = below / total;
    return u < 0 ? 0 : (u > 1 ? 1 : u);
  }

  function check(log, env) {
    var r = Q.result(), S = Q.stats, ev = log.ev, comp = !!env.comp;
    var claimed = env.claimed | 0;

    // A claim needs hits behind it, counted or not (unless the log hit its cap).
    var logged = 0;
    for (var c = 0; c < ev.length; c++) if (ev[c][0] === 'H' && ev[c][5] === 1) logged++;
    r.stat('hitsLogged', logged);
    if (claimed > logged && ev.length < Q.LIMITS.MAX_EVENTS) {
      r.invalid('claims ' + claimed + ' with ' + logged + ' hits in the log'); return r;
    }
    if (!ev.length) { r.score = 0; return r; }

    // A 100 ms clock (privacy.resistFingerprinting): every time a multiple of it.
    // Two non-zero times are enough (a first submit is only G T L H); a false
    // positive only loosens the timing slack.
    var coarse = true, nz = 0;
    for (var cc = 0; cc < ev.length && coarse; cc++) {
      if (ev[cc][1] % COARSE_MS !== 0) coarse = false;
      else if (ev[cc][1] > 0) nz++;
    }
    coarse = coarse && nz >= 2;
    var timerEarly = TIMER_EARLY_MS + (coarse ? COARSE_TIMER_MS : 0);
    var timerBad = TIMER_BAD_MS + (coarse ? COARSE_TIMER_MS : 0);
    var travelSlack = TRAVEL_SLACK_MS + (coarse ? COARSE_TRAVEL_MS : 0);
    var travelBad = TRAVEL_BAD_MS + (coarse ? COARSE_TRAVEL_MS : 0);
    if (coarse) r.stat('coarseClock', 1);

    var hits = 0, stopped = false, bad = false;
    var trackW = 0, smallHits = 0;
    var k = 0, yc = 0, yw = 0;                    // current target
    var inFlight = false, launchT = 0, paused = false, pauseAt = 0, pausedFlight = 0;
    var pend = null;                              // when the pending launch timer is due
    var expectT = false, expectEnd = false, ended = false;
    var acc = [], hitTimes = [], draws = [], pauses = 0, late = [], ratios = [];

    function invalid(i, why) { bad = true; r.invalid('event ' + i + ' (' + ev[i][0] + '): ' + why); }
    function stop(i, why) { stopped = true; r.stat('stoppedAt', i); r.stat('stopReason', why); }
    // A track of 0 or less is legal (a window under 125 px): the bar leaves it on
    // the first frame, and hits on tracks that small are held for review below.
    function trackOk(i, w) {
      if (!isInt(w) || w > MAX_TRACK_W || w < MIN_TRACK_W) { invalid(i, 'track width ' + w + ' is not possible'); return false; }
      return true;
    }

    for (var i = 0; i < ev.length && !bad && !stopped; i++) {
      var e = ev[i], code = e[0], t = e[1];
      if (ended) { invalid(i, 'event after the run ended'); break; }
      if (i === 0 && code !== 'G') { invalid(i, 'the log does not start at Start'); break; }
      if (i === 1 && code !== 'T') { invalid(i, 'no first target'); break; }
      if (expectT && code !== 'T') { invalid(i, 'no new target after a hit'); break; }
      if (expectEnd && code !== 'E') { invalid(i, 'the run went on after a miss'); break; }

      if (code === 'G') {
        if (i !== 0) { invalid(i, 'a second Start'); break; }
        if (!trackOk(i, e[2])) break;
        trackW = e[2];
        pend = t + FIRST_LAUNCH_MS;

      } else if (code === 'T') {
        var tk = e[2], tyc = e[3], tyw = e[4];
        if (!isInt(tk) || !isNum(tyc) || !isNum(tyw)) { invalid(i, 'malformed target'); break; }
        if (i === 1) {
          if (tk !== 1 || Math.abs(tyc - YC_START) > EPS_YC) { invalid(i, 'the first target is fixed at ' + YC_START); break; }
        } else {
          if (!expectT || tk !== hits + 1) { invalid(i, 'target ' + tk + ' made out of turn'); break; }
          if (tyc < YC_MIN - EPS_YC || tyc > YC_MIN + YC_SPAN + EPS_YC) { invalid(i, 'target centre ' + tyc + ' out of range'); break; }
          if (Math.abs(tyc - yc) < YC_STEP - EPS_YC) { invalid(i, 'target within ' + YC_STEP + ' of the last'); break; }
          draws.push(drawU(tyc, yc));
        }
        var wExp = width(tk - 1, trackW, comp);
        if (Math.abs(tyw - wExp) > EPS_YW + 1e-6 * wExp) {
          // The only way a real client could get another width is the other mode's
          // curve (the trainer pins its mode at Start, so not any more). Stop, not reject.
          if (Math.abs(tyw - width(tk - 1, trackW, !comp)) <= EPS_YW + 1e-6 * wExp) { stop(i, 'target width from the other mode'); break; }
          invalid(i, 'target width ' + tyw + ', rules say ' + wExp.toFixed(4)); break;
        }
        k = tk; yc = tyc; yw = wExp; expectT = false;

      } else if (code === 'L') {
        if (e[2] !== k || k !== hits + 1) { invalid(i, 'launch for the wrong target'); break; }
        if (inFlight) { invalid(i, 'launch with a bar already in flight'); break; }
        if (paused) { invalid(i, 'launch while paused'); break; }
        if (pend === null) { invalid(i, 'launch with no timer running'); break; }
        if (t < pend - timerBad) { invalid(i, 'launch ' + (pend - t) + ' ms early'); break; }
        if (t < pend - timerEarly) { stop(i, 'launch ' + (pend - t) + ' ms early'); break; }
        late.push(t - pend);
        pend = null; inFlight = true; launchT = t; pausedFlight = 0;

      } else if (code === 'H') {
        var hk = e[2], wx = e[3], tr = e[4], hit = e[5], lf = e[6];
        if (e.length !== 7 || !isInt(hk) || !isNum(wx) || !isNum(tr) || (hit !== 0 && hit !== 1) || !isNum(lf)) { invalid(i, 'malformed press'); break; }
        if (!inFlight || paused) { invalid(i, 'press judged with no bar in flight'); break; }
        if (hk !== k) { invalid(i, 'press for the wrong target'); break; }
        var sp = speed(k - 1, comp);
        if (tr < TRAVEL_MIN_MS) { invalid(i, 'negative flight'); break; }
        var wall = t - launchT - pausedFlight;
        var over = tr - wall;
        if (over > travelBad) { invalid(i, 'bar flew ' + Math.round(tr) + ' ms in ' + wall + ' ms'); break; }
        // Re-judge from the logged state.
        var yx = PAD + trackW * yc - yw / 2;
        var margin = Math.min((yx + yw + TOL) - wx, (wx + BAR_W) - (yx - TOL));
        if (hit === 1 && margin < -EPS_PX) { invalid(i, 'logged a hit, the bar was ' + (-margin).toFixed(2) + ' px outside'); break; }
        if (hit === 0 && margin > EPS_PX) { invalid(i, 'logged a miss, the bar was ' + margin.toFixed(2) + ' px inside'); break; }
        inFlight = false;
        if (hit === 0) { expectEnd = true; continue; }
        // A hit: counted only if the bar's state adds up.
        if (Math.abs(wx - (PAD + sp * tr / 1000)) > X_EPS) { stop(i, 'bar position does not match its flight'); break; }
        if (over > travelSlack) { stop(i, 'bar ahead of the clock by ' + Math.round(over) + ' ms'); break; }
        hits++;
        if (trackW < SMALL_TRACK_W) smallHits++;
        if (wall >= FLIGHT_MIN_WALL_MS) ratios.push(tr / wall);
        // Where the press really fell: the bar's x on the last frame plus the time
        // since that frame, against the centre of the hit window, in ms.
        var lfc = lf < 0 ? 0 : (lf > LF_CAP_MS ? LF_CAP_MS : lf);
        acc.push((wx - (yx + yw / 2 - BAR_W / 2)) / sp * 1000 + lfc);
        hitTimes.push(t);
        pend = t + NEXT_LAUNCH_MS;
        expectT = true;

      } else if (code === 'E') {
        var why = e[2];
        if (why === 'miss') {
          if (!expectEnd) { invalid(i, 'a miss end with no missed press'); break; }
        } else if (why === 'slow') {
          if (!inFlight || paused) { invalid(i, 'bar left the track with none in flight'); break; }
          if (!isNum(e[3]) || e[3] <= PAD + trackW - EPS_PX) { invalid(i, 'bar ended inside the track'); break; }
        } else if (why !== 'reset') { invalid(i, 'unknown end ' + why); break; }
        ended = true; inFlight = false; expectEnd = false;

      } else if (code === 'P') {
        if (paused) { invalid(i, 'paused twice'); break; }
        paused = true; pauses++; pauseAt = t;
        pend = null;                              // the trainer cancels its launch timer

      } else if (code === 'U') {
        if (!paused) { invalid(i, 'resumed while not paused'); break; }
        paused = false;
        if (inFlight) pausedFlight += t - pauseAt;
        else pend = t + RESUME_LAUNCH_MS;

      } else if (code === 'Z') {
        if (!trackOk(i, e[2])) break;
        trackW = e[2];

      } else { invalid(i, 'unknown event'); break; }
    }

    r.score = bad ? 0 : hits;
    r.stat('hits', hits);
    r.stat('trackW', trackW);
    r.stat('pauses', pauses);
    if (late.length) r.stat('launchLateMedianMs', S.median(late));
    if (acc.length) {
      r.stat('pressMeanMs', S.mean(acc));
      r.stat('pressSdMs', S.sd(acc));
      r.stat('pressMadMs', S.mad(acc));
    }
    if (bad) return r;

    // ── is this a person ──────────────────────────────────────────────────────
    var why2;
    if (smallHits >= SMALL_TRACK_HITS) r.review(smallHits + ' points on a track under ' + SMALL_TRACK_W + ' px');
    if (ratios.length) {
      var ratioMed = S.median(ratios);
      r.stat('flightRatioMedian', ratioMed);
      if (!coarse && ratios.length >= FLIGHT_MIN_N && ratioMed < FLIGHT_MIN_RATIO)
        r.review('bar in slow motion (median ' + ratioMed.toFixed(2) + ' of real time over ' + ratios.length + ' flights)');
    }
    if ((why2 = Q.tooAccurate(acc, ACC_MIN_N, ACC_MAX_SD_MS, ' ms'))) r.review(why2);
    var iv = S.diffs(hitTimes);
    if (iv.length >= 2) r.stat('intervalSdMs', S.sd(iv));
    if ((why2 = Q.tooSteady(iv, STEADY_MIN_N, STEADY_MAX_SD_MS))) r.review(why2);
    if (draws.length >= DRAW_MIN_N) {
      var ks = S.ksUniform(draws);
      r.stat('drawsP', ks.p);
      if ((why2 = Q.tooLucky(ks.p, DRAW_ALPHA, draws.length + ' targets'))) r.review(why2);
    }
    return r;
  }

  Q.register('dodge', {
    PAD: PAD, BAR_W: BAR_W, TOL: TOL, TRACK_H: TRACK_H,
    YC_START: YC_START, YC_MIN: YC_MIN, YC_SPAN: YC_SPAN, YC_STEP: YC_STEP,
    FIRST_LAUNCH_MS: FIRST_LAUNCH_MS, NEXT_LAUNCH_MS: NEXT_LAUNCH_MS,
    RESUME_LAUNCH_MS: RESUME_LAUNCH_MS, RESET_MS: RESET_MS, DT_CAP: DT_CAP,
    MAX_TRACK_W: MAX_TRACK_W, MIN_TRACK_W: MIN_TRACK_W, SUBMIT_MAX_MS: SUBMIT_MAX_MS,
    speed: speed, width: width, nextCenter: nextCenter, drawU: drawU,
    check: check,
  });
})(typeof globalThis !== 'undefined' ? globalThis.QteRules : this.QteRules);

// ==== qte-rules part: dagger ====
// ── dagger ─────
// Dagger trainer ('dagger', 'dagger-comp'; js/qte.js "DAGGER QTE TRAINER").
// A round shows n rings that spin at fixed speeds, each with a gap. They are
// cleared outermost first: Space / tap while the active ring's gap is under
// the arrow at 12 o'clock. A counter-clockwise ring passes on any press. After
// each cleared ring the next one zooms in for 220 ms and presses are ignored.
// Clearing every ring of a round is one point. A press outside the gap on a
// clockwise ring, or the round's 8 s running out, ends the run.
//
// The log (t = ms since the run's Start):
//   ['R', t, s, g0 .. g(n-1)]   a round starts: streak s (rounds cleared so
//                               far) and one start angle per ring (rad, 4 dp),
//                               signed by the ring's direction (+ clockwise,
//                               - counter-clockwise). n = ringCount(s).
//   ['K', t, i, G, hit, src]    a press, as judged: active ring i, the round's
//                               game time G in ms (sum of the clamped frame
//                               dts since the round started, 2 dp) that the
//                               judged angle comes from, 1 = passed / 0 = miss,
//                               src 'k' key, 'r' key repeat, 't' touch, 'c' click,
//                               'p' / 'q' a key / repeat delivered late by the
//                               ping simulator (core.js)
//   ['E', t, 'miss']            right after a K with hit 0
//   ['E', t, 'time']            the round's 8 s ran out (checked on a frame)
//   ['P', t] / ['U', t]         panel hidden (paused) / Resume clicked
//
// A ring's angle is start + vel*G/1000, where |vel| comes from the streak and
// the ring's index. The trainer judges with exactly that expression (judge()
// below), so check() re-judges every press bit for bit and holds G to the
// clock: G can lag the clock (frames over 50 ms are clamped, the judged angle
// is the last frame's, pauses stop it) but never run ahead of it.
(function (Q) {
  'use strict';
  var S = Q.stats;
  var TAU = Math.PI * 2;

  // ── constants the trainer reads (js/qte.js) ─────────────────────────────────
  var C = {
    EXPAND_MS: 220,       // zoom-in of the next ring; presses ignored meanwhile
    ROUND_GAP_MS: 800,    // last ring of a round -> next round
    RESUME_GAP_MS: 400,   // the same gap, rescheduled on Resume
    ROUND_MS: 8000,       // a round's deadline, wall clock (runs on while paused)
    DT_MAX_MS: 50,        // frame dt clamp
    FAIL_RESET_MS: 900,   // fail -> Start button back
    HIT_EXTRA_DEG: 7,     // added to half the gap
    START_LO: 0.6,        // start angle = PI*(START_LO + rand*START_SPAN)
    START_SPAN: 0.8,
    RING_STEP_SPEED: 0.5, // rad/s added per ring index below the last
  };

  // Tables by streak s (rounds cleared) and mode. The expressions are the
  // original ones, operation for operation, so both sides get the same doubles.
  function ringCount(s, comp) { return comp ? Math.min(3 + s, 9) : Math.min(2 + s, 8); }
  function gapSize(s, comp) {
    return comp
      ? Math.max((40 - s * 1.8) * Math.PI / 180, 16 * Math.PI / 180)
      : Math.max((52 - s * 1.8) * Math.PI / 180, 22 * Math.PI / 180);
  }
  function hitExtra() { return C.HIT_EXTRA_DEG * Math.PI / 180; }
  // |vel| of ring i of a round of `total` rings, rad/s.
  function ringSpeed(s, i, total, comp) {
    var base = comp ? Math.min(4.2 + s * 0.32, 9.0) : Math.min(3.2 + s * 0.25, 7.0);
    return base + (total - 1 - i) * C.RING_STEP_SPEED;
  }
  // Same rounding as Run.ev, so a logged number is the number that was used.
  function round4(x) { return Math.round(x * 10000) / 10000; }
  function roundG(x) { return Math.round(x * 100) / 100; }
  function startGap(u) { return round4(Math.PI * (C.START_LO + u * C.START_SPAN)); }
  var START_MIN = startGap(0), START_MAX = startGap(1);
  function angle(start, vel, gMs) { return start + vel * gMs / 1000; }
  // The hit test. vel < 0: always a pass. Otherwise the gap's centre has to be
  // within gap/2 + 7 deg of 12 o'clock. off: ms of game time from the centre
  // (negative = early); edge: how far inside (+) / outside (-) the window, rad.
  function judge(start, vel, gMs, s, comp) {
    if (vel < 0) return { hit: true, off: 0, edge: 1 };
    var a = angle(start, vel, gMs);
    var norm = ((a % TAU) + TAU) % TAU;
    var dist = Math.min(norm, TAU - norm);
    var lim = gapSize(s, comp) / 2 + hitExtra();
    var signed = norm > Math.PI ? norm - TAU : norm;
    return { hit: dist < lim, off: signed / vel * 1000, edge: lim - dist };
  }

  // ── check tolerances ─────────────────────────────────────────────────────────
  // Clocks: performance.now() is coarsened by some browsers (Firefox with
  // resistFingerprinting / LibreWolf / Tor: up to 100 ms, rounded to a
  // multiple of it at a jittered midpoint, so a reading can be up to 100 ms
  // off either way), and the rAF timestamp may be exact, coarse, or up to a
  // vsync ahead. The tolerances below hold under all of these; none of the
  // timing rules protects a score (the game time G is the player's to lag),
  // so they are generous. See dagger.notes.md.
  var T = {
    // The zoom-in ends on a frame whose rAF timestamp is >= its start + 220.
    // A stamp up to a vsync ahead: >= 170. A 100 ms-coarse performance.now()
    // with exact rAF stamps: > 120. Under 100 no client can produce it.
    LOCKOUT_MIN: 170,      // ms between two passed presses of a round; less: stop counting
    LOCKOUT_BAD: 100,      // ... less than this: impossible
    GAP_MIN: 550,          // ms from a round's last press to the next R (800 timer; two readings 100 ms off, a timer 1 ms early)
    RESUME_GAP_MIN: 150,   // ms from the last U to the next R (400 timer, the same)
    G_AHEAD_STOP: 300,     // G ahead of the clock by more: stop counting (first dt <= 50, a stamp a frame ahead, two readings 100 ms off)
    G_AHEAD_BAD: 1000,     // ... by more than this: impossible
    G_BACK_STOP: 150,      // G running backwards with no Start/Resume since the last pass: stop counting
    G_BACK_RESUME: 1000,   // ... after Start or a Resume (negative first dt: a frame that began before the click)
    MIN_PAUSE: 150,        // ms; a shorter pause (three clicks apart) does not excuse a fast first press
    EDGE_EPS: 1e-9,        // rad; a re-judge this close to the window edge accepts either outcome
  };
  var SRCS = { k: 1, r: 1, t: 1, c: 1, p: 1, q: 1 };
  // Person checks. All far outside what hands do; see dagger.notes.md.
  var P = {
    // CW hit offsets, ms of game time. Two tiers: a sample SD over only 20
    // hits scatters (a player with a true 8 ms spread shows < 5 ms about 1%
    // of the time), so 20 hits must be under 4 ms, 40 hits under 5 ms. A
    // naive bot: 1.9 ms at 144 Hz, 4.9 ms at 60 Hz (the frame steps).
    ACC_MIN_N: 20, ACC_MAX_SD: 4,
    ACC_MIN_N2: 40, ACC_MAX_SD2: 5,
    STEADY_MIN_N: 20, STEADY_MAX_SD: 3,    // intervals between presses of a round, ms
    REACT_MIN_N: 6, REACT_FLOOR: 120, REACT_SHARE: 0.5, // first ring CCW: R -> press
    DRAW_MIN_N: 20, DRAW_ALPHA: 1e-6,      // ring directions / start angles
  };

  // The grid (ms) the log's times sit on when the browser coarsens its clock,
  // or 0. 20+ events, 90% of them on a 10 ms or a 16.67 ms grid; a precise
  // clock lands there 10% / 6% of the time per event.
  function coarseGrid(ev) {
    if (ev.length < 20) return 0;
    var grids = [10, 50 / 3];
    for (var k = 0; k < grids.length; k++) {
      var g = grids[k], on = 0;
      for (var i = 0; i < ev.length; i++) {
        var t = ev[i][1];
        if (Math.abs(t - g * Math.round(t / g)) <= 0.51) on++;
      }
      if (on >= 0.9 * ev.length) return Math.round(g * 100) / 100;
    }
    return 0;
  }

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isInt(x) { return isNum(x) && Math.floor(x) === x; }

  function check(log, env) {
    var r = Q.result();
    var comp = !!env.comp;
    var ev = log.ev;
    var cleared = 0;             // rounds cleared = points proven
    var phase = 'start';         // start | round | gap | missed | ended
    var paused = false, pAt = -1;
    var pausedTotal = 0;         // ms paused so far, over finished pauses (one pass: no O(n^2) rescans)
    var lastU = -1, lastClear = -1, resumedInGap = false;
    var rd = null;               // the round in play
    var stopped = null;
    var offsets = [], intervals = [], reacts = [], lags = [], us = [];
    var rings = 0, ccw = 0, cwHits = 0, presses = 0, pauses = 0, late = 0, earlyTime = 0;
    var srcs = { k: 0, r: 0, t: 0, c: 0, p: 0, q: 0 };

    function bad(why, i) { r.invalid(why + ' (event ' + i + ')'); }
    function stop(why, i, t) { stopped = why; r.stat('stopReason', why); r.stat('stopAt', t); r.stat('stopEvent', i); }
    // ms of this round's pauses that fall inside [a, b]
    function pausedIn(a, b) {
      var s = 0;
      for (var k = 0; k < rd.pauses.length; k++) {
        var p = rd.pauses[k], u = p[1] < 0 ? b : p[1];
        s += Math.max(0, Math.min(u, b) - Math.max(p[0], a));
      }
      return s;
    }

    for (var i = 0; i < ev.length && !stopped && r.verdict !== 'invalid'; i++) {
      var e = ev[i], code = e[0], t = e[1];
      if (phase === 'ended') { bad('event after the run ended', i); break; }
      if (phase === 'start' && code !== 'R') { bad('the run does not start with a round', i); break; }

      if (code === 'R') {
        if (phase !== 'start' && phase !== 'gap') { bad('a round started while one was in play', i); break; }
        if (paused) { bad('a round started while paused', i); break; }
        var s = e[2];
        if (!isInt(s) || s !== cleared) { bad('round streak ' + s + ' but ' + cleared + ' cleared', i); break; }
        var n = ringCount(s, comp);
        if (e.length !== 3 + n) { bad('round ' + s + ' has ' + (e.length - 3) + ' rings, not ' + n, i); break; }
        if (phase === 'gap') {
          if (resumedInGap) { if (t - lastU < T.RESUME_GAP_MIN) { bad('round started ' + (t - lastU) + ' ms after Resume', i); break; } }
          else if (t - lastClear < T.GAP_MIN) { bad('round started ' + (t - lastClear) + ' ms after the last one', i); break; }
        }
        var gs = [];
        for (var j = 0; j < n; j++) {
          var g = e[3 + j];
          if (!isNum(g) || g === 0) { bad('ring ' + j + ' has no start angle', i); break; }
          var ag = Math.abs(g);
          if (ag < START_MIN || ag > START_MAX || round4(ag) !== ag) { bad('ring ' + j + ' starts at ' + ag + ' rad, outside the draw', i); break; }
          gs.push(g);
          rings++; if (g < 0) ccw++;
          us.push((ag / Math.PI - C.START_LO) / C.START_SPAN);
        }
        if (r.verdict === 'invalid') break;
        rd = { tR: t, s: s, n: n, gs: gs, cur: n - 1, lastK: -1, lastG: 0, p0: pausedTotal, pauses: [],
          pausedBeforeFirst: false, lastLate: false, pausedSinceK: false,
          // Start: the first frame's dt can be negative (a frame that began before the click)
          resumedSinceK: s === 0 && phase === 'start' };
        resumedInGap = false;
        phase = 'round';
        continue;
      }

      if (code === 'K') {
        if (phase !== 'round') { bad('a press with no ring in play', i); break; }
        if (paused) { bad('a press while paused', i); break; }
        var ri = e[2], G = e[3], hit = e[4], src = e[5];
        if (e.length !== 6) { bad('malformed press', i); break; }
        if (ri !== rd.cur) { bad('press on ring ' + ri + ', ring ' + rd.cur + ' is active', i); break; }
        if (!isNum(G) || roundG(G) !== G) { bad('press has a bad game time', i); break; }
        if (hit !== 0 && hit !== 1) { bad('press has a bad outcome', i); break; }
        if (typeof src !== 'string' || !Object.prototype.hasOwnProperty.call(SRCS, src)) { bad('press has a bad source', i); break; }
        if (rd.lastK >= 0 && t - rd.lastK < T.LOCKOUT_BAD) { bad('press ' + (t - rd.lastK) + ' ms after the last, inside the 220 ms zoom-in', i); break; }
        if (rd.lastK >= 0 && t - rd.lastK < T.LOCKOUT_MIN) { stop('press ' + (t - rd.lastK) + ' ms after the last', i, t); break; }
        var W = t - rd.tR - (pausedTotal - rd.p0);
        if (G > W + T.G_AHEAD_BAD) { bad('game time ' + G + ' ms ahead of the clock ' + W, i); break; }
        if (G > W + T.G_AHEAD_STOP) { stop('game time ahead of the clock', i, t); break; }
        if (G < rd.lastG - (rd.resumedSinceK ? T.G_BACK_RESUME : T.G_BACK_STOP)) { stop('game time ran backwards', i, t); break; }
        // Past the deadline the first frame ends the round, so a press judged
        // after it (a stalled frame, Resume then a key before the first frame)
        // must still carry a game time from a frame before the deadline.
        // Two passed presses in a row past it are impossible: the second needs
        // a frame to end the zoom-in, and that frame ends the round (only the
        // paused panel's redraw on show ends a zoom-in without a deadline check).
        var isLate = t > rd.tR + C.ROUND_MS;
        if (isLate) {
          late++;
          if (rd.lastLate && !rd.pausedSinceK) { stop('two presses past the round deadline', i, t); break; }
          var Wd = C.ROUND_MS - pausedIn(rd.tR, rd.tR + C.ROUND_MS);
          if (G > Wd + T.G_AHEAD_BAD) { bad('press after the deadline with game time ' + G, i); break; }
          if (G > Wd + T.G_AHEAD_STOP) { stop('press after the round deadline', i, t); break; }
        }
        var vel = ringSpeed(rd.s, ri, rd.n, comp) * (rd.gs[ri] > 0 ? 1 : -1);
        var jd = judge(Math.abs(rd.gs[ri]), vel, G, rd.s, comp);
        var amb = Math.abs(jd.edge) < T.EDGE_EPS;
        if (!amb && (jd.hit ? 1 : 0) !== hit) {
          bad('ring ' + ri + ' logged ' + (hit ? 'hit' : 'miss') + ' but was ' + (jd.hit ? 'in' : 'out of') + ' the gap', i); break;
        }
        presses++;
        srcs[src]++;
        lags.push(W - G);
        if (rd.lastK >= 0) intervals.push(t - rd.lastK);
        if (!hit) { phase = 'missed'; continue; }
        if (vel > 0) { cwHits++; offsets.push(jd.off); }
        else if (rd.lastK < 0 && !rd.pausedBeforeFirst) reacts.push(t - rd.tR);
        rd.lastK = t; rd.lastG = G; rd.cur--;
        rd.lastLate = isLate; rd.pausedSinceK = false; rd.resumedSinceK = false;
        if (rd.cur < 0) { cleared++; lastClear = t; phase = 'gap'; }
        continue;
      }

      if (code === 'P') {
        if (e.length !== 2) { bad('malformed pause', i); break; }
        if (paused || (phase !== 'round' && phase !== 'gap')) { bad('pause out of place', i); break; }
        paused = true; pAt = t; pauses++;
        if (phase === 'round') { rd.pauses.push([t, -1]); rd.pausedSinceK = true; }
        continue;
      }
      if (code === 'U') {
        if (e.length !== 2) { bad('malformed resume', i); break; }
        if (!paused) { bad('resume without a pause', i); break; }
        paused = false; lastU = t; pausedTotal += t - pAt;
        if (phase === 'gap') resumedInGap = true;
        if (phase === 'round') {
          rd.pauses[rd.pauses.length - 1][1] = t;
          rd.resumedSinceK = true;
          // a real pause (switch tab, switch back, click Resume) takes time;
          // only one of those excuses the round's first press from the reaction check
          if (rd.lastK < 0 && t - pAt >= T.MIN_PAUSE) rd.pausedBeforeFirst = true;
        }
        continue;
      }
      if (code === 'E') {
        if (e.length !== 3) { bad('malformed end', i); break; }
        var why = e[2];
        if (why === 'miss') { if (phase !== 'missed') { bad('miss end without a missed press', i); break; } }
        else if (why === 'time') {
          if (phase !== 'round' || paused) { bad('time-up end out of place', i); break; }
          if (t < rd.tR + C.ROUND_MS - 50) earlyTime++;
        } else { bad('unknown end reason', i); break; }
        phase = 'ended';
        continue;
      }
      bad('unknown event ' + code, i); break;
    }
    if (r.verdict === 'invalid') return r;

    r.score = cleared;
    var claimed = env.claimed | 0;
    // A log at the event cap stopped growing while the trainer went on counting.
    var full = ev.length >= Q.LIMITS.MAX_EVENTS;
    if (full) r.stat('logFull', true);
    if (claimed > cleared && !stopped && !full) return r.invalid('claims ' + claimed + ' but the log clears ' + cleared + ' rounds');

    // ── stats ────────────────────────────────────────────────────────────────
    r.stat('rounds', cleared);
    r.stat('rings', rings);
    r.stat('ccw', ccw);
    r.stat('presses', presses);
    r.stat('cwHits', cwHits);
    r.stat('pauses', pauses);
    if (offsets.length) { r.stat('offMean', S.mean(offsets)); r.stat('offSd', S.sd(offsets)); }
    if (intervals.length > 1) r.stat('intSd', S.sd(intervals));
    if (reacts.length) { r.stat('reactN', reacts.length); r.stat('reactMed', S.median(reacts)); }
    if (lags.length) { r.stat('lagMed', S.median(lags)); r.stat('lagMax', S.quantile(lags, 1)); }
    if (late) r.stat('latePresses', late);
    if (earlyTime) r.stat('earlyTimeUp', earlyTime);
    r.stat('src', 'k' + srcs.k + ' r' + srcs.r + ' t' + srcs.t + ' c' + srcs.c + ' p' + srcs.p + ' q' + srcs.q);

    // ── person checks ────────────────────────────────────────────────────────
    var why2;
    if ((why2 = Q.tooAccurate(offsets, P.ACC_MIN_N, P.ACC_MAX_SD, ' ms') ||
                Q.tooAccurate(offsets, P.ACC_MIN_N2, P.ACC_MAX_SD2, ' ms'))) r.review(why2);
    if ((why2 = Q.tooSteady(intervals, P.STEADY_MIN_N, P.STEADY_MAX_SD))) r.review(why2);
    // A coarsened clock (privacy browsers: every time on a 10 / 16.67 / 100 ms
    // grid) can read a 200 ms reaction as 100; the reaction check is skipped.
    var grid = coarseGrid(ev);
    if (grid) r.stat('coarseClock', grid);
    else if ((why2 = Q.tooFast(reacts, P.REACT_MIN_N, P.REACT_FLOOR, P.REACT_SHARE))) r.review(why2);
    if (rings >= P.DRAW_MIN_N) {
      var pDir = S.binomUpper(rings, ccw, 0.5);
      r.stat('ccwP', pDir.toExponential(2));
      if ((why2 = Q.tooLucky(pDir, P.DRAW_ALPHA, ccw + ' of ' + rings + ' rings counter-clockwise'))) r.review(why2);
      var ks = S.ksUniform(us);
      r.stat('startKsP', ks.p.toExponential(2));
      if ((why2 = Q.tooLucky(ks.p, P.DRAW_ALPHA, 'start angles not uniform'))) r.review(why2);
    }
    return r;
  }

  Q.register('dagger', {
    C: C, T: T, P: P,
    ringCount: ringCount, gapSize: gapSize, hitExtra: hitExtra, ringSpeed: ringSpeed,
    round4: round4, roundG: roundG, startGap: startGap, angle: angle, judge: judge,
    check: check,
  });
})(typeof globalThis !== 'undefined' ? globalThis.QteRules : this.QteRules);

// ==== qte-rules part: hammer ====
// ── hammer ─────────────────────────────────────────────────────────────────
// Hold-and-release charge bar (js/qte.js HAMMER QTE TRAINER). Types 'hammer'
// and 'hammer-comp'. The trainer reads its curves from here (speed, size,
// C_MIN/C_SPAN, GAP_MS), so the check and the game cannot drift.
//
// Log events (t = ms since the run's Start, numbers rounded to 4 dp by run.ev):
//   ['R', t, k, zoneMin, zoneMax, why]  a round starts; k = streak before it;
//        why: 's' Start, 'n' the 700 ms timer after a hit, 'u' Resume
//   ['D', t, src]                        hold starts (src 'k' Space, 't' canvas
//        touch, 'b' HOLD button); logged only when holding goes false -> true
//   ['X', t, fill, frames, cause, hit]   a release as judged: the fillPct the
//        trainer compared, the frames (dt > 0) that built it, cause 'k'|'t'|'b'|'o'
//        (overfill auto-release), hit 1/0
//   ['E', t, 'early'|'late']             the attempt ended on that miss
//   ['P', t] / ['U', t]                  panel hidden (paused) / Resume
(function (Q) {
  'use strict';

  var GAP_MS = 700;        // success -> next round (setTimeout, never early)
  var C_MIN = 0.45;        // zone centre = C_MIN + Math.random() * C_SPAN
  var C_SPAN = 0.35;
  var DT_MAX = 0.05;       // per-frame dt clamp, seconds

  function speed(k, comp) { return comp ? Math.min(0.42 + k * 0.030, 0.85) : Math.min(0.30 + k * 0.025, 0.70); }
  function size(k, comp)  { return comp ? Math.max(0.07 - k * 0.005, 0.025) : Math.max(0.10 - k * 0.006, 0.04); }

  // ── tolerances (all in the honest player's favour) ──
  // Privacy settings (Firefox resistFingerprinting, Tor) clamp performance.now()
  // and rAF stamps to 16.67 or 100 ms, with a jittered rounding point, so any
  // interval in the log can read up to two clamp steps short. The tolerances
  // below cover a 100 ms clock where it matters; none of them lets a log claim
  // a point the rules would not give.
  var T = {
    // How far the bar may lead the press->release time. The first frame after
    // a press adds its whole dt (<= 50 ms clamp) from before the press; when
    // the press is handled during a long task, that frame carries a stale
    // vsync stamp and the next frame's jump is clamped to 50 ms, most of it
    // before the press too: up to ~100 ms. Plus two clamp steps of a 16.67 ms
    // clock (a 100 ms clock halves the bar's speed, so it never leads).
    // Frame drops only make the bar lag.
    FILL_SLACK_MS: 200,
    EPS: 0.0002,           // two 4-dp roundings
    SIZE_EPS: 0.00015,     // zoneMax - zoneMin vs size(k): two roundings + float
    GAP_EARLY_MS: 250,     // a 700 ms timer is never early; two steps of a 100 ms clock + ms rounding
    START_MS: 1000,        // Start -> first round (synchronous in startGame)
    RESUME_MS: 250,        // Resume -> its round (same handler; a clamp step may fall between)
    STRAY_MS: 2000,        // a previous run's pending 700 ms timer may fire into a new run
    STRAY_MAX: 3,          //   (re-click the Hammer tab mid-run, which shows Start, and Start again within the gap)
    // No lower bound on fill: the first frame after Start/Resume has dt =
    // stamp - lastTime, negative by as long as the click's task held the
    // frame, unclamped. A negative fill is always an early miss.
  };

  // ── person checks (review only; far outside real play, see hammer.notes.md) ──
  var P = {
    ACC_MIN_N: 15,  ACC_MAX_SD_MS: 3,           // release error spread (ms of fill) over hits
    // Press latency after the round starts. When to press does not depend on
    // the zone, so pressing on the 700 ms rhythm is fair play; a press in the
    // gap is ignored, so a rhythm player aims just after it. 90 % under 35 ms
    // needs a self-timed 0.7 s interval with an SD under ~11 ms - no person.
    LAT_MIN_N: 30,  LAT_FLOOR_MS: 35, LAT_SHARE: 0.9,
    STEADY_MIN_N: 20, STEADY_MAX_SD_MS: 4,      // press latency metronome
    LATTICE_MIN_N: 50, LATTICE_MIN_FRAMES: 3, LATTICE_MAX: 0.33, // frame-exact bot: spread within one frame
    KS_MIN_N: 20,   KS_ALPHA: 1e-5,             // hit zone centres uniform in [0.45, 0.80)
    // Zones given up by leaving the panel (P during a round) and re-rolled by
    // Resume. A player who leaves whenever the zone is far gives up only far
    // zones. An honest pause lands on a round with a chance that grows with the
    // round's length (far zones take longer to charge, at most ~1.7x), which
    // needs well over 1000 pauses to reach this alpha.
    REROLL_MIN_N: 10, REROLL_ALPHA: 1e-5,
  };

  function num(x) { return typeof x === 'number' && isFinite(x); }
  function isInt(x) { return num(x) && Math.floor(x) === x; }

  function check(log, env) {
    var r = Q.result();
    var comp = !!env.comp;
    var ev = log.ev;
    var ping = (log.env && num(log.env.ping)) ? log.env.ping : 0;

    var phase = 'none';        // none | round | hold | gap | missed | ended | paused | resuming
    var streak = 0;
    var tokens = [];           // fire times of the 700 ms timers of hits, unconsumed
    var zMin = 0, zMax = 0, zC = 0, zK = 0, rT = 0, dT = 0;
    var strays = 0, rounds = 0, abandoned = 0, pauses = 0;
    var stop = null;           // reason counting stopped (a real client could do it)
    var offsets = [], latencies = [], hitCentres = [], allCentres = [], steps = [], wideOffsets = [], wideSteps = [], holds = [];
    var gaveUp = [];           // zones of rounds a pause abandoned (Resume re-rolls them)
    var early = false;

    function bad(i, why) { r.invalid('event ' + i + ': ' + why); }

    for (var i = 0; i < ev.length && r.verdict !== 'invalid' && !stop; i++) {
      var e = ev[i], c = e[0], t = e[1];
      if (phase === 'ended') { bad(i, 'event after the attempt ended'); break; }
      if (phase === 'missed' && c !== 'E') { bad(i, 'a miss not followed by its end'); break; }
      if (phase === 'resuming' && c !== 'R') { bad(i, 'resume not followed by a round'); break; }

      if (c === 'R') {
        var k = e[2], a = e[3], b = e[4], why = e[5];
        if (!isInt(k) || !num(a) || !num(b) || (why !== 's' && why !== 'n' && why !== 'u')) { bad(i, 'malformed round'); break; }
        if (k !== streak) { bad(i, 'round says streak ' + k + ', log proves ' + streak); break; }
        var sz = size(k, comp);
        if (Math.abs((b - a) - sz) > T.SIZE_EPS) { bad(i, 'zone size ' + (b - a).toFixed(4) + ' is not ' + sz.toFixed(4) + ' for streak ' + k); break; }
        var cen = (a + b) / 2;
        if (cen < C_MIN - T.EPS || cen > C_MIN + C_SPAN + T.EPS) { bad(i, 'zone centre ' + cen.toFixed(4) + ' outside the draw range'); break; }
        if (why === 's') {
          if (i !== 0 || t > T.START_MS) { bad(i, 'a Start round that is not the first event'); break; }
        } else if (why === 'u') {
          if (phase !== 'resuming' || t - ev[i - 1][1] > T.RESUME_MS) { bad(i, 'a resume round without a resume'); break; }
        } else {
          if (phase === 'none' || phase === 'paused' || phase === 'resuming') { bad(i, 'a timer round while not running'); break; }
          var used = -1;
          for (var j = 0; j < tokens.length; j++) if (tokens[j] <= t + T.GAP_EARLY_MS) { used = j; break; }
          if (used >= 0) tokens.splice(used, 1);
          else if (t <= T.STRAY_MS && strays < T.STRAY_MAX) strays++;
          else { stop = 'round ' + rounds + ' restarted with no pending timer'; break; }
        }
        if (phase === 'none' && why !== 's') { bad(i, 'first round is not a Start'); break; }
        if (phase === 'hold' || phase === 'round') abandoned++;
        zMin = a; zMax = b; zC = cen; zK = k; rT = t;
        rounds++; allCentres.push((cen - C_MIN) / C_SPAN);
        phase = 'round';
      } else if (c === 'D') {
        if (e[2] !== 'k' && e[2] !== 't' && e[2] !== 'b') { bad(i, 'malformed press'); break; }
        if (phase !== 'round') { bad(i, 'a press with no round waiting for one'); break; }
        dT = t; latencies.push(t - rT);
        phase = 'hold';
      } else if (c === 'X') {
        var fill = e[2], n = e[3], cause = e[4], hit = e[5];
        if (!num(fill) || !isInt(n) || n < 0 || (hit !== 0 && hit !== 1) ||
            (cause !== 'k' && cause !== 't' && cause !== 'b' && cause !== 'o')) { bad(i, 'malformed release'); break; }
        if (phase !== 'hold') { bad(i, 'a release with no hold'); break; }
        if (fill > 1 + T.EPS) { bad(i, 'fill ' + fill + ' out of range'); break; }
        var sp = speed(zK, comp), h = t - dT;
        if (fill > sp * (h + T.FILL_SLACK_MS) / 1000 + T.EPS) { bad(i, 'bar at ' + fill + ' after a ' + h + ' ms hold (fills at ' + sp + '/s)'); break; }
        if (fill > sp * DT_MAX * n + T.EPS) { bad(i, 'bar at ' + fill + ' after ' + n + ' frames'); break; }
        if (n > h + 60) { bad(i, n + ' frames in a ' + h + ' ms hold'); break; }
        if (cause === 'o' && (fill < 1 - T.EPS || hit !== 0)) { bad(i, 'an overfill that did not overfill'); break; }
        var inZone = fill >= zMin && fill <= zMax;
        if (hit === 1 && !inZone) { bad(i, 'logged a hit at ' + fill + ' outside [' + zMin + ', ' + zMax + ']'); break; }
        if (hit === 0 && inZone && fill !== zMin && fill !== zMax) { bad(i, 'logged a miss at ' + fill + ' inside [' + zMin + ', ' + zMax + ']'); break; }
        holds.push(h);
        if (hit === 1) {
          streak++;
          tokens.push(t + GAP_MS);
          var off = (fill - zC) / sp * 1000;
          offsets.push(off);
          hitCentres.push((zC - C_MIN) / C_SPAN);
          if (n > 0 && fill > 0) {
            var st = fill / sp / n * 1000;             // mean ms per frame this hold
            steps.push(st);
            if (size(zK, comp) / sp * 1000 >= P.LATTICE_MIN_FRAMES * st) { wideOffsets.push(off); wideSteps.push(st); }
          }
          phase = 'gap';
        } else {
          // Rounding is monotone, so a real miss below zoneMin logs fill <= zoneMin
          // and one above zoneMax logs fill >= zoneMax.
          early = fill <= zMin;
          phase = 'missed';
        }
      } else if (c === 'E') {
        if (phase !== 'missed') { bad(i, 'an end with no miss'); break; }
        if (e[2] !== 'early' && e[2] !== 'late') { bad(i, 'malformed end'); break; }
        if ((e[2] === 'early') !== early) { bad(i, 'end reason does not match the release'); break; }
        phase = 'ended';
      } else if (c === 'P') {
        if (phase !== 'round' && phase !== 'hold' && phase !== 'gap') { bad(i, 'a pause while not running'); break; }
        if (phase === 'hold' || phase === 'round') { abandoned++; gaveUp.push((zC - C_MIN) / C_SPAN); }
        pauses++;
        phase = 'paused';
      } else if (c === 'U') {
        if (phase !== 'paused') { bad(i, 'a resume while not paused'); break; }
        phase = 'resuming';
      } else {
        bad(i, 'unknown event ' + c);
        break;
      }
    }

    if (r.verdict === 'invalid') return r;
    r.score = streak;
    var S = Q.stats;
    r.stat('hits', streak).stat('rounds', rounds).stat('abandoned', abandoned).stat('pauses', pauses);
    if (ping) r.stat('ping', ping);
    if (strays) r.stat('strayRounds', strays);
    // A log cut at MAX_EVENTS (run.ev stops writing) proves less than the
    // client counted; that is the log's limit, not a lie.
    if (!stop && ev.length >= Q.LIMITS.MAX_EVENTS) stop = 'log full at ' + ev.length + ' events';
    if (stop) { r.stat('stoppedAt', stop); }
    else if (env.claimed > streak) return r.invalid('claims ' + env.claimed + ' but the log proves ' + streak);

    if (offsets.length) {
      r.stat('offMeanMs', S.mean(offsets)).stat('offSdMs', S.sd(offsets));
      r.stat('holdMedMs', S.median(holds));
    }
    if (latencies.length) {
      var fast = 0;
      for (var q = 0; q < latencies.length; q++) if (latencies[q] < P.LAT_FLOOR_MS) fast++;
      r.stat('pressMedMs', S.median(latencies)).stat('pressSdMs', S.sd(latencies)).stat('pressFastShare', fast / latencies.length);
    }
    var stepMed = steps.length ? S.median(steps) : 0;
    if (stepMed) r.stat('frameMs', stepMed);

    // Too accurate: release error spread over hits (ms of fill time).
    var why = Q.tooAccurate(offsets, P.ACC_MIN_N, P.ACC_MAX_SD_MS, ' ms');
    if (why) r.review(why);
    // A frame-exact bot: on rounds whose zone spans >= 3 frames, a person's
    // releases spread over several frames; a script's stay within one.
    if (wideOffsets.length >= P.LATTICE_MIN_N) {
      var wStep = S.median(wideSteps), ratio = wStep > 0 ? S.sd(wideOffsets) / wStep : 99;
      r.stat('latticeRatio', ratio);
      if (ratio < P.LATTICE_MAX) r.review('releases never spread past one frame (SD ' + ratio.toFixed(2) + ' frames over ' + wideOffsets.length + ')');
    }
    // Press timing (round start -> hold). The ping simulator only adds to it
    // (its copies keep e.repeat, so a Space held through the gap never starts
    // a hold), and a press during the 700 ms gap is ignored, so even a player
    // pressing on the rhythm cannot put nearly all presses in the first 35 ms.
    why = Q.tooFast(latencies, P.LAT_MIN_N, P.LAT_FLOOR_MS, P.LAT_SHARE);
    if (why) r.review(why);
    why = Q.tooSteady(latencies, P.STEADY_MIN_N, P.STEADY_MAX_SD_MS);
    if (why) r.review(why);
    // Played zones must look like uniform draws.
    if (hitCentres.length >= P.KS_MIN_N) {
      var ks = S.ksUniform(hitCentres);
      r.stat('zonesP', ks.p.toExponential(1));   // a string: stat() would round a small p to 0
      why = Q.tooLucky(ks.p, P.KS_ALPHA, 'zone positions of ' + hitCentres.length + ' hits');
      if (why) r.review(why);
    }
    if (allCentres.length >= P.KS_MIN_N) r.stat('allZonesP', S.ksUniform(allCentres).p.toExponential(1));
    // Re-rolling by pausing: the zones given up must look like any other draws.
    if (gaveUp.length >= P.REROLL_MIN_N) {
      var ks2 = S.ksUniform(gaveUp);
      r.stat('gaveUp', gaveUp.length).stat('gaveUpP', ks2.p.toExponential(1));
      why = Q.tooLucky(ks2.p, P.REROLL_ALPHA, 'zones given up by pausing, ' + gaveUp.length + ' rounds');
      if (why) r.review(why);
    }
    return r;
  }

  Q.register('hammer', {
    GAP_MS: GAP_MS, C_MIN: C_MIN, C_SPAN: C_SPAN, DT_MAX: DT_MAX,
    speed: speed, size: size,
    TOL: T, PERSON: P,
    check: check,
  });
})(typeof globalThis !== 'undefined' ? globalThis.QteRules : this.QteRules);

// ==== qte-rules part: axe ====
// ── axe ─────────────────────────────────────────────────────────────────────
// Press-to-fill bar that drains; land in the zone when the round timer ends
// (js/qte.js AXE QTE TRAINER). Types 'axe' and 'axe-comp'. The trainer reads
// its curves from here (timer, size, DRAIN, PRESS, C_MIN/C_SPAN, GAP_MS,
// DT_MAX), so the check and the game cannot drift.
//
// Log events (t = ms since the run's Start, numbers rounded to 4 dp by run.ev):
//   ['R', t, k, zoneMin, zoneMax, why]  a round starts; k = streak before it;
//        why: 's' Start, 'n' the 700 ms timer after a hit (a pause between
//        rounds holds that timer; Resume runs the rest of it)
//   ['K', t, fill, src]   a press in a live round: fillPct AFTER the press;
//        src 'k' Space, 't' canvas touch, 'b' TAP button
//   ['G', t]              a press between rounds (700 ms gap; it changes a fill
//        that the next round resets, so only its time matters)
//   ['J', t, fill, hit]   the round is judged: the fillPct compared, hit 1/0
//   ['E', t, why]         the attempt ended: 'low' / 'high' (the miss just
//        judged) or 'x' (the trainer was reset in the middle of a run)
//   ['P', t] / ['U', t]   panel hidden (paused) / Resume clicked
//
// The fill is integrated per animation frame (drain 0.06/s, dt clamped to
// 50 ms), so it cannot be recomputed exactly from the press times. Instead
// every logged fill is checked against the one before it: between two events
// the bar can lose at most DRAIN x (active time + slack) and can never gain
// (except once, a little, after a round start or a Resume: that first frame's
// dt can be negative); a press adds exactly PRESS, capped at 1. Losing LESS
// than the full drain is legal (frames over 50 ms are clamped; a hidden tab
// runs no frames), so it is only watched in aggregate (drainEff).
//
// Time: the round clock and the 700 ms wait both stop while paused, so each
// is checked as unpaused time, less one coarse-clock allowance. Pauses earn no
// extra allowance: the trainer logs R and U before it reads the clock and P
// after, so a pause can only make the logged time longer than the real one,
// and a pile of zero-length pauses cannot shorten a round (the server's clock
// check is the only thing that makes a forged run take real time).
(function (Q) {
  'use strict';

  var DRAIN   = 0.06;      // fraction lost per second
  var PRESS   = 0.09;      // fraction added per press
  var GAP_MS  = 700;       // hit -> next round (setTimeout, never early)
  var C_MIN   = 0.45;      // zone centre = C_MIN + Math.random() * C_SPAN
  var C_SPAN  = 0.35;
  var DT_MAX  = 0.05;      // per-frame dt clamp, seconds

  // Round length in SECONDS and zone width; k = streak before the round.
  function timer(k, comp) { return comp ? Math.max(5 - k * 0.3, 2.5) : Math.max(6 - k * 0.3, 3); }
  function size(k, comp)  { return comp ? Math.max(0.08 - k * 0.006, 0.02) : Math.max(0.11 - k * 0.007, 0.03); }

  // ── tolerances (all in the honest player's favour) ──
  var T = {
    EPS: 0.0002,           // two 4-dp roundings
    SIZE_EPS: 0.00015,     // zoneMax - zoneMin vs size(k): two roundings + float
    DRAIN_SLACK_MS: 200,   // first frame after an event reaches back <= one clamped dt (50) + rAF stamp before the handler
                           // + ms rounding + coarse clocks (Firefox resistFingerprinting rounds performance.now())
    PAUSE_SLACK_MS: 20,    // per pause inside an interval (a rAF stamp on each side)
    UP_SLACK: 0.02,        // a first frame with dt < 0 (its rAF stamp is older than lastTime - by a frame, or by a
                           // long task under jank; dt < 0 is not clamped) raises the bar: 0.06 x up to 330 ms.
                           // Once per round start / Resume...
    UP_WINDOW_MS: 1000,    // ...to a bar last logged within this long after it: a press handled during a long task can
                           // land before that first frame runs (the old 250 ms window rejected a 300 ms long task)
    // Times below carry a coarse-clock allowance: with privacy.resistFingerprinting
    // (Tor Browser) performance.now() can be floored to 100 ms, so two stamps of
    // one real interval can differ by up to 100 ms less than it.
    GAP_EARLY_MS: 110,     // the 700 ms timer after a hit never fires early
    JUDGE_EARLY_MS: 110,   // judged on a frame stamped >= roundEndTime
    START_MS: 1000,        // Start -> first round (synchronous in startGame)
  };

  // ── person checks (review only; far outside real play, see axe.notes.md) ──
  var P = {
    ACC_MIN_N: 20, ACC_MAX_SD_MS: 12,          // judged fill vs zone centre, in ms of drain, over hits
    STEADY_MIN_N: 30, STEADY_MAX_SD_MS: 2,     // pooled within-round SD of press intervals...
    STEADY_LO_MS: 40, STEADY_HI_MS: 400,       // ...counting intervals in this band only
    // No reaction-time check: nothing in the axe needs a reaction. A round
    // starts a fixed 700 ms after the judgement the player just watched, so a
    // first press right at the start is anticipation, not superhuman, and the
    // first press decides nothing (firstPressMedMs is kept as a stat).
    KS_MIN_N: 20, KS_ALPHA: 1e-5,              // zone centres uniform in [0.45, 0.80)
    DRAIN_MIN_S: 30, DRAIN_MIN_EFF: 0.2,       // the bar must really drain while a person plays...
    DRAIN_MAX_IV_MS: 2500,                     // ...measured over intervals this short only (a tab
                                               // hidden mid-round runs no frames; it is not a pause)
  };

  function num(x) { return typeof x === 'number' && isFinite(x); }
  function isInt(x) { return num(x) && Math.floor(x) === x; }

  function check(log, env) {
    var r = Q.result();
    var comp = !!env.comp;
    var ev = log.ev;

    // none | round | paused | gap | gpaused | missed | ended
    var phase = 'none';
    var streak = 0, rounds = 0, pauses = 0, presses = 0, gapPresses = 0, resets = 0;
    var zMin = 0, zMax = 0, zC = 0, rT = 0, dur = 0, pausedIn = 0, pausesIn = 0, pAt = 0;
    var hitT = 0, gapPausedMs = 0, gapPauses = 0, low = false;
    // the bar: last known value f at fT, pauses since then, allowance to rise
    var f = 0, fT = 0, pausedSinceF = 0, pausesSinceF = 0, upUntil = -1, upLeft = 0;
    var firstDone = false, lastK = -1, roundIv = [];
    var offsets = [], centres = [], latAll = [];
    var ivSS = 0, ivN = 0, ivAll = [];
    var drainObs = 0, drainMaxS = 0;

    function bad(i, why) { r.invalid('event ' + i + ': ' + why); }

    // The range the bar can be in at time t, from the last known value.
    function span(t) {
      var active = Math.max(0, (t - fT) - pausedSinceF);
      var lo = Math.max(0, f - DRAIN * (active + T.DRAIN_SLACK_MS + T.PAUSE_SLACK_MS * pausesSinceF) / 1000);
      var hi = f + (fT <= upUntil ? upLeft : 0);
      return { lo: lo, hi: hi, active: active };
    }
    // The bar was at `before` just ahead of this event: bookkeeping.
    function settle(before, s) {
      if (before > f) upLeft = Math.max(0, upLeft - (before - f));
      if (f > 0.002 && before > 0.002 && s.active <= P.DRAIN_MAX_IV_MS) { drainObs += f - before; drainMaxS += s.active / 1000; }
    }
    function closeRoundIntervals() {
      var a = [];
      for (var j = 0; j < roundIv.length; j++) if (roundIv[j] >= P.STEADY_LO_MS && roundIv[j] <= P.STEADY_HI_MS) a.push(roundIv[j]);
      if (a.length >= 2) {
        var m = Q.stats.mean(a);
        for (var j2 = 0; j2 < a.length; j2++) { ivSS += (a[j2] - m) * (a[j2] - m); ivAll.push(a[j2]); }
        ivN += a.length - 1;
      }
      roundIv = [];
    }

    for (var i = 0; i < ev.length && r.verdict !== 'invalid'; i++) {
      var e = ev[i], c = e[0], t = e[1];
      if (phase === 'ended') { bad(i, 'event after the attempt ended'); break; }
      if (phase === 'missed' && c !== 'E') { bad(i, 'a miss not followed by its end'); break; }

      if (c === 'R') {
        var k = e[2], a = e[3], b = e[4], why = e[5];
        if (e.length !== 6 || !isInt(k) || !num(a) || !num(b) || (why !== 's' && why !== 'n')) { bad(i, 'malformed round'); break; }
        if (k !== streak) { bad(i, 'round says streak ' + k + ', log proves ' + streak); break; }
        var sz = size(k, comp);
        if (Math.abs((b - a) - sz) > T.SIZE_EPS) { bad(i, 'zone width ' + (b - a).toFixed(4) + ' is not ' + sz.toFixed(4) + ' for streak ' + k); break; }
        var cen = (a + b) / 2;
        if (cen < C_MIN - T.EPS || cen > C_MIN + C_SPAN + T.EPS) { bad(i, 'zone centre ' + cen.toFixed(4) + ' outside the draw range'); break; }
        if (why === 's') {
          if (i !== 0 || phase !== 'none' || t > T.START_MS) { bad(i, 'a Start round that is not the first event'); break; }
        } else {
          if (phase !== 'gap') { bad(i, 'a next round with no hit before it'); break; }
          var gapAct = (t - hitT) - gapPausedMs;
          if (gapAct < GAP_MS - T.GAP_EARLY_MS) {
            bad(i, 'next round ' + gapAct + ' ms (unpaused) after the hit (the wait is ' + GAP_MS + ')'); break;
          }
        }
        zMin = a; zMax = b; zC = cen; rT = t; dur = timer(k, comp) * 1000;
        pausedIn = 0; pausesIn = 0;
        f = 0; fT = t; pausedSinceF = 0; pausesSinceF = 0; upUntil = t + T.UP_WINDOW_MS; upLeft = T.UP_SLACK;
        firstDone = false; lastK = -1; roundIv = [];
        rounds++; centres.push((cen - C_MIN) / C_SPAN);
        phase = 'round';
      } else if (c === 'K') {
        var fa = e[2], src = e[3];
        if (e.length !== 4 || !num(fa) || (src !== 'k' && src !== 't' && src !== 'b')) { bad(i, 'malformed press'); break; }
        if (phase !== 'round') { bad(i, 'a press with no live round'); break; }
        if (fa < -T.EPS || fa > 1 + T.EPS) { bad(i, 'fill ' + fa + ' out of range'); break; }
        var s = span(t);
        var lo = Math.min(1, s.lo + PRESS), hi = Math.min(1, s.hi + PRESS);
        if (fa < lo - T.EPS || fa > hi + T.EPS) {
          bad(i, 'fill after a press is ' + fa + ', the bar allows [' + lo.toFixed(4) + ', ' + hi.toFixed(4) + ']'); break;
        }
        if (fa < 1 - T.EPS) settle(fa - PRESS, s);
        f = fa; fT = t; pausedSinceF = 0; pausesSinceF = 0;
        presses++;
        if (!firstDone) { firstDone = true; latAll.push(t - rT - pausedIn); }
        if (lastK >= 0) roundIv.push(t - lastK);
        lastK = t;
      } else if (c === 'G') {
        if (e.length !== 2) { bad(i, 'malformed gap press'); break; }
        if (phase !== 'gap') { bad(i, 'a between-rounds press outside the gap'); break; }
        gapPresses++;
      } else if (c === 'J') {
        var fj = e[2], hit = e[3];
        if (e.length !== 4 || !num(fj) || (hit !== 0 && hit !== 1)) { bad(i, 'malformed judgement'); break; }
        if (phase !== 'round') { bad(i, 'a judgement with no live round'); break; }
        var act = t - rT - pausedIn;
        if (act < dur - T.JUDGE_EARLY_MS) { bad(i, 'judged after ' + act + ' ms (unpaused) of a ' + dur + ' ms round'); break; }
        var sj = span(t);
        if (fj < sj.lo - T.EPS || fj > sj.hi + T.EPS) {
          bad(i, 'judged fill ' + fj + ', the bar allows [' + sj.lo.toFixed(4) + ', ' + sj.hi.toFixed(4) + ']'); break;
        }
        settle(fj, sj);
        var inZone = fj >= zMin && fj <= zMax;
        // Rounding is monotone: a real hit logs zMin <= fill <= zMax; a real
        // miss logs fill <= zMin (low) or fill >= zMax (high).
        if (hit === 1 && !inZone) { bad(i, 'logged a hit at ' + fj + ' outside [' + zMin + ', ' + zMax + ']'); break; }
        if (hit === 0 && inZone && fj !== zMin && fj !== zMax) { bad(i, 'logged a miss at ' + fj + ' inside [' + zMin + ', ' + zMax + ']'); break; }
        closeRoundIntervals();
        if (hit === 1) {
          streak++;
          hitT = t; gapPausedMs = 0; gapPauses = 0;
          offsets.push((fj - zC) / DRAIN * 1000);
          phase = 'gap';
        } else {
          low = fj <= zMin;
          phase = 'missed';
        }
      } else if (c === 'E') {
        var ew = e[2];
        if (e.length !== 3 || (ew !== 'low' && ew !== 'high' && ew !== 'x')) { bad(i, 'malformed end'); break; }
        if (ew === 'x') {
          if (phase === 'none' || phase === 'missed') { bad(i, 'a reset with no run going'); break; }
          resets++;
        } else {
          if (phase !== 'missed') { bad(i, 'an end with no miss'); break; }
          if ((ew === 'low') !== low) { bad(i, 'end reason does not match the judged fill'); break; }
        }
        phase = 'ended';
      } else if (c === 'P') {
        if (e.length !== 2) { bad(i, 'malformed pause'); break; }
        if (phase === 'round') phase = 'paused';
        else if (phase === 'gap') phase = 'gpaused';
        else { bad(i, 'a pause while not running'); break; }
        pAt = t; pauses++;
      } else if (c === 'U') {
        if (e.length !== 2) { bad(i, 'malformed resume'); break; }
        if (phase === 'paused') {
          pausedIn += t - pAt; pausesIn++;
          pausedSinceF += t - pAt; pausesSinceF++;
          upUntil = t + T.UP_WINDOW_MS; upLeft = T.UP_SLACK;
          phase = 'round';
        } else if (phase === 'gpaused') {
          gapPausedMs += t - pAt; gapPauses++;
          phase = 'gap';
        } else { bad(i, 'a resume while not paused'); break; }
      } else {
        bad(i, 'unknown event ' + c);
        break;
      }
    }

    if (r.verdict === 'invalid') return r;
    r.score = streak;
    var S = Q.stats;
    r.stat('hits', streak).stat('rounds', rounds).stat('presses', presses).stat('pauses', pauses);
    if (gapPresses) r.stat('gapPresses', gapPresses);
    if (resets) r.stat('resets', resets);
    if (env.claimed > streak) {
      // run.ev stops logging at MAX_EVENTS; a run that long keeps scoring on
      // screen. Its score is what the log proves, not a rejection.
      if (ev.length >= Q.LIMITS.MAX_EVENTS) r.stat('truncated', 1);
      else return r.invalid('claims ' + env.claimed + ' but the log proves ' + streak);
    }

    if (offsets.length) r.stat('offMeanMs', S.mean(offsets)).stat('offSdMs', S.sd(offsets));
    if (latAll.length) r.stat('firstPressMedMs', S.median(latAll));
    if (ivN) r.stat('pressIvMedMs', S.median(ivAll)).stat('pressIvSdMs', Math.sqrt(ivSS / ivN));
    if (drainMaxS > 0) r.stat('drainEff', drainObs / (DRAIN * drainMaxS)).stat('drainS', drainMaxS);

    // Too accurate: where the judged fill landed against the zone centre, in
    // ms of drain. A person times the start of the last burst by eye; a
    // script lands on the centre give or take a frame.
    var why2 = Q.tooAccurate(offsets, P.ACC_MIN_N, P.ACC_MAX_SD_MS, ' ms');
    if (why2) r.review(why2);
    // A metronome: presses inside a round spaced the same to within ~2 ms.
    if (ivN >= P.STEADY_MIN_N) {
      var ivSd = Math.sqrt(ivSS / ivN);
      if (ivSd < P.STEADY_MAX_SD_MS) r.review('press timing too even (pooled SD ' + ivSd.toFixed(1) + ' ms over ' + ivN + ')');
    }
    // Played zones must look like uniform draws.
    if (centres.length >= P.KS_MIN_N) {
      var ks = S.ksUniform(centres);
      r.stat('zonesP', ks.p);
      why2 = Q.tooLucky(ks.p, P.KS_ALPHA, 'zone positions of ' + centres.length + ' rounds');
      if (why2) r.review(why2);
    }
    // While a person presses keys the page is visible and frames run, so the
    // bar drains at close to full rate; a log where it barely drains was not
    // played in a browser.
    if (drainMaxS >= P.DRAIN_MIN_S && drainObs / (DRAIN * drainMaxS) < P.DRAIN_MIN_EFF) {
      r.review('the bar barely drained (' + (drainObs / (DRAIN * drainMaxS)).toFixed(2) + ' of the rate over ' + drainMaxS.toFixed(0) + ' s)');
    }
    return r;
  }

  Q.register('axe', {
    DRAIN: DRAIN, PRESS: PRESS, GAP_MS: GAP_MS, C_MIN: C_MIN, C_SPAN: C_SPAN, DT_MAX: DT_MAX,
    timer: timer, size: size,
    TOL: T, PERSON: P,
    check: check,
  });
})(typeof globalThis !== 'undefined' ? globalThis.QteRules : this.QteRules);

// ==== qte-rules part: staff ====
// ── staff ─────────────────────────────────────────────────────────────────────
// Rune drag-and-drop (js/qte.js "STAFF QTE"). A round shows `len` target slots
// and a bank holding exactly those runes, shuffled. The player drags each bank
// tile onto an empty slot with the same rune before the round timer runs out.
// One point per round cleared. A timeout resets the streak and the trainer
// starts over by itself: a new attempt of the same run (run.newAttempt()), so
// one log is one attempt and its score is the streak it reached.
//
// The log (t = ms since the run's Start):
//   ['R', t, cause, streak, pattern, bank, leftMs]
//        a round is drawn. cause 0 = Start, or the restart that opens a fresh
//        run after an hour (first event of attempt 0), 1 = after
//        a win, 2 = after a fail (first event of attempts 1, 2 ...), 3 = Resume
//        (runes re-drawn, the time that was left is kept). pattern / bank: one
//        KEYS letter per slot / per bank tile (tile id = index in bank).
//        leftMs: the timer left when the round starts (the full timer unless 3).
//        Logged before the round's timer starts.
//   ['L', t, tile, from, dx, dy]
//        a tile picked up. from = -1 (bank) or the slot it sat in. dx, dy: where
//        it was grabbed, in tile sizes from the tile's centre (|d| <= 0.5).
//   ['D', t, tile, slot, ok, dx, dy]
//        the held tile let go, as the handler judged it. slot = the EMPTY slot
//        under the pointer, or -1 (nowhere, over a filled slot, or the pointer
//        left the canvas). ok 1 = placed, 0 = back to the bank. dx, dy (only
//        with a slot): where in the slot, in tile sizes from its centre.
//   ['P', t]  panel hidden mid-round (timer frozen, a held tile goes home)
//   ['U', t]  Resume pressed; the next event is the re-drawn round (R, cause 3)
//   ['X', t]  the site reset local scores ('alb-scores-reset'): streak -> 0
//   ['E', t, why]  the attempt is over: 'time' (timer ran out), 'hide' (hidden
//        between rounds), 'restart' (Start pressed again).
(function (Q) {
  'use strict';

  // ── rules (the trainer reads these; one copy, so they cannot drift) ─────────
  var KEYS = ['A', 'B', 'E', 'F', 'H', 'N', 'R', 'U', 'W', 'X'];
  var GAP_WIN = 1000;     // ms from a cleared round to the next one
  var GAP_FAIL = 900;     // ms from a timeout to the restart
  function patternLen(streak, comp) { return comp ? Math.min(3 + streak, 9) : Math.min(2 + streak, 9); }
  // seconds
  function timerDur(streak, comp) {
    return comp ? (streak <= 5 ? 7 : Math.max(7 - (streak - 5), 4))
                : (streak <= 7 ? 8 : Math.max(8 - (streak - 7), 5));
  }

  // ── tolerances (what an honest browser can do) ──────────────────────────────
  var TOL = {
    GAP: 110,         // gap floor slack: ms rounding + coarse clocks (privacy modes quantise performance.now to 100 ms)
    EARLY_FAIL: 25,   // a timeout is logged after the round's deadline; slack for ms rounding
    LATE_WIN: 400,    // a drop handled before the frame that would have timed the round out (long frames, coarse clocks)
    // Time kept over a pause: a coarse clock can move it by one quantum. It is
    // a budget for the whole round, not per resume: a forged log that pauses
    // and resumes again and again at the same moment cannot add it up.
    LEFT: 150,
    OFF: 0.51,        // |dx|,|dy| of a hit: 0.5 + the 0.01 rounding
  };

  // ── "is this a person" (review only; far outside real play) ────────────────
  var HUMAN = {
    // Pick-up to drop, placements (a lift out of a slot let go over the same
    // slot is a click, not a drag, and is left out). N 20, not fewer: a
    // person's odd flick or slip must not reach 25% of a short log.
    DRAG_N: 20, DRAG_FLOOR: 50, DRAG_FLOOR_MOB: 40, DRAG_SHARE: 0.25,
    // Placement to placement in a round: back up ~180 px, find a rune, grab,
    // carry it ~180 px down. Two aimed moves; fast players take 300+ ms.
    CYCLE_N: 20, CYCLE_MEDIAN: 180,
    STEADY_N: 20, STEADY_DRAG_SD: 6, STEADY_CYCLE_SD: 8,               // metronome
    OFF_N: 15, OFF_SD: 0.025,           // grab / drop points: a person scatters around the centre
    // Round start to first grab. Any bank tile is a right first pick and the
    // next round comes a fixed 1 s after a win, so a player who clicks ahead
    // can grab early (a press before the round is ignored and has to be
    // repeated): only "nearly every round within 60 ms" is a script. A
    // person timing the 1 s gap scatters by 40+ ms and loses the presses that
    // come too early.
    REACT_N: 20, REACT_FLOOR: 60, REACT_SHARE: 0.85,
    KEY_N: 20, KEY_ALPHA: 1e-6,         // one rune far too common
    // Duplicate runes in a round / the bank already sitting above its slots.
    // z-scores of counts with heavy right tails (a triple is three pairs at
    // once), so the bars are high; a hand-picked easy run is at z 20+.
    DRAW_ROUNDS: 5, PAIR_Z: 10, FIX_Z: 8,
    // Position tests, per round length with >= POS_N rounds of it: one rune
    // far too common in one slot (a fixed or hand-picked pattern), and one
    // bank tile far too often holding one slot's rune (any fixed layout - the
    // bank reversed, shifted, or in slot order).
    // Exact tails, Bonferroni over the cells; a fixed pattern over 10 rounds
    // is at p ~1e-8, a fixed layout over 20 rounds at ~1e-12.
    POS_N: 10, POS_ALPHA: 1e-7,
    // Resume re-draws the runes and keeps the time, so pausing is a free
    // re-roll. A log with more re-rolls than cleared rounds (and many of them)
    // could be picking its rounds.
    REROLL_N: 20,
  };
  // An attempt lasts at least one whole round timer (the shortest is 4 s; a
  // pause keeps the time that was left) and the 900 ms restart gap, so
  // attempt a cannot start before a * ATTEMPT_MIN ms (generous: 4900 - slack).
  var ATTEMPT_MIN = 4500;

  var KEYSET = {};
  for (var k = 0; k < KEYS.length; k++) KEYSET[KEYS[k]] = true;

  function isInt(x) { return typeof x === 'number' && Math.floor(x) === x; }
  function offOk(x) { return typeof x === 'number' && x >= -TOL.OFF && x <= TOL.OFF; }
  function sortStr(s) { return s.split('').sort().join(''); }
  function keysOk(s) { for (var i = 0; i < s.length; i++) if (!KEYSET[s.charAt(i)]) return false; return true; }

  // Were the rounds' runes drawn the way the trainer draws them (each slot a
  // uniform rune, the bank a uniform shuffle)? Three one-sided tests for
  // "easier than chance": one rune too common, too many repeated runes in a
  // round, the bank too often already sitting above its slots.
  function drawTests(rounds) {
    var counts = {}, n = 0, maxK = 0;
    var pairs = 0, pairsE = 0, pairsV = 0, fix = 0, fixE = 0, fixV = 0;
    for (var r = 0; r < rounds.length; r++) {
      var p = rounds[r][0], b = rounds[r][1], L = p.length, c = {}, i;
      for (i = 0; i < L; i++) {
        var ch = p.charAt(i);
        c[ch] = (c[ch] || 0) + 1;
        counts[ch] = (counts[ch] || 0) + 1; n++;
        if (counts[ch] > maxK) maxK = counts[ch];
      }
      var pr = 0, s2 = 0, s4 = 0, same = 0;
      for (var key in c) {
        var ck = c[key];
        pr += ck * (ck - 1) / 2;
        s2 += ck * ck; s4 += ck * ck * ck * ck;
        same += ck * (ck - 1) * ck * (ck - 1);
      }
      var m = L * (L - 1) / 2;
      pairs += pr; pairsE += m * 0.1; pairsV += m * 0.09;     // pairwise-independent events
      var X = 0;
      for (i = 0; i < L; i++) if (p.charAt(i) === b.charAt(i)) X++;
      var mu = s2 / L, ex2 = mu + (same + s2 * s2 - s4) / (L * (L - 1));
      fix += X; fixE += mu; fixV += ex2 - mu * mu;           // exact for a uniform shuffle
    }
    var pos = posTests(rounds);
    return {
      n: n,
      keyP: n ? Math.min(1, KEYS.length * Q.stats.binomUpper(n, maxK, 1 / KEYS.length)) : 1,
      pairZ: pairsV > 0 ? (pairs - pairsE) / Math.sqrt(pairsV) : 0,
      fixZ: fixV > 0 ? (fix - fixE) / Math.sqrt(fixV) : 0,
      slotP: pos.slotP, layoutP: pos.layoutP,
    };
  }

  // Exact upper tails with + - * / only (the same on every engine).
  // P(X >= k), X ~ Binomial(n, p). n is at most ~1000 here: no underflow.
  function binomTail(n, k, p) {
    if (k <= 0) return 1;
    if (k > n) return 0;
    var pmf = 1, tail = 0, i;
    for (i = 0; i < n; i++) pmf *= 1 - p;
    for (i = 0; i <= n; i++) { if (i >= k) tail += pmf; pmf = pmf * (n - i) / (i + 1) * p / (1 - p); }
    return Math.min(1, tail);
  }
  // P(X >= k), X a sum of Bernoulli(qs[i]).
  function pbTail(qs, k) {
    var d = [1], i, j;
    for (i = 0; i < qs.length; i++) {
      var q = qs[i], nd = [];
      for (j = 0; j <= d.length; j++) nd.push((j < d.length ? d[j] * (1 - q) : 0) + (j > 0 ? d[j - 1] * q : 0));
      d = nd;
    }
    var t = 0;
    for (j = k; j < d.length; j++) t += d[j];
    return Math.min(1, t);
  }

  // Per round length L with at least HUMAN.POS_N rounds (Bonferroni over every
  // cell tested):
  //   slotP   - one rune too often in one slot (each slot is a uniform draw
  //             of 10, so a slot's count of a rune is Binomial(n, 0.1)).
  //   layoutP - bank tile j too often holding slot i's rune. Given the
  //             pattern, bank tile j is a uniform pick from its runes, so it
  //             holds slot i's rune with q = (copies of that rune) / L.
  //             Exact for the 3 cells furthest above their mean.
  function posTests(rounds) {
    var byLen = {}, r, i, j, k;
    for (r = 0; r < rounds.length; r++) {
      var L = rounds[r][0].length;
      (byLen[L] = byLen[L] || []).push(rounds[r]);
    }
    var P = 1 / KEYS.length, slotMin = 1, layoutMin = 1, slotCells = 0, layoutCells = 0;
    for (var key in byLen) {
      var rs = byLen[key], n = rs.length, Ln = +key;
      if (n < HUMAN.POS_N || Ln < 2) continue;
      slotCells += Ln * KEYS.length; layoutCells += Ln * Ln;
      var sc = {}, maxSc = 0, mc = [], me = [], mv = [];
      for (i = 0; i < Ln * Ln; i++) { mc.push(0); me.push(0); mv.push(0); }
      for (r = 0; r < n; r++) {
        var p = rs[r][0], b = rs[r][1], c = {};
        for (i = 0; i < Ln; i++) {
          var ch = p.charAt(i);
          c[ch] = (c[ch] || 0) + 1;
          sc[i + ch] = (sc[i + ch] || 0) + 1;
          if (sc[i + ch] > maxSc) maxSc = sc[i + ch];
        }
        for (i = 0; i < Ln; i++) {
          var q = c[p.charAt(i)] / Ln;
          for (j = 0; j < Ln; j++) {
            k = j * Ln + i;
            if (b.charAt(j) === p.charAt(i)) mc[k]++;
            me[k] += q; mv[k] += q * (1 - q);
          }
        }
      }
      slotMin = Math.min(slotMin, binomTail(n, maxSc, P));
      // the three cells with the highest z, then their exact tails
      var top = [];
      for (k = 0; k < mc.length; k++) {
        if (!(mv[k] > 0) || mc[k] <= me[k]) continue;
        top.push([(mc[k] - me[k]) / Math.sqrt(mv[k]), k]);
      }
      top.sort(function (x, y) { return y[0] - x[0] || x[1] - y[1]; });
      for (var t = 0; t < top.length && t < 3; t++) {
        k = top[t][1];
        var ti = k % Ln, tj = (k - ti) / Ln, qs = [];
        for (r = 0; r < n; r++) {
          var pp = rs[r][0], cnt = 0;
          for (i = 0; i < Ln; i++) if (pp.charAt(i) === pp.charAt(ti)) cnt++;
          qs.push(cnt / Ln);
        }
        layoutMin = Math.min(layoutMin, pbTail(qs, mc[k]));
      }
    }
    return {
      slotP: Math.min(1, slotMin * Math.max(1, slotCells)),
      layoutP: Math.min(1, layoutMin * Math.max(1, layoutCells)),
    };
  }

  function check(log, env) {
    var r = Q.result();
    var S = Q.stats;
    var comp = !!env.comp;
    var mob = env.platform === 'M' || !!(log.env && log.env.mob);
    var ev = log.ev;

    var streak = 0, phase = 'start';    // start | live | gap | paused | resume | over
    var len = 0, pat = '', bank = '', tR = 0, tS = 0;
    var where = [], fill = [], filled = 0;   // where[tile]: -1 bank, slot, -2 lost, -3 held
    var held = -1, liftT = 0, liftFrom = -1, lastPlace = -1, firstLift = true, replaced = 0;
    var tWin = 0, pausedLeft = 0, leftSlack = 0;
    var nR = 0, wins = 0, wrong = 0, misses = 0, lifts = 0, pauses = 0, resets = 0, lost = 0, trailing = 0;
    var drags = [], cycles = [], reacts = [], dropX = [], dropY = [], liftX = [], liftY = [], rounds = [];
    var why = null, stop = null, i;

    function deadline() { return tS + timerDur(streak, comp) * 1000; }

    for (i = 0; i < ev.length; i++) {
      var e = ev[i], c = e[0], t = e[1];
      if (phase === 'over') { trailing++; continue; }
      if (i === 0 && c !== 'R') { why = 'the log does not start with a round'; break; }
      if (phase === 'resume' && c !== 'R') { why = 'a resume with no round after it'; break; }

      if (c === 'R') {
        var cause = e[2], st = e[3], p = e[4], b = e[5], left = e[6];
        if (!isInt(cause) || cause < 0 || cause > 3 || !isInt(st) || typeof p !== 'string' ||
            typeof b !== 'string' || !isInt(left)) { why = 'malformed round'; break; }
        if (cause === 0 || cause === 2) {
          if (i !== 0) { why = 'a run (re)start in the middle of an attempt'; break; }
          if ((cause === 0) !== (log.a === 0)) { why = 'attempt ' + log.a + ' starts with cause ' + cause; break; }
          if (t < log.a * ATTEMPT_MIN) { why = 'attempt ' + log.a + ' starts ' + t + ' ms into the run (each attempt before it takes at least ' + ATTEMPT_MIN + ' ms)'; break; }
        } else if (cause === 1) {
          if (phase !== 'gap') { why = 'a next round with no cleared round before it'; break; }
          if (t - tWin < GAP_WIN - TOL.GAP) { why = 'a round ' + (t - tWin) + ' ms after a win (the gap is ' + GAP_WIN + ' ms)'; break; }
        } else if (phase !== 'resume') { why = 'a resumed round with no resume'; break; }
        if (st !== streak) { why = 'a round at streak ' + st + ' where the log has ' + streak; break; }
        var L = patternLen(streak, comp), dur = timerDur(streak, comp) * 1000;
        if (p.length !== L || b.length !== L) { why = 'a round of ' + p.length + '/' + b.length + ' runes at streak ' + streak + ' (the rules give ' + L + ')'; break; }
        if (!keysOk(p) || sortStr(p) !== sortStr(b)) { why = 'a bank that is not the round\'s runes'; break; }
        if (cause === 3) {
          // Net extra time over all the resumes of this round (clock slack
          // one way can be followed by slack the other way; it cannot add up).
          var extra = left - pausedLeft;
          if (left < 0 || left > dur || leftSlack + extra > TOL.LEFT) {
            why = 'resumed with ' + left + ' ms left where ' + Math.round(pausedLeft) + ' ms were left at the pause' +
              (leftSlack > 0 ? ' (' + Math.round(leftSlack) + ' ms already added this round)' : ''); break;
          }
          leftSlack += extra;
        } else if (left !== dur) { why = 'a round timer of ' + left + ' ms (the rules give ' + dur + ')'; break; }
        else leftSlack = 0;
        len = L; pat = p; bank = b; tR = t; tS = t - (dur - left);
        where = []; fill = []; filled = 0;
        for (var q = 0; q < L; q++) { where.push(-1); fill.push(-1); }
        held = -1; lastPlace = -1; firstLift = true;
        phase = 'live'; nR++;
        rounds.push([p, b]);
      } else if (c === 'L') {
        if (phase !== 'live') { why = 'a tile picked up with no round in play'; break; }
        var lt = e[2], from = e[3];
        if (!isInt(lt) || lt < 0 || lt >= len || !isInt(from) || from < -1 || from >= len ||
            !offOk(e[4]) || !offOk(e[5])) { why = 'malformed or off-tile pick-up'; break; }
        if (from === -1 ? where[lt] !== -1 : fill[from] !== lt) { why = 'tile ' + lt + ' picked up from where it is not'; break; }
        if (from >= 0) { fill[from] = -1; filled--; }
        // A second press while holding one (another mouse button, a second
        // finger): the client drops the first tile nowhere and it is gone for
        // the round.
        if (held >= 0) { where[held] = -2; lost++; }
        held = lt; where[lt] = -3; liftT = t; liftFrom = from; lifts++;
        if (firstLift) { reacts.push(t - tR); firstLift = false; }
        liftX.push(e[4]); liftY.push(e[5]);
      } else if (c === 'D') {
        if (phase !== 'live' || held < 0) { why = 'a drop with no tile held'; break; }
        var dt = e[2], slot = e[3], ok = e[4];
        if (dt !== held) { why = 'tile ' + dt + ' dropped while tile ' + held + ' was held'; break; }
        if (!isInt(slot) || slot < -1 || slot >= len || (ok !== 0 && ok !== 1)) { why = 'malformed drop'; break; }
        held = -1;
        if (slot === -1) {
          if (ok) { why = 'a drop on no slot judged placed'; break; }
          where[dt] = -1; misses++;
          continue;
        }
        if (!offOk(e[5]) || !offOk(e[6])) { why = 'a drop outside the slot it says it hit'; break; }
        if (fill[slot] !== -1) { why = 'a drop on slot ' + slot + ', which is already filled'; break; }
        var match = bank.charAt(dt) === pat.charAt(slot);
        if ((ok === 1) !== match) {
          why = match ? 'a matching rune judged wrong' : 'rune ' + bank.charAt(dt) + ' placed on a ' + pat.charAt(slot) + ' slot'; break;
        }
        if (!match) { where[dt] = -1; wrong++; continue; }
        fill[slot] = dt; where[dt] = slot; filled++;
        if (slot === liftFrom) {
          // Lifted out of a slot and let go over the same slot: a click on a
          // placed tile (or a tap's compatibility mouse events), not an aimed
          // drag - it says nothing about speed or aim.
          replaced++;
        } else {
          drags.push(t - liftT); dropX.push(e[5]); dropY.push(e[6]);
          if (lastPlace >= 0) cycles.push(t - lastPlace);
          lastPlace = t;
        }
        if (filled === len) {
          var late = t - deadline();
          if (late > TOL.LATE_WIN) {
            // A frame can be very late (a stalled tab); the client would still
            // take the drop. Not provable in time: stop counting here.
            stop = 'round ' + nR + ' cleared ' + late + ' ms after its timer ran out';
            r.stat('lateWinMs', late);
            break;
          }
          streak++; wins++; tWin = t; phase = 'gap';
        }
      } else if (c === 'P') {
        if (phase !== 'live') { why = 'a pause with no round in play'; break; }
        pausedLeft = Math.max(0, deadline() - t);
        if (held >= 0) { where[held] = -1; held = -1; }
        phase = 'paused'; pauses++;
      } else if (c === 'U') {
        if (phase !== 'paused') { why = 'a resume that was not paused'; break; }
        phase = 'resume';
      } else if (c === 'X') {
        streak = 0; resets++;
      } else if (c === 'E') {
        if (typeof e[2] !== 'string') { why = 'an end with no reason'; break; }
        if (e[2] === 'time') {
          if (phase !== 'live') { why = 'a timeout with no round in play'; break; }
          if (t < deadline() - TOL.EARLY_FAIL) { why = 'a timeout ' + Math.round(deadline() - t) + ' ms before the timer ran out'; break; }
        }
        phase = 'over';
      } else {
        why = 'unknown event ' + c; break;
      }
    }

    if (why) { r.invalid(why + ' (event ' + i + ')'); return r; }
    r.score = streak;
    if (stop) { r.stat('stoppedAt', i); r.stat('stopReason', stop); }
    if (env.claimed > 0 && r.score === 0 && !stop) { r.invalid('a score with no cleared round behind it'); return r; }
    if (env.claimed > r.score) r.stat('claimAboveLog', env.claimed - r.score);

    r.stat('rounds', nR); r.stat('wins', wins); r.stat('streak', streak);
    r.stat('lifts', lifts); r.stat('wrong', wrong); r.stat('misses', misses);
    if (lost) r.stat('lost', lost);
    if (replaced) r.stat('replaced', replaced);
    if (pauses) r.stat('pauses', pauses);
    if (resets) r.stat('resets', resets);
    if (trailing) r.stat('trailing', trailing);
    if (drags.length) { r.stat('dragMed', S.median(drags)); r.stat('dragSd', S.sd(drags)); }
    if (cycles.length) { r.stat('cycleMed', S.median(cycles)); r.stat('cycleSd', S.sd(cycles)); }
    if (reacts.length) r.stat('reactMed', S.median(reacts));
    if (dropX.length > 1) { r.stat('dropSdX', S.sd(dropX)); r.stat('dropSdY', S.sd(dropY)); }
    if (liftX.length > 1) { r.stat('liftSdX', S.sd(liftX)); r.stat('liftSdY', S.sd(liftY)); }

    // ── person checks ──
    var H = HUMAN, why2;
    if ((why2 = Q.tooFast(drags, H.DRAG_N, mob ? H.DRAG_FLOOR_MOB : H.DRAG_FLOOR, H.DRAG_SHARE))) r.review('drags: ' + why2);
    if (cycles.length >= H.CYCLE_N && S.median(cycles) < H.CYCLE_MEDIAN) {
      r.review('placements faster than hands (median ' + Math.round(S.median(cycles)) + ' ms over ' + cycles.length + ')');
    }
    if ((why2 = Q.tooSteady(drags, H.STEADY_N, H.STEADY_DRAG_SD))) r.review('drags: ' + why2);
    if ((why2 = Q.tooSteady(cycles, H.STEADY_N, H.STEADY_CYCLE_SD))) r.review('placements: ' + why2);
    if ((why2 = Q.tooAccurate(dropX, H.OFF_N, H.OFF_SD, ' tile')) || (why2 = Q.tooAccurate(dropY, H.OFF_N, H.OFF_SD, ' tile'))) r.review('drop points: ' + why2);
    if ((why2 = Q.tooAccurate(liftX, H.OFF_N, H.OFF_SD, ' tile')) || (why2 = Q.tooAccurate(liftY, H.OFF_N, H.OFF_SD, ' tile'))) r.review('grab points: ' + why2);
    if ((why2 = Q.tooFast(reacts, H.REACT_N, H.REACT_FLOOR, H.REACT_SHARE))) r.review('round starts: ' + why2);

    var d = drawTests(rounds);
    r.stat('keyP', d.keyP < 0.001 ? d.keyP.toExponential(1) : d.keyP); r.stat('pairZ', d.pairZ); r.stat('fixZ', d.fixZ);
    r.stat('slotP', d.slotP < 0.001 ? d.slotP.toExponential(1) : d.slotP);
    r.stat('layoutP', d.layoutP < 0.001 ? d.layoutP.toExponential(1) : d.layoutP);
    if (d.n >= H.KEY_N && (why2 = Q.tooLucky(d.keyP, H.KEY_ALPHA, 'one rune far too common'))) r.review(why2);
    if (rounds.length >= H.DRAW_ROUNDS) {
      if (d.pairZ > H.PAIR_Z) r.review('targets too lucky (repeated runes, z=' + d.pairZ.toFixed(1) + ')');
      if (d.fixZ > H.FIX_Z) r.review('targets too lucky (bank already in slot order, z=' + d.fixZ.toFixed(1) + ')');
    }
    if ((why2 = Q.tooLucky(d.slotP, H.POS_ALPHA, 'one rune keeps coming up in the same slot'))) r.review(why2);
    if ((why2 = Q.tooLucky(d.layoutP, H.POS_ALPHA, 'the bank keeps the same layout'))) r.review(why2);
    if (pauses >= H.REROLL_N && pauses > wins) r.review('rounds re-drawn by ' + pauses + ' resumes for ' + wins + ' cleared');
    return r;
  }

  Q.register('staff', {
    KEYS: KEYS, GAP_WIN: GAP_WIN, GAP_FAIL: GAP_FAIL, ATTEMPT_MIN: ATTEMPT_MIN,
    patternLen: patternLen, timerDur: timerDur,
    TOL: TOL, HUMAN: HUMAN, drawTests: drawTests,
    check: check,
  });
})(typeof globalThis !== 'undefined' ? globalThis.QteRules : this.QteRules);

// ==== qte-rules part: thorian ====
// ── thorian ─────────────────────────────────────────────────────────────────
// Old Thorian ('thorian' / 'thorian-comp'). A bar snaps UP / LEFT / RIGHT
// around a heart; purple hearts fly at the centre from the top, left and right
// in strips. A heart that meets the bar is blocked, one that reaches the
// centre costs a life; two lives per round. One point = one round survived.
//
// The log (t = wall ms since Start; g = game ms into the round, the sum of the
// frame steps capped at 50 ms, logged to 0.1 ms):
//   ['G', t, s, sz]           round begins; s = rounds already won, sz = canvas size
//   ['H', t, side, u, g, dt]  heart made in the frame at g (frame step dt);
//                             side 0 top / 1 left / 2 right; u = its offset draw
//                             in hundredths (0..99, floor(draw * 100); see offset())
//   ['B', t, id, g]           heart id (0.. in spawn order, this round) blocked at frame g
//   ['X', t, id, g]           heart id reached Thorian at frame g (a life lost)
//   ['O', t, id, g]           heart id left the screen (only possible after a resize)
//   ['K', t, dir, g]          the bar turned to dir (0 up / 1 left / 2 right);
//                             g = the last frame before the key
//   ['W', t, g]               round won in the frame at g
//   ['P', t, g] / ['U', t]    paused (g = the last frame) / resumed
//   ['Z', t, sz]              the canvas was resized mid-run (panel shown again)
//   ['E', t, reason]          run over: 'dead' (second hit of a round), 'reset', 'restart'
// Events are in the order they happened, so the bar a frame judged with is the
// bar after every K logged before that frame's events.
(function (Q) {
  'use strict';
  var S = Q.stats;

  // ── rules (the IIFE reads these; identical numbers) ────────────────────────
  var SIDES   = ['top', 'left', 'right'];
  var SIDE_IX = { top: 0, left: 1, right: 2 };
  var DIR_IX  = { up: 0, left: 1, right: 2 };

  function roundSecs(s)      { return Math.min(8 + s * 1.5, 20); }
  function speed(s, comp)    { return comp ? Math.min(155 + s * 28, 380) : Math.min(145 + s * 20, 285); }
  function stripLen(s, comp) { return comp ? Math.min(4 + s, 10)         : Math.min(3 + Math.floor(s * 0.85), 9); }
  function interval(s, comp) { return comp ? Math.max(170, 390 - s * 22) : Math.max(210, 430 - s * 20); }
  function gapDelay(s, comp) { return comp ? Math.max(420, 1300 - s * 90) : Math.max(500, 1500 - s * 85); }

  // Canvas layout for a square canvas of side sz (resizeCanvas).
  function geom(sz) {
    return {
      sz:  sz,
      C:   sz / 2,
      off: Math.round(sz * 0.052),   // BAR_OFF
      len: Math.round(sz * 0.135),   // BAR_LEN
      th:  Math.round(sz * 0.024),   // BAR_THICK
      tr:  Math.round(sz * 0.038),   // THORIAN_R
      tsz: Math.round(sz * 0.100),   // THORIAN_SZ
      pr:  Math.round(sz * 0.022),   // PROJ_R
      psz: Math.round(sz * 0.056),   // PROJ_SZ
    };
  }
  // Distances along a heart's flight line (px from its spawn point), for a
  // heart with lateral offset o. It starts PROJ_R outside the edge, aimed at
  // the centre; the same for all three sides by symmetry.
  //   contact: first overlaps its own side's bar      (overlapsBar)
  //   exit:    no longer overlaps that bar
  //   hit:     within THORIAN_R + PROJ_R of the centre (hitsThorian)
  // Collisions test the bar first, so a heart inside the bar's box with the bar
  // up is blocked even past `hit`; hit < exit always. The other two bars are
  // never in a heart's way (barRect's comment in the IIFE).
  function path(G, o) {
    var a = G.C + G.pr, d0 = Math.sqrt(o * o + a * a), k = a / d0;
    return {
      contact: (G.C - G.off - G.th) / k,
      exit:    (G.C - G.off + 2 * G.pr) / k,
      hit:     d0 - (G.tr + G.pr),
    };
  }

  var SPREAD        = 0.38;   // lateral spread, x BAR_LEN, either way
  // Lateral offset (px) of a heart whose logged draw is u (hundredths): the
  // middle of its 1/100 bin, within 0.2 px of the real one.
  function offset(G, u) { return ((u + 0.5) / 100 - 0.5) * 2 * SPREAD * G.len; }
  var MAX_LIVES     = 2;
  var FIRST_GAP_MS  = 700;    // first strip of a round
  var RESUME_GAP_MS = 700;    // betweenStripTimer after Resume
  var NEXT_ROUND_MS = 1600;   // round won -> next round

  // ── tolerances ─────────────────────────────────────────────────────────────
  var DT_MAX      = 50;       // the frame step clamp (ms)
  var TOL_G       = 0.25;     // ms: g and dt are logged to 0.1 ms
  var TOL_S       = 0.5;      // px along the flight line
  var WALL_SLACK  = 300;      // ms: game time never runs ahead of the wall clock,
                              // except that a rAF stamp can predate the G stamp
                              // by a frame (or a busy task), and coarse clocks
  var GAP_WALL    = 1400;     // ms: the 1600 ms round gap, minus coarse clocks
  var MIN_SZ      = 200;      // below this a 50 ms frame can carry a heart past the centre; not judged
  var MAX_SZ      = 440;
  var MAX_RESIZES = 5;        // hearts in flight at a resize are not judged; cap it
  var MAX_HOLDOFFS = 3;       // pauses in one round that pushed the next strip back

  // ── person checks (far outside real play; see thorian.notes.md) ─────────────
  var P = {
    COLD_MIN: 8, COLD_FLOOR: 100, COLD_SHARE: 0.7,   // reactions to a strip's first heart
    COLD_IDLE: 1000,     // ms with no bar turn before that heart: the player was waiting,
                         // not wiggling the bar (a wiggle can land on the heart's side by chance)
    SD_MIN_DF: 25,
    MARGIN_SD: 8,        // ms: turn -> the heart's contact, per round
    SPAWN_SD: 8,         // ms: heart spawn -> the turn that serves it
    PREV_SD: 5,          // ms: previous heart blocked -> the turn
    PHASE_SD: 0.03,      // where in the window between two arrivals the turn lands
    DRAW_MIN: 30, DRAW_ALPHA: 1e-6,
    // game clock / wall clock, median over >= 100 ms stretches: under 0.35 the
    // page ran below ~7 fps for most of the run (slow motion, e.g. a throttled rAF)
    PACE_MIN_DT: 100, PACE_MIN_N: 30, PACE_MIN: 0.35,
  };

  function isInt(n) { return typeof n === 'number' && Math.floor(n) === n; }
  function isNum(n) { return typeof n === 'number' && isFinite(n); }

  // SD of samples around their own round's mean: a policy that depends on the
  // round's speed or spacing still shows up as zero spread.
  function pooledSd(pairs) {
    var by = {}, keys = [], k, i;
    for (i = 0; i < pairs.length; i++) {
      k = pairs[i][0];
      if (!by[k]) { by[k] = []; keys.push(k); }
      by[k].push(pairs[i][1]);
    }
    var ss = 0, df = 0;
    for (i = 0; i < keys.length; i++) {
      var a = by[keys[i]];
      if (a.length < 2) continue;
      var m = S.mean(a);
      for (var j = 0; j < a.length; j++) ss += (a[j] - m) * (a[j] - m);
      df += a.length - 1;
    }
    return { sd: df > 0 ? Math.sqrt(ss / df) : 0, df: df };
  }

  // ── the check ──────────────────────────────────────────────────────────────
  function check(log, env) {
    var r = Q.result();
    var comp = !!(env && env.comp);
    var ev = log.ev;
    var st = {
      comp: comp, wins: 0, proven: 0, counting: true, stopWhy: null,
      bar: 2, phase: 'pre', paused: false, needE: false,
      sz: 0, G: null, rd: null, round: -1, tW: -1, lastKt: -1e9, lastTG: null,
      resizes: 0, pauses: 0, lastBreak: -1,
      hearts: 0, blocks: 0, hits: 0, turns: 0,
      sideN: [0, 0, 0], repK: 0, repN: 0, us: [],
      cold: [], margin: [], spawnD: [], prevD: [], phaseS: [],
      lf: null, pace: [],
    };
    var i, why = null;
    for (i = 0; i < ev.length; i++) {
      why = step(st, ev[i]);
      if (why || !st.counting) break;
    }
    if (why) { r.invalid(why + ' (event ' + i + ')'); return r; }

    var totalW = 0;
    for (i = 0; i < ev.length; i++) if (ev[i][0] === 'W') totalW++;
    var claimed = env && env.claimed | 0;
    // A log cut off at the event cap cannot show its last rounds; the score is
    // then what it does show. Otherwise every point claimed is a W in the log.
    var cut = ev.length >= Q.LIMITS.MAX_EVENTS - 1;
    if (claimed > totalW && !cut) { r.invalid('claims ' + claimed + ' rounds, the log has ' + totalW); return r; }
    r.score = st.proven;

    // ── numbers for an admin ──
    r.stat('rounds', st.proven).stat('hearts', st.hearts).stat('blocks', st.blocks)
     .stat('hits', st.hits).stat('turns', st.turns).stat('pauses', st.pauses).stat('resizes', st.resizes);
    if (st.sz) r.stat('sz', st.sz);
    if (cut) r.stat('logCut', true);
    if (st.stopWhy) r.stat('stoppedCounting', st.stopWhy);
    r.stat('coldN', st.cold.length);
    if (st.cold.length) r.stat('coldMedianMs', S.median(st.cold));
    if (st.spawnD.length) r.stat('turnAfterSpawnMedianMs', S.median(st.spawnD.map(function (p) { return p[1]; })));
    var pm = pooledSd(st.margin), ps = pooledSd(st.spawnD), pp = pooledSd(st.prevD), ph = pooledSd(st.phaseS);
    r.stat('marginSdMs', pm.sd).stat('marginN', st.margin.length);
    r.stat('spawnDelaySdMs', ps.sd).stat('prevDelaySdMs', pp.sd).stat('phaseSd', ph.sd);

    // ── is this a person ──
    var c = Q.tooFast(st.cold, P.COLD_MIN, P.COLD_FLOOR, P.COLD_SHARE);
    if (c) r.review(c + ' to a new strip');
    if (pm.df >= P.SD_MIN_DF && pm.sd < P.MARGIN_SD) r.review('bar turns land too evenly before each heart (SD ' + pm.sd.toFixed(1) + ' ms over ' + st.margin.length + ')');
    if (ps.df >= P.SD_MIN_DF && ps.sd < P.SPAWN_SD) r.review('bar turns come too evenly after each heart appears (SD ' + ps.sd.toFixed(1) + ' ms over ' + st.spawnD.length + ')');
    if (pp.df >= P.SD_MIN_DF && pp.sd < P.PREV_SD) r.review('bar turns come too evenly after each block (SD ' + pp.sd.toFixed(1) + ' ms over ' + st.prevD.length + ')');
    if (ph.df >= P.SD_MIN_DF && ph.sd < P.PHASE_SD) r.review('bar turns land at the same point between hearts every time (SD ' + ph.sd.toFixed(3) + ' over ' + st.phaseS.length + ')');
    if (st.pace.length) r.stat('gamePace', S.median(st.pace));
    if (st.pace.length >= P.PACE_MIN_N) {
      var pc = S.median(st.pace);
      if (pc < P.PACE_MIN) r.review('the game ran in slow motion (game clock ' + pc.toFixed(2) + ' x the wall clock over ' + st.pace.length + ' stretches)');
    }
    if (st.hearts >= P.DRAW_MIN) {
      var pmin = 1;
      for (i = 0; i < 3; i++) pmin = Math.min(pmin, S.binomTwoSided(st.hearts, st.sideN[i], 1 / 3));
      pmin = Math.min(1, pmin * 3);
      r.stat('sidesP', pmin.toExponential(1));
      var t1 = Q.tooLucky(pmin, P.DRAW_ALPHA, 'sides ' + st.sideN.join('/'));
      if (t1) r.review(t1);
      var ks = S.ksUniform(st.us);
      r.stat('offsetsP', ks.p.toExponential(1));
      var t3 = Q.tooLucky(ks.p, P.DRAW_ALPHA, 'offset draws not uniform');
      if (t3) r.review(t3);
    }
    if (st.repN >= P.DRAW_MIN) {
      var prep = S.binomUpper(st.repN, st.repK, 1 / 3);
      r.stat('repeatP', prep.toExponential(1));
      var t2 = Q.tooLucky(prep, P.DRAW_ALPHA, st.repK + ' of ' + st.repN + ' hearts from the same side as the one before');
      if (t2) r.review(t2);
    }
    return r;
  }

  function stop(st, why) {
    if (!st.counting) return;
    st.counting = false;
    st.stopWhy = why;
  }

  function newRound(st, t, s) {
    var c = st.comp;
    return {
      s: s, R: roundSecs(s) * 1000, t0: t,
      v: speed(s, c) / 1000, len: stripLen(s, c), iv: interval(s, c), gap: gapDelay(s, c),
      hs: [], open: 0, hits: 0, lastF: 0, pendF: 0, endDue: -1, prevSide: -1, pg: 0, holdoffs: 0,
      // strip scheduler (gameLoop): in a strip, or counting down to the next one
      inStrip: false, cnt: 0, lastSpawn: 0, thr: FIRST_GAP_MS, startAt: -1, amb: -1, uStrip: false,
    };
  }

  // A frame at g (the scheduler has run for it). Game time only moves forward,
  // stays inside the round timer, and never gets ahead of the wall clock.
  function frameAt(st, t, g) {
    var rd = st.rd;
    if (g < rd.lastF - TOL_G) return 'the game clock went back';
    if (g >= rd.R + DT_MAX + TOL_G) return 'the round ran past its timer';
    if (rd.endDue >= 0 && g > rd.endDue + TOL_G) return 'the round ran past its timer';
    if (t - rd.t0 < g - WALL_SLACK) return 'game time ran ahead of the wall clock';
    if (g > rd.lastF) rd.lastF = g;
    if (rd.endDue < 0 && g >= rd.R + TOL_G) rd.endDue = g;
    return null;
  }

  // Every frame up to g is finished: a heart that had reached Thorian by then
  // was blocked or hit in it.
  function resolvedBy(st, g) {
    var hs = st.rd.hs;
    while (st.rd.open < hs.length && hs[st.rd.open].res) st.rd.open++;
    for (var k = st.rd.open; k < hs.length; k++) {
      var h = hs[k];
      if (h.res || h.loose) continue;
      if (h.v * (g - h.g0) >= h.p.hit + TOL_S) return 'heart ' + k + ' reached Thorian and was neither blocked nor hit';
    }
    return null;
  }

  // The scheduler ran in a frame at g and made no heart there (or made one,
  // already logged): nothing may be overdue.
  function schedAt(st, g) {
    var rd = st.rd;
    if (rd.inStrip) {
      if (g >= rd.lastSpawn + rd.iv + TOL_G) return 'a heart of the strip is missing';
      return null;
    }
    if (rd.amb >= 0 && g > rd.amb + TOL_G) rd.amb = -1;
    if (rd.startAt >= 0) {
      if (g > rd.startAt + TOL_G) return 'a strip is missing';
    } else if (g >= rd.thr + DT_MAX + TOL_G) {
      // A frame step is at most 50 ms, so the frame before this one was already
      // past the countdown: the strip started then, and its first heart came in
      // this frame or earlier - it would be in the log by now.
      return 'a strip is missing';
    } else if (g >= rd.thr + TOL_G) {
      rd.startAt = g;            // the strip starts in this frame; its first heart comes next frame
    }
    return null;
  }

  function spawn(st, t, e) {
    var rd = st.rd, side = e[2], u = e[3], g = e[4], dt = e[5], why;
    if (!(side === 0 || side === 1 || side === 2)) return 'a heart from no side';
    if (!isInt(u) || !isNum(g) || !isNum(dt)) return 'a malformed heart';
    if (u < 0 || u > 99) return 'a heart off its lane';
    if (dt < 0 || dt > DT_MAX + TOL_G) return 'a frame step outside 0..50 ms';
    var G = st.G, pf = g - dt, o = offset(G, u);
    if (pf < rd.lastF - TOL_G) return 'a frame step that skips a known frame';
    if ((why = frameAt(st, t, g))) return why;
    if ((why = resolvedBy(st, pf))) return why;
    if (g > rd.pendF) rd.pendF = g;

    var first = false;
    if (rd.inStrip) {
      if (g < rd.lastSpawn + rd.iv - TOL_G) return 'hearts closer together than the strip allows';
      if (pf >= rd.lastSpawn + rd.iv + TOL_G) return 'a heart came late';
    } else {
      // pf is the frame the strip started in
      if (rd.amb >= 0 && Math.abs(pf - rd.amb) <= TOL_G) {
        rd.uStrip = true;       // it had started just before the pause
      } else {
        if (pf < rd.thr - TOL_G) return 'a strip started early';
        if (rd.startAt >= 0 && pf > rd.startAt + TOL_G) return 'a strip started late';
        if (pf >= rd.thr + DT_MAX + TOL_G) return 'a strip started late';   // not the first frame past its countdown
      }
      rd.inStrip = true; rd.cnt = 0; rd.startAt = -1; rd.amb = -1;
      first = true;
    }
    rd.cnt++;
    rd.lastSpawn = g;
    if (rd.cnt >= rd.len) {
      rd.inStrip = false;
      rd.thr = g + (rd.uStrip ? RESUME_GAP_MS : rd.gap);
      rd.uStrip = false;
    }

    var h = {
      id: rd.hs.length, side: side, o: o, g: g, g0: pf, t: t, v: rd.v, p: path(G, o),
      res: null, resT: 0, loose: false, first: first, sawK: false,
      idle: t - st.lastKt >= P.COLD_IDLE,
    };
    h.cT = pf + h.p.contact / h.v;
    rd.hs.push(h);
    st.hearts++;
    st.sideN[side]++;
    st.us.push((u + 0.5) / 100);
    if (rd.prevSide >= 0) { st.repN++; if (rd.prevSide === side) st.repK++; }
    rd.prevSide = side;
    return null;
  }

  function outcome(st, t, e) {
    var rd = st.rd, code = e[0], id = e[2], g = e[3], why;
    if (!isInt(id) || !isNum(g)) return 'a malformed ' + code;
    var h = rd.hs[id];
    if (!h) return 'an outcome for a heart that was never made';
    if (h.res) return 'a heart resolved twice';
    if ((why = frameAt(st, t, g))) return why;
    if (g > rd.pendF + 1e-6) {
      if ((why = resolvedBy(st, rd.pendF))) return why;
      rd.pendF = g;
    }
    if ((why = schedAt(st, g))) return why;
    if (!h.loose) {
      var s = h.v * (g - h.g0);
      if (code === 'B') {
        if (st.bar !== h.side) return 'a heart blocked with the bar turned away';
        if (s < h.p.contact - TOL_S) return 'a heart blocked before it reached the bar';
        if (s > h.p.exit + TOL_S) return 'a heart blocked after it passed the bar';
      } else if (code === 'X') {
        if (s < h.p.hit - TOL_S) return 'a hit before the heart reached Thorian';
        if (s - h.v * DT_MAX >= h.p.hit + TOL_S) return 'a hit a frame late';
        if (st.bar === h.side && s < h.p.exit - TOL_S) return 'a hit through a bar that was up';
      } else {
        return 'a heart left the screen';
      }
    }
    h.res = code; h.resT = t;
    if (code === 'B') st.blocks++;
    if (code === 'X') {
      st.hits++;
      if (++rd.hits >= MAX_LIVES) st.needE = true;
    }
    return null;
  }

  // How fast the game clock ran against the wall clock, between two events
  // logged inside frames (the same round, no pause or resize between). The
  // frame step is capped at 50 ms, so a page held under ~20 fps plays in slow
  // motion; a real device stays near 1 (0.5 even with 100 ms coarse clocks).
  function pace(st, t, g) {
    var L = st.lf;
    if (L && L.round === st.round && L.t > st.lastBreak && t - L.t >= P.PACE_MIN_DT) st.pace.push((g - L.g) / (t - L.t));
    if (!L || L.round !== st.round || L.t <= st.lastBreak || t - L.t >= P.PACE_MIN_DT) st.lf = { round: st.round, t: t, g: g };
  }

  // Samples for the person checks, for a turn to dir at wall t, after frame g.
  function sampleTurn(st, t, g, dir) {
    var rd = st.rd, hs = rd.hs, j = null, k;
    // When in the game the key came: g is the last frame before it (up to a
    // frame early); the last frame that logged an event gives the wall/game
    // offset, so the key's own game time is known to about a millisecond.
    var gk = g, L = st.lastTG;
    if (L && L.round === st.round && L.t > st.lastBreak) gk = Math.min(g + 2 * DT_MAX, Math.max(g, L.g + (t - L.t)));
    for (k = rd.open; k < hs.length; k++) {
      var h = hs[k];
      if (h.res || h.loose || h.side !== dir) continue;
      if (!j || h.cT < j.cT) j = h;
    }
    if (!j) return;                         // nothing coming from there: not a response
    var clean = st.lastBreak < j.t;         // no pause / resize since it appeared
    st.margin.push([st.round, j.cT - gk]);
    if (clean) st.spawnD.push([st.round, t - j.t]);
    if (clean && j.first && j.idle && !j.sawK) {
      var earlierOpen = false;
      for (k = rd.open; k < j.id; k++) if (!hs[k].res) { earlierOpen = true; break; }
      if (!earlierOpen) st.cold.push(t - j.t);
    }
    // Inside a strip the turn has to fit between the previous heart's block and
    // this one's contact; across a strip gap it does not, so those are left out.
    var i = hs[j.id - 1];
    if (i && !j.first && !i.loose && i.res === 'B' && i.side !== dir && st.lastBreak < i.resT) {
      st.prevD.push([st.round, t - i.resT]);
      var w = j.cT - i.cT;
      if (w > 50) st.phaseS.push([st.round, (gk - i.cT) / w]);
    }
  }

  function step(st, e) {
    var code = e[0], t = e[1], rd = st.rd, why, g;
    if (st.phase === 'end') return 'an event after the run ended';
    if (st.needE && code !== 'E') return 'the round went on after the last life';

    switch (code) {
      case 'G': {
        var s = e[2], sz = e[3];
        if (e.length !== 4 || !isInt(s) || !isInt(sz)) return 'a malformed G';
        if (st.paused) return 'a round began while paused';
        if (st.phase !== 'pre' && st.phase !== 'gap') return 'a round began inside a round';
        if (s !== st.wins) return 'round ' + s + ' after ' + st.wins + ' wins';
        if (sz > MAX_SZ) return 'a canvas size the page cannot make';
        if (st.phase === 'gap' && t - st.tW < GAP_WALL) return 'the next round came too soon after a win';
        st.round++;
        st.rd = newRound(st, t, s);
        st.sz = sz; st.G = geom(sz);
        st.phase = 'round';
        if (sz < MIN_SZ) stop(st, 'canvas ' + sz + ' px is too small to judge');
        return null;
      }
      case 'H':
        if (e.length !== 6) return 'a malformed H';
        if (st.phase !== 'round' || st.paused) return 'a heart outside a running round';
        st.lastTG = { round: st.round, t: t, g: e[4] };
        if ((why = spawn(st, t, e))) return why;
        pace(st, t, e[4]);
        return null;
      case 'B': case 'X': case 'O':
        if (e.length !== 4) return 'a malformed ' + code;
        if (st.phase !== 'round' || st.paused) return 'an outcome outside a running round';
        st.lastTG = { round: st.round, t: t, g: e[3] };
        if ((why = outcome(st, t, e))) return why;
        pace(st, t, e[3]);
        return null;
      case 'K': {
        var dir = e[2]; g = e[3];
        if (e.length !== 4 || !isInt(dir) || dir < 0 || dir > 2 || !isNum(g)) return 'a malformed K';
        if (st.paused) return 'the bar turned while paused';
        if (st.phase !== 'round' && st.phase !== 'gap') return 'the bar turned outside a run';
        if (dir === st.bar) return 'the bar turned to where it already pointed';
        if (st.phase === 'round') {
          if (g >= rd.R + TOL_G) return 'the round ran past its timer';
          if ((why = frameAt(st, t, g)) || (why = resolvedBy(st, g)) || (why = schedAt(st, g))) return why;
          if (g > rd.pendF) rd.pendF = g;
          sampleTurn(st, t, g, dir);
          for (var k = rd.open; k < rd.hs.length; k++) if (!rd.hs[k].res) rd.hs[k].sawK = true;
        }
        st.bar = dir;
        st.turns++;
        st.lastKt = t;
        return null;
      }
      case 'W':
        g = e[2];
        if (e.length !== 3 || !isNum(g)) return 'a malformed W';
        if (st.phase !== 'round' || st.paused) return 'a win outside a running round';
        if ((why = frameAt(st, t, g))) return why;
        if (g < rd.R - TOL_G) return 'a round won before its timer ran out';
        if ((why = resolvedBy(st, g)) || (why = schedAt(st, g))) return why;
        if (t - rd.t0 < rd.R - WALL_SLACK) return 'a round won faster than the wall clock allows';
        pace(st, t, g);
        st.wins++;
        if (st.counting) st.proven = st.wins;
        st.phase = 'gap'; st.tW = t;
        return null;
      case 'P':
        g = e[2];
        if (e.length !== 3 || !isNum(g)) return 'a malformed P';
        if (st.paused) return 'paused twice';
        if (st.phase === 'round') {
          if (g >= rd.R + TOL_G) return 'the round ran past its timer';
          if ((why = frameAt(st, t, g)) || (why = resolvedBy(st, g)) || (why = schedAt(st, g))) return why;
          if (g > rd.pendF) rd.pendF = g;
          rd.pg = g;
        } else if (st.phase !== 'gap') return 'a pause outside a run';
        st.paused = true; st.pauses++; st.lastBreak = t;
        return null;
      case 'U':
        if (e.length !== 2) return 'a malformed U';
        if (!st.paused) return 'resumed without a pause';
        st.paused = false; st.lastBreak = t;
        if (st.phase === 'gap') return null;   // the next round begins when the gap is over
        // Resume sets betweenStripTimer = 700. Mid-strip that only changes the
        // next gap; between strips the countdown starts over from the frame at pg.
        // Pausing just before each strip and resuming holds the hearts off for
        // good (the real page does this too). A few pauses are people; more in
        // one round is that trick: the points stop there.
        var held;
        if (rd.inStrip || rd.startAt >= 0) {
          held = !rd.uStrip && rd.gap < RESUME_GAP_MS - TOL_G;   // the gap after this strip grows to 700
          rd.uStrip = true;
        } else {
          var oldThr = rd.thr;
          if (rd.pg >= rd.thr - TOL_G) rd.amb = rd.pg;
          rd.thr = rd.pg + RESUME_GAP_MS;
          held = rd.thr > oldThr + TOL_G;
        }
        if (held && ++rd.holdoffs > MAX_HOLDOFFS) stop(st, 'more than ' + MAX_HOLDOFFS + ' pauses held off the hearts in round ' + (rd.s + 1));
        return null;
      case 'Z': {
        var nz = e[2];
        if (e.length !== 3 || !isInt(nz)) return 'a malformed Z';
        if (nz > MAX_SZ) return 'a canvas size the page cannot make';
        if (st.phase !== 'round' && st.phase !== 'gap') return 'a resize outside a run';
        if (nz === st.sz) return null;
        st.lastBreak = t;
        st.resizes++;
        st.sz = nz; st.G = geom(nz);
        if (st.phase === 'round') for (var q = rd.open; q < rd.hs.length; q++) if (!rd.hs[q].res) rd.hs[q].loose = true;
        if (st.resizes > MAX_RESIZES) stop(st, 'more than ' + MAX_RESIZES + ' resizes');
        else if (nz < MIN_SZ) stop(st, 'canvas ' + nz + ' px is too small to judge');
        return null;
      }
      case 'E': {
        var why2 = e[2];
        if (e.length !== 3 || typeof why2 !== 'string') return 'a malformed E';
        if (st.needE && why2 !== 'dead') return 'the run ended some other way after the last life';
        if (why2 === 'dead' && !st.needE) return 'the run died with a life left';
        if (st.phase === 'pre') return 'the run ended before it began';
        st.needE = false;
        st.phase = 'end';
        return null;
      }
    }
    return 'unknown event ' + code;
  }

  Q.register('thorian', {
    SIDES: SIDES, SIDE_IX: SIDE_IX, DIR_IX: DIR_IX,
    SPREAD: SPREAD, MAX_LIVES: MAX_LIVES,
    FIRST_GAP_MS: FIRST_GAP_MS, RESUME_GAP_MS: RESUME_GAP_MS, NEXT_ROUND_MS: NEXT_ROUND_MS,
    roundSecs: roundSecs, speed: speed, stripLen: stripLen, interval: interval, gapDelay: gapDelay,
    geom: geom, path: path, offset: offset,
    TOL: { DT_MAX: DT_MAX, TOL_G: TOL_G, TOL_S: TOL_S, WALL_SLACK: WALL_SLACK, GAP_WALL: GAP_WALL, MIN_SZ: MIN_SZ, MAX_SZ: MAX_SZ, MAX_RESIZES: MAX_RESIZES, MAX_HOLDOFFS: MAX_HOLDOFFS },
    PERSON: P,
    check: check,
  });
})(typeof globalThis !== 'undefined' ? globalThis.QteRules : this.QteRules);

// ==== qte-rules part: thorian-new ====
// ── thorian-new ─────────────────────────────────────────────────────────────
// Drag a gold diamond onto rising purple orbs (js/qte.js THORIAN NEW QTE).
// Types 'thorian-new' and 'thorian-new-comp'. One point = one 15 s round
// survived; a round is lost on the second purple that leaves the top, and a
// diamond dropped on a red orb ends the run. The trainer reads every rule it
// plays by from here (radii, caps, timers, speed curve, the draws, the canvas
// size), so the check and the game cannot drift.
//
// The game runs on its own clock: g = the sum of frame dts, each clamped to
// [0, 50 ms], frozen while paused. Orbs move linearly in g from the frame
// before the one that spawned them, diamonds age in g while not held, and an
// input is judged against the state of the LAST RENDERED FRAME. So every event
// carries g (ms, 0.1 ms), frame events also carry d (that frame's dt, ms), and
// the check replays the game from them exactly.
//
// Log events (t = ms since the run's Start; numbers rounded by run.ev):
//   ['Z', t, W, H]                    canvas size (at Start, and on a resize mid-run)
//   ['R', t, g, d, n]                 round n starts (Start: g=0 d=0; later: the
//                                     frame that ends the 1 s transition)
//   ['O', t, g, d, col, p, m, gap]    orb spawned: column, p=1 purple / 0 red,
//                                     speed multiplier, next orb gap (s)
//   ['Y', t, g, d, col, y, life, gap] diamond spawned: column, y px, life (s),
//                                     next diamond gap (s)
//   ['X', t, g, k]                    orb k (run-wide spawn index) left the top
//   ['V', t, g, j]                    diamond j (run-wide spawn index) expired
//   ['G', t, g, j, px, py]            diamond j grabbed, pointer at (px, py)
//   ['L', t, g, x, y, k]              released with the diamond at (x, y):
//                                     k = orb hit (first in reach), -1 = none;
//                                     x, y null = the diamond's position went
//                                     NaN (it is lost: no hit, no regrab)
//   ['D', t, g, x, y]                 hold dropped by mouseleave (no test)
//   ['C', t, g, d, score]             round complete (the frame the timer hit 0)
//   ['P', t, g] / ['U', t, g]         panel hidden (paused) / Resume
//   ['E', t, why, g]                  the run ended: 'X' second purple escape,
//                                     'D' diamond dropped on a red orb
(function (Q) {
  'use strict';
  if (!Q) return;
  var S = Q.stats;

  // ── the rules (read by the IIFE) ──
  var R = {
    TARGET_R: 22,
    PLAYER_R: 26,
    MAX_TARGETS: 5,
    MAX_YELLOWS: 3,
    COLS: 5,
    GAME_SECS: 15,
    TRANSITION_S: 1.0,
    LIVES: 2,
    DT_MAX: 0.05,
    PURPLE_P: 0.75,
    MUL_MIN: 0.85, MUL_SPAN: 0.3,        // orb speed multiplier
    OGAP_MIN: 0.4, OGAP_SPAN: 0.8,       // s between orb spawns
    YGAP_MIN: 0.3, YGAP_SPAN: 0.4,       // s between diamond spawns
    LIFE_MIN: 3, LIFE_SPAN: 3,           // s a diamond lives (unheld)
    // The trainer stops logging once its events pass this many bytes of JSON,
    // so a marathon run's body stays under Q.LIMITS.MAX_BYTES; the check then
    // proves the rounds before the cut.
    LOG_BUDGET: 240000,
    // ... and closes the run (no more events, no more submits) this long
    // before Q.LIMITS.MAX_T, the latest time a log may carry (a run kept
    // paused overnight). Rounds submitted before that stay proven.
    LOG_T_MARGIN: 60000,
  };
  R.YEL_MARGIN = R.PLAYER_R + 20;                          // 46
  R.GRAB_R = R.PLAYER_R * 1.8;                             // 46.8
  R.GRAB_R2 = R.GRAB_R * R.GRAB_R;
  R.DROP_R = R.PLAYER_R + R.TARGET_R * 0.72;               // 41.84
  R.DROP_R2 = R.DROP_R * R.DROP_R;
  R.ESC_Y = -R.TARGET_R - 4;                               // an orb is gone once y < -26

  function rnd(x, k) { return Math.floor(x * k + 0.5) / k; }
  R.canvasH = function (W) { return Math.max(240, Math.min(360, Math.floor(W * 0.38 + 0.5))); };
  R.colX = function (W, col) { return Math.floor(W * (col * 2 + 1) / 10 + 0.5); };
  R.spawnY = function (H) { return H + R.TARGET_R + 4; };
  R.orbSpeed = function (round, comp) {
    return comp ? Math.min(300, 65 + (round - 1) * 28) : Math.min(220, 45 + (round - 1) * 18);
  };
  // Browser side: u = Math.random(). Draws are rounded (4 dp, y to 0.1 px) and
  // the game uses the rounded value, so the log holds exactly what was played.
  R.isPurple = function (u) { return u < R.PURPLE_P; };
  R.orbMul = function (u) { return rnd(R.MUL_MIN + u * R.MUL_SPAN, 10000); };
  R.orbGap = function (u) { return rnd(R.OGAP_MIN + u * R.OGAP_SPAN, 10000); };
  R.yelY = function (H, u) { return rnd(R.YEL_MARGIN + u * (H - R.YEL_MARGIN * 2), 10); };
  R.yelLife = function (u) { return rnd(R.LIFE_MIN + u * R.LIFE_SPAN, 10000); };
  R.yelGap = function (u) { return rnd(R.YGAP_MIN + u * R.YGAP_SPAN, 10000); };
  R.ms = function (s) { return rnd(s * 1000, 10); };        // game seconds -> logged ms (0.1 ms)
  R.px = function (v) { return rnd(v, 10); };               // logged positions (0.1 px)

  // ── tolerances ──
  var EPS = 0.3;          // ms: logged g and d are rounded to 0.1 ms
  var TOL_PX = 0.3;       // px: logged positions (0.1 px) + orb y from rounded times
  var TOL_MS = 1;         // ms: a diamond's age from rounded times (+0.1 ms per hold, see lifeTol)
  // ms the game clock may lead the run clock: the first frame's stamp can be
  // before the Start click was handled (by a frame, more on a janky page). The
  // lead never grows (a resume restarts from a later stamp), so this is a flat
  // allowance, not a rate.
  var G_AHEAD = 1000;
  var DT_MAX_MS = R.DT_MAX * 1000;

  // ── person checks (all far outside real play; see thorian-new.notes.md) ──
  var P = {
    MIN_N: 15,
    // Drop accuracy in TIME: the offset from the orb's centre divided by its
    // speed. A person tapping a diamond as an orb rises through it can be a
    // pixel off on a slow orb, but never ~3 ms off on average: their timing
    // scatters by tens of ms and the frame they are judged on adds up to 7-17.
    ACC_N: 20, ACC_MEAN_MS: 3,
    GRAB_FAST_MS: 100,    // grabbing a diamond this soon after it appeared ...
    GRAB_FAST_SHARE: 0.35, //  ... this often
    // A diamond that appeared AFTER the hand was freed, grabbed far (>150 px)
    // from where the last release left the pointer (within 47 px of that
    // diamond): a person must see it, then move there (>= ~250 ms). n >= 20:
    // a player flailing and spam-clicking lands on a fresh diamond by chance
    // a few % of the time, which n = 10 would hold now and then.
    FAR_PX: 150, FAR_N: 20, FAR_MS: 150, FAR_SHARE: 0.3,
    // A catch that dragged the diamond >= 80 px, grab to release under 40 ms,
    // in half of such catches. (Taps in place are excluded: a quick click is
    // a person's normal hold.)
    LONG_DRAG_PX: 80, HOLD_FAST_MS: 40, HOLD_FAST_SHARE: 0.5,
    DRAG_PX_MS: 6,        // median drag speed (px/ms) of catches above this
    STEADY_N: 20, STEADY_SD: 5,
    CLUSTER_N: 20, CLUSTER_MS: 2, CLUSTER_SHARE: 0.5,  // half the intervals inside a 4 ms window
    // Holds shorter than this are left out of the hold-time evenness tests: a
    // touchpad with tap-to-click sends mousedown and mouseup together, so
    // every tap is a 0-2 ms "hold" made by the hardware, not the hand.
    TAP_HW_MS: 30,
    LUCK_N: 30, LUCK_P: 1e-5,
    SLOW_N: 40, SLOW_SHARE: 0.6,  // share of logged frames at the 50 ms clamp
    // Below ~209 px (column spacing 0.2 W <= 41.84) one diamond parked on a
    // column also reaches both neighbouring columns, and under ~105 px all
    // five: the game becomes tapping in place. No phone is this narrow; a
    // zoomed or squeezed desktop window can be. Rounds completed on it are held.
    MIN_FAIR_W: 200,
  };
  R.PERSON = P;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isInt(x) { return isNum(x) && Math.floor(x) === x; }
  function inRange(x, lo, hi) { return isNum(x) && x >= lo - 1e-9 && x <= hi + 1e-9; }
  // A metronome with the odd irregular step: SD is pulled up by the outliers,
  // but most intervals still sit within a few ms of each other. People spread
  // their intervals over hundreds of ms (a 4 ms window holds a few % of them).
  function clustered(a) {
    if (a.length < P.CLUSTER_N) return null;
    var m = S.median(a), k = 0;
    for (var i = 0; i < a.length; i++) if (Math.abs(a[i] - m) <= P.CLUSTER_MS) k++;
    return k / a.length >= P.CLUSTER_SHARE ? 'timing too even (' + k + ' of ' + a.length + ' within ' + P.CLUSTER_MS + ' ms of ' + m.toFixed(0) + ' ms)' : null;
  }
  function logBytes(ev) { var n = 0; for (var i = 0; i < ev.length; i++) n += JSON.stringify(ev[i]).length + 1; return n; }
  // P(S >= k) for S a sum of independent Bernoulli(ps[i]) (Poisson binomial),
  // exact. For "the orbs came up in the easy columns too often".
  function pbUpper(ps, k) {
    var n = ps.length;
    if (k <= 0) return 1;
    if (k > n) return 0;
    var f = [1];
    for (var i = 0; i < n; i++) {
      var p = ps[i], q = 1 - p;
      f.push(f[i] * p);
      for (var j = i; j >= 1; j--) f[j] = f[j] * q + f[j - 1] * p;
      f[0] = f[0] * q;
    }
    var s = 0;
    for (var m = k; m <= n; m++) s += f[m];
    return Math.min(1, s);
  }

  R.check = function (log, env) {
    var r = Q.result();
    var ev = log.ev, comp = !!(env && env.comp), claimed = (env && env.claimed) | 0;
    var fail = null;
    function bad(i, why) { if (fail === null) fail = why + ' (event ' + i + ')'; return false; }

    var W = -1, H = -1, phase = 'pre', paused = false, pauseG = 0;
    var round = 0, score = 0, lives = 0;
    var R0 = 0, frozenAt = Infinity, lastCg = 0, expect = null;
    var pending = null, pendingG = 0;
    var orbs = [], yels = [], held = null, hold = null, nOrb = 0, nYel = 0;
    var oLast = 0, oGap = 0, oFree = Infinity, yLast = 0, yGap = 0, yFree = Infinity;
    var lastG = 0;
    // stats
    var nOrbs = 0, nPur = 0, muls = [], ogaps = [], lifes = [], ygaps = [], yfr = [];
    var farLat = [], freeT = -1, freeX = 0, freeY = 0;
    var offs = [], taus = [], holds = [], speeds = [], lat = [], relIv = [], lastRelT = -1, holdAll = [], regrab = [];
    var nFrames = 0, nClamped = 0, escapes = 0, drops = 0, playMs = 0;
    var colP = [], colHit = 0, roundMinW = Infinity, narrow = 0, minWDone = Infinity, lostN = 0;

    function pc(T) { return Math.min(T, frozenAt); }
    function orbY(o, T) { return o.y0 - o.v * (pc(T) - o.o) / 1000; }
    function age(y, T) { return (pc(T) - y.o) - y.hAcc - (held === y ? pc(T) - y.hFrom : 0); }
    function lifeTol(y) { return TOL_MS + 0.1 * y.nh; }   // each hold adds two rounded times
    function idx(list, key, id) { for (var a = 0; a < list.length; a++) if (list[a][key] === id) return a; return -1; }
    // T = the time of a frame whose steps (spawn, move, age) are all logged
    // before this event: nothing may be overdue at it.
    function tight(i, T) {
      if (phase !== 'play' || expect) return true;
      for (var a = 0; a < orbs.length; a++) {
        if (orbY(orbs[a], T) < R.ESC_Y - TOL_PX) return bad(i, 'orb ' + orbs[a].k + ' left the top with no escape logged');
      }
      for (var b = 0; b < yels.length; b++) {
        var y = yels[b];
        if (y !== held && age(y, T) >= y.life * 1000 + lifeTol(y)) return bad(i, 'diamond ' + y.j + ' outlived its life');
      }
      if (orbs.length < R.MAX_TARGETS && oFree < T - EPS && T - oLast >= oGap * 1000 + EPS) return bad(i, 'an orb spawn is missing');
      if (yels.length < R.MAX_YELLOWS && yFree < T - EPS && T - yLast >= yGap * 1000 + EPS) return bad(i, 'a diamond spawn is missing');
      return true;
    }
    // A frame event with step d: the previous frame was at g - d, so nothing
    // logged before it may be later than that (or it is this same frame).
    function frame(i, g, d) {
      if (!inRange(d, 0, DT_MAX_MS + EPS)) return bad(i, 'bad frame step');
      if (lastG !== g && lastG > g - d + EPS) return bad(i, 'events fall between this frame and the one before it');
      nFrames += d > 0 ? 1 : 0; if (d >= DT_MAX_MS - 1) nClamped++;
      return true;
    }
    function inBounds(x, y) {
      if (!isNum(x) || !isNum(y)) return false;
      if (Math.abs(x - hold.x0) <= TOL_PX && Math.abs(y - hold.y0) <= TOL_PX) return true;   // never moved
      var hiX = Math.max(R.PLAYER_R, hold.maxW - R.PLAYER_R), hiY = Math.max(R.PLAYER_R, hold.maxH - R.PLAYER_R);
      return x >= R.PLAYER_R - TOL_PX && x <= hiX + TOL_PX && y >= R.PLAYER_R - TOL_PX && y <= hiY + TOL_PX;
    }
    function dropOrb(a, g) { orbs.splice(a, 1); if (orbs.length === R.MAX_TARGETS - 1) oFree = g; }
    function dropYel(b, g) { yels.splice(b, 1); if (yels.length === R.MAX_YELLOWS - 1) yFree = g; }
    function endHold(g) { held.hAcc += pc(g) - held.hFrom; var y = held; held = null; return y; }

    for (var i = 0; i < ev.length && fail === null; i++) {
      var e = ev[i], c = e[0], t = e[1];
      if (phase === 'over') { bad(i, 'event after the run ended'); break; }
      if (pending && c !== 'E') { bad(i, 'the run should have ended here'); break; }

      if (c === 'Z') {
        var w = e[2], h = e[3];
        if (!isInt(w) || w < 0 || w > 900 || h !== R.canvasH(w)) { bad(i, 'bad canvas size'); break; }
        W = w; H = h;
        if (hold) { hold.maxW = Math.max(hold.maxW, W); hold.maxH = Math.max(hold.maxH, H); }
        if (phase === 'play') roundMinW = Math.min(roundMinW, W);
        continue;
      }

      var g = c === 'E' ? e[3] : e[2];
      if (!isNum(g) || g < 0) { bad(i, 'bad game time'); break; }
      if (g < lastG) { bad(i, 'game time goes back'); break; }
      if (g > t + G_AHEAD) { bad(i, 'game time runs ahead of the clock'); break; }

      if (c === 'R') {
        var d = e[3], n = e[4];
        if (paused) { bad(i, 'round started while paused'); break; }
        if (phase === 'pre') {
          if (W < 0 || g !== 0 || d !== 0 || n !== 1) { bad(i, 'bad start'); break; }
        } else if (phase === 'trans') {
          if (!frame(i, g, d)) break;
          if (n !== round + 1) { bad(i, 'wrong round number'); break; }
          if (g - lastCg < R.TRANSITION_S * 1000 - EPS || (g - d) - lastCg >= R.TRANSITION_S * 1000 + EPS) { bad(i, 'transition is not 1 s'); break; }
        } else { bad(i, 'round started during a round'); break; }
        round = n; lives = R.LIVES; R0 = g - d; frozenAt = Infinity; roundMinW = W;
        orbs = []; yels = []; held = null; hold = null;
        phase = 'play'; expect = 'O';
      } else if (c === 'O' || c === 'Y') {
        var d2 = e[3], col = e[4], isO = c === 'O';
        if (phase !== 'play' || paused) { bad(i, 'spawn outside play'); break; }
        if (!frame(i, g, d2)) break;
        if (!isInt(col) || col < 0 || col >= R.COLS) { bad(i, 'bad column'); break; }
        if (expect) {
          if (expect !== c) { bad(i, 'a round starts with one orb then one diamond'); break; }
          if (Math.abs(g - d2 - R0) > EPS) { bad(i, 'first spawns of a round must be in its first frame'); break; }
          expect = isO ? 'Y' : null;
        } else {
          if (!tight(i, g - d2 - EPS)) break;
          if (isO ? g - oLast < oGap * 1000 - EPS : g - yLast < yGap * 1000 - EPS) { bad(i, 'spawned before its gap ran out'); break; }
        }
        var list = isO ? orbs : yels;
        if (list.length >= (isO ? R.MAX_TARGETS : R.MAX_YELLOWS)) { bad(i, 'too many on screen'); break; }
        if (idx(list, 'col', col) >= 0) { bad(i, 'column already taken'); break; }
        if (isO) {
          var p = e[5], m = e[6], og = e[7];
          if ((p !== 0 && p !== 1) || !inRange(m, R.MUL_MIN, R.MUL_MIN + R.MUL_SPAN) || !inRange(og, R.OGAP_MIN, R.OGAP_MIN + R.OGAP_SPAN)) { bad(i, 'orb draw out of range'); break; }
          // The game picks the column uniformly among the free ones. "Easy" =
          // a free column that will carry the orb through a resting diamond.
          var nFree = 0, nEasy = 0, easy = false;
          for (var cc = 0; cc < R.COLS; cc++) {
            if (idx(orbs, 'col', cc) >= 0) continue;
            nFree++;
            var cx = R.colX(W, cc), ez = false;
            for (var yb = 0; yb < yels.length; yb++) {
              var yz = yels[yb];
              if (yz !== held && !yz.lost && Math.abs(yz.x - cx) < R.DROP_R) { ez = true; break; }
            }
            if (ez) { nEasy++; if (cc === col) easy = true; }
          }
          if (nEasy > 0 && nEasy < nFree) { colP.push(nEasy / nFree); if (easy) colHit++; }
          orbs.push({ k: nOrb++, col: col, x: R.colX(W, col), y0: R.spawnY(H), v: R.orbSpeed(round, comp) * m, o: g - d2, p: p === 1 });
          oLast = g; oGap = og; oFree = orbs.length < R.MAX_TARGETS ? g : Infinity;
          nOrbs++; if (p === 1) nPur++; muls.push((m - R.MUL_MIN) / R.MUL_SPAN); ogaps.push((og - R.OGAP_MIN) / R.OGAP_SPAN);
        } else {
          var yy = e[5], lf = e[6], yg = e[7];
          if (!inRange(yy, R.YEL_MARGIN - 0.05, H - R.YEL_MARGIN + 0.05) || !inRange(lf, R.LIFE_MIN, R.LIFE_MIN + R.LIFE_SPAN) || !inRange(yg, R.YGAP_MIN, R.YGAP_MIN + R.YGAP_SPAN)) { bad(i, 'diamond draw out of range'); break; }
          yels.push({ j: nYel++, col: col, x: R.colX(W, col), y: yy, life: lf, o: g - d2, hAcc: 0, hFrom: 0, nh: 0, t: t, grabbed: false });
          yLast = g; yGap = yg; yFree = yels.length < R.MAX_YELLOWS ? g : Infinity;
          lifes.push((lf - R.LIFE_MIN) / R.LIFE_SPAN); ygaps.push((yg - R.YGAP_MIN) / R.YGAP_SPAN);
          if (H > 2 * R.YEL_MARGIN) yfr.push((yy - R.YEL_MARGIN) / (H - 2 * R.YEL_MARGIN));
        }
      } else if (c === 'X') {
        if (phase !== 'play' || paused || expect) { bad(i, 'escape outside play'); break; }
        var a = idx(orbs, 'k', e[3]);
        if (a < 0) { bad(i, 'escape of an orb not on screen'); break; }
        var o = orbs[a];
        if (orbY(o, g) >= R.ESC_Y + TOL_PX) { bad(i, 'orb ' + o.k + ' escaped before reaching the top'); break; }
        dropOrb(a, g);
        if (o.p) { escapes++; lives--; if (lives <= 0) { pending = 'X'; pendingG = g; } }
      } else if (c === 'V') {
        if (phase !== 'play' || paused || expect) { bad(i, 'expiry outside play'); break; }
        var b = idx(yels, 'j', e[3]);
        if (b < 0 || yels[b] === held) { bad(i, 'expiry of a diamond not free on screen'); break; }
        if (age(yels[b], g) < yels[b].life * 1000 - lifeTol(yels[b])) { bad(i, 'diamond expired early'); break; }
        dropYel(b, g);
      } else if (c === 'G') {
        if ((phase !== 'play' && phase !== 'trans') || paused || held) { bad(i, 'grab when the game takes none'); break; }
        if (!tight(i, g)) break;
        var b2 = idx(yels, 'j', e[3]), px = e[4], py = e[5];
        if (b2 < 0 || !isNum(px) || !isNum(py)) { bad(i, 'grab of a diamond not on screen'); break; }
        for (var q = 0; q <= b2; q++) {
          var yq = yels[q];
          // a lost diamond (NaN position in the game) is never in reach
          if (yq.lost) { if (q === b2) bad(i, 'grab of a lost diamond'); continue; }
          var dq = Math.sqrt((px - yq.x) * (px - yq.x) + (py - yq.y) * (py - yq.y));
          if (q < b2 && dq < R.GRAB_R - TOL_PX) { bad(i, 'grab skipped an earlier diamond in reach'); break; }
          if (q === b2 && dq >= R.GRAB_R + TOL_PX) { bad(i, 'grab out of reach'); break; }
        }
        if (fail !== null) break;
        held = yels[b2]; held.hFrom = pc(g); held.nh++;
        hold = { t: t, x0: held.x, y0: held.y, maxW: W, maxH: H };
        if (!held.grabbed) {
          held.grabbed = true; lat.push(t - held.t);
          if (freeT >= 0 && held.t >= freeT && Math.sqrt((px - freeX) * (px - freeX) + (py - freeY) * (py - freeY)) > P.FAR_PX) farLat.push(t - held.t);
        }
        if (phase === 'play' && lastRelT >= 0) regrab.push(t - lastRelT);
      } else if (c === 'L' || c === 'D') {
        if ((phase !== 'play' && phase !== 'trans') || !held) { bad(i, 'release with nothing held'); break; }
        if (!paused && !tight(i, g)) break;
        var x = e[3], y2 = e[4];
        var k = c === 'L' ? e[5] : -1;
        if (c === 'L' && (!isInt(k) || k < -1)) { bad(i, 'bad release outcome'); break; }
        // null: the game's diamond position went NaN (a pointer read off a
        // zero-size canvas, e.g. a finger still moving after the panel was
        // hidden). Such a diamond can never hit, and can never be grabbed
        // again; it stays on screen until it expires. Logged as null.
        if (x === null || y2 === null) {
          if ((x !== null && !isNum(x)) || (y2 !== null && !isNum(y2))) { bad(i, 'diamond outside the canvas'); break; }
          if (k !== -1) { bad(i, 'hit with a lost diamond'); break; }
          var hl = endHold(g); hold = null; hl.lost = true; lostN++;
          freeT = -1;
          if (c === 'D') drops++;
          lastG = g;
          continue;
        }
        if (!inBounds(x, y2)) { bad(i, 'diamond outside the canvas'); break; }
        var hy = endHold(g), h0 = hold; hold = null;
        freeT = t; freeX = x; freeY = y2;
        if (phase === 'play' && !paused && t - h0.t >= P.TAP_HW_MS) holdAll.push(t - h0.t);
        if (c === 'L') {
          // re-judge: the first orb (spawn order) whose centre is in reach
          var hitA = -1;
          for (var a2 = 0; a2 < orbs.length; a2++) {
            var o2 = orbs[a2], dx = x - o2.x, dy = y2 - orbY(o2, g), dd = Math.sqrt(dx * dx + dy * dy);
            if (o2.k === k) { if (dd >= R.DROP_R + TOL_PX) bad(i, 'logged hit on orb ' + k + ' out of reach'); hitA = a2; break; }
            if (dd < R.DROP_R - TOL_PX) { bad(i, k === -1 ? 'logged miss over orb ' + o2.k : 'hit skipped orb ' + o2.k + ' in reach'); break; }
          }
          if (fail !== null) break;
          if (k >= 0 && hitA < 0) { bad(i, 'hit on an orb not on screen'); break; }
          if (hitA >= 0) {
            var oh = orbs[hitA], ohy = orbY(oh, g);
            dropOrb(hitA, g); dropYel(yels.indexOf(hy), g);
            if (!oh.p) { pending = 'D'; pendingG = g; }
            else if (phase === 'play') {
              var off = Math.sqrt((x - oh.x) * (x - oh.x) + (y2 - ohy) * (y2 - ohy));
              offs.push(off); taus.push(off / oh.v * 1000);
              var hm = Math.max(1, t - h0.t), dragPx = Math.sqrt((x - h0.x0) * (x - h0.x0) + (y2 - h0.y0) * (y2 - h0.y0));
              if (dragPx >= P.LONG_DRAG_PX) holds.push(hm);
              speeds.push(dragPx / hm);
            }
          } else { hy.x = x; hy.y = y2; }
          if (phase === 'play' && !paused) { if (lastRelT >= 0) relIv.push(t - lastRelT); lastRelT = t; }
        } else { hy.x = x; hy.y = y2; drops++; }
      } else if (c === 'C') {
        var d3 = e[3];
        if (phase !== 'play' || paused || expect) { bad(i, 'round end outside play'); break; }
        if (!frame(i, g, d3)) break;
        if (!tight(i, g - d3 - EPS)) break;
        if (g - R0 < R.GAME_SECS * 1000 - EPS || (g - d3) - R0 >= R.GAME_SECS * 1000 + EPS) { bad(i, 'round is not 15 s of game time'); break; }
        if (e[4] !== score + 1) { bad(i, 'wrong round count'); break; }
        score++; playMs += g - R0;
        minWDone = Math.min(minWDone, roundMinW); if (roundMinW < P.MIN_FAIR_W) narrow++;
        phase = 'trans'; frozenAt = g - d3; lastCg = g;
      } else if (c === 'P') {
        if ((phase !== 'play' && phase !== 'trans') || paused) { bad(i, 'pause while not running'); break; }
        if (!tight(i, g)) break;
        paused = true; pauseG = g; lastRelT = -1;
      } else if (c === 'U') {
        if (!paused || g !== pauseG) { bad(i, 'resume without a pause'); break; }
        paused = false;
      } else if (c === 'E') {
        if (!pending || e[2] !== pending || g !== pendingG) { bad(i, 'the run ended without cause'); break; }
        pending = null; phase = 'over';
      } else { bad(i, 'unknown event'); break; }
      lastG = g;
    }

    r.stat('rounds', score); r.stat('orbs', nOrbs); r.stat('purple', nPur);
    r.stat('catches', offs.length); r.stat('escapes', escapes); r.stat('drops', drops);
    if (fail !== null) { r.score = 0; return r.invalid(fail); }
    r.score = score;

    if (claimed > score) {
      var capped = ev.length >= Q.LIMITS.MAX_EVENTS || logBytes(ev) > R.LOG_BUDGET;
      if (!ev.length) return r.invalid('claims ' + claimed + ' with no events');
      if (!capped) return r.invalid('claims ' + claimed + ' rounds, the log proves ' + score);
      r.stat('capped', 1);
    }

    // ── does this look like a person ──
    if (offs.length) { r.stat('offMeanPx', S.mean(offs)); r.stat('offMeanMs', S.mean(taus)); }
    if (holds.length) r.stat('holdMed', S.median(holds));
    if (speeds.length) r.stat('dragMed', S.median(speeds));
    if (lat.length) r.stat('grabLatMed', S.median(lat));
    if (nFrames) r.stat('clampedShare', nClamped / nFrames);
    var lastT = ev.length ? ev[ev.length - 1][1] : 0;
    if (lastT > 0) r.stat('gameToWall', lastG / lastT);   // pauses and background-tab stalls lower it

    // how close each person check came (for admins, and the honest-run margins in the test)
    function fastShare(a, f) { var k = 0; for (var i = 0; i < a.length; i++) if (a[i] < f) k++; return a.length ? k / a.length : 0; }
    function clusterShare(a) { if (!a.length) return 0; var m = S.median(a), k = 0; for (var i = 0; i < a.length; i++) if (Math.abs(a[i] - m) <= P.CLUSTER_MS) k++; return k / a.length; }
    r.stat('nCatch', taus.length); r.stat('grabFastShare', fastShare(lat, P.GRAB_FAST_MS)); r.stat('nGrab', lat.length); r.stat('farFastShare', fastShare(farLat, P.FAR_MS)); r.stat('nFar', farLat.length);
    r.stat('longDragFastShare', fastShare(holds, P.HOLD_FAST_MS)); r.stat('nLongDrag', holds.length);
    r.stat('clusterMax', Math.max(relIv.length >= P.CLUSTER_N ? clusterShare(relIv) : 0, holdAll.length >= P.CLUSTER_N ? clusterShare(holdAll) : 0, regrab.length >= P.CLUSTER_N ? clusterShare(regrab) : 0));
    r.stat('sdMin', Math.min(relIv.length >= P.STEADY_N ? S.sd(relIv) : 1e9, holdAll.length >= P.STEADY_N ? S.sd(holdAll) : 1e9, regrab.length >= P.STEADY_N ? S.sd(regrab) : 1e9));
    var why, pMin = 1;
    if (taus.length >= P.ACC_N && S.mean(taus) < P.ACC_MEAN_MS) r.review('drops too accurate (mean ' + S.mean(taus).toFixed(1) + ' ms of orb travel from the centre over ' + taus.length + ' catches)');
    if ((why = Q.tooFast(lat, P.MIN_N, P.GRAB_FAST_MS, P.GRAB_FAST_SHARE))) r.review('grabs: ' + why);
    if ((why = Q.tooFast(farLat, P.FAR_N, P.FAR_MS, P.FAR_SHARE))) r.review('new diamonds far from the pointer: ' + why);
    if ((why = Q.tooFast(holds, P.MIN_N, P.HOLD_FAST_MS, P.HOLD_FAST_SHARE))) r.review('long drags: ' + why);
    if (speeds.length >= P.MIN_N && S.median(speeds) > P.DRAG_PX_MS) r.review('drags too fast (median ' + S.median(speeds).toFixed(1) + ' px/ms)');
    if ((why = Q.tooSteady(relIv, P.STEADY_N, P.STEADY_SD))) r.review('releases: ' + why);
    if ((why = Q.tooSteady(holdAll, P.STEADY_N, P.STEADY_SD))) r.review('hold times: ' + why);
    if ((why = Q.tooSteady(regrab, P.STEADY_N, P.STEADY_SD))) r.review('release to next grab: ' + why);
    var rh = [['releases', relIv], ['hold times', holdAll], ['release to next grab', regrab]];
    for (var zz = 0; zz < rh.length; zz++) if ((why = clustered(rh[zz][1]))) r.review(rh[zz][0] + ': ' + why);
    if (nOrbs >= P.LUCK_N) {
      var pLow = 1 - S.binomUpper(nOrbs, nPur + 1, R.PURPLE_P);
      r.stat('pPurple', pLow); pMin = Math.min(pMin, pLow);
      if ((why = Q.tooLucky(pLow, P.LUCK_P, nPur + ' purple of ' + nOrbs))) r.review(why);
    }
    var draws = [['speed', muls], ['orb gaps', ogaps], ['diamond life', lifes], ['diamond gaps', ygaps], ['diamond height', yfr]];
    for (var z = 0; z < draws.length; z++) {
      if (draws[z][1].length < P.LUCK_N) continue;
      var ks = S.ksUniform(draws[z][1]);
      r.stat('p_' + draws[z][0].replace(' ', '_'), ks.p); pMin = Math.min(pMin, ks.p);
      if ((why = Q.tooLucky(ks.p, P.LUCK_P, draws[z][0]))) r.review(why);
    }
    // columns: the orbs came through a resting diamond more often than the
    // uniform column draw allows (exact Poisson-binomial tail)
    if (colP.length >= P.LUCK_N) {
      var pCol = pbUpper(colP, colHit);
      r.stat('pColumn', pCol); r.stat('nColumn', colP.length); pMin = Math.min(pMin, pCol);
      if ((why = Q.tooLucky(pCol, P.LUCK_P, colHit + ' of ' + colP.length + ' orbs in a column through a resting diamond'))) r.review(why);
    }
    r.stat('drawPMinLog10', pMin > 0 ? Math.log(pMin) / Math.LN10 : -999);
    if (lostN) r.stat('lostDiamonds', lostN);
    if (minWDone < Infinity) r.stat('minW', minWDone);
    if (narrow) r.review('canvas only ' + minWDone + ' px wide in ' + narrow + ' completed round' + (narrow > 1 ? 's' : '') + ' (one diamond reaches several columns)');
    if (nFrames >= P.SLOW_N && nClamped / nFrames >= P.SLOW_SHARE) r.review('game ran in slow motion (' + nClamped + ' of ' + nFrames + ' logged frames at the 50 ms clamp)');
    return r;
  };

  Q.register('thorian-new', R);
})(typeof globalThis !== 'undefined' ? globalThis.QteRules : this.QteRules);

// ==== qte-rules part: dagger-new ====
// ── dagger-new ──────────────────────────────────────────────────────────────
// Spinning bars, fixed marker at 12 o'clock (js/qte.js DAGGER NEW QTE). Types
// 'dagger-new' and 'dagger-new-comp'. The trainer reads every rule it plays by
// from here (zone width, speed, bar count, lives, timer, press limit, phase
// draw, bar positions), so the check and the game cannot drift.
//
// The game runs on its own clock: g = the sum of frame dts, each clamped to
// [0, 50 ms], frozen while paused. Bars move linearly in g, and a press is
// judged against the bars as of the LAST RENDERED FRAME, so the log records g
// (ms, 4 dp) and the check re-judges every press exactly from it.
//
// Log events (t = ms since the run's Start, numbers rounded to 4 dp by run.ev):
//   ['L', t, level, phase, g]  bars spawned for `level` (Start and each level-up)
//        with the drawn phase (rad, already rounded to 4 dp by drawPhase)
//   ['K', t, g, k]             a press as judged (after the 140 ms limiter):
//        k = spawn index of the bar hit, -1 = miss. g = game ms of the frame
//        the press was judged against
//   ['P', t, g] / ['U', t]     panel hidden (paused) / Resume
//   ['E', t, why, g]           the attempt ended: 'T' timer ran out in a frame,
//        'M' on the miss just logged (lives or timer gone)
(function (Q) {
  'use strict';

  var PI = Math.PI, TAU = 2 * Math.PI;

  // ── the rules (read by the IIFE) ──
  var R = {
    NEEDLE: 3 * PI / 2,          // fixed marker at 12 o'clock
    LIVES_MAX: 3,                // casual; comp plays with 1
    LIVES_COMP: 1,
    MIN_PRESS_MS: 140,           // presses closer than this after the last accepted one are dropped
    TIMER_MAX: 10,               // s, reset each level
    HIT_BONUS: 0.3,              // s per hit, capped at TIMER_MAX
    MISS_COST: 3,                // s per miss
    DT_MAX: 0.05,                // per-frame dt clamp, s
    MARGIN: 1.3,                 // spawn margin, in zone half-widths
    BAR_CAP: 11,
    MAX_LEVEL: 12,               // level 12 needs 12 hits but spawns 11 bars: 77 is the ceiling
  };
  R.normalise = function (a) { return ((a % TAU) + TAU) % TAU; };
  R.angDist = function (a, b) { var d = Math.abs(R.normalise(a) - R.normalise(b)); return Math.min(d, TAU - d); };
  R.zoneHalf = function (level) {
    var n = Math.max(level, 1);
    return Math.max(Math.min((Math.PI / n) * 0.5, (32 * Math.PI) / 180), (7 * Math.PI) / 180);
  };
  R.speed = function (level, comp) {
    var b = comp ? 2.4 : 1.7, s = comp ? 0.09 : 0.06;
    return Math.min(b + level * s, comp ? 7.0 : 5.0);
  };
  R.bars = function (level) { return Math.min(level, R.BAR_CAP); };
  R.hitsNeeded = function (level) { return level; };
  R.phaseLo = function (level) { return R.zoneHalf(level) * R.MARGIN; };
  R.phaseHi = function (level) { return TAU / R.bars(level) - R.zoneHalf(level) * R.MARGIN; };
  // Browser side only: u = Math.random(). The phase is rounded to 4 dp INSIDE
  // the range so the logged number is exactly the one the game uses.
  R.drawPhase = function (level, u) {
    var lo = R.phaseLo(level), hi = R.phaseHi(level);
    var p = Math.round((lo + u * (hi - lo)) * 10000) / 10000;
    var pl = Math.ceil(lo * 10000) / 10000, ph = Math.floor(hi * 10000) / 10000;
    return Math.min(Math.max(p, pl), ph);
  };
  // Bar k's angle at spawn, and at lvlT game seconds after it.
  R.barBase = function (level, phase, k) {
    var slot = TAU / R.bars(level);
    return R.normalise(R.normalise(R.NEEDLE - phase) + slot * k);
  };
  R.barAngle = function (base, v, lvlT) { return R.normalise(base + v * lvlT); };

  // ── tolerances (all in the honest player's favour) ──
  var T = {
    ANG_EPS: 0.0001,     // rad: 4-dp g (<1e-6 rad) + float; a press this close to a zone edge may go either way
    PHASE_EPS: 0.000001, // drawPhase keeps the rounded phase inside the range
    TL_EPS: 0.0001,      // s: timer from rounded g vs the game's own float sum
    AHEAD_MS: 150,       // g may not gain on the ACTIVE wall clock (run time minus logged pauses),
                         // cumulative over the run; slack for rAF-stamp skew and coarse timers
    AHEAD_BAD_MS: 1000,  // beyond this: impossible. Between: stop counting
    PAUSE_SLACK_MS: 150, // each pause adds min(its length, this) to both allowances. Never more than
                         // the pause lasted, so g <= whole run time + AHEAD_MS whatever the pauses:
                         // a 0 ms P/U pair buys nothing (it used to open a new 150 ms allowance)
    GAP_MS: 139,         // 140 ms limiter measured on the rounded run clock
    GAP_BAD_MS: 90,      // below this: impossible. Between: stop counting (coarse-timer browsers)
  };

  // ── person checks (review only; far outside real play, see dagger-new.notes.md) ──
  var H = {
    MIN_HITS: 20,        // no person check on fewer hits
    OFF_SD_MS: 2,        // hit offsets (ms from the bar's centre time, as judged): SD under this = drawn, not pressed
    OFF_TIGHT_MS: 1.5,   // ... or this share of hits within 1.5 ms of their median
    OFF_TIGHT_SHARE: 0.7,
    LOCK_MS: 1.0,        // press instant vs the bar's centre instant, hit to hit: change within 1 ms ...
    LOCK_SHARE: 0.75,    // ... for this share of pairs = locked to the bars (a script)
    LOCK_MIN: 24,        // ... over at least this many consecutive-hit pairs
    IV_MIN: 20,          // press intervals inside a level, pooled (degrees of freedom)
    IV_SD_MS: 1.2,       // their spread around each level's mean under this = metronome
                         // (integer ms rounding alone gives ~0.4; the best human tappers ~2% of a 240 ms period = 5)
    // Reaction to new bars (wall ms from a level's spawn to its first press).
    // The 140 ms limiter already makes anything under 139 ms stop counting or
    // invalid (the spawn is logged at the clearing press), so this can only
    // fire on a log that is already capped; kept as the spec's reaction check.
    REACT_MIN: 8,
    REACT_MS: 100,
    REACT_SHARE: 0.5,
    DRAW_MIN: 5,       // phase draws for the KS test
    DRAW_ALPHA: 1e-5,    // tested on every submitted prefix of a run, so kept small
  };

  function num(x) { return typeof x === 'number' && isFinite(x); }
  function isInt(x) { return num(x) && Math.floor(x) === x; }

  function check(log, env) {
    var r = Q.result();
    var ev = log.ev, comp = !!env.comp, S = Q.stats;
    var maxLives = comp ? R.LIVES_COMP : R.LIVES_MAX;

    var level = 0, phase = 0, gS = 0, v = 0, zh = 0, count = 0, bases = [], left = [];
    var hitsLvl = 0, lives = maxLives, tl = R.TIMER_MAX, lastG = 0;
    var score = 0, hits = 0, misses = 0, stopped = null;
    var paused = false, pAt = 0, pausedMs = 0, pauses = 0, slack = 0;
    var lastKt = -1, over = false, needL = false, endMust = false, endMay = false;
    var lvlFirst = true, lvlA0 = 0;
    var offMs = [], lock = [], ivByLvl = [], cur = null, prevKa = -1;
    var draws = [], reacts = [];

    function bad(why, i) { r.invalid(why + ' (event ' + i + ')'); return r; }
    function stop(why, i) { if (!stopped) { stopped = why + ' (event ' + i + ')'; r.stat('stoppedAt', score); r.stat('stopReason', stopped); } }
    // g vs the active wall clock (run time minus logged pauses): the game
    // clock is frozen while paused and otherwise only loses time to the wall
    // (dt >= 0, clamped), so it can never be ahead of it by more than skew.
    // Measured over the whole run, not per play segment: per-segment
    // allowances added up, one per (0 ms) P/U pair a forger inserted.
    function ahead(g, t, i) {
      var lead = g - (t - pausedMs);
      if (lead > T.AHEAD_BAD_MS + slack) return 'game clock ahead of the wall clock by ' + Math.floor(lead) + ' ms';
      if (lead > T.AHEAD_MS + slack) stop('game clock ahead of the wall clock', i);
      return null;
    }
    // Run the timer forward to game ms g; false if it would have run out first.
    function tick(g) { tl -= (g - lastG) / 1000; lastG = g; return tl > -T.TL_EPS; }

    for (var i = 0; i < ev.length; i++) {
      var e = ev[i], c = e[0], t = e[1], g, why;
      if (over) return bad('event after the end', i);
      if (needL && c !== 'L') return bad('level cleared but no new bars', i);
      if (endMust && c !== 'E') return bad('the run was over after that miss', i);
      if (endMay && c !== 'E') endMay = false;

      if (i === 0 && c !== 'L') return bad('the run does not start with its bars', i);

      if (c === 'L') {
        var lv = e[2], ph = e[3]; g = e[4];
        if (e.length !== 5 || !isInt(lv) || !num(ph) || !num(g)) return bad('bad L', i);
        if (i === 0) { if (lv !== 1 || g !== 0) return bad('the run must start at level 1, game time 0', i); }
        else {
          if (!needL || lv !== level + 1) return bad('bars for level ' + lv + ' out of turn', i);
          if (g !== lastG) return bad('new bars at a different game time than the clearing hit', i);
        }
        if (lv > R.MAX_LEVEL) return bad('level ' + lv + ' does not exist', i);
        var lo = R.phaseLo(lv), hi = R.phaseHi(lv);
        if (ph < lo - T.PHASE_EPS || ph > hi + T.PHASE_EPS) return bad('bars spawned outside the allowed gap', i);
        level = lv; phase = ph; gS = g; v = R.speed(lv, comp); zh = R.zoneHalf(lv); count = R.bars(lv);
        bases = []; left = [];
        for (var k = 0; k < count; k++) { bases.push(R.barBase(lv, ph, k)); left.push(true); }
        hitsLvl = 0; tl = R.TIMER_MAX; lastG = g;
        lives = i === 0 ? maxLives : Math.min(lives + 1, maxLives);
        needL = false; lvlFirst = true; lvlA0 = t - pausedMs;
        draws.push((ph - lo) / (hi - lo));
        cur = []; ivByLvl.push(cur); prevKa = -1;
        continue;
      }

      if (c === 'K') {
        g = e[2]; var kk = e[3];
        if (e.length !== 4 || !num(g) || !isInt(kk)) return bad('bad K', i);
        if (paused) return bad('press while paused', i);
        if (g < lastG) return bad('game clock went back', i);
        why = ahead(g, t, i); if (why) return bad(why, i);
        if (lastKt >= 0) {
          var gap = t - lastKt;
          if (gap < T.GAP_BAD_MS) return bad('presses ' + gap + ' ms apart (limit 140)', i);
          if (gap < T.GAP_MS) stop('presses ' + gap + ' ms apart', i);
        }
        if (!tick(g)) return bad('press after the timer ran out', i);
        var lvlT = (g - gS) / 1000, first = -1, firstSure = -1;
        var dk = [];
        for (var j = 0; j < count; j++) {
          if (!left[j]) { dk.push(99); continue; }
          var d = R.angDist(R.barAngle(bases[j], v, lvlT), R.NEEDLE);
          dk.push(d);
          if (firstSure < 0 && d <= zh - T.ANG_EPS) firstSure = j;
        }
        if (kk === -1) {
          if (firstSure >= 0) return bad('miss logged with bar ' + firstSure + ' in the zone', i);
          misses++;
          lives--;
          var raw = tl - R.MISS_COST;
          tl = Math.max(0, raw);
          endMust = lives <= 0 || raw <= -T.TL_EPS;
          endMay = endMust || raw <= T.TL_EPS;
        } else {
          if (kk < 0 || kk >= count) return bad('bar ' + kk + ' does not exist at level ' + level, i);
          if (!left[kk]) return bad('bar ' + kk + ' was already hit', i);
          if (dk[kk] > zh + T.ANG_EPS) return bad('hit logged on bar ' + kk + ' outside the zone', i);
          if (firstSure >= 0 && firstSure < kk) return bad('hit logged on bar ' + kk + ' but bar ' + firstSure + ' was the one in the zone', i);
          left[kk] = false; hitsLvl++; hits++;
          if (!stopped) {
            score++;
            var off = R.barAngle(bases[kk], v, lvlT) - R.NEEDLE;
            if (off < -PI) off += TAU;
            var om = off / v * 1000;
            offMs.push(om);
            // Everything below is on the ACTIVE wall clock (pauses taken out),
            // so a pause does not hide a pair from these checks: a forger's
            // 0 ms P/U after every press used to switch them all off.
            lock.push(om + (t - pausedMs - g));
            if (lvlFirst && level >= 2) reacts.push(t - pausedMs - lvlA0);
          }
          tl = Math.min(tl + R.HIT_BONUS, R.TIMER_MAX);
          if (hitsLvl >= R.hitsNeeded(level)) needL = true;
        }
        if (prevKa >= 0) cur.push(t - pausedMs - prevKa);
        prevKa = t - pausedMs;
        lvlFirst = false;
        lastKt = t;
        continue;
      }

      if (c === 'P') {
        g = e[2];
        if (e.length !== 3 || !num(g)) return bad('bad P', i);
        if (paused) return bad('paused twice', i);
        if (g < lastG) return bad('game clock went back', i);
        why = ahead(g, t, i); if (why) return bad(why, i);
        if (!tick(g)) return bad('paused after the timer ran out', i);
        paused = true; pAt = t; pauses++;
        continue;
      }

      if (c === 'U') {
        if (e.length !== 2) return bad('bad U', i);
        if (!paused) return bad('resumed without a pause', i);
        paused = false; pausedMs += t - pAt; slack += Math.min(t - pAt, T.PAUSE_SLACK_MS);
        continue;
      }

      if (c === 'E') {
        why = e[2]; g = e[3];
        if (e.length !== 4 || !num(g)) return bad('bad E', i);
        if (paused) return bad('ended while paused', i);
        if (g < lastG) return bad('game clock went back', i);
        if (why === 'M') {
          if (!endMay) return bad('ended on a miss that did not end the run', i);
          if (g !== lastG) return bad('miss end at a different game time', i);
        } else if (why === 'T') {
          if (endMust) return bad('the miss ended the run, not the timer', i);
          var a = ahead(g, t, i); if (a) return bad(a, i);
          tick(g);
          if (tl > T.TL_EPS) return bad('timer ended with ' + tl.toFixed(3) + ' s left', i);
          if (tl < -(R.DT_MAX + T.TL_EPS)) return bad('timer ran out more than a frame before the end', i);
        } else return bad('unknown end', i);
        over = true; endMust = endMay = false;
        continue;
      }

      return bad('unknown event ' + c, i);
    }

    r.score = score;
    var claimed = env.claimed | 0;
    if (claimed > score && ev.length < Q.LIMITS.MAX_EVENTS && !stopped) r.invalid('claim ' + claimed + ' above the ' + score + ' hits the log proves');

    // ── stats ──
    r.stat('hits', hits); r.stat('misses', misses); r.stat('level', level); r.stat('pauses', pauses);
    r.stat('ended', over);
    if (log.env && num(log.env.ping)) r.stat('ping', log.env.ping);
    r.stat('offMeanMs', S.mean(offMs)); r.stat('offSdMs', S.sd(offMs));

    // ── person checks ──
    if (offMs.length >= H.MIN_HITS) {
      var why1 = Q.tooAccurate(offMs, H.MIN_HITS, H.OFF_SD_MS, ' ms');
      if (why1) r.review(why1);
      var med = S.median(offMs), tight = 0;
      for (var a1 = 0; a1 < offMs.length; a1++) if (Math.abs(offMs[a1] - med) <= H.OFF_TIGHT_MS) tight++;
      r.stat('offTightShare', tight / offMs.length);
      if (tight / offMs.length >= H.OFF_TIGHT_SHARE) r.review('hits bunched on one spot (' + tight + ' of ' + offMs.length + ' within ' + H.OFF_TIGHT_MS + ' ms)');

      var locked = 0, nl = 0;
      for (var a2 = 1; a2 < lock.length; a2++) {
        nl++;
        if (Math.abs(lock[a2] - lock[a2 - 1]) <= H.LOCK_MS) locked++;
      }
      if (nl) r.stat('lockShare', locked / nl);
      if (nl >= H.LOCK_MIN && locked / nl >= H.LOCK_SHARE) r.review('presses locked to the bars (' + locked + ' of ' + nl + ' within ' + H.LOCK_MS + ' ms)');
    }

    var ss = 0, df = 0;
    for (var b1 = 0; b1 < ivByLvl.length; b1++) {
      var L = ivByLvl[b1];
      if (L.length < 2) continue;
      var m = S.mean(L);
      for (var b2 = 0; b2 < L.length; b2++) ss += (L[b2] - m) * (L[b2] - m);
      df += L.length - 1;
    }
    if (df) r.stat('ivSdMs', Math.sqrt(ss / df));
    if (df >= H.IV_MIN && Math.sqrt(ss / df) < H.IV_SD_MS) r.review('press timing too even (SD ' + Math.sqrt(ss / df).toFixed(1) + ' ms over ' + df + ')');

    if (reacts.length) r.stat('reactMedMs', S.median(reacts));
    var why2 = Q.tooFast(reacts, H.REACT_MIN, H.REACT_MS, H.REACT_SHARE);
    if (why2) r.review(why2);

    if (draws.length >= H.DRAW_MIN) {
      var ks = S.ksUniform(draws);
      r.stat('drawsP', ks.p);
      var why3 = Q.tooLucky(ks.p, H.DRAW_ALPHA, draws.length + ' spawn phases');
      if (why3) r.review(why3);
    }
    return r;
  }

  R.check = check;
  R.T = T;
  R.H = H;
  Q.register('dagger-new', R);
})(typeof globalThis !== 'undefined' ? globalThis.QteRules : this.QteRules);

// ==== qte-rules part: yarthul-new ====
// ── yarthul-new ─────
// Yar'Thul meteor dodge (yarthul-new / yarthul-new-comp; js/qte.js, YARTHUL NEW
// QTE). Meteors fall in a constant stream; A/D (or the mobile arrows) slide the
// flame; one hit ends the run. A point is a stage survived: stage n lasts
// min(5 + (n-1), 20) s of game time, with a 1.5 s banner between stages. The
// trainer reads its geometry and curves from here.
//
// Game time (g) is the run's own clock: the sum of its frames' dt, each clamped
// to 50 ms, so it stops while the tab is hidden and never runs ahead of the wall
// clock. Every g below is in ms, rounded to 0.1 ms. A frame is [g0, g0 + dt]:
// keys, spawns and moves take effect from its start g0; collisions are sampled
// at its end.
//
// The log (t = wall ms since Start, as for every trainer):
//   ['S', t, W, H]             Start: canvas size in px (flame at W/2, g = 0)
//   ['M', t, u1, u2, lag]      a meteor made: u1 = floor(1e4 x the x draw),
//                              u2 = floor(1e4 x the drift draw), lag = 0.1 ms
//                              units from the frame start to the moment the spawn
//                              accumulator reached the meteor (0..500)
//   ['D', t, g0, dir, x]       the keys' direction changed (-1 / 0 / 1), from
//                              the frame starting at g0; x = the flame's x then
//   ['C', t, n, g]             stage n cleared at the end of the frame ending at g
//   ['B', t, n, g0, g1]        the banner ended and stage n began in frame [g0,g1]
//   ['Z', t, g, W, H, x]       the canvas was resized mid-run; x = flame after clamp
//   ['P', t] / ['U', t]        the tab was hidden / shown again (the game freezes)
//   ['E', t, 'hit', g]         a meteor hit the flame at the end of frame g
//   ['E', t, 'abandon']        the player left the page or the panel
//   ['X', t]                   the log is full (size budget); nothing follows it,
//                              and stages after it are not counted
(function (Q) {
  'use strict';

  // ── the rules (read by the trainer) ────────────────────────────────────────
  var K = {
    PLATFORM_TOP_FRAC:   0.80,  // platform surface, as a fraction of H
    PLATFORM_WIDTH_FRAC: 0.62,  // platform span, as a fraction of W
    PLAYER_SPEED_FRAC:   0.42,  // W travelled per second
    PLAYER_H_FRAC:       0.13,  // flame height, as a fraction of H
    PLAYER_HIT_FRAC:     0.60,  // hit radius vs. drawn flame half-width
    METEOR_R_FRAC:       0.034, // meteor head radius, as a fraction of H
    SPAWN_Y_R:           3,     // a meteor starts 3 radii above the canvas
    BASE_STAGE_SECS:     5,     // stage 1 duration
    STAGE_STEP_SECS:     1,     // added per stage
    MAX_STAGE_SECS:      20,    // cap, reached at stage 16
    TRANSITION_SECS:     1.5,   // "Stage N" banner between stages
    DT_CAP:              0.05,  // a frame counts at most 50 ms of game time
    MAX_W:               900,   // canvas width cap
    U_SCALE:             10000, // draws are logged as floor(u * U_SCALE)
    OFF_R:               4,     // a meteor more than 4 radii past a side is dropped
    LOG_BUDGET:          240000, // bytes of events the trainer logs before 'X'
                                 // (the edge function refuses bodies over Q.LIMITS.MAX_BYTES)
  };
  function stageDuration(n) {
    return Math.min(K.BASE_STAGE_SECS + (n - 1) * K.STAGE_STEP_SECS, K.MAX_STAGE_SECS);
  }
  function spawnIntervalMs(n, comp) {
    return comp ? Math.max(70, 150 - 5 * (n - 1)) : Math.max(105, 210 - 7 * (n - 1));
  }
  function fallSpeedFrac(n, comp) {
    return comp ? Math.min(1.10 + 0.06 * (n - 1), 1.90) : Math.min(0.90 + 0.05 * (n - 1), 1.55);
  }
  function driftFrac(comp) { return comp ? 0.22 : 0.18; }
  // Canvas size from its wrapper's clientWidth.
  function canvasW(clientW) { return Math.min(clientW, K.MAX_W); }
  function canvasH(W) { return Math.max(260, Math.min(380, Math.round(W * 0.46))); }

  // Geometry, the same expressions the trainer draws and collides with.
  function platTop(H)   { return H * K.PLATFORM_TOP_FRAC; }
  function platLeft(W)  { return (W - W * K.PLATFORM_WIDTH_FRAC) / 2; }
  function platRight(W) { return platLeft(W) + W * K.PLATFORM_WIDTH_FRAC; }
  function playerY(H)   { var h = H * K.PLAYER_H_FRAC; return platTop(H) - h * 0.45; }
  function playerR(H)   { var h = H * K.PLAYER_H_FRAC; return h * 0.45 * K.PLAYER_HIT_FRAC; }

  // ── tolerances ─────────────────────────────────────────────────────────────
  var FRAME_MS   = K.DT_CAP * 1000; // the longest a frame can count
  var G_TOL      = 0.3;    // ms: g is logged to 0.1 ms; float sums differ by far less
  var START_BACK = 100;    // ms: the first frame after Start can carry a negative dt
                           // (its rAF stamp precedes the click's performance.now())
  var AHEAD_MS   = 250;    // game time may not lead the wall clock by more than this
                           // (rAF stamps vs performance.now, coarse timers, rounding)
  var PX_TOL     = 1;      // px: logged flame x vs the one the keys produce from the
                           // last logged x (honest: <= 0.15 px of rounding)
  var HIT_SHRINK = 1;      // px: overlaps are judged on a radius 1 px smaller
  var HIT_SLACK  = 0.5;    // ms on top of the 50 ms a frame can span
  var Z_AMBIG    = 0.5;    // ms: a frame end this close to a resize may be either canvas's
  var EXIT_MARGIN = 0.5;   // ms: a frame end this close to a meteor's drop may be after it

  // ── person checks (held for review, far outside real play) ─────────────────
  var DRAW_MIN_N = 50, DRAW_ALPHA = 1e-6;       // KS of the x and drift draws
  var DUP_MIN = 10, DUP_FACTOR = 5;             // the same meteor again (reused targets)
  // Meteors aimed at the flame, too few. A submitted score is a personal best,
  // and a run that survived had fewer deadly meteors than average, so a lucky
  // best of a weak player's thousands of runs sits well below the expected
  // count (about 0.6 of it in simulation). Cherry-picking leaves close to none.
  var THREAT_ALPHA = 1e-8, THREAT_MIN_EXP = 8, THREAT_MAX_SHARE = 0.35;
  var REACT_MS = 100;                           // key change < 100 ms after a threat
  var REACT_MIN_N = 10, REACT_MIN_OTHER = 50;   //   vs after any other meteor:
  var REACT_ALPHA = 1e-6, REACT_EXCESS = 0.3;   //   binomial tail and a clear excess
  var STEADY_MIN_N = 20, STEADY_MAX_SD = 4;     // key-change intervals, ms (frame-quantised:
  var STEADY_MAX_CV = 0.12;                     //   a script's period jitters by a frame, so also SD / mean)
  var TAP_MS = 20, TAP_MIN_N = 40, TAP_SHARE = 0.5;  // one-frame key holds
  var TAP_ZERO_MS = 1;                          //   (holds of no game time are not counted)
  // Resizes mid-stage: a resize moves the flame (clamped to the new platform)
  // and drops meteors outside the new canvas, so each one is a free dodge. A
  // player resizes mid-run rarely, and a drag is one burst; several separate
  // bursts in the stages a log proves is held.
  var RESIZE_BURST_GAP = 2000, RESIZE_MAX_BURSTS = 2;
  var SLOW_RATIO = 0.35, SLOW_MIN_STAGES = 3;  // game clock vs wall clock per stage (median):
                                                // 100 ms timers or <20 fps already give 0.5
  var GRAZE_FRAC = 0.1, GRAZE_MIN_N = 20, GRAZE_P0 = 0.3, GRAZE_ALPHA = 1e-6, GRAZE_SHARE = 0.5;
                                                // near misses all within 10% of the radius

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isInt(x) { return isNum(x) && Math.floor(x) === x; }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  // P(S <= k) for S a sum of independent Bernoulli(p[i]). Only + and *.
  function pbLower(p, k) {
    if (k < 0) return 0;
    if (k >= p.length) return 1;
    var f = [1];
    for (var j = 1; j <= k; j++) f.push(0);
    for (var i = 0; i < p.length; i++) {
      var q = p[i];
      for (var c = k; c >= 1; c--) f[c] = f[c] * (1 - q) + f[c - 1] * q;
      f[0] = f[0] * (1 - q);
    }
    var s = 0;
    for (var m = 0; m <= k; m++) s += f[m];
    return s > 1 ? 1 : s;
  }

  // The flame's path: pieces {g, x, dir, W, H}, each from its g until the next.
  function pieceX(p, g) {
    return clamp(p.x + p.dir * K.PLAYER_SPEED_FRAC * p.W * (g - p.g) / 1000, platLeft(p.W), platRight(p.W));
  }

  // One meteor against the flame's path between g = a and g = b (ms), with the
  // flame's centre at height yP: the smallest centre distance (px) and the
  // longest unbroken stretch (ms) with the centres within `rho`. Piecewise: in
  // each piece both move in straight lines, so the squared distance is a
  // quadratic in time.
  function pass(m, pieces, a, b, rho, yP) {
    var out = { minD: Infinity, run: 0 };
    if (!(b > a)) return out;
    var lo = 0, hi = pieces.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (pieces[mid].g <= a) lo = mid; else hi = mid - 1; }
    var runA = -1, runB = -1;
    for (var i = lo; i < pieces.length; i++) {
      var p = pieces[i];
      var pa = Math.max(a, p.g), pb = Math.min(b, i + 1 < pieces.length ? pieces[i + 1].g : b);
      if (pa > b) break;
      if (!(pb > pa)) continue;
      var spd = K.PLAYER_SPEED_FRAC * p.W, L = platLeft(p.W), Rt = platRight(p.W);
      // Split where the flame reaches the platform edge and stops.
      var subs = [];
      if (p.dir === 0 || !(spd > 0)) subs.push([pa, pb, 0]);
      else {
        var bound = p.dir > 0 ? Rt : L;
        var tc = p.g + (bound - p.x) / (p.dir * spd) * 1000;
        if (tc > pa) subs.push([pa, Math.min(pb, tc), p.dir * spd]);
        if (tc < pb) subs.push([Math.max(pa, tc), pb, 0]);
      }
      for (var s = 0; s < subs.length; s++) {
        var sa = subs[s][0], sb = subs[s][1], pv = subs[s][2];
        if (!(sb > sa)) continue;
        var pxa = pieceX(p, sa);
        var mxa = m.x + m.vx * (sa - m.gs) / 1000, mya = m.y0 + m.vy * (sa - m.gs) / 1000;
        var dx0 = mxa - pxa, dy0 = mya - yP, dvx = m.vx - pv, dvy = m.vy;
        var A = dvx * dvx + dvy * dvy, B = 2 * (dx0 * dvx + dy0 * dvy), C0 = dx0 * dx0 + dy0 * dy0;
        var tmax = (sb - sa) / 1000;
        var ts = A > 0 ? clamp(-B / (2 * A), 0, tmax) : 0;
        var d2 = A * ts * ts + B * ts + C0;
        var d = Math.sqrt(Math.max(0, d2));
        if (d < out.minD) out.minD = d;
        if (A > 0) {
          var disc = B * B - 4 * A * (C0 - rho * rho);
          if (disc >= 0) {
            var sq = Math.sqrt(disc);
            var t1 = Math.max(0, (-B - sq) / (2 * A)), t2 = Math.min(tmax, (-B + sq) / (2 * A));
            if (t2 > t1) {
              var ia = sa + t1 * 1000, ib = sa + t2 * 1000;
              if (runB >= 0 && ia <= runB + 1e-6) runB = Math.max(runB, ib);
              else { runA = ia; runB = ib; }
              if (runB - runA > out.run) out.run = runB - runA;
            }
          }
        }
      }
    }
    return out;
  }

  // The game time (ms) at which a meteor, in a canvas W x H, first meets a rule
  // that drops it: reaching the platform surface, or passing 4 radii beyond a
  // side. A frame that ends after that drops it before checking collisions.
  function exitTime(m, W, H) {
    var te = m.gs + (platTop(H) - m.y0) / m.vy * 1000;
    var lo = -m.r * K.OFF_R, hi = W + m.r * K.OFF_R;
    if (m.vx < 0) te = Math.min(te, m.gs + (lo - m.x) / m.vx * 1000);
    else if (m.vx > 0) te = Math.min(te, m.gs + (hi - m.x) / m.vx * 1000);
    return te;
  }
  function inCanvas(m, g, W, H) {
    var x = m.x + m.vx * (g - m.gs) / 1000, y = m.y0 + m.vy * (g - m.gs) / 1000;
    return y < platTop(H) && x >= -m.r * K.OFF_R && x <= W + m.r * K.OFF_R;
  }

  // Wall-clock stretches the tab was hidden with the game frozen: a P..U with
  // no frame's event inside. A frame that ran while "hidden" means the game did
  // not stop, so that stretch is not taken off the wall clock.
  var FRAME_CODES = { M: 1, D: 1, C: 1, B: 1 };
  function frozenPauses(ev) {
    var out = [], pAt = -1, ran = false;
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (e[0] === 'P') { if (pAt < 0) { pAt = e[1]; ran = false; } }
      else if (e[0] === 'U') { if (pAt >= 0) { if (!ran) out.push([pAt, e[1]]); pAt = -1; } }
      else if (pAt >= 0 && (FRAME_CODES[e[0]] || (e[0] === 'E' && e[2] === 'hit'))) ran = true;
    }
    if (pAt >= 0 && !ran && ev.length) out.push([pAt, ev[ev.length - 1][1]]);
    return out;
  }
  function pausedIn(list, t0, t1) {
    var s = 0;
    for (var i = 0; i < list.length; i++) s += Math.max(0, Math.min(list[i][1], t1) - Math.max(list[i][0], t0));
    return s;
  }

  function check(log, env) {
    var r = Q.result(), S = Q.stats, ev = log.ev, comp = !!env.comp;
    var claimed = env.claimed | 0;
    if (!ev.length) {
      if (claimed > 0) r.invalid('a score with no events');
      r.score = 0;
      return r;
    }

    var bad = null, stopped = null;
    function invalid(why) { if (!bad) { bad = why; r.invalid(why); } }
    function stop(why) { if (!stopped) { stopped = why; r.stat('stoppedAt', why); } }

    var W = 0, H = 0, n = 1, phase = 'pre', ended = false, full = false;
    var clockStart = 0, accStart = 0, j = 0, clearedAt = 0;
    var lastG = 0, dir = 0, proven = 0, provenG = 0, provenIdx = -1;
    var pieces = [], meteors = [], stageMeteors = [], dEvents = [];
    // zList: every resize {g, W, H}. samples: the stage's known frame ends, where
    // the game checked collisions: {g, x (flame), zc (resizes before it)}.
    var zList = [], samples = [], zAct = [];
    var grazes = 0, closeN = 0, closeTight = 0, maxRunAll = 0;
    var hitNote = null, stageT0 = 0, speeds = [];
    var frozen = frozenPauses(ev);

    function curPx(g) { return pieceX(pieces[pieces.length - 1], g); }
    function orderOk(g, what, i) {
      var tol = (lastG <= START_BACK && g >= -START_BACK) ? START_BACK : G_TOL;
      if (g < lastG - tol) { invalid(what + ' at event ' + i + ' goes back in game time'); return false; }
      if (g > ev[i][1] + AHEAD_MS) { invalid('game time runs ahead of the clock at event ' + i); return false; }
      if (g > lastG) lastG = g;
      return true;
    }
    function addPiece(g, x, d) {
      var last = pieces[pieces.length - 1];
      if (last && g < last.g) {
        // A negative first frame: continue the new line from the old piece's start.
        x = x + d * K.PLAYER_SPEED_FRAC * W * (last.g - g) / 1000;
        g = last.g;
      }
      if (last && last.g === g) pieces.pop();
      pieces.push({ g: g, x: x, dir: d, W: W, H: H });
    }
    // A known frame end in a stage: every M, D, Z and C carries the game time
    // at which the previous frame ended (and checked collisions). Right after a
    // resize it is unclear which canvas that frame used, so none is taken there.
    function addSample(g, x) {
      var lz = zList.length ? zList[zList.length - 1].g : -Infinity;
      if (g - lz < Z_AMBIG && g - lz > -Z_AMBIG) return;
      samples.push({ g: g, x: x, zc: zList.length });
    }

    // The stage's meteors against the flame's path, canvas by canvas (a resize
    // keeps meteors where they are; the flame's circle and the platform move).
    // A meteor is checkable while no rule has dropped it; once one could have
    // (a frame may have ended in between), it is only 'maybe' still there.
    //  · on the flame for more than a frame (50 ms of game time): a frame ended
    //    in between and would have ended the run;
    //  · on the flame at a known frame end: the same.
    // A certain meteor makes the log invalid; a 'maybe' one stops the count.
    function verifyStage(gc) {
      for (var k = 0; k < stageMeteors.length; k++) {
        var mm = stageMeteors[k];
        var sure = true, segA = mm.gs, gW = mm.W, gH = mm.H, zc = mm.zIdx, best = Infinity;
        for (;;) {
          var segB = zc < zList.length ? Math.min(zList[zc].g, gc) : gc;
          if (segB < segA) segB = segA;
          var tEx = inCanvas(mm, segA, gW, gH) ? exitTime(mm, gW, gH) : segA;
          var R0 = mm.r + playerR(gH), yPm = playerY(gH), rho = R0 - HIT_SHRINK;
          var wA = Math.max(segA, mm.gs + (yPm - 2 * R0 - mm.y0) / mm.vy * 1000), wB = Math.min(segB, tEx);
          if (wB > wA) {
            var ps = pass(mm, pieces, wA, wB, rho, yPm);
            var why = null;
            if (ps.run > FRAME_MS + HIT_SLACK) why = 'meteor at event ' + mm.i + ' sat on the flame for ' + Math.round(ps.run) + ' ms without a hit';
            for (var s = 0; s < samples.length && !why; s++) {
              var sp = samples[s];
              // (not right at the moment a rule drops it: rounding could put it either side)
              if (sp.zc !== zc || sp.g < wA || sp.g > wB || sp.g > tEx - EXIT_MARGIN || sp.g <= mm.gs) continue;
              var sx = mm.x + mm.vx * (sp.g - mm.gs) / 1000 - sp.x, sy = mm.y0 + mm.vy * (sp.g - mm.gs) / 1000 - yPm;
              if (sx * sx + sy * sy < rho * rho) why = 'meteor at event ' + mm.i + ' was on the flame at a frame the game checked (g ' + Math.round(sp.g) + ' ms)';
            }
            if (why) return sure ? { invalid: why } : { stop: why + ', after a resize' };
            if (sure) {
              if (ps.run > maxRunAll) maxRunAll = ps.run;
              var cl = (ps.minD - R0) / R0;
              if (cl < best) best = cl;
            }
          }
          if (tEx <= segB) {
            // Dropped at the next frame end, if one came before the next resize.
            var gone = segB - tEx > FRAME_MS + HIT_SLACK;
            for (var s2 = 0; s2 < samples.length && !gone; s2++) if (samples[s2].zc === zc && samples[s2].g >= tEx && samples[s2].g <= segB) gone = true;
            if (gone) break;
            sure = false;
          }
          if (zc >= zList.length || zList[zc].g >= gc) break;
          gW = zList[zc].W; gH = zList[zc].H; segA = Math.max(segA, zList[zc].g); zc++;
        }
        if (best < 0) grazes++;
        else if (best < 1) { closeN++; if (best < GRAZE_FRAC) closeTight++; }
      }
      return {};
    }

    for (var i = 0; i < ev.length && !bad && !stopped; i++) {
      var e = ev[i], c = e[0], t = e[1];
      if (ended) { invalid('event ' + i + ' after the run ended'); break; }
      if (c !== 'S' && phase === 'pre') { invalid('the log does not open with S'); break; }

      if (c === 'S') {
        if (i !== 0) { invalid('a second S at event ' + i); break; }
        W = e[2]; H = e[3];
        if (!isInt(W) || W < 0 || W > K.MAX_W || H !== canvasH(W)) { invalid('bad canvas size'); break; }
        phase = 'act'; n = 1; clockStart = 0; accStart = 0; j = 0; lastG = 0; stageT0 = t;
        pieces.push({ g: 0, x: W / 2, dir: 0, W: W, H: H });
      } else if (c === 'M') {
        if (phase !== 'act') { invalid('a meteor outside a stage at event ' + i); break; }
        var u1 = e[2], u2 = e[3], lag = e[4];
        if (!isInt(u1) || u1 < 0 || u1 >= K.U_SCALE || !isInt(u2) || u2 < 0 || u2 >= K.U_SCALE) { invalid('meteor ' + i + ' draws out of range'); break; }
        if (!isNum(lag) || lag < -G_TOL * 10 || lag > (FRAME_MS + G_TOL) * 10) { invalid('meteor ' + i + ' spawned off its frame'); break; }
        j++;
        var iv = spawnIntervalMs(n, comp);
        var gs = accStart + j * iv - lag / 10;
        if (!orderOk(gs, 'meteor', i)) break;
        var rM = H * K.METEOR_R_FRAC, vy = fallSpeedFrac(n, comp) * H;
        var ux = (u1 + 0.5) / K.U_SCALE, uv = (u2 + 0.5) / K.U_SCALE;
        var pc = pieces[pieces.length - 1];
        var m = {
          i: i, stage: n, gs: gs, x: ux * W, y0: -rM * K.SPAWN_Y_R, vx: (uv * 2 - 1) * driftFrac(comp) * vy, vy: vy,
          r: rM, W: W, H: H, ux: ux, uv: uv, px: pieceX(pc, gs), dir: pc.dir, zIdx: zList.length,
        };
        stageMeteors.push(m);
        addSample(gs, m.px);
      } else if (c === 'D') {
        if (phase !== 'act' && phase !== 'tr') { invalid('a key change outside the run at event ' + i); break; }
        var gd = e[2], nd = e[3], lx = e[4];
        if (!isNum(gd) || !isNum(lx) || (nd !== -1 && nd !== 0 && nd !== 1)) { invalid('bad key event ' + i); break; }
        if (nd === dir) { invalid('key event ' + i + ' changes nothing'); break; }
        if (!orderOk(gd, 'key change', i)) break;
        var want = curPx(gd);
        if (Math.abs(want - lx) > PX_TOL) { stop('flame position does not follow the keys (event ' + i + ')'); break; }
        if (phase === 'act') addSample(gd, want);
        dir = nd;
        // Continue from the logged x (0.1 px), so rounding never adds up.
        addPiece(gd, lx, nd);
        dEvents.push({ g: gd, dir: nd, stage: n });
      } else if (c === 'Z') {
        if (phase !== 'act' && phase !== 'tr') { invalid('a resize outside the run at event ' + i); break; }
        var gz = e[2], nW = e[3], nH = e[4], zx = e[5];
        if (!isNum(gz) || !isNum(zx) || !isInt(nW) || nW < 0 || nW > K.MAX_W || nH !== canvasH(nW)) { invalid('bad resize ' + i); break; }
        if (!orderOk(gz, 'resize', i)) break;
        var before = curPx(gz);
        // The frame that ended at gz checked collisions in the old canvas.
        if (phase === 'act') { addSample(gz, before); zAct.push(gz); }
        zList.push({ g: gz, W: nW, H: nH });
        W = nW; H = nH;
        // resizeCanvas: `if (!playerX) playerX = W / 2`, then the clamp
        var after = clamp(before ? before : W / 2, platLeft(W), platRight(W));
        if (Math.abs(after - zx) > PX_TOL) { stop('flame position after a resize does not match (event ' + i + ')'); break; }
        addPiece(gz, zx, dir);
      } else if (c === 'X') {
        // The trainer stopped logging: the log reached its size budget.
        full = true; ended = true;
      } else if (c === 'C') {
        if (phase !== 'act' || e[2] !== n) { invalid('stage ' + e[2] + ' cleared out of turn at event ' + i); break; }
        var gc = e[3];
        if (!isNum(gc) || !orderOk(gc, 'stage clear', i)) { if (!bad) invalid('bad stage clear ' + i); break; }
        var dur = stageDuration(n) * 1000;
        if (gc - clockStart < dur - G_TOL || gc - clockStart > dur + FRAME_MS + G_TOL) {
          invalid('stage ' + n + ' cleared after ' + Math.round(gc - clockStart) + ' ms of game time, not ' + dur);
          break;
        }
        var ivc = spawnIntervalMs(n, comp), acc = gc - accStart;
        if (j * ivc > acc + G_TOL || (j + 1) * ivc <= acc - G_TOL) {
          invalid('stage ' + n + ' has ' + j + ' meteors; ' + Math.round(acc) + ' ms at ' + ivc + ' ms makes ' + Math.floor(acc / ivc));
          break;
        }
        // Every meteor of the stage against the flame's path (verify, below).
        addSample(gc, curPx(gc));
        var vr = verifyStage(gc);
        if (vr.invalid) { invalid(vr.invalid); break; }
        if (vr.stop) { stop(vr.stop); break; }
        for (var q = 0; q < stageMeteors.length; q++) meteors.push(stageMeteors[q]);
        stageMeteors = []; samples = [];
        var wallMs = t - stageT0 - pausedIn(frozen, stageT0, t);
        if (wallMs > 0) speeds.push((gc - clockStart) / wallMs);
        proven = n; provenG = gc; provenIdx = i;
        phase = 'tr'; clearedAt = gc; n++;
      } else if (c === 'B') {
        if (phase !== 'tr' || e[2] !== n) { invalid('stage ' + e[2] + ' began out of turn at event ' + i); break; }
        var b0 = e[3], b1 = e[4];
        if (!isNum(b0) || !isNum(b1)) { invalid('bad stage start ' + i); break; }
        if (b0 < clearedAt - G_TOL || b0 - clearedAt >= K.TRANSITION_SECS * 1000 + G_TOL ||
            b1 - clearedAt < K.TRANSITION_SECS * 1000 - G_TOL || b1 - b0 < -G_TOL || b1 - b0 > FRAME_MS + G_TOL) {
          invalid('stage ' + n + ' began ' + Math.round(b1 - clearedAt) + ' ms after the last clear, not ' + K.TRANSITION_SECS * 1000);
          break;
        }
        if (!orderOk(b0, 'stage start', i)) break;
        if (b1 > ev[i][1] + AHEAD_MS) { invalid('game time runs ahead of the clock at event ' + i); break; }
        phase = 'act'; clockStart = b0; accStart = b1; j = 0; stageT0 = t;
      } else if (c === 'P' || c === 'U') {
        // The game freezes while hidden; nothing to judge.
      } else if (c === 'E') {
        var why = e[2];
        if (why === 'hit') {
          var gh = e[3];
          if (phase !== 'act' || !isNum(gh)) { invalid('a hit outside a stage at event ' + i); break; }
          if (!orderOk(gh, 'hit', i)) break;
          // Was a meteor on the flame then? (A note for an admin, not a verdict.)
          var fx = curPx(gh), yP = playerY(H), rP = playerR(H), near = Infinity;
          for (var h2 = 0; h2 < stageMeteors.length; h2++) {
            var mh = stageMeteors[h2];
            if (mh.gs > gh) continue;
            var hx = mh.x + mh.vx * (gh - mh.gs) / 1000, hy = mh.y0 + mh.vy * (gh - mh.gs) / 1000;
            if (hy >= platTop(mh.H)) continue;
            var dd = Math.sqrt((hx - fx) * (hx - fx) + (hy - yP) * (hy - yP)) - (mh.r + rP);
            if (dd < near) near = dd;
          }
          hitNote = near;
        } else if (why !== 'abandon') { invalid('unknown end ' + String(why)); break; }
        ended = true;
      } else {
        invalid('unknown event ' + c);
        break;
      }
    }

    r.score = bad ? 0 : proven;
    r.stat('stages', proven);
    r.stat('meteors', meteors.length);
    r.stat('keyChanges', dEvents.length);
    r.stat('grazes', grazes);
    r.stat('maxOverlapMs', maxRunAll);
    if (hitNote !== null) r.stat('hitGapPx', isFinite(hitNote) ? hitNote : -1);
    if (zList.length) r.stat('resizes', zList.length);
    if (full) r.stat('logFull', true);
    if (provenIdx >= 0) {
      var wall = ev[provenIdx][1];
      r.stat('gameSec', provenG / 1000);
      r.stat('wallSec', wall / 1000);
      r.stat('pausedSec', pausedIn(frozen, 0, wall) / 1000);
    }
    if (bad) return r;

    var capped = full || ev.length >= Q.LIMITS.MAX_EVENTS;
    if (claimed > proven && !stopped && !capped) {
      r.invalid('claims ' + claimed + ' stages; the log proves ' + proven);
      r.score = 0;
      return r;
    }

    // ── person checks, over the stages the log proves ────────────────────────
    var why2;
    // 1) The draws. x and drift are two fresh uniforms per meteor.
    if (meteors.length >= DRAW_MIN_N) {
      var a1 = [], a2 = [];
      for (var d1 = 0; d1 < meteors.length; d1++) { a1.push(meteors[d1].ux); a2.push(meteors[d1].uv); }
      var k1 = S.ksUniform(a1), k2 = S.ksUniform(a2);
      r.stat('drawXp', k1.p.toExponential(2)); r.stat('drawVp', k2.p.toExponential(2));
      if ((why2 = Q.tooLucky(k1.p, DRAW_ALPHA, 'meteor x not uniform'))) r.review(why2);
      if ((why2 = Q.tooLucky(k2.p, DRAW_ALPHA, 'meteor drift not uniform'))) r.review(why2);
    }
    // Meteors reused: the same pair of draws again. Two fresh draws match another
    // meteor's with chance 1e-8, so a run of n meteors expects n^2/2e8 repeats.
    var seen = {}, dupes = 0;
    for (var du = 0; du < meteors.length; du++) {
      var key = Math.floor(meteors[du].ux * K.U_SCALE) * K.U_SCALE + Math.floor(meteors[du].uv * K.U_SCALE);
      if (seen[key]) dupes++; else seen[key] = 1;
    }
    var dupExp = meteors.length * (meteors.length - 1) / 2 / (K.U_SCALE * K.U_SCALE);
    if (dupes) r.stat('repeatedMeteors', dupes);
    if (dupes >= DUP_MIN && dupes > DUP_FACTOR * dupExp) r.review('meteors repeat (' + dupes + ' draws seen before; ' + dupExp.toFixed(2) + ' expected)');

    // 2) Meteors aimed at the flame. With the flame where it was and moving as it
    //    was when a meteor was drawn, that meteor is on course to hit it with a
    //    probability the geometry fixes; far too few of them is cherry-picking.
    var probs = [], threats = 0, tMeteors = [];
    for (var d2i = 0; d2i < meteors.length; d2i++) {
      var mt = meteors[d2i];
      var Rt0 = mt.r + playerR(mt.H), Tt = (playerY(mt.H) - mt.y0) / mt.vy;
      var ext = clamp(mt.px + mt.dir * K.PLAYER_SPEED_FRAC * mt.W * Tt, platLeft(mt.W), platRight(mt.W));
      var cc = ext - mt.vx * Tt;
      var lo = Math.max(0, cc - Rt0), hi = Math.min(mt.W, cc + Rt0);
      var pr = mt.W > 0 ? Math.max(0, hi - lo) / mt.W : 0;
      probs.push(pr);
      mt.threat = Math.abs(mt.x + mt.vx * Tt - ext) < Rt0;
      if (mt.threat) threats++;
      tMeteors.push(mt);
    }
    var expT = 0;
    for (var pi = 0; pi < probs.length; pi++) expT += probs[pi];
    r.stat('threats', threats); r.stat('threatsExpected', expT);
    if (expT >= THREAT_MIN_EXP && threats < expT) {
      var pLow = pbLower(probs, threats);
      r.stat('threatP', pLow.toExponential(2));
      if (threats <= THREAT_MAX_SHARE * expT &&
          (why2 = Q.tooLucky(pLow, THREAT_ALPHA, threats + ' meteors aimed at the flame, ' + expT.toFixed(1) + ' expected'))) r.review(why2);
    }

    // 3) Reactions: how soon after a meteor the keys next change. People need
    //    well over 100 ms to respond to one, so a key change that soon after a
    //    threat is no likelier than after any other meteor, unless a script is
    //    playing.
    var dG = [];
    for (var di = 0; di < dEvents.length; di++) if (dEvents[di].g <= provenG) dG.push(dEvents[di].g);
    function nextD(g) {
      var lo2 = 0, hi2 = dG.length;
      while (lo2 < hi2) { var md = (lo2 + hi2) >> 1; if (dG[md] > g) hi2 = md; else lo2 = md + 1; }
      return lo2 < dG.length ? dG[lo2] - g : Infinity;
    }
    var nT = 0, fT = 0, nN = 0, fN = 0, rts = [];
    for (var ri = 0; ri < tMeteors.length; ri++) {
      var rt = nextD(tMeteors[ri].gs);
      if (!(rt < 2000)) continue;
      if (tMeteors[ri].threat) { nT++; rts.push(rt); if (rt < REACT_MS) fT++; }
      else { nN++; if (rt < REACT_MS) fN++; }
    }
    if (rts.length) r.stat('reactMedianMs', S.median(rts));
    if (nT >= REACT_MIN_N && nN >= REACT_MIN_OTHER) {
      // the chance of a key change that soon after any meteor, taken high (+3 SE)
      var sT = fT / nT, sN = fN / nN, pN = (fN + 1) / (nN + 2);
      var pUp = Math.min(0.999, pN + 3 * Math.sqrt(pN * (1 - pN) / nN));
      var pR = S.binomUpper(nT, fT, pUp);
      r.stat('reactFastThreat', sT); r.stat('reactFastOther', sN); r.stat('reactP', pR.toExponential(2));
      if (pR < REACT_ALPHA && sT - sN >= REACT_EXCESS) r.review('reactions too fast (' + fT + ' of ' + nT + ' aimed meteors answered within ' + REACT_MS + ' ms, vs ' + Math.round(sN * 100) + '% of others)');
    }

    // 4) Key rhythm: a metronome, or holds of a single frame over and over.
    var ints = S.diffs(dG);
    if (ints.length) r.stat('keyIntervalSd', S.sd(ints));
    if ((why2 = Q.tooSteady(ints, STEADY_MIN_N, STEADY_MAX_SD))) r.review(why2);
    else if (ints.length >= STEADY_MIN_N) {
      var mI = S.mean(ints), cv = mI > 0 ? S.sd(ints) / mI : 0;
      r.stat('keyIntervalCv', cv);
      if (cv < STEADY_MAX_CV) r.review('key changes too regular (every ' + Math.round(mI) + ' ms, SD ' + S.sd(ints).toFixed(1) + ' ms over ' + ints.length + ')');
    }
    var holds = [], taps = 0;
    for (var hi3 = 0; hi3 + 1 < dEvents.length; hi3++) {
      if (dEvents[hi3].dir === 0 || dEvents[hi3 + 1].g > provenG) continue;
      var hd = dEvents[hi3 + 1].g - dEvents[hi3].g;
      // A hold of no game time at all: frames of 0 ms (coarse browser timers,
      // where most frames add nothing) - a real tap, not a one-frame pulse.
      if (hd < TAP_ZERO_MS) continue;
      holds.push(hd);
      if (hd < TAP_MS) taps++;
    }
    if (holds.length) { r.stat('holdMedianMs', S.median(holds)); r.stat('oneFrameHolds', taps); }
    if (holds.length >= TAP_MIN_N && taps / holds.length >= TAP_SHARE) {
      r.review('key holds too short (' + taps + ' of ' + holds.length + ' under ' + TAP_MS + ' ms)');
    }

    // 5) Slow motion. A frame counts at most 50 ms, so under 20 fps (or with
    //    100 ms timers) the game really runs slower than the clock, down to about
    //    half speed. Well below that, most of every stage, is a slowed client.
    if (speeds.length) {
      var spMed = S.median(speeds);
      r.stat('speedMedian', spMed);
      if (speeds.length >= SLOW_MIN_STAGES && spMed < SLOW_RATIO) r.review('game ran in slow motion (median ' + Math.round(spMed * 100) + '% of real time over ' + speeds.length + ' stages)');
    }

    // 7) Resizes mid-stage, in separate bursts.
    var bursts = 0, lastZa = -Infinity;
    for (var za = 0; za < zAct.length && zAct[za] <= provenG; za++) {
      if (zAct[za] - lastZa > RESIZE_BURST_GAP) bursts++;
      lastZa = zAct[za];
    }
    if (bursts) r.stat('resizeBursts', bursts);
    if (bursts > RESIZE_MAX_BURSTS) r.review('the canvas was resized mid-stage ' + bursts + ' separate times (each resize moves the flame and drops meteors)');

    // 6) Near misses: a person's dodges scatter; a solver skims every meteor.
    r.stat('closeCalls', closeN); r.stat('closeTight', closeTight);
    if (closeN >= GRAZE_MIN_N && closeTight / closeN >= GRAZE_SHARE) {
      var pg = S.binomUpper(closeN, closeTight, GRAZE_P0);
      if (pg < GRAZE_ALPHA) r.review('dodges too exact (' + closeTight + ' of ' + closeN + ' near misses within ' + Math.round(GRAZE_FRAC * 100) + '% of the radius)');
    }

    return r;
  }

  Q.register('yarthul-new', {
    K: K,
    stageDuration: stageDuration,
    spawnIntervalMs: spawnIntervalMs,
    fallSpeedFrac: fallSpeedFrac,
    driftFrac: driftFrac,
    canvasW: canvasW,
    canvasH: canvasH,
    // for tests and tools
    geom: { platTop: platTop, platLeft: platLeft, platRight: platRight, playerY: playerY, playerR: playerR },
    check: check,
  });
})(typeof globalThis !== 'undefined' ? globalThis.QteRules : this.QteRules);
