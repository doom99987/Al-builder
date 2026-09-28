# axe-new / axe-new-comp (Marauder "Grudge") — run log and check

## The game in one paragraph
Every Space **tap** (not a hold: auto-repeat is ignored) adds 0.125 of the track to the bar, capped at 1. Between taps it drains at 0.10 of the track per second. The drain is integrated per animation frame, with dt clamped to [0, 50 ms], and never past the timer's end. When the red round timer runs out, the fill freezes and is judged. Its end inside the zone (`zoneMin <= fill <= zoneMax`) is a hit, and the frozen bar stays green. Otherwise it is "Too low!" or "Too high!", and that miss ends the run. The score is the number of rounds cleared in a row. The next round starts 700 ms after a hit. On mobile, the TAP button or a tap on the canvas does the same as Space.

## Measured (from the clip) and the design built on it
| | clip | built |
|---|---|---|
| track | 844 px, dark translucent, pointed ends | canvas bar, same look |
| tap | ~0.126 of the track | `PRESS` 0.125, cap 1 |
| drain | ~0.10 of the track/s | `DRAIN` 0.10/s, per frame, dt in [0, `DT_MAX` 0.05 s] |
| zone | dark green, 0.653–0.834 (width 0.181), white tick at its left edge | width casual `max(0.18 − 0.007s, 0.06)`, comp `max(0.14 − 0.006s, 0.045)`; centre uniform in [0.50, 0.85], then `zone()` moves it inside [0.05, 0.98] |
| fill colour | red outside the zone, bright green inside | the same; the judged bar keeps its colour |
| timer | red bar with "[SPACE]", ~2.35 s | casual `max(2.6 − 0.04s, 1.8)` s, comp `max(2.35 − 0.04s, 1.6)` s; drains toward its left end |
| gap | – | 700 ms (`GAP_MS`) |

Here s is the number of rounds cleared this run. The zone clamp is exact but never binds with these numbers: the widest zone at the extreme centres spans 0.41–0.94. Everything above lives in `QteRules.trainers['axe-new']` (`js/qte-rules.js`), and the IIFE reads it from there.

Look: the faint "Grudge" banner sits behind the bars. A small key cap left of the timer flashes white for 90 ms on each tap; it stands in for the game's fist icon, which flashes for one frame.

## What is logged (`run.ev`, t = ms since Start, numbers to 4 dp)
| code | fields | where (axe-new.iife.js) |
|---|---|---|
| `R` | k (streak before), zoneMin, zoneMax, why `s`/`n` | `startRound`, **before** `roundEndTime` is read. The zone is the round's one random draw |
| `K` | fill **after** the tap, src `k`/`t`/`b` | `onTap`, in a live round. It is logged by the handler, so it comes after the ping delay |
| `G` | – | `onTap` between rounds (the 700 ms wait). A tap there does nothing |
| `J` | fill as compared, hit 1/0 | `evaluateRound`, on the judging frame |
| `E` | `low` / `high` | `evaluateRound`, right after a missed `J` |
| `E` | `x` | `resetToStart` / `startGame`, when a live run is reset or a Start lands over it (matchmaking) |
| `P` | – | `pauseGame`, **after** the clock is read. It fires when the panel is hidden (`_onAxeNewQteHide`) or the browser tab is hidden (`visibilitychange`) |
| `U` | – | `resumeGame` (the Resume button), **before** the clock is read |

`R` and `U` are logged before the round clock is read and `P` after it. So a logged round can only look longer than the real one, including across pauses and under a coarse clock.

**Size.** A round takes about 200–460 bytes: 1 `R`, 4–10 `K`, `J`, and sometimes `G`/`P`/`U`. A 2466-point log reaches `MAX_EVENTS` (20000) at 515 KB, under the 1 MB `MAX_BYTES`. Past that point `run.ev` stops logging, and the check scores what the log proves (stat `truncated`).

## What check() does
It is the old axe's check with the new numbers and three changes: no rise allowance, the late-judgement review, and the coarse-clock rule for the metronome check.
- **Order.** A state machine: none → round ⇄ paused → gap ⇄ gpaused → round … → missed → `E`. Anything out of order is **invalid**: a tap with no live round, a `G` inside a round, a `J` twice, events after the end, a `U` with no `P`, a reset before any round.
- **Draws.**
  - `k` must equal the proven streak.
  - The width must be `size(k, mode)` (±0.00015).
  - The zone must lie inside [0.05, 0.98].
  - The centre must lie in the clamped draw range [0.50, 0.85] (±0.0002).
  - Each round has exactly one zone.
- **Time.** All of these use unpaused time, and pauses earn nothing.
  - The first `R` comes within 1 s of Start.
  - An `n` round comes at least 700 − 110 ms after the hit.
  - `J` comes at least `timer(k)`×1000 − 110 ms after its round started.
  - The 110 ms covers a clock floored to 100 ms (Tor / resistFingerprinting).
- **The bar.** It is bounded, not recomputed.
  - Between two logged values it can lose at most 0.10/s × (active time + 200 ms + 20 ms per pause).
  - It can **never** gain. The IIFE clamps dt at 0, so a frame stamped before Start or Resume cannot raise the bar. The old axe needed a 0.02 rise allowance for that; this one has none.
  - A tap adds exactly 0.125, capped at 1.
- **Judging.** `J` is re-judged from its fill and the logged zone. Rounding is monotone, so a hit logs zMin ≤ fill ≤ zMax. `E low`/`high` must match the fill.
- **Score.** It is the number of hits. A claim above that is **invalid**, unless the log hit `MAX_EVENTS`.
- **Person checks (review).**

| check | fires when | closest honest run |
|---|---|---|
| too accurate | SD of (judged fill − zone centre) in ms of drain < 12 ms over ≥ 20 hits | 59.9 ms |
| metronome | pooled within-round SD of tap intervals (40–400 ms only) < **1.5 ms** over ≥ 30, **skipped when every logged time is a multiple of 100 ms** | 2.8 ms |
| zone draws | KS of the centres vs uniform [0.50, 0.85): p < 1e-5 over ≥ 20 rounds | 1.1e-5 at 60,000 runs (≈1e-5 per run by design) |
| bar never drains | observed / possible drain < 0.2 over ≥ 30 s of intervals ≤ 2.5 s | 0.86 |
| **bar frozen at the judgement (new)** | ≥ 4 hits **and** ≥ 10% of hits judged ≥ 300 ms after the timer | max 3 late hits; 0.20 share on 10+ hits, but never with 4 |

- **No reaction-time check.** A round starts a fixed 700 ms after a judgement the player watched. A tap right at the start is anticipation; on the shortest comp timers it is the only way to reach the middle zones with a timed burst. `firstTapMedMs` stays as a stat.

### Why the frozen-bar check
A hidden tab now pauses the trainer (`visibilitychange` logs `P`). So no frames, a bar that does not drain, and a judgement long after the timer can only come from a stopped page: a debugger breakpoint, `alert()`, or a blocked main thread. That page freezes the bar where it stands; stop it in the zone and the round is won. People meet this only on rare long stalls. The sim models these harshly, with 0.5–2.5 s long tasks in some runs and minute-long machine sleeps with no `visibilitychange`, and no honest run reached 4 late hits. A cheat that freezes one round in five is held.

### Why the metronome rule changed
At 30,000 runs the old rule (SD < 2 ms, always on) held **one** honest run. It ran on a 100 ms clock and tapped about ten times a second, so every in-band interval logged as exactly 100 ms and the SD was 0. Now:
- Logs whose every time is a multiple of 100 are exempt (stat `coarseClock`). Under 1% of honest runs are.
- The threshold is 1.5 ms. The model's floor is a 4% tap CV at 75 ms plus dispatch jitter, about 3 ms. A setTimeout bot sits at 0–0.6 ms.

## Why the thresholds are safe (axe-new.test.js)
- **Honest simulation.** A frame-by-frame model of the IIFE, 20,000 runs by default: 14,000 mixed-skill, 4,000 long top-player runs (up to 400 rounds) and 2,000 pause-heavy. It covers:
  - players from new to top, burst and "pump" styles, and anticipators;
  - habit taps at the round start and taps in the wait;
  - last-look correcting taps, a key switch that chatters, and miscounts;
  - casual and comp, ping 0/150/300 (keys only), 30–240 Hz, and frame drops;
  - negative-dt first frames, including one behind a long task that taps get ahead of;
  - long tasks, and machine sleeps with no pause;
  - panel and tab pauses anywhere (some resumed within the wait), plus 10% pause-heavy runs with 0.2–0.5 pauses per round;
  - resets, and coarse clocks of 16.7 and 100 ms.
  
  Every final log is checked, plus the log at every new high (all of them for 1 run in 10, the last one otherwise).

  **Result: 20,000 runs, 0 invalid, 0 review, 0 score mismatch, 0 snapshot failures.** The 60,000-run check gave the same: 0 / 0 / 0.
- **The real IIFE** (`axe-new.iife.js` through the shim) ran in a stub DOM on a virtual clock. The stub had:
  - rAF with vsync stamps (20% stamped before their own frame), setTimeout lateness, and main-thread stalls up to 900 ms;
  - ping, coarse clocks, and key chatter;
  - panel hide/show and **browser-tab hide** with Resume, a matchmaking-style Start over a live run, resizes, and a scores reset;
  - mobile touches on both the canvas and the TAP button;
  - a player who reads the zones from the run's own log.

  **Result: 400 runs, about 3,600 logs (every submitted snapshot and every final log), 0 invalid, 0 review, 0 mismatch.**
- **Behaviour checks** on the real IIFE:
  - the mode is fixed at Start even when it is flipped mid-run;
  - "Streak: n" and "Best: n" show, and `alb:axe-new-hs` is set;
  - each new high submits;
  - a `G` between rounds is logged, and auto-repeat is ignored;
  - "Too low!" / "Too high!" show, and Start comes back after 900 ms;
  - a tab hide holds the timer until Resume;
  - a Start over a live run logs `E x`;
  - clicking the tab again keeps a live run;
  - mobile taps log `b`/`t`.
  
  Loaded without `qte-rules.js`, the IIFE stops quietly.
- **Hand-built real-player cases**, all valid at full score:
  - taps before a janked first frame;
  - a pause in the wait with Resume 350 ms later;
  - a reset while paused;
  - five pauses in a round, judged 110 ms early;
  - a tap handled 1.6 s after the timer, behind a long task;
  - a minute-long machine sleep with the bar frozen in the zone;
  - three hits judged 0.9 s late;
  - a log cut at `MAX_EVENTS`;
  - a bar tapped to the cap and drained into the zone.
- **Mutation-tested:**
  - drop the IIFE's dt ≥ 0 clamp → real-IIFE logs go invalid;
  - disable the late check → both frozen-bar forgeries pass;
  - give the bar a rise allowance → "judged fill above the last tap" passes;
  - remove the drain slack → honest runs go invalid;
  - disable the range check → the two single-zone range forgeries pass.
- **Browser smoke test.** `harness.html?t=axe-new` ran in headless Chrome, local only (a 127.0.0.1 server, every other host unresolvable). The page's own ids, `switchQteTab` hooks, keydown path and the ping simulator all worked:
  - casual target 5: 5/5 submits valid, final log valid;
  - comp target 8 with ping 150: 8/8 valid.

## Forgeries (85, all invalid or review)
- invented hits (a miss flipped, an invented R+J round);
- edited draws (centre off the range, one zone just outside it, wider zones, a missing or doubled zone, a lower streak, the wrong mode, an axe-new log sent as `axe`);
- time compressed (×0.5, ×0.9, zero-length pauses in every round, P/U to skip the wait, a gap cut to 300 ms);
- inputs where none can be handled (while paused, after the judging frame, before the first round, `G` in a round);
- an impossible bar (it rises with no tap, drains too fast, a tap worth two or less than one, no drain at all);
- bots (perfect, metronome, identical timing, taps exactly 100 ms apart);
- cherry-picked or reused zones;
- a frozen bar before every judgement, and before every fifth;
- replays with a higher claim;
- out-of-range and malformed values;
- envelope abuse: version, type, attempt, env size, strings, 20,001 events, codes, field counts and types, time past 12 h, time going back, a log that is an array.

## What it cannot catch
- **A legal, human-looking forged log.** The client draws the zones and a zone is visible for the whole round, so a script that writes a legal, human-looking log is **valid** (the test's careful forger). Only the server clock stands in its way. The shortest legal log is 8.3% shorter than real play: 110 ms per round plus 110 ms per wait, on 1.6–2.6 s rounds.
- **Under-drain.** Under-drain is legal (clamped frames, long tasks), so a forger may choose any drain from 0 to full. Only the aggregate (`drainEff`) and the late judgements are watched. A page-freeze cheat used on fewer than 10% of rounds, or on fewer than 4 hits, is not held.
- **Fake coarse clock.** A log whose every time is a multiple of 100 ms skips the metronome check.
- **Short runs** get no person checks: under 20 hits, or under 30 in-band tap intervals.

## Open items outside this trainer's markers
- **`?v=` stamps.** The `?v=` stamps on `js/qte.js`, `js/qte-rules.js` and `css/qte.css` in `index.html` are not bumped.
- **SQL floor.** `supabase/qte-scores.sql` `qte_min_seconds` has no `axe-new` rows, and `tools/ai/test.js` "the trainer list changed" fails on that (it expects 12 types).
  - Measured floor per point: casual 1.8 s + 0.7 s = 2.5 s, comp 1.6 s + 0.7 s = 2.3 s.
  - Cut by about a quarter, as the file does: **casual 1.85, comp 1.70**.
- **Redeploy.** `bright-service` must be redeployed with the new `_shared/qte-rules.js`.
