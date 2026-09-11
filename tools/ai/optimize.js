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
      // AVOID is a different claim from UNAVAILABLE — "we do not recommend it"
      // rather than "the game will not let you" — but it removes an item from
      // the search in exactly the same way, so it resolves into the same lookup.
      const out = Object.assign({}, U.items || {}, K.AVOID || {});
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

    // A covenant's attacks. Cult of Thanasius's Death Curtain is a 6x2 scaling
    // on STR/75 AND ARC/75, which is a real move in a rotation and was invisible
    // to the engine because covenantMoves was never even extracted.
    //
    // Gated on RANK, the same way the site gates them: at rank 1 you have the
    // rank 1 move and nothing else.
    const _covMoveCache = {};
    function covenantMovesFor(name, rank) {
      if (!name) return [];
      const key = name + '|' + (rank | 0);
      if (_covMoveCache[key]) return _covMoveCache[key];
      const entry = (D.covenantMoves || {})[name];
      const out = [];
      for (const mv of ((entry || {}).learns || [])) {
        if (mv.type !== 'Active' || mv.damage === undefined) continue;
        if ((mv.level || 1) > (rank | 0)) continue;
        out.push(mv);
      }
      return (_covMoveCache[key] = out);
    }

    // Scrolls: two ordinary, one lost. Both lists are gated on the BASE class,
    // not the superclass, which is why a Saint can carry Breath of Fungyir - it
    // is a Slayer underneath.
    const _scrollCache = {};
    function scrollsFor(klass) {
      if (_scrollCache[klass]) return _scrollCache[klass];
      const base = baseOf(klass) || klass;
      const allowed = (table, name) => {
        const list = (D[table] || {})[name];
        return !list || list.indexOf(base) !== -1;
      };
      return (_scrollCache[klass] = {
        scrolls: Object.keys(D.scrollItems || {})
                   .filter(n => allowed('scrollClassRestrictions', n) && usable(n)),
        lost:    Object.keys(D.lostScrollItems || {})
                   .filter(n => allowed('lostScrollClassRestrictions', n) && usable(n)),
      });
    }

    // The attack a scroll or a subclass grants. Same filter movesFor uses, plus
    // one more: subclass utilities carry the STRING "N/A" in the damage field
    // rather than leaving it out, and that is not a number.
    function grantedMoves(table, name) {
      const entry = (D[table] || {})[name];
      const out = [];
      for (const mv of ((entry || {}).learns || [])) {
        if (mv.type !== 'Active' || mv.damage === undefined ||
            mv.damage === null || mv.damage === 'N/A') continue;
        out.push(mv);
      }
      return out;
    }

    // What this build actually DOES, read from its own kit. Used to decide
    // whether an item's passive can ever fire for it — see GEAR_NEEDS.
    const _doesCache = {};
    // A bounded memo: `keyOf(build)` names what `fn` actually reads. Cleared
    // outright when it grows, which is simpler than an LRU and just as good
    // for a search that revisits the same few thousand shapes.
    function memo(keyOf, fn, cap) {
      const cache = new Map();
      return (build, extra) => {
        const key = keyOf(build, extra);
        if (cache.has(key)) return cache.get(key);
        if (cache.size > (cap || 4000)) cache.clear();
        const v = fn(build, extra);
        cache.set(key, v);
        return v;
      };
    }
    const wornKey = build => (build.gear || []).map(g => g.name).join(',') + '|' +
                             (build.artifact ? build.artifact.name : '') + '|' +
                             (build.weapon ? build.weapon.name : '') + '|' +
                             (build.klass || '') + '|' + (build.race || '');

    // Status words as the kit writes them, folded to one name each.
    const STATUS_FOLD = { bleeding: 'bleed', poisoned: 'poison', burning: 'burn', inferno: 'burn',
                          stunned: 'stun', hexed: 'hex', chilled: 'cold', frozen: 'cold' };
    const foldStatus = w => STATUS_FOLD[w] || w;

    function buildDoes(build) {
      const key = [build.klass, build.race, build.sub || '', build.covenant || '',
                   build.covenantRank | 0, build.scroll1 || '', build.scroll2 || '',
                   build.lostScroll || ''].join('|');
      if (_doesCache[key]) return _doesCache[key];

      const elements = new Set();
      // What the kit puts on the enemy, and what it puts on YOU. Both matter:
      // Reversing and Lasting Life read your own statuses, Shattering and Tear
      // Blood Crystal read the enemy's.
      const enemyStatuses = new Set(), selfStatuses = new Set();
      let summons = false, poison = false;
      const words = (K.STATUS_WORDS || []).filter(w => !/ /.test(w));
      const note = mv => {
        // Elements come from ATTACKS only. An item that puts a status on your
        // Magic attacks gains nothing from a Magic BUFF, and counting one let
        // Breath of Fungyir - a once-per-20-turns team heal that happens to be
        // typed Magic - keep Madseer's Codex alive on a Holy healer.
        const isAttack = mv.damage !== undefined && mv.damage !== null && mv.damage !== 'N/A';
        if (isAttack && mv.moveType) elements.add(String(mv.moveType).toLowerCase());
        const text = String(mv.name || '') + ' ' + String(mv.quote || '') + ' ' + String(mv.effect || '');
        // Deliberately narrow. A bare "call " matched "Call upon cleansing
        // light" and convinced the engine that a Saint had summons.
        if (/summons?\b|skeleton|sylph|darkbeast|raise dead/i.test(text)) summons = true;
        if (/\bpoison/i.test(text)) poison = true;
        // "applies 2 Bleeding to yourself and the enemy" is both lists at once.
        const lower = text.toLowerCase();
        if (/\b(appl(?:y|ies)|inflicts?|grants?|puts?)\b/.test(lower)) {
          const onSelf = /\b(to|on) (yourself|you)\b/.test(lower);
          for (const w of words) {
            if (!new RegExp('\\b' + w + '\\b').test(lower)) continue;
            const st = foldStatus(w);
            if (isAttack || !onSelf) enemyStatuses.add(st);
            if (onSelf) selfStatuses.add(st);
          }
        }
      };
      const scan = e => { for (const mv of ((e || {}).learns || [])) note(mv);
                          for (const p of ((e || {}).innatePassives || [])) note(p); };
      scan((D.classMoves || {})[build.klass]);
      const base = baseOf(build.klass);
      if (base && base !== build.klass) scan((D.classMoves || {})[base]);
      if (build.sub) scan((D.classMoves || {})[build.sub]);
      scan((D.raceMoves || {})[build.race]);
      if (build.covenant) scan((D.covenantMoves || {})[build.covenant]);
      for (const n of [build.scroll1, build.scroll2]) if (n) scan((D.scrollMoves || {})[n]);
      if (build.lostScroll) scan((D.lostScrollMoves || {})[build.lostScroll]);

      return (_doesCache[key] = { elements, summons, poison, enemyStatuses, selfStatuses });
    }

    // The kit's statuses plus the ones worn gear and the weapon add (Ptera's
    // Heart poisons both sides; Sandstone sunders). One place, so a passive
    // gated on a status and a shard counting them read the same answer.
    const statusesOf = memo(
      b => [b.klass, b.race, b.sub || '', b.covenant || '', b.covenantRank | 0, b.scroll1 || '',
            b.scroll2 || '', b.lostScroll || '', wornKey(b)].join('|'),
      build => statusesOfUncached(build));
    function statusesOfUncached(build) {
      const does = buildDoes(build);
      const self = new Set(does.selfStatuses), enemy = new Set(does.enemyStatuses);
      const add = rule => {
        if (!rule || rule.kind !== 'status') return;
        for (const st of (rule.self || [])) self.add(foldStatus(st));
        for (const st of (rule.enemy || [])) enemy.add(foldStatus(st));
      };
      for (const g of build.gear || []) add((K.GEAR_PASSIVES || {})[g.name]);
      if (build.artifact) add((K.GEAR_PASSIVES || {})[build.artifact.name]);
      const wpn = build.weapon && build.weapon.name;
      if (wpn) add((K.WEAPON_PASSIVES || {})[((D.weapons || {})[wpn] || {}).series]);
      return { self, enemy };
    }

    // Can this item's passive ever fire for this build? Returns null when there
    // is nothing to say, or the reason it cannot.
    //
    // Split into two questions, because they are two different claims:
    //   inertFor   the passive CANNOT fire. The item is stat block only.
    //   cautionFor it fires and there is a catch worth printing.
    function inertFor(name, build, spec) {
      if (K.gearNeedIsCaution && K.gearNeedIsCaution(name)) return null;
      return needUnmet(name, build, spec);
    }

    function cautionFor(name, build, spec) {
      if (!(K.gearNeedIsCaution && K.gearNeedIsCaution(name))) return null;
      return needUnmet(name, build, spec);
    }

    function needUnmet(name, build, spec) {
      const need = (K.GEAR_NEEDS || {})[name];
      if (!need) return null;
      const does = buildDoes(build);
      if (need.element) {
        for (const el of does.elements) if (need.element.test(el)) return null;
        return need.why;
      }
      if (need.summons) return does.summons ? null : need.why;
      // Gear counts as a source: Ptera's Heart feeds Impure Crown.
      if (need.poison)  return (does.poison || statusesOf(build).enemy.has('poison')) ? null : need.why;
      if (need.status) {
        for (const st of statusesOf(build).enemy) if (need.status.test(st)) return null;
        return need.why;
      }
      // A blocking item wants a build that is actually being hit and guarding.
      if (need.blocking) return (spec && /tank/.test(spec.goal || '')) ? null : need.why;
      // Anti-synergy rather than a requirement: it is worse in a party.
      if (need.healedBy) return (spec && spec.play === 'team') ? need.why : null;
      return null;
    }

    // Every move this build has that HEALS. Deliberately separate from kitFor:
    // that one filters on `damage`, so Holy Grace and Cleansing Prayer - moves
    // with a healing figure and no damage figure - were never in it. That is the
    // mechanical reason the engine could not see a Saint healing.
    //
    // Race moves are included here and not in kitFor for the same reason they
    // matter: Daminos heals, and no attack list would ever have shown it.
    const _healCache = {};
    function healMovesFor(build) {
      const key = [build.klass, build.race, build.sub || '', build.covenant || '',
                   build.covenantRank | 0, build.scroll1 || '', build.scroll2 || '',
                   build.lostScroll || ''].join('|');
      if (_healCache[key]) return _healCache[key];
      const out = [];
      const seen = new Set();
      const scan = entry => {
        for (const mv of ((entry || {}).learns || [])) {
          if (mv.healing == null || mv.healing === 'N/A') continue;
          if (seen.has(mv.name)) continue;
          seen.add(mv.name);
          out.push(mv);
        }
      };
      scan((D.classMoves || {})[build.klass]);
      const base = baseOf(build.klass);
      if (base && base !== build.klass) scan((D.classMoves || {})[base]);
      if (build.sub) scan((D.classMoves || {})[build.sub]);
      scan((D.raceMoves || {})[build.race]);
      if (build.covenant) {
        const cov = (D.covenantMoves || {})[build.covenant];
        if (cov) scan({ learns: (cov.learns || []).filter(m => (m.level || 1) <= (build.covenantRank | 0)) });
      }
      for (const n of [build.scroll1, build.scroll2]) if (n) scan((D.scrollMoves || {})[n]);
      if (build.lostScroll) scan((D.lostScrollMoves || {})[build.lostScroll]);
      return (_healCache[key] = out);
    }

    // class kit + covenant kit + whatever the scrolls and the subclass add.
    // Cached on ALL of it: a kit cached on the class alone survived a scroll
    // change and the search then compared every scroll against the same kit.
    const _kitCache = {};
    function kitFor(build, klass) {
      const key = [klass, build.covenant || '', build.covenantRank | 0, build.sub || '',
                   build.scroll1 || '', build.scroll2 || '', build.lostScroll || ''].join('|');
      if (_kitCache[key]) return _kitCache[key];

      let out = movesFor(klass);
      const extra = [];
      if (build.covenant) extra.push(...covenantMovesFor(build.covenant, build.covenantRank));
      if (build.sub) extra.push(...grantedMoves('classMoves', build.sub));
      for (const n of [build.scroll1, build.scroll2]) if (n) extra.push(...grantedMoves('scrollMoves', n));
      if (build.lostScroll) extra.push(...grantedMoves('lostScrollMoves', build.lostScroll));

      if (extra.length) {
        const seen = new Set(out.map(m => m.name));
        out = out.concat(extra.filter(m => !seen.has(m.name) && seen.add(m.name)));
      }
      return (_kitCache[key] = out);
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
    // debuffLoad and statusLoad read the CLASS's move text, which is the same
    // on every evaluate of a request; the profile had them at a tenth of it.
    const debuffLoadOf = memo(b => b.klass || '', b => K.debuffLoad(movesOf(b)));
    const statusLoadOf = memo((b, boss) => (b.klass || '') + '|' + (boss && boss.name) + '|' + ((boss && boss.statusImmune) || []).join(','),
                              (b, boss) => K.statusLoad(movesOf(b), boss.statusImmune));
    const procTotals = memo(
      b => wornKey(b) + '|' + (b.mark || '') + '|' + (b.armour || '') + '|' + (b.permuth || ''),
      b => procTotalsUncached(b));
    function procTotalsUncached(build) {
      const worn = wornNames(build);
      const load = debuffLoadOf(build);
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

    // Solo against a boss that has to be dodged, Speed has a floor (bossFit
    // prices falling short of it). The stat line treats that floor as a
    // breakpoint of its own, so "go perfect" never snaps Speed under it.
    function speedFloor(spec) {
      if (!spec || spec.play !== 'solo' || !spec.boss) return 0;
      const boss = bossFor(spec);
      if (!boss || boss.dodgeIrrelevant) return 0;
      return K.BOSS_SOLO_MIN_SPEED || 0;
    }

    // Multiplier on this build's damage for the chosen fight, plus why.
    function bossFit(build, spec, ctx) {
      const boss = bossFor(spec);
      if (!boss) return { mult: 1, boss: null, reasons: [] };
      const moves = movesOf(build);
      const load = debuffLoadOf(build);
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
        const inert = statusLoadOf(build, boss);
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
      // Permuth is scored as NOTHING. model.js mirrors the site's stat row,
      // where Venia's Permuth reads as a permanent x1.4 on one stat; in game it
      // is a 2-energy, 10-turn-cooldown, 3-turn buff with about a 50% chance of
      // landing on the stat you wanted. Searching with it on overstated every
      // build's main stat by up to 40% and put "Total" forty points away from
      // what the community means by the word. The mark is still worn and still
      // in the share link; the write-up prices it as the buff it is (K.PERMUTH).
      if (build.permuth && build.mark === 'Venia') build = Object.assign({}, build, { permuth: '' });
      const d = M.derived(build);
      const moves = kitFor(build, build.klass || spec.klass || '');

      // Trait overlay. The site does not compute these, so they live on top of
      // the verified base rather than inside it.
      const tt = M.traitTotals(build, K);
      const cap = M.energyCap(build, K);
      const pv = passiveTotals(build);
      const gp = gearPassiveTotals(build);
      const ma = masteryAbilityTotals(build, spec);
      // The statuses this build puts on itself and on the enemy - from the kit
      // and from the gear - which is what Reversing and Shattering count.
      const baseStatuses = statusesOf(build);   // memoised - copied, never added into
      const statuses = { self: new Set(baseStatuses.self), enemy: new Set(baseStatuses.enemy) };
      for (const st of gp.selfStatuses) statuses.self.add(st);
      for (const st of gp.enemyStatuses) statuses.enemy.add(st);
      const sh = M.shardTotals(build, K, { selfStacks: Math.max(1, statuses.self.size),
                                           targetStacks: Math.max(3, statuses.enemy.size) });
      const en = (K.ENCHANTS || {})[build.enchant];
      const enUp = en ? (en.uptime ?? 1) : 0;
      const enPct = en && en.kind === 'dmgPct' ? en.value * enUp : 0;
      const enOutHeal = en && en.kind === 'outHealPct' ? en.value * enUp : 0;
      const enIncHeal = en ? (en.incHealPct || 0) * enUp : 0;
      const mk = (K.MARK_ABILITIES || {})[build.mark];
      const markHealPct = mk ? (mk.effects || []).filter(e => e.kind === 'healPctPerTurn')
                                 .reduce((a, e) => a + e.value * (e.uptime ?? 1), 0) : 0;
      // Aimed at a fight: every hit is scaled by that boss's resistance to the
      // move's element. Physical is Physical; Magic reads the Arcane column.
      const bossData = spec.boss ? (D.BOSS_DATA || {})[spec.boss] : null;
      const bossRes = bossData && bossData.res ? bossData.res : null;
      const resFor = mv => {
        if (!bossRes) return 1;
        const el = String(mv.moveType || '').trim();
        const key = /^(magic|arcane)$/i.test(el) ? 'Arcane' : el.charAt(0).toUpperCase() + el.slice(1).toLowerCase();
        const v = bossRes[key];
        return typeof v === 'number' ? v : 1;
      };

      // A flat stat from a mastery has to reach the stats everything else reads,
      // or the ability probes as worth nothing and is never bought. Overlaid on
      // a COPY: d.stats is what the build reports, and it has to keep matching
      // what the site will show.
      // The site's own totals, before any combat overlay. The stat LINE - the
      // breakpoints, the dead zone, "60 End, 110 Arc, rest Str" - is read from
      // these: a Coagulated ramp or a Flourish stance is not where your points
      // are, it is what happens to them in a fight.
      const siteStats = d.stats;
      const maFlat = ma.statFlat, gpFlat = gp.statFlat;
      const hasFlat = STATS.some(k => maFlat[k] > 0 || gpFlat[k] > 0);
      if (hasFlat) {
        d.stats = Object.assign({}, d.stats);
        for (const k of STATS) d.stats[k] += (maFlat[k] || 0) + (gpFlat[k] || 0);
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
      let setupDmgPct = 0, setupSustainedPct = 0, setupDr = 0;
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
        } else if (su.kind === 'dr') {
          // A defensive setup. It is not damage, so it does not belong in
          // setupDmgPct - it is uptime-weighted onto block DR, which is what the
          // survival archetypes actually score.
          setupDr += su.value * uptime;
          rotation.push({ move: su.move, gain: null, note: su.note, uptime });
        } else if (su.kind === 'summonDmgPct') {
          rotation.push({ move: su.move, gain: null, note: su.note, uptime });
        } else {
          // Anything this scorer has no column for (an ally buff, say) is still
          // part of the rotation and is listed as such.
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
        let dmg = M.moveDamage(build, mv, { stats: d.stats, ctx: d._ctx }) * resFor(mv);
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
        const withStats = Object.keys(statBuffs).length ? M.moveDamage(build, mv, { stats: buffedStats }) * resFor(mv) * (1 + pct / 100) : preMult;
        const burst = withStats * (1 + openPct / 100) * buffedMult;
        const sust  = preMult   * (1 + sustPct / 100) * mult;
        if (burst > bestBurst) { bestBurst = burst; burstMove = mv; }
        if (sust > sustainedHit) sustainedHit = sust;
      }
      const ctx = {
        stats: d.stats, siteStats, hp: d.hp * (1 + (tt.hpPct + gp.hpPct) / 100), critChance,
        critTier: M.critTier(critChance), critDmg,
        blockDr: d.blockDr + tt.dr + gp.dr + ma.dr + pv.dr + setupDr,
        outHeal: d.outHeal, incHeal: d.incHeal,
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
        hpStance: K.hpStance ? K.hpStance(build.klass, build.race) : null,
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

      // Stat milestones. The site renders these and applies none of them, so
      // like the class passives they go into effective figures rather than into
      // the numbers the site will show.
      ctx.milestones = K.milestonesFor
        ? K.milestonesFor(ctx.stats, D.STAT_MILESTONE_TIERS)
        : { outHealPct: 0, incHealPct: 0, dodgePct: 0, cdCut: [], reached: [], missed: [] };

      if (ctx.milestones.dodgePct) ctx.effectiveHp = ctx.hp /
        Math.max(0.05, 1 - Math.min(95, ctx.dodge + ctx.milestones.dodgePct) / 100);

      // ── stat decay (the owner's rule, not the site's maths) ───────────────
      // A total sitting past the ~100 knee and short of the 110 perk is in the
      // dead zone: it has paid the fall-off and bought nothing for it. The
      // scorer docks each such stat a little (K.STAT_DECAY), which is what
      // makes the allocator's snap to a "perfect" line actually win.
      const decay = K.STAT_DECAY || null;
      ctx.deadZone = decay
        ? STATS.filter(s => (ctx.siteStats[s] || 0) > decay.knee && (ctx.siteStats[s] || 0) < decay.next)
        : [];

      // Healing the site does not apply to its own percentage - class passives
      // and stat milestones - folded into SEPARATE figures the healing and tank
      // archetypes score on, so the Heal out/in numbers this build reports stay
      // the ones the site will show.
      const outBonus = ((ctx.passives || {}).outHealPct || 0) + ctx.milestones.outHealPct + ma.outHealPct + enOutHeal;
      ctx.effectiveHeal = ctx.outHeal * (1 + outBonus / 100);
      ctx.effectiveIncHeal = ctx.incHeal + ctx.milestones.incHealPct + ma.incHealPct + pv.incHealPct + enIncHeal;

      // ── how much you heal, and how often ──────────────────────────────────
      // A cooldown cut is worth exactly what it lets you repeat, so the two are
      // computed together. Race cuts are flat; milestone cuts are element-gated
      // the way the owner plays it (K.MILESTONE_CD_AFFINITY: ARC 110 shortens
      // every non-Physical move, Holy heals included; STR 110 shortens
      // Physical), and they stack with Sheea.
      const flatCut = (ctx.passives || {}).cdCut || 0;
      ctx.cdCutFlat = flatCut;
      const cdFor = mv => {
        const raw = Number(mv.cooldown) || 0;
        if (!raw) return 1;
        let cut = flatCut;
        for (const c of ctx.milestones.cdCut)
          if (c.elements && c.elements.test(String(mv.moveType || ''))) cut += c.value;
        return Math.max(1, raw - cut);
      };
      ctx.effectiveCd = cdFor;

      const healMult = ctx.effectiveHeal / 100;
      let bestHeal = 0, perTurn = 0;
      const healMoves = [];
      for (const mv of healMovesFor(build)) {
        const amount = M.moveHealing(build, mv) * healMult;
        if (!amount) continue;
        const cd = cdFor(mv);
        healMoves.push({ name: mv.name, amount, cd, perTurn: amount / cd });
        bestHeal = Math.max(bestHeal, amount);
        perTurn += amount / cd;
      }
      // Which of the gear actually on the build has a passive that cannot fire.
      // Reported rather than penalised: the stat block is still real, and the
      // honest statement is "you are wearing this for the numbers, not the text".
      ctx.inertGear = (build.gear || [])
        .map(g => g.name)
        .filter(n => inertFor(n, build, spec));
      ctx.cautionGear = [...(build.gear || []).map(g => g.name),
                         build.artifact && build.artifact.name]
        .filter(Boolean)
        .filter(n => cautionFor(n, build, spec));

      ctx.heals = healMoves.sort((a, b) => b.perTurn - a.perTurn);
      ctx.bestHeal = bestHeal;
      // A heal that comes off your damage (Parasitic Leech) is a proper heal to
      // the rest of the party: scaled by outgoing healing, counted for the
      // allies it reaches, and worth nothing solo.
      const su = K.SUSTAIN || { horizon: 6, attackShare: 0.5 };
      ctx.teamHealPerTurn = 0;
      if (gp.healFromDmgPct > 0 && spec.play === 'team') {
        const allies = partyScale(spec) - 1;
        ctx.teamHealPerTurn = ctx.sustainedHit * su.attackShare * (gp.healFromDmgPct / 100) * healMult * allies;
        perTurn += ctx.teamHealPerTurn;
      }
      ctx.healPerTurn = perTurn;

      // ── sustain ───────────────────────────────────────────────────────────
      // Health back that is not a heal move: lifesteal off your attacks, flat
      // HP back a turn (Broken Bones), a share of max HP back a turn (Utor).
      // None of it is HP, so it goes into a THIRD survival figure the tank and
      // healer archetypes read: effective HP plus what comes back over an
      // assumed stretch of the fight. K.SUSTAIN says how long, and how many of
      // your turns are attacks.
      ctx.lifesteal = (sh.lifesteal || 0) + ma.lifestealPct + gp.lifestealPct + pv.lifestealPct;
      const incMult = (ctx.effectiveIncHeal || 100) / 100;
      const outMult = (ctx.effectiveHeal || 100) / 100;
      ctx.sustainPerTurn = ctx.sustainedHit * (ctx.lifesteal / 100) * su.attackShare
                         + (gp.selfHealFlat + pv.selfHealFlat) * incMult
                         + ctx.hp * ((gp.healPctPerTurn + markHealPct) / 100) * incMult * outMult;
      ctx.effectiveHpSustain = ctx.effectiveHp + ctx.sustainPerTurn * su.horizon;
      ctx.statuses = { self: [...statuses.self], enemy: [...statuses.enemy] };

      // Aimed at a boss, the score is how fast THIS build kills THAT boss - and
      // with BOSS_DATA extracted, "how fast" is a number of turns at last.
      const fit = bossFit(build, spec, ctx);
      if (fit.boss && bossData) {
        fit.hp = bossData.hp || null;
        fit.hpCorrupted = (bossData.hpVariants || {}).Corrupted || null;
        fit.res = bossRes || {};
        fit.killTurns = fit.hp && ctx.sustainedHit > 0 ? fit.hp / ctx.sustainedHit : null;
        fit.killTurnsCorrupted = fit.hpCorrupted && ctx.sustainedHit > 0 ? fit.hpCorrupted / ctx.sustainedHit : null;
      }
      ctx.bossFit = fit;
      ctx.score = (blendScore(ctx, spec, arch) + 1e-6 * ctx.bestHit) * fit.mult
                * (1 - (decay ? decay.deadZonePenalty : 0) * ctx.deadZone.length);
      return ctx;
    }

    // ── more than one job ────────────────────────────────────────────────────
    // Picking two roles is a real request — a healer who can hold a line — and
    // it is a WORSE build at each of them. The score has to express that, which
    // means the two archetypes have to be comparable, and raw they are not: a
    // damage score runs to ~3000 and a healing score to ~600, so adding them
    // would just be the damage score with rounding noise.
    //
    // So each goal is divided by what it scores on one fixed reference build,
    // and the results are combined with a GEOMETRIC mean. Geometric, not
    // arithmetic, because a build that does one of its two jobs and none of the
    // other should not come out average — it should come out bad.
    const BLEND_REF = {
      stats: { str: 100, arc: 100, end: 100, spd: 100, lck: 100 },
      hp: 400, effectiveHp: 400, bestHit: 500, sustainedHit: 450, bestBurst: 700,
      outHeal: 150, incHeal: 150, blockDr: 20, critTier: 1, critChance: 50,
      critDmg: 2, dodge: 0, initiative: 10, energyCap: 5, passives: {},
    };
    const _refScore = {};
    function refFor(goal) {
      if (_refScore[goal] === undefined) {
        const a = K.ARCHETYPES[goal];
        let v = 1;
        try { v = a ? a.score(BLEND_REF) : 1; } catch (e) { v = 1; }
        _refScore[goal] = Math.abs(v) > 1e-9 ? Math.abs(v) : 1;
      }
      return _refScore[goal];
    }

    function blendScore(ctx, spec, arch) {
      const goals = (spec.goals || []).filter(g => K.ARCHETYPES[g]);
      if (goals.length < 2) return arch.score(ctx);

      const pairs = (spec.goalWeights && spec.goalWeights.length)
        ? spec.goalWeights.filter(x => K.ARCHETYPES[x[0]])
        : goals.map(g => [g, 1]);

      let logSum = 0, wSum = 0;
      for (const [g, wt] of pairs) {
        let v = 0;
        try { v = K.ARCHETYPES[g].score(ctx) / refFor(g); } catch (e) { v = 0; }
        logSum += wt * Math.log(Math.max(v, 1e-6));
        wSum += wt;
      }
      // Back onto the scale of the FIRST goal, so a blended score still reads
      // like a score rather than like a ratio.
      return Math.exp(logSum / (wSum || 1)) * refFor(pairs[0][0]);
    }

    // ── analytic ranking ─────────────────────────────────────────────────────
    // Value an item by the goal's stat weights. Cheap, and good enough to build
    // a shortlist that the real scorer then sorts out properly.
    function weightOf(spec) {
      const arch = K.ARCHETYPES[spec.goal] || K.ARCHETYPES[K.DEFAULT_GOAL];
      const w = Object.assign({}, arch.statWeights);
      // Several goals means several stat directions. Averaged, so two roles pull
      // the spread between them instead of the first one winning outright.
      const goals = (spec.goals || []).filter(g => K.ARCHETYPES[g]);
      if (goals.length > 1) {
        const pairs = (spec.goalWeights && spec.goalWeights.length)
          ? spec.goalWeights.filter(x => K.ARCHETYPES[x[0]])
          : goals.map(g => [g, 1]);
        const wSum = pairs.reduce((a, x) => a + x[1], 0) || 1;
        for (const st of STATS) {
          let sum = 0;
          for (const [g, wt] of pairs) sum += wt * ((K.ARCHETYPES[g].statWeights || {})[st] || 0);
          w[st] = sum / wSum;
        }
      }
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
              if (improves(sc, best)) { best = sc; moved = true; }
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
        // Luck buys crit chance at LUCK_CRIT_RATIO, so a missing percent costs
        // 1/ratio Luck points. Reading this as 1:1 does not fail loudly - the
        // snap just lands short of every threshold and crit builds quietly stop
        // being found.
        const perLuck = D.LUCK_CRIT_RATIO || 1;
        const need = Math.ceil((target - cur.critChance) / perLuck);
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
      // Stat milestones are the same shape of problem as the crit tiers, and
      // worse: LCK 60 is +35% outgoing healing, and a healer seeded with a Luck
      // weight of zero has to climb sixty points that each make the build worse
      // before the one that makes it much better. Hill climbing never gets
      // there. So try each threshold explicitly, exactly like the crit tiers.
      for (const stat of STATS) {
        for (const target of (D.STAT_MILESTONE_TIERS || [])) {
          const cur = evaluate(build, spec);
          if ((cur.stats[stat] || 0) >= target) continue;
          const need = Math.ceil(target - (cur.stats[stat] || 0));
          for (const donor of STATS.filter(x => x !== stat)
                                   .sort((a, b) => build.invested[b] - build.invested[a])) {
            const take = Math.min(need, Math.max(0, build.invested[donor]));
            if (!take) continue;
            build.invested[donor] -= take; build.invested[stat] += take;
            const sc = evaluate(build, spec).score;
            if (improves(sc, best)) { best = sc; Object.assign(snapshot, build.invested); }
            else { build.invested[donor] += take; build.invested[stat] -= take; }
            break;
          }
        }
      }

      build.invested = snapshot;
      snapToBreakpoints(build, spec);
      return evaluate(build, spec).score;
    }

    // ── "go perfect" ─────────────────────────────────────────────────────────
    // The owner's rule for a stat line: land on a breakpoint (25 / 60 / 110) or
    // stay at or under the ~100 knee where stats fall off. 101-109 is the dead
    // zone - past the fall-off, short of the perk - and the hill-climb has no
    // reason to leave it, because the maths it climbs is linear. So for every
    // stat sitting there this tries both ways out: DOWN to the knee, with the
    // freed points sent to whichever other stat measures best, and UP to the
    // next breakpoint, paid for by the largest other stat. The scorer decides
    // between staying, up and down; the dead-zone penalty is what makes
    // staying the worst of the three.
    //
    // Then a trim: a total a few points past a breakpoint that reaches nothing
    // gives those points to the receiving stat, kept only when the scorer
    // calls it no worse - "60 End, 110 Arc, rest Str" rather than 63 and 114.
    //
    // Totals include gear, armour, mastery and the percentage sources, and
    // Permuth is excluded exactly as the scorer excludes it, so the invested
    // points that land a TOTAL on a target are found by probing the model
    // rather than by inverting its rounding.
    function bare(build) {
      return build.permuth && build.mark === 'Venia' ? Object.assign({}, build, { permuth: '' }) : build;
    }
    // Fewest invested points that put `stat`'s total at or over `target`.
    function investedForTotal(build, stat, target) {
      const B = bare(build);                 // shares build.invested
      const cur = build.invested[stat] | 0;
      const totalAt = inv => {
        const was = build.invested[stat];
        build.invested[stat] = Math.max(0, inv);
        const t = M.totalStat(B, stat);
        build.invested[stat] = was;
        return t;
      };
      // Totals can carry a fraction (item hooks add fractions of a point, as
      // the site does); invested points cannot.
      let inv = Math.max(0, Math.round(cur + (target - totalAt(cur))));
      let guard = 0;
      while (totalAt(inv) < target && guard++ < 60) inv++;
      while (inv > 0 && totalAt(inv - 1) >= target && guard++ < 120) inv--;
      return inv;
    }

    function snapToBreakpoints(build, spec) {
      const decay = K.STAT_DECAY;
      if (!decay) return;
      const tiers = D.STAT_MILESTONE_TIERS || [25, 60, 110];
      let bestScore = evaluate(build, spec).score;
      const budget = M.pointBudget(build);
      const legal = () => STATS.every(s => (build.invested[s] | 0) >= 0) &&
                          STATS.reduce((a, s) => a + (build.invested[s] | 0), 0) <= budget;
      // Score a change to the invested line, then put it back.
      const probe = mutate => {
        const before = Object.assign({}, build.invested);
        mutate();
        let sc = -Infinity;
        try { if (legal()) sc = evaluate(build, spec).score; } catch (e) { sc = -Infinity; }
        build.invested = before;
        return sc;
      };
      const apply = mutate => { mutate(); bestScore = evaluate(build, spec).score; };
      // The other stat five points would help most - where freed points go.
      const receiver = exclude => {
        let bestS = null, bestV = -Infinity;
        for (const s of STATS) {
          if (s === exclude) continue;
          const v = probe(() => { build.invested[s] += 5; });
          if (v > bestV) { bestV = v; bestS = s; }
        }
        return bestS;
      };
      const largestOther = exclude => STATS.filter(x => x !== exclude)
        .sort((a, b) => (build.invested[b] | 0) - (build.invested[a] | 0))[0];

      for (let pass = 0; pass < 2; pass++) {
        const t = M.allStats(bare(build));
        const zone = STATS.filter(s => t[s] > decay.knee && t[s] < decay.next && (build.invested[s] | 0) > 0);
        if (!zone.length) break;
        for (const s of zone) {
          const cur = build.invested[s] | 0;
          const upInv   = investedForTotal(build, s, decay.next);
          const downInv = Math.max(0, investedForTotal(build, s, decay.knee + 1) - 1);
          const donor = largestOther(s);
          const to = receiver(s);
          const up   = () => { const n = upInv - cur; build.invested[s] += n; build.invested[donor] -= n; };
          const down = () => { const n = cur - downInv; build.invested[s] -= n; build.invested[to] += n; };
          const scUp = upInv > cur ? probe(up) : -Infinity;
          const scDown = downInv < cur ? probe(down) : -Infinity;
          if (scUp >= scDown && improves(scUp, bestScore)) apply(up);
          else if (improves(scDown, bestScore)) apply(down);
        }
      }

      // Trim: just past a breakpoint and reaching nothing more. Kept when the
      // scorer calls the tidier line no worse, which is what "go perfect" means.
      for (const s of STATS) {
        const t = M.allStats(bare(build))[s];
        const bp = tiers.filter(x => t > x && t <= x + 9).sort((a, b) => b - a)[0];
        if (!bp) continue;
        const surplus = Math.min(build.invested[s] | 0, t - bp);
        if (surplus <= 0) continue;
        const to = receiver(s);
        if (!to) continue;
        const trim = () => { build.invested[s] -= surplus; build.invested[to] += surplus; };
        const sc = probe(trim);
        if (sc > -Infinity && !improves(bestScore, sc)) apply(trim);
      }
    }

    // ── one rest stat, everything else exactly on a breakpoint ───────────────
    // Every community build the owner supplied has this shape: "60 End, 110
    // Arc, rest Str"; "60 End, 60 Luck, 110 Str"; "full Luck"; "full End". One
    // stat takes whatever is left over, and every other stat you put points in
    // sits EXACTLY on 25, 60 or 110 - not 63, not 122. That is the owner's
    // "otherwise go perfect", and it is a rule rather than a score: the maths
    // this engine climbs is linear, so left to the score alone a healer ends
    // on 122 Arc and 131 End and calls it optimal.
    //
    // The scorer still decides everything that is a choice - which stat is the
    // rest (every stat is tried, including one holding no points yet), and for
    // each other stat which breakpoint it sits on (down and up are tried while
    // either pays) - and it decides with points past 110 worth K.STAT_DECAY
    // .pastRate of a point under the knee, so a rest stat run deep past the
    // fall-off loses to a second scaling stat kept under it. A Luck total
    // sitting on a crit-tier threshold is exempt: those are breakpoints of
    // their own.
    //
    // Run once, on the winning build (finishLine), because it is thorough.
    function decayedScore(build, spec) {
      const decay = K.STAT_DECAY;
      let full;
      try { full = evaluate(build, spec); } catch (e) { return -Infinity; }
      if (!decay || decay.pastRate == null || decay.pastRate >= 1) return full.score;
      const over = STATS.filter(s => full.stats[s] > decay.next && (build.invested[s] | 0) > 0 &&
                                     !(s === 'lck' && full.critTier > 0));
      if (!over.length) return full.score;
      const saved = Object.assign({}, build.invested);
      for (const s of over) build.invested[s] = Math.min(build.invested[s], investedForTotal(build, s, decay.next));
      let clipped;
      try { clipped = evaluate(build, spec).score; } catch (e) { clipped = full.score; }
      build.invested = saved;
      return clipped + (full.score - clipped) * decay.pastRate;
    }

    function goPerfect(build, spec) {
      const decay = K.STAT_DECAY || null;
      const tiers = (D.STAT_MILESTONE_TIERS || [25, 60, 110]).slice().sort((a, b) => a - b);
      const floor = speedFloor(spec);
      const tiersFor = s => (s === 'spd' && floor && tiers.indexOf(floor) === -1)
        ? tiers.concat([floor]).sort((a, b) => a - b) : tiers;
      const budget = M.pointBudget(build);
      const legal = () => STATS.every(s => (build.invested[s] | 0) >= 0) &&
                          STATS.reduce((a, s) => a + (build.invested[s] | 0), 0) <= budget;
      const score = () => legal() ? decayedScore(build, spec) : -Infinity;

      // Luck sitting on a crit-tier threshold is there on purpose.
      const critTier = () => { try { return evaluate(build, spec).critTier; } catch (e) { return 0; } };
      const exempt = s => {
        if (s !== 'lck') return false;
        const tier = critTier();
        if (!tier) return false;
        build.invested.lck -= 1;
        const below = critTier();
        build.invested.lck += 1;
        return below < tier;
      };

      const start = Object.assign({}, build.invested);
      let bestLine = null, bestSc = -Infinity;
      for (const r of STATS) {
        build.invested = Object.assign({}, start);
        const others = STATS.filter(s => s !== r && (build.invested[s] | 0) > 0 && !exempt(s));
        if (!others.length && (build.invested[r] | 0) === 0) continue;
        // Down to the breakpoint at or below, freeing the difference to the rest.
        const t = M.allStats(bare(build));
        for (const s of others) {
          const bp = tiersFor(s).filter(x => x <= t[s]).sort((a, b) => b - a)[0] || 0;
          const inv = bp ? investedForTotal(build, s, bp) : 0;
          const freed = (build.invested[s] | 0) - inv;
          if (freed > 0) { build.invested[s] = inv; build.invested[r] += freed; }
        }
        let sc = score();
        // Then step each other stat down a breakpoint, or up one, while it pays.
        for (let round = 0; round < 3; round++) {
          let improved = false;
          for (const s of others) {
            const cur = M.allStats(bare(build))[s];
            const lower = tiersFor(s).filter(x => x < cur).sort((a, b) => b - a)[0] || 0;
            const invDown = lower ? investedForTotal(build, s, lower) : 0;
            const freed = (build.invested[s] | 0) - invDown;
            if (freed > 0) {
              build.invested[s] -= freed; build.invested[r] += freed;
              const down = score();
              if (improves(down, sc)) { sc = down; improved = true; continue; }
              build.invested[s] += freed; build.invested[r] -= freed;
            }
            const next = tiersFor(s).find(x => x > cur);
            if (!next) continue;
            const cost = investedForTotal(build, s, next) - (build.invested[s] | 0);
            if (cost <= 0 || cost > (build.invested[r] | 0)) continue;
            build.invested[s] += cost; build.invested[r] -= cost;
            const up = score();
            if (improves(up, sc)) { sc = up; improved = true; }
            else { build.invested[s] -= cost; build.invested[r] += cost; }
          }
          if (!improved) break;
        }
        // The rest stat itself can land in the dead zone (101-109) - it takes
        // whatever is left, and what is left is what it is. One way out is
        // tried: up to 110, paid by the largest other stat, which then steps
        // down to its own breakpoint below and hands the difference back.
        if (decay && (build.invested[r] | 0) > 0) {
          const rt = M.allStats(bare(build))[r];
          if (rt > decay.knee && rt < decay.next) {
            const donor = others.slice().sort((a, b) => (build.invested[b] | 0) - (build.invested[a] | 0))[0];
            const need = investedForTotal(build, r, decay.next) - (build.invested[r] | 0);
            if (donor && need > 0 && need <= (build.invested[donor] | 0)) {
              const before = Object.assign({}, build.invested);
              build.invested[r] += need; build.invested[donor] -= need;
              const dt = M.allStats(bare(build))[donor];
              const bp = tiersFor(donor).filter(x => x <= dt).sort((a, b) => b - a)[0] || 0;
              const inv = bp ? investedForTotal(build, donor, bp) : 0;
              const freed = (build.invested[donor] | 0) - inv;
              if (freed > 0) { build.invested[donor] = inv; build.invested[r] += freed; }
              const out = score();
              if (improves(out, sc)) sc = out;
              else build.invested = before;
            }
          }
        }
        if (sc > bestSc) { bestSc = sc; bestLine = Object.assign({}, build.invested); }
      }
      // The best perfect line, full stop. This is the owner's rule, and the
      // scorer's job was to choose between the perfect lines, not to veto them.
      build.invested = bestLine || start;
    }

    // Settle the stat line and the tier shapes together on the finished build:
    // a tier shape can move a total by up to 9, so it is snap, re-shape, snap.
    // The last snap is what makes the totals - tier points included - perfect.
    // Every community build assumes the soul tree's health nodes are maxed
    // ("if you do not have this, take 10-20 extra Endurance"). Data-driven:
    // every node that grants flat HP, at its max rank.
    function maxHealthSoul() {
      const soul = {};
      for (const list of Object.values(D.soulTreeData || {}))
        for (const n of list) if (n && n.hpFlat && n.id) soul[n.id] = n.maxRank || 1;
      return soul;
    }

    function finishLine(build, spec) {
      const fixedGear = new Set(D.FIXED_GEAR || []);
      build.soul = maxHealthSoul();
      goPerfect(build, spec);
      const shapes = () => JSON.stringify([(build.gear || []).map(g => g.alloc), build.artifact && build.artifact.alloc,
                                           build.weapon && build.weapon.alloc]);
      const before = shapes();
      for (const g of build.gear || []) if (!fixedGear.has(g.name)) bestTierAlloc(build, spec, g, false);
      if (build.artifact) bestTierAlloc(build, spec, build.artifact, false);
      if (build.weapon && M.weaponIsTiered(build.weapon.name)) bestTierAlloc(build, spec, build.weapon, true);
      // The second pass exists for a tier shape that pushed a total off its
      // breakpoint; when no shape moved, the line is still perfect.
      if (shapes() !== before) goPerfect(build, spec);
      build._statLine = statLineFor(build, spec);
      build._tierOrder = tierOrder(build, spec);
    }

    // The community's stat line - "60 End, 110 Arc, rest Str" - with the reason
    // for each number. Read off the finished totals, so it describes the build
    // rather than plans it. `perk` is the highest counted milestone the total
    // reaches; `moves` are the kit moves a cooldown cut actually shortens.
    function statLineFor(build, spec) {
      const ctx = evaluate(build, spec);
      const defFor = m => (((K.MILESTONES || {})[m.stat] || [])[m.tier - 1]) || {};
      const perkText = m => {
        const def = defFor(m);
        return m.kind === 'cdCut'      ? '-' + (def.value || 1) + ' cooldown'
             : m.kind === 'incHealPct' ? '+' + (def.value || 0) + '% incoming healing'
             : m.kind === 'outHealPct' ? '+' + (def.value || 0) + '% outgoing healing'
             : m.kind === 'dodgePct'   ? (def.value || 0) + '% autododge'
             : m.text;
      };
      const kit = (ctx.moves || []).concat(healMovesFor(build));
      const shortens = (s, cut) => {
        const out = [], seen = new Set();
        for (const mv of kit) {
          if (!mv || !mv.name || seen.has(mv.name)) continue;
          if (cut && cut.elements && cut.elements.test(String(mv.moveType || '')) && Number(mv.cooldown) > 1) {
            seen.add(mv.name); out.push(mv.name);
          }
        }
        return out;
      };
      // A perk is only the reason for a number when the build can use it: a
      // cooldown cut that shortens nothing in the kit, or outgoing healing on
      // a build that heals nothing, is not why the points are there.
      const usable = (m, moves) => m.kind === 'cdCut'      ? moves.length > 0
                               : m.kind === 'outHealPct' ? (ctx.healPerTurn || 0) > 0
                               : true;
      const site = ctx.siteStats || ctx.stats;
      const floor = speedFloor(spec);
      const line = STATS.map(s => {
        const total = site[s] | 0;
        const invested = build.invested[s] | 0;
        const reached = ctx.milestones.reached
          .filter(m => m.stat === s && m.kind !== 'note')
          .sort((a, b) => b.need - a.need);
        const top = reached[0] || null;
        const row = { stat: s, total, invested, target: top ? top.need : null,
                      reason: 'none', perk: null, moves: [] };
        if (top) {
          const cut = top.kind === 'cdCut' ? ctx.milestones.cdCut.find(c => c.stat === s) : null;
          const moves = cut ? shortens(s, cut) : [];
          // "Sits on" a breakpoint at or past the perk's own: within one,
          // since the percent sources step totals by more than a point. End
          // parked on 110 still holds the +35% incoming healing from 60, and
          // is capped there because past 110 a stat falls off.
          const tiersHere = D.STAT_MILESTONE_TIERS || [25, 60, 110];
          const sitsOn = tiersHere.some(bp => bp >= top.need && total >= bp && total < bp + 2);
          if (sitsOn && usable(top, moves)) {
            row.reason = 'perk'; row.perk = perkText(top); row.moves = moves;
            row.capped = total > top.need + 1;
          } else if (usable(top, moves)) {
            row.also = perkText(top);       // crossed on the way, worth naming
          }
        }
        if (row.reason === 'none' && s === 'lck' && ctx.critTier > 0) {
          row.reason = 'critTier'; row.tier = ctx.critTier;
        }
        if (row.reason === 'none' && s === 'spd' && floor && total >= floor && total < floor + 2) {
          row.reason = 'floor'; row.perk = 'the solo boss dodge floor'; row.target = floor;
        }
        return row;
      });
      // The rest stat is the one invested stat that does NOT sit on a
      // breakpoint - goPerfect leaves at most one. If every invested stat sits
      // on one, the largest is the rest. A stat parked exactly on a breakpoint
      // for a reason no milestone text states (Luck at 110 for crit chance) is
      // "cap": capped there because past it a stat falls off.
      const tiers = D.STAT_MILESTONE_TIERS || [25, 60, 110];
      const onBp = x => tiers.some(bp => x.total >= bp && x.total < bp + 2) ||
                        (x.stat === 'spd' && floor > 0 && x.total >= floor && x.total < floor + 2);
      const open = line.filter(x => x.reason === 'none' && x.invested > 0);
      const off = open.filter(x => !onBp(x));
      const rest = (off.length ? off : open).sort((a, b) => b.invested - a.invested)[0];
      if (rest) rest.reason = 'rest';
      for (const x of line) if (x.reason === 'none' && x.invested > 0) x.reason = onBp(x) ? 'cap' : 'dump';
      return line;
    }

    // ── tier shapes ──────────────────────────────────────────────────────────
    // Which stats a tier shape should feed, most valuable first: measured by a
    // +5 probe on each, with any stat 1-9 short of a breakpoint moved to the
    // front - a 9 / 5 / 3 / 2 is exactly what completes it. This is the "Tier
    // bonuses: Str >= Arc >= End" line of a community build. Cached against the
    // invested line, which is what changes it.
    function tierOrder(build, spec) {
      const key = STATS.map(s => build.invested[s] | 0).join(',') + '|' + (build.klass || '') + '|' + (build.race || '');
      if (build._tierOrderKey === key && build._tierOrder) return build._tierOrder;
      const tiers = D.STAT_MILESTONE_TIERS || [25, 60, 110];
      const base = evaluate(build, spec).score || 1;
      const t = M.allStats(bare(build));
      const val = {};
      for (const s of STATS) {
        const was = build.invested[s];
        build.invested[s] = (was | 0) + 5;
        let v;
        try { v = evaluate(build, spec).score / base - 1; } catch (e) { v = 0; }
        build.invested[s] = was;
        const short = tiers.some(bp => t[s] < bp && t[s] >= bp - 9);
        val[s] = v + (short ? 1 : 0);
      }
      const order = STATS.slice().sort((a, b) => val[b] - val[a]);
      build._tierOrder = order; build._tierOrderKey = key;
      return order;
    }

    // Try every legal shape for a slot and keep whichever scores best. Shapes
    // are few (at most three per tier), and two stat orders are tried for
    // each: the measured one and the same with its top two swapped, so a
    // [5, 3] can go either way round.
    function bestTierAlloc(build, spec, slotRef, isWeapon) {
      const tier = isWeapon ? D.MAX_WEAPON_TIER : D.MAX_GEAR_TIER;
      const shapes = M.shapesFor(tier, isWeapon);
      const order = tierOrder(build, spec);
      const swapped = order.slice(); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
      let best = null, bestScore = -Infinity;
      for (const shape of shapes) {
        for (const ord of [order, swapped]) {
          slotRef.tier = tier;
          slotRef.alloc = M.allocForShape(shape, ord);
          const sc = evaluate(build, spec).score;
          if (sc > bestScore) { bestScore = sc; best = { tier, alloc: Object.assign({}, slotRef.alloc) }; }
        }
      }
      slotRef.tier = best.tier; slotRef.alloc = best.alloc;
      return bestScore;
    }

    // Try every option for a single slot, keeping the best. Used for armour,
    // weapon, artifact, enchant — small lists where exhaustive is affordable.
    // Is `sc` a REAL improvement on `best`, or floating-point dust?
    //
    // Every greedy picker here asked "sc > best + 1e-9". Scores run from ~50 to
    // ~5000, so that epsilon is 1e-11 relative — far under the noise floor of
    // the multiply chain a score comes out of. It showed up as a healer wearing
    // seven pure-damage shards: each one "improved" outgoing healing by 7e-7.
    //
    // Relative, floored at 1e-9 so a score of zero still behaves.
    const IMPROVE_EPS = 1e-6;
    function improves(sc, best) {
      return sc > best + Math.max(1e-9, Math.abs(best) * IMPROVE_EPS);
    }
    // The mirror of it: near enough to call a tie.
    function ties(a, b) {
      return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * IMPROVE_EPS);
    }

    // `prefer(opt)` marks an option whose value the model cannot see. Such an
    // option is kept when it is within ROLE_ITEM_MARGIN of the best score, not
    // merely when it ties — see the note on ROLE_ITEM_MARGIN.
    // `slotKey` names the slot; when given, every option's score is kept on
    // build._alts[slotKey] so the write-up can say what came second and by how
    // much - "Race: Sheea >= Daminos >= Corvolus" is this list.
    function bestOfSlot(build, spec, options, set, tieBreak, prefer, slotKey) {
      let bestVal = null, bestScore = -Infinity;
      const scored = (prefer || slotKey) ? [] : null;
      for (const opt of options) {
        set(build, opt);
        const sc = evaluate(build, spec).score;
        if (scored) scored.push({ opt, sc });
        // A tie is not a coin flip. Some options are strictly better in game than
        // the model can see, and picking between them by list order looks like a
        // mistake to anyone reading the build. `tieBreak(candidate, incumbent)`
        // says which of two equal-scoring options to keep.
        //
        // The primary test is `improves`, not `>`. With a bare `>`, a difference
        // of 2e-6 in a score of 596 counted as a win and settled the slot before
        // the tiebreak was ever consulted — which is exactly how a healer ended
        // up in Stellian Core instead of Narthana's Sigil.
        if (bestVal === null || improves(sc, bestScore) ||
            (tieBreak && ties(sc, bestScore) && tieBreak(opt, bestVal))) {
          bestScore = sc; bestVal = opt;
        }
      }

      if (slotKey && scored) recordAlts(build, slotKey, scored, bestScore);

      // Second pass: if a preferred option lost, but lost by less than the
      // allowance, it takes the slot back. Recorded on the build so the
      // write-up can say it was chosen this way and by how much it lost.
      if (scored && prefer && bestScore > 0) {
        const margin = K.ROLE_ITEM_MARGIN ?? 0.10;
        const floor = bestScore * (1 - margin);
        const pick = scored
          .filter(x => x.opt && prefer(x.opt) && x.sc >= floor)
          .sort((a, b) => b.sc - a.sc)[0];
        if (pick && pick.opt !== bestVal) {
          build._rolePicks = build._rolePicks || {};
          build._rolePicks[pick.opt] = Math.round((1 - pick.sc / bestScore) * 1000) / 10;
          bestVal = pick.opt;
        }
      }

      set(build, bestVal);
      return bestVal;
    }

    // The ranking a slot was decided on: name, score, and how far behind the
    // best each option landed (0 for the best). Kept short; the write-up shows
    // the top few.
    function recordAlts(build, slotKey, scored, bestScore) {
      const nameOf = opt => opt == null ? '' : (typeof opt === 'string' ? opt : (opt.name || String(opt)));
      const list = scored
        .map(x => ({ name: nameOf(x.opt), score: x.sc,
                     delta: bestScore > 0 ? Math.max(0, (bestScore - x.sc) / bestScore) : 0 }))
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 6);
      build._alts = build._alts || {};
      build._alts[slotKey] = list;
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
      //
      // The shortlist is a SPEED hack and a speed hack must never be what
      // decides. rankGear prices a percentage bonus at a flat +4 whatever it
      // says, so Narthana's Leaf — +75% OUTGOING HEALING, the single best item a
      // healer can wear — ranked 67th of 67 on a healing build and was cut
      // before the real scorer ever saw it. Wearing it is worth +71 percentage
      // points of outgoing healing and a 9% better score.
      //
      // So every gear whose value lives in a percentage gets a guaranteed seat
      // and the real scorer settles it. There are three such items in the whole
      // game, so this costs three evaluations and closes the hole for good.
      const shortlist = rankGear(spec, w).slice(0, 14);
      for (const name of Object.keys(D.gearPctBonuses || {})) {
        if (!usable(name) || shortlist.some(g => g.name === name)) continue;
        shortlist.push({ name, v: 0, block: D.gearItems[name] || {} });
      }
      b.gear = [];

      // A pinned gear takes the first slot and is never reconsidered — it is the
      // reason the rest of the build exists.
      if (spec.forceGear && D.gearItems[spec.forceGear] && usable(spec.forceGear)) {
        const entry = { name: spec.forceGear, tier: D.MAX_GEAR_TIER, alloc: {}, traits: [] };
        b.gear.push(entry);
        bestTierAlloc(b, spec, entry, false);
      }

      // Fixed gear is exactly its base stat block: no tier roll, no traits, no
      // allocation. Claiming T6 on one is wrong in the output and writes bits
      // into the share link that the site strips on load.
      const fixedGear = new Set(D.FIXED_GEAR || []);
      const tierOf = name => (fixedGear.has(name) ? 0 : D.MAX_GEAR_TIER);

      for (let slot = b.gear.length; slot < 4; slot++) {
        let bestName = null, bestScore = -Infinity, bestAlloc = null, bestDead = true;
        const ranked = [];
        for (const cand of shortlist) {
          if (b.gear.some(g => g.name === cand.name)) continue;
          const entry = { name: cand.name, tier: tierOf(cand.name), alloc: {} };
          b.gear.push(entry);
          if (!fixedGear.has(cand.name)) bestTierAlloc(b, spec, entry, false);
          const sc = evaluate(b, spec).score;
          b.gear.pop();
          ranked.push({ opt: cand.name, sc });

          // A passive that cannot fire for this build is worth nothing, so on a
          // tie the item whose passive DOES something wins. This is what stops a
          // Saint wearing Madseer's Codex for its Arcane while its whole effect
          // - statuses on Magic, Fire, Ice and Hex - sits dead, and its QTE
          // downside does not.
          const dead = !!inertFor(cand.name, b, spec);
          const better = bestName === null || improves(sc, bestScore) ||
                         (ties(sc, bestScore) && bestDead && !dead);
          if (better) {
            bestScore = sc; bestName = cand.name; bestDead = dead;
            bestAlloc = Object.assign({}, entry.alloc);
          }
        }
        if (bestName) {
          b.gear.push({ name: bestName, tier: tierOf(bestName), alloc: bestAlloc });
          recordAlts(b, 'gear' + b.gear.length, ranked, bestScore);
        }
      }

      // A locked slot is not searched — the point of choosing it is that it stays.
      if (spec.armour) b.armour = spec.armour;
      else bestOfSlot(b, spec, keepUsable(Object.keys(D.armourItems)), (bb, v) => { bb.armour = v; }, null, null, 'armour');

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
      }, (cand, cur) => M.weaponIsTiered(cand) && !M.weaponIsTiered(cur), null, 'weapon');
      // A weapon outside the tiered series has no tier and no allocation. Saying
      // otherwise is wrong in the output and writes meaningless bits into the
      // share link.
      if (b.weapon && !M.weaponIsTiered(b.weapon.name)) { b.weapon.tier = 0; b.weapon.alloc = {}; }

      // On a tie, the artifact actually built for this role wins. Narthana's
      // Sigil measures EXACTLY equal to Stellian Core on a healer — its damage
      // is written "X (scales on level)" and never stated, so the model can see
      // nothing — and list order was handing the healer the artifact for people
      // at full HP rather than the one that fires off their own healing.
      const isRoleItem = v => !!(v && K.roleItemNote && K.roleItemNote(spec.goal, v));
      bestOfSlot(b, spec, keepUsable(Object.keys(D.artifactItems)), (bb, v) => {
        bb.artifact = v ? { name: v, tier: D.MAX_GEAR_TIER, alloc: {} } : null;
      }, (cand, cur) => isRoleItem(cand) && !isRoleItem(cur), isRoleItem, 'artifact');
      if (b.artifact) bestTierAlloc(b, spec, b.artifact, false);

      // The mark. Venia's Permuth is scored as nothing (see evaluate), so this
      // is Astra's Utor against nothing - a survival build takes Astra, a
      // damage build ties and keeps Venia, which is the community's own split.
      b.mark = 'Venia';
      bestOfSlot(b, spec, Object.keys(K.MARK_ABILITIES || { Venia: 1 }).sort((x, y) => x === 'Venia' ? -1 : y === 'Venia' ? 1 : 0),
                 (bb, v) => { bb.mark = v; }, null, null, 'mark');
      // Permuth belongs on whichever stat the build actually leans on. Kept
      // whatever the mark, so switching back to Venia in the builder is ready.
      bestOfSlot(b, spec, order.slice(0, 3), (bb, v) => { bb.permuth = v; });

      if (spec.enchant) b.enchant = spec.enchant;
      else bestOfSlot(b, spec, ['', ...keepUsable(Object.keys(D.enchantItems))], (bb, v) => { bb.enchant = v; }, null, null, 'enchant');

      // The covenant goes in before mastery and stats, not after: it can add an
      // attack to the kit (Death Curtain scales on STR/75 + ARC/75, which pulls
      // a stat spread towards a hybrid) and it can move outgoing healing. Both
      // are things the stat allocator has to be able to see.
      b.covenantChoice = pickCovenant(b, spec);

      // Subclass and the three scroll slots, for the same reason and in the same
      // place: they add moves and buffs, and the allocator has to see them.
      //
      // Most of them measure at nothing — "fully heals your entire team" has no
      // number — so the role tiebreak is what actually decides those. That is
      // the honest split: measurement first, and where there is nothing to
      // measure, the item built for the job.
      const rolePick = (cand, cur) => !!(K.roleItemNote &&
        K.roleItemNote(spec.goal, cand) && !K.roleItemNote(spec.goal, cur));

      // A pinned slot is not searched. 'none' pins it EMPTY, which is not the
      // same instruction as leaving it on auto.
      const pinned = (slot, options) =>
        spec[slot] === 'none' ? [''] : (spec[slot] ? [spec[slot]] : options);

      const preferRole = v => !!(v && K.roleItemNote && K.roleItemNote(spec.goal, v));
      bestOfSlot(b, spec, pinned('sub', ['', ...(D.subClasses || [])]),
                 (bb, v) => { bb.sub = v; }, rolePick, preferRole, 'sub');

      const scrollOpts = scrollsFor(klass);
      bestOfSlot(b, spec, pinned('lostScroll', ['', ...scrollOpts.lost]),
                 (bb, v) => { bb.lostScroll = v; }, rolePick, preferRole, 'lostScroll');
      bestOfSlot(b, spec, pinned('scroll1', ['', ...scrollOpts.scrolls]),
                 (bb, v) => { bb.scroll1 = v; }, rolePick, preferRole, 'scroll1');
      bestOfSlot(b, spec, pinned('scroll2', ['', ...scrollOpts.scrolls.filter(n => n !== b.scroll1)]),
                 (bb, v) => { bb.scroll2 = v; }, rolePick, preferRole, 'scroll2');

      // Free slots, same as the shards. A scroll slot left blank because nothing
      // in it moved a number reads as a bug, and in game you would obviously
      // carry SOMETHING. So fill what is left with a scroll whose effect we can
      // at least describe, and record that it was a fill rather than a pick.
      b.scrollsInert = 0;
      const described = n => (K.SCROLL_NOTES || {})[n] || (K.roleItemNote && K.roleItemNote(spec.goal, n));
      const fill = (slot, pool) => {
        if (b[slot] || spec[slot] === 'none') return;
        const taken = [b.scroll1, b.scroll2, b.lostScroll];
        const pick = pool.filter(n => taken.indexOf(n) === -1)
                         .sort((x, y) => (described(y) ? 1 : 0) - (described(x) ? 1 : 0))[0];
        if (pick) { b[slot] = pick; b.scrollsInert++; }
      };
      fill('lostScroll', scrollOpts.lost);
      fill('scroll1', scrollOpts.scrolls);
      fill('scroll2', scrollOpts.scrolls);

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
      for (const g of b.gear) if (!fixedGear.has(g.name)) bestTierAlloc(b, spec, g, false);
      if (b.artifact) bestTierAlloc(b, spec, b.artifact, false);
      if (b.weapon && M.weaponIsTiered(b.weapon.name)) bestTierAlloc(b, spec, b.weapon, true);

      // Out of the dead zone with every flat source in place. The full "go
      // perfect" pass runs once, on the winning finalist (finishLine in run).
      snapToBreakpoints(b, spec);

      return b;
    }

    // Every passive the build actually has, read from the game data, split into
    // the ones knowledge.js can score and the ones it cannot. The second list is
    // reported with the build — an honest "here is what these numbers ignore",
    // and the to-do list for extending PASSIVES.
    const _passCache = {};
    function passivesFor(build) {
      const key = (build.race || '') + '|' + (build.klass || '') + '|' +
                  (build.covenant || '') + '|' + (build.covenantRank | 0);
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
      // A covenant is mostly passives - it is the whole reason to join one - and
      // its rank gates them exactly the way a class level gates a class passive.
      if (build.covenant) {
        const cov = (D.covenantMoves || {})[build.covenant];
        if (cov) {
          const rank = build.covenantRank | 0;
          scan({ learns: (cov.learns || []).filter(m => (m.level || 1) <= rank) }, build.covenant);
        }
      }

      return (_passCache[key] = { known, unknown });
    }

    // Which setup buffs this build can actually cast, from its race and class.
    const _setupCache = {};
    function setupsForKit(build) {
      const key = [build.race || '', build.klass || '', build.covenant || '',
                   build.covenantRank | 0, build.sub || '', build.scroll1 || '',
                   build.scroll2 || '', build.lostScroll || ''].join('|');
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
      if (build.covenant) {
        const cov = (D.covenantMoves || {})[build.covenant];
        if (cov) {
          const rank = build.covenantRank | 0;
          scan({ learns: (cov.learns || []).filter(m => (m.level || 1) <= rank) }, build.covenant);
        }
      }
      // A scroll's move shares the scroll's name, so the scroll IS the owner.
      if (build.sub) scan((D.classMoves || {})[build.sub], build.sub);
      for (const n of [build.scroll1, build.scroll2])
        if (n) scan((D.scrollMoves || {})[n], n);
      if (build.lostScroll) scan((D.lostScrollMoves || {})[build.lostScroll], build.lostScroll);

      return (_setupCache[key] = owned);
    }

    // Gear actives (Divine Promise's Divine Gift) on top of the kit's setups.
    // Kept out of the cache above: the gear changes on every candidate the
    // search tries, and keying the kit scan on it thrashed the cache into
    // re-reading four move tables per evaluate.
    function setupsFor(build) {
      const base = setupsForKit(build);
      const table = K.SETUP_MOVES || {};
      let extra = null;
      for (const g of build.gear || []) {
        const acts = (D.gearActives || {})[g.name];
        if (!acts) continue;
        for (const mv of acts) {
          const def = table[mv.name];
          if (def && (!def.owner || def.owner === g.name)) (extra = extra || []).push(Object.assign({ move: mv.name }, def));
        }
      }
      return extra ? base.concat(extra) : base;
    }

    // Gear passives, aggregated the same way traits are. Split into what can be
    // scored and what cannot, so a build can say which of its gear is doing
    // something the numbers above do not reflect.
    const gearPassiveTotals = memo(wornKey, build => gearPassiveTotalsUncached(build));
    function gearPassiveTotalsUncached(build) {
      const table = K.GEAR_PASSIVES || {};
      const text = D.itemPassives || {};
      const out = { dmgPct: 0, critChance: 0, hpPct: 0, dr: 0,
                    lifestealPct: 0, healFromDmgPct: 0, selfHealFlat: 0, healPctPerTurn: 0,
                    statFlat: { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
                    selfStatuses: new Set(), enemyStatuses: new Set(),
                    active: [], unmodelled: [] };
      const seen = new Set();
      // Where this build sits on its own health bar. An item gated on an HP
      // threshold is worth what it is worth TO THIS BUILD, not what it is worth
      // on average - which is the difference between Stellian Core being the
      // best artifact in the game and being nearly dead weight.
      const stance = K.hpStance ? K.hpStance(build.klass, build.race) : null;
      const gated = (name, declared) => (K.hpGateFor ? K.hpGateFor(name, stance, declared) : null);

      // An artifact's ability lives in artifactMoves, not itemPassives, so
      // without this an unmodelled artifact fell through to nothing at all - not
      // even the "not counted" list, which is where a reader would look for it.
      const artifactText = name => {
        const entry = (D.artifactMoves || {})[name];
        if (!entry) return null;
        return (entry.learns || []).map(m => m.effect || '').filter(Boolean)
                 .join(' ').replace(/\s+/g, ' ').trim() || null;
      };
      // A gear whose whole content is an ACTIVE (Divine Promise) has no passive
      // text at all, and used to vanish from both lists.
      const activeText = name => {
        const acts = (D.gearActives || {})[name];
        if (!acts || !acts.length) return null;
        return acts.map(m => 'grants ' + m.name + (m.effect ? ': ' + m.effect : ''))
                   .join(' ').replace(/\s+/g, ' ').trim();
      };

      // One effect of one item, applied to the totals. Every kind lands here.
      const apply = (name, e, up, extra) => {
        const kind = e.kind;
        let eff = 0;
        if (kind === 'status') {
          for (const st of (e.self || []))  out.selfStatuses.add(foldStatus(st));
          for (const st of (e.enemy || [])) out.enemyStatuses.add(foldStatus(st));
        } else if (kind === 'statRamp') {
          // +value per turn to every stat, counted at the assumed turn count.
          eff = e.value * Math.min(e.capTurns || 99, e.assumedTurns || 1);
          for (const st of STATS) out.statFlat[st] += eff;
        } else if (kind === 'onSite') {
          eff = 0;                                   // already in model.js
        } else if (e.value != null) {
          eff = e.value * up;
          if (typeof out[kind] === 'number') out[kind] += eff;
        }
        // The NAME stays the item's real name. Decorating it with the kind
        // broke the check that every counted passive traces back to a
        // knowledge entry, and that check is worth more than a tidier label.
        out.active.push(Object.assign({ name, kind, value: e.value, effective: eff, uptime: up,
                                        statuses: kind === 'status' ? (e.self || []).concat(e.enemy || []) : undefined,
                                        party: !!e.party, onSite: kind === 'onSite' }, extra || {}));
      };

      const consider = name => {
        if (!name || seen.has(name)) return;
        seen.add(name);

        // Multi-effect abilities: one artifact commonly grants damage AND
        // defence AND crit at once, which the single-kind rule cannot express.
        const art = (K.ARTIFACT_ABILITIES || {})[name];
        if (art && art.effects) {
          const g = gated(name, art.uptime ?? 1);
          const up = g ? g.uptime : (art.uptime ?? 1);
          for (const e of art.effects) {
            apply(name, e, up, { note: art.note, source: 'artifact',
                                 hpGate: g ? { agrees: g.agrees, uptime: g.uptime, why: g.why } : null });
          }
          return;
        }
        if (art && art.kind === 'note') {
          out.unmodelled.push({ name, note: art.note });
          return;
        }

        const rule = table[name];
        const priceable = rule && rule.kind !== 'note' &&
          (rule.kind === 'status' || rule.kind === 'onSite' || rule.kind === 'statRamp' ||
           rule.kind === 'multi' || rule.value != null);
        if (!priceable) {
          const txt = text[name] || artifactText(name) || activeText(name);
          if (txt || rule) out.unmodelled.push({ name, note: (rule && rule.note) || (txt || '').slice(0, 110) });
          return;
        }
        const g = gated(name, rule.uptime ?? 1);
        const up = g ? g.uptime : (rule.uptime ?? 1);
        const extra = { note: rule.note, hpGate: g ? { agrees: g.agrees, uptime: g.uptime, why: g.why } : null };
        const effects = rule.kind === 'multi' ? (rule.effects || []) : [rule];
        for (const e of effects) apply(name, e, up, extra);
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
        if (rule && rule.kind !== 'note' && (rule.kind === 'status' || rule.value != null)) {
          apply(series + ' (weapon)', rule, rule.uptime ?? 1, { note: rule.note });
        } else if (series) {
          const wtext = (D.itemPassives || {})[series];
          if (rule || wtext) {
            out.unmodelled.push({ name: series + ' (weapon)',
                                  note: (rule && rule.note) || (wtext || '').slice(0, 110) });
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

    // Memoised on the capstones taken, the class and the play style - and on
    // the IDENTITY of the two tables it reads, because the tests swap those out
    // under it and a stale total would hide the swap.
    let _maTableRef = null, _maDataRef = null;
    const _maCache = new Map();
    const _nodesKey = new WeakMap();   // the joined node list, kept on the array itself
    function masteryAbilityTotals(build, spec) {
      if (K.MASTERY_ABILITIES !== _maTableRef || D.masteryAbilities !== _maDataRef) {
        _maTableRef = K.MASTERY_ABILITIES; _maDataRef = D.masteryAbilities;
        _maCache.clear();
      }
      const nodes = build.masteryNodes || [];
      let nk = _nodesKey.get(nodes);
      if (nk === undefined) { nk = nodes.join(','); if (nodes.length) _nodesKey.set(nodes, nk); }
      const key = (build.klass || '') + '|' + nk + '|' + ((spec && spec.play) || '');
      if (_maCache.has(key)) return _maCache.get(key);
      if (_maCache.size > 4000) _maCache.clear();
      const v = masteryAbilityTotalsUncached(build, spec);
      _maCache.set(key, v);
      return v;
    }
    function masteryAbilityTotalsUncached(build, spec) {
      const table = K.MASTERY_ABILITIES || {};
      const perClass = (D.masteryAbilities || {})[build.klass] || {};
      // `dodge` is avoidance rather than reduction, and `statFlat` is a flat
      // stat rather than a percentage, so neither could be expressed before and
      // both were silently scored as nothing. The healing and lifesteal kinds
      // exist for the same reason: a Saint's capstones are heals, and until
      // they had a column here the engine could only buy them blind.
      const out = { dmgPct: 0, critChance: 0, dr: 0, dodge: 0,
                    outHealPct: 0, incHealPct: 0, lifestealPct: 0,
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

        // A bugged ability contributes nothing, exactly like a note — the
        // difference is what the capstone picker does with it, below.
        if ((rule && (rule.kind === 'note' || rule.kind === 'bugged')) ||
            (!rule && entry.bonus == null)) {
          out.unmodelled.push({ name: entry.name, note: (rule && rule.note) || null });
          continue;
        }
        // One capstone can do several things (All For One is lifesteal AND
        // incoming healing). `multi` carries them as a list; everything else is
        // a list of one, so the loop below is the only place a kind is applied.
        const effects = rule && rule.kind === 'multi'
          ? (rule.effects || [])
          : [{ kind: rule ? rule.kind : 'dmgPct',
               value: rule && rule.value != null ? rule.value : entry.bonus,
               stat: rule && rule.stat }];
        for (const ef of effects) {
          const kind   = ef.kind;
          const value  = ef.value;
          const uptime = ef.uptime != null ? ef.uptime
                       : rule && rule.uptime != null ? rule.uptime : K.MASTERY_ABILITY_DEFAULT_UPTIME;
          if (value == null) { out.unmodelled.push({ name: entry.name, note: rule && rule.note }); continue; }
          // A team effect is counted once for you and again for the allies it
          // reaches. A damage build gets a scale of exactly 1, so this can never
          // quietly inflate a solo build.
          const scale = (ef.party ?? (rule && rule.party)) ? partyScale(spec) : 1;
          // `onSite` means model.js already applies it (All For One's +40%
          // incoming healing is hard-coded in the site's own pipeline). It is
          // listed so the write-up can say so, and added to nothing, so it is
          // never counted twice.
          const eff = ef.onSite ? 0 : value * uptime * scale;
          if (!ef.onSite) {
            if (kind === 'statFlat') {
              const st = ef.stat || 'spd';
              if (out.statFlat[st] !== undefined) out.statFlat[st] += eff;
            } else if (typeof out[kind] === 'number') {
              out[kind] += eff;
            }
          }
          out.active.push({ name: entry.name, kind, value, uptime, effective: eff,
                            stat: ef.stat, party: scale > 1 ? scale : null,
                            onSite: !!ef.onSite, note: rule && rule.note });
        }
      }
      return out;
    }

    // Aggregate the scoreable passives into the same shape traits use.
    function passiveTotals(build) {
      const { known } = passivesFor(build);
      const out = { dmgPct: 0, critChance: 0, dr: 0, summonHpPct: 0, summonDmgPct: 0,
                    outHealPct: 0, incHealPct: 0, selfHealFlat: 0, lifestealPct: 0,
                    cdCut: 0, byMoveType: [] };
      const wepType = build.weapon ? ((D.weapons || {})[build.weapon.name] || {}).type : null;
      const stance = K.hpStance ? K.hpStance(build.klass, build.race) : null;
      const agreeUp = (K.HP_GATE_UPTIME || {}).agree ?? 0.8;
      for (const p of known) {
        // A weapon-training passive pays nothing without that weapon equipped.
        if (p.whenWeapon && p.whenWeapon !== wepType) continue;
        // A passive that only pays while you are hurt is worth its cautious
        // table value on a build that is not trying to be hurt, and the stance
        // uptime on one that is.
        const up = (p.hpGate && stance && stance.committed && stance.side === p.hpGate)
          ? Math.max(p.uptime ?? 1, agreeUp)
          : (p.uptime ?? 1);
        const v = p.value * up;
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
        build.masteryBudget = null; build.masteryNotation = '0-0-0'; return;
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
      // Measured against the CURRENT selection, not the empty tree: once a
      // capstone is bought, the next one is worth what it adds on top of it.
      // `_current` is the score of what is selected now; the cache is dropped
      // whenever that changes (resync).
      let _abilityCache = {};
      let _current = _probeBase;
      const abilityNames = (D.masteryAbilities || {})[build.klass] || {};
      const resync = () => {
        build.masteryNodes = all.filter(n => taken.has(n.id)).map(n => n.id);
        try { _current = evaluate(build, spec).score || 1; } catch (e) { /* keep the last base */ }
        _abilityCache = {};
      };
      const abilityValue = nodeId => {
        if (_abilityCache[nodeId] !== undefined) return _abilityCache[nodeId];
        const before = build.masteryNodes;
        build.masteryNodes = (before || []).concat([nodeId]);
        let v;
        try { v = Math.max(0, ((evaluate(build, spec).score / (_current || 1)) - 1) * 100); }
        catch (e) { v = 0; }
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
      // Every capstone bought, in the order it was bought - which is also the
      // order to take them in game. The first is what the build is built around.
      const capstoneOrder = [];

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
        // A capstone can be bought here too, on value per point. Once it is,
        // every later probe is measured on top of it.
        let boughtCapstone = false;
        for (const x of best.path) if (x.type === 'mastery') {
          capstoneOrder.push({ id: x.id, branch: x.branch, value: abilityValue(x.id), cost: best.c,
                               name: (abilityNames[x.id] || {}).name || x.id });
          boughtCapstone = true;
        }
        if (boughtCapstone) resync();
      }

      // ── the capstone pass ─────────────────────────────────────────────────
      // History: this block used to sit AFTER the "spend whatever is left"
      // filler, so it had exactly 0 points to work with every single time and
      // bought nothing, ever - which was precisely the "why does it skip
      // masteries for stat points" complaint.
      //
      // The value loop above already buys every priced capstone that pays per
      // point - a Saint healer leaves it holding One For All and All For One.
      // This pass is for what that loop cannot see: the one capstone an engine
      // with no number for it would otherwise never buy. It is measured on top
      // of what has already been bought, not on the empty tree.
      //
      // Five points is five stat nodes, so the choice is made on what the
      // ability actually does; picking by branch colour was choosing between
      // Overload (+100%, but only against stunned enemies) and Element Mastery
      // (+15% to a caster's entire kit) by which side of the tree they sat on.
      //
      // Buy on measured value when there is any. When every remaining capstone
      // measures zero, WHY it measures zero decides what happens next: a priced
      // ability that scores nothing has genuinely been weighed and turned down
      // for this goal, and those points are better spent as stats - but an
      // ability this engine cannot price scores zero for want of a number, not
      // for want of value, and a real in-game ability beats stat nodes the build
      // has already been measured not to want.
      const unpriced = x => {
        const e = ((D.masteryAbilities || {})[build.klass] || {})[x.n.id];
        if (!e) return false;
        const r = (K.MASTERY_ABILITIES || {})[e.name];
        // A known-bugged ability is NOT an unknown. The fallback below exists to
        // back a real ability the engine merely cannot measure; backing one that
        // does not work is how five mastery points get spent on nothing.
        if (r && r.kind === 'bugged') return false;
        return (r && r.kind === 'note') || (!r && e.bonus == null) ||
               (r && r.kind !== 'note' && r.kind !== 'multi' && r.value == null);
      };
      // What the pass had to work with - the write-up's "it cost 7 to reach
      // and 4 were left" is measured from here.
      const leftAtCapstone = CAP - spent;
      resync();
      // Remembered rather than discarded. "It costs 7 to reach and 4 were
      // left" is an answer; "it was not chosen" is not, and that is all the
      // output could say while the losers were being filtered away here.
      const considered = all.filter(n => n.type === 'mastery' && !taken.has(n.id))
        .map(n => {
          const path = closure(n.id);
          return { n, path, c: path.reduce((a, x) => a + _mastCost(x), 0),
                   v: abilityValue(n.id),
                   branchW: (w[(cd.branchStats || {})[n.branch]] || 0) };
        });
      const pointsLeft = CAP - spent;
      const capstones = considered.filter(x => x.c <= pointsLeft)
        // Ability value first; branch weight only breaks ties between abilities
        // this engine cannot tell apart, which is what it was always doing.
        .sort((a, b) => b.v - a.v || b.branchW - a.branchW || a.c - b.c);
      const bought = capstones.find(x => x.v > 0.01) || capstones.find(unpriced) || null;
      if (bought) {
        bought.path.forEach(x => taken.add(x.id));
        spent += bought.c;
        capstoneOrder.push({ id: bought.n.id, branch: bought.n.branch, value: bought.v, cost: bought.c,
                             name: (abilityNames[bought.n.id] || {}).name || bought.n.id });
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
      build.masteryBudget = { cap: CAP, spent, leftAtCapstone,
                              bought: bought ? (perClass[bought.n.id] || {}).name || null : null,
                              // Purchase order, which is also the order to take them in
                              // game: the first entry is what the build is built around.
                              capstoneOrder: capstoneOrder.slice(),
                              getFirst: capstoneOrder.length ? capstoneOrder[0] : null,
                              capstonesTaken: build.masteryNodes.filter(id => byId[id].type === 'mastery').length,
                              statNodes:      build.masteryNodes.filter(id => byId[id].type === 'node').length };
      build.masteryNotation = masteryNotation(build);
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
          if (rule && rule.kind === 'bugged') {
            reason = 'bugged';
            detail = rule.note;
          } else if (!known) {
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

    // The community writes a mastery tree as "a-b-c": how many capstone
    // Masteries are taken in the red, green and blue branches, two available in
    // each. "0-1-2" is one green capstone and both blue ones. It says nothing
    // about the stat nodes, which is the point - the capstones are the build.
    function masteryNotation(build) {
      const byId = {};
      (D.masteryNodes || []).forEach(n => { byId[n.id] = n; });
      const count = { red: 0, green: 0, blue: 0 };
      for (const id of build.masteryNodes || []) {
        const n = byId[id];
        if (n && n.type === 'mastery' && count[n.branch] !== undefined) count[n.branch]++;
      }
      return count.red + '-' + count.green + '-' + count.blue;
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
    // Every shard in the game is damage, lifesteal or energy. NONE of them
    // touches healing, block or incoming damage — so for a healer there is
    // genuinely nothing here, and the honest greedy answer is an empty socket.
    //
    // An empty socket is still the wrong ANSWER, because the slots are free and
    // you would obviously fill them in game. So: take everything that really
    // helps, then fill what is left with the best of the rest and record that
    // this is what happened, so the write-up can say "nothing here moves this
    // build's numbers" instead of implying seven measured upgrades.
    function pickShards(build, spec) {
      const names = Object.keys(D.shardItems || {});
      const slots = (K.SHARD_SLOTS || 7);
      build.shards = [];
      build.shardsInert = 0;

      for (let i = 0; i < slots; i++) {
        let bestName = null, bestScore = evaluate(build, spec).score;
        for (const name of names) {
          // A shard may be fitted more than once: the model counts copies of a
          // family the way the site does (two in full, then 25%), so the third
          // copy only wins when a quarter of it still beats every other shard.
          build.shards.push(name);
          const sc = evaluate(build, spec).score;
          build.shards.pop();
          if (improves(sc, bestScore)) { bestScore = sc; bestName = name; }
        }
        if (!bestName) break;          // nothing left that MEASURABLY helps
        build.shards.push(bestName);
      }

      // Free slots, filled by the ordinary damage ranking. Radiant before
      // Prismatic, since R is the better roll wherever both exist.
      if (build.shards.length < slots) {
        const rest = names
          .filter(n => !build.shards.includes(n))
          .sort((a, b) => {
            const va = (D.shardItems[a] || {}).rVal ?? (D.shardItems[a] || {}).pVal ?? 0;
            const vb = (D.shardItems[b] || {}).rVal ?? (D.shardItems[b] || {}).pVal ?? 0;
            return vb - va;
          });
        while (build.shards.length < slots && rest.length) {
          build.shards.push(rest.shift());
          build.shardsInert++;
        }
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
            if (improves(sc, bestScore)) { bestScore = sc; bestId = id; }
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

    // ── covenant ─────────────────────────────────────────────────────────────
    // Unlike corruption, this runs BEFORE the build is finished, because a
    // covenant can change the numbers: Way of Life's outgoing healing is in the
    // site's own covenantBonuses, and Death Curtain and Gilded Strike are real
    // attacks that the damage search should be allowed to build around.
    //
    // Measurement first, knowledge second. Three of the four covenants measure
    // identically on most goals - they hand out no stats at all - so `fit` is
    // what separates them, capped at a 5% swing so it can never overturn a real
    // measured gap.
    const COVENANT_FIT_WEIGHT = 0.05;
    function pickCovenant(build, spec) {
      const min = K.COVENANT_MIN_LEVEL ?? 10;
      if ((build.level || 0) < min) { build.covenant = ''; build.covenantRank = 1; return null; }

      const all = Object.keys(D.covenantItems || {});
      if (!all.length) return null;
      const rank = K.COVENANT_ASSUMED_RANK ?? 20;
      // A locked covenant is not searched. Everything else still runs, so the
      // write-up can say what the locked one gives and what it gave up.
      const locked = spec.covenant && all.indexOf(spec.covenant) !== -1 ? spec.covenant : null;

      const scored = [];
      for (const name of all) {
        build.covenant = name;
        build.covenantRank = rank;
        const ctx = evaluate(build, spec);
        const entry = (K.COVENANTS || {})[name] || {};
        let fit = { score: 0, why: '' };
        if (entry.fit) { try { fit = entry.fit(ctx, spec) || fit; } catch (e) { /* a covenant is not worth losing the build over */ } }
        scored.push({
          name, measured: ctx.score, fit: fit.score, why: fit.why,
          blurb: entry.blurb || '', unpriced: entry.unpriced || [],
          score: ctx.score * (1 + COVENANT_FIT_WEIGHT * Math.max(0, Math.min(100, fit.score)) / 100),
        });
      }
      scored.sort((a, b) => b.score - a.score);
      const chosen = locked ? scored.find(x => x.name === locked) : scored[0];
      build.covenant = chosen.name;
      build.covenantRank = rank;
      // Whether the measurement or the reasoning decided it. Worth being exact
      // about: "they measured the same and this one reads best" is a very
      // different claim from "this one is worth 15% more outgoing healing".
      //
      // The test is whether the winner would STILL win with the fit weight set
      // to zero — that is, whether it holds the measured top spot on its own.
      // Checking that the four merely differ somewhere is a weaker claim that
      // was being reported as the stronger one.
      const top = Math.max(...scored.map(x => x.measured));
      const eps = 1e-6 * Math.max(1, Math.abs(top));
      const tied = scored.filter(x => x.measured >= top - eps);
      const decidedBy = locked ? 'locked'
                      : (tied.length === 1 && tied[0].name === chosen.name) ? 'measured' : 'fit';
      return { best: chosen, all: scored, rank, decidedBy, locked, tied: tied.length };
    }

    // ── corruption ───────────────────────────────────────────────────────────
    // A named fight may carry a preferred form (BOSS_TACTICS[...].preferForm),
    // recorded from how the community plays it. It is a bounded nudge on the
    // fit score - enough to decide a close call, never enough to overturn a
    // form the kit has no use for - and the reason travels with the pick.
    const PREFER_FORM_WEIGHT = 0.25;
    function pickCorruption(ctx, spec) {
      const pref = spec && spec.boss ? (((K.BOSS_TACTICS || {})[spec.boss] || {}).preferForm || null) : null;
      const scored = K.CORRUPTION.map(entry => {
        const r = entry.fit(ctx);
        const preferred = !!(pref && pref.form === entry.form);
        return Object.assign({ form: entry.form,
                               score: r.score * (preferred ? 1 + PREFER_FORM_WEIGHT : 1),
                               why: r.why + (preferred ? ' Recommended for ' + spec.boss + ': ' + pref.why + '.' : ''),
                               preferred },
                             { damage: corruptionDamage(entry.form, ctx) });
      }).sort((a, b) => b.score - a.score);
      return { best: scored[0], all: scored, preferred: pref ? pref.form : null };
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
    // Every race in the data is searched. There used to be a `placeholder`
    // exclusion for races with no stat block; Arborivia and Calvariae were the
    // last two, and the owner supplied their real numbers (builder.js `races`).
    const allRaces = () => Object.keys(D.races || {});

    // Races that suit a goal. Used for RANDOM rolls, where the maths cannot save
    // us: most racial passives are prose the engine cannot read, so left to base
    // stats alone it will happily roll Daminos for a damage build — four lives
    // and outgoing healing, which is excellent and entirely beside the point.
    //
    // Falls back to every race rather than to nothing.
    function racesForGoal(goal) {
      const want = (K.GOAL_RACE_ROLES || {})[goal];
      const roles = K.RACE_ROLES || {};
      if (!want) return allRaces();
      const fit = allRaces().filter(r => {
        const rr = (roles[r] || {}).roles || [];
        return rr.some(x => want.indexOf(x) !== -1);
      });
      // Tech races are off-role but earn their place through a specific combo.
      for (const t of techFor(goal)) if (fit.indexOf(t.race) === -1 && allRaces().indexOf(t.race) !== -1) fit.push(t.race);
      return fit.length ? fit : allRaces();
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
      const races = spec.race ? [spec.race] : allRaces();

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
      const built = [];
      for (const f of finalists) {
        const b = buildFor(f.k, f.r, spec);
        const ctx = evaluate(b, spec);
        built.push({ k: f.k, r: f.r, score: ctx.score });
        if (!best || ctx.score > bestCtx.score) { best = b; bestCtx = ctx; }
      }

      // The winner's stat line goes "perfect" here, once, and its ctx is
      // re-read afterwards so everything downstream sees the finished totals.
      finishLine(best, spec);
      bestCtx = evaluate(best, spec);

      // What came second. Races for the winning class from the finalists are
      // FULL builds, ranked; the rest of the coarse pass fills in behind them
      // and is marked as coarse. Classes are the best coarse pair per class.
      const topScore = Math.max(...built.map(x => x.score), 1e-9);
      const seenRace = new Set();
      const raceAlts = [];
      for (const x of built.filter(x => x.k === best.klass).sort((a, b) => b.score - a.score)) {
        seenRace.add(x.r);
        raceAlts.push({ race: x.r, score: x.score, delta: Math.max(0, (topScore - x.score) / topScore), full: true });
      }
      for (const x of coarse.filter(x => x.k === best.klass && !seenRace.has(x.r)).slice(0, 8)) {
        seenRace.add(x.r);
        raceAlts.push({ race: x.r, score: x.score, delta: null, full: false });
      }
      const classBest = {};
      for (const x of coarse) if (!classBest[x.k] || x.score > classBest[x.k].score) classBest[x.k] = x;
      const classTop = Math.max(...Object.values(classBest).map(x => x.score), 1e-9);
      const classAlts = Object.values(classBest).sort((a, b) => b.score - a.score).slice(0, 8)
        .map(x => ({ klass: x.k, race: x.r, score: x.score, delta: Math.max(0, (classTop - x.score) / classTop), coarse: true }));

      const corr = pickCorruption(bestCtx, spec);
      best.corruption = corr.best.form;

      return { build: best, ctx: bestCtx, corruption: corr, considered: coarse.length,
               covenant: best.covenantChoice || null,
               alternatives: { race: raceAlts, class: classAlts },
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

    return { run, evaluate, movesFor, covenantMovesFor, kitFor, baseOf, weightOf, rankGear,
             pickCorruption, pickCovenant,
             flavourFor, rollRandom, weaknessesOf, racesForGoal, allRaces, techForRace,
             masteryLegal, unavailableReason, usable, corruptionDamage, weaponsFor,
             passivesFor, setupsFor, healMovesFor, buildDoes, statusesOf, maxHealthSoul, inertFor, cautionFor,
             gearPassiveTotals, passiveTotals,
             masteryAbilityTotals, masteryNotation, classesForLevel,
             snapToBreakpoints, goPerfect, finishLine, decayedScore, investedForTotal, statLineFor, tierOrder,
             speedFloor };
  }

  return { Optimizer };
}));
