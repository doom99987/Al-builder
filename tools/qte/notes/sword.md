# sword / sword-comp: run log and check

## What is logged (sword.iife.js)
| code | fields | where |
|---|---|---|
| `R` | streak s, canvas.width, bar count n, the n gap draws (px; the last is drawn but unused, as in the original) | startRound, line 105 (also from resumeGame, line 265, when the between-rounds timer fired while paused) |
| `K` | lead bar index, its x in the last drawn frame, round game time gT (ms, sum of clamped dt), hit 1/0 | onSpacePress, line 173, after the ping delay (inside the handler) |
| `E` | `'zone'` (right after a missed K) | line 176 |
| `E` | `'slow'`, bar, x, gT (lead bar ran off the track) | gameLoop, line 156 |
| `P` / `U` | panel hidden (paused) / Resume clicked | lines 302 / 262 |
| `Z` | new canvas.width, when the panel is re-shown mid-run and the width changed | line 314 |

The run starts at line 240 (`QteRules.Run.start('sword' + (comp ? '-comp' : ''))`), after the old run is closed (line 238). New highs call `run.submit(v)` (lines 51, 54), with the local-best gate and the match path unchanged. The run is closed in triggerFail (line 212). Tables, constants, the hit test and the run-off test come from `QteRules.trainers.sword`.

## What check() does
- Replays the state machine: idle, round, pending, missed, ended. Pauses are allowed in a round or while pending. Any event after the end is invalid, and so is anything but `E zone` after a miss.
- `R`: the streak equals the rounds cleared so far. The bar count is the table value for streak, mode and mob. There are exactly n gaps, each in [75, 130]. The canvas width is an integer in 0..900. The round starts at least 800 − 120 ms after the last round was cleared.
- `K`: comes in bar order. x must equal x0_i + v·gT (to 0.05 px), where x0 comes from the logged gaps. Game time may not run more than 200 ms ahead of the unpaused wall time, measured both from the round's `R` and from the round's previous hit. The zone test is re-run on the logged x. A flipped outcome is invalid unless x is within 0.001 px of a zone edge.
- Game time is not required to be positive or to only go forward. Start and Resume set lastTime to performance.now(), and a frame left pending behind a long task carries an older timestamp, so an honest first dt can be hundreds of ms negative. Each press is judged on its own x, so a backwards clock gains nothing.
- `E slow`: the same motion checks, plus the bar must really be past the run-off edge for the current width (after any `Z`).
- Score = rounds cleared. At a canvas under 100 px, counting stops (`stat stopped`).
- Stats: rounds, presses, hits, pauses, resizes, cw, offMean/Sd/MadMs, ivMadMs/ivN, gapsP, clockRatio, coarseClock, platformMismatch.

## Review thresholds (all far outside the simulated human range)
- **ivMad < 2.0 ms over ≥ 20 intervals.** For consecutive hits in a round, the press-to-press time minus the time the gap between the two bars takes to travel. Independent of frame timing. A script pressing at the ideal moments scores 0.85–1.3 ms. The simulated top tier (σ ≈ 5 ms a press, beyond real hands) never went below 3.2 ms in 40,000 runs; long runs by the best players (σ 6–14 ms, up to 400 rounds) never below 7.4 ms.
- **offMad < 1.5 ms over ≥ 30 hits.** The bar's distance from the zone centre, in ms of travel. The frame alone scatters this (MAD about 6 ms at 60 Hz, 2.6 ms at 144 Hz), so it only fires on forged logs that put the bar on the centre.
- **KS test on the gap draws, p < 1e-6 with ≥ 20 draws.** Honest logs fall under 1e-4 about once in 30,000 checks. Cherry-picked gaps give 1e-114, one reused set of gaps 4e-27.
- **Game clock < 60% of wall time.** Median over ≥ 8 rounds of gT / (wall time minus pauses). Catches a slow-motion rAF. Skipped when ≥ 90% of event times are multiples of 100 ms (Tor/resist-fingerprinting clocks, where the game clock honestly runs at about 50%).

## Tests (`node sword.test.js`; `N=40000 NI=4000 NL=600` for the long version)
- a) Mirror simulator, 3,000 runs / 5,562 checks with mid-run prefixes: 0 invalid, 0 review, 0 score mismatch. At N=40,000 (74,412 checks): 0 invalid, 0 review, 0 mismatch (2 checks were held by chance at the old KS alpha of 1e-4).
- a2) Long runs by the best players into max difficulty (up to 400 rounds, 145 KB logs): 0 invalid, 0 review.
- b) 65 forgeries, all invalid, review, or scored far below the claim.
- c) The real IIFE in a fake DOM with a virtual clock. Frames tick on vsync and sometimes run late behind long tasks, timers are late, frames are dropped, clocks are coarse and keys come through the ping sim. The player watches the drawn canvas. Pauses, resizes, the sword tab clicked again mid-run and restarts are all exercised. 800 page loads by default (4,000 in the long version: 35,120 submits and 6,741 whole logs). 0 bad submits, 0 invalid, 0 review, 0 mismatches. Game time was at most 65 ms ahead of the clock, against a 200 ms tolerance.
- c) Targeted scenarios on the real IIFE: a pause across the between-rounds timer, Start inside the 900 ms fail reset, and a Resume handled behind a 500 ms-old pending frame (with a press right after it, and without).

## Worst-case log size
With 4 dp numbers, a run fits in MAX_BYTES (256 KB) for about 690 rounds (desktop comp, about 34 minutes of flawless play), 780 rounds (desktop casual, 41 minutes), 910 rounds (mobile comp) or 1,070 rounds (mobile casual). A player with σ ≤ 20 ms essentially never misses at max desktop casual difficulty, so the best runs can reach this. Later submits of that run are refused by size, and the board keeps the last score that fit.

## What it cannot catch
- A script that adds human-sized noise (σ ≥ 5 ms) to its press times, or writes the whole log with fresh gaps and such noise. The test prints this as a known limit: valid, full score. Only the SQL clock and record checks bound it.
- Slow motion applied to `performance.now` and rAF together. The log is then self-consistent, just stretched.
- Self-reported geometry (canvas width, mob flag). Narrower is harder here, since the zone scales with the track and the gaps do not. The mob flag picks easier tables and is only recorded as a stat against the platform.
