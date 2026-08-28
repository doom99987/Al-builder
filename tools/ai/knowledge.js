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
    // Alias lookup is an EXACT token match, so 'zerk' does not cover 'zerker',
    // and 'zerker' is too far from 'berserker' for the fuzzy path to reach it.
    // The misspellings are here because people type them, not to be charitable.
    'zerker': 'Berserker (Ch)', 'berzerker': 'Berserker (Ch)',
    'bezerker': 'Berserker (Ch)', 'bezerk': 'Berserker (Ch)',
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
      role: 'DPS',
      label: 'Maximum damage',
      statWeights: { str: 3, arc: 3, lck: 2, spd: 1, end: 0 },
      kitWords: ['damage','deal','strike','attack','pierce','slash','power'],
      // Sustained: a buff on a 9 turn cooldown lasting 3 turns is not a
      // permanent buff, so this is uptime-weighted rather than the opener.
      score: c => c.sustainedHit || c.bestHit,
      blurb: 'Every point that does not raise damage is a wasted point.',
    },
    burst: {
      role: 'DPS',
      label: 'Biggest single hit',
      statWeights: { str: 3, arc: 3, lck: 4, spd: 1, end: 0 },
      kitWords: ['damage','execute','massive','heavy','charge','empowered'],
      // Burst is the opener: spend the setup turns, then hit. That is exactly
      // what a burst build is for, so it is scored on the buffed number.
      score: c => c.bestBurst || c.bestHit,
      blurb: 'Optimised for the largest single number, not sustained output.',
    },
    crit: {
      role: 'DPS',
      label: 'Crit / overcrit',
      statWeights: { lck: 5, str: 2, arc: 2, spd: 1, end: 0 },
      kitWords: ['crit','critical','precise','lethal','assassinate'],
      // Crit tiers are steps, so reward landing ON a threshold rather than near it.
      score: c => (c.sustainedHit || c.bestHit) * (1 + 0.05 * c.critTier),
      blurb: 'Luck feeds Crit Chance 1:1, and each 100% crosses into a higher crit tier.',
    },
    tank: {
      role: 'Tank',
      label: 'Survivability',
      statWeights: { end: 5, str: 2, arc: 0, spd: 1, lck: 0 },
      kitWords: ['block','guard','shield','defen','armou','taunt','protect','fortif','resist','damage reduction'],
      // Effective HP: raw HP scaled by block damage reduction and incoming heals.
      score: c => (c.effectiveHp ?? c.hp) * (1 + c.blockDr / 100) *
                  (1 + ((c.effectiveIncHeal ?? c.incHeal) - 100) / 400),
      blurb: 'Endurance drives HP, and Strength converts to block damage reduction.',
    },
    heal: {
      role: 'Healer',
      label: 'Healing / support',
      statWeights: { end: 4, arc: 3, str: 1, spd: 2, lck: 0 },
      kitWords: ['heal','restore','mend','cleanse','revive','bless','pray','sanct'],
      // What you actually heal per turn, not just the percentage you heal FOR.
      //
      // This used to be the multiplier alone, which is why a Saint and a Paladin
      // scored alike: the model could see that both had a big outgoing-healing
      // figure and could not see that only one of them owns Holy Grace. Heal
      // rate folds in the move, its stat scaling and its cooldown - so casting
      // it more often is worth something, which is what cooldown reduction is
      // for, and it is also the proc rate on Narthana's Sigil.
      //
      // The health divisor is 250 rather than the 400 the old multiplier-only
      // score used, and it is not a compromise: at 400 the search pushed Luck
      // to 83, overshooting the 60 milestone and wasting 23 points. At 250 the
      // healer keeps 241 HP AND heals more per turn than it did at 178.
      //
      // Falls back to the old multiplier when a build has no healing move at
      // all, so a healer-by-gear still scores above nothing.
      // Total healing over a fight = how much you heal a turn x how many turns
      // you are alive to do it. That is the whole formula, and it is why a
      // healer wants damage reduction: nothing in the game boosts healing much
      // beyond Narthana's Leaf and the Luck milestone, so once those are in,
      // the next best thing for your healing output is not dying.
      //
      // healPerTurn ALREADY has the outgoing multiplier folded in (optimize.js
      // applies it per move), so it must not be applied again here - doing that
      // squared it and bought Arcane at the expense of everything else.
      score: c => {
        const surv = (c.effectiveHp ?? c.hp) * (1 + c.blockDr / 100);
        // No healing move means no healing. The multiplier multiplies nothing -
        // which is the whole lesson of the Paladin, and of the Necromancer that
        // won this role on a survivability score while healing zero per turn.
        // The tiny term keeps builds that all heal nothing in a sane order and
        // is far too small to outscore anything that actually heals.
        if (!c.healPerTurn) return surv / 1000;
        return c.healPerTurn * surv / 10;
      },
      blurb: 'Endurance grants END/4 to both heal stats, so bulk and healing scale together.',
    },
    summon: {
      role: 'DPS',
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
      role: 'Support',
      label: 'Status / damage over time',
      statWeights: { arc: 3, str: 2, spd: 2, lck: 2, end: 1 },
      kitWords: ['bleed','burn','poison','hex','curse','wound','infect','plague','stack'],
      // The health term is deliberately gentler than the healer's (hp/800, not
      // hp/400). Without ANY health term this archetype collapsed to pure damage
      // the moment it was blended with anything - a Support build came out on
      // 76 HP, which applies no debuffs to anybody because it is dead. Stacking
      // a status takes TURNS, and turns are something you have to live through.
      score: c => (c.bestHit * 0.7 + c.stats.spd * 2) * (1 + c.hp / 800),
      blurb: 'Status application cares about acting often, and about living long enough to stack it.',
    },
    speed: {
      role: 'Support',
      label: 'Speed / initiative',
      statWeights: { spd: 5, str: 2, arc: 2, lck: 1, end: 1 },
      kitWords: ['speed','swift','haste','dash','initiative','agil','quick','evade'],
      score: c => c.stats.spd * 6 + c.bestHit * 0.4,
      blurb: 'Speed grants initiative at SPD/10 and decides who moves first.',
    },
    party: {
      role: 'Support',
      label: 'Party support',
      statWeights: { end: 4, arc: 2, spd: 2, str: 1, lck: 1 },
      kitWords: ['ally','allies','party','team','rally','aura','shared','support'],
      score: c => c.hp * 0.5 + (c.effectiveHeal ?? c.outHeal) * 2 + c.stats.spd,
      blurb: 'Built to keep a group alive rather than to top the damage chart.',
    },
    balanced: {
      role: 'Flex',
      label: 'Balanced',
      statWeights: { str: 2, arc: 2, end: 2, spd: 2, lck: 2 },
      kitWords: [],
      // Block damage reduction belongs here. Scoring only damage and HP made the
      // optimiser dump Strength, which quietly cost a player 53 points of block
      // DR and still called the result an upgrade.
      score: c => (c.bestHit * 0.6 + (c.effectiveHp ?? c.hp) * 0.8) * (1 + c.blockDr / 200),
      blurb: 'A build that does not fall apart when the fight goes badly.',
    },
  };

  // ── ROLES ─────────────────────────────────────────────────────────────────
  // The four jobs in a party, plus the one that is not a job. A role is a
  // property of the GOAL, not of the class - a Saint told to maximise damage is
  // playing DPS badly, and the build should say so rather than pretend.
  //
  // This exists because the goals are too fine-grained to be useful as a label.
  // Nobody asks for a "status / damage over time" build; they ask who debuffs.
  const ROLES = {
    Tank: {
      label: 'Tank',
      blurb: 'Takes the hits the rest of the party cannot. Scored on effective HP, ' +
             'block damage reduction and incoming healing.',
    },
    Healer: {
      label: 'Healer',
      blurb: 'Keeps everyone standing. Scored on outgoing healing and enough health to ' +
             'keep casting it. Damage is not part of the job.',
    },
    Support: {
      label: 'Support / Debuff',
      blurb: 'Changes the shape of the fight - debuffs, party buffs, acting first. Its ' +
             'contribution is mostly on other people\'s stat sheets.',
    },
    DPS: {
      label: 'DPS',
      blurb: 'Kills things. Every point that does not raise damage is a wasted point, ' +
             'which is why these builds have almost no health.',
    },
    Flex: {
      label: 'Flex',
      blurb: 'Not one of the four. A build that does not fall apart when the fight goes ' +
             'badly, at the cost of being the best at nothing.',
    },
  };

  // Which goals a role is made of. Choosing a role is the normal way in - the
  // ten goals are too fine-grained to put in front of somebody ("status /
  // damage over time" is not how anyone describes a build), and four roles are.
  //
  // Support is the one that needs two: the debuff half and the team half are
  // scored by different archetypes and the job is both.
  // An entry is a goal name, or [goal, weight]. Weight only matters where a
  // role is made of more than one.
  const ROLE_GOALS = {
    Tank:    ['tank'],
    Healer:  ['heal'],
    // Buffing the team and debuffing the enemy are both this job. `party` takes
    // the larger share because `status` is a damage archetype underneath, and an
    // even blend produced a 76 HP "support" that supports nobody because it is
    // dead. Measured across weightings: 1:1 and 2:1 both stayed glass, 3:1 is
    // where it turns into a real support - fast enough to act first, healing,
    // and bulky enough to be there on turn three.
    Support: [['party', 3], ['status', 1]],
    DPS:     ['damage'],
    Flex:    ['balanced'],
  };

  // [goal, weight] pairs for a set of roles, merged so a goal named by two
  // roles counts once at the larger weight.
  function goalWeights(roles) {
    const out = [];
    for (const r of (roles || [])) {
      for (const item of (ROLE_GOALS[r] || [])) {
        const g = Array.isArray(item) ? item[0] : item;
        const wt = Array.isArray(item) ? item[1] : 1;
        if (!ARCHETYPES[g]) continue;
        const found = out.find(x => x[0] === g);
        if (found) found[1] = Math.max(found[1], wt);
        else out.push([g, wt]);
      }
    }
    return out;
  }

  // Roles in the order they should be offered and shown.
  const ROLE_ORDER = ['Tank', 'Healer', 'Support', 'DPS'];

  function goalsForRoles(roles) {
    return goalWeights(roles).map(x => x[0]);
  }

  function roleOf(goal) {
    const a = ARCHETYPES[goal];
    return (a && ROLES[a.role]) ? Object.assign({ key: a.role }, ROLES[a.role]) : null;
  }

  // Items that are unmistakably built for one role but whose value the model
  // CANNOT price, so they can never win on score - only break a tie.
  //
  // Narthana's Sigil is the case that made this necessary. Its damage is written
  // as "X (scales on level)" and never stated, so it measures exactly equal to
  // Stellian Core on a healer - and list order handed the healer the artifact
  // built for people at full HP instead of the one that fires off their healing.
  const ROLE_ITEMS = {
    Healer: {
      "Narthana's Sigil":
        'the healer artifact: every 270 HP you heal, it deals damage and heals the party ' +
        'for the same amount. Outgoing healing IS the proc rate, so the build that heals ' +
        'hardest also fires it most often',
      'Breath of Fungyir':
        'it FULLY heals your entire team. No number, so no score - but nothing else in the ' +
        'lost scroll list is close for somebody whose job is keeping people alive',
      'Bard':
        'Curar Forte heals everyone around you for 7%, and Latir Minor hands out a damage and ' +
        'regen buff. It is the only subclass that does the healer\'s job',
      'Self Cure':
        'strips every status off you for 5% of your max HP. A healer who is silenced, cursed or ' +
        'stunned is healing nobody, and this is the only self-cleanse in the scroll list',
      'Wind Reflect':
        'a shield on yourself or an ally that stops physical attacks outright for 3 turns. It ' +
        'does not fully work on bosses, which is the honest caveat',
    },
    Tank: {
      'Heavenly Prayer':
        '15% damage reduction, 3 Resist, 10% lifesteal and two turns of Death Defy. Only the ' +
        'DR has a number, and the Death Defy is probably worth more than it',
      'Blacksmith':
        'Jury Rigging is a 10 HP shield scaling on END/150 - the only subclass move that ' +
        'protects anybody',
      'Lesser Absorb':
        'pulls 5% of an ally\'s incoming damage onto you. That is a cost on any other build and ' +
        'the entire job on this one',
    },
    Support: {
      "Metrom's Grasp":
        'drops enemy defence by 40% for five turns. Nothing here models enemy defence, so it ' +
        'scores nothing and is still the strongest thing a debuff build can bring',
      'Alchemist':
        'Dangerous Mixture applies three stacks of three different debuffs at once, ' +
        'unblockable and undodgeable',
      'Lights Out':
        '3 Blinded and 1 Stunned on every enemy at once, on a 5 turn cooldown. It can backfire ' +
        'onto you, which is why it scores nothing',
    },
    DPS: {
      'Miner':
        'The Right Angle is 12 base scaling on STR/70 + END/140 and hits everything - the ' +
        'biggest subclass attack in the game',
    },
  };

  // How far a role item is allowed to lose by and still be taken.
  //
  // A tiebreak was not enough. Once the healing archetype started scoring damage
  // reduction, Stellian Core beat Narthana's Sigil by 4.4% on DR alone - a real
  // measured gain - and the healer stopped carrying the artifact that fires off
  // its own healing. The Sigil's damage is written "X (scales on level)" and can
  // never be measured, so it can never win a contest decided purely on numbers.
  //
  // 10% is a deliberate, bounded allowance, the same shape as
  // COVENANT_FIT_WEIGHT: enough to carry an item whose whole value is invisible
  // to the model, far too small to justify a genuinely bad pick. Anything that
  // beats a role item by more than this takes the slot, and the write-up always
  // says which happened.
  const ROLE_ITEM_MARGIN = 0.10;

  function roleItemNote(goal, name) {
    const r = roleOf(goal);
    return (r && (ROLE_ITEMS[r.key] || {})[name]) || null;
  }

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

  // ── CLASS ROLE ────────────────────────────────────────────────────────────
  // What a class is FOR. Naming a class names a role: "saint build" is a request
  // for a healer, not for a compromise that happens to be wearing Saint's kit.
  //
  // Consulted ONLY when a request names a class and states no goal. Any goal
  // word wins outright - "dmg saint" is a damage build, and nothing here
  // overrules it. A stat focus does not: "full arcane saint" is still a healer,
  // and the arcane still lands, because a stat focus also weights the allocation
  // directly (optimize.js) and Saint's heals scale on STR/100 + ARC/100 anyway.
  //
  // DECLARED, not read out of the move text, because reading the text gets it
  // wrong. Counting kit words puts Citadel on `damage` - its own moves say "75%
  // of their damage is redirected to you", the single most defensive sentence in
  // the game, and the word that gets counted is "damage". Every entry names the
  // moves it rests on, so the claim is checkable against the game data.
  //
  // THE BAR FOR AN ENTRY: the archetype it points at must still score staying
  // alive. `heal` multiplies by (1 + hp/400) and `tank` is built on effective HP,
  // so committing a Saint or a Citadel to its role costs it nothing it wanted.
  // `damage`, `burst`, `crit`, `speed`, `summon` and `status` have NO health term
  // in their score at all, and it is not theoretical - routing "necromancer
  // build" to `summon` produced a 66 HP Necromancer, and "hexer build" an 82 HP
  // Hexer. Someone who asks for a summoner by name can have that; someone who
  // typed a class name and nothing else should not be handed it silently.
  //
  // So this table is short on purpose. `balanced` is a poor default for a class
  // built to heal or to hold a line - it put a Citadel on 98 HP - and a perfectly
  // reasonable one for a class built to attack.
  const CLASS_ROLE = {
    'Saint (Or)': { goal: 'heal', why:
      'it is the only class in the game whose moves carry a healing number - Cleansing Prayer ' +
      'and Holy Grace - Holy Emissary raises all your healing by 35%, and Graceful Returns pays ' +
      'you a defence and regen buff for healing an ally' },

    'Citadel (Or)': { goal: 'tank', why:
      'all three of its moves are defensive: Crucible opens with a vitality-scaled damage ' +
      'reduction buff, Blinding Vow hands an ally 10% DR, and Sanctified Protection redirects ' +
      '75% of the whole party\'s damage onto you' },

    'Lionheart (N)': { goal: 'tank', why:
      'Torrefy absorbs damage aimed at your allies while you guard, Vulcanised Vigor converts ' +
      'damage you have taken into stacking DR and attack power, and Benumb stops HP loss ' +
      'outright for two turns' },

    'Paladin (Or)': { goal: 'tank', why:
      'Enduring Fighter is a permanent 15% damage resistance, Shield Training and Protector let ' +
      'you take hits meant for your team, and Holy Crash pulls the room onto you' },

    // Base class. Only reachable below level 15, since classesForLevel drops the
    // bases above that - but "level 10 sentry build" is a real request.
    'Sentry': { goal: 'tank', why:
      'Hunker Down pays you 15% defence for guarding, and Lookout exists to put you in front of ' +
      'a target of your choice' },
  };

  // Deliberately NOT here, and why, so nobody adds them by pattern-matching:
  //
  //   Necromancer (Ch) unmistakably a summoner - Call Skeleton, Raise Dead,
  //   Hexer (N)        Darklight Drain - and Hexer has exactly one attack in its
  //                    whole kit. Both fail the survivability bar above and
  //                    nothing else. If `summon` and `status` ever score health,
  //                    these two are the first entries to add.
  //   Darkwraith (Ch)  a summoner whose Darkcores come from CRITS. The summon
  //                    archetype weights Arcane at 5 and Luck at 1, so committing
  //                    it would have the build dump the exact stat that feeds
  //                    its summons.
  //   Lancer (N)       Rooted Fighter blocks, Poised Slayer heals off dodges,
  //                    Rallying Shout buffs the team, and Empowered Pierce and
  //                    Discharge are ordinary attacks. Genuinely a bruiser; no
  //                    single archetype is more right than `balanced`.
  //   Impaler (Ch)     bleeds constantly, but Bloody Berserker is a straight
  //                    +1% damage per 1% HP missing. It is a damage class that
  //                    happens to bleed, and `damage` zeroes Endurance on a class
  //                    whose own moves cost it HP.
  function classRole(klass) {
    return (klass && CLASS_ROLE[klass]) || null;
  }

  // ── STAT MILESTONES ───────────────────────────────────────────────────────
  // Every stat crosses three thresholds - 25 / 60 / 110 - and each one grants a
  // real effect. The SITE renders them and applies none of them. Neither did
  // this engine, and the consequences were not small:
  //
  //   LCK 60 is +35% OUTGOING HEALING, and the healing archetype weighted Luck
  //   at zero. Every healer the AI has ever produced walked past a third of its
  //   own healing because base stats were the only thing being counted.
  //
  //   STR 110 and ARC 110 each cut a cooldown, which is the whole of "casting it
  //   more often" and was invisible.
  //
  // `text` is the game's own wording and is asserted against `statMilestones` in
  // the tests - if a game update rewords one of these, that fails loudly rather
  // than the engine quietly pricing something that no longer exists.
  //
  // Index is the TIER: 0 -> 25 points, 1 -> 60, 2 -> 110.
  const MILESTONES = {
    lck: [
      { kind: 'note',       text: 'Crit Damage increased by 10%.',
        note: 'not counted: critDmg is computed from the site\'s own formula and this is not in it' },
      { kind: 'outHealPct', value: 35, text: 'Gain 35% Outgoing healing.' },
      { kind: 'note',       text: 'Gain gold after battles end.',
        note: 'gold, which no build score can see' },
    ],
    end: [
      { kind: 'note',       text: 'Take 20% less damage from status effects.',
        note: 'not counted: nothing here models incoming status damage' },
      { kind: 'incHealPct', value: 35, text: 'Gain 35% Incoming healing.' },
      { kind: 'note',       text: 'Passive regen increased by 2.',
        note: 'not counted: regen is per-turn healing and this model has no turn loop for it' },
    ],
    str: [
      { kind: 'note', text: 'Strike\'s base damage becomes 6.5.',
        note: 'not counted: Strike is the unarmed basic, and no optimised build uses it' },
      { kind: 'note', text: 'Take 10% less damage when blocking.',
        note: 'not counted separately - block damage reduction already comes from Strength' },
      { kind: 'cdCut', value: 1, elements: /magic/i, text: 'Magic Element attacks cost 1 less cooldown.' },
    ],
    arc: [
      { kind: 'note', text: 'Use one extra potion.', note: 'potions are not modelled' },
      { kind: 'note', text: '15% chance to gain an extra energy at the start of your turn.',
        note: 'not counted: a chance at energy, and energy is a cap here rather than a flow' },
      { kind: 'cdCut', value: 1, elements: /physical/i, text: 'Physical Element attacks cost 1 less cooldown.' },
    ],
    spd: [
      { kind: 'note', text: 'Enemies are less likely to dodge your attacks.', note: 'no number given' },
      { kind: 'note', text: 'The dodge bar gets bigger.', note: 'no number given' },
      { kind: 'dodgePct', value: 5, text: '5% chance to auto-dodge attacks.' },
    ],
  };

  // Which milestones a set of finished stats has actually reached.
  function milestonesFor(stats, tiers) {
    const steps = tiers || [25, 60, 110];
    const out = { outHealPct: 0, incHealPct: 0, dodgePct: 0, cdCut: [], reached: [], missed: [] };
    for (const [stat, list] of Object.entries(MILESTONES)) {
      const have = Math.max(0, (stats || {})[stat] || 0);
      list.forEach((def, i) => {
        const need = steps[i];
        if (need === undefined || !def) return;
        const row = { stat, need, tier: i + 1, text: def.text, kind: def.kind, note: def.note };
        if (have < need) { out.missed.push(row); return; }
        out.reached.push(row);
        if (def.kind === 'outHealPct') out.outHealPct += def.value;
        else if (def.kind === 'incHealPct') out.incHealPct += def.value;
        else if (def.kind === 'dodgePct') out.dodgePct += def.value;
        else if (def.kind === 'cdCut') out.cdCut.push({ elements: def.elements, value: def.value, stat, text: def.text });
      });
    }
    return out;
  }

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
      // Demoted from a priced +10%. Affinity Boost has NO text in the game data
      // at all - only the name - so that 10% was priced from nothing, which is
      // the one thing this file is not allowed to do. Restore it the moment
      // somebody can point at a number.
      { name: 'Affinity Boost', kind: 'note',
        note: 'boosts damage of some affinity - the game data gives the name and nothing else, ' +
              'no elements and no figure, so it is NOT counted. It was previously priced at +10% ' +
              'to Magic, Hex and Dark on no stated authority.' },
    ],
    'Drauga (6%)': [
      { name: 'Enhanced Bloodlust', kind: 'dmgPct', value: 13.75, uptime: 0.5,
        note: 'after a kill, rest of fight (12.5-15%)' },
      { name: 'Vampiric Crits', kind: 'note', note: 'heals 15% of crit damage' },
    ],
    'Estella (24%)': [
      // Lifted to the stance uptime only when the CLASS is also built to fight
      // hurt. On anything else it stays at the cautious 0.35.
      { name: 'Hyper Rage', kind: 'dmgPct', value: 25, uptime: 0.35, hpGate: 'low',
        note: 'below 50% health only' },
    ],
    'Dullahan (1%)': [
      { name: 'Bonus Stat Points', kind: 'points', value: 3,
        note: '+3 stat points every 10 levels — already in the point budget' },
    ],

    // Two races whose innate passives have NO effect text in the game data at
    // all - only the names. The names are the whole of what was extractable, so
    // for years the engine could see "Reduced Cooldowns" and knew nothing about
    // it. The numbers below are REPORTED BY THE SITE OWNER, not read out of the
    // data, and they are marked as such wherever they show up.
    'Sheea (Ob)': [
      { name: 'Reduced Cooldowns', kind: 'cdCut', value: 1, source: 'owner',
        note: 'every cooldown is 1 turn shorter, and it STACKS with the STR 110 and ARC 110 ' +
              'milestones. On anything whose job is repeating a move - a healer above all - ' +
              'that is worth more than a stat block.' },
    ],
    'Daminos (3%)': [
      { name: 'Outgoing Healing', kind: 'note',
        note: 'an innate outgoing-healing bonus with no figure anywhere in the data. NOT counted ' +
              'because inventing the number would be inventing the build. Restructure (5 + 5% max ' +
              'HP regen for 3 turns) and Mulligan Realm (~21% outgoing healing to the whole party, ' +
              'plus a chance to survive a fatal blow) are real and also uncounted.' },
    ],

    // The low-HP classes. Every one of these was in the "not counted" list until
    // now, which meant the engine could see that Stellian Core wanted high HP
    // and had no idea anything wanted the opposite. `hpGate: 'low'` marks a
    // passive that only pays while the build is fighting hurt.
    //
    // All three numbers below are the ones the game text states, read at the
    // 50% HP the stance assumes. None of them is a guess about the mechanic;
    // the guess is that the build actually gets to 50% and stays there.
    'Berserker (Ch)': [
      { name: 'Bloodlust', kind: 'dmgPct', value: 65, uptime: 0.5, hpGate: 'low',
        note: '+10% damage per stack from being hit below 50% HP, capped at +65%. Counted at ' +
              'half, because it RAMPS - you have none of it on turn one. The further permanent ' +
              '+40% below 30% HP is NOT counted at all.' },
    ],
    'Impaler (Ch)': [
      { name: 'Bloody Berserker', kind: 'dmgPct', value: 50, uptime: 1, hpGate: 'low',
        note: '+1% damage per 1% of HP missing. At the 50% HP this stance assumes that is ' +
              'exactly +50%, which is arithmetic rather than an estimate. At 25% HP it is +75%.' },
      { name: 'Deranged Fighter', kind: 'note',
        note: '+1% incoming healing per unique status effect on you. Not counted: it depends ' +
              'entirely on what the enemy is doing to you.' },
    ],
    'Brawler (N)': [
      { name: 'Bruiser', kind: 'dr', value: 10, uptime: 1, hpGate: 'low',
        note: '10% damage reduction under 50% max HP. The +30% Speed it also grants is NOT ' +
              'counted - it is a percentage of Speed, and nothing here converts that to a score.' },
    ],
    'Darkwraith (Ch)': [
      { name: 'Spirit Wraith', kind: 'note',
        note: 'Under 50% HP your summons gain 6% lifesteal, paid to YOU rather than to them. ' +
              'Not counted: it is sustain rather than damage, and it depends on how much your ' +
              'summons are actually landing.' },
    ],

    // Priced, but NOT into the reported figure. Holy Emissary is a flat +35% to
    // outgoing and incoming healing; `outHeal` is a number the SITE shows and
    // the site does not apply class passives to it, so raising it here would
    // print a figure arcanelineagebuilder.com disagrees with.
    //
    // So it feeds a separate `effectiveHeal` that the healing archetypes score
    // on - exactly how `effectiveHp` already works for dodge. It was originally
    // left unpriced on the grounds that a flat multiplier cannot change a
    // decision. That was wrong: it cannot reorder one class's gear, but it
    // absolutely reorders CLASSES, and without it a Paladin stacking Endurance
    // measured as a better healer than a Saint.
    'Saint (Or)': [
      { name: 'Holy Emissary', kind: 'outHealPct', value: 35,
        note: '+35% outgoing AND incoming healing. Counted in the healing SCORE but deliberately ' +
              'not added to the Heal out figure below, because that figure is the site\'s and ' +
              'the site does not apply class passives to it. Multiply it by 1.35 for the real ' +
              'total in game.' },
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

  // ── GEAR SYNERGY ──────────────────────────────────────────────────────────
  // What an item's passive NEEDS before it does anything.
  //
  // The optimiser scores an item by its stat block plus whatever GEAR_PASSIVES
  // can price. That is how a Saint ended up in Madseer's Codex, Imbuement
  // Reliquary and Impure Crown: all three are Arcane 4-5, Arcane feeds Holy
  // Grace, and all three passives are dead on a healer -
  //
  //   Madseer's Codex     statuses on Magic/Fire/Ice/Hex attacks. Saint is Holy.
  //                       It also makes your QTEs HARDER, so it is a downside.
  //   Imbuement Reliquary "summons gain your enchant". Saint has no summons.
  //   Impure Crown        extra Poison stacks. Saint applies no Poison.
  //
  // Nothing was wrong with the arithmetic. The engine simply had no way to know
  // a passive could not fire. Each entry names the condition and it is checked
  // against what the build's own kit actually does, so this cannot go stale in
  // the way a hand-maintained "bad for healers" list would.
  //
  //   element   the passive only fires on attacks of these types
  //   summons   the build must actually summon something
  //   poison    the build must apply Poison itself
  //   blocking  pays only when you block, so it wants a build that guards
  //   healedBy  being healed by an ally makes it worse
  //
  // `caution: true` marks the second kind of entry. Not everything here is a
  // DEAD passive: Yar'thul's Wrath in a party still fires, it just loses a
  // stack every time somebody heals you, and Ptera's Heart poisons the enemy
  // whether or not you have a Poison build - it also poisons YOU. Those are
  // warnings to print, not reasons to refuse the item, and lumping them in with
  // "this cannot fire at all" flagged 36 perfectly good damage builds as broken.
  const GEAR_NEEDS = {
    "Madseer's Codex":     { element: /magic|fire|ice|hex/i,
                             why: 'its statuses only fire on Magic, Fire, Ice and Hex attacks, and it ' +
                                  'makes your QTEs harder in exchange - on a kit with none of those ' +
                                  'elements it is a pure downside worn for the stat block' },
    'Imbuement Reliquary': { summons: true,
                             why: 'it gives your SUMMONS the full effects of your enchant, and this ' +
                                  'build has no summons' },
    'Impure Crown':        { poison: true,
                             why: 'it adds a stack every time you apply Poison, and this build applies ' +
                                  'no Poison' },
    "Ptera's Heart":       { poison: true, caution: true,
                             why: 'it poisons every enemy AND you, every turn. Without a Poison build ' +
                                  'to feed, the half that lands on you is the half you get' },
    'Spore Root':          { blocking: true, caution: true,
                             why: 'it only does anything when you BLOCK a melee attack' },
    'Desert Escutcheon':   { blocking: true, caution: true,
                             why: 'its charges only build when you successfully block' },
    "Yar'thul's Wrath":    { healedBy: true, caution: true,
                             why: 'you LOSE an Overheat stack every time an ally heals you, so it ' +
                                  'actively fights a party that has a healer in it' },
  };

  function gearNeedNote(name) {
    return (GEAR_NEEDS[name] || {}).why || null;
  }

  function gearNeedIsCaution(name) {
    return !!(GEAR_NEEDS[name] || {}).caution;
  }

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

    // Zero stat block, full kit. These were excluded as unfinished entries,
    // which was wrong: they grant no stats ON PURPOSE and are played entirely
    // for their moves. Excluding them meant they could never be recommended
    // even where the kit is the whole point.
    'Arborivia (3%)': { roles: ['support', 'crit'],
                        note: 'no stat bonuses at all - Leaf Thrust carries +50 crit chance and ' +
                              'Maple Vindication is party-wide regen. Everything it gives is in ' +
                              'the kit, so it is only worth taking for the kit' },
    'Calvariae (3%)': { roles: ['tank'],
                        note: 'no stat bonuses at all - Brittle Cure trades 20% of current HP for ' +
                              'a 25% damage-reduction buff' },
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
    // A COVENANT move rather than a race or class one. setupsFor scans the
    // covenant's learns with the covenant as the owner, so the only new thing
    // here is the owner name.
    'Holy Light': {
      owner: 'Church of Raphion', cost: 2, cd: 5, duration: 4, reliability: 1,
      kind: 'dr', value: 5,
      note: 'a 5% damage-reduction buff, a 0.5% regen for 4 turns and a 20 HP shield scaling on ' +
            'END/100 - counted at duration over cooldown, and NOT charged for the turn it costs',
    },
    // A Ranger's own stance rather than a race move. setupsFor scans class moves
    // with the class as the owner, so this needs no new machinery.
    'Flourish': {
      owner: 'Ranger (Or)', cost: 2, cd: 6, duration: 4, reliability: 1,
      kind: 'statBuff', statBuff: 'flourishSpd',
      note: 'a flat +25 Speed and +25% defence in stance — +48 Speed with Flourish Proficiency',
    },
    'Focus Step': {
      owner: 'Stultus (20%)', cost: 1, cd: 7, duration: 4, reliability: 1,
      kind: 'statBuff', statBuff: 'focusStepSpd',
      note: 'LVL x 2 flat Speed for 4 turns — +100 at level 50, which is enormous on any move that scales with Speed',
    },

    // ── scrolls ────────────────────────────────────────────────────────────
    // Owner is the SCROLL, because every scroll's move shares its name. Only
    // the ones whose game text states a number are here; the rest are reported
    // by SCROLL_NOTES below and priced at nothing, which is the honest answer
    // when the text says "a damage and defense buff" and stops there.
    'Absolute Radiance': {
      owner: 'Absolute Radiance', cost: 4, cd: 18, duration: 5, reliability: 1,
      kind: 'dmgPct', value: 13.5,
      note: 'ramps 7.5 / 10 / 12.5 / 15 / 22.5% across its five turns - counted at the ' +
            'AVERAGE of those, 13.5%, rather than the 22.5% headline you only reach on turn five',
    },
    'Lesser Empower': {
      owner: 'Lesser Empower', cost: 2, cd: 6, duration: 2, reliability: 1,
      kind: 'dmgPct', value: 15,
      note: 'a flat +15% for 2 turns on a 6 turn cooldown',
    },
    'Steel Body': {
      owner: 'Steel Body', cost: 2, cd: 8, duration: 1, reliability: 1,
      kind: 'dr', value: 80,
      note: '80% incoming damage reduction, but for ONE turn on an 8 turn cooldown - counted at ' +
            'duration over cooldown, so it prices at a tenth of the headline. It does not work ' +
            'on boss ultimates.',
    },
    'Heavenly Prayer': {
      owner: 'Heavenly Prayer', cost: 5, cd: 22, duration: 3, reliability: 1,
      kind: 'dr', value: 15,
      note: '15% damage reduction for 3 turns. The 10% lifesteal, 3 Resist and the two turns of ' +
            'Death Defy it also grants are NOT counted - none of them has a number this model ' +
            'can use, and Death Defy in particular is worth more than the DR is',
    },
    'Blizzard': {
      owner: 'Blizzard', cost: 2, cd: 15, duration: 4, reliability: 1,
      kind: 'dmgPct', value: 20, elements: /ice/i,
      note: '+20% ICE damage for the team for 4 turns - it pays only on ice moves. The team ' +
            'defence it also gives is not counted',
    },
  };

  // Scrolls whose effect is real and unpriceable. Reported with the build so a
  // slot that measures at zero does not read as an empty slot.
  const SCROLL_NOTES = {
    'Bulk Up': '+20% damage AND -20% of your own defence, stacking multiplicatively (2 stacks = ' +
               '44% more damage taken). NOT priced: the upside has a number and the downside does ' +
               'not fit this model, and pricing only the upside would hand it to every build.',
    'Immolation': '+10% damage for the rest of the fight, and it drains you to 0.1 HP and leaves ' +
                  'you there. NOT priced, for the same reason as Bulk Up.',
    'Metrom\'s Grasp': 'drops the enemy defence 40% and adds 40% to your damage-over-time for 5 ' +
                       'turns. NOT priced: nothing here models enemy defence or DoT output. On a ' +
                       'debuff build it is doing real work these numbers miss.',
    'Breath of Fungyir': 'FULLY heals your entire team, and heavy-stuns the target. NOT priced: ' +
                         'there is no number, and a full team heal is worth more than any figure ' +
                         'on this sheet.',
    'Wild Impulse': 'your next hit becomes a pseudo-AoE for 20% to everything nearby, and applies ' +
                    'Vulnerable and Weakened. NOT priced: this model fights one enemy.',
    'Surprise Package': 'a bomb for 30% of the target max HP - only 5% on a boss. NOT priced: ' +
                        'damage as a fraction of the TARGET\'s health is not something this ' +
                        'model computes.',
    'Torching Soul': 'heals 3% of max HP per Burn and gives an unstated damage and defence buff. ' +
                     'NOT priced: "a buff" is not a number.',
    'Wind Reflect': 'blocks physical attacks outright for 3 turns, and does not fully work on ' +
                    'bosses. NOT priced: no number, and the boss caveat is the case that matters.',
    'Lesser Absorb': 'redirects 5% of an ALLY\'s incoming damage onto you. Party only, and a ' +
                     'cost rather than a gain when you are the one being scored.',
    'Self Cure': 'cleanses every status on you for ~5% of your max HP. NOT priced: worth ' +
                 'everything or nothing depending on what you are fighting.',
    'Lights Out': '3 Blinded and 1 Stunned on everything, with a chance to backfire onto you.',
    'Simple Curse': 'a small Arcane attack that is in the move pool above with the rest of them.',
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
    // Only the unconditional half. The +45% version costs 50 Corrupt Power, works
    // once per turn and only while in a Corruption Form, so counting it as a
    // permanent bonus would badly overrate the gear.
    'Lucky Horns':         { kind: 'dmgPct',     value: 5,  uptime: 1,
                             note: '+5% damage always; 50 Corrupt Power in a Corruption Form raises ' +
                                   'it to +45% for one attack, once per turn — that half is not counted' },

    // Real, but not scoreable as a number here.
    'Wicked Crown':   { kind: 'note', note: 'turns physical moves into Dark — enables Shard of Blight' },
    "Narthana's Leaf":{ kind: 'note', note: '1.75x outgoing heal for 25% of your max HP' },
    'Grain Of Balance': { kind: 'note', note: 'redistributes 25% of your highest stat — currently bugged' },
    'Parasitic Leech':  { kind: 'note', note: 'heals the team for 2% of your damage' },
    'Dust Storm':       { kind: 'note', note: '10% chance to phase through an attack' },
    'Sanguine Fang':    { kind: 'note', note: '25% chance to heal 10% of the damage dealt' },
    'Shattered Clock Hand': { kind: 'note', note: '30% chance to cut cooldowns on Strike' },
  };

  // ── MASTERY ABILITIES ───────────────────────────────────────
  // The six capstones are the expensive half of the mastery tree: 5 points each
  // out of 35, against 1 for a stat node. Until now the engine could only see
  // the stat points, so it was buying a capstone on branch colour and calling it
  // a choice — the ability it was actually paying for was invisible to it.
  //
  // Two layers feed this:
  //
  //   1. extract-data.js runs builder.js's OWN parseDmgBonus over all 108
  //      ability descriptions and stores what it finds (`masteryAbilities`).
  //      That covers 23 of them for free and cannot drift from the site.
  //   2. This table, which overrides or adds. It exists because a parsed number
  //      is only half the answer: "+100% against stunned enemies" and "+15% to
  //      all your elements" both read as a percentage, and only one of them is
  //      close to always on.
  //
  // `uptime` is the whole point. Without it the optimiser buys Overload for its
  // +100% and never notices it needs the target stunned first.
  //
  // Anything with no entry and no parsed number is reported under "Mastery
  // abilities NOT counted" rather than silently scored as zero.
  const MASTERY_ABILITY_DEFAULT_UPTIME = 0.5;

  // ── PARTY ─────────────────────────────────────────────────────────────────
  // Nobody plays a Lionheart, a Paladin or a Citadel alone. Their kit is built
  // to be pointed at four other people, and an ability worth 15% to you is worth
  // 15% to five people — the engine was scoring all of it as if you were solo,
  // which is why a defensive capstone kept losing to a stat node.
  //
  // Whether you are in a party is ASKED, never inferred. Guessing it from the
  // goal was wrong in both directions: plenty of people solo a tank to survive
  // content they cannot out-damage, and plenty take a damage build into a
  // five-stack where a party-wide debuff is worth five times what it looks like.
  // It changes which capstones are worth 5 points, so it is not a detail to
  // assume on somebody's behalf.
  //
  // `party` on an ability below says its effect lands on the team rather than on
  // you. Scaled by ALLIES, not by party size: the ability already counts once
  // for you, and this adds the other four — with a discount, because you cannot
  // guard everyone at once and no group stays in range of everything.
  // A superclass needs level 15 (builder.js:146 — the site greys the options out
  // and labels them "Req. Lvl 15"). Above that a base class is not a choice
  // anybody makes: measured at level 50, Warrior scores 552 against Berserker's
  // 2279. Below it, a superclass is not a choice anybody CAN make.
  const SUPERCLASS_MIN_LEVEL = 15;

  const PARTY_SIZE   = 5;
  const PARTY_SPREAD = 0.5;   // how much of the team a team effect actually reaches
  const PLAY_STYLES  = {
    solo: { label: 'Solo',      note: 'nothing you do for other people counts' },
    team: { label: 'Full team', note: 'a party of ' + 5 + ', so party effects are worth several times more' },
  };

  // ── DAMAGE MODELS ─────────────────────────────────────────────────────────
  // Two honest ways to read a damage number, and they build different characters.
  //
  //   average    what the move does per swing over a long fight, crit chance
  //              folded in: base x (1 + p(critMult - 1)). Luck is worth exactly
  //              what it actually returns, and a 25% crit build is priced at 25%.
  //   potential  what it does WHEN the crit lands. Luck stops paying once it can
  //              buy a crit at all, and everything flows to raw damage and crit
  //              DAMAGE instead of crit chance.
  //
  // Neither is wrong. Average is what a long fight gives you; potential is the
  // number you screenshot. They are far apart on a low-crit build, which is
  // exactly why the engine must not pick one for you.
  const DAMAGE_MODELS = {
    average:   { label: 'Average damage',
                 note: 'crit chance folded in — what the move really does per swing over a fight' },
    potential: { label: 'Potential damage',
                 note: 'the number when the crit lands — a ceiling, not an average' },
  };

  // ── BOSSES ────────────────────────────────────────────────────────────────
  // Aiming a build at one fight. The best general build is not the best build
  // for every boss: Seraphon HEALS off the debuffs you put on it, so the status
  // stacking that wins most fights actively extends that one.
  //
  // Two layers, on purpose:
  //
  //   derived   read out of the boss's own passive text in the snapshot, so it
  //             updates when the encyclopedia does. Only patterns the game
  //             states flatly ("Immune to Purified, Weakened, Blinded, and
  //             Cursed") are read this way - no guessing at prose.
  //   tactics   hand-written, for mechanics no parser can see. Each one names
  //             the move it comes from so it can be checked against the game.
  //
  // WHAT THIS CANNOT DO: no boss in the data has an HP figure, so kill TIME in
  // turns is not computable. What is computable is which of two builds kills
  // faster, which is what the choice is actually for. The write-up says so
  // rather than implying a stopwatch.
  const STATUS_WORDS = [
    'purified', 'weakened', 'blinded', 'cursed', 'hexed', 'vulnerable', 'sundered',
    'bleed', 'bleeding', 'burning', 'inferno', 'stun', 'stunned', 'poison', 'poisoned',
    'frozen', 'chilled', 'shocked', 'heal down', 'defense down', 'silenced', 'rooted',
    'plague', 'hex',
  ];

  // How hard each mechanic is priced. THESE ARE PLACEHOLDERS, not measurements
  // — the game states that Seraphon's heal scales with debuff stacks, never by
  // how much. Kept in one place, and named in the write-up, so correcting them
  // is one edit once somebody times the fight both ways.
  //
  // Deliberately modest. Over-penalising would throw away genuinely good damage
  // builds over a mechanic whose size nobody has measured, and being wrong in
  // that direction is worse than being slightly too generous.
  const BOSS_PENALTIES = {
    perDebuffShare: 0.35,   // multiplied by the share of the kit that applies statuses
    debuffCap:      0.25,   // never worse than this, however debuff-heavy the kit
    oneElement:     0.15,   // a kit that deals a single element into an adapting boss
    immuneShare:    0.60,   // multiplied by the share of the kit leaning on an immune status
    immuneCap:      0.35,   // a kit built entirely around an inert status is not worthless
    noDodge:        0.30,   // at zero Speed, solo, against a boss whose moves you must dodge
    assumed: true,
  };

  // Solo, most boss moves have to be dodged, and dodging takes Speed. Reported
  // from play: around 40 is the point where it stops being a problem.
  //
  // SOLO ONLY. In a full party the incoming moves are spread across five people
  // and nobody needs to dodge nearly as much, so applying this to a team build
  // would tax it for a problem it does not have.
  const BOSS_SOLO_MIN_SPEED = 40;

  const BOSS_TACTICS = {
    'Handaconda': {
      // NOT in the encyclopedia - its entry lists only Thousand Screams. Player
      // knowledge, recorded here so the engine can act on it, and worth adding
      // to js/encyclopedia.js so the site says it too.
      immuneStatuses: ['poison', 'poisoned'],
      dodgeIrrelevant: true,
      why: 'Fully immune to Poison, so a kit that wins by stacking it - an Assassin above all - ' +
           'is doing nothing here beyond its direct damage.',
    },
    "Metrom's Vessel": {
      dodgeIrrelevant: true,
    },
    'Seraphon': {
      punishesDebuffs: true,
      why: 'High Retribution heals Seraphon in proportion to the debuff stacks on it, ' +
           'and its own note says the priority rises the more statuses Seraphon is carrying. ' +
           'Stacking debuffs both heals it and makes it heal more often.',
      alsoWatch: 'It summons a Sheea Saint, Elementalist or Paladin every 9 turns, and two at ' +
                 'a time below 50% HP, so a long fight gets worse rather than better.',
    },
    'Thorian, The Rotten': {
      punishesDebuffs: false,
      punishesOneElement: true,
      why: 'Elemental Adaptation adapts to the LAST damage type used against it, and a second ' +
           'hit of that same element heals Thorian instead of hurting it. A build that only ' +
           'deals one element feeds it; one that can alternate does not.',
      alsoWatch: 'Immune to Plague, Cursed and Hex, and any Hex applied becomes Vulnerable instead.',
    },
  };

  // Pulls what the game states plainly out of a boss's passives. Deliberately
  // narrow: it reads "Immune to A, B and C" and the block/dodge line, and
  // ignores everything else rather than inventing meaning from prose.
  function bossProfile(name, data) {
    const entry = ((data || {}).BOSS_MOVE_DATA || {})[name];
    if (!entry) return null;
    const passives = entry.passives || [];
    const text = passives.map(p => (p.name || '') + ' ' + (p.description || '')).join(' ');
    const statusImmune = [], otherImmune = [];
    const re = /immune to ([^.]+)/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      for (const raw of m[1].split(/,| and /i)) {
        const w = raw.trim().replace(/^the /i, '').toLowerCase();
        if (!w) continue;
        if (STATUS_WORDS.indexOf(w) !== -1) { statusImmune.push(w); continue; }
        // Anything else the game listed as an immunity. Kept rather than
        // dropped: the first version filtered against STATUS_WORDS alone and
        // silently lost Thorian's Plague and Hex, understating the immunity in
        // a way nothing would ever have surfaced. Multi-word entries with
        // punctuation are items, not statuses ("Metrom's Amulet").
        if (/^[a-z][a-z ]{2,18}$/.test(w)) otherImmune.push(w);
      }
    }
    const tac = BOSS_TACTICS[name] || {};
    // Immunities the game text does not state but a player has. Merged in so
    // everything downstream sees one list rather than having to know which
    // layer a fact came from.
    for (const st of (tac.immuneStatuses || [])) statusImmune.push(String(st).toLowerCase());
    return {
      name,
      statusImmune: [...new Set(statusImmune)],
      fromPlayers:  [...new Set((tac.immuneStatuses || []).map(x => String(x).toLowerCase()))],
      dodgeIrrelevant: !!tac.dodgeIrrelevant,
      otherImmune:  [...new Set(otherImmune)],
      blocks: /can block/i.test(text),
      dodges: /can (block & )?dodge|can dodge/i.test(text),
      punishesDebuffs: !!tac.punishesDebuffs,
      why: tac.why || null,
      alsoWatch: tac.alsoWatch || null,
      modelled: !!BOSS_TACTICS[name],
      passives: passives.map(p => p.name).filter(Boolean),
      moves: (entry.learns || []).map(mv => mv.name).filter(Boolean),
    };
  }

  // How much of a build's kit is about applying statuses. Read from the move
  // text, because that is the only place it exists.
  function debuffLoad(moves) {
    let applying = 0;
    const names = [];
    for (const mv of moves || []) {
      const t = String(mv.effect || '') + ' ' + String(mv.quote || '');
      if (/\bapplies\b|\binflicts\b/i.test(t) &&
          STATUS_WORDS.some(w => new RegExp('\\b' + w + '\\b', 'i').test(t))) {
        applying++; names.push(mv.name);
      }
    }
    const total = (moves || []).length || 1;
    return { applying, total, share: applying / total, names };
  }

  // How much of a kit leans on one specific status. Separate from debuffLoad,
  // which counts status application in general: this asks whether the moves are
  // about THAT status, which is what an immunity makes inert.
  function statusLoad(moves, statuses) {
    const want = (statuses || []).map(x => String(x).toLowerCase());
    if (!want.length) return { applying: 0, total: (moves || []).length || 1, share: 0, names: [] };
    let applying = 0;
    const names = [];
    for (const mv of moves || []) {
      const t = (String(mv.effect || '') + ' ' + String(mv.quote || '') + ' ' +
                 String(mv.name || '')).toLowerCase();
      if (want.some(w => new RegExp('\\b' + w + '\\b').test(t))) { applying++; names.push(mv.name); }
    }
    const total = (moves || []).length || 1;
    return { applying, total, share: applying / total, names };
  }

  // ── ARTIFACT ABILITIES ────────────────────────────────────────────────────
  // artifactItems holds stat blocks only, so an artifact was chosen purely on
  // the stats it hands out and what it DOES was invisible. Stellian Core grants
  // +30% damage, +20% DR and +15% crit chance and none of that was counted
  // anywhere.
  //
  // `effects` rather than a single kind, because one artifact commonly grants
  // several different things at once. The single-kind shape the gear passives
  // use still works; this is the multi-effect form alongside it.
  const ARTIFACT_ABILITIES = {
    'Stellian Core': {
      // "Only activates when you are above 95% of your Max HP." You open a fight
      // there and stop being there quickly, so this is worth a fraction of its
      // printed value. The fraction is a JUDGEMENT, not a measurement.
      uptime: 0.35, uptimeAssumed: true,
      effects: [
        { kind: 'dmgPct',     value: 30 },
        { kind: 'dr',         value: 20 },
        { kind: 'critChance', value: 15 },
      ],
      note: '+30% damage, +20% DR and +15% crit chance, but ONLY above 95% max HP. Counted at ' +
            '35% uptime — an assumption, not a measurement: it is at its best on the opening ' +
            'turn and worth nothing once anything has hit you.',
    },
    'Shifting Hourglass': {
      // "Enter Heavy Stun for a turn. If Heavy Stun passes and you haven't lost
      // 20% of your HP, grants a 20% Dmg buff and DR. Capped at 5 uses."
      //
      // The stated numbers are real, but so is the cost: it spends a TURN, and
      // the payout is cancelled if you take a real hit while stunned. The engine
      // does not model a turn as lost damage, so counting this at face value
      // would make it look free. A third is the honest side to err on.
      uptime: 0.33, uptimeAssumed: true,
      effects: [
        { kind: 'dmgPct', value: 20 },
        { kind: 'dr',     value: 20 },
      ],
      note: '+20% damage and +20% DR, but Sands Of Time is an ACTIVE - 1 energy, 15 turn ' +
            'cooldown - and you spend the turn in Heavy Stun to get it, losing the buff ' +
            'entirely if you drop 20% HP while stunned. Capped at 5 uses a fight. Counted at ' +
            '33%: an assumption, and it does NOT charge you for the turn it costs.',
    },
    // Priceable: one stance in three is a flat 15% DR, and the stances rotate at
    // random, so the expectation is a third of it. The other two branches are
    // Resist per debuff taken (situational) and 5 Energy (worth real damage on a
    // pool-spending kit, but only on the turn it lands).
    'Ancient Insignia': {
      uptime: 1 / 3, uptimeAssumed: false,
      effects: [{ kind: 'dr', value: 15 }],
      note: 'Stances rotate at random every 3 turns: Rock is a flat 15% DR, so one turn in ' +
            'three is 5% on average. Paper (1 Resist per debuff taken) and Scissors (5 Energy) ' +
            'are real but not counted. Written in Stone can force a switch on a 12 turn cooldown.',
    },
    // Stated, and dismissed on the first pass because the figure is not a
    // percentage: "damage equal to your current Level x2" is 100 at level 50.
    'Darksigil': {
      kind: 'note',
      note: 'After you apply 6 DIFFERENT statuses, it fires a Dark Orb for Level x2 damage ' +
            '(100 at level 50) and puts 2 Vulnerable and 2 Weakened on everything. Not counted: ' +
            'it is one burst per six statuses, and the engine does not simulate a rotation long ' +
            'enough to say how often that happens. It pairs with a status kit and with Chaos ' +
            'Orb, and it is dead weight on a kit that applies nothing.',
    },
    // The biggest transformation of any artifact, and the first pass read its
    // "10%" and moved on.
    'Paranoxian Crux': {
      kind: 'note',
      note: 'Rewrites your health: max HP x1.5, then set to 10% of THAT - so you keep about ' +
            '15% of your original HP as real health and the other ~135% becomes Shield HP. ' +
            'Congeal Flesh restores 15xX% of the shield for X energy. Not counted, because the ' +
            'engine models HP but has no notion of Shield HP at all, and pretending the two are ' +
            'the same would badly misprice every tank build that wears this.',
    },
    'Arkhaia\'s Visage': {
      kind: 'note',
      note: 'Infernal Pledge links an enemy for 3 turns and SHARES the damage you take with it ' +
            '- 1 energy, 8 turn cooldown, so a bit over a third of a fight. Effectively a large ' +
            'defensive cooldown; not counted, because how much it saves depends on what is ' +
            'hitting you and the engine does not model incoming damage.',
    },
    "Heaven's Authority": {
      kind: 'note', party: true,
      note: 'Summons a Sheea with 250 HP - Saint, Paladin or Elementalist at random - and it ' +
            'gains its full Super Class kit if you carry the matching weapon type. Two of them ' +
            'below 20% HP. Not counted: the engine scores your sheet, not an ally\'s.',
    },
    "Metrom's Amulet": {
      kind: 'note',
      note: 'On a kill, the OVERKILL damage becomes an AoE against everything else (20 damage ' +
            'into a 15 HP enemy gives a 5 base AoE). Not counted: it does nothing against a ' +
            'single target, which is what every number here measures, and it cannot damage ' +
            'Seraphon or Arkhaia at all.',
    },
    'Reality Watch': {
      kind: 'note',
      note: 'Chronos saves your HP and energy and rewinds to them 3 turns later, on a 12 turn ' +
            'cooldown. It will not save you if you die inside those 3 turns. Not counted: it is ' +
            'a survivability cooldown with no number attached to price.',
    },
    // Handled as a proc rather than a flat ability - its value depends on how
    // much the KIT applies statuses, which a fixed number cannot express. Listed
    // here too so neither table has a hole in it.
    'Chaos Orb': {
      kind: 'note', seeProcs: true,
      note: '33% chance to apply an extra random status whenever you apply one. Counted under ' +
            'Procs, where it can be scaled by how status-heavy the kit actually is.',
    },
    'Celestial Emblem': {
      kind: 'note', trap: true,
      note: 'This one is a DOWNSIDE. Fighting a Goblin, Night Raider, Sentient Darkness, Star ' +
            'Slime or Arkhaia while wearing it makes that enemy EMPOWERED with extra effects. ' +
            'It does nothing good for your own sheet, and against Arkhaia specifically it makes ' +
            'the fight harder.',
    },
    "Narthana's Sigil": {
      kind: 'note', party: true,
      note: 'When you heal 270 HP it deals damage and heals your allies for the same amount. ' +
            'Not counted: the amount is written as "X (scales on level)" and never stated. On ' +
            'a healer in a party it is doing real work these numbers miss.',
    },
  };

  // ── HP STANCE ─────────────────────────────────────────────────────────────
  // Where a build wants to sit on its own health bar, and which items care.
  //
  // Four classes have passives that pay you for being HURT, and one artifact
  // pays you only for being untouched. Pricing both at a fixed uptime is wrong
  // in both directions at once: Stellian Core's "above 95% of your Max HP" is
  // worth almost nothing to a Berserker who is deliberately dropping under 50%
  // to stack Bloodlust, and Molten Carapace's "below 40% HP" is worth far more
  // to that same build than to anything else. The engine used to hand Stellian
  // Core to a Berserker on all 36 rolls.
  //
  // Only a CLASS sets the stance. A race can want the same thing - Estella's
  // Hyper Rage is "below 50% health only" - but a race is an incentive and a
  // class is a commitment, and inferring a whole play pattern from a race would
  // be reading far more into it than it says.
  const HP_STANCE = {
    'Berserker (Ch)': { side: 'low', passive: 'Bloodlust',
      why: 'stacks 10% damage each time it is hit below 50% HP, to a 65% cap, and a further ' +
           'permanent 40% below 30%' },
    'Impaler (Ch)': { side: 'low', passive: 'Bloody Berserker',
      why: '1% damage for every 1% of HP missing, up to 100% at 1 HP' },
    'Brawler (N)': { side: 'low', passive: 'Bruiser',
      why: '10% DR and 30% Speed while under 50% max HP, lost the moment you heal above it' },
    'Darkwraith (Ch)': { side: 'low', passive: 'Spirit Wraith',
      why: 'summons gain 6% lifesteal that is paid to you, and only while you are under 50% HP' },
  };

  // Items whose passive is gated on an HP threshold, and which side of it.
  const HP_GATED = {
    'Stellian Core':   { needs: 'high', threshold: 95, text: 'only above 95% of max HP' },
    'Molten Carapace': { needs: 'low',  threshold: 40, text: 'only below 40% HP' },
  };

  // Both figures are assumptions, and are labelled as such wherever they are
  // used. `agree` is not 1: even a build committed to fighting hurt spends the
  // first turns at full health. `conflict` is not 0: you do start the fight
  // topped up, and one opening turn is worth something.
  const HP_GATE_UPTIME = { agree: 0.8, conflict: 0.05 };

  // What a build's stance is, and why. `committed` is the thing that matters:
  // it is true only when the CLASS is built to fight hurt.
  function hpStance(klass, race) {
    const cls = HP_STANCE[klass];
    const sources = [];
    if (cls) sources.push({ owner: klass, passive: cls.passive, why: cls.why });
    // Recorded either way, so the write-up can say "and your race wants this too".
    if (race === 'Estella (24%)') {
      sources.push({ owner: race, passive: 'Hyper Rage', why: '25% damage below 50% health' });
    }
    return { side: cls ? cls.side : null, committed: !!cls, sources };
  }

  // The uptime an HP-gated passive really gets on THIS build, and a sentence
  // saying why it is not the number written in the table.
  function hpGateFor(name, stance, declared) {
    const gate = HP_GATED[name];
    if (!gate || !stance || !stance.committed) return null;
    const agrees = gate.needs === stance.side;
    const uptime = agrees ? HP_GATE_UPTIME.agree : HP_GATE_UPTIME.conflict;
    const who = stance.sources[0];
    return {
      uptime, agrees, declared,
      why: agrees
        ? name + ' is gated ' + gate.text + ', and ' + who.owner + ' is built to fight there (' +
          who.passive + ': ' + who.why + '). Counted at ' + Math.round(uptime * 100) +
          '% uptime instead of the ' + Math.round((declared ?? 1) * 100) + '% a neutral build gets.'
        : name + ' is gated ' + gate.text + ', which is the opposite of what ' + who.owner +
          ' wants (' + who.passive + ': ' + who.why + '). Counted at ' + Math.round(uptime * 100) +
          '% uptime instead of ' + Math.round((declared ?? 1) * 100) + '%: you are there for the ' +
          'opening turn and then actively leaving.',
    };
  }

  // ── COVENANTS ─────────────────────────────────────────────────────────────
  // Four covenants, unlocked at level 10 and ranked 1-20. `covenantItems` is
  // four EMPTY objects, so a covenant hands out no stats whatsoever: the only
  // thing that moves the site's own numbers is covenantBonuses, which has a
  // single entry in it. Everything else a covenant gives is an ABILITY - a
  // passive or a move - which is exactly why the slot was left blank on every
  // build the engine has ever produced. Nothing it could measure ever changed.
  //
  // `fit` mirrors CORRUPTION's shape: context in, a score and a reason out. It
  // is only ever a TIE-BREAK (see pickCovenant), so it cannot overturn a real
  // measured gap - Way of Life's outgoing healing still wins on a healer
  // whatever the prose here says.
  const COVENANT_MIN_LEVEL = 10;
  // The engine builds the finished article everywhere else - max gear tier, max
  // weapon tier - so it assumes max covenant rank and states the assumption.
  // Rank matters more here than tier does anywhere: rank 20 is the whole reason
  // to commit to one covenant rather than dabble in it, and every build is
  // written for somebody who has got there.
  const COVENANT_ASSUMED_RANK = 20;
  // Two bosses you cannot HOST without the matching rank 20 blessing. Joining
  // somebody else's fight is still possible, so this is a strong steer with a
  // stated reason rather than a hard rule.
  const COVENANT_BOSS_HOST = {
    'Seraphon': 'Church of Raphion',
    'Arkhaia':  'Cult of Thanasius',
  };

  const COVENANTS = {
    'Cult of Thanasius': {
      blurb: 'The damage covenant: a real attack, an execute, and energy off kills.',
      fit: (c, spec) => {
        const bits = [];
        let score = 40;
        if ((spec && spec.boss) === 'Arkhaia') {
          bits.push('rank 20 is what lets you teleport to and HOST Arkhaia at all - without it ' +
                    'you are waiting on somebody else to open the fight');
          score += 60;
        }
        if (/damage|burst|crit|status/.test(c.goal || '')) {
          score += 25;
          bits.push('Death Curtain is a 6x2 Dark attack scaling on STR/75 AND ARC/75, which is a ' +
                    'real move in a damage rotation rather than a footnote');
        } else {
          bits.push('Death Curtain is measured above alongside the rest of your kit');
        }
        const st = c.stats || {};
        if (st.str && st.arc && Math.min(st.str, st.arc) >= 0.4 * Math.max(st.str, st.arc)) {
          score += 10;
          bits.push('it scales on both Strength and Arcane, and this build carries both');
        }
        bits.push('Soul Absorb outright executes anything under 5% max HP (2.5% on a boss) from ' +
                  'rank 1, and Internal Corruption refunds 2 energy per kill from rank 5');
        return { score, why: bits.join('; ') + '.' };
      },
      unpriced: [
        ['Internal Corruption (r5)',
         '+2 energy every time you kill something, +1 when a summon gets the kill. Not counted: ' +
         'nothing here models a fight running long enough to bank kills.'],
        ['Dark Inversion (r15)',
         'Dark and Hex attacks deal 10% less to you, and any hit over 20% of your max HP gives 1 ' +
         'energy. Not counted: the DR figure above is block damage reduction, which is not ' +
         'element-gated, and folding an element-specific number into it would overstate it ' +
         'against everything that is not Dark or Hex.'],
        ['Arkhaia (r20)',
         'Grants the ability to teleport to and host Arkhaia. Not a number, but it decides ' +
         'whether you can start the fight at all.'],
      ],
    },
    'Church of Raphion': {
      blurb: 'The support covenant: cleanse, a damage-reduction buff and a shield.',
      fit: (c, spec) => {
        const bits = [];
        let score = 30;
        if ((spec && spec.boss) === 'Seraphon') {
          bits.push('rank 20 is what lets you teleport to and HOST Seraphon at all - without it ' +
                    'you are waiting on somebody else to open the fight');
          score += 60;
        }
        if (/tank|heal|party/.test(c.goal || '')) {
          score += 30;
          bits.push('Holy Light is a 5% DR buff, a 4 turn regen and a 20 HP shield scaling on ' +
                    'END/100 - which is what this build is already trying to do');
        }
        if ((spec && spec.play) === 'team') {
          score += 15;
          bits.push('Bless cleanses a teammate and heals them 2% per debuff removed, and ' +
                    'Spreading Grace hands an ally +1 energy off your meditation');
        } else {
          bits.push('most of what it gives points at other people, which is worth much less alone');
        }
        return { score, why: bits.join('; ') + '.' };
      },
      unpriced: [
        ['Supporting Light (r5)',
         'Buffing a target recovers some of your HP and grants damage reduction for 2 turns. ' +
         'Not counted: neither amount is ever stated.'],
        ['Spreading Grace (r15)',
         'Meditating gives one ally +1 energy, and being hit mid-meditation bursts healing across ' +
         'the team. Not counted: the heal has no number and the energy goes to somebody else.'],
        ['Seraphon (r20)',
         'Grants the ability to teleport to and host Seraphon. Not a number, but it decides ' +
         'whether you can start the fight at all.'],
      ],
    },
    'Way of Life': {
      blurb: 'The healer covenant, and the only one whose bonus the site itself counts.',
      fit: c => {
        const bits = ['Lifebound is a flat +15% outgoing healing from rank 5, and it is the ONE ' +
                      'covenant bonus the site scores itself - the healing number above already ' +
                      'includes it'];
        let score = 25;
        if (/heal|party|tank/.test(c.goal || '')) {
          score += 45;
          bits.push('Lesser Heal scales on outgoing healing, so the two compound');
        } else {
          bits.push('outgoing healing does nothing for what this build is being scored on');
        }
        return { score, why: bits.join('; ') + '.' };
      },
      unpriced: [
        ['Graced One (r15)',
         'Lesser Heal heals for more. Not counted: how much more is never stated.'],
        ['Blessing of Life (r20)',
         'Doubles ALL passive regen in a fight, plus 1% every 3s out of combat. Not counted: ' +
         'passive regen is not modelled here at all.'],
        ['Gatherer (r1)',
         'A chance at double ingredients when collecting. Nothing to do with a fight.'],
      ],
    },
    'Blades of the World': {
      blurb: 'The gold covenant. One attack, one death save, and the rest is economy.',
      fit: c => {
        const bits = ['Gilded Strike is a 12 base Holy attack on STR/75, counted above with the ' +
                      'rest of your kit - its GOLD effect does nothing on a boss, but the damage ' +
                      'still lands'];
        let score = 20;
        if (/tank/.test(c.goal || '')) {
          score += 15;
          bits.push('Blessing of Survival at rank 20 is a Mulligan: reaching 0 HP leaves you ' +
                    'alive on 0.1 HP for one more turn, which is worth the grind on a build ' +
                    'whose job is not dying');
        } else {
          bits.push('Blessing of Survival at rank 20 is a Mulligan - one extra turn at 0.1 HP');
        }
        bits.push('everything else is gold, merchant prices and questboard access, which no build ' +
                  'score can see');
        return { score, why: bits.join('; ') + '.' };
      },
      unpriced: [
        ['Blessing of Survival (r20)',
         'Reaching 0 HP leaves you alive at 0.1 HP for one more turn. Not counted: it is worth a ' +
         'great deal on a solo boss attempt and nothing at all on a fight you were never going to ' +
         'lose, and this engine cannot tell those two apart.'],
        ['Avarice (r15)',
         '+30% gold and roughly 30% off the mysterious merchant. Real money, no combat effect.'],
        ['Mercenary (r1)',
         '+50% from guild requests and triple potion rewards. Economy, not combat.'],
      ],
    },
  };

  // ── PROCS ─────────────────────────────────────────────────────────────────
  // Thirteen items state a percentage chance to do something. None of them were
  // counted anywhere, and a chance with a stated number is exactly the kind of
  // thing an engine should be turning into an expected value.
  //
  // The split that matters is whether the game states what HAPPENS on the proc,
  // not just how often. Dust Devil's Eye is the clearest case: "5% chance to
  // proc, hits the target 3 additional times - the extra 3 hits have their own
  // base damage and scaling." The rate is stated and the payload is not, so its
  // expected damage cannot be computed without inventing the missing half. It is
  // reported instead, with that reason attached.
  //
  //   chance    stated probability, 0-1
  //   per       what the chance is rolled against ('hit', 'turn', 'status')
  //   kind      what it grants, when that is priceable, else 'note'
  //   why       for an unpriced proc, what is missing - never left as a shrug
  //   trap      the proc is a NET NEGATIVE and the item is a mistake to wear
  const PROCS = {
    'Chaos Orb': {
      chance: 0.33, per: 'status', kind: 'extraStatus',
      note: 'When you apply a status, 33% chance to apply another random one. Worth more the ' +
            'more statuses your kit applies, and worth nothing on a kit that applies none.',
    },
    "Dust Devil's Eye": {
      chance: 0.05, per: 'hit', kind: 'note',
      why: 'the three extra hits are stated to have "their own base damage and scaling", and ' +
           'the game never says what those are - so the rate is known and the payload is not',
      note: '5% on hit for 3 additional hits. Likely a real damage gain; it cannot be sized here.',
    },
    'Everbeating Drums': {
      chance: 0.20, per: 'hit', kind: 'note',
      why: 'it deals "a portion" of the damage to all enemies and the portion is never stated',
      note: '20% per attack to splash. Nothing for a single target either way.',
    },
    'Vastic Glaive': {
      chance: 0.125, per: 'hit', kind: 'note',
      why: 'the proc picks an effect from your HIGHEST stat, and three of the five branches ' +
           '(bomb damage, the heal, the bugged SPD buff) carry no number',
      note: '12.5% on hit, 16.6% as a Vastayan. On a Luck build the branch is +80% crit chance ' +
            'for one attack, which is the only branch with a figure attached.',
    },
    'Eroded Blade': {
      chance: 0.10, per: 'hit', kind: 'note',
      why: 'energy is only worth damage on moves that spend the whole pool, and how often this ' +
           'lands on one of those depends on a rotation the engine does not simulate',
      note: '10% on hit to steal 1 NRG, at most twice a turn.',
    },
    "Rabbit's Foot": {
      chance: 0.33, per: 'turn', kind: 'note', trap: true,
      why: 'two of its three rolls hurt you',
      note: 'Every turn: 33% for a 5% Luck and Speed boost, 33% for 2 Cursed ON YOURSELF, and ' +
            '33% for 1 Cursed and 1 Hex on yourself. Two rolls in three are a downside, so the ' +
            '+5 Luck and +5 Speed on the sheet is not what you are actually buying.',
    },
    'Spore Root':           { chance: 0.30, per: 'hit', kind: 'note',
      note: '30% to apply 2 Weakened when blocking a melee attack, on top of 2 Poison.' },
    'Sanguine Fang':        { chance: 0.25, per: 'hit', kind: 'note',
      note: '25% on hit to heal 10% of the damage dealt.' },
    'Shattered Clock Hand': { chance: 0.30, per: 'hit', kind: 'note',
      note: '30% on Strike to reduce all your cooldowns.' },
    'Dust Storm':           { chance: 0.10, per: 'hit', kind: 'note',
      note: '10% to phase through an attack entirely.' },
  };

  // Expected extra statuses per turn from a proc like Chaos Orb. The chance is
  // rolled per status applied, so a kit that applies none gets nothing - which
  // is the whole point of measuring it against the kit rather than flat.
  function procStatusGain(gearNames, load) {
    const out = { extraPerTurn: 0, from: [] };
    for (const name of gearNames || []) {
      const p = PROCS[name];
      if (!p || p.kind !== 'extraStatus') continue;
      const gain = (load && load.applying ? 1 : 0) * p.chance;
      if (!gain) continue;
      out.extraPerTurn += gain;
      out.from.push({ name, chance: p.chance, note: p.note });
    }
    return out;
  }

  // `kind: 'bugged'` is a THIRD state, and it exists because the other two both
  // gave the wrong answer.
  //
  //   priced     the engine has a number and can weigh it
  //   note       the engine has no number, so it is reported and never scored -
  //              but it is still assumed to be worth SOMETHING, and the capstone
  //              picker deliberately prefers an unpriced real ability over stat
  //              nodes the build has already been measured not to want
  //   bugged     it does not work in game. Worth nothing, and specifically must
  //              not be picked up by that "unpriced beats stats" fallback, which
  //              is exactly how a Saint was spending 5 of its 35 mastery points
  //              on Piercing Grace.
  const MASTERY_ABILITIES = {
    // ── does not work in game ────────────────────────────────────────────────
    'Piercing Grace':       { kind: 'bugged',
                              note: 'the game says Cursed would only negate 75% of your healing ' +
                                    'instead of 100%. Reported by the site owner as BUGGED and ' +
                                    'non-functional, so it is worth nothing and the 5 points it ' +
                                    'costs go elsewhere. Remove this entry if it is ever fixed.' },

    // ── close to unconditional ───────────────────────────────────────────────
    'Element Mastery':      { kind: 'dmgPct', value: 15, uptime: 0.95,
                              note: '+15% to magic, fire, nature, holy, dark and ice — a caster\'s whole kit' },
    'Cursed Fists':         { kind: 'dmgPct', value: 10, uptime: 1,
                              note: '+10% to all Darkwraith and Darkbeast skills, and +20% crit chance on strikes' },
    'Shadow Master':        { kind: 'dmgPct', value: 30, uptime: 0.5,
                              note: '+30% while invisible — half a rotation for an Assassin' },
    'Oppression':           { kind: 'dmgPct', value: 25, uptime: 0.6,
                              note: '+5% per unique status on the target, capped at 5 — needs them applied first' },
    'Energy Manipulator':   { kind: 'dmgPct', value: 22.5, uptime: 0.6,
                              note: '+3.75% per energy held, +22.5% at 6 — and it reads CURRENT energy, so ' +
                                    'spending on the hit lowers it' },
    'Unending Flow':        { kind: 'dmgPct', value: 50, uptime: 0.45,
                              note: '+5% per consecutive attacking turn to +50%, and a turn without damage resets it' },
    'Blood Mastery':        { kind: 'dmgPct', value: 25, uptime: 0,
                              note: 'currently does nothing — the passive it modifies was reverted' },

    // ── conditional on a status you have to apply ────────────────────────────
    'Overload':             { kind: 'dmgPct', value: 100, uptime: 0.2,
                              note: '+100% against STUNNED enemies only, and bosses resist stun' },
    'Vital Strike':         { kind: 'dmgPct', value: 20, uptime: 0.6,
                              note: '+20% against bleeding targets — reliable once your kit applies Bleed' },
    'Poison Fan Proficiency':      { kind: 'dmgPct', value: 10, uptime: 0.6,
                              note: '+10% against poisoned targets' },
    'Crushing Strike Proficiency': { kind: 'dmgPct', value: 20, uptime: 0.55,
                              note: '+20% against vulnerable or weakened targets' },
    'Lightning Crash Proficiency': { kind: 'dmgPct', value: 20, uptime: 0.5,
                              note: '+20% against burning targets' },
    'Blaze Proficiency':    { kind: 'dmgPct', value: 30, uptime: 0.8,
                              note: '15% always, doubled to 30% against a burning target — and it guarantees the Burn itself' },
    'Carnage Proficiency':  { kind: 'dmgPct', value: 20, uptime: 0.5,
                              note: '+20% against weakened, which the move itself applies, plus 15% while below 40% HP' },
    'Head Splitter Proficiency': { kind: 'dmgPct', value: 30, uptime: 0.35,
                              note: '+30% to low-health targets, and the move becomes full AoE' },
    'Intense Rage':         { kind: 'dmgPct', value: 60, uptime: 0.3,
                              note: '+60% below 30% HP, up from 40% — a real buff you have to nearly die for' },
    'Grand Guard':          { kind: 'dmgPct', value: 10, uptime: 0.7,
                              note: '+10% while at 40% DR or more, which a Citadel usually is' },
    'Cell Charge':          { kind: 'dmgPct', value: 50, uptime: 0.3,
                              note: '+50%, but it charges off 10 blocks or 20 dodges' },
    'Runic Shield':         { kind: 'dmgPct', value: 10, uptime: 0.4,
                              note: '+10% per block, Holy moves only, one turn each' },
    'Blood Eruption Proficiency': { kind: 'dmgPct', value: 20, uptime: 0.6,
                              note: '+20% for 3 turns after the move, and better scaling on it' },

    // ── single-move upgrades: real, but only on that one move ────────────────
    'Holy Crash Proficiency':   { kind: 'dmgPct', value: 25, uptime: 0.3,
                              note: '1.25x, on Holy Crash alone' },
    'Light Burst Proficiency':  { kind: 'dmgPct', value: 30, uptime: 0.3,
                              note: '+30%, on Light Burst alone' },
    'Bloody Burst Proficiency': { kind: 'dmgPct', value: 50, uptime: 0.3,
                              note: '+50% shard damage and a third shard, on Bloody Burst alone' },
    'Flame Drop Proficiency':   { kind: 'dmgPct', value: 25, uptime: 0.3,
                              note: '+25% base, and another 25% off absorbed flame stacks' },
    'Blazing Barrage Proficiency': { kind: 'dmgPct', value: 20, uptime: 0.3,
                              note: '+20% and 2 blinded against a burning target, on that move' },
    'Call Skeleton Proficiency':   { kind: 'dmgPct', value: 30, uptime: 0.4,
                              note: 'free to cast, and your NEXT skeleton gets +30% damage and +50% HP' },
    "Nature's Wrath":       { kind: 'dmgPct', value: 15, uptime: 0.6,
                              note: 'doubles Verdant Archer from 7.5% to 15%' },
    'Rending Barrage Proficiency': { kind: 'dmgPct', value: 25, uptime: 0.5,
                              note: '+2.5% per combined Bleed stack, +25% at 10' },
    'Crucible Proficiency': { kind: 'dmgPct', value: 20, uptime: 0.6,
                              note: 'converts your combined defence buffs into a damage buff for 2 turns' },
    'The Big Sword':        { kind: 'dmgPct', value: 40, uptime: 0.25,
                              note: '+40% Strike damage, greatsword only, plus 7.5% lifesteal that is always on' },
    'Berserkin Time':       { kind: 'dmgPct', value: 15, uptime: 0.5,
                              note: '+15% per Bloodlust stack instead of 10%, and 5% DR per stack up to 80%' },

    // ── crit ─────────────────────────────────────────────────────────────────
    'Dark Smite Proficiency': { kind: 'critChance', value: 50, uptime: 0.3,
                              note: '+50% crit chance on Dark Smite, on top of its base 25%' },
    'Overcore':             { kind: 'note',
                              note: 'at 6 Darkcores your crits are upgraded a whole tier — the biggest ' +
                                    'multiplier in the game, and not modelled here' },

    // ── defensive and utility: real, but not a bigger hit ────────────────────
    'Holy Shield':          { kind: 'dr', value: 15, uptime: 0.4, party: true,
                              note: '+15% true damage resistance while guarding an ally — the whole ' +
                                    'point of it is that somebody else is being protected' },
    'Strategist':           { kind: 'dr', value: 25, uptime: 0.5,
                              note: '+5% DR per negative status on you, which stacks' },
    'High Endurance':       { kind: 'dr', value: 30, uptime: 0.3,
                              note: '+30% DR below 30% HP, and it bypasses DR ignorance' },
    'Prideful Heart':       { kind: 'dr', value: 20, uptime: 0.5, party: true,
                              note: 'Torrefy lets you take another 20% of an ally\'s damage for them — ' +
                                    'worth nothing solo and a great deal in a party' },
    'One For All':          { kind: 'note', party: true,
                              note: '-30% damage for +50% outgoing healing — a deliberate trade in a party ' +
                                    'and a straight loss alone' },
    'Lightspeed':           { kind: 'dodge', value: 100, uptime: 0.5,
                              note: '+10% autododge per dodge or Verdant Archer crit, with NO stack cap — ' +
                                    'it ramps to total avoidance over a long fight. Counted at half, ' +
                                    'because it starts at zero and has to build' },
    'Flourish Proficiency': { kind: 'statFlat', stat: 'spd', value: 23, uptime: 0.65,
                              note: 'Flourish gives a flat 48 Speed instead of 25 — the extra 23 is what ' +
                                    'this mastery is worth, and only while you are in the stance' },
    "Enrichment Proficiency": { kind: 'note', party: true,
                              note: 'the heal also scales on Speed and adds 15% of the target\'s max HP ' +
                                    'per turn — a party heal, worth nothing to your own sheet' },
    'Deep Focus':           { kind: 'note',
                              note: '+25% enchant proc chance — worth real damage on a proc enchant, ' +
                                    'but only as much as that enchant is worth' },
  };

  // ── MOVE OVERRIDES ──────────────────────────────────────────
  // A handful of moves do not use the damage and scaling printed on them. Some
  // masteries REPLACE both outright, and builder.js hard-codes the replacements
  // (builder.js:4462-4479). No multiplier can express that, so these rewrite the
  // move before it is scaled.
  //
  // Everything here was found by verify.js comparing move damage against the
  // live page — which is the whole reason that check now exists.
  //
  //   when(build)  -> is this override live for this build
  //   base/scaling -> what the move actually is when it is
  const MOVE_OVERRIDES = {
    // Blade Dancer rm1: Parry Master. 8 / STR-40 becomes 12 / STR-32.
    'Parry Counter': [{
      when: b => b.klass === 'Blade Dancer (N)' && (b.masteryNodes || []).includes('rm1'),
      base: 12, scaling: 'STR/32',
      note: 'Parry Master rewrites this move: 12 base and STR/32, not 8 and STR/40',
    }],
    // Blade Dancer rm2: Flowing Dance Proficiency changes the scaling stat.
    'Flowing Dance': [{
      when: b => b.klass === 'Blade Dancer (N)' && (b.masteryNodes || []).includes('rm2'),
      scaling: 'SPD/50',
      note: 'Flowing Dance Proficiency rescales it onto Speed at SPD/50',
    }],
    // Arbiter's Mantle: the class rewrites two of its own moves, mastery or not.
    'Strike': [{
      when: b => b.klass === 'Arbiter (N)',
      base: 10, scaling: 'ARC/150',
      note: "Arbiter's Strike is 10 base scaling on Arcane, not the shared 5 on Strength",
    }],
    'Lookout': [{
      when: b => b.klass === 'Arbiter (N)',
      scaling: 'STR/75 + ARC/50',
      note: 'Arbiter adds ARC/50 on top of the printed scaling',
    }],
    // Crucible is three hits with two different shapes: hit 1 at 9 / STR-65, then
    // two more at 3.6 / STR-90 each, and hits 2-3 always land on the Vulnerable
    // hit 1 applies, which is worth a flat 1.20 (builder.js:4530-4540).
    // 2 x 3.6 x 1.20 = 8.64, expressed as one second part on its own scaling.
    'Crucible': [{
      when: () => true,
      base: 9, scaling: 'STR/65',
      second: { base: 8.64, scaling: 'STR/90' },
      note: 'three hits: 9 on STR/65, then two of 3.6 on STR/90, both hitting the ' +
            'Vulnerable that hit 1 applies for a flat 1.20',
    }],
    // Stinger is two attacks in one and its damage string, "5 + 10", parses as
    // nothing at all — so the move was being dropped from the search entirely.
    // Modelled as the two parts summed at their own scalings.
    'Stinger': [{
      when: () => true,
      base: 5, scaling: 'ARC/75',
      second: { base: 10, scaling: 'ARC/70 + SPD/100' },
      note: 'two-part attack: a 5-base stab on ARC/75, then 10-base arrows on ARC/70 + SPD/100',
    }],
  };

  // ── WEAPON PASSIVES ─────────────────────────────────────────
  // Every weapon carries its series' passive, and none of them were counted.
  //
  // The effect: five of the thirteen series roll tier points and are otherwise
  // identical to the model, so the choice between them came down to whichever
  // one bestOfSlot happened to see first. Dragon won 81% of builds. Primordial's
  // flat +20% — the biggest unconditional damage bonus on any weapon in the game
  // — was invisible, and so was Blacksteel's +10% and Darkblood's +10%.
  //
  // Keyed by SERIES, because that is how the passives are written in the game
  // data: `itemPassives['Primordial']`, not `itemPassives['Primordial Spear']`.
  // Same shape as GEAR_PASSIVES otherwise.
  const WEAPON_PASSIVES = {
    'Primordial': { kind: 'dmgPct', value: 20, uptime: 1,
                    note: '+20% damage, unconditional — the largest flat weapon bonus in the game' },
    'Blacksteel': { kind: 'dmgPct', value: 10, uptime: 1,
                    note: '+10% damage, unconditional' },
    'Darkblood':  { kind: 'dmgPct', value: 10, uptime: 1,
                    note: '+10% damage, unconditional, and it reflects statuses back at the attacker' },
    'Blight':     { kind: 'dmgPct', value: 20, uptime: 0.55,
                    note: '+20% against Weakened or Vulnerable, and it applies Cursed while they are' },
    'Icerind':    { kind: 'dmgPct', value: 20, uptime: 0.45,
                    note: '+20% against Cold, which it can apply itself' },
    'Dragon':     { kind: 'dmgPct', value: 15, uptime: 0.45,
                    note: '+15% against Burning' },
    'Corealloy':  { kind: 'dmgPct', value: 15, uptime: 0.5,
                    note: '+5% damage per Energy, read AFTER the move spends it — so a big ' +
                          'dump move gets almost none of it' },
    'Jade':       { kind: 'note',
                    note: '+30% incoming and outgoing healing — excellent on a healer, nothing on a hit' },
    'Sandstone':  { kind: 'note',
                    note: '20% chance to apply 2 Sundered; no damage of its own' },
    'Sun':        { kind: 'note',
                    note: 'defence procs on hit, and the enemy Defense Down half is bugged' },
    'Ferrus':     { kind: 'note', note: 'no passive at all' },
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
    // Greatsword ONLY. The inference read its kit text - "The Big Sword",
    // "Sword Training" - as the `Sword` type and handed every Berserker build a
    // Primordial Sword, which the class cannot equip. "Greatsword" does not
    // match sword, so nothing was going to fix this except saying it.
    // Warrior and Blade Dancer are left to inference: nobody has told me what
    // they can hold, and guessing is how this went wrong in the first place.
    'Berserker (Ch)': ['Greatsword'],
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
    // Whole GEAR series, matched against `gearSeries[series]`, which is a list
    // of names rather than a field on each item - so this resolves differently
    // from weaponSeries above and needs its own key.
    gearSeries: {
      'Easter Gears':          'Easter event gear, and the event has ended',
      'Winter Solstice Gears': 'Winter Solstice event gear, and the event has ended',
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

  // Things that DO exist and work, and that the builder is told not to
  // recommend anyway. Kept apart from UNAVAILABLE on purpose: that table means
  // "the game will not let you", and saying that about an item somebody can
  // equip right now would be a lie in the write-up.
  //
  // It is merged into the same lookup, so an entry here removes the item from
  // every search — gear, armour, artifact, weapon, enchant alike.
  const AVOID = {
    'Shadowy Crook':
      'excluded at the site owner\'s request. It was being handed to 22 of 180 optimised ' +
      'builds on its stat block alone, so this is not a no-op — no reason has been recorded ' +
      'here yet, and one belongs in this entry.',
  };

  // ── QUIRKS ────────────────────────────────────────────────────────────────
  // Item behaviour the data tables do not encode. Each entry registers itself
  // into the model's hooks. `when` decides whether it is live for a build.
  //
  // To add one: give it a name, say which hook it belongs to, and write the
  // maths. Nothing else in the engine needs to know it exists.
  const QUIRKS = [
    {
      name: 'Class and mastery move rewrites',
      hook: 'moveShape',
      note: 'Some masteries replace a move base damage and scaling outright rather than ' +
            'multiplying the result, so this runs before the scaling maths. Registered as a QUIRK ' +
            'rather than wired up in engine.js because QUIRKS are what every consumer of the model ' +
            'already walks — including verify.js, which is the one harness that has to see it.',
      apply: (build, shape) => {
        const rules = MOVE_OVERRIDES[shape && shape.move && shape.move.name];
        if (!rules) return null;
        for (const rule of rules) {
          let live = false;
          try { live = !!rule.when(build); } catch (e) { live = false; }
          if (!live) continue;
          const out = {};
          if (rule.base    !== undefined) out.base    = rule.base;
          if (rule.hits    !== undefined) out.hits    = rule.hits;
          if (rule.scaling !== undefined) out.scaling = rule.scaling;
          out._second = rule.second || null;
          // Why the move changed, in words. Without this the write-up can say
          // the numbers moved but not what moved them.
          out.note = rule.note || null;
          return out;
        }
        return null;
      },
    },
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

  // How long it actually takes to bank 100 Corrupt Energy and enter a form.
  // Reported from play, not from anything the game states — the game gives the
  // cost, never the rate.
  //
  // This is the single most important number about corruption and it was
  // missing: every in-form figure below is a state you reach around turn seven,
  // not an opener. A fight that ends sooner is a fight where the form never
  // happened at all, and the out-of-form rotation is the only one that ran.
  const CORRUPTION_ENTRY_TURNS = 7;

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
          steps: [{ move: 'Soul Ignition', turns: CORRUPTION_ENTRY_TURNS,
                    note: 'Bank 100 Corrupt Energy, then spend it to enter the form. About ' +
                          CORRUPTION_ENTRY_TURNS + ' turns.' }],
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
          { move: 'Soul Ignition', turns: CORRUPTION_ENTRY_TURNS,
            note: 'Bank 100 Corrupt Energy, then spend it to enter the form. About ' +
                  CORRUPTION_ENTRY_TURNS + ' turns.' },
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
          { move: 'Soul Ignition', turns: CORRUPTION_ENTRY_TURNS,
            note: 'Bank 100 Corrupt Energy, then spend it to enter the form. About ' +
                  CORRUPTION_ENTRY_TURNS + ' turns. You start in Dark Wing.' },
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
          { move: 'Soul Ignition', turns: CORRUPTION_ENTRY_TURNS,
            note: 'Bank 100 Corrupt Energy, then spend it to enter the form. About ' +
                  CORRUPTION_ENTRY_TURNS + ' turns. You start in Tyrant.' },
          { move: 'Strike / Magic Missile', note: 'Marks the target as your Subject. Only one at a time.' },
          { move: 'Trade damage', note: 'Mandate builds on your Subject as you trade with it. The first 2 ' +
                                        'stacks are guaranteed; past that it is a roll that improves with Corrupt Power.' },
          { move: 'Meditate', note: 'Swaps your stance and harvests all Mandate on your Subject into your own ' +
                                    'pool — the only pool your abilities spend from.' },
          { move: 'Any 2+ energy move', note: 'Spends 1 Mandate to apply or refresh Condemned on the target.' },
        ] : [
          { move: 'Soul Ignition', turns: CORRUPTION_ENTRY_TURNS,
            note: 'Bank 100 Corrupt Energy, then spend it to enter the form. About ' +
                  CORRUPTION_ENTRY_TURNS + ' turns.' },
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
      // Asking for a superclass below level 15 is honoured — you may well be
      // planning ahead — but it is not a build you can equip today, and saying
      // nothing would let somebody spend an evening building it first.
      name: 'Class not unlocked yet',
      when: (b, M) => {
        const tree = (M.data.classes || {});
        const isSuper = Object.values(tree).flat().includes(b.klass);
        return isSuper && (b.level || 0) < 15;
      },
      warn: 'This class needs level 15 and the build is set below that. Everything here is still ' +
            'correct for the level you gave, but you cannot take the class itself until 15.',
    },
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
           CLASS_ROLE, classRole,
           ROLES, roleOf, ROLE_ITEMS, roleItemNote, ROLE_ITEM_MARGIN, SCROLL_NOTES,
           ROLE_GOALS, ROLE_ORDER, goalsForRoles, goalWeights,
           MILESTONES, milestonesFor, GEAR_NEEDS, gearNeedNote, gearNeedIsCaution,
           UNAVAILABLE, AVOID, MASTERY_ABILITIES, MASTERY_ABILITY_DEFAULT_UPTIME, MOVE_OVERRIDES,
           WEAPON_PASSIVES,
           PARTY_SIZE, PARTY_SPREAD, PLAY_STYLES, DAMAGE_MODELS, SUPERCLASS_MIN_LEVEL,
           BOSS_TACTICS, BOSS_PENALTIES, BOSS_SOLO_MIN_SPEED, STATUS_WORDS,
           bossProfile, debuffLoad, statusLoad, PROCS, procStatusGain,
           ARTIFACT_ABILITIES,
           COVENANTS, COVENANT_MIN_LEVEL, COVENANT_ASSUMED_RANK, COVENANT_BOSS_HOST,
           HP_STANCE, HP_GATED, HP_GATE_UPTIME, hpStance, hpGateFor,
           ENERGY, TRAITS, PASSIVES, GEAR_PASSIVES, RACE_ROLES, GOAL_RACE_ROLES, RACE_TECH,
           SETUP_MOVES,
           SHARDS, SHARD_SLOTS, ENCHANTS,
           QUIRKS, CORRUPTION, CORRUPTION_DAMAGE, CORRUPTION_ASSUMED,
           CORRUPTION_ENTRY_TURNS, TRAPS };
}));
