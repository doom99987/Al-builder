// duraelis.bot.js - plays the real duraelis trainer in the page, like a
// decent human (looks ~0.65 s at each round's spotlights, then the fewest
// presses ~0.15 s apart), so the IIFE's own log can be self-checked. Reads
// each round from the run's log ('R': the souls' mask and the shift), never
// from the trainer's closure. After its target it stops pressing and lets the
// lights take the three lives, so the run ends by itself.
window.__qteBots = window.__qteBots || {};
window.__qteBots['duraelis'] = async function (ctx) {
  const D = QteRules.trainers['duraelis'];
  const prev = ctx.run();
  const startBtn = ctx.byId('duraelis-qte-start-btn');
  if (!startBtn) throw new Error('duraelis: no Start button');
  ctx.click(startBtn);
  const ok = await ctx.until(() => {
    const r = ctx.run();
    return r && r !== prev && /^duraelis(-comp)?$/.test(r.type) && ctx.lastEv('R');
  }, 6000);
  if (!ok) throw new Error('duraelis: no round started');
  const run = ctx.run();
  // Keys go to the trainer only when focus is not in an input.
  const blur = () => { try { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); } catch (e) {} };
  blur();
  const KEY = { W: ['w', 'KeyW'], A: ['a', 'KeyA'], S: ['s', 'KeyS'], D: ['d', 'KeyD'] };

  let points = 0;
  const ended = () => !!ctx.lastEv('E') || run.closed || ctx.run() !== run;
  // the events of the round that started with R (up to its flare)
  function roundOf(R) {
    const ev = run.log.ev, i = ev.lastIndexOf(R);
    if (i < 0) return null;
    const out = [];
    for (let j = i + 1; j < ev.length; j++) { out.push(ev[j]); if (ev[j][0] === 'F') break; }
    return out;
  }
  const flared = R => { const r = roundOf(R); return !!(r && r.length && r[r.length - 1][0] === 'F'); };

  let lastR = null;
  while (!ended()) {
    const R = ctx.lastEv('R');
    if (!R || R === lastR) {
      if (!(await ctx.until(() => ended() || (ctx.lastEv('R') && ctx.lastEv('R') !== lastR), 8000))) break;
      continue;
    }
    lastR = R;
    if (points >= ctx.target) {           // done: no more presses, the lights take the lives
      await ctx.until(() => ended(), 60000);
      break;
    }
    const souls = R[6], spots = D.translate(souls, R[7], R[8]);
    const keys = D.solveKeys(souls, spots) || [];
    await ctx.sleep(ctx.human(650, 120));
    for (const k of keys) {
      if (ended() || flared(R) || ctx.lastEv('R') !== R) break;
      blur();
      ctx.key(KEY[k][0], KEY[k][1], 'press');
      await ctx.sleep(ctx.human(150, 35));
    }
    // the flare: every soul in the light, or a life gone
    await ctx.until(() => ended() || flared(R), 10000 + (+window._albPing || 0));
    const evs = roundOf(R) || [];
    const F = evs.length && evs[evs.length - 1][0] === 'F' ? evs[evs.length - 1] : null;
    if (!F) break;
    let m = souls;
    for (const e of evs) if (e[0] === 'K') m = e[4];
    if (F[3] === m) { points++; ctx.log('duraelis: round ' + points + ' cleared'); }
  }
  return { points };
};
