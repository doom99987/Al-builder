// --- Race data ---
// to add race: "Human": { str:, arc:, end:, spd:, lck: },
const races = {
  "Estella (24%)": {str: 2, arc: 2, end: 2, lck: 1, spd: 1},
  "Stultus (20%)": {str: 2, arc: 1, end: 1, lck: 1, spd: 1},
  "Nisse (20%)": {str: 1, arc: 3, end: 1, lck: 2, spd: 1},
  "Vastayan (9%)": {str: 1, arc: 2, end: 1, lck: 1, spd: 3},
  "Veneri (6%)": {str: 2, arc: 1, end: 2, lck: 2, spd: 2},
  "Ophimar (6%)": {str: 2, arc: 1, end: 1, lck: 3, spd: 4},
  "Drauga (6%)": {str: 1, arc: 2, end: 2, lck: 2, spd: 2},
  "Corvolus (3%)": {str: 1, arc: 4, end: 1, lck: 2, spd: 2},
  "Daminos (3%)": {str: 1, arc: 2, end: 3, lck: 1, spd: 3},
  "Dullahan (1%)": {str: 3, arc: 2, end: 4, lck: 2, spd: 1},
  "Vydeer (1%)": {str: 1, arc: 1, end: 3, lck: 2, spd: 2},
  "Boreas (1%)": {str: 3, arc: 3, end: 4, lck: 1, spd: 1},
  "Lentum (Ob)": {str: 3, arc: 3, end: 1, lck: 1, spd: 2},
  "Amorus (Ob)": {str: 4, arc: 4, end: 4, lck: 4, spd: 4},
  "Sheea (Ob)": {str: 3, arc: 3, end: 1, lck: 1, spd: 2},
  "Inferion (Ob)": {str: 3, arc: 1, end: 4, lck: 1, spd: 1},
  "Gynx (Ob)": {str: 4, arc: 1, end: 8, lck: 1, spd: 1}
};

let raceBase = { str: 0, arc: 0, end: 0, lck: 0, spd: 0 };

const racePicker = document.getElementById("race-picker");
Object.keys(races).forEach(name => {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  racePicker.appendChild(opt);
});

racePicker.addEventListener("change", e => {
  raceBase = races[e.target.value] || { str: 0, arc: 0, end: 0, spd: 0, lck: 0 };
  document.querySelectorAll(".stat-row").forEach(row => {
    const base = raceBase[row.dataset.stat] ?? 0;
    row.querySelector(".stat-base").textContent = base > 0 ? `+${base}` : "";
  });
  updatePoints();
  updatePecents();
});

// --- Stat counters ---
const Max_Lvl = 40;
const Min_Lvl = 1;
let spent = 0;

const lvlInput = document.getElementById("Lvl");

function getEffectiveTotal() {
  const lvl = Math.min(Max_Lvl, Math.max(Min_Lvl, +lvlInput.value || Min_Lvl));
  const base = (lvl - Min_Lvl) * 5;
  const isDullahan = racePicker.value === "Dullahan (1%)";
  const bonus = isDullahan ? Math.floor(lvl / 10) * 3 : 0;
  return base + bonus;
}

lvlInput.addEventListener("change", () => {
  lvlInput.value = Math.min(Max_Lvl, Math.max(Min_Lvl, +lvlInput.value || Min_Lvl));
  const total = getEffectiveTotal();
  if (spent > total) {
    const rows = [...document.querySelectorAll(".stat-row")].reverse();
    for (const row of rows) {
      if (spent <= total) break;
      const input = row.querySelector(".stat-val");
      const cur = +input.value;
      const reduce = Math.min(cur, spent - total);
      input.value = cur - reduce;
      input.dataset.prev = input.value;
      spent -= reduce;
    }
  }
  updatePoints();
  updatePecents();
  renderMoves();
});

document.getElementById("points-left").textContent = getEffectiveTotal();

document.querySelectorAll(".stat-row").forEach(row => {
  const plus = row.querySelector(".plus");
  const minus = row.querySelector(".minus");
  const val = row.querySelector(".stat-val");

  plus.addEventListener("click", () => {
    if (spent >= getEffectiveTotal()) return;
    val.value = +val.value + 1;
    spent++;
    updatePoints();
    updatePecents();
  });

  minus.addEventListener("click", () => {
    if (+val.value <= 0) return;
    val.value = +val.value - 1;
    spent--;
    updatePoints();
    updatePecents();
  });

  val.dataset.prev = 0;
  val.addEventListener("change", () => {
    const prev = +val.dataset.prev;
    let newVal = Math.max(0, Math.floor(+val.value || 0));
    const diff = newVal - prev;
    if (spent + diff > getEffectiveTotal()) {
      newVal = prev + (getEffectiveTotal() - spent);
    }
    val.value = newVal;
    spent += newVal - prev;
    val.dataset.prev = newVal;
    updatePoints();
    updatePecents();
  });
});

function calcPercentage(stat, val){
  const lckAllocated = +document.querySelector('.stat-row[data-stat="lck"] .stat-val').value;
  const lck = lckAllocated + (raceBase.lck ?? 0);
  const formulas = {
    str:         v => v * 2.5,
    arc:         v => v * 3,
    end:         v => v * 1.5,
    spd:         v => v * 2,
    "crit-chance": () => lck * 0.5,
    "crit-dmg":    () => lck * 1.5,
    "out-heal":    () => 0,
    "inc-heal":    () => 0,
  };
  return formulas[stat] ? formulas[stat](val).toFixed(1) : "—";
}

function updatePoints() {
  document.getElementById("points-left").textContent = getEffectiveTotal() - spent;
}


function updatePecents() {
  document.querySelectorAll(".percent-item").forEach(item => {
    const stat = item.dataset.stat;
    const row = document.querySelector(`.stat-row[data-stat="${stat}"] .stat-val`);
    const allocated = row ? +row.value : 0;
    const val = allocated + (raceBase[stat] ?? 0);
    item.querySelector(".percent-val").textContent = calcPercentage(stat, val) + "%";
  });
}

// Init
updatePecents();

// --- Gear ---
// To add gear: "Item Name": { str, arc, end, spd, lck }
const gearItems = {
  "Iron Sword": { str: 5, arc: 0, end: 0, spd: 0, lck: 0 }
};

const gearPickers = document.querySelectorAll(".gear-picker");

gearPickers.forEach(picker => {
  Object.keys(gearItems).forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    picker.appendChild(opt);
  });
});

function enforceUniqueGear() {
  const selected = Array.from(gearPickers).map(p => p.value).filter(v => v !== "");
  gearPickers.forEach(picker => {
    Array.from(picker.options).forEach(opt => {
      if (opt.value === "") return;
      opt.disabled = selected.includes(opt.value) && picker.value !== opt.value;
    });
  });
}

gearPickers.forEach(picker => {
  picker.addEventListener("change", enforceUniqueGear);
});

// --- Weapons ---
// To add weapon: "Item Name": { str, arc, end, spd, lck }
const weaponItems = {
  // example: "Iron Sword": { str: 5, arc: 0, end: 0, spd: 0, lck: 0 },
};

const weaponPickers = document.querySelectorAll(".weapon-picker");

weaponPickers.forEach(picker => {
  Object.keys(weaponItems).forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    picker.appendChild(opt);
  });
});

function enforceUniqueWeapon() {
  const selected = Array.from(weaponPickers).map(p => p.value).filter(v => v !== "");
  weaponPickers.forEach(picker => {
    Array.from(picker.options).forEach(opt => {
      if (opt.value === "") return;
      opt.disabled = selected.includes(opt.value) && picker.value !== opt.value;
    });
  });
}

weaponPickers.forEach(picker => {
  picker.addEventListener("change", enforceUniqueWeapon);
});

// --- Classes ---
// To add a class: "ClassName": ["SuperClass1", "SuperClass2", ...]
const classes = {
  "Thief": ["Ranger (Or)", "Rouge (N)", "assassin (Ch)"]
};

const classPicker = document.getElementById("class-picker");
const superPicker = document.getElementById("super-picker");

Object.keys(classes).forEach(name => {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  classPicker.appendChild(opt);
});

classPicker.addEventListener("change", () => {
  const selected = classPicker.value;
  superPicker.innerHTML = "";

  if (!selected) {
    superPicker.disabled = true;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— Select Class First —";
    superPicker.appendChild(opt);
    return;
  }

  superPicker.disabled = false;
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "— Select Super Class —";
  superPicker.appendChild(defaultOpt);

  (classes[selected] || []).forEach(superName => {
    const opt = document.createElement("option");
    opt.value = superName;
    opt.textContent = superName;
    superPicker.appendChild(opt);
  });
});

// --- Class Moves ---
// To add: "ClassName": { innatePassives: [...], learns: [...] }
const classMoves = {
  "Thief": { innatePassives: [], learns: [] },
  "Ranger (Or)": { innatePassives: [], learns: [] },
  "Rouge (N)": { innatePassives: [], learns: [] },
  "assassin (Ch)": { innatePassives: [], learns: [] }
};

// --- Race Moves ---
const raceMoves = {
  "Estella (24%)": {
    innatePassives: [
      {
        level: 1,
        name: "Enduring Fighter",
        description: "While below 40% of your max hp, gain a permanent 10% defense buff. Also provides a 50% healing buff for two turns after being triggered. The healing buff persists permanently while below the proc threshold, and lasts 2 turns or until attacked, while above the proc threshold."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 10,
        type: "Active",
        name: "Tense Up",
        quote: "Tense your muscles, increasing defense for a short time.",
        cost: 2,
        cooldown: 6,
        moveType: "Physical",
        category: "Buff",
        duration: 4,
        effect: "Grants the user a 30% true defense buff for the next 4 turns.",
        image: "https://trello.com/1/cards/67c264b06ec09ceaff1ce916/attachments/697602f609c7b376ad3782a4/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125164743.png"
      },
      {
        slot: "2nd Learn",
        level: 35,
        type: "Passive",
        name: "Hyper Rage",
        quote: "Improves your innate rage.",
        effect: "Enhances the abilities of Enduring Fighter, now triggering at 50% of your total hp and giving a 25% damage buff on top of the previous 10% defense buff. The damage and defense buff will remain for the rest of the fight."
      }
    ]
  },
  "Stultus (20%)": {
    innatePassives: [
      {
        level: 1,
        name: "Speed to Crit",
        description: "Speed is converted into extra critical chance, capped at 100%. (10 speed = 1% extra crit chance)"
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 10,
        type: "Active",
        name: "Focus Step",
        quote: "Focus your energy into your legs, increasing your speed stat and giving you a chance to dodge attacks for a short time. When it ends, take recoil damage.",
        cost: 1,
        cooldown: 7,
        moveType: "Physical",
        category: "Buff",
        duration: 4,
        effect: "Grants the user a LVL*2 flat speed buff and the ability to automatically dodge a move, including moves which typically cannot be dodged. Lasts 4 turns.",
        image: "https://trello.com/1/cards/67c264b7d57cf0a404949999/attachments/6976034d090464c2c3031457/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125164920.png"
      },
      {
        slot: "2nd Learn",
        level: 35,
        type: "Passive",
        name: "Vanishing Drive",
        quote: "???",
        effect: "Grants the player access to Vanishing Drive, an item which on use grants the player a burst of uncontrollable speed. Cannot be used in combat."
      }
    ]
  },
  "Nisse (20%)": {
    innatePassives: [
      {
        level: 1,
        name: "Energy Surge",
        description: "You have a chance to gain extra energy on your turn."
      },
      {
        level: 1,
        name: "Potion Duplication",
        description: "Creating a potion has a chance to create the same potion again."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Active",
        name: "Circuit Charge",
        quote: "Stress your magic circuits to their limit, granting you energy at the cost of health.",
        cost: 0,
        cooldown: 5,
        moveType: "Physical",
        category: "Buff",
        effect: "Grants the user 3 energy while also applying 2 vulnerable onto themselves.",
        image: "https://trello.com/1/cards/67c264b4927cff75dcd27282/attachments/697603e369a320da99275479/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125165153.png"
      },
      {
        slot: "2nd Learn",
        level: 30,
        type: "Passive",
        name: "Magically Charged",
        quote: "Become more proficient with magic and fire..",
        effect: "Increases fire and magical damage by 15%."
      }
    ]
  },
  "Vastayan (9%)": {
    innatePassives: [
      {
        level: 1,
        name: "Tail",
        description: "You have a tail, pressing P allows you to latch and unlatch this tail, this can be used at anytime."
      },
      {
        level: 1,
        name: "High Jump",
        description: "You jump higher than other races."
      },
      {
        level: 1,
        name: "Affinity Boost",
        description: "Your Magic and Hex affinity skills get a 10% damage buff."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 5,
        type: "Active",
        name: "Call Sylph",
        quote: "Call upon a Lesser Sylph to assist you in battle.",
        cost: 2,
        cooldown: 7,
        moveType: "Magic",
        category: "Summon",
        scaling: "STR/8 + ARC/8",
        effect: "Summon Lesser Sylph when used, the Lesser Sylph has 35 base HP.\n\nSylph Moves:\n• Wind Bolt — Cost: 0 | CD: 0 | Type: Nature | Dmg: 5 | Scaling: STR/100 + ARC/100 — Hits the opponent with a bolt of wind.\n• Gale Pulse — Cost: 2 | CD: 6 | Type: Nature | Dmg: 7 | Scaling: STR/100 + ARC/100 — Hits all opponents with a pulse of gale.",
        image: "https://trello.com/1/cards/67c264ba2e47733e7791287b/attachments/69760690c0c37b7beb634ec6/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125170212.png"
      },
      {
        slot: "2nd Learn",
        level: 20,
        type: "Passive",
        name: "Spirit Caller",
        quote: "Your summons are tankier. Lesser sylph now has hp regen.",
        effect: "Your summons have 20% more hp (50% more for Skeleton) and your sylph now regens by 5% of their MaxHP per turn."
      },
      {
        slot: "3rd Learn",
        level: 40,
        type: "Active",
        name: "Spirit Awakening",
        quote: "Merge with a spirit of your own to empower yourself, granting you a temporary modifier, and empowering your spirits. At the risk of hurting yourself after the duration.",
        cost: 4,
        cooldown: 18,
        moveType: "Magic",
        category: "Buff",
        duration: 4,
        effect: "Grants the user a 15% buff to all stats and a 50% damage buff to their summons for 4 turns. On the 4th turn, the user takes 27.5% HP damage and is unable to act for one turn, becoming heavily stunned until the end of their next turn. Endurance buffs convert to Damage Reduction. Self-Damage can be affected by Hex.",
        image: "https://trello.com/1/cards/67c264ba2e47733e7791287b/attachments/69760691fec445184249c03e/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125170310.png"
      }
    ]
  },
  "Veneri (6%)": {
    innatePassives: [
      {
        level: 1,
        name: "Gold Rush",
        description: "Gain a damage buff the more gold you have; 0.2% dmg buff per 500 gold and caps at 20% at 50k gold."
      },
      {
        level: 1,
        name: "Enchant Affinity",
        description: "You have a higher chance of proccing enchants than other races."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 5,
        type: "Active",
        name: "Burst Trap",
        quote: "Throw down a rigged trap, exploding on the first melee attacker.",
        cost: 2,
        cooldown: 6,
        moveType: "Fire",
        category: "Attack",
        damage: 10,
        scaling: "SPD/LCK",
        effect: "Places a trap under the user, this trap will trigger whenever the enemy uses a melee attack on the target. It will disappear after 3 turns or when it is used up to two times.",
        image: "https://trello.com/1/cards/67c264bd0c479136d4ba5738/attachments/69760ea422e960cdae5d3198/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125173743.png"
      },
      {
        slot: "2nd Learn",
        level: 15,
        type: "Passive",
        name: "Potion Quaffer",
        quote: "Reduce toxicity from potions drank in battle.",
        effect: "You can use one extra Low Tier potion per fight."
      },
      {
        slot: "3rd Learn",
        level: 40,
        type: "Active",
        name: "Oppulence Cutter",
        quote: "Forge an attack with the blessing of Lodyssa using the fortune she granted. Consumes Gold to deal damage and then boost the user.",
        cost: 0,
        cooldown: 10,
        moveType: "Magic",
        category: "Attack/Buff",
        duration: "?",
        damage: 10,
        scaling: "STR/75 + ARC/75",
        effect: "Consume 1000 gold to create a blade, hitting the opponent and increasing your highest invested stat by (?). If you do not have enough gold the attack will fail (have at least 5k).",
        image: "https://trello.com/1/cards/67c264bd0c479136d4ba5738/attachments/697605a20b08108fd0430116/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125165903.png"
      }
    ]
  },
  "Ophimar (6%)": {
    innatePassives: [
      {
        level: 1,
        name: "Ecdysis",
        description: "When afflicted with Poison, Bleed, or Burn, decay these statuses by 2 instead of 1."
      },
      {
        level: 1,
        name: "Sharp Scales",
        description: "Start the battle off with 4 turns of Thorns."
      }
    ],
    learns: [
      {
        slot: "Level 5",
        level: 5,
        type: "Active",
        name: "Blacktongue",
        quote: "Deal additional damage equal to Poison stacks, then decay Poison by 1. Repeats per stack.",
        cost: 0,
        cooldown: 10,
        moveType: "Poison",
        category: "Utility",
        duration: "?",
        effect: "Your next attack on an enemy applies this debuff: deal additional damage equal to Poison stacks, then decay Poison by 1. Repeats per stack."
      },
      {
        slot: "Level 20",
        level: 20,
        type: "Passive",
        name: "Advanced Ecdysis",
        quote: "Ecdysis now also applies to Vulnerable, Weakened, and Cripple.",
        effect: "Ecdysis now also applies to Vulnerable, Weakened, and Cripple."
      },
      {
        slot: "Level 40",
        level: 40,
        type: "Passive",
        name: "New Skin, New Me",
        quote: "When you meditate, decay all statuses affected by Ecdysis by 2.",
        effect: "When you meditate, decay all statuses affected by Ecdysis by 2."
      }
    ]
  },
  "Drauga (6%)": {
    innatePassives: [
      {
        level: 1,
        name: "Vampiric Crits",
        description: "Crits will heal you for 15% of the attack's damage."
      },
      {
        level: 1,
        name: "Bloodlust",
        description: "Gain a speed buff whenever you kill enemies for the rest of the fight."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 10,
        type: "Active",
        name: "Illusion Cage",
        quote: "Create an illusion over yourself, causing the first enemy to attack you to be trapped in a cage of illusions.",
        cost: 2,
        cooldown: 8,
        moveType: "Magic",
        category: "Debuff",
        duration: "?",
        effect: "Place a trap onto a teammate, including yourself. When an enemy uses an attack targeting that player they will not attack and be given 2 stun. Not all attacks that target players will trigger this move, mainly ultimate attacks from bosses.",
        image: "https://trello.com/1/cards/67c264bffc295942b39c2329/attachments/69760750c86ad8b06caad7e0/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125170614.png"
      },
      {
        slot: "2nd Learn",
        level: 25,
        type: "Passive",
        name: "Enhanced Bloodlust",
        quote: "Gain more benefits from the blood of your enemies.",
        effect: "You now gain a 12.5-15% damage buff alongside a speed buff for the rest of the fight when you kill an enemy."
      },
      {
        slot: "3rd Learn",
        level: 35,
        type: "Active",
        name: "Blood Shards",
        quote: "Slash the air, creating a rift of blood that fires a barrage of shards at your enemy, healing you for a percentage of damage dealt. If the target is vulnerable, apply 3 bleeding.",
        cost: 3,
        cooldown: 9,
        moveType: "Magic",
        category: "Attack",
        damage: "1.2 x 6",
        scaling: "STR/ARC",
        effect: "Send out a 6 hit attack of shards of blood, healing you for the damage they deal. If the enemy is vulnerable the last shard will apply 3 bleed onto the opponent.",
        image: "https://trello.com/1/cards/67c264bffc295942b39c2329/attachments/6976074f492874b8ee2e0210/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125170552.png"
      }
    ]
  },
  "Corvolus (3%)": {
    innatePassives: [
      {
        level: 1,
        name: "Energy Chance",
        description: "Chance to get +1 extra energy on your turn. Can stack with other energy gain enhancing passives."
      },
      {
        level: 1,
        name: "Essence Buff",
        description: "You have a 1.15x essence gain buff."
      },
      {
        level: 1,
        name: "Affinity Mastery",
        description: "Your Holy and Magic affinity skills get a 30% damage buff."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 1,
        type: "Active",
        name: "Cast Amplify",
        quote: "Amplify a target, causing their MAGIC, HOLY, FIRE, NATURE, ICE or DARK attacks to be empowered with more damage and a shorter cooldown.",
        cost: 1,
        cooldown: 9,
        moveType: "Magic",
        category: "Buff",
        duration: 4,
        effect: "Target an ally or yourself, giving a 20% damage buff to their magic, holy, fire, nature, ice and dark moves and decrease their cooldown by 1 for 3 turns.",
        image: "https://trello.com/1/cards/67c264c527229fb91db97a31/attachments/69760857a9c999175c48d491/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125171019.png"
      },
      {
        slot: "2nd Learn",
        level: 40,
        type: "Active",
        name: "Arcane Ritual",
        quote: "Manifest a runic array over the battlefield, causing you and your allies' magical affinity attacks to have a chance of being empowered, also boosts the recovery of allies.",
        cost: 3,
        cooldown: 14,
        moveType: "Magic",
        category: "Buff",
        duration: 5,
        effect: "Chance to give a ~40% damage buff to magic, holy, fire, nature, ice and dark moves and also increase regen. (Regen is most likely bugged right now after being tested).",
        image: "https://trello.com/1/cards/67c264c527229fb91db97a31/attachments/697608584a2a95b61d4915c0/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125171042.png"
      }
    ]
  },
  "Daminos (3%)": {
    innatePassives: [
      {
        level: 1,
        name: "4 Lives",
        description: "You have 4 lives compared to the usual 3. If played on the \"Mortal\" trial, this passive is replaced by a chance to get 1 bonus energy on your turn."
      },
      {
        level: 1,
        name: "Outgoing Healing",
        description: "You gain 15% more outgoing healing."
      },
      {
        level: 1,
        name: "The Horn",
        description: "If you are hit while at 25% HP or lower, you trigger the Horn and gain a passive heal of 2% of your max HP. This regeneration continues until you are hit again while above 25% HP."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 1,
        type: "Active",
        name: "Restructure",
        quote: "Triggers rapid cell regeneration on target.",
        cost: 1,
        cooldown: 9,
        moveType: "Nature",
        category: "Buff",
        duration: 3,
        effect: "Grants passive regeneration of 5 + 5% of max HP for 3 turns.",
        image: "https://trello.com/1/cards/67c264c735060c8f4da3827d/attachments/697604f0feb713d79e6bb65a/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125165606.png"
      },
      {
        slot: "2nd Learn",
        level: 40,
        type: "Active",
        name: "Mulligan Realm",
        quote: "Place down a roaring realm of pure draconic energy, granting you and allies increased regen and a chance to survive fatal blows.",
        cost: 3,
        cooldown: 10,
        moveType: "Nature",
        category: "Buff",
        duration: 4,
        effect: "Grants all allies heal up (~21% Outgoing), chance to gain mulligan upon fatal blow. (Mulligan is presumably bugged.)",
        image: "https://trello.com/1/cards/67c264c735060c8f4da3827d/attachments/697604ee0dda4ba0444da2c4/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125165524.png"
      }
    ]
  },
  "Dullahan (1%)": {
    innatePassives: [
      {
        level: 1,
        name: "4 Lives",
        description: "You have 4 lives compared to the usual 3. If played on the \"Mortal\" trial, this passive is replaced by a chance to get 1 bonus energy on your turn."
      },
      {
        level: 1,
        name: "Essence Gain",
        description: "Dullahans get more essence from defeating enemies."
      },
      {
        level: 1,
        name: "Bonus Stat Points",
        description: "Every 10 levels, Dullahans get 3 more stat points to allocate. This makes Dullahans have 12 more stat points than any other race at level 40."
      },
      {
        level: 1,
        name: "Fire Resistance",
        description: "Dullahans have an innate 20% fire resistance."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 1,
        type: "Active",
        name: "Ghostflame",
        quote: "Fire off a piece of your flame, igniting ghostflame on your enemy.",
        cost: 1,
        cooldown: 6,
        moveType: "Fire",
        category: "Attack",
        damage: 5,
        scaling: "STR/80 + ARC/80",
        effect: "Applies 3 ghostflame upon hit.",
        image: "https://trello.com/1/cards/67c264cf33024a462dad5164/attachments/697609209c82b34b34f24e62/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125171410.png"
      },
      {
        slot: "2nd Learn",
        level: 30,
        type: "Active",
        name: "Lifeless Skull",
        quote: "Fire out a blazing skull dealing high damage, has a chance of igniting ghostflame.",
        cost: 2,
        cooldown: 5,
        moveType: "Fire",
        category: "Attack",
        damage: 13,
        scaling: "STR/80 + ARC/80",
        effect: "Has a chance to apply 2 ghostflame.",
        image: "https://trello.com/1/cards/67c264cf33024a462dad5164/attachments/6976097131e3c40624596cdb/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125171536.png"
      }
    ]
  },
  "Vydeer (1%)": {
    innatePassives: [
      {
        level: 1,
        name: "Dodge Energy",
        description: "Chance to get +1 extra energy when dodging skills."
      },
      {
        level: 1,
        name: "Blind Immunity",
        description: "You cannot be blinded."
      },
      {
        level: 1,
        name: "Crit Buildup",
        description: "Every turn gain 1.5% extra Critical Chance, capped at 15% extra Critical Chance after 10 turns."
      },
      {
        level: 1,
        name: "Sense (Exclusive Status)",
        description: "While you have 3 or more stacks of Sense you dodge any attack that would have dealt damage, even if you guarded or blocked it. When you autododge the attack you still receive the statuses."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 1,
        type: "Active",
        name: "Sense Expansion",
        quote: "Heighten your senses, granting you 3 sense stacks.",
        cost: 1,
        cooldown: 3,
        moveType: "Physical",
        category: "Buff",
        effect: "Grants 3 Sense stacks always.",
        image: "https://trello.com/1/cards/68c4e8377457fe90caa1db35/attachments/69760bab3d9b18365e6e1df7/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125172442.png"
      },
      {
        slot: "2nd Learn",
        level: 20,
        type: "Active",
        name: "Mind's Eye",
        quote: "Reflect any incoming damage for a turn, if no damage is reflected receive repercussions.",
        cost: 2,
        cooldown: 7,
        moveType: "Physical",
        category: "Buff",
        duration: 1,
        effect: "Enter a stance, reflecting the damage of the next move that hits you. The reflected damage is the initial move's damage divided by 2, increased by 5% per level, and multiplied by an extra 10% per Sense stack you currently have. The reflected hit can crit, trigger gear enchants, and is affected by weapon passives and shards. If you fail to reflect a hit you gain a 5-20% defense debuff.",
        image: "https://trello.com/1/cards/68c4e8377457fe90caa1db35/attachments/69760ba9c07fd9a8d6d72458/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125172427.png"
      },
      {
        slot: "3rd Learn",
        level: 35,
        type: "Active",
        name: "Soul Reversal",
        quote: "Enter a stance based on your Sense Expansion stacks. 0-2 stacks grants damage and speed buffs. 3 stacks grants party-wide invincibility.",
        cost: 3,
        cooldown: 14,
        moveType: "Physical",
        category: "Buff",
        effect: "The base buff is a 10% damage buff, increasing by 5% per Sense stack consumed. At 8+ Sense stacks, no damage buff is received but all stacks are consumed and all allies gain party-wide invincibility for 2 turns. (Invincibility requires 8 Sense stacks currently.)",
        image: "https://trello.com/1/cards/68c4e8377457fe90caa1db35/attachments/69760ba864721dee19643e29/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125172408.png"
      }
    ]
  },
  "Boreas (1%)": {
    innatePassives: [
      {
        level: 1,
        name: "Frost Stacks",
        description: "When using an Ice affinity move, gain 1 stack. Each stack grants 20% Damage and 10% Damage Reduction, up to 200% Damage and 70% Damage Reduction. Using a non-Ice affinity move removes 1 stack. Buff moves do not change stacks."
      },
      {
        level: 1,
        name: "Cold Application",
        description: "Attacking an enemy has a (~25%) chance to apply 2 Cold stacks."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 5,
        type: "Active",
        name: "Chilling Winds",
        quote: "Release a burst of cold outwards, hitting all enemies and applying Cold stacks.",
        cost: 1,
        cooldown: 4,
        moveType: "Ice",
        category: "Attack",
        damage: 9,
        scaling: "STR/60 + ARC/60",
        effect: "Hits all enemies, dealing moderate damage, and applies 2 Cold, 2 Vulnerable, and 2 Weakened, with a ?% chance to apply 1 Stun. Status effects are applied before the attack lands, allowing them to affect the damage.",
        image: "https://trello.com/1/cards/67e06e6b711c06ba1cf30453/attachments/69760c2c9fc7381e2510411f/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125172709.png"
      },
      {
        slot: "2nd Learn",
        level: 35,
        type: "Active",
        name: "Inner Frost",
        quote: "Heavy stun yourself for two turns. At the end, deal AoE dmg to all enemies.",
        cost: 2,
        cooldown: 12,
        moveType: "Ice",
        category: "Attack",
        damage: 21,
        scaling: "STR/60 + ARC/60",
        effect: "Receive 2 stacks of Heavy Stun. At the end of their duration, deal high damage to all enemies and apply 1 Vulnerable and 4 Cold. Status effects are applied before the attack lands, allowing them to affect the damage.",
        image: "https://trello.com/1/cards/67e06e6b711c06ba1cf30453/attachments/69760c2bc9d3e290ac9d359a/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125172647.png"
      }
    ]
  },
  "Lentum (Ob)": {
    innatePassives: [
      {
        level: 1,
        name: "Slime Speaker",
        description: "Allows you to speak with the King Slime statue without the Gelat Band."
      },
      {
        level: 1,
        name: "Slime Coloration",
        description: "Slimes summoned by the Gelat Band will have the same color as Lentum."
      },
      {
        level: 1,
        name: "Slime Regen",
        description: "Has 2 HP passive regeneration on its own."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 20,
        type: "Active",
        name: "Bane",
        quote: "Snap your fingers, creating a poison explosion, applying poison to your target and foes adjacent.",
        cost: 1,
        cooldown: 7,
        moveType: "Poison",
        category: "Attack",
        damage: 7,
        scaling: "STR/ARC",
        effect: "Deal damage and apply 3 poison to target and adjacent enemies.",
        image: "https://trello.com/1/cards/67c264d142324b97e969c236/attachments/69760ff24678dee060c2f6b9/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125174229.png"
      },
      {
        slot: "2nd Learn",
        level: 30,
        type: "Passive",
        name: "Slimy Shield",
        quote: "When blocking a physical attack, blind and weaken your attacker.",
        effect: "When guarding/blocking melee attacks apply 2 weakened and 1 blind to the attacker."
      },
      {
        slot: "3rd Learn",
        level: 40,
        type: "Active",
        name: "Mucilage",
        quote: "Coat a target ally or self with your slime, creating a barrier that reduces incoming damage (depending on type, to a minimum of 1) from attacks for 3 turns.",
        cost: 3,
        cooldown: 12,
        moveType: "Magic",
        category: "Buff",
        duration: 3,
        effect: "Target yourself or an ally to get a damage reduction with an X% for 3 turns. (fire-type skills ignore mucilage)",
        image: "https://trello.com/1/cards/67c264d142324b97e969c236/attachments/69760ff3dc0e94a30105dc7a/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125174306.png"
      }
    ]
  },
  "Amorus (Ob)": {
    innatePassives: [
      {
        level: 1,
        name: "Stun Immunity",
        description: "Immune to Stun Status Effect."
      },
      {
        level: 1,
        name: "Holy/Nature Weakness",
        description: "Holy and Nature affinity attacks deal 15% more damage to you."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 5,
        type: "Active",
        name: "Sinister Gaze",
        quote: "Stare at your enemy with your cursed eye to deal damage and copy their stat buffs while sharing your negative status effects.",
        cost: 2,
        cooldown: 7,
        moveType: "Hex",
        category: "Attack/Buff",
        duration: "?",
        damage: 7,
        scaling: "STR/80 + ARC/80",
        effect: "Deal damage to a target, copying their stat buffs (damage up, defense up) and sharing your negative status effects.",
        image: "https://trello.com/1/cards/67c264d744c6e0a59cc1cf57/attachments/697610a1b88b078367369dc0/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125174518.png"
      },
      {
        slot: "2nd Learn",
        level: 15,
        type: "Passive",
        name: "Hexed Blood",
        quote: "Gives immunity to the hexed status effect.",
        effect: "Becomes immune to Hex Status Effect."
      },
      {
        slot: "3rd Learn",
        level: 35,
        type: "Active",
        name: "Undulating Hex",
        quote: "Unleash a large burst of hex from your cursed side that forms into a large blade of hex that drops onto a foe.",
        cost: 4,
        cooldown: 9,
        moveType: "Hex",
        category: "Attack",
        damage: 15,
        scaling: "STR/80 + ARC/80",
        effect: "Target an enemy, dealing damage and applying 1 hex, and also damages adjacent enemies for non-lethal damage.",
        image: "https://trello.com/1/cards/67c264d744c6e0a59cc1cf57/attachments/697610a311515c77d6c25756/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125174611.png"
      }
    ]
  },
  "Sheea (Ob)": {
    innatePassives: [
      {
        level: 1,
        name: "4 Lives",
        description: "You have 4 lives compared to the usual 3. If played on the \"Mortal\" trial, This passive is replaced by a chance to get 1 bonus energy on your turn."
      },
      {
        level: 1,
        name: "Reduced Cooldowns",
        description: "Cooldown to all moves is reduced by 1 turn."
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 5,
        type: "Active",
        name: "Skyward Bolt",
        quote: "Condense your light into a bolt of shocking energy, has a chance to blind.",
        cost: 2,
        cooldown: 6,
        moveType: "Holy",
        category: "Attack",
        damage: 10,
        scaling: "STR/ARC",
        effect: "Shoots a bolt to a target, deals damage and has a chance to apply 2 blind.",
        image: "https://trello.com/1/cards/67c264d96e98da9ed20197c1/attachments/69761167850a7e2c6c96117b/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125174933.png"
      },
      {
        slot: "2nd Learn",
        level: 25,
        type: "Active",
        name: "His Incandescence",
        quote: "Cleanse the target's debuffs and grant them a small-moderate buff to their highest stat.",
        cost: 3,
        cooldown: 8,
        moveType: "Holy",
        category: "Buff",
        duration: "?",
        effect: "Target yourself or ally, cleansing their debuffs, buffing their highest stat and giving a small heal. (doesn't heal if target had cursed before cleansing)",
        image: "https://trello.com/1/cards/67c264d96e98da9ed20197c1/attachments/69761165cb74c5eb51c47bf2/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125174902.png"
      }
    ]
  },
  "Inferion (Ob)": {
    innatePassives: [
      {
        level: 1,
        name: "2 Lives",
        description: "You have 2 lives compared to the usual 3."
      },
      {
        level: 1,
        name: "Burning Fury",
        description: "You get a non-visual ~15% attack buff while under burning, ghostflame or inferno. This does not stack and there is no defense buff."
      },
      {
        level: 1,
        name: "Magic Frailty",
        description: "You take 25% more magic damage and 10% less poison damage."
      },
      {
        level: 1,
        name: "Demonic Presence",
        description: "Every 5 turns, gain a 5% extra damage buff, 5% defense buff and 1 extra regen. Stacks 5 times. (the extra regen buff is bugged right now)"
      }
    ],
    learns: [
      {
        slot: "1st Learn",
        level: 15,
        type: "Passive",
        name: "Demonic Rage",
        quote: "rejuvenation comes with a price",
        effect: "Revive yourself, healing back to 50% of your max hp. Has a cooldown of 5 fights/encounters. (Note: it says it's a passive but it's actually a toolbar skill, you need to use right after you die and fall on the ground. ONLY WORKS IF YOU ARE IN A PARTY OR IN A BOSS FIGHT WITH MORE THAN 1 LIFE)"
      },
      {
        slot: "2nd Learn",
        level: 30,
        type: "Active",
        name: "Inferno Rift",
        quote: "Condense fire into your leg, then kick the floor, creating a wave of flame forwards towards an enemy, hits adjacent.",
        cost: 3,
        cooldown: 9,
        moveType: "Fire",
        category: "Attack",
        damage: 12,
        scaling: "STR/75 + ARC/75",
        effect: "Deal damage to target and adjacent enemies, applying 2 sunder and 3 burn to target, and 3 burn to yourself.",
        image: "https://trello.com/1/cards/67c264dceddd935095207ce9/attachments/6976150b1ad79d849306c1f5/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125180506.png"
      }
    ]
  },
  "Gynx (Ob)": {
    innatePassives: [
      {
        level: 1,
        name: "Meditative Energy",
        description: "When meditating, gain 2 energy instead of 1."
      }
    ],
    learns: [
      {
        slot: "Level 5",
        level: 5,
        type: "Active",
        name: "Primordial Roar",
        quote: "Let out a frightening yell.",
        cost: 0,
        cooldown: 10,
        moveType: "Physical",
        category: "Utility",
        duration: 3,
        effect: "Reduces enemy damage by 25% for 3 turns (currently bugged). All statuses on you excluding Stuns do not decay for the next 3 turns. At the end of this duration you are granted 2X ShieldHP, where X equals the amount of negative statuses on you (includes stacks of the same status)."
      },
      {
        slot: "Level 20",
        level: 20,
        type: "Passive",
        name: "Energy Mantle",
        quote: "???",
        effect: "If you decide to meditate, all damage you take will be recorded and then converted into ShieldHP at the start of your next turn. This is based on the TrueDMG of an attack, disregarding any defense modifications you have. Even if you dodge an attack it is still counted. The ShieldHP provided cannot exceed your END stat and will cap at this number."
      },
      {
        slot: "Level 40",
        level: 40,
        type: "Active",
        name: "Hand of the Colossus",
        quote: "Pulverise an enemy with a powerful clap.",
        cost: 2,
        cooldown: 8,
        moveType: "Physical",
        category: "Attack",
        damage: 10,
        scaling: "STR/? + END/?",
        effect: "Enemy-wide melee attack (blockable and dodgeable). Applies 3 turns of Weakened alongside 2 turns of Taunt to all hit enemies."
      }
    ]
  }
};

function buildEntityHtml(data, title, currentLvl) {
  const activeLearn = (data.learns || []).filter(m => m.type === "Active" && currentLvl >= m.level);
  const passiveLearn = (data.learns || []).filter(m => m.type === "Passive" && currentLvl >= m.level);
  const innate = (data.innatePassives || []).filter(p => currentLvl >= p.level);

  let html = `<h2 class="moves-race-title">${title}</h2>`;

  html += `<h3 class="moves-section-title">Moves</h3>`;
  if (activeLearn.length === 0) {
    html += `<p class="moves-empty">No moves unlocked yet.</p>`;
  } else {
    for (const m of activeLearn) {
      html += `
        <div class="move-learn-header">${m.slot} <span class="move-learn-level">(Level ${m.level})</span></div>
        <div class="move-card active-move">
          <div class="move-header">
            <span class="move-badge active-badge">Active</span>
          </div>
          <div class="move-name">${m.name}</div>
          <div class="move-quote">"${m.quote}"</div>
          <div class="move-stats">
            ${m.cost !== undefined ? `<span class="move-stat">Cost: ${m.cost}</span>` : ""}
            ${m.cooldown !== undefined ? `<span class="move-stat">CD: ${m.cooldown}</span>` : ""}
            ${m.moveType ? `<span class="move-stat">Type: ${m.moveType}</span>` : ""}
            ${m.category ? `<span class="move-stat">Cat: ${m.category}</span>` : ""}
            ${m.duration !== undefined ? `<span class="move-stat">Duration: ${m.duration}</span>` : ""}
            ${m.damage !== undefined ? `<span class="move-stat">Damage: ${m.damage}</span>` : ""}
            ${m.scaling ? `<span class="move-stat">Scaling: ${m.scaling}</span>` : ""}
          </div>
          <div class="move-desc">${m.effect}</div>
          ${m.image ? `<img class="move-image" src="${m.image}" alt="${m.name}">` : ""}
        </div>`;
    }
  }

  html += `<h3 class="moves-section-title">Passives</h3>`;
  if (innate.length === 0 && passiveLearn.length === 0) {
    html += `<p class="moves-empty">No passives unlocked yet.</p>`;
  }
  for (const p of innate) {
    html += `
      <div class="move-card passive">
        <div class="move-header">
          <span class="move-badge passive-badge">Innate Passive</span>
          <span class="move-level">Level ${p.level}</span>
        </div>
        <div class="move-name">${p.name}</div>
        <div class="move-desc">${p.description}</div>
      </div>`;
  }
  for (const m of passiveLearn) {
    html += `
      <div class="move-learn-header">${m.slot} <span class="move-learn-level">(Level ${m.level})</span></div>
      <div class="move-card passive">
        <div class="move-header">
          <span class="move-badge passive-badge">Passive</span>
        </div>
        <div class="move-name">${m.name}</div>
        <div class="move-quote">"${m.quote}"</div>
        <div class="move-desc">${m.effect}</div>
        ${m.image ? `<img class="move-image" src="${m.image}" alt="${m.name}">` : ""}
      </div>`;
  }

  return html;
}

function renderMoves() {
  const container = document.getElementById("moves-content");
  const raceName = racePicker.value;
  const baseClass = classPicker.value;
  const superClass = superPicker.value;
  const currentLvl = +lvlInput.value || 1;

  if (!raceName && !baseClass) {
    container.innerHTML = `<p class="moves-placeholder">Select a race or class to view moves.</p>`;
    return;
  }

  let html = "";

  if (raceName) {
    const data = raceMoves[raceName];
    html += data
      ? buildEntityHtml(data, raceName, currentLvl)
      : `<h2 class="moves-race-title">${raceName}</h2><p class="moves-empty">No moves for this race.</p>`;
  }

  if (baseClass) {
    const data = classMoves[baseClass];
    html += data
      ? buildEntityHtml(data, baseClass, currentLvl)
      : `<h2 class="moves-race-title">${baseClass}</h2><p class="moves-empty">No moves for this class.</p>`;
  }

  if (superClass) {
    const data = classMoves[superClass];
    html += data
      ? buildEntityHtml(data, superClass, currentLvl)
      : `<h2 class="moves-race-title">${superClass}</h2><p class="moves-empty">No moves for this super class.</p>`;
  }

  container.innerHTML = html;
}

racePicker.addEventListener("change", renderMoves);
classPicker.addEventListener("change", renderMoves);
superPicker.addEventListener("change", renderMoves);

// --- Tabs ---
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

tabs.forEach(tab => {
  tab.addEventListener("click", () => {

    const target = tab.dataset.tab;

    // remove active from all
    tabs.forEach(t => t.classList.remove("active"));
    panels.forEach(p => p.classList.remove("active"));

    // activate clicked
    tab.classList.add("active");
    document.getElementById(target).classList.add("active");

  });
});