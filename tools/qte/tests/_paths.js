// tools/qte/tests/_paths.js - required first by every trainer suite here.
//
// The suites were written next to their trainer's parts: <t>.rules.js,
// <t>.iife.js, <t>.bot.js in the same folder, the rules core and the
// original js/qte.js at '@qte-scratch/wt2/js/...'. In the repo those live
// inside the shipped files, so this maps each read onto them:
//   @qte-scratch/wt2/js/qte-rules.js  -> the core of js/qte-rules.js (no trainers)
//   @qte-scratch/wt2/js/qte.js        -> js/qte.js as it was BEFORE verified runs (git)
//   <this folder>/<t>.rules.js        -> <t>'s section of js/qte-rules.js
//   <this folder>/<t>.iife.js         -> <t>'s IIFE in js/qte.js
//   <this folder>/<t>.bot.js          -> tools/qte/bots/<t>.bot.js
// Nothing is copied, so a suite always tests the code the site ships.
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const HERE = path.resolve(__dirname).replace(/\\/g, '/').toLowerCase();
const PART = '\n// ==== qte-rules part: ';
const HEADS = JSON.parse(fs.readFileSync(path.join(__dirname, '_heads.json'), 'utf8'));
// The last commit whose js/qte.js is the pre-verified-runs original.
const ORIGINAL_AT = '489ce6d';

const realRead = fs.readFileSync;
const text = p => realRead.call(fs, path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let cache = {};
function rules() { return cache.rules || (cache.rules = text('js/qte-rules.js')); }
function core() {
  const s = rules(), i = s.indexOf(PART);
  if (i < 0) throw new Error('_paths: js/qte-rules.js has no trainer parts');
  return s.slice(0, i) + '\n';
}
function part(t) {
  const s = rules(), m = PART + t + ' ====\n', i = s.indexOf(m);
  if (i < 0) throw new Error('_paths: no part for ' + t + ' in js/qte-rules.js');
  const j = s.indexOf(PART, i + m.length);
  return s.slice(i + m.length, j < 0 ? s.length : j);
}
function iife(t) {
  const lines = (cache.qte || (cache.qte = text('js/qte.js'))).split('\n');
  const a = lines.indexOf(HEADS[t]);
  if (a < 0) throw new Error('_paths: the ' + t + ' IIFE header is not in js/qte.js: ' + HEADS[t]);
  let b = a;
  while (b < lines.length && lines[b] !== '})();') b++;
  return lines.slice(a, b + 1).join('\n') + '\n';
}
function original() {
  if (cache.orig) return cache.orig;
  for (const rev of [ORIGINAL_AT, 'HEAD']) {
    try {
      const s = execFileSync('git', ['show', rev + ':js/qte.js'], { cwd: ROOT, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').replace(/\r\n/g, '\n');
      if (!/QteRules/.test(s)) return (cache.orig = s);
    } catch (e) { /* try the next */ }
  }
  throw new Error('_paths: no pre-verified-runs js/qte.js in git history');
}
function mapped(p) {
  const n = path.resolve(String(p)).replace(/\\/g, '/');
  const raw = String(p).replace(/\\/g, '/');
  if (/@qte-scratch\/wt2\/js\/qte-rules\.js$/.test(raw)) return core();
  if (/@qte-scratch\/wt2\/js\/qte\.js$/.test(raw)) return original();
  if (path.dirname(n).toLowerCase() !== HERE) return null;
  const m = /^(.+)\.(rules|iife|bot)\.js$/.exec(path.basename(n));
  if (!m || !HEADS[m[1]]) return null;
  if (m[2] === 'rules') return part(m[1]);
  if (m[2] === 'iife') return iife(m[1]);
  return realRead.call(fs, path.join(ROOT, 'tools', 'qte', 'bots', m[1] + '.bot.js'), 'utf8');
}
fs.readFileSync = function (p, opts) {
  if (typeof p === 'string') {
    const s = mapped(p);
    if (s !== null) {
      const enc = typeof opts === 'string' ? opts : opts && opts.encoding;
      return enc ? s : Buffer.from(s, 'utf8');
    }
  }
  return realRead.apply(fs, arguments);
};
