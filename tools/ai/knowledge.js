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
      minmax: ['minmax', 'min max', 'min-max', 'optimal', 'optimised', 'optimized', 'best', 'strongest', 'perfect'],
      pvp:    ['pvp', 'player vs player', 'duel', 'arena'],
      pve:    ['pve', 'boss', 'bosses', 'raid', 'grinding', 'farm', 'farming'],
      budget: ['cheap', 'budget', 'early', 'starter', 'low level', 'lowlevel', 'f2p', 'new'],
    },
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
      score: c => c.bestHit,
      blurb: 'Every point that does not raise damage is a wasted point.',
    },
    burst: {
      label: 'Biggest single hit',
      statWeights: { str: 3, arc: 3, lck: 4, spd: 1, end: 0 },
      kitWords: ['damage','execute','massive','heavy','charge','empowered'],
      score: c => c.bestHit,
      blurb: 'Optimised for the largest single number, not sustained output.',
    },
    crit: {
      label: 'Crit / overcrit',
      statWeights: { lck: 5, str: 2, arc: 2, spd: 1, end: 0 },
      kitWords: ['crit','critical','precise','lethal','assassinate'],
      // Crit tiers are steps, so reward landing ON a threshold rather than near it.
      score: c => c.bestHit * (1 + 0.05 * c.critTier),
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
      score: c => c.bestHit * 0.6 + c.hp * 0.8,
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
      note: 'Stultus converts Speed to Crit Chance at 10 SPD = 1, capped at +100.',
      apply: (build, val, ctx) =>
        build.race === 'Stultus (20%)' ? val + Math.min(100, Math.floor(ctx.stats.spd / 10)) : val,
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

  return { VOCAB, ARCHETYPES, DEFAULT_GOAL, GOAL_PRIORITY, CLASS_WEAPONS,
           ENERGY, TRAITS, PASSIVES, QUIRKS, CORRUPTION, TRAPS };
}));
