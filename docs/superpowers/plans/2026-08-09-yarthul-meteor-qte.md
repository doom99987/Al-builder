# Yar'Thul Meteor QTE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Yar'Thul" QTE trainer where the player slides a blue flame left and right with A/D to dodge a constant stream of falling meteors, across infinite stages of increasing length.

**Architecture:** One self-contained IIFE appended to `js/qte.js`, following the exact shape of the existing `THORIAN NEW QTE` module — canvas-rendered, no image assets, no external libraries. The page, styles, leaderboard registry and matchmaking registry each get one small additive entry. Nothing existing is refactored.

**Tech Stack:** Vanilla ES5-compatible JS (no modules, no build step), Canvas 2D API, CSS. Static site served over plain HTTP.

## Global Constraints

- **Never commit or push.** The repo owner handles all git operations. Each task ends by reporting changed files and stopping. Do not run `git commit`, `git push`, or `git add` at any point.
- **No build step.** The site is static and served directly. Do not add `package.json`, bundlers, or transpilation.
- **No test framework exists.** This repo has no test runner. Verification is browser-based, performed against a local static server. Never write a step that invokes `pytest`, `jest`, `npm test`, or similar — there is nothing to run.
- **No image assets.** Everything is drawn procedurally on canvas, matching every other trainer.
- **No new dependencies.** No CDN links, no npm packages.
- **Style match:** section headers use `// === NAME ===`, two-space indent, `const` for fixed values, functions declared with `function`.
- **Naming:** the boss is spelled **`Yar'Thul`** in all player-visible text, matching `js/encyclopedia.js:294` (`"Yar'Thul, The Blazing Dragon"`). All internal identifiers stay apostrophe-free (`yarthul-new`) so they are safe as storage keys, CSS class names, and database ids. In JS, write visible labels with double quotes — `"Yar'Thul"` — to avoid escaping.
- **Identifiers are fixed** and used verbatim across tasks:
  - Tab: `data-qte="yarthul-new"`, visible label `Yar'Thul`
  - Panel: `qte-panel-yarthul-new`
  - Elements: `yarthul-new-qte-canvas`, `-status`, `-streak`, `-highscore`, `-start-btn`, `-resume-btn`
  - localStorage: `alb:yarthul-new-hs`, `alb:yarthul-new-hs-comp`
  - Leaderboard ids: `yarthul-new`, `yarthul-new-comp`
  - Window hooks: `window._onYarthulNewQteShow`, `window._onYarthulNewQteHide`
- **Placement:** the New group only. Do not touch the Old group.

## Verification Harness

Every task is verified in a browser against a local server. Start it once:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`, click **QTE Trainer** in the nav, click the **New** group button, then the **Yar'Thul** tab.

Agentic workers should use `preview_start` with the `al-builder` configuration created in Task 1, then `navigate`, `computer` (screenshot), and `read_console_messages`.

**A console check that must pass after every single task:** open DevTools console and confirm there are zero errors. A thrown exception inside `requestAnimationFrame` silently kills the loop, so a clean console is the baseline for every other check being meaningful.

---

### Task 1: Panel scaffold, tab, and backdrop rendering

Adds the tab, the panel, the styles, and an IIFE that sizes the canvas and paints the static scene: cave, Yar'Thul's eye, and the rock platform. No game yet.

**Files:**
- Create: `.claude/launch.json`
- Modify: `index.html` (tab button in `#qte-group-new`; new panel after `#qte-panel-dagger-new`; hook lines in `switchQteTab`)
- Modify: `css/qte.css` (append after the `#thorian-new-qte-*-btn` rule block)
- Modify: `js/qte.js` (append new section at end of file)

**Interfaces:**
- Consumes: nothing.
- Produces: module-scoped `W`, `H`, `ctx`, `resizeCanvas()`, `platformLeft() → number`, `platformRight() → number`, `platformTop() → number`, `drawBackdrop()`, and `window._onYarthulNewQteShow` / `window._onYarthulNewQteHide`.

- [ ] **Step 1: Create the preview server config**

Create `.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "al-builder",
      "runtimeExecutable": "python",
      "runtimeArgs": ["-m", "http.server", "8000"],
      "port": 8000
    }
  ]
}
```

- [ ] **Step 2: Add the tab button**

In `index.html`, inside `<div class="tabbar qte-group-tabs" id="qte-group-new">`, add a third button after the Dagger one:

```html
      <button class="tab" data-qte="yarthul-new">Yar&#39;Thul</button>
```

The `&#39;` entity keeps the apostrophe from interacting with surrounding quotes if this markup is ever moved into a JS string.

- [ ] **Step 3: Add the panel**

In `index.html`, immediately after the closing `</div>` of `#qte-panel-dagger-new` and before the closing `</div>` of `.qte-content`, add:

```html
    <!-- Yar'Thul New QTE -->
    <div class="qte-panel" id="qte-panel-yarthul-new" style="display:none">
      <div class="yarthul-new-qte-wrap">
        <div class="yarthul-new-qte-header">
          <span class="yarthul-new-qte-status" id="yarthul-new-qte-status"></span>
          <span class="yarthul-new-qte-streak" id="yarthul-new-qte-streak"></span>
          <span class="yarthul-new-qte-highscore" id="yarthul-new-qte-highscore"></span>
          <button class="lb-open-btn" onclick="window._openLeaderboard('yarthul-new')">&#127942; Leaderboard</button>
        </div>
        <canvas id="yarthul-new-qte-canvas" class="yarthul-new-qte-canvas"></canvas>
        <button class="fist-qte-start-btn" id="yarthul-new-qte-start-btn">Start</button>
        <button class="fist-qte-start-btn" id="yarthul-new-qte-resume-btn" style="display:none">Resume</button>
      </div>
    </div>
```

- [ ] **Step 4: Wire the show/hide hooks**

In `index.html`, inside `switchQteTab`, after the two `dagger-new` lines, add:

```javascript
    if (name === 'yarthul-new' && typeof window._onYarthulNewQteShow === 'function') window._onYarthulNewQteShow();
    if (name !== 'yarthul-new' && typeof window._onYarthulNewQteHide === 'function') window._onYarthulNewQteHide();
```

- [ ] **Step 5: Add the panel styles**

Append to `css/qte.css`:

```css
/* ----- Yar'Thul (New) QTE ----- */
.yarthul-new-qte-wrap {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  overflow: hidden;
}

.yarthul-new-qte-header {
  display: flex;
  gap: 24px;
  align-items: center;
  min-height: 28px;
}

.yarthul-new-qte-status {
  font-family: 'Rajdhani', Arial, sans-serif;
  font-size: 17px;
  font-weight: 600;
  color: #ff8844;
  min-width: 260px;
  text-align: center;
}

.yarthul-new-qte-streak {
  font-family: 'Rajdhani', Arial, sans-serif;
  font-size: 14px;
  color: #7fe8ff;
  min-width: 80px;
}

.yarthul-new-qte-highscore {
  font-family: 'Rajdhani', Arial, sans-serif;
  font-size: 13px;
  color: #666;
  min-width: 70px;
}

.yarthul-new-qte-canvas {
  border-radius: 10px;
  display: block;
  width: 100%;
  max-width: 900px;
}

#yarthul-new-qte-start-btn,
#yarthul-new-qte-resume-btn {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
```

- [ ] **Step 6: Add the module with backdrop rendering**

Append to the end of `js/qte.js`:

```javascript
// === YARTHUL NEW QTE ===
// Blue flame on a rock platform beneath Yar'Thul's eye. Meteors fall in a constant
// stream; A/D slides the flame left and right. One hit ends the run.
// Stage n lasts min(5 + (n-1), 20) seconds. Stages are infinite.
(function () {
  const canvas = document.getElementById('yarthul-new-qte-canvas');
  if (!canvas) return;
  const ctx       = canvas.getContext('2d');
  const statusEl  = document.getElementById('yarthul-new-qte-status');
  const stageEl   = document.getElementById('yarthul-new-qte-streak');
  const hsEl      = document.getElementById('yarthul-new-qte-highscore');
  const startBtn  = document.getElementById('yarthul-new-qte-start-btn');
  const resumeBtn = document.getElementById('yarthul-new-qte-resume-btn');

  // ---- LAYOUT TUNING ----
  const PLATFORM_TOP_FRAC   = 0.80; // platform surface, as a fraction of H
  const PLATFORM_WIDTH_FRAC = 0.62; // platform span, as a fraction of W

  let W = 0, H = 0;

  function platformTop()   { return H * PLATFORM_TOP_FRAC; }
  function platformLeft()  { return (W - W * PLATFORM_WIDTH_FRAC) / 2; }
  function platformRight() { return platformLeft() + W * PLATFORM_WIDTH_FRAC; }

  function setStatus(t, c) {
    if (statusEl) { statusEl.textContent = t; statusEl.style.color = c || '#888'; }
  }

  // ---- CANVAS SIZE ----
  function resizeCanvas() {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    W = Math.min(wrap.clientWidth, 900);
    H = Math.max(260, Math.min(380, Math.round(W * 0.46)));
    canvas.width        = W;
    canvas.height       = H;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
  }

  // ---- BACKDROP ----
  function drawEye(cx, cy) {
    const ew = W * 0.30, eh = H * 0.30;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - ew, cy);
    ctx.quadraticCurveTo(cx, cy - eh, cx + ew, cy);
    ctx.quadraticCurveTo(cx, cy + eh, cx - ew, cy);
    ctx.closePath();
    ctx.clip();

    const iris = ctx.createRadialGradient(cx, cy, eh * 0.08, cx, cy, ew);
    iris.addColorStop(0,    '#ffd98a');
    iris.addColorStop(0.45, '#e8791f');
    iris.addColorStop(1,    '#5a1607');
    ctx.fillStyle = iris;
    ctx.fillRect(cx - ew, cy - eh, ew * 2, eh * 2);

    ctx.beginPath();
    ctx.ellipse(cx, cy, ew * 0.09, eh * 0.80, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#140603';
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(cx - ew, cy);
    ctx.quadraticCurveTo(cx, cy - eh, cx + ew, cy);
    ctx.quadraticCurveTo(cx, cy + eh, cx - ew, cy);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(28, 10, 6, 0.95)';
    ctx.lineWidth   = Math.max(3, H * 0.018);
    ctx.stroke();
  }

  function drawPlatform() {
    const l = platformLeft(), r = platformRight(), t = platformTop();
    ctx.beginPath();
    ctx.moveTo(l, t);
    ctx.lineTo(r, t);
    ctx.lineTo(r - W * 0.05, H);
    ctx.lineTo(l + W * 0.05, H);
    ctx.closePath();
    const rock = ctx.createLinearGradient(0, t, 0, H);
    rock.addColorStop(0, '#4a3a33');
    rock.addColorStop(1, '#1a1210');
    ctx.fillStyle = rock;
    ctx.fill();
    ctx.strokeStyle = '#0d0908';
    ctx.lineWidth   = 2;
    ctx.stroke();
  }

  function drawBackdrop() {
    ctx.fillStyle = '#08060a';
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2, cy = H * 0.42;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.55);
    glow.addColorStop(0,   'rgba(120, 34, 12, 0.85)');
    glow.addColorStop(0.5, 'rgba(60, 16, 8, 0.45)');
    glow.addColorStop(1,   'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    drawEye(cx, cy);
    drawPlatform();
  }

  function draw() {
    drawBackdrop();
  }

  // ---- SHOW / HIDE ----
  window._onYarthulNewQteShow = function () {
    resizeCanvas();
    draw();
  };
  window._onYarthulNewQteHide = function () {};

  window.addEventListener('resize', () => {
    if (!document.getElementById('qte-panel-yarthul-new')) return;
    resizeCanvas();
    draw();
  });

  setStatus('Press Start', '#888');
})();
```

- [ ] **Step 7: Verify in the browser**

Start the server, open `http://localhost:8000`, go to QTE Trainer → New → Yar'Thul.

Expected:
- A **Yar'Thul** tab exists in the New group, next to Thorian and Dagger.
- Clicking it shows a canvas painting a dark cave, a glowing amber eye with a black vertical slit pupil, and a grey rock platform across the lower area.
- Status text reads "Press Start".
- Console has zero errors.
- Resizing the window redraws the scene at the new width without distortion.

- [ ] **Step 8: Stop for review**

Do not commit. Report what changed (`index.html`, `css/qte.css`, `js/qte.js`, `.claude/launch.json`) and wait for the repo owner to review and commit.

---

### Task 2: Flame and A/D movement

Draws the player flame on the platform and moves it with A/D, clamped to the platform edges. Runs on a continuous animation loop so movement is visible before any game rules exist.

**Files:**
- Modify: `js/qte.js` (the `YARTHUL NEW QTE` IIFE)

**Interfaces:**
- Consumes: `W`, `H`, `platformLeft()`, `platformRight()`, `platformTop()`, `drawBackdrop()`, `resizeCanvas()`, `draw()` from Task 1.
- Produces: `playerX` (number, flame centre x), `moveLeft` / `moveRight` (booleans, held-direction flags), `drawFlame(x, yBase, h, t)`, `clampPlayer()`, `loop(now)`, `startLoop()`, `stopLoop()`, and the tuning constants `PLAYER_SPEED_FRAC`, `PLAYER_H_FRAC`.

- [ ] **Step 1: Add the player tuning constants**

In the `// ---- LAYOUT TUNING ----` block, after `PLATFORM_WIDTH_FRAC`, add:

```javascript
  const PLAYER_SPEED_FRAC = 0.42; // W travelled per second
  const PLAYER_H_FRAC     = 0.13; // flame height, as a fraction of H
```

- [ ] **Step 2: Add movement state**

Directly after `let W = 0, H = 0;` add:

```javascript
  let playerX   = 0;     // flame centre x
  let moveLeft  = false;
  let moveRight = false;
  let animFrame = null;
  let lastTime  = 0;
  let flickerT  = 0;     // drives the flame's idle flicker
```

- [ ] **Step 3: Clamp the player on resize**

At the end of `resizeCanvas()`, after the `canvas.style.height` line, add:

```javascript
    if (!playerX) playerX = W / 2;
    clampPlayer();
```

And add the clamp helper directly after `resizeCanvas()`:

```javascript
  function clampPlayer() {
    playerX = Math.min(Math.max(playerX, platformLeft()), platformRight());
  }
```

- [ ] **Step 4: Draw the flame**

Add after `drawPlatform()`:

```javascript
  // ---- FLAME ----
  function drawFlame(x, yBase, h, t) {
    const w    = h * 0.45;
    const sway = Math.abs(Math.sin(t * 6)) * h * 0.08;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    ctx.beginPath();
    ctx.moveTo(x, yBase - h - sway);
    ctx.bezierCurveTo(x + w, yBase - h * 0.55, x + w * 0.85, yBase, x, yBase);
    ctx.bezierCurveTo(x - w * 0.85, yBase, x - w, yBase - h * 0.55, x, yBase - h - sway);
    ctx.closePath();
    const body = ctx.createLinearGradient(0, yBase - h, 0, yBase);
    body.addColorStop(0,   '#7fe8ff');
    body.addColorStop(0.6, '#2f9bdc');
    body.addColorStop(1,   '#0b3f7a');
    ctx.fillStyle = body;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(x, yBase - h * 0.30, w * 0.34, h * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(220, 248, 255, 0.9)';
    ctx.fill();

    ctx.restore();
  }
```

- [ ] **Step 5: Draw the flame each frame**

Replace the `draw()` function from Task 1 with:

```javascript
  function draw() {
    drawBackdrop();
    drawFlame(playerX, platformTop(), H * PLAYER_H_FRAC, flickerT);
  }
```

- [ ] **Step 6: Add the animation loop**

Add before the `// ---- SHOW / HIDE ----` block:

```javascript
  // ---- LOOP ----
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    flickerT += dt;

    const dir = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
    playerX += dir * PLAYER_SPEED_FRAC * W * dt;
    clampPlayer();

    draw();
    animFrame = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (animFrame) return;
    lastTime  = performance.now();
    animFrame = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = null;
    moveLeft = moveRight = false;
  }
```

`dt` is capped at 0.05s so a backgrounded tab cannot teleport the flame across the platform on its first frame back.

- [ ] **Step 7: Add the keyboard handlers**

Add directly after `stopLoop()`:

```javascript
  // ---- INPUT ----
  function panelActive() {
    const panel = document.getElementById('qte-panel-yarthul-new');
    return !!(panel && panel.style.display !== 'none');
  }

  document.addEventListener('keydown', e => {
    if (!panelActive()) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'a' || e.key === 'A') { moveLeft  = true; e.preventDefault(); }
    if (e.key === 'd' || e.key === 'D') { moveRight = true; e.preventDefault(); }
  });

  document.addEventListener('keyup', e => {
    if (e.key === 'a' || e.key === 'A') moveLeft  = false;
    if (e.key === 'd' || e.key === 'D') moveRight = false;
  });
```

`keyup` deliberately skips the `panelActive()` guard — if the panel is hidden mid-press, the flag must still clear or the flame sticks in one direction on return.

- [ ] **Step 8: Drive the loop from the show/hide hooks**

Replace the show/hide hooks from Task 1 with:

```javascript
  window._onYarthulNewQteShow = function () {
    resizeCanvas();
    startLoop();
  };
  window._onYarthulNewQteHide = function () {
    stopLoop();
  };
```

- [ ] **Step 9: Verify in the browser**

Reload, open the Yar'Thul tab.

Expected:
- A blue flame stands centred on the platform, flickering gently.
- Holding **A** slides it left; holding **D** slides it right; releasing stops it immediately.
- The flame stops dead at both platform edges and cannot leave the rock.
- Holding A and D together produces no movement.
- Switching to another QTE tab and back leaves the flame stationary, not drifting.
- Console has zero errors.

- [ ] **Step 10: Stop for review**

Do not commit. Report what changed (`js/qte.js`) and wait for the repo owner to review and commit.

---

### Task 3: Mobile arrow buttons

Adds two on-screen arrows for touch devices that drive the same movement flags as the keyboard.

**Files:**
- Modify: `js/qte.js` (the `YARTHUL NEW QTE` IIFE)
- Modify: `css/mobile.css` (append after the `.thorian-dpad-btn` rules)

**Interfaces:**
- Consumes: `moveLeft`, `moveRight` from Task 2; `IS_MOBILE` from `js/core.js`.
- Produces: a `.yarthul-arrows` element inserted after the canvas on touch devices. No new exports.

- [ ] **Step 1: Add the arrow styles**

Append to `css/mobile.css`:

```css
/* ----- Yar'Thul QTE arrows (left / right only) ----- */
.yarthul-arrows {
  display: flex;
  justify-content: center;
  gap: 90px;
  margin: 8px auto 0;
  flex-shrink: 0;
}
.yarthul-arrow-btn {
  width: 68px;
  height: 68px;
  font-size: 28px;
  background: #2a1510;
  color: #ffb070;
  border: 2px solid #a85a2a;
  border-radius: 10px;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}
.yarthul-arrow-btn:active { background: #7a3a18; color: #fff; }
```

- [ ] **Step 2: Build and bind the arrows**

In `js/qte.js`, add directly after the keyboard handlers from Task 2:

```javascript
  // ---- MOBILE ARROWS ----
  // Two directions only, so no cross-shaped d-pad. Held movement, not discrete
  // taps: touchstart sets the flag, touchend and touchcancel both clear it.
  // touchcancel matters — if the browser steals the touch, the flag must not stick.
  if (IS_MOBILE) {
    const arrows = document.createElement('div');
    arrows.className = 'yarthul-arrows';
    arrows.innerHTML =
      '<button class="yarthul-arrow-btn" data-dir="left">&#9664;</button>' +
      '<button class="yarthul-arrow-btn" data-dir="right">&#9654;</button>';

    arrows.querySelectorAll('.yarthul-arrow-btn').forEach(btn => {
      const dir = btn.dataset.dir;
      const set = v => { if (dir === 'left') moveLeft = v; else moveRight = v; };
      btn.addEventListener('touchstart', e => { e.preventDefault(); set(true);  }, { passive: false });
      btn.addEventListener('touchend',   e => { e.preventDefault(); set(false); }, { passive: false });
      btn.addEventListener('touchcancel', () => set(false));
    });

    canvas.parentNode.insertBefore(arrows, canvas.nextSibling);
  }
```

- [ ] **Step 3: Verify on a mobile viewport**

Resize the browser to a mobile preset (375×812) and reload the page — `IS_MOBILE` is evaluated once at load, so a reload is required after switching.

Expected:
- Two arrow buttons appear below the canvas, one left one right, well separated.
- Touching and holding ◀ slides the flame left; releasing stops it.
- Touching and holding ▶ slides the flame right; releasing stops it.
- Dragging a finger off a button while held, then releasing, does not leave the flame stuck moving.
- The page does not scroll or select text while an arrow is held.
- On a desktop viewport (reload at 1280×800) the arrows are absent.
- Console has zero errors.

- [ ] **Step 4: Stop for review**

Do not commit. Report what changed (`js/qte.js`, `css/mobile.css`) and wait for the repo owner to review and commit.

---

### Task 4: Meteor stream

Adds the constant meteor flow — spawning, falling, drifting, rendering with trails, bursting on the platform, and culling. Still no collision, so the flame passes through them.

**Files:**
- Modify: `js/qte.js` (the `YARTHUL NEW QTE` IIFE)

**Interfaces:**
- Consumes: `W`, `H`, `platformTop()`, `platformLeft()`, `platformRight()`, `draw()`, `loop()` from Tasks 1–2.
- Produces: `meteors` (array of `{x, y, vx, vy, r}`), `bursts` (array of `{x, y, t}`), `spawnMeteor()`, `updateMeteors(dt)`, `updateBursts(dt)`, `drawMeteor(m)`, `drawBursts()`, `spawnIntervalMs(n) → number`, `fallSpeedFrac(n) → number`, `driftFrac() → number`, and `stage` (number, currently pinned to 1).

- [ ] **Step 1: Add meteor tuning constants and ramp functions**

After the `PLAYER_H_FRAC` line, add:

```javascript
  const METEOR_R_FRAC = 0.028; // meteor head radius, as a fraction of H
  const BURST_SECS    = 0.35;  // impact ring lifetime
```

Then add a ramp block directly after the `platformRight()` helper:

```javascript
  // ---- DIFFICULTY RAMP ----
  // Speeds are fractions of canvas height so difficulty is identical at every
  // viewport size. Competitive mode uses a steeper curve, as other trainers do.
  function spawnIntervalMs(n) {
    return window._qteCompMode
      ? Math.max(170, 500 - 22 * (n - 1))
      : Math.max(260, 700 - 28 * (n - 1));
  }
  function fallSpeedFrac(n) {
    return window._qteCompMode
      ? Math.min(1.10 + 0.06 * (n - 1), 1.90)
      : Math.min(0.90 + 0.05 * (n - 1), 1.55);
  }
  function driftFrac() { return window._qteCompMode ? 0.22 : 0.18; }
```

- [ ] **Step 2: Add meteor state**

After the `flickerT` declaration, add:

```javascript
  let meteors    = [];
  let bursts     = [];
  let spawnAccum = 0; // ms accumulator driving the constant spawn cadence
  let stage      = 1;
```

- [ ] **Step 3: Add spawn and update logic**

Add after `drawFlame()`:

```javascript
  // ---- METEORS ----
  function spawnMeteor() {
    const spd = fallSpeedFrac(stage) * H;
    const r   = H * METEOR_R_FRAC;
    meteors.push({
      x:  Math.random() * W,
      y:  -r * 3,
      vx: (Math.random() * 2 - 1) * driftFrac() * spd,
      vy: spd,
      r:  r,
    });
  }

  function updateMeteors(dt) {
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;

      if (m.y >= platformTop()) {
        if (m.x >= platformLeft() && m.x <= platformRight()) {
          bursts.push({ x: m.x, y: platformTop(), t: 0 });
        }
        meteors.splice(i, 1);
      } else if (m.x < -m.r * 4 || m.x > W + m.r * 4) {
        meteors.splice(i, 1);
      }
    }
  }

  function updateBursts(dt) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      bursts[i].t += dt;
      if (bursts[i].t >= BURST_SECS) bursts.splice(i, 1);
    }
  }
```

- [ ] **Step 4: Add meteor and burst rendering**

Add directly after `updateBursts()`:

```javascript
  function drawMeteor(m) {
    const len = m.r * 5;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(Math.atan2(m.vy, m.vx) - Math.PI / 2);
    ctx.globalCompositeOperation = 'lighter';

    const tail = ctx.createLinearGradient(0, 0, 0, -len);
    tail.addColorStop(0, 'rgba(255, 170, 60, 0.75)');
    tail.addColorStop(1, 'rgba(255, 80, 0, 0)');
    ctx.beginPath();
    ctx.moveTo(-m.r * 0.75, 0);
    ctx.lineTo(0, -len);
    ctx.lineTo(m.r * 0.75, 0);
    ctx.closePath();
    ctx.fillStyle = tail;
    ctx.fill();

    const head = ctx.createRadialGradient(0, 0, 0, 0, 0, m.r * 1.6);
    head.addColorStop(0,   '#fff3c4');
    head.addColorStop(0.4, '#ff9a2e');
    head.addColorStop(1,   'rgba(200, 40, 0, 0)');
    ctx.beginPath();
    ctx.arc(0, 0, m.r * 1.6, 0, Math.PI * 2);
    ctx.fillStyle = head;
    ctx.fill();

    ctx.restore();
  }

  function drawBursts() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of bursts) {
      const p = b.t / BURST_SECS;
      ctx.beginPath();
      ctx.arc(b.x, b.y, H * METEOR_R_FRAC * (1 + p * 3), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 150, 50, ' + (1 - p).toFixed(3) + ')';
      ctx.lineWidth   = Math.max(1, H * 0.008 * (1 - p));
      ctx.stroke();
    }
    ctx.restore();
  }
```

The head is drawn at the origin with the tail extending to `-len`, and the canvas is rotated so "up" points back along the velocity vector — a meteor falling straight down gets a vertical tail above it, and a drifting one gets a slanted tail.

- [ ] **Step 5: Render meteors in `draw()`**

Replace `draw()` with:

```javascript
  function draw() {
    drawBackdrop();
    for (const m of meteors) drawMeteor(m);
    drawBursts();
    drawFlame(playerX, platformTop(), H * PLAYER_H_FRAC, flickerT);
  }
```

- [ ] **Step 6: Spawn on a constant cadence in the loop**

In `loop()`, after the `clampPlayer();` line and before `draw();`, add:

```javascript
    spawnAccum += dt * 1000;
    const iv = spawnIntervalMs(stage);
    while (spawnAccum >= iv) { spawnMeteor(); spawnAccum -= iv; }

    updateMeteors(dt);
    updateBursts(dt);
```

Draining the accumulator in a `while` loop keeps the cadence exactly constant even when frames are uneven — a long frame spawns the meteors it owed rather than dropping them.

- [ ] **Step 7: Verify in the browser**

Reload, open the Yar'Thul tab.

Expected:
- Meteors fall continuously from the top of the canvas at an even, unbroken cadence — no visible bursts of several at once followed by gaps.
- Each has a glowing head and a tapered trail pointing back along its travel; drifting ones are visibly slanted.
- Meteors landing on the platform produce a brief expanding orange ring; ones landing off the platform's span simply vanish.
- The flame still moves with A/D and passes harmlessly through meteors (collision is Task 5).
- After a minute of watching, the frame rate is steady — meteors are being culled, not accumulating. Confirm in the console: `document.querySelector('#yarthul-new-qte-canvas')` still renders smoothly and the tab's CPU use is flat.
- Console has zero errors.

- [ ] **Step 8: Stop for review**

Do not commit. Report what changed (`js/qte.js`) and wait for the repo owner to review and commit.

---

### Task 5: Collision, stages, scoring, and run lifecycle

Turns the sandbox into a game: hit detection ends the run, stages advance on a timer, Start and Resume work, and the score is stages cleared.

**Files:**
- Modify: `js/qte.js` (the `YARTHUL NEW QTE` IIFE)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: `stageDuration(n) → number`, `playerHitCircle() → {x, y, r}`, `checkCollision() → boolean`, `onStageCleared()`, `onHit()`, `startGame()`, `resumeGame()`, `resetToStart()`, and state `running`, `gameStarted`, `paused`, `score`, `stageTimer`, `transitioning`, `transitionTimer`.

- [ ] **Step 1: Add stage tuning constants and the duration function**

After the `BURST_SECS` line, add:

```javascript
  const BASE_STAGE_SECS = 5;   // stage 1 duration
  const STAGE_STEP_SECS = 1;   // added per stage
  const MAX_STAGE_SECS  = 20;  // cap, reached at stage 16
  const TRANSITION_SECS = 1.5; // "Stage N" banner between stages
  const PLAYER_HIT_FRAC = 0.60; // hit radius vs. drawn flame half-width
```

And add next to the ramp functions:

```javascript
  function stageDuration(n) {
    return Math.min(BASE_STAGE_SECS + (n - 1) * STAGE_STEP_SECS, MAX_STAGE_SECS);
  }
```

- [ ] **Step 2: Add run state**

After the `stage` declaration, add:

```javascript
  let running         = false;
  let gameStarted     = false;
  let paused          = false;
  let score           = 0; // stages fully cleared
  let stageTimer      = 0; // seconds left in the current stage
  let transitioning   = false;
  let transitionTimer = 0;
```

- [ ] **Step 3: Add collision detection**

Add after `drawBursts()`:

```javascript
  // ---- COLLISION ----
  // The hit circle is deliberately smaller than the drawn flame so near-misses
  // read as fair.
  function playerHitCircle() {
    const h = H * PLAYER_H_FRAC;
    const w = h * 0.45;
    return { x: playerX, y: platformTop() - h * 0.45, r: w * PLAYER_HIT_FRAC };
  }

  function checkCollision() {
    const p = playerHitCircle();
    for (const m of meteors) {
      if (Math.hypot(m.x - p.x, m.y - p.y) <= m.r + p.r) return true;
    }
    return false;
  }
```

- [ ] **Step 4: Add stage progression and the hit handler**

Add directly after `checkCollision()`:

```javascript
  // ---- RUN LIFECYCLE ----
  function onStageCleared() {
    score = stage;
    stage++;
    meteors         = [];
    spawnAccum      = 0;
    transitioning   = true;
    transitionTimer = TRANSITION_SECS;
    setStatus('Stage ' + stage, '#ffb070');
    if (stageEl) stageEl.textContent = 'Stage ' + stage;
  }

  function onHit() {
    running     = false;
    gameStarted = false;
    stopLoop();
    setStatus('Hit! Cleared ' + score + (score === 1 ? ' stage' : ' stages'), '#e05555');
    draw();
    if (startBtn)  { startBtn.style.display  = ''; startBtn.textContent = 'Start'; }
    if (resumeBtn) resumeBtn.style.display = 'none';
  }
```

- [ ] **Step 5: Add the stage clock and collision to the loop**

Replace the body of `loop()` with:

```javascript
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    flickerT += dt;

    if (running) {
      if (transitioning) {
        transitionTimer -= dt;
        if (transitionTimer <= 0) {
          transitioning = false;
          stageTimer    = stageDuration(stage);
          setStatus('Avoid the meteors', '#ff8844');
        }
      } else {
        spawnAccum += dt * 1000;
        const iv = spawnIntervalMs(stage);
        while (spawnAccum >= iv) { spawnMeteor(); spawnAccum -= iv; }
      }
    }

    const dir = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
    playerX += dir * PLAYER_SPEED_FRAC * W * dt;
    clampPlayer();

    updateMeteors(dt);
    updateBursts(dt);

    if (running && !transitioning) {
      if (checkCollision()) { onHit(); return; }
      stageTimer -= dt;
      if (stageTimer <= 0) onStageCleared();
    }

    draw();
    animFrame = requestAnimationFrame(loop);
  }
```

Meteors already in flight keep falling during the transition banner, but collision is skipped — the player gets a guaranteed breather without the screen freezing.

- [ ] **Step 6: Add start, resume, and reset**

Add after `onHit()`:

```javascript
  function startGame() {
    stage           = 1;
    score           = 0;
    stageTimer      = stageDuration(1);
    meteors         = [];
    bursts          = [];
    spawnAccum      = 0;
    transitioning   = false;
    transitionTimer = 0;
    playerX         = W / 2;
    moveLeft = moveRight = false;
    running     = true;
    gameStarted = true;
    paused      = false;
    setStatus('Avoid the meteors', '#ff8844');
    if (stageEl)   stageEl.textContent = 'Stage 1';
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    startLoop();
  }

  function resumeGame() {
    paused  = false;
    running = true;
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('Avoid the meteors', '#ff8844');
    startLoop();
  }

  function resetToStart() {
    running     = false;
    gameStarted = false;
    paused      = false;
    stopLoop();
    meteors = [];
    bursts  = [];
    stage   = 1;
    score   = 0;
    setStatus('Press Start', '#888');
    if (stageEl)   stageEl.textContent = '';
    if (startBtn)  { startBtn.style.display  = ''; startBtn.textContent = 'Start'; }
    if (resumeBtn) resumeBtn.style.display = 'none';
  }

  if (startBtn)  startBtn.addEventListener('click', startGame);
  if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);
```

- [ ] **Step 7: Pause when the tab is hidden**

Replace the show/hide hooks with:

```javascript
  window._onYarthulNewQteShow = function () {
    resizeCanvas();
    if (!gameStarted) { resetToStart(); draw(); }
    else if (paused)  { draw(); }
    else              { startLoop(); }
  };

  window._onYarthulNewQteHide = function () {
    if (running) {
      paused  = false;
      running = false;
      stopLoop();
      gameStarted = false;
      setStatus('Press Start', '#888');
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
    } else {
      stopLoop();
    }
  };
```

Leaving the panel abandons the run rather than banking it — a paused run that could be resumed after inspecting another tab would be exploitable on the leaderboard.

- [ ] **Step 8: Verify in the browser**

Reload, open the Yar'Thul tab, press Start.

Expected:
- Status reads "Avoid the meteors", the stage counter reads "Stage 1", and the Start button disappears.
- Standing still under falling meteors ends the run: status turns red reading "Hit! Cleared 0 stages" and Start reappears.
- Surviving 5 seconds shows a "Stage 2" banner for about 1.5s with the field cleared, then resumes.
- Time each of the first three stages with a stopwatch: about 5s, 6s, 7s.
- Meteors visibly speed up and grow denser by stage 5 or so.
- Being hit during stage 4 reports "Cleared 3 stages".
- Switching to another QTE tab mid-run and back resets to "Press Start" — the run does not continue in the background.
- Console has zero errors.

- [ ] **Step 9: Stop for review**

Do not commit. Report what changed (`js/qte.js`) and wait for the repo owner to review and commit.

---

### Task 6: Trainer contract — highscores, modes, leaderboard, matchmaking

Connects the trainer to the site-wide systems: persistent bests per mode, competitive-mode switching, the leaderboard, and matchmaking.

**Files:**
- Modify: `js/qte.js` (the `YARTHUL NEW QTE` IIFE)
- Modify: `js/sb.js:1313-1314` (`QTE_TYPES`, `QTE_LABELS`) and `js/sb.js:1777` (`_ALL_QTE_TYPES`)
- Modify: `js/matchmaking.js:40` (the `QTES` array)

**Interfaces:**
- Consumes: `score`, `onHit()`, `onStageCleared()` from Task 5; `window._qteCompMode`, `window._qteMatch`, `window._sbSubmitScore` from the site.
- Produces: `updateHs(val)`, plus registry entries making `yarthul-new` selectable in the leaderboard and matchmaking UIs.

- [ ] **Step 1: Add highscore state**

After the element lookups at the top of the IIFE, add:

```javascript
  const HS_KEY      = 'alb:yarthul-new-hs';
  const HS_KEY_COMP = 'alb:yarthul-new-hs-comp';
  let highscore     = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
  let highscoreComp = parseInt(localStorage.getItem(HS_KEY_COMP) || '0', 10);
```

- [ ] **Step 2: Add the highscore updater**

Add directly after `setStatus()`:

```javascript
  function updateHs(val) {
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.report(val); return; }
    if (window._qteCompMode) {
      if (val > highscoreComp) {
        highscoreComp = val;
        try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch (e) {}
        if (window._sbSubmitScore) window._sbSubmitScore('yarthul-new-comp', val);
      }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? 'Best: ' + highscoreComp : '';
    } else {
      if (val > highscore) {
        highscore = val;
        try { localStorage.setItem(HS_KEY, highscore); } catch (e) {}
        if (window._sbSubmitScore) window._sbSubmitScore('yarthul-new', val);
      }
      if (hsEl) hsEl.textContent = highscore > 0 ? 'Best: ' + highscore : '';
    }
  }
  updateHs(0);

  window.addEventListener('alb-scores-reset', () => {
    highscore = 0; highscoreComp = 0;
    localStorage.removeItem(HS_KEY);
    localStorage.removeItem(HS_KEY_COMP);
    updateHs(0);
  });
  window.addEventListener('alb-mode-changed', () => updateHs(0));
```

- [ ] **Step 3: Report the score on stage clear and on hit**

In `onStageCleared()`, after `score = stage;` add:

```javascript
    updateHs(score);
```

In `onHit()`, replace the whole function body with:

```javascript
    running     = false;
    gameStarted = false;
    stopLoop();
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.fail(); return; }
    updateHs(score);
    setStatus('Hit! Cleared ' + score + (score === 1 ? ' stage' : ' stages'), '#e05555');
    draw();
    if (startBtn)  { startBtn.style.display  = ''; startBtn.textContent = 'Start'; }
    if (resumeBtn) resumeBtn.style.display = 'none';
```

- [ ] **Step 4: Guard the loop against running off-page**

In `loop()`, directly after the `const dt = ...` and `lastTime` lines, add:

```javascript
    const onPage = document.getElementById('page-qte');
    if (!(onPage && onPage.classList.contains('active')) &&
        !(window._qteMatch && window._qteMatch.active)) {
      stopLoop();
      return;
    }
```

- [ ] **Step 5: Register with the leaderboard**

In `js/sb.js`, change the `QTE_TYPES` line to append the new id:

```javascript
  const QTE_TYPES = ['dagger', 'spear', 'sword', 'fist', 'staff', 'axe', 'hammer', 'dodge', 'thorian', 'thorian-new', 'dagger-new', 'yarthul-new'];
```

And the labels line:

```javascript
  const QTE_LABELS = { 'thorian-new': 'Thorian (New)', 'dagger-new': 'Dagger (New)', 'yarthul-new': "Yar'Thul (New)" };
```

Note the double quotes on the new value — the apostrophe would terminate a single-quoted string.

And append both ids to `_ALL_QTE_TYPES`:

```javascript
  const _ALL_QTE_TYPES = ['dagger','spear','sword','fist','staff','axe','hammer','dodge','thorian','thorian-new','yarthul-new','dagger-comp','spear-comp','sword-comp','fist-comp','staff-comp','axe-comp','hammer-comp','dodge-comp','thorian-comp','thorian-new-comp','yarthul-new-comp'];
```

Leave the missing `dagger-new` entry in `_ALL_QTE_TYPES` alone — it is a pre-existing gap and out of scope.

- [ ] **Step 6: Register with matchmaking**

In `js/matchmaking.js`, add a fourth entry to the `QTES` array after the `dagger-new` line:

```javascript
    { id: 'yarthul-new', label: "Yar'Thul", group: 'new', hook: 'YarthulNew' },
```

Double quotes again, for the same reason.

- [ ] **Step 7: Verify in the browser**

Reload and open the Yar'Thul tab.

Expected:
- Clear two stages, then get hit. `Best: 2` appears in the header.
- Reload the page — `Best: 2` persists.
- Confirm storage in the console: `localStorage.getItem('alb:yarthul-new-hs')` returns `"2"`.
- Toggle the Casual/Competitive button. The best resets to blank (a separate competitive record), meteors fall faster and denser on a new run, and toggling back restores `Best: 2`.
- After a competitive run, `localStorage.getItem('alb:yarthul-new-hs-comp')` holds that score.
- Click the **Leaderboard** button — the Yar'Thul board opens without error.
- Open the all-leaderboards view and confirm a "Yar'Thul (New)" card appears.
- Open Matchmaking and confirm **Yar'Thul** is selectable under the New group.
- Console has zero errors.

- [ ] **Step 8: Stop for review**

Do not commit. Report what changed (`js/qte.js`, `js/sb.js`, `js/matchmaking.js`) and wait for the repo owner to review and commit.

---

## Post-Implementation Tuning

The ramp values are estimates derived from reference footage, not measurements. Once the trainer is playable, compare it against the real encounter and adjust these four functions, all adjacent at the top of the module:

- `stageDuration(n)` — stage length curve
- `spawnIntervalMs(n)` — meteor density
- `fallSpeedFrac(n)` — reaction time
- `driftFrac()` — how diagonal the fall is

`PLAYER_SPEED_FRAC` and `PLAYER_HIT_FRAC` control how the dodging itself feels: how fast the flame crosses the platform, and how forgiving contact is.
