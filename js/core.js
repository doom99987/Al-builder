// =============================================================================
// AL BUILDER — scripts.js
// Entry point for all builder logic, QTE trainers, and stat calculations.
//
// SECTION INDEX (search the marker to jump):
//   § GLOBALS          — auto-save key, mobile flag
//   § QTE SFX          — sound effect player for all QTE trainers
//   § QTE PING SIM     — simulated input delay for latency practice
//   § QTE LB HOOK      — leaderboard score submission on localStorage writes
//   § DMGCALC STATE    — global variables used by the damage calculator
//   § RACE SYSTEM      — race data and stat-row initialisation
//   § STAT SYSTEM      — level cap, stat counters, class-lock gating
//   § EQUIPMENT DATA   — armour, weapon bonuses, covenant bonuses
//   § STAT FORMULAS    — calcPercentage, updatePecents (main stat engine)
//   § MARKS            — mark picker data and move definitions
//   § ENCHANTS         — enchant picker data
//   § ARTIFACTS        — artifact picker data
//   § SHARDS           — shard picker data and DR tracking
//   § GEAR SYSTEM      — gear series data, pct bonuses, picker init
//   § WEAPON SYSTEM    — weapon series data, picker init
//   § SCROLL SYSTEM    — lost scrolls and regular scrolls
//   § DROPDOWN BUILDER — reusable searchable dropdown component
//   § COVENANT SYSTEM  — covenant data, rank gating
//   § CLASS SYSTEM     — class/superclass/subclass data, gold costs
//   § CLASS MOVES DB   — all moves and passives, keyed by class name
//   § RACE MOVES DB    — all moves and passives, keyed by race name
//   § MOVE RENDERER    — renderMoves(), move card HTML generation
//   § DMGCALC ENGINE   — parseScaling, getTotalStat, getDmgBonusPassives
//   § DMGCALC UI       — renderDmgBonusSection, status/buff toggles
//   § SOUL TREE        — Path of Destruction / Path of Empowerment
//   § MASTERY TREE     — 35-point mastery system, echo shard gates
//   § TAB SWITCHING    — builder tab panel visibility
//   § BUILD ENCODING   — bit-packing, base64url, compression helpers
//   § BUILD SHARE      — share URL generation and loading
//   § NAVIGATION       — page switching, hash routing
//   § QTE TRAINERS     — Fist, Spear, Sword, Dodge, Dagger, Hammer, Axe, Staff
//   § SAVED BUILDS     — localStorage build persistence, search, favourites
// =============================================================================

// § GLOBALS
var _AUTO_SAVE_KEY = 'alb:autosave'; // localStorage key for the auto-saved build state
var _autoSaveTimer = null;           // debounce handle for auto-save writes

// True when the device uses touch input — used to show/hide mobile controls across all QTE trainers.
const IS_MOBILE = ('ontouchstart' in window) || window.matchMedia('(pointer: coarse)').matches;

// § QTE SFX
// Centralised sound player for all QTE trainers.
// Each trainer calls window._playQteSfx(name) on a correct input.
// Setting poly=true clones the Audio node so rapid inputs can overlap (used by Fist QTE).
// All sounds are cut off after 500 ms to prevent echoing from long audio files.
(function () {
  var cache = {};

  // Custom filename overrides — used when the file doesn't follow the standard naming convention.
  var fileMap = { staff: 'sfx/staffsound (mp3cut.net).mp3' };

  window._playQteSfx = function (name, poly) {
    if (!cache[name]) cache[name] = new Audio(fileMap[name] || 'sfx/' + name + 'sound.mp3');
    var a;
    if (poly) {
      // Polyphonic mode: clone the node so each call plays independently (sounds can overlap).
      a = cache[name].cloneNode();
    } else {
      // Monophonic mode: reuse the same node, resetting playback position each call.
      a = cache[name];
      clearTimeout(a._sfxStop);
      a.currentTime = 0;
    }
    a.play().catch(function () {});
    a._sfxStop = setTimeout(function () { a.pause(); }, 500); // hard cut-off at 500 ms
  };
})();

// § QTE PING SIM
// Simulates network latency by delaying QTE key events by window._albPing ms.
// Uses capture phase so it intercepts events before any QTE trainer's bubble-phase handler.
// Toggling competitive mode fires 'alb-mode-changed' so all trainers can update their difficulty.
window._albPing     = 0;
window._qteCompMode = false;
window._toggleQteMode = function () {
  // Block mid-session switches — would let casual streaks credit to competitive scores.
  const anyActive = Array.from(document.querySelectorAll('[id$="-qte-start-btn"]')).some(b => b.style.display === 'none');
  if (anyActive) return;
  window._qteCompMode = !window._qteCompMode;
  const btn = document.getElementById('qte-mode-btn');
  if (btn) {
    btn.textContent = window._qteCompMode ? 'Competitive' : 'Casual';
    btn.classList.toggle('comp',   window._qteCompMode);
    btn.classList.toggle('casual', !window._qteCompMode);
  }
  window.dispatchEvent(new Event('alb-mode-changed'));
};

(function () {
  const QTE_KEYS = new Set(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);

  function isQteActive() {
    return !!document.querySelector('#page-qte.active');
  }

  // Stops the real event, waits _albPing ms, then re-dispatches a synthetic copy.
  function intercept(type, e) {
    if (e._albSynthetic) return; // already delayed — let it through
    const ping = window._albPing || 0;
    if (ping <= 0 || !isQteActive()) return;
    if (!QTE_KEYS.has(e.code) && !['w','a','s','d','W','A','S','D'].includes(e.key)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    setTimeout(() => {
      const ev = new KeyboardEvent(type, {
        key: e.key, code: e.code, keyCode: e.keyCode, which: e.which,
        shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey,
        bubbles: true, cancelable: true
      });
      ev._albSynthetic = true;
      document.dispatchEvent(ev);
    }, ping);
  }

  document.addEventListener('keydown', e => intercept('keydown', e), true);
  document.addEventListener('keyup',   e => intercept('keyup',   e), true);
})();

// § QTE LB HOOK
// Intercepts every localStorage.setItem call so that when a QTE highscore key
// (pattern "alb:<trainer>-hs") is written, the score is also submitted to the
// online leaderboard via window._sbSubmitScore if available.
(function () {
  const _origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    _origSet.call(this, key, value);
    const m = key.match(/^alb:([a-z]+)-hs$/);
    if (m && window._sbSubmitScore) window._sbSubmitScore(m[1], parseInt(value, 10));
  };
})();

// § DMGCALC STATE
// These globals are declared early because updatePecents() references them before the
// damage calculator section is parsed. Keep them here to avoid temporal dead zones.
var crystalStarStacks        = 0;     // 0–5  : Crystallized Star LCK stacks (+10 LCK each)
var frozenDiademColdActive   = false; // true when target has Cold status → +5% crit chance (Frozen Diadem innate)
var frozenDiademIceActive    = false; // true when Cold was just applied → +10% crit chance for 2 turns (Frozen Diadem)
var flamingOverdriveStacks   = 0;     // 0–15 : Burning stacks on enemy → +1% dmg each (Flaming Overdrive passive)
var vasticLckProcActive      = false; // true when Vastic Glaive LCK proc is active → +80% crit chance
var tearBloodCrystalActive   = false; // true when Tear Blood Crystal bleed buff is active → +5% crit chance
var weirdAccessoryActive     = false; // reserved for accessory with custom conditional behaviour
