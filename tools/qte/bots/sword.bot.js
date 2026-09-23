// sword.bot.js - plays the real sword trainer in the page, like a decent
// human (anticipates each bar, ~18 ms timing spread), so the IIFE's own log
// can be self-checked. Reads the bars from the run's log ('R' events), never
// from the trainer's closure.
window.__qteBots = window.__qteBots || {};
window.__qteBots['sword'] = async function (ctx) {
  const SW = QteRules.trainers['sword'];
  const startBtn = ctx.byId('sword-qte-start-btn');
  if (!startBtn) throw new Error('sword: no Start button');
  ctx.click(startBtn);
  const ok = await ctx.until(() => {
    const r = ctx.run();
    return r && /^sword(-comp)?$/.test(r.type) && ctx.lastEv('R');
  }, 5000);
  if (!ok) throw new Error('sword: no round started');
  const run = ctx.run();
  const comp = /-comp$/.test(run.type);
  const mob = !!(run.log.env && run.log.env.mob);
  // Space goes to the trainer only when focus is not on a button / input.
  const blur = () => { try { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); } catch (e) {} };
  blur();

  let points = 0;
  const ended = () => !!ctx.lastEv('E') || run.closed || ctx.run() !== run;

  async function waitUntil(tRun) {
    for (;;) {
      if (ended()) return false;
      const left = tRun - run.now();
      if (left <= 0) return true;
      await ctx.sleep(Math.min(left, 8));
    }
  }

  let lastR = null, lastLag = 12;
  while (!ended()) {
    const R = ctx.lastEv('R');
    if (!R || R === lastR) {
      if (!(await ctx.until(() => ended() || (ctx.lastEv('R') && ctx.lastEv('R') !== lastR), 5000))) break;
      continue;
    }
    lastR = R;
    if (points >= ctx.target) {           // done: stop pressing, let the lead bar run off
      await ctx.until(() => ended(), 30000);
      break;
    }
    const tR = R[1], s = R[2], cw = R[3], n = R[4];
    const v = SW.speed(s, comp, mob);
    const z = SW.zone(cw - 2 * SW.PAD, s, comp, mob);
    const aim = z.x + z.w / 2 - SW.BAR_W / 2;          // bar x with its centre on the zone centre
    let x0 = SW.PAD - SW.BAR_W;
    let missed = false;
    for (let i = 0; i < n; i++) {
      if (i > 0) x0 -= R[5 + i - 1];
      const ping = Math.max(0, +window._albPing || 0);  // the ping sim delays our key by this much
      const err = ctx.human(60, 18) - 60;               // a person's scatter around the moment
      // Game time runs a little behind the clock (the judged frame is the last
      // drawn one; a dropped frame is clamped to 50 ms). A person sees where
      // the bars really are; the bot reads the lag off this round's last
      // judged press (t - round start - its game time) and aims with it.
      let lag = lastLag;
      const k = ctx.lastEv('K');
      if (k && k[1] >= tR && k[2] < i) lag = Math.max(0, (k[1] - tR) - k[4]);
      const tIdeal = tR + (aim - x0) / v * 1000 + lag;
      if (!(await waitUntil(tIdeal + err - ping))) { missed = true; break; }
      blur();
      ctx.key(' ', 'Space', 'press');
      // Do not wait for the judgement here: with the ping sim on, it comes
      // _albPing ms later, after the next bar's moment may have passed.
    }
    if (missed || ended()) break;
    // the round's last press judged: a new round, or the end
    await ctx.until(() => ended() || (ctx.lastEv('R') && ctx.lastEv('R') !== lastR), 5000 + (+window._albPing || 0));
    if (ended()) break;
    const kl = ctx.lastEv('K');
    if (kl && kl[1] >= tR) lastLag = Math.min(60, Math.max(0, (kl[1] - tR) - kl[4]));
    points++;
    ctx.log('sword: round ' + points + ' cleared');
  }
  return { points };
};
