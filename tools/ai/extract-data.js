#!/usr/bin/env node
/*
  Build-AI data extractor.

  The build engine needs every game-data table the builder holds: gear stat
  blocks, race bases, armour, enchants, shards, class moves. Those tables live as
  literals inside js/builder.js, which touches the DOM the moment it loads and so
  cannot be require()d from Node.

  Rather than keep a second copy of the data — which would rot the first time a
  game update landed and nobody remembered this folder existed — this pulls the
  literals straight out of the source, exactly the way tools/check-data.js does,
  and writes one snapshot the engine consumes.

      node tools/ai/extract-data.js           # write tools/ai/ai-data.json
      node tools/ai/extract-data.js --report  # say what was found, write nothing

  Re-run it after a game update. Anything it cannot find is reported and skipped
  rather than thrown, so a renamed table degrades the engine instead of breaking
  it.

  Note on new Function(): the inputs are first-party source files from this repo,
  the same trust boundary tools/check-data.js already operates under. Do not
  point this at source you did not write.
*/
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT  = path.join(__dirname, 'ai-data.json');

// ── what to pull ────────────────────────────────────────────────────────────
// Expandability: adding a table to the engine's knowledge is one line here. The
// `kind` tells the extractor how the value is written in source.
//   literal — const X = { … } or [ … ]
//   set     — const X = new Set([ … ])
//   scalar  — const X = 42 / 0.1 / "text"
const WANTED = [
  ['js/builder.js', 'literal', [
    'races', 'armourItems', 'gearItems', 'gearPctBonuses', 'markItems',
    'enchantItems', 'artifactItems', 'shardItems', 'gearSeries', 'gearTraits',
    'weaponBonuses', 'covenantBonuses', 'statMilestones',
    'GEAR_TIER_SHAPES', 'GEAR_ALLOC_STATS', 'STAT_MILESTONE_TIERS',
    'TIERED_OFFHAND_NAMES', 'mainWeaponSeries', 'offhandSeries',
    'corruptionForms', 'CORRUPTION_GENERAL', 'classes', 'subClasses',
    // Needed to rebuild the share-link lists (_buildLists) and the mastery /
    // soul-tree bit fields. ORDER IS LOAD-BEARING for every one of these:
    // position is the encoded id, so a reorder invalidates existing links.
    'covenantItems', 'lostScrollItems', 'scrollItems', 'soulTreeData', 'masteryNodes',
    'masteryClassData',
  ]],
  ['js/builder.js', 'set', [
    'FIXED_GEAR', 'TIERED_WEAPON_SERIES',
  ]],
  ['js/builder.js', 'scalar', [
    'LEVEL_STAT_BONUS_EVERY', 'POINTS_PER_LEVEL', 'Max_Lvl', 'Min_Lvl',
    'CRIT_DMG_BASE', 'STAT_IDENTITY_RATIO', 'END_HEAL_DIVISOR',
    'MASTERY_TOTAL_POINTS', 'MAX_WEAPON_TIER', 'CORRUPTION_MAX_PHASE',
  ]],
  ['js/data-class-moves.js', 'literal', ['classMoves']],
  ['js/data-race-moves.js',  'literal', ['raceMoves']],
];

// ── extraction ──────────────────────────────────────────────────────────────
const srcCache = new Map();
function read(file) {
  if (!srcCache.has(file)) srcCache.set(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return srcCache.get(file);
}

// Brace-match from an opening bracket, skipping strings and comments, and return
// the index of its partner. Comment and string skipping is what makes this safe
// on real source rather than only on tidy data files.
function matchFrom(src, start) {
  const open  = src[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0, inStr = null, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (c === '\\') esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function evalSlice(literal) {
  // eslint-disable-next-line no-new-func -- first-party source only; see header
  return new Function('return (' + literal + ');')();
}

function extract(src, name, kind) {
  if (kind === 'scalar') {
    const m = new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*([^;\\n]+)').exec(src);
    if (!m) return undefined;
    try { return evalSlice(m[1].replace(/\/\/.*$/, '').trim()); }
    catch { return undefined; }
  }

  const pattern = kind === 'set'
    ? '(?:const|let|var)\\s+' + name + '\\s*=\\s*new\\s+Set\\s*\\(\\s*(\\[)'
    : '(?:const|let|var)\\s+' + name + '\\s*=\\s*([\\[{])';
  const m = new RegExp(pattern).exec(src);
  if (!m) return undefined;

  const start = m.index + m[0].length - 1;
  const end   = matchFrom(src, start);
  if (end < 0) return undefined;

  try { return evalSlice(src.slice(start, end + 1)); }
  catch { return undefined; }
}

// ── run ─────────────────────────────────────────────────────────────────────
// Split from the CLI half so tools/ai/test.js can re-extract in memory and check
// the committed snapshot is still current. A stale ai-data.json is silent — the
// engine keeps answering, just with last week's game data.
function extractAll() {
  const data    = {};
  const found   = [];
  const missing = [];

  for (const [file, kind, names] of WANTED) {
    const src = read(file);
    for (const name of names) {
      const v = extract(src, name, kind);
      if (v === undefined) { missing.push(name + '  (' + kind + ' in ' + file + ')'); continue; }
      data[name] = v;
      const size = Array.isArray(v) ? v.length
                 : (v && typeof v === 'object') ? Object.keys(v).length
                 : v;
      found.push([name, Array.isArray(v) ? 'array[' + size + ']'
                      : (v && typeof v === 'object') ? 'object{' + size + '}'
                      : String(size)]);
    }
  }

  if (data.GEAR_TIER_SHAPES) data.MAX_GEAR_TIER = data.GEAR_TIER_SHAPES.length - 1;

  // Gear passives are written as mkPassive("Name", "text") calls, not as a data
  // literal, so the brace matcher cannot reach them. 51 of the 80 gears have one
  // and they are a large part of what makes a gear worth taking — without them
  // the engine picks gear on its stat block alone.
  {
    const src = read('js/builder.js');
    const re = /mkPassive\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"/g;
    const passives = {};
    let m;
    while ((m = re.exec(src)) !== null) {
      passives[m[1]] = m[2].replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\s+/g, ' ').trim();
    }
    if (Object.keys(passives).length) {
      data.itemPassives = passives;
      found.push(['itemPassives (mkPassive)', 'object{' + Object.keys(passives).length + '}']);
    }
  }

  if (data.mainWeaponSeries) {
    data.weapons = {};
    for (const [series, group] of Object.entries(data.mainWeaponSeries))
      for (const [name, def] of Object.entries(group || {}))
        data.weapons[name] = Object.assign({ series }, def);
    found.push(['weapons (derived)', 'object{' + Object.keys(data.weapons).length + '}']);
  }

  return { data, found, missing };
}

module.exports = { extractAll, extract, WANTED };
if (require.main !== module) return;

const { data, found, missing } = extractAll();

const report = process.argv.includes('--report');

console.log('extracted ' + found.length + ' tables from ' + new Set(WANTED.map(w => w[0])).size + ' source files\n');
for (const [n, d] of found) console.log('  ' + n.padEnd(24) + d);
if (missing.length) {
  console.log('\nNOT FOUND (' + missing.length + ') — renamed or removed upstream:');
  for (const m of missing) console.log('  ' + m);
  console.log('\nThe engine still runs without these; it just knows less.');
}

if (!report) {
  data.__meta = { generated: new Date().toISOString(), source: 'js/builder.js + data-*.js' };
  fs.writeFileSync(OUT, JSON.stringify(data));
  // Also emit a plain-script version so build-ai.html works when opened straight
  // off disk — fetch() is blocked on file:// URLs, a <script> tag is not.
  const JS = OUT.replace(/\.json$/, '.js');
  fs.writeFileSync(JS, 'window.ALB_DATA = ' + JSON.stringify(data) + ';\n');
  const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
  console.log('\nwrote ' + path.relative(ROOT, OUT) + '  (' + kb(OUT) + ')');
  console.log('wrote ' + path.relative(ROOT, JS) + '  (' + kb(JS) + ')');
}
