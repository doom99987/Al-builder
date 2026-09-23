# dagger / dagger-comp: run log and check

## What is logged (dagger.iife.js)
t = ms since Start (Run.ev). Line numbers are in dagger.iife.js; add 1211 for js/qte.js once spliced.
- `['R', t, s, g0..g(n-1)]` in startRound (l.119). s = streak. One start angle per ring (rad, 4 dp), signed by direction (+ clockwise, - counter-clockwise). n = ringCount(s).
- `['K', t, i, G, hit, src]` in onSpacePress (l.220). Only presses that are judged are logged; presses ignored during the zoom-in, between rounds or while paused are not. i = the active ring. G = the round's game time in ms (sum of the clamped frame dts, 2 dp) that the judged angle comes from. hit is 1 or 0. src is k (key), r (key repeat), p/q (a key/repeat delivered late by the ping simulator, via window._albIsPingCopy), t (touch) or c (tap-button click).
- `['E', t, 'miss'|'time']` in triggerFail (l.259), before the final updateHighscore. The run is closed at l.261.
- `['P', t]` in _onDaggerQteHide (l.348). `['U', t]` in resumeGame (l.310).
- Run.start at Start (l.292, after closing the previous run at l.290). submit(v) (l.74) is called from updateHighscore (l.82/85). The local-best gating is the same as before and uses the run's mode while the run is open. There is no submit once the run is closed or past QteRules.LIMITS.MAX_T. In a match there is no submit (the match path is unchanged).

Angles are now `start + vel*G/1000` (R.angle), both for drawing and for the hit test (R.judge), with G rounded as logged. check() re-judges every press bit for bit from the logged numbers.

## What check() does
It walks the events as a state machine, in one pass (pause time is kept as a running total, so a 20000-event log checks in a few ms).

INVALID: the log cannot come from the client.
- The first event is not R.
- An R comes while a round is in play, while paused, with a streak other than the rounds cleared, or with a ring count other than ringCount(s).
- A start angle |g| is outside [startGap(0), startGap(1)] or not at 4 dp.
- An R comes less than 550 ms after the last clear, or less than 150 ms after a Resume in the gap.
- A K comes outside a round, while paused, or on a ring that is not active.
- A K has a length other than 6, or a malformed G, hit or src (src must be an own key of {k,r,t,c,p,q}).
- A K comes less than 100 ms after the previous pass in the round.
- G is more than 1000 ms ahead of the unpaused clock, or more than 1000 ms past the deadline's game time.
- The re-judge disagrees with the logged hit (a 1e-9 rad edge band accepts either).
- An E 'miss' has no missed K before it, an E 'time' comes outside a round or while paused, or an event follows the E.
- A P, U or E has extra fields, or a P or U is out of place.
- A claim is above the rounds cleared, unless counting was stopped or the log reached MAX_EVENTS.

STOP COUNTING (score = rounds proven before this point; the verdict stays valid; stats.stopReason):
- A pass 100-170 ms after the previous one.
- G 300-1000 ms ahead of the clock.
- G more than 150 ms below the last pass with no Start or Resume since it, or more than 1000 ms below with one.
- A press after the deadline whose G is 300-1000 ms past the deadline's game time.
- Two passes in a row after the deadline with no pause between them.

## Clock tolerances (why an honest log never trips them)
- Chrome and Safari: performance.now() is precise. The rAF timestamp is the frame's start (behind), or at most one vsync ahead (Safari).
- Firefox with resistFingerprinting, LibreWolf and Tor coarsen performance.now() (and maybe rAF) to 16.67 or 100 ms. The value is rounded to a multiple at a jittered midpoint, so a reading can be up to 100 ms off in either direction.
- Lockout: the zoom-in ends on a frame stamped at least 220 ms after its start. With ahead stamps the logged gap is >= ~170. With a 100 ms clock and exact rAF it is > 120 (a multiple of 100, so >= 200). The invalid floor is 100.
- Round gap: 800 ms timer. Two readings each 100 ms off, plus a timer 1 ms early, give >= ~600. The floor is 550 (and 150 for the 400 ms Resume timer). The old floors, 790 and 390, rejected coarse-clock players (37 of 2400 simulated runs).
- G ahead: the first dt after R (up to 50), plus an ahead stamp, plus two readings 100 ms off, gives about 270. Stop at 300.
- None of these rules protects a score: G is the player's own to lag, so a forger gains nothing from the slack.

## Person checks (review)
- tooAccurate: SD of clockwise-hit offsets from the gap centre, in ms of game time. Review when it is under 4 ms over 20+ hits, or under 5 ms over 40+. The earlier single rule (under 5 over 20+) held 1.07% of simulated elite players (true spread 7-9 ms at 144/240 Hz): a 20-sample SD scatters. It also tripped the 8 ms bot. The new rule holds 0.10% of those elite runs (3 of 3000) and 0 of 400 bot runs. Naive bots are still caught: 1.9 ms at 144 Hz (n>=20), 4.9 ms at 60 Hz (n>=40).
- tooSteady: SD of in-round press intervals under 3 ms over 20+.
- tooFast: in rounds whose first ring is counter-clockwise, the time from R to the press. Review when half or more of 6+ reactions are under 120 ms. A round with a pause of 150 ms or more before its first press is excused. A shorter pause is not (a real pause takes three clicks), so 0 ms P/U pairs cannot hide a bot. The check is skipped when the log's times sit on a 10 or 16.67 ms grid (a coarse clock can read 200 ms as 100). The grid is recorded as stats.coarseClock.
- tooLucky: counter-clockwise share (binomial upper tail) or start-angle KS, under 1e-6 over 20+ rings.

## Test (node dagger.test.js [runs]; env BOT_RUNS, ELITE_RUNS)
- Honest: 2400 runs by default. A state-machine copy of the IIFE on an event queue:
  - 30/60/120/144 Hz, dropped frames, stalls, ahead-stamped frames, and a negative first dt.
  - Coarse clocks for 1 run in 8: 1, 16.67 or 100 ms, Firefox-style jitter, with exact or coarse rAF.
  - Ping (with the p/q sources), wait, mash and hold styles, and mobile double fire.
  - Pauses anywhere, casual and comp.
  - Results: 2400 runs, 0 invalid, 0 review, 0 mismatches. At 20000: 0 invalid, 1 review (0.005%, a CCW draw at p=3.8e-7), 0 mismatches.
- Elite: 600 runs by default, true spread 7-9 ms at 144/240 Hz, every submission checked. 0 held (3000 runs: 0.10%).
- Forgeries: 53, all invalid, held, or scored far below the claim. They include wrong field types, NaN strings, huge and negative numbers, duplicate presses and rounds, skipped rounds, unresumed pauses, one start angle reused, fast reactions behind 0 ms pauses, and padding to MAX_EVENTS (claim 500, scored 12). A worst-case 20000-event log checks in a few ms.
- Edge cases: 26 fixed logs pin each tolerance on both sides.
- Scenarios: the real IIFE in a vm, driven step by step:
  - Start clicked in the between-round gap (the old IIFE logged a second R in the new run: invalid).
  - The mode toggled mid-run.
  - Ping copies logged as p/q.
  - No submit past MAX_T.
  - Missing rules (the old IIFE threw, which stops every trainer after it in qte.js).
  - 40 random pause-anywhere runs.
  All pass. The first five fail on the old IIFE.
- Real IIFE, 60 runs, and bot, 24 runs (400 under stress): the vm's Math.random is seeded so a failure replays. 0 bad.

## Log size
Per round: at most 1 R + 9 K, plus pauses, about 360 bytes for a 9-ring round. The largest honest log was 150 rounds (the test's cap), 45 KB. The 256 KB body limit is reached at about 700 rounds, and MAX_EVENTS at about 2000.

## What it cannot catch
- A forger who writes human-like timing gets a valid log: offsets with an SD of 10 ms or more, reactions around 250 ms, and fair draws. The browser picks the targets, and the log does not depend on the seed. This is the design limit.
- Nothing ties a log to its ticket's run beyond the server clock check. An honest log (one's own or someone else's) can be replayed under a new ticket.
- G may lag the clock without limit, because slow devices really do lag. The accuracy and steadiness checks still apply, and lag is in the stats (lagMed, lagMax).
- Counter-clockwise rings carry no timing information beyond order and lockout.
