/*
  Build AI panel — admins and testers.

  Opened from the profile menu. The engine itself lives in tools/ai/ and is
  shared with the CLI and the standalone page; nothing is duplicated here.

  LAZY LOADED. The engine plus its data snapshot is ~180KB, and this is a
  restricted feature, so none of it is fetched until someone who may use it
  actually opens the panel. Adding the files to index.html would have charged
  every visitor for something almost none of them can use.

  The access check is window._sbCanUseAI — admins plus the tester list in sb.js.
  Testers get this panel and nothing else. It is a client-side gate on a
  client-side tool: it keeps the entry point out of the menu, it is not a
  security boundary, and it does not need to be, because the engine only reads
  game data that is already public in builder.js.
*/
'use strict';

(function () {

  // Cache-bust for the lazily loaded engine. index.html's ?v= convention cannot
  // reach these files because they are injected at runtime, so without this the
  // browser happily serves a stale engine after an update — exactly the trap the
  // rest of the site version-stamps against. Bump on every engine change.
  const ENGINE_V = 23;

  // tools/ai/ is the single home of the engine. Order matters — engine.js reads
  // the globals the others define.
  const ENGINE_FILES = [
    'tools/ai/ai-data.js',
    'tools/ai/model.js',
    'tools/ai/knowledge.js',
    'tools/ai/intent.js',
    'tools/ai/optimize.js',
    'tools/ai/explain.js',
    'tools/ai/share.js',
    'tools/ai/engine.js',
  ];

  let engine = null;
  let loading = null;
  let lastResult = null;

  // Falls back to the admin check so that a browser holding a stale sb.js — one
  // cached from before the tester role existed — still lets admins in rather
  // than locking everyone out of the panel.
  const canUseAI = () => !!((window._sbCanUseAI && window._sbCanUseAI()) ||
                            (window._sbIsAdmin  && window._sbIsAdmin()));

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  // Load once, remember the promise so a double-click cannot start it twice.
  function ensureEngine() {
    if (engine) return Promise.resolve(engine);
    if (loading) return loading;
    loading = (async () => {
      for (const f of ENGINE_FILES) await loadScript(f + '?v=' + ENGINE_V);
      if (!window.ALB_DATA || !window.ALB_Engine) {
        throw new Error('engine loaded but did not register — run tools/ai/extract-data.js');
      }
      engine = window.ALB_Engine.Engine(window.ALB_DATA);
      return engine;
    })();
    loading.catch(() => { loading = null; });   // allow a retry after a failure
    return loading;
  }

  // ── staleness ─────────────────────────────────────────────────────────────
  // ai-data.json is a SNAPSHOT of builder.js taken by extract-data.js. If the
  // game data changes and nobody re-runs it, the engine keeps answering happily
  // with last week's data — the quietest failure this tool has.
  //
  // On the site we are uniquely able to catch it: builder.js is right there on
  // the same page. Compare the live tables against the snapshot and say so.
  //
  // builder.js declares these with `const` at top level, so they are global
  // bindings but NOT properties of `window` — they have to be referenced by bare
  // name inside a try, not looked up on window.
  function stalenessWarning() {
    const D = window.ALB_DATA;
    if (!D) return null;
    const live = {};
    try { live.races      = typeof races      !== 'undefined' ? races : null; } catch (e) {}
    try { live.gearItems  = typeof gearItems  !== 'undefined' ? gearItems : null; } catch (e) {}
    try { live.armourItems = typeof armourItems !== 'undefined' ? armourItems : null; } catch (e) {}
    try { live.enchantItems = typeof enchantItems !== 'undefined' ? enchantItems : null; } catch (e) {}
    try { live.shardItems = typeof shardItems !== 'undefined' ? shardItems : null; } catch (e) {}
    try { live.gearTraits = typeof gearTraits !== 'undefined' ? gearTraits : null; } catch (e) {}

    const drift = [];
    for (const [key, table] of Object.entries(live)) {
      if (!table || !D[key]) continue;
      const a = Object.keys(table).length, b = Object.keys(D[key]).length;
      if (a !== b) drift.push(key + ' (page has ' + a + ', snapshot has ' + b + ')');
    }
    if (!drift.length) return null;
    return 'The engine\'s data snapshot is out of date with this page: ' + drift.join('; ') +
           '. Builds will be computed from the old data until someone runs ' +
           'node tools/ai/extract-data.js and redeploys.';
  }

  // ── markup ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  // The engine marks emphasis with **bold** / *dim*. Escape FIRST — move and item
  // text comes from the game data and is not ours to trust as markup.
  function md(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
  }

  const EXAMPLES = [
    'max damage crit lancer',
    'tanky build',
    'healer',
    'necro summon build vastayan',
    'berserker carnage max damage',
    'something cool',
  ];

  // Solo or in a party. Deliberately starts as null and stays that way until
  // somebody says: it decides whether an ability that protects four other people
  // is worth five mastery points, and that is not a thing to guess on their
  // behalf. The Build button will not run without it.
  let playStyle = null;

  // Dismissed for the rest of the visit, and back on the next page load. A
  // notice that never returns stops being read after the first change to what
  // it is warning about; one that returns on every open is just a nag.
  let wipDismissed = false;

  function ensureOverlay() {
    let ov = document.getElementById('bai-overlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'bai-overlay';
    ov.innerHTML =
      '<div id="bai-modal" role="dialog" aria-modal="true" aria-label="Build AI">' +
        '<div class="bai-head">' +
          '<h2 class="bai-title">AI</h2>' +
          '<button class="bai-x" id="bai-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="bai-wip" id="bai-wip" role="status">' +
          '<span class="bai-wip-tag">WIP</span>' +
          '<span class="bai-wip-text">This is a work in progress. The numbers come from the ' +
            'builder\'s own maths, but plenty is still unmodelled and every build says what it had ' +
            'to leave out — read that part before trusting a figure.</span>' +
          '<button class="bai-wip-x" id="bai-wip-x" aria-label="Dismiss">&times;</button>' +
        '</div>' +
        '<p class="bai-sub">Ask for a build. It is computed with the builder\'s own maths — ' +
          'no guessing and no API. Every request returns something, and it will tell you ' +
          'what it had to assume.</p>' +
        '<div class="bai-ask">' +
          '<input id="bai-q" placeholder="max damage crit lancer" autocomplete="off">' +
          '<button class="bai-go" id="bai-go">Build</button>' +
        '</div>' +
        '<div class="bai-play" id="bai-play">' +
          '<span class="bai-play-label">Playing</span>' +
          '<button class="bai-play-opt" data-play="solo" type="button">Solo</button>' +
          '<button class="bai-play-opt" data-play="team" type="button">Full team of 5</button>' +
          '<span class="bai-play-hint" id="bai-play-hint">Pick one — it changes which builds are good.</span>' +
        '</div>' +
        '<div class="bai-checks">' +
          '<label class="bai-check" title="Read the build currently in the builder and suggest a better version of it">' +
            '<input type="checkbox" id="bai-usecurrent"> ' +
            '<span>Check my current build</span>' +
          '</label>' +
          '<label class="bai-check" title="Roll a random specialisation and push it as far as it goes">' +
            '<input type="checkbox" id="bai-minmax"> ' +
            '<span>Random min-max</span>' +
          '</label>' +
          '<button class="bai-reroll" id="bai-reroll" hidden>Reroll</button>' +
        '</div>' +
        '<div class="bai-examples" id="bai-examples"></div>' +
        '<button class="bai-adv-toggle" id="bai-adv-toggle" aria-expanded="false">' +
          '<span id="bai-adv-arrow">&#9656;</span> Advanced <span class="bai-adv-count" id="bai-adv-count"></span>' +
        '</button>' +
        '<div class="bai-adv" id="bai-adv" hidden></div>' +
        '<div class="bai-out" id="bai-out"></div>' +
      '</div>';
    document.body.appendChild(ov);

    ov.querySelector('#bai-examples').innerHTML =
      EXAMPLES.map(e => '<span class="bai-ex">' + esc(e) + '</span>').join('');

    // wiring
    ov.querySelector('#bai-wip-x').addEventListener('click', () => {
      wipDismissed = true;
      ov.querySelector('#bai-wip').setAttribute('hidden', '');
    });
    ov.querySelectorAll('.bai-play-opt').forEach(btn => btn.addEventListener('click', () => {
      playStyle = btn.dataset.play;
      ov.querySelectorAll('.bai-play-opt').forEach(b =>
        b.classList.toggle('bai-play-on', b.dataset.play === playStyle));
      const hint = ov.querySelector('#bai-play-hint');
      const K = window.ALB_Knowledge;
      const style = K && K.PLAY_STYLES && K.PLAY_STYLES[playStyle];
      hint.textContent = style ? style.note : '';
      hint.classList.remove('bai-play-needed');
    }));
    ov.querySelector('#bai-close').addEventListener('click', close);
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    ov.querySelector('#bai-go').addEventListener('click', run);
    ov.querySelector('#bai-q').addEventListener('keydown', e => {
      if (e.key === 'Enter') run();
    });
    ov.querySelectorAll('.bai-ex').forEach(el => el.addEventListener('click', () => {
      ov.querySelector('#bai-q').value = el.textContent;
      run();
    }));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && ov.classList.contains('bai-open')) close();
    });

    // The two modes are different questions — "improve what I have" and "invent
    // me something" — so ticking one unticks the other rather than producing
    // some ambiguous third behaviour.
    const useCur = ov.querySelector('#bai-usecurrent');
    const minmax = ov.querySelector('#bai-minmax');
    const reroll = ov.querySelector('#bai-reroll');
    useCur.addEventListener('change', () => {
      if (useCur.checked) minmax.checked = false;
      reroll.hidden = !minmax.checked;
    });
    minmax.addEventListener('change', () => {
      if (minmax.checked) useCur.checked = false;
      reroll.hidden = !minmax.checked;
    });
    reroll.addEventListener('click', run);

    const advBtn = ov.querySelector('#bai-adv-toggle');
    advBtn.addEventListener('click', () => {
      const box = ov.querySelector('#bai-adv');
      const open = box.hasAttribute('hidden');
      if (open) {
        ensureAdvanced().then(() => {
          box.removeAttribute('hidden');
          advBtn.setAttribute('aria-expanded', 'true');
          ov.querySelector('#bai-adv-arrow').innerHTML = '&#9662;';
        });
      } else {
        box.setAttribute('hidden', '');
        advBtn.setAttribute('aria-expanded', 'false');
        ov.querySelector('#bai-adv-arrow').innerHTML = '&#9656;';
      }
    });
    return ov;
  }

  // Advanced options. Every list is built FROM THE DATA, so a new class, race,
  // weapon or armour appears here automatically after extract-data.js runs —
  // there is no second list to keep in step.
  //
  // Every field defaults to "Auto", meaning the optimiser keeps deciding it.
  // Anything you set becomes a hard constraint instead.
  function buildAdvanced() {
    const D = window.ALB_DATA;
    const K = window.ALB_Knowledge;
    if (!D) return '';

    const opt = (v, label, sel) =>
      '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>';
    const auto = () => opt('', 'Auto', true);

    // Items knowledge.js marks as unusable are not offered here either. The
    // engine would refuse them anyway, and an option that silently does nothing
    // is worse than no option.
    const U = (K && K.UNAVAILABLE) || {};
    const unusable = name => {
      if ((U.items || {})[name]) return true;
      const series = ((D.weapons || {})[name] || {}).series;
      return !!(series && (U.weaponSeries || {})[series]);
    };

    // Goals come from the archetype table, so a new archetype shows up here too.
    const goals = Object.entries((K && K.ARCHETYPES) || {})
      .map(([id, a]) => opt(id, a.label)).join('');

    // Classes grouped base -> superclasses, mirroring the game's progression.
    let classes = '';
    for (const [base, supers] of Object.entries(D.classes || {})) {
      classes += '<optgroup label="' + esc(base) + '">';
      classes += opt(base, base);
      for (const sup of supers || []) if ((D.classMoves || {})[sup]) classes += opt(sup, sup);
      classes += '</optgroup>';
    }

    const races   = Object.keys(D.races || {}).map(r => opt(r, r)).join('');
    const armours = Object.keys(D.armourItems || {}).filter(a => !unusable(a)).map(a => opt(a, a)).join('');
    const enchants = Object.keys(D.enchantItems || {}).filter(e => !unusable(e)).map(e => opt(e, e)).join('');

    const types = [...new Set(Object.values(D.weapons || {}).map(w => w.type))].filter(Boolean).sort();
    const wtypes = types.map(t => opt(t, t)).join('');

    // Weapons grouped by type so the list is navigable at 70 entries.
    let weapons = '';
    for (const t of types) {
      weapons += '<optgroup label="' + esc(t) + '">';
      for (const [n, w] of Object.entries(D.weapons || {}))
        if (w.type === t && !unusable(n)) weapons += opt(n, n);
      weapons += '</optgroup>';
    }

    const field = (id, label, inner) =>
      '<label class="bai-field"><span>' + esc(label) + '</span>' + inner + '</label>';

    return '<div class="bai-grid">' +
      field('bai-goal',   'Goal',        '<select id="bai-goal">'   + auto() + goals   + '</select>') +
      field('bai-class',  'Class',       '<select id="bai-class">'  + auto() + classes + '</select>') +
      field('bai-race',   'Race',        '<select id="bai-race">'   + auto() + races   + '</select>') +
      field('bai-wtype',  'Weapon type', '<select id="bai-wtype">'  + auto() + wtypes  + '</select>') +
      field('bai-weapon', 'Weapon',      '<select id="bai-weapon">' + auto() + weapons + '</select>') +
      field('bai-armour', 'Armour',      '<select id="bai-armour">' + auto() + armours + '</select>') +
      field('bai-ench',   'Enchant',     '<select id="bai-ench">'   + auto() + enchants + '</select>') +
      field('bai-level',  'Level',       '<input id="bai-level" type="number" min="1" max="' +
                                          (D.Max_Lvl || 50) + '" placeholder="Auto">') +
      '</div>' +
      '<div class="bai-adv-foot">' +
        '<button class="bai-btn" id="bai-reset">Reset options</button>' +
        '<span class="bai-note">Anything left on Auto is chosen for you. ' +
          'Options beat whatever the text says.</span>' +
      '</div>';
  }

  const ADV_IDS = ['bai-goal','bai-class','bai-race','bai-wtype','bai-weapon','bai-armour','bai-ench','bai-level'];

  function readOverrides() {
    const val = id => {
      const el = document.getElementById(id);
      return el && el.value ? el.value : null;
    };
    const lvl = val('bai-level');
    return {
      play:       playStyle,
      goal:       val('bai-goal'),
      klass:      val('bai-class'),
      race:       val('bai-race'),
      weaponType: val('bai-wtype'),
      weaponName: val('bai-weapon'),
      armour:     val('bai-armour'),
      enchant:    val('bai-ench'),
      level:      lvl ? parseInt(lvl, 10) : null,
    };
  }

  function countOverrides() {
    // `play` is a required answer, not an optional override, so it does not
    // belong in the "N options set" count on the Advanced toggle.
    const o = readOverrides();
    delete o.play;
    return Object.values(o).filter(v => v !== null && v !== '' && !Number.isNaN(v)).length;
  }

  function syncAdvCount() {
    const el = document.getElementById('bai-adv-count');
    if (!el) return;
    const n = countOverrides();
    el.textContent = n ? '(' + n + ' set)' : '';
  }

  // Populated the first time Advanced is opened, because the option lists need
  // the engine's data snapshot and that is lazy loaded.
  function ensureAdvanced() {
    const box = document.getElementById('bai-adv');
    if (!box || box.dataset.ready) return Promise.resolve();
    return ensureEngine().then(() => {
      box.innerHTML = buildAdvanced();
      box.dataset.ready = '1';
      ADV_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', syncAdvCount);
      });
      // Picking a specific weapon makes the type redundant — keep them coherent
      // rather than letting a Dagger sit under "Weapon type: Staff".
      const wep = document.getElementById('bai-weapon');
      const wt  = document.getElementById('bai-wtype');
      if (wep && wt) {
        wep.addEventListener('change', () => {
          const w = (window.ALB_DATA.weapons || {})[wep.value];
          if (w && w.type) wt.value = w.type;
          syncAdvCount();
        });
        wt.addEventListener('change', () => {
          const w = (window.ALB_DATA.weapons || {})[wep.value];
          if (wep.value && w && w.type !== wt.value) wep.value = '';
          syncAdvCount();
        });
      }
      const reset = document.getElementById('bai-reset');
      if (reset) reset.addEventListener('click', () => {
        ADV_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        syncAdvCount();
      });
      syncAdvCount();
    });
  }

  function section(title, inner, warn) {
    return '<div class="bai-sec' + (warn ? ' bai-warn' : '') + '"><h3>' + esc(title) + '</h3>' + inner + '</div>';
  }

  function render(sections) {
    let html = '';
    for (const s of sections) {
      let inner = '';
      if (s.body) inner += '<div>' + md(s.body) + '</div>';
      if (s.table) {
        inner += '<table>' + s.table.map(r =>
          '<tr><td>' + esc(r[0]) + '</td><td>' + md(r[1]) + '</td></tr>').join('') + '</table>';
      }
      if (s.list) inner += '<ul>' + s.list.map(i => '<li>' + md(i) + '</li>').join('') + '</ul>';
      html += section(s.h, inner, s.h === 'Watch out');
    }
    return html;
  }

  // Refuses rather than assuming. Both answers are legitimate and they produce
  // genuinely different builds, so the only wrong move is to pick one silently.
  function needsPlayStyle(ov) {
    if (playStyle) return false;
    const hint = ov.querySelector('#bai-play-hint');
    if (hint) {
      hint.textContent = 'Choose Solo or Full team first — a party changes which mastery ' +
                         'capstones and which classes are worth taking.';
      hint.classList.add('bai-play-needed');
    }
    const box = ov.querySelector('#bai-play');
    if (box) { box.classList.remove('bai-play-nudge'); void box.offsetWidth; box.classList.add('bai-play-nudge'); }
    return true;
  }

  function run() {
    const ov = ensureOverlay();
    if (needsPlayStyle(ov)) return;
    const useCurrent = ov.querySelector('#bai-usecurrent');
    if (useCurrent && useCurrent.checked) return runAnalyse();

    const out = ov.querySelector('#bai-out');
    const go  = ov.querySelector('#bai-go');
    const req = ov.querySelector('#bai-q').value;

    go.disabled = true;
    out.innerHTML = section('Working', '<div class="bai-note">searching…</div>');

    ensureEngine().then(eng => {
      // Yield a frame so "searching…" paints before the search blocks the thread.
      return new Promise(r => setTimeout(() => r(eng), 16));
    }).then(eng => {
      const t0 = Date.now();
      const res = eng.ask(req, Object.assign(readOverrides(), {
        minmax: ov.querySelector('#bai-minmax').checked || undefined,
      }));
      lastResult = res;
      const ms = Date.now() - t0;

      let html = '';
      const stale = stalenessWarning();
      if (stale) html += section('Out of date', '<div>' + esc(stale) + '</div>', true);
      html += render(res.explanation);
      html += section('Use it',
        '<div class="bai-actions">' +
          '<button class="bai-btn bai-btn-primary" id="bai-load">Load into builder</button>' +
          '<button class="bai-btn" id="bai-copy">Copy link</button>' +
          '<span class="bai-note">computed in ' + ms + 'ms</span>' +
        '</div><div class="bai-note" id="bai-linkwrap" style="margin-top:8px"></div>');
      out.innerHTML = html;

      out.querySelector('#bai-load').addEventListener('click', () => loadIntoBuilder(res.build, res));
      out.querySelector('#bai-copy').addEventListener('click', copyLink);

      // The link is async (deflate), so it lands after the build is already shown.
      eng.link(res.build, { name: req || 'Build AI' }).then(url => {
        if (!url) return;
        lastResult.url = url;
        const w = out.querySelector('#bai-linkwrap');
        if (w) w.innerHTML = '<a class="bai-link" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a>';
      });
    }).catch(err => {
      out.innerHTML = section('Could not build', '<div>' + esc(err && err.message || err) + '</div>', true);
    }).then(() => { go.disabled = false; });
  }

  // Read whatever is in the builder right now and suggest a better version of it.
  //
  // getBuildState() is builder.js's own serialiser — the same one the share
  // links use — so this sees exactly what the player has, including gear tiers,
  // traits and mastery, with no separate DOM scraping to drift out of step.
  function runAnalyse() {
    const ov = ensureOverlay();
    const out = ov.querySelector('#bai-out');
    const go  = ov.querySelector('#bai-go');

    if (typeof getBuildState !== 'function') {
      out.innerHTML = section('Not available here',
        '<div>The builder is not loaded on this page, so there is no build to read.</div>', true);
      return;
    }

    go.disabled = true;
    out.innerHTML = section('Working', '<div class="bai-note">reading your build…</div>');

    ensureEngine().then(eng => new Promise(r => setTimeout(() => r(eng), 16))).then(eng => {
      const t0 = Date.now();
      const state = getBuildState();
      const res = eng.analyse(state, Object.assign(readOverrides(), {
        text: ov.querySelector('#bai-q').value || '',
      }));
      lastResult = { build: res.improved || res.current, url: null };
      const ms = Date.now() - t0;

      let html = '';
      const stale = stalenessWarning();
      if (stale) html += section('Out of date', '<div>' + esc(stale) + '</div>', true);

      if (!res.current.klass) {
        html += section('Pick a class first',
          '<div>Your builder has no class selected, so there is nothing to compare against. ' +
          'Choose one and try again.</div>', true);
        out.innerHTML = html;
        go.disabled = false;
        return;
      }

      const c = res.currentCtx, i = res.improvedCtx;
      const n1 = v => (Math.round(v * 10) / 10).toLocaleString();
      const delta = (a, b, suffix) => {
        const d = b - a;
        const sign = d > 0 ? '+' : '';
        const cls = Math.abs(d) < 0.05 ? 'bai-same' : (d > 0 ? 'bai-up' : 'bai-down');
        return '<span class="' + cls + '">' + sign + n1(d) + (suffix || '') + '</span>';
      };

      html += section('Your build',
        '<table>' +
          '<tr><td>Class</td><td>' + esc(res.current.klass) + '</td></tr>' +
          '<tr><td>Race</td><td>' + esc(res.current.race || '—') + '</td></tr>' +
          '<tr><td>Level</td><td>' + esc(String(res.current.level)) + '</td></tr>' +
          '<tr><td>Read as</td><td>' + esc((window.ALB_Knowledge.ARCHETYPES[res.spec.goal] || {}).label ||
                                            res.spec.goal) +
            ' <span class="bai-note">— set a Goal in Advanced to change this</span></td></tr>' +
        '</table>');

      // Before any comparison: if they are wearing something the game does not
      // allow, that is the most important thing on the screen.
      if (res.unavailable && res.unavailable.length) {
        html += section('Not usable in game',
          '<div>Your build has ' + res.unavailable.length + ' item' +
          (res.unavailable.length > 1 ? 's' : '') + ' that cannot be used right now:</div><ul>' +
          res.unavailable.map(u => '<li><b>' + esc(u.name) + '</b> (' + esc(u.what.toLowerCase()) +
                                   ') — ' + esc(u.why) + '</li>').join('') +
          '</ul><div class="bai-note">The improved build below replaces them.</div>', true);
      }

      if (!res.improved) {
        html += section('Could not improve it',
          '<div>The optimiser failed on this build, so there is nothing to compare.</div>', true);
        out.innerHTML = html;
        go.disabled = false;
        return;
      }

      // Side by side, with the delta doing the talking.
      html += section('Now vs improved',
        '<table class="bai-cmp">' +
          '<tr><td></td><th>Now</th><th>Improved</th><th>Change</th></tr>' +
          row('Best hit',    Math.round(c.bestHit),  Math.round(i.bestHit),  delta(c.bestHit, i.bestHit)) +
          row('HP',          n1(c.hp),               n1(i.hp),               delta(c.hp, i.hp)) +
          row('Crit chance', n1(c.critChance) + '%', n1(i.critChance) + '%', delta(c.critChance, i.critChance, '%')) +
          row('Crit damage', c.critDmg.toFixed(2) + 'x', i.critDmg.toFixed(2) + 'x', delta(c.critDmg, i.critDmg, 'x')) +
          row('Block DR',    n1(c.blockDr) + '%',    n1(i.blockDr) + '%',    delta(c.blockDr, i.blockDr, '%')) +
          row('Heal out',    n1(c.outHeal) + '%',    n1(i.outHeal) + '%',    delta(c.outHeal, i.outHeal, '%')) +
          row('Max energy',  c.energyCap,            i.energyCap,            delta(c.energyCap, i.energyCap)) +
        '</table>');

      // Anything the "improvement" actually made worse, said out loud. An
      // optimiser maximises one score; that can cost something the player was
      // relying on, and burying it in a red cell is not good enough.
      const worse = [
        ['damage',        c.bestHit,    i.bestHit,    ''],
        ['HP',            c.hp,         i.hp,         ''],
        ['crit chance',   c.critChance, i.critChance, '%'],
        ['block DR',      c.blockDr,    i.blockDr,    '%'],
        ['outgoing heal', c.outHeal,    i.outHeal,    '%'],
        ['max energy',    c.energyCap,  i.energyCap,  ''],
      ].filter(([, a, b]) => b < a * 0.95 && (a - b) > 0.5)
       .map(([name, a, b, sfx]) => name + ' drops from ' + n1(a) + sfx + ' to ' + n1(b) + sfx);

      if (worse.length) {
        html += section('Trade-offs',
          '<div>This build is stronger for <b>' +
          esc((window.ALB_Knowledge.ARCHETYPES[res.spec.goal] || {}).label || res.spec.goal) +
          '</b>, but it costs you something: ' + esc(worse.join('; ')) +
          '. If that matters more than the gain, set a different Goal in Advanced.</div>', true);
      }

      if (res.changes.length) {
        html += section('What to change',
          '<table>' + res.changes.map(ch =>
            '<tr><td>' + esc(ch.what) + '</td><td><span class="bai-from">' + esc(ch.from) +
            '</span> &rarr; <b>' + esc(ch.to) + '</b></td></tr>').join('') + '</table>');
      } else {
        html += section('What to change',
          '<div>Nothing — your build already matches what the optimiser would pick for this goal.</div>');
      }

      // The full reasoning for the improved build, reusing the normal renderer.
      html += render(res.improvedExplanation || []);

      html += section('Use it',
        '<div class="bai-actions">' +
          '<button class="bai-btn bai-btn-primary" id="bai-load">Load improved build</button>' +
          '<button class="bai-btn" id="bai-copy">Copy link</button>' +
          '<span class="bai-note">analysed in ' + ms + 'ms</span>' +
        '</div><div class="bai-note" id="bai-linkwrap" style="margin-top:8px"></div>');

      out.innerHTML = html;
      out.querySelector('#bai-load').addEventListener('click', () => loadIntoBuilder(res.improved, {
        build: res.improved, ctx: res.improvedCtx, spec: res.spec,
        flavour: res.improvedFlavour || null, weaknesses: res.improvedWeaknesses || [],
        corruption: res.improvedCorruption || null,
      }));
      out.querySelector('#bai-copy').addEventListener('click', copyLink);

      eng.link(res.improved, { name: 'Improved build' }).then(url => {
        if (!url) return;
        lastResult.url = url;
        const w = out.querySelector('#bai-linkwrap');
        if (w) w.innerHTML = '<a class="bai-link" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a>';
      });
    }).catch(err => {
      out.innerHTML = section('Could not read your build',
        '<div>' + esc(err && err.message || err) + '</div>', true);
    }).then(() => { go.disabled = false; });
  }

  function row(label, now, improved, change) {
    return '<tr><td>' + esc(label) + '</td><td>' + esc(String(now)) + '</td>' +
           '<td><b>' + esc(String(improved)) + '</b></td><td>' + change + '</td></tr>';
  }

  // Compose the text that goes into the builder's own Summary box when a build is
  // loaded, so the reasoning travels WITH the build — into saved builds, and into
  // any share link made from it afterwards.
  //
  // loadBuildState runs this through _sanitizeSummHtml, so it sticks to <b> and
  // <br>: anything fancier is liable to be stripped and there is no reason to
  // find out the hard way.
  function summaryHtmlFor(res, ctx, spec) {
    const n1 = v => (Math.round(v * 10) / 10).toLocaleString();
    const L = [];

    if (res.flavour) L.push('<b>' + esc(res.flavour.name) + '</b> — ' + esc(res.flavour.line));

    const goalLabel = ((window.ALB_Knowledge.ARCHETYPES[spec.goal] || {}).label || spec.goal);
    L.push('<b>Built for:</b> ' + esc(goalLabel) +
           (spec.minmax ? ' (min-maxed — deliberately specialised)' : ''));

    L.push('<b>Numbers:</b> ' + Math.round(ctx.bestHit) + ' expected damage on ' +
           esc((ctx.bestMove && ctx.bestMove.name) || 'its best move') +
           ' · ' + n1(ctx.hp) + ' HP · ' + n1(ctx.critChance) + '% crit' +
           (ctx.critTier ? ' (tier ' + ctx.critTier + ', every hit crits)' : '') +
           ' · ' + ctx.energyCap + ' max energy');

    // The opening rotation, if the build has one — it is the most actionable
    // thing in the whole summary.
    const fin = ctx.burstMove || ctx.bestMove;
    if (ctx.rotation && ctx.rotation.length) {
      const steps = ctx.rotation.map((rt, i) => 'Turn ' + (i + 1) + ': <b>' + esc(rt.move) + '</b>');
      if (fin) steps.push('Turn ' + (ctx.rotation.length + 1) + ': <b>' + esc(fin.name) + '</b> for ~' +
                          Math.round(ctx.bestBurst) + ' (vs ' + Math.round(ctx.bestHit) + ' cold)');
      L.push('<b>Opening rotation (out of form):</b> ' + steps.join(' → '));
    }

    // And the same build in its Corruption Form, as a SEPARATE rotation. Getting
    // into the form costs 100 Corrupt Energy and the payoff usually costs turns
    // on top, so it is not the rotation above with a bigger number at the end.
    const _cd = res.corruption && res.corruption.best && res.corruption.best.damage;
    if (_cd && (_cd.steps || []).length) {
      const steps = [];
      let turn = 1;
      for (const rt of (ctx.rotation || [])) steps.push('Turn ' + (turn++) + ': <b>' + esc(rt.move) + '</b>');
      let finNote = false;
      for (const st of _cd.steps) {
        if (st.isFinisher) { finNote = true; continue; }
        if (st.turns === 0) { steps.push('Bonus action: <b>' + esc(st.move) + '</b>'); continue; }
        const span = Math.max(1, st.turns | 0);
        steps.push((span > 1 ? 'Turns ' + turn + '–' + (turn + span - 1) : 'Turn ' + turn) +
                   ': <b>' + esc(st.move) + '</b>');
        turn += span;
      }
      if (fin) steps.push('Turn ' + turn + ': <b>' + esc(fin.name) + '</b> for ~' +
                          Math.round(_cd.burstHit) +
                          (_cd.burstGain > 0 ? ' (vs ' + Math.round(ctx.bestBurst) + ' out of form)' : ''));
      L.push('<b>Opening rotation (in ' + esc(res.build.corruption || '') + '):</b> ' + steps.join(' → ') +
             '<br><i>Longer on purpose — weigh the extra turns, the 100 Corrupt Energy and the Recoil ' +
             'backlash against the gain. Every number elsewhere in this summary is out of form.</i>');
    }

    // The niches — the things that make this build this build.
    const niches = [];
    if (spec.tech) niches.push('<b>' + esc(spec.tech.name) + ':</b> ' + esc(spec.tech.why));

    const rr = (window.ALB_Knowledge.RACE_ROLES || {})[res.build.race];
    if (rr && rr.note) niches.push('<b>' + esc(res.build.race) + ':</b> ' + esc(rr.note) + '.');

    if (ctx.traits && ctx.traits.energyCap) {
      niches.push('<b>Overflow:</b> +' + ctx.traits.energyCap + ' max energy. Any move that spends ' +
                  'the whole pool scales with the cap, so this is worth far more than it reads.');
    }
    if (ctx.rotation && ctx.rotation.length) {
      for (const rt of ctx.rotation) {
        niches.push('<b>' + esc(rt.move) + ':</b> ' + esc(rt.note || '') +
                    (rt.uptime < 1 ? ' (about ' + Math.round(rt.uptime * 100) + '% uptime over a long fight)' : ''));
      }
    }
    if (ctx.gearPassives && ctx.gearPassives.active.length) {
      niches.push('<b>Gear passives doing work:</b> ' +
                  esc(ctx.gearPassives.active.map(a => a.name).join(', ')) + '.');
    }
    // The capstones cost 5 mastery points each, so what they do belongs in the
    // summary next to the reason for every other expensive choice.
    if (ctx.masteryAbilities && ctx.masteryAbilities.active.length) {
      for (const a of ctx.masteryAbilities.active) {
        // Third copy of this switch, and the third time it has had to learn a
        // kind. A flat +23 Speed rendered here as "+23% damage" and 100 dodge as
        // "+100% damage" - wrong in the way that reads as perfectly plausible.
        const unit = a.kind === 'critChance' ? ' crit chance'
                   : a.kind === 'dr'        ? '% DR'
                   : a.kind === 'dodge'     ? '% autododge'
                   : a.kind === 'statFlat'  ? ' flat ' + String(a.stat || 'spd').toUpperCase()
                   :                          '% damage';
        niches.push('<b>' + esc(a.name) + ' (mastery):</b> +' + a.value + unit +
                    (a.uptime < 1 ? ', counted at ' + Math.round(a.uptime * 100) + '% uptime' : ', always on') +
                    (a.note ? ' — ' + esc(a.note) : ''));
      }
    }
    if (res.build.corruption) {
      const c = res.corruption && res.corruption.best;
      const d = c && c.damage;
      // The number, not just the name — it is the part somebody can go and check.
      let dmg = '';
      if (d && d.burstGain > 0) {
        dmg = ' In form that is about <b>' + Math.round(d.burstHit) + '</b> on a prepared hit (+' +
              d.burstGain + '%' + (d.assumed && d.assumed.length ? ', assumed' : '') + ') and ' +
              Math.round(d.sustainedHit) + ' per turn.';
      } else if (d && d.ifCrit) {
        dmg = ' It adds no flat damage, but ' + d.ifCrit.need + ' more crit chance from Light Force ' +
              'would take a hit to about <b>' + Math.round(d.ifCrit.hit) + '</b>.';
      }
      niches.push('<b>Corruption — ' + esc(res.build.corruption) + ':</b> ' +
                  esc(c ? c.why : 'suits how this build plays') + dmg);
    }
    if (niches.length) L.push('<br><b>Why it works</b><br>' + niches.join('<br>'));

    // And what it is bad at, which matters more on a specialised build.
    const weak = res.weaknesses || [];
    if (weak.length) L.push('<br><b>Weak to:</b> ' + esc(weak.join(', ')) + '.');

    // Honest about the gaps, in the place someone will read it later.
    const gaps = [];
    if (ctx.passiveList && ctx.passiveList.unknown.length) {
      gaps.push(ctx.passiveList.unknown.length + ' class/race passives');
    }
    if (ctx.gearPassives && ctx.gearPassives.unmodelled.length) {
      gaps.push(ctx.gearPassives.unmodelled.length + ' gear passives');
    }
    // Mastery capstones used to be a blanket gap; now only the ones this build
    // actually took and could not read are.
    if (ctx.masteryAbilities && ctx.masteryAbilities.unmodelled.length) {
      gaps.push(ctx.masteryAbilities.unmodelled.length + ' mastery capstone abilities');
    }
    gaps.push('conditional buffs');
    L.push('<br><i>Not counted in the numbers above: ' + esc(gaps.join(', ')) +
           '. Traits are counted here but the site does not compute them, so its ' +
           'own readouts will be lower.</i>');

    L.push('<br><i>Generated by Build AI.</i>');
    return L.join('<br>');
  }

  // Apply the build to the actual builder. Goes through the site's own
  // _unpackState + loadBuildState rather than poking the DOM, so the panel can
  // never set a combination the builder would not accept itself.
  function loadIntoBuilder(build, res) {
    try {
      if (!window.ALB_Share || typeof window._unpackState !== 'function'
          || typeof window.loadBuildState !== 'function') {
        alert('Builder not ready on this page.');
        return;
      }
      const blob  = window.ALB_Share.packBlob(window.ALB_DATA, build);
      const state = window._unpackState(blob, 'Build AI');
      if (!state) { alert('Could not decode the generated build.'); return; }

      // Carry the reasoning into the builder's Summary box. It then travels with
      // the build through saves and share links, which is the whole point — a
      // build with no explanation is a list of items.
      if (res && res.ctx && res.spec) {
        try {
          state.summ = summaryHtmlFor(res, res.ctx, res.spec);
          state.summc = '#c9a227';
        } catch (e) { /* a summary is a nicety; never lose the build over it */ }
      }
      window.loadBuildState(state);
      close();
      if (typeof window.switchPage === 'function') window.switchPage('builder');
    } catch (e) {
      alert('Could not load the build: ' + (e && e.message || e));
    }
  }

  function copyLink() {
    const url = lastResult && lastResult.url;
    if (!url) return;
    const done = () => {
      const b = document.getElementById('bai-copy');
      if (!b) return;
      const t = b.textContent; b.textContent = 'Copied';
      setTimeout(() => { b.textContent = t; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => {});
    }
  }

  function close() {
    const ov = document.getElementById('bai-overlay');
    if (ov) ov.classList.remove('bai-open');
  }

  // ── entry point ───────────────────────────────────────────────────────────
  window._openBuildAI = function () {
    // Re-checked here, not just where the menu item is drawn — the menu is built
    // once and this is reachable from the console.
    if (!canUseAI()) return;
    if (window._closeProfileMenu) window._closeProfileMenu();
    const ov = ensureOverlay();
    const wip = ov.querySelector('#bai-wip');
    if (wip) wip.toggleAttribute('hidden', wipDismissed);
    ov.classList.add('bai-open');
    const q = ov.querySelector('#bai-q');
    if (q) { q.focus(); q.select(); }
    ensureEngine().catch(() => {});   // warm it while they type
  };
  window._closeBuildAI = close;
}());
