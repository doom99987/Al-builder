/* ── UI Overlay System ────────────────────────────────────────────────────────
   Opens a Document Picture-in-Picture window (always on top).
   Toggle via keybind or the "UI Overlay" button in the profile dropdown.
   Requires Chrome 116+ for PiP; shows an alert otherwise.
   Tabs: Encyclopedia · Venia Tracker · Petent Tracker · Astra Tracker · Party Chat · Settings
   ──────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const DEFS = [
    { key: 'overlay', label: 'Open / Close Overlay' },
  ];

  /* ── State (keybinds only) ──────────────────────────────────────────────── */
  let _state = {};
  try { _state = JSON.parse(localStorage.getItem('al_overlay') || '{}'); } catch {}
  function ws(key) { return (_state[key] = _state[key] || {}); }
  function save() { try { localStorage.setItem('al_overlay', JSON.stringify(_state)); } catch {} }

  /* ── PiP window + active tab ────────────────────────────────────────────── */
  let _pipWin    = null;
  let _switchTab = null; // set once PiP is built

  /* ── Open / focus PiP, then switch to a tab ─────────────────────────────── */
  async function openOverlay(tabKey) {
    tabKey = tabKey || 'enc';

    if (!window.documentPictureInPicture) {
      alert('UI Overlay requires Chrome 116+.\nOpen Chrome to use this feature.');
      return;
    }

    if (_pipWin && !_pipWin.closed) {
      _pipWin.focus();
      if (_switchTab) _switchTab(tabKey);
      return;
    }

    const savedSize = ws('pipSize');
    const pipW = savedSize.width  || 340;
    const pipH = savedSize.height || 520;

    let pipWin;
    try {
      pipWin = await window.documentPictureInPicture.requestWindow({ width: pipW, height: pipH });
    } catch (err) {
      console.warn('PiP failed:', err);
      return;
    }

    _pipWin = pipWin;
    buildPip(pipWin, tabKey);

    // Save size whenever the PiP window is resized
    pipWin.addEventListener('resize', () => {
      ws('pipSize').width  = pipWin.innerWidth;
      ws('pipSize').height = pipWin.innerHeight;
      save();
    });

    pipWin.addEventListener('pagehide', () => {
      _pipWin = null; _switchTab = null;
      window._vtSetDoc?.(null); window._ptSetDoc?.(null); window._atSetDoc?.(null); window._chatSetDoc?.(null);
    });
  }

  /* ── Copy page styles into PiP window ───────────────────────────────────── */
  function copyStyles(pipWin) {
    [...document.styleSheets].forEach(ss => {
      try {
        const style = pipWin.document.createElement('style');
        style.textContent = [...ss.cssRules].map(r => r.cssText).join('');
        pipWin.document.head.appendChild(style);
      } catch {
        if (ss.href) {
          const link = pipWin.document.createElement('link');
          link.rel = 'stylesheet'; link.href = ss.href;
          pipWin.document.head.appendChild(link);
        }
      }
    });
  }

  /* ── Build PiP UI ───────────────────────────────────────────────────────── */
  function buildPip(pipWin, initialTab) {
    const doc = pipWin.document;
    copyStyles(pipWin);

    doc.body.style.cssText =
      'margin:0;padding:0;background:#0d0d0d;color:#ccc;font-family:Inter,Arial,sans-serif;' +
      'height:100vh;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;';

    const tabs = [
      { key: 'enc',      icon: '📖', title: 'Encyclopedia'  },
      { key: 'venia',    icon: '🔮', title: 'Venia Tracker'  },
      { key: 'petent',   icon: '📜', title: 'Petent Tracker' },
      { key: 'astra',    icon: '✦',  title: 'Astra Tracker'  },
      { key: 'chat',     icon: '💬', title: 'Party Chat'     },
      { key: 'settings', icon: '⚙',  title: 'Settings'       },
    ];

    // Header + tab bar
    const header = doc.createElement('div');
    header.style.cssText =
      'background:#0a0a0a;border-bottom:1px solid #1e1e1e;flex-shrink:0;padding:8px 10px 0;';

    const titleRow = doc.createElement('div');
    titleRow.style.cssText =
      'font-family:Rajdhani,Arial,sans-serif;font-size:12px;font-weight:700;' +
      'color:#555;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;';
    titleRow.textContent = 'UI Overlay';
    header.appendChild(titleRow);

    const tabBar = doc.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:0;overflow-x:auto;scrollbar-width:none;';

    tabs.forEach(t => {
      const btn = doc.createElement('button');
      btn.dataset.pipTab = t.key;
      btn.title = t.title;
      btn.textContent = t.icon;
      btn.style.cssText =
        'background:none;border:none;border-bottom:2px solid transparent;' +
        'color:#555;font-size:17px;padding:4px 10px 6px;cursor:pointer;flex-shrink:0;' +
        'transition:color .15s,border-color .15s;';
      btn.addEventListener('click', () => switchTab(t.key));
      tabBar.appendChild(btn);
    });

    header.appendChild(tabBar);
    doc.body.appendChild(header);

    const content = doc.createElement('div');
    content.id = 'pip-content';
    content.style.cssText =
      'flex:1;overflow-y:auto;padding:12px;-webkit-overflow-scrolling:touch;box-sizing:border-box;';
    doc.body.appendChild(content);

    /* ── Switch tab ── */
    function switchTab(key) {
      doc.querySelectorAll('[data-pip-tab]').forEach(b => {
        const on = b.dataset.pipTab === key;
        b.style.color              = on ? '#fff' : '#555';
        b.style.borderBottomColor  = on ? '#fff' : 'transparent';
      });
      // Reset any active tracker / chat doc targets when switching tabs
      window._vtSetDoc?.(null); window._ptSetDoc?.(null); window._atSetDoc?.(null); window._chatSetDoc?.(null);
      content.innerHTML = '';
      if      (key === 'enc')      renderEnc(content);
      else if (key === 'settings') renderSettings(content);
      else if (key === 'venia')    renderTracker(content, 'venia');
      else if (key === 'petent')   renderTracker(content, 'petent');
      else if (key === 'astra')    renderTracker(content, 'astra');
      else if (key === 'chat')     renderChat(content);
    }

    _switchTab = switchTab;
    switchTab(initialTab);

    /* ── Encyclopedia tab ── */
    function renderEnc(root) {
      const items  = window._ENC_ITEMS      || [];
      const tOrder = window._ENC_TYPE_ORDER || [];
      const tIcons = window._ENC_TYPE_ICONS || {};

      /* pre-build type → [{it,i}] map */
      const byType = {};
      items.forEach((it, i) => {
        if (!byType[it[1]]) byType[it[1]] = [];
        byType[it[1]].push({ it, i });
      });

      /* search bar */
      const search = doc.createElement('input');
      search.type = 'text'; search.placeholder = 'Search…'; search.autocomplete = 'off';
      search.style.cssText =
        'width:100%;box-sizing:border-box;background:#111;border:1px solid #2a2a2a;' +
        'border-radius:5px;color:#ddd;font-size:13px;padding:8px 10px;outline:none;' +
        'margin-bottom:8px;font-family:inherit;';
      root.appendChild(search);

      /* type filter bar */
      const filterBar = doc.createElement('div');
      filterBar.style.cssText =
        'display:flex;flex-wrap:wrap;gap:3px;margin-bottom:8px;';
      root.appendChild(filterBar);

      /* browse list (type view) */
      const browseList = doc.createElement('div');
      root.appendChild(browseList);

      /* search results list */
      const searchList = doc.createElement('div');
      searchList.style.display = 'none';
      root.appendChild(searchList);

      /* detail view */
      const detail = doc.createElement('div');
      detail.style.cssText = 'display:none;';
      root.appendChild(detail);

      const backBtn = doc.createElement('button');
      backBtn.textContent = '← Back';
      backBtn.style.cssText =
        'background:none;border:none;color:#666;font-size:12px;cursor:pointer;' +
        'padding:0 0 8px;display:block;';
      detail.appendChild(backBtn);

      const detailBody = doc.createElement('div');
      detail.appendChild(detailBody);

      /* focus styling */
      search.addEventListener('focus', () => search.style.borderColor = '#444');
      search.addEventListener('blur',  () => search.style.borderColor = '#2a2a2a');

      /* show detail */
      function showDetail(idx) {
        detailBody.innerHTML = window._encGetDetail ? window._encGetDetail(idx) : '';
        detailBody.querySelectorAll('[data-enc-nav]').forEach(btn => {
          const targetIdx = items.findIndex(e => e[0] === btn.dataset.encNav);
          if (targetIdx !== -1) btn.addEventListener('click', () => showDetail(targetIdx));
        });
        detail.style.display     = '';
        browseList.style.display = 'none';
        searchList.style.display = 'none';
        filterBar.style.display  = 'none';
        search.style.display     = 'none';
      }

      /* back button */
      backBtn.addEventListener('click', () => {
        detail.style.display    = 'none';
        filterBar.style.display = '';
        search.style.display    = '';
        if (search.value.trim()) {
          searchList.style.display = '';
          browseList.style.display = 'none';
        } else {
          browseList.style.display = '';
          searchList.style.display = 'none';
        }
        search.focus();
      });

      /* make item button */
      function makeItemBtn(it, i) {
        const btn = doc.createElement('button');
        btn.style.cssText =
          'display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;' +
          'background:#111;border:1px solid #1e1e1e;border-radius:5px;color:#bbb;font-size:12px;' +
          'padding:7px 9px;cursor:pointer;text-align:left;font-family:inherit;' +
          'margin-bottom:4px;box-sizing:border-box;';
        btn.innerHTML =
          `<span>${it[0]}</span>` +
          `<span style="font-size:10px;color:#555;flex-shrink:0;">${it[1]}</span>`;
        btn.addEventListener('mouseover', () => { btn.style.background='#1a1a28'; btn.style.borderColor='#333'; });
        btn.addEventListener('mouseout',  () => { btn.style.background='#111';    btn.style.borderColor='#1e1e1e'; });
        btn.addEventListener('click', () => showDetail(i));
        return btn;
      }

      /* show items for a type */
      const filterBtnMap = {};
      let activeType = null;
      function showType(type) {
        if (activeType && filterBtnMap[activeType]) {
          filterBtnMap[activeType].style.background   = 'none';
          filterBtnMap[activeType].style.borderColor  = '#2a2a2a';
          filterBtnMap[activeType].style.color        = '#666';
        }
        activeType = type;
        if (filterBtnMap[type]) {
          filterBtnMap[type].style.background   = '#1a1a28';
          filterBtnMap[type].style.borderColor  = '#444';
          filterBtnMap[type].style.color        = '#ccc';
        }
        browseList.innerHTML = '';
        (byType[type] || []).forEach(({ it, i }) => browseList.appendChild(makeItemBtn(it, i)));
      }

      /* build filter buttons */
      let firstType = null;
      tOrder.forEach(type => {
        if (!byType[type]?.length) return;
        if (!firstType) firstType = type;
        const btn = doc.createElement('button');
        btn.title = type;
        btn.textContent = tIcons[type] || type;
        btn.style.cssText =
          'background:none;border:1px solid #2a2a2a;border-radius:4px;color:#666;' +
          'font-size:14px;padding:3px 7px;cursor:pointer;font-family:inherit;flex-shrink:0;' +
          'transition:color .15s,border-color .15s,background .15s;';
        btn.addEventListener('click', () => showType(type));
        filterBar.appendChild(btn);
        filterBtnMap[type] = btn;
      });

      /* show first type on load */
      if (firstType) showType(firstType);

      /* search */
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        searchList.innerHTML = '';
        detail.style.display = 'none';
        if (!q) {
          searchList.style.display = 'none';
          browseList.style.display = '';
          filterBar.style.display  = '';
          return;
        }
        searchList.style.display = '';
        browseList.style.display = 'none';

        const hits = [];
        for (let i = 0; i < items.length; i++) {
          if (items[i][0].toLowerCase().includes(q)) hits.push(i);
          if (hits.length >= 15) break;
        }
        if (!hits.length) {
          searchList.innerHTML = '<div style="text-align:center;color:#555;font-size:12px;padding:12px 0;">No results</div>';
          return;
        }
        hits.forEach(i => searchList.appendChild(makeItemBtn(items[i], i)));
      });
    }

    /* ── Inline tracker tab ── */
    function renderTracker(root, trackerKey) {
      const configs = {
        venia:  { ids: [['venia-tracker-tabs', 'vt-tabs-bar'], ['venia-tracker-tier', 'pt-tier-bar'], ['venia-tracker-grid', 'vt-grid']],   setDoc: '_vtSetDoc', render: '_vtRender' },
        petent: { ids: [['petent-tracker-tabs', 'vt-tabs-bar'], ['petent-tracker-tier', 'pt-tier-bar'], ['petent-tracker-grid', 'pt-tracker-grid']], setDoc: '_ptSetDoc', render: '_ptRender' },
        astra:  { ids: [['astra-tracker-tabs', 'vt-tabs-bar'], ['astra-tracker-grid', 'pt-tracker-grid']],                                           setDoc: '_atSetDoc', render: '_atRender' },
      };
      const cfg = configs[trackerKey];
      if (!cfg) return;

      cfg.ids.forEach(([id, cls]) => {
        const el = doc.createElement('div');
        el.id = id;
        if (cls) el.className = cls;
        root.appendChild(el);
      });

      window[cfg.setDoc]?.(doc);
      window[cfg.render]?.();
    }

    /* ── Party Chat tab ── */
    function renderChat(root) {
      const title = doc.createElement('div');
      title.id = 'party-panel-title';
      title.style.cssText = 'font-size:13px;font-weight:700;color:#d0c8f0;margin-bottom:8px;';
      root.appendChild(title);

      const members = doc.createElement('div');
      members.id = 'party-panel-members';
      members.style.cssText = 'font-size:12px;color:#888;margin-bottom:8px;';
      root.appendChild(members);

      const chatArea = doc.createElement('div');
      chatArea.id = 'party-panel-chat';
      chatArea.style.cssText =
        'flex:1;overflow-y:auto;min-height:160px;max-height:260px;display:flex;flex-direction:column;' +
        'gap:6px;margin-bottom:8px;padding:4px 0;';
      root.appendChild(chatArea);

      const footer = doc.createElement('div');
      footer.style.cssText = 'display:flex;gap:6px;';

      const input = doc.createElement('input');
      input.id = 'party-chat-input';
      input.type = 'text';
      input.placeholder = 'Message your party…';
      input.maxLength = 500;
      input.autocomplete = 'off';
      input.style.cssText =
        'flex:1;background:#111;border:1px solid #2a2a2a;border-radius:5px;color:#ddd;' +
        'font-size:13px;padding:7px 10px;outline:none;font-family:inherit;box-sizing:border-box;';
      input.addEventListener('keydown', e => { if (e.key === 'Enter') window._partySend?.(); });
      footer.appendChild(input);

      const sendBtn = doc.createElement('button');
      sendBtn.textContent = 'Send';
      sendBtn.style.cssText =
        'background:#1a1a28;border:1px solid #333;border-radius:5px;color:#bbb;font-size:12px;' +
        'padding:7px 10px;cursor:pointer;font-family:inherit;white-space:nowrap;';
      sendBtn.addEventListener('click', () => window._partySend?.());
      footer.appendChild(sendBtn);
      root.appendChild(footer);

      const leaveBtn = doc.createElement('button');
      leaveBtn.id = 'party-leave-btn';
      leaveBtn.style.cssText =
        'width:100%;margin-top:8px;background:none;border:1px solid #3a1a1a;border-radius:5px;' +
        'color:#884444;font-size:12px;padding:6px;cursor:pointer;font-family:inherit;';
      leaveBtn.addEventListener('click', () => window._partyLeave?.());
      root.appendChild(leaveBtn);

      window._chatSetDoc?.(doc);
      window._chatOpenInPip?.();
    }

    /* ── Settings tab (keybinds) ── */
    function renderSettings(root) {
      const heading = doc.createElement('div');
      heading.style.cssText =
        'font-family:Rajdhani,Arial,sans-serif;font-size:11px;font-weight:700;' +
        'letter-spacing:1px;text-transform:uppercase;color:#555;margin-bottom:10px;';
      heading.textContent = 'Keybinds — click a field then press a key';
      root.appendChild(heading);

      DEFS.forEach(def => {
        const row = doc.createElement('div');
        row.style.cssText =
          'display:grid;grid-template-columns:1fr 70px;gap:8px;align-items:center;' +
          'padding:8px 10px;background:#111;border:1px solid #1e1e1e;border-radius:6px;margin-bottom:5px;';

        const lbl = doc.createElement('span');
        lbl.style.cssText =
          'font-family:Rajdhani,Arial,sans-serif;font-size:13px;font-weight:600;color:#ccc;';
        lbl.textContent = def.label;

        const kb = doc.createElement('input');
        kb.value       = ws(def.key).keybind || '';
        kb.placeholder = 'None';
        kb.readOnly    = true;
        kb.style.cssText =
          'background:#1a1a1a;border:1px solid #2a2a2a;border-radius:4px;color:#aaa;' +
          'font-size:12px;text-align:center;padding:4px;cursor:pointer;' +
          'font-family:monospace;width:100%;box-sizing:border-box;outline:none;';
        kb.addEventListener('focus', () => {
          kb.placeholder = 'Press key…'; kb.value = '';
          kb.style.borderColor = '#555'; kb.style.color = '#fff';
        });
        kb.addEventListener('blur', () => {
          kb.placeholder = 'None'; kb.value = ws(def.key).keybind || '';
          kb.style.borderColor = '#2a2a2a'; kb.style.color = '#aaa';
        });
        kb.addEventListener('keydown', e => {
          e.preventDefault();
          const k = (e.key === 'Escape' || e.key === 'Backspace') ? '' : e.key;
          ws(def.key).keybind = k; kb.value = k; save(); kb.blur();
        });

        row.appendChild(lbl);
        row.appendChild(kb);
        root.appendChild(row);
      });
    }
  }

  /* ── Global keybind listener ────────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const bind = ws('overlay').keybind || 'Tab';
    if (e.key === bind) {
      e.preventDefault();
      if (_pipWin && !_pipWin.closed) { _pipWin.close(); } else { openOverlay(); }
    }
  });

  /* ── Public API ─────────────────────────────────────────────────────────── */
  window._overlayToggle = openOverlay;

  // No DOMContentLoaded needed — no in-page elements to wire up
})();
