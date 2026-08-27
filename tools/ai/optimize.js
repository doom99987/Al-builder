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
      // Gear series are stored the other way round from weapon series: a list of
      // names under the series, not a field on the item.
      for (const [series, why] of Object.entries(U.gearSeries || {}))
        for (const name of (D.gearSeries || {})[series] || [])
          if (!out[name]) out[name] = why;
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
    const _baseOfCache = {};
    function baseOf(klass) {
      if (_baseOfCache[klass] !== undefined) return _baseOfCache[klass];
      let found = null;
      for (const [base, supers] of Object.entries(D.classes || {}))
        if (base === klass || (supers || []).includes(klass)) { found = base; break; }
      return (_baseOfCache[klass] = found);
    }
    // Called once per evaluate(), which is a few thousand times per request, and
    // it rebuilds the same list from the same static data every time.
    const _movesCache = {};
    function movesFor(klass) {
      if (_movesCache[klass]) return _movesCache[klass];
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
      return (_movesCache[klass] = out);
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

    // Which classes a build at this LEVEL can actually be. A superclass needs
    // level 15; above that nobody stays a base class, and the search was picking
    // one about one roll in ten. Measured at level 50 a base class scores around
    // a quarter of its own superclasses, so those were not close calls — they
    // were builds nobody would ever play.
    //
    // An explicitly named class is never filtered out here; run() handles that,
    // so asking for a Warrior still gets you a Warrior.
    function classesForLevel(level) {
      const tree = D.classes || {};
      const bases  = Object.keys(tree).filter(k => (D.classMoves || {})[k]);
      const supers = Object.values(tree).flat().filter(k => (D.classMoves || {})[k]);
      const min = K.SUPERCLASS_MIN_LEVEL ?? 15;
      if ((level || 0) < min) return bases;
      return supers.length ? supers : bases;
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

    // Everything the build wears, by name, for the proc and passive lookups.
    function wornNames(build) {
      // Slots are not a consistent shape: gear, artifact and weapon are objects
      // like { name, tier, alloc }, while mark is a bare string. Pushing an
      // object here makes every PROCS lookup miss silently, which is exactly
      // what the first version did.
      const nameOf = v => (v && typeof v === 'object') ? v.name : v;
      const out = [];
      for (const g of build.gear || []) { const n = nameOf(g); if (n) out.push(n); }
      for (const slot of [build.mark, build.artifact, build.weapon, build.armour, build.permuth]) {
        const n = nameOf(slot);
        if (typeof n === 'string' && n) out.push(n);
      }
      return out;
    }

    // Procs with a stated chance, turned into what they are expected to do.
    // Reported on every build, not only boss ones: "33% to apply an extra
    // status" is a build property, and it was being ignored entirely.
    function procTotals(build) {
      const worn = wornNames(build);
      const load = K.debuffLoad(movesOf(build));
      const gain = K.procStatusGain(worn, load);
      const listed = [], traps = [];
      for (const name of worn) {
        const p = (K.PROCS || {})[name];
        if (!p) continue;
        (p.trap ? traps : listed).push({
          name, chance: p.chance, per: p.per, kind: p.kind,
          note: p.note || null, why: p.why || null,
        });
      }
      return { statusGain: gain, listed, traps, debuffLoad: load };
    }

    // ── aiming at one boss ────────────────────────────────────────────────
    // Only mechanics that genuinely change which build is FASTER are scored.
    // The engine has never scored status effects, so a boss being immune to
    // them changes no number - it is reported, not priced, and saying otherwise
    // would be inventing a penalty out of nothing.
    //
    // What does change the number: a boss that HEALS from the debuffs you apply.
    // There, stacking statuses actively lengthens the fight, so a kit built
    // around applying them is worse against that boss than its raw damage says.
    const _bossCache = {};
    function bossFor(spec) {
      if (!spec.boss) return null;
      if (_bossCache[spec.boss] !== undefined) return _bossCache[spec.boss];
      let p = null;
      try { p = K.bossProfile(spec.boss, D); } catch (e) { p = null; }
      return (_bossCache[spec.boss] = p);
    }

    // Multiplier on this build's damage for the chosen fight, plus why.
    function bossFit(build, spec, ctx) {
      const boss = bossFor(spec);
      if (!boss) return { mult: 1, boss: null, reasons: [] };
      const moves = movesOf(build);
      const load = K.debuffLoad(moves);
      const reasons = [];
      let mult = 1;
      // A proc that applies extra statuses makes a debuff kit worse here, not
      // better: every extra status is more healing for Seraphon. The engine
      // would otherwise price Chaos Orb as neutral in the one fight where it
      // actively hurts.
      const procGain = K.procStatusGain(wornNames(build), load);
      if (boss.punishesDebuffs && load.applying > 0) {
        // Scaled by how much of the kit is doing it. Capped well short of
        // halving: this lengthens a fight, it does not make the build useless,
        // and an over-confident penalty would throw away good damage builds.
        const P = K.BOSS_PENALTIES;
        // Extra statuses from a proc count as more of the same problem.
        const effShare = Math.min(1, load.share * (1 + procGain.extraPerTurn));
        const penalty = Math.min(P.debuffCap, P.perDebuffShare * effShare);
        mult *= (1 - penalty);
        reasons.push({
          kind: 'debuffs', pct: Math.round(penalty * 100), moves: load.names,
          text: boss.name + ' heals off the debuffs you apply, and ' + load.applying + ' of ' +
                load.total + ' moves in this kit apply one.' +
                (procGain.from.length
                  ? ' ' + procGain.from.map(f => f.name).join(' and ') + ' adds about ' +
                    Math.round(procGain.extraPerTurn * 100) + '% more on top, which here is a cost.'
                  : ''),
        });
      }
      // A kit that wins by stacking a status the boss cannot take is doing
      // nothing but its direct damage. Assassin into Handaconda is the case:
      // three of its five moves are about Poison, and Handaconda is immune.
      if (boss.statusImmune.length) {
        const inert = K.statusLoad(moves, boss.statusImmune);
        if (inert.applying > 0) {
          const P = K.BOSS_PENALTIES;
          const penalty = Math.min(P.immuneCap, P.immuneShare * inert.share);
          mult *= (1 - penalty);
          reasons.push({
            kind: 'immune', pct: Math.round(penalty * 100), moves: inert.names,
            text: boss.name + ' is immune to ' + boss.statusImmune.join(', ') + ', and ' +
                  inert.applying + ' of ' + inert.total + ' moves in this kit are built around ' +
                  'exactly that.',
          });
        }
      }

      // Solo, most boss moves have to be dodged, and dodging takes Speed. In a
      // party the incoming moves spread across five people, so this is not
      // applied to a team build - it would tax it for a problem it does not
      // have. Some fights do not ask you to dodge at all, and those say so.
      if (spec.play === 'solo' && !boss.dodgeIrrelevant && ctx && ctx.stats) {
        const floor = K.BOSS_SOLO_MIN_SPEED;
        const spd = ctx.stats.spd || 0;
        if (spd < floor) {
          const short = (floor - spd) / floor;
          const penalty = K.BOSS_PENALTIES.noDodge * short;
          mult *= (1 - penalty);
          reasons.push({
            kind: 'speed', pct: Math.round(penalty * 100), moves: [],
            text: 'Solo, most of this fight has to be dodged, and that takes about ' + floor +
                  ' Speed. This build has ' + Math.round(spd) + '.',
          });
        }
      }

      if (boss.punishesOneElement) {
        const els = [...new Set(moves.map(m => String(m.element || m.moveType || '')).filter(Boolean))];
        if (els.length <= 1) {
          mult *= (1 - K.BOSS_PENALTIES.oneElement);
          reasons.push({ kind: 'oneElement', pct: Math.round(K.BOSS_PENALTIES.oneElement * 100), moves: [],
            text: boss.name + ' adapts to the last element used and heals from a repeat of it. ' +
                  'This kit deals ' + (els[0] || 'a single element') + ' and nothing else.' });
        }
      }
      return { mult, boss, reasons };
    }

    // Every move this build can actually use, for the boss checks above.
    function movesOf(build) {
      const cm = (D.classMoves || {})[build.klass] || {};
      const base = baseOf(build.klass);
      const bm = base && base !== build.klass ? (D.classMoves || {})[base] || {} : {};
      return [].concat(cm.learns || [], cm.innatePassives || [],
                       bm.learns || [], bm.innatePassives || []).filter(Boolean);
    }

    // A move as the build actually uses it. Overrides from a class or a bought
    // mastery node can rewrite the base, the hit count and the scaling, and the
    // raw data object knows nothing about any of it.
    function withShape(build, move) {
      if (!move) return move;
      const sh = M.effectiveShape(build, move);
      if (!sh.changed) return move;
      return Object.assign({}, move, {
        damage:  sh.hits > 1 ? sh.base + 'x' + sh.hits : String(sh.base),
        scaling: sh.scaling,
        shapedBy: sh,            // what changed, for the write-up to explain
        shapeNote: (sh.notes || []).join(' '),
      });
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
      const ma = masteryAbilityTotals(build, spec);
      const sh = M.shardTotals(build, K);
      const en = (K.ENCHANTS || {})[build.enchant];
      const enPct = en && en.kind === 'dmgPct' ? en.value * (en.uptime ?? 1) : 0;

      // A flat stat from a mastery has to reach the stats everything else reads,
      // or the ability probes as worth nothing and is never bought. Overlaid on
      // a COPY: d.stats is what the build reports, and it has to keep matching
      // what the site will show.
      const maFlat = ma.statFlat;
      const hasFlat = STATS.some(k => maFlat[k] > 0);
      if (hasFlat) {
        d.stats = Object.assign({}, d.stats);
        for (const k of STATS) if (maFlat[k]) d.stats[k] += maFlat[k];
      }

      const critChance = d.critChance + tt.critChance + pv.critChance + gp.critChance + ma.critChance;
      const critDmg    = d.critDmg * (1 + tt.critDmgPct / 100);
      // The chosen damage model decides what "damage" means for the whole search.
      //
      //   average    expected value, crit chance folded in. Luck is priced at
      //              what it returns.
      //   potential  the crit landed. Crit CHANCE past the first point buys
      //              nothing here, so Luck stops competing and crit damage and
      //              raw scaling win instead.
      //
      // This is deliberately not a display setting: it changes which build the
      // search decides is best, which is the entire point of asking.
      const potential  = spec.dmg === 'potential';
      const mult = potential ? critDmg : M.expectedMultiplier(critChance, critDmg);

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
        // Avoidance is not damage reduction and must not be added to it: an
        // attack that misses does nothing at all, so it multiplies how long you
        // last rather than shaving a percentage off each hit.
        dodge: Math.min(95, ma.dodge),
        initiative: d.initiative + tt.initiative,
        // Reported with the shape the build actually gives them. `mv` objects are
        // shared game data, so this attaches to a copy rather than writing to one.
        bestHit, bestMove: withShape(build, bestMove), moves, goal: spec.goal,
        bestBurst, burstMove: withShape(build, burstMove), sustainedHit, rotation, setups,
        traits: tt, energyCap: cap, shards: sh, enchant: en || null, gearPassives: gp,
        masteryAbilities: ma, masteryPassedOver: build.masteryPassedOver || [],
        masteryBudget: build.masteryBudget || null,
        procs: procTotals(build),
        passives: pv, passiveList: passivesFor(build),
        siteHp: d.hp, siteCritChance: d.critChance,   // what the site will show
      };
      const arch = K.ARCHETYPES[spec.goal] || K.ARCHETYPES[K.DEFAULT_GOAL];
      // Tiny damage term as a TIE-BREAK only. A tank's score is pure survivability,
      // so nothing a shard or enchant does ever "improves" it and the optimiser
      // left all seven shard slots empty — a strictly worse build in practice.
      // The weight is far too small to outrank the archetype itself; it only
      // decides between options the archetype scores identically.
      // Autododge makes every point of health go further: at 50% avoidance you
      // last twice as long. Applied to a separate effective-health figure that
      // the survival archetypes score on, so the HP this build REPORTS stays the
      // HP the site will show.
      ctx.effectiveHp = ctx.hp / Math.max(0.05, 1 - ctx.dodge / 100);

      // Aimed at a boss, the score is how fast THIS build kills THAT boss.
      const fit = bossFit(build, spec, ctx);
      ctx.bossFit = fit;
      ctx.score = (arch.score(ctx) + 1e-6 * ctx.bestHit) * fit.mult;
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
      const passives = K.GEAR_PASSIVES || {};
      const topWeight = Math.max(...STATS.map(s => w[s] || 0));
      return Object.entries(D.gearItems).filter(([name]) => usable(name)).map(([name, block]) => {
        let v = statValue(block, w);
        // A tiered gear also brings its tier points, which land on whatever stat
        // the build wants most — worth the top shape value times the best weight.
        if (!fixed.has(name)) v += 9 * topWeight;
        if ((D.gearPctBonuses || {})[name]) v += 4;   // percentage bonuses are real but unmodelled here

        // And its PASSIVE, if knowledge.js can score one. This shortlist is cut
        // to fourteen, so a gear whose whole value is its passive — Molten
        // Carapace's +30% defence, Egg Shelmet's shield — was being dropped
        // before the real scorer ever saw it, purely because its stat block is
        // unremarkable. Only the modelled ones can count here; the rest are
        // reported as uncounted exactly as before.
        const rule = passives[name];
        if (rule && rule.kind !== 'note' && rule.value != null) {
          const eff = rule.value * (rule.uptime ?? 1);
          const relevance = rule.kind === 'dr' || rule.kind === 'hpPct' ? (w.end || 0)
                          : rule.kind === 'critChance' ? (w.lck || 0)
                          : topWeight;
          // Scaled into the same rough range as the stat terms above: a
          // percentage point of a real effect against a point of stat weight.
          v += eff * Math.max(0.2, relevance / 10) * 0.6;
        }
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

      // An artifact's ability lives in artifactMoves, not itemPassives, so
      // without this an unmodelled artifact fell through to nothing at all - not
      // even the "not counted" list, which is where a reader would look for it.
      const artifactText = name => {
        const entry = (D.artifactMoves || {})[name];
        if (!entry) return null;
        return (entry.learns || []).map(m => m.effect || '').filter(Boolean)
                 .join(' ').replace(/\s+/g, ' ').trim() || null;
      };

      const consider = name => {
        if (!name || seen.has(name)) return;
        seen.add(name);

        // Multi-effect abilities: one artifact commonly grants damage AND
        // defence AND crit at once, which the single-kind rule cannot express.
        const art = (K.ARTIFACT_ABILITIES || {})[name];
        if (art && art.effects) {
          const up = art.uptime ?? 1;
          for (const e of art.effects) {
            const eff = e.value * up;
            if (out[e.kind] !== undefined) out[e.kind] += eff;
            // The NAME stays the item's real name. Decorating it with the kind
            // broke the check that every counted passive traces back to a
            // knowledge entry, and that check is worth more than a tidier label.
            out.active.push({ name, kind: e.kind, value: e.value, effective: eff,
                              note: art.note, source: 'artifact' });
          }
          return;
        }
        if (art && art.kind === 'note') {
          out.unmodelled.push({ name, note: art.note });
          return;
        }

        const rule = table[name];
        if (!rule || rule.kind === 'note' || rule.value == null) {
          const txt = text[name] || artifactText(name);
          if (txt) out.unmodelled.push({ name, note: (rule && rule.note) || txt.slice(0, 110) });
          return;
        }
        const eff = rule.value * (rule.uptime ?? 1);
        if (out[rule.kind] !== undefined) out[rule.kind] += eff;
        // `kind` has to travel with the entry: without it the write-up labelled
        // Crystal Sphere's +5 CRIT CHANCE as "+5% damage", because the renderer
        // had nothing to switch on.
        out.active.push({ name, kind: rule.kind, value: rule.value, effective: eff, note: rule.note });
      };

      for (const g of build.gear || []) consider(g.name);
      if (build.artifact) consider(build.artifact.name);

      // The weapon, which this never looked at. Its passive belongs to the
      // SERIES rather than the individual weapon, so it is looked up that way
      // and reported under the series name — which is what the game calls it.
      const wpn = build.weapon && build.weapon.name;
      if (wpn) {
        const series = ((D.weapons || {})[wpn] || {}).series;
        const rule = series && (K.WEAPON_PASSIVES || {})[series];
        if (rule && rule.kind !== 'note' && rule.value != null) {
          const eff = rule.value * (rule.uptime ?? 1);
          if (out[rule.kind] !== undefined) out[rule.kind] += eff;
          out.active.push({ name: series + ' (weapon)', kind: rule.kind, value: rule.value,
                            effective: eff, note: rule.note });
        } else if (series) {
          const text = (D.itemPassives || {})[series];
          if (rule || text) {
            out.unmodelled.push({ name: series + ' (weapon)',
                                  note: (rule && rule.note) || (text || '').slice(0, 110) });
          }
        }
      }
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
    // How much a team-facing effect is really worth to THIS build. One for you
    // plus the allies it actually reaches — and exactly 1 for a solo damage
    // build, so nothing changes for the goals that are played alone.
    function partyScale(spec) {
      // Only what the person actually chose. No goal is treated as implying a
      // party: soloing a tank is a real way to play and the engine has no
      // business deciding otherwise.
      if (!spec || spec.play !== 'team') return 1;
      const allies = Math.max(0, (K.PARTY_SIZE || 5) - 1);
      return 1 + allies * (K.PARTY_SPREAD ?? 0.5);
    }

    function masteryAbilityTotals(build, spec) {
      const table = K.MASTERY_ABILITIES || {};
      const perClass = (D.masteryAbilities || {})[build.klass] || {};
      // `dodge` is avoidance rather than reduction, and `statFlat` is a flat
      // stat rather than a percentage, so neither could be expressed before and
      // both were silently scored as nothing.
      const out = { dmgPct: 0, critChance: 0, dr: 0, dodge: 0,
                    statFlat: { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
                    active: [], unmodelled: [] };
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
        // A team effect is counted once for you and again for the allies it
        // reaches. A damage build gets a scale of exactly 1, so this can never
        // quietly inflate a solo build.
        const scale = (rule && rule.party) ? partyScale(spec) : 1;
        const eff = value * uptime * scale;
        if (kind === 'statFlat') {
          const st = (rule && rule.stat) || 'spd';
          if (out.statFlat[st] !== undefined) out.statFlat[st] += eff;
        } else if (typeof out[kind] === 'number') {
          out[kind] += eff;
        }
        out.active.push({ name: entry.name, kind, value, uptime, effective: eff,
                          stat: rule && rule.stat, party: scale > 1 ? scale : null,
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
      // masteryPassedOver is cleared here as well: a class with no tree in the
      // site's data (Paladin (Or) today) must report an empty list rather than
      // whatever the last build left on the object.
      if (!all.length || !cd) {
        build.masteryNodes = []; build.masteryPoints = 0; build.masteryPassedOver = [];
        build.masteryBudget = null; return;
      }

      const byId = {};
      all.forEach(n => { byId[n.id] = n; });
      const CAP = D.MASTERY_TOTAL_POINTS || 35;
      const w = weightOf(spec);
      const mults = cd.branchMultipliers || {};

      // ── pricing, by measurement rather than by guess ──────────────────────
      // Stat nodes and capstones were priced in different units and the
      // comparison between them was meaningless. A stat node was scored by the
      // goal's WEIGHT for that stat (a number from 0 to about 10); a capstone by
      // its ability's PERCENTAGE. Stat nodes therefore won roughly three to one
      // on value-per-point regardless of what was actually true.
      //
      // What is actually true, measured on real builds: five mastery stat points
      // move a damage build about 2.8%, and the capstone those same five points
      // could have bought is worth 7% to 24%. The engine was pricing them almost
      // exactly backwards.
      //
      // So both are now measured with the real scorer, in one unit — percent of
      // this build's score. Eleven extra evaluate() calls per build, which is
      // nothing next to the thousands the search already runs, and it removes a
      // whole class of "the weights say X but the maths says Y" disagreement.
      const _probeBase = evaluate(build, spec).score || 1;
      const _pctOfBase = score => ((score / _probeBase) - 1) * 100;

      // What one point in each stat is worth here. Probed in fives and divided,
      // because a single point often rounds away to nothing.
      const perStatPoint = {};
      for (const st of STATS) {
        const before = build.invested[st] | 0;
        try {
          build.invested[st] = before + 5;
          perStatPoint[st] = _pctOfBase(evaluate(build, spec).score) / 5;
        } catch (e) {
          perStatPoint[st] = 0;
        } finally {
          // Restore in a finally: a throwing probe used to leave five phantom
          // points in the stat it was measuring, and every later evaluate in
          // this build would have scored against them.
          build.invested[st] = before;
        }
      }

      // What each capstone's ability is worth here — measured the same way, by
      // switching it on and asking the scorer. This automatically respects the
      // goal: a damage capstone probes as worthless on a tank because the tank's
      // score does not read damage.
      const _abilityCache = {};
      const abilityValue = nodeId => {
        if (_abilityCache[nodeId] !== undefined) return _abilityCache[nodeId];
        const before = build.masteryNodes;
        build.masteryNodes = (before || []).concat([nodeId]);
        let v;
        try { v = Math.max(0, _pctOfBase(evaluate(build, spec).score)); }
        catch { v = 0; }
        build.masteryNodes = before;
        return (_abilityCache[nodeId] = v);
      };

      // Both in percent-of-score now, so value-per-point compares like with like.
      const valueOf = n => {
        if (n.type === 'mastery') return abilityValue(n.id);
        if (n.type !== 'node') return 0;
        const stat = (cd.branchStats || {})[n.branch];
        return stat ? (perStatPoint[stat] || 0) * (mults[n.branch] ?? 1) : 0;
      };

      // The probes read build.masteryNodes, so it has to be a list before they
      // run rather than whatever the previous build left behind.
      build.masteryNodes = [];
      const taken = new Set();
      let spent = 0;
      let marginalRatio = null;

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
        // The value-per-point of the WORST thing this build still chose to buy.
        // It is the honest answer to "why not this capstone": everything bought
        // was worth more per point than it was.
        marginalRatio = best.ratio;
      }

      // ── the capstone pass, which used to run too late to do anything ─────
      // This block sat AFTER the "spend whatever is left" filler, so by the time
      // it ran there was never anything left. Measured across every class and
      // goal: it had exactly 0 points to work with every single time and bought
      // nothing, ever. All of its careful "buy the RIGHT one" reasoning was dead
      // code, and the spare points went to stat nodes this build had already
      // been measured not to care about — which is precisely the "why does it
      // skip masteries for stat points" complaint.
      //
      // Five points is five stat nodes, so the choice has to be made on what the
      // ability actually does; picking by branch colour was choosing between
      // Overload (+100%, but only against stunned enemies) and Element Mastery
      // (+15% to a caster's entire kit) by which side of the tree they sat on.
      const considered = all.filter(n => n.type === 'mastery' && !taken.has(n.id))
        .map(n => {
          const path = closure(n.id);
          return { n, path, c: path.reduce((a, x) => a + _mastCost(x), 0),
                   v: abilityValue(n.id),
                   branchW: (w[(cd.branchStats || {})[n.branch]] || 0) };
        });
      // Remembered rather than discarded. "It costs 7 to reach and 4 were left"
      // is an answer; "it was not chosen" is not, and that is all the output
      // could say while the losers were being filtered away here.
      const pointsLeft = CAP - spent;
      const capstones = considered.filter(x => x.c <= pointsLeft)
        // Ability value first; branch weight only breaks ties between abilities
        // this engine cannot tell apart, which is what it was always doing.
        .sort((a, b) => b.v - a.v || b.branchW - a.branchW || a.c - b.c);
      // Buy on measured value when there is any. When every remaining capstone
      // measures zero, WHY it measures zero decides what happens next: a priced
      // ability that scores nothing has genuinely been weighed and turned down
      // for this goal, and those points are better spent as stats — but an
      // ability this engine cannot price scores zero for want of a number, not
      // for want of value, and a real in-game ability beats stat nodes the build
      // has already been measured not to want.
      const unpriced = x => {
        const e = ((D.masteryAbilities || {})[build.klass] || {})[x.n.id];
        if (!e) return false;
        const r = (K.MASTERY_ABILITIES || {})[e.name];
        return (r && r.kind === 'note') || (!r && e.bonus == null) ||
               (r && r.kind !== 'note' && r.value == null);
      };
      const bought = capstones.find(x => x.v > 0.01) || capstones.find(unpriced) || null;
      if (bought) {
        bought.path.forEach(x => taken.add(x.id));
        spent += bought.c;
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

      // What it looked at and did not buy, and WHY — recorded here, where the
      // decision is actually made, rather than guessed at from the outside.
      //
      // There are four different answers and they are not interchangeable. "The
      // engine cannot price it" is an admission; "your goal scores it at zero"
      // is a trade you might want to make differently; "it cost more than was
      // left" is arithmetic; "something else measured higher" is a comparison
      // you can check. Reporting all four as the same shrug was the problem.
      const perClass = (D.masteryAbilities || {})[build.klass] || {};
      const abilityRules = K.MASTERY_ABILITIES || {};
      const pct1 = v => (Math.round(v * 10) / 10);
      build.masteryBudget = { cap: CAP, spent, leftAtCapstone: pointsLeft,
                              bought: bought ? (perClass[bought.n.id] || {}).name || null : null,
                              capstonesTaken: build.masteryNodes.filter(id => byId[id].type === 'mastery').length,
                              statNodes:      build.masteryNodes.filter(id => byId[id].type === 'node').length };
      build.masteryPassedOver = considered
        .filter(x => !taken.has(x.n.id) && perClass[x.n.id])
        .map(x => {
          const name  = perClass[x.n.id].name;
          const rule  = abilityRules[name];
          const known = (rule && rule.kind !== 'note' && rule.value != null) ||
                        (!rule && perClass[x.n.id].bonus != null);
          // Order matters. A capstone worth nothing to this goal was not
          // skipped for want of points — it would have been skipped with the
          // whole tree free — so "it measured nothing" has to be checked before
          // "there was no room", or every answer collapses into the budget.
          let reason, detail;
          if (!known) {
            // Checked FIRST of all. An unpriced ability always measures zero, so
            // without this it gets reported as "your goal does not value it",
            // which blames the goal for a gap in the engine.
            reason = 'unmodelled';
            detail = 'this engine has no numbers for it, so it was never compared against anything ' +
                     '— a gap here, not a verdict on the ability';
          } else if (x.v <= 0.01) {
            reason = 'zero';
            detail = 'this goal does not read what it does, so the points went where they paid';
          } else if (bought && x.c <= pointsLeft) {
            reason = 'lost';
            detail = 'it measured +' + pct1(x.v) + '%, against +' + pct1(bought.v) + '% for ' +
                     build.masteryBudget.bought + ', and there were points for one of them';
          } else {
            // The interesting one, and the one that had no answer at all before:
            // genuinely worth something, and still not bought, because 35 points
            // is a real budget and everything else paid better per point.
            reason = 'value';
            const per = x.v / Math.max(x.c, 1);
            detail = 'it measured +' + pct1(x.v) + '% for the ' + x.c + ' points it costs to reach, ' +
                     'or ' + pct1(per) + '% a point' +
                     (marginalRatio != null
                       ? ', and every point this build did spend went to something worth more, down to ' +
                         pct1(marginalRatio) + '% a point'
                       : ', and the 35 points ran out before it');
          }
          return { id: x.n.id, name, value: x.v, cost: x.c, pointsLeft, reason, detail };
        })
        .sort((a, b) => b.value - a.value);
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
        const affine = classesForLevel(spec.level)
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
    function weaknessesOf(ctx, build) {
      const out = [];
      const lvl = Math.max(1, (build && build.level) || 50);

      if (ctx.hp < 120) out.push('almost no health (' + Math.round(ctx.hp) + ')');
      else if (ctx.hp < 200) out.push('low health (' + Math.round(ctx.hp) + ')');

      // Scaled to level, because a flat threshold stops meaning anything the
      // moment the damage model changes. It did: move scaling used to be
      // floored and added instead of multiplied, so every damage figure here
      // was a fraction of its real value and a flat "under 40" caught builds
      // that now legitimately hit for hundreds.
      //
      // A damage build at level 50 hits for well over a thousand. Anything under
      // roughly a tenth of that will not be killing things on its own, whatever
      // else it is good at.
      const killingPower = lvl * 6;
      if (ctx.bestHit < killingPower) {
        out.push('very little damage of your own (' + Math.round(ctx.bestHit) + ')');
      }

      // Applies to tanks too. A 10%-crit wall is a real thing to know about
      // before you take it into a fight you have to finish.
      if (ctx.critChance < 25) out.push('barely crits (' + Math.round(ctx.critChance) + '%)');

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
      // The panel makes this a required choice. Anything reaching the engine
      // without one is answered as solo, and told so — an unstated assumption
      // here silently changes which capstones are worth five points.
      if (spec.play !== 'team' && spec.play !== 'solo') {
        spec.play = 'solo';
        spec.assumptions.push('Assumed solo, since no play style was chosen. ' +
                              'Pick "Full team" if you play in a party — it changes which ' +
                              'mastery capstones are worth their five points.');
      }
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
      // A named class always wins. Otherwise the pool is only what this level
      // can be — and a weapon-type filter is intersected with it rather than
      // replacing it, or asking for a Spear at level 50 put Slayer back in.
      const allowed = classesForLevel(spec.level);
      let klasses;
      if (spec.klass) {
        klasses = [spec.klass];
      } else {
        const byWeapon = classesUsingWeapon(spec.weaponType);
        const pool = byWeapon ? byWeapon.filter(k => allowed.includes(k)) : allowed;
        klasses = pool.length ? pool : allowed;
      }
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
               weaknesses: weaknessesOf(bestCtx, best) };
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
             masteryAbilityTotals, classesForLevel };
  }

  return { Optimizer };
}));
