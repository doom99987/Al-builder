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
    if (result.flavour) {
      L.push({ h: result.flavour.name, body: result.flavour.line });
    }
    L.push({ h: 'Request', body: spec.text ? '"' + spec.text + '"' : '(nothing specified)' });

    if (spec.minmax && result.weaknesses && result.weaknesses.length) {
      L.push({ h: 'What it gives up', body:
        'Min-maxed for **' + ((K.ARCHETYPES[spec.goal] || {}).label || spec.goal).toLowerCase() +
        '**, so it is deliberately bad at everything else: ' + result.weaknesses.join(', ') +
        '. That is the trade you asked for — untick Random min-max for something more rounded.' });
    }

    if (spec.rolled) {
      L.push({ h: 'Rolled for you', table: [
        ['Goal',  (K.ARCHETYPES[spec.rolled.goal] || {}).label || spec.rolled.goal],
        ['Class', spec.rolled.klass],
        ['Race',  spec.rolled.race],
      ]});
    }

    if (spec.locked && Object.keys(spec.locked).length) {
      // `klass` is the internal key (class is reserved); never show it raw.
      const LABEL = { klass: 'Class', weaponType: 'Weapon type', weapon: 'Weapon',
                      goal: 'Goal', race: 'Race', armour: 'Armour',
                      enchant: 'Enchant', level: 'Level' };
      L.push({ h: 'You chose', table: Object.entries(spec.locked)
        .map(([k, v]) => [LABEL[k] || (k.charAt(0).toUpperCase() + k.slice(1)), String(v)]) });
    }
    if (spec.assumptions.length) {
      L.push({ h: 'What I assumed', list: spec.assumptions });
    }

    // Something the request asked for that cannot be used in game. Reported
    // ahead of the build so the swap is never a surprise: the answer differs
    // from what was asked for, and this is why.
    if (spec.unavailable && spec.unavailable.length) {
      L.push({ h: "Couldn't use", list: spec.unavailable.map(u =>
        '**' + u.name + '** (' + u.what.toLowerCase() + ') is ' + u.why +
        ', so it was left out and the slot was filled with the best thing that works.') });
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
    if (b.enchant) {
      const en = (K.ENCHANTS || {})[b.enchant];
      kit.push(['Enchant', b.enchant + (en ? '  — ' + en.note : '')]);
    }
    if (b.shards && b.shards.length) kit.push(['Shards', b.shards.join(', ')]);
    if (b.masteryNodes && b.masteryNodes.length) {
      kit.push(['Mastery', b.masteryNodes.length + ' nodes  ·  ' + (b.masteryPoints || 0) + '/' +
                (data.MASTERY_TOTAL_POINTS || 35) + ' points  ·  ' + (b.masteryShards || 0) + ' echo shards']);
    }
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

    if (spec.tech) {
      why.push('**' + spec.tech.name + '** — ' + spec.tech.why +
               ' That is why this build runs **' + b.race + '**, which is otherwise an odd ' +
               'pick for this goal, and why **' + spec.tech.enables + '** is locked into a gear slot.');
    }

    const rr = (K.RACE_ROLES || {})[b.race];
    if (rr && rr.note) {
      why.push('**' + b.race + '** — ' + rr.note + '.');
    }

    if (b.permuth) {
      why.push('Permuth (Venia) multiplies the finished ' + b.permuth.toUpperCase() +
               ' total by 1.4 — applied after gear and mastery, before Speed buffs.');
    }

    // Mastery is a big, invisible chunk of the stat totals — worth naming so the
    // numbers above are traceable.
    if (b.masteryNodes && b.masteryNodes.length && M.masteryFlat) {
      const mf = M.masteryFlat(b);
      const parts = Object.entries(mf).filter(([, v]) => v)
        .map(([k, v]) => '+' + (Math.round(v * 100) / 100) + ' ' + k.toUpperCase());
      if (parts.length) {
        why.push('Mastery contributes **' + parts.join(', ') + '**. Every stat node costs 1 point ' +
                 'of 35 and there are only 29, so all of them are affordable — breakthroughs cost ' +
                 'echo shards rather than points. The leftover 6 points buy one capstone.');
      }
    }

    L.push({ h: 'Why this build', list: why });

    // ── rotation ────────────────────────────────────────────────────────────
    // Scoring a build by one move in isolation throws away the whole idea of a
    // setup turn, and badly undervalues any race whose contribution is a buff
    // rather than a stat. If there is an opener, spell it out.
    if (c.rotation && c.rotation.length) {
      const lines = [];
      let turn = 1;
      for (const rt of c.rotation) {
        lines.push('**Turn ' + turn + ' — ' + rt.move + '.** ' + (rt.note || '') +
                   (rt.uptime < 1 ? '  *(up about ' + Math.round(rt.uptime * 100) + '% of the time over a long fight)*' : ''));
        turn++;
      }
      const finisher = c.burstMove || c.bestMove;
      if (finisher) {
        lines.push('**Turn ' + turn + ' — ' + finisher.name + '** for about **' +
                   n0(c.bestBurst) + '**, against ' + n0(c.bestHit) + ' with no setup.');
      }
      if (c.sustainedHit && Math.abs(c.sustainedHit - c.bestHit) > 1) {
        lines.push('Over a longer fight the buffs are not always up, so sustained damage settles ' +
                   'around **' + n0(c.sustainedHit) + '** — which is the number this build was ' +
                   'optimised on unless you asked for burst.');
      }
      L.push({ h: 'Opening rotation — out of form', list: lines });
    }

    // ── the same build, in form ─────────────────────────────────────────────
    // A second rotation rather than a bigger number on the first one, because
    // that is what it actually is: entering the form costs 100 Corrupt Energy
    // and the payoff usually costs several turns of setup on top. Everything
    // above stays out of form on purpose — that is the normal case, and the one
    // the build was optimised for.
    if (result.corruption && result.corruption.best && result.corruption.best.damage) {
      const cor = result.corruption.best;
      const d = cor.damage;
      const steps = d.steps || [];
      if (steps.length) {
        const lines = [];
        let turn = 1;
        // The out-of-form setup still happens; the form's steps come on top.
        for (const rt of (c.rotation || [])) {
          lines.push('**Turn ' + (turn++) + ' — ' + rt.move + '.** ' + (rt.note || ''));
        }
        // A step marked isFinisher IS the payoff move, so it must not be listed
        // and then listed again as the finisher — Blasphemy was showing Carnage
        // on two consecutive turns. Its note is folded into the finisher line.
        let finisherNote = '';
        for (const st of steps) {
          if (st.isFinisher) { finisherNote = st.note || ''; continue; }
          // turns: 0 is a bonus action. Numbering it as a turn contradicted the
          // note sitting right next to it saying it costs none.
          const span = st.turns === 0 ? 0 : Math.max(1, st.turns | 0);
          const label = span === 0 ? 'Bonus action'
                      : span > 1   ? 'Turns ' + turn + '–' + (turn + span - 1)
                                   : 'Turn ' + turn;
          lines.push('**' + label + ' — ' + st.move + '.** ' + (st.note || ''));
          turn += span;
        }
        const finisher = c.burstMove || c.bestMove;
        if (finisher) {
          const gain = d.burstGain > 0 ? ', against ' + n0(c.bestBurst) + ' out of form'
                     : d.ifCrit ? ' — the same number, because this form pays in crit rather than damage'
                     : '';
          lines.push(('**Turn ' + turn + ' — ' + finisher.name + '** for about **' +
                      n0(d.burstHit) + '**' + gain + '. ' + finisherNote).trim());
        }
        if (d.ifCrit) {
          lines.push('Spending Light Force is a bonus action, so it costs no turn. ' + d.ifCrit.need +
                     ' crit rate takes this to **' + n0(d.ifCrit.hit) + '**.');
        }
        lines.push('*This is longer than the rotation above and it is meant to be. Weigh the extra turns, ' +
                   'the 100 Corrupt Energy, and the Recoil backlash when the form ends against the gain.*');
        L.push({ h: 'Opening rotation — in ' + cor.form, list: lines });
      }
    }

    // ── corruption ──────────────────────────────────────────────────────────
    if (result.corruption) {
      const cor = result.corruption;
      const lines = [ '**' + cor.best.form + '** — ' + cor.best.why ];
      for (const alt of cor.all.slice(1)) lines.push('*' + alt.form + '* — ' + alt.why);
      L.push({ h: 'Corruption form', list: lines });

      // What each form is worth as a number. All three, so they can be compared
      // and then checked in game — the assumed figures only ever get corrected
      // by somebody testing them.
      const withDmg = cor.all.filter(a => a.damage);
      if (withDmg.length) {
        const rows = withDmg.map(a => {
          const d = a.damage;
          // An assumed figure is never shown bare. The row itself says so, since
          // the notes below only cover the chosen form.
          const flag = d.assumed && d.assumed.length ? ', assumed' : '';
          const change = d.burstGain > 0 ? '  (+' + d.burstGain + '%' + flag + ')'
                       : d.ifCrit ? '  (+' + Math.round((d.ifCrit.mult - 1) * 100) + '% if Force covers ' +
                                    d.ifCrit.need + ' crit)'
                       : '  (no modelled change)';
          return [a.form + (a.form === cor.best.form ? '  ←' : ''),
                  n0(d.burstHit) + ' prepared  ·  ' + n0(d.sustainedHit) + ' per turn' + change];
        });
        const notes = [];
        for (const l of (cor.best.damage && cor.best.damage.lines) || []) notes.push(l);
        for (const u of (cor.best.damage && cor.best.damage.unknown) || [])
          notes.push('*Not counted:* ' + u);
        // Assumptions from EVERY form, not just the chosen one: a number in the
        // table above that the game never stated has to carry its caveat.
        for (const a of withDmg) for (const line of (a.damage.assumed || []))
          notes.push('⚠︎ *' + a.form + ':* ' + line);
        notes.push('Out of form these numbers are **' + n0(c.bestBurst || c.bestHit) + '** prepared and **' +
                   n0(c.sustainedHit) + '** per turn. Nothing here changed which gear was chosen — the ' +
                   'build is settled first and the form picked afterwards.');
        L.push({ h: 'Damage in form', table: rows, list: notes });
      }
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

    // ── shards ──────────────────────────────────────────────────────────────
    if (c.shards && (c.shards.active.length || c.shards.unmodelled.length)) {
      const rows = c.shards.active.map(a =>
        [a.name, '+' + a.value + '%' + (a.note ? '  — ' + a.note : '') +
                 (Math.abs(a.effective - a.value) > 0.01
                   ? '  (counted as ' + (Math.round(a.effective * 10) / 10) + ')' : '')]);
      for (const u of c.shards.unmodelled) rows.push([u.name + '  (not scored)', u.note || '']);
      rows.push(['Total damage', '+' + (Math.round(c.shards.dmgPct * 10) / 10) + '%']);
      L.push({ h: 'Shards', table: rows });
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

    // ── mastery abilities ───────────────────────────────────────────────────
    // The stat points a mastery tree grants were always counted. The CAPSTONE
    // abilities — 5 points each, and the reason to take one branch over another
    // — were not, so this says which ones are in the numbers and at what uptime.
    if (c.masteryAbilities && (c.masteryAbilities.active.length || c.masteryAbilities.unmodelled.length)) {
      const ma = c.masteryAbilities;
      if (ma.active.length) {
        const unit = a => a.kind === 'critChance' ? ' crit chance' : a.kind === 'dr' ? '% DR' : '% damage';
        L.push({ h: 'Mastery abilities counted', table: ma.active.map(a =>
          [a.name, '+' + a.value + unit(a) +
                   (a.uptime < 1 ? '  — counted at ' + Math.round(a.uptime * 100) + '% uptime' : '  — always on') +
                   (a.note ? '.  ' + a.note : '')]) });
      }
      if (ma.unmodelled.length) {
        L.push({ h: 'Mastery abilities NOT counted', body:
          'Capstones this build paid 5 points each for, whose effect the numbers above ignore:',
          list: ma.unmodelled.map(u => '**' + u.name + '**' + (u.note ? ' — ' + u.note : '')) });
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
