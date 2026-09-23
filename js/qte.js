// === FIST QTE TRAINER ===
// Each run writes a log for the server's check (js/qte-rules.js, 'fist'):
//   ['R', t, '0312']   a round starts; its arrows as ARROWS indexes
//   ['K', t, d, h(, f)] a key judged: direction 0-3, 1 hit / 0 miss;
//                      f (only when non-zero): 1 autorepeat, 2 touch, 4 ping-sim copy
//   ['S', t, streak]   the point is scored (end of the success flash)
//   ['P', t] / ['U', t, '0312']   paused mid-round / resumed with new arrows
//   ['E', t, 'fail'|'time'|'hide']   the attempt ended
// Every restart after a fail or timeout is a new attempt (run.newAttempt()).
(function () {
  const ARROWS = [
    { dir: 'up',    symbol: '↑', keys: ['ArrowUp',    'w', 'W'] },
    { dir: 'down',  symbol: '↓', keys: ['ArrowDown',  's', 'S'] },
    { dir: 'left',  symbol: '←', keys: ['ArrowLeft',  'a', 'A'] },
    { dir: 'right', symbol: '→', keys: ['ArrowRight', 'd', 'D'] },
  ];
  // Lengths, time limits and delays live in the rules file so the check
  // and the game can never disagree.
  const R = QteRules.trainers['fist'];

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

  // The run log (QteRules.Run) of the current Start, its mode, whether the
  // current attempt has already ended, and a generation that invalidates the
  // success-flash callback when the run is reset under it.
  let run         = null;
  let runComp     = false;
  let attemptOver = false;
  let gen         = 0;
  // Bytes the current attempt's log holds (an over-estimate), and whether it
  // has reached R.LOG_BUDGET: then the attempt is no longer logged and its
  // later highs are not submitted - the last one sent stands (a log over the
  // server's size limit would be refused whole).
  let logBytes    = 0;
  let logFull     = false;
  function freshLog() { logBytes = 0; logFull = false; }
  function ev() {
    if (!run || logFull) return;
    // the event as JSON, plus its time (at most 8 digits) and separators
    const size = JSON.stringify(Array.prototype.slice.call(arguments)).length + 10;
    if (logBytes + size > R.LOG_BUDGET) { logFull = true; return; }
    logBytes += size;
    run.ev.apply(run, arguments);
  }
  function seqCode() { return sequence.map(a => ARROWS.indexOf(a)).join(''); }

  function updateHighscore(val) {
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.report(val); return; }
    if (window._qteCompMode) {
      if (val > highscoreComp) { highscoreComp = val; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} if (run && !logFull) run.submit(val); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? `Best: ${highscoreComp}` : '';
    } else {
      if (val > highscore) { highscore = val; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} if (run && !logFull) run.submit(val); }
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

  // Mode is fixed at Start (core.js blocks switching mid-run anyway).
  function getTimeLimit() { return R.timeLimit(runComp, length); }

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
    }, R.TICK_MS);
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
    ev('E', 'time');
    attemptOver = true;
    bar.querySelectorAll('.fist-arrow-box').forEach(b => b.classList.add('wrong'));
    streak = 0;
    length = R.LEN_START;
    setStatus('⏱ Time\'s up!', '#ee8888');
    streakEl.textContent = '';
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.fail(); return; }
    restartTimeout = setTimeout(startRound, R.RESTART_MS);
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
    setTimeout(() => { if (cb) cb(); }, R.FLASH_MS);
  }

  function resetToStart() {
    gen++;
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

  // A restart after a fail or timeout is a new attempt with its own log. The
  // server drops a run an hour after its last submit, and the trainer can loop
  // for hours under one Start, so after 10 minutes a restart takes a fresh run
  // (a new ticket) instead.
  function nextAttempt() {
    attemptOver = false;
    if (!run) return;
    if (run.now() > R.RENEW_RUN_MS) run = QteRules.Run.start(run.type);
    else run.newAttempt();
    freshLog();
  }

  function startRound() {
    restartTimeout = null;
    if (attemptOver) nextAttempt();
    buildSequence();
    ev('R', seqCode());
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
    // Leaving the tab during the flash resets the run (resetToStart bumps
    // gen): the point must not be scored, nor the next round started, after it.
    const g = gen;
    flashBox(current - 1, 'correct', () => {
      if (g !== gen) return;
      streak++;
      length = R.nextLength(length);
      setStatus(`✓ Nice! Next: ${length} arrows`, '#88ee88');
      streakEl.textContent = `Streak: ${streak}`;
      ev('S', streak);
      updateHighscore(streak);
      recordRoundTime();
      restartTimeout = setTimeout(startRound, R.NEXT_MS);
    });
  }

  function onFail(key) {
    stopTimer();
    lockout = true;
    running = false;
    ev('E', 'fail');
    attemptOver = true;
    const boxes = bar.querySelectorAll('.fist-arrow-box');
    boxes.forEach((b, i) => { if (i >= current) b.classList.add('wrong'); });
    streak = 0;
    length = R.LEN_START;
    setStatus(`✗ Wrong! Expected ${sequence[current].symbol}, got ${keyToSymbol(key)}`, '#ee8888');
    streakEl.textContent = '';
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.fail(); return; }
    restartTimeout = setTimeout(startRound, R.RESTART_MS);
  }

  // Direction index of a key, and the flags the log keeps with it.
  function dirOf(key) { return ARROWS.findIndex(a => a.keys.includes(key)); }
  const isPingCopy = typeof window._albIsPingCopy === 'function' ? window._albIsPingCopy : () => false;
  function keyFlags(e) { return (e.repeat ? 1 : 0) | (isPingCopy(e) ? 4 : 0); }
  function logKey(key, matched, flags) {
    if (flags) ev('K', dirOf(key), matched ? 1 : 0, flags);
    else ev('K', dirOf(key), matched ? 1 : 0);
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
    if (!document.getElementById('page-qte')?.classList.contains('active') && !(window._qteMatch && window._qteMatch.active)) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SUMMARY' || tag === 'BUTTON' || document.activeElement?.isContentEditable) return;

    // Prevent page scroll on arrow keys only when QTE panel is visible
    const panel = document.getElementById('qte-panel-fist');
    if (panel && panel.style.display !== 'none') e.preventDefault();
    else return;

    if (!started || lockout || paused) return;

    const expected = sequence[current];
    const matched  = expected.keys.includes(e.key);
    logKey(e.key, matched, keyFlags(e));

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
      // A Start always begins from a clean state: drop a pending restart or
      // success callback from before (only a programmatic click can reach one).
      gen++;
      clearTimeout(restartTimeout);
      if (run) run.close();
      run = QteRules.Run.start('fist' + (window._qteCompMode ? '-comp' : ''));
      runComp = !!window._qteCompMode;
      freshLog();
      attemptOver = false;
      length = R.LEN_START; streak = 0;
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
      ev('U', seqCode());
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
      }, R.TICK_MS);
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
      ev('P');
    } else {
      // Lost, pending restart, or not started — reset to Start
      if (started && !attemptOver) ev('E', 'hide');
      if (run) run.close();
      resetToStart();
      streak = 0;
      length = R.LEN_START;
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
        logKey(key, matched, 2);
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
// Curves, geometry and the ring test live in js/qte-rules.js
// (QteRules.trainers.spear) so the server's check judges with the same numbers.
// The run's log: 'G' canvas size (Start, and resizes mid-run), 'S' each spawn
// (frame time, x, y, approach, failed tries), 'K' each judged click (circle,
// position, elapsed, hit/early), 'E' when the run ends, 'P'/'U' pause/resume.
(function () {
  const canvas     = document.getElementById('spear-qte-canvas');
  if (!canvas) return;
  const RL         = QteRules.trainers['spear'];
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
  let spawnFails    = 0;     // spawns that found no free spot since the last circle
  let run           = null;  // QteRules.Run of the current Start
  let runComp       = false; // mode at Start (switching is blocked mid-run)

  // Circle constants — INNER_R and HIT_TOLERANCE are updated in resizeCanvas
  let geo             = RL.geom(200); // R 52, HT 22: the defaults below, until the first resize
  let INNER_R         = 52;
  let OUTER_R_START   = INNER_R * 2.2;
  let HIT_TOLERANCE   = 22; // scaled with INNER_R so hit-window fraction stays constant regardless of canvas size
  const FADE_MS       = 280;

  const r1 = v => Math.round(v * 10) / 10;

  // Casual: original scaling; comp: power curve (exponent 0.65) — drops fast early, levels off, caps at streak 200
  function getMaxSimul()      { return RL.maxSimul(streak, runComp); }
  function getApproachMs()    { return RL.approach(streak, runComp); }
  function getSpawnInterval() { return RL.interval(streak, runComp); }

  // ---- highscore ----
  // A score counts for the mode its run started in: the Start button can show
  // mid-run (_onSpearQteShow while running) and let the mode be switched under
  // a live run. The Best label follows the selected mode, as before.
  function updateHighscore(val) {
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.report(val); return; }
    const comp = (run && !run.closed) ? runComp : !!window._qteCompMode;
    if (comp) {
      if (val > highscoreComp) { highscoreComp = val; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} submitRun(val); }
    } else {
      if (val > highscore) { highscore = val; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} submitRun(val); }
    }
    const best = window._qteCompMode ? highscoreComp : highscore;
    if (hsEl) hsEl.textContent = best > 0 ? `Best: ${best}` : '';
  }
  // A log whose times pass the rules' limit (a run left paused for half a day)
  // can only be refused; keep it to ourselves.
  function submitRun(val) {
    if (run && run.now() <= QteRules.LIMITS.MAX_T) run.submit(val);
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
    canvas.width = Math.min(wrap.clientWidth - 24 || 800, RL.C.W_MAX);
    canvas.height = RL.canvasH(canvas.width, IS_MOBILE);
    geo           = RL.geom(canvas.height);
    INNER_R       = geo.R;
    OUTER_R_START = geo.OUT;
    HIT_TOLERANCE = geo.HT; // keep hit-window ~35% of approach regardless of canvas size
  }

  // ---- spawn ----
  function spawnCircle(now) {
    const margin  = geo.margin;
    const minDist = geo.minDist;
    let x, y, attempts = 0, valid = false;
    do {
      x = margin + Math.random() * (canvas.width  - margin * 2);
      y = margin + Math.random() * (canvas.height - margin * 2);
      attempts++;
      valid = !circles.some(c => Math.hypot(x - c.x, y - c.y) < minDist);
    } while (!valid && attempts < RL.C.TRIES);
    if (!valid) return false; // no valid position found — skip this spawn
    // Logged as drawn: the check places circles and judges clicks with these numbers.
    x = r1(x); y = r1(y);
    const duration = getApproachMs();
    circles.push({ x, y, spawnTime: now, duration });
    if (run) run.ev('S', r1(now - run.t0), x, y, duration, spawnFails);
    spawnFails = 0;
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
    if (run) run.close();
    setStatus(msg, '#ee6666');
    streakEl.textContent = '';
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.fail(); return; }
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
        if (run) run.ev('E', 'slow', i, r1(now - c.spawnTime));
        dying.push({ x: c.x, y: c.y, dieTime: now, hit: false });
        circles.splice(i, 1);
        triggerMiss('Miss! Too slow.');
        return;
      }
    }

    // Spawn new circles
    if (now >= nextSpawn && circles.length < getMaxSimul()) {
      const spawned = spawnCircle(now);
      if (!spawned) spawnFails++;
      nextSpawn = now + (spawned ? getSpawnInterval() : RL.C.RETRY_MS);
    }

    drawFrame(now);
    animFrame = requestAnimationFrame(gameLoop);
  }

  // ---- start ----
  function startGame() {
    if (run) run.close();
    runComp = !!window._qteCompMode;
    run = QteRules.Run.start('spear' + (runComp ? '-comp' : ''));
    streak        = 0;
    running       = true;
    gameStarted   = true;
    paused        = false;
    circles       = [];
    dying         = [];
    lastMissGuard = 0;
    spawnFails    = 0;
    resizeCanvas();
    run.ev('G', canvas.width, canvas.height);
    canvas.style.display = '';
    nextSpawn = performance.now() + RL.C.FIRST_SPAWN;
    setStatus('Click when the ring reaches the circle!', '#aaaaff');
    streakEl.textContent = '';
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    animFrame = requestAnimationFrame(gameLoop);
  }

  // ---- resume ----
  function resumeGame() {
    if (!paused) return;
    // Shift all circle timestamps forward by how long we were paused (in 0.01 ms steps, as logged)
    const pausedFor = Math.round((performance.now() - pauseTime) * 100) / 100;
    circles.forEach(c => { c.spawnTime += pausedFor; if (c.fadeStart) c.fadeStart += pausedFor; });
    nextSpawn += pausedFor;
    if (run) run.ev('U', pausedFor);
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
      if (dist > geo.reach) continue;

      const elapsed  = now - c.spawnTime;
      const early    = RL.isEarly(elapsed, c.duration, geo);
      if (run) run.ev('K', i, r1(mx), r1(my), r1(elapsed), early ? 0 : 1);

      // Remove from active array immediately — no lingering clickable state
      circles.splice(i, 1);

      if (early) {
        // Clicked too early
        if (run) run.ev('E', 'early');
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
      if (run) run.ev('P');
    } else {
      // failed, pending restart, or not started — full reset
      resetToStart();
      streak = 0;
    }
  };

  window._onSpearQteShow = function () {
    const wBefore = canvas.width, hBefore = canvas.height;
    resizeCanvas();
    // Live circles keep their spots but take the new radius and hit band.
    if (run && (running || paused) && (canvas.width !== wBefore || canvas.height !== hBefore)) run.ev('G', canvas.width, canvas.height);
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
// Tables, the hit test and the constants live in js/qte-rules.js
// (QteRules.trainers.sword) so the server's check judges with the same numbers.
// The run's log: 'R' at each round start (streak, canvas width, bar count, the
// gap draws), 'K' at each judged press (bar, x, round game time, hit), 'E' when
// the run ends, 'P'/'U' on pause/resume, 'Z' on a resize mid-run.
(function () {
  const canvas    = document.getElementById('sword-qte-canvas');
  if (!canvas) return;
  const R         = window.QteRules && QteRules.trainers['sword'];
  if (!R) { console.error('sword trainer: js/qte-rules.js is not loaded'); return; }
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
  let run         = null;   // QteRules.Run of the current Start
  let runComp     = false;  // mode at Start: the tables and the log's type must agree all run
  let roundGT     = 0;      // this round's game time, ms (sum of clamped dt)
  let roundDue    = false;  // the between-rounds timer fired while paused: the round starts on Resume

  const TRACK_H     = R.TRACK_H;
  const BAR_W       = R.BAR_W;
  const BAR_MIN_GAP = R.GAP_MIN; // min px gap between bars
  const BAR_MAX_GAP = R.GAP_MAX; // max px gap between bars (randomized)

  let trackX, trackY, trackW, zoneX, zoneW;

  function getSpeed()     { return R.speed(streak, runComp, !!IS_MOBILE); }
  function getBarCount()  { return R.bars(streak, runComp, !!IS_MOBILE); }

  function updateHighscore(v) {
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.report(v); return; }
    if (window._qteCompMode) {
      if (v > highscoreComp) { highscoreComp = v; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} if (run) run.submit(v); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? `Best: ${highscoreComp}` : '';
    } else {
      if (v > highscore) { highscore = v; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} if (run) run.submit(v); }
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
    trackX = R.PAD;
    trackW = canvas.width - R.PAD * 2;
    trackY = canvas.height / 2 - TRACK_H / 2;
  }

  function computeZone() {
    const z = R.zone(trackW, streak, runComp, !!IS_MOBILE);
    zoneX = z.x;
    zoneW = z.w;
  }

  function startRound() {
    roundPending = false;
    computeZone();
    const count = getBarCount();
    bars = [];
    currentBar = 0;
    roundGT = 0;
    const gaps = [];
    // Bars stagger from left with randomized gaps so timing isn't predictable
    let xPos = trackX - BAR_W;
    for (let i = 0; i < count; i++) {
      bars.push({ x: xPos, stopped: false, inZone: false });
      const gap = BAR_MIN_GAP + Math.random() * (BAR_MAX_GAP - BAR_MIN_GAP);
      gaps.push(gap);
      xPos -= gap;
    }
    if (run) run.ev('R', streak, canvas.width, count, ...gaps);
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
    const dt = Math.min((now - lastTime) / 1000, R.DT_MAX);
    lastTime = now;

    if (!roundPending) {
      const speed = getSpeed();
      for (const b of bars) {
        if (!b.stopped) b.x += speed * dt;
      }
      roundGT += dt * 1000;

      // Check if lead bar flew off the right
      const cur = bars[currentBar];
      if (cur && !cur.stopped && R.pastEnd(cur.x, trackW)) {
        if (run) run.ev('E', 'slow', currentBar, cur.x, roundGT);
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
    cur.inZone  = R.inZone(cur.x, zoneX, zoneW); // any overlap with zone counts
    if (run) run.ev('K', currentBar, cur.x, roundGT, cur.inZone ? 1 : 0);

    if (!cur.inZone) {
      if (run) run.ev('E', 'zone');
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
    // Only this run's next round: a timer left over from a run that was
    // restarted inside these 800 ms must not start a round into the new one.
    // Paused when it fires (the panel was left in these 800 ms): the round
    // starts on Resume. It used to be dropped, which left the run stuck.
    const myRun = run;
    setTimeout(() => {
      if (run !== myRun) return;
      if (running) startRound();
      else if (paused && roundPending) roundDue = true;
    }, R.ROUND_DELAY);
  }

  function triggerFail(msg) {
    if (!running && !gameStarted) return;
    running     = false;
    paused      = false;
    roundPending = false;
    updateHighscore(streak);
    if (run) run.close();
    drawFrame();
    setStatus(msg, '#ee5555');
    streakEl.textContent = '';
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.fail(); return; }
    // Only this run: Start clicked inside these 900 ms (possible when the
    // canvas was hidden) must not have the new run stopped by the old reset.
    const myRun = run;
    setTimeout(() => { if (run === myRun) resetToStart(); }, R.FAIL_RESET);
  }

  function resetToStart() {
    cancelAnimationFrame(animFrame);
    running      = false;
    gameStarted  = false;
    paused       = false;
    roundPending = false;
    roundDue     = false;
    bars         = [];
    canvas.style.display = 'none';
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('', '#888');
  }

  function startGame() {
    if (run) run.close();
    runComp = !!window._qteCompMode;
    run = QteRules.Run.start('sword' + (runComp ? '-comp' : ''));
    streak       = 0;
    running      = true;
    gameStarted  = true;
    paused       = false;
    roundPending = false;
    roundDue     = false;
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
    if (run) run.ev('U');
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus(IS_MOBILE ? 'Tap to stop each bar in the zone!' : 'Press SPACE to stop each bar in the zone!', '#aaaaff');
    if (roundDue) { roundDue = false; startRound(); }
    animFrame = requestAnimationFrame(gameLoop);
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    if (!document.getElementById('page-qte')?.classList.contains('active') && !(window._qteMatch && window._qteMatch.active)) return;
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
      if (run) run.ev('P');
    } else {
      resetToStart();
      streak = 0;
    }
  };

  window._onSwordQteShow = function () {
    const cwBefore = canvas.width;
    resizeCanvas();
    // Bars keep their x and the zone keeps its place until the next round;
    // only the run-off edge follows the new width, so the log needs it.
    if (run && (running || paused) && canvas.width !== cwBefore) run.ev('Z', canvas.width);
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
// Curves, timers and the log's meaning live in js/qte-rules.js ('dodge'), which
// the server's check also runs. The run's log (QteRules.Run): 'G' at Start (track
// width), 'T' each target made, 'L' each launch, 'H' each press judged (bar x,
// game ms flown, hit, ms since the last frame), 'Z' a resize, 'P'/'U' pause and
// resume, 'E' the end ('miss' / 'slow' / 'reset').
(function () {
  const canvas    = document.getElementById('dodge-qte-canvas');
  if (!canvas) return;
  const R         = window.QteRules && QteRules.trainers['dodge'];
  if (!R) return;
  const ctx      = canvas.getContext('2d');
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
  let travel       = 0;    // game seconds the bar has flown (sum of clamped dt), logged with each press
  let inFlight      = false; // white bar currently moving
  let yellowCenter  = R.YC_START; // fraction of track (fixed per round, randomised after each hit)
  let yellowWidth   = 0;    // px, shrinks with streak
  let run           = null; // QteRules.Run for the current Start
  let runComp       = false; // the mode this Start was made in (its curves and its board)
  let launchTimer   = null; // the one pending launch (cleared on pause / reset / new Start)

  const TRACK_H = R.TRACK_H;
  const BAR_W   = R.BAR_W;
  const PAD     = R.PAD;

  let trackX, trackW, trackY;

  function getWhiteSpeed()  { return R.speed(streak, runComp); }
  function calcYellowWidth(){ return R.width(streak, trackW, runComp); }
  function getYellowX()     { return trackX + trackW * yellowCenter; }
  function ev()             { if (run) run.ev.apply(run, arguments); }

  function randomiseYellow() {
    // Pick a new random centre in the 62–80% range, different from current
    yellowCenter = R.nextCenter(yellowCenter, Math.random);
    yellowWidth  = calcYellowWidth();
    ev('T', streak + 1, yellowCenter, yellowWidth);
  }

  // fromRun: a point (or the end) of the current run - judged against the best of
  // the mode the run was started in, which is also the board run.submit posts to.
  function updateHighscore(v, fromRun) {
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.report(v); return; }
    if (fromRun ? runComp : window._qteCompMode) {
      if (v > highscoreComp) { highscoreComp = v; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} submit(v); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? `Best: ${highscoreComp}` : '';
    } else {
      if (v > highscore) { highscore = v; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} submit(v); }
      if (hsEl) hsEl.textContent = highscore > 0 ? `Best: ${highscore}` : '';
    }
  }
  // A run left paused for half a day would log past the log's time limit.
  function submit(v) { if (run && run.now() < R.SUBMIT_MAX_MS) run.submit(v); }
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

  // One pending launch at a time: a stale timer (from before a pause, or from an
  // earlier Start) must never launch or relaunch a bar the log did not schedule.
  function scheduleLaunch(ms) {
    clearTimeout(launchTimer);
    launchTimer = setTimeout(() => { launchTimer = null; if (running) launchBar(); }, ms);
  }
  function cancelLaunch() { clearTimeout(launchTimer); launchTimer = null; }

  function launchBar() {
    whiteX   = trackX;
    travel   = 0;
    inFlight = true;
    ev('L', streak + 1);
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
    const dt = Math.min((now - lastTime) / 1000, R.DT_CAP);
    lastTime = now;

    if (inFlight) {
      whiteX += getWhiteSpeed() * dt;
      travel += dt;
      // Missed — bar exited right side
      if (whiteX > trackX + trackW) {
        inFlight = false;
        ev('E', 'slow', whiteX, travel * 1000);
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
    const tolerance = R.TOL; // px buffer — any part of white bar touching yellow counts
    const overlap = whiteX < yx + yw + tolerance && whiteX + BAR_W > yx - tolerance;
    ev('H', streak + 1, whiteX, travel * 1000, overlap ? 1 : 0, performance.now() - lastTime);

    if (!overlap) {
      ev('E', 'miss');
      triggerFail('Missed the target!');
      return;
    }

    streak++;
    streakEl.textContent = `Streak: ${streak}`;
    updateHighscore(streak, true);
    setStatus('Hit!', '#88ee88');
    randomiseYellow(); // new position + smaller width for next round
    scheduleLaunch(R.NEXT_LAUNCH_MS);
  }

  function triggerFail(msg) {
    if (!running && !gameStarted) return;
    running = paused = false;
    inFlight = false;
    cancelLaunch();
    updateHighscore(streak, true);
    if (run) run.close();
    drawFrame();
    setStatus(msg, '#ee5555');
    streakEl.textContent = '';
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.fail(); return; }
    setTimeout(resetToStart, R.RESET_MS);
  }

  function resetToStart() {
    cancelAnimationFrame(animFrame);
    cancelLaunch();
    if (gameStarted && run && !run.closed) { ev('E', 'reset'); run.close(); }
    running = gameStarted = paused = false;
    inFlight = false;
    canvas.style.display = 'none';
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('', '#888');
  }

  function startGame() {
    runComp = !!window._qteCompMode;
    run = QteRules.Run.start('dodge' + (runComp ? '-comp' : ''));
    streak = 0;
    running = gameStarted = true;
    paused = false;
    inFlight = false;
    resizeCanvas();
    yellowCenter = R.YC_START;
    yellowWidth  = calcYellowWidth();
    ev('G', trackW);
    ev('T', 1, yellowCenter, yellowWidth);
    canvas.style.display = '';
    lastTime = performance.now();
    streakEl.textContent = '';
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    animFrame = requestAnimationFrame(gameLoop);
    scheduleLaunch(R.FIRST_LAUNCH_MS);
  }

  function resumeGame() {
    if (!paused) return;
    paused   = false;
    running  = true;
    lastTime = performance.now();
    ev('U');
    if (resumeBtn) resumeBtn.style.display = 'none';
    animFrame = requestAnimationFrame(gameLoop);
    if (!inFlight) scheduleLaunch(R.RESUME_LAUNCH_MS);
    else setStatus(IS_MOBILE ? 'Tap when the bar hits the yellow!' : 'Press SPACE when the bar hits the yellow!', '#aaaaff');
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    if (!document.getElementById('page-qte')?.classList.contains('active') && !(window._qteMatch && window._qteMatch.active)) return;
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
      cancelLaunch();
      running = false; paused = true;
      ev('P');
    } else { resetToStart(); streak = 0; }
  };

  window._onDodgeQteShow = function () {
    const prevW = trackW;
    resizeCanvas();
    if (gameStarted && trackW !== prevW) ev('Z', trackW);
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
// Tables, the hit test and the constants live in js/qte-rules.js
// (QteRules.trainers.dagger) so the server's check judges with the same numbers.
// The run's log: 'R' at each round start (streak, each ring's start angle signed
// by its direction), 'K' at each judged press (ring, the round's game time the
// judged angle comes from, hit, source), 'E' when the run ends, 'P'/'U' on
// pause/resume.
(function () {
  const canvas    = document.getElementById('dagger-qte-canvas');
  if (!canvas) return;
  // Without its rules this trainer cannot run; return instead of throwing, so the
  // trainers after this one in qte.js still load.
  const R         = window.QteRules && window.QteRules.trainers && window.QteRules.trainers['dagger'];
  if (!R) { canvas.style.display = 'none'; return; }
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

  let running           = false;
  let gameStarted       = false;
  let paused            = false;
  let streak            = 0;
  let animFrame         = null;
  let lastTime          = 0;
  let rings             = [];
  let currentRing       = 0;
  let roundPending      = false;
  let pendingRoundTimer = null; // tracks the between-round setTimeout so it can be cancelled on pause
  let arrowRadius       = 0;
  let roundEndTime      = 0; // performance.now() when the round expires
  let run               = null;  // QteRules.Run of the current Start
  let runComp           = false; // mode at Start: the tables and the log's type must agree all run
  let roundGT           = 0;     // this round's game time, ms (sum of the clamped frame dts)

  const RING_THICK = 16;
  const RING_GAP   = 12;
  const BASE_R     = 48;
  const RING_STEP  = RING_THICK + RING_GAP;

  function getRingCount()  { return R.ringCount(streak, runComp); }
  function getGapSize()    { return R.gapSize(streak, runComp); }
  function getRingSpeed(i, total) {
    const spd  = R.ringSpeed(streak, i, total, runComp);
    return spd * (Math.random() < 0.5 ? 1 : -1);
  }

  // A submit carries the log so far. Past the rules' MAX_T (a run left paused
  // for half a day) the log could only be refused, so it is not sent.
  function submit(v) { if (run && !run.closed && run.now() <= QteRules.LIMITS.MAX_T) run.submit(v); }

  function updateHighscore(v) {
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.report(v); return; }
    // The run's own mode while it is open: the mode can be switched mid-run
    // (clicking the Dagger tab again shows Start, which unblocks the toggle),
    // and the score belongs to the board the run was started for.
    if (run && !run.closed ? runComp : window._qteCompMode) {
      if (v > highscoreComp) { highscoreComp = v; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} submit(v); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? `Best: ${highscoreComp}` : '';
    } else {
      if (v > highscore) { highscore = v; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} submit(v); }
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
      const startGap = R.startGap(Math.random()); // PI*(0.6 + rand*0.8), to the 4 dp the log keeps
      rings.push({ gapAngle: startGap, start: startGap, vel: spd });
    }
    currentRing  = count - 1;
    roundGT      = 0;
    roundEndTime = performance.now() + R.C.ROUND_MS;
    roundStart   = performance.now();
    if (run) run.ev('R', streak, ...rings.map(r => r.vel > 0 ? r.start : -r.start));
    setStatus(IS_MOBILE ? 'Tap when the arrow enters the gap!' : 'Press SPACE when the arrow enters the gap!', '#aaaaff');
  }

  const EXPAND_MS = R.C.EXPAND_MS; // zoom-in animation duration

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
    const dtMs = Math.min(now - lastTime, R.C.DT_MAX_MS);
    lastTime = now;

    if (!roundPending) {
      // Angles from the round's game time: the same expression the hit test
      // (and the server's check) uses, so what is drawn is what is judged.
      roundGT += dtMs;
      for (const ring of rings) ring.gapAngle = R.angle(ring.start, ring.vel, roundGT);

      // Countdown timer — only write to DOM when displayed text changes (~10fps)
      const secsLeft = Math.max(0, (roundEndTime - now) / 1000);
      if (timerEl) {
        const timerTxt = secsLeft > 0 ? secsLeft.toFixed(1) + 's' : '';
        if (timerTxt !== timerEl.textContent) {
          timerEl.textContent = timerTxt;
          timerEl.style.color = secsLeft <= 2 ? '#ee8888' : '#aaaaff';
        }
      }
      if (secsLeft <= 0) { triggerFail("Time's up!", 'time'); return; }
    }

    drawFrame(now);
    animFrame = requestAnimationFrame(gameLoop);
  }

  function onSpacePress(src) {
    if (!running || paused || roundPending) return;
    const ring = rings[currentRing];
    if (!ring || ring.expandFrom !== undefined) return; // block during zoom-in

    // CCW rings are skippable — judge() passes any press on them. A CW ring's
    // gap has to be within gapSize/2 + 7 deg of the arrow, at the angle of the
    // last drawn frame (the round's game time as logged).
    const gT  = R.roundG(roundGT);
    const hit = R.judge(ring.start, ring.vel, gT, streak, runComp).hit;
    if (run) run.ev('K', currentRing, gT, hit ? 1 : 0, src || 'k');
    if (!hit) { triggerFail('Missed the gap!', 'miss'); return; }

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
    if (pendingRoundTimer) clearTimeout(pendingRoundTimer);
    pendingRoundTimer = setTimeout(() => { pendingRoundTimer = null; if (running) startRound(); }, R.C.ROUND_GAP_MS);
  }

  function triggerFail(msg, why) {
    if (!running && !gameStarted) return;
    running = paused = roundPending = false;
    if (run) run.ev('E', why);
    updateHighscore(streak);
    if (run) run.close();
    drawFrame();
    setStatus(msg, '#ee5555');
    streakEl.textContent = '';
    if (timerEl) timerEl.textContent = '';
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.fail(); return; }
    setTimeout(resetToStart, R.C.FAIL_RESET_MS);
  }

  function resetToStart() {
    cancelAnimationFrame(animFrame);
    if (pendingRoundTimer) { clearTimeout(pendingRoundTimer); pendingRoundTimer = null; }
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
    // Start can be clicked while a run is still going: clicking the Dagger tab
    // again runs _onDaggerQteShow, which shows Start. The old run's frame loop
    // and its between-round timer must not carry over (the timer used to start
    // a second round 1 inside the new run).
    cancelAnimationFrame(animFrame);
    if (pendingRoundTimer) { clearTimeout(pendingRoundTimer); pendingRoundTimer = null; }
    if (run) run.close();
    runComp = !!window._qteCompMode;
    run = QteRules.Run.start('dagger' + (runComp ? '-comp' : ''));
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
    if (run) run.ev('U');
    lastTime = performance.now();
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (tapBtn && IS_MOBILE) tapBtn.style.display = '';
    // If we were paused mid-between-rounds, reschedule the startRound timeout
    if (roundPending && !pendingRoundTimer) {
      pendingRoundTimer = setTimeout(() => { pendingRoundTimer = null; if (running) startRound(); }, R.C.RESUME_GAP_MS);
    }
    setStatus(IS_MOBILE ? 'Tap when the arrow enters the gap!' : 'Press SPACE when the arrow enters the gap!', '#aaaaff');
    animFrame = requestAnimationFrame(gameLoop);
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    if (!document.getElementById('page-qte')?.classList.contains('active') && !(window._qteMatch && window._qteMatch.active)) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SUMMARY' || tag === 'BUTTON' || document.activeElement?.isContentEditable) return;
    const panel = document.getElementById('qte-panel-dagger');
    if (!panel || panel.style.display === 'none') return;
    e.preventDefault();
    // src: k key, r auto-repeat; p / q the same, delivered late by the ping simulator
    const late = typeof window._albIsPingCopy === 'function' && window._albIsPingCopy(e);
    onSpacePress(late ? (e.repeat ? 'q' : 'p') : (e.repeat ? 'r' : 'k'));
  });
  if (IS_MOBILE) {
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onSpacePress('t'); }, { passive: false });
    if (tapBtn) tapBtn.addEventListener('touchstart', e => { e.preventDefault(); onSpacePress('t'); }, { passive: false });
  }

  if (startBtn)  startBtn.addEventListener('click', startGame);
  if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);
  if (tapBtn && IS_MOBILE) tapBtn.addEventListener('click', () => onSpacePress('c'));

  window._onDaggerQteHide = function () {
    if (paused) return;
    if (gameStarted && running) {
      cancelAnimationFrame(animFrame);
      running = false; paused = true;
      if (run) run.ev('P');
      // Cancel the between-round timeout so it doesn't fire while paused (running = false)
      // — resumeGame will reschedule it if roundPending is still true
      if (pendingRoundTimer) { clearTimeout(pendingRoundTimer); pendingRoundTimer = null; }
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
// Curves, the zone draw range and the 700 ms gap live in js/qte-rules.js
// (QteRules.trainers.hammer) so the server's check and this game share them.
// The run log (QteRules.Run) records: 'R' each round/zone, 'D' each hold start,
// 'X' each release as judged, 'E' the miss that ends it, 'P'/'U' pause/resume.
(function () {
  const canvas    = document.getElementById('hammer-qte-canvas');
  if (!canvas) return;
  const QR        = window.QteRules;
  const RULES     = QR && QR.trainers && QR.trainers['hammer'];
  if (!RULES || !QR.Run) { try { console.error('[hammer] js/qte-rules.js must load before js/qte.js'); } catch (e) {} return; }
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
  let run = null;        // this Start's QteRules run (log + ticket)
  let runComp = false;   // the mode this Start was made in (the log's type)
  let holdFrames = 0;    // frames (dt > 0) integrated into fillPct during this hold
  const BAR_H = 40; // horizontal bar height
  const PAD   = 50; // left/right padding

  function getFillSpeed() { return RULES.speed(streak, runComp); }
  function getZoneSize()  { return RULES.size(streak, runComp); }

  function randomiseZone() {
    const size   = getZoneSize();
    const center = RULES.C_MIN + Math.random() * RULES.C_SPAN;
    zoneMin = Math.max(0.05, center - size / 2);
    zoneMax = Math.min(0.95, zoneMin + size);
    zoneMin = zoneMax - size;
  }

  function updateHighscore(v) {
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.report(v); return; }
    if (window._qteCompMode) {
      if (v > highscoreComp) { highscoreComp = v; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} if (run) run.submit(v); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? `Best: ${highscoreComp}` : '';
    } else {
      if (v > highscore) { highscore = v; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} if (run) run.submit(v); }
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

  // why: 's' Start, 'n' the gap timer after a hit, 'u' Resume
  function startRound(why) {
    fillPct = 0; holding = false; releaseFlash = null; inSuccessDelay = false; holdFrames = 0;
    randomiseZone();
    if (run) run.ev('R', streak, zoneMin, zoneMax, why);
    setStatus(IS_MOBILE ? 'Hold button to charge, release in the box!' : 'Hold SPACE to charge, release in the box!', '#aaaaff');
    drawFrame();
  }

  // A hold starts (only on the false -> true change, so repeats log nothing).
  function startHold(src) {
    if (holding) return;
    holding = true; holdFrames = 0;
    if (run) run.ev('D', src);
  }

  function gameLoop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, RULES.DT_MAX);
    lastTime = now;
    if (holding) {
      fillPct = Math.min(1, fillPct + getFillSpeed() * dt);
      // Count the frames that moved the bar. A second loop in the same frame
      // (Start pressed again while a run is live: re-clicking the Hammer tab
      // shows the Start button) gets dt = 0 and adds nothing.
      if (dt > 0) holdFrames++;
      if (fillPct >= 1) { holding = false; onRelease('o'); return; }
    }
    drawFrame(now);
    animFrame = requestAnimationFrame(gameLoop);
  }

  // cause: 'k' Space, 't' canvas touch, 'b' HOLD button, 'o' overfill
  function onRelease(cause) {
    if (!running || inSuccessDelay) return;
    const inZone = fillPct >= zoneMin && fillPct <= zoneMax;
    if (run) run.ev('X', fillPct, holdFrames, cause, inZone ? 1 : 0);
    releaseFlash = inZone ? 'hit' : 'miss';
    flashStart   = performance.now();
    drawFrame(flashStart);
    if (!inZone) {
      const early = fillPct < zoneMin;
      if (run) run.ev('E', early ? 'early' : 'late');
      triggerFail(early ? 'Too early!' : 'Too late!');
      return;
    }
    window._playQteSfx('hammer');
    streak++;
    inSuccessDelay = true;
    streakEl.textContent = `Streak: ${streak}`;
    updateHighscore(streak);
    setStatus('Perfect!', '#88ee88');
    setTimeout(() => { if (running) startRound('n'); }, RULES.GAP_MS);
  }

  function triggerFail(msg) {
    if (!running && !gameStarted) return;
    running = paused = false; holding = false; inSuccessDelay = false;
    updateHighscore(streak);
    if (run) run.close();
    setStatus(msg, '#ee5555');
    streakEl.textContent = '';
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.fail(); return; }
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
    runComp = !!window._qteCompMode;
    run = QR.Run.start('hammer' + (runComp ? '-comp' : ''));
    streak = 0; running = gameStarted = true; paused = holding = false; fillPct = 0;
    resizeCanvas(); canvas.style.display = ''; lastTime = performance.now();
    streakEl.textContent = '';
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    startRound('s');
    animFrame = requestAnimationFrame(gameLoop);
  }

  function resumeGame() {
    if (!paused) return;
    paused = false; running = true; holding = false; lastTime = performance.now();
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (run) run.ev('U');
    startRound('u');
    animFrame = requestAnimationFrame(gameLoop);
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    if (!document.getElementById('page-qte')?.classList.contains('active') && !(window._qteMatch && window._qteMatch.active)) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SUMMARY' || tag === 'BUTTON' || document.activeElement?.isContentEditable) return;
    const panel = document.getElementById('qte-panel-hammer');
    if (!panel || panel.style.display === 'none') return;
    e.preventDefault();
    if (!running || paused || inSuccessDelay) return;
    startHold('k');
  });

  document.addEventListener('keyup', e => {
    if (e.code !== 'Space') return;
    const panel = document.getElementById('qte-panel-hammer');
    if (!panel || panel.style.display === 'none') return;
    if (!running || paused || !holding) return;
    holding = false;
    onRelease('k');
  });
  if (IS_MOBILE) {
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      if (!running || paused || inSuccessDelay) return;
      startHold('t');
    }, { passive: false });
    canvas.addEventListener('touchend', e => {
      e.preventDefault();
      if (!running || paused || !holding) return;
      holding = false;
      onRelease('t');
    }, { passive: false });

    // Dedicated HOLD button
    const hammerHoldBtn = document.createElement('button');
    hammerHoldBtn.className = 'qte-mobile-action-btn qte-mobile-hold-btn';
    hammerHoldBtn.textContent = 'HOLD';
    hammerHoldBtn.style.display = 'none';
    hammerHoldBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      if (!running || paused || inSuccessDelay) return;
      startHold('b');
      hammerHoldBtn.classList.add('active');
    }, { passive: false });
    hammerHoldBtn.addEventListener('touchend', e => {
      e.preventDefault();
      hammerHoldBtn.classList.remove('active');
      if (!running || paused || !holding) return;
      holding = false;
      onRelease('b');
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
      if (run) run.ev('P');
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
// Curves, drain/press amounts, the zone draw range and the 700 ms gap live in
// js/qte-rules.js (QteRules.trainers.axe) so the server's check and this game share them.
// The run log (QteRules.Run) records: 'R' each round/zone, 'K' each press in a round
// (the fill after it), 'G' a press between rounds, 'J' each judgement, 'E' the end,
// 'P'/'U' pause/resume.
(function () {
  const canvas    = document.getElementById('axe-qte-canvas');
  if (!canvas) return;
  const QR        = window.QteRules;
  const RULES     = QR && QR.trainers && QR.trainers['axe'];
  if (!RULES || !QR.Run) { try { console.error('[axe] js/qte-rules.js must load before js/qte.js'); } catch (e) {} return; }
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
  let run = null;         // this Start's QteRules run (log + ticket)
  let live = false;       // a round is on and not yet judged
  let gapTimer = null;    // the 700 ms timer between a hit and the next round
  let gapEndAt = 0;       // when that timer is due (performance.now())
  let gapPaused = false;  // paused during that gap
  let gapLeft = 0;        // ...with this much of it still to run

  const BAR_H = 40;
  const PAD   = 50;
  const DRAIN_RATE  = RULES.DRAIN;  // fraction lost per second
  const PRESS_AMT   = RULES.PRESS;  // fraction added per space press

  function getTimer()    { return RULES.timer(streak, !!window._qteCompMode); }
  function getZoneSize() { return RULES.size(streak, !!window._qteCompMode); }

  function randomiseZone() {
    const size   = getZoneSize();
    const center = RULES.C_MIN + Math.random() * RULES.C_SPAN;
    zoneMin = Math.max(0.05, center - size / 2);
    zoneMax = Math.min(0.95, zoneMin + size);
    zoneMin = zoneMax - size;
  }

  function updateHighscore(v) {
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.report(v); return; }
    if (window._qteCompMode) {
      if (v > highscoreComp) { highscoreComp = v; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} if (run) run.submit(v); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? `Best: ${highscoreComp}` : '';
    } else {
      if (v > highscore) { highscore = v; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} if (run) run.submit(v); }
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

  // why: 's' Start, 'n' the gap timer after a hit
  function startRound(why) {
    fillPct      = 0;
    releaseFlash = null;
    randomiseZone();
    // Logged before the round clock is read, so the logged round can only
    // look longer than the real one, never shorter.
    if (run) run.ev('R', streak, zoneMin, zoneMax, why);
    roundEndTime = performance.now() + getTimer() * 1000;
    live = true;
    setStatus(IS_MOBILE ? 'Tap to fill — land in the zone when time runs out!' : 'Press SPACE to fill — land in the zone when time runs out!', '#aaaaff');
    drawFrame();
  }

  function evaluateRound() {
    const inZone = fillPct >= zoneMin && fillPct <= zoneMax;
    live = false;
    if (run) run.ev('J', fillPct, inZone ? 1 : 0);
    releaseFlash = inZone ? 'hit' : 'miss';
    flashStart   = performance.now();
    drawFrame(flashStart);
    if (!inZone) {
      const low = fillPct < zoneMin;
      if (run) run.ev('E', low ? 'low' : 'high');
      triggerFail(low ? 'Too low!' : 'Too high!');
      return;
    }
    streak++;
    streakEl.textContent = `Streak: ${streak}`;
    updateHighscore(streak);
    setStatus('Landed it!', '#88ee88');
    armGap(RULES.GAP_MS);
  }

  // The wait before the next round. A pause holds it and Resume runs only what
  // was left of it, the same way a pause holds the round timer.
  function armGap(ms) {
    gapEndAt = performance.now() + ms;
    gapTimer = setTimeout(() => {
      gapTimer = null;
      if (running) {
        startRound('n');
        lastTime = performance.now();
        animFrame = requestAnimationFrame(gameLoop);
      }
    }, ms);
  }

  function gameLoop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, RULES.DT_MAX);
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

  // src: 'k' Space, 't' canvas touch, 'b' TAP button
  function onSpacePress(src) {
    if (!running || paused) return;
    fillPct = Math.min(1, fillPct + PRESS_AMT);
    if (run) { if (live) run.ev('K', fillPct, src); else run.ev('G'); }
  }

  function triggerFail(msg) {
    if (!running && !gameStarted) return;
    running = paused = false;
    updateHighscore(streak);
    if (run) run.close();
    setStatus(msg, '#ee5555');
    streakEl.textContent = '';
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.fail(); return; }
    setTimeout(resetToStart, 900);
  }

  function resetToStart() {
    cancelAnimationFrame(animFrame);
    if (gapTimer) { clearTimeout(gapTimer); gapTimer = null; }
    if (run && gameStarted && (running || paused)) { run.ev('E', 'x'); run.close(); }
    running = gameStarted = paused = false; fillPct = 0; live = false; gapPaused = false;
    canvas.style.display = 'none';
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('', '#888');
  }

  function startGame() {
    // A Start over a run still going (matchmaking clicks Start itself) ends
    // that run and its frame loop first, so two loops never drain one bar.
    if (run && gameStarted && (running || paused)) { run.ev('E', 'x'); run.close(); }
    cancelAnimationFrame(animFrame);
    run = QR.Run.start('axe' + (window._qteCompMode ? '-comp' : ''));
    if (gapTimer) { clearTimeout(gapTimer); gapTimer = null; }
    streak = 0; running = gameStarted = true; paused = false; fillPct = 0; gapPaused = false;
    resizeCanvas(); canvas.style.display = ''; lastTime = performance.now();
    streakEl.textContent = '';
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    startRound('s');
    animFrame = requestAnimationFrame(gameLoop);
  }

  function resumeGame() {
    if (!paused) return;
    if (run) run.ev('U');   // before the clock is read (see startRound)
    paused = false; running = true; lastTime = performance.now();
    // Restore the exact time remaining from before the pause
    roundEndTime = performance.now() + pauseTimeRemaining;
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus(IS_MOBILE ? 'Tap to fill — land in the zone when time runs out!' : 'Press SPACE to fill — land in the zone when time runs out!', '#aaaaff');
    // Paused between rounds: the rest of the wait runs, then the next round.
    // (Resume used to judge the finished round a second time - a free point
    // per pause.)
    if (gapPaused) { gapPaused = false; armGap(gapLeft); }
    else animFrame = requestAnimationFrame(gameLoop);
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    if (!document.getElementById('page-qte')?.classList.contains('active') && !(window._qteMatch && window._qteMatch.active)) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SUMMARY' || tag === 'BUTTON' || document.activeElement?.isContentEditable) return;
    const panel = document.getElementById('qte-panel-axe');
    if (!panel || panel.style.display === 'none') return;
    e.preventDefault();
    onSpacePress('k');
  });
  if (IS_MOBILE) {
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onSpacePress('t'); }, { passive: false });

    // Dedicated TAP button — synced to canvas visibility via MutationObserver
    const axeTapBtn = document.createElement('button');
    axeTapBtn.className = 'qte-mobile-action-btn';
    axeTapBtn.textContent = 'TAP';
    axeTapBtn.style.display = 'none';
    axeTapBtn.addEventListener('touchstart', e => { e.preventDefault(); onSpacePress('b'); }, { passive: false });
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
      // Between rounds: hold the rest of the wait until Resume (the gap timer
      // would otherwise start a second frame loop if Resume came within 700 ms).
      if (!live) {
        gapPaused = true; gapLeft = Math.max(0, gapEndAt - performance.now());
        if (gapTimer) { clearTimeout(gapTimer); gapTimer = null; }
      }
      if (run) run.ev('P');
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
// Each run writes a log for the server's check (js/qte-rules.js, 'staff'):
//   ['R', t, cause, streak, pattern, bank, leftMs]  a round is drawn
//        (cause 0 Start, 1 after a win, 2 restart after a timeout, 3 Resume)
//   ['L', t, tile, from, dx, dy]      a tile picked up (from -1 = bank, or a slot)
//   ['D', t, tile, slot, ok, dx, dy]  the held tile let go, as judged
//   ['P', t] / ['U', t]               paused mid-round / Resume pressed
//   ['X', t]                          local scores reset (streak -> 0)
//   ['E', t, 'time'|'hide'|'restart'] the attempt ended
// Every restart after a timeout is a new attempt (run.newAttempt()), or, once
// the run is an hour old, a fresh run (QteRules.Run.start, cause 0).
(function () {
  var RUNE_MAP = { A:'ᚨ', B:'ᛒ', E:'ᛖ', F:'ᚠ', H:'ᚺ', N:'ᚾ', R:'ᚱ', U:'ᚢ', W:'ᚹ', X:'ᛉ' };
  // Runes, lengths, timers and gaps live in the rules file so the check and
  // the game can never disagree.
  var RULES = QteRules.trainers['staff'];
  var KEYS = RULES.KEYS;

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

  // The run log (QteRules.Run) of the current Start, the mode it started in,
  // and a generation that invalidates a pending next-round callback when the
  // run is ended or restarted under it.
  var run = null, runComp = false, gen = 0;
  function ev() { if (run && !run.closed) run.ev.apply(run, arguments); }
  function endRun(why) { if (run && !run.closed) { run.ev('E', why); run.close(); } }
  function r2(v) { return Math.round(v * 100) / 100; }
  var RUN_RENEW_MS = 3600000;     // see the restart after a timeout
  // A new best is sent with the attempt's log so far. Past MAX_T (a round
  // paused overnight, then resumed) the log cannot be checked, so it is not sent.
  function submit(score) { if (run && run.now() <= QteRules.LIMITS.MAX_T) run.submit(score); }

  window.addEventListener('alb-scores-reset', function() {
    streak = 0; highscore = 0; highscoreComp = 0;
    ev('X');
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

  function getPatternLen() { return RULES.patternLen(streak, runComp); }
  function getTimerDur()   { return RULES.timerDur(streak, runComp); }

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

  // cause: 0 Start, 1 after a win, 2 restart after a timeout, 3 Resume.
  // keepLeft (Resume only): seconds left on the timer, kept over the pause.
  function newRound(cause, keepLeft) {
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
    timeLeft = keepLeft === undefined ? getTimerDur() : keepLeft;
    // Logged BEFORE the timer is read, so the logged round start is never
    // later than the real one (a coarse clock can tick between two reads; the
    // other order would put the check's deadline after the game's and make an
    // honest timeout look early).
    ev('R', cause, streak, pattern.join(''), shuffled.join(''), Math.round(timeLeft * 1000));
    timerStart = performance.now() - (getTimerDur() - timeLeft) * 1000;
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
    ev('E', 'time');
    setStatus(msg || 'Failed!', '#e05555');
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.fail(); return; }
    var g = gen;
    setTimeout(function () {
      if (g !== gen) return;      // the run was ended or restarted meanwhile
      streak = 0; updateHUD();
      // The trainer restarts itself forever (even on another page of the
      // site), but a log's clock must stay under QteRules.LIMITS.MAX_T and the
      // server drops runs that go an hour without a submit. So after an hour
      // the next attempt opens a fresh run instead (invisible to the player).
      var fresh = null;
      if (run && run.now() > RUN_RENEW_MS) { try { fresh = QteRules.Run.start(run.type); } catch (e) {} }
      if (fresh) {
        run.close();
        run = fresh;
        newRound(0);
      } else {
        if (run) run.newAttempt();
        newRound(2);
      }
      running = true;
      animFrame = requestAnimationFrame(staffGameLoop);
    }, RULES.GAP_FAIL);
  }

  function triggerSuccess() {
    running = false; drag = null;
    streak++;
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.report(streak); } else if (window._qteCompMode) {
      if (streak > highscoreComp) {
        highscoreComp = streak;
        try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {}
        submit(streak);
      }
    } else {
      if (streak > highscore) {
        highscore = streak;
        try { localStorage.setItem(HS_KEY, highscore); } catch(e) {}
        submit(streak);
      }
    }
    updateHUD();
    setStatus('Complete!', '#55e09a');
    drawFrame(); // render all slots green before the loop stops
    var g = gen;
    setTimeout(function () {
      if (g !== gen) return;      // the run was ended or restarted meanwhile
      newRound(1);
      running = true;
      animFrame = requestAnimationFrame(staffGameLoop);
    }, RULES.GAP_WIN);
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

  // Where p lands on the tile/slot at (x, y), in tile sizes from its centre.
  function offX(p, x) { return r2((p.x - x - TW / 2) / TW); }
  function offY(p, y) { return r2((p.y - y - TH / 2) / TH); }

  // Pick-up, shared by mousedown and touchstart.
  function pickUp(e) {
    var p = canvasPos(e);
    // pick up from bank
    for (var i = 0; i < bankTiles.length; i++) {
      var t = bankTiles[i];
      if (t.inBank && hitTest(p.x, p.y, t.x, t.y)) {
        t.inBank = false;
        drag = { tile: t, curX: p.x, curY: p.y };
        ev('L', t.id, -1, offX(p, t.x), offY(p, t.y));
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
        ev('L', tile.id, j, offX(p, s.x), offY(p, s.y));
        return;
      }
    }
  }

  canvas.addEventListener('mousedown', function (e) {
    if (!running || !gameStarted) return;
    pickUp(e);
  });

  canvas.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var p = canvasPos(e);
    drag.curX = p.x; drag.curY = p.y;
  });

  function dropDrag(e) {
    if (!drag) return;
    // The timer ran out and no frame has noticed yet (the browser tab was
    // hidden, or a frame is late): the round is over, not cleared.
    if (running && (performance.now() - timerStart) / 1000 >= getTimerDur()) {
      cancelAnimationFrame(animFrame); triggerFail("Time's up!"); return;
    }
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
          // Logged once the tile is really in the slot (if the sound threw,
          // the tile is lost for the round, and the log says so by omission).
          ev('D', tile.id, j, 1, offX(p, s.x), offY(p, s.y));
          if (checkWin()) { cancelAnimationFrame(animFrame); drawFrame(); triggerSuccess(); }
        } else {
          ev('D', tile.id, j, 0, offX(p, s.x), offY(p, s.y));
          returnToBank(tile); // wrong rune → back to bank
        }
        return;
      }
    }
    // dropped on nothing
    ev('D', tile.id, -1, 0);
    returnToBank(tile);
  }

  canvas.addEventListener('mouseup',    dropDrag);
  canvas.addEventListener('mouseleave', function (e) {
    if (drag) { ev('D', drag.tile.id, -1, 0); returnToBank(drag.tile); drag = null; }
  });

  // Touch equivalents for drag-and-drop on mobile
  if (IS_MOBILE) {
    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (!running || !gameStarted) return;
      pickUp(e);
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
    endRun('restart');
    gen++;
    cancelAnimationFrame(animFrame);
    runComp = !!window._qteCompMode;
    run = QteRules.Run.start('staff' + (runComp ? '-comp' : ''));
    streak = 0; updateHUD(); newRound(0);
    gameStarted = true; paused = false; running = true;
    canvas.style.display = '';
    startBtn.style.display  = 'none';
    resumeBtn.style.display = 'none';
    setStatus('', '#a08fd0');
    animFrame = requestAnimationFrame(staffGameLoop);
  }

  function resumeGame() {
    var savedTime = timeLeft;
    ev('U');
    newRound(3, savedTime);       // re-randomize runes, but keep the time that was left
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
      ev('P');                    // before the clock read: the kept time is never more than the log allows
      timeLeft = Math.max(0, getTimerDur() - (performance.now() - timerStart) / 1000);
      // A tile held when the panel hides goes home: it cannot be dropped
      // into a paused round.
      if (drag) { returnToBank(drag.tile); drag = null; }
    } else {
      streak = 0; gameStarted = false;
      gen++;                      // no next round for a run that has ended
      endRun('hide');
    }
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
// The difficulty curves and the canvas layout live in js/qte-rules.js
// (QteRules.trainers.thorian) so the server's check judges with the same numbers.
// The run's log (QteRules.Run): 'G' each round (rounds won, canvas size), 'H' each
// heart as it is made (side, offset draw, round game time, frame step), 'B'/'X'/'O'
// each heart blocked / reaching Thorian / leaving the screen, 'K' each bar turn,
// 'W' each round won, 'P'/'U' pause/resume, 'Z' a resize mid-run, 'E' the end.
(function () {
  const canvas    = document.getElementById('thorian-qte-canvas');
  if (!canvas) return;
  const R         = window.QteRules && QteRules.trainers['thorian'];
  if (!R) { console.error('thorian trainer: js/qte-rules.js is not loaded'); return; }
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

  // ---- Run log ----
  let run           = null;   // QteRules.Run of the current Start
  let runComp       = false;  // mode at Start: the curves and the log's type agree all run
  let roundG        = 0;      // this round's game time, ms (sum of the clamped frame steps)
  let heartId       = 0;      // hearts made this round, in order (the log's heart ids)
  let curSz         = 0;      // canvas size the layout was last made for
  let betweenRounds = false;  // a round was won and the next has not begun
  let gapDue        = false;  // the 1.6 s gap ran out while paused
  // Log times to 0.1 ms and the offset draw in hundredths: enough for the check,
  // and the log stays small.
  function r1(n) { return Math.round(n * 10) / 10; }
  function logEv() { if (run) run.ev.apply(run, arguments); }

  // ---- Strip scheduler ----
  let stripHeartLeft    = 0;
  let stripHeartTimer   = 0;   // ms until next heart in strip
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

  const MAX_LIVES = R.MAX_LIVES;
  function stepBar(dir) {
    if (dir !== barDir) logEv('K', R.DIR_IX[dir], r1(roundG));
    barDir = dir;
  }

  // ---- Difficulty ----
  // Round timer starts short and grows a little each round
  function getRoundSecs()     { return R.roundSecs(streak); }
  function getSpeed()         { return R.speed(streak, runComp); }
  function getStripLen()      { return R.stripLen(streak, runComp); }
  function getHeartInterval() { return R.interval(streak, runComp); }
  function getGapDelay()      { return R.gapDelay(streak, runComp); }
  function getActiveSides()   { return R.SIDES; }

  // ---- Highscore ----
  function updateHighscore(val) {
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.report(val); return; }
    if (window._qteCompMode) {
      if (val > highscoreComp) {
        highscoreComp = val;
        try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch (e) {}
        if (run) run.submit(val);
      }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? 'Best: ' + highscoreComp : '';
    } else {
      if (val > highscore) {
        highscore = val;
        try { localStorage.setItem(HS_KEY, highscore); } catch (e) {}
        if (run) run.submit(val);
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
    const G      = R.geom(sz);
    CX = CY      = G.C;
    BAR_OFF      = G.off;
    BAR_LEN      = G.len;
    BAR_THICK    = G.th;
    THORIAN_R    = G.tr;
    THORIAN_SZ   = G.tsz;
    PROJ_R       = G.pr;
    PROJ_SZ      = G.psz;
    if (sz !== curSz) logEv('Z', sz);   // mid-run (panel shown again); no run, no log
    curSz        = sz;
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
  // dtMs: the step of the frame it is made in (it moves by that step this frame).
  function spawnHeart(side, dtMs) {
    const speed   = getSpeed();
    const spread  = BAR_LEN * R.SPREAD;  // lateral spread within bar coverage
    const W = canvas.width, H = canvas.height;
    const u = Math.random();
    let x, y;
    if (side === 'top') {
      x = CX + (u - 0.5) * spread * 2;
      y = -PROJ_R;
    } else if (side === 'left') {
      x = -PROJ_R;
      y = CY + (u - 0.5) * spread * 2;
    } else {
      x = W + PROJ_R;
      y = CY + (u - 0.5) * spread * 2;
    }
    // Velocity directed toward center
    const dx = CX - x, dy = CY - y, dist = Math.sqrt(dx * dx + dy * dy);
    hearts.push({ x, y, vx: dx / dist * speed, vy: dy / dist * speed, dying: 0, id: heartId++ });
    logEv('H', R.SIDE_IX[side], Math.floor(u * 100), r1(roundG), r1(dtMs));
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
    roundG    += dtMs;

    // Strip scheduler
    if (stripHeartLeft > 0) {
      stripHeartTimer -= dtMs;
      if (stripHeartTimer <= 0) {
        const sides = getActiveSides();
        spawnHeart(sides[Math.floor(Math.random() * sides.length)], dtMs);
        stripHeartLeft--;
        stripHeartTimer = getHeartInterval();
      }
    } else {
      betweenStripTimer -= dtMs;
      if (betweenStripTimer <= 0) {
        stripHeartLeft    = getStripLen();
        stripHeartTimer   = 0;
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
      if (h.x < -40 || h.x > W + 40 || h.y < -40 || h.y > H + 40) { logEv('O', h.id, r1(roundG)); return false; }

      // Hit bar → block
      if (overlapsBar(h)) {
        h.dying = 1.0;
        logEv('B', h.id, r1(roundG));
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
        logEv('X', h.id, r1(roundG));
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
    logEv('W', r1(roundG));
    streak++;
    betweenRounds = true; gapDue = false;
    updateHighscore(streak);
    hearts = []; particles = []; lives = MAX_LIVES;
    if (streakEl) streakEl.textContent = 'Rounds: ' + streak;
    setStatus('Round ' + streak + ' survived!', '#88ffaa');
    drawFrame();
    // (a restart inside the gap already began a round: this timer is then stale)
    setTimeout(() => { if (!betweenRounds) return; if (running) beginRound(); else if (paused) gapDue = true; }, R.NEXT_ROUND_MS);
  }

  function endRun(reason) {
    if (!run) return;
    run.ev('E', reason);
    run.close();
    run = null;
  }

  function onGameOver() {
    cancelAnimationFrame(animFrame);
    running = false; hearts = []; particles = [];
    endRun('dead');
    if (window._qteMatch && window._qteMatch.active) window._qteMatch.fail();
    setStatus('Thorian fell! ' + streak + ' round' + (streak !== 1 ? 's' : '') + ' survived', '#ee5555');
    drawFrame();
    setTimeout(() => {
      if (run) return;   // a new run was started in the meantime: leave it alone
      gameStarted = false;
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
    }, 1900);
  }

  function beginRound() {
    hearts = []; particles = [];
    roundTime         = getRoundSecs();
    stripHeartLeft    = 0;
    betweenStripTimer = R.FIRST_GAP_MS;
    running           = true;
    betweenRounds     = false; gapDue = false;
    roundG            = 0; heartId = 0;
    logEv('G', streak, curSz);
    setStatus('Block the hearts!', '#cc88ff');
    cancelAnimationFrame(animFrame);   // Start pressed with a loop still queued: one loop only
    animFrame = requestAnimationFrame(ts => { lastTime = ts; gameLoop(ts); });
  }

  function startGame() {
    endRun('restart');
    resizeCanvas();   // before the new run: its first round logs the size, not a resize
    runComp = !!window._qteCompMode;
    run = QteRules.Run.start('thorian' + (runComp ? '-comp' : ''));
    streak = 0; lives = MAX_LIVES; thorianFlash = 0;
    paused = false; gameStarted = true; barDir = 'right';
    betweenRounds = false; gapDue = false;
    hearts = []; particles = [];
    if (startBtn)  startBtn.style.display  = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (streakEl)  streakEl.textContent = '';
    setStatus('Block the hearts!', '#cc88ff');
    beginRound();
  }

  function resetToStart() {
    cancelAnimationFrame(animFrame);
    running = false; gameStarted = false; paused = false;
    betweenRounds = false; gapDue = false;
    endRun('reset');
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
    if (!document.getElementById('page-qte')?.classList.contains('active') && !(window._qteMatch && window._qteMatch.active)) return;
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
    logEv('U');
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus('Block the hearts!', '#cc88ff');
    // Paused between rounds: the next round begins when the 1.6 s gap is over
    // (at once if it ran out while paused). Resuming the finished round's loop
    // here used to score that round a second time.
    if (betweenRounds) { if (gapDue) beginRound(); return; }
    betweenStripTimer = R.RESUME_GAP_MS;
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
      logEv('P', r1(roundG));
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

  // The rules (radii, caps, timers, orb speed, the draws, canvas size) live in
  // js/qte-rules.js, shared with the score check.
  const R = QteRules.trainers['thorian-new'];

  // Canvas size
  let W = 0, H = 0;

  // Background shards (dark upward-floating eye shapes)
  const SHARD_COUNT = 30;
  let shards = [];

  // Targets
  const TARGET_R    = R.TARGET_R;
  const PLAYER_R    = R.PLAYER_R;
  const MAX_TARGETS  = R.MAX_TARGETS;
  const GAME_SECS    = R.GAME_SECS;

  const MAX_YELLOWS = R.MAX_YELLOWS;
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

  // Score log (QteRules.Run). The game runs on its own clock: gameT is the sum
  // of clamped frame dts (frozen while paused), lastDt the last frame's dt.
  // Orbs/diamonds carry run-wide spawn indexes (k / j) that the log refers to.
  let run = null, runComp = false, logBytes = 0;
  let gameT = 0, lastDt = 0, orbN = 0, yelN = 0;
  function gMs() { return R.ms(gameT); }
  function dMs() { return R.ms(lastDt); }
  function ev() {
    if (!run || run.closed || logBytes > R.LOG_BUDGET) return;
    // A log may not run past QteRules.LIMITS.MAX_T: close the run first (no
    // more events or submits; the rounds already submitted stay proven).
    if (run.now() > QteRules.LIMITS.MAX_T - R.LOG_T_MARGIN) { run.close(); return; }
    const L = run.log.ev, n = L.length;
    run.ev.apply(run, arguments);
    if (L.length > n) logBytes += JSON.stringify(L[n]).length + 1;
  }
  // A diamond position for the log; null if the game's value went NaN.
  function lp(v) { return isFinite(v) ? R.px(v) : null; }
  // Submit only from an open run: after the run's end (a red drop while
  // paused leaves the game resumable) its log cannot prove later rounds.
  function submit(val) { if (run && !run.closed) run.submit(val); }

  function setStatus(t, c) { if (statusEl) { statusEl.textContent = t; statusEl.style.color = c || '#888'; } }
  function updateHs(val) {
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.report(val); return; }
    if (window._qteCompMode) {
      if (val > highscoreComp) {
        highscoreComp = val;
        try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {}
        submit(val);
      }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? 'Best: ' + highscoreComp : '';
    } else {
      if (val > highscore) {
        highscore = val;
        try { localStorage.setItem(HS_KEY, highscore); } catch(e) {}
        submit(val);
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
    const pw = W, ph = H;
    W = Math.min(wrap.clientWidth, 900);
    H = R.canvasH(W);
    canvas.width        = W;
    canvas.height       = H;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    initShards();
    if (W !== pw || H !== ph) ev('Z', W, H); // only while a run is logging
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
  function getColumnX(col) { return R.colX(W, col); }

  // Draw order is unchanged (column, type, speed; the gap is drawn by the loop).
  function spawnTarget() {
    const usedCols = new Set(targets.map(t => t.col));
    const freeCols = [0,1,2,3,4].filter(c => !usedCols.has(c));
    if (freeCols.length === 0) return null;
    const col  = freeCols[Math.floor(Math.random() * freeCols.length)];
    const x    = getColumnX(col);
    const type = R.isPurple(Math.random()) ? 'purple' : 'red';
    const mul  = R.orbMul(Math.random()); // slight per-orb variation
    const spd  = getOrbSpeed() * mul;
    const t = { x, y: R.spawnY(H), col, type, vy: -spd, mul, k: orbN++ };
    targets.push(t);
    return t;
  }

  function spawnYellow() {
    const usedCols = new Set(yellows.map(y => y.col));
    const freeCols = [0,1,2,3,4].filter(c => !usedCols.has(c));
    if (freeCols.length === 0) return null;
    const col = freeCols[Math.floor(Math.random() * freeCols.length)];
    const x   = getColumnX(col);
    const y   = R.yelY(H, Math.random());
    const yl  = { x, y, col, life: R.yelLife(Math.random()), j: yelN++ };
    yl.life0 = yl.life;
    yellows.push(yl);
    return yl;
  }

  function dist2(ax, ay, bx, by) { return (ax - bx) ** 2 + (ay - by) ** 2; }

  // Orb speed scales with round (px/s) — comp mode scales faster (mode is fixed at Start)
  function getOrbSpeed() {
    return R.orbSpeed(round, runComp);
  }

  // ---- Collision ----
  // (Not called: releaseDrag is what judges a drop.)
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
            onGameOver('D');
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
    // Never negative (the game clock only moves forward).
    const dt = Math.min(Math.max(0, now - lastTime) / 1000, R.DT_MAX);
    if (now > lastTime) lastTime = now;
    gameT += dt; lastDt = dt;

    updateShards(dt);

    // Between-round countdown
    if (transitioning) {
      transitionTimer -= dt;
      if (transitionTimer <= 0) {
        transitioning = false;
        gameTimer = GAME_SECS;
        lives = R.LIVES;
        targets = []; yellows = []; heldYellow = null;
        spawnTimer = 0; yellowSpawnTimer = 0;
        ev('R', gMs(), dMs(), round);
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
      const t = spawnTarget();
      spawnTimer = R.orbGap(Math.random());
      if (t) ev('O', gMs(), dMs(), t.col, t.type === 'purple' ? 1 : 0, t.mul, spawnTimer);
    }

    // Spawn yellows
    yellowSpawnTimer -= dt;
    if (yellowSpawnTimer <= 0 && yellows.length < MAX_YELLOWS) {
      const y = spawnYellow();
      yellowSpawnTimer = R.yelGap(Math.random());
      if (y) ev('Y', gMs(), dMs(), y.col, y.y, y.life0, yellowSpawnTimer);
    }

    // Move orbs upward and remove when off-screen
    targets = targets.filter(t => {
      t.y += t.vy * dt;
      if (t.y < R.ESC_Y) {
        ev('X', gMs(), t.k);
        if (t.type === 'purple') {
          lives--;
          flashTimer = 0.55;
          if (lives <= 0) { onGameOver('X'); return false; }
        }
        return false;
      }
      return true;
    });

    // Age out yellows — held yellow is immune
    yellows = yellows.filter(y => {
      if (y === heldYellow) return true;
      y.life -= dt;
      if (y.life > 0) return true;
      ev('V', gMs(), y.j);
      return false;
    });

    drawFrame();
    animFrame = requestAnimationFrame(gameLoop);
  }

  function onRoundComplete() {
    score++;
    round++;
    transitioning = true;
    transitionTimer = R.TRANSITION_S;
    ev('C', gMs(), dMs(), score);
    updateHs(score);
    if (streakEl) streakEl.textContent = 'Rounds: ' + score;
    animFrame = requestAnimationFrame(gameLoop);
  }

  // why: 'X' the second purple of the round escaped, 'D' dropped on a red orb
  function onGameOver(why) {
    cancelAnimationFrame(animFrame);
    running = false;
    ev('E', why, gMs());
    if (window._qteMatch && window._qteMatch.active) window._qteMatch.fail();
    transitioning = false;
    updateHs(score);
    if (run) run.close();
    setStatus('Game over!  Rounds: ' + score, '#ee5544');
    if (streakEl) streakEl.textContent = '';
    setTimeout(() => {
      gameStarted = false;
      if (startBtn)  startBtn.style.display  = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
    }, 2200);
  }

  function startGame() {
    runComp = !!window._qteCompMode;
    run = QteRules.Run.start('thorian-new' + (runComp ? '-comp' : ''));
    logBytes = 0; gameT = 0; lastDt = 0; orbN = 0; yelN = 0;
    score = 0; round = 1; lives = R.LIVES; gameTimer = GAME_SECS;
    targets = []; yellows = []; heldYellow = null;
    spawnTimer = 0; yellowSpawnTimer = 0; flashTimer = 0;
    transitioning = false; transitionTimer = 0;
    paused = false; gameStarted = true;
    ev('Z', W, H);
    ev('R', gMs(), dMs(), round);
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
    const grab2 = R.GRAB_R2;
    for (const y of yellows) {
      if (dist2(pos.x, pos.y, y.x, y.y) < grab2) {
        heldYellow = y;
        dragOX = pos.x - y.x;
        dragOY = pos.y - y.y;
        ev('G', gMs(), y.j, R.px(pos.x), R.px(pos.y));
        return;
      }
    }
  }

  function moveDrag(pos) {
    if (!heldYellow) return;
    heldYellow.x = Math.max(PLAYER_R, Math.min(W - PLAYER_R, pos.x - dragOX));
    heldYellow.y = Math.max(PLAYER_R, Math.min(H - PLAYER_R, pos.y - dragOY));
  }

  // Judged on the diamond's position (not the pointer's): the first orb in
  // reach, in spawn order. Logged as it is judged, before anything changes.
  function releaseDrag(pos) {
    if (!heldYellow) return;
    const threshold = R.DROP_R2;
    const hx = lp(heldYellow.x), hy = lp(heldYellow.y);
    let hit = false;
    targets = targets.filter(t => {
      if (hit) return true;
      if (dist2(heldYellow.x, heldYellow.y, t.x, t.y) < threshold) {
        hit = true;
        ev('L', gMs(), hx, hy, t.k);
        if (t.type === 'red') {
          yellows = yellows.filter(y => y !== heldYellow);
          heldYellow = null;
          onGameOver('D');
          return false;
        }
        // purple: both disappear
        yellows = yellows.filter(y => y !== heldYellow);
        heldYellow = null;
        return false;
      }
      return true;
    });
    if (heldYellow) { ev('L', gMs(), hx, hy, -1); heldYellow = null; } // released over nothing
  }

  function getTouchReleasePos(e) {
    const t = e.changedTouches?.[0] || e;
    return getCanvasPosRaw(t.clientX, t.clientY);
  }

  canvas.addEventListener('mousedown',  e => tryStartDrag(getCanvasPos(e)));
  canvas.addEventListener('mousemove',  e => moveDrag(getCanvasPos(e)));
  canvas.addEventListener('mouseup',    e => releaseDrag(getCanvasPos(e)));
  canvas.addEventListener('mouseleave', () => {
    if (heldYellow) ev('D', gMs(), lp(heldYellow.x), lp(heldYellow.y));
    heldYellow = null;
  });

  canvas.addEventListener('touchstart', e => { e.preventDefault(); tryStartDrag(getCanvasPos(e)); }, { passive: false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); moveDrag(getCanvasPos(e)); }, { passive: false });
  canvas.addEventListener('touchend',   e => { e.preventDefault(); releaseDrag(getTouchReleasePos(e)); }, { passive: false });

  if (startBtn)  startBtn.addEventListener('click', startGame);
  if (resumeBtn) resumeBtn.addEventListener('click', () => {
    if (!paused) return;
    paused = false; running = true;
    ev('U', gMs());
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
      ev('P', gMs());
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

  // The rules (zone width, speed, bar count, lives, timer, press limit, phase
  // draw) live in js/qte-rules.js, shared with the score check. That file must
  // load before this one; if it did not, stop HERE rather than throw - a throw
  // at load would also kill every trainer after this one in qte.js.
  const R = window.QteRules && window.QteRules.trainers && window.QteRules.trainers['dagger-new'];
  if (!R) { try { console.error('[dagger-new] js/qte-rules.js with the dagger-new rules must load before js/qte.js'); } catch (e) {} return; }

  // Canvas: 0 rad = right (3 o'clock), π/2 = bottom, 3π/2 = top (12 o'clock)
  const NEEDLE_ANGLE = R.NEEDLE; // fixed marker at 12 o'clock
  // Bar half-width: based on level count (fixed for the level, doesn't change as bars are removed)
  function getZoneHalf() { return R.zoneHalf(level); }

  const LIVES_MAX        = R.LIVES_MAX;
  const MIN_PRESS_MS     = R.MIN_PRESS_MS;   // fastest plausible human reaction
  const MACRO_MIN_HITS   = 12;    // need at least this many hits before checking
  const MACRO_AVG_DEG    = 2.5;   // avg hit offset below this = suspiciously perfect
  const MACRO_STD_DEG    = 1.8;   // std-dev below this = suspiciously consistent

  let running = false, gameStarted = false, paused = false;
  let score = 0, timeLeft = R.TIMER_MAX, timerMax = R.TIMER_MAX;
  let level = 1, hitsThisLevel = 0;
  let lives = LIVES_MAX, maxLives = LIVES_MAX;
  let bars = [];        // { k, base, angle, speed }
  let flashMiss = 0, flashLevel = 0;
  let animFrame = null, lastTime = 0;

  // Score log (QteRules.Run). The game runs on its own clock: gameT is the sum
  // of clamped frame dts (frozen while paused); bars move linearly in it and a
  // press is judged on the last frame, so gameT is what the log records.
  let run = null, runComp = false;
  let gameT = 0, spawnT = 0;          // seconds
  function gMs() { return gameT * 1000; }

  // Anti-macro tracking
  let lastPressMs  = 0;
  let hitOffsets   = [];   // angular distance from needle center at moment of hit (radians)
  let hitIntervals = [];   // ms between consecutive presses

  function isSuspectedMacro() {
    if (hitOffsets.length < MACRO_MIN_HITS) return false;
    const sample = hitOffsets.slice(-20);
    const avg    = sample.reduce((a, b) => a + b, 0) / sample.length;
    const stdDev = Math.sqrt(sample.reduce((a, b) => a + (b - avg) ** 2, 0) / sample.length);
    const avgDeg = avg    * 180 / Math.PI;
    const stdDeg = stdDev * 180 / Math.PI;
    // Also check interval consistency
    if (hitIntervals.length >= MACRO_MIN_HITS) {
      const ivSample = hitIntervals.slice(-20);
      const ivAvg    = ivSample.reduce((a, b) => a + b, 0) / ivSample.length;
      const ivStd    = Math.sqrt(ivSample.reduce((a, b) => a + (b - ivAvg) ** 2, 0) / ivSample.length);
      if (ivStd < 15 && avgDeg < 5) return true; // robotic timing + good accuracy
    }
    return avgDeg < MACRO_AVG_DEG && stdDeg < MACRO_STD_DEG;
  }

  function updateHs(val, fromGameOver) {
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.report(val); return; }
    const blocked = fromGameOver && isSuspectedMacro();
    if (window._qteCompMode) {
      if (!blocked && val > highscoreComp) { highscoreComp = val; try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch(e) {} if (run) run.submit(val); }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? 'Best: ' + highscoreComp : '';
    } else {
      if (val > highscore) { highscore = val; try { localStorage.setItem(HS_KEY, highscore); } catch(e) {} if (run) run.submit(val); }
      if (hsEl) hsEl.textContent = highscore > 0 ? 'Best: ' + highscore : '';
    }
  }
  updateHs(0);
  window.addEventListener('alb-scores-reset', () => { highscore = 0; highscoreComp = 0; localStorage.removeItem(HS_KEY); localStorage.removeItem(HS_KEY_COMP); updateHs(0); });
  window.addEventListener('alb-mode-changed', () => updateHs(0));

  function setStatus(text, color) { if (statusEl) { statusEl.textContent = text; statusEl.style.color = color || '#888'; } }

  // Mode is fixed for the run at Start (switching mid-run is blocked anyway).
  function getBaseSpeed()     { return R.speed(level, runComp); }
  function getSpawnInterval() { return Math.max(window._qteCompMode ? 0.8 : 1.0, (window._qteCompMode ? 2.5 : 3.2) - level * 0.15); }
  function getMaxBars()       { return R.bars(level); }
  function hitsNeeded()       { return R.hitsNeeded(level); }

  const normalise = R.normalise;
  const angDist   = R.angDist;
  function barInZone(bar)    { return angDist(bar.angle, NEEDLE_ANGLE) <= getZoneHalf(); }

  function spawnAllBars() {
    const count     = getMaxBars();
    const spd       = getBaseSpeed();
    // Place nearest bar randomly within the gap, never on the marker
    // (phase in [1.3 zh, slot - 1.3 zh], rounded to 4 dp so the log holds the exact value)
    const phase     = R.drawPhase(level, Math.random());
    spawnT = gameT;
    bars = [];
    for (let i = 0; i < count; i++) {
      const base = R.barBase(level, phase, i);
      bars.push({ k: i, base: base, angle: base, speed: spd });
    }
    if (run) run.ev('L', level, phase, gMs());
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
    // Never negative: the first frame's stamp can be a little before the
    // performance.now() taken at Start/Resume (the bars used to step back).
    const dt = Math.min(Math.max(0, now - lastTime) / 1000, R.DT_MAX);
    if (now > lastTime) lastTime = now;
    gameT += dt;

    // Countdown timer
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; drawFrame(false); onGameOver('T'); return; }

    // Advance bars (from their spawn position, on the game clock)
    for (const bar of bars) {
      bar.angle = R.barAngle(bar.base, bar.speed, gameT - spawnT);
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
    // Rate-limit: reject inputs faster than a human can react
    const now = performance.now();
    if (now - lastPressMs < MIN_PRESS_MS) return;
    const interval = lastPressMs > 0 ? now - lastPressMs : null;
    lastPressMs = now;
    // Find first bar currently in the zone and remove it
    const idx = bars.findIndex(b => barInZone(b));
    if (run) run.ev('K', gMs(), idx === -1 ? -1 : bars[idx].k);
    if (idx === -1) { triggerMiss(); return; } // hit the gap
    // Record precision of this hit
    const offset = angDist(bars[idx].angle, NEEDLE_ANGLE);
    hitOffsets.push(offset);
    if (interval !== null) hitIntervals.push(interval);
    bars.splice(idx, 1);
    score++;
    hitsThisLevel++;
    timeLeft = Math.min(timeLeft + R.HIT_BONUS, R.TIMER_MAX);
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
    timeLeft = Math.max(0, timeLeft - R.MISS_COST);
    if (lives <= 0 || timeLeft <= 0) onGameOver('M');
  }

  // why: 'T' the timer ran out in a frame, 'M' the miss just logged ended it
  function onGameOver(why) {
    cancelAnimationFrame(animFrame); running = false;
    if (run) run.ev('E', why, gMs());
    if (window._qteMatch && window._qteMatch.active) window._qteMatch.fail();
    updateHs(score, true); setStatus('Game over! Hits: ' + score, '#ee5544');
    if (run) run.close();
    if (startBtn)  startBtn.style.display  = '';
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (tapBtn)    tapBtn.style.display    = 'none';
  }

  function startGame() {
    // One loop per run: a Start while a loop is live (matchmaking clicks Start
    // itself) would add every frame's dt to the game clock twice.
    cancelAnimationFrame(animFrame);
    runComp = !!window._qteCompMode;
    run = QteRules.Run.start('dagger-new' + (runComp ? '-comp' : ''));
    resizeCanvas();
    timerMax = R.TIMER_MAX;
    maxLives = runComp ? R.LIVES_COMP : LIVES_MAX;
    score = 0; level = 1; hitsThisLevel = 0; lives = maxLives;
    timeLeft = timerMax; flashMiss = 0; flashLevel = 0;
    lastPressMs = 0; hitOffsets = []; hitIntervals = [];
    gameT = 0; spawnT = 0;
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
    if (!document.getElementById('page-qte')?.classList.contains('active') && !(window._qteMatch && window._qteMatch.active)) return;
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
    if (run) run.ev('U');
    if (resumeBtn) resumeBtn.style.display = 'none';
    setStatus(IS_MOBILE ? 'Tap the bar at the marker!' : 'Space when bar hits the marker!', '#aa88ff');
    lastTime = performance.now(); animFrame = requestAnimationFrame(gameLoop);
  });

  window._onDaggerNewQteShow = () => { resizeCanvas(); if (!running) drawFrame(!gameStarted); };
  window._onDaggerNewQteHide = () => {
    if (paused) return;
    if (gameStarted && running) {
      cancelAnimationFrame(animFrame); running = false; paused = true;
      if (run) run.ev('P', gMs());
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

// === YARTHUL NEW QTE ===
// Blue flame on a rock platform beneath Yar'Thul's eye. Meteors fall in a constant
// stream; A/D slides the flame left and right. One hit ends the run.
// Stage n lasts min(5 + (n-1), 20) seconds. Stages are infinite.
// Geometry, stage lengths and the spawn/fall/drift curves live in js/qte-rules.js
// (QteRules.trainers['yarthul-new']) so the server's check judges with the same numbers.
// The run's log (QteRules.Run): 'S' at Start, 'M' each meteor made (its two draws and
// where in its frame it spawned), 'D' each change of the keys' direction as a frame
// applies it, 'C'/'B' each stage cleared/begun, 'Z' a resize mid-run, 'P'/'U' the tab
// hidden/shown, 'E' the end, 'X' the log full (a very long run plays on unlogged).
// Game times are the run's own clock (sum of frame dt).
(function () {
  const canvas = document.getElementById('yarthul-new-qte-canvas');
  if (!canvas) return;
  const R = QteRules.trainers['yarthul-new'];
  const ctx       = canvas.getContext('2d');
  const statusEl  = document.getElementById('yarthul-new-qte-status');
  const stageEl   = document.getElementById('yarthul-new-qte-streak');
  const hsEl      = document.getElementById('yarthul-new-qte-highscore');
  const startBtn  = document.getElementById('yarthul-new-qte-start-btn');
  const resumeBtn = document.getElementById('yarthul-new-qte-resume-btn');

  const HS_KEY      = 'alb:yarthul-new-hs';
  const HS_KEY_COMP = 'alb:yarthul-new-hs-comp';
  let highscore     = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
  let highscoreComp = parseInt(localStorage.getItem(HS_KEY_COMP) || '0', 10);

  // ---- TUNING ----
  // Shared with the server's check (js/qte-rules.js): same numbers, same meaning.
  const PLATFORM_TOP_FRAC   = R.K.PLATFORM_TOP_FRAC;   // platform surface, as a fraction of H
  const PLATFORM_WIDTH_FRAC = R.K.PLATFORM_WIDTH_FRAC; // platform span, as a fraction of W

  const PLAYER_SPEED_FRAC = R.K.PLAYER_SPEED_FRAC; // W travelled per second
  const PLAYER_H_FRAC     = R.K.PLAYER_H_FRAC;     // flame height, as a fraction of H
  const PLAYER_HIT_FRAC   = R.K.PLAYER_HIT_FRAC;   // hit radius vs. drawn flame half-width

  const METEOR_R_FRAC = R.K.METEOR_R_FRAC; // meteor head radius, as a fraction of H
  const BURST_SECS    = 0.35;  // impact ring lifetime

  const TRANSITION_SECS = R.K.TRANSITION_SECS; // "Stage N" banner between stages

  let W = 0, H = 0;

  // ---- RUN LOG ----
  let run       = null;  // QteRules.Run of the current Start
  let runComp   = false; // the mode the run started in (its type says which)
  let gameT     = 0;     // the run's game clock, s: the sum of its frames' dt
  let loggedDir = 0;     // the key direction the log last recorded
  let hiddenLog = false; // a 'P' is open (tab hidden mid-run)
  let logBytes  = 0;     // about how much of the log's JSON the events take
  let logFull   = false; // the log reached its budget: 'X' ends it, the run plays on
  function logEv() {
    if (!run || logFull) return;
    // The edge function refuses a body over its size limit unread, so a very long
    // run stops logging (with 'X') in time; its score then counts up to there.
    const est = JSON.stringify(Array.prototype.slice.call(arguments)).length + 10;
    if (logBytes + est > R.K.LOG_BUDGET || run.log.ev.length >= QteRules.LIMITS.MAX_EVENTS - 1) {
      logFull = true;
      run.ev('X');
      return;
    }
    logBytes += est;
    run.ev.apply(null, arguments);
  }
  function gms(s) { return Math.round(s * 10000) / 10; }   // s -> ms, 0.1 ms
  function px1(x) { return Math.round(x * 10) / 10; }

  let playerX   = 0;     // flame centre x
  let moveLeft  = false;
  let moveRight = false;
  let animFrame = null;
  let lastTime  = 0;
  let flickerT  = 0;     // drives the flame's idle flicker

  let meteors    = [];
  let bursts     = [];
  let spawnAccum = 0; // ms accumulator driving the constant spawn cadence
  let stage      = 1;

  let running         = false;
  let gameStarted     = false;
  let paused          = false;
  let score           = 0; // stages fully cleared
  let stageTimer      = 0; // seconds left in the current stage
  let transitioning   = false;
  let transitionTimer = 0;

  function platformTop()   { return H * PLATFORM_TOP_FRAC; }
  function platformLeft()  { return (W - W * PLATFORM_WIDTH_FRAC) / 2; }
  function platformRight() { return platformLeft() + W * PLATFORM_WIDTH_FRAC; }

  function setStatus(t, c) {
    if (statusEl) { statusEl.textContent = t; statusEl.style.color = c || '#888'; }
  }

  function updateHs(val) {
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.report(val); return; }
    if (window._qteCompMode) {
      if (val > highscoreComp) {
        highscoreComp = val;
        try { localStorage.setItem(HS_KEY_COMP, highscoreComp); } catch (e) {}
        if (run) run.submit(val);
      }
      if (hsEl) hsEl.textContent = highscoreComp > 0 ? 'Best: ' + highscoreComp : '';
    } else {
      if (val > highscore) {
        highscore = val;
        try { localStorage.setItem(HS_KEY, highscore); } catch (e) {}
        if (run) run.submit(val);
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

  // ---- DIFFICULTY RAMP ----
  // Speeds are fractions of canvas height so difficulty is identical at every
  // viewport size. Competitive mode uses a steeper curve, as other trainers do.
  // The curves are in js/qte-rules.js; the mode is the one the run started in.
  function stageDuration(n)   { return R.stageDuration(n); }
  function spawnIntervalMs(n) { return R.spawnIntervalMs(n, runComp); }
  function fallSpeedFrac(n)   { return R.fallSpeedFrac(n, runComp); }
  function driftFrac()        { return R.driftFrac(runComp); }

  // ---- CANVAS SIZE ----
  function resizeCanvas() {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    const oldW = W, oldH = H;
    W = R.canvasW(wrap.clientWidth);
    H = R.canvasH(W);
    canvas.width        = W;
    canvas.height       = H;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    if (!playerX) playerX = W / 2;
    clampPlayer();
    // Live meteors keep their size and speed; the check replays the new geometry.
    if (running && (W !== oldW || H !== oldH)) logEv('Z', gms(gameT), W, H, px1(playerX));
  }

  function clampPlayer() {
    playerX = Math.min(Math.max(playerX, platformLeft()), platformRight());
  }

  // ---- BACKDROP ----
  // Almond socket: two mirrored beziers meeting at sharp inner/outer corners.
  function eyePath(cx, cy, ew, eh) {
    ctx.beginPath();
    ctx.moveTo(cx - ew, cy);
    ctx.bezierCurveTo(cx - ew * 0.45, cy - eh, cx + ew * 0.45, cy - eh, cx + ew, cy);
    ctx.bezierCurveTo(cx + ew * 0.45, cy + eh, cx - ew * 0.45, cy + eh, cx - ew, cy);
    ctx.closePath();
  }

  function drawEye(cx, cy) {
    const ew = W * 0.30, eh = H * 0.36;

    ctx.save();
    eyePath(cx, cy, ew, eh);
    ctx.clip();

    const iris = ctx.createRadialGradient(cx, cy, eh * 0.06, cx, cy, ew * 0.95);
    iris.addColorStop(0,    '#ffe6a4');
    iris.addColorStop(0.35, '#f0921f');
    iris.addColorStop(0.75, '#a83a08');
    iris.addColorStop(1,    '#3d0e04');
    ctx.fillStyle = iris;
    ctx.fillRect(cx - ew, cy - eh, ew * 2, eh * 2);

    // Faint outer striations. They stay well clear of the centre — drawn all the
    // way in, they converge into a bright hub and the iris reads as a paper fan.
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#4a1503';
    ctx.lineWidth   = Math.max(1, W * 0.0018);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * ew * 0.55, cy + Math.sin(a) * eh * 0.55);
      ctx.lineTo(cx + Math.cos(a) * ew, cy + Math.sin(a) * eh);
      ctx.stroke();
    }
    ctx.restore();

    // Vertical slit pupil — narrow and full height, the way a dragon's reads
    ctx.beginPath();
    ctx.ellipse(cx, cy, ew * 0.055, eh * 0.88, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#0d0402';
    ctx.fill();

    // Dark limbal ring, so falling meteors stay readable over the bright iris
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const rim = ctx.createRadialGradient(cx, cy, ew * 0.55, cx, cy, ew * 1.05);
    rim.addColorStop(0, 'rgba(255,255,255,1)');
    rim.addColorStop(1, 'rgba(60,18,6,1)');
    ctx.fillStyle = rim;
    ctx.fillRect(cx - ew, cy - eh, ew * 2, eh * 2);
    ctx.restore();

    ctx.restore();

    // Heavy socket rim
    eyePath(cx, cy, ew, eh);
    ctx.strokeStyle = 'rgba(22, 8, 5, 0.95)';
    ctx.lineWidth   = Math.max(4, H * 0.024);
    ctx.stroke();

    // A single brow ridge hugging the socket. Multiple concentric arcs read as
    // floating hoops rather than anatomy, so there is only one and it is dim.
    ctx.save();
    ctx.strokeStyle = 'rgba(52, 20, 11, 0.5)';
    ctx.lineWidth   = Math.max(2, H * 0.020);
    ctx.beginPath();
    ctx.moveTo(cx - ew * 1.07, cy - eh * 0.06);
    ctx.bezierCurveTo(cx - ew * 0.48, cy - eh * 1.16, cx + ew * 0.48, cy - eh * 1.16, cx + ew * 1.07, cy - eh * 0.06);
    ctx.stroke();
    ctx.restore();
  }

  // Deterministic jitter so the rock silhouette is stable across frames.
  function notch(i) { return (Math.sin(i * 12.9898) * 43758.5453) % 1; }

  function drawPlatform() {
    const l = platformLeft(), r = platformRight(), t = platformTop();
    const span = r - l;

    ctx.beginPath();
    ctx.moveTo(l, t);
    // Chipped upper edge — small notches, never deep enough to affect the clamp
    const steps = 11;
    for (let i = 1; i <= steps; i++) {
      const x = l + (span * i) / steps;
      ctx.lineTo(x, t + Math.abs(notch(i)) * H * 0.018);
    }
    ctx.lineTo(r, t);
    ctx.lineTo(r - span * 0.10, H);
    ctx.lineTo(l + span * 0.10, H);
    ctx.closePath();

    const rock = ctx.createLinearGradient(0, t, 0, H);
    rock.addColorStop(0,    '#5a463c');
    rock.addColorStop(0.35, '#3a2c26');
    rock.addColorStop(1,    '#140e0c');
    ctx.fillStyle = rock;
    ctx.fill();
    ctx.strokeStyle = '#0a0605';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Vertical fracture lines down the rock face
    ctx.save();
    ctx.strokeStyle = 'rgba(10, 6, 5, 0.55)';
    ctx.lineWidth   = Math.max(1, W * 0.002);
    for (let i = 1; i < 6; i++) {
      const x = l + span * (i / 6);
      ctx.beginPath();
      ctx.moveTo(x, t + H * 0.02);
      ctx.lineTo(x - span * 0.02 * notch(i + 20), H);
      ctx.stroke();
    }
    ctx.restore();

    // Warm rim light from the eye above. It has to follow the notched edge —
    // a straight line here paints over the chips and flattens the silhouette.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(190, 90, 34, 0.4)';
    ctx.lineWidth   = Math.max(1, H * 0.006);
    ctx.beginPath();
    ctx.moveTo(l, t);
    for (let i = 1; i <= steps; i++) {
      const x = l + (span * i) / steps;
      ctx.lineTo(x, t + Math.abs(notch(i)) * H * 0.018);
    }
    ctx.lineTo(r, t);
    ctx.stroke();
    ctx.restore();
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

  // ---- METEORS ----
  // lagMs: how far into this frame's dt the spawn accumulator reached this meteor,
  // which pins the frame it was made in on the run's game clock.
  function spawnMeteor(lagMs) {
    const spd = fallSpeedFrac(stage) * H;
    const r   = H * METEOR_R_FRAC;
    const u1  = Math.random();   // x, drawn first as before
    const u2  = Math.random();   // drift
    meteors.push({
      x:  u1 * W,
      y:  -r * R.K.SPAWN_Y_R,
      vx: (u2 * 2 - 1) * driftFrac() * spd,
      vy: spd,
      r:  r,
    });
    logEv('M', Math.floor(u1 * R.K.U_SCALE), Math.floor(u2 * R.K.U_SCALE), Math.round(lagMs * 10));
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

  function drawMeteor(m) {
    const len = m.r * 7;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(Math.atan2(m.vy, m.vx) - Math.PI / 2);

    // A dark disc behind the head only. Backing the full trail turns each meteor
    // into a black dagger; the head alone is enough to keep it readable against
    // the bright iris it falls across.
    ctx.beginPath();
    ctx.arc(0, 0, m.r * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(26, 7, 2, 0.7)';
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';

    const tail = ctx.createLinearGradient(0, 0, 0, -len);
    tail.addColorStop(0,   'rgba(255, 190, 80, 0.85)');
    tail.addColorStop(0.5, 'rgba(255, 110, 20, 0.35)');
    tail.addColorStop(1,   'rgba(255, 60, 0, 0)');
    ctx.beginPath();
    ctx.moveTo(-m.r * 0.7, 0);
    ctx.quadraticCurveTo(-m.r * 0.6, -len * 0.55, 0, -len);
    ctx.quadraticCurveTo(m.r * 0.6, -len * 0.55, m.r * 0.7, 0);
    ctx.closePath();
    ctx.fillStyle = tail;
    ctx.fill();

    const head = ctx.createRadialGradient(0, 0, 0, 0, 0, m.r * 1.9);
    head.addColorStop(0,    '#fffbe8');
    head.addColorStop(0.25, '#ffd166');
    head.addColorStop(0.55, '#ff7a18');
    head.addColorStop(1,    'rgba(190, 30, 0, 0)');
    ctx.beginPath();
    ctx.arc(0, 0, m.r * 1.9, 0, Math.PI * 2);
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
      // Kept small — a wide ring reads as a floating hoop rather than an impact.
      ctx.arc(b.x, b.y, H * METEOR_R_FRAC * (0.5 + p * 1.1), Math.PI, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 150, 50, ' + ((1 - p) * 0.8).toFixed(3) + ')';
      ctx.lineWidth   = Math.max(1, H * 0.007 * (1 - p));
      ctx.stroke();
    }
    ctx.restore();
  }

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

  function draw() {
    drawBackdrop();
    for (const m of meteors) drawMeteor(m);
    drawBursts();
    drawFlame(playerX, platformTop(), H * PLAYER_H_FRAC, flickerT);
  }

  // ---- RUN LIFECYCLE ----
  function onStageCleared() {
    score = stage;
    logEv('C', stage, gms(gameT));   // before updateHs: the submit carries it
    updateHs(score);
    stage++;
    meteors         = [];
    spawnAccum      = 0;
    transitioning   = true;
    transitionTimer = TRANSITION_SECS;
    setStatus('Stage ' + stage, '#ffb070');
    if (stageEl) stageEl.textContent = 'Stage ' + stage;
  }

  function onHit() {
    logEv('E', 'hit', gms(gameT));
    running     = false;
    gameStarted = false;
    stopLoop();
    if (window._qteMatch && window._qteMatch.active) { window._qteMatch.fail(); closeRun(); return; }
    updateHs(score);
    closeRun();
    setStatus('Hit! Cleared ' + score + (score === 1 ? ' stage' : ' stages'), '#e05555');
    draw();
    if (startBtn)  { startBtn.style.display  = ''; startBtn.textContent = 'Start'; }
    if (resumeBtn) resumeBtn.style.display = 'none';
  }

  // ---- LOOP ----
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, R.K.DT_CAP);
    lastTime = now;
    flickerT += dt;

    const onPage = document.getElementById('page-qte');
    if (!(onPage && onPage.classList.contains('active')) &&
        !(window._qteMatch && window._qteMatch.active)) {
      if (running) abandonRun(); else stopLoop();
      return;
    }

    // This frame spans [g0, gameT] of game time.
    const g0 = gameT;
    if (running) gameT += dt;

    if (running) {
      if (transitioning) {
        transitionTimer -= dt;
        if (transitionTimer <= 0) {
          transitioning = false;
          stageTimer    = stageDuration(stage);
          logEv('B', stage, gms(g0), gms(gameT));
          setStatus('Avoid the meteors', '#ff8844');
        }
      } else {
        const acc0 = spawnAccum;
        spawnAccum += dt * 1000;
        const iv = spawnIntervalMs(stage);
        let k = 0;
        while (spawnAccum >= iv) { k++; spawnMeteor(k * iv - acc0); spawnAccum -= iv; }
      }
    }

    const dir = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
    if (running && dir !== loggedDir) { loggedDir = dir; logEv('D', gms(g0), dir, px1(playerX)); }
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

  function closeRun() { if (run) run.close(); }

  function startGame() {
    // Open the run first: it asks the server for this run's ticket, and every
    // score it submits carries the ticket and the log. Its type fixes the mode.
    runComp   = !!window._qteCompMode;
    try { run = QteRules.Run.start('yarthul-new' + (runComp ? '-comp' : '')); }
    catch (e) { run = null; }   // no run, no submits: the game itself still starts
    gameT     = 0;
    loggedDir = 0;
    hiddenLog = false;
    logBytes  = 0;
    logFull   = false;
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
    logEv('S', W, H);
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

  // Navigating away mid-run abandons it. Banking a run across a page change
  // would be exploitable on the leaderboard, and leaving the loop stopped while
  // running stayed true soft-locked the panel with no Start button to press.
  function abandonRun() {
    if (running) { logEv('E', 'abandon'); closeRun(); }
    resetToStart();
    if (W && H) draw();
  }

  if (startBtn)  startBtn.addEventListener('click', startGame);
  if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);

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

  // ---- MOBILE ARROWS ----
  // Two directions only, so no cross-shaped d-pad. Held movement, not discrete
  // taps: touchstart sets the flag, touchend and touchcancel both clear it.
  // touchcancel matters -- if the browser steals the touch, the flag must not stick.
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

  // ---- SHOW / HIDE ----
  window._onYarthulNewQteShow = function () {
    resizeCanvas();
    if (!gameStarted) { resetToStart(); draw(); }
    else if (paused)  { draw(); }
    else              { startLoop(); }
  };

  window._onYarthulNewQteHide = function () {
    if (running) abandonRun(); else stopLoop();
  };

  window.addEventListener('resize', () => {
    if (!panelActive()) return;
    resizeCanvas();
    draw();
  });

  // A hidden tab gets no frames, so the game freezes; the log notes when.
  document.addEventListener('visibilitychange', () => {
    if (!running) return;
    if (document.hidden) { if (!hiddenLog) { hiddenLog = true; logEv('P'); } }
    else if (hiddenLog)  { hiddenLog = false; logEv('U'); }
  });

  setStatus('Press Start', '#888');
})();
