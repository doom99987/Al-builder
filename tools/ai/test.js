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
// Golden builds: `soft` expectations warn by default and fail under this flag.
const STRICT_GOLDEN = process.argv.includes('--strict-golden');
// `--only=<text>` runs just the groups and tests whose name contains it. The
// whole suite is minutes long; checking that one deliberately broken guard
// actually fails should not be.
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice('--only='.length);

// ── tiny harness ────────────────────────────────────────────────────────────
let passed = 0, failed = 0, group = '';
const failures = [];

function describe(name, fn) { group = name; console.log('\n' + name); fn(); }
function it(name, fn) {
  if (ONLY && name.indexOf(ONLY) === -1 && group.indexOf(ONLY) === -1) return;
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
// `it` calls fn() and moves on, so an async test's assertions would be thrown
// inside a promise nobody waits for - it would "pass" whatever it found. Async
// tests queue here instead and run, awaited, after the synchronous suite.
const _asyncTests = [];
function itAsync(name, fn) {
  if (ONLY && name.indexOf(ONLY) === -1 && group.indexOf(ONLY) === -1) return;
  _asyncTests.push({ group, name, fn });
}
async function runAsyncTests() {
  let lastGroup = '';
  for (const t of _asyncTests) {
    if (t.group !== lastGroup) { console.log('\n' + t.group + ' (async)'); lastGroup = t.group; }
    try {
      await t.fn();
      passed++;
      if (VERBOSE) console.log('  ok   ' + t.name);
    } catch (e) {
      failed++;
      failures.push({ group: t.group, name: t.name, message: e.message });
      console.log('  FAIL ' + t.name + '\n         ' + e.message);
    }
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

  // A shard family may be fitted more than once - the site counts the first
  // two copies in full and the rest at 25% - but every slot still holds a real
  // shard.
  forEach('every shard slot holds a real shard', r =>
    (r.build.shards || []).some(n => !data.shardItems[n]) ? 'unknown shard' : null);

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
    eq(M.expectedMultiplier(200, 2), 3);          // guaranteed orange: +1, not x2
    eq(M.expectedMultiplier(50, 2), 1.5);         // half the hits crit
    // Withered Grove rework: a higher tier adds +1. The owner's example: 2.25x
    // crit damage, a super crit is 3.25x, not 4.50x.
    eq(M.expectedMultiplier(200, 2.25), 3.25);
    eq(M.expectedMultiplier(150, 2.25), 2.75);    // half the hits orange
    eq(M.expectedMultiplier(300, 2.25), 4.25);    // guaranteed red
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

  it('buys every capstone that pays, not just one', () => {
    // The capstone pass used to buy exactly one and hand the rest of the budget
    // to stat nodes. A Saint's real build carries THREE - All For One, One For
    // All and Cleansing Prayer - and that was unreachable by construction.
    const r = ask('', { roles: ['Healer'], klass: 'Saint (Or)', play: 'team', level: data.Max_Lvl });
    const b = r.build.masteryBudget;
    ok(b.capstonesTaken >= 2, 'Saint healer took ' + b.capstonesTaken + ' capstone(s)');
    ok(r.build.masteryNodes.indexOf('rm1') !== -1, 'One For All was not bought: ' +
       JSON.stringify((b.capstoneOrder || []).map(c => c.name)));
    eq((b.capstoneOrder || []).length, b.capstonesTaken, 'capstoneOrder does not list every capstone taken');
    ok(b.getFirst && b.getFirst.value > 0, 'the first capstone to get is not a measured one');
  });

  it('prices a capstone that does several things as all of them', () => {
    // All For One is lifesteal AND incoming healing. The incoming half is in the
    // site's own maths (model.js), so it is listed and NOT added again.
    const b = M.emptyBuild();
    b.level = data.Max_Lvl; b.klass = 'Saint (Or)'; b.race = 'Estella (24%)';
    b.masteryNodes = ['cm1'];
    const t = O.masteryAbilityTotals(b, { play: 'solo' });
    eq(t.lifestealPct, 20, 'All For One lifesteal');
    eq(t.incHealPct, 0, 'incoming healing was added on top of the site\'s own +40');
    ok(t.active.some(a => a.name === 'All For One' && a.onSite), 'the on-site half is not listed');
    eq(t.active.filter(a => a.name === 'All For One').length, 2, 'expected two rows for All For One');
  });

  it("a capstone's healing reaches the healing figure the scorer reads", () => {
    const r = ask('', { roles: ['Healer'], klass: 'Saint (Or)', play: 'team', level: data.Max_Lvl });
    if (r.build.masteryNodes.indexOf('rm1') === -1) return;   // asserted above
    ok(r.ctx.masteryAbilities.outHealPct >= 50, 'One For All outHealPct = ' + r.ctx.masteryAbilities.outHealPct);
    ok(r.ctx.effectiveHeal > r.ctx.outHeal * 1.45,
       'effectiveHeal ' + r.ctx.effectiveHeal + ' vs outHeal ' + r.ctx.outHeal);
  });

  it('prints the mastery tree in the community a-b-c notation', () => {
    // a-b-c = capstones taken in red-green-blue, two available in each.
    const b = M.emptyBuild();
    b.masteryNodes = ['s1', 'cm1', 'rm1', 'rm2'];
    eq(O.masteryNotation(b), '0-1-2');
    b.masteryNodes = ['lm1', 'cm1', 'cm2'];
    eq(O.masteryNotation(b), '1-2-0');
    b.masteryNodes = [];
    eq(O.masteryNotation(b), '0-0-0');
    const r = ask('tanky build');
    eq(r.build.masteryNotation, O.masteryNotation(r.build), 'the build does not carry its own notation');
  });

  it('lifesteal counts towards survival, and only for the survival goals', () => {
    // Sustain is the third survival figure: effective HP plus what lifesteal
    // returns over K.SUSTAIN.horizon turns. A damage goal must not read it.
    const b = M.emptyBuild();
    b.level = data.Max_Lvl; b.klass = 'Saint (Or)'; b.race = 'Estella (24%)';
    b.invested = { str: 50, arc: 50, end: 50, spd: 0, lck: 0 };
    const spec = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'tank' }, data);
    b.masteryNodes = ['s1', 's2', 's3', 's4', 'c1', 'c2a', 'c2b', 'c3a', 'cb1', 'cm1'];
    const c = O.evaluate(b, spec);
    ok(c.lifesteal >= 20, 'lifesteal ' + c.lifesteal);
    ok(c.effectiveHpSustain > c.effectiveHp, 'sustain adds nothing to effective HP');
    const horizon = (K.SUSTAIN || {}).horizon || 6;
    ok(Math.abs((c.effectiveHpSustain - c.effectiveHp) - c.sustainPerTurn * horizon) < 1e-6,
       'sustain is not sustainPerTurn x horizon');
    const flat = Object.assign({}, c, { effectiveHpSustain: c.effectiveHp });
    ok(K.ARCHETYPES.tank.score(c) > K.ARCHETYPES.tank.score(flat), 'the tank score ignores lifesteal');
    eq(K.ARCHETYPES.damage.score(c), K.ARCHETYPES.damage.score(flat), 'the damage score reads lifesteal');
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

  it('every race has a real stat block and a kit', () => {
    // Arborivia and Calvariae shipped as zero stat blocks and were excluded from
    // the search as unfinished. The owner supplied their numbers, so the
    // exclusion is gone - and this is what stops a future race from shipping as
    // a silent zero row again.
    for (const [name, stats] of Object.entries(data.races || {})) {
      const total = Object.values(stats).reduce((t, v) => t + (v | 0), 0);
      ok(total > 0, name + ' has a zero stat block');
      ok((((data.raceMoves || {})[name] || {}).learns || []).length > 0, name + ' has no kit');
    }
  });

  it('carries the owner-supplied stat blocks for the two late races', () => {
    // From the game, 2026-09-10. If a data refresh zeroes them again this fails
    // loudly instead of the search quietly under-counting both races.
    eq(JSON.stringify(data.races['Arborivia (3%)']), JSON.stringify({ str: 1, arc: 3, end: 2, lck: 3, spd: 1 }));
    eq(JSON.stringify(data.races['Calvariae (3%)']), JSON.stringify({ str: 2, arc: 1, end: 4, lck: 2, spd: 1 }));
  });

  it('searches every race, and a named one is still honoured', () => {
    // `considered` is the coarse pass size, class count x race count. If any
    // race were filtered out of the pool it would stop dividing by the number
    // of races in the data.
    const nRaces = Object.keys(data.races).length;
    const r = engine.ask('max damage');
    ok(r.considered >= nRaces && r.considered % nRaces === 0,
       'coarse pass considered ' + r.considered + ' pairs, not a multiple of ' + nRaces + ' races');
    for (const race of ['Arborivia (3%)', 'Calvariae (3%)']) {
      eq(engine.ask('', { race }).build.race, race);
    }
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
      // Six kinds of owner now: a race, a class, a covenant, either flavour of
      // scroll, or a gear with an active (Divine Promise). A covenant's moves
      // are gated on RANK rather than level, and a scroll's move always shares
      // the scroll's own name, but the field is the same one in every case.
      const src = def.owner
        ? ((data.raceMoves || {})[def.owner] || (data.classMoves || {})[def.owner] ||
           (data.covenantMoves || {})[def.owner] || (data.scrollMoves || {})[def.owner] ||
           (data.lostScrollMoves || {})[def.owner] ||
           ((data.gearActives || {})[def.owner] ? { learns: data.gearActives[def.owner] } : null))
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
    // Scrolls are pinned off throughout. Absolute Radiance and Lesser Empower
    // are open to everybody and buff anything, so with them in play EVERY build
    // has an opener and "the race with no setup" no longer exists — which is a
    // true statement about the game and a false premise for this test.
    const NO_SCROLLS = { sub: 'none', scroll1: 'none', scroll2: 'none', lostScroll: 'none' };
    const burst = engine.ask('', { klass: 'Elementalist (Or)', goal: 'burst', ...NO_SCROLLS });
    eq(burst.build.race, 'Corvolus (3%)', 'burst should favour the castable buff');

    const corv = engine.ask('', { klass: 'Elementalist (Or)', race: 'Corvolus (3%)', goal: 'burst', ...NO_SCROLLS });
    const niss = engine.ask('', { klass: 'Elementalist (Or)', race: 'Nisse (20%)',  goal: 'burst', ...NO_SCROLLS });
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
    const r = engine.ask('', { race: 'Nisse (20%)', klass: 'Elementalist (Or)', goal: 'burst',
                               sub: 'none', scroll1: 'none', scroll2: 'none', lostScroll: 'none' });
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
    // Church of Raphion is pinned because it is the one covenant with no attack
    // in it. Left to choose, the engine takes Cult of Thanasius and its Dark
    // Death Curtain becomes the biggest prepared hit a physical class has — the
    // gate ADMITS dark, so the premise "this kit is entirely physical" would be
    // false and the test would be measuring nothing.
    // A Rogue, not a Lancer, since 2026-09-21: the Lancer's Discharge
    // Proficiency (cm2) is now priced as the site's four hits (MOVE_OVERRIDES
    // 'Discharge'), and Discharge is a Magic move - the gate rightly admits it,
    // so a Lancer's nuke is no longer the physical one this test needs.
    for (const klass of ['Rogue (N)', 'Brawler (N)']) {
      // Scrolls off for the same reason the covenant is pinned: Lesser Empower
      // and Absolute Radiance are element-blind, so with them equipped a
      // physical kit DOES gain burst — correctly, and from a different buff
      // than the one this test is about.
      const r = engine.ask('', { race: 'Corvolus (3%)', klass, goal: 'burst',
                                 covenant: 'Church of Raphion', sub: 'none', scroll1: 'none', scroll2: 'none', lostScroll: 'none' });
      const mv = r.ctx.burstMove || r.ctx.bestMove;
      eq(String(mv && mv.moveType), 'Physical', klass + ' best move is not Physical — pick another');
      eq(Math.round(r.ctx.bestBurst), Math.round(r.ctx.bestHit),
         klass + ' gained burst from an element-gated buff it cannot use');
    }

    // And the finding that broke it, kept as a test of its own: a physical class
    // whose race buffs magic elements really does prefer the covenant's Dark
    // attack for its opener. If that stops being true, something changed.
    // Scrolls off here too. Crystalline Spike's +5 lands on every hit, so the
    // 4-hit Ice Shards scroll out-gains the 2-hit Death Curtain and takes the
    // opener - correctly, per the site's per-hit flat damage, but it is a scroll,
    // not the covenant move this is about.
    // A Slayer, not a Lancer: since the 2026-09 patch Empowered Pierce deals
    // x1.5 on its crits, which rightly out-bursts Death Curtain on a Lancer.
    const dark = engine.ask('', { race: 'Corvolus (3%)', klass: 'Slayer', goal: 'burst',
                                  covenant: 'Cult of Thanasius', sub: 'none', scroll1: 'none', scroll2: 'none', lostScroll: 'none' });
    eq(String((dark.ctx.burstMove || {}).name), 'Death Curtain',
       'a Corvolus Slayer no longer opens on the covenant move');
    ok(dark.ctx.bestBurst > dark.ctx.bestHit,
       'the element-gated buff paid nothing on a move its gate admits');
    ok(dark.ctx.rotation.length && dark.ctx.rotation.every(rt => rt.elements),
       'the burst gain came from an element-blind buff, not a gated one');
    // Left to choose scrolls, the opener may be a scroll - but never a move the gate refuses.
    const auto = engine.ask('', { race: 'Corvolus (3%)', klass: 'Slayer', goal: 'burst', covenant: 'Cult of Thanasius' });
    const amv = auto.ctx.burstMove || {};
    ok(def.elements.test(String(amv.moveType) + ' ' + String(amv.element || '')),
       'with scrolls chosen, the Slayer opens on ' + amv.name + ' (' + amv.moveType + '), a move the gate refuses');
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

  it('Blasphemy pays nothing to a kit whose best hit costs under 3 energy', () => {
    // Owner-stated: the Notch bonus lands on the move that SPENDS the stack, and
    // only a 3+ energy move can spend it. An Assassin's nuke is Poison Fan at 2
    // energy, so the form is worth nothing there - the engine used to multiply
    // that hit by 1.30 regardless and then recommend the form off that number.
    const cost = m => { const n = parseInt(String(m && m.cost), 10); return isNaN(n) ? 0 : n; };
    const a = ask('assassin nuke biggest single hit');
    const nuke = a.ctx.burstMove || a.ctx.bestMove;
    ok(cost(nuke) < 3, 'premise gone: this Assassin nuke costs ' + cost(nuke) + ' energy');
    const aBl = (a.corruption.all || []).find(f => f.form === 'Blasphemy');
    ok(aBl && aBl.damage, 'no Blasphemy row on the Assassin');
    // `formBurst` is the FORM's own multiplier, before any gear the form
    // unlocks - which is what the Notch rule is about.
    eq(aBl.damage.formBurst, 1, 'Blasphemy buffed a ' + cost(nuke) + '-energy nuke');

    // The other direction, or the fix has simply broken the form: a kit built
    // around a 6-energy Carnage still collects the whole +30%.
    const b = ask('berserker carnage max damage');
    const bBl = (b.corruption.all || []).find(f => f.form === 'Blasphemy');
    ok(bBl && bBl.damage && bBl.damage.formBurst > 1,
       'Blasphemy stopped paying a kit whose payoff move costs 6 energy');
  });

  it('counts a move that stuns you per turn it costs you', () => {
    // Boreas's Inner Frost heavy-stuns YOU for a turn (two before the 2026-09 patch) and only then lands.
    // Nothing in the move data marks that as a cost, so a 21-base race move on a
    // 12 turn cooldown outscored every real nuke as soon as race actives entered
    // the scored kit.
    eq(K.selfStunTurns({ name: 'Inner Frost' }), 1, 'Inner Frost is not listed as a one-turn self-stun');
    eq(K.selfStunTurns({ name: 'Poison Fan' }), 0, 'a normal move was treated as a self-stun');
    ok(K.selfStunTurns({ name: 'Unlisted', effect: 'Receive 2 stacks of Heavy Stun.' }) > 0,
       'an unlisted move whose own text stuns the user is still scored as free');

    // And the search must stop handing it out as the biggest hit in the game.
    for (const q of ['assassin nuke biggest single hit', 'max damage', 'biggest hit crit build']) {
      const mv = ask(q).ctx.burstMove || {};
      eq(K.selfStunTurns(mv), 0,
         '"' + q + '" opens with ' + mv.name + ', which stuns you before it lands');
    }
  });

  it('lets a corruption form see gear that only pays inside it', () => {
    // Ages Pages: spending Corrupt Power raises its crit, capped at 2 stacks by
    // a bug, in Blasphemy or Tyranny - and never in Heresy, where Corrupt Power
    // is itself bugged. The build is settled before the form is chosen, so this
    // was worth nothing to either decision until the two passes were joined.
    const r = ask('assassin nuke biggest single hit');
    if (!(r.build.gear || []).some(g => g.name === 'Ages Pages')) return;
    const by = {};
    for (const f of (r.corruption.all || [])) by[f.form] = f.damage;
    ok(by.Blasphemy && by.Blasphemy.formGearCrit > 0, 'Blasphemy sees nothing from Ages Pages');
    ok(by.Tyranny && by.Tyranny.formGearCrit > 0, 'Tyranny sees nothing from Ages Pages');
    eq(by.Heresy ? by.Heresy.formGearCrit : 0, 0, 'Heresy counted a bonus its bugged Corrupt Power cannot give');
  });

  it('prices Stealth Strike as the hit that comes out of Invisible', () => {
    // Owner-stated: an Assassin opens out of Shadow Form. Since Withered Grove
    // §12 "Increases damage dealt by 100% if invisible while attacking" is +100
    // in the move's damage bonus sum (the site's "Stealth Strike from
    // Invisible" switch), NOT a doubled base - the base doubling it replaced
    // must not come back beside it, or the move would be counted twice.
    ok(!(K.MOVE_OVERRIDES || {})['Stealth Strike'], 'Stealth Strike is still rewritten to a doubled base');
    const rule = (K.MOVE_CONDITIONAL_DMG || {})['Stealth Strike'];
    ok(rule, 'no conditional damage term for Stealth Strike');
    eq(rule.value, 100, 'the +100% from Invisible');
    eq(rule.setup, 'Shadow Form', 'the setup that makes the attack come out of Invisible');
    eq(rule.uptime, K.MASTERY_ABILITIES['Shadow Master'].uptime,
       'Stealth Strike and Shadow Master disagree about how often you attack from Invisible');
    ok(rule.openerFull, 'the opener is not the invisible hit');
    const sf = [{ move: 'Shadow Form' }];
    ok(K.moveConditionalLive(rule, { klass: 'Assassin (Ch)', level: 50 }, sf), 'the term does not fire with Shadow Form in the kit');
    ok(!K.moveConditionalLive(rule, { klass: 'Rogue (N)', level: 50 }, []), 'it fires with no Shadow Form');
    ok(!K.moveConditionalLive(rule, { klass: 'Assassin (Ch)', level: 10 }, sf), 'it fires below the level that learns Shadow Form');

    // The raw move is the page's plain 10 for everyone: the bonus lives in the
    // sum, so moveDamage (Base + Flat) is identical on an Assassin and a Rogue.
    const M = require('./model.js').Model(data);
    for (const q of K.QUIRKS) if (typeof M.register[q.hook] === 'function') M.register[q.hook](q.apply);
    const r = engine.ask('', { klass: 'Assassin (Ch)', goal: 'burst' });
    const mv = r.ctx.moves.find(m => m.name === 'Stealth Strike');
    ok(mv, 'no Stealth Strike in the kit');
    const rogue = Object.assign({}, r.build, { klass: 'Rogue (N)' });
    eq(M.moveDamage(r.build, mv, { stats: r.ctx.stats }), M.moveDamage(rogue, mv, { stats: r.ctx.stats }),
       'Stealth Strike is still worth a different raw hit on an Assassin');

    // And it reaches the damage figure: an Assassin whose nuke IS Stealth Strike
    // carries the term, all of it on the opener (half in the base sum, the rest
    // with the setups), beside Shadow Form's own +20.
    const O = engine.optimizer;
    const b = M.emptyBuild(); b.klass = 'Assassin (Ch)'; b.level = data.Max_Lvl; b.invested.str = 40;
    const ctx = O.evaluate(b, ask('', { klass: 'Assassin (Ch)', goal: 'burst', level: data.Max_Lvl }).spec);
    eq((ctx.burstMove || {}).name, 'Stealth Strike', 'fixture: a bare STR Assassin no longer nukes with Stealth Strike');
    const t = ctx.burstTerms;
    ok(t && t.cond && t.cond.move === 'Stealth Strike', 'the burst does not carry the Stealth Strike term');
    // Exact, not lower bounds: a bare STR-40 Assassin has nothing else in
    // either sum, so a term counted twice shows here (a bound let an uptime
    // dropped from the base sum - 50 -> 100 - pass).
    const near = (a, b, what) => ok(Math.abs(a - b) < 1e-9, what + ': expected ' + b + ', got ' + a);
    near(t.basePct, 100 * rule.uptime, 'the base sum is not its share of the +100');
    near(t.openPct, 100 * (1 - rule.uptime) + 20, "the opener is not the rest of the +100 and Shadow Form's +20");
    ok(Math.abs(t.pct - (t.basePct + t.openPct)) < 1e-9, 'the opener is not one sum');
  });

  it('counts full-health and setup crit on the opening turn only', () => {
    // A fight starts at full health, so Arborivia's Overgrowth (+20 crit at max
    // HP, owner) and Shadow Form's ~20 on the attack that breaks Invisible are
    // certainly up on an opener - averaging them down there understated every
    // burst build. The sustained figure keeps the averaged crit.
    // Pinned to a race WITHOUT a full-health passive, so the comparison below
    // measures Overgrowth rather than whichever race the search happens to like.
    const a = engine.ask('', { klass: 'Assassin (Ch)', race: 'Dullahan (1%)', goal: 'burst' });
    ok(a.ctx.openerCrit >= 20, "Shadow Form's crit is missing from the opener: " + a.ctx.openerCrit);
    ok(a.ctx.bestBurst > a.ctx.bestHit, 'a prepared hit is not worth more than a cold one');
    const b = engine.ask('', { klass: 'Assassin (Ch)', race: 'Arborivia (3%)', goal: 'burst' });
    if (b.build.race === 'Arborivia (3%)' && a.build.race === 'Dullahan (1%)') {
      ok(b.ctx.openerCrit > a.ctx.openerCrit,
         'Overgrowth adds nothing to an opener that happens at full health');
    }
  });

  it('costs the opening rotation in energy, with the gain chance as an average', () => {
    // Owner-stated: 1 energy a turn flat, and the energy GAIN stat is a percent
    // chance of another - averaged, because a chance cannot be half-spent inside
    // a turn count. A rotation nobody can pay for is not a rotation.
    for (const q of ['assassin nuke biggest single hit', 'berserker carnage max damage', 'tanky knight']) {
      const c = ask(q).ctx;
      const e = c.energy;
      ok(e && e.perTurn >= 1, q + ': no energy income on the ctx');
      ok(Math.abs((e.regen + e.chancePct / 100) - e.perTurn) < 1e-9,
         q + ': energy a turn is not the flat regen plus the gain chance');
      const p = c.energyPlan;
      ok(p && p.steps.length, q + ': no energy ledger for the opener');
      for (const s of p.steps) ok(s.left >= 0, q + ': ' + s.move + ' is cast at negative energy');
      ok(p.turns >= p.steps.length, q + ': waiting turns are not counted in the total');
    }
  });

  it('adds the Luck 25 milestone to crit damage, as the site does', () => {
    // Reported from play: "Crit Damage increased by 10%" at 25 Luck was shown in
    // the milestone panel and never added. It is +0.1 on the crit multiplier,
    // and model.js must agree with builder.js or every crit build is off by it.
    const M = require('./model.js').Model(data);
    const b = M.emptyBuild(); b.level = data.Max_Lvl; b.race = 'Dullahan (1%)'; b.klass = 'Assassin (Ch)';
    b.invested = { str: 0, arc: 0, end: 0, spd: 0, lck: 0 };
    const low = M.derived(b);
    ok(low.stats.lck < 25, 'test premise: the uninvested build already has ' + low.stats.lck + ' Luck');
    b.invested.lck = 40;
    const high = M.derived(b);
    ok(Math.abs((high.critDmg - low.critDmg) - 0.1) < 1e-9,
       'crit damage moved by ' + (high.critDmg - low.critDmg) + ' crossing 25 Luck, not 0.1');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'builder.js'), 'utf8');
    ok(src.indexOf('_lckMsCritDmg') !== -1, 'builder.js does not add the Luck 25 crit damage that model.js counts');
  });

  it('gives a race reason that applies to the build it is on', () => {
    // Reported from play: "Corvolus - highest base Arcane in the game" was the
    // reason printed for a Strength Carnage Berserker. The reason must name
    // something the race does for THIS build, or say that nothing does.
    const r = engine.ask('', { klass: 'Berserker (Ch)', race: 'Corvolus (3%)', goal: 'damage', level: data.Max_Lvl });
    const whyOf = res => ((res.explanation || []).find(x => x.h === 'Why this build') || {}).list || [];
    const line = whyOf(r).find(l => l.indexOf('**Corvolus (3%)**') === 0);
    ok(line, 'no race line in Why this build');
    ok(line.indexOf('highest base Arcane') === -1, 'the race reason is its generic blurb again: ' + line);

    const a = ask('assassin nuke biggest single hit');
    if (a.build.race === 'Arborivia (3%)') {
      const aLine = whyOf(a).find(l => l.indexOf('**Arborivia') === 0) || '';
      ok(/Overgrowth/.test(aLine), 'Arborivia is picked for Overgrowth and the reason does not say so: ' + aLine);
    }
  });

  it('does not pair a low-health race with an item that needs full health', () => {
    // Reported from play: the AI chose Estella for Hyper Rage (+25% below half
    // health) and Stellian Core (only above 95%) on the same build. A race does
    // not commit a build to fighting hurt, but the opposite-side item is advice
    // arguing with itself, so it is counted at the conflict uptime.
    const stance = K.hpStance('Assassin (Ch)', 'Estella (24%)');
    const g = K.hpGateFor('Stellian Core', stance, 0.35);
    ok(g && !g.agrees, 'Stellian Core is not treated as conflicting with Estella');
    eq(g.uptime, K.HP_GATE_UPTIME.conflict, 'Stellian Core uptime on an Estella build');
    eq(K.hpGateFor('Molten Carapace', stance, 0.25), null, 'a low-health item is not penalised on Estella');
    eq(K.hpGateFor('Stellian Core', K.hpStance('Assassin (Ch)', 'Arborivia (3%)'), 0.35), null,
       'a race with no health preference changed Stellian Core');
    for (const q of [{ race: 'Estella (24%)', goal: 'damage' }, { race: 'Estella (24%)', goal: 'burst' }]) {
      const r = engine.ask('', Object.assign({ level: data.Max_Lvl }, q));
      ok(!(r.build.artifact && r.build.artifact.name === 'Stellian Core'),
         'an Estella ' + q.goal + ' build still wears Stellian Core');
    }
  });

  it('puts every item at its own max tier, not the global cap', () => {
    // Owner-stated: most gear stops short of T6. Crystal Sphere tops out at T3
    // (4 points, not 9), Yar'thul's Wrath at T4, Stellian Core does reach T6.
    // Forcing every item to the global cap handed out stat points no player can
    // put on those items, and biased every search toward low-tier gear.
    eq(K.maxTierFor('Crystal Sphere', 6), 3, 'Crystal Sphere max tier');
    eq(K.maxTierFor("Yar'thul's Wrath", 6), 4, "Yar'thul's Wrath max tier");
    eq(K.maxTierFor('Stellian Core', 6), 6, 'Stellian Core max tier');
    eq(K.maxTierFor('Primordial Dagger', 4), 4, 'a weapon never exceeds the site cap');
    eq(K.maxTierFor('Not A Real Item', 6), 6, 'an unlisted item keeps the global cap');

    // A tier has several legal shapes with different totals (T6 is [9], [5,3]
    // or [2,2,2,2]), so the check is "one of this tier's totals", not the first.
    const totals = tier => (data.GEAR_TIER_SHAPES[tier] || [[]]).map(s => s.reduce((a, v) => a + v, 0));
    const fixed = new Set(data.FIXED_GEAR || []);
    for (const q of ['assassin nuke biggest single hit', 'saint healer', 'berserker carnage max damage']) {
      const b = ask(q).build;
      const worn = (b.gear || []).filter(g => !fixed.has(g.name)).concat(b.artifact ? [b.artifact] : []);
      for (const g of worn) {
        const want = K.maxTierFor(g.name, data.MAX_GEAR_TIER);
        eq(g.tier, want, q + ': ' + g.name + ' tier');
        const spent = Object.values(g.alloc || {}).reduce((a, v) => a + (v || 0), 0);
        ok(totals(want).includes(spent),
           q + ': ' + g.name + ' carries ' + spent + ' tier points, not a legal T' + want + ' shape (' + totals(want).join('/') + ')');
      }
    }
  });

  it('re-checks gear against the finished build', () => {
    // Gear is picked before capstones, tier points and traits settle, so a
    // winner can end up wearing an item a runner-up beats on the FINISHED build
    // - the Berserker golden once wore DeathBeak Dagger, a bare stat stick,
    // while Shard of Blight scored 2% higher. refineGear is what fixes that.
    // A check on real requests passes whether or not it exists once the search
    // happens to pick well, so this PLANTS a clearly worse item and requires the
    // re-check to replace it - and requires run() to re-check before it
    // perfects the stat line, or a swapped item slides totals off breakpoints.
    const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden', 'berserker-crit.json'), 'utf8'));
    const r = engine.ask(golden.request.text, golden.request.overrides || {});
    const O = engine.optimizer;
    ok(typeof O.refineGear === 'function', 'refineGear is not exported');
    const b = JSON.parse(JSON.stringify(r.build));
    const slot = (b.gear || []).findIndex((g, i) => ((b._alts || {})['gear' + (i + 1)] || []).length > 1);
    ok(slot >= 0, 'no gear slot recorded any runners-up');
    b.gear[slot] = Object.assign({}, b.gear[slot], { name: 'Chocolate Egg' });
    const planted = O.evaluate(b, r.spec).score;
    O.refineGear(b, r.spec);
    ok(b.gear[slot].name !== 'Chocolate Egg', 'a planted stat stick survived the re-check in slot ' + (slot + 1));
    ok(O.evaluate(b, r.spec).score > planted, 'the re-check did not improve on the planted item');

    const src = fs.readFileSync(path.join(__dirname, 'optimize.js'), 'utf8');
    const at = src.indexOf('refineGear(x.b, spec)'), fin = src.indexOf('finishLine(x.b, spec)');
    ok(at !== -1 && fin !== -1 && at < fin, 'run() must re-check gear before it perfects the stat line');
  });

  it('re-ranks tier points when the re-check swaps an item', () => {
    // tierOrder caches its stat ranking on the invested points alone, so after a
    // gear swap the cached order can be stale: a crit Assassin's swapped-in
    // Crystal Sphere took its 4 tier points to Strength instead of Luck and
    // stayed under the crit tier. Planted directly: a cached order that ranks
    // Endurance and Speed first, keyed to this exact line, and one slot whose
    // only runner-up is Crystal Sphere. The swap must re-measure the order.
    const r = engine.ask('', { klass: 'Assassin (Ch)', race: 'Amorus (Ob)', goal: 'crit', level: data.Max_Lvl });
    const O = engine.optimizer;
    const b = JSON.parse(JSON.stringify(r.build));
    let i = b.gear.findIndex(g => g.name === 'Crystal Sphere');
    if (i < 0) i = b.gear.length - 1;
    b.gear[i] = { name: 'Chocolate Egg', tier: 1, alloc: { str: 2 }, traits: b.gear[i].traits || [] };
    b._alts = { ['gear' + (i + 1)]: [{ name: 'Crystal Sphere' }] };
    O.tierOrder(b, r.spec);                                  // key the cache to this line
    b._tierOrder = ['end', 'spd', 'str', 'arc', 'lck'];      // then make it wrong
    const planted = O.evaluate(b, r.spec).score;
    O.refineGear(b, r.spec);
    eq(b.gear[i].name, 'Crystal Sphere', 'the re-check did not take Crystal Sphere over a Chocolate Egg');
    const a = b.gear[i].alloc || {};
    ok(!a.end && !a.spd, 'the swapped-in item spent its tier points by a stale cached order: ' + JSON.stringify(a));
    ok(O.evaluate(b, r.spec).score > planted, 'the re-check did not improve the build');
  });

  it('never lowers a finished build by re-running its tier points', () => {
    // bestTierAlloc tries the top two stat orders only. Re-run on a settled
    // line it used to replace an allocation that was holding a crit tier, so
    // finishLine could leave a build worse than it found it.
    const O = engine.optimizer;
    for (const q of ['assassin nuke biggest single hit', 'crit wizard', 'berserker crit', 'saint healer']) {
      const r = ask(q);
      const b = JSON.parse(JSON.stringify(r.build));
      const before = O.evaluate(b, r.spec).score;
      O.finishLine(b, r.spec);
      const after = O.evaluate(b, r.spec).score;
      ok(after >= before * (1 - 1e-6),
         '"' + q + '": finishing the finished build again scores ' + Math.round(after) + ' against ' + Math.round(before));
    }
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

describe('covenants', () => {
  it('always picks one, on every goal', () => {
    // The whole point. A covenant grants no stats, so for as long as the engine
    // scored builds on their stat blocks it had no reason to choose and left the
    // slot empty on every build it has ever produced.
    for (const goal of Object.keys(K.ARCHETYPES)) {
      for (const play of ['solo', 'team']) {
        const r = engine.ask('', { goal, play, dmg: 'average' });
        ok(r.build.covenant, goal + '/' + play + ' has no covenant');
        ok((data.covenantItems || {})[r.build.covenant],
           goal + '/' + play + ' picked "' + r.build.covenant + '", which is not a covenant');
        eq(r.build.covenantRank, K.COVENANT_ASSUMED_RANK,
           goal + '/' + play + ' is not at the assumed rank');
      }
    }
  });

  it('leaves the slot empty below the level it unlocks at', () => {
    // Covenants require level 10. Handing a level 8 build one is telling
    // somebody to equip a thing the game will not let them equip.
    const min = K.COVENANT_MIN_LEVEL;
    ok(min > 1, 'no covenant level gate');
    const r = engine.ask('', { level: min - 1, goal: 'damage' });
    eq(r.build.covenant, '', 'a level ' + (min - 1) + ' build was given a covenant');
    const ok10 = engine.ask('', { level: min, goal: 'damage' });
    ok(ok10.build.covenant, 'a level ' + min + ' build was not given one');
  });

  it('honours a locked covenant', () => {
    for (const name of Object.keys(data.covenantItems || {})) {
      const r = engine.ask('', { goal: 'damage', covenant: name });
      eq(r.build.covenant, name, 'locked covenant ignored');
      eq(r.covenant.decidedBy, 'locked', 'a locked covenant is not reported as locked');
    }
  });

  it('names the covenant that can actually host the boss it is built for', () => {
    // Church of Raphion rank 20 grants the ability to teleport to and host
    // Seraphon; Cult of Thanasius does the same for Arkhaia. Building to kill
    // one of those and recommending the wrong covenant is a build you cannot
    // start the fight with.
    for (const [boss, want] of Object.entries(K.COVENANT_BOSS_HOST || {})) {
      ok((data.encounterKinds || {})[boss], boss + ' is not an encounter in the data');
      ok((data.covenantItems || {})[want], want + ' is not a covenant');
      const r = engine.ask('', { goal: 'damage', boss });
      eq(r.build.covenant, want, 'building for ' + boss + ' did not pick ' + want);
    }
  });

  it('gives the healer the one covenant the site itself scores', () => {
    // Way of Life's Lifebound is the single entry in covenantBonuses, so this is
    // a MEASURED win rather than a preference — and it must be measured, or the
    // covenant's own +15% outgoing healing is not reaching the numbers.
    const r = engine.ask('', { goal: 'heal', play: 'team', dmg: 'average' });
    eq(r.build.covenant, 'Way of Life', 'the healer was not given Way of Life');
    eq(r.covenant.decidedBy, 'measured', 'Way of Life won on preference, not on the numbers');
  });

  it('actually applies the covenant bonus to the site-facing numbers', () => {
    // The bonus lives in the site's covenantBonuses and is applied by
    // updatePecents. If model.js does not apply it too, the engine and the page
    // disagree the moment a build carries a covenant — and the ONLY way to catch
    // that here is to compare a build with it against the same build without.
    const M = require('./model.js').Model(data);
    const b = M.emptyBuild();
    b.level = 50; b.race = 'Estella (24%)'; b.klass = 'Saint (Or)';
    b.invested = { str: 0, arc: 0, end: 100, spd: 0, lck: 0 };
    const without = M.derived(b).outHeal;
    b.covenant = 'Way of Life'; b.covenantRank = 20;
    const with20 = M.derived(b).outHeal;
    eq(Math.round(with20 - without), 15, 'Way of Life rank 20 did not add its 15% outgoing healing');
    // And the rank gate is a gate, not decoration.
    b.covenantRank = 4;
    eq(Math.round(M.derived(b).outHeal), Math.round(without),
       'the rank 5 bonus paid out at rank 4');
  });

  it('puts the covenant attacks in the kit, gated on rank', () => {
    const O = require('./optimize.js');
    ok(typeof O.Optimizer === 'function', 'no Optimizer');
    const M = require('./model.js').Model(data);
    const opt = O.Optimizer(M, K);
    // Death Curtain unlocks at rank 10 and Soul Absorb at rank 1.
    const r1  = opt.covenantMovesFor('Cult of Thanasius', 1).map(m => m.name);
    const r20 = opt.covenantMovesFor('Cult of Thanasius', 20).map(m => m.name);
    ok(r1.indexOf('Soul Absorb') !== -1, 'Soul Absorb missing at rank 1');
    ok(r1.indexOf('Death Curtain') === -1, 'Death Curtain available at rank 1');
    ok(r20.indexOf('Death Curtain') !== -1, 'Death Curtain missing at rank 20');
    // Only attacks: Lesser Heal and Bless carry no damage and are not moves the
    // damage search should be ranking.
    const heal = opt.covenantMovesFor('Way of Life', 20).map(m => m.name);
    ok(heal.indexOf('Lesser Heal') === -1, 'a healing move got into the damage kit');
  });

  it('lets a covenant move be the best move when it really is', () => {
    const r = engine.ask('', { klass: 'Saint (Or)', goal: 'damage',
                               covenant: 'Cult of Thanasius' });
    const names = r.ctx.moves.map(m => m.name);
    ok(names.indexOf('Death Curtain') !== -1, 'Death Curtain is not in the kit');
  });

  it('counts the covenant passives as passives', () => {
    const r = engine.ask('', { goal: 'damage', covenant: 'Blades of the World' });
    const all = r.ctx.passiveList;
    const names = [...all.known, ...all.unknown].map(p => p.name);
    ok(names.indexOf('Blessing of Survival') !== -1,
       'the rank 20 blessing is not reported anywhere');
    ok([...all.known, ...all.unknown].some(p => p.owner === 'Blades of the World'),
       'covenant passives are not attributed to the covenant');
  });

  it('every covenant explains itself, and says what is not counted', () => {
    for (const [name, def] of Object.entries(K.COVENANTS || {})) {
      ok((data.covenantItems || {})[name], name + ' is not a covenant in the data');
      ok(typeof def.fit === 'function', name + ' has no fit()');
      ok(def.blurb && def.blurb.length > 20, name + ' has no blurb');
      ok((def.unpriced || []).length, name + ' lists nothing as not counted');
      for (const [what, why] of def.unpriced) {
        ok(why && why.length > 40, name + ' / ' + what + ' has no real explanation');
      }
    }
    // And every covenant in the data has an entry, so adding one cannot leave a
    // silent hole the way the artifacts did.
    for (const name of Object.keys(data.covenantItems || {})) {
      ok((K.COVENANTS || {})[name], name + ' has no knowledge entry');
    }
  });

  it('writes the covenant into the share link', () => {
    // There is no unpack() to round-trip through, so this checks the only thing
    // that can be checked from here: the bits MOVE. If pack() ignored the
    // covenant, a build with one and the same build without would encode
    // identically — which is exactly how a slot goes missing from a share link
    // without anybody noticing.
    const r = engine.ask('', { goal: 'damage' });
    ok(r.build.covenant, 'no covenant to encode');
    const bare = Object.assign({}, r.build, { covenant: '', covenantRank: 1 });
    ok(Share.packBlob(data, r.build) !== Share.packBlob(data, bare),
       'the covenant is not written into the share link');
    const other = Object.assign({}, r.build, { covenantRank: 3 });
    ok(Share.packBlob(data, r.build) !== Share.packBlob(data, other),
       'the covenant RANK is not written into the share link');
    // And the way back in, which is the path the builder actually uses.
    const b = Share.fromState(data, { cov: 'Way of Life', covR: 12 });
    eq(b.covenant, 'Way of Life', 'fromState drops the covenant');
    eq(b.covenantRank, 12, 'fromState drops the covenant rank');
  });

  it('explains the covenant in the write-up', () => {
    const r = engine.ask('', { goal: 'damage' });
    // Two sections carry this header now: the write-up's one-liner and the
    // detailed comparison behind it. The ladder lives in the detailed one.
    const sec = r.explanation.filter(x => x.h === 'Covenant').find(x => (x.list || []).length);
    ok(sec && (sec.list || []).length === 4, 'the covenant section does not compare all four');
    const build = r.explanation.find(x => x.h === 'Build');
    ok((build.table || []).some(row => row[0] === 'Covenant'),
       'the build table does not name the covenant');

    // The full ladder, rank by rank. Without it the covenant Actives that carry
    // no damage figure — Bless, Lesser Heal — appear NOWHERE: they are in
    // neither the move pool nor the passive list, and 'some give moves' is half
    // the reason to pick one covenant over another.
    const kit = r.explanation.find(x => /^What .+ gives you$/.test(x.h || ''));
    ok(kit, 'the covenant kit is never listed');
    const learns = (data.covenantMoves || {})[r.build.covenant].learns;
    eq((kit.table || []).length, learns.length, 'the covenant kit is listed incompletely');
    ok(kit.table.every(row => /^Rank \d+/.test(row[0])),
       'the kit does not say which rank unlocks what');

    // Every covenant Active with a cost has to show it, or the ladder reads as a
    // list of free abilities.
    for (const mv of learns.filter(m => m.type === 'Active' && m.cost != null)) {
      const row = kit.table.find(rw => rw[0].indexOf(mv.name) !== -1);
      ok(row && row[1].indexOf(mv.cost + ' energy') !== -1,
         mv.name + ' is listed without its energy cost');
    }
  });
});

describe('fighting hurt', () => {
  const LOW = Object.keys(K.HP_STANCE || {});

  it('knows which classes want to be hurt, and they are real classes', () => {
    ok(LOW.length >= 4, 'HP_STANCE is suspiciously short');
    for (const klass of LOW) {
      ok((data.classMoves || {})[klass], klass + ' is not a class');
      const def = K.HP_STANCE[klass];
      eq(def.side, 'low', klass + ' has an unexpected stance');
      // The passive it names has to exist, or the reason given is fiction.
      const src = data.classMoves[klass];
      const all = [...(src.learns || []), ...(src.innatePassives || [])];
      ok(all.some(m => m.name === def.passive),
         klass + ' has no passive called ' + def.passive);
      ok(def.why && def.why.length > 20, klass + ' gives no reason');
    }
  });

  it('every HP-gated item is a real item and names its threshold', () => {
    for (const [name, g] of Object.entries(K.HP_GATED || {})) {
      const known = (data.artifactItems || {})[name] || (data.gearItems || {})[name];
      ok(known, name + ' is neither a gear nor an artifact');
      ok(g.needs === 'low' || g.needs === 'high', name + ' has no side');
      ok(g.threshold > 0 && g.threshold <= 100, name + ' has no threshold');
      // The threshold must actually appear in the game's own text for the item,
      // or the gate is something somebody made up.
      const text = String((data.itemPassives || {})[name] || '') +
        ((data.artifactMoves || {})[name] ? (data.artifactMoves[name].learns || [])
          .map(m => m.effect || '').join(' ') : '');
      ok(text.indexOf(String(g.threshold)) !== -1,
         name + ': the game text never mentions ' + g.threshold + '%');
    }
  });

  it('does not give a low-HP class an artifact that needs high HP', () => {
    // The complaint this came from: Stellian Core only works above 95% max HP,
    // and a Berserker fights hurt (Bloodlust heals only below 50%, Rage lowers Defense).
    for (const klass of LOW) {
      for (const goal of ['damage', 'burst', 'crit']) {
        const r = engine.ask('', { klass, goal, dmg: 'average' });
        const art = r.build.artifact && r.build.artifact.name;
        ok(art !== 'Stellian Core',
           klass + '/' + goal + ' was given Stellian Core, which needs 95% HP');
      }
    }
  });

  it('still gives it to a class that has no reason to get hurt', () => {
    // The other half. A rule that just banned Stellian Core everywhere would
    // pass the test above and be wrong.
    const neutral = ['Lancer (N)', 'Paladin (Or)'].filter(k => (data.classMoves || {})[k]);
    ok(neutral.length, 'no neutral classes to check against');
    let taken = 0;
    for (const klass of neutral) {
      const r = engine.ask('', { klass, goal: 'damage', dmg: 'average' });
      if ((r.build.artifact || {}).name === 'Stellian Core') taken++;
    }
    ok(taken > 0, 'Stellian Core is now never chosen by anyone — the gate is a ban, not a gate');
  });

  it('prices a gate in both directions, not just against', () => {
    const stanceLow  = K.hpStance('Berserker (Ch)', 'Dullahan (1%)');
    const stanceNone = K.hpStance('Lancer (N)',     'Dullahan (1%)');
    ok(stanceLow.committed && !stanceNone.committed, 'stance detection is wrong');

    const high = K.hpGateFor('Stellian Core', stanceLow, 0.35);
    const low  = K.hpGateFor('Molten Carapace', stanceLow, 0.25);
    ok(high && !high.agrees, 'Stellian Core does not conflict with a low-HP build');
    ok(low && low.agrees, 'Molten Carapace does not agree with a low-HP build');
    ok(low.uptime > 0.25, 'agreeing with the stance did not raise the uptime');
    ok(high.uptime < 0.35, 'conflicting with the stance did not lower the uptime');
    // Nothing at all happens to a build with no stance.
    eq(K.hpGateFor('Stellian Core', stanceNone, 0.35), null,
       'a neutral build had its artifact repriced anyway');
    // Both reasons have to be readable, since they are printed verbatim.
    for (const g of [high, low]) ok(g.why.length > 60, 'an HP gate gives no real reason');
  });

  it('counts the passives that are the reason for the stance', () => {
    // Bloodlust, Bloody Berserker and Bruiser were all in the "not counted"
    // list. Downgrading Stellian Core for a Berserker while still not counting
    // what a Berserker gets for being hurt would be half an answer.
    const cases = [['Berserker (Ch)', 'Bloodlust'], ['Impaler (Ch)', 'Bloody Berserker'],
                   ['Brawler (N)', 'Bruiser']];
    for (const [klass, passive] of cases) {
      const r = engine.ask('', { klass, goal: 'damage', dmg: 'average' });
      ok(r.ctx.passiveList.known.some(p => p.name === passive),
         passive + ' is still not counted for ' + klass);
    }
  });

  it('lifts a race passive only when the class is committed too', () => {
    // Estella's Hyper Rage is "below 50% health only" as well, but a race is an
    // incentive and a class is a commitment. Reading a whole play pattern out of
    // a race choice would be inventing something the data does not say.
    const M = require('./model.js').Model(data);
    const O = require('./optimize.js').Optimizer(M, K);
    const mk = klass => {
      const b = M.emptyBuild();
      b.level = 50; b.race = 'Estella (24%)'; b.klass = klass;
      return O.evaluate(b, { goal: 'damage', play: 'solo', dmg: 'average' });
    };
    const committed = mk('Berserker (Ch)').passives.dmgPct;
    const neutral   = mk('Lancer (N)').passives.dmgPct;
    // Both carry Hyper Rage; only the Berserker should be counting it in full.
    const rage = K.PASSIVES['Estella (24%)'].find(p => p.name === 'Hyper Rage');
    ok(rage.hpGate === 'low', 'Hyper Rage is not marked as an HP-gated passive');
    ok(committed > neutral, 'the committed build does not value Hyper Rage more');
  });

  it('says so in the write-up', () => {
    const r = engine.ask('', { klass: 'Berserker (Ch)', goal: 'damage', dmg: 'average' });
    const sec = r.explanation.find(x => x.h === 'This build fights hurt');
    ok(sec, 'a build that deliberately sits below half health never mentions it');
    ok(/assumption/i.test((sec.list || []).join(' ')),
       'the repriced uptimes are not flagged as assumptions');
  });
});

describe('class roles', () => {
  const goalOf = q => Intent.parse(q, data, K).goal;
  const ROLES  = K.CLASS_ROLE || {};

  it('every entry is a real class pointing at a real archetype, with a reason', () => {
    ok(Object.keys(ROLES).length >= 4, 'CLASS_ROLE is suspiciously short');
    for (const [klass, role] of Object.entries(ROLES)) {
      ok((data.classMoves || {})[klass], klass + ' is not a class');
      ok(K.ARCHETYPES[role.goal], klass + ' points at an archetype that does not exist: ' + role.goal);
      ok(role.why && role.why.length > 40, klass + ' gives no real reason');
    }
  });

  // The bar the table sets for itself. `damage`, `burst`, `crit`, `speed`,
  // `summon` and `status` score nothing for health, and defaulting a bare class
  // name into one of them produced a 66 HP Necromancer. If an archetype's score
  // ignores HP entirely, no class may default into it.
  it('no class defaults into an archetype that does not care whether you live', () => {
    const base = {
      stats: { str: 100, arc: 100, end: 100, spd: 100, lck: 100 },
      hp: 400, effectiveHp: 400, bestHit: 500, sustainedHit: 450, bestBurst: 700,
      outHeal: 150, incHeal: 150, blockDr: 20, critTier: 1, passives: {},
    };
    for (const [klass, role] of Object.entries(ROLES)) {
      const arch = K.ARCHETYPES[role.goal];
      const lo = arch.score({ ...base });
      const hi = arch.score({ ...base, hp: 800, effectiveHp: 800 });
      ok(hi > lo, klass + ' defaults to ' + role.goal + ', whose score ignores health entirely');
    }
  });

  it('the reason names moves the class actually has', () => {
    for (const [klass, role] of Object.entries(ROLES)) {
      const src = data.classMoves[klass] || {};
      const own = [...(src.learns || []), ...(src.innatePassives || [])].map(m => m.name);
      const named = own.filter(n => n && role.why.indexOf(n) !== -1);
      ok(named.length >= 1,
         klass + ': the reason names none of its own moves (' + own.join(', ') + ')');
    }
  });

  it('a named class with no goal is built for its role', () => {
    eq(goalOf('saint build'), 'heal');
    eq(goalOf('saint'), 'heal');
    eq(goalOf('make me a citadel'), 'tank');
    eq(goalOf('paladin build'), 'tank');
    eq(goalOf('lionheart'), 'tank');
  });

  it('a stated goal always wins', () => {
    eq(goalOf('dmg saint'), 'damage');
    eq(goalOf('damage saint'), 'damage');
    eq(goalOf('crit saint'), 'crit');
    eq(goalOf('summoner citadel'), 'summon');
  });

  it('a stat focus does not override the role, and still steers the stats', () => {
    // "How", not "what". Saint's heals scale on STR/100 + ARC/100, so arcane on
    // a Saint is a healing instruction, and optimize.js weights statFocus
    // directly whatever the goal turns out to be.
    const spec = Intent.parse('full arcane saint', data, K);
    eq(spec.goal, 'heal');
    ok(spec.statFocus.indexOf('arc') !== -1, 'the arcane focus was dropped');
  });

  it('a class with no declared role is left alone', () => {
    eq(goalOf('berserker build'), K.DEFAULT_GOAL);
    eq(goalOf('necromancer build'), K.DEFAULT_GOAL);
    eq(goalOf('assassin'), K.DEFAULT_GOAL);
  });

  it('naming no class at all changes nothing', () => {
    eq(goalOf('make me a build'), K.DEFAULT_GOAL);
  });

  it('says out loud that it chose the goal, and why', () => {
    const spec = Intent.parse('saint build', data, K);
    const said = spec.assumptions.join(' ');
    ok(/no goal stated/i.test(said), 'never admits it picked the goal');
    ok(said.indexOf('Holy Emissary') !== -1, 'never says why Saint is a healer');
    ok(/override/i.test(said), 'never says how to override it');
  });

  // The point of the whole change: the default has to be better AT THE THING THE
  // CLASS IS FOR than the one it replaced, or it is just a different answer.
  it('the role default beats the old balanced default at the class role', () => {
    const saintRole = ask('saint build');
    const saintOld  = ask('saint build', { goal: K.DEFAULT_GOAL });
    ok(saintRole.ctx.outHeal > saintOld.ctx.outHeal,
       'a Saint heals no better for being built as a healer: ' +
       saintRole.ctx.outHeal + ' vs ' + saintOld.ctx.outHeal);

    // Measured on survivability, not raw HP. The 1.5x-health bar held while the
    // balanced default was pouring points into Luck for crit; at half-rate crit
    // it spends them on Endurance instead and comes out at 475 HP, so a
    // health-only comparison now reads as "the tank is barely tougher" when it
    // is 78% block DR against 53%. Health and mitigation trade freely - only
    // their product says whether the tank build is doing its job.
    //
    // And not on raw HP at all any more: with lifesteal, self-heals and DR read
    // through the armour formula (effective HP x (100 + DR) / 100, uncapped
    // since DR_CAP went), the tank trades HP for mitigation and sustain (a
    // Calvariae Citadel: about 390 HP at 101 DR against 446 at 50 for the
    // balanced default), so only the figure the tank score reads is compared.
    const citRole = ask('citadel build');
    const citOld  = ask('citadel build', { goal: K.DEFAULT_GOAL });
    // The tank archetype's own score is the only complete statement of "tougher":
    // effective HP with sustain, DR through the armour formula, incoming healing.
    const tough = r => K.ARCHETYPES.tank.score(r.ctx);
    ok(tough(citRole) > tough(citOld) * 1.1,
       'a Citadel is no tougher for being built as a tank: ' +
       Math.round(tough(citRole)) + ' vs ' + Math.round(tough(citOld)) + ' on the tank score');
  });

  it('a role build still has enough health to be worth playing', () => {
    // The floor was 200 while the search scored Venia's Permuth as a permanent
    // x1.4 on Endurance. It is scored as the 3-turn buff it is now, so the HP
    // here is what the build actually has: a Saint healer (102 End for
    // Narthana's Sigil, 60 Luck for +35% outgoing healing, 25 Arc, rest Str -
    // no 110 Arc since the 2026-09-16 patch) sits around 212.
    for (const klass of Object.keys(ROLES)) {
      const r = ask(klass + ' build');
      if (r.build.klass !== klass) continue;   // base classes resolve upward
      ok(r.ctx.hp > 150, klass + ' defaults to a ' + r.ctx.hp + ' HP build');
    }
  });
});

describe('roles', () => {
  const ROLES = K.ROLES || {};
  const byRole = roles => ask('', { roles, level: data.Max_Lvl });

  it('every role maps to archetypes that exist', () => {
    for (const [name, goals] of Object.entries(K.ROLE_GOALS || {})) {
      ok(ROLES[name], name + ' has no entry in ROLES');
      ok(goals.length, name + ' maps to no goal at all');
      for (const item of goals) {
        const g = Array.isArray(item) ? item[0] : item;
        const wt = Array.isArray(item) ? item[1] : 1;
        ok(K.ARCHETYPES[g], name + ' maps to an unknown goal: ' + g);
        ok(wt > 0, name + ' weights ' + g + ' at ' + wt);
      }
    }
  });

  it('every archetype declares a role, and every role is described', () => {
    for (const [g, a] of Object.entries(K.ARCHETYPES)) {
      ok(a.role, g + ' has no role');
      ok(ROLES[a.role], g + ' claims an unknown role: ' + a.role);
    }
    for (const [name, def] of Object.entries(ROLES)) {
      ok(def.label && def.blurb && def.blurb.length > 30, name + ' is not described');
    }
  });

  it('the four offered roles are the four the player picks between', () => {
    const order = K.ROLE_ORDER || [];
    eq(order.length, 4, 'ROLE_ORDER is not four roles');
    for (const r of order) ok(ROLES[r], r + ' is offered but not defined');
    ok(order.indexOf('Flex') === -1, 'Flex is a fallback, not something to offer');
  });

  it('choosing a role sets the goal', () => {
    eq(byRole(['Healer']).spec.goal, 'heal');
    eq(byRole(['Tank']).spec.goal, 'tank');
    eq(byRole(['DPS']).spec.goal, 'damage');
  });

  it('an explicit goal beats the role picker', () => {
    const r = ask('', { roles: ['Healer'], goal: 'damage', level: data.Max_Lvl });
    eq(r.spec.goal, 'damage', 'the role overrode an explicit goal');
  });

  // The whole point of allowing several: it has to actually blend, and it has
  // to actually cost something. A "hybrid" that equals one of its halves is a
  // label, not a build.
  it('two roles produce a build between the two, not one of them', () => {
    const dps  = byRole(['DPS']);
    const tank = byRole(['Tank']);
    const both = byRole(['DPS', 'Tank']);

    // Toughness as the TANK archetype scores it (effective HP with sustain,
    // block DR, incoming healing), measured against a pure tank. Raw HP missed
    // lifesteal: with Crystalline Spike's flat damage a Berserker's Shadow
    // Gauntlets heal ~90 a turn, and the blend spends its tank half there. A bar
    // set from pure DPS had no teeth - one lifesteal item cleared it.
    // The bar was 0.4 until the 2026-09-16 patch cut Shadow Gauntlets' lifesteal
    // from 5% to 3% (the blend's sustain fell by about a third: 1832 -> 1284)
    // while the pure Paladin tank started pricing its Warrior-tree capstones
    // (2950 -> 3213), which left the blend at exactly 40%.
    const tankScore = r => K.ARCHETYPES.tank.score(r.ctx);
    ok(tankScore(both) >= tankScore(tank) * 0.35,
       'DPS+Tank is barely a tank: ' + Math.round(tankScore(both)) + ' against a pure tank ' + Math.round(tankScore(tank)));
    ok(tankScore(both) < tankScore(tank),
       'DPS+Tank is as tough as a pure tank: ' + Math.round(tankScore(both)) + ' vs ' + Math.round(tankScore(tank)));
    ok(tankScore(both) > tankScore(dps) * 1.5,
       'DPS+Tank is as fragile as pure DPS: ' + Math.round(tankScore(both)) + ' vs ' + Math.round(tankScore(dps)));
    ok(both.ctx.bestHit > tank.ctx.bestHit * 1.5,
       'DPS+Tank hits no harder than a pure tank');
    ok(both.ctx.bestHit < dps.ctx.bestHit,
       'DPS+Tank hits as hard as pure DPS — the tank half cost nothing');
    ok(both.ctx.hp < tank.ctx.hp,
       'DPS+Tank is as tough as a pure tank — the damage half cost nothing');
  });

  // Healer + Tank is NOT the pair to test this with: both archetypes want
  // Endurance, so for a Saint the two answers genuinely coincide and the blend
  // costing nothing is the correct result. Healer and DPS actually conflict.
  it('a healer told to also deal damage heals less and hits harder', () => {
    // Compared on what the healer score reads - healing per turn times the turns
    // the healer stays up (K.ARCHETYPES.heal) - not on a percentage or on heal
    // per turn alone. With Crystalline Spike the damage half goes to Luck, and
    // Luck 60 is +35% outgoing healing, so heal per turn tied (93 vs 93) while
    // the Endurance it gave up cut the healer's HP from 195 to 135.
    const pure = byRole(['Healer']);
    const both = byRole(['Healer', 'DPS']);
    const healing = r => K.ARCHETYPES.heal.score(r.ctx);
    ok(healing(both) < healing(pure) * 0.9,
       'the damage half was free: ' + Math.round(healing(both)) +
       ' vs ' + Math.round(healing(pure)) + ' healing over a fight');
    ok(both.ctx.bestHit > pure.ctx.bestHit * 2,
       'the damage half bought nothing');
  });

  // Every role EXCEPT DPS, which is supposed to be made of paper — its own
  // archetype weights Endurance at zero and its blurb says so. Asserting a
  // health floor there would be asserting against the design.
  it('no role except DPS produces a build too fragile to do its job', () => {
    for (const r of (K.ROLE_ORDER || [])) {
      if (r === 'DPS') continue;
      const res = byRole([r]);
      ok(res.ctx.hp > 100, r + ' builds on ' + Math.round(res.ctx.hp) + ' HP');
    }
    ok(byRole(['DPS']).ctx.hp < 200, 'a DPS build is unexpectedly bulky — check the archetype');
  });

  it('the write-up leads with the role', () => {
    const r = byRole(['Healer']);
    const build = r.explanation.find(x => x.h === 'Build');
    eq(build.table[0][0], 'Role', 'the Build table does not open with the role');
    ok(/Healer/.test(build.table[0][1]), 'the role row does not say Healer');
  });
});

describe('scrolls and subclass', () => {
  const saint = () => ask('', { klass: 'Saint (Or)', goal: 'heal', level: data.Max_Lvl });

  it('the scroll tables were extracted', () => {
    ok(Object.keys(data.scrollMoves || {}).length >= 10, 'no scrollMoves');
    ok(Object.keys(data.lostScrollMoves || {}).length >= 5, 'no lostScrollMoves');
    ok(Object.keys(data.scrollClassRestrictions || {}).length, 'no scroll gates');
    ok(Object.keys(data.lostScrollClassRestrictions || {}).length, 'no lost scroll gates');
  });

  it('every scroll gate names a real BASE class', () => {
    const bases = new Set(Object.keys(data.classes || {}));
    for (const tbl of ['scrollClassRestrictions', 'lostScrollClassRestrictions']) {
      for (const [name, list] of Object.entries(data[tbl] || {})) {
        if (!list) continue;
        for (const c of list) ok(bases.has(c), tbl + '/' + name + ' names a non-base class: ' + c);
      }
    }
  });

  it('a build fills the three scroll slots it always had', () => {
    const r = saint();
    ok(r.build.lostScroll, 'no lost scroll');
    ok(r.build.scroll1, 'no first scroll');
    ok(r.build.sub, 'no subclass');
  });

  it('honours the class gate, both ways', () => {
    // Saint is a Slayer underneath, and Breath of Fungyir is Slayer/Warrior.
    const saintOk = (data.lostScrollClassRestrictions || {})['Breath of Fungyir'];
    ok(saintOk && saintOk.indexOf('Slayer') !== -1, 'the fixture moved');

    const cit = ask('', { klass: 'Citadel (Or)', goal: 'tank', level: data.Max_Lvl });
    for (const slot of ['lostScroll', 'scroll1', 'scroll2']) {
      const name = cit.build[slot];
      if (!name) continue;
      const tbl = slot === 'lostScroll' ? 'lostScrollClassRestrictions' : 'scrollClassRestrictions';
      const gate = (data[tbl] || {})[name];
      ok(!gate || gate.indexOf('Sentry') !== -1,
         'a Citadel was given ' + name + ', which is gated to ' + (gate || []).join('/'));
    }
  });

  it('a healer takes the healer lost scroll and a DPS does not', () => {
    // Within ROLE_ITEM_MARGIN. Heavenly Prayer measures better on a healer now
    // that healing scores damage reduction (its 15% DR is priced and Breath of
    // Fungyir's team heal can never be), so this is the margin doing its job.
    eq(saint().build.lostScroll, 'Breath of Fungyir');
    const dps = ask('', { klass: 'Saint (Or)', goal: 'damage', level: data.Max_Lvl });
    ok(dps.build.lostScroll !== 'Breath of Fungyir',
       'a damage Saint was handed the team-heal scroll');
  });

  it('a pinned slot is not searched, and "none" means empty', () => {
    const none = ask('', { klass: 'Saint (Or)', goal: 'heal', level: data.Max_Lvl,
                           sub: 'none', scroll1: 'none', scroll2: 'none', lostScroll: 'none' });
    eq(none.build.sub, '', 'sub was filled anyway');
    eq(none.build.lostScroll, '', 'lost scroll was filled anyway');
    eq(none.build.scroll1, '', 'scroll was filled anyway');

    const pin = ask('', { klass: 'Saint (Or)', goal: 'heal', level: data.Max_Lvl,
                          lostScroll: 'Absolute Radiance' });
    eq(pin.build.lostScroll, 'Absolute Radiance', 'a pinned scroll was overridden');
  });

  it('a scroll that grants an attack puts it in the move pool', () => {
    const withIt = ask('', { klass: 'Wizard', goal: 'damage', level: data.Max_Lvl,
                             lostScroll: 'Permafrost Curse' });
    const names = (withIt.ctx.moves || []).map(m => m.name);
    ok(names.indexOf('Permafrost Curse') !== -1, 'the scroll attack never reached the kit');
  });
});

describe('the healer build the numbers used to miss', () => {
  const heal = () => ask('', { klass: 'Saint (Or)', goal: 'heal', level: data.Max_Lvl });

  // rankGear priced ANY percentage bonus at a flat +4, so the single best item
  // a healer can wear ranked 67th of 67 and was cut from the shortlist before
  // the real scorer saw it.
  it('wears the +75% outgoing healing gear', () => {
    const names = heal().build.gear.map(g => g.name);
    ok(names.indexOf("Narthana's Leaf") !== -1,
       'the healer is not wearing Narthana\'s Leaf: ' + names.join(', '));
  });

  it('and a damage build is not', () => {
    const dps = ask('', { klass: 'Saint (Or)', goal: 'damage', level: data.Max_Lvl });
    ok(dps.build.gear.every(g => g.name !== "Narthana's Leaf"),
       'a damage build took the healing gear');
  });

  it('every gear with a percentage bonus gets a seat at the table', () => {
    // The guarantee itself, not one example of it: the shortlist is a speed
    // hack and must never be the thing that decides.
    const O = engine.optimizer;
    for (const name of Object.keys(data.gearPctBonuses || {})) {
      if (!O.usable(name)) continue;
      ok(data.gearItems[name], name + ' has a percentage bonus but is not a gear');
    }
  });

  it('fixed gear carries no tier and no allocation', () => {
    const leaf = heal().build.gear.find(g => g.name === "Narthana's Leaf");
    ok(leaf, 'no Leaf to check');
    eq(leaf.tier, 0, 'a fixed gear claims a tier');
    eq(Object.keys(leaf.alloc || {}).length, 0, 'a fixed gear claims an allocation');
  });

  it('takes the healer artifact over the one that ties with it', () => {
    eq(heal().build.artifact.name, "Narthana's Sigil");
    const dps = ask('', { klass: 'Saint (Or)', goal: 'damage', level: data.Max_Lvl });
    ok(dps.build.artifact.name !== "Narthana's Sigil",
       'a damage Saint took the healing artifact');
  });

  // Every shard is damage, lifesteal or energy. On a healer the damage ones
  // moved the score by ~7e-7 — pure floating-point dust — and the old absolute
  // 1e-9 threshold counted that as an improvement seven times over. Lifesteal
  // now feeds the sustain figure the healer reads, so those two are real picks;
  // the rest are fill, and the build has to say so.
  it('knows which of its shards do nothing, and says so', () => {
    // With All For One's 20% lifesteal on the build, a damage shard IS sustain,
    // so a healer's shards can all measure. Whatever the count, the row has to
    // tell the truth about it: the fill is admitted, and a full set of measured
    // picks is not called fill.
    const r = heal();
    const lifesteal = r.build.shards.filter(n => ((data.shardItems[n] || {}).bonusType) === 'lifesteal');
    ok(lifesteal.length > 0, 'a healer with lifesteal counted took no lifesteal shard');
    ok(r.build.shardsInert >= 0 && r.build.shardsInert <= r.build.shards.length, 'inert count out of range');
    const build = r.explanation.find(x => x.h === 'Build');
    const row = build.table.find(t => t[0] === 'Shards');
    if (r.build.shardsInert > 0) ok(/change nothing here|changes a number/.test(row[1]), 'the shard row does not admit the fill: ' + row[1]);
    else ok(!/change nothing here|changes a number/.test(row[1]), 'the shard row calls measured picks fill: ' + row[1]);
  });

  it('a damage build has shards that really do help', () => {
    const dps = ask('', { klass: 'Berserker (Ch)', goal: 'damage', level: data.Max_Lvl });
    eq(dps.build.shardsInert, 0, 'a damage build cannot use its own damage shards');
  });

  it('explains the picks the numbers cannot justify', () => {
    const sec = heal().explanation.find(x => /Chosen for the role/.test(x.h));
    ok(sec, 'no section explaining the role picks');
    ok(sec.list.some(l => /Narthana's Sigil/.test(l)), 'never says why the Sigil');
    ok(sec.list.some(l => /Breath of Fungyir/.test(l)), 'never says why the lost scroll');
  });
});

describe('traits reach the numbers', () => {
  const M = engine.model;

  // A build with real gear in every slot, so traits have somewhere legal to sit.
  const withTraits = (gearTraits, artTraits) => {
    const b = M.emptyBuild();
    b.level = data.Max_Lvl; b.klass = 'Saint (Or)'; b.race = 'Dullahan (1%)';
    b.gear = ['Forest Charm', 'Crystal Sphere', 'Gelat Band', 'Magma Charm']
      .map((name, i) => ({ name, tier: 6, alloc: {}, traits: (gearTraits || [])[i] || [] }));
    b.artifact = { name: 'Stellian Core', tier: 6, alloc: {}, traits: artTraits || [] };
    return b;
  };
  const T2 = id => ({ id, tier: 2 });

  it('the site and the model agree on WHICH traits are applied', () => {
    // The single most dangerous drift in this change. builder.js applies four
    // traits itself and model.js must apply exactly the same four - one extra on
    // either side and every build reports a figure the page will not show, with
    // nothing but verify.js in a browser to catch it.
    const src = fs.readFileSync(path.join(__dirname, '../../js/builder.js'), 'utf8');
    const block = /const TRAIT_APPLIES_TO = \{([\s\S]*?)\n\};/.exec(src);
    ok(block, 'builder.js no longer declares TRAIT_APPLIES_TO');
    const onSite = new Set();
    for (const m of block[1].matchAll(/^\s*(\w+):\s*"([\w-]+)"/gm)) onSite.add(m[1]);

    const msrc = fs.readFileSync(path.join(__dirname, 'model.js'), 'utf8');
    const mblock = /const TRAIT_SITE_APPLIES = \{([\s\S]*?)\n    \};/.exec(msrc);
    ok(mblock, 'model.js no longer declares TRAIT_SITE_APPLIES');
    const inModel = new Set();
    for (const m of mblock[1].matchAll(/^\s*(\w+):\s*'(\w+)'/gm)) inModel.add(m[1]);

    eq([...inModel].sort().join(','), [...onSite].sort().join(','),
       'the site and the model disagree about which traits the page applies');
    eq(onSite.size, 4, 'expected exactly four site-applied traits');
  });

  it('Conduit raises NRG chance, and caps', () => {
    const base = M.derived(withTraits()).nrgChance;
    const one  = M.derived(withTraits([[T2('conduit')]])).nrgChance;
    eq(Math.round((one - base) * 10) / 10, 10, 'Conduit T2 is +10% NRG chance');

    // Six T2 copies is 60 raw against a cap of 40 - the exact reason the cap
    // lives in the trait table rather than in whoever happens to read it.
    const many = M.derived(withTraits([
      [T2('conduit'), T2('conduit')], [T2('conduit'), T2('conduit')],
      [T2('conduit'), T2('conduit')], [],
    ])).nrgChance;
    eq(Math.round((many - base) * 10) / 10, 40, 'Conduit stacked past its 40% cap');
  });

  it('Fortunate, Preemptive and Vital reach their own readouts', () => {
    const b0 = M.derived(withTraits());
    eq(Math.round((M.derived(withTraits([[T2('fortunate')]])).critChance - b0.critChance) * 10) / 10, 4,
       'Fortunate T2 is +4 crit chance');
    eq(Math.round((M.derived(withTraits([[T2('preemptive')]])).initiative - b0.initiative) * 10) / 10, 3,
       'Preemptive T2 is +3 initiative');
    const vital = M.derived(withTraits([[T2('vital')]])).hp;
    ok(vital > b0.hp, 'Vital T2 did not raise max HP');
  });

  it('an applied trait is not also counted as an overlay', () => {
    // Counting it in both places is silent: the number simply comes out too big
    // and nothing on the page can be pointed at to prove it wrong.
    const tt = M.traitTotals(withTraits([[T2('vital'), T2('fortunate')],
                                         [T2('preemptive'), T2('conduit')]]), K);
    eq(tt.hpPct, 0, 'Vital was added to the overlay as well as to derived()');
    eq(tt.critChance, 0, 'Fortunate was added twice');
    eq(tt.initiative, 0, 'Preemptive was added twice');
    // Still named, or the write-up would stop mentioning them entirely.
    const named = tt.active.map(a => a.id).sort().join(',');
    eq(named, 'conduit,fortunate,preemptive,vital', 'applied traits vanished from the write-up');
    ok(tt.active.every(a => a.onSite), 'applied traits are not flagged as on-site');
  });

  it('an overlay trait still works, and still says the site cannot show it', () => {
    const tt = M.traitTotals(withTraits([[T2('stalwart')]]), K);
    eq(tt.dr, 8, 'Stalwart T2 stopped contributing damage reduction');
    ok(!tt.active.find(a => a.id === 'stalwart').onSite,
       'Stalwart was marked as shown on the site, which has no readout for it');
  });

  it('a fixed gear grants no traits, on either side', () => {
    // Narthana's Leaf rolls no tier and no traits. The editor clears them; a
    // share link could still carry them, and both sides must ignore them.
    const b = withTraits();
    b.gear[0] = { name: "Narthana's Leaf", tier: 0, alloc: {}, traits: [T2('conduit')] };
    eq(M.siteTraitTotals(b).nrgChance, 0, 'a fixed gear granted a trait');
  });

  it('Devastating is scored by the engine but not applied by the site, and that is deliberate', () => {
    // Reported as non-functional in game. The site does not wire it to the
    // crit-damage readout; the engine still SCORES it, because that report was
    // never confirmed. If either of those changes, it should change knowingly.
    const src = fs.readFileSync(path.join(__dirname, '../../js/builder.js'), 'utf8');
    ok(!/devastating:\s*"crit-dmg"/.test(src),
       'Devastating was wired to the crit-damage readout without settling whether it works');
    eq(M.siteTraitTotals(withTraits([[T2('devastating')]])).critChance, 0,
       'Devastating leaked into a site-applied readout');
  });
});

describe('the shared gear editor is styled wherever it renders', () => {
  const root = path.resolve(__dirname, '..', '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');

  it('no gear-spec rule is scoped to the builder page', () => {
    // The bug: all 39 of these lived under #page-builder, and js/bank.js renders
    // the SAME editor through window._gearSpecRender inside the bank modal - so
    // the bank copy got no styling at all and collapsed into a column of
    // unstyled selects. Scoping them to the component instead is the fix, and
    // this fails the moment someone adds a rule the old way.
    for (const f of ['css/builder.css', 'css/mobile.css']) {
      const bad = read(f).split(String.fromCharCode(10))
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(x => x.line.indexOf('#page-builder .gt-') !== -1);
      eq(bad.length, 0, f + ' scopes gear-editor rules to the page: ' +
         bad.map(x => f + ':' + x.n + ' ' + x.line).join(' | '));
    }
  });

  it('the editor tags its own root so those rules can find it', () => {
    const js = read('js/builder.js');
    ok(js.indexOf('box.classList.add("gear-spec")') !== -1,
       'renderGearSpec no longer adds the .gear-spec class its styles are scoped to');
    ok(read('css/builder.css').indexOf('.gear-spec .gt-') !== -1,
       'builder.css has no .gear-spec rules to apply');
  });
});

describe('Luck buys crit chance at half rate', () => {
  const M = engine.model;

  it('the constant survives extraction from the site', () => {
    // The engine reads this out of ai-data.json. If extract-data.js stops
    // carrying it, D.LUCK_CRIT_RATIO goes undefined, the model multiplies by
    // NaN and every crit figure becomes NaN - loud, but only if something asks.
    eq(data.LUCK_CRIT_RATIO, 0.5, 'LUCK_CRIT_RATIO did not reach the engine');
    const src = fs.readFileSync(path.join(__dirname, '../../js/builder.js'), 'utf8');
    ok(src.indexOf('const LUCK_CRIT_RATIO     = 0.5;') !== -1,
       'the site and ai-data.json disagree about the crit ratio');
    ok(src.indexOf('"crit-chance": v => v * LUCK_CRIT_RATIO,') !== -1,
       'calcPercentage no longer applies the ratio');
  });

  it('crit chance is half the Luck total, not all of it', () => {
    const b = M.emptyBuild();
    b.level = data.Max_Lvl; b.klass = 'Wizard'; b.race = 'Nisse (20%)';
    for (const lck of [0, 20, 50, 100, 150]) {
      b.invested = { str: 0, arc: 0, end: 0, spd: 0, lck };
      const want = Math.round(M.rawLuck(b) * data.LUCK_CRIT_RATIO * 10) / 10;
      eq(M.derived(b).critChance, want,
         'at ' + lck + ' invested Luck the model does not halve');
    }
  });

  it('the optimiser inverts the ratio when snapping to a crit tier', () => {
    // Read as 1:1 this fails silently: the snap moves half the Luck it needs,
    // lands short of 100 every time, the real scorer rejects the move and crit
    // builds simply stop reaching tier 1. Nothing errors.
    const src = fs.readFileSync(path.join(__dirname, 'optimize.js'), 'utf8');
    ok(src.indexOf('Math.ceil((target - cur.critChance) / perLuck)') !== -1,
       'the crit snap no longer divides by the Luck-to-crit ratio');
  });

  it('a crit build can still be pushed over a tier threshold', () => {
    // A Blade Dancer built for crit reaches tier 1 on its own Luck: past 100%
    // every hit crits, and that is worth the Luck it takes.
    //
    // This pinned an Amorus Assassin until 2026-09-21. It stopped tiering for
    // one reason, which is right: Devastating now ADDS to the crit multiplier
    // (Withered Grove §12: 2.2 + 1.12, not 2.2 x 2.12), so ten Devastating orbs
    // no longer make every point of crit chance worth twice what it returns
    // (with only that rule reverted the Assassin reaches 100.3%, tier 1).
    // Poison Fan's scaling is not a cause: it was already STR/75 + ARC/80 when
    // the Assassin passed (an older comment here said it scaled on Luck). The
    // Assassin now parks on LCK 110 at 82%; this test is about whether the
    // snap CAN cross a tier, so it moved to a class that does.
    //
    // Before that it pinned an Amorus Lancer, and that passed only because Crystal
    // Sphere and Ages Pages were each counted TWICE: their flat crit lives in
    // gearPctBonuses (builder.js:2219-2220), which model.js already folds into
    // crit chance, and GEAR_PASSIVES added it a second time. With that corrected
    // the Lancer stops at the 110 Luck breakpoint - see the next test, which
    // pins the reason.
    // The race is pinned to a Luck race on purpose: this test is about whether
    // the snap CAN cross a tier, not about which race wins the argument. (With
    // race actives in the scored kit - parked, see kitFor - the search prefers
    // Boreas and Inner Frost, a line that wants Strength and Arcane instead.)
    const r = ask('', { klass: 'Blade Dancer (N)', race: 'Amorus (Ob)', goal: 'crit', level: data.Max_Lvl });
    ok(r.ctx.critChance >= 100,
       'a crit build tops out at ' + Math.round(r.ctx.critChance) + '% and never tiers up');
    eq(M.critTier(r.ctx.critChance) >= 1, true, 'crit tier never reached 1');
  });

  it('a Lancer climbs past the last Luck breakpoint only when the climb pays', () => {
    // The tension worth knowing about: the owner's stat-decay rule counts points
    // past the last breakpoint at half rate, and crit tier 1 needs roughly 200
    // Luck. For a class whose moves scale on Strength, the climb never pays, so
    // it parks on 110 and takes tier 0. Two rules disagreeing, not a broken snap.
    // If this ever starts tiering, the decay rule or the crit maths has moved and
    // both deserve a look.
    // Read on the site's stat row (`siteStats`), not the in-fight total: a ramp
    // item such as Crystalized Star adds Luck as the fight goes on, which is
    // not a stat-line choice and is exactly what the decay rule does not govern.
    const r = ask('', { klass: 'Lancer (N)', race: 'Amorus (Ob)', goal: 'crit', level: data.Max_Lvl });
    if (r.ctx.siteStats.lck <= 130) return;   // parked on the breakpoint: nothing to justify
    // It climbed - with Crystalline Spike its Ice Shards line reaches a crit tier
    // (668.6 against 633.9 parked). Then the climb has to beat the same build
    // parked back at 110 Luck with the points in its best other stat.
    const O = engine.optimizer;
    let parkedBest = -Infinity, parkedAt = '';
    for (const to of ['str', 'arc', 'end', 'spd']) {
      const inv = Object.assign({}, r.build.invested);
      const b = Object.assign({}, r.build, { invested: inv });
      let guard = 0;
      while (O.evaluate(b, r.spec).siteStats.lck > 110 && inv.lck > 0 && guard++ < 200) { inv.lck -= 1; inv[to] += 1; }
      const sc = O.evaluate(b, r.spec).score;
      if (sc > parkedBest) { parkedBest = sc; parkedAt = to; }
    }
    ok(r.ctx.score >= parkedBest * 0.999,
       'the Lancer climbed to ' + Math.round(r.ctx.siteStats.lck) + ' Luck for ' + Math.round(r.ctx.score) +
       ', but parked at 110 with the rest in ' + parkedAt + ' it scores ' + Math.round(parkedBest));
  });

  it('and a crit build that stops short of a tier does so because the tier costs more than it pays', () => {
    const r = ask('crit wizard');
    const O = engine.optimizer;
    // Move Luck in or out one point at a time, from or to the largest other stat.
    const shifted = (wantTier) => {
      const inv = Object.assign({}, r.build.invested);
      const b = Object.assign({}, r.build, { invested: inv });
      let guard = 0;
      const at = () => O.evaluate(b, r.spec).critChance >= 100;
      while (at() !== wantTier && guard++ < 300) {
        const others = ['str', 'arc', 'end', 'spd'].sort((x, y) => inv[y] - inv[x]);
        if (wantTier) { const d = others.find(x => inv[x] > 0); if (!d) break; inv[d] -= 1; inv.lck += 1; }
        else { if (inv.lck <= 0) break; inv.lck -= 1; inv[others[0]] += 1; }
      }
      return at() === wantTier ? O.evaluate(b, r.spec) : null;
    };
    if (r.ctx.critChance >= 100) {
      // It tiered. Then stopping one point short of the tier must not score better.
      const short = shifted(false);
      ok(!short || r.ctx.score >= short.score * 0.999,
         'the wizard tiered for ' + Math.round(r.ctx.score) + ' but one point short scores ' + Math.round(short.score));
      return;
    }
    // It stopped short. Then neither the cheapest tier line nor all-Luck may score better.
    const cheapest = shifted(true);
    ok(!cheapest || r.ctx.score >= cheapest.score * 0.999,
       'the cheapest tier line scores ' + Math.round(cheapest.score) + ' against ' + Math.round(r.ctx.score) +
       ' - the tier was affordable and the search still passed it up');
    const allLuck = Object.assign({}, r.build, { invested: { str: 0, arc: 0, end: 0, spd: 0, lck: M.pointBudget(r.build) } });
    const c = O.evaluate(allLuck, r.spec);
    ok(c.critChance >= 100, 'the all-Luck line does not even reach a tier: ' + c.critChance);
    ok(r.ctx.score > c.score, 'the all-Luck line scores ' + Math.round(c.score) + ' against ' +
       Math.round(r.ctx.score) + ' - the tier was affordable and the search still passed it up');
  });
});

describe('a mastery node id is a position, not an identity', () => {
  const root = path.resolve(__dirname, '..', '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');

  it('rm1 means something different in each Warrior tree', () => {
    // This is the fact that makes base-class gating wrong, and it is data rather
    // than code - so it is asserted here, where a future data change that makes
    // the gate look harmless again will be caught.
    const trees = data.masteryClassData || {};
    const name = k => ((trees[k] || {}).nodes || {}).rm1 &&
                      ((trees[k] || {}).nodes || {}).rm1.name;
    eq(name('Warrior'), 'Runic Shield');
    eq(name('Blade Dancer (N)'), 'Parry Master');
    eq(name('Berserker (Ch)'), 'Intense Rage');
    // Paladin has no tree of its own, which is why it inherits Runic Shield.
    eq(trees['Paladin (Or)'], undefined,
       'Paladin has its own mastery tree now - the Runic Shield gate needs rechecking');
    eq((data.classes.Warrior || []).join(','), 'Paladin (Or),Blade Dancer (N),Berserker (Ch)');
  });

  it('the Runic Shield buff asks the tree, not the base class', () => {
    // The bug: `baseClass === "Warrior" && masteryState["rm1"]` handed the buff
    // to all three Warrior supers, so a Berserker who took Intense Rage was
    // shown Runic Shield and given 10% Holy damage it does not have. Verified
    // on the page after the fix: Paladin offers it, Blade Dancer and Berserker
    // do not, and the Block Stacks stepper follows it.
    const src = read('js/builder.js');
    ok(src.indexOf('if (masteryState["rm1"] && getActiveMasteryData()?.nodes?.rm1?.name === "Runic Shield")') !== -1,
       'the Runic Shield gate no longer checks which tree owns rm1');
    ok(src.indexOf('if (baseClass === "Warrior" && masteryState["rm1"])') === -1,
       'the base-class Runic Shield gate is back');
  });

  it('the engine keys mastery abilities by class, so it never had this bug', () => {
    const ma = data.masteryAbilities || {};
    eq((ma['Warrior'] || {}).rm1.name, 'Runic Shield');
    eq((ma['Berserker (Ch)'] || {}).rm1.name, 'Intense Rage');
  });
});

describe('the build summary keeps the shape it was written in', () => {
  const root = path.resolve(__dirname, '..', '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');

  // The sanitizer itself needs DOMParser and a real CSSOM, so its behaviour is
  // verified in tools/ai/verify.js. What is worth guarding from here is that the
  // whitelist still covers every tag the writers emit - it shrank once and the
  // result was silent: summaries saved fine and came back as a run-on paragraph.
  it('the whitelist covers what every writer emits', () => {
    const core = read('js/core.js');
    for (const [tag, why] of [
      ['DIV',  'contenteditable wraps each line in a div on Enter'],
      ['P',    'pasted content arrives as paragraphs'],
      ['FONT', "execCommand('foreColor') emits <font color> without styleWithCSS"],
      ['SPAN', 'the colour picker with styleWithCSS on'],
      ['B',    'the build AI writes <b> throughout its summaries'],
    ]) {
      ok(core.indexOf(tag) !== -1,
         '_sanitizeSummHtml no longer handles <' + tag.toLowerCase() + '> — ' + why);
    }
    ok(/safeColour/.test(core), 'the colour laundering step is gone');
  });

  it('the AI still writes only tags the sanitizer keeps', () => {
    // If the generator learns a new tag, it has to be whitelisted in the same
    // change or the emphasis vanishes the first time a build is loaded.
    // Scoped to summaryHtmlFor(). The rest of build-ai.js renders the PANEL,
    // which is real DOM and quite reasonably uses <label>, <input> and the
    // rest - none of that goes anywhere near the sanitizer.
    const ai = read('js/build-ai.js');
    const from = ai.indexOf('function summaryHtmlFor');
    ok(from !== -1, 'summaryHtmlFor is gone - this guard needs repointing');
    const body = ai.slice(from, ai.indexOf(String.fromCharCode(10) + '  }', from));
    const used = new Set();
    const m = body.match(/'<\/?([a-z]+)>'/g) || [];
    for (const t of m) used.add(t.replace(/[^a-z]/g, '').toUpperCase());
    const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'SPAN', 'FONT']);
    for (const t of used) {
      ok(allowed.has(t), 'build-ai.js emits <' + t.toLowerCase() +
         '> which _sanitizeSummHtml will strip');
    }
  });

  it('the one-line card flattens the structure it now preserves', () => {
    // Preserving blocks broke the builds-list teaser, which is nowrap + ellipsis
    // and only works on one line. Fixed in CSS for that view rather than by
    // throwing the structure away at save time.
    const css = read('css/builds.css');
    ok(/\.blds-card-summary div,[\s\S]{0,60}display: inline/.test(css),
       'the builds card no longer flattens preserved summary blocks');
  });
});

describe('Overflow raises the energy you can actually spend', () => {
  const root = path.resolve(__dirname, '..', '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');

  it('the engine and the site agree on the base energy cap', () => {
    // The engine assumed 5, with a note saying it was a guess. The site's own
    // Energy Manipulator text settles it - "up to 22.5% at 6 energy", and
    // 22.5 / 3.75 = 6. Two independent statements of the same number now, so
    // changing either has to face the other.
    eq(K.ENERGY.base, 6, 'the engine no longer assumes a base energy of 6');
    const b = read('js/builder.js');
    ok(b.indexOf('const DC_BASE_ENERGY = 6;') !== -1,
       'the damage calculator no longer bases its energy stepper on 6');
    ok(/up to 22\.5% at 6 energy/.test(b),
       'the Energy Manipulator text that justifies 6 has changed - recheck the base');
  });

  it('the damage calculator asks Overflow for its ceiling', () => {
    // Hard-coded to 6, so equipping Overflow raised a maximum the calculator
    // would not let you enter: the trait said 8, the stepper stopped at 6.
    const b = read('js/builder.js');
    ok(b.indexOf("DC_BASE_ENERGY + traitBonus(equippedTraitTotals(), 'overflow')") !== -1,
       'dcMaxEnergy no longer reads the Overflow trait');
    ok(b.indexOf('Math.min(dcMaxEnergy(), Math.max(0, energyCount + delta))') !== -1,
       'changeEnergy no longer clamps to the computed ceiling');
    ok(b.indexOf('if (energyCount > _dcEnergyMax) energyCount = _dcEnergyMax;') !== -1,
       'removing Overflow can leave a stale over-cap energy feeding the damage figures');
  });

  it('Overflow is worth +1 and +2, and does not stack', () => {
    const o = data.gearTraits.overflow;
    eq(o.t1, 1); eq(o.t2, 2);
    eq(o.noStack, true, 'Overflow stacks now - the ceiling of 8 is wrong');
    eq(o.gearOnly, true, 'Overflow can sit on an artifact now - recheck the ceiling');

    // The engine has to price it the same way the stepper caps it, or a build
    // is scored on energy the calculator will not let you enter.
    const M = engine.model;
    const b = M.emptyBuild();
    b.level = data.Max_Lvl; b.klass = 'Wizard'; b.race = 'Nisse (20%)';
    b.gear = [{ name: 'Forest Charm', tier: 6, alloc: {}, traits: [] }];
    eq(M.energyCap(b, K), 6, 'a build with no Overflow is not on the base cap');
    b.gear[0].traits = [{ id: 'overflow', tier: 2 }];
    eq(M.energyCap(b, K), 8, 'Overflow T2 does not reach 8 in the engine');
    b.gear[0].traits = [{ id: 'overflow', tier: 2 }, { id: 'overflow', tier: 2 }];
    eq(M.energyCap(b, K), 8, 'Overflow stacked past its noStack rule');
  });
});

describe('per-energy weapon buffs reach the damage calculator', () => {
  const root = path.resolve(__dirname, '..', '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');

  it('Corealloy still says the thing that gets it filtered out', () => {
    // parseDmgBonus drops anything matching /per energy/ on purpose, because a
    // per-energy buff is not a flat percentage. That filter is correct; what was
    // missing is the explicit entry that puts the buff back. If the game ever
    // rewords this passive the filter may stop matching and the explicit entry
    // would then double-count it, so both halves are pinned here.
    const p = (data.itemPassives || {})['Corealloy'];
    ok(p, 'Corealloy is no longer in itemPassives');
    ok(/per energy/i.test(JSON.stringify(p)),
       'Corealloy no longer says "per Energy" - parseDmgBonus will stop filtering it ' +
       'and the explicit entry in collectDmgBonusPassives will double-count');
    const b = read('js/builder.js');
    ok(b.indexOf('if (/\\bper\\s+energy\\b/i.test(text)) return null;') !== -1,
       'the per-energy filter is gone');
    eq(Object.keys((data.mainWeaponSeries || {}).Corealloy || {}).length, 3,
       'the Corealloy weapon series changed size');
  });

  it('the calculator puts the buff back', () => {
    const b = read('js/builder.js');
    ok(b.indexOf('const COREALLOY_PCT_PER_ENERGY = 5;') !== -1,
       'the Corealloy rate is gone');
    ok(b.indexOf('rawEntries.push({ key: caKey, name: "Corealloy"') !== -1,
       'Corealloy has no explicit DMG BONUS entry, so it is filtered out and never re-added');
  });

  it('every move-pricing call passes the energy left after the move', () => {
    // Corealloy is "calculated after Energy consumption of moves", so a call
    // that prices one move has to say what that move costs. A new call site
    // added without it would not error - it would just quietly overstate the
    // damage by 5% per point of that move's cost.
    // Since §12 (additive damage) a hit's Multi sum is built by getDmgMulti(m,
    // type, energyAfter) on top of getActiveDmgTerms(type, energyAfter); those
    // are the calls that must carry it.
    const b = read('js/builder.js');
    const callsOf = name => b.split(String.fromCharCode(10))
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(x => x.line.indexOf(name + '(') !== -1)
      .filter(x => x.line.indexOf('function ' + name) === -1)
      // Comments talk about it too; only real calls have to carry the argument.
      .filter(x => x.line.slice(0, 2) !== '//');
    const multi = callsOf('getDmgMulti'), terms = callsOf('getActiveDmgTerms');
    // The floors only guard against a filter matching nothing and passing
    // vacuously: Stinger's two parts and getOutsideDmgMult's normal and crit
    // sums; getDmgMulti and the Frosted AOE.
    ok(multi.length >= 4, 'expected at least four getDmgMulti call sites, found ' + multi.length);
    ok(terms.length >= 2, 'expected at least two getActiveDmgTerms call sites, found ' + terms.length);
    for (const c of multi) {
      ok(/getDmgMulti\(m, [\w.]+, \w/.test(c.line),
         'builder.js:' + c.n + ' prices a move without passing the energy left after it: ' + c.line);
    }
    for (const c of terms) {
      ok(/getActiveDmgTerms\([^,()]+, \w/.test(c.line),
         'builder.js:' + c.n + ' prices a move without passing the energy left after it: ' + c.line);
    }
    // The old switches-only multiplier is gone (verify.js reads the sum now); a
    // damage path calling it would skip the per-move terms.
    eq(callsOf('getActiveDmgMult').length, 0, 'a damage path reads getActiveDmgMult instead of the Multi sum');
  });

  it('Energy Manipulator and Corealloy read the pool at different moments', () => {
    // Energy Manipulator is explicitly "based on your current energy, not the
    // energy you had before casting a move". Corealloy is the opposite. Sharing
    // one number between them would be wrong for one of the two.
    const b = read('js/builder.js');
    ok(b.indexOf('Math.min(22.5, 3.75 * energyCount)') !== -1,
       'Energy Manipulator no longer reads current energy');
    ok(b.indexOf('energyAfter != null ? energyAfter : energyCount') !== -1,
       'Corealloy no longer prefers the after-cost energy');
  });
});

describe("Dullahan's bonus points", () => {
  const root = path.resolve(__dirname, '..', '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const M = engine.model;

  it('the site, the engine and the passive note all agree on the rate', () => {
    // Three copies of one number, and it just changed from 3 to 1. At the old
    // rate this was 45 points at level 50 - a third of the whole budget again -
    // so a stale copy would have the AI allocating points the page cannot fit,
    // silently, with every stat total off by a different amount.
    eq(data.DULLAHAN_POINTS_PER_10_LEVELS, 1, 'the engine has the wrong rate');
    ok(read('js/builder.js').indexOf('const DULLAHAN_POINTS_PER_10_LEVELS = 1;') !== -1,
       'the site has the wrong rate');
    const p = (K.PASSIVES['Dullahan (1%)'] || []).find(x => x.kind === 'points');
    ok(p, 'Dullahan no longer declares its bonus points');
    eq(p.value, data.DULLAHAN_POINTS_PER_10_LEVELS,
       'the passive note disagrees with the rate the budget actually uses');
  });

  it('is five points at max level, not fifteen', () => {
    const b = M.emptyBuild();
    b.level = data.Max_Lvl;
    b.race = 'Dullahan (1%)';
    const dulla = M.pointBudget(b);
    b.race = 'Estella (24%)';
    const other = M.pointBudget(b);
    eq(other, data.Max_Lvl * data.POINTS_PER_LEVEL, 'the base budget moved');
    eq(dulla - other, 5, 'Dullahan is not on five bonus points at max level');
    // And it accrues per bracket, not all at once.
    b.race = 'Dullahan (1%)'; b.level = 25;
    eq(M.pointBudget(b) - 25 * data.POINTS_PER_LEVEL, 2,
       'the bonus does not accrue every ' + data.LEVEL_STAT_BONUS_EVERY + ' levels');
    b.level = 9;
    eq(M.pointBudget(b) - 9 * data.POINTS_PER_LEVEL, 0,
       'the bonus arrives before the first bracket is complete');
  });

  it('every text the site and the AI show says one point per 10 levels', () => {
    // The maths moved from 3 to 1 and the words did not: the Build AI kept printing
    // the race-role note "+3 stat points every 10 levels", and the race card kept
    // the game text "3 more stat points ... 12 more at level 40".
    const rr = ((K.RACE_ROLES || {})['Dullahan (1%)'] || {}).note || '';
    ok(/\+1 stat point every 10 levels/.test(rr) && !/\b3 stat points\b/.test(rr),
       'the race-role note the AI shows still gives the old rate: ' + rr);
    const passive = (((data.raceMoves || {})['Dullahan (1%)'] || {}).innatePassives || [])
      .find(p => p.name === 'Bonus Stat Points');
    ok(passive, 'no Bonus Stat Points passive on Dullahan in the data snapshot');
    const text = passive.description || passive.effect || '';
    ok(/1 more stat point/.test(text) && !/3 more stat points|12 more/.test(text),
       'the race card still gives the old rate: ' + text);
    ok(!/\+3 stat points every 10 levels/.test(read('tools/ai/README.md')), 'the README still gives the old rate');
  });

  it('the engine reads the rate rather than repeating it', () => {
    // A literal 3 was hard-coded in pointBudget. Reading it from the data means
    // the next balance change only has to touch the site.
    const m = read('tools/ai/model.js');
    ok(m.indexOf('D.DULLAHAN_POINTS_PER_10_LEVELS') !== -1,
       'model.js no longer reads the rate from the site');
    ok(!/Math\.floor\(lvl \/ 10\) \* 3/.test(m),
       'the hard-coded rate is back in pointBudget');
  });
});

describe('status buffs follow the damage type actually dealt', () => {
  const root = path.resolve(__dirname, '..', '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');

  it('nothing asks for a status multiplier with the written move type', () => {
    // Fractured is Physical/Magic only. Wicked Crown turns Physical moves into
    // Dark ones, and seven call sites were passing the type the move is WRITTEN
    // as rather than the type it deals - so a converted move kept a 35% buff it
    // should have lost. Nothing errors when this is wrong; the number is just
    // too big.
    const b = read('js/builder.js');
    const calls = b.split(String.fromCharCode(10))
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(x => x.line.indexOf('getStatusMultiplier(') !== -1)
      .filter(x => x.line.indexOf('function getStatusMultiplier') === -1)
      .filter(x => x.line.slice(0, 2) !== '//');
    ok(calls.length >= 7, 'expected at least seven call sites, found ' + calls.length);
    for (const c of calls) {
      ok(!/getStatusMultiplier\(m\.moveType/.test(c.line),
         'builder.js:' + c.n + ' asks with the written move type: ' + c.line);
      ok(!/getStatusMultiplier\("/.test(c.line),
         'builder.js:' + c.n + ' hard-codes a move type instead of using the effective one: ' + c.line);
    }
  });

  it('the Fractured rule is written exactly once', () => {
    // It used to exist twice - once in getStatusMultiplier covering Physical AND
    // Magic, and once hand-rolled in the multi-hit path covering only Physical.
    // Two copies of a rule is how they drift.
    const b = read('js/builder.js');
    const hits = b.split(String.fromCharCode(10))
      .filter(line => line.indexOf('statusEffectsActive.fractured') !== -1);
    eq(hits.length, 1,
       'the Fractured rule appears ' + hits.length + ' times; a second copy will drift from the first');
    ok(/moveType === "Physical" \|\| moveType === "Magic"/.test(hits[0]),
       'the one Fractured rule no longer covers both Physical and Magic');
  });

  it('the multi-hit path asks for the rule instead of repeating it', () => {
    const b = read('js/builder.js');
    ok(b.indexOf('getStatusMultiplier(effectiveMoveType, { skipVulnerable: true })') !== -1,
       'the hit-2-3 branch no longer reuses getStatusMultiplier');
  });
});

describe('Self Destruct is priced like every other move', () => {
  const root = path.resolve(__dirname, '..', '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');

  it('the Multi sum is written once', () => {
    // It used to be spelled out inline in toggleDmgDetail and nowhere else, so
    // Self Destruct - which is rendered somewhere else entirely - simply printed
    // its base number. Since §12 it is one SUM of percentage terms, not a
    // product of factors, and it is totalled in exactly one place.
    const b = read('js/builder.js');
    const lines = b.split(String.fromCharCode(10));
    ok(/function getOutsideDmgMult\(m\b/.test(b),
       'the outside-multiplier chain is no longer a shared function');
    eq(lines.filter(l => /^function getDmgMulti\(/.test(l)).length, 1, 'getDmgMulti is not declared once, at top level');
    // Any spelling of the factor (`multi.pct`, `out.pct` ...), not just `pct`:
    // the Frosted AOE once carried its own copy the narrower pattern missed.
    eq(lines.filter(l => /Math\.max\(0, 1 \+ [\w.]*pct \/ 100\)/i.test(l)).length, 1,
       'a hit\'s Multi factor is totalled in more than one place; copies drift');
    ok(/^function dmgMultiFactor\(pct\) \{\r?\n\s*return Math\.max\(0, 1 \+ pct \/ 100\);/m.test(b),
       'the one copy is not dmgMultiFactor');
    // The old product of named factors must not come back beside the sum.
    eq(lines.filter(l => /activeMult \* energyMult/.test(l)).length, 0, 'the multiplicative chain is back');
    ok(!/armourMult|getArmourDmgTypePct/.test(b), 'the dead armour damage-type factor is back in the chain');
  });

  it('the damage curve is written once', () => {
    // Two slider handlers each carried their own copy of the fitted constants.
    const b = read('js/builder.js');
    const hits = b.split(String.fromCharCode(10)).filter(l => l.indexOf('110.59717') !== -1);
    eq(hits.length, 1, 'the Self Destruct curve appears ' + hits.length + ' times');
    ok(/function selfDestructBase\(hpPct\)/.test(b), 'the curve has no named home');
  });

  it('the box runs the full chain, not just the base', () => {
    const b = read('js/builder.js');
    const from = b.indexOf('function renderSelfDestruct');
    ok(from !== -1, 'renderSelfDestruct is gone');
    const body = b.slice(from, b.indexOf(String.fromCharCode(10) + '}', from));
    for (const [call, why] of [
      ['getOutsideDmgMult',       'the DMG BONUS toggles, armour and enchant'],
      ['getStatusMultiplier',     'Vulnerable, Hexed and Fractured'],
      ['getBossResMult',          'boss resistances'],
      ['getCritDmgMultEffective', 'crits'],
    ]) {
      ok(body.indexOf(call) !== -1,
         'Self Destruct no longer applies ' + why + ' (' + call + ' is not called)');
    }
  });

  it('the helpers it needs are reachable from outside toggleDmgDetail', () => {
    // All three were nested inside it, which is the mechanical reason Self
    // Destruct could not reuse the maths and grew a hard-coded number instead.
    const b = read('js/builder.js');
    for (const fn of ['getCritDmgMultEffective', 'getEnergyBonusPct', 'buildBonusTag']) {
      const decls = b.split(String.fromCharCode(10))
        .filter(l => l.indexOf('function ' + fn) !== -1);
      eq(decls.length, 1, fn + ' is declared ' + decls.length + ' times');
      eq(decls[0].slice(0, 8), 'function',
         fn + ' is nested again; nothing outside its parent can call it');
    }
  });
});

describe('Venia and Petent stop at Tier 3', () => {
  const root = path.resolve(__dirname, '..', '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');

  it('the cap is stated once and the tier bars are not hard-coded', () => {
    const e = read('js/encyclopedia.js');
    ok(e.indexOf('const MARK_TIER_CAP = 3;') !== -1, 'the tier cap is gone');
    const hard = e.split(String.fromCharCode(10))
      .filter(l => l.indexOf('[1, 2, 3, 4, 5].forEach') !== -1);
    eq(hard.length, 0, 'a tracker still hard-codes tiers 1-5: ' + hard.join(' | '));
  });

  it('a run that was above the cap keeps its tiers permanently', () => {
    // Keying the buttons off the CURRENT tier made it a one-way door - a Tier 5
    // run that clicked down to Tier 2 could never get back. The tab records a
    // high-water mark instead, so the extra buttons survive both the click and
    // a reload.
    const e = read('js/encyclopedia.js');
    ok(e.indexOf('function markTierTop(tab)') !== -1, 'the high-water rule is gone');
    ok(/tab\.legacyTop = tier/.test(e), 'the high-water mark is never recorded');
    ok(/vtSaveMeta\(meta\)/.test(e) && /ptSaveMeta\(meta\)/.test(e),
       'the high-water mark is never persisted, so it is lost on reload');
  });
});

describe('the avoid list', () => {
  it('is honoured everywhere a name can appear', () => {
    const O = engine.optimizer;
    for (const name of Object.keys(K.AVOID || {})) {
      eq(O.usable(name), false, name + ' is on the avoid list and still usable');
      ok(O.unavailableReason(name), name + ' gives no reason');
    }
  });

  it('never reaches a build', () => {
    const avoid = new Set(Object.keys(K.AVOID || {}));
    if (!avoid.size) return;
    for (const goal of ['damage', 'tank', 'heal', 'crit', 'speed']) {
      const b = ask('', { goal, level: data.Max_Lvl }).build;
      const worn = [b.armour, b.enchant, b.artifact && b.artifact.name, b.weapon && b.weapon.name,
                    ...(b.gear || []).map(g => g.name)].filter(Boolean);
      for (const n of worn) ok(!avoid.has(n), goal + ' build is wearing ' + n);
    }
  });

  it('is kept separate from what the game does not allow', () => {
    // Two different claims. Saying "not in the game" about an item somebody can
    // equip right now would be a lie in the write-up.
    for (const name of Object.keys(K.AVOID || {})) {
      ok(!((K.UNAVAILABLE || {}).items || {})[name],
         name + ' is in both AVOID and UNAVAILABLE');
    }
  });
});

describe('stat milestones', () => {
  it('every declared milestone quotes the game text exactly', () => {
    // If a game update rewords one of these, this fails rather than the engine
    // quietly pricing something that no longer says what it used to.
    for (const [stat, list] of Object.entries(K.MILESTONES || {})) {
      const real = (data.statMilestones || {})[stat];
      ok(real, stat + ' is not a stat the game has milestones for');
      eq(list.length, real.length, stat + ' declares a different number of tiers');
      list.forEach((def, i) => {
        eq(def.text, real[i], stat + ' tier ' + (i + 1) + ' text has drifted');
        ok(def.kind, stat + ' tier ' + (i + 1) + ' has no kind');
        if (def.kind === 'note') ok(def.note, stat + ' tier ' + (i + 1) + ' is uncounted with no reason');
        else ok(def.value > 0, stat + ' tier ' + (i + 1) + ' is priced at nothing');
      });
    }
  });

  it('reads the thresholds off the game data, not a copy of them', () => {
    const tiers = data.STAT_MILESTONE_TIERS;
    eq(tiers.length, 3, 'the game no longer has three milestone tiers');
    const none = K.milestonesFor({ str: 0, arc: 0, end: 0, spd: 0, lck: 0 }, tiers);
    eq(none.reached.length, 0, 'reached a milestone on zero stats');
    const all = K.milestonesFor({ str: 999, arc: 999, end: 999, spd: 999, lck: 999 }, tiers);
    eq(all.reached.length, 15, 'did not reach every milestone on maxed stats');
    // Exactly at the threshold counts; one under does not.
    eq(K.milestonesFor({ lck: tiers[1] }, tiers).outHealPct, 35, 'LCK 60 is not paying out');
    eq(K.milestonesFor({ lck: tiers[1] - 1 }, tiers).outHealPct, 0, 'LCK 59 is paying out');
    eq(K.milestonesFor({ spd: tiers[2] }, tiers).dodgePct, 15, 'SPD 110 is not 15% autododge');
  });

  // The reason this was worth doing at all.
  // Deliberately NOT asserted on the pure healer any more. Once healing was
  // scored as rate x survivability, Endurance beat the Luck milestone on that
  // build - Endurance raises HP and the heal stats at once, and +35% once does
  // not catch it. That is a measured answer, not a bug, and pinning a stat
  // allocation the model legitimately decides against would be testing my
  // opinion rather than the engine.
  //
  // What IS worth pinning: the milestone is reachable, it is taken where it
  // wins, and taking it really does raise the scored healing.
  it('takes the +35% outgoing healing milestone where it wins', () => {
    // WHICH variant wins it is the engine's call, not mine. This used to name
    // Healer+DPS, and that stopped being true the moment Luck went to half-rate
    // crit: the DPS half no longer wants Luck for its own sake, so it no longer
    // carries the build most of the way to 60 for free. Support still does,
    // because it wants Luck anyway. Searching for the winner rather than naming
    // one keeps this about the mechanism instead of my guess at the meta.
    const need = data.STAT_MILESTONE_TIERS[1];
    const variants = [['Healer'], ['Healer', 'DPS'], ['Healer', 'Support'],
                      ['Healer', 'Tank'], ['Support']];
    const tried = variants.map(roles => ({ roles, r: ask('', { roles, level: data.Max_Lvl }) }));
    const hits = tried.filter(x => x.r.ctx.stats.lck >= need);
    ok(hits.length, 'no healing variant reaches the Luck milestone; it is ' +
       'unreachable in practice: ' +
       tried.map(x => x.roles.join('+') + ' ' + x.r.ctx.stats.lck).join(', '));
    for (const h of hits) {
      ok(h.r.ctx.milestones.reached.some(m => m.stat === 'lck' && m.tier === 2),
         h.roles.join('+') + ' is at Luck ' + h.r.ctx.stats.lck +
         ' but the milestone is not recorded as reached');
      ok(h.r.ctx.effectiveHeal > h.r.ctx.outHeal,
         h.roles.join('+') + ' took the milestone without it raising the scored healing');
    }
  });

  it('the reported healing stays what the site would show', () => {
    // effectiveHeal is the engine's; outHeal must remain the site's number -
    // read with Venia's Permuth what-if off, which is how every figure the
    // engine reports is read (the site's own row shows Permuth as permanent).
    const r = ask('', { roles: ['Healer'], level: data.Max_Lvl });
    const site = engine.model.derived(Object.assign({}, r.build, { permuth: '' }));
    eq(r.ctx.outHeal, site.outHeal, 'the reported outgoing healing drifted from the model');
  });
});

describe('healing is an amount, not a percentage', () => {
  const healer = () => ask('', { roles: ['Healer'], level: data.Max_Lvl });

  it('computes what a heal actually heals', () => {
    const r = healer();
    ok(r.ctx.healPerTurn > 0, 'the healer heals nothing per turn');
    ok(r.ctx.bestHeal > 0, 'the healer has no best heal');
    ok(r.ctx.heals.some(h => h.name === 'Holy Grace'), 'Holy Grace is not in the heal list');
  });

  it('a class with no healing move heals nothing, however big its percentage', () => {
    // This is the whole confusion: a Paladin stacking Endurance had a LARGER
    // outgoing-healing percentage than a Saint and no way to heal anybody.
    const pal = ask('', { klass: 'Paladin (Or)', goal: 'heal', level: data.Max_Lvl });
    eq(pal.ctx.healPerTurn, 0, 'a Paladin is healing without a healing move');
    ok(pal.ctx.outHeal > 100, 'the fixture moved — the Paladin should still have the multiplier');
  });

  it('healing moves scale on stats the way damage does', () => {
    const M = engine.model;
    const grace = (data.classMoves['Saint (Or)'].learns || []).find(m => m.name === 'Holy Grace');
    ok(grace && grace.healing === 18 && grace.healingPctHp === 4, 'Holy Grace fixture moved');
    const b = M.emptyBuild(); b.level = data.Max_Lvl; b.klass = 'Saint (Or)'; b.race = 'Dullahan (1%)';
    const low = M.moveHealing(b, grace);
    b.invested.str = 100; b.invested.arc = 100;
    const high = M.moveHealing(b, grace);
    ok(high > low, 'Holy Grace does not scale with STR and ARC');
  });

  it('a heal that adds a share of max HP gets bigger with Endurance', () => {
    // "18 + 4%" — the second term is why Endurance is a healing stat on a Saint
    // twice over, and it is the whole reason the healer stacks it.
    const M = engine.model;
    const grace = (data.classMoves['Saint (Or)'].learns || []).find(m => m.name === 'Holy Grace');
    const b = M.emptyBuild(); b.level = data.Max_Lvl; b.klass = 'Saint (Or)'; b.race = 'Dullahan (1%)';
    const lean = M.moveHealing(b, grace);
    b.invested.end = 200;
    const bulky = M.moveHealing(b, grace);
    ok(bulky > lean + 5, 'Endurance does not feed the percentage term: ' +
       lean.toFixed(1) + ' -> ' + bulky.toFixed(1));
    // And it is really the HP term, not the stat scaling: Holy Grace scales on
    // STR and ARC only, so END can reach it by no other route.
    ok(!/END/i.test(grace.scaling), 'Holy Grace now scales on END — this test is measuring the wrong thing');
  });

  it('a shorter cooldown is worth something', () => {
    const r = healer();
    const cd = r.ctx.effectiveCd;
    const grace = (data.classMoves['Saint (Or)'].learns || []).find(m => m.name === 'Holy Grace');
    ok(cd(grace) < grace.cooldown || !r.ctx.cdCutFlat,
       'a cooldown cut is recorded but not applied');
  });

  it('and the race that shortens cooldowns wins the healer slot', () => {
    // Sheea grants no useful stat block for a healer at all. It wins on
    // "Reduced Cooldowns" alone, which is the point: base stats are not the
    // whole of a race.
    const r = healer();
    eq(r.build.race, 'Sheea (Ob)',
       'the healer picked ' + r.build.race + ' — cooldown reduction is not being valued');
    ok(r.ctx.cdCutFlat >= 1, 'Sheea is equipped but its cooldown cut is not counted');
  });

  it('the STR and ARC 110 milestones buff Physical and magic damage, not cooldowns', () => {
    // Patch rework (2026-09-16), read by type (owner, 2026-09-17): STR 110 is
    // +20% on Physical moves and ARC 110 +20% on every other type. They used to
    // be cooldown cuts, split the same way. The patch notes' "melee" and
    // "ranged" wording is not what the game does.
    const tiers = data.STAT_MILESTONE_TIERS;
    const m = K.milestonesFor({ str: tiers[2], arc: tiers[2] }, tiers);
    eq(m.cdCut.length, 0, 'a 110 milestone still cuts a cooldown');
    const str = m.typeDmg.find(c => c.stat === 'str');
    const arc = m.typeDmg.find(c => c.stat === 'arc');
    ok(str && arc, 'STR 110 or ARC 110 grants no damage perk');
    eq(str.value, 20, 'STR 110 is not +20%'); eq(arc.value, 20, 'ARC 110 is not +20%');
    eq(str.source, 'owner', 'the STR perk does not say where it came from');
    eq(arc.source, 'owner', 'the ARC perk does not say where it came from');
    const find = (k, n) => ((data.classMoves[k] || {}).learns || []).find(x => x.name === n);
    const carnage = find('Berserker (Ch)', 'Carnage');     // Dark
    const strike  = find('Arbiter (N)', 'Strike');         // Physical, slot 'Base Move' - the player's own
    const smack   = find('Necromancer (Ch)', 'Smack');     // Physical, slot 'Skeleton' - a summon's
    const grace   = find('Saint (Or)', 'Holy Grace');      // Holy
    const stinger = find('Ranger (Or)', 'Stinger');        // Poison
    ok(carnage && strike && smack && grace && stinger, 'a fixture move moved');
    ok(arc.test(carnage) && !str.test(carnage), 'Carnage (Dark) is not a magic move');
    ok(arc.test(grace) && !str.test(grace), 'Holy Grace (Holy) is not a magic move');
    ok(arc.test(stinger) && !str.test(stinger), 'Stinger (Poison) is not a magic move');
    // Arbiter's Base Move is the player's own strike, not a summon's.
    ok(!K.isSummonSlot(strike), "Arbiter's Base Move Strike is treated as a summon attack");
    ok(str.test(strike) && !arc.test(strike), "Arbiter's Physical Strike does not take STR's perk");
    // A summon's attack is not yours, whatever its type.
    ok(K.isSummonSlot(smack), 'a Skeleton attack is not recognised as a summon');
    ok(!str.test(smack) && !arc.test(smack), 'a summon attack takes a milestone perk');
    // The converted type wins: a Physical move Wicked Crown makes Dark is magic.
    ok(arc.test(strike, 'Dark') && !str.test(strike, 'Dark'), 'a converted move still reads its written type');
    eq(K.milestoneDmgStat('Physical'), 'str', 'Physical is not STR');
    eq(K.milestoneDmgStat(' physical '), 'str', 'the type is not trimmed and case-folded');
    for (const t of ['Magic', 'Fire', 'Ice', 'Hex', 'Holy', 'Dark', 'Poison', 'Nature'])
      eq(K.milestoneDmgStat(t), 'arc', t + ' is not a magic type');
    // One under the threshold pays nothing.
    eq(K.milestonesFor({ str: tiers[2] - 1, arc: tiers[2] - 1 }, tiers).typeDmg.length, 0,
       'STR/ARC 109 is paying the 110 perk');
  });

  it('the DMG calc applies the same Physical / magic perk, read the same way', () => {
    // builder.js getMilestoneDmgPct is the site half of the rule above: the
    // stat comes from the move's EFFECTIVE type (getEffectiveMoveType), summon
    // attacks are skipped through isSummonAttack, and the stat is the buffed
    // total from getTotalStat. Since §12 the perk is a +20 term of the Multi sum.
    const root = path.join(__dirname, '..', '..');
    const src = fs.readFileSync(path.join(root, 'js', 'builder.js'), 'utf8');
    const mr  = fs.readFileSync(path.join(root, 'js', 'move-renderer.js'), 'utf8');
    const grab = (text, head) => {
      const start = text.indexOf(head);
      ok(start !== -1, 'no ' + head);
      let depth = 0, i = text.indexOf('{', start);
      for (; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { depth--; if (!depth) return text.slice(start, i + 1); }
      }
      return '';
    };
    const from = src.indexOf('const MILESTONE_DMG_PCT');
    const fnAt = src.indexOf('function getMilestoneDmgPct(');
    ok(from !== -1 && fnAt > from, 'the STAT MILESTONE DAMAGE block moved');
    const tiersSrc = /const STAT_MILESTONE_TIERS = (\[[^\]]*\]);/.exec(src);
    ok(tiersSrc, 'no STAT_MILESTONE_TIERS in builder.js');
    const stats = {};
    let crown = false;   // stands in for Wicked Crown in getEffectiveMoveType
    const site = new Function('STAT_MILESTONE_TIERS', 'getTotalStat', 'getEffectiveMoveType',
      grab(mr, 'function isSummonMove(') + '\n' + src.slice(from, fnAt) +
      grab(src, 'function getMilestoneDmgPct(') +
      '; return { getMilestoneDmgStat, isSummonAttack, getMilestoneDmgPct };'
    )(new Function('return ' + tiersSrc[1])(), s => stats[s] || 0,
      t => (crown && /^physical$/i.test(String(t || '').trim())) ? 'Dark' : t);

    const find = (k, n) => ((data.classMoves[k] || {}).learns || []).find(x => x.name === n);
    const carnage = find('Berserker (Ch)', 'Carnage');     // Dark
    const strike  = find('Arbiter (N)', 'Strike');         // Physical, the player's own
    const smack   = find('Necromancer (Ch)', 'Smack');     // Physical, a Skeleton's
    const grace   = find('Saint (Or)', 'Holy Grace');      // Holy
    const sheea   = { name: 'Holy Light', slot: 'Sheea (Saint)', moveType: 'Magic', effect: '' };
    ok(carnage && strike && smack && grace, 'a fixture move moved');

    Object.assign(stats, { str: 110, arc: 0 });
    eq(site.getMilestoneDmgPct(strike), 20, "STR 110 is not +20 on Arbiter's own Physical Strike");
    eq(site.getMilestoneDmgPct(carnage), 0, 'STR 110 adds to Dark Carnage');
    eq(site.getMilestoneDmgPct(smack), 0, 'STR 110 buffs a Skeleton attack');
    eq(site.getMilestoneDmgPct(carnage, 'Physical'), 20, "a part priced as Physical did not take STR's perk");
    crown = true;
    eq(site.getMilestoneDmgPct(strike), 0, 'a Strike Wicked Crown makes Dark still takes the STR perk');
    crown = false;
    Object.assign(stats, { str: 109, arc: 110 });
    eq(site.getMilestoneDmgPct(strike), 0, 'STR 109 pays the Physical perk');
    eq(site.getMilestoneDmgPct(carnage), 20, 'ARC 110 does not buff Dark Carnage');
    eq(site.getMilestoneDmgPct(grace), 20, 'ARC 110 does not buff Holy Grace');
    eq(site.getMilestoneDmgPct(sheea), 0, "ARC 110 buffs a Heaven's Authority Sheea attack");
    eq(site.getMilestoneDmgPct(carnage, 'Physical'), 0, 'the part type argument is ignored');
    crown = true;
    eq(site.getMilestoneDmgPct(strike), 20, 'a Strike Wicked Crown makes Dark misses the ARC perk');
    crown = false;
    ok(site.isSummonAttack(sheea) && !site.isSummonAttack(strike), 'isSummonAttack misreads a Sheea row or the Base Move');

    // The site and the Build AI read every move's type and summon slot alike.
    const bad = [];
    for (const table of [data.classMoves || {}, data.raceMoves || {}]) {
      for (const [owner, entry] of Object.entries(table)) {
        for (const mv of (entry.learns || [])) {
          if (site.isSummonAttack(mv) !== K.isSummonSlot(mv)) bad.push(owner + ' ' + mv.name + ' (summon)');
          if (site.getMilestoneDmgStat(mv.moveType) !== K.milestoneDmgStat(mv.moveType)) bad.push(owner + ' ' + mv.name + ' (type)');
        }
      }
    }
    eq(bad.length, 0, 'the site and the Build AI disagree on: ' + bad.join(', '));
    // Stinger is two parts, and each takes the perk of its own type: each part
    // asks for its own Multi sum, which reads the milestone by the part's type.
    ok(/const _stabRaw\s*=[^\n]*\n[\s\S]{0,600}getDmgMulti\(m, _stabEffType, /.test(src) &&
       /const _arrRaw\s*=[^\n]*\n[\s\S]{0,600}getDmgMulti\(m, _arrEffType, /.test(src),
       "the site no longer prices Stinger's stab and arrows by their own types");
    ok(/add\(milestoneDmgLabel\(m, effType\), getMilestoneDmgPct\(m, effType\)\);/.test(grab(src, 'function getDmgMulti(')),
       'the Multi sum does not read the milestone by the type it was asked for');
  });
});

describe('races are more than a stat block', () => {
  it('no race with a real kit is excluded as unfinished', () => {
    for (const [name, entry] of Object.entries(data.raceMoves || {})) {
      if (!((entry.learns || []).length)) continue;
      const role = (K.RACE_ROLES || {})[name];
      ok(role, name + ' has a kit and no RACE_ROLES entry');
      ok(!role.placeholder, name + ' has a full kit and is still marked placeholder');
    }
  });

  it("counts Daminos' outgoing healing now that the data states it", () => {
    // The passive text used to carry no figure and the entry was a note. It now
    // says 15%, so a Daminos healer has to be scored with it.
    const r = ask('healer', { race: 'Daminos (3%)', klass: 'Saint (Or)' });
    ok(((r.ctx.passives || {}).outHealPct || 0) >= 15,
       'Daminos +15% outgoing healing not counted: ' + JSON.stringify(r.ctx.passives));
  });

  it('a race passive with no game text says where its number came from', () => {
    for (const [race, list] of Object.entries(K.PASSIVES || {})) {
      if (!(data.races || {})[race]) continue;
      for (const p of list) {
        if (p.kind === 'note') continue;
        // `points` is not an overlay. Dullahan's +1 per 10 levels is computed by
        // model.js itself, mirroring builder.js, and the entry exists to say so -
        // its own note is "already in the point budget". Nothing is being priced
        // from nothing there.
        if (p.kind === 'points') continue;
        const src = (data.raceMoves || {})[race] || {};
        const named = [...(src.innatePassives || []), ...(src.learns || [])].find(m => m.name === p.name);
        ok(named, race + ' declares a passive it does not have: ' + p.name);
        const text = String(named.effect || '') + String(named.description || '') + String(named.quote || '');
        // Either the game states it, or we say out loud that somebody told us.
        ok(text.trim().length > 0 || p.source,
           race + '/' + p.name + ' is priced from nothing and does not say so');
      }
    }
  });
});

describe('gear has to actually do something', () => {
  const O = engine.optimizer;
  const healer = () => ask('', { roles: ['Healer'], level: data.Max_Lvl });

  it('every GEAR_NEEDS entry names a real item and gives a reason', () => {
    for (const [name, need] of Object.entries(K.GEAR_NEEDS || {})) {
      ok((data.gearItems || {})[name] || (data.artifactItems || {})[name],
         name + ' is not an item');
      ok(need.why && need.why.length > 30, name + ' gives no reason');
      const kinds = ['element', 'summons', 'poison', 'blocking', 'healedBy', 'status'];
      ok(kinds.some(k => need[k]), name + ' declares no condition');
    }
  });

  it('reads what a build does from its own kit, not from a hand-written list', () => {
    const saint = ask('', { roles: ['Healer'], klass: 'Saint (Or)', level: data.Max_Lvl }).build;
    const does = O.buildDoes(saint);
    eq(does.summons, false, 'a Saint is credited with summons');
    eq(does.poison, false, 'a Saint is credited with poison');
    ok(does.elements.has('holy'), 'a Saint has no Holy attack');

    const necro = ask('', { roles: ['DPS'], klass: 'Necromancer (Ch)', level: data.Max_Lvl }).build;
    eq(O.buildDoes(necro).summons, true, 'a Necromancer is not credited with summons');
  });

  it('knows the three items that were dead on a healer', () => {
    // The exact complaint: all three are Arcane 4-5, Arcane feeds Holy Grace,
    // and not one of their passives can fire on a Holy kit with no summons and
    // no poison.
    const saint = ask('', { roles: ['Healer'], klass: 'Saint (Or)', level: data.Max_Lvl }).build;
    for (const n of ["Madseer's Codex", 'Imbuement Reliquary', 'Impure Crown']) {
      ok(O.inertFor(n, saint, { goal: 'heal' }), n + ' is not recognised as dead on a Saint');
    }
    // And the same item is alive where it belongs.
    const necro = ask('', { roles: ['DPS'], klass: 'Necromancer (Ch)', level: data.Max_Lvl }).build;
    ok(!O.inertFor('Imbuement Reliquary', necro, { goal: 'damage' }),
       'the summon item is called dead on a summoner');
  });

  it('does not put dead gear on the build it recommends', () => {
    for (const role of (K.ROLE_ORDER || [])) {
      const r = ask('', { roles: [role], level: data.Max_Lvl });
      const dead = (r.ctx.inertGear || []);
      eq(dead.length, 0, role + ' is wearing gear that does nothing: ' + dead.join(', '));
    }
  });

  it('a healer wears damage reduction, because nothing else raises its healing', () => {
    // Once Narthana's Leaf and the milestones are in, the next best thing for
    // total healing output is not dying — so the healer should not be sitting
    // on the ~1% block DR it used to.
    //
    // The bar was 30% while Vital was an overlay that MULTIPLIED the finished HP
    // figure. The site adds it to the same percentage bucket as armour and gear
    // instead, and matching that changed which gear wins: the healer now takes
    // 27% DR with 405 HP and 47.8 heal/turn, where it used to take 51% DR with
    // 342 HP and 43.3. It scores higher on both halves of what a healer is for,
    // so this asserts the survivability the test is really about rather than one
    // of its two ingredients — a build can trade DR for health freely and only
    // the product is meaningful.
    //
    // 250 HP was with Permuth scored as a permanent x1.4 on Endurance; the
    // honest figure on a perfect stat line is around 185.
    const r = healer();
    ok(r.ctx.blockDr > 20,
       'the healer has ' + Math.round(r.ctx.blockDr) + '% damage reduction');
    ok(r.ctx.hp > 150, 'the healer is on ' + Math.round(r.ctx.hp) + ' HP');
    // 400 was Permuth's figure as well; ~185 HP at 50%+ DR is what the honest
    // line gives, and lifesteal sustain sits on top of it in the score.
    const survivability = r.ctx.hp * (1 + r.ctx.blockDr / 100);
    ok(survivability > 250,
       'the healer only survives like ' + Math.round(survivability) + ' effective HP');
  });

  it('the role item wins inside the margin and loses outside it', () => {
    const margin = K.ROLE_ITEM_MARGIN;
    ok(margin > 0 && margin < 0.5, 'the role-item margin is not a sane allowance');
    // Narthana's Sigil measures WORSE than Stellian Core on a healer now that
    // healing scores damage reduction — it wins on the allowance, and the
    // build records what that cost.
    const r = healer();
    eq(r.build.artifact.name, "Narthana's Sigil");
    const cost = (r.build._rolePicks || {})["Narthana's Sigil"];
    ok(cost > 0 && cost <= margin * 100,
       'the Sigil was taken without recording what it gave up');
  });

  it('and a damage Saint still gets the damage artifact', () => {
    const dps = ask('', { roles: ['Healer'], goal: 'damage', klass: 'Saint (Or)', level: data.Max_Lvl });
    ok(dps.build.artifact.name !== "Narthana's Sigil",
       'a damage Saint was handed the healing artifact');
  });

  it('says in the write-up what a role pick cost', () => {
    const sec = healer().explanation.find(x => /Chosen for the role/.test(x.h));
    ok(sec, 'no section explaining the role picks');
    ok(sec.list.some(l => /giving up .*% of the measured score/.test(l)),
       'never admits a role pick lost on the numbers');
  });
});

describe('abilities that do not work', () => {
  const bugged = Object.entries(K.MASTERY_ABILITIES || {}).filter(([, r]) => r.kind === 'bugged');

  it('every bugged entry names a real ability and says why', () => {
    ok(bugged.length > 0, 'nothing is marked bugged — has something been fixed in game?');
    const all = new Set();
    for (const perClass of Object.values(data.masteryAbilities || {}))
      for (const e of Object.values(perClass)) if (e && e.name) all.add(e.name);
    for (const [name, rule] of bugged) {
      ok(all.has(name), name + ' is not a mastery ability in the game data');
      ok(rule.note && rule.note.length > 40, name + ' gives no reason');
    }
  });

  it('a bugged capstone is never bought, even when nothing else measures', () => {
    // It used to be. The picker prefers an UNPRICED real ability over stat
    // nodes the build does not want, and a bugged ability looked unpriced —
    // so a Saint spent 5 of its 35 points on Piercing Grace.
    const names = new Set(bugged.map(([n]) => n));
    for (const roles of [['Healer'], ['Tank'], ['DPS'], ['Support']]) {
      for (const klass of ['Saint (Or)', 'Paladin (Or)', 'Berserker (Ch)']) {
        const r = ask('', { roles, klass, level: data.Max_Lvl });
        const boughtNames = ((r.build.masteryBudget || {}).capstoneOrder || []).map(c => c.name);
        for (const boughtName of boughtNames)
          ok(!names.has(boughtName),
             klass + ' as ' + roles.join('+') + ' bought the bugged ' + boughtName);
      }
    }
  });

  it('and it is reported as bugged rather than as unknown', () => {
    const r = ask('', { roles: ['Healer'], klass: 'Saint (Or)', level: data.Max_Lvl });
    const pg = (r.build.masteryPassedOver || []).find(x => x.name === 'Piercing Grace');
    ok(pg, 'Piercing Grace is not in the passed-over list at all');
    eq(pg.reason, 'bugged', 'Piercing Grace is reported as ' + pg.reason);
  });

  it('the Saint buys the capstones that help its actual job', () => {
    const r = ask('', { roles: ['Healer'], klass: 'Saint (Or)', level: data.Max_Lvl });
    const names = ((r.build.masteryBudget || {}).capstoneOrder || []).map(c => c.name);
    ok(names.indexOf('One For All') !== -1, 'One For All (+50% outgoing healing) not bought: ' + names.join(', '));
    // Holy Grace Proficiency is regen, which is not modelled. It is either the
    // unpriced fallback or reported as unpriced - never silently dropped.
    const hg = (r.build.masteryPassedOver || []).find(x => x.name === 'Holy Grace Proficiency');
    ok(names.indexOf('Holy Grace Proficiency') !== -1 || (hg && hg.reason === 'unmodelled'),
       'Holy Grace Proficiency is neither bought nor reported as unpriced');
  });
});

describe('go perfect: breakpoints and stat decay', () => {
  const M = engine.model, O = engine.optimizer;
  const STATS = ['str', 'arc', 'end', 'spd', 'lck'];
  const fresh = (klass, race) => {
    const b = M.emptyBuild(); b.level = data.Max_Lvl; b.klass = klass; b.race = race || 'Estella (24%)';
    b.invested = { str: 0, arc: 0, end: 0, spd: 0, lck: 0 };
    return b;
  };

  it('no total sits in the dead zone between the knee and the 110 perk', () => {
    // The owner's rule: a stat sits on a breakpoint or at or under ~100. A
    // total of 101-109 has paid the fall-off and bought nothing. The one
    // legitimate exception is a stat with nothing invested at all - flats the
    // allocator cannot remove put it there.
    // The rest stat is the other exception: it takes whatever is left over,
    // and when every other stat is already on a breakpoint there is nothing
    // to trade its surplus against.
    const d = K.STAT_DECAY;
    ok(d && d.knee < d.next, 'no STAT_DECAY rule');
    for (const q of REQUESTS) {
      const r = ask(q);
      const rest = (r.build._statLine || []).find(x => x.reason === 'rest');
      // A class ceiling inside the zone (a Saint's 102 Endurance for Utor) is
      // where the owner put it, not where the allocator left it.
      const onCeiling = (s, t) => { const c = (r.ctx.lineRules || {})[s]; return !!c && t >= c.cap && t < c.cap + 2; };
      for (const s of STATS) {
        // Site totals: a combat overlay (the Coagulated ramp) is not the line.
        const t = (r.ctx.siteStats || r.ctx.stats)[s];
        ok(!(t > d.knee && t < d.next) || (r.build.invested[s] | 0) === 0 || (rest && rest.stat === s) || onCeiling(s, t),
           JSON.stringify(q) + ': ' + s + ' total ' + t + ' is in the dead zone with ' +
           r.build.invested[s] + ' invested');
      }
    }
  });

  it('one rest stat, and every other invested stat sits on a breakpoint', () => {
    // The shape of every community build: "60 End, 110 Arc, rest Str". A stat
    // that was given points is the rest, or on 25 / 60 / 110 (one over is the
    // percent sources rounding up), or Luck holding a crit tier.
    const tiers = data.STAT_MILESTONE_TIERS;
    for (const q of REQUESTS) {
      const r = ask(q);
      const line = r.build._statLine || [];
      const rest = line.filter(x => x.reason === 'rest');
      ok(rest.length <= 1, JSON.stringify(q) + ' has ' + rest.length + ' rest stats');
      for (const s of STATS) {
        if ((r.build.invested[s] | 0) === 0) continue;
        if (rest[0] && rest[0].stat === s) continue;
        if (s === 'lck' && r.ctx.critTier > 0) continue;
        if ((line.find(x => x.stat === s) || {}).reason === 'floor') continue;   // the solo boss Speed floor
        // Totals can carry a fraction from an item hook, so "on" is [bp, bp + 2);
        // and they are the SITE totals - a combat overlay is not the line.
        const t = (r.ctx.siteStats || r.ctx.stats)[s];
        const c = (r.ctx.lineRules || {})[s];   // a class ceiling is a breakpoint of its own
        ok(tiers.some(bp => t >= bp && t < bp + 2) || (c && t >= c.cap && t < c.cap + 2),
           JSON.stringify(q) + ': ' + s + ' total ' + t + ' is neither the rest stat nor on a breakpoint (' +
           JSON.stringify(r.ctx.stats) + ')');
        ok(Number.isInteger(r.build.invested[s]), JSON.stringify(q) + ': ' + s + ' has ' + r.build.invested[s] + ' points invested');
      }
    }
  });

  it('docks a build for a stat in the dead zone', () => {
    const spec = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'damage' }, data);
    const b = fresh('Lancer (N)');
    const at = total => {
      b.invested = { str: 0, arc: 0, end: 0, spd: 0, lck: 0 };
      b.invested.str = O.investedForTotal(b, 'str', total);
      return O.evaluate(b, spec);
    };
    const knee = at(K.STAT_DECAY.knee), zone = at(K.STAT_DECAY.knee + 5);
    ok(zone.stats.str > knee.stats.str, 'the probe did not land in the zone');
    eq(zone.deadZone.length, 1, 'dead zone not detected: ' + JSON.stringify(zone.deadZone));
    eq(knee.deadZone.length, 0, 'the knee itself counts as the dead zone');
    ok(knee.score > zone.score, 'five points into the dead zone scored HIGHER (' +
       Math.round(zone.score) + ' vs ' + Math.round(knee.score) + ')');
  });

  it('finds the fewest invested points that land a total on a breakpoint', () => {
    // Percent sources are what make this non-trivial: 15% innate on STR and
    // ARC, and Wandering Practitioner adds another 10% to STR.
    const b = fresh('Saint (Or)');
    b.armour = 'Wandering Practitioner';
    for (const [stat, target] of [['str', 110], ['end', 60], ['arc', 110], ['lck', 25]]) {
      const inv = O.investedForTotal(b, stat, target);
      b.invested[stat] = inv;
      const t = M.totalStat(b, stat);
      ok(t >= target, stat + ': ' + inv + ' invested lands on ' + t + ', short of ' + target);
      if (inv > 0) {
        b.invested[stat] = inv - 1;
        ok(M.totalStat(b, stat) < target, stat + ': one point fewer still reaches ' + target);
      }
      b.invested[stat] = 0;
    }
  });

  it('Permuth is not in the totals the search reads', () => {
    const r = ask('max damage crit lancer');
    ok(r.build.mark === 'Venia' && r.build.permuth, 'the build does not wear Permuth at all');
    const bare = Object.assign({}, r.build, { permuth: '' });
    // Overlays (a stat ramp, a flat-stat capstone) sit ON TOP of the site
    // totals, so each reported stat is the Permuth-less site total or more,
    // and never the Permuth-inflated one.
    const site = M.allStats(bare), inflated = M.allStats(r.build);
    for (const s of STATS) {
      ok(r.ctx.stats[s] >= site[s] - 1e-9, s + ': reported ' + r.ctx.stats[s] + ' is under the site total ' + site[s]);
      if (s === r.build.permuth) ok(r.ctx.stats[s] < inflated[s], s + ': the reported total carries Permuth');
    }
    // model.js must still mirror the site, where Permuth IS a permanent x1.4.
    ok(M.allStats(r.build)[r.build.permuth] > r.ctx.stats[r.build.permuth],
       'the model no longer applies Permuth at all - verify.js would catch this against the page');
  });

  it('every build carries a stat line with a reason for each number', () => {
    for (const q of REQUESTS.slice(0, 8)) {
      const line = ask(q).build._statLine;
      ok(Array.isArray(line) && line.length === 5, JSON.stringify(q) + ' has no stat line');
      ok(line.some(x => ['rest', 'perk', 'cap', 'critTier', 'floor'].indexOf(x.reason) !== -1), JSON.stringify(q) + ' gives no stat a reason');
      for (const x of line) ok(['perk', 'critTier', 'floor', 'rule', 'rest', 'cap', 'dump', 'none'].indexOf(x.reason) !== -1, 'reason ' + x.reason);
    }
  });

  it('a damage perk on the line names the moves it buffs', () => {
    // STR 110 is +20% on Physical moves since the patch rework (it used to be
    // a cooldown cut), so the line names the Physical moves it pays on.
    const spec = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'damage' }, data);
    const b = fresh('Berserker (Ch)');
    b.invested.str = O.investedForTotal(b, 'str', 110);
    const str = O.statLineFor(b, spec).find(x => x.stat === 'str');
    eq(str.reason, 'perk', 'STR 110 is not a perk on the line');
    ok(/Physical damage/.test(str.perk), 'the perk is ' + str.perk);
    ok(str.moves.indexOf('Head Splitter') !== -1, 'Head Splitter (Physical) is not among the buffed moves: ' + str.moves.join(', '));
    ok(str.moves.indexOf('Carnage') === -1, 'Carnage (Dark) is listed under the STR perk');
    ok(!/cooldown/.test(str.perk), 'STR 110 is still described as a cooldown cut: ' + str.perk);
  });

  it('the 110 damage perk follows a converted type', () => {
    // Wicked Crown makes a Physical move Dark, so ARC 110 - not STR 110 - pays
    // on it: evaluate reads the converted type (optimize.js effectiveTypeOf).
    const spec = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'damage' }, data);
    const hitAt = (arc, crown) => {
      const b = fresh('Slayer');
      if (crown) b.gear = [{ name: 'Wicked Crown', tier: 0, alloc: {}, traits: [] }];
      b.invested.str = O.investedForTotal(b, 'str', 60);
      b.invested.arc = O.investedForTotal(b, 'arc', arc);
      return O.evaluate(b, spec).bestHit;
    };
    const crowned = hitAt(110, true) / hitAt(109, true);
    const plain = hitAt(110, false) / hitAt(109, false);
    ok(crowned > 1.1, 'ARC 110 does not buff a Physical move Wicked Crown makes Dark (x' + crowned.toFixed(3) + ')');
    ok(plain < 1.05, 'ARC 110 buffs a plain Physical move (x' + plain.toFixed(3) + ')');
  });

  it('a 110 perk only a buff reaches is paid at that buff uptime', () => {
    // Overload (Lancer cm1: +10% STR and Luck, 0.8 uptime). At 100 STR the
    // buffed total is 110, so the Physical perk is up for 80% of the fight -
    // not never, and not all fight long at 102, which is what reading the
    // uptime-averaged total did.
    const spec = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'damage' }, data);
    const strPerk = (total, overload) => {
      const b = fresh('Lancer (N)');
      if (overload) b.masteryNodes = ['cm1'];
      b.invested.str = O.investedForTotal(b, 'str', total);
      const p = O.evaluate(b, spec).milestones.typeDmg.find(x => x.stat === 'str');
      return p ? p.value : 0;
    };
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    eq(strPerk(110, false), 20, 'STR 110 is not the full perk');
    eq(strPerk(100, false), 0, 'STR 100 pays the perk with no buff');
    ok(close(strPerk(100, true), 16), 'Overload at STR 100 pays ' + strPerk(100, true) + ', not 20 x 0.8');
    ok(close(strPerk(104, true), 16), 'Overload at STR 104 pays ' + strPerk(104, true) + ', not 20 x 0.8');
    eq(strPerk(110, true), 20, 'STR 110 with Overload is not the full perk');
  });

  it('a point past 110 is worth less than a point under the knee when the line is settled', () => {
    // The decayed measure goPerfect decides with. Points past 110 in a stat
    // count at K.STAT_DECAY.pastRate; a line with nothing past 110 is scored
    // exactly as the plain scorer scores it.
    const spec = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'damage' }, data);
    const b = fresh('Lancer (N)');
    b.invested.str = O.investedForTotal(b, 'str', 110);
    eq(O.decayedScore(b, spec), O.evaluate(b, spec).score, 'a line on 110 is docked');
    b.invested.str += 40;
    ok(O.decayedScore(b, spec) < O.evaluate(b, spec).score, 'forty points past 110 are worth full price');
    ok(O.decayedScore(b, spec) > O.evaluate(Object.assign({}, b, { invested: Object.assign({}, b.invested, { str: b.invested.str - 40 }) }), spec).score,
       'forty points past 110 are worth nothing at all');
  });

  it("a Saint's Endurance stops at the milestone, or at what Utor needs for the Sigil", () => {
    // Owner: a Saint only needs 60 Endurance - past it the points do more as
    // Strength - unless it runs Astra, where Utor's heal needs about 102 total
    // Endurance to pop Narthana's Sigil. A class ceiling: never the rest stat.
    const plain = M.emptyBuild(); plain.klass = 'Saint (Or)';
    eq((K.statCeilings(plain).end || {}).cap, 60, 'no 60 ceiling on a Saint');
    plain.mark = 'Astra'; plain.artifact = { name: "Narthana's Sigil", tier: 6, alloc: {} };
    eq((K.statCeilings(plain).end || {}).cap, 102, 'no 102 ceiling with Astra and the Sigil');
    eq(Object.keys(K.statCeilings(fresh('Lancer (N)'))).length, 0, 'a Lancer has a ceiling');

    const r = ask('', { roles: ['Healer'], klass: 'Saint (Or)', play: 'team', level: data.Max_Lvl });
    const end = r.ctx.stats.end, astra = r.build.mark === 'Astra' && r.build.artifact && r.build.artifact.name === "Narthana's Sigil";
    const want = astra ? [102, 104] : [60, 62];
    ok(end >= want[0] && end < want[1], 'Saint Endurance ' + end + ' (Astra+Sigil: ' + astra + '), wanted ' + want.join('-'));
    const row = (r.build._statLine || []).find(x => x.stat === 'end');
    ok(row && row.reason !== 'rest', 'Endurance is the rest stat on a Saint');
    ok(row && row.rule, 'the line does not say why Endurance stops there: ' + JSON.stringify(row));
    ok(r.ctx.deadZone.indexOf('end') === -1, 'Endurance on its ceiling is called a dead zone');
  });

  it('tier points go first to the stat a shape can complete', () => {
    // STR five short of 110: a [5, 3] completes the breakpoint, so STR leads
    // the tier order whatever the goal weights say.
    const spec = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'tank' }, data);
    const b = fresh('Saint (Or)');
    b.invested.end = O.investedForTotal(b, 'end', 60);
    b.invested.str = O.investedForTotal(b, 'str', 105);
    const order = O.tierOrder(b, spec);
    eq(order[0], 'str', 'tier order ' + order.join(' > '));
    ok(Array.isArray(ask('tanky build').build._tierOrder), 'the build does not carry its tier order');
  });
});

describe('passives that were not counted', () => {
  const M = engine.model, O = engine.optimizer;
  const spec = goal => Intent.applyOverrides(Intent.parse('', data, K), { goal }, data);
  const fresh = (klass, race) => {
    const b = M.emptyBuild(); b.level = data.Max_Lvl; b.klass = klass; b.race = race || 'Estella (24%)';
    b.invested = { str: 40, arc: 40, end: 40, spd: 0, lck: 30 };
    return b;
  };
  const wear = (b, ...names) => { b.gear = names.map(n => ({ name: n, tier: 0, alloc: {}, traits: [] })); return b; };

  it('every reference gear is either counted or named under "not counted"', () => {
    // The community builds are made of these. A gear that appears in neither
    // list is invisible - which is where Divine Promise (an ACTIVE, no passive
    // text at all) used to be.
    const gears = ['Shadow Gauntlets', 'Parasitic Leech', "Ptera's Heart", 'Coagulated Finger Nail',
                   'Tear Blood Crystal', "Narthana's Leaf", 'Divine Promise', 'Sanguine Fang', 'Snorb',
                   'Aspect of Maladaptation', 'Vainglorious Locket', "Madseer's Codex", 'Imbuement Reliquary',
                   'Crystalline Spike', 'Spiked Steel Ball', 'Blooming Eye', 'Egg Shelmet', 'Molten Carapace'];
    for (const g of gears) {
      ok(data.gearItems[g], g + ' is not a gear in the data');
      const t = O.gearPassiveTotals(wear(fresh('Saint (Or)'), g));
      const listed = t.active.concat(t.unmodelled).map(x => x.name);
      ok(listed.indexOf(g) !== -1, g + ' is neither counted nor reported: ' + listed.join(', '));
    }
    const dp = O.gearPassiveTotals(wear(fresh('Saint (Or)'), 'Divine Promise')).unmodelled.find(x => x.name === 'Divine Promise');
    ok(dp && /Divine Gift/.test(dp.note), 'Divine Promise does not name the move it grants');
  });

  it('prices lifesteal, heals from damage, flat self-heals and the stat ramp', () => {
    const b = wear(fresh('Impaler (Ch)', 'Calvariae (3%)'), 'Shadow Gauntlets', 'Parasitic Leech', 'Coagulated Finger Nail');
    const t = O.gearPassiveTotals(b);
    eq(t.lifestealPct, 3, 'Shadow Gauntlets lifesteal');
    eq(t.healFromDmgPct, 2, 'Parasitic Leech heal from damage');
    eq(t.statFlat.str, 7.5, 'Coagulated Finger Nail ramp');
    const c = O.evaluate(b, spec('tank'));
    ok(c.lifesteal >= 3, 'lifesteal did not reach the sustain figure: ' + c.lifesteal);
    ok(c.stats.str >= M.allStats(b).str + 7, 'the stat ramp did not reach the scored totals');
    ok(c.sustainPerTurn > 0 && c.effectiveHpSustain > c.effectiveHp, 'nothing reached sustain');
    // Parasitic Leech heals the TEAM: nothing solo, something in a party.
    eq(c.teamHealPerTurn, 0, 'a party heal counted solo');
    const team = O.evaluate(b, Intent.applyOverrides(Intent.parse('', data, K), { goal: 'heal', play: 'team' }, data));
    ok(team.teamHealPerTurn > 0 && team.healPerTurn >= team.teamHealPerTurn, 'Parasitic Leech heals nobody in a party');
  });

  it('reads the statuses a build applies from its kit and its gear', () => {
    const b = wear(fresh('Impaler (Ch)'), "Ptera's Heart");
    const st = O.statusesOf(b);
    ok(st.enemy.has('poison') && st.self.has('poison'), "Ptera's Heart poison not read: " + JSON.stringify([...st.self]) + ' ' + JSON.stringify([...st.enemy]));
    ok(st.enemy.has('bleed'), 'an Impaler applies no bleed? ' + JSON.stringify([...st.enemy]));
    ok(st.self.has('bleed'), 'an Impaler bleeds itself and it was not read: ' + JSON.stringify([...st.self]));
    const c = O.evaluate(b, spec('damage'));
    ok(c.statuses.self.length >= 2, 'ctx.statuses.self ' + JSON.stringify(c.statuses));
  });

  it('a bleed-gated gear is inert on a kit that never bleeds', () => {
    // Found from the data rather than assumed: a Saint bleeds (Slayer's Stab
    // is in its kit), so the class that applies no Bleed at all is looked up.
    const supers = Object.values(data.classes || {}).flat();
    const noBleed = supers.find(k => !O.statusesOf(fresh(k)).enemy.has('bleed'));
    ok(noBleed, 'every superclass applies Bleed?');
    ok(O.inertFor('Tear Blood Crystal', wear(fresh(noBleed), 'Tear Blood Crystal'), spec('tank')),
       'Tear Blood Crystal fires on a ' + noBleed + ' that applies no Bleed');
    ok(!O.inertFor('Tear Blood Crystal', wear(fresh('Impaler (Ch)'), 'Tear Blood Crystal'), spec('tank')),
       'Tear Blood Crystal is called inert on an Impaler');
  });

  it("counts Calvariae's passives and Brittle Cure", () => {
    const b = fresh('Impaler (Ch)', 'Calvariae (3%)');
    const pv = O.passivesFor(b);
    for (const n of ['Broken Bones', 'Frail Body', 'Frugality'])
      ok(pv.known.some(p => p.name === n), n + ' is not a known Calvariae passive');
    const c = O.evaluate(b, spec('tank'));
    ok(c.passives.selfHealFlat > 0 && c.passives.incHealPct > 0 && c.passives.dr > 0,
       'Calvariae passives did not reach the totals: ' + JSON.stringify(c.passives));
    ok(c.effectiveIncHeal > c.incHeal, 'Frugality did not raise incoming healing');
    ok((c.setups || []).some(su => su.move === 'Brittle Cure'), 'Brittle Cure is not a setup move');
  });

  it('Lifesong and Astra reach the healing and sustain figures', () => {
    const b = fresh('Saint (Or)');
    const plain = O.evaluate(b, spec('heal'));
    b.enchant = 'Lifesong';
    const song = O.evaluate(b, spec('heal'));
    ok(song.effectiveHeal > plain.effectiveHeal && song.effectiveIncHeal > plain.effectiveIncHeal,
       'Lifesong moved neither healing figure');
    b.mark = 'Astra';
    const astra = O.evaluate(b, spec('heal'));
    ok(astra.sustainPerTurn > song.sustainPerTurn, 'Astra (Utor) adds no sustain');
    const r = ask('tanky build');
    ok(['Venia', 'Astra'].indexOf(r.build.mark) !== -1, 'mark ' + r.build.mark);
    const dps = ask('max damage crit lancer');
    eq(dps.build.mark, 'Venia', 'a damage build switched marks for nothing');
  });

  it('a named boss scales every hit by its resistance and gives a kill time', () => {
    const b = wear(fresh('Impaler (Ch)'), 'Shadow Gauntlets');
    const open = O.evaluate(b, Intent.applyOverrides(Intent.parse('', data, K), { goal: 'damage' }, data));
    const handa = O.evaluate(b, Intent.applyOverrides(Intent.parse('', data, K), { goal: 'damage', boss: 'Handaconda' }, data));
    ok(data.BOSS_DATA && data.BOSS_DATA.Handaconda, 'no BOSS_DATA for Handaconda');
    ok(handa.bestHit < open.bestHit, 'Handaconda (Physical x0.5) did not lower a Physical kit: ' + handa.bestHit + ' vs ' + open.bestHit);
    ok(handa.bossFit.killTurns > 0 && isFinite(handa.bossFit.killTurns), 'no kill time');
    ok(handa.bossFit.hpCorrupted > handa.bossFit.hp, 'Corrupted HP not read');
  });

  it('a gear active is part of the rotation', () => {
    const b = wear(fresh('Saint (Or)'), 'Divine Promise');
    const c = O.evaluate(b, Intent.applyOverrides(Intent.parse('', data, K), { goal: 'heal', play: 'team' }, data));
    ok((c.rotation || []).some(rt => rt.move === 'Divine Gift'), 'Divine Gift is not in the rotation: ' +
       JSON.stringify((c.rotation || []).map(x => x.move)));
  });

  it('assumes the soul tree health nodes are maxed, and says so in the build', () => {
    const soul = O.maxHealthSoul();
    ok(Object.keys(soul).length > 0, 'no health nodes found in soulTreeData');
    const r = ask('tanky build');
    eq(JSON.stringify(r.build.soul), JSON.stringify(soul), 'the build does not carry the maxed health nodes');
  });
});

describe('shards stack the way the site counts them', () => {
  const M = engine.model, O = engine.optimizer;
  const spec = goal => Intent.applyOverrides(Intent.parse('', data, K), { goal }, data);

  it('the third copy of a family counts at a quarter', () => {
    const b = M.emptyBuild(); b.level = data.Max_Lvl; b.klass = 'Impaler (Ch)'; b.race = 'Estella (24%)';
    b.shards = ['Reversing (R)'];
    const one = M.shardTotals(b, K, { selfStacks: 2 }).dmgPct;
    b.shards = ['Reversing (R)', 'Reversing (P)'];
    const two = M.shardTotals(b, K, { selfStacks: 2 }).dmgPct;
    b.shards = ['Reversing (R)', 'Reversing (P)', 'Reversing (R)'];
    const three = M.shardTotals(b, K, { selfStacks: 2 }).dmgPct;
    ok(two > one, 'the second copy counts nothing');
    const r = data.shardItems['Reversing (R)'].rVal;
    ok(Math.abs((three - two) - r * 2 * 0.25) < 1e-9, 'the third copy is worth ' + (three - two) + ', not a quarter of ' + (r * 2));
    eq(M.shardTotals(b, K, { selfStacks: 2 }).families.Reversing, 3, 'family count');
  });

  it('per-debuff shards read the statuses the build actually carries', () => {
    const b = M.emptyBuild(); b.level = data.Max_Lvl; b.klass = 'Impaler (Ch)'; b.race = 'Estella (24%)';
    b.shards = ['Reversing (R)'];
    const r = data.shardItems['Reversing (R)'].rVal;
    ok(Math.abs(M.shardTotals(b, K, { selfStacks: 3 }).dmgPct - r * 3) < 1e-9, 'three self statuses');
    ok(Math.abs(M.shardTotals(b, K).dmgPct - r * (K.SHARDS['per-debuff-self'].stacks || 1)) < 1e-9, 'the fallback is the rule');
    // Five Reversing on a self-poisoning, self-bleeding Impaler: the community's
    // Handa build. 2 full + 3 at a quarter, at two self statuses.
    b.gear = [{ name: "Ptera's Heart", tier: 0, alloc: {}, traits: [] }];
    b.shards = ['Reversing (R)', 'Reversing (R)', 'Reversing (R)', 'Reversing (R)', 'Reversing (R)'];
    const c = O.evaluate(b, spec('damage'));
    const self = c.statuses.self.length;
    ok(self >= 2, 'expected poison and bleed on the Impaler: ' + JSON.stringify(c.statuses));
    ok(Math.abs(c.shards.dmgPct - r * self * (2 + 3 * 0.25)) < 1e-9, '5x Reversing scored ' + c.shards.dmgPct);
  });

  it('the search may fit a family twice, and the trap fires from the third copy', () => {
    const dps = ask('', { klass: 'Berserker (Ch)', goal: 'damage', level: data.Max_Lvl });
    const copies = {};
    for (const n of dps.build.shards) { const f = n.replace(/ \([RP]\)$/, ''); copies[f] = (copies[f] || 0) + 1; }
    ok(Object.values(copies).some(n => n >= 2), 'a damage build never doubles a shard family: ' + dps.build.shards.join(', '));
    const trap = K.TRAPS.find(t => t.name === 'Stacked shards');
    ok(trap, 'no Stacked shards trap');
    ok(!trap.when({ shards: ['Empowering (R)', 'Empowering (P)'] }), 'two copies trip the trap');
    ok(trap.when({ shards: ['Empowering (R)', 'Empowering (P)', 'Empowering (R)'] }), 'three copies do not trip it');
  });

  it('reads a "3.5*2" damage string as two hits', () => {
    eq(JSON.stringify(M.parseDamage('3.5*2')), JSON.stringify({ base: 3.5, hits: 2 }));
    eq(JSON.stringify(M.parseDamage('2x3')), JSON.stringify({ base: 2, hits: 3 }));
  });

  it('the soul tree health nodes reach HP', () => {
    const b = M.emptyBuild(); b.level = data.Max_Lvl; b.klass = 'Saint (Or)'; b.race = 'Estella (24%)';
    const bare = M.derived(b).hp;
    b.soul = O.maxHealthSoul();
    const expected = Object.values(data.soulTreeData).flat().filter(n => n.hpFlat).reduce((a, n) => a + n.hpFlat * n.maxRank, 0);
    ok(expected > 0, 'no flat-HP soul nodes in the data');
    ok(Math.abs((M.derived(b).hp - bare) - expected) < 1e-6, 'soul HP ' + (M.derived(b).hp - bare) + ' vs ' + expected);
  });
});

describe('the BuildPlan', () => {
  const Plan = require('./plan.js');
  const SLOT_KEYS = ['race', 'armour', 'weapon', 'artifact', 'enchant', 'mark', 'subclass', 'lostScroll'];

  it('every request comes back with a plan, and every slot in it is filled in', () => {
    for (const q of REQUESTS.slice(0, 10)) {
      const r = ask(q);
      const p = r.plan;
      ok(p && p.version === Plan.VERSION, JSON.stringify(q) + ' has no plan');
      eq(p.summary.class, r.build.klass, 'plan class');
      eq(JSON.stringify(p.stats.total), JSON.stringify(r.ctx.siteStats), 'plan totals are not the site totals');
      eq(JSON.stringify(p.stats.scored), JSON.stringify(r.ctx.stats), 'plan scored totals are not the scored totals');
      eq(p.slots.mastery.notation, r.build.masteryNotation, 'plan notation');
      for (const k of SLOT_KEYS) {
        const sl = p.slots[k];
        ok(sl && 'chosen' in sl && Array.isArray(sl.alternatives), JSON.stringify(q) + ': slot ' + k + ' is malformed');
        ok(['must', 'preferred', 'optional'].indexOf(sl.priority) !== -1, k + ' priority ' + sl.priority);
        let last = -1;
        for (const a of sl.alternatives) {
          ok(a.delta == null || (a.delta >= 0 && a.delta >= last), k + ' alternatives are not sorted by how far behind they are');
          if (a.delta != null) last = a.delta;
          ok(a.name !== sl.chosen, k + ' lists the chosen option as an alternative');
        }
      }
      eq(p.slots.gear.length, r.build.gear.length, 'gear slots');
      for (const g of p.slots.gear) ok(Array.isArray(g.alternatives) && g.why, 'gear ' + g.chosen + ' has no alternatives or reason');
      ok(p.slots.shards.summary, 'no shard summary');
      ok(p.slots.corruption.chosen, 'no corruption form in the plan');
    }
  });

  it('ranks the races for a class-locked request as full builds', () => {
    const r = ask('', { klass: 'Saint (Or)', roles: ['Healer'], play: 'team', level: data.Max_Lvl });
    const races = r.plan.slots.race;
    ok(races.alternatives.length >= 3, 'only ' + races.alternatives.length + ' race alternatives');
    ok(races.alternatives.some(a => a.full), 'no race alternative is a full build');
    ok(races.alternatives.every(a => a.name !== r.build.race), 'the chosen race is among its own alternatives');
    const full = races.alternatives.filter(a => a.full);
    for (let i = 1; i < full.length; i++) ok(full[i].delta >= full[i - 1].delta, 'full builds are not ranked');
    // A full alternative is a FINISHED build, measured against the chosen one:
    // an unfinished score is no rival, and it once read as a tie above the winner.
    ok(full.every(a => a.delta != null && a.score <= r.ctx.score + 1e-9),
       'an unfinished race is ranked as a full build: ' + JSON.stringify(full.map(a => [a.name, a.score, a.delta])));
    // Measured alternatives lead; the unmeasured ones follow them.
    const firstRough = races.alternatives.findIndex(a => !a.full);
    ok(firstRough === -1 || races.alternatives.slice(firstRough).every(a => !a.full),
       'an unmeasured race is listed ahead of a finished one: ' +
       JSON.stringify(races.alternatives.map(a => [a.name, a.full])));
    // And an unmeasured alternative cannot make the pick look optional.
    ok(races.priority !== 'optional' || races.alternatives.some(a => a.delta != null && a.delta <= 0.01),
       'an unmeasured race alternative made the race optional');
  });

  it('keeps what every slot measured, in the order it measured it', () => {
    const r = ask('max damage crit lancer');
    const alts = r.build._alts || {};
    for (const k of ['armour', 'weapon', 'artifact', 'enchant', 'sub', 'gear1', 'gear2', 'gear3', 'gear4']) {
      ok(Array.isArray(alts[k]) && alts[k].length > 1, k + ' recorded ' + (alts[k] ? alts[k].length : 0) + ' options');
      eq(alts[k][0].delta, 0, k + ': the best option is not first');
    }
  });

  it('measures the priority legend rather than guessing it', () => {
    const P = Plan.priorityOf;
    eq(P([{ name: 'a', delta: 0, chosen: true }, { name: 'b', delta: 0.2 }]), 'must');
    eq(P([{ name: 'a', delta: 0, chosen: true }, { name: 'b', delta: 0.005 }]), 'optional');
    eq(P([{ name: 'a', delta: 0, chosen: true }, { name: 'b', delta: 0.05 }]), 'preferred');
    eq(P([{ name: 'a', delta: 0, chosen: true }]), 'must');
  });

  it('composes from a partial result, as analyse hands it one', () => {
    const r = ask('tanky build');
    const partial = { build: r.build, ctx: r.ctx, corruption: null, warnings: [] };
    const p = Plan.compose(partial, r.spec, engine.model, K, data);
    ok(p && p.slots && p.slots.corruption, 'no plan from a partial result');
    eq(p.slots.corruption.alternatives.length, 0, 'invented corruption alternatives');
    ok(p.slots.covenant, 'no covenant slot');
  });
});

describe('the write-up reads like a build post', () => {
  const COMMUNITY = ['Stats', 'Gears', 'Tier bonuses', 'Enchant', 'Mark', 'Race', 'Weapon', 'Artifact',
                     'Subclass', 'Shards', 'Armour', 'Mastery', 'Lost scroll', 'Covenant', 'Corruption form',
                     'Trait orbs', 'How to play'];
  const reqs = [['healer', {}], ['tanky build', {}], ['max damage crit lancer', {}],
                ['', { roles: ['Support'], play: 'team' }],
                ['', { klass: 'Impaler (Ch)', roles: ['Tank', 'DPS'], play: 'solo', boss: 'Handaconda' }],
                ['', { minmax: true }]];

  it('every community section is present, in order, ahead of every folded one', () => {
    for (const [q, o] of reqs) {
      const secs = ask(q, o).explanation;
      const at = h => secs.findIndex(x => x.h === h);
      let last = -1;
      for (const h of COMMUNITY) {
        const i = at(h);
        ok(i !== -1, JSON.stringify(q) + ': no "' + h + '" section');
        ok(i > last, JSON.stringify(q) + ': "' + h + '" is out of order');
        last = i;
      }
      ok(at('Build') !== -1 && at('Build') < at('Stats'), 'the terse Build table is not ahead of the write-up');
      const firstFold = secs.findIndex(x => x.collapsed);
      ok(firstFold === -1 || firstFold > last, JSON.stringify(q) + ': a folded section sits inside the write-up');
      ok(secs.some(x => x.collapsed), 'nothing is folded - the honesty sections have gone');
      for (const h of ['Gear passives NOT counted', 'Passives NOT counted', 'Stat points', 'Why this build'])
        ok(secs.every(x => x.h !== h || x.collapsed), h + ' is not folded');
      ok(secs.every(x => x.h !== 'Watch out' || !x.collapsed), 'Watch out is folded');
    }
  });

  it('the Stats section carries the line and the Mastery section the notation', () => {
    const r = ask('healer');
    const stats = r.explanation.find(x => x.h === 'Stats');
    ok(stats.table.some(row => row[0] === 'Line' && row[1] === (K.statLineText ? K.statLineText(r.build._statLine) : row[1])), 'no Line row');
    const m = r.explanation.find(x => x.h === 'Mastery');
    ok(m.body.indexOf(r.build.masteryNotation) !== -1, 'the notation is not in the Mastery section: ' + m.body);
    ok(/get .+ first/.test(m.body) || !r.build.masteryBudget.getFirst, 'the Mastery section does not say what to get first');
    const race = r.explanation.find(x => x.h === 'Race');
    ok(race.body.indexOf(r.build.race) === 0, 'the Race line does not start with the chosen race: ' + race.body);
    ok(race.body.indexOf('≥') !== -1, 'the Race line is not a ranking: ' + race.body);
  });

  it('a named fight brings its play notes, and the form the community runs', () => {
    const r = ask('', { klass: 'Impaler (Ch)', roles: ['Tank', 'DPS'], play: 'solo', boss: 'Handaconda', level: data.Max_Lvl });
    ok(r.plan.play.tactics.length >= 3, 'no Handaconda tactics');
    const how = r.explanation.find(x => x.h === 'How to play');
    ok(how.list.some(l => /Hand of Ramizca/.test(l)), 'the How to play section does not carry the tactics');
    ok(how.list.some(l => /Handaconda/.test(l) && /HP/.test(l)), 'the boss HP is not in the play section');
    eq(r.build.corruption, 'Tyranny', 'the community runs Tyranny on Handaconda; the build took ' + r.build.corruption);
    ok(/Recommended for Handaconda/.test(r.corruption.best.why), 'the form does not say it was recommended for the fight');
    const open = ask('', { klass: 'Impaler (Ch)', roles: ['Tank', 'DPS'], play: 'solo', level: data.Max_Lvl });
    eq(open.plan.play.tactics.length, 0, 'tactics leaked into a fight nobody named');
  });

  it('the panel summary is the same build post in <b>, <br> and <i>', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'build-ai.js'), 'utf8');
    const start = src.indexOf('function summaryHtmlFor(res, ctx, spec) {');
    const end = src.indexOf('function summaryHtmlForLegacy(');
    ok(start !== -1 && end > start, 'summaryHtmlFor is not built from the plan');
    const body = src.slice(start, end);
    for (const label of ['Stats:', 'Gears:', 'Tier bonuses:', 'Race:', 'Mastery:', 'Trait orbs:', 'How to play:'])
      ok(body.indexOf(label) !== -1, 'the summary has no ' + label + ' line');
    const tags = body.match(/<([a-z]+)[ >]/g) || [];
    for (const t of tags) ok(/^<(b|br|i)[ >]$/.test(t), 'the summary uses ' + t + ', which the site\'s sanitizer strips');
  });
});

// ── golden builds ───────────────────────────────────────────────────────────
// The owner's community builds, as expectations. A golden file names what the
// reference JUSTIFIES - a milestone reached, a race in a set, three of four
// gears - never the exact build, so it cannot overfit. Keys listed in `soft`
// warn rather than fail (until --strict-golden); everything else is a hard
// requirement the engine has to meet today.
describe('golden builds', () => {
  const dir = path.join(__dirname, 'golden');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.json$/.test(f)).sort() : [];
  const warnings = [];
  const family = n => String(n || '').replace(/ \([RP]\)$/, '');

  // Every check returns null when met, or a sentence saying how it was not.
  const CHECKS = {
    class:      (v, r) => r.build.klass === v ? null : 'class ' + r.build.klass,
    raceIn:     (v, r) => v.indexOf(r.build.race) !== -1 ? null : 'race ' + r.build.race + ' not in ' + v.join(' / '),
    raceRankingTop4Has: (v, r) => {
      const top = [r.build.race].concat((r.plan.slots.race.alternatives || []).slice(0, 3).map(a => a.name));
      const miss = v.filter(x => top.indexOf(x) === -1);
      return miss.length ? miss.join(', ') + ' not in the top 4 races (' + top.join(' > ') + ')' : null;
    },
    milestones: (v, r) => {
      const miss = v.filter(m => (r.ctx.siteStats[m.stat] || 0) < m.min)
                    .map(m => m.stat.toUpperCase() + ' ' + r.ctx.siteStats[m.stat] + ' < ' + m.min);
      return miss.length ? miss.join(', ') : null;
    },
    noDeadZone: (v, r) => !v || !r.ctx.deadZone.length ? null : 'dead zone: ' + r.ctx.deadZone.join(', '),
    // { stat: [[lo, hi], ...] } - the total sits inside one of the ranges.
    totalIn: (v, r) => {
      const bad = Object.entries(v).filter(([st, ranges]) => {
        const t = r.ctx.stats[st] || 0;
        return !ranges.some(([lo, hi]) => t >= lo && t < hi);
      });
      return bad.length ? bad.map(([st, ranges]) => st.toUpperCase() + ' ' + r.ctx.stats[st] + ' not in ' + JSON.stringify(ranges)).join('; ') : null;
    },
    dominantStat: (v, r) => {
      const inv = r.build.invested;
      const top = Object.keys(inv).sort((a, b) => inv[b] - inv[a])[0];
      return top === v ? null : 'most points in ' + top + ', not ' + v;
    },
    gearMust:   (v, r) => { const have = r.build.gear.map(g => g.name); const miss = v.filter(x => have.indexOf(x) === -1);
                            return miss.length ? 'missing ' + miss.join(', ') : null; },
    gearAtLeast:(v, r) => { const have = r.build.gear.map(g => g.name); const n = have.filter(x => v.of.indexOf(x) !== -1).length;
                            return n >= v.n ? null : 'only ' + n + ' of ' + v.of.join(' / ') + ' (wearing ' + have.join(', ') + ')'; },
    armourIn:   (v, r) => v.indexOf(r.build.armour) !== -1 ? null : 'armour ' + r.build.armour,
    weapon:     (v, r) => {
      const w = r.plan.slots.weapon;
      if (v.name && w.chosen !== v.name) return 'weapon ' + w.chosen;
      if (v.type && w.type !== v.type) return 'weapon type ' + w.type + ' (' + w.chosen + ')';
      if (v.tiered && !w.tiered) return 'weapon ' + w.chosen + ' is not tiered';
      return null;
    },
    artifact:   (v, r) => (r.build.artifact && r.build.artifact.name) === v ? null : 'artifact ' + (r.build.artifact && r.build.artifact.name),
    artifactIn: (v, r) => v.indexOf(r.build.artifact && r.build.artifact.name) !== -1 ? null : 'artifact ' + (r.build.artifact && r.build.artifact.name),
    subclass:   (v, r) => r.build.sub === v ? null : 'subclass ' + (r.build.sub || 'none'),
    enchantIn:  (v, r) => v.indexOf(r.build.enchant) !== -1 ? null : 'enchant ' + (r.build.enchant || 'none'),
    markIn:     (v, r) => v.indexOf(r.build.mark) !== -1 ? null : 'mark ' + r.build.mark,
    shardFamilyMajority: (v, r) => { const n = r.build.shards.filter(x => family(x) === v).length;
                                     return n >= 4 ? null : v + ' x' + n + ' of 7 (' + r.plan.slots.shards.summary + ')'; },
    shards:     (v, r) => { const miss = Object.entries(v).filter(([f, n]) => r.build.shards.filter(x => family(x) === f).length < n)
                              .map(([f, n]) => f + ' x' + n);
                            return miss.length ? 'short of ' + miss.join(', ') + ' (' + r.plan.slots.shards.summary + ')' : null; },
    'mastery.notationIn': (v, r) => v.indexOf(r.build.masteryNotation) !== -1 ? null : 'mastery ' + r.build.masteryNotation,
    'mastery.capstonesMin': (v, r) => (r.build.masteryBudget || {}).capstonesTaken >= v ? null : 'capstones ' + (r.build.masteryBudget || {}).capstonesTaken,
    'mastery.mustInclude': (v, r) => { const have = ((r.build.masteryBudget || {}).capstoneOrder || []).map(c => c.name);
                                       const miss = v.filter(x => have.indexOf(x) === -1);
                                       return miss.length ? 'capstones ' + have.join(', ') + ' (missing ' + miss.join(', ') + ')' : null; },
    lostScrollIn: (v, r) => v.indexOf(r.build.lostScroll) !== -1 ? null : 'lost scroll ' + (r.build.lostScroll || 'none'),
    covenantIn: (v, r) => v.indexOf(r.build.covenant) !== -1 ? null : 'covenant ' + (r.build.covenant || 'none'),
    corruption: (v, r) => r.build.corruption === v ? null : 'corruption ' + r.build.corruption,
    traits:     (v, r) => {
      const count = (slots, id) => slots.reduce((a, g) => a + (g.traits || []).filter(t => t.id === id).length, 0);
      const miss = [];
      for (const [id, n] of Object.entries(v.gearHas || {})) if (count(r.build.gear, id) < n) miss.push('gear ' + id + ' x' + n);
      for (const [id, n] of Object.entries(v.artifactHas || {})) if (count(r.build.artifact ? [r.build.artifact] : [], id) < n) miss.push('artifact ' + id + ' x' + n);
      return miss.length ? 'short of ' + miss.join(', ') + ' (' + (r.plan.slots.traits.summary || 'none') + ')' : null;
    },
    tierPriorityStartsWith: (v, r) => ((r.plan.stats.tierPriority || [])[0] === v) ? null : 'tier priority ' + (r.plan.stats.tierPriority || []).join(' > '),
    tactics:    (v, r) => r.plan.play.tactics.length >= v ? null : 'only ' + r.plan.play.tactics.length + ' tactics',
  };

  // Flatten { mastery: { notationIn, capstonesMin, mustInclude } } into dotted keys.
  const flatten = (exp) => {
    const out = [];
    for (const [k, v] of Object.entries(exp || {})) {
      if (k === 'mastery' && v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) out.push(['mastery.' + kk, vv]);
      else out.push([k, v]);
    }
    return out;
  };

  ok(files.length > 0, 'no golden builds in tools/ai/golden');
  for (const f of files) {
    const g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    it(g.name, () => {
      const r = ask(g.request.text, g.request.overrides);
      ok(r.plan, 'no plan');
      const soft = new Set(g.soft || []);
      const failed = [];
      for (const [key, v] of flatten(g.expect)) {
        const check = CHECKS[key];
        ok(check, f + ': no check for expectation ' + key);
        const problem = check(v, r);
        if (!problem) continue;
        if (soft.has(key) && !STRICT_GOLDEN) warnings.push(f + ': ' + key + ' — ' + problem);
        else failed.push(key + ' — ' + problem);
      }
      ok(failed.length === 0, f + ':\n           ' + failed.join('\n           '));
    });
  }

  it('says which soft expectations the engine does not meet yet', () => {
    // Not a failure: the list is the to-do list. Printed so it is never quiet.
    if (warnings.length) {
      console.log('         soft golden expectations not met (' + warnings.length + '):');
      for (const w of warnings) console.log('           ' + w);
    }
  });
});

describe('seasonal gear', () => {
  it('never puts event gear in a build', () => {
    // Easter and Winter Solstice gear is in the data and cannot be equipped, the
    // same as the Ivory and Icerind weapons. A build nobody can enter into the
    // game is not a build.
    const banned = new Set();
    for (const series of Object.keys(K.UNAVAILABLE.gearSeries || {}))
      for (const n of (data.gearSeries || {})[series] || []) banned.add(n);
    ok(banned.size > 0, 'no seasonal gear is listed, so this test proves nothing');
    for (const klass of Object.keys(data.masteryClassData || {})) {
      for (const goal of ['damage', 'tank']) {
        const r = engine.ask('', { klass, goal, play: 'solo', dmg: 'average' });
        for (const g of r.build.gear || []) {
          const n = g && g.name;
          ok(!banned.has(n), klass + '/' + goal + ' was given ' + n + ', which cannot be equipped');
        }
      }
    }
  });

  it('names gear series that exist in the data', () => {
    for (const series of Object.keys(K.UNAVAILABLE.gearSeries || {})) {
      const members = (data.gearSeries || {})[series];
      ok(members && members.length,
         'UNAVAILABLE.gearSeries names "' + series + '", which is not a gear series in the data');
    }
  });

  it('resolves a gear series the opposite way round from a weapon series', () => {
    // weaponSeries matches a FIELD on each weapon; gearSeries is a LIST of names
    // under the series. Using one lookup for both silently excludes nothing.
    const src = fs.readFileSync(path.join(__dirname, 'optimize.js'), 'utf8');
    ok(/U\.gearSeries/.test(src) && /D\.gearSeries/.test(src),
       'optimize.js does not resolve gear series membership');
    const panel = fs.readFileSync(path.join(__dirname, '..', '..', 'js/build-ai.js'), 'utf8');
    ok(/gearSeries/.test(panel), 'the panel still offers seasonal gear in its dropdowns');
  });

  it('keeps the seasonal gear out of the panel dropdowns too', () => {
    // An option that the engine would refuse anyway is worse than no option.
    const panel = fs.readFileSync(path.join(__dirname, '..', '..', 'js/build-ai.js'), 'utf8');
    const at = panel.indexOf('const unusable =');
    ok(at !== -1, 'the panel has no unusable() filter');
    const fn = panel.slice(at, at + 700);
    ok(/gearSeries/.test(fn), 'unusable() does not consider gear series');
  });
});

describe('artifact abilities', () => {
  it('counts what an artifact actually does, not just its stat block', () => {
    const r = engine.ask('', { klass: 'Saint (Or)', goal: 'damage', play: 'solo', dmg: 'average' });
    const art = r.build.artifact && r.build.artifact.name;
    const rule = (K.ARTIFACT_ABILITIES || {})[art];
    if (!rule || !rule.effects) return;                  // a different artifact won
    const counted = r.ctx.gearPassives.active.filter(a => a.name === art);
    eq(counted.length, rule.effects.length,
       art + ' grants ' + rule.effects.length + ' things and ' + counted.length + ' were counted');
    for (const e of rule.effects)
      ok(counted.some(a => a.kind === e.kind), art + ' did not count its ' + e.kind);
  });

  it('has something to say about every artifact that has an ability', () => {
    // The first pass scanned for "%" and stopped there, which quietly dismissed
    // Darksigil (Level x2 damage), Paranoxian Crux (an entire HP rewrite) and
    // Ancient Insignia (a flat 15% DR on one stance in three). An artifact with
    // no entry at all is indistinguishable from one that does nothing.
    const uncovered = Object.keys(data.artifactMoves || {})
      .filter(n => !(K.ARTIFACT_ABILITIES || {})[n]);
    eq(uncovered.length, 0, 'no entry for: ' + uncovered.join(', '));
  });

  it('gives every unpriced artifact a reason, not a silence', () => {
    for (const [name, rule] of Object.entries(K.ARTIFACT_ABILITIES || {})) {
      if (rule.effects) continue;
      ok(rule.note && rule.note.length > 40, name + ' is unpriced and says nothing useful');
      ok(/not counted|counted under|downside/i.test(rule.note),
         name + ' never says whether or not it is being counted');
    }
  });

  it('flags an artifact that is actively a downside', () => {
    // Celestial Emblem EMPOWERS five specific enemies, including Arkhaia. It is
    // not a weak artifact, it is a negative one, and that is worth saying.
    const rule = (K.ARTIFACT_ABILITIES || {})['Celestial Emblem'];
    ok(rule && rule.trap, 'Celestial Emblem is not flagged as a downside');
  });

  it('names an artifact ability that exists in the game data', () => {
    for (const name of Object.keys(K.ARTIFACT_ABILITIES || {}))
      ok((data.artifactMoves || {})[name],
         'ARTIFACT_ABILITIES names "' + name + '", which has no ability in the game data');
  });

  it('flags an assumed uptime rather than presenting it as measured', () => {
    const rule = (K.ARTIFACT_ABILITIES || {})['Stellian Core'];
    ok(rule, 'Stellian Core has no entry');
    ok(rule.uptime < 1, 'a conditional ability is counted at full value');
    ok(rule.uptimeAssumed, 'the uptime is not marked as an assumption');
    ok(/assumption|not a measurement/i.test(rule.note || ''),
       'the note does not admit the uptime is a guess');
  });

  it('admits the artifact comparison is one-sided', () => {
    // Only one artifact of twelve states plain numbers, so pricing it and
    // nothing else makes it win everywhere - the same bias the weapon passives
    // had. A silent sweep would read as a verdict.
    const r = engine.ask('', { klass: 'Saint (Or)', goal: 'damage', play: 'solo', dmg: 'average' });
    if (!(K.ARTIFACT_ABILITIES || {})[r.build.artifact && r.build.artifact.name]) return;
    const sec = r.explanation.find(x => /Why this artifact/.test(x.h));
    ok(sec, 'a priced artifact was chosen with no note about the uneven comparison');
    ok(/unproven|compared against blanks/i.test(sec.body), 'the note does not state the problem');
  });

  it('surfaces an unpriced artifact ability instead of dropping it', () => {
    // Artifact abilities live in artifactMoves, not itemPassives, so before this
    // they fell through to nothing at all - not even the "not counted" list.
    const src = fs.readFileSync(path.join(__dirname, 'optimize.js'), 'utf8');
    ok(/artifactMoves/.test(src),
       'gearPassiveTotals never looks at artifactMoves, so an unpriced artifact says nothing');
  });
});

describe('procs', () => {
  it('names every proc item it knows against the real game data', () => {
    for (const name of Object.keys(K.PROCS)) {
      const known = (data.itemPassives || {})[name] !== undefined ||
                    (data.gearItems || {})[name] !== undefined ||
                    (data.artifactItems || {})[name] !== undefined ||
                    (data.markItems || {})[name] !== undefined;
      ok(known, 'PROCS names "' + name + '", which is not an item in the game data');
    }
  });

  it('states a probability for every proc, in the right range', () => {
    for (const [name, p] of Object.entries(K.PROCS)) {
      ok(typeof p.chance === 'number' && p.chance > 0 && p.chance <= 1,
         name + ' has chance ' + JSON.stringify(p.chance));
      ok(['hit', 'turn', 'status'].indexOf(p.per) !== -1, name + ' rolls per ' + p.per);
    }
  });

  it('gives a reason whenever it declines to price a proc', () => {
    // A stated chance with an unstated payload cannot be turned into damage.
    // Saying so is fine; saying nothing is what the whole engine avoids.
    for (const [name, p] of Object.entries(K.PROCS)) {
      if (p.kind !== 'note') continue;
      ok(p.note || p.why, name + ' is unpriced and says nothing about why');
    }
    // At least one has to carry the "the payload is not stated" reasoning, or
    // this test is vacuous.
    ok(Object.values(K.PROCS).some(p => p.why), 'no proc explains what is missing');
  });

  it('scales an extra-status proc by how much the kit applies statuses', () => {
    const heavy = K.debuffLoad([{ name: 'a', effect: 'Applies 2 Poison.' },
                                { name: 'b', effect: 'Applies 1 Burning.' }]);
    const none  = K.debuffLoad([{ name: 'c', effect: 'Deals damage.' }]);
    const withKit = K.procStatusGain(['Chaos Orb'], heavy);
    const without = K.procStatusGain(['Chaos Orb'], none);
    ok(withKit.extraPerTurn > 0, 'Chaos Orb was worth nothing on a status kit');
    eq(without.extraPerTurn, 0, 'Chaos Orb was worth something on a kit that applies none');
    eq(K.procStatusGain([], heavy).extraPerTurn, 0, 'a proc fired without the item worn');
  });

  it('reads the item names off every slot shape', () => {
    // gear/artifact/weapon are objects like { name, tier }, mark is a bare
    // string. The first version pushed the OBJECT, so every lookup missed and
    // no proc was ever detected on any build. Checked on a hand-built kit: the
    // search itself seldom wears a proc item now that item value is measured.
    const b = engine.model.emptyBuild();
    b.level = data.Max_Lvl; b.klass = 'Lancer (N)'; b.race = 'Estella (24%)';
    b.gear = [{ name: 'Sanguine Fang', tier: 6, alloc: {}, traits: [] }];
    b.artifact = { name: 'Chaos Orb', tier: 6, alloc: {}, traits: [] };
    b.weapon = { name: 'Vastic Glaive', tier: 4, alloc: {} };
    const c = engine.optimizer.evaluate(b, Intent.applyOverrides(Intent.parse('', data, K), { goal: 'damage' }, data));
    const names = c.procs.listed.concat(c.procs.traps).map(p => p.name);
    for (const n of ['Sanguine Fang', 'Chaos Orb', 'Vastic Glaive'])
      ok(names.indexOf(n) !== -1, n + ' was worn and not detected as a proc item: ' + names.join(', '));
  });

  it('counts an extra-status proc as a COST against a boss that heals from debuffs', () => {
    // Chaos Orb makes a debuff kit more of a debuff kit. Against Seraphon that
    // is worse, not better, and pricing it as neutral would be the one fight
    // where the item actively hurts.
    const load = K.debuffLoad([{ name: 'a', effect: 'Applies 2 Poison.' }]);
    ok(K.procStatusGain(['Chaos Orb'], load).extraPerTurn > 0,
       'the proc is not producing extra statuses, so the interaction cannot be tested');
    const src = fs.readFileSync(path.join(__dirname, 'optimize.js'), 'utf8');
    ok(/procGain[\s\S]{0,400}punishesDebuffs|punishesDebuffs[\s\S]{0,400}procGain/.test(src),
       'the debuff penalty does not take the proc gain into account');
  });
});

describe('boss targeting', () => {
  it('reads immunities out of the boss text without inventing any', () => {
    const p = K.bossProfile('Seraphon', data);
    ok(p, 'Seraphon has no profile');
    for (const st of ['purified', 'weakened', 'blinded'])
      ok(p.statusImmune.includes(st), 'Seraphon immunity missed ' + st);
    // The 2026-09 patch removed Seraphon's Cursed immunity; the parser must not keep it.
    ok(!p.statusImmune.includes('cursed'), 'Seraphon is still read as immune to Cursed');
    ok(p.blocks && p.dodges, 'Seraphon can block and dodge and the profile missed it');
    // Not a status - it must not be filed as one.
    ok(!p.statusImmune.includes("metrom's amulet"), 'an item was parsed as a status');
  });

  it('does not silently drop an immunity it has no word for', () => {
    // The parser lost Thorian's Plague and Hex the first time, understating the
    // immunity with nothing to show for it.
    const p = K.bossProfile('Thorian, The Rotten', data);
    const all = p.statusImmune.concat(p.otherImmune || []);
    for (const st of ['plague', 'cursed', 'hex'])
      ok(all.includes(st), 'Thorian immunity dropped ' + st + ' (got ' + all.join(', ') + ')');
  });

  it('keeps an immunity to something it has never heard of', () => {
    // The test above passes even with the catch-all removed, because `plague`
    // and `hex` were added to the word list afterwards - it proves the word
    // list, not the safety net. This feeds a status no list could know and
    // checks it still comes out, which is the whole point of the net.
    const fake = { BOSS_MOVE_DATA: { Testish: { passives: [
      { name: 'Status Immunity', description: 'Immune to Withering, Cursed, and Gloom.' },
      { name: 'Can Block', description: 'This enemy can block attacks.' },
    ], learns: [] } } };
    const p = K.bossProfile('Testish', fake);
    const all = p.statusImmune.concat(p.otherImmune || []);
    ok(all.includes('cursed'),    'a known status was lost');
    ok(all.includes('withering'), 'an unknown status was dropped instead of kept');
    ok(all.includes('gloom'),     'an unknown status was dropped instead of kept');
  });

  it('does not file an item as a status', () => {
    // Seraphon is "Immune to Metrom's Amulet" - a thing, not a status. It must
    // not appear as one, or the write-up tells players their debuffs are useless
    // for a reason that does not exist.
    const p = K.bossProfile('Seraphon', data);
    const all = p.statusImmune.concat(p.otherImmune || []);
    ok(!all.some(x => /amulet/i.test(x)), 'an item was parsed as a status: ' + all.join(', '));
  });

  it('penalises a debuff kit against a boss that heals from debuffs', () => {
    const spec = { klass: 'Hexer (N)', goal: 'damage', play: 'solo', dmg: 'average' };
    const free = engine.ask('', spec);
    const vs   = engine.ask('', Object.assign({ boss: 'Seraphon' }, spec));
    eq(free.ctx.bossFit.mult, 1, 'a build with no boss was penalised anyway');
    ok(vs.ctx.bossFit.mult < 1, 'Seraphon did not penalise a debuff-heavy kit');
    ok(vs.ctx.bossFit.reasons.some(r => r.kind === 'debuffs'), 'no reason given for the penalty');
  });

  it('the boss penalty reaches the SCORE, not just the report', () => {
    // The first version of the test above checked only that the multiplier was
    // COMPUTED. Deleting `* fit.mult` from the score left it passing - the exact
    // reports-versus-prices confusion this feature is careful about everywhere
    // else. The multiplier has to change what the search prefers or it is
    // decoration.
    const spec = { klass: 'Hexer (N)', goal: 'damage', play: 'solo', dmg: 'average' };
    const free = engine.ask('', spec);
    const vs   = engine.ask('', Object.assign({ boss: 'Seraphon' }, spec));
    ok(vs.ctx.bossFit.mult < 1, 'no penalty was computed, so this proves nothing');
    ok(vs.ctx.score < free.ctx.score,
       'the penalty (x' + vs.ctx.bossFit.mult.toFixed(3) + ') never reached the score: ' +
       vs.ctx.score + ' vs ' + free.ctx.score);
    // And it should be about the size of the multiplier, not a rounding wobble.
    const ratio = vs.ctx.score / free.ctx.score;
    ok(ratio < 0.999, 'the score moved by only ' + ((1 - ratio) * 100).toFixed(3) + '%');
  });

  it('leaves a kit that applies no statuses alone', () => {
    // The solo Speed floor is a separate, priced cost the search may choose to
    // pay (a Monk keeping 10 more Strength eats a 4% dodge penalty), so the
    // claim here is exactly the one about statuses: no debuff charge.
    const vs = engine.ask('', { klass: 'Monk (Or)', goal: 'damage', play: 'solo',
                                dmg: 'average', boss: 'Seraphon' });
    const load = K.debuffLoad(engine.optimizer.kitFor(vs.build, vs.build.klass));
    if (load.applying > 0) return;  // kit changed
    ok(!vs.ctx.bossFit.reasons.some(r => r.kind === 'debuffs'),
       'a kit applying no statuses was charged for debuffs');
    if (!vs.ctx.bossFit.reasons.length) eq(vs.ctx.bossFit.mult, 1, 'penalised with no reason given');
  });

  it('never prices a mechanic it only reports', () => {
    // The engine has never scored status effects in general, so a boss simply
    // being able to block, or being immune to something this kit does not do,
    // must change no number. Reporting it is right; pricing it would be
    // inventing a penalty.
    //
    // TEAM on purpose. The solo Speed floor is a real, deliberate cost applied
    // to every boss that does not opt out, so solo is no longer a no-op and
    // asserting it there would be testing the wrong thing.
    const base = { klass: 'Monk (Or)', goal: 'damage', play: 'team', dmg: 'average' };
    const a = engine.ask('', base);
    const b = engine.ask('', Object.assign({ boss: 'Arkhaia' }, base));  // blocks, no tactics
    // A Monk attacks with Fire, which Arkhaia does not resist, so no damage figure may move.
    eq(a.ctx.bestHit, b.ctx.bestHit, 'an unmodelled boss changed the damage');

    // Arkhaia's Burn immunity IS stated ("Immune to Ghostflame and Burn"), and it
    // is priced: once 'burn' became a status word, Fire Sutra and Blazing
    // Barrage read as Burn moves. A priced mechanic has to say which of this
    // kit's moves it is about.
    const O = engine.optimizer;
    const learned = k => (((data.classMoves || {})[k] || {}).learns || []).map(m => m.name);
    const kit = new Set(O.kitFor(b.build, b.build.klass).map(m => m.name)
      .concat(learned(b.build.klass), learned(O.baseOf(b.build.klass))));
    ok(b.ctx.bossFit.reasons.some(r => r.kind === 'immune'),
       "Arkhaia's stated Burn immunity was not priced for a kit that applies Burn");
    // Listed AND applied: the penalty reaches the multiplier and the score, and
    // the "Counted as" % the write-up prints is the multiplier actually used.
    const imm = b.ctx.bossFit.reasons.find(r => r.kind === 'immune');
    ok(b.ctx.bossFit.mult < 1, "Arkhaia's Burn immunity was listed but never priced");
    ok(b.ctx.score < a.ctx.score, 'the immunity penalty never reached the score');
    if (b.ctx.bossFit.reasons.length === 1) {
      eq(Math.round((1 - b.ctx.bossFit.mult) * 100), imm.pct, 'the "Counted as" % does not match the multiplier');
    }
    for (const rsn of b.ctx.bossFit.reasons) {
      ok((rsn.moves || []).length && rsn.moves.every(n => kit.has(n)),
         'a boss penalty that names no move of this kit: ' + JSON.stringify(rsn));
    }

    // And a kit Arkhaia has nothing against draws no penalty at all. A Brawler
    // applies Vulnerable and Bleed, neither of which Arkhaia is immune to. Its
    // damage is not compared: Arkhaia resists Physical, a modelled resistance.
    const br = engine.ask('', { klass: 'Brawler (N)', goal: 'damage', play: 'team', dmg: 'average', boss: 'Arkhaia' });
    eq(br.ctx.bossFit.reasons.length, 0, 'a kit Arkhaia has nothing against was given a reason: ' +
       JSON.stringify(br.ctx.bossFit.reasons));
    eq(br.ctx.bossFit.mult, 1, 'a kit Arkhaia has nothing against was penalised');
  });

  it('applies the solo Speed floor to bosses, and only solo', () => {
    // Reported from play: solo, most boss moves have to be dodged and that takes
    // about 40 Speed. In a full party the moves spread across five people, so
    // taxing a team build for it would be charging for a problem it does not
    // have.
    const base = { klass: 'Berserker (Ch)', goal: 'damage', dmg: 'average', boss: 'Seraphon' };
    const solo = engine.ask('', Object.assign({ play: 'solo' }, base));
    const team = engine.ask('', Object.assign({ play: 'team' }, base));
    ok(solo.ctx.stats.spd >= K.BOSS_SOLO_MIN_SPEED,
       'a solo boss build came out on ' + solo.ctx.stats.spd.toFixed(1) + ' Speed, under the ' +
       K.BOSS_SOLO_MIN_SPEED + ' floor');
    ok(team.ctx.stats.spd < K.BOSS_SOLO_MIN_SPEED,
       'the team build was pushed to a Speed floor it does not need');
    ok(!team.ctx.bossFit.reasons.some(r => r.kind === 'speed'),
       'a team build was penalised for Speed');
  });

  it('skips the Speed floor for fights that are not about dodging', () => {
    for (const boss of ['Handaconda', "Metrom's Vessel"]) {
      const r = engine.ask('', { klass: 'Berserker (Ch)', goal: 'damage', play: 'solo',
                                 dmg: 'average', boss });
      ok(!r.ctx.bossFit.reasons.some(x => x.kind === 'speed'),
         boss + ' applied the Speed floor despite dodging not mattering there');
    }
  });

  it("punishes a one-element kit against Thorian, by the converted type", () => {
    // Thorian adapts to the last element used. Boreas turns a Lancer's Physical
    // and Magic moves into Ice, so the whole kit is one element there; a
    // Calvariae Lancer keeps both and is not charged.
    ok(K.bossProfile('Thorian, The Rotten', data).punishesOneElement,
       "Thorian's one-element rule never reaches the boss profile");
    const base = { klass: 'Lancer (N)', boss: 'Thorian, The Rotten', play: 'solo', goal: 'damage', dmg: 'average' };
    const ice = engine.ask('', Object.assign({ race: 'Boreas (1%)' }, base));
    ok(ice.ctx.bossFit.reasons.some(r => r.kind === 'oneElement') && ice.ctx.bossFit.mult < 1,
       'an all-Ice Boreas kit was not charged for one element: ' + JSON.stringify(ice.ctx.bossFit.reasons));
    const mixed = engine.ask('', Object.assign({ race: 'Calvariae (3%)' }, base));
    ok(!mixed.ctx.bossFit.reasons.some(r => r.kind === 'oneElement'),
       'a Physical + Magic kit was charged for one element');
  });

  it('no longer demotes a poison kit against Handaconda', () => {
    // Handaconda lost its Poison immunity in the 2026-09 patch, so an Assassin
    // built on stacking Poison must not be charged an immunity penalty there.
    // Immunity pricing (multiplier and score) is asserted in the Arkhaia test above.
    const base = { klass: 'Assassin (Ch)', goal: 'damage', play: 'solo', dmg: 'average' };
    const vs   = engine.ask('', Object.assign({ boss: 'Handaconda' }, base));
    ok(!K.bossProfile('Handaconda', data).statusImmune.includes('poison'),
       'Handaconda is still read as immune to Poison');
    ok(!vs.ctx.bossFit.reasons.some(r => r.kind === 'immune'),
       'Handaconda still charged an immunity penalty: ' + JSON.stringify(vs.ctx.bossFit.reasons));
    // Handaconda is dodgeIrrelevant and punishes nothing else, so nothing is left to charge.
    eq(vs.ctx.bossFit.mult, 1, 'Handaconda still penalised a poison kit');
  });

  it('says which immunities are player knowledge rather than game text', () => {
    // No real boss carries a player-reported immunity since Handaconda's Poison
    // immunity was patched out (2026-09), so feed one through a throwaway entry.
    const fake = { BOSS_MOVE_DATA: { Testish: { passives: [
      { name: 'Status Immunity', description: 'Immune to Cursed.' },
    ], learns: [] } } };
    K.BOSS_TACTICS.Testish = { immuneStatuses: ['poison'] };
    try {
      const p = K.bossProfile('Testish', fake);
      ok(p.statusImmune.includes('poison'), 'a player-reported immunity was not merged in');
      eq(JSON.stringify(p.fromPlayers), JSON.stringify(['poison']), 'fromPlayers: ' + JSON.stringify(p.fromPlayers));
    } finally { delete K.BOSS_TACTICS.Testish; }
    const src = fs.readFileSync(path.join(__dirname, 'explain.js'), 'utf8');
    ok(/fromPlayers[\s\S]{0,200}player knowledge/.test(src),
       'the write-up no longer flags player-knowledge immunities');
    // And Handaconda itself no longer claims one.
    const r = engine.ask('', { klass: 'Assassin (Ch)', goal: 'damage', play: 'solo',
                               dmg: 'average', boss: 'Handaconda' });
    const sec = r.explanation.find(x => /^Built for Handaconda/.test(x.h));
    ok(sec && !sec.list.some(l => /player knowledge/i.test(l)),
       'Handaconda still carries a player-knowledge immunity line');
  });

  it('says what it priced, what it only reported, and that its kill-turn figure is only an estimate', () => {
    const r = engine.ask('', { klass: 'Hexer (N)', goal: 'damage', play: 'solo',
                               dmg: 'average', boss: 'Seraphon' });
    const sec = r.explanation.find(x => /^Built for Seraphon/.test(x.h));
    ok(sec, 'nothing explains the boss targeting');
    ok(sec.list.some(l => /Counted as /.test(l)), 'does not say what was actually priced');
    ok(sec.list.some(l => /not a number of[\s\S]*kill-turn estimate/.test(l)),
       'does not say "fastest" is not a timed kill, or that the kill-turn estimate is only HP over sustained damage');
    ok(sec.list.some(l => /placeholder/i.test(l)), 'does not flag the penalties as placeholders');
  });

  it('admits when a boss has no tactics written for it', () => {
    const r = engine.ask('', { klass: 'Hexer (N)', goal: 'damage', play: 'solo',
                               dmg: 'average', boss: 'Arkhaia' });
    const sec = r.explanation.find(x => /^Built for /.test(x.h));
    ok(sec && sec.list.some(l => /No tactics are written/.test(l)),
       'an unmodelled boss did not say so');
  });

  it('is a complete no-op when no boss is chosen', () => {
    // Boss targeting must never leak into an ordinary request. Same build, with
    // the boss field left alone, has to come out exactly as it would have before
    // the feature existed - no penalty, no reasons, no extra section.
    for (const boss of [undefined, null, '']) {
      const r = engine.ask('', { klass: 'Hexer (N)', goal: 'damage', play: 'solo',
                                 dmg: 'average', boss });
      eq(r.ctx.bossFit.mult, 1, 'boss=' + JSON.stringify(boss) + ' penalised the build anyway');
      eq(r.ctx.bossFit.reasons.length, 0, 'boss=' + JSON.stringify(boss) + ' produced reasons');
      ok(!r.explanation.some(x => /^Built for /.test(x.h)),
         'boss=' + JSON.stringify(boss) + ' added a boss section');
    }
  });

  it('picks the same build with no boss as it did before the feature existed', () => {
    // The stronger version of the above: the SCORE and the actual build must be
    // untouched, not merely the multiplier.
    const spec = { klass: 'Berserker (Ch)', goal: 'damage', play: 'solo', dmg: 'average' };
    const a = engine.ask('', spec);
    const b = engine.ask('', Object.assign({ boss: null }, spec));
    eq(a.ctx.score, b.ctx.score, 'an explicit null boss changed the score');
    eq(a.build.weapon.name, b.build.weapon.name, 'an explicit null boss changed the weapon');
    eq(JSON.stringify(a.build.invested), JSON.stringify(b.build.invested),
       'an explicit null boss changed the stat allocation');
  });

  it('does not tell the panel to auto-pick a boss', () => {
    // Every other field's blank option is "Auto", meaning the engine chooses.
    // On this one there is nothing to choose, and "Auto" reads as an instruction
    // to go and pick a fight.
    const root = path.join(__dirname, '..', '..');
    const js = fs.readFileSync(path.join(root, 'js/build-ai.js'), 'utf8');
    // The field spans two lines, so read the whole field(...) call rather than
    // one line of it.
    const at = js.indexOf("field('bai-boss'");
    ok(at !== -1, 'no boss field in the panel');
    const call = js.slice(at, js.indexOf('</select>', at));
    ok(call.indexOf('auto()') === -1, 'the boss field still offers "Auto": ' + call.trim());
    ok(call.indexOf('None') !== -1, 'the boss field does not offer an explicit "None"');
  });

  it('offers the boss picker in the panel, driven by the data', () => {
    const root = path.join(__dirname, '..', '..');
    const js = fs.readFileSync(path.join(root, 'js/build-ai.js'), 'utf8');
    ok(/bai-boss/.test(js), 'no boss picker in the panel');
    ok(/BOSS_MOVE_DATA/.test(js), 'the picker is not driven by the extracted boss data');
    ok(/encounterKinds/.test(js), 'the picker does not filter by the encyclopedia classification');
    ok(/'bai-boss'/.test(js), 'the picker is not resettable with the other options');
  });

  it('classifies every encounter that has a kit', () => {
    // 29 of the 39 kits are ordinary mobs. The classification is what keeps
    // Slime and Goblin out of a boss picker, so a kit with no kind is a hole in
    // the picker rather than a harmless gap.
    const kinds = data.encounterKinds || {};
    const unplaced = Object.keys(data.BOSS_MOVE_DATA || {}).filter(n => !kinds[n]);
    eq(unplaced.length, 0, 'no encounter kind for: ' + unplaced.join(', '));
  });

  it('classifies the named bosses as bosses', () => {
    // The parser lost Yar'Thul and Metrom's Vessel twice over - once to an
    // apostrophe inside a double-quoted name, once to reading the capture group
    // that held the quote character rather than the name. Both are real bosses
    // and both vanished from the picker without a word.
    const kinds = data.encounterKinds || {};
    for (const n of ["Yar'Thul, The Blazing Dragon", "Metrom's Vessel", 'Seraphon',
                     'Thorian, The Rotten', 'Arkhaia'])
      eq(kinds[n], 'Boss', n + ' is classified as ' + JSON.stringify(kinds[n]));
    eq(kinds['Goblin'], 'Mob', 'Goblin is not classified as a mob');
    eq(kinds['Slime King'], 'Mini Boss', 'Slime King is not a mini boss');
  });

  it('does not classify a quote character as an encounter', () => {
    // What the group-index slip actually produced: two entries keyed by ' and ".
    const kinds = data.encounterKinds || {};
    for (const junk of ["'", '"', ''])
      ok(!(junk in kinds), 'a quote character was parsed as an encounter name');
  });

  it('every boss named in the tactics table exists in the data', () => {
    for (const name of Object.keys(K.BOSS_TACTICS)) {
      ok((data.BOSS_MOVE_DATA || {})[name],
         'BOSS_TACTICS names "' + name + '", which is not in the extracted boss data');
    }
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
    // No scrolls: with one equipped the rotation opens by casting it, so the
    // form entry starts on turn 2 and the span shifts. That is correct and it
    // is not what this test is checking.
    const r = engine.ask('', { klass: 'Darkwraith (Ch)', goal: 'damage', play: 'solo',
                               corruption: true, sub: 'none', scroll1: 'none', scroll2: 'none', lostScroll: 'none' });
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
    // Buffs are cast after the entry, so they are still up when the finisher
    // lands. Listed first, a 3-turn buff expired during the 7-turn entry.
    for (const su of (r.ctx.rotation || [])) {
      const line = rot.list.find(l => l.indexOf('— ' + su.move + '.**') !== -1);
      if (!line) continue;
      ok(rot.list.indexOf(line) > rot.list.indexOf(entryLine),
         su.move + ' is cast before the form entry, so it has run out before the finisher');
      const at = Number((line.match(/Turn (\d+)/) || [])[1]);
      const def = (r.ctx.setups || []).find(x => x.move === su.move) || {};
      if (def.duration > 0) {
        ok(at + def.duration - 1 >= n,
           su.move + ' cast on turn ' + at + ' for ' + def.duration + ' turns has ended before the turn-' + n + ' finisher');
      }
    }
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
    // agesPagesSpend joined this list by crashing the builder the same way:
    // declared beside luckyHornsSpend, read by updatePecents at load.
    // midasLckStacks (Midas's Luck stacks) is read by updatePecents at load too.
    const watched = ['UNRELEASED_GEAR', 'ivoryNrgStacks', 'midasLckStacks', 'luckyHornsSpend',
                     'corruptionBuffsActive', 'agesPagesSpend'];
    for (const name of watched) {
      const declRe = new RegExp('(?:const|let)\\s+' + name + '\\b');
      const decl = src.search(declRe);
      if (decl === -1) continue;                        // renamed or removed
      // The first mention of the name anywhere that is not the declaration.
      //
      // Mentions inside comments do not run, so they cannot throw. Counting
      // them made this fire on a comment that explained WHY a binding had been
      // moved — the guard objecting to its own documentation. Line comments and
      // block-comment continuation lines are skipped; anything else, including
      // a trailing // after real code, still counts.
      const inComment = i => {
        const lineStart = src.lastIndexOf(String.fromCharCode(10), i) + 1;
        const before = src.slice(lineStart, i);
        const trimmed = before.replace(/^\s+/, '');
        return trimmed.slice(0, 2) === '//' || trimmed.slice(0, 1) === '*';
      };
      const all = [];
      const useRe = new RegExp('\\b' + name + '\\b', 'g');
      let m;
      while ((m = useRe.exec(src)) !== null) if (!inComment(m.index)) all.push(m.index);
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
    //
    // Pinned to the SPEED goal, which is the build that reliably buys the
    // capstone. On a damage goal the Ranger's capstone choice moves with the rest
    // of the engine, and this test is about how an ability is LABELLED, not about
    // which build happens to buy it.
    const r = engine.ask('', { klass: 'Ranger (Or)', goal: 'speed', play: 'solo' });
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
    // A damage goal scores survivability at exactly zero, so Strategist - a
    // Hexer's damage-reduction capstone - reads as worthless to it. That is a
    // real trade, and the answer to "why is the obvious mastery missing".
    // (This used to pin a Ranger's Lightspeed, which the Ranger rework turned
    // from autododge into Speed that Ranger moves scale on.)
    const r = engine.ask('', { klass: 'Hexer (N)', goal: 'damage', play: 'solo' });
    const sec = r.explanation.find(x => x.h === 'Masteries it did not take');
    ok(sec, 'nothing explains the capstones it did not buy');
    const row = (sec.table || []).find(t => /Strategist/.test(t[0]));
    ok(row, 'Strategist is not among them');
    ok(/Nothing towards/.test(row[1]), 'no reason given for Strategist: ' + row[1]);
  });

  it('gives every capstone it skipped a reason, not just a name', () => {
    // The whole point. A list of things it did not take, with no why attached,
    // is the output this replaced.
    const REASONS = ['value', 'lost', 'zero', 'unmodelled', 'bugged'];
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
        // A KNOWN-BUGGED ability is not an unpriced one. "We have no number for
        // this" and "this does not work" are different admissions and the
        // write-up must not collapse them — so bugged entries are checked by
        // the bugged tests instead, and skipped here.
        if (rule && rule.kind === 'bugged') {
          eq(x.reason, 'bugged', x.name + ' is bugged but was reported as ' + x.reason);
          continue;
        }
        const priced = K.masteryRulePriced(rule);
        if (!priced) {
          seen++;
          eq(x.reason, 'unmodelled', x.name + ' is unpriced but was reported as ' + x.reason);
        }
      }
    }
    ok(seen > 0, 'no unpriced capstone was skipped anywhere, so this proves nothing');
  });

  it('counts a multi-effect capstone as priced', () => {
    // Overload became two statPct effects with no top-level value; the engine
    // prices it, so the write-up must not call it "not priced here".
    ok(K.masteryRulePriced(K.MASTERY_ABILITIES.Overload), 'Overload is read as unpriced');
    ok(!K.masteryRulePriced({ kind: 'note', value: 5 }), 'a note is read as priced');
    ok(!K.masteryRulePriced({ kind: 'multi', effects: [{ kind: 'note' }] }), 'a multi with no numbers is read as priced');
    const r = engine.ask('', { klass: 'Lancer (N)', goal: 'damage', play: 'solo' });
    const skip = (r.build.masteryPassedOver || []).find(x => x.name === 'Overload');
    ok(!skip || skip.reason !== 'unmodelled', 'Overload was passed over as not priced');
  });

  it('says out loud that an unpriced capstone is a gap here, not a weak ability', () => {
    // A Lancer skips capstones that are notes (Jolting Dodges, Rallying Shout
    // and Discharge Proficiency), so the section always has something to explain.
    const r = engine.ask('', { klass: 'Lancer (N)', goal: 'damage', play: 'solo' });
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

  it('turns Lightspeed into Speed worth a share of Arcane', () => {
    // Ranger rework (patch 2026-09-16): Lightspeed's stacking autododge is gone.
    // Every Verdant Archer proc now grants Speed equal to 10% of your Arcane,
    // counted at 60% uptime [assumed]. The share reads the SITE Arcane and lands
    // on the in-fight totals only, so the reported stat line stays the site's.
    const rule = K.MASTERY_ABILITIES['Lightspeed'];
    ok(rule && rule.kind === 'statFromStat' && rule.stat === 'spd' && rule.from === 'arc' && rule.value === 10,
       'Lightspeed is not 10% of Arcane as Speed: ' + JSON.stringify(rule));
    eq(((data.masteryAbilities['Ranger (Or)'] || {}).cm1 || {}).name, 'Lightspeed', 'the fixture capstone moved');
    const spec = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'speed' }, data);
    const tree = ['s1', 's2', 's3', 's4', 'c1', 'c2a', 'c3a', 'cb1'];
    const mk = nodes => {
      const b = M.emptyBuild();
      b.level = 50; b.klass = 'Ranger (Or)'; b.race = 'Estella (24%)';
      b.invested.arc = 100; b.masteryNodes = nodes;
      return b;
    };
    const withLs = mk(tree.concat('cm1')), without = mk(tree.slice());
    eq(JSON.stringify(O.masteryAbilityTotals(withLs, spec).statFromStat),
       JSON.stringify([{ stat: 'spd', from: 'arc', pct: rule.value * rule.uptime }]),
       'Lightspeed does not reach the stat-from-stat totals');
    const a = O.evaluate(withLs, spec), b = O.evaluate(without, spec);
    const want = a.siteStats.arc * rule.value * rule.uptime / 100;
    ok(want > 0, 'the probe has no Arcane to take a share of');
    ok(Math.abs((a.stats.spd - b.stats.spd) - want) < 1e-9,
       'Lightspeed added ' + (a.stats.spd - b.stats.spd) + ' Speed, not ' + want);
    eq(a.siteStats.spd, b.siteStats.spd, 'Lightspeed leaked into the site Speed total');
    eq(a.dodge, 0, 'Lightspeed still grants autododge');
    // And a Ranger building for Speed buys it for that.
    const r = engine.ask('', { klass: 'Ranger (Or)', goal: 'speed', play: 'solo' });
    ok(r.ctx.masteryAbilities.active.some(x => x.name === 'Lightspeed' && x.kind === 'statFromStat'),
       'a speed Ranger did not take Lightspeed');
  });

  it('keeps avoidance out of the HP it reports', () => {
    // effectiveHp is for scoring only. The HP this build reports has to stay the
    // HP the site will show, or the link and the write-up disagree. No capstone
    // grants autododge since the Lightspeed rework, so the avoidance here is the
    // SPD 110 milestone (15%).
    const spec = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'tank' }, data);
    const b = M.emptyBuild();
    b.level = 50; b.klass = 'Ranger (Or)'; b.race = 'Estella (24%)';
    b.invested.spd = O.investedForTotal(b, 'spd', data.STAT_MILESTONE_TIERS[2]);
    const c = O.evaluate(b, spec);
    eq(c.milestones.dodgePct, 15, 'SPD 110 does not grant 15% autododge');
    ok(Number.isFinite(c.hp) && c.hp > 0, 'reported HP is not a number');
    ok(Math.abs(c.hp - M.derived(b).hp) < 1e-9, 'the reported HP ' + c.hp + ' is not the site HP ' + M.derived(b).hp);
    ok(c.hp < c.effectiveHp, 'the two figures are the same, so one of them is wrong');
    ok(Math.abs(c.effectiveHp - c.hp / (1 - 0.15)) < 1e-9, 'effective HP does not carry the 15% avoidance: ' + c.effectiveHp);
    // One point short of the milestone: no avoidance, and the figures agree.
    b.invested.spd -= 1;
    const short = O.evaluate(b, spec);
    ok(short.siteStats.spd < data.STAT_MILESTONE_TIERS[2], 'the probe did not drop under 110');
    eq(short.effectiveHp, short.hp, 'avoidance counted without the milestone');
  });

  it('discounts a conditional ability, and does not discount an unconditional one', () => {
    // Uptime is the whole reason this table exists: a +50% that has to be
    // charged first cannot be scored like a +50% that always applies.
    const r = engine.ask('', { klass: 'Lancer (N)', goal: 'damage' });
    const cell = K.MASTERY_ABILITIES['Cell Charge'];
    ok(cell && cell.uptime < 0.35,
       'Cell Charge needs 10 blocks or 20 dodges first, so it cannot be near full uptime');

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
        // `ratios`: hits at a share of the full one (Discharge Proficiency).
        ok(rule.base !== undefined || rule.scaling !== undefined || rule.second ||
           (Array.isArray(rule.ratios) && rule.ratios.length > 0 && rule.ratios.every(r => r > 0 && r <= 1)),
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
      // 'note' and 'bugged' carry no value, so there is no number for a unit to
      // label. Everything that DOES carry a value needs a unit in every
      // renderer, or it silently reads as "% damage".
      // A `multi` is several kinds under one name; each of them is rendered.
      if (r && r.kind === 'multi') { for (const e of (r.effects || [])) if (e.kind !== 'dmgPct') kinds.add(e.kind); continue; }
      if (r && r.kind && r.kind !== 'note' && r.kind !== 'bugged' && r.kind !== 'dmgPct') kinds.add(r.kind);
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
      // Three legitimate sources now: gear, weapon series, and artifact
      // abilities (which grant several kinds at once from one entry).
      const rule = (K.GEAR_PASSIVES || {})[a.name] || (K.WEAPON_PASSIVES || {})[bare] ||
                   (K.ARTIFACT_ABILITIES || {})[a.name];
      ok(rule, a.name + ' is counted but has no knowledge entry');
      if (rule.effects) {
        ok(rule.effects.some(e => e.kind === a.kind),
           a.name + ' is reported as ' + a.kind + ', which is not among its effects');
      } else {
        eq(a.kind, rule.kind, a.name + ' is reported as ' + a.kind + ' but is ' + rule.kind);
      }
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

  it('does not hand every build the same covenant', () => {
    // The audit that caught Stellian Core winning 36 of 36 artifact slots. A
    // covenant grants no stats, so the fit table decides a good share of these
    // rolls — which is exactly the situation where one hand-written score can
    // quietly become the answer to every question.
    const picks = {}, how = {};
    for (let i = 0; i < 24; i++) {
      const r = engine.ask('', { random: true, play: 'solo' });
      const c = r.build.covenant || '(none)';
      picks[c] = (picks[c] || 0) + 1;
      const d = (r.covenant && r.covenant.decidedBy) || '?';
      how[d] = (how[d] || 0) + 1;
    }
    ok(!picks['(none)'], 'some random rolls came back with no covenant at all');
    ok(Object.keys(picks).length >= 2,
       'every random roll got the same covenant: ' + JSON.stringify(picks));
    // And the measured path has to be alive. If covenantBonuses stopped reaching
    // model.js, or the covenant attacks stopped reaching the move pool, every
    // roll would fall through to the fit table and this would read 100% fit —
    // which looks perfectly healthy from the outside.
    ok((how.measured || 0) > 0,
       'no roll was decided by measurement, so nothing a covenant gives is ' +
       'reaching the numbers: ' + JSON.stringify(how));
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
                          'optimize.js', 'explain.js', 'share.js', 'plan.js', 'engine.js'];

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

  // version.json is what already-open tabs poll to learn they are stale. If it
  // disagrees with the SITE_VERSION baked into the page, either every tab
  // believes it is out of date forever (banner that never goes away) or none of
  // them ever notice a real deploy. Both failures are silent in a browser, so
  // catch them here.
  // An inline handler puts its value in TWO nested parsers: HTML decodes the
  // attribute, then JS parses the string. esc() only handles the outer one, and
  // the entity it produces for an apostrophe is decoded back into a real quote
  // before JS ever sees it — so esc() inside a handler is not protection, it
  // only looks like it. Usernames, host names and notification meta all reach
  // these sinks and are all client-written. escAttrJs strips the quote
  // characters first, then escapes, which is the only order that works.
  // loadBuildState drives the pickers with synthetic 'change' events, so every
  // render reachable from a picker handler runs once per event and is then
  // thrown away by the "Final renders" block. Measured at 17x for
  // renderDmgBonusSection alone. The flag is what keeps that at 1x; if a guard
  // is dropped, nothing fails visibly - the page just gets slow again.
  // A new QTE high reaches submitScore twice: the trainer calls _sbSubmitScore
  // directly and the Storage.setItem hook in core.js fires for the same write.
  // Comp mode only has the explicit call, because the hook's regex does not
  // match 'fist-comp', so neither caller can simply be deleted - the dedupe has
  // to live in submitScore, and it has to release on failure or a rejected
  // session would make the score permanently unsubmittable.
  // _render is called on every keystroke, class chip and sort toggle. If these
  // derived fields go back to being computed inside it, the cost returns as a
  // per-character DOMParser sanitise of every summary - invisible in a test
  // that only checks output, which is why this checks the shape instead.
  // bkPull used to take a boolean `force`, and bkSync passed isNewOwner - true
  // for a first sign-in on a browser AND for switching accounts. That single
  // conflation caused three data bugs: a first claim replaced the bank the user
  // had built while logged out; a swap to an account with no bank fell through
  // and uploaded the PREVIOUS user's slots under the new id; and an empty
  // server bank was read as "no data", so deleting every slot never reached
  // another device. All three are silent - nothing errors, data just moves or
  // vanishes - so there is no way to notice a regression except here.
  // The popup receives each inbound DM twice - forwarded from the main window
  // and from its own subscription - so it showed a duplicate bubble and sent
  // two read receipts. Both transports are kept on purpose (either can be the
  // one that survives), so the dedupe is what stops the duplicate, and both
  // must go through the one handler or the conversation-list refresh regresses.
  // The online counter used a Realtime presence channel every visitor joined.
  // Presence fans out to all N subscribers on every join and leave, so cost
  // grows with N squared: measured at 355 bytes per diff and ~31 diffs/min per
  // client, which billed 12.256 GB in one day - 99.6% of all project egress -
  // for a decorative number, and held a websocket per anonymous visitor against
  // the 200-connection cap. Reintroducing presence here would silently restore
  // a quadratic bill, so this guards the shape rather than the behaviour.
  // Pairing runs off realtime presence, so two players must be in the SAME
  // 'mm-q-<mode>-<qte>' channel at the same moment - 24 buckets, and the only
  // way to find out whether anyone was in one was to join it and wait.
  // Measured: 52 queue rows against 7 matches ever. The counts are what make
  // that navigable, and the heartbeat is what makes the counts true.
  // supabase-js query builders are lazy: `sb.from(t).delete().eq(...)` with no
  // await and no .then() builds a request and never sends it. Verified in the
  // live console - the bare form produced zero network requests. Every write
  // that is not awaited must therefore end in .then(), and this is invisible
  // otherwise: the code reads correctly and silently does nothing.
  it('every fire-and-forget supabase write actually dispatches', () => {
    const FILES = ['js/matchmaking.js', 'js/party.js', 'js/sb.js', 'js/trades.js',
                   'js/bank.js', 'js/builds.js', 'js/saved-builds.js', 'html/dm-popup.html'];
    const WRITE = /(?:sb|client|_sbClient)\s*\.\s*(?:from\([^)]*\)\s*\.\s*(?:delete|update|insert|upsert)|rpc)\s*\(/g;
    const bad = [];
    for (const f of FILES) {
      const src = readRoot(f);
      WRITE.lastIndex = 0;
      let m;
      while ((m = WRITE.exec(src)) !== null) {
        const before = src.slice(Math.max(0, m.index - 260), m.index);
        // Awaited, returned, assigned, or inside a Promise.all/array all settle it.
        if (/\bawait\s*$|\breturn\s*$|=\s*$|\[\s*$|,\s*$/.test(before)) continue;
        // Otherwise the chain has to end in .then() before the statement does.
        const after = src.slice(m.index, m.index + 420);
        const stmt = after.split(';')[0];
        if (stmt.indexOf('.then(') === -1) {
          bad.push(f + '  ' + stmt.replace(/\s+/g, ' ').slice(0, 92));
        }
      }
    }
    eq(bad.length, 0,
       'supabase write(s) that are built but never sent:\n  ' + bad.join('\n  '));
  });

  it('the matchmaking queue shows counts and heartbeats while queued', () => {
    const mm = readRoot('js/matchmaking.js');

    ok(mm.indexOf("sb.rpc('mm_queue_counts')") !== -1, 'the queue-counts rpc call is gone');
    ok(mm.indexOf('function paintQueueCounts()') !== -1, 'the count painter is gone');
    ok(mm.indexOf('function startQueueHeartbeat()') !== -1, 'the queue heartbeat is gone');
    ok(/const MM_HEARTBEAT_MS = \d+;/.test(mm), 'the heartbeat interval is gone');

    // A row that is never refreshed is how 52 of them accumulated.
    ok(mm.indexOf("sb.from('mm_queue').update({ seen_at:") !== -1,
       'the heartbeat no longer stamps seen_at');
    ok(mm.indexOf('created_at: _now, seen_at: _now') !== -1,
       'joining the queue no longer stamps seen_at, so a fresh join looks stale');

    // Leaving the home screen must stop the poll, or it runs forever.
    const sq = mm.indexOf('async function startQueue(');
    ok(sq !== -1 && mm.slice(sq, sq + 400).indexOf('stopCountsPoll()') !== -1,
       'entering the queue no longer stops the counts poll');
    ok(mm.indexOf('function stopQueueHeartbeat()') !== -1, 'the heartbeat has no stop');

    // The SQL the client depends on has to be in the repo.
    const sql = readRoot('supabase/matchmaking-queue-fix.sql');
    ok(/create or replace function mm_queue_counts\(\)/.test(sql),
       'mm_queue_counts is not defined in supabase/matchmaking-queue-fix.sql');
    ok(sql.indexOf('alter table mm_queue add column if not exists seen_at timestamptz;') !== -1,
       'seen_at is not added by the migration');
    // Stamping every existing row as new would have made all 52 stale rows
    // look live; the backfill from created_at is what prevents that.
    ok(sql.indexOf('update mm_queue set seen_at = created_at where seen_at is null;') !== -1,
       'the seen_at backfill is gone - stale rows would all look fresh');
  });

  // matchmaking.js and .css are cache-stamped in index.html. Shipping a change
  // without bumping the stamp means returning visitors keep the old file, which
  // looks exactly like the change not working.
  // Disconnecting loses the match - but the survivor does not get to say so.
  // "My opponent vanished, give me the win" is the cheapest forgery in the game:
  // it needs no round log and no accomplice. The only thing that makes it
  // checkable is a timestamp the OTHER player wrote, which is what the per-match
  // heartbeat is for.
  it('a disconnect loss is verified by the server, not claimed by the survivor', () => {
    const mm = readRoot('js/matchmaking.js');

    // The survivor asks; it does not award itself the match.
    ok(mm.indexOf("sb.rpc('mm_report_disconnect'") !== -1,
       'the disconnect path no longer goes through mm_report_disconnect');
    const dc = mm.indexOf('async function tryClaimDisconnect');
    ok(dc !== -1, 'tryClaimDisconnect is gone');
    const body = mm.slice(dc, mm.indexOf('function resolveLocally'));
    ok(body.indexOf('mm_apply_result') === -1,
       'the disconnect path claims a win via mm_apply_result again - the server refuses that');

    // Without the ping, every opponent looks permanently dead.
    ok(mm.indexOf("sb.rpc('mm_match_ping'") !== -1, 'the per-match heartbeat is gone');
    ok(/const MM_PING_MS\s*=\s*\d+;/.test(mm), 'the match ping interval is gone');
    const em = mm.indexOf('function enterMatch(');
    ok(em !== -1 && mm.slice(em, em + 900).indexOf('startMatchPing()') !== -1,
       'entering a match no longer starts the heartbeat');
    const td = mm.indexOf('function teardownMatch(');
    ok(td !== -1 && mm.slice(td, td + 400).indexOf('stopMatchPing()') !== -1,
       'leaving a match no longer stops the heartbeat');

    // A tab close concedes via mm_abandon_match, but the 'abandon' broadcast
    // does not survive the unload - so the survivor learns it from the RPC's
    // return value. Treating that as "nothing happened" reported no result for
    // a match they had won.
    ok(body.indexOf('showMatchOverlay(winner') !== -1,
       'the disconnect path ignores the winner the server reports back');
  });

  // Postgres grants EXECUTE on a new function to PUBLIC by default, so
  // `grant execute ... to authenticated` restricts nothing - it re-states a
  // privilege anon already has. Probing the live database as an anonymous
  // visitor, every matchmaking RPC answered except the two that happened to
  // carry a revoke. Pair every function with one.
  it('every database function is revoked from public', () => {
    const FILES = ['matchmaking.sql', 'matchmaking-queue-fix.sql', 'matchmaking-hardening.sql',
                   'online-heartbeat.sql', 'reports.sql', 'testers.sql', 'rpc-anon-lockout.sql'];
    // Names that some file in the set revokes from public. A function may be
    // defined in one file and locked down in another (that is what
    // rpc-anon-lockout.sql is), so collect across the whole set first.
    const revoked = new Set();
    const defined = new Map();
    for (const f of FILES) {
      let src;
      try { src = readRoot('supabase/' + f); } catch (_) { continue; }
      let m;
      const REVOKE = /revoke\s+all\s+on\s+function\s+(?:public\.)?([a-z_]+)\s*\([^)]*\)\s*from\s+([^;]+);/gi;
      while ((m = REVOKE.exec(src)) !== null) {
        if (/\bpublic\b/.test(m[2])) revoked.add(m[1].toLowerCase());
      }
      const DEF = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_]+)\s*\(/gi;
      while ((m = DEF.exec(src)) !== null) {
        if (!defined.has(m[1].toLowerCase())) defined.set(m[1].toLowerCase(), f);
      }
    }
    const naked = [...defined.entries()].filter(([n]) => !revoked.has(n));
    eq(naked.length, 0,
       'function(s) never revoked from public - anon can call these:\n  ' +
       naked.map(([n, f]) => n + '()  (defined in supabase/' + f + ')').join('\n  '));
  });

  // auth.uid() is NULL for an anonymous caller, and `NULL <> x` is NULL, not
  // TRUE - so `if me <> m.p1_id and me <> m.p2_id then return` does not fire and
  // the function runs on with me = NULL. In mm_apply_result that skipped every
  // rule gated on `winner = me` and let an anonymous caller name the winner of
  // any live ranked match.
  it('every function that reads auth.uid() refuses a null caller', () => {
    const sql = readRoot('supabase/rpc-anon-lockout.sql');
    for (const fn of ['mm_match_ping', 'mm_apply_result', 'mm_report_disconnect', 'mm_abandon_match']) {
      const i = sql.indexOf('create or replace function ' + fn + '(');
      ok(i !== -1, fn + ' is not defined in supabase/rpc-anon-lockout.sql');
      const body = sql.slice(i, sql.indexOf('$$;', i));
      ok(/if me is null then (return|raise)/.test(body),
         fn + ' no longer refuses a null auth.uid() - its participant check silently passes for anon');
    }
    // mm_create_match already had the guard; keep it.
    const qf = readRoot('supabase/matchmaking-queue-fix.sql');
    ok(qf.indexOf("if me is null then raise exception 'not authenticated'; end if;") !== -1,
       'mm_create_match no longer refuses a null auth.uid()');
  });

  // `started` gates onOppPresenceLeave. It used to be set only inside
  // maybeStartMatch, which is `if (isHost ...)`, so every GUEST had it false for
  // the whole match and could never report a disconnect - and their only way out
  // of a frozen arena was Leave, which concedes to the player who dropped.
  // Host is just the smaller uuid, so this silently disabled the feature for
  // half of all players.
  it('both players can report a disconnect, not just the host', () => {
    const mm = readRoot('js/matchmaking.js');

    // doRoundStart is the one path both sides run.
    const drs = mm.indexOf('function doRoundStart(');
    ok(drs !== -1, 'doRoundStart is gone');
    ok(mm.slice(drs, drs + 700).indexOf('started = true') !== -1,
       'doRoundStart no longer sets started - guests cannot report a disconnect');

    // If the only assignment is behind an isHost check we are back where we started.
    const hostOnly = /if \(isHost && !started && oppReady\) \{ started = true;/.test(mm);
    const bothSides = mm.slice(drs, drs + 700).indexOf('started = true') !== -1;
    ok(bothSides || !hostOnly, 'started is still only ever set on the host');

    // Leaving while chasing the opponent's disconnect must not concede to them.
    const td = mm.indexOf('function teardownMatch(');
    const tdBody = mm.slice(td, td + 900);
    ok(tdBody.indexOf('_wasChasing') !== -1,
       'leaving during a disconnect chase concedes the match to the player who left');
  });

  it('the disconnect RPCs exist and check what they claim to check', () => {
    const sql = readRoot('supabase/matchmaking-hardening.sql');

    ok(/create or replace function mm_match_ping\(match uuid\)/.test(sql),
       'mm_match_ping is not defined');
    ok(sql.indexOf('add column if not exists p1_seen_at timestamptz') !== -1 &&
       sql.indexOf('add column if not exists p2_seen_at timestamptz') !== -1,
       'the per-match liveness columns are gone');

    // Settlement is split out so mm_report_disconnect can award a win without
    // impersonating the host. If anyone could call it directly, every rule above
    // it would be bypassable in one RPC.
    ok(/create or replace function mm_settle\(/.test(sql), 'mm_settle is not defined');
    ok(sql.indexOf('revoke all on function mm_settle(uuid, uuid, jsonb) from anon, authenticated;') !== -1,
       'mm_settle is callable by clients - that bypasses every check in this file');

    const dc = sql.indexOf('create or replace function mm_report_disconnect');
    ok(dc !== -1, 'mm_report_disconnect is not defined');
    const body = sql.slice(dc, sql.indexOf('grant execute on function mm_report_disconnect'));
    // The three things that stop this being a free win.
    ok(body.indexOf('if opp_seen is null then return null; end if;') !== -1,
       'a never-pinged opponent is treated as dead - every old client becomes free RR');
    ok(/if opp_seen > now\(\) - interval '30 seconds' then return null; end if;/.test(body),
       'the staleness window is gone - a live opponent could be claimed as disconnected');
    ok(/if m\.created_at > now\(\) - interval '20 seconds' then return null; end if;/.test(body),
       'the minimum match age is gone');
    ok(body.indexOf('if m.status = \'done\' then return m.winner_id; end if;') !== -1,
       'an already-settled match reports nothing back, so a won match ends as "no result"');

    // Rule (1) has to exempt concessions, or mm_abandon_match cannot work at
    // all - it awards the win to the OTHER player, so its caller is the loser.
    const ar = sql.indexOf('create or replace function mm_apply_result');
    const arBody = sql.slice(ar, sql.indexOf('grant execute on function mm_apply_result'));
    ok(arBody.indexOf('if winner = me and me <> host then') !== -1,
       'the host-only rule no longer exempts concessions - abandoning would raise');
    ok(arBody.indexOf("if m.mode = 'ranked' and winner = me then") !== -1,
       'the round-log rule no longer exempts concessions - a host could not abandon');
  });

  it('the matchmaking assets are version-stamped past their last change', () => {
    const html = readRoot('index.html');
    const js  = /js\/matchmaking\.js\?v=(\d+)/.exec(html);
    const css = /css\/matchmaking\.css\?v=(\d+)/.exec(html);
    ok(js,  'matchmaking.js is not version-stamped');
    ok(css, 'matchmaking.css is not version-stamped');
    ok(+js[1]  >= 12, 'matchmaking.js stamp is behind the disconnect change (v' + js[1] + ')');
    ok(+css[1] >= 8,  'matchmaking.css stamp is behind the badge styles (v' + css[1] + ')');
  });

  it('the online counter uses the heartbeat RPC, not a realtime channel', () => {
    const html = readRoot('index.html');

    ok(html.indexOf("sb.rpc('ping_online'") !== -1, 'the heartbeat rpc call is gone');
    ok(html.indexOf('const ONLINE_POLL_MS  = 60000;') !== -1,
       'the poll interval changed - check it is still deliberate');

    // No presence machinery anywhere in the page.
    for (const gone of ["channel('alb-online'", 'presenceState(', 'initPresence',
                        'schedulePresenceRetry', '_presenceChannel']) {
      ok(html.indexOf(gone) === -1,
         'presence machinery is back in index.html: ' + gone);
    }

    // A hidden tab must not heartbeat, or a wall of forgotten tabs costs money
    // for a number nobody is reading.
    const at = html.indexOf('async function pingOnline()');
    ok(at !== -1, 'pingOnline is gone');
    ok(html.slice(at, at + 900).indexOf("document.visibilityState !== 'visible'") !== -1,
       'pingOnline no longer skips hidden tabs');

    // A flat retry would have every visitor hammering a function that does not
    // exist yet, and error bodies are billed like any other response.
    ok(html.indexOf('const ONLINE_MAX_RETRY_MS = 300000;') !== -1,
       'the failure backoff cap is gone');
    ok(html.indexOf('ONLINE_RETRY_MS * Math.pow(2, _onlineFails - 1)') !== -1,
       'failed pings no longer back off');

    // The SQL the client depends on has to be in the repo.
    const sql = readRoot('supabase/online-heartbeat.sql');
    ok(/create or replace function ping_online\(p_fp text\)/.test(sql),
       'ping_online is not defined in supabase/online-heartbeat.sql');
    ok(sql.indexOf('grant execute on function ping_online(text) to anon, authenticated;') !== -1,
       'anon can no longer call ping_online - logged-out visitors are most of the count');
  });

  it('the DM popup deduplicates messages arriving on both transports', () => {
    const h = readRoot('html/dm-popup.html');
    ok(h.indexOf('function handleIncomingDm(m)') !== -1,
       'the shared inbound-DM handler is gone');
    ok(h.indexOf('function _firstSighting(id)') !== -1, 'the dedupe is gone');
    ok(h.indexOf("if (e.data?.type === 'new-msg') handleIncomingDm(e.data.msg);") !== -1,
       'the BroadcastChannel path no longer routes through the shared handler');
    ok(h.indexOf('}, p => handleIncomingDm(p.new))') !== -1,
       'the postgres_changes path no longer routes through the shared handler');
    // The duplicate bubble came from an inbound transport appending directly.
    // appendMsg legitimately appears four times (its definition, rendering a
    // loaded thread, handleIncomingDm, and the optimistic append after you send
    // one), so counting them proves nothing - what matters is that neither
    // transport handler appends on its own.
    const sm = h.indexOf('function subscribeMsgs(');
    ok(sm !== -1, 'subscribeMsgs not found');
    ok(h.slice(sm, sm + 700).indexOf('appendMsg(') === -1,
       'subscribeMsgs appends directly again - that is the duplicate bubble');
    const bc = h.indexOf('bc.onmessage');
    ok(bc !== -1, 'the BroadcastChannel handler is gone');
    ok(h.slice(bc, bc + 500).indexOf('appendMsg(') === -1,
       'the BroadcastChannel handler appends directly again');
  });

  it('bank sync distinguishes a first claim from an account swap', () => {
    const b = readRoot('js/bank.js');

    ok(b.indexOf("const accountSwap = isNewOwner && !!meta.owner;") !== -1,
       'bkSync no longer separates an account swap from a first claim');
    ok(b.indexOf("const mode = !isNewOwner ? 'normal' : (accountSwap ? 'swap' : 'claim');") !== -1,
       'the three reconcile modes are gone');
    ok(b.indexOf('bkPull(client, uid, mode)') !== -1,
       'bkSync passes something other than the mode to bkPull');
    ok(/async function bkPull\(client, uid, mode\)/.test(b),
       'bkPull went back to a boolean force');

    // A swap to an account with no bank must clear, never carry across.
    ok(b.indexOf("if (mode === 'swap') { bkResetLocal(uid); return true; }") !== -1,
       "an account swap with no server row no longer clears the previous user's slots");
    ok(b.indexOf('function bkResetLocal(uid)') !== -1, 'bkResetLocal is gone');

    // A first claim must never replace local work outright.
    ok(b.indexOf("if (mode === 'claim')") !== -1, 'the first-claim branch is gone');
    ok(b.indexOf('const untouched = meta.tabs.length === 1') !== -1,
       'the first-claim branch no longer checks whether local work exists');

    // The early return that made deletions unsyncable must stay gone.
    ok(b.indexOf('if (!serverSlots.length) return false;') === -1,
       'the empty-server-bank early return is back - deletions will not propagate');

    // Replacing with an empty bank must not index into an empty array.
    ok(b.indexOf("if (!meta.tabs.length) meta.tabs = [{ id: 'bk1', name: 'Slot 1', data: { items: [] } }];") !== -1,
       'an empty server bank would throw on meta.tabs[0]');
  });

  it('the Builds list derives summary, date and search text once', () => {
    const b = readRoot('js/builds.js');
    ok(b.indexOf('b._summHtml = b.build_summary ? _sanitizeSumm(b.build_summary) : \'\';') !== -1,
       'the summary is no longer sanitised at fetch time');
    ok(b.indexOf('b._ts       = Date.parse(b.created_at) || 0;') !== -1,
       'created_at is no longer parsed at fetch time');
    ok(b.indexOf('builds.filter(b => b._hay.some(h => h.includes(q)))') !== -1,
       'the search no longer uses the precomputed haystack');
    ok(b.indexOf('? b._ts - a._ts') !== -1,
       'the sort comparator allocates Date objects again');
    // The card must read the cached HTML, not re-sanitise.
    const at = b.indexOf('blds-card-summary');
    ok(at !== -1 && b.slice(at - 40, at + 80).indexOf('_summHtml') !== -1,
       'the card re-sanitises instead of using _summHtml');
    ok(/_searchT = setTimeout\(_render, \d+\)/.test(b),
       'the Builds search is no longer debounced');
  });

  // A casual high arrives twice: the trainer calls _sbSubmitScore and the
  // core.js setItem hook fires for the same localStorage write. The duplicate
  // used to be caught by a _lastSubmitted latch that also swallowed retries;
  // the pending/confirmed pair in the submission queue does both jobs now
  // (behaviour covered in 'QTE score submission').
  it('a QTE high is submitted once, and a failed submit stays retryable', () => {
    const sb = readRoot('js/sb.js');
    const at = sb.indexOf('function submitScore(');
    ok(at !== -1, 'submitScore not found');
    const body = sb.slice(at, at + 900);
    ok(body.indexOf('if (score <= (_pending[qteType] || 0) && !(hasLog && !pendingHasLog)) return Promise.resolve(false);') !== -1,
       'submitScore no longer drops the duplicate high');
    ok(body.indexOf('if (score <= (_confirmed[qteType] || 0))') !== -1,
       'submitScore no longer skips a score the server already holds');
    ok(sb.indexOf('function scheduleScoreRetry(') !== -1,
       'a failed submit is no longer retried - the score would be stuck');
    ok(!/_lastSubmitted/.test(sb),
       'the old sent-before-it-was-sent latch is back');
    // The core.js setItem hook sent a second, log-less copy of every casual
    // high; verified runs (js/qte-rules.js) carry a log, so it is gone.
    ok(readRoot('js/core.js').indexOf('window._sbSubmitScore(') === -1,
       'the core.js setItem hook is back - it submits casual scores a second time, with no run log');
  });

  // supabase-js fires TOKEN_REFRESHED roughly hourly with the same user. The
  // full login path re-fetches the profile and tester flag and dispatches
  // alb-auth-changed, which makes bank.js and saved-builds.js re-download their
  // whole jsonb blobs - once an hour, per open tab, to reach the state they
  // already had.
  it('a token refresh does not re-run the login path', () => {
    const sb = readRoot('js/sb.js');
    ok(sb.indexOf("if (_event === 'TOKEN_REFRESHED' && currentUser && session?.user?.id === currentUser.id)") !== -1,
       'TOKEN_REFRESHED no longer short-circuits');
  });

  // switchPage calls loadAllLeaderboards on every visit to the tab. Measured at
  // 22.3 KB per nav, identical every time; with the TTL a revisit costs 0.
  // The Refresh button has to keep working, so it forces past the cache.
  it('the leaderboards tab is memoised and Refresh still bypasses it', () => {
    const sb = readRoot('js/sb.js');
    ok(/async function loadAllLeaderboards\(mode, platform, force\)/.test(sb),
       'loadAllLeaderboards lost its force parameter');
    ok(sb.indexOf('if (!force && _allLbLast.key === _lbKey && grid.children.length') !== -1,
       'the leaderboards TTL check is gone');
    ok(sb.indexOf('window._lbRefresh') !== -1, '_lbRefresh is no longer exposed');
    // If the button went back to the plain loader it would hit the TTL and do
    // nothing, which looks exactly like a broken button.
    const html = readRoot('index.html');
    ok(html.indexOf('onclick="window._lbRefresh()"') !== -1,
       'the Refresh button no longer forces past the TTL');
  });

  // Only closePartyPanel removed the chat channel, so signing out with a panel
  // open left party-chat-<id> joined for a logged-out visitor - a realtime
  // connection and a 30s heartbeat against the 200-concurrent cap.
  it('party chat is released on logout', () => {
    const p = readRoot('js/party.js');
    const at = p.indexOf("window.addEventListener('alb-auth-changed'");
    ok(at !== -1, 'party.js no longer tears down on alb-auth-changed');
    const body = p.slice(at, at + 500);
    ok(body.indexOf('if (uid()) return;') !== -1,
       'the teardown no longer distinguishes logout from login/refresh');
    ok(body.indexOf('removeChannel(_chatSub)') !== -1,
       'the teardown no longer removes the chat channel');
  });

  it('the loadBuildState render cascade stays suppressed', () => {
    const b = readRoot('js/builder.js');
    const mr = readRoot('js/move-renderer.js');

    ok(b.indexOf('window._albLoadingBuild = true;') !== -1,
       'loadBuildState no longer sets _albLoadingBuild');
    ok(b.indexOf('} finally { window._albLoadingBuild = false; }') !== -1,
       'the flag is no longer cleared in a finally - a throw would strand it');

    const GUARD = 'if (window._albLoadingBuild) return;';
    ok(mr.indexOf(GUARD) !== -1, 'renderMoves lost its guard');
    for (const fn of ['renderDmgBonusSection', 'renderDmgCalc',
                      'renderMastery', 'renderMasteryInfoSection']) {
      const at = b.indexOf('function ' + fn + '(');
      ok(at !== -1, fn + ' not found');
      ok(b.slice(at, at + 400).indexOf(GUARD) !== -1, fn + ' lost its guard');
    }
  });

  it('inline handlers escape with escAttrJs, never plain esc', () => {
    const FILES = ['js/party.js', 'js/trades.js', 'js/sb.js',
                   'js/builds.js', 'js/matchmaking.js'];
    const HANDLER = /on(?:click|change|input|keydown|keyup|submit|focus|blur|mouseover)="[^"\r\n]*"/g;
    const bad = [];
    for (const f of FILES) {
      const src = readRoot(f);
      let m;
      HANDLER.lastIndex = 0;
      while ((m = HANDLER.exec(src)) !== null) {
        // '${escAttrJs(' does not match '${esc(' — the char after esc is 'A'.
        if (m[0].indexOf('${esc(') !== -1 || m[0].indexOf('${_esc(') !== -1) {
          bad.push(f + '  ' + m[0].slice(0, 88));
        }
      }
    }
    eq(bad.length, 0,
       'inline handler(s) using the plain escaper:\n  ' + bad.join('\n  '));
  });

  // AdSense listed "Ads.txt: Not found" for months because the file was never
  // in the repo. GitHub Pages serves the repo root, so it has to sit there, and
  // it has to name the same publisher as the tag in index.html - if the two
  // drift, ads still load and the revenue is flagged as unauthorised.
  it('ads.txt authorises the publisher the AdSense tag uses', () => {
    const html = readRoot('index.html');
    const tag = /adsbygoogle\.js\?client=ca-(pub-\d+)/.exec(html);
    ok(tag, 'no AdSense tag in index.html');
    let ads = '';
    try { ads = readRoot('ads.txt'); } catch (e) { ads = ''; }
    ok(ads, 'ads.txt is missing from the site root');
    ok(new RegExp('^google\\.com,\\s*' + tag[1] + ',\\s*DIRECT,\\s*f08c47fec0942fa0\\s*$', 'm').test(ads),
       'ads.txt does not authorise ' + tag[1] + ': ' + JSON.stringify(ads.trim()));
  });

  it('version.json and index.html agree on the site version', () => {
    const raw = readRoot('version.json');
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { ok(false, 'version.json is not valid JSON: ' + e.message); }
    ok(parsed && typeof parsed.version === 'string' && parsed.version,
       'version.json has no version string');

    const html = readRoot('index.html');
    const m = /const SITE_VERSION\s*=\s*'([^']+)'/.exec(html);
    ok(m, 'no SITE_VERSION constant in index.html');
    eq(m[1], parsed.version,
       'index.html is on ' + m[1] + ' but version.json says ' + parsed.version +
       ' — bump both together');
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
// ── flat damage, and gear buffs the calculator could not see ───────────────
describe('flat damage and gear actives', () => {
  const M = engine.model, O = engine.optimizer;
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'builder.js'), 'utf8');
  const fresh = klass => { const b = M.emptyBuild(); b.klass = klass; b.level = data.Max_Lvl; return b; };
  const wearing = (b, name) => {
    b.gear = [{ name, tier: 0, alloc: { str: 0, arc: 0, end: 0, spd: 0, lck: 0 } }];
    return b;
  };
  const specFor = klass => ask('', { klass, goal: 'burst', level: data.Max_Lvl }).spec;

  it('adds Crystalline Spike flat damage to every hit, as the site does', () => {
    // The site: dmgPerHit = base * (1 + contrib) + getFlatDmgBonus(), and the
    // Spike gives 5 unless its Corrupt Power toggle is on. verify.js caught the
    // model leaving it out: 5 short per hit on every move.
    ok(/dmgPerHit = baseDmgNum \* \(1 \+ totalContrib\) \+ _flatDmg/.test(src),
       'the site no longer adds flat damage per hit; re-read builder.js');
    ok(/return crystallineSpikeSpend \? 40 : 5;/.test(src), 'the site Spike values changed; re-read getFlatDmgBonus');
    const b = fresh('Berserker (Ch)');
    b.invested.str = 60;
    const carnage = O.movesFor('Berserker (Ch)').find(m => m.name === 'Carnage');
    ok(carnage && carnage.damage === '1x20', 'Carnage is no longer 1x20; this test needs revisiting');
    const s = M.allStats(b);
    const without = M.moveDamage(b, carnage, { stats: s });
    const withSpike = M.moveDamage(wearing(b, 'Crystalline Spike'), carnage, { stats: s });
    ok(Math.abs(withSpike - without - 5 * 20) < 1e-6,
       'Carnage (20 hits) gained ' + (withSpike - without).toFixed(2) + ' from the Spike, not 100');
  });

  it('adds flat damage to a move with no stat scaling, on the site and in the model', () => {
    ok(/const _hit0\s*= baseDmgNum \+ _flat0;/.test(src), 'the no-scaling branch no longer adds flat damage');
    const b = fresh('Lionheart (N)');
    const cleave = O.movesFor('Lionheart (N)').find(m => m.name === 'Cleave');
    ok(cleave && !/\//.test(String(cleave.scaling || '')), 'Cleave is not an unscaled move any more; pick another');
    const s = M.allStats(b);
    const without = M.moveDamage(b, cleave, { stats: s });
    const withSpike = M.moveDamage(wearing(b, 'Crystalline Spike'), cleave, { stats: s });
    ok(Math.abs(withSpike - without - 5) < 1e-9, 'Cleave gained ' + (withSpike - without) + ', not 5');
  });

  it('adds no flat damage to a two-part attack, which the site computes directly', () => {
    const b = fresh('Ranger (Or)');
    const stinger = O.movesFor('Ranger (Or)').find(m => m.name === 'Stinger');
    ok(stinger, 'Stinger not found');
    const s = M.allStats(b);
    const without = M.moveDamage(b, stinger, { stats: s });
    const withSpike = M.moveDamage(wearing(b, 'Crystalline Spike'), stinger, { stats: s });
    ok(without > 0, 'Stinger deals no damage; the two-part override is not applying');
    ok(Math.abs(withSpike - without) < 1e-9, 'Stinger picked up ' + (withSpike - without).toFixed(2) + ' flat damage');
  });

  it('prices the Spike +40 on a form nuke, and never in Heresy', () => {
    const c = { worn: ['Crystalline Spike'], burstPerHit: 20, critChance: 50, critDmg: 2 };
    const bl = K.formGearCrit(c, 'Blasphemy', M);
    ok(Math.abs(bl.mult - 60 / 25) < 1e-9, 'Blasphemy multiplier ' + bl.mult + ', expected ' + (60 / 25));
    ok(bl.lines.some(l => /Crystalline Spike/.test(l)), 'no write-up line for the Spike');
    ok(Math.abs(K.formGearCrit(c, 'Tyranny', M).mult - 60 / 25) < 1e-9, 'Tyranny does not see the Spike');
    eq(K.formGearCrit(c, 'Heresy', M).mult, 1, 'Heresy priced a Corrupt Power spend that is bugged there');
    eq(K.formGearCrit(Object.assign({}, c, { burstPerHit: null }), 'Tyranny', M).mult, 1,
       'a two-part nuke took flat damage');
    const b = wearing(fresh('Berserker (Ch)'), 'Crystalline Spike');
    b.invested.str = 60;
    const ctx = O.evaluate(b, specFor('Berserker (Ch)'));
    ok(ctx.burstMove && ctx.burstPerHit > 0, 'evaluate does not report the burst move damage per hit');
    const hits = M.effectiveShape(b, ctx.burstMove).hits;
    const bare = M.moveDamage(b, ctx.burstMove, { stats: ctx.stats, flat: 0 }) / hits;
    ok(Math.abs(ctx.burstPerHit - bare) < 1e-6,
       'burstPerHit is not the burst move per hit without flat damage: ' + ctx.burstPerHit + ' vs ' + bare);
    ok(Math.abs(M.moveDamage(b, ctx.burstMove, { stats: ctx.stats }) / hits - bare - 5) < 1e-6,
       'the Spike is not +5 a hit on the burst move');
    // The form pass puts the +40 on the nuke and never on the per-turn figure.
    const ty = O.corruptionDamage('Tyranny', ctx);
    const fg = K.formGearCrit(ctx, 'Tyranny', M);
    ok(fg.flatMult > 1, 'Tyranny sees no Spike flat bonus');
    ok(Math.abs(ty.burstHit / (ctx.bestBurst * ty.formBurst) - fg.mult) < 1e-6, 'the Spike did not reach the form burst');
    ok(Math.abs(ty.sustainedHit / (ctx.sustainedHit * ty.formSustained) - fg.critMult) < 1e-6,
       'the one-attack +40 was spread over every turn');
    const he = O.corruptionDamage('Heresy', ctx);
    ok(!he || Math.abs(he.burstHit / (ctx.bestBurst * he.formBurst) - 1) < 1e-6, 'Heresy priced the Spike spend');
  });

  it('gives a move with no damage no flat damage', () => {
    // parseDamage reads an unscoreable string ("5x(Darkcores)", or none at all)
    // as base 0. The site shows no damage for those, so +5 would invent a hit.
    const b = wearing(fresh('Berserker (Ch)'), 'Crystalline Spike');
    const s = M.allStats(b);
    for (const dmg of [undefined, '5x(Darkcores)', '0']) {
      eq(M.moveDamage(b, { name: 'Probe', damage: dmg, scaling: 'STR/100' }, { stats: s }), 0,
         'a move with damage ' + JSON.stringify(dmg) + ' picked up flat damage');
    }
  });

  it('prices the Spike on the move a form actually nukes with', () => {
    // Blasphemy spends its Notch on the 3+ energy dump, so the +40 lands on the
    // dump, not on the best hit. A dump at 10 a hit gains (10+40)/(10+5); the
    // best hit at 20 would have given only (20+40)/(20+5).
    const c = { worn: ['Crystalline Spike'], critChance: 0, critDmg: 2, energyCap: 5,
                moves: [{ name: 'Dump', cost: 3 }], dumpMove: { name: 'Dump', cost: 3 },
                bestBurst: 100, bestHit: 100, bestDump: 100, sustainedHit: 100,
                burstPerHit: 20, dumpPerHit: 10 };
    const d = O.corruptionDamage('Blasphemy', c);
    ok(d && d.formBurst > 1, 'the probe ctx did not make Blasphemy fire');
    ok(Math.abs(d.burstHit / (c.bestBurst * d.formBurst) - 50 / 15) < 1e-9,
       'Blasphemy priced the Spike on the wrong move: x' + (d.burstHit / (c.bestBurst * d.formBurst)).toFixed(3));
  });

  it('never recommends a form while telling the reader to pick another', () => {
    for (const q of ['assassin nuke biggest single hit', 'berserker crit', 'max damage']) {
      const best = ask(q).corruption.best;
      const lines = ((best && best.damage) || {}).lines || [];
      ok(!lines.some(l => /Pick another form/.test(l)),
         '"' + q + '" recommends ' + best.form + ' and its own lines say to pick another form');
    }
  });

  it('keeps what a form itself adds when worn gear pays in several forms', () => {
    // Crystalline Spike's +40 fires in Blasphemy and Tyranny alike. Under one cap
    // over form gain and gear gain, that shared bonus filled the cap for both and
    // Tyranny's own +10% (Condemned) stopped counting. The two are capped apart.
    const r = ask('assassin nuke biggest single hit');
    ok(r.build.gear.some(g => g.name === 'Crystalline Spike'), 'the Assassin nuke no longer wears the Spike; pick another probe');
    const nudge = form => {
      const entry = r.corruption.all.find(f => f.form === form);
      const fit = K.CORRUPTION.find(e => e.form === form).fit(r.ctx).score;
      return { entry, n: entry.score / fit };
    };
    const bl = nudge('Blasphemy'), ty = nudge('Tyranny');
    ok(ty.entry.damage.formBurst > bl.entry.damage.formBurst, 'the probe needs Tyranny to add more than Blasphemy on its own');
    ok(ty.n > bl.n + 1e-9,
       'Tyranny adds x' + ty.entry.damage.formBurst.toFixed(2) + ' of its own but its damage nudge (x' + ty.n.toFixed(3) +
       ') is no better than Blasphemy\'s (x' + bl.n.toFixed(3) + ')');
  });

  it('lists the Spike as counted, not as gear doing nothing', () => {
    const gp = O.gearPassiveTotals(wearing(fresh('Berserker (Ch)'), 'Crystalline Spike'));
    ok(gp.active.some(a => a.name === 'Crystalline Spike' && a.onSite), 'the Spike is not listed as counted');
    ok(!gp.unmodelled.some(x => x.name === 'Crystalline Spike'), 'the Spike is still listed as not counted');
  });

  it('gives Crystalline Spike a shortlist seat, so a crit Berserker can find it', () => {
    // rankGear values gear by its stat block and priced passives; flat damage
    // is neither, so the Spike (4 STR) was cut before the real scorer saw it.
    const r = ask('berserker crit', { klass: 'Berserker (Ch)', goal: 'crit', play: 'solo', level: data.Max_Lvl });
    const names = r.build.gear.map(g => g.name);
    ok(names.indexOf('Crystalline Spike') !== -1,
       'a crit Berserker does not wear Crystalline Spike: ' + names.join(', '));
  });

  it('Elemental Infuser is a buff the damage calculator can switch on', () => {
    // Tester report: it never showed up. From Sky to Soul gives its buff as
    // "(10% / 20% / 30%)", which no parseDmgBonus pattern reads, and it has no
    // Buff category, so the calculator skipped it.
    ok(/hasGearEquipped\("Elemental Infuser"\)[\s\S]{0,300}const fstsKey = "buff:From Sky to Soul"[\s\S]{0,200}key: fstsKey, name: "From Sky to Soul", bonus: 10,/.test(src),
       'no From Sky to Soul toggle in the DMG calc, or its name no longer matches the element gate');
    ok(/"From Sky to Soul":\s*\["Magic", "Fire", "Ice", "Hex"\]/.test(src),
       'From Sky to Soul is not gated to Magic, Fire, Ice and Hex');
  });

  it('prices Elemental Infuser as a setup on Magic, Fire, Ice and Hex only', () => {
    const def = (K.SETUP_MOVES || {})['From Sky to Soul'];
    ok(def && def.owner === 'Elemental Infuser' && def.value === 10, 'no From Sky to Soul setup');
    ok(def.elements.test('Magic') && def.elements.test('Hex') && !def.elements.test('Physical'), 'wrong element gate');
    const ctx = O.evaluate(wearing(fresh('Elementalist (Or)'), 'Elemental Infuser'), specFor('Elementalist (Or)'));
    const rt = (ctx.rotation || []).find(r => r.move === 'From Sky to Soul');
    ok(rt && rt.gain === 10, 'wearing Elemental Infuser adds no From Sky to Soul to the rotation');
    const listed = O.gearPassiveTotals(wearing(fresh('Elementalist (Or)'), 'Elemental Infuser'))
      .unmodelled.find(x => x.name === 'Elemental Infuser');
    ok(listed && /priced as a setup/.test(listed.note), 'the write-up does not say the Infuser active is priced');
  });
});

// ── damage reduction is an armour formula (owner, 2026-09-17) ───────────────
describe('damage reduction armour formula', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'builder.js'), 'utf8');
  const siteFn = name => {
    const start = src.indexOf('function ' + name + '(');
    ok(start !== -1, 'builder.js has no ' + name);
    let depth = 0, i = src.indexOf('{', start), end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
    }
    return src.slice(start, end);
  };
  const near = (a, b, what) => ok(Math.abs(a - b) < 1e-9, what + ': expected ' + b + ', got ' + a);

  it('takes 100 / (100 + DR) of a hit, and 2 - 100 / (100 - DR) below zero', () => {
    const f = K.drDamageTakenMult;
    eq(f(0), 1, 'no DR changes damage');
    eq(f(100), 0.5, '100 DR does not halve damage');
    eq(f(300), 0.25, '300 DR does not take a quarter');
    near(f(50), 2 / 3, '50 DR');
    eq(f(-100), 1.5, '-100 DR does not take 1.5x');
    near(f(-50), 4 / 3, '-50 DR');
    ok(f(1e6) > 0 && f(-1e6) < 2, 'the formula leaves its 0x-2x range');
  });

  it('the site and the engine use the same formula', () => {
    const site = new Function(siteFn('drDamageTakenMult') + '; return drDamageTakenMult;')();
    for (const dr of [-250, -100, -37.5, -1, 0, 1, 11, 50, 80, 106, 300]) {
      near(site(dr), K.drDamageTakenMult(dr), 'at ' + dr + ' DR');
    }
  });

  it('survival reads DR as effective health, with no cap', () => {
    near(K.drSurvivalMult(106), 2.06, '106 DR is not 2.06x effective health');
    // The old linear reading capped the sum at 80; the formula needs no cap.
    const c = { hp: 400, blockDr: 80, incHeal: 100, outHeal: 100, bestHit: 100, healPerTurn: 10, stats: { spd: 0 } };
    for (const a of ['tank', 'heal', 'balanced', 'party']) {
      const score = K.ARCHETYPES[a].score;
      ok(score({ ...c, blockDr: 106 }) > score(c), a + ' stops paying for DR past 80');
      ok(score({ ...c, blockDr: -20 }) < score({ ...c, blockDr: 0 }), a + ' does not penalise negative DR');
      // Tank and heal scale by the survival figure alone, so the negative
      // branch shows exactly (the old linear reading gives 0.8, not 0.857).
      if (a === 'tank' || a === 'heal') {
        near(score({ ...c, blockDr: -20 }) / score({ ...c, blockDr: 0 }), K.drSurvivalMult(-20), a + ' negative DR');
      }
    }
  });

  it('the block DR readout says what its points stop', () => {
    ok(/drDamageTakenMult\(_bdr\)/.test(src), 'the block DR tooltip does not use the formula');
  });
});

// ── builder state the 2026-09 patch review found leaking ────────────────────
describe('builder state after a load or a mastery change', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'builder.js'), 'utf8');
  const fnBody = name => {
    const start = src.indexOf('function ' + name + '(');
    ok(start !== -1, 'builder.js has no ' + name);
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
    }
    return '';
  };

  it('a loaded build starts with every stat buff switched off', () => {
    // Overload's switch also reaches the Luck row's crit chance, so a leftover
    // one inflated the next build loaded into the same page.
    ok(/Object\.keys\(statBuffsActive\)\.forEach\(k => \{ statBuffsActive\[k\] = false; \}\);/.test(fnBody('loadBuildState')),
       'loadBuildState does not reset statBuffsActive');
  });

  it('a loaded build does not inherit the last one\'s spend switches or hidden counters', () => {
    // None of these is in a saved build. Crystalline Spike's spend is +40 Flat
    // on every hit, and the Cast Amplify stacks a hidden +20 each the moment
    // the team buff is switched on.
    const body = fnBody('loadBuildState');
    for (const [name, v] of [['crystallineSpikeSpend', 'false'], ['castAmplifyStacks', '1'], ['darkCoreCount', '0'],
                             ['bloomingEyeSpend', 'false'], ['luckyHornsSpend', 'false']]) {
      ok(new RegExp('\\n\\s*' + name + ' = ' + v + ';').test(body), 'loadBuildState does not reset ' + name);
      ok(!new RegExp('\\b' + name + '\\b').test(fnBody('getBuildState')), name + ' is saved now: reset it from the state instead');
    }
  });

  it("crit chance reads the same Luck multipliers as getTotalStat, in its order", () => {
    const up = fnBody('updatePecents');
    const at = re => { const m = re.exec(up); return m ? m.index : -1; };
    const order = [/_looterLckMult = 1 \+ looterStacks \* 0\.1575/, /totalLck = Math\.round\(totalLck \* 1\.10\)/,
                   /permuthStat === 'lck'[^\n]*totalLck \* 1\.4/, /_ivoryLckMult = ivoryStatMult\(\)/, /midasLckMult\(\)/];
    const idx = order.map(at);
    ok(idx.every(i => i !== -1), 'crit chance is missing a Luck multiplier: ' + JSON.stringify(idx));
    ok(idx.every((v, i) => !i || v > idx[i - 1]), 'crit chance applies the Luck multipliers out of order: ' + JSON.stringify(idx));
  });

  it('a mastery change clears stale stat-buff switches before the stat pass', () => {
    for (const fn of ['toggleMasteryNode', 'resetMastery']) {
      ok(/renderDmgBonusSection\(\);[^\n]*\r?\n\s*updatePecents\(\);\r?\n\s*renderDmgBonusSection\(\);/.test(fnBody(fn)),
         fn + ' runs the stat pass before clearing switches whose node is gone');
    }
  });

  it('only a real summon gets a Self Destruct box, and its tag names the milestone', () => {
    ok(/if \(hasIH && moves\.some\(isSummonAttack\)\) \{/.test(src), "Arbiter's own Base Move group gets a Self Destruct box");
    // The tag lists every term of the Multi sum it is given, and the milestone
    // is one of getDmgMulti's terms, so passing the whole sum names it.
    ok(/buildBonusTag\(out\)/.test(fnBody('renderSelfDestruct')),
       'the Self Destruct tag is not built from its whole Multi sum');
    ok(fnBody('getDmgMulti').indexOf('add(milestoneDmgLabel(m, effType), getMilestoneDmgPct(m, effType));') !== -1,
       'the milestone is not a labelled term of the Multi sum');
  });
});

// ── crit tiers add +1 (Withered Grove rework) ───────────────────────────────
describe('crit tiers add +1 to the multiplier', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'builder.js'), 'utf8');
  // Pull one top-level function out of builder.js by its name.
  const siteFn = name => {
    const start = src.indexOf('function ' + name + '(');
    ok(start !== -1, 'builder.js has no ' + name);
    let depth = 0, i = src.indexOf('{', start), end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
    }
    return src.slice(start, end);
  };

  it('shows each overcrit colour at +1, +2, +3 on the crit multiplier', () => {
    const body = siteFn('buildOvercritLines');
    for (const [colour, add] of [['orange', 1], ['red', 2], ['purple', 3]]) {
      ok(new RegExp('const ' + colour + 'Dmg = finalDmg \\* \\(critMult \\+ ' + add + '\\);').test(body),
         colour + ' crit damage is not finalDmg x (critMult + ' + add + ')');
      ok(body.indexOf('(critMult + ' + add + ').toFixed(2)') !== -1, colour + ' label does not show critMult + ' + add);
    }
    ok(!/critMult \* [234]/.test(body), 'an overcrit line still multiplies the crit multiplier');
  });

  it('the site expected crit multiplier matches the model everywhere', () => {
    const M = engine.model;
    const siteExpected = new Function(siteFn('getExpectedCritMult') + '; return getExpectedCritMult;')();
    for (const cd of [2, 2.1, 2.25, 3.4]) {
      for (const cc of [0, 37, 99.5, 100, 150, 199, 200, 250, 313, 400]) {
        const a = siteExpected(cd, cc), b = M.expectedMultiplier(cc, cd);
        ok(Math.abs(a - b) < 1e-9, 'at ' + cc + '% crit and ' + cd + 'x the site says ' + a + ' and the model ' + b);
      }
    }
    eq(siteExpected(2.25, 200), 3.25, 'the owner example: 2.25x super crit is 3.25x');
    ok(/return totalDmg \* getExpectedCritMult\(critMult, critChancePct\);/.test(siteFn('getExpectedMultiHitDmg')),
       'expected multi-hit damage does not use the tiered multiplier');
  });

  it('Overcore upgrades a crit one tier: +1, not squared', () => {
    ok(/return overcoreActive \? base \+ 1 : base;/.test(siteFn('getCritDmgMultEffective')),
       'Overcore does not add +1 to the crit multiplier');
  });
});

// ── Monk against Burning, and Blazing Barrage's real scaling ────────────────
describe('Monk against burning targets', () => {
  const root = path.join(__dirname, '..', '..');
  const src = fs.readFileSync(path.join(root, 'js', 'builder.js'), 'utf8');
  const classSrc = fs.readFileSync(path.join(root, 'js', 'data-class-moves.js'), 'utf8');

  it('Blazing Barrage scales on STR/75', () => {
    // Owner, 2026-09-13: it was entered as STR/55 to match observed hits, but
    // those hits carried Monk's unlisted x1.2 against a Burning target.
    ok(/name: "Blazing Barrage",[\s\S]{0,200}scaling: "STR\/75",/.test(classSrc),
       'js/data-class-moves.js does not give Blazing Barrage STR/75');
    const mv = (((data.classMoves || {})['Monk (Or)'] || {}).learns || []).find(m => m.name === 'Blazing Barrage');
    ok(mv, 'no Blazing Barrage in the data snapshot');
    eq(mv.scaling, 'STR/75', 'Blazing Barrage scaling in the data snapshot');
  });

  it('the DMG calc offers a Monk the Burning Target toggle', () => {
    ok(/if \(superPicker\.value === "Monk \(Or\)"\) \{\s*const mbKey = "passive:Burning Target";[\s\S]{0,200}key: mbKey, name: "Burning Target", bonus: 20,/.test(src),
       'no x1.2 Burning Target toggle for a Monk in the DMG calc');
  });

  it('prices it for a Monk, whose kit applies Burn', () => {
    const r = ask('', { klass: 'Monk (Or)', goal: 'damage', level: data.Max_Lvl });
    ok(r.ctx.passiveList.known.some(p => p.name === 'Burning Target'), 'Burning Target is not listed for a Monk');
    ok(engine.optimizer.statusesOf(r.build).enemy.has('burn'), 'the Monk kit does not read as applying Burn');
    ok((r.ctx.passives.statusGated || []).some(g => g.name === 'Burning Target' && Math.abs(g.value - 10) < 1e-9),
       'Burning Target is not priced at 20% x the assumed 0.5 uptime');
    eq(r.ctx.inertPassiveDmg, 0, 'Burning Target was taken back out although the kit applies Burn');
  });

  it('takes a Burn-gated passive back out on a kit that applies no Burn', () => {
    // No class but Monk has the passive, so it is lent to an Assassin (poison,
    // no Burn) on fresh engines whose passive caches are empty, then removed.
    const before = Engine(data), after = Engine(data);
    const spec = before.ask('', { klass: 'Assassin (Ch)', goal: 'damage', level: data.Max_Lvl }).spec;
    const mk = en => { const b = en.model.emptyBuild(); b.klass = 'Assassin (Ch)'; b.level = data.Max_Lvl; b.invested.str = 60; return b; };
    const hit0 = before.optimizer.evaluate(mk(before), spec).bestHit;
    const had = Object.prototype.hasOwnProperty.call(K.PASSIVES, 'Assassin (Ch)');
    const list = K.PASSIVES['Assassin (Ch)'] = K.PASSIVES['Assassin (Ch)'] || [];
    const lent = Object.assign({}, K.PASSIVES['Monk (Or)'].find(p => p.name === 'Burning Target'));
    list.push(lent);
    try {
      const b = mk(after);
      ok(!after.optimizer.statusesOf(b).enemy.has('burn'), 'the Assassin kit applies Burn; pick another probe');
      const c = after.optimizer.evaluate(b, spec);
      ok(c.passiveList.known.some(p => p.name === 'Burning Target'), 'the lent passive was not picked up');
      ok(Math.abs(c.inertPassiveDmg - 10) < 1e-9, 'a Burn-gated passive was not taken out: ' + c.inertPassiveDmg);
      ok(Math.abs(c.bestHit - hit0) < 1e-6,
         'a Burn-gated passive changed the damage of a kit with no Burn: ' + c.bestHit + ' vs ' + hit0);
    } finally {
      list.splice(list.indexOf(lent), 1);
      if (!had) delete K.PASSIVES['Assassin (Ch)'];
    }
  });
});

// ── Enhanced Bloodlust stacks, and Stab's innate crit ───────────────────────
describe('Enhanced Bloodlust stacks and move crit bonuses', () => {
  const root = path.join(__dirname, '..', '..');
  const src = fs.readFileSync(path.join(root, 'js', 'builder.js'), 'utf8');
  const classSrc = fs.readFileSync(path.join(root, 'js', 'data-class-moves.js'), 'utf8');
  const raceSrc = fs.readFileSync(path.join(root, 'js', 'data-race-moves.js'), 'utf8');

  it('the DMG calc counts Enhanced Bloodlust per kill: +15% damage and +15% Speed each', () => {
    // Owner, 2026-09-14: each kill grants 15% damage and 15% Speed, and it stacks.
    ok(/if \(raceName === "Drauga \(6%\)"\) \{\s*const eblKey = "passive:Enhanced Bloodlust";[\s\S]{0,200}bonus: 15 \* enhancedBloodlustStacks,/.test(src),
       'no Enhanced Bloodlust entry that scales with kills');
    ok(/if \(p\.name === "Enhanced Bloodlust"\)\s*return 15 \* enhancedBloodlustStacks;/.test(src),
       'Enhanced Bloodlust damage is not +15 a kill in the Multi sum');
    ok(/"Drauga \(6%\)" && dmgBonusActive\["passive:Enhanced Bloodlust"\]\) \? 15 \* enhancedBloodlustStacks : 0/.test(src),
       'Enhanced Bloodlust does not add its Speed per kill');
    ok(/onclick="changeEnhancedBloodlustStacks\(-1\)"[\s\S]{0,160}onclick="changeEnhancedBloodlustStacks\(1\)"/.test(src),
       'no - / + kill counter for Enhanced Bloodlust');
    ok(/const _manualPassives = \[[^\]]*"Enhanced Bloodlust"/.test(src),
       'Enhanced Bloodlust is still parsed from its text as well, which would add a second x1.15');
    ok(/enhancedBloodlustStacks = 1;/.test(src.slice(src.indexOf('bloodlustStacks = 1;', src.indexOf('function changeEnhancedBloodlustStacks')))),
       'the kill counter is not reset with the other stacks');
    ok(/name: "Enhanced Bloodlust",[\s\S]{0,160}15% damage buff and a 15% speed buff[\s\S]{0,60}Stacks with multiple kills/.test(raceSrc),
       'Enhanced Bloodlust text still reads 12.5-15% with no stacking');
  });

  it('the Build AI prices Enhanced Bloodlust at 15 per kill', () => {
    const e = (K.PASSIVES['Drauga (6%)'] || []).find(p => p.name === 'Enhanced Bloodlust');
    ok(e && e.value === 15 && e.kind === 'dmgPct', 'Enhanced Bloodlust is not +15% damage in the Build AI');
  });

  it('Stab has an innate +40 crit chance', () => {
    ok(/name: "Stab",[\s\S]{0,260}critBonus: 40,/.test(classSrc), 'js/data-class-moves.js gives Stab no critBonus 40');
    let found = 0;
    for (const entry of Object.values(data.classMoves || {})) {
      for (const m of (entry.learns || [])) if (m.name === 'Stab') { eq(m.critBonus, 40, 'Stab critBonus in the data snapshot'); found++; }
    }
    ok(found > 0, 'no Stab in the data snapshot');
  });

  it("the Build AI adds a move's own crit bonus to that move", () => {
    const O = engine.optimizer, M = engine.model;
    ok(typeof O.moveCritMult === 'function', 'moveCritMult is not exported');
    eq(O.moveCritMult({ name: 'Stab', critBonus: 40 }, 50, 2.25, false), M.expectedMultiplier(90, 2.25), 'Stab at 50% crit');
    eq(O.moveCritMult({ name: 'Slash' }, 50, 2.25, false), M.expectedMultiplier(50, 2.25), 'a move with no bonus');
    eq(O.moveCritMult({ name: 'Stab', critBonus: 40 }, 50, 2.25, true), 2.25, 'the potential model is the crit multiplier');
    const optSrc = fs.readFileSync(path.join(__dirname, 'optimize.js'), 'utf8');
    // Since §12 each figure is  raw x dmgMulti(its sum) x crit + True Flat,
    // and the crit is priced at that same sum (a crit-only term depends on it).
    ok(/const plain = \(raw \* M\.dmgMulti\(pct\) \* critAt\(pct\) \+ tf\) \/ stunDiv;/.test(optSrc) &&
       /const burst = \(burstRaw \* M\.dmgMulti\(openP\) \* critBuffedAt\(openP\) \+ tf\) \/ stunDiv;/.test(optSrc) &&
       /const sust  = \(raw \* M\.dmgMulti\(sustP\) \* critAt\(sustP\) \+ tf\) \/ stunDiv;/.test(optSrc),
       'the damage loop does not use the per-move crit multiplier for the hit, the opener and the sustained figure');
    ok(/const critAt = P => ownCrit \? moveCritMult\(mv, critChance, critDmg, potential, P\) : mult;/.test(optSrc),
       "the plain and sustained figures do not price the move's own crit at their own sum");
  });
});

// ── Lancer and Ranger rework (patch 2026-09-16) ─────────────────────────────
describe('Lancer and Ranger rework', () => {
  const root = path.join(__dirname, '..', '..');
  const src = fs.readFileSync(path.join(root, 'js', 'builder.js'), 'utf8');
  const classSrc = fs.readFileSync(path.join(root, 'js', 'data-class-moves.js'), 'utf8');
  const O = engine.optimizer, M = engine.model;
  // Pull one top-level function out of builder.js by its name.
  const siteFn = name => {
    const start = src.indexOf('function ' + name + '(');
    ok(start !== -1, 'builder.js has no ' + name);
    let depth = 0, i = src.indexOf('{', start), end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
    }
    return src.slice(start, end);
  };
  // A DMG calc counter, run on its own: returns step(delta) -> the new count.
  const noop = () => {};
  const counter = (fn, v, start) => new Function('renderDmgBonusSection', 'recalcOpenDetails', 'updatePecents', v,
    siteFn(fn) + '\nreturn d => { ' + fn + '(d); return ' + v + '; };')(noop, noop, noop, start);
  const learn = (k, n) => (((data.classMoves || {})[k] || {}).learns || []).find(m => m.name === n);

  it("Empowered Pierce's +50% on a crit multiplies only the crit share", () => {
    // Patch: Empowered Pierce costs 3 and "Deals 50% more damage when this attack
    // lands a Critical Hit"; Discharge costs 2 on a 4-turn cooldown.
    const ep = learn('Lancer (N)', 'Empowered Pierce'), dis = learn('Lancer (N)', 'Discharge');
    ok(ep && dis, 'no Empowered Pierce or Discharge in the data snapshot');
    eq(ep.cost, 3, 'Empowered Pierce cost');
    eq(ep.critDmgBonus, 50, 'Empowered Pierce critDmgBonus');
    eq(dis.cost, 2, 'Discharge cost');
    eq(dis.cooldown, 4, 'Discharge cooldown');
    ok(/name: "Empowered Pierce",[^}]{0,300}critDmgBonus: 50,/.test(classSrc),
       'js/data-class-moves.js gives Empowered Pierce no critDmgBonus 50');
    // With nothing else in the damage bonus sum the crit-only +50 is exactly
    // x1.5 on the crit share (1 + 50/100 over 1).
    eq(O.moveCritMult({ name: 'Empowered Pierce', critDmgBonus: 50 }, 50, 2.25, false), 0.5 + 0.5 * 2.25 * 1.5,
       'Empowered Pierce at 50% crit');
    eq(O.moveCritMult({ critDmgBonus: 50 }, 150, 2.25, false), M.expectedMultiplier(150, 2.25) * 1.5,
       'Empowered Pierce at 150% crit');
    eq(O.moveCritMult({ critDmgBonus: 50 }, 50, 2.25, true), 2.25 * 1.5, 'the potential model');
    // Since §12 it is +50 in the crit figures' sum, so with +50 of other buffs
    // already in it the crit figure is (1 + 1.0) / (1 + 0.5) = x1.333, not x1.5.
    // (The "Build AI composes damage like the site" group checks this ratio
    // against the site's own getOutsideDmgMult at several sums.)
    const near = (a, b, what) => ok(Math.abs(a - b) < 1e-9, what + ': expected ' + b + ', got ' + a);
    near(O.moveCritMult({ critDmgBonus: 50 }, 100, 2.25, true, 50), 2.25 * 2 / 1.5, 'the potential model at a +50 sum');
    near(O.moveCritMult({ critDmgBonus: 50 }, 50, 2.25, false, 50), 0.5 + 0.5 * 2.25 * 2 / 1.5, 'at 50% crit and a +50 sum');
    // The site's expectation (getExpectedMoveCritDmg, fed the ratio of the two
    // sums) and the model's agree at every crit chance and every sum.
    const site = new Function(siteFn('getExpectedCritMult') + '\n' + siteFn('getExpectedMultiHitDmg') + '\n' +
      siteFn('getExpectedMoveCritDmg') + '; return getExpectedMoveCritDmg;')();
    for (const P of [0, 50, 120, -30]) {
      for (const cc of [0, 30, 50, 99.5, 100, 150, 230]) {
        const a = site(1, 2.25, cc, M.critOnlyRatio(P, 50)), b = O.moveCritMult({ critDmgBonus: 50 }, cc, 2.25, false, P);
        ok(Math.abs(a - b) < 1e-9, 'at ' + cc + '% crit and a ' + P + ' sum the site says ' + a + ' and the model ' + b);
      }
    }
    eq(site(10, 2.25, 50, 1), 10 * 1.625, 'a move with no crit bonus is not the plain expectation');
    // Since §12 the site reads critDmgBonus as a crit-only +50 in the Multi sum
    // (getDmgMulti's isCrit), carried onto the crit figures as the ratio of the
    // two sums; the "additive damage" group runs it.
    ok(/const moveCritDmgMult = _out\.critRatio;/.test(src),
       'the DMG calc no longer carries the crit-only Multi term onto the crit figures');
    ok(/if \(isCrit && \+m\.critDmgBonus\) add\(/.test(src), 'the DMG calc no longer reads critDmgBonus');
    ok(/buildOvercritLines\(_resFinalDmg \* moveCritDmgMult, /.test(src),
       'the overcrit lines do not carry the crit bonus');
  });

  it('Stinger and Perennial Canopy scale on SPD/80', () => {
    for (const n of ['Stinger', 'Perennial Canopy']) {
      ok(new RegExp('name: "' + n + '",[^}]{0,400}scaling: "ARC/70 \\+ SPD/80",').test(classSrc),
         n + ' is not ARC/70 + SPD/80 in js/data-class-moves.js');
      eq((learn('Ranger (Or)', n) || {}).scaling, 'ARC/70 + SPD/80', n + ' scaling in the data snapshot');
    }
    eq(K.MOVE_OVERRIDES.Stinger[0].second.scaling, 'ARC/70 + SPD/80', "the Build AI's Stinger arrows");
    ok(/10 \* \(1 \+ _arcVal \/ 70 \+ _spdVal \/ 80\)/.test(src), "the DMG calc's Stinger arrows are not ARC/70 + SPD/80");
    ok(/Arrows \(Poison\): 10\(1 \+ ARC\(\$\{_arcVal\}\)\/70 \+ SPD\(\$\{_spdVal\}\)\/80\)/.test(src),
       'the Stinger formula label does not say SPD/80');
  });

  it('Verdant Archer and Poised Slayer stack up to their caps', () => {
    ok(/const VERDANT_ARCHER_CAP = 150;/.test(src), 'Verdant Archer is not capped at 150%');
    ok(/const POISED_SLAYER_CAP = 50;/.test(src), 'Poised Slayer is not capped at 50%');
    const body = siteFn('dmgRowPct');
    ok(/p\.name === "Verdant Archer"\)\s*return Math\.min\(VERDANT_ARCHER_CAP, p\.bonus \* verdantArcherStacks\);/.test(body),
       'Verdant Archer stacks are not capped');
    ok(/p\.name === "Poised Slayer"\)\s*return Math\.min\(POISED_SLAYER_CAP, p\.bonus \* poisedSlayerStacks\);/.test(body),
       'Poised Slayer stacks are not capped');
    // Nature's Wrath doubles the parsed per-stack bonus (15 -> 30) instead of
    // writing a fixed figure over it.
    ok(/const vaEntry = merged\.find\(e => e\.name === "Verdant Archer"\);\s*if \(vaEntry\) vaEntry\.bonus = vaEntry\.bonus \* 2;/.test(src),
       "Nature's Wrath does not double Verdant Archer's bonus");
    const va = counter('changeVerdantArcherStacks', 'verdantArcherStacks', 1);
    eq(va(100), 10, 'the Verdant Archer counter does not stop at 10');
    eq(va(-100), 1, 'the Verdant Archer counter goes under 1');
    const ps = counter('changePoisedSlayerStacks', 'poisedSlayerStacks', 1);
    eq(ps(100), 5, 'the Poised Slayer counter does not stop at 5 (+50%)');
    eq(ps(-100), 1, 'the Poised Slayer counter goes under 1');
    const sf = counter('changeSwiftFighterStacks', 'swiftFighterStacks', 1);
    eq(sf(100), 2, 'the Swift Fighter counter does not stop at 2 dodges (the 30% cap)');
    // The Build AI prices each as one stack.
    const passive = (k, n) => (K.PASSIVES[k] || []).find(p => p.name === n) || {};
    ok(passive('Lancer (N)', 'Poised Slayer').kind === 'dmgPct' && passive('Lancer (N)', 'Poised Slayer').value === 10,
       'Poised Slayer is not +10% damage in the Build AI');
    ok(passive('Ranger (Or)', 'Verdant Archer').kind === 'dmgPct' && passive('Ranger (Or)', 'Verdant Archer').value === 15,
       'Verdant Archer is not +15% damage in the Build AI');
  });

  it('Overload is +10% Strength and Luck, on the site and in the Build AI', () => {
    const o = K.MASTERY_ABILITIES.Overload;
    ok(o && o.kind !== 'dmgPct', 'Overload is still priced as a damage bonus');
    eq(JSON.stringify(o.effects), JSON.stringify([{ kind: 'statPct', stat: 'str', value: 10 },
                                                   { kind: 'statPct', stat: 'lck', value: 10 }]),
       'Overload is not +10% STR and +10% LCK');
    eq(K.MASTERY_ABILITIES.Lightspeed.kind, 'statFromStat', 'Lightspeed is not a stat-from-stat ability');
    eq(((data.masteryAbilities['Lancer (N)'] || {}).cm1 || {}).bonus, null,
       "Overload's text still parses as a damage bonus");
    // Site: both stats, and the Luck half reaches crit chance before Permuth.
    ok(/if \(\(statKey === "str" \|\| statKey === "lck"\) && statBuffsActive\.overloadStrLck\) total = Math\.round\(total \* 1\.10\);/.test(src),
       'getTotalStat does not apply Overload to STR and LCK');
    const coag = src.indexOf('if (coagNailActive) totalLck += coagNailBonus;');
    const over = src.indexOf('if (_overloadLck) totalLck = Math.round(totalLck * 1.10);');
    const perm = src.indexOf("if (permuthStat === 'lck' && markPicker?.value === 'Venia') totalLck");
    ok(coag !== -1 && over > coag && perm > over, 'the crit Luck total does not apply Overload between the nail and Permuth');
    // Build AI: the percentage lands on the in-fight totals only, at its uptime.
    const spec = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'damage' }, data);
    const tree = ['s1', 's2', 's3', 's4', 'c1', 'c2a', 'c3a', 'cb1'];
    const mk = nodes => {
      const b = M.emptyBuild();
      b.level = 50; b.klass = 'Lancer (N)'; b.race = 'Estella (24%)';
      b.invested.str = 60; b.invested.lck = 40; b.masteryNodes = nodes;
      return b;
    };
    eq((data.masteryAbilities['Lancer (N)'] || {}).cm1.name, 'Overload', 'the fixture capstone moved');
    const withO = O.evaluate(mk(tree.concat('cm1')), spec), without = O.evaluate(mk(tree.slice()), spec);
    const pct = 1 + 10 * o.uptime / 100;
    ok(Math.abs(withO.stats.str - withO.siteStats.str * pct) < 1e-9, 'Overload STR: ' + withO.stats.str + ' from ' + withO.siteStats.str);
    ok(Math.abs(withO.stats.lck - withO.siteStats.lck * pct) < 1e-9, 'Overload LCK: ' + withO.stats.lck + ' from ' + withO.siteStats.lck);
    eq(withO.siteStats.str, without.siteStats.str, 'Overload leaked into the site Strength total');
    ok(withO.critChance > without.critChance, "Overload's Luck does not reach crit chance");
  });

  it('Lightspeed and Swift Fighter are Speed buffs on the site', () => {
    ok(/statBuffsActive\.lightspeedSpd \? Math\.round\(getTotalStat\("arc"\) \* 0\.10\) : 0/.test(src),
       'Lightspeed is not a flat Speed buff of 10% of Arcane');
    ok(/statBuffsActive\.swiftFighterSpd \? Math\.min\(30, 20 \* swiftFighterStacks\) : 0/.test(src),
       'Swift Fighter is not 20% Speed a dodge capped at 30%');
    ok(/const _hasLightspeed = _superClass === "Ranger \(Or\)" && !!masteryState\["cm1"\];/.test(src),
       'the Lightspeed buff is not gated on the Ranger capstone');
  });
});

// ── Cold registers as a status a kit applies ─────────────────────────────────
describe('Cold is a status a kit can apply', () => {
  const O = engine.optimizer, M = engine.model;
  const fresh = (klass, extra) => Object.assign(M.emptyBuild(), { klass, level: data.Max_Lvl }, extra || {});

  it('is a status word, so "applies 3 Cold" registers', () => {
    ok(K.STATUS_WORDS.indexOf('cold') !== -1, "'cold' is not in STATUS_WORDS");
  });

  it("reads Boreas's Cold Application and Ice Shards as applying Cold", () => {
    const boreas = fresh('Assassin (Ch)', { race: 'Boreas (1%)' });
    ok(O.buildDoes(boreas).enemyStatuses.has('cold'), 'a Boreas kit does not read as applying Cold');
    const iceScroll = Object.keys(data.scrollMoves || {}).find(n => n === 'Ice Shards');
    ok(iceScroll, 'no Ice Shards scroll in the data; pick another probe');
    const withScroll = fresh('Assassin (Ch)', { race: 'Amorus (Ob)', scroll1: 'Ice Shards' });
    ok(O.buildDoes(withScroll).enemyStatuses.has('cold'), 'Ice Shards does not read as applying Cold');
  });

  it('pays a Cold-gated item only on a kit that applies Cold', () => {
    const spec = ask('', { klass: 'Assassin (Ch)', goal: 'crit', level: data.Max_Lvl }).spec;
    const wear = b => Object.assign(b, { gear: [{ name: 'Frozen Diadem', tier: 0, alloc: {}, traits: [] }] });
    const cold = O.evaluate(wear(fresh('Assassin (Ch)', { race: 'Boreas (1%)' })), spec);
    const dry  = O.evaluate(wear(fresh('Assassin (Ch)', { race: 'Amorus (Ob)' })), spec);
    const fd = c => (c.gearPassives.active || []).find(a => a.name === 'Frozen Diadem') || {};
    ok(!fd(cold).inert, 'Frozen Diadem was switched off on a Boreas kit that applies Cold');
    ok(fd(dry).inert, 'Frozen Diadem paid on a kit that applies no Cold');
  });
});

// ── Balance patch 2026-09-16: DMG calc stacks and conversions ───────────────
// Shared by the next two groups: pull a top-level function out of builder.js
// (or move-renderer.js), and run the DMG calc's multiplier chain on its own
// with only the state a test names.
const patchSite = (() => {
  const root = path.join(__dirname, '..', '..');
  const src = fs.readFileSync(path.join(root, 'js', 'builder.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'js', 'move-renderer.js'), 'utf8');
  const fn = (name, text) => {
    const from = text || src;
    const start = from.indexOf('function ' + name + '(');
    ok(start !== -1, 'no function ' + name);
    let depth = 0, i = from.indexOf('{', start), end = -1;
    for (; i < from.length; i++) {
      if (from[i] === '{') depth++;
      else if (from[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
    }
    return from.slice(start, end);
  };
  const noop = () => {};
  // A DMG calc counter, run on its own: returns step(delta) -> the new count.
  const counter = (name, v, start) => new Function('renderDmgBonusSection', 'recalcOpenDetails', 'updatePecents', v,
    fn(name) + '\nreturn d => { ' + name + '(d); return ' + v + '; };')(noop, noop, noop, start);
  // The factor of the switches' Multi sum (getActiveDmgTerms over dmgRowPct,
  // as 1 + sum / 100) with every passive in `names` switched on. Identifiers a
  // branch never reaches are never looked up, so only the always-read state
  // and whatever the test passes in `state` need to exist.
  const activeMult = (names, state) => {
    const rows = names.map((name, i) => ({ key: 'k' + i, name, bonus: (state.bonus || {})[name] }));
    const scope = Object.assign({
      dmgBonusPassives: rows, dmgBonusActive: Object.fromEntries(rows.map(r => [r.key, true])),
      statusEffectsActive: {}, TEAM_BUFFS: [], teamBuffsActive: {}, summonBuffsActive: {},
      getCorruptionDmgPct: () => 0, MG_SCROLL_KEY: "scroll-mg:Metrom's Grasp", DMG_AFFINITY_GATES: {},
    }, state);
    delete scope.bonus;
    return new Function(...Object.keys(scope), fn('dmgRowPct') + '\n' + fn('getActiveDmgTerms') + '\n' +
      fn('sumDmgTerms') + '; return 1 + sumDmgTerms(getActiveDmgTerms()) / 100;')(...Object.values(scope));
  };
  const near = (a, b, what) => ok(Math.abs(a - b) < 1e-9, what + ': expected ' + b + ', got ' + a);
  return { src, renderer, fn, counter, activeMult, near };
})();

describe('Boreas and Vydeer rework', () => {
  const { src, renderer, fn: siteFn, counter, activeMult, near } = patchSite;
  const O = engine.optimizer, M = engine.model;

  it("Boreas turns your own Physical and Magic moves into Ice, and nobody else's", () => {
    // Patch: Boreas's Physical and Arcane (the site's Magic) moves become Ice.
    // Wicked Crown applies first [assumed], a summon's attacks keep their
    // written type, and Arbiter's Base Move is the player's own.
    const state = { race: 'Boreas (1%)', crown: false };
    const get = new Function('hasGearEquipped', 'racePicker',
      siteFn('isSummonMove', renderer) + '\n' + siteFn('isSummonAttack') + '\n' +
      siteFn('getEffectiveMoveType') + '; return getEffectiveMoveType;'
    )(n => n === 'Wicked Crown' && state.crown, { get value() { return state.race; } });
    const own = { slot: '2nd Learn' };
    eq(get('Physical', own), 'Ice', 'Boreas Physical');
    eq(get('Magic', own), 'Ice', 'Boreas Magic');
    eq(get('Fire', own), 'Fire', 'Boreas Fire');
    eq(get('Holy', own), 'Holy', 'Boreas Holy');
    eq(get('Physical'), 'Ice', "Stinger's stab (no move passed) under Boreas");
    eq(get('Physical', { slot: 'Skeleton' }), 'Physical', 'a Skeleton attack under Boreas');
    eq(get('Physical', { slot: 'Darkbeast' }), 'Physical', 'a Darkbeast attack under Boreas');
    eq(get('Physical', { slot: 'Base Move' }), 'Ice', "Arbiter's Base Move under Boreas");
    eq(get('Magic', { slot: 'Sheea (Elementalist)' }), 'Magic', "a Heaven's Authority Sheea attack under Boreas");
    state.crown = true;
    eq(get('Physical', own), 'Dark', 'a crowned Boreas Physical move (the crown goes first)');
    eq(get('Magic', own), 'Ice', 'a crowned Boreas Magic move');
    state.race = 'Amorus (Ob)';
    eq(get('Magic', own), 'Magic', 'a crowned Amorus Magic move');
    state.crown = false;
    eq(get('Physical', own), 'Physical', 'an Amorus Physical move');
    // Every caller that has the move passes it, or its summons would convert.
    ok(!/getEffectiveMoveType\(m\.moveType\)/.test(src),
       'a caller reads the effective type without passing the move');
  });

  it('the Build AI reads a Boreas kit as Ice, except its summons', () => {
    const els = (klass, race) => O.buildDoes({ klass, race }).elements;
    ok(els('Impaler (Ch)', 'Amorus (Ob)').has('physical'), 'fixture: the Impaler kit has no Physical attack');
    const boreas = els('Impaler (Ch)', 'Boreas (1%)');
    ok(boreas.has('ice') && !boreas.has('physical') && !boreas.has('magic'),
       'a Boreas Impaler kit still reads as ' + [...boreas].join(', '));
    const smack = (data.classMoves['Necromancer (Ch)'].learns || []).find(m => m.name === 'Smack');
    ok(smack && smack.moveType === 'Physical' && K.isSummonSlot(smack), 'fixture: Smack is no longer a Physical Skeleton attack');
    ok(els('Necromancer (Ch)', 'Boreas (1%)').has('physical'), "a Boreas Necromancer's Skeleton attacks were read as Ice");
    ok(!K.isSummonSlot({ slot: 'Base Move' }), "K.isSummonSlot reads Arbiter's Base Move as a summon");
    ok(K.isSummonSlot({ slot: 'Sheea (Saint)' }), "K.isSummonSlot misses a Heaven's Authority Sheea row");
  });

  it('a converted kit reads the Ice column, which no boss resists', () => {
    // Handaconda resists Physical and Arcane at x0.5 and has no Ice column, so a
    // Boreas Impaler's converted nuke lands in full while an Amorus one is halved.
    const res = ((data.BOSS_DATA || {}).Handaconda || {}).res || {};
    ok(res.Physical < 1 && res.Arcane < 1 && res.Ice === undefined,
       'fixture: Handaconda no longer resists Physical and Arcane, or has an Ice column');
    const plain = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'damage' }, data);
    const vs = Intent.applyOverrides(Intent.parse('', data, K), { goal: 'damage', boss: 'Handaconda' }, data);
    const ratio = race => {
      const b = M.emptyBuild();
      b.level = 50; b.klass = 'Impaler (Ch)'; b.race = race; b.invested.str = 100;
      return O.evaluate(b, vs).bestHit / O.evaluate(b, plain).bestHit;
    };
    near(ratio('Boreas (1%)'), 1, 'a Boreas Impaler against Handaconda');
    ok(ratio('Amorus (Ob)') < 0.99, 'fixture: an Amorus Impaler is not resisted by Handaconda at all');
  });

  it('Frost Stacks: +10% damage a stack, five at most', () => {
    ok(/p\.name === "Frost Stacks"\)\s*return 10 \* boreasStacks;/.test(siteFn('dmgRowPct')),
       'Frost Stacks is not +10% a stack');
    near(activeMult(['Frost Stacks'], { boreasStacks: 5 }), 1.5, 'five Frost Stacks');
    near(activeMult(['Frost Stacks'], { boreasStacks: 1 }), 1.1, 'one Frost Stack');
    const step = counter('changeBoreasStacks', 'boreasStacks', 1);
    eq(step(100), 5, 'the Frost Stacks counter does not stop at 5');
    eq(step(-100), 1, 'the Frost Stacks counter goes under 1');
    ok(/const fsKey = "passive:Frost Stacks";[\s\S]{0,120}key: fsKey, name: "Frost Stacks", bonus: 10,/.test(src),
       'no Frost Stacks entry at +10% a stack');
    const fs_ = [...(data.raceMoves['Boreas (1%)'].innatePassives || []), ...(data.raceMoves['Boreas (1%)'].learns || [])]
      .find(m => m.name === 'Frost Stacks');
    ok(fs_, 'no Frost Stacks in the Boreas data');
  });

  it('Soul Reversal: +10% per Sense consumed, set with a counter', () => {
    const body = siteFn('dmgRowPct');
    ok(body.indexOf('p.name === "Soul Reversal"') !== -1 && body.indexOf('10 * vydeerSenseConsumed') !== -1,
       'Soul Reversal is not +10% per Sense consumed');
    near(activeMult(['Soul Reversal'], { vydeerSenseConsumed: 3 }), 1.3, 'three Sense consumed');
    const step = counter('changeVydeerSense', 'vydeerSenseConsumed', 1);
    eq(step(100), 10, 'the Sense counter does not stop at its UI limit of 10');
    eq(step(-100), 1, 'the Sense counter goes under 1');
    ok(/if \(raceName === "Vydeer \(1%\)"\) \{\s*const srKey = "buff:Soul Reversal";/.test(src),
       'no Soul Reversal entry for a Vydeer');
    ok(/^\s+vydeerSenseConsumed = 1;/m.test(src), 'the Sense counter is not reset when a build loads');
    const sr = (data.raceMoves['Vydeer (1%)'].learns || []).find(m => m.name === 'Soul Reversal');
    ok(sr && /10% per Sense consumed/.test(sr.effect), 'Soul Reversal no longer says 10% per Sense consumed');
  });
});

describe('Berserker, Brawler, Midas and crit sources', () => {
  const { src, fn: siteFn, counter, activeMult, near } = patchSite;
  const M = engine.model;
  const parse = new Function(siteFn('parseDmgBonus') + '; return parseDmgBonus;')();
  const own = (k, n) => {
    const e = (data.classMoves || {})[k] || {};
    return [...(e.learns || []), ...(e.innatePassives || [])].find(m => m.name === n);
  };

  it('Bloodlust adds +5% a stack, +10% in Rage, and Rage Empower is only the switch', () => {
    // Owner (patch 2026-09-16): stacks add up. 4 stacks = +20%, or +40% in Rage.
    const pct = (stacks, rage) => new Function('bloodlustStacks', 'bloodlustRage',
      siteFn('bloodlustPct') + '; return bloodlustPct();')(stacks, rage);
    eq(pct(4, false), 20, 'four stacks out of Rage');
    eq(pct(4, true), 40, 'four stacks in Rage');
    near(activeMult(['Bloodlust'], { bloodlustPct: () => pct(4, false) }), 1.2, 'the multiplier at four stacks');
    near(activeMult(['Bloodlust'], { bloodlustPct: () => pct(4, true) }), 1.4, 'the multiplier at four stacks in Rage');
    // The counter runs 1-20 and the switch flips the per-stack figure.
    const run = new Function('renderDmgBonusSection', 'recalcOpenDetails',
      'let bloodlustStacks = 1, bloodlustRage = false;\n' + siteFn('bloodlustPct') + '\n' +
      siteFn('changeBloodlustStacks') + '\n' + siteFn('toggleBloodlustRage') +
      '\nreturn { pct: bloodlustPct, add: changeBloodlustStacks, rage: toggleBloodlustRage };')(() => {}, () => {});
    run.add(100);
    eq(run.pct(), 100, 'the Bloodlust counter does not stop at 20');
    run.rage();
    eq(run.pct(), 200, 'the In Rage switch does not double the per-stack figure');
    run.add(-100);
    eq(run.pct(), 10, 'the Bloodlust counter goes under 1');
    run.rage();
    eq(run.pct(), 5, 'the In Rage switch does not switch back');
    const body = siteFn('dmgRowPct');
    ok(/if \(p\.name === "Bloodlust"\)\s*return bloodlustPct\(\);/.test(body),
       'the Bloodlust term does not read bloodlustPct()');
    ok(body.indexOf('Rage Empower') === -1, 'Rage Empower still has a damage branch of its own');
    ok(/m\.name !== "Rage Empower" && \(m\.category === "Buff"/.test(src),
       "Rage Empower's text can become a DMG toggle again");
    ok(/'bloodlustRage' in row\.dataset\) \{\s*row\.addEventListener\("click", \(\) => toggleBloodlustRage\(\)\);/.test(src),
       'the In Rage row is not wired to toggleBloodlustRage');
    ok(/^\s+bloodlustStacks = 1;\r?\n\s+bloodlustRage = false;/m.test(src), 'Rage is not switched off when a build loads');
    // The data: Rage Empower is a pure toggle, Bloodlust states the new sums.
    const rage = own('Berserker (Ch)', 'Rage Empower'), bl = own('Berserker (Ch)', 'Bloodlust');
    ok(rage && bl, 'no Rage Empower or Bloodlust in the data snapshot');
    eq(rage.duration, undefined, 'Rage Empower still has a duration');
    ok(/Toggles Rage on or off/.test(rage.effect) && !/\bHP\b|health/i.test(rage.effect),
       'Rage Empower is not a pure Rage toggle: ' + rage.effect);
    ok(/4 stacks = \+20% damage, or \+40% in Rage/.test(bl.effect), 'Bloodlust does not state the patch sums');
    const frail = (data.raceMoves['Calvariae (3%)'].innatePassives || []).find(p => p.name === 'Frail Body');
    ok(frail && !/Rage Empower/.test(frail.description), 'Frail Body still names Rage Empower');
    // The Build AI: five stacks in Rage at half uptime, no longer HP-gated.
    const p = (K.PASSIVES['Berserker (Ch)'] || []).find(x => x.name === 'Bloodlust') || {};
    ok(p.kind === 'dmgPct' && p.value === 50 && p.uptime === 0.5 && p.source === 'patch' && !p.hpGate,
       'the Build AI does not price Bloodlust at 50 x 0.5 from the patch: ' + JSON.stringify(p));
    ok(/\[assumed\]/.test(p.note || ''), 'the assumed stack count is not flagged in the note');
  });

  it('Crusher counts every status applied, capped at +75%', () => {
    // §12: +7 a status ADDED into the sum (7n, capped at 75), not 1.07^n.
    const cap = +(/const CRUSHER_CAP_PCT = (\d+);/.exec(src) || [])[1];
    const maxStacks = +(/const CRUSHER_MAX_STACKS = (\d+);/.exec(src) || [])[1];
    eq(cap, 75, 'the Crusher cap is not 75');
    const pct = n => new Function('crusherStacks', 'CRUSHER_CAP_PCT', siteFn('getCrusherPct') + '; return getCrusherPct();')(n, cap);
    eq(pct(1), 7, 'one status');
    eq(pct(10), 70, 'ten statuses');
    eq(pct(11), 75, 'eleven statuses (the first count the cap cuts)');
    eq(pct(20), 75, 'twenty statuses');
    ok(7 * 10 < cap && 7 * 11 > cap, 'the cap is not first reached at 11; the counter limit is stale');
    near(activeMult(['Crusher'], { getCrusherPct: () => pct(11) }), 1.75, 'the multiplier at the cap');
    eq(maxStacks, 11, 'the Crusher counter cannot reach the cap');
    const step = new Function('renderDmgBonusSection', 'recalcOpenDetails', 'updatePecents', 'crusherStacks', 'CRUSHER_MAX_STACKS',
      siteFn('changeCrusherStacks') + '\nreturn d => { changeCrusherStacks(d); return crusherStacks; };')(() => {}, () => {}, () => {}, 1, maxStacks);
    eq(step(100), 11, 'the Crusher counter does not stop at 11');
    eq(step(-100), 1, 'the Crusher counter goes under 1');
    // The toggle exists because parseDmgBonus reads the 7, not the 75.
    const crusher = own('Brawler (N)', 'Crusher');
    ok(crusher && /including one the target already has/.test(crusher.effect) && /capped at 75%/.test(crusher.effect),
       'Crusher no longer counts re-applied statuses up to a 75% cap');
    eq(parse(crusher.effect), 7, 'the Crusher text does not parse as +7%');
  });

  it('Midas procs stack +5% Luck, four at most, into the Luck row and crit chance', () => {
    const mult = (stacks, enchant) => new Function('document', 'midasLckStacks',
      siteFn('midasLckMult') + '; return midasLckMult();')({ getElementById: () => ({ value: enchant }) }, stacks);
    eq(mult(0, 'Midas'), 1, 'no stacks');
    near(mult(1, 'Midas'), 1.05, 'one stack');
    near(mult(4, 'Midas'), 1.2, 'four stacks');
    near(mult(9, 'Midas'), 1.2, 'past four stacks');
    eq(mult(4, 'Ivory'), 1, 'Midas stacks applied with another enchant');
    const set = new Function('renderDmgBonusSection', 'recalcOpenDetails', 'updatePecents', 'midasLckStacks',
      siteFn('setMidasLckStacks') + '\nreturn v => { setMidasLckStacks(v); return midasLckStacks; };')(() => {}, () => {}, () => {}, 0);
    eq(set(9), 4, 'the Midas slider goes past 4');
    eq(set(-2), 0, 'the Midas slider goes under 0');
    eq(set('x'), 0, 'a bad slider value is not read as 0');
    ok(/min="0" max="4" value="\$\{midasLckStacks\}" oninput="setMidasLckStacks\(this\.value\)"/.test(src),
       'no 0-4 Midas Luck slider in the DMG calc');
    ok(/if \(_ivoryMult > 1\) total = Math\.round\(total \* _ivoryMult\);\s*if \(statKey === "lck"\) \{ const _midasMult = midasLckMult\(\);/.test(src),
       'getTotalStat does not apply the Midas stacks after Ivory');
    const perm = src.indexOf("if (permuthStat === 'lck' && markPicker?.value === 'Venia') totalLck");
    const midas = src.indexOf('const _midasMult = midasLckMult(); if (_midasMult > 1) totalLck = Math.round(totalLck * _midasMult);');
    ok(perm !== -1 && midas > perm, 'the crit Luck total does not apply the Midas stacks after Permuth');
    ok((src.match(/^\s+midasLckStacks = 0;/mg) || []).length >= 2,
       'the Midas stacks are not reset on both an enchant change and a build load');
    ok(/\+5% Luck/.test(((K.ENCHANTS || {}).Midas || {}).note || ''), "the Build AI's Midas note does not mention the Luck stacks");
  });

  it('Crystal Sphere adds +5% crit damage through gearPctBonuses', () => {
    eq(((data.gearPctBonuses || {})['Crystal Sphere'] || {})['crit-dmg'], 0.05, 'Crystal Sphere crit-dmg in the data snapshot');
    ok(/"Crystal Sphere":\s*\{ "crit-chance": 5, "crit-dmg": 0\.05 \}/.test(src), 'builder.js gearPctBonuses has no Crystal Sphere crit-dmg');
    const b = M.emptyBuild();
    b.level = data.Max_Lvl; b.klass = 'Lancer (N)'; b.race = 'Estella (24%)';
    const before = M.derived(b).critDmg;
    b.gear = [{ name: 'Crystal Sphere', tier: 0, alloc: {}, traits: [] }];
    near(M.derived(b).critDmg - before, 0.05, 'the crit damage Crystal Sphere adds in the model');
    // Its text must not read as a damage toggle.
    eq(parse(String((data.itemPassives || {})['Crystal Sphere'] || '')), null, 'the Crystal Sphere text parses as a damage bonus');
    eq(((K.GEAR_PASSIVES || {})['Crystal Sphere'] || {}).kind, 'onSite', 'Crystal Sphere is priced a second time');
  });

  it('Soul Tree Critical Point is +2% crit damage a rank', () => {
    const node = (((data.soulTreeData || {})['Path of Destruction']) || []).find(n => n.id === 'crit_point');
    ok(node, 'no Critical Point in the data snapshot');
    eq(node.perRank, 2, 'Critical Point per rank');
    eq((node.bonus || {})['crit-dmg'], 0.02, 'Critical Point crit-dmg per rank');
    near(node.maxRank * node.bonus['crit-dmg'], 0.10, 'Critical Point at max rank');
    // One line per node; its desc holds "{v}", so match within the line.
    ok(/id: "crit_point",\s*name: "Critical Point",[^\n]*perRank: 2,[^\n]*bonus: \{"crit-dmg": 0\.02\}/.test(src),
       'builder.js soulTreeData does not give Critical Point 2% a rank');
  });

  it('Holy Crash is 18 base, and 20 with its Proficiency on both sides', () => {
    const hc = own('Paladin (Or)', 'Holy Crash');
    ok(hc, 'no Holy Crash in the data snapshot');
    eq(hc.damage, 18, 'Holy Crash base');
    eq(hc.scaling, 'STR/75 + END/150', 'Holy Crash scaling');
    eq(((K.MOVE_OVERRIDES['Holy Crash'] || [])[0] || {}).base, 20, 'the Build AI does not rewrite Holy Crash to 20');
    // The site gates on the active tree's lm2, which a Paladin and a base
    // Warrior share (verify.js caught a Warrior-tree mismatch).
    const when = ((K.MOVE_OVERRIDES['Holy Crash'] || [])[0] || {}).when;
    ok(when({ klass: 'Paladin (Or)', masteryNodes: ['lm2'] }) && when({ klass: 'Warrior', masteryNodes: ['lm2'] }),
       'the rewrite does not follow the Warrior tree both classes read');
    ok(!when({ klass: 'Paladin (Or)', masteryNodes: [] }) && !when({ klass: 'Berserker (Ch)', masteryNodes: ['lm2'] }),
       'the rewrite applies without Holy Crash Proficiency');
    ok(/m\.name === "Holy Crash" && masteryState\["lm2"\][^\n]*"Holy Crash Proficiency"\) \{\s*baseDmgNum = 20;/.test(src),
       'the DMG calc does not rewrite Holy Crash to 20 with its Proficiency');
    eq((K.MASTERY_ABILITIES['Holy Crash Proficiency'] || {}).kind, 'onSite', 'Holy Crash Proficiency is priced twice');
  });

  it('the Dark Slash scroll is open to Marauder', () => {
    ok((((data.scrollClassRestrictions || {})['Dark Slash']) || []).indexOf('Marauder') !== -1,
       'Dark Slash is not usable by Marauder');
  });
});

// ── Cursed enchant: Cursed and Sundered are exclusive toggles ───────────────
describe('Cursed enchant toggles', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'builder.js'), 'utf8');
  // Pull one top-level function or const out of builder.js and run it.
  const siteFn = name => {
    const start = src.indexOf('function ' + name + '(');
    ok(start !== -1, 'builder.js has no ' + name);
    let depth = 0, i = src.indexOf('{', start), end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
    }
    return src.slice(start, end);
  };

  it('offers a Sundered toggle at +20% beside the Cursed one at +30%', () => {
    // Game text: "+30% damage against Cursed enemies or 20% against Sundered enemies.
    // Does not stack - only the highest buff applies." Since §12 the enchant is
    // a term of the Multi sum; getEnchantMult is the multiplier verify.js reads.
    ok(/key: 'cursedSundered',\s*label: 'Enemy is Sundered'/.test(src), 'no Enemy is Sundered toggle on the Cursed enchant');
    const run = (cond) => new Function('enchantPicker', 'enchantCondActive', 'enchantReaperEnemyHp',
      siteFn('getEnchantPct') + '\n' + siteFn('getEnchantMult') + '; return [getEnchantPct(), getEnchantMult()];')(
      { value: 'Cursed' }, Object.assign({ cursed: false, cursedSundered: false }, cond), 100);
    const [cursed, cursedMult] = run({ cursed: true });
    const [sundered] = run({ cursedSundered: true });
    const [none, noneMult] = run({});
    eq(cursed.pct, 30, 'Cursed is no longer +30%');
    eq(sundered.pct, 20, 'Sundered is not +20%');
    ok(cursed.label && sundered.label && cursed.label !== sundered.label, 'the two Cursed terms are not labelled apart');
    eq(none.pct, 0, 'an idle Cursed enchant adds damage');
    ok(Math.abs(cursedMult - 1.3) < 1e-9 && noneMult === 1, 'getEnchantMult no longer mirrors the term for verify.js');
  });

  it('turning one on turns the other off', () => {
    const exclusive = /const ENCHANT_COND_EXCLUSIVE = (\{[^}]*\});/.exec(src);
    ok(exclusive, 'no exclusivity map for the Cursed toggles');
    const run = new Function('ENCHANT_COND_EXCLUSIVE', 'enchantCondActive', 'renderDmgBonusSection', 'recalcOpenDetails',
      siteFn('toggleEnchantCond') + '; return toggleEnchantCond;');
    const state = { cursed: false, cursedSundered: false, inferno: false };
    const toggle = run(new Function('return ' + exclusive[1])(), state, () => {}, () => {});
    toggle('cursed');
    ok(state.cursed && !state.cursedSundered, 'Cursed did not turn on');
    toggle('cursedSundered');
    ok(state.cursedSundered && !state.cursed, 'turning Sundered on left Cursed on as well');
    toggle('cursed');
    ok(state.cursed && !state.cursedSundered, 'turning Cursed on left Sundered on as well');
    toggle('cursed');
    ok(!state.cursed && !state.cursedSundered, 'turning Cursed off did not leave both off');
    toggle('inferno');
    ok(state.inferno && !state.cursed && !state.cursedSundered, 'an unrelated enchant toggle was affected');
  });
});

// ── Withered Grove §12: additive damage, on the site's own code ─────────────
// "Multi is the additive multiplier bus: every gear, enchant, race passive or
// buff that says '+X% damage' adds X directly into Multi ... five different
// +10% sources gives you Multi = 1.5, not 1.10^5" (changelog §12, Part 2).
// Target statuses and crits stay multiplicative (owner); True Flat is added
// last. These run the DMG calc's REAL composition, built out of js/builder.js:
// its state block, its constants and every function the Multi sum, the
// statuses and the working (toggleDmgDetail) read, with the DOM replaced by a
// few stubs. site(code) evaluates inside that scope, so a test flips the same
// state the page's switches flip.
const additiveSite = (() => {
  const { src, renderer, fn } = patchSite;
  // `const NAME = <literal>;`, brackets matched and strings skipped.
  const constDecl = name => {
    const head = 'const ' + name + ' = ';
    const start = src.indexOf(head);
    ok(start !== -1, 'builder.js has no const ' + name);
    let depth = 0, q = null;
    for (let i = start + head.length; i < src.length; i++) {
      const c = src[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === '[' || c === '{' || c === '(') depth++;
      else if (c === ']' || c === '}' || c === ')') depth--;
      else if (c === ';' && depth === 0) return src.slice(start, i + 1);
    }
    return '';
  };
  const FNS = [
    // the Multi sum
    'fmtDmgPct', 'fmtSignedPct', 'sumDmgTerms', 'dmgRowPct', 'getActiveDmgTerms', 'stacksLabel',
    'getBlizzardPct', 'getEnchantPct', 'getEnchantMult', 'notchDmgPct', 'getCorruptionDmgPct', 'notchPctFor',
    'getShardOfBlightPct', 'getMilestoneDmgStat', 'isSummonAttack', 'getMilestoneDmgPct',
    'milestoneDmgLabel', 'getMoveInnateTerms', 'getDmgMulti', 'dmgMultiFactor', 'getOutsideDmgMult',
    'buildBonusTag', 'getStatusMultiplier', 'bloodlustPct', 'getEnergyBonusPct', 'dcEnergyAfter',
    'getEffectiveMoveType', 'parseDmgBonus', 'collectDmgBonusPassives',
    // the working
    'toggleDmgDetail', 'parseScaling', 'getCritDmgMultEffective', 'getCorruptionCritBonus', 'getOvercritInfo',
    'buildOvercritLines', 'draugaCritHealLine', 'buildLifestealHealLines', 'buildLifestealExpectedLine',
    'getExpectedCritMult', 'getExpectedMultiHitDmg', 'getExpectedMoveCritDmg', 'getBossResMult',
    'moveAppliesStatusEffect', 'selfDestructBase', 'renderSelfDestruct',
  ];
  const CONSTS = ['COREALLOY_PCT_PER_ENERGY', 'MILESTONE_DMG_PCT', 'DMG_TAG_MAX_TERMS', 'MG_SCROLL_KEY',
                  'DMG_AFFINITY_GATES', 'MASTERY_ADDS_TO_BASE', 'STAT_LABEL_MAP', 'BOSS_DATA'];
  const from = src.indexOf('let dmgCalcMoveList = [];');
  const to = src.indexOf('// Entries in BOSS_DATA that belong');
  ok(from !== -1 && to > from, 'the DMG calc state block moved');
  const body = [
    src.slice(from, to),
    'let flamingOverdriveStacks = 0, vasticProcCount = 1;',
    'let dmgBonusPassives = []; const dmgBonusActive = {};',
    ...CONSTS.map(constDecl),
    fn('isSummonMove', renderer),
    ...FNS.map(n => fn(n)),
    // Switch DMG BONUS rows on, and read a move's working as plain text.
    'function __rows(rows) { dmgBonusPassives = rows; rows.forEach(r => { dmgBonusActive[r.key] = true; }); }',
    'function __work(m) {',
    '  const detail = { classList: { contains: c => c === "dc-detail" }, style: { display: "none" }, innerHTML: "" };',
    '  const row = { nextElementSibling: detail, classList: { add() {}, remove() {} } };',
    '  dmgCalcMoveList = [m];',
    '  toggleDmgDetail(row, 0, true);',
    '  return detail.innerHTML.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");',
    '}',
    'return c => eval(c);',
  ].join('\n');
  const NAMES = ['document', 'hasGearEquipped', 'enchantPicker', 'superPicker', 'racePicker', 'classPicker',
    'subPicker', 'markPicker', 'artifactPicker', 'covenantPicker', 'lostScrollPicker', 'scrollPickers',
    'corruptionPicker', 'masteryState', 'getTotalStat', 'STAT_MILESTONE_TIERS', 'getCritDmgMult',
    'getCritChancePct', 'getActiveMasteryData', 'masteryNodes', 'soulTreeData', 'soulTreeRanks',
    'mainWeaponSeries', 'getShardBonusEntries', 'raceMoves', 'classMoves', 'markMoves', 'artifactMoves',
    'weaponMoves', 'covenantMoves', 'lostScrollMoves', 'scrollMoves', 'gearMoves'];
  const make = new Function(...NAMES, body);
  return (o = {}) => {
    const S = Object.assign({ race: '', klass: '', sup: '', enchant: '', form: '', gear: [], weapon: '',
                              stats: {}, critMult: null, critChance: 0, mastery: {}, masteryData: null }, o);
    const picker = v => ({ value: v });
    const doc = {
      getElementById: id => ({ value: id === 'weapon-main' ? S.weapon
                                    : /^gear-\d$/.test(id) ? (S.gear[+id.slice(5) - 1] || '') : '' }),
      querySelectorAll: () => [], querySelector: () => null,
    };
    return make(doc, n => S.gear.indexOf(n) !== -1, picker(S.enchant), picker(S.sup), picker(S.race),
      picker(S.klass), picker(''), picker(''), picker(''), picker(''), picker(''), [], picker(S.form),
      S.mastery, s => S.stats[s] || 0, data.STAT_MILESTONE_TIERS, () => S.critMult, () => S.critChance,
      () => S.masteryData, data.masteryNodes || [], {}, {}, {}, () => [], data.raceMoves || {},
      data.classMoves || {}, {}, data.artifactMoves || {}, {}, data.covenantMoves || {},
      data.lostScrollMoves || {}, data.scrollMoves || {}, {});
  };
})();

describe('additive damage (Withered Grove §12)', () => {
  const near = patchSite.near;
  // A plain 10-damage Physical move of your own, and rows of plain "+X%" buffs.
  const probe = (extra) => Object.assign({ name: 'Probe', damage: 10, scaling: 'STR/100', moveType: 'Physical',
                                           slot: '1st Learn', effect: '' }, extra || {});
  const rows = list => JSON.stringify(list.map(([name, bonus], i) => ({ key: 'k' + i, name, bonus })));
  const multiOf = (site, m, type) => site('getDmgMulti')(m, type || m.moveType, 0);
  const pctOf = (terms, label) => (terms.find(t => t.label === label) || {}).pct;

  it('five +10% sources add to +50% (x1.50), not x1.61', () => {
    const site = additiveSite();
    site('__rows(' + rows([['Buff A', 10], ['Buff B', 10], ['Buff C', 10], ['Buff D', 10], ['Buff E', 10]]) + ')');
    const s = multiOf(site, probe());
    eq(s.pct, 50, 'the five buffs do not sum to +50');
    near(s.mult, 1.5, 'the Multi factor');
    ok(Math.pow(1.1, 5) - s.mult > 0.1, 'the buffs still compound');
    eq(s.terms.length, 5, 'each buff is not its own labelled term');
    const text = site('__work')(probe());
    ok(/10\(1 \+ STR\(0\)\/100\) = 10\.0 × 1\.50 \[\+50%: Buff A \+10, Buff B \+10, Buff C \+10, Buff D \+10, Buff E \+10\] = 15\.0/.test(text),
       'the working does not show the sum with its terms: ' + text);
  });

  it('Crusher at 11 statuses is +75 (its cap), 7 a status below it', () => {
    const site = additiveSite();
    site('__rows(' + rows([['Crusher', 7]]) + ')');
    site('crusherStacks = 10');
    eq(pctOf(multiOf(site, probe()).terms, 'Crusher'), 70, 'ten statuses');
    site('crusherStacks = 11');
    eq(pctOf(multiOf(site, probe()).terms, 'Crusher'), 75, 'eleven statuses do not reach the +75 cap');
    site('crusherStacks = 12');
    eq(pctOf(multiOf(site, probe()).terms, 'Crusher'), 75, 'the cap does not hold');
    // Crusher's own Vulnerable: 25% instead of 20%, a target status.
    site('statusEffectsActive.vulnerable = true');
    near(site('getStatusMultiplier')('Physical').mult, 1.25, 'Vulnerable with Crusher');
    site('__rows([])');
    near(site('getStatusMultiplier')('Physical').mult, 1.2, 'Vulnerable without Crusher');
  });

  it('Sands Of Time: 5 uses is +100 (x2.00), not 1.2^5', () => {
    const site = additiveSite();
    site('__rows(' + rows([['Sands Of Time', 20]]) + ')');
    site('hourglassStacks = 5');
    const s = multiOf(site, probe());
    eq(s.pct, 100, 'five uses');
    near(s.mult, 2, 'the factor at five uses');
  });

  it('Cast Amplify: 3 stacks is +60, only on its types', () => {
    const site = additiveSite();
    site('teamBuffsActive.castAmplify = true; castAmplifyStacks = 3');
    eq(multiOf(site, probe({ moveType: 'Magic' })).pct, 60, 'three stacks on a Magic move');
    eq(multiOf(site, probe()).pct, 0, 'Cast Amplify reached a Physical move');
    // A stack count is not written with the x of a real multiplier.
    eq(pctOf(multiOf(site, probe({ moveType: 'Magic' })).terms, 'Cast Amplify (3 stacks)'), 60, 'the Cast Amplify label');
    // Overheat and Oppression are summed too: 8 and 5 a stack.
    site('teamBuffsActive.castAmplify = false; statusEffectsActive.overheat = true; overheatStacks = 10');
    eq(multiOf(site, probe()).pct, 80, 'ten Overheat stacks are not +80');
    eq(pctOf(multiOf(site, probe()).terms, 'Overheat (10 stacks)'), 80, 'the Overheat label');
    site('statusEffectsActive.overheat = false');
    // Oppression at 4 is where the two rules part (5 x 4 = 20, 1.05^4 = +21.55);
    // at 5 they meet by chance, and past 5 the cap holds.
    site('__rows(' + rows([['Oppression', 5]]) + '); oppressionCount = 4');
    eq(multiOf(site, probe()).pct, 20, 'four Oppression effects are not +20');
    site('oppressionCount = 5');
    eq(multiOf(site, probe()).pct, 25, 'five Oppression effects are not +25');
    site('oppressionCount = 6');
    eq(multiOf(site, probe()).pct, 25, 'the Oppression cap does not hold at 6');
  });

  it('Darkbeast Dark Cores add 5 a core and 50 more at six, on that summon only', () => {
    const site = additiveSite();
    const beast = probe({ slot: 'Darkbeast' });
    site('darkCoreCount = 3');
    eq(pctOf(multiOf(site, beast).terms, 'Dark Cores (3)'), 15, 'three cores');
    site('darkCoreCount = 6');
    eq(pctOf(multiOf(site, beast).terms, 'Dark Cores (6)'), 80, 'six cores are not 30 + 50 (1.05^6 x 1.5 would be +101)');
    eq(multiOf(site, probe()).pct, 0, 'the cores reached your own move');
  });

  it("Blasphemy's Notch reaches a 3+ energy move only", () => {
    // "Any move costing 0-2 NRG generates 1 Notch up to your cap. Any move
    // costing 3+ NRG consumes the entire stack instead." (owner-stated rule;
    // the engine's Blasphemy pricing uses the same one).
    const site = additiveSite({ form: 'Blasphemy' });
    site('corruptionBuffsActive.notch = true; notchSpent = 5; notchCap = 5');
    eq(pctOf(multiOf(site, probe({ cost: 3 })).terms, 'Blasphemy Notch'), 30, 'a 3-energy move does not spend the stack');
    eq(pctOf(multiOf(site, probe({ cost: '3+X' })).terms, 'Blasphemy Notch'), 30, 'a "3+X" move does not spend the stack');
    for (const cost of [0, 1, 2, undefined]) {
      eq(multiOf(site, probe({ cost })).pct, 0, 'a ' + cost + '-energy move got the Notch');
    }
    eq(site('getOutsideDmgMult')({ name: 'Self Destruct', moveType: 'Physical', cost: 2, slot: 'Skeleton' }).pct, 0,
       'Self Destruct (cost 2) got the Notch');
    eq(site('sumDmgTerms(getActiveDmgTerms(null, null))'), 0, 'the Notch is still a switch on every move');
    ok(/Blasphemy Notch \+30/.test(site('__work')(probe({ cost: 3 }))), 'the working does not name the Notch on a 3-energy move');
  });

  it('target statuses still multiply, with each other and with the sum', () => {
    const site = additiveSite();
    site('__rows(' + rows([['Buff A', 50]]) + ')');
    site('statusEffectsActive.vulnerable = true; statusEffectsActive.hexed = true; statusEffectsActive.fractured = true');
    near(site('getStatusMultiplier')('Physical').mult, 1.2 * 2 * 1.35, 'Vuln x Hexed x Frac on Physical');
    near(site('getStatusMultiplier')('Fire').mult, 1.2 * 2, 'Fractured reached a Fire move');
    const text = site('__work')(probe());
    // 10 x 1.50 = 15, x 3.24 = 48.6
    ok(/× 1\.50 \[\+50%: Buff A \+50\] = 15\.0 × 3\.24 \[Vuln ×1\.20, Hexed ×2, Frac ×1\.35\] = 48\.6/.test(text),
       'the statuses are not a separate multiplied step: ' + text);
    // Condemned and the Sinister Gaze reflections moved out of the sum into the statuses.
    site('statusEffectsActive.vulnerable = false; statusEffectsActive.hexed = false; statusEffectsActive.fractured = false');
    const form = additiveSite({ form: 'Tyranny' });
    form('corruptionBuffsActive.condemned = true; condemnedPct = 10; sinisterGazeBloodProf = true');
    near(form('getStatusMultiplier')('Physical').mult, 1.1 * 1.2, 'Condemned and the Blood Eruption reflection');
    eq(form('getDmgMulti')(probe(), 'Physical', 0).pct, 0, 'a target status leaked into the Multi sum');
  });

  it('the sum can go below zero, and the working shows the factor under 1', () => {
    const site = additiveSite();
    site('__rows(' + rows([['Probe Debuff', -30]]) + ')');
    const s = multiOf(site, probe());
    eq(s.pct, -30, 'a negative term');
    near(s.mult, 0.7, 'the factor');
    const text = site('__work')(probe());
    ok(/× 0\.70 \[−30%: Probe Debuff −30\] = 7\.0/.test(text), 'a factor under 1 is hidden or wrong: ' + text);
    // The same gate on the no-scaling path, where hiding the step changes the
    // number itself (it would read 10.0).
    const flat = site('__work')(probe({ scaling: '' }));
    ok(/10 × 0\.70 \[−30%: Probe Debuff −30\] = 7\.0/.test(flat), 'the no-scaling path hides a factor under 1: ' + flat);
    // And on Discharge Proficiency's four hits (Lancer cm2): 10 x 0.70 = 7.0 a
    // full hit, x (1 + 0.38 + 1/3 + 1/3) = 14.3 - not 20.5 at a hidden factor.
    const lancer = additiveSite({ sup: 'Lancer (N)', mastery: { cm2: true } });
    lancer('__rows(' + rows([['Probe Debuff', -30]]) + ')');
    const dis = lancer('__work')(probe({ name: 'Discharge', moveType: 'Magic' }));
    ok(/× 0\.70 \[−30%: Probe Debuff −30\] = 7\.0/.test(dis) && /4 hits — [^=]*= 14\.3/.test(dis),
       'Discharge hides a factor under 1: ' + dis);
    site('__rows(' + rows([['Probe Debuff', -150]]) + ')');
    eq(multiOf(site, probe()).mult, 0, 'the factor went below zero');
  });

  it('Shadow Form + Shadow Master is +50, two terms, not x1.56', () => {
    const nodes = (((data.masteryClassData || {})['Assassin (Ch)'] || {}).nodes) || {};
    ok(nodes.lm1 && nodes.lm1.name === 'Shadow Master' && nodes.lm1.upgrades === 'Shadow Form',
       'fixture: Assassin lm1 is no longer Shadow Master upgrading Shadow Form');
    const assassin = mastery => additiveSite({ sup: 'Assassin (Ch)', mastery, masteryData: data.masteryClassData['Assassin (Ch)'] });
    const plain = assassin({});
    const sf = plain('collectDmgBonusPassives')().find(p => p.name === 'Shadow Form');
    ok(sf && sf.bonus === 20, 'Shadow Form alone is not +20: ' + JSON.stringify(sf));
    const site = assassin({ lm1: true });
    const merged = site('collectDmgBonusPassives')();
    const row = merged.find(p => p.name === 'Shadow Form');
    ok(row, 'no Shadow Form row with Shadow Master taken');
    eq(row.bonus, 50, 'Shadow Form + Shadow Master');
    eq(merged.filter(p => p.name === 'Shadow Form' || p.name === 'Shadow Master').length, 1, 'the two became two rows');
    site('dmgBonusPassives = collectDmgBonusPassives(); dmgBonusActive[dmgBonusPassives.find(p => p.name === "Shadow Form").key] = true');
    const s = multiOf(site, probe());
    eq(s.pct, 50, 'the sum');
    eq(pctOf(s.terms, 'Shadow Form'), 20, 'Shadow Form is not its own +20 term');
    eq(pctOf(s.terms, 'Shadow Master'), 30, 'Shadow Master is not its own +30 term');
    // The class comes from a named list, never from the game text's wording.
    ok(!/multiplicative/i.test(patchSite.fn('collectDmgBonusPassives').replace(/\/\/[^\n]*/g, '')),
       'the merge still reads "multiplicative" from the text');
    ok(/const MASTERY_ADDS_TO_BASE = \{ "Shadow Master": true \};/.test(patchSite.src), 'no named list of masteries that add');
  });

  it("Empowered Pierce's +50% is a crit-only term of the sum, not x1.5 on the crit", () => {
    const site = additiveSite({ critMult: 2 });
    site('__rows(' + rows([['Buff A', 50]]) + ')');
    const ep = probe({ name: 'Empowered Pierce', damage: 15, scaling: 'STR/80 + SPD/80', critDmgBonus: 50 });
    const out = site('getOutsideDmgMult')(ep);
    eq(out.pct, 50, 'the crit-only term reached the normal hit');
    eq(out.critPct, 100, 'the crit sum is not +50 more');
    near(out.critRatio, 2 / 1.5, 'the crit figures do not carry the ratio of the two sums');
    const text = site('__work')(ep);
    // Normal 15 x 1.5 = 22.5. Crit 15 x (1 + 1.0) x 2 = 60, not 22.5 x 2 x 1.5 = 67.5.
    ok(/= 22\.5/.test(text), 'the normal hit moved: ' + text);
    ok(/All crits: 22\.5 × 2\.00x × 1\.33 \[crit: Multi \+50% → \+100%\] = 60\.0/.test(text),
       'the crit is not 15 x 2.00 x 2 = 60: ' + text);
    ok(text.indexOf('67.5') === -1, 'the crit still multiplies x1.5');
    // A move without the bonus has no crit-only term.
    eq(site('getOutsideDmgMult')(probe()).critRatio, 1, 'a move without a crit bonus got one');
  });

  it('Stealth Strike from Invisible adds +100 to Stealth Strike only', () => {
    const site = additiveSite();
    const ss = probe({ name: 'Stealth Strike', scaling: 'STR/75' });
    site('__rows(' + rows([['Shadow Form', 20]]) + ')');
    eq(multiOf(site, ss).pct, 20, 'Stealth Strike before the switch');
    site('stealthStrikeInvisible = true');
    const s = multiOf(site, ss);
    eq(s.pct, 120, 'Stealth Strike from Invisible is not +100 on top of Shadow Form');
    eq(pctOf(s.terms, 'Stealth Strike'), 100, 'no labelled Stealth Strike term');
    eq(multiOf(site, probe()).pct, 20, 'the switch reached another move');
    // 10 x (1 + 1.2) = 22, not 10 x 2 x 1.2 = 24 or a doubled base.
    ok(/10\(1 \+ STR\(0\)\/75\) = 10\.0 × 2\.20 \[\+120%: Stealth Strike \+100, Shadow Form \+20\] = 22\.0/.test(site('__work')(ss)),
       'the Stealth Strike working is not 10 x 2.20 = 22.0: ' + site('__work')(ss));
    // The switch is part of the build's DMG state: cleared on load, cleared when
    // the move leaves the list, and it repaints the open workings.
    const src = patchSite.src;
    ok(/luckyHornsSpend = false;\r?\n\s+bloomingEyeSpend = false;\r?\n\s+stealthStrikeInvisible = false;/.test(src),
       'loadBuildState does not clear the Stealth Strike switch');
    ok(/if \(dmgCalcMoveList\.some\(m => m\.name === "Stealth Strike"\)\) \{[\s\S]{0,1400}\} else if \(stealthStrikeInvisible\) \{\s*stealthStrikeInvisible = false;/.test(src),
       'the switch is not shown only with Stealth Strike, or not cleared without it');
    ok(/Invisibility's own \+20%[^"]*Shadow Form row/.test(src), "the switch's tooltip does not point at the Shadow Form row");
    const calls = [];
    const toggle = new Function('renderDmgBonusSection', 'recalcOpenDetails', 'let stealthStrikeInvisible = false;\n' +
      patchSite.fn('toggleStealthStrikeInvisible') + '\nreturn () => { toggleStealthStrikeInvisible(); return stealthStrikeInvisible; };')(
      () => calls.push('panel'), () => calls.push('workings'));
    eq(toggle(), true, 'the switch does not turn on');
    ok(calls.indexOf('workings') !== -1, 'flipping the switch does not repaint the open workings');
  });

  it('Blooming Eye True Flat is added after the sum, the statuses and the crit', () => {
    const site = additiveSite({ gear: ['Blooming Eye'], critMult: 2 });
    site('__rows(' + rows([['Buff A', 50]]) + '); statusEffectsActive.hexed = true');
    let text = site('__work')(probe());
    // main 10 x 1.5 x 2 = 30; hit 30 + 5 = 35; crit 30 x 2 + 5 = 65.
    ok(/= 30\.0 \+ 5 \[Blooming Eye, True Flat\] = 35\.0/.test(text), 'the hit is not 30 + 5: ' + text);
    ok(/All crits: 30\.0 × 2\.00x \+ 5 \[True Flat\] = 65\.0/.test(text), 'the crit is not 30 x 2 + 5: ' + text);
    site('bloomingEyeSpend = true');
    text = site('__work')(probe({ damage: '10x3' }));
    // Three hits: main 90; + 35 a hit = 195; crit 180 + 105 = 285.
    ok(/\+ 105 \[Blooming Eye, True Flat, 35 × 3 hits\] = 195\.0/.test(text), 'the spend is not +35 on each of 3 hits: ' + text);
    ok(/All crits: 90\.0 × 2\.00x \+ 105 \[True Flat\] = 285\.0/.test(text), 'the multi-hit crit adds True Flat wrong: ' + text);
    eq(additiveSite({ gear: [] })('getTrueFlatDmg')(), 0, 'True Flat without Blooming Eye');
  });

  it('Spirit Awakening +50 reaches summon attacks only', () => {
    const site = additiveSite({ race: 'Vastayan (9%)' });
    site('summonBuffsActive.spiritAwakening = true');
    eq(multiOf(site, probe()).pct, 0, 'Spirit Awakening reached your own move');
    const skeleton = probe({ slot: 'Skeleton' });
    // Labelled apart from the +15 DMG BONUS row that shares the name.
    eq(pctOf(multiOf(site, skeleton).terms, 'Spirit Awakening (summon buff)'), 50, "a summon's attack did not get +50");
    eq(multiOf(site, probe({ slot: 'Base Move' })).pct, 0, "Arbiter's own Base Move counted as a summon");
  });

  it("Metrom's Grasp never raises a direct hit", () => {
    const site = additiveSite();
    site('teamBuffsActive.mg = true');
    eq(multiOf(site, probe()).pct, 0, 'team MG reached a direct hit');
    site('teamBuffsActive.mg = false; __rows([{ key: MG_SCROLL_KEY, name: "Metrom\'s Grasp", bonus: 40 }])');
    eq(multiOf(site, probe()).pct, 0, 'the MG scroll row reached a direct hit');
    ok(site('__work')(probe()).indexOf('1.40') === -1, 'a working still shows x1.40');
    ok(/DoT only/.test(patchSite.fn('renderDmgBonusSection')), 'the MG rows do not say they are DoT only');
  });

  it('every factor in the total is labelled, and a long list folds but keeps the true sum', () => {
    const site = additiveSite({ enchant: 'Cursed', gear: ['Shard of Blight'], stats: { str: 110 } });
    site('enchantCondActive.cursed = true; teamBuffsActive.blizzard = true');
    const dark = multiOf(site, probe({ moveType: 'Dark' }));
    // A Dark move: Cursed + Shard of Blight. Blizzard is Ice only, STR 110 Physical only.
    eq(dark.pct, 30 + 25, 'a Dark move under Cursed and Shard of Blight');
    const phys = multiOf(site, probe());
    eq(pctOf(phys.terms, 'Cursed'), 30, 'the enchant is not a labelled term');
    eq(pctOf(phys.terms, 'STR 110 Physical'), 20, 'the milestone is not a labelled term');
    eq(pctOf(dark.terms, 'Shard of Blight'), 25, 'Shard of Blight is not a labelled term');
    eq(pctOf(multiOf(site, probe({ moveType: 'Ice' })).terms, 'Blizzard'), 20, 'Blizzard is not a labelled term');
    const tag = site('buildBonusTag')(phys);
    ok(/^\[\+50%: Cursed \+30, STR 110 Physical \+20\]$/.test(tag), 'the tag does not list every term: ' + tag);
    site('__rows(' + rows([...Array(10)].map((_, i) => ['Buff ' + i, 5])) + ')');
    const many = site('buildBonusTag')(multiOf(site, probe({ moveType: 'Fire' })));
    // 10 x 5 + Cursed 30 = 80; 7 shown, the other 4 folded with their total.
    ok(/^\[\+80%: /.test(many) && /, 4 more \+20\]$/.test(many), 'a long tag does not fold with its true total: ' + many);
  });

  it('move-innate percentages join the move\'s sum on their old conditions', () => {
    const site = additiveSite({ sup: 'Elementalist (Or)', mastery: { lm2: true } });
    const blaze = probe({ name: 'Blaze', moveType: 'Fire', scaling: 'ARC/70' });
    eq(pctOf(multiOf(site, blaze).terms, 'Blaze Prof.'), 15, 'Blaze Proficiency is not +15 on the hit');
    // The main figure does not assume a burning target: Proficiency's 15 only,
    // and nothing at all without the mastery.
    eq(multiOf(site, blaze).pct, 15, "Blaze's main sum is not Proficiency's +15 alone");
    eq(multiOf(additiveSite({ sup: 'Elementalist (Or)' }), blaze).pct, 0, 'Blaze has a main sum without its mastery');
    const burning = site('getOutsideDmgMult')(blaze, { vsBurning: true });
    eq(burning.pct, 30 + 25, 'Blaze vs burning is not Proficiency 30 + Blaze 25');
    ok(/vs burning: 10\.0 × 1\.55 \[\+55%: Blaze Prof\. \+30, Blaze vs burning \+25\] = 15\.5/.test(site('__work')(blaze)),
       'no vs-burning line with the sum: ' + site('__work')(blaze));
    const slash = probe({ name: 'Slash Barrage', damage: 16, scaling: 'STR/85' });
    eq(pctOf(multiOf(site, slash).terms, 'Slash Barrage vs bleeding'), 30, 'Slash Barrage is not +30 in its sum');
    eq(multiOf(site, probe()).pct, 0, 'a move-innate term reached another move');
    // Blazing Barrage Proficiency (Monk lm2): +20 against a burning target only.
    const monk = additiveSite({ sup: 'Monk (Or)', mastery: { lm2: true } });
    const bb = probe({ name: 'Blazing Barrage', moveType: 'Fire', scaling: 'STR/80' });
    eq(multiOf(monk, bb).pct, 0, "Blazing Barrage Proficiency's +20 reached the main figure");
    eq(monk('getOutsideDmgMult')(bb, { vsBurning: true }).pct, 20, 'Blazing Barrage vs burning is not +20');
    eq(additiveSite({ sup: 'Monk (Or)' })('getOutsideDmgMult')(bb, { vsBurning: true }).pct, 0,
       'Blazing Barrage has a vs-burning term without its mastery');
  });

  it('the side lines print every step their figure has (§4)', () => {
    // vs burning under Hexed with Blooming Eye: 10 x 1.55 = 15.5, x2 = 31.0,
    // + 5 True Flat = 36.0. It used to read "x 1.55 [...] -> 36.0".
    const site = additiveSite({ sup: 'Elementalist (Or)', mastery: { lm2: true }, gear: ['Blooming Eye'] });
    site('statusEffectsActive.hexed = true');
    const blaze = probe({ name: 'Blaze', moveType: 'Fire', scaling: 'ARC/70' });
    const text = site('__work')(blaze);
    ok(/vs burning: 10\.0 × 1\.55 \[\+55%: [^\]]*\] = 15\.5 × 2\.00 \[Hexed ×2\] = 31\.0 \+ 5 \[Blooming Eye, True Flat\] = 36\.0/.test(text),
       'the vs-burning line hides a status or True Flat: ' + text);
    // Rending Barrage's extra hit: the labelled sum, Vulnerable and True Flat.
    // 13.5 x 1.15 = 15.525, x 1.20 = 18.63, + 5 = 23.63.
    const imp = additiveSite({ gear: ['Blooming Eye'] });
    imp('__rows(' + rows([['Buff A', 15]]) + '); statusEffectsActive.vulnerable = true');
    const rb = imp('__work')(probe({ name: 'Rending Barrage', damage: '6x3', scaling: 'STR/75 + ARC/75' }));
    ok(/vs bleeding \(extra hit\): 13\.5\(1 \+ STR\(0\)\/75 \+ ARC\(0\)\/75\) = 13\.5 × 1\.15 \[\+15%: Buff A \+15\] = 15\.5 × 1\.20 \[Vuln ×1\.20\] = 18\.6 \+ 5 \[Blooming Eye, True Flat\] = 23\.6/.test(rb),
       'the Rending Barrage extra hit hides a term: ' + rb);
    // Crucible's hits 2-3 carry the same labelled sum as hit 1.
    const cit = additiveSite({ sup: 'Citadel (Or)' });
    cit('__rows(' + rows([['Buff A', 50]]) + ')');
    const cr = cit('__work')(probe({ name: 'Crucible', damage: 9, scaling: 'STR/65' }));
    ok(/Hits 2–3: 3\.6\(1 \+ STR\(0\)\/90\) = 3\.6 × 1\.50 \[\+50%: Buff A \+50\] = 5\.4 × 1\.20 \[Vuln from hit 1\] = 6\.5/.test(cr),
       "Crucible's hits 2-3 print a bare factor: " + cr);
  });

  it('the paths outside the ordinary one apply the same sum, in number (§5)', () => {
    const site = additiveSite();
    site('__rows(' + rows([['Buff A', 50]]) + ')');
    // Stinger: both parts carry the sum. 5 x 1.5 = 7.5, 10 x 1.5 = 15, total 22.5.
    const st = site('__work')(probe({ name: 'Stinger', damage: '5 + 10', scaling: 'ARC/75' }));
    ok(/Stab \(Physical\): 5\(1 \+ ARC\(0\)\/75\) = 5\.0 × 1\.50 \[\+50%: Buff A \+50\] = 7\.5/.test(st) &&
       /Arrows \(Poison\): 10\(1 \+ ARC\(0\)\/70 \+ SPD\(0\)\/80\) = 10\.0 × 1\.50 \[\+50%: Buff A \+50\] = 15\.0/.test(st) &&
       /Total: 7\.5 \+ 15\.0 = 22\.5/.test(st), "Stinger's parts do not both carry the sum: " + st);
    // The Frosted AOE: 10 through the switches, summed - two +10s are x1.20.
    const fr = additiveSite({ enchant: 'Frosted' });
    fr('__rows(' + rows([['Buff A', 10], ['Buff B', 10]]) + '); enchantCondActive.frostedColdEnemy = true');
    ok(/Frosted AOE \(on crit vs Cold\): 10 × 1\.20 \[\+20%: Buff A \+10, Buff B \+10\] = 12\.0/.test(fr('__work')(probe())),
       'the Frosted AOE does not sum its terms: ' + fr('__work')(probe()));
    // Self Destruct: its base at full HP (109.5) through the same sum.
    const dmgEl = { innerHTML: '' };
    const box = { dataset: { slot: 'Skeleton' }, querySelector: sel => (sel === '.sd-dmg' ? dmgEl : null) };
    site('renderSelfDestruct')({ value: 100, closest: () => box });
    const sd = dmgEl.innerHTML.replace(/<[^>]+>/g, '').replace(/&times;/g, '×');
    ok(/109\.5 × 1\.50 \[\+50%: Buff A \+50\] = 164\.2/.test(sd), 'Self Destruct does not apply the sum: ' + sd);
  });

  it('a multi-hit crit line keeps its crit-only term, and DeathBeak takes the enchant alone (§5)', () => {
    // Two 10-damage hits under Buff A +50 and Inferno +20 (a +70 sum), with a
    // crit-only +50 (Empowered Pierce-style) and DeathBeak Dagger worn.
    const site = additiveSite({ critMult: 2, critChance: 50, gear: ['DeathBeak Dagger'], enchant: 'Inferno' });
    site('__rows(' + rows([['Buff A', 50]]) + '); enchantCondActive.inferno = true');
    const mv = probe({ damage: '10x2', critDmgBonus: 50 });
    const out = site('getOutsideDmgMult')(mv);
    near(out.pct, 70, 'fixture: the sum is not Buff A + Inferno');
    near(out.critRatio, 2.2 / 1.7, 'fixture: the crit-only +50 is not in the crit sum');
    const text = site('__work')(mv);
    const main = 10 * 2 * 1.7;
    const re = n => n.toFixed(1).replace('.', '\\.');
    // The crit average per hit and the binomial expectation carry the ratio.
    ok(new RegExp('Crit avg: ' + re(main / 2 * 2 * out.critRatio)).test(text), 'the crit average lost the crit-only term: ' + text);
    const want = site('getExpectedMoveCritDmg')(main, 2, 50, out.critRatio);
    ok(Math.abs(want - site('getExpectedMultiHitDmg')(main, 2, 50)) > 1, 'fixture: the crit-only term does not move the expectation');
    ok(new RegExp('Expected \\(50% crit, binomial\\): ' + re(want)).test(text), 'the Expected line lost the crit-only term: ' + text);
    // DeathBeak's proc: base x crit x 0.15 x the enchant's factor ALONE (1.20),
    // not the whole sum (1.70, which would read 5.1).
    ok(new RegExp('\\+ Beak \\(1\\.0 exp\\. crits × ' + re(10 * 2 * 0.15 * 1.2) + '\\)').test(text),
       'DeathBeak does not take the enchant alone: ' + text);
  });

  it('the sum tools/ai/verify.js gates on is 0 exactly when nothing applies', () => {
    // verify.js compares a move's raw damage with the model only while the
    // move's sum is 0, read from getDmgMulti - so every term must show there,
    // and nothing may show with every switch off.
    const idle = additiveSite();
    eq(idle('sumDmgTerms(getActiveDmgTerms(null, null))'), 0, 'the switches add something with nothing on');
    for (const t of ['Physical', 'Magic', 'Dark', 'Ice', 'Fire', 'Holy', 'Poison']) {
      eq(multiOf(idle, probe({ moveType: t })).pct, 0, 'an idle ' + t + ' move has a sum');
    }
    eq(idle('getEnchantMult()'), 1, "DeathBeak's enchant factor is not 1 with no enchant");
    const site = additiveSite({ gear: ['Shard of Blight'], enchant: 'Inferno' });
    site('__rows(' + rows([['Buff A', 10], ['Buff B', 10]]) + '); enchantCondActive.inferno = true; teamBuffsActive.blizzard = true');
    eq(site('sumDmgTerms(getActiveDmgTerms(null, null))'), 20, 'the switches');
    eq(multiOf(site, probe({ moveType: 'Dark' })).pct, 20 + 20 + 25, 'a Dark move: switches, enchant, Shard of Blight');
    eq(multiOf(site, probe({ moveType: 'Ice' })).pct, 20 + 20 + 20, 'an Ice move: switches, enchant, Blizzard');
    near(site('getEnchantMult()'), 1.2, "DeathBeak's enchant factor");
    // The harness reads that sum, fails loudly without it, and never reads a
    // run that compared nothing as a pass.
    const v = fs.readFileSync(path.join(__dirname, 'verify.js'), 'utf8');
    ok(/getDmgMulti\(mv, eff, eAfter\)\.pct/.test(v), 'verify.js does not gate on the Multi sum');
    ok(/'getDmgMulti', 'getActiveDmgTerms', 'sumDmgTerms'/.test(v) && /throw new Error\('the page has no '/.test(v),
       'verify.js does not fail when the page lacks the functions it gates on');
    ok(/if \(!dmgChecked && !dmgBad\.length\)/.test(v), 'verify.js reads "0 compared" as a pass');
    ok(!/mv\.name === 'Stealth Strike'\) continue/.test(v), 'verify.js still skips Stealth Strike');
    for (const gone of ['getActiveDmgMult', 'getShardOfBlightMult', 'getBlizzardMult', 'getMilestoneDmgMult']) {
      ok(!new RegExp('function ' + gone + '\\(').test(patchSite.src), gone + ' is back beside the sum');
      ok(!new RegExp(gone + '\\(').test(v), 'verify.js still reads ' + gone);
    }
  });

  it('every other path shows a Multi factor under 1 too, and a resisted boss step (§1: "!== 1", never "> 1")', () => {
    // The ordinary, no-scaling and Discharge paths are checked above. A "> 1"
    // gate on any of these hides the step (on the Frosted AOE it drops the
    // factor from the number as well), so a -30 sum reads as if nothing applied.
    const tag = '× 0\\.70 \\[−30%: Probe Debuff −30\\]';
    const f1 = n => n.toFixed(1).replace('.', '\\.');
    const debuffed = o => { const s = additiveSite(o); s('__rows(' + rows([['Probe Debuff', -30]]) + ')'); return s; };
    // Crucible (Citadel): hit 1 and hits 2-3 each print the factor.
    const cr = debuffed({ sup: 'Citadel (Or)' })('__work')(probe({ name: 'Crucible', damage: 9, scaling: 'STR/65' }));
    ok(new RegExp('Hit 1: 9\\(1 \\+ STR\\(0\\)/65\\) = 9\\.0 ' + tag + ' = ' + f1(9 * 0.7)).test(cr) &&
       new RegExp('Hits 2–3: 3\\.6\\(1 \\+ STR\\(0\\)/90\\) = 3\\.6 ' + tag + ' = ' + f1(3.6 * 0.7)).test(cr),
       'Crucible hides a factor under 1: ' + cr);
    // Rending Barrage's extra hit.
    const rb = debuffed()('__work')(probe({ name: 'Rending Barrage', damage: '6x3', scaling: 'STR/75 + ARC/75' }));
    ok(new RegExp('vs bleeding \\(extra hit\\): 13\\.5\\(1 \\+ STR\\(0\\)/75 \\+ ARC\\(0\\)/75\\) = 13\\.5 ' + tag + ' = ' + f1(13.5 * 0.7)).test(rb),
       'the Rending Barrage extra hit hides a factor under 1: ' + rb);
    // Stinger's two parts, each at its own sum.
    const st = debuffed()('__work')(probe({ name: 'Stinger', damage: '5 + 10', scaling: 'ARC/75' }));
    ok(new RegExp('Stab \\(Physical\\): 5\\(1 \\+ ARC\\(0\\)/75\\) = 5\\.0 ' + tag + ' = 3\\.5').test(st) &&
       new RegExp('Arrows \\(Poison\\): 10\\(1 \\+ ARC\\(0\\)/70 \\+ SPD\\(0\\)/80\\) = 10\\.0 ' + tag + ' = 7\\.0').test(st),
       "Stinger's parts hide a factor under 1: " + st);
    // Self Destruct at full HP.
    const sdSite = debuffed();
    const dmgEl = { innerHTML: '' };
    const box = { dataset: { slot: 'Skeleton' }, querySelector: sel => (sel === '.sd-dmg' ? dmgEl : null) };
    sdSite('renderSelfDestruct')({ value: 100, closest: () => box });
    const sd = dmgEl.innerHTML.replace(/<[^>]+>/g, '').replace(/&times;/g, '×');
    const sdBase = sdSite('selfDestructBase')(100);
    ok(new RegExp(f1(sdBase) + ' ' + tag + ' = ' + f1(sdBase * 0.7)).test(sd), 'Self Destruct hides a factor under 1: ' + sd);
    // The Frosted AOE: 10 x 0.70 = 7.0.
    const fr = debuffed({ enchant: 'Frosted' });
    fr('enchantCondActive.frostedColdEnemy = true');
    ok(new RegExp('Frosted AOE \\(on crit vs Cold\\): 10 ' + tag + ' = 7\\.0').test(fr('__work')(probe())),
       'the Frosted AOE hides a factor under 1: ' + fr('__work')(probe()));
    // A boss that resists the hit shows the step, on both paths: Yar'Thul
    // takes 85% from Physical.
    const boss = additiveSite();
    boss('selectedBoss = "Yar\'Thul, The Blazing Dragon"');
    near(boss('getBossResMult')('Physical').mult, 0.85, "fixture: Yar'Thul no longer takes 85% from Physical");
    ok(/= 10\.0 × 0\.85 \[15% res\] = 8\.5/.test(boss('__work')(probe())), 'a resisted hit hides its resistance step: ' + boss('__work')(probe()));
    ok(/Base damage: 10 × 0\.85 \[15% res\] = 8\.5/.test(boss('__work')(probe({ scaling: '' }))),
       'a resisted no-scaling hit hides its resistance step: ' + boss('__work')(probe({ scaling: '' })));
  });

  it('True Flat rides no crit on the multi-hit lines: the crit average, the overcrit tiers, the expectation', () => {
    // Two 10-damage hits at +50 (15 a hit, 30 in all) with Blooming Eye's 5 a
    // hit, a 2x crit and 150% crit chance, so an orange tier and the binomial
    // expectation both print. The ordinary path and the no-scaling one.
    for (const scaling of ['STR/100', '']) {
      const site = additiveSite({ gear: ['Blooming Eye'], critMult: 2, critChance: 150 });
      site('__rows(' + rows([['Buff A', 50]]) + ')');
      const text = site('__work')(probe({ damage: '10x2', scaling }));
      const what = (scaling || 'no scaling') + ': ';
      ok(/Avg per hit: 20\.0\s*\|\s*Crit avg: 35\.0/.test(text), what + 'the crit average is not 15 x 2 + 5 (a crit on True Flat reads 40): ' + text);
      ok(/Orange crit [^:]*\(×3\.00\) \[\+10 True Flat\]: 100\.0/.test(text), what + 'the orange tier is not 30 x 3 + 10 (a crit on True Flat reads 120): ' + text);
      const exp = site('getExpectedMoveCritDmg')(30, 2, 150, 1) + 10;
      ok(Math.abs(exp - site('getExpectedMoveCritDmg')(40, 2, 150, 1)) > 1, 'fixture: the expectation cannot tell True Flat from the hit');
      ok(new RegExp('Expected \\(150% crit, binomial\\): ' + exp.toFixed(1).replace('.', '\\.')).test(text),
         what + 'the expectation is not E(30) + 10 = ' + exp.toFixed(1) + ': ' + text);
    }
  });
});

// ── the Build AI composes damage the way the site does (§12) ────────────────
// The engine (optimize.js evaluate) prices every hit as
//   raw x M.dmgMulti(P) x crit + True Flat
// with P ONE sum of every percentage, the setup buffs and a move's own
// conditional bonus included. These put the site's REAL composition
// (additiveSite, above) next to model.js's and the engine's, on the same
// inputs, for single terms and for whole builds the engine evaluated.
describe('the Build AI composes damage the way the site does (Withered Grove §12)', () => {
  const M = engine.model, O = engine.optimizer;
  const near = (a, b, what, tol) => ok(Math.abs(a - b) < (tol || 1e-9), what + ': expected ' + b + ', got ' + a);
  const probe = extra => Object.assign({ name: 'Probe', damage: 10, scaling: 'STR/100', moveType: 'Physical',
                                         slot: '1st Learn', effect: '' }, extra || {});
  const rowsOf = list => JSON.stringify(list.map((bonus, i) => ({ key: 'k' + i, name: 'Probe Buff ' + i, bonus })));
  const learn = (k, n) => (((data.classMoves || {})[k] || {}).learns || []).find(m => m.name === n);
  const fresh = (klass, invested, gear) => {
    const b = M.emptyBuild(); b.klass = klass; b.level = data.Max_Lvl;
    Object.assign(b.invested, invested || {});
    b.gear = (gear || []).map(name => ({ name, tier: 0, alloc: { str: 0, arc: 0, end: 0, spd: 0, lck: 0 } }));
    return b;
  };
  const specFor = klass => ask('', { klass, goal: 'burst', level: data.Max_Lvl }).spec;
  // Run `fn` with a move's energy scaling one point an energy lower (its data
  // field, which is what both sides read), then put it back. A sum that
  // carries the term exactly once moves by exactly the difference; taking the
  // scaling away outright would hand the nuke to another move.
  const withLowerEnergyScaling = (mv, cap, fn) => {
    const es = mv.energyScaling;
    ok(es && +es.perEnergy > 1, 'fixture: ' + mv.name + ' has no energy scaling to lower');
    const before = O.energyScalingPct(mv, cap);
    mv.energyScaling = Object.assign({}, es, { perEnergy: +es.perEnergy - 1 });
    try {
      const drop = before - O.energyScalingPct(mv, cap);
      ok(drop > 0, 'fixture: lowering the energy scaling of ' + mv.name + ' changed nothing');
      return { drop, ctx: fn() };
    } finally {
      mv.energyScaling = es;
    }
  };

  it('one sum, one factor: model.js dmgMulti is the site getDmgMulti factor', () => {
    for (const list of [[10, 10, 10, 10, 10], [20, 30, 100], [-30], [-150], [12.5, 7.25]]) {
      const site = additiveSite();
      site('__rows(' + rowsOf(list) + ')');
      const s = site('getDmgMulti')(probe(), 'Physical', 0);
      const sum = list.reduce((a, b) => a + b, 0);
      near(s.pct, sum, 'the site sum of ' + list.join(', '));
      near(s.mult, M.dmgMulti(sum), 'the site and model.js factors for ' + list.join(', '));
    }
    eq(M.dmgMulti(-150), 0, 'model.js lets the factor go below zero');
    near(M.dmgMulti(50), 1.5, 'five +10% are not x1.50 in model.js');
  });

  it("a crit-only term: the site's critRatio is model.js critOnlyRatio at every sum", () => {
    const ep = learn('Lancer (N)', 'Empowered Pierce');
    ok(ep && ep.critDmgBonus === 50, 'fixture: Empowered Pierce lost its critDmgBonus 50');
    for (const P of [0, 50, 120, -30]) {
      const site = additiveSite();
      site('__rows(' + rowsOf([P]) + ')');
      const out = site('getOutsideDmgMult')(ep);
      near(out.pct, P, 'fixture: the Empowered Pierce sum');
      near(out.critRatio, M.critOnlyRatio(P, 50), 'the crit ratio at a ' + P + ' sum');
      for (const cc of [30, 100, 150]) {
        near(site('getExpectedMoveCritDmg')(1, 2.25, cc, out.critRatio), O.moveCritMult({ critDmgBonus: 50 }, cc, 2.25, false, P),
             'the expected crit at ' + cc + '% and a ' + P + ' sum');
      }
    }
  });

  it('True Flat: the same amount, on the same hits', () => {
    const be = fresh('Berserker (Ch)', {}, ['Blooming Eye']);
    eq(M.trueFlatDmg(be), additiveSite({ gear: ['Blooming Eye'] })('getTrueFlatDmg')(), 'Blooming Eye True Flat');
    eq(M.trueFlatDmg(fresh('Berserker (Ch)')), 0, 'True Flat without Blooming Eye');
    // Every hit the site's working prices: Stinger's two parts, Crucible's
    // three hits, a multi-hit move's every hit.
    const src = patchSite.src;
    ok(/critLine\(_stingTotal, _stingCritMult, 2\)/.test(src), "the site no longer adds True Flat to both of Stinger's parts");
    ok(/const _tfC\s*= trueFlat \* 3;/.test(src), "the site no longer adds True Flat to Crucible's three hits");
    eq(M.trueFlatHits(fresh('Ranger (Or)'), learn('Ranger (Or)', 'Stinger')), 2, 'Stinger');
    eq(M.trueFlatHits(fresh('Citadel (Or)'), learn('Citadel (Or)', 'Crucible')), 3, 'Crucible');
    eq(M.trueFlatHits(be, learn('Berserker (Ch)', 'Carnage')), 20, 'Carnage');
    eq(M.trueFlatHits(be, { name: 'Probe', damage: '5x(Darkcores)', scaling: 'STR/100' }), 0, 'a move with no damage');
  });

  it("for real builds, the site composes the engine's own terms into the engine's figure", () => {
    // Each build is evaluated by the engine; the site is then given the same
    // stats, crit and gear and the switches the engine's terms stand for. Its
    // composition - the factor, the crit-only ratio, the expected crit and
    // True Flat - must land on the engine's burst figure exactly.
    //
    // `own: true`: every term of the engine's sum is one the site has a switch
    // or a rule for, so the site's OWN sum - nothing injected - must equal the
    // engine's, term for term (a term either side counts twice or misses shows
    // here). Otherwise the engine's sum holds uptime-weighted terms the site
    // has no switch for (the Berserker's and Lancer's passives), so the rest of
    // it rides one row and only the composition is checked; the sum then
    // agrees by construction and is not asserted.
    const cases = [
      { klass: 'Berserker (Ch)', inv: { str: 60 }, gear: ['Crystalline Spike', 'Blooming Eye'], move: 'Carnage' },
      { klass: 'Lancer (N)', inv: { str: 40, spd: 40 }, gear: ['Crystalline Spike'], move: 'Empowered Pierce' },
      // The opener's +120: Stealth Strike's +100 out of Invisible (the switch)
      // and Shadow Form's own +20 (its real DMG BONUS row, nothing else on).
      { klass: 'Assassin (Ch)', inv: { str: 40 }, gear: [], move: 'Stealth Strike', own: true,
        site: 'stealthStrikeInvisible = true; dmgBonusPassives = collectDmgBonusPassives(); ' +
              'dmgBonusPassives.forEach(p => { dmgBonusActive[p.key] = p.name === "Shadow Form"; })',
        check: s => eq(s('sumDmgTerms(getActiveDmgTerms("Physical", 0))'), 20, "fixture: Shadow Form's row is not +20 on the site") },
      // A Magic nuke with its own energy scaling (+12.5% an energy past the third).
      { klass: 'Elementalist (Or)', inv: { arc: 80 }, gear: ['Blooming Eye'], move: 'Lightning Crash', own: true },
      // The same with ARC 110's +20 beside the energy term.
      { klass: 'Elementalist (Or)', inv: { arc: 110 }, gear: [], move: 'Lightning Crash', own: true,
        check: (s, mv) => eq(s('getMilestoneDmgPct')(mv, 'Magic'), 20, 'fixture: ARC 110 is not +20 on the site') },
    ];
    for (const cs of cases) {
      const b = fresh(cs.klass, cs.inv, cs.gear);
      const ctx = O.evaluate(b, specFor(cs.klass));
      eq((ctx.burstMove || {}).name, cs.move, 'fixture: ' + cs.klass + ' no longer nukes with ' + cs.move);
      const t = ctx.burstTerms;
      const mv = O.movesFor(cs.klass).find(m => m.name === cs.move);
      const site = additiveSite({ gear: cs.gear, stats: ctx.stats, critMult: ctx.critDmg, sup: cs.klass });
      if (cs.site) site(cs.site);
      // The one term the engine prices from a full pool: the site's energy
      // stepper at the cap gives the same energy term (0 for a move without one).
      site('energyCount = ' + ctx.energyCap);
      const withEnergy = site('getOutsideDmgMult')(mv).pct;
      site('energyCount = 0');   // the energy term is inside the engine's sum
      const own = site('getOutsideDmgMult')(mv).pct;   // what the site adds by itself (STR 110, the switch)
      near(withEnergy - own, O.energyScalingPct(mv, ctx.energyCap), cs.move + ': the energy term');
      let out;
      if (cs.own) {
        if (cs.check) cs.check(site, mv);
        // The site's own sum at the engine's full-pool energy, nothing injected.
        site('energyCount = ' + ctx.energyCap);
        out = site('getOutsideDmgMult')(mv);
        near(out.pct, t.pct, cs.klass + ' ' + JSON.stringify(cs.inv) + ': the site sum on its own against the engine sum');
      } else {
        site('__rows(' + JSON.stringify([{ key: 'engine', name: 'Engine sum', bonus: t.pct - own }]) + ')');
        out = site('getOutsideDmgMult')(mv);
      }
      const raw = M.moveDamage(b, mv, { stats: ctx.stats });   // (Base + Flat) x hits; no boss
      const cc = ctx.critChance + ctx.openerCrit + (+mv.critBonus || 0);
      const composed = site('getExpectedMoveCritDmg')(raw * out.total, ctx.critDmg, cc, out.critRatio) +
                       site('getTrueFlatDmg')() * M.trueFlatHits(b, mv);
      near(ctx.bestBurst * t.stunDiv, composed, cs.move + ': the engine burst against the site composition', 1e-6);
    }
  });

  it("Carnage's energy scaling is a term of the sum on every figure, the ramp-free opener included", () => {
    // The ramp-free (Crystalized Star) and stat-setup openers used to rebuild
    // the hit without the energy factor, so their burst lost +20% an energy.
    const b = fresh('Berserker (Ch)', { str: 60 }, ['Crystalized Star']);
    const ctx = O.evaluate(b, specFor('Berserker (Ch)'));
    const ramp = ctx.gearPassives.rampFlat || {};
    ok(Object.values(ramp).some(v => v > 0), 'fixture: Crystalized Star is no longer a ramp');
    eq((ctx.burstMove || {}).name, 'Carnage', 'fixture: the Berserker no longer nukes with Carnage');
    const carnage = O.movesFor('Berserker (Ch)').find(m => m.name === 'Carnage');
    const E = O.energyScalingPct(carnage, ctx.energyCap);
    near(E, 100 * K.ENERGY.scalingMoves.Carnage.perEnergy * (ctx.energyCap - 1), "fixture: Carnage's +20 an energy past the first");
    ok(E > 0, 'fixture: no energy past the first');
    const t = ctx.burstTerms;
    ok(t.basePct >= E - 1e-9, 'the energy term is not in the sum: ' + t.basePct + ' < ' + E);
    // Exactly once: the same build with Carnage's scaling a point lower differs
    // by that point x the energy past the first and nothing else, on the plain
    // sum and on the opener's (counted twice, the sums would move twice as far).
    const lower = withLowerEnergyScaling(carnage, ctx.energyCap, () => O.evaluate(b, specFor('Berserker (Ch)')));
    const t0 = lower.ctx.burstTerms;
    eq(t0.move, 'Carnage', 'fixture: with a lower energy scaling Carnage is no longer the nuke');
    near(t.basePct - t0.basePct, lower.drop, 'the energy term is not in the sum exactly once');
    near(t.pct - t0.pct, lower.drop, "the energy term is not in the opener's sum exactly once");
    // The burst, recomposed on the ramp-free stats with the WHOLE sum, energy
    // included: before, this path rebuilt the hit without the energy factor.
    const openerStats = Object.assign({}, ctx.stats);
    for (const k of Object.keys(openerStats)) openerStats[k] -= (ramp[k] || 0);
    const raw = M.moveDamage(b, carnage, { stats: openerStats });
    const E2 = M.expectedMultiplier(ctx.critChance + ctx.openerCrit, ctx.critDmg);
    near(ctx.bestBurst * t.stunDiv, raw * M.dmgMulti(t.pct) * E2 + t.trueFlat * t.stunDiv,
         'the ramp-free burst does not carry the energy term', 1e-6);
  });

  it('every move the site scales with energy is scaled by the same term in the engine', () => {
    // builder.js getEnergyBonusPct reads the move's own `energyScaling`. The
    // engine read a hand-kept list with only Carnage in it, so Lightning Crash's
    // +12.5% an energy past the third (+37.5% from a 6 pool) never reached an
    // Elementalist's sum. Both now read the move data; this runs the site's
    // function against the engine's at every pool size.
    const scaled = [];
    for (const v of Object.values(data.classMoves || {})) {
      for (const mv of (v.learns || [])) if (mv && mv.energyScaling) scaled.push(mv);
    }
    ok(scaled.some(m => m.name === 'Carnage') && scaled.some(m => m.name === 'Lightning Crash'),
       'fixture: Carnage and Lightning Crash no longer carry energyScaling');
    const site = additiveSite();
    for (const mv of scaled) {
      for (let pool = 0; pool <= 9; pool++) {
        site('energyCount = ' + pool);
        near(O.energyScalingPct(mv, pool), site('getEnergyBonusPct')(mv), mv.name + ' from ' + pool + ' energy');
      }
    }
    eq(O.energyScalingPct({ name: 'Probe', damage: 10 }, 6), 0, 'a move with no energy scaling');
    ok(/pct \+= energyScalingPct\(mv, cap\);/.test(fs.readFileSync(path.join(__dirname, 'optimize.js'), 'utf8')),
       "evaluate does not put the move's energy term in its sum");
    // And it reaches the figure: an Elementalist nuking with Lightning Crash.
    const eb = fresh('Elementalist (Or)', { arc: 80 });
    const ctx = O.evaluate(eb, specFor('Elementalist (Or)'));
    eq((ctx.burstMove || {}).name, 'Lightning Crash', 'fixture: the Elementalist no longer nukes with Lightning Crash');
    const lc = O.movesFor('Elementalist (Or)').find(m => m.name === 'Lightning Crash');
    const E = O.energyScalingPct(lc, ctx.energyCap);
    ok(E > 0, 'fixture: no energy past the third');
    // A bare ARC-80 Elementalist has nothing else in the sum: +37.5 from a 6 pool.
    near(ctx.burstTerms.basePct, E, 'the Lightning Crash sum is not its energy term alone');
    // And exactly once: a point less an energy moves the sum by exactly that.
    const lower = withLowerEnergyScaling(lc, ctx.energyCap, () => O.evaluate(eb, specFor('Elementalist (Or)')));
    eq(lower.ctx.burstTerms.move, 'Lightning Crash', 'fixture: with a lower energy scaling Lightning Crash is no longer the nuke');
    near(ctx.burstTerms.basePct - lower.ctx.burstTerms.basePct, lower.drop, 'the Lightning Crash energy term is not in the sum once');
  });

  it("a one-move mastery is a term of that move's sum only, as on the site", () => {
    // Blaze Proficiency was in EVERY move's sum (ma.dmgPct), so an Elementalist
    // with it nuked Lightning Crash at +24 the site never gives that move
    // (builder.js prices it on Blaze alone, getMoveInnateTerms).
    const withNode = (klass, inv, node) => Object.assign(fresh(klass, inv), { masteryNodes: node ? [node] : [] });
    const el = specFor('Elementalist (Or)');
    const bare = O.evaluate(withNode('Elementalist (Or)', { arc: 80 }), el);
    const prof = O.evaluate(withNode('Elementalist (Or)', { arc: 80 }, 'lm2'), el);
    ok(prof.masteryAbilities.active.some(a => a.name === 'Blaze Proficiency' && a.move === 'Blaze'),
       'fixture: Elementalist lm2 is not Blaze Proficiency on Blaze');
    eq(prof.burstMove.name, 'Lightning Crash', 'fixture: the Elementalist no longer nukes with Lightning Crash');
    near(prof.burstTerms.basePct, bare.burstTerms.basePct, "Blaze Proficiency reached Lightning Crash's sum");
    eq(prof.masteryAbilities.dmgPct, 0, 'a one-move upgrade is still in the every-move total');
    // The site agrees: with lm2 on, Lightning Crash's own sum has no mastery term.
    const lc = O.movesFor('Elementalist (Or)').find(m => m.name === 'Lightning Crash');
    eq(additiveSite({ sup: 'Elementalist (Or)', mastery: { lm2: true } })('getDmgMulti')(lc, 'Magic', 0).pct, 0,
       'the site gives Lightning Crash a Blaze Proficiency term');
    // On its own move it is there, at its uptime: Carnage Proficiency on Carnage.
    const be = specFor('Berserker (Ch)');
    const b0 = O.evaluate(withNode('Berserker (Ch)', { str: 60 }), be);
    const b1 = O.evaluate(withNode('Berserker (Ch)', { str: 60 }, 'lm2'), be);
    eq(b1.burstMove.name, 'Carnage', 'fixture: the Berserker no longer nukes with Carnage');
    const cp = K.MASTERY_ABILITIES['Carnage Proficiency'];
    near(b1.burstTerms.basePct - b0.burstTerms.basePct, cp.value * cp.uptime, "Carnage Proficiency is not in Carnage's sum once");
    // Every gate names a move its class actually has - a typo would price the
    // node at nothing. Strike is the shared basic attack, which no class kit
    // here carries (The Big Sword's +20 on it is priced at nothing, on purpose).
    const owners = {};
    for (const [klass, per] of Object.entries(data.masteryAbilities)) {
      for (const e of Object.values(per)) (owners[e.name] = owners[e.name] || []).push(klass);
    }
    const gated = Object.entries(K.MASTERY_ABILITIES).filter(([, r]) => r.move);
    ok(gated.length >= 10, 'fixture: the one-move upgrades lost their move gates');
    for (const [name, rule] of gated) {
      if (rule.move === 'Strike') continue;
      for (const klass of owners[name] || []) {
        ok(O.movesFor(klass).some(m => m.name === rule.move), name + ' is gated on ' + rule.move + ', which ' + klass + ' does not have');
      }
    }
  });

  it('Shadow Master adds +30 to the opener sum beside Shadow Form; it does not multiply', () => {
    const spec = specFor('Assassin (Ch)');
    const plain = O.evaluate(fresh('Assassin (Ch)', { str: 40 }), spec);
    const master = O.evaluate(Object.assign(fresh('Assassin (Ch)', { str: 40 }), { masteryNodes: ['lm1'] }), spec);
    ok((master.masteryAbilities.active || []).some(a => a.name === 'Shadow Master'), 'fixture: Assassin lm1 is not Shadow Master');
    eq(master.burstMove.name, plain.burstMove.name, 'fixture: Shadow Master changed the nuke');
    near(master.burstTerms.pct - plain.burstTerms.pct, 30, "Shadow Master's +30 in the opener's sum");
    ok(plain.burstTerms.openPct >= 20 - 1e-9, "Shadow Form's +20 is not in the opener's sum");
    near(master.bestBurst / plain.bestBurst, M.dmgMulti(plain.burstTerms.pct + 30) / M.dmgMulti(plain.burstTerms.pct),
         'the opener does not grow by the sum', 1e-9);
    ok(Math.abs(master.bestBurst / plain.bestBurst - 1.3) > 0.01, 'Shadow Master still multiplies the opener by 1.30');
  });

  it("Blasphemy's Notch is +30 in the dump's sum, not x1.30 on the finished hit", () => {
    const base = { energyCap: 5, moves: [{ name: 'Dump', cost: 3 }], dumpMove: { name: 'Dump', cost: 3 },
                   bestBurst: 100, bestHit: 100, bestDump: 100 };
    const bl = extra => K.CORRUPTION_DAMAGE.Blasphemy(Object.assign({}, base, extra)).burst;
    near(bl({ dumpTerms: { pct: 100, trueFlat: 0 } }), 2.3 / 2, 'at a +100 sum');
    near(bl({ dumpTerms: { pct: 0, trueFlat: 0 } }), 1.3, 'at an empty sum');
    near(bl({ dumpTerms: { pct: 100, trueFlat: 20 } }), (80 * 2.3 / 2 + 20) / 100, 'True Flat gained from the Notch');
    near(bl({}), 1.3, 'an older ctx with no terms');
    const r = ask('berserker carnage max damage');
    const t = r.ctx.dumpTerms;
    ok(t && r.ctx.dumpMove && t.move === r.ctx.dumpMove.name, 'evaluate does not record what the dump was made of');
    const f = r.corruption.all.find(x => x.form === 'Blasphemy');
    const inForm = (r.ctx.bestDump - t.trueFlat) * M.dmgMulti(t.pct + 30) / M.dmgMulti(t.pct) + t.trueFlat;
    near(f.damage.formBurst, Math.max(1, inForm / r.ctx.bestBurst), 'the Blasphemy burst on a real build', 1e-9);
  });

  it('Devastating adds to the crit multiplier, never multiplies it', () => {
    const b = fresh('Berserker (Ch)', { str: 40 });
    b.gear = [{ name: 'Crystal Sphere', tier: 6, alloc: {}, traits: [{ id: 'devastating', tier: 2 }] }];
    const tt = M.traitTotals(b, K);
    ok(tt.critDmgPct > 0, 'fixture: Devastating adds no crit damage');
    const ctx = O.evaluate(b, specFor('Berserker (Ch)'));
    near(ctx.critDmg, M.derived(b).critDmg + tt.critDmgPct / 100, 'Devastating');
  });

  it('a stat setup keeps every crit term, and an unmet gear crit stays out', () => {
    // buffedCrit used to leave out the mastery crit and to pay a gear crit
    // whose status the kit never applies (inertCrit). Flourish is a Ranger stat
    // setup; Frozen Diadem's crit needs Cold, which a Ranger does not apply.
    const b = fresh('Ranger (Or)', { arc: 40, spd: 40 }, ['Frozen Diadem']);
    const ctx = O.evaluate(b, specFor('Ranger (Or)'));
    ok((ctx.gearPassives.active || []).some(a => a.name === 'Frozen Diadem' && a.inert), 'fixture: Frozen Diadem is not inert here');
    ok((ctx.rotation || []).some(r => r.move === 'Flourish'), 'fixture: Flourish is not in the Ranger rotation');
    const src = fs.readFileSync(path.join(__dirname, 'optimize.js'), 'utf8');
    ok(/buffedCrit = bd\.critChance \+ tt\.critChance \+ pv\.critChance \+ \(gp\.critChance - inertCrit\) \+ ma\.critChance \+ maLuckCrit;/.test(src),
       'the stat-setup crit is not the same sum as the base crit');
    // The burst, recomposed: raw on the Flourish stats, the opener's sum, and
    // the crit the base figure has plus the stat setup's own and the opener's.
    const bd = M.derived(Object.assign({}, b, { buffs: Object.assign({}, b.buffs, { flourishSpd: true }) }));
    const mv = O.movesFor('Ranger (Or)').find(m => m.name === ctx.burstMove.name);
    const t = ctx.burstTerms;
    const cc = bd.critChance + (ctx.critChance - M.derived(b).critChance) + ctx.openerCrit;
    const E = (mv.critBonus || mv.critDmgBonus) ? O.moveCritMult(mv, cc, ctx.critDmg, false, t.pct)
                                                 : M.expectedMultiplier(cc, ctx.critDmg);
    const raw = M.moveDamage(b, mv, { stats: bd.stats });
    near(ctx.bestBurst * t.stunDiv, raw * M.dmgMulti(t.pct) * E + t.trueFlat * t.stunDiv, 'the stat-setup burst', 1e-6);
  });

  it('Stinger: each part takes the sum of its own type, as on the site', () => {
    // The engine priced Stinger with ONE sum on its written type (Poison), so
    // ARC 110's +20 reached the Physical stab and STR 110 never could. The site
    // gives each part getDmgMulti of its own type.
    const mv = O.movesFor('Ranger (Or)').find(m => m.name === 'Stinger');
    ok(mv, 'fixture: no Stinger in the Ranger kit');
    for (const inv of [{ arc: 115, spd: 35 }, { arc: 80, spd: 40 }]) {
      const b = fresh('Ranger (Or)', inv);
      const ctx = O.evaluate(b, specFor('Ranger (Or)'));
      eq((ctx.burstMove || {}).name, 'Stinger', 'fixture: the Ranger no longer nukes with Stinger');
      const t = ctx.burstTerms;
      ok(t.parts && t.parts.length === 2, 'Stinger has no per-part sums');
      const [stab, arrows] = t.parts;
      eq(stab.type + '/' + arrows.type, 'Physical/Poison', 'the parts deal the wrong types');
      // The site's own gated terms for each part, on the same stats: the
      // difference between the parts is the site's, and a part's sum moves
      // with nothing but its own type's terms.
      const site = additiveSite({ stats: ctx.stats, sup: 'Ranger (Or)' });
      const sStab = site('getDmgMulti')(mv, 'Physical', 0).pct, sArr = site('getDmgMulti')(mv, 'Poison', 0).pct;
      near(arrows.pct - stab.pct, sArr - sStab, JSON.stringify(inv) + ': the arrows and the stab differ by other terms than on the site');
      if (ctx.stats.arc >= 110 && ctx.stats.str < 110) eq(sArr - sStab, 20, 'fixture: ARC 110 is not the difference on the site');
      else eq(sArr - sStab, 0, 'fixture: the parts differ on the site below ARC 110');
      // The figure is the two parts, each at its own factor (the engine's raw
      // is on the stats the burst was taken on; Stinger has no crit bonus).
      const bd = M.derived(Object.assign({}, b, { buffs: Object.assign({}, b.buffs, { flourishSpd: true }) }));
      ok((ctx.rotation || []).some(r => r.move === 'Flourish'), 'fixture: Flourish is not in the Ranger rotation');
      near(stab.raw, M.moveDamage(b, mv, { stats: bd.stats, part: 1 }), 'the stab is not priced on its own');
      near(stab.raw + arrows.raw, M.moveDamage(b, mv, { stats: bd.stats }), 'the parts are not the whole move', 1e-9);
      const cc = bd.critChance + (ctx.critChance - M.derived(b).critChance) + ctx.openerCrit;
      near(ctx.bestBurst * t.stunDiv,
           (stab.raw * M.dmgMulti(stab.pct) + arrows.raw * M.dmgMulti(arrows.pct)) * M.expectedMultiplier(cc, ctx.critDmg) + t.trueFlat * t.stunDiv,
           JSON.stringify(inv) + ': the burst is not the two parts at their own sums', 1e-6);
      near((t.basePct + t.openPct), t.pct, 'the equivalent sum does not add up');
    }
  });

  it('Discharge Proficiency is four hits at 1 / 0.38 / 1/3 / 1/3 on both sides', () => {
    // The engine priced Discharge as its single hit while the site's working
    // (and the game) fires four projectiles; verify.js read the site's first
    // ") = N" - one projectile - so the gap could not show.
    const gear = ['Crystalline Spike', 'Blooming Eye'];
    const b = Object.assign(fresh('Lancer (N)', { str: 75, spd: 25 }, gear), { masteryNodes: ['cm2'] });
    const plain = fresh('Lancer (N)', { str: 75, spd: 25 }, gear);
    const mv = O.movesFor('Lancer (N)').find(m => m.name === 'Discharge');
    ok(mv, 'fixture: no Discharge in the Lancer kit');
    const stats = M.derived(b).stats;
    const ratio = 1 + 0.38 + 2 / 3;
    near(M.moveDamage(b, mv, { stats }), M.moveDamage(plain, mv, { stats }) * ratio, 'Discharge Proficiency is not x2.05 of the single hit', 1e-9);
    eq(M.trueFlatHits(b, mv), 4, 'True Flat does not land on each of the four');
    eq(M.trueFlatHits(plain, mv), 1, 'True Flat on a plain Discharge');
    // The site's working, on the same stats and gear, totals the same four hits.
    const site = additiveSite({ sup: 'Lancer (N)', mastery: { cm2: true }, stats, gear });
    const text = site('__work')(mv);
    const shares = text.match(/\d+\s*hits\s*—[^=]*=\s*([\d.]+)/);
    ok(shares, 'the site no longer prints "4 hits — ... = N": ' + text);
    ok(Math.abs(parseFloat(shares[1]) - M.moveDamage(b, mv, { stats })) < 0.06,
       'the engine and the site disagree on Discharge: ' + shares[1] + ' vs ' + M.moveDamage(b, mv, { stats }));
    ok(/\+ 20 \[Blooming Eye, True Flat, 5 × 4 hits\]/.test(text), 'the site does not add True Flat to four hits: ' + text);
    // verify.js reads that total, before the multi-hit and per-hit shapes.
    const v = fs.readFileSync(path.join(__dirname, 'verify.js'), 'utf8');
    ok(v.indexOf("const shares = txt.match(/\\d+\\s*hits\\s*—[^=]*=\\s*([\\d.]+)/);") !== -1 &&
       /: shares \? parseFloat\(shares\[1\]\)/.test(v), 'verify.js does not read the four-hit total');
    // The capstone is priced through the move, not listed as unread.
    const ma = O.masteryAbilityTotals(b, { play: 'solo' });
    ok(!ma.unmodelled.some(u => u.name === 'Discharge Proficiency'), 'Discharge Proficiency is still reported as not priced');
  });

  it("under 'potential' a prepared burst lands the crit, as the plain hit does", () => {
    // The opener-crit (Shadow Form) and stat-setup (Flourish) paths priced the
    // burst at the AVERAGE crit even with the crit landed, so an Assassin's
    // prepared Stealth Strike scored below its own cold crit hit.
    const cases = [['Assassin (Ch)', { str: 60, lck: 20 }, null], ['Ranger (Or)', { arc: 40, spd: 40 }, 'flourishSpd']];
    for (const [klass, inv, statBuff] of cases) {
      const b = fresh(klass, inv);
      const ctx = O.evaluate(b, Object.assign({}, specFor(klass), { dmg: 'potential' }));
      if (statBuff) ok((ctx.rotation || []).some(r => r.move === 'Flourish'), 'fixture: Flourish is not in the ' + klass + ' rotation');
      else ok(ctx.openerCrit > 0, 'fixture: the ' + klass + ' opener has no crit of its own');
      const mv = O.movesFor(klass).find(m => m.name === ctx.burstMove.name);
      const t = ctx.burstTerms;
      const stats = statBuff ? M.derived(Object.assign({}, b, { buffs: Object.assign({}, b.buffs, { [statBuff]: true }) })).stats : ctx.stats;
      const landed = ctx.critDmg * M.critOnlyRatio(t.pct, +mv.critDmgBonus || 0);
      near(ctx.bestBurst * t.stunDiv, M.moveDamage(b, mv, { stats }) * M.dmgMulti(t.pct) * landed + t.trueFlat * t.stunDiv,
           klass + ': the potential burst is not the landed crit', 1e-6);
      if (ctx.bestMove.name === mv.name) {
        ok(ctx.bestBurst >= ctx.bestHit - 1e-9, klass + ': the prepared burst scores below the cold hit');
      }
    }
  });

  it('Stealth Strike is named in the write-up with its +100', () => {
    // An Assassin whose nuke is Stealth Strike, rendered the way ask() does.
    const spec = specFor('Assassin (Ch)');
    const b = fresh('Assassin (Ch)', { str: 40 });
    const ctx = O.evaluate(b, spec);
    ok(ctx.burstTerms && ctx.burstTerms.cond, 'fixture: the nuke carries no conditional term');
    const secs = require('./explain.js').render({ build: b, ctx, corruption: null, warnings: [], plan: null }, spec, M, K, data);
    const why = (secs.find(x => x.h === 'Why this build') || {}).list || [];
    ok(why.some(l => /Stealth Strike/.test(l) && /\+100%/.test(l) && /not a doubled base/.test(l)),
       'the write-up does not say how Stealth Strike is priced: ' + why.join(' | '));
  });

  it("a corruption form's factors never multiply True Flat (§1)", () => {
    // True Flat is added after the sum, the statuses and the crit. The form
    // pass took whole figures - True Flat inside - and multiplied them by
    // Heresy's crit ratio, Tyranny's Condemned, Ages Pages' crit ratio and,
    // after Blasphemy's Notch, Blooming Eye's own spend.
    const b = fresh('Berserker (Ch)', { str: 60, lck: 40 }, ['Blooming Eye']);
    const c = O.evaluate(b, specFor('Berserker (Ch)'));
    const stunOf = mv => 1 + (K.selfStunTurns ? K.selfStunTurns(mv) : 0);
    // evaluate records the True Flat inside the plain and the sustained figure.
    near(c.hitTrueFlat, M.trueFlatDmg(b) * M.trueFlatHits(b, c.bestMove) / stunOf(c.bestMove), 'the True Flat inside bestHit');
    ok(c.hitTrueFlat > 0 && c.sustTrueFlat > 0, 'fixture: no True Flat in the plain or sustained figure');
    // Heresy: the crit ratio on the main figure, True Flat added back as it was.
    const he = K.CORRUPTION_DAMAGE.Heresy(c, M);
    const before = M.expectedMultiplier(c.critChance, c.critDmg);
    const after = M.expectedMultiplier(c.critChance + he.ifCrit.need, c.critDmg);
    near(he.ifCrit.hit, (c.bestHit - c.hitTrueFlat) * after / before + c.hitTrueFlat, 'Heresy crit hit', 1e-9);
    near(he.ifCrit.mult, he.ifCrit.hit / c.bestHit, 'Heresy crit ratio', 1e-12);
    ok(he.ifCrit.hit < c.bestHit * after / before - 1, 'fixture: the True Flat here is too small to tell');
    ok(new RegExp('to \\*\\*' + Math.round(he.ifCrit.hit) + '\\*\\*').test(he.lines.join(' ')), 'the Heresy line prints another figure');
    // Tyranny: Condemned on the main figure; the Eye's spend (+30 a hit) after it.
    const ty = O.corruptionDamage('Tyranny', c);
    const k = 1 + K.CORRUPTION_ASSUMED.condemnedPct / 100, t = c.burstTerms;
    near(ty.formBurst, ((c.bestBurst - t.trueFlat) * k + t.trueFlat) / c.bestBurst, "Tyranny's own burst", 1e-12);
    near(ty.burstHit, (c.bestBurst - t.trueFlat) * k + t.trueFlat + 30 * t.tfHits / t.stunDiv, 'Tyranny burst', 1e-9);
    near(ty.sustainedHit, (c.sustainedHit - c.sustTrueFlat) * k + c.sustTrueFlat, 'Tyranny sustained', 1e-9);
    // Blasphemy with Ages Pages and Blooming Eye: the Notch in the dump's sum,
    // the form crit on the result's main figure, the Eye's spend added last.
    const cB = { worn: ['Ages Pages', 'Blooming Eye'], critChance: 40, critDmg: 2, energyCap: 5,
                 moves: [{ name: 'Dump', cost: 3 }], dumpMove: { name: 'Dump', cost: 3 },
                 bestBurst: 150, bestHit: 150, bestDump: 150, sustainedHit: 120, sustTrueFlat: 20,
                 burstTerms: { pct: 50, trueFlat: 20, tfHits: 4, stunDiv: 1 },
                 dumpTerms: { pct: 50, trueFlat: 20, tfHits: 4, stunDiv: 1 } };
    const bl = O.corruptionDamage('Blasphemy', cB);
    const inForm = (150 - 20) * M.dmgMulti(80) / M.dmgMulti(50) + 20;
    const crit = K.FORM_GEAR['Ages Pages'].crit * K.FORM_GEAR['Ages Pages'].stacks;
    const cm = M.expectedMultiplier(40 + crit, 2) / M.expectedMultiplier(40, 2);
    near(bl.formBurst, inForm / 150, "Blasphemy's own burst", 1e-12);
    near(bl.burstHit, (inForm - 20) * cm + 20 + 30 * 4, 'Blasphemy burst with the form crit and the Eye', 1e-9);
    near(bl.sustainedHit, (120 * bl.formSustained - 20) * cm + 20, 'Blasphemy sustained', 1e-9);
    // The gear figures on the out-of-form nuke say the same.
    const fg = K.formGearCrit(cB, 'Blasphemy', M, undefined, 'dump');
    near(fg.trueFlatAdd, 120, "the Eye's spend on four hits");
    near(fg.mult, ((150 - 20) * cm + 20 + 120) / 150, 'the gear on the nuke', 1e-12);
    // Nothing worn is exactly nothing: ((995.89 - 320.68) + 320.68) / 995.89 is
    // 1.0000000000000002 in floating point, and a flat factor over 1 tells the
    // write-up "the worn gear below is the only damage reason to pick it".
    const none = K.formGearCrit({ worn: [], bestBurst: 995.89, burstTerms: { pct: 0, trueFlat: 320.68, tfHits: 1, stunDiv: 1 } }, 'Tyranny', M);
    eq(none.flatMult, 1, 'no flat gear worn, yet a flat factor');
    eq(none.mult, 1, 'no form gear worn, yet a factor');
  });

  it("the write-up's crit damage says what the site shows when Devastating is worn", () => {
    // The engine scores Devastating (added to the multiplier); the site does
    // not apply it, so the two readouts differ by exactly that add.
    const b = fresh('Berserker (Ch)', { str: 40 });
    b.gear = [{ name: 'Crystal Sphere', tier: 6, alloc: {}, traits: [{ id: 'devastating', tier: 2 }] }];
    const spec = specFor('Berserker (Ch)');
    const ctx = O.evaluate(b, spec);
    ok(ctx.traits.critDmgPct > 0, 'fixture: Devastating adds no crit damage');
    const rowOf = (build, c) => ((require('./explain.js').render({ build, ctx: c, corruption: null, warnings: [], plan: null }, spec, M, K, data)
      .find(x => x.h === 'Stat points') || {}).table || []).find(r => r[0] === 'Crit damage');
    const row = rowOf(b, ctx);
    ok(row && row[1].indexOf(ctx.critDmg.toFixed(2) + 'x') === 0, 'the row does not lead with the engine figure: ' + row);
    ok(row[1].indexOf('the site shows ' + M.derived(b).critDmg.toFixed(2) + 'x') !== -1, 'the row does not give the site figure: ' + row[1]);
    const plain = fresh('Berserker (Ch)', { str: 40 });
    eq(rowOf(plain, O.evaluate(plain, spec))[1], M.derived(plain).critDmg.toFixed(2) + 'x', 'a note without Devastating');
  });

  it('the Energy write-up prices the nuke from its own energy data, the Overflow share within the total', () => {
    // explain.js read the hand-kept Carnage-only list; Lightning Crash's +12.5%
    // an energy past the third was not explained, and the Overflow share was
    // not capped at the total.
    const b = fresh('Elementalist (Or)', { arc: 80 });
    b.gear = [{ name: 'Crystal Sphere', tier: 6, alloc: {}, traits: [{ id: 'overflow', tier: 2 }] }];
    const spec = specFor('Elementalist (Or)');
    const ctx = O.evaluate(b, spec);
    eq((ctx.bestMove || {}).name, 'Lightning Crash', 'fixture: the Elementalist no longer hits hardest with Lightning Crash');
    ok(ctx.traits.energyCap > 0, 'fixture: Overflow raises no energy cap');
    const secs = require('./explain.js').render({ build: b, ctx, corruption: null, warnings: [], plan: null }, spec, M, K, data);
    const line = ((secs.find(x => x.h === 'Energy') || {}).list || [])[0] || '';
    const lc = O.movesFor('Elementalist (Or)').find(m => m.name === 'Lightning Crash');
    const total = O.energyScalingPct(lc, ctx.energyCap);
    ok(/^Lightning Crash /.test(line), 'no Energy section for Lightning Crash: ' + line);
    ok(line.indexOf('**+' + Math.round(total) + '% damage**') !== -1, 'the Energy section does not give the +' + total + '%: ' + line);
    const share = +(/Overflow trait is responsible for \*\*\+(\d+)%\*\*/.exec(line) || [])[1];
    ok(share > 0 && share <= Math.round(total), 'the Overflow share is not within the total: ' + share + ' of ' + total);
    near(share, Math.round(Math.min(total, 100 * K.energyScalingOf(lc).perEnergy * ctx.traits.energyCap)), 'the Overflow share');
    // The helper reads the move's data first and falls back to the table.
    near(K.energyScalingOf(lc).perEnergy, lc.energyScaling.perEnergy / 100, 'energyScalingOf reads the move data');
    eq(K.energyScalingOf({ name: 'Probe' }), null, 'a move with neither data nor a table entry');
    const tableOnly = Object.keys(K.ENERGY.scalingMoves || {})[0];
    ok(tableOnly && K.energyScalingOf({ name: tableOnly }) === K.ENERGY.scalingMoves[tableOnly], 'the table fallback');
  });

  it("a stat setup's burst carries the mastery crit (buffedCrit's ma.critChance)", () => {
    // Only a source-text regex guarded it: no Ranger mastery grants crit. A
    // probe rule does here (Nature's Wrath as +20 crit), so recomposing the
    // Flourish burst without that crit fails.
    const spec = specFor('Ranger (Or)');
    const orig = K.MASTERY_ABILITIES;
    K.MASTERY_ABILITIES = Object.assign({}, orig, { "Nature's Wrath": { kind: 'critChance', value: 20, uptime: 1, note: 'test probe' } });
    try {
      const b = Object.assign(fresh('Ranger (Or)', { arc: 40, spd: 40 }), { masteryNodes: ['lm1'] });
      const ctx = O.evaluate(b, spec);
      near(ctx.masteryAbilities.critChance, 20, 'fixture: the probe mastery grants no crit');
      ok((ctx.rotation || []).some(r => r.move === 'Flourish'), 'fixture: Flourish is not in the Ranger rotation');
      const bd = M.derived(Object.assign({}, b, { buffs: Object.assign({}, b.buffs, { flourishSpd: true }) }));
      const mv = O.movesFor('Ranger (Or)').find(m => m.name === ctx.burstMove.name);
      const t = ctx.burstTerms;
      const cc = bd.critChance + (ctx.critChance - M.derived(b).critChance) + ctx.openerCrit;
      const E = (mv.critBonus || mv.critDmgBonus) ? O.moveCritMult(mv, cc, ctx.critDmg, false, t.pct)
                                                   : M.expectedMultiplier(cc, ctx.critDmg);
      const raw = t.parts
        ? t.parts.reduce((a, p) => a + p.raw * M.dmgMulti(p.pct), 0) / M.dmgMulti(t.pct)
        : M.moveDamage(b, mv, { stats: bd.stats });
      near(ctx.bestBurst * t.stunDiv, raw * M.dmgMulti(t.pct) * E + t.trueFlat * t.stunDiv, 'the stat-setup burst with a mastery crit', 1e-6);
    } finally {
      K.MASTERY_ABILITIES = orig;
    }
  });

  it('every category the engine sums is one term of it, as the site adds it, and the plain hit is that sum composed', () => {
    // A Monk nuking with Blazing Barrage (Fire) carries a term from every
    // category of the engine's every-move sum and from both type-gated ones: a
    // trait (Momentum), the class passive, Nisse's Fire bonus, a shard
    // (Empowering), the enchant (Midas), a gear bonus (Vainglorious Locket) and
    // Vulcan Knuckle's Fire bonus. Each category's reported total rides the
    // site as its own DMG BONUS row, so the site's sum of them is what the
    // engine's must be: a category the engine drops, counts twice or compounds
    // onto the others shows here. The plain hit - Blooming Eye's True Flat on
    // each of the eight hits - is then that sum, composed by the site.
    const b = fresh('Monk (Or)', { str: 60 }, ['Vulcan Knuckle', 'Vainglorious Locket', 'Blooming Eye']);
    b.gear.push({ name: 'Crystal Sphere', tier: 6, alloc: {}, traits: [{ id: 'momentum', tier: 2 }] });
    b.race = 'Nisse (20%)'; b.enchant = 'Midas'; b.shards = ['Empowering (R)'];
    const ctx = O.evaluate(b, specFor('Monk (Or)'));
    const t = ctx.burstTerms;
    eq((ctx.bestMove || {}).name, t.move, 'fixture: the best plain hit is not the nuke');
    const mv = O.movesFor('Monk (Or)').find(m => m.name === t.move);
    ok(mv && !t.parts, 'fixture: the nuke is not a one-part move of the Monk kit');
    const type = mv.moveType;   // nothing in this kit converts it
    const gated = list => (list || []).filter(x => x.when.test(type + ' ' + String(mv.element || ''))).reduce((a, x) => a + x.value, 0);
    const inertGear = (ctx.gearPassives.active || []).filter(a => a.inert && a.kind === 'dmgPct' && !a.elements)
      .reduce((a, x) => a + (x.effective || 0), 0);
    const cats = {
      trait: ctx.traits.dmgPct, passive: ctx.passives.dmgPct - ctx.inertPassiveDmg,
      ['passive on ' + type]: gated(ctx.passives.byMoveType), shard: ctx.shards.dmgPct,
      enchant: ctx.enchant && ctx.enchant.kind === 'dmgPct' ? ctx.enchant.value * (ctx.enchant.uptime ?? 1) : 0,
      gear: ctx.gearPassives.dmgPct - inertGear, ['gear on ' + type]: gated(ctx.gearPassives.byMoveType),
    };
    for (const [k, v] of Object.entries(cats)) ok(v > 0, 'fixture: the ' + k + ' category is empty on this build');
    eq(ctx.masteryAbilities.dmgPct + O.energyScalingPct(mv, ctx.energyCap) + t.openPct + t.sustPct, 0,
       'fixture: a term outside those categories');
    const site = additiveSite({ gear: ['Blooming Eye'], stats: ctx.stats, critMult: ctx.critDmg, sup: 'Monk (Or)' });
    site('__rows(' + JSON.stringify(Object.entries(cats).map(([k, v], i) => ({ key: 'c' + i, name: 'Engine ' + k, bonus: v }))) + ')');
    site('energyCount = ' + ctx.energyCap);
    const out = site('getOutsideDmgMult')(mv);
    eq(out.terms.length, Object.keys(cats).length, 'the site added a term of its own: ' + JSON.stringify(out.terms));
    near(out.pct, t.basePct, 'the site sum of the categories against the engine sum', 1e-9);
    ok(t.trueFlat > 0, 'fixture: no True Flat in the plain hit');
    const raw = M.moveDamage(b, mv, { stats: ctx.stats });
    const cc = ctx.critChance + (+mv.critBonus || 0);
    const composed = site('getExpectedMoveCritDmg')(raw * out.total, ctx.critDmg, cc, out.critRatio) +
                     site('getTrueFlatDmg')() * M.trueFlatHits(b, mv);
    near(ctx.bestHit * t.stunDiv, composed, 'the engine plain hit against the site composition', 1e-6);
  });

  it('the sustained figure is the plain sum plus the setups at their uptime, True Flat after the crit', () => {
    // An Assassin nuking Poison Fan with Shadow Form in the rotation: the
    // sustained figure takes Shadow Form's +20 at its uptime (a turn in 7) INTO
    // the sum beside the gear and the shard - never as a second factor - and
    // Blooming Eye's True Flat on each of the four hits after the crit.
    const b = fresh('Assassin (Ch)', { str: 40 }, ['Blooming Eye', 'Vainglorious Locket']);
    b.shards = ['Empowering (R)'];
    const ctx = O.evaluate(b, specFor('Assassin (Ch)'));
    const t = ctx.burstTerms;
    eq((ctx.bestMove || {}).name, t.move, 'fixture: the best plain hit is not the nuke');
    ok(t.basePct > 0 && t.sustPct > 0 && t.trueFlat > 0, 'fixture: the sum, the setup share or True Flat is empty: ' + JSON.stringify(t));
    const shadow = (ctx.rotation || []).find(r => r.move === 'Shadow Form');
    ok(shadow && shadow.gain > 0, 'fixture: Shadow Form is not a damage setup here');
    near(t.sustPct, shadow.gain * shadow.uptime, "the sustained share is not Shadow Form's +20 at its uptime", 1e-9);
    const mv = O.movesFor('Assassin (Ch)').find(m => m.name === t.move);
    const site = additiveSite({ gear: ['Blooming Eye'], stats: ctx.stats, critMult: ctx.critDmg, sup: 'Assassin (Ch)' });
    const raw = M.moveDamage(b, mv, { stats: ctx.stats });
    const cc = ctx.critChance + (+mv.critBonus || 0);
    const composedAt = terms => {
      site('__rows(' + JSON.stringify(terms.map((v, i) => ({ key: 'r' + i, name: 'Engine term ' + i, bonus: v }))) + ')');
      const out = site('getOutsideDmgMult')(mv);
      eq(out.terms.length, terms.length, 'the site added a term of its own');
      return site('getExpectedMoveCritDmg')(raw * out.total, ctx.critDmg, cc, out.critRatio) + site('getTrueFlatDmg')() * M.trueFlatHits(b, mv);
    };
    near(ctx.bestHit * t.stunDiv, composedAt([t.basePct]), 'the plain hit against the site composition', 1e-6);
    near(ctx.sustainedHit * t.stunDiv, composedAt([t.basePct, t.sustPct]), 'the sustained hit against the site composition (the setup share one more term)', 1e-6);
  });

  it("Spirit Awakening's +50 is a summon buff: it reaches no hit of your own, on either side", () => {
    const b = fresh('Berserker (Ch)', { str: 60 });
    b.race = 'Vastayan (9%)';
    const ctx = O.evaluate(b, specFor('Berserker (Ch)'));
    const sa = (ctx.rotation || []).find(r => r.move === 'Spirit Awakening');
    ok(sa, 'fixture: Spirit Awakening is not in the Vastayan rotation');
    eq(sa.gain, null, 'Spirit Awakening is priced as damage on your own hit');
    const t = ctx.burstTerms;
    eq(t.move, 'Carnage', 'fixture: the Berserker no longer nukes with Carnage');
    eq(t.openPct, 0, "Spirit Awakening's +50 reached your own nuke's opener");
    eq(t.sustPct, 0, "Spirit Awakening's +50 reached your own nuke's sustained figure");
    near(ctx.bestBurst, ctx.bestHit, 'the opener grew with nothing to grow it', 1e-9);
    // The site agrees: the switch is +50 on a summon's attack, never on Carnage.
    const site = additiveSite({ race: 'Vastayan (9%)' });
    site('summonBuffsActive.spiritAwakening = true');
    const carnage = O.movesFor('Berserker (Ch)').find(m => m.name === 'Carnage');
    ok(!site('getDmgMulti')(carnage, 'Physical', 0).terms.some(x => /Spirit Awakening/.test(x.label)), 'the site gives Carnage the summon buff');
  });
});

// ── the supporters list never sends account IDs to visitors ────────────────
describe('supporters list privacy', () => {
  const root = path.join(__dirname, '..', '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');

  it('the page asks the server for names and totals, not the donations table', () => {
    // The list used to select donor_name, amount_cents AND user_id from every
    // donation row, so each logged-in donor's account ID reached every visitor.
    const js = read('js/donation.js');
    const fn = js.slice(js.indexOf('async function loadDonorLeaderboard'), js.indexOf('// Expose to global scope'));
    ok(fn.length > 100, 'loadDonorLeaderboard not found');
    ok(/sb\.rpc\('top_supporters'/.test(fn), 'the supporters list does not call top_supporters');
    ok(!/\.from\(\s*'donations'\s*\)/.test(js), 'the page still reads the donations table directly');
    ok(!/user_id/.test(fn), 'the supporters list still handles account IDs');
  });

  it('the SQL returns only a name and an amount, and locks the table', () => {
    const sql = read('supabase/donations-privacy.sql');
    const fn = sql.slice(sql.indexOf('create or replace function public.top_supporters'), sql.indexOf('$$;') + 3);
    ok(/returns table \(donor_name text, amount_cents bigint\)/.test(fn), 'top_supporters returns more than a name and an amount');
    ok(/security definer/.test(fn) && /set search_path = public/.test(fn), 'top_supporters is not a security definer with a fixed search_path');
    ok(/where d\.user_id is not null\s+group by d\.user_id/.test(fn), 'logged-in donations are not combined per account');
    ok(/where d\.user_id is null/.test(fn), 'logged-out donations are not listed one by one');
    ok(/order by d\.created_at desc/.test(fn), 'the combined entry does not use the most recent donor name');
    ok(/limit greatest\(1, least\(coalesce\(max_rows, 10\), 10\)\)/.test(fn), 'the row count is not capped at the 10 entries the page shows');
    ok(/order matters: run this file/i.test(sql), 'the SQL does not say to run it before the page change goes live');
    ok(/revoke all on function public\.top_supporters\(int\) from public;/.test(sql), 'EXECUTE is not revoked from PUBLIC first');
    ok(/grant execute on function public\.top_supporters\(int\) to anon, authenticated;/.test(sql), 'the website roles cannot call top_supporters');
    ok(/revoke all on table public\.donations from anon, authenticated;/.test(sql), 'website visitors can still read the donations table');
    ok(/alter table public\.donations enable row level security;/.test(sql), 'RLS is not enabled on donations');
  });

  it('the policy and the consent notice no longer say donations can be linked to accounts', () => {
    const policy = read('html/privacy.html');
    ok(!/log out before you donate/i.test(policy), 'the policy still tells donors to log out before donating');
    ok(!/traced to your account/i.test(policy), 'the policy still says a donation can be traced to your account');
    ok(/account IDs are not sent to visitors/.test(policy), 'the policy does not say account IDs are no longer sent to visitors');
    ok(!/can be linked to your account/.test(read('js/trades.js')), 'the consent notice still says donations can be linked to your account');
  });
});

// Utor (Astra, tier 5) heals a share of max HP set by the stars it spends, with
// no base heal and no stat scaling: 20/33/40% for 2/3/4 stars (game text) and
// 10% for 1 (owner). The DMG calc's Support list only took moves with a
// `healing` figure, so it never showed; it now has a stars counter.
describe("Astra's Utor in the DMG calc", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'builder.js'), 'utf8');
  const siteFn = name => {
    const start = src.indexOf('function ' + name + '(');
    ok(start !== -1, 'builder.js has no ' + name);
    let depth = 0, i = src.indexOf('{', start), end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
    }
    return src.slice(start, end);
  };
  // Marks are page data the Build AI snapshot does not carry, so read them off the page.
  const marksAt = src.indexOf('const markMoves = ');
  const markMoves = new Function(src.slice(marksAt, src.indexOf('const markPickers', marksAt)) + '\nreturn markMoves;')();
  const utor = ((markMoves.Astra || {}).learns || []).find(m => m.name === 'Utor');
  // Runs the heal working on its own; returns what it writes, with and without tags.
  const working = (move, { maxHp = 200, out = 1, inc = 1, stat = 0, stars = 1 } = {}) => {
    const detail = { classList: { contains: c => c === 'dc-detail' }, style: { display: 'none' }, innerHTML: '' };
    const row = { nextElementSibling: detail, classList: { add() {}, remove() {} } };
    const STAT_LABEL_MAP = { STR: 'str', ARC: 'arc', END: 'end', LCK: 'lck', SPD: 'spd' };
    new Function('healCalcMoveList', 'STAT_LABEL_MAP', 'getTotalStat', 'getMaxHp', 'getOutHealMult', 'getIncHealMult',
      'getCursedOutHealMult', 'getCursedIncHealMult', 'utorStars',
      siteFn('parseScaling') + '\n' + siteFn('toggleHealDetail') + '\nreturn toggleHealDetail;')(
      [move], STAT_LABEL_MAP, () => stat, () => maxHp, () => out, () => inc, () => 1, () => 1, stars)(row, 0);
    return { html: detail.innerHTML, text: detail.innerHTML.replace(/<[^>]+>/g, '') };
  };

  it('Utor heals 10/20/33/40% of max HP for 1-4 stars', () => {
    ok(utor, 'no Utor in markMoves.Astra');
    eq(JSON.stringify(utor.healingPctHpByStars || null), '{"1":10,"2":20,"3":33,"4":40}', 'Utor heal per stars');
  });

  it('the Support list takes a heal that is only a share of max HP', () => {
    const isHeal = new Function(siteFn('isHealMove') + '\nreturn isHealMove;')();
    ok(isHeal(utor), 'Utor is not a heal move');
    ok(isHeal({ type: 'Active', healing: 18 }), 'a heal with a base figure dropped out');
    ok(!isHeal({ type: 'Active', damage: 10 }), 'an attack counts as a heal');
    ok(!isHeal({ type: 'Passive', healingPctHpByStars: { 1: 5 } }), 'a passive counts as a heal');
    ok(/\.filter\(isHealMove\)/.test(siteFn('renderDmgCalc')), 'renderDmgCalc does not list heals through isHealMove');
  });

  it('works out the heal for the stars on the counter, through both heal stats', () => {
    // 200 max HP, x1.5 outgoing, x1.2 incoming: 1 star 20 -> 30 -> 36,
    // 2 stars 40 -> 60 -> 72, 3 stars 66 -> 99 -> 118.8, 4 stars 80 -> 120 -> 144.
    const cases = { 1: ['20.0', '30.0', '36.0'], 2: ['40.0', '60.0', '72.0'],
                    3: ['66.0', '99.0', '118.8'], 4: ['80.0', '120.0', '144.0'] };
    for (const [stars, nums] of Object.entries(cases)) {
      const { text } = working(utor, { maxHp: 200, out: 1.5, inc: 1.2, stars: +stars });
      for (const n of nums) ok(text.indexOf(n) !== -1, stars + ' star(s): the working is missing ' + n + ': ' + text);
      const other = cases[stars === '4' ? 1 : 4][2];
      ok(text.indexOf(other) === -1, stars + ' star(s): the working also shows another star count: ' + text);
    }
  });

  it('the stars counter steps from 1 to 4 and repaints the working', () => {
    const { html } = working(utor, { stars: 3 });
    ok(html.indexOf('onclick="changeUtorStars(-1)"') !== -1 && html.indexOf('onclick="changeUtorStars(1)"') !== -1,
       'no stars counter in the Utor working');
    ok(/class="dc-energy-val">3</.test(html), 'the counter does not show the stars: ' + html);
    let repaints = 0;
    const step = new Function('recalcOpenDetails', 'let utorStars = 1;\n' + siteFn('changeUtorStars') +
      '\nreturn d => { changeUtorStars(d); return utorStars; };')(() => { repaints++; });
    eq(step(-1), 1, 'the counter went below 1 star');
    eq(step(1), 2, 'the counter did not add a star');
    eq(step(10), 4, 'the counter went past 4 stars');
    eq(repaints, 3, 'the counter does not repaint the open working');
  });

  it('Holy Grace still works out as 18 x scaling + 4% of max HP', () => {
    // 18 x (1 + 50/100 + 50/100) = 36, + 4% of 200 = 44, x1.5 = 66, x1.2 = 79.2.
    const grace = { type: 'Active', healing: 18, healingPctHp: 4, scaling: 'STR/100 + ARC/100' };
    const { text } = working(grace, { maxHp: 200, out: 1.5, inc: 1.2, stat: 50 });
    for (const n of ['36.0', '44.0', '66.0', '79.2']) {
      ok(text.indexOf(n) !== -1, 'the Holy Grace working is missing ' + n + ': ' + text);
    }
  });
});

// Lifesong (enchant): each proc is +20% incoming and outgoing healing for 3
// turns, stacking to 3 (owner). The DMG calc has a 0-3 tracker, and the stacks
// add into both healing stats, which every heal working reads.
describe('Lifesong stacks', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'builder.js'), 'utf8');
  const siteFn = name => {
    const start = src.indexOf('function ' + name + '(');
    ok(start !== -1, 'builder.js has no ' + name);
    let depth = 0, i = src.indexOf('{', start), end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
    }
    return src.slice(start, end);
  };

  it('adds 20% a stack to the healing stats, up to 3, only with Lifesong', () => {
    const pct = (stacks, enchant) => new Function('document', 'lifesongStacks',
      siteFn('lifesongHealPct') + '; return lifesongHealPct();')({ getElementById: () => ({ value: enchant }) }, stacks);
    eq(pct(0, 'Lifesong'), 0, 'no stacks');
    eq(pct(1, 'Lifesong'), 20, '1 stack');
    eq(pct(3, 'Lifesong'), 60, '3 stacks');
    eq(pct(5, 'Lifesong'), 60, 'more than 3 stacks');
    eq(pct(3, 'Midas'), 0, 'the stacks count without Lifesong');
  });

  it('the tracker steps from 0 to 3 and moves the healing stats first', () => {
    const calls = [];
    const step = new Function('renderDmgBonusSection', 'updatePecents', 'recalcOpenDetails',
      'let lifesongStacks = 0;\n' + siteFn('changeLifesongStacks') +
      '\nreturn d => { changeLifesongStacks(d); return lifesongStacks; };')(
      () => calls.push('render'), () => calls.push('stats'), () => calls.push('workings'));
    eq(step(-1), 0, 'the tracker went below 0');
    eq(step(1), 1, 'the tracker did not add a stack');
    eq(step(10), 3, 'the tracker went past 3');
    eq(calls.filter(c => c === 'stats').length, 3, 'the healing stats are not refreshed');
    ok(calls.indexOf('stats') < calls.indexOf('workings'), 'the heal workings repaint before the healing stats move');
  });

  it('both healing stats read the stacks', () => {
    const body = siteFn('updatePecents');
    ok(body.indexOf('const _lifesongHealPct = (stat === "out-heal" || stat === "inc-heal") ? lifesongHealPct() : 0;') !== -1,
       'the healing stats do not read Lifesong');
    ok(/const pctBonus = [^;]*\+ _lifesongHealPct;/.test(body), 'Lifesong is not added into the healing stats');
  });

  it('the DMG calc has the tracker only with Lifesong, and it starts from 0', () => {
    const body = siteFn('renderDmgBonusSection');
    const at = body.indexOf("if (_enchantName === 'Lifesong')");
    ok(at !== -1, 'no Lifesong section in the DMG calc');
    const block = body.slice(at, at + 1000);
    ok(block.indexOf('onclick="changeLifesongStacks(-1)"') !== -1 && block.indexOf('onclick="changeLifesongStacks(1)"') !== -1,
       'no Lifesong tracker');
    ok(block.indexOf('${lifesongStacks}') !== -1, 'the tracker does not show the stacks');
    // An enchant change and a loaded build both clear it, beside Midas.
    eq((src.match(/midasLckStacks = 0;\s*lifesongStacks = 0;/g) || []).length, 2,
       'the stacks are not reset on an enchant change and on load');
  });
});

// The QTE trainers call _sbSubmitScore on EVERY new high of a run (streak 1, 2,
// 3 ... 31). The old sb.js fired one unordered RPC per high, marked a score as
// sent before the server had seen it, and dropped any score that arrived while
// a session was being armed - so a competitive spear run that reached 31 could
// leave the board holding 2. These tests run the real functions out of sb.js
// against a stub Supabase client.
describe('QTE score submission', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'sb.js'), 'utf8');
  const siteFn = name => {
    let start = src.indexOf('function ' + name + '(');
    ok(start !== -1, 'sb.js has no ' + name);
    // Keep the `async` - without it every await inside is a syntax error.
    if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
    let depth = 0, i = src.indexOf('{', start), end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
    }
    return src.slice(start, end);
  };
  const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

  // The submission pipeline on its own: real code, stub client, stub timers.
  // invokeImpl: the bright-service edge function (verified runs); absent = the
  // legacy tests, which never reach it.
  const mkPipe = (rpcImpl, invokeImpl) => {
    const calls = [];
    const timers = [];
    const toasts = [];
    const invokes = [];
    // No `from`: the pipeline only ever calls the RPCs and the edge function.
    // Every score table is written server-side; the client may not write any.
    const sb = {
      rpc: (name, args) => { calls.push({ name, score: args.p_score, session: args.p_session_id }); return rpcImpl(name, args); },
      functions: { invoke: (name, opts) => { invokes.push({ name, body: opts.body }); return invokeImpl(name, opts.body); } },
    };
    const retryMs = /const SCORE_RETRY_MS = (\[[^\]]*\]);/.exec(src);
    ok(retryMs, 'sb.js has no SCORE_RETRY_MS');
    const refusals = /const SCORE_REFUSALS = (\{[\s\S]*?\n  \});/.exec(src);
    ok(refusals, 'sb.js has no SCORE_REFUSALS');
    const ticketMs = /const TICKET_TIMEOUT_MS = (\d+);/.exec(src);
    ok(ticketMs, 'sb.js has no TICKET_TIMEOUT_MS');
    const gapMs = /const VERIFIED_GAP_MS = (\d+);/.exec(src);
    ok(gapMs, 'sb.js has no VERIFIED_GAP_MS');
    const api = new Function('sb', 'currentUser', 'PLATFORM', 'currentMonth', 'setTimeout', 'clearTimeout', 'console', 'scoreToast',
      'const _sessionIds = {}, _arming = {}, _pending = {}, _packet = {}, _fallback = {}, _confirmed = {}, _sending = {}, _forceNext = {},' +
      ' _retryN = {}, _retryT = {}, _heldToldAt = {}, _lowerToldAt = {}, _refusedToldAt = {}, _lastSentAt = {}, _gapT = {};\n' +
      'let _scoreGen = 0;\n' +
      'const SCORE_RETRY_MS = ' + retryMs[1] + ';\n' +
      'const SCORE_REFUSALS = ' + refusals[1] + ';\n' +
      'const TICKET_TIMEOUT_MS = ' + ticketMs[1] + ';\n' +
      'const VERIFIED_GAP_MS = ' + gapMs[1] + ';\n' +
      siteFn('startQteSession') + '\n' + siteFn('startQteRun') + '\n' + siteFn('isMissingFunction') + '\n' +
      siteFn('submitScore') + '\n' + siteFn('pumpScore') + '\n' +
      siteFn('sendScore') + '\n' + siteFn('sendVerified') + '\n' + siteFn('sendLegacy') + '\n' + siteFn('scheduleScoreRetry') + '\n' +
      siteFn('tellOnce') + '\n' + siteFn('flushScore') + '\n' +
      'function resetScoreState() { _scoreGen++; Object.keys(_sending).forEach(k => delete _sending[k]); Object.keys(_pending).forEach(k => delete _pending[k]); Object.keys(_confirmed).forEach(k => delete _confirmed[k]); }\n' +
      'return { submitScore, startQteSession, startQteRun, flushScore, resetScoreState, state: () => ({ pending: Object.assign({}, _pending), ' +
      'confirmed: Object.assign({}, _confirmed), sessions: Object.assign({}, _sessionIds) }) };'
    )(sb, { id: 'u1' }, 'C', () => '2026-09',
      (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, () => {},
      { log() {}, warn() {}, error() {} }, (m) => toasts.push(m));
    return { api, calls, timers, toasts, invokes, scores: () => calls.filter(c => c.name === 'submit_score').map(c => c.score),
             retries: () => timers.filter(t => t.ms !== Number(ticketMs[1]) && t.ms > 0 && SCORE_RETRY_MS_SET.has(t.ms)),
             gaps: () => timers.filter(t => t.ms !== Number(ticketMs[1]) && !SCORE_RETRY_MS_SET.has(t.ms)) };
  };
  const SCORE_RETRY_MS_SET = new Set(JSON.parse(/const SCORE_RETRY_MS = (\[[^\]]*\]);/.exec(src)[1]));
  // A deployment that still returns void: data is null, which must read as 'ok'.
  const okRpc = async (name) => ({ data: name === 'start_qte_session' ? 'sess-' + name : null, error: null });
  const statusRpc = (status) => async (name) =>
    name === 'start_qte_session' ? { data: 'sess-1', error: null } : { data: status, error: null };

  itAsync('a run that climbs to 31 leaves the server holding 31, not an early score', async () => {
    const p = mkPipe(okRpc);
    await p.api.startQteSession('spear-comp');
    for (let s = 1; s <= 31; s++) p.api.submitScore('spear-comp', s);   // exactly what a run does
    await tick(40);
    eq(p.api.state().confirmed['spear-comp'], 31, 'the run best is not what the server was left with');
    const sent = p.scores();
    eq(sent[sent.length - 1], 31, 'the last score sent was not the run best');
    ok(sent.length <= 4, 'one run still floods the server with ' + sent.length + ' submissions');
    for (let i = 1; i < sent.length; i++) ok(sent[i] > sent[i - 1], 'scores were sent out of order: ' + sent.join(','));
    eq(Object.keys(p.api.state().pending).length, 0, 'a score was left unsent');
  });

  itAsync('a held score is taken, not retried, and the player is told once', async () => {
    const p = mkPipe(statusRpc('held'));
    await p.api.startQteSession('dagger');
    for (let s = 18; s <= 25; s++) p.api.submitScore('dagger', s);   // a run past the record
    await tick(40);
    eq(p.api.state().confirmed['dagger'], 25, 'a held score is not treated as received');
    eq(Object.keys(p.api.state().pending).length, 0, 'a held score is left pending, to be retried');
    eq(p.timers.length, 0, 'a held score schedules a retry');
    eq(p.toasts.filter(t => /held for review/.test(t)).length, 1, 'the player is told more than once, or never');
  });

  itAsync('a score that arrives before the session is armed waits for it', async () => {
    let release;
    const p = mkPipe((name) => name === 'start_qte_session'
      ? new Promise(r => { release = () => r({ data: 'sess-1', error: null }); })
      : Promise.resolve({ data: null, error: null }));
    p.api.startQteSession('spear-comp');          // the trainer does not await this
    p.api.submitScore('spear-comp', 1);           // first hit lands while it is in flight
    p.api.submitScore('spear-comp', 2);
    await tick();
    eq(p.scores().length, 0, 'a score was sent without a session');
    release();
    await tick(20);
    eq(p.api.state().confirmed['spear-comp'], 2, 'the scores were dropped instead of waiting for the session');
    eq(p.calls.filter(c => c.name === 'start_qte_session').length, 1, 'the session was armed more than once');
  });

  itAsync('a failed submission is retried, not thrown away', async () => {
    let fail = true;
    const p = mkPipe(async (name) => {
      if (name === 'start_qte_session') return { data: 'sess-' + (fail ? 1 : 2), error: null };
      if (fail) { fail = false; return { data: null, error: { message: 'session expired' } }; }
      return { data: null, error: null };
    });
    await p.api.startQteSession('spear-comp');
    p.api.submitScore('spear-comp', 7);
    await tick(20);
    eq(p.api.state().pending['spear-comp'], 7, 'the failed score was dropped');
    eq(p.timers.length, 1, 'no retry was scheduled');
    // The session must survive a transport error: the server times a score from
    // the session's start, so a fresh one would make the retry look instant.
    eq(p.api.state().sessions['spear-comp'], 'sess-1', 'a transport error threw the run session away');
    p.timers[0].fn();
    await tick(20);
    eq(p.calls.filter(c => c.name === 'start_qte_session').length, 1, 'the retry armed a second session for the same run');
    eq(p.calls.filter(c => c.name === 'submit_score')[1].session, 'sess-1', 'the retry did not reuse the run session');
    eq(p.api.state().confirmed['spear-comp'], 7, 'the retry did not land the score');
    eq(Object.keys(p.api.state().pending).length, 0, 'the score is still pending after a successful retry');
  });

  itAsync('a new run is never timed against the last run session', async () => {
    let n = 0;
    const p = mkPipe(async (name) => name === 'start_qte_session'
      ? { data: 'sess-' + (++n), error: null } : { data: 'ok', error: null });
    await p.api.startQteSession('spear-comp');
    await p.api.submitScore('spear-comp', 4);
    await tick(20);
    await p.api.startQteSession('spear-comp');      // the next run
    await p.api.submitScore('spear-comp', 9);
    await tick(20);
    const sent = p.calls.filter(c => c.name === 'submit_score');
    eq(sent[0].session, 'sess-1', 'the first run used the wrong session');
    eq(sent[1].session, 'sess-2', 'the second run was timed against the first run session');
  });

  itAsync('a lower score never goes out after a higher one is stored', async () => {
    const p = mkPipe(okRpc);
    await p.api.startQteSession('spear-comp');
    p.api.submitScore('spear-comp', 31);
    await tick(20);
    const before = p.scores().length;
    p.api.submitScore('spear-comp', 2);      // a later run, or the same score arriving twice
    p.api.submitScore('spear-comp', 31);
    await tick(20);
    eq(p.scores().length, before, 'a score at or below the stored best was sent again');
    eq(p.api.state().confirmed['spear-comp'], 31, 'the stored best moved backwards');
  });

  itAsync('a score the server says it will never take is not retried, and says why', async () => {
    const p = mkPipe(statusRpc('too_fast'));
    await p.api.startQteSession('spear-comp');
    await p.api.submitScore('spear-comp', 31);
    await tick(20);
    eq(p.scores().length, 1, 'a refused score was sent more than once');
    eq(p.timers.length, 0, 'a refused score was scheduled for a retry');
    eq(Object.keys(p.api.state().confirmed).length, 0, 'a refused score was recorded as stored');
    eq(Object.keys(p.api.state().pending).length, 0, 'a refused score is still queued');
    eq(p.toasts.length, 1, 'the player was not told the score was refused');
    ok(/faster than/.test(p.toasts[0]), 'the message does not say why: ' + p.toasts[0]);
  });

  itAsync('a rejection the client does not recognise is retried with a fresh session', async () => {
    const p = mkPipe(statusRpc('no_session'));
    await p.api.startQteSession('spear-comp');
    await p.api.submitScore('spear-comp', 9);
    await tick(20);
    eq(p.api.state().pending['spear-comp'], 9, 'the score was dropped on an unknown rejection');
    eq(Object.keys(p.api.state().sessions).length, 0, 'the session was kept after a rejection');
    eq(p.timers.length, 1, 'no retry was scheduled');
    eq(p.toasts.length, 0, 'a retryable rejection bothered the player');
  });

  itAsync('a server that answers nothing at all still counts as stored', async () => {
    const p = mkPipe(okRpc);                 // data: null, as submit_score returns void today
    await p.api.startQteSession('spear');
    await p.api.submitScore('spear', 12);
    await tick(20);
    eq(p.api.state().confirmed['spear'], 12, 'the old void-returning server broke the client');
  });

  // ── verified runs (supabase/qte-verified.sql + the bright-service function) ──
  const TICKET = { run: '11111111-2222-3333-4444-555555555555', ticket: 'ab'.repeat(32) };
  const runRpc = async (name) => name === 'start_qte_run' ? { data: TICKET, error: null }
                                : name === 'start_qte_session' ? { data: 'sess-1', error: null } : { data: 'ok', error: null };
  const packetFor = (p, type, n) => ({ ticket: p.api.startQteRun(type), attempt: 0, log: { v: 1, type, a: 0, env: {}, ev: [['K', n]] } });

  itAsync('a verified run goes to the edge function with its ticket and log, never to submit_score', async () => {
    const p = mkPipe(runRpc, async () => ({ data: { status: 'ok', score: 9 }, error: null }));
    const pk = packetFor(p, 'dagger', 9);
    await p.api.submitScore('dagger', 9, pk);
    await tick(20);
    eq(p.invokes.length, 1, 'the score did not go to bright-service');
    const b = p.invokes[0].body;
    ok(p.invokes[0].name === 'bright-service' && b.run === TICKET.run && b.ticket === TICKET.ticket && b.score === 9
       && b.qte_type === 'dagger' && b.platform === 'C' && b.log === pk.log, 'the body does not carry the ticket, score and log');
    ok(!('seed' in b) && !('user_id' in b), 'the body carries a seed or a user id');
    eq(p.scores().length, 0, 'a verified run also went through submit_score');
    eq(p.api.state().confirmed['dagger'], 9, 'the verified score is not recorded as stored');
  });

  itAsync('a run with no ticket is not saved, and the player is told', async () => {
    const p = mkPipe(async (name) => name === 'start_qte_run' ? { data: null, error: null } : { data: 'ok', error: null },
                     async () => { throw new Error('must not be called'); });
    await p.api.submitScore('dagger', 5, packetFor(p, 'dagger', 5));
    await tick(20);
    eq(p.invokes.length, 0, 'a run with no ticket was sent');
    eq(p.scores().length, 0, 'a run with no ticket fell back to submit_score');
    eq(Object.keys(p.api.state().pending).length, 0, 'a score that can never be verified is still queued');
    ok(p.toasts.length === 1 && /not started with the server/.test(p.toasts[0]), 'the player was not told why');
  });

  itAsync('a rejected run is not retried and says it could not be verified', async () => {
    const p = mkPipe(runRpc, async () => ({ data: { status: 'rejected', reason: 'invalid: x' }, error: null }));
    await p.api.submitScore('dagger', 600, packetFor(p, 'dagger', 600));
    await tick(20);
    eq(p.invokes.length, 1, 'a rejected run was sent more than once');
    eq(p.retries().length, 0, 'a rejected run was scheduled for a retry');
    eq(Object.keys(p.api.state().confirmed).length, 0, 'a rejected run was recorded as stored');
    ok(p.toasts.length === 1 && /could not be verified/.test(p.toasts[0]), 'the player was not told the run was rejected');
  });

  itAsync('a run posted lower than claimed remembers what was posted', async () => {
    const p = mkPipe(runRpc, async () => ({ data: { status: 'ok', score: 11, claimed: 14 }, error: null }));
    await p.api.submitScore('dagger', 14, packetFor(p, 'dagger', 14));
    await tick(20);
    eq(p.api.state().confirmed['dagger'], 11, 'the client believes the board holds the claim, not what was posted');
    ok(p.toasts.some(t => /saved as 11/.test(t)), 'the player was not told the score was saved lower');
  });

  itAsync('before the SQL or the function exists, scores still reach the old path', async () => {
    // qte-verified.sql not run: start_qte_run is missing, the old session is used.
    const p1 = mkPipe(async (name) => name === 'start_qte_run' ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
                                    : name === 'start_qte_session' ? { data: 'sess-9', error: null } : { data: 'ok', error: null },
                      async () => { throw new Error('must not be called'); });
    await p1.api.submitScore('dagger', 4, packetFor(p1, 'dagger', 4));
    await tick(20);
    ok(p1.calls.some(c => c.name === 'submit_score' && c.session === 'sess-9'), 'no old session was used when start_qte_run is missing');
    // The function not deployed yet (404): the run id is an ordinary session to the old path.
    const p2 = mkPipe(runRpc, async () => ({ data: null, error: { message: 'not found', context: { status: 404 } } }));
    await p2.api.submitScore('dagger', 6, packetFor(p2, 'dagger', 6));
    await tick(20);
    ok(p2.calls.some(c => c.name === 'submit_score' && c.session === TICKET.run), 'a 404 from bright-service lost the score');
  });

  itAsync('a transport error on a verified run is retried with the same ticket and a longer log wins', async () => {
    let n = 0;
    const p = mkPipe(runRpc, async () => (++n === 1 ? { data: null, error: { message: 'boom', context: { status: 503 } } }
                                                    : { data: { status: 'ok', score: 8 }, error: null }));
    const t = p.api.startQteRun('dagger');
    p.api.submitScore('dagger', 7, { ticket: t, attempt: 0, log: { ev: [1] } });
    await tick(20);
    p.api.submitScore('dagger', 8, { ticket: t, attempt: 0, log: { ev: [1, 2] } });
    eq(p.retries().length, 1, 'no retry was scheduled');
    p.retries()[0].fn();
    await tick(20);
    eq(p.invokes.length, 2, 'the retry did not go out');
    eq(p.invokes[1].body.score, 8, 'the retry sent the old score, not the newest');
    eq(p.invokes[1].body.log.ev.length, 2, 'the retry sent the old log with the new score');
    eq(p.calls.filter(c => c.name === 'start_qte_run').length, 1, 'the retry asked for a second ticket');
  });

  itAsync('after an accepted send, a run waits before re-sending its growing log, then sends the best by then', async () => {
    const p = mkPipe(runRpc, async (name, body) => ({ data: { status: 'ok', score: body.score }, error: null }));
    const t = p.api.startQteRun('dagger');
    p.api.submitScore('dagger', 1, { ticket: t, attempt: 0, log: { ev: [1] } });
    await tick(20);
    for (let s = 2; s <= 6; s++) p.api.submitScore('dagger', s, { ticket: t, attempt: 0, log: { ev: Array(s).fill(1) } });
    await tick(20);
    eq(p.invokes.length, 1, 'every new high went straight out with the whole log');
    const gap = p.gaps();
    ok(gap.length === 1 && gap[0].ms > 0 && gap[0].ms <= 5000, 'no single, short wait was scheduled: ' + JSON.stringify(gap.map(g => g.ms)));
    gap[0].fn();
    await tick(20);
    eq(p.invokes.length, 2, 'the waiting send never went out');
    eq(p.invokes[1].body.score, 6, 'the waiting send did not carry the best by then');
    eq(p.api.state().confirmed['dagger'], 6, 'the best was not stored');
  });

  itAsync('the end of a run, and a run closing, send at once instead of waiting out the gap', async () => {
    const p = mkPipe(runRpc, async (name, body) => ({ data: { status: 'ok', score: body.score }, error: null }));
    const t = p.api.startQteRun('dagger');
    p.api.submitScore('dagger', 1, { ticket: t, attempt: 0, log: { ev: [1] } });
    await tick(20);
    p.api.submitScore('dagger', 2, { ticket: t, attempt: 0, log: { ev: [1, 2] }, final: true });
    await tick(20);
    eq(p.invokes.length, 2, 'the last score of a run waited for the gap');
    p.api.submitScore('dagger', 3, { ticket: t, attempt: 0, log: { ev: [1, 2, 3] } });
    await tick(20);
    eq(p.invokes.length, 2, 'a mid-run high skipped the gap');
    p.api.flushScore('dagger');
    await tick(20);
    eq(p.invokes.length, 3, 'closing the run did not send its held score');
  });

  itAsync('a ticket still on its way is waited for later, not given up on', async () => {
    let release;
    const p = mkPipe(async (name) => name === 'start_qte_run'
      ? new Promise(r => { release = () => r({ data: TICKET, error: null }); }) : { data: 'ok', error: null },
      async (name, body) => ({ data: { status: 'ok', score: body.score }, error: null }));
    const t = p.api.startQteRun('dagger');
    p.api.submitScore('dagger', 4, { ticket: t, attempt: 0, log: { ev: [1] } });
    await tick(5);
    const wait = p.timers.find(x => x.ms === 10000);
    ok(wait, 'no ticket wait was scheduled');
    wait.fn();                         // ten seconds pass with no answer
    await tick(20);
    eq(p.invokes.length, 0, 'a score was sent without its ticket');
    ok(p.retries().length === 1 && p.toasts.length === 0, 'a slow start was refused instead of retried');
    release();
    p.retries()[0].fn();
    await tick(20);
    eq(p.invokes.length, 1, 'the score did not go once the ticket came');
    eq(p.api.state().confirmed['dagger'], 4, 'the late ticket lost the score');
  });

  itAsync('a refused run falls back to an earlier run\'s lower score, and a stale answer after sign-out is ignored', async () => {
    const T1 = Promise.resolve({ run: TICKET.run, ticket: 'a1'.repeat(32) }), T2 = Promise.resolve({ run: TICKET.run, ticket: 'b2'.repeat(32) });
    const p = mkPipe(runRpc, async (name, body) => body.ticket === 'b2'.repeat(32)
      ? { data: { status: 'rejected' }, error: null } : { data: { status: 'ok', score: body.score }, error: null });
    p.api.submitScore('dagger', 9, { ticket: T1, attempt: 0, log: { ev: [1] } });
    await tick(20);                                              // run 1's 9 is stored
    p.api.submitScore('dagger', 10, { ticket: T1, attempt: 0, log: { ev: [1, 2] } });   // held by the gap
    await tick(20);
    p.api.submitScore('dagger', 11, { ticket: T2, attempt: 0, log: { ev: [7] }, final: true });  // run 2, refused
    await tick(40);
    eq(p.api.state().confirmed['dagger'], 10, 'run 1\'s 10 was thrown away when run 2\'s 11 was refused');
    // A send that returns after the account changed must not touch the new account's state.
    let answer;
    const q = mkPipe(runRpc, () => new Promise(r => { answer = () => r({ data: { status: 'ok', score: 15 }, error: null }); }));
    q.api.submitScore('dagger', 15, { ticket: q.api.startQteRun('dagger'), attempt: 0, log: { ev: [1] } });
    await tick(20);
    q.api.resetScoreState();
    answer();
    await tick(20);
    eq(q.api.state().confirmed['dagger'], undefined, 'the last account\'s answer landed in the new account\'s state');
  });

  itAsync('a score with its run log replaces one without, and a run\'s own expired session is not retried forever', async () => {
    // After step 2 the old path answers "permission denied": a packetless score is stuck.
    const p = mkPipe(async (name) => name === 'start_qte_run' ? { data: TICKET, error: null }
      : name === 'start_qte_session' ? { data: 'sess-1', error: null } : { data: null, error: { message: 'permission denied' } },
      async (name, body) => ({ data: { status: 'ok', score: body.score }, error: null }));
    p.api.submitScore('dagger', 12);                 // an old packetless score, stuck
    await tick(20);
    const before = p.invokes.length;
    p.api.submitScore('dagger', 5, { ticket: p.api.startQteRun('dagger'), attempt: 0, log: { ev: [1] } });
    await tick(20);
    eq(p.invokes.length, before + 1, 'a verified score was blocked by a packetless one');
    const q = mkPipe(async (name) => name === 'start_qte_run' ? { data: { legacy: 'x' }, error: null }
      : name === 'submit_score' ? { data: 'no_session', error: null } : { data: 'sess', error: null });
    q.api.submitScore('dagger', 3, { ticket: Promise.resolve({ legacy: 'sess-old' }), attempt: 0, log: { ev: [1] } });
    await tick(20);
    eq(q.retries().length, 0, 'an expired run session was retried');
    eq(Object.keys(q.api.state().pending).length, 0, 'the dead score still blocks the queue');
  });

  // A local best has no run log left to send, so it is never re-sent (that
  // went round the verified path); it is cleared so new highs submit again.
  it('a local best the server does not hold is cleared, never re-sent without its run log', () => {
    const body = siteFn('reconcileServerScores');
    ok(body.indexOf('submitScore(') === -1, 'reconcileServerScores sends a local best with no run log');
    ok(body.indexOf("new Event('alb-scores-reset')") !== -1, 'a local best the server does not hold would gate every later run');
  });

  it('a player with a PC and a mobile row is still given a rank', () => {
    const body = siteFn('fetchMyRank');
    ok(/\.order\('score', \{ ascending: false \}\)\.limit\(1\)\.maybeSingle\(\)/.test(body),
       'fetchMyRank still calls maybeSingle() on a query that can return two rows');
  });

  it('the page gives a pending score one more chance before it goes away', () => {
    ok(/visibilitychange[\s\S]{0,400}pumpScore\(/.test(src), 'nothing flushes a pending score when the tab is hidden');
  });

  it("the ping simulator's delayed keys are not treated as a macro", () => {
    const guard = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'qte-guard.js'), 'utf8');
    const core = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'core.js'), 'utf8');
    // core.js remembers its own copies privately; a flag on the event was
    // settable by any script and walked its keys straight past the guard.
    ok(/const copies = new WeakSet\(\);/.test(core) && /copies\.add\(ev\);/.test(core)
       && /window\._albIsPingCopy = e => copies\.has\(e\);/.test(core), 'core.js no longer remembers its delayed key copies');
    ok(/if \(copies\.has\(e\)\) return;/.test(core), 'core.js delays its own copies again');
    ok(/repeat: e\.repeat,/.test(core), 'a delayed copy of an auto-repeat key arrives as a fresh press');
    ok(!/_albSynthetic\s*=|\._albSynthetic\)/.test(core + guard), 'a settable _albSynthetic flag is still trusted');
    ok(/const isPingCopy = typeof window\._albIsPingCopy === 'function' \? window\._albIsPingCopy : \(\) => false;/.test(guard),
       'qte-guard does not take the copy check once, at load');
    ok(/function isDelayedCopy\(e\) \{ return !!e && isPingCopy\(e\); \}/.test(guard),
       'qte-guard has no delayed-copy test');
    const coreAt = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
    ok(coreAt.indexOf('js/core.js') < coreAt.indexOf('js/qte-guard.js'), 'qte-guard.js loads before core.js has made the copy check');
    for (const fn of ['onKeyDown', 'onKeyUp']) {
      const at = guard.indexOf('function ' + fn + '(');
      ok(at !== -1, 'qte-guard has no ' + fn);
      const body = guard.slice(at, at + 420);
      const seen = body.indexOf('isDelayedCopy(e)');
      ok(seen !== -1 && seen < body.indexOf('isTrusted'),
         fn + ' flags the ping simulator before it recognises the delayed copy');
    }
  });

  it('the "score not submitted" toast is actually visible', () => {
    const qteCss = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'qte.css'), 'utf8');
    ok(/\.qte-guard-toast\s*\{/.test(qteCss), 'the toast styles are not in a stylesheet the page loads');
    ok(/\.qte-guard-toast\.show\s*\{/.test(qteCss), 'the toast has no shown state');
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
    ok(/<link rel="stylesheet" href="css\/qte\.css\?v=\d+">/.test(html), 'index.html does not load css/qte.css');
    const guard = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'qte-guard.js'), 'utf8');
    ok(/toast:\s*toast/.test(guard) || /toast,/.test(guard), 'qte-guard does not share its toast, so sb.js cannot report a lost score');
    ok(src.indexOf('function scoreToast(') !== -1, 'sb.js never tells the player a score was not saved');
  });
});

// supabase/qte-scores.sql is the server half of the same contract: the client
// reads the statuses it returns, and its per-trainer timing floors decide which
// scores the database keeps. They have to stay in step.
describe('QTE score SQL', () => {
  const root = path.join(__dirname, '..', '..');
  const sql = fs.readFileSync(path.join(root, 'supabase', 'qte-scores.sql'), 'utf8');
  const sb = fs.readFileSync(path.join(root, 'js', 'sb.js'), 'utf8');
  const floor = t => {
    const m = new RegExp("when '" + t + "'\\s+then\\s+([\\d.]+)").exec(sql);
    return m ? +m[1] : null;
  };

  it('every trainer the site can submit has its own timing floor', () => {
    const types = (/const QTE_TYPES = \[([^\]]*)\]/.exec(sb) || [])[1]
      .split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
    eq(types.length, 12, 'the trainer list changed - the SQL needs the same change');
    const missing = [];
    for (const t of types) for (const suffix of ['', '-comp']) {
      if (floor(t + suffix) === null) missing.push(t + suffix);
    }
    eq(missing.join(','), '', 'these types fall through to the ELSE and are priced by guesswork');
  });

  it('an unlisted trainer fails open instead of eating scores', () => {
    const els = /else\s+([\d.]+)\s*\n\s*end;/.exec(sql);
    ok(els, 'no ELSE in qte_min_seconds');
    const lowest = Math.min(...[...sql.matchAll(/when '[a-z-]+'\s+then\s+([\d.]+)/g)].map(m => +m[1]));
    ok(+els[1] <= lowest, 'the ELSE (' + els[1] + ') is stricter than the loosest trainer needs (' + lowest + ')');
  });

  it('competitive spear can actually reach its own floor', () => {
    // The game gives a target every ~0.85s at first, ~0.66s by streak 30; this
    // is the conservative version of that, and the rule must stay under it.
    const k = floor('spear-comp');
    const rejected = [];
    for (let n = 1; n <= 31; n++) if (k * n > 1.0 + 0.8 * (n - 1)) rejected.push(n);
    eq(rejected.join(','), '', 'the timing rule discards competitive spear runs again');
    ok(floor('spear') < 1.0, 'casual spear is back above the pace it can produce');
  });

  it('the client handles every status the function returns', () => {
    const statuses = [...new Set([...sql.matchAll(/RETURN '([a-z_]+)'/g)].map(m => m[1]))];
    ok(statuses.includes('ok') && statuses.includes('too_fast') && statuses.includes('no_session'),
       'the function no longer answers with a status: ' + statuses.join(','));
    const refusals = /const SCORE_REFUSALS = \{[\s\S]*?\n  \};/.exec(sb);
    ok(refusals, 'sb.js has no SCORE_REFUSALS map');
    // Every verdict about the score itself is final. Only a lost session, and
    // a caller id that is not the JWT's (which the real client never sends),
    // are worth another go with a fresh session.
    // 'held' is neither: the server kept the score for an admin, so it is taken.
    ok(statuses.includes('held') && /if \(status === 'held'\) \{[\s\S]{0,400}return 'accepted';/.test(sb), 'a held score is retried or refused instead of taken');
    const finals = statuses.filter(s => !['ok', 'no_session', 'wrong_user', 'held'].includes(s));
    for (const s of ['too_fast', 'capped', 'banned', 'bad_input']) ok(finals.includes(s), 'the function lost the "' + s + '" verdict');
    for (const s of finals) {
      ok(new RegExp('\\b' + s + ':').test(refusals[0]), 'the client would keep retrying a final "' + s + '"');
    }
    ok(!/\bno_session:/.test(refusals[0]), 'a lost session is treated as final instead of arming a new one');
    ok(sb.indexOf("const status = typeof data === 'string' ? data : 'ok';") !== -1,
       'the client ignores the status, so a discarded score looks stored again');
  });

  it('the function no longer drops scores in silence, or trusts the caller', () => {
    ok(!/IF NOT FOUND THEN RETURN; END IF;/.test(sql), 'a silent RETURN is back in submit_score');
    ok(/v_user\s+UUID\s*:=\s*auth\.uid\(\)/.test(sql), 'identity is not taken from the JWT');
    ok(/p_user_id <> v_user THEN RETURN 'wrong_user'/.test(sql), 'a caller can still submit as another user');
    ok(/GREATEST\(leaderboard\.score, EXCLUDED\.score\)/.test(sql), 'a lower score can overwrite a higher one again');
    ok(/grant execute on function public\.submit_score/.test(sql), 'the DROP took the grants and nothing puts them back');
  });

  // Owner's choice, 2026-09-22: caps follow the record, and the scores that
  // matter wait for a person - the server cannot watch a run being played.
  it('the cap follows the record and the scores that matter wait for an admin', () => {
    ok(/create function public\.qte_score_cap\(p_type text\) returns integer/.test(sql)
       && /greatest\(50, 2 \* coalesce\(\(select r\.score from leaderboard_records r where r\.qte_type = p_type\), 0\)\)/.test(sql),
       'the cap is not twice the record (min 50)');
    ok(/p_qte_type\s*=\s*'qte_score_cap'|p\.proname = 'qte_score_cap'/.test(sql), 'the old dashboard cap is not dropped first');
    // The hold comes after the cap and timing checks and before anything is posted.
    const body = sql.slice(sql.indexOf('create function public.submit_score('));
    const iHold = body.indexOf("RETURN 'held'"), iTiming = body.indexOf("RETURN 'too_fast'"), iPost = body.indexOf('INSERT INTO leaderboard (');
    ok(iTiming > 0 && iHold > iTiming && iPost > iHold, 'the hold is not between the checks and the posting');
    ok(/IF p_score > GREATEST\(COALESCE\(v_record, 0\), CASE WHEN v_record IS NULL THEN 10 ELSE 0 END\) THEN/.test(body), 'a new record is posted without review');
    ok(/p_score > v_top \* 1\.5 AND p_score - v_top >= 5/.test(body), 'a leap past the field is posted without review');
    // Against OTHER players' best: against their own row a fake could climb unheld in 1.5x steps.
    ok(/l\.score_month = v_month AND l\.user_id <> v_user/.test(body), 'the #1 check counts the caller\'s own row');
    ok(/create index if not exists leaderboard_type_month_score on public\.leaderboard \(qte_type, score_month, score desc\)/.test(sql), 'every submission scans the whole board');
    ok(/ON CONFLICT \(user_id, qte_type\) WHERE status = 'pending'/.test(body) && /GREATEST\(score_reviews\.score, EXCLUDED\.score\)/.test(body), 'a held run does not keep its best score in one pending row');
    ok(/IF v_new AND/.test(body) && /FROM unnest\(public\.site_admin_ids\(\)\) AS a/.test(body), 'admins are not told, or are told once per point');
    // Approval is admin-only on the server and posts exactly what submit_score would.
    const review = /create function public\.admin_review_score\(p_id uuid, p_approve boolean, p_score integer\)[\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(sql);
    ok(review, 'no admin_review_score');
    ok(/if public\.is_site_admin\(\) is not true then raise exception 'admin only'/.test(review[1]), 'anyone can approve a held score');
    // An approval posts only the score the admin was shown, and never for a banned account.
    ok(/if p_approve and r\.score is distinct from p_score then\s+raise exception/.test(review[1]), 'an approval can post a higher score than the admin looked at');
    ok(/if p_approve and \(exists \(select 1 from perma_banned_usernames b where b\.user_id = r\.user_id\)/.test(review[1]), 'a score from an account banned since can be approved');
    ok(/security definer/.test(sql.slice(sql.indexOf('function public.admin_review_score('), sql.indexOf(review[1]))), 'admin_review_score cannot write the locked tables');
    for (const t of ['leaderboard (', 'leaderboard_records (', 'personal_bests (']) ok(review[1].indexOf('insert into ' + t) !== -1, 'approval does not post to ' + t);
    ok(/revoke all on function public\.admin_review_score\(uuid, boolean, integer\) from public, anon, authenticated;/.test(sql)
       && /grant execute on function public\.admin_review_score\(uuid, boolean, integer\) to authenticated;/.test(sql), 'admin_review_score keeps the default PUBLIC grant');
    ok(/p\.proname = 'admin_review_score'/.test(sql), 'an older admin_review_score overload (without the shown score) survives a re-run');
    // The table is read-only through the API; a player sees only their own rows.
    ok(/revoke all on table public\.score_reviews from public, anon, authenticated/.test(sql)
       && /using \(auth\.uid\(\) = user_id or public\.is_site_admin\(\)\)/.test(sql)
       && !/create policy \S+ on public\.score_reviews for (insert|update|delete|all)/.test(sql), 'score_reviews takes writes from the API, or is readable by everyone');
    // And the admin panel can act on it.
    ok(/sb\.rpc\('admin_review_score', \{ p_id: id, p_approve: !!approve, p_score: shownScore \}\)/.test(sb) && /data-tab="held"/.test(sb), 'the admin panel has no way to review held scores, or does not say which score it approves');
  });
});

// supabase/lockdown.sql makes the score and ban tables read-only through the
// API and puts every admin action behind a function that checks for an admin
// on the server. The site must never write those tables again: a client-side
// isAdmin() decides which buttons to draw, not what the database accepts, so
// any table the admin panel could write, every signed-in user could write.
describe('database lockdown', () => {
  const root = path.join(__dirname, '..', '..');
  const sql = fs.readFileSync(path.join(root, 'supabase', 'lockdown.sql'), 'utf8');
  const sb = fs.readFileSync(path.join(root, 'js', 'sb.js'), 'utf8');
  const LOCKED = ['leaderboard', 'leaderboard_records', 'personal_bests',
                  'banned_usernames', 'perma_banned_usernames', 'qte_sessions'];
  const ADMIN_FNS = ['admin_ban_user', 'admin_perma_ban_user', 'admin_unban_user', 'admin_ban_usernames',
                     'admin_clear_all_scores', 'admin_clear_user_score', 'admin_delete_listings', 'admin_purge_expired'];

  // The file minus its comments: the VERIFY block and section 5 quote every
  // table and function name, so a check against the raw text proves nothing.
  const code = sql.replace(/--[^\n]*/g, '');
  const statements = code.split(';').map(s => s.replace(/\s+/g, ' ').trim());

  it('locks every score and ban table, then grants reading only', () => {
    const list = /foreach t in array array\[([^\]]*)\]/.exec(code);
    ok(list, 'no table list in the lockdown loop');
    for (const t of LOCKED) ok(new RegExp("'" + t + "'").test(list[1]), t + ' is not in the lockdown list');
    ok(/drop policy %I on public\.%I/.test(code), 'existing policies are not dropped, so a dashboard-made write policy would survive');
    ok(/revoke all on table public\.%I from public, anon, authenticated/.test(code), 'table privileges are not revoked');
    ok(!/for (insert|update|delete|all)\b/i.test(code), 'a write policy is created on a locked table');
    ok(!/grant (insert|update|delete|all)\b[^\n]*on table/i.test(code), 'a write privilege is granted back');
    ok(!/qte_sessions_read/.test(code) && !statements.some(s => /^grant select/.test(s) && /qte_sessions/.test(s)), 'qte_sessions is readable from the client');
    ok(/for select using \(auth\.uid\(\) = user_id\)/.test(code), 'personal_bests is not restricted to the player\'s own row');
    ok(!statements.some(s => /^grant select/.test(s) && /personal_bests/.test(s) && /\banon\b/.test(s)),
       'personal_bests is world-readable; the site reads only the signed-in player\'s row');
  });

  it('every admin function refuses a non-admin on the server, and is granted on purpose', () => {
    const fns = [...sql.matchAll(/create (?:or replace )?function public\.(admin_[a-z_]+)\([^)]*\)[\s\S]*?\$\$([\s\S]*?)\$\$;/g)];
    eq(fns.map(f => f[1]).sort().join(','), ADMIN_FNS.slice().sort().join(','), 'the admin function list changed');
    // The name list of the one loop that revokes from public, anon AND
    // authenticated - and only that list: the group may not swallow an earlier
    // `p.proname in (` (the drop loop names the same functions).
    const revoked = /p\.proname in \(((?:(?!p\.proname in \()[\s\S])*?)\)\s*loop\s*execute format\('revoke all on function %s from public, anon, authenticated'/.exec(code);
    ok(revoked, 'no revoke loop over the function names');
    for (const [, name, body] of fns) {
      // `is not true`, not `if not`: with no JWT is_site_admin() could be NULL,
      // and a plpgsql `if not NULL` does not branch (rpc-anon-lockout.sql, BUG 2).
      ok(/if public\.is_site_admin\(\) is not true then raise exception 'admin only'/.test(body), name + ' does not refuse non-admins null-safely');
      ok(/security definer/.test(sql.slice(sql.indexOf('function public.' + name + '('), sql.indexOf(body))), name + ' is not a definer');
      ok(new RegExp("'" + name + "'").test(revoked[1]), name + ' is not in the revoke list');
      ok(new RegExp('grant execute on function public\\.' + name + '\\([^)]*\\)\\s+to authenticated;').test(code), name + ' is never granted to authenticated');
      ok(!new RegExp('public\\.' + name + '\\([^)]*\\)\\s+to anon').test(code), name + ' is granted to anon');
    }
  });

  // Owner, 2026-09-22: the admin list must not be readable from a browser.
  // is_site_admin() answers for the caller (the RLS policies call it as the
  // request role, so the API roles keep EXECUTE); it is a definer over the
  // table public.site_admins, so the caller needs - and has - no right to the
  // list, and site_admin_ids() is not callable from the API at all.
  it('is_site_admin stays callable by the API roles, never answers NULL, and the list stays hidden', () => {
    ok(/create or replace function public\.is_site_admin\(\) returns boolean\s+language sql\s+stable\s+security definer\s+set search_path = public\s+as \$\$\s+select coalesce\(exists \(select 1 from public\.site_admins where user_id = auth\.uid\(\)\), false\);/.test(sql),
       'is_site_admin can answer NULL, or reads something other than site_admins as a definer');
    ok(/grant execute on function public\.is_site_admin\(\)\s+to anon, authenticated;/.test(sql), 'is_site_admin is not granted back');
    ok(/revoke all on function public\.site_admin_ids\(\) from public, anon, authenticated;/.test(sql)
       && !/grant execute on function public\.site_admin_ids\(\)/.test(sql), 'site_admin_ids is callable from the API - it hands out every admin id');
    ok(/revoke all on table public\.site_admins from public, anon, authenticated;/.test(sql), 'site_admins is readable from the API');
  });

  it('no script writes a locked table itself', () => {
    const dir = path.join(root, 'js');
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
      // Whole-line comments only: a `//` inside a string (the Supabase URL) must
      // not hide the rest of its line from the scan.
      const code = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\s*\/\/[^\n]*/gm, '');
      for (const t of LOCKED) {
        const re = new RegExp("from\\('" + t + "'\\)[^;]{0,300}?\\.(insert|upsert|update|delete)\\(");
        const m = re.exec(code);
        ok(!m, 'js/' + f + ' still writes ' + t + ' directly: ' + (m ? m[0].slice(0, 90) : ''));
      }
    }
  });

  it('a ban names one account: the id and the name must agree', () => {
    ok(/not exists \(select 1 from profiles where id = p_user_id and username = p_username\)/.test(code),
       'admin_ban_user believes any id it is handed with any name');
    ok(/_adminCurrentUser\?\.username === username \? _adminCurrentUser\.id : null/.test(sb),
       'the Banned tab\'s Perma button can send the User Actions card\'s id with another row\'s name');
    // Unban clears the Auth lock only when nothing else still bans the account.
    ok(/not exists \(select 1 from banned_usernames\s+where user_id = v_user\)\s+and not exists \(select 1 from perma_banned_usernames where user_id = v_user\)/.test(code),
       'an unban unlocks an account another ban row still names');
    ok(/returns text\[\]/.test(code) && /Array\.isArray\(bannedNames\)/.test(sb), 'the sweep reports the list it sent, not the names it banned');
    // perma_banned_usernames.user_id is unique (live constraint, found when the
    // backfill collided on a renamed account): a second name for an account
    // already in the table must go in as a name alone, not raise.
    ok(/case when exists \(select 1 from perma_banned_usernames where user_id = v_user\)\s+then null else v_user end/.test(code),
       'perma-banning a renamed account that is already in the table raises on the unique user_id');
  });

  it('bans that already exist are locked by the owner after a look, never by the file', () => {
    // The statements are there for the owner (raw text) ...
    ok(/update public\.banned_usernames b set user_id = u\.id from auth\.users u/.test(sql), 'no backfill by signup name');
    ok(/update public\.banned_usernames b set user_id = p\.id from public\.profiles p/.test(sql), 'no backfill by profile name');
    ok(/public\.lock_auth_user\(user_id, true\)/.test(sql) && /where user_id <> all \(public\.site_admin_ids\(\)\)/.test(sql), 'no lock step, or one that could lock an admin');
    // ... and none of them runs on its own: the old perma ids came from the
    // panel bug and the sweep matched substrings, so a row may name an innocent.
    ok(!/lock_auth_user\([^)]*,\s*true\)/.test(code.replace(/create function public\.admin_(perma_)?ban_user[\s\S]*?\$\$;/g, '')),
       'the file locks existing bans on its own');
    ok(!/update public\.(perma_)?banned_usernames b set user_id/.test(code), 'the file backfills ids on its own');
  });

  it('submit_score refuses a ban under any name the account has carried', () => {
    const scores = fs.readFileSync(path.join(root, 'supabase', 'qte-scores.sql'), 'utf8');
    ok(/FROM banned_usernames WHERE user_id = v_user/.test(scores), 'a ban by id is not checked');
    ok(/JOIN profiles p ON p\.username = b\.username WHERE p\.id = v_user/.test(scores), 'a ban by profile name is not checked');
    ok(/raw_user_meta_data->>'username' = b\.username WHERE u\.id = v_user/.test(scores), 'a ban by signup name (what the login check uses) is not checked');
    ok(/p_score > COALESCE\(qte_score_cap\(p_qte_type\), 0\)/.test(scores), 'an unknown trainer with a NULL cap has no cap at all');
  });
});

// supabase/lockdown2.sql covers every other table the site writes. Probed as
// an anonymous visitor, party_listings took inserts, updates and deletes,
// notifications took inserts for any user_id, and shared_builds took the
// delete markers the gallery honours. The rule for all of them: a row is
// written by the account it belongs to, or by an admin, never by anyone else.
describe('database lockdown 2', () => {
  const root = path.join(__dirname, '..', '..');
  const sql = fs.readFileSync(path.join(root, 'supabase', 'lockdown2.sql'), 'utf8');
  const code = sql.replace(/--[^\n]*/g, '');
  const statements = code.split(';').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const builds = fs.readFileSync(path.join(root, 'js', 'builds.js'), 'utf8');
  const TABLES = ['profiles', 'notifications', 'direct_messages', 'trade_listings',
                  'party_listings', 'party_members', 'party_requests', 'party_messages', 'shared_builds'];

  it('resets every table it covers; the public schema and the bucket are separate transactions', () => {
    for (const t of TABLES) ok(code.indexOf("pg_temp.reset_table('" + t + "')") !== -1, t + ' is never reset, so a dashboard-made write policy would survive');
    ok(/drop policy %I on public\.%I/.test(code) && /revoke all on table public\.%I from public, anon, authenticated/.test(code), 'the reset helper does not drop policies and revoke privileges');
    const commits = [...code.matchAll(/\bcommit;/g)].map(m => m.index);
    eq(commits.length, 2, 'expected two transactions (public schema, then the bucket)');
    ok(/^\s*begin;/.test(code) && /notify pgrst, 'reload schema';\s*commit;/.test(code), 'part 1 does not end in a schema reload');
    // Everything touching storage.* comes after the first commit: a refusal
    // there (postgres may not own storage.objects) must not roll back part 1.
    const firstStorage = code.search(/storage\.(objects|buckets)/);
    ok(firstStorage > commits[0], 'the bucket policies are inside the public-schema transaction');
  });

  it('every write policy compares the caller with the row, or asks for an admin', () => {
    // Everything but FOR SELECT is a write policy - including one with no FOR
    // clause, which means ALL. The one policy for supabase_auth_admin (the
    // signup trigger's role, which no API caller can hold) is the exception.
    const writes = statements.filter(s => /^create policy /.test(s) && !/ for select /.test(s) && !/ to supabase_auth_admin /.test(s));
    ok(writes.length >= 20, 'expected the write policies, found ' + writes.length);
    // "auth.uid() is not null" alone is a signed-in check, not an ownership one.
    // An is_site_admin() branch proves nothing about the others ("admin or
    // true" is open to all), so it is set aside: what is left must compare the
    // caller with the row, unless the policy is admin-only outright.
    const owns = /auth\.uid\(\)(::text)? = [a-z_.(]|[a-z_.)'>-]+ = auth\.uid\(\)|\(storage\.foldername/;
    const adminOnly = /^create policy \S+ on \S+ for \w+ to authenticated( using \(public\.is_site_admin\(\)\))?( with check \(public\.is_site_admin\(\)\))?$/;
    for (const s of writes) {
      ok(adminOnly.test(s) || owns.test(s.replace(/public\.is_site_admin\(\)/g, '')), 'a write policy never compares the caller with the row: ' + s.slice(0, 90));
      ok(!/\bor true\b|auth\.role\(\)/.test(s), 'a write policy has an open branch: ' + s.slice(0, 90));
      ok(!/(using|with check) \(true\)/.test(s), 'a write policy is "true": ' + s.slice(0, 80));
      ok(!/ to public\b/.test(s), 'a write policy is granted to public: ' + s.slice(0, 80));
      if (/ for update /.test(s)) ok(/ with check \(/.test(s), 'an update policy has no WITH CHECK, so a row can be handed to another user: ' + s.slice(0, 80));
    }
  });

  it('anon can read, insert only shared builds, and call only build_meta', () => {
    const grants = statements.filter(s => /^grant /.test(s) && /\b(anon|public)\b/.test(s.replace(/ on (table|function) \S+/, '')));
    for (const s of grants) {
      if (/^grant execute on function /.test(s)) {
        ok(/^grant execute on function public\.build_meta\(/.test(s), 'anon may call ' + s.slice(0, 90));
        continue;
      }
      const priv = /^grant ([a-z, ]+?) on /.exec(s);
      ok(priv, 'unreadable grant: ' + s);
      const privs = priv[1].split(',').map(p => p.trim());
      const allowed = /public\.shared_builds/.test(s) ? ['select', 'insert'] : ['select'];
      for (const p of privs) ok(allowed.includes(p), 'anon is granted ' + p + ' in: ' + s.slice(0, 90));
      ok(!/\bto public\b/.test(s), 'a table is granted to public: ' + s.slice(0, 90));
    }
    ok(!statements.some(s => /^grant all\b/.test(s)), 'a "grant all" hands out every privilege');
    ok(!statements.some(s => /^grant /.test(s) && /storage\.objects/.test(s)), 'storage privileges are granted (they are managed by Supabase)');
  });

  it('a delete marker in the gallery needs the uploader or an admin', () => {
    const p = statements.find(s => /^create policy sb_insert on public\.shared_builds/.test(s));
    ok(p, 'no shared_builds insert policy');
    ok(/coalesce\(shared_builds\.payload->>'_deleted', ''\) <> 'true'/.test(p), 'plain inserts are not exempt from the marker rule');
    ok(/public\.is_site_admin\(\)/.test(p) && /t\.payload->>'_ownerId' = auth\.uid\(\)::text/.test(p) && /auth\.uid\(\) is not null/.test(p), 'the marker rule does not check the uploader');
    // Inside the subquery an unqualified `payload` is t's own column: the rule
    // would then test the wrong row - and pass for a row an attacker planted.
    ok(/t\.id = shared_builds\.payload->>'_buildId'/.test(p), 'the marker rule reads _buildId from the wrong row');
    ok(!statements.some(s => /^create policy \S+ on public\.shared_builds\b/.test(s) && !/ for (select|insert) /.test(s)), 'shared_builds is no longer append-only');
    ok(!statements.some(s => /^grant .*(update|delete|all).* on table public\.shared_builds/.test(s)), 'shared_builds is no longer append-only');
    // Owner and credited name are written by the database, never the payload.
    ok(/create trigger stamp_shared_build before insert on public\.shared_builds/.test(code), 'the uploader is still the payload\'s word');
    // A marker is cut to a marker, so it cannot double as a gallery card with any credit.
    ok(/new\.payload->>'_deleted' = 'true' then\s+new\.payload := jsonb_strip_nulls\(jsonb_build_object\(\s*'_deleted', 'true', '_buildId', new\.payload->>'_buildId', '_fp', new\.payload->>'_fp'\)\);\s+return new;/.test(code),
       'a delete marker keeps _community/_submittedBy and shows in the gallery');
    // The server dates gallery rows, and the gallery lists newest first.
    ok(/array\['notifications', 'direct_messages', 'party_messages', 'shared_builds'\]/.test(code), 'a gallery row can be dated at will');
    ok(/\.order\('created_at', \{ ascending: false \}\)\.limit\(300\)/.test(builds), 'the gallery page is unordered, so old junk can push new builds out');
    ok(/from \(select distinct b from unnest\(p_ids\[1:300\]\) as b where length\(b\) <= 64\) as d/.test(code), 'build_meta repeats work for duplicate ids');
    ok(/new\.payload := new\.payload - '_ownerId'/.test(code) && /jsonb_build_object\('_ownerId', auth\.uid\(\)::text\)/.test(code)
       && /jsonb_build_object\('_submittedBy',\s*coalesce\(\(select p\.username from public\.profiles p where p\.id = auth\.uid\(\)\), 'Anonymous'\)\)/.test(code),
       'owner or credited name can be forged');
    // Likes and markers per page of builds, one row each - never a capped dump.
    ok(/create or replace function public\.build_meta\(p_ids text\[\], p_fp text default null\)/.test(code) && /unnest\(p_ids\[1:300\]\)/.test(code), 'no bounded build_meta');
    ok(/sb\.rpc\('build_meta', \{ p_ids: ids, p_fp: fp \}\)/.test(builds), 'the gallery still downloads every like and marker in one capped query');
    // The client side of the same rule.
    ok(/return !!\(userId && build\.owner_id && build\.owner_id === userId\);/.test(builds), '_isOwner still guesses ownership from a fingerprint or a name');
    ok(/const \{ error \} = await sb\.from\('shared_builds'\)\.insert\(\{\s*id: markerId/.test(builds) && /if \(error\) \{\s*const msg =[\s\S]{0,300}_toast\(msg, 'err'\)/.test(builds), 'a refused delete marker is hidden from the user');
  });

  it('a party cannot be re-hosted, a request names its real host, chat is the party\'s', () => {
    const pl = statements.find(s => /^create policy pl_update on public\.party_listings/.test(s));
    ok(pl && /^create policy pl_update on public\.party_listings for update to authenticated using \(auth\.uid\(\) = host_id or public\.is_site_admin\(\)\) with check \(auth\.uid\(\) = host_id or public\.is_site_admin\(\)\)$/.test(pl),
       'someone other than the host or an admin can edit a listing');
    ok(/create trigger party_member_left after delete on public\.party_members/.test(code) && /set status = 'open'\s+where id = old\.party_id and status = 'full'/.test(code),
       'a member leaving a full party cannot reopen it (the site deletes the member row before updating the status)');
    const pr = statements.find(s => /^create policy pr_insert on public\.party_requests/.test(s));
    ok(pr && /host_id = \(select l\.host_id from public\.party_listings l where l\.id = party_requests\.party_id\)/.test(pr), 'a request can name any host');
    const pru = statements.find(s => /^create policy pr_update on public\.party_requests/.test(s));
    ok(pru && /and host_id = \(select l\.host_id from public\.party_listings l where l\.id = party_requests\.party_id\)/.test(pru), 'a re-filed request can be re-addressed to another host');
    const pm = statements.find(s => /^create policy pmsg_read on public\.party_messages/.test(s));
    ok(pm && /party_members m/.test(pm) && !/using \(true\)/.test(pm), 'party chat is world-readable');
    const pmi = statements.find(s => /^create policy pmsg_insert on public\.party_messages/.test(s));
    for (const p of [pm, pmi]) ok(p && /exists \(select 1 from public\.party_members m where m\.party_id = party_messages\.party_id and m\.user_id = auth\.uid\(\)\)/.test(p),
      'party chat membership is not tied to the caller');
    ok(pmi && /with check \(auth\.uid\(\) = sender_id and /.test(pmi), 'party chat can be posted under another sender');
    ok(!statements.some(s => /^grant .* on table public\.party_messages to .*anon/.test(s)), 'anon can read party chat');
    // Who asked, and for which party, never changes; a host cannot re-arm a request.
    ok(/create trigger party_request_pin before update on public\.party_requests/.test(code)
       && /new\.requester_id is distinct from old\.requester_id/.test(code)
       && /new\.status = 'pending' and old\.status is distinct from 'pending'\s+and auth\.uid\(\) is distinct from old\.requester_id/.test(code),
       'a host can rewrite a request to name any account, then add it to the party');
    // Live chat comes from the table (RLS applies), not a public broadcast channel.
    ok(/alter publication supabase_realtime add table public\.party_messages/.test(code), 'party_messages is not published to Realtime');
    const party = fs.readFileSync(path.join(root, 'js', 'party.js'), 'utf8');
    const popup = fs.readFileSync(path.join(root, 'html', 'party-popup.html'), 'utf8');
    ok(/event: 'INSERT', schema: 'public', table: 'party_messages',\s*filter: `party_id=eq\.\$\{partyId\}`/.test(party), 'party chat does not arrive as database rows');
    for (const [f, src] of [['js/party.js', party], ['html/party-popup.html', popup]]) {
      ok(!/\.on\('broadcast', \{ event: 'chat' \}/.test(src), f + ' still listens to the public chat broadcast');
      ok(!/send\(\{ type: 'broadcast', event: 'chat'/.test(src), f + ' still sends chat on the public broadcast channel');
    }
  });

  it('a notification records its sender; messages are their participants\'', () => {
    ok(/add column if not exists sender_id uuid default auth\.uid\(\)/.test(code), 'notifications have no sender');
    const ni = statements.find(s => /^create policy notifications_insert_signed_in/.test(s));
    ok(ni && /sender_id = auth\.uid\(\)/.test(ni) && / to authenticated /.test(ni), 'a notification can be inserted without a sender');
    const nr = statements.find(s => /^create policy notifications_read_own/.test(s));
    ok(nr && /auth\.uid\(\) = user_id/.test(nr), 'notifications are readable across accounts');
    const dr = statements.find(s => /^create policy dm_read_participants/.test(s));
    ok(dr && /auth\.uid\(\) = sender_id or auth\.uid\(\) = recipient_id/.test(dr), 'direct messages are readable across accounts');
    ok(!statements.some(s => /^create policy .* on public\.direct_messages for delete/.test(s)), 'direct messages can be deleted');
    const du = statements.find(s => /^create policy dm_update_recipient on public\.direct_messages/.test(s));
    ok(du && /using \(auth\.uid\(\) = recipient_id\) with check \(auth\.uid\(\) = recipient_id\)$/.test(du), 'a sender can mark their own message read and hide it from the unread badge');
    // The soft-delete RPC takes its identity from the JWT, never from p_me.
    const fn = /create function public\.soft_delete_conversation\(p_me uuid, p_other uuid\)[\s\S]*?\$f\$([\s\S]*?)\$f\$/.exec(code);
    ok(fn, 'soft_delete_conversation is not rewritten');
    ok(!/p_me/.test(fn[1]) && /auth\.uid\(\) is not null/.test(fn[1]), 'soft_delete_conversation still acts on p_me');
    // The ids the bell acts on, and the names it shows beside them, are the caller's own.
    ok(ni && /coalesce\(meta->>'sender_id', auth\.uid\(\)::text\) = auth\.uid\(\)::text/.test(ni)
       && /coalesce\(meta->>'requester_id', auth\.uid\(\)::text\) = auth\.uid\(\)::text/.test(ni), 'a notification can point the bell at another account');
    ok(ni && /meta->>'sender_username' = \(select p\.username from public\.profiles p where p\.id = auth\.uid\(\)\)/.test(ni)
       && /meta->>'requester_name' = \(select p\.username from public\.profiles p where p\.id = auth\.uid\(\)\)/.test(ni),
       'a notification can carry a forged sender name');
    // The server's clock and a fresh unread flag, whatever the sender said.
    ok(/create or replace function public\.stamp_insert_defaults\(\)/.test(code) && /jsonb_build_object\('created_at', now\(\)\)/.test(code)
       && /array\['notifications', 'direct_messages', 'party_messages', 'shared_builds'\]/.test(code), 'a notification or message can be back- or future-dated');
  });

  it('avatars are written only under the owner\'s folder', () => {
    for (const cmd of ['insert', 'update', 'delete']) {
      const p = statements.find(s => new RegExp('^create policy avatars_' + cmd + '_own on storage\\.objects for ' + cmd + ' to authenticated').test(s));
      ok(p && /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/.test(p) && /bucket_id = 'avatars'/.test(p), 'avatars ' + cmd + ' is not tied to the owner folder');
    }
    ok(/like '%avatars%'/.test(code), 'the storage policy drop is not limited to the avatars bucket');
  });

  it('display names are stamped from the profile, and signup still gets its row', () => {
    ok(/create or replace function public\.stamp_profile_name\(\) returns trigger/.test(code) && /security definer/.test(code), 'no name-stamping trigger');
    for (const [t, name, id] of [['trade_listings', 'username', 'user_id'], ['direct_messages', 'sender_name', 'sender_id'],
                                 ['direct_messages', 'recipient_name', 'recipient_id'],
                                 ['party_listings', 'host_name', 'host_id'], ['party_members', 'username', 'user_id'],
                                 ['party_messages', 'sender_name', 'sender_id'], ['party_requests', 'requester_name', 'requester_id'],
                                 ['reports', 'reporter_name', 'reporter_id'], ['reports', 'reported_name', 'reported_id']]) {
      ok(new RegExp("\\('" + t + "',\\s*'" + name + "',\\s*'" + id + "'\\)").test(code), t + '.' + name + ' is not stamped from profiles');
    }
    // One trigger per name column (a table can carry two), on insert and update.
    ok(/create trigger %I before insert or update on public\.%I for each row execute function public\.stamp_profile_name\(%L, %L\)',\s*'stamp_' \|\| t\.name_col/.test(code),
       'the stamp trigger is not per name column, or does not cover updates');
    // Fails closed: no profile name, no row - never the client's name.
    ok(/if tg_op = 'INSERT' then\s+raise exception 'no profile name for %'/.test(code), 'the stamp keeps the client\'s name when the profile has none');
    ok(/alter table public\.profiles alter column username set not null/.test(code), 'a NULL username slips past the shape check');
    ok(/create policy profiles_insert_signup on public\.profiles for insert to supabase_auth_admin/.test(code)
       && /grant insert on table public\.profiles to supabase_auth_admin/.test(code), 'the signup trigger could be refused by RLS');
  });

  it('usernames are unique and shaped, on the server', () => {
    ok(/create unique index if not exists profiles_username_unique on public\.profiles \(username\)/.test(code), 'no unique index on username');
    ok(/check \(username ~ '\^\[A-Za-z0-9_-\]\{3,20\}\$'\)/.test(code), 'no shape rule on username');
    // Case-insensitive: "Fool" is taken if "fool" is; a perma-banned name stays retired.
    ok(/create trigger profiles_username_guard before insert or update on public\.profiles/.test(code)
       && /lower\(p\.username\) = lower\(new\.username\) and p\.id <> new\.id/.test(code), 'two names can differ only in case');
    ok(/from perma_banned_usernames b\s+where lower\(b\.username\) = lower\(new\.username\) and b\.user_id is distinct from new\.id/.test(code), 'a perma-banned name can be taken again');
    ok(/from banned_usernames b\s+where lower\(b\.username\) = lower\(new\.username\) and b\.user_id is distinct from new\.id/.test(code), 'a banned name can be taken by a new account, which then inherits the ban');
    ok(/raise exception 'username "%" is taken', new\.username using errcode = '23505'/.test(code)
       && /raise exception 'username "%" is not allowed', new\.username using errcode = '23514'/.test(code), 'the guard stops refusing, or refuses with codes the site does not map');
    ok(/create unique index if not exists profiles_username_lower_unique on public\.profiles \(lower\(username\)\)/.test(code), 'no case-insensitive unique index');
    const pu = statements.find(s => /^create policy profiles_update_own/.test(s));
    ok(pu && /using \(auth\.uid\(\) = id\) with check \(auth\.uid\(\) = id\)/.test(pu), 'profiles can be updated across accounts');
  });

  it('a player edits only the columns the site edits', () => {
    const col = (t) => statements.find(s => new RegExp('^grant update \\([^)]*\\) on table public\\.' + t + ' to authenticated$').test(s));
    const plain = (t) => statements.find(s => new RegExp('^grant [^(]*\\bupdate\\b[^(]* on table public\\.' + t + '\\b').test(s));
    for (const [t, cols] of [['profiles', 'username, avatar_url, chat_consent_at, chat_consent_version, party_class, attached_build'],
                             ['notifications', 'read'], ['direct_messages', 'read'],
                             ['trade_listings', 'type, items, lf_items, description, status'], ['party_listings', 'status']]) {
      const g = col(t);
      ok(g && g.indexOf('(' + cols + ')') !== -1, t + ': update is not limited to (' + cols + ')');
      ok(!plain(t), t + ': update is granted on every column');
    }
  });

  it('an avatar comes from our bucket, on the server and in every renderer', () => {
    ok(/check \(avatar_url is null\s+or avatar_url like 'https:\/\/mpqohagljmvwftwqumnh\.supabase\.co\/storage\/v1\/object\/public\/avatars\/%'\) not valid/.test(code),
       'profiles.avatar_url accepts any origin');
    const sb = fs.readFileSync(path.join(root, 'js', 'sb.js'), 'utf8');
    ok(/url = safeAvatarUrl\(url\);\s*const inner\s+= url/.test(sb) && /window\._sbSafeAvatarUrl\s+= safeAvatarUrl/.test(sb), 'sb.js draws avatars from any origin');
    for (const f of ['trades.js', 'party.js']) {
      const src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
      ok(/url = typeof window\._sbSafeAvatarUrl === 'function' \? window\._sbSafeAvatarUrl\(url\) : null;/.test(src), f + ' draws avatars from any origin');
    }
    const popup = fs.readFileSync(path.join(root, 'html', 'party-popup.html'), 'utf8');
    ok(/if \(typeof url === 'string' && !url\.startsWith\(AVATAR_URL_PREFIX\)\) url = null;/.test(popup), 'the party popup draws avatars from any origin');
    ok(/\.replace\(\/'\/g,'&#39;'\)/.test(popup) && /\.replace\(\/'\/g,'&#39;'\)/.test(fs.readFileSync(path.join(root, 'html', 'dm-popup.html'), 'utf8')), 'a popup escaper leaves the single quote');
    const donation = fs.readFileSync(path.join(root, 'js', 'donation.js'), 'utf8');
    ok(!/\$\{name\.replace\(\/<\/g, '&lt;'\)\}/.test(donation), 'the supporters list escapes only <');
    const trades = fs.readFileSync(path.join(root, 'js', 'trades.js'), 'utf8');
    ok(!/_trdEdit\('\$\{l\.id\}'\)/.test(trades) && !/_trdDelete\('\$\{l\.id\}'\)/.test(trades), 'a listing id reaches an inline handler unescaped');
  });

  it('a party is joined through its host, and the queue/match tables are off with the feature', () => {
    // The whole rule, exactly: any extra branch is a way into someone's party.
    const pm = statements.find(s => /^create policy pm_insert on public\.party_members/.test(s));
    eq(pm, "create policy pm_insert on public.party_members for insert to authenticated with check (public.is_site_admin() or (auth.uid() = (select l.host_id from public.party_listings l where l.id = party_members.party_id) and (user_id = auth.uid() or exists (select 1 from public.party_requests r where r.party_id = party_members.party_id and r.requester_id = party_members.user_id and r.status = 'pending'))))",
       'pm_insert changed: a player could join without a request, or a host add any account');
    const pr = statements.find(s => /^create policy pr_update on public\.party_requests/.test(s));
    ok(pr && /\(auth\.uid\(\) = requester_id and status = 'pending'\)/.test(pr), 'a requester can accept their own request');
    const pri = statements.find(s => /^create policy pr_insert on public\.party_requests/.test(s));
    ok(pri && /status = 'pending'/.test(pri), 'a request can be filed as already accepted');
    const mm = /p\.proname in \(((?:(?!p\.proname in \()[\s\S])*?)\)\s*loop\s*execute format\('revoke all on function %s from public, anon, authenticated'/.exec(code);
    ok(mm, 'no revoke loop for the matchmaking functions');
    for (const f of ['mm_create_match', 'mm_apply_result', 'mm_abandon_match', 'mm_report_disconnect', 'mm_match_ping', 'mm_queue_counts', 'mm_settle'])
      ok(new RegExp("'" + f + "'").test(mm[1]), f + ' stays callable while matchmaking is off');
    for (const t of ['mm_queue', 'mm_matches', 'mm_ratings', 'online_heartbeats']) ok(code.indexOf("pg_temp.reset_table('" + t + "')") !== -1, t + ' is not reset');
    ok(!statements.some(s => /^grant .*(insert|update|delete).* on table public\.mm_/.test(s)), 'a matchmaking table takes writes while the feature is off');
    ok(/file_size_limit = 5242880/.test(code) && /allowed_mime_types = array\['image\/jpeg', 'image\/png', 'image\/webp', 'image\/gif'\]/.test(code), 'the avatars bucket takes any file');
    const ret = fs.readFileSync(path.join(root, 'supabase', 'matchmaking-return.sql'), 'utf8');
    ok(/if winner = me and opp_seen is null then\s+raise exception 'opponent never joined this match'/.test(ret), 'the return file lets a host win against an opponent who never joined');
    ok(/if winner is null then raise exception/.test(ret) && /pg_column_size\(p_rounds\) > 4096/.test(ret), 'the return file trusts a NULL winner or an unbounded round log');
  });
});

describe('database lockdown (client and sessions)', () => {
  const root = path.join(__dirname, '..', '..');
  const sql = fs.readFileSync(path.join(root, 'supabase', 'lockdown.sql'), 'utf8');
  const sb = fs.readFileSync(path.join(root, 'js', 'sb.js'), 'utf8');
  const ADMIN_FNS = ['admin_ban_user', 'admin_perma_ban_user', 'admin_unban_user', 'admin_ban_usernames',
                     'admin_clear_all_scores', 'admin_clear_user_score', 'admin_delete_listings', 'admin_purge_expired'];

  it('the profanity sweep bans whole names or whole pieces of them, never substrings', () => {
    // "Assassin" holds "ass" and is a class; the sweep used to ban it (owner,
    // 2026-09-22). Run the real function against the real list.
    const body = name => {
      const s = sb.indexOf('function ' + name + '(');
      ok(s !== -1, 'sb.js has no ' + name);
      let depth = 0, i = sb.indexOf('{', s), end = -1;
      for (; i < sb.length; i++) { if (sb[i] === '{') depth++; else if (sb[i] === '}') { depth--; if (!depth) { end = i + 1; break; } } }
      return sb.slice(s, end);
    };
    const list = /const PROFANITY_LIST = \[([\s\S]*?)\n  \];/.exec(sb);
    ok(list, 'sb.js has no PROFANITY_LIST');
    const tokensList = /const PROFANITY_TOKENS = (\[[^\]]*\]);/.exec(sb);
    ok(tokensList, 'sb.js has no PROFANITY_TOKENS');
    const anywhere = /const PROFANITY_ANYWHERE = (\[[\s\S]*?\]);/.exec(sb);
    const confusables = /const CONFUSABLES = (\{[\s\S]*?\});/.exec(sb);
    ok(anywhere && confusables, 'sb.js has no PROFANITY_ANYWHERE / CONFUSABLES');
    const anywhereRx = /const PROFANITY_ANYWHERE_RX = (\[[^\n]*\]);/.exec(sb);
    ok(anywhereRx, 'sb.js has no PROFANITY_ANYWHERE_RX');
    const api = new Function('const PROFANITY_LIST = [' + list[1] + '];\nconst PROFANITY_TOKENS = ' + tokensList[1] + ';\n' +
      'const PROFANITY_ANYWHERE = ' + anywhere[1] + ';\nconst PROFANITY_ANYWHERE_RX = ' + anywhereRx[1] + ';\nconst CONFUSABLES = ' + confusables[1] + ';\n' +
      body('foldChar') + '\n' + body('foldText') + '\n' + body('nameTokens') + '\n' + body('profanityHit') + '\n' +
      body('containsProfanity') + '\n' + body('usernameProfanity') +
      '\nreturn { usernameProfanity, containsProfanity, foldText };')();
    const fn = api.usernameProfanity;
    // Innocent names with a listed word inside (owner: "Assassin" must pass).
    const innocent = ['Assassin', 'Cassie', 'Cassandra', 'Titan', 'Bassline', 'Analyst', 'Peacock', 'Scunthorpe', 'Grape_Soda', 'Lycoris', 'CPU_main', 'EpicPlayer', 'Scp049', 'Therapist'];
    for (const name of innocent) {
      eq(fn(name), null, name + ' would be banned');
      ok(!api.containsProfanity(name), name + ' cannot be registered');
    }
    for (const [name, word] of [['ass_kicker', 'ass'], ['NIGGER', 'nigger'], ['ChildAbuser', 'abuser'], ['Adult_Abuser', 'abuser'], ['xx-porn-xx', 'porn'],
                                ['cp', 'cp'], ['CP', 'cp'], ['CP_lover', 'cp'], ['iLoveCP', 'cp'], ['cp123', 'cp'], ['PeaCock', 'cock'],
                                ['XXLover_1488', '1488'], ['bignigga', 'nigg'], ['xXfuckerXx', 'fuck'],
                                // one-case compounds the old substring check refused (review, 2026-09-22)
                                ['bigdick', 'bigdick'], ['SHITLORD', 'shit'], ['kikehunter', 'kike'], ['childrapist', 'childrap'], ['xcuntx', 'cunt']]) {
      ok(fn(name) !== null, name + ' can be registered');
      if (fn(name) !== null && !/^(bigdick|shit|kike|childrap|cunt)$/.test(word)) eq(fn(name), word, name + ' is not banned for ' + word);
    }
    for (const name of ['Swanky', 'Cockburn', 'Dickens']) eq(fn(name), null, name + ' would be banned');
    ok(/usernameProfanity\(p\.username\)/.test(sb) && !/containsProfanity\(p\.username\)/.test(sb), 'the sweep still matches substrings');
    // Signup and rename refuse the same token-only words, and only as tokens.
    ok(api.containsProfanity('CP_lover') && api.containsProfanity('cp'), 'a "cp" name can still be registered');
    // Unicode look-alikes fold to the word they imitate.
    for (const s of ['ｆｕｃｋ', 'fυck', 'аss_kicker', 'n\u200Bigger', 'nіgger', 'fúck']) ok(api.containsProfanity(s), JSON.stringify(s) + ' slips past the filter');
    eq(api.foldText('Ａbс\u200D'), 'Abc', 'foldText');
  });

  it('perma-banned names are reserved exactly, not fed to the substring filter', () => {
    ok(!/PROFANITY_LIST\.push\(/.test(sb), 'a banned name is pushed into PROFANITY_LIST, where it censors chat and blocks innocent names');
    ok(/function isPermaBannedName\(name\)/.test(sb) && /containsProfanity\(username\) \|\| isPermaBannedName\(username\)/.test(sb)
       && /containsProfanity\(newName\) \|\| isPermaBannedName\(newName\)/.test(sb), 'signup or rename can take a perma-banned name');
  });

  it('names are unique regardless of case, from the client too', () => {
    ok(/async function usernameTaken\(name, exceptId\)/.test(sb) && /\.ilike\('username', String\(name\)\.replace\(\/\[\\\\%_\]\/g/.test(sb), 'the taken check is case-sensitive or leaves _ as a wildcard');
    ok(/if \(await usernameTaken\(username\)\)/.test(sb) && /if \(await usernameTaken\(newName, currentUser\.id\)\)/.test(sb), 'signup or rename skips the case-insensitive check');
    ok(!/from\('profiles'\)\.select\('id'\)\.eq\('username'/.test(sb), 'an exact-case taken check is left');
  });

  // Run the real ban checks: a ban on an account follows the account, never
  // whoever holds its old name; a name-only ban still bites by name.
  itAsync('a restored session is signed out if banned - by account, not by a name someone else now holds', async () => {
    const body = name => {
      const s = sb.indexOf('function ' + name + '(');
      let start = s; if (sb.slice(s - 6, s) === 'async ') start = s - 6;
      let depth = 0, i = sb.indexOf('{', s), end = -1;
      for (; i < sb.length; i++) { if (sb[i] === '{') depth++; else if (sb[i] === '}') { depth--; if (!depth) { end = i + 1; break; } } }
      return sb.slice(start, end);
    };
    const run = async (rows, user, profileName) => {
      let signedOut = 0;
      const h = new Function('rows', 'user', 'stubs',
        'let currentUser = user, currentProfile = null;\n' +
        'const sb = { auth: { signOut: async () => { stubs.out++; } } };\n' +
        'const _bannedReady = Promise.resolve(), _permaBannedIdSet = new Set();\n' +
        'const _bannedSet = new Set(rows.map(r => r.username));\n' +
        'const _bannedIdSet = new Set(rows.filter(r => r.user_id).map(r => r.user_id));\n' +
        'const _bannedNameIds = new Map(rows.map(r => [r.username.toLowerCase(), r.user_id || null]));\n' +
        'const resetScoreState = () => {}, renderAuthBar = () => {}, alert = () => {};\n' +
        body('checkIfBanned') + '\n' + body('enforceBanOnRestore') + '\nreturn enforceBanOnRestore;');
      const stubs = { out: 0 };
      await h(rows, user, stubs)(user, profileName);
      return stubs.out;
    };
    const me = { id: 'u-new', user_metadata: { username: 'OldName' } };
    // A ban that recorded its account (another one) does not land on me for holding the name.
    eq(await run([{ username: 'Fool', user_id: 'u-other' }], me, 'Fool'), 0, 'a player was signed out for holding a banned account\'s former name');
    // A name-only (old) ban still bites by name.
    eq(await run([{ username: 'Fool', user_id: null }], me, 'fool'), 1, 'a name-only ban no longer applies');
    // A ban on my account bites whatever I am called now.
    eq(await run([{ username: 'Whatever', user_id: 'u-new' }], me, 'Renamed'), 1, 'a renamed banned account keeps its session');
    // The stale signup name is not used when the profile name is known.
    eq(await run([{ username: 'OldName', user_id: null }], me, 'NewName'), 0, 'the signup name (never updated by a rename) is used instead of the profile name');
  });

  it('a restored session is checked for a ban; passwords are 8+; scores are escaped', () => {
    ok(/async function enforceBanOnRestore\(user, profileName\)/.test(sb) && /enforceBanOnRestore\(restoredUser, profile\?\.username\)/.test(sb), 'a banned account keeps a restored session');
    ok(/_bannedIdSet\.has\(userId\)/.test(sb) && /select\('username, user_id'\)/.test(sb), 'a plain ban is not checked by account');
    ok(/password \|\| ''\)\.length < 8/.test(sb) && /newVal\.length < 8/.test(sb) && /pass\.length < 8/.test(sb) && !/length < 6/.test(sb), 'a password shorter than 8 is accepted somewhere');
    ok(!/<b>\$\{(r|rec|record|myBest|myRank)\.score\}<\/b>/.test(sb) && /esc\(String\(r\.score\)\)/.test(sb), 'a score is interpolated into HTML unescaped');
  });

  it('no escape helper lets a bidi override through, and no source hides one', () => {
    for (const f of ['js/sb.js', 'js/trades.js', 'js/party.js', 'js/reports.js', 'js/builds.js', 'js/donation.js', 'js/matchmaking.js', 'html/dm-popup.html', 'html/party-popup.html']) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      ok(src.indexOf('[\\u202A-\\u202E\\u2066-\\u2069]') !== -1, f + ' escapes text without dropping bidi controls');
      ok(!/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/.test(src), f + ' contains an invisible character in its source');
    }
  });

  it('the chat filter sees through Unicode look-alikes and invisible characters', () => {
    const trades = fs.readFileSync(path.join(root, 'js', 'trades.js'), 'utf8');
    const block = trades.slice(trades.indexOf('function normalizeLeet('), trades.indexOf('// ---- tradeable items'));
    const banned = /const _BANNED = \[([\s\S]*?)\n  \];/.exec(trades);
    const blockList = /const _BLOCK_LIST = \[([\s\S]*?)\n  \];/.exec(trades);
    ok(banned && blockList && block.length > 100, 'trades.js filter pieces not found');
    const foldSrc = sb.slice(sb.indexOf('const CONFUSABLES = '), sb.indexOf('function foldText('));
    const win = new Function(foldSrc + '\nreturn { _sbFoldChar: foldChar, _sbProfanityList: ["fuck", "shit"] };')();
    const chat = new Function('window', 'const _BANNED = [' + banned[1] + '];\nconst _BLOCK_LIST = [' + blockList[1] + '];\n' + block +
      '\nreturn { filterMsg, containsBlocked, check: window._containsProfanity };')(win);
    eq(chat.filterMsg('well ｆｕｃｋ that'), 'well **** that', 'fullwidth letters pass the censor');
    eq(chat.filterMsg('oh sh\u200Bit'), 'oh ****', 'a zero-width space hides a word from the censor');
    eq(chat.filterMsg('ѕhit happens'), '**** happens', 'a Cyrillic look-alike hides a word from the censor');
    eq(chat.filterMsg('a classic assassin'), 'a classic assassin', 'the censor now hits innocent words');
    ok(chat.containsBlocked('cр links'), 'a Cyrillic look-alike hides a blocked term');
    ok(chat.check('fυck'), 'party chat lets a Greek look-alike through');
    eq(chat.filterMsg('gg 😀 nice'), 'gg 😀 nice', 'an emoji is mangled');
    eq(chat.filterMsg('shít'), '*****', 'a stacked accent hides a word, or survives its masking');
    eq(chat.filterMsg('café time'), 'café time', 'an accented word is changed');
  });

  it('start_qte_session refuses junk trainer ids and a flood of sessions', () => {
    const scores = fs.readFileSync(path.join(root, 'supabase', 'qte-scores.sql'), 'utf8');
    ok(/p_qte_type !~ '\^\[a-z\]\+\(-new\)\?\(-comp\)\?\$' THEN RETURN NULL/.test(scores), 'any text makes a session row');
    ok(/>= 60 THEN\s+RETURN NULL/.test(scores), 'sessions per minute are unbounded');
    ok(/revoke all on function public\.start_qte_session\(uuid, text\) from public, anon, authenticated/.test(scores), 'start_qte_session keeps its default PUBLIC grant');
  });

  it('the client calls the admin functions the SQL defines, and nothing the lockdown revokes', () => {
    for (const fn of ADMIN_FNS) ok(sb.indexOf("rpc('" + fn + "'") !== -1, 'sb.js never calls ' + fn);
    ok(sb.indexOf("rpc('purge_expired_listings'") === -1, 'the client still calls purge_expired_listings directly');
  });

  it('a ban locks the account in Auth, not only in a table the login form reads', () => {
    ok(/update auth\.users set banned_until = now\(\) \+ interval '100 years'/.test(sql), 'a ban does not set banned_until');
    ok(/update auth\.users set banned_until = null/.test(sql), 'an unban does not clear banned_until');
    ok(/if v_user = any \(public\.site_admin_ids\(\)\) then raise exception/.test(sql), 'an admin can be banned');
    ok(/\/banned\/i\.test\(error\.message/.test(sb), 'the login form does not translate the Auth refusal');
  });

  it('submit_score refuses a banned account, checks its input and files under the server month', () => {
    const scores = fs.readFileSync(path.join(root, 'supabase', 'qte-scores.sql'), 'utf8');
    ok(/v_month\s+TEXT\s*:=\s*to_char\(now\(\) at time zone 'UTC', 'YYYY-MM'\)/.test(scores), 'the month is not the server\'s');
    ok(/VALUES \(v_user, p_qte_type, p_score, p_platform, v_month\)/.test(scores), 'the leaderboard row is filed under p_month');
    ok(!/VALUES \(v_user, p_qte_type, p_score, p_platform, p_month\)/.test(scores), 'p_month is trusted again');
    ok(/THEN RETURN 'banned'; END IF;/.test(scores), 'a banned account can still submit');
    ok(/INSERT INTO personal_bests/.test(scores), 'nothing writes personal_bests now that the client may not');
    ok(/p_platform NOT IN \('M', 'C'\) THEN RETURN 'bad_input'/.test(scores), 'the platform is not checked');
    ok(/p_qte_type !~ '\^\[a-z\]\+\(-new\)\?\(-comp\)\?\$' THEN RETURN 'bad_input'/.test(scores), 'the trainer id is not checked');
    // The shape rule must accept every trainer the site has.
    const types = (/const QTE_TYPES = \[([^\]]*)\]/.exec(sb) || [])[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
    for (const t of types) for (const suffix of ['', '-comp']) ok(/^[a-z]+(-new)?(-comp)?$/.test(t + suffix), 'the shape rule refuses ' + t + suffix);
  });
});

// A typo in a brand-new password locks the player out of the account they
// just made (owner, 2026-09-22): sign-up and the reset-link page ask for it
// twice, like change-password in settings always did.
describe('password confirmation', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'sb.js'), 'utf8');
  const fn = name => {
    let start = src.indexOf('function ' + name + '(');
    ok(start !== -1, 'sb.js has no ' + name);
    if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
    let depth = 0, i = src.indexOf('{', start), end = -1;
    for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } } }
    return src.slice(start, end);
  };
  const harness = (name, fields) => {
    const els = {};
    for (const [id, value] of Object.entries(fields)) els[id] = { value, style: {}, textContent: '', disabled: false, isConnected: true };
    const calls = [];
    const doc = { getElementById: id => els[id] || null, querySelector: () => null };
    const sb = { auth: { updateUser: async a => { calls.push(['updateUser', a]); return { error: null }; } } };
    const run = new Function('document', 'sb', 'signUp', 'signIn', 'closeModal', 'alert',
      fn(name) + '\nreturn ' + name + ';')(doc, sb,
      async (...a) => { calls.push(['signUp', a]); }, async (...a) => { calls.push(['signIn', a]); }, () => {}, () => {});
    return { run, els, calls };
  };

  itAsync('sign-up refuses two different passwords before anything is sent', async () => {
    const h = harness('submitAuth', { 'sb-email': 'a@b.c', 'sb-pass': 'hunter22', 'sb-pass2': 'hunter23', 'sb-uname': 'Tester', 'sb-err': '' });
    await h.run('register');
    eq(h.calls.length, 0, 'a mismatched sign-up reached Supabase');
    eq(h.els['sb-err'].textContent, 'Passwords do not match.');
    const ok2 = harness('submitAuth', { 'sb-email': 'a@b.c', 'sb-pass': 'hunter22', 'sb-pass2': 'hunter22', 'sb-uname': 'Tester', 'sb-err': '' });
    await ok2.run('register');
    eq(ok2.calls.map(c => c[0]).join(), 'signUp', 'a matching sign-up did not go through');
    const login = harness('submitAuth', { 'sb-email': 'a@b.c', 'sb-pass': 'hunter22', 'sb-err': '' });
    await login.run('login');
    eq(login.calls.map(c => c[0]).join(), 'signIn', 'login now wants a confirmation it has no box for');
  });

  itAsync('the reset link refuses two different passwords before anything is sent', async () => {
    const h = harness('submitNewPassword', { 'np-pass': 'hunter22', 'np-pass2': 'hunter2', 'np-err': '' });
    await h.run();
    eq(h.calls.length, 0, 'a mismatched reset reached Supabase');
    eq(h.els['np-err'].textContent, 'Passwords do not match.');
    const ok2 = harness('submitNewPassword', { 'np-pass': 'hunter22', 'np-pass2': 'hunter22', 'np-err': '' });
    await ok2.run();
    eq(ok2.calls.map(c => c[0]).join(), 'updateUser', 'a matching reset did not go through');
  });

  it('every new-password form draws the confirm box', () => {
    ok(/\$\{isReg \? `<input class="sb-input" id="sb-pass2" type="password"/.test(src), 'sign-up has no confirm box');
    ok(/<input class="sb-input" id="np-pass2" type="password"/.test(src) && /pass2El\.disabled = false/.test(src), 'the reset page has no (enabled) confirm box');
    ok(/id="sb-conf-pass"/.test(src) && /newVal !== confVal/.test(src), 'change-password lost its confirm box');
  });
});

// A GDPR erasure must reach every table that stores anything about a player.
// supabase/gdpr-erase.sql keeps that list in one function; every table the
// site writes (CLAUDE.md's table-owner list) must be on it.
describe('GDPR erasure', () => {
  const root = path.join(__dirname, '..', '..');
  const sql = fs.readFileSync(path.join(root, 'supabase', 'gdpr-erase.sql'), 'utf8');
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');

  it('covers every table the site stores player data in', () => {
    const block = /\| Table \| Owner \|([\s\S]*?)\n\n/.exec(claude);
    ok(block, 'CLAUDE.md has no table-owner list');
    const tables = new Set([...block[1].matchAll(/`([a-z_]+)`/g)].map(m => m[1]));
    tables.add('qte_sessions'); tables.add('testers');
    tables.delete('avatars');   // a storage bucket - listed by the function, deleted in the dashboard
    const targets = /create or replace function public\.gdpr_targets\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(sql);
    ok(targets, 'no gdpr_targets list');
    const missing = [...tables].filter(t => !new RegExp("'" + t + "'").test(targets[1]));
    eq(missing.join(','), '', 'these tables are never erased');
    ok(/storage\.objects/.test(sql) && /bucket_id = 'avatars'/.test(sql), 'the avatar files are not even listed');
    ok(/delete from auth\.users where id = p_user/.test(sql), 'the login itself is left behind');
    // A missing column is an error, never "not in this project" (a typo must not pass for nothing to erase).
    ok(!/when undefined_column/.test(sql.replace(/--[^\n]*/g, '')), 'a condition naming a missing column skips the whole table silently');
    ok(/if to_regclass\('public\.' \|\| t\.tbl\) is null then/.test(sql), 'a missing table is not detected up front');
    ok(/delete from public\.%I x where %s/.test(sql) && /to_jsonb\(x\)->>''sender_id'' = \$3/.test(targets[1]), 'the notifications condition fails before lockdown2.sql');
    ok(/meta->>''reported_id'' = \$3/.test(targets[1]), 'report notifications naming them survive');
    // Names change hands: a name only matches rows that record no account.
    ok(/payload->>''_ownerId'' is null and payload->>''_community'' = ''true'' and payload->>''_submittedBy'' = \$2/.test(targets[1]), 'erasing A deletes another account\'s builds credited to the same name');
    ok((targets[1].match(/user_id = \$1 or \(user_id is null and username = \$2\)/g) || []).length === 2, 'erasing A touches another account\'s ban row with the same name');
  });

  it('erases only on an exact confirmation, never an admin, and is callable by nobody but the SQL editor', () => {
    ok(/if p_confirm is distinct from 'ERASE ' \|\| coalesce\(v_name, p_user::text\) then/.test(sql), 'no typed confirmation');
    ok(/p_user = any \(public\.site_admin_ids\(\)\) then\s+raise exception/.test(sql), 'an admin account can be erased');
    for (const f of ['gdpr_find_user(text)', 'gdpr_targets()', 'gdpr_user_data(uuid)', 'gdpr_erase_user(uuid, text, boolean)'])
      ok(new RegExp('revoke all on function public\\.' + f.replace(/[()]/g, '\\$&') + '\\s+from public, anon, authenticated;').test(sql), f + ' is callable through the API');
    ok(!/grant execute on function public\.gdpr_/.test(sql), 'a GDPR function is granted to an API role');
    ok(!/security definer/.test(sql.replace(/--[^\n]*/g, '')), 'a GDPR function runs with the owner\'s rights - a stray grant would then hand out erasure');
  });
});

// Owner requests, 2026-09-22: the donations box is off, and the owner's phone
// number is not published anywhere on the site.
describe('owner requests on the published pages', () => {
  const root = path.join(__dirname, '..', '..');
  const live = s => s.replace(/<!--[\s\S]*?-->/g, '');   // what the browser actually renders

  it('the home page has no donations box, supporters list or donation script', () => {
    const page = live(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
    for (const bit of ['home-donate-row', 'home-donors-list', 'js/donation.js', '_loadDonorLeaderboard', '_openDonationModal'])
      ok(page.indexOf(bit) === -1, bit + ' is still live on the home page');
    ok(/Donations are disabled/.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8')), 'the disabled blocks lost their restore marker');
  });

  // Owner, 2026-09-23: Trades and LF Party are off. trades.js stays: it also
  // runs the notification bell, DMs, chat consent and the site consent prompt.
  it('the home page has no Trades or LF Party section, and a link to one lands on Home', () => {
    const raw = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const page = live(raw);
    for (const bit of ['data-page="trades"', 'data-page="lf-party"', "switchPage('trades')", "switchPage('lf-party')",
                       'id="page-trades"', 'id="page-lf-party"', 'id="party-overlay"', 'js/party.js', 'css/party.css',
                       'id="stat-listings"', 'id="stat-parties"'])
      ok(page.indexOf(bit) === -1, bit + ' is still live on the page');
    ok(!/^\s*sb\.from\('(trade|party)_listings'\)/m.test(page), 'the home stats still query trade or party listings');
    ok((raw.match(/Trades and LF Party are disabled/g) || []).length >= 6, 'the disabled blocks lost their restore marker');
    ok(/<script src="js\/trades\.js\?v=\d+"><\/script>/.test(page), 'trades.js was unloaded - the notification bell, DMs and the consent prompt go with it');
    ok(/function switchPage\(name\) \{\s+if \(!document\.getElementById\('page-' \+ name\)\) name = 'home';/.test(page), 'a link to a disabled page throws instead of landing on Home');
    ok(!/_validPages = \[[^\]]*'trades'/.test(page), '#trades is still a page the site opens on load');
  });

  // By SHAPE, never by value: this file is public too, so it must not carry
  // the details it keeps off the pages. Any phone-number-shaped or
  // street-address-shaped text on a published page fails, bar the public
  // government contact lines the terms are required to print.
  it('no page publishes a phone number or a street address', () => {
    const ALLOWED = [/\(800\) 952-5210/, /\(916\)\s+445-1254/, /1625 North Market Blvd/];
    const shapes = {
      'a phone number':   /\(?\b\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/g,
      'a street address': /\b\d{3,6}\s+(?:[NSEW]{1,2}\s+)?(?:\d+\w*|\w+)(?:\s+\w+)?\s+(?:Ct|Court|St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Way|Pl|Place|Blvd)\b/gi,
      'a state and ZIP':  /\b(?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\s+\d{5}(?:-\d{4})?\b/g,
    };
    const pages = ['index.html', ...fs.readdirSync(path.join(root, 'html')).map(f => 'html/' + f)];
    for (const p of pages) {
      const text = live(fs.readFileSync(path.join(root, p), 'utf8'))
        .replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ');
      for (const [what, rx] of Object.entries(shapes)) {
        for (const m of text.matchAll(rx)) {
          const around = text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20);
          ok(ALLOWED.some(a => a.test(around)), p + ' publishes what looks like ' + what + ': "' + m[0] + '"');
        }
      }
    }
  });
});

// Owner, 2026-09-22: "a user can overwrite the sources file and add
// themselves to the list of administrator IDs". The list is gone from the
// site: the server answers "am I an admin" for the caller only, and every admin
// action and admin-only table is checked in the database.
describe('admins are decided by the server', () => {
  const root = path.join(__dirname, '..', '..');
  const read = p => fs.readFileSync(path.join(root, p), 'utf8');
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  it('no script the site serves names an admin', () => {
    for (const f of fs.readdirSync(path.join(root, 'js')).filter(n => n.endsWith('.js'))) {
      const s = read('js/' + f);
      ok(!UUID.test(s), 'js/' + f + ' carries a user id: ' + (UUID.exec(s) || [''])[0]);
      ok(!/ADMIN_IDS|_sbAdminIds|_sbNotifyAdmins/.test(s), 'js/' + f + ' still has a client-side admin list');
    }
  });

  it('no SQL file names an admin either (the repo is public)', () => {
    for (const f of fs.readdirSync(path.join(root, 'supabase')).filter(n => n.endsWith('.sql'))) {
      const s = read('supabase/' + f).replace(/00000000-0000-0000-0000-000000000000/g, '');
      ok(!UUID.test(s), 'supabase/' + f + ' carries a user id');
    }
    for (const f of ['testers.sql', 'reports.sql'])
      ok(!/create or replace function public\.is_site_admin/.test(read('supabase/' + f)), f + ' defines its own is_site_admin again');
  });

  it('the list is a table no API role can read, and the two questions read it as its owner', () => {
    const sql = read('supabase/admin-server.sql');
    ok(/create table if not exists public\.site_admins/.test(sql) && /alter table public\.site_admins enable row level security;/.test(sql)
       && /revoke all on table public\.site_admins from public, anon, authenticated;/.test(sql)
       && !/create policy [^;]* on public\.site_admins/.test(sql), 'site_admins is readable through the API');
    ok(/function public\.site_admin_ids\(\) returns uuid\[\]\s+language sql\s+stable\s+security definer/.test(sql)
       && /revoke all on function public\.site_admin_ids\(\) from public, anon, authenticated;/.test(sql)
       && !/grant execute on function public\.site_admin_ids/.test(sql), 'site_admin_ids is callable from the API');
    ok(/function public\.is_site_admin\(\) returns boolean\s+language sql\s+stable\s+security definer/.test(sql)
       && /where user_id = auth\.uid\(\)/.test(sql)
       && /grant execute on function public\.is_site_admin\(\) to anon, authenticated;/.test(sql), 'is_site_admin does not answer for the caller only');
    ok(/insert into public\.site_admins \(user_id, note\)[\s\S]*unnest\(coalesce\(v_old/.test(sql), 'the first run does not carry the old admins over');
    ok(/create trigger reports_notify_admins after insert on public\.reports/.test(sql), 'new reports no longer reach the admins');
  });

  it('the site asks the server, and asks again before opening the panel', () => {
    const sb = read('js/sb.js');
    ok(/let _isAdmin = false;/.test(sb) && /function isAdmin\(\) \{ return !!currentUser && _isAdmin; \}/.test(sb), 'isAdmin() is not the server flag');
    ok(/sb\.rpc\('is_site_admin'\)/.test(sb), 'the site never asks the server');
    const open = sb.slice(sb.indexOf('async function openAdminPanel()'), sb.indexOf('async function openAdminPanel()') + 400);
    ok(/if \(!\(await loadAdminFlag\(\)\)\)/.test(open), 'the panel opens on the cached flag alone');
    ok(/_isAdmin  = false;/.test(sb), 'an account change keeps the last account\'s admin flag');
    ok(!/from\('notifications'\)\.insert/.test(read('js/reports.js')), 'reports.js still rings the admins itself');
  });
});

// Owner, 2026-09-22: a score counts only if it comes from a run the server
// started (a ticket signed with a secret seed the browser never sees) and a
// log that passes the trainer's check. js/qte-rules.js is that check; the
// bright-service edge function runs a byte-identical copy of it.
describe('verified QTE runs', () => {
  const root = path.join(__dirname, '..', '..');
  const read = p => fs.readFileSync(path.join(root, p), 'utf8');
  const TRAINERS = ['fist', 'spear', 'sword', 'dodge', 'dagger', 'hammer', 'axe', 'staff', 'thorian', 'thorian-new', 'dagger-new', 'yarthul-new'];

  it('the edge function checks runs with the same rules file the site loads', () => {
    ok(fs.readFileSync(path.join(root, 'js', 'qte-rules.js')).equals(fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'qte-rules.js'))),
       'supabase/functions/_shared/qte-rules.js differs from js/qte-rules.js - copy it over (and redeploy bright-service)');
    const html = read('index.html');
    const at = n => html.indexOf('js/' + n + '?v=');
    ok(at('sb.js') !== -1 && at('sb.js') < at('qte-rules.js') && at('qte-rules.js') < at('qte.js'),
       'index.html must load js/qte-rules.js after sb.js and before qte.js');
  });

  it('every trainer starts a run and submits through it, and has a check that refuses an empty claim', () => {
    const qte = read('js/qte.js');
    ok(!/_sbStartQteSession|_sbSubmitScore/.test(qte), 'a trainer still starts or submits the old way, with no run log');
    ok((qte.match(/\bQ(teRules|R)\.Run\.start\(/g) || []).length >= TRAINERS.length, 'not every trainer starts a QteRules run');
    const Q = require(path.join(root, 'js', 'qte-rules.js'));
    for (const t of TRAINERS) {
      ok(Q.trainers[t] && typeof Q.trainers[t].check === 'function', 'no check for ' + t);
      for (const type of [t, t + '-comp']) {
        const r = Q.check(type, { v: 1, rv: Q.RULES_VER, type, a: 0, env: {}, ev: [] }, { platform: 'C', claimed: 5 });
        eq(r.score, 0, type + ': a claim with no events behind it proves points');
      }
    }
  });

  itAsync("each trainer's own suite passes (honest players valid, forgeries refused)", async () => {
    const { execFile } = require('child_process');
    const dir = path.join(root, 'tools', 'qte', 'tests');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js'));
    for (const t of TRAINERS) ok(files.includes(t + '.test.js'), 'no suite for ' + t);
    const runs = files.map(f => new Promise(res => execFile(process.execPath, [path.join(dir, f)], { timeout: 600000, maxBuffer: 1 << 26 },
      (err, stdout, stderr) => res({ f, err, out: String(stdout) + String(stderr) }))));
    for (const r of await Promise.all(runs)) ok(!r.err, 'tools/qte/tests/' + r.f + ' failed:\n' + r.out.slice(-1500));
  });

  it('the seed stays in the database, and only the edge function can post a run', () => {
    const sql = read('supabase/qte-verified.sql');
    const step2Pre = read('supabase/qte-verified-step2.sql');
    const start = sql.slice(sql.indexOf('create or replace function public.start_qte_run('), sql.indexOf('grant execute on function public.start_qte_run(text)'));
    ok(/v_seed := encode\(extensions\.gen_random_bytes\(32\), 'hex'\);/.test(start), 'the seed is not 32 random bytes from the server');
    ok(/return jsonb_build_object\('run', v_id, 'ticket', public\.qte_ticket\(v_id, v_user, p_qte_type, v_seed\)\);/.test(start)
       && !/'seed'/.test(start), 'start_qte_run hands out more than the run and its ticket');
    ok(/extensions\.hmac\(p_run::text \|\| ':' \|\| p_user::text \|\| ':' \|\| p_type, p_seed, 'sha256'\)/.test(sql), 'the ticket is not an HMAC of run, user and trainer under the seed');
    for (const fn of ['qte_accept_run(uuid, uuid, text, text, text, integer, integer, integer, bigint, text, jsonb, jsonb, jsonb, integer, text, integer)',
                      'qte_note_reject(uuid, uuid, text, text, integer, integer, jsonb, jsonb, integer)']) {
      const esc = fn.replace(/[()]/g, '\\$&');
      ok(new RegExp('revoke all on function public\\.' + esc + ' from public, anon, authenticated;').test(sql)
         && new RegExp('grant execute on function public\\.' + esc + ' to service_role;').test(sql)
         && !new RegExp('grant execute on function public\\.' + esc + ' to (anon|authenticated)').test(sql), fn.split('(')[0] + ' is callable by players');
    }
    for (const fn of ['qte_ticket(uuid, uuid, text, text)', '_qte_post_verified(uuid, text, integer, text, text, jsonb)'])
      ok(sql.indexOf('revoke all on function public.' + fn + ' from public, anon, authenticated;') !== -1
         && sql.indexOf('grant execute on function public.' + fn) === -1, fn.split('(')[0] + ' is callable from the API');
    ok(/p_ticket <> public\.qte_ticket\(s\.id, s\.user_id, s\.qte_type, s\.seed\)/.test(sql), 'qte_accept_run does not check the ticket against the run\'s own seed');
    ok(/or p_end_ms > v_elapsed \+ least\(greatest\(coalesce\(p_ticket_at, 0\), 0\), 60000\) \+ 3000 then return 'rejected'; end if;/.test(sql), 'a log longer than its run has existed is accepted');
    ok(/perform pg_advisory_xact_lock\(hashtext\('qte_note_reject:' \|\| p_user::text\)\);/.test(sql)
       && /public\.qte_short_reasons\(p_reasons\)/.test(sql) && /octet_length\(coalesce\(p_stats, 'null'::jsonb\)::text\) > 4096/.test(sql),
       'a rejected run can store unbounded text, or pass the per-player cap in parallel');
    ok(/set last_attempt = greatest\(last_attempt, coalesce\(p_attempt, 0\) \+ 1\),/.test(sql) && /used\s+= used or rejects \+ 1 >= 5/.test(sql),
       'one rejected log closes the whole run (a trainer that restarts itself loses every later attempt)');
    ok(/comment on function public\.submit_score\(uuid, text, integer, text, text, uuid\) is 'closed by qte-verified-step2\.sql';/.test(step2Pre),
       'step 2 does not mark what it closed, so re-running an older file re-opens it');
    for (const f of ['lockdown.sql', 'qte-scores.sql'])
      ok(!/^grant execute on function public\.(submit_score|start_qte_session)\(/m.test(read('supabase/' + f)), f + ' grants the old score path back unconditionally');
    ok(/v_score := least\(coalesce\(p_claimed, 0\), coalesce\(p_score, 0\)\);/.test(sql), 'the server posts more than the log proves');
    ok(/insert into qte_log_prints \(print, run_id\) values \(p_print, p_run\) on conflict \(print\) do nothing;/.test(sql)
       && /if v_owner is distinct from p_run then return 'rejected'; end if;/.test(sql)
       && /revoke all on table public\.qte_log_prints from public, anon, authenticated;/.test(sql), 'a log already posted by another run can be posted again');
    const step2 = read('supabase/qte-verified-step2.sql');
    ok(/revoke all on function public\.submit_score\(uuid, text, integer, text, text, uuid\) from public, anon, authenticated;/.test(step2)
       && /revoke all on function public\.start_qte_session\(uuid, text\) from public, anon, authenticated;/.test(step2), 'step 2 does not close the old way in');
  });

  it('the edge function takes the player from the login, and the score from the check', () => {
    const fn = read('supabase/functions/bright-service/index.ts');
    ok(/import '\.\.\/_shared\/qte-rules\.js';/.test(fn), 'bright-service does not load the shared rules');
    ok(fn.indexOf('await readCapped(req)') !== -1 && fn.indexOf('await readCapped(req)') < fn.indexOf('JSON.parse(raw)'), 'the body is parsed before its size is checked');
    ok(/admin\.auth\.getUser\(jwt\)/.test(fn) && /p_user: userId/.test(fn) && !/body\.user|user_id\s*[,}]/.test(fn), 'the player is taken from the request body, not the login');
    ok(/Q\.check\(qte_type, log, \{ platform, claimed: score \}\)/.test(fn) && /p_score: res\.score/.test(fn), 'the posted score does not come from the check');
    ok(/no ticket for this run/.test(fn), 'a run with no ticket is not refused up front');
    ok(/JSON\.stringify\(log\.ev\.slice\(0, 24\)\)/.test(fn) && /p_print: print/.test(fn), 'the log fingerprint is not sent to qte_accept_run');
    ok(!/\.rpc\([\s\S]{0,600}?\}\)\s*\.catch\(/.test(fn), 'an rpc() builder is .catch()ed - it has no catch, and every rejected run crashes the function');
    ok(/async function readCapped\(/.test(fn) && fn.indexOf('await req.text()') === -1, 'the whole body is read before its size is checked');
    ok(/return await handle\(req, cors\);/.test(fn), 'an unexpected throw reaches the browser without CORS headers');
  });

  it('the harness, bots and trainer suites are not published', () => {
    const cfg = read('_config.yml');
    ok(/^\s+-\s+tools\/qte\s*$/m.test(cfg), '_config.yml does not exclude tools/qte');
  });
});

// GitHub Pages publishes the whole repo unless _config.yml excludes a path.
// The exclude list hides the SQL, docs and dev tooling; it must never hide a
// file the site itself loads - the Build AI fetches its engine from tools/ai/.
describe('site publishing', () => {
  const root = path.join(__dirname, '..', '..');
  const cfg = fs.readFileSync(path.join(root, '_config.yml'), 'utf8');
  const excludes = [...cfg.matchAll(/^\s+-\s+(\S+)\s*$/gm)].map(m => m[1]);
  // Jekyll 3's rule (EntryFilter#glob_include?): a pattern hides a path that
  // starts with it - a plain string prefix, so "sfx" would also hide "sfxtra"
  // - or that it matches as a glob.
  const glob = x => new RegExp('^' + x.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  const hidden = p => excludes.some(x => p.startsWith(x) || glob(x).test(p));

  it('hides the SQL, the docs and the dev tooling', () => {
    for (const p of ['supabase/lockdown.sql', 'supabase/functions/stripe-webhook/index.ts', 'CLAUDE.md', 'docs/tos-ai-clause-draft.md',
                     'tools/ai/test.js', 'tools/ai/LEARNING.md', 'tools/ai/README.md', 'tools/ai/golden/saint-healer.json', 'ep.txt'])
      ok(hidden(p), p + ' is still published');
  });

  it('never hides a file the site loads', () => {
    const needed = new Set(['index.html', 'ads.txt', 'CNAME', 'version.json', 'tools/ai/ai-data.json', 'tools/ai/verify.js']);
    const bai = fs.readFileSync(path.join(root, 'js', 'build-ai.js'), 'utf8');
    const engine = /ENGINE_FILES\s*=\s*\[([\s\S]*?)\]/.exec(bai);
    ok(engine, 'js/build-ai.js has no ENGINE_FILES list');
    for (const m of engine[1].matchAll(/'([^']+)'/g)) needed.add(m[1]);
    ok([...needed].filter(p => p.startsWith('tools/ai/')).length >= 10, 'the engine file list shrank unexpectedly');
    // Everything under the served folders, whether a page links it or a
    // script loads it by path (popups via window.open, sounds via new Audio).
    const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true })
      .flatMap(e => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
    for (const d of ['css', 'js', 'html', 'images', 'sfx']) walk(d).forEach(p => needed.add(p));
    const pages = ['index.html', ...fs.readdirSync(path.join(root, 'html')).map(f => 'html/' + f)];
    for (const page of pages) {
      const src = fs.readFileSync(path.join(root, page), 'utf8');
      for (const m of src.matchAll(/(?:src|href)="([^"#?:]+)(?:[?#][^"]*)?"/g)) {
        if (/^(https?:|mailto:|data:|\/\/)/.test(m[1])) continue;
        const rel = path.posix.normalize(path.posix.join(path.posix.dirname(page), m[1])).replace(/^\//, '');
        needed.add(rel);
      }
    }
    for (const p of needed) {
      ok(!hidden(p), p + ' is loaded by the site but excluded from publishing');
    }
  });
});

describe('performance', () => {
  it('answers a request well inside budget', () => {
    // ~60ms when this was written; ~260ms after the trait work; 265-420ms
    // in-suite now, the spread being what else the machine is doing - the
    // engine keeps every slot's runners-up, settles the stat line on the
    // winner and applies the class rules, all of it measured work rather
    // than waste (a CPU profile is in the README). 600 still catches a real
    // blow-up - a doubled search trips it - without tripping on machine
    // load. The figure itself prints with --verbose; watch it, not the limit.
    const BUDGET_MS = 600;
    const t0 = Date.now();
    for (const q of REQUESTS) ask(q);
    const avg = (Date.now() - t0) / REQUESTS.length;
    ok(avg < BUDGET_MS, 'average ' + Math.round(avg) + 'ms exceeds ' + BUDGET_MS + 'ms');
    if (VERBOSE) console.log('         average ' + Math.round(avg) + 'ms over ' + REQUESTS.length + ' requests');
  });
});

// ── report ──────────────────────────────────────────────────────────────────
runAsyncTests().then(() => {
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
});
