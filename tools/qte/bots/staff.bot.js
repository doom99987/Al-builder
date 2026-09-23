// Page bot for the staff trainer: plays the real IIFE like a decent human so
// the run's own log can be self-checked. Reads each round's runes from the
// log ('R' events), drags every bank tile to a slot with the same rune.
window.__qteBots = window.__qteBots || {};
window.__qteBots['staff'] = async function (ctx) {
  var canvas = ctx.byId('staff-qte-canvas');
  var startBtn = ctx.byId('staff-qte-start-btn');
  if (!canvas || !startBtn) throw new Error('staff trainer not on the page');
  var R = window.QteRules.trainers['staff'];

  ctx.click(startBtn);
  await ctx.until(function () { return ctx.run() && ctx.lastEv('R'); }, 5000);

  // Same geometry as the trainer's resizeCanvas / rowPositions, in client px.
  function geom(len) {
    var rect = canvas.getBoundingClientRect();
    var CW = canvas.width, CH = canvas.height, scale = CW / 520;
    var TW = Math.round(46 * scale), BANK_Y = Math.round(32 * scale), SLOT_Y = Math.round(210 * scale);
    var x0 = (CW - (len * TW + (len - 1) * 8)) / 2;
    function at(i, y, jx, jy) {
      var cx = x0 + i * (TW + 8) + TW / 2 + jx * TW, cy = y + TW / 2 + jy * TW;
      return { x: rect.left + cx * rect.width / CW, y: rect.top + cy * rect.height / CH };
    }
    return {
      bank: function (i, jx, jy) { return at(i, BANK_Y, jx, jy); },
      slot: function (i, jx, jy) { return at(i, SLOT_Y, jx, jy); },
    };
  }
  function jit() { return (Math.random() - 0.5) * 0.5; }   // up to a quarter tile off centre
  function key(run, r) { return run.attempt + ':' + r[1] + ':' + r[4]; }
  // The round we are playing is still live: no newer round and no end after it.
  function live(k) {
    var run = ctx.run(), r = ctx.lastEv('R'), e = ctx.lastEv('E');
    return run && r && key(run, r) === k && !(e && e[1] >= r[1] && run.log.ev.indexOf(e) > run.log.ev.indexOf(r));
  }

  var points = 0, lastKey = null, stopAt = Date.now() + 15 * 60 * 1000;
  while (points < ctx.target && Date.now() < stopAt) {
    var r = null;
    await ctx.until(function () { var run = ctx.run(); r = ctx.lastEv('R'); return run && r && key(run, r) !== lastKey; }, 20000);
    var run = ctx.run();
    var k = lastKey = key(run, r);
    var pat = r[4], bank = r[5], len = pat.length, g = geom(len), used = [];
    // pace to the round: a relaxed human when there is time, quicker when not
    var per = Math.max(300, Math.min(560, (r[6] * 0.8 - 300) / len));
    var back = per * 0.57, drag = per * 0.43;
    for (var s = 0; s < len && live(k); s++) {
      var tile = -1;
      for (var i = 0; i < len; i++) if (!used[i] && bank[i] === pat[s]) { tile = i; break; }
      used[tile] = true;
      await ctx.sleep(s === 0 ? ctx.human(260, 45) : ctx.human(back, back * 0.18));
      if (!live(k)) break;
      var a = g.bank(tile, jit(), jit()), b = g.slot(s, jit(), jit());
      ctx.mouse('mousedown', a.x, a.y, canvas);
      var d = Math.max(90, ctx.human(drag, drag * 0.2));
      for (var m = 1; m <= 3; m++) {
        await ctx.sleep(d / 4);
        ctx.mouse('mousemove', a.x + (b.x - a.x) * m / 4, a.y + (b.y - a.y) * m / 4, canvas);
      }
      await ctx.sleep(d / 4);
      ctx.mouse('mouseup', b.x, b.y, canvas);
    }
    // cleared: the next round comes at streak + 1; timed out: an E, then a restart at 0
    await ctx.until(function () { var run2 = ctx.run(), r2 = ctx.lastEv('R'); return !live(k) || (run2 && r2 && key(run2, r2) !== k); }, 12000);
    await ctx.until(function () { var run2 = ctx.run(), r2 = ctx.lastEv('R'); return run2 && r2 && key(run2, r2) !== k; }, 12000);
    var nr = ctx.lastEv('R');
    points = nr && nr[2] === 1 ? Math.max(points, nr[3]) : points;
    ctx.log('staff bot: round at streak ' + r[3] + ' -> next round cause ' + (nr && nr[2]) + ', points ' + points);
  }
  // Stop pressing and let the round run out.
  // (After a timeout the trainer starts a new attempt, with a new log, 900 ms later.)
  var endRound = ctx.lastEv('R'), a0 = ctx.run().attempt;
  try {
    await ctx.until(function () {
      var e = ctx.lastEv('E');
      return ctx.run().attempt !== a0 || (e && endRound && e[1] >= endRound[1]);
    }, 15000);
  } catch (err) {}
  return { points: points };
};
