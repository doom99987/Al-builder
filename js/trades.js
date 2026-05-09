// ============================================================
//  AL Builder — Trades, Direct Messages, and Notifications
// ============================================================
(function () {
  'use strict';

  const SUPABASE_URL      = 'https://mpqohagljmvwftwqumnh.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wcW9oYWdsam12d2Z0d3F1bW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMzg1NzEsImV4cCI6MjA5MzYxNDU3MX0.WfU88Ell1Q6jCcef2YiohxIeTHBNfruIxYWoa1QRCUc';

  // Reuse sb.js's authenticated client so RLS sees the correct JWT.
  // Fall back to creating a new one only if sb.js hasn't loaded yet.
  if (!window.supabase && !window._sbClient) { console.warn('trades.js: Supabase not loaded'); return; }
  const sb = window._sbClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { flowType: 'implicit' }
  });

  // ---- chat word filter ----
  const _BANNED = ['fuck','shit','bitch','cunt','cock','pussy','asshole','bastard','whore','nigger','nigga','faggot','fag','retard','kys','kms'];
  function filterMsg(txt) {
    return _BANNED.reduce((s, w) =>
      s.replace(new RegExp(`\\b${w}s?\\b`, 'gi'), m => '*'.repeat(m.length)), txt);
  }

  // ---- tradeable items ----
  const TRADEABLE_ITEMS = [
    // --- Currency / Special ---
    'Lineage Shard',

    // --- Weapons: Ferrus ---
    'Ferrus Sword',
    'Old Staff',
    'Ferrus Dagger',
    'Ferrus Cestus',
    'Ferrus Spear',
    'Ferrus Axe',
    'Ferrus Tenderizer',

    // --- Weapons: Blacksteel ---
    'Blacksteel Sabre',
    'Blacksteel Staff',
    'Blacksteel Knife',
    'Blacksteel Claws',
    'Blacksteel Spear',
    'Blacksteel Axe',
    'Greatsword',

    // --- Weapons: Jade ---
    'Jade Broadsword',
    'Jade Prayerstaff',

    // --- Weapons: Corealloy ---
    'Corealloy Manadagger',
    'Corealloy Manaclaws',
    'Corealloy Manablade',

    // --- Weapons: Dragon ---
    'Dragontooth Blade',
    'Dragontooth Staff',
    'Dragontooth Dagger',
    'Dragonbone Gauntlets',
    'Dragonbone Spear',
    'Dragonpyre Axe',
    'Dragonbone Hammer',

    // --- Weapons: Blight ---
    'Blightrock Sword',
    'Blightwood Staff',
    'Blightrock Dagger',
    'Blightrock Gauntlets',
    'Blightrock Spear',

    // --- Weapons: Sun ---
    'Sun Sword',
    'Sun Staff',
    'Sun Dagger',
    'Sun Spear',
    'Sun Greatsword',

    // --- Weapons: Darkblood ---
    'Darkblood Sword',
    'Darkblood Staff',
    'Darkblood Dagger',
    'Darkblood Cestus',
    'Darkblood Spear',
    'Darkblood Hexer',

    // --- Weapons: Sandstone ---
    'Sandstone Staff',
    'Sandstone Dagger',
    'Sandstone Gauntlets',
    'Sandstone Spear',
    'Sandstone Hammer',

    // --- Weapons: Primordial ---
    'Primordial Sword',
    'Primordial Staff',
    'Primordial Dagger',
    'Primordial Gauntlets',
    'Primordial Spear',
    'Primordial Axe',
    'Primordial Hammer',

    // --- Weapons: Icerind ---
    'Icerind Sword',
    'Icerind Staff',
    'Icerind Sai',
    'Icerind Cestus',
    'Icerind Spear',
    'Icerind Greatsword',

    // --- Weapons: Ivory ---
    'Ivory Sword',
    'Ivory Dagger',
    'Ivory Spear',
    'Ivory Axe',
    'Ivory Hammer',
    'Ivory Greatsword',

    // --- Weapons: Unique ---
    'Vastic Glaive',
    'Star-Seeing Hammer',

    // --- Shields ---
    'Targe',
    'Ferrus Towershield',
    'Dragonflame Shield',
    'Slimy Buckler',
    'Icerind Shield',
    'Sandstone Shield',
    'Primordial Shield',
    'Ivory Shield',

    // --- Gear: Easter ---
    'Rabbit Pelt',
    'Egg Shelmet',
    'Chocolate Egg',
    'Party Egg',
    'Gleaming Carrot',
    "Rabbit's Foot",

    // --- Gear: Winter Solstice ---
    'Snorb',
    'Elementary Resonance',
    'Frosty Topper',

    // --- Gear: Forest ---
    '7 Leafed Everthistle',
    'Shattered Clock Hand',
    'The Biggest Pebble',
    'Arbusta Tear',
    'Parasitic Leech',
    'Spore Root',
    'Forest Charm',
    'Elemental Infuser',
    'Crystallized Star',
    'Pathfinder Mark',
    'Gilded Pouch',

    // --- Gear: Desert ---
    'Crystal Sphere',
    'Dust Storm',
    'Golem Rune Core',
    'Spiked Steel Ball',
    'Stone Brand',
    'Ramizcan Idol',
    'Band of Crushing Force',
    'Grain Of Balance',
    "Madseer's Codex",
    'Impure Crown',
    'The Last Straw',
    'Imbued Chains',
    'Delicate Purse',
    'Desert Escutcheon',

    // --- Gear: Deeproot ---
    'Cursed Brand',
    "Narthana's Leaf",
    'Wicked Crown',
    'Sanguine Fang',
    'Coagulated Finger Nail',
    'Shard of Blight',
    "Traveler's Lamp",
    'Expedite Anklet',
    'Phantom Ooze',

    // --- Gear: Volcano ---
    'Imperial Headband',
    'Magma Charm',
    'Vulcan Knuckle',
    'Dragon Memoir',
    'Blazing Brand',
    'Molten Carapace',

    // --- Gear: Boss Drops ---
    'Gelat Band',
    'Tear Blood Crystal',
    "Ptera's Heart",
    'DeathBeak Dagger',
    'Blazing Perforator',
    "Yar'thul's Wrath",
    'Frostburned Rune',
    'Vow of Ruin',
    'Frozen Diadem',
    'Imbuement Reliquary',
    'Divine Promise',
    'Focused Mind',
    'Aspect of Maladaptation',
    'Tainted Quiver',
    'Vainglorious Locket',
    'The Smallest Boulder',
    'Eroded Blade',
    "Dust Devil's Eye",
    'Open Hand',

    // --- Gear: Other ---
    'Lethal Blackjack',
    'Everbeating Drums',
  ];

  // ---- state ----
  let _tradeTab      = 'selling';
  let _notifications = [];
  let _notifSub      = null;
  let _notifOpen     = false;
  let _cachedAvatar  = null;
  let _prevUid       = null;

  // DM state
  let _dmOpen     = false;
  let _dmView     = 'list'; // 'list' | 'thread'
  let _dmConvs    = [];
  let _dmThread   = [];
  let _dmWithId   = null;
  let _dmWithName = null;
  let _dmSub      = null;

  // ---- helpers ----
  const _E = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s).replace(/[&<>"']/g, c => _E[c]); }

  function avatarColor(name) {
    const p = ['#5544cc','#2266bb','#1e8c6e','#b05a10','#aa2266','#993333','#1a6699'];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return p[Math.abs(h) % p.length];
  }

  function mkAvatar(name, url, size) {
    const c  = avatarColor(name);
    const fs = Math.round(size * 0.44);
    const inner = url
      ? `<img src="${esc(url)}" class="sb-avatar-img" alt="" onerror="this.style.display='none'">${name.charAt(0).toUpperCase()}`
      : name.charAt(0).toUpperCase();
    return `<div class="sb-avatar" style="background:${c};width:${size}px;height:${size}px;font-size:${fs}px">${inner}</div>`;
  }

  function timeAgo(d) {
    const s = Math.floor((Date.now() - new Date(d)) / 1000);
    if (s < 60)  return 'just now';
    const m = Math.floor(s / 60);  if (m < 60)  return m + 'm ago';
    const h = Math.floor(m / 60);  if (h < 24)  return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  const uid    = () => window._sbGetUserId?.()  ?? null;
  const uname  = () => window._sbGetUsername?.() ?? null;
  const authed = () => !!uid();

  async function myAvatar() {
    if (_cachedAvatar !== null) return _cachedAvatar || null;
    const id = uid(); if (!id) return null;
    try {
      const { data } = await sb.from('profiles').select('avatar_url').eq('id', id).maybeSingle();
      _cachedAvatar = data?.avatar_url || '';
    } catch (_) { _cachedAvatar = ''; }
    return _cachedAvatar || null;
  }

  // ============================================================
  //  TRADES
  // ============================================================

  async function loadListings() {
    const el = document.getElementById('trades-list');
    if (!el) return;
    el.innerHTML = '<div class="trd-state">Loading...</div>';
    try {
      const { data, error } = await sb
        .from('trade_listings')
        .select('*')
        .eq('type',   _tradeTab)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      renderListings(data || []);
    } catch (_) {
      el.innerHTML = '<div class="trd-state">Could not load listings — the trades table may not be set up yet.</div>';
    }
  }

  function renderListings(list) {
    const el = document.getElementById('trades-list');
    if (!el) return;
    const myId = uid();
    if (!list.length) {
      el.innerHTML = `<div class="trd-state">No ${_tradeTab} listings yet. Be the first!</div>`;
      return;
    }
    const itemList = arr =>
      (Array.isArray(arr) && arr.length)
        ? arr.map(i => `<div class="trd-card-item">${esc(i.item)}${i.quantity > 1 ? ` <span class="trd-card-qty">×${i.quantity}</span>` : ''}</div>`).join('')
        : '';

    el.innerHTML = list.map(l => {
      const own      = l.user_id === myId;
      const itemsHtml = itemList(l.items) || (l.item ? `<div class="trd-card-item">${esc(l.item)}${l.quantity > 1 ? ` <span class="trd-card-qty">×${l.quantity}</span>` : ''}</div>` : '');
      const lfHtml    = itemList(l.lf_items) || (l.lf ? `<div class="trd-card-item">${esc(l.lf)}</div>` : '');
      return `<div class="trd-card">
        <div class="trd-card-top">
          <div class="trd-card-user">
            ${mkAvatar(l.username, l.avatar_url, 34)}
            <div class="trd-card-meta">
              <span class="trd-card-uname">${esc(l.username)}</span>
              <span class="trd-card-age">${timeAgo(l.created_at)}</span>
            </div>
          </div>
          ${own ? `<button class="trd-del-btn" onclick="window._trdDelete('${l.id}')" title="Remove">✕</button>` : ''}
        </div>
        <div class="trd-card-items">${itemsHtml}</div>
        ${lfHtml ? `<div class="trd-card-lf-block"><span class="${l.type === 'buying' ? 'trd-gv-label' : 'trd-lf-label'}">${l.type === 'buying' ? 'GV' : 'LF'}</span><div class="trd-card-items">${lfHtml}</div></div>` : ''}
        ${l.description ? `<div class="trd-card-desc">${esc(l.description)}</div>` : ''}
        ${!own ? `<button class="trd-msg-btn" onclick="window._trdMessage('${esc(l.user_id)}','${esc(l.username)}','${esc((Array.isArray(l.items)&&l.items.length)?l.items[0].item:(l.item||'your listing'))}')">💬 Accept Offer</button>` : ''}
      </div>`;
    }).join('');
  }

  async function deleteListing(id) {
    if (!authed() || !confirm('Remove this listing?')) return;
    try { await sb.from('trade_listings').update({ status: 'cancelled' }).eq('id', id); loadListings(); }
    catch (e) { console.error('[trades] delete error', e); }
  }

  // ---- post listing modal ----
  function itemRowHtml() {
    return `<div class="trd-item-row">
      <input class="trd-input trd-item-name" type="text" placeholder="Item name" maxlength="100" list="trd-items-list" autocomplete="off">
      <input class="trd-input trd-item-qty"  type="number" min="1" max="9999" value="1" title="Quantity">
      <button class="trd-item-row-del" type="button" onclick="window._trdRemoveItem(this)" title="Remove">×</button>
    </div>`;
  }

  function addItemRow(containerId) {
    const c = document.getElementById(containerId);
    if (c) c.insertAdjacentHTML('beforeend', itemRowHtml());
  }

  function removeItemRow(btn) {
    const row = btn.closest('.trd-item-row');
    const c   = row?.parentElement;
    if (!c || c.children.length <= 1) return; // always keep at least one row
    row.remove();
  }

  function openPostModal() {
    if (!authed()) { window._openAuthModal?.('login'); return; }
    if (document.getElementById('trd-post-modal')) return;
    const m = document.createElement('div');
    m.id        = 'trd-post-modal';
    m.className = 'trd-modal-overlay';
    m.innerHTML = `
      <div class="trd-modal" role="dialog" aria-modal="true">
        <div class="trd-modal-hdr">
          <span>Post a Trade</span>
          <button class="trd-modal-x" onclick="window._trdClosePost()">✕</button>
        </div>
        <div class="trd-modal-body">
          <div class="trd-form-row">
            <label class="trd-label">Type</label>
            <div class="trd-type-row">
              <button class="trd-type-btn active" data-ttype="selling" onclick="window._trdTypeSelect(this)">Selling</button>
              <button class="trd-type-btn"        data-ttype="buying"  onclick="window._trdTypeSelect(this)">Buying</button>
            </div>
          </div>
          <datalist id="trd-items-list">${TRADEABLE_ITEMS.map(i => `<option value="${esc(i)}">`).join('')}</datalist>
          <div class="trd-form-row">
            <label class="trd-label">Items <span class="trd-req">*</span></label>
            <div id="trd-items-container">${itemRowHtml()}</div>
            <button class="trd-add-item-btn" type="button" onclick="window._trdAddItem('trd-items-container')">+ Add item</button>
          </div>
          <div class="trd-form-row">
            <label class="trd-label" id="trd-lf-section-label">Looking For <span class="trd-req">*</span></label>
            <div id="trd-lf-container">${itemRowHtml()}</div>
            <button class="trd-add-item-btn" type="button" onclick="window._trdAddItem('trd-lf-container')">+ Add item</button>
          </div>
          <div class="trd-form-row">
            <label class="trd-label">Notes</label>
            <textarea id="trd-post-desc" class="trd-input trd-textarea" placeholder="Optional details..." maxlength="300"></textarea>
          </div>
          <div id="trd-post-err" class="trd-form-err"></div>
          <button class="trd-submit-btn" onclick="window._trdSubmit()">Post Listing</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) window._trdClosePost(); });
    document.querySelector('.trd-item-name')?.focus();
  }

  function closePostModal() { document.getElementById('trd-post-modal')?.remove(); }

  function typeSelect(btn) {
    document.querySelectorAll('.trd-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const isBuying = btn.dataset.ttype === 'buying';
    const lbl = document.getElementById('trd-lf-section-label');
    if (lbl) lbl.innerHTML = (isBuying ? 'Giving' : 'Looking For') + ' <span class="trd-req">*</span>';
  }

  function collectRows(containerId) {
    const out = [];
    document.querySelectorAll(`#${containerId} .trd-item-row`).forEach(row => {
      const name = row.querySelector('.trd-item-name')?.value.trim();
      const qty  = Math.max(1, parseInt(row.querySelector('.trd-item-qty')?.value) || 1);
      if (name) out.push({ item: name, quantity: qty });
    });
    return out;
  }

  async function submitPost() {
    const desc  = document.getElementById('trd-post-desc')?.value.trim();
    const ttype = document.querySelector('.trd-type-btn.active')?.dataset.ttype || 'selling';
    const errEl = document.getElementById('trd-post-err');

    const items    = collectRows('trd-items-container');
    const lf_items = collectRows('trd-lf-container');

    if (!items.length)    { if (errEl) errEl.textContent = 'Add at least one item.'; return; }
    if (!lf_items.length) { if (errEl) errEl.textContent = 'Add at least one Looking For item.'; return; }
    if (errEl) errEl.textContent = '';

    const id = uid(), name = uname();
    if (!id || !name) return;
    const avatar_url = await myAvatar();

    const btn = document.querySelector('.trd-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Posting...'; }

    try {
      const { error } = await sb.from('trade_listings').insert({
        user_id: id, username: name, avatar_url,
        type: ttype, items, lf_items, description: desc || '',
      });
      if (error) throw error;
      closePostModal();
      if (ttype !== _tradeTab) switchTab(ttype);
      else loadListings();
    } catch (e) {
      if (errEl) errEl.textContent = e.message || 'Failed to post. Check Supabase setup.';
      if (btn) { btn.disabled = false; btn.textContent = 'Post Listing'; }
    }
  }

  // ============================================================
  //  DIRECT MESSAGES
  // ============================================================

  function toggleDm() {
    if (!authed()) { window._openAuthModal?.('login'); return; }
    _dmOpen = !_dmOpen;
    const panel = document.getElementById('dm-panel');
    if (!panel) return;
    if (_dmOpen) {
      panel.style.display = 'flex';
      const btn = document.getElementById('msg-bell-btn');
      if (btn) {
        const r = btn.getBoundingClientRect();
        panel.style.top   = (r.bottom + 6) + 'px';
        panel.style.right = (window.innerWidth - r.right) + 'px';
      }
      if (_dmView === 'list') loadConvList();
      else renderThread();
    } else {
      panel.style.display = 'none';
    }
  }

  async function loadConvList() {
    const body = document.getElementById('dm-body');
    if (!body) return;
    body.innerHTML = '<div class="dm-state">Loading...</div>';
    const id = uid(); if (!id) return;
    try {
      const [{ data: sent }, { data: recv }] = await Promise.all([
        sb.from('direct_messages').select('*').eq('sender_id', id).order('created_at', { ascending: false }).limit(100),
        sb.from('direct_messages').select('*').eq('recipient_id', id).order('created_at', { ascending: false }).limit(100),
      ]);

      // Merge and group by other user, keeping only the most recent message per convo
      const convMap = new Map();
      const all = [...(sent || []), ...(recv || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      for (const m of all) {
        const isMe      = m.sender_id === id;
        const otherId   = isMe ? m.recipient_id   : m.sender_id;
        const otherName = isMe ? m.recipient_name : m.sender_name;
        const otherAvatar = isMe ? null : m.sender_avatar;
        if (!convMap.has(otherId)) {
          convMap.set(otherId, { other_id: otherId, other_name: otherName, other_avatar: otherAvatar, last_msg: m.content, last_time: m.created_at, unread: 0 });
        }
        if (!isMe && !m.read) convMap.get(otherId).unread++;
      }
      _dmConvs = [...convMap.values()];
      renderConvList();
    } catch (_) {
      if (body) body.innerHTML = '<div class="dm-state">Could not load messages.</div>';
    }
  }

  function renderConvList() {
    const body = document.getElementById('dm-body');
    if (!body) return;
    const title = document.getElementById('dm-panel-title');
    if (title) title.textContent = 'Messages';
    const backBtn = document.getElementById('dm-back-btn');
    if (backBtn) backBtn.style.display = 'none';
    const footer = document.getElementById('dm-footer');
    if (footer) footer.style.display = 'none';

    if (!_dmConvs.length) {
      body.innerHTML = '<div class="dm-state">No messages yet.<br>Message someone from a trade listing.</div>';
      return;
    }
    body.innerHTML = _dmConvs.map(c => `
      <div class="dm-conv-item" onclick="window._dmOpenThread('${esc(c.other_id)}','${esc(c.other_name)}')">
        ${mkAvatar(c.other_name, c.other_avatar, 36)}
        <div class="dm-conv-info">
          <div class="dm-conv-name">${esc(c.other_name)}</div>
          <div class="dm-conv-preview">${esc(c.last_msg.slice(0, 55))}${c.last_msg.length > 55 ? '…' : ''}</div>
        </div>
        <div class="dm-conv-right">
          <div class="dm-conv-time">${timeAgo(c.last_time)}</div>
          ${c.unread > 0 ? `<div class="dm-conv-unread">${c.unread}</div>` : ''}
        </div>
      </div>`).join('');
  }

  async function openThread(otherId, otherName) {
    _dmView     = 'thread';
    _dmWithId   = otherId;
    _dmWithName = otherName;

    const body = document.getElementById('dm-body');
    if (body) body.innerHTML = '<div class="dm-state">Loading...</div>';
    const title = document.getElementById('dm-panel-title');
    if (title) title.textContent = otherName;
    const backBtn = document.getElementById('dm-back-btn');
    if (backBtn) backBtn.style.display = '';
    const footer = document.getElementById('dm-footer');
    if (footer) footer.style.display = 'flex';

    await loadThread(otherId);
    subscribeDm();
    markThreadRead(otherId);
    setTimeout(() => document.getElementById('dm-input')?.focus(), 80);
  }

  function backToConvs() {
    _dmView     = 'list';
    _dmWithId   = null;
    _dmWithName = null;
    _dmThread   = [];
    loadConvList();
  }

  async function loadThread(otherId) {
    const id = uid(); if (!id) return;
    try {
      const [{ data: sent }, { data: recv }] = await Promise.all([
        sb.from('direct_messages').select('*').eq('sender_id', id).eq('recipient_id', otherId).order('created_at', { ascending: true }),
        sb.from('direct_messages').select('*').eq('sender_id', otherId).eq('recipient_id', id).order('created_at', { ascending: true }),
      ]);
      _dmThread = [...(sent || []), ...(recv || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      renderThread();
    } catch (_) {}
  }

  function renderThread() {
    const body = document.getElementById('dm-body');
    if (!body) return;
    if (!_dmThread.length) {
      body.innerHTML = '<div class="dm-state">No messages yet. Say something!</div>';
      return;
    }
    const myId = uid();
    body.innerHTML = _dmThread.map(m => dmMsgHtml(m, myId)).join('');
    body.scrollTop = body.scrollHeight;
  }

  function dmMsgHtml(m, myId) {
    const mine = m.sender_id === myId;
    return `<div class="dm-msg ${mine ? 'dm-msg-mine' : 'dm-msg-theirs'}">
      ${!mine ? mkAvatar(m.sender_name, m.sender_avatar, 24) : ''}
      <div class="dm-bubble">${esc(m.content)}<span class="dm-bubble-time">${timeAgo(m.created_at)}</span></div>
    </div>`;
  }

  function appendDmMsg(m) {
    _dmThread.push(m);
    const body = document.getElementById('dm-body');
    if (!body) return;
    body.querySelector('.dm-state')?.remove();
    body.insertAdjacentHTML('beforeend', dmMsgHtml(m, uid()));
    body.scrollTop = body.scrollHeight;
  }

  function subscribeDm() {
    if (_dmSub) return;
    const id = uid(); if (!id) return;
    try {
      _dmSub = sb
        .channel('alb-dm-' + id)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${id}` },
          p => {
            const m = p.new;
            if (_dmOpen && _dmView === 'thread' && m.sender_id === _dmWithId) {
              appendDmMsg(m);
              markThreadRead(m.sender_id);
            } else {
              syncMsgBadge();
            }
          })
        .subscribe();
    } catch (_) {}
  }

  async function markThreadRead(otherId) {
    const id = uid(); if (!id) return;
    try {
      await sb.from('direct_messages').update({ read: true })
        .eq('recipient_id', id).eq('sender_id', otherId).eq('read', false);
      syncMsgBadge();
    } catch (_) {}
  }

  let _dmTableMissing = false; // stop polling if table doesn't exist yet

  async function syncMsgBadge() {
    if (_dmTableMissing) return;
    const id = uid(); if (!id) return;
    try {
      const { count, error } = await sb
        .from('direct_messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', id)
        .eq('read', false);
      if (error) { if (error.code === 'PGRST116' || error.message?.includes('does not exist') || error.status === 403) _dmTableMissing = true; return; }
      const badge = document.getElementById('msg-badge');
      if (badge) {
        const n = count || 0;
        badge.textContent   = n > 9 ? '9+' : String(n);
        badge.style.display = n > 0 ? 'flex' : 'none';
      }
    } catch (_) {}
  }

  async function sendDm() {
    if (!authed()) return;
    const inp = document.getElementById('dm-input');
    const txt = inp?.value.trim();
    if (!txt || !_dmWithId || !_dmWithName) return;
    const id = uid(), name = uname();
    if (!id || !name) return;
    const avatar_url = await myAvatar();
    const filtered = filterMsg(txt);
    inp.value = '';
    try {
      const { error } = await sb.from('direct_messages').insert({
        sender_id: id, sender_name: name, sender_avatar: avatar_url,
        recipient_id: _dmWithId, recipient_name: _dmWithName,
        content: filtered,
      });
      if (error) { inp.value = txt; return; }
      // Optimistically render own message
      appendDmMsg({
        id: Date.now(),
        sender_id: id, sender_name: name, sender_avatar: avatar_url,
        recipient_id: _dmWithId, content: filtered, read: true,
        created_at: new Date().toISOString(),
      });
    } catch (_) { inp.value = txt; }
  }

  // ============================================================
  //  NOTIFICATIONS
  // ============================================================

  async function loadNotifs() {
    const id = uid(); if (!id) return;
    try {
      const { data } = await sb
        .from('notifications')
        .select('*')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .limit(30);
      _notifications = data || [];
      syncBell();
    } catch (_) {}
  }

  function syncBell() {
    const unread = _notifications.filter(n => !n.read).length;
    const badge  = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent   = unread > 9 ? '9+' : String(unread);
      badge.style.display = unread > 0 ? 'flex' : 'none';
    }
  }

  function subscribeNotifs() {
    const id = uid(); if (!id || _notifSub) return;
    try {
      _notifSub = sb
        .channel('alb-notifs-' + id)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${id}` },
          p => { _notifications.unshift(p.new); syncBell(); })
        .subscribe();
    } catch (_) {}
  }

  function toggleNotifs() {
    if (!authed()) return;
    _notifOpen = !_notifOpen;
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    panel.style.display = _notifOpen ? 'flex' : 'none';
    if (_notifOpen) {
      renderNotifList();
      const bell = document.getElementById('notif-bell-btn');
      if (bell) {
        const r = bell.getBoundingClientRect();
        panel.style.top   = (r.bottom + 6) + 'px';
        panel.style.right = (window.innerWidth - r.right) + 'px';
      }
      markNotifRead();
    }
  }

  function renderNotifList() {
    const el = document.getElementById('notif-list');
    if (!el) return;
    if (!_notifications.length) {
      el.innerHTML = '<div class="notif-empty">No notifications yet.</div>';
      return;
    }
    el.innerHTML = _notifications.map(n => `
      <div class="notif-item${n.read ? '' : ' notif-new'}">
        <div class="notif-item-title">${esc(n.title)}</div>
        ${n.body ? `<div class="notif-item-body">${esc(n.body)}</div>` : ''}
        <div class="notif-item-time">${timeAgo(n.created_at)}</div>
      </div>`).join('');
  }

  async function markNotifRead() {
    const id = uid(); if (!id) return;
    const ids = _notifications.filter(n => !n.read).map(n => n.id);
    if (!ids.length) return;
    try {
      await sb.from('notifications').update({ read: true }).in('id', ids);
      _notifications.forEach(n => { n.read = true; });
      syncBell();
    } catch (_) {}
  }

  // ============================================================
  //  TRADES DISCLAIMER
  // ============================================================

  function updateTradesDisclaimer(userId) {
    const el = document.getElementById('trades-disclaimer');
    if (!el) return;
    const key = userId ? 'alb-trades-disc-' + userId : null;
    el.style.display = (key && localStorage.getItem(key)) ? 'none' : 'flex';
  }

  window._dismissTradesDisclaimer = function () {
    const el = document.getElementById('trades-disclaimer');
    if (el) el.style.display = 'none';
    const id = uid();
    if (id) localStorage.setItem('alb-trades-disc-' + id, '1');
  };

  // ============================================================
  //  AUTH SYNC
  // ============================================================

  function checkAuth() {
    const id = uid();
    if (id === _prevUid) return;
    _prevUid = id;
    updateTradesDisclaimer(id);
    if (id) {
      _cachedAvatar = null;
      loadNotifs();
      subscribeNotifs();
      syncMsgBadge();
      subscribeDm();
    } else {
      _notifications = [];
      _dmConvs       = [];
      _dmThread      = [];
      if (_notifSub) { try { _notifSub.unsubscribe(); } catch(_){} _notifSub = null; }
      if (_dmSub)    { try { _dmSub.unsubscribe();    } catch(_){} _dmSub    = null; }
      syncBell();
      syncMsgBadge();
    }
  }

  setInterval(checkAuth, 1500);
  setTimeout(checkAuth, 400);

  // ============================================================
  //  TRADE TABS
  // ============================================================

  function switchTab(tab) {
    _tradeTab = tab;
    document.querySelectorAll('.trd-tab').forEach(b => b.classList.toggle('active', b.dataset.ttab === tab));
    loadListings();
  }

  // ============================================================
  //  INIT
  // ============================================================

  function init() {
    document.querySelectorAll('.trd-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.ttab));
    });

    document.getElementById('dm-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDm(); }
    });

    document.addEventListener('click', e => {
      if (_notifOpen) {
        const panel = document.getElementById('notif-panel');
        const bell  = document.getElementById('notif-bell-btn');
        if (panel && !panel.contains(e.target) && !(bell && bell.contains(e.target))) {
          _notifOpen = false;
          panel.style.display = 'none';
        }
      }
      if (_dmOpen) {
        const panel = document.getElementById('dm-panel');
        const btn   = document.getElementById('msg-bell-btn');
        if (panel && !panel.contains(e.target) && !(btn && btn.contains(e.target))) {
          _dmOpen = false;
          panel.style.display = 'none';
        }
      }
    });
  }

  window.addEventListener('DOMContentLoaded', init);

  // ============================================================
  //  GLOBALS
  // ============================================================
  window._trdLoad       = loadListings;
  window._trdPost       = openPostModal;
  window._trdClosePost  = closePostModal;
  window._trdTypeSelect = typeSelect;
  window._trdSubmit     = submitPost;
  window._trdDelete     = deleteListing;
  window._trdAddItem    = addItemRow;
  window._trdRemoveItem = removeItemRow;
  window._trdMessage    = async function (userId, username, itemName) {
    if (!authed()) { window._openAuthModal?.('login'); return; }
    // Send acceptance notification to the listing owner
    const myName = uname();
    if (myName) {
      try {
        await sb.from('notifications').insert({
          user_id: userId,
          title:   `${myName} accepted your offer!`,
          body:    `${myName} wants to trade for: ${itemName}`,
        });
      } catch (_) {}
    }
    // Open DM thread
    if (!_dmOpen) toggleDm();
    setTimeout(() => {
      openThread(userId, username);
      setTimeout(() => {
        const inp = document.getElementById('dm-input');
        if (inp) { inp.value = 'I accept your offer'; inp.focus(); }
      }, 120);
    }, _dmOpen ? 0 : 80);
  };
  window._toggleDm      = toggleDm;
  window._dmOpenThread  = openThread;
  window._dmBack        = backToConvs;
  window._dmSend        = sendDm;
  window._toggleNotifs  = toggleNotifs;
  window._syncNotifBell = syncBell;
  window._syncMsgBadge  = syncMsgBadge;
})();
