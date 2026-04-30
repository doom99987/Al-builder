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

function updateClassPickerLock() {
  const lvl = Math.min(Max_Lvl, Math.max(Min_Lvl, +lvlInput.value || Min_Lvl));
  const locked = lvl < 5;
  classPicker.disabled = locked;
  if (locked) {
    updateGold(prevClassSelection, "");
    updateGold(prevSuperSelection, "");
    prevClassSelection = "";
    prevSuperSelection = "";
    classPicker.value = "";
    superPicker.innerHTML = "";
    superPicker.disabled = true;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— Select Class First —";
    superPicker.appendChild(opt);
  }
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
  updateClassPickerLock();
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
    val.dataset.prev = val.value;
    spent++;
    updatePoints();
    updatePecents();
  });

  minus.addEventListener("click", () => {
    if (+val.value <= 0) return;
    val.value = +val.value - 1;
    val.dataset.prev = val.value;
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

const armourItems = {};
const soulTreeBonuses = { "crit-dmg": 0, "crit-chance": 0, endFlat: 0 };

function calcPercentage(stat, val){
  const lckAllocated = +document.querySelector('.stat-row[data-stat="lck"] .stat-val').value;
  const lck = lckAllocated + (raceBase.lck ?? 0);
  const formulas = {
    str:         v => 100 + v * 2.5,
    arc:         v => 100 + v * 3,
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
  const armourEl = document.getElementById("armour-main");
  const armour = armourItems?.[armourEl?.value] || {};
  const armourPct = armour.pct || {};
  document.querySelectorAll(".percent-item").forEach(item => {
    const stat = item.dataset.stat;
    const row = document.querySelector(`.stat-row[data-stat="${stat}"] .stat-val`);
    const allocated = row ? +row.value : 0;
    const flatBonus = armour[stat] ?? 0;
    const val = allocated + (raceBase[stat] ?? 0) + flatBonus;
    const base = calcPercentage(stat, val);
    const pctBonus = (armourPct[stat] ?? 0) + (soulTreeBonuses[stat] ?? 0);
    let display;
    if (base === "—") {
      display = "—";
    } else if (stat === "end") {
      display = (parseFloat(base) + (soulTreeBonuses.endFlat ?? 0)).toFixed(1);
    } else {
      display = (parseFloat(base) + pctBonus).toFixed(1);
    }
    const suffix = stat === "end" ? "" : "%";
    item.querySelector(".percent-val").textContent = display + suffix;
  });
}

// Init
updatePecents();

// --- Marks ---
// To add a mark to the picker: "Mark Name": {}
const markItems = {
  "Venia": {},
  "Astra": {},
  "Petent": {}
};

// To add mark moves/passives: "Mark Name": { innatePassives: [...], learns: [...] }
const markMoves = {
  "Venia": {
    innatePassives: [],
    learns: [
      {
        slot: "Tier 1",
        level: 1,
        type: "Passive",
        name: "Venia",
        quote: "",
        effect: "Grants you the item \"Muto\", allowing you to sell various artifacts for Primal Essence and purchase others. The buy:sell ratio for most items is 1:3.5. This essence persists on the slot through wipes.\n\nPrices:\n• Memory Fragment / Soul Dust — 10 Sell | 35 Buy\n• Resplendent Essence / Darksigil — 100 Sell | 350 Buy\n• Shifting Hourglass — 100 Sell | 245 Buy\n• Reality Watch / Narthana's Sigil — 80 Sell | 280 Buy\n• Metrom's Amulet — 180 Sell | 630 Buy\n• Skyward Totem — ??? Sell | 1025 Buy"
      },
      {
        slot: "Tier 3",
        level: 1,
        type: "Active",
        name: "Permuth",
        quote: "Exchange 5% of your health into a random 40% stat buff for 3 turns, has weighting towards invested stats. Fails if you don't have enough health.",
        cost: 2,
        cooldown: 10,
        moveType: "Magic",
        category: "Buff",
        duration: 2,
        effect: "Consumes 5% of your HP and increases a random stat by 40%. Has a ~50% chance to increase your highest invested stat and a ~50% chance to increase another stat instead. Buffs towards Endurance result in a defense buff.\n\nNote: Stats inside the brackets of your stats are not included in stat buffs.",
        image: "https://trello.com/1/cards/67c2f3cde91e26bd11540f15/attachments/697898d91022e8aec0bfecbc/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127154927.png"
      },
      {
        slot: "Tier 5",
        level: 1,
        type: "Passive",
        name: "Venian",
        quote: "",
        effect: "When finishing a fight, you receive gold equal to 5× your level. Your level is the only factor which affects the gold you receive."
      }
    ]
  },
  "Astra": {
    innatePassives: [],
    learns: [
      {
        slot: "Tier 1",
        level: 1,
        type: "Passive",
        name: "Starborn",
        quote: "",
        effect: "Whenever you crit or apply a status effect you spawn a miniature star. You can have 8 stars in total. Stars are consumed by moves gained at later tiers."
      },
      {
        slot: "Tier 3",
        level: 1,
        type: "Active",
        name: "Edo",
        quote: "Activate your constellation with at least 5 sparks, granting your team a random positive effect.",
        cost: 1,
        cooldown: 8,
        moveType: "Magic",
        category: "Buff",
        duration: 5,
        effect: "Consumes 5+ stars to give everyone on the team a random positive effect (cleanse, heal, speed, defense, or enchant proc chance).",
        image: "https://trello.com/1/cards/67c2f3cfa9460f3f089beb7a/attachments/69789bb19879fb04c0f15530/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127160327.png"
      },
      {
        slot: "Tier 5",
        level: 1,
        type: "Active",
        name: "Utor",
        quote: "Consume 2 sparks of your constellation, instantly restoring some health and energy.",
        cost: 1,
        cooldown: 7,
        moveType: "Magic",
        category: "Buff",
        effect: "Use 2–4 stars to restore 20%, 33%, or 40% of your max HP. Grants 2 energy if used at max stars. Affected by both Incoming and Outgoing heal stats.",
        image: "https://trello.com/1/cards/67c2f3cfa9460f3f089beb7a/attachments/69789bb279be04ca19c84ad2/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127160357.png"
      }
    ]
  },
  "Petent": {
    innatePassives: [],
    learns: [
      {
        slot: "Tier 1",
        level: 1,
        type: "Passive",
        name: "Rima",
        quote: "",
        effect: "Grants you the item \"Rima\", which allows you to teleport to a range of locations. Both you and anyone in your party can go through these portals.\n\nAvailable locations:\nZombie Mushroom, Caldera, Sand Golem, Ruins, Blades, Volcano, Cursed Corpse, Deeproot, Westwood, Cessgrounds"
      },
      {
        slot: "Tier 3",
        level: 1,
        type: "Active",
        name: "Conisura",
        quote: "Open a rift on an enemy, sucking out all status effects currently applied to them, then exploding dealing damage based on how many status effects were absorbed.",
        cost: 3,
        cooldown: 10,
        moveType: "Magic",
        category: "Attack",
        damage: 7,
        scaling: "STR/ARC",
        effect: "Removes all negative statuses on the target, increasing base damage by 3 per unique status absorbed, or 6 if the status was hexed.",
        image: "https://trello.com/1/cards/67c2f3caf633ab0ca6ab3ffd/attachments/6978984d4c3facdd6ccd7db6/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127154847.png"
      },
      {
        slot: "Tier 5",
        level: 1,
        type: "Passive",
        name: "Dominioneer",
        quote: "",
        effect: "Decreases all environmental damage by a bit. (Currently bugged and does not work.)"
      }
    ]
  }
};

const markPickers = document.querySelectorAll(".mark-picker");

const markPicker = document.getElementById("mark-1");

markPickers.forEach(picker => {
  Object.keys(markItems).forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    picker.appendChild(opt);
  });
});

markPicker.addEventListener("change", renderMoves);

// --- Enchants ---
// To add: "Enchant Name": { level: N or null, effect: "..." }
const enchantItems = {
  "Cursed": {
    level: 35,
    effect: "Attacks have a 16.6% chance to apply 3 stacks of one of: Cursed, Poisoned, Blinded, Sundered, Weakened, Vulnerable, or Burning.\n\nGrants immunity to Cess Anomalies in Cessgrounds and removes Cess Horror from encounters in Deeproot Canopy.\n\nIncreases damage by 30% against Cursed enemies or 20% against Sundered enemies. Does not stack — only the highest buff applies."
  },
  "Blessed": {
    level: null,
    effect: "Attacks build up light within enemies. After 3 stacks it explodes, dealing 2% of max HP and applying 2 Sundered. Cannot trigger twice in one turn."
  },
  "Inferno": {
    level: 25,
    effect: "Attacks have a 25% chance to apply 3 Burning, even if the enemy dodges.\n\nAll attacks deal 20% more damage when Burn is applied, including the attack that inflicts Burning."
  },
  "Midas": {
    level: null,
    effect: "Increased drop rates (untested).\n\nGain gold on enemy death.\n\nAttacks have a 16.6% chance to deal 15% extra damage."
  },
  "Reaper": {
    level: 35,
    effect: "On proc: boosts damage up to 25% based on the enemy's current HP (similar to Striking Shards). Also heals for 10% of damage dealt, excluding the Reaper damage increase.\n\nGrants a regen buff of 1% of max HP per missing life, affected by your Outgoing stat. Bonus lives from Daminos, Sheea, and Dullahan count. Mortal trial players receive no buff."
  },
  "Lifesong": {
    level: null,
    effect: "On hitting an enemy or healing an ally (Parasitic Leech lifesteal does not count), you have a ?% chance to trigger a 20% Incoming and Outgoing healing buff for 3 turns. Can only proc once per turn from an attack, and up to 3 times total per turn combined with heals."
  },
  "Spectral": {
    level: null,
    effect: "Gives all your attacks a ?% chance to negate all enemy defence."
  },
  "Hiemal": {
    level: null,
    effect: "Attacks have a 25% chance to apply 2 Cold and 2 Weakened.\n\nAttacks have a 10% chance to apply 1 Stun.\n\nProc chances are independent and can both trigger simultaneously."
  },
  "Frosted": {
    level: null,
    effect: "Attacks have a ~16?% chance (needs testing) to apply 2 Cold. Not increased by Icerind weapon, though Icerind itself can apply 2 Cold.\n\nCritical hits on Cold enemies cause a small AOE explosion (cannot execute targets, 10 base damage, pseudo-scales with damage modifiers). Triggers once per attack, then goes on cooldown."
  },
  "Ivory": {
    level: null,
    effect: "Gaining energy increases all your stats by 4% for 3 turns."
  }
};

const enchantPicker = document.getElementById("enchant-picker");
const enchantDesc   = document.getElementById("enchant-desc");

Object.keys(enchantItems).forEach(name => {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  enchantPicker.appendChild(opt);
});

// --- Shards ---
// To add: "Shard Name": {}
const shardItems = {
};

const shardPickers = document.querySelectorAll(".shard-picker");

shardPickers.forEach(picker => {
  Object.keys(shardItems).forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    picker.appendChild(opt);
  });
});

function enforceUniqueShards() {
  const selected = Array.from(shardPickers).map(p => p.value).filter(v => v !== "");
  shardPickers.forEach(picker => {
    Array.from(picker.options).forEach(opt => {
      if (opt.value === "") return;
      opt.disabled = selected.includes(opt.value) && picker.value !== opt.value;
    });
  });
}

shardPickers.forEach(picker => picker.addEventListener("change", enforceUniqueShards));

enchantPicker.addEventListener("change", () => {
  const item = enchantItems[enchantPicker.value];
  if (!item) { enchantDesc.innerHTML = ""; return; }
  const lvlLine = item.level ? `<span class="enchant-level">Req. Level ${item.level}</span>` : `<span class="enchant-level">No level requirement</span>`;
  enchantDesc.innerHTML = lvlLine + "<br><br>" + item.effect.replace(/\n/g, "<br>");
});

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

// --- Armour ---
// To add armour: "Item Name": { str, arc, end, spd, lck, pct: { str, arc, end, spd, lck } }
// Flat stats add to the stat value before formula. pct adds directly to the output % value.

const armourPicker = document.getElementById("armour-main");

Object.keys(armourItems).forEach(name => {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  armourPicker.appendChild(opt);
});

armourPicker.addEventListener("change", updatePecents);

// --- Classes ---
// To add a class: "ClassName": ["SuperClass1", "SuperClass2", ...]
const classes = {
  "Thief": ["Ranger (Or)", "Rouge (N)", "Assassin (Ch)"],
  "Warrior":["Paladin (Or)", "Blade Dancer (N)", "Berserker (Ch)"],
  "Wizard":["Elementalist (Or)", "Hexer (N)", "Necromancer (Ch)"],
  "Martial Artist":["Monk (Or)", "Brawler (N)", "Darkwraith (Ch)"],
  "Slayer":["Saint (Or)", "Lancer (N)", "Impaler (Ch)"],
  "Marauder":["Lionheart (N)"],
  "Sentry":["Citadel (Or)", "Arbiter (N)"]
};

const classPicker = document.getElementById("class-picker");
const superPicker = document.getElementById("super-picker");
const goldDisplay = document.getElementById("Gold");

const CLASS_GOLD_COST = { "Warrior": 200, "Thief": 200, "Slayer": 200, "Wizard":120,
  "Martial Artist":220, "Sentry":500, "Assassin (Ch)":2000, "Paladin (Or)":2000 };
let totalGold = 0;
let prevClassSelection = "";
let prevSuperSelection = "";

function updateGold(oldClass, newClass) {
  if (CLASS_GOLD_COST[oldClass]) totalGold -= CLASS_GOLD_COST[oldClass];
  if (CLASS_GOLD_COST[newClass]) totalGold += CLASS_GOLD_COST[newClass];
  goldDisplay.textContent = totalGold;
}

Object.keys(classes).forEach(name => {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  classPicker.appendChild(opt);
});

classPicker.addEventListener("change", () => {
  const selected = classPicker.value;
  updateGold(prevClassSelection, selected);
  updateGold(prevSuperSelection, "");
  prevClassSelection = selected;
  prevSuperSelection = "";
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
        scaling: "STR",
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
        scaling: "STR",
        effect: "Grab and throw sand into the enemy's eyes, inflict 2 stacks of Blind.",
        image: "https://trello.com/1/cards/67b3291ea782e28bbc86acf6/attachments/69788fa731f165ba13304300/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127151225.png"
      }
    ]
  },
  "Ranger (Or)": { innatePassives: [], learns: [] },
  "Rouge (N)": { innatePassives: [], learns: [] },
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
        scaling: "STR",
        effect: "Increases damage dealt by 100% if invisible while attacking. Applies 2 Cursed if the target is poisoned.",
        image: "https://trello.com/1/cards/67b32956205bcc638e52a56b/attachments/69800f95a11c466dc31c150c/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202074318.png"
      }
    ]
  },
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
        scaling: "STR",
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
        scaling: "STR",
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
        scaling: "STR/END",
        effect: "Applies 3 turns of Taunt onto the main target. Has a 50% chance to apply 2 Taunt to adjacent targets. (Difficulty: 6 bars at base)",
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
  "Blade Dancer (N)": { innatePassives: [], learns: [] },
  "Berserker (Ch)": { innatePassives: [], learns: [] },
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
  "Elementalist (Or)": { innatePassives: [], learns: [] },
  "Hexer (N)": { innatePassives: [], learns: [] },
  "Necromancer (Ch)": { innatePassives: [], learns: [] },
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
  "Monk (Or)": { innatePassives: [], learns: [] },
  "Brawler (N)": { innatePassives: [], learns: [] },
  "Darkwraith (Ch)": { innatePassives: [], learns: [] },
  "Slayer": {
    innatePassives: [
      {
        level: 1,
        name: "Hunker Down",
        description: "After you GUARD, gain a 15% defense buff for 3 turns."
      },
      {
        level: 1,
        name: "High Pressure",
        description: "When combat starts apply 3 Pressure to all enemies."
      }
    ],
    learns: [
      {
        slot: "Class Active",
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
        slot: "Class Active",
        level: 5,
        type: "Active",
        name: "Lookout",
        quote: "Prepare yourself to defend a target of your choice.",
        cost: 2,
        cooldown: 5,
        moveType: "Physical",
        category: "Attack",
        damage: 9,
        scaling: "STR/75",
        effect: "Single-target melee sure-hit sentry attack."
      },
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
  "Saint (Or)": { innatePassives: [], learns: [] },
  "Lancer (N)": { innatePassives: [], learns: [] },
  "Impaler (Ch)": { innatePassives: [], learns: [] },
  "Marauder": { innatePassives: [], learns: [] },
  "Lionheart (N)": { innatePassives: [], learns: [] },
  "Sentry": { innatePassives: [], learns: [] },
  "Citadel (Or)": { innatePassives: [], learns: [] },
  "Arbiter (N)": { innatePassives: [], learns: [] }
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

function activeCardHtml(m) {
  return `
    <div class="move-learn-header">${m.slot} <span class="move-learn-level">(Lv${m.level})</span></div>
    <div class="move-card active-move">
      <div class="move-header"><span class="move-badge active-badge">Active</span></div>
      <div class="move-name">${m.name}</div>
      ${m.quote ? `<div class="move-quote">"${m.quote}"</div>` : ""}
      <div class="move-stats">
        ${m.cost !== undefined ? `<span class="move-stat">Cost: ${m.cost}</span>` : ""}
        ${m.cooldown !== undefined ? `<span class="move-stat">CD: ${m.cooldown}</span>` : ""}
        ${m.moveType ? `<span class="move-stat">Type: ${m.moveType}</span>` : ""}
        ${m.category ? `<span class="move-stat">Cat: ${m.category}</span>` : ""}
        ${m.duration !== undefined ? `<span class="move-stat">Dur: ${m.duration}</span>` : ""}
        ${m.damage !== undefined ? `<span class="move-stat">Dmg: ${m.damage}</span>` : ""}
        ${m.scaling ? `<span class="move-stat">Scl: ${m.scaling}</span>` : ""}
      </div>
      <div class="move-desc">${m.effect}</div>
      ${m.image ? `<img class="move-image" src="${m.image}" alt="${m.name}">` : ""}
    </div>`;
}

function innateCardHtml(p) {
  return `
    <div class="move-card passive">
      <div class="move-header">
        <span class="move-badge passive-badge">Innate</span>
        <span class="move-level">Lv${p.level}</span>
      </div>
      <div class="move-name">${p.name}</div>
      <div class="move-desc">${p.description}</div>
    </div>`;
}

function passiveCardHtml(m) {
  return `
    <div class="move-learn-header">${m.slot} <span class="move-learn-level">(Lv${m.level})</span></div>
    <div class="move-card passive">
      <div class="move-header"><span class="move-badge passive-badge">Passive</span></div>
      <div class="move-name">${m.name}</div>
      ${m.quote ? `<div class="move-quote">"${m.quote}"</div>` : ""}
      <div class="move-desc">${m.effect}</div>
      ${m.image ? `<img class="move-image" src="${m.image}" alt="${m.name}">` : ""}
    </div>`;
}

function entityMovesHtml(data, lvl) {
  const actives = (data.learns || []).filter(m => m.type === "Active" && lvl >= m.level);
  let h = `<h3 class="moves-section-title">Moves</h3>`;
  if (!actives.length) h += `<p class="moves-empty">No moves unlocked yet.</p>`;
  else actives.forEach(m => h += activeCardHtml(m));
  return h;
}

function entityPassivesHtml(data, lvl) {
  const innates  = (data.innatePassives || []).filter(p => lvl >= p.level);
  const passives = (data.learns || []).filter(m => m.type === "Passive" && lvl >= m.level);
  let h = `<h3 class="moves-section-title">Passives</h3>`;
  if (!innates.length && !passives.length) h += `<p class="moves-empty">No passives unlocked yet.</p>`;
  innates.forEach(p => h += innateCardHtml(p));
  passives.forEach(m => h += passiveCardHtml(m));
  return h;
}

function renderMoves() {
  const container = document.getElementById("moves-content");
  const raceName   = racePicker.value;
  const baseClass  = classPicker.value;
  const superClass = superPicker.value;
  const markName   = markPicker.value;
  const lvl = +lvlInput.value || 1;

  if (!raceName && !baseClass && !markName) {
    container.innerHTML = `<p class="moves-placeholder">Select a race, class, or mark to view moves.</p>`;
    return;
  }

  const raceData  = raceName   ? raceMoves[raceName]    : null;
  const baseData  = baseClass  ? classMoves[baseClass]  : null;
  const superData = superClass ? classMoves[superClass] : null;
  const markData  = markName   ? markMoves[markName]    : null;

  let html = "";

  // --- Side-by-side: Race | Base Class | Super Class | Mark ---
  html += `<div class="moves-columns">`;

  html += `<div class="moves-col">`;
  if (raceName) {
    html += `<h2 class="moves-race-title">${raceName}</h2>`;
    if (raceData) {
      html += entityMovesHtml(raceData, lvl);
      html += entityPassivesHtml(raceData, lvl);
    } else {
      html += `<p class="moves-empty">No moves for this race.</p>`;
    }
  }
  html += `</div>`;

  html += `<div class="moves-col">`;
  if (baseClass) {
    html += `<div class="moves-entity-label">Base Class</div>`;
    html += `<h2 class="moves-race-title">${baseClass}</h2>`;
    if (baseData) {
      html += entityMovesHtml(baseData, lvl);
      html += entityPassivesHtml(baseData, lvl);
    } else {
      html += `<p class="moves-empty">No moves for this class.</p>`;
    }
  }
  html += `</div>`;

  html += `<div class="moves-col">`;
  if (superClass) {
    html += `<div class="moves-entity-label">Super Class</div>`;
    html += `<h2 class="moves-race-title">${superClass}</h2>`;
    if (superData) {
      html += entityMovesHtml(superData, lvl);
      html += entityPassivesHtml(superData, lvl);
    } else {
      html += `<p class="moves-empty">No moves for this super class.</p>`;
    }
  }
  html += `</div>`;

  html += `<div class="moves-col">`;
  if (markName) {
    html += `<div class="moves-entity-label">Mark</div>`;
    html += `<h2 class="moves-race-title">${markName}</h2>`;
    if (markData) {
      html += entityMovesHtml(markData, lvl);
      html += entityPassivesHtml(markData, lvl);
    } else {
      html += `<p class="moves-empty">No moves for this mark.</p>`;
    }
  }
  html += `</div>`;

  html += `</div>`; // end .moves-columns

  // --- Combined sections ---
  const allData = [raceData, baseData, superData, markData].filter(Boolean);
  if (allData.length > 1) {
    const allActives = allData.flatMap(d => (d.learns || []).filter(m => m.type === "Active" && lvl >= m.level));
    html += `<div class="moves-combined-section">`;
    html += `<h2 class="moves-combined-title">All Moves</h2>`;
    if (!allActives.length) html += `<p class="moves-empty">No moves unlocked yet.</p>`;
    else allActives.forEach(m => html += activeCardHtml(m));
    html += `</div>`;

    const allInnates  = allData.flatMap(d => (d.innatePassives || []).filter(p => lvl >= p.level));
    const allPassives = allData.flatMap(d => (d.learns || []).filter(m => m.type === "Passive" && lvl >= m.level));
    html += `<div class="moves-combined-section">`;
    html += `<h2 class="moves-combined-title">All Passives</h2>`;
    if (!allInnates.length && !allPassives.length) html += `<p class="moves-empty">No passives unlocked yet.</p>`;
    allInnates.forEach(p => html += innateCardHtml(p));
    allPassives.forEach(m => html += passiveCardHtml(m));
    html += `</div>`;
  }

  container.innerHTML = html;
}

racePicker.addEventListener("change", renderMoves);
classPicker.addEventListener("change", renderMoves);
superPicker.addEventListener("change", () => {
  const selected = superPicker.value;
  updateGold(prevSuperSelection, selected);
  prevSuperSelection = selected;
  renderMoves();
});

// --- Soul Tree ---
const ROMAN = ["—", "I", "II", "III", "IV", "V"];

const soulTreeData = {
  "Path of Destruction": [
    { id: "denature",      name: "Denature",                 desc: "DoT Damage +{v}%",                                               perRank: 2,   maxRank: 5, costs: [25,50,75,100,125] },
    { id: "crit_point",   name: "Critical Point",            desc: "Base crit damage +{v}%",                                         perRank: 5,   maxRank: 5, costs: [50,100,150,200,250],  bonus: {"crit-dmg": 5} },
    { id: "strike_first", name: "Strike First, No Mercy",    desc: "First attack +{v}% damage (expires after 2 turns)",              perRank: 5,   maxRank: 5, costs: [100,200,300,400,500] },
    { id: "lil_crit",     name: "Lil Bit of Crit",           desc: "Base crit chance +{v}%",                                         perRank: 1,   maxRank: 5, costs: [50,100,150,200,250],  bonus: {"crit-chance": 1} },
    { id: "com_focus",    name: "Combat Focus",               desc: "After meditating, +{v}% damage for 2 turns",                    perRank: 2,   maxRank: 5, costs: [50,100,150,200,250] }
  ],
  "Path of Empowerment": [
    { id: "end_vessel",   name: "Enduring Vessel",            desc: "Base HP +{v}",                                                   perRank: 2,   maxRank: 5, costs: [20,40,60,80,100],    hpFlat: 2 },
    { id: "calm_mind",    name: "Calm Mind",                  desc: "Meditate damage vulnerability -{v}%",                            perRank: 5,   maxRank: 3, costs: [50,100,150] },
    { id: "bat_renewal",  name: "Battle Renewal",             desc: "Post-combat healing +{v}%",                                      perRank: 2.5, maxRank: 4, costs: [20,40,60,80] },
    { id: "mending",      name: "Mending",                    desc: "+{v} HP regen per turn (does not scale with outgoing)",          perRank: 0.5, maxRank: 5, costs: [20,40,60,80,100] }
  ]
};

const soulTreeRanks = {};
Object.values(soulTreeData).flat().forEach(n => { soulTreeRanks[n.id] = 0; });

function recalcSoulTreeBonuses() {
  soulTreeBonuses["crit-dmg"]    = 0;
  soulTreeBonuses["crit-chance"] = 0;
  soulTreeBonuses.endFlat        = 0;
  Object.values(soulTreeData).flat().forEach(node => {
    const rank = soulTreeRanks[node.id];
    if (!rank) return;
    if (node.bonus) Object.entries(node.bonus).forEach(([k, v]) => { soulTreeBonuses[k] = (soulTreeBonuses[k] || 0) + rank * v; });
    if (node.hpFlat) soulTreeBonuses.endFlat += rank * node.hpFlat;
  });
}

function renderSoulTree() {
  const container = document.getElementById("soul-tree-content");
  let html = `<div class="soul-tree-columns">`;

  for (const [pathName, nodes] of Object.entries(soulTreeData)) {
    html += `<div class="soul-tree-path"><h3 class="soul-path-title">${pathName}</h3>`;
    for (const node of nodes) {
      const rank = soulTreeRanks[node.id];
      const val  = +(rank * node.perRank).toFixed(1);
      const desc = node.desc.replace("{v}", val);
      const nextCost = rank < node.maxRank ? node.costs[rank] : null;
      html += `
        <div class="soul-node ${rank > 0 ? "soul-node-active" : ""}">
          <div class="soul-node-top">
            <span class="soul-node-name">${node.name}</span>
            <div class="soul-rank-ctrl">
              <button class="soul-btn" onclick="changeRank('${node.id}',-1)">−</button>
              <span class="soul-rank-val">${ROMAN[rank]} / ${ROMAN[node.maxRank]}</span>
              <button class="soul-btn" onclick="changeRank('${node.id}',1)">+</button>
            </div>
          </div>
          <div class="soul-node-desc">${desc}</div>
          <div class="soul-node-footer">
            ${nextCost ? `<span class="soul-next-cost">Next: ${nextCost}</span>` : rank === node.maxRank ? `<span class="soul-maxed">MAXED</span>` : ""}
          </div>
        </div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}

function changeRank(nodeId, delta) {
  const node = Object.values(soulTreeData).flat().find(n => n.id === nodeId);
  if (!node) return;
  soulTreeRanks[nodeId] = Math.max(0, Math.min(node.maxRank, soulTreeRanks[nodeId] + delta));
  recalcSoulTreeBonuses();
  renderSoulTree();
  updatePecents();
}

renderSoulTree();

// === MASTERY TREE ===

const MASTERY_TOTAL_POINTS = 35;

const masteryNodeMap = {};

const masteryNodes = [
  // Shared trunk
  { id: "s1",  name: "Node",         type: "node",         branch: "shared", parent: null   },
  { id: "s2",  name: "Node",         type: "node",         branch: "shared", parent: "s1"   },
  { id: "s3",  name: "Node",         type: "node",         branch: "shared", parent: "s2"   },
  { id: "s4",  name: "Node",         type: "node",         branch: "shared", parent: "s3"   },
  // Red (left) branch:
  //   node → [node | node] → [node | node] → breakthrough → [◆Mastery LEFT | node RIGHT] → 2 nodes → breakthrough → node → ◆Mastery
  { id: "l1",   name: "Node",         type: "node",         branch: "red",   parent: "s4"    },
  { id: "l2",   name: "Node",         type: "node",         branch: "red",   parent: "l1"    },
  { id: "l3",   name: "Node",         type: "node",         branch: "red",   parent: "l1"    },
  { id: "l4",   name: "Node",         type: "node",         branch: "red",   parent: "l2"    },
  { id: "l5",   name: "Node",         type: "node",         branch: "red",   parent: "l3"    },
  { id: "lbt1", name: "Breakthrough", type: "breakthrough", branch: "red",   parent: "l4",   shardCost: 1 },
  { id: "l6",   name: "Node",         type: "node",         branch: "red",   parent: "lbt1"  }, // main path node; Mastery links left
  { id: "lm1",  name: "Mastery",      type: "mastery",      branch: "red",   parent: "l6"    }, // side Mastery to the LEFT of l6
  { id: "l7",   name: "Node",         type: "node",         branch: "red",   parent: "l6"    }, // 1st node below l6
  { id: "l8",   name: "Node",         type: "node",         branch: "red",   parent: "l7"    }, // 2nd node below l6
  { id: "lbt2", name: "Breakthrough", type: "breakthrough", branch: "red",   parent: "l8",   shardCost: 1 },
  { id: "l9",   name: "Node",         type: "node",         branch: "red",   parent: "lbt2"  },
  { id: "lm2",  name: "Mastery",      type: "mastery",      branch: "red",   parent: "l9"    },
  // Green (center) branch
  { id: "c1",  name: "Node",         type: "node",         branch: "green",  parent: "s4"   },
  { id: "c2a", name: "Node",         type: "node",         branch: "green",  parent: "c1"   },
  { id: "c2b", name: "Node",         type: "node",         branch: "green",  parent: "c1"   },
  { id: "c3a", name: "Node",         type: "node",         branch: "green",  parent: "c2a"  },
  { id: "cb1", name: "Breakthrough", type: "breakthrough", branch: "green",  parent: "c3a", shardCost: 1 },
  { id: "cm1", name: "Mastery",      type: "mastery",      branch: "green",  parent: "cb1"  },
  { id: "c4",  name: "Node",         type: "node",         branch: "green",  parent: "cm1"  },
  { id: "c5a", name: "Node",         type: "node",         branch: "green",  parent: "c4"   },
  { id: "c5b", name: "Node",         type: "node",         branch: "green",  parent: "c4"   },
  { id: "cb2", name: "Breakthrough", type: "breakthrough", branch: "green",  parent: "c5a", shardCost: 1 },
  { id: "cm2", name: "Mastery",      type: "mastery",      branch: "green",  parent: "cb2"  },
  // Blue (right) branch — mirrored structure, Mastery is to the RIGHT of the node
  //   node → [node | node] → [node | node] → breakthrough → [node LEFT | ◆Mastery RIGHT] → 2 nodes → breakthrough → node → ◆Mastery
  { id: "r1",   name: "Node",         type: "node",         branch: "blue",  parent: "s4"    },
  { id: "r2",   name: "Node",         type: "node",         branch: "blue",  parent: "r1"    },
  { id: "r3",   name: "Node",         type: "node",         branch: "blue",  parent: "r1"    },
  { id: "r4",   name: "Node",         type: "node",         branch: "blue",  parent: "r2"    },
  { id: "r5",   name: "Node",         type: "node",         branch: "blue",  parent: "r3"    },
  { id: "rbt1", name: "Breakthrough", type: "breakthrough", branch: "blue",  parent: "r4",   shardCost: 1 },
  { id: "r6",   name: "Node",         type: "node",         branch: "blue",  parent: "rbt1"  }, // main path node; Mastery links right
  { id: "rm1",  name: "Mastery",      type: "mastery",      branch: "blue",  parent: "r6"    }, // side Mastery to the RIGHT of r6
  { id: "r7",   name: "Node",         type: "node",         branch: "blue",  parent: "r6"    },
  { id: "r8",   name: "Node",         type: "node",         branch: "blue",  parent: "r7"    },
  { id: "rbt2", name: "Breakthrough", type: "breakthrough", branch: "blue",  parent: "r8",   shardCost: 1 },
  { id: "r9",   name: "Node",         type: "node",         branch: "blue",  parent: "rbt2"  },
  { id: "rm2",  name: "Mastery",      type: "mastery",      branch: "blue",  parent: "r9"    },
];

masteryNodes.forEach(n => masteryNodeMap[n.id] = n);

const masteryState = {};
masteryNodes.forEach(n => masteryState[n.id] = false);

// Row groupings for rendering. Each inner array = one horizontal row.
// For mixed [mastery, node] rows, mastery is a side branch; the node is the main path.
const masteryBranchRows = {
  red: [
    ["l1"],            // node 1
    ["l2"],      // node 2
    ["l3", "l4"],//node 3 and 4 (side by side fork)
    ["l5"],      // nodes 5 
    ["lbt1"],          // breakthrough 1
    ["lm1", "l6"],     // ◆Mastery (left side branch) | node (right, main path)
    ["l7"],            // node below l6
    ["l8"],            // node below l7
    ["lbt2"],          // breakthrough 2
    ["l9"],            // node after bt2
    ["lm2"],           // ◆Mastery 2
  ],
  green: [
    ["c1"],
    ["c2a", "c2b"],
    ["c3a"],
    ["cb1"],
    ["cm1"],
    ["c4"],
    ["c5a", "c5b"],
    ["cb2"],
    ["cm2"],
  ],
  blue: [
    ["r1"],            // node 1
    ["r2"],      // nodes 2 & 3 (side by side fork)
    ["r3", "r4"],    // nodes 4 & 5 (side by side fork continues)
    ["r5"],
    ["rbt1"],          // breakthrough 1
    ["r6", "rm1"],     // node (left, main path) | ◆Mastery (right side branch)
    ["r7"],            // node below r6
    ["r8"],            // node below r7
    ["rbt2"],          // breakthrough 2
    ["r9"],            // node after bt2
    ["rm2"],           // ◆Mastery 2
  ],
};

function masteryPointsSpent() {
  return masteryNodes
    .filter(n => masteryState[n.id] && n.type !== "breakthrough")
    .reduce((sum, n) => sum + (n.type === "mastery" ? 5 : 1), 0);
}

function masteryShardsSpent() {
  return masteryNodes.filter(n => masteryState[n.id] && n.type === "breakthrough").length;
}

function hasMasteryActiveChild(id) {
  return masteryNodes.some(n => n.parent === id && masteryState[n.id]);
}

function toggleMasteryNode(id) {
  const node = masteryNodeMap[id];
  if (!node) return;

  if (masteryState[id]) {
    // Deactivate only if no active children depend on it
    if (hasMasteryActiveChild(id)) return;
    masteryState[id] = false;
  } else {
    // Require parent to be active
    if (node.parent && !masteryState[node.parent]) return;
    // Check point budget (breakthroughs cost shards, not points)
    if (node.type !== "breakthrough") {
      const cost = node.type === "mastery" ? 5 : 1;
      if (masteryPointsSpent() + cost > MASTERY_TOTAL_POINTS) return;
    }
    masteryState[id] = true;
  }

  updateMasteryDisplay();
}

function resetMastery() {
  masteryNodes.forEach(n => masteryState[n.id] = false);
  updateMasteryDisplay();
}

function masteryNodeHtml(id) {
  const node = masteryNodeMap[id];
  const active = masteryState[id];
  const parentOk = !node.parent || masteryState[node.parent];
  const locked = !parentOk;
  const childLocked = active && hasMasteryActiveChild(id);

  const costLabel = node.type === "mastery" ? "5 pts"
                  : node.type === "breakthrough" ? "1 echo shard"
                  : "1 pt";

  let cls = `mn-node mn-${node.branch} mn-type-${node.type}`;
  if (active) cls += " mn-active";
  if (locked) cls += " mn-locked";
  if (childLocked) cls += " mn-child-locked";

  const cursor = locked || childLocked ? "not-allowed" : "pointer";
  return `<div class="${cls}" id="mn-${id}" onclick="toggleMasteryNode('${id}')" title="${node.name} — ${costLabel}" style="cursor:${cursor}"></div>`;
}

function masteryBranchHtml(branch) {
  const rows = masteryBranchRows[branch];
  let html = `<div class="mastery-branch mastery-branch-${branch}">`;
  rows.forEach((rowIds, i) => {
    let rowClass = "mastery-row";
    if (i === 0) rowClass += " mastery-row-first";

    // Mixed mastery+node row: add class so connector line aligns with main-path node
    if (rowIds.length === 2) {
      const first = masteryNodeMap[rowIds[0]];
      const second = masteryNodeMap[rowIds[1]];
      if (first && second) {
        if (first.type === "mastery" && second.type !== "mastery") {
          rowClass += " mastery-side-left";  // mastery on left → connector tracks right node
        } else if (second.type === "mastery" && first.type !== "mastery") {
          rowClass += " mastery-side-right"; // mastery on right → connector tracks left node
        }
      }
    }

    html += `<div class="${rowClass}">`;
    rowIds.forEach(id => {
      html += `<div class="mn-wrap">${masteryNodeHtml(id)}</div>`;
    });
    html += `</div>`;
  });
  html += `</div>`;
  return html;
}

function renderMastery() {
  const container = document.getElementById("mastery-tree-container");
  if (!container) return;

  let html = `<div class="mastery-trunk">`;
  ["s1","s2","s3","s4"].forEach(id => {
    html += `<div class="mastery-row"><div class="mn-wrap">${masteryNodeHtml(id)}</div></div>`;
  });
  html += `</div>`;

  html += `<div class="mastery-branch-split"><div class="mastery-split-h"></div></div>`;

  html += `<div class="mastery-branches">`;
  html += masteryBranchHtml("red");
  html += masteryBranchHtml("green");
  html += masteryBranchHtml("blue");
  html += `</div>`;

  container.innerHTML = html;
  updateMasteryDisplay();
}

function updateMasteryDisplay() {
  masteryNodes.forEach(n => {
    const el = document.getElementById(`mn-${n.id}`);
    if (!el) return;
    const active = masteryState[n.id];
    const parentOk = !n.parent || masteryState[n.parent];
    const locked = !parentOk;
    const childLocked = active && hasMasteryActiveChild(n.id);

    el.className = `mn-node mn-${n.branch} mn-type-${n.type}`;
    if (active) el.className += " mn-active";
    if (locked) el.className += " mn-locked";
    if (childLocked) el.className += " mn-child-locked";
    el.style.cursor = locked || childLocked ? "not-allowed" : "pointer";
  });

  const ptsEl = document.getElementById("mastery-pts-used");
  const shardsEl = document.getElementById("mastery-shards-used");
  if (ptsEl) ptsEl.textContent = masteryPointsSpent();
  if (shardsEl) shardsEl.textContent = masteryShardsSpent();

  // Color pts red if over budget
  if (ptsEl) ptsEl.style.color = masteryPointsSpent() >= MASTERY_TOTAL_POINTS ? "#ff5555" : "white";
}

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

    if (target === "mastery") renderMastery();

  });
});