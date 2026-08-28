/*
  Model verification harness.

  model.js is only useful if it agrees with js/builder.js exactly. This drives
  the real builder through randomised configurations and diffs every stat against
  the model. Any mismatch means the model is wrong — the site is the authority.

  HOW TO RUN
    1. serve the repo:      python -m http.server 8123
    2. open                 http://localhost:8123/index.html
    3. paste this whole file into the browser console.

  Re-run it after changing model.js, and after any game update that touches the
  stat pipeline. A run of 100 configs covers 500 stat comparisons; anything other
  than "mismatches: 0" needs fixing before the engine's numbers can be believed.

  Caught during development, as examples of what this is for:
    - weapons outside TIERED_WEAPON_SERIES take no tier points (was granting up
      to 5 free stat points to every weapon)
    - endFlat is flat HP, not flat END
*/
(async function verifyModel(TRIALS) {
  TRIALS = TRIALS || 100;
  const data = await (await fetch('/tools/ai/ai-data.json?r=' + Date.now())).json();
  const src  = await (await fetch('/tools/ai/model.js?r=' + Date.now())).text();
  const me = { exports: {} };
  new Function('module', 'exports', src)(me, me.exports);
  const M = me.exports.Model(data);

  // Register knowledge.js QUIRKS exactly as engine.js does. Without this the
  // model is missing every item and race hook — Stultus' Speed-to-crit
  // conversion among them — and reports mismatches that are really just
  // "the thing under test was never fully assembled".
  const ksrc = await (await fetch('/tools/ai/knowledge.js?r=' + Date.now())).text();
  const km = { exports: {} };
  new Function('module', 'exports', ksrc)(km, km.exports);
  const K = km.exports;
  for (const q of K.QUIRKS) if (typeof M.register[q.hook] === 'function') M.register[q.hook](q.apply);

  const STATS = ['str', 'arc', 'end', 'spd', 'lck'];
  const armours = Object.keys(data.armourItems);
  const gears   = Object.keys(data.gearItems);
  const racesK  = Object.keys(data.races);
  const weaponsK = Object.keys(data.weapons);
  const artsK   = Object.keys(data.artifactItems);
  const rnd = a => a[Math.floor(Math.random() * a.length)];

  function randInst(maxTier) {
    const tier = Math.floor(Math.random() * (maxTier + 1));
    const shapes = data.GEAR_TIER_SHAPES[tier];
    const si = Math.floor(Math.random() * shapes.length);
    const shape = shapes[si];
    const pool = STATS.slice().sort(() => Math.random() - 0.5);
    return { tier, shape: si, stats: [0,1,2,3].map(i => shape[i] !== undefined ? pool[i] : ''), traits: [null,null,null] };
  }

  const mism = []; let n = 0;

  // Move damage. This exists because of a bug it would have caught immediately
  // and did not, because nothing here had ever compared a damage number.
  //
  // model.js computed  base + floor(stat / div)  for each scaling term. The site
  // computes  base x (1 + SUM(stat / div))  — summed first, then multiplied, and
  // never floored (builder.js:4080). On Carnage, whose damage is "1x20", the
  // floor threw the Strength contribution away entirely: 236 STR read as +2
  // damage rather than x3.36, so the engine learned that Strength did nothing
  // for a Berserker and poured every point into crit instead.
  //
  // Every stat total agreed perfectly the whole time. Stats are not damage.
  let dmgChecked = 0;
  const dmgBad = [];

  for (let t = 0; t < TRIALS; t++) {
    const cfg = {
      level: 1 + Math.floor(Math.random() * 50),
      race: rnd(racesK), armour: rnd(armours),
      invested: Object.fromEntries(STATS.map(s => [s, Math.floor(Math.random() * 50)])),
      gear: [0,1,2,3].map(() => Math.random() < 0.8 ? rnd(gears) : ''),
      weapon: Math.random() < 0.85 ? rnd(weaponsK) : '',
      artifact: Math.random() < 0.7 ? rnd(artsK) : '',
      permuth: Math.random() < 0.55 ? rnd(STATS) : '',
      // Mastery is worth ~29 stat points, so it has to be part of the diff.
      // Pick a random base class, optionally a superclass, and a random subset of
      // the tree — including the 1.15-multiplier branches, whose bonuses are
      // fractional and flow straight into the stat totals.
      cls: rnd(Object.keys(data.classes)),
      // Covenants gate on RANK, and the only bonus in the table unlocks at rank
      // 5 — so the rank has to be randomised across that boundary or half the
      // branch never runs. A blank covenant is in the mix too, since that is
      // still the common case.
      covenant: Math.random() < 0.7 ? rnd(Object.keys(data.covenantItems || {})) : '',
      covRank: 1 + Math.floor(Math.random() * 20),
    };
    cfg.sup = Math.random() < 0.6 ? rnd(data.classes[cfg.cls] || ['']) || '' : '';
    cfg.mastery = (data.masteryNodes || [])
      .filter(() => Math.random() < 0.55)
      .map(n => n.id);
    document.getElementById('Lvl').value = cfg.level;
    const rp = document.getElementById('race-picker');
    rp.value = cfg.race; rp.dispatchEvent(new Event('change', { bubbles: true }));
    const armEl = document.getElementById('armour-main');
    armEl.value = cfg.armour; cfg.armour = armEl.value || '';
    STATS.forEach(s => document.querySelector('.stat-row[data-stat="' + s + '"] .stat-val').value = cfg.invested[s]);
    // Assign, then READ BACK. A select silently ignores a value its option list
    // does not carry, and the site now hides gear that is not in the game — so
    // the page was quietly equipping nothing while the model still counted a
    // +4 STR gear, and every stat drifted by exactly that gear's block.
    //
    // This is the same trap the super-picker note below describes. Reading the
    // value back makes the harness follow the page instead of assuming it
    // complied, whatever the page decides to offer in future.
    ['gear-1','gear-2','gear-3','gear-4'].forEach((id, i) => {
      const el = document.getElementById(id);
      el.value = cfg.gear[i] || '';
      cfg.gear[i] = el.value || '';
    });
    const wepEl = document.getElementById('weapon-main');
    wepEl.value = cfg.weapon; cfg.weapon = wepEl.value || '';
    const artEl = document.getElementById('artifact-picker');
    artEl.value = cfg.artifact; cfg.artifact = artEl.value || '';

    const gI = [0,1,2,3].map(() => randInst(data.MAX_GEAR_TIER));
    gI.forEach((x, i) => gearInstances[i] = x);
    const aI = randInst(data.MAX_GEAR_TIER); Object.assign(artifactInstance, aI);
    const wI = randInst(data.MAX_WEAPON_TIER); Object.assign(weaponInstances[0], wI);

    // Class drives which mastery tree is active (getActiveMasteryData reads the
    // super picker, then the class picker).
    const cp = document.getElementById('class-picker');
    cp.value = cfg.cls; cp.dispatchEvent(new Event('change', { bubbles: true }));
    const sp = document.getElementById('super-picker');
    if (sp) {
      sp.value = cfg.sup || '';
      sp.dispatchEvent(new Event('change', { bubbles: true }));
      // Read it BACK. The super options are repopulated by the class change, so
      // assigning a value the list does not carry yet silently leaves it empty —
      // the site then uses the base class's mastery tree while the model uses the
      // superclass's, and every stat drifts.
      cfg.sup = sp.value || '';
    }
    for (const k of Object.keys(masteryState)) delete masteryState[k];
    for (const id of cfg.mastery) masteryState[id] = true;

    // The enchant is not part of the randomised config, so whatever the page had
    // when the harness started stayed selected for every trial. An autosaved
    // Ivory enchant is enough to make the whole run look wrong.
    const enchEl = document.getElementById('enchant-picker');
    if (enchEl) enchEl.value = '';

    // The covenant pickers are disabled below level 10, and a disabled select
    // still takes a value — so read back what the page actually holds rather
    // than trusting what was assigned, exactly as the gear slots do above.
    const covEl = document.getElementById('covenant-picker');
    const covRankEl = document.getElementById('covenant-rank');
    if (covEl) {
      covEl.value = cfg.covenant;
      cfg.covenant = covEl.value || '';
      if (covRankEl) { covRankEl.value = cfg.covRank; cfg.covRank = Math.min(20, Math.max(1, +covRankEl.value || 1)); }
      covEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      cfg.covenant = '';
    }

    // markPicker is a const, so it is NOT on window — reach it by id.
    permuthStat = cfg.permuth;
    document.getElementById('mark-1').value = cfg.permuth ? 'Venia' : '';

    const A = i => gearInstanceAlloc(i);
    const build = Object.assign(M.emptyBuild(), {
      level: cfg.level, race: cfg.race, armour: cfg.armour, invested: cfg.invested,
      gear: cfg.gear.map((nm, i) => nm ? { name: nm, tier: gI[i].tier, alloc: A(gI[i]) } : null).filter(Boolean),
      artifact: cfg.artifact ? { name: cfg.artifact, tier: aI.tier, alloc: A(aI) } : null,
      weapon:   cfg.weapon   ? { name: cfg.weapon,   tier: wI.tier, alloc: A(wI) } : null,
      mark: cfg.permuth ? 'Venia' : '', permuth: cfg.permuth,
      covenant: cfg.covenant, covenantRank: cfg.covRank,
      klass: cfg.sup || cfg.cls,
      masteryNodes: cfg.mastery,
    });

    for (const s of STATS) {
      n++;
      const real = getTotalStat(s), mine = M.totalStat(build, s);
      if (real !== mine) mism.push({ stat: s, real, mine, cfg });
    }

    // DERIVED stats too. getTotalStat agreeing does not prove HP, crit chance or
    // the heal stats agree — those run through a second pipeline in
    // updatePecents() with its own percentage sources, and a bug there is
    // invisible to a stat-only check.
    updatePecents();
    const shown = key => {
      const el = document.querySelector('.percent-item[data-stat="' + key + '"] .percent-val');
      if (!el) return null;
      // Take the FIRST number only. Paranoxian Crux renders HP as
      // "14.7 (83.1 Shield)", and stripping non-digits glued that into 14.783.
      const m = String(el.textContent).match(/-?\d+(?:\.\d+)?/);
      return m ? parseFloat(m[0]) : null;
    };
    const d = M.derived(build);
    // Paranoxian Crux repaints HP as "15.0 (85.2 Shield)" — current health plus a
    // shield, not maximum health. There is no max-HP figure on the page to
    // compare against, so HP is skipped for that artifact rather than counted as
    // a mismatch.
    const cruxHP = cfg.artifact === 'Paranoxian Crux';
    const checks = [
      ['hp',          cruxHP ? null : shown('end'), d.hp],
      ['crit-chance', shown('crit-chance'), d.critChance],
      ['crit-dmg',    shown('crit-dmg'),    d.critDmg],
      ['block-dr',    shown('block-dr'),    d.blockDr],
      ['nrg-chance',  shown('nrg-chance'),  d.nrgChance],
      ['initiative',  shown('initiative'),  d.initiative],
      ['out-heal',    shown('out-heal'),    d.outHeal],
      ['inc-heal',    shown('inc-heal'),    d.incHeal],
    ];
    for (const [label, real, mine] of checks) {
      if (real === null || !isFinite(real)) continue;   // not displayed in this config
      n++;
      // Compare at the precision the site prints (1dp, 2dp for crit damage).
      const p = label === 'crit-dmg' ? 100 : 10;
      if (Math.round(real * p) !== Math.round(mine * p)) {
        mism.push({ stat: label, real, mine: Math.round(mine * p) / p, cfg });
      }
    }

    // ── and the damage those stats are supposed to produce ──────────────────
    // Only where the site is doing the same job as moveDamage: no damage-bonus
    // multipliers active, and a move whose damage and scaling it will both parse.
    try {
      // moveDamage is the RAW scaled hit: base x (1 + scaling), no multipliers.
      // The site multiplies by several things on top, and checking only
      // getActiveDmgMult missed the rest — Shard of Blight's x1.25 on Dark moves
      // showed up as Dark Smite being 25% "wrong" when both sides were right and
      // simply measuring different things.
      const mults = [
        typeof getActiveDmgMult === 'function' ? getActiveDmgMult() : 1,
        typeof getEnchantMult === 'function' ? getEnchantMult() : 1,
      ];
      const multClean = mults.every(v => Math.abs(v - 1) < 1e-9);
      if (multClean && typeof dmgCalcMoveList !== 'undefined') {
        for (let i = 0; i < dmgCalcMoveList.length; i++) {
          const mv = dmgCalcMoveList[i];
          if (!mv || mv.damage === undefined) continue;
          if (typeof parseScaling !== 'function' || !parseScaling(mv.scaling)) continue;
          // Per-move multipliers the site applies and moveDamage deliberately
          // does not: element gates and the Darkbeast bonus.
          const eff = typeof getEffectiveMoveType === 'function'
                    ? getEffectiveMoveType(mv.moveType) : mv.moveType;
          const perMove = [
            typeof getShardOfBlightMult === 'function' ? getShardOfBlightMult(eff) : 1,
            typeof getBlizzardMult === 'function' ? getBlizzardMult(eff) : 1,
            typeof getActiveDmgMult === 'function' ? getActiveDmgMult(eff) : 1,
          ];
          if (!perMove.every(v => Math.abs(v - 1) < 1e-9)) continue;
          if (mv.slot === 'Darkbeast') continue;
          const row = [...document.querySelectorAll('.dc-row[data-idx]')]
            .find(r => +r.dataset.idx === i);
          if (!row) continue;
          toggleDmgDetail(row, i, true);
          const txt = (row.nextElementSibling || {}).innerText || '';
          // Three shapes the site prints, most specific first:
          //   "Total: 8.6 + 21.8 = 30.4"                   two-part attacks
          //   "1(1 + STR(236)/100) = 3.4 x 20 hits = 67.2" multi-hit
          //   "5(1 + STR(2)/75) = 5.1"                     the ordinary case
          // Reading the first "= N" on a two-part move caught only the opening
          // stab and reported the model as wrong when it was right.
          const summed = txt.match(/Total:[^=]*=\s*([\d.]+)/);
          const total  = txt.match(/[×x]\s*(\d+)\s*hits\s*=\s*([\d.]+)/);
          const perHit = txt.match(/\)\s*=\s*([\d.]+)/);
          const real = summed ? parseFloat(summed[1])
                     : total  ? parseFloat(total[2])
                     : perHit ? parseFloat(perHit[1]) : null;
          if (real === null || !isFinite(real)) continue;
          const mine = M.moveDamage(build, mv);
          dmgChecked++;
          // The site prints to one decimal, so allow the rounding it does.
          if (Math.abs(real - mine) > 0.15) {
            dmgBad.push({ move: mv.name, damage: mv.damage, scaling: mv.scaling,
                          real, mine: Math.round(mine * 10) / 10, cfg });
          }
        }
      }
    } catch (e) {
      if (!dmgBad.some(x => x.move === '(harness error)')) {
        dmgBad.push({ move: '(harness error)', real: String(e && e.message || e), mine: '' });
      }
    }
  }

  console.log('move damage: ' + dmgChecked + ' compared, ' + dmgBad.length + ' wrong');
  if (dmgBad.length) console.table(dmgBad.slice(0, 10).map(x =>
    ({ move: x.move, damage: x.damage, scaling: x.scaling, site: x.real, model: x.mine })));

  // ── share links ───────────────────────────────────────────────────────────
  // The packed format is POSITIONAL, so it is either exactly right or wrong.
  // The only authority is the site's own decoder, which is right here.
  let shareChecked = 0;
  const shareBad = [];
  try {
    for (const f of ['ai-data.js','model.js','knowledge.js','intent.js','optimize.js',
                     'explain.js','share.js','engine.js']) {
      (0, eval)(await (await fetch('/tools/ai/' + f + '?r=' + Date.now())).text());
    }
    const eng = ALB_Engine.Engine(window.ALB_DATA);
    for (const q of ['max damage crit lancer', 'tanky build', 'healer',
                     'berserker carnage max damage', 'necro summon build vastayan']) {
      const res = eng.ask(q);
      const url = await eng.link(res.build, { name: q });
      const st  = _unpackState((await _loadById(url.split('id=')[1])).d, '');
      shareChecked++;
      const b = res.build;
      const cmp = [
        ['class',   st.sup || st.cls,               b.klass],
        ['race',    st.race,                        b.race],
        ['armour',  st.arm,                         b.armour],
        ['weapon',  st.wm || '',                    b.weapon ? b.weapon.name : ''],
        ['enchant', st.ench || '',                  b.enchant || ''],
        ['corr',    st.corr || '',                  b.corruption || ''],
        ['shards',  JSON.stringify((st.sh||[]).filter(Boolean)), JSON.stringify(b.shards)],
        ['mastery', JSON.stringify((st.msty||[]).slice().sort()),
                    JSON.stringify((b.masteryNodes||[]).slice().sort())],
        ['gear',    JSON.stringify((st.g||[]).filter(Boolean)),
                    JSON.stringify(b.gear.map(g => g.name))],
      ];
      for (const [label, got, want] of cmp)
        if (String(got) !== String(want)) shareBad.push(q + ' / ' + label + ': ' + got + ' != ' + want);
    }
  } catch (e) {
    shareBad.push('share check could not run: ' + (e && e.message || e));
  }

  console.log('share links: ' + shareChecked + ' checked, ' + shareBad.length + ' bad');
  if (shareBad.length) shareBad.slice(0, 8).forEach(m => console.log('  ' + m));

  console.log('comparisons: ' + n + '   mismatches: ' + mism.length);
  if (mism.length) console.table(mism.slice(0, 10).map(m => ({ stat: m.stat, real: m.real, model: m.mine })));
  else if (!shareBad.length) console.log('%cmodel agrees with builder.js, and share links round-trip', 'color:#3c3');
  return { comparisons: n, mismatches: mism.length, detail: mism,
           shareChecked, shareBad,
           dmgChecked, dmgBad };
})();
