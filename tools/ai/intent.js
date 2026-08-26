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
  function editDistance(a, b, cap) {
    cap = cap || 3;
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        best = Math.min(best, cur[j]);
      }
      if (best > cap) return cap + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // Strip the "(N)", "(Ch)", "(24%)" suffixes so "necro" can match "Necromancer (Ch)".
  const bare = name => norm(String(name).replace(/\s*\([^)]*\)\s*$/, ''));

  // Find the best entry of `names` mentioned in `text`. Substring wins outright;
  // otherwise the closest single-token near-miss, so typos still land.
  function bestName(text, names) {
    const t = norm(text);
    const toks = t.split(' ');
    let exact = null, fuzzy = null, fuzzyD = 99;
    for (const name of names) {
      const b = bare(name);
      if (!b) continue;
      if (t.includes(b)) { if (!exact || b.length > bare(exact).length) exact = name; continue; }
      // prefix match: "necro" -> "necromancer"
      for (const tok of toks) {
        if (tok.length < 3) continue;
        if (b.startsWith(tok) && tok.length >= Math.min(4, b.length)) {
          if (!exact || b.length > bare(exact).length) exact = name;
        }
        // Fuzzy matching needs a long token to be safe. At 4 characters "hard"
        // is one edit from "Bard", so "hit really hard" silently became a Bard
        // build. Five characters minimum, one edit maximum.
        const d = editDistance(tok, b, 2);
        if (d < fuzzyD && d <= 1 && tok.length >= 5) { fuzzy = name; fuzzyD = d; }
      }
    }
    return exact || fuzzy;
  }

  function parse(text, data, K) {
    const raw = String(text == null ? '' : text);
    const t = norm(raw);
    const spec = {
      text: raw, goal: null, goals: [], klass: null, race: null,
      weaponName: null, weaponType: null, level: null,
      statFocus: [], modifiers: [], assumptions: [], matched: [],
    };

    // ── explicit names ──────────────────────────────────────────────────────
    // Only real combat classes. classMoves also holds the five subclasses
    // (Bard, Beastmaster, Alchemist, Blacksmith, Miner), which are secondary
    // professions and cannot be a main class.
    const tree = data.classes || {};
    const combat = [...Object.keys(tree), ...Object.values(tree).flat()]
      .filter(k => (data.classMoves || {})[k]);
    const klass = bestName(t, combat);
    if (klass) { spec.klass = klass; spec.matched.push('class: ' + klass); }

    const race = bestName(t, Object.keys(data.races || {}));
    if (race) { spec.race = race; spec.matched.push('race: ' + race); }

    const wep = bestName(t, Object.keys(data.weapons || {}));
    if (wep) {
      spec.weaponName = wep;
      spec.weaponType = (data.weapons[wep] || {}).type || null;
      spec.matched.push('weapon: ' + wep);
    }

    // ── vocabulary ──────────────────────────────────────────────────────────
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

  return { parse, norm, bestName, editDistance };
}));
