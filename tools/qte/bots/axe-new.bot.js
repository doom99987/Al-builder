// Page bot for the axe-new trainer (Marauder "Grudge"): plays the REAL trainer
// like a decent human so the run's own log can be self-checked. Reads each
// round's zone from the log ('R'), then either waits for an empty bar and times
// a burst of Space taps so the draining bar ends near the zone centre, or - when
// the round is too short for that - taps the count that ends nearest at once.
// Human-ish reaction, tap spacing and timing error.
// When ctx.target points are reached it stops tapping and lets the next round
// run out (a 'low' miss ends the attempt).
window.__qteBots = window.__qteBots || {};
window.__qteBots['axe-new'] = async function (ctx) {
  const A = window.QteRules && window.QteRules.trainers && window.QteRules.trainers['axe-new'];
  if (!A) throw new Error('axe-new rules not loaded');
  const comp = !!ctx.comp;
  const target = Math.max(1, ctx.target | 0);
  const normal = (sd) => ctx.human(1000, sd) - 1000;   // signed noise (1000 keeps the >= 0 clip out of reach)

  function blurButtons() {
    const a = document.activeElement;
    if (a && a !== document.body && a.blur && /^(BUTTON|INPUT|TEXTAREA|SUMMARY)$/.test(a.tagName)) a.blur();
  }
  async function tap() {
    blurButtons();
    ctx.key(' ', 'Space', 'down');
    await ctx.sleep(Math.max(12, ctx.human(35, 8)));
    ctx.key(' ', 'Space', 'up');
  }
  function hits() {
    const run = ctx.run();
    if (!run) return 0;
    let n = 0;
    for (const e of run.log.ev) if (e[0] === 'J' && e[3] === 1) n++;
    return n;
  }
  const now = () => ctx.run().now();

  const startBtn = ctx.byId('axe-new-qte-start-btn');
  if (!startBtn) throw new Error('no axe-new start button');
  const before = ctx.run();
  ctx.click(startBtn);
  await ctx.until(() => ctx.run() && ctx.run() !== before && /^axe-new/.test(ctx.run().type) && ctx.lastEv('R'), 3000);
  blurButtons();

  let lastRoundT = -1;
  const tapMu = 95 + Math.random() * 40;
  for (let guard = 0; guard < 2000; guard++) {
    // the next round (or the end)
    await ctx.until(() => {
      const r = ctx.lastEv('R'), e = ctx.lastEv('E');
      return e || (r && r[1] > lastRoundT);
    }, 15000);
    if (ctx.lastEv('E')) break;
    const R = ctx.lastEv('R');
    lastRoundT = R[1];
    const k = R[2], zMin = R[3], zMax = R[4];
    const endT = R[1] + A.timer(k, comp) * 1000;
    const done = hits() >= target;

    if (!done) {
      // look at the new zone
      await ctx.sleep(Math.max(120, ctx.human(240, 45)));
      const ping = Math.max(0, +window._albPing || 0);
      const c = (zMin + zMax) / 2, g = c + normal((zMax - zMin) / 2 * 0.25);
      const t0 = now();
      let plan = null;
      for (let n = 1; n <= 12; n++) {
        const tau = (A.PRESS * n - g) / A.DRAIN * 1000;       // ms from the first tap to the end
        if (tau < (n - 1) * tapMu * 1.2 + 150) continue;
        if (endT - tau >= t0 + ping + 30) plan = { n, first: endT - tau - ping + normal(30 + 0.02 * tau) };
        break;
      }
      if (!plan) {
        // no room for a timed burst: tap the count that ends nearest, now
        const n = Math.max(0, Math.round((g + A.DRAIN * (endT - t0 - ping) / 1000) / A.PRESS));
        plan = { n, first: t0 };
      }
      // wait for the moment, then tap the burst
      while (now() < plan.first - 5) await ctx.sleep(Math.min(50, Math.max(1, plan.first - now() - 2)));
      for (let i = 0; i < plan.n; i++) {
        if (now() > endT + 200) break;
        await tap();
        const gap = Math.max(40, ctx.human(tapMu, tapMu * 0.12)) - 35;
        if (i < plan.n - 1 && gap > 0) await ctx.sleep(gap);
      }
    }
    // wait for this round's judgement
    await ctx.until(() => { const j = ctx.lastEv('J'); return j && j[1] >= R[1]; }, 15000);
    const J = ctx.lastEv('J');
    ctx.log('axe-new round', k, 'zone', zMin, zMax, 'fill', J[2], J[3] ? 'hit' : 'miss');
    if (!J[3]) break;
  }
  await ctx.until(() => ctx.lastEv('E'), 5000).catch(() => {});
  return { points: hits() };
};
