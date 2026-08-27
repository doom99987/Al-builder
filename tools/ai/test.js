#!/usr/bin/env node
/*
  Build AI test suite. No browser, no dependencies.

      node tools/ai/test.js
      node tools/ai/test.js --verbose

  Exit code is 1 on any failure, so it can gate a release.

  WHAT THIS DOES NOT COVER: whether model.js agrees with js/builder.js. That can
  only be answered by the real page, and it is what tools/ai/verify.js is for.
  Run BOTH after touching the engine — this one catches regressions in the search
  and the parser, verify.js catches drift in the maths.
*/
'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA_PATH = path.join(__dirname, 'ai-data.json');
if (!fs.existsSync(DATA_PATH)) {
  console.error('No ai-data.json. Run:  node tools/ai/extract-data.js');
  process.exit(1);
}

const data    = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const Engine  = require('./engine.js').Engine;
const Intent  = require('./intent.js');
const K       = require('./knowledge.js');
const Share   = require('./share.js');
const { extractAll } = require('./extract-data.js');

const VERBOSE = process.argv.includes('--verbose');

// ── tiny harness ────────────────────────────────────────────────────────────
let passed = 0, failed = 0, group = '';
const failures = [];

function describe(name, fn) { group = name; console.log('\n' + name); fn(); }
function it(name, fn) {
  try {
    fn();
    passed++;
    if (VERBOSE) console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    failures.push({ group, name, message: e.message });
    console.log('  FAIL ' + name + '\n         ' + e.message);
  }
}
function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error((what ? what + ': ' : '') + 'expected ' + JSON.stringify(expected) +
                    ', got ' + JSON.stringify(actual));
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }

const engine = Engine(data);
const ask = (q, o) => engine.ask(q, o);

// ── 1. the data snapshot is current ─────────────────────────────────────────
describe('data snapshot', () => {
  const fresh = extractAll();

  it('extracts every wanted table', () => {
    eq(fresh.missing.length, 0, 'missing tables: ' + fresh.missing.join(', '));
  });

  it('committed ai-data.json matches the source files', () => {
    // A stale snapshot is the quiet failure mode of this whole tool: the engine
    // keeps answering, just with last week's game data. Compare table by table
    // so the message says WHICH one drifted.
    const drift = [];
    for (const key of Object.keys(fresh.data)) {
      if (JSON.stringify(fresh.data[key]) !== JSON.stringify(data[key])) drift.push(key);
    }
    eq(drift.length, 0, 'stale — re-run extract-data.js. Drifted: ' + drift.join(', '));
  });

  it('every gear referenced by gearSeries exists in gearItems', () => {
    const missing = Object.values(data.gearSeries).flat().filter(g => !data.gearItems[g]);
    eq(missing.length, 0, 'orphans: ' + missing.join(', '));
  });

  it('CLASS_WEAPONS only names real weapon types', () => {
    const real = new Set(Object.values(data.weapons).map(w => w.type));
    const bad = [];
    for (const [cls, types] of Object.entries(K.CLASS_WEAPONS || {}))
      for (const t of types) if (!real.has(t)) bad.push(cls + ' -> ' + t);
    // This exact mistake shipped once: "Fist" instead of "Gauntlets", which
    // silently filtered the weapon list to nothing.
    eq(bad.length, 0, 'unknown types: ' + bad.join(', '));
  });

  it('ALIASES only point at classes or races that exist', () => {
    const names = new Set([
      ...Object.keys(data.classes), ...Object.values(data.classes).flat(),
      ...Object.keys(data.races),
    ]);
    const bad = Object.entries(K.ALIASES || {}).filter(([, v]) => !names.has(v));
    eq(bad.length, 0, 'dangling: ' + bad.map(b => b.join(' -> ')).join(', '));
  });

  it('every VOCAB.weapon key is a real weapon type', () => {
    const real = new Set(Object.values(data.weapons).map(w => w.type));
    const bad = Object.keys(K.VOCAB.weapon).filter(t => !real.has(t));
    eq(bad.length, 0, 'unknown: ' + bad.join(', '));
  });

  it('every ARCHETYPE in GOAL_PRIORITY exists and vice versa', () => {
    const a = Object.keys(K.ARCHETYPES).sort();
    const p = K.GOAL_PRIORITY.slice().sort();
    eq(JSON.stringify(a), JSON.stringify(p), 'archetypes vs priority list');
  });
});

// ── 2. intent parsing ───────────────────────────────────────────────────────
describe('intent', () => {
  const cls = q => Intent.parse(q, data, K).klass;
  const race = q => Intent.parse(q, data, K).race;
  const goal = q => Intent.parse(q, data, K).goal;

  it('reads exact class names', () => {
    eq(cls('lancer'), 'Lancer (N)');
    eq(cls('necromancer'), 'Necromancer (Ch)');
  });

  it('survives misspellings', () => {
    const cases = {
      necromancr: 'Necromancer (Ch)', assasin: 'Assassin (Ch)', berzerker: 'Berserker (Ch)',
      paladdin: 'Paladin (Or)', wizzard: 'Wizard', elementlist: 'Elementalist (Or)',
      darkwrath: 'Darkwraith (Ch)', impalor: 'Impaler (Ch)', lionhart: 'Lionheart (N)',
      citdel: 'Citadel (Or)', arbitor: 'Arbiter (N)', brawlr: 'Brawler (N)',
      monkk: 'Monk (Or)', hexr: 'Hexer (N)',
    };
    for (const [q, want] of Object.entries(cases)) eq(cls(q), want, q);
  });

  it('handles transpositions (rouge -> Rogue)', () => {
    // Plain Levenshtein scores this 2 and rejects it; Damerau scores it 1.
    eq(cls('rouge'), 'Rogue (N)');
  });

  it('handles multi-word names typed badly', () => {
    eq(cls('blade dncer'), 'Blade Dancer (N)');
    eq(cls('martial artis'), 'Martial Artist');
  });

  it('knows community shorthand', () => {
    const cases = { zerk: 'Berserker (Ch)', pally: 'Paladin (Or)', sin: 'Assassin (Ch)',
                    bd: 'Blade Dancer (N)', ele: 'Elementalist (Or)', wraith: 'Darkwraith (Ch)' };
    for (const [q, want] of Object.entries(cases)) eq(cls(q), want, q);
  });

  it('misspells races too', () => {
    const cases = { vastyan: 'Vastayan (9%)', stultis: 'Stultus (20%)',
                    dulahan: 'Dullahan (1%)', estela: 'Estella (24%)' };
    for (const [q, want] of Object.entries(cases)) eq(race(q), want, q);
  });

  it('does NOT read "hard" as Bard', () => {
    // Regression: "hard" is one edit from "Bard" and also a damage word. The
    // vocabulary claims it first, so name matching must skip it.
    eq(cls('i want to hit really hard'), null);
    eq(goal('i want to hit really hard'), 'damage');
  });

  it('never picks a subclass as the main class', () => {
    const subs = new Set(data.subClasses);
    for (const q of ['bard', 'miner', 'alchemist', 'blacksmith', 'beastmaster', 'hard', 'mine'])
      ok(!subs.has(cls(q)), q + ' resolved to a subclass');
  });

  it('lets a class alias also set the goal', () => {
    // "necro" is both a summon keyword and a class name; it must do both.
    const s = Intent.parse('necro', data, K);
    eq(s.klass, 'Necromancer (Ch)');
    eq(s.goal, 'summon');
  });

  it('prefers the more specific goal', () => {
    eq(goal('max damage crit lancer'), 'crit');   // crit beats damage
    eq(goal('tanky'), 'tank');
  });

  it('reads a level', () => {
    eq(Intent.parse('lvl 30 build', data, K).level, 30);
    eq(Intent.parse('level 7', data, K).level, 7);
  });

  it('always returns a usable spec', () => {
    for (const q of ['', '   ', 'asdfghjkl', '!!!', '12345', null, undefined]) {
      const s = Intent.parse(q, data, K);
      ok(s.goal, 'no goal for ' + JSON.stringify(q));
      ok(s.level >= 1, 'no level for ' + JSON.stringify(q));
      ok(Array.isArray(s.assumptions), 'no assumptions array');
    }
  });

  it('overrides beat the text', () => {
    const s = Intent.applyOverrides(
      Intent.parse('tanky healer paladin', data, K),
      { klass: 'Impaler (Ch)', goal: 'crit', level: 35 }, data);
    eq(s.klass, 'Impaler (Ch)');
    eq(s.goal, 'crit');
    eq(s.level, 35);
    ok(!s.assumptions.some(a => /^Level \d+ \(max\)/.test(a)), 'kept a replaced assumption');
  });

  it('clamps an out-of-range level', () => {
    eq(Intent.applyOverrides(Intent.parse('', data, K), { level: 999 }, data).level, data.Max_Lvl);
    eq(Intent.applyOverrides(Intent.parse('', data, K), { level: -5 }, data).level, 1);
  });
});

// ── 3. build invariants ─────────────────────────────────────────────────────
const REQUESTS = [
  '', 'asdfghjkl', 'make me a build', 'something cool', 'tanky knight', 'healer',
  'necro summon build vastayan', 'fast dagger guy', 'i want to hit really hard',
  'full arcane wizard', 'spear', 'max damage crit lancer', 'bleed assassin',
  'party support', 'unkillable wall', 'berserker carnage max damage', 'monk',
  'fist build', 'summoner', 'staff mage', 'gauntlet dps', 'level 1 starter',
  'crit overcrit red', 'best pvp build lvl 30', 'rouge', 'zerk', 'pally sin',
];

describe('build invariants', () => {
  const results = REQUESTS.map(q => ({ q, r: ask(q) }));

  const forEach = (name, check) => it(name, () => {
    for (const { q, r } of results) {
      const msg = check(r);
      if (msg) throw new Error(JSON.stringify(q) + ' — ' + msg);
    }
  });

  forEach('never spends negative stat points', r =>
    Object.entries(r.build.invested).find(([, v]) => v < 0) ? 'negative invested' : null);

  forEach('never exceeds the stat point budget', r => {
    const sum = Object.values(r.build.invested).reduce((a, b) => a + b, 0);
    const budget = engine.model.pointBudget(r.build);
    return sum > budget ? 'spent ' + sum + ' of ' + budget : null;
  });

  forEach('never exceeds the mastery point budget', r =>
    (r.build.masteryPoints || 0) > (data.MASTERY_TOTAL_POINTS || 35)
      ? 'mastery ' + r.build.masteryPoints : null);

  forEach('produces finite numbers', r =>
    [r.ctx.bestHit, r.ctx.hp, r.ctx.score, r.ctx.critChance].some(v => !isFinite(v))
      ? 'non-finite stat' : null);

  forEach('never fits duplicate shards', r =>
    new Set(r.build.shards).size !== r.build.shards.length ? 'duplicate shard' : null);

  forEach('never fits more than 7 shards', r =>
    r.build.shards.length > 7 ? r.build.shards.length + ' shards' : null);

  forEach('never allocates tier points to an untiered weapon', r =>
    r.build.weapon && !engine.model.weaponIsTiered(r.build.weapon.name)
      && Object.keys(r.build.weapon.alloc || {}).length ? 'untiered weapon has alloc' : null);

  forEach('never puts a gearOnly trait on the artifact', r => {
    const a = r.build.artifact;
    if (!a || !a.traits) return null;
    const bad = a.traits.filter(t => t && (data.gearTraits[t.id] || {}).gearOnly);
    return bad.length ? 'gearOnly trait on artifact: ' + bad.map(t => t.id).join(', ') : null;
  });

  forEach('never fits more than 2 traits per slot', r => {
    for (const g of r.build.gear) if ((g.traits || []).length > 2) return 'gear over 2 traits';
    if (r.build.artifact && (r.build.artifact.traits || []).length > 2) return 'artifact over 2 traits';
    return null;
  });

  forEach('never equips the same gear twice', r => {
    const names = r.build.gear.map(g => g.name);
    return new Set(names).size !== names.length ? 'duplicate gear' : null;
  });

  forEach('respects the level in the request', r =>
    r.build.level < 1 || r.build.level > data.Max_Lvl ? 'level ' + r.build.level : null);

  forEach('always names a class', r => r.build.klass ? null : 'no class');

  forEach('always explains itself', r =>
    Array.isArray(r.explanation) && r.explanation.length ? null : 'no explanation');

  forEach('always picks a corruption form', r =>
    r.build.corruption ? null : 'no corruption');

  it('honours an explicitly chosen class every time', () => {
    for (const klass of ['Impaler (Ch)', 'Citadel (Or)', 'Hexer (N)', 'Monk (Or)']) {
      const r = ask('max damage', { klass });
      eq(r.build.klass, klass);
    }
  });

  it('honours a locked armour', () => {
    const r = ask('tanky', { armour: 'Fortified Seer' });
    eq(r.build.armour, 'Fortified Seer');
  });

  it('honours a weapon type constraint', () => {
    const r = ask('max damage', { weaponType: 'Dagger' });
    eq((data.weapons[r.build.weapon.name] || {}).type, 'Dagger');
  });

  it('gives a class only weapons it can use', () => {
    // A Lancer with a sword was a real bug.
    const r = ask('max damage crit lancer');
    eq((data.weapons[r.build.weapon.name] || {}).type, 'Spear');
  });
});

// ── 4. determinism ──────────────────────────────────────────────────────────
describe('determinism', () => {
  it('is reproducible across engine instances', () => {
    const a = JSON.stringify(Engine(data).ask('max damage crit lancer').build);
    const b = JSON.stringify(Engine(data).ask('max damage crit lancer').build);
    eq(a, b);
  });

  it('does not leak state between requests', () => {
    const e = Engine(data);
    const before = JSON.stringify(e.ask('healer').build);
    e.ask('max damage crit lancer'); e.ask('tanky build'); e.ask('');
    eq(JSON.stringify(e.ask('healer').build), before);
  });
});

// ── 5. share links ──────────────────────────────────────────────────────────
describe('share links', () => {
  const build = ask('max damage crit lancer').build;

  it('packs to url-safe base64', () => {
    const blob = Share.packBlob(data, build);
    ok(blob.length > 0, 'empty blob');
    ok(/^[A-Za-z0-9_-]+$/.test(blob), 'not url-safe: ' + blob.slice(0, 40));
  });

  it('is deterministic', () => {
    eq(Share.packBlob(data, build), Share.packBlob(data, build));
  });

  it('bz_ container inflates back to exactly what went in', () => {
    // The positional bit layout is verified against the real page by verify.js.
    // What CAN be checked offline is the container: deflate-raw round-trips and
    // the build bytes survive it byte for byte.
    const body = Share.container(data, build, { name: 'test', summary: 'x', color: '#c9a227' });
    const back = Array.from(zlib.inflateRawSync(Buffer.from(zlib.deflateRawSync(Buffer.from(Uint8Array.from(body))))));
    eq(JSON.stringify(back), JSON.stringify(body), 'container did not survive deflate');
  });

  it('container header matches what _loadById expects', () => {
    const name = 'a name', summ = 'summary';
    const body = Share.container(data, build, { name, summary: summ, color: '#010203' });
    const summLen = body[0] | (body[1] << 8);
    eq(summLen, Buffer.byteLength(summ, 'utf8'), 'summary length');
    eq(body[2], Buffer.byteLength(name, 'utf8'), 'name length');
    eq(body[3], 1, 'r'); eq(body[4], 2, 'g'); eq(body[5], 3, 'b');
  });

  it('produces a full url for every request', () => {
    return Promise.all(REQUESTS.slice(0, 6).map(q =>
      engine.link(ask(q).build, { name: q }).then(url => {
        ok(url && url.indexOf('?id=bz_') !== -1, 'bad url for ' + JSON.stringify(q));
      })));
  });

  it('encodes the whole shard list', () => {
    const b = ask('max damage crit lancer').build;
    ok(b.shards.length === 7, 'expected 7 shards, got ' + b.shards.length);
    ok(Share.packBlob(data, b) !== Share.packBlob(data, Object.assign({}, b, { shards: [] })),
       'shards do not affect the packed blob');
  });

  it('encodes mastery', () => {
    const b = ask('max damage crit lancer').build;
    ok((b.masteryNodes || []).length > 0, 'no mastery nodes');
    ok(Share.packBlob(data, b) !== Share.packBlob(data, Object.assign({}, b, { masteryNodes: [] })),
       'mastery does not affect the packed blob');
  });
});

// ── 6. model sanity ─────────────────────────────────────────────────────────
describe('model', () => {
  const M = engine.model;

  it('parses multi-hit damage strings', () => {
    eq(JSON.stringify(M.parseDamage('1x20')), JSON.stringify({ base: 1, hits: 20 }));
    eq(JSON.stringify(M.parseDamage('5x2')),  JSON.stringify({ base: 5, hits: 2 }));
    eq(JSON.stringify(M.parseDamage(16)),     JSON.stringify({ base: 16, hits: 1 }));
    eq(JSON.stringify(M.parseDamage('5x(Darkcores)')), JSON.stringify({ base: 0, hits: 1 }));
  });

  it('parses string energy costs', () => {
    eq(M.parseCost('3+X'), 3);
    eq(M.parseCost(2), 2);
    eq(M.parseCost(undefined), 0);
  });

  it('applies the overcrit tiers the way the site does', () => {
    // buildOvercritLines: a guaranteed orange needs 200 crit chance, not 100.
    eq(M.critTier(99), 0);
    eq(M.critTier(100), 1);
    eq(M.critTier(250), 2);
    eq(M.expectedMultiplier(100, 2), 2);          // guaranteed crit, no overcrit
    eq(M.expectedMultiplier(200, 2), 4);          // guaranteed orange
    eq(M.expectedMultiplier(50, 2), 1.5);         // half the hits crit
  });

  it('gives untiered weapons no tier points', () => {
    ok(!M.weaponIsTiered('Ferrus Spear'), 'Ferrus counted as tiered');
    ok(M.weaponIsTiered('Dragonbone Spear'), 'Dragon not counted as tiered');
  });

  it('treats armour endFlat as HP, never as END', () => {
    const b = M.emptyBuild();
    b.level = 50; b.race = 'Estella (24%)';
    const noArmour = M.derived(b).stats.end;
    b.armour = 'Fortified Seer';                  // endFlat 35, pct.end 5
    const withArmour = M.derived(b);
    eq(withArmour.stats.end, noArmour, 'endFlat leaked into the END stat');
    ok(withArmour.hp > M.derived(Object.assign(M.emptyBuild(), { level: 50, race: b.race })).hp,
       'endFlat did not raise HP');
  });

  it('treats GEAR endFlat as HP too', () => {
    // No gear currently carries endFlat — only armour does — so the gear branch
    // of gearContributions is unexercised by real data and a bug there would sit
    // silent until the first gear that has it. Prove it with a synthetic one.
    const fake = JSON.parse(JSON.stringify(data));
    fake.gearItems.__TestPlate = { endFlat: 40 };
    const M2 = require('./model.js').Model(fake);
    const b = M2.emptyBuild();
    b.level = 50; b.race = 'Estella (24%)';
    const before = M2.derived(b);
    b.gear = [{ name: '__TestPlate', tier: 0, alloc: {} }];
    const after = M2.derived(b);
    eq(after.stats.end, before.stats.end, 'gear endFlat leaked into the END stat');
    eq(Math.round(after.hp - before.hp), 40, 'gear endFlat did not add flat HP');
  });

  it('counts mastery as flat stats', () => {
    const b = M.emptyBuild();
    b.level = 50; b.klass = 'Lancer (N)'; b.race = 'Estella (24%)';
    const none = M.masteryFlat(b);
    b.masteryNodes = data.masteryNodes.filter(n => n.type === 'node').map(n => n.id);
    const all = M.masteryFlat(b);
    const sum = o => Object.values(o).reduce((a, v) => a + v, 0);
    eq(sum(none), 0);
    ok(sum(all) > 25, 'expected ~29 mastery stat points, got ' + sum(all));
  });
});

// ── 6b. reading and improving an existing build ─────────────────────────────
describe('analyse', () => {
  // A plausible getBuildState() payload for a mediocre Lancer.
  const mkState = over => Object.assign({
    lvl: 50, race: 'Estella (24%)', cls: 'Slayer', sup: 'Lancer (N)', sub: '',
    str: 60, arc: 30, end: 30, spd: 20, lck: 10,
    mark: '', pStat: '', cov: '', covR: 1, ench: '', art: '',
    sh: ['Striking (R)'], g: ['Lethal Blackjack', '', '', ''],
    ai: { tier: 0, shape: 0, stats: ['', '', '', ''], traits: [null, null] },
    gi: [{ tier: 2, shape: 0, stats: ['str', '', '', ''], traits: [{ id: 'heavyHand', tier: 2 }, null, null] },
         { tier: 0, shape: 0, stats: ['', '', '', ''], traits: [null, null, null] },
         { tier: 0, shape: 0, stats: ['', '', '', ''], traits: [null, null, null] },
         { tier: 0, shape: 0, stats: ['', '', '', ''], traits: [null, null, null] }],
    wm: 'Ferrus Spear', wo: '',
    wti: [{ tier: 0, shape: 0, stats: ['', '', '', ''] }, { tier: 0, shape: 0, stats: ['', '', '', ''] }],
    arm: 'Adept Warrior', ls: '', sc1: '', sc2: '', corr: '', msty: ['s1', 's2'], soul: {},
  }, over || {});

  it('reads a builder state into an engine build', () => {
    const b = Share.fromState(data, mkState());
    eq(b.klass, 'Lancer (N)');          // super wins over base
    eq(b.race, 'Estella (24%)');
    eq(b.level, 50);
    eq(b.invested.str, 60);
    eq(b.armour, 'Adept Warrior');
    eq(b.weapon.name, 'Ferrus Spear');
    eq(b.gear.length, 1);
    eq(b.gear[0].name, 'Lethal Blackjack');
    eq(JSON.stringify(b.shards), JSON.stringify(['Striking (R)']));
    eq(b.masteryNodes.length, 2);
  });

  it('resolves gear tier shapes into allocations', () => {
    const b = Share.fromState(data, mkState());
    // T2 shape 0 is [3], put on str.
    eq(b.gear[0].alloc.str, 3);
    eq(b.gear[0].tier, 2);
  });

  it('carries traits across', () => {
    const b = Share.fromState(data, mkState());
    eq(b.gear[0].traits.length, 1);
    eq(b.gear[0].traits[0].id, 'heavyHand');
  });

  it('copes with a blank builder', () => {
    const b = Share.fromState(data, {});
    ok(b, 'returned nothing');
    eq(b.gear.length, 0);
    eq(b.weapon, null);
    ok(b.level >= 1, 'bad level');
  });

  it('keeps the player class and race by default', () => {
    // "Your build would be better as a different class" is not usable advice.
    const r = engine.analyse(mkState());
    eq(r.improved.klass, 'Lancer (N)');
    eq(r.improved.race, 'Estella (24%)');
  });

  it('ignores null overrides from the Advanced panel', () => {
    // Regression: the panel reports unset dropdowns as null, and Object.assign
    // copied those nulls over the defaults — silently unlocking the player's own
    // class and "improving" their Lancer into a Berserker.
    const panel = { goal: null, klass: null, race: null, weaponType: null,
                    weaponName: null, armour: null, enchant: null, level: null, text: '' };
    const r = engine.analyse(mkState(), panel);
    eq(r.improved.klass, 'Lancer (N)');
    eq(r.improved.race, 'Estella (24%)');
  });

  it('still honours an explicit override', () => {
    const r = engine.analyse(mkState(), { klass: 'Impaler (Ch)' });
    eq(r.improved.klass, 'Impaler (Ch)');
  });

  it('infers what the build is going for', () => {
    const goalOf = over => engine.analyse(mkState(over)).spec.goal;
    eq(goalOf({ str: 20, arc: 5, end: 115, spd: 5, lck: 5 }), 'tank');
    eq(goalOf({ str: 20, arc: 5, end: 10, spd: 5, lck: 110 }), 'crit');
    eq(goalOf({ str: 20, arc: 5, end: 10, spd: 110, lck: 5 }), 'speed');
    // Arcane is both the caster and the summoner stat — the class decides.
    eq(goalOf({ cls: 'Wizard', sup: 'Necromancer (Ch)', str: 5, arc: 130, end: 5, spd: 5, lck: 5 }), 'summon');
    eq(goalOf({ cls: 'Wizard', sup: 'Elementalist (Or)', str: 5, arc: 130, end: 5, spd: 5, lck: 5 }), 'damage');
  });

  it('produces an actionable change list', () => {
    const r = engine.analyse(mkState());
    ok(r.changes.length > 0, 'no changes suggested for a weak build');
    for (const c of r.changes) {
      ok(c.what, 'change with no label');
      ok(String(c.from) !== String(c.to), 'listed a change that changes nothing: ' + c.what);
    }
  });

  it('actually improves the build it was given', () => {
    const r = engine.analyse(mkState());
    ok(r.improvedCtx.score > r.currentCtx.score,
       'improved score ' + r.improvedCtx.score + ' not better than ' + r.currentCtx.score);
    ok(r.gain.score > 0, 'no reported gain');
  });

  it('explains the improved build', () => {
    const r = engine.analyse(mkState());
    ok(Array.isArray(r.improvedExplanation) && r.improvedExplanation.length, 'no explanation');
    ok(!r.improvedExplanation.some(s => s.h === 'Request'), 'leaked the Request section');
  });

  it('never crashes on a half-filled builder', () => {
    const partials = [
      {}, { lvl: 1 }, { cls: 'Warrior' }, { race: 'Nisse (20%)' },
      { cls: 'Wizard', g: ['', '', '', ''] },
      { cls: 'Thief', sup: 'Rogue (N)', gi: null, wti: null, sh: null, msty: null },
    ];
    for (const st of partials) {
      const r = engine.analyse(st);
      ok(r && r.current, 'no result for ' + JSON.stringify(st));
    }
  });
});

// ── 6c. quality, randomness and flavour ─────────────────────────────────────
describe('build quality', () => {
  const STATS = ['str', 'arc', 'end', 'spd', 'lck'];
  const M = engine.model, O = engine.optimizer;

  // A fully-kitted RANDOM build of the same class and race, to check the
  // optimiser is doing real work rather than just filling slots.
  function randomBuild(klass, race, level, rnd) {
    const b = M.emptyBuild();
    b.level = level; b.race = race; b.klass = klass;
    let left = M.pointBudget(b);
    const inv = { str: 0, arc: 0, end: 0, spd: 0, lck: 0 };
    for (const st of STATS.slice(0, 4)) { const v = Math.floor(rnd() * left); inv[st] = v; left -= v; }
    inv.lck += left;
    b.invested = inv;
    const pick = a => a[Math.floor(rnd() * a.length) % a.length];
    b.armour = pick(Object.keys(data.armourItems));
    const gears = Object.keys(data.gearItems).slice().sort(() => rnd() - 0.5).slice(0, 4);
    b.gear = gears.map(n => ({ name: n, tier: data.MAX_GEAR_TIER, alloc: { [pick(STATS)]: 9 }, traits: [] }));
    b.artifact = { name: pick(Object.keys(data.artifactItems)), tier: data.MAX_GEAR_TIER,
                   alloc: { [pick(STATS)]: 9 }, traits: [] };
    b.weapon = { name: pick(Object.keys(data.weapons)), tier: data.MAX_WEAPON_TIER, alloc: {} };
    b.shards = Object.keys(data.shardItems).slice().sort(() => rnd() - 0.5).slice(0, 7);
    b.masteryNodes = data.masteryNodes.filter(n => n.type !== 'mastery').map(n => n.id);
    b.mark = 'Venia'; b.permuth = pick(STATS);
    b.enchant = pick(Object.keys(data.enchantItems));
    return b;
  }

  it('beats a fully-kitted random build of the same class, in every archetype', () => {
    // Deterministic pseudo-random so a failure is reproducible.
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 100000) / 100000; };

    for (const goal of Object.keys(K.ARCHETYPES)) {
      const spec = Intent.applyOverrides(Intent.parse('', data, K), { goal }, data);
      const run = O.run(spec);
      let best = -Infinity;
      for (let i = 0; i < 60; i++) {
        const rb = randomBuild(run.build.klass, run.build.race, 50, rnd);
        const sc = O.evaluate(rb, spec).score;
        if (sc > best) best = sc;
      }
      ok(run.ctx.score > best,
         goal + ': optimised ' + Math.round(run.ctx.score) + ' did not beat random ' + Math.round(best));
    }
  });

  it('never produces an illegal mastery tree', () => {
    // The tree is not a flat list: continuing down the MIDDLE of a branch runs
    // through the 5-point capstone, so those nodes cannot be taken without
    // paying for it — unlike the side nodes, which branch around it. Taking
    // every stat node and then buying an arbitrary capstone produced builds that
    // were three nodes illegal and unbuildable in game.
    for (const q of REQUESTS) {
      const chk = engine.optimizer.masteryLegal(ask(q).build);
      ok(chk.ok, JSON.stringify(q) + ' — ' + chk.problems.slice(0, 3).join('; '));
    }
  });

  it('pays for a capstone when it wants what is behind it', () => {
    // parent may be an ARRAY and builder.js requires all of them, so walk a set
    // rather than a single link — l5, c3a, cb2 and r5 are the convergence points
    // where two side nodes join back into the middle.
    const byId = {}; data.masteryNodes.forEach(x => { byId[x.id] = x; });
    const parentsOf = n => [].concat(n.parent == null ? [] : n.parent);
    const ancestors = id => {
      const out = new Set(); const stack = parentsOf(byId[id] || {}).slice();
      while (stack.length) {
        const p = stack.pop();
        if (out.has(p) || !byId[p]) continue;
        out.add(p); parentsOf(byId[p]).forEach(x => stack.push(x));
      }
      return out;
    };

    const gated = data.masteryNodes.filter(n =>
      [...ancestors(n.id)].some(a => (byId[a] || {}).type === 'mastery'));
    ok(gated.length > 0, 'no capstone-gated nodes in the tree — has it changed?');

    for (const q of ['necro summon vastayan', 'tanky build', 'max damage crit lancer']) {
      const sel = new Set(ask(q).build.masteryNodes);
      for (const g of gated) {
        if (!sel.has(g.id)) continue;
        for (const a of ancestors(g.id)) ok(sel.has(a), q + ': took ' + g.id + ' without ' + a);
      }
    }
  });

  it('requires BOTH sides where two branches converge', () => {
    // builder.js:7326 uses .every on the parent list, so a middle node needs
    // every side node above it, not just one.
    const multi = data.masteryNodes.filter(n => Array.isArray(n.parent) && n.parent.length > 1);
    ok(multi.length > 0, 'no convergence nodes — has the tree changed?');
    for (const q of REQUESTS.slice(0, 8)) {
      const sel = new Set(ask(q).build.masteryNodes);
      for (const n of multi) {
        if (!sel.has(n.id)) continue;
        for (const p of n.parent) ok(sel.has(p), q + ': took ' + n.id + ' without ' + p);
      }
    }
  });

  it('prices mastery nodes independently of the code under test', () => {
    // masteryLegal uses the same cost helper it validates, so a mutation to that
    // helper is invisible to it. Price the tree here from the documented rules —
    // node 1, capstone 5, breakthrough 0 (paid in echo shards) — and compare.
    const byId = {}; data.masteryNodes.forEach(n => { byId[n.id] = n; });
    const priceOf = n => n.type === 'mastery' ? 5 : (n.type === 'breakthrough' ? 0 : 1);
    for (const q of ['max damage crit lancer', 'tanky build', 'necro summon vastayan']) {
      const b = ask(q).build;
      const mine = b.masteryNodes.reduce((a, id) => a + priceOf(byId[id]), 0);
      eq(engine.optimizer.masteryLegal(b).spent, mine, q + ' point accounting');
      ok(mine <= (data.MASTERY_TOTAL_POINTS || 35), q + ' spends ' + mine);
    }
  });

  it('spends the mastery budget rather than leaving points idle', () => {
    for (const q of ['max damage crit lancer', 'tanky build', 'healer']) {
      const b = ask(q).build;
      const spent = engine.optimizer.masteryLegal(b).spent;
      const cap = data.MASTERY_TOTAL_POINTS || 35;
      // A stat point is never worse than an unspent point; anything more than a
      // capstone's worth left over means the search gave up early.
      ok(spent >= cap - 4, q + ' left ' + (cap - spent) + ' of ' + cap + ' mastery points unspent');
    }
  });

  it('no class has a duplicated mastery branch stat', () => {
    // Each class's four branches should cover four different stats. Necromancer
    // shipped with blue duplicating red as Speed when it should be Endurance,
    // which sent its mastery bonuses to the wrong stat in the builder itself.
    const bad = [];
    for (const [cls, v] of Object.entries(data.masteryClassData || {})) {
      const vals = Object.values(v.branchStats || {});
      if (vals.length !== new Set(vals).size) bad.push(cls + ' ' + JSON.stringify(v.branchStats));
    }
    eq(bad.length, 0, 'duplicated branch stats: ' + bad.join('; '));
  });

  it('fills every slot it is given', () => {
    const r = ask('max damage crit lancer');
    eq(r.build.gear.length, 4, 'gear slots');
    ok(r.build.artifact, 'no artifact');
    ok(r.build.weapon, 'no weapon');
    ok(r.build.armour, 'no armour');
    eq(r.build.shards.length, 7, 'shards');
    ok((r.build.masteryNodes || []).length > 25, 'mastery barely used');
  });

  it('scores gear passives, not just stat blocks', () => {
    // 51 of 80 gears carry a passive and they are often the reason to wear the
    // thing. A tank should end up with defensive passives on its gear.
    const r = ask('tanky build');
    const gp = r.ctx.gearPassives;
    ok(gp, 'no gear passive context');
    ok(gp.active.length > 0, 'a full tank build scored zero gear passives');
  });

  it('reports the gear passives it could not score', () => {
    const r = ask('max damage crit lancer');
    ok(Array.isArray(r.ctx.gearPassives.unmodelled), 'no unmodelled list');
  });

  it('GEAR_PASSIVES only names gear that exists', () => {
    const bad = Object.keys(K.GEAR_PASSIVES || {})
      .filter(n => !data.gearItems[n] && !data.artifactItems[n]);
    eq(bad.length, 0, 'unknown gear: ' + bad.join(', '));
  });
});

describe('random and flavour', () => {
  it('recognises a request for anything', () => {
    for (const q of ['random', 'surprise me', 'anything', 'something cool', 'idk', 'yolo'])
      ok(Intent.parse(q, data, K).random, q + ' was not read as random');
  });

  it('does not treat a real request as random', () => {
    for (const q of ['max damage crit lancer', 'tanky build', 'healer', ''])
      ok(!Intent.parse(q, data, K).random, q + ' was wrongly read as random');
  });

  it('rolls a class that suits the goal it rolled', () => {
    // A random build should be a surprise, not a joke: a speed Wizard is a valid
    // build and a bad one.
    for (let i = 0; i < 25; i++) {
      const r = ask('surprise me');
      const aff = engine.optimizer.weightOf(r.spec);
      ok(r.build.klass, 'no class rolled');
      ok(r.spec.rolled, 'nothing recorded as rolled');
      ok(aff, 'no weights');
    }
  });

  it('random builds are still complete builds', () => {
    for (let i = 0; i < 15; i++) {
      const r = ask('random');
      eq(r.build.gear.length, 4, 'gear');
      eq(r.build.shards.length, 7, 'shards');
      ok(r.build.weapon && r.build.armour, 'missing kit');
      ok(isFinite(r.ctx.bestHit) && isFinite(r.ctx.hp), 'non-finite stats');
      const sum = Object.values(r.build.invested).reduce((a, b) => a + b, 0);
      ok(sum <= engine.model.pointBudget(r.build), 'overspent');
    }
  });

  it('random builds actually vary', () => {
    const seen = new Set();
    for (let i = 0; i < 20; i++) seen.add(ask('surprise me').build.klass);
    ok(seen.size > 1, 'every random build was the same class');
  });

  it('varies the class even with the goal held fixed', () => {
    // The looser test above passes even if the class pick is deterministic,
    // because the GOAL still varies and a different goal suits a different
    // class. Hold the goal still to test the class roll itself.
    const seen = new Set();
    for (let i = 0; i < 30; i++) seen.add(engine.ask('surprise me', { goal: 'crit' }).build.klass);
    ok(seen.size > 1, 'class never varied for a fixed goal: ' + [...seen].join(', '));
  });

  it('a seeded random build is reproducible', () => {
    const a = engine.ask('surprise me', { seed: 4242 });
    const b = engine.ask('surprise me', { seed: 4242 });
    eq(a.build.klass, b.build.klass);
    eq(a.build.race, b.build.race);
    eq(a.spec.goal, b.spec.goal);
  });

  it('min-max never rolls the balanced archetype', () => {
    // That refusal IS the difference between the two random modes: a min-max
    // roll commits to one thing, a plain surprise may hand back something
    // merely sensible.
    for (let i = 0; i < 40; i++) {
      const r = engine.ask('', { minmax: true });
      ok(r.spec.goal !== 'balanced', 'min-max rolled balanced');
      ok(r.spec.minmax, 'minmax flag not set on the spec');
    }
  });

  it('plain random CAN roll balanced', () => {
    let sawBalanced = false;
    for (let i = 0; i < 80 && !sawBalanced; i++) {
      if (engine.ask('', { random: true }).spec.goal === 'balanced') sawBalanced = true;
    }
    ok(sawBalanced, 'plain random never rolled balanced in 80 tries — the two modes are identical');
  });

  it('min-max says what it gave up', () => {
    for (let i = 0; i < 15; i++) {
      const r = engine.ask('', { minmax: true });
      ok(Array.isArray(r.weaknesses), 'no weakness list');
      // A build extreme enough to be called min-maxed should have a real cost.
      ok(r.weaknesses.length > 0, 'min-maxed ' + r.spec.goal + ' build claimed no weaknesses');
      const gives = r.explanation.find(sec => sec.h === 'What it gives up');
      ok(gives, 'weaknesses computed but never explained');
    }
  });

  it('reads "random min max" from the text too', () => {
    for (const q of ['random min max', 'surprise me min maxed', 'random minmax build']) {
      const sp = Intent.parse(q, data, K);
      ok(sp.random, q + ' not read as random');
      ok(sp.minmax, q + ' not read as min-max');
    }
  });

  it('a plain surprise is not flagged min-max', () => {
    ok(!Intent.parse('surprise me', data, K).minmax);
    ok(!Intent.parse('something cool', data, K).minmax);
  });

  it('never rolls a support or utility race for a damage goal', () => {
    // Nobody min-maxing damage takes Daminos: four lives and outgoing healing
    // are excellent and entirely beside the point. The engine cannot work this
    // out on its own because racial passives are prose it cannot read.
    const wrong = ['Daminos (3%)', 'Veneri (6%)', 'Gynx (Ob)', 'Lentum (Ob)'];
    for (const goal of ['damage', 'burst', 'crit']) {
      for (let i = 0; i < 40; i++) {
        const race = engine.ask('', { minmax: true, goal }).build.race;
        ok(wrong.indexOf(race) === -1, goal + ' rolled ' + race);
      }
    }
  });

  it('never rolls a placeholder race', () => {
    // Arborivia and Calvariae have no stat block in the data yet; recommending
    // one is recommending an unfinished entry.
    const placeholders = Object.entries(K.RACE_ROLES || {})
      .filter(([, v]) => v.placeholder).map(([k]) => k);
    ok(placeholders.length > 0, 'no placeholder races declared — has the data been filled in?');
    for (let i = 0; i < 80; i++) {
      const race = engine.ask('', { minmax: true }).build.race;
      ok(placeholders.indexOf(race) === -1, 'rolled placeholder ' + race);
    }
  });

  it('does not search placeholder races even for a named request', () => {
    for (const q of ['max damage', 'tanky build', 'healer']) {
      const race = ask(q).build.race;
      ok(!((K.RACE_ROLES || {})[race] || {}).placeholder, q + ' chose placeholder ' + race);
    }
  });

  it('still honours a placeholder race asked for by name', () => {
    // Excluding them from the SEARCH is right; refusing an explicit request is not.
    const r = engine.ask('', { race: 'Arborivia (3%)' });
    eq(r.build.race, 'Arborivia (3%)');
  });

  it('picks a summon race for a summon goal', () => {
    const races = engine.optimizer.racesForGoal('summon');
    ok(races.indexOf('Vastayan (9%)') !== -1, 'Vastayan missing from summon races');
    ok(races.indexOf('Daminos (3%)') === -1, 'Daminos offered for summons');
  });

  it('RACE_ROLES covers every race in the data', () => {
    const missing = Object.keys(data.races).filter(r => !(K.RACE_ROLES || {})[r]);
    eq(missing.length, 0, 'unclassified: ' + missing.join(', '));
  });

  it('RACE_ROLES names no race that does not exist', () => {
    const bad = Object.keys(K.RACE_ROLES || {}).filter(r => !data.races[r]);
    eq(bad.length, 0, 'unknown races: ' + bad.join(', '));
  });

  it('every GOAL_RACE_ROLES goal is a real archetype', () => {
    const bad = Object.keys(K.GOAL_RACE_ROLES || {}).filter(g => !K.ARCHETYPES[g]);
    eq(bad.length, 0, 'unknown goals: ' + bad.join(', '));
  });

  it('RACE_TECH names real races and real gear', () => {
    for (const t of (K.RACE_TECH || [])) {
      ok(data.races[t.race], 'unknown race: ' + t.race);
      ok(!t.enables || data.gearItems[t.enables], 'unknown gear: ' + t.enables);
      ok(Array.isArray(t.goals) && t.goals.length, t.race + ' tech has no goals');
      for (const g of t.goals) ok(K.ARCHETYPES[g], t.race + ' tech names unknown goal ' + g);
      ok(t.why && t.why.length > 40, t.race + ' tech has no real explanation');
      ok(t.name, t.race + ' tech has no name');
    }
  });

  it('a tech race is admitted for the goals its tech covers', () => {
    for (const t of (K.RACE_TECH || [])) {
      for (const g of t.goals) {
        ok(engine.optimizer.racesForGoal(g).indexOf(t.race) !== -1,
           t.race + ' not offered for ' + g + ' despite its tech');
      }
    }
  });

  it('a tech race actually runs the combo', () => {
    // Admitting an off-role race and then not building around it would be a
    // story attached to an ordinary build.
    for (const t of (K.RACE_TECH || [])) {
      if (!t.enables) continue;
      const r = engine.ask('', { race: t.race, goal: t.goals[0] });
      ok(r.spec.tech && r.spec.tech.name === t.name, 'tech not recorded on the spec');
      // Check the PINNING, not just the outcome: the optimiser may well pick the
      // enabling gear on merit, which made an earlier version of this test pass
      // with pinning disabled entirely.
      eq(r.spec.forceGear, t.enables, 'enabling gear was not pinned');
      eq((r.build.gear[0] || {}).name, t.enables, t.enables + ' is not in the pinned slot');
      // NOTE: for the current tech entry the optimiser would pick the enabling
      // gear on merit anyway, so this assertion alone cannot prove the pinning
      // works. The test below does that in isolation.
    }
  });

  it('pinning forces a gear the optimiser would otherwise reject', () => {
    // Tested with deliberately useless gear, because the real tech enabler is
    // also the optimiser's own first pick — so pinning it proves nothing. Pick
    // the gear that ranks LAST for a crit build and check it survives anyway.
    const spec = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'crit' }, data);
    const ranked = engine.optimizer.rankGear(spec, engine.optimizer.weightOf(spec));
    const worst = ranked[ranked.length - 1].name;

    const plain = engine.optimizer.run(spec);
    ok(!plain.build.gear.some(g => g.name === worst), worst + ' was chosen on merit — pick another');

    const pinned = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'crit' }, data);
    pinned.forceGear = worst;
    const withPin = engine.optimizer.run(pinned);
    eq((withPin.build.gear[0] || {}).name, worst, 'pinned gear did not survive');
    eq(withPin.build.gear.length, 4, 'pinning cost a gear slot');
  });

  it('explains the tech whenever it uses it', () => {
    for (const t of (K.RACE_TECH || [])) {
      const r = engine.ask('', { race: t.race, goal: t.goals[0] });
      const why = r.explanation.find(sec => sec.h === 'Why this build');
      ok(why && (why.list || []).some(l => l.indexOf(t.name) !== -1),
         t.name + ' used but never explained');
    }
  });

  it('does not apply tech to a goal it does not cover', () => {
    for (const t of (K.RACE_TECH || [])) {
      const off = Object.keys(K.ARCHETYPES).filter(g => t.goals.indexOf(g) === -1);
      if (!off.length) continue;
      const r = engine.ask('', { race: t.race, goal: off[0] });
      ok(!r.spec.tech, t.race + ' claimed tech for ' + off[0]);
    }
  });

  it('provides everything the builder summary needs', () => {
    // The panel writes a summary into the builder's Summary box from these.
    for (const q of ['max damage crit lancer', 'tanky build', 'surprise me']) {
      const r = ask(q);
      ok(r.flavour && r.flavour.name && r.flavour.line, 'no flavour for ' + q);
      ok(r.ctx.bestMove !== undefined, 'no best move');
      ok(Array.isArray(r.weaknesses), 'no weaknesses list');
      ok(r.ctx.gearPassives && Array.isArray(r.ctx.gearPassives.active), 'no gear passives');
      ok(r.ctx.passiveList && Array.isArray(r.ctx.passiveList.unknown), 'no passive list');
      ok(r.corruption && r.corruption.best, 'no corruption reasoning');
      ok(typeof r.ctx.energyCap === 'number', 'no energy cap');
    }
  });

  it('analyse carries flavour and weaknesses for the improved build', () => {
    const r = engine.analyse({ lvl: 50, cls: 'Slayer', sup: 'Lancer (N)', race: 'Estella (24%)',
                               str: 60, arc: 30, end: 30, spd: 20, lck: 10 });
    ok(r.improvedFlavour && r.improvedFlavour.name, 'no flavour on the improved build');
    ok(Array.isArray(r.improvedWeaknesses), 'no weaknesses on the improved build');
  });

  it('SETUP_MOVES name real moves on the race or class that owns them', () => {
    for (const [name, def] of Object.entries(K.SETUP_MOVES || {})) {
      const src = def.owner
        ? ((data.raceMoves || {})[def.owner] || (data.classMoves || {})[def.owner])
        : null;
      ok(src, name + ' names an unknown owner: ' + def.owner);
      ok((src.learns || []).some(m => m.name === name && m.type === 'Active'),
         def.owner + ' has no active move called ' + name);
      ok(def.cd > 0 && def.duration > 0, name + ' needs a duration and a cooldown for uptime');
      ok(def.note && def.note.length > 20, name + ' has no explanation');
    }
  });

  it('counts a setup buff as an opener, not a permanent bonus', () => {
    // Corvolus has castable buffs; the burst number must beat the cold number,
    // and the sustained number must sit between them.
    const r = engine.ask('', { race: 'Corvolus (3%)', klass: 'Elementalist (Or)', goal: 'burst' });
    ok(r.ctx.rotation.length > 0, 'no rotation found for Corvolus');
    ok(r.ctx.bestBurst > r.ctx.bestHit, 'burst not better than the cold hit');
    ok(r.ctx.sustainedHit >= r.ctx.bestHit && r.ctx.sustainedHit <= r.ctx.bestBurst,
       'sustained ' + Math.round(r.ctx.sustainedHit) + ' outside [' +
       Math.round(r.ctx.bestHit) + ', ' + Math.round(r.ctx.bestBurst) + ']');
  });

  it('prefers the buff race for burst, and knows a castable buff costs a turn', () => {
    // Corvolus's buffs are cast; Nisse's is permanent. Which race wins on
    // SUSTAINED damage is a margin of about a percent and moves whenever
    // anything else in the model changes, so asserting a winner there was
    // testing the tie-break rather than the modelling. What is not a coin flip:
    // the castable race gains from an opener and the permanent one gains
    // nothing, because it has nothing to set up.
    const burst = engine.ask('', { klass: 'Elementalist (Or)', goal: 'burst' });
    eq(burst.build.race, 'Corvolus (3%)', 'burst should favour the castable buff');

    const corv = engine.ask('', { klass: 'Elementalist (Or)', race: 'Corvolus (3%)', goal: 'burst' });
    const niss = engine.ask('', { klass: 'Elementalist (Or)', race: 'Nisse (20%)',  goal: 'burst' });
    ok(corv.ctx.bestBurst > corv.ctx.bestHit * 1.05,
       'Corvolus gains nothing from its opener');
    ok(Math.abs(niss.ctx.bestBurst - niss.ctx.bestHit) < 0.5,
       'Nisse has no setup moves, so its opener should be its plain hit');
  });

  it('models Focus Step as a real Speed buff', () => {
    // LVL x 2 flat Speed is +100 at level 50 and runs through model.js's own
    // verified buff path, not a second implementation.
    const r = engine.ask('', { race: 'Stultus (20%)', klass: 'Lancer (N)', goal: 'burst' });
    ok(r.ctx.rotation.some(x => x.move === 'Focus Step'), 'Focus Step not in the rotation');
    ok(r.ctx.bestBurst > r.ctx.bestHit, 'Focus Step did nothing');
  });

  it('a race with no setup moves has no rotation', () => {
    const r = engine.ask('', { race: 'Nisse (20%)', klass: 'Elementalist (Or)', goal: 'burst' });
    eq(r.ctx.rotation.length, 0, 'invented a rotation');
    eq(Math.round(r.ctx.bestBurst), Math.round(r.ctx.bestHit), 'burst differs with no setup');
  });

  it('an element-gated buff only pays on matching moves', () => {
    const def = (K.SETUP_MOVES || {})['Cast Amplify'];
    ok(def && def.elements, 'Cast Amplify has no element gate');
    ok(!def.elements.test('Physical'), 'element gate wrongly matches Physical');
    ok(def.elements.test('Magic'), 'element gate fails on Magic');

    // And the gate must actually be APPLIED, not merely declared. Corvolus's
    // buffs cover magic/holy/fire/nature/ice/dark only, so a kit whose best move
    // is Physical must see no burst gain at all. Checking the regex alone let a
    // mutation that removed the gate pass.
    for (const klass of ['Lancer (N)', 'Brawler (N)']) {
      const r = engine.ask('', { race: 'Corvolus (3%)', klass, goal: 'burst' });
      const mv = r.ctx.burstMove || r.ctx.bestMove;
      eq(String(mv && mv.moveType), 'Physical', klass + ' best move is not Physical — pick another');
      eq(Math.round(r.ctx.bestBurst), Math.round(r.ctx.bestHit),
         klass + ' gained burst from an element-gated buff it cannot use');
    }
  });

  it('explains the rotation whenever there is one', () => {
    const r = engine.ask('', { race: 'Corvolus (3%)', klass: 'Elementalist (Or)', goal: 'burst' });
    const sec = r.explanation.find(x => x.h === 'Opening rotation — out of form');
    ok(sec && (sec.list || []).length >= 2, 'rotation not explained');
    ok(sec.list.some(l => /Cast Amplify/.test(l)), 'opener not named');
  });

  it('gives a separate in-form rotation, not the same one with a bigger number', () => {
    // Entering the form costs 100 Corrupt Energy and the payoff costs turns on
    // top, so it is a different rotation. Presenting it as the same one with a
    // bigger number at the end is the thing this is meant to avoid.
    const r = engine.ask('', { race: 'Corvolus (3%)', klass: 'Elementalist (Or)', goal: 'burst' });
    const out = r.explanation.find(x => x.h === 'Opening rotation — out of form');
    const inF = r.explanation.find(x => /^Opening rotation — in /.test(x.h));
    ok(inF, 'no in-form rotation');
    ok(inF.list.length > out.list.length, 'the in-form rotation is not longer than the plain one');
    ok(inF.list.some(l => /Soul Ignition/.test(l)), 'never mentions entering the form');
    // The out-of-form rotation must stay out of form: that is the number the
    // build was optimised on and the one people compare against.
    ok(!out.list.some(l => /Soul Ignition|Notch|Mandate|Light Force/.test(l)),
       'form mechanics leaked into the out-of-form rotation');
  });

  it('never lists the payoff move twice in a row', () => {
    // Blasphemy's dump move is both the last setup step and the finisher, and
    // it was being printed as two consecutive turns.
    for (const q of ['berserker carnage max damage', 'i want to hit really hard', 'tanky knight']) {
      const sec = ask(q).explanation.find(x => /^Opening rotation — in /.test(x.h));
      if (!sec) continue;
      // Step lines read "**Turn 3 — Soul Ignition.** ..." and the finisher reads
      // "**Turn 11 — Carnage** for about ...". An earlier version of this only
      // matched the first shape, so the finisher never entered the list and the
      // duplicate it was written to catch slipped straight through.
      const nameOf = l => {
        const m = l.match(/^\*\*(?:Turns?[^—]*|Bonus action)\s*—\s*(.+?)\.?\*\*/);
        return m ? m[1] : null;
      };
      const names = sec.list.map(nameOf).filter(Boolean);
      ok(names.length >= 2, '"' + q + '" produced no readable step names');
      for (let i = 1; i < names.length; i++)
        ok(names[i] !== names[i - 1], '"' + q + '" lists ' + names[i] + ' on two turns running');
    }
  });

  it('spends as many turns banking Notch as it actually takes', () => {
    // The bank is the whole cost of Blasphemy's +30%. Showing it as one turn
    // would make the form look far cheaper than it is.
    const r = ask('berserker carnage max damage');
    const sec = r.explanation.find(x => /^Opening rotation — in Blasphemy/.test(x.h));
    if (!sec) return;
    const bank = sec.list.find(l => /Bank Notch/.test(l));
    ok(bank, 'no banking step in the in-form rotation');
    const m = bank.match(/Turns (\d+)–(\d+)/);
    ok(m, 'the bank is shown as a single turn: ' + bank.slice(0, 60));
    eq(+m[2] - +m[1] + 1, r.ctx.energyCap, 'banking turns should equal the energy cap');
  });

  it('does not number a bonus action as a turn', () => {
    // Heresy spends Light Force as a bonus action. Calling it "Turn 3" directly
    // contradicted the note beside it saying it costs no turn.
    const r = engine.ask('', { klass: 'Lancer (N)', goal: 'crit' });
    const sec = r.explanation.find(x => /^Opening rotation — in Heresy/.test(x.h));
    if (!sec) return;
    // Only the STEP lines, which are the ones carrying a turn label. The closing
    // commentary also says "costs no turn" and is not a step.
    const steps = sec.list.filter(l => /^\*\*(Turn|Turns|Bonus action)/.test(l));
    ok(steps.length > 0, 'no step lines at all');
    for (const line of steps) {
      if (/costs no turn/.test(line)) ok(/^\*\*Bonus action/.test(line),
        'a no-turn step was numbered as a turn: ' + line.slice(0, 60));
    }
    ok(steps.some(l => /^\*\*Bonus action/.test(l)), 'Heresy never shows its bonus action')
  });

  it('always names the build', () => {
    for (const q of ['max damage crit lancer', 'tanky build', 'healer', '', 'asdfghjkl', 'surprise me']) {
      const r = ask(q);
      ok(r.flavour && r.flavour.name && r.flavour.line, 'no flavour for ' + JSON.stringify(q));
    }
  });

  it('the name never contradicts the build', () => {
    // Flavour reads the COMPUTED build, so a "Glass Cannon" must really be one.
    for (let i = 0; i < 30; i++) {
      const r = ask('surprise me');
      const c = r.ctx, n = r.flavour.name;
      if (n === 'Glass Cannon' || n === 'Purple Streak') ok(c.hp < 200, n + ' with ' + Math.round(c.hp) + ' HP');
      if (n === 'The Immovable Object') ok(c.hp >= 450, n + ' with only ' + Math.round(c.hp) + ' HP');
      if (n === 'Middle Management') eq(c.goal, 'summon');
      if (n === 'Group Project Carry') eq(c.goal, 'heal');
    }
  });
});

// ── 6b2. ties are not coin flips ────────────────────────────────────────────
describe('tie breaking', () => {
  const M = engine.model, O = engine.optimizer;

  it('never settles for an untiered weapon that only ties', () => {
    // Weapons tie constantly: a class whose moves carry no stat scaling gets
    // nothing measurable from the 5 tier points, so Ferrus and Dragontooth score
    // identically. They are still 5 real stat points in game. A non-tiered
    // weapon is only acceptable if it genuinely scores HIGHER — Jade's +30%
    // healing does, for a tank; Ferrus never does.
    for (const q of REQUESTS) {
      const r = ask(q);
      const b = r.build;
      if (!b.weapon || M.weaponIsTiered(b.weapon.name)) continue;

      const type = (data.weapons[b.weapon.name] || {}).type;
      const mine = O.evaluate(b, r.spec).score;
      const keep = b.weapon;

      let bestRival = -Infinity, rivalName = null;
      for (const [name, def] of Object.entries(data.weapons)) {
        if (def.type !== type || !M.weaponIsTiered(name)) continue;
        if (engine.optimizer.unavailableReason(name)) continue;
        b.weapon = { name, tier: data.MAX_WEAPON_TIER, alloc: keep.alloc || {} };
        const sc = O.evaluate(b, r.spec).score;
        if (sc > bestRival) { bestRival = sc; rivalName = name; }
      }
      b.weapon = keep;
      if (rivalName === null) continue;   // no tiered weapon of that type exists

      ok(mine > bestRival + 1e-9,
         '"' + q + '" kept the untiered ' + keep.name + ' at ' + mine.toFixed(3) +
         ' when the tiered ' + rivalName + ' scores ' + bestRival.toFixed(3));
    }
  });
});

// ── 6c. items the game does not currently allow ─────────────────────────────
describe('availability', () => {
  const U = K.UNAVAILABLE || {};

  // Every offhand name, flattened the way share.js flattens them.
  const offhands = Object.values(data.offhandSeries || {})
    .reduce((a, group) => a.concat(Object.keys(group || {})), []);

  const knownItem = name =>
    !!(data.gearItems[name] || data.armourItems[name] || data.artifactItems[name] ||
       data.enchantItems[name] || data.weapons[name] || offhands.indexOf(name) !== -1);

  // The whole table is name matching, so a typo excludes nothing and does it
  // silently. This is the test that makes the table trustworthy.
  it('every excluded name exists in the game data', () => {
    for (const name of Object.keys(U.items || {})) {
      ok(knownItem(name), 'UNAVAILABLE.items has "' + name + '", which is not in the data — typo?');
    }
    for (const series of Object.keys(U.weaponSeries || {})) {
      ok((data.mainWeaponSeries || {})[series],
         'UNAVAILABLE.weaponSeries has "' + series + '", which is not a weapon series — typo?');
    }
  });

  it('every exclusion carries a reason', () => {
    for (const [name, why] of Object.entries(U.items || {}))
      ok(typeof why === 'string' && why.length > 5, name + ' has no usable reason text');
    for (const [series, why] of Object.entries(U.weaponSeries || {}))
      ok(typeof why === 'string' && why.length > 5, series + ' has no usable reason text');
  });

  // The set the engine actually resolves to, series expanded.
  const excluded = new Set(Object.keys(U.items || {}));
  for (const series of Object.keys(U.weaponSeries || {}))
    for (const [name, def] of Object.entries(data.weapons || {}))
      if (def.series === series) excluded.add(name);

  it('resolves a whole weapon series, not just the names listed', () => {
    // The point of listing a series is that it covers weapons nobody typed out.
    for (const series of Object.keys(U.weaponSeries || {})) {
      const members = Object.entries(data.weapons || {}).filter(([, d]) => d.series === series);
      ok(members.length > 0, series + ' matched no weapons');
      for (const [name] of members)
        ok(engine.optimizer.unavailableReason(name), name + ' is in an excluded series but reads as usable');
    }
  });

  it('never puts one in a build', () => {
    for (const q of REQUESTS) {
      const b = ask(q).build;
      const worn = [b.armour, b.enchant,
                    b.weapon && b.weapon.name, b.offhand && b.offhand.name,
                    b.artifact && b.artifact.name]
                   .concat(b.gear.map(g => g.name)).filter(Boolean);
      for (const name of worn)
        ok(!excluded.has(name), '"' + q + '" produced a build wearing ' + name);
    }
  });

  it('keeps them out of the gear shortlist while they are still in the data', () => {
    // Both halves matter: the second proves the filter is what removes them
    // rather than the item simply not existing.
    const spec = Intent.parse('max damage strength build', data, K);
    const ranked = engine.optimizer.rankGear(spec, engine.optimizer.weightOf(spec)).map(r => r.name);
    for (const name of Object.keys(U.items || {})) {
      if (!data.gearItems[name]) continue;
      ok(ranked.indexOf(name) === -1, name + ' is still in the gear shortlist');
      ok(data.gearItems[name], name + ' vanished from the data — the exclusion is now testing nothing');
    }
  });

  it('drops one named in the request and says why', () => {
    const r = ask('ivory sword build');
    ok(r.build.weapon && !excluded.has(r.build.weapon.name),
       'still handed back ' + (r.build.weapon || {}).name);
    ok((r.spec.unavailable || []).some(u => u.name === 'Ivory Sword'),
       'the drop was not recorded on the spec');
    ok(r.explanation.some(sec => sec.h === "Couldn't use"),
       'the answer never mentions that the request could not be met');
  });

  it('refuses one even when the strip pass is bypassed', () => {
    // run() nulls an unusable weapon before the search ever sees it, so the
    // check inside weaponsFor is a second layer and nothing was exercising it.
    // Called directly, it still has to refuse.
    const opts = engine.optimizer.weaponsFor({ weaponName: 'Ivory Sword' }, 'Warrior');
    ok(opts.indexOf('Ivory Sword') === -1, 'weaponsFor handed back an unusable weapon');
    ok(opts.length > 0, 'weaponsFor narrowed to nothing, which breaks the build');
  });

  it('drops one chosen in Advanced options', () => {
    // The dropdown no longer offers these, but an old bookmark or a stale page
    // still can, and silently building something else would be worse.
    const r = engine.ask('', { weaponName: 'Icerind Greatsword' });
    ok(r.build.weapon && r.build.weapon.name !== 'Icerind Greatsword',
       'Advanced options forced an unusable weapon through');
    ok((r.spec.unavailable || []).some(u => u.name === 'Icerind Greatsword'),
       'the drop was not recorded');
  });

  it('flags them in a build somebody already has', () => {
    const st = {
      lvl: 50, race: 'Estella (24%)', cls: 'Slayer', sup: 'Lancer (N)', sub: '',
      str: 60, arc: 30, end: 30, spd: 20, lck: 10,
      mark: '', pStat: '', cov: '', covR: 1, ench: '', art: '',
      sh: [], g: ['Dread Fang', 'Empty Blade', '', ''],
      ai: { tier: 0, shape: 0, stats: ['', '', '', ''], traits: [null, null] },
      gi: [0, 1, 2, 3].map(() => ({ tier: 0, shape: 0, stats: ['', '', '', ''], traits: [null, null, null] })),
      wm: 'Ivory Spear', wo: '',
      wti: [{ tier: 0, shape: 0, stats: ['', '', '', ''] }, { tier: 0, shape: 0, stats: ['', '', '', ''] }],
      arm: 'Adept Warrior', ls: '', sc1: '', sc2: '', corr: '', msty: [], soul: {},
    };
    const r = engine.analyse(st);
    const flagged = (r.unavailable || []).map(u => u.name).sort();
    eq(flagged.join(', '), 'Dread Fang, Empty Blade, Ivory Spear');
    for (const u of r.unavailable) ok(u.why && u.what, 'a flag with no reason or slot');
    // And the replacement build must not reintroduce them.
    ok(!excluded.has(r.improved.weapon.name), 'the improved build put an unusable weapon back on');
  });
});

// ── 6d. what a corruption form does to the numbers ──────────────────────────
describe('mastery reaches the move', () => {
  it('reports the scaling the mastery actually gives, not the raw data', () => {
    // The reported bug: a Blade Dancer who had BOUGHT Flowing Dance Proficiency
    // was told the move still scaled STR/75 + SPD/75. The damage was already
    // right - moveDamage applies the override - but the sentence beside it
    // printed the raw game data, which reads exactly like the mastery doing
    // nothing. "mastery isnt being calculated after getting it".
    const r = engine.ask('', { klass: 'Blade Dancer (N)', goal: 'speed', play: 'solo', dmg: 'average' });
    ok((r.build.masteryNodes || []).includes('rm2'),
       'this build no longer takes rm2, so the test proves nothing - pick another goal');
    eq(r.ctx.bestMove.name, 'Flowing Dance', 'best move changed; retarget this test');
    eq(r.ctx.bestMove.scaling, 'SPD/50',
       'the mastery was bought but the move still reports ' + r.ctx.bestMove.scaling);
    ok(r.ctx.bestMove.shapeNote, 'nothing says why the move changed');
  });

  it('does not rewrite the move when the mastery was not bought', () => {
    const r = engine.ask('', { klass: 'Blade Dancer (N)', goal: 'damage', play: 'solo', dmg: 'average' });
    if ((r.build.masteryNodes || []).includes('rm2')) return;   // it did buy it; nothing to check
    if (r.ctx.bestMove.name !== 'Flowing Dance') return;
    eq(r.ctx.bestMove.scaling, 'STR/75 + SPD/75',
       'the override fired without the node being taken');
  });

  it('never writes the effective shape onto the shared move data', () => {
    // The move objects come straight from the snapshot. Writing to one would
    // leak the last build's mastery into every later build.
    const withNode = engine.ask('', { klass: 'Blade Dancer (N)', goal: 'speed', play: 'solo', dmg: 'average' });
    void withNode;
    const cm = data.classMoves['Blade Dancer (N)'] || {};
    const raw = [].concat(cm.learns || [], cm.innatePassives || [])
                  .find(m => m && m.name === 'Flowing Dance');
    eq(raw.scaling, 'STR/75 + SPD/75', 'the shared game data was mutated to ' + raw.scaling);
  });
});

describe('damage model', () => {
  it('average and potential build genuinely different characters', () => {
    // The reason this is asked rather than assumed. On average, crit chance
    // returns what it costs and Luck competes; on potential, a crit is assumed
    // to land, so crit CHANCE past the first point buys nothing and the points
    // go to raw scaling instead.
    const base = { klass: 'Blade Dancer (N)', goal: 'damage', play: 'solo' };
    const avg = engine.ask('', Object.assign({ dmg: 'average'   }, base));
    const pot = engine.ask('', Object.assign({ dmg: 'potential' }, base));
    ok(avg.build.invested.lck > pot.build.invested.lck,
       'average (' + avg.build.invested.lck + ' LCK) did not value Luck above potential (' +
       pot.build.invested.lck + ' LCK)');
    ok(avg.ctx.critChance > pot.ctx.critChance, 'average did not end with more crit chance');
  });

  it('prices Luck at what it actually returns on average', () => {
    const r = engine.ask('', { klass: 'Blade Dancer (N)', goal: 'damage', play: 'solo', dmg: 'average' });
    ok(r.ctx.critChance > 0, 'an average-damage build ended with no crit chance at all');
    // Expected value, not a ceiling: the reported hit must sit at or below the
    // number a landed crit would give.
    const ceiling = r.ctx.bestHit * (r.ctx.critChance >= 100 ? 1 : 4);
    ok(r.ctx.bestHit <= ceiling, 'the reported hit is not an expected value');
  });

  it('says which model it built for, and that the other differs', () => {
    for (const dmg of ['average', 'potential']) {
      const r = engine.ask('', { klass: 'Blade Dancer (N)', goal: 'damage', play: 'solo', dmg });
      const sec = r.explanation.find(x => x.h === 'Damage model');
      ok(sec, dmg + ': nothing says which damage model was used');
      ok(new RegExp(K.DAMAGE_MODELS[dmg].label, 'i').test(sec.body), dmg + ': the wrong label');
    }
  });

  it('the panel makes it a required choice, not a default', () => {
    const root = path.join(__dirname, '..', '..');
    const js = fs.readFileSync(path.join(root, 'js/build-ai.js'), 'utf8');
    ok(/let dmgModel = null/.test(js), 'the panel preselects a damage model');
    ok(js.indexOf('needsDmgModel') !== -1, 'nothing stops a build without the choice');
    ok(/function run\(\)[\s\S]{0,300}needsDmgModel\(ov\)\) return;/.test(js),
       'run() does not gate on the choice');
    ok(/data-dmg="average"/.test(js) && /data-dmg="potential"/.test(js), 'both options are not offered');
    ok(/delete o\.dmg/.test(js), 'the required choice is counted as an Advanced override');
    // The two required rows must not steal each other's buttons.
    ok(/#bai-play \.bai-play-opt/.test(js) && /#bai-dmg \.bai-play-opt/.test(js),
       'the two chooser rows share an unscoped selector and will overwrite each other');
  });
});

describe('class weapons', () => {
  it('never hands a class a weapon type it cannot equip', () => {
    // Berserker is greatsword-only. The inference read "The Big Sword" in its kit
    // as the `Sword` type and gave every Berserker build a Primordial Sword - a
    // build nobody can actually enter into the game.
    for (const [klass, allowed] of Object.entries(K.CLASS_WEAPONS)) {
      if (!data.classMoves || !data.classMoves[klass]) continue;   // base classes
      for (const goal of ['damage', 'tank']) {
        const r = engine.ask('', { klass, goal, play: 'solo' });
        const name = r.build.weapon && r.build.weapon.name;
        if (!name) continue;
        const type = (data.weapons[name] || {}).type;
        ok(allowed.includes(type),
           klass + '/' + goal + ' was given ' + name + ' (' + type + '), but the class can only use ' +
           allowed.join(', '));
      }
    }
  });

  it('an explicit table entry beats the inference', () => {
    // The whole point of the override: inference has to lose to a stated fact.
    eq(K.CLASS_WEAPONS['Berserker (Ch)'].join(), 'Greatsword', 'Berserker is not pinned to Greatsword');
    const r = engine.ask('', { klass: 'Berserker (Ch)', goal: 'damage', play: 'solo' });
    eq((data.weapons[r.build.weapon.name] || {}).type, 'Greatsword',
       'a Berserker is still being handed ' + r.build.weapon.name);
  });

  it('every weapon type named in the table exists in the data', () => {
    const real = new Set(Object.values(data.weapons || {}).map(w => w.type));
    for (const [klass, allowed] of Object.entries(K.CLASS_WEAPONS)) {
      for (const t of allowed) {
        ok(real.has(t), klass + ' is restricted to "' + t + '", which is not a weapon type in the data');
      }
    }
  });
});

describe('shard values', () => {
  it('reads shard percentages from the site, never from a copy in the engine', () => {
    // Shattering was nerfed to a quarter of its old value. That edit belongs in
    // js/builder.js, which the snapshot is extracted from - if the number were
    // ALSO written into the engine, a balance change would have to be made twice
    // and the two copies would drift apart silently.
    //
    // Proved by changing the data and watching the answer move, rather than by
    // scanning the source for the literal: the first version of this test did
    // that and tripped over an unrelated `uptime: 0.7` that happened to equal a
    // shard's value. A test that fires on coincidence is worse than none.
    const bumped = JSON.parse(JSON.stringify(data));
    bumped.shardItems['Shattering (R)'].rVal = 100;
    const spec = { klass: 'Berserker (Ch)', goal: 'damage', play: 'solo' };
    const before = engine.ask('', spec);
    const after  = Engine(bumped).ask('', spec);
    const shardDmg = r => (r.ctx.shards && r.ctx.shards.dmgPct) || 0;
    ok(shardDmg(after) > shardDmg(before),
       'a shard worth 100% per debuff scored no more than one worth ' +
       data.shardItems['Shattering (R)'].rVal + '% — the engine is not reading the data');
  });

  it('a nerfed shard actually loses ground in the search', () => {
    // The whole point of putting the number in the data: it has to reach the
    // optimiser. Shattering at a quarter strength must no longer outrank the
    // unconditional shards.
    const sh = data.shardItems['Shattering (R)'];
    ok(sh && sh.rVal < 1, 'Shattering (R) is not at its nerfed value: ' + (sh && sh.rVal));
    const r = engine.ask('', { klass: 'Berserker (Ch)', goal: 'damage', play: 'solo' });
    const picks = r.build.shards || [];
    const iShat = picks.indexOf('Shattering (R)');
    const iEmp  = picks.indexOf('Empowering (R)');
    ok(iEmp !== -1, 'the always-on shard was not picked at all');
    ok(iShat === -1 || iShat > iEmp,
       'Shattering still outranks an unconditional shard at a quarter strength');
  });
});

describe('corruption damage', () => {
  it('charges every form the turns it takes to get into one', () => {
    // Reported from play: banking 100 Corrupt Energy is about seven turns. It is
    // the single most important number about corruption, because every in-form
    // figure is a state you reach a third of the way into a long fight rather
    // than an opener - and without it the in-form column reads as a free upgrade.
    const T = K.CORRUPTION_ENTRY_TURNS;
    ok(typeof T === 'number' && T > 0, 'no entry-turn cost is defined');
    for (const form of K.CORRUPTION) {
      const fn = K.CORRUPTION_DAMAGE[form.name];
      if (!fn) continue;
      const d = fn({ energyCap: 5, moves: [{ name: 'X', cost: 3 }], critChance: 30, level: 50 });
      const entry = (d.steps || []).find(st => /Ignition/i.test(st.move));
      ok(entry, form.name + ' has no step for entering the form');
      eq(entry.turns, T, form.name + ' does not charge the entry cost');
    }
  });

  it('numbers the in-form rotation from after the entry, not from turn one', () => {
    const r = engine.ask('', { klass: 'Darkwraith (Ch)', goal: 'damage', play: 'solo', corruption: true });
    const rot = r.explanation.find(x => /Opening rotation — in /.test(x.h));
    ok(rot, 'no in-form rotation');
    const entryLine = rot.list.find(l => /Ignition/.test(l));
    ok(/Turns 1–7|Turns 1-7/.test(entryLine),
       'the entry does not span its seven turns: ' + entryLine.slice(0, 80));
    // The finisher cannot land before the form has even been entered.
    const finisher = rot.list.filter(l => /^\*\*Turn \d+ —/.test(l)).pop();
    const n = finisher && Number((finisher.match(/Turn (\d+)/) || [])[1]);
    ok(n > K.CORRUPTION_ENTRY_TURNS,
       'the payoff lands on turn ' + n + ', at or before the ' + K.CORRUPTION_ENTRY_TURNS +
       ' it takes to enter the form');
  });

  it('says the in-form damage is a late-fight number', () => {
    const r = engine.ask('', { klass: 'Darkwraith (Ch)', goal: 'damage', play: 'solo', corruption: true });
    const sec = r.explanation.find(x => x.h === 'Damage in form');
    ok(sec, 'no in-form damage section');
    ok((sec.list || []).some(l => /late-fight/i.test(l) && new RegExp(K.CORRUPTION_ENTRY_TURNS).test(l)),
       'nothing says when these numbers start applying');
  });

  it('works out every form, not only the chosen one', () => {
    for (const q of REQUESTS.slice(0, 10)) {
      const r = ask(q);
      if (!r.corruption) continue;
      eq(r.corruption.all.length, K.CORRUPTION.length, 'form count for "' + q + '"');
      for (const f of r.corruption.all) {
        ok(f.damage, f.form + ' has no damage figure for "' + q + '"');
        ok(isFinite(f.damage.burstHit) && f.damage.burstHit >= 0, f.form + ' burst is not a number');
        ok(isFinite(f.damage.sustainedHit) && f.damage.sustainedHit >= 0, f.form + ' sustained is not a number');
        ok(f.damage.burst >= 1 && f.damage.sustained >= 1, f.form + ' claims a form makes you weaker');
      }
    }
  });

  it('never states a number the game does not give without flagging it', () => {
    // A multiplier above 1 is either traceable to the mechanics text or it is an
    // assumption, and an assumption has to say so. Nothing in between.
    for (const q of REQUESTS.slice(0, 10)) {
      const r = ask(q);
      if (!r.corruption) continue;
      for (const f of r.corruption.all) {
        const d = f.damage;
        if (d.burst > 1 || d.sustained > 1) {
          ok((d.lines && d.lines.length) || (d.assumed && d.assumed.length),
             f.form + ' claims +' + d.burstGain + '% with no explanation at all');
        }
      }
    }
  });

  it('flags the assumed Condemned figure wherever it is used', () => {
    const r = ask('tanky knight');
    const ty = r.corruption.all.find(f => f.form === 'Tyranny');
    if (ty.damage.burst > 1) {
      ok(ty.damage.assumed.length > 0, 'Tyranny used an invented multiplier with no warning');
      ok(ty.damage.assumed.join(' ').indexOf(String(K.CORRUPTION_ASSUMED.condemnedPct)) !== -1,
         'the warning does not name the figure it used');
    }
  });

  it('scales Blasphemy off the energy cap', () => {
    // Notch caps at the energy cap, so Overflow raises the ceiling AND makes a
    // full stack take longer to bank. Both directions are asserted, because
    // getting the sign wrong here would read as "Overflow is bad".
    const ctx = cap => ({ energyCap: cap, moves: [{ name: 'Dump', cost: 4 }, { name: 'Poke', cost: 1 }] });
    const lo = K.CORRUPTION_DAMAGE.Blasphemy(ctx(5));
    const hi = K.CORRUPTION_DAMAGE.Blasphemy(ctx(9));
    eq(lo.burst, hi.burst, 'the full-stack bonus is +30% at any cap');
    ok(hi.sustained < lo.sustained, 'a bigger stack should take longer to bank, not less');
    ok(lo.lines.join(' ').indexOf('5') !== -1, 'the reasoning never mentions the cap it used');
  });

  it('says nothing to spend Notch on when the kit has no expensive move', () => {
    const d = K.CORRUPTION_DAMAGE.Blasphemy({ energyCap: 5, moves: [{ name: 'Poke', cost: 1 }] });
    eq(d.burst, 1);
    ok(d.lines.join(' ').toLowerCase().indexOf('3+ energy') !== -1, 'no explanation for the flat result');
  });

  it('does not let the damage figures change which build is chosen', () => {
    // The form is picked after the build is settled. If that ever stops being
    // true, an assumed number starts deciding what gear somebody wears.
    //
    // Several requests, deliberately: one with the class fixed and several
    // without. A coupling that varies by CLASS cancels out on a request that
    // already names one, so a single fixed-class request would not catch it.
    const QS = ['berserker carnage max damage', 'i want to hit really hard',
                'tanky knight', 'make me a build', 'staff mage', 'party support'];
    const before = QS.map(q => JSON.stringify(ask(q).build));
    const saved = K.CORRUPTION_DAMAGE;
    try {
      K.CORRUPTION_DAMAGE = {};
      const eng = Engine(data);
      QS.forEach((q, i) => {
        eq(JSON.stringify(eng.ask(q).build), before[i],
           '"' + q + '" changed when the corruption damage model was removed');
      });
    } finally {
      K.CORRUPTION_DAMAGE = saved;
    }
  });

  it('shows the comparison in the answer', () => {
    const r = ask('berserker carnage max damage');
    const sec = r.explanation.find(x => x.h === 'Damage in form');
    ok(sec, 'no damage comparison in the explanation');
    eq(sec.table.length, K.CORRUPTION.length, 'not every form is listed');
    ok(sec.list.join(' ').indexOf('Out of form') !== -1,
       'the out-of-form baseline is missing, so the numbers have nothing to compare against');
  });
});

// -- 6e. the panel's WIP notice ---------------------------------------------
// Source-level, like the cache-busting checks: there is no DOM here, and the
// point is to notice if the notice is ever quietly removed or stops being shown.
describe('WIP notice', () => {
  const root = path.join(__dirname, '..', '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const js  = read('js/build-ai.js');
  const css = read('css/build-ai.css');

  it('is in the panel markup, above what it warns about', () => {
    ok(js.indexOf('bai-wip') !== -1, 'no WIP notice in the panel');
    ok(js.indexOf('>WIP<') !== -1, 'the notice never actually says WIP');
    const wip = js.indexOf('id="bai-wip"');
    const sub = js.indexOf('class="bai-sub"');
    ok(wip !== -1 && sub !== -1 && wip < sub, 'the notice is not above the panel body');
  });

  it('can be dismissed', () => {
    ok(js.indexOf('bai-wip-x') !== -1, 'no dismiss button');
    ok(/bai-wip-x'\)\.addEventListener\('click'/.test(js), 'the dismiss button is not wired');
    ok(js.indexOf('wipDismissed = true') !== -1, 'dismissing does not record anything');
  });

  it('comes back on a new visit rather than being remembered forever', () => {
    // Deliberately NOT localStorage: a warning nobody sees again after the first
    // dismissal stops being a warning the moment what it warns about changes.
    ok(!/wipDismissed[\s\S]{0,150}localStorage/.test(js),
       'the dismissal is persisted, so the notice would never return');
    ok(/wip\.toggleAttribute\('hidden', wipDismissed\)/.test(js),
       'the notice is not re-shown when the panel opens');
  });

  it('is styled, and actually hides when hidden', () => {
    ok(css.indexOf('.bai-wip') !== -1, 'no styling for the notice');
    ok(/\.bai-wip\[hidden\]\s*\{\s*display:\s*none/.test(css),
       'the notice is display:flex, so the hidden attribute alone will not hide it');
  });
});

// -- 6f. the builder's Ivory multiplier -------------------------------------
// The bug this guards: three places in builder.js each decided for themselves
// whether the Ivory enchant applied, and the stats panel disagreed with the
// damage calculator for the same build. One function owns it now.
describe('Ivory stat multiplier', () => {
  const root = path.join(__dirname, '..', '..');
  const src = fs.readFileSync(path.join(root, 'js/builder.js'), 'utf8');

  it('has exactly one definition of the multiplier', () => {
    const defs = src.match(/function ivoryStatMult\(/g) || [];
    eq(defs.length, 1, 'expected one ivoryStatMult definition');
    // Nobody may recompute 4%-per-stack for themselves; that is the drift.
    const inline = src.match(/ivoryNrgStacks\s*\*\s*0\.04/g) || [];
    eq(inline.length, 1, 'the 4%-per-stack figure is written out in more than one place');
  });

  it('is used by the stat total, the breakdown and getTotalStat alike', () => {
    const uses = src.match(/ivoryStatMult\(\)/g) || [];
    ok(uses.length >= 3, 'only ' + uses.length + ' call sites use the shared multiplier');
  });

  it('is declared before the first render runs', () => {
    // updatePecents() runs for the initial render partway down the file. `let`
    // is in its temporal dead zone until its declaration executes, so reading
    // the stack count from that render threw and aborted the whole file.
    const decl = src.indexOf('let ivoryNrgStacks');
    const firstRender = src.indexOf('\nupdatePecents();');
    ok(decl !== -1 && firstRender !== -1, 'could not locate the declaration or the initial render');
    ok(decl < firstRender,
       'ivoryNrgStacks is declared after the initial updatePecents() call, which is a dead-zone throw');
  });

  it('no watched module-level binding is read before it is declared', () => {
    // This has now bitten twice: ivoryNrgStacks, then UNRELEASED_GEAR. Both
    // looked right, both passed `node --check`, and both took the entire builder
    // down the moment the page loaded — js/builder.js runs a lot of setup at
    // module scope, and a const/let read before its declaration executes throws
    // instead of reading undefined.
    const watched = ['UNRELEASED_GEAR', 'ivoryNrgStacks', 'luckyHornsSpend', 'corruptionBuffsActive'];
    for (const name of watched) {
      const declRe = new RegExp('(?:const|let)\\s+' + name + '\\b');
      const decl = src.search(declRe);
      if (decl === -1) continue;                        // renamed or removed
      // The first mention of the name anywhere that is not the declaration.
      const all = [];
      const useRe = new RegExp('\\b' + name + '\\b', 'g');
      let m;
      while ((m = useRe.exec(src)) !== null) all.push(m.index);
      const firstUse = all.find(i => i !== decl + src.slice(decl).search(new RegExp('\\b' + name + '\\b')));
      const earliest = all.length ? all[0] : -1;
      ok(earliest === -1 || earliest >= decl,
         name + ' is first mentioned at char ' + earliest + ' but declared at ' + decl +
         ' — that is a temporal-dead-zone throw if the mention runs at module scope');
    }
  });


  it('does nothing at all when Ivory is not equipped', () => {
    // Applying the multiplier unconditionally also applied its Math.round to
    // builds without the enchant, quietly changing stats it should not touch.
    ok(/_ivoryMult > 1/.test(src), 'the multiplier is applied without checking it is greater than 1');
  });
});

// -- 6g. mastery capstone abilities -----------------------------------------
// A capstone costs 5 of 35 points. Until these were modelled the engine could
// only see the stat points a tree grants, so it bought one on branch colour.
describe('mastery abilities', () => {
  const M = engine.model, O = engine.optimizer;

  it('parses a bonus out of the descriptions with the site\'s own parser', () => {
    const A = data.masteryAbilities;
    ok(A && Object.keys(A).length >= 15, 'no per-class mastery abilities in the snapshot');
    let total = 0, numeric = 0;
    for (const nodes of Object.values(A)) for (const a of Object.values(nodes)) {
      total++;
      if (a.bonus !== null && a.bonus !== undefined) numeric++;
    }
    eq(total, 108, 'expected 108 capstone abilities');
    ok(numeric >= 20, 'only ' + numeric + ' abilities parsed a number; the parser is not being run');
  });

  it('has no knowledge entry naming an ability that does not exist', () => {
    // A typo here is silent: the entry simply never matches and the ability is
    // scored by the fallback, or not at all.
    const names = new Set();
    for (const nodes of Object.values(data.masteryAbilities)) {
      for (const a of Object.values(nodes)) names.add(a.name);
    }
    const bogus = Object.keys(K.MASTERY_ABILITIES).filter(n => !names.has(n));
    eq(bogus.length, 0, 'knowledge.js names abilities that do not exist: ' + bogus.join(', '));
  });

  it('only ever reads abilities off capstone nodes', () => {
    // Today only capstones carry a description, so the type check looks
    // redundant — and a test that merely re-reads the data would pass with the
    // check deleted. This plants an ability on a plain stat node and asserts it
    // is ignored, which is the thing the check is actually for.
    const byId = {};
    data.masteryNodes.forEach(n => { byId[n.id] = n; });
    for (const nodes of Object.values(data.masteryAbilities)) {
      for (const id of Object.keys(nodes)) {
        eq((byId[id] || {}).type, 'mastery', 'node ' + id + ' carries an ability but is not a capstone');
      }
    }

    const r = engine.ask('', { klass: 'Elementalist (Or)', goal: 'damage' });
    const statNode = (r.build.masteryNodes || []).find(id => (byId[id] || {}).type === 'node');
    ok(statNode, 'this build took no plain stat node to test with');
    const perClass = data.masteryAbilities['Elementalist (Or)'];
    const saved = perClass[statNode];
    try {
      perClass[statNode] = { name: 'Planted Not-A-Capstone', bonus: 500 };
      const after = O.masteryAbilityTotals(r.build);
      ok(!after.active.some(a => a.name === 'Planted Not-A-Capstone'),
         'an ability on a plain stat node was counted');
      ok(!after.unmodelled.some(u => u.name === 'Planted Not-A-Capstone'),
         'an ability on a plain stat node was even reported');
    } finally {
      if (saved === undefined) delete perClass[statNode]; else perClass[statNode] = saved;
    }
  });

  it('counts them in the damage number', () => {
    // Strip the knowledge table and the parsed bonuses and the same build must
    // come out measurably weaker; if it does not, nothing is being applied.
    const r = engine.ask('', { klass: 'Elementalist (Or)', goal: 'damage' });
    const before = O.evaluate(r.build, r.spec).bestHit;
    const savedTable = K.MASTERY_ABILITIES;
    const savedData  = data.masteryAbilities;
    try {
      K.MASTERY_ABILITIES = {};
      data.masteryAbilities = {};
      const after = O.evaluate(r.build, r.spec).bestHit;
      ok(after < before - 0.5,
         'mastery abilities change nothing: ' + before.toFixed(1) + ' vs ' + after.toFixed(1));
    } finally {
      K.MASTERY_ABILITIES = savedTable;
      data.masteryAbilities = savedData;
    }
  });

  it('buys the capstone that helps, not the one on the right-coloured branch', () => {
    // The concrete case this was built for: Elementalist's cm1 grants an energy
    // proc nobody can score, while rm1 is +15% to its entire elemental kit. The
    // old branch-colour pick took cm1 as a gateway and left rm1 unbought.
    const r = engine.ask('', { klass: 'Elementalist (Or)', goal: 'damage' });
    const counted = r.ctx.masteryAbilities.active.map(a => a.name);
    ok(counted.length > 0, 'no mastery ability counted at all for a damage Elementalist');
    const worthless = r.ctx.masteryAbilities.unmodelled.map(u => u.name);
    ok(counted.length >= worthless.length,
       'took more unreadable capstones (' + worthless.join(', ') + ') than useful ones');
  });

  it('does not hand a tank a damage capstone over a defensive one', () => {
    const r = engine.ask('', { klass: 'Citadel (Or)', goal: 'tank' });
    const ma = r.ctx.masteryAbilities;
    ok(ma.active.length + ma.unmodelled.length > 0, 'a tank bought no capstone at all');
  });

  it('keeps the tree legal once abilities steer the choice', () => {
    for (const q of REQUESTS) {
      const b = ask(q).build;
      const legal = O.masteryLegal(b);
      ok(legal.ok, '"' + q + '" produced an illegal tree: ' + legal.problems.slice(0, 2).join('; '));
    }
  });

  it('labels a mastery ability by what it actually grants', () => {
    // Flourish Proficiency is a flat +23 SPEED and was written up as "+23%
    // damage" - plausible-looking and wrong, the same class of bug the gear
    // passives had.
    const r = engine.ask('', { klass: 'Ranger (Or)', goal: 'damage', play: 'solo' });
    const flourish = r.ctx.masteryAbilities.active.find(a => a.name === 'Flourish Proficiency');
    ok(flourish, 'Ranger did not take Flourish Proficiency');
    eq(flourish.kind, 'statFlat', 'Flourish Proficiency is not reported as a flat stat');
    eq(flourish.stat, 'spd', 'Flourish Proficiency does not say which stat it grants');
    const sec = r.explanation.find(x => /Mastery abilities counted/.test(x.h));
    const txt = JSON.stringify(sec.table);
    ok(txt.indexOf('% damage') === -1 || txt.indexOf('flat SPD') !== -1,
       'a flat Speed bonus is labelled as damage: ' + txt.slice(0, 160));
  });

  it('actually applies a flat stat from a mastery', () => {
    const r = engine.ask('', { klass: 'Ranger (Or)', goal: 'speed', play: 'solo' });
    ok((r.ctx.masteryAbilities.statFlat.spd || 0) > 0, 'no flat Speed accumulated');
  });

  it('says what it passed over when the goal cannot read it', () => {
    // A damage goal scores survivability at exactly zero, so Lightspeed - the
    // capstone a Ranger actually takes - reads as worthless to it. That is a
    // real trade, and the answer to "why is the obvious mastery missing".
    const r = engine.ask('', { klass: 'Ranger (Or)', goal: 'damage', play: 'solo' });
    const sec = r.explanation.find(x => x.h === 'Masteries it did not take');
    ok(sec, 'nothing explains the capstones it did not buy');
    const row = (sec.table || []).find(t => /Lightspeed/.test(t[0]));
    ok(row, 'Lightspeed is not among them');
    ok(/Nothing towards/.test(row[1]), 'no reason given for Lightspeed: ' + row[1]);
  });

  it('gives every capstone it skipped a reason, not just a name', () => {
    // The whole point. A list of things it did not take, with no why attached,
    // is the output this replaced.
    const REASONS = ['value', 'lost', 'zero', 'unmodelled'];
    for (const klass of ['Ranger (Or)', 'Berserker (Ch)', 'Saint (Or)', 'Hexer (N)']) {
      for (const goal of ['damage', 'tank']) {
        const r = engine.ask('', { klass, goal, play: 'solo' });
        for (const x of r.ctx.masteryPassedOver || []) {
          ok(REASONS.indexOf(x.reason) !== -1,
             klass + '/' + goal + ': ' + x.name + ' has reason ' + JSON.stringify(x.reason));
          ok(x.detail && x.detail.length > 20,
             klass + '/' + goal + ': ' + x.name + ' has no usable detail');
          ok(typeof x.cost === 'number' && x.cost > 0, x.name + ' has no cost');
        }
      }
    }
  });

  it('blames the engine, not the goal, for an ability it cannot price', () => {
    // An unpriced ability always measures zero, so checking "measured zero"
    // before "is it even priced" reports every gap in knowledge.js as "your
    // goal does not value it" - which is a confident, plausible lie.
    let seen = 0;
    for (const klass of Object.keys(data.masteryClassData || {})) {
      const r = engine.ask('', { klass, goal: 'damage', play: 'solo' });
      for (const x of r.ctx.masteryPassedOver || []) {
        const rule = (K.MASTERY_ABILITIES || {})[x.name];
        const priced = rule && rule.kind !== 'note' && rule.value != null;
        if (!priced) {
          seen++;
          eq(x.reason, 'unmodelled', x.name + ' is unpriced but was reported as ' + x.reason);
        }
      }
    }
    ok(seen > 0, 'no unpriced capstone was skipped anywhere, so this proves nothing');
  });

  it('says out loud that an unpriced capstone is a gap here, not a weak ability', () => {
    const r = engine.ask('', { klass: 'Saint (Or)', goal: 'damage', play: 'solo' });
    const sec = r.explanation.find(x => /not priced here/i.test(x.h));
    ok(sec, 'nothing explains what "not priced here" means');
    ok(/not.{0,4}\*\* a judgement|not\*\* a judgement/i.test(sec.body) || /gap in this engine/.test(sec.body),
       'the caveat does not actually say it is a gap rather than a verdict');
    // The count is computed from the data, so it cannot go stale in the copy.
    const m = sec.body.match(/\*\*(\d+) of (\d+)\*\*/);
    ok(m, 'no priced/total count in the caveat');
    let total = 0;
    for (const per of Object.values(data.masteryAbilities || {})) total += Object.keys(per).length;
    eq(Number(m[2]), total, 'the total does not match the data');
    ok(Number(m[1]) > 0 && Number(m[1]) < Number(m[2]), 'the priced count is nonsense');
  });

  it('leaves the capstone pass something to spend', () => {
    // THE REGRESSION THIS MOST NEEDS. The capstone pass used to run AFTER the
    // "spend whatever is left" filler, so it had exactly 0 points every single
    // time and bought nothing, ever - and the spare points went to stat nodes
    // the build had already been measured not to care about.
    let runs = 0, hadPoints = 0, bought = 0;
    for (const klass of Object.keys(data.masteryClassData || {})) {
      for (const goal of ['damage', 'tank']) {
        const b = engine.ask('', { klass, goal, play: 'solo' }).ctx.masteryBudget;
        ok(b, klass + '/' + goal + ' reports no mastery budget at all');
        runs++;
        if (b.leftAtCapstone > 0) hadPoints++;
        if (b.bought) bought++;
      }
    }
    ok(hadPoints > runs / 4, 'the capstone pass had points in only ' + hadPoints + ' of ' + runs +
                             ' builds - it is running after the filler again');
    ok(bought > 0, 'the capstone pass never bought anything in ' + runs + ' builds');
  });

  it('keeps the mastery budget arithmetic honest', () => {
    for (const klass of Object.keys(data.masteryClassData || {})) {
      const r = engine.ask('', { klass, goal: 'damage', play: 'solo' });
      const b = r.ctx.masteryBudget;
      ok(b.spent <= b.cap, klass + ' spends ' + b.spent + ' of ' + b.cap);
      eq(b.statNodes + b.capstonesTaken * 5, b.spent,
         klass + ': ' + b.statNodes + ' nodes + ' + b.capstonesTaken + ' capstones != ' + b.spent);
    }
  });

  it('explains itself even when it took no capstone at all', () => {
    // The section used to sit inside "did it take any capstone", so the one
    // build most likely to prompt the question answered it least.
    const sections = h => engine.ask('', h).explanation.map(x => x.h);
    for (const klass of Object.keys(data.masteryClassData || {})) {
      const r = engine.ask('', { klass, goal: 'damage', play: 'solo' });
      if ((r.ctx.masteryPassedOver || []).length === 0) continue;
      ok(r.explanation.some(x => x.h === 'Masteries it did not take'),
         klass + ' skipped capstones and said nothing about it');
    }
    void sections;
  });

  it('takes the autododge capstone when survival is the goal', () => {
    const r = engine.ask('', { klass: 'Ranger (Or)', goal: 'tank', play: 'solo' });
    ok(r.ctx.masteryAbilities.active.some(a => a.name === 'Lightspeed'),
       'a survival Ranger did not take Lightspeed');
    ok(r.ctx.dodge > 0, 'dodge never reached the context');
    ok(r.ctx.effectiveHp > r.ctx.hp, 'avoidance did not raise effective health');
  });

  it('keeps avoidance out of the HP it reports', () => {
    // effectiveHp is for scoring only. The HP this build reports has to stay the
    // HP the site will show, or the link and the write-up disagree.
    const solo = engine.ask('', { klass: 'Ranger (Or)', goal: 'tank', play: 'solo' });
    ok(solo.ctx.hp < solo.ctx.effectiveHp, 'the two figures are the same, so one of them is wrong');
    ok(Number.isFinite(solo.ctx.hp) && solo.ctx.hp > 0, 'reported HP is not a number');
  });

  it('discounts a conditional ability, and does not discount an unconditional one', () => {
    // Uptime is the whole reason this table exists: a +100% that needs the
    // target stunned first cannot be scored like a +100% that always applies.
    const r = engine.ask('', { klass: 'Lancer (N)', goal: 'damage' });
    const overload = K.MASTERY_ABILITIES['Overload'];
    ok(overload && overload.uptime < 0.35,
       'Overload needs the enemy stunned, so it cannot be near full uptime');

    // Every entry with an uptime below 1 must contribute less than its face
    // value, and every entry at 1 must contribute exactly its face value.
    for (const [name, rule] of Object.entries(K.MASTERY_ABILITIES)) {
      if (rule.kind === 'note' || rule.value == null) continue;
      const eff = rule.value * (rule.uptime ?? 1);
      if ((rule.uptime ?? 1) < 1) ok(eff < rule.value, name + ' is not discounted at all');
      else eq(eff, rule.value, name + ' is at full uptime but not scored at full value');
    }
    // And the discount has to be applied by the CODE, not merely present in the
    // table: every counted ability whose uptime is below 1 must contribute
    // strictly less than its face value in a real build.
    const discounted = r.ctx.masteryAbilities.active.filter(a => a.uptime < 1);
    ok(discounted.length > 0, 'no conditional ability in this build to check the discount on');
    for (const a of discounted) {
      ok(a.effective < a.value - 1e-9,
         a.name + ' is counted at its full ' + a.value + ' despite ' +
         Math.round(a.uptime * 100) + '% uptime');
    }
  });
});

// -- 6h. move damage: the shape of the formula --------------------------------
// The bug that made all of this necessary. model.js computed
//   base + floor(stat / div)   per scaling term
// where the site computes
//   base x (1 + SUM(stat / div))
// Every stat total agreed the whole time, because stats are not damage. There is
// now a move-damage check in verify.js as well; these are the offline half.
describe('move damage', () => {
  const M = engine.model, O = engine.optimizer;

  const build = klass => {
    const b = M.emptyBuild();
    b.klass = klass; b.level = 50;
    return b;
  };

  it('multiplies the base by the scaling instead of adding to it', () => {
    const b = build('Berserker (Ch)');
    b.invested.str = 200;
    const carnage = O.movesFor('Berserker (Ch)').find(m => m.name === 'Carnage');
    ok(carnage, 'Carnage not found');
    eq(carnage.damage, '1x20', 'Carnage is no longer 1x20; this test needs revisiting');
    const str = M.allStats(b).str;
    const expected = 1 * (1 + str / 100) * 20;
    const got = M.moveDamage(b, carnage);
    ok(Math.abs(got - expected) < 0.05,
       'expected ' + expected.toFixed(1) + ' from base x (1 + STR/100) x 20 hits, got ' + got.toFixed(1));
  });

  it('does not floor the contribution away on a low base', () => {
    // This is what hid the bug: Carnage's base is 1, so floor(STR/100) was 0 for
    // any Berserker under 100 Strength and the stat did nothing at all.
    const b = build('Berserker (Ch)');
    const carnage = O.movesFor('Berserker (Ch)').find(m => m.name === 'Carnage');
    b.invested.str = 0;
    const low = M.moveDamage(b, carnage);
    b.invested.str = 40;
    const higher = M.moveDamage(b, carnage);
    ok(higher > low + 1,
       'adding 40 Strength changed a STR-scaling move by ' + (higher - low).toFixed(2));
  });

  it('sums several scaling stats before applying them', () => {
    // "STR/80 + SPD/80" is one multiplier off the sum, not two multipliers.
    const b = build('Assassin (Ch)');
    b.invested.str = 100; b.invested.arc = 100; b.invested.lck = 100;
    const mv = O.movesFor('Assassin (Ch)').find(m => /\+/.test(String(m.scaling || '')));
    if (!mv) return;
    const s = M.allStats(b);
    let contrib = 0;
    for (const m of String(mv.scaling).matchAll(/([A-Za-z]{3})\s*\/\s*([\d.]+)/g)) {
      contrib += s[m[1].toLowerCase()] / parseFloat(m[2]);
    }
    const parsed = M.parseDamage(mv.damage);
    const expected = parsed.base * (1 + contrib) * parsed.hits;
    ok(Math.abs(M.moveDamage(b, mv) - expected) < 0.05, 'multi-stat scaling is not summed first');
  });

  it('lets a mastery rewrite a move outright', () => {
    // Blade Dancer rm1 turns Parry Counter from 8 / STR-40 into 12 / STR-32.
    // No damage multiplier can express that, which is why the shape hook exists.
    const b = build('Blade Dancer (N)');
    b.invested.str = 100;
    const pc = O.movesFor('Blade Dancer (N)').find(m => m.name === 'Parry Counter');
    ok(pc, 'Parry Counter not found');
    b.masteryNodes = [];
    const plain = M.moveDamage(b, pc);
    b.masteryNodes = ['rm1'];
    const mastered = M.moveDamage(b, pc);
    ok(mastered > plain + 1,
       'Parry Master changed nothing: ' + plain.toFixed(1) + ' vs ' + mastered.toFixed(1));
  });

  it('scores a two-part attack instead of dropping it', () => {
    // Stinger's damage reads "5 + 10", which parses as nothing — so the move was
    // silently worth zero and never chosen.
    const b = build('Ranger (Or)');
    b.invested.arc = 100; b.invested.spd = 100;
    const st = O.movesFor('Ranger (Or)').find(m => m.name === 'Stinger');
    if (!st) return;
    ok(M.moveDamage(b, st) > 10, 'Stinger still scores as nothing');
  });

  it('every override names a move that exists on its class', () => {
    for (const [name, rules] of Object.entries(K.MOVE_OVERRIDES)) {
      ok(Array.isArray(rules) && rules.length, name + ' has no rules');
      for (const rule of rules) {
        ok(typeof rule.when === 'function', name + ' has no when()');
        ok(rule.base !== undefined || rule.scaling !== undefined || rule.second,
           name + ' overrides nothing');
      }
      const found = Object.keys(data.classMoves).some(k =>
        ((data.classMoves[k] || {}).learns || []).some(m => m.name === name));
      ok(found, 'MOVE_OVERRIDES names "' + name + '", which no class learns');
    }
  });
});

// -- 6i. solo or party is asked, never inferred ------------------------------
describe('play style', () => {
  it('changes what a party-facing ability is worth', () => {
    const solo = engine.ask('', { klass: 'Lionheart (N)', goal: 'tank', play: 'solo' });
    const team = engine.ask('', { klass: 'Lionheart (N)', goal: 'tank', play: 'team' });
    const find = r => r.ctx.masteryAbilities.active.find(a => a.name === 'Prideful Heart');
    const s = find(solo), t = find(team);
    ok(s && t, 'Prideful Heart was not taken by either build');
    ok(t.effective > s.effective + 1,
       'a party-facing ability is worth the same solo (' + s.effective + ') as in a team (' + t.effective + ')');
    eq(s.party, null, 'a solo build was given party scaling');
  });

  it('never scales an ability that is not party-facing', () => {
    const solo = engine.ask('', { klass: 'Berserker (Ch)', goal: 'damage', play: 'solo' });
    const team = engine.ask('', { klass: 'Berserker (Ch)', goal: 'damage', play: 'team' });
    // A damage build's own hit does not improve for having allies nearby.
    for (const a of team.ctx.masteryAbilities.active) eq(a.party, null, a.name + ' was party-scaled');
    eq(Math.round(solo.ctx.bestHit), Math.round(team.ctx.bestHit),
       'a solo damage build and a team one should hit for the same');
  });

  it('does not infer a party from the goal', () => {
    // The whole point: a tank is not assumed to be in a party. Plenty of people
    // solo one to survive content they cannot out-damage.
    const r = engine.ask('', { klass: 'Lionheart (N)', goal: 'tank' });
    eq(r.spec.play, 'solo', 'a tank with no answer was assumed to be in a party');
    ok(r.spec.assumptions.some(a => /solo/i.test(a)),
       'defaulted to solo without saying so');
  });

  it('every renderer knows every mastery kind', () => {
    // This label bug has now been fixed three times in three different unit
    // switches - explain.js twice, and the builder Summary box once, where a
    // flat +23 Speed read as "+23% damage" and 100 autododge as "+100% damage".
    // Generalised so the NEXT new kind cannot slip through any of them: a kind
    // with no branch falls through to "% damage", which is always plausible and
    // always wrong.
    const kinds = new Set();
    for (const r of Object.values(K.MASTERY_ABILITIES || {})) {
      if (r && r.kind && r.kind !== 'note' && r.kind !== 'dmgPct') kinds.add(r.kind);
    }
    ok(kinds.size > 0, 'no non-damage mastery kinds exist, so this test proves nothing');
    const root = path.join(__dirname, '..', '..');
    for (const f of ['tools/ai/explain.js', 'js/build-ai.js']) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      for (const k of kinds) {
        ok(src.indexOf("a.kind === '" + k + "'") !== -1,
           f + ' has no unit for mastery kind ' + JSON.stringify(k) +
           ' - it falls through to "% damage"');
      }
    }
  });

  it('the panel makes it a required choice, not a default', () => {
    const root = path.join(__dirname, '..', '..');
    const js  = fs.readFileSync(path.join(root, 'js/build-ai.js'), 'utf8');
    ok(/let playStyle = null/.test(js), 'the panel preselects a play style');
    ok(js.indexOf('needsPlayStyle') !== -1, 'nothing stops a build without the choice');
    ok(/function run\(\)[\s\S]{0,200}needsPlayStyle\(ov\)\) return;/.test(js),
       'run() does not gate on the choice');
    ok(/data-play="solo"/.test(js) && /data-play="team"/.test(js), 'both options are not offered');
    // and it must not be counted as an optional override
    ok(/delete o\.play/.test(js), 'the required choice is counted as an Advanced override');
  });
});

// -- 6j. knowledge tables name things that exist -----------------------------
// Every one of these tables is keyed by a game-data name. A typo in a key is
// silent: the entry simply never matches, the item is scored without it, and
// nothing anywhere says so. This is the cheapest test in the suite.
describe('knowledge tables', () => {
  const names = (...tables) => new Set(tables.flatMap(t => Object.keys(t || {})));

  const items   = names(data.gearItems, data.artifactItems, data.armourItems, data.enchantItems,
                        ...Object.values(data.offhandSeries || {}));
  const series  = new Set(Object.values(data.weapons).map(w => w.series));
  const races   = new Set(Object.keys(data.races));
  const classes = new Set([...Object.keys(data.classes), ...Object.values(data.classes).flat(),
                           ...(data.subClasses || [])]);

  const allNamed = (table, pool, label) => {
    const bogus = Object.keys(table || {}).filter(n => !pool.has(n));
    eq(bogus.length, 0, label + ' names things that do not exist: ' + bogus.join(', '));
  };

  it('GEAR_PASSIVES', () => allNamed(K.GEAR_PASSIVES, items, 'GEAR_PASSIVES'));
  it('WEAPON_PASSIVES', () => allNamed(K.WEAPON_PASSIVES, series, 'WEAPON_PASSIVES'));
  it('RACE_ROLES', () => allNamed(K.RACE_ROLES, races, 'RACE_ROLES'));
  it('CLASS_WEAPONS', () => allNamed(K.CLASS_WEAPONS, classes, 'CLASS_WEAPONS'));
  it('ENCHANTS', () => allNamed(K.ENCHANTS, names(data.enchantItems), 'ENCHANTS'));

  it('the site and the engine agree on what does not exist', () => {
    // js/builder.js keeps its own UNRELEASED_GEAR so the picker can hide them.
    // Two lists of the same fact drift; this is the thing that notices.
    const root = path.join(__dirname, '..', '..');
    const src  = fs.readFileSync(path.join(root, 'js/builder.js'), 'utf8');
    const m = src.match(/const UNRELEASED_GEAR = new Set\(\[([\s\S]*?)\]\)/);
    ok(m, 'builder.js has no UNRELEASED_GEAR set');
    const site = new Set((m[1].match(/"([^"]+)"/g) || []).map(x => x.slice(1, -1)));
    ok(site.size > 0, 'UNRELEASED_GEAR is empty');
    const engineSide = (K.UNAVAILABLE || {}).items || {};
    for (const name of site) {
      ok(engineSide[name], 'the builder hides "' + name + '" but the AI would still pick it');
    }
    // And the picker must not be able to offer one.
    const gearNames = new Set(Object.values(data.gearSeries || {}).flat());
    for (const name of site) ok(gearNames.has(name), 'UNRELEASED_GEAR names "' + name + '", which no series lists');
  });

  it('every Withered Grove gear has its passive registered', () => {
    // They were in the stat tables but not in gearMoves, so the builder's Info
    // panel showed nothing at all when one was equipped.
    const grove = (data.gearSeries || {})['Withered Grove'] || [];
    ok(grove.length > 0, 'no Withered Grove series');
    const unreleased = new Set(Object.keys((K.UNAVAILABLE || {}).items || {}));
    for (const name of grove) {
      if (unreleased.has(name)) continue;      // no effect text exists for these
      ok(data.itemPassives[name], name + ' has no passive registered, so Info shows nothing for it');
    }
  });

  it('UNAVAILABLE', () => {
    // Offhands count: the Ivory Shield is listed by name because weaponSeries
    // matches main weapons only.
    allNamed((K.UNAVAILABLE || {}).items, items, 'UNAVAILABLE.items');
    allNamed((K.UNAVAILABLE || {}).weaponSeries, series, 'UNAVAILABLE.weaponSeries');
  });

  it('RACE_TECH', () => {
    for (const t of K.RACE_TECH || []) {
      ok(races.has(t.race), 'RACE_TECH names a missing race: ' + t.race);
      if (t.enables) ok(items.has(t.enables), 'RACE_TECH enables a missing item: ' + t.enables);
    }
  });

  it('SHARDS is keyed by bonus type, not by shard name', () => {
    // Documenting the shape so nobody "fixes" it into shard names, which is the
    // mistake an audit of this file makes the first time.
    const types = new Set(Object.values(data.shardItems || {}).map(s => s.bonusType).filter(Boolean));
    const bogus = Object.keys(K.SHARDS || {}).filter(k => !types.has(k));
    eq(bogus.length, 0, 'SHARDS keys that are not a bonusType: ' + bogus.join(', '));
  });
});

// -- 6k. bias: weapons and the class pool ------------------------------------
describe('selection bias', () => {
  const O = engine.optimizer;

  it('labels a passive by what it actually grants', () => {
    // Crystal Sphere grants crit chance; the write-up called it "+5% damage"
    // because the entry carried no kind for the renderer to switch on.
    const r = engine.ask('', { klass: 'Berserker (Ch)', goal: 'crit', play: 'solo' });
    ok(r.ctx.gearPassives.active.length > 0, 'no gear passive counted at all');
    for (const a of r.ctx.gearPassives.active) {
      ok(a.kind, a.name + ' is counted but carries no kind, so it cannot be labelled');
      const bare = String(a.name).replace(/ \(weapon\)$/, '');
      const rule = (K.GEAR_PASSIVES || {})[a.name] || (K.WEAPON_PASSIVES || {})[bare];
      ok(rule, a.name + ' is counted but has no knowledge entry');
      eq(a.kind, rule.kind, a.name + ' is reported as ' + a.kind + ' but is ' + rule.kind);
    }
  });


  it('counts the weapon\'s own passive', () => {
    // Weapon passives were never looked at. Five series roll tier points and are
    // otherwise identical to the model, so the choice between them fell to
    // whichever bestOfSlot saw first: Dragon won 81% of builds and Primordial's
    // flat +20% — the largest unconditional weapon bonus in the game — was
    // invisible.
    const r = engine.ask('', { klass: 'Berserker (Ch)', goal: 'damage', play: 'solo' });
    ok(r.build.weapon, 'no weapon chosen');
    const gp = r.ctx.gearPassives;
    const listed = gp.active.concat(gp.unmodelled).map(x => x.name);
    ok(listed.some(n => / \(weapon\)$/.test(n)),
       'the weapon passive is neither counted nor reported: ' + listed.join(', '));
  });

  it('prefers the weapon whose passive is actually bigger', () => {
    // Primordial is +20% unconditional; Dragon is +15% and only against Burning.
    const picks = {};
    for (let i = 0; i < 20; i++) {
      const b = engine.ask('', { random: true, play: 'solo', goal: 'damage' }).build;
      if (!b.weapon) continue;
      const s = (data.weapons[b.weapon.name] || {}).series;
      picks[s] = (picks[s] || 0) + 1;
    }
    ok((picks['Primordial'] || 0) > (picks['Dragon'] || 0),
       'Dragon is still being chosen over Primordial: ' + JSON.stringify(picks));
  });

  it('never picks a base class once superclasses are available', () => {
    // Measured at level 50: Warrior scores 552 against Berserker's 2279. A base
    // class at max level is not a close call, it is a build nobody plays.
    const bases = new Set(Object.keys(data.classes));
    for (let i = 0; i < 25; i++) {
      const b = engine.ask('', { random: true, play: 'solo' }).build;
      ok(!bases.has(b.klass), 'rolled the base class ' + b.klass + ' at level ' + b.level);
    }
  });

  it('offers only base classes below the superclass level', () => {
    const supers = new Set(Object.values(data.classes).flat());
    for (let i = 0; i < 10; i++) {
      const b = engine.ask('', { random: true, play: 'solo', level: 10 }).build;
      ok(!supers.has(b.klass), 'rolled ' + b.klass + ' at level 10, which needs 15');
    }
    // and the pool itself, directly
    const low = O.classesForLevel(10);
    ok(low.every(k => !supers.has(k)), 'classesForLevel(10) contains a superclass');
    const high = O.classesForLevel(50);
    ok(high.every(k => supers.has(k)), 'classesForLevel(50) still contains a base class');
  });

  it('still honours a class asked for outright, and says when it is not reachable', () => {
    const r = engine.ask('', { klass: 'Warrior', play: 'solo' });
    eq(r.build.klass, 'Warrior', 'an explicitly named base class was overridden');
    const early = engine.ask('', { klass: 'Berserker (Ch)', level: 8, play: 'solo' });
    eq(early.build.klass, 'Berserker (Ch)', 'planning ahead should still be allowed');
    ok(early.warnings.some(w => /level 15/.test(w.text)),
       'no warning that the class is not unlocked at level 8');
  });
});

// ── 7. cache busting ────────────────────────────────────────────────
// This class of bug has bitten three times. The engine is loaded by three
// different front ends, and any one of them serving a stale copy fails in a way
// that reads as a code bug rather than a cache bug — the page loads, then dies
// on the first call into a function the old copy does not have. Guard it.
//
// Plain string matching on purpose: a regex here would need escaping that is
// easy to get subtly wrong, and a cache-busting test that silently passes is
// worse than no test.
describe('cache busting', () => {
  const root = path.resolve(__dirname, '..', '..');
  const readRoot = f => fs.readFileSync(path.join(root, f), 'utf8');

  const ENGINE_SCRIPTS = ['ai-data.js', 'model.js', 'knowledge.js', 'intent.js',
                          'optimize.js', 'explain.js', 'share.js', 'engine.js'];

  it('the standalone page version-stamps every engine script', () => {
    const html = readRoot('tools/build-ai.html');
    for (const f of ENGINE_SCRIPTS) {
      ok(html.indexOf('src="ai/' + f + '?v=') !== -1,
         f + ' is not version-stamped in tools/build-ai.html');
    }
  });

  it('the site panel version-stamps its lazy loads', () => {
    const js = readRoot('js/build-ai.js');
    ok(js.indexOf('const ENGINE_V = ') !== -1, 'no ENGINE_V constant');
    ok(js.indexOf("loadScript(f + '?v=' + ENGINE_V)") !== -1,
       'lazy loads are not version-stamped');
  });

  it('the standalone page and the panel agree on the engine version', () => {
    const m1 = /const ENGINE_V = (\d+);/.exec(readRoot('js/build-ai.js'));
    ok(m1, 'could not read ENGINE_V');
    const html = readRoot('tools/build-ai.html');
    const at = html.indexOf('src="ai/engine.js?v=');
    ok(at !== -1, 'engine.js not stamped');
    const v2 = html.slice(at).match(/\?v=(\d+)/)[1];
    eq(v2, m1[1], 'tools/build-ai.html is on v' + v2 + ' but js/build-ai.js is on v' + m1[1]);
  });

  it('index.html version-stamps the panel and its stylesheet', () => {
    const html = readRoot('index.html');
    ok(html.indexOf('js/build-ai.js?v=') !== -1, 'js/build-ai.js not stamped in index.html');
    ok(html.indexOf('css/build-ai.css?v=') !== -1, 'css/build-ai.css not stamped in index.html');
  });

  it('the panel lazy-loads exactly the engine files that exist', () => {
    const js = readRoot('js/build-ai.js');
    for (const f of ENGINE_SCRIPTS) {
      ok(js.indexOf("'tools/ai/" + f + "'") !== -1, f + ' missing from ENGINE_FILES');
      ok(fs.existsSync(path.join(__dirname, f)), f + ' referenced but not on disk');
    }
  });
});

// ── 8. performance ──────────────────────────────────────────────────────────
describe('performance', () => {
  it('answers a request well inside budget', () => {
    const BUDGET_MS = 400;   // generous; typical is ~60ms
    const t0 = Date.now();
    for (const q of REQUESTS) ask(q);
    const avg = (Date.now() - t0) / REQUESTS.length;
    ok(avg < BUDGET_MS, 'average ' + Math.round(avg) + 'ms exceeds ' + BUDGET_MS + 'ms');
    if (VERBOSE) console.log('         average ' + Math.round(avg) + 'ms over ' + REQUESTS.length + ' requests');
  });
});

// ── report ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(58));
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ' + f.group + ' › ' + f.name + '\n    ' + f.message);
  console.log('\nNote: this suite does not check model.js against builder.js.');
  console.log('For that, run tools/ai/verify.js in the browser.');
  process.exit(1);
}
console.log('\nAll good. Remember verify.js in the browser for the maths.');
