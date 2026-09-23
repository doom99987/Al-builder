# dodge / dodge-comp: notes

## What is logged (dodge.iife.js line numbers)
| code | fields | where |
|---|---|---|
| `G` | trackW (px) | startGame, 211 (right after `Run.start` at 203) |
| `T` | k, yc (fraction of the track), yw (px) | startGame 212 (k=1, yc 0.70), randomiseYellow 54 (after each hit) |
| `L` | k | launchBar 104 |
| `H` | k, whiteX (last frame), flown ms (sum of clamped dt), hit 1/0, ms since the last frame | onSpacePress 159: after the ping simulator's delay, the state the judge used |
| `E` | `'miss'` / `'slow', whiteX, flown` / `'reset'` | 162 / 141 / resetToStart 192 |
| `P` / `U` | none | _onDodgeQteHide 257 / resumeGame 227 |
| `Z` | trackW | _onDodgeQteShow 264 (only when the width changed) |

Submit: `submit(v)` (70) calls `run.submit(v)` from updateHighscore (62/65). A point or the end of a run is judged against the local best of the mode the run was started in (`fromRun`, 169/180). The run closes on a fail or reset. `submit` stops sending new highs 1 minute before the log's 12-hour time limit.

## What check() does
It walks the events as a state machine and invalidates anything a real client cannot write:
- The log must open with G then T(1, 0.70).
- Every target after a hit needs a T straight away, with k = hits + 1, yc in [0.62, 0.80], a step of at least 0.06 from the last centre, and a width that matches `width(k-1, trackW, mode)` exactly (4 dp).
- Every L needs a pending timer: 400 ms after G or U, or 550 ms after a hit. It can't come while paused or with a bar already flying, or more than 150 ms early (250 on a 100 ms clock).
- Every H needs a bar in flight and the current k. Its hit/miss is re-judged from the logged whiteX against the target, with 0.06 px of rounding slack. Game ms flown may not exceed wall ms since launch (minus pauses) by more than 400 ms (550 on a 100 ms clock).
- A miss must be followed by E('miss'). E('slow') needs a bar past the track's end.
- No events after an E. No second G. P/P or U without P is invalid.
- Track widths must be integers in [-124, 800]. A width of 0 or less is legal (a window under 125 px); the bar leaves such a track on its first frame.
- A claim above the logged hits is invalid, unless the log hit the 20000-event cap.

Things a real client could produce in an edge case stop the count instead of rejecting the run (score = hits before that point):
- a launch 50–150 ms early (150–250 on a 100 ms clock)
- flown ms 160–400 ms ahead of the clock (310–550 on a 100 ms clock)
- whiteX ≠ 50 + speed·flown
- a width from the other mode's curve

A 100 ms clock is detected when every event time is a multiple of 100 and at least two are non-zero.

Score = hits counted.

## Clock allowances
Browsers clamp performance.now() and rAF stamps to a quantum q: 1 ms, or 16.7 / 100 ms under fingerprinting protection. Firefox also jitters the clamp, so a clamped time can sit up to q either side of the true one.
- Timers: two logged times can be up to 2q + 1 ms closer than the timer between them. That is 35 ms at q = 16.7. On a 100 ms clock both times are multiples of 100, so a 550 ms gap logs as at least 400 (150 early) and a 400 ms gap as at least 300.
- Flown vs wall: the first frame after a launch carries up to 50 ms from before it, and each side carries 2q, so flown can be up to 50 + 4q + 1 ms ahead (118 at q = 16.7). On a 100 ms clock a frame step is at least 100 ms but counts only 50, so flown runs at half speed: at most 250 ms ahead.

## Review thresholds (all far outside real play)
- **Accuracy:** SD under 2.5 ms over at least 20 hits. The measure is the press moment: bar x on the last frame plus the ms since that frame, relative to the centre of the hit window. Human anticipation-timing SD is at least 5 ms (top rhythm players 5–7 ms, most 10–30). A key fired by a script lands within 1–2 ms.
- **Metronome:** intervals between scoring presses with SD under 3 ms over at least 15. Real intervals vary with the random target position, by tens to hundreds of ms.
- **Targets:** KS of the draws (mapped through the rejection sampler's CDF) with p under 1e-4, over at least 10 draws.
- **Small track:** at least 10 points scored on a track under 100 px (a panel under 224 px, narrower than any phone). It is counted per point, so a transient tiny window does not hold a run.
- **Slow motion:** a median flown/wall ratio under 0.5 over at least 20 flights of 200 ms or more. A frame counts at most 50 ms, so only a page under 10 fps for the whole run, or a script that slows the bar's frames, gets there. This is not judged on a 100 ms clock.

Measured with every new-high prefix checked as well as the final log (a fresh player submits at every point):
- 30000 simulated runs (360292 checks): 0 invalid, 0 score mismatches, 4 held (0.013%): 3 KS, 1 accuracy (the simulated "top" player at 4.3 ms SD).
- 4000 sessions of the real IIFE on a virtual clock (75453 runs, 51735 submits): 0 invalid, 0 short, 0 held.

## Tests (dodge.test.js)
- a) honest simulation (above), a2) hand-built honest edge cases: jittered 100 ms and 16.7 ms clocks, flown 117 ms ahead, a track of 0 or less while paused, Start in a window under 125 px.
- b) 64 forgeries. Each must come back invalid, held, or at half the claim or less.
- d1) the real `dodge.iife.js` on a virtual clock. It runs with rAF frames on a vsync grid (with drops, shared stamps, and stamps from before the request), late timers, clamped and jittered clocks, the ping simulator, and touch. A player presses on what is drawn. Random hides, shows, resizes (including under 125 px), tab clicks mid-run, Start mid-run, mode toggles, score resets, and Resume clicks hit every state. Every submit and every final log must be valid with the exact score.
- d2) behaviour diff: the original lines 971-1210 of js/qte.js and the new IIFE get the same inputs and seeded targets. Every text, colour, button, canvas size, drawn target and bar, and submit (board, score) must match. Only the listed fixes are kept out of these sessions.
- d3) a mode toggle mid-run still submits the run's casual new highs to 'dodge'.
- d4) a run paused for 12 hours never submits a log past the time limit.

## What it cannot catch
- The browser picks the targets itself (Math.random), and the log is self-reported. A forger who re-implements the ~40 lines of rules and adds human-like noise (5–30 ms timing error, realistic launch lateness, uniform draws) writes a log that passes. That forger must still wait out real time, because of the server clock check.
- A bot that plays the real page with human-like noise can't be told apart from a person.
- Frame drops can't be told apart from a forger choosing a slightly short flown time. Only the upper bound (flown ≤ wall + slack) is enforced, and whole-run slow motion is held for review.
- A speed hack that slows performance.now(), rAF and timers together writes a consistent log. Only the server can see it, by comparing the log's length to its own clock at each submit (a lower bound). Today the SQL only checks the upper bound.

## Open issues
- index.html must load js/qte-rules.js (with this section) before js/qte.js. Otherwise the trainer does not start: `if (!R) return`.
- Two original bugs are left as they were, because honest logs still pass:
  - A stale 900 ms resetToStart can end a run that is restarted right away. The log shows E('reset').
  - `_onDodgeQteShow` while a run is going hides the canvas and shows Start.
