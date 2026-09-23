# axe / axe-comp — run log and check

## What is logged (axe.iife.js, via `run.ev`)
| code | fields | where (axe.iife.js) |
|---|---|---|
| `R` | k (streak before), zoneMin, zoneMax, why `s`/`n` | `startRound` line 151, **before** `roundEndTime` is read |
| `K` | fill **after** the press, src `k`/`t`/`b` | `onSpacePress` line 214, while a round is live (after the ping delay: it is the handler) |
| `G` | – | `onSpacePress` line 214, between rounds (the 700 ms wait). The next round resets the fill it changed |
| `J` | fillPct as compared, hit 1/0 | `evaluateRound` line 161 (judging frame) |
| `E` | `low` / `high` (the miss just judged) | `evaluateRound` line 167 |
| `E` | `x` (reset, or Start clicked over a live run) | `resetToStart` line 231, `startGame` line 242 |
| `P` | – | `_onAxeQteHide` line 309, after the clock is read |
| `U` | – | `resumeGame` line 257, before the clock is read |

`R` and `U` are logged before the round clock is read and `P` after it. So a logged round can only look longer than the real one, including across pauses and under a coarse clock.

Curves and constants live in `QteRules.trainers.axe`: `timer`, `size`, `DRAIN`, `PRESS`, `C_MIN`, `C_SPAN`, `GAP_MS`, `DT_MAX`. The IIFE reads them from there.

## What check() does
- **Order**: a state machine. Phases: none → round → gap → round … → missed → E. A pause in a round returns to the round. A pause in the wait returns to the wait. Anything out of order is **invalid**.
- **Targets**:
  - `k` must equal the proven streak.
  - The zone width must be `size(k, mode)` (±0.00015).
  - The centre must lie in [0.45, 0.80].
  - Each round has exactly one zone.
- **Time**: all of these use unpaused time. Pauses earn no extra allowance.
  - The first `R` must come within 1 s of Start.
  - An `n` round must come at least 700 − 110 ms after the hit.
  - `J` must come at least `timer(k)`×1000 − 110 ms after its round started.
- **The bar**: the fill is frame-integrated, so the check bounds it instead of recomputing it.
  - Between two logged values the fill can lose at most 0.06/s × (active time + 200 ms).
  - It cannot gain. The exception is up to 0.02 once after `R`/`U`, while the last logged value is within 1 s of it. That covers a first frame with negative dt, including one delayed by a long task that a press got ahead of.
  - A press adds exactly 0.09, capped at 1.
- **Judging**: `J` is re-judged from its logged fill and zone. Rounding is monotone, so a hit logs zMin ≤ fill ≤ zMax. `E` low/high must match the fill.
- **Score** is the number of hits. A claim above that is **invalid**, unless the log has hit `MAX_EVENTS`. `run.ev` stops logging at that point, so the score is what the log proves (stat `truncated`).
- **Person checks (review)**:
  - The judged-fill offset from the zone centre, in ms of drain, has SD < 12 ms over ≥ 20 hits.
  - The pooled within-round SD of press intervals in 40–400 ms is < 2 ms over ≥ 30 intervals.
  - The KS test of zone centres gives p < 1e-5 over ≥ 20 rounds.
  - The drain efficiency is < 0.2 over ≥ 30 s of intervals of 2.5 s or less.
- **No reaction-time check.** Nothing in the axe needs a reaction. A round starts a fixed 700 ms after a judgement the player watched. So pressing right at the start is anticipation, and the first press decides nothing. In the sim, honest anticipating players reached a fast share of 0.81, well past the old 0.5 threshold. `firstPressMedMs` stays as a stat.

## Why the thresholds are safe (axe.test.js)
The simulation ran 3000 honest runs: new to top players, casual and comp, ping 0/150/300, 30–144 Hz, frame drops, and negative-dt frames, including ones behind long tasks that presses get ahead of. It also covered busy and hidden-tab stalls, minutes-long alt-tabs, one or two pauses anywhere (some resumed within the 700 ms wait), resets, anticipating players, and coarse clocks (16.7 and 100 ms).

Result: **0 invalid, 0 review, 0 mismatch**. Every mid-run submit also checked out at its own score: the log at each new high, for 1 run in 10 at every high.

| Check | Closest honest run | Threshold |
|---|---|---|
| Offset SD | 66 ms | < 12 ms |
| Press SD | 4.4 ms | < 2 ms |
| Zones p | 1e-3 | < 1e-5 |
| Drain efficiency | 0.94 | < 0.2 |

The hand-built real-player cases all come back valid at full score:
- a press before a janked first frame;
- a pause 100 ms into the wait with Resume 350 ms later;
- a reset while paused between rounds;
- five pauses in one round judged 110 ms early;
- a tab hidden 5 minutes with the bar frozen in the zone;
- a log cut at `MAX_EVENTS` with a higher claim.

## Forgeries (57, all invalid or review)
Every forgery attempt in the test comes back invalid or review.
- **Time compression.**
  - The old check accepted rounds cut to 90% by piling up zero-length pauses, because each pause added 100 ms of slack. That is now **invalid**.
  - So is skipping the 700 ms wait with a P/U in it.
- **The rest:**
  - hand-made minimal logs;
  - reused or cherry-picked zones;
  - zero-error timing and metronome presses;
  - wrong types, NaN/null, huge and negative numbers, extra fields;
  - duplicates, events after the end;
  - a replayed log with a higher claim.

## What it cannot catch
- The client draws the zones, and the zone is visible for the whole round. So a script that writes a legal, human-looking log is **valid**; the test's careful forger shows this. Only the server clock stands in its way. The shortest legal log is 5.5% shorter than real play: 110 ms per round plus 110 ms per wait.
- Under-drain is legal (clamped frames, hidden tab), so a forger may choose any drain from 0 to full. Only the aggregate is watched.
- Short runs get no person checks: under 20 hits, or under 30 press intervals.

## Log size
A round takes about 250–370 bytes: 1 R, 6–12 K, and J, sometimes G/P/U.
- The 256 KB `MAX_BYTES` body limit is reached at about **1000 points** in casual. A very steady player can get that far in about an hour.
- Beyond that the edge function refuses every later submit.
- Every new high re-sends the whole log, so a long run uploads O(n²) bytes: about 128 MB over a 1000-point run.
