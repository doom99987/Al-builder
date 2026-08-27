/*
  The knowledge layer — everything the data files do not say.

  gearItems knows that Crystalized Star grants stats. It does not know that its
  stacks only matter if you can survive long enough to build them, that duplicate
  shards are worth nothing in this builder, or that a Vastic proc rolls off your
  highest stat and the SPD outcome is bugged. That is what lives here.

  ─────────────────────────────────────────────────────────────────────────────
  THIS IS THE FILE TO EDIT.

  Everything here is a declarative table. Adding knowledge should never require
  touching model.js, optimize.js or engine.js:

    VOCAB       a word players use  ->  a concept the engine understands
    ARCHETYPES  a concept          ->  what to optimise and how
    QUIRKS      an item            ->  a hook into the maths
    CORRUPTION  a build shape      ->  which form suits it
    TRAPS       a mistake          ->  a warning attached to the answer

  Unknown items still work without an entry here: the engine scores their base
  stat block. Knowledge makes it smarter, it is never required to make it run.
  ─────────────────────────────────────────────────────────────────────────────
*/
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ALB_Knowledge = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // ── VOCAB ─────────────────────────────────────────────────────────────────
  // Loose words -> concepts. Order does not matter; longest match wins. Add
  // freely, including slang and misspellings — this is the whole reason a
  // request like "gimme smth tanky" resolves to anything at all.
  const VOCAB = {
    goal: {
      damage:  ['dmg', 'damage', 'dps', 'hurt', 'nuke', 'kill', 'offensive', 'attack', 'strong',
                'hard hitting', 'hardhitting', 'hard', 'hit', 'hits', 'hitting'],
      burst:   ['burst', 'one shot', 'oneshot', 'onetap', 'one tap', 'big hit', 'bighit', 'nuke', 'max hit', 'biggest hit'],
      crit:    ['crit', 'critical', 'crits', 'critting', 'overcrit', 'red crit', 'orange crit', 'purple crit'],
      tank:    ['tank', 'tanky', 'tanking', 'bulky', 'survive', 'survival', 'survivability', 'defensive',
                'defence', 'defense', 'hp', 'health', 'block', 'sturdy', 'unkillable', 'wall', 'juggernaut'],
      heal:    ['heal', 'healer', 'healing', 'support', 'sustain', 'restore', 'medic'],
      summon:  ['summon', 'summons', 'summoner', 'summoning', 'minion', 'minions', 'pet', 'pets',
                'skeleton', 'skeletons', 'undead', 'army', 'necro', 'raise dead'],
      status:  ['bleed', 'burn', 'poison', 'dot', 'status', 'ailment', 'debuff', 'stack', 'stacks'],
      speed:   ['speed', 'fast', 'initiative', 'first', 'quick', 'agile'],
      party:   ['party', 'team', 'group', 'raid', 'coop', 'co-op', 'ally', 'allies'],
      balanced:['balanced', 'allround', 'all round', 'all-round', 'general', 'generalist', 'versatile', 'good', 'best', 'meta', 'strong'],
    },
    // "Just give me something." Handled separately from goals: it does not say
    // what to optimise, it says the engine gets to choose.
    random: {
      random: ['random', 'surprise me', 'surprise', 'anything', 'whatever', 'idk',
               'i dont know', 'you pick', 'you choose', 'dealers choice', 'yolo',
               'something cool', 'something fun', 'something weird', 'roll the dice',
               'fun build', 'meme', 'meme build', 'troll build'],
    },
    // Weapon words. A weapon implies a class shortlist, which is how a request
    // naming only a weapon still lands on a sensible class.
    // Keys MUST be the weapon `type` values that actually appear in the game
    // data — Gauntlets, not Fist. A key that matches no real type silently
    // filters the weapon list to nothing and falls back to "any weapon".
    weapon: {
      Sword: ['sword', 'blade', 'broadsword', 'sabre', 'saber'],
      Dagger: ['dagger', 'daggers', 'knife', 'knives'],
      Spear: ['spear', 'lance', 'glaive', 'polearm', 'pike'],
      Staff: ['staff', 'stave', 'staves', 'wand', 'prayerstaff'],
      Gauntlets: ['gauntlet', 'gauntlets', 'fist', 'fists', 'cestus', 'claws', 'unarmed', 'punch'],
      Axe: ['axe', 'axes'],
      Hammer: ['hammer', 'mace', 'tenderizer'],
      Greatsword: ['greatsword', 'claymore', 'zweihander'],
    },
    stat: {
      str: ['str', 'strength', 'physical'], arc: ['arc', 'arcane', 'magic', 'magical', 'int', 'intelligence'],
      end: ['end', 'endurance', 'vitality', 'vit', 'con'], spd: ['spd', 'speed', 'agility', 'agi', 'dex'],
      lck: ['lck', 'luck', 'lucky'],
    },
    modifier: {
      full:   ['full', 'pure', 'all in', 'allin', 'max', 'maxed', 'only'],
      minmax: ['minmax', 'min max', 'min-max', 'minmaxed', 'min maxed', 'min-maxed', 'maxed',
               'optimal', 'optimised', 'optimized', 'best', 'strongest', 'perfect', 'sweaty', 'tryhard'],
      pvp:    ['pvp', 'player vs player', 'duel', 'arena'],
      pve:    ['pve', 'boss', 'bosses', 'raid', 'grinding', 'farm', 'farming'],
      budget: ['cheap', 'budget', 'early', 'starter', 'low level', 'lowlevel', 'f2p', 'new'],
    },
  };

  // ── ALIASES ───────────────────────────────────────────────────────────────
  // Community shorthand. Fuzzy matching handles misspellings ("berzerker",
  // "necromancr", "rouge"); it cannot handle nicknames, because "pally" is not a
  // near-miss for "Paladin (Or)" by any edit distance — it is a different word.
  //
  // Add a line whenever someone types something the engine shrugs at. Keys are
  // matched as whole words after normalisation.
  const ALIASES = {
    // classes
    'necro': 'Necromancer (Ch)', 'zerk': 'Berserker (Ch)', 'berserk': 'Berserker (Ch)',
    'pally': 'Paladin (Or)', 'pal': 'Paladin (Or)',
    'sin': 'Assassin (Ch)', 'assa': 'Assassin (Ch)',
    'bd': 'Blade Dancer (N)', 'dancer': 'Blade Dancer (N)',
    'ele': 'Elementalist (Or)', 'elem': 'Elementalist (Or)',
    'ma': 'Martial Artist', 'wraith': 'Darkwraith (Ch)', 'dw': 'Darkwraith (Ch)',
    'lion': 'Lionheart (N)', 'cit': 'Citadel (Or)',
    'mage': 'Wizard', 'wiz': 'Wizard',
    'sader': 'Paladin (Or)',
    // races
    'vast': 'Vastayan (9%)', 'dulla': 'Dullahan (1%)', 'dull': 'Dullahan (1%)',
    'stult': 'Stultus (20%)', 'estel': 'Estella (24%)',
  };

  // ── ARCHETYPES ────────────────────────────────────────────────────────────
  // A concept -> what "good" means. `score` receives the model's derived stats
  // and the build's best offensive move, and returns a single number to maximise.
  //
  // statWeights seeds the stat-allocation search. It is a starting direction,
  // not the answer — the optimiser hill-climbs from there and will happily
  // disagree if the maths says otherwise.
  //
  // kitWords breaks ties between CLASSES. The maths only sees a class through
  // its moves, so for a goal like "tank" — where class barely moves the number —
  // every class scores nearly the same and the winner is arbitrary. These words
  // are matched against the class's kit text to prefer one that actually plays
  // the requested way. Add words freely; they only ever break ties.
  const ARCHETYPES = {
    damage: {
      label: 'Maximum damage',
      statWeights: { str: 3, arc: 3, lck: 2, spd: 1, end: 0 },
      kitWords: ['damage','deal','strike','attack','pierce','slash','power'],
      // Sustained: a buff on a 9 turn cooldown lasting 3 turns is not a
      // permanent buff, so this is uptime-weighted rather than the opener.
      score: c => c.sustainedHit || c.bestHit,
      blurb: 'Every point that does not raise damage is a wasted point.',
    },
    burst: {
      label: 'Biggest single hit',
      statWeights: { str: 3, arc: 3, lck: 4, spd: 1, end: 0 },
      kitWords: ['damage','execute','massive','heavy','charge','empowered'],
      // Burst is the opener: spend the setup turns, then hit. That is exactly
      // what a burst build is for, so it is scored on the buffed number.
      score: c => c.bestBurst || c.bestHit,
      blurb: 'Optimised for the largest single number, not sustained output.',
    },
    crit: {
      label: 'Crit / overcrit',
      statWeights: { lck: 5, str: 2, arc: 2, spd: 1, end: 0 },
      kitWords: ['crit','critical','precise','lethal','assassinate'],
      // Crit tiers are steps, so reward landing ON a threshold rather than near it.
      score: c => (c.sustainedHit || c.bestHit) * (1 + 0.05 * c.critTier),
      blurb: 'Luck feeds Crit Chance 1:1, and each 100% crosses into a higher crit tier.',
    },
    tank: {
      label: 'Survivability',
      statWeights: { end: 5, str: 2, arc: 0, spd: 1, lck: 0 },
      kitWords: ['block','guard','shield','defen','armou','taunt','protect','fortif','resist','damage reduction'],
      // Effective HP: raw HP scaled by block damage reduction and incoming heals.
      score: c => c.hp * (1 + c.blockDr / 100) * (1 + (c.incHeal - 100) / 400),
      blurb: 'Endurance drives HP, and Strength converts to block damage reduction.',
    },
    heal: {
      label: 'Healing / support',
      statWeights: { end: 4, arc: 3, str: 1, spd: 2, lck: 0 },
      kitWords: ['heal','restore','mend','cleanse','revive','bless','pray','sanct'],
      score: c => c.outHeal * (1 + c.hp / 400),
      blurb: 'Endurance grants END/4 to both heal stats, so bulk and healing scale together.',
    },
    summon: {
      label: 'Summons',
      statWeights: { arc: 5, end: 2, lck: 1, spd: 1, str: 0 },
      kitWords: ['summon','skeleton','minion','spirit','raise','conjure','pet'],
      // Summon HP and summon damage both scale off Arcane, so Arcane is the whole
      // build. Blend in the owner's own hit so it is not defenceless, and let
      // summon-specific passives (Vastayan's Spirit Caller) count for something —
      // otherwise the engine has no reason to prefer the race that doubles your
      // skeletons' health.
      score: c => {
        const p = c.passives || {};
        const summonMult = (1 + (p.summonHpPct || 0) / 100) * (1 + (p.summonDmgPct || 0) / 100);
        return c.stats.arc * 10 * summonMult + c.bestHit * 0.3;
      },
      blurb: 'Summon health and summon damage both scale off Arcane.',
    },
    status: {
      label: 'Status / damage over time',
      statWeights: { arc: 3, str: 2, spd: 2, lck: 2, end: 1 },
      kitWords: ['bleed','burn','poison','hex','curse','wound','infect','plague','stack'],
      score: c => c.bestHit * 0.7 + c.stats.spd * 2,
      blurb: 'Status application cares about acting often, not about one large hit.',
    },
    speed: {
      label: 'Speed / initiative',
      statWeights: { spd: 5, str: 2, arc: 2, lck: 1, end: 1 },
      kitWords: ['speed','swift','haste','dash','initiative','agil','quick','evade'],
      score: c => c.stats.spd * 6 + c.bestHit * 0.4,
      blurb: 'Speed grants initiative at SPD/10 and decides who moves first.',
    },
    party: {
      label: 'Party support',
      statWeights: { end: 4, arc: 2, spd: 2, str: 1, lck: 1 },
      kitWords: ['ally','allies','party','team','rally','aura','shared','support'],
      score: c => c.hp * 0.5 + c.outHeal * 2 + c.stats.spd,
      blurb: 'Built to keep a group alive rather than to top the damage chart.',
    },
    balanced: {
      label: 'Balanced',
      statWeights: { str: 2, arc: 2, end: 2, spd: 2, lck: 2 },
      kitWords: [],
      // Block damage reduction belongs here. Scoring only damage and HP made the
      // optimiser dump Strength, which quietly cost a player 53 points of block
      // DR and still called the result an upgrade.
      score: c => (c.bestHit * 0.6 + c.hp * 0.8) * (1 + c.blockDr / 200),
      blurb: 'A build that does not fall apart when the fight goes badly.',
    },
  };

  // The fallback when a request says nothing usable. Never leave this empty —
  // it is what makes "make me a build" return something instead of an error.
  const DEFAULT_GOAL = 'balanced';

  // When a request matches several goals, the most SPECIFIC wins. "max damage
  // crit lancer" hits both `damage` and `crit`, and `crit` is the more precise
  // instruction — it says how to get the damage, not just that damage is wanted.
  // `balanced` sits last because words like "best" and "strong" match it and it
  // should never outrank a real request.
  const GOAL_PRIORITY = ['summon', 'crit', 'burst', 'status', 'heal', 'tank',
                         'party', 'speed', 'damage', 'balanced'];

  // ── ENERGY ────────────────────────────────────────────────────────────────
  // The base energy cap is NOT recorded anywhere in the site's data, so it is an
  // assumption. If it is wrong, correct it here — it is the single number every
  // energy calculation hangs off.
  //
  // It matters because several kits scale directly with how much energy you can
  // hold. Berserker's Carnage consumes your whole pool for +20% damage per
  // energy past the first, so a bigger cap is a straight damage increase; the
  // Overflow trait raising the cap by 1-2 is worth far more to that build than
  // its "+1 max energy" wording suggests.
  const ENERGY = {
    base: 5,                       // ← assumption; correct if the game says otherwise
    // Moves whose damage scales with energy spent. `perEnergy` is the fraction
    // gained per energy consumed past `freeEnergy`.
    scalingMoves: {
      'Carnage': { perEnergy: 0.20, freeEnergy: 1,
                   note: 'consumes the whole pool for +20% per energy past the first' },
    },
  };

  // ── TRAITS ────────────────────────────────────────────────────────────────
  // IMPORTANT: the site tracks traits for share links and display but does NOT
  // apply them to any stat or damage number (traitValue is display-only,
  // builder.js:2309). So everything here is an OVERLAY the engine computes on
  // top of the site's maths. Numbers derived from it will not match what
  // arcanelineagebuilder.com shows, and the explanation says so.
  //
  //   kind        what it feeds
  //   ---------------------------------------------------------------
  //   critChance  flat crit chance
  //   critDmgPct  percentage added to the crit multiplier
  //   hpPct       percentage max health
  //   energyCap   flat maximum energy
  //   initiative  flat initiative
  //   dmgPct      percentage damage, `when` says under what condition
  //   dr          flat damage reduction
  //
  // `modelled: false` means the effect is real but not scoreable here — it is
  // still listed so the build can mention it rather than pretend it is nothing.
  const TRAITS = {
    fortunate:   { kind: 'critChance', modelled: true },
    devastating: { kind: 'critDmgPct', modelled: true },
    vital:       { kind: 'hpPct',      modelled: true },
    overflow:    { kind: 'energyCap',  modelled: true },
    preemptive:  { kind: 'initiative', modelled: true },
    heavyHand:   { kind: 'dmgPct',     modelled: true,  when: 'cost>=2',
                   note: 'only on skills costing 2 or more energy' },
    stalwart:    { kind: 'dr',         modelled: true,  when: 'above half health' },
    sunder:      { kind: 'dr',         modelled: true,  when: 'applies to the target' },

    // Real, but conditional on combat state the engine cannot know. Counted at a
    // discount so they are preferred over nothing, never over a flat bonus.
    cleave:      { kind: 'dmgPct', modelled: 'conditional', uptime: 0.4, when: 'target below half health' },
    opportunist: { kind: 'dmgPct', modelled: 'conditional', uptime: 0.5, when: 'target acts after you' },
    momentum:    { kind: 'dmgPct', modelled: 'conditional', uptime: 0.6, when: 'consecutive attacking turns, caps at three' },
    fleet:       { kind: 'dmgPct', modelled: 'conditional', uptime: 0.2, when: 'opening turn only' },
    fleeting:    { kind: 'dmgPct', modelled: 'conditional', uptime: 0.3, when: 'after a successful dodge' },
    unyielding:  { kind: 'dr',     modelled: 'conditional', uptime: 0.2, when: 'first hit of the fight only' },

    // Not scoreable: they depend on blocking, dodging, kills or loot.
    riposte:      { modelled: false, note: 'requires a successful block' },
    convalescent: { modelled: false, note: 'requires taking no damage that turn' },
    lifebound:    { modelled: false, note: 'recovers a share of damage taken' },
    channeling:   { modelled: false, note: 'requires a successful block' },
    conduit:      { modelled: false, note: 'chance-based energy gain' },
    attuned:      { modelled: false, note: 'chance-based energy refund' },
    resonant:     { modelled: false, note: 'first skill each fight costs one less' },
    windfall:     { modelled: false, note: 'requires a kill' },
    evasive:      { modelled: false, note: 'widens the dodge window' },
    uncanny:      { modelled: false, note: 'chance to ignore a hit, once per fight' },
    scavenger:    { modelled: false, note: 'gold and drop rate, not combat' },
  };

  // ── PASSIVES ──────────────────────────────────────────────────────────────
  // Race and class passives are written as prose in the game data, so they
  // cannot be parsed into numbers reliably. They are transcribed here by hand.
  //
  // This table is INCOMPLETE BY DESIGN and always will be. What matters is that
  // the engine knows which passives exist (it reads the names straight from the
  // data) and reports the ones it cannot score, so every build says what was
  // left out. That list is the to-do list for this table.
  //
  //   kind         effect
  //   ------------------------------------------------------
  //   dmgPct       percentage damage, `when` narrows it by move type
  //   statPct      percentage to one stat, `stat` says which
  //   critChance   flat crit chance
  //   summonHpPct  summon max health
  //   summonDmgPct summon damage
  //   points       extra stat points
  //
  // `uptime` discounts anything conditional, exactly as TRAITS does.
  const PASSIVES = {
    'Nisse (20%)': [
      { name: 'Magically Charged', kind: 'dmgPct', value: 15, when: /magic|fire/i,
        note: 'Fire and Magic damage only' },
    ],
    'Vastayan (9%)': [
      { name: 'Spirit Caller', kind: 'summonHpPct', value: 20, skeleton: 50,
        note: 'summons +20% HP, Skeletons +50%' },
      { name: 'Affinity Boost', kind: 'dmgPct', value: 10, when: /magic|hex|dark/i,
        note: 'Magic and Hex damage' },
    ],
    'Drauga (6%)': [
      { name: 'Enhanced Bloodlust', kind: 'dmgPct', value: 13.75, uptime: 0.5,
        note: 'after a kill, rest of fight (12.5-15%)' },
      { name: 'Vampiric Crits', kind: 'note', note: 'heals 15% of crit damage' },
    ],
    'Estella (24%)': [
      { name: 'Hyper Rage', kind: 'dmgPct', value: 25, uptime: 0.35,
        note: 'below 50% health only' },
    ],
    'Dullahan (1%)': [
      { name: 'Bonus Stat Points', kind: 'points', value: 3,
        note: '+3 stat points every 10 levels — already in the point budget' },
    ],

    // Weapon-training passives. `whenWeapon` pays only while the matching weapon
    // type is equipped, which is also a reason to keep a class on its own weapon.
    'Slayer': [
      { name: 'Spear Training', kind: 'dmgPct', value: 10, whenWeapon: 'Spear',
        note: '+10% with spear weapons' },
      { name: 'Swift Fighter', kind: 'note', note: '20% Speed for 2 turns after a dodge' },
    ],
    'Warrior': [
      { name: 'Sword Training', kind: 'dmgPct', value: 10, whenWeapon: 'Sword',
        note: '+10% with sword weapons' },
    ],
    'Martial Artist': [
      { name: 'Fighting Prowess', kind: 'dmgPct', value: 15, whenWeapon: 'Gauntlets',
        note: '+15% with Cestus weapons' },
    ],
    'Wizard': [
      { name: 'Scholar Training', kind: 'dmgPct', value: 5, whenWeapon: 'Staff',
        note: '+5% with Staves' },
    ],
    'Sentry': [
      { name: 'Hunker Down', kind: 'note', note: '15% defence for 3 turns after guarding' },
    ],
  };

  // ── SHARDS ────────────────────────────────────────────────────────────────
  // Shards DO carry numbers in the game data (rVal / pVal) keyed by bonusType,
  // so unlike enchants they can be scored properly. Radiant (R) is always the
  // better roll where both exist.
  //
  // `uptime` discounts the conditional ones the same way TRAITS does — Executing
  // only pays below 25% enemy health, so counting it in full would have it
  // outbid a bonus that applies on every hit.
  const SHARDS = {
    'passive-dmg':          { kind: 'dmgPct', uptime: 1.0,  note: 'always active' },
    'conditional-hp-above': { kind: 'dmgPct', uptime: 0.45, note: 'target above 80% health' },
    'conditional-hp-below': { kind: 'dmgPct', uptime: 0.2,  note: 'target below 25% health' },
    'per-debuff-target':    { kind: 'dmgPct', uptime: 1.0,  stacks: 3,
                              note: 'per debuff on the target, assumed 3' },
    'per-debuff-self':      { kind: 'dmgPct', uptime: 1.0,  stacks: 1,
                              note: 'per debuff on you, assumed 1' },
    'lifesteal':            { kind: 'lifesteal', uptime: 1.0, note: 'healing, not damage' },
    'energy-chance':        { kind: 'note', note: 'chance-based energy, no value in the data' },
  };
  const SHARD_SLOTS = 7;

  // ── ENCHANTS ──────────────────────────────────────────────────────────────
  // Enchant effects are prose with no numeric fields, so most are not scoreable.
  // Transcribe the ones whose text states a plain damage figure; everything else
  // is reported as "not counted" rather than silently treated as zero, which is
  // what made the optimiser pick no enchant at all.
  const ENCHANTS = {
    'Inferno': { kind: 'dmgPct', value: 20, uptime: 0.6,
                 note: '+20% while Burn is applied (25% chance per attack to apply it)' },
    'Cursed':  { kind: 'dmgPct', value: 30, uptime: 0.5,
                 note: '+30% vs Cursed enemies, +20% vs Sundered; does not stack' },
  };

  // ── FLAVOUR ───────────────────────────────────────────────────────────────
  // A name and a line for the finished build, chosen from what it actually
  // turned out to be. Checked in order, first match wins, so put the loud ones
  // first.
  //
  // These read the COMPUTED build, never the request, so the name can never
  // contradict the thing it is naming — a build called "Glass Cannon" really
  // does have no health. Add freely; it is the cheapest personality in the
  // codebase and it costs nothing if no entry matches.
  const FLAVOUR = [
    { when: c => c.critTier >= 3,
      name: 'Purple Streak',
      line: 'Past 300% crit chance. Every hit is a guaranteed red crit and a good few come up purple. There is no defence here whatsoever, and that is the point.' },

    { when: c => c.critTier >= 2 && c.hp < 120,
      name: 'Glass Cannon',
      line: 'Guaranteed orange crits on a body made of tissue paper. Win on turn one or explain yourself to the respawn screen.' },

    { when: c => c.goal === 'summon',
      name: 'Middle Management',
      line: 'You personally hit like a wet towel. Your four skeletons do not, and that is what delegation is for.' },

    { when: c => c.goal === 'heal',
      name: 'Group Project Carry',
      line: 'Everyone else gets the kills. You decide who keeps living. Quietly the most powerful person in the fight.' },

    { when: c => c.goal === 'speed',
      name: 'Already Gone',
      line: 'Acts first, acts often, and is somewhere else by the time anything swings back.' },

    { when: c => c.hp >= 500 && c.bestHit < 60,
      name: 'The Immovable Object',
      line: 'Does almost no damage. Also does not die. Bring a book — and a friend who can actually hurt things.' },

    { when: c => c.hp >= 450,
      name: 'Absolute Unit',
      line: 'Built like a wall and roughly as easy to move. Not fast, not subtle, still standing.' },

    { when: c => c.energyCap >= 7 && c.bestMove && /carnage/i.test(c.bestMove.name),
      name: 'One Big Swing',
      line: 'Bank every scrap of energy, then spend the lot in a single swing. Nothing subtle, enormously satisfying.' },

    { when: c => c.bestHit >= 600,
      name: 'Overkill',
      line: 'This does considerably more damage than anything in the game has health. Enjoy the numbers.' },

    { when: c => c.goal === 'status',
      name: 'Death by Paperwork',
      line: 'Nothing dies quickly. Everything dies eventually, of about nine things at once.' },

    { when: c => c.goal === 'tank',
      name: 'The Doorstop',
      line: 'Stands in the way. Keeps standing in the way. Occasionally hits something.' },

    { when: c => c.critChance >= 100,
      name: 'Sharp Practice',
      line: 'Every hit crits. Not flashy about it — just never stops.' },

    // Always matches, so there is always a name.
    { when: () => true,
      name: 'The All-Rounder',
      line: 'Good at most things, embarrassing at none. Deeply unfashionable and quietly effective.' },
  ];

  // ── RACE ROLES ────────────────────────────────────────────────────────────
  // What each race is actually FOR, which the stat blocks do not say and the
  // engine cannot infer — most racial passives are prose.
  //
  // This matters most for random rolls. Nobody min-maxing damage takes Daminos:
  // four lives and outgoing healing are excellent and completely beside the
  // point when the goal is a big number. Rolling it for a DPS build produces a
  // technically-valid build no player would ever build.
  //
  //   dps      raw damage
  //   crit     crit chance or crit damage
  //   magic    arcane / elemental damage
  //   summon   summon-specific
  //   speed    initiative and turn order
  //   status   applying and exploiting statuses
  //   tank     survivability
  //   sustain  healing, lives, regen
  //   support  helps the party more than itself
  //   allround genuinely fine anywhere — usually because it grants raw stats
  //
  // `placeholder: true` means the race has no real stat block in the data yet.
  // Those are excluded everywhere: recommending one is recommending an
  // unfinished entry, not a build.
  const RACE_ROLES = {
    'Stultus (20%)':  { roles: ['crit', 'dps', 'speed'],
                        note: '10 Speed becomes 1 Crit Chance, capped at +100 — the crit race' },
    'Estella (24%)':  { roles: ['dps', 'tank'],
                        note: '+25% damage below half health' },
    'Nisse (20%)':    { roles: ['magic', 'dps'],
                        note: '+15% Fire and Magic damage, best Arcane spread of the common races' },
    'Corvolus (3%)':  { roles: ['magic', 'dps'],
                        note: 'highest base Arcane in the game' },
    'Drauga (6%)':    { roles: ['dps', 'crit'],
                        note: 'damage buff after a kill, and crits heal you' },
    'Vydeer (1%)':    { roles: ['crit', 'dps'],
                        note: 'crit chance builds up over the fight' },
    'Ophimar (6%)':   { roles: ['speed', 'crit', 'status'],
                        note: 'highest base Luck and Speed; cleanses statuses' },
    'Vastayan (9%)':  { roles: ['summon', 'magic'],
                        note: 'summons get +20% HP, Skeletons +50% — the summoner race' },
    'Dullahan (1%)':  { roles: ['allround', 'dps', 'tank'],
                        note: '+3 stat points every 10 levels, which helps literally any build' },
    'Amorus (Ob)':    { roles: ['allround', 'dps', 'tank'],
                        note: 'the best raw stat block in the game, 4 in everything' },
    'Boreas (1%)':    { roles: ['status', 'tank'],
                        note: 'Cold application and a heavy Endurance block' },
    'Inferion (Ob)':  { roles: ['tank', 'dps'],
                        note: 'tanky and fire-flavoured, but frail to magic' },
    'Gynx (Ob)':      { roles: ['tank'],
                        note: 'base Endurance of 8 and energy sustain — a pure wall' },
    'Lentum (Ob)':    { roles: ['sustain', 'tank'],
                        note: 'regen and a shield' },
    'Sheea (Ob)':     { roles: ['sustain', 'dps'],
                        note: 'four lives and reduced cooldowns — the cooldowns are a real damage ' +
                              'gain, the lives are not what a DPS build is here for' },
    'Daminos (3%)':   { roles: ['support', 'sustain'],
                        note: 'four lives, outgoing healing and a party horn — a support race, ' +
                              'and not one anyone picks for damage' },
    'Veneri (6%)':    { roles: ['utility'],
                        note: 'gold, enchants and potions — economy rather than combat' },

    'Arborivia (3%)': { roles: [], placeholder: true, note: 'no stat block in the data yet' },
    'Calvariae (3%)': { roles: [], placeholder: true, note: 'no stat block in the data yet' },
  };

  // ── SETUP MOVES ───────────────────────────────────────────────────────────
  // Buffs you cast BEFORE the hit. The engine used to score a build by its best
  // single move in isolation, which throws away the whole idea of a rotation and
  // badly undervalues any race whose contribution is a buff rather than a stat.
  //
  // Corvolus is the clearest case: Nisse has a permanent +15% to Fire and Magic,
  // Corvolus has a castable +20% to six elements on a 9 turn cooldown, plus the
  // best base Arcane in the game. Judged on passives alone Nisse wins; judged on
  // an actual turn sequence, Corvolus opens harder.
  //
  //   duration / cd  give the uptime, which is what separates an opener from a
  //                  permanent buff for SUSTAINED damage
  //   reliability    for chance-based effects
  //   elements       the buff only applies to matching move types
  //   statBuff       maps onto model.js's existing verified buff flags rather
  //                  than a second implementation
  //
  // All values transcribed from the move text in the game data.
  const SETUP_MOVES = {
    'Cast Amplify': {
      owner: 'Corvolus (3%)', cost: 1, cd: 9, duration: 3, reliability: 1,
      kind: 'dmgPct', value: 20,
      elements: /magic|holy|fire|nature|ice|dark/i,
      note: '+20% to magic, holy, fire, nature, ice and dark for 3 turns, and -1 cooldown',
    },
    'Arcane Ritual': {
      owner: 'Corvolus (3%)', cost: 3, cd: 14, duration: 3, reliability: 0.5,
      kind: 'dmgPct', value: 40,
      elements: /magic|holy|fire|nature|ice|dark/i,
      note: 'a chance at ~40% to the same six elements — counted at half, since it is a chance',
    },
    'Spirit Awakening': {
      owner: 'Vastayan (9%)', cost: 4, cd: 18, duration: 4, reliability: 1,
      kind: 'summonDmgPct', value: 50,
      note: '+15% to all stats and +50% summon damage for 4 turns, then 27.5% self-damage and a heavy stun',
    },
    'Focus Step': {
      owner: 'Stultus (20%)', cost: 1, cd: 7, duration: 4, reliability: 1,
      kind: 'statBuff', statBuff: 'focusStepSpd',
      note: 'LVL x 2 flat Speed for 4 turns — +100 at level 50, which is enormous on any move that scales with Speed',
    },
  };

  // ── RACE TECH ─────────────────────────────────────────────────────────────
  // Exceptions to RACE_ROLES: a race that is off-role for a goal but genuinely
  // good at it because of a specific combo. A tech entry re-admits the race for
  // those goals AND pins the item that makes it work, so the build really is
  // running the combo rather than just wearing the race.
  //
  // The build always states the reasoning — an unusual race with no explanation
  // reads as a bug, and nobody should have to take it on faith.
  //
  // DELIBERATELY SPARSE. Most racial innate passives have NO text in the game
  // data (only the names are there), so there is nothing to reason from for most
  // races. Everything below names both halves of the combo and both halves are
  // in the data. Add more the same way — if you cannot point at the text, do not
  // add the entry.
  const RACE_TECH = [
    {
      race: 'Boreas (1%)',
      goals: ['damage', 'crit', 'burst'],
      enables: 'Frozen Diadem',
      name: 'Permafrost',
      why: 'Boreas applies Cold on its own, and Frozen Diadem pays +5% crit chance ' +
           'against Cold targets plus another 10% for applying it. On most races that ' +
           'gear is conditional and mostly dead; on Boreas the condition is always true, ' +
           'so it behaves like flat crit chance. Frostburned Rune extends the same trick ' +
           'to Fire moves.',
    },
  ];

  // Which race roles suit which goal. A goal missing from here accepts anything.
  const GOAL_RACE_ROLES = {
    damage: ['dps', 'crit', 'magic', 'allround'],
    burst:  ['dps', 'crit', 'magic', 'allround'],
    crit:   ['crit', 'dps', 'speed', 'allround'],
    summon: ['summon', 'magic', 'allround'],
    speed:  ['speed', 'crit', 'dps', 'allround'],
    status: ['status', 'dps', 'magic', 'speed', 'allround'],
    tank:   ['tank', 'sustain', 'allround'],
    heal:   ['support', 'sustain', 'tank', 'allround'],
    party:  ['support', 'sustain', 'tank', 'allround'],
  };

  // ── GEAR PASSIVES ─────────────────────────────────────────────────────────
  // 51 of the 80 gears carry a passive, and they are often the whole reason to
  // wear the thing. Without these the engine ranks gear on its stat block alone
  // and will happily pass over Crystal Sphere's flat +5% crit or Yar'thul's
  // ramping +80% damage because another gear had two more Luck.
  //
  // Same shape as TRAITS: `kind` says what it feeds, `uptime` discounts anything
  // conditional so a "while in the Volcano" bonus cannot outbid a permanent one.
  // Transcribed by hand from the passive text; everything not listed here is
  // reported under "Gear passives NOT counted" rather than silently ignored.
  const GEAR_PASSIVES = {
    'Crystal Sphere':      { kind: 'critChance', value: 5,  uptime: 1,
                             note: '+5% crit chance, unconditional' },
    "Yar'thul's Wrath":    { kind: 'dmgPct',     value: 80, uptime: 0.5,
                             note: '+8% damage per Overheat stack, caps at 10 — ramps over a fight' },
    'Vainglorious Locket': { kind: 'dmgPct',     value: 10, uptime: 0.5,
                             note: '+10% damage, decaying 5% per turn; also always act first' },
    'Focused Mind':        { kind: 'dmgPct',     value: 20, uptime: 0.3,
                             note: '+20% for a turn after Meditate, but you take 15% more' },
    'Band of Crushing Force': { kind: 'dmgPct',  value: 25, uptime: 0.35,
                             note: '+25% against blocking enemies' },
    'Forest Charm':        { kind: 'dmgPct',     value: 15, uptime: 0.25,
                             note: '+15% in the Forest, +25% to Nature attacks' },
    'Vulcan Knuckle':      { kind: 'dmgPct',     value: 15, uptime: 0.3,
                             note: '+15% to Fire elemental moves' },
    'Shard of Blight':     { kind: 'dmgPct',     value: 25, uptime: 0.3,
                             note: '+25% to Dark elemental attacks' },
    'Tear Blood Crystal':  { kind: 'critChance', value: 5,  uptime: 0.5,
                             note: '+5% crit and defence for 5 turns when you apply Bleed' },
    'Molten Carapace':     { kind: 'dr',         value: 30, uptime: 0.25,
                             note: '+30% defence below 40% HP' },
    'Egg Shelmet':         { kind: 'hpPct',      value: 10, uptime: 1,
                             note: 'start each fight with a shield worth 10% of max HP' },

    // Real, but not scoreable as a number here.
    'Wicked Crown':   { kind: 'note', note: 'turns physical moves into Dark — enables Shard of Blight' },
    "Narthana's Leaf":{ kind: 'note', note: '1.75x outgoing heal for 25% of your max HP' },
    'Grain Of Balance': { kind: 'note', note: 'redistributes 25% of your highest stat — currently bugged' },
    'Parasitic Leech':  { kind: 'note', note: 'heals the team for 2% of your damage' },
    'Dust Storm':       { kind: 'note', note: '10% chance to phase through an attack' },
    'Sanguine Fang':    { kind: 'note', note: '25% chance to heal 10% of the damage dealt' },
    'Shattered Clock Hand': { kind: 'note', note: '30% chance to cut cooldowns on Strike' },
  };

  // ── CLASS WEAPONS ─────────────────────────────────────────────────────────
  // No table in the game data says which class uses which weapon, so the engine
  // infers it from the class's passives ("Scholar Training … Staves"). That
  // works for classes whose kit names a weapon and fails silently for those
  // whose kit does not — an Assassin was being handed a sword.
  //
  // Entries here OVERRIDE the inference. Add a line whenever you see a class
  // given the wrong weapon; it is the cheapest correction in the whole engine.
  const CLASS_WEAPONS = {
    'Thief': ['Dagger'], 'Rogue (N)': ['Dagger'], 'Assassin (Ch)': ['Dagger'],
    'Ranger (Or)': ['Dagger'],
    'Martial Artist': ['Gauntlets'], 'Monk (Or)': ['Gauntlets'],
    'Brawler (N)': ['Gauntlets'], 'Darkwraith (Ch)': ['Gauntlets'],
    'Slayer': ['Spear'], 'Lancer (N)': ['Spear'], 'Impaler (Ch)': ['Spear'],
    'Wizard': ['Staff'], 'Elementalist (Or)': ['Staff'], 'Hexer (N)': ['Staff'],
    'Necromancer (Ch)': ['Staff'],
  };

  // ── UNAVAILABLE ───────────────────────────────────────────────────────────
  // Items the data tables carry that a player cannot actually use right now.
  // The builder keeps them on purpose — it doubles as a reference, and old
  // builds that were saved with them still have to load — but a build the
  // engine RECOMMENDS has to be one somebody can actually go and play.
  //
  // Excluded from every search, from the Advanced-options dropdowns, and named
  // in the answer if a request asks for one directly, so the exclusion is never
  // silent. To bring an item back when the game does, delete its line; nothing
  // else needs touching.
  //
  // test.js checks every name here still resolves against the game data, so a
  // typo fails loudly rather than quietly excluding nothing.
  const UNAVAILABLE = {
    // A whole main-weapon series, matched on `weapons[name].series`. Cheaper
    // and more durable than listing six names each, and it picks up any weapon
    // added to the series later.
    weaponSeries: {
      'Ivory':   'an Easter 2026 event weapon, and the event has ended',
      'Icerind': 'not usable in the current version of the game',
    },
    // Individual gear / armour / artifact / enchant / offhand names.
    items: {
      // The offhand from the same dead event. Listed by name rather than by
      // series because `weaponSeries` matches main weapons only, and the
      // Icerind Shield is deliberately NOT assumed to share its weapons' fate.
      'Ivory Shield':    'an Easter 2026 event offhand, and the event has ended',
      'Dread Fang':      'not in the game yet',
      'Empty Blade':     'not in the game yet',
      'Faded Heirloom':  'not in the game yet',
      'Ring of Heroism': 'not in the game yet',
    },
  };

  // ── QUIRKS ────────────────────────────────────────────────────────────────
  // Item behaviour the data tables do not encode. Each entry registers itself
  // into the model's hooks. `when` decides whether it is live for a build.
  //
  // To add one: give it a name, say which hook it belongs to, and write the
  // maths. Nothing else in the engine needs to know it exists.
  const QUIRKS = [
    {
      name: 'Stultus innate',
      hook: 'critChance',
      note: 'Stultus converts Speed to Crit Chance at 10 SPD = 1, capped at +100. ' +
            'The site does NOT floor this (builder.js:982), so 205 Speed is +20.5 crit, ' +
            'not +20 — flooring it here disagreed with the page on every Stultus build.',
      apply: (build, val, ctx) =>
        build.race === 'Stultus (20%)' ? val + Math.min(100, ctx.stats.spd / 10) : val,
    },
    {
      name: 'Vastic Glaive proc',
      hook: 'critChance',
      note: 'Vastic Glaive procs off your HIGHEST stat. The Luck outcome grants +80% crit ' +
            'on the next attack; the Speed outcome is bugged and does nothing. Keep Luck ' +
            'above Speed so the roll you actually get is the useful one.',
      apply: (build, val, ctx) => {
        if (!build.weapon || build.weapon.name !== 'Vastic Glaive') return val;
        if (!(build.buffs || {}).vasticProc) return val;
        const s = ctx.stats;
        const highest = Object.keys(s).reduce((a, b) => s[a] >= s[b] ? a : b);
        return highest === 'lck' ? val + 80 : val;
      },
    },
    {
      name: 'Ivory weapons',
      hook: 'critChance',
      note: 'Ivory weapons grant a flat +15% crit chance.',
      apply: (build, val) => val,   // already carried by weaponBonuses; listed for the reader
    },
    {
      name: 'Frozen Diadem',
      hook: 'critChance',
      note: '+5% crit while Cold, +10% while Iced — conditional, so only counted when ' +
            'the request implies the condition holds.',
      apply: (build, val) => {
        if (!(build.gear || []).some(g => g.name === 'Frozen Diadem')) return val;
        const b = build.buffs || {};
        return val + (b.diademIce ? 10 : b.diademCold ? 5 : 0);
      },
    },
    {
      name: 'Coagulated Finger Nail',
      hook: 'stat',
      note: 'Stacks 1.5 per stack onto every stat total once active.',
      apply: (build, val, ctx) => {
        if (!(build.gear || []).some(g => g.name === 'Coagulated Finger Nail')) return val;
        const st = (build.buffs || {}).coagStacks || 0;
        return val + st * 1.5;
      },
    },
  ];

  // ── CORRUPTION ────────────────────────────────────────────────────────────
  // Three forms. The choice follows from build SHAPE, and the shapes are
  // genuinely distinct, so this is decidable rather than a coin flip.
  //
  //   Tyranny    stances, shields, Condemned, party damage reduction
  //   Heresy     Force from crits, status application, Conversions
  //   Blasphemy  Notch — cheap moves bank it, a 3+ energy move spends it
  //
  // Each `fit` returns a score plus the reason it scored that way. Highest wins;
  // ties fall through in listed order.
  const CORRUPTION = [
    {
      form: 'Blasphemy',
      fit: c => {
        // Notch pays out when you have something expensive to dump it into.
        // Costs may be strings like "3+X" — parseInt, never `|0`, which reads
        // the game's biggest energy dumps as costing nothing.
        const cost = m => { const n = parseInt(String(m.cost), 10); return isNaN(n) ? 0 : n; };
        const big = c.moves.filter(m => cost(m) >= 3).length;
        const cheap = c.moves.filter(m => cost(m) <= 2).length;
        if (!big) return { score: 10, why: 'No 3+ energy move to spend a full Notch stack on.' };
        return {
          score: 60 + big * 12 + Math.min(cheap, 4) * 4,
          why: 'You have ' + big + ' move' + (big > 1 ? 's' : '') + ' costing 3+ energy. Cheap moves bank ' +
               'Notch and the expensive one consumes the whole stack for up to +30% damage plus a shield — ' +
               'which is exactly how this build already wants to play.',
        };
      },
    },
    {
      form: 'Heresy',
      fit: c => {
        const critty  = c.critChance >= 100;
        const statusy = c.moves.some(m => /bleed|burn|poison|ghostflame/i.test(m.effect || ''));
        let score = 25, bits = [];
        if (critty)  { score += 45; bits.push('crits grant Force once per turn, scaling with crit tier, and you are at ' + Math.round(c.critChance) + '% crit'); }
        if (statusy) { score += 30; bits.push('your moves apply statuses, which Dark Wing copies onto you for White Wing to detonate as Conversions'); }
        if (!bits.length) bits.push('neither high crit nor status application, so the Force economy stays starved');
        return { score, why: bits.join('; ') + '.' };
      },
    },
    {
      form: 'Tyranny',
      fit: c => {
        const tanky = c.goal === 'tank' || c.goal === 'party' || c.goal === 'heal';
        return {
          score: tanky ? 75 : 20,
          why: tanky
            ? 'Regent stance grants party damage reduction and redirects damage onto you, and Condemned makes ' +
              'your Subject take more damage from everyone — a defensive kit that scales with the team, not with your own damage.'
            : 'Its payoff is shields, party damage reduction and Condemned, which a pure damage build cannot cash in.',
        };
      },
    },
  ];

  // ── CORRUPTION DAMAGE ───────────────────────────────────────
  // Naming a form is only half an answer. The question people actually have is
  // "how much bigger does my hit get", so every form is also worked out as a
  // NUMBER and all three are shown side by side — pick the one you like, then go
  // and check it in game.
  //
  // Everything here comes from the mechanics text in the game data
  // (`corruptionForms`), quoted in the entry that uses it, so each number can be
  // traced back rather than taken on trust. Where the game states no number,
  // none is invented: it goes in `unknown` and stays out of the maths.
  //
  // Each entry returns:
  //   burst      multiplier on one prepared hit, best case
  //   sustained  multiplier on damage per turn averaged over a long fight
  //   ifCrit     conditional upside that depends on crossing a crit tier, or null
  //   lines      how the numbers were reached, shown with the build
  //   unknown    damage the form does that is deliberately NOT counted
  //   assumed    numbers the game does not state, listed so they can be tested
  //   steps      the extra turns getting into and using the form costs, which is
  //              what makes the in-form rotation a different rotation and not
  //              just the same one with a bigger number on the end. A step may
  //              carry `turns` when it spans several, and `isFinisher` when the
  //              step IS the payoff move rather than setup for it
  //
  // IMPORTANT: none of this feeds the optimiser's score. The build is chosen
  // first and the form afterwards, so an assumed number can never quietly
  // change which gear you were told to wear.

  // The numbers the game does not state. One place, so a single edit fixes
  // every line that uses one once somebody measures it in game.
  const CORRUPTION_ASSUMED = {
    // Condemned: "making the target take more damage from everyone". The game
    // never says how much. 10% is a placeholder, NOT a measurement.
    condemnedPct: 10,
  };

  const CORRUPTION_DAMAGE = {
    Blasphemy: (c) => {
      // "Any move costing 0-2 NRG generates 1 Notch up to your cap. Any move
      // costing 3+ NRG consumes the entire stack instead." So the Notch cap is
      // the energy cap — which is exactly why Overflow is worth more here than
      // "+1 max energy" sounds.
      const cap = Math.max(1, c.energyCap || 5);
      const cost = m => { const n = parseInt(String(m.cost), 10); return isNaN(n) ? 0 : n; };
      const dumps = (c.moves || []).filter(m => cost(m) >= 3);
      if (!dumps.length) {
        return {
          burst: 1, sustained: 1, ifCrit: null,
          lines: ['No move in this kit costs 3+ energy, so there is nothing to spend a Notch stack on. ' +
                  'The form still banks Notch and still pays the holding Recoil for it.'],
          unknown: [], assumed: [],
          steps: [{ move: 'Soul Ignition', note: 'Spend 100 Corrupt Energy to enter the form.' }],
        };
      }
      // "10% at 1 Notch, scaling to 30% at your cap."
      const burst = 1.30;
      // A full stack takes `cap` cheap turns to bank and one turn to spend, so
      // over a long fight the bonus lands on one turn in cap+1.
      const sustained = 1 + 0.30 / (cap + 1);
      return {
        burst, sustained, ifCrit: null,
        lines: [
          'Notch caps at your energy cap, which this build has at **' + cap + '**.',
          'A full stack spent on a damaging move is **+30% damage** — ' +
            dumps.map(m => m.name).slice(0, 3).join(', ') +
            (dumps.length > 1 ? ' cost' : ' costs') + ' 3+ energy and ' +
            (dumps.length > 1 ? 'consume' : 'consumes') + ' the whole stack.',
          'Banking a full stack takes ' + cap + ' cheap turns, so over a long fight that is ' +
            '**+' + (100 * (sustained - 1)).toFixed(1) + '%** damage per turn, not +30%.',
        ],
        steps: [
          { move: 'Soul Ignition', note: 'Spend 100 Corrupt Energy to enter the form.' },
          { move: 'Bank Notch', turns: cap,
            note: 'Moves costing 0-2 energy, one Notch each, up to your cap of ' + cap +
                  '. This is the cost of the +30%, and it is why the sustained figure is so much smaller.' },
          { move: dumps[0].name, isFinisher: true,
            note: 'Costs 3+ energy, so it consumes the whole stack: +30% damage, a shield worth 25% of ' +
                  'the hit, and 1 NRG back per Notch.' },
        ],
        unknown: [
          'The Shield (5-25% of the hit) and the lifesteal from spending Notch on a utility move.',
          'The 1 NRG refunded per Notch. It lands right after the dump, so on a build whose ' +
            'damage scales with energy held it is worth real damage the turn after.',
          'The Recoil cost of holding a stack, which ramps up to +50% over 3 turns.',
        ],
        assumed: [],
      };
    },

    Heresy: (c, M) => {
      // "As a bonus action, spend 25/50/75/100% of your Light Force for Crit
      // Rate 1:1 on your next attack." Force per hit is "a flat amount" — the
      // game never says how much — so the crit gain cannot be numbered. What CAN
      // be numbered is what that crit would be worth if it covers the gap to the
      // next tier, which is the whole reason the form interests a crit build.
      const cc = c.critChance || 0;
      const need = Math.ceil((Math.floor(cc / 100) + 1) * 100 - cc);
      const before = M.expectedMultiplier(cc, c.critDmg);
      const after = M.expectedMultiplier(cc + need, c.critDmg);
      const statusy = (c.moves || []).some(m => /bleed|burn|poison|ghostflame/i.test(m.effect || ''));
      const lines = [
        'Light Force converts to Crit Rate **1:1** on your next attack. The game does not state how ' +
          'much Force a hit grants, so no crit is added to the numbers above.',
        'This build sits at **' + cc.toFixed(1) + '%** crit. **' + need + '** more crosses the next tier, ' +
          'which would take a hit from **' + Math.round(c.bestHit) + '** to **' +
          Math.round(c.bestHit / (before || 1) * after) + '** (×' + (after / (before || 1)).toFixed(2) + ').',
      ];
      if (statusy) {
        lines.push('Your kit applies statuses, so Dark Wing copies them onto you and White Wing can spend ' +
                   'them: a Burning Conversion detonates every stack and then applies Shadowflamed for ' +
                   '**+30%** to Burning and Ghostflamed on that target for 3 turns.');
      }
      return {
        burst: 1, sustained: 1,
        ifCrit: { need, mult: after / (before || 1),
                  hit: c.bestHit / (before || 1) * after },
        lines,
        steps: [
          { move: 'Soul Ignition', note: 'Spend 100 Corrupt Energy to enter the form. You start in Dark Wing.' },
          { move: 'Build Light Force',
            note: 'Force goes to whichever stance you are in, and it is White Wing that builds Light. ' +
                  'A flat amount per hit plus a bonus on a crit, once per turn, scaling with crit tier — ' +
                  'none of those amounts are stated, so how many turns this takes is unknown.' },
          { move: 'Dark Wing — spend Light Force', turns: 0,
            note: 'Spend up to all of your Light Force for Crit Rate 1:1 on your next attack, ' +
                  'expiring after 3 turns. It costs no turn, which is what makes it worth doing.' },
        ],
        unknown: [
          'Conversion damage. Burning detonates for 0.5% + 0.2% of the enemy\'s max HP per stack and ' +
            'Ghostflamed for a flat 3.5%, all of which is a share of THEIR health bar and not comparable ' +
            'to the flat numbers above.',
          'Force generation itself — a flat amount per hit plus a crit bonus once per turn, neither stated.',
        ],
        assumed: [],
      };
    },

    Tyranny: (c) => {
      // "A move costing 2+ NRG spends 1 Mandate to apply or refresh Condemned,
      // making the target take more damage from everyone, not just you."
      // How much more is not stated anywhere in the data.
      const pct = CORRUPTION_ASSUMED.condemnedPct;
      const cost = m => { const n = parseInt(String(m.cost), 10); return isNaN(n) ? 0 : n; };
      const appliers = (c.moves || []).filter(m => cost(m) >= 2).length;
      const mult = appliers ? 1 + pct / 100 : 1;
      return {
        burst: mult, sustained: mult, ifCrit: null,
        lines: appliers
          ? ['Condemned is applied by any move costing 2+ energy, and this kit has **' + appliers + '** of them.',
             'It makes the target take more damage from **everyone**, so in a party it is worth several ' +
               'times what it shows here — these numbers only count your own hits.']
          : ['No move in this kit costs 2+ energy, so there is nothing to apply Condemned with.'],
        steps: appliers ? [
          { move: 'Soul Ignition', note: 'Spend 100 Corrupt Energy to enter the form. You start in Tyrant.' },
          { move: 'Strike / Magic Missile', note: 'Marks the target as your Subject. Only one at a time.' },
          { move: 'Trade damage', note: 'Mandate builds on your Subject as you trade with it. The first 2 ' +
                                        'stacks are guaranteed; past that it is a roll that improves with Corrupt Power.' },
          { move: 'Meditate', note: 'Swaps your stance and harvests all Mandate on your Subject into your own ' +
                                    'pool — the only pool your abilities spend from.' },
          { move: 'Any 2+ energy move', note: 'Spends 1 Mandate to apply or refresh Condemned on the target.' },
        ] : [
          { move: 'Soul Ignition', note: 'Spend 100 Corrupt Energy to enter the form.' },
        ],
        unknown: [
          'The Shield from harvesting Mandate, the party Damage Reduction pool, and the damage Regent ' +
            'redirects onto you — all defensive, none of it a bigger hit.',
        ],
        assumed: appliers
          ? ['Condemned is counted as **+' + pct + '%**. The game never states the real figure; this is a ' +
             'placeholder to make the form comparable, not a measurement. Test it and correct ' +
             '`CORRUPTION_ASSUMED.condemnedPct` in knowledge.js.']
          : [],
      };
    },
  };

  // ── TRAPS ─────────────────────────────────────────────────────────────────
  // Known mistakes. Attached to an answer as warnings when they apply, so the
  // build explains not just what to take but what NOT to.
  const TRAPS = [
    {
      name: 'Duplicate shards',
      when: b => {
        const seen = new Set();
        return (b.shards || []).some(s => seen.has(s) ? true : (seen.add(s), false));
      },
      warn: 'Duplicate shards contribute nothing in this builder — it de-duplicates by name. ' +
            'In game the second copy stacks at full value and the third and beyond at 25%, so the ' +
            'site under-reports a stacked setup. Do not "fix" it by stacking here.',
    },
    {
      name: 'Untiered weapon',
      when: (b, M) => !!b.weapon && !!(b.weapon.alloc && Object.keys(b.weapon.alloc).length)
                      && !M.data.TIERED_WEAPON_SERIES.some(s => (M.data.weapons[b.weapon.name] || {}).series === s),
      warn: 'This weapon is not from a tiered series, so it rolls no tier stat points at all.',
    },
    {
      name: 'Crit chance below a tier',
      when: (b, M, c) => c && c.critChance > 85 && c.critChance < 100,
      warn: 'Crit chance is close to 100% but under it. Crossing 100 guarantees every hit crits AND ' +
            'raises the crit multiplier a whole tier — the last few points are worth far more than they look.',
    },
  ];

  return { VOCAB, ALIASES, FLAVOUR, ARCHETYPES, DEFAULT_GOAL, GOAL_PRIORITY, CLASS_WEAPONS,
           UNAVAILABLE,
           ENERGY, TRAITS, PASSIVES, GEAR_PASSIVES, RACE_ROLES, GOAL_RACE_ROLES, RACE_TECH,
           SETUP_MOVES,
           SHARDS, SHARD_SLOTS, ENCHANTS,
           QUIRKS, CORRUPTION, CORRUPTION_DAMAGE, CORRUPTION_ASSUMED, TRAPS };
}));
