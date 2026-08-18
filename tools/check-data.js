#!/usr/bin/env node
/*
  Game-data consistency checker.

  Arcane Lineage content is duplicated across several files by design — the
  builder needs stat blocks, the encyclopedia needs descriptions, the value list
  needs prices. Nothing enforces that those lists agree, so after a game update
  it is easy to add an item in one place and silently miss the others: the item
  then exists in the builder dropdown but has no encyclopedia entry, or shows in
  the value list and nowhere else.

  This script extracts each data literal straight from source and reports the
  differences. It reads only; it never edits.

      node tools/check-data.js            # human-readable report
      node tools/check-data.js --json     # machine-readable

  Exit code is 1 when drift is found, so it can gate a release.
*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── literal extraction ──────────────────────────────────────────────────────
// These files touch the DOM at load, so they cannot be require()d. Instead find
// the named declaration, brace-match its literal, and evaluate that slice alone.
function extractLiteral(src, name) {
  const decl = new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*([\\[{])');
  const m = decl.exec(src);
  if (!m) return null;

  const open = m[1];
  const close = open === '[' ? ']' : '}';
  let i = m.index + m[0].length - 1;
  let depth = 0, inStr = null, esc = false;

  for (; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (c === '\\') esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return null;

  const literal = src.slice(m.index + m[0].length - 1, i + 1);
  try { return new Function('return (' + literal + ');')(); }
  catch (e) { return { __error: e.message }; }
}

function load(file, names) {
  const src = read(file);
  const out = {};
  for (const n of names) {
    const v = extractLiteral(src, n);
    if (v === null) out[n] = { __missing: true };
    else out[n] = v;
  }
  return out;
}

// ── sources ─────────────────────────────────────────────────────────────────
const builder = load('js/builder.js', [
  'races', 'armourItems', 'gearItems', 'markItems',
  'enchantItems', 'artifactItems', 'shardItems',
]);
// encyclopedia.js already reconciles known spelling differences through these
// maps (encyclopedia name -> builder name). Without them the checker reports
// every deliberate alias as drift and becomes noise.
const enc     = load('js/encyclopedia.js', ['ENC_ITEMS', 'GEAR_NAME_MAP', 'WEAPON_NAME_MAP']);
const html    = load('index.html', ['VL_ITEMS']);
const cls     = load('js/data-class-moves.js', ['classMoves']);
const race    = load('js/data-race-moves.js', ['raceMoves']);

const problems = [];
const note = (kind, detail) => problems.push({ kind, ...detail });

for (const [file, bag] of [['js/builder.js', builder], ['js/encyclopedia.js', enc],
                           ['index.html', html], ['js/data-class-moves.js', cls],
                           ['js/data-race-moves.js', race]]) {
  for (const [name, val] of Object.entries(bag)) {
    if (val && val.__missing) note('unreadable', { file, name, why: 'declaration not found' });
    else if (val && val.__error) note('unreadable', { file, name, why: val.__error });
  }
}

const keys = o => (o && !o.__missing && !o.__error) ? Object.keys(o) : [];
const norm = s => String(s).trim();
// Race keys carry a drop-rate suffix — "Estella (24%)" is the same race as "Estella".
const bareRace = s => norm(s).replace(/\s*\(\d+%\)\s*$/, '');

const encNames = Array.isArray(enc.ENC_ITEMS)
  ? enc.ENC_ITEMS.filter(Array.isArray).map(r => norm(r[0]))
  : [];
const encByName = new Map(
  Array.isArray(enc.ENC_ITEMS)
    ? enc.ENC_ITEMS.filter(Array.isArray).map(r => [norm(r[0]), norm(r[1] || '')])
    : []
);
const vlNames = Array.isArray(html.VL_ITEMS)
  ? html.VL_ITEMS.filter(Array.isArray).map(r => norm(r[0]))
  : [];

// Every name the encyclopedia can resolve to: its own entries, plus the builder
// names its alias maps point at, plus shard entries written "Striking Shard"
// where the builder writes "Striking (R)" / "Striking (P)".
const encSet = new Set(encNames);
for (const map of [enc.GEAR_NAME_MAP, enc.WEAPON_NAME_MAP]) {
  if (map && !map.__missing && !map.__error) {
    for (const builderName of Object.values(map)) encSet.add(norm(builderName));
  }
}
for (const n of encNames) {
  const shard = /^(.+?)\s+Shard$/.exec(n);
  if (shard) { encSet.add(shard[1] + ' (R)'); encSet.add(shard[1] + ' (P)'); }
}

// 1. Builder items with no encyclopedia entry.
const builderItemSets = {
  gearItems: 'Gear', armourItems: 'Armour', markItems: 'Mark',
  enchantItems: 'Enchant', artifactItems: 'Artifact', shardItems: 'Shard',
};
for (const [setName] of Object.entries(builderItemSets)) {
  for (const item of keys(builder[setName])) {
    if (!encSet.has(norm(item))) {
      note('missing-encyclopedia', { item: norm(item), source: 'builder.' + setName });
    }
  }
}

// 2a. Alias-map keys are meant to be encyclopedia entry names. A key that
// matches no entry is a dead alias resolving nothing.
const aliasKeys = new Set();
for (const [label, map] of [['GEAR_NAME_MAP', enc.GEAR_NAME_MAP], ['WEAPON_NAME_MAP', enc.WEAPON_NAME_MAP]]) {
  if (!map || map.__missing || map.__error) continue;
  for (const k of Object.keys(map)) {
    aliasKeys.add(norm(k));
    if (!encNames.includes(norm(k))) note('dead-alias', { item: norm(k), source: label });
  }
}

// 2. Value-list entries that nothing else knows about. An alias key counts as
// known, since the encyclopedia can still resolve it.
const knownNames = new Set([...encSet, ...aliasKeys]);
const allBuilderItems = new Set(
  Object.keys(builderItemSets).flatMap(s => keys(builder[s]).map(norm))
);
for (const item of vlNames) {
  if (!allBuilderItems.has(item) && !knownNames.has(item)) {
    note('orphan-value-list', { item, source: 'index.html VL_ITEMS' });
  }
}

// 3. Duplicates. The encyclopedia legitimately reuses a name across types —
// "Thief" is both a Base Class and a Mob — so only a repeated name+type pair is
// a real duplicate.
if (Array.isArray(enc.ENC_ITEMS)) {
  const seen = new Set(), dupes = new Set();
  enc.ENC_ITEMS.filter(Array.isArray).forEach(r => {
    const k = norm(r[0]) + ' — ' + norm(r[1] || '');
    seen.has(k) ? dupes.add(k) : seen.add(k);
  });
  dupes.forEach(item => note('duplicate', { item, source: 'ENC_ITEMS' }));

  // Same name under two types with an identical description is usually one
  // entity filed twice rather than two genuinely different things.
  const byName = new Map();
  enc.ENC_ITEMS.filter(Array.isArray).forEach(r => {
    const n = norm(r[0]);
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push({ type: norm(r[1] || ''), desc: norm(r[2] || '') });
  });
  for (const [name, rows] of byName) {
    if (rows.length < 2) continue;
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[i].desc && rows[i].desc === rows[j].desc) {
          note('same-text-two-types', { item: name, source: rows[i].type + ' / ' + rows[j].type });
        }
      }
    }
  }
}
{
  const seen = new Set(), dupes = new Set();
  vlNames.forEach(n => (seen.has(n) ? dupes.add(n) : seen.add(n)));
  dupes.forEach(item => note('duplicate', { item, source: 'VL_ITEMS' }));
}

// 4. Races present in one system but not the other.
const raceNames  = keys(builder.races).map(bareRace);
const raceMoveKs = keys(race.raceMoves).map(bareRace);
raceNames.forEach(r => { if (!raceMoveKs.includes(r)) note('race-no-moves', { race: r }); });
raceMoveKs.forEach(r => { if (!raceNames.includes(r)) note('moves-no-race', { race: r }); });

// 5. Classes in the move table with no encyclopedia entry.
for (const c of keys(cls.classMoves)) {
  if (!encSet.has(norm(c))) note('class-no-encyclopedia', { class: norm(c) });
}

// ── report ──────────────────────────────────────────────────────────────────
const counts = {
  races: keys(builder.races).length,
  classes: keys(cls.classMoves).length,
  raceMoveSets: keys(race.raceMoves).length,
  encyclopediaEntries: encNames.length,
  valueListEntries: vlNames.length,
};
for (const s of Object.keys(builderItemSets)) counts[s] = keys(builder[s]).length;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ counts, problems }, null, 2));
  process.exit(problems.length ? 1 : 0);
}

console.log('Data sources');
for (const [k, v] of Object.entries(counts)) console.log('  ' + String(v).padStart(5) + '  ' + k);

if (!problems.length) {
  console.log('\nNo drift found.');
  process.exit(0);
}

const byKind = problems.reduce((a, p) => ((a[p.kind] = a[p.kind] || []).push(p), a), {});
const titles = {
  unreadable:            'Could not read a data literal (parser or rename issue)',
  'missing-encyclopedia':'In the builder but has no encyclopedia entry',
  'orphan-value-list':   'In the value list but in neither the builder nor the encyclopedia',
  duplicate:             'Listed twice in the same file',
  'race-no-moves':       'Race exists but has no move set',
  'moves-no-race':       'Move set exists for a race the builder does not list',
  'class-no-encyclopedia':'Class has moves but no encyclopedia entry',
  'same-text-two-types': 'Same name filed under two types with identical text (likely one entity duplicated)',
  'dead-alias':          'Alias map key matches no encyclopedia entry',
};

console.log('\n' + problems.length + ' issue(s):');
for (const [kind, list] of Object.entries(byKind)) {
  console.log('\n' + (titles[kind] || kind) + '  (' + list.length + ')');
  list.slice(0, 40).forEach(p => {
    const label = p.item || p.race || p.class || (p.file + ' → ' + p.name);
    console.log('  - ' + label + (p.source ? '   [' + p.source + ']' : '') + (p.why ? '   ' + p.why : ''));
  });
  if (list.length > 40) console.log('  … and ' + (list.length - 40) + ' more');
}
process.exit(1);
