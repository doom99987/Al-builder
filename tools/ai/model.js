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
      covenant: '', covenantRank: 1,
      // Two scrolls and one lost scroll. share.js has always encoded these
      // three; nothing ever filled them, so every build the AI produced went out
      // with three empty slots.
      scroll1: '', scroll2: '', lostScroll: '',
      enchant: '',
      shards: [],
      mastery: {},         // { nodeId: true }
      corruption: '',
      buffs: {},           // toggles: which conditional passives are assumed live
    };
  }

  function Model(data) {
    const D = data;
    // `moveShape` runs BEFORE the scaling maths, because some effects replace a
    // move's base damage or its scaling outright rather than multiplying the
    // result — a Blade Dancer's rm1 turns Parry Counter from 8/STR-40 into
    // 12/STR-32, which no post-hoc damage multiplier can express.
    const hooks = { stat: [], critChance: [], damage: [], flatHP: [], moveShape: [] };

    // knowledge.js calls these. Each hook gets (build, value, ctx) and returns a
    // new value; ctx carries whatever the caller already computed so a hook never
    // has to recompute the pipeline.
    const register = {
      stat:       fn => hooks.stat.push(fn),
      critChance: fn => hooks.critChance.push(fn),
      damage:     fn => hooks.damage.push(fn),
      flatHP:     fn => hooks.flatHP.push(fn),
      moveShape:  fn => hooks.moveShape.push(fn),
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
      // Covenant rank-gated bonuses, which the site applies as step 3 of
      // updatePecents. There is exactly one entry in the table today - Way of
      // Life's +15% outgoing healing from rank 5 - and it was missing here for
      // as long as the engine never chose a covenant. The moment it does, a
      // healer build's outgoing healing has to agree with what the site shows.
      const cov = (D.covenantBonuses || {})[build.covenant];
      if (cov) {
        const rank = Math.min(20, Math.max(1, build.covenantRank | 0 || 1));
        for (const tier of cov) if (rank >= tier.minRank) add(tier.bonuses);
      }
      return sum;
    }

    // ── shared context ──────────────────────────────────────────────────
    // Every stat function needs the same handful of things: the armour block, the
    // merged gear contributions, mastery flats, the race base and the percentage
    // sources. Recomputing them per stat meant one derived() rebuilt the gear
    // tables about a dozen times and one moveDamage() rebuilt them five more —
    // tens of thousands of rebuilds per request. Build them once, pass them down.
    //
    // The context is a snapshot, so it is only valid while the build is
    // unchanged. Anything that mutates a build must take a fresh one.
    function statContext(build) {
      return {
        armour:   armourOf(build),
        gf:       gearFlat(build),
        mastery:  masteryFlat(build),
        race:     raceBase(build),
        lvlBonus: levelStatBonus(build.level),
        pct:      pctSources(build),
      };
    }

    // ── the core: getTotalStat ────────────────────────────────────────────────
    function totalStat(build, key, C) {
      C = C || statContext(build);
      const allocated = (build.invested || {})[key] || 0;
      const lvlBonus  = C.lvlBonus;
      const armour    = C.armour;
      const gf        = C.gf;

      const totalPct = (INNATE_PCT[key] ?? 0) + ((armour.pct || {})[key] ?? 0);
      const pctBase  = allocated + (C.race[key] ?? 0) + lvlBonus;
      // NOTE: round applies to the percentage part ONLY, before flats are added.
      const otherFlat = (armour[key] ?? 0) + (gf[key] ?? 0) + C.mastery[key];
      let total = Math.round(pctBase * (1 + totalPct / 100)) + (otherFlat || 0);

      const ctx = { key, allocated, lvlBonus, armour, gearFlat: gf };
      for (const fn of hooks.stat) total = fn(build, total, ctx);

      // Permuth multiplies the finished total, and does so BEFORE the SPD buffs
      // below — swapping these two changes a Focus Step build by ~40 points.
      if (build.permuth === key && build.mark === 'Venia') total = Math.round(total * 1.4);

      if (key === 'spd') {
        const b = build.buffs || {};
        const spdPct  = ((b.rallyingSpd ? 25 : 0) + (b.empPierceSpd ? 25 : 0));
        // Flourish is a flat 25 Speed in stance, and 48 with the Ranger's
        // Flourish Proficiency mastery (builder.js:3851, 6166).
        const spdFlat = (b.focusStepSpd ? Math.max(1, clampLvl(build.level)) * 2 : 0)
                      + (b.flourishSpd ? (b.flourishProf ? 48 : 25) : 0);
        if (spdPct || spdFlat) total = Math.round(total * (1 + spdPct / 100)) + spdFlat;
      }
      return total;
    }

    // Mastery grants its branch's stat per selected regular node — breakthroughs
    // and capstones grant none. Mirrors getMasteryStatBonuses (builder.js:7162),
    // including the 1.15 branch multiplier some classes carry.
    //
    // The class's own tree is used when it has one, otherwise the base class's,
    // matching getActiveMasteryData()'s super-then-base lookup.
    function masteryData(build) {
      const t = D.masteryClassData || {};
      if (build.klass && t[build.klass]) return t[build.klass];
      for (const [base, supers] of Object.entries(D.classes || {}))
        if ((supers || []).includes(build.klass) && t[base]) return t[base];
      return null;
    }

    function masteryFlat(build) {
      const out = { str: 0, arc: 0, end: 0, spd: 0, lck: 0 };
      const cd = masteryData(build);
      if (!cd || !cd.branchStats) return out;
      const chosen = build.masteryNodes;
      if (!chosen || !chosen.length) return out;
      const set = new Set(chosen);
      const mults = cd.branchMultipliers || {};
      for (const n of (D.masteryNodes || [])) {
        if (!set.has(n.id)) continue;
        if (n.type === 'breakthrough' || n.type === 'mastery') continue;
        const stat = cd.branchStats[n.branch];
        if (stat && out[stat] !== undefined) out[stat] += (mults[n.branch] ?? 1);
      }
      return out;
    }

    function allStats(build, C) {
      C = C || statContext(build);
      const o = {};
      for (const s of STATS) o[s] = totalStat(build, s, C);
      return o;
    }

    // ── the OTHER stat pipeline ───────────────────────────────────────────────
    // updatePecents() does not call getTotalStat. It derives its own `val`
    // (builder.js:1008-1021) and the two DISAGREE in two ways that matter:
    //
    //   1. no Math.round — getTotalStat rounds the percentage part and rounds
    //      again after Permuth; this path rounds neither
    //   2. armour percentages apply to str/arc/spd ONLY (STAT_PCT_KEYS), while
    //      getTotalStat applies them to every stat
    //
    // So the END behind your HP bar is not the END on your stat row whenever you
    // wear armour with an end%. That is the site's behaviour, not a mistake here,
    // and HP / heals / the identity stats must use THIS value to agree with it.
    const STAT_PCT_KEYS = new Set(['str', 'arc', 'spd']);

    function rawStat(build, key, C) {
      C = C || statContext(build);
      const armour = C.armour;
      const gf = C.gf;
      const allocated = (build.invested || {})[key] || 0;
      const lvlBonus  = C.lvlBonus;
      const otherFlat = (armour[key] ?? 0) + (C.mastery[key] ?? 0) + (gf[key] ?? 0);

      const totalPct = (INNATE_PCT[key] ?? 0)
                     + (STAT_PCT_KEYS.has(key) ? ((armour.pct || {})[key] ?? 0) : 0);

      let val = totalPct > 0
        ? (allocated + (C.race[key] ?? 0) + lvlBonus) * (1 + totalPct / 100) + otherFlat
        : allocated + (C.race[key] ?? 0) + otherFlat + lvlBonus;

      const b = build.buffs || {};
      if (b.coagStacks) val += b.coagStacks * 1.5;
      if (build.permuth === key && build.mark === 'Venia') val = val * 1.4;   // NOT rounded
      return val;
    }

    // Crit chance reads its own Luck total (builder.js:967). Unlike rawStat this
    // one DOES round after Permuth, and it is the only place Crystal Stars count.
    function rawLuck(build, C) {
      C = C || statContext(build);
      const armour = C.armour;
      const gf = C.gf;
      const b = build.buffs || {};
      let total = ((build.invested || {}).lck || 0)
                + (C.race.lck ?? 0)
                + (C.mastery.lck ?? 0)
                + (gf.lck ?? 0)
                + (armour.lck ?? 0)
                + C.lvlBonus
                + (b.crystalStarStacks || 0) * 10;
      if (b.coagStacks) total += b.coagStacks * 1.5;
      if (build.permuth === 'lck' && build.mark === 'Venia') total = Math.round(total * 1.4);
      return total;
    }

    // ── derived stats (updatePecents) ─────────────────────────────────────────
    function derived(build) {
      const C   = statContext(build);       // built ONCE, threaded everywhere below
      const s   = allStats(build, C);       // the STAT ROW values
      const pct = C.pct;
      const gf  = C.gf;
      const armour = C.armour;

      // Everything below uses rawStat, NOT `s`. updatePecents derives its own
      // unrounded totals and skips armour percentages outside str/arc/spd, so
      // reusing the stat-row value here disagreed with the site on HP and both
      // heal stats for every armour carrying an end%.
      const rawEnd = rawStat(build, 'end', C);

      // builder.js:1035-1038. END feeds a curve, the percentage sources multiply
      // that curve, and endFlat is added AFTER — it is flat HP, not flat END, so
      // it must never be folded into the stat total.
      //
      // The site rounds TWICE here and both roundings are observable:
      // calcPercentage() returns an already-toFixed(1) STRING for the END curve,
      // which updatePecents then parseFloats and rounds again after applying the
      // percentages. Rounding once leaves HP a tenth out on many builds.
      // Vital is percentage max health and the page adds it to the same bucket
      // as the armour and gear percentages (builder.js, the `end` branch).
      const _tr = siteTraitTotals(build);
      const hpBase = round1(45 + rawEnd * 1.00248);   // calcPercentage('end', val)
      const hpPct  = (pct.end ?? 0) + _tr.hpPct; // armour pct + gear pct + Vital
      let flatHP   = (armour.endFlat ?? 0) + (gf.endFlat ?? 0);
      for (const fn of hooks.flatHP) flatHP = fn(build, flatHP, { stats: s });
      const hp = hpBase * (1 + hpPct / 100) + flatHP;

      // Same double-rounding story, and then EVERY extra crit source on the page
      // (Stultus, Frozen Diadem, the Vastic proc, Stellian Core…) is applied with
      // its own toFixed(1). So round after the base and after each hook, not once
      // at the end.
      let critChance = round1(round1(rawLuck(build, C)) + (pct['crit-chance'] ?? 0));
      const ctx = { stats: s, pct };
      for (const fn of hooks.critChance) critChance = round1(fn(build, critChance, ctx));
      // Fortunate lands LAST on the page, after every other crit source, so it
      // rounds the same way here.
      if (_tr.critChance) critChance = round1(critChance + _tr.critChance);
      critChance = Math.max(0, critChance);   // a negative crit chance is not a thing

      const healPct = rawEnd / D.END_HEAL_DIVISOR;
      // Saint's cm1 mastery node grants +40% INCOMING healing and nothing else
      // (builder.js:1024). It is hardcoded in the site's own pipeline rather than
      // living in any data table, so it is replicated here rather than in
      // knowledge.js — the model's job is to mirror builder.js exactly.
      const saintIncHeal = (build.klass === 'Saint (Or)'
                            && (build.masteryNodes || []).includes('cm1')) ? 40 : 0;
      return {
        stats: s,
        _ctx: C,          // so callers can reuse it instead of rebuilding
        hp: round1(hp),
        critChance: round1(critChance),
        critDmg: critMultiplier(build),
        blockDr:    round1(rawStat(build, 'str', C) * D.STAT_IDENTITY_RATIO),
        // Conduit and Preemptive add on top of the identity formula, after its
        // own rounding — mirroring the page, which parses the formatted value
        // and then adds. Rounding once instead leaves these a tenth out.
        nrgChance:  round1(round1(rawStat(build, 'arc', C) * D.STAT_IDENTITY_RATIO) + _tr.nrgChance),
        initiative: round1(round1(rawStat(build, 'spd', C) * D.STAT_IDENTITY_RATIO) + _tr.initiative),
        outHeal: round1(100 + (pct['out-heal'] ?? 0) + healPct),
        incHeal: round1(100 + (pct['inc-heal'] ?? 0) + healPct + saintIncHeal),
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
    // Scaling strings are parsed the same way tens of thousands of times per
    // request — the same fifteen moves, over and over, through the search. The
    // strings are static game data, so the parse is memoised by string rather
    // than by move: overrides supply their own scaling strings and get the same
    // treatment for free.
    const _scaleCache = new Map();
    function scaleTerms(str) {
      let terms = _scaleCache.get(str);
      if (terms) return terms;
      terms = [];
      for (const m of String(str || '').matchAll(/([A-Za-z]{3})\s*\/\s*([\d.]+)/g)) {
        const stat = m[1].toLowerCase();
        const div  = parseFloat(m[2]);
        if (STATS.includes(stat) && div) terms.push([stat, div]);
      }
      _scaleCache.set(str, terms);
      return terms;
    }

    // Same for the damage string.
    const _dmgCache = new Map();
    function parseDamageCached(raw) {
      const key = String(raw);
      let v = _dmgCache.get(key);
      if (v === undefined) { v = parseDamage(raw); _dmgCache.set(key, v); }
      return v;
    }

    // The shape a move actually has on THIS build, after every override has had
    // its say. moveDamage has always applied these; nothing could ask what they
    // produced, so the write-up printed the raw data instead and a Blade Dancer
    // who had bought Flowing Dance Proficiency was told the move still scaled
    // STR/75 + SPD/75. The damage was right; the sentence next to it was not,
    // which reads exactly like the mastery doing nothing.
    //
    // Returns a plain object and never touches `move` — the move objects come
    // straight from the shared data snapshot and writing to one would leak into
    // every later build.
    function effectiveShape(build, move) {
      const parsed = parseDamageCached(move.damage);
      let base = parsed.base, hits = parsed.hits;
      let scaling = String(move.scaling || '');
      let second = null, changed = false;
      const notes = [];
      for (const fn of hooks.moveShape) {
        const sh = fn(build, { move, base, hits, scaling });
        if (!sh) continue;
        if (sh.note) notes.push(sh.note);
        if (sh.base !== undefined) { base = sh.base; changed = true; }
        if (sh.hits !== undefined) { hits = sh.hits; changed = true; }
        if (sh.scaling !== undefined && String(sh.scaling) !== scaling) {
          scaling = String(sh.scaling); changed = true;
        }
        if (sh._second) { second = sh._second; changed = true; }
      }
      return { base, hits, scaling, second, changed, notes,
               rawBase: parsed.base, rawHits: parsed.hits, rawScaling: String(move.scaling || '') };
    }

    function moveDamage(build, move, opts) {
      opts = opts || {};
      // Reuse the caller's stats when it has them. Recomputing all five per move
      // was the hottest path in the engine — roughly 20k recomputations per
      // request, each rebuilding the gear tables from scratch.
      const s = opts.stats || allStats(build, opts.ctx);
      let parsed = parseDamageCached(move.damage);
      // Class and mastery overrides get to rewrite the move first. Everything
      // below then works on the shape the game actually uses.
      let scalingStr = String(move.scaling || '');
      let second = null;      // a move that is really two attacks, summed
      for (const fn of hooks.moveShape) {
        const sh = fn(build, { move, base: parsed.base, hits: parsed.hits, scaling: scalingStr });
        if (!sh) continue;
        if (sh.base    !== undefined) parsed = { base: sh.base, hits: sh.hits !== undefined ? sh.hits : parsed.hits };
        else if (sh.hits !== undefined) parsed = { base: parsed.base, hits: sh.hits };
        if (sh.scaling !== undefined) scalingStr = String(sh.scaling);
        if (sh._second) second = sh._second;
      }

      // builder.js:4080-4085 and the damage detail line it prints:
      //
      //     1(1 + STR(236)/100) = 3.4  x 20 hits = 67.2
      //
      // The contributions of every named stat are SUMMED, and the total
      // MULTIPLIES the base. It is not floored and it is not added.
      //
      // This was previously `base + floor(stat/div)` per term, which is wrong
      // three ways over, and wrong worst exactly where it matters: Carnage is
      // "1x20", so floor(STR/100) on a base of 1 threw away the entire stat
      // contribution below 100 STR and most of it above. A Berserker's damage
      // did not move when you gave it Strength, so the optimiser learned to put
      // nothing there and pour everything into crit instead.
      let contrib = 0;
      for (const [stat, div] of scaleTerms(scalingStr)) contrib += s[stat] / div;
      let dmg = parsed.base * (1 + contrib);
      // The second half of a two-part attack, scaled on its own terms and added.
      if (second) {
        let c2 = 0;
        for (const [st, dv] of scaleTerms(second.scaling)) c2 += s[st] / dv;
        dmg += (second.base || 0) * (1 + c2);
      }

      const ctx = { move, stats: s, base: parsed.base, hits: parsed.hits };
      for (const fn of hooks.damage) dmg = fn(build, dmg, ctx);
      // Scaling applies per hit, so the multiplier comes last.
      dmg *= parsed.hits;
      if (opts.hits && opts.hits.length) dmg *= opts.hits.reduce((a, b) => a + b, 0);
      return dmg;
    }

    // How much a healing move actually heals, before the outgoing-healing
    // multiplier. Identical shape to moveDamage - the game writes healing the
    // same way it writes damage, `healing: 15` with `scaling: "STR/100 + ARC/100"`
    // - and until now nothing anywhere computed it. The engine knew a Saint had
    // a bigger healing PERCENTAGE and had no idea Holy Grace existed.
    function moveHealing(build, move) {
      if (!move || move.healing == null || move.healing === 'N/A') return 0;
      const base = parseFloat(move.healing);
      if (!isFinite(base)) return 0;
      const d = derived(build);
      let contrib = 0;
      for (const [stat, div] of scaleTerms(String(move.scaling || ''))) contrib += d.stats[stat] / div;
      // Some heals carry a slice of your own max HP on top of the scaled base -
      // Holy Grace is "18 + 4%". That term is why Endurance is a HEALING stat on
      // a Saint twice over: once through the END/4 heal percentage, and again
      // because the heal itself is a fraction of the health it just bought.
      const pctHp = parseFloat(move.healingPctHp);
      const flat = isFinite(pctHp) ? (d.hp * pctHp / 100) : 0;
      return base * (1 + contrib) + flat;
    }

    // The site prints these with toFixed(1). toFixed and Math.round disagree on
    // binary halfway values (74.05 -> "74.0" vs 74.1), which showed up as a
    // scatter of exactly-0.1 mismatches. Round the way the page does.
    const round1 = v => parseFloat(v.toFixed(1));

    // ── traits ───────────────────────────────────────────────────────────────
    // FOUR of these are now computed by the site itself (builder.js
    // TRAIT_APPLIES_TO), so they belong INSIDE derived() where they keep
    // matching the page. The rest remain an overlay: the site stores and
    // displays them but no number on it moves.
    //
    // Keeping the split explicit matters because getting it wrong is silent —
    // count a site-applied trait in both places and every crit build reports a
    // crit chance the page will not show.
    const TRAIT_SITE_APPLIES = {
      conduit:    'nrgChance',
      fortunate:  'critChance',
      preemptive: 'initiative',
      vital:      'hpPct',
    };

    // Raw per-trait totals, with the table's own stacking rules. Shared by both
    // the site-applied path and the overlay so they cannot disagree.
    function traitRawTotals(build) {
      const defs = D.gearTraits || {};
      const fixed = new Set(D.FIXED_GEAR || []);
      const per = {};
      const collect = (slot, isArtifact) => {
        if (!slot) return;
        // A fixed gear rolls no traits, exactly as the editor enforces.
        if (!isArtifact && slot.name && fixed.has(slot.name)) return;
        for (const t of slot.traits || []) {
          if (!t || !t.id) continue;
          const def = defs[t.id];
          if (!def) continue;
          if (isArtifact && def.gearOnly) continue;
          (per[t.id] = per[t.id] || []).push(Math.min(2, Math.max(1, t.tier | 0)));
        }
      };
      (build.gear || []).forEach(g => collect(g, false));
      collect(build.artifact, true);

      const out = {};
      for (const [id, tiers] of Object.entries(per)) {
        const def = defs[id];
        const per1 = tiers.map(t => (t >= 2 ? def.t2 : def.t1));
        let total = def.noStack ? Math.max(...per1) : per1.reduce((a, b) => a + b, 0);
        if (def.cap != null) total = Math.min(def.cap, total);
        out[id] = { total, copies: tiers.length };
      }
      return out;
    }

    // Only the four the page itself applies.
    function siteTraitTotals(build) {
      const raw = traitRawTotals(build);
      const out = { critChance: 0, initiative: 0, hpPct: 0, nrgChance: 0 };
      for (const [id, kind] of Object.entries(TRAIT_SITE_APPLIES)) {
        if (raw[id]) out[kind] += raw[id].total;
      }
      return out;
    }

    // ── trait overlay (the site does NOT compute these) ──────────────────────
    //
    // Aggregation rules come from the trait table itself: `noStack` means extra
    // copies are worth nothing, `cap` limits the total, and `gearOnly` traits
    // cannot sit on an artifact.
    function traitTotals(build, K) {
      const defs = D.gearTraits || {};
      const rules = (K && K.TRAITS) || {};
      const raw = traitRawTotals(build);

      const out = { critChance: 0, critDmgPct: 0, hpPct: 0, energyCap: 0,
                    initiative: 0, dmgPct: 0, dr: 0, active: [], unmodelled: [] };

      for (const [id, agg] of Object.entries(raw)) {
        const def = defs[id], rule = rules[id] || {};
        const total = agg.total;

        // Already in derived(): counting it here too would report a figure the
        // page does not show. Still listed as active so the write-up names it.
        if (TRAIT_SITE_APPLIES[id]) {
          out.active.push({ id, name: def.name, total, effective: total,
                            copies: agg.copies, onSite: true, when: rule.when || null });
          continue;
        }

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
                          copies: agg.copies, when: rule.when || null });
      }
      return out;
    }

    // Shard bonuses. The builder de-duplicates shards by name, so a second copy
    // of the same shard is worth nothing there — see the "Duplicate shards" trap.
    // The optimiser therefore only ever fits DISTINCT shards, which with 7 slots
    // and 14 shards is the better play regardless.
    function shardTotals(build, K) {
      const defs = D.shardItems || {};
      const rules = (K && K.SHARDS) || {};
      const out = { dmgPct: 0, lifesteal: 0, active: [], unmodelled: [] };
      const seen = new Set();
      for (const name of build.shards || []) {
        if (!name || seen.has(name)) continue;      // dedup, as the builder does
        seen.add(name);
        const def = defs[name];
        if (!def) continue;
        const rule = rules[def.bonusType];
        const val = def.rVal != null ? def.rVal : def.pVal;
        if (!rule || rule.kind === 'note' || val == null) {
          out.unmodelled.push({ name, note: (rule && rule.note) || def.bonusType });
          continue;
        }
        const eff = val * (rule.stacks || 1) * (rule.uptime ?? 1);
        if (out[rule.kind] !== undefined) out[rule.kind] += eff;
        out.active.push({ name, value: val, effective: eff, note: rule.note });
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
      STATS, emptyBuild, data: D, register, effectiveShape,
      totalStat, allStats, derived, moveDamage, moveHealing,
      traitRawTotals, siteTraitTotals,
      critTier, critMultiplier, expectedMultiplier,
      pointBudget, levelStatBonus, gearContributions, gearFlat, pctSources,
      shapesFor, allocForShape, traitTotals, shardTotals, energyCap, parseDamage, parseCost,
      weaponIsTiered: weaponHasTiers,
      statContext, masteryData, masteryFlat,
      rawStat, rawLuck,
    };
  }

  return { Model, STATS, emptyBuild };
}));
