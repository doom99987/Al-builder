/*
  Share-link encoder — turns an engine build into a real arcanelineagebuilder.com
  URL you can open.

  This is a faithful replica of _packState() (builder.js:8038). The format is a
  POSITIONAL bit stream: every field's meaning comes from its offset, and each
  id is an index into a list whose ORDER IS THE ENCODING. Reorder `races`,
  `gearSeries`, `enchantItems` or `gearTraits` upstream and every link ever
  produced decodes to the wrong thing — for this engine and for the site alike.

  Because it is positional there is no "mostly right". It either round-trips
  through the site's own _unpackState or it is broken, which is exactly how
  verify-share.js checks it.

  The lists are rebuilt here from the same data tables _buildLists() uses, so
  they cannot drift out of step with the site — there is no second copy.
*/
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ALB_Share = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // Fixed-width fields, from builder.js:7840.
  const GEAR_TRAIT_ID_BITS   = 8;
  const GEAR_TRAIT_TIER_BITS = 3;
  const GEAR_TIER_BITS       = 3;
  const GEAR_SHAPE_BITS      = 2;
  const GEAR_STATPICK_BITS   = 3;
  const TRAIT_SLOTS          = 3;
  const ARTIFACT_TRAIT_SLOTS = 2;   // SPEC_ARTIFACT.slots
  const MAX_TRAIT_TIER       = 2;
  const GEAR_SLOTS           = 4;
  const WEAPON_SLOTS         = 2;
  const STATS                = ['str', 'arc', 'end', 'spd', 'lck'];

  // Minimum bits to represent 0..n. Mirrors _wb (builder.js:7952).
  function wb(n) { let b = 1; while ((1 << b) <= n) b++; return b; }

  class BitWriter {
    constructor() { this._buf = []; this._cur = 0; this._bits = 0; }
    write(val, width) {
      for (let i = width - 1; i >= 0; i--) {
        this._cur = (this._cur << 1) | ((val >>> i) & 1);
        if (++this._bits === 8) { this._buf.push(this._cur); this._cur = 0; this._bits = 0; }
      }
    }
    bytes() {
      const buf = [...this._buf];
      if (this._bits > 0) buf.push(this._cur << (8 - this._bits));
      return buf;
    }
    toB64url() { return bytesToB64u(this.bytes()); }
  }

  function bytesToB64u(buf) {
    const b64 = (typeof btoa === 'function')
      ? btoa(String.fromCharCode.apply(null, Array.from(buf)))
      : Buffer.from(Uint8Array.from(buf)).toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  // Rebuilt from the same tables as _buildLists (builder.js:7811).
  function buildLists(D) {
    const keys = o => Object.keys(o || {});
    const flatWeapons = s => Object.values(s || {}).flatMap(w => Object.keys(w));
    const flatGears   = s => Object.values(s || {}).flat();
    return {
      race:  keys(D.races),
      cls:   keys(D.classes),
      sub:   D.subClasses || [],
      mark:  keys(D.markItems),
      cov:   keys(D.covenantItems),
      ench:  keys(D.enchantItems),
      art:   keys(D.artifactItems),
      shard: keys(D.shardItems),
      gear:  flatGears(D.gearSeries),
      wm:    flatWeapons(D.mainWeaponSeries),
      wo:    flatWeapons(D.offhandSeries),
      arm:   keys(D.armourItems),
      ls:    keys(D.lostScrollItems),
      sc:    keys(D.scrollItems),
      trait: keys(D.gearTraits),
      corr:  keys(D.corruptionForms),
    };
  }

  // An engine build carries a resolved {str:n,…} allocation; the wire format
  // wants a shape index plus ordered stat picks. Recover the shape whose values
  // match the allocation, largest value first — the same order the UI writes.
  function allocToShape(D, alloc, tier, isWeapon) {
    const cap = isWeapon ? D.MAX_WEAPON_TIER : D.MAX_GEAR_TIER;
    const t = Math.min(cap, Math.max(0, tier | 0));
    const shapes = (D.GEAR_TIER_SHAPES || [])[t] || [[]];
    const entries = Object.entries(alloc || {}).filter(([, v]) => v > 0)
                          .sort((a, b) => b[1] - a[1]);
    for (let si = 0; si < shapes.length; si++) {
      const shape = shapes[si];
      if (shape.length !== entries.length) continue;
      if (shape.every((v, i) => v === entries[i][1])) {
        return { tier: t, shape: si, stats: entries.map(e => e[0]) };
      }
    }
    return { tier: t, shape: 0, stats: entries.map(e => e[0]) };
  }

  // A gear/weapon instance as the builder stores it — {tier, shape, stats[]} —
  // resolved into the {str:n,…} allocation the engine works with. Mirrors
  // gearInstanceAlloc (builder.js:697).
  function allocFromInstance(D, inst, isWeapon) {
    if (!inst) return { tier: 0, alloc: {} };
    const cap = isWeapon ? D.MAX_WEAPON_TIER : D.MAX_GEAR_TIER;
    const tier = Math.min(cap, Math.max(0, inst.tier | 0));
    const shapes = (D.GEAR_TIER_SHAPES || [])[tier] || [[]];
    const shape = shapes[Math.min(shapes.length - 1, Math.max(0, inst.shape | 0))] || [];
    const alloc = {};
    shape.forEach((v, i) => {
      const st = (inst.stats || [])[i];
      if (st) alloc[st] = (alloc[st] || 0) + v;
    });
    return { tier, alloc };
  }

  // Read a build OUT of the builder — the inverse of pack(). Takes whatever
  // getBuildState() returns and produces the engine's build shape, so the AI can
  // score what someone actually has rather than only what it invented.
  //
  // Everything is defensive: a half-filled builder is the normal case, and the
  // engine is meant to cope with missing pieces rather than refuse to look.
  function fromState(D, st) {
    st = st || {};
    const gearNames = st.g || [];
    const gi = st.gi || [];
    const wti = st.wti || [];

    const traitsOf = inst => ((inst && inst.traits) || [])
      .filter(t => t && t.id)
      .map(t => ({ id: t.id, tier: Math.min(2, Math.max(1, t.tier | 0)) }));

    const gear = [];
    gearNames.forEach((name, i) => {
      if (!name) return;
      const a = allocFromInstance(D, gi[i], false);
      gear.push({ name, tier: a.tier, alloc: a.alloc, traits: traitsOf(gi[i]) });
    });

    const artA = allocFromInstance(D, st.ai, false);
    const wmA  = allocFromInstance(D, wti[0], true);
    const woA  = allocFromInstance(D, wti[1], true);

    return {
      level: Math.max(1, Math.min(D.Max_Lvl || 50, st.lvl | 0 || 1)),
      race: st.race || '',
      klass: st.sup || st.cls || '',
      sub: st.sub || '',
      invested: {
        str: st.str | 0, arc: st.arc | 0, end: st.end | 0,
        spd: st.spd | 0, lck: st.lck | 0,
      },
      armour: st.arm || '',
      gear,
      artifact: st.art ? { name: st.art, tier: artA.tier, alloc: artA.alloc, traits: traitsOf(st.ai) } : null,
      weapon:   st.wm  ? { name: st.wm,  tier: wmA.tier,  alloc: wmA.alloc } : null,
      offhand:  st.wo  ? { name: st.wo,  tier: woA.tier,  alloc: woA.alloc } : null,
      mark: st.mark || '',
      permuth: st.pStat || '',
      enchant: st.ench || '',
      shards: (st.sh || []).filter(Boolean),
      masteryNodes: (st.msty || []).slice(),
      soul: st.soul || {},
      covenant: st.cov || '',
      covenantRank: st.covR || 1,
      lostScroll: st.ls || '',
      scroll1: st.sc1 || '',
      scroll2: st.sc2 || '',
      corruption: st.corr || '',
      buffs: {},
    };
  }

  function pack(D, build, opts) {
    opts = opts || {};
    const L = buildLists(D);
    const bw = new BitWriter();

    // The class picker holds the BASE class and the super picker the branch, so
    // a build on "Lancer (N)" packs as cls "Slayer" + sup "Lancer (N)".
    let cls = build.klass || '', sup = '';
    if (cls && !(D.classes || {})[cls]) {
      for (const [base, supers] of Object.entries(D.classes || {})) {
        if ((supers || []).includes(cls)) { sup = cls; cls = base; break; }
      }
    }

    const wi = (list, val) => {
      const idx = val ? list.indexOf(val) : -1;
      bw.write(idx < 0 ? 0 : idx + 1, wb(list.length));
    };

    bw.write(Math.max(1, Math.min(D.Max_Lvl, build.level || 1)) - 1, 6);
    wi(L.race, build.race || '');
    wi(L.cls,  cls);
    const supList = (D.classes || {})[cls] || [];
    const supIdx = supList.indexOf(sup);
    bw.write(supIdx < 0 ? 0 : supIdx + 1, 4);
    wi(L.sub, build.sub || '');
    STATS.forEach(s => bw.write(Math.max(0, Math.min(255, (build.invested || {})[s] | 0)), 8));
    wi(L.mark, build.mark || '');
    wi(L.cov,  build.covenant || '');
    bw.write((build.covenantRank || 1) - 1, 5);
    wi(L.ench, build.enchant || '');
    wi(L.art,  build.artifact ? build.artifact.name : '');

    const shards = (build.shards || []).slice(0, 7);
    while (shards.length < 7) shards.push('');
    shards.forEach(s => wi(L.shard, s));

    const gears = [];
    for (let i = 0; i < GEAR_SLOTS; i++) gears.push((build.gear || [])[i] ? build.gear[i].name : '');
    gears.forEach(g => wi(L.gear, g));

    wi(L.wm,  build.weapon  ? build.weapon.name  : '');
    wi(L.wo,  build.offhand ? build.offhand.name : '');
    wi(L.arm, build.armour || '');

    // One bit per mastery node, in declaration order.
    const msty = new Set(build.masteryNodes || []);
    (D.masteryNodes || []).forEach(nd => bw.write(msty.has(nd.id) ? 1 : 0, 1));

    // Three bits per soul-tree node, in the order soulTreeRanks was populated.
    const soul = build.soul || {};
    Object.values(D.soulTreeData || {}).flat()
      .forEach(n => bw.write(Math.max(0, Math.min(7, soul[n.id] | 0)), 3));

    wi(L.ls, build.lostScroll || '');
    wi(L.sc, build.scroll1 || '');
    wi(L.sc, build.scroll2 || '');

    // Gear instances: tier, shape, stat picks, trait slots.
    for (let i = 0; i < GEAR_SLOTS; i++) {
      const g = (build.gear || [])[i];
      const sh = allocToShape(D, g && g.alloc, g ? g.tier : 0, false);
      bw.write(sh.tier, GEAR_TIER_BITS);
      bw.write(Math.min(3, Math.max(0, sh.shape)), GEAR_SHAPE_BITS);
      for (let j = 0; j < (D.MAX_SHAPE_LEN || 4); j++) {
        const idx = STATS.indexOf(sh.stats[j]);
        bw.write(idx < 0 ? 0 : idx + 1, GEAR_STATPICK_BITS);
      }
      for (let j = 0; j < TRAIT_SLOTS; j++) {
        const t = g && g.traits && g.traits[j];
        const idx = t ? L.trait.indexOf(t.id) : -1;
        bw.write(idx < 0 ? 0 : idx + 1, GEAR_TRAIT_ID_BITS);
        bw.write(idx < 0 ? 0 : Math.min(MAX_TRAIT_TIER, Math.max(1, t.tier | 0)), GEAR_TRAIT_TIER_BITS);
      }
    }

    wi(L.corr, build.corruption || '');

    // Artifact instance — same layout, fewer trait slots.
    {
      const a = build.artifact;
      const sh = allocToShape(D, a && a.alloc, a ? a.tier : 0, false);
      bw.write(sh.tier, GEAR_TIER_BITS);
      bw.write(Math.min(3, Math.max(0, sh.shape)), GEAR_SHAPE_BITS);
      for (let j = 0; j < (D.MAX_SHAPE_LEN || 4); j++) {
        const idx = STATS.indexOf(sh.stats[j]);
        bw.write(idx < 0 ? 0 : idx + 1, GEAR_STATPICK_BITS);
      }
      for (let j = 0; j < ARTIFACT_TRAIT_SLOTS; j++) {
        const t = a && a.traits && a.traits[j];
        const idx = t ? L.trait.indexOf(t.id) : -1;
        bw.write(idx < 0 ? 0 : idx + 1, GEAR_TRAIT_ID_BITS);
        bw.write(idx < 0 ? 0 : Math.min(MAX_TRAIT_TIER, Math.max(1, t.tier | 0)), GEAR_TRAIT_TIER_BITS);
      }
    }

    // Weapon instances — no traits.
    for (let i = 0; i < WEAPON_SLOTS; i++) {
      const w = i === 0 ? build.weapon : build.offhand;
      const sh = allocToShape(D, w && w.alloc, w ? w.tier : 0, true);
      bw.write(sh.tier, GEAR_TIER_BITS);
      bw.write(Math.min(3, Math.max(0, sh.shape)), GEAR_SHAPE_BITS);
      for (let j = 0; j < (D.MAX_SHAPE_LEN || 4); j++) {
        const idx = STATS.indexOf(sh.stats[j]);
        bw.write(idx < 0 ? 0 : idx + 1, GEAR_STATPICK_BITS);
      }
    }

    // Permuth's chosen stat, appended last.
    bw.write(STATS.indexOf(build.permuth || '') + 1, GEAR_STATPICK_BITS);

    return bw;
  }

  // The packed build as the site's own base64url blob (what _unpackState reads).
  const packBlob = (D, build) => pack(D, build).toB64url();

  // ── the bz_ container ─────────────────────────────────────────────────────
  // _loadById (builder.js:8226) expects deflate-raw over
  //   [uint16 summLen LE][uint8 nameLen][uint8 r][uint8 g][uint8 b][summ][name][build]
  // with the BUILD STORED AS RAW BYTES, not as its base64 text.
  function container(D, build, opts) {
    opts = opts || {};
    const enc = (typeof TextEncoder !== 'undefined')
      ? new TextEncoder()
      : { encode: s => Array.from(Buffer.from(String(s), 'utf8')) };

    const summ = Array.from(enc.encode(opts.summary || ''));
    const name = Array.from(enc.encode(opts.name || ''));
    const hex  = String(opts.color || '#dddddd').replace('#', '');
    const rgb  = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) || 0);

    const body = pack(D, build).bytes();
    return [
      summ.length & 0xff, (summ.length >> 8) & 0xff,
      name.length & 0xff,
      rgb[0], rgb[1], rgb[2],
      ...summ, ...name, ...body,
    ];
  }

  // deflate-raw. Node uses zlib; the browser uses CompressionStream. Always
  // returns a Promise so callers have one API.
  function deflateRaw(bytes) {
    if (typeof module === 'object' && module.exports) {
      const zlib = require('zlib');
      return Promise.resolve(Array.from(zlib.deflateRawSync(Buffer.from(Uint8Array.from(bytes)))));
    }
    if (typeof CompressionStream === 'undefined') {
      return Promise.reject(new Error('CompressionStream unavailable — cannot build a bz_ link here'));
    }
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(Uint8Array.from(bytes)); w.close();
    return new Response(cs.readable).arrayBuffer().then(ab => Array.from(new Uint8Array(ab)));
  }

  // Full shareable URL. Async because compression is.
  function link(D, build, opts) {
    opts = opts || {};
    const base = opts.base || 'https://arcanelineagebuilder.com/';
    return deflateRaw(container(D, build, opts))
      .then(z => base + '?id=bz_' + bytesToB64u(z));
  }

  return { pack, packBlob, container, deflateRaw, link, buildLists, wb,
           fromState, allocFromInstance,
           BitWriter, bytesToB64u, allocToShape };
}));
