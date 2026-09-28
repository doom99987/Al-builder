# hammer-new / hammer-new-comp: score log and check

## The game in one paragraph
Sentry "Prepare". Hold Space (mobile: the HOLD button or a touch on the canvas)
and the blue fill rises 0.47 of the track per second; let go and it falls at
0.47/s (clamped to [0, 1], empty at each round start). While the fill's end is
inside the green zone the yellow progress bar above grows from its centre and
is full after 2.3 s in the zone; outside the zone it drains at half that rate
(1/4.6 per s). Full = the round is cleared (+1), the next round starts 700 ms
later (game clock). The red timer bar below shrinks toward its centre; running
out ends the run (score = rounds cleared in a row). Space may be held through
the 700 ms wait: the next fill then rises from its first frame.

## Numbers
| | casual | comp |
|---|---|---|
| zone width (k = rounds cleared) | max(0.245 - 0.01k, 0.10) | max(0.20 - 0.009k, 0.08) |
| round timer | max(6.2 - 0.15k, 5.0) s | max(5.5 - 0.15k, 4.5) s |
| zone centre | uniform [0.40, 0.80], kept inside [0.05, 0.98] (never binds), 4 dp | same |
| fill rate | 0.47/s up and down | same |
| progress | +1/2.3 per s in zone, -1/4.6 per s out | same |
| dt clamp | [0, 50 ms] per frame | same |

Measured from the clip: track 615 px, zone 0.514-0.759 (drawn before the first
Start), rise/fall ~0.47/s, progress full after ~2.3 s, timer ~6.2 s, colours
(blue #6a95c8, teal overlap #6eb0a4, zone #58805a between white lines, yellow
#d2d23c, red #b8454f, green on a clear). Not in the clip, our choices (spec):
the half-rate drain outside the zone (the clip never left it); the 50-100 ms
input lag the game showed is not modelled (the ping slider covers lag).

Timer floors (coordinator's change, 2026-09-28): the spec's 4.0 / 3.5 s floors
made comp zones centred above 0.604 impossible even held from the first frame
(49% of draws past streak 14). Now 5.0 / 4.5 s: the highest zone start reached
at 0.47/s plus 2.3 s in the zone leaves ~1.1 s (casual) / ~0.58 s (comp) at the
curves' end. The suite asserts, for every k 0-60 in both modes, highest zone
start / RATE + 2.3 s <= timer(k) - 0.5 s (least slack beyond that margin:
0.083 s, comp k 14).

## What is logged (t = ms since Start; g = game ms = sum of clamped frame dts, 4 dp)
| code | fields | when (hammer-new.iife.js) |
|---|---|---|
| `R` | k, zMin, zMax, g | startRound: Start (g 0) and the first frame 700 game ms after a clear |
| `D` / `X` | g, src | setHold: the hold starts / ends, taking effect from the last frame's g. src k Space, t canvas touch, b HOLD button, w (X only) window blur |
| `Z` | g0, g1, in | the frame (g0, g1] moved the fill's end into (1) / out of (0) the zone |
| `S` | g0, g1 | the frame (g0, g1] filled the progress |
| `E` | 'time', g0, g1 | the frame (g0, g1] ran the timer out |
| `P` / `U` | g / - | pause (panel hidden, tab hidden, or the QTE page left - the loop notices; drops the hold) / Resume |

Size: ~30-45 bytes per event; honest runs peaked at 217 points, ~9500 events,
~275 KB. A log cut at MAX_EVENTS (20000, ~600 casual rounds) is ~620 KB, under
MAX_BYTES; run.ev stops there and the check scores what it shows.

## What check() does
The fill is a pure function of the D/X/P game times (an input turns the fill
from the last frame's g; each frame integrates its whole clamped dt), so the
check recomputes it exactly, piecewise linear and clamped - that is the
trainer's per-frame sum with the dt clamp inside g. The progress is a per-frame
sum judged at each frame's END, which needs the frame times; the log keeps only
the frames that changed the in-zone state (Z), and the check holds each to the
recomputed fill: old state at g0, new state at g1, 0 < g1 - g0 <= 50 ms, and
the state unchanged on every stretch between them (one frame moves the fill
0.0235 at most; a zone is at least 0.08 wide, so no crossing can hide inside a
frame). With those pinned the progress is exact too (the axe part bounds its
drain instead; here the bound is one clamped frame per crossing, verified).

* invalid: first event not R(k 0, g 0) within 1 s of Start; wrong streak;
  zone width off width(k) by > 0.00015, centre outside [0.40, 0.80], off the
  track; a round < 700 or >= 750 game ms after its clear, or with no clear; a
  Z whose frame is > 50 ms, 0 ms, a second one in the same frame, to the state
  it was in, or whose ends disagree with the recomputed fill; the fill crossing
  an edge with no Z; S with progress < 1; any event of a round after its
  progress was full or its timer out (so no clear past the timer); E with time
  left or with the progress full; D while held / X with no hold / inputs,
  pauses or rounds out of phase; input in the wait after the next round was
  due; game clock going back (this is also "inputs between frames": an input
  can only carry the last frame's g); game clock > 1 s ahead of the ACTIVE wall
  clock (run time minus pauses, cumulative, + min(length, 150 ms) per pause);
  claim above the proven clears (unless the log is at MAX_EVENTS or a stop).
* stop counting: game clock 150-1000 ms (+ pause slack) ahead of the wall.
* tolerances: fill/progress 2e-5 (4-dp g summed over a round's toggles), g
  0.001 ms, zone size 0.00015.
* review ("hovering" = a round's toggles after the fill first entered its zone):
  - hold / let-go durations (wall ms), pooled SD within each round and kind,
    < 2 ms over 40+ (a timer toggling), or the MEDIAN of single rounds' SDs
    (4+ durations of a kind, 10+ such groups) < 2 ms - a few odd rounds (a
    script's leftover toggles) inflate the pooled SD but not the median;
  - 50%+ of 40+ hold / let-go durations under 30 ms (skipped on a 100 ms clock);
  - turnaround fills (ms of travel from the zone centre), pooled SD within each
    round and kind, < 3 ms over 40+, or < 0.33 of the median frame (frames of
    18 ms or less) - a script acting on the frame that crossed its threshold;
  - KS of all zone centres (20+ rounds) p < 1e-5;
  - game clock / active wall < 0.6 over 60+ s (a page throttled to ~10 fps
    plays at half speed through the dt clamp; skipped on a 100 ms clock).
  A 100 ms privacy clock (Tor / resistFingerprinting) is recognised by 90%+ of
  t values being multiples of 100: it honestly halves the game speed and puts
  toggles 0 ms apart.

## Calibration (tools/qte/tests/hammer-new.test.js)
Simulated players (new / mid / good / top / elite; elite = 5-10 ms timing SD,
turn points held to 5-20% of the zone; 20-50% "tappers" who hover with a
rhythm, motor SD >= 4 ms), 20-240 Hz, stalls to 600 ms, stale rAF stamps,
coarse clocks (1 / 16.7 / 100 ms), ping 0/150/300, mobile, pauses, focus loss,
Space held through the wait. The simulated hand's fastest tap and its "act
now" when already late both carry jitter (a fixed minimum gave a false
metronome). With the 5.0 / 4.5 s floors, closest honest approach over 10000
mixed + 3000 elite-only + ~2400 uncapped / pause-heavy runs (runs capped at
15 min, top ~215 points): pooled hold/let-go SD 5.7 ms (review < 2), median
round SD 4.7 ms (2), fast share 0.23 (0.5), turn SD 9.6 ms (3), turn/frame
0.66 (0.33), zones p 1.8e-4 (1e-5), game/wall 0.83 (0.6). Result: 0 invalid,
0 review, 0 mismatches. Default suite (2400 + 300 + 150 runs): 0 invalid,
0 review.
Bots: threshold bots at 60/144/240 Hz and comp, the 90 ms timer bot (now caught
by the median round SD: its leftover toggles hid it from the pooled SD once
runs got longer), frame-flicker, 10 fps throttling (game/wall 0.50) - all held
for review. 73 forgeries: 65 invalid, 8 review, 0 through.

## The real IIFE under Node
hammer-new.iife.js in a stub DOM with a virtual clock (rAF at a vsync grid, 20%
stale stamps, stalls, ping on keys, 16.7/100 ms clocks, mobile touch on the
canvas and HOLD button, panel hide / tab hidden / page left + Resume, window
blur mid-hold, Start mid-run), played from its own log: 150 runs (1250 in a long
pass), every submit and final log valid, 0 review. The page bot
(hammer-new.bot.js) also runs there through a harness-like ctx: its submits and
final logs are all valid. Not run in a real browser (no browser here).

## What it cannot catch
The browser picks the zones and a patched page can log anything legal: a script
that toggles with human-sized noise (turn SD 10+ ms, varying durations) is
indistinguishable from a strong player (suite: "(info) human-like elite play").
It still spends real time (SQL clock and timing floor); a record far above the
board is held in SQL. A forger can dress a slowed game as a 100 ms privacy
clock to skip the slow-motion and fast-toggle checks. Rounds re-rolled by a
patched page (not the real one: Resume continues the same round) show only if
the kept zones are skewed (KS).

## Open issues
* `?v=` bumps on js/qte.js, js/qte-rules.js, css/qte.css (index.html) and the
  load-order counts are outside this trainer's markers: left for the merge.
* supabase/qte-scores.sql has no floor for hammer-new yet. Fastest possible
  point: held from the first frame, never out, lowest zone = 0.59 s + 2.3 s =
  2.89 s (casual k 0; 0.64 + 2.3 = 2.94 s comp), +0.7 s wait for each later one
  (3.6-3.8 s). Suggested floor (a quarter off the single-point 2.89 / 2.94 s):
  casual 2.15 s/point, comp 2.20 s/point. (The raised timer floors do not
  change it: they only give slow rounds more time.)
* RULES_VER not bumped (a new trainer: no old logs to re-judge).
