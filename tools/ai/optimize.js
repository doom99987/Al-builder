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

    // -- availability ---------------------------------------------------------
    // knowledge.js lists what exists in the data but cannot be used in game
    // right now. Resolved ONCE into a flat name -> reason lookup, because this
    // gets asked about every item of every candidate build.
    const _unavailable = (() => {
      const U = K.UNAVAILABLE || {};
      const out = Object.assign({}, U.items || {});
      for (const [series, why] of Object.entries(U.weaponSeries || {}))
        for (const [name, def] of Object.entries(D.weapons || {}))
          if (def.series === series && !out[name]) out[name] = why;
      return out;
    })();
    const unavailableReason = name => _unavailable[name] || null;
    const usable = name => !_unavailable[name];

    // Filtering must never empty a list. Every downstream step assumes a build
    // has a weapon and four gears, and handing back nothing is a worse answer
    // than handing back something the player cannot equip.
    const keepUsable = names => { const ok = names.filter(usable); return ok.length ? ok : names; };

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
      const all = Object.keys(D.weapons || {}).filter(usable);
      // A weapon named in the request is only honoured if it is usable. run()
      // strips it and records why if not, so one that reaches here is fine.
      if (spec.weaponName && usable(spec.weaponName)) return [spec.weaponName];

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
      const gp = gearPassiveTotals(build);
      const ma = masteryAbilityTotals(build);
      const sh = M.shardTotals(build, K);
      const en = (K.ENCHANTS || {})[build.enchant];
      const enPct = en && en.kind === 'dmgPct' ? en.value * (en.uptime ?? 1) : 0;

      const critChance = d.critChance + tt.critChance + pv.critChance + gp.critChance + ma.critChance;
      const critDmg    = d.critDmg * (1 + tt.critDmgPct / 100);
      const mult = M.expectedMultiplier(critChance, critDmg);

      // ── setup rotation ────────────────────────────────────────────────────
      // A buff cast before the hit is part of the build, not a footnote. Two
      // numbers come out of this: the opener (everything up), and the sustained
      // figure (each buff weighted by its uptime, duration / cooldown).
      const setups = setupsFor(build);
      let setupDmgPct = 0, setupSustainedPct = 0;
      const statBuffs = {};
      const rotation = [];
      for (const su of setups) {
        const uptime = Math.min(1, (su.duration || 1) / Math.max(1, su.cd || 1)) * (su.reliability ?? 1);
        if (su.kind === 'dmgPct') {
          const full = su.value * (su.reliability ?? 1);
          setupDmgPct += full;
          setupSustainedPct += su.value * uptime;
          rotation.push({ move: su.move, gain: full, elements: su.elements || null, note: su.note, uptime });
        } else if (su.kind === 'statBuff' && su.statBuff) {
          statBuffs[su.statBuff] = true;
          rotation.push({ move: su.move, gain: null, note: su.note, uptime });
        } else if (su.kind === 'summonDmgPct') {
          rotation.push({ move: su.move, gain: null, note: su.note, uptime });
        }
      }

      // Stat buffs run through model.js's own verified buff path rather than a
      // second implementation of the same arithmetic.
      let buffedStats = d.stats, buffedMult = mult, buffedCrit = critChance;
      if (Object.keys(statBuffs).length) {
        const bb = Object.assign({}, build, { buffs: Object.assign({}, build.buffs, statBuffs) });
        const bd = M.derived(bb);
        buffedStats = bd.stats;
        buffedCrit = bd.critChance + tt.critChance + pv.critChance + gp.critChance;
        buffedMult = M.expectedMultiplier(buffedCrit, critDmg);
      }

      let bestHit = 0, bestMove = null, bestBurst = 0, burstMove = null, sustainedHit = 0;
      for (const mv of moves) {
        let dmg = M.moveDamage(build, mv, { stats: d.stats, ctx: d._ctx });
        let pct = tt.dmgPct + pv.dmgPct + sh.dmgPct + enPct + gp.dmgPct + ma.dmgPct;

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

        const plain = dmg * mult;
        if (plain > bestHit) { bestHit = plain; bestMove = mv; }

        // The same move with the setup up. Element-gated buffs only pay on
        // matching move types.
        const type = String(mv.moveType || '') + ' ' + String(mv.element || '');
        let openPct = 0, sustPct = 0;
        for (const rt of rotation) {
          if (rt.gain === null) continue;
          if (rt.elements && !rt.elements.test(type)) continue;
          openPct += rt.gain;
          sustPct += rt.gain * rt.uptime;
        }
        // Recompute from the pre-multiplier damage so the buffs compound properly.
        const preMult = dmg;
        const withStats = Object.keys(statBuffs).length ? M.moveDamage(build, mv, { stats: buffedStats }) * (1 + pct / 100) : preMult;
        const burst = withStats * (1 + openPct / 100) * buffedMult;
        const sust  = preMult   * (1 + sustPct / 100) * mult;
        if (burst > bestBurst) { bestBurst = burst; burstMove = mv; }
        if (sust > sustainedHit) sustainedHit = sust;
      }
      const ctx = {
        stats: d.stats, hp: d.hp * (1 + (tt.hpPct + gp.hpPct) / 100), critChance,
        critTier: M.critTier(critChance), critDmg,
        blockDr: d.blockDr + tt.dr + gp.dr + ma.dr, outHeal: d.outHeal, incHeal: d.incHeal,
        initiative: d.initiative + tt.initiative,
        bestHit, bestMove, moves, goal: spec.goal,
        bestBurst, burstMove, sustainedHit, rotation, setups,
        traits: tt, energyCap: cap, shards: sh, enchant: en || null, gearPassives: gp,
        masteryAbilities: ma,
        passives: pv, passiveList: passivesFor(build),
        siteHp: d.hp, siteCritChance: d.critChance,   // what the site will show
      };
      const arch = K.ARCHETYPES[spec.goal] || K.ARCHETYPES[K.DEFAULT_GOAL];
      // Tiny damage term as a TIE-BREAK only. A tank's score is pure survivability,
      // so nothing a shard or enchant does ever "improves" it and the optimiser
      // left all seven shard slots empty — a strictly worse build in practice.
      // The weight is far too small to outrank the archetype itself; it only
      // decides between options the archetype scores identically.
      ctx.score = arch.score(ctx) + 1e-6 * ctx.bestHit;
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
      return Object.entries(D.gearItems).filter(([name]) => usable(name)).map(([name, block]) => {
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
    function bestOfSlot(build, spec, options, set, tieBreak) {
      let bestVal = null, bestScore = -Infinity;
      for (const opt of options) {
        set(build, opt);
        const sc = evaluate(build, spec).score;
        // A tie is not a coin flip. Some options are strictly better in game than
        // the model can see, and picking between them by list order looks like a
        // mistake to anyone reading the build. `tieBreak(candidate, incumbent)`
        // says which of two equal-scoring options to keep.
        if (sc > bestScore || (tieBreak && bestVal !== null &&
                               Math.abs(sc - bestScore) < 1e-9 && tieBreak(opt, bestVal))) {
          bestScore = sc; bestVal = opt;
        }
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

      // A pinned gear takes the first slot and is never reconsidered — it is the
      // reason the rest of the build exists.
      if (spec.forceGear && D.gearItems[spec.forceGear] && usable(spec.forceGear)) {
        const entry = { name: spec.forceGear, tier: D.MAX_GEAR_TIER, alloc: {}, traits: [] };
        b.gear.push(entry);
        bestTierAlloc(b, spec, entry, false);
      }

      for (let slot = b.gear.length; slot < 4; slot++) {
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

      // A locked slot is not searched — the point of choosing it is that it stays.
      if (spec.armour) b.armour = spec.armour;
      else bestOfSlot(b, spec, keepUsable(Object.keys(D.armourItems)), (bb, v) => { bb.armour = v; });

      // Weapons must be compared WITH their tier points. Only the tiered series
      // roll any, so leaving alloc empty during selection made a Dragonbone Spear
      // look identical to a Ferrus one and hid up to 5 stat points.
      const wepOpts = weaponsFor(spec, klass);
      bestOfSlot(b, spec, wepOpts, (bb, v) => {
        if (!v) { bb.weapon = null; return; }
        bb.weapon = { name: v, tier: D.MAX_WEAPON_TIER, alloc: {} };
        if (M.weaponIsTiered(v)) bestTierAlloc(bb, spec, bb.weapon, true);
      // Weapons tie constantly, because a class whose moves carry no stat scaling
      // (Berserker is the clearest case) gets nothing measurable from the 5 tier
      // points. They are still 5 real stat points in game, feeding block bar, HP
      // and everything else this model does not score, so on an equal score the
      // tiered weapon wins. Left to list order the answer was a Ferrus Sword,
      // which reads as a mistake whether or not it scores the same.
      }, (cand, cur) => M.weaponIsTiered(cand) && !M.weaponIsTiered(cur));
      // A weapon outside the tiered series has no tier and no allocation. Saying
      // otherwise is wrong in the output and writes meaningless bits into the
      // share link.
      if (b.weapon && !M.weaponIsTiered(b.weapon.name)) { b.weapon.tier = 0; b.weapon.alloc = {}; }

      bestOfSlot(b, spec, keepUsable(Object.keys(D.artifactItems)), (bb, v) => {
        bb.artifact = v ? { name: v, tier: D.MAX_GEAR_TIER, alloc: {} } : null;
      });
      if (b.artifact) bestTierAlloc(b, spec, b.artifact, false);

      // Permuth multiplies one finished stat total by 1.4 — always worth taking,
      // and it belongs on whichever stat the build actually leans on.
      b.mark = 'Venia';
      bestOfSlot(b, spec, order.slice(0, 3), (bb, v) => { bb.permuth = v; });

      if (spec.enchant) b.enchant = spec.enchant;
      else bestOfSlot(b, spec, ['', ...keepUsable(Object.keys(D.enchantItems))], (bb, v) => { bb.enchant = v; });

      // Mastery first — it adds ~29 flat stat points, which shifts what the stat
      // allocator should do with the 150 it controls.
      pickMastery(b, spec);
      allocateStats(b, spec);

      // Traits and shards can move crit chance (`fortunate` grants it flat), and
      // the allocator's threshold snapping ran before they existed. Re-allocate
      // ONLY when that actually changed the overcrit tier — measured across a
      // spread of builds, an unconditional second pass cost ~40% more time and
      // improved the score in none of them.
      const tierBefore = evaluate(b, spec).critTier;
      pickShards(b, spec);
      pickTraits(b, spec);
      if (evaluate(b, spec).critTier !== tierBefore) allocateStats(b, spec);

      // Re-pick Permuth and tier shapes now that the stats are settled: the right
      // answer to both changes once the build's actual totals are known.
      bestOfSlot(b, spec, order.slice(0, 3), (bb, v) => { bb.permuth = v; });
      for (const g of b.gear) bestTierAlloc(b, spec, g, false);
      if (b.artifact) bestTierAlloc(b, spec, b.artifact, false);
      if (b.weapon && M.weaponIsTiered(b.weapon.name)) bestTierAlloc(b, spec, b.weapon, true);

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

    // Which setup buffs this build can actually cast, from its race and class.
    const _setupCache = {};
    function setupsFor(build) {
      const key = (build.race || '') + '|' + (build.klass || '');
      if (_setupCache[key]) return _setupCache[key];
      const table = K.SETUP_MOVES || {};
      const owned = [];

      const scan = (entry, owner) => {
        if (!entry) return;
        for (const mv of (entry.learns || [])) {
          if (mv.type !== 'Active') continue;
          const def = table[mv.name];
          if (def && (!def.owner || def.owner === owner)) owned.push(Object.assign({ move: mv.name }, def));
        }
      };
      scan((D.raceMoves || {})[build.race], build.race);
      scan((D.classMoves || {})[build.klass], build.klass);
      const base = baseOf(build.klass);
      if (base && base !== build.klass) scan((D.classMoves || {})[base], base);

      return (_setupCache[key] = owned);
    }

    // Gear passives, aggregated the same way traits are. Split into what can be
    // scored and what cannot, so a build can say which of its gear is doing
    // something the numbers above do not reflect.
    function gearPassiveTotals(build) {
      const table = K.GEAR_PASSIVES || {};
      const text = D.itemPassives || {};
      const out = { dmgPct: 0, critChance: 0, hpPct: 0, dr: 0, active: [], unmodelled: [] };
      const seen = new Set();

      const consider = name => {
        if (!name || seen.has(name)) return;
        seen.add(name);
        const rule = table[name];
        if (!rule || rule.kind === 'note' || rule.value == null) {
          if (text[name]) out.unmodelled.push({ name, note: (rule && rule.note) || text[name].slice(0, 110) });
          return;
        }
        const eff = rule.value * (rule.uptime ?? 1);
        if (out[rule.kind] !== undefined) out[rule.kind] += eff;
        out.active.push({ name, value: rule.value, effective: eff, note: rule.note });
      };

      for (const g of build.gear || []) consider(g.name);
      if (build.artifact) consider(build.artifact.name);
      return out;
    }

    // What the mastery CAPSTONES do, as opposed to the stat points every node
    // grants. A capstone costs 5 of 35 points and its whole value is the written
    // ability, which the engine could not read at all until now — so it was
    // buying one on branch colour and calling that a choice.
    //
    // Two sources, in order: knowledge.js if it has an entry, otherwise the
    // number extract-data.js got by running builder.js's own parseDmgBonus over
    // the description. Anything neither can read is reported, not scored.
    function masteryAbilityTotals(build) {
      const table = K.MASTERY_ABILITIES || {};
      const perClass = (D.masteryAbilities || {})[build.klass] || {};
      const out = { dmgPct: 0, critChance: 0, dr: 0, active: [], unmodelled: [] };
      const nodes = D.masteryNodes || [];
      const byId = {};
      nodes.forEach(n => { byId[n.id] = n; });

      for (const id of build.masteryNodes || []) {
        const node = byId[id];
        if (!node || node.type !== 'mastery') continue;   // only capstones carry abilities
        const entry = perClass[id];
        if (!entry) continue;
        const rule = table[entry.name];

        // An explicit note-only entry, or nothing to go on at all.
        if ((rule && rule.kind === 'note') || (!rule && entry.bonus == null)) {
          out.unmodelled.push({ name: entry.name, note: (rule && rule.note) || null });
          continue;
        }
        const kind   = rule ? rule.kind : 'dmgPct';
        const value  = rule && rule.value != null ? rule.value : entry.bonus;
        const uptime = rule && rule.uptime != null ? rule.uptime : K.MASTERY_ABILITY_DEFAULT_UPTIME;
        if (value == null) { out.unmodelled.push({ name: entry.name, note: rule && rule.note }); continue; }
        const eff = value * uptime;
        if (out[kind] !== undefined) out[kind] += eff;
        out.active.push({ name: entry.name, kind, value, uptime, effective: eff,
                          note: rule && rule.note });
      }
      return out;
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

    // ── mastery ──────────────────────────────────────────────────────────────
    // Costs: a regular node is 1 point, a capstone ("mastery") is 5, and a
    // breakthrough is 0 points (it is paid for in echo shards).
    //
    // The part that is easy to get wrong, and that this used to get wrong: the
    // tree is not a flat list. Continuing down the MIDDLE of a branch runs
    // through the capstone, so those nodes cannot be taken without paying its 5
    // points — unlike the side nodes, which branch around it. In the current
    // tree `c4`, `c5a` and `c5b` all sit behind `cm1`. Taking every stat node
    // and then buying an arbitrary capstone produced builds that were three
    // nodes illegal and quietly unbuildable in game.
    //
    // So this is a real budget problem, not "take them all": greedy on stat
    // value per point, where the cost of a node includes every unpaid ancestor
    // it drags in with it.
    const _mastCost = n => n.type === 'mastery' ? 5 : (n.type === 'breakthrough' ? 0 : 1);

    function pickMastery(build, spec) {
      const all = D.masteryNodes || [];
      const cd = M.masteryData(build);
      if (!all.length || !cd) { build.masteryNodes = []; build.masteryPoints = 0; return; }

      const byId = {};
      all.forEach(n => { byId[n.id] = n; });
      const CAP = D.MASTERY_TOTAL_POINTS || 35;
      const w = weightOf(spec);
      const mults = cd.branchMultipliers || {};

      // What a capstone's ABILITY is worth to this build. Scaled into the same
      // rough range as a stat node so the two can be compared at all: a stat
      // point moves damage about a percent, so a percentage point of a buff and
      // a point of stat weight are put on comparable footing and the cost side
      // of the ratio does the rest.
      const abilityValue = nodeId => {
        const entry = ((D.masteryAbilities || {})[build.klass] || {})[nodeId];
        if (!entry) return 0;
        const rule = (K.MASTERY_ABILITIES || {})[entry.name];
        if (rule && rule.kind === 'note') return 0;
        const value = rule && rule.value != null ? rule.value : entry.bonus;
        if (value == null) return 0;
        const uptime = rule && rule.uptime != null ? rule.uptime : K.MASTERY_ABILITY_DEFAULT_UPTIME;
        const kind   = rule ? rule.kind : 'dmgPct';
        // Weighted by what the goal actually wants, so a tank does not buy a
        // damage capstone and a damage build does not buy a defensive one.
        const goalW = kind === 'dr'         ? (w.end || 0)
                    : kind === 'critChance' ? (w.lck || 0)
                    :                         Math.max(w.str || 0, w.arc || 0);
        return value * uptime * Math.max(0.25, goalW / 10);
      };

      // What a node is worth to THIS build. Stat nodes grant stats; capstones
      // grant an ability, and are worth whatever that ability does.
      const valueOf = n => {
        if (n.type === 'mastery') return abilityValue(n.id);
        if (n.type !== 'node') return 0;
        const stat = (cd.branchStats || {})[n.branch];
        return stat ? (w[stat] || 0) * (mults[n.branch] ?? 1) : 0;
      };

      const taken = new Set();
      let spent = 0;

      // A node's parent may be an ARRAY, and builder.js requires ALL of them
      // (parentOk uses .every, builder.js:7326). That is the shape in the tree
      // picture: two side nodes converge into the middle one, and you need both
      // sides to continue down the middle. Walking a single parent link missed
      // this for l5, c3a, cb2 and r5.
      const parentsOf = n => [].concat(n.parent == null ? [] : n.parent);

      // Everything that must be bought to legally reach a node, in dependency
      // order (parents before children), skipping anything already owned.
      const closure = id => {
        const need = [];
        const seen = new Set();
        const visit = nid => {
          if (seen.has(nid) || taken.has(nid)) return;
          seen.add(nid);
          const n = byId[nid];
          if (!n) return;
          parentsOf(n).forEach(visit);
          need.push(n);
        };
        visit(id);
        return need;
      };

      for (;;) {
        let best = null;
        for (const n of all) {
          if (taken.has(n.id)) continue;
          const path = closure(n.id);
          if (!path.length) continue;
          const c = path.reduce((a, x) => a + _mastCost(x), 0);
          if (spent + c > CAP) continue;
          const v = path.reduce((a, x) => a + valueOf(x), 0);
          if (v <= 0) continue;                       // capstones handled below
          const ratio = v / Math.max(c, 0.5);         // breakthroughs are free
          if (!best || ratio > best.ratio) best = { path, c, v, ratio };
        }
        if (!best) break;
        best.path.forEach(x => taken.add(x.id));
        spent += best.c;
      }

      // Then spend whatever is left on any node still reachable, even one whose
      // stat this build does not care about. A stat point is never worse than an
      // unspent point, and the value-greedy pass above stops as soon as nothing
      // scores — which left a pure-Luck crit build sitting on 8 unused points.
      for (;;) {
        let cheapest = null;
        for (const n of all) {
          if (taken.has(n.id) || n.type === 'mastery') continue;
          const path = closure(n.id);
          if (!path.length) continue;
          const c = path.reduce((a, x) => a + _mastCost(x), 0);
          if (spent + c > CAP) continue;
          if (!cheapest || c < cheapest.c) cheapest = { path, c };
        }
        if (!cheapest) break;
        cheapest.path.forEach(x => taken.add(x.id));
        spent += cheapest.c;
      }

      // Anything left buys a capstone — and now it buys the RIGHT one. Five
      // points is five stat nodes, so this has to be decided on what the ability
      // actually does; picking by branch colour was choosing between Overload
      // (+100%, but only against stunned enemies) and Element Mastery (+15% to a
      // caster's entire kit) by which side of the tree they sat on.
      const capstones = all.filter(n => n.type === 'mastery' && !taken.has(n.id))
        .map(n => {
          const path = closure(n.id);
          return { n, path, c: path.reduce((a, x) => a + _mastCost(x), 0),
                   v: abilityValue(n.id),
                   branchW: (w[(cd.branchStats || {})[n.branch]] || 0) };
        })
        .filter(x => spent + x.c <= CAP)
        // Ability value first; branch weight only breaks ties between abilities
        // this engine cannot tell apart, which is what it was always doing.
        .sort((a, b) => b.v - a.v || b.branchW - a.branchW || a.c - b.c);
      if (capstones.length) {
        capstones[0].path.forEach(x => taken.add(x.id));
        spent += capstones[0].c;
      }

      // Free breakthroughs whose prerequisites are already met: they cost no
      // points, so there is never a reason to leave one behind.
      let added = true;
      while (added) {
        added = false;
        for (const n of all) {
          if (taken.has(n.id) || n.type !== 'breakthrough') continue;
          const ps = [].concat(n.parent == null ? [] : n.parent);
          if (ps.every(x => taken.has(x))) { taken.add(n.id); added = true; }
        }
      }

      build.masteryNodes = all.filter(n => taken.has(n.id)).map(n => n.id);
      build.masteryPoints = spent;
      build.masteryShards = build.masteryNodes.filter(id => byId[id].type === 'breakthrough').length;
    }

    // Every selected node must have every ancestor selected, and the bill must
    // fit the budget. Exposed so tests can assert it directly — an illegal
    // mastery tree is not something a player can enter into the game.
    function masteryLegal(build) {
      const all = D.masteryNodes || [];
      const byId = {};
      all.forEach(n => { byId[n.id] = n; });
      const sel = new Set(build.masteryNodes || []);
      const problems = [];
      let spent = 0;
      // Checking each node's DIRECT parents is enough: every selected node runs
      // the same check, so a missing grandparent surfaces on its own child.
      for (const id of sel) {
        const n = byId[id];
        if (!n) { problems.push('unknown node ' + id); continue; }
        spent += _mastCost(n);
        for (const pid of [].concat(n.parent == null ? [] : n.parent)) {
          const p = byId[pid];
          if (!p) { problems.push(id + ' has unknown parent ' + pid); continue; }
          if (!sel.has(pid)) problems.push(id + ' requires ' + pid + ' (' + p.type + ')');
        }
      }
      const cap = D.MASTERY_TOTAL_POINTS || 35;
      if (spent > cap) problems.push('spends ' + spent + ' of ' + cap);
      return { ok: problems.length === 0, spent, problems };
    }

    // Seven shard slots, filled greedily with DISTINCT shards. Distinct because
    // the builder de-duplicates by name, so a second copy of the same shard adds
    // nothing there — and with 14 shards for 7 slots, distinct is the stronger
    // choice anyway.
    function pickShards(build, spec) {
      const names = Object.keys(D.shardItems || {});
      const slots = (K.SHARD_SLOTS || 7);
      build.shards = [];
      for (let i = 0; i < slots; i++) {
        let bestName = null, bestScore = evaluate(build, spec).score;
        for (const name of names) {
          if (build.shards.includes(name)) continue;
          build.shards.push(name);
          const sc = evaluate(build, spec).score;
          build.shards.pop();
          if (sc > bestScore + 1e-9) { bestScore = sc; bestName = name; }
        }
        if (!bestName) break;          // nothing left that helps
        build.shards.push(bestName);
      }
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
        return Object.assign({ form: entry.form, score: r.score, why: r.why },
                             { damage: corruptionDamage(entry.form, ctx) });
      }).sort((a, b) => b.score - a.score);
      return { best: scored[0], all: scored };
    }

    // What a form does to the damage numbers. Worked out for EVERY form, not
    // just the chosen one, so the three can be read side by side and checked in
    // game — which is the only way the assumed figures ever get corrected.
    //
    // Deliberately not part of `score`: the build is settled before a form is
    // picked, so nothing in here can quietly change which gear was chosen.
    function corruptionDamage(form, ctx) {
      const fn = (K.CORRUPTION_DAMAGE || {})[form];
      if (!fn) return null;
      let d;
      try { d = fn(ctx, M); } catch (e) { return null; }
      if (!d) return null;
      const base = ctx.bestBurst || ctx.bestHit || 0;
      return Object.assign({}, d, {
        burstHit: base * (d.burst || 1),
        sustainedHit: (ctx.sustainedHit || 0) * (d.sustained || 1),
        burstGain: Math.round(((d.burst || 1) - 1) * 1000) / 10,
        sustainedGain: Math.round(((d.sustained || 1) - 1) * 1000) / 10,
      });
    }

    // ── entry point ──────────────────────────────────────────────────────────
    // Races with no real stat block in the data. Excluded from every search —
    // recommending one is recommending an unfinished entry, and its zeroed stats
    // make it strictly worse anyway, so nothing is lost.
    function realRaces() {
      const roles = K.RACE_ROLES || {};
      return Object.keys(D.races || {}).filter(r => !(roles[r] || {}).placeholder);
    }

    // Races that suit a goal. Used for RANDOM rolls, where the maths cannot save
    // us: most racial passives are prose the engine cannot read, so left to base
    // stats alone it will happily roll Daminos for a damage build — four lives
    // and outgoing healing, which is excellent and entirely beside the point.
    //
    // Falls back to every real race rather than to nothing.
    function racesForGoal(goal) {
      const want = (K.GOAL_RACE_ROLES || {})[goal];
      const roles = K.RACE_ROLES || {};
      if (!want) return realRaces();
      const fit = realRaces().filter(r => {
        const rr = (roles[r] || {}).roles || [];
        return rr.some(x => want.indexOf(x) !== -1);
      });
      // Tech races are off-role but earn their place through a specific combo.
      for (const t of techFor(goal)) if (fit.indexOf(t.race) === -1 && realRaces().indexOf(t.race) !== -1) fit.push(t.race);
      return fit.length ? fit : realRaces();
    }

    // Tech entries that apply to a goal, and to a race.
    const techFor = goal => (K.RACE_TECH || []).filter(t => (t.goals || []).indexOf(goal) !== -1);
    function techForRace(race, goal) {
      return (K.RACE_TECH || []).find(t => t.race === race && (t.goals || []).indexOf(goal) !== -1) || null;
    }

    // A small seeded RNG. Random builds should still be REPRODUCIBLE when a seed
    // is given, so tests can pin one and a shared link means the same thing
    // tomorrow. Without a seed it varies per call, which is the whole point.
    function rng(seed) {
      let x = (seed | 0) || (Date.now() ^ (Math.random() * 0x7fffffff)) | 0;
      return () => {
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        return ((x >>> 0) % 100000) / 100000;
      };
    }

    // Pick a class, race and goal for someone who did not care — but pick them
    // COHERENTLY. A random class with a random goal produces a Cleric told to
    // maximise crit, which is a bad build with a funny name. Instead pick the
    // goal first, then a class whose kit actually reads that way.
    function rollRandom(spec) {
      const r = rng(spec.seed);
      const pick = arr => arr[Math.floor(r() * arr.length) % arr.length];

      if (!spec.goal || spec.goal === K.DEFAULT_GOAL) {
        // This is the actual difference between the two random modes. A plain
        // surprise may roll `balanced` and hand back something sensible; a
        // min-max roll refuses to, because committing to one thing and being
        // extreme at it IS the request.
        const goals = Object.keys(K.ARCHETYPES)
          .filter(g => !spec.minmax || g !== 'balanced');
        spec.goal = pick(goals);
      }
      if (!spec.klass) {
        const affine = combatClasses()
          .map(k => ({ k, a: classAffinity(k, spec) }))
          .sort((x, y) => y.a - x.a);
        // Only classes that genuinely read as the rolled goal. Taking the top
        // third regardless of score produced a speed Wizard — a valid build, a
        // terrible one, and exactly the kind of thing "random" should not hand
        // someone who asked for a surprise rather than a joke.
        const best = affine.length ? affine[0].a : 0;
        let pool = affine.filter(x => x.a > 0 && x.a >= best * 0.5).map(x => x.k);
        if (pool.length < 2) pool = affine.slice(0, 3).map(x => x.k);
        spec.klass = pick(pool);
      }
      if (!spec.race) spec.race = pick(racesForGoal(spec.goal));

      // If the race got in on tech, the build must actually run the combo —
      // otherwise it is an off-role race with a story attached.
      const tech = techForRace(spec.race, spec.goal);
      if (tech && tech.enables && D.gearItems[tech.enables] && usable(tech.enables)) {
        spec.forceGear = tech.enables;
        spec.tech = tech;
      }

      spec.rolled = { goal: spec.goal, klass: spec.klass, race: spec.race };
      return spec;
    }

    // What a build is bad at. A min-maxed build is supposed to have weaknesses —
    // the useful thing is to name them rather than let someone discover them in
    // a fight. Thresholds are deliberately blunt: this is a warning, not a stat
    // sheet, and the numbers are all shown elsewhere anyway.
    function weaknessesOf(ctx) {
      const out = [];
      if (ctx.hp < 120) out.push('almost no health (' + Math.round(ctx.hp) + ')');
      else if (ctx.hp < 200) out.push('low health (' + Math.round(ctx.hp) + ')');
      if (ctx.bestHit < 40) out.push('very little damage of your own');
      if (ctx.critChance < 25 && ctx.goal !== 'tank' && ctx.goal !== 'heal') out.push('barely crits');
      if (ctx.blockDr < 3) out.push('no meaningful block reduction');
      if (ctx.outHeal < 110 && ctx.goal !== 'damage' && ctx.goal !== 'crit' && ctx.goal !== 'burst')
        out.push('no healing to speak of');
      return out;
    }

    // Name the finished build after what it actually became.
    function flavourFor(ctx) {
      for (const f of (K.FLAVOUR || [])) {
        try { if (f.when(ctx)) return { name: f.name, line: f.line }; }
        catch (e) { /* a bad predicate must not cost us the build */ }
      }
      return null;
    }

    // Anything the request locked has to survive the availability check first.
    // Dropping it silently would answer a request for an Ivory Sword with some
    // other weapon and no explanation, so each drop is recorded on the spec and
    // explain.js reports it.
    function stripUnusable(spec) {
      spec.unavailable = spec.unavailable || [];
      const drop = (field, label) => {
        const name = spec[field];
        const why = name && unavailableReason(name);
        if (!why) return;
        spec.unavailable.push({ what: label, name, why });
        spec[field] = null;
        if (spec.locked) delete spec.locked[field === 'weaponName' ? 'weapon' : field];
      };
      drop('weaponName', 'Weapon');
      drop('armour', 'Armour');
      drop('enchant', 'Enchant');
      drop('forceGear', 'Gear');
      // A named weapon carries its TYPE with it, and the type is still a fair
      // constraint once the weapon itself is gone, so it is left alone.
      return spec;
    }

    function run(spec) {
      stripUnusable(spec);
      if (spec.random) rollRandom(spec);
      // A race asked for by name can carry tech too — the reasoning is just as
      // worth stating when the player chose the race themselves.
      if (!spec.tech && spec.race) {
        const t = techForRace(spec.race, spec.goal);
        // Pin the enabler here too. Identifying the tech but not building around
        // it would explain a combo the build is not actually running.
        if (t) {
          spec.tech = t;
          if (t.enables && D.gearItems[t.enables] && usable(t.enables) && !spec.forceGear) spec.forceGear = t.enables;
        }
      }
      const klasses = spec.klass ? [spec.klass]
                    : (classesUsingWeapon(spec.weaponType) || combatClasses());
      // Placeholder races are never searched; a named one is still honoured, so
      // asking for Arborivia explicitly still works.
      const races = spec.race ? [spec.race] : realRaces();

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

      return { build: best, ctx: bestCtx, corruption: corr, considered: coarse.length,
               flavour: flavourFor(bestCtx),
               weaknesses: weaknessesOf(bestCtx) };
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

    return { run, evaluate, movesFor, baseOf, weightOf, rankGear, pickCorruption,
             flavourFor, rollRandom, weaknessesOf, racesForGoal, realRaces, techForRace,
             masteryLegal, unavailableReason, usable, corruptionDamage, weaponsFor,
             masteryAbilityTotals };
  }

  return { Optimizer };
}));
