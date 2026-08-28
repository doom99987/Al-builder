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

    // `overrides` comes from the Advanced panel: explicit class / race / weapon /
    // level / goal choices that beat anything the text said.
    function ask(text, overrides) {
      const spec = Intent.applyOverrides(Intent.parse(text, data, K), overrides, data, K);
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

    // Look at a build somebody already has and say how to improve it.
    //
    // The optimised comparison keeps their CLASS and RACE by default, because
    // "your build would be better if you were a different class" is not advice
    // anyone can use. Everything else is fair game. Pass overrides to relax or
    // tighten that.
    function analyse(state, overrides) {
      const current = Share.fromState(data, state);
      const raw = overrides || {};

      // Strip empty values BEFORE merging. The Advanced panel reports unset
      // dropdowns as null, and Object.assign copies a null straight over the
      // default — which silently unlocked the player's own class and race and
      // "improved" their Lancer into a Berserker.
      const o = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v !== null && v !== undefined && v !== '' && !Number.isNaN(v)) o[k] = v;
      }

      const spec = Intent.applyOverrides(
        Intent.parse(o.text || '', data, K),
        Object.assign({
          // Keep their class and race unless they explicitly asked otherwise:
          // "your build would be better as a different class" is not advice
          // anyone can act on.
          klass: current.klass || null,
          race:  current.race  || null,
          level: current.level || null,
          // Read the build's own intent from where the points went. Optimising
          // an obvious tank as "balanced" hands back a squishier build and calls
          // it an upgrade.
          goal:  inferGoal(current),
        }, o),
        data, K);

      const currentCtx = O.evaluate(current, spec);
      let improved = null, improvedCtx = null, improvedFlavour = null,
          improvedWeaknesses = [], improvedCorruption = null;
      try {
        const run = O.run(spec);
        improved = run.build;
        improvedCtx = run.ctx;
        improvedFlavour = run.flavour || null;
        improvedWeaknesses = run.weaknesses || [];
        improvedCorruption = run.corruption || null;
        improved.corruption = run.corruption ? run.corruption.best.form : improved.corruption;
      } catch (e) { /* fall through — a current-only report is still useful */ }

      return {
        spec, current, currentCtx, improved, improvedCtx,
        improvedFlavour, improvedWeaknesses, improvedCorruption,
        // Anything they are already wearing that cannot be used in game. Worth
        // saying whether or not the rest of the analysis is useful — a build
        // planned around an item nobody can equip is not a build.
        unavailable: unavailableIn(current),
        changes: improved ? diffBuilds(current, improved) : [],
        gain: improved ? gainOf(currentCtx, improvedCtx, spec) : null,
        // The same reasoning `ask` produces, so the analysis view can show WHY
        // the improved build looks like it does rather than only what changed.
        improvedExplanation: improved
          ? Explain.render({ build: improved, ctx: improvedCtx, corruption: null, warnings: [] },
                           spec, M, K, data).filter(sec => sec.h !== 'Request' && sec.h !== 'You chose')
          : [],
      };
    }

    // Every equipped item the game does not currently allow, with the reason.
    function unavailableIn(build) {
      const found = [];
      const check = (what, name) => {
        if (!name) return;
        const why = O.unavailableReason(name);
        if (why) found.push({ what, name, why });
      };
      check('Weapon', build.weapon && build.weapon.name);
      check('Offhand', build.offhand && build.offhand.name);
      check('Armour', build.armour);
      check('Artifact', build.artifact && build.artifact.name);
      check('Enchant', build.enchant);
      (build.gear || []).forEach((g, i) => check('Gear ' + (i + 1), g && g.name));
      return found;
    }

    // Guess what a build is FOR from where its points went. Only used when the
    // player has not said, and always reported so they can override it.
    function inferGoal(build) {
      const inv = build.invested || {};
      const total = ['str','arc','end','spd','lck'].reduce((a, s) => a + (inv[s] | 0), 0);
      if (!total) return null;                       // nothing invested — let the parser decide
      const share = s => (inv[s] | 0) / total;

      if (share('end') >= 0.45) return 'tank';
      if (share('lck') >= 0.40) return 'crit';
      if (share('spd') >= 0.40) return 'speed';
      if (share('arc') >= 0.45) {
        // Arcane is both the caster and the summoner stat; the class decides.
        const kit = JSON.stringify(((data.classMoves || {})[build.klass] || {}).learns || []);
        return /summon|skeleton|raise/i.test(kit) ? 'summon' : 'damage';
      }
      if (share('str') >= 0.45) return 'damage';
      return 'balanced';
    }

    // What actually differs, in the order it matters.
    function diffBuilds(a, b) {
      const out = [];
      const push = (what, from, to) => {
        if (String(from || '—') !== String(to || '—')) out.push({ what, from: from || '—', to: to || '—' });
      };
      push('Class', a.klass, b.klass);
      push('Race', a.race, b.race);
      push('Armour', a.armour, b.armour);
      push('Weapon', a.weapon && a.weapon.name, b.weapon && b.weapon.name);
      push('Artifact', a.artifact && a.artifact.name, b.artifact && b.artifact.name);
      for (let i = 0; i < 4; i++) {
        push('Gear ' + (i + 1), (a.gear[i] || {}).name, (b.gear[i] || {}).name);
      }
      push('Enchant', a.enchant, b.enchant);
      push('Mark', a.mark, b.mark);
      push('Permuth', a.permuth && a.permuth.toUpperCase(), b.permuth && b.permuth.toUpperCase());
      push('Corruption', a.corruption, b.corruption);

      const stats = ['str', 'arc', 'end', 'spd', 'lck'];
      const fmt = inv => stats.map(s => s.toUpperCase() + ' ' + (inv[s] | 0)).join('  ');
      push('Stat points', fmt(a.invested), fmt(b.invested));

      const shardsA = (a.shards || []).join(', ');
      const shardsB = (b.shards || []).join(', ');
      push('Shards', shardsA, shardsB);

      const mA = (a.masteryNodes || []).length, mB = (b.masteryNodes || []).length;
      if (mA !== mB) out.push({ what: 'Mastery nodes', from: String(mA), to: String(mB) });

      const traitCount = x => x.gear.reduce((n, g) => n + ((g.traits || []).length), 0)
                            + ((x.artifact && x.artifact.traits) || []).length;
      const tA = traitCount(a), tB = traitCount(b);
      if (tA !== tB) out.push({ what: 'Traits fitted', from: String(tA), to: String(tB) });

      return out;
    }

    function gainOf(cur, imp, spec) {
      const pct = (from, to) => {
        if (!isFinite(from) || !isFinite(to) || from <= 0) return null;
        return Math.round(((to - from) / from) * 1000) / 10;
      };
      return {
        score:      pct(cur.score, imp.score),
        bestHit:    pct(cur.bestHit, imp.bestHit),
        hp:         pct(cur.hp, imp.hp),
        critChance: Math.round((imp.critChance - cur.critChance) * 10) / 10,
        goal: spec.goal,
      };
    }

    return { ask, analyse, link, share: Share, model: M, optimizer: O, data };
  }

  return { Engine };
}));
