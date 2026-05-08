// === FIST QTE TRAINER ===
(function () {
  const ARROWS = [
    { dir: 'up',    symbol: '↑', keys: ['ArrowUp',    'w', 'W'] },
    { dir: 'down',  symbol: '↓', keys: ['ArrowDown',  's', 'S'] },
    { dir: 'left',  symbol: '←', keys: ['ArrowLeft',  'a', 'A'] },
    { dir: 'right', symbol: '→', keys: ['ArrowRight', 'd', 'D'] },
  ];

  const bar      = document.getElementById('fist-qte-bar');
  const status   = document.getElementById('fist-qte-status');
  const streakEl = document.getElementById('fist-qte-streak');
  const timerEl  = document.getElementById('fist-qte-timer');
  const startBtn = document.getElementById('fist-qte-start-btn');
  const hsEl     = document.getElementById('fist-qte-highscore');
  if (!bar) return;

  const HS_KEY      = 'alb:fist-hs';
  const HS_KEY_COMP = 'alb:fist-hs-comp';
  const AVG_KEY = 'alb:fist-avg';
  const avgEl   = document.getElementById('fist-qte-avgtime');

  let highscore     = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
  let highscoreComp = parseInt(localStorage.getItem(HS_KEY_COMP) || '0', 10);

  let _avgData = (() => {
    try { return JSON.parse(localStorage.getItem(AVG_KEY)) || { total: 0, count: 0 }; } catch (e) { return { total: 0, count: 0 }; }
  })();
  let roundStart = 0;

  function updateHighscore(val) {
    if (window._qteCompMode) {
      if (val > highscoreComp) { highscoreComp = val; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('fist-comp', val); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? `Best: ${highscoreComp}` : '';
    } else {
      if (val > highscore) { highscore = val; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('fist', val); }
      if (hsEl) hsEl.textContent = highscore > 0 ? `Best: ${highscore}` : '';
    }
  }
  updateHighscore(0);
  window.addEventListener('alb-scores-reset', () => { highscore = 0; highscoreComp = 0; localStorage.removeItem(HS_KEY); localStorage.removeItem(HS_KEY_COMP); updateHighscore(0); });
  window.addEventListener('alb-mode-changed', () => updateHighscore(0));

  function recordRoundTime() {
    if (!roundStart) return;
    const elapsed = (Date.now() - roundStart) / 1000;
    _avgData.total += elapsed;
    _avgData.count++;
    try { localStorage.setItem(AVG_KEY, JSON.stringify(_avgData)); } catch (e) {}
    if (avgEl) avgEl.textContent = `Avg: ${(_avgData.total / _avgData.count).toFixed(1)}s`;
  }

  function initAvgDisplay() {
    if (avgEl && _avgData.count > 0)
      avgEl.textContent = `Avg: ${(_avgData.total / _avgData.count).toFixed(1)}s`;
  }
  initAvgDisplay();

  const resumeBtn = document.getElementById('fist-qte-resume-btn');

  let sequence       = [];
  let current        = 0;
  let length         = 2;
  let streak         = 0;
  let running        = false;
  let lockout        = false;
  let started        = false;
  let paused         = false;
  let timerInterval  = null;
  let timeLeft       = 0;
  let restartTimeout = null;

  function getTimeLimit() { return window._qteCompMode ? (length >= 6 ? 4 : 6) : (length >= 8 ? 5 : 8); }

  function startTimer() {
    clearInterval(timerInterval);
    timeLeft = getTimeLimit();
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      timeLeft--;
      updateTimerDisplay();
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        onTimeout();
      }
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    if (timerEl) timerEl.textContent = '';
  }

  function updateTimerDisplay() {
    if (!timerEl) return;
    timerEl.textContent = timeLeft + 's';
    timerEl.style.color = timeLeft <= 2 ? '#ee8888' : '#aaaaff';
  }

  function onTimeout() {
    lockout = true;
    running = false;
    bar.querySelectorAll('.fist-arrow-box').forEach(b => b.classList.add('wrong'));
    streak = 0;
    length = 2;
    setStatus('⏱ Time\'s up!', '#ee8888');
    streakEl.textContent = '';
    restartTimeout = setTimeout(startRound, 900);
  }

  function randomArrow() {
    return ARROWS[Math.floor(Math.random() * ARROWS.length)];
  }

  function buildSequence() {
    sequence = Array.from({ length }, randomArrow);
  }

  function renderBar() {
    bar.innerHTML = '';
    sequence.forEach((arrow, i) => {
      const box = document.createElement('div');
      box.className = 'fist-arrow-box' + (i === current ? ' active' : '');
      box.textContent = arrow.symbol;
      bar.appendChild(box);
    });
  }

  function setStatus(text, color) {
    status.textContent = text;
    status.style.color = color || '#888';
  }

  function flashBox(idx, cls, cb) {
    const boxes = bar.querySelectorAll('.fist-arrow-box');
    if (!boxes[idx]) { if (cb) cb(); return; }
    boxes[idx].classList.remove('active');
    boxes[idx].classList.add(cls);
    setTimeout(() => { if (cb) cb(); }, 300);
  }

  function resetToStart() {
    clearTimeout(restartTimeout);
    stopTimer();
    started = false;
    paused  = false;
    running = false;
    lockout = false;
    bar.innerHTML = '';
    setStatus('', '#888');
    streakEl.textContent = '';
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
  }

  function startRound() {
    restartTimeout = null;
    buildSequence();
    current = 0;
    running = true;
    lockout = false;
    paused  = false;
    started = true;
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('Go!', '#aaaaff');
    renderBar();
    streakEl.textContent = streak > 0 ? `Streak: ${streak}` : '';
    startTimer();
    roundStart = Date.now();
  }

  function onSuccess() {
    stopTimer();
    lockout = true;
    flashBox(current - 1, 'correct', () => {
      streak++;
      length = Math.min(length + 1, 9);
      setStatus(`✓ Nice! Next: ${length} arrows`, '#88ee88');
      streakEl.textContent = `Streak: ${streak}`;
      updateHighscore(streak);
      recordRoundTime();
      restartTimeout = setTimeout(startRound, 600);
    });
  }

  function onFail(key) {
    stopTimer();
    lockout = true;
    running = false;
    const boxes = bar.querySelectorAll('.fist-arrow-box');
    boxes.forEach((b, i) => { if (i >= current) b.classList.add('wrong'); });
    streak = 0;
    length = 2;
    setStatus(`✗ Wrong! Expected ${sequence[current].symbol}, got ${keyToSymbol(key)}`, '#ee8888');
    streakEl.textContent = '';
    restartTimeout = setTimeout(startRound, 900);
  }

  function keyToSymbol(key) {
    if (['ArrowUp',    'w', 'W'].includes(key)) return '↑';
    if (['ArrowDown',  's', 'S'].includes(key)) return '↓';
    if (['ArrowLeft',  'a', 'A'].includes(key)) return '←';
    if (['ArrowRight', 'd', 'D'].includes(key)) return '→';
    return key;
  }

  document.addEventListener('keydown', e => {
    const isArrow = ARROWS.some(a => a.keys.includes(e.key));
    if (!isArrow) return;

    // Don't capture keys while the user is typing in an input / textarea
    if (!document.getElementById('page-qte')?.classList.contains('active')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SUMMARY' || tag === 'BUTTON' || document.activeElement?.isContentEditable) return;

    // Prevent page scroll on arrow keys only when QTE panel is visible
    const panel = document.getElementById('qte-panel-fist');
    if (panel && panel.style.display !== 'none') e.preventDefault();
    else return;

    if (!started || lockout || paused) return;

    const expected = sequence[current];
    const matched  = expected.keys.includes(e.key);

    if (matched) {
      window._playQteSfx('fist', true);
      flashBox(current, 'correct', () => {});
      current++;
      if (current === sequence.length) {
        onSuccess();
      } else {
        // Highlight next box
        const boxes = bar.querySelectorAll('.fist-arrow-box');
        if (boxes[current]) boxes[current].classList.add('active');
      }
    } else {
      onFail(e.key);
    }
  });

  // Start button
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      length = 2; streak = 0;
      startRound();
    });
  }

  // Resume button
  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => {
      if (!paused) return;
      paused  = false;
      lockout = false;
      // Re-randomize arrows but keep remaining time
      buildSequence();
      current = 0;
      renderBar();
      if (resumeBtn) resumeBtn.style.display = 'none';
      setStatus('Go!', '#aaaaff');
      updateTimerDisplay();
      timerInterval = setInterval(() => {
        timeLeft--;
        updateTimerDisplay();
        if (timeLeft <= 0) {
          clearInterval(timerInterval);
          onTimeout();
        }
      }, 1000);
      roundStart = Date.now() - ((getTimeLimit() - timeLeft) * 1000);
    });
  }

  // Called when user leaves the fist tab
  window._onFistQteHide = function () {
    if (paused) return; // already paused
    if (started && running && !lockout) {
      // Mid-run — pause
      clearInterval(timerInterval);
      paused = true;
    } else {
      // Lost, pending restart, or not started — reset to Start
      resetToStart();
      streak = 0;
      length = 2;
    }
  };

  // Called when user returns to the fist tab
  window._onFistQteShow = function () {
    if (paused) {
      if (resumeBtn) resumeBtn.style.display = '';
      if (startBtn)  startBtn.style.display  = 'none';
    } else {
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
    }
  };

  // Mobile D-pad
  if (IS_MOBILE) {
    const dpad = document.createElement('div');
    dpad.className = 'fist-dpad';
    dpad.innerHTML =
      '<div class="fist-dpad-row"><button class="fist-dpad-btn" data-key="ArrowUp">↑</button></div>' +
      '<div class="fist-dpad-row">' +
        '<button class="fist-dpad-btn" data-key="ArrowLeft">←</button>' +
        '<button class="fist-dpad-btn" data-key="ArrowDown">↓</button>' +
        '<button class="fist-dpad-btn" data-key="ArrowRight">→</button>' +
      '</div>';
    dpad.querySelectorAll('.fist-dpad-btn').forEach(btn => {
      btn.addEventListener('touchstart', e => {
        e.preventDefault();
        if (!started || lockout || paused) return;
        const key = btn.dataset.key;
        const expected = sequence[current];
        const matched  = expected.keys.includes(key);
        if (matched) {
          window._playQteSfx('fist', true);
          flashBox(current, 'correct', () => {});
          current++;
          if (current === sequence.length) {
            onSuccess();
          } else {
            const boxes = bar.querySelectorAll('.fist-arrow-box');
            if (boxes[current]) boxes[current].classList.add('active');
          }
        } else {
          onFail(key);
        }
      }, { passive: false });
    });
    bar.parentNode.insertBefore(dpad, bar.nextSibling);
  }

  // Bar hidden until Start is pressed
  bar.innerHTML = '';
  setStatus('', '#888');
})();

// === SPEAR QTE TRAINER (osu!-style) ===
(function () {
  const canvas     = document.getElementById('spear-qte-canvas');
  if (!canvas) return;
  const ctx        = canvas.getContext('2d');
  const statusEl   = document.getElementById('spear-qte-status');
  const streakEl   = document.getElementById('spear-qte-streak');
  const hsEl       = document.getElementById('spear-qte-highscore');
  const startBtn   = document.getElementById('spear-qte-start-btn');
  const resumeBtn  = document.getElementById('spear-qte-resume-btn');

  const HS_KEY      = 'alb:spear-hs';
  const HS_KEY_COMP = 'alb:spear-hs-comp';
  let highscore     = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
  let highscoreComp = parseInt(localStorage.getItem(HS_KEY_COMP) || '0', 10);

  // Game state
  let running       = false;
  let gameStarted   = false;
  let paused        = false;
  let streak        = 0;
  let animFrame     = null;
  let circles       = []; // active hittable circles only
  let dying         = []; // visual-only fading circles (not clickable)
  let nextSpawn     = 0;
  let lastMissGuard = 0;
  let pauseTime     = 0;

  // Circle constants — INNER_R is updated in resizeCanvas for mobile
  let INNER_R         = 52;
  let OUTER_R_START   = INNER_R * 2.2;
  const HIT_TOLERANCE = 22;
  const FADE_MS       = 280;

  // starts at 4, caps at 8
  function getMaxSimul()      { return window._qteCompMode ? Math.min(5 + Math.floor(streak / 3), 10) : Math.min(4 + Math.floor(streak / 4), 8); }
  function getApproachMs()    { return window._qteCompMode ? Math.max(700, 950 - streak * 3)            : Math.max(850, 1100 - streak * 2); }
  function getSpawnInterval() { return window._qteCompMode ? Math.max(400, 850 - streak * 12)           : Math.max(550, 1000 - streak * 10); }

  // ---- highscore ----
  function updateHighscore(val) {
    if (window._qteCompMode) {
      if (val > highscoreComp) { highscoreComp = val; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('spear-comp', val); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? `Best: ${highscoreComp}` : '';
    } else {
      if (val > highscore) { highscore = val; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('spear', val); }
      if (hsEl) hsEl.textContent = highscore > 0 ? `Best: ${highscore}` : '';
    }
  }
  updateHighscore(0);
  window.addEventListener('alb-scores-reset', () => { highscore = 0; highscoreComp = 0; localStorage.removeItem(HS_KEY); localStorage.removeItem(HS_KEY_COMP); updateHighscore(0); });
  window.addEventListener('alb-mode-changed', () => updateHighscore(0));

  function setStatus(text, color) {
    if (statusEl) { statusEl.textContent = text; statusEl.style.color = color || '#888'; }
  }

  // ---- canvas sizing ----
  function resizeCanvas() {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    canvas.width = Math.min(wrap.clientWidth - 24 || 800, 900);
    const tall = IS_MOBILE || canvas.width < 480;
    canvas.height = tall
      ? Math.min(Math.round(canvas.width * 0.65), 400)
      : Math.min(Math.round(canvas.width * 0.38), 340);
    INNER_R      = Math.min(52, Math.round(canvas.height * 0.26));
    OUTER_R_START = INNER_R * 2.2;
  }

  // ---- spawn ----
  function spawnCircle(now) {
    const margin  = OUTER_R_START + 10;
    const minDist = INNER_R * 2 + 20;
    let x, y, attempts = 0, valid = false;
    do {
      x = margin + Math.random() * (canvas.width  - margin * 2);
      y = margin + Math.random() * (canvas.height - margin * 2);
      attempts++;
      valid = !circles.some(c => Math.hypot(x - c.x, y - c.y) < minDist);
    } while (!valid && attempts < 30);
    if (!valid) return false; // no valid position found — skip this spawn
    circles.push({ x, y, spawnTime: now, duration: getApproachMs() });
    return true;
  }

  // ---- draw ----
  function drawFrame(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#12121e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw dying circles first (purely visual, behind active ones)
    for (let i = dying.length - 1; i >= 0; i--) {
      const d     = dying[i];
      const alpha = Math.max(0, 1 - (now - d.dieTime) / FADE_MS);
      if (alpha <= 0) { dying.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(d.x, d.y, INNER_R, 0, Math.PI * 2);
      ctx.fillStyle   = d.hit ? 'rgba(100,230,120,0.25)' : 'rgba(230,80,80,0.25)';
      ctx.strokeStyle = d.hit ? '#66ee88' : '#ee6666';
      ctx.lineWidth = 3;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Draw active (hittable) circles
    for (const c of circles) {
      const elapsed  = now - c.spawnTime;
      const progress = Math.min(elapsed / c.duration, 1);
      const outerR   = INNER_R + (OUTER_R_START - INNER_R) * (1 - progress);

      ctx.beginPath();
      ctx.arc(c.x, c.y, INNER_R, 0, Math.PI * 2);
      ctx.fillStyle   = 'rgba(160,160,255,0.12)';
      ctx.strokeStyle = '#aaaaff';
      ctx.lineWidth = 3;
      ctx.fill();
      ctx.stroke();

      const nearness = 1 - (outerR - INNER_R) / (OUTER_R_START - INNER_R);
      const r = Math.round(180 + nearness * 75);
      const g = Math.round(120 - nearness * 60);
      ctx.beginPath();
      ctx.arc(c.x, c.y, outerR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r},${g},40,0.9)`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  // ---- miss/fail ----
  function triggerMiss(msg) {
    const now = Date.now();
    if (now - lastMissGuard < 120) return;
    lastMissGuard = now;
    if (!running) return;
    running = false;
    paused  = false;
    updateHighscore(streak);
    setStatus(msg, '#ee6666');
    streakEl.textContent = '';
    setTimeout(resetToStart, 850);
  }

  // ---- reset to start screen ----
  function resetToStart() {
    cancelAnimationFrame(animFrame);
    running     = false;
    gameStarted = false;
    paused      = false;
    circles     = [];
    dying       = [];
    canvas.style.display = 'none';
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
  }

  // ---- game loop ----
  function gameLoop(now) {
    if (!running) return;

    // Check for missed circles (outer ring passed) — move to dying, trigger fail
    for (let i = circles.length - 1; i >= 0; i--) {
      const c = circles[i];
      const progress = (now - c.spawnTime) / c.duration;
      if (progress >= 1) {
        dying.push({ x: c.x, y: c.y, dieTime: now, hit: false });
        circles.splice(i, 1);
        triggerMiss('Miss! Too slow.');
        return;
      }
    }

    // Spawn new circles
    if (now >= nextSpawn && circles.length < getMaxSimul()) {
      const spawned = spawnCircle(now);
      nextSpawn = now + (spawned ? getSpawnInterval() : 120);
    }

    drawFrame(now);
    animFrame = requestAnimationFrame(gameLoop);
  }

  // ---- start ----
  function startGame() {
    streak        = 0;
    running       = true;
    gameStarted   = true;
    paused        = false;
    circles       = [];
    dying         = [];
    lastMissGuard = 0;
    resizeCanvas();
    canvas.style.display = '';
    nextSpawn = performance.now() + 300;
    setStatus('Click when the ring reaches the circle!', '#aaaaff');
    streakEl.textContent = '';
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    animFrame = requestAnimationFrame(gameLoop);
  }

  // ---- resume ----
  function resumeGame() {
    if (!paused) return;
    // Shift all circle timestamps forward by how long we were paused
    const pausedFor = performance.now() - pauseTime;
    circles.forEach(c => { c.spawnTime += pausedFor; if (c.fadeStart) c.fadeStart += pausedFor; });
    nextSpawn += pausedFor;
    paused  = false;
    running = true;
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('Go!', '#aaaaff');
    animFrame = requestAnimationFrame(gameLoop);
  }

  // ---- click / touch handler ----
  function handleSpearHit(clientX, clientY) {
    if (!running) return;
    const rect = canvas.getBoundingClientRect();
    const mx   = clientX - rect.left;
    const my   = clientY - rect.top;
    const now  = performance.now();

    for (let i = 0; i < circles.length; i++) {
      const c    = circles[i];
      const dist = Math.hypot(mx - c.x, my - c.y);
      if (dist > INNER_R + HIT_TOLERANCE + 6) continue;

      const elapsed  = now - c.spawnTime;
      const progress = elapsed / c.duration;
      const outerR   = INNER_R + (OUTER_R_START - INNER_R) * (1 - progress);

      // Remove from active array immediately — no lingering clickable state
      circles.splice(i, 1);

      if (outerR > INNER_R + HIT_TOLERANCE) {
        // Clicked too early
        dying.push({ x: c.x, y: c.y, dieTime: now, hit: false });
        triggerMiss('Too early!');
        return;
      }

      // Good hit
      window._playQteSfx('spear');
      dying.push({ x: c.x, y: c.y, dieTime: now, hit: true });
      streak++;
      streakEl.textContent = `Streak: ${streak}`;
      setStatus('Hit!', '#88ee88');
      updateHighscore(streak);
      return;
    }
  }
  canvas.addEventListener('click', e => handleSpearHit(e.clientX, e.clientY));
  if (IS_MOBILE) {
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      handleSpearHit(t.clientX, t.clientY);
    }, { passive: false });
  }

  if (startBtn)  startBtn.addEventListener('click',  startGame);
  if (resumeBtn) resumeBtn.addEventListener('click',  resumeGame);

  // ---- tab hooks ----
  window._onSpearQteHide = function () {
    if (paused) return; // already paused
    if (gameStarted && running) {
      // mid-run — pause
      cancelAnimationFrame(animFrame);
      running   = false;
      paused    = true;
      pauseTime = performance.now();
    } else {
      // failed, pending restart, or not started — full reset
      resetToStart();
      streak = 0;
    }
  };

  window._onSpearQteShow = function () {
    resizeCanvas();
    if (paused) {
      if (resumeBtn) resumeBtn.style.display = '';
      if (startBtn)  startBtn.style.display  = 'none';
      setStatus('Paused', '#888');
    } else {
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
      ctx.fillStyle = '#12121e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setStatus('', '#888');
      streakEl.textContent = '';
    }
  };

  // Hide canvas until Start is pressed
  canvas.style.display = 'none';
})();

// === SWORD QTE TRAINER ===
(function () {
  const canvas    = document.getElementById('sword-qte-canvas');
  if (!canvas) return;
  const ctx       = canvas.getContext('2d');
  const statusEl  = document.getElementById('sword-qte-status');
  const streakEl  = document.getElementById('sword-qte-streak');
  const hsEl      = document.getElementById('sword-qte-highscore');
  const startBtn  = document.getElementById('sword-qte-start-btn');
  const resumeBtn = document.getElementById('sword-qte-resume-btn');

  const HS_KEY      = 'alb:sword-hs';
  const HS_KEY_COMP = 'alb:sword-hs-comp';
  let highscore     = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
  let highscoreComp = parseInt(localStorage.getItem(HS_KEY_COMP) || '0', 10);

  let running     = false;
  let gameStarted = false;
  let paused      = false;
  let streak      = 0;
  let animFrame   = null;
  let lastTime    = 0;
  let bars        = [];
  let currentBar  = 0;
  let roundPending = false; // waiting to start next round

  const TRACK_H     = 26;
  const BAR_W       = 10;
  const BAR_MIN_GAP = 75;  // min px gap between bars
  const BAR_MAX_GAP = 130; // max px gap between bars (randomized)

  let trackX, trackY, trackW, zoneX, zoneW;

  function getSpeed()     { return window._qteCompMode
    ? (IS_MOBILE ? Math.min(220 + streak * 8, 420)  : Math.min(420 + streak * 14, 640))
    : (IS_MOBILE ? Math.min(160 + streak * 6, 320)  : Math.min(300 + streak * 10, 520)); }
  function getBarCount()  { return window._qteCompMode
    ? (IS_MOBILE ? Math.min(3 + Math.floor(streak / 3), 6) : Math.min(4 + Math.floor(streak / 2), 8))
    : (IS_MOBILE ? Math.min(2 + Math.floor(streak / 4), 5) : Math.min(3 + Math.floor(streak / 3), 7)); }
  function getZoneStart() { return 0.70; }
  function getZoneWidth() { return window._qteCompMode
    ? (IS_MOBILE ? Math.max(0.21 - streak * 0.007, 0.10) : Math.max(0.12 - streak * 0.004, 0.06))
    : (IS_MOBILE ? Math.max(0.28 - streak * 0.007, 0.14) : Math.max(0.16 - streak * 0.004, 0.10)); }

  function updateHighscore(v) {
    if (window._qteCompMode) {
      if (v > highscoreComp) { highscoreComp = v; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('sword-comp', v); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? `Best: ${highscoreComp}` : '';
    } else {
      if (v > highscore) { highscore = v; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('sword', v); }
      if (hsEl) hsEl.textContent = highscore > 0 ? `Best: ${highscore}` : '';
    }
  }
  updateHighscore(0);
  window.addEventListener('alb-scores-reset', () => { highscore = 0; highscoreComp = 0; localStorage.removeItem(HS_KEY); localStorage.removeItem(HS_KEY_COMP); updateHighscore(0); });
  window.addEventListener('alb-mode-changed', () => updateHighscore(0));

  function setStatus(t, c) {
    if (statusEl) { statusEl.textContent = t; statusEl.style.color = c || '#888'; }
  }

  function resizeCanvas() {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    canvas.width  = Math.min(wrap.clientWidth - 24 || 800, 900);
    const tall = IS_MOBILE || canvas.width < 480;
    canvas.height = tall
      ? Math.min(Math.round(canvas.width * 0.55), 300)
      : Math.min(Math.round(canvas.width * 0.38), 340);
    computeLayout();
  }

  function computeLayout() {
    const pad = 50;
    trackX = pad;
    trackW = canvas.width - pad * 2;
    trackY = canvas.height / 2 - TRACK_H / 2;
  }

  function computeZone() {
    zoneX = trackX + trackW * getZoneStart();
    zoneW = trackW * getZoneWidth();
  }

  function startRound() {
    roundPending = false;
    computeZone();
    const count = getBarCount();
    bars = [];
    currentBar = 0;
    // Bars stagger from left with randomized gaps so timing isn't predictable
    let xPos = trackX - BAR_W;
    for (let i = 0; i < count; i++) {
      bars.push({ x: xPos, stopped: false, inZone: false });
      xPos -= BAR_MIN_GAP + Math.random() * (BAR_MAX_GAP - BAR_MIN_GAP);
    }
    setStatus(IS_MOBILE ? 'Tap to stop each bar in the zone!' : 'Press SPACE to stop each bar in the zone!', '#aaaaff');
  }

  function drawFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#12121e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Track
    ctx.fillStyle = '#252535';
    ctx.fillRect(trackX, trackY, trackW, TRACK_H);

    // Zone
    ctx.fillStyle = 'rgba(150,150,175,0.28)';
    ctx.fillRect(zoneX, trackY, zoneW, TRACK_H);
    ctx.strokeStyle = 'rgba(190,190,220,0.65)';
    ctx.lineWidth = 2;
    ctx.strokeRect(zoneX, trackY, zoneW, TRACK_H);

    // Stopped markers
    for (let i = 0; i < currentBar; i++) {
      const b = bars[i];
      ctx.fillStyle = b.inZone ? '#66ee88' : '#ee5555';
      ctx.fillRect(b.x, trackY, BAR_W, TRACK_H);
    }

    // Moving bars
    for (let i = currentBar; i < bars.length; i++) {
      const b = bars[i];
      if (b.stopped) continue;
      ctx.fillStyle = i === currentBar ? '#ffffff' : 'rgba(200,200,255,0.4)';
      ctx.fillRect(b.x, trackY, BAR_W, TRACK_H);
    }
  }

  function gameLoop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    if (!roundPending) {
      const speed = getSpeed();
      for (const b of bars) {
        if (!b.stopped) b.x += speed * dt;
      }

      // Check if lead bar flew off the right
      const cur = bars[currentBar];
      if (cur && !cur.stopped && cur.x > trackX + trackW + BAR_W) {
        triggerFail('Too slow!');
        return;
      }
    }

    drawFrame();
    animFrame = requestAnimationFrame(gameLoop);
  }

  function onSpacePress() {
    if (!running || paused || roundPending) return;
    const cur = bars[currentBar];
    if (!cur || cur.stopped) return;

    cur.stopped = true;
    cur.inZone  = cur.x < zoneX + zoneW + 2 && cur.x + BAR_W > zoneX - 2; // any overlap with zone counts

    if (!cur.inZone) {
      triggerFail('Outside the zone!');
      return;
    }

    window._playQteSfx('sword');
    currentBar++;
    if (currentBar >= bars.length) {
      onRoundSuccess();
    }
  }

  function onRoundSuccess() {
    streak++;
    streakEl.textContent = `Streak: ${streak}`;
    updateHighscore(streak);
    setStatus(`✓ All in zone! Next: ${getBarCount()} bars`, '#88ee88');
    roundPending = true;
    setTimeout(() => {
      if (running) startRound();
    }, 800);
  }

  function triggerFail(msg) {
    if (!running && !gameStarted) return;
    running     = false;
    paused      = false;
    roundPending = false;
    updateHighscore(streak);
    drawFrame();
    setStatus(msg, '#ee5555');
    streakEl.textContent = '';
    setTimeout(resetToStart, 900);
  }

  function resetToStart() {
    cancelAnimationFrame(animFrame);
    running      = false;
    gameStarted  = false;
    paused       = false;
    roundPending = false;
    bars         = [];
    canvas.style.display = 'none';
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('', '#888');
  }

  function startGame() {
    streak       = 0;
    running      = true;
    gameStarted  = true;
    paused       = false;
    roundPending = false;
    resizeCanvas();
    canvas.style.display = '';
    lastTime = performance.now();
    streakEl.textContent = '';
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    startRound();
    animFrame = requestAnimationFrame(gameLoop);
  }

  function resumeGame() {
    if (!paused) return;
    paused   = false;
    running  = true;
    lastTime = performance.now();
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus(IS_MOBILE ? 'Tap to stop each bar in the zone!' : 'Press SPACE to stop each bar in the zone!', '#aaaaff');
    animFrame = requestAnimationFrame(gameLoop);
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    if (!document.getElementById('page-qte')?.classList.contains('active')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SUMMARY' || tag === 'BUTTON' || document.activeElement?.isContentEditable) return;
    const panel = document.getElementById('qte-panel-sword');
    if (!panel || panel.style.display === 'none') return;
    e.preventDefault();
    onSpacePress();
  });
  if (IS_MOBILE) {
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onSpacePress(); }, { passive: false });

    const swordTapBtn = document.createElement('button');
    swordTapBtn.className = 'qte-mobile-action-btn';
    swordTapBtn.textContent = 'TAP';
    swordTapBtn.style.display = 'none';
    swordTapBtn.addEventListener('touchstart', e => { e.preventDefault(); onSpacePress(); }, { passive: false });
    canvas.parentElement.appendChild(swordTapBtn);
    new MutationObserver(() => {
      swordTapBtn.style.display = canvas.style.display === 'none' ? 'none' : '';
    }).observe(canvas, { attributes: true, attributeFilter: ['style'] });
  }

  if (startBtn)  startBtn.addEventListener('click', startGame);
  if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);

  window._onSwordQteHide = function () {
    if (paused) return;
    if (gameStarted && running) {
      cancelAnimationFrame(animFrame);
      running  = false;
      paused   = true;
    } else {
      resetToStart();
      streak = 0;
    }
  };

  window._onSwordQteShow = function () {
    resizeCanvas();
    if (paused) {
      canvas.style.display = '';
      if (resumeBtn) resumeBtn.style.display = '';
      if (startBtn)  startBtn.style.display  = 'none';
      setStatus('Paused', '#888');
      drawFrame();
    } else {
      canvas.style.display = 'none';
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
      setStatus('', '#888');
      streakEl.textContent = '';
    }
  };

  canvas.style.display = 'none';
})();

// === DODGE QTE TRAINER (moving yellow target) ===
(function () {
  const canvas    = document.getElementById('dodge-qte-canvas');
  if (!canvas) return;
  const ctx       = canvas.getContext('2d');
  const statusEl  = document.getElementById('dodge-qte-status');
  const streakEl  = document.getElementById('dodge-qte-streak');
  const hsEl      = document.getElementById('dodge-qte-highscore');
  const startBtn  = document.getElementById('dodge-qte-start-btn');
  const resumeBtn = document.getElementById('dodge-qte-resume-btn');

  const HS_KEY      = 'alb:dodge-hs';
  const HS_KEY_COMP = 'alb:dodge-hs-comp';
  let highscore     = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
  let highscoreComp = parseInt(localStorage.getItem(HS_KEY_COMP) || '0', 10);

  let running      = false;
  let gameStarted  = false;
  let paused       = false;
  let streak       = 0;
  let animFrame    = null;
  let lastTime     = 0;
  let whiteX       = 0;    // current x of white bar
  let inFlight      = false; // white bar currently moving
  let yellowCenter  = 0.70; // fraction of track (fixed per round, randomised after each hit)
  let yellowWidth   = 0;    // px, shrinks with streak

  const TRACK_H = 26;
  const BAR_W   = 10;
  const PAD     = 50;

  let trackX, trackW, trackY;

  function getWhiteSpeed()  { return window._qteCompMode ? Math.min(480 + streak * 16, 720) : Math.min(370 + streak * 12, 580); }
  function calcYellowWidth(){ return window._qteCompMode ? Math.max(trackW * (0.065 - streak * 0.007), BAR_W * 0.5) : Math.max(trackW * (0.09 - streak * 0.008), BAR_W * 0.5); }
  function getYellowX()     { return trackX + trackW * yellowCenter; }

  function randomiseYellow() {
    // Pick a new random centre in the 62–80% range, different from current
    let next;
    do { next = 0.62 + Math.random() * 0.18; } while (Math.abs(next - yellowCenter) < 0.06);
    yellowCenter = next;
    yellowWidth  = calcYellowWidth();
  }

  function updateHighscore(v) {
    if (window._qteCompMode) {
      if (v > highscoreComp) { highscoreComp = v; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('dodge-comp', v); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? `Best: ${highscoreComp}` : '';
    } else {
      if (v > highscore) { highscore = v; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('dodge', v); }
      if (hsEl) hsEl.textContent = highscore > 0 ? `Best: ${highscore}` : '';
    }
  }
  updateHighscore(0);
  window.addEventListener('alb-scores-reset', () => { highscore = 0; highscoreComp = 0; localStorage.removeItem(HS_KEY); localStorage.removeItem(HS_KEY_COMP); updateHighscore(0); });
  window.addEventListener('alb-mode-changed', () => updateHighscore(0));

  function setStatus(t, c) {
    if (statusEl) { statusEl.textContent = t; statusEl.style.color = c || '#888'; }
  }

  function resizeCanvas() {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    canvas.width  = Math.min(wrap.clientWidth - 24 || 800, 900);
    const tall = IS_MOBILE || canvas.width < 480;
    canvas.height = tall
      ? Math.min(Math.round(canvas.width * 0.55), 300)
      : Math.min(Math.round(canvas.width * 0.38), 340);
    trackX = PAD;
    trackW = canvas.width - PAD * 2;
    trackY = canvas.height / 2 - TRACK_H / 2;
  }

  function launchBar() {
    whiteX   = trackX;
    inFlight = true;
    setStatus(IS_MOBILE ? 'Tap when the bar hits the yellow!' : 'Press SPACE when the bar hits the yellow!', '#aaaaff');
  }

  function drawFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#12121e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Track
    ctx.fillStyle = '#252535';
    ctx.fillRect(trackX, trackY, trackW, TRACK_H);

    // Yellow target bar (fixed position until next round)
    const yw  = yellowWidth;
    const yx  = getYellowX() - yw / 2;
    ctx.fillStyle   = '#ffcc00';
    ctx.fillRect(yx, trackY, yw, TRACK_H);

    // White flying bar
    if (inFlight) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(whiteX, trackY, BAR_W, TRACK_H);
    }
  }

  function gameLoop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    if (inFlight) {
      whiteX += getWhiteSpeed() * dt;
      // Missed — bar exited right side
      if (whiteX > trackX + trackW) {
        inFlight = false;
        triggerFail('Too slow!');
        return;
      }
    }

    drawFrame();
    animFrame = requestAnimationFrame(gameLoop);
  }

  function onSpacePress() {
    if (!running || paused || !inFlight) return;
    inFlight = false;

    const yw      = yellowWidth;
    const yx      = getYellowX() - yw / 2;
    const tolerance = 8; // px buffer — any part of white bar touching yellow counts
    const overlap = whiteX < yx + yw + tolerance && whiteX + BAR_W > yx - tolerance;

    if (!overlap) {
      triggerFail('Missed the target!');
      return;
    }

    streak++;
    streakEl.textContent = `Streak: ${streak}`;
    updateHighscore(streak);
    setStatus('Hit!', '#88ee88');
    randomiseYellow(); // new position + smaller width for next round
    setTimeout(() => { if (running) launchBar(); }, 550);
  }

  function triggerFail(msg) {
    if (!running && !gameStarted) return;
    running = paused = false;
    inFlight = false;
    updateHighscore(streak);
    drawFrame();
    setStatus(msg, '#ee5555');
    streakEl.textContent = '';
    setTimeout(resetToStart, 900);
  }

  function resetToStart() {
    cancelAnimationFrame(animFrame);
    running = gameStarted = paused = false;
    inFlight = false;
    canvas.style.display = 'none';
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('', '#888');
  }

  function startGame() {
    streak = 0;
    running = gameStarted = true;
    paused = false;
    inFlight = false;
    resizeCanvas();
    yellowCenter = 0.70;
    yellowWidth  = calcYellowWidth();
    canvas.style.display = '';
    lastTime = performance.now();
    streakEl.textContent = '';
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    animFrame = requestAnimationFrame(gameLoop);
    setTimeout(launchBar, 400);
  }

  function resumeGame() {
    if (!paused) return;
    paused   = false;
    running  = true;
    lastTime = performance.now();
    if (resumeBtn) resumeBtn.style.display = 'none';
    animFrame = requestAnimationFrame(gameLoop);
    if (!inFlight) setTimeout(launchBar, 400);
    else setStatus(IS_MOBILE ? 'Tap when the bar hits the yellow!' : 'Press SPACE when the bar hits the yellow!', '#aaaaff');
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    if (!document.getElementById('page-qte')?.classList.contains('active')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SUMMARY' || tag === 'BUTTON' || document.activeElement?.isContentEditable) return;
    const panel = document.getElementById('qte-panel-dodge');
    if (!panel || panel.style.display === 'none') return;
    e.preventDefault();
    onSpacePress();
  });
  if (IS_MOBILE) {
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onSpacePress(); }, { passive: false });
  }

  if (startBtn)  startBtn.addEventListener('click', startGame);
  if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);

  window._onDodgeQteHide = function () {
    if (paused) return;
    if (gameStarted && running) {
      cancelAnimationFrame(animFrame);
      running = false; paused = true;
    } else { resetToStart(); streak = 0; }
  };

  window._onDodgeQteShow = function () {
    resizeCanvas();
    if (paused) {
      canvas.style.display = '';
      if (resumeBtn) resumeBtn.style.display = '';
      if (startBtn)  startBtn.style.display  = 'none';
      setStatus('Paused', '#888');
      drawFrame();
    } else {
      canvas.style.display = 'none';
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
      setStatus('', '#888');
      streakEl.textContent = '';
    }
  };

  canvas.style.display = 'none';
})();

// === DAGGER QTE TRAINER (spinning rings) ===
(function () {
  const canvas    = document.getElementById('dagger-qte-canvas');
  if (!canvas) return;
  const ctx       = canvas.getContext('2d');
  const statusEl  = document.getElementById('dagger-qte-status');
  const timerEl   = document.getElementById('dagger-qte-timer');
  const streakEl  = document.getElementById('dagger-qte-streak');
  const hsEl      = document.getElementById('dagger-qte-highscore');
  const avgEl     = document.getElementById('dagger-qte-avgtime');
  const startBtn  = document.getElementById('dagger-qte-start-btn');
  const resumeBtn = document.getElementById('dagger-qte-resume-btn');
  const tapBtn    = document.getElementById('dagger-tap-btn');

  const HS_KEY      = 'alb:dagger-hs';
  const HS_KEY_COMP = 'alb:dagger-hs-comp';
  const AVG_KEY = 'alb:dagger-avg';
  let highscore     = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
  let highscoreComp = parseInt(localStorage.getItem(HS_KEY_COMP) || '0', 10);
  let _avgData  = (() => { try { return JSON.parse(localStorage.getItem(AVG_KEY)) || { total: 0, count: 0 }; } catch(e) { return { total: 0, count: 0 }; } })();
  let roundStart = 0;

  function recordRoundTime() {
    if (!roundStart) return;
    const elapsed = (performance.now() - roundStart) / 1000;
    _avgData.total += elapsed;
    _avgData.count++;
    try { localStorage.setItem(AVG_KEY, JSON.stringify(_avgData)); } catch(e) {}
    if (avgEl) avgEl.textContent = `Avg: ${(_avgData.total / _avgData.count).toFixed(1)}s`;
  }

  if (avgEl && _avgData.count > 0) avgEl.textContent = `Avg: ${(_avgData.total / _avgData.count).toFixed(1)}s`;

  let running      = false;
  let gameStarted  = false;
  let paused       = false;
  let streak       = 0;
  let animFrame    = null;
  let lastTime     = 0;
  let rings        = [];
  let currentRing  = 0;
  let roundPending = false;
  let arrowRadius  = 0;
  let roundEndTime = 0; // performance.now() when the round expires

  const RING_THICK = 16;
  const RING_GAP   = 12;
  const BASE_R     = 48;
  const RING_STEP  = RING_THICK + RING_GAP;

  function getRingCount()  { return window._qteCompMode ? Math.min(3 + streak, 9) : Math.min(2 + streak, 8); }
  function getGapSize()    { return window._qteCompMode
    ? Math.max((40 - streak * 1.8) * Math.PI / 180, 16 * Math.PI / 180)
    : Math.max((52 - streak * 1.8) * Math.PI / 180, 22 * Math.PI / 180); }
  function getHitExtra()   { return 7 * Math.PI / 180; }
  function getRingSpeed(i, total) {
    const base = window._qteCompMode ? Math.min(4.2 + streak * 0.32, 9.0) : Math.min(3.2 + streak * 0.25, 7.0);
    const spd  = base + (total - 1 - i) * 0.5;
    return spd * (Math.random() < 0.5 ? 1 : -1);
  }

  function updateHighscore(v) {
    if (window._qteCompMode) {
      if (v > highscoreComp) { highscoreComp = v; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('dagger-comp', v); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? `Best: ${highscoreComp}` : '';
    } else {
      if (v > highscore) { highscore = v; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('dagger', v); }
      if (hsEl) hsEl.textContent = highscore > 0 ? `Best: ${highscore}` : '';
    }
  }
  updateHighscore(0);
  window.addEventListener('alb-scores-reset', () => { highscore = 0; highscoreComp = 0; localStorage.removeItem(HS_KEY); localStorage.removeItem(HS_KEY_COMP); updateHighscore(0); });
  window.addEventListener('alb-mode-changed', () => updateHighscore(0));

  function setStatus(t, c) {
    if (statusEl) { statusEl.textContent = t; statusEl.style.color = c || '#888'; }
  }

  function resizeCanvas() {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    const size = Math.min(wrap.clientWidth - 40, wrap.clientHeight - 90, 440);
    canvas.width = canvas.height = Math.max(size, 280);
    // Fixed outer radius regardless of ring count — active ring always draws here
    arrowRadius = Math.floor(canvas.width / 4) - RING_THICK;
  }

  function startRound() {
    roundPending = false;
    const count  = getRingCount();
    rings = [];
    for (let i = 0; i < count; i++) {
      const spd      = getRingSpeed(i, count);
      const startGap = Math.PI * (0.6 + Math.random() * 0.8);
      rings.push({ gapAngle: startGap, vel: spd });
    }
    currentRing  = count - 1;
    roundEndTime = performance.now() + 8000;
    roundStart   = performance.now();
    setStatus(IS_MOBILE ? 'Tap when the arrow enters the gap!' : 'Press SPACE when the arrow enters the gap!', '#aaaaff');
  }

  const EXPAND_MS = 220; // zoom-in animation duration

  function drawFrame(now) {
    now = now || performance.now();
    const cx = canvas.width / 2, cy = canvas.height / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#12121e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const gapSize    = getGapSize();
    const activeR    = arrowRadius - RING_THICK / 2;
    const previewMax = activeR * 0.55;
    const previewMin = RING_THICK * 1.5;

    ctx.lineCap = 'round';
    for (let i = 0; i < rings.length; i++) {
      const ring     = rings[i];
      const isTarget = (i === currentRing);

      let drawR, lw, color;
      if (isTarget) {
        if (ring.expandFrom !== undefined) {
          // Zoom-in animation: ease out from expandFrom → activeR
          const t    = Math.min((now - ring.expandStart) / EXPAND_MS, 1);
          const ease = 1 - Math.pow(1 - t, 3);
          drawR = ring.expandFrom + ease * (activeR - ring.expandFrom);
          if (t >= 1) delete ring.expandFrom; // animation done
        } else {
          drawR = activeR;
        }
        lw    = RING_THICK;
        color = '#ffffff';
      } else {
        const n    = currentRing;
        const frac = n <= 1 ? 0.5 : i / (n - 1);
        drawR = previewMin + frac * (previewMax - previewMin);
        lw    = Math.max(RING_THICK * 0.45, 5);
        color = `rgba(150,150,220,${0.25 + frac * 0.3})`;
      }

      const ca = ring.gapAngle - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, drawR, ca + gapSize / 2, ca - gapSize / 2, false);
      ctx.strokeStyle = color;
      ctx.lineWidth   = lw;
      ctx.stroke();
    }

    // Arrow fixed at 12 o'clock
    const arrowTip = cy - arrowRadius - 8;
    const arrowTop = cy - arrowRadius - 30;
    ctx.beginPath();
    ctx.moveTo(cx, arrowTip);
    ctx.lineTo(cx - 11, arrowTop);
    ctx.lineTo(cx + 11, arrowTop);
    ctx.closePath();
    ctx.fillStyle = '#ffcc44';
    ctx.fill();
  }

  function gameLoop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    if (!roundPending) {
      for (const ring of rings) ring.gapAngle += ring.vel * dt;

      // Countdown timer — only write to DOM when displayed text changes (~10fps)
      const secsLeft = Math.max(0, (roundEndTime - now) / 1000);
      if (timerEl) {
        const timerTxt = secsLeft > 0 ? secsLeft.toFixed(1) + 's' : '';
        if (timerTxt !== timerEl.textContent) {
          timerEl.textContent = timerTxt;
          timerEl.style.color = secsLeft <= 2 ? '#ee8888' : '#aaaaff';
        }
      }
      if (secsLeft <= 0) { triggerFail("Time's up!"); return; }
    }

    drawFrame(now);
    animFrame = requestAnimationFrame(gameLoop);
  }

  function onSpacePress() {
    if (!running || paused || roundPending) return;
    const ring = rings[currentRing];
    if (!ring || ring.expandFrom !== undefined) return; // block during zoom-in

    // CCW rings are skippable — pressing space always counts as a hit
    if (ring.vel < 0) {
      // auto-pass, fall through to success logic below
    } else {
      const gapSize = getGapSize();
      const norm = ((ring.gapAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const dist = Math.min(norm, Math.PI * 2 - norm);
      const hit  = dist < gapSize / 2 + getHitExtra();
      if (!hit) { triggerFail('Missed the gap!'); return; }
    }

    // Compute where the next ring was drawn as a preview (it's the outermost preview)
    const activeR    = arrowRadius - RING_THICK / 2;
    const previewMax = activeR * 0.55;
    const previewMin = RING_THICK * 1.5;
    const n          = currentRing; // number of previews before splice
    const expandFrom = n <= 1
      ? previewMin + 0.5 * (previewMax - previewMin)
      : previewMax; // outermost preview is always at previewMax when n > 1

    rings.splice(currentRing, 1);
    currentRing = rings.length - 1;

    if (rings.length === 0) { onRoundSuccess(); return; }

    // Kick off zoom-in animation on the newly active ring
    rings[currentRing].expandFrom  = expandFrom;
    rings[currentRing].expandStart = performance.now();

    setStatus('Hit! Next ring...', '#88ee88');
  }

  function onRoundSuccess() {
    recordRoundTime();
    streak++;
    streakEl.textContent = `Streak: ${streak}`;
    updateHighscore(streak);
    if (timerEl) timerEl.textContent = '';
    setStatus(`✓ All rings! Next: ${getRingCount()} rings`, '#88ee88');
    roundPending = true;
    setTimeout(() => { if (running) startRound(); }, 800);
  }

  function triggerFail(msg) {
    if (!running && !gameStarted) return;
    running = paused = roundPending = false;
    updateHighscore(streak);
    drawFrame();
    setStatus(msg, '#ee5555');
    streakEl.textContent = '';
    if (timerEl) timerEl.textContent = '';
    setTimeout(resetToStart, 900);
  }

  function resetToStart() {
    cancelAnimationFrame(animFrame);
    running = gameStarted = paused = roundPending = false;
    rings = [];
    canvas.style.display = 'none';
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (tapBtn)    tapBtn.style.display    = 'none';
    setStatus('', '#888');
    if (timerEl) timerEl.textContent = '';
  }

  function startGame() {
    streak = 0;
    running = gameStarted = true;
    paused = roundPending = false;
    resizeCanvas();
    canvas.style.display = '';
    lastTime = performance.now();
    streakEl.textContent = '';
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (tapBtn && IS_MOBILE) tapBtn.style.display = '';
    startRound();
    animFrame = requestAnimationFrame(gameLoop);
  }

  function resumeGame() {
    if (!paused) return;
    paused = false; running = true;
    lastTime = performance.now();
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (tapBtn && IS_MOBILE) tapBtn.style.display = '';
    setStatus(IS_MOBILE ? 'Tap when the arrow enters the gap!' : 'Press SPACE when the arrow enters the gap!', '#aaaaff');
    animFrame = requestAnimationFrame(gameLoop);
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    if (!document.getElementById('page-qte')?.classList.contains('active')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SUMMARY' || tag === 'BUTTON' || document.activeElement?.isContentEditable) return;
    const panel = document.getElementById('qte-panel-dagger');
    if (!panel || panel.style.display === 'none') return;
    e.preventDefault();
    onSpacePress();
  });
  if (IS_MOBILE) {
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onSpacePress(); }, { passive: false });
    if (tapBtn) tapBtn.addEventListener('touchstart', e => { e.preventDefault(); onSpacePress(); }, { passive: false });
  }

  if (startBtn)  startBtn.addEventListener('click', startGame);
  if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);
  if (tapBtn && IS_MOBILE) tapBtn.addEventListener('click', onSpacePress);

  window._onDaggerQteHide = function () {
    if (paused) return;
    if (gameStarted && running) {
      cancelAnimationFrame(animFrame);
      running = false; paused = true;
    } else { resetToStart(); streak = 0; }
  };

  window._onDaggerQteShow = function () {
    resizeCanvas();
    if (paused) {
      canvas.style.display = '';
      if (resumeBtn) resumeBtn.style.display = '';
      if (startBtn)  startBtn.style.display  = 'none';
      if (tapBtn)    tapBtn.style.display     = 'none';
      setStatus('Paused', '#888');
      drawFrame();
    } else {
      canvas.style.display = 'none';
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
      if (tapBtn)    tapBtn.style.display    = 'none';
      setStatus('', '#888');
      streakEl.textContent = '';
    }
  };

  canvas.style.display = 'none';
})();

// === HAMMER QTE TRAINER (hold-and-release charge bar) ===
(function () {
  const canvas    = document.getElementById('hammer-qte-canvas');
  if (!canvas) return;
  const ctx       = canvas.getContext('2d');
  const statusEl  = document.getElementById('hammer-qte-status');
  const streakEl  = document.getElementById('hammer-qte-streak');
  const hsEl      = document.getElementById('hammer-qte-highscore');
  const startBtn  = document.getElementById('hammer-qte-start-btn');
  const resumeBtn = document.getElementById('hammer-qte-resume-btn');

  const HS_KEY      = 'alb:hammer-hs';
  const HS_KEY_COMP = 'alb:hammer-hs-comp';
  let highscore     = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
  let highscoreComp = parseInt(localStorage.getItem(HS_KEY_COMP) || '0', 10);

  let running = false, gameStarted = false, paused = false;
  let streak = 0, animFrame = null, lastTime = 0;
  let holding = false, fillPct = 0, inSuccessDelay = false;
  let releaseFlash = null, flashStart = 0;
  const FLASH_MS = 500;
  let zoneMin = 0, zoneMax = 0;
  const BAR_H = 40; // horizontal bar height
  const PAD   = 50; // left/right padding

  function getFillSpeed() { return window._qteCompMode ? Math.min(0.42 + streak * 0.030, 0.85) : Math.min(0.30 + streak * 0.025, 0.70); }
  function getZoneSize()  { return window._qteCompMode ? Math.max(0.07 - streak * 0.005, 0.025) : Math.max(0.10 - streak * 0.006, 0.04); }

  function randomiseZone() {
    const size   = getZoneSize();
    const center = 0.45 + Math.random() * 0.35;
    zoneMin = Math.max(0.05, center - size / 2);
    zoneMax = Math.min(0.95, zoneMin + size);
    zoneMin = zoneMax - size;
  }

  function updateHighscore(v) {
    if (window._qteCompMode) {
      if (v > highscoreComp) { highscoreComp = v; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('hammer-comp', v); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? `Best: ${highscoreComp}` : '';
    } else {
      if (v > highscore) { highscore = v; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('hammer', v); }
      if (hsEl) hsEl.textContent = highscore > 0 ? `Best: ${highscore}` : '';
    }
  }
  updateHighscore(0);
  window.addEventListener('alb-scores-reset', () => { highscore = 0; highscoreComp = 0; localStorage.removeItem(HS_KEY); localStorage.removeItem(HS_KEY_COMP); updateHighscore(0); });
  window.addEventListener('alb-mode-changed', () => updateHighscore(0));

  function setStatus(t, c) { if (statusEl) { statusEl.textContent = t; statusEl.style.color = c || '#888'; } }

  function resizeCanvas() {
    const wrap = canvas.parentElement;
    canvas.width  = Math.min((wrap ? wrap.clientWidth - 40 : 800) || 800, 900);
    canvas.height = BAR_H + 60;
  }

  function drawFrame(now) {
    now = now || performance.now();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#12121e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const barW = canvas.width - PAD * 2;
    const bx   = PAD;
    const by   = (canvas.height - BAR_H) / 2;

    // Bar background
    ctx.fillStyle = '#252535';
    ctx.fillRect(bx, by, barW, BAR_H);

    const zoneX1 = bx + barW * zoneMin;
    const zoneX2 = bx + barW * zoneMax;
    const zoneW  = zoneX2 - zoneX1;

    // Fill colour: blue while charging, green/red on release
    let fillColor = '#4488ff';
    if (releaseFlash !== null) {
      const elapsed = now - flashStart;
      if (elapsed < FLASH_MS) {
        fillColor = releaseFlash === 'hit' ? '#44ee88' : '#ee4444';
      } else {
        releaseFlash = null;
      }
    }

    // Fill drawn first
    const fillW = barW * fillPct;
    if (fillW > 0) {
      ctx.fillStyle = fillColor;
      ctx.fillRect(bx, by, fillW, BAR_H);
    }

    // Zone drawn on top so it's always visible
    ctx.fillStyle   = 'rgba(150,150,175,0.18)';
    ctx.fillRect(zoneX1, by, zoneW, BAR_H);
    ctx.strokeStyle = 'rgba(190,190,220,0.85)';
    ctx.lineWidth   = 2;
    ctx.strokeRect(zoneX1, by, zoneW, BAR_H);

    // Bar border
    ctx.strokeStyle = '#44446a';
    ctx.lineWidth   = 2;
    ctx.strokeRect(bx, by, barW, BAR_H);

    // Zone label above box
    ctx.fillStyle = 'rgba(200,200,255,0.7)';
    ctx.font      = '12px Rajdhani, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RELEASE', zoneX1 + zoneW / 2, by - 6);
  }

  function startRound() {
    fillPct = 0; holding = false; releaseFlash = null; inSuccessDelay = false;
    randomiseZone();
    setStatus(IS_MOBILE ? 'Hold button to charge, release in the box!' : 'Hold SPACE to charge, release in the box!', '#aaaaff');
    drawFrame();
  }

  function gameLoop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (holding) {
      fillPct = Math.min(1, fillPct + getFillSpeed() * dt);
      if (fillPct >= 1) { holding = false; onRelease(); return; }
    }
    drawFrame(now);
    animFrame = requestAnimationFrame(gameLoop);
  }

  function onRelease() {
    if (!running || inSuccessDelay) return;
    const inZone = fillPct >= zoneMin && fillPct <= zoneMax;
    releaseFlash = inZone ? 'hit' : 'miss';
    flashStart   = performance.now();
    drawFrame(flashStart);
    if (!inZone) { triggerFail(fillPct < zoneMin ? 'Too early!' : 'Too late!'); return; }
    window._playQteSfx('hammer');
    streak++;
    inSuccessDelay = true;
    streakEl.textContent = `Streak: ${streak}`;
    updateHighscore(streak);
    setStatus('Perfect!', '#88ee88');
    setTimeout(() => { if (running) startRound(); }, 700);
  }

  function triggerFail(msg) {
    if (!running && !gameStarted) return;
    running = paused = false; holding = false; inSuccessDelay = false;
    updateHighscore(streak);
    setStatus(msg, '#ee5555');
    streakEl.textContent = '';
    setTimeout(resetToStart, 900);
  }

  function resetToStart() {
    cancelAnimationFrame(animFrame);
    running = gameStarted = paused = false; holding = false; fillPct = 0; inSuccessDelay = false;
    canvas.style.display = 'none';
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('', '#888');
  }

  function startGame() {
    streak = 0; running = gameStarted = true; paused = holding = false; fillPct = 0;
    resizeCanvas(); canvas.style.display = ''; lastTime = performance.now();
    streakEl.textContent = '';
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    startRound();
    animFrame = requestAnimationFrame(gameLoop);
  }

  function resumeGame() {
    if (!paused) return;
    paused = false; running = true; holding = false; lastTime = performance.now();
    if (resumeBtn) resumeBtn.style.display = 'none';
    startRound();
    animFrame = requestAnimationFrame(gameLoop);
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    if (!document.getElementById('page-qte')?.classList.contains('active')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SUMMARY' || tag === 'BUTTON' || document.activeElement?.isContentEditable) return;
    const panel = document.getElementById('qte-panel-hammer');
    if (!panel || panel.style.display === 'none') return;
    e.preventDefault();
    if (!running || paused || inSuccessDelay) return;
    holding = true;
  });

  document.addEventListener('keyup', e => {
    if (e.code !== 'Space') return;
    const panel = document.getElementById('qte-panel-hammer');
    if (!panel || panel.style.display === 'none') return;
    if (!running || paused || !holding) return;
    holding = false;
    onRelease();
  });
  if (IS_MOBILE) {
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      if (!running || paused || inSuccessDelay) return;
      holding = true;
    }, { passive: false });
    canvas.addEventListener('touchend', e => {
      e.preventDefault();
      if (!running || paused || !holding) return;
      holding = false;
      onRelease();
    }, { passive: false });

    // Dedicated HOLD button
    const hammerHoldBtn = document.createElement('button');
    hammerHoldBtn.className = 'qte-mobile-action-btn qte-mobile-hold-btn';
    hammerHoldBtn.textContent = 'HOLD';
    hammerHoldBtn.style.display = 'none';
    hammerHoldBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      if (!running || paused || inSuccessDelay) return;
      holding = true;
      hammerHoldBtn.classList.add('active');
    }, { passive: false });
    hammerHoldBtn.addEventListener('touchend', e => {
      e.preventDefault();
      hammerHoldBtn.classList.remove('active');
      if (!running || paused || !holding) return;
      holding = false;
      onRelease();
    }, { passive: false });
    canvas.parentElement.appendChild(hammerHoldBtn);
    new MutationObserver(() => {
      if (canvas.style.display === 'none') {
        hammerHoldBtn.style.display = 'none';
        hammerHoldBtn.classList.remove('active');
      } else {
        hammerHoldBtn.style.display = '';
      }
    }).observe(canvas, { attributes: true, attributeFilter: ['style'] });
  }

  if (startBtn)  startBtn.addEventListener('click', startGame);
  if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);

  window._onHammerQteHide = function () {
    if (paused) return;
    if (gameStarted && running) {
      cancelAnimationFrame(animFrame); running = false; paused = true; holding = false;
    } else { resetToStart(); streak = 0; }
  };

  window._onHammerQteShow = function () {
    resizeCanvas();
    if (paused) {
      canvas.style.display = '';
      if (resumeBtn) resumeBtn.style.display = '';
      if (startBtn)  startBtn.style.display  = 'none';
      setStatus('Paused', '#888'); drawFrame();
    } else {
      canvas.style.display = 'none';
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
      setStatus('', '#888'); streakEl.textContent = '';
    }
  };

  canvas.style.display = 'none';
})();

// === AXE QTE TRAINER (press to fill, bar drains, land in zone when timer ends) ===
(function () {
  const canvas    = document.getElementById('axe-qte-canvas');
  if (!canvas) return;
  const ctx       = canvas.getContext('2d');
  const statusEl  = document.getElementById('axe-qte-status');
  const streakEl  = document.getElementById('axe-qte-streak');
  const hsEl      = document.getElementById('axe-qte-highscore');
  const startBtn  = document.getElementById('axe-qte-start-btn');
  const resumeBtn = document.getElementById('axe-qte-resume-btn');

  const HS_KEY      = 'alb:axe-hs';
  const HS_KEY_COMP = 'alb:axe-hs-comp';
  let highscore     = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
  let highscoreComp = parseInt(localStorage.getItem(HS_KEY_COMP) || '0', 10);

  let running = false, gameStarted = false, paused = false;
  let streak = 0, animFrame = null, lastTime = 0;
  let fillPct = 0;
  let releaseFlash = null, flashStart = 0;
  let roundEndTime = 0, pauseTimeRemaining = 0;
  const FLASH_MS = 600;
  let zoneMin = 0, zoneMax = 0;

  const BAR_H = 40;
  const PAD   = 50;
  const DRAIN_RATE  = 0.06;  // fraction lost per second
  const PRESS_AMT   = 0.09;  // fraction added per space press

  function getTimer()    { return window._qteCompMode ? Math.max(5 - streak * 0.3, 2.5) : Math.max(6 - streak * 0.3, 3); }
  function getZoneSize() { return window._qteCompMode ? Math.max(0.08 - streak * 0.006, 0.02) : Math.max(0.11 - streak * 0.007, 0.03); }

  function randomiseZone() {
    const size   = getZoneSize();
    const center = 0.45 + Math.random() * 0.35;
    zoneMin = Math.max(0.05, center - size / 2);
    zoneMax = Math.min(0.95, zoneMin + size);
    zoneMin = zoneMax - size;
  }

  function updateHighscore(v) {
    if (window._qteCompMode) {
      if (v > highscoreComp) { highscoreComp = v; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('axe-comp', v); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? `Best: ${highscoreComp}` : '';
    } else {
      if (v > highscore) { highscore = v; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('axe', v); }
      if (hsEl) hsEl.textContent = highscore > 0 ? `Best: ${highscore}` : '';
    }
  }
  updateHighscore(0);
  window.addEventListener('alb-scores-reset', () => { highscore = 0; highscoreComp = 0; localStorage.removeItem(HS_KEY); localStorage.removeItem(HS_KEY_COMP); updateHighscore(0); });
  window.addEventListener('alb-mode-changed', () => updateHighscore(0));

  function setStatus(t, c) { if (statusEl) { statusEl.textContent = t; statusEl.style.color = c || '#888'; } }

  function resizeCanvas() {
    const wrap = canvas.parentElement;
    canvas.width  = Math.min((wrap ? wrap.clientWidth - 40 : 800) || 800, 900);
    canvas.height = BAR_H + 60;
  }

  function drawFrame(now) {
    now = now || performance.now();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#12121e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const barW = canvas.width - PAD * 2;
    const bx   = PAD;
    const by   = (canvas.height - BAR_H) / 2;

    // Bar background
    ctx.fillStyle = '#252535';
    ctx.fillRect(bx, by, barW, BAR_H);

    const zoneX1 = bx + barW * zoneMin;
    const zoneX2 = bx + barW * zoneMax;
    const zoneW  = zoneX2 - zoneX1;

    // Fill colour: green in zone, blue otherwise; flash on timer expire
    let fillColor;
    if (releaseFlash !== null) {
      const elapsed = now - flashStart;
      if (elapsed < FLASH_MS) {
        fillColor = releaseFlash === 'hit' ? '#44ee88' : '#ee4444';
      } else {
        releaseFlash = null;
      }
    }
    if (!fillColor) {
      fillColor = (fillPct >= zoneMin && fillPct <= zoneMax) ? '#44ee88' : '#4488ff';
    }

    // Fill drawn first
    const fillW = barW * fillPct;
    if (fillW > 0) {
      ctx.fillStyle = fillColor;
      ctx.fillRect(bx, by, fillW, BAR_H);
    }

    // Zone drawn on top so it's always visible
    ctx.fillStyle   = 'rgba(150,150,175,0.18)';
    ctx.fillRect(zoneX1, by, zoneW, BAR_H);
    ctx.strokeStyle = 'rgba(190,190,220,0.85)';
    ctx.lineWidth   = 2;
    ctx.strokeRect(zoneX1, by, zoneW, BAR_H);

    // Bar border
    ctx.strokeStyle = '#44446a';
    ctx.lineWidth   = 2;
    ctx.strokeRect(bx, by, barW, BAR_H);

    // Timer bar along top edge
    if (running && !releaseFlash) {
      const secsLeft = Math.max(0, (roundEndTime - now) / 1000);
      const totalTime = getTimer();
      const timerFrac = secsLeft / totalTime;
      ctx.fillStyle = secsLeft <= 2 ? '#ee8855' : '#aaaaff';
      ctx.fillRect(bx, by - 6, barW * timerFrac, 3);
    }

    // Zone label
    ctx.fillStyle = 'rgba(200,200,255,0.7)';
    ctx.font      = '12px Rajdhani, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ZONE', zoneX1 + zoneW / 2, by - 10);
  }

  function startRound() {
    fillPct      = 0;
    releaseFlash = null;
    randomiseZone();
    roundEndTime = performance.now() + getTimer() * 1000;
    setStatus(IS_MOBILE ? 'Tap to fill — land in the zone when time runs out!' : 'Press SPACE to fill — land in the zone when time runs out!', '#aaaaff');
    drawFrame();
  }

  function evaluateRound() {
    const inZone = fillPct >= zoneMin && fillPct <= zoneMax;
    releaseFlash = inZone ? 'hit' : 'miss';
    flashStart   = performance.now();
    drawFrame(flashStart);
    if (!inZone) {
      triggerFail(fillPct < zoneMin ? 'Too low!' : 'Too high!');
      return;
    }
    streak++;
    streakEl.textContent = `Streak: ${streak}`;
    updateHighscore(streak);
    setStatus('Landed it!', '#88ee88');
    setTimeout(() => {
      if (running) {
        startRound();
        lastTime = performance.now();
        animFrame = requestAnimationFrame(gameLoop);
      }
    }, 700);
  }

  function gameLoop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Drain bar over time
    fillPct = Math.max(0, fillPct - DRAIN_RATE * dt);

    // Timer expired — evaluate
    if (now >= roundEndTime) {
      evaluateRound();
      return;
    }

    drawFrame(now);
    animFrame = requestAnimationFrame(gameLoop);
  }

  function onSpacePress() {
    if (!running || paused) return;
    fillPct = Math.min(1, fillPct + PRESS_AMT);
  }

  function triggerFail(msg) {
    if (!running && !gameStarted) return;
    running = paused = false;
    updateHighscore(streak);
    setStatus(msg, '#ee5555');
    streakEl.textContent = '';
    setTimeout(resetToStart, 900);
  }

  function resetToStart() {
    cancelAnimationFrame(animFrame);
    running = gameStarted = paused = false; fillPct = 0;
    canvas.style.display = 'none';
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('', '#888');
  }

  function startGame() {
    streak = 0; running = gameStarted = true; paused = false; fillPct = 0;
    resizeCanvas(); canvas.style.display = ''; lastTime = performance.now();
    streakEl.textContent = '';
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    startRound();
    animFrame = requestAnimationFrame(gameLoop);
  }

  function resumeGame() {
    if (!paused) return;
    paused = false; running = true; lastTime = performance.now();
    // Restore the exact time remaining from before the pause
    roundEndTime = performance.now() + pauseTimeRemaining;
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus(IS_MOBILE ? 'Tap to fill — land in the zone when time runs out!' : 'Press SPACE to fill — land in the zone when time runs out!', '#aaaaff');
    animFrame = requestAnimationFrame(gameLoop);
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    if (!document.getElementById('page-qte')?.classList.contains('active')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SUMMARY' || tag === 'BUTTON' || document.activeElement?.isContentEditable) return;
    const panel = document.getElementById('qte-panel-axe');
    if (!panel || panel.style.display === 'none') return;
    e.preventDefault();
    onSpacePress();
  });
  if (IS_MOBILE) {
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onSpacePress(); }, { passive: false });

    // Dedicated TAP button — synced to canvas visibility via MutationObserver
    const axeTapBtn = document.createElement('button');
    axeTapBtn.className = 'qte-mobile-action-btn';
    axeTapBtn.textContent = 'TAP';
    axeTapBtn.style.display = 'none';
    axeTapBtn.addEventListener('touchstart', e => { e.preventDefault(); onSpacePress(); }, { passive: false });
    canvas.parentElement.appendChild(axeTapBtn);
    new MutationObserver(() => {
      axeTapBtn.style.display = canvas.style.display === 'none' ? 'none' : '';
    }).observe(canvas, { attributes: true, attributeFilter: ['style'] });
  }

  if (startBtn)  startBtn.addEventListener('click', startGame);
  if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);

  window._onAxeQteHide = function () {
    if (paused) return;
    if (gameStarted && running) {
      cancelAnimationFrame(animFrame); running = false; paused = true;
      pauseTimeRemaining = Math.max(0, roundEndTime - performance.now());
    } else { resetToStart(); streak = 0; }
  };

  window._onAxeQteShow = function () {
    resizeCanvas();
    if (paused) {
      canvas.style.display = '';
      if (resumeBtn) resumeBtn.style.display = '';
      if (startBtn)  startBtn.style.display  = 'none';
      setStatus('Paused', '#888'); drawFrame();
    } else {
      canvas.style.display = 'none';
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
      setStatus('', '#888'); streakEl.textContent = '';
    }
  };

  canvas.style.display = 'none';
})();

/* ============================================================
   STAFF QTE  — runic drag-and-drop matching
   ============================================================ */
(function () {
  var RUNE_MAP = { A:'ᚨ', B:'ᛒ', E:'ᛖ', F:'ᚠ', H:'ᚺ', N:'ᚾ', R:'ᚱ', U:'ᚢ', W:'ᚹ', X:'ᛉ' };
  var KEYS = Object.keys(RUNE_MAP);

  var canvas    = document.getElementById('staff-qte-canvas');
  var ctx       = canvas.getContext('2d');
  var statusEl  = document.getElementById('staff-qte-status');
  var streakEl  = document.getElementById('staff-qte-streak');
  var highEl    = document.getElementById('staff-qte-highscore');
  var startBtn  = document.getElementById('staff-qte-start-btn');
  var resumeBtn = document.getElementById('staff-qte-resume-btn');

  var HS_KEY = 'alb:staff-hs', HS_KEY_COMP = 'alb:staff-hs-comp';
  var streak = 0;
  var highscore     = parseInt(localStorage.getItem(HS_KEY)      || '0', 10);
  var highscoreComp = parseInt(localStorage.getItem(HS_KEY_COMP) || '0', 10);
  window.addEventListener('alb-scores-reset', function() {
    streak = 0; highscore = 0; highscoreComp = 0;
    try { localStorage.removeItem(HS_KEY); localStorage.removeItem(HS_KEY_COMP); } catch(e) {}
    if (highEl) highEl.textContent = '';
  });
  window.addEventListener('alb-mode-changed', function() { if (highEl) highEl.textContent = (window._qteCompMode ? highscoreComp : highscore) > 0 ? 'Best: ' + (window._qteCompMode ? highscoreComp : highscore) : ''; });
  var pattern = [];
  var bankTiles = [], slots = [];
  var drag = null; // { tile, curX, curY }
  var timeLeft = 8, timerStart = 0;
  var running = false, gameStarted = false, paused = false;
  var animFrame = null;

  var CW = 520, CH = 310;
  var TW = 46, TH = 46;   // tile width / height
  var BANK_Y = 32;         // top of bank tiles
  var SLOT_Y = 210;        // top of slot tiles

  function resizeCanvas() {
    var wrap = canvas.parentElement;
    var displayW = wrap ? Math.min(wrap.clientWidth - 20, 600) : 520;
    var scale = Math.min(displayW / 520, 1);
    CW = Math.round(520 * scale);
    CH = Math.round(310 * scale);
    TW = Math.round(46 * scale);
    TH = Math.round(46 * scale);
    BANK_Y = Math.round(32 * scale);
    SLOT_Y = Math.round(210 * scale);
    canvas.width = CW;
    canvas.height = CH;
  }

  function getPatternLen() { return window._qteCompMode ? Math.min(3 + streak, 9) : Math.min(2 + streak, 9); }
  function getTimerDur()   { return window._qteCompMode ? (streak <= 5 ? 7 : Math.max(7 - (streak - 5), 4)) : (streak <= 7 ? 8 : Math.max(8 - (streak - 7), 5)); }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // Compute evenly-spaced tile X positions for `count` tiles
  function rowPositions(count, y) {
    var GAP = 8;
    var total = count * TW + (count - 1) * GAP;
    var x0 = (CW - total) / 2;
    var out = [];
    for (var i = 0; i < count; i++) out.push({ x: x0 + i * (TW + GAP), y: y });
    return out;
  }

  function newRound() {
    var len = getPatternLen();
    // Build pattern
    pattern = [];
    for (var i = 0; i < len; i++) pattern.push(KEYS[Math.floor(Math.random() * KEYS.length)]);

    // Bank = shuffled copies of the exact tiles needed
    var shuffled = shuffle(pattern);
    var bankPos  = rowPositions(len, BANK_Y);
    bankTiles = shuffled.map(function (key, idx) {
      return { id: idx, key: key, homeX: bankPos[idx].x, homeY: bankPos[idx].y,
               x: bankPos[idx].x, y: bankPos[idx].y, inBank: true };
    });

    // Slots
    var slotPos = rowPositions(len, SLOT_Y);
    slots = pattern.map(function (key, idx) {
      return { index: idx, targetKey: key, filledTile: null, x: slotPos[idx].x, y: slotPos[idx].y };
    });

    drag = null;
    timeLeft = getTimerDur();
    timerStart = performance.now();
  }

  function setStatus(txt, color) { statusEl.textContent = txt; statusEl.style.color = color || '#a08fd0'; }
  function updateHUD() {
    streakEl.textContent = streak ? 'Streak: ' + streak : '';
    var hs = window._qteCompMode ? highscoreComp : highscore;
    highEl.textContent = hs ? 'Best: ' + hs : '';
  }

  function checkWin() {
    for (var i = 0; i < slots.length; i++) if (!slots[i].filledTile) return false;
    return true;
  }

  function returnToBank(tile) {
    tile.x = tile.homeX; tile.y = tile.homeY; tile.inBank = true;
  }

  function triggerFail(msg) {
    running = false; drag = null;
    setStatus(msg || 'Failed!', '#e05555');
    setTimeout(function () {
      streak = 0; updateHUD();
      newRound();
      running = true;
      animFrame = requestAnimationFrame(staffGameLoop);
    }, 900);
  }

  function triggerSuccess() {
    running = false; drag = null;
    streak++;
    if (window._qteCompMode) {
      if (streak > highscoreComp) {
        highscoreComp = streak;
        try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {}
        if (window._sbSubmitScore) window._sbSubmitScore('staff-comp', streak);
      }
    } else {
      if (streak > highscore) {
        highscore = streak;
        try { localStorage.setItem(HS_KEY, highscore); } catch(e) {}
        if (window._sbSubmitScore) window._sbSubmitScore('staff', streak);
      }
    }
    updateHUD();
    setStatus('Complete!', '#55e09a');
    drawFrame(); // render all slots green before the loop stops
    setTimeout(function () {
      newRound();
      running = true;
      animFrame = requestAnimationFrame(staffGameLoop);
    }, 1000);
  }

  // ── drawing ────────────────────────────────────────────────
  function drawTile(x, y, key, state) {
    var textCol, labelCol;
    if (state === 'correct') {
      textCol = '#4de89a'; labelCol = 'rgba(150,255,200,0.7)';
    } else if (state === 'drag') {
      textCol = '#fff'; labelCol = 'rgba(255,255,255,0.75)';
    } else { // bank
      textCol = '#e0d4ff'; labelCol = 'rgba(220,200,255,0.6)';
    }
    // rune glow
    ctx.shadowColor = state === 'correct' ? '#4de89a' : state === 'drag' ? '#c8aaff' : '#b090ff';
    ctx.shadowBlur = 10;
    ctx.fillStyle = textCol; ctx.font = Math.round(TH * 0.78) + 'px serif'; ctx.textAlign = 'center';
    ctx.fillText(RUNE_MAP[key], x + TW / 2, y + TH * 0.78);
    ctx.shadowBlur = 0;
  }

  function drawSlot(slot) {
    if (slot.filledTile) {
      drawTile(slot.x, slot.y, slot.filledTile.key, 'correct');
    } else {
      // empty slot — just a faint dashed outline with dim rune hint
      ctx.strokeStyle = 'rgba(140,105,200,0.35)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.roundRect(slot.x, slot.y, TW, TH, 7); ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowColor = '#b090ff'; ctx.shadowBlur = 4;
      ctx.fillStyle = 'rgba(180,150,220,0.25)';
      ctx.font = Math.round(TH * 0.78) + 'px serif'; ctx.textAlign = 'center';
      ctx.fillText(RUNE_MAP[slot.targetKey], slot.x + TW / 2, slot.y + TH * 0.78);
      ctx.shadowBlur = 0;
    }
  }

  function drawFrame() {
    ctx.clearRect(0, 0, CW, CH);

    // --- section labels ---
    ctx.fillStyle = '#c0a8e8'; ctx.font = 'bold 11px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('RUNE BANK  —  drag tiles to the matching slots below', CW / 2, BANK_Y - 10);
    ctx.fillText('TARGET SLOTS', CW / 2, SLOT_Y - 10);

    // --- bank tiles ---
    for (var i = 0; i < bankTiles.length; i++) {
      var t = bankTiles[i];
      if (t.inBank && !(drag && drag.tile === t)) drawTile(t.x, t.y, t.key, 'bank');
    }

    // --- divider ---
    var divY = (BANK_Y + TH + SLOT_Y) / 2;
    ctx.strokeStyle = 'rgba(180,150,240,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(24, divY); ctx.lineTo(CW - 24, divY); ctx.stroke();

    // --- slots ---
    for (var j = 0; j < slots.length; j++) drawSlot(slots[j]);

    // --- timer bar ---
    var elapsed = (performance.now() - timerStart) / 1000;
    var frac    = Math.max(0, 1 - elapsed / getTimerDur());
    var barY = SLOT_Y + TH + 18, barW = CW - 56, barX = 28;
    ctx.fillStyle = 'rgba(60,48,100,0.7)';
    ctx.beginPath(); ctx.roundRect(barX, barY, barW, 10, 5); ctx.fill();
    var hue = frac > 0.4 ? 260 + frac * 60 : frac * 30;
    ctx.fillStyle = 'hsl(' + hue + ',90%,70%)';
    ctx.shadowColor = 'hsl(' + hue + ',90%,70%)'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.roundRect(barX, barY, barW * frac, 10, 5); ctx.fill();
    ctx.shadowBlur = 0;

    // --- dragged tile on top ---
    if (drag) drawTile(drag.curX - TW / 2, drag.curY - TH / 2, drag.tile.key, 'drag');
  }

  function staffGameLoop() {
    if (!running) return;
    animFrame = requestAnimationFrame(staffGameLoop);
    if ((performance.now() - timerStart) / 1000 >= getTimerDur()) {
      cancelAnimationFrame(animFrame); triggerFail("Time's up!"); return;
    }
    drawFrame();
  }

  // ── mouse drag-and-drop ────────────────────────────────────
  function canvasPos(e) {
    var r = canvas.getBoundingClientRect();
    var src = (e.touches && e.touches.length) ? e.touches[0] : (e.changedTouches && e.changedTouches.length) ? e.changedTouches[0] : e;
    return { x: (src.clientX - r.left) * (CW / r.width), y: (src.clientY - r.top) * (CH / r.height) };
  }

  function hitTest(px, py, tx, ty) {
    return px >= tx && px <= tx + TW && py >= ty && py <= ty + TH;
  }

  canvas.addEventListener('mousedown', function (e) {
    if (!running || !gameStarted) return;
    var p = canvasPos(e);
    // pick up from bank
    for (var i = 0; i < bankTiles.length; i++) {
      var t = bankTiles[i];
      if (t.inBank && hitTest(p.x, p.y, t.x, t.y)) {
        t.inBank = false;
        drag = { tile: t, curX: p.x, curY: p.y };
        return;
      }
    }
    // pick up from a filled slot
    for (var j = 0; j < slots.length; j++) {
      var s = slots[j];
      if (s.filledTile && hitTest(p.x, p.y, s.x, s.y)) {
        var tile = s.filledTile;
        s.filledTile = null;
        tile.inBank = false;
        drag = { tile: tile, curX: p.x, curY: p.y };
        return;
      }
    }
  });

  canvas.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var p = canvasPos(e);
    drag.curX = p.x; drag.curY = p.y;
  });

  function dropDrag(e) {
    if (!drag) return;
    var p = canvasPos(e);
    var tile = drag.tile;
    drag = null;
    // check slots
    for (var j = 0; j < slots.length; j++) {
      var s = slots[j];
      if (!s.filledTile && hitTest(p.x, p.y, s.x, s.y)) {
        if (tile.key === s.targetKey) {
          window._playQteSfx('staff');
          s.filledTile = tile;
          tile.inBank = false;
          if (checkWin()) { cancelAnimationFrame(animFrame); drawFrame(); triggerSuccess(); }
        } else {
          returnToBank(tile); // wrong rune → back to bank
        }
        return;
      }
    }
    // dropped on nothing
    returnToBank(tile);
  }

  canvas.addEventListener('mouseup',    dropDrag);
  canvas.addEventListener('mouseleave', function (e) {
    if (drag) { returnToBank(drag.tile); drag = null; }
  });

  // Touch equivalents for drag-and-drop on mobile
  if (IS_MOBILE) {
    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (!running || !gameStarted) return;
      var p = canvasPos(e);
      for (var i = 0; i < bankTiles.length; i++) {
        var t = bankTiles[i];
        if (t.inBank && hitTest(p.x, p.y, t.x, t.y)) {
          t.inBank = false;
          drag = { tile: t, curX: p.x, curY: p.y };
          return;
        }
      }
      for (var j = 0; j < slots.length; j++) {
        var s = slots[j];
        if (s.filledTile && hitTest(p.x, p.y, s.x, s.y)) {
          var tile = s.filledTile;
          s.filledTile = null;
          tile.inBank = false;
          drag = { tile: tile, curX: p.x, curY: p.y };
          return;
        }
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (!drag) return;
      var p = canvasPos(e);
      drag.curX = p.x; drag.curY = p.y;
    }, { passive: false });
    canvas.addEventListener('touchend', function (e) {
      e.preventDefault();
      dropDrag(e);
    }, { passive: false });
  }

  // ── start / resume ─────────────────────────────────────────
  function startGame() {
    streak = 0; updateHUD(); newRound();
    gameStarted = true; paused = false; running = true;
    canvas.style.display = '';
    startBtn.style.display  = 'none';
    resumeBtn.style.display = 'none';
    setStatus('', '#a08fd0');
    animFrame = requestAnimationFrame(staffGameLoop);
  }

  function resumeGame() {
    var savedTime = timeLeft;
    newRound();                   // re-randomize runes
    timeLeft   = savedTime;       // but keep the time that was left
    timerStart = performance.now() - (getTimerDur() - timeLeft) * 1000;
    paused = false; running = true;
    resumeBtn.style.display = 'none'; setStatus('', '#a08fd0');
    animFrame = requestAnimationFrame(staffGameLoop);
  }

  startBtn.addEventListener('click',  startGame);
  resumeBtn.addEventListener('click', resumeGame);
  resizeCanvas();

  window._onStaffQteHide = function () {
    if (paused) return;
    if (gameStarted && running) {
      cancelAnimationFrame(animFrame);
      running = false; paused = true;
      timeLeft = Math.max(0, getTimerDur() - (performance.now() - timerStart) / 1000);
    } else { streak = 0; gameStarted = false; }
  };

  window._onStaffQteShow = function () {
    resizeCanvas();
    if (paused) {
      canvas.style.display = '';
      resumeBtn.style.display = ''; startBtn.style.display = 'none';
      setStatus('Paused', '#888'); drawFrame();
    } else {
      canvas.style.display = 'none';
      startBtn.style.display = ''; resumeBtn.style.display = 'none';
      setStatus('', '#a08fd0'); streakEl.textContent = '';
    }
  };

  canvas.style.display = 'none';
})();

