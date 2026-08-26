/*
  The orchestrator.

      const engine = Engine(data);
      const result = engine.ask('max damage crit lancer');

  Wires the layers together and guarantees the top-level contract: ask() always
  returns a complete answer. If the optimiser throws, the fallback build is
  returned with the error attached rather than propagating — a user asking for a
  build should never see a stack trace.
*/
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./model.js'), require('./knowledge.js'),
      require('./intent.js'), require('./optimize.js'), require('./explain.js'),
      require('./share.js'));
  } else {
    root.ALB_Engine = factory(root.ALB_Model, root.ALB_Knowledge,
                              root.ALB_Intent, root.ALB_Optimize, root.ALB_Explain,
                              root.ALB_Share);
  }
}(typeof self !== 'undefined' ? self : this, function (ModelMod, K, Intent, Opt, Explain, Share) {

  function Engine(data) {
    const M = ModelMod.Model(data);

    // Knowledge registers itself into the maths. model.js has no idea any of
    // these items exist, which is what keeps the two layers separable.
    for (const q of K.QUIRKS) {
      if (typeof M.register[q.hook] === 'function') M.register[q.hook](q.apply);
    }

    const O = Opt.Optimizer(M, K);

    function ask(text) {
      const spec = Intent.parse(text, data, K);
      let result;
      try {
        result = O.run(spec);
      } catch (err) {
        // Degrade rather than fail: hand back a plain proportional build so the
        // caller still gets an answer, and say what went wrong.
        const b = M.emptyBuild();
        b.level = spec.level;
        b.race = spec.race || Object.keys(data.races)[0];
        b.klass = spec.klass || Object.keys(data.classMoves)[0];
        const w = O.weightOf(spec);
        const budget = M.pointBudget(b);
        const wsum = Object.values(w).reduce((a, v) => a + v, 0) || 1;
        for (const s of ModelMod.STATS) b.invested[s] = Math.floor(budget * (w[s] || 0) / wsum);
        result = { build: b, ctx: O.evaluate(b, spec), corruption: null, error: String(err && err.message || err) };
      }

      const warnings = K.TRAPS
        .filter(t => { try { return t.when(result.build, M, result.ctx); } catch { return false; } })
        .map(t => ({ name: t.name, text: t.warn }));

      return Object.assign({ spec, warnings, model: M }, result, {
        explanation: Explain.render(result, spec, M, K, data),
      });
    }

    // A shareable arcanelineagebuilder.com URL for a build. Async because the
    // bz_ container is deflate-compressed. Returns null rather than throwing if
    // compression is unavailable — a missing link should not lose the build.
    function link(build, opts) {
      if (!Share) return Promise.resolve(null);
      return Share.link(data, build, Object.assign({ name: 'Build AI' }, opts || {}))
                  .catch(() => null);
    }

    return { ask, link, share: Share, model: M, optimizer: O, data };
  }

  return { Engine };
}));
