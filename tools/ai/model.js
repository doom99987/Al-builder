/*
  The math layer — a headless replica of the builder's stat pipeline.

  Every number the engine reports comes from here, so this file has exactly one
  job: agree with js/builder.js to the decimal. Where the two disagree the engine
  is wrong, not the site. verify.js diffs them against the live page; run it after
  touching anything in here.

  The pipeline mirrors getTotalStat() (builder.js:3930) and the derived-stat pass
  in updatePecents() (builder.js:1020). Order of operations is load-bearing:
  rounding happens at specific points and moving one changes results by whole
  points. Do not "simplify" the arithmetic.

  Expandability: this file implements the SKELETON only. Every item quirk —
  Stultus crit conversion, Coagulated Finger Nail, the Vastic proc — is a hook
  registered from knowledge.js, never a branch in here. Adding an item's special
  behaviour should not require touching the math.

  Works in Node and the browser.
*/
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ALB_Model = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  const STATS = ['str', 'arc', 'end', 'spd', 'lck'];
  const INNATE_PCT = { str: 15, arc: 15 };

  // ── build shape ───────────────────────────────────────────────────────────
  // A build is a plain object. Everything is optional; missing pieces are simply
  // worth nothing, which is what lets a half-specified request still score.
  function emptyBuild() {
    return {
      level: 50,
      race: '', klass: '', sub: '',
      invested: { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
      armour: '',
      gear: [],            // [{ name, tier, alloc:{str..} }]
      artifact: null,      // { name, tier, alloc }
      weapon: null,        // { name, tier, alloc }
      offhand: null,
      mark: '', permuth: '',
      enchant: '',
      shards: [],
      mastery: {},         // { nodeId: true }
      corruption: '',
      buffs: {},           // toggles: which conditional passives are assumed live
    };
  }

  function Model(data) {
    const D = data;
    const hooks = { stat: [], critChance: [], damage: [], flatHP: [] };

    // knowledge.js calls these. Each hook gets (build, value, ctx) and returns a
    // new value; ctx carries whatever the caller already computed so a hook never
    // has to recompute the pipeline.
    const register = {
      stat:       fn => hooks.stat.push(fn),
      critChance: fn => hooks.critChance.push(fn),
      damage:     fn => hooks.damage.push(fn),
      flatHP:     fn => hooks.flatHP.push(fn),
    };

    const clampLvl = lvl => Math.min(D.Max_Lvl, Math.max(D.Min_Lvl, lvl || D.Min_Lvl));
    const levelStatBonus = lvl => Math.floor(clampLvl(lvl) / D.LEVEL_STAT_BONUS_EVERY);

    // Total stat points available to spend. Dullahan's +3 per 10 levels is the
    // only racial exception in the builder.
    function pointBudget(build) {
      const lvl = clampLvl(build.level);
      return lvl * D.POINTS_PER_LEVEL
           + (build.race === 'Dullahan (1%)' ? Math.floor(lvl / 10) * 3 : 0);
    }

    const raceBase = build => D.races[build.race] || { str: 0, arc: 0, end: 0, spd: 0, lck: 0 };
    const armourOf = build => D.armourItems[build.armour] || {};

    // Only weapons from the tiered SERIES roll tier points; a Ferrus Spear is
    // just a Ferrus Spear. Mirrors tieredWeaponNames() (builder.js:655). Getting
    // this wrong silently hands every weapon up to 5 free stat points.
    const _tieredWeapons = (() => {
      const s = new Set();
      const tieredSeries = new Set(D.TIERED_WEAPON_SERIES || []);
      for (const [series, items] of Object.entries(D.mainWeaponSeries || {}))
        if (tieredSeries.has(series)) for (const n of Object.keys(items || {})) s.add(n);
      for (const n of (D.TIERED_OFFHAND_NAMES || [])) s.add(n);
      return s;
    })();
    const weaponHasTiers = name => !!name && _tieredWeapons.has(name);

    // Every tiered slot contributes base stats + the points its tier granted.
    // Weapons and artifacts have no base stat block, so for them it is tier only.
    function gearContributions(build) {
      const out = [];
      const push = (entry, kind) => {
        if (!entry || !entry.name) return;
        const base  = (kind === 'gear' ? D.gearItems[entry.name] : D[kind + 'Items']?.[entry.name]) || {};
        const alloc = entry.alloc || {};
        const stats = {};
        for (const [k, v] of Object.entries(base)) {
          if (!v) continue;
          if (STATS.includes(k) || k === 'endFlat') stats[k] = (stats[k] || 0) + v;
        }
        // A fixed gear keeps its base block but takes no tier points, however the
        // build claims otherwise; a non-tiered weapon series takes none either.
        const tiered = kind === 'gear'   ? !(D.FIXED_GEAR || []).includes(entry.name)
                     : kind === 'weapon' ? weaponHasTiers(entry.name)
                     : true;             // artifacts always tier
        if (tiered) for (const s of STATS) if (alloc[s]) stats[s] = (stats[s] || 0) + alloc[s];
        out.push({ name: entry.name, kind, stats });
      };
      (build.gear || []).forEach(g => push(g, 'gear'));
      push(build.artifact, 'artifact');
      push(build.weapon, 'weapon');
      push(build.offhand, 'weapon');
      return out;
    }

    function gearFlat(build) {
      const sum = {};
      for (const c of gearContributions(build))
        for (const [k, v] of Object.entries(c.stats)) sum[k] = (sum[k] || 0) + v;
      return sum;
    }

    // Percentage bonuses that ride on derived stats rather than raw stats.
    function pctSources(build) {
      const sum = {};
      const add = obj => { for (const [k, v] of Object.entries(obj || {})) sum[k] = (sum[k] || 0) + v; };
      add((D.armourItems[build.armour] || {}).pct);
      if (build.weapon)  add(D.weaponBonuses[build.weapon.name]);
      if (build.offhand) add(D.weaponBonuses[build.offhand.name]);
      for (const g of build.gear || []) add(D.gearPctBonuses?.[g.name]);
      return sum;
    }

    // ── the core: getTotalStat ────────────────────────────────────────────────
    function totalStat(build, key) {
      const allocated = (build.invested || {})[key] || 0;
      const lvlBonus  = levelStatBonus(build.level);
      const armour    = armourOf(build);
      const gf        = gearFlat(build);

      const totalPct = (INNATE_PCT[key] ?? 0) + ((armour.pct || {})[key] ?? 0);
      const pctBase  = allocated + (raceBase(build)[key] ?? 0) + lvlBonus;
      // NOTE: round applies to the percentage part ONLY, before flats are added.
      const otherFlat = (armour[key] ?? 0) + (gf[key] ?? 0) + masteryFlat(build)[key];
      let total = Math.round(pctBase * (1 + totalPct / 100)) + (otherFlat || 0);

      const ctx = { key, allocated, lvlBonus, armour, gearFlat: gf };
      for (const fn of hooks.stat) total = fn(build, total, ctx);

      // Permuth multiplies the finished total, and does so BEFORE the SPD buffs
      // below — swapping these two changes a Focus Step build by ~40 points.
      if (build.permuth === key && build.mark === 'Venia') total = Math.round(total * 1.4);

      if (key === 'spd') {
        const b = build.buffs || {};
        const spdPct  = ((b.rallyingSpd ? 25 : 0) + (b.empPierceSpd ? 25 : 0));
        const spdFlat = (b.focusStepSpd ? Math.max(1, clampLvl(build.level)) * 2 : 0);
        if (spdPct || spdFlat) total = Math.round(total * (1 + spdPct / 100)) + spdFlat;
      }
      return total;
    }

    function masteryFlat(build) {
      // Mastery grants +1 to its branch stat per regular node. knowledge.js owns
      // which branch is which stat per class; absent that, it contributes nothing
      // rather than guessing.
      const out = { str: 0, arc: 0, end: 0, spd: 0, lck: 0 };
      const m = build._masteryStats;
      if (m) for (const k of STATS) out[k] += m[k] || 0;
      return out;
    }

    function allStats(build) {
      const o = {};
      for (const s of STATS) o[s] = totalStat(build, s);
      return o;
    }

    // ── derived stats (updatePecents) ─────────────────────────────────────────
    function derived(build) {
      const s   = allStats(build);
      const pct = pctSources(build);
      const gf  = gearFlat(build);
      const armour = armourOf(build);

      // builder.js:1035-1038. END feeds a curve, the percentage sources multiply
      // that curve, and endFlat is added AFTER — it is flat HP, not flat END, so
      // it must never be folded into the stat total.
      const hpBase = 45 + s.end * 1.00248;
      const hpPct  = pct.end ?? 0;               // armour pct + gear pct, already summed
      let flatHP   = (armour.endFlat ?? 0) + (gf.endFlat ?? 0);
      for (const fn of hooks.flatHP) flatHP = fn(build, flatHP, { stats: s });
      const hp = hpBase * (1 + hpPct / 100) + flatHP;

      let critChance = s.lck + (pct['crit-chance'] ?? 0);
      const ctx = { stats: s, pct };
      for (const fn of hooks.critChance) critChance = fn(build, critChance, ctx);
      critChance = Math.max(0, critChance);   // a negative crit chance is not a thing

      return {
        stats: s,
        hp: round1(hp),
        critChance: round1(critChance),
        critDmg: critMultiplier(build),
        blockDr:    round1(s.str * D.STAT_IDENTITY_RATIO),
        nrgChance:  round1(s.arc * D.STAT_IDENTITY_RATIO),
        initiative: round1(s.spd * D.STAT_IDENTITY_RATIO),
        outHeal: round1(100 + (pct['out-heal'] ?? 0) + s.end / D.END_HEAL_DIVISOR),
        incHeal: round1(100 + (pct['inc-heal'] ?? 0) + s.end / D.END_HEAL_DIVISOR),
      };
    }

    // Crit damage is a FLAT base (2) plus percentage sources — it does not grow
    // with crit tier. The tier multiplier is separate and layers on top.
    function critMultiplier(build) {
      const pct = pctSources(build);
      return D.CRIT_DMG_BASE + (pct['crit-dmg'] ?? 0);
    }

    // Overcrit tier, per buildOvercritLines (builder.js:4067). Note what counts
    // as GUARANTEED: orange needs tier >= 2, i.e. 200 crit chance, not 100.
    // Between thresholds the next colour is a chance roll equal to the overflow.
    const critTier = critChance => Math.floor(critChance / 100);

    // Expected damage multiplier for one hit.
    //
    //   below 100   the usual blend, matching getExpectedMultiHitDmg()
    //   at/above    the crit is guaranteed at critMult, and the overflow is the
    //               chance of stepping up a colour: orange x2, red x3, purple x4
    //               of critMult. So the expectation is critMult x (tier + p).
    //
    //   cc 100 -> critMult x 1     guaranteed crit, no overcrit
    //   cc 150 -> critMult x 1.5   half the hits orange
    //   cc 200 -> critMult x 2     guaranteed orange
    //   cc 313 -> critMult x 3.13  guaranteed red, 13% purple
    function expectedMultiplier(critChance, critMult) {
      if (critChance <= 100) return 1 + (critChance / 100) * (critMult - 1);
      const tier = Math.floor(critChance / 100);
      const p    = (critChance % 100) / 100;
      return critMult * (tier + p);
    }

    // Base damage and hit count. `damage` is usually a number but may be a
    // multi-hit string like "1x20" (Carnage) or "5x2" (Double Slash). Mirrors
    // builder.js:4207. Treating those as numbers yields NaN, which silently
    // dropped every multi-hit move from consideration — and they are exactly the
    // big ones.
    function parseDamage(raw) {
      if (raw === undefined || raw === null) return { base: 0, hits: 1 };
      const str = String(raw);
      const multi = str.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+)$/i);
      if (multi) return { base: +multi[1], hits: +multi[2] };
      if (/^\d+(\.\d+)?$/.test(str)) return { base: +str, hits: 1 };
      return { base: 0, hits: 1 };     // "5x(Darkcores)" and friends — unscoreable
    }

    // Energy cost, which may be written "3+X" for moves that consume the pool.
    function parseCost(raw) {
      if (typeof raw === 'number') return raw;
      const n = parseInt(String(raw), 10);
      return isNaN(n) ? 0 : n;
    }

    // Move damage. scaling is written "STR/75" style in the move data.
    function moveDamage(build, move, opts) {
      opts = opts || {};
      const s = allStats(build);
      const parsed = parseDamage(move.damage);
      let dmg = parsed.base;
      // Scaling can name several stats — "STR/80 + SPD/80" is one term per stat,
      // each floored separately. Matching only the first silently halved every
      // dual-scaling move, which is most of the interesting ones.
      const sc = String(move.scaling || '');
      for (const m of sc.matchAll(/([A-Za-z]{3})\s*\/\s*([\d.]+)/g)) {
        const stat = m[1].toLowerCase();
        const div  = parseFloat(m[2]);
        if (STATS.includes(stat) && div) dmg += Math.floor(s[stat] / div);
      }
      const ctx = { move, stats: s, base: parsed.base, hits: parsed.hits };
      for (const fn of hooks.damage) dmg = fn(build, dmg, ctx);
      // Scaling applies per hit, so the multiplier comes last.
      dmg *= parsed.hits;
      if (opts.hits && opts.hits.length) dmg *= opts.hits.reduce((a, b) => a + b, 0);
      return dmg;
    }

    const round1 = v => Math.round(v * 10) / 10;

    // ── traits (OVERLAY — the site does not compute these) ───────────────────
    // builder.js tracks traits for share links and shows their labels, but no
    // stat or damage number on the site includes them. Everything below is the
    // engine's own layer, kept out of totalStat/derived so those keep matching
    // the site exactly. Anything using it must say the site will not agree.
    //
    // Aggregation rules come from the trait table itself: `noStack` means extra
    // copies are worth nothing, `cap` limits the total, and `gearOnly` traits
    // cannot sit on an artifact.
    function traitTotals(build, K) {
      const defs = D.gearTraits || {};
      const rules = (K && K.TRAITS) || {};
      const copies = {};
      const collect = (slot, isArtifact) => {
        for (const t of (slot && slot.traits) || []) {
          if (!t || !t.id) continue;
          const def = defs[t.id];
          if (!def) continue;
          if (isArtifact && def.gearOnly) continue;   // illegal placement, ignore
          (copies[t.id] = copies[t.id] || []).push(Math.min(2, Math.max(1, t.tier | 0)));
        }
      };
      (build.gear || []).forEach(g => collect(g, false));
      collect(build.artifact, true);

      const out = { critChance: 0, critDmgPct: 0, hpPct: 0, energyCap: 0,
                    initiative: 0, dmgPct: 0, dr: 0, active: [], unmodelled: [] };

      for (const [id, tiers] of Object.entries(copies)) {
        const def = defs[id], rule = rules[id] || {};
        const per = tiers.map(t => (t >= 2 ? def.t2 : def.t1));
        let total = def.noStack ? Math.max(...per) : per.reduce((a, b) => a + b, 0);
        if (def.cap != null) total = Math.min(def.cap, total);

        if (rule.modelled === false || !rule.kind) {
          out.unmodelled.push({ id, name: def.name, total, note: rule.note || def.desc });
          continue;
        }
        // Conditional traits are discounted by their assumed uptime rather than
        // counted in full — otherwise "damage below half health" outbids a flat
        // bonus that always applies.
        const eff = rule.modelled === 'conditional' ? total * (rule.uptime ?? 0.5) : total;
        if (out[rule.kind] !== undefined) out[rule.kind] += eff;
        out.active.push({ id, name: def.name, total, effective: eff,
                          copies: tiers.length, when: rule.when || null });
      }
      return out;
    }

    // Maximum energy. Overflow is the only source the data exposes.
    function energyCap(build, K) {
      const base = ((K && K.ENERGY) || {}).base || 5;
      return base + Math.round(traitTotals(build, K).energyCap || 0);
    }

    // ── tier helpers ──────────────────────────────────────────────────────────
    // A tier grants one of a fixed set of SHAPES, not loose points. Stats in a
    // shape must all differ, so no stat takes two values from one shape.
    function shapesFor(tier, isWeapon) {
      const cap = isWeapon ? D.MAX_WEAPON_TIER : D.MAX_GEAR_TIER;
      return D.GEAR_TIER_SHAPES[Math.min(cap, Math.max(0, tier | 0))] || [[]];
    }
    // Best single-stat allocation available at a tier: the largest shape value,
    // or the whole shape spread if several stats are wanted.
    function allocForShape(shape, statPriority) {
      const alloc = {};
      shape.forEach((v, i) => { const st = statPriority[i]; if (st) alloc[st] = (alloc[st] || 0) + v; });
      return alloc;
    }

    return {
      STATS, emptyBuild, data: D, register,
      totalStat, allStats, derived, moveDamage,
      critTier, critMultiplier, expectedMultiplier,
      pointBudget, levelStatBonus, gearContributions, gearFlat, pctSources,
      shapesFor, allocForShape, traitTotals, energyCap, parseDamage, parseCost,
    };
  }

  return { Model, STATS, emptyBuild };
}));
