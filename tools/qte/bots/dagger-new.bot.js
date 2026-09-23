// dagger-new page bot: plays the real trainer like a decent human, reading the
// bars from the run's own log (L = level, phase, game ms; K = game ms, bar).
// Reaction ~250 ms to new bars, press error ~N(0, 14 ms), never perfect.
window.__qteBots = window.__qteBots || {};
window.__qteBots['dagger-new'] = async function (ctx) {
  const R = QteRules.trainers['dagger-new'];
  const TAU = 2 * Math.PI;
  const prev = ctx.run();
  const start = ctx.byId('dagger-new-qte-start-btn');
  if (!start) throw new Error('dagger-new: no Start button');
  ctx.click(start);
  // The trainer ignores Space while a <button> has focus.
  try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
  const ok = await ctx.until(() => { const r = ctx.run(); return r && r !== prev && /^dagger-new/.test(r.type) && r.log.ev.length > 0; }, 3000);
  if (!ok) throw new Error('dagger-new: the run did not start');
  const run = ctx.run();

  // Everything the bot knows comes from the log.
  function read() {
    const s = { L: null, hitK: new Set(), hits: 0, over: false, sync: { t: 0, g: 0 }, nK: 0 };
    for (const e of run.log.ev) {
      if (e[0] === 'L') { s.L = e; s.hitK = new Set(); s.sync = { t: e[1], g: e[4] }; }
      else if (e[0] === 'K') { s.nK++; if (e[3] >= 0) { s.hits++; s.hitK.add(e[3]); } s.sync = { t: e[1], g: e[2] }; }
      else if (e[0] === 'U') s.sync = { t: e[1], g: s.sync.g };   // the game clock stood still while paused
      else if (e[0] === 'E') s.over = true;
    }
    return s;
  }
  const noise = () => ctx.human(60, 14) - 60;          // ~N(0, 14) ms
  let lastPress = -1e9, seenLevel = 0, readyAt = 0;
  const deadline = run.now() + 10 * 60 * 1000;

  while (run.now() < deadline) {
    const s = read();
    if (s.over || run.closed) break;
    if (s.hits >= ctx.target) break;
    const lv = s.L[2], ph = s.L[3], gS = s.L[4];
    if (lv !== seenLevel) { seenLevel = lv; readyAt = run.now() + ctx.human(250, 40); }   // take in the new bars
    const v = R.speed(lv, /-comp$/.test(run.type)), n = R.bars(lv), per = TAU / v * 1000;
    const now = run.now();
    // game time now: last logged frame time plus wall time since (+ half a frame for the judged-frame lag)
    const gNow = s.sync.g + (now - s.sync.t) + 8;
    const earliest = Math.max(now + 90, readyAt, lastPress + 170);
    let best = Infinity;
    for (let k = 0; k < n; k++) {
      if (s.hitK.has(k)) continue;
      const a = R.barAngle(R.barBase(lv, ph, k), v, (gNow - gS) / 1000);
      let tau = R.normalise(R.NEEDLE - a) / v * 1000;         // ms until its centre is under the marker
      if (tau > per - 30) tau -= per;                           // just past the centre
      while (now + tau < earliest) tau += per;
      best = Math.min(best, now + tau);
    }
    if (best === Infinity) { await ctx.sleep(100); continue; }  // level 12: every bar is gone, let the timer end it
    const ping = window._albPing || 0;
    const at = best + noise() - ping;
    if (at - run.now() > 400) { await ctx.sleep(200); continue; } // re-read closer to the press (lag resync)
    await ctx.sleep(Math.max(0, at - run.now()));
    const before = read().nK;
    ctx.key(' ', 'Space', 'down');
    ctx.key(' ', 'Space', 'up');
    lastPress = run.now();
    await ctx.until(() => read().nK > before || run.closed, ping + 400);
  }
  // Reached the target (or died): stop pressing and let the timer end the run.
  await ctx.until(() => read().over || run.closed, 15000);
  const s = read();
  ctx.log('dagger-new bot:', s.hits, 'points,', s.nK - s.hits, 'misses');
  return { points: s.hits };
};
