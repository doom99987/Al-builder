// Page bot for the spear trainer: plays the real IIFE so its own log can be
// self-checked. Reads each circle from the run's log ('S' events), clicks it
// about midway through its hit band with human-sized timing (~20 ms SD) and aim
// (~7 px SD) error, oldest first, until ctx.target points; then stops clicking
// and lets the next ring close.
window.__qteBots = window.__qteBots || {};
window.__qteBots['spear'] = async function (ctx) {
  const type = 'spear' + (ctx.comp ? '-comp' : '');
  const canvas = ctx.byId('spear-qte-canvas');
  const startBtn = ctx.byId('spear-qte-start-btn');
  if (!canvas || !startBtn) throw new Error('spear: canvas or Start button missing');
  const R = QteRules.trainers['spear'];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const before = ctx.run();
  ctx.click(startBtn);
  await ctx.until(() => { const r = ctx.run(); return r && r !== before && r.type === type && r.log.ev.length > 0; }, 5000);
  const run = ctx.run();

  const live = [];        // mirrors the trainer's circles: {x, y, sp, d, due, mx, my, clicked}
  let seen = 0, points = 0, ended = false, geo = null;
  const deadline = performance.now() + 15 * 60 * 1000;

  function readLog() {
    const ev = run.log.ev;
    for (; seen < ev.length; seen++) {
      const e = ev[seen];
      if (e[0] === 'G') geo = R.geom(e[3]);
      else if (e[0] === 'S') {
        const [, , sp, x, y, d] = e;
        const open = d * (1 - geo.HT / (geo.OUT - geo.R));
        // a human aims mid-band; keep 20 ms inside either edge so noise never kills the run
        const el = clamp((open + d) / 2 + (ctx.human(200, 20) - 200), open + 20, d - 20);
        // aim error, kept well inside reach so an older circle (>= minDist away) is never taken instead
        const ang = Math.random() * 2 * Math.PI, rad = Math.min(ctx.human(7, 4), geo.reach * 0.3);
        live.push({ x, y, sp, d, due: run.t0 + sp + el, mx: x + rad * Math.cos(ang), my: y + rad * Math.sin(ang), clicked: false });
      } else if (e[0] === 'K') {
        live.splice(e[2], 1);
        if (e[6] === 1) points++;
      } else if (e[0] === 'U') {
        for (const c of live) c.due += e[2];
      } else if (e[0] === 'E') ended = true;
    }
  }

  while (!ended && !run.closed && performance.now() < deadline) {
    readLog();
    if (ended) break;
    const now = performance.now();
    if (points < ctx.target) {
      // oldest first, one click per circle
      for (const c of live) {
        if (c.clicked || now < c.due) continue;
        c.clicked = true;
        const rect = canvas.getBoundingClientRect();
        // the trainer compares clientX - rect.left with canvas pixels as they are
        ctx.mouse('click', rect.left + c.mx, rect.top + c.my, canvas);
        break;
      }
    }
    await ctx.sleep(2);
  }
  readLog();
  // after the target the rings close by themselves; wait for the end
  await ctx.until(() => run.closed || ctx.lastEv('E'), 5000).catch(() => {});
  readLog();
  ctx.log('spear bot', type, 'points', points, 'events', run.log.ev.length);
  return { points };
};
