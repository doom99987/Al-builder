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

    // Which damage number this build was optimised against. It changes the build
    // materially — average pays for Luck and crit chance, potential does not —
    // so it belongs near the top rather than buried in the assumptions.
    if (spec.dmg && (K.DAMAGE_MODELS || {})[spec.dmg]) {
      const m = K.DAMAGE_MODELS[spec.dmg];
      const other = spec.dmg === 'average' ? 'potential' : 'average';
      const om = K.DAMAGE_MODELS[other];
      L.push({ h: 'Damage model', body:
        'Built for **' + m.label.toLowerCase() + '** — ' + m.note + '. ' +
        (spec.dmg === 'average'
          ? 'Crit chance is therefore worth exactly what it returns, which is why Luck competes ' +
            'with raw damage here at all.'
          : 'Crit chance past the first point buys nothing on this measure, so Luck stops ' +
            'competing and the points go to raw scaling and crit damage instead.') +
        ' Asking for **' + om.label.toLowerCase() + '** gives a different build, not just a ' +
        'different number.' });
    }

    // Aimed at one fight. Says what was actually priced, what was only reported,
    // and that "fastest" here means faster than the alternatives rather than a
    // number of turns — no boss in the data carries an HP figure.
    if (spec.boss && c.bossFit && c.bossFit.boss) {
      const b = c.bossFit.boss;
      const lines = [];
      if (b.statusImmune.length)
        lines.push('**Immune to** ' + b.statusImmune.join(', ') + '. Anything in your kit that ' +
                   'applies those does nothing here.');
      if (b.otherImmune && b.otherImmune.length)
        lines.push('**Also immune to** ' + b.otherImmune.join(', ') + '.');
      if (b.blocks || b.dodges)
        lines.push('It can ' + [b.blocks && 'block', b.dodges && 'dodge'].filter(Boolean).join(' and ') +
                   ', so some hits land for nothing regardless of the build.');
      if (b.why)       lines.push('**' + b.name + ':** ' + b.why);
      if (b.alsoWatch) lines.push('*Also worth knowing:* ' + b.alsoWatch);
      for (const r of c.bossFit.reasons)
        lines.push('**Counted as −' + r.pct + '%:** ' + r.text +
                   (r.moves.length ? ' (' + r.moves.join(', ') + ')' : ''));
      if (b.fromPlayers && b.fromPlayers.length)
        lines.push('*The immunity to ' + b.fromPlayers.join(', ') + ' is player knowledge, not ' +
                   'something the encyclopedia states — worth adding there too.*');
      if (b.dodgeIrrelevant)
        lines.push('Dodging does not decide this fight, so the usual solo Speed floor of **' +
                   (K.BOSS_SOLO_MIN_SPEED || 40) + '** is not applied here.');
      else if (spec.play === 'team')
        lines.push('Solo you would want about **' + (K.BOSS_SOLO_MIN_SPEED || 40) + ' Speed** to ' +
                   'dodge this fight. In a full party the incoming moves spread across five ' +
                   'people, so that floor is not applied to this build.');
      if (!b.modelled)
        lines.push('*No tactics are written for this boss yet.* Its passives and moves are read ' +
                   'from the encyclopedia, but nothing beyond the immunities above is priced — ' +
                   'so this is the general best build, filtered by what it is immune to.');
      lines.push('*"Fastest" here means faster than the other builds considered, not a number of ' +
                 'turns: no boss in the game data carries an HP figure, so kill time cannot be ' +
                 'computed. The penalties above are placeholders in `BOSS_PENALTIES`, sized ' +
                 'deliberately small because nobody has timed the fight both ways.*');
      L.push({ h: 'Built for ' + b.name, list: lines });
    }

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
    if (b.covenant) kit.push(['Covenant', b.covenant + '  (rank ' + (b.covenantRank || 1) + ')']);
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
      // The numbers here are the ones the build actually uses. When a class or a
      // bought mastery node rewrote the move, say so on the spot — otherwise the
      // printed scaling is the raw data, which reads as the mastery doing
      // nothing even while the damage beside it already reflects the change.
      if (c.bestMove.shapeNote) {
        why.push('**' + c.bestMove.name + '** is rewritten on this build: ' + c.bestMove.shapeNote +
                 ' (the game data alone says ' + (c.bestMove.shapedBy.rawBase || '?') +
                 (c.bestMove.shapedBy.rawHits > 1 ? 'x' + c.bestMove.shapedBy.rawHits : '') +
                 ' scaling ' + (c.bestMove.shapedBy.rawScaling || 'nothing') +
                 '). Every number below uses the rewritten version.');
      }
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
        const entryTurns = K.CORRUPTION_ENTRY_TURNS || 0;
        lines.push('*This is longer than the rotation above and it is meant to be. Weigh the extra turns, ' +
                   'the 100 Corrupt Energy, and the Recoil backlash when the form ends against the gain.*');
        if (entryTurns) {
          lines.push('*Banking that 100 Corrupt Energy takes about **' + entryTurns + ' turns**, so the ' +
                     'finisher above lands somewhere near turn **' + turn + '**. In a fight that ends ' +
                     'before then, none of this happens and the rotation above is the only one you get.*');
        }
        L.push({ h: 'Opening rotation — in ' + cor.form, list: lines });
      }
    }

    // ── covenant ────────────────────────────────────────────────────────────
    // A covenant hands out no stats at all, so for as long as the engine scored
    // builds on their stat blocks it had no reason to pick one and left the slot
    // empty on every build it ever produced. What a covenant gives is a rank 20
    // blessing, a passive or two, and sometimes a move.
    if (result.covenant && result.covenant.best) {
      const cv = result.covenant;
      const lines = ['**' + cv.best.name + '** (rank ' + cv.rank + ') — ' + cv.best.why];
      for (const alt of cv.all) {
        if (alt.name === cv.best.name) continue;
        lines.push('*' + alt.name + '* — ' + alt.why);
      }
      L.push({ h: 'Covenant', list: lines });

      const learns = ((data.covenantMoves || {})[cv.best.name] || {}).learns || [];
      if (learns.length) {
        L.push({ h: 'What ' + cv.best.name + ' gives you', table: learns.map(mv => {
          const kind = mv.type === 'Active'
            ? 'Active' + (mv.cost != null ? ', ' + mv.cost + ' energy' : '') +
              (mv.cooldown != null ? ', ' + mv.cooldown + ' turn cd' : '') +
              (mv.damage != null ? ', ' + mv.damage + ' dmg' : '') +
              (mv.scaling && mv.scaling !== 'N/A' ? ' ' + mv.scaling : '')
            : 'Passive';
          return ['Rank ' + mv.level + '  ' + mv.name,
                  kind + (mv.effect ? '  — ' + String(mv.effect).replace(/\s+/g, ' ') : '')];
        }) });
      }

      const how = cv.decidedBy === 'locked'
        ? 'You locked this one, so nothing was searched. The others are listed above with what ' +
          'they would have given you instead.'
        : cv.decidedBy === 'measured'
        ? 'This one changed the numbers: it is not a preference, it scored higher with the same ' +
          'gear and the same stats.'
        : (cv.tied === cv.all.length ? 'All ' + cv.all.length : 'The top ' + (cv.tied || 2)) +
          ' scored the SAME. A covenant grants no stats, and nothing that separated them ' +
          'CHANGED a number on this build — the covenant attacks ARE measured, they are just not ' +
          'this kit\'s best move. So this one was chosen on what it does rather than on a ' +
          'measurement: treat it as a recommendation, not a result.';
      const notes = [how,
        'Rank ' + cv.rank + ' is assumed, the same way max gear tier is assumed. Below rank 20 ' +
        'you have fewer of these: each ability lists the rank it unlocks at.'];
      if (cv.best.unpriced && cv.best.unpriced.length) {
        L.push({ h: 'What the covenant gives that is not in the numbers',
                 body: notes.join('  '),
                 list: cv.best.unpriced.map(u => '**' + u[0] + '** — ' + u[1]) });
      } else {
        L.push({ h: 'About that covenant', body: notes.join('  ') });
      }
    }

    // ── fighting hurt ───────────────────────────────────────────────────────
    // When a build is committed to low HP, that decision reprices items in both
    // directions and it would be unreadable if the write-up did not say so.
    if (c.hpStance && c.hpStance.committed) {
      const st = c.hpStance;
      const lines = st.sources.map(sr => '**' + sr.owner + ' — ' + sr.passive + ':** ' + sr.why + '.');
      const gates = (c.gearPassives ? c.gearPassives.active : []).filter(a => a.hpGate);
      for (const g of gates) lines.push('**' + g.name + ':** ' + g.hpGate.why);
      lines.push('The uptimes this changes are assumptions, not measurements: an item its owner ' +
                 'is built around is counted at 80%, one working against the build at 5%.');
      L.push({ h: 'This build fights hurt', body:
        'It is built to sit BELOW half health, which is where its own passives pay out. That ' +
        'reprices anything gated on an HP threshold — in both directions.', list: lines });
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
        // The number that decides whether any of the above is worth reading.
        // Without it the in-form column looks like a straight upgrade, when it
        // is really a state you spend a third of a long fight reaching.
        if (K.CORRUPTION_ENTRY_TURNS) {
          notes.push('**These are late-fight numbers.** Banking 100 Corrupt Energy takes about **' +
                     K.CORRUPTION_ENTRY_TURNS + ' turns**, so the in-form column does not apply until ' +
                     'roughly turn ' + K.CORRUPTION_ENTRY_TURNS + '. Against anything that dies before ' +
                     'then, the out-of-form figures are the only ones that ever happen — which is why ' +
                     'the build was optimised for those and not for these.');
        }
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

    // ── gear and weapon passives ────────────────────────────────────────────
    // These have always been in the numbers and never in the write-up: the
    // explanation listed class and race passives only. The weapon's passive in
    // particular is often the single largest modifier on the build — Primordial
    // is a flat +20% — and it was being applied silently.
    if (c.gearPassives && (c.gearPassives.active.length || c.gearPassives.unmodelled.length)) {
      const gp = c.gearPassives;
      if (gp.active.length) {
        L.push({ h: 'Gear and weapon passives counted', table: gp.active.map(a =>
          [a.name, '+' + a.value + (a.kind === 'critChance' ? ' crit chance'
                                  : a.kind === 'dr' ? '% DR'
                                  : a.kind === 'hpPct' ? '% HP' : '% damage') +
                   (a.effective !== a.value
                     ? '  — counted as ' + n1(a.effective) + ', it is conditional' : '  — always on') +
                   (a.note ? '.  ' + a.note : '') +
                   (a.hpGate ? '  ' + a.hpGate.why : '')]) });
      }
      if (gp.unmodelled.length) {
        L.push({ h: 'Gear passives NOT counted', body:
          'Equipped on this build, and worth something the numbers above ignore:',
          list: gp.unmodelled.slice(0, 10).map(u =>
            '**' + u.name + '**' + (u.note ? ' — ' + u.note : '')) });
      }
    }

    // ── mastery abilities ───────────────────────────────────────────────────
    // The stat points a mastery tree grants were always counted. The CAPSTONE
    // abilities — 5 points each, and the reason to take one branch over another
    // — were not, so this says which ones are in the numbers and at what uptime.
    if (c.masteryAbilities && (c.masteryAbilities.active.length || c.masteryAbilities.unmodelled.length)) {
      const ma = c.masteryAbilities;
      if (ma.active.length) {
        // Every kind needs its own unit. Labelling a flat +23 Speed as "+23%
        // damage" is the same mistake the gear passives had, and it is the kind
        // of wrong that reads as perfectly plausible.
        const unit = a => a.kind === 'critChance' ? ' crit chance'
                        : a.kind === 'dr'        ? '% DR'
                        : a.kind === 'dodge'     ? '% autododge'
                        : a.kind === 'statFlat'  ? ' flat ' + String(a.stat || 'spd').toUpperCase()
                        :                          '% damage';
        L.push({ h: 'Mastery abilities counted', table: ma.active.map(a =>
          [a.name, '+' + a.value + unit(a) +
                   (a.uptime < 1 ? '  — counted at ' + Math.round(a.uptime * 100) + '% uptime' : '  — always on') +
                   (a.party ? ', and ×' + a.party + ' because it lands on the party, not just you' : '') +
                   (a.note ? '.  ' + a.note : '')]) });
        if (ma.active.some(a => a.party)) {
          L.push({ h: 'Counted for a full party', body:
            'This is a ' + (K.ARCHETYPES[spec.goal] || {}).label + ' build, so it is valued as one of **' +
            (K.PARTY_SIZE || 5) + '**. Abilities that protect or heal other people are worth several times ' +
            'what they look like on your own sheet, and a solo damage build gets none of that scaling. ' +
            'Only about ' + Math.round((K.PARTY_SPREAD ?? 0.5) * 100) + '% of the team is assumed to be in ' +
            'range of any one effect — you cannot guard everyone at once.' });
        }
      }
      if (ma.unmodelled.length) {
        L.push({ h: 'Mastery abilities NOT counted', body:
          'Capstones this build paid 5 points each for, whose effect the numbers above ignore:',
          list: ma.unmodelled.map(u => '**' + u.name + '**' + (u.note ? ' — ' + u.note : '')) });
      }
    }

    // ── what it did NOT take, and why ─────────────────────────────────────
    // "Why didn't it take the autododge one" had no answer anywhere in the
    // output. It does now, and the four possible answers are kept apart on
    // purpose, because they are not the same admission:
    //
    //   not priced   — this engine has no numbers for the ability. It was never
    //                  compared to anything. That is a gap here, not a verdict.
    //   nothing here — priced, measured, and worth zero to THIS goal. A real
    //                  trade, and one you might want to make differently.
    //   outscored    — it fit the budget and a different capstone measured more.
    //   per point    — genuinely worth something, and still not bought, because
    //                  35 points is a real budget and everything else paid better.
    //
    // Deliberately outside the "did it take any capstone" guard above: a build
    // that took NONE is exactly the build this question gets asked about.
    if (c.masteryPassedOver && c.masteryPassedOver.length) {
      const goalLabel = (K.ARCHETYPES[spec.goal] || {}).label || spec.goal;
      const noteFor = name => {
        const r = (K.MASTERY_ABILITIES || {})[name];
        if (!r || !r.note) return '';
        // The notes are written as sentence fragments, so they need a capital
        // when they follow a full stop rather than a dash.
        return '  ' + r.note.charAt(0).toUpperCase() + r.note.slice(1) + '.';
      };
      const lead = {
        value:      '**Worth less per point** — ',
        lost:       '**Outscored** — ',
        zero:       '**Nothing towards ' + goalLabel + '** — ',
        unmodelled: '**Not priced here** — ',
      };
      // Real trade-offs first; the ones this engine simply cannot read last,
      // since "no numbers for it" is the least useful thing to lead with.
      const rank = { value: 0, lost: 1, zero: 2, unmodelled: 3 };
      const rows = c.masteryPassedOver.slice()
        .sort((a, b) => (rank[a.reason] ?? 9) - (rank[b.reason] ?? 9) || b.value - a.value)
        // The unpriced ones say only that, because the paragraph underneath
        // explains it once. Repeating the full sentence on every row buried the
        // rows that carry a real reason.
        .map(x => [x.name, x.reason === 'unmodelled'
          ? '**Not priced here.**' + (noteFor(x.name) || '  No numbers for it in this engine.')
          : (lead[x.reason] || '') + x.detail + '.' + noteFor(x.name)]);

      const b = c.masteryBudget;
      const budgetLine = b
        ? 'It had **' + b.cap + '** mastery points and spent **' + b.spent + '** — ' +
          b.statNodes + ' on stat nodes and ' + (b.capstonesTaken * 5) + ' on ' +
          (b.capstonesTaken === 1 ? 'one capstone' : b.capstonesTaken + ' capstones') + '. '
        : '';
      L.push({ h: 'Masteries it did not take', body: budgetLine +
        'Every capstone this class has that did not make the build, and the reason it did not:',
        table: rows });

      const unpriced = c.masteryPassedOver.filter(x => x.reason === 'unmodelled');
      if (unpriced.length) {
        // Counted from the data every time rather than written into the copy,
        // so the number cannot quietly go stale as abilities get priced.
        let total = 0, priced = 0;
        for (const perClass of Object.values((data && data.masteryAbilities) || {})) {
          for (const e of Object.values(perClass)) {
            total++;
            const r = (K.MASTERY_ABILITIES || {})[e.name];
            if ((r && r.kind !== 'note' && r.value != null) || (!r && e.bonus != null)) priced++;
          }
        }
        L.push({ h: 'What "not priced here" means', body:
          '**' + unpriced.length + '** of the capstones above ' +
          (unpriced.length === 1 ? 'is' : 'are') + ' marked *not priced here*. That is a ' +
          'gap in this engine, **not** a judgement that they are weak — it has no numbers for what ' +
          'they do, so they could not compete for the points at all. Game-wide, only **' + priced +
          ' of ' + total + '** capstone abilities are modelled. If one of them is a pick you know is ' +
          'right, tell me what it actually does and it gets priced and competed for like the rest.' });
      }
    }

    // ── the artifact comparison is one-sided, and must say so ───────────────
    // Only Stellian Core states plain numbers ("+30% Dmg, 20% DR, 15% Crit
    // rate"). The other eleven artifacts do something the game describes without
    // figures - a time rewind, an overkill AoE, "X damage (scales on level)".
    //
    // Pricing the one that CAN be priced and nothing else means it wins on every
    // build, which is the same bias the weapon passives had before they were
    // counted. It may well be the right pick; the point is that this engine
    // cannot tell, and a silent 18-out-of-18 sweep would read as a verdict.
    if (c.gearPassives && b.artifact && (K.ARTIFACT_ABILITIES || {})[b.artifact.name]) {
      const priced = Object.keys(K.ARTIFACT_ABILITIES || {})
        .filter(n => (K.ARTIFACT_ABILITIES[n] || {}).effects).length;
      const total = Object.keys(data && data.artifactMoves || {}).length;
      if (total > priced) {
        L.push({ h: 'Why this artifact, honestly', body:
          '**' + b.artifact.name + '** is one of only **' + priced + '** artifacts out of **' +
          total + '** whose ability this engine can put a number on. The rest do things the game ' +
          'describes without figures — a time rewind, an overkill explosion, "X damage (scales ' +
          'on level)" — so they score as if their ability did nothing. This one is not being ' +
          'compared against them so much as compared against blanks. It is a strong artifact; ' +
          'treat "the best" as unproven.' });
      }
    }

    // ── procs ───────────────────────────────────────────────────────────────
    // Ten items state a percentage chance to do something and not one of them
    // was mentioned anywhere. A stated chance is exactly what an engine should
    // be turning into an expectation, and where it cannot, it should say which
    // half of the number is missing.
    if (c.procs && (c.procs.listed.length || c.procs.traps.length)) {
      const rows = [];
      for (const p of c.procs.listed) {
        const per = p.per === 'turn' ? ' per turn' : p.per === 'status' ? ' per status applied' : ' on hit';
        rows.push([p.name, Math.round(p.chance * 100) + '%' + per + '. ' + (p.note || '') +
                   (p.why ? '  *Not counted in the damage above: ' + p.why + '.*' : '')]);
      }
      if (rows.length) {
        const g = c.procs.statusGain;
        L.push({ h: 'Procs', table: rows, body: g.extraPerTurn > 0
          ? 'This kit applies a status on **' + c.procs.debuffLoad.applying + ' of ' +
            c.procs.debuffLoad.total + '** of its moves, so ' +
            g.from.map(f => f.name).join(' and ') + ' is expected to add about **' +
            Math.round(g.extraPerTurn * 100) + '%** more statuses on top of that.'
          : 'A chance with a stated number is worth counting. Where the payload is not stated ' +
            'too, the row says so rather than guessing at it.' });
      }
      for (const t of c.procs.traps) {
        L.push({ h: 'Watch out', body: '**' + t.name + '** — ' + (t.note || '') +
                 (t.why ? ' ' + t.why.charAt(0).toUpperCase() + t.why.slice(1) + '.' : '') });
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
