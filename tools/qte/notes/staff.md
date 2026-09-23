# staff / staff-comp — verified runs

## What the trainer logs (staff.iife.js)
One log per attempt. The trainer restarts itself 900 ms after a timeout; that
restart is `run.newAttempt()`, so a log's score is the streak of one attempt.
Once the run is an hour old, the restart opens a fresh run instead
(`QteRules.Run.start`, cause 0, attempt 0): the log clock stays far below
`MAX_T` (12 h) and the server's one-hour idle purge never hits a run that is
still cycling (a trainer left running on another page restarts itself forever).

| code | fields | where (staff.iife.js) |
|---|---|---|
| `R` | cause (0 Start / fresh run, 1 after a win, 2 restart after a timeout, 3 Resume), streak, pattern (one KEYS letter per slot), bank (one per tile; tile id = index), leftMs | `newRound` :129, logged **before** the timer is read |
| `L` | tile, from (-1 bank / slot index), dx, dy (grab point, tile sizes from centre, 2 dp) | `pickUp` :311 (bank), :323 (slot); mousedown and touchstart |
| `D` | tile, slot (-1 = nowhere / over a filled slot / pointer left the canvas), ok 1/0, dx, dy (only with a slot) | `dropDrag` :360 (placed, logged after the tile is in the slot), :363 (wrong), :370 (nowhere); mouseleave :376 |
| `P` | — | panel hidden mid-round :432, logged **before** the time left is read |
| `U` | — | Resume :416 (the re-drawn `R` cause 3 follows at once) |
| `X` | — | `alb-scores-reset` :48 |
| `E` | 'time' / 'hide' / 'restart' | `triggerFail` :151 (from the frame loop, or from a drop after the deadline :344) / hide between rounds :440 / Start again :400 |

Submits: `submit()` :44 (called at :184, :190) skips a log past `MAX_T` (a round
paused overnight and resumed): it could not be checked, and a rejection would
also close the run.

Pointer only: the ping simulator delays keys only, so it never touches this trainer.

## What check() does
Re-runs the state machine: round causes and order, streak carried from win/reset,
pattern length and timer from `patternLen`/`timerDur` for the streak and mode,
bank = the pattern's runes, runes from KEYS, the full timer on a new round, the
1000 ms gap after a win, each pick-up from where that tile really is, each drop
of the tile actually held, each drop into an empty slot, offsets inside the tile,
every outcome re-judged (`bank[tile] === pattern[slot]`), a timeout not before its
deadline, attempt `a` not starting before `a × 4.5 s`, and a resumed round's time:
at most the time left at the pause, with a 150 ms clock allowance that is a
budget for the whole round (net over all its resumes). Any break: **invalid**.
The score is the streak the log proves. A round cleared more than 400 ms after
its deadline stops the count there (not invalid).

## Thresholds (review only)
| check | fires when | closest honest value (6 seeds × 2400 sim runs) |
|---|---|---|
| drags too fast | ≥ 25 % of ≥ 20 placements under 50 ms (40 ms mobile), grab to drop; a lift from a slot let go over the same slot (a click) is left out | drag SD ≥ 25.6 ms, medians 130+ ms |
| placements too fast | median time between placements < 180 ms (≥ 20) | 257 ms |
| metronome | SD of drag < 6 ms or of placement gaps < 8 ms (≥ 20) | 25.6 / 43.4 ms |
| too accurate | SD of drop or grab offsets < 0.025 tile (≥ 15) | 0.067 tile |
| round starts | ≥ 85 % of ≥ 20 first grabs under 60 ms | anticipating players reach ~50 % |
| one rune too common | Bonferroni binomial p < 1e-6 (≥ 20 runes) | 3.5e-6 |
| repeated runes | z > 10 (≥ 5 rounds) | 6.0 |
| bank already in slot order | z > 8 (≥ 5 rounds) | 4.3 |
| one rune keeps its slot | exact binomial, Bonferroni over slot×rune cells, p < 1e-7 (≥ 10 rounds of a length) | 1.4e-4 |
| bank keeps a layout | exact Poisson-binomial "tile j holds slot i's rune", Bonferroni over cells, p < 1e-7 (≥ 10 rounds of a length) | 1.4e-4 |
| re-rolls | ≥ 20 pauses and more pauses than cleared rounds (Resume re-draws the round and keeps the time) | pauses − wins ≤ −2 (with a 25 %-of-rounds pauser) |

Honest result: 0 invalid, 0 score mismatches, 0 reviewed runs in each of 6 seeds.

## The real IIFE (suite c of staff.test.js)
staff.iife.js runs in a `vm` context with a stub DOM, timers that fire late,
rAF at 30-144 Hz with dropped frames and stalls, a hidden browser tab (no rAF,
timers throttled), a clock that is exact or coarse (up to 100 ms) and can jump
between two reads (a GC pause), mobile touch with compatibility mouse events,
and a random player: right/wrong/nowhere drops, slot edges, mouseleave, a second
press while holding, lifting placed tiles, hide/show at any moment (mid-drag,
in both gaps), a second show while running, Start again, a mode flip while
Start shows, scores reset, an hour away, and a round paused overnight.
10 × 400 runs (~98k submits): 0 invalid, 0 review, 0 mismatch. The engineer's
original read order (timer before `R`, time left before `P`) gives 12-33
honest invalids per 400 runs in the same harness ("a timeout 44-100 ms before
the timer ran out").

## Log size
About 19 events (~600 bytes) per 9-rune round. A single attempt reaches the 256 KB
`MAX_BYTES` at about 430 rounds and the 20000-event cap at about 1000. Every
timeout starts a new, empty log.

## What it cannot catch
A bot that reads the runes (drawn on screen and logged) and drags with human-like
timing and scatter. The browser picks its own runes, so a modified client can pick
mildly easier rounds: only choices far from random are caught (the draw and
position tests), and Resume re-rolls are capped by the re-roll check.
Also a replay of someone else's log under your own ticket, if the server clock allows it.

## Behaviour changes
- Bug fix: a drop after the round's timer ran out (the tab was hidden, or a frame
  was late) now ends the round as a timeout. Before, a tile held while the tab was
  hidden could clear the round seconds after its timer. In normal play this is
  at most the one frame (~16 ms) between the deadline and the frame that notices it.
- Bug fix: the next-round and restart timers are ignored if the run ended (hidden
  between rounds) or Start was pressed again before they fired. Before, they drew
  a phantom round into the hidden trainer, or re-rolled a freshly started run.
- Bug fix: a tile held when the panel hides goes back to the bank. Before, a
  release on the paused canvas could place it, or even clear the round.
- Length and timer use the mode the run started in (`runComp`).
- `startGame` cancels the old animation frame before it starts a new loop.
- After an hour, an automatic restart opens a fresh run (a new ticket request);
  a log past 12 h is not sent. Neither is visible.
- Invisible reorders: `R` is logged before the timer is read and `P` before the
  time left is read (the timer starts microseconds later); a placement's `D` is
  logged after the tile is in its slot.
