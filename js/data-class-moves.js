// § CLASS MOVES DB
// Move and passive definitions for every class, keyed by class name.
// Each entry: { innatePassives: [...], learns: [{ slot, level, type, name, ... }] }
// Innate passives are always active; learned moves are gated by slot/level.
// To add a class entry: "ClassName": { innatePassives: [], learns: [] }
//
// Class tree quick-reference:
//   Thief     → Ranger (Or), Rogue (N), Assassin (Ch)
//   Warrior   → Paladin (Or), Blade Dancer (N), Berserker (Ch)
//   Wizard    → Elementalist (Or), Hexer (N), Necromancer (Ch)
//   Martial Artist → Monk (Or), Brawler (N), Darkwraith (Ch)
//   Slayer    → Saint (Or), Lancer (N), Impaler (Ch)
//   Marauder  → Lionheart (N)
//   Sentry    → Citadel (Or), Arbiter (N)
//   Sub-classes: Bard, Beastmaster, Alchemist, Blacksmith, Miner
const classMoves = {

  // ── THIEF TREE ────────────────────────────────────────────────────────────
  "Thief": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 5,
        type: "Passive",
        name: "Thievery",
        quote: "",
        effect: "Gold gain from all sources is increased."
      },
      {
        slot: "2nd Learn",
        level: 5,
        type: "Passive",
        name: "Agile",
        quote: "",
        effect: "Sprint speed is increased."
      },
      {
        slot: "3rd Learn",
        level: 5,
        type: "Active",
        name: "Stab",
        quote: "Stab deep into the enemy.",
        cost: 1,
        cooldown: 2,
        moveType: "Physical",
        category: "Attack",
        damage: 6,
        scaling: "STR/75",
        effect: "Stab deep into the enemy, inflict 2 stacks of Bleed. This has a 40% extra chance to crit.",
        image: "https://trello.com/1/cards/67b3291ea782e28bbc86acf6/attachments/69788fa838e26d910277122c/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127151243.png"
      },
      {
        slot: "4th Learn",
        level: 5,
        type: "Active",
        name: "Pocket Sand",
        quote: "Grab and throw sand into the enemy's eyes.",
        cost: 2,
        cooldown: 3,
        moveType: "Physical",
        category: "Attack",
        damage: 8,
        scaling: "STR/75",
        effect: "Grab and throw sand into the enemy's eyes, inflict 2 stacks of Blind.",
        image: "https://trello.com/1/cards/67b3291ea782e28bbc86acf6/attachments/69788fa731f165ba13304300/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127151225.png"
      }
    ]
  },
  "Ranger (Or)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Passive",
        name: "Verdant Archer",
        quote: "Become one with the winds, get a damage and speed buff on every dodge. Also makes strike scale with arcane.",
        effect: "Grants the user a flat +10 Speed buff and +7.5% Damage buff for 2 turns whenever they crit or dodge. Strike now scales with the Arcane stat. This passive can also be triggered by summons' crits."
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Active",
        name: "Flourish",
        quote: "Charge up energy into your bow, and after a turn fire off a spread of arrows.",
        cost: 2,
        cooldown: 6,
        moveType: "Nature",
        category: "Attack",
        damage: 11,
        scaling: "ARC/60 + SPD/80",
        effect: "Provides a flat 25 speed and 25% defense buff while in this stance, also increases the chances of enemies to hit you (currently bugged).\n\nYou attack on your next turn, not the turn the move was initially used on."
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Active",
        name: "Perennial Canopy",
        quote: "Raise your bow into the air and create a downpour of arrows for a duration.",
        cost: 2,
        cooldown: 7,
        moveType: "Nature",
        category: "Attack",
        damage: 4,
        scaling: "ARC/70 + SPD/100",
        effect: "This move lasts for 4 turns, dealing damage on every turn except the turn it was casted."
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Active",
        name: "Stinger",
        quote: "Thrust your dagger into the enemy, then backflip and fire three coated arrows.",
        cost: 2,
        cooldown: 4,
        moveType: "Poison",
        category: "Attack",
        damage: "5 + 10",
        scaling: "ARC/70 + SPD/100",
        effect: "The opening stab is considered a strike (Melee, Single-target, Physical, ARC/75 scaling). The second part hits adjacent enemies for the same damage and can execute.\n\nApplies 2 poison and 2 vulnerable to the main target."
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Active",
        name: "Enrichment",
        quote: "Bless your target with the rejuvenating forces of nature.",
        cost: 1,
        cooldown: 5,
        moveType: "Nature",
        category: "Utility",
        duration: 3,
        scaling: "ARC/?",
        effect: "Heals the target and increases regen by 2.5% of their max health. Also gives the target the Verdant Archer passive for the duration unless the move is used on another Ranger."
      }
    ]
  },
  "Rogue (N)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Active",
        name: "Poison Trap",
        quote: "",
        cost: 1,
        cooldown: 7,
        moveType: "Poison",
        category: "Utility",
        damage: 5,
        scaling: "SPD/40 + LCK/30",
        effect: "Place down a trap that triggers if an enemy attempts to use a melee attack, inflicting 4 poison.",
        image: "https://trello.com/1/cards/67b32950fc6607f34e915105/attachments/69803cecc61533e927661e28/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202105727.png"
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Active",
        name: "Dagger Spread",
        quote: "",
        cost: 2,
        cooldown: 5,
        moveType: "Physical",
        category: "Attack",
        damage: 10,
        scaling: "STR/65",
        effect: "Full AOE damage, hits all enemies."
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Passive",
        name: "Blader",
        quote: "",
        effect: "You deal 20% extra damage and have a (?) chance to apply bleed on your attacks (insanely low).",
        image: "https://trello.com/1/cards/67b32950fc6607f34e915105/attachments/69803ceef21339e53a69e1b9/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202105703.png"
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Passive",
        name: "Advanced Thief",
        quote: "",
        effect: "You gain extra gold and drops from fights."
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Active",
        name: "Slash Barrage",
        quote: "",
        cost: 2,
        cooldown: 5,
        moveType: "Physical",
        category: "Attack",
        damage: 15,
        scaling: "STR/85",
        effect: "Deals 30% more damage if the enemy is bleeding.",
        image: "https://trello.com/1/cards/67b32950fc6607f34e915105/attachments/69803cead7b17c27b5bb2103/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202105745.png"
      }
    ]
  },
  "Assassin (Ch)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Passive",
        name: "Shadow",
        quote: "",
        effect: "You have a 15%(?) chance to phase through attacks, negating all damage. You still receive any debuffs that were applied."
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Active",
        name: "Shadow Form",
        quote: "",
        cost: 1,
        cooldown: 7,
        moveType: "Dark",
        category: "Buff",
        duration: 3,
        effect: "Applies Invisible to the user for 3 turns. An invisible player cannot be targeted or take damage (excluding DoT and true damage such as Oblivion). Attacking before Invisible times out removes it — that attack deals 20% more damage and has ~20% more critical chance. Immolation counts as an attack.",
        image: "https://trello.com/1/cards/67b32956205bcc638e52a56b/attachments/69800f93f31d8a2338ef8b73/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202074343.png"
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Passive",
        name: "Poisoner",
        quote: "",
        effect: "Critical attacks apply 5 Poison on hit."
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Active",
        name: "Poison Fan",
        quote: "",
        cost: 2,
        cooldown: 5,
        moveType: "Poison",
        category: "Attack",
        damage: "3.5x4",
        scaling: "STR/200 + ARC/80 + LCK/100",
        effect: "Applies 5 guaranteed Poison on the last hit.",
        image: "https://trello.com/1/cards/67b32956205bcc638e52a56b/attachments/69800f929957e45d84b99a74/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202074403.png"
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Active",
        name: "Stealth Strike",
        quote: "",
        cost: 2,
        cooldown: 6,
        moveType: "Physical",
        category: "Attack",
        damage: 10,
        scaling: "STR/75",
        effect: "Increases damage dealt by 100% if invisible while attacking. Applies 2 Cursed if the target is poisoned.",
        image: "https://trello.com/1/cards/67b32956205bcc638e52a56b/attachments/69800f95a11c466dc31c150c/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202074318.png"
      }
    ]
  },

  // ── WARRIOR TREE ──────────────────────────────────────────────────────────
  "Warrior": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 5,
        type: "Active",
        name: "Double Slash",
        quote: "",
        cost: 2,
        cooldown: 4,
        moveType: "Physical",
        category: "Attack",
        damage: "5x2",
        scaling: "STR/75",
        effect: "N/A",
        image: "https://trello.com/1/cards/67b313126e03446ff0cdf04e/attachments/6978910ad0e2fa3f890407d4/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127151804.png"
      },
      {
        slot: "2nd Learn",
        level: 5,
        type: "Active",
        name: "Pommel Strike",
        quote: "",
        cost: 1,
        cooldown: 3,
        moveType: "Physical",
        category: "Attack",
        damage: 7,
        scaling: "STR/75",
        effect: "Chance to inflict 1 stack of Stun.",
        image: "https://trello.com/1/cards/67b313126e03446ff0cdf04e/attachments/6978910c094973ea6a4e797e/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127151832.png"
      },
      {
        slot: "3rd Learn",
        level: 5,
        type: "Passive",
        name: "Strength Training",
        quote: "",
        effect: "Block bar size is increased."
      },
      {
        slot: "4th Learn",
        level: 5,
        type: "Passive",
        name: "Sword Training",
        quote: "",
        effect: "Damage dealt with sword weapons is increased by 10%."
      }
    ]
  },
  "Paladin (Or)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Active",
        name: "Sacred Call",
        quote: "Call upon grace, buffing an ally with rotating swords of light. Grants a mulligan to the target for the duration.",
        cost: 2,
        cooldown: 7,
        moveType: "Holy",
        category: "Buff",
        duration: 3,
        effect: "Increases the target's damage by 10% and defense by 10%, applies 2 Resist and grants 10 Thorns. Grants a mulligan (currently bugged). Damage/defense buff lasts only 2 turns if used on yourself. Thorns currently last permanently.",
        image: "https://trello.com/1/cards/67b3293ad5daa6959942a4cf/attachments/69803e0aa848e68718ed62dd/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202110206.png"
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Active",
        name: "Pure Resonance",
        quote: "Call upon your faith and empower you and your allies.",
        cost: 2,
        cooldown: 6,
        moveType: "Holy",
        category: "Buff",
        duration: 3,
        damage: 15,
        scaling: "STR/100 + END/100",
        effect: "Provides all allies a 20% damage resistance buff and 2.5% of the target's max HP as a regen buff. Applies 3 Weakened. (Difficulty: 6 bars at base)",
        image: "https://trello.com/1/cards/67b3293ad5daa6959942a4cf/attachments/69803e08ace609edb4662958/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202110148.png"
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Passive",
        name: "Enduring Fighter",
        quote: "Take less damage and gain some health regen.",
        effect: "Provides a permanent 15% damage resistance buff and grants +2 base regen. (Requires rejoining the game to take effect if just obtained.)"
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Active",
        name: "Holy Crash",
        quote: "Condense holy energy into your blade, striking it down upon your foes with a large explosion. Causes enemies to aggro onto you for a short time.",
        cost: 2,
        cooldown: 4,
        moveType: "Holy",
        category: "Attack",
        damage: 13,
        scaling: "STR/75 + END/100",
        effect: "Deals full AOE damage. Applies 3 turns of Taunt onto the main target. Has a 50% chance to apply 2 Taunt to adjacent targets. (Difficulty: 6 bars at base)",
        image: "https://trello.com/1/cards/67b3293ad5daa6959942a4cf/attachments/69803e0d0cd179680a4400b4/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202110223.png"
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Passive",
        name: "Shield Training",
        quote: "Block better at the cost of moving slower. Guarding causes you to absorb damage from your teammates.",
        effect: "Guarding reduces the damage the next ally takes by 50%. A small portion of that damage is redirected to you. Any effects your shield can apply on block will also apply when taking damage while guarding for a teammate. (Not required to equip a shield.)"
      },
      {
        slot: "6th Learn",
        level: 25,
        type: "Passive",
        name: "Protector",
        quote: "Guarding now lets you choose a player to guard, taking the damage of the attack. Choosing yourself guards normally.",
        effect: "Guarding now lets you choose a player to guard, taking the full damage of attacks targeting them. Choosing yourself functions as a normal guard."
      }
    ]
  },
  "Blade Dancer (N)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 17,
        type: "Active",
        name: "Simple Domain",
        quote: "Take a stance for a turn, if attacked during this then retaliate with incredible power.",
        cost: 2,
        cooldown: 6,
        moveType: "Physical",
        category: "Buff",
        damage: "min(X,25)*1.6",
        scaling: "STR/60",
        effect: "Denies an attack if it is targeted at you and instead attacks back. X is equal to the BaseDMG of whatever move you countered, capped at 25.\n\nSelf-Target | Unblockable and Undodgeable"
      },
      {
        slot: "2nd Learn",
        level: 15,
        type: "Passive",
        name: "Dual Blader",
        quote: "Allows you to dual wield blades, and makes you more proficient with them.",
        effect: "You now deal 15% more damage and additionally now have a second sword visually (doesn't work with blightrock or icerind swords)."
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Active",
        name: "Flowing Dance",
        quote: "Leap at your foe, spinning with your blades to create a devastating vortex, end it with a heavy strike.",
        cost: 3,
        cooldown: 6,
        moveType: "Physical",
        category: "Attack",
        damage: "1.75x12",
        scaling: "STR/75 + SPD/75",
        effect: "The \"heavy strike\" does not exist.\n\nSingle-Target | Melee | Unblockable and Undodgeable"
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Passive",
        name: "Parry Training",
        quote: "Gives you the ability to 'Parry' attacks occasionally when you block.",
        effect: "Now guaranteed on block regardless of mastery. Can trigger multiple times on a single attack and works whilst guarding. Only affects melee attacks and cannot crit or trigger any special effects.\n\nParry counter: 8 Base DMG + STR/40 scaling.\n\nParry Master (rm1 mastery node): upgrades counter to 12 Base DMG + STR/32 scaling."
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Active",
        name: "Parry Counter",
        quote: "",
        cost: 0,
        cooldown: 0,
        moveType: "Physical",
        category: "Attack",
        damage: 8,
        scaling: "STR/40",
        effect: "Triggered automatically on block. Cannot crit or trigger special effects.\n\nParry Master (rm1): upgrades to 12 Base DMG + STR/32."
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Active",
        name: "Impaling Strike",
        quote: "Strike both of your blades into your foe, inflicting bleed.",
        cost: 1,
        cooldown: 4,
        moveType: "Physical",
        category: "Attack",
        damage: 14,
        scaling: "STR/80",
        effect: "Applies 2 bleed on hit. This move has a 20% higher chance to critically hit.\n\nSingle-Target | Melee | Blockable and Dodgeable"
      }
    ]
  },
  "Berserker (Ch)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Passive",
        name: "Heavy Training",
        quote: "Lets you wield a greatsword.",
        effect: "Grants you the ability to buy the Greatsword weapon in deeproot caverns. This passive is not needed to equip any Greatsword.\n\nGreatsword type weapons grant the user 20% more strike damage; you do not need this passive for that bonus."
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Active",
        name: "Carnage",
        quote: "Consume all your energy and strike the ground with your greatsword, causing slices that scale off X consumed energy to form all around you. Inflicts sundered at 6 energy consumed.",
        cost: "3+X",
        cooldown: 7,
        moveType: "Dark",
        category: "Attack",
        damage: "1x20",
        scaling: "STR/100",
        effect: "Consumes all current energy to increase damage by 20% per energy consumed past 1 energy.\n\nApplies 3 sunder on the last hit if you are at max energy.\n\nEnemy-Wide | Melee | Sure Hit",
        energyScaling: { perEnergy: 20, past: 1 }
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Passive",
        name: "Bloodlust",
        quote: "Berserk harder as you continually get close to falling (with a cooldown). Additionally deal 40% more dmg while low hp.",
        effect: "When you go under 50% hp or take damage while under 50% hp, gain a 20% Bloodlust stack and enter a bloodlust state (triggers once, 2 turn cooldown).\n\nEach additional Bloodlust stack from taking damage while below 50% grants +10% damage, up to 8 stacks total (including the first 20% stack). Beyond 8 stacks damage is capped at a 65% buff and no more stacks can be gained. Bloodlust stacks additively.\n\nWhen you go below 30% hp, gain a permanent 40% damage buff (multiplicative with Bloodlust stacks). This buff is lost when you go above 30% hp; Bloodlust stacks remain regardless of health."
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Active",
        name: "Head Splitter",
        quote: "Leap into the air and crash your greatsword down with destructive power, deals extreme damage to an enemy and applies 2 vulnerable.",
        cost: 2,
        cooldown: 5,
        moveType: "Physical",
        category: "Attack",
        damage: 16,
        scaling: "STR/50",
        effect: "Grants a 10% damage buff for 1 turn. Bypasses 50% of an enemy's resistances. Applies 2 vulnerable.\n\nSingle-target | Melee | Sure Hit"
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Active",
        name: "Rage Empower",
        quote: "Sacrifice a portion of your sanity to enter a state of pure rage, increasing offensive power while decreasing defensive power.",
        cost: 1,
        cooldown: 5,
        moveType: "Physical",
        category: "Buff",
        duration: 2,
        effect: "Grants a 30% damage buff. If you are above 35% HP, decreases your HP down to 35% and grants up to a 65% damage buff based on HP consumed (full 65% if 65% of max HP is consumed).\n\nThis move triggers external effects (e.g. Bloodlust, Estella's Enduring Fighter). Grants 40% DR for the duration.\n\nSelf-target | Utility"
      }
    ]
  },

  // ── WIZARD TREE ───────────────────────────────────────────────────────────
  "Wizard": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 1,
        type: "Active",
        name: "Magic Missile",
        quote: "This move's color is based off of your Soul color.",
        cost: 0,
        cooldown: 0,
        moveType: "Magic",
        category: "Attack",
        damage: 6,
        scaling: "ARC/75",
        effect: "This move's color is based off of your Soul color.",
        image: "https://trello.com/1/cards/67b329148ff39af63b3fbcac/attachments/6978918128d41bbe9c39047a/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127152033.png"
      },
      {
        slot: "2nd Learn",
        level: 1,
        type: "Passive",
        name: "Scholar Training",
        quote: "",
        effect: "Damage dealt with Staves is increased by 5%."
      },
      {
        slot: "3rd Learn",
        level: 1,
        type: "Passive",
        name: "Coward",
        quote: "",
        effect: "Gives less aggro. Chance for enemies to target you is lesser, and increased chance to escape."
      }
    ]
  },
  "Elementalist (Or)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Active",
        name: "Blaze",
        quote: "Fire off a burst of fire towards an enemy, if they are burning the fire explodes.",
        cost: 1,
        cooldown: 5,
        moveType: "Fire",
        category: "Attack",
        damage: 10,
        scaling: "ARC/70",
        effect: "Deals 25% more damage against burning opponents (no visual indicator). Applies either 3 or 6 burning onto the opponent. Hits the main target and adjacent enemies (non-lethal to adjacent).",
        image: "https://trello.com/1/cards/67b32945a9f9561ed5168d6b/attachments/697fc3d78cec4dd1a9d85d91/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202022001.png"
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Active",
        name: "Gale Uplift",
        quote: "A team wind buff that increases the speed stat of allies and gives them a chance to auto dodge attacks, and lowers the chance for the enemy to block and dodge.",
        cost: 2,
        cooldown: 12,
        moveType: "Nature",
        category: "Buff",
        duration: 3,
        damage: "5x2",
        scaling: "ARC/75",
        effect: "Grants a buff that makes all moves trigger the block/dodge QTE for both blockable and dodgeable attacks. Also grants a flat +32 speed buff to all allies for the duration.",
        image: "https://trello.com/1/cards/67b32945a9f9561ed5168d6b/attachments/697fc3d5dc683a13782a00ed/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202022020.png"
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Passive",
        name: "Caster",
        quote: "Chance to get more energy per turn.",
        effect: "Grants a (?)% chance to gain extra energy each turn."
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Active",
        name: "Lightning Crash",
        quote: "Call down bolts of lightning on all your enemies, has a chance to apply stun.",
        cost: "3+X",
        cooldown: 9,
        moveType: "Magic",
        category: "Attack",
        damage: 18,
        scaling: "ARC/45",
        effect: "Consumes all energy; for each energy consumed over 3, this move gains a 12.5% damage buff. Fully AoE, has a chance to apply 1 Stun to each opponent.",
        energyScaling: { perEnergy: 12.5, past: 3 },
        image: "https://trello.com/1/cards/67b32945a9f9561ed5168d6b/attachments/697fc3d4b7830acd7f2af61b/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202022104.png"
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Passive",
        name: "Elemental Master",
        quote: "Take less elemental damage.",
        effect: "Deal 20% more damage with fire, magic, nature, and dark type attacks. Take 25% less damage from fire, magic, nature, dark, holy, hex, and ice type attacks."
      }
    ]
  },
  "Hexer (N)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Passive",
        name: "Tactician",
        quote: "Starts fight with preparation.",
        effect: "Applies 3 vulnerable and 3 weakened to all opposing enemies at the start of the fight (not on your turn)."
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Passive",
        name: "Inverse Flaws",
        quote: "Gain benefits from being debuffed.",
        effect: "Every time you are hit with a status effect you do not currently have, you heal 2% of your HP (scaling with ARC/100) and gain a 5% defense buff for 1 turn. The defense buff applies to whatever attack applied the status effect."
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Active",
        name: "Inverse Abyss",
        quote: "Cast a delayed trap on the battlefield, if you or your allies are inflicted by an enemy's debuff then reflect it to the entire enemy team.",
        cost: 3,
        cooldown: 6,
        moveType: "Hex",
        category: "Utility",
        scaling: "ARC/65",
        effect: "Casts a team-wide protective field that reflects debuffs back at the entire enemy team. Can be activated X times (X = ARC/65). Each reflected application has its stack count multiplied by 3. Statuses enemies are immune to will not be applied.",
        image: "https://trello.com/1/cards/67b32947bf827cc8c6bbb632/attachments/6980106e29482df113ca54ad/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202074707.png"
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Active",
        name: "Abyss Anchor",
        quote: "Anchor down a foe with black chains, disabling their passive energy gain for a couple turns and subtracting energy from the afflicted.",
        cost: 2,
        cooldown: 5,
        moveType: "Hex",
        category: "Utility",
        effect: "Consumes all of a single target's energy and disables their energy gain for 1 of that enemy's turns. The energy negation has a 12-turn cooldown after it ends. Energy can still be stolen while the negation is on cooldown and will not extend it.",
        image: "https://trello.com/1/cards/67b32947bf827cc8c6bbb632/attachments/698010700aed38adada54b69/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202074730.png"
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Active",
        name: "Dark Glare",
        quote: "Glare into your foe's soul with pure darkness, inflicting them with a variety of debuffs.",
        cost: 2,
        cooldown: 4,
        moveType: "Dark",
        category: "Attack",
        damage: 11,
        scaling: "ARC/75",
        effect: "Applies 3 vulnerable, 2 blinded, 2 weakened, and 1 hex onto the target on hit.",
        image: "https://trello.com/1/cards/67b32947bf827cc8c6bbb632/attachments/6980107204151c013011c4ec/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202074751.png"
      }
    ]
  },
  "Necromancer (Ch)": {
    innatePassives: [
      {
        level: 15,
        name: "???",
        description: "Necromancer Summons Cap increased to 4 summons at the same time."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Passive",
        name: "Death Siphon",
        quote: "",
        effect: "Heal 8–10% (?) of max HP when an ally or summon dies."
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Active",
        name: "Raise Dead",
        quote: "",
        cost: 3,
        cooldown: 16,
        moveType: "Dark",
        category: "Utility",
        effect: "Resurrect a bleeding out (dead) ally and heal them to 60% HP. The revived ally will have a Stun effect for 1 turn.",
        image: "https://trello.com/1/cards/67b3294b205bcc638e528caa/attachments/69805412a5b3714e3740981d/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202114119.png"
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Active",
        name: "Darklight Drain",
        quote: "",
        cost: 2,
        cooldown: 5,
        moveType: "Dark",
        category: "Attack",
        damage: 8,
        scaling: "ARC/75",
        effect: "Heal yourself for 80% of damage dealt. Heal summons for ~140% of damage dealt. Each use permanently grants current summons a 5% damage boost, stacking twice (10% total).",
        image: "https://trello.com/1/cards/67b3294b205bcc638e528caa/attachments/6980540e173d7ec6901f5614/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202113859.png"
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Active",
        name: "Call Skeleton",
        quote: "",
        cost: 1,
        cooldown: 5,
        moveType: "Dark",
        category: "Utility",
        scaling: "ARC/4",
        effect: "Summons a Skeleton with 60 base HP.",
        image: "https://trello.com/1/cards/67b3294b205bcc638e528caa/attachments/69805411bda66bf0d6f17341/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202113956.png"
      },
      {
        slot: "Skeleton",
        level: 21,
        type: "Active",
        name: "Smack",
        quote: "???",
        cost: 0,
        cooldown: 0,
        moveType: "Physical",
        damage: 14,
        scaling: "ARC/50",
        effect: "Just usual smack.",
        image: "https://trello.com/1/cards/67b3294b205bcc638e528caa/attachments/6980601856a256810cb7255f/download/smack.png"
      },
      {
        slot: "Skeleton",
        level: 21,
        type: "Active",
        name: "Bone Spray",
        quote: "Create a barrage of bones and fire them at all enemies.",
        cost: 2,
        cooldown: 4,
        moveType: "Physical",
        damage: 20,
        scaling: "ARC/50",
        effect: "This attack is fully AoE.",
        image: "https://trello.com/1/cards/67b3294b205bcc638e528caa/attachments/6980601a9128e5ad830b7e2f/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202132757.png"
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Passive",
        name: "Dark Caster",
        quote: "",
        effect: "You have a (?) chance to gain energy every turn."
      }
    ]
  },

  // ── MARTIAL ARTIST TREE ───────────────────────────────────────────────────
  "Martial Artist": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 1,
        type: "Passive",
        name: "Iron Body",
        quote: "",
        effect: "Take less chip damage from blocking."
      },
      {
        slot: "2nd Learn",
        level: 1,
        type: "Passive",
        name: "Fighting Prowess",
        quote: "",
        effect: "Damage dealt with Cestus weapons is increased by 15%."
      },
      {
        slot: "3rd Learn",
        level: 1,
        type: "Active",
        name: "Endure",
        quote: "",
        cost: 1,
        cooldown: 5,
        moveType: "Physical",
        category: "Buff",
        duration: 2,
        effect: "Give 25% damage reduction (currently bugged).",
        image: "https://trello.com/1/cards/67b329231474989834733609/attachments/697890453382b4f5fe403083/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127151513.png"
      },
      {
        slot: "4th Learn",
        level: 1,
        type: "Active",
        name: "Barrage",
        quote: "",
        cost: 2,
        cooldown: 5,
        moveType: "Physical",
        category: "Attack",
        damage: "3.3 x 3",
        scaling: "STR/75",
        effect: "N/A",
        image: "https://trello.com/1/cards/67b329231474989834733609/attachments/69789043336bb5e20a8058b5/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127151513.png"
      }
    ]
  },
  "Monk (Or)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Passive",
        name: "Blessed Fists",
        quote: "",
        effect: "Blocking an attack makes you take (?) less damage. You also regenerate (?) more health every turn."
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Active",
        name: "Fire Sutra",
        quote: "",
        cost: 1,
        cooldown: 6,
        moveType: "Fire",
        category: "Buff",
        duration: 4,
        effect: "You or the ally you chose gains a chance to apply burn alongside a 15% damage buff.\n\nFlaming Overdrive: gives a chance to apply Ghostflame.",
        image: "https://trello.com/1/cards/67b329593631658cda777210/attachments/6980579bdc383e6a208e211a/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202123330.png"
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Active",
        name: "Holy Mantra",
        quote: "",
        cost: 2,
        cooldown: 6,
        moveType: "Holy",
        category: "Buff",
        duration: 4,
        effect: "You or the ally you chose gains 2 resist stacks and a defense boost.\n\nFlaming Overdrive: cleanses basic debuffs (like Bless would), and gives a chance to apply Sundered on attacks.",
        image: "https://trello.com/1/cards/67b329593631658cda777210/attachments/6980579de2ddadde1e4d09b7/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202123358.png"
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Passive",
        name: "Flaming Overdrive",
        quote: "",
        effect: "Deal 1% more damage per Burning stack on enemies (max 15%). After meditating, your next superclass move will be enhanced and you will deal 10%(?) more damage."
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Active",
        name: "Flame Drop",
        quote: "",
        cost: 3,
        cooldown: 5,
        moveType: "Fire",
        category: "Attack",
        damage: 15,
        scaling: "STR/60",
        effect: "Deals heavy damage to the target, deals non-lethal damage to one or multiple adjacent enemies.\n\nFlaming Overdrive: Makes Flame Drop deal even more damage, stacking with its own meditate damage buff.",
        image: "https://trello.com/1/cards/67b329593631658cda777210/attachments/698057ee03955d68525779b3/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202125305.png"
      },
      {
        slot: "6th Learn",
        level: 25,
        type: "Active",
        name: "Blazing Barrage",
        quote: "",
        cost: 2,
        cooldown: 5,
        moveType: "Fire",
        category: "Attack",
        damage: "2x8",
        scaling: "STR/55",
        effect: "Deals multi-hit damage to a single enemy. Each hit has a 25% chance to apply Burn.\n\nFlaming Overdrive: Has a chance to apply Ghostflame.",
        image: "https://trello.com/1/cards/67b329593631658cda777210/attachments/6980579e00a70394afe62013/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202123424.png"
      }
    ]
  },
  "Brawler (N)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Passive",
        name: "Crusher",
        quote: "Your attacks against vulnerable enemies are even better, inflicting status empowers you.",
        effect: "When you apply a unique status (one the target does not currently have), gain a 7% damage buff for 3 turns.\n\nInstead of dealing 20% extra damage to vulnerable enemies, now deal 25%."
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Active",
        name: "Crushing Strike",
        quote: "Charge up a devastating punch and shatter your target with it, inflicting vulnerable.",
        cost: 1,
        cooldown: 4,
        moveType: "Physical",
        category: "Attack",
        damage: 7,
        scaling: "STR/50",
        effect: "When making contact with the opponent, apply 3 turns of Vulnerable.\n\nSingle-target | Melee | Blockable"
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Passive",
        name: "Bruiser",
        quote: "While low gain increased speed and defense.",
        effect: "If you are under 50% of your max HP, gain a 10% DR buff and a 30% SPD buff. This buff is non-visual (no indicator). Going above 50% max HP removes the benefits of this passive."
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Active",
        name: "Party Table",
        quote: "Fall into a handstand and spin with tremendous power, barraging your foe with kicks.",
        cost: 2,
        cooldown: 5,
        moveType: "Physical",
        category: "Attack",
        damage: "1.5x8",
        scaling: "STR/50",
        effect: "Single-target | Melee | Blockable"
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Active",
        name: "Burst Combo",
        quote: "Barrage your enemy with a flurry of punches and kicks ending with an uppercut, if the enemy is vulnerable then this attack is empowered.",
        cost: 2,
        cooldown: 6,
        moveType: "Physical",
        category: "Attack",
        damage: "3x4",
        scaling: "STR/50 + STR/75",
        effect: "If the opponent has Vulnerable, increase the damage of the final hit by ~20%(?) and apply 2 turns of Vulnerable and Bleeding. The Vulnerable and Bleeding are applied even when this move is dodged.\n\nThe 1st hit has STR/50 scaling; the 3 following hits have STR/75 scaling.\n\nSingle-target | Melee | Dodgeable"
      }
    ]
  },
  "Darkwraith (Ch)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Passive",
        name: "Darkborne",
        quote: "Your crits create darkcores.",
        effect: "Crit attacks generate Darkcores (cap of 6). When you bring out a summon, all Darkcores are consumed, increasing its HP and damage by 5% additively per Darkcore.\n\nAlso grants 15% more damage on all attacks and your strike now scales with Arcane instead of Strength (same divisors, ARC/75)."
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Active",
        name: "Dark Smite",
        quote: "Strike the ground with darkness, creating a rift above a target that bathes them in black light, has bonus crit chance.",
        cost: 2,
        cooldown: 4,
        moveType: "Dark",
        category: "Attack",
        damage: "2x4",
        scaling: "ARC/75",
        critBonus: 25,
        effect: "This move has a 25% higher chance to critically strike.\n\nSingle-target | Ranged | Sure Hit"
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Passive",
        name: "Spirit Wraith",
        quote: "While low, your summons are empowered.",
        effect: "While under 50% HP your summons have 6% lifesteal on all their attacks which you receive (your summons do not get the lifesteal). Only active while you are under 50% HP."
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Active",
        name: "Call Darkbeast",
        quote: "Unleash the darkness in your arm, creating a malignant beast of darkness to do your bidding. Becomes empowered at 4+ cores.",
        cost: 1,
        cooldown: 4,
        moveType: "Dark",
        category: "Utility",
        scaling: "ARC/4",
        effect: "Summons a Darkbeast with 40 base HP. Always consumes all current Darkcores, granting +5% HP and Damage per Darkcore consumed. At max Darkcores deal an additional 50% damage (stacks with Darkcore bonuses). Consuming 4+ Darkcores allows the Darkbeast to use Shade Roar (costs 3 NRG)."
      },
      {
        slot: "Darkbeast",
        level: 21,
        type: "Active",
        name: "Pounce",
        quote: "Pounce and strike an enemy",
        cost: 0,
        cooldown: 0,
        moveType: "Physical",
        damage: 6,
        scaling: "ARC/105",
        effect: "Single-Target | Melee | Blockable and Dodgeable\n\nInnate: Meditating grants the Darkbeast 2 energy instead of 1."
      },
      {
        slot: "Darkbeast",
        level: 21,
        type: "Active",
        name: "Void Bite",
        quote: "Bite a target with dark energy, siphoning off life from them",
        cost: 2,
        cooldown: 3,
        moveType: "Hex",
        damage: 11,
        scaling: "ARC/105",
        effect: "Single-Target | Melee | Blockable and Dodgeable\n\nHas 20% lifesteal."
      },
      {
        slot: "Darkbeast",
        level: 21,
        type: "Active",
        name: "Shade Roar",
        quote: "Roar with dark energy, weakening and damaging all enemies from the pressure",
        cost: 3,
        cooldown: 7,
        moveType: "Dark",
        damage: 9,
        scaling: "ARC/109",
        effect: "Enemy-wide | Ranged | Dodgeable\n\nApplies 2 Vulnerable, 2 Weakened, and 1 Stunned to all enemies.\n\nOnly available when Call Darkbeast is used with 4+ Darkcores."
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Active",
        name: "Darkcore Eruption",
        quote: "Consume all your darkcore stacks to create a dense release of darkness, at 5+ stacks it becomes empowered.",
        cost: 1,
        cooldown: 4,
        moveType: "Dark",
        category: "Attack",
        damage: "3x(Darkcores)",
        scaling: "ARC/55",
        effect: "Fails with 0 Darkcores.\n\n1 Core: 1 Blinded + Weakened\n2 Cores: 2 Blinded + Weakened\n3 Cores: 3 Blinded + Weakened\n4 Cores: 4 Blinded + Weakened + 3 Vulnerable\n5 Cores: 5 Blinded + Weakened + 3 Vulnerable\n6 Cores: 6 Blinded + Weakened + 3 Vulnerable + 2 Sundered\n\nAOE | Ranged | Unblockable and Undodgeable"
      }
    ]
  },

  // ── SLAYER TREE ───────────────────────────────────────────────────────────
  "Slayer": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 5,
        type: "Passive",
        name: "Swift Fighter",
        quote: "",
        effect: "Successful dodges grant a 20% Speed buff for 2 turns."
      },
      {
        slot: "2nd Learn",
        level: 5,
        type: "Active",
        name: "Serpent Strike",
        quote: "",
        cost: 1,
        cooldown: 4,
        moveType: "Physical",
        category: "Attack",
        damage: 6,
        scaling: "STR/75",
        effect: "Inflict 2 stacks of Bleed.",
        image: "https://trello.com/1/cards/67b32926303938d1f8384d91/attachments/69788e4fb47bad244ff0165a/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127150624.png"
      },
      {
        slot: "3rd Learn",
        level: 5,
        type: "Passive",
        name: "Spear Training",
        quote: "",
        effect: "Damage dealt with spear weapons is increased by 10%."
      },
      {
        slot: "4th Learn",
        level: 5,
        type: "Active",
        name: "Triple Stab",
        quote: "",
        cost: 2,
        cooldown: 4,
        moveType: "Physical",
        category: "Attack",
        damage: "3.33x3",
        scaling: "STR/75",
        effect: "N/A",
        image: "https://trello.com/1/cards/67b32926303938d1f8384d91/attachments/69788e50786ca731099a3d8f/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127150644.png"
      }
    ]
  },
  "Saint (Or)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Passive",
        name: "Graceful Returns",
        quote: "Healing an ally buffs you.",
        effect: "Gives the healer a 5% defense buff and 7.5% regen buff for 3 turns."
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Active",
        name: "Cleansing Prayer",
        quote: "Call upon cleansing light on a target, clearing status ailments and soothing them.",
        cost: 2,
        cooldown: 5,
        moveType: "Holy",
        category: "Utility",
        healing: 4,
        scaling: "STR/80 + ARC/80",
        effect: "Removes the target's status effects before the heal.",
        image: "https://trello.com/1/cards/67b32965d4aec03ba93fe899/attachments/697fc2c1ed1609ee1feed8a2/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202021615.png"
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Active",
        name: "Light Burst",
        quote: "Charge light into your spear and release it as a burst of light, burning and blinding all enemies.",
        cost: 2,
        cooldown: 5,
        moveType: "Holy",
        category: "Attack",
        damage: 9,
        scaling: "ARC/75",
        effect: "Applies 3 Blinded to enemies on hit.",
        image: "https://trello.com/1/cards/67b32965d4aec03ba93fe899/attachments/697fc2bf365f140770993c2b/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202021446.png"
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Active",
        name: "Holy Grace",
        quote: "Condense your grace into a burst of healing on a target.",
        cost: 2,
        cooldown: 5,
        moveType: "Holy",
        category: "Utility",
        healing: 15,
        scaling: "STR/100 + ARC/100",
        effect: "Heals more than Cleansing Prayer.",
        image: "https://trello.com/1/cards/67b32965d4aec03ba93fe899/attachments/697fc2be8f54b204bf5b4134/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202021422.png"
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Passive",
        name: "Holy Emissary",
        quote: "Increases all healing.",
        effect: "Increases your outgoing and incoming healing by 35%."
      }
    ]
  },
  "Lancer (N)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Passive",
        name: "Rooted Fighter",
        quote: "",
        effect: "Successful blocks grant a 15% Speed buff for 2 turns. You can now use a shield and your block bar is (?) larger at the cost of your dodge bar becoming (?) smaller. Guarding will now make you tank damage for the rest of your team for the enemy's next hit."
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Passive",
        name: "Poised Slayer",
        quote: "",
        effect: "Heal 1.5–7% from dodges depending on speed stat. Lower speed = more healing; higher speed = less healing."
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Active",
        name: "Empowered Pierce",
        quote: "",
        cost: 2,
        cooldown: 6,
        moveType: "Physical",
        category: "Attack",
        damage: 15,
        scaling: "STR/80 + SPD/80",
        effect: "Chance to apply Stun on hit.",
        image: "https://trello.com/1/cards/67b32967bc63ebd05c7741a0/attachments/6980583f9e86cca46d02a0db/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202123616.png"
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Active",
        name: "Rallying Shout",
        quote: "",
        cost: 2,
        cooldown: 7,
        moveType: "Physical",
        category: "Buff",
        effect: "Give all allies a 15% damage buff, 10% defense buff, and 25% speed buff. Aggravates enemies into attacking the user for 4 turns (aggro effects are currently bugged).",
        image: "https://trello.com/1/cards/67b32967bc63ebd05c7741a0/attachments/6980583dfc21fd315aefd846/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202123601.png"
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Active",
        name: "Discharge",
        quote: "",
        cost: 3,
        cooldown: 6,
        moveType: "Magic",
        category: "Attack",
        damage: 10,
        scaling: "STR/80 + SPD/80",
        effect: "Chance to apply Stun on hit.",
        image: "https://trello.com/1/cards/67b32967bc63ebd05c7741a0/attachments/6980583bf4db5643df52821d/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202123541.png"
      }
    ]
  },
  "Impaler (Ch)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Active",
        name: "Rending Barrage",
        quote: "Envelope your spears in your blood, and rush down an enemy with a barrage of strikes, end with a bonus attack if they are bleeding.",
        cost: 2,
        cooldown: 5,
        moveType: "Physical",
        category: "Attack",
        damage: "5.6x3",
        scaling: "STR/75 + ARC/75",
        effect: "If the enemy is bleeding, perform an extra hit dealing 13.5 base damage with 7.5% lifesteal, applying 3 Bleeding to yourself and the enemy.",
        image: "https://trello.com/1/cards/67b3296a59bf4c7eaa7b6db5/attachments/69803c1cb4ed128cc6bec17d/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202105212.png"
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Passive",
        name: "Deranged Fighter",
        quote: "Debuffs make you berserk.",
        effect: "Gain 1% extra incoming healing for every unique status effect on you."
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Passive",
        name: "Bleeding Revelry",
        quote: "Inflict Bleeding with melee attacks, chance increases with each stack you carry.",
        effect: "For each bleed stack you have on yourself, gain a 20% chance to apply bleed equal to your current bleed count (caps at 5). This passive triggers from Physical affinity attacks, not Melee — will not work on Physical attacks modified by Wicked Crown."
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Passive",
        name: "Bloody Berserker",
        quote: "Empower yourself with your own blood.",
        effect: "You grow stronger the lower your health is, gaining 1% damage buff per 1% of HP missing, for a maximum of 100% at 1 HP."
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Active",
        name: "Blood Eruption",
        quote: "Encapsulate yourself in blood, and after a short delay explode outwards and damage all enemies, deals self damage.",
        cost: 3,
        cooldown: 9,
        moveType: "Magic",
        category: "Attack",
        damage: 15.6,
        scaling: "STR/65 + ARC/65",
        effect: "Deals 16.5% of max HP as self-damage on use. Applies 5 Bleeding to yourself and all enemies. Fully AoE.",
        image: "https://trello.com/1/cards/67b3296a59bf4c7eaa7b6db5/attachments/69803c1a9cae43b8b061db48/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202105244.png"
      },
      {
        slot: "6th Learn",
        level: 25,
        type: "Active",
        name: "Bloody Burst",
        quote: "Pierce yourself and release a slew of blood shards that you fire at all enemies, deals self damage.",
        cost: 1,
        cooldown: 4,
        moveType: "Physical",
        category: "Attack",
        damage: "5x2",
        scaling: "STR/75 + ARC/75",
        effect: "Deals 8.25% of max HP as self-damage on use. Applies 1 Bleed per hit. If the target is already Bleeding, instead applies 1 Bleed, 1 Vulnerable, and 2 Weakened. Status effects are applied before the hit lands, allowing them to affect the damage.",
        image: "https://trello.com/1/cards/67b3296a59bf4c7eaa7b6db5/attachments/69803c189ae4ae526a618904/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202105307.png"
      }
    ]
  },
  // ── MARAUDER TREE ─────────────────────────────────────────────────────────
  "Marauder": { innatePassives: [], learns: [] }, // base class has no own moves
  "Lionheart (N)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Passive",
        name: "Torrefy",
        quote: "You can now wield a shield. While guarding with a shield you absorb damage your non-summon allies take for 5 turns. Stacks on repeated use with diminishing returns (20%, 30%, 35%…).",
        effect: "Grants the ability to equip and use a shield. While guarding with it, absorb damage taken by non-summon allies for 5 turns. Stacks with diminishing returns on repeated use (20%, 30%, 35%…).",
        image: "https://trello.com/1/cards/69cf75b991772964bba6ce25/attachments/69d04ed07fd795475210170b/previews/69d04ed07fd7954752101747/download/image.webp"
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Active",
        name: "Daybreak",
        quote: "Form a mini sun around your axe and slam it into a foe, erupting in an explosion that Taunts nearby targets.",
        cost: 2,
        cooldown: 6,
        moveType: "Fire",
        category: "Attack",
        damage: 12,
        scaling: "STR/75",
        effect: "Attack a target, dealing damage to them and adjacent enemies. Every enemy hit has 2(?) Taunt stacks applied to them.",
        image: "https://trello.com/1/cards/69cf75b991772964bba6ce25/attachments/69d04e68e74f2b996cbdba10/previews/69d04e68e74f2b996cbdba28/download/image.webp"
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Active",
        name: "Cauterisation",
        quote: "Slam your shield into the ground, forming a crater of molten magma that removes your DR. When it ends, gain DR based on damage taken.",
        cost: 1,
        cooldown: 5,
        moveType: "Fire",
        category: "Buff",
        effect: "Essentially gives yourself Sundered for (?) turns. Any enemy that attacks you during this phase has 2 Taunt stacks applied per hit (no cap). At the end of the duration, you gain a DR buff scaling with how much damage you took.",
        image: "https://trello.com/1/cards/69cf75b991772964bba6ce25/attachments/69d04e845cbe9c137c3438a0/previews/69d04e845cbe9c137c3438c4/download/image.webp"
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Passive",
        name: "Vulcanised Vigor",
        quote: "Damage taken is stored for 3 turns and empowers you, granting +1% DR, +1.75% ATKP, and 0.2 scaling Base Regen for each stack. Gain 1 stack every 10 damage stored up to 20 stacks, then 15 damage stored up to 40 stacks.",
        effect: "Each Vigor stack lasts 3 turns. You gain 1 Vigor stack per 10 damage taken (up to 20 stacks), then per 15 damage (up to 40 stacks). Damage is counted AFTER damage reductions (e.g. 100 damage with 90% DR = 1 stack).\n\nEach stack grants: +1% DR, +1.75% ATKP, +0.2 base regen.",
        image: "https://trello.com/1/cards/69cf75b991772964bba6ce25/attachments/69d04edab9dce2d5d817b67c/previews/69d04edab9dce2d5d817b6c4/download/image.webp"
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Active",
        name: "Benumb",
        quote: "Envelop yourself in pride, preventing HP loss for 2 turns. When it ends, take all stored damage then regenerate 25% over 4 turns.",
        cost: 2,
        cooldown: 6,
        moveType: "Fire",
        category: "Buff",
        duration: 2,
        effect: "All HP damage received is delayed until the end of the duration, then you regenerate 25% HP over 4 turns.\n\nIf the stored damage would be fatal at any point during the skill's duration, Benumb ends early applying the damage — but does not directly kill you (acts as a mulligan for one hit). Does not prevent shield HP from taking damage. Regen may be bugged.",
        image: "https://trello.com/1/cards/69cf75b991772964bba6ce25/attachments/69d04e931d3ddb584fa3493f/previews/69d04e941d3ddb584fa3496f/download/image.webp"
      }
    ]
  },

  // ── SENTRY TREE ───────────────────────────────────────────────────────────
  "Sentry": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 5,
        type: "Passive",
        name: "Hunker Down",
        quote: "",
        effect: "After you GUARD, gain a 15% defense buff for 3 turns."
      },
      {
        slot: "2nd Learn",
        level: 5,
        type: "Passive",
        name: "High Pressure",
        quote: "",
        effect: "When combat starts apply 3 Pressure to all enemies."
      },
      {
        slot: "3rd Learn",
        level: 5,
        type: "Active",
        name: "Prepare",
        quote: "Loosen your shoulders and get ready to strike.",
        cost: 1,
        cooldown: 4,
        moveType: "Physical",
        category: "Utility",
        effect: "On your next hit, apply 3 Pressure and 2 Vulnerable."
      },
      {
        slot: "4th Learn",
        level: 5,
        type: "Active",
        name: "Lookout",
        quote: "Prepare yourself to defend a target of your choice.",
        cost: 2,
        cooldown: 5,
        moveType: "Physical",
        category: "Melee",
        damage: 9,
        scaling: "STR/75",
        effect: "Sure-Hit\nSingle-target."
      }
    ]
  },
  "Citadel (Or)": { innatePassives: [], learns: [] },
  "Arbiter (N)": {
    innatePassives: [],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Passive",
        name: "Arbiter's Mantle",
        quote: "Raise Strike's base damage to 10, but change its scaling to ARC/150. Lookout now also scales on ARC at a rate of ARC/50.",
        effect: "Strike's base damage becomes 10 with ARC/150 scaling. Lookout gains additional ARC/50 scaling.",
        image: "https://trello.com/1/cards/69cf75bad02aad297b870fab/attachments/69e072e7a7d7c22f371819ff/previews/69e072e8a7d7c22f37181a5f/download/image.webp"
      },
      {
        slot: "2nd Learn",
        level: 17,
        type: "Active",
        name: "Pronouncement",
        quote: "Rush forward with your hammer and bring it down on a foe.",
        cost: 5,
        cooldown: 8,
        moveType: "Physical",
        category: "Attack",
        damage: 5,
        scaling: "ARC/85",
        effect: "Every 10 Karma stacks provides an extra hit.\n\n0 Karma: consumes 1 stack\n10 Karma: consumes 3 stacks\n20+ Karma: consumes 5 stacks\n\nIf target has at least 1 Karma, base damage increases to 25.\n\nSingle Target | Melee | Blockable(?)",
        image: "https://trello.com/1/cards/69cf75bad02aad297b870fab/attachments/69e073ed92fddd9329400311/previews/69e073ee92fddd932940037d/download/image.webp"
      },
      {
        slot: "3rd Learn",
        level: 19,
        type: "Passive",
        name: "Affidavit",
        quote: "Harness Thanasius' distilled energy. Applies 1 Karma for every 5 base DMG your attack has.",
        effect: "Applies 1 Karma stack per 5 base damage dealt by your attacks.",
        image: "https://trello.com/1/cards/69cf75bad02aad297b870fab/attachments/69e072d3d33c3ad6aa93c442/previews/69e072d4d33c3ad6aa93c545/download/image.webp"
      },
      {
        slot: "4th Learn",
        level: 21,
        type: "Active",
        name: "Injuction",
        quote: "Raise the hammer's head into the air, casting Thanasius' gaze over an enemy.",
        cost: 2,
        cooldown: 6,
        moveType: "Hex",
        category: "Attack",
        damage: 2,
        scaling: "ARC/185",
        effect: "Every 5 Karma stacks on the opponent applies 1 Pressure. Every 10 Karma stacks appears to apply 1 Sundered.\n\nSingle Target | Ranged | Blockable(?)",
        image: "https://trello.com/1/cards/69cf75bad02aad297b870fab/attachments/69e0748695ca160e97220763/previews/69e0748895ca160e972207db/download/image.webp"
      },
      {
        slot: "5th Learn",
        level: 23,
        type: "Active",
        name: "Litigate",
        quote: "Slam the handle of the hammer into the ground, creating a pillar of malefic energy below your foes.",
        cost: 2,
        cooldown: 4,
        moveType: "Hex",
        category: "Attack",
        damage: 10,
        scaling: "ARC/90",
        effect: "Consistently grants 5 extra stacks of Karma on cast.\n\nSingle Target | Ranged | Blockable(?)",
        image: "https://trello.com/1/cards/69cf75bad02aad297b870fab/attachments/69d050bbe944ab660d005c81/previews/69d050bbe944ab660d005c99/download/image.webp"
      }
    ]
  },

  // ── SUB-CLASSES ───────────────────────────────────────────────────────────
  "Bard": {
    innatePassives: [],
    learns: [
      {
        slot: 1, level: 5, type: "Active", name: "Latir Minor",
        cost: 2, cooldown: 10, moveType: "Magic", category: "Utility",
        damage: "N/A", scaling: "N/A",
        effect: "Give 5% damage buff and 0.5% hp regen for 3 turns.",
        image: "https://trello.com/1/cards/67b6913f69bb4cf8c4c1bc0b/attachments/697cd0574c391285215b1911/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260130203700.png"
      },
      {
        slot: 2, level: 5, type: "Passive", name: "Curar Forte",
        effect: "Utility — take 3% of your HP per second to heal allies around you for 7%. Does not count for Lifesong enchant (out-of-combat heal).\n\nChanges with your soul color.",
        image: ""
      },
      {
        slot: 3, level: 5, type: "Active", name: "Rebanar Major",
        cost: 2, cooldown: 10, moveType: "Magic", category: "Utility",
        damage: "N/A", scaling: "N/A",
        effect: "Apply 4 stacks of Vulnerable and 3 stacks of Blinded.",
        image: "https://trello.com/1/cards/67b6913f69bb4cf8c4c1bc0b/attachments/697cd05932e18bed8306fdc5/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260130203735.png"
      }
    ]
  },
  "Beastmaster": {
    innatePassives: [
      {
        name: "Bestiary",
        effect: "Allows you to view enemy resistances in the Matorr's Encyclopedia.",
        image: ""
      }
    ],
    learns: [
      {
        slot: 1, level: 5, type: "Passive", name: "Sneak",
        requireItem: "Mushroom Cap",
        effect: "Utility item, decrease movement speed and remove ability to get encounter when active but lose hp while using slowly. (Doesn't work on volcano bridge)",
        image: ""
      },
      {
        slot: 2, level: 5, type: "Active", name: "Mark",
        requireItem: "Sand Core",
        cost: 1, cooldown: 2, moveType: "Physical", category: "Utility",
        damage: "7", scaling: "STR/75",
        effect: "Unblockable and undodgeable, considered a ranged attack.",
        image: "https://trello.com/1/cards/67b630e1fa2791c18eef24eb/attachments/697cd12daf1ecfea86571d0e/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260130203958.png"
      },
      {
        slot: 3, level: 5, type: "Active", name: "Expose",
        requireItem: "Restless Fragment",
        cost: 2, cooldown: 6, moveType: "Physical", category: "Utility",
        damage: "N/A", scaling: "N/A",
        effect: "Makes enemies weakness x2.",
        image: "https://trello.com/1/cards/67b630e1fa2791c18eef24eb/attachments/697cd12f13c193e86ae5fb97/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260130204013.png"
      }
    ]
  },
  "Alchemist": {
    innatePassives: [],
    learns: [
      {
        slot: "", level: 5, type: "Passive", name: "Iron Gut",
        requireItem: "Small Heal Potion",
        effect: "+1 potion use for all potion tiers in battle.",
        image: ""
      },
      {
        slot: "", level: 5, type: "Active", name: "Dangerous Mixture",
        requireItem: "Ferrus Skin Potion",
        cost: 2, cooldown: 6, moveType: "Poison", category: "Utility",
        damage: "5", scaling: "STR/80 + ARC/80",
        effect: "Applies 3 different stacks of 3 of vulnerable, blind, cursed, poison, burn and weakened. Unblockable and Undodgeable.",
        image: "https://trello.com/1/cards/67b6913c063ca71f8358c48f/attachments/697ccfd34fae77ea20108ebd/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260130203535.png"
      },
      {
        slot: "", level: 5, type: "Passive", name: "Create Cauldron",
        requireItem: "Invisibility Potion",
        effect: "Utility item, spawn cauldron to brew potions.",
        image: ""
      },
      {
        slot: "", level: 5, type: "Passive", name: "Certified",
        effect: "Allows you to sell potions and ingredients to Apothecarian. (Doesn't count for midas enchant)",
        image: ""
      }
    ]
  },
  "Blacksmith": {
    innatePassives: [],
    learns: [
      {
        slot: 1, level: 5, type: "Passive", name: "Essence of Smithing",
        effect: "Reduce the Gold costs of all Armor you craft by 100.",
        image: ""
      },
      {
        slot: 2, level: 5, type: "Passive", name: "Tools of the Trade",
        requireItem: "5 Crafted Armor",
        effect: "Utility item, spawn anvil to craft/change armor. The anvil has no collision and cannot be abused like the cauldron.",
        image: ""
      },
      {
        slot: 3, level: 5, type: "Active", name: "Jury Rigging",
        requireItem: "5 Crafted Armor",
        cost: 1, cooldown: 10, moveType: "Physical", category: "Utility",
        damage: "N/A", scaling: "END/150",
        effect: "Grants the targeted person a 10 HP shield that scales with Endurance. Dodging an attack will still reduce the shield.",
        image: "https://trello.com/1/cards/696aa9dc2c6f0c6d15785a1d/attachments/697ccf68e45d63bdaf6efa56/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260130203049.png"
      }
    ]
  },
  "Miner": {
    innatePassives: [],
    learns: [
      {
        slot: 1, level: 5, type: "Passive", name: "More for Less",
        effect: "You now gain a 10% chance to obtain Shards from mining. Additionally gain a 40% chance to earn double the ore from mining.",
        image: ""
      },
      {
        slot: 2, level: 5, type: "Passive", name: "Demoman",
        requireItem: "20 Ferrus ore",
        effect: "Allows you to use Explosives on ore to mine them. Additionally gain permission to buy Explosives from Vanio.\n\nDynamite — cost 250g per one.",
        image: ""
      },
      {
        slot: 3, level: 5, type: "Active", name: "The Right Angle",
        requireItem: "10 Ferrus and 15 Aestic ore",
        cost: 3, cooldown: 6, moveType: "Physical", category: "Utility",
        damage: "12", scaling: "STR/70 + END/140",
        effect: "Take your pickaxe out and strike the ground, creating a seismic eruption that hits all targets. Applies Crippled (4T) to all targets hit.",
        image: "https://trello.com/1/cards/696aa9dbc45d0880564497ff/attachments/697cd1f9cadd4faa217714a4/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260130204448.png"
      }
    ]
  }
};

