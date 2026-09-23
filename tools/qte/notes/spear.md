# spear / spear-comp: verified runs

## What is logged (spear.iife.js)
| code | fields | where |
|---|---|---|
| `G` | W, H (canvas.width/height) | startGame after resizeCanvas; `_onSpearQteShow` when the size changed while the run is live (running or paused) |
| `S` | sp (rAF frame time − run.t0, 0.1 ms), x, y (0.1 px, the circle's real stored position), d (approach ms), nf (failed placements since the last spawn) | spawnCircle, right after the circle is pushed |
| `K` | i (index in the live list), mx, my (0.1 px), el (ms since spawn, pauses out, 0.1 ms), h (1 hit / 0 early) | handleSpearHit, the moment a click is judged against the circle that took it |
| `E` | `'early'` (right after the K with h 0) / `'slow'`, i, el of the closed circle | handleSpearHit / gameLoop expiry |
| `P` / `U` | – / pf (the shift applied, 0.01 ms steps) | `_onSpearQteHide` mid-run / resumeGame |

Clicks that hit no circle are not logged. Events per run = 2 per point + live circles (≤ 14) + 2 per pause + resizes + 1 → **≈ 75 bytes per point**; 20 000 events ≈ 10 000 points, but **256 KB (MAX_BYTES) ≈ 3 400 points** (see open issues).

Submits: every new high (`updateHighscore` → `submitRun` → `run.submit`). The high is gated by the best of the mode the **run** started in (the Start button can show mid-run and let the mode switch under a live run), and nothing is sent once the run's clock is past `Q.LIMITS.MAX_T` (a run left paused for 12 h: its log could only be refused).

## What check() does
It replays the game on the logged numbers: the live list, the streak, the spawn clock (sp ≥ nextSpawn + 120·nf; nextSpawn = sp + interval(streak), shifted by each pf), the live cap and approach time for the streak (comp curves are integer tables so every JS engine agrees; the test proves them equal to the original Math.pow code), the spawn box and the spacing to live circles (canvas H must match W), the reach test and the oldest-in-reach rule, the ring test (`isEarly`, the trainer's own function), that no logged frame came after a live circle's close (it would have ended the run), which circle a "too slow" frame closes, t ≥ spawn + el, and pause shifts against the P..U gap. The score is the hits it re-derives. A claim above the logged hits is **invalid** (except for a log cut at the event cap).

Real-client oddities stop the count instead of rejecting: a hit or another live circle more than 400 ms past its close (a long stall), a pause shift 20–150 ms off the P..U gap (very coarse clocks), a K logged > 150 ms after its judged moment (a 100 ms clamped clock ticking between two reads), a canvas under 50 px.

## Person checks (review) and why they are safe
Calibrated on simulated honest runs (20 000 runs + 15 168 mid-run submits: 0 invalid, 2 review = 0.006 %, 0 score mismatches) with heavy jank (8 % dropped frames, 30 fps phones, 60–260 ms stalls up to every 5 s), coarse clocks (0.1 / 1 / 16.7 / 100 ms), pauses, resizes and double taps; plus the real IIFE in a stub page (186 pages, ~1 300 runs, ~13 000 submits, every one valid with the claimed score).
| check | threshold | honest worst seen |
|---|---|---|
| timing spread (min of SD(progress)·mean d and SD(el−d)) | < 3.5 ms over ≥ 30 hits | 4.8 ms (sim floor 6 ms player; osu! top players ≈ 8–10) |
| aim spread around the centre | < 1 px over ≥ 20 hits | 3.2 px |
| hits in the band's first 40 ms | ≥ 60 % of ≥ 25 hits | 17 % (a player aiming there dies within a few hits) |
| hit gaps (metronome) | SD < 2 ms over ≥ 20 | 32 ms |
| spot draws: KS of each spot's place in the free area (x, and y given x) | p < 1e-5, ≥ 20 spots | uniform by construction |
| spots near a point known before the draw (the last spot, the last click, the oldest live circle): w = share of the free area at least as near; Σ −ln w is Gamma(n) for honest draws, exact tail | p < 1e-5 each, ≥ 20 spots | exact under honest draws; 1 of 35 000 logs (a 25-spot phone run) |
| spawns later than due (+120 per retry, +100 ms per frame) | ≥ 8 and ≥ 25 % | 20 / 14 % |
| hits after the ring closed | ≥ 10 and ≥ 15 % | 10 / 10 % |
| … more than 50 ms after | ≥ 7 and ≥ 2 % | 5 |
| … more than 150 ms after | ≥ 3 and ≥ 0.5 % | 1 |
| retries claimed where the area was ≥ ~40 % free (P(fail) < 1e-6) | ≥ 2 (first 300 such spawns) | 0 |
| P..U gaps under 150 ms (a pause takes three clicks: another tab, this tab, Resume) | ≥ 3 | 0 |
| pauses | ≥ 10 and ≥ 2 per minute of play | 3 |

Spots are examined for the first 4 000 spawns (MAX_BYTES holds a log to about 3 400). Check CPU: about 150 ms for a 3 400-point marathon. A circle lives under d ms and spawns come every interval ms, so at most 3 circles are ever live (comp at streak 200: 500 / 200 ms); the spot maths costs under ~70 µs per spawn at that, so a crafted log stays around 0.3 s.

## What it cannot catch
A bot that reads its own page (positions are in the DOM/log) and clicks with human-sized timing and aim noise, at honest positions. A client that stretches rings by about a frame, or rescues one or two late slips per run (inside the stall allowance), or holds back fewer than a quarter of its spawns. Weak spot cherry-picking in short runs: nearest of 3 free draws to the click shows by ~150 spawns, nearest of 2 by ~300–400. A client with a slowed clock (see open issues). There is no reaction-time signal: circles are telegraphed 0.3–1.1 s before their band.

## Open issues
- Log size: casual runs past ~3 400 points exceed `Q.LIMITS.MAX_BYTES` (256 KB) and would be refused before the check runs. Raise the limit for spear or compress in transit (and raise `P.PIT_MAX` with it).
- Slowed clock: a client whose performance.now runs at 0.7× plays in slow motion with a self-consistent log that is shorter than the server's clock. Only the server can see it (log end much shorter than time since start_qte_run); the SQL check today is one-sided.
- Small canvases: at W ≲ 400 (phones, or a desktop window shrunk / zoomed) only one circle fits the spawn box, so the game is one circle at a time at any streak. Real clients do this; the check cannot tell a shrunk desktop window from a phone.
- `_onSpearQteShow` while running (the spear tab clicked again) shows the Start button mid-run (original behaviour, untouched); a Start there runs two rAF loops. Logs stay consistent (tested).
- Stop-counting cost for real players: a 400 ms+ freeze that lands on a click near a circle's close stops the count for the rest of that run (spec: stop, never reject).
