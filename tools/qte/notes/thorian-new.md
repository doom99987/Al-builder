# thorian-new / thorian-new-comp: score log and check

Drag-and-drop trainer: grab a gold diamond, drop it on rising purple orbs. One point is one 15 s
round survived. A round is lost on its second purple escape. A drop on a red orb ends the run.
Files: `thorian-new.iife.js` (replaces js/qte.js lines 2983-3594), `thorian-new.rules.js` (its
section of js/qte-rules.js), `thorian-new.test.js`, `thorian-new.bot.js`.

## What is logged
The game keeps its own clock, `g`: the sum of frame dts, each clamped to 50 ms, frozen while
paused. Each event carries `g` in ms (0.1 ms). Frame events also carry `d`, that frame's dt.
Orbs move linearly in `g`. Diamonds age in `g` while not held. An input is judged against the last
rendered frame. So the check can replay positions exactly.

| code | fields after t | where (new IIFE line) |
|---|---|---|
| Z | W, H | Start 533; resize while a run logs 118 |
| R | g, d, round | Start 534; end of the transition 437 |
| O | g, d, col, purple(1/0), speedMul, nextGap(s) | orb spawn 456 |
| Y | g, d, col, y, life(s), nextGap(s) | diamond spawn 464 |
| X | g, orb# | orb left the top 471 |
| V | g, diamond# | diamond expired 487 |
| G | g, diamond#, pointer x, y | grab 577 |
| L | g, diamond x, y, orb# or -1 | release as judged 600 (hit), 614 (nothing) |
| D | g, diamond x, y | mouseleave while holding 626 |
| C | g, d, score | round complete 500 (logged before updateHs submits) |
| P / U | g | hide 664 / Resume 638 |
| E | why ('X' escapes, 'D' red drop), g | 510, then run.close() |

A diamond position in L or D is null when the game's value went NaN (a pointer read off a 0 x 0
canvas, e.g. a finger still moving after the panel was hidden). That diamond can never hit or be
grabbed again and stays until it expires; the check models exactly that.

The trainer submits only from an open run (`submit()`, line 81): a red drop while paused ends the
run, but the original still lets Resume restart the finished game, and its next "round" used to be
submitted with a log that ends at the game over. It also closes the run (no more events or submits)
once the run clock passes `QteRules.LIMITS.MAX_T - R.LOG_T_MARGIN` (line 72), so no event can break
the 12 h limit of `validateLog` (a run kept paused overnight).

Orb and diamond numbers are run-wide spawn indexes. The draws are rounded (4 dp; diamond y to
0.1 px) and the game uses the rounded values, so the log holds exactly what was played. Moves are
not logged: only the diamond position at release matters to the game.

## What check() does
- Replays the run in order. It checks canvas size (H from W, W ≤ 900); round start, 15 s rounds and
  1 s transitions in `g`; that frame steps are ≤ 50 ms; and that no event falls between a frame and
  the one before it.
- Spawns: draw ranges; the column must be free; caps of 5 orbs and 3 diamonds; each spawn waits at
  least its logged gap. A spawn that was due (gap run out, cap free before that frame) and is missing
  is **invalid**. So is the first orb and diamond of a round not landing in the round's first frame.
- Escapes and expiry: an X or V before the orb or diamond could leave is invalid. An orb or diamond
  still listed after the frame that must have removed it is invalid (this catches a hidden escape).
  Held diamonds do not age.
- Inputs:
  - Grab: must be the first diamond (array order) within 46.8 px, not while paused or already
    holding.
  - Release: the diamond must be in the canvas bounds. The outcome is re-judged: the first orb in
    spawn order within 41.84 px of the diamond, using orb positions at `g` (frozen during the
    transition). A mismatch is invalid.
  - A red hit or a second purple escape must be followed immediately by E. Nothing may follow E.
- Score = the C events it validated. If the claim is more than that, it is **invalid**, unless the
  log is at the trainer's byte budget or the event cap. In that case the rounds after the cut are
  simply not counted.
- Tolerances: 0.3 ms or 0.3 px for rounding; diamond life 1 ms + 0.1 ms per hold; game clock may
  lead the run clock by 1 s (the first rAF stamp can predate the Start click; the lead cannot grow).

## Review thresholds (held for an admin), and why real players stay clear
Simulated honest players come nowhere near them (2400 runs, 4267 checks, plus 503 checks of
tap-to-click players; margins in the test output):
- **Drop accuracy in time**: the mean offset from the orb centre, divided by the orb's speed, is
  under 3 ms over ≥ 20 catches. A person's release timing scatters by 10+ ms, and the frame the
  release is judged on adds 3-8 ms on average. This holds for someone tapping a diamond in place as
  an orb rises through it, where the pixel offset can be ~1 px on slow orbs. Honest minimum: 59 ms.
- **Grabs**: ≥ 35% of first grabs (n ≥ 15) come < 100 ms after the diamond appeared. Honest max: 0.16,
  and that is from simulated spam-clickers.
- **New diamond far from the pointer**: a diamond appears after the hand was freed, > 150 px from
  the last release, and it is grabbed < 150 ms later in ≥ 30% of cases (n ≥ 20; was 10: a player
  flailing and spam-clicking lands on a fresh diamond by chance a few % of the time, and 3 of 10
  would happen now and then). A person needs about 250 ms to see it and move there. Honest max: 0.05.
  Bots: 1.0.
- **Long drags**: ≥ 50% of catches that moved the diamond ≥ 80 px took < 40 ms from grab to release
  (n ≥ 15). Taps in place are excluded, because a fast click is a normal hold.
- **Median drag speed** > 6 px/ms. Honest max: 0.9.
- **Timing too even**: release intervals, hold times, or release-to-grab gaps with SD < 5 ms (n ≥ 20),
  or half of them inside a 4 ms window (this catches a metronome with a few irregular steps). Honest:
  SD ≥ 52 ms, window share ≤ 0.2. Holds under 30 ms are left out of the hold-time tests: a touchpad
  with tap-to-click sends mousedown and mouseup together, so a player tapping diamonds in place has a
  0-2 ms "hold" on every tap (before this fix such players were held for review).
- **Columns**: the game picks an orb's column uniformly among the free ones. Count the orbs that came
  up in a column that carries them through a resting diamond, against the exact Poisson-binomial
  tail of those chances; review at p < 1e-5 (n ≥ 30 informative spawns). Exact, so the false rate is
  ≤ 1e-5. Catches a modified client that steers orbs into the diamonds' columns.
- **Narrow canvas**: a round completed while the canvas was under 200 px wide. Below ~209 px one
  diamond parked on a column also reaches both neighbours (below ~105 px, all five), which turns the
  game into tapping in place. No phone is that narrow; a zoomed or squeezed desktop window can be.
- **Loaded draws**: purple share (one-sided binomial), and KS tests on speed multiplier, orb gap,
  diamond life, diamond gap and diamond height. Each needs n ≥ 30 and fires at p < 1e-5. The false
  rate is ≤ 6e-5 per run. Honest minimum p: 8e-5 over 25k tests.
- **Slow motion**: ≥ 60% of logged frames at the 50 ms clamp (n ≥ 40). This means the game ran at
  or below 20 fps throughout. Honest max: 0.25.

## Log size
Typical play is about 3 KB and about 80 events per round. Simulated spam-clickers reach about 4 KB
per round. The trainer stops logging after 240 KB of events (`R.LOG_BUDGET`), which stays under the
edge function's 256 KB body limit. That is about 60-80 rounds, or 16-21 minutes. A constant
10-clicks-per-second clicker would produce about 12 KB per round and hit the cut after about 20
rounds. After the cut the run keeps playing and submitting, and the server posts the rounds proven
before it. MAX_EVENTS (20000) is never the binding limit.

## What it cannot catch
- A bot that plays the real game with human-like noise: randomised timing, aim error, and reaction
  times around 250 ms. The same goes for a solver that writes a fully consistent log. The browser
  draws the targets, so any consistent log is a possible game.
- Moderately lucky draws. Only extreme cherry-picking fails the p < 1e-5 tests (the column test
  included).
- Whether a human made the pointer events, and the true viewport. A forger can claim W = 900 for
  the longest travel; real desktops also use 900.
- Anything during pauses. The game clock is frozen, so there is nothing to gain.

## Open issues
- The IIFE reads its rules from `QteRules.trainers['thorian-new']` at load: index.html must load
  js/qte-rules.js (with this part) before js/qte.js, or the trainer does not start.
- Original bug, not fixed (it does not break honest logs): a game-over's 2.2 s timeout can fire in a
  later run (hide → show → Start within 2.2 s). It sets `gameStarted = false` mid-run, which stops
  grabs and shows Start again. A second Start leaves two rAF chains, which log frames with d = 0. The
  check accepts both, and the test simulates them.
- Original bug, not fixed: dropping on a red orb while paused ends the run but leaves `paused` set,
  so Resume restarts the finished game (grabs stop 2.2 s later). Its rounds still raise the local
  best, but are no longer submitted (the log cannot prove them).
- Not tested statistically: whether an orb's type (purple/red) correlates with its column or with
  the diamonds (a modified client could make the easy orbs purple), and where diamonds appear
  relative to rising purple orbs.
- The `clustered()` timing helper lives in this rules part. It could move to Q if other trainers
  want it.
- Very low-end devices that run under 20 fps for the whole run are held for review (slow-motion
  rule).
- The ping simulator only delays keys. This trainer is pointer-only, so `env.ping` is irrelevant.
