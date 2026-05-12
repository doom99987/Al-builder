(function () {
  'use strict';

  // Uses shared_builds (INSERT + SELECT only).
  // Community builds:  payload._community = 'true', payload._fp = fingerprint
  // Like records:      payload._like = 'true', payload._buildId, payload._fp
  // Delete markers:    payload._deleted = 'true', payload._buildId, payload._fp

  let _allBuilds   = [];
  let _likedSet    = new Set();
  let _sortMode    = 'likes';
  let _searchQuery = '';
  let _loaded      = false;
  let _filterOpen  = false;

  // ── Fingerprint ───────────────────────────────────────────────────────────────
  function _getFingerprint() {
    let fp = localStorage.getItem('alb_visitor');
    if (!fp) {
      fp = 'fp_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('alb_visitor', fp);
    }
    return fp;
  }

  function _loadLikedCache() {
    try { const r = localStorage.getItem('alb_liked_builds'); if (r) _likedSet = new Set(JSON.parse(r)); } catch (_) {}
  }
  function _saveLikedCache() {
    try { localStorage.setItem('alb_liked_builds', JSON.stringify([..._likedSet])); } catch (_) {}
  }

  // ── Parse share link → build code ────────────────────────────────────────────
  function _parseBuildLink(raw) {
    raw = raw.trim();
    try {
      const url = new URL(raw.includes('://') ? raw : 'https://x.com?' + raw.replace(/^\?/, ''));
      const id = url.searchParams.get('id');
      if (id) return id;
    } catch (_) {}
    if (raw.startsWith('bz_') || raw.startsWith('b_')) return raw;
    if (/^[A-Za-z0-9_-]{4,60}$/.test(raw)) return raw;
    return null;
  }

  // ── Decode build code ─────────────────────────────────────────────────────────
  async function _resolveMeta(code) {
    if (typeof window._builderParseBuildCode !== 'function') return null;
    try {
      const p = await window._builderParseBuildCode(code);
      if (!p) return null;
      return { d: p.d, n: (p.n !== 'Untitled' ? p.n : null), summ: p.summ || null, summc: p.summc || '#dddddd' };
    } catch (_) { return null; }
  }

  // ── Fetch builds + like counts + deleted set ──────────────────────────────────
  async function _fetchBuilds() {
    const sb = window._sbClient;
    if (!sb) return [];

    const [buildsRes, metaRes] = await Promise.all([
      sb.from('shared_builds').select('id, payload, created_at')
        .filter('payload->>_community', 'eq', 'true').limit(300),
      sb.from('shared_builds').select('payload')
        .or('payload->>_like.eq.true,payload->>_deleted.eq.true').limit(10000)
    ]);

    if (buildsRes.error) { console.error('[builds] fetch error:', buildsRes.error.message); return []; }

    const fp = _getFingerprint();
    const counts  = {};
    const deleted = new Set();

    (metaRes.data || []).forEach(row => {
      const p = row.payload;
      if (p._like === 'true' && p._buildId) {
        counts[p._buildId] = (counts[p._buildId] || 0) + 1;
        if (p._fp === fp) _likedSet.add(p._buildId);
      }
      if (p._deleted === 'true' && p._buildId) deleted.add(p._buildId);
    });
    _saveLikedCache();

    return (buildsRes.data || [])
      .filter(row => !deleted.has(row.id))
      .map(row => ({
        id:           row.id,
        build_code:   row.id,
        build_name:   row.payload._displayName || row.payload.n || 'Untitled',
        build_summary:row.payload.summ || null,
        submitted_by: row.payload._submittedBy || 'Anonymous',
        fp:           row.payload._fp || null,
        likes:        counts[row.id] || 0,
        created_at:   row.created_at
      }));
  }

  // ── Link autofill ─────────────────────────────────────────────────────────────
  function _setupLinkAutofill() {
    const linkEl = document.getElementById('blds-link-input');
    const nameEl = document.getElementById('blds-name-input');
    const descEl = document.getElementById('blds-desc-input');
    if (!linkEl) return;
    async function tryAutofill() {
      const code = _parseBuildLink(linkEl.value);
      if (!code) return;
      const meta = await _resolveMeta(code);
      if (!meta) return;
      if (nameEl && !nameEl.value.trim() && meta.n)    nameEl.value = meta.n;
      if (descEl && !descEl.value.trim() && meta.summ) descEl.value = meta.summ;
    }
    linkEl.addEventListener('paste', () => setTimeout(tryAutofill, 50));
    linkEl.addEventListener('blur', tryAutofill);
  }

  // ── Ownership check ───────────────────────────────────────────────────────────
  function _isOwner(build) {
    const fp       = _getFingerprint();
    const username = typeof window._sbGetUsername === 'function' ? window._sbGetUsername() : null;
    if (build.fp && build.fp === fp) return true;
    if (username && build.submitted_by === username) return true;
    return false;
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _buildCard(b) {
    const liked   = _likedSet.has(b.id);
    const owner   = _isOwner(b);
    const isAdmin = typeof window._sbIsAdmin === 'function' && window._sbIsAdmin();
    const date    = new Date(b.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    const canRemove = owner || isAdmin;
    return `
      <div class="blds-card" data-id="${b.id}">
        <div class="blds-card-body">
          <div class="blds-card-name">${_esc(b.build_name)}</div>
          ${b.build_summary ? `<div class="blds-card-summary">${_esc(b.build_summary)}</div>` : ''}
          <div class="blds-card-meta">
            <span class="blds-card-by">by ${_esc(b.submitted_by)}</span>
            <span class="blds-card-dot">·</span>
            <span class="blds-card-date">${date}</span>
          </div>
        </div>
        <div class="blds-card-actions">
          <button class="blds-open-btn" onclick="window._buildsOpen('${_esc(b.build_code)}')">Open in Builder</button>
          <button class="blds-like-btn${liked ? ' liked' : ''}" onclick="window._buildsToggleLike('${b.id}', this)" title="${liked ? 'Unlike' : 'Like'}">
            <span class="blds-like-icon">${liked ? '♥' : '♡'}</span>
            <span class="blds-like-count">${b.likes}</span>
          </button>
          ${canRemove ? `<button class="blds-delete-btn${isAdmin && !owner ? ' blds-delete-btn--admin' : ''}" onclick="window._buildsDelete('${b.id}', this)" title="${isAdmin && !owner ? 'Remove (admin)' : 'Delete your build'}">✕</button>` : ''}
        </div>
      </div>`;
  }

  function _render() {
    const list = document.getElementById('blds-list');
    if (!list) return;
    let builds = [..._allBuilds];
    if (_searchQuery) {
      const q = _searchQuery.toLowerCase();
      builds = builds.filter(b =>
        (b.build_name    || '').toLowerCase().includes(q) ||
        (b.build_summary || '').toLowerCase().includes(q) ||
        (b.submitted_by  || '').toLowerCase().includes(q)
      );
    }
    builds.sort((a, b) => _sortMode === 'newest'
      ? new Date(b.created_at) - new Date(a.created_at)
      : (b.likes || 0) - (a.likes || 0)
    );
    if (!builds.length) {
      list.innerHTML = `<div class="blds-state">${_searchQuery ? 'No builds match your search.' : 'No builds yet — be the first to share one!'}</div>`;
      return;
    }
    list.innerHTML = builds.map(_buildCard).join('');
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window._buildsLoad = async function () {
    if (_loaded) { _render(); return; }
    const list = document.getElementById('blds-list');
    if (list) list.innerHTML = '<div class="blds-state">Loading builds…</div>';
    _loadLikedCache();
    _setupLinkAutofill();
    _allBuilds = await _fetchBuilds();
    _loaded    = true;
    _render();
  };

  window._buildsSearch = function (q) { _searchQuery = q; _render(); };

  window._buildsToggleFilter = function () {
    _filterOpen = !_filterOpen;
    const panel = document.getElementById('blds-filter-panel');
    const btn   = document.querySelector('.blds-filter-btn');
    if (panel) panel.style.display = _filterOpen ? 'flex' : 'none';
    if (btn)   btn.classList.toggle('active', _filterOpen);
  };

  window._buildsSetSort = function (mode, btn) {
    _sortMode = mode;
    document.querySelectorAll('.blds-chip').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    _render();
  };

  window._buildsSubmit = async function () {
    const sb        = window._sbClient;
    const linkEl    = document.getElementById('blds-link-input');
    const nameEl    = document.getElementById('blds-name-input');
    const descEl    = document.getElementById('blds-desc-input');
    const submitBtn = document.querySelector('.blds-submit-btn');
    if (!linkEl || !nameEl) return;

    const raw  = (linkEl.value  || '').trim();
    const desc = (descEl?.value || '').trim();
    if (!raw) { _toast('Paste a share link or build code.', 'err'); return; }
    if (!sb)  { _toast('Not connected — try again shortly.', 'err'); return; }

    const code = _parseBuildLink(raw);
    if (!code) { _toast('Could not parse that link.', 'err'); return; }

    submitBtn.disabled    = true;
    submitBtn.textContent = 'Resolving…';

    const meta = await _resolveMeta(code);
    let name = (nameEl.value || '').trim();
    if (!name && meta?.n) name = meta.n;
    const summary = desc || meta?.summ || null;

    if (!name || !meta?.d) {
      submitBtn.disabled    = false;
      submitBtn.textContent = 'Upload';
      _toast(name ? 'Could not decode build. Check the link.' : 'Enter a build name.', 'err');
      return;
    }

    submitBtn.textContent = 'Uploading…';
    const fp          = _getFingerprint();
    const submittedBy = (typeof window._sbGetUsername === 'function' && window._sbGetUsername()) || 'Anonymous';

    const communityPayload = {
      d: meta.d, n: meta.n || name, summ: summary, summc: meta.summc || '#dddddd',
      _community: 'true', _displayName: name, _submittedBy: submittedBy, _fp: fp
    };

    const newId = typeof window._saveSharedBuild === 'function'
      ? await window._saveSharedBuild(communityPayload) : null;

    submitBtn.disabled    = false;
    submitBtn.textContent = 'Upload';

    if (!newId) { _toast('Upload failed. Try again.', 'err'); return; }

    _allBuilds.unshift({ id: newId, build_code: newId, build_name: name, build_summary: summary, submitted_by: submittedBy, fp, likes: 0, created_at: new Date().toISOString() });
    linkEl.value = ''; nameEl.value = ''; if (descEl) descEl.value = '';
    _toast('Build uploaded!', 'ok');
    _render();
  };

  window._buildsDelete = async function (buildId, btn) {
    const isAdmin = typeof window._sbIsAdmin === 'function' && window._sbIsAdmin();
    const msg = isAdmin && !_isOwner(_allBuilds.find(b => b.id === buildId) || {})
      ? 'Remove this build as admin? This cannot be undone.'
      : 'Delete this build? This cannot be undone.';
    if (!confirm(msg)) return;
    const sb = window._sbClient;
    const fp = _getFingerprint();

    // Remove from local list immediately
    _allBuilds = _allBuilds.filter(b => b.id !== buildId);
    _render();

    // Insert delete marker
    if (sb) {
      const markerId = 'del-' + buildId.slice(0, 16) + '-' + Date.now().toString(36);
      await sb.from('shared_builds').insert({
        id: markerId,
        payload: { _deleted: 'true', _buildId: buildId, _fp: fp }
      });
    }
  };

  function _toast(msg, type) {
    const el = document.getElementById('blds-submit-msg');
    if (!el) return;
    el.textContent = msg;
    el.className = 'blds-submit-msg ' + (type === 'err' ? 'blds-msg-err' : 'blds-msg-ok');
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  window._buildsOpen = function (code) {
    const base = location.origin + location.pathname;
    window.open(`${base}?id=${encodeURIComponent(code)}#builder`, '_blank');
  };

  window._buildsToggleLike = async function (buildId, btn) {
    const sb      = window._sbClient;
    const fp      = _getFingerprint();
    const countEl = btn.querySelector('.blds-like-count');
    const iconEl  = btn.querySelector('.blds-like-icon');
    const build   = _allBuilds.find(b => b.id === buildId);
    const already = _likedSet.has(buildId);

    if (already) {
      _likedSet.delete(buildId);
      btn.classList.remove('liked');
      if (iconEl) iconEl.textContent = '♡';
      if (build) { build.likes = Math.max(0, (build.likes || 1) - 1); if (countEl) countEl.textContent = build.likes; }
    } else {
      _likedSet.add(buildId);
      btn.classList.add('liked');
      if (iconEl) iconEl.textContent = '♥';
      if (build) { build.likes = (build.likes || 0) + 1; if (countEl) countEl.textContent = build.likes; }
      if (sb) {
        const likeId = 'like-' + buildId.slice(0, 12) + '-' + fp.slice(0, 8) + '-' + Date.now().toString(36);
        await sb.from('shared_builds').insert({ id: likeId, payload: { _like: 'true', _buildId: buildId, _fp: fp } });
      }
    }
    _saveLikedCache();
  };

})();
