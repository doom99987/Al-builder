// Page bot for the Yar'Thul trainer (yarthul-new / yarthul-new-comp): plays the
// REAL trainer so the real IIFE's log can be self-checked. It rebuilds the
// meteors and the flame's path from the run's own log ('S', 'M', 'D', 'C',
// 'B', 'Z' events and the rules in QteRules.trainers['yarthul-new']), looks at
// them ~250 ms late like a person, and dodges with held A/D taps: stay, or hold
// left/right for a planned time and let go, keeping some room and drifting back
// to the middle. Motor jitter on every key; not perfect, so it dies sooner or
// later. Once ctx.target stages are cleared it stops pressing and lets the next
// meteor end the run.
window.__qteBots = window.__qteBots || {};
window.__qteBots['yarthul-new'] = async function (ctx) {
  const R = window.QteRules.trainers['yarthul-new'];
  const K = R.K, G = R.geom;
  const comp = !!ctx.comp;
  const target = Math.max(1, ctx.target | 0);
  const deadline = Date.now() + Math.max(180000, target * 30000);
  const RT = 230;                  // how late it sees the game, ms
  const lagOf = () => (window._albPing || 0) + 45;  // key to flame: ping simulator + motor + a frame
  const HOLDS = [0.07, 0.12, 0.2, 0.3, 0.45, 0.65, 0.9];
  const MARGIN = 16;               // px of room it wants
  const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
  const KEYS = { '-1': ['a', 'KeyA'], '1': ['d', 'KeyD'] };

  try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
  ctx.click(ctx.byId('yarthul-new-qte-start-btn'));
  try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
  await ctx.until(() => { const r = ctx.run(); return r && r.log.ev.length && r.log.ev[0][0] === 'S'; }, 3000);
  const run = ctx.run();
  if (!run) { ctx.log('yarthul bot: no run'); return { points: 0 }; }

  // ── the world, from the log ──
  const st = { i: 0, W: 0, H: 0, n: 1, acc: 0, j: 0, pcs: [], ms: [], anchor: [0, 0], cleared: 0, ended: false };
  function pxAt(g) {
    let p = st.pcs[0];
    if (!p) return st.W / 2;
    for (let k = st.pcs.length - 1; k >= 0; k--) if (st.pcs[k].g <= g) { p = st.pcs[k]; break; }
    return clamp(p.x + p.dir * K.PLAYER_SPEED_FRAC * p.W * (g - p.g) / 1000, G.platLeft(p.W), G.platRight(p.W));
  }
  function sync() {
    const ev = run.log.ev;
    for (; st.i < ev.length; st.i++) {
      const e = ev[st.i];
      switch (e[0]) {
        case 'S': st.W = e[2]; st.H = e[3]; st.pcs.push({ g: 0, x: st.W / 2, dir: 0, W: st.W }); st.anchor = [e[1], 0]; break;
        case 'M': {
          st.j++;
          const gs = st.acc + st.j * R.spawnIntervalMs(st.n, comp) - e[4] / 10;
          const vy = R.fallSpeedFrac(st.n, comp) * st.H, r = st.H * K.METEOR_R_FRAC;
          st.ms.push({ gs, x0: (e[2] + 0.5) / K.U_SCALE * st.W, y0: -r * K.SPAWN_Y_R,
            vx: (((e[3] + 0.5) / K.U_SCALE) * 2 - 1) * R.driftFrac(comp) * vy, vy, r, top: G.platTop(st.H), stage: st.n });
          if (st.ms.length > 120) st.ms.splice(0, 40);
          st.anchor = [e[1], gs];
          break;
        }
        case 'D': st.pcs.push({ g: e[2], x: pxAt(e[2]), dir: e[3], W: st.W }); st.anchor = [e[1], e[2]]; break;
        case 'Z': { const x = pxAt(e[2]); st.W = e[3]; st.H = e[4]; st.pcs.push({ g: e[2], x: clamp(x, G.platLeft(st.W), G.platRight(st.W)), dir: st.pcs[st.pcs.length - 1].dir, W: st.W }); break; }
        case 'C': for (const m of st.ms) if (m.stage === st.n) m.gone = e[3]; st.n++; st.cleared = e[2]; st.anchor = [e[1], e[3]]; break;
        case 'B': st.acc = e[4]; st.j = 0; st.anchor = [e[1], e[4]]; break;
        case 'E': st.ended = true; break;
        case 'X': st.full = true; break;
      }
      if (st.pcs.length > 400) st.pcs.splice(1, 200);
    }
  }
  // game ms now: the newest timed event plus the wall time since it
  const gameNow = () => st.anchor[1] + (run.now() - st.anchor[0]);

  // ── hands ──
  let intent = 0, planEnd = 0;
  const hands = [{ t: -1e9, dir: 0 }];
  function moved(t0, t1, S) {
    let d = 0;
    for (let i = 0; i < hands.length; i++) {
      const a = Math.max(t0, hands[i].t), b = Math.min(t1, i + 1 < hands.length ? hands[i + 1].t : t1);
      if (b > a) d += hands[i].dir * S * (b - a) / 1000;
    }
    return d;
  }
  async function setDir(to) {
    if (to === intent) return;
    await ctx.sleep(Math.max(10, ctx.human(35, 15)));      // motor delay
    if (intent !== 0) ctx.key(KEYS[intent][0], KEYS[intent][1], 'up');
    if (to !== 0) {
      if (intent !== 0) await ctx.sleep(Math.max(0, ctx.human(12, 8)));
      ctx.key(KEYS[to][0], KEYS[to][1], 'down');
    }
    intent = to;
    hands.push({ t: run.now() + (window._albPing || 0), dir: to });
    if (hands.length > 60) hands.splice(0, 30);
  }

  // hold c for `hold` s from `dly` s on (until then the flame goes on as c0), then stop
  function clearance(ms, px0, c, hold, S, L, Rt, yP, top, H, c0, dly) {
    c0 = c0 || 0; dly = dly || 0;
    let best = 60;
    for (const m of ms) {
      const R0 = m.r + G.playerR(H);
      const ta = Math.max(0, (yP - R0 - 40 - m.y) / m.vy), tb = Math.min(1, (Math.min(top, yP + R0) - m.y) / m.vy);
      if (tb < ta) continue;
      for (let s = 0; s <= 10; s++) {
        const tau = ta + (tb - ta) * s / 10;
        const x = tau < dly ? clamp(px0 + c0 * S * tau, L, Rt) : clamp(clamp(px0 + c0 * S * dly, L, Rt) + c * S * Math.min(tau - dly, hold), L, Rt);
        const dx = m.x + m.vx * tau - x, dy = m.y + m.vy * tau - yP;
        const d = Math.sqrt(dx * dx + dy * dy) - R0;
        if (d < best) best = d;
      }
    }
    return best;
  }

  let best = 0;
  while (Date.now() < deadline) {
    sync();
    best = Math.max(best, st.cleared);
    // (after an 'X' the log is full and says nothing more; run.closed marks the end)
    if (st.ended || st.full || run.closed || run !== ctx.run()) break;
    if (best >= target) {                     // enough: hands off, let a meteor end it
      if (intent !== 0) await setDir(0);
      await ctx.sleep(100);
      continue;
    }
    const nowW = run.now();
    if (intent !== 0 && nowW >= planEnd) { await setDir(0); continue; }
    const rt = Math.max(150, ctx.human(RT, 40));
    const g = gameNow(), gp = g - rt;
    const W = st.W, H = st.H, S = K.PLAYER_SPEED_FRAC * W;
    const L = G.platLeft(W), Rt = G.platRight(W), yP = G.playerY(H), top = G.platTop(H);
    const lead = rt / 1000;
    const px0 = clamp(pxAt(gp) + moved(nowW - rt, nowW, S) + ctx.human(0, 3) * (Math.random() < 0.5 ? -1 : 1), L, Rt);
    const ms = [];
    for (const m of st.ms) {
      if (m.gs >= gp || (m.gone !== undefined && m.gone <= gp)) continue;
      const tt = (gp - m.gs) / 1000 + lead;
      const y = m.y0 + m.vy * tt;
      if (y >= top) continue;
      ms.push({ x: m.x0 + m.vx * tt + (Math.random() - 0.5) * 6, y, vx: m.vx, vy: m.vy, r: m.r });
    }
    const mid = (L + Rt) / 2, half = (Rt - L) / 2;
    const endCost = x => 5 * Math.abs(x - mid) / half;
    const worth = cl => (cl < MARGIN ? 2 * cl - MARGIN : Math.min(cl, MARGIN + 30));
    if (intent !== 0) {
      // a move under way: keep it unless it now runs into something
      if (clearance(ms, px0, intent, Math.max(0, (planEnd - nowW) / 1000), S, L, Rt, yP, top, H) >= 6) { await ctx.sleep(40 + Math.random() * 25); continue; }
    }
    const stay = clearance(ms, px0, 0, 0, S, L, Rt, yP, top, H);
    let bestC = 0, bestH = 0, bestV = worth(stay) - endCost(px0) + 3;
    if (!(stay >= MARGIN && Math.abs(px0 - mid) / half < 0.55)) {
      for (const c of [-1, 1]) for (const h of HOLDS) {
        const cl = clearance(ms, px0, c, h, S, L, Rt, yP, top, H, intent, lagOf() / 1000);
        const v = worth(cl) - endCost(clamp(px0 + c * S * h, L, Rt)) - h;
        if (v > bestV) { bestV = v; bestC = c; bestH = h; }
      }
    }
    if (bestC !== intent) {
      await setDir(bestC);
      if (bestC !== 0) planEnd = run.now() + Math.max(40, bestH * 1000 * (1 + 0.12 * (Math.random() * 2 - 1)));
    }
    await ctx.sleep(40 + Math.random() * 25);
  }

  // Wait for the end (a hit), then leave the panel if the run is somehow still going.
  if (intent !== 0) await setDir(0);
  await ctx.until(() => { sync(); return st.ended || run.closed; }, 60000);
  sync();
  best = Math.max(best, st.cleared);
  if (!st.ended && !run.closed && typeof window._onYarthulNewQteHide === 'function') window._onYarthulNewQteHide();
  if (intent !== 0) ctx.key(KEYS[intent][0], KEYS[intent][1], 'up');
  return { points: best };
};
