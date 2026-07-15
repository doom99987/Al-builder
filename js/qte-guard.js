// =============================================================================
// AL BUILDER — qte-guard.js
// Input forensics for QTE runs (Trainer + Matchmaking). Detects macro/automated
// input and (a) blocks synthetic events before the QTE engines see them,
// (b) forfeits the current matchmaking round, (c) withholds Trainer leaderboard
// submissions while flagged.
//
// Detection signals (all far outside human capability, to avoid false positives):
//   synthetic — event.isTrusted === false (dispatchEvent / element.click() keys)
//   rhythm    — 10 consecutive key intervals within ±3ms of their median
//   burst     — 14 consecutive key intervals each under 25ms (>40 presses/sec)
//   hold      — 12 consecutive key hold durations within ±2ms of their median
//
// Listeners run in the capture phase on window, so they fire before the QTE
// engines' document-level handlers and can stop synthetic events cold.
// =============================================================================
(function () {
  'use strict';

  const FLAG_TTL   = 120000; // flag expires after 2 min of clean play
  const RHYTHM_N   = 10;     // intervals for the rhythm check
  const RHYTHM_TOL = 3;      // ms deviation from median
  const RHYTHM_MAX = 900;    // only judge rhythm when actually playing fast
  const BURST_N    = 14;     // consecutive intervals for the burst check
  const BURST_MS   = 25;     // interval ceiling that counts as a burst press
  const HOLD_N     = 12;     // samples for the hold-duration check
  const HOLD_TOL   = 2;      // ms deviation from median

  let times  = [];           // trusted keydown timestamps (perf clock)
  let holds  = [];           // keydown→keyup durations
  let downAt = {};           // per-key press start
  let flag   = null;         // { reason, at } — latest detection

  // Guard only while a QTE can actually be running: mid-match, or on the
  // QTE Trainer page. Everything else (typing in chat etc.) is ignored.
  function qteContextActive() {
    if (window._qteMatch && window._qteMatch.active) return true;
    const page = document.getElementById('page-qte');
    return !!(page && page.classList.contains('active'));
  }
  function isTypingTarget(e) {
    const t = e.target;
    return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
  }

  function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  function raise(reason) {
    const inMatch = window._qteMatch && window._qteMatch.active;
    flag = { reason, at: Date.now() };
    times = []; holds = []; downAt = {};
    toast(inMatch
      ? 'Automated input detected — round forfeited.'
      : 'Automated input detected — scores will not be submitted.');
    if (typeof window._qteGuard.onFlag === 'function') {
      try { window._qteGuard.onFlag(reason); } catch (_) {}
    }
    if (inMatch) { try { window._qteMatch.fail(); } catch (_) {} }
  }

  function analyze() {
    // Robotic rhythm: intervals a metronome could envy.
    if (times.length >= RHYTHM_N + 1) {
      const recent = times.slice(-(RHYTHM_N + 1));
      const iv = [];
      for (let i = 1; i < recent.length; i++) iv.push(recent[i] - recent[i - 1]);
      const med = median(iv);
      if (med < RHYTHM_MAX && iv.every(v => Math.abs(v - med) <= RHYTHM_TOL)) { raise('rhythm'); return; }
    }
    // Impossible sustained speed.
    if (times.length >= BURST_N + 1) {
      const recent = times.slice(-(BURST_N + 1));
      let burst = true;
      for (let i = 1; i < recent.length; i++) {
        if (recent[i] - recent[i - 1] >= BURST_MS) { burst = false; break; }
      }
      if (burst) { raise('burst'); return; }
    }
    // Machine-identical key hold durations.
    if (holds.length >= HOLD_N) {
      const recent = holds.slice(-HOLD_N);
      const med = median(recent);
      if (recent.every(v => Math.abs(v - med) <= HOLD_TOL)) { raise('hold'); }
    }
  }

  function onKeyDown(e) {
    if (!qteContextActive()) return;
    if (!e.isTrusted) { e.stopImmediatePropagation(); e.preventDefault(); raise('synthetic'); return; }
    if (isTypingTarget(e) || e.repeat) return;
    const now = performance.now();
    times.push(now);
    if (times.length > 40) times.shift();
    downAt[e.code] = now;
    analyze();
  }
  function onKeyUp(e) {
    if (!qteContextActive()) return;
    if (!e.isTrusted) { e.stopImmediatePropagation(); e.preventDefault(); raise('synthetic'); return; }
    if (isTypingTarget(e)) return;
    const d = downAt[e.code];
    if (d != null) {
      holds.push(performance.now() - d);
      delete downAt[e.code];
      if (holds.length > 30) holds.shift();
      analyze();
    }
  }
  function onPointer(e) {
    if (!qteContextActive()) return;
    if (!e.isTrusted) { e.stopImmediatePropagation(); e.preventDefault(); raise('synthetic'); }
  }
  // Some QTEs play on 'click' (spear canvas, mobile tap buttons). Block untrusted
  // clicks inside a QTE panel — but allow the start/resume buttons, which the
  // matchmaking code clicks programmatically on round start.
  function onClick(e) {
    if (!qteContextActive() || e.isTrusted) return;
    const t = e.target;
    if (!t || !t.closest || !t.closest('[id^="qte-panel-"]')) return;
    if (t.id && /-qte-(start|resume)-btn$/.test(t.id)) return;
    e.stopImmediatePropagation(); e.preventDefault(); raise('synthetic');
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('click', onClick, true);
  ['mousedown', 'pointerdown', 'touchstart'].forEach(t =>
    window.addEventListener(t, onPointer, { capture: true, passive: false }));

  // ── Trainer leaderboard gate ────────────────────────────────────────────────
  // All QTE Trainer submissions go through window._sbSubmitScore (sb.js).
  // While flagged, drop them silently server-side of the UI toast.
  (function wrapSubmit() {
    const orig = window._sbSubmitScore;
    if (typeof orig !== 'function') { setTimeout(wrapSubmit, 1000); return; }
    if (orig._qteGuarded) return;
    const wrapped = function () {
      if (window._qteGuard.flagged()) {
        toast('Score not submitted — automated input detected.');
        return;
      }
      return orig.apply(this, arguments);
    };
    wrapped._qteGuarded = true;
    window._sbSubmitScore = wrapped;
  })();

  // ── Toast ───────────────────────────────────────────────────────────────────
  let toastEl = null, toastT = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'qte-guard-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 5000);
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  window._qteGuard = {
    flagged: () => !!(flag && Date.now() - flag.at < FLAG_TTL),
    reason:  () => (flag ? flag.reason : null),
    reset:   () => { flag = null; times = []; holds = []; downAt = {}; },
    onFlag:  null, // optional hook — matchmaking sets this to update its UI
  };
})();
