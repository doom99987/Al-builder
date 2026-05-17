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

  let spearHideDying = localStorage.getItem('alb:spear-hide-dying') === '1';
  const _hideDyingCb = document.getElementById('spear-hide-dying-cb');
  if (_hideDyingCb) _hideDyingCb.checked = spearHideDying;

  window._spearToggleHideDying = function(val) {
    spearHideDying = val;
    try { localStorage.setItem('alb:spear-hide-dying', val ? '1' : '0'); } catch(e) {}
  };
  window._spearToggleSettings = function() {
    const panel = document.getElementById('spear-settings-panel');
    if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
  };

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

  // Casual: original scaling; comp: power curve (exponent 0.65) — drops fast early, levels off, caps at streak 200
  function getMaxSimul()      { return window._qteCompMode ? Math.min(5 + Math.floor(10 * Math.pow(streak / 200, 0.65)), 14) : Math.min(4 + Math.floor(streak / 4), 8); }
  function getApproachMs()    { return window._qteCompMode ? Math.max(500, Math.round(950 - 450 * Math.pow(streak / 200, 0.65))) : Math.max(850, 1100 - streak * 2); }
  function getSpawnInterval() { return window._qteCompMode ? Math.max(200, Math.round(850 - 650 * Math.pow(streak / 200, 0.65))) : Math.max(550, 1000 - streak * 10); }

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
    if (!spearHideDying) {
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
    } else {
      dying.length = 0; // clear silently so array doesn't grow
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
    ? (IS_MOBILE ? Math.min(220 + streak * 8, 420)  : Math.min(400 + streak * 9, 610))
    : (IS_MOBILE ? Math.min(160 + streak * 6, 320)  : Math.min(300 + streak * 10, 520)); }
  function getBarCount()  { return window._qteCompMode
    ? (IS_MOBILE ? Math.min(3 + Math.floor(streak / 3), 6) : Math.min(4 + Math.floor(streak / 2), 8))
    : (IS_MOBILE ? Math.min(2 + Math.floor(streak / 4), 5) : Math.min(3 + Math.floor(streak / 3), 7)); }
  function getZoneStart() { return 0.70; }
  function getZoneWidth() { return window._qteCompMode
    ? (IS_MOBILE ? Math.max(0.21 - streak * 0.007, 0.10) : Math.max(0.14 - streak * 0.004, 0.07))
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
    var displayW = wrap ? Math.min(wrap.clientWidth - 20, 780) : 660;
    var scale = displayW / 520;
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


// === THORIAN QTE ===
// A small blue bar orbits the Thorian heart, snapping UP / LEFT / RIGHT (W/A/D).
// Purple hearts come in strips toward the center. The bar physically blocks any heart
// it overlaps. Hearts that get past it hit Thorian and cost a life.
// Survive the round timer — each round adds length, speed, and active sides.
(function () {
  const canvas    = document.getElementById('thorian-qte-canvas');
  if (!canvas) return;
  const ctx       = canvas.getContext('2d');
  const statusEl  = document.getElementById('thorian-qte-status');
  const streakEl  = document.getElementById('thorian-qte-streak');
  const hsEl      = document.getElementById('thorian-qte-highscore');
  const startBtn  = document.getElementById('thorian-qte-start-btn');
  const resumeBtn = document.getElementById('thorian-qte-resume-btn');

  const HS_KEY      = 'alb:thorian-hs';
  const HS_KEY_COMP = 'alb:thorian-hs-comp';
  let highscore     = parseInt(localStorage.getItem(HS_KEY)      || '0', 10);
  let highscoreComp = parseInt(localStorage.getItem(HS_KEY_COMP) || '0', 10);

  // ---- Game state ----
  let running       = false;
  let gameStarted   = false;
  let paused        = false;
  let streak        = 0;
  let animFrame     = null;
  let lastTime      = 0;
  let lives         = 3;
  let thorianFlash  = 0;   // seconds Thorian heart flashes red
  let roundTime     = 0;
  let hearts        = [];  // { x, y, vx, vy, dying, dyingT }
  let particles     = [];  // block-burst particles

  // ---- Strip scheduler ----
  let stripHeartLeft    = 0;
  let stripHeartTimer   = 0;   // ms until next heart in strip
  let stripSide         = 'top';
  let betweenStripTimer = 600; // ms until next strip

  // ---- Bar ----
  let barDir = 'right'; // 'up' | 'left' | 'right'

  // ---- Layout (scaled on resize) ----
  let CX = 0, CY = 0;
  let BAR_OFF   = 22;  // px from canvas-center to the near edge of the bar
  let BAR_LEN   = 58;  // total bar length (coverage width/height)
  let BAR_THICK = 10;  // bar thickness
  let THORIAN_R = 16;  // Thorian heart damage radius
  let THORIAN_SZ= 28;  // Thorian heart font size
  let PROJ_R    = 9;   // projectile collision radius
  let PROJ_SZ   = 20;  // projectile font size

  const MAX_LIVES = 2;
  function stepBar(dir) {
    barDir = dir;
  }

  // ---- Difficulty ----
  // Round timer starts short and grows a little each round
  function getRoundSecs()     { return Math.min(8 + streak * 1.5, 20); }
  function getSpeed()         { return window._qteCompMode ? Math.min(155 + streak * 28, 380) : Math.min(145 + streak * 20, 285); }
  function getStripLen()      { return window._qteCompMode ? Math.min(4 + streak, 10)          : Math.min(3 + Math.floor(streak * 0.85), 9); }
  function getHeartInterval() { return window._qteCompMode ? Math.max(170, 390 - streak * 22)  : Math.max(210, 430 - streak * 20); }
  function getGapDelay()      { return window._qteCompMode ? Math.max(420, 1300 - streak * 90)  : Math.max(500, 1500 - streak * 85); }
  function getActiveSides()   { return ['top', 'left', 'right']; }

  // ---- Highscore ----
  function updateHighscore(val) {
    if (window._qteCompMode) {
      if (val > highscoreComp) {
        highscoreComp = val;
        try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch (e) {}
        if (window._sbSubmitScore) window._sbSubmitScore('thorian-comp', val);
      }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? 'Best: ' + highscoreComp : '';
    } else {
      if (val > highscore) {
        highscore = val;
        try { localStorage.setItem(HS_KEY, highscore); } catch (e) {}
        if (window._sbSubmitScore) window._sbSubmitScore('thorian', val);
      }
      if (hsEl) hsEl.textContent = highscore > 0 ? 'Best: ' + highscore : '';
    }
  }
  updateHighscore(0);
  window.addEventListener('alb-scores-reset', () => {
    highscore = 0; highscoreComp = 0;
    localStorage.removeItem(HS_KEY); localStorage.removeItem(HS_KEY_COMP);
    updateHighscore(0);
  });
  window.addEventListener('alb-mode-changed', () => updateHighscore(0));

  function setStatus(t, c) {
    if (statusEl) { statusEl.textContent = t; statusEl.style.color = c || '#888'; }
  }

  // ---- Canvas (square) ----
  function resizeCanvas() {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    const sz    = Math.min(wrap.clientWidth - 24 || 440, 440);
    canvas.width = canvas.height = sz;
    CX = CY      = sz / 2;
    BAR_OFF      = Math.round(sz * 0.052);
    BAR_LEN      = Math.round(sz * 0.135);
    BAR_THICK    = Math.round(sz * 0.024);
    THORIAN_R    = Math.round(sz * 0.038);
    THORIAN_SZ   = Math.round(sz * 0.100);
    PROJ_R       = Math.round(sz * 0.022);
    PROJ_SZ      = Math.round(sz * 0.056);
  }

  // ---- Bar bounding box ----
  // Each orientation lives OUTSIDE the Thorian heart on exactly one side.
  // Hearts aimed at center from perpendicular sides will not reach the bar
  // (they hit Thorian or the opposite-side bar first), ensuring no false blocks.
  function barRect() {
    const h = BAR_LEN / 2, off = BAR_OFF, th = BAR_THICK;
    if (barDir === 'up')
      return { l: CX - h, r: CX + h,        t: CY - off - th, b: CY - off };
    if (barDir === 'left')
      return { l: CX - off - th, r: CX - off, t: CY - h,        b: CY + h  };
    return   { l: CX + off,      r: CX + off + th, t: CY - h,   b: CY + h  };
  }

  // ---- Heart glyph ----
  function drawHeart(x, y, sz, color, alpha) {
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.fillStyle = color; ctx.font = sz + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u2665', x, y);
    ctx.restore();
  }

  // ---- Draw blue bar as a rounded rect ----
  function drawBar() {
    const bb = barRect();
    const w = bb.r - bb.l, h = bb.b - bb.t;
    const r = Math.min(w, h, 4);
    ctx.save();
    ctx.shadowBlur  = 14;
    ctx.shadowColor = '#2266ff';
    ctx.fillStyle   = '#4499ff';
    ctx.beginPath();
    ctx.moveTo(bb.l + r, bb.t);
    ctx.lineTo(bb.r - r, bb.t);
    ctx.quadraticCurveTo(bb.r, bb.t, bb.r, bb.t + r);
    ctx.lineTo(bb.r, bb.b - r);
    ctx.quadraticCurveTo(bb.r, bb.b, bb.r - r, bb.b);
    ctx.lineTo(bb.l + r, bb.b);
    ctx.quadraticCurveTo(bb.l, bb.b, bb.l, bb.b - r);
    ctx.lineTo(bb.l, bb.t + r);
    ctx.quadraticCurveTo(bb.l, bb.t, bb.l + r, bb.t);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---- Full frame ----
  function drawFrame() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0e0e1a'; ctx.fillRect(0, 0, W, H);

    // Arena border
    ctx.strokeStyle = '#1c1c38'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    // Active side indicators
    const sides = getActiveSides();
    ctx.save(); ctx.globalAlpha = 0.20; ctx.fillStyle = '#aa33ff';
    const IW = 4;
    if (sides.includes('top'))   ctx.fillRect(W * 0.1, 0,       W * 0.8, IW);
    if (sides.includes('left'))  ctx.fillRect(0,       H * 0.1, IW,      H * 0.8);
    if (sides.includes('right')) ctx.fillRect(W - IW,  H * 0.1, IW,      H * 0.8);
    ctx.restore();

    // Thorian heart
    const tColor = thorianFlash > 0 ? '#ff1111' : '#ff5588';
    if (thorianFlash > 0) {
      ctx.save(); ctx.shadowBlur = 28; ctx.shadowColor = '#ff0000';
      drawHeart(CX, CY, THORIAN_SZ * 1.25, tColor, 1.0);
      ctx.restore();
    } else {
      drawHeart(CX, CY, THORIAN_SZ, tColor, 0.75);
    }

    // Blue bar (orbiting the heart)
    drawBar();

    // Purple heart projectiles
    hearts.forEach(h => {
      if (h.dying > 0) {
        // Fading block flash
        ctx.save();
        ctx.globalAlpha = h.dying;
        ctx.shadowBlur = 12; ctx.shadowColor = '#4499ff';
        drawHeart(h.x, h.y, PROJ_SZ * 1.2, '#88ccff', h.dying);
        ctx.restore();
      } else {
        drawHeart(h.x, h.y, PROJ_SZ, '#cc44ff');
      }
    });

    // Block-burst particles
    particles = particles.filter(p => {
      p.life -= 0.04; if (p.life <= 0) return false;
      p.x += p.vx; p.y += p.vy;
      ctx.save(); ctx.globalAlpha = p.life;
      ctx.fillStyle = '#88aaff';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return true;
    });

    // Lives
    const lifeS = Math.round(W * 0.050);
    for (let i = 0; i < MAX_LIVES; i++) {
      drawHeart(14 + i * (lifeS + 4), 14, lifeS, i < lives ? '#ff4466' : '#252540');
    }

    // Timer
    const t = Math.ceil(roundTime);
    ctx.fillStyle = t <= 3 ? '#ee5555' : '#aaaaff';
    ctx.font = 'bold ' + Math.round(W * 0.038) + 'px Rajdhani, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(t + 's', W - 8, 4);

    // Round label
    ctx.fillStyle = '#9966cc';
    ctx.font = Math.round(W * 0.032) + 'px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Round ' + (streak + 1), W / 2, 4);
    ctx.textAlign = 'left';
  }

  function drawIdle() {
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#0e0e1a'; ctx.fillRect(0, 0, W, H);
    drawHeart(W / 2, H / 2, THORIAN_SZ * 1.4, '#ff5588', 0.35);
    ctx.fillStyle = '#555';
    ctx.font = Math.round(W * 0.030) + 'px Rajdhani, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Hold W / A / D  or  \u2191\u2190\u2192  to rotate the bar', W / 2, H * 0.70);
    ctx.textAlign = 'left';
  }

  // ---- Spawn one projectile from a side, aimed at center ----
  function spawnHeart(side) {
    const speed   = getSpeed();
    const spread  = BAR_LEN * 0.38;  // lateral spread within bar coverage
    const W = canvas.width, H = canvas.height;
    let x, y;
    if (side === 'top') {
      x = CX + (Math.random() - 0.5) * spread * 2;
      y = -PROJ_R;
    } else if (side === 'left') {
      x = -PROJ_R;
      y = CY + (Math.random() - 0.5) * spread * 2;
    } else {
      x = W + PROJ_R;
      y = CY + (Math.random() - 0.5) * spread * 2;
    }
    // Velocity directed toward center
    const dx = CX - x, dy = CY - y, dist = Math.sqrt(dx * dx + dy * dy);
    hearts.push({ x, y, vx: dx / dist * speed, vy: dy / dist * speed, dying: 0 });
  }

  // ---- Collision ----
  function overlapsBar(h) {
    const bb = barRect(), r = PROJ_R;
    return h.x + r > bb.l && h.x - r < bb.r && h.y + r > bb.t && h.y - r < bb.b;
  }
  function hitsThorian(h) {
    const dx = h.x - CX, dy = h.y - CY;
    return dx * dx + dy * dy < (THORIAN_R + PROJ_R) * (THORIAN_R + PROJ_R);
  }

  // ---- Game loop ----
  function gameLoop(now) {
    if (!running) return;
    const dt   = Math.min((now - lastTime) / 1000, 0.05);
    lastTime   = now;
    const dtMs = dt * 1000;

    // Strip scheduler
    if (stripHeartLeft > 0) {
      stripHeartTimer -= dtMs;
      if (stripHeartTimer <= 0) {
        spawnHeart(stripSide);
        stripHeartLeft--;
        stripHeartTimer = getHeartInterval();
      }
    } else {
      betweenStripTimer -= dtMs;
      if (betweenStripTimer <= 0) {
        const sides = getActiveSides();
        stripSide       = sides[Math.floor(Math.random() * sides.length)];
        stripHeartLeft  = getStripLen();
        stripHeartTimer = 0;
        betweenStripTimer = getGapDelay();
      }
    }

    if (thorianFlash > 0) thorianFlash -= dt;

    // Move hearts & check collisions
    const W = canvas.width, H = canvas.height;
    hearts = hearts.filter(h => {
      if (h.dying > 0) { h.dying -= 0.07; return h.dying > 0; }

      h.x += h.vx * dt;
      h.y += h.vy * dt;

      // Off-screen
      if (h.x < -40 || h.x > W + 40 || h.y < -40 || h.y > H + 40) return false;

      // Hit bar → block
      if (overlapsBar(h)) {
        h.dying = 1.0;
        for (let i = 0; i < 7; i++) {
          particles.push({
            x: h.x, y: h.y,
            vx: (Math.random() - 0.5) * 3.5,
            vy: (Math.random() - 0.5) * 3.5,
            r: 2 + Math.random() * 3, life: 0.9
          });
        }
        if (window._playQteSfx) window._playQteSfx('dodge', true);
        return true;
      }

      // Hit Thorian heart → damage
      if (hitsThorian(h)) {
        lives--;
        thorianFlash = 0.5;
        if (window._playQteSfx) window._playQteSfx('dodge', false);
        if (lives <= 0) { onGameOver(); return false; }
        return false;
      }
      return true;
    });

    roundTime -= dt;
    if (roundTime <= 0 && running) { onRoundWin(); return; }

    drawFrame();
    animFrame = requestAnimationFrame(gameLoop);
  }

  function onRoundWin() {
    streak++;
    updateHighscore(streak);
    hearts = []; particles = []; lives = MAX_LIVES;
    if (streakEl) streakEl.textContent = 'Rounds: ' + streak;
    setStatus('Round ' + streak + ' survived!', '#88ffaa');
    drawFrame();
    setTimeout(() => { if (running) beginRound(); }, 1600);
  }

  function onGameOver() {
    cancelAnimationFrame(animFrame);
    running = false; hearts = []; particles = [];
    setStatus('Thorian fell! ' + streak + ' round' + (streak !== 1 ? 's' : '') + ' survived', '#ee5555');
    drawFrame();
    setTimeout(() => {
      gameStarted = false;
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
    }, 1900);
  }

  function beginRound() {
    hearts = []; particles = [];
    roundTime         = getRoundSecs();
    stripHeartLeft    = 0;
    betweenStripTimer = 700;
    running           = true;
    setStatus('Block the hearts!', '#cc88ff');
    animFrame = requestAnimationFrame(ts => { lastTime = ts; gameLoop(ts); });
  }

  function startGame() {
    streak = 0; lives = MAX_LIVES; thorianFlash = 0;
    paused = false; gameStarted = true; barDir = 'right';
    hearts = []; particles = [];
    resizeCanvas();
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (streakEl)  streakEl.textContent = '';
    setStatus('Block the hearts!', '#cc88ff');
    beginRound();
  }

  function resetToStart() {
    cancelAnimationFrame(animFrame);
    running = false; gameStarted = false; paused = false;
    hearts = []; particles = [];
    streak = 0; lives = MAX_LIVES; thorianFlash = 0; barDir = 'right';
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('', '#888');
    if (streakEl) streakEl.textContent = '';
    resizeCanvas(); drawIdle();
  }

  // ---- Keyboard ----
  const KEY_MAP = {
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right'
  };

  document.addEventListener('keydown', e => {
    if (!document.getElementById('page-qte')?.classList.contains('active')) return;
    const panel = document.getElementById('qte-panel-thorian');
    if (!panel || panel.style.display === 'none') return;
    const dir = KEY_MAP[e.key];
    if (!dir) return;
    e.preventDefault();
    if (gameStarted && !paused) stepBar(dir);
  });

  if (startBtn)  startBtn.addEventListener('click', startGame);
  if (resumeBtn) resumeBtn.addEventListener('click', () => {
    if (!paused) return;
    paused = false; running = true;
    betweenStripTimer = 700;
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('Block the hearts!', '#cc88ff');
    animFrame = requestAnimationFrame(ts => { lastTime = ts; gameLoop(ts); });
  });

  // ---- Tab hooks ----
  window._onThorianQteShow = function () {
    resizeCanvas();
    if (paused) {
      if (resumeBtn) resumeBtn.style.display = '';
      if (startBtn)  startBtn.style.display  = 'none';
      setStatus('Paused', '#888');
      drawFrame();
    } else if (!gameStarted) {
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
      setStatus('', '#888');
      if (streakEl) streakEl.textContent = '';
      drawIdle();
    }
  };

  window._onThorianQteHide = function () {
    if (paused) return;
    if (gameStarted && running) {
      cancelAnimationFrame(animFrame); running = false; paused = true;
    } else { resetToStart(); streak = 0; }
  };

  // ---- Mobile d-pad (up / left / right) ----
  if (IS_MOBILE) {
    const dpad = document.createElement('div');
    dpad.className = 'thorian-dpad';
    dpad.innerHTML =
      '<div class="thorian-dpad-row"><button class="thorian-dpad-btn" data-dir="up">\u2191</button></div>' +
      '<div class="thorian-dpad-row">' +
        '<button class="thorian-dpad-btn" data-dir="left">\u2190</button>' +
        '<button class="thorian-dpad-btn" data-dir="right">\u2192</button>' +
      '</div>';
    dpad.querySelectorAll('.thorian-dpad-btn').forEach(btn => {
      const dir = btn.dataset.dir;
      btn.addEventListener('touchstart', e => { e.preventDefault(); if (gameStarted && !paused) stepBar(dir); }, { passive: false });
    });
    canvas.parentNode.insertBefore(dpad, canvas.nextSibling);
  }

  resizeCanvas();
  drawIdle();
})();

// === THORIAN NEW QTE ===
// Drag the gold diamond onto purple circles to score. Avoid red circles.
// Black eye-shaped shards float upward in the background continuously.
(function () {
  const canvas   = document.getElementById('thorian-new-qte-canvas');
  if (!canvas) return;
  const ctx      = canvas.getContext('2d');
  const statusEl = document.getElementById('thorian-new-qte-status');
  const streakEl = document.getElementById('thorian-new-qte-streak');
  const hsEl     = document.getElementById('thorian-new-qte-highscore');
  const startBtn = document.getElementById('thorian-new-qte-start-btn');
  const resumeBtn= document.getElementById('thorian-new-qte-resume-btn');

  const HS_KEY      = 'alb:thorian-new-hs-v2'; // v2: scoring changed to rounds
  const HS_KEY_COMP = 'alb:thorian-new-hs-comp';
  let highscore     = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
  let highscoreComp = parseInt(localStorage.getItem(HS_KEY_COMP) || '0', 10);

  // Clear old local highscore key (scoring system changed to rounds)
  localStorage.removeItem('alb:thorian-new-hs');

  // Canvas size
  let W = 0, H = 0;

  // Background shards (dark upward-floating eye shapes)
  const SHARD_COUNT = 30;
  let shards = [];

  // Targets
  const TARGET_R    = 22;
  const PLAYER_R    = 26;
  const MAX_TARGETS  = 5;
  const GAME_SECS    = 15;

  const MAX_YELLOWS = 3;
  let targets    = [];
  let yellows    = [];
  let heldYellow = null;
  let dragOX = 0, dragOY = 0;
  let yellowSpawnTimer = 0;

  // Game state
  let running       = false;
  let gameStarted   = false;
  let paused        = false;
  let score         = 0; // rounds completed
  let round         = 1;
  let lives         = 2;
  let gameTimer     = GAME_SECS;
  let spawnTimer    = 0;
  let animFrame     = null;
  let lastTime      = 0;
  let flashTimer    = 0;
  let transitioning = false; // between-round countdown
  let transitionTimer = 0;

  function setStatus(t, c) { if (statusEl) { statusEl.textContent = t; statusEl.style.color = c || '#888'; } }
  function updateHs(val) {
    if (window._qteCompMode) {
      if (val > highscoreComp) {
        highscoreComp = val;
        try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {}
        if (window._sbSubmitScore) window._sbSubmitScore('thorian-new-comp', val);
      }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? 'Best: ' + highscoreComp : '';
    } else {
      if (val > highscore) {
        highscore = val;
        try { localStorage.setItem(HS_KEY, highscore); } catch(e) {}
        if (window._sbSubmitScore) window._sbSubmitScore('thorian-new', val);
      }
      if (hsEl) hsEl.textContent = highscore > 0 ? 'Best: ' + highscore : '';
    }
  }
  updateHs(0);
  window.addEventListener('alb-scores-reset', () => { highscore = 0; highscoreComp = 0; localStorage.removeItem(HS_KEY); localStorage.removeItem(HS_KEY_COMP); updateHs(0); });
  window.addEventListener('alb-mode-changed', () => updateHs(0));

  // ---- Canvas resize ----
  function resizeCanvas() {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    W = Math.min(wrap.clientWidth, 900);
    H = Math.max(240, Math.min(360, Math.round(W * 0.38)));
    canvas.width        = W;
    canvas.height       = H;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    initShards();
  }

  // ---- Background shards ----
  function makeShard(initial) {
    const h = 14 + Math.random() * 38;
    const w = h * (0.15 + Math.random() * 0.12);
    return {
      x: Math.random() * W,
      y: initial ? Math.random() * H : H + h + 4,
      w, h,
      spd: 18 + Math.random() * 45,
      alpha: 0.25 + Math.random() * 0.55,
      tilt: (Math.random() - 0.5) * 0.35,
    };
  }
  function initShards() {
    shards = Array.from({ length: SHARD_COUNT }, () => makeShard(true));
  }
  function updateShards(dt) {
    for (const s of shards) {
      s.y -= s.spd * dt;
      if (s.y < -s.h - 4) Object.assign(s, makeShard(false));
    }
  }

  // ---- Drawing ----
  function drawBg() {
    // Base fill
    ctx.fillStyle = '#1f1130';
    ctx.fillRect(0, 0, W, H);

    // Subtle tiled decorative pattern
    ctx.save();
    ctx.globalAlpha = 0.045;
    ctx.fillStyle = '#7744aa';
    const step = 38;
    for (let xi = 0; xi < W; xi += step) {
      for (let yi = 0; yi < H; yi += step) {
        ctx.beginPath();
        ctx.rect(xi + 4, yi + 4, step - 8, step - 8);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawShards() {
    for (const s of shards) {
      ctx.save();
      ctx.globalAlpha = s.alpha;
      ctx.translate(s.x, s.y);
      ctx.rotate(s.tilt);
      // Outer dark ellipse
      ctx.beginPath();
      ctx.ellipse(0, 0, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#090510';
      ctx.fill();
      // Inner highlight suggestion
      ctx.globalAlpha = s.alpha * 0.2;
      ctx.beginPath();
      ctx.ellipse(0, -s.h * 0.08, s.w * 0.28, s.h * 0.22, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#4a1a6a';
      ctx.fill();
      ctx.restore();
    }
  }

  function drawTarget(t) {
    ctx.save();
    ctx.translate(t.x, t.y);
    const r = TARGET_R;
    const isPurple = t.type === 'purple';
    const color = isPurple ? '#bb55ff' : '#ee3311';
    const glow  = isPurple ? 'rgba(180,60,255,0.18)' : 'rgba(220,50,10,0.18)';

    // Outer glow
    const g = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2.0);
    g.addColorStop(0, glow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.0, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // Outer ring
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Inner ring
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.strokeStyle = isPurple ? '#9933dd' : '#cc2200';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = isPurple ? '#ddaaff' : '#ff8866';
    ctx.fill();

    ctx.restore();
  }

  function drawDiamond(x, y) {
    const sz = PLAYER_R;
    ctx.save();
    ctx.translate(x, y);

    // Outer diamond frame
    ctx.beginPath();
    ctx.moveTo(0, -sz);
    ctx.lineTo(sz * 0.65, 0);
    ctx.lineTo(0, sz);
    ctx.lineTo(-sz * 0.65, 0);
    ctx.closePath();
    ctx.fillStyle = '#140c1e';
    ctx.fill();
    ctx.strokeStyle = '#ddaa22';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Inner diamond
    ctx.beginPath();
    ctx.moveTo(0, -sz * 0.58);
    ctx.lineTo(sz * 0.38, 0);
    ctx.lineTo(0, sz * 0.58);
    ctx.lineTo(-sz * 0.38, 0);
    ctx.closePath();
    ctx.strokeStyle = '#ffcc44';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Corner dots
    for (const [px, py] of [[0,-sz],[sz*0.65,0],[0,sz],[-sz*0.65,0]]) {
      ctx.beginPath();
      ctx.arc(px, py, 2.8, 0, Math.PI * 2);
      ctx.fillStyle = '#ffe066';
      ctx.fill();
    }

    // Side decorative ticks
    for (const [px, py, a] of [[0,-sz*0.78,0],[sz*0.51,0,Math.PI/2],[0,sz*0.78,0],[-sz*0.51,0,Math.PI/2]]) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      ctx.strokeStyle = '#cc9922';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(0, 3); ctx.stroke();
      ctx.restore();
    }

    // Center gem
    ctx.beginPath();
    ctx.arc(0, 0, sz * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = '#0d0814';
    ctx.fill();
    ctx.strokeStyle = '#ffdd55';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  function drawHUD() {
    // Timer bar at top
    const pct = Math.max(0, gameTimer / GAME_SECS);
    ctx.fillStyle = '#2a1a3a';
    ctx.fillRect(0, 0, W, 5);
    const barColor = pct > 0.4 ? '#9944cc' : pct > 0.2 ? '#cc7722' : '#cc2222';
    ctx.fillStyle = barColor;
    ctx.fillRect(0, 0, W * pct, 5);

    // Lives hearts
    ctx.font = 'bold 13px Rajdhani, Arial';
    ctx.fillStyle = '#ee5566';
    ctx.textAlign = 'left';
    ctx.fillText('♥'.repeat(lives) + '♡'.repeat(Math.max(0, 2 - lives)), 10, 22);

    // Round
    ctx.fillStyle = '#cc88ff';
    ctx.textAlign = 'right';
    ctx.fillText('Round ' + round, W - 10, 22);

    // Flash overlay on bad hit
    if (flashTimer > 0) {
      ctx.save();
      ctx.globalAlpha = flashTimer * 0.35;
      ctx.fillStyle = '#cc2200';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  function drawFrame() {
    drawBg();
    drawShards();
    for (const t of targets) drawTarget(t);
    // Draw non-held yellows first, held one on top
    for (const y of yellows) if (y !== heldYellow) drawDiamond(y.x, y.y);
    if (heldYellow) drawDiamond(heldYellow.x, heldYellow.y);
    if (running) drawHUD();
  }

  function drawIdle() {
    drawBg();
    drawShards();
    drawDiamond(W / 2, H / 2);
  }

  // ---- Spawn ----
  // 5 fixed vertical columns
  function getColumnX(col) { return Math.round(W * (col * 2 + 1) / 10); }

  function spawnTarget() {
    const margin = TARGET_R + 20;
    const usedCols = new Set(targets.map(t => t.col));
    const freeCols = [0,1,2,3,4].filter(c => !usedCols.has(c));
    if (freeCols.length === 0) return;
    const col  = freeCols[Math.floor(Math.random() * freeCols.length)];
    const x    = getColumnX(col);
    const type = Math.random() < 0.75 ? 'purple' : 'red';
    const spd  = getOrbSpeed() * (0.85 + Math.random() * 0.3); // slight per-orb variation
    targets.push({ x, y: H + TARGET_R + 4, col, type, vy: -spd });
  }

  function spawnYellow() {
    const margin = PLAYER_R + 20;
    const usedCols = new Set(yellows.map(y => y.col));
    const freeCols = [0,1,2,3,4].filter(c => !usedCols.has(c));
    if (freeCols.length === 0) return;
    const col = freeCols[Math.floor(Math.random() * freeCols.length)];
    const x   = getColumnX(col);
    const y   = margin + Math.random() * (H - margin * 2);
    yellows.push({ x, y, col, life: 3 + Math.random() * 3 });
  }

  function dist2(ax, ay, bx, by) { return (ax - bx) ** 2 + (ay - by) ** 2; }

  // Orb speed scales with round (px/s) — comp mode scales faster
  function getOrbSpeed() {
    return window._qteCompMode
      ? Math.min(300, 65 + (round - 1) * 28)
      : Math.min(220, 45 + (round - 1) * 18);
  }

  // ---- Collision ----
  function checkCollisions() {
    if (!heldYellow) return;
    const threshold = (PLAYER_R + TARGET_R * 0.72) ** 2;
    let hit = false;
    targets = targets.filter(t => {
      if (!hit && dist2(heldYellow.x, heldYellow.y, t.x, t.y) < threshold) {
        hit = true;
        if (t.type === 'red') {
          lives--;
          flashTimer = 0.55;
          if (lives <= 0) {
            yellows = yellows.filter(y => y !== heldYellow);
            heldYellow = null;
            onGameOver();
            return false;
          }
        }
        // Both yellow diamond and target disappear together
        yellows = yellows.filter(y => y !== heldYellow);
        heldYellow = null;
        return false;
      }
      return true;
    });
  }

  // ---- Between-round transition ----
  function drawTransition() {
    drawBg();
    drawShards();
    ctx.save();
    ctx.fillStyle = 'rgba(20,10,35,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ddaaff';
    ctx.font = 'bold 22px Rajdhani, Arial';
    ctx.fillText('Round ' + (round - 1) + ' Complete!', W / 2, H / 2 - 16);
    ctx.fillStyle = '#aa77dd';
    ctx.font = '15px Rajdhani, Arial';
    ctx.fillText('Next round in ' + Math.ceil(transitionTimer) + '…', W / 2, H / 2 + 12);
    ctx.restore();
    drawHUD();
  }

  // ---- Game loop ----
  function gameLoop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    updateShards(dt);

    // Between-round countdown
    if (transitioning) {
      transitionTimer -= dt;
      if (transitionTimer <= 0) {
        transitioning = false;
        gameTimer = GAME_SECS;
        lives = 2;
        targets = []; yellows = []; heldYellow = null;
        spawnTimer = 0; yellowSpawnTimer = 0;
        setStatus('Round ' + round + ' — Survive!', '#cc88ff');
      } else {
        drawTransition();
        animFrame = requestAnimationFrame(gameLoop);
        return;
      }
    }

    gameTimer -= dt;
    if (gameTimer <= 0) { onRoundComplete(); return; }

    if (flashTimer > 0) flashTimer -= dt;

    // Spawn targets
    spawnTimer -= dt;
    if (spawnTimer <= 0 && targets.length < MAX_TARGETS) {
      spawnTarget();
      spawnTimer = 0.4 + Math.random() * 0.8;
    }

    // Spawn yellows
    yellowSpawnTimer -= dt;
    if (yellowSpawnTimer <= 0 && yellows.length < MAX_YELLOWS) {
      spawnYellow();
      yellowSpawnTimer = 0.3 + Math.random() * 0.4;
    }

    // Move orbs upward and remove when off-screen
    targets = targets.filter(t => {
      t.y += t.vy * dt;
      if (t.y < -TARGET_R - 4) {
        if (t.type === 'purple') {
          lives--;
          flashTimer = 0.55;
          if (lives <= 0) { onGameOver(); return false; }
        }
        return false;
      }
      return true;
    });

    // Age out yellows — held yellow is immune
    yellows = yellows.filter(y => {
      if (y === heldYellow) return true;
      y.life -= dt;
      return y.life > 0;
    });

    drawFrame();
    animFrame = requestAnimationFrame(gameLoop);
  }

  function onRoundComplete() {
    score++;
    round++;
    transitioning = true;
    transitionTimer = 1.0;
    updateHs(score);
    if (streakEl) streakEl.textContent = 'Rounds: ' + score;
    animFrame = requestAnimationFrame(gameLoop);
  }

  function onGameOver() {
    cancelAnimationFrame(animFrame);
    running = false;
    transitioning = false;
    updateHs(score);
    setStatus('Game over!  Rounds: ' + score, '#ee5544');
    if (streakEl) streakEl.textContent = '';
    setTimeout(() => {
      gameStarted = false;
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
    }, 2200);
  }

  function startGame() {
    score = 0; round = 1; lives = 2; gameTimer = GAME_SECS;
    targets = []; yellows = []; heldYellow = null;
    spawnTimer = 0; yellowSpawnTimer = 0; flashTimer = 0;
    transitioning = false; transitionTimer = 0;
    paused = false; gameStarted = true;
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (streakEl)  streakEl.textContent    = '';
    setStatus('Round 1 — Survive!', '#cc88ff');
    running = true;
    animFrame = requestAnimationFrame(ts => { lastTime = ts; gameLoop(ts); });
  }

  function resetToStart() {
    cancelAnimationFrame(animFrame);
    running = false; gameStarted = false; paused = false;
    score = 0; lives = 2; gameTimer = GAME_SECS;
    targets = []; yellows = []; heldYellow = null; flashTimer = 0; yellowSpawnTimer = 0; transitioning = false; transitionTimer = 0; score = 0; round = 1;
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (streakEl)  streakEl.textContent    = '';
    setStatus('', '#888');
    resizeCanvas(); drawIdle();
  }

  // ---- Drag input ----
  function getCanvasPosRaw(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width  / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }

  function getCanvasPos(e) {
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return getCanvasPosRaw(cx, cy);
  }

  function tryStartDrag(pos) {
    if (!gameStarted || !running || heldYellow) return;
    const grab2 = (PLAYER_R * 1.8) ** 2;
    for (const y of yellows) {
      if (dist2(pos.x, pos.y, y.x, y.y) < grab2) {
        heldYellow = y;
        dragOX = pos.x - y.x;
        dragOY = pos.y - y.y;
        return;
      }
    }
  }

  function moveDrag(pos) {
    if (!heldYellow) return;
    heldYellow.x = Math.max(PLAYER_R, Math.min(W - PLAYER_R, pos.x - dragOX));
    heldYellow.y = Math.max(PLAYER_R, Math.min(H - PLAYER_R, pos.y - dragOY));
  }

  function releaseDrag(pos) {
    if (!heldYellow) return;
    const threshold = (PLAYER_R + TARGET_R * 0.72) ** 2;
    let hit = false;
    targets = targets.filter(t => {
      if (hit) return true;
      if (dist2(heldYellow.x, heldYellow.y, t.x, t.y) < threshold) {
        hit = true;
        if (t.type === 'red') {
          yellows = yellows.filter(y => y !== heldYellow);
          heldYellow = null;
          onGameOver();
          return false;
        }
        // purple: both disappear
        yellows = yellows.filter(y => y !== heldYellow);
        heldYellow = null;
        return false;
      }
      return true;
    });
    if (heldYellow) heldYellow = null; // released over nothing
  }

  function getTouchReleasePos(e) {
    const t = e.changedTouches?.[0] || e;
    return getCanvasPosRaw(t.clientX, t.clientY);
  }

  canvas.addEventListener('mousedown',  e => tryStartDrag(getCanvasPos(e)));
  canvas.addEventListener('mousemove',  e => moveDrag(getCanvasPos(e)));
  canvas.addEventListener('mouseup',    e => releaseDrag(getCanvasPos(e)));
  canvas.addEventListener('mouseleave', () => { heldYellow = null; });

  canvas.addEventListener('touchstart', e => { e.preventDefault(); tryStartDrag(getCanvasPos(e)); }, { passive: false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); moveDrag(getCanvasPos(e)); }, { passive: false });
  canvas.addEventListener('touchend',   e => { e.preventDefault(); releaseDrag(getTouchReleasePos(e)); }, { passive: false });

  if (startBtn)  startBtn.addEventListener('click', startGame);
  if (resumeBtn) resumeBtn.addEventListener('click', () => {
    if (!paused) return;
    paused = false; running = true;
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('Round ' + round + ' — Survive!', '#cc88ff');
    animFrame = requestAnimationFrame(ts => { lastTime = ts; gameLoop(ts); });
  });

  // ---- Tab hooks ----
  window._onThorianNewQteShow = function () {
    resizeCanvas();
    if (paused) {
      if (resumeBtn) resumeBtn.style.display = '';
      if (startBtn)  startBtn.style.display  = 'none';
      setStatus('Paused', '#888');
      drawFrame();
    } else if (!gameStarted) {
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
      setStatus('', '#888');
      drawIdle();
    }
  };

  window._onThorianNewQteHide = function () {
    if (paused) return;
    if (gameStarted && running) {
      cancelAnimationFrame(animFrame); running = false; paused = true;
    } else { resetToStart(); }
  };

  resizeCanvas();
  drawIdle();
})();

// === DAGGER NEW QTE (multiple spinning bars, fixed marker at 12 o'clock) ===
(function () {
  const canvas    = document.getElementById('dagger-new-qte-canvas');
  if (!canvas) return;
  const ctx       = canvas.getContext('2d');
  const statusEl  = document.getElementById('dagger-new-qte-status');
  const streakEl  = document.getElementById('dagger-new-qte-streak');
  const hsEl      = document.getElementById('dagger-new-qte-highscore');
  const startBtn  = document.getElementById('dagger-new-qte-start-btn');
  const resumeBtn = document.getElementById('dagger-new-qte-resume-btn');
  const tapBtn    = document.getElementById('dagger-new-tap-btn');

  const HS_KEY      = 'alb:dagger-new-hs';
  const HS_KEY_COMP = 'alb:dagger-new-hs-comp';
  let highscore     = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
  let highscoreComp = parseInt(localStorage.getItem(HS_KEY_COMP) || '0', 10);

  // Canvas: 0 rad = right (3 o'clock), π/2 = bottom, 3π/2 = top (12 o'clock)
  const NEEDLE_ANGLE = 3 * Math.PI / 2; // fixed marker at 12 o'clock
  // Bar half-width: based on level count (fixed for the level, doesn't change as bars are removed)
  function getZoneHalf() {
    const n = Math.max(level, 1);
    return Math.max(Math.min((Math.PI / n) * 0.5, (32 * Math.PI) / 180), (7 * Math.PI) / 180);
  }

  const LIVES_MAX = 3;
  let running = false, gameStarted = false, paused = false;
  let score = 0, timeLeft = 10, timerMax = 10;
  let level = 1, hitsThisLevel = 0;
  let lives = LIVES_MAX, maxLives = LIVES_MAX;
  let bars = [];        // { angle, speed }
  let flashMiss = 0, flashLevel = 0;
  let animFrame = null, lastTime = 0;

  function updateHs(val) {
    if (window._qteCompMode) {
      if (val > highscoreComp) { highscoreComp = val; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('dagger-new-comp', val); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? 'Best: ' + highscoreComp : '';
    } else {
      if (val > highscore) { highscore = val; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} if (window._sbSubmitScore) window._sbSubmitScore('dagger-new', val); }
      if (hsEl) hsEl.textContent = highscore > 0 ? 'Best: ' + highscore : '';
    }
  }
  updateHs(0);
  window.addEventListener('alb-scores-reset', () => { highscore = 0; highscoreComp = 0; localStorage.removeItem(HS_KEY); localStorage.removeItem(HS_KEY_COMP); updateHs(0); });
  window.addEventListener('alb-mode-changed', () => updateHs(0));

  function setStatus(text, color) { if (statusEl) { statusEl.textContent = text; statusEl.style.color = color || '#888'; } }

  function getBaseSpeed()     { const b = window._qteCompMode ? 2.4 : 1.7, s = window._qteCompMode ? 0.09 : 0.06; return Math.min(b + level * s, window._qteCompMode ? 7.0 : 5.0); }
  function getSpawnInterval() { return Math.max(window._qteCompMode ? 0.8 : 1.0, (window._qteCompMode ? 2.5 : 3.2) - level * 0.15); }
  function getMaxBars()       { return Math.min(level, 11); }
  function hitsNeeded()       { return level; }

  function normalise(a)      { return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); }
  function angDist(a, b)     { const d = Math.abs(normalise(a) - normalise(b)); return Math.min(d, 2 * Math.PI - d); }
  function barInZone(bar)    { return angDist(bar.angle, NEEDLE_ANGLE) <= getZoneHalf(); }

  function spawnAllBars() {
    const count     = getMaxBars();
    const spd       = getBaseSpeed();
    const slotAngle = (2 * Math.PI) / count;
    const zh        = getZoneHalf();
    // Place nearest bar randomly within the gap, never on the marker
    const margin    = zh * 1.3;
    const phase     = margin + Math.random() * (slotAngle - margin * 2);
    const offset    = normalise(NEEDLE_ANGLE - phase);
    bars = [];
    for (let i = 0; i < count; i++) {
      bars.push({ angle: normalise(offset + slotAngle * i), speed: spd });
    }
  }

  function resizeCanvas() {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    const side = Math.min(wrap.clientWidth - 16, 400);
    canvas.width = side; canvas.height = side;
    canvas.style.width = side + 'px'; canvas.style.height = side + 'px';
  }

  function drawFrame(idle) {
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R  = Math.min(W, H) * 0.37;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#12121e'; ctx.fillRect(0, 0, W, H);

    // Miss flash overlay
    if (flashMiss > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(flashMiss, 0.35);
      ctx.fillStyle = '#ff3333'; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    // Level-up flash overlay
    if (flashLevel > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(flashLevel, 0.3);
      ctx.fillStyle = '#ffcc44'; ctx.fillRect(0, 0, W, H); ctx.restore();
    }

    // Outer bezel
    ctx.beginPath(); ctx.arc(cx, cy, R + 14, 0, Math.PI * 2);
    ctx.fillStyle = '#131320'; ctx.fill();
    ctx.strokeStyle = '#222230'; ctx.lineWidth = 2; ctx.stroke();

    // Track ring (full, dark)
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#2a2a40'; ctx.lineWidth = 12; ctx.stroke();

    // Draw all spinning bars (white, like original dagger)
    if (!idle) {
      ctx.lineCap = 'round';
      for (const bar of bars) {
        ctx.beginPath();
        ctx.arc(cx, cy, R, bar.angle - getZoneHalf(), bar.angle + getZoneHalf());
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 12; ctx.stroke();
      }
    }

    // Fixed red marker at 12 o'clock
    const mx  = cx + Math.cos(NEEDLE_ANGLE) * (R + 14);
    const my  = cy + Math.sin(NEEDLE_ANGLE) * (R + 14);
    const mix = cx + Math.cos(NEEDLE_ANGLE) * (R - 6);
    const miy = cy + Math.sin(NEEDLE_ANGLE) * (R - 6);
    ctx.beginPath(); ctx.moveTo(mix, miy); ctx.lineTo(mx, my);
    ctx.strokeStyle = '#ee3344'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ee3344'; ctx.fill();

    // Timer arc (inner ring, drains clockwise from 12 o'clock)
    if (!idle) {
      const frac = Math.max(0, Math.min(timeLeft / timerMax, 1));
      const timerR = R - 22;
      // Background track
      ctx.beginPath(); ctx.arc(cx, cy, timerR, 0, Math.PI * 2);
      ctx.strokeStyle = '#1e1e30'; ctx.lineWidth = 7; ctx.stroke();
      // Filled portion
      if (frac > 0) {
        const timerColor = frac > 0.5 ? '#5599ff' : frac > 0.25 ? '#ffaa33' : '#ff3333';
        ctx.beginPath();
        ctx.arc(cx, cy, timerR, -Math.PI / 2, -Math.PI / 2 + frac * 2 * Math.PI);
        ctx.strokeStyle = timerColor; ctx.lineWidth = 7; ctx.stroke();
      }
    }

    // Centre life dots — bright = alive, dark = lost
    if (!idle) {
      const dotOrbit = R * 0.22, dotSize = Math.max(5, R * 0.065);
      for (let i = 0; i < maxLives; i++) {
        const a = (i * 2 * Math.PI) / maxLives - Math.PI / 2;
        const alive = i < lives;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * dotOrbit, cy + Math.sin(a) * dotOrbit, dotSize, 0, Math.PI * 2);
        ctx.fillStyle = alive ? '#ccccee' : '#1e1e28'; ctx.fill();
        if (alive) { ctx.strokeStyle = '#8888bb'; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
    }

    // Centre hub
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = lives > 0 ? '#bbbbcc' : '#2a1a1a'; ctx.fill();

    // Idle prompt
    if (idle) {
      ctx.fillStyle = '#555577'; ctx.font = '14px Rajdhani, Arial';
      ctx.textAlign = 'center'; ctx.fillText('Press Start', cx, cy + 18); ctx.textAlign = 'left';
    }
  }

  function gameLoop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Countdown timer
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; drawFrame(false); onGameOver(); return; }

    // Advance bars
    for (const bar of bars) {
      bar.angle = normalise(bar.angle + bar.speed * dt);
    }

if (flashMiss  > 0) flashMiss  -= dt;
    if (flashLevel > 0) flashLevel -= dt;
    drawFrame(false);
    animFrame = requestAnimationFrame(gameLoop);
  }

  function updateLevelDisplay() {
    if (streakEl) streakEl.textContent = `Lvl ${level} | ${hitsThisLevel}/${hitsNeeded()}`;
  }

  function levelUp() {
    level++;
    hitsThisLevel = 0;
    lives = Math.min(lives + 1, maxLives); // restore 1 life on level clear
    timeLeft = timerMax;
    flashLevel = 0.8;
    spawnAllBars();
    updateHs(score);
    setStatus('Level ' + level + '!', '#ffcc44');
    updateLevelDisplay();
  }

  function onPress() {
    if (!gameStarted || !running || paused) return;
    // Find first bar currently in the zone and remove it
    const idx = bars.findIndex(b => barInZone(b));
    if (idx === -1) { triggerMiss(); return; } // hit the gap
    bars.splice(idx, 1);
    score++;
    hitsThisLevel++;
    timeLeft = Math.min(timeLeft + 0.3, 10);
    updateHs(score);
    if (hitsThisLevel >= hitsNeeded()) {
      levelUp();
    } else {
      setStatus('Hit!', '#66ee88');
      updateLevelDisplay();
    }
  }

  function triggerMiss() {
    lives--; flashMiss = 0.4; setStatus('Miss!', '#ee4466');
    timeLeft = Math.max(0, timeLeft - 3);
    if (lives <= 0 || timeLeft <= 0) onGameOver();
  }

  function onGameOver() {
    cancelAnimationFrame(animFrame); running = false;
    updateHs(score); setStatus('Game over! Hits: ' + score, '#ee5544');
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (tapBtn)    tapBtn.style.display    = 'none';
  }

  function startGame() {
    resizeCanvas();
    timerMax = 10;
    maxLives = window._qteCompMode ? 1 : LIVES_MAX;
    score = 0; level = 1; hitsThisLevel = 0; lives = maxLives;
    timeLeft = timerMax; flashMiss = 0; flashLevel = 0;
    spawnAllBars();
    running = true; gameStarted = true; paused = false;
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (tapBtn)    tapBtn.style.display    = IS_MOBILE ? '' : 'none';
    updateLevelDisplay();
    setStatus(IS_MOBILE ? 'Tap the bar at the marker!' : 'Space when bar hits the marker!', '#aa88ff');
    lastTime = performance.now();
    animFrame = requestAnimationFrame(gameLoop);
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    if (!document.getElementById('page-qte')?.classList.contains('active')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || document.activeElement?.isContentEditable) return;
    const panel = document.getElementById('qte-panel-dagger-new');
    if (!panel || panel.style.display === 'none') return;
    e.preventDefault(); onPress();
  });

  if (IS_MOBILE) canvas.addEventListener('touchstart', e => { e.preventDefault(); onPress(); }, { passive: false });
  if (tapBtn) {
    tapBtn.addEventListener('touchstart', e => { e.preventDefault(); onPress(); }, { passive: false });
    if (IS_MOBILE) tapBtn.addEventListener('click', onPress);
  }
  if (startBtn)  startBtn.addEventListener('click', startGame);
  if (resumeBtn) resumeBtn.addEventListener('click', () => {
    if (!paused) return;
    paused = false; running = true;
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus(IS_MOBILE ? 'Tap the bar at the marker!' : 'Space when bar hits the marker!', '#aa88ff');
    lastTime = performance.now(); animFrame = requestAnimationFrame(gameLoop);
  });

  window._onDaggerNewQteShow = () => { resizeCanvas(); if (!running) drawFrame(!gameStarted); };
  window._onDaggerNewQteHide = () => {
    if (paused) return;
    if (gameStarted && running) {
      cancelAnimationFrame(animFrame); running = false; paused = true;
      if (resumeBtn) resumeBtn.style.display = ''; if (startBtn) startBtn.style.display = 'none';
    }
  };
  window.addEventListener('resize', () => {
    const panel = document.getElementById('qte-panel-dagger-new');
    if (!panel || panel.style.display === 'none') return;
    resizeCanvas(); if (!running) drawFrame(!gameStarted);
  });

  resizeCanvas();
  drawFrame(true);
})();
