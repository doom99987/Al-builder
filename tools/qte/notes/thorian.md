# Thorian (old) — run log and check

Types `thorian` / `thorian-comp`. One point is one round survived. The curves, the canvas layout, the lateral spread, the lives, the 700 ms first-strip and resume delays and the 1600 ms round gap all live in `QteRules.trainers.thorian`. The IIFE reads them from there (`R.speed(streak, runComp)`, `R.geom(sz)` …), so the game and the check always use the same numbers.

## What is logged (t = wall ms since Start, g = round game ms, to 0.1 ms)
| code | fields | where |
|---|---|---|
| `G` | s (rounds won), sz | `beginRound` |
| `H` | side 0/1/2, u (offset draw in hundredths, 0..99), g, dt (this frame's step) | `spawnHeart`, the frame it is made in |
| `B` / `X` / `O` | heart id, g | the heart filter in `gameLoop`: blocked / reached Thorian / off-screen |
| `K` | dir 0/1/2, g (last frame before the key) | `stepBar`, only when the bar actually turns (so key repeats log nothing) |
| `W` | g | `onRoundWin`, logged before the submit |
| `P` / `U` | g / – | `_onThorianQteHide` / Resume |
| `Z` | sz | `resizeCanvas` while a run is open (the panel shown again) |
| `E` | 'dead' / 'reset' / 'restart' | `onGameOver` (then `run.close()`), `resetToStart`, `startGame` |

Keys are logged in the handler, after the ping simulator's delay. So the log records the bar the game really used.

## What check() does
It walks the events with the same state machine as `gameLoop`.
- **Schedule.** A strip may start only at the first frame at or after its countdown (700 ms at the start of a round, then `gapDelay` measured from the strip's last heart, or 700 ms after a Resume). A frame step is at most 50 ms, so that first frame is always less than 50 ms past the countdown. Every strip has exactly `stripLen` hearts, spaced at `interval` (a heart must come in the first frame at or after that). Any logged frame with an overdue heart or strip missing is invalid — including a frame 50 ms or more past a strip's countdown with no heart yet. So hearts cannot be left out (a round of just `G` and `W` is invalid), added, moved earlier or moved later.
- **Physics.** From sz and u, `path()` gives the contact, exit and hit distances along the flight line. The distance flown is v·(g − (g_H − dt)).
  - A `B` needs the bar on that heart's side at that point in the log, and the heart inside its bar window.
  - An `X` needs the heart at or past the hit distance, and no more than one 50 ms frame past it. The bar must not have been on that side while the heart was still in its window.
  - Any heart that has reached Thorian by a frame the log shows must already be resolved.
  - A second `X` in a round must be followed by `E 'dead'`.
- **Clocks.**
  - g never goes backwards and never runs ahead of the wall clock (300 ms of slack).
  - A round's `W` must come at g ≥ R and within one frame of it, and at wall time ≥ R − 300 ms.
  - The next `G` must come at least 1400 ms after the `W`.
  - Pause rules: nothing is logged while paused, and there is no `K` in a pause.
- **Score** = the number of `W`s it walked (`proven`).
  - A claim above the log's `W` count is invalid, unless the log was cut at the event cap. Then the score is simply what the log shows.
  - Counting stops, with no rejection:
    - if the canvas is below 200 px (a 50 ms frame could carry a heart past the centre);
    - if there are more than 5 resizes (hearts in flight at a resize are not judged);
    - if more than 3 pauses in one round held the hearts back. Every Resume restarts the strip countdown at 700 ms, so pausing just before each strip keeps every heart away — the real page allows this, so it is not rejected, but no points are counted from that round on.
- **Person checks → review.** Each timing check is pooled per round, and each needs at least 25 degrees of freedom.
  - SD of (contact − turn) under 8 ms.
  - SD of (turn − the heart's spawn) under 8 ms.
  - SD of (turn − the previous heart's block) under 5 ms. This one uses only pairs inside a strip.
  - SD of where the turn lands between the two arrivals under 0.03. This also uses only pairs inside a strip.
  - Cold reactions: from a strip's first heart to the first turn towards it, counted only after 1 s with no turn. Review if at least 8 samples exist and 70% of them are under 100 ms.
  - Draws: the sides' two-sided binomial, the upper tail of the repeat-side count, and a KS test on the offset draws, each at p < 1e-6.
  - Slow motion: the frame step is capped at 50 ms, so a page held under 20 fps plays slowed down. The median of game ms per wall ms over ≥ 100 ms stretches (frame events only, same round, no pause between) under 0.35 with ≥ 30 stretches is held (≈ under 7 fps for most of the run, e.g. a throttled requestAnimationFrame).
  - The turn's game time comes from the last frame that logged an event, plus the wall time since then. This takes frame quantisation out of the timing SDs, so a bot is caught at 30, 60 and 144 Hz alike.

## Thresholds and why they are safe
Honest simulation: 2200 runs of the real IIFE in a virtual browser, plus 120 pause-stress runs, 40 restart runs and 6 runs cut at a lowered event cap.
- It covered 12–144 Hz, dropped frames, stalls, late timers, rAF stamps earlier than the request, 1 / 16.67 / 100 ms coarse clocks, the browser tab hidden mid-round, ping 0/150/300, touch, casual and comp, pauses mid-round and in the round gap (also right after a frame, many times per round, and double pauses before a frame), resizes, off-screen hearts, fidgeting, returning the bar to a home side, held-key repeats, lapses, restarting inside the 1.9 s game-over pause or mid-run or in the round gap, and runs of up to 31 rounds.
- Result: 0 invalid, 0 review, 0 score mismatch.
- The lowest honest values were: margin SD 40 ms, spawn-delay SD 40 ms, previous-block SD 37 ms, phase SD 0.124, cold-reaction median 271 ms, smallest draw p 1.1e-4, game pace 0.5 (100 ms clocks: the rAF stamps move in 100 ms steps, each a 50 ms frame). Each threshold sits about 5× below these values, at p = 1e-6, or (pace) at 0.35 vs 0.5.
- The cold-reaction test waits for 1 s of no turns and needs a 70% share because a player who wiggles the bar, possibly with ping, can hit a heart's side by chance within 100 ms. At 400 ms / 50% the simulation flagged one honest run.

## Worst-case log size
- Each heart logs about 33 B for `H`, 23 B for `B`/`X`, and about 15 B for turns.
- A top player at maximum difficulty (round ≥ 10) writes about 5.3 KB and 210 events per casual round, and about 6.7 KB and 262 events per comp round.
- The 256 KB body limit is therefore reached at about 42 comp or about 50 casual rounds. The 20 000-event cap is reached at about 80 rounds.
- A player who mashes keys adds about 23 B for each extra turn.

## What it cannot catch
- A bot that reads the targets from the page and turns at a **randomised** point in each window, with human-like reaction times. The correct input is trivially derivable.
- A forger who builds a humanlike log offline from these rules. They still have to wait out the real time, because the server clock checks it.
- It cannot verify isTrusted, the true viewport, or the real frame rate beyond the pace check.
- Hearts in flight at a resize are not judged (at most 5 resizes count).
- Up to 3 strip-delaying pauses per round (≤ 2.1 s of relief per round).

## Open issues
- A long top run can exceed the body limit (see above). The fix is to raise `LIMITS.MAX_BYTES` or gzip the body. Otherwise, from about round 42 in comp, that player's submits are refused by size.
- `js/qte-rules.js` must be loaded before `js/qte.js`. `index.html` does not load it yet.
