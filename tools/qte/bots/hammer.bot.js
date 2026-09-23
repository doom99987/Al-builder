// Page bot for the hammer trainer (hold Space, release inside the zone).
// Plays the REAL trainer so its own log can be self-checked: reads each round's
// zone from the run log ('R'), presses Space after a human-ish reaction, holds
// for about (zone centre / fill speed) plus a human timing error, and releases.
// Hold times are counted on the run's clock from the logged press ('D'), so
// the ping simulator (which delays both keydown and keyup) is allowed for.
window.__qteBots = window.__qteBots || {};
window.__qteBots['hammer'] = async function (ctx) {
  const R = window.QteRules && window.QteRules.trainers && window.QteRules.trainers['hammer'];
  if (!R) throw new Error('hammer rules not loaded');
  const comp = !!ctx.comp;
  const target = Math.max(0, ctx.target | 0);
  const errSd = comp ? 7 : 10;          // release timing error, ms (a decent player)
  const ping = () => Math.max(0, Math.round(window._albPing || 0));
  const now = () => ctx.run().now();
  const since = (code, t) => { const e = ctx.lastEv(code); return e && e[1] >= t ? e : null; };
  const signed = (sd) => ctx.human(4 * sd, sd) - 4 * sd;   // ~N(0, sd)
  const sleepUntil = async (t) => { for (;;) { const d = t - now(); if (d <= 0) return; await ctx.sleep(Math.min(d, 50)); } };
  const key = (e) => e ? e[1] + ':' + e[3] + ':' + e[5] : '';   // a round, by time/zone/cause
  const blur = () => { try { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); } catch (e) {} };

  const start = ctx.byId('hammer-qte-start-btn');
  if (!start) throw new Error('no hammer start button');
  ctx.click(start);
  blur();                                // the keydown handler ignores Space while a BUTTON has focus
  await ctx.until(() => ctx.run() && ctx.run().type === 'hammer' + (comp ? '-comp' : '') && ctx.lastEv('R'), 3000);

  let points = 0;
  let slow = 1;                          // wall ms per ms of fill, learnt (frame drops make the bar lag)
  let lastR = '';
  for (let guard = 0; guard < 1e6; guard++) {
    // the round to play: the newest 'R' (a Resume or a late timer can replace it)
    const r = ctx.lastEv('R');
    if (!r || key(r) === lastR) { await ctx.sleep(10); if (ctx.lastEv('E')) break; continue; }
    lastR = key(r);
    const [, rT, k, zMin, zMax] = r;
    const sp = R.speed(k, comp);

    if (points >= target) {
      // done: a short tap ends the attempt with an early miss
      await ctx.sleep(ctx.human(250, 40));
      blur();
      ctx.key(' ', 'Space', 'down');
      await ctx.sleep(ctx.human(60, 15));
      ctx.key(' ', 'Space', 'up');
      await ctx.until(() => ctx.lastEv('E'), 3000 + ping() * 2);
      break;
    }

    // react to the new zone
    await sleepUntil(rT + ctx.human(250, 45));
    if (key(ctx.lastEv('R')) !== lastR) continue;           // replaced meanwhile
    blur();
    ctx.key(' ', 'Space', 'down');
    let d = null;
    try { await ctx.until(() => (d = since('D', rT)) || key(ctx.lastEv('R')) !== lastR, 1500 + ping() * 2); } catch (e) { d = null; }
    if (!d || key(ctx.lastEv('R')) !== lastR) { ctx.key(' ', 'Space', 'up'); lastR = ''; await ctx.sleep(100); continue; }

    // hold for the time the bar needs to reach the zone centre, plus human error;
    // the keyup reaches the trainer ping ms after it is sent, like the keydown did
    const centre = (zMin + zMax) / 2;
    const holdMs = centre / sp * 1000 * slow + signed(errSd);
    await sleepUntil(d[1] + holdMs - ping());
    ctx.key(' ', 'Space', 'up');

    // (a pause/resume while holding replaces the round and drops the hold: play the new one)
    let x = null;
    try { await ctx.until(() => (x = since('X', d[1])) || key(ctx.lastEv('R')) !== lastR, 3000 + ping() * 2); } catch (e) { x = null; }
    if (!x && key(ctx.lastEv('R')) !== lastR) continue;
    if (!x) { ctx.log('hammer bot: no release logged'); break; }
    if (x[2] > 0.05) slow = Math.min(1.5, Math.max(1, 0.5 * slow + 0.5 * (x[1] - d[1]) / (x[2] / sp * 1000)));
    if (x[5] === 1) points++;
    else break;                                     // a miss ends the attempt
  }
  return { points };
};
