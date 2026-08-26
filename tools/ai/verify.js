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
  for (let t = 0; t < TRIALS; t++) {
    const cfg = {
      level: 1 + Math.floor(Math.random() * 50),
      race: rnd(racesK), armour: rnd(armours),
      invested: Object.fromEntries(STATS.map(s => [s, Math.floor(Math.random() * 50)])),
      gear: [0,1,2,3].map(() => Math.random() < 0.8 ? rnd(gears) : ''),
      weapon: Math.random() < 0.85 ? rnd(weaponsK) : '',
      artifact: Math.random() < 0.7 ? rnd(artsK) : '',
      permuth: Math.random() < 0.55 ? rnd(STATS) : '',
    };
    document.getElementById('Lvl').value = cfg.level;
    const rp = document.getElementById('race-picker');
    rp.value = cfg.race; rp.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('armour-main').value = cfg.armour;
    STATS.forEach(s => document.querySelector('.stat-row[data-stat="' + s + '"] .stat-val').value = cfg.invested[s]);
    ['gear-1','gear-2','gear-3','gear-4'].forEach((id, i) => document.getElementById(id).value = cfg.gear[i] || '');
    document.getElementById('weapon-main').value = cfg.weapon;
    document.getElementById('artifact-picker').value = cfg.artifact;

    const gI = [0,1,2,3].map(() => randInst(data.MAX_GEAR_TIER));
    gI.forEach((x, i) => gearInstances[i] = x);
    const aI = randInst(data.MAX_GEAR_TIER); Object.assign(artifactInstance, aI);
    const wI = randInst(data.MAX_WEAPON_TIER); Object.assign(weaponInstances[0], wI);

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
    });

    for (const s of STATS) {
      n++;
      const real = getTotalStat(s), mine = M.totalStat(build, s);
      if (real !== mine) mism.push({ stat: s, real, mine, cfg });
    }
  }

  console.log('comparisons: ' + n + '   mismatches: ' + mism.length);
  if (mism.length) console.table(mism.slice(0, 10).map(m => ({ stat: m.stat, real: m.real, model: m.mine })));
  else console.log('%cmodel agrees with builder.js', 'color:#3c3');
  return { comparisons: n, mismatches: mism.length, detail: mism };
})();
