/*
  The explainer.

  A build nobody understands is a build nobody trusts. This assembles the
  reasoning from templates and the actual computed numbers — never vague praise,
  always the figure that justifies the choice.

  It is also where honesty lives. If the optimiser assumed something, the
  assumption is printed. If a passive could not be modelled, it says so rather
  than quietly scoring it as zero.
*/
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ALB_Explain = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  const n1 = v => (Math.round(v * 10) / 10).toLocaleString();
  const n0 = v => Math.round(v).toLocaleString();

  function render(result, spec, M, K, data) {
    const b = result.build, c = result.ctx;
    const arch = K.ARCHETYPES[spec.goal] || K.ARCHETYPES[K.DEFAULT_GOAL];
    const L = [];

    // ── what was asked for ──────────────────────────────────────────────────
    L.push({ h: 'Request', body: spec.text ? '"' + spec.text + '"' : '(nothing specified)' });

    if (spec.assumptions.length) {
      L.push({ h: 'What I assumed', list: spec.assumptions });
    }

    // ── the build ───────────────────────────────────────────────────────────
    const kit = [];
    kit.push(['Class',  b.klass || '—']);
    kit.push(['Race',   b.race || '—']);
    kit.push(['Level',  String(b.level)]);
    kit.push(['Armour', b.armour || '—']);
    if (b.weapon)   kit.push(['Weapon', b.weapon.name + tierNote(b.weapon, data, M)]);
    if (b.artifact) kit.push(['Artifact', b.artifact.name + tierNote(b.artifact, data, M)]);
    b.gear.forEach((g, i) => kit.push(['Gear ' + (i + 1), g.name + tierNote(g, data, M)]));
    if (b.enchant) kit.push(['Enchant', b.enchant]);
    if (b.mark)    kit.push(['Mark', b.mark + (b.permuth ? ' — Permuth on ' + b.permuth.toUpperCase() : '')]);
    if (b.corruption) kit.push(['Corruption', b.corruption]);
    L.push({ h: 'Build', table: kit });

    // ── stats ───────────────────────────────────────────────────────────────
    const inv = b.invested;
    L.push({ h: 'Stat points', table: [
      ['Invested', ['str','arc','end','spd','lck'].map(s => s.toUpperCase() + ' ' + inv[s]).join('  ·  ')],
      ['Totals',   ['str','arc','end','spd','lck'].map(s => s.toUpperCase() + ' ' + c.stats[s]).join('  ·  ')],
      ['HP', n1(c.hp)],
      ['Crit chance', n1(c.critChance) + '%' + (c.critTier ? '  (tier ' + c.critTier + ' — every hit crits)' : '')],
      ['Crit damage', c.critDmg.toFixed(2) + 'x'],
      ['Block DR / Initiative', n1(c.blockDr) + '%  ·  ' + n1(c.initiative) + '%'],
      ['Heal out / in', n1(c.outHeal) + '%  ·  ' + n1(c.incHeal) + '%'],
      ['Max energy', String(c.energyCap ?? '—') +
        (c.traits && c.traits.energyCap ? '  (+' + c.traits.energyCap + ' from Overflow)' : '')],
    ]});

    // ── traits ──────────────────────────────────────────────────────────────
    if (c.traits && (c.traits.active.length || c.traits.unmodelled.length)) {
      const rows = [];
      const byId = {};
      for (const a of c.traits.active) {
        if (!byId[a.id]) byId[a.id] = { name: a.name, copies: 0, total: a.total, when: a.when };
        byId[a.id].copies = a.copies;
      }
      for (const t of Object.values(byId)) {
        rows.push([t.name + (t.copies > 1 ? ' ×' + t.copies : ''),
                   t.total + (t.when ? '  — only ' + t.when : '')]);
      }
      for (const u of c.traits.unmodelled) {
        rows.push([u.name + '  (not scored)', u.note || '']);
      }
      L.push({ h: 'Traits', table: rows });
    }

    // ── why ─────────────────────────────────────────────────────────────────
    const why = [];
    why.push('Optimised for **' + arch.label.toLowerCase() + '**. ' + arch.blurb);

    if (c.bestMove) {
      why.push('Best move is **' + c.bestMove.name + '** (' + (c.bestMove.damage || 0) + ' base' +
               (c.bestMove.scaling ? ', scales ' + c.bestMove.scaling : '') + '), landing at about **' +
               n0(c.bestHit) + '** expected damage once crit is applied.');
    }

    if (c.critChance >= 100) {
      why.push('Crit chance of ' + n1(c.critChance) + '% is past the ' + (c.critTier * 100) +
               '% threshold, so every hit is a guaranteed tier-' + c.critTier + ' crit at ' +
               c.critDmg.toFixed(2) + 'x rather than an average. That is why Luck is worth so much here — ' +
               'it converts to Crit Chance 1:1.');
    } else if (c.critChance > 0) {
      why.push('Crit chance sits at ' + n1(c.critChance) + '%, below the 100% threshold, so damage is ' +
               'an expected value rather than guaranteed.');
    }

    if (b.permuth) {
      why.push('Permuth (Venia) multiplies the finished ' + b.permuth.toUpperCase() +
               ' total by 1.4 — applied after gear and mastery, before Speed buffs.');
    }

    L.push({ h: 'Why this build', list: why });

    // ── corruption ──────────────────────────────────────────────────────────
    if (result.corruption) {
      const cor = result.corruption;
      const lines = [ '**' + cor.best.form + '** — ' + cor.best.why ];
      for (const alt of cor.all.slice(1)) lines.push('*' + alt.form + '* — ' + alt.why);
      L.push({ h: 'Corruption form', list: lines });
    }

    // ── energy ──────────────────────────────────────────────────────────────
    // Worth calling out on its own, because "+1 max energy" reads as trivial and
    // is not: any move that spends the whole pool scales with the cap.
    if (c.bestMove && (K.ENERGY.scalingMoves || {})[c.bestMove.name] && c.traits && c.traits.energyCap) {
      const es = K.ENERGY.scalingMoves[c.bestMove.name];
      L.push({ h: 'Energy', list: [
        c.bestMove.name + ' ' + es.note + '. With a cap of **' + c.energyCap + '** that is **+' +
        Math.round(es.perEnergy * Math.max(0, c.energyCap - es.freeEnergy) * 100) + '% damage**, and ' +
        'the Overflow trait is responsible for **+' +
        Math.round(es.perEnergy * c.traits.energyCap * 100) + '%** of it. Base energy is assumed to be ' +
        K.ENERGY.base + '; correct it in knowledge.js if the game differs.',
      ]});
    }

    // ── passives ────────────────────────────────────────────────────────────
    if (c.passiveList) {
      if (c.passiveList.known.length) {
        L.push({ h: 'Passives counted', table: c.passiveList.known.map(p =>
          [p.name, (p.note || '') + (p.uptime ? '  (counted at ' + Math.round(p.uptime * 100) + '% uptime)' : '')]) });
      }
      if (c.passiveList.unknown.length) {
        // Deliberately visible. These are real passives on this build that the
        // numbers above ignore, and the list is the to-do for knowledge.js.
        L.push({ h: 'Passives NOT counted', body:
          'These are on this build but not scored, so the figures above are a floor:',
          list: c.passiveList.unknown.slice(0, 12).map(p =>
            '**' + p.name + '** *(' + p.owner + ')*' + (p.effect ? ' — ' + p.effect : '')) });
      }
    }

    // ── caveats ─────────────────────────────────────────────────────────────
    if (c.traits && c.traits.active.length) {
      L.push({ h: 'Note', body:
        'The site does not compute trait effects — it stores and displays traits but no stat on ' +
        'arcanelineagebuilder.com includes them. The crit chance, HP and damage above DO include ' +
        'them, so the linked build will show lower numbers than these. The build itself is identical.' });
    }
    if (result.warnings && result.warnings.length) {
      L.push({ h: 'Watch out', list: result.warnings.map(w => '**' + w.name + '** — ' + w.text) });
    }
    if (result.error) {
      L.push({ h: 'Note', body: 'The full search failed (' + result.error + '), so this is a fallback ' +
                                'allocation rather than an optimised build.' });
    }

    return L;
  }

  function tierNote(slot, data, M) {
    if (!slot || !slot.alloc) return '';
    const parts = Object.entries(slot.alloc).filter(([, v]) => v).map(([k, v]) => '+' + v + ' ' + k.toUpperCase());
    if (!parts.length) return '';
    return '  (T' + slot.tier + ': ' + parts.join(', ') + ')';
  }

  // Plain-text rendering for the CLI.
  function toText(sections) {
    const out = [];
    for (const s of sections) {
      out.push('');
      out.push('── ' + s.h + ' ' + '─'.repeat(Math.max(0, 58 - s.h.length)));
      if (s.body) out.push(unbold(s.body));
      if (s.table) for (const [k, v] of s.table) out.push('  ' + String(k).padEnd(22) + unbold(String(v)));
      if (s.list)  for (const item of s.list) out.push(wrap('  • ' + unbold(item), 78));
    }
    return out.join('\n');
  }

  const unbold = s => String(s).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');

  function wrap(s, width) {
    const words = s.split(' ');
    const lines = []; let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > width) { lines.push(cur); cur = '    ' + w; }
      else cur = (cur ? cur + ' ' : '') + w;
    }
    if (cur) lines.push(cur);
    return lines.join('\n');
  }

  return { render, toText };
}));
