// Page bot for the dodge trainer (casual and comp): plays the real IIFE through
// its own Start button and Space key, reading each target from the run's log, so
// the log the real trainer writes can be self-checked. Plays like a decent person:
// takes a moment to look at each launch, presses around the moment the bar
// reaches the target's centre with ~12 ms of timing error, and stops pressing
// once ctx.target points are in (the bar then flies off the track: 'Too slow').
window.__qteBots = window.__qteBots || {};
window.__qteBots['dodge'] = async function (ctx) {
  const R = window.QteRules && QteRules.trainers['dodge'];
  if (!R) throw new Error('dodge rules not loaded');
  const wait = async (fn, ms) => { try { return await ctx.until(fn, ms); } catch (e) { return false; } };
  // Paused ms in the run's log since t0, and whether a pause is still open.
  const pausedSince = (run, t0) => {
    let ms = 0, pAt = -1;
    for (const e of run.log.ev) {
      if (e[1] < t0) continue;
      if (e[0] === 'P') pAt = e[1];
      else if (e[0] === 'U' && pAt >= 0) { ms += e[1] - pAt; pAt = -1; }
    }
    return { ms, open: pAt >= 0 };
  };

  const start = ctx.byId('dodge-qte-start-btn');
  if (!start) throw new Error('no dodge Start button');
  const before = ctx.run();
  ctx.click(start);
  // The trainer ignores Space while a button has focus.
  try { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); } catch (e) {}
  await wait(() => ctx.run() && ctx.run() !== before && ctx.run().type.indexOf('dodge') === 0 && ctx.lastEv('G'), 5000);
  const run = ctx.run();
  if (!run || run === before || !ctx.lastEv('G')) throw new Error('dodge run did not start');

  let points = 0, pace = 1;
  for (;;) {
    const k = points + 1;
    // This target's launch, or the end of the run.
    await wait(() => { const L = ctx.lastEv('L'); return (L && L[2] === k) || ctx.lastEv('E'); }, 15000);
    if (ctx.lastEv('E')) break;
    const L = ctx.lastEv('L');
    if (!L || L[2] !== k) break;
    if (points >= ctx.target) {                   // done: let the bar fly off
      await wait(() => ctx.lastEv('E'), 15000);
      break;
    }
    const T = ctx.lastEv('T');
    const sp = R.speed(k - 1, !!ctx.comp);
    // Game ms for the bar (drawn at x) to sit centred on the target, on the
    // current track (a resize moves the target but not the bar).
    const flyMs = () => { const G = ctx.lastEv('G'), Z = ctx.lastEv('Z'); return ((Z ? Z[2] : G[2]) * T[3] - R.BAR_W / 2) / sp * 1000; };
    await ctx.sleep(Math.min(ctx.human(250, 40), Math.max(0, flyMs() / pace - 150)));  // look at it first
    const err = ctx.human(60, 12) - 60;          // signed timing error, ~N(0, 12)
    const ping = window._albPing || 0;           // the ping simulator delays the key by this
    // Wait for the moment; the bar stands still while the panel is hidden (P..U).
    for (;;) {
      if (ctx.lastEv('E')) break;
      const pz = pausedSince(run, L[1]);
      if (pz.open) { await wait(() => !pausedSince(run, L[1]).open || ctx.lastEv('E'), 600000); continue; }
      const left = L[1] + flyMs() / pace + pz.ms + err - ping - run.now();
      if (left <= 0) break;
      await ctx.sleep(Math.min(left, 40));
    }
    if (ctx.lastEv('E')) break;                  // the bar already left
    ctx.key(' ', 'Space', 'down');
    await ctx.sleep(ctx.human(70, 15));
    ctx.key(' ', 'Space', 'up');
    await wait(() => { const H = ctx.lastEv('H'); return (H && H[2] === k) || ctx.lastEv('E'); }, 5000 + ping);
    const H = ctx.lastEv('H');
    if (!(H && H[2] === k && H[5] === 1)) break; // a miss: the run is over
    points++;
    // How fast the bar really flies vs the clock (slow frames lose time): a person
    // adapts to what they see, so follow it.
    const wall = H[1] - L[1] - pausedSince(run, L[1]).ms - ping;
    if (wall > 100) pace = Math.min(1.1, Math.max(0.4, 0.5 * pace + 0.5 * (H[4] / wall)));
  }
  await wait(() => ctx.lastEv('E'), 5000);
  ctx.log('dodge bot', ctx.comp ? 'comp' : 'casual', 'points', points, 'target', ctx.target);
  return { points };
};
