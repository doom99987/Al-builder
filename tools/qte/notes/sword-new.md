# sword-new / sword-new-comp: run log and check

The game's new Warrior QTE, "Pommel Strike" (IIFE "SWORD NEW QTE" in js/qte.js, rules part `sword-new` in js/qte-rules.js). Same mechanic as the old `sword`: markers slide in from the left, Space stops the leading one, it must overlap the zone. What is new: the numbers, a visible round timer, and the game's look.

## Measured (owner's Medal clip, 1920x1048; reference frames `scratchpad/clips/sword_zoom.png`, `sword_sheet.png`)
- Horizontal track, 697 px. Teal zone fixed at 0.535-0.680 of the track.
- Light-grey tick markers, ~15 px wide (~0.022 of the track). They enter from the left end and slide right at ~620 px/s (~0.89 track/s).
- 4 markers per QTE, about 0.30 track (~0.33 s) apart. Each Space press stops the leading moving marker. Stopped markers stay where they stopped and pile up in the zone.
- A red timer bar under the track drains over ~3.37 s. The QTE stays up until it runs out. There is a "Pommel Strike" banner with a fist icon and a "Space" key hint.

## Design (spec, as built)
Everything is in track units (0 = the track's left end, 1 = its right end). s = rounds cleared this run.

| | casual | comp |
|---|---|---|
| zone width (start fixed at 0.535) | `max(0.145 - 0.004 s, 0.08)` | `max(0.12 - 0.004 s, 0.06)` |
| speed, track/s | `min(0.89 + 0.02 s, 1.30)` | `min(1.00 + 0.025 s, 1.50)` |
| markers per round | `min(4 + floor(s/4), 7)` | `min(4 + floor(s/3), 8)` |
| gaps between markers | uniform [0.22, 0.38], drawn at 4 dp | same |
| round timer | 3.4 s of game time (the red bar) | same |

- Hit: the stopped marker overlaps the zone, with GRACE each side. Fail: a press stops a marker outside the zone ("Outside the zone!"); the lead moving marker can no longer touch the zone ("Too slow!"); or the timer runs out with markers left ("Time's up!"). A press with no moving marker (between rounds) does nothing.
- All markers stopped in the zone: +1, and the next round 800 ms later. Score = rounds cleared in a row. The first failed round ends the run.
- Mobile: tap the canvas or the TAP button (`#sword-new-tap-btn`, shown during a run on touch devices). There are no separate mobile tables.

Hit window (the marker's travel while it overlaps the zone) and timings, from the curves:

| | s=0 | s=4 | s=8 | s=12 | s=16 | max (casual s>=21, comp s>=20) |
|---|---|---|---|---|---|---|
| casual window | 194 ms (±97) | 162 ms | 134 ms | 111 ms | 90 ms | 83 ms (±42), 7 markers |
| comp window | 148 ms (±74) | 120 ms | 97 ms | 77 ms | 63 ms | 59 ms (±29), 8 markers |

The last marker slides past the zone at most 2.6 s into a round. The 3.4 s timer can therefore never run out with markers left on these curves: "Too slow!" always ends the round first. The timer is drawn and enforced (IIFE and check), and it becomes live if the curves change.

## Choices beyond the spec (the clip could not show these)
- **Track units everywhere.** Nothing in the game or the log depends on the canvas size. The log carries no widths, there is no `Z` (resize) event, and a narrow screen or a spoofed mob flag buys nothing. Resizes mid-run change nothing.
- **GRACE = 0.003 of the track.** The spec says "2 px grace as in the old sword"; this is 2 px of the game's 697 px track, applied as a fraction so every size plays the same.
- **"Too slow" = the lead marker's left edge reaches zone end + GRACE**, the point from which it can no longer overlap. Checked every frame after the move, before the timer.
- **n-1 gap draws per round**, all of them used. The old sword drew one extra that it never used.
- **The first marker starts just off the track's left end** (x = -0.022) and every next one a gap further back. Off-track markers are clipped, not drawn. Space always stops the leading unstopped marker, even when it is not on the track yet (only possible in the first ~25 ms of a round), as in the old sword.
- **Held Space is one press.** Auto-repeat keydowns (`e.repeat`) are ignored, as in the game.
- **dt is clamped to [0, 50 ms].** A frame stamped before Start or Resume (one left pending behind a long task) moves nothing. The old sword let game time step back there; here game time never goes back, and the check requires that.
- **Pause sources.** The panel hidden (another QTE tab), the QTE page left (caught at the next frame: switchPage runs no hide hook), and the browser tab hidden (visibilitychange). Each logs `P` and shows Resume. The 800 ms between-rounds timer firing while paused starts the round on Resume, as in the old sword.
- **Look.** Dark navy backdrop, a dark translucent track with bracketed ends, a pale teal zone (outlined while a round is cleared), light-grey ticks (stopped ones paler, a missed one red), and the red timer bar in a trough under the track, draining from the right. The "Pommel Strike" banner with a fist is full for 0.7 s of a round and gone by 1.2 s. A "Space" (mobile: "Tap") key box sits under the timer bar.

## The log (QteRules.Run; t = ms since Start; numbers 4 dp)
| code | fields | where |
|---|---|---|
| `R` | streak s, marker count n, the n-1 gaps (track units, exactly as used) | startRound (Start, the 800 ms timer, or Resume when that timer fired while paused) |
| `K` | lead marker i, its x in the last drawn frame, the round's game time g (ms), hit 1/0 | onPress, after the ping delay (inside the key handler) |
| `E` | `'zone'` (right after a missed K) | onPress |
| `E` | `'slow'`, i, x, g | gameLoop |
| `E` | `'time'`, g | gameLoop (unreachable on these curves, see above) |
| `P` / `U` | paused / Resume clicked | pauseRun / resumeGame |

The run starts with `QteRules.Run.start('sword-new' + (comp ? '-comp' : ''))`. New highs call `run.submit(v)` from updateHighscore, and the match path reports to `_qteMatch`. The run is closed on the fail. Highscores are stored in `alb:sword-new-hs` / `alb:sword-new-hs-comp`.

A typical round is 1 + n events, about 40 bytes each. The log hits MAX_EVENTS (20,000) before MAX_BYTES. The suite's full log (comp, 8 markers a round) holds 2,225 rounds in 752 KB with the envelope, about 1.6 hours of flawless play. Later submits carry that full log. The check then posts the rounds it proves, without calling the higher claim invalid.

## What check() does
- Replays the state machine: idle, round, pending, missed, ended. Anything after the end is invalid, and so is anything but `E zone` after a miss. Pauses are allowed in a round or while pending, never twice, and U needs a P.
- `R`: the streak equals the rounds cleared. The count is the table value for the streak and mode. There are exactly n-1 gaps, each in [0.22, 0.38]. A round comes at least 800 - 120 ms after the last clear.
- `K`: in marker order, with g >= the round's previous hit (no going back) and g < 3,400 (a drawn frame had the timer running). x must equal x0_i + v·g/1000 to 2e-4 of the track, with x0 from the logged gaps. The marker must not already be past the zone. The zone test is re-run on the check's own x, and a flipped outcome is invalid unless it is within 1e-5 of a zone edge.
- Clock: game time may not run more than GT_AHEAD = 200 ms ahead of the unpaused wall clock, measured both since the round's `R` and since the round's previous hit. dt >= 0 and the 50 ms clamp mean only the first frame after each point (at most 2 frames of 50 ms from before it) can put it ahead, plus coarse clocks and rounding. The highest seen in 4,000 in-page worlds was 57 ms.
- `E slow`: the same motion checks, g < 3,450, and the marker really past zone end + GRACE. `E time`: g in [3,400, 3,450) and the lead marker not already past.
- Score = rounds cleared. A claim above it is invalid unless the log is full (MAX_EVENTS). A submit carries the log as it stood at its own new high, so an honest claim always equals the proof.
- Stats: rounds, presses, hits, pauses, offMean/Sd/MadMs, ivMadMs/ivN, gapsP, clockRatio, coarseClock, platformMismatch, logFull.

## Review thresholds (RV), and how they were calibrated
All of these hold for an admin; none rejects. The calibration run is `N=40000 NI=4000 NL=600 NB=40`: 69,536 honest checks (40,000 runs plus mid-run prefixes), 600 long runs by the best players, 4,000 in-page worlds on the real IIFE, and 40 bot runs.
- **ivMad < 2.0 ms over >= 30 intervals (IV_N 30, IV_MAD 2.0).** For consecutive hits in a round: the press-to-press time, on the clock with pauses taken out, minus the time the gap between the two markers takes to travel. A script pressing at the ideal moments scores 0.9-1.6 ms (real client at 60/144/240 Hz, mobile, through the ping sim, with a pause after every hit), and 0.4 ms in a written log. The lowest honest value was 3.54 ms (runs with >= 30 intervals); for long runs by the best players (sigma 5-12 ms), 6.4 ms. IV_N is 30 rather than the old sword's 20: at 20, the best simulated hands (sigma 5 ms a press) fall under 2 ms about once in 4,000 checks (seen once in an in-page world), and at 30 about once in 70,000. Pauses no longer hide a pair; the old sword skipped pairs across a pause, so a 0 ms P/U after every press switched this check off.
- **offMad < 1.5 ms over >= 30 hits.** The stopped marker's centre relative to the zone centre, in ms of travel. The judged frame alone scatters this. Only forged logs that put the marker on the centre reach it (0.00-0.57 ms). The lowest honest value was 3.66 ms; for long runs, 5.0 ms.
- **KS test on the gap draws, p < 1e-6 with >= 20 draws.** The lowest honest p was 1.3e-5. Cherry-picked widest gaps give 6e-53, one reused set of gaps 5e-10, every gap the widest 1e-59.
- **Game clock < 65% of the wall clock.** The median over >= 8 rounds of g / (unpaused wall time since R). This catches slow-motion rAF (x0.5 and x0.6 both caught). A 15 fps machine honestly runs at 75% (67 ms frames clamped to 50); the lowest honest value, a 15 fps machine that also drops frames, was 0.700. Skipped when >= 90% of event times are multiples of 100 ms (Tor / resist-fingerprinting), where the game clock honestly runs at about 50%.

## Tests (`node tools/qte/tests/sword-new.test.js`, ~20 s; `N=40000 NI=4000 NL=600 NB=40` for the long version, ~2 min)
- a) A mirror simulator of the IIFE at 15-240 Hz. It covers missed vsyncs, long tasks, stale frames at Start/Resume, coarse clocks (1 / 16.67 / 100 ms), the ping sim (0/150/300 ms), touch, and pauses from the panel, the page and the browser tab. The player anticipates the next round, follows the markers until a motor delay before each press, and has skill-dependent error, drift, lapses, double taps and forgotten presses. Default: 3,000 runs / ~5,200 checks. Long: 69,536 checks, 0 invalid, 0 review, 0 score mismatches.
- a2) Long runs by the best players: 600 runs up to 400 rounds (131 KB logs), 0 invalid, 0 review. a2b) 15 fps machines: valid (lowest ratio 0.744). a3) A flawless run until the log is full: 20,000 events, 752 KB, valid, proves 2,225 rounds.
- b) 101 forgeries, all invalid, review, or scored far below the claim. They cover: invented hits (a flipped miss; a miss moved into the zone with its press time kept; an early press 300 ms ahead of the clock), edited draws, time compressed (x0.5, x0.8, pending time cut, x0.7 behind 0 ms pauses), stretched time, inputs between frames at the ideal instants, perfect and constant-lag bots on the real client and in written logs, metronome bots, speed hacks, slow motion, forged too-slow and timer ends, replays with higher claims, out-of-range and wrongly typed fields, and envelope abuse (wrong type, version, attempt, env, codes, times, event count).
- c) The real IIFE in a fake DOM with a virtual clock, played by a person who watches the drawn canvas: 800 page loads by default, 4,000 in the long run (27,396 submits and 7,751 whole logs, 0 bad, 0 review). It covers restarts, a Start while a run is live, and resizes. Targeted scenarios: panel / page / tab left across the between-rounds timer; tab and page left mid-round; the tab clicked again mid-run then Start inside the 900 ms fail reset; a Resume behind a 500 ms-old frame; resizes; held Space; mobile taps.
- d) `tools/qte/bots/sword-new.bot.js` played against the real rules + IIFE in a vm page with an async fake clock, with the page self-check on. Long run: 40 runs, 176 submits all valid, 38/40 reached their target.

## What it cannot catch
- A script that adds human-sized noise (sigma >= 5 ms) to its press times, or writes a whole log with fresh gaps and such noise. The suite prints this as a known limit: valid, full score. Only the SQL clock and record checks bound it. The same goes for a near miss rewritten as a hit inside the clock tolerance (the suite shows one moved 30 ms: valid).
- Game time off the frame grid is not checked. Presses at the exact ideal instants are caught by their rhythm (ivMad), not by where the frames fall.
- Slow motion applied to `performance.now` and rAF together: the log is then self-consistent, only stretched. Slow motion above 65% speed also passes.
- The mob flag and platform are only recorded (a stat). There are no mobile tables, so they buy nothing.

## For the merge (outside this trainer's markers, not done here)
- `supabase/qte-scores.sql` `qte_min_seconds`: add `sword-new` 1.00 and `sword-new-comp` 0.89 seconds per point. That is the fastest possible first point (all markers at the minimum gap, the last one entering the zone: 1.34 s casual / 1.19 s comp) cut by a quarter. Later points need at least 0.8 s + 1.19 s more. Until then the new types fall to the ELSE (0.16) and fail open. `tools/ai/test.js` "every trainer the site can submit has its own timing floor" expects 12 types and fails now that `QTE_TYPES` in sb.js has 16; it needs the new count and the SQL floors.
- Bump `?v=` on js/qte.js, js/qte-rules.js and css/qte.css in index.html. Redeploy `bright-service` after copying the rules. RULES_VER needs no bump: no existing check changed.
- CLAUDE.md "Twelve trainers" and the index.html load-order comment counts.
