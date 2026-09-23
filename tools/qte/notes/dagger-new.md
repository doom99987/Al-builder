# dagger-new / dagger-new-comp: score log and check

## The game in one paragraph
Level L puts min(L, 11) bars on a ring, evenly spaced, spinning at a fixed speed
(casual min(1.7 + 0.06L, 5), comp min(2.4 + 0.09L, 7) rad/s). One Math.random
per level picks the phase of the nearest bar. A press is a hit if a bar is within
the zone (clamp(pi/(2L), 7 deg, 32 deg)) of 12 o'clock, judged on the LAST RENDERED
FRAME. L hits clear the level. Timer 10 s per level, +0.3 s per hit, -3 s per miss.
Lives 3 casual / 1 comp, +1 per level. Presses less than 140 ms after the last one
are dropped. The ceiling is 77 (level 12 needs 12 hits but has 11 bars).

## What is logged (t = ms since Start, g = game ms = sum of clamped frame dts)
| code | fields | where (dagger-new.iife.js) |
|---|---|---|
| `L` | level, phase (rad, 4 dp, the exact value the game uses), g | spawnAllBars, line 112 (Start and every level-up) |
| `K` | g of the judged frame, bar index hit (-1 = miss) | onPress, line 258, after the 140 ms limiter and the ping delay |
| `P` | g | _onDaggerNewQteHide, line 349 |
| `U` | (none) | Resume click, line 338 |
| `E` | 'T' (timer ran out in a frame) or 'M' (the miss just logged), g | onGameOver, line 286 |

The rules (zone, speed, bars, lives, timer, bonus/penalty, dt clamp, limiter,
phase draw, bar positions) live in dagger-new.rules.js and the IIFE reads them
from `QteRules.trainers['dagger-new']`. Bars are placed with the spawn-relative
formula `base + v * (gameT - spawnT)` on both sides, so the check reproduces
the game's judgement exactly (up to 1e-6 rad).

Worst-case size: K <= 77 hits + 14 misses (3 lives + 11 heals), L <= 12, E 1,
plus 2 per pause (each one takes a panel switch and a Resume click). About 106
events + pauses, about 3 KB. Honest sims peaked at 104.

## What check() does
Walks the log once, replaying the game state:
* invalid: first event not L1 at g 0; L out of turn, not at the clearing hit's g,
  level > 12, phase outside [1.3 zh, slot - 1.3 zh]; K on a bar that does not
  exist or was already hit, a hit outside the zone, a hit on a later bar while an
  earlier one was surely in the zone, a miss while a bar was surely in the zone;
  a press after the timer ran out (timer replayed from g); anything after a miss
  that had to end the run; E 'M' after a miss that did not end it; E 'T' with
  time left or more than a frame late; game clock going back; P/U out of order;
  events after E; presses < 90 ms apart; game clock > 1 s ahead of the ACTIVE wall
  clock (run time minus logged pauses, cumulative over the whole run, plus
  min(length, 150 ms) per pause); claim > proven hits (unless the log was capped at
  MAX_EVENTS or a stop happened).
* stop counting (score = hits before it, recorded in stats): presses 90-139 ms apart,
  game clock 150-1000 ms (+ the same per-pause slack) ahead of the active wall
  clock. No honest browser should reach these; they cover coarse or odd timers.
* score = hits counted before any stop. The server posts min(claimed, score).
* review (all need 20+ hits unless noted):
  - hit offsets (ms from the bar's centre, from the logged frame) SD < 2 ms;
  - 70% of offsets within 1.5 ms of their median;
  - presses locked to the bars: (press wall time - bar-centre game time) changes by
    <= 1 ms between consecutive hits in 75% of 24+ pairs;
  - pooled within-level press-interval SD < 1.2 ms over 20+ degrees of freedom (metronome);
  - KS test of the level phases (5+ levels) p < 1e-5 (cherry-picked spawns);
  - reaction (wall ms from new bars to the first hit) under 100 ms for half of 8+
    levels. This cannot fire on its own: the spawn is logged at the clearing press,
    so the 140 ms limiter already stops or invalidates anything that fast.

All the timing checks (lead, lock, intervals, reaction) use the ACTIVE wall
clock and run across pauses. (Review round 2: the first version measured the
lead per play segment and skipped every pair that spanned a pause, so a forged
0 ms P/U pair after each press bought 150 ms of game time per press - 77 points
in 23 s of wall for 32 s of game - and switched the lock and metronome checks
off: a centre-hitting bot or a written metronome came back valid. Tests
"compressed wall clock via 0 ms pauses", "... + 0 ms pause after every press".)

## Why the thresholds are safe
Simulated players: new, mid, good, top, plus an "elite" group beyond the best
rhythm-game players (SD 4-7 ms, strongly autocorrelated error). Frames at 30-240 Hz,
main-thread stalls up to 600 ms (50 ms dt clamp), ping 0/150/300 with setTimeout
lateness, pauses and hidden tabs at any moment, mobile double taps, Space held
down (auto-repeat), short and long runs, casual and comp.
Tails over 8000 elite-only runs (runs with 20+ hits): offset SD min 3.5 ms (threshold 2),
lock share max 0.44 (0.75), interval SD min 2.1 ms (1.2), tight share max 0.46 (0.7).
Top players: offset SD min 5.6, lock share max 0.25, interval SD min 7.
Mixed run of 12000: 0 invalid, 0 mismatches, 1 review (a draws p-value, at the
earlier alpha of 1e-4; now 1e-5).
Bots on a real page sit at lock share 0.85-1.0, offset SD 0-2 ms, interval SD 0.4 ms.

Pause-heavy honest play (4-12 pauses a run, some as short as 250 ms; top/elite/good
players): 6000 runs, 0 invalid, 0 review.

## The real IIFE under Node (dagger-new.test.js section c)
dagger-new.iife.js itself runs in a stub DOM with a virtual clock: rAF with vsync
stamps (20% from before the callback's frame, so before the Start/Resume stamp),
main-thread stalls up to 700 ms, 30-240 Hz, ping 0/150/300 with timer lateness,
coarse timers (16.7 ms and 100 ms), key bounces, panel hide + Resume at random
moments, and a second Start while a run is live (matchmaking). A player reads the
bars from the run's own log. Every submitted snapshot and every final log is
checked: 1500 runs, 29012 logs, 0 invalid, 0 review, 0 score mismatches. The
IIFE loaded without qte-rules.js stops quietly instead of throwing.

## Browser self-check (scratch copy of the site + tools/qte/harness.html)
The real IIFE, driven by dagger-new.bot.js: casual 25 pts (25/25 submits valid),
comp 49 pts (died on a miss, 49/49 valid), casual with ping 150 and a mid-run
panel switch + Resume: 45 pts, 45/45 valid, final log valid. The pane was hidden,
so the scratch harness swapped rAF for a 16 ms timer; the trainer code was unchanged.

## What it cannot catch
The trainer is solvable from the log itself: one phase per level, then linear
motion. A script that writes (or plays) a log with human-sized timing noise
(SD 5-20 ms, not locked to the bars, varying intervals) and honest-looking
phases is indistinguishable from a strong player. It still has to spend the
real time (the SQL clock check), and a score far above the record is held in SQL.
The phases come from the browser's Math.random, so a patched page can choose
them; only extreme choices show up in the KS test. Missing presses (misses left
out of the log) cannot be seen.

## Open issues
* index.html must load js/qte-rules.js before js/qte.js (the IIFE reads
  `QteRules.trainers['dagger-new']` at load; without it the trainer logs an
  error and does not start - it no longer throws, which would also have stopped
  every trainer after it in qte.js). The worktree's index.html does not load it yet.
* The trainer never restarts itself, so log.a is always 0 and run.newAttempt() is not used.
* The client's isSuspectedMacro is kept as it was (it only gates the game-over
  comp submit, which never submits a new high anyway).
