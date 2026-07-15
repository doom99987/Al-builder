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

// Writes the full builds array back to localStorage.
function _setSavedBuilds(builds) {
  try { localStorage.setItem(_SAVED_BUILDS_KEY, JSON.stringify(builds)); } catch (e) {}
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
