# spear-new / spear-new-comp: score log and check

Spear, new version (Slayer "Bloody Burst"). Targets appear one at a time around the character; the
next one shows as a ghost. A circle is clicked. A slider is pressed on its start and held while its
ball runs a curved path: the pointer must stay within 2 r of the ball to the end. One point is one
round (all its targets before the red timer runs out); the next round comes 800 ms later. A slider
let go early or left behind, or the timer, ends the run.
Files: the IIFE "SPEAR NEW QTE" in js/qte.js (between the `NEW-QTE spear-new` markers), its rules
part in js/qte-rules.js (`qte-rules part: spear-new`, copied to supabase/functions/_shared/),
`tools/qte/tests/spear-new.test.js`, `tools/qte/bots/spear-new.bot.js`, the panel in index.html and
the styles in css/qte.css (between their markers).

## Measured (from the clip, 1920x1048) and what was made of it
| Clip | Trainer |
|---|---|
| blue circle ~38 px radius, thin outer ring, mouse icon | r = max(18, 0.045 x min(W, H)); mobile 0.06. Dark circle, light-blue rim, a ring at 1.25 r, a mouse icon |
| the next target as a faint ghost | the next target (and its path) drawn at ~20% alpha |
| circles: no approach ring, no per-target limit | none: only the round timer |
| sliders: hook / S tube, 500-700 px, ~0.4-0.5 s, press, hold, follow | cubic Bezier, end 0.30-0.45 x min(W, H) from the start, control points 0.20-0.35 x min(W, H) off the chord (same side); traversal casual max(550 - 10 s, 350) ms, comp max(450 - 10 s, 300) ms |
| targets 80-350 px from the character | 0.12-0.40 x min(W, H) from the centre, random angle, on the canvas, 3 r from the previous target |
| ~7.5 s, red bar at the bottom; 8 targets, the first a slider, 3 sliders | timer casual max(7500 - 100 s, 6000) ms, comp max(7000 - 100 s, 5500) ms (floors raised from 5000 / 4500 by the coordinator: 14 targets in 4.5 s asked ~0.32 s a target, sliders included, more than hands do); targets casual min(6 + floor(s/2), 12), comp min(8 + floor(s/2), 14); a slider with p 0.4, the first of a round always |
| banner "Bloody Burst" | a dark band with "Bloody Burst" / "Round n" in the 800 ms before each round |

s = rounds cleared this run. The canvas is the panel's width less 24 px, clamped to 240-900; its
height is `round(0.6 W)` clamped to 240-540, or on phones / under 480 px `round(0.95 W)` clamped to
240-480. It is measured at Start and at each round start only: a round keeps its pixels (CSS scales
the canvas meanwhile, pointer positions go through its client rect), so targets never move under a
hand. The character sits at the centre; targets and paths may cross it, as in the clip.

## Design choices the clip could not show (keep them in mind)
- **Hit area 1.25 r**: the circle and its thin outer ring. A press off the active target does
  nothing and is not logged (like the old spear).
- **Separation**: a target is 3 r or more from the previous target's start and, if that was a
  slider, from its end too (where the hand is when the slider ends).
- **Path**: `C1 = start + o1 n`, `C2 = end + o2 n` (n the chord's unit normal, o1 and o2 of the
  same sign, 0.20-0.35 min(W, H) each). This gives the clip's hooks. A 48-segment table of the curve;
  the ball moves at constant arc-length speed along that polyline, which is also what is drawn. The
  whole path lies within r of the canvas edges (the draw retries spots and directions until it does).
- **Following**: judged once per frame, on the pointer's latest position, including the frame the
  ball reaches its end (so a slider is "done" in the first frame at or past its traversal time, if the
  pointer is still within 2 r of the end then). Release after that is free.
- **Pause mid-slider** (panel or tab hidden): the slider is let go and starts over on a new press
  after Resume; the target stays active and the timer is frozen. Not a fail. Pausing to save sliders
  is held (see below).
- **Round 1** also comes 800 ms after Start (the banner), so every round starts the same way.
- **Ping slider**: pointer events (down, move, up) are handled `window._albPing` ms late, positions
  read at the event. The check never sees the ping: it sees what the game judged.
- **Pointer events** for mouse, touch and pen; `setPointerCapture` keeps moves and the release
  coming off the canvas; `touch-action: none` on the canvas; `pointercancel` counts as a release.
- The Start button comes back at once after a fail (no timer that could fire into a later run).

## What is logged
The game keeps its own clock `g`: the float sum of frame steps (each clamped to [0, 50 ms], frozen
while paused), rounded to whole tenths of a ms each frame, so it never drifts from the frames. Every
decision is taken on logged numbers: target draws and pointer positions are rounded to 0.1 px
before the game uses them, `g` is in tenths. So check() re-judges every decision exactly, with no
tolerance.

| code | fields after t | when |
|---|---|---|
| Z | W, H | Start; a round start where the canvas size changed (right before its R) |
| R | g, d, s | a round starts in the frame at g (step d); s = rounds cleared |
| T | 0, x, y  /  1, x, y, ex, ey, o1, o2 | right after R: each of the round's targets in order, circle / slider |
| K | g, k, px, py | the active target k pressed at (px, py), judged at the last frame's g |
| M | g, d, px, py | a follow sample: the first frame 25 ms or more after the last sample (or the press) while a slider is held |
| F | g, d, px, py | the frame the ball reached the slider's end, still held |
| C | g, n | round cleared (n rounds), right after the last K / F, logged before the submit |
| P / U | g | paused (a held slider is let go) / Resume |
| E | 'time', g, d  /  'far', g, d, px, py  /  'up', g | the run ended: timer, pointer more than 2 r from the ball, released early |

Frame order (the check replays it): a held slider first (follow test, then its end or a sample),
then the round timer. The trainer stops logging once its events pass `LOG_BUDGET` = 600 000 bytes of
JSON, and closes the run `LOG_T_MARGIN` (60 s) before `Q.LIMITS.MAX_T`.

## What check() does
- Replays the run in order. Canvas: W 240-900, H one of the two shapes for W; Z only first or right
  before an R. Rounds: R in the first frame 800 ms after the last clear (or Start), with s = the
  score so far, then exactly `targets(s)` T events. Each target is re-tested with the rules' own
  `targetOk` (distance from the centre, on the canvas, 3 r from the previous start / end, slider
  length, bows in range and on one side, every path point on the canvas); a round must open with a
  slider.
- Presses: only the active target, within 1.25 r of it, not while a slider is held or paused.
- Sliders: the ball is re-derived from the logged press time and the path table
  (`frac = (g - gPress) / trav`) at every M and F; each sample must be within 2 r of it. M only
  before the end, only once due (25 ms after the last), F only at or past the end. A frame event's
  step d tells where the previous frame was; nothing may have been due there (**tight**): no missing
  sample, no missed end, no missed timeout, no missed round start. So the largest gap between samples
  is bounded by 25 + 50 ms (checked explicitly too). E 'far' is re-judged (the pointer really was
  more than 2 r off); E 'up' only while held; E 'time' only in the first frame past the timer.
- Frames: d in [0, 50.1] ms; no event may fall between a frame and the one before it (inputs
  carry the last frame's g). Game time never goes back and never leads the run clock by over 1 s.
- Pauses: U at the pause's g; nothing but U while paused.
- Score = the C events. A claim above that is **invalid**, unless the log is at the byte budget or
  the event cap (then the rounds after the cut simply do not count).
- `env.mob` sets r; a platform that disagrees with it is recorded (`platformMismatch`), not judged.

## Review thresholds (held for an admin), and how far honest play stays
Calibrated on the suite's simulated players (skill 0-1: Fitts moves, aim scatter 0.2-0.7 r, a
slider follow that lags 0-55 ms and wobbles 0.1-0.5 r, lapses, stray clicks, double taps; 30-240 Hz
with drops, main-thread stalls, coarse clocks, ping 0-150 ms, pauses mid-slider, resizes, phones).
Margins below are the closest any honest run came, over 2 400 runs (4 334 checks) and over a
20 000-run stress run (36 111 checks):
- **Follow too exact**: mean pointer-to-ball distance under 0.05 r over >= 40 samples. Honest min
  0.188 r (stress 0.147). A script on the ball: 0.002 r; one with 0.3 px of noise: 0.016 r.
- **Presses too exact**: RMS offset from the target centre under 1 px over >= 20 presses. Honest
  min 2.66 px (2.30).
- **Presses too fast**: half the presses under 45 ms of game time after their target became active
  (n >= 20). Honest max share 0.048 (0.050); honest median never under 133 ms.
- **Press rhythm** (within rounds, wall clock): SD under 5 ms, or half of them within 2 ms of their
  median (n >= 20). Honest SD min 178 ms (165), cluster share max 0.23 (0.27).
- **Loaded draws**: too few sliders (one-sided binomial of the non-first targets, p 0.4), slider
  lengths or bows not uniform (KS); n >= 30, fire at p < 1e-5. False rate <= 3e-5 a run by
  construction; honest min p 9e-5 (3.7e-5 in the stress).
- **Slow motion**: >= 60% of logged frames at the 50 ms clamp (n >= 40; honest max 0.08), or the
  game clock under 80% of the wall clock over >= 30 s of play (honest min 0.947).
- **Pauses**: 3+ P..U gaps under 150 ms; 10+ pauses at 2+ per minute of play; 5+ sliders let go by
  a pause and 80%+ of the pauses doing that.

## Log size
About 3.4 KB and ~96 events per round (a strong player; samples are ~70% of it). The 600 KB byte
budget is reached after ~174 rounds (the MAX_EVENTS cap of 20 000 would be ~208), i.e. about 17
minutes of flawless play; the request stays well under `Q.LIMITS.MAX_BYTES` (1 MB). After the cut
the run plays on and submits; the server posts the rounds the log proves. Biggest honest log in the
stress run: 156 KB.

## Suite (`node tools/qte/tests/spear-new.test.js`, ~20 s; `SPEAR_NEW_RUNS=n`)
0) path table vs the true curve, constant ball speed, 48 000 draws all accepted by the check, slider
share and shape uniformity, curves. a) 2 400 honest runs (+ a mid-run submit each): 0 invalid,
0 review, 0 mismatch; a marathon past the byte budget; the budget cut; a 100 ms clock. b) 80
forgeries, all caught (70 invalid, 10 held: bots and loaded draws). c) 150 runs of the REAL IIFE in a
stub page (vm) by the same players and page machinery (Start mid-run, tab and panel pauses,
resizes, touch, ping), every submit checked: 0 invalid, 0 review; the sim and the real IIFE write
the same log event for event on the same seeds; the time cut, the byte budget and the event cap on
the real IIFE; the IIFE without its rules part stops quietly. d) the page bot on the real IIFE.

It also reports (never fails on) the streaks the modelled strong (skill 0.8) and elite (skill 1)
hands reach, desktop, no pauses, capped at 150 rounds, 60 runs each (`SPEAR_NEW_STREAK_RUNS=n`):

| | strong casual | strong comp | elite casual | elite comp |
|---|---|---|---|---|
| median / p95 (max), current timer | 11 / 18 (24) | 9 / 13 (14) | 13 / 67 (92) | 10 / 20 (35) |
| median / p95 (max), old 5000 / 4500 floors | 11 / 18 (24) | 9 / 12 (14) | 13 / 37 (42) | 10 / 18 (20) |

Most runs end on a slider (a lapse or a break), not on the timer, so the medians do not move; the
raised floors only lengthen the elite tail.

## What it cannot catch
- A bot that plays the real game with human-sized noise (timing, aim, a wobbling, lagging follow),
  or a solver that writes such a log: the browser draws the targets, any consistent log is a game.
- Moderately lucky draws, and where the targets are: spots and slider directions are drawn by
  rejection (on the canvas, away from the previous target), so their distribution depends on the
  canvas and the previous target and is not tested. A client that puts each target near the last
  one (short moves) is not caught. Kinds and slider shapes are tested.
- The true viewport and device: `env.mob` (bigger targets) is the client's word, like W; a
  touchscreen laptop is mobile to core.js and 'C' to sb.js (recorded as `platformMismatch`).
- Clocks floored to 100 ms (Tor / old resist-fingerprinting) run the game at half speed honestly; such
  runs are held for slow motion rather than told apart from a slowed client.

## Open points
- The panel's `?v=` stamps and the index.html comment counts ("all N QTE trainer IIFEs") are outside
  this trainer's markers and were not touched: bump `js/qte.js`, `js/qte-rules.js` and
  `css/qte.css` when this lands.
- `supabase/functions/_shared/qte-rules.js` must be redeployed with `bright-service`.
- `qte_min_seconds` (supabase/qte-scores.sql, seconds per point) has no spear-new rows, and
  tools/ai/test.js "every trainer the site can submit has its own timing floor" fails on the four new
  ids already in `QTE_TYPES`. Every round costs at least the 800 ms gap plus its opening slider's
  traversal (>= 350 ms casual, >= 300 ms comp) of game time, which cannot run ahead of the clock, so
  `1.0` for both 'spear-new' and 'spear-new-comp' can never refuse a real run (the round timer does
  not enter it: a round can be cleared long before its timer runs out).
