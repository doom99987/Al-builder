// ============================================================
//  AL Builder — LF Party System
//  Tables needed in Supabase:
//    party_listings  (id uuid pk, host_id uuid, host_name text, host_avatar text,
//                     host_class text, boss text, party_size int, status text default 'open',
//                     created_at timestamptz default now())
//    party_members   (id uuid pk, party_id uuid fk→party_listings, user_id uuid,
//                     username text, avatar_url text, user_class text,
//                     joined_at timestamptz default now(),
//                     unique(party_id, user_id))
//    party_messages  (id uuid pk, party_id uuid fk→party_listings, sender_id uuid,
//                     sender_name text, sender_avatar text, content text,
//                     created_at timestamptz default now())
//  Profiles columns to add:
//    party_class   text
//    attached_build jsonb
// ============================================================
(function () {
  'use strict';

  const SUPABASE_URL      = 'https://mpqohagljmvwftwqumnh.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wcW9oYWdsam12d2Z0d3F1bW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMzg1NzEsImV4cCI6MjA5MzYxNDU3MX0.WfU88Ell1Q6jCcef2YiohxIeTHBNfruIxYWoa1QRCUc';

  if (!window._sbClient && !window.supabase) { console.warn('party.js: Supabase not loaded'); return; }
  const sb = window._sbClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'implicit' } });

  // ── helpers ───────────────────────────────────────────────
  const esc    = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const uid    = () => window._sbGetUserId?.()  ?? null;
  const uname  = () => window._sbGetUsername?.() ?? null;
  const authed = () => !!uid();

  function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60)    return 'just now';
    if (s < 3600)  return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function mkAvatar(name, url, size) {
    if (url) return `<img src="${esc(url)}" alt="" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;">`;
    const initials = (name || '?').slice(0, 2).toUpperCase();
    const hue = [...(name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xFFFFFF, 0) % 360;
    return `<div style="width:${size}px;height:${size}px;background:hsl(${hue},55%,30%);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${Math.floor(size*0.38)}px;font-weight:700;color:#fff;flex-shrink:0;">${initials}</div>`;
  }

  // Basic profanity guard — reuse trades.js filter if available
  function cleanMsg(text) {
    const t = text.trim();
    if (!t) return null;
    if (window._containsProfanity && window._containsProfanity(t)) return null;
    return t;
  }

  // ── data ──────────────────────────────────────────────────
  const BOSSES = [
    "Yar'Thul, The Blazing Dragon",
    "Thorian, The Rotten",
    "Seraphon",
    "Arkhaia",
    "Metrom's Vessel",
    "Pterathanaian",
    "Handaconda"
  ];

  // Only superclasses are selectable
  const ALL_CLASSES = [
    '─ Order ─',
    'Ranger (Or)', 'Paladin (Or)', 'Elementalist (Or)', 'Monk (Or)', 'Saint (Or)', 'Citadel (Or)',
    '─ Neutral ─',
    'Rogue (N)', 'Blade Dancer (N)', 'Hexer (N)', 'Brawler (N)', 'Lancer (N)', 'Arbiter (N)', 'Lionheart (N)',
    '─ Chaotic ─',
    'Assassin (Ch)', 'Berserker (Ch)', 'Necromancer (Ch)', 'Darkwraith (Ch)', 'Impaler (Ch)'
  ];
  const IS_DIVIDER = c => c.startsWith('─');

  // ── state ─────────────────────────────────────────────────
  let _allParties     = [];
  let _myPartyData    = null;   // full listing row for the party the user is in
  let _myPartyId      = null;   // party the current user is a member of
  let _currentPartyId = null;   // party panel currently open
  let _chatSub        = null;   // realtime channel
  let _myClass        = '';
  let _attachedBuild  = null;
  let _selectedSize   = 4;
  let _profileCache   = {};     // userId → profile data

  // ── profile helpers ───────────────────────────────────────
  async function getMyProfile() {
    if (!authed()) return {};
    if (_profileCache[uid()]) return _profileCache[uid()];
    const { data } = await sb.from('profiles').select('username, avatar_url').eq('id', uid()).maybeSingle();
    _profileCache[uid()] = data || {};
    return _profileCache[uid()];
  }

  async function loadMyPartyProfile() {
    if (!authed()) return;
    const { data } = await sb.from('profiles').select('party_class, attached_build').eq('id', uid()).maybeSingle();
    if (data) {
      _myClass       = data.party_class || '';
      _attachedBuild = data.attached_build || null;
    }
    _updateHeaderBtns();
  }

  function _updateHeaderBtns() {
    const cb = document.getElementById('party-my-class-btn');
    if (cb) cb.textContent = _myClass ? `🎭 ${_myClass}` : '🎭 Set Class';
    const ab = document.getElementById('party-attach-build-btn');
    if (ab) ab.textContent = _attachedBuild ? `📋 ${_attachedBuild.name || 'Build attached'}` : '📋 Attach Build';
  }

  // ── Set Class modal ───────────────────────────────────────
  const SUPER_CLASSES = ALL_CLASSES.filter(c => !IS_DIVIDER(c));

  function openSetClass() {
    if (!authed()) { window._openAuthModal?.('login'); return; }
    _removeModal('party-set-class-modal');
    const d = document.createElement('div');
    d.id = 'party-set-class-modal';
    d.className = 'party-modal-overlay';
    d.innerHTML = `<div class="party-modal">
      <div class="party-modal-title">Set My Class</div>
      <label class="party-modal-label">Class shown on party listings</label>
      <input id="psc-search" class="party-modal-select" type="text" placeholder="Search classes…" autocomplete="off"
        value="${esc(_myClass)}" style="margin-bottom:6px">
      <div id="psc-list" class="party-class-list"></div>
      <div class="party-modal-btns" style="margin-top:10px">
        <button class="party-modal-cancel" onclick="window._partyCloseModal('party-set-class-modal')">Cancel</button>
        <button class="party-modal-submit" onclick="window._partySaveClass()">Save</button>
      </div>
    </div>`;
    document.body.appendChild(d);

    const input = document.getElementById('psc-search');
    const list  = document.getElementById('psc-list');
    let _selected = _myClass;

    function renderList(q) {
      const filtered = q ? SUPER_CLASSES.filter(c => c.toLowerCase().includes(q.toLowerCase())) : SUPER_CLASSES;
      list.innerHTML = filtered.length
        ? filtered.map(c => `<div class="party-class-item${c === _selected ? ' selected' : ''}" data-val="${esc(c)}">${esc(c)}</div>`).join('')
        : `<div style="color:#666;font-size:13px;padding:6px 0">No matches.</div>`;
      list.querySelectorAll('.party-class-item').forEach(el => {
        el.addEventListener('click', () => {
          _selected = el.dataset.val;
          input.value = _selected;
          list.querySelectorAll('.party-class-item').forEach(x => x.classList.toggle('selected', x === el));
        });
      });
    }

    input.addEventListener('input', () => renderList(input.value));
    input.addEventListener('focus', () => { input.select(); });
    // Store selected for saveClass to read
    d._getSelected = () => _selected === _myClass && input.value === '' ? '' : (input.value || _selected);
    renderList('');
    input.focus();
  }

  async function saveClass() {
    const modal = document.getElementById('party-set-class-modal');
    const input = document.getElementById('psc-search');
    const v = (input?.value?.trim() && SUPER_CLASSES.includes(input.value.trim())) ? input.value.trim() : '';
    const { error } = await sb.from('profiles').update({ party_class: v || null }).eq('id', uid());
    if (error) { alert('Save failed: ' + error.message); return; }
    _myClass = v;
    _updateHeaderBtns();
    _removeModal('party-set-class-modal');
  }

  // ── Attach Build modal ────────────────────────────────────
  function openAttachBuild() {
    if (!authed()) { window._openAuthModal?.('login'); return; }
    const builds = (typeof _getSavedBuilds === 'function') ? _getSavedBuilds() : [];
    _removeModal('party-attach-build-modal');
    const d = document.createElement('div');
    d.id = 'party-attach-build-modal';
    d.className = 'party-modal-overlay';
    d.innerHTML = `<div class="party-modal">
      <div class="party-modal-title">Attach Build to Profile</div>
      ${builds.length ? `
        <label class="party-modal-label">Choose a saved build to display on your profile</label>
        <select class="party-modal-select" id="pab-select">
          <option value="">— None (detach) —</option>
          ${builds.map((b, i) => {
            const label = (b.name || 'Unnamed') + (b.state?.cls ? ' · ' + b.state.cls : '') + (b.state?.sup ? ' / ' + b.state.sup : '');
            return `<option value="${i}">${esc(label)}</option>`;
          }).join('')}
        </select>
      ` : `<p style="color:#777;font-size:13px;margin:0 0 14px">No saved builds found. Save a build in the Builder tab first.</p>`}
      <div class="party-modal-btns">
        <button class="party-modal-cancel" onclick="window._partyCloseModal('party-attach-build-modal')">Cancel</button>
        ${builds.length ? `<button class="party-modal-submit" onclick="window._partySaveBuild()">Attach</button>` : ''}
      </div>
    </div>`;
    document.body.appendChild(d);
  }

  async function saveBuild() {
    const sel = document.getElementById('pab-select');
    let payload = null;
    if (sel?.value !== '' && sel?.value !== undefined) {
      const builds = (typeof _getSavedBuilds === 'function') ? _getSavedBuilds() : [];
      const b = builds[parseInt(sel.value)];
      if (b) payload = { name: b.name || 'Unnamed', state: b.state || {} };
    }
    const { error } = await sb.from('profiles').update({ attached_build: payload }).eq('id', uid());
    if (error) { alert('Save failed: ' + error.message); return; }
    _attachedBuild = payload;
    _updateHeaderBtns();
    _removeModal('party-attach-build-modal');
  }

  // ── Host modal ────────────────────────────────────────────
  let _selectedBoss = '';

  function openHost() {
    if (!authed()) { window._openAuthModal?.('login'); return; }
    _removeModal('party-host-modal');
    _selectedSize = 4;
    _selectedBoss = '';
    const d = document.createElement('div');
    d.id = 'party-host-modal';
    d.className = 'party-modal-overlay';
    d.innerHTML = `<div class="party-modal">
      <div class="party-modal-title">Host a Party</div>
      <label class="party-modal-label">Boss</label>
      <div class="party-boss-list" id="phm-boss-list">
        ${BOSSES.map(b => `<div class="party-boss-item" data-val="${esc(b)}">${esc(b)}</div>`).join('')}
      </div>
      <label class="party-modal-label" style="margin-top:12px">Party size</label>
      <div class="party-modal-size-row" id="party-size-btns">
        ${[2,3,4,5].map(n => `<button class="party-size-btn${n===_selectedSize?' selected':''}" onclick="window._partySelectSize(${n})">${n}</button>`).join('')}
      </div>
      <div class="party-modal-btns">
        <button class="party-modal-cancel" onclick="window._partyCloseModal('party-host-modal')">Cancel</button>
        <button class="party-modal-submit" onclick="window._partySubmitHost()">Host</button>
      </div>
    </div>`;
    document.body.appendChild(d);

    d.querySelectorAll('.party-boss-item').forEach(el => {
      el.addEventListener('click', () => {
        _selectedBoss = el.dataset.val;
        d.querySelectorAll('.party-boss-item').forEach(x => x.classList.toggle('selected', x === el));
      });
    });
  }

  function selectSize(n) {
    _selectedSize = n;
    document.querySelectorAll('#party-size-btns .party-size-btn').forEach((btn, i) => {
      btn.classList.toggle('selected', [2,3,4,5][i] === n);
    });
  }

  async function submitHost() {
    const boss = _selectedBoss;
    if (!boss) { alert('Please select a boss.'); return; }
    if (_myPartyId) { alert('You are already in a party. Leave it first.'); return; }
    // Server-side guard: check for any existing active party hosted by this user
    const { data: existing } = await sb.from('party_listings')
      .select('id').eq('host_id', uid()).in('status', ['open', 'full']).maybeSingle();
    if (existing) {
      if (confirm('You already have an active party.\n\nClose it now and create a new one?')) {
        await sb.from('party_listings').update({ status: 'closed' }).eq('id', existing.id);
        await sb.from('party_members').delete().eq('party_id', existing.id);
        _myPartyId = null;
        _myPartyData = null;
      } else {
        return;
      }
    }
    const profile = await getMyProfile();
    try {
      const { data: party, error } = await sb.from('party_listings').insert({
        host_id:    uid(),
        host_name:  profile.username || 'Unknown',
        host_avatar: profile.avatar_url || null,
        host_class: _myClass || null,
        boss,
        party_size: _selectedSize,
        status:     'open'
      }).select().single();
      if (error) throw error;

      const { error: memErr } = await sb.from('party_members').insert({
        party_id:   party.id,
        user_id:    uid(),
        username:   profile.username || 'Unknown',
        avatar_url: profile.avatar_url || null,
        user_class: _myClass || null
      });
      if (memErr) throw memErr;

      _myPartyId = party.id;
      _removeModal('party-host-modal');
      await loadParties();
      openPartyPanel(party.id);
    } catch (e) {
      alert('Failed to create party: ' + e.message);
    }
  }

  // ── Load & render parties ─────────────────────────────────
  async function loadParties() {
    const el = document.getElementById('party-list');
    if (!el) return;

    if (authed()) {
      const { data: mem } = await sb.from('party_members').select('party_id').eq('user_id', uid()).maybeSingle();
      _myPartyId = mem?.party_id || null;

      // Fallback: user may be the host but missing from party_members
      if (!_myPartyId) {
        const { data: hosted } = await sb.from('party_listings')
          .select('id').eq('host_id', uid()).in('status', ['open', 'full']).maybeSingle();
        if (hosted) _myPartyId = hosted.id;
      }
    }

    try {
      // Fetch user's own party (any non-closed status)
      _myPartyData = null;
      if (_myPartyId) {
        const { data: mp } = await sb
          .from('party_listings')
          .select('*, party_members(count)')
          .eq('id', _myPartyId)
          .neq('status', 'closed')
          .maybeSingle();
        _myPartyData = mp || null;
      }

      // Fetch public open parties, excluding user's own
      const query = sb
        .from('party_listings')
        .select('*, party_members(count)')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(60);
      const { data, error } = await query;
      if (error) throw error;
      _allParties = (data || []).filter(p => p.id !== _myPartyId);
      renderParties();
    } catch (e) {
      el.innerHTML = `<div class="party-state">Could not load parties.<br>
        <small style="color:#555">Make sure the <code>party_listings</code>, <code>party_members</code>, and <code>party_messages</code> tables exist in Supabase.</small></div>`;
    }
  }

  function _slotsHtml(memberCount, partySize) {
    return Array.from({ length: partySize }, (_, i) =>
      `<div class="party-slot${i < memberCount ? ' filled' : ''}"></div>`
    ).join('');
  }

  // Full-width banner for the user's own party
  function _buildMyPartyBanner(p, myId) {
    const memberCount = p.party_members?.[0]?.count ?? 1;
    const isFull  = memberCount >= p.party_size;
    const isMine  = p.host_id === myId;
    const closeOrLeave = isMine
      ? `<button class="party-close-btn" onclick="window._partyCloseFromCard('${esc(p.id)}')">Close Party</button>`
      : `<button class="party-close-btn" onclick="window._partyLeaveFromCard('${esc(p.id)}')">Leave Party</button>`;

    return `<div class="party-banner">
      <div class="party-banner-boss">${esc(p.boss)}</div>
      <div class="party-banner-row">
        <div class="party-banner-host">
          ${mkAvatar(p.host_name, p.host_avatar, 26)}
          <div>
            <span class="party-banner-host-name">${esc(p.host_name)}</span>
            ${p.host_class ? `<span class="party-banner-host-class">${esc(p.host_class)}</span>` : ''}
          </div>
        </div>
        <div class="party-banner-slots">
          <div class="party-slots-bar">${_slotsHtml(memberCount, p.party_size)}</div>
          <span class="party-slots-label">${memberCount}/${p.party_size} · ${isFull ? 'Full' : 'Open'}</span>
        </div>
      </div>
      <div class="party-banner-actions">
        <button class="party-open-btn party-open-btn--wide" onclick="window._partyOpenPanel('${esc(p.id)}')">Open Chat</button>
        ${closeOrLeave}
      </div>
    </div>`;
  }

  // Grid card for public listings
  function _buildPartyCard(p, myId) {
    const memberCount = p.party_members?.[0]?.count ?? 1;
    const isFull  = memberCount >= p.party_size;
    let actionBtn;
    if (_myPartyId) {
      actionBtn = `<button class="party-join-btn" disabled>Leave your party first</button>`;
    } else {
      actionBtn = `<button class="party-join-btn${isFull ? ' party-join-btn--full' : ''}"
        onclick="window._partyJoin('${esc(p.id)}')" ${isFull ? 'disabled' : ''}>
        ${isFull ? 'Full' : 'Request to Join'}</button>`;
    }

    return `<div class="party-card">
      <div class="party-card-boss-name">${esc(p.boss)}</div>
      <div class="party-card-host-row">
        ${mkAvatar(p.host_name, p.host_avatar, 28)}
        <div class="party-card-meta">
          <span class="party-card-uname">${esc(p.host_name)}</span>
          ${p.host_class ? `<span class="party-card-class">${esc(p.host_class)}</span>` : ''}
        </div>
      </div>
      <div class="party-card-slots">
        <div class="party-slots-bar">${_slotsHtml(memberCount, p.party_size)}</div>
        <span class="party-slots-label">${memberCount}/${p.party_size}</span>
      </div>
      <div class="party-card-actions">
        ${actionBtn}
        <button class="party-profile-btn" onclick="window._partyViewProfile('${esc(p.host_id)}','${esc(p.host_name)}')">Profile</button>
      </div>
      <div class="party-card-age">${timeAgo(p.created_at)}</div>
    </div>`;
  }

  function renderParties() {
    const el = document.getElementById('party-list');
    if (!el) return;
    const myId = uid();
    let html = '';

    // ── Your Party banner ───────────────────────────────────
    if (_myPartyData) {
      html += `<div class="party-section-hdr">Your Party</div>
        ${_buildMyPartyBanner(_myPartyData, myId)}
        <div class="party-section-hdr party-section-hdr-public">Open Parties</div>`;
    }

    // ── Public listings ─────────────────────────────────────
    if (_allParties.length) {
      html += `<div class="party-grid">${_allParties.map(p => _buildPartyCard(p, myId)).join('')}</div>`;
    } else {
      html += `<div class="party-state">${_myPartyData ? 'No other open parties.' : 'No open parties. Be the first to host!'}</div>`;
    }

    el.innerHTML = html;
  }

  // ── Request to join ───────────────────────────────────────
  async function joinParty(partyId) {
    if (!authed()) { window._openAuthModal?.('login'); return; }
    if (_myPartyId) { alert('You are already in a party. Leave it first.'); return; }
    const party = _allParties.find(p => p.id === partyId);
    if (!party) return;
    const currentCount = party?.party_members?.[0]?.count ?? 1;
    if (currentCount >= party.party_size) { alert('Party is full.'); return; }

    const profile = await getMyProfile();
    const { data: prof2 } = await sb.from('profiles').select('party_class, attached_build').eq('id', uid()).maybeSingle();
    const myClass = prof2?.party_class || _myClass || null;
    const myBuild = prof2?.attached_build || null;

    try {
      // Insert join request (unique constraint prevents duplicates)
      const { data: req, error: reqErr } = await sb.from('party_requests').insert({
        party_id:        partyId,
        host_id:         party.host_id,
        requester_id:    uid(),
        requester_name:  profile.username || 'Unknown',
        requester_avatar: profile.avatar_url || null,
        requester_class: myClass,
        requester_build: myBuild,
        status:          'pending'
      }).select().single();
      if (reqErr) throw reqErr;

      // Notify the host via the notifications table
      await sb.from('notifications').insert({
        user_id: party.host_id,
        title:   `${profile.username || 'Someone'} wants to join your party`,
        body:    myClass ? `Class: ${myClass}` : 'No class set',
        meta: {
          type:            'party_join',
          request_id:      req.id,
          party_id:        partyId,
          requester_id:    uid(),
          requester_name:  profile.username || 'Unknown',
          requester_class: myClass,
          requester_build: myBuild
        }
      });

      alert('Request sent! Waiting for the host to accept.');
    } catch (e) {
      if (e.message?.includes('unique')) { alert('You already sent a request to this party.'); return; }
      alert('Failed to send request: ' + e.message);
    }
  }

  // ── Accept / Reject request ───────────────────────────────
  async function acceptRequest(requestId) {
    const { data: req, error } = await sb.from('party_requests').select('*').eq('id', requestId).maybeSingle();
    if (error || !req) { alert('Request not found.'); return; }
    if (req.status !== 'pending') { alert('This request has already been handled.'); _refreshNotifUI(); return; }

    const { data: party } = await sb.from('party_listings')
      .select('*, party_members(count)').eq('id', req.party_id).maybeSingle();
    const memberCount = party?.party_members?.[0]?.count ?? 0;

    if (memberCount >= party?.party_size) {
      alert('Party is already full.');
      await sb.from('party_requests').update({ status: 'rejected' }).eq('id', requestId);
      _updateNotifMeta(requestId, { status: 'rejected' });
      _refreshNotifUI();
      return;
    }

    // Check if requester already joined another party (race condition guard)
    const { data: alreadyIn } = await sb.from('party_members')
      .select('party_id').eq('user_id', req.requester_id).maybeSingle();
    if (alreadyIn) {
      await sb.from('party_requests').update({ status: 'rejected' }).eq('id', requestId);
      _updateNotifMeta(requestId, { status: 'rejected', already_joined: true });
      _refreshNotifUI();
      return;
    }

    // Add to party_members
    const { error: memErr } = await sb.from('party_members').insert({
      party_id:   req.party_id,
      user_id:    req.requester_id,
      username:   req.requester_name,
      avatar_url: req.requester_avatar || null,
      user_class: req.requester_class || null
    });
    if (memErr) { alert('Failed to add member: ' + memErr.message); return; }

    // Mark request accepted
    await sb.from('party_requests').update({ status: 'accepted' }).eq('id', requestId);
    _updateNotifMeta(requestId, { status: 'accepted' });

    // Check if now full → remove from listings
    const newCount = memberCount + 1;
    if (newCount >= party?.party_size) {
      await sb.from('party_listings').update({ status: 'full' }).eq('id', req.party_id);
    }

    // Notify the requester they were accepted
    await sb.from('notifications').insert({
      user_id: req.requester_id,
      title:   `You were accepted into the party!`,
      body:    `Boss: ${party?.boss || '?'}`,
      meta:    { type: 'party_accepted', party_id: req.party_id }
    });

    _refreshNotifUI();
    // Refresh panel members if we're looking at this party
    if (_currentPartyId === req.party_id) await refreshMembers(req.party_id);
    await loadParties();
  }

  async function rejectRequest(requestId) {
    await sb.from('party_requests').update({ status: 'rejected' }).eq('id', requestId);
    _updateNotifMeta(requestId, { status: 'rejected' });
    _refreshNotifUI();
  }

  // Patch the in-memory notification meta so the UI updates without a reload
  function _updateNotifMeta(requestId, patch) {
    const notifs = window._trdGetNotifs?.() || [];
    const n = notifs.find(x => x.meta?.request_id === requestId);
    if (n) Object.assign(n.meta, patch);
  }

  function _refreshNotifUI() {
    if (window._trdRenderNotifs) window._trdRenderNotifs();
  }

  function viewBuildFromNotif(requestId) {
    const notifs = window._trdGetNotifs?.() || [];
    const n = notifs.find(x => x.meta?.request_id === requestId);
    if (!n?.meta) return;
    const { requester_name, requester_class, requester_build } = n.meta;
    const s = requester_build?.state || {};
    _removeModal('party-profile-modal');
    const d = document.createElement('div');
    d.id = 'party-profile-modal';
    d.className = 'party-modal-overlay';
    d.innerHTML = `<div class="party-modal">
      <div style="font-weight:700;color:#d0c8f0;font-size:15px;margin-bottom:4px">${esc(requester_name)}</div>
      ${requester_class ? `<div style="font-size:12px;color:#8888bb;margin-bottom:12px">🎭 ${esc(requester_class)}</div>` : ''}
      <label class="party-modal-label" style="margin-bottom:6px">Attached Build</label>
      ${requester_build
        ? `<div class="party-build-card">
            <div class="party-build-name">${esc(requester_build.name || 'Unnamed')}</div>
            ${s.race  ? `<div class="party-build-row">Race: <span>${esc(s.race)}</span></div>` : ''}
            ${s.cls   ? `<div class="party-build-row">Class: <span>${esc(s.cls)}</span></div>` : ''}
            ${s.sup   ? `<div class="party-build-row">Super: <span>${esc(s.sup)}</span></div>` : ''}
            ${s.sub   ? `<div class="party-build-row">Sub: <span>${esc(s.sub)}</span></div>` : ''}
            ${s.level ? `<div class="party-build-row">Level: <span>${esc(s.level)}</span></div>` : ''}
           </div>`
        : `<div class="party-no-build">No build attached.</div>`}
      <div style="margin-top:16px;text-align:right">
        <button class="party-modal-cancel" onclick="window._partyCloseModal('party-profile-modal')">Close</button>
      </div>
    </div>`;
    document.body.appendChild(d);
  }

  // ── Notification extras hook ──────────────────────────────
  window._notifExtra = function (n) {
    if (!n.meta) return '';
    if (n.meta.type === 'party_join') {
      const rid = esc(n.meta.request_id);
      const st  = n.meta.status;
      if (st === 'accepted') return `<div class="notif-action-result notif-accepted">✓ Accepted</div>`;
      if (st === 'rejected' && n.meta.already_joined) return `<div class="notif-action-result notif-rejected">Already in a party</div>`;
      if (st === 'rejected') return `<div class="notif-action-result notif-rejected">✗ Rejected</div>`;
      const buildBtn = n.meta.requester_build
        ? `<button class="notif-action-btn notif-build-btn" onclick="event.stopPropagation();window._partyViewBuildFromNotif('${rid}')">View Build</button>` : '';
      return `<div class="notif-actions">
        ${buildBtn}
        <button class="notif-action-btn notif-accept-btn" onclick="event.stopPropagation();window._partyAcceptRequest('${rid}')">Accept</button>
        <button class="notif-action-btn notif-reject-btn" onclick="event.stopPropagation();window._partyRejectRequest('${rid}')">Reject</button>
      </div>`;
    }
    if (n.meta.type === 'party_accepted') {
      return `<div class="notif-action-result notif-accepted">You're in! Open the Lf Party tab to chat.</div>`;
    }
    return '';
  };

  // ── Close party directly from card (host only) ───────────
  async function closePartyFromCard(partyId) {
    if (!authed()) return;
    if (!confirm('Close your party? All members will be removed.')) return;
    await sb.from('party_listings').update({ status: 'closed' }).eq('id', partyId);
    await sb.from('party_members').delete().eq('party_id', partyId);
    if (_currentPartyId === partyId) closePartyPanel();
    _myPartyId = null;
    await loadParties();
  }

  // ── Leave party from card (non-host, no panel required) ──────────────
  async function leavePartyFromCard(partyId) {
    if (!authed()) return;
    if (!confirm('Leave this party?')) return;
    await sb.from('party_members').delete().eq('party_id', partyId).eq('user_id', uid());

    // If the party was full, re-open it now that a slot freed up
    const { data: listing } = await sb.from('party_listings').select('status').eq('id', partyId).maybeSingle();
    if (listing?.status === 'full') {
      await sb.from('party_listings').update({ status: 'open' }).eq('id', partyId);
    }

    _myPartyId   = null;
    _myPartyData = null;
    if (_currentPartyId === partyId) closePartyPanel();
    window._trdRenderConvList?.();
    await loadParties();
  }

  // ── Leave / Close ─────────────────────────────────────────
  async function leaveParty() {
    if (!_currentPartyId || !authed()) return;
    const partyId = _currentPartyId;
    const party   = _allParties.find(p => p.id === partyId) || (_myPartyData?.id === partyId ? _myPartyData : null);
    const isHost  = party?.host_id === uid();

    if (isHost) {
      if (!confirm('Closing the party will remove all members. Continue?')) return;
      await sb.from('party_listings').update({ status: 'closed' }).eq('id', partyId);
      await sb.from('party_members').delete().eq('party_id', partyId);
    } else {
      await sb.from('party_members').delete().eq('party_id', partyId).eq('user_id', uid());
      // Re-open if it was full so it returns to public listings
      if (party?.status === 'full') {
        await sb.from('party_listings').update({ status: 'open' }).eq('id', partyId);
      }
    }

    _myPartyId   = null;
    _myPartyData = null;
    closePartyPanel();
    window._trdRenderConvList?.();
    await loadParties();
  }

  // ── Party Panel ───────────────────────────────────────────
  async function openPartyPanel(partyId) {
    _currentPartyId = partyId;
    const overlay = document.getElementById('party-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';

    const party = _allParties.find(p => p.id === partyId) || (_myPartyData?.id === partyId ? _myPartyData : {});
    const titleEl = document.getElementById('party-panel-title');
    if (titleEl) titleEl.textContent = `${party.boss || 'Party'} · ${party.party_size || '?'} players`;

    const leaveBtn = document.getElementById('party-leave-btn');
    if (leaveBtn) leaveBtn.textContent = party.host_id === uid() ? 'Close Party' : 'Leave Party';

    await refreshMembers(partyId);

    const chatEl = document.getElementById('party-panel-chat');
    if (chatEl) {
      chatEl.innerHTML = '<div class="party-chat-empty">Loading messages…</div>';
      await loadChat(partyId);
    }

    subscribeChat(partyId);
    document.getElementById('party-chat-input')?.focus();
  }

  function closePartyPanel() {
    const overlay = document.getElementById('party-overlay');
    if (overlay) overlay.style.display = 'none';
    if (_chatSub) { try { sb.removeChannel(_chatSub); } catch (_) {} _chatSub = null; }
    _currentPartyId = null;
  }

  async function refreshMembers(partyId) {
    const el = document.getElementById('party-panel-members');
    if (!el) return;
    const { data: members } = await sb.from('party_members').select('*').eq('party_id', partyId).order('joined_at');
    const party = _allParties.find(p => p.id === partyId);
    if (!members?.length) {
      el.innerHTML = '<div class="party-members-title">Members</div><div style="color:#555;font-size:13px">No members.</div>';
      return;
    }
    el.innerHTML = `<div class="party-members-title">Members (${members.length}/${party?.party_size ?? '?'})</div>`
      + members.map(m => `
        <div class="party-member-row">
          ${mkAvatar(m.username, m.avatar_url, 26)}
          <div class="party-member-info">
            <span class="party-member-name">${esc(m.username)}${m.user_id === party?.host_id ? '<span class="party-member-badge">Host</span>' : ''}</span>
            ${m.user_class ? `<div class="party-member-class">${esc(m.user_class)}</div>` : ''}
          </div>
        </div>`).join('');
  }

  // ── Chat ──────────────────────────────────────────────────
  async function loadChat(partyId) {
    const el = document.getElementById('party-panel-chat');
    if (!el) return;
    const { data: msgs } = await sb.from('party_messages').select('*').eq('party_id', partyId).order('created_at').limit(100);
    el.innerHTML = '';
    if (!msgs?.length) {
      el.innerHTML = '<div class="party-chat-empty">No messages yet. Say hi!</div>';
      return;
    }
    msgs.forEach(m => _appendMsg(m));
  }

  function _appendMsg(msg) {
    const el = document.getElementById('party-panel-chat');
    if (!el) return;
    const own = msg.sender_id === uid();
    // Remove "no messages" placeholder if present
    const empty = el.querySelector('.party-chat-empty');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = 'party-msg' + (own ? ' own' : '');
    div.innerHTML = (own ? '' : mkAvatar(msg.sender_name, msg.sender_avatar, 22))
      + `<div class="party-msg-body">`
      + (!own ? `<div class="party-msg-name">${esc(msg.sender_name)}</div>` : '')
      + `<div class="party-msg-text">${esc(msg.content)}</div>`
      + `</div>`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }

  function subscribeChat(partyId) {
    if (_chatSub) { try { sb.removeChannel(_chatSub); } catch (_) {} }
    _chatSub = sb.channel('party-chat-' + partyId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'party_messages',
        filter: `party_id=eq.${partyId}`
      }, payload => {
        if (payload.new?.sender_id !== uid()) _appendMsg(payload.new);
      })
      .subscribe();
  }

  async function sendMessage() {
    const input = document.getElementById('party-chat-input');
    if (!input || !_currentPartyId || !authed()) return;
    const text = cleanMsg(input.value);
    if (!text) { input.value = ''; return; }
    input.value = '';
    const profile = await getMyProfile();
    const row = {
      party_id:     _currentPartyId,
      sender_id:    uid(),
      sender_name:  profile.username || 'Unknown',
      sender_avatar: profile.avatar_url || null,
      content:      text
    };
    _appendMsg({ ...row, created_at: new Date().toISOString() }); // optimistic
    await sb.from('party_messages').insert(row);
  }

  // ── View Profile modal ────────────────────────────────────
  async function viewProfile(userId, username) {
    _removeModal('party-profile-modal');
    const { data: prof } = await sb.from('profiles')
      .select('username, avatar_url, party_class, attached_build')
      .eq('id', userId).maybeSingle();

    const cls   = prof?.party_class || null;
    const build = prof?.attached_build || null;
    const s     = build?.state || {};

    const buildHtml = build
      ? `<div class="party-build-card">
          <div class="party-build-name">${esc(build.name || 'Unnamed Build')}</div>
          ${s.race  ? `<div class="party-build-row">Race: <span>${esc(s.race)}</span></div>` : ''}
          ${s.cls   ? `<div class="party-build-row">Class: <span>${esc(s.cls)}</span></div>` : ''}
          ${s.sup   ? `<div class="party-build-row">Super: <span>${esc(s.sup)}</span></div>` : ''}
          ${s.sub   ? `<div class="party-build-row">Sub: <span>${esc(s.sub)}</span></div>` : ''}
          ${s.level ? `<div class="party-build-row">Level: <span>${esc(s.level)}</span></div>` : ''}
         </div>`
      : `<div class="party-no-build">No build attached.</div>`;

    const d = document.createElement('div');
    d.id = 'party-profile-modal';
    d.className = 'party-modal-overlay';
    d.innerHTML = `<div class="party-modal">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        ${mkAvatar(prof?.username || username, prof?.avatar_url, 44)}
        <div>
          <div style="font-weight:700;color:#d0c8f0;font-size:15px">${esc(prof?.username || username)}</div>
          ${cls ? `<div style="font-size:12px;color:#8888bb;margin-top:2px">🎭 ${esc(cls)}</div>` : ''}
        </div>
      </div>
      <label class="party-modal-label" style="margin-bottom:6px">Attached Build</label>
      ${buildHtml}
      <div style="margin-top:16px;text-align:right">
        <button class="party-modal-cancel" onclick="window._partyCloseModal('party-profile-modal')">Close</button>
      </div>
    </div>`;
    document.body.appendChild(d);
  }

  // ── Util ──────────────────────────────────────────────────
  function _removeModal(id) {
    document.getElementById(id)?.remove();
  }

  // Close overlay on backdrop click
  document.addEventListener('mousedown', e => {
    if (e.target?.classList?.contains('party-overlay')) closePartyPanel();
    if (e.target?.classList?.contains('party-modal-overlay')) _removeModal(e.target.id);
  });

  // Send on Enter
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.activeElement?.id === 'party-chat-input') sendMessage();
  });

  // Hook into switchPage to load parties and profile when navigating here
  const _orig = window.switchPage;
  if (typeof _orig === 'function') {
    window.switchPage = function (name) {
      _orig(name);
      if (name === 'lf-party') { loadParties(); loadMyPartyProfile(); }
    };
  }

  // ── Expose ────────────────────────────────────────────────
  window._partyLoad        = loadParties;
  window._partyHost        = openHost;
  window._partySetClass    = openSetClass;
  window._partySaveClass   = saveClass;
  window._partyAttachBuild = openAttachBuild;
  window._partySaveBuild   = saveBuild;
  window._partySelectSize  = selectSize;
  window._partySubmitHost  = submitHost;
  window._partyJoin        = joinParty;
  window._partyOpenPanel   = openPartyPanel;
  window._partyLeave       = leaveParty;
  window._partyClose       = closePartyPanel;
  window._partySend              = sendMessage;
  window._partyViewProfile       = viewProfile;
  window._partyCloseModal        = _removeModal;
  window._partyAcceptRequest     = acceptRequest;
  window._partyRejectRequest     = rejectRequest;
  window._partyViewBuildFromNotif = viewBuildFromNotif;
  window._partyCloseFromCard     = closePartyFromCard;
  window._partyLeaveFromCard     = leavePartyFromCard;

  // Hook for DM panel: returns party entry if user is in a party
  window._partyGetConvEntry = function () {
    if (!_myPartyId) return null;
    const p = _myPartyData || _allParties.find(x => x.id === _myPartyId);
    if (!p) return null;
    return { partyId: _myPartyId, boss: p.boss, size: p.party_size };
  };

  // Called from DM panel party entry click
  window._partyOpenFromMessages = function () {
    window.switchPage?.('lf-party');
    setTimeout(() => openPartyPanel(_myPartyId), 120);
  };

  // Fire-and-forget cleanup on page load (pg_cron is the primary mechanism)
  sb.rpc('cleanup_old_listings').catch(() => {});
})();
