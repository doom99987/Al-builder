(function () {
  /* ── Item data: [name, type, description] ────────────────────────────────
     description = '' means no known in-game description yet               */
  const ENC_ITEMS = [

    /* ── ORES ─────────────────────────────────────────────────────────── */
    ['Aestic Ore',            'Ore',             'A brittle ore found in arid regions. Used as a base material in standard smithing.'],
    ['Ferrus Ore',            'Ore',             'A dense iron-like ore. The most common crafting material for base-tier weapons and tools.'],
    ['Laneus Ore',            'Ore',             'A refined ore with mild magical conductivity. Used in mid-tier equipment crafting.'],

    /* ── INGREDIENTS ──────────────────────────────────────────────────── */
    ['Carnastool',            'Ingredient',      'A dense mushroom with a meaty texture. Used in basic alchemical recipes.'],
    ['Cryastem',              'Ingredient',      'A frost-infused plant stem. Provides cold elemental properties to potions and crafted items.'],
    ['Crylight',              'Ingredient',      'Crystallized magical light with frost essence. A rare ingredient required for advanced frost crafting.'],
    ['Driproot',              'Ingredient',      'A root that slowly secretes magical sap. Used in restorative and healing brews.'],
    ['Everthistle',           'Ingredient',      'A resilient thistle that never wilts. Commonly used in endurance and stamina-boosting recipes.'],
    ['Haze Chunk',            'Ingredient',      'A solidified piece of magical haze. Adds obscurement properties to potions and crafted gear.'],
    ['Hightail',              'Ingredient',      'Harvested from swift-moving creatures. Adds agility and speed properties when used in crafting.'],
    ['Mushroom Cap',          'Ingredient',      'A common mushroom cap. Used in the most basic potion and food recipes.'],
    ['Restless Fragment',     'Ingredient',      'A fragment trembling with residual magical energy. Used in volatile or unstable crafting recipes.'],
    ['Rot Core',              'Ingredient',      'The decayed core extracted from an undead creature. Used in dark and necromantic crafting.'],
    ['Sand Core',             'Ingredient',      'The compressed core of a desert creature. Provides earth and sand elemental properties in crafting.'],
    ['Slime Chunk',           'Ingredient',      'A viscous chunk harvested from slime creatures. Used in adhesive, binding, and alchemical recipes.'],

    /* ── GEAR ─────────────────────────────────────────────────────────── */
    ['7 Leafed Everthisel',   'Gear',            ''],
    ['Arbusta Tear',          'Gear',            ''],
    ['Aspect of Maladaptation','Gear',           ''],
    ['Band Of Crushing Force', 'Gear',           'A band that amplifies the raw force behind physical strikes.'],
    ['Blazing Perforator',    'Gear',            ''],
    ['Chocolate Egg',         'Gear',            'A festive egg of mysterious origin. A rare seasonal collectible.'],
    ['Coagulated Finger Nail','Gear',            ''],
    ['Crystal Sphere',        'Gear',            ''],
    ['Crystalized Star',      'Gear',            ''],
    ['Cursed Brand',          'Gear',            'A brand marked with a curse. Grants power at the cost of the wearer\'s stability.'],
    ['Deathbeak Dagger',      'Gear',            ''],
    ['Delicate Purse',        'Gear',            'Grants 200 gold at the end of an encounter. Taking damage during the fight reduces the gold received.'],
    ['Desert Escutcheon',     'Gear',            ''],
    ['Divine Promise',        'Gear',            ''],
    ['Dragon Memior',         'Gear',            ''],
    ['Dust Devil\'s Eye',     'Gear',            ''],
    ['Dust Storm',            'Gear',            ''],
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
    ['Shattered Clockhand',   'Gear',            ''],
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
    ['Vulcan Knuckle',        'Gear',            ''],
    ['Wicked Crown',          'Gear',            ''],
    ["Yarthul's Wrath",       'Gear',            ''],

    /* ── WEAPONS ──────────────────────────────────────────────────────── */
    ['Blacksteel Axe',        'Weapon',          'A heavy axe forged from blacksteel. Reliable entry-tier weapon.'],
    ['Blacksteel Cestus',     'Weapon',          'Fist wraps forged from blacksteel. Entry-tier brawler weapon.'],
    ['Blacksteel Dagger',     'Weapon',          'A dagger forged from blacksteel. Swift and reliable at entry tier.'],
    ['Blacksteel Greatsword', 'Weapon',          'A large greatsword of blacksteel. Heavy but powerful at entry tier.'],
    ['Blacksteel Shield',     'Weapon',          'A sturdy shield of blacksteel. Entry-tier defensive weapon.'],
    ['Blacksteel Spear',      'Weapon',          'A spear forged from blacksteel. Provides reach at entry tier.'],
    ['Blacksteel Staff',      'Weapon',          'A staff tipped with blacksteel. Entry-tier magical weapon.'],
    ['Blacksteel Sword',      'Weapon',          'A sword forged from blacksteel. The standard entry-tier blade.'],
    ['Dragon Bone Axe',       'Weapon',          'An axe made from dragon bone. A solid step above entry tier.'],
    ['Dragon Bone Cestus',    'Weapon',          'Fist wraps of dragon bone. Durable early-to-mid tier weapon.'],
    ['Dragon Bone Dagger',    'Weapon',          'A dagger carved from dragon bone. Light and sharp.'],
    ['Dragon Bone Shield',    'Weapon',          'A shield hewn from dragon bone. Notable defense above entry tier.'],
    ['Dragon Bone Spear',     'Weapon',          'A spear tipped with dragon bone. Early-to-mid tier reach weapon.'],
    ['Dragon Bone Staff',     'Weapon',          'A staff of dragon bone. Early-to-mid tier magical weapon.'],
    ['Dragon Bone Sword',     'Weapon',          'A sword carved from dragon bone. Solid step up from entry tier.'],
    ['Ferrus Axe',            'Weapon',          'An axe of ferrus ore. Standard entry-tier weapon.'],
    ['Ferrus Cestus',         'Weapon',          'Ferrus fist wraps. Basic entry-tier brawler weapon.'],
    ['Ferrus Dagger',         'Weapon',          'A dagger made from ferrus ore. Common entry-tier blade.'],
    ['Ferrus Hammer',         'Weapon',          'A hammer of ferrus ore. Heavy entry-tier blunt weapon.'],
    ['Ferrus Spear',          'Weapon',          'A spear tipped with ferrus metal. Entry-tier reach weapon.'],
    ['Ferrus Staff',          'Weapon',          'A ferrus-tipped staff. Basic entry-tier magical weapon.'],
    ['Ferrus Sword',          'Weapon',          'A sword of ferrus ore. The most common entry-tier blade.'],
    ['Corealloy Cestus',      'Weapon',          'Cestus crafted from corealloy. A clear step up from entry-tier weapons.'],
    ['Corealloy Dagger',      'Weapon',          'A dagger of corealloy. Improved sharpness over base-tier materials.'],
    ['Corealloy Greatsword',  'Weapon',          'A large greatsword of corealloy. Notable upgrade from entry tier.'],
    ['Sun Dagger',            'Weapon',          'Enables weapon-locked skills. 10% chance to increase your Defense for 3 turns. 20% chance to decrease enemy Defense by 10% for 3 turns.'],
    ['Sun Greatsword',        'Weapon',          'Enables weapon-locked skills. 10% chance to increase your Defense for 3 turns. 20% chance to decrease enemy Defense by 10% for 3 turns.'],
    ['Sun Hammer (visage)',   'Weapon',          'Enables weapon-locked skills. 10% chance to increase your Defense for 3 turns. 20% chance to decrease enemy Defense by 10% for 3 turns.'],
    ['Sun Spear',             'Weapon',          'Enables weapon-locked skills. 10% chance to increase your Defense for 3 turns. 20% chance to decrease enemy Defense by 10% for 3 turns.'],
    ['Sun Staff',             'Weapon',          'Enables weapon-locked skills. 10% chance to increase your Defense for 3 turns. 20% chance to decrease enemy Defense by 10% for 3 turns.'],
    ['Sun Sword',             'Weapon',          'Enables weapon-locked skills. 10% chance to increase your Defense for 3 turns. 20% chance to decrease enemy Defense by 10% for 3 turns.'],
    ['Ivory Axe',             'Weapon',          'Enables weapon-locked skills. Raises crit chance by 15%. On crit: 25% chance to gain 1 energy and heal 5% max HP (max twice per turn).'],
    ['Ivory Cestus',          'Weapon',          'Enables weapon-locked skills. Raises crit chance by 15%. On crit: 25% chance to gain 1 energy and heal 5% max HP (max twice per turn).'],
    ['Ivory Dagger',          'Weapon',          'Enables weapon-locked skills. Raises crit chance by 15%. On crit: 25% chance to gain 1 energy and heal 5% max HP (max twice per turn).'],
    ['Ivory Greatsword',      'Weapon',          'Enables weapon-locked skills. Raises crit chance by 15%. On crit: 25% chance to gain 1 energy and heal 5% max HP (max twice per turn).'],
    ['Ivory Hammer',          'Weapon',          'Enables weapon-locked skills. Raises crit chance by 15%. On crit: 25% chance to gain 1 energy and heal 5% max HP (max twice per turn).'],
    ['Ivory Shield',          'Weapon',          '30% Damage Reduction.'],
    ['Ivory Spear',           'Weapon',          'Enables weapon-locked skills. Raises crit chance by 15%. On crit: 25% chance to gain 1 energy and heal 5% max HP (max twice per turn).'],
    ['Ivory Staff',           'Weapon',          'Enables weapon-locked skills. Raises crit chance by 15%. On crit: 25% chance to gain 1 energy and heal 5% max HP (max twice per turn).'],
    ['Ivory Sword',           'Weapon',          'Enables weapon-locked skills. Raises crit chance by 15%. On crit: 25% chance to gain 1 energy and heal 5% max HP (max twice per turn).'],
    ['Jade Staff',            'Weapon',          'A staff tipped with jade. Mid-high tier magical weapon with nature affinity.'],
    ['Jade Sword',            'Weapon',          'A sword of jade. Mid-high tier blade with nature properties.'],
    ['Blightrock/wood Cestus','Weapon',          'Cestus infused with blight essence. Mid-high tier weapon with dark properties.'],
    ['Blightrock/wood Dagger','Weapon',          'A dagger infused with blight. Mid-high tier weapon with dark damage.'],
    ['Blightrock/wood Spear', 'Weapon',          'A spear of blightwood. Mid-high tier weapon with corrosive qualities.'],
    ['Blightrock/wood Staff', 'Weapon',          'A staff of blightwood. Mid-high tier magical weapon with blight affinity.'],
    ['Blightrock/wood Sword', 'Weapon',          'A sword infused with blight. Mid-high tier weapon with dark damage.'],
    ['Icerind Cestus',        'Weapon',          'Frost-encrusted cestus. On melee block: applies 2 Cold stacks to attacker.'],
    ['Icerind Dagger',        'Weapon',          'A dagger rimmed with ice. Mid-high tier blade with frost damage.'],
    ['Icerind Greatsword',    'Weapon',          'A greatsword coated in icerind. Powerful mid-tier frost weapon.'],
    ['Icerind Shield',        'Weapon',          '30% Damage Reduction. On melee block: applies 2 Cold stacks to attacker.'],
    ['Icerind Spear',         'Weapon',          'A spear coated with icerind. Mid-high tier frost weapon.'],
    ['Icerind Staff',         'Weapon',          'A staff of icerind. Mid-tier frost magical weapon.'],
    ['Icerind Sword',         'Weapon',          'A sword coated in frost. Mid-high tier weapon with ice damage.'],
    ['Darkblood Cestus',      'Weapon',          'Cestus soaked in darkblood essence. High-tier weapon with powerful dark properties.'],
    ['Darkblood Dagger',      'Weapon',          'A dagger imbued with darkblood. Strikes deal bonus dark damage.'],
    ['Darkblood Greatsword',  'Weapon',          'A massive greatsword of darkblood. High-tier weapon with immense dark power.'],
    ['Darkblood Spear',       'Weapon',          'A spear of darkblood. High-tier weapon with dark affinity.'],
    ['Darkblood Staff',       'Weapon',          'A staff channeling darkblood. High-tier magical weapon.'],
    ['Darkblood Sword',       'Weapon',          'A sword soaked in darkblood. A deadly high-tier blade.'],
    ['Sandstone Cestus',      'Weapon',          'Cestus of reinforced sandstone. A solid high-tier brawler weapon.'],
    ['Sandstone Dagger',      'Weapon',          'A dagger of sandstone. High-tier weapon from desert materials.'],
    ['Sandstone Hammer',      'Weapon',          'A hammer of sandstone. Heavy high-tier blunt weapon.'],
    ['Sandstone Shield',      'Weapon',          '30% Damage Reduction.'],
    ['Sandstone Staff',       'Weapon',          'A staff of sandstone. High-tier magical weapon.'],
    ['Primordial Axe',        'Weapon',          'A primordial axe forged from ancient power. Top-tier weapon.'],
    ['Primordial Cestus',     'Weapon',          'Primordial fist wraps. The pinnacle of brawler weapons.'],
    ['Primordial Dagger',     'Weapon',          'A primordial dagger. Among the sharpest and most powerful blades available.'],
    ['Primordial Greatsword', 'Weapon',          'A primordial greatsword. An incredibly powerful top-tier weapon.'],
    ['Primordial Hammer',     'Weapon',          'A primordial hammer. Top-tier crushing weapon.'],
    ['Primordial Shield',     'Weapon',          '~15% Damage Reduction. Top-tier defensive weapon.'],
    ['Primordial Spear',      'Weapon',          'A primordial spear. Top-tier reach weapon.'],
    ['Primordial Staff',      'Weapon',          'A primordial staff. The pinnacle of magical weapons.'],
    ['Primordial Sword',      'Weapon',          'A primordial sword. One of the most powerful blades in existence.'],

    /* ── ARTIFACTS ────────────────────────────────────────────────────── */
    ['Celestial Emblem',      'Artifact',        'Crafted by El\'heith at The Forgotten Sanctum using 5 Astral Shards, a Stellian Core, and 15,000 gold. Required to obtain the Astra mark. Must be equipped when initiating fights against specific enemies and Arkhaia, and worn during the wipe.'],
    ['Ancient Insignia',      'Artifact',        'A mark of ancient prestige engraved in metal. Increases all outgoing damage dealt by the wearer.'],
    ["Arkhaia's Visage",      'Artifact',        'A divine mask of mysterious origin. Enhances skill damage and grants a unique defensive passive.'],
    ['Chaos Orb',             'Artifact',        'An orb crackling with unstable chaotic energy. Provides powerful but unpredictable stat bonuses.'],
    ['Dark Sigil',            'Artifact',        'A forbidden sigil carved in shadow. Grants access to shadow abilities and amplifies dark damage output.'],
    ["Heaven's Authority",    'Artifact',        'A relic bestowing heavenly power upon its holder. Greatly increases both magical and physical output.'],
    ['Metroms Amulet',        'Artifact',        "An amulet imbued with Metrom's protective power. Significantly increases the wearer's maximum HP."],
    ["Narthana's Sigil",      'Artifact',        'Blessed by the healer Narthana. Grants passive healing over time and divine protection to the wearer.'],
    ['Paranoxian Crux',       'Artifact',        "A cursed cross-shaped artifact of dark origin. Grants immense dark power at the cost of the wearer's max HP."],
    ['Reality Watch',         'Artifact',        'A watch imbued with time-bending magic. Briefly manipulates reality to evade or counter incoming attacks.'],
    ['Shifting Hourglass',    'Artifact',        'An unstable hourglass from another era. When activated, slows time in a small radius around the wielder.'],
    ['Stellian Core',         'Artifact',        'Activates above 95% max HP. Grants 30% damage buff and 15% crit rate.'],

    /* ── LESSER ARTIFACTS ─────────────────────────────────────────────── */
    ['Echo shard',            'Lesser Artifact', 'A shard that resonates with past actions. Amplifies the effects of repeated techniques.'],
    ['Lineage Shard',         'Lesser Artifact', "A shard infused with the power of your lineage's history. Required material for legendary-tier crafting."],
    ['Memory Fragment',       'Lesser Artifact', 'A crystallized fragment of a lost memory. Holds latent power from its original owner.'],
    ['Phoenix Tear',          'Lesser Artifact', 'A tear shed by a legendary phoenix. Slowly restores HP over time when carried.'],
    ['Resplendent Essence',   'Lesser Artifact', 'Pure distilled magical essence of exceptional quality. Required for high-level equipment enhancement.'],
    ['Skyward Totem',         'Lesser Artifact', 'A totem carved with sky motifs. Enhances aerial mobility and air-based abilities.'],
    ['Soul Dust',             'Lesser Artifact', 'Refined soul energy in powdered form. A core material used in powerful high-tier crafting recipes.'],
    ['Void Key',              'Lesser Artifact', 'A key forged in the heart of void energy. Unlocks passages to void-touched areas and hidden dungeons.'],

    /* ── WEAPON MODIFIERS ─────────────────────────────────────────────── */
    ['arcanium crystal',      'Weapon Modifier', 'A rare crystal suffused with arcane energy. When applied to a weapon, greatly enhances its magical damage output.'],
    ['temperus gem',          'Weapon Modifier', 'A gem used to temper weapons. When socketed, increases a weapon\'s base damage and durability.'],

    /* ── ENCHANTS ─────────────────────────────────────────────────────── */
    ['Reaper',                'Enchant',         'Requires level 35. Obtained from the Reaper room in the Desert (requires full lives or 1 life in Legendary mode + a Lineage Shard).\n\nOn proc: boosts damage up to 25% based on enemy\'s current HP. Heals for 10% of damage dealt (excluding the Reaper damage boost). Grants regeneration per missing life: 1 life = 1% max HP regen/turn, 2 lives = 2%, 3 lives = 4%. Bonus lives from Daminos, Sheea, and Dullahan count toward this.'],

    /* ── BASE CLASSES ─────────────────────────────────────────────────── */
    ['Thief',          'Base Class',  'A nimble fighter specializing in quick strikes, bleeding, and gold acquisition. Cost: 200g.\n\nEvolves into: Ranger (Or), Rogue (N), Assassin (Ch)'],
    ['Warrior',        'Base Class',  'A sturdy front-line fighter with balanced offense and defense. Cost: 200g.\n\nEvolves into: Paladin (Or), Blade Dancer (N), Berserker (Ch)'],
    ['Wizard',         'Base Class',  'A powerful magic caster wielding elemental and arcane energy. Cost: 120g.\n\nEvolves into: Elementalist (Or), Hexer (N), Necromancer (Ch)'],
    ['Martial Artist', 'Base Class',  'A disciplined hand-to-hand combatant focused on energy management and precise strikes. Cost: 220g.\n\nEvolves into: Monk (Or), Brawler (N), Darkwraith (Ch)'],
    ['Slayer',         'Base Class',  'An aggressive fighter built for high single-target damage output. Cost: 200g.\n\nEvolves into: Saint (Or), Lancer (N), Impaler (Ch)'],
    ['Marauder',       'Base Class',  'A heavy-hitting brawler that overpowers enemies with raw force. Cost: Unknown.\n\nEvolves into: Lionheart (N)'],
    ['Sentry',         'Base Class',  'A defensive support class focused on protection and battlefield control. Cost: 500g.\n\nEvolves into: Citadel (Or), Arbiter (N)'],

    /* ── SUPER CLASSES ────────────────────────────────────────────────── */
    ['Ranger (Or)',       'Super Class', 'Thief → Orthodox path. Cost: 2,000g.\n\nA mobile crit-and-speed-focused fighter with nature magic. Gains damage and speed buffs on every dodge or crit. Strike scales with Arcane.'],
    ['Rogue (N)',         'Super Class', 'Thief → Neutral path. Cost: 3,750g.\n\nA stealth and burst-damage specialist that excels at bleed stacking and high single-hit damage.'],
    ['Assassin (Ch)',     'Super Class', 'Thief → Chaotic path. Cost: 2,000g.\n\nA high-damage finisher focused on critical bursts and eliminating targets before they can react.'],
    ['Paladin (Or)',      'Super Class', 'Warrior → Orthodox path. Cost: 2,400g.\n\nA holy warrior combining frontline tanking with healing and divine protection.'],
    ['Blade Dancer (N)',  'Super Class', 'Warrior → Neutral path. Cost: 3,750g.\n\nA speed-based swordsman with flowing combo attacks and high mobility.'],
    ['Berserker (Ch)',    'Super Class', 'Warrior → Chaotic path. Cost: 2,000g.\n\nA rage-fueled fighter that deals massive damage at the cost of defense.'],
    ['Elementalist (Or)','Super Class', 'Wizard → Orthodox path. Cost: 2,000g.\n\nA master of all elements wielding powerful area-of-effect attacks and multi-element combinations.'],
    ['Hexer (N)',         'Super Class', 'Wizard → Neutral path. Cost: 3,750g.\n\nA debuffer and status effect specialist who weakens enemies and turns their strengths against them.'],
    ['Necromancer (Ch)', 'Super Class', 'Wizard → Chaotic path. Cost: 2,000g.\n\nCommands undead minions and drains the life force of enemies to sustain itself.'],
    ['Monk (Or)',         'Super Class', 'Martial Artist → Orthodox path. Cost: 2,400g.\n\nA balanced fighter using focus, precision, and inner power to overcome enemies.'],
    ['Brawler (N)',       'Super Class', 'Martial Artist → Neutral path. Cost: 3,750g.\n\nA pure melee powerhouse with crushing combos and unrelenting close-range pressure.'],
    ['Darkwraith (Ch)',   'Super Class', 'Martial Artist → Chaotic path. Cost: 2,000g.\n\nA corrupted fighter channeling dark energy to deliver devastating blows and powerful debuffs.'],
    ['Saint (Or)',        'Super Class', 'Slayer → Orthodox path. Cost: 2,000g.\n\nA holy healer and divine support class focused on protecting and restoring allies.'],
    ['Lancer (N)',        'Super Class', 'Slayer → Neutral path. Cost: 3,750g.\n\nA spear-specialized high-damage dealer with superior range and piercing attacks.'],
    ['Impaler (Ch)',      'Super Class', 'Slayer → Chaotic path. Cost: 2,400g.\n\nAn aggressive spear fighter that delivers devastating piercing attacks to single targets.'],
    ['Lionheart (N)',     'Super Class', 'Marauder → Neutral path. Cost: 6,250g.\n\nA fearless warrior with overwhelming power and unmatched tenacity in battle.'],
    ['Citadel (Or)',      'Super Class', 'Sentry → Orthodox path. Cost: 2,000g.\n\nA near-impenetrable fortress tank with extreme damage reduction and team protection.'],
    ['Arbiter (N)',       'Super Class', 'Sentry → Neutral path. Cost: 6,250g.\n\nA judge-like fighter that controls the battlefield and punishes enemies who break the rules.'],

    /* ── SUB CLASSES ──────────────────────────────────────────────────── */
    ['Bard',        'Sub Class', 'A support sub-class that uses music and song to buff allies and inflict debuffs on enemies. Cost: 1,200g.'],
    ['Beastmaster', 'Sub Class', 'A sub-class that tames and commands animals to fight alongside them in battle. Cost: 750g.'],
    ['Alchemist',   'Sub Class', 'A sub-class specializing in creating and deploying potions and chemical compounds. Cost: 800g.'],
    ['Blacksmith',  'Sub Class', 'A crafting sub-class focused on forging and enhancing weapons and equipment. Cost: 3,000g.'],
    ['Miner',       'Sub Class', 'A resource-gathering sub-class focused on extracting ores and materials. Cost: 1,000g.'],

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
    ['Lentum (Ob)',      'Race', 'Obscure race. A rare hidden race with unique mechanics not commonly seen.'],
    ['Amorus (Ob)',      'Race', 'Obscure race. A rare hidden race with unique mechanics not commonly seen.'],
    ['Sheea (Ob)',       'Race', 'Obscure race. A rare hidden race with unique mechanics not commonly seen.'],
    ['Inferion (Ob)',    'Race', 'Obscure race. A rare hidden race with unique mechanics not commonly seen.'],
    ['Gynx (Ob)',        'Race', 'Obscure race. A rare hidden race with unique mechanics not commonly seen.'],

    /* ── BOSSES (ordered by progression) ─────────────────────────────── */
    ["Yar'Thul, The Blazing Dragon", 'Boss', 'A fierce blazing dragon encountered mid-game. Highly resistant to fire but susceptible to hex damage.'],
    ['Pterathanaian',                'Boss', 'A pterosaur-like mini boss. Resistant to hex and dark, but vulnerable to holy, fire, and nature.'],
    ['Thorian, The Rotten',          'Boss', 'An ancient, rotten undead lord. Heavily resistant to dark, physical, hex, and poison. Vulnerable to holy and fire.'],
    ['Seraphon',                     'Boss', 'A powerful divine creature. Resistant to physical attacks. Vulnerable to dark magic.'],
    ['Arkhaia',                      'Boss', 'An ancient divine entity. Resistant to dark and physical. Vulnerable to holy damage.'],
    ["Metrom's Vessel",              'Boss', 'A vessel containing Metrom\'s immense power. One of the game\'s strongest raid bosses. Resistant to hex and dark.'],
    ['Shadeblade',                   'Boss', 'A shade warrior wielding twin dark blades. A swift and dangerous mini boss.'],
    ['Handaconda',                   'Boss', 'A colossal serpentine raid boss. Extremely resistant to physical and magic damage, but highly vulnerable to fire.'],
    ['Slime King',                   'Boss', 'The ruler of slimes. A mini boss encountered in the early game.'],
    ['Carnis',                       'Boss', 'A carnivorous beast. A mini boss known for aggressive melee attacks.'],

    /* ── MARKS ────────────────────────────────────────────────────────── */
    ['Petent', 'Mark', 'A cross-wipe progression system earned by completing specific in-game requirements. Advancing a tier requires placing a Void Key in your Soul Vault and wiping. Grants permanent abilities that persist through all future wipes.'],
    ['Venia',  'Mark', 'A cross-wipe progression system centered around artifact sacrifice and the Midas enchant. Advancing a tier requires wiping while holding the Midas enchant and 50k gold. Grants artifact trading and gold-generating abilities.'],
    ['Astra',  'Mark', 'A cross-wipe progression system centered around the Celestial Emblem. Requires crafting the emblem, defeating specific enemies, and wiping with it equipped. Grants a star-based ability system that powers support and healing moves.'],

    /* ── ARMOUR ──────────────────────────────────────────────────────── */
    ['Paladin Cuirass',        'Armour', 'Cost: 250g.\n\nStats: +20 Endurance, +17.5% Endurance.\n\nDamage Reduction: +10% Physical, +5% Holy, +5% Magic, +5% Fire.\n\nPenalty: -5% Movement Speed.'],
    ['Adept Warrior',          'Armour', 'Cost: 250g.\n\nStats: +15 Endurance, +10% Endurance, +5% Strength, +16.6% Energy.\n\nDamage Reduction: +5% Physical, +10% Dark.\n\nBonus: +20% Fall Resistance.'],
    ['Raging Warrior',         'Armour', 'Cost: 250g.\n\nStats: +16 Endurance, +10% Endurance, +10% Increased Healing, +10% Energy.\n\nDamage Reduction: +5% Physical, +10% Hex, +5% Fire.'],
    ['Arcane Robes',           'Armour', 'Cost: 250g.\n\nStats: +4 Arcane, +15 Endurance, +7.5% Arcane.\n\nDamage Reduction: +10% Magic, +10% Poison, +10% Holy, +10% Fire.'],
    ['Magister Apprentice',    'Armour', 'Cost: 250g.\n\nStats: +3 Arcane, +15 Endurance, +5% Arcane, +1 HP Regen/turn.\n\nDamage Reduction: +15% Magic, +10% Poison, +10% Fire.'],
    ['Corrupt Caster',         'Armour', 'Cost: 250g.\n\nStats: +2 Arcane, +16 Endurance, +5% Endurance, +5% Arcane, +10% Energy.\n\nDamage Reduction: +15% Magic, +10% Poison, +10% Holy.'],
    ['Lifebound Archer',       'Armour', 'Cost: 250g.\n\nStats: +3 Arcane, +15 Endurance, +5% Endurance, +5% Arcane, +1 HP Regen/turn, +15% Movement Speed.\n\nDamage Reduction: +10% Magic, +10% Poison, +10% Nature.'],
    ['Rogue Hunter',           'Armour', 'Cost: 250g.\n\nStats: +15 Endurance, +7.5% Endurance, +10% Speed, +10% Energy, +1 HP Regen/turn, +20% Movement Speed, +25% Fall Resistance.\n\nDamage Reduction: +5% Physical, +5% Fire.'],
    ['Shadow Cloak',           'Armour', 'Cost: 250g.\n\nStats: +13 Endurance, +7.5% Endurance, +12.5% Energy, +1 HP Regen/turn, +30% Movement Speed, +30% Fall Resistance.\n\nDamage Reduction: +5% Physical, +5% Dark.'],
    ['Traveling Pasmark',      'Armour', 'Cost: 250g.\n\nStats: +5 Strength, +16 Endurance, +7.5% Endurance, +5% Strength, +1 HP Regen/turn, +10% Fall Resistance.\n\nDamage Reduction: +5% Physical, +5% Holy, +5% Fire, +5% Dark.'],
    ['Wandering Practitioner', 'Armour', 'Cost: 250g.\n\nStats: +18 Endurance, +7.5% Endurance, +10% Strength, +16.6% Energy, +10% Fall Resistance.\n\nDamage Reduction: +5% Physical, +10% Fire.'],
    ['Shade Walker',           'Armour', 'Cost: 250g.\n\nStats: +18 Endurance, +7.5% Endurance, +5% Arcane, +10% Fall Resistance.\n\nDamage Reduction: +5% Physical, +10% Hex, +20% Dark.'],
    ['Pathfinder Martyr',      'Armour', 'Cost: 250g.\n\nStats: +3 Arcane, +1 Speed, +20 Endurance, +7.5% Endurance, +1 HP Regen/turn.\n\nDamage Reduction: +5% Physical, +15% Holy.'],
    ['Armored Lancer',         'Armour', 'Cost: 250g.\n\nStats: +20 Endurance, +15% Endurance, +12.5% Energy.\n\nDamage Reduction: +10% Physical, +10% Magic, +5% Fire.\n\nPenalty: -5% Movement Speed.'],
    ['Bloody Menace',          'Armour', 'Cost: 250g.\n\nStats: +22 Endurance, +10% Endurance, +20% Increased Healing.\n\nDamage Reduction: +10% Physical, +5% Hex, +5% Poison.'],
    ['Venerated Legionnaire',  'Armour', 'Cost: 250g.\n\nStats: +17 Endurance, +12.5% Endurance.\n\nDamage Reduction: +15% Physical, +15% Fire, +10% Ice, +10% Nature, +5% Dark, +5% Magic.'],
    ['Fortified Seer',         'Armour', 'Cost: 250g.\n\nStats: +35 Endurance, +5% Endurance.\n\nDamage Reduction: +15% Dark, +15% Hex, +10% Holy, +10% Ice, +10% Fire, +10% Physical.'],
    ['Deathmantle',            'Armour', 'Cost: 3,000g.\n\nStats: +25 Endurance, +2.5% Endurance, +10% Arcane.\n\nDamage Reduction: +20% Dark, +15% Holy, +10% Magic, +10% Ice, +5% Physical.'],
    ['Shadowy Crook',          'Armour', 'Cost: 250g.\n\nStats: +1 Speed, +2 Luck, +10 Endurance, +10% Movement Speed.\n\nDamage Reduction: +5% Physical.'],

    /* ── MOBS ─────────────────────────────────────────────────────────── */
    ['Goblin',            'Mob', ''],
    ['Malevolent Bunny',  'Mob', '~215 HP. Does not gain energy.\n\nHop Kick — 1 hit, 0 energy cost. Blockable and dodgeable.\n\nBlack Warren — Summons another Malevolent Bunny with half the summoner\'s current max HP. Found in Easter encounters.'],
    ['Shadeblade',        'Mob', 'A shade warrior wielding twin dark blades. A swift and dangerous mini boss.'],
  ];

  /* ── Config ─────────────────────────────────────────────────────────────── */
  const TYPE_ORDER = [
    'Base Class', 'Super Class', 'Sub Class',
    'Race',
    'Enchant',
    'Ore', 'Ingredient', 'Weapon', 'Gear',
    'Artifact', 'Lesser Artifact', 'Weapon Modifier',
    'Armour',
    'Boss', 'Mob', 'Mark',
  ];

  const TYPE_ICONS = {
    'Base Class':      '⚔',
    'Super Class':     '✦',
    'Sub Class':       '◈',
    'Race':            '◎',
    'Enchant':         '✧',
    'Ore':             '⛏',
    'Ingredient':      '🌿',
    'Weapon':          '🗡',
    'Gear':            '🛡',
    'Artifact':        '◆',
    'Lesser Artifact': '◇',
    'Weapon Modifier': '💎',
    'Armour':          '🛡',
    'Boss':            '☠',
    'Mob':             '👾',
    'Mark':            '◉',
  };

  const CLASS_TYPES   = new Set(['Base Class', 'Super Class', 'Sub Class', 'Race', 'Weapon', 'Gear', 'Mark']);
  const NO_SORT_TYPES = new Set(['Boss', 'Mob']);

  /* Weapon families — order defines display order, prefix used for matching */
  const WEAPON_GROUPS = [
    { label: 'Ferrus',      prefix: 'Ferrus ' },
    { label: 'Blacksteel',  prefix: 'Blacksteel ' },
    { label: 'Dragon Bone', prefix: 'Dragon Bone ' },
    { label: 'Corealloy',   prefix: 'Corealloy ' },
    { label: 'Sun',         prefix: 'Sun ' },
    { label: 'Ivory',       prefix: 'Ivory ' },
    { label: 'Jade',        prefix: 'Jade ' },
    { label: 'Blightrock',  prefix: 'Blightrock/wood ' },
    { label: 'Icerind',     prefix: 'Icerind ' },
    { label: 'Darkblood',   prefix: 'Darkblood ' },
    { label: 'Sandstone',   prefix: 'Sandstone ' },
    { label: 'Primordial',  prefix: 'Primordial ' },
  ];

  /* ── Boss move / passive data ───────────────────────────────────────────── */
  const BOSS_MOVE_DATA = {
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
    'Crystalized Star':      'Crystallized Star',
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
    if (type === 'Mark')   return MARK_DATA[name]      || null;
    if (type === 'Race')   return raceMoves?.[name]   || null;
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
          const grp = WEAPON_GROUPS.find(g => it[0].startsWith(g.prefix));
          if (grp) byFamily[grp.label].push({ it, i });
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
      } else {
        const grid = document.createElement('div');
        grid.className = 'enc-grid' + (type === 'Boss' ? ' enc-grid-column' : '');

        const orderedItems = NO_SORT_TYPES.has(type)
          ? items
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
    if (type === 'Boss') {
      showBossDetail(idx);
    } else if (CLASS_TYPES.has(type)) {
      showClassDetail(idx);
    } else {
      showItemDetail(idx);
    }
  }

  /* ── Item detail panel ──────────────────────────────────────────────────── */
  function showItemDetail(idx) {
    const it     = ENC_ITEMS[idx];
    _currentView = 'item';
    showPanel('enc-detail-card');

    const nameEl = document.getElementById('enc-detail-name');
    const typeEl = document.getElementById('enc-detail-type');
    const descEl = document.getElementById('enc-detail-desc');

    if (typeEl) {
      typeEl.textContent = (TYPE_ICONS[it[1]] || '') + ' ' + it[1];
      typeEl.className   = 'enc-detail-type enc-type-' + it[1].replace(/\s+/g, '-');
    }
    if (nameEl) nameEl.textContent = it[0];
    if (descEl) {
      if (it[2]) {
        descEl.innerHTML = it[2].replace(/\n/g, '<br>');
        descEl.classList.remove('enc-detail-nodesc');
      } else {
        descEl.textContent = 'No description available.';
        descEl.classList.add('enc-detail-nodesc');
      }
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
      // Passives
      if (moveData.passives?.length) {
        const passDiv = document.createElement('div');
        passDiv.className = 'enc-boss-passives';
        let html = `<div class="enc-boss-section-label">Passives</div>`;
        moveData.passives.forEach(p => {
          html += `<div class="enc-passive-row"><span class="enc-passive-name">${p.name}</span><span class="enc-passive-desc">${p.description}</span></div>`;
        });
        passDiv.innerHTML = html;
        extraEl.appendChild(passDiv);
      }

      // Moves
      if (moveData.learns?.length) {
        const movesDiv = document.createElement('div');
        movesDiv.className = 'enc-boss-moves';
        const lbl = document.createElement('div');
        lbl.className = 'enc-boss-section-label';
        lbl.textContent = 'Moves';
        movesDiv.appendChild(lbl);

        moveData.learns.forEach((m, mi) => {
          const btn = document.createElement('button');
          btn.className = 'enc-move-btn';
          const costText = m.cost !== undefined ? `${m.cost}E` : '';
          const cdText   = m.cooldown           ? `CD${m.cooldown}` : '';
          const metaStr  = [costText, cdText].filter(Boolean).join(' · ');
          btn.innerHTML  = `<span class="enc-move-btn-name">${m.name}</span><span class="enc-move-btn-meta"><span style="font-size:10px;color:#555">${metaStr}</span></span>`;
          btn.addEventListener('click', () => showBossMoveDetail(idx, mi));
          movesDiv.appendChild(btn);
        });

        extraEl.appendChild(movesDiv);
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
        descEl.innerHTML = it[2].replace(/\n/g, '<br>');
        descEl.classList.remove('enc-detail-nodesc');
      } else {
        descEl.textContent = 'No description available.';
        descEl.classList.add('enc-detail-nodesc');
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
        label.textContent = (type === 'Weapon' || type === 'Gear') ? 'Passives & Actives' : 'Moves';
        movesEl.appendChild(label);
        learns.forEach((m, mi) => {
          const btn = document.createElement('button');
          btn.className = 'enc-move-btn';
          const lvlText = m.level ? `Lv${m.level}` : '';
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

    if (effectEl) effectEl.innerHTML = (m.effect || '').replace(/\n/g, '<br>');
  }

  /* ── Public API ──────────────────────────────────────────────────────────── */
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
    const el = document.getElementById('venia-tracker-tier');
    if (!el) return;
    const meta = vtGetMeta();
    const tier = vtGetTier(meta);
    el.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'pt-tier-label';
    label.textContent = 'Tier:';
    el.appendChild(label);
    [1, 2, 3, 4, 5].forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'pt-tier-btn' + (tier === t ? ' pt-tier-active' : '');
      btn.textContent = `Tier ${t}`;
      btn.addEventListener('click', () => {
        const m = vtGetMeta(); vtSetTier(m, t); vtSaveMeta(m); vtRender();
      });
      el.appendChild(btn);
    });
  }

  function vtRenderTabs(meta) {
    const tabsEl = document.getElementById('venia-tracker-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    meta.tabs.forEach(tab => {
      const wrap = document.createElement('div');
      wrap.className = 'vt-tab-wrap' + (tab.id === meta.activeTab ? ' vt-tab-active' : '');

      const nameBtn = document.createElement('button');
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
        const delBtn = document.createElement('button');
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

    const addBtn = document.createElement('button');
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

    const grid = document.getElementById('venia-tracker-grid');
    if (!grid) return;
    grid.innerHTML = '';
    VENIA_ORBS.forEach(orb => {
      const col = document.createElement('div');
      col.className = 'vt-col';

      // Per-column T1 validation: need exactly 3 green before T2+ view activates
      const greenCount = VENIA_ARTIFACTS.filter(a => vtGet(data, orb, a.name) === 1).length;
      const colReady   = tier === 1 || greenCount === 3;

      const hdr = document.createElement('div');
      hdr.className = 'vt-col-hdr';
      const warnSpan = (tier > 1 && !colReady)
        ? `<span class="vt-col-warn">${greenCount}/3 T1 picks</span>` : '';
      hdr.innerHTML = `<span>${orb}</span>${warnSpan}<button class="vt-reset-btn" onclick="window._veniaOrbReset('${CSS.escape(orb)}')">Reset</button>`;
      col.appendChild(hdr);

      let lastCat = null;
      VENIA_ARTIFACTS.forEach(a => {
        if (a.category !== lastCat) {
          const catDiv = document.createElement('div');
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
        const row = document.createElement('button');
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
    document.getElementById('venia-tracker-overlay').style.display = 'flex';
    vtRender();
  };
  window._veniaTrackerClose = function () {
    document.getElementById('venia-tracker-overlay').style.display = 'none';
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
    const tabsEl = document.getElementById('petent-tracker-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    meta.tabs.forEach(tab => {
      const wrap = document.createElement('div');
      wrap.className = 'vt-tab-wrap' + (tab.id === meta.activeTab ? ' vt-tab-active' : '');
      const nameBtn = document.createElement('button');
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
        const delBtn = document.createElement('button');
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
    const addBtn = document.createElement('button');
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
    const el = document.getElementById('petent-tracker-tier');
    if (!el) return;
    const meta = ptGetMeta();
    const tier = ptGetTier(meta);
    el.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'pt-tier-label';
    label.textContent = 'Tier:';
    el.appendChild(label);
    [1, 2, 3, 4, 5].forEach(t => {
      const btn = document.createElement('button');
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
    const row  = document.createElement('button');
    row.className = `vt-artifact-row ${cls}`;
    row.innerHTML = `<span class="vt-artifact-icon">${icon}</span><span class="vt-artifact-name">${label}${note ? `<span class="pt-mob-note"> (${note})</span>` : ''}</span>`;
    row.addEventListener('click', onClick);
    return row;
  }

  function ptMakeNote(text) {
    const d = document.createElement('div');
    d.className = 'pt-info-note';
    d.textContent = text;
    return d;
  }

  function ptAddSection(grid, title, items, dataObj, sectionKey, tier, noteText, questKeys) {
    const visible = tier > 1 ? items.filter(i => !i.t1) : items;
    const hdr = document.createElement('div');
    hdr.className = 'pt-section-hdr';
    hdr.textContent = title;
    grid.appendChild(hdr);
    if (noteText) grid.appendChild(ptMakeNote(noteText));
    if (visible.length === 0) return;
    const g = document.createElement('div');
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
    const grid = document.getElementById('petent-tracker-grid');
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
    document.getElementById('petent-tracker-overlay').style.display = 'flex';
    ptRender();
  };
  window._petentTrackerClose = function () {
    document.getElementById('petent-tracker-overlay').style.display = 'none';
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
    const tabsEl = document.getElementById('astra-tracker-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    meta.tabs.forEach(tab => {
      const wrap = document.createElement('div');
      wrap.className = 'vt-tab-wrap' + (tab.id === meta.activeTab ? ' vt-tab-active' : '');
      const nameBtn = document.createElement('button');
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
        const delBtn = document.createElement('button');
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
    const addBtn = document.createElement('button');
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
    const row  = document.createElement('button');
    row.className = `vt-artifact-row ${cls}`;
    row.innerHTML = `<span class="vt-artifact-icon">${icon}</span><span class="vt-artifact-name">${label}${note ? `<span class="pt-mob-note"> (${note})</span>` : ''}</span>`;
    row.addEventListener('click', onClick);
    return row;
  }

  function atRender() {
    const meta = atGetMeta();
    const data = atGetData(meta);
    atRenderTabs(meta);
    const grid = document.getElementById('astra-tracker-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Celestial Emblem section
    const emblemHdr = document.createElement('div');
    emblemHdr.className = 'pt-section-hdr';
    emblemHdr.textContent = 'Celestial Emblem';
    grid.appendChild(emblemHdr);
    const emblemGrid = document.createElement('div');
    emblemGrid.className = 'pt-loc-grid';
    ASTRA_EMBLEM.forEach(({ name, note }) => {
      emblemGrid.appendChild(atMakeRow(name, note, data.emblem[name] || 0, () => {
        const m = atGetMeta(); const d = atGetData(m);
        d.emblem[name] = ((d.emblem[name] || 0) + 1) % 2;
        atSetData(m, d); atSaveMeta(m); atRender();
      }));
    });
    grid.appendChild(emblemGrid);
    const wipeNote = document.createElement('div');
    wipeNote.className = 'pt-info-note';
    wipeNote.textContent = 'Make sure to wipe while having the Celestial Emblem equipped.';
    grid.appendChild(wipeNote);

    // Celestial Enemies section
    const enemyHdr = document.createElement('div');
    enemyHdr.className = 'pt-section-hdr';
    enemyHdr.textContent = 'Celestial Enemies';
    grid.appendChild(enemyHdr);
    const enemyGrid = document.createElement('div');
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
    document.getElementById('astra-tracker-overlay').style.display = 'flex';
    atRender();
  };
  window._astraTrackerClose = function () {
    document.getElementById('astra-tracker-overlay').style.display = 'none';
  };

  /* ── Init ───────────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
