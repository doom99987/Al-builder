// hammer-new page bot: plays the real trainer like a decent human, reading the
// round and the fill from the run's own log (R = the zone; D / X / Z / P = where
// the fill turned; S = cleared). Presses ~250 ms after a round appears (or keeps
// Space held through the 700 ms wait), lets go around the zone's upper half,
// presses again around its lower half, with ~N(0, 15 ms) timing error.
// Never perfect. At the target it lets go and lets the round time out.
window.__qteBots = window.__qteBots || {};
window.__qteBots['hammer-new'] = async function (ctx) {
  const R = QteRules.trainers['hammer-new'];
  const prev = ctx.run();
  const start = ctx.byId('hammer-new-qte-start-btn');
  if (!start) throw new Error('hammer-new: no Start button');
  ctx.click(start);
  // The trainer ignores Space while a <button> has focus.
  try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
  const ok = await ctx.until(() => { const r = ctx.run(); return r && r !== prev && /^hammer-new/.test(r.type) && r.log.ev.length > 0; }, 3000);
  if (!ok) throw new Error('hammer-new: the run did not start');
  const run = ctx.run();

  // Everything the bot knows comes from the log: replay it like the check does.
  function read() {
    const s = { phase: 'none', a: 0, b: 0, dir: -1, g: 0, f: 0, sync: { t: 0, g: 0 }, clears: 0, rounds: 0, over: false, paused: false, n: run.log.ev.length };
    for (const e of run.log.ev) {
      const c = e[0];
      if (c === 'R') { s.phase = 'play'; s.a = e[3]; s.b = e[4]; s.g = e[5]; s.f = 0; s.sync = { t: e[1], g: e[5] }; s.rounds++; }
      else if (c === 'D' || c === 'X') { if (s.phase === 'play') { s.f = R.move(s.f, s.dir, (e[2] - s.g) / 1000); s.g = e[2]; } s.dir = c === 'D' ? 1 : -1; s.sync = { t: e[1], g: e[2] }; }
      else if (c === 'Z') { s.f = R.move(s.f, s.dir, (e[3] - s.g) / 1000); s.g = e[3]; s.sync = { t: e[1], g: e[3] }; }
      else if (c === 'S') { s.phase = 'won'; s.clears++; s.sync = { t: e[1], g: e[3] }; }
      else if (c === 'E') s.over = true;
      else if (c === 'P') { if (s.phase === 'play') { s.f = R.move(s.f, s.dir, (e[2] - s.g) / 1000); s.g = e[2]; } s.dir = -1; s.paused = true; s.sync = { t: e[1], g: e[2] }; }
      else if (c === 'U') { s.paused = false; s.sync = { t: e[1], g: s.sync.g }; }
    }
    return s;
  }
  // The fill now: the game clock runs with the wall clock between logged points.
  const fillNow = (s) => R.move(s.f, s.dir, Math.max(0, s.sync.g + (run.now() - s.sync.t) - s.g) / 1000);
  let down = false;
  const key = (d) => { ctx.key(' ', 'Space', d ? 'down' : 'up'); down = d; };
  const ping = () => Math.max(0, Math.round(window._albPing || 0));
  const noise = () => ctx.human(60, 15) - 60;        // ~N(0, 15) ms
  const aim = () => 0.45 + 0.3 * (Math.random() - 0.5);
  const deadline = run.now() + 10 * 60 * 1000;
  let seenRounds = 0, seenClears = 0, preHold = false;

  while (run.now() < deadline) {
    const s = read();
    if (s.over || run.closed) break;
    if (s.clears >= ctx.target) {                   // done: let go and let the round time out
      if (down) key(false);
      await ctx.until(() => read().over || run.closed, 15000);
      break;
    }
    if (s.paused) { await ctx.sleep(100); continue; }
    if (s.phase === 'won') {                        // mostly: be holding when the next round starts
      if (s.clears !== seenClears) { seenClears = s.clears; preHold = Math.random() < 0.7; }
      if (preHold && !down) { await ctx.sleep(ctx.human(450, 60)); if (read().phase === 'won') key(true); }
      else if (!preHold && down) key(false);
      else await ctx.sleep(40);
      continue;
    }
    if (s.phase !== 'play') { await ctx.sleep(20); continue; }
    if (s.dir < 0 && down) { key(false); await ctx.sleep(ctx.human(90, 20)); continue; }   // the game dropped the hold
    if (s.rounds !== seenRounds) {                  // a new zone: take it in
      seenRounds = s.rounds;
      if (s.dir < 0) { await ctx.sleep(ctx.human(250, 40)); key(true); await ctx.until(() => read().n > s.n || run.closed, ping() + 400); continue; }
    }
    const c = (s.a + s.b) / 2, hw = (s.b - s.a) / 2, f = fillNow(s);
    const target = s.dir > 0 ? c + hw * aim() : c - hw * aim();
    const dist = s.dir > 0 ? target - f : f - target;
    const wait = (dist > 0 ? dist / R.RATE * 1000 : 0) + noise() - ping();
    if (wait > 150) { await ctx.sleep(100); continue; }              // re-read closer to the turn
    await ctx.sleep(Math.max(0, wait));
    const before = read().n;
    key(s.dir < 0);
    await ctx.until(() => read().n > before || run.closed, ping() + 400);
    await ctx.sleep(ctx.human(45, 10));                              // a hand needs a moment before the next turn
  }
  const s = read();
  ctx.log('hammer-new bot:', s.clears, 'rounds cleared of', s.rounds);
  return { points: s.clears };
};
