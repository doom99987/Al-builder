/*
  Intent parsing — free text to a structured request.

  THE CONTRACT: this never fails and never returns nothing. A request it does not
  understand at all still yields a complete spec, with every guess recorded in
  `assumptions` so the answer can admit what it made up. "make me a build",
  "something cool", and an empty string all resolve to a real build.

  It is deliberately not clever. Everything it recognises comes from
  knowledge.js VOCAB, so teaching it a new word is a one-line edit there rather
  than a change here.
*/
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ALB_Intent = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Cheap edit distance, capped — we only care whether a word is a near-miss for
  // a name, so anything past 3 edits is "no".
  // Damerau-Levenshtein: a transposition costs 1, not 2. That single change is
  // what makes "rouge" match "rogue" — probably the most common misspelling in
  // the game, and one plain Levenshtein scores as 2 and rejects.
  function editDistance(a, b, cap) {
    cap = cap || 3;
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    const d = [];
    for (let i = 0; i <= a.length; i++) d[i] = [i];
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      let best = Infinity;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);   // transposition
        }
        best = Math.min(best, d[i][j]);
      }
      if (best > cap) return cap + 1;
    }
    return d[a.length][b.length];
  }

  // How far a token of this length may stray and still count. Short words
  // collide easily — "hard" is one edit from "Bard" — so the budget scales.
  function editBudget(len) {
    if (len <= 3) return 0;
    if (len <= 6) return 1;
    return 2;
  }

  // Strip the "(N)", "(Ch)", "(24%)" suffixes so "necro" can match "Necromancer (Ch)".
  const bare = name => norm(String(name).replace(/\s*\([^)]*\)\s*$/, ''));

  // Find the best entry of `names` mentioned in `text`.
  //
  // Candidates are SCORED rather than first-past-the-post, so a long verbatim
  // match always beats a short fuzzy guess. `exclude` holds tokens the
  // vocabulary already claimed — without it "hard" (a damage word) fuzzy-matches
  // "Bard" and quietly builds the wrong class.
  function bestName(text, names, aliases, exclude) {
    const t = norm(text);
    if (!t) return null;
    const toks = t.split(' ');
    const skip = exclude || new Set();

    // Aliases first, and deliberately NOT subject to `skip`. The exclusion set
    // exists to stop loose fuzzy matching from stealing a vocabulary word; an
    // alias is a curated, unambiguous mapping. "necro" is both a summon keyword
    // and the name of a class, and it should set both — skipping it here lost the
    // class and left the request with a goal and nothing to apply it to.
    if (aliases) {
      for (const tok of toks) {
        const hit = aliases[tok];
        if (hit && names.indexOf(hit) !== -1) return hit;
      }
    }

    let best = null, bestScore = -1;
    const consider = (name, score) => { if (score > bestScore) { bestScore = score; best = name; } };

    // Adjacent token pairs too, so multi-word names ("Blade Dancer", "Martial
    // Artist") match as a unit instead of only through their halves.
    const grams = toks.slice();
    for (let i = 0; i + 1 < toks.length; i++) grams.push(toks[i] + ' ' + toks[i + 1]);

    for (const name of names) {
      const b = bare(name);
      if (!b) continue;

      if (t.indexOf(b) !== -1) { consider(name, 1000 + b.length); continue; }

      for (const g of grams) {
        if (skip.has(g) || g.length < 3) continue;

        // Prefix: "necroman" -> "necromancer".
        if (b.indexOf(g) === 0 && g.length >= 4) { consider(name, 500 + g.length); continue; }

        const budget = editBudget(g.length);
        if (!budget) continue;
        const d = editDistance(g, b, budget);
        if (d <= budget) consider(name, 100 + g.length * 2 - d * 10);
      }
    }
    return bestScore >= 0 ? best : null;
  }

  function parse(text, data, K) {
    const raw = String(text == null ? '' : text);
    const t = norm(raw);
    const spec = {
      text: raw, goal: null, goals: [], klass: null, race: null,
      weaponName: null, weaponType: null, level: null,
      statFocus: [], modifiers: [], assumptions: [], matched: [],
    };

    // ── vocabulary FIRST ────────────────────────────────────────────────────
    // Names are matched afterwards and skip whatever the vocabulary claimed.
    // Order matters: "hit really hard" contains "hard", which is both a damage
    // word and one edit from "Bard".
    // Match on WORD BOUNDARIES, not substrings. "really" contains "ally", so a
    // plain includes() read "hit really hard" as a party build. Multi-word
    // entries still match as a phrase.
    const hit = (group) => {
      const out = [];
      for (const [concept, words] of Object.entries(group)) {
        const found = words.some(w => {
          const needle = norm(w);
          if (!needle) return false;
          return new RegExp('(^| )' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($| )').test(t);
        });
        if (found) out.push(concept);
      }
      return out;
    };

    // Every word the vocabulary understood, so name matching cannot claim it too.
    const claimed = new Set();
    const claimFrom = (group) => {
      for (const words of Object.values(group))
        for (const w of words) {
          const n = norm(w);
          if (!n) continue;
          const re = new RegExp('(^| )' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($| )');
          if (re.test(t)) claimed.add(n);
        }
    };
    claimFrom(K.VOCAB.goal); claimFrom(K.VOCAB.stat); claimFrom(K.VOCAB.modifier);

    // "Just give me something" — the engine picks, rather than optimising for
    // anything in particular.
    spec.random = !!(K.VOCAB.random && hit(K.VOCAB.random).length);
    // "random min max", "surprise me but min maxed" — commit to a specialisation
    // rather than rolling something merely reasonable.
    spec.minmax = spec.random && hit(K.VOCAB.modifier).indexOf('minmax') !== -1;

    spec.goals = hit(K.VOCAB.goal);
    if (spec.goals.length) {
      // Most specific wins, not first-declared. See GOAL_PRIORITY.
      const pri = K.GOAL_PRIORITY || [];
      spec.goals.sort((a, b) => {
        const ia = pri.indexOf(a), ib = pri.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      spec.goal = spec.goals[0];
      spec.matched.push('goal: ' + spec.goals.join(', '));
    }

    // ── explicit names ──────────────────────────────────────────────────────
    // Only real combat classes. classMoves also holds the five subclasses
    // (Bard, Beastmaster, Alchemist, Blacksmith, Miner), which are secondary
    // professions and cannot be a main class.
    const tree = data.classes || {};
    const combat = [...Object.keys(tree), ...Object.values(tree).flat()]
      .filter(k => (data.classMoves || {})[k]);
    const AL = K.ALIASES || {};

    const klass = bestName(t, combat, AL, claimed);
    if (klass) { spec.klass = klass; spec.matched.push('class: ' + klass); }

    const race = bestName(t, Object.keys(data.races || {}), AL, claimed);
    if (race) { spec.race = race; spec.matched.push('race: ' + race); }

    const wep = bestName(t, Object.keys(data.weapons || {}), null, claimed);
    if (wep) {
      spec.weaponName = wep;
      spec.weaponType = (data.weapons[wep] || {}).type || null;
      spec.matched.push('weapon: ' + wep);
    }

    if (!spec.weaponType) {
      const wt = hit(K.VOCAB.weapon);
      if (wt.length) { spec.weaponType = wt[0]; spec.matched.push('weapon type: ' + wt[0]); }
    }

    spec.statFocus = hit(K.VOCAB.stat);
    if (spec.statFocus.length) spec.matched.push('stats: ' + spec.statFocus.join(', '));

    spec.modifiers = hit(K.VOCAB.modifier);
    if (spec.modifiers.length) spec.matched.push('modifiers: ' + spec.modifiers.join(', '));

    const lvl = /(?:level|lvl|lv)\s*(\d{1,2})/.exec(t) || /\b(\d{1,2})\s*(?:level|lvl)\b/.exec(t);
    if (lvl) { spec.level = Math.max(1, Math.min(data.Max_Lvl, +lvl[1])); spec.matched.push('level: ' + spec.level); }

    // ── the fall-through: fill every gap, and say so ────────────────────────
    if (!spec.level) {
      spec.level = data.Max_Lvl;
      spec.assumptions.push('Level ' + data.Max_Lvl + ' (max), since none was given.');
    }

    if (!spec.goal) {
      // A stat focus implies a goal even with no goal word: "full arcane" reads
      // as a damage build, "all endurance" as a tank.
      if (spec.statFocus.includes('end'))      { spec.goal = 'tank';   spec.assumptions.push('Read "endurance" as wanting survivability.'); }
      else if (spec.statFocus.includes('lck')) { spec.goal = 'crit';   spec.assumptions.push('Read "luck" as wanting crits — Luck is Crit Chance 1:1.'); }
      else if (spec.statFocus.length)          { spec.goal = 'damage'; spec.assumptions.push('Read a stat focus with no stated goal as a damage build.'); }
      else {
        spec.goal = K.DEFAULT_GOAL;
        spec.assumptions.push('No goal stated, so this is optimised as ' +
          K.ARCHETYPES[K.DEFAULT_GOAL].label.toLowerCase() + '. Say "max damage", "tanky", ' +
          '"healer", "summons" or "crit" to steer it.');
      }
    }

    // A weapon type with no class narrows the class list rather than deciding it;
    // the optimiser picks whichever class scores best inside that list.
    if (!spec.klass && spec.weaponType) {
      spec.assumptions.push('No class named, so classes using ' + spec.weaponType + ' were considered.');
    } else if (!spec.klass) {
      spec.assumptions.push('No class named, so every class was considered and the best-scoring one chosen.');
    }

    if (!spec.race) {
      spec.assumptions.push('No race named, so every race was tried and the strongest kept.');
    }

    spec.unrecognised = t.length > 0 && spec.matched.length === 0;
    return spec;
  }

  // Explicit choices from the Advanced panel. These are HARD constraints — they
  // overwrite whatever the text said, and the assumption they replace is dropped
  // so the answer does not claim to have guessed something you picked.
  //
  // Anything falsy is "auto", meaning the optimiser keeps deciding it.
  function applyOverrides(spec, o, data) {
    if (!o) return spec;
    spec.locked = {};

    const drop = re => { spec.assumptions = spec.assumptions.filter(a => !re.test(a)); };

    if (o.goal)   { spec.goal = o.goal;   spec.locked.goal = o.goal;   drop(/^No goal stated/); }
    if (o.klass)  { spec.klass = o.klass; spec.locked.klass = o.klass; drop(/^No class named/); }
    if (o.race)   { spec.race = o.race;   spec.locked.race = o.race;   drop(/^No race named/); }
    if (o.armour) { spec.armour = o.armour; spec.locked.armour = o.armour; }
    if (o.enchant){ spec.enchant = o.enchant; spec.locked.enchant = o.enchant; }

    if (o.weaponName) {
      spec.weaponName = o.weaponName;
      spec.weaponType = ((data.weapons || {})[o.weaponName] || {}).type || spec.weaponType;
      spec.locked.weapon = o.weaponName;
    } else if (o.weaponType) {
      spec.weaponType = o.weaponType;
      spec.weaponName = null;
      spec.locked.weaponType = o.weaponType;
      drop(/^No class named, so classes using/);
    }

    // Carried through rather than treated as a constraint: a seed does not
    // narrow the search, it makes a random roll reproducible.
    if (o.seed !== undefined && o.seed !== null) spec.seed = o.seed;
    if (o.random) spec.random = true;
    if (o.minmax) { spec.random = true; spec.minmax = true; }

    if (o.level) {
      const lvl = Math.max(1, Math.min(data.Max_Lvl || 50, o.level | 0));
      spec.level = lvl;
      spec.locked.level = lvl;
      drop(/^Level \d+ \(max\)/);
    }

    const names = Object.entries(spec.locked).map(([k, v]) => k + ': ' + v);
    if (names.length) spec.matched.push('you chose — ' + names.join(', '));
    return spec;
  }

  return { parse, applyOverrides, norm, bestName, editDistance };
}));
