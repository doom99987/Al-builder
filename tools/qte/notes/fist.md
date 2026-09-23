# fist / fist-comp: run log and check

## What is logged (fist.iife.js)
Times are ms from the run's Start (run.ev). One log per attempt: each restart after a fail or timeout calls run.newAttempt(). After 10 minutes of run time, a restart takes a fresh run (a new ticket) instead, because the server purges a run an hour after its last submit.

| code | fields | where (fist.iife.js) |
|---|---|---|
| `R` | arrows as a digit string, e.g. `'0312'` (0 up, 1 down, 2 left, 3 right) | startRound, right after buildSequence (213) |
| `K` | d (0-3), h (1 hit / 0 miss), [f] flags: 1 autorepeat, 2 touch, 4 ping-sim copy (`window._albIsPingCopy`) | logKey (267-270), called by the keydown handler (298) and the d-pad touchstart (406) after the started/lockout/paused gate, with the state the judge used |
| `S` | streak | success-flash callback, just before updateHighscore (240), so a submit's log always holds its S |
| `P` | none | _onFistQteHide, mid-round pause (366) |
| `U` | the new arrows | Resume button (341) |
| `E` | `'time'` (140) / `'fail'` (251) / `'hide'` (369) | onTimeout, onFail, a hide-reset during the flash or the gap |

Log budget: `ev()` (56-63) counts an over-estimate of each event's JSON bytes. An attempt whose log would pass `LOG_BUDGET` (240,000 B) stops logging, and its later highs are not submitted (69, 72). The last high sent stands, rather than a request over the server's 256 KB limit being refused whole.

Constants the check depends on now live in `QteRules.trainers.fist`, and the IIFE reads them there: LEN_START 2, LEN_MAX 9, timeLimit(comp, len), TICK 1000, FLASH 300, NEXT 600, RESTART 900, RENEW_RUN_MS, LOG_BUDGET.

## What check() does
- **Clock.** Browsers round performance.now(). Firefox with resistFingerprinting rounds it to 1/60 s and Tor Browser to 100 ms, both with jitter. clockOf() finds the coarsest of 100/50/20/16.67/10 ms that every step between neighbouring times is a whole number of, within 1 ms (+1 ms per 20 s). Timing floors get a tolerance of max(50, 2 ticks + 15) ms. The person checks switch to the tick-aware versions below.
- **Replay of the state machine.** The phases are start, live, paused, failed, flash, gap and over. An attempt starts with R. An R is allowed only at the start, or in the gap at least 600 − tolerance ms after the S. A K is allowed only while live, an S only in flash (at least 300 − tolerance ms after the last key, streak + 1), a P only while live, and a U only while paused. `E fail` needs the wrong key before it. `E time` needs a live round with active time ≥ limit×1000 − 100 − 2 ticks. `E hide` is allowed only in flash or gap. No event may follow an E.
- **Arrows.** Every R and U must hold exactly `len` digits 0-3, where len is 2 at the start, +1 per S, capped at 9.
- **Keys.** The hit/miss is re-judged from the logged arrows. A logged outcome that disagrees makes the log invalid.
- **Late keys.** A key after the limit + 1 s per pause + 1.5 s (+ 2 ticks) only stops the count, with score = the points before it.
- **Claim.** A claim above the log's streak is invalid (unless the log reached MAX_EVENTS). So is a claim with no events.
- **Person checks (review only).**

| check | clock | threshold | closest honest (48k simulated logs) |
|---|---|---|---|
| first-key reaction < 100 ms | fine / tick (floor − 2 ticks) | ≥ 25 % of ≥ 8 | median ≥ 203 ms |
| first-key reaction SD | fine / tick | < 12 ms over ≥ 20 | 28 ms |
| first-key reaction MAD | fine | < 8 ms over ≥ 20 | 22 ms |
| first-key reaction median | fine / tick (− 2 ticks) | < 120 ms over ≥ 20 | 203 ms |
| interval SD (intervals ≥ 40 ms) | fine / tick | < 6 ms over ≥ 30 | 22 ms |
| interval MAD (all intervals) | fine | < 5 ms over ≥ 30 | 19 ms |
| interval median | fine | < 30 ms over ≥ 40 | 72 ms |
| share on one tick (reactions / intervals) | tick | ≥ 70 % of ≥ 30 | 34 % / 42 % |
| intervals inside one tick | tick | ≥ 50 % of ≥ 40 | 2 % |
| reactions inside one tick | coarse | ≥ 50 % of ≥ 8 | 13 % |
| mean reaction (capped 2 s) | coarse | < 120 ms over ≥ 20 | 207 ms |
| intervals inside one tick | coarse | ≥ 80 % of ≥ 40 | 43 % |
| interval SD (all) | coarse | < 6 ms over ≥ 30 | 58 ms |
| direction counts, arrow-to-arrow steps (4 each, two-sided binomial) | all | p < 1e-6 over ≥ 40 draws | false rate ≈ 8e-6 per log |
| arrow strings (6+ arrows) seen before in the attempt | all | ≥ 20 and > 10 × expected + 20 | 2 |
| rounds with the exact intervals (4+) of an earlier round | fine | ≥ 5 | 0 |

- Reactions count from the R, or from the U after a resume, so a pause cannot hide them. A first key flagged as autorepeat is left out only when it repeats the previous key's direction, as a key held through the gap does.
- In the interval samples, an autorepeat flag counts only when the key repeats the previous key's direction.

## Tests (node fist.test.js)
- **Honest simulation.** 3,000 sessions gave 47,949 logs, with 0 invalid, 0 review and 0 score mismatch. The sessions cover:
  - five skill levels
  - touch
  - ping 0/150/300/500
  - pauses and hides
  - keys held through the gap
  - fine, 1 ms, 1/60 s and 100 ms jittered clocks
- **Forgeries.** 65 cases, all caught: 64 are invalid or review, and a log with every round far over its timer scores 0 of 20.
- **The real IIFE in a fake DOM:**
  - a structured player
  - a chaos player on keyboard and on mobile touch that leaves and returns, resumes, clicks Start at random moments and changes the ping sim
  - late timers and a 20 s run renewal
  - a tiny log budget

  Every submit came back valid at its claim, and all ~1,200 whole attempt logs had no invalid and no review.
- **Log budget.** A perfect player on a 3,000 B budget stays under it and keeps submitting valid claims. Once the log is full, the attempt stops submitting.

## What it cannot catch
- A bot that reads the arrows and types them with human-like, varied timing. The targets are visible to the client, and the seed never picks them. A metronome with jitter of about ±8 ms or more also passes; that is the same limit.
- A client that forges its own arrows but keeps the draw statistics fair and the strings fresh.
- Whether a key came from a hand, a touch or a script. The flags come from the client.
- A log is not bound to its run. The same honest log can be replayed under a new ticket, once enough server time has passed. That has to be caught server-side (see open issues).

## Open issues
- `js/qte-rules.js` must load before `js/qte.js`; index.html does not load it yet. The IIFE reads `QteRules.trainers.fist` at load and would throw without it.
- A streak above about 1,000-1,100 in one attempt (about 220 B per 9-arrow point) fills LOG_BUDGET. From then on, the attempt's higher points are not submitted, so the board keeps that value while the local best shows more. A compact K encoding would roughly double the ceiling.
- Replay: the edge function or SQL should refuse a log whose arrow strings (the R/U sequence) were already posted.
- On a 100 ms clock, the timing floors drop to 85 ms (flash) and 385 ms (next round). A forger who writes 100 ms times can compress a log by about 40 %, but still needs the server clock.
- The 10-minute run renewal departs slightly from "newAttempt at every restart". It keeps a long session's ticket fresh.
