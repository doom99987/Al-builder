# yarthul-new (Yar'Thul meteor dodge): verification notes

## What is logged (yarthul-new.iife.js)
Game time `g` is the run's own clock: the sum of its frames' clamped `dt`, in ms to 0.1 ms. Each frame covers `[g0, g0+dt]`. Keys, spawns and moves take effect at `g0`. Collisions are sampled at the frame's end.

| code | fields | where |
|---|---|---|
| `S` | W, H (canvas) | startGame |
| `M` | u1, u2 (floor(1e4 × each Math.random draw), x then drift), lag (0.1 ms units from the frame start to the moment the spawn accumulator reached the meteor) | spawnMeteor |
| `D` | g0, dir (-1/0/1), flame x | loop. Logged only when the direction the frame applies changes, so it comes after the ping simulator |
| `C` | stage, g (frame end) | onStageCleared, logged before the submit |
| `B` | stage, g0, g1 (the frame that ended the banner) | loop |
| `Z` | g, W, H, flame x after clamp | resizeCanvas, only while running and only if W/H changed |
| `P` / `U` | none | visibilitychange |
| `E` | 'hit', g / 'abandon' | onHit / abandonRun |
| `X` | none | logEv: the log reached its size budget (R.K.LOG_BUDGET, 240 KB of events, or MAX_EVENTS − 1). Nothing is logged after it; the run plays on |

Submits go through `run.submit(val)`. The local-best gating and the match path are unchanged. The curves, geometry and dt cap are read from `QteRules.trainers['yarthul-new']`.

## What check() does
1. **Structure (invalid).** The log opens with S. Canvas sizes are ones the code can produce (H = f(W)). Draws are integers in [0, 1e4); lag is in [0, 50] ms. Each meteor's spawn time is rebuilt as accStart + j·iv − lag. Game time never runs backwards (0.3 ms; 100 ms around the first frame) and never leads the wall clock by more than 250 ms. Nothing may follow E or X.
2. **Stage rules (invalid).** Stage n clears in [dur(n), dur(n)+50 ms] of game time after its clock started; the banner ends in [1.5 s, 1.5 s + one frame]; the meteor count is floor(accumulated ms / interval); stages run 1, 2, 3 …; key events must change something; a hit only inside a stage.
3. **Flame path.** Rebuilt from D/Z, piecewise linear, clamped at the platform edges, and re-anchored to each logged x (0.1 px). A logged x more than 1 px off the path the keys produce stops the count (not invalid). Honest rounding is under 0.15 px.
4. **Collision replay, canvas by canvas.** A resize keeps meteors where they are and moves the flame's circle and the platform, so each meteor is followed through every resize with the geometry in force, until a rule drops it (platform surface, 4 radii off a side). Two tests, both on a radius 1 px smaller:
   - on the flame for more than 50.5 ms of game time (frames are at most 50 ms apart, so a frame end fell inside);
   - on the flame at a known frame end: every M, D, Z and C carries the game time at which the previous frame ended and checked collisions (not within 0.5 ms after a resize, nor within 0.5 ms of the meteor's drop).
   A meteor that a rule could have dropped with no frame end known to follow (only possible when two resizes land on one frame boundary) is only "maybe" present: an overlap with it stops the count instead of invalidating.
5. **Score.** The last stage that passed 1-4. A claim above it is invalid unless the count was stopped, the log ends in X, or it hit MAX_EVENTS.
6. **Person checks (review), over the proven stages:**
   - KS test of both draws, p < 1e-6 (≥ 50 meteors).
   - Repeated meteors: ≥ 10 draw pairs seen before and > 5× the n²/2e8 expected.
   - Too few aimed meteors (on course for the flame as it was moving when drawn): Poisson-binomial lower tail p < 1e-8, needs ≥ 8 expected and at most 0.35 of the expected count. A personal best is a lucky run, with fewer deadly meteors than average (about 0.4-0.9 of the expected count in simulation); cherry-picking leaves close to none.
   - Reactions: aimed meteors followed by a key change within 100 ms vs other meteors: binomial tail p < 1e-6, an excess ≥ 0.3, ≥ 10 aimed and ≥ 50 others.
   - Metronome: key-change intervals with SD < 4 ms or CV < 0.12 over ≥ 20 intervals.
   - One-frame holds: at least half of ≥ 40 holds under 20 ms (holds of 0 ms game time, from coarse timers, not counted).
   - Exact dodges: at least half of ≥ 20 near misses within 10% of the radius, binomial p < 1e-6 against 0.3.
   - Slow motion: median game/wall speed per stage below 0.35 over ≥ 3 stages. Hidden-tab time (P..U) is taken off the wall clock only when no frame ran inside it.
   - Resizes mid-stage in more than 2 separate bursts (2 s apart): each resize moves the flame and drops meteors, a free dodge.

## Thresholds (20,000 simulated honest runs)
Profiles: 60/75/120/144/30/15 fps with jitter, 50-350 ms stalls, 1/16.7/100 ms timers, negative first frames, ping 0-300, mobile, pauses up to 30 s with stuck keys, single resizes (6%) and window drags (6%: 0.3-3 s of resizes every 2-40 ms), casual and comp, new to elite players. Result: 0 invalid, 0 review, 0 score mismatch. Closest honest values are printed by the test.

## Adversarial review (fixed)
- Resize flood: a Z every 40-100 ms turned the collision replay off (meteors whose fall spanned a resize were skipped). A no-play log with a parked flame came back **valid** at any claim. Now replayed through resizes: invalid.
- Resize teleports: pairs of resizes at one instant move the flame anywhere to its left or to the middle; now held (bursts).
- Pauses as cover: P..U around frames excused any wall time from the slow-motion test; now a pause counts only if no frame ran in it.
- Flame path drift: thousands of key changes random-walked the rebuilt path by 0.1 ms roundings (1.7 px after 4,400 changes, 2 px was the limit): the count could stop on an honest restless player. Now re-anchored at each logged x.
- Personal-best bias in the aimed-meteor test: a lucky best of a weak player could reach p ≈ 2e-6 (old limit 1e-6). Now 1e-8 plus a 0.35 share cap.
- Log size: a very long run's log passed the edge function's 256 KB limit and every later submit was refused unread. The IIFE now ends the log with X in budget; later submits count up to it.
- Reused meteors were not looked at; now held.

## What it cannot catch
- A script that plays with human-like reaction times (≥ 150 ms), sloppy margins and irregular keys; or a whole log fabricated offline from a good human model with fresh uniform draws.
- Mild cherry-picking (re-drawing some of the aimed meteors).
- Slow motion down to about 0.35× (100 ms timers and < 20 fps give 0.5× honestly).
- Up to two resize bursts used as dodges.
- The seed is not used: the browser still draws the meteors.

## Open issues
- A run past the log budget (comp ≈ stage 35) counts only up to the X. Raising Q.LIMITS.MAX_BYTES or compressing would let longer runs count in full.
- Seeded draws (server regenerates the meteors) would remove cherry-picking and whole-log fabrication; needs start_qte_run to hand out per-run randomness.
- `pbLower` (Poisson-binomial lower tail) lives in this rules part; it could move into Q.stats.
