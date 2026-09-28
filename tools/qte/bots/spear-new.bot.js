// Page bot for the spear-new trainer (browser harness). Plays the REAL
// trainer through pointer events on its canvas, like a steady human: ~220 ms
// per target (~350 for a round's first), a few px of aim error, and a slider
// followed with a small wobble. It reads the targets from the run's own log
// ('T' events) and rebuilds each slider's path with the shared rules, and the
// ball's progress from the log's game times, so it never peeks at the IIFE.
// Past ctx.target rounds it stops playing and lets the round timer end the run.
(function () {
  window.__qteBots = window.__qteBots || {};
  window.__qteBots['spear-new'] = async function (ctx) {
    const R = QteRules.trainers['spear-new'];
    const canvas = ctx.byId('spear-new-qte-canvas');
    const startBtn = ctx.byId('spear-new-qte-start-btn');
    if (!canvas || !startBtn) throw new Error('spear-new: canvas or Start button missing');

    const before = ctx.run();
    ctx.click(startBtn);
    await ctx.until(() => { const r = ctx.run(); return r && r !== before && r.log.ev.length > 0; }, 5000);
    const run = ctx.run();
    const comp = /-comp$/.test(run.type), mob = !!run.log.env.mob;

    // The game as the log tells it (the same rules the check replays).
    function state() {
      let W = 0, H = 0, s = 0, score = 0, over = false, phase = 'gap', tgs = [], active = 0, held = false, gP = 0, sync = null;
      for (const e of run.log.ev) {
        switch (e[0]) {
          case 'Z': W = e[2]; H = e[3]; break;
          case 'R': s = e[4]; tgs = []; active = 0; held = false; phase = 'play'; break;
          case 'T': tgs.push(e[2] === 1 ? { kind: 1, x: e[3], y: e[4], ex: e[5], ey: e[6], o1: e[7], o2: e[8] } : { kind: 0, x: e[3], y: e[4] }); break;
          case 'K': if (tgs[e[3]] && tgs[e[3]].kind === 0) active++; else { held = true; gP = e[2]; sync = { g: e[2], t: e[1] }; } break;
          case 'M': sync = { g: e[2], t: e[1] }; break;
          case 'F': held = false; active++; break;
          case 'C': score = e[3]; phase = 'gap'; break;
          case 'P': held = false; break;
          case 'E': over = true; break;
        }
      }
      return { W, H, s, score, over, phase, tgs, active, held, gP, sync, r: R.radius(W, H, mob) };
    }
    function noise(sd) { return (Math.random() + Math.random() + Math.random() - 1.5) * sd * 2; }
    function mouse(type, x, y) {
      const rc = canvas.getBoundingClientRect();
      ctx.mouse(type, rc.left + x * rc.width / canvas.width, rc.top + y * rc.height / canvas.height, canvas);
    }

    const deadline = Date.now() + Math.max(120000, (ctx.target + 3) * 15000);
    while (Date.now() < deadline) {
      const s = state();
      if (s.over || run.closed) break;
      if (s.score >= ctx.target) { await ctx.until(() => state().over || run.closed, 30000); break; }
      if (s.phase !== 'play' || !s.tgs.length || s.active >= s.tgs.length) { await ctx.sleep(20); continue; }
      const k = s.active, tg = s.tgs[k];
      await ctx.sleep(ctx.human(k === 0 ? 350 : 220, 40));
      const s2 = state();
      if (s2.over || s2.phase !== 'play' || s2.active !== k) continue;
      let x = tg.x + noise(s2.r * 0.15), y = tg.y + noise(s2.r * 0.15);
      mouse('pointermove', x, y);
      mouse('pointerdown', x, y);
      await ctx.sleep(4);
      if (tg.kind === 0) { await ctx.sleep(ctx.human(60, 15)); mouse('pointerup', x, y); continue; }
      // follow the ball: its game time is the last logged sample's, plus the time since
      const path = R.path(tg), trav = R.travMs(s2.s, comp);
      for (;;) {
        const s3 = state();
        if (s3.over || !s3.held) break;          // done ('F'), broken, or the press missed
        const el = (s3.sync.g - s3.gP) + (run.now() - s3.sync.t) + 8;   // ~the next frame
        const b = R.ballAt(path, el / trav);
        x = b.x + noise(2); y = b.y + noise(2);
        mouse('pointermove', x, y);
        await ctx.sleep(8);
      }
      await ctx.sleep(ctx.human(60, 20));
      mouse('pointerup', x, y);
    }
    const fin = state();
    ctx.log('spear-new bot: ' + fin.score + ' rounds, ended=' + fin.over);
    return { points: fin.score };
  };
})();
