// Page bot for the fist trainer (fist / fist-comp): plays the REAL trainer so
// the real IIFE's log can be self-checked. Reads each round's arrows from the
// run's log ('R' and 'U' events), types them with arrow keys (sometimes WASD)
// like a decent human: ~260 ms to the first arrow, ~150 ms between arrows, a
// rare wrong key. Pauses and resumes once (round 3) so the P/U path is played.
// Stops pressing at ctx.target points, lets the round time out, then leaves
// the panel's run (the trainer would otherwise restart forever).
window.__qteBots = window.__qteBots || {};
window.__qteBots['fist'] = async function (ctx) {
  const ARROW_KEYS = [['ArrowUp', 'ArrowUp'], ['ArrowDown', 'ArrowDown'], ['ArrowLeft', 'ArrowLeft'], ['ArrowRight', 'ArrowRight']];
  const WASD_KEYS  = [['w', 'KeyW'], ['s', 'KeyS'], ['a', 'KeyA'], ['d', 'KeyD']];
  const target = Math.max(1, ctx.target | 0);
  const ERR = 0.003;                        // wrong key per press
  const deadline = Date.now() + Math.max(120000, target * 8000);

  function blur() {
    // The trainer ignores keys while a <button> has focus.
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
  }
  function evs() { const r = ctx.run(); return r && r.log ? r.log.ev : []; }
  // The arrows now in play: the newest R or U of the current attempt's log.
  function latest() {
    const r = ctx.run(); if (!r) return null;
    const ev = r.log.ev;
    for (let i = ev.length - 1; i >= 0; i--) {
      const c = ev[i][0];
      if (c === 'R' || c === 'U') return { run: r, log: r.log, idx: i, arrows: String(ev[i][2]), id: ev[i] };
      if (c === 'E') return null;           // the attempt is over; wait for the restart
    }
    return null;
  }
  // Still the same live round: same log, nothing after it but keys.
  function stillLive(cur) {
    const r = ctx.run();
    if (!r || r.log !== cur.log) return false;
    const ev = r.log.ev;
    for (let i = cur.idx + 1; i < ev.length; i++) if (ev[i][0] !== 'K') return false;
    return true;
  }
  function bestSoFar(best) {
    const s = ctx.lastEv('S');
    return s ? Math.max(best, s[2] | 0) : best;
  }
  async function press(d, useWasd) {
    const [key, code] = (useWasd ? WASD_KEYS : ARROW_KEYS)[d];
    ctx.key(key, code, 'down');
    await ctx.sleep(Math.max(25, ctx.human(55, 15)));
    ctx.key(key, code, 'up');
  }

  ctx.click(ctx.byId('fist-qte-start-btn'));
  blur();

  let best = 0, seen = null, pausedOnce = false, rounds = 0;
  while (Date.now() < deadline) {
    const got = await ctx.until(() => { const l = latest(); return l && l.id !== seen ? l : null; }, 6000);
    if (!got) { ctx.log('fist bot: no new round'); break; }
    let cur = latest();
    if (!cur || cur.id === seen) continue;
    seen = cur.id;
    rounds++;
    best = bestSoFar(best);
    if (best >= target) break;              // enough: let this round time out

    const useWasd = Math.random() < 0.2;
    await ctx.sleep(Math.max(150, ctx.human(cur.idx === 0 || evs()[cur.idx][0] === 'U' ? 330 : 260, 60)));
    let aborted = false;
    for (let k = 0; k < cur.arrows.length; k++) {
      if (!stillLive(cur)) { aborted = true; break; }
      // Once per run: leave the panel mid-round and come back (P, then U with new arrows).
      if (!pausedOnce && rounds === 3 && k === 1 && typeof window._onFistQteHide === 'function') {
        pausedOnce = true;
        window._onFistQteHide();
        await ctx.sleep(Math.max(400, ctx.human(900, 200)));
        if (typeof window._onFistQteShow === 'function') window._onFistQteShow();
        await ctx.sleep(Math.max(150, ctx.human(300, 80)));
        const resume = ctx.byId('fist-qte-resume-btn');
        if (resume) ctx.click(resume);
        blur();
        aborted = true;                     // the resume drew new arrows: pick them up
        break;
      }
      let d = +cur.arrows[k];
      if (Math.random() < ERR) d = (d + 1 + Math.floor(Math.random() * 3)) % 4;
      await press(d, useWasd);
      if (k < cur.arrows.length - 1) await ctx.sleep(Math.max(40, ctx.human(150, 45)));
    }
    if (aborted) continue;
    // Wait for the point (S) or the end (E) of this round.
    await ctx.until(() => { const r = ctx.run(); if (!r || r.log !== cur.log) return true; const ev = r.log.ev; for (let i = cur.idx + 1; i < ev.length; i++) if (ev[i][0] === 'S' || ev[i][0] === 'E') return true; return false; }, 8000);
    best = bestSoFar(best);
  }

  // Stop: the round in play times out; then leave so the trainer stops restarting.
  best = bestSoFar(best);
  await ctx.until(() => !!ctx.lastEv('E'), 12000);
  best = bestSoFar(best);
  if (typeof window._onFistQteHide === 'function') window._onFistQteHide();
  return { points: best };
};
