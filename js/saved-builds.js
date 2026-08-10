// § SAVED BUILDS
// Persists build snapshots to localStorage under _SAVED_BUILDS_KEY.
// Each entry: { id: Date.now(), name: string, ts: timestamp, fav: bool, state: BuildState }
// Builds are sorted favourites-first, then by timestamp descending.
// Search filters across name, race, class, superclass, and subclass fields.
// Capped at _MAX_SAVED_BUILDS slots (overwrite/delete free them up).
var _SAVED_BUILDS_KEY = 'alb:saved-builds';
var _MAX_SAVED_BUILDS = 50;

// Reads all saved builds from localStorage; returns an empty array on parse failure.
function _getSavedBuilds() {
  try { return JSON.parse(localStorage.getItem(_SAVED_BUILDS_KEY)) || []; } catch (e) { return []; }
}

// Writes the array to localStorage without touching sync state. Used by the
// pull path, which must not mark this browser dirty with data it just received.
function _writeSavedBuildsRaw(builds) {
  try { localStorage.setItem(_SAVED_BUILDS_KEY, JSON.stringify(builds)); } catch (e) {}
}

// Writes the full builds array back to localStorage and queues an account sync.
function _setSavedBuilds(builds) {
  _writeSavedBuildsRaw(builds);
  try { localStorage.setItem(_SAVED_BUILDS_DIRTY_KEY, '1'); } catch (e) {}
  _scheduleBuildsSync();
}

// Escapes a string for safe insertion into innerHTML (prevents XSS from stored build names).
function _escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _savedBuildsQuery() {
  return (document.getElementById('saved-builds-search')?.value || '').trim().toLowerCase();
}

function _updateSavedBuildsCount(n) {
  const el = document.getElementById('saved-builds-count');
  if (!el) return;
  el.textContent = n + ' / ' + _MAX_SAVED_BUILDS;
  el.classList.toggle('full', n >= _MAX_SAVED_BUILDS);
}

function renderSavedBuilds() {
  const list = document.getElementById('saved-builds-list');
  if (!list) return;
  const allBuilds = _getSavedBuilds();
  _updateSavedBuildsCount(allBuilds.length);

  // Sort: favourites first, then by saved date descending
  const sorted = [...allBuilds].sort((a, b) => {
    if (!!b.fav !== !!a.fav) return b.fav ? 1 : -1;
    return b.ts - a.ts;
  });

  const q = _savedBuildsQuery();
  const filtered = q ? sorted.filter(b => (b.name || '').toLowerCase().includes(q) ||
    ((b.state && b.state.race) || '').toLowerCase().includes(q) ||
    ((b.state && b.state.cls)  || '').toLowerCase().includes(q) ||
    ((b.state && b.state.sup)  || '').toLowerCase().includes(q) ||
    ((b.state && b.state.sub)  || '').toLowerCase().includes(q)) : sorted;

  if (!allBuilds.length) {
    list.innerHTML = '<p class="saved-builds-empty">No saved builds yet. Click "Save Current Build" to save your current build.</p>';
    return;
  }
  if (!filtered.length) {
    list.innerHTML = '<p class="saved-builds-empty">No builds match your search.</p>';
    return;
  }

  list.innerHTML = filtered.map(b => {
    // Use stable id to look up real index in allBuilds
    const realIdx = allBuilds.findIndex(x => x.id === b.id);
    const date = new Date(b.ts).toLocaleDateString();
    const race = _escHtml((b.state && b.state.race) || '');
    const cls  = _escHtml([b.state&&b.state.cls, b.state&&b.state.sup, b.state&&b.state.sub].filter(Boolean).join(' / '));
    const lvl  = (b.state && b.state.lvl) || 1;
    const starClass = b.fav ? 'saved-build-star fav' : 'saved-build-star';
    const starTitle = b.fav ? 'Unfavourite' : 'Favourite';
    return `<div class="saved-build-card${b.fav ? ' is-fav' : ''}">
      <div class="saved-build-info">
        <div class="saved-build-name">${_escHtml(b.name || 'Untitled')}</div>
        <div class="saved-build-meta">Lvl ${lvl}${race ? ' &middot; ' + race : ''}${cls ? ' &middot; ' + cls : ''}</div>
        <div class="saved-build-date">${date}</div>
      </div>
      <div class="saved-build-actions">
        <button class="saved-build-load-btn" onclick="loadSavedBuild(${realIdx})">Load</button>
        <button class="saved-build-overwrite-btn" title="Overwrite this slot with your current build" onclick="overwriteSavedBuild(${realIdx})">Overwrite</button>
        <button class="saved-build-del-btn" onclick="deleteSavedBuild(${realIdx})">Delete</button>
        <button class="${starClass}" title="${starTitle}" onclick="toggleFavBuild(${realIdx})">&#9733;</button>
      </div>
    </div>`;
  }).join('');
}

function loadSavedBuild(index) {
  const builds = _getSavedBuilds();
  const b = builds[index];
  if (!b || !b.state) return;
  loadBuildState(b.state);
  const nameInput = document.getElementById('build-name-input');
  if (nameInput) nameInput.value = b.name || '';
  _switchBuilderTab('stats');
}

// Overwrites an existing slot with the current build state, keeping its id and favourite
// status. Uses the current name-input value if one is set, otherwise keeps the slot's name.
function overwriteSavedBuild(index) {
  const builds = _getSavedBuilds();
  const existing = builds[index];
  if (!existing) return;
  if (!confirm(`Overwrite "${existing.name || 'Untitled'}" with your current build?`)) return;
  const typedName = (document.getElementById('build-name-input')?.value.trim()) || '';
  builds[index] = {
    id: existing.id,
    name: typedName || existing.name || 'Untitled',
    ts: Date.now(),
    fav: !!existing.fav,
    state: getBuildState()
  };
  _setSavedBuilds(builds);
  renderSavedBuilds();
}

function deleteSavedBuild(index) {
  if (!confirm('Delete this saved build?')) return;
  const builds = _getSavedBuilds();
  builds.splice(index, 1);
  _setSavedBuilds(builds);
  renderSavedBuilds();
}

function toggleFavBuild(index) {
  const builds = _getSavedBuilds();
  if (!builds[index]) return;
  builds[index].fav = !builds[index].fav;
  _setSavedBuilds(builds);
  renderSavedBuilds();
}

(function () {
  const btn    = document.getElementById('save-current-btn');
  const search = document.getElementById('saved-builds-search');
  if (btn) {
    btn.addEventListener('click', () => {
      const builds = _getSavedBuilds();
      if (builds.length >= _MAX_SAVED_BUILDS) {
        btn.textContent = 'Limit reached — delete or overwrite a build';
        btn.classList.add('at-limit');
        setTimeout(() => { btn.textContent = 'Save Current Build'; btn.classList.remove('at-limit'); }, 2600);
        return;
      }
      const state = getBuildState();
      const name = (document.getElementById('build-name-input')?.value.trim()) || 'Untitled';
      builds.unshift({ id: Date.now(), name, ts: Date.now(), fav: false, state });
      _setSavedBuilds(builds);
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = 'Save Current Build'; }, 1500);
      renderSavedBuilds();
    });
  }
  if (search) {
    search.addEventListener('input', renderSavedBuilds);
  }
})();

// § SAVED BUILDS — ACCOUNT SYNC
// Mirrors the reconciliation in js/bank.js. The account's row in `player_builds`
// (supabase/builds.sql) is the cross-device source of truth; localStorage stays
// the working copy so the builder still functions logged out. The two reconcile
// last-writer-wins on `updated_at`.
//
//   meta.owner     which account the builds in this browser belong to
//   meta.syncedAt  the server timestamp this browser last agreed with
//   dirty flag     this browser holds edits the server has not seen
//
// Adoption has three distinct cases, and conflating them loses data:
//   first claim  — meta.owner unset. These builds are unclaimed, so they are
//                  MERGED into the account rather than overwritten. Logging in
//                  for the first time must never silently bin local work.
//   account swap — meta.owner set but different. These builds belong to someone
//                  else's account; merging would leak them across logins, so the
//                  new account's builds replace them outright.
//   steady state — same owner. Adopt the server copy only when it is newer, so a
//                  build deleted on one device does not come back from another.
var _SAVED_BUILDS_META_KEY  = 'alb:saved-builds-meta';
var _SAVED_BUILDS_DIRTY_KEY = 'alb:saved-builds-dirty';

var _buildsSyncTimer  = null;
var _buildsLastSynced = null; // JSON of the last successfully-uploaded array
var _buildsPulledUid  = null; // uid already reconciled with the server

function _getBuildsMeta() {
  try { return JSON.parse(localStorage.getItem(_SAVED_BUILDS_META_KEY)) || {}; }
  catch (e) { return {}; }
}

function _setBuildsMeta(meta) {
  try { localStorage.setItem(_SAVED_BUILDS_META_KEY, JSON.stringify(meta)); } catch (e) {}
}

// A build is only usable if it carries a state object to load.
function _isValidBuild(b) {
  return !!b && typeof b === 'object' && !!b.state && typeof b.state === 'object';
}

function _scheduleBuildsSync() {
  if (!(window._sbGetUserId && window._sbGetUserId())) return;
  clearTimeout(_buildsSyncTimer);
  _buildsSyncTimer = setTimeout(_buildsSync, 1200);
}

function _showBuildsNotice(msg) {
  const box = document.getElementById('saved-builds-notice');
  const txt = document.getElementById('saved-builds-notice-text');
  if (!box || !txt) return;
  txt.textContent = msg;
  box.style.display = '';
}

// Union by id, favourites first then newest, capped at _MAX_SAVED_BUILDS.
// Where the same id exists on both sides the later save wins.
function _mergeBuilds(localArr, serverArr) {
  const byId = new Map();
  serverArr.concat(localArr).forEach(b => {
    if (!_isValidBuild(b)) return;
    const id   = (b.id != null) ? b.id : (Date.now() + Math.random());
    const prev = byId.get(id);
    if (!prev || (b.ts || 0) > (prev.ts || 0)) {
      byId.set(id, Object.assign({}, b, { id: id }));
    }
  });
  const all = Array.from(byId.values()).sort((a, b) => {
    if (!!b.fav !== !!a.fav) return b.fav ? 1 : -1;
    return (b.ts || 0) - (a.ts || 0);
  });
  return {
    kept:    all.slice(0, _MAX_SAVED_BUILDS),
    dropped: Math.max(0, all.length - _MAX_SAVED_BUILDS)
  };
}

// Returns true when the server copy was adopted wholesale (nothing left to push).
async function _buildsPull(client, uid, mode) {
  const { data, error } = await client.from('player_builds')
    .select('builds, updated_at').eq('user_id', uid).maybeSingle();
  if (error) { console.warn('Saved builds pull failed:', error.message); return false; }

  const serverBuilds = (Array.isArray(data && data.builds) ? data.builds : []).filter(_isValidBuild);
  const meta = _getBuildsMeta();

  if (mode === 'merge') {
    const merged = _mergeBuilds(_getSavedBuilds(), serverBuilds);
    _writeSavedBuildsRaw(merged.kept);
    meta.owner = uid;
    delete meta.syncedAt;               // merged result differs from the server row
    _setBuildsMeta(meta);
    try { localStorage.setItem(_SAVED_BUILDS_DIRTY_KEY, '1'); } catch (e) {}
    if (merged.dropped) {
      _showBuildsNotice(merged.dropped + ' build' + (merged.dropped === 1 ? '' : 's') +
        ' from this device did not fit the ' + _MAX_SAVED_BUILDS +
        '-slot limit and were not kept. Favourites and your newest builds were kept first.');
    }
    renderSavedBuilds();
    return false;                       // caller still needs to push the merge
  }

  if (mode === 'replace') {
    _writeSavedBuildsRaw(serverBuilds.slice(0, _MAX_SAVED_BUILDS));
    meta.owner    = uid;
    meta.syncedAt = (data && data.updated_at) || null;
    _setBuildsMeta(meta);
    _buildsLastSynced = JSON.stringify(_getSavedBuilds());
    renderSavedBuilds();
    return true;
  }

  // Steady state: adopt only when the server row is newer than what this
  // browser last agreed with.
  if (!data) return false;
  if (meta.syncedAt && new Date(data.updated_at) <= new Date(meta.syncedAt)) return false;
  _writeSavedBuildsRaw(serverBuilds.slice(0, _MAX_SAVED_BUILDS));
  meta.owner    = uid;
  meta.syncedAt = data.updated_at;
  _setBuildsMeta(meta);
  _buildsLastSynced = JSON.stringify(_getSavedBuilds());
  renderSavedBuilds();
  return true;
}

async function _buildsSync() {
  const client = window._sbClient;
  const uid    = window._sbGetUserId && window._sbGetUserId();
  if (!client || !uid) return;

  try {
    const meta  = _getBuildsMeta();
    const dirty = !!localStorage.getItem(_SAVED_BUILDS_DIRTY_KEY);
    let   mode  = null;
    if (!meta.owner)          mode = 'merge';
    else if (meta.owner !== uid) mode = 'replace';

    // Pull first unless this browser holds unpushed edits, in which case the
    // push wins — except on first claim or account swap, which must reconcile.
    if (mode || _buildsPulledUid !== uid || !dirty) {
      const adopted = await _buildsPull(client, uid, mode || 'ifNewer');
      _buildsPulledUid = uid;
      if (adopted) { localStorage.removeItem(_SAVED_BUILDS_DIRTY_KEY); return; }
    }

    const builds  = _getSavedBuilds().filter(_isValidBuild).slice(0, _MAX_SAVED_BUILDS);
    const payload = JSON.stringify(builds);
    if (payload === _buildsLastSynced) { localStorage.removeItem(_SAVED_BUILDS_DIRTY_KEY); return; }

    const ts = new Date().toISOString();
    const { error } = await client.from('player_builds')
      .upsert({ user_id: uid, builds: builds, updated_at: ts });
    if (error) { console.warn('Saved builds sync failed:', error.message); return; }

    _buildsLastSynced = payload;
    const after = _getBuildsMeta();
    after.owner    = uid;
    after.syncedAt = ts;
    _setBuildsMeta(after);
    localStorage.removeItem(_SAVED_BUILDS_DIRTY_KEY);
  } catch (e) {
    console.warn('Saved builds sync failed:', (e && e.message) || e);
  }
}

(function () {
  const dismiss = document.getElementById('saved-builds-notice-dismiss');
  if (dismiss) {
    dismiss.addEventListener('click', () => {
      const box = document.getElementById('saved-builds-notice');
      if (box) box.style.display = 'none';
    });
  }

  // Another tab edited the builds — re-render and push.
  window.addEventListener('storage', e => {
    if (e.key !== _SAVED_BUILDS_KEY) return;
    renderSavedBuilds();
    _scheduleBuildsSync();
  });

  // Sync whenever auth settles (session restore, login, account switch), plus a
  // fallback in case the auth event fired before this script loaded.
  window.addEventListener('alb-auth-changed', _scheduleBuildsSync);
  setTimeout(_scheduleBuildsSync, 4000);
})();
