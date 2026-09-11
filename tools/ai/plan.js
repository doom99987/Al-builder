/*
  The BuildPlan: one structured object describing a finished build - every
  slot with what was chosen, what came second and by how much, and why - that
  every renderer reads FROM. explain.js turns it into sections, the site panel
  turns it into the builder's summary box, the CLI prints it as JSON.

      const plan = Plan.compose(result, spec, M, K, data);

  It is the seam for anything that wants to write about a build later - a
  language model included: hand it this object and nothing else, and it has
  every number and every reason the engine had, and no way to invent one.

  compose() is pure and tolerant: engine.analyse passes a partial result (no
  covenant, no corruption, no flavour) and every field it cannot fill is null
  or empty rather than a throw.
*/
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ALB_Plan = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  const STATS = ['str', 'arc', 'end', 'spd', 'lck'];
  const VERSION = 1;

  const r1 = v => (v == null || !isFinite(v)) ? null : Math.round(v * 10) / 10;

  // ── alternatives ──────────────────────────────────────────────────────────
  // `build._alts[slot]` is what bestOfSlot measured: every option, its score and
  // how far behind the best it was. `chosen` may not be the top score - a role
  // item wins inside the allowance - so the chosen row is marked rather than
  // assumed to be first.
  function altsFor(build, key, chosen) {
    const list = ((build && build._alts) || {})[key] || [];
    return list.map(a => ({
      name: a.name, score: a.score, delta: a.delta,
      chosen: a.name === (chosen == null ? '' : chosen) || (!a.name && !chosen),
    }));
  }

  // The owner's legend, measured: an italic "must have" is a slot where nothing
  // else comes close; "optional" is a slot where the runner-up ties.
  function priorityOf(alts, chosen) {
    const others = alts.filter(a => !a.chosen);
    if (!others.length) return 'must';
    const best = others.reduce((m, a) => Math.min(m, a.delta), Infinity);
    if (best >= 0.10) return 'must';
    if (best <= 0.01) return 'optional';
    return 'preferred';
  }

  function slot(chosen, alts, extra) {
    const alternatives = alts.filter(a => !a.chosen).slice(0, 5);
    return Object.assign({ chosen: chosen || null, alternatives, priority: priorityOf(alts, chosen) }, extra || {});
  }

  const family = name => String(name || '').replace(/ \([RP]\)$/, '');

  function countBy(list, keyFn) {
    const out = {};
    for (const x of list) { const k = keyFn(x); if (k) out[k] = (out[k] || 0) + 1; }
    return Object.entries(out).sort((a, b) => b[1] - a[1]).map(([name, copies]) => ({ name, copies }));
  }

  const summaryOf = fams => fams.map(f => (f.copies > 1 ? f.copies + 'x ' : '') + f.name).join(', ');

  // ── compose ───────────────────────────────────────────────────────────────
  function compose(result, spec, M, K, data) {
    const b = (result && result.build) || {};
    const c = (result && result.ctx) || {};
    const D = data || {};
    spec = spec || {};
    const gp = c.gearPassives || { active: [], unmodelled: [] };
    const passiveOf = name => gp.active.filter(a => a.name === name);
    const unmodelledOf = name => gp.unmodelled.find(u => u.name === name) || null;
    const traitName = id => ((D.gearTraits || {})[id] || {}).name || id;
    const arch = (K.ARCHETYPES || {})[spec.goal] || {};

    // ── request ─────────────────────────────────────────────────────────────
    const request = {
      text: spec.text || '', goal: spec.goal || null, goals: spec.goals || [],
      roles: spec.roles || [], play: spec.play || null, dmg: spec.dmg || null,
      boss: spec.boss || null, level: b.level || spec.level || null,
      locked: spec.locked || {}, assumptions: spec.assumptions || [],
      minmax: !!spec.minmax,
    };

    // ── summary ─────────────────────────────────────────────────────────────
    const roleDefs = (spec.roles || []).map(r => (K.ROLES || {})[r]).filter(Boolean);
    const summary = {
      name: result.flavour ? result.flavour.name : null,
      line: result.flavour ? result.flavour.line : null,
      role: roleDefs.length ? roleDefs.map(r => r.label).join(' + ')
          : (K.roleOf && K.roleOf(spec.goal) ? K.roleOf(spec.goal).label : null),
      goalLabel: arch.label || spec.goal || null,
      class: b.klass || null, race: b.race || null, sub: b.sub || null,
      level: b.level || null, score: r1(c.score),
      headline: {
        bestHit: r1(c.bestHit), bestMove: c.bestMove ? c.bestMove.name : null,
        sustainedHit: r1(c.sustainedHit), bestBurst: r1(c.bestBurst),
        hp: r1(c.hp), effectiveHp: r1(c.effectiveHp), effectiveHpSustain: r1(c.effectiveHpSustain),
        critChance: r1(c.critChance), critTier: c.critTier || 0, critDmg: r1(c.critDmg),
        blockDr: r1(c.blockDr), dodge: r1(c.dodge), initiative: r1(c.initiative),
        outHeal: r1(c.outHeal), incHeal: r1(c.incHeal),
        effectiveHeal: r1(c.effectiveHeal), effectiveIncHeal: r1(c.effectiveIncHeal),
        healPerTurn: r1(c.healPerTurn), teamHealPerTurn: r1(c.teamHealPerTurn),
        lifesteal: r1(c.lifesteal), sustainPerTurn: r1(c.sustainPerTurn),
        energyCap: c.energyCap == null ? null : c.energyCap,
      },
      weaknesses: result.weaknesses || [],
    };

    // ── stats ───────────────────────────────────────────────────────────────
    const ms = c.milestones || { reached: [], missed: [], cdCut: [] };
    const counted = m => m.kind !== 'note';
    const decay = K.STAT_DECAY || null;
    const stats = {
      invested: Object.assign({ str: 0, arc: 0, end: 0, spd: 0, lck: 0 }, b.invested || {}),
      total: Object.assign({}, c.siteStats || c.stats || {}),   // the site's stat row
      scored: Object.assign({}, c.stats || {}),                 // with combat overlays (ramps, stances)
      line: (b._statLine || []).map(x => Object.assign({}, x)),
      breakpoints: {
        reached: ms.reached.filter(counted).map(m => ({ stat: m.stat, need: m.need, text: m.text })),
        missed:  ms.missed.filter(counted).map(m => ({ stat: m.stat, need: m.need, text: m.text })),
        deadZone: c.deadZone || [],
        decay: decay ? { knee: decay.knee, next: decay.next, assumed: !!decay.assumed, note: decay.note || null } : null,
      },
      tierPriority: b._tierOrder || null,
      tierPoints: {
        gear: (b.gear || []).map(g => ({ name: g.name, tier: g.tier | 0, alloc: Object.assign({}, g.alloc || {}) })),
        artifact: b.artifact ? { name: b.artifact.name, tier: b.artifact.tier | 0, alloc: Object.assign({}, b.artifact.alloc || {}) } : null,
        weapon: b.weapon ? { name: b.weapon.name, tier: b.weapon.tier | 0, alloc: Object.assign({}, b.weapon.alloc || {}) } : null,
      },
      permuth: b.mark === 'Venia' && b.permuth
        ? Object.assign({ stat: b.permuth, inTotals: false }, K.PERMUTH || {}) : null,
      soul: Object.assign({}, b.soul || {}),
      soulNote: b.soul && Object.keys(b.soul).length
        ? 'assumes the soul tree health nodes are maxed; without them take 10-20 extra Endurance' : null,
    };

    // ── slots ───────────────────────────────────────────────────────────────
    const A = (result && result.alternatives) || {};
    const raceAlts = (A.race || []).map(x => ({ name: x.race, score: x.score, delta: x.delta, full: !!x.full, chosen: x.race === b.race,
                                                why: ((K.RACE_ROLES || {})[x.race] || {}).note || null }));
    const classAlts = (A.class || []).map(x => ({ name: x.klass, race: x.race, score: x.score, delta: x.delta, chosen: x.klass === b.klass }));

    const gear = (b.gear || []).map((g, i) => {
      const alts = altsFor(b, 'gear' + (i + 1), g.name);
      const p = passiveOf(g.name);
      const um = unmodelledOf(g.name);
      const inert = (c.inertGear || []).indexOf(g.name) !== -1;
      const caution = (c.cautionGear || []).indexOf(g.name) !== -1;
      return slot(g.name, alts, {
        slot: i + 1, tier: g.tier | 0, alloc: Object.assign({}, g.alloc || {}),
        base: Object.assign({}, (D.gearItems || {})[g.name] || {}),
        traits: (g.traits || []).map(t => ({ id: t.id, name: traitName(t.id), tier: t.tier })),
        passive: p.length ? p.map(a => ({ kind: a.kind, value: a.value, effective: a.effective, note: a.note || null,
                                           statuses: a.statuses || null, onSite: !!a.onSite })) : null,
        notCounted: um ? um.note : null,
        inert, caution,
        why: inert ? 'worn for its stat block - ' + (K.gearNeedNote ? K.gearNeedNote(g.name) : 'its passive cannot fire here')
           : p.length ? (p[0].note || 'its passive is counted')
           : um ? 'its passive is real and not priced: ' + um.note
           : 'stat block',
        replaceable: alts.some(a => !a.chosen && a.delta <= 0.03),
      });
    });

    const wpn = b.weapon ? b.weapon.name : null;
    const wdef = wpn ? ((D.weapons || {})[wpn] || {}) : {};
    const weaponAlts = altsFor(b, 'weapon', wpn);
    const artAlts = altsFor(b, 'artifact', b.artifact ? b.artifact.name : '');
    const armAlts = altsFor(b, 'armour', b.armour);
    const rolePicks = b._rolePicks || {};
    const artRule = b.artifact ? ((K.ARTIFACT_ABILITIES || {})[b.artifact.name] || null) : null;
    const cov = result.covenant || b.covenantChoice || null;
    const corr = result.corruption || null;

    const shardList = (b.shards || []).slice();
    const shardFamilies = countBy(shardList, family);
    const traitRows = list => countBy(list.flatMap(g => (g.traits || []).map(t => traitName(t.id))), x => x);
    const gearTraits = traitRows(b.gear || []);
    const artTraits = b.artifact ? traitRows([b.artifact]) : [];

    const mb = b.masteryBudget || {};
    const slots = {
      class: { chosen: b.klass || null, alternatives: classAlts.filter(x => !x.chosen).slice(0, 5),
               decidedBy: (spec.locked || {}).klass ? 'locked' : 'measured',
               why: arch.blurb || null },
      race: Object.assign(slot(b.race, raceAlts), {
        why: ((K.RACE_ROLES || {})[b.race] || {}).note || null,
        tech: spec.tech ? { name: spec.tech.name, why: spec.tech.why } : null,
        decidedBy: (spec.locked || {}).race ? 'locked' : 'measured',
      }),
      gear,
      armour: Object.assign(slot(b.armour, armAlts), {
        block: Object.assign({}, (D.armourItems || {})[b.armour] || {}),
        runnerUp: armAlts.filter(a => !a.chosen)[0] || null,
      }),
      weapon: Object.assign(slot(wpn, weaponAlts), {
        series: wdef.series || null, type: wdef.type || null,
        tiered: !!(b.weapon && M && M.weaponIsTiered && M.weaponIsTiered(wpn)),
        tier: b.weapon ? (b.weapon.tier | 0) : 0, alloc: b.weapon ? Object.assign({}, b.weapon.alloc || {}) : {},
        passive: wdef.series ? (passiveOf(wdef.series + ' (weapon)')[0] || null) : null,
        why: wdef.series ? (((K.WEAPON_PASSIVES || {})[wdef.series] || {}).note || null) : null,
      }),
      artifact: Object.assign(slot(b.artifact ? b.artifact.name : null, artAlts), {
        tier: b.artifact ? (b.artifact.tier | 0) : 0, alloc: b.artifact ? Object.assign({}, b.artifact.alloc || {}) : {},
        traits: b.artifact ? (b.artifact.traits || []).map(t => ({ id: t.id, name: traitName(t.id), tier: t.tier })) : [],
        roleMargin: b.artifact && rolePicks[b.artifact.name] != null ? rolePicks[b.artifact.name] : null,
        why: b.artifact ? ((K.roleItemNote && K.roleItemNote(spec.goal, b.artifact.name)) || (artRule && artRule.note) || null) : null,
      }),
      enchant: Object.assign(slot(b.enchant, altsFor(b, 'enchant', b.enchant)), {
        counted: !!(c.enchant && c.enchant.kind !== 'note'),
        why: c.enchant ? (c.enchant.note || null) : (b.enchant ? 'not priced' : 'nothing measured'),
      }),
      mark: Object.assign(slot(b.mark, altsFor(b, 'mark', b.mark)), {
        permuth: stats.permuth,
        why: b.mark ? (((K.MARK_ABILITIES || {})[b.mark] || {}).note || null) : null,
      }),
      subclass: Object.assign(slot(b.sub, altsFor(b, 'sub', b.sub)), {
        why: b.sub ? ((K.roleItemNote && K.roleItemNote(spec.goal, b.sub)) || (rolePicks[b.sub] != null ? 'chosen for the role' : 'measured')) : null,
        roleMargin: b.sub && rolePicks[b.sub] != null ? rolePicks[b.sub] : null,
      }),
      lostScroll: Object.assign(slot(b.lostScroll, altsFor(b, 'lostScroll', b.lostScroll)), {
        why: b.lostScroll ? ((K.SCROLL_NOTES || {})[b.lostScroll] || (K.roleItemNote && K.roleItemNote(spec.goal, b.lostScroll)) || null) : null,
      }),
      scrolls: [b.scroll1, b.scroll2].map((n, i) => Object.assign(slot(n, altsFor(b, 'scroll' + (i + 1), n)), {
        why: n ? ((K.SCROLL_NOTES || {})[n] || (K.roleItemNote && K.roleItemNote(spec.goal, n)) || null) : null,
      })),
      scrollsInert: b.scrollsInert || 0,
      covenant: {
        chosen: b.covenant || null, rank: b.covenantRank || null,
        alternatives: cov && cov.all ? cov.all.filter(x => x.name !== b.covenant)
          .map(x => ({ name: x.name, score: x.score, delta: cov.best && cov.best.score ? Math.max(0, (cov.best.score - x.score) / cov.best.score) : 0, why: x.why || null })) : [],
        decidedBy: cov ? cov.decidedBy : null, tied: cov ? cov.tied : null,
        why: cov && cov.best ? (cov.best.why || cov.best.blurb || null) : null,
        unpriced: cov && cov.best ? (cov.best.unpriced || []) : [],
        priority: cov && cov.decidedBy === 'measured' ? 'preferred' : 'optional',
      },
      corruption: {
        chosen: b.corruption || (corr && corr.best ? corr.best.form : null),
        alternatives: corr && corr.all ? corr.all.filter(x => x.form !== (b.corruption || corr.best.form))
          .map(x => ({ name: x.form, score: x.score, why: x.why || null })) : [],
        why: corr && corr.best ? corr.best.why : null,
        damage: corr && corr.best ? corr.best.damage || null : null,
      },
      shards: {
        list: shardList, families: shardFamilies, summary: summaryOf(shardFamilies),
        inert: b.shardsInert || 0,
        counted: (c.shards && c.shards.active) ? c.shards.active.map(a => ({ name: a.name, effective: a.effective, copy: a.copy || 1 })) : [],
      },
      traits: {
        gear: gearTraits, artifact: artTraits,
        summary: [gearTraits.length ? 'Gears ' + summaryOf(gearTraits) : null,
                  artTraits.length ? 'Artifact ' + summaryOf(artTraits) : null].filter(Boolean).join('; ') || null,
      },
      mastery: {
        notation: b.masteryNotation || null,
        capstones: (mb.capstoneOrder || []).map((x, i) => ({ id: x.id, name: x.name, branch: x.branch, order: i + 1, value: r1(x.value), cost: x.cost })),
        getFirst: mb.getFirst ? { id: mb.getFirst.id, name: mb.getFirst.name, branch: mb.getFirst.branch } : null,
        points: { spent: mb.spent == null ? null : mb.spent, cap: mb.cap == null ? null : mb.cap },
        statNodes: mb.statNodes == null ? null : mb.statNodes,
        nodes: (b.masteryNodes || []).slice(),
        passedOver: (b.masteryPassedOver || []).map(x => ({ name: x.name, reason: x.reason, value: r1(x.value), cost: x.cost })),
        counted: (c.masteryAbilities && c.masteryAbilities.active) ? c.masteryAbilities.active.map(a => ({ name: a.name, kind: a.kind, value: a.value, effective: a.effective, onSite: !!a.onSite })) : [],
        notCounted: (c.masteryAbilities && c.masteryAbilities.unmodelled) ? c.masteryAbilities.unmodelled.map(u => u.name) : [],
      },
    };

    // ── rotation and play ───────────────────────────────────────────────────
    const rotation = {
      opener: (c.rotation || []).map(rt => ({ move: rt.move, gain: rt.gain, note: rt.note || null, uptime: rt.uptime })),
      finisher: (c.burstMove || c.bestMove) ? (c.burstMove || c.bestMove).name : null,
      bestHit: r1(c.bestHit), bestBurst: r1(c.bestBurst), sustainedHit: r1(c.sustainedHit),
      heals: (c.heals || []).map(h => ({ name: h.name, amount: r1(h.amount), cd: h.cd, perTurn: r1(h.perTurn) })),
      inForm: corr && corr.best && corr.best.damage ? (corr.best.damage.steps || []).map(st => ({ move: st.move, turns: st.turns, isFinisher: !!st.isFinisher })) : [],
    };
    const bf = c.bossFit && c.bossFit.boss ? c.bossFit : null;
    const tac = spec.boss ? ((K.BOSS_TACTICS || {})[spec.boss] || {}) : {};
    const kitNames = new Set((c.moves || []).map(m => m.name).concat((c.heals || []).map(h => h.name)));
    const notes = [];
    for (const [move, note] of Object.entries(K.PLAY_NOTES || {})) if (kitNames.has(move)) notes.push({ move, note });
    const play = {
      boss: bf ? {
        name: bf.boss.name, hp: bf.hp || null, hpCorrupted: bf.hpCorrupted || null, res: bf.res || {},
        killTurns: r1(bf.killTurns), killTurnsCorrupted: r1(bf.killTurnsCorrupted),
        immune: bf.boss.statusImmune || [], reasons: (bf.reasons || []).map(r => ({ kind: r.kind, pct: r.pct, text: r.text })),
        why: bf.boss.why || null, alsoWatch: bf.boss.alsoWatch || null, modelled: !!bf.boss.modelled,
      } : null,
      tactics: tac.plan || [],
      preferForm: tac.preferForm || null,
      notes,
      hpStance: c.hpStance && c.hpStance.committed ? { side: c.hpStance.side, sources: c.hpStance.sources } : null,
    };

    // ── gaps ────────────────────────────────────────────────────────────────
    const assumed = [];
    if (decay && decay.assumed) assumed.push('stat decay: past ~' + decay.knee + ' a stat falls off (owner\'s rule; not the site\'s maths)');
    if (K.SUSTAIN && K.SUSTAIN.assumed) assumed.push('sustain: lifesteal and regen counted over ' + K.SUSTAIN.horizon + ' turns at ' + Math.round(K.SUSTAIN.attackShare * 100) + '% attacking turns');
    if (stats.soulNote) assumed.push(stats.soulNote);
    if (cov && cov.rank) assumed.push('covenant at rank ' + cov.rank);
    const gaps = {
      passivesNotCounted: ((c.passiveList || {}).unknown || []).map(p => ({ name: p.name, owner: p.owner })),
      gearNotCounted: gp.unmodelled.map(u => ({ name: u.name, note: u.note || null })),
      masteryNotCounted: slots.mastery.notCounted,
      assumed,
      warnings: (result.warnings || []).map(w => ({ name: w.name, text: w.text })),
      error: result.error || null,
    };

    return { version: VERSION, request, summary, stats, slots, rotation, play, gaps };
  }

  // Everything numeric a reader needs, in one flat line: the community shape.
  function oneLiner(plan) {
    const s = plan.slots;
    const g = (s.gear || []).map(x => x.chosen).filter(Boolean).join(', ');
    return [
      plan.summary.class + (s.subclass.chosen ? ' / ' + s.subclass.chosen : ''),
      plan.summary.race, 'Gears: ' + g, 'Armour: ' + (s.armour.chosen || '-'),
      'Weapon: ' + (s.weapon.chosen || '-'), 'Artifact: ' + (s.artifact.chosen || '-'),
      'Mastery: ' + (s.mastery.notation || '-'), 'Shards: ' + (s.shards.summary || '-'),
      'Covenant: ' + (s.covenant.chosen || '-'), 'Form: ' + (s.corruption.chosen || '-'),
    ].join(' | ');
  }

  return { compose, oneLiner, priorityOf, VERSION };
}));
