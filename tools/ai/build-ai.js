#!/usr/bin/env node
/*
  Build AI — command line entry.

      node tools/ai/build-ai.js "max damage crit lancer"
      node tools/ai/build-ai.js "tanky knight"
      node tools/ai/build-ai.js "necro summon build vastayan"
      node tools/ai/build-ai.js                      # no request at all — still answers
      node tools/ai/build-ai.js --json "..."         # machine-readable

  Run tools/ai/extract-data.js first, and again after any game update.
*/
'use strict';

const fs   = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'ai-data.json');
if (!fs.existsSync(DATA)) {
  console.error('No ai-data.json. Run:  node tools/ai/extract-data.js');
  process.exit(1);
}

const data    = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const Engine  = require('./engine.js').Engine;
const Explain = require('./explain.js');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const request = argv.filter(a => a !== '--json').join(' ');

const engine = Engine(data);
const t0 = Date.now();
const result = engine.ask(request);
const ms = Date.now() - t0;

engine.link(result.build, { name: request || 'Build AI' }).then(url => {
  if (asJson) {
    console.log(JSON.stringify({
      request, spec: result.spec, build: result.build,
      stats: result.ctx.stats, hp: result.ctx.hp,
      critChance: result.ctx.critChance, bestHit: result.ctx.bestHit,
      corruption: result.corruption, warnings: result.warnings, link: url,
    }, null, 2));
  } else {
    console.log(Explain.toText(result.explanation));
    if (url) {
      console.log('\n── Open in AL Builder ' + '─'.repeat(41));
      console.log(url);
    }
    console.log('\n' + '─'.repeat(62));
    console.log('searched ' + (result.considered || 0) + ' class/race pairings in ' + ms + 'ms');
  }
});
