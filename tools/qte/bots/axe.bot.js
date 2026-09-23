// Page bot for the axe trainer: plays the REAL trainer like a decent human so
// the run's own log can be self-checked. Reads each round's zone from the log
// ('R'), plans a burst of Space presses so the draining bar ends near the zone
// centre, and presses with human-ish reaction, spacing and timing error.
// When ctx.target points are reached it stops pressing and lets the next round
// run out (a 'low' miss ends the attempt).
window.__qteBots = window.__qteBots || {};
window.__qteBots['axe'] = async function (ctx) {
  const A = window.QteRules && window.QteRules.trainers && window.QteRules.trainers['axe'];
  if (!A) throw new Error('axe rules not loaded');
  const comp = !!ctx.comp;
  const target = Math.max(1, ctx.target | 0);
  const normal = (sd) => ctx.human(1000, sd) - 1000;   // signed noise (1000 keeps the >= 0 clip out of reach)

  function blurButtons() {
    const a = document.activeElement;
    if (a && a !== document.body && a.blur && /^(BUTTON|INPUT|TEXTAREA|SUMMARY)$/.test(a.tagName)) a.blur();
  }
  async function press() {
    blurButtons();
    ctx.key(' ', 'Space', 'down');
    await ctx.sleep(Math.max(15, ctx.human(45, 12)));
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

  const startBtn = ctx.byId('axe-qte-start-btn');
  if (!startBtn) throw new Error('no axe start button');
  const before = ctx.run();
  ctx.click(startBtn);
  await ctx.until(() => ctx.run() && ctx.run() !== before && ctx.lastEv('R'), 3000);
  blurButtons();

  let lastRoundT = -1;
  const tapMu = 120 + Math.random() * 40;
  for (let guard = 0; guard < 1000; guard++) {
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
      await ctx.sleep(Math.max(120, ctx.human(260, 50)));
      const ping = Math.max(0, +window._albPing || 0);
      const half = (zMax - zMin) / 2, c = (zMin + zMax) / 2;
      const g = c + normal(half * 0.25);
      const t0 = now();
      let mu = tapMu, margin = 250 + Math.random() * 250, plan = null;
      for (let attempt = 0; attempt < 2 && !plan; attempt++) {
        for (let n = 1; n <= 14; n++) {
          const tau = (A.PRESS * n - g) / A.DRAIN * 1000;     // ms from the first press to the end
          if (tau < (n - 1) * mu * 1.2 + margin) continue;
          const tf = endT - tau;
          if (tf >= t0 + ping + 30) plan = { n, tau, tf };
          break;
        }
        if (!plan) { mu = 85; margin = 90; }                 // short round: hurry
      }
      let n, firstAt;
      if (plan) {
        n = plan.n;
        firstAt = plan.tf - ping + normal(35 + 0.02 * plan.tau);   // timing error grows with the wait
      } else {
        // no room for a clean burst: add presses to what is there, at once
        const left = (endT - t0 - ping) / 1000;
        n = Math.max(0, Math.round((g + A.DRAIN * left) / A.PRESS));
        firstAt = t0;
      }
      // wait for the moment, then press the burst
      while (now() < firstAt - 5) await ctx.sleep(Math.min(50, Math.max(1, firstAt - now() - 2)));
      for (let i = 0; i < n; i++) {
        if (now() > endT + 200) break;
        await press();
        const gap = Math.max(40, ctx.human(mu, mu * 0.12)) - 45;
        if (i < n - 1 && gap > 0) await ctx.sleep(gap);
      }
    }
    // wait for this round's judgement
    await ctx.until(() => { const j = ctx.lastEv('J'); return j && j[1] >= R[1]; }, 15000);
    const J = ctx.lastEv('J');
    ctx.log('axe round', k, 'zone', zMin, zMax, 'fill', J[2], J[3] ? 'hit' : 'miss');
    if (!J[3]) break;
  }
  await ctx.until(() => ctx.lastEv('E'), 5000).catch(() => {});
  return { points: hits() };
};
