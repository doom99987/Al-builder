# Yarthul QTE Trainer — Design

**Date:** 2026-08-09
**Status:** Approved for planning

## Summary

A new QTE trainer replicating the Yarthul "Avoid the meteors" encounter: a blue
flame stands on a rock platform under a dragon's eye while meteors rain down in a
constant stream. The player slides the flame left and right with A/D. One hit ends
the run.

It joins the trainer page as **Yarthul** in the **New** group, alongside the
existing Thorian and Dagger entries, and follows the same structure as every other
trainer on the page — one IIFE in `js/qte.js`, one canvas panel in `index.html`,
styles in `css/qte.css`, procedurally drawn with no image assets.

## Gameplay

### Stages

Play is divided into stages, and stages are infinite. Stage `n` requires surviving
a fixed duration:

```
stageDuration(n) = min(5 + (n - 1), 20)   // seconds
```

So stage 1 asks for 5 seconds, stage 2 for 6, rising by one second per stage until
it caps at 20 seconds from stage 16 onward. There is no final stage — play
continues at the 20-second cap until the player is hit.

Between stages a 1.5-second banner reads "Stage N", during which meteors are cleared
and no collision is possible. This matches the between-round transition the Thorian
New trainer already uses.

### Losing

Contact with any meteor ends the run immediately. There are no lives and no other
fail condition — the flame is clamped inside the platform, so walking off the edge
is impossible.

### Scoring

**Score = stages fully cleared.** A player hit during stage 7 scores 6. This is the
number shown as `Best:` and submitted to the leaderboard.

### Meteors

Meteors fall in a **constant stream**, not at random intervals. The spawn cadence
is a fixed interval that tightens as stages advance; only the horizontal spawn
position is random. Each meteor also gets a small random horizontal drift, which
reproduces the angled fall seen in the reference footage without making trajectories
unreadable.

There is no telegraph or warning marker. Meteors are visible from the moment they
enter the top of the canvas, and reaction time comes from fall speed alone.

A meteor that reaches the platform without connecting bursts on impact and is
culled. Meteors leaving the canvas sides or bottom are culled silently.

### Difficulty ramp

Longer stages alone would add tedium rather than difficulty, so both spawn cadence
and fall speed scale with stage number. Competitive mode uses a steeper curve, as
the other trainers do.

All ramp values live in named constants at the top of the module so they can be
retuned in one place once the feel is tested against the real encounter. In the
table below `n` is the current stage number and `H` the canvas height in pixels.

| Value | Casual | Competitive |
|---|---|---|
| Spawn interval | `max(260, 700 - 28·(n-1))` ms | `max(170, 500 - 22·(n-1))` ms |
| Fall speed | `min(0.90 + 0.05·(n-1), 1.55) · H` px/s | `min(1.10 + 0.06·(n-1), 1.90) · H` px/s |
| Horizontal drift | ±18% of fall speed | ±22% of fall speed |

Speeds are expressed as a fraction of canvas height and player speed as a fraction
of canvas width, so difficulty is identical at every viewport size.

### Movement

A/D only, horizontal, at a constant `0.42 · W` px/s with instant start and stop —
no acceleration or momentum. Position is clamped to the platform's left and right
edges.

Held-key state is tracked through `keydown`/`keyup` on `document`. This is what lets
the two existing site-wide systems work on this trainer for free:

- `core.js` intercepts `a`/`d` in the capture phase to apply the ping simulator's
  artificial latency.
- `qte-guard.js` inspects the same events for macro signatures.

Neither needs changes.

### Mobile controls

On touch devices (`IS_MOBILE` from `core.js`) a two-button d-pad is injected below
the canvas — ◀ and ▶ — built the same way the fist trainer builds its d-pad:
created in JS, inserted after the canvas, and only when `IS_MOBILE` is true.

The fist d-pad fires discrete taps on `touchstart`. This trainer needs *held*
movement instead, so each button binds three events:

| Event | Effect |
|---|---|
| `touchstart` | `preventDefault()`, set that direction's held flag |
| `touchend` | clear the flag |
| `touchcancel` | clear the flag |

Both listeners are registered with `{ passive: false }` so `preventDefault()` can
suppress scrolling and long-press selection. Clearing on `touchcancel` as well as
`touchend` prevents the flame sticking in one direction if the browser steals the
touch (notification, gesture, incoming call).

The buttons write to the same two held-direction flags the keyboard handler sets, so
movement has one code path regardless of input device. Pressing both directions at
once cancels out to no movement, matching A+D on keyboard.

Buttons are sized for thumbs (minimum 56px touch targets) and laid out at the
canvas's lower corners, styled to match the existing `.fist-dpad-btn` treatment.

## Rendering

Everything is drawn procedurally on a 2D canvas, consistent with the rest of the
page. Draw order, back to front:

1. **Cave backdrop** — near-black base with a warm radial glow behind the eye.
2. **Dragon eye** — an almond outer shape in dark reds, an amber iris with a
   radial-gradient glow, and a vertical black slit pupil. Static; it does not track
   the player.
3. **Platform** — an angular rock silhouette across the lower canvas, top edge at
   `0.80 · H`, spanning the central 62% of the width. This span defines the player's
   movement clamp.
4. **Meteors** — glowing teardrops, point leading, with a short additive trail and a
   soft orange halo, rotated to match their velocity vector.
5. **Flame** — a flickering blue teardrop with a pale core, bobbing subtly at rest.
6. **Impact bursts** — brief expanding orange rings where meteors hit the platform.

Collision uses a circle for the meteor head against a circle for the flame. The
flame's hit radius is 60% of its drawn width, deliberately smaller than the sprite,
so near-misses read as fair.

## Integration

Five files change. Each addition mirrors the `thorian-new` / `dagger-new` entries
already present.

| File | Change |
|---|---|
| `index.html` | Tab button in `#qte-group-new`; `#qte-panel-yarthul-new` panel; show/hide hook lines in `switchQteTab` |
| `js/qte.js` | New `// === YARTHUL NEW QTE ===` IIFE at the end of the file |
| `css/qte.css` | `.yarthul-new-qte-wrap`, `-header`, `-canvas`, and mobile move-button styles |
| `js/sb.js` | Add `'yarthul-new'` to `QTE_TYPES` and `_ALL_QTE_TYPES`; label `'Yarthul (New)'` in `QTE_LABELS` |
| `js/matchmaking.js` | `{ id: 'yarthul-new', label: 'Yarthul', group: 'new', hook: 'YarthulNew' }` in `QTES` |

### Identifiers

- Panel: `qte-panel-yarthul-new`, tab `data-qte="yarthul-new"`, label `Yarthul`
- Elements: `yarthul-new-qte-canvas`, `-status`, `-streak` (displays current stage),
  `-highscore`, `-start-btn`, `-resume-btn`
- localStorage: `alb:yarthul-new-hs`, `alb:yarthul-new-hs-comp`
- Leaderboard ids: `yarthul-new`, `yarthul-new-comp`
- Window hooks: `window._onYarthulNewQteShow`, `window._onYarthulNewQteHide`

The `-streak` suffix is kept for the stage counter even though it shows a stage
rather than a streak, so the element naming stays uniform across panels.

### Shared behaviour

The module reuses the established trainer contract:

- `updateHs(val)` routes to `window._qteMatch.report()` during a match, otherwise
  writes the mode-appropriate localStorage key and calls `window._sbSubmitScore`.
- Failure routes to `window._qteMatch.fail()` during a match.
- Listens for `alb-scores-reset` and `alb-mode-changed` to refresh the displayed best.
- The game loop no-ops unless `#page-qte` is active or a match is running.
- Start / Resume buttons, pause on tab hide, and `resizeCanvas` on window resize.

## Out of scope

- Sound effects. The `sfx/` folder holds weapon sounds only, and no existing trainer
  plays audio.
- Image assets. The backdrop is drawn in code like every other trainer.
- Adding `dagger-new` to `_ALL_QTE_TYPES` in `js/sb.js`, where it is currently
  missing. That is a pre-existing gap unrelated to this work.

## Open tuning

The ramp table above is a starting point derived from the reference footage, not
measured values. Expect to adjust spawn cadence and fall speed after playing it
against the real encounter. Because every value is a named constant in one block,
retuning is a single edit.
