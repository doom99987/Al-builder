# hammer / hammer-comp: run log and check

## What is logged (hammer.iife.js)
All times are `run.now()` in the trainer's own handlers, so they are taken after the ping simulator's delay. `run.ev` rounds numbers to 4 dp.

| event | when | fields |
|---|---|---|
| `['R', t, k, zoneMin, zoneMax, why]` | `startRound` (line 128), right after `randomiseZone` | `k` is the streak before the round. `why` is `'s'` for Start, `'n'` for the 700 ms timer after a hit, `'u'` for Resume. Every draw is logged, including the re-rolls from Resume. |
| `['D', t, src]` | `startHold` (line 137): a hold starts, only when holding goes false→true | `src` is `'k'` for Space, `'t'` for canvas touch, `'b'` for the HOLD button. |
| `['X', t, fill, frames, cause, hit]` | `onRelease` (line 160), after its guard | `fill` is the exact `fillPct` the trainer compared. `frames` counts the frames with dt > 0 that built it (`gameLoop`, line 149). `cause` is `k`/`t`/`b`, or `'o'` for overfill. `hit` is 1 or 0. |
| `['E', t, 'early'\|'late']` | line 166, a miss ends the attempt | Logged before `triggerFail`, which then calls `run.close()` (line 183). |
| `['P', t]` / `['U', t]` | `_onHammerQteHide` (line 289) / `resumeGame` (line 215) | |

`QR.Run.start` is called in `startGame` (line 201). `run.submit(v)` is called at lines 50 and 53, with the same local-best gating as before.

The curves, the zone-centre range, the 700 ms gap and the 50 ms dt clamp live in `QteRules.trainers.hammer`, and the IIFE reads them from there. The IIFE records the mode once at Start (`runComp`), so the curves always match the log's type.

## What check() does (hammer.rules.js)
It walks the log through the trainer's state machine: round → hold → release → gap/miss, plus pause → resume → round.

**Invalid** when the log contradicts the rules:
- a field or event code is malformed or unknown;
- the first event is not a Start round at t ≤ 1 s;
- a round's streak differs from the hits the log proves;
- the zone size is not `size(k, mode)`, or the centre is outside [0.45, 0.80];
- a `'u'` round comes more than 250 ms after `U`, or without one;
- a `'n'` round comes before Start, while paused, or between U and its round;
- a press comes with no round waiting, or a release with no hold;
- a hit falls outside the logged zone, or a miss inside it (an exact edge tie from rounding is allowed);
- the fill is above 1, an overfill does not reach 1, or a full bar is marked as a hit;
- the fill is more than the hold could make: `fill > speed·(hold + 200 ms)`;
- the fill is more than the frames could make: `fill > speed·0.05·frames`;
- the frame count is above hold ms + 60;
- the E reason contradicts the release, or a miss is not followed by E;
- events come after E, or P/U are out of order;
- the claim is above the proven points (unless counting stopped).

There is no lower bound on fill. The first frame after Start or Resume has dt = stamp − lastTime, which is not clamped and is negative for as long as the click's task held the frame. A negative fill is always an early miss.

**Stop counting, not invalid** (a real client can do these):
- a `'n'` round with no pending hit timer. A stray timer from the previous run is allowed up to 3 times in the first 2 s; after that, counting stops. Stray timers happen when the Hammer tab is re-clicked mid-run, which shows the Start button, and Start is pressed within the gap.
- a log cut at MAX_EVENTS.

**Score** = the hits proven before any stop point. The server posts `min(claimed, score)`.

**Stats for an admin:** hits, rounds, abandoned, pauses, ping, strayRounds, stoppedAt, offset mean/SD (ms of fill from the zone centre), median hold, press latency median/SD/fast share, frame ms, lattice ratio, zone KS p for hits (`zonesP`) and all rounds (`allZonesP`), and for zones given up by pausing (`gaveUp`, `gaveUpP`). The p-values are stored as strings, because `r.stat` would round a small p to 0.

## Timing tolerances, and why
Privacy settings (Firefox resistFingerprinting, Tor) clamp `performance.now()` and rAF stamps to 16.67 or 100 ms. Firefox also jitters the rounding point, so any logged interval can read up to two clamp steps short. The tolerances cover a 100 ms clock where it matters.

| tolerance | value | why | closest honest (sim, 4 seeds × 18000 runs) |
|---|---|---|---|
| FILL_SLACK | 200 ms | When a press is handled at the end of a long task, the next frame has a stale vsync stamp. That frame adds its whole dt (≤ 50 ms clamp), and the next frame's jump, clamped to 50 ms, mostly comes from before the press too. That is up to ~100 ms, plus two steps of a 16.67 ms clock. | 99.9 ms |
| GAP_EARLY | 250 ms | A 700 ms timer is never early, but two steps of a 100 ms clock can make it read 200 ms short. | 100 ms |
| RESUME | 250 ms | `U` and its round are logged in the same handler, but a clamp step can fall between them. | 0 ms |
| START | 1000 ms | Start and the first round are synchronous. | |
| EPS / SIZE_EPS | 2e-4 / 1.5e-4 | two 4-dp roundings | |

None of these tolerances lets a log claim a point the rules would not give. They only let a forged log run a little faster than real time, and the server clock bounds a log's total length anyway.

## Review thresholds, and why they are safe
The honest simulation runs 3000 runs per seed by default (18000 in the long checks). It covers:
- skill from new players to top of the board, casual and comp;
- 30–240 Hz, with frame drops, stalls and long tasks (stale rAF stamps, with input handled when the task ends);
- coarse clocks (1, 16.67 and 100 ms, jittered);
- ping 0/150/300, and touch;
- pauses at random moments, up to 20 % of rounds;
- players who hold the key through the gap;
- rhythm players who press on the 700 ms beat, with a timing SD down to 14 ms.

| check | fires when | closest honest | a bot |
|---|---|---|---|
| tooAccurate | offset SD < 3 ms over ≥ 15 hits | 3.8–5.4 ms. Only simulated players with a 4.5 ms timing SD get this close, which is beyond real hands. | perfect bot: 0 |
| lattice | SD of wide-zone hit offsets < 0.33 frame over ≥ 50 hits | ≥ 0.39 | frame-exact bot: 0.27–0.29 |
| tooFast | ≥ 90 % of ≥ 30 presses land < 35 ms after the round starts | ≤ 0.74 | instant presser: 1.0 |
| tooSteady | press-latency SD < 4 ms over ≥ 20 | ≥ 21 ms | metronome: 0 |
| tooLucky (hits) | KS p of hit-zone centres vs uniform < 1e-5 over ≥ 20 hits | Honest p-values are uniform: 1 run held in 72000 | cherry-picking: 1e-12 to 1e-27 |
| tooLucky (given up) | KS p of the zones abandoned by a pause < 1e-5 over ≥ 10 | ≥ 5e-4, with up to 228 pauses in a run | pause to re-roll far zones: ~1e-13 |

**Why tooFast is looser now.** When to press does not depend on the zone, so pressing on the 700 ms rhythm is fair play. The old threshold was 85 % under 60 ms. It held an honest rhythm player: 1 in 3000 runs once the simulation included them. Reaching 90 % under 35 ms needs a self-timed 0.7 s interval with an SD under ~11 ms.

**Why the given-up check is safe.** An honest pause lands on a round with a chance that grows with the round's length. Far zones take longer to charge, at most ~1.7× as long. It would take well over 1000 pauses in one run for that bias to reach the alpha.

**Measured false review:** 1 run held in 72000 honest runs (~275000 mid-run submits checked). It was a hit-zone KS p of 1.2e-6. There were 0 false invalids and 0 score mismatches, across 11 seeds × 3000 runs plus 4 seeds × 18000 runs.

## Worst-case log size
- **Per round:** R + D + X, about 3 events and 90 bytes. So 1000 points is about 3000 events, roughly 90 KB.
- **Pauses:** each adds P + U + R.
- **MAX_EVENTS (20000):** about 6600 rounds. A log cut there stops counting; it is not rejected.
- **MAX_BYTES (256 KB):** reached at about 2900 points, before MAX_EVENTS. That is over an hour of near-perfect play. See open issues.

## What it cannot catch
- A script that reads the zone and releases with human-like jitter, reaction times and zone spread. The forger control in the test is valid, as expected.
- A comp frame-exact bot at 60 Hz: from streak 8 the zone is under 3 frames wide, so the lattice check rarely has 50 wide hits.
- Under-reported fill: only the upper bound is enforced.
- A re-roller with fewer than ~10 re-rolls in a run.
- Anything in a match: submit is a no-op there.

## Open issues
- **Log size.** At about 2900+ points, a log may pass MAX_BYTES (256 KB) before MAX_EVENTS, and the edge function would refuse that body.
- **Stray timer.** A pending 700 ms timer from a previous run can fire into a new run: re-click the Hammer tab mid-run, then press Start within the gap. This is the original bug; it is tolerated, not fixed.
- **No-timer round.** A `'n'` round with no hit timer (after 2 s) stops counting rather than rejecting.
- **Paused match runs.** A run that ends a match paused (the round ended while you were still playing) can later be resumed from the Hammer tab. `QteRules.Run` captured `inMatch` at its Start, so its later new highs are not submitted, and no toast says so. The original submitted them.
- **Missing rules file.** If js/qte-rules.js fails to load, the trainer does not initialise.
