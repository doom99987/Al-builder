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
  const _BANNED = [
    // profanity — f-word family
    'fuck','fucking','fucked','fucker','fucks',
    'fuckhead','fuckface','fuckwit','fuckoff',
    'motherfucker','motherfucking','clusterfuck','dumbfuck',
    // profanity — s-word family
    'shit','shitting','shithead','shitstain','shitface',
    'bullshit','horseshit','dipshit',
    // profanity — b-words
    'bitch','bitches','bitching','bitchass',
    'bastard',
    // profanity — c-words
    'cunt','cunting','cocksucker',
    'cock','cockhead',
    // profanity — d-word
    'dick','dickhead','dickface',
    // profanity — a-words
    'ass','asshole','assholes','arsehole','arseholes',
    'asshat','asswipe','assfuck','assclown','assface',
    'jackass','dumbass','smartass',
    // profanity — other
    'pussy','pussies',
    'prick',
    'whore','whorish',
    'slut','slutty','slutting','slutshaming',
    'skank',
    'thot',
    'twat','twatface',
    'wanker','wanking',
    'piss','pissing','pisser','pisshead',
    // sexual body parts / acts
    'cum','cumshot','cumming','cumslut',
    'jizz','jizzing',
    'tit','tits','titties','titty',
    'boob','boobs',
    'boner',
    'blowjob','handjob','rimjob',
    'ballsack','nutsack','ballsacking',
    // racial / ethnic slurs — anti-Black
    'nigger','nigga','nigg',
    'coon','darkie','blackie',
    'jigaboo','sambo','pickaninny',
    'porch monkey','moon cricket','jungle bunny',
    'spook',
    // racial / ethnic slurs — anti-Latino
    'spic','beaner','wetback',
    // racial / ethnic slurs — anti-Asian
    'chink','gook','zipperhead','slope',
    // racial / ethnic slurs — anti-Arab/Muslim
    'towelhead','raghead','sandnigger','camel jockey',
    // racial / ethnic slurs — anti-South Asian
    'paki',
    // racial / ethnic slurs — anti-Indigenous
    'redskin','injun','squaw',
    // racial / ethnic slurs — anti-Jewish
    'kike','heeb','hymie','jewboy','sheeny',
    // racial / ethnic slurs — other
    'polack','polak',
    'gypo','gyp',
    'wop','dago',
    // gender / sexuality slurs
    'faggot','fag',
    'tranny','trannies','shemale','ladyboy','troon',
    'homo',
    'dyke',
    'lesbo',
    'poofter','poof',
    'fudgepacker',
    // disability slurs
    'retard','retarded',
    'spaz','spastic',
    'mongoloid',
    'cripple',
    // self-harm / threats
    'kys','kms',
    'kill yourself',
    'hang yourself',
    'shoot yourself',
    'slit your wrists',
    'end yourself',
    'noose',
    // extremist / hate group
    'sieg heil','heil hitler',
    'white power','white pride','white supremacy',
    '1488','14 words',
    // csam-adjacent
    'loli','lolita',
    'jailbait',
    'pedo','pedophile','paedophile',
    // nsfw
    'porn','porno','pornography',
    'hentai',
    'nude','nudes','nudepic',
    'sexting',
    'rape','raping','raped','rapist',
    'anal',
    'masturbate','masturbating','masturbation',
    'horny',
    'dildo',
    'bdsm',
    'xxx',
  ];
  function filterMsg(txt) {
    return _BANNED.reduce((s, w) =>
      s.replace(new RegExp(`\\b${w}s?\\b`, 'gi'), m => '*'.repeat(m.length)), txt);
  }

  // ---- tradeable items ----
  const TRADEABLE_GROUPS = [
    { group: 'Lesser Artifacts', items: [
      'Skyward Totem', 'Soul Dust', 'Memory Fragment', 'Phoenix Tear',
      'Lineage Shard', 'Resplendent Essence', 'Void Key', 'Echo Shard',
    ]},
    { group: 'Artifacts', items: [
      'Reality Watch', "Narthana's Sigil", 'Shifting Hourglass', "Metrom's Amulet",
      "Heaven's Authority", 'Darksigil', 'Stellian Core', 'Chaos Orb',
      "Arkhaia's Visage", 'Paranoxian Crux', 'Ancient Insignia',
    ]},
    { group: 'Weapon Modifiers', items: [
      'Arcanium Crystal', 'Tempurus Gem',
    ]},
    { group: 'Shards', items: [
      'Striking (R)', 'Striking (P)',
      'Shattering (R)', 'Shattering (P)',
      'Regenerative (R)', 'Regenerative (P)',
      'Voltaic (R)', 'Voltaic (P)',
      'Executing (R)', 'Executing (P)',
      'Reversing (R)', 'Reversing (P)',
      'Empowering (R)', 'Empowering (P)',
    ]},
    { group: 'Weapons — Ferrus', items: [
      'Ferrus Sword', 'Old Staff', 'Ferrus Dagger', 'Ferrus Cestus',
      'Ferrus Spear', 'Ferrus Axe', 'Ferrus Tenderizer',
    ]},
    { group: 'Weapons — Blacksteel', items: [
      'Blacksteel Sabre', 'Blacksteel Staff', 'Blacksteel Knife',
      'Blacksteel Claws', 'Blacksteel Spear', 'Blacksteel Axe', 'Greatsword',
    ]},
    { group: 'Weapons — Jade', items: [
      'Jade Broadsword', 'Jade Prayerstaff',
    ]},
    { group: 'Weapons — Corealloy', items: [
      'Corealloy Manadagger', 'Corealloy Manaclaws', 'Corealloy Manablade',
    ]},
    { group: 'Weapons — Dragon', items: [
      'Dragontooth Blade', 'Dragontooth Staff', 'Dragontooth Dagger',
      'Dragonbone Gauntlets', 'Dragonbone Spear', 'Dragonpyre Axe', 'Dragonbone Hammer',
    ]},
    { group: 'Weapons — Blight', items: [
      'Blightrock Sword', 'Blightwood Staff', 'Blightrock Dagger',
      'Blightrock Gauntlets', 'Blightrock Spear',
    ]},
    { group: 'Weapons — Sun', items: [
      'Sun Sword', 'Sun Staff', 'Sun Dagger', 'Sun Spear', 'Sun Greatsword',
    ]},
    { group: 'Weapons — Darkblood', items: [
      'Darkblood Sword', 'Darkblood Staff', 'Darkblood Dagger',
      'Darkblood Cestus', 'Darkblood Spear', 'Darkblood Hexer',
    ]},
    { group: 'Weapons — Sandstone', items: [
      'Sandstone Staff', 'Sandstone Dagger', 'Sandstone Gauntlets',
      'Sandstone Spear', 'Sandstone Hammer',
    ]},
    { group: 'Weapons — Primordial', items: [
      'Primordial Sword', 'Primordial Staff', 'Primordial Dagger',
      'Primordial Gauntlets', 'Primordial Spear', 'Primordial Axe', 'Primordial Hammer',
    ]},
    { group: 'Weapons — Icerind', items: [
      'Icerind Sword', 'Icerind Staff', 'Icerind Sai',
      'Icerind Cestus', 'Icerind Spear', 'Icerind Greatsword',
    ]},
    { group: 'Weapons — Ivory', items: [
      'Ivory Sword', 'Ivory Dagger', 'Ivory Spear',
      'Ivory Axe', 'Ivory Hammer', 'Ivory Greatsword',
    ]},
    { group: 'Weapons — Unique', items: [
      'Vastic Glaive', 'Star-Seeing Hammer',
    ]},
    { group: 'Shields', items: [
      'Targe', 'Ferrus Towershield', 'Dragonflame Shield', 'Slimy Buckler',
      'Icerind Shield', 'Sandstone Shield', 'Primordial Shield', 'Ivory Shield',
    ]},
    { group: 'Gear — Boss Drops', items: [
      'Gelat Band', 'Tear Blood Crystal', "Ptera's Heart", 'DeathBeak Dagger',
      'Blazing Perforator', "Yar'thul's Wrath", 'Frostburned Rune', 'Vow of Ruin',
      'Frozen Diadem', 'Imbuement Reliquary', 'Divine Promise', 'Focused Mind',
      'Aspect of Maladaptation', 'Tainted Quiver', 'Vainglorious Locket',
      'The Smallest Boulder', 'Eroded Blade', "Dust Devil's Eye", 'Open Hand',
    ]},
    { group: 'Gear — Forest', items: [
      '7 Leafed Everthistle', 'Shattered Clock Hand', 'The Biggest Pebble',
      'Arbusta Tear', 'Parasitic Leech', 'Spore Root', 'Forest Charm',
      'Elemental Infuser', 'Crystallized Star', 'Pathfinder Mark', 'Gilded Pouch',
    ]},
    { group: 'Gear — Desert', items: [
      'Crystal Sphere', 'Dust Storm', 'Golem Rune Core', 'Spiked Steel Ball',
      'Stone Brand', 'Ramizcan Idol', 'Band of Crushing Force', 'Grain Of Balance',
      "Madseer's Codex", 'Impure Crown', 'The Last Straw', 'Imbued Chains',
      'Delicate Purse', 'Desert Escutcheon',
    ]},
    { group: 'Gear — Deeproot', items: [
      'Cursed Brand', "Narthana's Leaf", 'Wicked Crown', 'Sanguine Fang',
      'Coagulated Finger Nail', 'Shard of Blight', "Traveler's Lamp",
      'Expedite Anklet', 'Phantom Ooze',
    ]},
    { group: 'Gear — Volcano', items: [
      'Imperial Headband', 'Magma Charm', 'Vulcan Knuckle',
      'Dragon Memoir', 'Blazing Brand', 'Molten Carapace',
    ]},
    { group: 'Gear — Easter', items: [
      'Rabbit Pelt', 'Egg Shelmet', 'Chocolate Egg',
      'Party Egg', 'Gleaming Carrot', "Rabbit's Foot",
    ]},
    { group: 'Gear — Winter Solstice', items: [
      'Snorb', 'Elementary Resonance', 'Frosty Topper',
    ]},
    { group: 'Gear — Other', items: [
      'Lethal Blackjack', 'Everbeating Drums',
    ]},
    { group: 'Ore', items: [
      'Aestic Ore', 'Ferrus Ore', 'Laneus Ore',
    ]},
    { group: 'Ingredients', items: [
      'Everthistle', 'Carnastool', 'Cryastem', 'Hightail', 'Driproot', 'Crylight',
      'Slime Chunk', 'Mushroom Cap', 'Sand Core', 'Restless Fragment', 'Haze Chunk', 'Rot Core',
    ]},
  ];
  // Flat list derived from groups (used for search filtering)
  const TRADEABLE_ITEMS = TRADEABLE_GROUPS.flatMap(g => g.items);

  // ---- state ----
  let _tradeTab      = 'selling';
  let _notifications = [];
  let _notifSub      = null;
  let _notifOpen     = false;
  let _cachedAvatar  = null;
  let _prevUid       = null;

  const CHAT_CONSENT_VERSION = '1.0';

  // DM state
  let _dmOpen     = false;
  let _dmView     = 'list'; // 'list' | 'thread'
  let _dmConvs    = [];
  let _dmThread   = [];
  let _dmWithId   = null;
  let _dmWithName = null;
  let _dmSub      = null;
  let _lastDmSend = 0; // rate limit: timestamp of last sent message

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

  let _allListings = [];

  function getSearchQuery() {
    const el = document.getElementById('trd-search');
    return el ? el.value.trim().toLowerCase() : '';
  }

  function applySearch() {
    const q = getSearchQuery();
    const hasAdv = _advFilters.items.length || _advFilters.lf_items.length;

    const filtered = _allListings.filter(l => {
      const itemNames = Array.isArray(l.items)    ? l.items.map(i => i.item)    : (l.item    ? [l.item]    : []);
      const lfNames   = Array.isArray(l.lf_items) ? l.lf_items.map(i => i.item) : (l.lf      ? [l.lf]      : []);

      // Text search
      if (q) {
        const goldAmounts = [
          ...(Array.isArray(l.items)    ? l.items.filter(i => i.item === 'Gold').map(i => String(i.quantity)) : []),
          ...(Array.isArray(l.lf_items) ? l.lf_items.filter(i => i.item === 'Gold').map(i => String(i.quantity)) : [])
        ];
        const haystack = [...itemNames, ...lfNames, ...goldAmounts, l.username || '', l.description || ''].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      // Advanced item filters (OR within each side, AND between sides)
      if (_advFilters.items.length) {
        const match = _advFilters.items.some(f => itemNames.some(n => n.toLowerCase() === f.toLowerCase()));
        if (!match) return false;
      }
      if (_advFilters.lf_items.length) {
        const match = _advFilters.lf_items.some(f => lfNames.some(n => n.toLowerCase() === f.toLowerCase()));
        if (!match) return false;
      }

      // Gold range filters
      const goldOffered = Array.isArray(l.items)    ? (l.items.find(i => i.item === 'Gold')?.quantity ?? 0)    : 0;
      const goldWanted  = Array.isArray(l.lf_items) ? (l.lf_items.find(i => i.item === 'Gold')?.quantity ?? 0) : 0;
      const _gmin = parseInt(_advFilters.gold_min, 10);
      const _gmax = parseInt(_advFilters.gold_max, 10);
      const _lgmin = parseInt(_advFilters.lf_gold_min, 10);
      const _lgmax = parseInt(_advFilters.lf_gold_max, 10);
      if (!isNaN(_gmin)  && goldOffered < _gmin)  return false;
      if (!isNaN(_gmax)  && goldOffered > _gmax)  return false;
      if (!isNaN(_lgmin) && goldWanted  < _lgmin) return false;
      if (!isNaN(_lgmax) && goldWanted  > _lgmax) return false;

      return true;
    });

    const label = [q, ..._advFilters.items, ..._advFilters.lf_items].filter(Boolean).join(', ');
    renderListings(filtered, label || null);
  }

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
      _allListings = data || [];
      applySearch();
    } catch (_) {
      el.innerHTML = '<div class="trd-state">Could not load listings — the trades table may not be set up yet.</div>';
    }
  }

  function renderListings(list, searchQuery) {
    const el = document.getElementById('trades-list');
    if (!el) return;
    const myId = uid();
    if (!list.length) {
      el.innerHTML = searchQuery
        ? `<div class="trd-state">No listings match "<strong>${esc(searchQuery)}</strong>".</div>`
        : `<div class="trd-state">No ${_tradeTab} listings yet. Be the first!</div>`;
      return;
    }
    const itemList = arr =>
      (Array.isArray(arr) && arr.length)
        ? arr.map(i => {
            const qty = i.quantity ?? 1;
            return i.item === 'Gold'
              ? `<div class="trd-card-item">🪙 <span class="trd-card-gold">${qty.toLocaleString()} Gold</span></div>`
              : `<div class="trd-card-item">${esc(i.item || '')}${qty > 1 ? ` <span class="trd-card-qty">×${qty}</span>` : ''}</div>`;
          }).join('')
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
          ${own ? `<div class="trd-own-actions">
            <button class="trd-edit-btn" onclick="window._trdEdit('${l.id}')" title="Edit">✎</button>
            <button class="trd-del-btn"  onclick="window._trdDelete('${l.id}')" title="Delete">✕</button>
          </div>` : ''}
        </div>
        <div class="trd-card-items">${itemsHtml}</div>
        ${lfHtml ? `<div class="trd-card-lf-block"><span class="${l.type === 'buying' ? 'trd-gv-label' : 'trd-lf-label'}">${l.type === 'buying' ? 'GV' : 'LF'}</span><div class="trd-card-items">${lfHtml}</div></div>` : ''}
        ${l.description?.trim() ? `<div class="trd-card-desc">${esc(l.description)}</div>` : ''}
        ${!own ? `<button class="trd-msg-btn" onclick="window._trdMessage('${esc(l.user_id)}','${esc(l.username)}','${esc((Array.isArray(l.items)&&l.items.length)?l.items[0].item:(l.item||'your listing'))}')">💬 Accept Offer</button>` : ''}
      </div>`;
    }).join('');
  }

  async function deleteListing(id) {
    if (!authed() || !confirm('Delete this listing?')) return;
    try { await sb.from('trade_listings').update({ status: 'cancelled' }).eq('id', id).eq('user_id', uid()); loadListings(); }
    catch (e) { console.error('[trades] delete error', e); }
  }

  // ---- edit listing ----
  function openEditModal(listingId) {
    if (!authed()) { window._openAuthModal?.('login'); return; }
    const listing = _allListings.find(l => l.id === listingId);
    if (!listing) return;
    if (document.getElementById('trd-post-modal')) return;
    const m = document.createElement('div');
    m.id        = 'trd-post-modal';
    m.className = 'trd-modal-overlay';
    m.innerHTML = `
      <div class="trd-modal" role="dialog" aria-modal="true">
        <div class="trd-modal-hdr">
          <span>Edit Listing</span>
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
          <div class="trd-form-row">
            <label class="trd-label">Items <span class="trd-req">*</span></label>
            <div id="trd-items-container">${itemRowHtml()}</div>
            <button class="trd-add-item-btn" type="button" onclick="window._trdAddItem('trd-items-container')">+ Add item</button>
            <div class="trd-gold-row">
              <span class="trd-gold-label">🪙 Gold</span>
              <input id="trd-gold-offer" class="trd-input trd-gold-input" type="number" min="0" max="50000" value="0" placeholder="0">
              <span class="trd-gold-hint">max 50,000</span>
            </div>
          </div>
          <div class="trd-form-row">
            <label class="trd-label" id="trd-lf-section-label">Looking For <span class="trd-req">*</span></label>
            <div id="trd-lf-container">${itemRowHtml()}</div>
            <button class="trd-add-item-btn" type="button" onclick="window._trdAddItem('trd-lf-container')">+ Add item</button>
            <div class="trd-gold-row">
              <span class="trd-gold-label">🪙 Gold</span>
              <input id="trd-gold-lf" class="trd-input trd-gold-input" type="number" min="0" max="50000" value="0" placeholder="0">
              <span class="trd-gold-hint">max 50,000</span>
            </div>
          </div>
          <div class="trd-form-row">
            <label class="trd-label">Notes</label>
            <textarea id="trd-post-desc" class="trd-input trd-textarea" placeholder="Optional details..." maxlength="300"></textarea>
          </div>
          <div id="trd-post-err" class="trd-form-err"></div>
          <button class="trd-submit-btn" onclick="window._trdSubmitEdit('${esc(listingId)}')">Save Changes</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) window._trdClosePost(); });
    m.querySelectorAll('.trd-pick-wrap').forEach(w => buildTrdItemPicker(w));
    _prefillEditModal(listing);
  }

  function _prefillEditModal(listing) {
    // Type
    const typeBtn = document.querySelector(`.trd-type-btn[data-ttype="${listing.type}"]`);
    if (typeBtn) typeSelect(typeBtn);

    const nonGoldItems = (listing.items    || []).filter(i => i.item !== 'Gold');
    const goldOffer    = (listing.items    || []).find(i => i.item === 'Gold')?.quantity || 0;
    const nonGoldLf    = (listing.lf_items || []).filter(i => i.item !== 'Gold');
    const goldLf       = (listing.lf_items || []).find(i => i.item === 'Gold')?.quantity || 0;

    function fillContainer(containerId, arr) {
      const container = document.getElementById(containerId);
      if (!container) return;
      arr.forEach((item, i) => {
        if (i > 0) {
          container.insertAdjacentHTML('beforeend', itemRowHtml());
          buildTrdItemPicker(container.lastElementChild.querySelector('.trd-pick-wrap'));
        }
        const row     = container.children[i];
        if (!row) return;
        const hidden  = row.querySelector('.trd-item-name');
        const display = row.querySelector('.trd-pick-display');
        const qty     = row.querySelector('.trd-item-qty');
        if (hidden)  hidden.value = item.item;
        if (display) { display.textContent = item.item; display.classList.add('trd-pick-has-value'); }
        if (qty)     qty.value = item.quantity || 1;
      });
    }

    fillContainer('trd-items-container', nonGoldItems);
    fillContainer('trd-lf-container', nonGoldLf);

    const goEl = document.getElementById('trd-gold-offer');
    if (goEl) goEl.value = goldOffer;
    const glEl = document.getElementById('trd-gold-lf');
    if (glEl) glEl.value = goldLf;

    const descEl = document.getElementById('trd-post-desc');
    if (descEl) descEl.value = listing.description || '';
  }

  async function submitEdit(listingId) {
    const desc   = document.getElementById('trd-post-desc')?.value.trim();
    const ttype  = document.querySelector('.trd-type-btn.active')?.dataset.ttype || 'selling';
    const errEl  = document.getElementById('trd-post-err');
    const goldOffer = Math.min(50000, Math.max(0, parseInt(document.getElementById('trd-gold-offer')?.value) || 0));
    const goldLf    = Math.min(50000, Math.max(0, parseInt(document.getElementById('trd-gold-lf')?.value)    || 0));
    const items    = collectRows('trd-items-container');
    const lf_items = collectRows('trd-lf-container');
    if (goldOffer > 0) items.unshift({ item: 'Gold', quantity: goldOffer });
    if (goldLf    > 0) lf_items.unshift({ item: 'Gold', quantity: goldLf });
    if (!items.length)    { if (errEl) errEl.textContent = 'Add at least one item or gold amount.'; return; }
    if (!lf_items.length) { if (errEl) errEl.textContent = 'Add at least one Looking For item or gold amount.'; return; }
    const bad = [...items, ...lf_items].find(i => i.item !== 'Gold' && !TRADEABLE_ITEMS.includes(i.item));
    if (bad) { if (errEl) errEl.textContent = `Invalid item: "${bad.item}"`; return; }
    if (desc && desc.length > 300) { if (errEl) errEl.textContent = 'Description must be 300 characters or fewer.'; return; }
    if (errEl) errEl.textContent = '';
    const btn = document.querySelector('.trd-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    try {
      const { error } = await sb.from('trade_listings')
        .update({ type: ttype, items, lf_items, description: desc || '' })
        .eq('id', listingId).eq('user_id', uid());
      if (error) throw error;
      closePostModal();
      loadListings();
    } catch (e) {
      if (errEl) errEl.textContent = e.message || 'Failed to save.';
      if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
    }
  }

  // ---- post listing modal ----
  function itemRowHtml() {
    return `<div class="trd-item-row">
      <div class="trd-pick-wrap">
        <input class="trd-item-name" type="hidden" value="">
        <div class="trd-pick-display">— Select item —</div>
        <div class="trd-pick-panel" style="display:none">
          <input class="trd-pick-search" type="text" placeholder="Search items..." autocomplete="off">
          <div class="trd-pick-list"></div>
        </div>
      </div>
      <input class="trd-input trd-item-qty" type="number" min="1" max="9999" value="1" title="Quantity">
      <button class="trd-item-row-del" type="button" onclick="window._trdRemoveItem(this)" title="Remove">×</button>
    </div>`;
  }

  function buildTrdItemPicker(wrap, modalId) {
    modalId = modalId || 'trd-post-modal';
    const hidden  = wrap.querySelector('.trd-item-name');
    const display = wrap.querySelector('.trd-pick-display');
    const panel   = wrap.querySelector('.trd-pick-panel');
    const search  = wrap.querySelector('.trd-pick-search');
    const list    = wrap.querySelector('.trd-pick-list');

    function makeItem(name) {
      const item = document.createElement('div');
      item.className = 'trd-pick-item' + (hidden.value === name ? ' trd-pick-selected' : '');
      item.textContent = name;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        hidden.value = name;
        display.textContent = name;
        display.classList.add('trd-pick-has-value');
        panel.style.display = 'none';
        search.value = '';
      });
      return item;
    }

    function buildList(q) {
      list.innerHTML = '';
      if (q) {
        const lq = q.toLowerCase();
        TRADEABLE_ITEMS
          .filter(name => name.toLowerCase().includes(lq))
          .forEach(name => list.appendChild(makeItem(name)));
      } else {
        TRADEABLE_GROUPS.forEach(({ group, items }) => {
          const hdr = document.createElement('div');
          hdr.className = 'trd-pick-group';
          hdr.textContent = group;
          list.appendChild(hdr);
          items.forEach(name => list.appendChild(makeItem(name)));
        });
      }
    }

    display.addEventListener('click', () => {
      const isOpen = panel.style.display !== 'none';
      document.querySelectorAll(`#${modalId} .trd-pick-panel`).forEach(p => { p.style.display = 'none'; });
      if (!isOpen) {
        panel.style.display = 'block';
        search.value = '';
        buildList('');
        search.focus();
      }
    });

    search.addEventListener('input', () => buildList(search.value));

    document.addEventListener('mousedown', function handler(e) {
      if (!wrap.contains(e.target)) panel.style.display = 'none';
      if (!document.getElementById(modalId)) document.removeEventListener('mousedown', handler);
    });
  }

  function addItemRow(containerId) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.insertAdjacentHTML('beforeend', itemRowHtml());
    buildTrdItemPicker(c.lastElementChild.querySelector('.trd-pick-wrap'));
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
          <div class="trd-form-row">
            <label class="trd-label">Items <span class="trd-req">*</span></label>
            <div id="trd-items-container">${itemRowHtml()}</div>
            <button class="trd-add-item-btn" type="button" onclick="window._trdAddItem('trd-items-container')">+ Add item</button>
            <div class="trd-gold-row">
              <span class="trd-gold-label">🪙 Gold</span>
              <input id="trd-gold-offer" class="trd-input trd-gold-input" type="number" min="0" max="50000" value="0" placeholder="0">
              <span class="trd-gold-hint">max 50,000</span>
            </div>
          </div>
          <div class="trd-form-row">
            <label class="trd-label" id="trd-lf-section-label">Looking For <span class="trd-req">*</span></label>
            <div id="trd-lf-container">${itemRowHtml()}</div>
            <button class="trd-add-item-btn" type="button" onclick="window._trdAddItem('trd-lf-container')">+ Add item</button>
            <div class="trd-gold-row">
              <span class="trd-gold-label">🪙 Gold</span>
              <input id="trd-gold-lf" class="trd-input trd-gold-input" type="number" min="0" max="50000" value="0" placeholder="0">
              <span class="trd-gold-hint">max 50,000</span>
            </div>
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
    m.querySelectorAll('.trd-pick-wrap').forEach(w => buildTrdItemPicker(w));
  }

  function closePostModal() { document.getElementById('trd-post-modal')?.remove(); }

  // ---- advanced search modal ----
  let _advFilters = { items: [], lf_items: [], gold_min: '', gold_max: '', lf_gold_min: '', lf_gold_max: '' };

  function advSearchRowHtml() {
    return `<div class="trd-item-row trd-adv-row">
      <div class="trd-pick-wrap">
        <input class="trd-item-name" type="hidden" value="">
        <div class="trd-pick-display">— Select item —</div>
        <div class="trd-pick-panel" style="display:none">
          <input class="trd-pick-search" type="text" placeholder="Search items..." autocomplete="off">
          <div class="trd-pick-list"></div>
        </div>
      </div>
      <button class="trd-item-row-del" type="button" onclick="window._trdAdvRemoveRow(this)" title="Remove">×</button>
    </div>`;
  }

  function addAdvSearchRow(containerId) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.insertAdjacentHTML('beforeend', advSearchRowHtml());
    buildTrdItemPicker(c.lastElementChild.querySelector('.trd-pick-wrap'), 'trd-advsearch-modal');
  }

  function removeAdvRow(btn) {
    const row = btn.closest('.trd-adv-row');
    const c   = row?.parentElement;
    if (!c) return;
    if (c.children.length <= 1) {
      // clear the selection instead of removing the last row
      const hidden  = row.querySelector('.trd-item-name');
      const display = row.querySelector('.trd-pick-display');
      if (hidden)  hidden.value = '';
      if (display) { display.textContent = '— Select item —'; display.classList.remove('trd-pick-has-value'); }
      return;
    }
    row.remove();
  }

  function collectAdvRows(containerId) {
    const out = [];
    document.querySelectorAll(`#${containerId} .trd-item-name`).forEach(el => {
      const v = el.value.trim();
      if (v) out.push(v);
    });
    return out;
  }

  function openAdvSearchModal() {
    if (document.getElementById('trd-advsearch-modal')) return;
    const m = document.createElement('div');
    m.id        = 'trd-advsearch-modal';
    m.className = 'trd-modal-overlay';
    m.innerHTML = `
      <div class="trd-modal" role="dialog" aria-modal="true">
        <div class="trd-modal-hdr">
          <span>Advanced Search</span>
          <button class="trd-modal-x" onclick="window._trdCloseAdvSearch()">✕</button>
        </div>
        <div class="trd-modal-body">
          <div class="trd-form-row">
            <label class="trd-label">Offering (items seller has)</label>
            <div id="trd-adv-items-container">${advSearchRowHtml()}</div>
            <button class="trd-add-item-btn" type="button" onclick="window._trdAdvAddRow('trd-adv-items-container')">+ Add item</button>
            <div class="trd-adv-gold-row">
              <span class="trd-gold-label">🪙 Gold offered</span>
              <input id="trd-adv-gold-min" class="trd-input trd-adv-gold-input" type="number" min="0" max="50000" placeholder="Min">
              <span class="trd-adv-gold-sep">–</span>
              <input id="trd-adv-gold-max" class="trd-input trd-adv-gold-input" type="number" min="0" max="50000" placeholder="Max">
            </div>
          </div>
          <div class="trd-form-row">
            <label class="trd-label">Looking For (items seller wants)</label>
            <div id="trd-adv-lf-container">${advSearchRowHtml()}</div>
            <button class="trd-add-item-btn" type="button" onclick="window._trdAdvAddRow('trd-adv-lf-container')">+ Add item</button>
            <div class="trd-adv-gold-row">
              <span class="trd-gold-label">🪙 Gold wanted</span>
              <input id="trd-adv-lf-gold-min" class="trd-input trd-adv-gold-input" type="number" min="0" max="50000" placeholder="Min">
              <span class="trd-adv-gold-sep">–</span>
              <input id="trd-adv-lf-gold-max" class="trd-input trd-adv-gold-input" type="number" min="0" max="50000" placeholder="Max">
            </div>
          </div>
          <div class="trd-adv-actions">
            <button class="trd-adv-clear-btn" onclick="window._trdAdvClear()">Clear</button>
            <button class="trd-submit-btn" onclick="window._trdAdvApply()">Apply Filter</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) window._trdCloseAdvSearch(); });
    m.querySelectorAll('.trd-pick-wrap').forEach(w => buildTrdItemPicker(w, 'trd-advsearch-modal'));
    // Pre-fill with existing filters
    if (_advFilters.items.length) {
      const ic = document.getElementById('trd-adv-items-container');
      _advFilters.items.forEach((name, i) => {
        if (i > 0) { ic.insertAdjacentHTML('beforeend', advSearchRowHtml()); buildTrdItemPicker(ic.lastElementChild.querySelector('.trd-pick-wrap'), 'trd-advsearch-modal'); }
        const row = ic.children[i];
        if (row) { row.querySelector('.trd-item-name').value = name; const d = row.querySelector('.trd-pick-display'); d.textContent = name; d.classList.add('trd-pick-has-value'); }
      });
    }
    if (_advFilters.lf_items.length) {
      const lc = document.getElementById('trd-adv-lf-container');
      _advFilters.lf_items.forEach((name, i) => {
        if (i > 0) { lc.insertAdjacentHTML('beforeend', advSearchRowHtml()); buildTrdItemPicker(lc.lastElementChild.querySelector('.trd-pick-wrap'), 'trd-advsearch-modal'); }
        const row = lc.children[i];
        if (row) { row.querySelector('.trd-item-name').value = name; const d = row.querySelector('.trd-pick-display'); d.textContent = name; d.classList.add('trd-pick-has-value'); }
      });
    }
    // Pre-fill gold ranges
    if (_advFilters.gold_min)    document.getElementById('trd-adv-gold-min').value    = _advFilters.gold_min;
    if (_advFilters.gold_max)    document.getElementById('trd-adv-gold-max').value    = _advFilters.gold_max;
    if (_advFilters.lf_gold_min) document.getElementById('trd-adv-lf-gold-min').value = _advFilters.lf_gold_min;
    if (_advFilters.lf_gold_max) document.getElementById('trd-adv-lf-gold-max').value = _advFilters.lf_gold_max;
  }

  function closeAdvSearchModal() { document.getElementById('trd-advsearch-modal')?.remove(); }

  function applyAdvFilter() {
    _advFilters.items       = collectAdvRows('trd-adv-items-container');
    _advFilters.lf_items    = collectAdvRows('trd-adv-lf-container');
    _advFilters.gold_min    = document.getElementById('trd-adv-gold-min')?.value.trim()    || '';
    _advFilters.gold_max    = document.getElementById('trd-adv-gold-max')?.value.trim()    || '';
    _advFilters.lf_gold_min = document.getElementById('trd-adv-lf-gold-min')?.value.trim() || '';
    _advFilters.lf_gold_max = document.getElementById('trd-adv-lf-gold-max')?.value.trim() || '';
    closeAdvSearchModal();
    applySearch();
    updateAdvSearchBtn();
  }

  function clearAdvFilter() {
    _advFilters = { items: [], lf_items: [], gold_min: '', gold_max: '', lf_gold_min: '', lf_gold_max: '' };
    closeAdvSearchModal();
    applySearch();
    updateAdvSearchBtn();
  }

  function updateAdvSearchBtn() {
    const btn = document.getElementById('trd-advsearch-btn');
    if (!btn) return;
    const active = _advFilters.items.length || _advFilters.lf_items.length || _advFilters.gold_min || _advFilters.gold_max || _advFilters.lf_gold_min || _advFilters.lf_gold_max;
    btn.classList.toggle('trd-advsearch-active', !!active);
    btn.title = active ? 'Advanced filter active — click to edit' : 'Advanced search';
  }

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

    const goldOffer = Math.min(50000, Math.max(0, parseInt(document.getElementById('trd-gold-offer')?.value) || 0));
    const goldLf    = Math.min(50000, Math.max(0, parseInt(document.getElementById('trd-gold-lf')?.value)    || 0));

    const items    = collectRows('trd-items-container');
    const lf_items = collectRows('trd-lf-container');

    if (goldOffer > 0) items.unshift({ item: 'Gold', quantity: goldOffer });
    if (goldLf    > 0) lf_items.unshift({ item: 'Gold', quantity: goldLf });

    if (!items.length)    { if (errEl) errEl.textContent = 'Add at least one item or gold amount.'; return; }
    if (!lf_items.length) { if (errEl) errEl.textContent = 'Add at least one Looking For item or gold amount.'; return; }
    const _invalidItem = [...items, ...lf_items].find(i => i.item !== 'Gold' && !TRADEABLE_ITEMS.includes(i.item));
    if (_invalidItem) { if (errEl) errEl.textContent = `Invalid item: "${_invalidItem.item}"`; return; }
    if (desc && desc.length > 300) { if (errEl) errEl.textContent = 'Description must be 300 characters or fewer.'; return; }
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

  async function checkChatConsent(onConsented) {
    if (!authed()) { window._openAuthModal?.('login'); return; }
    const { data } = await sb.from('profiles').select('chat_consent_version').eq('id', uid()).maybeSingle();
    if (data?.chat_consent_version === CHAT_CONSENT_VERSION) { onConsented(); return; }
    showChatConsentModal(onConsented);
  }

  function showChatConsentModal(onConsented) {
    if (document.getElementById('chat-consent-modal')) return;
    const el = document.createElement('div');
    el.id = 'chat-consent-modal';
    el.className = 'sb-delete-confirm-overlay';
    el.innerHTML = `
      <div class="sb-delete-confirm-box" style="max-width:420px">
        <h3 class="sb-delete-confirm-title" style="color:#aaaaee">Messaging Policy</h3>
        <p class="trd-disc-text" style="color:#999;font-size:13px;line-height:1.6;margin-bottom:10px">
          By using the messaging feature you agree to the following:
        </p>
        <ul style="color:#888;font-size:12px;line-height:1.8;margin:0 0 12px;padding-left:18px">
          <li>All messages are monitored for safety and appropriate use of this platform.</li>
          <li>Messages must remain respectful — harassment, spam, or abuse will result in account termination.</li>
          <li>Message history is retained for moderation purposes.</li>
          <li>Messages from terminated accounts are permanently deleted after <strong style="color:#ccc">12 months</strong>.</li>
          <li>You may withdraw consent at any time via your account settings, which will disable messaging.</li>
        </ul>
        <p style="font-size:11px;color:#555;margin-bottom:4px">
          By clicking "I Agree" you acknowledge you have read our
          <a href="privacy.html" target="_blank" rel="noopener" style="color:#7777cc">Privacy Policy</a> and
          <a href="terms.html" target="_blank" rel="noopener" style="color:#7777cc">Terms and Conditions</a>.
        </p>
        <div id="chat-consent-err" style="color:#ff8888;font-size:12px;min-height:14px"></div>
        <div class="sb-delete-confirm-actions" style="margin-top:10px">
          <button class="auth-btn" style="flex:1" onclick="window._grantChatConsent()">Accept</button>
          <button class="auth-btn auth-btn-reject" style="flex:1" onclick="document.getElementById('chat-consent-modal').remove()">Reject</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    window._pendingConsentCallback = onConsented;
  }

  async function grantChatConsent() {
    const { error } = await sb.from('profiles').update({
      chat_consent_at: new Date().toISOString(),
      chat_consent_version: CHAT_CONSENT_VERSION,
    }).eq('id', uid());
    if (error) {
      const errEl = document.getElementById('chat-consent-err');
      if (errEl) errEl.textContent = 'Failed to save consent. Please try again.';
      return;
    }
    document.getElementById('chat-consent-modal')?.remove();
    window._pendingConsentCallback?.();
    window._pendingConsentCallback = null;
  }

  async function withdrawChatConsent() {
    const { error } = await sb.from('profiles').update({
      chat_consent_at: null,
      chat_consent_version: null,
    }).eq('id', uid());
    if (error) { console.warn('[consent] withdraw failed:', error.message); return; }
    const statusEl = document.getElementById('sb-consent-status');
    if (statusEl) statusEl.innerHTML = `<span style="color:#888">Not consented — messaging disabled.</span>
      <button class="sb-consent-grant-btn" onclick="window._showConsentFromSettings()">Give Consent</button>`;
  }

  function toggleDm() {
    if (!authed()) { window._openAuthModal?.('login'); return; }
    checkChatConsent(() => {
      _dmOpen = !_dmOpen;
      const panel = document.getElementById('dm-panel');
      if (!panel) return;
      if (_dmOpen) {
        panel.style.display = 'flex';
        if (_dmView === 'list') loadConvList();
        else renderThread();
      } else {
        panel.style.display = 'none';
      }
    });
  }

  async function loadConvList() {
    const body = document.getElementById('dm-body');
    if (!body) return;
    body.innerHTML = '<div class="dm-state">Loading...</div>';
    const id = uid(); if (!id) return;
    try {
      const [{ data: sent }, { data: recv }] = await Promise.all([
        sb.from('direct_messages').select('*').eq('sender_id', id).not('deleted_for', 'cs', `["${id}"]`).order('created_at', { ascending: false }).limit(100),
        sb.from('direct_messages').select('*').eq('recipient_id', id).not('deleted_for', 'cs', `["${id}"]`).order('created_at', { ascending: false }).limit(100),
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
          convMap.set(otherId, { other_id: otherId, other_name: otherName, other_avatar: otherAvatar, last_msg: m.content || '', last_time: m.created_at, unread: 0 });
        }
        if (!isMe && !m.read) convMap.get(otherId).unread++;
      }
      _dmConvs = [...convMap.values()];
      renderConvList();
    } catch (_) {
      if (body) body.innerHTML = '<div class="dm-state">Could not load messages.</div>';
    }
  }

  async function deleteConversation(otherId) {
    if (!authed()) return;
    const me = uid();
    if (!confirm('Delete this conversation? It will be hidden from your view.')) return;
    // Soft-delete: append this user's ID to deleted_for on every message in the conversation.
    // Messages remain in the DB for moderation; they just won't appear for this user.
    const { error } = await sb.rpc('soft_delete_conversation', { p_me: me, p_other: otherId });
    if (error) { console.warn('[dm] soft delete error:', error.message); return; }
    _dmConvs = _dmConvs.filter(c => c.other_id !== otherId);
    renderConvList();
    syncMsgBadge();
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

    const partyEntry = window._partyGetConvEntry?.();
    const partyHtml = partyEntry ? `
      <div class="dm-conv-item dm-conv-party" onclick="window._partyOpenFromMessages?.()">
        <div class="dm-party-icon">⚔️</div>
        <div class="dm-conv-info">
          <div class="dm-conv-name">Party Chat</div>
          <div class="dm-conv-preview">${esc(partyEntry.boss)}</div>
        </div>
        <div class="dm-conv-right">
          <div class="dm-conv-time" style="color:#66bb6a">active</div>
        </div>
      </div>` : '';

    if (!_dmConvs.length && !partyHtml) {
      body.innerHTML = '<div class="dm-state">No messages yet.<br>Message someone from a trade listing.</div>';
      return;
    }
    body.innerHTML = partyHtml + _dmConvs.map(c => `
      <div class="dm-conv-item" onclick="window._dmOpenThread('${esc(c.other_id)}','${esc(c.other_name)}')">
        ${mkAvatar(c.other_name, c.other_avatar, 36)}
        <div class="dm-conv-info">
          <div class="dm-conv-name">${esc(c.other_name)}</div>
          <div class="dm-conv-preview">${esc(c.last_msg.slice(0, 55))}${c.last_msg.length > 55 ? '…' : ''}</div>
        </div>
        <div class="dm-conv-right">
          <div class="dm-conv-time">${timeAgo(c.last_time)}</div>
          ${c.unread > 0 ? `<div class="dm-conv-unread">${c.unread}</div>` : ''}
          <button class="dm-conv-del" title="Delete conversation" onclick="event.stopPropagation();window._dmDeleteConv('${esc(c.other_id)}')">&#128465;</button>
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
    if (title) title.textContent = 'Messages';
    const backBtn = document.getElementById('dm-back-btn');
    if (backBtn) backBtn.style.display = '';
    const footer = document.getElementById('dm-footer');
    if (footer) footer.style.display = 'flex';

    // Context strip
    const ctx = document.getElementById('dm-thread-ctx');
    if (ctx) {
      ctx.style.display = 'flex';
      ctx.innerHTML = `${mkAvatar(otherName, null, 32)}<div class="dm-ctx-info"><span class="dm-ctx-label">Trading with</span><span class="dm-ctx-name">${esc(otherName)}</span></div>`;
    }

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
    const ctx = document.getElementById('dm-thread-ctx');
    if (ctx) ctx.style.display = 'none';
    loadConvList();
  }

  async function loadThread(otherId) {
    const id = uid(); if (!id) return;
    try {
      const [{ data: sent }, { data: recv }] = await Promise.all([
        sb.from('direct_messages').select('*').eq('sender_id', id).eq('recipient_id', otherId).not('deleted_for', 'cs', `["${id}"]`).order('created_at', { ascending: true }),
        sb.from('direct_messages').select('*').eq('sender_id', otherId).eq('recipient_id', id).not('deleted_for', 'cs', `["${id}"]`).order('created_at', { ascending: true }),
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
      <div class="dm-bubble">${esc(filterMsg(m.content))}<span class="dm-bubble-time">${timeAgo(m.created_at)}</span></div>
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
              // Refresh the conv list live so unread counts + previews update without reopening
              if (_dmOpen && _dmView === 'list') loadConvList();
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
    const now = Date.now();
    if (now - _lastDmSend < 1000) return; // max 1 message per second
    const inp = document.getElementById('dm-input');
    const txt = inp?.value.trim();
    if (!txt || !_dmWithId || !_dmWithName) return;
    if (txt.length > 500) { inp.value = txt.slice(0, 500); return; } // enforce cap in code too
    const id = uid(), name = uname();
    if (!id || !name) return;
    _lastDmSend = now;
    const avatar_url = await myAvatar();
    const filtered = filterMsg(txt).slice(0, 500); // double-enforce before insert
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
      <div class="notif-item${n.read ? '' : ' notif-new'}" data-nid="${esc(n.id)}">
        <div class="notif-item-title">${esc(n.title)}</div>
        ${n.body ? `<div class="notif-item-body">${esc(n.body)}</div>` : ''}
        ${window._notifExtra ? window._notifExtra(n) : ''}
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
  //  AUTH SYNC
  // ============================================================

  function checkAuth() {
    const id = uid();
    if (id === _prevUid) return;
    _prevUid = id;

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
      btn.addEventListener('click', () => {
        const searchEl = document.getElementById('trd-search');
        if (searchEl) searchEl.value = '';
        switchTab(btn.dataset.ttab);
      });
    });

    const searchEl = document.getElementById('trd-search');
    if (searchEl) searchEl.addEventListener('input', applySearch);

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
    });
  }

  window.addEventListener('DOMContentLoaded', init);

  // ============================================================
  //  GLOBALS
  // ============================================================
  window._trdLoad          = loadListings;
  window._trdPost          = openPostModal;
  window._trdClosePost     = closePostModal;
  window._trdTypeSelect    = typeSelect;
  window._trdSubmit        = submitPost;
  window._trdDelete        = deleteListing;
  window._trdEdit          = openEditModal;
  window._trdSubmitEdit    = submitEdit;
  window._trdAddItem       = addItemRow;
  window._trdRemoveItem    = removeItemRow;
  window._trdAdvSearch     = openAdvSearchModal;
  window._trdCloseAdvSearch= closeAdvSearchModal;
  window._trdAdvApply      = applyAdvFilter;
  window._trdAdvClear      = clearAdvFilter;
  window._trdAdvAddRow     = addAdvSearchRow;
  window._trdAdvRemoveRow  = removeAdvRow;
  window._trdMessage    = function (userId, username, itemName) {
    if (!authed()) { window._openAuthModal?.('login'); return; }
    checkChatConsent(() => _trdMessageInner(userId, username, itemName));
  };
  async function _trdMessageInner(userId, username, itemName) {
    // Send acceptance notification to the listing owner (skip for null/self)
    const myName = uname();
    if (myName && userId && userId !== uid()) {
      const { error: nErr } = await sb.from('notifications').insert({
        user_id: userId,
        title:   `${myName} accepted your offer!`,
        body:    `${myName} wants to trade for: ${itemName}`,
      });
      if (nErr) console.warn('[trades] notification insert failed:', nErr.message);
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
  }
  window._grantChatConsent    = grantChatConsent;
  window._withdrawChatConsent = withdrawChatConsent;
  window._showChatConsentModal = showChatConsentModal;
  window._toggleDm      = toggleDm;
  window._dmOpenThread  = openThread;
  window._dmBack        = backToConvs;
  window._dmDeleteConv  = deleteConversation;
  window._dmSend        = sendDm;
  window._toggleNotifs  = toggleNotifs;
  window._syncNotifBell = syncBell;
  window._syncMsgBadge  = syncMsgBadge;
  window._trdGetNotifs     = () => _notifications;
  window._trdRenderNotifs  = renderNotifList;
  window._trdRenderConvList = renderConvList;
})();
