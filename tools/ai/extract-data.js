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
//   fn      — function X(...) { … }, captured as SOURCE so it can be run here
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
    'CRIT_DMG_BASE', 'STAT_IDENTITY_RATIO', 'END_HEAL_DIVISOR', 'LUCK_CRIT_RATIO',
    'MASTERY_TOTAL_POINTS', 'MAX_WEAPON_TIER', 'CORRUPTION_MAX_PHASE',
  ]],
  // Captured as source and run below, not shipped. Re-implementing the site's
  // damage-text parser would mean two copies of a dozen regexes drifting apart
  // the first time somebody fixed one of them.
  // Artifact abilities. artifactItems holds only the stat blocks, so without
  // this the engine picks an artifact on its stats alone and is blind to what it
  // actually DOES — Stellian Core's buff, Narthana's Sigil's healing.
  ['js/builder.js', 'literal', ['artifactMoves']],
  // Covenant abilities. covenantItems is four empty objects — the covenant's
  // whole content is its learns list, so without this the engine could name a
  // covenant and know nothing whatsoever about what joining one gives you.
  ['js/builder.js', 'literal', ['covenantMoves']],

  // Scrolls. Both scroll tables are empty stat blocks in exactly the way
  // covenantItems is - the whole content of a scroll is the MOVE it grants, so
  // without these four the engine can see three build slots it has no reason to
  // fill and no idea what filling them would do.
  //
  // The restriction tables are keyed on BASE class ("Slayer"), not on the
  // superclass, which is why a Saint can take Breath of Fungyir.
  ['js/builder.js', 'literal', ['scrollMoves']],
  ['js/builder.js', 'literal', ['lostScrollMoves']],
  ['js/builder.js', 'literal', ['scrollClassRestrictions']],
  ['js/builder.js', 'literal', ['lostScrollClassRestrictions']],
  ['js/builder.js', 'fn', ['parseDmgBonus']],
  ['js/data-class-moves.js', 'literal', ['classMoves']],
  ['js/data-race-moves.js',  'literal', ['raceMoves']],
  // Boss and mob kits: passives, moves and loot for 37 encounters. Needed so a
  // build can be aimed at a specific fight - Seraphon heals off the debuffs you
  // stack on it, so the best general build is a bad Seraphon build.
  ['js/encyclopedia.js', 'literal', ['BOSS_MOVE_DATA']],
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
  if (kind === 'fn') {
    const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(src);
    if (!m) return undefined;
    const brace = src.indexOf('{', m.index);
    if (brace < 0) return undefined;
    const end = matchFrom(src, brace);
    return end < 0 ? undefined : src.slice(m.index, end + 1);
  }
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
      // A captured function is source text; printing it dumps the whole body
      // into the report.
      const size = kind === 'fn' ? '(source)'
                 : Array.isArray(v) ? v.length
                 : (v && typeof v === 'object') ? Object.keys(v).length
                 : v;
      found.push([name, Array.isArray(v) ? 'array[' + size + ']'
                      : (v && typeof v === 'object') ? 'object{' + size + '}'
                      : String(size)]);
    }
  }

  if (data.GEAR_TIER_SHAPES) data.MAX_GEAR_TIER = data.GEAR_TIER_SHAPES.length - 1;

  // Mastery capstone abilities.
  //
  // Each class's six capstones cost 5 points apiece out of 35, and each carries
  // a written effect the engine had no way to read — so it was choosing between
  // them on branch colour alone. builder.js already turns those descriptions
  // into damage numbers for its own calculator (collectDmgBonusPassives, via
  // parseDmgBonus); this runs THAT function over every class's abilities and
  // stores the results, so the engine and the site agree by construction rather
  // than by a replica that has to be kept in step.
  if (data.parseDmgBonus && data.masteryClassData) {
    let parse;
    // eslint-disable-next-line no-new-func -- first-party source; see header
    try { parse = new Function(data.parseDmgBonus + '; return ' + 'parseDmgBonus;')(); }
    catch { parse = null; }
    if (parse) {
      const abilities = {};
      let n = 0;
      for (const [cls, cd] of Object.entries(data.masteryClassData)) {
        for (const [nodeId, node] of Object.entries(cd.nodes || {})) {
          if (!node || !node.desc) continue;
          let bonus = null;
          try { bonus = parse(node.desc); } catch { bonus = null; }
          (abilities[cls] || (abilities[cls] = {}))[nodeId] =
            { name: node.name || nodeId, bonus: bonus === null ? null : bonus };
          n++;
        }
      }
      data.masteryAbilities = abilities;
      found.push(['masteryAbilities (parsed)', 'object{' + n + '}']);
    }
  }
  // The source itself is a tool input, not engine data.
  delete data.parseDmgBonus;

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

  // Which encounters are actually BOSSES. BOSS_MOVE_DATA holds kits for bosses,
  // mini bosses and ordinary mobs alike, and a target list offering "Slime" and
  // "Goblin" alongside Seraphon is noise. The encyclopedia already classifies
  // every entry in ENC_ITEMS, so read the type off that rather than guessing
  // from the name.
  //
  // Only the name and type are kept — pulling the whole ENC_ITEMS array would
  // add its descriptions to a snapshot the browser lazy-loads.
  {
    const src = read('js/encyclopedia.js');
    const re = /\[\s*(['"])((?:\\.|(?!\1)[^\\])+)\1\s*,\s*['"](Boss|Mini Boss|Mob|Trainer)['"]/g;
    const kinds = {};
    let m;
    while ((m = re.exec(src)) !== null) {
      const name = m[2].replace(/\'/g, "'").replace(/\\"/g, '"');
      // Shadeblade is filed as both Boss and Mini Boss (check-data.js flags the
      // duplicate). Boss wins: the stronger classification is the useful one.
      if (kinds[name] === 'Boss') continue;
      kinds[name] = m[3];
    }
    if (Object.keys(kinds).length) {
      data.encounterKinds = kinds;
      const bosses = Object.values(kinds).filter(k => k === 'Boss' || k === 'Mini Boss').length;
      found.push(['encounterKinds (parsed)',
                  'object{' + Object.keys(kinds).length + '} · ' + bosses + ' boss/mini']);
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
