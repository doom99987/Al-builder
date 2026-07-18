/* ============================================================================
   bank.js — Bank feature (profile menu → Bank)

   Tracker-style modal with nameable tabs ("slots"). Each slot stores a list of
   { name, qty } entries. The item pool is the bank's own static BANK_ITEMS
   list below — a de-duplicated combination of the trades pool, builder item
   collections, and encyclopedia items, kept independent of those sources.

   Persistence: localStorage 'al-bank' — { tabs:[{id,name,data}], activeTab }
   (same shape as the trackers). A pool snapshot is written to 'al-bank-pool'
   so the standalone popout (html/bank-popup.html) can render without loading
   builder.js/trades.js. Windows sync via 'storage' events.

   Exposes: _bankOpen/_bankClose/_bankPopout/_bankAdd/_bankCopy
   ============================================================================ */
(function () {
  'use strict';

  const BK_KEY      = 'al-bank';
  const BK_POOL_KEY = 'al-bank-pool';
  let _bkDoc = document;      // kept as indirection for future PiP/overlay support
  let bkFilter = 'all';       // 'all' | 'tradable' — per-window, not persisted
  let _bkPool = null;

  /* ── storage helpers (same pattern as the trackers) ─────────────────────── */
  function bkGetMeta() {
    try {
      const raw = JSON.parse(localStorage.getItem(BK_KEY));
      if (raw && Array.isArray(raw.tabs)) return raw;
      return { tabs: [{ id: 'bk1', name: 'Slot 1', data: {} }], activeTab: 'bk1' };
    } catch {
      return { tabs: [{ id: 'bk1', name: 'Slot 1', data: {} }], activeTab: 'bk1' };
    }
  }
  function bkSaveMeta(meta)  { localStorage.setItem(BK_KEY, JSON.stringify(meta)); bkScheduleSync(); }
  function bkNewId()         { return 'bk' + Date.now(); }
  function bkActiveTab(meta) {
    if (!Array.isArray(meta.tabs) || !meta.tabs.length) meta.tabs = [{ id: 'bk1', name: 'Slot 1', data: {} }];
    const tab = meta.tabs.find(t => t.id === meta.activeTab) || meta.tabs[0];
    if (!tab.data || typeof tab.data !== 'object') tab.data = {};
    return tab;
  }
  function bkGetData(meta)   { const d = bkActiveTab(meta).data; if (!Array.isArray(d.items)) d.items = []; return d; }
  function bkSetData(meta, d){ bkActiveTab(meta).data = d; }

  /* ── item pool ──────────────────────────────────────────────────────────── */
  // Bank-specific combined item list: [name, category, tradable].
  // Generated once from the trades pool + builder collections + encyclopedia
  // items, then de-duplicated and curated by hand. Deliberately independent of
  // those sources so the Bank never affects (or is broken by) the other lists.
  const BANK_ITEMS = [
    // ── Lesser Artifacts ──
    ['Skyward Totem', 'Lesser Artifacts', 1],
    ['Soul Dust', 'Lesser Artifacts', 1],
    ['Memory Fragment', 'Lesser Artifacts', 1],
    ['Phoenix Tear', 'Lesser Artifacts', 1],
    ['Lineage Shard', 'Lesser Artifacts', 1],
    ['Resplendent Essence', 'Lesser Artifacts', 1],
    ['Void Key', 'Lesser Artifacts', 1],
    ['Echo Shard', 'Lesser Artifacts', 1],
    // ── Artifacts ──
    ['Reality Watch', 'Artifacts', 1],
    ["Narthana's Sigil", 'Artifacts', 1],
    ['Shifting Hourglass', 'Artifacts', 1],
    ["Metrom's Amulet", 'Artifacts', 1],
    ["Heaven's Authority", 'Artifacts', 1],
    ['Darksigil', 'Artifacts', 1],
    ['Stellian Core', 'Artifacts', 1],
    ['Chaos Orb', 'Artifacts', 1],
    ["Arkhaia's Visage", 'Artifacts', 1],
    ['Paranoxian Crux', 'Artifacts', 1],
    ['Ancient Insignia', 'Artifacts', 1],
    ['Celestial Emblem', 'Artifacts', 0],
    // ── Weapon Modifiers ──
    ['Arcanium Crystal', 'Weapon Modifiers', 1],
    ['Tempurus Gem', 'Weapon Modifiers', 1],
    // ── Shards ──
    ['Striking (R)', 'Shards', 1],
    ['Striking (P)', 'Shards', 1],
    ['Shattering (R)', 'Shards', 1],
    ['Shattering (P)', 'Shards', 1],
    ['Regenerative (R)', 'Shards', 1],
    ['Regenerative (P)', 'Shards', 1],
    ['Voltaic (R)', 'Shards', 1],
    ['Voltaic (P)', 'Shards', 1],
    ['Executing (R)', 'Shards', 1],
    ['Executing (P)', 'Shards', 1],
    ['Reversing (R)', 'Shards', 1],
    ['Reversing (P)', 'Shards', 1],
    ['Empowering (R)', 'Shards', 1],
    ['Empowering (P)', 'Shards', 1],
    ['Striking Shard', 'Shards', 0],
    ['Shattering Shard', 'Shards', 0],
    ['Regenerative Shard', 'Shards', 0],
    ['Voltaic Shard', 'Shards', 0],
    ['Executing Shard', 'Shards', 0],
    ['Reversing Shard', 'Shards', 0],
    ['Empowering Shard', 'Shards', 0],
    // ── Weapons ──
    ['Ferrus Sword', 'Weapons', 1],
    ['Old Staff', 'Weapons', 1],
    ['Ferrus Dagger', 'Weapons', 1],
    ['Ferrus Cestus', 'Weapons', 1],
    ['Ferrus Spear', 'Weapons', 1],
    ['Ferrus Axe', 'Weapons', 1],
    ['Ferrus Tenderizer', 'Weapons', 1],
    ['Blacksteel Sabre', 'Weapons', 1],
    ['Blacksteel Staff', 'Weapons', 1],
    ['Blacksteel Knife', 'Weapons', 1],
    ['Blacksteel Claws', 'Weapons', 1],
    ['Blacksteel Spear', 'Weapons', 1],
    ['Blacksteel Axe', 'Weapons', 1],
    ['Greatsword', 'Weapons', 1],
    ['Jade Broadsword', 'Weapons', 1],
    ['Jade Prayerstaff', 'Weapons', 1],
    ['Corealloy Manadagger', 'Weapons', 1],
    ['Corealloy Manaclaws', 'Weapons', 1],
    ['Corealloy Manablade', 'Weapons', 1],
    ['Dragontooth Blade', 'Weapons', 1],
    ['Dragontooth Staff', 'Weapons', 1],
    ['Dragontooth Dagger', 'Weapons', 1],
    ['Dragonbone Gauntlets', 'Weapons', 1],
    ['Dragonbone Spear', 'Weapons', 1],
    ['Dragonpyre Axe', 'Weapons', 1],
    ['Dragonbone Hammer', 'Weapons', 1],
    ['Blightrock Sword', 'Weapons', 1],
    ['Blightwood Staff', 'Weapons', 1],
    ['Blightrock Dagger', 'Weapons', 1],
    ['Blightrock Gauntlets', 'Weapons', 1],
    ['Blightrock Spear', 'Weapons', 1],
    ['Sun Sword', 'Weapons', 1],
    ['Sun Staff', 'Weapons', 1],
    ['Sun Dagger', 'Weapons', 1],
    ['Sun Spear', 'Weapons', 1],
    ['Sun Greatsword', 'Weapons', 1],
    ['Sun Hammer (visage)', 'Weapons', 0],
    ['Darkblood Sword', 'Weapons', 1],
    ['Darkblood Staff', 'Weapons', 1],
    ['Darkblood Dagger', 'Weapons', 1],
    ['Darkblood Cestus', 'Weapons', 1],
    ['Darkblood Spear', 'Weapons', 1],
    ['Darkblood Hexer', 'Weapons', 1],
    ['Darkblood Greatsword', 'Weapons', 0],
    ['Sandstone Staff', 'Weapons', 1],
    ['Sandstone Dagger', 'Weapons', 1],
    ['Sandstone Gauntlets', 'Weapons', 1],
    ['Sandstone Spear', 'Weapons', 1],
    ['Sandstone Hammer', 'Weapons', 1],
    ['Sandstone Cestus', 'Weapons', 0],
    ['Primordial Sword', 'Weapons', 1],
    ['Primordial Staff', 'Weapons', 1],
    ['Primordial Dagger', 'Weapons', 1],
    ['Primordial Gauntlets', 'Weapons', 1],
    ['Primordial Spear', 'Weapons', 1],
    ['Primordial Axe', 'Weapons', 1],
    ['Primordial Hammer', 'Weapons', 1],
    ['Primordial Greatsword', 'Weapons', 0],
    ['Primordial Cestus', 'Weapons', 0],
    ['Icerind Sword', 'Weapons', 1],
    ['Icerind Staff', 'Weapons', 1],
    ['Icerind Sai', 'Weapons', 1],
    ['Icerind Cestus', 'Weapons', 1],
    ['Icerind Spear', 'Weapons', 1],
    ['Icerind Greatsword', 'Weapons', 1],
    ['Icerind Dagger', 'Weapons', 0],
    ['Ivory Sword', 'Weapons', 1],
    ['Ivory Dagger', 'Weapons', 1],
    ['Ivory Spear', 'Weapons', 1],
    ['Ivory Axe', 'Weapons', 1],
    ['Ivory Hammer', 'Weapons', 1],
    ['Ivory Greatsword', 'Weapons', 1],
    ['Ivory Cestus', 'Weapons', 0],
    ['Ivory Staff', 'Weapons', 0],
    ['Vastic Glaive', 'Weapons', 1],
    ['Star-Seeing Hammer', 'Weapons', 1],
    // ── Shields ──
    ['Targe', 'Shields', 1],
    ['Ferrus Towershield', 'Shields', 1],
    ['Dragonflame Shield', 'Shields', 1],
    ['Slimy Buckler', 'Shields', 1],
    ['Icerind Shield', 'Shields', 1],
    ['Sandstone Shield', 'Shields', 1],
    ['Primordial Shield', 'Shields', 1],
    ['Ivory Shield', 'Shields', 1],
    // ── Gear ──
    ['Gelat Band', 'Gear', 1],
    ['Tear Blood Crystal', 'Gear', 1],
    ["Ptera's Heart", 'Gear', 1],
    ['DeathBeak Dagger', 'Gear', 1],
    ['Blazing Perforator', 'Gear', 1],
    ["Yar'thul's Wrath", 'Gear', 1],
    ['Frostburned Rune', 'Gear', 1],
    ['Vow of Ruin', 'Gear', 1],
    ['Frozen Diadem', 'Gear', 1],
    ['Imbuement Reliquary', 'Gear', 1],
    ['Divine Promise', 'Gear', 1],
    ['Focused Mind', 'Gear', 1],
    ['Aspect of Maladaptation', 'Gear', 1],
    ['Tainted Quiver', 'Gear', 1],
    ['Vainglorious Locket', 'Gear', 1],
    ['The Smallest Boulder', 'Gear', 1],
    ['Eroded Blade', 'Gear', 1],
    ["Dust Devil's Eye", 'Gear', 1],
    ['Open Hand', 'Gear', 1],
    ['7 Leafed Everthistle', 'Gear', 1],
    ['Shattered Clock Hand', 'Gear', 1],
    ['The Biggest Pebble', 'Gear', 1],
    ['Arbusta Tear', 'Gear', 1],
    ['Parasitic Leech', 'Gear', 1],
    ['Spore Root', 'Gear', 1],
    ['Forest Charm', 'Gear', 1],
    ['Elemental Infuser', 'Gear', 1],
    ['Crystallized Star', 'Gear', 1],
    ['Pathfinder Mark', 'Gear', 1],
    ['Gilded Pouch', 'Gear', 1],
    ['Crystal Sphere', 'Gear', 1],
    ['Dust Storm', 'Gear', 1],
    ['Golem Rune Core', 'Gear', 1],
    ['Spiked Steel Ball', 'Gear', 1],
    ['Stone Brand', 'Gear', 1],
    ['Ramizcan Idol', 'Gear', 1],
    ['Band of Crushing Force', 'Gear', 1],
    ['Grain Of Balance', 'Gear', 1],
    ["Madseer's Codex", 'Gear', 1],
    ['Impure Crown', 'Gear', 1],
    ['The Last Straw', 'Gear', 1],
    ['Imbued Chains', 'Gear', 1],
    ['Delicate Purse', 'Gear', 1],
    ['Desert Escutcheon', 'Gear', 1],
    ['Cursed Brand', 'Gear', 1],
    ["Narthana's Leaf", 'Gear', 1],
    ['Wicked Crown', 'Gear', 1],
    ['Sanguine Fang', 'Gear', 1],
    ['Coagulated Finger Nail', 'Gear', 1],
    ['Shard of Blight', 'Gear', 1],
    ["Traveler's Lamp", 'Gear', 1],
    ['Expedite Anklet', 'Gear', 1],
    ['Phantom Ooze', 'Gear', 1],
    ['Imperial Headband', 'Gear', 1],
    ['Magma Charm', 'Gear', 1],
    ['Vulcan Knuckle', 'Gear', 1],
    ['Dragon Memoir', 'Gear', 1],
    ['Blazing Brand', 'Gear', 1],
    ['Molten Carapace', 'Gear', 1],
    ['Rabbit Pelt', 'Gear', 1],
    ['Egg Shelmet', 'Gear', 1],
    ['Chocolate Egg', 'Gear', 1],
    ['Party Egg', 'Gear', 1],
    ['Gleaming Carrot', 'Gear', 1],
    ["Rabbit's Foot", 'Gear', 1],
    ['Snorb', 'Gear', 1],
    ['Elementary Resonance', 'Gear', 1],
    ['Frosty Topper', 'Gear', 1],
    ['Lethal Blackjack', 'Gear', 1],
    ['Everbeating Drums', 'Gear', 1],
    // ── Armour ──
    ['Paladin Cuirass', 'Armour', 0],
    ['Adept Warrior', 'Armour', 0],
    ['Raging Warrior', 'Armour', 0],
    ['Arcane Robes', 'Armour', 0],
    ['Magister Apprentice', 'Armour', 0],
    ['Corrupt Caster', 'Armour', 0],
    ['Lifebound Archer', 'Armour', 0],
    ['Rogue Hunter', 'Armour', 0],
    ['Shadow Cloak', 'Armour', 0],
    ['Traveling Pasmark', 'Armour', 0],
    ['Wandering Practitioner', 'Armour', 0],
    ['Shade Walker', 'Armour', 0],
    ['Pathfinder Martyr', 'Armour', 0],
    ['Armored Lancer', 'Armour', 0],
    ['Bloody Menace', 'Armour', 0],
    ['Venerated Legionnaire', 'Armour', 0],
    ['Fortified Seer', 'Armour', 0],
    ['Deathmantle', 'Armour', 0],
    ['Shadowy Crook', 'Armour', 0],
    ['Budding Mage', 'Armour', 0],
    ['Chainmail Guard', 'Armour', 0],
    ['Explorer', 'Armour', 0],
    ['Nobleman', 'Armour', 0],
    ['Trapper', 'Armour', 0],
    ['Wandering Scoundrel', 'Armour', 0],
    ['Wayfarer', 'Armour', 0],
    // ── Enchants ──
    ['Cursed', 'Enchants', 0],
    ['Blessed', 'Enchants', 0],
    ['Inferno', 'Enchants', 0],
    ['Midas', 'Enchants', 0],
    ['Reaper', 'Enchants', 0],
    ['Lifesong', 'Enchants', 0],
    ['Spectral', 'Enchants', 0],
    ['Hiemal', 'Enchants', 0],
    ['Frosted', 'Enchants', 0],
    ['Ivory', 'Enchants', 0],
    ['Storm (mod)', 'Enchants', 0],
    ['Frost Burn (mod)', 'Enchants', 0],
    // ── Marks ──
    ['Venia', 'Marks', 0],
    ['Astra', 'Marks', 0],
    ['Petent', 'Marks', 0],
    // ── Scrolls ──
    ['Lights Out', 'Scrolls', 0],
    ['Bulk Up', 'Scrolls', 0],
    ['Immolation', 'Scrolls', 0],
    ['Steel Body', 'Scrolls', 0],
    ['Self Cure', 'Scrolls', 0],
    ['Lesser Absorb', 'Scrolls', 0],
    ['Lesser Empower', 'Scrolls', 0],
    ['Torching Soul', 'Scrolls', 0],
    ['Surprise Package', 'Scrolls', 0],
    ['Simple Curse', 'Scrolls', 0],
    ['Ice Shards', 'Scrolls', 0],
    ['Wind Reflect', 'Scrolls', 0],
    ['Dark Slash', 'Scrolls', 0],
    ['Fireball', 'Scrolls', 0],
    ['Blizzard', 'Scrolls', 0],
    ['Battleworn', 'Scrolls', 0],
    // ── Lost Scrolls ──
    ["Metrom's Grasp", 'Lost Scrolls', 0],
    ['Absolute Radiance', 'Lost Scrolls', 0],
    ['Heavenly Prayer', 'Lost Scrolls', 0],
    ['Breath of Fungyir', 'Lost Scrolls', 0],
    ['Permafrost Curse', 'Lost Scrolls', 0],
    ['Wild Impulse', 'Lost Scrolls', 0],
    // ── Ore ──
    ['Aestic Ore', 'Ore', 1],
    ['Ferrus Ore', 'Ore', 1],
    ['Laneus Ore', 'Ore', 1],
    // ── Ingredients ──
    ['Everthistle', 'Ingredients', 1],
    ['Carnastool', 'Ingredients', 1],
    ['Cryastem', 'Ingredients', 1],
    ['Hightail', 'Ingredients', 1],
    ['Driproot', 'Ingredients', 1],
    ['Crylight', 'Ingredients', 1],
    ['Slime Chunk', 'Ingredients', 1],
    ['Mushroom Cap', 'Ingredients', 1],
    ['Sand Core', 'Ingredients', 1],
    ['Restless Fragment', 'Ingredients', 1],
    ['Haze Chunk', 'Ingredients', 1],
    ['Rot Core', 'Ingredients', 1],
    // ── Potions ──
    ['Small Healing Potion', 'Potions', 0],
    ['Medium Healing Potion', 'Potions', 0],
    ['Minor Absorbing Potion', 'Potions', 0],
    ['Ferrus Skin Potion', 'Potions', 0],
    ['Minor Empowering Elixir', 'Potions', 0],
    ['Minor Energy Elixir', 'Potions', 0],
    ['Average Energy Elixir', 'Potions', 0],
    ['Stimulating Brew', 'Potions', 0],
    ['Energetic SoulBrew', 'Potions', 0],
    ['Invisibility Potion', 'Potions', 0],
    ['Rejuvenating Elixir', 'Potions', 0],
    ['Stoneskin Potion', 'Potions', 0],
    ['Light of Grace', 'Potions', 0],
    ['Abhorrent Elixir', 'Potions', 0],
    ['Alluring Elixir', 'Potions', 0],
    ['Heartbreaking Elixir', 'Potions', 0],
    ['Heartsoothing Remedy', 'Potions', 0],
    ['Radiance Elixir', 'Potions', 0],
    // ── Misc ──
    ['Pickaxe', 'Misc', 0],
    ['Starslime Chunk', 'Misc', 0],
    ['Astral Shards', 'Misc', 0],
    ['Old Runic Bolt', 'Misc', 0],
    ['Mossy Rune', 'Misc', 0],
    ["Arkhaia's Curse", 'Misc', 0],
    ["Raphion's Blessing", 'Misc', 0],
    ['Forgotten Relic', 'Misc', 0],
    ['Warbing Whistle', 'Misc', 0],
    ['Unopened Present (unobtainable)', 'Misc', 0],
    ['Egg Basket', 'Misc', 0],
  ];

  function bkBuildPool() {
    if (_bkPool) return _bkPool;
    const items = BANK_ITEMS.map(([name, category, tradable]) => ({ name, category, tradable: !!tradable }));
    const categories = [];
    const seen = new Set();
    items.forEach(i => { if (!seen.has(i.category)) { seen.add(i.category); categories.push(i.category); } });
    _bkPool = { items, categories };
    return _bkPool;
  }

  function bkPoolLookup() {
    return new Map(bkBuildPool().items.map(i => [i.name, i]));
  }

  /* ── public-slot cloud sync ─────────────────────────────────────────────────
     Only slots the user marked public are uploaded (one `banks` row per user,
     see supabase/banks.sql). Private slots stay in localStorage only. */
  let _bkSyncTimer = null;
  function bkScheduleSync() {
    if (!window._sbGetUserId?.()) return;
    clearTimeout(_bkSyncTimer);
    _bkSyncTimer = setTimeout(bkSyncPublic, 1200);
  }
  async function bkSyncPublic() {
    const client = window._sbClient;
    const uid = window._sbGetUserId?.();
    if (!client || !uid) return;
    const meta = bkGetMeta();
    const slots = meta.tabs.filter(t => t.public).map(t => ({
      name: t.name,
      items: Array.isArray(t.data?.items) ? t.data.items : [],
    }));
    try {
      await client.from('player_vaults').upsert({ user_id: uid, slots, updated_at: new Date().toISOString() });
    } catch {}
  }

  function bkWritePoolSnapshot() {
    try { localStorage.setItem(BK_POOL_KEY, JSON.stringify(bkBuildPool())); } catch {}
  }

  /* ── tabs (copy of the tracker tab bar) ─────────────────────────────────── */
  function bkRenderTabs(meta) {
    const tabsEl = _bkDoc.getElementById('bank-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    meta.tabs.forEach(tab => {
      const wrap = _bkDoc.createElement('div');
      wrap.className = 'vt-tab-wrap' + (tab.id === meta.activeTab ? ' vt-tab-active' : '');
      const nameBtn = _bkDoc.createElement('button');
      nameBtn.className = 'vt-tab-btn';
      nameBtn.textContent = tab.name;
      nameBtn.title = 'Click to switch · Double-click to rename';
      nameBtn.addEventListener('click', () => { meta.activeTab = tab.id; bkSaveMeta(meta); bkRender(); });
      nameBtn.addEventListener('dblclick', e => {
        e.stopPropagation();
        const newName = prompt('Rename slot:', tab.name);
        if (newName && newName.trim()) { tab.name = newName.trim(); bkSaveMeta(meta); bkRender(); }
      });
      wrap.appendChild(nameBtn);
      if (meta.tabs.length > 1) {
        const delBtn = _bkDoc.createElement('button');
        delBtn.className = 'vt-tab-del';
        delBtn.textContent = '×';
        delBtn.title = 'Delete slot';
        delBtn.addEventListener('click', e => {
          e.stopPropagation();
          if (!confirm(`Delete "${tab.name}"?`)) return;
          const idx = meta.tabs.findIndex(t => t.id === tab.id);
          meta.tabs.splice(idx, 1);
          if (meta.activeTab === tab.id) meta.activeTab = meta.tabs[Math.max(0, idx - 1)].id;
          bkSaveMeta(meta); bkRender();
        });
        wrap.appendChild(delBtn);
      }
      tabsEl.appendChild(wrap);
    });
    const addBtn = _bkDoc.createElement('button');
    addBtn.className = 'vt-tab-add';
    addBtn.textContent = '+ Add Slot';
    addBtn.addEventListener('click', () => {
      const name = prompt('Slot name:', `Slot ${meta.tabs.length + 1}`);
      if (!name || !name.trim()) return;
      const id = bkNewId();
      meta.tabs.push({ id, name: name.trim(), data: {} });
      meta.activeTab = id;
      bkSaveMeta(meta); bkRender();
    });
    tabsEl.appendChild(addBtn);
  }

  /* ── filter bar ─────────────────────────────────────────────────────────── */
  function bkRenderFilter() {
    const bar = _bkDoc.getElementById('bank-filter-bar');
    if (!bar) return;
    bar.innerHTML = '';
    const label = _bkDoc.createElement('span');
    label.className = 'pt-tier-label';
    label.textContent = 'Show:';
    bar.appendChild(label);
    [['all', 'All'], ['tradable', 'Tradable']].forEach(([key, text]) => {
      const btn = _bkDoc.createElement('button');
      btn.className = 'pt-tier-btn' + (bkFilter === key ? ' pt-tier-active' : '');
      btn.textContent = text;
      btn.addEventListener('click', () => { bkFilter = key; bkRender(); });
      bar.appendChild(btn);
    });
  }

  /* ── end-of-message note (appended to copied lists, e.g. "LF: ...") ─────── */
  function bkInitNote() {
    const el = _bkDoc.getElementById('bank-note');
    if (!el || el.dataset.bkBound) return;
    el.dataset.bkBound = '1';
    el.addEventListener('change', () => {
      const meta = bkGetMeta(); const d = bkGetData(meta);
      d.note = el.value.trim();
      bkSetData(meta, d); bkSaveMeta(meta);
    });
  }
  function bkRenderNote(data) {
    bkInitNote();
    const el = _bkDoc.getElementById('bank-note');
    if (el && _bkDoc.activeElement !== el) el.value = data.note || '';
  }

  /* ── search through stored items ────────────────────────────────────────── */
  function bkInitSearch() {
    const el = _bkDoc.getElementById('bank-search');
    if (!el || el.dataset.bkBound) return;
    el.dataset.bkBound = '1';
    el.addEventListener('input', () => bkRender());
  }
  function bkSearchQuery() {
    bkInitSearch();
    return (_bkDoc.getElementById('bank-search')?.value || '').trim();
  }

  /* ── active-slot privacy toggle ─────────────────────────────────────────── */
  function bkRenderPrivacy() {
    const btn = _bkDoc.getElementById('bank-priv-btn');
    if (!btn) return;
    const tab = bkActiveTab(bkGetMeta());
    const pub = !!tab.public;
    btn.innerHTML = pub ? '&#127760;&nbsp;Public' : '&#128274;&nbsp;Private';
    btn.classList.toggle('bank-priv-public', pub);
    btn.title = pub
      ? 'This slot is visible on your profile — click to make it private'
      : 'This slot is private — click to show it on your profile';
  }
  window._bankTogglePrivacy = function () {
    const meta = bkGetMeta();
    const tab = bkActiveTab(meta);
    tab.public = !tab.public;
    bkSaveMeta(meta);
    bkRender();
  };

  /* ── entry grouping (shared by render + copy) ───────────────────────────── */
  function bkGroupEntries(data, query) {
    const lookup = bkPoolLookup();
    const groups = new Map();
    const q = (query || '').toLowerCase();
    data.items.forEach(entry => {
      if (q && !entry.name.toLowerCase().includes(q)) return;
      const info = lookup.get(entry.name) || { category: 'Other', tradable: false };
      if (bkFilter === 'tradable' && !info.tradable) return;
      if (!groups.has(info.category)) groups.set(info.category, []);
      groups.get(info.category).push({ entry, info });
    });
    const order = bkBuildPool().categories.concat('Other').filter(c => groups.has(c));
    return { groups, order };
  }

  /* ── main render ────────────────────────────────────────────────────────── */
  function bkRender() {
    const meta = bkGetMeta();
    const data = bkGetData(meta);
    bkRenderTabs(meta);
    bkRenderFilter();
    bkRenderPrivacy();
    bkRenderNote(data);
    const list = _bkDoc.getElementById('bank-list');
    if (!list) return;
    list.innerHTML = '';

    const query = bkSearchQuery();
    const { groups, order } = bkGroupEntries(data, query);
    order.forEach(cat => {
      const hdr = _bkDoc.createElement('div');
      hdr.className = 'pt-section-hdr';
      hdr.textContent = cat;
      list.appendChild(hdr);
      groups.get(cat).forEach(({ entry, info }) => list.appendChild(bkMakeRow(entry, info)));
    });

    if (!list.children.length) {
      const note = _bkDoc.createElement('div');
      note.className = 'pt-info-note';
      note.textContent = query
        ? 'No items match your search.'
        : bkFilter === 'tradable'
          ? 'No tradable items in this slot.'
          : 'Empty slot — pick an item above and hit Add.';
      list.appendChild(note);
    }
  }

  function bkMakeRow(entry, info) {
    const row = _bkDoc.createElement('div');
    row.className = 'bank-item-row';

    const name = _bkDoc.createElement('span');
    name.className = 'bank-item-name';
    name.textContent = entry.name;
    row.appendChild(name);

    if (!info.tradable) {
      const badge = _bkDoc.createElement('span');
      badge.className = 'bank-untradable-badge';
      badge.textContent = 'untradable';
      row.appendChild(badge);
    }

    const step = delta => {
      const meta = bkGetMeta(); const d = bkGetData(meta);
      const it = d.items.find(i => i.name === entry.name);
      if (!it) return;
      it.qty = Math.max(1, (parseInt(it.qty, 10) || 1) + delta);
      bkSetData(meta, d); bkSaveMeta(meta); bkRender();
    };
    const minus = _bkDoc.createElement('button');
    minus.className = 'bank-step-btn';
    minus.textContent = '−1';
    minus.title = 'Remove one';
    minus.addEventListener('click', () => step(-1));
    row.appendChild(minus);

    const qty = _bkDoc.createElement('input');
    qty.type = 'number';
    qty.min = '1';
    qty.max = '999999';
    qty.value = entry.qty;
    qty.className = 'bank-qty-input bank-row-qty';
    qty.title = 'Amount';
    qty.addEventListener('change', () => {
      const v = parseInt(qty.value, 10);
      const meta = bkGetMeta(); const d = bkGetData(meta);
      const it = d.items.find(i => i.name === entry.name);
      if (!it) return;
      if (isFinite(v) && v >= 1) it.qty = v; else qty.value = it.qty;
      bkSetData(meta, d); bkSaveMeta(meta); bkRender();
    });
    row.appendChild(qty);

    const plus = _bkDoc.createElement('button');
    plus.className = 'bank-step-btn';
    plus.textContent = '+1';
    plus.title = 'Add one';
    plus.addEventListener('click', () => step(1));
    row.appendChild(plus);

    const del = _bkDoc.createElement('button');
    del.className = 'bank-row-del';
    del.textContent = '×';
    del.title = 'Remove';
    del.addEventListener('click', () => {
      const meta = bkGetMeta(); const d = bkGetData(meta);
      const idx = d.items.findIndex(i => i.name === entry.name);
      if (idx !== -1) d.items.splice(idx, 1);
      bkSetData(meta, d); bkSaveMeta(meta); bkRender();
    });
    row.appendChild(del);

    return row;
  }

  /* ── item picker (modeled on trades.js buildTrdItemPicker) ──────────────── */
  function bkInitPicker() {
    const wrap = _bkDoc.getElementById('bank-pick-wrap');
    if (!wrap || wrap.dataset.bkBound) return;
    wrap.dataset.bkBound = '1';
    const hidden  = _bkDoc.getElementById('bank-pick-name');
    const display = _bkDoc.getElementById('bank-pick-display');
    const panel   = _bkDoc.getElementById('bank-pick-panel');
    const search  = _bkDoc.getElementById('bank-pick-search');
    const list    = _bkDoc.getElementById('bank-pick-list');

    function makeItem(item) {
      const el = _bkDoc.createElement('div');
      el.className = 'trd-pick-item' + (hidden.value === item.name ? ' trd-pick-selected' : '');
      el.textContent = item.name;
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        hidden.value = item.name;
        display.textContent = item.name;
        display.classList.add('trd-pick-has-value');
        panel.style.display = 'none';
        search.value = '';
      });
      return el;
    }

    function buildList(q) {
      list.innerHTML = '';
      const pool = bkBuildPool();
      const visible = pool.items.filter(i => bkFilter !== 'tradable' || i.tradable);
      if (q) {
        const lq = q.toLowerCase();
        visible.filter(i => i.name.toLowerCase().includes(lq))
               .forEach(i => list.appendChild(makeItem(i)));
      } else {
        pool.categories.forEach(cat => {
          const items = visible.filter(i => i.category === cat);
          if (!items.length) return;
          const hdr = _bkDoc.createElement('div');
          hdr.className = 'trd-pick-group';
          hdr.textContent = cat;
          list.appendChild(hdr);
          items.forEach(i => list.appendChild(makeItem(i)));
        });
      }
    }

    display.addEventListener('click', () => {
      const isOpen = panel.style.display !== 'none';
      if (!isOpen) {
        panel.style.display = 'block';
        search.value = '';
        buildList('');
        search.focus();
      } else {
        panel.style.display = 'none';
      }
    });
    search.addEventListener('input', () => buildList(search.value));
    _bkDoc.addEventListener('mousedown', e => {
      if (!wrap.contains(e.target)) panel.style.display = 'none';
    });
  }

  /* ── actions ────────────────────────────────────────────────────────────── */
  window._bankAdd = function () {
    const hidden = _bkDoc.getElementById('bank-pick-name');
    const qtyEl  = _bkDoc.getElementById('bank-add-qty');
    const name = hidden?.value;
    if (!name) return;
    let qty = parseInt(qtyEl?.value, 10);
    if (!isFinite(qty) || qty < 1) qty = 1;
    const meta = bkGetMeta(); const d = bkGetData(meta);
    const existing = d.items.find(i => i.name === name);
    if (existing) existing.qty += qty; else d.items.push({ name, qty });
    bkSetData(meta, d); bkSaveMeta(meta);
    hidden.value = '';
    const display = _bkDoc.getElementById('bank-pick-display');
    if (display) { display.textContent = '— Select item —'; display.classList.remove('trd-pick-has-value'); }
    if (qtyEl) qtyEl.value = '1';
    bkRender();
  };

  window._bankCopy = function () {
    const meta = bkGetMeta(); const d = bkGetData(meta);
    const { groups, order } = bkGroupEntries(d);
    const lines = [];
    order.forEach(cat => {
      lines.push(`${cat}:`);
      groups.get(cat).forEach(({ entry, info }) => {
        const mark = (bkFilter === 'all' && !info.tradable) ? ' (untradable)' : '';
        lines.push(`- ${entry.name} x${entry.qty}${mark}`);
      });
      lines.push('');
    });
    let text = lines.join('\n').trim();
    if (!text) return;
    const note = (d.note || '').trim();
    if (note) text += '\n\n' + note;
    text += '\n\n- made by Arcane Lineage Builder';

    const btn = _bkDoc.getElementById('bank-copy-btn');
    const flash = () => {
      if (!btn) return;
      const old = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = old; }, 1200);
    };
    const fallback = () => {
      const ta = _bkDoc.createElement('textarea');
      ta.value = text;
      _bkDoc.body.appendChild(ta);
      ta.select();
      try { _bkDoc.execCommand('copy'); flash(); } catch {}
      ta.remove();
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(flash).catch(fallback);
    } else {
      fallback();
    }
  };

  /* ── open / close / popout ──────────────────────────────────────────────── */
  window._bankOpen = function () {
    bkWritePoolSnapshot();
    bkScheduleSync();
    const ov = document.getElementById('bank-overlay');
    if (ov) ov.style.display = 'flex';
    bkInitPicker();
    bkRender();
  };
  window._bankClose = function () {
    const ov = document.getElementById('bank-overlay');
    if (ov) ov.style.display = 'none';
  };
  let _bankPopupWin = null;
  window._bankPopout = function () {
    bkWritePoolSnapshot();
    if (_bankPopupWin && !_bankPopupWin.closed) { _bankPopupWin.location.reload(); _bankPopupWin.focus(); return; }
    _bankPopupWin = window.open('../html/bank-popup.html', 'alb-bank-popup', 'width=640,height=720,resizable=yes,scrollbars=yes');
    if (_bankPopupWin) { _bankPopupWin.focus(); window._bankClose(); }
  };

  /* ── read-only viewer for another user's public bank slots ──────────────── */
  window._bankViewUser = async function (userId, username) {
    if (!userId) return;
    document.getElementById('bank-view-overlay')?.remove();

    const o = document.createElement('div');
    o.id = 'bank-view-overlay';
    o.addEventListener('click', e => { if (e.target === o) o.remove(); });

    const modal = document.createElement('div');
    modal.id = 'bank-view-modal';

    const hdr = document.createElement('div');
    hdr.className = 'vt-modal-hdr';
    const title = document.createElement('span');
    title.className = 'vt-modal-title';
    title.textContent = `${username || 'Player'}'s Bank`;
    hdr.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'vt-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => o.remove());
    hdr.appendChild(closeBtn);
    modal.appendChild(hdr);

    const body = document.createElement('div');
    body.className = 'bank-view-body';
    const note = document.createElement('div');
    note.className = 'pt-info-note';
    note.textContent = 'Loading…';
    body.appendChild(note);
    modal.appendChild(body);

    o.appendChild(modal);
    document.body.appendChild(o);

    let slots = null;
    try {
      const client = window._sbClient;
      if (client) {
        const { data } = await client.from('player_vaults').select('slots').eq('user_id', userId).maybeSingle();
        if (data && Array.isArray(data.slots)) slots = data.slots;
      }
    } catch {}

    body.innerHTML = '';
    slots = (slots || []).filter(s => s && typeof s.name === 'string' && Array.isArray(s.items));
    if (!slots.length) {
      const empty = document.createElement('div');
      empty.className = 'pt-info-note';
      empty.textContent = `${username || 'This player'} has no public bank slots.`;
      body.appendChild(empty);
      return;
    }

    const tabsBar = document.createElement('div');
    tabsBar.className = 'pt-tier-bar';
    tabsBar.style.flexWrap = 'wrap';
    body.appendChild(tabsBar);
    const list = document.createElement('div');
    list.className = 'bank-view-list';
    body.appendChild(list);

    const lookup = bkPoolLookup();
    let active = 0;
    function showSlot(idx) {
      active = idx;
      [...tabsBar.children].forEach((b, i) => b.classList.toggle('pt-tier-active', i === idx));
      list.innerHTML = '';
      const items = slots[idx].items;
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'pt-info-note';
        empty.textContent = 'This slot is empty.';
        list.appendChild(empty);
        return;
      }
      const groups = new Map();
      items.forEach(entry => {
        if (!entry || typeof entry.name !== 'string') return;
        const info = lookup.get(entry.name) || { category: 'Other', tradable: false };
        if (!groups.has(info.category)) groups.set(info.category, []);
        groups.get(info.category).push({ entry, info });
      });
      bkBuildPool().categories.concat('Other').filter(c => groups.has(c)).forEach(cat => {
        const hdrEl = document.createElement('div');
        hdrEl.className = 'pt-section-hdr';
        hdrEl.textContent = cat;
        list.appendChild(hdrEl);
        groups.get(cat).forEach(({ entry, info }) => {
          const row = document.createElement('div');
          row.className = 'bank-item-row';
          const name = document.createElement('span');
          name.className = 'bank-item-name';
          name.textContent = entry.name;
          row.appendChild(name);
          if (!info.tradable) {
            const badge = document.createElement('span');
            badge.className = 'bank-untradable-badge';
            badge.textContent = 'untradable';
            row.appendChild(badge);
          }
          const qty = document.createElement('span');
          qty.className = 'bank-view-qty';
          qty.textContent = 'x' + (parseInt(entry.qty, 10) || 1);
          row.appendChild(qty);
          list.appendChild(row);
        });
      });
    }

    slots.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.className = 'pt-tier-btn';
      btn.textContent = s.name;
      btn.addEventListener('click', () => showSlot(i));
      tabsBar.appendChild(btn);
    });
    showSlot(0);
  };

  /* ── Banks page (main nav): browse all public banks + username search ───── */
  let _banksCache = null;

  window._banksLoad = async function () {
    const listEl = document.getElementById('banks-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const loading = document.createElement('div');
    loading.className = 'pt-info-note';
    loading.textContent = 'Loading…';
    listEl.appendChild(loading);

    const client = window._sbClient;
    if (!client) {
      loading.textContent = 'Banks are unavailable right now — try again in a moment.';
      return;
    }
    try {
      const { data: rows } = await client.from('player_vaults')
        .select('user_id, slots, updated_at')
        .order('updated_at', { ascending: false })
        .limit(200);
      const open = (rows || []).filter(r => Array.isArray(r.slots) && r.slots.length);
      let pmap = new Map();
      if (open.length) {
        const { data: profs } = await client.from('profiles')
          .select('id, username, avatar_url')
          .in('id', open.map(r => r.user_id));
        pmap = new Map((profs || []).map(p => [p.id, p]));
      }
      _banksCache = open.map(r => {
        const p = pmap.get(r.user_id);
        return {
          userId: r.user_id,
          username: p?.username || 'Unknown',
          avatarUrl: p?.avatar_url || null,
          slots: r.slots,
        };
      });
    } catch {
      _banksCache = [];
    }
    bkRenderBanksList();
  };

  window._banksFilter = function () { bkRenderBanksList(); };

  function bkBankMatchedItems(b, q) {
    const hits = [];
    b.slots.forEach(sl => (Array.isArray(sl.items) ? sl.items : []).forEach(it => {
      if (it && typeof it.name === 'string' && it.name.toLowerCase().includes(q) && !hits.includes(it.name)) hits.push(it.name);
    }));
    return hits;
  }

  function bkRenderBanksList() {
    const listEl = document.getElementById('banks-list');
    if (!listEl) return;
    const qUser = (document.getElementById('banks-search')?.value || '').trim().toLowerCase();
    const qItem = (document.getElementById('banks-item-search')?.value || '').trim().toLowerCase();
    listEl.innerHTML = '';
    // Username bar filters players; item bar filters banks holding that item.
    const rows = (_banksCache || [])
      .map(b => ({ ...b, matchedItems: qItem ? bkBankMatchedItems(b, qItem) : [] }))
      .filter(b => (!qUser || b.username.toLowerCase().includes(qUser)) && (!qItem || b.matchedItems.length));

    if (!rows.length) {
      const note = document.createElement('div');
      note.className = 'pt-info-note';
      note.textContent = (qUser || qItem)
        ? 'No public banks match your search.'
        : 'No public banks yet — be the first: open your Bank and set a slot to Public.';
      listEl.appendChild(note);
      return;
    }

    rows.forEach(b => {
      const card = document.createElement('button');
      card.className = 'bank-user-card';
      card.addEventListener('click', () => window._bankViewUser?.(b.userId, b.username));

      const av = document.createElement('span');
      av.className = 'bank-user-av';
      if (window._sbAvatar) av.innerHTML = window._sbAvatar(b.username, b.avatarUrl, 40);
      card.appendChild(av);

      const info = document.createElement('span');
      info.className = 'bank-user-info';
      const name = document.createElement('span');
      name.className = 'bank-user-name';
      name.textContent = b.username;
      info.appendChild(name);
      const meta = document.createElement('span');
      meta.className = 'bank-user-meta';
      const nItems = b.slots.reduce((s, sl) => s + (Array.isArray(sl.items) ? sl.items.length : 0), 0);
      meta.textContent = `${b.slots.length} public slot${b.slots.length === 1 ? '' : 's'} · ${nItems} item${nItems === 1 ? '' : 's'}`;
      info.appendChild(meta);
      if (b.matchedItems && b.matchedItems.length) {
        const has = document.createElement('span');
        has.className = 'bank-user-has';
        const shown = b.matchedItems.slice(0, 3).join(', ');
        const more = b.matchedItems.length - 3;
        has.textContent = `has: ${shown}${more > 0 ? ` +${more} more` : ''}`;
        info.appendChild(has);
      }
      card.appendChild(info);

      listEl.appendChild(card);
    });
  }

  // PiP/overlay support (overlay.js retargets renders into the PiP window)
  window._bkSetDoc = d => { _bkDoc = d || document; };
  window._bkRender = () => { bkInitPicker(); bkRender(); };

  // Re-render (and re-sync public slots) when the popout saves changes back
  window.addEventListener('storage', e => {
    if (e.key !== BK_KEY) return;
    bkScheduleSync();
    if (_bkDoc !== document || document.getElementById('bank-overlay')?.style.display !== 'none') bkRender();
  });
})();
