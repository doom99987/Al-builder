// Page bot for the thorian-new trainer (browser harness). Plays the REAL
// trainer through mouse events on its canvas, like a decent human: ~250 ms to
// react, ~300 ms to drag, a few px of aim error. It reads the targets from the
// run's own log (orb spawns, diamond spawns, escapes, catches) and rebuilds
// their positions with the shared rules, so it never peeks at the IIFE.
(function () {
  window.__qteBots = window.__qteBots || {};
  window.__qteBots['thorian-new'] = async function (ctx) {
    const R = QteRules.trainers['thorian-new'];
    const canvas = ctx.byId('thorian-new-qte-canvas');
    const startBtn = ctx.byId('thorian-new-qte-start-btn');
    if (!canvas || !startBtn) throw new Error('thorian-new: canvas or Start button missing');

    ctx.click(startBtn);
    await ctx.until(() => { const r = ctx.run(); return r && r.log.ev.some(e => e[0] === 'R'); }, 5000);
    const run = ctx.run();
    const comp = /-comp$/.test(run.type);

    function noise(sd) { return (Math.random() + Math.random() + Math.random() - 1.5) * sd * 2; }

    // The game as the log tells it (same rules the check replays).
    function state() {
      const ev = run.log.ev;
      let W = 0, H = 0, round = 0, score = 0, phase = 'pre', over = false, lastG = 0, lastT = 0, paused = false;
      let orbs = [], yels = [], held = null, grab = null, nO = 0, nY = 0;
      for (const e of ev) {
        const c = e[0];
        if (c === 'Z') { W = e[2]; H = e[3]; continue; }
        const g = c === 'E' ? e[3] : e[2];
        lastG = g; lastT = e[1];
        if (c === 'R') { round = e[4]; phase = 'play'; orbs = []; yels = []; held = null; }
        else if (c === 'O') orbs.push({ k: nO++, x: R.colX(W, e[4]), y0: R.spawnY(H), v: R.orbSpeed(round, comp) * e[6], o: e[2] - e[3], purple: e[5] === 1 });
        else if (c === 'Y') yels.push({ j: nY++, x: R.colX(W, e[4]), y: e[5], life: e[6] * 1000, o: e[2] - e[3], hAcc: 0 });
        else if (c === 'X') orbs = orbs.filter(o => o.k !== e[3]);
        else if (c === 'V') yels = yels.filter(y => y.j !== e[3]);
        else if (c === 'G') { held = yels.find(y => y.j === e[3]) || null; grab = { px: e[4], py: e[5], g }; if (held) held.from = g; }
        else if (c === 'L' || c === 'D') {
          if (held) { held.x = e[3]; held.y = e[4]; held.hAcc += g - held.from; }
          if (c === 'L' && e[5] >= 0) { orbs = orbs.filter(o => o.k !== e[5]); yels = yels.filter(y => y !== held); }
          held = null;
        }
        else if (c === 'C') { score = e[4]; phase = 'trans'; }
        else if (c === 'P') paused = true;
        else if (c === 'U') paused = false;
        else if (c === 'E') over = true;
      }
      // game time now ~ last logged game time + wall time since (60 fps, no drops)
      const gNow = paused ? lastG : lastG + Math.max(0, run.now() - lastT);
      return { W, H, round, score, phase, over, paused, orbs, yels, held, grab, gNow };
    }
    function orbY(o, g) { return o.y0 - o.v * (g - o.o) / 1000; }
    function toClient(x, y) {
      const rect = canvas.getBoundingClientRect();
      return [rect.left + x * rect.width / canvas.width, rect.top + y * rect.height / canvas.height];
    }
    function mouse(type, x, y) { const [cx, cy] = toClient(x, y); ctx.mouse(type, cx, cy, canvas); }

    let px = 0, py = 0;
    const deadline = Date.now() + Math.max(120000, (ctx.target + 3) * 20000);
    while (Date.now() < deadline) {
      const s = state();
      if (s.over) break;
      if (s.score >= ctx.target) {
        // Enough: stop playing and let the orbs end the run.
        await ctx.until(() => state().over, 60000);
        break;
      }
      if (s.phase !== 'play' || s.paused) { await ctx.sleep(40); continue; }

      if (!s.held) {
        // grab the nearest diamond that will still be there
        let best = null, bd = 1e9;
        for (const y of s.yels) {
          const left = y.life - (s.gNow - y.o - y.hAcc);
          if (left < 700) continue;
          const d = Math.hypot(y.x - px, y.y - py);
          if (d < bd) { bd = d; best = y; }
        }
        if (!best) { await ctx.sleep(30); continue; }
        await ctx.sleep(ctx.human(250, 50));
        const s2 = state();
        const y = s2.yels.find(q => q.j === best.j);
        if (!y || s2.held || s2.phase !== 'play') continue;
        px = y.x + noise(4); py = y.y + noise(4);
        mouse('mousemove', px, py);
        mouse('mousedown', px, py);
        await ctx.sleep(15);
        continue;
      }

      // holding: drop it on the purple orb that will leave soonest but can still be reached
      const g0 = s.gNow, plan = ctx.human(320, 60);
      let target = null, soonest = 1e9;
      for (const o of s.orbs) {
        if (!o.purple) continue;
        const escAt = o.o + (o.y0 - R.ESC_Y) / o.v * 1000;
        if (escAt - g0 < plan + 250) continue;
        if (escAt < soonest) { soonest = escAt; target = o; }
      }
      if (!target) { await ctx.sleep(30); continue; }
      const ox = s.grab.px - s.held.x, oy = s.grab.py - s.held.y;   // pointer - diamond at the grab
      const sx = s.held.x, sy = s.held.y, steps = 5;
      for (let i = 1; i <= steps; i++) {
        await ctx.sleep(plan / steps);
        const g = state().gNow;
        const ty = orbY(target, g + (steps - i) * plan / steps);
        const f = i / steps;
        const dx = sx + (target.x + (i === steps ? noise(6) : 0) - sx) * f;
        const dy = sy + (ty + (i === steps ? noise(6) : 0) - sy) * f;
        px = dx + ox; py = dy + oy;
        mouse('mousemove', px, py);
      }
      // don't drop onto a red that got in the way (a person would pull back)
      const s3 = state();
      const hx = Math.max(R.PLAYER_R, Math.min(s3.W - R.PLAYER_R, px - ox)), hy = Math.max(R.PLAYER_R, Math.min(s3.H - R.PLAYER_R, py - oy));
      let first = null;
      for (const o of s3.orbs) if (Math.hypot(o.x - hx, orbY(o, s3.gNow) - hy) < R.DROP_R) { first = o; break; }
      if (first && !first.purple) { await ctx.sleep(60); continue; }
      mouse('mouseup', px, py);
      await ctx.sleep(ctx.human(120, 40));
    }
    const fin = state();
    ctx.log('thorian-new bot: ' + fin.score + ' rounds, ended=' + fin.over);
    return { points: fin.score };
  };
})();
