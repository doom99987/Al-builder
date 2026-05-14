/* ── Encyclopedia + Tracker System ───────────────────────────────────────────
   Single IIFE that owns:
     • ENC_ITEMS / TYPE_ORDER / boss-move / artifact / mark / covenant data
     • Encyclopedia list + detail render (main page)
     • Venia Orb Tracker · Petent Tracker · Astra Tracker
   PiP support: _vtDoc / _ptDoc / _atDoc / _chatDoc (set by overlay.js) let
   each tracker render into the Document PiP window instead of the main page.
   Exposes: _ENC_ITEMS, _encGetDetail, _encFilter, _encSearch, _encGotoItem,
            _encMoveBack, _veniaTrackerOpen/Close/Popout, _petentTrackerOpen/
            Close/Popout, _astraTrackerOpen/Close/Popout,
            _vtSetDoc, _ptSetDoc, _atSetDoc, _vtRender, _ptRender, _atRender
   ──────────────────────────────────────────────────────────────────────────── */
(function () {
  /* ── Item data: [name, type, description] ────────────────────────────────
     description = '' means no known in-game description yet               */
  const ENC_ITEMS = [

    /* ── ORES ─────────────────────────────────────────────────────────── */
    ['Aestic Ore',            'Ore',             'Can be mined in a cave near the Icerift Approach (Barber side) using a Pickaxe or Dynamite.\n\nUsed to craft the following armor:\n\nDroppable Blueprint: Explorer, Nobleman, Chainmail Guard\n\nSuperclass: Paladin (Paladin Cuirass), Berserker (Raging Warrior), Elementalist (Arcane Robes), Ranger (Lifebound Archer), Rogue (Rogue Hunter), Assassin (Shadow Cloak), Monk (Traveling Pasmark), Brawler (Wandering Practitioner), Darkwraith (Shade Walker), Saint (Pathfinder Martyr), Lancer (Armored Lancer), Impaler (Bloody Menace), Lionheart (Venerated Legionnaire), Arbiter (Deathmantle)'],
    ['Ferrus Ore',            'Ore',             'Can be mined in a cave near the Icerift Approach (Barber side) using a Pickaxe or Dynamite.\n\nUsed to craft the following armor:\n\nDroppable Blueprint: Trapper, Chainmail Guard\n\nSuperclass: Paladin (Paladin Cuirass), Blade Dancer (Adept Warrior), Berserker (Raging Warrior), Rogue (Rogue Hunter), Assassin (Shadow Cloak), Brawler (Wandering Practitioner), Darkwraith (Shade Walker), Saint (Pathfinder Martyr), Lancer (Armored Lancer), Lionheart (Venerated Legionnaire), Citadel (Fortified Seer)'],
    ['Laneus Ore',            'Ore',             'Can be mined in the Assassin Trainer cave near the Deeproot Canopy entrance using a Pickaxe or Dynamite.\n\nUsed to craft the following armor:\n\nDroppable Blueprint: None\n\nSuperclass: Blade Dancer (Adept Warrior), Berserker (Raging Warrior), Elementalist (Arcane Robes), Hexer (Magister Apprentice), Necromancer (Corrupt Caster), Ranger (Lifebound Archer), Assassin (Shadow Cloak), Monk (Traveling Pasmark), Saint (Pathfinder Martyr), Impaler (Bloody Menace), Lionheart (Venerated Legionnaire), Citadel (Fortified Seer), Arbiter (Deathmantle)'],

    /* ── INGREDIENTS ──────────────────────────────────────────────────── */
    ['Carnastool',            'Ingredient',      'Can be found in the Desert.'],
    ['Cryastem',              'Ingredient',      'Can be found in Icerift Approach.'],
    ['Crylight',              'Ingredient',      'Rarely found in place of Everthistle.'],
    ['Driproot',              'Ingredient',      'Can be found in Deeproot Forest.'],
    ['Everthistle',           'Ingredient',      'Can be found in the forest around Caldera and Deeproot.'],
    ['Haze Chunk',            'Ingredient',      'Drops from <button class="enc-desc-link" data-enc-nav="Fog Spirit">Fog Spirit</button>, which can be encountered in Deeproot Forest.'],
    ['Hightail',              'Ingredient',      'Can be found in Deeproot Forest.'],
    ['Mushroom Cap',          'Ingredient',      'Drops from <button class="enc-desc-link" data-enc-nav="Zombie Mushroom">Zombie Mushroom</button> and <button class="enc-desc-link" data-enc-nav="Venom Shroom">Venom Shroom</button>, which can be encountered in Caldera and Deeproot Forest, respectively.\n\nCan be bought from Mysterious Merchant (Events).'],
    ['Restless Fragment',     'Ingredient',      'Drops from <button class="enc-desc-link" data-enc-nav="Stray Sandstorm">Stray Sandstorm</button>, which can be encountered in the Desert.\n\nCan be bought from Mysterious Merchant (Events).'],
    ['Rot Core',              'Ingredient',      'Drops from <button class="enc-desc-link" data-enc-nav="Cess Horror">Cess Horror</button> and Sentient Darkness, which can be encountered in Deeproot Forest.'],
    ['Sand Core',             'Ingredient',      'Drops from <button class="enc-desc-link" data-enc-nav="Sand Elemental">Sand Elemental</button>, which can be encountered in the Desert.\n\nCan be bought from Mysterious Merchant (Events).'],
    ['Slime Chunk',           'Ingredient',      'Drops from <button class="enc-desc-link" data-enc-nav="Slime">Slimes</button>, which can be encountered in Caldera.\n\nCan be bought from Mysterious Merchant (Events).'],


    /* ── GEAR ─────────────────────────────────────────────────────────── */
    ['7 Leafed Everthisel',   'Gear',            ''],
    ['Arbusta Tear',          'Gear',            ''],
    ['Aspect of Maladaptation','Gear',           ''],
    ['Band Of Crushing Force', 'Gear',           'A band that amplifies the raw force behind physical strikes.'],
    ['Blazing Perforator',    'Gear',            ''],
    ['Chocolate Egg',         'Gear',            'A festive egg of mysterious origin. A rare seasonal collectible.'],
    ['Coagulated Finger Nail','Gear',            ''],
    ['Crystal Sphere',        'Gear',            ''],
    ['Crystalized Star',      'Gear',            'Drops from <button class="enc-desc-link" data-enc-nav="Gon">Gon</button>, <button class="enc-desc-link" data-enc-nav="Thanasludd">Thanasludd</button>, and <button class="enc-desc-link" data-enc-nav="Star Slime">Star Slime</button>.\n\nGain a flat +10 Luck every successful crit for 2 turns. Stacks up to 5 times.'],
    ['Cursed Brand',          'Gear',            'A brand marked with a curse. Grants power at the cost of the wearer\'s stability.'],
    ['Deathbeak Dagger',      'Gear',            ''],
    ['Delicate Purse',        'Gear',            'Grants 200 gold at the end of an encounter. Taking damage during the fight reduces the gold received.'],
    ['Desert Escutcheon',     'Gear',            ''],
    ['Divine Promise',        'Gear',            ''],
    ['Dragon Memior',         'Gear',            ''],
    ['Dust Devil\'s Eye',     'Gear',            ''],
    ['Dust Storm',            'Gear',            ''],
    ['Ramizcan Idol',         'Gear',            'Drops from <button class="enc-desc-link" data-enc-nav="Stray Sandstorm">Stray Sandstorm</button>.\n\nGrants a 15% damage buff for 1 turn after blocking or parrying.'],
    ['Grain Of Balance (BUGGED?)', 'Gear',       'Drops from <button class="enc-desc-link" data-enc-nav="Stray Sandstorm">Stray Sandstorm</button>.\n\nTakes 25% off of your highest stat and distributes it across all stats.'],
    ['Egg Shelmet',           'Gear',            'A helmet fashioned from a giant egg shell. Provides modest protection.'],
    ['Elemental Infuser',     'Gear',            ''],
    ['Elementary Resonance',  'Gear',            ''],
    ['Eroded Blade',          'Gear',            ''],
    ['Everbeating Drum',      'Gear',            ''],
    ['Expedite Anklet',       'Gear',            'An anklet enchanted to increase the wearer\'s movement speed.'],
    ['Focussed Mind',         'Gear',            ''],
    ['Forest Charm',          'Gear',            ''],
    ['Frozen Diadem',         'Gear',            ''],
    ['Frostburned Rune',      'Gear',            ''],
    ['Frosty Topper',         'Gear',            ''],
    ['Gelat Band',            'Gear',            ''],
    ['Gilded Pouch',          'Gear',            ''],
    ['Gleaming Carrot',       'Gear',            ''],
    ['Golem Rune Core',       'Gear',            ''],
    ['Grain of Balance',      'Gear',            ''],
    ['Imbued Chains',         'Gear',            ''],
    ['Imbuement Reliquary',   'Gear',            ''],
    ['Imperial Headband',     'Gear',            ''],
    ['Impure Crown',          'Gear',            ''],
    ['Lethal Blackajck',      'Gear',            ''],
    ["Madseer's Codex",       'Gear',            ''],
    ['Magma Charm',           'Gear',            ''],
    ['Molten Carapace',       'Gear',            ''],
    ["Narthana's Leaf",       'Gear',            ''],
    ['Open Hand',             'Gear',            ''],
    ['Parasitic Leech',       'Gear',            ''],
    ['Party Egg',             'Gear',            'Active — Egg Throw (Cost: 2, CD: 6): Throws an egg dealing 5 damage (SPD/80 scaling). On hit grants 7.5% speed boost and applies 2 random status effects.'],
    ["Pathfinder's Mark",     'Gear',            ''],
    ['Phantom Ooze',          'Gear',            ''],
    ["Ptera's Heart",         'Gear',            ''],
    ['Rabbit Pelt',           'Gear',            ''],
    ['Rabbits Foot',          'Gear',            "A lucky rabbit's foot. Said to bring fortune to whoever carries it."],
    ['Ramzicon Idol',         'Gear',            ''],
    ['Sanguine Fang',         'Gear',            ''],
    ['Shard of Blight',       'Gear',            ''],
    ['Shattered Clockhand',   'Gear',            'Drops from <button class="enc-desc-link" data-enc-nav="Thief">Thief (Mob)</button>.\n\nWhen using Strike, you have a 30% chance to decrease all your move cooldowns by 1 turn.'],
    ['Snorb',                 'Gear',            ''],
    ['Spiked Steel Ball',     'Gear',            'Passive: 30–40% chance to apply 1 Vulnerable and 1 Weakened on hit. Deals an additional 35% damage when this effect procs.'],
    ['Spore Root',            'Gear',            ''],
    ['Stone Brand',           'Gear',            ''],
    ['Tainted Quiver',        'Gear',            ''],
    ['Tear Blood Crystal',    'Gear',            ''],
    ['The Biggest Pebble',    'Gear',            'An impressive specimen of a pebble. Completely unremarkable, yet somehow sought after.'],
    ['The Last Straw',        'Gear',            ''],
    ['The Smallest Boulder',  'Gear',            ''],
    ["Traveler's Lamp",       'Gear',            ''],
    ['Vainglorious Locket',   'Gear',            ''],
    ['Vow of Ruin',           'Gear',            ''],
    ['Blazing Brand',         'Gear',            'Drops from <button class="enc-desc-link" data-enc-nav="Magma Golem">Magma Golem</button>.\n\nWhen enemies attack your summons, they take small damage and receive 3 Burn.'],
    ['Vulcan Knuckle',        'Gear',            ''],
    ['Wicked Crown',          'Gear',            ''],
    ["Yarthul's Wrath",       'Gear',            ''],

    /* ── WEAPONS ──────────────────────────────────────────────────────── */
    ['Blacksteel Axe',        'Weapon',          ''],
    ['Blacksteel Cestus',     'Weapon',          ''],
    ['Blacksteel Dagger',     'Weapon',          ''],
    ['Blacksteel Greatsword', 'Weapon',          'Found next to Kayrein (Raging Warrior trainer).\n\nStarts with 6 empty Shard Slots.'],
    ['Blacksteel Spear',      'Weapon',          ''],
    ['Blacksteel Staff',      'Weapon',          ''],
    ['Blacksteel Sword',      'Weapon',          ''],
    ['Dragon Bone Axe',       'Weapon',          ''],
    ['Dragon Bone Cestus',    'Weapon',          ''],
    ['Dragon Bone Dagger',    'Weapon',          ''],
    ['Dragon Bone Spear',     'Weapon',          ''],
    ['Dragon Bone Staff',     'Weapon',          ''],
    ['Dragon Bone Sword',     'Weapon',          ''],
    ['Ferrus Axe',            'Weapon',          ''],
    ['Ferrus Cestus',         'Weapon',          ''],
    ['Ferrus Dagger',         'Weapon',          ''],
    ['Ferrus Hammer',         'Weapon',          ''],
    ['Ferrus Spear',          'Weapon',          ''],
    ['Ferrus Staff',          'Weapon',          ''],
    ['Ferrus Sword',          'Weapon',          ''],
    ['Corealloy Cestus',      'Weapon',          ''],
    ['Corealloy Dagger',      'Weapon',          ''],
    ['Corealloy Greatsword',  'Weapon',          ''],
    ['Sun Dagger',            'Weapon',          ''],
    ['Sun Greatsword',        'Weapon',          ''],
    ['Sun Hammer (visage)',   'Weapon',          ''],
    ['Sun Spear',             'Weapon',          ''],
    ['Sun Staff',             'Weapon',          ''],
    ['Sun Sword',             'Weapon',          ''],
    ['Ivory Axe',             'Weapon',          ''],
    ['Ivory Cestus',          'Weapon',          ''],
    ['Ivory Dagger',          'Weapon',          ''],
    ['Ivory Greatsword',      'Weapon',          ''],
    ['Ivory Hammer',          'Weapon',          ''],
    ['Ivory Spear',           'Weapon',          ''],
    ['Ivory Staff',           'Weapon',          ''],
    ['Ivory Sword',           'Weapon',          ''],
    ['Jade Staff',            'Weapon',          ''],
    ['Jade Sword',            'Weapon',          ''],
    ['Blightrock/wood Cestus','Weapon',          ''],
    ['Blightrock/wood Dagger','Weapon',          ''],
    ['Blightrock/wood Spear', 'Weapon',          ''],
    ['Blightrock/wood Staff', 'Weapon',          ''],
    ['Blightrock/wood Sword', 'Weapon',          ''],
    ['Icerind Cestus',        'Weapon',          ''],
    ['Icerind Dagger',        'Weapon',          ''],
    ['Icerind Greatsword',    'Weapon',          ''],
    ['Icerind Spear',         'Weapon',          ''],
    ['Icerind Staff',         'Weapon',          ''],
    ['Icerind Sword',         'Weapon',          ''],
    ['Darkblood Cestus',      'Weapon',          ''],
    ['Darkblood Dagger',      'Weapon',          ''],
    ['Darkblood Greatsword',  'Weapon',          ''],
    ['Darkblood Spear',       'Weapon',          ''],
    ['Darkblood Staff',       'Weapon',          ''],
    ['Darkblood Sword',       'Weapon',          ''],
    ['Sandstone Cestus',      'Weapon',          ''],
    ['Sandstone Dagger',      'Weapon',          ''],
    ['Sandstone Hammer',      'Weapon',          ''],
    ['Sandstone Staff',       'Weapon',          ''],
    ['Primordial Axe',        'Weapon',          ''],
    ['Primordial Cestus',     'Weapon',          ''],
    ['Primordial Dagger',     'Weapon',          ''],
    ['Primordial Greatsword', 'Weapon',          ''],
    ['Primordial Hammer',     'Weapon',          ''],
    ['Primordial Spear',      'Weapon',          ''],
    ['Primordial Staff',      'Weapon',          ''],
    ['Primordial Sword',      'Weapon',          ''],

    /* ── UNIQUE WEAPONS ───────────────────────────────────────────────── */
    /* Weapons here have unique attributes that may only have a passive for their own. */
    ['Vastic Glaive',         'Weapon',          'Obtained from: Tor\'run\'s final request (Quest).\n\nStarts with 4 empty Shard Slots.'],
    ['Star-Seeing Hammer',    'Weapon',          'Obtained from: <button class="enc-desc-link" data-enc-nav="Arkhaia">Arkhaia</button> and <button class="enc-desc-link" data-enc-nav="Handaconda">Handaconda</button>.\n\nStarts with 4 empty Shard Slots.\n\nAllows the use of Hammer locked skills. Has no damage buff.\n\nDoes nothing.'],

    /* ── SHIELDS ─────────────────────────────────────────────────────── */
    ['Ferrus Towershield',    'Weapon',          'Obtained from: Westwood Weapon Shop.\n\nGrants a 40% Damage Reduction.'],
    ['Ivory Shield',          'Weapon',          'Obtained from: Egg Basket.\n\nGrants nothing. literally, it does nothing.'],
    ['Icerind Shield',        'Weapon',          ''],
    ['Sandstone Shield',      'Weapon',          ''],
    ['Primordial Shield',     'Weapon',          ''],
    ['Dragonflame Shield',    'Weapon',          'Obtained from: <button class="enc-desc-link" data-enc-nav="Yar\'Thul">Yar\'Thul, The Blazing Dragon</button>.\n\nGrants a 30% Damage Reduction.\n\nReflects incoming melee damage by 200%.'],
    ['Slimy Buckler',         'Weapon',          'Obtained from: <button class="enc-desc-link" data-enc-nav="Slime King">Slime King</button>.\n\nGrants a 15% Damage Reduction.\n\nApplies 2 Weakened and 1 Blindness upon blocking a Melee attack. Does not stack with Slimy Shield passive (Lentum passive).'],
    ['Targe',                 'Weapon',          'Obtained from: Can be purchased in the Old Ruins.\n\nGrants a 20% Damage Reduction.'],

    /* ── ARTIFACTS ────────────────────────────────────────────────────── */
    ['Celestial Emblem',      'Artifact',        ''],
    ['Ancient Insignia',      'Artifact',        ''],
    ["Arkhaia's Visage",      'Artifact',        ''],
    ['Chaos Orb',             'Artifact',        ''],
    ['Dark Sigil',            'Artifact',        ''],
    ["Heaven's Authority",    'Artifact',        ''],
    ["Metrom's Amulet",       'Artifact',        ''],
    ["Narthana's Sigil",      'Artifact',        ''],
    ['Paranoxian Crux',       'Artifact',        ''],
    ['Reality Watch',         'Artifact',        ''],
    ['Shifting Hourglass',    'Artifact',        ''],
    ['Stellian Core',         'Artifact',        ''],

    /* ── LESSER ARTIFACTS ─────────────────────────────────────────────── */
    ['Echo shard',            'Lesser Artifact', '"A glowing shard of collective memories, holding it floods your mind with techniques you shouldn\'t know."'],
    ['Lineage Shard',         'Lesser Artifact', ''],
    ['Memory Fragment',       'Lesser Artifact', ''],
    ['Phoenix Tear',          'Lesser Artifact', ''],
    ['Resplendent Essence',   'Lesser Artifact', ''],
    ['Skyward Totem',         'Lesser Artifact', ''],
    ['Soul Dust',             'Lesser Artifact', ''],
    ['Void Key',              'Lesser Artifact', ''],

    /* ── WEAPON MODIFIERS ─────────────────────────────────────────────── */
    ['Arcanium Crystal',      'Weapon Modifier', 'Currently obtainable from: <button class="enc-desc-link" data-enc-nav="Seraphon">Seraphon</button>, <button class="enc-desc-link" data-enc-nav="Arkhaia">Arkhaia</button> &amp; <button class="enc-desc-link" data-enc-nav="Metrom\'s Vessel">Metrom\'s Vessel</button>.\n\nAllows you to add 1 shard slot to a weapon at the Shard NPC. Weapons can have a maximum of 7 shard slots.'],
    ['Tempurus Gem',          'Weapon Modifier', 'Currently obtainable from: <button class="enc-desc-link" data-enc-nav="Seraphon">Seraphon</button>, <button class="enc-desc-link" data-enc-nav="Arkhaia">Arkhaia</button> &amp; <button class="enc-desc-link" data-enc-nav="Metrom\'s Vessel">Metrom\'s Vessel</button>.\n\nAllows you to remove 1 shard from your weapon at the Shard NPC. You can choose which shard to remove, and it will be returned to your inventory.'],

    /* ── ENCHANTS ─────────────────────────────────────────────────────── */
    ['Blessed',               'Enchant',         "Obtained from Raphion's Blessing (Seraphon)."],
    ['Cursed',                'Enchant',         "Requires Level 35. Obtained from Jyphar's Cursed Corpse Cleansing Quest in Deeproot Canopy."],
    ['Frosted',               'Enchant',         'Only obtainable during the Winter Event. Can be purchased from Sierrka, God of Festivities for 500 Crystallized Joy.'],
    ['Frost Burn (mod)',       'Enchant',         ''],
    ['Hiemal',                'Enchant',         'Obtained by defeating Corrupted <button class="enc-desc-link" data-enc-nav="Handaconda">Handaconda</button> and speaking with Thuriaz. You do not need to be the host or be alive to receive it.'],
    ['Inferno',               'Enchant',         "Requires Level 25. Obtained from the Parkour in Mount'Thul."],
    ['Ivory',                 'Enchant',         'Obtained during the Easter Event. Can be purchased from the Easter event for 1,000 Egg Shells.'],
    ['Lifesong',              'Enchant',         'Requires Level 35. Obtained from Narthana\'s Lifesong Quest in The Forgotten Sanctum.'],
    ['Midas',                 'Enchant',         "Obtained from Lodyssa's Midas Quest in Caldera Tavern."],
    ['Reaper',                'Enchant',         'Requires Level 35. Obtained from the Reaper room in the Desert — requires full lives, or 1 life in Legendary mode + a Lineage Shard.'],
    ['Spectral',              'Enchant',         "Obtained from Arkhaia's Curse (Arkhaia)."],
    ['Storm (mod)',            'Enchant',         ''],

    /* ── BASE CLASSES ─────────────────────────────────────────────────── */
    ['Thief',          'Base Class',  'A nimble fighter specializing in quick strikes, bleeding, and gold acquisition. Cost: 200g.\n\nEvolves into: <button class="enc-desc-link" data-enc-nav="Ranger (Or)">Ranger (Or)</button>, <button class="enc-desc-link" data-enc-nav="Rogue (N)">Rogue (N)</button>, <button class="enc-desc-link" data-enc-nav="Assassin (Ch)">Assassin (Ch)</button>\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Boots, The Thief">Boots, The Thief</button>'],
    ['Warrior',        'Base Class',  'A sturdy front-line fighter with balanced offense and defense. Cost: 200g.\n\nEvolves into: <button class="enc-desc-link" data-enc-nav="Paladin (Or)">Paladin (Or)</button>, <button class="enc-desc-link" data-enc-nav="Blade Dancer (N)">Blade Dancer (N)</button>, <button class="enc-desc-link" data-enc-nav="Berserker (Ch)">Berserker (Ch)</button>\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Ysa, The Warrior">Ysa, The Warrior</button>'],
    ['Wizard',         'Base Class',  'A powerful magic caster wielding elemental and arcane energy. Cost: 120g.\n\nEvolves into: <button class="enc-desc-link" data-enc-nav="Elementalist (Or)">Elementalist (Or)</button>, <button class="enc-desc-link" data-enc-nav="Hexer (N)">Hexer (N)</button>, <button class="enc-desc-link" data-enc-nav="Necromancer (Ch)">Necromancer (Ch)</button>\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Arandor, The Wizard">Arandor, The Wizard</button>'],
    ['Martial Artist', 'Base Class',  'A disciplined hand-to-hand combatant focused on energy management and precise strikes. Cost: 220g.\n\nEvolves into: <button class="enc-desc-link" data-enc-nav="Monk (Or)">Monk (Or)</button>, <button class="enc-desc-link" data-enc-nav="Brawler (N)">Brawler (N)</button>, <button class="enc-desc-link" data-enc-nav="Darkwraith (Ch)">Darkwraith (Ch)</button>\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Doran, The Martial Artist">Doran, The Martial Artist</button>'],
    ['Slayer',         'Base Class',  'An aggressive fighter built for high single-target damage output. Cost: 200g.\n\nEvolves into: <button class="enc-desc-link" data-enc-nav="Saint (Or)">Saint (Or)</button>, <button class="enc-desc-link" data-enc-nav="Lancer (N)">Lancer (N)</button>, <button class="enc-desc-link" data-enc-nav="Impaler (Ch)">Impaler (Ch)</button>\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Tivek, The Slayer">Tivek, The Slayer</button>'],
    ['Marauder',       'Base Class',  'A heavy-hitting brawler that overpowers enemies with raw force. Cost: Unknown.\n\nEvolves into: <button class="enc-desc-link" data-enc-nav="Lionheart (N)">Lionheart (N)</button>\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Geron, the Marauder">Geron, the Marauder</button>'],
    ['Sentry',         'Base Class',  'A defensive support class focused on protection and battlefield control. Cost: 500g.\n\nEvolves into: <button class="enc-desc-link" data-enc-nav="Citadel (Or)">Citadel (Or)</button>, <button class="enc-desc-link" data-enc-nav="Arbiter (N)">Arbiter (N)</button>\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Lagolt, the Sentry">Lagolt, the Sentry</button>'],

    /* ── SUPER CLASSES ────────────────────────────────────────────────── */
    ['Ranger (Or)',       'Super Class', '<button class="enc-desc-link" data-enc-nav="Thief">Thief (Base Class)</button> → Orthodox path. Cost: 2,000g.\n\nA mobile crit-and-speed-focused fighter with nature magic. Gains damage and speed buffs on every dodge or crit. Strike scales with Arcane.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Orkin, Lifebound Archer">Orkin, Lifebound Archer</button>'],
    ['Rogue (N)',         'Super Class', '<button class="enc-desc-link" data-enc-nav="Thief">Thief (Base Class)</button> → Neutral path. Cost: 3,750g.\n\nA stealth and burst-damage specialist that excels at bleed stacking and high single-hit damage.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Aberon, Rogue Hunter">Aberon, Rogue Hunter</button>'],
    ['Assassin (Ch)',     'Super Class', '<button class="enc-desc-link" data-enc-nav="Thief">Thief (Base Class)</button> → Chaotic path. Cost: 2,000g.\n\nA high-damage finisher focused on critical bursts and eliminating targets before they can react.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Inette, Shadow Cloak">Inette, Shadow Cloak</button>'],
    ['Paladin (Or)',      'Super Class', '<button class="enc-desc-link" data-enc-nav="Warrior">Warrior</button> → Orthodox path. Cost: 2,400g.\n\nA holy warrior combining frontline tanking with healing and divine protection.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Dernon, Paladin Warrior">Dernon, Paladin Warrior</button>'],
    ['Blade Dancer (N)',  'Super Class', '<button class="enc-desc-link" data-enc-nav="Warrior">Warrior</button> → Neutral path. Cost: 3,750g.\n\nA speed-based swordsman with flowing combo attacks and high mobility.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Leoran, Adept Warrior">Leoran, Adept Warrior</button>'],
    ['Berserker (Ch)',    'Super Class', '<button class="enc-desc-link" data-enc-nav="Warrior">Warrior</button> → Chaotic path. Cost: 2,000g.\n\nA rage-fueled fighter that deals massive damage at the cost of defense.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Kayrein, Raging Warrior">Kayrein, Raging Warrior</button>'],
    ['Elementalist (Or)','Super Class', '<button class="enc-desc-link" data-enc-nav="Wizard">Wizard</button> → Orthodox path. Cost: 2,000g.\n\nA master of all elements wielding powerful area-of-effect attacks and multi-element combinations.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Landrum, Arcane Trainer">Landrum, Arcane Trainer</button>'],
    ['Hexer (N)',         'Super Class', '<button class="enc-desc-link" data-enc-nav="Wizard">Wizard</button> → Neutral path. Cost: 3,750g.\n\nA debuffer and status effect specialist who weakens enemies and turns their strengths against them.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Ophelia, Magister Apprentice">Ophelia, Magister Apprentice</button>'],
    ['Necromancer (Ch)', 'Super Class', '<button class="enc-desc-link" data-enc-nav="Wizard">Wizard</button> → Chaotic path. Cost: 2,000g.\n\nCommands undead minions and drains the life force of enemies to sustain itself.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Ulys, Corrupt Caster">Ulys, Corrupt Caster</button>'],
    ['Monk (Or)',         'Super Class', '<button class="enc-desc-link" data-enc-nav="Martial Artist">Martial Artist</button> → Orthodox path. Cost: 2,400g.\n\nA balanced fighter using focus, precision, and inner power to overcome enemies.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Luther, Traveling Pasmark">Luther, Traveling Pasmark</button>'],
    ['Brawler (N)',       'Super Class', '<button class="enc-desc-link" data-enc-nav="Martial Artist">Martial Artist</button> → Neutral path. Cost: 3,750g.\n\nA pure melee powerhouse with crushing combos and unrelenting close-range pressure.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Gren, Wandering Practitioner">Gren, Wandering Practitioner</button>'],
    ['Darkwraith (Ch)',   'Super Class', '<button class="enc-desc-link" data-enc-nav="Martial Artist">Martial Artist</button> → Chaotic path. Cost: 2,000g.\n\nA corrupted fighter channeling dark energy to deliver devastating blows and powerful debuffs.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Momma Darkbeast, Mother of Dark">Momma Darkbeast, Mother of Dark</button>'],
    ['Saint (Or)',        'Super Class', '<button class="enc-desc-link" data-enc-nav="Slayer">Slayer</button> → Orthodox path. Cost: 2,000g.\n\nA holy healer and divine support class focused on protecting and restoring allies.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Fernain, Pathfinder Martyr">Fernain, Pathfinder Martyr</button>'],
    ['Lancer (N)',        'Super Class', '<button class="enc-desc-link" data-enc-nav="Slayer">Slayer</button> → Neutral path. Cost: 3,750g.\n\nA spear-specialized high-damage dealer with superior range and piercing attacks.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Relan, Armored Lancer">Relan, Armored Lancer</button>'],
    ['Impaler (Ch)',      'Super Class', '<button class="enc-desc-link" data-enc-nav="Slayer">Slayer</button> → Chaotic path. Cost: 2,400g.\n\nAn aggressive spear fighter that delivers devastating piercing attacks to single targets.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Orin, Bloody Menace">Orin, Bloody Menace</button>'],
    ['Lionheart (N)',     'Super Class', '<button class="enc-desc-link" data-enc-nav="Marauder">Marauder</button> → Neutral path. Cost: 6,250g.\n\nA fearless warrior with overwhelming power and unmatched tenacity in battle.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Ardentis, Venerated Legionnaire">Ardentis, Venerated Legionnaire</button>'],
    ['Citadel (Or)',      'Super Class', '<button class="enc-desc-link" data-enc-nav="Sentry">Sentry</button> → Orthodox path. Cost: 2,000g.\n\nA near-impenetrable fortress tank with extreme damage reduction and team protection.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Nevithas, Fortified Seer">Nevithas, Fortified Seer</button>'],
    ['Arbiter (N)',       'Super Class', '<button class="enc-desc-link" data-enc-nav="Sentry">Sentry</button> → Neutral path. Cost: 6,250g.\n\nA judge-like fighter that controls the battlefield and punishes enemies who break the rules.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Kether, Deathmantle">Kether, Deathmantle</button>'],

    /* ── SUB CLASSES ──────────────────────────────────────────────────── */
    ['Bard',        'Sub Class', 'A support sub-class that uses music and song to buff allies and inflict debuffs on enemies. Cost: 1,200g.\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Cantia, The Bard">Cantia, The Bard</button>'],
    ['Beastmaster', 'Sub Class', 'Total cost: 750g + 3 mob drops\n\nSkill costs: 250g + 1 mob drop\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Thorin, The Beastmaster">Thorin, The Beastmaster</button>'],
    ['Alchemist',   'Sub Class', 'Total cost: 800g + Small Healing Potion, Ferrus Skin Potion, Invisibility Potion\n\nSkill costs: 200g + 1 potion (First 3 skills) / 200g (4th skill)\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Selia, The Alchemist">Selia, The Alchemist</button>'],
    ['Blacksmith',  'Sub Class', 'Total cost: 3,000g + 10 Crafted Armor\n\nSkill costs: 500g (First skill) / 1,000g + 5 Crafted Armor (Second skill) / 1,500g + 5 Crafted Armor (Third skill)\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Adelma, the Blacksmith">Adelma, the Blacksmith</button>'],
    ['Miner',       'Sub Class', 'Total cost: 1,000g + 45 Ores\n\nSkill costs: 250g (First skill) / 250g + 20 Ferrus Ore (Second skill) / 500g + 10 Ferrus Ore and 15 Aestic Ore (Third skill)\n\nTrainer: <button class="enc-desc-link" data-enc-nav="Vanio, the Miner">Vanio, the Miner</button>'],

    /* ── RACES ────────────────────────────────────────────────────────── */
    ['Estella (24%)',    'Race', 'Common race (24% chance). An endurance-focused race that gains defensive power at low HP.\n\nInnate: While below 40% max HP, gain a permanent 10% defense buff and a 50% healing buff for two turns after triggering.'],
    ['Stultus (20%)',    'Race', 'Common race (20% chance). A speed-to-crit race where every 10 Speed equals 1% bonus critical chance. Crit chance from this passive is uncapped at 100%.'],
    ['Nisse (20%)',      'Race', 'Common race (20% chance). An energy-generating race with a passive chance to gain extra energy each turn.'],
    ['Vastayan (9%)',    'Race', 'Uncommon race (9% chance). A hybrid race with a prehensile tail, higher jump, and summon affinity. Magic and Hex affinity moves deal 10% more damage.'],
    ['Veneri (6%)',      'Race', 'Rare race (6% chance). A gold-oriented race — gain a damage buff based on gold held (0.2% per 500g, capped at 20% at 50k gold). Higher enchant proc chance.'],
    ['Ophimar (6%)',     'Race', 'Rare race (6% chance). A reptilian race resistant to damage-over-time effects. Decays Poison, Bleed, and Burn by 2 instead of 1. Starts battles with 4 turns of Thorns.'],
    ['Drauga (6%)',      'Race', 'Rare race (6% chance). A vampiric race that heals for 15% of damage on crits and gains a permanent speed buff after each kill.'],
    ['Corvolus (3%)',    'Race', 'Rare race (3% chance). An arcane race with 30% bonus damage to Holy and Magic affinity skills and 1.15x essence gain. Can give allies magic damage buffs.'],
    ['Daminos (3%)',     'Race', 'Rare race (3% chance). A resilient race with 4 lives (instead of 3) and 15% outgoing healing bonus. At ≤25% HP, gains passive 2% HP regen until hit again.'],
    ['Dullahan (1%)',    'Race', 'Legendary race (1% chance). A headless race with 4 lives, 20% fire resistance, extra essence from kills, and 3 additional stat points per 10 levels (12 extra by lv40).'],
    ['Vydeer (1%)',      'Race', 'Legendary race (1% chance). A sensory race immune to Blind, gaining 1.5% crit per turn (cap 15%). Has the Sense status — at 3+ stacks, automatically dodges any damaging attack.'],
    ['Boreas (1%)',      'Race', 'Legendary race (1% chance). A frost race that stacks ice power: each Ice affinity move grants 1 stack (+20% dmg, +10% DR per stack). Non-Ice moves remove 1 stack. Attacks have ~25% chance to apply 2 Cold.'],
    ['Lentum (Obtainable)',      'Race', 'How to obtain:\n\nNote: Always have Gelat Band equipped and do it all in the same server.\n\n1. Equip Gelat Band and speak with King Slime Statue to get quest.\n2. Find 4 Slime Statues, speak with them and return to King Slime Statue.\n3. Give him 100 Slime Chunks. (Should get "my fallen subjects" dialogue)\n4. Kill King Slime and return to statue to obtain Lentum.'],
    ['Amorus (Obtainable)',      'Race', 'How to obtain:\n\n1. Have 35+ level and speak with Thanasius in Amoran Chasm.\n2. Offer him the following: Phoenix Tear, Lineage Shard, Memory Fragment, Soul Dust, Narthana\'s Sigil, Dark Sigil, Reality Watch, Stellian Core, Shifting Hourglass, Chaos Orb, Metrom\'s Amulet, Void Key.\n3. Speak with him again to obtain Amorus.'],
    ['Sheea (Obtainable)',       'Race', 'How to obtain:\n\n1. Speak with Sky Man, give him Mushroom Cap, Sand Core and Rot Core, then speak with him again and teleport.\n2. Join the Church of Raphion and progress it to Rank 20.\n3. Return to the Church and speak with Mael to start the Seraphon fight.\n4. Win the fight and speak with Mael to obtain Sheea.'],
    ['Inferion (Obtainable)',    'Race', 'How to obtain:\n\n1. Come to Deeproot Depths and find the mirror, speak with it and choose the middle dialogue to get "Prayer" in your inventory.\n2. Use "Prayer" to start a fight with the Sheea Elementalist.\n3. Fight the Sheea Elementalist (you can fight in a party, just get the final blow) and speak with the mirror again to teleport.\n4. Join the Cult of Thanasius and progress it to Rank 20.\n5. Come back to the Cult and speak with Mephisto to start the Arkhaia fight.\n6. Win the fight and speak with Mephisto again to obtain Inferion.'],
    ['Gynx (Obtainable)',        'Race', 'How to obtain:\n\n1. Defeat Handaconda on the character slot where you want the race. (Normal or Corrupted both work)\n2. Have a Forgotten Relic in your inventory while having 3 gear drops from Handaconda equipped. These include: Open Hand, Dust Devil\'s Eye, Eroded Blade, and The Smallest Boulder.\n3. Talk to the Handaconda fight NPC Thuriaz to obtain Gynx.'],

    /* ── BOSSES (ordered by progression) ─────────────────────────────── */
    ["Yar'Thul, The Blazing Dragon", 'Boss', 'The boss of Mount Thul. This enemy can block attacks.'],
    ['Thorian, The Rotten',          'Boss', 'The boss of Cessgrounds. This enemy can block attacks.'],
    ['Pterathanaian',                'Mini Boss', 'The mini boss of Deeproot Canopy. Spawns upon using the Warbing Whistle.'],
    ['Seraphon',                     'Boss', 'The boss of Illustris. Available in the Church of Raphion at rank 20. This enemy can block and dodge attacks.'],
    ['Arkhaia',                      'Boss', 'The boss of the Temple of Norn. Available in the Cult of Thanasius at rank 20. This enemy can block attacks.\n\nNote: Starting the fight with a Celestial Emblem equipped allows Arkhaia to summon a weak version of Sentient Darkness.'],
    ["Metrom's Vessel",              'Boss', "A vessel containing Metrom's immense power. One of the game's strongest raid bosses. This enemy can block and dodge attacks."],
    ['Shadeblade',                   'Boss', 'A shade warrior wielding twin dark blades. A swift and dangerous mini boss.'],
    ['Handaconda',                   'Boss', 'A colossal serpentine raid boss. Resistant to physical, holy, and arcane damage. Vulnerable to fire.'],
    ['Slime King',                   'Mini Boss', 'The Mini Boss of The Crossing. This enemy can dodge attacks.'],
    ['Carnis',                       'Mini Boss', 'The Mini Boss of Deeproot Canopy.'],

    /* ── COVENANTS ───────────────────────────────────────────────────── */
    ['Blades of the World', 'Covenant', 'A gold-focused covenant offering increased guild rewards, a combat active, Mulligan on death, and 2 accessories.\n\nProgression: Donate gold for 1 point, or complete quests on the Blades questboard for 3 points each. Questboard access requires Rank 3.\n\nRank costs: R1: 250G · R3: 750G · R5: ~2,125G / ~5 requests · R10: ~8,125G / ~29 requests (+2 SP) · R13: ~13,375G / ~49 requests · R15: ~17,500G / ~65 requests · R20: ~38,625G / ~116 requests (+3 SP)'],
    ['Way of Life',         'Covenant', 'A healing covenant offering increased outgoing healing, a heal active, and 2 accessories.\n\nProgression: Donate Mossy Runes — Rank 1 costs 1 rune, all others cost 5 runes each. Runes drop from guild requests and brewing potions (1–4 per reward). Cannot be traded.\n\nRank costs: R1: 1 Rune · R5: 25 Runes · R7: 35 Runes · R10: 50 Runes (+2 SP) · R13: 65 Runes · R15: 75 Runes · R20: 100 Runes (+3 SP)'],
    ['Church of Raphion',   'Covenant', 'Note: Cannot join if already in another covenant.\n\nHow to join: Speak with Sky Man and give him a Mushroom Cap, Sand Core, and Rot Core. Speak with him again and teleport. Find Mael and speak with him to join.\n\nA support covenant providing cleansing heals, shield abilities, and the ability to teleport to Seraphon.\n\nProgression: Heal an ally or yourself for +2 progression per heal (regen does not count; Ranger\'s Enrichment does). Required healing per rank equals the rank number.\n\nRank costs: R0: On join · R5: 15 total heals · R10: 30 total heals (+2 SP) · R15: 65 total heals · R20: 105 total heals (+3 SP)'],
    ['Cult of Thanasius',   'Covenant', 'Note: Cannot join if already in another covenant.\n\nHow to join: In Deeproot Depths, find the mirror and choose "Death" then "I wish to become its harbringer" to receive the Prayer active. Use Prayer to fight the Sheea Elementalist and defeat it. Speak with the mirror again to teleport. Find Mephisto and speak with him to join.\n\nA dark covenant providing an execute ability, energy on kill, and the ability to teleport to Arkhaia.\n\nProgression: Gain 1 point per enemy killed. Kills via Soul Absorb grant more progression.\n\nRank costs: R0: On join · R5: 15 total absorbs · R10: 30 total absorbs (+2 SP) · R15: 75 total absorbs · R20: 105 total absorbs (+3 SP)'],

    /* ── MARKS ────────────────────────────────────────────────────────── */
    ['Petent', 'Mark', 'A cross-wipe progression system earned by completing specific in-game requirements. Advancing a tier requires placing a Void Key in your Soul Vault and wiping. Grants permanent abilities that persist through all future wipes.'],
    ['Venia',  'Mark', 'A cross-wipe progression system centered around artifact sacrifice and the Midas enchant. Advancing a tier requires wiping while holding the Midas enchant and 50k gold. Grants artifact trading and gold-generating abilities.'],
    ['Astra',  'Mark', 'A cross-wipe progression system centered around the Celestial Emblem. Requires crafting the emblem, defeating specific enemies, and wiping with it equipped. Grants a star-based ability system that powers support and healing moves.'],

    /* ── TRAINERS ────────────────────────────────────────────────────── */
    ['Cantia, The Bard',        'Trainer', '"...Hm? What do you need, I\'m a bit.. busy right now."\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Bard">Bard</button>'],
    ['Thorin, The Beastmaster', 'Trainer', '"...Oh, and who might you be?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Beastmaster">Beastmaster</button>'],
    ['Selia, The Alchemist',    'Trainer', '"...then this one must be..but then...Oh hi, how are you?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Alchemist">Alchemist</button>'],
    ['Adelma, the Blacksmith',  'Trainer', 'Teaches: <button class="enc-desc-link" data-enc-nav="Blacksmith">Blacksmith</button>'],
    ['Vanio, the Miner',        'Trainer', 'Teaches: <button class="enc-desc-link" data-enc-nav="Miner">Miner</button>'],
    ['Ysa, The Warrior',        'Trainer', '"Hey kid, what do you want of me? I\'m a bit busy you know, city knight captain and all."\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Warrior">Warrior</button>'],
    ['Arandor, The Wizard',     'Trainer', '"The fields radiate strong energy today, perhaps the day of the chosen one is upon us?"\n"Ah, an aspiring young mage are we? Perhaps I could teach you a thing or two, but do note my services aren\'t free."\n"But of course, the usual price!"\n"I\'ve already taught you all I know, if you still wish to learn more then seek out more talented individuals in the world."\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Wizard">Wizard</button>'],
    ['Boots, The Thief',        'Trainer', '"Oh, and why would someone like you be snooping around these parts?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Thief">Thief</button>'],
    ['Doran, The Martial Artist','Trainer', '"Aha, what do you want of someone like me on this nice day?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Martial Artist">Martial Artist</button>'],
    ['Tivek, The Slayer',       'Trainer', '"Hmm? What\'s up kid, I don\'t usually get visitors up here."\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Slayer">Slayer</button>'],
    ['Geron, the Marauder',     'Trainer', 'Teaches: <button class="enc-desc-link" data-enc-nav="Marauder">Marauder</button>'],
    ['Lagolt, the Sentry',      'Trainer', 'Teaches: <button class="enc-desc-link" data-enc-nav="Sentry">Sentry</button>'],
    ['Dernon, Paladin Warrior',          'Trainer', '"Hm? What would someone like you be doing out here in this wasteland?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Paladin (Or)">Paladin</button>'],
    ['Leoran, Adept Warrior',            'Trainer', '"Hm? Hello there, how are you?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Blade Dancer (N)">Blade Dancer</button>'],
    ['Kayrein, Raging Warrior',          'Trainer', '"Oh? You managed to get down here? Now that\'s what I\'m talking about, come take a seat my friend!"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Berserker (Ch)">Berserker</button>'],
    ['Landrum, Arcane Trainer',          'Trainer', '"…Oh, I\'m a little busy here, what do you want?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Elementalist (Or)">Elementalist</button>'],
    ['Ophelia, Magister Apprentice',     'Trainer', '"Oh, hi there!"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Hexer (N)">Hexer</button>'],
    ['Ulys, Corrupt Caster',             'Trainer', '"…Hm..but maybe with a bit more..hm? Oh, how did you get here?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Necromancer (Ch)">Necromancer</button>'],
    ['Orkin, Lifebound Archer',          'Trainer', '"..Hm? What do you need?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Ranger (Or)">Ranger</button>'],
    ['Aberon, Rogue Hunter',             'Trainer', '"Hey kid, it\'s pretty rough out there in the sands isn\'t it?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Rogue (N)">Rogue</button>'],
    ['Inette, Shadow Cloak',             'Trainer', '"..Hm? What do you want?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Assassin (Ch)">Assassin</button>'],
    ['Luther, Traveling Pasmark',        'Trainer', '"Ah, I heard you approaching, what do you seek of me?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Monk (Or)">Monk</button>'],
    ['Gren, Wandering Practitioner',     'Trainer', '"Huh? What do you want kid?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Brawler (N)">Brawler</button>'],
    ['Momma Darkbeast, Mother of Dark',  'Trainer', '"Can\'t you see I\'m busy with my kin, mortal? What is it that you seek?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Darkwraith (Ch)">Darkwraith</button>'],
    ['Fernain, Pathfinder Martyr',       'Trainer', '"When will our lord save us... Oh, my bad, what are you in need of?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Saint (Or)">Saint</button>'],
    ['Relan, Armored Lancer',            'Trainer', '"Hm? What are you doing up here, the gate to tundra is closed."\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Lancer (N)">Lancer</button>'],
    ['Orin, Bloody Menace',              'Trainer', '"Huh, what do you want?"\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Impaler (Ch)">Impaler</button>'],
    ['Ardentis, Venerated Legionnaire',  'Trainer', '"Not many find their way up here. Sit. The heat alone will tell me if you belong."\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Lionheart (N)">Lionheart</button>'],
    ['Nevithas, Fortified Seer',         'Trainer', '"Raphion watches those who choose to stand. Sit. I will see what you bring."\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Citadel (Or)">Citadel</button>'],
    ['Kether, Deathmantle',              'Trainer', '"Few find this place. Fewer still deserve to speak."\n\nTeaches: <button class="enc-desc-link" data-enc-nav="Arbiter (N)">Arbiter</button>'],

    /* ── SCROLLS ─────────────────────────────────────────────────────── */
    ['Lights Out',        'Scroll', 'Class restriction: None.\n\nCost: 1 NRG · Cooldown: 5\nType: Holy · Buff\n\nApplies 3 Blinded and 1 Stunned to all enemies. Has a chance to backfire and apply to yourself instead.'],
    ['Bulk Up',           'Scroll', 'Class restriction: None.\n\nCost: 1 NRG · Cooldown: 6\nType: Physical · Buff\n\nIncreases damage by 20% and decreases the user\'s own defense by 20%. Defense decrease is multiplicative (2 stacks = 44% more dmg taken, 3 stacks = 72%).'],
    ['Immolation',        'Scroll', 'Class restriction: None.\n\nCost: 2 NRG · Cooldown: ∞\nType: Fire · Buff\n\nGain a 10% damage buff (defense buff is bugged). Take 0.1 damage per turn, increasing by 0.1 each turn. Cannot kill you; leaves you at 0.1 HP.'],
    ['Steel Body',        'Scroll', 'Class restriction: None.\n\nCost: 2 NRG · Cooldown: 8\nType: Physical · Buff · Duration: 1\n\nDecrease all incoming damage by 80%. Does not work on boss ultimates.'],
    ['Self Cure',         'Scroll', 'Class restriction: None.\n\nCost: 2 NRG · Cooldown: 7\nType: Holy · Buff\n\nTake ~5% of your max HP as damage and remove all status effects applied to you (only one stack of Inferno/Plague removed).'],
    ['Lesser Absorb',     'Scroll', 'Class restriction: Thief, Warrior, Slayer.\n\nCost: 1 NRG · Cooldown: 9\nType: Magic · Buff · Duration: 2\n\nPlaces an orb over an ally, redirecting 5% of the damage they take towards you. Cannot be used on yourself.'],
    ['Lesser Empower',    'Scroll', 'Class restriction: Warrior, Slayer.\n\nCost: 2 NRG · Cooldown: 6\nType: Magic · Buff · Duration: 2\n\nGive the target a 15% damage buff for 2 turns.'],
    ['Torching Soul',     'Scroll', 'Class restriction: Warrior, Martial Artist.\n\nCost: 3 NRG · Cooldown: 20\nType: Fire · Buff · Duration: 5\n\nHeal 3% of max HP every time you consume or are inflicted with Burn. Gain a damage and defense buff per Burn (doesn\'t stack). Duration 5 turns.'],
    ['Surprise Package',  'Scroll', 'Class restriction: Thief, Martial Artist.\n\nCost: 2 NRG · Cooldown: 11\nType: Physical · Buff\n\nPlant a bomb on a target for 3 turns, dealing 30% of max HP (5% for bosses). Explodes with effects based on triggering affinity — Physical/Magic: +35% bonus dmg; Fire: +15% fire dmg + 10 Burning; Holy: 1 Resist + 10% HP heal to party; Ice: 6 Cold to all + -5% def 4 turns; Poison: 20 Poison + 2 Weaken to all; Hex: 1 Hex + 100 true dmg; Dark: 3 Vulnerable + 3 Weakened + disable dodge 4 turns; Nature: Daminos Restructure + remove 1 debuff from each party member.'],
    ['Simple Curse',      'Scroll', 'Class restriction: Wizard, Slayer, Martial Artist.\n\nCost: 2 NRG · Cooldown: 6\nType: Hex · Attack · Damage: 5 (ARC/75)\n\nApplies 2 Vulnerable and 3 Weakened on hit.'],
    ['Ice Shards',        'Scroll', 'Class restriction: Wizard, Thief, Slayer.\n\nCost: 3 NRG · Cooldown: 8\nType: Ice · Attack · Damage: 3.5×4 (ARC/75)\n\nApplies 1 Weakened and 3 Cold on hit.'],
    ['Wind Reflect',      'Scroll', 'Class restriction: Wizard, Slayer.\n\nCost: 2 NRG · Cooldown: 12\nType: Nature · Buff · Duration: 3\n\nPlace a shield on yourself or an ally, preventing physical attacks from hitting them. Does not fully work against bosses.'],
    ['Dark Slash',        'Scroll', 'Class restriction: Thief, Warrior.\n\nCost: 2 NRG · Cooldown: 6\nType: Dark · Attack · Damage: 11 (STR/75)\n\nHas a chance to apply 2 Weakened.'],
    ['Fireball',          'Scroll', 'Class restriction: Wizard only.\n\nCost: 2 NRG · Cooldown: 4\nType: Fire · Attack · Damage: 9 (ARC/75)\n\nHas a chance to apply 3 Burning on hit.'],
    ['Blizzard',          'Scroll', 'Class restriction: Wizard only.\n\nCost: 2 NRG · Cooldown: 15\nType: Ice · Buff · Duration: 4\n\nCreates a snowstorm for 4 turns: all defense -20%, fire defense +25%, increasing ice damage by 20% for the team. Also increases the team\'s defense by 10%.'],
    ['Battleworn',        'Scroll', 'Drop only from <button class="enc-desc-link" data-enc-tab="Boss">Bosses</button>.\n\nUnlike other scrolls, this scroll does not give any skills and simply gives 7 mastery points.'],

    /* ── LOST SCROLLS ────────────────────────────────────────────────── */
    ["Metrom's Grasp",    'Lost Scroll', 'Class restriction: None.\n\nCost: 5 NRG · Cooldown: 18\nType: Magic · Buff · Duration: 5\n\nDecreases opponents\' defense by 40%, makes them harder to block/dodge. Grants 40% more damage for DoT effects over 5 turns.'],
    ['Absolute Radiance', 'Lost Scroll', 'Class restriction: None.\n\nCost: 4 NRG · Cooldown: 18\nType: Fire · Buff · Duration: 5\n\nGrowing dmg/DR buff each turn — reaches up to 22.5% more damage by turn 5 (~7.5%/10%/12.5%/15%/22.5%).'],
    ['Wild Impulse',      'Lost Scroll', 'Class restriction: None.\n\nCost: 1 NRG · Cooldown: 10\nType: Magic · Buff\n\nYour next hit becomes a pseudo-AoE, dealing 20% damage to all nearby enemies. Applies 2 Vulnerable and Weakened to all targets hit.'],
    ['Permafrost Curse',  'Lost Scroll', 'Class restriction: Wizard only.\n\nCost: 4 NRG · Cooldown: 10\nType: Ice · Attack · Damage: 14 (STR/75)\n\nApplies 2 Cold and 1 Stun. Acts as a pseudo-AoE, hitting adjacent enemies as well.'],
    ['Breath of Fungyir', 'Lost Scroll', 'Class restriction: Slayer, Warrior.\n\nCost: 4 NRG · Cooldown: 20\nType: Magic · Buff\n\nEnter a stance and unleash a heavy stun on the opponent. Also fully heals your entire team.'],
    ['Heavenly Prayer',   'Lost Scroll', 'Class restriction: Slayer, Warrior, Wizard.\n\nCost: 5 NRG · Cooldown: 22\nType: Holy · Buff · Duration: 3\n\nGrants 10% Lifesteal for 5 turns, 3 Resist, 15% DR for 3 turns, and Death Defy for 2 turns.'],

    /* ── POTIONS ─────────────────────────────────────────────────────── */
    ['Small Healing Potion',    'Potion', 'Heals a percentage of your HP. Heals approximately 20% of HP at 100 HP, and scales less the higher your HP is.\n\nRecipe: 1 <button class="enc-desc-link" data-enc-nav="Everthistle">Everthistle</button>, 1 <button class="enc-desc-link" data-enc-nav="Slime Chunk">Slime Chunk</button>.'],
    ['Medium Healing Potion',   'Potion', 'A stronger healing potion. Heals approximately 35% of HP at 100 HP, and scales less the higher your HP is.\n\nRecipe: 1 <button class="enc-desc-link" data-enc-nav="Everthistle">Everthistle</button>, 1 <button class="enc-desc-link" data-enc-nav="Slime Chunk">Slime Chunk</button>, 1 <button class="enc-desc-link" data-enc-nav="Carnastool">Carnastool</button>, 1 <button class="enc-desc-link" data-enc-nav="Hightail">Hightail</button>.'],
    ['Minor Absorbing Potion',  'Potion', 'Grants 1 Resist upon usage.\n\nRecipe: 1 <button class="enc-desc-link" data-enc-nav="Hightail">Hightail</button>, 1 <button class="enc-desc-link" data-enc-nav="Mushroom Cap">Mushroom Cap</button>.'],
    ['Ferrus Skin Potion',      'Potion', 'Reduces incoming damage by 20% for 3 turns upon usage.\n\nRecipe: 2 <button class="enc-desc-link" data-enc-nav="Carnastool">Carnastool</button>, 1 <button class="enc-desc-link" data-enc-nav="Sand Core">Sand Core</button>, 1 <button class="enc-desc-link" data-enc-nav="Mushroom Cap">Mushroom Cap</button>.'],
    ['Minor Empowering Elixir', 'Potion', 'Grants 15% damage buff for 2 turns upon usage.\n\nRecipe: 1 <button class="enc-desc-link" data-enc-nav="Sand Core">Sand Core</button>, 1 <button class="enc-desc-link" data-enc-nav="Carnastool">Carnastool</button>, 1 <button class="enc-desc-link" data-enc-nav="Cryastem">Cryastem</button>.'],
    ['Minor Energy Elixir',     'Potion', 'Grants Energy upon usage.\n\nUsed inside a fight: grants 2 Energy.\nUsed outside of a fight before joining one: sets your Energy to 1.\n\nRecipe: 1 <button class="enc-desc-link" data-enc-nav="Everthistle">Everthistle</button>, 1 <button class="enc-desc-link" data-enc-nav="Carnastool">Carnastool</button>.'],
    ['Average Energy Elixir',   'Potion', 'A stronger energy potion.\n\nUsed inside a fight: grants 3 Energy.\nUsed outside of a fight before joining one: sets your Energy to 1.\n\nRecipe: 2 <button class="enc-desc-link" data-enc-nav="Everthistle">Everthistle</button>, 1 <button class="enc-desc-link" data-enc-nav="Cryastem">Cryastem</button>, 1 <button class="enc-desc-link" data-enc-nav="Restless Fragment">Restless Fragment</button>.'],
    ['Stimulating Brew',        'Potion', 'Grants 15% damage buff and +1 Energy per turn for 2 turns upon usage. Defense down appears to not function.\n\nRecipe: 1 <button class="enc-desc-link" data-enc-nav="Rot Core">Rot Core</button>, 1 <button class="enc-desc-link" data-enc-nav="Hightail">Hightail</button>, 2 <button class="enc-desc-link" data-enc-nav="Haze Chunk">Haze Chunk</button>.'],
    ['Energetic SoulBrew',      'Potion', 'Removes all Energy when consumed and grants a 77.7% damage buff for 1 turn. The buff is always 77.7% regardless of how much Energy is consumed. Energy cannot be gained the following turn.\n\nRecipe: 2 <button class="enc-desc-link" data-enc-nav="Rot Core">Rot Core</button>, 1 <button class="enc-desc-link" data-enc-nav="Driproot">Driproot</button>, 1 <button class="enc-desc-link" data-enc-nav="Haze Chunk">Haze Chunk</button>.'],
    ['Invisibility Potion',     'Potion', 'Grants 2 stacks of Invisibility upon usage.\n\nInvisibility: Increases escape chance and prevents receiving damage or being targeted by most attacks (does not protect against certain moves such as Oblivion).\n\nRecipe: 1 <button class="enc-desc-link" data-enc-nav="Hightail">Hightail</button>, 1 <button class="enc-desc-link" data-enc-nav="Haze Chunk">Haze Chunk</button>, 2 <button class="enc-desc-link" data-enc-nav="Driproot">Driproot</button>.'],
    ['Rejuvenating Elixir',     'Potion', 'Removes all status debuffs upon usage. Functions like Self Cure but requires no Energy and deals no self-damage.\n\nRecipe: 2 <button class="enc-desc-link" data-enc-nav="Restless Fragment">Restless Fragment</button>, 1 <button class="enc-desc-link" data-enc-nav="Hightail">Hightail</button>, 1 <button class="enc-desc-link" data-enc-nav="Haze Chunk">Haze Chunk</button>.'],
    ['Stoneskin Potion',        'Potion', 'Grants 70% Damage Reduction (85% if guarding) for 2 turns upon usage. Cannot block or dodge during the duration.\n\nRecipe: 2 <button class="enc-desc-link" data-enc-nav="Sand Core">Sand Core</button>, 1 <button class="enc-desc-link" data-enc-nav="Driproot">Driproot</button>, 1 <button class="enc-desc-link" data-enc-nav="Restless Fragment">Restless Fragment</button>.'],
    ['Light of Grace',          'Potion', 'Revives a randomly chosen dead player to half HP during battle.\n\nRecipe: 1 <button class="enc-desc-link" data-enc-nav="Phoenix Tear">Phoenix Tear</button>, 1 <button class="enc-desc-link" data-enc-nav="Crylight">Crylight</button>, 1 <button class="enc-desc-link" data-enc-nav="Haze Chunk">Haze Chunk</button>, 1 <button class="enc-desc-link" data-enc-nav="Sand Core">Sand Core</button>, 1 <button class="enc-desc-link" data-enc-nav="Driproot">Driproot</button>.'],
    ['Abhorrent Elixir',        'Potion', 'Removes encounter chance for 1 minute. Does not work on the Volcano Bridge.\n\nRecipe: 2 <button class="enc-desc-link" data-enc-nav="Everthistle">Everthistle</button>, 1 <button class="enc-desc-link" data-enc-nav="Cryastem">Cryastem</button>.'],
    ['Alluring Elixir',         'Potion', 'Increases encounter rates and disables encounter immunity after battle for 2 minutes.\n\nRecipe: 2 <button class="enc-desc-link" data-enc-nav="Everthistle">Everthistle</button>, 1 <button class="enc-desc-link" data-enc-nav="Carnastool">Carnastool</button>.'],
    ['Heartbreaking Elixir',    'Potion', 'Chaotic alignment potion.\n\nLoses 10% of max HP and grants 2 Chaotic alignment upon use.\n\nRecipe: 3 <button class="enc-desc-link" data-enc-nav="Everthistle">Everthistle</button>, 1 <button class="enc-desc-link" data-enc-nav="Carnastool">Carnastool</button>.'],
    ['Heartsoothing Remedy',    'Potion', 'Orderly alignment potion.\n\nLoses 10% of max HP and grants 2 Orderly alignment upon use.\n\nRecipe: 3 <button class="enc-desc-link" data-enc-nav="Everthistle">Everthistle</button>, 1 <button class="enc-desc-link" data-enc-nav="Cryastem">Cryastem</button>.'],
    ['Radiance Elixir',         'Potion', 'Grants +1 extra slot upon usage, regardless of how many slots you already have. Can only be used once. Cannot be traded.\n\nNote: Recipe order matters — Resplendent Essence must be added before Phoenix Tear.\n\nRecipe: 3 <button class="enc-desc-link" data-enc-nav="Resplendent Essence">Resplendent Essence</button>, 1 <button class="enc-desc-link" data-enc-nav="Phoenix Tear">Phoenix Tear</button>.'],

    /* ── MISC ────────────────────────────────────────────────────────── */
    ['Pickaxe',                    'Misc', 'A utility item used to mine ore for armor. Costs 50g and can be purchased near the blacksmith in Caldera.'],
    ['Starslime Chunk',            'Misc', 'Drops from <button class="enc-desc-link" data-enc-nav="Star Slime">Star Slime</button>.\n\nHas no purpose other than selling it.'],
    ['Astral Shards',              'Misc', 'Obtainable from <button class="enc-desc-link" data-enc-nav="Star Slime">Star Slime</button> or by interacting with a meteor during an Astral Night event with a Pickaxe. Cannot be traded.\n\nUsed to craft <button class="enc-desc-link" data-enc-nav="Celestial Emblem">Celestial Emblem</button> at El\'heith.'],
    ['Old Runic Bolt',             'Misc', 'Drops from Pterathanarian, or can be purchased from Elena at the Cessgrounds entrance for 400g (1,000g after the first purchase). The initial price can be exploited by repeating the initial dialogue.\n\nWhen used, the item is thrown at the ground and reveals any nearby cess anomalies in Cessgrounds.'],
    ['Mossy Rune',                 'Misc', 'Obtainable by completing Guild requests or brewing Potions as a member of the Way of Life covenant. Cannot be traded.\n\nUsed to progress and rank up within the Way of Life covenant.'],
    ["Arkhaia's Curse",            'Misc', 'Drops from <button class="enc-desc-link" data-enc-nav="Arkhaia">Arkhaia</button>.\n\nWhen used, the item is consumed and you are granted a <button class="enc-desc-link" data-enc-nav="Spectral">Spectral</button> enchant. A confirmation screen appears before use.'],
    ["Raphion's Blessing",         'Misc', 'Drops from <button class="enc-desc-link" data-enc-nav="Seraphon">Seraphon</button>.\n\nWhen used, the item is consumed and you are granted a <button class="enc-desc-link" data-enc-nav="Blessed">Blessed</button> enchant. A confirmation screen appears before use.'],
    ['Forgotten Relic',            'Misc', 'Obtainable from the Desert Hunt quest.\n\nGrants access to the <button class="enc-desc-link" data-enc-nav="Handaconda">Handaconda</button> raid and is also used to obtain the Gynx race.'],
    ['Warbing Whistle',            'Misc', 'Drops from <button class="enc-desc-link" data-enc-nav="Ptoruco">Ptoruco</button>.\n\nWhen used, the user enters a stance and after a few seconds spawns the mini-boss Pterathanaian.'],
    ['Unopened Present (unobtainable)', 'Misc', 'Can only be obtained during Winter Solstice. Grants 1 random item.\n\nCannot be traded.\n\nCommon (51%): Gold, Random Scroll\n\nRare (39%): Random Arcanium Shard, Random Potion\n\nEpic (7%): Event Accessory, Crystallized Joy, 2 Unopened Presents, Snorb, Elementary Resonance\n\nLegendary (3%): Random Lost Scroll, Random Lesser Artifact (excluding Void Keys and Echo Shards), Random Icerind Weapon, Echo Shard, Frosty Topper'],
    ['Egg Basket',                 'Misc', 'Can only be obtained during Easter. Grants 1 random item from the list below.\n\nCannot be traded.\n\nPossible drops: Rabbit Pelt, Egg Shelmet, <button class="enc-desc-link" data-enc-nav="Rabbits Foot">Rabbit\'s Foot</button>, Chocolate Egg, Gleaming Carrot, Ivory Weapons'],

    /* ── ARMOUR ──────────────────────────────────────────────────────── */
    ['Paladin Cuirass',        'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Paladin (Or)">Paladin</button>\n\nCost: 250g.\n\nStats: +20 Endurance, +17.5% Endurance.\n\nDamage Reduction: +10% Physical, +5% Holy, +5% Magic, +5% Fire.\n\nPenalty: -5% Movement Speed.'],
    ['Adept Warrior',          'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Blade Dancer (N)">Blade Dancer</button>\n\nCost: 250g.\n\nStats: +15 Endurance, +10% Endurance, +5% Strength, +16.6% Energy.\n\nDamage Reduction: +5% Physical, +10% Dark.\n\nBonus: +20% Fall Resistance.'],
    ['Raging Warrior',         'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Berserker (Ch)">Berserker</button>\n\nCost: 250g.\n\nStats: +16 Endurance, +10% Endurance, +10% Increased Healing, +10% Energy.\n\nDamage Reduction: +5% Physical, +10% Hex, +5% Fire.'],
    ['Arcane Robes',           'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Elementalist (Or)">Elementalist</button>\n\nCost: 250g.\n\nStats: +4 Arcane, +15 Endurance, +7.5% Arcane.\n\nDamage Reduction: +10% Magic, +10% Poison, +10% Holy, +10% Fire.'],
    ['Magister Apprentice',    'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Hexer (N)">Hexer</button>\n\nCost: 250g.\n\nStats: +3 Arcane, +15 Endurance, +5% Arcane, +1 HP Regen/turn.\n\nDamage Reduction: +15% Magic, +10% Poison, +10% Fire.'],
    ['Corrupt Caster',         'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Necromancer (Ch)">Necromancer</button>\n\nCost: 250g.\n\nStats: +2 Arcane, +16 Endurance, +5% Endurance, +5% Arcane, +10% Energy.\n\nDamage Reduction: +15% Magic, +10% Poison, +10% Holy.'],
    ['Lifebound Archer',       'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Ranger (Or)">Ranger</button>\n\nCost: 250g.\n\nStats: +3 Arcane, +15 Endurance, +5% Endurance, +5% Arcane, +1 HP Regen/turn, +15% Movement Speed.\n\nDamage Reduction: +10% Magic, +10% Poison, +10% Nature.'],
    ['Rogue Hunter',           'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Rogue (N)">Rogue</button>\n\nCost: 250g.\n\nStats: +15 Endurance, +7.5% Endurance, +10% Speed, +10% Energy, +1 HP Regen/turn, +20% Movement Speed, +25% Fall Resistance.\n\nDamage Reduction: +5% Physical, +5% Fire.'],
    ['Shadow Cloak',           'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Assassin (Ch)">Assassin</button>\n\nCost: 250g.\n\nStats: +13 Endurance, +7.5% Endurance, +12.5% Energy, +1 HP Regen/turn, +30% Movement Speed, +30% Fall Resistance.\n\nDamage Reduction: +5% Physical, +5% Dark.'],
    ['Traveling Pasmark',      'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Monk (Or)">Monk</button>\n\nCost: 250g.\n\nStats: +5 Strength, +16 Endurance, +7.5% Endurance, +5% Strength, +1 HP Regen/turn, +10% Fall Resistance.\n\nDamage Reduction: +5% Physical, +5% Holy, +5% Fire, +5% Dark.'],
    ['Wandering Practitioner', 'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Brawler (N)">Brawler</button>\n\nCost: 250g.\n\nStats: +18 Endurance, +7.5% Endurance, +10% Strength, +16.6% Energy, +10% Fall Resistance.\n\nDamage Reduction: +5% Physical, +10% Fire.'],
    ['Shade Walker',           'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Darkwraith (Ch)">Darkwraith</button>\n\nCost: 250g.\n\nStats: +18 Endurance, +7.5% Endurance, +5% Arcane, +10% Fall Resistance.\n\nDamage Reduction: +5% Physical, +10% Hex, +20% Dark.'],
    ['Pathfinder Martyr',      'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Saint (Or)">Saint</button>\n\nCost: 250g.\n\nStats: +3 Arcane, +1 Speed, +20 Endurance, +7.5% Endurance, +1 HP Regen/turn.\n\nDamage Reduction: +5% Physical, +15% Holy.'],
    ['Armored Lancer',         'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Lancer (N)">Lancer</button>\n\nCost: 250g.\n\nStats: +20 Endurance, +15% Endurance, +12.5% Energy.\n\nDamage Reduction: +10% Physical, +10% Magic, +5% Fire.\n\nPenalty: -5% Movement Speed.'],
    ['Bloody Menace',          'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Impaler (Ch)">Impaler</button>\n\nCost: 250g.\n\nStats: +22 Endurance, +10% Endurance, +20% Increased Healing.\n\nDamage Reduction: +10% Physical, +5% Hex, +5% Poison.'],
    ['Venerated Legionnaire',  'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Lionheart (N)">Lionheart</button>\n\nCost: 250g.\n\nStats: +17 Endurance, +12.5% Endurance.\n\nDamage Reduction: +15% Physical, +15% Fire, +10% Ice, +10% Nature, +5% Dark, +5% Magic.'],
    ['Fortified Seer',         'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Citadel (Or)">Citadel</button>\n\nCost: 250g.\n\nStats: +35 Endurance, +5% Endurance.\n\nDamage Reduction: +15% Dark, +15% Hex, +10% Holy, +10% Ice, +10% Fire, +10% Physical.'],
    ['Deathmantle',            'Armour', 'Superclass: <button class="enc-desc-link" data-enc-nav="Arbiter (N)">Arbiter</button>\n\nCost: 3,000g.\n\nStats: +25 Endurance, +2.5% Endurance, +10% Arcane.\n\nDamage Reduction: +20% Dark, +15% Holy, +10% Magic, +10% Ice, +5% Physical.'],
    ['Shadowy Crook',          'Armour', 'Cost: 100g.\n\nStats: +1 Speed, +2 Luck, +10 Endurance, +10% Movement Speed.\n\nDamage Reduction: +5% Physical.'],

    /* ── MOBS ─────────────────────────────────────────────────────────── */
    ['Goblin',            'Mob', 'Forest Night cycle mob. This enemy can block and dodge attacks.'],
    ['Star Slime',        'Mob', 'Astral Night mob. This enemy can dodge attacks.'],
    ['Gon',               'Mob', 'Forest Night cycle mob. Can only be encountered past level 15.'],
    ['Thanasludd',        'Mob', 'Forest Night cycle mob. Can only be encountered past level 20.'],
    ['Night Raider',      'Mob', 'Desert Night cycle mob. This enemy can block and dodge attacks.'],
    ['Duneguard',         'Mob', 'Desert Night cycle mob.'],
    ['Sentient Darkness', 'Mob', 'Deeproot Night cycle mob. This enemy cannot block or dodge attacks.'],
    ['Ptoruco',           'Mob', 'Deeproot Night cycle mob. Can only be encountered past level 15.'],
    ['White Bunny',       'Mob', 'Easter Events mob. Spawns only in The Crossing. This enemy can dodge attacks.'],
    ['Sand Bunny',        'Mob', 'Easter Events mob.\n\nTakes increasingly reduced damage the more consecutive hits it takes in one turn.'],
    ['Magmatic Bunny',    'Mob', 'Easter Events mob.\n\nCan have up to, but not more than, 4 energy.'],
    ['Malevolent Bunny',  'Mob', 'Easter Events mob.\n\nDoes not gain energy.'],
    ['Gigapascha',        'Mob', 'Easter Events mini-boss mob. Spawns only in The Crossing during the day. This enemy can dodge attacks.'],
    ['Frosted Slime',     'Mob', 'Winter Solstice Events mob. This enemy can dodge attacks.'],
    ['Joyous Spirit',     'Mob', 'Winter Solstice Events mob. Currently disabled from encounters due to bugs. This enemy can dodge attacks.'],
    ['Thief',             'Mob', 'The Crossing mob. This enemy can block and dodge attacks.'],
    ['Slime',             'Mob', 'Forest mob. This enemy can dodge attacks.'],
    ['Grass Spirit',      'Mob', 'Forest mob. This enemy can dodge attacks.'],
    ['Zombie Mushroom',   'Mob', 'Forest mob. This enemy can block and dodge attacks.'],
    ['Sand Elemental',    'Mob', 'Desert mob. This enemy can dodge attacks.'],
    ['Desert Bandit',     'Mob', 'Desert mob. This enemy can block and dodge attacks.'],
    ['Stray Sandstorm',   'Mob', 'Desert mob. This enemy can dodge attacks.'],
    ['Sand Golem',        'Mob', 'Desert mob. This enemy can block attacks.'],
    ['Fog Spirit',        'Mob', 'Deeproot mob. This enemy can dodge attacks.'],
    ['Venom Shroom',      'Mob', 'Deeproot mob. This enemy can block and dodge attacks.'],
    ['Cursed Corpse',     'Mob', 'Deeproot mob. This enemy can block and dodge attacks.'],
    ['Cess Horror',       'Mob', 'Deeproot mob. This enemy can block attacks.'],
    ['Lava Crab',         'Mob', 'Mount Thul mob. This enemy can dodge attacks.'],
    ['Magma Golem',       'Mob', 'Mount Thul mob. This enemy can block attacks.'],
    ['Shadeblade',        'Mini Boss', 'A shade warrior wielding twin dark blades. A swift and dangerous mini boss.'],
  ];

  /* ── Config ─────────────────────────────────────────────────────────────── */
  const TYPE_ORDER = [
    'Base Class', 'Super Class', 'Sub Class',
    'Race',
    'Enchant',
    'Ore', 'Ingredient', 'Potion', 'Weapon', 'Gear', 'Misc',
    'Artifact', 'Lesser Artifact', 'Weapon Modifier',
    'Armour',
    'Scroll', 'Lost Scroll',
    'Trainer',
    'Boss', 'Mini Boss', 'Mob', 'Covenant', 'Mark',
  ];

  const TYPE_ICONS = {
    'Base Class':      '⚔',
    'Super Class':     '✦',
    'Sub Class':       '◈',
    'Race':            '◎',
    'Enchant':         '✧',
    'Ore':             '⛏',
    'Ingredient':      '🌿',
    'Potion':          '🧪',
    'Weapon':          '🗡',
    'Gear':            '🛡',
    'Artifact':        '◆',
    'Lesser Artifact': '◇',
    'Weapon Modifier': '💎',
    'Armour':          '🛡',
    'Misc':            '📦',
    'Boss':            '☠',
    'Mini Boss':       '💀',
    'Mob':             '👾',
    'Trainer':         '🎓',
    'Scroll':          '📜',
    'Lost Scroll':     '📜',
    'Covenant':        '⚑',
    'Mark':            '◉',
  };

  const CLASS_TYPES   = new Set(['Base Class', 'Super Class', 'Sub Class', 'Race', 'Weapon', 'Gear', 'Covenant', 'Mark']);
  const NO_SORT_TYPES = new Set(['Boss', 'Mini Boss', 'Mob', 'Trainer']);

  /* Weapon families — order defines display order, prefix used for matching */
  const WEAPON_GROUPS = [
    { label: 'Ferrus',      prefix: 'Ferrus ',        desc: 'Obtained from: Caldera Weapon Shop.\n\nStarts with 6 empty Shard Slots.\n\nAllows the use of weapon-locked skills in respect to their weapon type. Has no damage buff.' },
    { label: 'Blacksteel',  prefix: 'Blacksteel ',    desc: 'Obtained from: Westwood Weapon Shop.\n\nStarts with 4 empty Shard Slots.' },
    { label: 'Dragon Bone', prefix: 'Dragon Bone ',   desc: 'Obtained from: <button class="enc-desc-link" data-enc-nav="Yar\'Thul">Yar\'Thul, The Blazing Dragon</button>.\n\nStarts with 3 empty Shard Slots.' },
    { label: 'Corealloy',   prefix: 'Corealloy ',     desc: 'Obtained from: Mysterious Merchant (Event).\n\nStarts with 5 empty Shard Slots.' },
    { label: 'Sun',         prefix: 'Sun ',           desc: 'Obtained from: <button class="enc-desc-link" data-enc-nav="Seraphon">Seraphon</button>, <button class="enc-desc-link" data-enc-nav="Arkhaia">Arkhaia</button>.\n\nStarts with 3 empty Shard Slots.' },
    { label: 'Ivory',       prefix: 'Ivory ',         desc: 'Obtained from: Egg Basket.\n\nStarts with 4 empty Shard Slots.' },
    { label: 'Jade',        prefix: 'Jade ',          desc: 'Obtained from: Mysterious Merchant (Event).\n\nStarts with 5 empty Shard Slots.' },
    { label: 'Blightrock',  prefix: 'Blightrock/wood ', desc: 'Obtained from: <button class="enc-desc-link" data-enc-nav="Thorian">Thorian, The Rotten</button>.\n\nStarts with 3 empty Shard Slots.' },
    { label: 'Icerind',     prefix: 'Icerind ',       desc: 'Obtained from: Unopened Present (currently unobtainable).\n\nStarts with 3 empty Shard Slots.' },
    { label: 'Darkblood',   prefix: 'Darkblood ',     desc: 'Obtained from: <button class="enc-desc-link" data-enc-nav="Metrom\'s Vessel">Metrom\'s Vessel</button>.\n\nStarts with 2 empty Shard Slots.' },
    { label: 'Sandstone',   prefix: 'Sandstone ',     desc: 'Obtained from: <button class="enc-desc-link" data-enc-nav="Handaconda">Handaconda</button>.\n\nStarts with 3 empty Shard Slots.' },
    { label: 'Primordial',  prefix: 'Primordial ',    desc: 'Obtained from: <button class="enc-desc-link" data-enc-nav="Handaconda">Handaconda</button>.\n\nStarts with 4 empty Shard Slots.' },
    { label: 'Unique',      names: new Set(['Vastic Glaive', 'Star-Seeing Hammer']) },
    { label: 'Shields',     names: new Set(['Ferrus Towershield', 'Ivory Shield', 'Icerind Shield', 'Sandstone Shield', 'Primordial Shield', 'Dragonflame Shield', 'Slimy Buckler', 'Targe']) },
  ];

  /* Trainer categories — order defines display order */
  const MOB_GROUPS = [
    { label: 'Day',                    names: new Set(['Thief', 'Slime', 'Grass Spirit', 'Zombie Mushroom', 'Sand Elemental', 'Desert Bandit', 'Stray Sandstorm', 'Sand Golem', 'Fog Spirit', 'Venom Shroom', 'Cursed Corpse', 'Cess Horror', 'Lava Crab', 'Magma Golem']) },
    { label: 'Night',                  names: new Set(['Goblin', 'Star Slime', 'Gon', 'Thanasludd', 'Night Raider', 'Duneguard', 'Sentient Darkness', 'Ptoruco']) },
    { label: 'Easter Enemies',         names: new Set(['White Bunny', 'Sand Bunny', 'Magmatic Bunny', 'Malevolent Bunny', 'Gigapascha']) },
    { label: 'Winter Solstice Enemies', names: new Set(['Frosted Slime', 'Joyous Spirit']) },
  ];

  const TRAINER_GROUPS = [
    { label: 'Sub Class Trainers', names: new Set(['Cantia, The Bard', 'Thorin, The Beastmaster', 'Selia, The Alchemist', 'Adelma, the Blacksmith', 'Vanio, the Miner']) },
    { label: 'Base Class Trainers', names: new Set(['Ysa, The Warrior', 'Arandor, The Wizard', 'Boots, The Thief', 'Doran, The Martial Artist', 'Tivek, The Slayer', 'Geron, the Marauder', 'Lagolt, the Sentry']) },
    { label: 'Super Class Trainers', names: new Set(['Dernon, Paladin Warrior', 'Leoran, Adept Warrior', 'Kayrein, Raging Warrior', 'Landrum, Arcane Trainer', 'Ophelia, Magister Apprentice', 'Ulys, Corrupt Caster', 'Orkin, Lifebound Archer', 'Aberon, Rogue Hunter', 'Inette, Shadow Cloak', 'Luther, Traveling Pasmark', 'Gren, Wandering Practitioner', 'Momma Darkbeast, Mother of Dark', 'Fernain, Pathfinder Martyr', 'Relan, Armored Lancer', 'Orin, Bloody Menace', 'Ardentis, Venerated Legionnaire', 'Nevithas, Fortified Seer', 'Kether, Deathmantle']) },
  ];

  const MISC_GROUPS = [
    { label: 'Event Items', names: new Set(['Unopened Present (unobtainable)', 'Egg Basket']) },
  ];

  const POTION_GROUPS = [
    { label: 'Low Tier', names: new Set(['Small Healing Potion', 'Medium Healing Potion']) },
    { label: 'Buff',     names: new Set(['Minor Absorbing Potion', 'Ferrus Skin Potion', 'Minor Empowering Elixir', 'Minor Energy Elixir', 'Average Energy Elixir', 'Stimulating Brew', 'Energetic SoulBrew', 'Invisibility Potion', 'Rejuvenating Elixir', 'Stoneskin Potion', 'Light of Grace']) },
    { label: 'N/A',      names: new Set(['Abhorrent Elixir', 'Alluring Elixir', 'Heartbreaking Elixir', 'Heartsoothing Remedy', 'Radiance Elixir']) },
  ];

  const SCROLL_GROUPS = [
    { label: 'Mastery Scroll', names: new Set(['Battleworn']) },
  ];

  /* ── Boss move / passive data ───────────────────────────────────────────── */
  const BOSS_MOVE_DATA = {
    "Yar'Thul, The Blazing Dragon": {
      passives: [
        { name: 'Can Block',           description: 'This enemy can block attacks.' },
        { name: 'Energy Surge',        description: 'Unknown chance to gain 2 energy instead of 1 per turn.' },
        { name: 'Inferno Immunity',    description: 'Immune to the Inferno status.' },
        { name: 'Lifesteal (Corrupted)', description: '[Corrupted exclusive] When dealing damage, has slight lifesteal that increases the more inferno stacks you have.' },
      ],
      learns: [
        // ── Priority moves ────────────────────────────────────────────────────
        { name: 'Inferno',           type: 'Active', cost: 0, cooldown: 0,  moveType: 'Fire',
          category: 'Status · AOE',
          condition: "It is Yar'thul's first turn",
          effect: 'Applies 1 Inferno to all opponents. The stacks gradually increase over the course of the fight (may increase more when fighting solo).' },
        { name: 'Blaze Eruption',    type: 'Active', cost: 2, cooldown: 7,  moveType: 'Fire',
          category: 'Single Hit · AOE · Unblockable / Undodgeable',
          condition: 'An opponent has the Burning status and Yar\'thul has 2 energy',
          effect: '15 Base Damage. Can only target opponents who are Burning. Cannot be countered.' },
        { name: 'Blaze Core',        type: 'Active', cost: 3, cooldown: 8,  moveType: 'Fire',
          category: 'Status',
          condition: "Yar'thul is under ~75% HP and has 3 energy",
          effect: "Consumes half of Yar'thul's current Inferno stacks to heal. Healing increases with the number of stacks consumed." },
        { name: 'Armageddon',        type: 'Active', cost: 6, cooldown: 13, moveType: 'Fire',
          category: 'Single Hit · AOE · Unblockable / Undodgeable',
          condition: "Yar'thul is under 50% HP and has 6 energy",
          effect: '? Base Damage. Applies 50% Heal Down, 3(?) Burning, and has a chance to apply 1 Stun. Bypasses all forms of counters.' },
        // ── Non-priority moves ────────────────────────────────────────────────
        { name: 'Fire Claw',         type: 'Active', cost: 0, cooldown: 0,  moveType: 'Fire',
          category: 'Single Hit · Single Target · Blockable',
          condition: '',
          effect: '15 Base Damage. Ignores half of defense on block / guard.' },
        { name: 'Hellfire',          type: 'Active', cost: 1, cooldown: 5,  moveType: 'Fire',
          category: 'Multihit · AOE · Unblockable / Undodgeable',
          condition: '',
          effect: '8 Base Damage. Hits 3×. Each hit applies 3 Burning (9 Burning total).' },
        { name: 'Magma Pillar',      type: 'Active', cost: 2, cooldown: 8,  moveType: 'Fire',
          category: 'Status · 3 turn duration',
          condition: '',
          effect: "Places a magma pillar. When a player attacks Yar'thul, they take damage and receive 2 Burning and 2(?) Inferno. Can trigger multiple times per attack." },
        { name: 'Magma Beam',        type: 'Active', cost: 4, cooldown: 9,  moveType: 'Fire',
          category: 'Single Hit · AOE · Unblockable / Undodgeable',
          condition: '',
          effect: '30 Base Damage. Charges on the first turn, then attacks on the second turn. Ignores half of the target\'s defense when they guard.' },
      ],
      loot: {
        categories: [
          { label: 'Gears',            items: ["Yarthul's Wrath", 'Blazing Perforator', 'Frostburned Rune'] },
          { label: 'Weapons',          items: ['Dragon Weapons'] },
          { label: 'Artifacts',        items: ['Reality Watch', "Narthana's Sigil", 'Shifting Hourglass', 'Skyward Totem'] },
          { label: 'Lesser Artifacts', items: ['All Lesser Artifacts'] },
        ],
        notes: [
          'Can drop Void Key while Corrupted.',
          "Can also drop Weapon Shards of any tier, any scroll including Lost Scrolls (excluding Metrom's Grasp), and blueprints.",
        ],
      },
    },

    'Thorian, The Rotten': {
      passives: [
        { name: 'Can Block',            description: 'This enemy can block attacks.' },
        { name: 'Elemental Adaptation', description: 'Adapts to the last damage type used against it. If hit by the same element while adapted to it, that hit heals Thorian instead of dealing damage.' },
        { name: 'Status Immunity',      description: 'Immune to Plague, Cursed, and Hex. Any applied Hex is converted into Vulnerable instead.' },
        { name: 'Energy Surge',         description: 'Chance to gain 2 energy instead of 1 per turn.' },
      ],
      learns: [
        // ── Priority moves (highest → lowest priority) ────────────────────────
        { name: 'Blasphemous Obliteration', type: 'Active', cost: 5, cooldown: 13, moveType: 'Hex',
          category: 'Single Hit · AOE · Unblockable / Undodgeable',
          condition: 'Thorian is below 50% HP and has 5 energy',
          effect: 'Heavy damage that ignores defense and scales with the target\'s Plague stacks. Applies 1 Plague and 3 Cursed.\n\nIf this attack deals no damage, additionally applies 2 Hexed.\n\nIgnores traps and all forms of counter.' },
        { name: 'Overflowing Curse',        type: 'Active', cost: 0, cooldown: 4,  moveType: 'Hex',
          category: 'Debuff · AOE · Unblockable / Undodgeable',
          condition: '',
          effect: 'Puts all players into a QTE window. Players must defend their soul from Thorian\'s corruption — failing the QTE applies 1 Plague stack.\n\nIgnores traps and all forms of counter.' },
        { name: 'Hexing Burst',             type: 'Active', cost: 1, cooldown: 6,  moveType: 'Hex',
          category: 'Single Hit · AOE · Unblockable / Undodgeable',
          condition: '',
          effect: 'Heals Thorian on use. Can apply Cursed and Hexed.\n\n• Applies Hex to players above ~95% HP.\n• Applies Cursed to players who have Vulnerable or Weakened.\n\nNote: Loses hard priority if any party member is not at full health — the more hurt the party is, the more likely a different move is chosen instead.' },
        { name: 'Plague Rupture',           type: 'Active', cost: 2, cooldown: 5,  moveType: 'Poison',
          category: 'Single Hit · AOE · Unblockable / Undodgeable',
          condition: '',
          effect: '8 Base Damage per hit. Ignores defense. Number of hits, Vulnerable, Weakness, and Cursed stacks applied all scale with the target\'s Plague stacks (e.g. 4 Plague = 4 hits + 4 of each status = 32 total damage).' },
        // ── Standard moves (no fixed priority, chosen at random) ──────────────
        { name: 'Cess Breath',              type: 'Active', cost: 1, cooldown: 4,  moveType: 'Poison',
          category: 'Single Hit · AOE · Unblockable / Undodgeable',
          condition: '',
          effect: '18 Base Damage. Ignores half of defense on block / guard.' },
        { name: 'Cursed Wave',              type: 'Active', cost: 2, cooldown: 5,  moveType: 'Hex',
          category: 'Single Hit · AOE · Blockable',
          condition: '',
          effect: '25 Base Damage. Deals adjacent damage to up to three players. Has a chance to apply 2 Cursed to the main target.\n\nIgnores traps and all forms of counter.' },
        { name: 'Warped Crush',             type: 'Active', cost: 0, cooldown: 0,  moveType: 'Physical',
          category: 'Single Hit · AOE · Blockable / Dodgeable',
          condition: '',
          effect: '16 Base Damage. Deals adjacent damage to up to three players. Ignores half of defense on block / guard.\n\nNote: Much lower chance of being used compared to Cess Breath and Cursed Wave.' },
      ],
      loot: {
        categories: [
          { label: 'Gears',            items: ['Aspect of Maladaptation', 'Tainted Quiver'] },
          { label: 'Weapons',          items: ['Blight Weapons'] },
          { label: 'Weapon Modifiers', items: ['Arcanium Crystal', 'Tempurus Gem'] },
          { label: 'Artifacts',        items: ['Dark Sigil', "Metrom's Amulet", 'Stellian Core', 'Skyward Totem'] },
          { label: 'Lesser Artifacts', items: ['All Lesser Artifacts'] },
        ],
        notes: [
          'Can drop Void Key while Corrupted.',
          "Can also drop Weapon Shards of any tier, any scroll including Lost Scrolls (excluding Metrom's Grasp), and blueprints.",
        ],
      },
    },

    'Pterathanaian': {
      passives: [
        { name: 'HP Regeneration',    description: 'Regenerates 10 HP per turn.' },
        { name: 'Status Immunity',    description: 'Immune to Ghostflame and Burn.' },
        { name: 'Amulet Immunity',    description: "Immune to Metrom's Amulet." },
        { name: 'Elemental Adaptation', description: 'Adapts to the last damage type used against it. If hit by the same element while adapted to it, that hit heals Pterathanaian instead of dealing damage.' },
      ],
      learns: [
        { name: 'Humming Strike',   type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical',
          category: 'Single Hit · Single Target · Blockable / Dodgeable',
          condition: '',
          effect: '??? Base Damage.' },
        { name: 'Shrieking Soul',   type: 'Active', cost: 2, cooldown: 4, moveType: 'Dark',
          category: 'Status',
          condition: '',
          effect: 'Summons 2 Ptoruco.' },
        { name: 'Wicked Element',   type: 'Active', cost: 2, cooldown: 4, moveType: 'Physical',
          category: 'Single Hit · Single Target · Blockable / Undodgeable',
          condition: '',
          effect: 'Applies 3 Sundered and 3 stacks of a random debuff (Fire, Cursed, Vulnerable, or Weakened).' },
        { name: 'Dark Descension',  type: 'Active', cost: 3, cooldown: 0, moveType: 'Dark',
          category: '??? · AOE · Unblockable / Undodgeable',
          condition: 'Pterathanaian is below 50% HP and has 3 energy',
          effect: 'Goes invisible for 1 turn before attacking. Applies 3 Cursed and 10 Poison.\n\nNote: Cooldown unknown.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Elemental Infuser', "Ptera's Heart"] },
        ],
        notes: [
          'Can drop Weapon Arcanium Shards up to Pure rarity, all Basic Scrolls, and blueprints.',
        ],
      },
    },

    'Seraphon': {
      passives: [
        { name: 'Can Block & Dodge',    description: 'This enemy can block and dodge attacks.' },
        { name: 'Amulet Immunity',      description: "Immune to Metrom's Amulet." },
        { name: 'Status Immunity',      description: 'Immune to Purified, Weakened, Blinded, and Cursed.' },
        { name: 'Energy Surge',         description: 'Chance to gain 2 energy instead of 1 per turn.' },
      ],
      learns: [
        // ── Priority moves (always used in strict priority order) ─────────────
        { name: 'Searing Light',    type: 'Active', cost: 3, cooldown: 4, moveType: 'Holy',
          category: 'Single Hit · Single Target · Blockable',
          condition: '',
          effect: '33 Base Damage. Applies 2 Purified, 2 Sundered, 2 Blinded.' },
        { name: 'Calling Light',    type: 'Active', cost: 2, cooldown: 9, moveType: 'Holy',
          category: 'Summon',
          condition: '',
          effect: 'Summons a Sheea Saint, Elementalist, or Paladin. Summoned allies have all skills from their class plus Skyward Bolt.\n\nAt less than 50% HP, summons 2 allies instead of 1.' },
        { name: 'Justice',          type: 'Active', cost: 1, cooldown: 4, moveType: 'Holy',
          category: 'Multihit · AOE · Blockable',
          condition: '',
          effect: '3 Base Damage. Hits 8×. Applies 2 Purified and 2 Blinded.' },
        { name: 'High Retribution', type: 'Active', cost: 2, cooldown: 6, moveType: 'Holy',
          category: 'Healing',
          condition: '',
          effect: 'Heals Seraphon. Healing scales with the number of debuff stacks currently on Seraphon.\n\nNote: Priority increases the more status effects and stacks Seraphon has.' },
        { name: 'Holy Javelin',     type: 'Active', cost: 0, cooldown: 0, moveType: 'Holy',
          category: 'Single Hit · Single Target · Blockable',
          condition: '',
          effect: '22 Base Damage. Applies 2 Purified.' },
      ],
      loot: {
        categories: [
          { label: 'Gears',            items: ['Imbuement Reliquary'] },
          { label: 'Weapons',          items: ['Sun Weapons'] },
          { label: 'Weapon Modifiers', items: ['Arcanium Crystal', 'Tempurus Gem'] },
          { label: 'Misc',             items: ["Raphion's Blessing"] },
          { label: 'Artifacts',        items: ['Shifting Hourglass', 'Stellian Core', 'Skyward Totem'] },
          { label: 'Lesser Artifacts', items: ['All Lesser Artifacts'] },
        ],
        notes: [
          'Can drop Void Key while Corrupted.',
          "Can also drop Weapon Shards of any tier, any scroll including Lost Scrolls (excluding Metrom's Grasp), and blueprints.",
        ],
      },
    },

    'Arkhaia': {
      passives: [
        { name: 'Can Block',         description: 'This enemy can block attacks.' },
        { name: 'HP Regeneration',   description: 'Regenerates 2 HP per turn.' },
        { name: 'Amulet Immunity',   description: "Immune to Metrom's Amulet." },
        { name: 'Status Immunity',   description: 'Immune to Ghostflame and Burn.' },
        { name: 'Energy Surge',      description: 'Chance to gain 2 energy instead of 1 per turn.' },
      ],
      learns: [
        // ── Priority moves (always used in strict priority order) ─────────────
        { name: 'Styx',                              type: 'Active', cost: 3, cooldown: 8,  moveType: 'Dark',
          category: 'Single Hit · AOE · Unblockable / Undodgeable',
          condition: '',
          effect: '65 Base Damage. Applies Heavy Stun to Arkhaia, then on the next turn slams all players for heavy damage and applies 4 Weakened and 2 Sundered.\n\nChains the target for 3 turns if no chain is currently active.\n\nAt less than 50% HP, no longer inflicts Heavy Stun on itself.' },
        { name: 'Phlegethon',                        type: 'Active', cost: 2, cooldown: 5,  moveType: 'Fire',
          category: 'Single Hit · AOE · Blockable',
          condition: '',
          effect: '45 Base Damage. Applies 4 Ghostflame. The Ghostflame is always inflicted, even on dodge.' },
        { name: 'Cocytus',                           type: 'Active', cost: 2, cooldown: 5,  moveType: 'Ice',
          category: 'Single Hit · AOE · Dodgeable',
          condition: '',
          effect: '36 Base Damage. Applies 3 Cold.' },
        { name: 'Acheron',                           type: 'Active', cost: 1, cooldown: 5,  moveType: 'Dark',
          category: 'Single Hit · Single Target · Blockable / Dodgeable',
          condition: '',
          effect: '25 Base Damage. Applies 3 Bleed.' },
        { name: 'Banshee Wail',                      type: 'Active', cost: 0, cooldown: 7,  moveType: 'Dark',
          category: 'Trap · Single Target · 3 turn duration',
          condition: 'No chain is currently active',
          effect: 'Chains 1 player for 3 turns. All damage and statuses applied to Arkhaia are redirected to the chained player.\n\n• If redirected damage brings the chained player below 50% HP, the chain is removed early.\n• If redirected damage exceeds the chained player\'s current HP, they are incapacitated — the next hit against them will be fatal and unrevivable.\n\nWill not be used if a chain is already active.' },
        { name: 'Malfeasance (Celestial Emblem only)', type: 'Active', cost: 1, cooldown: 10, moveType: 'Dark',
          category: 'Summon',
          condition: 'Fight started with Celestial Emblem equipped',
          effect: 'Summons a Sentient Darkness with 360 HP and all of its skills. Disappears after 3 turns.' },
        { name: 'Maul',                              type: 'Active', cost: 0, cooldown: 0,  moveType: 'Physical',
          category: 'Single Hit · Single Target · Blockable / Dodgeable',
          condition: '',
          effect: '21 Base Damage. Applies 2 Cursed.' },
      ],
      loot: {
        categories: [
          { label: 'Gears',            items: ['Vow of Ruin', 'Frozen Diadem', 'Frostburned Rune'] },
          { label: 'Weapons',          items: ['Star-Seeing Hammer', 'Sun Weapons'] },
          { label: 'Weapon Modifiers', items: ['Arcanium Crystal', 'Tempurus Gem'] },
          { label: 'Misc',             items: ["Arkhaia's Curse"] },
          { label: 'Artifacts',        items: ["Arkhaia's Visage", 'Dark Sigil', "Metrom's Amulet", 'Skyward Totem'] },
          { label: 'Lesser Artifacts', items: ['All Lesser Artifacts'] },
        ],
        notes: [
          'Can drop Void Key while Corrupted.',
          "Can also drop Weapon Shards of any tier, any scroll including Lost Scrolls (excluding Metrom's Grasp), and blueprints.",
        ],
      },
    },

    "Metrom's Vessel": {
      passives: [
        { name: 'Double Turn',             description: 'Has two turns where most enemies would have one. Statuses decay and DoT activates on both turns.' },
        { name: 'HP Regeneration',         description: 'Regenerates ~50 HP per turn.' },
        { name: 'Status Immunity',         description: 'Immune to Stun and Cursed.' },
        { name: "Amulet Reversal",         description: "Metrom's Amulet heals this boss instead of dealing damage." },
        { name: 'Darkblood Immunity',      description: 'Cannot have statuses from Darkblood Weapons reflected upon him.' },
        { name: 'Energy Surge',            description: 'Unknown chance to gain 2 energy instead of 1 per turn.' },
        { name: 'Can Block & Dodge',       description: 'This enemy can block and dodge attacks.' },
        { name: 'Unkillable (Phase 1)',    description: 'Cannot be killed before Phase 2. If brought to 100 HP beforehand, heals to 5,000 HP and enters Phase 2.' },
        { name: 'Phase 1 — Wings',         description: 'Spawns with 6 wings that heavily reduce incoming damage per wing. A wing disappears each time a status effect is applied or Eclipse is used. When all 6 wings are gone, enters offensive state and unlocks Oblivion.' },
        { name: 'Phase 2 — Offense/Defense', description: 'Starts Phase 2 in offensive state (high damage). After ~500 damage taken, switches to defensive state (less damage dealt and taken). Swaps back after an unknown number of turns. If at 100 HP when Phase 2 triggers, permanently stays in offensive state (likely a bug).' },
      ],
      learns: [
        // ── Priority moves (ordered by priority) ──────────────────────────
        { name: 'Unyielding Fury',    type: 'Active', cost: 2, cooldown: 11, moveType: 'Dark',     category: 'Status · AOE',
          condition: 'Phase 2 only',
          effect: 'Applies 2 Hex and 3 Blinded to all opponents. Negates their energy gain for 2 turns and locks out their ability to meditate.' },
        { name: 'Oblivion',           type: 'Active', cost: 5, cooldown: 11, moveType: 'Dark',     category: 'Multihit · AOE · Unblockable / Undodgeable',
          condition: 'Offensive state with 5 energy',
          effect: 'Hits everyone for exactly 50% of their total HP. Applies 1 Cursed, 2 Weakened, 2 Blinded. Reduces healing by 50% for 2 turns.\n\nCorrupted: Deals 60% HP. Applies 2 Cursed, 5 Weakened, 5 Blinded.' },
        { name: 'Invoke Shadeblades', type: 'Active', cost: 3, cooldown: 0,  moveType: 'Dark',     category: 'Status',
          condition: '3 energy + missing ≥1 summon',
          effect: 'Summons 2 Shadeblades (or 1 if 1 is already active). Max 2 Shadeblades at once.\n\nCorrupted: Shadeblades spawn with 300 HP instead of 200 HP.' },
        { name: 'Deathbound',         type: 'Active', cost: 2, cooldown: 7,  moveType: 'Dark',     category: 'Single Hit · Semi-AOE · Undodgeable',
          condition: '2 energy. Loses priority in Phase 2',
          effect: '15 base damage. Hits two targets. Applies 2 Sundered.\n\nCorrupted: Applies 3 Sundered instead of 2.' },
        { name: 'Eclipse',            type: 'Active', cost: 0, cooldown: 4,  moveType: 'Hex',      category: 'Status',
          condition: 'All priority moves on cooldown. Loses priority in Phase 2',
          effect: 'Increases Metrom\'s damage notably. In Phase 2 defensive state: reflects all incoming physical damage 1:1 back to the attacker.' },
        { name: 'Mini Shadebringer',  type: 'Active', cost: 0, cooldown: 4,  moveType: 'Dark',     category: 'Multihit · Single Target · Unblockable / Undodgeable',
          condition: 'Phase 2 only',
          effect: '4×3 base damage. Damage increases the longer Metrom\'s is in his offensive state in Phase 2.' },
        // ── Non-priority moves ─────────────────────────────────────────────
        { name: 'Rending Slash',      type: 'Active', cost: 0, cooldown: 0,  moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          condition: '',
          effect: '13 base damage. Ignores half of defense on block/guard. Applies 3 Weakened on hit.' },
        { name: 'Shadebringer',       type: 'Active', cost: 1, cooldown: 5,  moveType: 'Dark',     category: 'Multihit · Unblockable / Undodgeable',
          condition: '',
          effect: '8×3 base damage.\n\nDefensive state (Phase 1): Single target. Applies 1 Cursed per unblocked hit. Can be blocked solo due to a bug.\n\nOffensive state / Phase 2: Full AOE, always unblockable/undodgeable. Applies 1 Cursed per hit.' },
        { name: 'Blackout',           type: 'Active', cost: 2, cooldown: 4,  moveType: 'Dark',     category: 'Single Hit · Dodgeable',
          condition: '',
          effect: '10 base damage.\n\nDefensive state (Phase 1): Single target, dodgeable. On hit: extends your last used move\'s cooldown.\n\nOffensive state / Phase 2: Full AOE, unblockable/undodgeable. Extends everyone\'s last move cooldown. May deal less damage.' },
        { name: 'Hexed Rend',         type: 'Active', cost: 3, cooldown: 6,  moveType: 'Hex',      category: 'Single Hit · Dodgeable',
          condition: '',
          effect: '16 base damage.\n\nDefensive state (Phase 1): Single target, dodgeable (blockable for most builds). Applies 1 Hexed + 1 Cursed on hit.\n\nOffensive state / Phase 2: Full AOE, unblockable/undodgeable. Loses status application.' },
      ],
      loot: {
        categories: [
          { label: 'Gears',            items: ['Vainglorious Locket'] },
          { label: 'Weapons',          items: ['Darkblood Weapons'] },
          { label: 'Weapon Modifiers', items: ['Arcanium Crystal', 'Tempurus Gem'] },
          { label: 'Artifacts',        items: ['Chaos Orb', 'Skyward Totem'] },
          { label: 'Lesser Artifacts', items: ['All Lesser Artifacts'] },
        ],
        notes: [
          'Can drop Void Key while Corrupted.',
          'Can also drop Weapon Shards of any tier, any scroll including Lost Scrolls, and blueprints.',
        ],
      },
    },
    'Handaconda': {
      passives: [
        { name: 'Thousand Screams', description: "Gains a 5% damage increase every time Handaconda uses 'One More Time'." },
      ],
      learns: [
        { name: 'Grand Slam',      type: 'Active', cost: 0, cooldown: 12, moveType: 'Physical',
          category: 'Single Hit · AOE · Unblockable / Undodgeable',
          condition: '',
          effect: '30 Base Damage + 20% of target\'s max HP. Applies Self Heavy Stun to Handaconda, then attacks. Applies Heavy Stun 2 to all targets.' },
        { name: 'Crushing Lunge',  type: 'Active', cost: 0, cooldown: 0,  moveType: 'Physical',
          category: 'Single Hit · Single Target',
          condition: '',
          effect: 'Applies 1 Stunned.' },
        { name: 'Pulverize',       type: 'Active', cost: 0, cooldown: 0,  moveType: 'Physical',
          category: 'Single Hit · AOE',
          condition: '',
          effect: 'Deals 10% of target\'s max HP as damage. Applies 1 Soulless (applies even outside of Corrupted).' },
        { name: 'Parting Dunes',   type: 'Active', cost: 0, cooldown: 2,  moveType: 'Physical',
          category: 'Single Hit · AOE',
          condition: '',
          effect: 'Damage uses a new formula (buffed). Details unknown.' },
        { name: 'Desert Deadeye',  type: 'Active', cost: 0, cooldown: 0,  moveType: 'Physical',
          category: 'Single Hit · Single Target',
          condition: '',
          effect: '28 Base Damage.' },
        { name: 'Megido',          type: 'Active', cost: 0, cooldown: 0,  moveType: 'Physical',
          category: 'Single Hit · AOE',
          condition: '',
          effect: '45 Base Damage.' },
        { name: 'Scissors Stance', type: 'Active', cost: 0, cooldown: 0,  moveType: 'Physical',
          category: 'Stance',
          condition: '',
          effect: 'Has 3 modes. In scissors mode, Handaconda has thorns that deal damage to attackers (no longer reflects incoming damage).' },
      ],
      loot: {
        categories: [
          { label: 'Gears',   items: ['The Smallest Boulder', 'Eroded Blade', "Dust Devil's Eye", 'Open Hand'] },
          { label: 'Weapons', items: ['Sandstone Weapons', 'Primordial Weapons (Corrupted only)'] },
        ],
        notes: [],
      },
    },

    'Shadeblade': {
      passives: [
        { name: 'Summon Only', description: "Can only be summoned by Metrom's Vessel. Has no exclusive drops." },
      ],
      learns: [
        { name: 'Shade Slash', type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          condition: '',
          effect: '30 base damage. Applies 1 Sunder and steals 1 energy if the attack is not blocked or dodged.' },
      ],
    },

    'Slime King': {
      passives: [
        { name: 'Can Dodge', description: 'This enemy can dodge attacks.' },
      ],
      learns: [
        { name: 'Slime Creation',   type: 'Active', cost: 1, cooldown: 10, moveType: 'Poison',   category: 'Summon',
          effect: 'Summons a Slime with 15 HP and all Slime skills.' },
        { name: 'Crush',            type: 'Active', cost: 0, cooldown: 0,  moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deal damage.' },
        { name: 'Poison Eruption',  type: 'Active', cost: 2, cooldown: 5,  moveType: 'Poison',   category: 'Single Hit · AoE · Unblockable / Undodgeable',
          effect: 'Deal damage. Applies 3 Poison.' },
        { name: 'Scalding Spray',   type: 'Active', cost: 2, cooldown: 3,  moveType: 'Poison',   category: 'Single Hit · AoE · Blockable',
          effect: 'Deal damage. Applies 3 Poison and 2 Burn.' },
      ],
      loot: {
        categories: [
          { label: 'Gears',   items: ['Gelat Band'] },
          { label: 'Weapons', items: ['Slimy Buckler'] },
        ],
        notes: ['Can drop Weapon Arcanium Shards up to Pure rarity, all Basic Scrolls and blueprints.'],
      },
    },

    'Carnis': {
      passives: [
        { name: 'HP Regeneration', description: 'Regenerates 5 HP per turn.' },
        { name: 'Energy Surge',    description: 'Has a chance to gain 2 energy instead of 1 per turn.' },
      ],
      learns: [
        { name: 'Lesser Heal',     type: 'Active', cost: 2, cooldown: 0, moveType: 'Nature',   category: 'Healing',
          effect: 'Heals ~5% of max HP.' },
        { name: 'Tense Up',        type: 'Active', cost: 2, cooldown: 0, moveType: 'Physical', category: 'Buff',
          effect: 'Grants 30% True Damage Reduction.' },
        { name: 'Strike',          type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deal damage.' },
        { name: 'Triple Stab',     type: 'Active', cost: 2, cooldown: 0, moveType: 'Physical', category: 'Multihit · Single Target · Blockable / Dodgeable',
          effect: 'Deal damage.' },
        { name: 'Rending Barrage', type: 'Active', cost: 2, cooldown: 0, moveType: 'Physical', category: 'Multihit · Single Target · Blockable',
          effect: 'Deal damage. Deals an extra hit if the target has the Bleed status effect.' },
        { name: 'Bloody Burst',    type: 'Active', cost: 2, cooldown: 0, moveType: 'Physical', category: 'Multihit · AoE · Blockable',
          effect: 'Deal damage.' },
        { name: 'Blood Eruption',  type: 'Active', cost: 3, cooldown: 0, moveType: 'Magic',    category: 'Single Hit · AoE · Unblockable / Undodgeable',
          effect: 'Deal damage. Applies 5 Bleed.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Tear Blood Crystal'] },
        ],
        notes: ['Can drop Weapon Arcanium Shards up to Pure rarity, all Basic Scrolls and blueprints.'],
      },
    },

    'White Bunny': {
      passives: [
        { name: 'Regeneration',     description: 'Regenerates 4 HP per turn.' },
        { name: 'Locked And Loaded', description: 'Unknown effect.' },
        { name: '???',              description: 'When the bunny dodges a hit, it gains 2(?) energy.' },
      ],
      learns: [
        { name: 'Hop Kick',     type: 'Active', cost: 1, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 6 damage.' },
        { name: 'Craze Frenzy', type: 'Active', cost: 4, cooldown: 9, moveType: 'Physical', category: 'Multihit (x10) · Single Target · Blockable / Dodgeable',
          effect: 'Deals 1×10 damage.' },
      ],
      loot: { categories: [], notes: [] },
    },

    'Sand Bunny': {
      passives: [],
      learns: [
        { name: 'Hop Kick',     type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: '' },
        { name: "Sand Em' Home", type: 'Active', cost: 4, cooldown: 0, moveType: 'Physical', category: 'Single Hit · AoE · Unblockable / Undodgeable',
          effect: 'Deals 20 damage.' },
      ],
      loot: { categories: [], notes: [] },
    },

    'Magmatic Bunny': {
      passives: [],
      learns: [
        { name: 'Hop Kick',          type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: '' },
        { name: 'Earful of Magma',   type: 'Active', cost: 3, cooldown: 0, moveType: 'Fire',     category: 'Single Hit · Single Target · Unblockable / Undodgeable',
          effect: 'Applies Burning and Vulnerable.' },
      ],
      loot: { categories: [], notes: [] },
    },

    'Malevolent Bunny': {
      passives: [],
      learns: [
        { name: 'Hop Kick',     type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: '' },
        { name: 'Black Warren', type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Summon',
          effect: 'Summons another Malevolent Bunny with half the summoner\'s current max HP.' },
      ],
      loot: { categories: [], notes: [] },
    },

    'Gigapascha': {
      passives: [
        { name: 'Regeneration', description: 'Regenerates 8 HP per turn.' },
        { name: 'Form Swap (?)', description: 'Ravenous Form — does something. Triggers once below ~60% max HP.' },
      ],
      learns: [
        { name: 'Devastating Hop', type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · AoE · Unblockable / Undodgeable',
          effect: 'Deals 25 damage.' },
        { name: 'Shell Supreme',   type: 'Active', cost: 2, cooldown: 9, moveType: 'Holy',     category: 'Single Target · Unblockable / Undodgeable',
          effect: '' },
        { name: "Easter's Morning", type: 'Active', cost: 5, cooldown: 0, moveType: 'Holy',    category: 'Single Hit · AoE · Unblockable / Undodgeable',
          effect: 'Deals 50 damage.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Rabbit Pelt', 'Egg Shelmet', 'Chocolate Egg', 'Party Egg', 'Gleaming Carrot', 'Rabbits Foot'] },
        ],
        notes: [],
      },
    },

    'Frosted Slime': {
      passives: [
        { name: 'Energy Chance', description: 'Has a chance to gain an extra energy on its turn.' },
      ],
      learns: [
        { name: 'Frosty Smack', type: 'Active', cost: 0, cooldown: 0, moveType: 'Ice', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 5 damage.' },
        { name: 'Frost Spit',   type: 'Active', cost: 2, cooldown: 2, moveType: 'Ice', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 7.3 damage. Applies 2 Cold to the target.' },
        { name: 'Present',      type: 'Active', cost: 3, cooldown: 4, moveType: 'Ice', category: 'Single Hit · Single Target · Dodgeable',
          effect: 'Does one of two effects: deals 11 damage to the target, or heals the target 10(?) HP (this heal will remove Overheat stacks).' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Snorb', 'Elementary Resonance', 'Frosty Topper'] },
        ],
        notes: ['Drops 2 Crystallized Joy (4 if Corrupted).', 'Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Joyous Spirit': {
      passives: [
        { name: '?', description: 'Unknown.' },
      ],
      learns: [
        { name: '?', type: 'Active', cost: 0, cooldown: 0, moveType: '?', category: '?', effect: 'Unknown.' },
        { name: '?', type: 'Active', cost: 0, cooldown: 0, moveType: '?', category: '?', effect: 'Unknown.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Snorb', 'Elementary Resonance', 'Frosty Topper'] },
        ],
        notes: ['Drops 2 Crystallized Joy (4 if Corrupted).', 'Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Thief': {
      passives: [
        { name: 'Random Race', description: 'Spawns with a random Race (cosmetic only). Cannot spawn with Obtainable or 1% Races.' },
      ],
      learns: [
        { name: 'Strike', type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 5 damage.' },
        { name: 'Stab',   type: 'Active', cost: 1, cooldown: 2, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 6 damage. Applies 2 Bleed. Has a 40% extra chance to crit. The enemy can "fail the QTE" for this move.' },
        { name: 'Steal',  type: 'Active', cost: 2, cooldown: 1, moveType: 'Physical', category: 'Single Target · Dodgeable',
          effect: 'Steals 15% of your money. Gives stolen money to the killer on death.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Shattered Clockhand', 'The Biggest Pebble', 'Arbusta Tear'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Slime': {
      passives: [],
      learns: [
        { name: 'Smack',     type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 6 damage.' },
        { name: 'Acid Spit', type: 'Active', cost: 2, cooldown: 4, moveType: 'Poison',   category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 4 damage. Applies 2 Poison.' },
      ],
      loot: {
        categories: [
          { label: 'Ingredients', items: ['Slime Chunk'] },
          { label: 'Gears',       items: ['The Biggest Pebble', 'Arbusta Tear'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Grass Spirit': {
      passives: [
        { name: 'Regeneration', description: 'Regenerates 1 HP per turn.' },
      ],
      learns: [
        { name: "Nature's Embrace", type: 'Active', cost: 2, cooldown: 4, moveType: 'Nature',   category: 'Healing · AoE',
          effect: 'Heals self and allies for 40% of their max HP.' },
        { name: 'Grass Bolt',       type: 'Active', cost: 0, cooldown: 0, moveType: 'Nature',   category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 6 damage.' },
        { name: 'Vine Trap',        type: 'Active', cost: 3, cooldown: 7, moveType: 'Physical', category: 'Single Target · Dodgeable',
          effect: 'Applies 3 Stun and 2 Crippling.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Arbusta Tear', 'Forest Charm'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Zombie Mushroom': {
      passives: [],
      learns: [
        { name: 'Shroom Punch', type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 5 damage.' },
        { name: 'Poison Spew',  type: 'Active', cost: 2, cooldown: 5, moveType: 'Poison',   category: 'Single Hit · AoE · Unblockable / Undodgeable',
          effect: 'Deals 2 damage. Applies 2 Poison.' },
        { name: 'Spore Strike', type: 'Active', cost: 2, cooldown: 4, moveType: 'Poison',   category: 'Multihit (x2) · Single Target · Dodgeable',
          effect: 'Deals 5 damage then 6 damage. Applies 1 Stunned and 2 Blinded on the second hit.' },
      ],
      loot: {
        categories: [
          { label: 'Ingredients', items: ['Mushroom Cap'] },
          { label: 'Gears',       items: ['Arbusta Tear', 'Spore Root'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Sand Elemental': {
      passives: [],
      learns: [
        { name: 'Sand Blast',  type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 8 damage.' },
        { name: 'Sandscreen',  type: 'Active', cost: 2, cooldown: 0, moveType: 'Physical', category: 'Single Hit · AoE · Unblockable / Undodgeable',
          effect: 'Deals 7 damage. Applies 2 Blind. Also applies 2 Weakened if the target is already Blind.' },
        { name: 'Dust Bomb',   type: 'Active', cost: 3, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 18 damage. Applies 2 Vulnerable.' },
      ],
      loot: {
        categories: [
          { label: 'Ingredients', items: ['Sand Core'] },
          { label: 'Gears',       items: ['Crystal Sphere'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Desert Bandit': {
      passives: [
        { name: 'Random Race', description: 'Spawns with a random Race and gains its first Move. Cannot spawn with Obtainable or 1% Races.' },
      ],
      learns: [
        { name: 'Sand Blade',       type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 8 damage.' },
        { name: 'Scimitar Impale',  type: 'Active', cost: 2, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 11 damage. Applies 4 Bleed if the attack is not blocked or dodged.' },
        { name: 'Dust Implode',     type: 'Active', cost: 3, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Dodgeable',
          effect: 'Deals 5 damage. Applies 3 Crippled and places a bomb on the target. The bomb explodes after 2 turns dealing 15 damage. The bomb is not applied if the attack is blocked or dodged.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Spiked Steel Ball'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Stray Sandstorm': {
      passives: [],
      learns: [
        { name: 'Dust Pulse',     type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 7 damage.' },
        { name: 'Sand Reform',    type: 'Active', cost: 2, cooldown: 0, moveType: 'Physical', category: 'Buff · Self',
          effect: 'Applies 2 Weakened and 2 Vulnerable to self. Heals all allies for 10% of their max HP. Grants all allies 5% HP regen for 4 turns.' },
        { name: 'Sand Meteor',    type: 'Active', cost: 3, cooldown: 0, moveType: 'Physical', category: 'Single Hit · AoE · Unblockable / Undodgeable',
          effect: 'Spawns a large meteor. After 3 turns it crashes down, dealing damage and applying 2 Weakened.' },
        { name: 'Swirling Storm', type: 'Active', cost: 3, cooldown: 0, moveType: 'Physical', category: 'Buff · AoE',
          effect: 'Grants all allies 13% melee damage reflection for 5 turns.' },
      ],
      loot: {
        categories: [
          { label: 'Ingredients', items: ['Restless Fragment'] },
          { label: 'Gears',       items: ['Dust Storm', 'Ramizcan Idol', 'Grain Of Balance (BUGGED?)'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Sand Golem': {
      passives: [
        { name: 'Regeneration',   description: 'Regenerates 2 HP per turn.' },
        { name: 'Crushing Force', description: 'Deals 75% damage instead of 50% when an attack is blocked.' },
      ],
      learns: [
        { name: 'Smash',        type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 10 damage.' },
        { name: 'Dust Burst',   type: 'Active', cost: 2, cooldown: 0, moveType: 'Physical', category: 'Multihit · Single Target · Dodgeable',
          effect: 'Deals 6 damage per hit. Applies 1 Stun if the target is Blind.' },
        { name: 'Core Rage',    type: 'Active', cost: 2, cooldown: 0, moveType: 'Physical', category: 'Buff · Self',
          effect: 'Applies Heavy Stun to self. On the next turn gains 40% Damage Buff, 15% Damage Reduction, and 2 HP regen. Can be cancelled if enough damage is dealt before the Stun ends. Stackable.' },
        { name: 'Sand Eruption', type: 'Active', cost: 3, cooldown: 0, moveType: 'Physical', category: 'Single Hit · AoE · Dodgeable',
          effect: 'Deals 22 damage. Applies 4 Crippled, 2 Weakened, and 1 Vulnerable to all players hit.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Golem Rune Core', 'Stone Brand', 'Band of Crushing Force'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Fog Spirit': {
      passives: [],
      learns: [
        { name: 'Fog Spread',       type: 'Active', cost: 0, cooldown: 0, moveType: 'Nature', category: 'Single Hit · AoE · Dodgeable',
          effect: 'Deals 7 damage.' },
        { name: 'Airborne Toxins',  type: 'Active', cost: 2, cooldown: 0, moveType: 'Poison', category: 'Single Hit · AoE · Unblockable / Undodgeable',
          effect: 'Deals 7 damage.' },
        { name: 'Haze Reflection',  type: 'Active', cost: 3, cooldown: 0, moveType: 'Nature', category: 'Buff · Self',
          effect: 'Reflects all damage back to the dealer for 3 turns.' },
      ],
      loot: {
        categories: [
          { label: 'Ingredients', items: ['Haze Chunk'] },
          { label: 'Gears',       items: ['Shard of Blight', 'Expedite Anklet'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Venom Shroom': {
      passives: [
        { name: 'Poison Absorption', description: 'Poison element attacks heal instead of deal damage.' },
      ],
      learns: [
        { name: 'Poison Breath', type: 'Active', cost: 0, cooldown: 0, moveType: 'Poison', category: 'Single Hit · Single Target · Blockable',
          effect: 'Deals 6 damage. Applies 3 Poison.' },
        { name: 'Toxic Burst',   type: 'Active', cost: 2, cooldown: 0, moveType: 'Poison', category: 'Single Hit · AoE · Unblockable / Undodgeable',
          effect: 'Charge attack — on the next turn deals damage. If the target has Poison, applies 2 Cursed. Cancels if Venom Shroom is below 50% HP.' },
        { name: 'Poison Spikes', type: 'Active', cost: 2, cooldown: 0, moveType: 'Poison', category: 'Buff · Self',
          effect: 'Grants melee damage reflection (inconsistent).' },
      ],
      loot: {
        categories: [
          { label: 'Ingredients', items: ['Mushroom Cap'] },
          { label: 'Gears',       items: ['Wicked Crown'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Cursed Corpse': {
      passives: [
        { name: 'Random Race', description: 'Spawns with a random Race and gains its first Move. Cannot spawn with Obtainable or 1% Races.' },
      ],
      learns: [
        { name: 'Toxic Claw',   type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 9 damage. Applies 2 Poison.' },
        { name: 'Cursed Blow',  type: 'Active', cost: 2, cooldown: 0, moveType: 'Hex',      category: 'Single Hit · Single Target · Dodgeable',
          effect: 'Deals 16 damage. Applies 2 Hex.' },
        { name: 'Soul Curse',   type: 'Active', cost: 2, cooldown: 0, moveType: 'Hex',      category: 'Buff · Self',
          effect: 'Heals 5% HP and becomes immune to the last damage type received. Can only be immune to one type at a time.' },
        { name: 'Blooming Hex', type: 'Active', cost: 3, cooldown: 0, moveType: 'Hex',      category: 'Debuff · AoE',
          effect: 'Only usable when a target is below 50% HP. Applies 2 Weakened and 2 Crippled. When any player attempts to heal, applies 2 Heavy Stun and 1 Sundered.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Cursed Brand', 'Coagulated Finger Nail', 'Shard of Blight', "Traveler's Lamp"] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Cess Horror': {
      passives: [
        { name: 'Regeneration', description: 'Regenerates 2 HP per turn.' },
      ],
      learns: [
        { name: 'Imbued Strike',        type: 'Active', cost: 0, cooldown: 0, moveType: 'Dark', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 12 damage. Applies 1 Weakened.' },
        { name: 'Cursed Skewer',        type: 'Active', cost: 2, cooldown: 0, moveType: 'Hex',  category: 'Single Hit · Single Target · Unblockable / Undodgeable',
          effect: 'Deals 11 damage. Applies 2 Sundered.' },
        { name: 'Darkness Infliction',  type: 'Active', cost: 2, cooldown: 0, moveType: '?',    category: 'Debuff · AoE',
          effect: 'Clears all status effects from self. Applies 2 Vulnerable to all players in the fight.' },
        { name: 'Hex Corridor',         type: 'Active', cost: 0, cooldown: 0, moveType: '?',    category: '?',
          effect: 'Unknown.' },
      ],
      loot: {
        categories: [
          { label: 'Ingredients', items: ['Rot Core'] },
          { label: 'Gears',       items: ['Sanguine Fang'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Lava Crab': {
      passives: [
        { name: 'Regeneration', description: 'Regenerates 2 HP per turn.' },
      ],
      learns: [
        { name: 'Lava Spit', type: 'Active', cost: 0, cooldown: 0, moveType: 'Fire', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 10 damage. Has a chance to apply 2 Burning.' },
        { name: 'Lava Bomb', type: 'Active', cost: 2, cooldown: 0, moveType: 'Fire', category: 'Single Hit · AoE · Unblockable / Undodgeable',
          effect: 'Deals 10 damage. Applies 2 Weakened.' },
        { name: 'Lava Pool', type: 'Active', cost: 3, cooldown: 0, moveType: 'Fire', category: 'Buff · Self',
          effect: 'Places a pool under the caster. All melee attacks against the caster deal 15 damage back to the attacker and apply 4 Burning.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Imperial Headband', 'Magma Charm', 'Molten Carapace'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Magma Golem': {
      passives: [
        { name: 'Crushing Force', description: 'Blocked attacks deal 75% damage instead of 50% of their original damage.' },
      ],
      learns: [
        { name: 'Lava Crush',    type: 'Active', cost: 0, cooldown: 0, moveType: 'Fire', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 12 damage. Always applies 1 Burning, including on dodge.' },
        { name: 'Lava Armor',    type: 'Active', cost: 1, cooldown: 0, moveType: 'Fire', category: 'Buff · Self',
          effect: 'Places armor on self. Shares a portion of melee damage taken with the attacker.' },
        { name: 'Magma Breath',  type: 'Active', cost: 2, cooldown: 0, moveType: 'Fire', category: 'Multihit (x6) · Pseudo AoE · Unblockable / Undodgeable',
          effect: 'Deals 6 hits of 1.5 damage. Applies 2 Burning on the last hit.' },
        { name: 'Lava Domain',   type: 'Active', cost: 3, cooldown: 0, moveType: 'Fire', category: 'Debuff · AoE',
          effect: 'Applies 4 Vulnerable and 1 Hex to all opponents.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Vulcan Knuckle', 'Blazing Brand'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Star Slime': {
      passives: [
        { name: 'Damage Cap', description: 'Can only take up to 5 damage per turn. Metrom Amulet, Spiked Steel Ball, and a few other moves can bypass this.' },
      ],
      learns: [
        { name: 'Seeing Stars',   type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals damage. Has a chance to apply 1 Stun.' },
        { name: 'Acid Star',      type: 'Active', cost: 2, cooldown: 0, moveType: 'Poison',   category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals damage. Applies 3 Poison.' },
        { name: 'Crash Landing',  type: 'Active', cost: 3, cooldown: 0, moveType: 'Poison',   category: 'Single Hit · Single Target · Unblockable / Undodgeable',
          effect: 'Applies 2 Invisibility to self. On the next turn, launches a projectile dealing damage and applying 3 Poison and 3 Vulnerable.' },
      ],
      loot: {
        categories: [
          { label: 'Gears',         items: ['Crystalized Star'] },
          { label: 'Miscellaneous', items: ['Starslime Chunk', 'Astral Shards'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Goblin': {
      passives: [
        { name: 'Base Class', description: 'Spawns with a random Base Class and gains all of its moves.' },
      ],
      learns: [
        { name: 'Strike', type: 'Active', cost: 0, cooldown: 0,  moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 5 damage.' },
        { name: 'Rally',  type: 'Active', cost: 2, cooldown: 30, moveType: 'Physical', category: 'Summon',
          effect: 'Summons a Goblin. The summoned Goblin cannot summon another Goblin, and disappears when the summoner dies.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Parasitic Leech'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Gon': {
      passives: [
        { name: 'Regeneration', description: 'Regenerates 2 HP per turn.' },
      ],
      learns: [
        { name: 'Strike',           type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Unknown.' },
        { name: 'Caustic Backhand', type: 'Active', cost: 0, cooldown: 1, moveType: 'Poison',   category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Applies 2 Vulnerable and 4 Poison on hit.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Crystalized Star'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Thanasludd': {
      passives: [
        { name: 'Regeneration', description: 'Regenerates 2 HP per turn.' },
      ],
      learns: [
        { name: 'Rotting Bash',     type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Applies 1 Weakened on hit.' },
        { name: 'Inflame',          type: 'Active', cost: 1, cooldown: 4, moveType: 'Fire',     category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Applies 5 Vulnerable and 3 Burn on hit.' },
        { name: 'Unraveling Flesh', type: 'Active', cost: 1, cooldown: 8, moveType: '?',        category: 'Single Hit · AoE · Unblockable / Undodgeable',
          effect: 'Unknown.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Crystalized Star'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Night Raider': {
      passives: [
        { name: 'Random Race', description: 'Spawns with a random Race and gains its first Move. Cannot spawn with Obtainable or 1% Races.' },
      ],
      learns: [
        { name: 'Sandcleaver',       type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 10 damage.' },
        { name: 'Pocket Quicksand',  type: 'Active', cost: 1, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Dodgeable',
          effect: 'Deals 6 damage. Applies 4 Blind on hit.' },
        { name: 'Dust Implode Alter',type: 'Active', cost: 1, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Dodgeable',
          effect: 'Deals 5 damage. Applies 3 Crippled and places a bomb on the target. The bomb explodes after 3 turns dealing 20 damage.' },
        { name: 'Scimitar Impale',   type: 'Active', cost: 2, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 16 damage. Applies 4 Bleed if not blocked or dodged.' },
        { name: 'Thousand Nights',   type: 'Active', cost: 3, cooldown: 0, moveType: 'Physical', category: 'Multihit (x4) · Single Target · Unblockable / Undodgeable',
          effect: 'Applies 1 Heavy Stun to self. On the next turn, dashes to target and lands 4 hits of damage. Applies 4 Bleed.' },
      ],
      loot: {
        categories: [],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Duneguard': {
      passives: [
        { name: 'Regeneration', description: 'Regenerates 4 HP per turn.' },
      ],
      learns: [
        { name: 'Clobber',        type: 'Active', cost: 0, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 14 damage.' },
        { name: 'Sand Castling',  type: 'Active', cost: 0, cooldown: 0, moveType: '?',        category: '?',
          effect: 'Unknown.' },
        { name: 'Desert Pierce',  type: 'Active', cost: 2, cooldown: 0, moveType: 'Physical', category: 'Single Hit · Single Target · Dodgeable',
          effect: 'Deals 15 damage. Applies 1 Stun to itself, and 3 Crippled and 3 Vulnerable to the target.' },
      ],
      loot: {
        categories: [
          { label: 'Gears', items: ['Desert Escutcheon'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Sentient Darkness': {
      passives: [
        { name: 'Weakening', description: 'The less HP it has, the less damage it deals.' },
      ],
      learns: [
        { name: 'The End is Nigh', type: 'Active', cost: 0, cooldown: 0, moveType: 'Dark', category: 'Intimidation',
          effect: 'Currently does nothing — allows you to attack first.' },
        { name: 'Doom',           type: 'Active', cost: 0, cooldown: 0, moveType: 'Dark', category: 'Single Hit · Single Target · Blockable / Dodgeable',
          effect: 'Deals 75 damage.' },
        { name: 'Thread Fate',    type: 'Active', cost: 2, cooldown: 0, moveType: 'Dark', category: 'Single Hit · AoE · Unblockable / Undodgeable',
          effect: 'Deals 65 damage. Applies 3 Vulnerable.' },
      ],
      loot: {
        categories: [
          { label: 'Ingredients', items: ['Rot Core'] },
          { label: 'Gears',       items: ['Cursed Brand', 'Shard of Blight'] },
        ],
        notes: ['Also drops a Whistle.', 'Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },

    'Ptoruco': {
      passives: [
        { name: '?', description: 'Unknown.' },
      ],
      learns: [
        { name: '?', type: 'Active', cost: 0, cooldown: 0, moveType: '?', category: '?', effect: 'Unknown.' },
        { name: '?', type: 'Active', cost: 0, cooldown: 0, moveType: '?', category: '?', effect: 'Unknown.' },
      ],
      loot: {
        categories: [
          { label: 'Ingredients',   items: ['Rot Core'] },
          { label: 'Miscellaneous', items: ['Warbing Whistle'] },
        ],
        notes: ['Can drop all Basic Scrolls except Self Cure.', 'Can drop any droppable Blueprint Armors.', 'Can drop Weapon Arcanium Shards up to Pure rarity.'],
      },
    },
  };

  /* ── Mark (Petent) data ─────────────────────────────────────────────────── */
  const MARK_DATA = {
    'Petent': {
      innatePassives: [
        { name: 'Step 1 — Exploration',  description: 'Visit every location and kill every enemy and boss in the game (with a few exclusions — see the checklist). After completing this, holding a Void Key will make it glow bright pink.' },
        { name: 'Step 2 — Void Trials',  description: 'Hold a Void Key (only required for the first tier) and jump into the void in Caldera, Desert, and Deeproot. Defeat the enemy of each void trial to receive a Soul Quiver.' },
        { name: 'Step 3 — Quests',       description: 'Complete every quest in the game (with a few exclusions — refer to the spreadsheet).' },
        { name: 'Step 4 — Soul Vault Wipe', description: 'Place a Void Key inside your Soul Vault, then wipe by any means. If all previous steps were completed correctly, your Petent tier will increase.' },
      ],
      learns: [
        { name: 'Tier 1 — Rima',         type: 'Passive',
          effect: 'Grants the item "Rima". Hold it out and say a location name to open a portal — you and your party can travel through it.\n\nLocations unlocked per trial:\n• Zombie Mushroom Trial → Caldera\n• Sand Golem Trial → Ruins, Blades, Volcano\n• Cursed Corpse Trial → Deeproot, Westwood, Cessgrounds' },
        { name: 'Tier 3 — Conisura',      type: 'Active', cost: 3, cooldown: 10, moveType: 'Magic', damage: 7, scaling: 'STR/ARC',
          effect: 'Opens a rift on an enemy, sucking out all status effects currently applied to them, then exploding for damage.\n\nBase damage: 7. Increases by 3 per unique status absorbed, or 6 if the status was Hexed. All negative statuses on the target are removed on use.' },
        { name: 'Tier 5 — Dominioneer',   type: 'Passive',
          effect: 'Decreases all environmental damage slightly. (Currently bugged and non-functional.)\n\nInnate abilities:\n• You can now fight void trials at any time.\n• After completing a void trial, its linked locations are permanently unlocked on that character and persist through all future wipes.' },
      ],
    },
    'Venia': {
      innatePassives: [
        { name: 'Step 1 — Midas Enchant',       description: 'Obtain the Midas enchant.' },
        { name: 'Step 2 — Sell Lesser Artifacts', description: 'Sell Resplendent Essence, Memory Fragment, Soul Dust, Lineage Shard, and Phoenix Tear in any order. If done correctly you will receive a Soul Quiver. You do not need 50k gold while doing this step.' },
        { name: 'Step 3 — 50k Gold',             description: 'Accumulate 50,000 gold.' },
        { name: 'Step 4 — Artifact Sacrifice',   description: 'Sacrifice artifacts to each of the 4 Venia Orbs around the map. Each orb consumes 3 artifacts total. Only unbroken, wanted artifacts count — the artifacts each orb wants persist through all wipes.\n\nOrb Locations (2 of 4 known):\n• Caldera Orb — near the Fists base class trainer at spawn\n• Blades Orb — outside the Blades of the World location, on the path between the two sides of the ravine\n\nAccepted artifacts by source:\n• Lesser Artifacts: Memory Fragment, Soul Dust, Lineage Shard, Phoenix Tear, Resplendent Essence, Void Key, Echo Shard\n• Yar\'thul drops: Reality Watch, Narthana\'s Sigil, Shifting Hourglass\n• Thorian drops: Dark Sigil, Metrom\'s Amulet, Stellian Core\n• Metrom\'s Vessel / Other: Chaos Orb, Skyward Totem' },
        { name: 'Step 5 — Wipe',                 description: 'Wipe while still holding the Midas enchant and 50k gold on you. If all previous steps were completed correctly, your Venia tier will increase.' },
      ],
      learns: [
        { name: 'Tier 1 — Muto',    type: 'Passive',
          effect: 'Grants the item "Muto". Use it to sell artifacts for Primal Essence and purchase others. Primal Essence persists on your slot through wipes. Buy/sell ratio is roughly 1:3.5.\n\nPrices:\n• Memory Fragment / Soul Dust — 10 sell | 35 buy\n• Resplendent Essence / Dark Sigil — 100 sell | 350 buy\n• Shifting Hourglass — 100 sell | 245 buy\n• Reality Watch / Narthana\'s Sigil — 80 sell | 280 buy\n• Metrom\'s Amulet — 180 sell | 630 buy\n• Skyward Totem — ??? sell | 1,025 buy' },
        { name: 'Tier 3 — Permuth', type: 'Active', cost: 2, cooldown: 10, moveType: 'Magic', duration: 2,
          effect: 'Consumes 5% of your current HP and grants a random stat buff of 40% for 2 turns. ~50% chance to buff your highest invested stat, ~50% chance to buff another stat. Buffs to Endurance result in a defense buff instead. Fails if you don\'t have enough HP.\n\nNote: Stats shown in brackets are not included in stat buff calculations.' },
        { name: 'Tier 5 — Venian',  type: 'Passive',
          effect: 'After finishing a fight, you receive gold equal to 5× your current level. Your level is the only factor affecting the gold received.' },
      ],
    },
    'Astra': {
      innatePassives: [
        { name: 'Step 1 — Materials',         description: 'Obtain 5 Astral Shards, a Stellian Core, and 15,000 gold.' },
        { name: 'Step 2 — Celestial Emblem',  description: 'Go to The Forgotten Sanctum and talk to El\'heith. He will craft the Celestial Emblem for you using the materials from Step 1.' },
        { name: 'Step 3 — Enemy Kills',       description: 'Defeat the following enemies while the Celestial Emblem is equipped. The player with Celestial Emblem must be the one who initiates the fight.\n\n• Astral: Star Slime\n• Crossing: Goblin, Thanasludd, Gon\n• Desert: Night Raider, Duneguard\n• Deeproot: Sentient Darkness, Ptoruco' },
        { name: 'Step 4 — Defeat Arkhaia',    description: 'Defeat Arkhaia while you have the Celestial Emblem equipped. Either you or someone with Celestial Emblem must initiate the fight.' },
        { name: 'Step 5 — Wipe',              description: 'Wipe while the Celestial Emblem is equipped. If all previous steps were completed correctly, your Astra tier will increase.' },
      ],
      learns: [
        { name: 'Tier 1 — Starborn', type: 'Passive',
          effect: 'Whenever you land a critical hit or apply a status effect, you spawn a miniature star. You can hold up to 8 stars at once. Stars are consumed by abilities gained at later tiers.' },
        { name: 'Tier 3 — Edo',      type: 'Active', cost: 1, cooldown: 8, moveType: 'Magic', duration: 5,
          effect: 'Requires at least 5 stars active. Consumes 5+ stars to grant everyone on your team a random positive effect.\n\nPossible effects: cleanse, heal, speed boost, defense buff, or increased enchant proc chance.' },
        { name: 'Tier 5 — Utor',     type: 'Active', cost: 1, cooldown: 7, moveType: 'Magic',
          effect: 'Consumes 2–4 of your stars to restore HP and energy.\n\n• 2 stars → 20% max HP restored\n• 3 stars → 33% max HP restored\n• 4 stars → 40% max HP restored + 2 energy\n\nAffected by both Incoming and Outgoing heal stats.' },
      ],
    },
  };

  /* ── Covenant data ──────────────────────────────────────────────────────── */
  const COVENANT_DATA = {
    'Blades of the World': {
      innatePassives: [],
      learns: [
        { level: 1,  type: 'Passive', name: 'Mercenary',            quote: '', effect: 'Gain 50% more gold from guild requests and 3× the potion rewards.' },
        { level: 3,  type: 'Passive', name: 'Initiate Blade',       quote: '', effect: 'Grants access to the Blades questboard.' },
        { level: 5,  type: 'Passive', name: "Assassin's Cape",      quote: '', effect: 'Reward item.' },
        { level: 10, type: 'Active',  name: 'Gilded Strike',        quote: '', cost: 2, cooldown: 9, moveType: 'Holy', category: 'Attack', damage: 12, scaling: 'STR/75', effect: "Gain a portion of the enemy's HP in gold on hit. Increases to 190% with the Avarice passive. Does not work on bosses." },
        { level: 13, type: 'Passive', name: "Mercenary's Cape",     quote: '', effect: 'Reward item.' },
        { level: 15, type: 'Passive', name: 'Avarice',              quote: '', effect: 'Gain 30% more gold. The Mysterious Merchant respects you — roughly 30% discount and increased sell prices.' },
        { level: 20, type: 'Passive', name: 'Blessing of Survival', quote: '', effect: 'Grants Mulligan upon reaching 0 HP — survive 1 more turn with 0.1 HP.' },
      ],
    },
    'Way of Life': {
      innatePassives: [],
      learns: [
        { level: 1,  type: 'Passive', name: 'Gatherer',          quote: '', effect: 'Chance to get double the yield when collecting an ingredient.' },
        { level: 5,  type: 'Passive', name: 'Lifebound',         quote: '', effect: 'Gives 15% Outgoing Healing.' },
        { level: 7,  type: 'Passive', name: "Alchemist's Scarf", quote: '', effect: 'Reward item.' },
        { level: 10, type: 'Active',  name: 'Lesser Heal',       quote: '', cost: 2, cooldown: 6, moveType: 'Nature', scaling: 'Outgoing%', effect: 'Heals a target for a base amount. Scales with Outgoing Healing stat.' },
        { level: 13, type: 'Passive', name: 'Blindfold',         quote: '', effect: 'Reward item.' },
        { level: 15, type: 'Passive', name: 'Graced One',        quote: '', effect: 'Lesser Heal now heals for more.' },
        { level: 20, type: 'Passive', name: 'Blessing of Life',  quote: '', effect: 'Doubles all passive regen in fights and adds an additional 1% max HP regen per turn. Grants 1% max HP passive regen every 3 seconds out of combat.' },
      ],
    },
    'Church of Raphion': {
      innatePassives: [],
      learns: [
        { level: 0,  type: 'Active',  name: 'Bless',            quote: '', cost: 1, cooldown: 5, moveType: 'Holy', category: 'Support', scaling: 'Unknown', effect: 'Clears basic debuffs (Burn, Vulnerable, and others) from a target. Heals them for 2% per type of debuff cleansed.' },
        { level: 5,  type: 'Passive', name: 'Supporting Light', quote: '', effect: 'After buffing a target, recover some HP and gain a boost to Damage Reduction for 2 turns.' },
        { level: 10, type: 'Active',  name: 'Holy Light',       quote: '', cost: 2, cooldown: 5, moveType: 'Holy', category: 'Support', scaling: 'END/100', effect: 'Grants the target a 5% DR buff and 0.5% HP regen for 4 turns. Also applies a 20 HP shield (scales with Endurance). Dodging an attack still reduces the shield.' },
        { level: 15, type: 'Passive', name: 'Spreading Grace',  quote: '', effect: 'Meditating also gives one other party member +1 energy. Getting hit during your meditation creates a burst of healing for your team.' },
        { level: 20, type: 'Passive', name: 'Consecration',     quote: '', effect: 'Grants the ability to teleport to and host fights against Seraphon.' },
      ],
    },
    'Cult of Thanasius': {
      innatePassives: [],
      learns: [
        { level: 0,  type: 'Active',  name: 'Soul Absorb',        quote: '', cost: 1, cooldown: 4, moveType: 'Dark', category: 'Attack', damage: 2, scaling: 'N/A', effect: 'Deal 2 damage. Instantly kills the enemy if they have 5% or less max HP (2.5% for bosses) and the attack is not blocked or dodged. Blocked, dodged, or Dark-immune targets cannot be executed.' },
        { level: 5,  type: 'Passive', name: 'Internal Corruption', quote: '', effect: 'Killing enemies grants +2 energy. Summons only gain +1 energy from kills.' },
        { level: 10, type: 'Active',  name: 'Death Curtain',       quote: '', cost: 2, cooldown: 6, moveType: 'Dark', category: 'Attack', damage: '6×2', scaling: 'STR/75 + ARC/75', effect: 'Rains projectiles on the target and adjacent enemies. Heals 25% of max HP over 4 turns per enemy killed (capped at 2 enemies, 50% total) and grants 1 energy. Deals double damage against Cursed enemies.' },
        { level: 15, type: 'Passive', name: 'Dark Inversion',      quote: '', effect: 'Dark and Hex affinity attacks deal 10% less damage to you. If such an attack deals more than 20% of your max HP, gain 1 energy.' },
        { level: 20, type: 'Passive', name: 'Pact of Thanasius',   quote: '', effect: 'Grants the ability to teleport to and host fights against Arkhaia.' },
      ],
    },
  };

  /* ── Artifact data ──────────────────────────────────────────────────────── */
  /* obtainableFrom entries: { label, target } where target is the exact ENC_ITEMS name
     (Boss) or null for non-navigable sources (crafting, etc.)                          */
  const ARTIFACT_DATA = {
    'Reality Watch': {
      obtainableFrom: [
        { label: "Yar'thul", target: "Yar'Thul, The Blazing Dragon" },
      ],
      passives: [],
      moves: [
        { name: 'Chronos', cost: 0, cooldown: 12, type: 'N/A', category: 'Buff',
          effect: 'Saves your point in time for 3 turns, after which time reverts and your health and energy rewind. Will not revive you if you die within these 3 turns.' },
      ],
    },
    "Narthana's Sigil": {
      obtainableFrom: [
        { label: "Yar'thul", target: "Yar'Thul, The Blazing Dragon" },
      ],
      passives: [
        { name: 'Empathic Strike', effect: 'When healing 270 HP, will deal X dmg (scales on level) as well as heal X to allies.' },
      ],
      moves: [],
    },
    'Shifting Hourglass': {
      obtainableFrom: [
        { label: "Yar'thul",        target: "Yar'Thul, The Blazing Dragon" },
        { label: 'Seraphon',        target: 'Seraphon' },
        { label: "Metrom's Vessel", target: "Metrom's Vessel" },
      ],
      passives: [],
      moves: [
        { name: 'Sands Of Time', cost: 1, cooldown: 15, type: 'N/A', category: 'Buff',
          effect: 'Enter Heavy Stun for a turn. If Heavy Stun passes and you haven\'t lost 20% of your HP, gives 20% Dmg buff and DR.\n\nCapped at 5 uses per fight.' },
      ],
    },
    'Dark Sigil': {
      obtainableFrom: [
        { label: 'Thorian', target: 'Thorian, The Rotten' },
        { label: 'Arkhaia', target: 'Arkhaia' },
      ],
      passives: [
        { name: 'Dark Orb', effect: 'After applying 6 different instances of statuses towards opponents, shoot out a Dark Orb at them. Deals damage equal to LVL×2 and applies 2 Vulnerable and 2 Weakened to all opponents.' },
      ],
      moves: [],
    },
    'Metroms Amulet': {
      obtainableFrom: [
        { label: 'Thorian', target: 'Thorian, The Rotten' },
        { label: 'Arkhaia', target: 'Arkhaia' },
      ],
      passives: [
        { name: 'Overkill Wave', effect: 'When you kill an enemy, the overkill damage is used to scale an AoE attack that hits all enemies, bypassing reflects. Can crit.\n\nNote: Heals Metrom\'s Vessel if used in the raid and cannot damage Seraphon/Arkhaia.' },
      ],
      moves: [],
    },
    'Stellian Core': {
      obtainableFrom: [
        { label: 'Thorian',  target: 'Thorian, The Rotten' },
        { label: 'Seraphon', target: 'Seraphon' },
      ],
      passives: [
        { name: 'Stellian Empowerment', effect: 'Gives 30% Dmg buff and 15% Crit rate when active. Only activated if you are above 95% of your Max HP.' },
      ],
      moves: [],
    },
    'Chaos Orb': {
      obtainableFrom: [
        { label: "Metrom's Vessel", target: "Metrom's Vessel" },
      ],
      passives: [
        { name: 'Chaotic Cascade', effect: 'When applying a status, you have a 33% chance to apply another status, excluding Heavy Stunned, Fractured, Hex, Stunned, or any boss-exclusive status.\n\nNote: Can apply Ghostflame only if you have the Dullahan race.' },
      ],
      moves: [],
    },
    'Celestial Emblem': {
      obtainableFrom: [
        { label: "Crafted by El'heith (Forgotten Sanctum) — 5 Astral Shards, Stellian Core, 15,000 gold. Cannot be traded.", target: null },
      ],
      passives: [
        { name: 'Celestial Empowerment', effect: 'When fighting a Goblin, Night Raider, Sentient Darkness, Star Slime, or Arkhaia they will become empowered, gaining special effects for each respectively. You must be the one who starts the fight.' },
      ],
      moves: [],
    },
    "Heaven's Authority": {
      obtainableFrom: [
        { label: 'Seraphon', target: 'Seraphon' },
      ],
      passives: [],
      moves: [
        { name: 'Calling Light', cost: 2, cooldown: 9, type: 'N/A', category: 'Buff',
          effect: 'Randomly summon one of three Sheeas: Saint, Paladin, or Elementalist. All summons have 250 HP and start with only Strike and Skyward Bolt. If you have their respective weapon type equipped, they gain all abilities of their Super Class.\n\nIf you are at or below 20% Max HP, summon 2 Sheeas instead of 1.' },
      ],
    },
    "Arkhaia's Visage": {
      obtainableFrom: [
        { label: 'Arkhaia', target: 'Arkhaia' },
      ],
      passives: [],
      moves: [
        { name: 'Infernal Pledge', cost: 1, cooldown: 8, type: 'Dark', category: 'Buff',
          effect: 'Creates a link with an enemy for 3 turns. While active, damage taken is shared with the target. (excludes self damage)' },
      ],
    },
    'Paranoxian Crux': {
      obtainableFrom: [
        { label: 'Handaconda', target: 'Handaconda' },
      ],
      passives: [
        { name: 'Crux Conversion', effect: 'When equipped, multiplies your max HP by 1.5×, then sets it to 10% of the new value. The remaining HP is converted into Shield HP. Can stack with other sources of Shield HP.' },
      ],
      moves: [
        { name: 'Congeal Flesh', cost: 'X', cooldown: 6, type: 'Ice', category: 'Buff',
          effect: 'Restores 15(X)% of your Shield HP, where X is the amount of NRG consumed by the move.' },
      ],
    },
    'Ancient Insignia': {
      obtainableFrom: [
        { label: 'Handaconda', target: 'Handaconda' },
      ],
      passives: [
        { name: 'Shifting Stance', effect: 'Start with a random Stance. Stances switch randomly every 3 turns.\n\n• Paper — Gain 1 Resist for each debuff inflicted on you.\n• Rock — Gain 15% Damage Reduction.\n• Scissors — Gain 5 Energy.' },
      ],
      moves: [
        { name: 'Written in Stone', cost: 1, cooldown: 12, type: 'Physical', category: 'Buff',
          effect: 'Immediately switch your current Stance. The new stance lasts for 4 turns instead of 3.' },
      ],
    },

    /* ── Weapon Modifiers ──────────────────────────────────────────────── */
    'Arcanium Crystal': {
      obtainableFrom: [],
      passives: [],
      moves: [],
    },
    'temperus gem': {
      obtainableFrom: [
        { label: 'Seraphon',        target: 'Seraphon' },
        { label: 'Arkhaia',         target: 'Arkhaia' },
        { label: "Metrom's Vessel", target: "Metrom's Vessel" },
      ],
      passives: [
        { name: '', effect: 'Allows you to remove 1 shard from your weapon at the Shard NPC. You can choose which shard to remove and it will be returned to your inventory.' },
      ],
      moves: [],
    },

    /* ── Enchants ──────────────────────────────────────────────────────── */
    'Blessed': {
      obtainableFrom: [],
      passives: [
        { name: '', effect: 'Attacks build up light within enemies. After 3 stacks it explodes, dealing 2% of the enemy\'s max HP and applying 2 Sundered. Cannot trigger twice in one turn.' },
      ],
      moves: [],
    },
    'Cursed': {
      obtainableFrom: [],
      passives: [
        { name: '', effect: 'Attacks have a 16.6% chance to apply 3 stacks of one of: Cursed, Poisoned, Blinded, Sundered, Weakened, Vulnerable, or Burning.\n\nGrants immunity to Cess Anomalies in Cessgrounds and removes Cess Horror from encounters in Deeproot Canopy.\n\nIncreases damage by 30% against Cursed enemies or 20% against Sundered enemies. Does not stack — only the highest buff applies.' },
      ],
      moves: [],
    },
    'Frosted': {
      obtainableFrom: [],
      passives: [
        { name: '', effect: 'Attacks have a ~16% chance to apply 2 Cold. Not increased by Icerind weapon, though Icerind itself can apply 2 Cold.\n\nCritical hits on Cold enemies cause a small AoE explosion (10 base damage, cannot execute targets, scales with damage modifiers). Triggers once per attack, then goes on cooldown.' },
      ],
      moves: [],
    },
    'Frost Burn (mod)': {
      obtainableFrom: [],
      passives: [
        { name: '', effect: 'Attacks have a ?% chance to inflict Stun.\n\nAttacks have a ?% chance to increase damage dealt by 50%.\n\nOnly one effect can trigger per attack — Stun and the damage increase cannot proc simultaneously.' },
      ],
      moves: [],
    },
    'Hiemal': {
      obtainableFrom: [],
      passives: [
        { name: '', effect: 'Attacks have a 25% chance to apply 2 Cold and 2 Weakened.\n\nAttacks have a 10% chance to apply 1 Stun.\n\nBoth proc chances are independent and can both trigger on the same attack.' },
      ],
      moves: [],
    },
    'Inferno': {
      obtainableFrom: [],
      passives: [
        { name: '', effect: 'Attacks have a 25% chance to apply 3 Burning, even if the enemy dodges.\n\nAll attacks deal 20% more damage when Burn is applied, including the attack that inflicts Burning.' },
      ],
      moves: [],
    },
    'Ivory': {
      obtainableFrom: [],
      passives: [
        { name: '', effect: 'Gaining energy increases all your stats by 4% for 3 turns.' },
      ],
      moves: [],
    },
    'Lifesong': {
      obtainableFrom: [],
      passives: [
        { name: '', effect: 'On hitting an enemy or healing an ally (Parasitic Leech lifesteal does not count), you have a ?% chance to trigger a 20% Incoming and Outgoing healing buff for 3 turns. Can only proc once per turn from an attack, and up to 3 times total per turn combined with heals.' },
      ],
      moves: [],
    },
    'Midas': {
      obtainableFrom: [],
      passives: [
        { name: '', effect: 'Increased drop rates (untested).\n\nGain gold on enemy death.\n\nAttacks have a 16.6% chance to deal 15% extra damage.' },
      ],
      moves: [],
    },
    'Reaper': {
      obtainableFrom: [],
      passives: [
        { name: '', effect: 'On proc: boosts damage up to 25% based on the enemy\'s current HP. Also heals for 10% of damage dealt, excluding the Reaper damage boost.\n\nGrants regen per missing life (affected by Outgoing stat):\n• 1 life missing → 1% max HP/turn\n• 2 lives missing → 2% max HP/turn\n• 3 lives missing → 4% max HP/turn\n\nBonus lives from Daminos, Sheea, and Dullahan count. Mortal Trial players receive no regen buff.' },
      ],
      moves: [],
    },
    'Spectral': {
      obtainableFrom: [],
      passives: [
        { name: '', effect: 'Gives all your attacks a ?% chance to negate all enemy defence.' },
      ],
      moves: [],
    },
    'Storm (mod)': {
      obtainableFrom: [],
      passives: [
        { name: '', effect: 'Attacks have a ?% chance to inflict Stun.\n\nAttacks have a ?% chance to increase damage dealt by 50%.\n\nOnly one effect can trigger per attack — Stun and the damage increase cannot proc simultaneously.' },
      ],
      moves: [],
    },

    /* ── Lesser Artifacts ──────────────────────────────────────────────── */
    'Skyward Totem': {
      obtainableFrom: [
        { label: 'All Bosses', target: null },
      ],
      passives: [
        { name: '', effect: 'Triggers the Corrupted Skies event. Intended as single use, but does not always consume.\n\nWill not trigger under these conditions:\n• The skies are already corrupted\n• It is an Astral Night\n• You are inside a boss fight instance' },
      ],
      moves: [],
    },
    'Soul Dust': {
      obtainableFrom: [
        { label: 'Mysterious Merchant', target: null },
        { label: 'All Bosses',          target: null },
      ],
      passives: [
        { name: '', effect: 'Resets your Soul Tree and allows you to reallocate your soul points.' },
      ],
      moves: [],
    },
    'Memory Fragment': {
      obtainableFrom: [
        { label: 'Mysterious Merchant', target: null },
        { label: 'All Bosses',          target: null },
      ],
      passives: [
        { name: '', effect: 'Resets stat points and the Mastery Tree, and allows you to reallocate your stat points and mastery/breakthrough points.' },
      ],
      moves: [],
    },
    'Phoenix Tear': {
      obtainableFrom: [
        { label: 'Mysterious Merchant', target: null },
        { label: 'All Bosses',          target: null },
      ],
      passives: [
        { name: '', effect: 'Restores 1 lost life. Has a 4-hour cooldown. Does not work if you have Mortal Trial and cannot give Inferion a 3rd life.' },
      ],
      moves: [],
    },
    'Lineage Shard': {
      obtainableFrom: [
        { label: 'Mysterious Merchant', target: null },
        { label: 'All Bosses',          target: null },
      ],
      passives: [
        { name: '', effect: 'Wipes your slot and rerolls your race. A confirmation screen appears before use.\n\n(Level requirement: 10)' },
      ],
      moves: [],
    },
    'Resplendent Essence': {
      obtainableFrom: [
        { label: 'Mysterious Merchant', target: null },
        { label: 'All Bosses',          target: null },
      ],
      passives: [
        { name: '', effect: 'Grants +1 extra slot, regardless of how many you already have. Can only be used once.' },
      ],
      moves: [],
    },
    'Void Key': {
      obtainableFrom: [
        { label: 'Corrupted Bosses', target: null },
      ],
      passives: [
        { name: '', effect: "Grants access to the Metrom's Vessel Raid.\n\nThe key will glow when held once all Petent mark requirements are complete." },
      ],
      moves: [],
    },
    'Echo shard': {
      obtainableFrom: [
        { label: 'All Bosses', target: null },
      ],
      passives: [
        { name: '', effect: 'Gives 1 Breakthrough point usable in the Mastery Tree. Breakthrough points persist through wipes, up to a maximum of 3.' },
      ],
      moves: [],
    },
  };

  /* Boss parent→children map. Children are hidden unless parent is toggled. */
  const BOSS_CHILDREN  = { "Metrom's Vessel": ["Shadeblade"] };
  const BOSS_CHILD_SET = new Set(Object.values(BOSS_CHILDREN).flat());
  let _expandedBossParents = new Set();

  /* ── Name maps — encyclopedia names → builder.js keys ───────────────────
     Only entries that differ between the two need to be listed.
     null = weapon exists but has no passive in weaponMoves.              */
  const WEAPON_NAME_MAP = {
    'Blacksteel Cestus':     'Blacksteel Claws',
    'Blacksteel Dagger':     'Blacksteel Knife',
    'Blacksteel Greatsword': 'Greatsword',
    'Blacksteel Sword':      'Blacksteel Sabre',
    'Dragon Bone Axe':       'Dragonpyre Axe',
    'Dragon Bone Cestus':    'Dragonbone Gauntlets',
    'Dragon Bone Dagger':    'Dragontooth Dagger',
    'Dragon Bone Spear':     'Dragonbone Spear',
    'Dragon Bone Staff':     'Dragontooth Staff',
    'Dragon Bone Sword':     'Dragontooth Blade',
    'Ferrus Hammer':         'Ferrus Tenderizer',
    'Ferrus Staff':          'Old Staff',
    'Corealloy Cestus':      'Corealloy Manaclaws',
    'Corealloy Dagger':      'Corealloy Manadagger',
    'Corealloy Greatsword':  'Corealloy Manablade',
    'Jade Staff':            'Jade Prayerstaff',
    'Jade Sword':            'Jade Broadsword',
    'Blightrock/wood Cestus':'Blightrock Gauntlets',
    'Blightrock/wood Dagger':'Blightrock Dagger',
    'Blightrock/wood Spear': 'Blightrock Spear',
    'Blightrock/wood Staff': 'Blightwood Staff',
    'Blightrock/wood Sword': 'Blightrock Sword',
    'Icerind Dagger':        'Icerind Sai',
    'Sandstone Cestus':      'Sandstone Gauntlets',
    'Primordial Cestus':     'Primordial Gauntlets',
  };

  const GEAR_NAME_MAP = {
    '7 Leafed Everthisel':   '7 Leafed Everthistle',
    'Crystalized Star':      'Crystalized Star',
    'Deathbeak Dagger':      'DeathBeak Dagger',
    'Dragon Memior':         'Dragon Memoir',
    'Everbeating Drum':      'Everbeating Drums',
    'Focussed Mind':         'Focused Mind',
    'Grain of Balance':      'Grain Of Balance',
    'Band Of Crushing Force':'Band of Crushing Force',
    'Lethal Blackajck':      'Lethal Blackjack',
    "Pathfinder's Mark":     'Pathfinder Mark',
    "Rabbits Foot":          "Rabbit's Foot",
    'Ramzicon Idol':         'Ramizcan Idol',
    'Shattered Clockhand':   'Shattered Clock Hand',
    "Yarthul's Wrath":       "Yar'thul's Wrath",
  };

  /* ── State ──────────────────────────────────────────────────────────────── */
  let _activeType   = 'all';
  let _searchTerm   = '';
  let _selectedIdx  = -1;
  let _currentView  = 'empty'; // 'empty' | 'item' | 'class' | 'move'
  let _moveSource   = null;    // { idx, isRace, moveIdx }

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function getFiltered() {
    return ENC_ITEMS.map((it, i) => ({ it, i })).filter(({ it }) => {
      const typeOk   = _activeType === 'all' || it[1] === _activeType;
      const searchOk = !_searchTerm || it[0].toLowerCase().includes(_searchTerm);
      return typeOk && searchOk;
    });
  }

  function getMoveData(idx) {
    const name = ENC_ITEMS[idx][0];
    const type = ENC_ITEMS[idx][1];
    if (type === 'Mark')     return MARK_DATA[name]     || null;
    if (type === 'Covenant') return COVENANT_DATA[name] || null;
    if (type === 'Race') {
      const raceKey = name.replace('(Obtainable)', '(Ob)');
      return raceMoves?.[raceKey] || raceMoves?.[name] || null;
    }
    if (type === 'Weapon') {
      const key = WEAPON_NAME_MAP[name] ?? name;
      return key ? (weaponMoves?.[key] || null) : null;
    }
    if (type === 'Gear') {
      const key = GEAR_NAME_MAP[name] ?? name;
      return key ? (gearMoves?.[key] || null) : null;
    }
    return classMoves?.[name] || null;
  }

  function showPanel(id) {
    ['enc-detail-empty', 'enc-detail-card', 'enc-class-card', 'enc-move-card'].forEach(pid => {
      const el = document.getElementById(pid);
      if (el) el.style.display = pid === id ? '' : 'none';
    });
  }

  /* ── Render list ────────────────────────────────────────────────────────── */
  function render() {
    const list = document.getElementById('enc-list');
    if (!list) return;
    list.innerHTML = '';

    const filtered  = getFiltered();
    const noResults = document.getElementById('enc-no-results');

    if (!filtered.length) {
      if (noResults) noResults.style.display = '';
      return;
    }
    if (noResults) noResults.style.display = 'none';

    const groups = {};
    TYPE_ORDER.forEach(t => { groups[t] = []; });
    filtered.forEach(({ it, i }) => { if (groups[it[1]]) groups[it[1]].push({ it, i }); });

    TYPE_ORDER.forEach(type => {
      const items = groups[type];
      if (!items.length) return;

      const section = document.createElement('div');
      section.className = 'enc-section';

      const hdr = document.createElement('div');
      hdr.className = 'enc-section-hdr';
      hdr.innerHTML = `<span class="enc-section-icon">${TYPE_ICONS[type] || ''}</span>${type}<span class="enc-section-count">${items.length}</span>`;
      section.appendChild(hdr);

      if (type === 'Weapon') {
        // Group weapons by family with sub-headers
        const byFamily = {};
        WEAPON_GROUPS.forEach(g => { byFamily[g.label] = []; });
        [...items].sort((a, b) => a.it[0].localeCompare(b.it[0])).forEach(({ it, i }) => {
          WEAPON_GROUPS.forEach(g => {
            const matches = g.prefix ? it[0].startsWith(g.prefix) : g.names?.has(it[0]);
            if (matches) byFamily[g.label].push({ it, i });
          });
        });
        WEAPON_GROUPS.forEach(g => {
          const gItems = byFamily[g.label];
          if (!gItems.length) return;
          const groupDiv = document.createElement('div');
          groupDiv.className = 'enc-weapon-group';
          const groupHdr = document.createElement('div');
          groupHdr.className = 'enc-weapon-group-hdr';
          groupHdr.textContent = g.label;
          groupDiv.appendChild(groupHdr);
          const groupGrid = document.createElement('div');
          groupGrid.className = 'enc-grid';
          gItems.forEach(({ it, i }) => {
            const btn = document.createElement('button');
            btn.className = 'enc-item-btn' + (_selectedIdx === i ? ' active' : '');
            btn.dataset.idx = i;
            btn.textContent = it[0];
            btn.addEventListener('click', () => selectItem(i));
            groupGrid.appendChild(btn);
          });
          groupDiv.appendChild(groupGrid);
          section.appendChild(groupDiv);
        });
      } else if (type === 'Trainer') {
        // Group trainers by category with sub-headers
        const byGroup = {};
        TRAINER_GROUPS.forEach(g => { byGroup[g.label] = []; });
        items.forEach(({ it, i }) => {
          TRAINER_GROUPS.forEach(g => {
            if (g.names?.has(it[0])) byGroup[g.label].push({ it, i });
          });
        });
        TRAINER_GROUPS.forEach(g => {
          const gItems = byGroup[g.label];
          if (!gItems.length) return;
          const groupDiv = document.createElement('div');
          groupDiv.className = 'enc-weapon-group';
          const groupHdr = document.createElement('div');
          groupHdr.className = 'enc-weapon-group-hdr';
          groupHdr.textContent = g.label;
          groupDiv.appendChild(groupHdr);
          const groupGrid = document.createElement('div');
          groupGrid.className = 'enc-grid';
          gItems.forEach(({ it, i }) => {
            const btn = document.createElement('button');
            btn.className = 'enc-item-btn' + (_selectedIdx === i ? ' active' : '');
            btn.dataset.idx = i;
            btn.textContent = it[0];
            btn.addEventListener('click', () => selectItem(i));
            groupGrid.appendChild(btn);
          });
          groupDiv.appendChild(groupGrid);
          section.appendChild(groupDiv);
        });
      } else if (type === 'Mob') {
        // Group mobs by category with sub-headers; ungrouped mobs listed first
        const groupedNames = new Set(MOB_GROUPS.flatMap(g => [...g.names]));
        const ungrouped = items.filter(({ it }) => !groupedNames.has(it[0]));
        if (ungrouped.length) {
          const grid = document.createElement('div');
          grid.className = 'enc-grid';
          ungrouped.forEach(({ it, i }) => {
            const btn = document.createElement('button');
            btn.className = 'enc-item-btn' + (_selectedIdx === i ? ' active' : '');
            btn.dataset.idx = i;
            btn.textContent = it[0];
            btn.addEventListener('click', () => selectItem(i));
            grid.appendChild(btn);
          });
          section.appendChild(grid);
        }
        const byGroup = {};
        MOB_GROUPS.forEach(g => { byGroup[g.label] = []; });
        items.forEach(({ it, i }) => {
          MOB_GROUPS.forEach(g => { if (g.names?.has(it[0])) byGroup[g.label].push({ it, i }); });
        });
        MOB_GROUPS.forEach(g => {
          const gItems = byGroup[g.label];
          if (!gItems.length) return;
          const groupDiv = document.createElement('div');
          groupDiv.className = 'enc-weapon-group';
          const groupHdr = document.createElement('div');
          groupHdr.className = 'enc-weapon-group-hdr';
          groupHdr.textContent = g.label;
          groupDiv.appendChild(groupHdr);
          const groupGrid = document.createElement('div');
          groupGrid.className = 'enc-grid';
          gItems.forEach(({ it, i }) => {
            const btn = document.createElement('button');
            btn.className = 'enc-item-btn' + (_selectedIdx === i ? ' active' : '');
            btn.dataset.idx = i;
            btn.textContent = it[0];
            btn.addEventListener('click', () => selectItem(i));
            groupGrid.appendChild(btn);
          });
          groupDiv.appendChild(groupGrid);
          section.appendChild(groupDiv);
        });
      } else if (type === 'Misc') {
        const groupedNames = new Set(MISC_GROUPS.flatMap(g => [...g.names]));
        const ungrouped = items.filter(({ it }) => !groupedNames.has(it[0]));
        if (ungrouped.length) {
          const grid = document.createElement('div');
          grid.className = 'enc-grid';
          ungrouped.forEach(({ it, i }) => {
            const btn = document.createElement('button');
            btn.className = 'enc-item-btn' + (_selectedIdx === i ? ' active' : '');
            btn.dataset.idx = i;
            btn.textContent = it[0];
            btn.addEventListener('click', () => selectItem(i));
            grid.appendChild(btn);
          });
          section.appendChild(grid);
        }
        const byGroup = {};
        MISC_GROUPS.forEach(g => { byGroup[g.label] = []; });
        items.forEach(({ it, i }) => {
          MISC_GROUPS.forEach(g => { if (g.names?.has(it[0])) byGroup[g.label].push({ it, i }); });
        });
        MISC_GROUPS.forEach(g => {
          const gItems = byGroup[g.label];
          if (!gItems.length) return;
          const groupDiv = document.createElement('div');
          groupDiv.className = 'enc-weapon-group';
          const groupHdr = document.createElement('div');
          groupHdr.className = 'enc-weapon-group-hdr';
          groupHdr.textContent = g.label;
          groupDiv.appendChild(groupHdr);
          const groupGrid = document.createElement('div');
          groupGrid.className = 'enc-grid';
          gItems.forEach(({ it, i }) => {
            const btn = document.createElement('button');
            btn.className = 'enc-item-btn' + (_selectedIdx === i ? ' active' : '');
            btn.dataset.idx = i;
            btn.textContent = it[0];
            btn.addEventListener('click', () => selectItem(i));
            groupGrid.appendChild(btn);
          });
          groupDiv.appendChild(groupGrid);
          section.appendChild(groupDiv);
        });
      } else if (type === 'Potion') {
        const groupedNames = new Set(POTION_GROUPS.flatMap(g => [...g.names]));
        const ungrouped = items.filter(({ it }) => !groupedNames.has(it[0]));
        if (ungrouped.length) {
          const grid = document.createElement('div');
          grid.className = 'enc-grid';
          ungrouped.forEach(({ it, i }) => {
            const btn = document.createElement('button');
            btn.className = 'enc-item-btn' + (_selectedIdx === i ? ' active' : '');
            btn.dataset.idx = i;
            btn.textContent = it[0];
            btn.addEventListener('click', () => selectItem(i));
            grid.appendChild(btn);
          });
          section.appendChild(grid);
        }
        const byGroup = {};
        POTION_GROUPS.forEach(g => { byGroup[g.label] = []; });
        items.forEach(({ it, i }) => {
          POTION_GROUPS.forEach(g => { if (g.names?.has(it[0])) byGroup[g.label].push({ it, i }); });
        });
        POTION_GROUPS.forEach(g => {
          const gItems = byGroup[g.label];
          const groupDiv = document.createElement('div');
          groupDiv.className = 'enc-weapon-group';
          const groupHdr = document.createElement('div');
          groupHdr.className = 'enc-weapon-group-hdr';
          groupHdr.textContent = g.label;
          groupDiv.appendChild(groupHdr);
          const groupGrid = document.createElement('div');
          groupGrid.className = 'enc-grid';
          gItems.forEach(({ it, i }) => {
            const btn = document.createElement('button');
            btn.className = 'enc-item-btn' + (_selectedIdx === i ? ' active' : '');
            btn.dataset.idx = i;
            btn.textContent = it[0];
            btn.addEventListener('click', () => selectItem(i));
            groupGrid.appendChild(btn);
          });
          groupDiv.appendChild(groupGrid);
          section.appendChild(groupDiv);
        });
      } else if (type === 'Scroll') {
        const groupedNames = new Set(SCROLL_GROUPS.flatMap(g => [...g.names]));
        const ungrouped = items.filter(({ it }) => !groupedNames.has(it[0]));
        if (ungrouped.length) {
          const grid = document.createElement('div');
          grid.className = 'enc-grid';
          [...ungrouped].sort((a, b) => a.it[0].localeCompare(b.it[0])).forEach(({ it, i }) => {
            const btn = document.createElement('button');
            btn.className = 'enc-item-btn' + (_selectedIdx === i ? ' active' : '');
            btn.dataset.idx = i;
            btn.textContent = it[0];
            btn.addEventListener('click', () => selectItem(i));
            grid.appendChild(btn);
          });
          section.appendChild(grid);
        }
        const byGroup = {};
        SCROLL_GROUPS.forEach(g => { byGroup[g.label] = []; });
        items.forEach(({ it, i }) => {
          SCROLL_GROUPS.forEach(g => { if (g.names?.has(it[0])) byGroup[g.label].push({ it, i }); });
        });
        SCROLL_GROUPS.forEach(g => {
          const gItems = byGroup[g.label];
          if (!gItems.length) return;
          const groupDiv = document.createElement('div');
          groupDiv.className = 'enc-weapon-group';
          const groupHdr = document.createElement('div');
          groupHdr.className = 'enc-weapon-group-hdr';
          groupHdr.textContent = g.label;
          groupDiv.appendChild(groupHdr);
          const groupGrid = document.createElement('div');
          groupGrid.className = 'enc-grid';
          gItems.forEach(({ it, i }) => {
            const btn = document.createElement('button');
            btn.className = 'enc-item-btn' + (_selectedIdx === i ? ' active' : '');
            btn.dataset.idx = i;
            btn.textContent = it[0];
            btn.addEventListener('click', () => selectItem(i));
            groupGrid.appendChild(btn);
          });
          groupDiv.appendChild(groupGrid);
          section.appendChild(groupDiv);
        });
      } else {
        const grid = document.createElement('div');
        grid.className = 'enc-grid' + (type === 'Boss' ? ' enc-grid-column' : '');

        const orderedItems = NO_SORT_TYPES.has(type)
          ? items
          : type === 'Race'
          ? [...items].sort((a, b) => {
              const pct = n => { const m = n.match(/\((\d+)%\)/); return m ? parseFloat(m[1]) : -1; };
              return pct(b.it[0]) - pct(a.it[0]);
            })
          : [...items].sort((a, b) => a.it[0].localeCompare(b.it[0]));

        orderedItems.forEach(({ it, i }) => {
          // Children are rendered by their parent toggle — skip here
          if (type === 'Boss' && BOSS_CHILD_SET.has(it[0])) return;

          const hasChildren = type === 'Boss' && !!BOSS_CHILDREN[it[0]];
          const isExpanded  = hasChildren && _expandedBossParents.has(it[0]);

          const btn = document.createElement('button');
          btn.className = 'enc-item-btn' + (_selectedIdx === i ? ' active' : '') + (hasChildren ? ' enc-item-btn-parent' : '');
          btn.dataset.idx = i;

          if (hasChildren) {
            btn.innerHTML = `<span>${it[0]}</span><span class="enc-expand-icon">${isExpanded ? '▼' : '▶'}</span>`;
            btn.querySelector('.enc-expand-icon').addEventListener('click', e => {
              e.stopPropagation();
              const pname = it[0];
              if (_expandedBossParents.has(pname)) _expandedBossParents.delete(pname);
              else _expandedBossParents.add(pname);
              render();
            });
          } else {
            btn.textContent = it[0];
          }

          btn.addEventListener('click', () => selectItem(i));
          grid.appendChild(btn);

          // Render children below the parent when expanded
          if (hasChildren && isExpanded) {
            const childWrap = document.createElement('div');
            childWrap.className = 'enc-boss-children';
            BOSS_CHILDREN[it[0]].forEach(childName => {
              const childIdx = ENC_ITEMS.findIndex(e => e[0] === childName && e[1] === 'Boss');
              if (childIdx === -1) return;
              const childBtn = document.createElement('button');
              childBtn.className = 'enc-item-btn enc-item-btn-child' + (_selectedIdx === childIdx ? ' active' : '');
              childBtn.dataset.idx = childIdx;
              childBtn.textContent = childName;
              childBtn.addEventListener('click', () => selectItem(childIdx));
              childWrap.appendChild(childBtn);
            });
            grid.appendChild(childWrap);
          }
        });

        section.appendChild(grid);
      }
      list.appendChild(section);
    });
  }

  /* ── Select item ────────────────────────────────────────────────────────── */
  function selectItem(idx) {
    if (_selectedIdx === idx) {
      _selectedIdx = -1;
      document.querySelectorAll('.enc-item-btn').forEach(b => b.classList.remove('active'));
      showPanel('enc-detail-empty');
      return;
    }
    _selectedIdx = idx;
    document.querySelectorAll('.enc-item-btn').forEach(b => {
      b.classList.toggle('active', +b.dataset.idx === idx);
    });
    const type = ENC_ITEMS[idx][1];
    if (type === 'Boss' || type === 'Mini Boss' || type === 'Mob') {
      showBossDetail(idx);
    } else if (CLASS_TYPES.has(type)) {
      showClassDetail(idx);
    } else if (type === 'Artifact' || type === 'Lesser Artifact' || type === 'Enchant' || type === 'Weapon Modifier') {
      showArtifactDetail(idx);
    } else {
      showItemDetail(idx);
    }
  }

  /* ── Item detail panel ──────────────────────────────────────────────────── */
  function showItemDetail(idx) {
    const it     = ENC_ITEMS[idx];
    _currentView = 'item';
    showPanel('enc-detail-card');

    const nameEl  = document.getElementById('enc-detail-name');
    const typeEl  = document.getElementById('enc-detail-type');
    const descEl  = document.getElementById('enc-detail-desc');
    const extraEl = document.getElementById('enc-detail-extra');
    if (extraEl) extraEl.innerHTML = '';

    if (typeEl) {
      typeEl.textContent = (TYPE_ICONS[it[1]] || '') + ' ' + it[1];
      typeEl.className   = 'enc-detail-type enc-type-' + it[1].replace(/\s+/g, '-');
    }
    if (nameEl) nameEl.textContent = it[0];
    if (descEl) {
      if (it[2]) {
        descEl.innerHTML = it[2].replace(/\n/g, '<br>');
        descEl.classList.remove('enc-detail-nodesc');
        descEl.querySelectorAll('[data-enc-nav]').forEach(btn => {
          const targetIdx = ENC_ITEMS.findIndex(e => e[0] === btn.dataset.encNav);
          if (targetIdx !== -1) btn.addEventListener('click', () => selectItem(targetIdx));
        });
        descEl.querySelectorAll('[data-enc-tab]').forEach(btn => {
          btn.addEventListener('click', () => {
            const tabBtn = document.querySelector(`.enc-type-tab[data-type="${btn.dataset.encTab}"]`);
            window._encFilter(btn.dataset.encTab, tabBtn || null);
          });
        });
      } else {
        descEl.textContent = 'No description available.';
        descEl.classList.add('enc-detail-nodesc');
      }
    }
  }

  /* ── Artifact detail panel ─────────────────────────────────────────────── */
  function showArtifactDetail(idx) {
    const it   = ENC_ITEMS[idx];
    const data = ARTIFACT_DATA[it[0]] || null;
    _currentView = 'item';
    showPanel('enc-detail-card');

    const nameEl  = document.getElementById('enc-detail-name');
    const typeEl  = document.getElementById('enc-detail-type');
    const descEl  = document.getElementById('enc-detail-desc');
    const extraEl = document.getElementById('enc-detail-extra');

    if (typeEl) {
      typeEl.textContent = (TYPE_ICONS[it[1]] || '') + ' ' + it[1];
      typeEl.className   = 'enc-detail-type enc-type-' + it[1].replace(/\s+/g, '-');
    }
    if (nameEl) nameEl.textContent = it[0];

    if (descEl) {
      if (it[2]) {
        descEl.innerHTML = it[2].replace(/\n/g, '<br>');
        descEl.classList.remove('enc-detail-nodesc');
        descEl.querySelectorAll('[data-enc-nav]').forEach(btn => {
          const targetIdx = ENC_ITEMS.findIndex(e => e[0] === btn.dataset.encNav);
          if (targetIdx !== -1) btn.addEventListener('click', () => selectItem(targetIdx));
        });
      } else {
        descEl.textContent = 'No description available.';
        descEl.classList.add('enc-detail-nodesc');
      }
    }

    if (!extraEl) return;
    extraEl.innerHTML = '';

    if (!data) return;

    if (data.obtainableFrom?.length) {
      const fromDiv = document.createElement('div');
      fromDiv.className = 'enc-artifact-from';
      const lbl = document.createElement('span');
      lbl.className = 'enc-artifact-from-label';
      lbl.textContent = 'Obtainable from: ';
      fromDiv.appendChild(lbl);
      data.obtainableFrom.forEach((src, i) => {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'enc-artifact-from-sep';
          sep.textContent = ', ';
          fromDiv.appendChild(sep);
        }
        if (src.target) {
          const targetIdx = ENC_ITEMS.findIndex(e => e[0] === src.target);
          const btn = document.createElement('button');
          btn.className = 'enc-artifact-source-btn';
          btn.textContent = src.label;
          if (targetIdx !== -1) {
            btn.addEventListener('click', () => selectItem(targetIdx));
          }
          fromDiv.appendChild(btn);
        } else {
          const span = document.createElement('span');
          span.className = 'enc-artifact-source';
          span.textContent = src.label;
          fromDiv.appendChild(span);
        }
      });
      extraEl.appendChild(fromDiv);
    }

    if (data.passives?.length) {
      const passDiv = document.createElement('div');
      passDiv.className = 'enc-boss-passives';
      let html = `<div class="enc-boss-section-label">Passive</div>`;
      data.passives.forEach(p => {
        const nameHtml = p.name ? `<span class="enc-passive-name">${p.name}</span>` : '';
        html += `<div class="enc-passive-row">${nameHtml}<span class="enc-passive-desc">${p.effect.replace(/\n/g, '<br>')}</span></div>`;
      });
      passDiv.innerHTML = html;
      extraEl.appendChild(passDiv);
    }

    if (data.moves?.length) {
      const movesDiv = document.createElement('div');
      movesDiv.className = 'enc-boss-moves';
      const lbl = document.createElement('div');
      lbl.className = 'enc-boss-section-label';
      lbl.textContent = 'Active';
      movesDiv.appendChild(lbl);

      data.moves.forEach(m => {
        const costText = m.cost !== undefined && m.cost !== '' ? `${m.cost}E` : '';
        const cdText   = m.cooldown ? `CD${m.cooldown}` : '';
        const typeText = m.type && m.type !== 'N/A' ? m.type : '';
        const catText  = m.category || '';
        const metaStr  = [costText, cdText, typeText].filter(Boolean).join(' · ');

        const row = document.createElement('div');
        row.className = 'enc-passive-row';
        let innerHtml = `<span class="enc-passive-name">${m.name}`;
        if (metaStr) innerHtml += `<span class="enc-artifact-move-meta"> — ${metaStr}</span>`;
        innerHtml += `</span><span class="enc-passive-desc">`;
        if (catText) innerHtml += `<span class="enc-boss-move-category">${catText}</span>`;
        innerHtml += (m.effect || '').replace(/\n/g, '<br>') + `</span>`;
        row.innerHTML = innerHtml;
        movesDiv.appendChild(row);
      });

      extraEl.appendChild(movesDiv);
    }
  }

  /* ── Boss detail panel ──────────────────────────────────────────────────── */
  function showBossDetail(idx) {
    const it = ENC_ITEMS[idx];
    _currentView = 'item';
    showPanel('enc-detail-card');

    const nameEl  = document.getElementById('enc-detail-name');
    const typeEl  = document.getElementById('enc-detail-type');
    const descEl  = document.getElementById('enc-detail-desc');
    const extraEl = document.getElementById('enc-detail-extra');

    const bossKey  = it[0];
    const bossData = (typeof BOSS_DATA !== 'undefined') ? BOSS_DATA[bossKey] : null;
    const moveData = BOSS_MOVE_DATA[bossKey] || null;

    if (typeEl) {
      typeEl.textContent = '☠ Boss';
      typeEl.className   = 'enc-detail-type enc-type-Boss';
    }
    if (nameEl) nameEl.textContent = bossKey;
    if (descEl) {
      if (it[2]) {
        descEl.innerHTML = it[2].replace(/\n/g, '<br>');
        descEl.classList.remove('enc-detail-nodesc');
      } else {
        descEl.textContent = 'No description available.';
        descEl.classList.add('enc-detail-nodesc');
      }
    }

    if (!extraEl) return;
    extraEl.innerHTML = '';

    if (bossData) {
      // HP
      let hpHtml = `<div class="enc-boss-section-label">HP</div><div class="enc-boss-hp-rows">`;
      hpHtml += `<div class="enc-boss-hp-row"><span class="enc-boss-hp-label">Normal</span><span class="enc-boss-hp-val">${bossData.hp.toLocaleString()}</span></div>`;
      if (bossData.hpVariants) {
        for (const [variant, hp] of Object.entries(bossData.hpVariants)) {
          hpHtml += `<div class="enc-boss-hp-row"><span class="enc-boss-hp-label">${variant}</span><span class="enc-boss-hp-val enc-boss-hp-corrupted">${hp.toLocaleString()}</span></div>`;
        }
      }
      hpHtml += `</div>`;
      const hpDiv = document.createElement('div');
      hpDiv.className = 'enc-boss-hp';
      hpDiv.innerHTML = hpHtml;
      extraEl.appendChild(hpDiv);

      // Resistances
      if (bossData.res && Object.keys(bossData.res).length) {
        let resHtml = `<div class="enc-boss-section-label">Resistances</div><div class="enc-boss-res-grid">`;
        for (const [dmgType, mult] of Object.entries(bossData.res)) {
          const cls = mult > 1.0 ? 'enc-res-weak' : 'enc-res-resist';
          resHtml += `<div class="enc-res-chip ${cls}"><span class="enc-res-type">${dmgType}</span><span class="enc-res-val">${mult.toFixed(2)}x</span></div>`;
        }
        resHtml += `</div>`;
        const resDiv = document.createElement('div');
        resDiv.className = 'enc-boss-res';
        resDiv.innerHTML = resHtml;
        extraEl.appendChild(resDiv);
      }
    }

    if (moveData) {
      // Loot Table
      if (moveData.loot) {
        const lootWrap = document.createElement('div');
        lootWrap.className = 'enc-loot-section';

        const lootBtn = document.createElement('button');
        lootBtn.className = 'enc-loot-btn';
        const arrow = document.createElement('span');
        arrow.className = 'enc-loot-btn-arrow';
        arrow.textContent = '▾';
        lootBtn.append('Loot Table', arrow);

        const lootBody = document.createElement('div');
        lootBody.className = 'enc-loot-body';
        lootBody.style.display = 'none';

        const WEAPON_PREFIX_MAP = {
          'Dragon Weapons':                      'Dragon Bone ',
          'Blight Weapons':                      'Blightrock/wood ',
          'Sun Weapons':                         'Sun ',
          'Darkblood Weapons':                   'Darkblood ',
          'Sandstone Weapons':                   'Sandstone ',
          'Primordial Weapons (Corrupted only)': 'Primordial ',
        };

        moveData.loot.categories.forEach(cat => {
          const catDiv = document.createElement('div');
          const label = document.createElement('div');
          label.className = 'enc-loot-cat-label';
          label.textContent = cat.label;
          catDiv.appendChild(label);

          const chips = document.createElement('div');
          chips.className = 'enc-loot-chips';
          const weaponSets = [];

          cat.items.forEach(item => {
            const weaponPrefix = WEAPON_PREFIX_MAP[item];
            if (weaponPrefix) {
              weaponSets.push({ item, prefix: weaponPrefix });
              return;
            }

            let encIdx;
            if (item === 'All Lesser Artifacts') {
              encIdx = ENC_ITEMS.findIndex(e => e[1] === 'Lesser Artifact');
            } else {
              const lower = item.toLowerCase();
              encIdx = ENC_ITEMS.findIndex(e => e[0].toLowerCase() === lower);
            }
            if (encIdx !== -1) {
              const chip = document.createElement('button');
              chip.className = 'enc-loot-chip enc-loot-chip-link';
              chip.textContent = item;
              chip.addEventListener('click', () => selectItem(encIdx));
              chips.appendChild(chip);
            } else {
              const chip = document.createElement('span');
              chip.className = 'enc-loot-chip';
              chip.textContent = item;
              chips.appendChild(chip);
            }
          });

          if (chips.children.length) catDiv.appendChild(chips);

          weaponSets.forEach(({ item, prefix }) => {
            const setWrap = document.createElement('div');
            setWrap.style.cssText = 'margin-top:4px;';

            const setBtn = document.createElement('button');
            setBtn.className = 'enc-loot-chip enc-loot-chip-link';
            setBtn.style.cssText = 'display:inline-flex;align-items:center;gap:5px;';
            const setArrow = document.createElement('span');
            setArrow.style.cssText = 'font-size:9px;opacity:0.6;';
            setArrow.textContent = '▾';
            setBtn.append(item, setArrow);

            const setList = document.createElement('div');
            setList.className = 'enc-loot-chips';
            setList.style.cssText = 'display:none;margin-top:5px;padding-left:6px;';

            ENC_ITEMS.forEach((e, i) => {
              if (e[1] === 'Weapon' && e[0].startsWith(prefix)) {
                const wBtn = document.createElement('button');
                wBtn.className = 'enc-loot-chip enc-loot-chip-link';
                wBtn.textContent = e[0];
                wBtn.addEventListener('click', ev => { ev.stopPropagation(); selectItem(i); });
                setList.appendChild(wBtn);
              }
            });

            setBtn.addEventListener('click', () => {
              const open = setList.style.display !== 'none';
              setList.style.display = open ? 'none' : 'flex';
              setArrow.textContent = open ? '▾' : '▴';
            });

            setWrap.appendChild(setBtn);
            setWrap.appendChild(setList);
            catDiv.appendChild(setWrap);
          });

          lootBody.appendChild(catDiv);
        });

        if (moveData.loot.notes?.length) {
          const notesDiv = document.createElement('div');
          notesDiv.className = 'enc-loot-notes';
          notesDiv.innerHTML = moveData.loot.notes.join('<br>');
          lootBody.appendChild(notesDiv);
        }

        lootBtn.addEventListener('click', () => {
          const open = lootBody.style.display !== 'none';
          lootBody.style.display = open ? 'none' : 'flex';
          arrow.textContent = open ? '▾' : '▴';
        });

        lootWrap.appendChild(lootBtn);
        lootWrap.appendChild(lootBody);
        extraEl.appendChild(lootWrap);
      }

      // Passives
      if (moveData.passives?.length) {
        const wrap = document.createElement('div');
        wrap.className = 'enc-loot-section';

        const hdr = document.createElement('button');
        hdr.className = 'enc-loot-btn';
        const arr = document.createElement('span');
        arr.className = 'enc-loot-btn-arrow';
        arr.textContent = '▾';
        hdr.append('Passives', arr);

        const body = document.createElement('div');
        body.className = 'enc-boss-passives';
        body.style.display = 'none';
        moveData.passives.forEach(p => {
          const row = document.createElement('div');
          row.className = 'enc-passive-row';
          row.innerHTML = `<span class="enc-passive-name">${p.name}</span><span class="enc-passive-desc">${p.description}</span>`;
          body.appendChild(row);
        });

        hdr.addEventListener('click', () => {
          const open = body.style.display !== 'none';
          body.style.display = open ? 'none' : 'flex';
          arr.textContent = open ? '▾' : '▴';
        });

        wrap.appendChild(hdr);
        wrap.appendChild(body);
        extraEl.appendChild(wrap);
      }

      // Moves
      if (moveData.learns?.length) {
        const wrap = document.createElement('div');
        wrap.className = 'enc-loot-section';

        const hdr = document.createElement('button');
        hdr.className = 'enc-loot-btn';
        const arr = document.createElement('span');
        arr.className = 'enc-loot-btn-arrow';
        arr.textContent = '▾';
        hdr.append('Moves', arr);

        const body = document.createElement('div');
        body.className = 'enc-boss-moves';
        body.style.display = 'none';

        moveData.learns.forEach((m, mi) => {
          const btn = document.createElement('button');
          btn.className = 'enc-move-btn';
          const costText = m.cost !== undefined ? `${m.cost}E` : '';
          const cdText   = m.cooldown           ? `CD${m.cooldown}` : '';
          const metaStr  = [costText, cdText].filter(Boolean).join(' · ');
          btn.innerHTML  = `<span class="enc-move-btn-name">${m.name}</span><span class="enc-move-btn-meta"><span style="font-size:10px;color:#555">${metaStr}</span></span>`;
          btn.addEventListener('click', () => showBossMoveDetail(idx, mi));
          body.appendChild(btn);
        });

        hdr.addEventListener('click', () => {
          const open = body.style.display !== 'none';
          body.style.display = open ? 'none' : 'flex';
          arr.textContent = open ? '▾' : '▴';
        });

        wrap.appendChild(hdr);
        wrap.appendChild(body);
        extraEl.appendChild(wrap);
      }
    }
  }

  /* ── Boss move detail panel ─────────────────────────────────────────────── */
  function showBossMoveDetail(bossIdx, moveIdx) {
    _moveSource  = { classIdx: bossIdx, moveIdx, isBoss: true };
    _currentView = 'move';
    showPanel('enc-move-card');

    const bossName = ENC_ITEMS[bossIdx][0];
    const m        = BOSS_MOVE_DATA[bossName]?.learns?.[moveIdx];
    if (!m) return;

    const card = document.getElementById('enc-move-card');
    if (!card) return;

    const nameEl   = card.querySelector('.enc-move-name');
    const typePill = card.querySelector('.enc-move-type-badge');
    const quoteEl  = card.querySelector('.enc-move-quote');
    const statsEl  = card.querySelector('.enc-move-stats');
    const effectEl = card.querySelector('.enc-move-effect');

    if (nameEl)   nameEl.textContent = m.name;
    if (typePill) { typePill.textContent = m.type || ''; typePill.className = 'enc-move-type-badge enc-mpill-' + (m.type || '').toLowerCase(); }
    if (quoteEl)  { quoteEl.textContent = ''; quoteEl.style.display = 'none'; }

    if (statsEl) {
      statsEl.innerHTML = '';
      const stats = [];
      if (m.cost !== undefined) stats.push({ label: 'Cost', val: m.cost + ' E' });
      if (m.cooldown)           stats.push({ label: 'CD',   val: m.cooldown });
      if (m.moveType)           stats.push({ label: 'Type', val: m.moveType });
      stats.forEach(s => {
        const chip = document.createElement('div');
        chip.className = 'enc-stat-chip';
        chip.innerHTML = `<span class="enc-stat-label">${s.label}</span><span class="enc-stat-val">${s.val}</span>`;
        statsEl.appendChild(chip);
      });
    }

    if (effectEl) {
      let html = '';
      if (m.category) html += `<div class="enc-boss-move-category">${m.category}</div>`;
      if (m.condition) html += `<div class="enc-boss-move-condition"><span class="enc-boss-move-cond-label">Condition</span>${m.condition}</div>`;
      html += (m.effect || '').replace(/\n/g, '<br>');
      effectEl.innerHTML = html;
    }
  }

  /* ── Class / Race detail panel ──────────────────────────────────────────── */
  function showClassDetail(idx) {
    const it      = ENC_ITEMS[idx];
    const name    = it[0];
    const type    = it[1];
    const isRace  = type === 'Race';
    const moveData = getMoveData(idx);

    _currentView = 'class';
    showPanel('enc-class-card');

    const card = document.getElementById('enc-class-card');
    if (!card) return;

    // Type badge
    const badge = card.querySelector('.enc-class-type');
    if (badge) {
      badge.textContent = (TYPE_ICONS[type] || '') + ' ' + type;
      badge.className   = 'enc-class-type enc-type-' + type.replace(/\s+/g, '-');
    }

    // Name
    const nameEl = card.querySelector('.enc-class-name');
    if (nameEl) nameEl.textContent = name;

    // Description
    const descEl = card.querySelector('.enc-class-desc');
    if (descEl) {
      if (it[2]) {
        if (name.includes('(Obtainable)')) {
          descEl.innerHTML = '';
          const btn = document.createElement('button');
          btn.className = 'enc-move-btn';
          btn.innerHTML = `<span class="enc-move-btn-name">How to Obtain</span><span class="enc-move-btn-meta">›</span>`;
          btn.addEventListener('click', () => showObtainDetail(idx));
          descEl.appendChild(btn);
        } else {
          descEl.innerHTML = it[2].replace(/\n/g, '<br>');
          descEl.querySelectorAll('[data-enc-nav]').forEach(btn => {
            const targetIdx = ENC_ITEMS.findIndex(e => e[0] === btn.dataset.encNav);
            if (targetIdx !== -1) btn.addEventListener('click', () => selectItem(targetIdx));
          });
        }
        descEl.classList.remove('enc-detail-nodesc');
      } else if (type === 'Weapon') {
        descEl.innerHTML = '';
        descEl.classList.add('enc-detail-nodesc');
      } else {
        descEl.textContent = 'No description available.';
        descEl.classList.add('enc-detail-nodesc');
      }
      // Weapon group description (obtain source + shard slots)
      if (type === 'Weapon') {
        const grp = WEAPON_GROUPS.find(g => g.prefix ? name.startsWith(g.prefix) : g.names?.has(name));
        if (grp?.desc) {
          const grpDiv = document.createElement('div');
          grpDiv.innerHTML = grp.desc.replace(/\n/g, '<br>');
          grpDiv.querySelectorAll('[data-enc-nav]').forEach(btn => {
            const targetIdx = ENC_ITEMS.findIndex(e => e[0] === btn.dataset.encNav);
            if (targetIdx !== -1) btn.addEventListener('click', () => selectItem(targetIdx));
          });
          descEl.appendChild(grpDiv);
          descEl.classList.remove('enc-detail-nodesc');
        }
      }
    }

    // Innate passives
    const passivesEl = card.querySelector('.enc-class-passives');
    if (passivesEl) {
      passivesEl.innerHTML = '';
      const passives = moveData?.innatePassives || [];
      if (passives.length) {
        const label = document.createElement('div');
        label.className = 'enc-moves-label';
        label.textContent = 'Innate Passives';
        passivesEl.appendChild(label);
        passives.forEach(p => {
          const row = document.createElement('div');
          row.className = 'enc-passive-row';
          row.innerHTML = `<span class="enc-passive-name">${p.name}</span><span class="enc-passive-desc">${p.description || p.effect || ''}</span>`;
          passivesEl.appendChild(row);
        });
      }
    }

    // Extras slot (e.g. tracker buttons)
    const extrasEl = document.getElementById('enc-class-extras');
    if (extrasEl) {
      extrasEl.innerHTML = '';
      if (name === 'Venia') {
        const btn = document.createElement('button');
        btn.className = 'vt-open-btn';
        btn.textContent = 'Open Orb Tracker';
        btn.addEventListener('click', window._veniaTrackerOpen);
        extrasEl.appendChild(btn);
      }
      if (name === 'Petent') {
        const btn = document.createElement('button');
        btn.className = 'vt-open-btn';
        btn.textContent = 'Open Location Tracker';
        btn.addEventListener('click', window._petentTrackerOpen);
        extrasEl.appendChild(btn);
      }
      if (name === 'Astra') {
        const btn = document.createElement('button');
        btn.className = 'vt-open-btn';
        btn.textContent = 'Open Astra Tracker';
        btn.addEventListener('click', window._astraTrackerOpen);
        extrasEl.appendChild(btn);
      }
    }

    // Learned moves
    const movesEl = card.querySelector('.enc-class-moves');
    if (movesEl) {
      movesEl.innerHTML = '';
      const learns = moveData?.learns || [];
      if (learns.length) {
        const label = document.createElement('div');
        label.className = 'enc-moves-label';
        label.textContent = (type === 'Weapon' || type === 'Gear') ? 'Passives & Actives' : (type === 'Covenant') ? 'Abilities' : 'Moves';
        movesEl.appendChild(label);
        learns.forEach((m, mi) => {
          const btn = document.createElement('button');
          btn.className = 'enc-move-btn';
          const lvlText = m.level != null ? (type === 'Covenant' ? `Rank ${m.level}` : `Lv${m.level}`) : '';
          const typeBadge = m.type ? `<span class="enc-move-type-pill enc-mpill-${m.type.toLowerCase()}">${m.type}</span>` : '';
          btn.innerHTML = `<span class="enc-move-btn-name">${m.name}</span><span class="enc-move-btn-meta">${lvlText}${typeBadge}</span>`;
          btn.addEventListener('click', () => showMoveDetail(idx, mi, isRace));
          movesEl.appendChild(btn);
        });
      }
    }
  }

  /* ── Move detail panel ──────────────────────────────────────────────────── */
  function showMoveDetail(classIdx, moveIdx, isRace) {
    _moveSource  = { classIdx, moveIdx, isRace };
    _currentView = 'move';
    showPanel('enc-move-card');

    const moveData = getMoveData(classIdx);
    const m        = moveData?.learns?.[moveIdx];
    if (!m) return;

    const card = document.getElementById('enc-move-card');
    if (!card) return;

    const nameEl   = card.querySelector('.enc-move-name');
    const typePill = card.querySelector('.enc-move-type-badge');
    const quoteEl  = card.querySelector('.enc-move-quote');
    const statsEl  = card.querySelector('.enc-move-stats');
    const effectEl = card.querySelector('.enc-move-effect');

    if (nameEl) nameEl.textContent = m.name;

    if (typePill) {
      typePill.textContent = m.type || '';
      typePill.className   = 'enc-move-type-badge enc-mpill-' + (m.type || '').toLowerCase();
    }

    if (quoteEl) {
      quoteEl.textContent = m.quote || '';
      quoteEl.style.display = m.quote ? '' : 'none';
    }

    // Stats row
    if (statsEl) {
      statsEl.innerHTML = '';
      const stats = [];
      if (m.level)                stats.push({ label: 'Level', val: m.level });
      if (m.cost !== undefined)   stats.push({ label: 'Cost',  val: m.cost });
      if (m.cooldown !== undefined) stats.push({ label: 'CD',  val: m.cooldown });
      if (m.moveType)             stats.push({ label: 'Type',  val: m.moveType });
      if (m.category)             stats.push({ label: 'Cat',   val: m.category });
      if (m.damage !== undefined) stats.push({ label: 'Dmg',   val: m.damage });
      if (m.scaling)              stats.push({ label: 'Scl',   val: m.scaling });
      if (m.duration !== undefined) stats.push({ label: 'Dur', val: m.duration + ' turns' });
      stats.forEach(s => {
        const chip = document.createElement('div');
        chip.className = 'enc-stat-chip';
        chip.innerHTML = `<span class="enc-stat-label">${s.label}</span><span class="enc-stat-val">${s.val}</span>`;
        statsEl.appendChild(chip);
      });
    }

    if (effectEl) {
      effectEl.innerHTML = (m.effect || '').replace(/\n/g, '<br>');
      if (m.hpCalc) {
        const calc = document.createElement('div');
        calc.className = 'enc-hp-calc';
        calc.innerHTML = `
          <div class="enc-hp-calc-label">Damage Calculator</div>
          <div class="enc-hp-calc-row">
            <span class="enc-hp-calc-stat">Summon HP</span>
            <input type="range" min="0" max="100" value="90" id="enc-summon-hp-slider" class="enc-hp-slider">
            <span id="enc-summon-hp-val" class="enc-hp-calc-pct">90%</span>
          </div>
          <div class="enc-hp-calc-row">
            <span class="enc-hp-calc-stat">Damage</span>
            <span id="enc-summon-dmg-val" class="enc-hp-calc-dmg">≈ 121.5</span>
          </div>`;
        effectEl.appendChild(calc);
        const slider = calc.querySelector('#enc-summon-hp-slider');
        const hpVal  = calc.querySelector('#enc-summon-hp-val');
        const dmgVal = calc.querySelector('#enc-summon-dmg-val');
        function updateCalc() {
          const pct = slider.value / 100;
          const dmg = -110.59717 * pct + 220.07394;
          hpVal.textContent  = slider.value + '%';
          dmgVal.textContent = '≈ ' + dmg.toFixed(1);
        }
        slider.addEventListener('input', updateCalc);
        updateCalc();
      }
    }
  }

  function showObtainDetail(idx) {
    const it = ENC_ITEMS[idx];
    _moveSource  = { classIdx: idx, isRace: true };
    _currentView = 'move';
    showPanel('enc-move-card');

    const card = document.getElementById('enc-move-card');
    if (!card) return;

    const badge   = card.querySelector('.enc-move-type-badge');
    const nameEl  = card.querySelector('.enc-move-name');
    const quoteEl = card.querySelector('.enc-move-quote');
    const statsEl = card.querySelector('.enc-move-stats');
    const effectEl = card.querySelector('.enc-move-effect');

    if (badge)   { badge.textContent = ''; badge.className = 'enc-move-type-badge'; }
    if (nameEl)  nameEl.textContent = `How to Obtain (${it[0].replace(' (Obtainable)', '')})`;
    if (quoteEl) { quoteEl.textContent = ''; quoteEl.style.display = 'none'; }
    if (statsEl) statsEl.innerHTML = '';
    if (effectEl) effectEl.innerHTML = (it[2] || '').replace(/\n/g, '<br>');
  }

  /* ── Public API ──────────────────────────────────────────────────────────── */
  /* ── Overlay API ─────────────────────────────────────────────────────────── */
  window._ENC_ITEMS          = ENC_ITEMS;
  window._ENC_TYPE_ORDER     = TYPE_ORDER;
  window._ENC_TYPE_ICONS     = TYPE_ICONS;
  window._ENC_TRAINER_GROUPS = TRAINER_GROUPS;
  window._encGotoItem  = function (idx) {
    if (window.switchPage) window.switchPage('encyclopedia');
    setTimeout(() => selectItem(idx), 80);
  };

  window._encGetDetail = function (idx) {
    const it = ENC_ITEMS[idx];
    if (!it) return '';
    const [name, type, desc] = it;
    const S = (css) => `style="${css}"`;
    const sectionLabel = `font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#555;margin:10px 0 4px;`;
    const passiveName  = `font-size:12px;font-weight:600;color:#ddd;margin-bottom:2px;`;
    const passiveDesc  = `font-size:12px;color:#aaa;line-height:1.5;margin-bottom:8px;`;
    const moveName     = `font-size:12px;font-weight:600;color:#ddd;margin-bottom:2px;`;
    const moveMeta     = `font-size:10px;color:#555;margin-left:6px;`;
    const moveEff      = `font-size:12px;color:#aaa;line-height:1.5;margin-bottom:8px;`;

    let h = `<div ${S('display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;')}>
      <span ${S('font-size:10px;padding:2px 7px;border-radius:3px;background:#1a1a2a;color:#888;font-family:Rajdhani,Arial,sans-serif;font-weight:600;')}>${type}</span>
      <span ${S('font-family:Rajdhani,Arial,sans-serif;font-size:16px;font-weight:700;color:#fff;')}>${name}</span>
    </div>`;

    if (desc) h += `<div ${S('font-size:12px;color:#aaa;line-height:1.6;margin-bottom:10px;')}>${desc.replace(/\n/g,'<br>')}</div>`;

    // Weapon group description (obtain source + shard slots)
    if (type === 'Weapon') {
      const grp = WEAPON_GROUPS.find(g => g.prefix ? name.startsWith(g.prefix) : g.names?.has(name));
      if (grp?.desc) h += `<div ${S('font-size:12px;color:#aaa;line-height:1.6;margin-bottom:10px;')}>${grp.desc.replace(/\n/g,'<br>')}</div>`;
    }

    // Artifact / Enchant / Weapon Modifier
    if (['Artifact','Lesser Artifact','Enchant','Weapon Modifier'].includes(type)) {
      const a = ARTIFACT_DATA?.[name];
      if (a) {
        if (a.obtainableFrom?.length) {
          h += `<div ${S(sectionLabel)}>Obtainable From</div>`;
          a.obtainableFrom.forEach(s => { h += `<div ${S('font-size:12px;color:#999;padding:2px 0;')}>${s.label}</div>`; });
        }
        if (a.passives?.length) {
          h += `<div ${S(sectionLabel)}>Passives</div>`;
          a.passives.forEach(p => {
            if (p.name) h += `<div ${S(passiveName)}>${p.name}</div>`;
            h += `<div ${S(passiveDesc)}>${(p.description||p.effect||'').replace(/\n/g,'<br>')}</div>`;
          });
        }
        if (a.moves?.length) {
          h += `<div ${S(sectionLabel)}>Moves</div>`;
          a.moves.forEach(m => {
            const meta = [m.cost!=null?`Cost:${m.cost}`:'',m.cooldown!=null?`CD:${m.cooldown}`:'',m.moveType||''].filter(Boolean).join(' · ');
            h += `<div ${S(moveName)}>${m.name}${meta?`<span ${S(moveMeta)}>${meta}</span>`:''}</div>`;
            h += `<div ${S(moveEff)}>${(m.effect||'').replace(/\n/g,'<br>')}</div>`;
          });
        }
      }
    }

    // Classes / Races / Weapons / Covenants / Marks / Gear
    if (CLASS_TYPES.has(type)) {
      const md = getMoveData(idx);
      if (md?.innatePassives?.length) {
        h += `<div ${S(sectionLabel)}>Innate Passives</div>`;
        md.innatePassives.forEach(p => {
          if (p.name) h += `<div ${S(passiveName)}>${p.name}</div>`;
          h += `<div ${S(passiveDesc)}>${(p.description||p.effect||'').replace(/\n/g,'<br>')}</div>`;
        });
      }
      if (md?.learns?.length) {
        h += `<div ${S(sectionLabel)}>Moves</div>`;
        md.learns.forEach(m => {
          const lvl = m.level!=null?(type==='Covenant'?`Rank ${m.level}`:`Lv${m.level}`):'';
          h += `<div ${S(moveName)}>${m.name}${lvl?`<span ${S(moveMeta)}>${lvl}</span>`:''}${m.type?`<span ${S(moveMeta)}>${m.type}</span>`:''}</div>`;
          h += `<div ${S(moveEff)}>${(m.effect||'').replace(/\n/g,'<br>')}</div>`;
        });
      }
    }

    // Bosses / Mobs / Mini Bosses
    if (type === 'Boss' || type === 'Mini Boss' || type === 'Mob') {
      const bossKey = type === 'Mob' ? Object.keys(BOSS_MOVE_DATA).find(k => k.toLowerCase() === name.toLowerCase()) || name : name;
      const bd = BOSS_MOVE_DATA?.[bossKey]?.learns || BOSS_MOVE_DATA?.[bossKey];
      if (Array.isArray(bd) && bd.length) {
        h += `<div ${S(sectionLabel)}>Moves & Passives</div>`;
        bd.forEach(m => {
          h += `<div ${S(moveName)}>${m.name}${m.category?`<span ${S(moveMeta)}>${m.category}</span>`:''}</div>`;
          h += `<div ${S(moveEff)}>${(m.effect||'').replace(/\n/g,'<br>')}</div>`;
        });
      }
    }

    return h;
  };

  window._encFilter = function (type, btn) {
    _activeType  = type;
    _selectedIdx = -1;
    document.querySelectorAll('.enc-type-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    showPanel('enc-detail-empty');
    render();
  };

  window._encSearch = function (q) {
    _searchTerm  = q.trim().toLowerCase();
    _selectedIdx = -1;
    showPanel('enc-detail-empty');
    render();
  };

  window._encMoveBack = function () {
    if (_moveSource == null) return;
    if (_moveSource.isBoss) showBossDetail(_moveSource.classIdx);
    else showClassDetail(_moveSource.classIdx);
  };

  /* ── Venia Orb Tracker ──────────────────────────────────────────────────── */
  const VENIA_ORBS = ['Caldera Orb', 'Blades Orb', 'Deeproot Orb', 'Icerift Orb'];

  const VENIA_ARTIFACTS = [
    { name: 'Memory Fragment',     category: 'Lesser Artifact' },
    { name: 'Soul Dust',           category: 'Lesser Artifact' },
    { name: 'Lineage Shard',       category: 'Lesser Artifact' },
    { name: 'Phoenix Tear',        category: 'Lesser Artifact' },
    { name: 'Resplendent Essence', category: 'Lesser Artifact' },
    { name: 'Void Key',            category: 'Lesser Artifact' },
    { name: 'Echo Shard',          category: 'Lesser Artifact' },
    { name: 'Reality Watch',       category: "Yar'thul Drop" },
    { name: "Narthana's Sigil",    category: "Yar'thul Drop" },
    { name: 'Shifting Hourglass',  category: "Yar'thul Drop" },
    { name: 'Dark Sigil',          category: 'Thorian Drop' },
    { name: "Metrom's Amulet",     category: 'Thorian Drop' },
    { name: 'Stellian Core',       category: 'Thorian Drop' },
    { name: 'Chaos Orb',           category: "Metrom's / Other" },
    { name: 'Skyward Totem',       category: "Metrom's / Other" },
  ];

  const VT_KEY = 'al-venia-tracker';

  /* Document targets for PiP support — overlay.js calls _vtSetDoc/_ptSetDoc/
     _atSetDoc to redirect renders into the PiP window. Reset to `document`
     when PiP closes or the user switches tabs.                             */
  let _vtDoc = document;
  let _ptDoc = document;
  let _atDoc = document;

  function vtGetMeta() {
    try {
      const raw = JSON.parse(localStorage.getItem(VT_KEY));
      if (raw && Array.isArray(raw.tabs)) return raw;
      // migrate old flat format
      return { tabs: [{ id: 't1', name: 'Run 1', data: raw || {} }], activeTab: 't1' };
    } catch {
      return { tabs: [{ id: 't1', name: 'Run 1', data: {} }], activeTab: 't1' };
    }
  }
  function vtSaveMeta(meta)      { localStorage.setItem(VT_KEY, JSON.stringify(meta)); }
  function vtNewId()             { return 't' + Date.now(); }
  function vtActiveTab(meta)     { return meta.tabs.find(t => t.id === meta.activeTab) || meta.tabs[0]; }
  function vtGetData(meta)       { return vtActiveTab(meta).data; }
  function vtSetData(meta, d)    { vtActiveTab(meta).data = d; }
  function vtGet(d, orb, art)    { return d[orb]?.[art] || 0; }
  function vtGetTier(meta)       { return vtActiveTab(meta).tier || 1; }
  function vtSetTier(meta, tier) { vtActiveTab(meta).tier = tier; }

  function vtRenderTier() {
    const el = _vtDoc.getElementById('venia-tracker-tier');
    if (!el) return;
    const meta = vtGetMeta();
    const tier = vtGetTier(meta);
    el.innerHTML = '';
    const label = _vtDoc.createElement('span');
    label.className = 'pt-tier-label';
    label.textContent = 'Tier:';
    el.appendChild(label);
    [1, 2, 3, 4, 5].forEach(t => {
      const btn = _vtDoc.createElement('button');
      btn.className = 'pt-tier-btn' + (tier === t ? ' pt-tier-active' : '');
      btn.textContent = `Tier ${t}`;
      btn.addEventListener('click', () => {
        const m = vtGetMeta(); vtSetTier(m, t); vtSaveMeta(m); vtRender();
      });
      el.appendChild(btn);
    });
  }

  function vtRenderTabs(meta) {
    const tabsEl = _vtDoc.getElementById('venia-tracker-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    meta.tabs.forEach(tab => {
      const wrap = _vtDoc.createElement('div');
      wrap.className = 'vt-tab-wrap' + (tab.id === meta.activeTab ? ' vt-tab-active' : '');

      const nameBtn = _vtDoc.createElement('button');
      nameBtn.className = 'vt-tab-btn';
      nameBtn.textContent = tab.name;
      nameBtn.title = 'Click to switch · Double-click to rename';
      nameBtn.addEventListener('click', () => {
        meta.activeTab = tab.id;
        vtSaveMeta(meta);
        vtRender();
      });
      nameBtn.addEventListener('dblclick', e => {
        e.stopPropagation();
        const newName = prompt('Rename tab:', tab.name);
        if (newName && newName.trim()) {
          tab.name = newName.trim();
          vtSaveMeta(meta);
          vtRender();
        }
      });
      wrap.appendChild(nameBtn);

      if (meta.tabs.length > 1) {
        const delBtn = _vtDoc.createElement('button');
        delBtn.className = 'vt-tab-del';
        delBtn.textContent = '×';
        delBtn.title = 'Delete tab';
        delBtn.addEventListener('click', e => {
          e.stopPropagation();
          if (!confirm(`Delete "${tab.name}"?`)) return;
          const idx = meta.tabs.findIndex(t => t.id === tab.id);
          meta.tabs.splice(idx, 1);
          if (meta.activeTab === tab.id) {
            meta.activeTab = meta.tabs[Math.max(0, idx - 1)].id;
          }
          vtSaveMeta(meta);
          vtRender();
        });
        wrap.appendChild(delBtn);
      }

      tabsEl.appendChild(wrap);
    });

    const addBtn = _vtDoc.createElement('button');
    addBtn.className = 'vt-tab-add';
    addBtn.textContent = '+ Add Tab';
    addBtn.addEventListener('click', () => {
      const name = prompt('Tab name:', `Run ${meta.tabs.length + 1}`);
      if (!name || !name.trim()) return;
      const id = vtNewId();
      meta.tabs.push({ id, name: name.trim(), data: {} });
      meta.activeTab = id;
      vtSaveMeta(meta);
      vtRender();
    });
    tabsEl.appendChild(addBtn);
  }

  function vtRender() {
    const meta = vtGetMeta();
    const data = vtGetData(meta);
    const tier = vtGetTier(meta);
    vtRenderTabs(meta);
    vtRenderTier();

    const grid = _vtDoc.getElementById('venia-tracker-grid');
    if (!grid) return;
    grid.innerHTML = '';
    VENIA_ORBS.forEach(orb => {
      const col = _vtDoc.createElement('div');
      col.className = 'vt-col';

      // Per-column T1 validation: need exactly 3 green before T2+ view activates
      const greenCount = VENIA_ARTIFACTS.filter(a => vtGet(data, orb, a.name) === 1).length;
      const colReady   = tier === 1 || greenCount === 3;

      const hdr = _vtDoc.createElement('div');
      hdr.className = 'vt-col-hdr';
      const warnSpan = (tier > 1 && !colReady)
        ? `<span class="vt-col-warn">${greenCount}/3 T1 picks</span>` : '';
      hdr.innerHTML = `<span>${orb}</span>${warnSpan}<button class="vt-reset-btn" onclick="window._veniaOrbReset('${CSS.escape(orb)}')">Reset</button>`;
      col.appendChild(hdr);

      let lastCat = null;
      VENIA_ARTIFACTS.forEach(a => {
        if (a.category !== lastCat) {
          const catDiv = _vtDoc.createElement('div');
          catDiv.className = 'vt-cat-label';
          catDiv.textContent = a.category;
          col.appendChild(catDiv);
          lastCat = a.category;
        }
        const val = vtGet(data, orb, a.name);
        // Per-tier pick: separate from T1 state, stored in data.tierPicks[tier][orb][artName]
        const tierPick = tier > 1 ? (data.tierPicks?.[tier]?.[orb]?.[a.name] || 0) : 0;
        let cls, icon;
        if (tier > 1 && colReady) {
          if (val === 1) {
            // T1 green: show as green if picked for this tier, dark/unselected otherwise
            cls  = tierPick ? 'vt-state-green' : 'vt-state-collected';
            icon = tierPick ? '✓' : '○';
          } else {
            // Not picked in T1: always red
            cls  = 'vt-state-red';
            icon = '✕';
          }
        } else {
          // T1 view or column not yet valid: normal cycling
          cls  = val === 1 ? 'vt-state-green' : val === 2 ? 'vt-state-red' : '';
          icon = val === 1 ? '✓' : val === 2 ? '✕' : '○';
        }
        const row = _vtDoc.createElement('button');
        row.className = `vt-artifact-row ${cls}`;
        row.innerHTML = `<span class="vt-artifact-icon">${icon}</span><span class="vt-artifact-name">${a.name}</span>`;
        row.addEventListener('click', () => {
          const m = vtGetMeta();
          const d = vtGetData(m);
          const curTier = vtGetTier(m);
          const curVal  = vtGet(d, orb, a.name);
          if (curTier > 1 && curVal === 1) {
            // Collected item: toggle tier pick only (green ↔ unselected), don't touch T1 state
            if (!d.tierPicks)                  d.tierPicks = {};
            if (!d.tierPicks[curTier])         d.tierPicks[curTier] = {};
            if (!d.tierPicks[curTier][orb])    d.tierPicks[curTier][orb] = {};
            d.tierPicks[curTier][orb][a.name] = d.tierPicks[curTier][orb][a.name] ? 0 : 1;
          } else {
            // T1 view or red item: normal T1 cycle
            if (!d[orb]) d[orb] = {};
            d[orb][a.name] = (vtGet(d, orb, a.name) + 1) % 3;
          }
          vtSetData(m, d);
          vtSaveMeta(m);
          vtRender();
        });
        col.appendChild(row);
      });
      grid.appendChild(col);
    });
  }

  window._veniaTrackerOpen = function () {
    if (_vtDoc === document) document.getElementById('venia-tracker-overlay').style.display = 'flex';
    vtRender();
  };
  window._veniaTrackerClose = function () {
    if (_vtDoc === document) document.getElementById('venia-tracker-overlay').style.display = 'none';
  };
  let _veniaPopupWin = null;
  window._veniaTrackerPopout = function () {
    if (_veniaPopupWin && !_veniaPopupWin.closed) { _veniaPopupWin.focus(); return; }
    _veniaPopupWin = window.open('../html/tracker-popup.html?tracker=venia', 'alb-venia-popup', 'width=980,height=700,resizable=yes,scrollbars=yes');
    if (_veniaPopupWin) { _veniaPopupWin.focus(); window._veniaTrackerClose(); }
  };
  window._veniaOrbReset = function (orb) {
    const m = vtGetMeta();
    const d = vtGetData(m);
    d[orb] = {};
    vtSetData(m, d);
    vtSaveMeta(m);
    vtRender();
  };

  /* ── Petent Tracker ─────────────────────────────────────────────────────── */
  const PETENT_MOBS = [
    { name: 'Slime',                note: '',            t1: false },
    { name: 'Thief',                note: '',            t1: false },
    { name: 'Mushroom',             note: '',            t1: false },
    { name: 'Grass Spirit',         note: '',            t1: false },
    { name: 'Goblin',               note: '',            t1: false },
    { name: 'Gon',                  note: '',            t1: false },
    { name: 'Thanasludd',           note: '',            t1: false },
    { name: 'Desert Bandit',        note: '',            t1: false },
    { name: 'Sand Elemental',       note: '',            t1: false },
    { name: 'Stray Sandstorm',      note: '',            t1: false },
    { name: 'Sand Golem',           note: '',            t1: false },
    { name: 'Night Raider',         note: '',            t1: false },
    { name: 'Duneguard',            note: '',            t1: false },
    { name: 'Lava Golem',           note: '',            t1: false },
    { name: 'Lava Crab',            note: '',            t1: false },
    { name: 'Fog Spirit',           note: '',            t1: false },
    { name: 'Venom Shroom',         note: '',            t1: false },
    { name: 'Cursed Corpse',        note: '',            t1: false },
    { name: 'Cess Horror',          note: '',            t1: false },
    { name: 'Sentient Darkness',    note: '',            t1: false },
    { name: 'Ptoruco',              note: '',            t1: false },
    { name: 'Shadeblade',           note: 'Tier 1 only', t1: true  },
    { name: 'Star Slime',           note: '',            t1: false },
    { name: 'The Smallest Boulder', note: '',            t1: false },
  ];

  const PETENT_BOSSES = [
    { name: "Yar'thul",          note: '',            t1: false },
    { name: 'Thorian',           note: '',            t1: false },
    { name: 'Handaconda',        note: '',            t1: false },
    { name: "Metrom's Vessel",   note: 'Tier 1 only', t1: true  },
  ];

  const PETENT_LOCATIONS = [
    { name: 'Caldera',                note: '',                         t1: false },
    { name: 'Crossing',               note: '',                         t1: false },
    { name: 'Icerift Approach',        note: '',                         t1: false },
    { name: 'Waving Sands',           note: '',                         t1: false },
    { name: 'The Old Ruins',          note: '',                         t1: false },
    { name: 'Sanctuary of the Blades',note: '',                         t1: false },
    { name: 'Mount Thul',             note: '',                         t1: false },
    { name: 'Inferno Chamber',        note: "Yar'thul Arena",           t1: false },
    { name: 'Westwood',               note: '',                         t1: false },
    { name: 'Deeproot Canopy',        note: '',                         t1: false },
    { name: 'Deeproot Depths',        note: '',                         t1: false },
    { name: 'Cessgrounds',            note: '',                         t1: false },
    { name: 'Amoran Chasm',           note: '',                         t1: false },
    { name: 'Cursed Remnants',        note: 'Thorian arena',            t1: false },
    { name: 'Forgotten Sanctum',      note: 'Lifesong',                 t1: false },
    { name: 'Temporal Jailhouse',     note: 'MV Arena · needed all tiers (bugged)', t1: false },
    { name: 'Fragmented Jailhouse',   note: 'MV Phase 2',               t1: false },
    { name: 'Spirit Realm',           note: 'Meditation',               t1: false },
    { name: 'Illustris',              note: 'Church',                   t1: false },
    { name: 'Temple of Norn',         note: 'Cult',                     t1: false },
  ];

  const PETENT_VOID_TRIALS = [
    { name: 'Zombie Mushroom', note: 'Icerift void', t1: false },
    { name: 'Sand Golem',      note: '',             t1: false },
    { name: 'Corpse',          note: '',             t1: false },
  ];

  const PETENT_QUESTS = [
    { name: 'Starter Quest (Daze)',    note: '',              t1: false },
    { name: 'Potion Help',             note: '',              t1: false },
    { name: 'Package Delivery',        note: '',              t1: false },
    { name: 'Guild Request Help',      note: '',              t1: false },
    { name: 'Spare Gold?',             note: '',              t1: false },
    { name: "Sky Man's Request",       note: '',              t1: false },
    { name: 'Looking for Help',        note: '',              t1: false },
    { name: "Bone Man's Request",      note: '',              t1: false },
    { name: 'Ingredient Help',         note: 'Chaotic',       t1: false },
    { name: 'Ingredient Help',         note: 'Orderly',       t1: false },
    { name: 'Taking in the Sights',    note: 'Push the guy',  t1: false },
    { name: 'Someone Is Going to Die', note: '',              t1: false },
    { name: 'Crylight Request',        note: '',              t1: false },
    { name: "Leaf Man's Quest",        note: '',              t1: false },
    { name: "Tor'run's Final Request", note: '',              t1: false },
  ];

  const PETENT_FINAL = [
    { name: 'Place a Void Key into the soul vault', note: '', t1: false },
  ];

  const PT_KEY = 'al-petent-tracker';

  function ptGetMeta() {
    try {
      const raw = JSON.parse(localStorage.getItem(PT_KEY));
      if (raw && Array.isArray(raw.tabs)) return raw;
      return { tabs: [{ id: 'p1', name: 'Run 1', tier: 1, data: {} }], activeTab: 'p1' };
    } catch {
      return { tabs: [{ id: 'p1', name: 'Run 1', tier: 1, data: {} }], activeTab: 'p1' };
    }
  }
  function ptSaveMeta(meta)      { localStorage.setItem(PT_KEY, JSON.stringify(meta)); }
  function ptNewId()             { return 'p' + Date.now(); }
  function ptActiveTab(meta)     { return meta.tabs.find(t => t.id === meta.activeTab) || meta.tabs[0]; }
  function ptGetTier(meta)       { return ptActiveTab(meta).tier || 1; }
  function ptSetTier(meta, tier) { ptActiveTab(meta).tier = tier; }
  function ptGetData(meta) {
    const d = ptActiveTab(meta).data;
    if (!d.locs) d.locs = {}; if (!d.mobs) d.mobs = {}; if (!d.bosses) d.bosses = {};
    if (!d.quests) d.quests = {}; if (!d.voidTrials) d.voidTrials = {}; if (!d.final) d.final = {};
    return d;
  }
  function ptSetData(meta, d) { ptActiveTab(meta).data = d; }

  function ptRenderTabs(meta) {
    const tabsEl = _ptDoc.getElementById('petent-tracker-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    meta.tabs.forEach(tab => {
      const wrap = _ptDoc.createElement('div');
      wrap.className = 'vt-tab-wrap' + (tab.id === meta.activeTab ? ' vt-tab-active' : '');
      const nameBtn = _ptDoc.createElement('button');
      nameBtn.className = 'vt-tab-btn';
      nameBtn.textContent = tab.name;
      nameBtn.title = 'Click to switch · Double-click to rename';
      nameBtn.addEventListener('click', () => { meta.activeTab = tab.id; ptSaveMeta(meta); ptRender(); });
      nameBtn.addEventListener('dblclick', e => {
        e.stopPropagation();
        const newName = prompt('Rename tab:', tab.name);
        if (newName && newName.trim()) { tab.name = newName.trim(); ptSaveMeta(meta); ptRender(); }
      });
      wrap.appendChild(nameBtn);
      if (meta.tabs.length > 1) {
        const delBtn = _ptDoc.createElement('button');
        delBtn.className = 'vt-tab-del';
        delBtn.textContent = '×';
        delBtn.title = 'Delete tab';
        delBtn.addEventListener('click', e => {
          e.stopPropagation();
          if (!confirm(`Delete "${tab.name}"?`)) return;
          const idx = meta.tabs.findIndex(t => t.id === tab.id);
          meta.tabs.splice(idx, 1);
          if (meta.activeTab === tab.id) meta.activeTab = meta.tabs[Math.max(0, idx - 1)].id;
          ptSaveMeta(meta); ptRender();
        });
        wrap.appendChild(delBtn);
      }
      tabsEl.appendChild(wrap);
    });
    const addBtn = _ptDoc.createElement('button');
    addBtn.className = 'vt-tab-add';
    addBtn.textContent = '+ Add Tab';
    addBtn.addEventListener('click', () => {
      const name = prompt('Tab name:', `Run ${meta.tabs.length + 1}`);
      if (!name || !name.trim()) return;
      const id = ptNewId();
      meta.tabs.push({ id, name: name.trim(), tier: 1, data: {} });
      meta.activeTab = id;
      ptSaveMeta(meta); ptRender();
    });
    tabsEl.appendChild(addBtn);
  }

  function ptRenderTier() {
    const el = _ptDoc.getElementById('petent-tracker-tier');
    if (!el) return;
    const meta = ptGetMeta();
    const tier = ptGetTier(meta);
    el.innerHTML = '';
    const label = _ptDoc.createElement('span');
    label.className = 'pt-tier-label';
    label.textContent = 'Tier:';
    el.appendChild(label);
    [1, 2, 3, 4, 5].forEach(t => {
      const btn = _ptDoc.createElement('button');
      btn.className = 'pt-tier-btn' + (tier === t ? ' pt-tier-active' : '');
      btn.textContent = `Tier ${t}`;
      btn.addEventListener('click', () => {
        const m = ptGetMeta(); ptSetTier(m, t); ptSaveMeta(m); ptRender();
      });
      el.appendChild(btn);
    });
  }

  function ptMakeRow(label, note, val, onClick) {
    const cls  = val === 1 ? 'vt-state-green' : '';
    const icon = val === 1 ? '✓' : '○';
    const row  = _ptDoc.createElement('button');
    row.className = `vt-artifact-row ${cls}`;
    row.innerHTML = `<span class="vt-artifact-icon">${icon}</span><span class="vt-artifact-name">${label}${note ? `<span class="pt-mob-note"> (${note})</span>` : ''}</span>`;
    row.addEventListener('click', onClick);
    return row;
  }

  function ptMakeNote(text) {
    const d = _ptDoc.createElement('div');
    d.className = 'pt-info-note';
    d.textContent = text;
    return d;
  }

  function ptAddSection(grid, title, items, dataObj, sectionKey, tier, noteText, questKeys) {
    const visible = tier > 1 ? items.filter(i => !i.t1) : items;
    const hdr = _ptDoc.createElement('div');
    hdr.className = 'pt-section-hdr';
    hdr.textContent = title;
    grid.appendChild(hdr);
    if (noteText) grid.appendChild(ptMakeNote(noteText));
    if (visible.length === 0) return;
    const g = _ptDoc.createElement('div');
    g.className = 'pt-loc-grid';
    visible.forEach((item, idx) => {
      const key = questKeys ? `${idx}:${item.name}` : item.name;
      g.appendChild(ptMakeRow(item.name, item.note, (dataObj[sectionKey] || {})[key] || 0, () => {
        const m = ptGetMeta(); const d = ptGetData(m);
        d[sectionKey][key] = ((d[sectionKey][key] || 0) + 1) % 2;
        ptSetData(m, d); ptSaveMeta(m); ptRender();
      }));
    });
    grid.appendChild(g);
  }

  function ptRender() {
    const meta = ptGetMeta();
    const data = ptGetData(meta);
    const tier = ptGetTier(meta);
    ptRenderTabs(meta);
    ptRenderTier();
    const grid = _ptDoc.getElementById('petent-tracker-grid');
    if (!grid) return;
    grid.innerHTML = '';

    ptAddSection(grid, 'Mob Kills — You need the last hit', PETENT_MOBS,       data, 'mobs',       tier, null,  false);
    ptAddSection(grid, 'Boss Kills — Last hit not required', PETENT_BOSSES,     data, 'bosses',     tier, null,  false);
    ptAddSection(grid, 'Locations',                          PETENT_LOCATIONS,  data, 'locs',       tier, null,  false);
    ptAddSection(grid, 'Void Trials',                        PETENT_VOID_TRIALS,data, 'voidTrials', tier,
      'Hold out a void key before jumping into a void to enter the trials.', false);
    ptAddSection(grid, 'Quests',                             PETENT_QUESTS,     data, 'quests',     tier,
      "Daze and Sky Man's Request: if you have soul tree nodes that auto-complete them, just talk to the NPC.", true);
    ptAddSection(grid, 'Final Steps',                        PETENT_FINAL,      data, 'final',      tier, null,  false);
    grid.appendChild(ptMakeNote('After completing all of the above, wipe.'));
  }

  window._petentTrackerOpen = function () {
    if (_ptDoc === document) document.getElementById('petent-tracker-overlay').style.display = 'flex';
    ptRender();
  };
  window._petentTrackerClose = function () {
    if (_ptDoc === document) document.getElementById('petent-tracker-overlay').style.display = 'none';
  };
  let _petentPopupWin = null;
  window._petentTrackerPopout = function () {
    if (_petentPopupWin && !_petentPopupWin.closed) { _petentPopupWin.focus(); return; }
    _petentPopupWin = window.open('../html/tracker-popup.html?tracker=petent', 'alb-petent-popup', 'width=700,height=700,resizable=yes,scrollbars=yes');
    if (_petentPopupWin) { _petentPopupWin.focus(); window._petentTrackerClose(); }
  };

  /* ── Astra Tracker ──────────────────────────────────────────────────────── */
  const ASTRA_EMBLEM = [
    { name: '5 Astral Shards', note: '' },
    { name: 'Stellian Core',   note: '' },
    { name: '15k Gold',        note: '' },
  ];

  const ASTRA_ENEMIES = [
    { name: 'Goblin',            note: '' },
    { name: 'Thanasludd',        note: '' },
    { name: 'Gon',               note: '' },
    { name: 'Duneguard',         note: '' },
    { name: 'Night Raider',      note: '' },
    { name: 'Ptoruco',           note: '' },
    { name: 'Sentient Darkness', note: '' },
    { name: 'Star Slime',        note: '' },
    { name: 'Arkhaia',           note: '' },
  ];

  const AT_KEY = 'al-astra-tracker';

  function atGetMeta() {
    try {
      const raw = JSON.parse(localStorage.getItem(AT_KEY));
      if (raw && Array.isArray(raw.tabs)) return raw;
      return { tabs: [{ id: 'a1', name: 'Run 1', data: {} }], activeTab: 'a1' };
    } catch {
      return { tabs: [{ id: 'a1', name: 'Run 1', data: {} }], activeTab: 'a1' };
    }
  }
  function atSaveMeta(meta)   { localStorage.setItem(AT_KEY, JSON.stringify(meta)); }
  function atNewId()          { return 'a' + Date.now(); }
  function atActiveTab(meta)  { return meta.tabs.find(t => t.id === meta.activeTab) || meta.tabs[0]; }
  function atGetData(meta)    { const d = atActiveTab(meta).data; if (!d.emblem) d.emblem = {}; if (!d.enemies) d.enemies = {}; return d; }
  function atSetData(meta, d) { atActiveTab(meta).data = d; }

  function atRenderTabs(meta) {
    const tabsEl = _atDoc.getElementById('astra-tracker-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    meta.tabs.forEach(tab => {
      const wrap = _atDoc.createElement('div');
      wrap.className = 'vt-tab-wrap' + (tab.id === meta.activeTab ? ' vt-tab-active' : '');
      const nameBtn = _atDoc.createElement('button');
      nameBtn.className = 'vt-tab-btn';
      nameBtn.textContent = tab.name;
      nameBtn.title = 'Click to switch · Double-click to rename';
      nameBtn.addEventListener('click', () => { meta.activeTab = tab.id; atSaveMeta(meta); atRender(); });
      nameBtn.addEventListener('dblclick', e => {
        e.stopPropagation();
        const newName = prompt('Rename tab:', tab.name);
        if (newName && newName.trim()) { tab.name = newName.trim(); atSaveMeta(meta); atRender(); }
      });
      wrap.appendChild(nameBtn);
      if (meta.tabs.length > 1) {
        const delBtn = _atDoc.createElement('button');
        delBtn.className = 'vt-tab-del';
        delBtn.textContent = '×';
        delBtn.title = 'Delete tab';
        delBtn.addEventListener('click', e => {
          e.stopPropagation();
          if (!confirm(`Delete "${tab.name}"?`)) return;
          const idx = meta.tabs.findIndex(t => t.id === tab.id);
          meta.tabs.splice(idx, 1);
          if (meta.activeTab === tab.id) meta.activeTab = meta.tabs[Math.max(0, idx - 1)].id;
          atSaveMeta(meta); atRender();
        });
        wrap.appendChild(delBtn);
      }
      tabsEl.appendChild(wrap);
    });
    const addBtn = _atDoc.createElement('button');
    addBtn.className = 'vt-tab-add';
    addBtn.textContent = '+ Add Tab';
    addBtn.addEventListener('click', () => {
      const name = prompt('Tab name:', `Run ${meta.tabs.length + 1}`);
      if (!name || !name.trim()) return;
      const id = atNewId();
      meta.tabs.push({ id, name: name.trim(), data: {} });
      meta.activeTab = id;
      atSaveMeta(meta); atRender();
    });
    tabsEl.appendChild(addBtn);
  }

  function atMakeRow(label, note, val, onClick) {
    const cls  = val === 1 ? 'vt-state-green' : '';
    const icon = val === 1 ? '✓' : '○';
    const row  = _atDoc.createElement('button');
    row.className = `vt-artifact-row ${cls}`;
    row.innerHTML = `<span class="vt-artifact-icon">${icon}</span><span class="vt-artifact-name">${label}${note ? `<span class="pt-mob-note"> (${note})</span>` : ''}</span>`;
    row.addEventListener('click', onClick);
    return row;
  }

  function atRender() {
    const meta = atGetMeta();
    const data = atGetData(meta);
    atRenderTabs(meta);
    const grid = _atDoc.getElementById('astra-tracker-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Celestial Emblem section
    const emblemHdr = _atDoc.createElement('div');
    emblemHdr.className = 'pt-section-hdr';
    emblemHdr.textContent = 'Celestial Emblem';
    grid.appendChild(emblemHdr);
    const emblemGrid = _atDoc.createElement('div');
    emblemGrid.className = 'pt-loc-grid';
    ASTRA_EMBLEM.forEach(({ name, note }) => {
      emblemGrid.appendChild(atMakeRow(name, note, data.emblem[name] || 0, () => {
        const m = atGetMeta(); const d = atGetData(m);
        d.emblem[name] = ((d.emblem[name] || 0) + 1) % 2;
        atSetData(m, d); atSaveMeta(m); atRender();
      }));
    });
    grid.appendChild(emblemGrid);
    const wipeNote = _atDoc.createElement('div');
    wipeNote.className = 'pt-info-note';
    wipeNote.textContent = 'Make sure to wipe while having the Celestial Emblem equipped.';
    grid.appendChild(wipeNote);

    // Celestial Enemies section
    const enemyHdr = _atDoc.createElement('div');
    enemyHdr.className = 'pt-section-hdr';
    enemyHdr.textContent = 'Celestial Enemies';
    grid.appendChild(enemyHdr);
    const enemyGrid = _atDoc.createElement('div');
    enemyGrid.className = 'pt-loc-grid';
    ASTRA_ENEMIES.forEach(({ name, note }) => {
      enemyGrid.appendChild(atMakeRow(name, note, data.enemies[name] || 0, () => {
        const m = atGetMeta(); const d = atGetData(m);
        d.enemies[name] = ((d.enemies[name] || 0) + 1) % 2;
        atSetData(m, d); atSaveMeta(m); atRender();
      }));
    });
    grid.appendChild(enemyGrid);
  }

  window._astraTrackerOpen = function () {
    if (_atDoc === document) document.getElementById('astra-tracker-overlay').style.display = 'flex';
    atRender();
  };
  window._astraTrackerClose = function () {
    if (_atDoc === document) document.getElementById('astra-tracker-overlay').style.display = 'none';
  };
  let _astraPopupWin = null;
  window._astraTrackerPopout = function () {
    if (_astraPopupWin && !_astraPopupWin.closed) { _astraPopupWin.focus(); return; }
    _astraPopupWin = window.open('../html/tracker-popup.html?tracker=astra', 'alb-astra-popup', 'width=600,height=600,resizable=yes,scrollbars=yes');
    if (_astraPopupWin) { _astraPopupWin.focus(); window._astraTrackerClose(); }
  };

  // Re-render open trackers when popup saves changes back to localStorage
  window.addEventListener('storage', e => {
    if (e.key === VT_KEY && (_vtDoc !== document || document.getElementById('venia-tracker-overlay')?.style.display !== 'none')) vtRender();
    if (e.key === PT_KEY && (_ptDoc !== document || document.getElementById('petent-tracker-overlay')?.style.display !== 'none')) ptRender();
    if (e.key === AT_KEY && (_atDoc !== document || document.getElementById('astra-tracker-overlay')?.style.display !== 'none')) atRender();
  });

  window._vtSetDoc = d => { _vtDoc = d || document; };
  window._ptSetDoc = d => { _ptDoc = d || document; };
  window._atSetDoc = d => { _atDoc = d || document; };
  window._vtRender = () => vtRender();
  window._ptRender = () => ptRender();
  window._atRender = () => atRender();

  /* ── Init ───────────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
