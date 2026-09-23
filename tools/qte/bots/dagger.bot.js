// Page bot for the dagger trainer (spinning rings), for the QTE self-check
// harness. Plays the REAL trainer: clicks its Start, reads each round's rings
// from the run's log ('R' events: start angle signed by direction), and presses
// Space like a decent player - about 250 ms to react to a counter-clockwise
// ring, clockwise rings aimed at the gap's centre with ~8 ms of error. Stops
// pressing at ctx.target points and lets the round's 8 s run out.
window.__qteBots = window.__qteBots || {};
window.__qteBots['dagger'] = async function (ctx) {
  const TAU = Math.PI * 2;
  const R = QteRules.trainers['dagger'];
  const comp = !!ctx.comp;

  const startBtn = ctx.byId('dagger-qte-start-btn');
  if (!startBtn) throw new Error('dagger: no Start button');
  ctx.click(startBtn);
  // The trainer ignores Space while a BUTTON has focus.
  try { if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur(); } catch (e) {}

  let run = null;
  try {
    run = await ctx.until(() => {
      const r = ctx.run();
      return r && /^dagger(-comp)?$/.test(r.type) && r.log.ev.length ? r : null;
    }, 3000);
  } catch (e) { run = null; }
  if (!run) run = ctx.run();
  if (!run || !/^dagger(-comp)?$/.test(run.type)) throw new Error('dagger: the run did not start');

  const tapBtn = ctx.byId('dagger-tap-btn');
  const useTap = !!(tapBtn && tapBtn.style.display !== 'none');
  const press = () => {
    if (useTap) ctx.click(tapBtn);
    else { ctx.key(' ', 'Space', 'down'); ctx.key(' ', 'Space', 'up'); }
  };
  const lastCode = () => { const ev = run.log.ev; return ev.length ? ev[ev.length - 1][0] : null; };
  const wait = async (fn, ms) => { try { return await ctx.until(fn, ms); } catch (e) { return null; } };
  const cleared = () => {
    let n = 0, need = 0, got = 0;
    for (const e of run.log.ev) {
      if (e[0] === 'R') { need = e.length - 3; got = 0; }
      else if (e[0] === 'K' && e[4] === 1 && ++got === need) n++;
    }
    return n;
  };

  const stopAt = performance.now() + 15 * 60 * 1000;
  while (performance.now() < stopAt) {
    const ev = run.log.ev;
    if (lastCode() === 'E' || run.closed) break;
    let iR = -1;
    for (let i = ev.length - 1; i >= 0; i--) if (ev[i][0] === 'R') { iR = i; break; }
    if (iR < 0) { await ctx.sleep(20); continue; }
    const Rv = ev[iR], s = Rv[2], n = Rv.length - 3, tR = Rv[1];
    let hits = 0, lastK = null;
    for (let i = iR + 1; i < ev.length; i++) if (ev[i][0] === 'K') { hits++; lastK = ev[i]; }

    if (cleared() >= ctx.target) {
      // Enough: stop pressing and let the round time out.
      await wait(() => lastCode() === 'E', 12000);
      break;
    }
    if (hits >= n || lastCode() === 'P') {           // between rounds, or paused
      const len = ev.length;
      await wait(() => run.log.ev.length !== len, 3000);
      continue;
    }

    const idx = n - 1 - hits, g = Rv[3 + idx];
    const tNow = run.now();
    const paused = QteRules.pausedBetween(ev, tR, tNow);
    const lockEnd = lastK ? lastK[1] + R.C.EXPAND_MS + 25 : tR;
    const ping = Math.max(0, window._albPing || 0);
    let tPress;
    if (g < 0) {
      // counter-clockwise: any press passes once the zoom-in is over; react to it
      tPress = Math.max(tNow, lockEnd) + ctx.human(250, 50);
    } else {
      // clockwise: aim at the next time the gap's centre passes 12 o'clock.
      // The rings run on the round's game time, which lags the clock when
      // frames are slow; take the lag from this round's last press.
      const v = R.ringSpeed(s, idx, n, comp);
      const lag = lastK ? Math.max(0, (lastK[1] - tR - QteRules.pausedBetween(ev, tR, lastK[1])) - lastK[3]) : 0;
      const earliest = Math.max(tNow + 150 + ping, lockEnd);
      const gEarliest = earliest - tR - paused - lag;
      const m = Math.ceil((g + v * gEarliest / 1000) / TAU);
      const gCentre = (m * TAU - g) * 1000 / v;
      tPress = tR + paused + lag + gCentre + 8 + (ctx.human(24, 8) - 24) - ping;
    }
    const delay = tPress - run.now();
    if (delay > 0) await ctx.sleep(delay);
    if (lastCode() === 'E' || lastCode() === 'P' || run.closed) continue;
    const before = run.log.ev.length;
    press();
    // The press is judged (a 'K') unless the zoom-in was still running.
    await wait(() => run.log.ev.length > before, 400 + ping);
  }
  return { points: cleared() };
};
