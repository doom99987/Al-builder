// =============================================================================
// AL BUILDER — reports.js
// Player reporting system. Click any avatar/orb -> profile popup (full username +
// Report button). A report (cheating | misconduct) is stored in `reports` and pings
// every admin via the notification bell. Admins get a red marker + a Reports tab in
// the admin panel, where cheating-in-a-match reports can show the match's scores.
// Backed by supabase/reports.sql.
// =============================================================================
(function () {
  'use strict';

  const sb = () => window._sbClient;
  const uid = () => (window._sbGetUserId && window._sbGetUserId()) || null;
  const uname = () => (window._sbGetUsername && window._sbGetUsername()) || null;
  const isAdmin = () => !!(window._sbIsAdmin && window._sbIsAdmin());
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function avatarHtml(name, url, size) { return window._sbAvatar ? window._sbAvatar(name, url, size) : `<div class="report-av-fallback">${esc((name||'?').charAt(0))}</div>`; }

  function timeAgo(ts) {
    const d = (Date.now() - new Date(ts).getTime()) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    return Math.floor(d / 86400) + 'd ago';
  }

  function toast(msg) {
    let t = document.getElementById('report-toast');
    if (!t) { t = document.createElement('div'); t.id = 'report-toast'; t.className = 'report-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ── Profile + report popup ──────────────────────────────────────────────────
  function removeModal() { document.getElementById('report-modal-overlay')?.remove(); }

  window._openUserProfile = async function (opts) {
    opts = opts || {};
    let { userId, username, avatarUrl, matchId } = opts;
    const client = sb();
    if (!client) return;
    // Resolve whatever is missing from the profiles table.
    try {
      if (!userId && username) {
        const { data } = await client.from('profiles').select('id, username, avatar_url').eq('username', username).maybeSingle();
        if (data) { userId = data.id; username = data.username; if (avatarUrl == null) avatarUrl = data.avatar_url; }
      } else if (userId && (avatarUrl == null || !username)) {
        const { data } = await client.from('profiles').select('username, avatar_url').eq('id', userId).maybeSingle();
        if (data) { username = username || data.username; if (avatarUrl == null) avatarUrl = data.avatar_url; }
      }
    } catch (_) {}
    renderProfileModal({ userId, username: username || 'Unknown', avatarUrl, matchId });
  };

  function renderProfileModal(p) {
    removeModal();
    const meId = uid();
    const isSelf = p.userId && meId && p.userId === meId;
    const isBot = !p.userId || p.userId === '__bot__';
    const canReport = !!meId && !isSelf && !isBot;

    const o = document.createElement('div');
    o.id = 'report-modal-overlay';
    o.className = 'report-modal-overlay';
    o.innerHTML = `<div class="report-modal">
      <button class="report-close" id="report-close">&times;</button>
      <div class="report-profile">
        ${avatarHtml(p.username, p.avatarUrl, 72)}
        <div class="report-username">${esc(p.username)}</div>
      </div>
      ${!isBot ? `<button class="report-bank-btn" id="report-bank-btn">&#127974; View Bank</button>` : ''}
      ${canReport
        ? `<button class="report-open-btn" id="report-open-btn">&#9873; Report Player</button>`
        : (isSelf ? '' : `<div class="report-note">${meId ? 'This player cannot be reported.' : 'Log in to report.'}</div>`)}
      <div class="report-form" id="report-form" style="display:none">
        <div class="report-form-label">Why are you reporting ${esc(p.username)}?</div>
        <div class="report-reasons">
          <button class="report-reason" data-reason="cheating">&#9888; Cheating</button>
          <button class="report-reason" data-reason="misconduct">&#128683; Misconduct</button>
        </div>
        <div class="report-subreasons" id="report-subreasons" style="display:none">
          <div class="report-form-label report-sub-label">What kind of misconduct?</div>
          <div class="report-reasons report-subreasons-row">
            <button class="report-subreason" data-sub="Inappropriate name or image">Name / image</button>
            <button class="report-subreason" data-sub="Inappropriate chat">Chat</button>
            <button class="report-subreason" data-sub="Other misconduct">Other</button>
          </div>
        </div>
        <textarea id="report-detail" class="report-detail" maxlength="300" placeholder="Optional: add details (max 300 chars)…"></textarea>
        <div class="report-actions">
          <button class="report-cancel" id="report-cancel">Cancel</button>
          <button class="report-submit" id="report-submit" disabled>Submit Report</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(o);
    o.addEventListener('mousedown', e => { if (e.target === o) removeModal(); });
    document.getElementById('report-close').onclick = removeModal;

    const openBtn = document.getElementById('report-open-btn');
    if (openBtn) openBtn.onclick = () => { document.getElementById('report-form').style.display = 'block'; openBtn.style.display = 'none'; };

    const bankBtn = document.getElementById('report-bank-btn');
    if (bankBtn) bankBtn.onclick = () => { removeModal(); window._bankViewUser?.(p.userId, p.username); };

    let reason = null, subReason = null;
    const subBox = document.getElementById('report-subreasons');
    const submitBtn = document.getElementById('report-submit');
    // Submit is enabled once a reason is picked — and, for misconduct, a sub-reason too.
    const refreshSubmit = () => { if (submitBtn) submitBtn.disabled = !reason || (reason === 'misconduct' && !subReason); };

    o.querySelectorAll('.report-reason').forEach(b => b.onclick = () => {
      reason = b.dataset.reason;
      o.querySelectorAll('.report-reason').forEach(x => x.classList.toggle('active', x === b));
      if (reason === 'misconduct') { if (subBox) subBox.style.display = 'block'; }
      else { if (subBox) subBox.style.display = 'none'; subReason = null; o.querySelectorAll('.report-subreason').forEach(x => x.classList.remove('active')); }
      refreshSubmit();
    });
    o.querySelectorAll('.report-subreason').forEach(b => b.onclick = () => {
      subReason = b.dataset.sub;
      o.querySelectorAll('.report-subreason').forEach(x => x.classList.toggle('active', x === b));
      refreshSubmit();
    });

    const cancel = document.getElementById('report-cancel');
    if (cancel) cancel.onclick = removeModal;
    const submit = submitBtn;
    if (submit) submit.onclick = async () => {
      if (!reason || (reason === 'misconduct' && !subReason)) return;
      submit.disabled = true; submit.textContent = 'Submitting…';
      const note = (document.getElementById('report-detail').value || '').trim();
      // Fold the misconduct sub-reason into the stored detail.
      const detail = [subReason, note].filter(Boolean).join(' — ');
      const ok = await submitReport(p.userId, p.username, reason, detail, p.matchId);
      removeModal();
      toast(ok ? 'Report submitted — thank you.' : 'Could not submit report.');
    };
  }

  async function submitReport(reportedId, reportedName, reason, detail, matchId) {
    const client = sb(); const meId = uid();
    if (!client || !meId || !reportedId) return false;
    try {
      const { error } = await client.from('reports').insert({
        reporter_id: meId, reporter_name: uname(),
        reported_id: reportedId, reported_name: reportedName,
        reason, detail: detail || null, match_id: matchId || null
      });
      if (error) throw error;
      window._sbNotifyAdmins?.(
        `New report: ${uname() || 'Someone'} reported ${reportedName || 'a player'}`,
        `${reason}${detail ? ' — ' + detail : ''}`,
        { type: 'report', reported_id: reportedId, reason }
      );
      return true;
    } catch (_) { return false; }
  }

  // ── Admin: badges (red marker / counts) ─────────────────────────────────────
  let openCount = 0, reportsSub = null;

  window._reportsSyncBadges = function () {
    const show = openCount > 0;
    const dot = document.getElementById('sb-admin-report-dot');
    if (dot) dot.style.display = show ? 'block' : 'none';
    ['sb-menu-report-badge', 'sb-admin-reports-badge'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = openCount > 9 ? '9+' : String(openCount); el.style.display = show ? 'inline-flex' : 'none'; }
    });
  };

  async function refreshOpenCount() {
    const client = sb(); if (!client || !isAdmin()) return;
    try {
      const { count } = await client.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open');
      openCount = count || 0;
      window._reportsSyncBadges();
    } catch (_) {}
  }

  function subscribeReports() {
    const client = sb(); if (!client || !isAdmin() || reportsSub) return;
    reportsSub = client.channel('alb-reports-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, () => {
        refreshOpenCount();
        if (document.querySelector('.sb-admin-panel[data-panel="reports"]')?.style.display === 'block') window._reportsLoadAdmin();
      })
      .subscribe();
  }

  // ── Admin: Reports tab content ──────────────────────────────────────────────
  let _reportsData = [];
  let _reportsQuery = '';

  window._reportsLoadAdmin = async function () {
    const list = document.getElementById('sb-admin-reports-list');
    if (!list) return;
    const client = sb(); if (!client) return;
    list.innerHTML = '<div class="sb-admin-empty">Loading…</div>';
    try {
      const res = await client.from('reports').select('*').order('created_at', { ascending: false }).limit(200);
      if (res.error) throw res.error;
      _reportsData = res.data || [];
    } catch (_) { list.innerHTML = '<div class="sb-admin-empty">Failed to load reports.</div>'; return; }
    _reportsData.sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1));
    const input = document.getElementById('sb-reports-search');
    _reportsQuery = input ? (input.value || '').trim().toLowerCase() : _reportsQuery;
    renderReports();
  };

  // Live username filter (reported or reporter).
  window._reportsFilter = function (q) { _reportsQuery = (q || '').trim().toLowerCase(); renderReports(); };

  function filtered() {
    if (!_reportsQuery) return _reportsData;
    return _reportsData.filter(r =>
      (r.reported_name || '').toLowerCase().includes(_reportsQuery) ||
      (r.reporter_name || '').toLowerCase().includes(_reportsQuery));
  }

  function renderReports() {
    const list = document.getElementById('sb-admin-reports-list');
    if (!list) return;
    const data = filtered();
    if (!data.length) {
      list.innerHTML = `<div class="sb-admin-empty">${_reportsData.length ? 'No matching reports.' : 'No reports yet.'}</div>`;
      return;
    }
    list.innerHTML = data.map(rowHtml).join('');
    list.querySelectorAll('[data-act]').forEach(btn => btn.onclick = () => handleAction(btn));
    list.querySelectorAll('[data-scores]').forEach(btn => btn.onclick = () => showScores(btn));
  }

  // Clear (delete) every report currently shown — respects the active filter.
  window._reportsClearAll = async function () {
    const client = sb(); if (!client || !isAdmin()) return;
    const data = filtered();
    if (!data.length) return;
    if (!window.confirm(`Delete ${data.length} report(s)? This cannot be undone.`)) return;
    try { await client.from('reports').delete().in('id', data.map(r => r.id)); } catch (_) {}
    await refreshOpenCount();
    window._reportsLoadAdmin();
  };

  function rowHtml(r) {
    const reasonCls = r.reason === 'cheating' ? 'rep-cheat' : 'rep-misc';
    const scoresBtn = (r.reason === 'cheating' && r.match_id)
      ? `<button class="rep-btn rep-scores-btn" data-scores="${esc(r.match_id)}" data-row="${esc(r.id)}">View match scores</button>` : '';
    const actions = r.status === 'open'
      ? `<button class="rep-btn rep-review" data-act="reviewed" data-id="${esc(r.id)}">Mark reviewed</button>
         <button class="rep-btn rep-dismiss" data-act="dismissed" data-id="${esc(r.id)}">Dismiss</button>` : '';
    const clearBtn = `<button class="rep-btn rep-clear" data-act="delete" data-id="${esc(r.id)}">Clear</button>`;
    return `<div class="rep-card ${r.status === 'open' ? 'rep-open' : ''}">
      <div class="rep-head">
        <span class="rep-reason ${reasonCls}">${esc(r.reason)}</span>
        <span class="rep-status rep-status-${esc(r.status)}">${esc(r.status)}</span>
        <span class="rep-time">${timeAgo(r.created_at)}</span>
      </div>
      <div class="rep-who"><b>${esc(r.reporter_name || '?')}</b> reported <b>${esc(r.reported_name || '?')}</b></div>
      ${r.detail ? `<div class="rep-detail">${esc(r.detail)}</div>` : ''}
      <div class="rep-actions">${scoresBtn}${actions}${clearBtn}</div>
      <div class="rep-scores" id="rep-scores-${esc(r.id)}" style="display:none"></div>
    </div>`;
  }

  async function handleAction(btn) {
    const id = btn.dataset.id, act = btn.dataset.act;
    const client = sb(); if (!client) return;
    btn.disabled = true;
    try {
      if (act === 'delete') {
        await client.from('reports').delete().eq('id', id);
      } else {
        await client.from('reports').update({ status: act, reviewed_at: new Date().toISOString() }).eq('id', id);
      }
      await refreshOpenCount();
      window._reportsLoadAdmin();
    } catch (_) { btn.disabled = false; }
  }

  async function showScores(btn) {
    const matchId = btn.dataset.scores, rowId = btn.dataset.row;
    const wrap = document.getElementById('rep-scores-' + rowId);
    if (!wrap) return;
    if (wrap.dataset.loaded) { wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none'; return; }
    const client = sb();
    let m;
    try {
      const { data } = await client.from('mm_matches')
        .select('p1_name,p2_name,p1_id,p2_id,rounds,winner_id,mode,qte').eq('id', matchId).maybeSingle();
      m = data;
    } catch (_) {}
    wrap.innerHTML = m ? matchScoresHtml(m) : '<div class="rep-noscores">Match not found.</div>';
    wrap.dataset.loaded = '1'; wrap.style.display = 'block';
  }

  function matchScoresHtml(m) {
    const rounds = Array.isArray(m.rounds) ? m.rounds : [];
    if (!rounds.length) return '<div class="rep-noscores">No round scores recorded for this match.</div>';
    const body = rounds.map(r => {
      const p1w = r.w === m.p1_id, p2w = r.w === m.p2_id;
      return `<tr><td>R${esc(r.r)}</td><td class="${p1w ? 'rep-w' : ''}">${esc(r.p1)}</td><td class="${p2w ? 'rep-w' : ''}">${esc(r.p2)}</td></tr>`;
    }).join('');
    return `<table class="rep-score-table">
      <thead><tr><th></th><th>${esc(m.p1_name || 'P1')}</th><th>${esc(m.p2_name || 'P2')}</th></tr></thead>
      <tbody>${body}</tbody>
    </table><div class="rep-score-meta">${esc(m.mode)} &middot; ${esc(m.qte)}</div>`;
  }

  // ── Init: keep admin badges live ────────────────────────────────────────────
  (function init() {
    const client = sb();
    if (!client || !client.auth || !client.auth.onAuthStateChange) { setTimeout(init, 500); return; }
    const sync = () => { if (isAdmin()) { refreshOpenCount(); subscribeReports(); } else { openCount = 0; window._reportsSyncBadges(); } };
    setTimeout(sync, 800);
    client.auth.onAuthStateChange(() => setTimeout(sync, 300));
  })();
})();
