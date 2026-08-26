/*
  The search.

  The space is far too large to enumerate — 80 gears choose 4 is 1.5 million
  before tier rolls, times 19 races, times 30 classes. It is tractable because
  almost all of it is SEPARABLE: a gear granting +3 Luck is worth the same
  whatever else is equipped, so it can be ranked in closed form instead of
  searched. Only the quirky items — procs, conditionals, threshold effects —
  need full evaluation.

  So the strategy is: rank analytically, then search a shortlist properly.

    1. shortlist classes and races from the request
    2. rank every gear / armour / weapon / artifact by the goal's stat weights
    3. beam-search the shortlist with the real scorer
    4. coordinate-ascent the stat allocation, snapping to crit thresholds
    5. pick tier shapes, then enchant / mark / shards / corruption

  Crit thresholds are the one place a smooth optimiser reliably fails. Crossing
  100 / 200 / 300 crit chance is a STEP — it both guarantees the crit and raises
  the multiplier a whole tier — so hill climbing walks straight past it and parks
  a build at 99%. Step 4 explicitly tries landing on each threshold.
*/
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ALB_Optimize = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  const STATS = ['str', 'arc', 'end', 'spd', 'lck'];

  function Optimizer(M, K) {
    const D = M.data;

    // ── move handling ────────────────────────────────────────────────────────
    // A class's kit is its own moves plus its base class's, since a superclass
    // keeps what it learned on the way up.
    function baseOf(klass) {
      for (const [base, supers] of Object.entries(D.classes || {}))
        if (base === klass || (supers || []).includes(klass)) return base;
      return null;
    }
    function movesFor(klass) {
      const out = [];
      const seen = new Set();
      const add = k => {
        const entry = (D.classMoves || {})[k];
        if (!entry) return;
        for (const mv of (entry.learns || [])) {
          if (mv.type !== 'Active' || mv.damage === undefined) continue;
          if (seen.has(mv.name)) continue;
          seen.add(mv.name);
          out.push(mv);
        }
      };
      add(klass);
      const b = baseOf(klass);
      if (b && b !== klass) add(b);
      return out;
    }

    // Bard, Beastmaster, Alchemist, Blacksmith and Miner live in classMoves but
    // are SUBclasses — secondary professions, not combat classes. Picking one as
    // your main class is not a thing the game allows, so they are excluded from
    // the search while remaining available if a request names one outright.
    function combatClasses() {
      const tree = D.classes || {};
      return [...Object.keys(tree), ...Object.values(tree).flat()]
        .filter(k => (D.classMoves || {})[k]);
    }

    // No table says which class uses which weapon, so infer it: a class that
    // trains a weapon says so in its passives ("Spear Training", "+10% spear
    // damage"). If nothing matches, every class stays in play — narrowing to an
    // empty list would be worse than not narrowing at all.
    function classesUsingWeapon(type) {
      if (!type) return null;
      // Overrides first: if any class is declared as using this weapon, those are
      // the answer. Inference only fills the gap for types nobody declared.
      const declared = combatClasses().filter(k => ((K.CLASS_WEAPONS || {})[k] || []).includes(type));
      if (declared.length) return declared;

      const hits = combatClasses().filter(k => {
        const types = weaponTypesForClass(k);
        return types && types.includes(type);
      });
      return hits.length ? hits : null;
    }

    // Which weapon types a class can plausibly use. The data does not state this
    // per class, so it is inferred from the weapons its moves mention, then
    // widened to "anything" rather than guessing wrong and excluding the answer.
    // Weapon types a class actually trains, read from its kit text ("Spear
    // Training", "+10% spear damage"). Without this a Lancer was handed an Ivory
    // Sword purely because the sword had a better crit bonus.
    const _wtCache = {};
    function weaponTypesForClass(klass) {
      if (!klass) return null;
      if (_wtCache[klass] !== undefined) return _wtCache[klass];
      // An explicit override always wins over inference.
      if ((K.CLASS_WEAPONS || {})[klass]) return (_wtCache[klass] = K.CLASS_WEAPONS[klass]);
      const entry = (D.classMoves || {})[klass] || {};
      let text = JSON.stringify(entry.innatePassives || []) + JSON.stringify(entry.learns || []);
      const b = baseOf(klass);
      if (b && b !== klass) {
        const be = (D.classMoves || {})[b] || {};
        text += JSON.stringify(be.innatePassives || []) + JSON.stringify(be.learns || []);
      }
      text = text.toLowerCase();
      // Match against the SYNONYMS, not the bare type name. Wizard's passive says
      // "Staves", Martial Artist's says "Cestus" — neither contains the literal
      // type word, so both were falling through to "any weapon".
      const types = [...new Set(Object.values(D.weapons || {}).map(w => w.type))].filter(t => {
        if (!t) return false;
        const words = (K.VOCAB.weapon[t] || []).concat([t.toLowerCase()]);
        return words.some(w => new RegExp('\\b' + w.toLowerCase() + 's?\\b').test(text));
      });
      return (_wtCache[klass] = types.length ? types : null);
    }

    function weaponsFor(spec, klass) {
      const all = Object.keys(D.weapons || {});
      if (spec.weaponName) return [spec.weaponName];

      const wanted = spec.weaponType ? [spec.weaponType] : weaponTypesForClass(klass);
      if (wanted) {
        const filtered = all.filter(n => wanted.includes((D.weapons[n] || {}).type));
        if (filtered.length) return filtered;
      }
      return all;   // never narrow to nothing — an unfiltered choice beats no choice
    }

    // ── evaluation ───────────────────────────────────────────────────────────
    // One place turns a build into a score. Everything else just proposes builds.
    function evaluate(build, spec) {
      const d = M.derived(build);
      const moves = movesFor(build.klass || spec.klass || '');

      // Trait overlay. The site does not compute these, so they live on top of
      // the verified base rather than inside it.
      const tt = M.traitTotals(build, K);
      const cap = M.energyCap(build, K);
      const pv = passiveTotals(build);

      const critChance = d.critChance + tt.critChance + pv.critChance;
      const critDmg    = d.critDmg * (1 + tt.critDmgPct / 100);
      const mult = M.expectedMultiplier(critChance, critDmg);

      let bestHit = 0, bestMove = null;
      for (const mv of moves) {
        let dmg = M.moveDamage(build, mv);
        let pct = tt.dmgPct + pv.dmgPct;

        // Passives gated on a move type — Nisse's +15% Fire and Magic, Vastayan's
        // Affinity Boost — only pay on moves of that type.
        for (const mt of pv.byMoveType) {
          if (mt.when.test(String(mv.moveType || '') + ' ' + String(mv.element || ''))) pct += mt.value;
        }

        // heavyHand only pays on skills costing 2+ energy; strip it otherwise.
        // Cost may be written "3+X", so parse rather than coerce.
        if (M.parseCost(mv.cost) < 2) {
          const hh = tt.active.find(a => a.id === 'heavyHand');
          if (hh) pct -= hh.effective;
        }
        dmg *= (1 + pct / 100);

        // Moves that consume the whole energy pool scale with the CAP, which is
        // why Overflow is worth far more to them than "+1 max energy" sounds.
        const es = (K.ENERGY.scalingMoves || {})[mv.name];
        if (es) dmg *= (1 + es.perEnergy * Math.max(0, cap - es.freeEnergy));

        dmg *= mult;
        if (dmg > bestHit) { bestHit = dmg; bestMove = mv; }
      }
      const ctx = {
        stats: d.stats, hp: d.hp * (1 + tt.hpPct / 100), critChance,
        critTier: M.critTier(critChance), critDmg,
        blockDr: d.blockDr + tt.dr, outHeal: d.outHeal, incHeal: d.incHeal,
        initiative: d.initiative + tt.initiative,
        bestHit, bestMove, moves, goal: spec.goal,
        traits: tt, energyCap: cap,
        passives: pv, passiveList: passivesFor(build),
        siteHp: d.hp, siteCritChance: d.critChance,   // what the site will show
      };
      const arch = K.ARCHETYPES[spec.goal] || K.ARCHETYPES[K.DEFAULT_GOAL];
      ctx.score = arch.score(ctx);
      return ctx;
    }

    // ── analytic ranking ─────────────────────────────────────────────────────
    // Value an item by the goal's stat weights. Cheap, and good enough to build
    // a shortlist that the real scorer then sorts out properly.
    function weightOf(spec) {
      const arch = K.ARCHETYPES[spec.goal] || K.ARCHETYPES[K.DEFAULT_GOAL];
      const w = Object.assign({}, arch.statWeights);
      // An explicit stat request outranks the archetype's default direction.
      for (const s of spec.statFocus || []) w[s] = (w[s] || 0) + 6;
      return w;
    }

    const statValue = (block, w) => STATS.reduce((a, s) => a + (block[s] || 0) * (w[s] || 0), 0);

    function rankGear(spec, w) {
      const fixed = new Set(D.FIXED_GEAR || []);
      return Object.entries(D.gearItems).map(([name, block]) => {
        let v = statValue(block, w);
        // A tiered gear also brings its tier points, which land on whatever stat
        // the build wants most — worth the top shape value times the best weight.
        if (!fixed.has(name)) v += 9 * Math.max(...STATS.map(s => w[s] || 0));
        if ((D.gearPctBonuses || {})[name]) v += 4;   // percentage bonuses are real but unmodelled here
        return { name, v, block };
      }).sort((a, b) => b.v - a.v);
    }

    // ── stat allocation ──────────────────────────────────────────────────────
    // Coordinate ascent: repeatedly move a chunk of points from the stat that
    // loses least to the stat that gains most, shrinking the chunk as it settles.
    // Multiple chunk sizes stand in for restarts and keep it out of shallow local
    // maxima without the cost of a real multi-start.
    function allocateStats(build, spec) {
      const budget = M.pointBudget(build);
      const w = weightOf(spec);

      // Seed proportionally to the goal's weights — a good start beats a cold one.
      const wsum = STATS.reduce((a, s) => a + (w[s] || 0), 0) || 1;
      const inv = {};
      let used = 0;
      for (const s of STATS) { inv[s] = Math.floor(budget * (w[s] || 0) / wsum); used += inv[s]; }
      inv[STATS.reduce((a, b) => (w[a] || 0) >= (w[b] || 0) ? a : b)] += budget - used;
      build.invested = inv;

      let best = evaluate(build, spec).score;
      for (const step of [16, 8, 4, 2, 1]) {
        let moved = true;
        let guard = 0;
        while (moved && guard++ < 200) {
          moved = false;
          for (const from of STATS) {
            for (const to of STATS) {
              if (from === to) continue;
              // Re-check INSIDE the loop. Checking once before it let several
              // successful moves in a row drive the donor negative, which
              // invented stat points out of nothing.
              if (build.invested[from] < step) break;
              build.invested[from] -= step; build.invested[to] += step;
              const sc = evaluate(build, spec).score;
              if (sc > best + 1e-9) { best = sc; moved = true; }
              else { build.invested[from] += step; build.invested[to] -= step; }
            }
          }
        }
      }

      // Crit thresholds. Try spending spare points to land exactly on 100 / 200 /
      // 300 crit chance; keep it only if the real scorer agrees it is better.
      const snapshot = Object.assign({}, build.invested);
      for (const target of [100, 200, 300]) {
        const cur = evaluate(build, spec);
        if (cur.critChance >= target) continue;
        const need = Math.ceil(target - cur.critChance);
        // Luck is crit chance 1:1 before multipliers, so `need` is an upper bound.
        for (const donor of STATS.filter(s => s !== 'lck').sort((a, b) => build.invested[b] - build.invested[a])) {
          const take = Math.min(need, Math.max(0, build.invested[donor]));
          if (!take) continue;
          build.invested[donor] -= take; build.invested.lck += take;
          const sc = evaluate(build, spec);
          if (sc.score > best + 1e-9) { best = sc.score; Object.assign(snapshot, build.invested); }
          else { build.invested[donor] += take; build.invested.lck -= take; }
          break;
        }
      }
      build.invested = snapshot;
      return best;
    }

    // ── tier shapes ──────────────────────────────────────────────────────────
    // Try every legal shape for a slot and keep whichever scores best. Shapes are
    // few (at most three per tier), so this is exhaustive and exact.
    function bestTierAlloc(build, spec, slotRef, isWeapon) {
      const tier = isWeapon ? D.MAX_WEAPON_TIER : D.MAX_GEAR_TIER;
      const shapes = M.shapesFor(tier, isWeapon);
      const w = weightOf(spec);
      const order = STATS.slice().sort((a, b) => (w[b] || 0) - (w[a] || 0));
      let best = null, bestScore = -Infinity;
      for (const shape of shapes) {
        slotRef.tier = tier;
        slotRef.alloc = M.allocForShape(shape, order);
        const sc = evaluate(build, spec).score;
        if (sc > bestScore) { bestScore = sc; best = { tier, alloc: Object.assign({}, slotRef.alloc) }; }
      }
      slotRef.tier = best.tier; slotRef.alloc = best.alloc;
      return bestScore;
    }

    // Try every option for a single slot, keeping the best. Used for armour,
    // weapon, artifact, enchant — small lists where exhaustive is affordable.
    function bestOfSlot(build, spec, options, set) {
      let bestVal = null, bestScore = -Infinity;
      for (const opt of options) {
        set(build, opt);
        const sc = evaluate(build, spec).score;
        if (sc > bestScore) { bestScore = sc; bestVal = opt; }
      }
      set(build, bestVal);
      return bestVal;
    }

    // ── the pipeline ─────────────────────────────────────────────────────────
    function buildFor(klass, race, spec) {
      const b = M.emptyBuild();
      b.level = spec.level;
      b.race = race;
      b.klass = klass;

      const w = weightOf(spec);
      const order = STATS.slice().sort((a, b2) => (w[b2] || 0) - (w[a] || 0));

      // Gear: shortlist analytically, then pick four greedily with the real
      // scorer — greedy is safe here because gear contributions barely interact.
      const shortlist = rankGear(spec, w).slice(0, 14);
      b.gear = [];
      for (let slot = 0; slot < 4; slot++) {
        let bestName = null, bestScore = -Infinity, bestAlloc = null;
        for (const cand of shortlist) {
          if (b.gear.some(g => g.name === cand.name)) continue;
          const entry = { name: cand.name, tier: D.MAX_GEAR_TIER, alloc: {} };
          b.gear.push(entry);
          bestTierAlloc(b, spec, entry, false);
          const sc = evaluate(b, spec).score;
          if (sc > bestScore) { bestScore = sc; bestName = cand.name; bestAlloc = Object.assign({}, entry.alloc); }
          b.gear.pop();
        }
        if (bestName) b.gear.push({ name: bestName, tier: D.MAX_GEAR_TIER, alloc: bestAlloc });
      }

      bestOfSlot(b, spec, Object.keys(D.armourItems), (bb, v) => { bb.armour = v; });

      const wepOpts = weaponsFor(spec, klass);
      bestOfSlot(b, spec, wepOpts, (bb, v) => {
        bb.weapon = v ? { name: v, tier: D.MAX_WEAPON_TIER, alloc: {} } : null;
      });
      if (b.weapon) bestTierAlloc(b, spec, b.weapon, true);

      bestOfSlot(b, spec, Object.keys(D.artifactItems), (bb, v) => {
        bb.artifact = v ? { name: v, tier: D.MAX_GEAR_TIER, alloc: {} } : null;
      });
      if (b.artifact) bestTierAlloc(b, spec, b.artifact, false);

      // Permuth multiplies one finished stat total by 1.4 — always worth taking,
      // and it belongs on whichever stat the build actually leans on.
      b.mark = 'Venia';
      bestOfSlot(b, spec, order.slice(0, 3), (bb, v) => { bb.permuth = v; });

      bestOfSlot(b, spec, ['', ...Object.keys(D.enchantItems)], (bb, v) => { bb.enchant = v; });

      allocateStats(b, spec);

      pickTraits(b, spec);

      // Re-pick Permuth and tier shapes now that the stats are settled: the right
      // answer to both changes once the build's actual totals are known.
      bestOfSlot(b, spec, order.slice(0, 3), (bb, v) => { bb.permuth = v; });
      for (const g of b.gear) bestTierAlloc(b, spec, g, false);
      if (b.artifact) bestTierAlloc(b, spec, b.artifact, false);
      if (b.weapon)   bestTierAlloc(b, spec, b.weapon, true);

      return b;
    }

    // Every passive the build actually has, read from the game data, split into
    // the ones knowledge.js can score and the ones it cannot. The second list is
    // reported with the build — an honest "here is what these numbers ignore",
    // and the to-do list for extending PASSIVES.
    const _passCache = {};
    function passivesFor(build) {
      const key = (build.race || '') + '|' + (build.klass || '');
      if (_passCache[key]) return _passCache[key];

      const known = [];
      const unknown = [];
      const table = K.PASSIVES || {};

      const scan = (source, owner) => {
        if (!source) return;
        const list = [...(source.innatePassives || []),
                      ...(source.learns || []).filter(m => m.type === 'Passive')];
        for (const p of list) {
          if (!p || !p.name) continue;
          const entry = (table[owner] || []).find(e => e.name === p.name);
          if (entry) known.push(Object.assign({ owner }, entry));
          else unknown.push({ owner, name: p.name, effect: (p.effect || '').replace(/\s+/g, ' ').slice(0, 120) });
        }
      };

      scan((D.raceMoves || {})[build.race], build.race);
      scan((D.classMoves || {})[build.klass], build.klass);
      const base = baseOf(build.klass);
      if (base && base !== build.klass) scan((D.classMoves || {})[base], base);

      return (_passCache[key] = { known, unknown });
    }

    // Aggregate the scoreable passives into the same shape traits use.
    function passiveTotals(build) {
      const { known } = passivesFor(build);
      const out = { dmgPct: 0, critChance: 0, summonHpPct: 0, summonDmgPct: 0, byMoveType: [] };
      const wepType = build.weapon ? ((D.weapons || {})[build.weapon.name] || {}).type : null;
      for (const p of known) {
        // A weapon-training passive pays nothing without that weapon equipped.
        if (p.whenWeapon && p.whenWeapon !== wepType) continue;
        const v = p.value * (p.uptime ?? 1);
        if (p.kind === 'dmgPct') {
          // A passive limited to a move type only pays on matching moves, so it
          // is held aside rather than added to the flat total.
          if (p.when) out.byMoveType.push({ when: p.when, value: v });
          else out.dmgPct += v;
        } else if (out[p.kind] !== undefined) out[p.kind] += v;
      }
      return out;
    }

    // Fill every trait slot greedily with the real scorer. Two slots per gear and
    // two on the artifact — ten copies, matching the changelog's ceiling. Traits
    // are always taken at T2 because that is simply the better roll.
    //
    // Greedy is the right shape here despite `cap` and `noStack` making copies
    // interact: both only ever REDUCE the value of a duplicate, so a trait that
    // scored best while empty cannot become a trap once taken — and re-scoring
    // each slot against the live build means the caps are seen as they fill.
    function pickTraits(build, spec) {
      const defs = D.gearTraits || {};
      const ids = Object.keys(defs);
      const SLOTS = 2;                     // TRAIT_SLOTS_UNLOCKED

      const slots = [];
      for (const g of build.gear || []) { g.traits = []; slots.push({ ref: g, artifact: false }); }
      if (build.artifact) { build.artifact.traits = []; slots.push({ ref: build.artifact, artifact: true }); }

      for (let i = 0; i < SLOTS; i++) {
        for (const s of slots) {
          let bestId = null, bestScore = evaluate(build, spec).score;
          for (const id of ids) {
            if (s.artifact && defs[id].gearOnly) continue;   // cannot roll there
            s.ref.traits.push({ id, tier: 2 });
            const sc = evaluate(build, spec).score;
            s.ref.traits.pop();
            if (sc > bestScore + 1e-9) { bestScore = sc; bestId = id; }
          }
          if (bestId) s.ref.traits.push({ id: bestId, tier: 2 });
        }
      }
    }

    // How well a class's kit reads like the requested archetype. Counts distinct
    // keyword hits in the class's move and passive text — crude, but it is only
    // ever used to separate classes the maths scores identically.
    function classAffinity(klass, spec) {
      const arch = K.ARCHETYPES[spec.goal] || K.ARCHETYPES[K.DEFAULT_GOAL];
      const words = arch.kitWords || [];
      if (!words.length) return 0;
      const entry = (D.classMoves || {})[klass] || {};
      const text = (JSON.stringify(entry.innatePassives || []) + JSON.stringify(entry.learns || [])).toLowerCase();
      // Count OCCURRENCES, not distinct words. A class that heals throughout its
      // kit should outrank one that merely mentions healing twice — presence
      // alone put Necromancer above Saint for "healer".
      let n = 0;
      for (const w of words) {
        let i = 0, c = 0;
        while ((i = text.indexOf(w, i)) !== -1) { c++; i += w.length; if (c >= 6) break; }
        n += c;
      }
      return n;
    }

    // ── corruption ───────────────────────────────────────────────────────────
    function pickCorruption(ctx) {
      const scored = K.CORRUPTION.map(entry => {
        const r = entry.fit(ctx);
        return { form: entry.form, score: r.score, why: r.why };
      }).sort((a, b) => b.score - a.score);
      return { best: scored[0], all: scored };
    }

    // ── entry point ──────────────────────────────────────────────────────────
    function run(spec) {
      const klasses = spec.klass ? [spec.klass]
                    : (classesUsingWeapon(spec.weaponType) || combatClasses());
      const races = spec.race ? [spec.race] : Object.keys(D.races);

      // Coarse pass: a cheap build per (class, race) to find where to look
      // properly. Without it a full search of 570 pairs is far too slow.
      const coarse = [];
      const affinityCache = {};
      for (const k of klasses) {
        const aff = affinityCache[k] !== undefined ? affinityCache[k]
                  : (affinityCache[k] = classAffinity(k, spec));
        for (const r of races) {
          const b = M.emptyBuild();
          b.level = spec.level; b.race = r; b.klass = k;
          allocateStatsFast(b, spec);
          // Affinity is a small multiplier, not an override. It decides between
          // classes the maths cannot separate, and never overturns a real gap.
          coarse.push({ k, r, aff, score: evaluate(b, spec).score * (1 + 0.04 * aff) });
        }
      }
      coarse.sort((a, b) => b.score - a.score);

      // Keep the best few pairs, but always keep at least one of each named
      // constraint so an explicit request is never optimised away.
      const finalists = coarse.slice(0, Math.min(8, coarse.length));

      let best = null, bestCtx = null;
      for (const f of finalists) {
        const b = buildFor(f.k, f.r, spec);
        const ctx = evaluate(b, spec);
        if (!best || ctx.score > bestCtx.score) { best = b; bestCtx = ctx; }
      }

      const corr = pickCorruption(bestCtx);
      best.corruption = corr.best.form;

      return { build: best, ctx: bestCtx, corruption: corr, considered: coarse.length };
    }

    // Cheap stat allocation for the coarse pass: proportional to weights, no
    // search. Good enough to rank class/race pairs against each other.
    function allocateStatsFast(build, spec) {
      const budget = M.pointBudget(build);
      const w = weightOf(spec);
      const wsum = STATS.reduce((a, s) => a + (w[s] || 0), 0) || 1;
      const inv = {}; let used = 0;
      for (const s of STATS) { inv[s] = Math.floor(budget * (w[s] || 0) / wsum); used += inv[s]; }
      inv[STATS.reduce((a, b) => (w[a] || 0) >= (w[b] || 0) ? a : b)] += budget - used;
      build.invested = inv;
    }

    return { run, evaluate, movesFor, baseOf, weightOf, rankGear, pickCorruption };
  }

  return { Optimizer };
}));
