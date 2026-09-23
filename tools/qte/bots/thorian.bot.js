// thorian.bot.js - plays the real Thorian trainer in a browser harness so the
// IIFE's own log can be self-checked. It reads each heart from the run's log
// (the 'H' events), works out when it reaches the bar with the same geometry
// the check uses (QteRules.trainers.thorian), and turns the bar like a decent
// human: ~250 ms to notice a heart, a turn somewhere between the previous
// heart's block and this one's arrival, some timing error, now and then late.
window.__qteBots = window.__qteBots || {};
window.__qteBots['thorian'] = async function (ctx) {
  const R = window.QteRules && window.QteRules.trainers['thorian'];
  if (!R) throw new Error('thorian rules not loaded');
  const KEYS = [['w', 'KeyW'], ['a', 'KeyA'], ['d', 'KeyD']];   // up / left / right
  const now = () => performance.now();
  const target = Math.max(1, ctx.target | 0);

  ctx.click(ctx.byId('thorian-qte-start-btn'));
  const ok = await ctx.until(() => { const r = ctx.run(); return r && r.type.indexOf('thorian') === 0 && r.log.ev.length > 0; }, 5000);
  if (!ok) throw new Error('thorian: the run did not start');
  const run = ctx.run();

  let idx = 0, hs = [], G = null, v = 0, bar = 2, planned = 2, wins = 0, next = 0, dead = false;
  const presses = [];                 // { at, dir }
  const uniform = (a, b) => a + Math.random() * (b - a);

  function see(e) {
    const t = run.t0 + e[1];          // log times count from Start
    switch (e[0]) {
      case 'G': hs = []; next = 0; G = R.geom(e[3]); v = R.speed(e[2], !!ctx.comp) / 1000; presses.length = 0; planned = bar; break;
      case 'Z': G = R.geom(e[2]); break;
      case 'H': {
        const p = R.path(G, R.offset(G, e[3]));
        hs.push({ id: hs.length, side: e[2], cW: t + p.contact / v - e[5], seenAt: t + Math.max(120, ctx.human(250, 45)), res: false });
        break;
      }
      case 'B': case 'X': case 'O': if (hs[e[2]]) hs[e[2]].res = true; break;
      case 'K': bar = e[2]; break;
      case 'W': wins++; hs = []; next = 0; presses.length = 0; break;
      case 'P': presses.length = 0; break;
      case 'E': dead = true; break;
    }
  }
  function plan(tNow) {
    while (next < hs.length && hs[next].seenAt <= tNow) {
      const j = hs[next++];
      if (wins >= target || j.res || j.side === planned) continue;
      const prev = hs[j.id - 1];
      let earliest = tNow;
      if (prev && !prev.res && prev.side !== j.side) earliest = Math.max(earliest, prev.cW + Math.max(25, ctx.human(55, 20)));
      const latest = j.cW - 20;
      let at = latest > earliest ? earliest + uniform(0.15, 0.6) * (latest - earliest) : earliest;
      at += ctx.human(0, 12) * (Math.random() < 0.5 ? -1 : 1);
      if (Math.random() < 0.01) at = latest + ctx.human(40, 30);        // a late one now and then
      presses.push({ at: Math.max(tNow, at), dir: j.side });
      planned = j.side;
    }
  }

  const deadline = now() + 3600e3;
  while (!dead && now() < deadline) {
    const ev = run.log.ev;
    for (; idx < ev.length; idx++) see(ev[idx]);
    if (run.closed && !dead) break;
    const tNow = now();
    plan(tNow);
    presses.sort((a, b) => a.at - b.at);
    while (presses.length && presses[0].at <= tNow) {
      const p = presses.shift();
      const [key, code] = KEYS[p.dir];
      ctx.key(key, code, 'down');
      setTimeout(() => ctx.key(key, code, 'up'), 60 + Math.random() * 60);
    }
    if (wins >= target && !presses.length) {
      // Target reached: hands off; the next round's hearts end the run.
      await ctx.until(() => ctx.lastEv('E') || run.closed, 120000);
      break;
    }
    await ctx.sleep(4);
  }
  for (; idx < run.log.ev.length; idx++) see(run.log.ev[idx]);
  ctx.log('thorian bot: ' + wins + ' rounds');
  return { points: wins };
};
