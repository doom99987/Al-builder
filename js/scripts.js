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

function resetSubPicker() {
  updateGold(prevSubSelection, "");
  prevSubSelection = "";
  subPicker.value = "";
}

function updateClassPickerLock() {
  const lvl = Math.min(Max_Lvl, Math.max(Min_Lvl, +lvlInput.value || Min_Lvl));
  const locked = lvl < 5;
  const superLocked = lvl < 15;
  const covLocked = lvl < 10;
  classPicker.disabled = locked;
  subPicker.disabled = locked || subClasses.length === 0;
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
    resetSubPicker();
  } else if (superLocked && classPicker.value) {
    updateGold(prevSuperSelection, "");
    prevSuperSelection = "";
    superPicker.innerHTML = "";
    superPicker.disabled = true;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Req. Lvl 15";
    superPicker.appendChild(opt);
  }
  const covPicker = document.getElementById("covenant-picker");
  const covRankEl = document.getElementById("covenant-rank");
  if (covPicker) {
    covPicker.disabled = covLocked;
    if (covRankEl) covRankEl.disabled = covLocked;
    if (covLocked && covPicker.value) {
      covPicker.value = "";
      renderMoves();
      updatePecents();
    }
  }
}

function updateLvlBonusDisplay() {
  const lvl = Math.min(Max_Lvl, Math.max(Min_Lvl, +lvlInput.value || Min_Lvl));
  const bonus = Math.floor(lvl / 5);
  document.querySelectorAll(".stat-lvl-bonus").forEach(el => {
    el.textContent = bonus > 0 ? `+${bonus}` : "";
  });
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
  updateLvlBonusDisplay();
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

const armourItems = {
  "Paladin Cuirass": {
    endFlat: 20,
    pct: { end: 17.5 }
    // Also grants: +10% Physical Armor, -5% Run Speed, +5% Holy Armor, +5% Magic Armor, +5% Fire Armor
  },
  "Adept Warrior": {
    endFlat: 15,
    pct: { end: 10, str: 5, energy: 16.6 }
    // Also grants: +5% Physical Armor, +20% Fall Resistance, +10% Dark Armor
  },
  "Raging Warrior": {
    endFlat: 16,
    pct: { end: 10, "inc-heal": 10, energy: 10 }
    // Also grants: +5% Physical Armor, +10% Hex Armor, +5% Fire Armor
  },
  "Arcane Robes": {
    arc: 4,
    endFlat: 15,
    pct: { arc: 7.5 }
    // Also grants: +10% Magic Armor, +10% Poison Armor, +10% Holy Armor, +10% Fire Armor
  },
  "Magister Apprentice": {
    arc: 3,
    endFlat: 15,
    pct: { arc: 5 }
    // Also grants: +15% Magic Armor, +10% Poison Armor, +10% Fire Armor, +1 HP Regen
  },
  "Corrupt Caster": {
    arc: 2,
    endFlat: 16,
    pct: { end: 5, arc: 5, energy: 10 }
    // Also grants: +15% Magic Armor, +10% Poison Armor, +10% Holy Armor
  },
  "Lifebound Archer": {
    arc: 3,
    endFlat: 15,
    pct: { end: 5, arc: 5 }
    // Also grants: +10% Magic Armor, +10% Poison Armor, +10% Nature Armor, +1 HP Regen, +15% Run Speed
  },
  "Rogue Hunter": {
    endFlat: 15,
    pct: { end: 7.5, spd: 10, energy: 10 }
    // Also grants: +5% Physical Armor, +20% Run Speed, +5% Fire Armor, +1 HP Regen, +25% Fall Resistance
  },
  "Shadow Cloak": {
    endFlat: 13,
    pct: { end: 7.5, energy: 12.5 }
    // Also grants: +5% Physical Armor, +30% Run Speed, +5% Dark Armor, +1 HP Regen, +30% Fall Resistance
  },
  "Traveling Pasmark": {
    str: 5,
    endFlat: 16,
    pct: { end: 7.5, str: 5 }
    // Also grants: +5% Physical Armor, +5% Holy Armor, +1 HP Regen, +10% Fall Resistance, +5% Fire Armor, +5% Dark Armor
  },
  "Wandering Practitioner": {
    endFlat: 18,
    pct: { end: 7.5, str: 10, energy: 16.6 }
    // Also grants: +5% Physical Armor, +10% Fall Damage Resistance, +10% Fire Armor
  },
  "Shade Walker": {
    endFlat: 18,
    pct: { end: 7.5, arc: 5 }
    // Also grants: +5% Physical Armor, +10% Hex Armor, +10% Fall Resistance, +20% Dark Armor
  },
  "Pathfinder Martyr": {
    arc: 3,
    spd: 1,
    endFlat: 20,
    pct: { end: 7.5 }
    // Also grants: +5% Physical Armor, +15% Holy Armor, +1 HP Regen
  },
  "Armored Lancer": {
    endFlat: 20,
    pct: { end: 15, energy: 12.5 }
    // Also grants: +10% Physical Armor, -5% Run Speed, +10% Magic Armor, +5% Fire Armor
  },
  "Bloody Menace": {
    endFlat: 22,
    pct: { end: 10, "inc-heal": 20 }
    // Also grants: +10% Physical Armor, +5% Hex Armor, +5% Poison Armor
  },
  "Venerated Legionnaire": {
    endFlat: 17,
    pct: { end: 12.5 }
    // Also grants: +15% Physical Armor, +15% Fire Armor, +10% Ice Armor, +10% Nature Armor, +5% Dark Armor, +5% Magic Armor
  },
  "Fortified Seer": {
    endFlat: 35,
    pct: { end: 5 }
    // Also grants: +15% Dark Armor, +15% Hex Armor, +10% Holy Armor, +10% Ice Armor, +10% Fire Armor, +10% Physical Armor
  },
  "Deathmantle": {
    endFlat: 25,
    pct: { end: 2.5, arc: 10 }
    // Also grants: +10% Magic Armor, +5% Physical Armor, +10% Ice Armor, +15% Holy Armor, +20% Dark Armor
  }
};
const soulTreeBonuses = { "crit-dmg": 0, "crit-chance": 0, endFlat: 0 };

// Flat % bonuses granted by equipped weapons (added on top of base in updatePecents)
const weaponBonuses = {
  "Jade Broadsword":  { "out-heal": 30, "inc-heal": 30 },
  "Jade Prayerstaff": { "out-heal": 30, "inc-heal": 30 },
};

// Covenant rank-gated bonuses: array of { minRank, bonuses: { stat: value } }
const covenantBonuses = {
  "Way of Life": [
    { minRank: 5, bonuses: { "out-heal": 15 } }
  ]
};

function calcPercentage(stat, val){
  const formulas = {
    str:           v => 100 + v * 1.65,
    arc:           v => 100 + v * 1.65,
    end:           v => 45 + v * 1.00248, //finalized
    spd:           v => v * 2,
    "crit-chance": v => 19.8 + v * 0.25,
    "crit-dmg":    v => 1.5 + v * 0.00248,
    "out-heal":    () => 100,
    "inc-heal":    () => 100,
    "energy":      () => 0,
  };
  return formulas[stat] ? formulas[stat](val).toFixed(stat === "crit-dmg" ? 2 : 1) : "—";
}

function updatePoints() {
  document.getElementById("points-left").textContent = getEffectiveTotal() - spent;
}


function updatePecents() {
  const armourEl = document.getElementById("armour-main");
  const armour = armourItems?.[armourEl?.value] || {};
  const armourPct = armour.pct || {};

  // Collect flat % bonuses from equipped weapons
  const equippedWeapons = [
    document.getElementById("weapon-main")?.value,
    document.getElementById("weapon-offhand")?.value,
  ];
  const weaponPct = {};
  equippedWeapons.forEach(w => {
    if (!w || !weaponBonuses[w]) return;
    Object.entries(weaponBonuses[w]).forEach(([k, v]) => {
      weaponPct[k] = (weaponPct[k] || 0) + v;
    });
  });

  const covName = document.getElementById("covenant-picker")?.value;
  const covRank = Math.min(20, Math.max(1, +document.getElementById("covenant-rank")?.value || 1));
  const covPct = {};
  if (covName && covenantBonuses[covName]) {
    covenantBonuses[covName].forEach(({ minRank, bonuses }) => {
      if (covRank >= minRank) {
        Object.entries(bonuses).forEach(([k, v]) => {
          covPct[k] = (covPct[k] || 0) + v;
        });
      }
    });
  }

  // Collect flat stat bonuses and pct bonuses from equipped gear
  const gearStatBonuses = {};
  const gearPct = {};
  ["gear-1","gear-2","gear-3","gear-4"].forEach(id => {
    const name = document.getElementById(id)?.value;
    const g = name ? gearItems[name] : null;
    if (g) {
      Object.entries(g).forEach(([k, v]) => {
        if (v) gearStatBonuses[k] = (gearStatBonuses[k] || 0) + v;
      });
    }
    if (name && gearPctBonuses[name]) {
      Object.entries(gearPctBonuses[name]).forEach(([k, v]) => {
        gearPct[k] = (gearPct[k] || 0) + v;
      });
    }
  });

  const lvl = Math.min(Max_Lvl, Math.max(Min_Lvl, +lvlInput.value || Min_Lvl));
  const lvlStatBonus = Math.floor(lvl / 5);

  const masteryStats = getMasteryStatBonuses();
  const lckRow = document.querySelector('.stat-row[data-stat="lck"] .stat-val');
  const totalLck = (lckRow ? +lckRow.value : 0) + (raceBase.lck ?? 0) + (masteryStats.lck ?? 0) + lvlStatBonus;

  document.querySelectorAll(".percent-item").forEach(item => {
    const stat = item.dataset.stat;
    const row = document.querySelector(`.stat-row[data-stat="${stat}"] .stat-val`);
    const allocated = row ? +row.value : 0;
    const flatBonus = (armour[stat] ?? 0) + (masteryStats[stat] ?? 0) + (gearStatBonuses[stat] ?? 0);
    const levelBonus = row ? lvlStatBonus : 0;
    const isCritStat = stat === "crit-chance" || stat === "crit-dmg";
    const val = isCritStat ? totalLck : allocated + (raceBase[stat] ?? 0) + flatBonus + levelBonus;
    const base = calcPercentage(stat, val);
    const pctBonus = (armourPct[stat] ?? 0) + (soulTreeBonuses[stat] ?? 0) + (weaponPct[stat] ?? 0) + (covPct[stat] ?? 0) + (gearPct[stat] ?? 0);
    let display;
    if (base === "—") {
      display = "—";
    } else if (stat === "end") {
      const hpBase = parseFloat(base);
      const flatHP = (soulTreeBonuses.endFlat ?? 0) + (armour.endFlat ?? 0) + (gearStatBonuses.endFlat ?? 0);
      const hpPct = (armourPct.end ?? 0) + (gearPct.end ?? 0);
      display = (hpBase * (1 + hpPct / 100) + flatHP).toFixed(1);
      if (document.getElementById("artifact-picker")?.value === "Paranoxian Crux") {
        const fullHP = parseFloat(display);
        const currentHP = (fullHP * 0.15).toFixed(1);
        const shieldHP = (fullHP - fullHP * 0.15).toFixed(1);
        display = `${currentHP} (${shieldHP} Shield)`;
      }
    } else if (stat === "energy") {
      const total = pctBonus;
      display = total > 0 ? total.toFixed(1) : "—";
    } else {
      display = (parseFloat(base) + pctBonus).toFixed(stat === "crit-dmg" ? 2 : 1);
    }
    const suffix = stat === "end" ? "" : stat === "crit-dmg" ? "x" : stat === "energy" && display === "—" ? "" : "%";
    item.querySelector(".percent-val").textContent = display + suffix;
  });

  // Update stat total display
  document.querySelectorAll(".stat-row[data-stat]").forEach(rowEl => {
    const stat = rowEl.dataset.stat;
    const input = rowEl.querySelector(".stat-val");
    const allocated = input ? +input.value : 0;
    const flatBonus = (armour[stat] ?? 0) + (masteryStats[stat] ?? 0) + (gearStatBonuses[stat] ?? 0);
    const total = allocated + (raceBase[stat] ?? 0) + flatBonus + lvlStatBonus;
    const totalEl = rowEl.querySelector(".stat-total");
    if (totalEl) totalEl.textContent = total || "";
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

// --- Artifacts ---
// To add: "Artifact Name": { learns: [...] }
const artifactItems = {
  "Reality Watch": {},
  "Narthana's Sigil": {},
  "Shifting Hourglass": {},
  "Metrom's Amulet": {},
  "Heaven's Authority": {},
  "Darksigil": {},
  "Stellian Core": {},
  "Chaos Orb": {},
  "Arkhaia's Visage": {},
  "Paranoxian Crux": {},
  "Ancient Insignia": {},
  "Celestial Emblem": {}
};

const artifactMoves = {
  "Reality Watch": {
    learns: [
      {
        slot: "Active",
        level: 1,
        type: "Active",
        name: "Chronos",
        quote: "",
        cost: 0,
        cooldown: 12,
        moveType: "N/A",
        category: "Buff",
        effect: "Saves your point in time for 3 turns, after which time reverts and your health and energy rewind. Will not revive you if you die within these 3 turns.",
        image: "https://trello.com/1/cards/67b18f753aaf3bb967408434/attachments/69789abaaf1e0df695c50d73/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127155958.png"
      }
    ]
  },
  "Narthana's Sigil": {
    learns: [
      {
        slot: "Passive",
        level: 1,
        type: "Passive",
        name: "Narthana's Sigil",
        quote: "",
        effect: "When healing 270 HP, deals X damage (scales on level) and heals X to allies.\n\nNote: Equipping this artifact may boost passive regen (unconfirmed — needs testing)."
      }
    ]
  },
  "Shifting Hourglass": {
    learns: [
      {
        slot: "Active",
        level: 1,
        type: "Active",
        name: "Sands Of Time",
        quote: "",
        cost: 1,
        cooldown: 15,
        moveType: "N/A",
        category: "Buff",
        effect: "Enter Heavy Stun for a turn. If Heavy Stun passes and you haven't lost 20% of your HP, grants a 20% Dmg buff and DR.\n\nCapped at 5 uses per fight.",
        image: "https://trello.com/1/cards/67b18f72fc91f2c663d38db9/attachments/69789a2040497cfe15daec75/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260127155456.png"
      }
    ]
  },
  "Darksigil": {
    learns: [
      {
        slot: "Passive",
        level: 1,
        type: "Passive",
        name: "Darksigil",
        quote: "",
        effect: "After applying 6 different instances of statuses to opponents, shoots a Dark Orb at them. Deals damage equal to your current Level×2 and applies 2 Vulnerable and 2 Weakened to all opponents."
      }
    ]
  },
  "Metrom's Amulet": {
    learns: [
      {
        slot: "Passive",
        level: 1,
        type: "Passive",
        name: "Metrom's Amulet",
        quote: "",
        effect: "When you kill an enemy, the overkill damage from that hit scales an AoE attack that hits all enemies. Bypasses reflects. Can crit. Heals MV if used in the raid and cannot damage Seraphon/Arkhaia.\n\nExample: If your attack deals 20 damage against a 15 HP enemy, the AoE base damage is 5."
      }
    ]
  },
  "Stellian Core": {
    learns: [
      {
        slot: "Passive",
        level: 1,
        type: "Passive",
        name: "Stellian Core",
        quote: "",
        effect: "Grants 30% Dmg buff, 20% DR, and 15% Crit rate while active. Only activates when you are above 95% of your Max HP."
      }
    ]
  },
  "Chaos Orb": {
    learns: [
      {
        slot: "Passive",
        level: 1,
        type: "Passive",
        name: "Chaos Orb",
        quote: "",
        effect: "When applying a status, you have a 33% chance to apply an additional random status. Excludes Heavy Stunned, Fractured, Hex, Stunned, and any boss-exclusive statuses.\n\nNote: Can apply Ghostflame only if you have the Dullahan race."
      }
    ]
  },
  "Celestial Emblem": {
    learns: [
      {
        slot: "Passive",
        level: 1,
        type: "Passive",
        name: "Celestial Emblem",
        quote: "",
        effect: "When fighting a Goblin, Night Raider, Sentient Darkness, Star Slime, or Arkhaia, they become empowered with special effects unique to each enemy type.\n\nYou must be the one who starts the fight."
      }
    ]
  },
  "Heaven's Authority": {
    learns: [
      {
        slot: "Active",
        level: 1,
        type: "Active",
        name: "Calling Light",
        quote: "",
        cost: 2,
        cooldown: 9,
        moveType: "N/A",
        category: "Buff",
        effect: "Randomly summon one of three Sheeas: Saint, Paladin, or Elementalist. All summons have 250 HP and start with only Strike and Skyward Bolt. If you have their respective weapon type equipped, they gain all abilities of their Super Class.\n\nIf you are at or below 20% Max HP, summon 2 Sheeas instead of 1."
      }
    ]
  },
  "Arkhaia's Visage": {
    learns: [
      {
        slot: "Active",
        level: 1,
        type: "Active",
        name: "Infernal Pledge",
        quote: "",
        cost: 1,
        cooldown: 8,
        moveType: "Dark",
        category: "Buff",
        effect: "Creates a link with an enemy for 3 turns. While active, damage taken is shared with the linked target. Excludes self-damage."
      }
    ]
  },
  "Paranoxian Crux": {
    learns: [
      {
        slot: "Passive",
        level: 1,
        type: "Passive",
        name: "Paranoxian Crux",
        quote: "",
        effect: "When equipped, multiplies your max HP by 1.5x, then sets it to 10% of the new value. The remaining HP is converted into Shield HP. This can stack with other sources of Shield HP."
      },
      {
        slot: "Active",
        level: 1,
        type: "Active",
        name: "Congeal Flesh",
        quote: "",
        cost: "X",
        cooldown: 6,
        moveType: "Ice",
        category: "Buff",
        effect: "Restores 15×X% of your Shield HP, where X is the amount of energy consumed by the move."
      }
    ]
  },
  "Ancient Insignia": {
    learns: [
      {
        slot: "Passive",
        level: 1,
        type: "Passive",
        name: "Ancient Insignia",
        quote: "",
        effect: "Start with a random Stance. Stances switch randomly every 3 turns.\n\n• Paper: Gain 1 Resist for each debuff inflicted on you.\n• Rock: Gain 15% Damage Reduction.\n• Scissors: Gain 5 Energy."
      },
      {
        slot: "Active",
        level: 1,
        type: "Active",
        name: "Written in Stone",
        quote: "",
        cost: 1,
        cooldown: 12,
        moveType: "Physical",
        category: "Buff",
        effect: "Immediately switch your current Stance. The new Stance lasts for 4 turns instead of 3."
      }
    ]
  }
};

const artifactPicker = document.getElementById("artifact-picker");
const artifactDescSection = document.getElementById("artifact-desc-section");
const artifactDesc = document.getElementById("artifact-desc");

// --- Shards ---
// To add: "Shard Name": {}
const shardItems = {
  "Striking (R)": {},
  "Striking (P)": {},
  "Shattering (R)": {},
  "Shattering (P)": {},
  "Regenerative (R)": {},
  "Regenerative (P)": {},
  "Voltaic (R)": {},
  "Voltaic (P)": {},
  "Executing (R)": {},
  "Executing (P)": {},
  "Reversing (R)": {},
  "Reversing (P)": {},
  "Empowering (R)": {},
  "Empowering (P)": {}
};

const shardPickers = document.querySelectorAll(".shard-picker");

shardPickers.forEach(picker => {
  buildSimpleDropdown(picker, Object.keys(shardItems), () => {});
});


const enchantDescSection = document.getElementById("enchant-desc-section");

function updateEnchantDesc() {
  const item = enchantItems[enchantPicker.value];
  if (!item) {
    enchantDesc.innerHTML = "";
    enchantDescSection.style.display = "none";
    return;
  }
  const lvlLine = item.level ? `<span class="enchant-level">Req. Level ${item.level}</span>` : `<span class="enchant-level">No level requirement</span>`;
  enchantDesc.innerHTML = `<div class="enchant-name">${enchantPicker.value}</div>` + lvlLine + "<br><br>" + item.effect.replace(/\n/g, "<br>");
  enchantDescSection.style.display = "";
}

buildSimpleDropdown(enchantPicker, Object.keys(enchantItems), updateEnchantDesc);
buildSimpleDropdown(artifactPicker, Object.keys(artifactItems), () => { renderArtifactDesc(); renderMoves(); updatePecents(); });

function renderArtifactDesc() {
  const section = artifactDescSection;
  const content = artifactDesc;
  if (!section || !content) return;
  const name = artifactPicker.value;
  const data = name ? artifactMoves[name] : null;
  if (!name || !data) { section.style.display = "none"; content.innerHTML = ""; return; }
  let html = `<div class="enchant-name">${name}</div>`;
  (data.learns || []).forEach(m => {
    if (m.type === "Passive") {
      html += `<div style="margin-top:6px"><strong>${m.name}</strong></div>`;
      html += `<div class="enchant-desc" style="margin-top:2px">${m.effect.replace(/\n/g, "<br>")}</div>`;
    } else if (m.type === "Active") {
      html += `<div style="margin-top:6px"><strong>${m.name}</strong> <span class="enchant-level">Active</span></div>`;
      const stats = [
        m.cost !== undefined ? `Cost: ${m.cost}` : null,
        m.cooldown !== undefined ? `CD: ${m.cooldown}` : null,
        m.moveType ? `Type: ${m.moveType}` : null,
        m.damage !== undefined ? `Dmg: ${m.damage}` : null,
        m.scaling ? `Scl: ${m.scaling}` : null,
      ].filter(Boolean).join(" | ");
      if (stats) html += `<div class="enchant-level" style="margin-top:2px">${stats}</div>`;
      html += `<div class="enchant-desc" style="margin-top:2px">${m.effect.replace(/\n/g, "<br>")}</div>`;
      if (m.image) html += `<img class="move-image" src="${m.image}" alt="${m.name}" style="margin-top:6px;max-width:100%">`;
    }
  });
  content.innerHTML = html;
  section.style.display = "";
}

function renderGearInfo() {
  const section = document.getElementById("gear-desc-section");
  const content = document.getElementById("gear-desc");
  if (!section || !content) return;
  const slots = ["gear-1","gear-2","gear-3","gear-4"].map(id => document.getElementById(id)?.value || "").filter(Boolean);
  const withMoves = slots.filter(name => gearMoves[name]);
  if (!withMoves.length) { section.style.display = "none"; content.innerHTML = ""; return; }
  let html = "";
  withMoves.forEach((name, i) => {
    if (i > 0) html += `<hr style="border-color:rgba(255,255,255,0.1);margin:10px 0">`;
    html += `<div class="enchant-name">${name}</div>`;
    const data = gearMoves[name];
    (data.learns || []).filter(m => !isSummonMove(m)).forEach(m => {
      if (m.type === "Passive") {
        html += `<div style="margin-top:6px"><strong>${m.name}</strong></div>`;
        html += `<div class="enchant-desc" style="margin-top:2px">${m.effect.replace(/\n/g, "<br>")}</div>`;
      } else if (m.type === "Active") {
        const slotLabel = m.slot ? `<span class="enchant-level" style="margin-right:4px">${m.slot}</span>` : "";
        html += `<div style="margin-top:6px">${slotLabel}<strong>${m.name}</strong> <span class="enchant-level">Active</span></div>`;
        const stats = [
          m.cost !== undefined ? `Cost: ${m.cost}` : null,
          m.cooldown !== undefined ? `CD: ${m.cooldown}` : null,
          m.moveType ? `Type: ${m.moveType}` : null,
          m.duration !== undefined ? `Dur: ${m.duration}` : null,
          m.damage !== undefined ? `Dmg: ${m.damage}` : null,
          m.scaling ? `Scl: ${m.scaling}` : null,
        ].filter(Boolean).join(" | ");
        if (stats) html += `<div class="enchant-level" style="margin-top:2px">${stats}</div>`;
        html += `<div class="enchant-desc" style="margin-top:2px">${m.effect.replace(/\n/g, "<br>")}</div>`;
        if (m.image) html += `<img class="move-image" src="${m.image}" alt="${m.name}" style="margin-top:6px;max-width:100%">`;
      }
    });
  });
  content.innerHTML = html;
  section.style.display = "";
}

// --- Gear ---
// Percentage bonuses granted by gear items (e.g. crit-chance, energy)
const gearPctBonuses = {
  "Crystal Sphere":  { "crit-chance": 5 },
  "Narthana's Leaf": { "out-heal": 75, "end": -25 },
};

// To add gear: "Item Name": { str, arc, end, spd, lck }
const gearItems = {
  "Lethal Blackjack":    { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Everbeating Drums":   { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  // Easter Gears
  "Rabbit Pelt":         { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Egg Shelmet":         { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Chocolate Egg":       { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Party Egg":           { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Gleaming Carrot":     { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Rabbit's Foot":       { str: 0, arc: 0, end: 0, spd: 5, lck: 5 },
  // Winter Solstice Gears
  "Snorb":               { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Elementary Resonance":{ str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Frosty Topper":       { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  // Forest Gears
  "7 Leafed Everthistle":{ str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Shattered Clock Hand":{ str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "The Biggest Pebble":  { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Arbusta Tear":        { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Parasitic Leech":     { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Spore Root":          { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Forest Charm":        { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Elemental Infuser":   { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Crystallized Star":   { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Pathfinder Mark":     { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Gilded Pouch":        { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  // Desert Gears
  "Crystal Sphere":      { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Dust Storm":          { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Golem Rune Core":     { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Spiked Steel Ball":   { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Stone Brand":         { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Ramizcan Idol":       { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Band of Crushing Force":{ str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Grain Of Balance":    { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Madseer's Codex":     { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Impure Crown":        { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "The Last Straw":      { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Imbued Chains":       { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Delicate Purse":      { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Desert Escutcheon":   { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  // Deeproot Gears
  "Cursed Brand":          { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Narthana's Leaf":       { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Wicked Crown":          { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Sanguine Fang":         { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Coagulated Finger Nail":{ str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Shard of Blight":       { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Traveler's Lamp":       { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Expedite Anklet":       { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Phantom Ooze":          { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  // Volcano Gears
  "Imperial Headband":     { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Magma Charm":           { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Vulcan Knuckle":        { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Dragon Memoir":         { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Blazing Brand":         { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Molten Carapace":       { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  // Bosses/Minibosses Gears
  "Gelat Band":            { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Tear Blood Crystal":    { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Ptera's Heart":         { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "DeathBeak Dagger":      { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Blazing Perforator":    { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Yar'thul's Wrath":      { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Frostburned Rune":      { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Vow of Ruin":           { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Frozen Diadem":         { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Imbuement Reliquary":   { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Divine Promise":        { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Focused Mind":          { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Aspect of Maladaptation":{ str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Tainted Quiver":        { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Vainglorious Locket":   { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "The Smallest Boulder":  { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Eroded Blade":          { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Dust Devil's Eye":      { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
  "Open Hand":             { str: 0, arc: 0, end: 0, spd: 0, lck: 0 },
};

const gearSeries = {
  "Easter Gears":         ["Rabbit Pelt", "Egg Shelmet", "Chocolate Egg", "Party Egg", "Gleaming Carrot", "Rabbit's Foot"],
  "Winter Solstice Gears":["Snorb", "Elementary Resonance", "Frosty Topper"],
  "Forest":               ["7 Leafed Everthistle", "Shattered Clock Hand", "The Biggest Pebble", "Arbusta Tear", "Parasitic Leech", "Spore Root", "Forest Charm", "Elemental Infuser", "Crystallized Star", "Pathfinder Mark", "Gilded Pouch"],
  "Desert":               ["Crystal Sphere", "Dust Storm", "Golem Rune Core", "Spiked Steel Ball", "Stone Brand", "Ramizcan Idol", "Band of Crushing Force", "Grain Of Balance", "Madseer's Codex", "Impure Crown", "The Last Straw", "Imbued Chains", "Delicate Purse", "Desert Escutcheon"],
  "Deeproot":             ["Cursed Brand", "Narthana's Leaf", "Wicked Crown", "Sanguine Fang", "Coagulated Finger Nail", "Shard of Blight", "Traveler's Lamp", "Expedite Anklet", "Phantom Ooze"],
  "Volcano":              ["Imperial Headband", "Magma Charm", "Vulcan Knuckle", "Dragon Memoir", "Blazing Brand", "Molten Carapace"],
  "Bosses/Minibosses":    ["Gelat Band", "Tear Blood Crystal", "Ptera's Heart", "DeathBeak Dagger", "Blazing Perforator", "Yar'thul's Wrath", "Frostburned Rune", "Vow of Ruin", "Frozen Diadem", "Imbuement Reliquary", "Divine Promise", "Focused Mind", "Aspect of Maladaptation", "Tainted Quiver", "Vainglorious Locket", "The Smallest Boulder", "Eroded Blade", "Dust Devil's Eye", "Open Hand"],
  "Other":                ["Lethal Blackjack", "Everbeating Drums"],
};

const gearPickers = document.querySelectorAll(".gear-picker");
gearPickers.forEach(picker => buildGearDropdown(picker, gearSeries));

// --- Weapons ---
// mainWeaponSeries: weapons for the main hand slot
// offhandSeries: weapons for the off-hand slot (different items)
// weaponMoves: shared passive lookup for any weapon by name

const mainWeaponSeries = {
  "Ferrus": {
    "Ferrus Sword":      { type: "Sword" },
    "Old Staff":         { type: "Staff" },
    "Ferrus Dagger":     { type: "Dagger" },
    "Ferrus Cestus":     { type: "Gauntlets" },
    "Ferrus Spear":      { type: "Spear" },
    "Ferrus Axe":        { type: "Axe" },
    "Ferrus Tenderizer": { type: "Hammer" },
  },
  "Blacksteel": {
    "Blacksteel Sabre": { type: "Sword" },
    "Blacksteel Staff": { type: "Staff" },
    "Blacksteel Knife": { type: "Dagger" },
    "Blacksteel Claws": { type: "Gauntlets" },
    "Blacksteel Spear": { type: "Spear" },
    "Blacksteel Axe":   { type: "Axe" },
    "Greatsword":       { type: "Greatsword" },
  },
  "Jade": {
    "Jade Broadsword":  { type: "Sword" },
    "Jade Prayerstaff": { type: "Staff" },
  },
  "Corealloy": {
    "Corealloy Manadagger": { type: "Dagger" },
    "Corealloy Manaclaws":  { type: "Gauntlets" },
    "Corealloy Manablade":  { type: "Greatsword" },
  },
  "Dragon": {
    "Dragontooth Blade":    { type: "Sword" },
    "Dragontooth Staff":    { type: "Staff" },
    "Dragontooth Dagger":   { type: "Dagger" },
    "Dragonbone Gauntlets": { type: "Gauntlets" },
    "Dragonbone Spear":     { type: "Spear" },
    "Dragonpyre Axe":       { type: "Axe" },
    "Dragonbone Hammer":    { type: "Hammer" },
  },
  "Blight": {
    "Blightrock Sword":     { type: "Sword" },
    "Blightwood Staff":     { type: "Staff" },
    "Blightrock Dagger":    { type: "Dagger" },
    "Blightrock Gauntlets": { type: "Gauntlets" },
    "Blightrock Spear":     { type: "Spear" },
  },
  "Sun": {
    "Sun Sword":      { type: "Sword" },
    "Sun Staff":      { type: "Staff" },
    "Sun Dagger":     { type: "Dagger" },
    "Sun Spear":      { type: "Spear" },
    "Sun Greatsword": { type: "Greatsword" },
  },
  "Darkblood": {
    "Darkblood Sword":  { type: "Sword" },
    "Darkblood Staff":  { type: "Staff" },
    "Darkblood Dagger": { type: "Dagger" },
    "Darkblood Cestus": { type: "Gauntlets" },
    "Darkblood Spear":  { type: "Spear" },
    "Darkblood Hexer":  { type: "Greatsword" },
  },
  "Sandstone": {
    "Sandstone Staff":     { type: "Staff" },
    "Sandstone Dagger":    { type: "Dagger" },
    "Sandstone Gauntlets": { type: "Gauntlets" },
    "Sandstone Spear":     { type: "Spear" },
    "Sandstone Hammer":    { type: "Hammer" },
  },
  "Primordial": {
    "Primordial Sword":     { type: "Sword" },
    "Primordial Staff":     { type: "Staff" },
    "Primordial Dagger":    { type: "Dagger" },
    "Primordial Gauntlets": { type: "Gauntlets" },
    "Primordial Spear":     { type: "Spear" },
    "Primordial Axe":       { type: "Axe" },
    "Primordial Hammer":    { type: "Hammer" },
  },
  "Icerind": {
    "Icerind Sword":      { type: "Sword" },
    "Icerind Staff":      { type: "Staff" },
    "Icerind Sai":        { type: "Dagger" },
    "Icerind Cestus":     { type: "Gauntlets" },
    "Icerind Spear":      { type: "Spear" },
    "Icerind Greatsword": { type: "Greatsword" },
  },
  "Ivory": {
    "Ivory Sword":      { type: "Sword" },
    "Ivory Dagger":     { type: "Dagger" },
    "Ivory Spear":      { type: "Spear" },
    "Ivory Axe":        { type: "Axe" },
    "Ivory Hammer":     { type: "Hammer" },
    "Ivory Greatsword": { type: "Greatsword" },
  },
  "Unique": {
    "Vastic Glaive":      { type: "Spear" },
    "Star-Seeing Hammer": { type: "Hammer" },
  },
};

const offhandSeries = {
  "Shields": {
    "Targe":              { type: "Shield" },
    "Ferrus Towershield": { type: "Shield" },
    "Dragonflame Shield": { type: "Shield" },
    "Slimy Buckler":      { type: "Shield" },
    "Icerind Shield":     { type: "Shield" },
    "Sandstone Shield":   { type: "Shield" },
    "Primordial Shield":  { type: "Shield" },
    "Ivory Shield":       { type: "Shield" },
  },
};

// --- Shared weapon passives ---
function mkPassive(name, effect) {
  return { slot: "", level: 1, type: "Passive", name, quote: "", effect };
}

const blacksteelPassive = mkPassive("Blacksteel", "Grants a 10% damage buff.");
const jadePassive       = mkPassive("Jade",        "Increases incoming and outgoing healing by a flat 30%.");
const corealloyPassive  = mkPassive("Corealloy",   "Allows the use of weapon locked skills in respect to their weapon type.\n\nGrants a 5% damage buff per Energy. (calculated after Energy consumption of moves)\n\nWeapon color changes with your soul color.");
const dragonPassive     = mkPassive("Dragon",      "Allows the use of weapon locked skills in respect to their weapon type.\n\nGrants a 15% damage buff if the enemy has the Burn status effect.");
const blightPassive     = mkPassive("Blight",      "Allows the use of weapon locked skills in respect to their weapon type.\n\nGrants a 20% damage buff if the enemy has the Weakened and/or Vulnerable status effect. (does not stack)\n\nApplies 2 stacks of Cursed per hit if the enemy has the Weakened and/or Vulnerable status effect. (guaranteed, does not stack)");
const sunPassive        = mkPassive("Sun",         "Allows the use of weapon locked skills in respect to their weapon type.\n\nGrants your attacks a 10% chance to increase your Defense for 3 turns and a 20% chance to decrease the enemy's Defense by 10% for 3 turns. The Defense Down applies to the hit which triggers it.");
const sunDaggerPassive   = mkPassive("Sun",        "Allows the use of weapon locked skills in respect to their weapon type.\n\nGrants your attacks a 10% chance to increase your Defense for 3 turns and a 20% chance to decrease the enemy's Defense by 10% for 3 turns. The Defense Down applies to the hit which triggers it. (bugged)");
const darkbloodPassive    = mkPassive("Darkblood",  "Allows the use of weapon locked skills in respect to their weapon type.\n\nGrants a 10% damage buff.\n\nShares status effects applied to you with the attacker. (does not work on Metrom's Vessel)");
const sandstoneWepPassive = mkPassive("Sandstone",  "Allows the use of weapon locked skills in respect to their weapon type.\n\nGrants your attacks a 20% chance to apply 2 Sundered.");
const primordialWepPassive = mkPassive("Primordial", "Allows the use of weapon locked skills in respect to their weapon type.\n\nHas a chance to apply the Soulless status effect on hit. (currently does nothing)");
const icerindWepPassive    = mkPassive("Icerind",    "Allows the use of Sword locked skills.\n\nGrants a 20% damage buff if the enemy has the Cold status effect.\n\nGrants your attacks a ?% chance to apply Cold.");
const ivoryWepPassive      = mkPassive("Ivory",      "Allows the use of weapon locked skills in respect to their weapon type.\n\nIncreases your luck stat by X amount.\n\nCritical attacks have a ~15% chance to grant you 1 energy and heal you by 5% of your max hp. (can only happen twice in one turn)");

function w(passive) { return { learns: passive ? [passive] : [] }; }

const weaponMoves = {
  // Ferrus (no passive)
  "Ferrus Sword":      w(null),
  "Old Staff":         w(null),
  "Ferrus Dagger":     w(null),
  "Ferrus Cestus":     w(null),
  "Ferrus Spear":      w(null),
  "Ferrus Axe":        w(null),
  "Ferrus Tenderizer": w(null),
  // Blacksteel
  "Blacksteel Sabre":  w(blacksteelPassive),
  "Blacksteel Staff":  w(blacksteelPassive),
  "Blacksteel Knife":  w(blacksteelPassive),
  "Blacksteel Claws":  w(blacksteelPassive),
  "Blacksteel Spear":  w(blacksteelPassive),
  "Blacksteel Axe":    w(blacksteelPassive),
  "Greatsword":        w(blacksteelPassive),
  // Jade
  "Jade Broadsword":   w(jadePassive),
  "Jade Prayerstaff":  w(jadePassive),
  // Shields (unique passives)
  "Targe":              { learns: [mkPassive("Targe",              "Grants a 20% Damage Reduction.")] },
  "Ferrus Towershield": { learns: [mkPassive("Ferrus Towershield", "Grants a 40% Damage Reduction.")] },
  "Dragonflame Shield": { learns: [mkPassive("Dragonflame Shield", "Grants a 30% Damage Reduction.\n\nReflects incoming melee damage by 200%.")] },
  "Slimy Buckler":      { learns: [mkPassive("Slimy Buckler",      "Grants a 15% Damage Reduction.\n\nApplies 2 Weakened and 1 Blindness upon blocking a Melee attack. Does not stack with Slimy Shield passive (Lentum passive).")] },
  "Icerind Shield":     { learns: [mkPassive("Icerind Shield",     "Grants a 30% Damage Reduction.\n\nApplies 2 stacks of Cold upon blocking a melee attack.")] },
  "Sandstone Shield":   { learns: [mkPassive("Sandstone Shield",   "Grants a 30% Damage Reduction.")] },
  "Primordial Shield":  { learns: [mkPassive("Primordial Shield",  "Grants a ~15% Damage Reduction.")] },
  "Ivory Shield":       { learns: [mkPassive("Ivory Shield",       "Grants a 30% Damage Reduction.")] },
  // Corealloy
  "Corealloy Manadagger": w(corealloyPassive),
  "Corealloy Manaclaws":  w(corealloyPassive),
  "Corealloy Manablade":  w(corealloyPassive),
  // Dragon
  "Dragontooth Blade":    w(dragonPassive),
  "Dragontooth Staff":    w(dragonPassive),
  "Dragontooth Dagger":   w(dragonPassive),
  "Dragonbone Gauntlets": w(dragonPassive),
  "Dragonbone Spear":     w(dragonPassive),
  "Dragonpyre Axe":       w(dragonPassive),
  "Dragonbone Hammer":    w(dragonPassive),
  // Blight
  "Blightrock Sword":     w(blightPassive),
  "Blightwood Staff":     w(blightPassive),
  "Blightrock Dagger":    w(blightPassive),
  "Blightrock Gauntlets": w(blightPassive),
  "Blightrock Spear":     w(blightPassive),
  // Sun
  "Sun Sword":      w(sunPassive),
  "Sun Staff":      w(sunPassive),
  "Sun Dagger":     w(sunDaggerPassive),
  "Sun Spear":      w(sunPassive),
  "Sun Greatsword": w(sunPassive),
  // Darkblood
  "Darkblood Sword":   w(darkbloodPassive),
  "Darkblood Staff":   w(darkbloodPassive),
  "Darkblood Dagger":  w(darkbloodPassive),
  "Darkblood Cestus":  w(darkbloodPassive),
  "Darkblood Spear":   w(darkbloodPassive),
  "Darkblood Hexer":   w(darkbloodPassive),
  // Sandstone
  "Sandstone Staff":    w(sandstoneWepPassive),
  "Sandstone Dagger":   w(sandstoneWepPassive),
  "Sandstone Gauntlets":w(sandstoneWepPassive),
  "Sandstone Spear":    w(sandstoneWepPassive),
  "Sandstone Hammer":    w(sandstoneWepPassive),
  // Primordial
  "Primordial Sword":     w(primordialWepPassive),
  "Primordial Staff":     w(primordialWepPassive),
  "Primordial Dagger":    w(primordialWepPassive),
  "Primordial Gauntlets": w(primordialWepPassive),
  "Primordial Spear":     w(primordialWepPassive),
  "Primordial Axe":       w(primordialWepPassive),
  "Primordial Hammer":    w(primordialWepPassive),
  // Icerind
  "Icerind Sword":      w(icerindWepPassive),
  "Icerind Staff":      w(icerindWepPassive),
  "Icerind Sai":        w(icerindWepPassive),
  "Icerind Cestus":     w(icerindWepPassive),
  "Icerind Spear":      w(icerindWepPassive),
  "Icerind Greatsword": w(icerindWepPassive),
  // Ivory
  "Ivory Sword":      w(ivoryWepPassive),
  "Ivory Dagger":     w(ivoryWepPassive),
  "Ivory Spear":      w(ivoryWepPassive),
  "Ivory Axe":        w(ivoryWepPassive),
  "Ivory Hammer":     w(ivoryWepPassive),
  "Ivory Greatsword": w(ivoryWepPassive),
  // Unique
  "Vastic Glaive":      { learns: [mkPassive("Vastic Glaive", "Allows the use of Spear locked skills.\n\nOn hit, you have a 12.5% chance to proc a random effect based on your highest stat. (16.6% if Vastayan)\n\nSTR — Places a bomb on the enemy that explodes. Can kill, cannot crit.\nARC — Places a bomb on the enemy that explodes. Cannot kill, cannot crit.\nEND — Heals you for 5% of your max HP.\nLCK — Grants an 80% increased crit chance for your next attack.\nSPD — Grants damage, defense, and speed buffs for 2 turns. (BUGGED)")] },
  "Star-Seeing Hammer": { learns: [mkPassive("Star-Seeing Hammer", "Allows the use of Hammer locked skills.\n\nDoes nothing.")] },
};

// --- Gear passives ---
const easterGearsPassive = mkPassive("Easter Gears", "Gain a stacking 5% defense buff per consecutive damaging move used on an enemy, buff is cleared when you stop attacking. (capped at 30%)");

const gearMoves = {
  "Rabbit Pelt": { learns: [easterGearsPassive] },
  "Egg Shelmet": { learns: [
    easterGearsPassive,
    mkPassive("Egg Shelmet", "Start the fight with 10% more of your max HP in the form of an HP shield.\nWhen the shield breaks, gain a permanent 10% DR."),
  ]},
  "Chocolate Egg": { learns: [
    easterGearsPassive,
    { slot: "", level: 1, type: "Active", name: "Easter Snack", quote: "", cost: 0, cooldown: 99, effect: "Target an ally with this skill. The ally you choose will be healed for 7.5 HP and be given regen equal to 1% of their max HP for 2 turns." },
  ]},
  "Party Egg": { learns: [
    easterGearsPassive,
    { slot: "", level: 1, type: "Active", name: "Egg Throw", quote: "", cost: 2, cooldown: 6, moveType: "Physical", duration: 3, damage: 5, scaling: "SPD/80", effect: "Throw an egg at a target. If it hits, you gain a 7.5% speed boost and apply 2 random status effects (including ghostflame) to the target." },
  ]},
  "Gleaming Carrot": { learns: [
    easterGearsPassive,
    { slot: "", level: 1, type: "Active", name: "Carrot Munch", quote: "", cost: 2, cooldown: 99, effect: "Gives yourself +1% critical chance per turn for 6 turns." },
  ]},
  "Rabbit's Foot": { learns: [
    easterGearsPassive,
    mkPassive("Rabbit's Foot", "+5 Luck Stat.\n+5 Speed Stat.\nEvery turn, have a 33% chance to gain a 5% luck and speed boost for that turn, a 33% chance to gain 2 cursed stacks on yourself, and a 33% chance to gain 1 cursed stack and 1 hex stack on yourself."),
  ]},

  // Winter Solstice Gears
  "Snorb": { learns: [
    mkPassive("Snorb", "Whenever you are attacked this gear will trigger, applying 2 Cold and dealing 10% of your total HP to all opponents. Has an internal proc cooldown of 2 turns, cannot execute, and only procs on the first hit.\n\nSnorb's damage proc can trigger Parasitic Leech and Sanguine Fang's life steal.\n\nThe orb will display yellow particles around it when it is off cooldown."),
  ]},
  "Elementary Resonance": { learns: [
    mkPassive("Elementary Resonance", "Changes colour every turn. If you use an attack that's under the same type/colour as the colour of this gear it does a special effect and makes that attack do 10% more damage.\n\nPhysical — Your attack applies 2 Weakened and 2 Vulnerable.\nArcane — You regain 1 Energy.\nFire — Your attack applies 5 Burn.\nIce — Your attack applies 3 Cold.\nNature — Heal 10% of your MAX HP.\nPoison — Your attack applies 6 Poison.\nHoly — You gain 1 Resist.\nDark — Your attack gains 25% Lifesteal.\nHex — Your attack applies 3 Sundered."),
  ]},
  "Frosty Topper": { learns: [
    { slot: "", level: 1, type: "Active", name: "Call Snowman", quote: "", cost: 2, cooldown: 10, moveType: "Ice", scaling: "ARC/6", effect: "Summon a Snowman when used. The Snowman has 75 base HP." },
    { slot: "Snowman", level: 1, type: "Active", name: "Snowball", quote: "", cost: 0, cooldown: 0, moveType: "Ice", damage: 4, scaling: "ARC/75", effect: "The Snowman pelts an enemy with a Snowball, applying 1 Blinded and having a chance to apply 1 Cold.", image: "https://trello.com/1/cards/694bb3dd24c8b1bf9c0bcb02/attachments/69abab13ec8f2e26741ea1f0/previews/69abab14ec8f2e26741ea23b/download/image.webp" },
    { slot: "Snowman", level: 1, type: "Active", name: "Hidden Presents", quote: "", cost: 2, cooldown: 6, moveType: "Ice", effect: "Creates a bundle of presents, healing the party for 12 base HP and granting 5% DR for 4 turns.", image: "https://trello.com/1/cards/694bb3dd24c8b1bf9c0bcb02/attachments/69abab18abe4d8d8191e1fde/previews/69abab19abe4d8d8191e2033/download/image.webp" },
    { slot: "Snowman", level: 1, type: "Active", name: "Jolly Spirit", quote: "", cost: 3, cooldown: 8, moveType: "Ice", effect: "Target an ally and infuse them with energy.\n\nIf they are a player: provides an additional hit on their attack, fully AoE, applying 2 Cold to all enemies. Base damage equals the triggering move's base damage, scaling ARC/75 + STR/75.\n\nIf they are a summon: provides approximately 50% of their health as a shield for an indefinite duration.", image: "https://trello.com/1/cards/694bb3dd24c8b1bf9c0bcb02/attachments/69abab2c4c4cb2217416cb3d/previews/69abab2c4c4cb2217416cba6/download/image.webp" },
    { slot: "Snowman", level: 1, type: "Active", name: "Drifting Snow", quote: "", cost: 1, cooldown: 0, moveType: "Ice", effect: "The Snowman buffs its allies with a flurry of snow, granting a flat +10 Speed for 2 turns.", image: "https://trello.com/1/cards/694bb3dd24c8b1bf9c0bcb02/attachments/69abab3ad069ad3044d4a057/previews/69abab3ad069ad3044d4a0d4/download/image.webp" },
  ]},

  // Forest
  "7 Leafed Everthistle": { learns: [
    mkPassive("7 Leafed Everthistle", "Increase drop rate and gold by 1.85x at the end of the fight."),
  ]},
  "Shattered Clock Hand": { learns: [
    mkPassive("Shattered Clock Hand", "When using Strike, you have a 30% chance to decrease all your move cooldowns by 1 turn."),
  ]},
  "The Biggest Pebble": { learns: [
    { slot: "", level: 1, type: "Active", name: "Pebble", quote: "", cost: 0, cooldown: 4, effect: "Throw the rock, increasing the chance to escape from the fight by 300%." },
  ]},
  "Arbusta Tear": { learns: [
    { slot: "", level: 1, type: "Active", name: "Arbusta's Fragrance", quote: "", cost: 0, cooldown: 7, effect: "Increase your aggro for 4 turns when used.", image: "https://trello.com/1/cards/67c3fd496f7b29feb166cd72/attachments/697ec9244cff4a03226d59af/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260131203232.png" },
  ]},
  "Parasitic Leech": { learns: [
    mkPassive("Parasitic Leech", "Heal all teammates for 2% of the damage you deal to opponents. This healing is classified as a proper heal (not lifesteal), meaning it scales with your Outgoing Healing stat and the Incoming Healing of whoever is being healed."),
  ]},
  "Spore Root": { learns: [
    mkPassive("Spore Root", "Apply 2 Poison and have a 30% chance to apply 2 Weakened when blocking a melee attack."),
  ]},
  "Forest Charm": { learns: [
    mkPassive("Forest Charm", "Increase your damage by 15% while in the forest.\n\nGive a 25% damage buff for Nature elemental attacks. (Nature element buff works everywhere)"),
  ]},
  "Elemental Infuser": { learns: [
    { slot: "", level: 1, type: "Active", name: "From Sky to Soul", quote: "", cost: 3, cooldown: 10, moveType: "Physical", effect: "Suffuse your soul with elemental essence. Applies 3 Vulnerable to yourself for 3 turns. Magic, Fire, Ice, and Hex abilities deal increasing damage over the next 3 turns (10% / 20% / 30%).\n\nNote: The buff is currently bugged and does not scale.", image: "https://trello.com/1/cards/696ab334c45d0880564f11ad/attachments/697eca8f8218c2bff4726102/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260131203726.png" },
  ]},
  "Crystallized Star": { learns: [
    mkPassive("Crystallized Star", "You gain a flat +10 Luck buff every successful crit for 2 effective turns. (5 stacks max)"),
  ]},
  "Pathfinder Mark": { learns: [
    mkPassive("Pathfinder Mark", "Your Strike now scales with END at a rate of END/75."),
  ]},

  // Desert
  "Crystal Sphere": { learns: [
    mkPassive("Crystal Sphere", "Removes crit fatigue and increases your crit chance by 5%."),
  ]},
  "Dust Storm": { learns: [
    mkPassive("Dust Storm", "Gives a 10% chance to phase through an attack, negating all damage taken (debuffs will still apply).\n\nThis will trigger passives that proc on dodge effects, such as Swift Fighter (Slayer base class) or Verdant Archer (Ranger super class)."),
  ]},
  "Golem Rune Core": { learns: [
    { slot: "", level: 1, type: "Active", name: "Call Sand Golem", quote: "", cost: 2, cooldown: 999, moveType: "Physical", scaling: "ARC/6", effect: "Summon a Sand Golem when used. The Sand Golem has 75 base HP.", image: "https://trello.com/1/cards/67c45e0e2acb83d103823cde/attachments/697ed647ed829742fa6f1894/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260201092721.png" },
    { slot: "Sand Golem", level: 1, type: "Active", name: "Smash", quote: "", cost: 0, cooldown: 0, moveType: "Physical", damage: 10, effect: "Basic attack.", image: "https://trello.com/1/cards/67c45e0e2acb83d103823cde/attachments/697ed6415e251a5b21d26b41/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260201091747.png" },
    { slot: "Sand Golem", level: 1, type: "Active", name: "Core Rage", quote: "", cost: 2, cooldown: 8, moveType: "Physical", effect: "Go into a resting state, applying 1 Heavy Stun to yourself. On your next turn, exit this state and gain a permanent 40% damage buff, 15% defense buff, and 2 extra regen.\n\nIf enough damage is dealt before you exit this state, it can be cancelled.", image: "https://trello.com/1/cards/67c45e0e2acb83d103823cde/attachments/697ed6430a18bfc46654e708/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260201091904.png" },
    { slot: "Sand Golem", level: 1, type: "Active", name: "Dust Burst", quote: "", cost: 2, cooldown: 5, moveType: "Physical", damage: "6x3", effect: "Stuns the opponent if they have the Blinded status.", image: "https://trello.com/1/cards/67c45e0e2acb83d103823cde/attachments/697ed644e458694137159bb3/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260201092257.png" },
    { slot: "Sand Golem", level: 1, type: "Active", name: "Sand Eruption", quote: "", cost: 3, cooldown: 7, moveType: "Physical", damage: 22, effect: "Applies 4 Crippled, 2 Weakened, and 1 Vulnerable. This move has a pseudo AoE effect if it successfully hits its target.", image: "https://trello.com/1/cards/67c45e0e2acb83d103823cde/attachments/697ed64638fd4da4aabe69d1/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260201092624.png" },
  ]},
  "Spiked Steel Ball": { learns: [
    mkPassive("Spiked Steel Ball", "Your attacks have a 30–40% (?) chance to apply 1 Vulnerable and 1 Weakened.\n\nDespite the developer's claims, this also deals an additional 35% damage when it procs."),
  ]},
  "Stone Brand": { learns: [
    { slot: "", level: 1, type: "Active", name: "Stone Skin", quote: "", cost: 2, cooldown: 6, moveType: "Physical", category: "Buff", duration: 3, effect: "Your summons gain the move \"Stone Skin\". When used, grants 60% defence reduction against most attacks for 3 turns.", image: "https://trello.com/1/cards/67c456b08594a7ec9963c03c/attachments/697ecad5a010aa0619d29d75/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260131203749.png" },
  ]},
  "Ramizcan Idol": { learns: [
    mkPassive("Ramizcan Idol", "Gives a 15% damage buff for 1 turn after blocking or parrying."),
  ]},
  "Band of Crushing Force": { learns: [
    mkPassive("Band of Crushing Force", "Deal 25% more damage against blocking enemies.\n\nGives a 10% damage buff whenever an enemy blocks a hit of your attack, until the end of your next turn.\n\nNote: The 15% damage reduction while in desert described in-game does not actually apply."),
  ]},
  "Grain Of Balance": { learns: [
    mkPassive("Grain Of Balance", "Takes 25% off your highest stat and distributes it across all other stats.\n\nNote: Currently bugged — seems to grant negative stat points rather than adding to stats."),
  ]},
  "Madseer's Codex": { learns: [
    mkPassive("Madseer's Codex", "Increases the difficulty of QTEs.\n\nIn exchange, all Magic, Fire, Ice, and Hex attacks have a chance to apply a random status effect:\nPoisoned, Cursed, Blinded, Crippled, Weakened, or Vulnerable."),
  ]},
  "Impure Crown": { learns: [
    mkPassive("Impure Crown", "Every time you apply Poison, apply 1 additional stack. This does not count as a separate instance of Poison."),
  ]},
  "The Last Straw": { learns: [
    mkPassive("The Last Straw", "Gives you 1 stack of Invisibility every five turns."),
  ]},
  "Imbued Chains": { learns: [
    mkPassive("Imbued Chains", "Currently bugged."),
  ]},
  "Delicate Purse": { learns: [
    mkPassive("Delicate Purse", "Grants a random amount of gold at the end of an encounter. Taking damage during the encounter reduces the amount of gold received."),
  ]},
  "Desert Escutcheon": { learns: [
    mkPassive("Desert Escutcheon", "When you successfully block an attack, gain 1 Charge. At 3 Charges, the next damage you block is completely ignored.\n\nCharges persist through fights, but reset if you fail to block or if you dodge an attack."),
  ]},

  // Deeproot
  "Cursed Brand": { learns: [
    { slot: "", level: 1, type: "Active", name: "Curse Consumption", quote: "", cost: 2, cooldown: 5, moveType: "Physical", effect: "At the cost of 10% of your summon's HP, consume the selected target's status effects and give the summon a 5% damage buff per status consumed. (Cannot consume Heavy Stun)", image: "https://trello.com/1/cards/67c4625099eba39045d244a9/attachments/697ed088a579feb6744878bb/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260131204123.png" },
  ]},
  "Narthana's Leaf": { learns: [
    mkPassive("Narthana's Leaf", "Sacrifice 25% of your max HP to gain a 1.75x outgoing heal buff. Does not affect regen."),
  ]},
  "Wicked Crown": { learns: [
    mkPassive("Wicked Crown", "When worn, turns all your physical moves into Dark element. Become immune to Poison and decrease all incoming DoT damage by 15%."),
  ]},
  "Sanguine Fang": { learns: [
    mkPassive("Sanguine Fang", "When hitting an enemy, you have a 25% chance to heal by 10% of the attack damage."),
  ]},
  "Coagulated Finger Nail": { learns: [
    mkPassive("Coagulated Finger Nail", "At the start of every turn, increase base stats by 1.5 points. Caps at 10 turns (15 stat points total to every stat).\n\nNote: Increasing the Endurance stat grants damage reduction instead of HP increase."),
  ]},
  "Shard of Blight": { learns: [
    mkPassive("Shard of Blight", "Gain a 15% defence increase while inside Deeproot Canopy, as well as a 25% increase to dark elemental attacks."),
  ]},
  "Traveler's Lamp": { learns: [
    mkPassive("Traveler's Lamp", "Start each fight with one extra energy and apply 3 Vulnerable to all enemies.\n\nProvides light outside of battle."),
  ]},
  "Expedite Anklet": { learns: [
    { slot: "", level: 1, type: "Active", name: "Godspeed", quote: "", cost: 0, cooldown: 12, moveType: "Magic", effect: "Increases your speed by a flat +30. Gives 1 energy per dodge while active and removes block/dodge bar fatigue.\n\nSpeculation: May increase movement speed outside of battle.", image: "https://trello.com/1/cards/67c488f6dfe5361a2078144b/attachments/697eca6a77fb9f0ee85ce040/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260131203343.png" },
  ]},
  "Phantom Ooze": { learns: [
    { slot: "", level: 1, type: "Active", name: "Gluttony", quote: "", cost: 0, cooldown: 14, moveType: "Physical", effect: "Consumes up to 10 negative status effect stacks on yourself and applies 1 Cursemaw per stack consumed. Cursemaw reduces DR by (stacks × 5%) while it lasts.\n\nConsumption priority: Sundered > Poisoned > Bleeding > Weakened > Vulnerable." },
  ]},

  // Volcano
  "Imperial Headband": { learns: [
    { slot: "", level: 1, type: "Active", name: "Self Destruct", quote: "", cost: 2, cooldown: 0, moveType: "Physical", scaling: "ARC", effect: "When your summons drop below 90% HP, blow up your summons, dealing damage to all targets (scales with the summon's total HP × 2). Also has a chance to apply 2 Stun and 2 Weakened.\n\nNote: Can be blocked, and can be dodged with enough speed.", image: "https://trello.com/1/cards/67c45621e05f17e3f3e34bf1/attachments/697ed0babef5ea81d42c5af8/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260131204217.png" },
  ]},
  "Magma Charm": { learns: [
    mkPassive("Magma Charm", "Give 10% resistance to fire attacks and increase movement speed by 15%."),
  ]},
  "Vulcan Knuckle": { learns: [
    mkPassive("Vulcan Knuckle", "Increase fire elemental move damage by 15%. Gives a 15% defence buff while in the Volcano and changes Strike type to Fire element."),
  ]},
  "Dragon Memoir": { learns: [
    mkPassive("Dragon Memoir", "Your first Strike or Magic Missile applies 2 stacks of Bleed. After this, your next 3 Strikes or Magic Missiles apply 2 stacks of Fractured. After those 3, it applies only 2 Bleed on Strike or Magic Missile for the rest of the fight."),
  ]},
  "Blazing Brand": { learns: [
    mkPassive("Blazing Brand", "When enemies attack your summons, they take small damage and receive 3 Burn."),
  ]},
  "Molten Carapace": { learns: [
    mkPassive("Molten Carapace", "Increase your defense by 30% when below 40% HP."),
  ]},

  // Bosses/Minibosses
  "Gelat Band": { learns: [
    mkPassive("Gelat Band", "Allows you to speak with the King Slime statue."),
    { slot: "", level: 1, type: "Active", name: "Slime Creation", quote: "", cost: 1, cooldown: 10, moveType: "Poison", scaling: "ARC/3", effect: "Summon a Slime when used. The Slime has 35 base HP.", image: "https://trello.com/1/cards/67d41c0244a2d23e350b851e/attachments/697ed2ef8e457c3cafdf421b/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260201091316.png" },
    { slot: "Slime", level: 1, type: "Active", name: "Smack", quote: "", cost: 0, cooldown: 0, moveType: "Physical", damage: 14, scaling: "ARC/50", effect: "Le slime does the spin and wow that hurt!", image: "https://trello.com/1/cards/67d41c0244a2d23e350b851e/attachments/697ed2ece01efac571adf148/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260201091038.png" },
    { slot: "Slime", level: 1, type: "Active", name: "Acid Spit", quote: "", cost: 2, cooldown: 4, moveType: "Poison", damage: 4, scaling: "ARC/75", effect: "Shoots off a ball of acid, inflicting 2 stacks of Poison.", image: "https://trello.com/1/cards/67d41c0244a2d23e350b851e/attachments/697ed2eebbe76e185c06a42d/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260201091230.png" },
  ]},
  "Tear Blood Crystal": { learns: [
    mkPassive("Tear Blood Crystal", "Give a 5% defense and crit chance buff for 5 turns when applying Bleed."),
  ]},
  "Ptera's Heart": { learns: [
    mkPassive("Ptera's Heart", "At the start of combat, apply 3 Poison to yourself and all enemies on the field. At the start of your turn, apply 1 Poison to yourself and all enemies on the field."),
  ]},
  "DeathBeak Dagger": { learns: [
    mkPassive("DeathBeak Dagger", "Whenever you crit, throw a dagger at the enemy dealing damage equal to BaseDMG × CritDMG × 0.15, or × 0.25 if the triggering attack applies any status effect.\n\nBaseDMG refers to the base damage of the triggering move. CritDMG is your critical damage multiplier.\n\nThe dagger works with multihits. It cannot crit, is non-lethal, and is not affected by your buffs. It can be affected by status effects on the enemy and by your enchant. If your attack crits but is dodged, the dagger will still trigger."),
  ]},
  "Blazing Perforator": { learns: [
    mkPassive("Blazing Perforator", "Converts burn damage into healing, but only at half the magnitude. Does not work on Ghostflame."),
  ]},
  "Yar'thul's Wrath": { learns: [
    mkPassive("Yar'thul's Wrath", "Every 5 turns, gain a stack of Overheat: +8% damage and +7.5% speed per stack. Caps at 10 stacks.\n\nYou lose a stack of Overheat when healed by someone other than yourself. (Parasitic Leech counts as a heal)"),
  ]},
  "Frostburned Rune": { learns: [
    mkPassive("Frostburned Rune", "Fire affinity moves apply Cold, and Ice affinity moves apply Burn. Both status effects have a 30% chance to be applied."),
  ]},
  "Vow of Ruin": { learns: [
    { slot: "", level: 1, type: "Active", name: "Pact of Ruin", quote: "", cost: 1, cooldown: 3, moveType: "Physical", effect: "Link with an ally for 3 turns, causing you to take 25% of the damage dealt to them. After the link ends, release the absorbed damage in an explosion scaling with the total amount absorbed." },
  ]},
  "Frozen Diadem": { learns: [
    mkPassive("Frozen Diadem", "Have a 5% innate extra crit chance against enemies with the Cold status.\n\nApplying Cold gives a non-stacking 10% extra crit chance for 2 turns."),
  ]},
  "Imbuement Reliquary": { learns: [
    mkPassive("Imbuement Reliquary", "Summons now have the full effects of your enchant."),
  ]},
  "Divine Promise": { learns: [
    { slot: "", level: 1, type: "Active", name: "Divine Gift", quote: "", cost: 1, cooldown: 3, moveType: "Holy", effect: "Grants the targeted ally or summon 1 Energy and 10% Damage Reduction for 5 turns." },
  ]},
  "Focused Mind": { learns: [
    mkPassive("Focused Mind", "After Meditate, gain a 20% damage buff for 1 turn, but take 15% more damage."),
  ]},
  "Aspect of Maladaptation": { learns: [
    mkPassive("Aspect of Maladaptation", "When damaged by an attack, take 25% less damage from the same element, but take 30% more damage from ALL other elements."),
  ]},
  "Tainted Quiver": { learns: [
    mkPassive("Tainted Quiver", "Your first attack always applies 1 Sundered and steals 1 energy. Every attack after has a ~25% (?) chance to remove 1 energy from the enemy and apply 1 Sunder."),
  ]},
  "Vainglorious Locket": { learns: [
    mkPassive("Vainglorious Locket", "While equipped, your turn is before your opponents. Additionally gain a 10% damage buff which decreases by 5% every turn."),
  ]},
  "The Smallest Boulder": { learns: [
    { slot: "", level: 1, type: "Active", name: "Boulder Buddy", quote: "", cost: 1, cooldown: 14, moveType: "Physical", scaling: "LVL*2", effect: "Summon a Boulder with 35 base HP. When you take damage, the Boulder takes it for you instead. It has no HP regeneration but can still be healed. Unlike other summons, the Boulder does not take turns and you can only have one at a time.\n\nNote: The Vastayan's passive does not increase the HP of the Boulder." },
  ]},
  "Eroded Blade": { learns: [
    mkPassive("Eroded Blade", "Your attacks have a 10% chance to steal 1 NRG from the opponent, granting that energy to yourself on a successful steal.\n\nCannot grant energy more than twice per turn."),
  ]},
  "Dust Devil's Eye": { learns: [
    mkPassive("Dust Devil's Eye", "Has a 5% chance to proc when hitting an enemy. On proc, hits the target 3 additional times.\n\nThe extra 3 hits have their own base damage and scaling."),
  ]},
  "Open Hand": { learns: [
    mkPassive("Open Hand", "Poison, Bleed, Burn, Cold, Ghostflame, and Weakened applied to you decay by 2 instead of 1."),
  ]},

  // Other
  "Everbeating Drums": { learns: [
    mkPassive("Everbeating Drums", "Gives every attack a 20% chance to deal a portion of the damage dealt to all enemies."),
  ]},
  "Lethal Blackjack": { learns: [
    { slot: "", level: 1, type: "Active", name: "D20", quote: "", cost: 0, cooldown: 4, effect: "Roll a D20 for a random effect.\n\n1 — Lose HP down to 10% remaining, drain all energy, gain 2 Cursed. (HP won't change if already below 10%)\n2 — Lose half of current HP, gain 1 Cursed, lose 1 Energy.\n3 — Gain 2 Hexed and 2 Cursed, lose 2 Energy.\n4 — Gain a 10% Damage Down, lose 1 Energy.\n5 — Lose 1 Energy, gain Healing Reduced and 1 Vulnerable.\n6 — Gain 3 Vulnerable and 3 Weakened.\n7 — Gain 2 Vulnerable and 2 Cripple.\n8 — Gain 1 Vulnerable.\n9 — Lose 5 HP.\n10 — Nothing happens.\n11 — Heal 5 HP.\n12 — Gain a 5% Speed buff for 3 turns.\n13 — Gain a 5% Speed and 5% Luck buff for 3 turns.\n14 — Gain a 5% Defence buff for 3 turns.\n15 — Gain a 5% Defence and 5% Damage buff for 3 turns.\n16 — Gain a 10% Damage buff and 1 Energy.\n17 — Gain a 5% Damage buff, 10% Luck buff, 10% Defence buff, and 1 Energy.\n18 — Heal 25% of max HP, gain 2 Energy, reduce all move cooldowns by 1.\n19 — Gain 2 Energy and a 10% Damage, Luck, and Defence boost for 3 turns.\n20 — Fully heal to 100% HP and gain 6 Energy for the next 3 turns.", image: "https://trello.com/1/cards/67c45450bc87ff359b42b78c/attachments/697eca3036b0dabd9e1726b9/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260131203309.png" },
  ]},
};

function buildGearDropdown(picker, seriesData) {
  picker.style.display = "none";

  const allItems = [];
  Object.entries(seriesData).forEach(([series, names]) => {
    names.forEach(name => allItems.push({ name, series }));
  });

  allItems.forEach(({ name }) => {
    const opt = document.createElement("option");
    opt.value = name;
    picker.appendChild(opt);
  });

  const wrap = document.createElement("div");
  wrap.className = "wpick-wrap";

  const display = document.createElement("div");
  display.className = "wpick-display";
  display.textContent = "— None —";

  const panel = document.createElement("div");
  panel.className = "wpick-panel";
  panel.style.display = "none";

  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "Search...";
  search.className = "wpick-search";

  const list = document.createElement("div");
  list.className = "wpick-list";

  panel.appendChild(search);
  panel.appendChild(list);
  wrap.appendChild(display);
  wrap.appendChild(panel);
  picker.parentNode.insertBefore(wrap, picker);

  function open() { panel.style.display = "block"; search.value = ""; buildList(""); search.focus(); }
  function close() { panel.style.display = "none"; }

  function buildList(q) {
    list.innerHTML = "";

    const none = document.createElement("div");
    none.className = "wpick-item" + (!picker.value ? " wpick-selected" : "");
    none.textContent = "— None —";
    none.addEventListener("mousedown", e => {
      e.preventDefault();
      picker.value = "";
      display.textContent = "— None —";
      close();
      renderMoves(); renderGearInfo(); updatePecents();
    });
    list.appendChild(none);

    const grouped = {};
    allItems.forEach(({ name, series }) => {
      const takenByOther = Array.from(gearPickers).some(p => p !== picker && p.value === name);
      if (takenByOther) return;
      if (q && !name.toLowerCase().includes(q.toLowerCase()) && !series.toLowerCase().includes(q.toLowerCase())) return;
      if (!grouped[series]) grouped[series] = [];
      grouped[series].push(name);
    });

    Object.entries(grouped).forEach(([series, names]) => {
      const header = document.createElement("div");
      header.className = "wpick-group";
      header.textContent = series;
      list.appendChild(header);

      names.forEach(name => {
        const item = document.createElement("div");
        item.className = "wpick-item" + (picker.value === name ? " wpick-selected" : "");
        item.textContent = name;
        item.addEventListener("mousedown", e => {
          e.preventDefault();
          picker.value = name;
          display.textContent = name;
          close();
          renderMoves(); renderGearInfo(); updatePecents();
        });
        list.appendChild(item);
      });
    });
  }

  display.addEventListener("click", () => panel.style.display === "none" ? open() : close());
  search.addEventListener("input", () => buildList(search.value));
  document.addEventListener("mousedown", e => { if (!wrap.contains(e.target)) close(); });
}

function buildWeaponDropdown(picker, seriesData) {
  // Hide the native select — we store the value there but render a custom UI
  picker.style.display = "none";

  const allWeapons = [];
  Object.entries(seriesData).forEach(([series, weapons]) => {
    Object.entries(weapons).forEach(([name, data]) => {
      allWeapons.push({ name, type: data.type, series });
    });
  });

  // --- DOM structure ---
  const wrap = document.createElement("div");
  wrap.className = "wpick-wrap";

  const display = document.createElement("div");
  display.className = "wpick-display";
  display.textContent = "— None —";

  const panel = document.createElement("div");
  panel.className = "wpick-panel";
  panel.style.display = "none";

  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "Search...";
  search.className = "wpick-search";

  const list = document.createElement("div");
  list.className = "wpick-list";

  // Populate hidden select with options so picker.value = name works correctly
  allWeapons.forEach(({ name }) => {
    const opt = document.createElement("option");
    opt.value = name;
    picker.appendChild(opt);
  });

  panel.appendChild(search);
  panel.appendChild(list);
  wrap.appendChild(display);
  wrap.appendChild(panel);
  picker.parentNode.insertBefore(wrap, picker);

  // --- Open / close ---
  function open() {
    panel.style.display = "block";
    search.value = "";
    buildList("");
    search.focus();
  }

  function close() {
    panel.style.display = "none";
  }

  // --- Build filtered list ---
  function buildList(q) {
    list.innerHTML = "";

    const none = document.createElement("div");
    none.className = "wpick-item" + (!picker.value ? " wpick-selected" : "");
    none.textContent = "— None —";
    none.addEventListener("mousedown", e => {
      e.preventDefault();
      picker.value = "";
      display.textContent = "— None —";
      close();
      renderMoves();
      updatePecents();
    });
    list.appendChild(none);

    const grouped = {};
    allWeapons.forEach(({ name, type, series }) => {
      if (!q || `${name} ${type}`.toLowerCase().includes(q.toLowerCase())) {
        if (!grouped[series]) grouped[series] = [];
        grouped[series].push({ name, type });
      }
    });

    Object.entries(grouped).forEach(([series, weapons]) => {
      const header = document.createElement("div");
      header.className = "wpick-group";
      header.textContent = series;
      list.appendChild(header);

      weapons.forEach(({ name, type }) => {
        const item = document.createElement("div");
        item.className = "wpick-item" + (picker.value === name ? " wpick-selected" : "");
        item.textContent = `${name} (${type})`;
        item.addEventListener("mousedown", e => {
          e.preventDefault();
          picker.value = name;
          display.textContent = `${name} (${type})`;
          close();
          renderMoves();
          updatePecents();
        });
        list.appendChild(item);
      });
    });
  }

  display.addEventListener("click", () => {
    panel.style.display === "none" ? open() : close();
  });

  search.addEventListener("input", () => buildList(search.value));

  document.addEventListener("mousedown", e => {
    if (!wrap.contains(e.target)) close();
  });
}

const mainWeaponPicker    = document.getElementById("weapon-main");
const offhandWeaponPicker = document.getElementById("weapon-offhand");

buildWeaponDropdown(mainWeaponPicker, mainWeaponSeries);
buildWeaponDropdown(offhandWeaponPicker, offhandSeries);

// --- Armour ---
// To add armour: "Item Name": { str, arc, end, spd, lck, pct: { str, arc, end, spd, lck } }
// Flat stats add to the stat value before formula. pct adds directly to the output % value.

function buildSimpleDropdown(picker, names, onSelect, isDisabled) {
  picker.style.display = "none";

  const wrap = document.createElement("div");
  wrap.className = "wpick-wrap";

  const display = document.createElement("div");
  display.className = "wpick-display";
  display.textContent = "— None —";

  const panel = document.createElement("div");
  panel.className = "wpick-panel";
  panel.style.display = "none";

  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "Search...";
  search.className = "wpick-search";

  const list = document.createElement("div");
  list.className = "wpick-list";

  names.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    picker.appendChild(opt);
  });

  panel.appendChild(search);
  panel.appendChild(list);
  wrap.appendChild(display);
  wrap.appendChild(panel);
  picker.parentNode.insertBefore(wrap, picker);

  function open() {
    panel.style.display = "block";
    search.value = "";
    buildList("");
    search.focus();
  }

  function close() {
    panel.style.display = "none";
  }

  function buildList(q) {
    list.innerHTML = "";

    const none = document.createElement("div");
    none.className = "wpick-item" + (!picker.value ? " wpick-selected" : "");
    none.textContent = "— None —";
    none.addEventListener("mousedown", e => {
      e.preventDefault();
      picker.value = "";
      display.textContent = "— None —";
      close();
      onSelect();
    });
    list.appendChild(none);

    names
      .filter(name => !q || name.toLowerCase().includes(q.toLowerCase()))
      .forEach(name => {
        const disabled = isDisabled ? isDisabled(name) : false;
        const item = document.createElement("div");
        item.className = "wpick-item" +
          (picker.value === name ? " wpick-selected" : "") +
          (disabled ? " wpick-disabled" : "");
        item.textContent = name;
        if (!disabled) {
          item.addEventListener("mousedown", e => {
            e.preventDefault();
            picker.value = name;
            display.textContent = name;
            close();
            onSelect();
          });
        }
        list.appendChild(item);
      });
  }

  display.addEventListener("click", () => {
    panel.style.display === "none" ? open() : close();
  });

  search.addEventListener("input", () => buildList(search.value));

  document.addEventListener("mousedown", e => {
    if (!wrap.contains(e.target)) close();
  });
}

const armourPicker = document.getElementById("armour-main");
buildSimpleDropdown(armourPicker, Object.keys(armourItems), () => {
  const newVal = armourPicker.value;
  updateArmourGold(prevArmourSelection, newVal);
  prevArmourSelection = newVal;
  updatePecents();
});

// --- Scrolls ---
// To add a lost scroll: "Item Name": { str, arc, end, spd, lck, pct: { str, arc, end, spd, lck } }
const lostScrollItems = {
  "Metrom's Grasp": {},
  "Absolute Radiance": {},
  "Heavenly Prayer": {},
  "Breath of Fungyir": {},
  "Permafrost Curse": {},
  "Wild Impulse": {}
};

const lostScrollMoves = {
  "Metrom's Grasp": {
    learns: [
      { level: 1, type: "Active", name: "Metrom's Grasp", quote: "", cost: 5, cooldown: 18, moveType: "Magic", category: "Buff", duration: 5, effect: "Decreases opponents' defense by 40%, makes them harder to block/dodge. Grants 30% more damage for DoT effects over 5 turns." }
    ]
  },
  "Absolute Radiance": {
    learns: [
      { level: 1, type: "Active", name: "Absolute Radiance", quote: "", cost: 4, cooldown: 18, moveType: "Fire", category: "Buff", duration: 5, effect: "Growing dmg/DR buff each turn — reaches up to 22.5% more damage by turn 5 (~7.5%/10%/12.5%/15%/22.5%)." }
    ]
  },
  "Heavenly Prayer": {
    learns: [
      { level: 1, type: "Active", name: "Heavenly Prayer", quote: "", cost: 5, cooldown: 22, moveType: "Holy", category: "Buff", duration: 3, effect: "Grants 10% Lifesteal for 5 turns, 3 Resist, 15% DR for 3 turns, and Death Defy for 2 turns." }
    ]
  },
  "Breath of Fungyir": {
    learns: [
      { level: 1, type: "Active", name: "Breath of Fungyir", quote: "", cost: 4, cooldown: 20, moveType: "Magic", category: "Buff", effect: "Enter a stance and unleash a heavy stun on the opponent. Also fully heals your entire team." }
    ]
  },
  "Permafrost Curse": {
    learns: [
      { level: 1, type: "Active", name: "Permafrost Curse", quote: "", cost: 4, cooldown: 10, moveType: "Ice", category: "Attack", damage: 14, scaling: "STR/75", effect: "Applies 2 Cold and 1 Stun. Acts as a pseudo-AoE, hitting adjacent enemies as well." }
    ]
  },
  "Wild Impulse": {
    learns: [
      { level: 1, type: "Active", name: "Wild Impulse", quote: "", cost: 1, cooldown: 10, moveType: "Magic", category: "Buff", effect: "Your next hit becomes a pseudo-AoE, dealing 20% damage to all nearby enemies. Applies 2 Vulnerable and Weakened to all targets hit." }
    ]
  }
};

// To add a scroll: "Item Name": { str, arc, end, spd, lck, pct: { str, arc, end, spd, lck } }
const scrollItems = {
  "Lights Out": {},
  "Bulk Up": {},
  "Immolation": {},
  "Lesser Absorb": {},
  "Steel Body": {},
  "Self Cure": {},
  "Simple Curse": {},
  "Fireball": {},
  "Ice Shards": {},
  "Dark Slash": {},
  "Lesser Empower": {},
  "Torching Soul": {},
  "Wind Reflect": {},
  "Surprise Package": {},
  "Blizzard": {}
};

const scrollMoves = {
  "Lights Out": {
    learns: [
      { level: 1, type: "Active", name: "Lights Out", quote: "", cost: 1, cooldown: 5, moveType: "Holy", category: "Buff", effect: "Applies 3 Blinded and 1 Stunned to all enemies. Has a chance to backfire and apply to yourself instead." }
    ]
  },
  "Bulk Up": {
    learns: [
      { level: 1, type: "Active", name: "Bulk Up", quote: "", cost: 1, cooldown: 6, moveType: "Physical", category: "Buff", effect: "Increases damage by 20% and decreases the user's own defense by 20%. Defense decrease is multiplicative (2 stacks = 44% more dmg taken, 3 stacks = 72%)." }
    ]
  },
  "Immolation": {
    learns: [
      { level: 1, type: "Active", name: "Immolation", quote: "", cost: 2, cooldown: 999, moveType: "Fire", category: "Buff", effect: "Gain a 10% damage buff (defense buff is bugged). Take 0.1 damage per turn, increasing by 0.1 each turn. Cannot kill you; leaves you at 0.1 HP." }
    ]
  },
  "Lesser Absorb": {
    learns: [
      { level: 1, type: "Active", name: "Lesser Absorb", quote: "", cost: 1, cooldown: 9, moveType: "Magic", category: "Buff", duration: 2, effect: "Places an orb over an ally, redirecting 5% of the damage they take towards you. Cannot be used on yourself." }
    ]
  },
  "Steel Body": {
    learns: [
      { level: 1, type: "Active", name: "Steel Body", quote: "", cost: 2, cooldown: 8, moveType: "Physical", category: "Buff", duration: 1, effect: "Decrease all incoming damage by 80%. Does not work on boss ultimates." }
    ]
  },
  "Self Cure": {
    learns: [
      { level: 1, type: "Active", name: "Self Cure", quote: "", cost: 2, cooldown: 7, moveType: "Holy", category: "Buff", effect: "Take ~5% of your max HP as damage and remove all status effects applied to you (only one stack of Inferno/Plague removed)." }
    ]
  },
  "Simple Curse": {
    learns: [
      { level: 1, type: "Active", name: "Simple Curse", quote: "", cost: 2, cooldown: 6, moveType: "Hex", category: "Attack", damage: 5, scaling: "ARC/75", effect: "Applies 2 Vulnerable and 3 Weakened on hit." }
    ]
  },
  "Fireball": {
    learns: [
      { level: 1, type: "Active", name: "Fireball", quote: "", cost: 2, cooldown: 4, moveType: "Fire", category: "Attack", damage: 9, scaling: "ARC/75", effect: "Has a chance to apply 3 Burning on hit." }
    ]
  },
  "Ice Shards": {
    learns: [
      { level: 1, type: "Active", name: "Ice Shards", quote: "", cost: 3, cooldown: 8, moveType: "Ice", category: "Attack", damage: "3.5x4", scaling: "ARC/75", effect: "Applies 1 Weakened and 3 Cold on hit." }
    ]
  },
  "Dark Slash": {
    learns: [
      { level: 1, type: "Active", name: "Dark Slash", quote: "", cost: 2, cooldown: 6, moveType: "Dark", category: "Attack", damage: 11, scaling: "STR/75", effect: "Has a chance to apply 2 Weakened." }
    ]
  },
  "Lesser Empower": {
    learns: [
      { level: 1, type: "Active", name: "Lesser Empower", quote: "", cost: 2, cooldown: 6, moveType: "Magic", category: "Buff", duration: 2, effect: "Give the target a 15% damage buff for 2 turns." }
    ]
  },
  "Torching Soul": {
    learns: [
      { level: 1, type: "Active", name: "Torching Soul", quote: "", cost: 3, cooldown: 20, moveType: "Fire", category: "Buff", duration: 5, effect: "Heal 3% of max HP every time you consume or are inflicted with Burn. Gain a damage and defense buff per Burn (doesn't stack). Duration 5 turns." }
    ]
  },
  "Wind Reflect": {
    learns: [
      { level: 1, type: "Active", name: "Wind Reflect", quote: "", cost: 2, cooldown: 12, moveType: "Nature", category: "Buff", duration: 3, effect: "Place a shield on yourself or an ally, preventing physical attacks from hitting them. Does not fully work against bosses." }
    ]
  },
  "Surprise Package": {
    learns: [
      { level: 1, type: "Active", name: "Surprise Package", quote: "", cost: 2, cooldown: 11, moveType: "Physical", category: "Buff", effect: "Plant a bomb on a target for 3 turns, dealing 30% of max HP (5% for bosses). Explodes with effects based on triggering affinity — Physical/Magic: +35% bonus dmg; Fire: +15% fire dmg + 10 Burning; Holy: 1 Resist + 10% HP heal to party; Ice: 6 Cold to all + -5% def 4 turns; Poison: 20 Poison + 2 Weaken to all; Hex: 1 Hex + 100 true dmg; Dark: 3 Vulnerable + 3 Weakened + disable dodge 4 turns; Nature: Daminos Restructure + remove 1 debuff from each party member." }
    ]
  },
  "Blizzard": {
    learns: [
      { level: 1, type: "Active", name: "Blizzard", quote: "", cost: 2, cooldown: 15, moveType: "Ice", category: "Buff", duration: 4, effect: "Creates a snowstorm for 4 turns: all defense -20%, fire defense +25%, increasing ice damage by 20% for the team. Also increases the team's defense by 10%." }
    ]
  }
};

const lostScrollPicker = document.getElementById("scroll-lost");
buildSimpleDropdown(lostScrollPicker, Object.keys(lostScrollItems), () => { renderMoves(); updatePecents(); });

const scroll1Picker = document.getElementById("scroll-1");
const scroll2Picker = document.getElementById("scroll-2");
buildSimpleDropdown(scroll1Picker, Object.keys(scrollItems), () => { renderMoves(); updatePecents(); });
buildSimpleDropdown(scroll2Picker, Object.keys(scrollItems), () => { renderMoves(); updatePecents(); });

// --- Covenants ---
// To add a covenant: "Name": { learns: [...] }
// learns entry: { level: <rank_req>, type: "Active"|"Passive", name, quote, effect, [cost, cooldown, moveType, category, damage, scaling] }
const covenantItems = {
  "Blades of the World": {},
  "Way of Life": {},
  "Church of Raphion": {},
  "Cult of Thanasiu": {}
};

const covenantMoves = {
  "Blades of the World": {
    learns: [
      { level: 1,  type: "Passive", name: "Mercenary",            quote: "", effect: "Gain more from guild requests by 50% and 3x the amount of the potion rewards." },
      { level: 3,  type: "Passive", name: "Initiate Blade",       quote: "", effect: "Grants access to the blades questboard." },
      { level: 5,  type: "Passive", name: "Assassin's Cape",      quote: "", effect: "Reward item." },
      { level: 10, type: "Active",  name: "Gilded Strike",        quote: "", cost: 2, cooldown: 9, moveType: "Holy", category: "Attack", damage: 12, scaling: "STR/75", effect: "Gain (?)% of the enemies hp in gold, 190% if you unlocked the Avarice passive. (Does not work on bosses)" },
      { level: 13, type: "Passive", name: "Mercenary's Cape",     quote: "", effect: "Reward item." },
      { level: 15, type: "Passive", name: "Avarice",              quote: "", effect: "Gain much more gold (30%). The mysterious merchant respects you. (~30% discount & sell price)." },
      { level: 20, type: "Passive", name: "Blessing of Survival", quote: "", effect: "Gives Mulligan upon reaching 0 health which makes you survive 1 more turn with 0.1 hp." }
    ]
  },
  "Way of Life": {
    learns: [
      { level: 1,  type: "Passive", name: "Gatherer",          quote: "", effect: "Have a chance of getting double of an ingredient when collecting." },
      { level: 5,  type: "Passive", name: "Lifebound",         quote: "", effect: "Gives 15% outgoing healing." },
      { level: 7,  type: "Passive", name: "Alchemist's Scarf", quote: "", effect: "Reward item." },
      { level: 10, type: "Active",  name: "Lesser Heal",       quote: "", cost: 2, cooldown: 6, moveType: "Nature", scaling: "Outgoing%", effect: "Heals for (?) at base." },
      { level: 13, type: "Passive", name: "Blindfold",         quote: "", effect: "Reward item." },
      { level: 15, type: "Passive", name: "Graced One",        quote: "", effect: "Lesser Heal now heals for (?) more." },
      { level: 20, type: "Passive", name: "Blessing of Life",  quote: "", effect: "Gives 2x for all passive regen in fights and 1% passive regen out of fights every 3s." }
    ]
  },
  "Church of Raphion": {
    learns: [
      { level: 1,  type: "Active",  name: "Bless",            quote: "", cost: 1, cooldown: 5, moveType: "Holy", scaling: "Unknown", effect: "Clears basic debuffs (burn, vulnerable, ?) on a target, and heals them for 2% per type of debuff cleansed." },
      { level: 5,  type: "Passive", name: "Supporting Light", quote: "", effect: "After buffing a target, recover some hp and gain a boost to damage reduction for 2 turns." },
      { level: 10, type: "Active",  name: "Holy Light",       quote: "", cost: 2, cooldown: 5, moveType: "Holy", scaling: "END/100", effect: "5% DR buff and a 0.5% regen for 4 turns upon usage. Also grants the targeted person a 20 HP shield that scales with Endurance. Dodging an attack will still reduce the shield." },
      { level: 15, type: "Passive", name: "Spreading Grace",  quote: "", effect: "Meditating gives one other person in the party +1 energy as well, and getting hit during your meditation creates a burst of healing for your team that recovers (?) hp." },
      { level: 20, type: "Passive", name: "N/A",              quote: "", effect: "Grants the ability to teleport/host and fight Seraphon." }
    ]
  },
  "Cult of Thanasiu": {
    learns: [
      { level: 1,  type: "Active",  name: "Soul Absorb",        quote: "", cost: 1, cooldown: 4, moveType: "Dark", category: "Attack", damage: 2, scaling: "N/A", effect: "Deal 2 damage, but instantly kill enemy if they have 5% (2.5% of max hp for bosses) or less of max hp and the attack hits them. Will not kill if the enemy blocks or dodges it; being immune to dark damage also prevents the kill." },
      { level: 5,  type: "Passive", name: "Internal Corruption", quote: "", effect: "Killing enemies gives you +2 energy. Summons get only +1 energy from killing." },
      { level: 10, type: "Active",  name: "Death Curtain",       quote: "", cost: 2, cooldown: 6, moveType: "Dark", category: "Attack", damage: "6x2", scaling: "STR/75 + ARC/75", effect: "Pull down a hail of projectiles upon enemy and adjacent enemies. Heals 25% of max hp over 4 turns per enemy killed (6.25% per turn), capping at 2 enemies for a total of 50% max hp over 4 turns, and gives 1 energy. Deals double damage if enemy has the Cursed status effect." },
      { level: 15, type: "Passive", name: "Dark Inversion",      quote: "", effect: "Dark and Hex affinity attacks deal 10% less damage to you. If they deal more than 20% of your max hp, gain 1 energy." },
      { level: 20, type: "Passive", name: "N/A",                 quote: "", effect: "Grants the ability to teleport/host and fight Arkhaia." }
    ]
  }
};

const covenantPicker = document.getElementById("covenant-picker");
const covenantRankInput = document.getElementById("covenant-rank");

Object.keys(covenantItems).forEach(name => {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  covenantPicker.appendChild(opt);
});

covenantPicker.addEventListener("change", () => { renderMoves(); updatePecents(); });
covenantRankInput.addEventListener("change", () => {
  covenantRankInput.value = Math.min(20, Math.max(1, +covenantRankInput.value || 1));
  renderMoves();
  updatePecents();
});


// --- Classes ---
// To add a class: "ClassName": ["SuperClass1", "SuperClass2", ...]
// To add sub-classes: "SuperClassName": ["SubClass1", "SubClass2", ...]
const subClasses = ["Bard", "Beastmaster", "Alchemist", "Blacksmith", "Miner"];

// To add a class: "ClassName": ["SuperClass1", "SuperClass2", ...]
const classes = {
  "Thief": ["Ranger (Or)", "Rogue (N)", "Assassin (Ch)"],
  "Warrior":["Paladin (Or)", "Blade Dancer (N)", "Berserker (Ch)"],
  "Wizard":["Elementalist (Or)", "Hexer (N)", "Necromancer (Ch)"],
  "Martial Artist":["Monk (Or)", "Brawler (N)", "Darkwraith (Ch)"],
  "Slayer":["Saint (Or)", "Lancer (N)", "Impaler (Ch)"],
  "Marauder":["Lionheart (N)"],
  "Sentry":["Citadel (Or)", "Arbiter (N)"]
};

const classPicker = document.getElementById("class-picker");
const superPicker = document.getElementById("super-picker");
const subPicker   = document.getElementById("sub-picker");
const goldDisplay = document.getElementById("Gold");

const CLASS_GOLD_COST = {
  "Warrior": 200, "Thief": 200, "Slayer": 200, "Wizard": 120,
  "Martial Artist": 220, "Sentry": 500,
  "Paladin (Or)": 2400, "Ranger (Or)": 2000, "Elementalist (Or)": 2000,
  "Monk (Or)": 2400, "Saint (Or)": 2000, "Citadel (Or)": 2000,
  "Rogue (N)": 3750, "Hexer (N)": 3750, "Lancer (N)": 3750,
  "Blade Dancer (N)": 3750, "Brawler (N)": 3750,
  "Lionheart (N)": 6250, "Arbiter (N)": 6250,
  "Assassin (Ch)": 2000, "Berserker (Ch)": 2000, "Necromancer (Ch)": 2000,
  "Darkwraith (Ch)": 2000, "Impaler (Ch)": 2400,
  "Bard": 1200,
  "Beastmaster": 750,
  "Alchemist": 800,
  "Blacksmith": 3000,
  "Miner": 1000
};
let totalGold = 0;
let prevClassSelection = "";
let prevSuperSelection = "";
let prevSubSelection   = "";
let prevArmourSelection = "";

const ARMOUR_GOLD_COST = 750;

function updateArmourGold(oldArmour, newArmour) {
  if (oldArmour) totalGold -= ARMOUR_GOLD_COST;
  if (newArmour) totalGold += ARMOUR_GOLD_COST;
  goldDisplay.textContent = totalGold;
}

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

subClasses.forEach(name => {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  subPicker.appendChild(opt);
});
subPicker.disabled = true;

classPicker.addEventListener("change", () => {
  const selected = classPicker.value;
  updateGold(prevClassSelection, selected);
  updateGold(prevSuperSelection, "");
  prevClassSelection = selected;
  prevSuperSelection = "";
  superPicker.innerHTML = "";
  resetSubPicker();

  if (!selected) {
    superPicker.disabled = true;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— Select Class First —";
    superPicker.appendChild(opt);
    return;
  }

  const lvl = Math.min(Max_Lvl, Math.max(Min_Lvl, +lvlInput.value || Min_Lvl));
  if (lvl < 15) {
    superPicker.disabled = true;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Req. Lvl 15";
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
        damage: "X*1.6",
        scaling: "STR/60",
        effect: "Denies an attack if it is targeted at you and instead attacks back. X is equal to the BaseDMG of whatever move you countered.\n\nSelf-Target | Unblockable and Undodgeable"
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
        effect: "Can trigger multiple times on a single attack and works whilst guarding. Only affects melee attacks and cannot crit or trigger any special effects. The parry damage scales on strength."
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
        scaling: "STR/120",
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
        effect: "Deals 30% more damage against burning opponents (no visual indicator). Applies either 3 or 6 burning onto the opponent.",
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
        moveType: "Physical",
        category: "Attack",
        damage: 15,
        scaling: "STR",
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
        damage: "1.6x8",
        scaling: "STR",
        effect: "Deals multi-hit damage to a single enemy.\n\nFlaming Overdrive: Has a chance to apply Ghostflame.",
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
        cost: 3,
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
        scaling: "STR/ARC",
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
        scaling: "STR/ARC",
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
        damage: "8.5x3",
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
        damage: 24,
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
        damage: "18x2",
        scaling: "STR/75 + ARC/75",
        effect: "Deals 8.25% of max HP as self-damage on use. Applies 1 Bleed per hit. If the target is already Bleeding, instead applies 1 Bleed, 1 Vulnerable, and 2 Weakened. Status effects are applied before the hit lands, allowing them to affect the damage.",
        image: "https://trello.com/1/cards/67b3296a59bf4c7eaa7b6db5/attachments/69803c189ae4ae526a618904/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260202105307.png"
      }
    ]
  },
  "Marauder": { innatePassives: [], learns: [] },
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
        damage: "7", scaling: "STR",
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
        slot: 1, level: 5, type: "Passive", name: "Iron Gut",
        requireItem: "Small Heal Potion",
        effect: "+1 potion use for all potion tiers in battle.",
        image: ""
      },
      {
        slot: 2, level: 5, type: "Active", name: "Dangerous Mixture",
        requireItem: "Ferrus Skin Potion",
        cost: 2, cooldown: 6, moveType: "Poison", category: "Utility",
        damage: "5", scaling: "STR/ARC",
        effect: "Applies 3 different stacks of 3 of vulnerable, blind, cursed, poison, burn and weakened. Unblockable and Undodgeable.",
        image: "https://trello.com/1/cards/67b6913c063ca71f8358c48f/attachments/697ccfd34fae77ea20108ebd/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260130203535.png"
      },
      {
        slot: 3, level: 5, type: "Passive", name: "Create Cauldron",
        requireItem: "Invisibility Potion",
        effect: "Utility item, spawn cauldron to brew potions.",
        image: ""
      },
      {
        slot: 4, level: 5, type: "Passive", name: "Certified",
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

function isSummonMove(m) {
  const s = m.slot || "";
  if (!s) return false;
  if (/^Active$/i.test(s) || /^Passive$/i.test(s)) return false;
  return !/^\d+(st|nd|rd|th)\s+Learn$/i.test(s)
      && !/^Class\s+Active$/i.test(s)
      && !/^Tier\s+\d+$/i.test(s);
}

function entityMovesHtml(data, lvl) {
  const actives = (data.learns || []).filter(m => m.type === "Active" && !isSummonMove(m));
  if (!actives.length) return "";
  let h = `<h3 class="moves-section-title">Moves</h3>`;
  actives.forEach(m => h += activeCardHtml(m, lvl));
  return h;
}

function entityPassivesHtml(data, lvl) {
  const innates  = data.innatePassives || [];
  const passives = (data.learns || []).filter(m => m.type === "Passive" && !isSummonMove(m));
  if (!innates.length && !passives.length) return "";
  let h = `<h3 class="moves-section-title">Passives</h3>`;
  innates.forEach(p => h += innateCardHtml(p, lvl));
  passives.forEach(m => h += passiveCardHtml(m, lvl));
  return h;
}

function covenantActiveCardHtml(m) {
  return `
    <div class="move-learn-header">Rank <span class="move-learn-level">${m.level}</span></div>
    <div class="move-card active-move">
      <div class="move-header"><span class="move-badge active-badge">Active</span></div>
      <div class="move-name">${m.name}</div>
      ${m.quote ? `<div class="move-quote">"${m.quote}"</div>` : ""}
      <div class="move-stats">
        ${m.cost !== undefined ? `<span class="move-stat">Cost: ${m.cost}</span>` : ""}
        ${m.cooldown !== undefined ? `<span class="move-stat">CD: ${m.cooldown}</span>` : ""}
        ${m.moveType ? `<span class="move-stat">Type: ${m.moveType}</span>` : ""}
        ${m.category ? `<span class="move-stat">Cat: ${m.category}</span>` : ""}
        ${m.damage !== undefined ? `<span class="move-stat">Dmg: ${m.damage}</span>` : ""}
        ${m.scaling ? `<span class="move-stat">Scl: ${m.scaling}</span>` : ""}
      </div>
      <div class="move-desc">${m.effect}</div>
    </div>`;
}

function covenantPassiveCardHtml(m) {
  return `
    <div class="move-learn-header">Rank <span class="move-learn-level">${m.level}</span></div>
    <div class="move-card passive">
      <div class="move-header"><span class="move-badge passive-badge">Passive</span></div>
      <div class="move-name">${m.name}</div>
      ${m.quote ? `<div class="move-quote">"${m.quote}"</div>` : ""}
      <div class="move-desc">${m.effect}</div>
    </div>`;
}

function covenantMovesHtml(data, rank) {
  const actives = (data.learns || []).filter(m => m.type === "Active" && m.level <= rank);
  if (!actives.length) return "";
  let h = `<h3 class="moves-section-title">Moves</h3>`;
  actives.forEach(m => h += covenantActiveCardHtml(m));
  return h;
}

function covenantPassivesHtml(data, rank) {
  const passives = (data.learns || []).filter(m => m.type === "Passive" && m.level <= rank);
  if (!passives.length) return "";
  let h = `<h3 class="moves-section-title">Passives</h3>`;
  passives.forEach(m => h += covenantPassiveCardHtml(m));
  return h;
}

function renderMoves() {
  const container = document.getElementById("moves-content");
  const raceName     = racePicker.value;
  const baseClass    = classPicker.value;
  const superClass   = superPicker.value;
  const subClass     = subPicker.value;
  const markName     = markPicker.value;
  const artifactName = artifactPicker.value;
  const weaponMain   = document.getElementById("weapon-main").value;
  const weaponOff    = document.getElementById("weapon-offhand").value;
  const covenantName = covenantPicker.value;
  const gearSlots    = ["gear-1","gear-2","gear-3","gear-4"].map(id => document.getElementById(id)?.value || "").filter(Boolean);
  const lostScrollName = lostScrollPicker.value;
  const scroll1Name  = scroll1Picker.value;
  const scroll2Name  = scroll2Picker.value;
  const covenantRank = Math.min(20, Math.max(1, +covenantRankInput.value || 1));
  const lvl = +lvlInput.value || 1;

  if (!raceName && !baseClass && !markName && !artifactName && !weaponMain && !weaponOff && !covenantName && !gearSlots.length && !lostScrollName && !scroll1Name && !scroll2Name) {
    container.innerHTML = `<p class="moves-placeholder">Make a selection to view moves.</p>`;
    renderDmgCalc();
    return;
  }

  const raceData      = raceName     ? raceMoves[raceName]         : null;
  const baseData      = baseClass    ? classMoves[baseClass]       : null;
  const superData     = superClass   ? classMoves[superClass]      : null;
  const subData       = subClass     ? classMoves[subClass]        : null;
  const markData      = markName     ? markMoves[markName]         : null;
  const artifactData  = artifactName ? artifactMoves[artifactName] : null;
  const weaponMainData = weaponMain    ? weaponMoves[weaponMain]       : null;
  const weaponOffData  = weaponOff     ? weaponMoves[weaponOff]        : null;
  const covenantData   = covenantName  ? covenantMoves[covenantName]   : null;
  const lostScrollData = lostScrollName ? lostScrollMoves[lostScrollName] : null;
  const scroll1Data    = scroll1Name   ? scrollMoves[scroll1Name]      : null;
  const scroll2Data    = scroll2Name   ? scrollMoves[scroll2Name]      : null;
  const gearDataList   = gearSlots.map(name => ({ name, data: gearMoves[name] || null })).filter(g => g.data);

  let html = "";

  // --- Side-by-side columns — only render a column if that slot is selected ---
  html += `<div class="moves-columns">`;

  if (raceName) {
    html += `<div class="moves-col">`;
    html += `<h2 class="moves-race-title">${raceName}</h2>`;
    if (raceData) { html += entityMovesHtml(raceData, lvl); html += entityPassivesHtml(raceData, lvl); }
    html += `</div>`;
  }

  if (baseClass) {
    html += `<div class="moves-col">`;
    html += `<div class="moves-entity-label">Base Class</div>`;
    html += `<h2 class="moves-race-title">${baseClass}</h2>`;
    if (baseData) { html += entityMovesHtml(baseData, lvl); html += entityPassivesHtml(baseData, lvl); }
    html += `</div>`;
  }

  if (superClass) {
    html += `<div class="moves-col">`;
    html += `<div class="moves-entity-label">Super Class</div>`;
    html += `<h2 class="moves-race-title">${superClass}</h2>`;
    if (superData) { html += entityMovesHtml(superData, lvl); html += entityPassivesHtml(superData, lvl); }
    html += `</div>`;
  }

  if (subClass) {
    html += `<div class="moves-col">`;
    html += `<div class="moves-entity-label">Sub Class</div>`;
    html += `<h2 class="moves-race-title">${subClass}</h2>`;
    if (subData) { html += entityMovesHtml(subData, lvl); html += entityPassivesHtml(subData, lvl); }
    html += `</div>`;
  }

  if (artifactName) {
    html += `<div class="moves-col">`;
    html += `<div class="moves-entity-label">Artifact</div>`;
    html += `<h2 class="moves-race-title">${artifactName}</h2>`;
    if (artifactData) { html += entityMovesHtml(artifactData, lvl); html += entityPassivesHtml(artifactData, lvl); }
    html += `</div>`;
  }

  if (markName) {
    html += `<div class="moves-col">`;
    html += `<div class="moves-entity-label">Mark</div>`;
    html += `<h2 class="moves-race-title">${markName}</h2>`;
    if (markData) { html += entityMovesHtml(markData, lvl); html += entityPassivesHtml(markData, lvl); }
    html += `</div>`;
  }

  if (weaponMain || weaponOff) {
    html += `<div class="moves-col">`;
    if (weaponMain) {
      html += `<div class="moves-entity-label">Weapon</div>`;
      html += `<h2 class="moves-race-title">${weaponMain}</h2>`;
      if (weaponMainData) { html += entityMovesHtml(weaponMainData, lvl); html += entityPassivesHtml(weaponMainData, lvl); }
    }
    if (weaponOff) {
      html += `<div class="moves-entity-label" style="margin-top:18px">Off Hand</div>`;
      html += `<h2 class="moves-race-title">${weaponOff}</h2>`;
      if (weaponOffData) {
        html += entityMovesHtml(weaponOffData, lvl);
        const isShield = !!(offhandSeries["Shields"] && offhandSeries["Shields"][weaponOff]);
        const shieldClasses = ["Paladin (Or)", "Lancer (N)", "Lionheart (N)", "Citadel (Or)"];
        const hasShieldClass = shieldClasses.some(c => c === baseClass || c === superClass || c === subClass);
        if (!isShield || hasShieldClass) html += entityPassivesHtml(weaponOffData, lvl);
      }
    }
    html += `</div>`;
  }

  if (covenantName) {
    html += `<div class="moves-col">`;
    html += `<div class="moves-entity-label">Covenant</div>`;
    html += `<h2 class="moves-race-title">${covenantName} <span class="moves-entity-label">Rank ${covenantRank}</span></h2>`;
    if (covenantData) { html += covenantMovesHtml(covenantData, covenantRank); html += covenantPassivesHtml(covenantData, covenantRank); }
    html += `</div>`;
  }

  if (scroll1Name || scroll2Name) {
    html += `<div class="moves-col">`;
    if (scroll1Name) {
      html += `<div class="moves-entity-label">Scroll 1</div>`;
      html += `<h2 class="moves-race-title">${scroll1Name}</h2>`;
      if (scroll1Data) { html += entityMovesHtml(scroll1Data, lvl); html += entityPassivesHtml(scroll1Data, lvl); }
    }
    if (scroll2Name) {
      html += `<div class="moves-entity-label"${scroll1Name ? ' style="margin-top:18px"' : ''}>Scroll 2</div>`;
      html += `<h2 class="moves-race-title">${scroll2Name}</h2>`;
      if (scroll2Data) { html += entityMovesHtml(scroll2Data, lvl); html += entityPassivesHtml(scroll2Data, lvl); }
    }
    html += `</div>`;
  }

  if (lostScrollName) {
    html += `<div class="moves-col">`;
    html += `<div class="moves-entity-label">Lost Scroll</div>`;
    html += `<h2 class="moves-race-title">${lostScrollName}</h2>`;
    if (lostScrollData) { html += entityMovesHtml(lostScrollData, lvl); html += entityPassivesHtml(lostScrollData, lvl); }
    html += `</div>`;
  }

  html += `</div>`; // end .moves-columns

  // --- Summons section ---
  const allData = [raceData, baseData, superData, subData, artifactData, markData, weaponMainData, weaponOffData, covenantData, scroll1Data, scroll2Data, lostScrollData, ...gearDataList.map(g => g.data)].filter(Boolean);
  const allSummonMoves = allData.flatMap(d => (d.learns || []).filter(isSummonMove));
  if (allSummonMoves.length) {
    const summonGroups = {};
    allSummonMoves.forEach(m => {
      if (!summonGroups[m.slot]) summonGroups[m.slot] = [];
      summonGroups[m.slot].push(m);
    });
    html += `<div class="moves-combined-row">`;
    html += `<h2 class="moves-combined-title">Summons</h2>`;
    html += `<div class="moves-columns">`;
    Object.entries(summonGroups).forEach(([summonName, moves]) => {
      html += `<div class="moves-col">`;
      html += `<h2 class="moves-race-title">${summonName}</h2>`;
      moves.forEach(m => html += activeCardHtml(m));
      html += `</div>`;
    });
    html += `</div></div>`;
  }

  // --- Combined sections ---
  if (allData.length > 1) {
    html += `<div class="moves-combined-row">`;

    const allActives = allData.flatMap(d => (d.learns || []).filter(m => m.type === "Active" && !isSummonMove(m)));
    if (allActives.length) {
      html += `<div class="moves-combined-section">`;
      html += `<h2 class="moves-combined-title">All Moves</h2>`;
      allActives.forEach(m => html += activeCardHtml(m));
      html += `</div>`;
    }

    const allInnates  = allData.flatMap(d => (d.innatePassives || []));
    const allPassives = allData.flatMap(d => (d.learns || []).filter(m => m.type === "Passive" && !isSummonMove(m)));
    if (allInnates.length || allPassives.length) {
      html += `<div class="moves-combined-section">`;
      html += `<h2 class="moves-combined-title">All Passives</h2>`;
      allInnates.forEach(p => html += innateCardHtml(p));
      allPassives.forEach(m => html += passiveCardHtml(m));
      html += `</div>`;
    }

    html += `</div>`;
  }

  container.innerHTML = html;
  renderDmgCalc();
}

// --- Dmg Calc helpers ---

let dmgCalcMoveList = [];
let energyCount = 0;
let rageEmpHpConsumed = 0; // 0-65: % of max HP consumed → up to 65% dmg bonus
let absRadTurn = 1; // 1-5: current turn for Absolute Radiance buff
const ABS_RAD_BONUSES = [7.5, 10, 12.5, 15, 22.5];
let bulkUpStacks = 1; // 1-10: number of Bulk Up uses (additive 20% per stack)
let hourglassStacks = 1; // 1-5: Sands Of Time stacks (20% per stack, capped at 5)
const statusEffectsActive = { vulnerable: false, hexed: false, sundered: false, fractured: false, overheat: false };
let overheatStacks = 1; // 1-10: Overheat stacks (+8% dmg each)
let oppressionCount = 1; // 1-5: unique status effects on target for Oppression (+5% each)

const STAT_LABEL_MAP = { STR: "str", ARC: "arc", END: "end", SPD: "spd", LCK: "lck" };

function parseScaling(scalingStr) {
  // Returns [{stat, scaling, label}, ...] or null if unparseable
  if (!scalingStr) return null;
  const s = scalingStr.trim();
  if (s === "N/A" || s === "Unknown" || s === "" || s.includes("%") || s.includes("*") || s.includes("?")) return null;
  const parts = s.split("+").map(p => p.trim());
  const result = [];
  for (const part of parts) {
    const m = part.match(/^(STR|ARC|END|SPD|LCK)\/(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    result.push({ stat: STAT_LABEL_MAP[m[1]], scaling: +m[2], label: m[1] });
  }
  return result.length ? result : null;
}

function getTotalStat(statKey) {
  const row = document.querySelector(`.stat-row[data-stat="${statKey}"] .stat-val`);
  const allocated = row ? +row.value : 0;
  const lvl = Math.min(Max_Lvl, Math.max(Min_Lvl, +lvlInput.value || Min_Lvl));
  const lvlBonus = Math.floor(lvl / 5);
  const masteryStats = getMasteryStatBonuses();
  const armourEl = document.getElementById("armour-main");
  const armourData = armourItems?.[armourEl?.value] || {};
  const gearBonuses = {};
  ["gear-1","gear-2","gear-3","gear-4"].forEach(id => {
    const g = gearItems?.[document.getElementById(id)?.value];
    if (g) Object.entries(g).forEach(([k, v]) => { if (v) gearBonuses[k] = (gearBonuses[k] || 0) + v; });
  });
  return allocated + (raceBase[statKey] ?? 0) + (armourData[statKey] ?? 0) + (masteryStats[statKey] ?? 0) + (gearBonuses[statKey] ?? 0) + lvlBonus;
}

function toggleDmgDetail(rowEl, idx) {
  const detail = rowEl.nextElementSibling;
  if (!detail || !detail.classList.contains("dc-detail")) return;
  if (detail.style.display !== "none") { detail.style.display = "none"; rowEl.classList.remove("dc-row-open"); return; }

  const m = dmgCalcMoveList[idx];
  const scalings = parseScaling(m.scaling);

  // Parse base damage — handle "6x2" style
  let baseDmgNum = null;
  let hitCount = 1;
  if (m.damage !== undefined) {
    const dmgStr = String(m.damage);
    const multiHit = dmgStr.match(/^(\d+(?:\.\d+)?)x(\d+)$/);
    if (multiHit) { baseDmgNum = +multiHit[1]; hitCount = +multiHit[2]; }
    else if (/^\d+(\.\d+)?$/.test(dmgStr)) baseDmgNum = +dmgStr;
  }

  if (baseDmgNum === null) {
    detail.innerHTML = `<div class="dc-calc-unavail">No damage calculation available for this move.</div>`;
    detail.style.display = "block"; rowEl.classList.add("dc-row-open"); return;
  }

  // Energy bonus for energy-scaling moves
  function getEnergyBonusPct(move) {
    if (!move.energyScaling || energyCount <= 0) return 0;
    const extra = Math.max(0, energyCount - move.energyScaling.past);
    return extra * move.energyScaling.perEnergy;
  }

  function buildBonusTag(activePct, energyPct) {
    if (activePct > 0 && energyPct > 0)
      return `[+${activePct}% bonus, +${energyPct}% energy (${energyCount}E)]`;
    if (energyPct > 0)
      return `[+${energyPct}% energy (${energyCount}E)]`;
    return `[+${activePct}% bonus]`;
  }

  if (!scalings) {
    const activeBonus  = getActiveDmgBonus();
    const energyBonus  = getEnergyBonusPct(m);
    const totalBonus   = activeBonus + energyBonus;
    const bonusMult    = 1 + totalBonus / 100;
    const boosted      = baseDmgNum * bonusMult;
    let formula; let currentDmg;
    if (totalBonus > 0) {
      currentDmg = hitCount > 1 ? boosted * hitCount : boosted;
      formula = `${baseDmgNum} × ${bonusMult.toFixed(2)} <span class="dc-bonus-tag">${buildBonusTag(activeBonus, energyBonus)}</span> = <b>${boosted.toFixed(2)}</b>`;
      if (hitCount > 1) formula += ` × ${hitCount} hits = <b>${currentDmg.toFixed(2)}</b>`;
    } else {
      currentDmg = hitCount > 1 ? baseDmgNum * hitCount : baseDmgNum;
      formula = hitCount > 1
        ? `${baseDmgNum} × ${hitCount} hits = <b>${currentDmg}</b>`
        : `Base damage: <b>${baseDmgNum}</b>`;
    }
    const { mult: sMult, label: sLabel } = getStatusMultiplier(m.moveType);
    if (sMult !== 1) formula += ` × ${sMult.toFixed(2)} <span class="dc-bonus-tag">[${sLabel}]</span> = <b>${(currentDmg * sMult).toFixed(2)}</b>`;
    detail.innerHTML = `<div class="dc-calc">${formula}</div>`;
    detail.style.display = "block"; rowEl.classList.add("dc-row-open"); return;
  }

  // Full formula: BaseDMG(1 + stat1/scl1 + stat2/scl2 ...)
  const statParts = scalings.map(({ stat, scaling, label }) => {
    const val = getTotalStat(stat);
    return { label, val, scaling, contrib: val / scaling };
  });
  const totalContrib = statParts.reduce((sum, p) => sum + p.contrib, 0);
  const dmgPerHit = baseDmgNum * (1 + totalContrib);
  const totalDmg  = dmgPerHit * hitCount;

  const activeBonus = getActiveDmgBonus();
  const energyBonus = getEnergyBonusPct(m);
  const totalBonus  = activeBonus + energyBonus;
  const bonusMult   = 1 + totalBonus / 100;
  const scalingStr  = statParts.map(p => `${p.label}(${p.val})/${p.scaling}`).join(" + ");
  let formula = `${baseDmgNum}(1 + ${scalingStr}) = <b>${dmgPerHit.toFixed(2)}</b>`;
  let currentDmg;
  if (totalBonus > 0) {
    const boosted = dmgPerHit * bonusMult;
    currentDmg = hitCount > 1 ? boosted * hitCount : boosted;
    formula += ` × ${bonusMult.toFixed(2)} <span class="dc-bonus-tag">${buildBonusTag(activeBonus, energyBonus)}</span> = <b>${boosted.toFixed(2)}</b>`;
    if (hitCount > 1) formula += ` × ${hitCount} hits = <b>${currentDmg.toFixed(2)}</b>`;
  } else if (hitCount > 1) {
    currentDmg = totalDmg;
    formula += ` × ${hitCount} hits = <b>${totalDmg.toFixed(2)}</b>`;
  } else {
    currentDmg = dmgPerHit;
  }
  const { mult: sMult, label: sLabel } = getStatusMultiplier(m.moveType);
  if (sMult !== 1) formula += ` × ${sMult.toFixed(2)} <span class="dc-bonus-tag">[${sLabel}]</span> = <b>${(currentDmg * sMult).toFixed(2)}</b>`;

  detail.innerHTML = `<div class="dc-calc">${formula}</div>`;
  detail.style.display = "block"; rowEl.classList.add("dc-row-open");
}

// --- Dmg Bonus passives ---
let dmgBonusPassives = [];
const dmgBonusActive = {};

function parseDmgBonus(text) {
  if (!text) return null;
  const patterns = [
    /(\d+(?:\.\d+)?)\s*%\s*damage\s+buff/i,
    /(\d+(?:\.\d+)?)\s*%\s*damage\s+bonus/i,
    /(\d+(?:\.\d+)?)\s*%\s*dmg\s+buff/i,
    /increases?\s+(?:(?:\w+)\s+)*?damage\s+by\s+(\d+(?:\.\d+)?)\s*%/i,
    /deal[s]?\s+(\d+(?:\.\d+)?)\s*%\s+more\s+damage/i,
    /(\d+(?:\.\d+)?)\s*%\s+more\s+damage/i,
    /(\d+(?:\.\d+)?)\s*%\s+(?:extra|additional)\s+damage/i,
    /grants?\s+(?:a\s+)?(\d+(?:\.\d+)?)\s*%\s+damage/i,
    /give[s]?\s+(?:a\s+)?(\d+(?:\.\d+)?)\s*%\s+damage/i,
    /(\d+(?:\.\d+)?)\s*%\s+damage\s+(?:increase|boost)/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      // find first numeric capture group
      for (let i = 1; i < m.length; i++) { if (m[i] !== undefined) return +m[i]; }
    }
  }
  return null;
}

function collectDmgBonusPassives() {
  const raceName     = racePicker.value;
  const baseClass    = classPicker.value;
  const superClass   = superPicker.value;
  const subClass     = subPicker.value;
  const markName     = markPicker.value;
  const artifactName = artifactPicker.value;
  const weaponMain   = document.getElementById("weapon-main").value;
  const weaponOff    = document.getElementById("weapon-offhand").value;
  const covenantName = covenantPicker.value;
  const gearSlots    = ["gear-1","gear-2","gear-3","gear-4"].map(id => document.getElementById(id)?.value || "").filter(Boolean);
  const lostScrollName = lostScrollPicker.value;
  const scroll1Name    = scroll1Picker.value;
  const scroll2Name    = scroll2Picker.value;

  const allData = [
    raceName       ? raceMoves[raceName]               : null,
    baseClass      ? classMoves[baseClass]             : null,
    superClass     ? classMoves[superClass]            : null,
    subClass       ? classMoves[subClass]              : null,
    markName       ? markMoves[markName]               : null,
    artifactName   ? artifactMoves[artifactName]       : null,
    weaponMain     ? weaponMoves[weaponMain]           : null,
    weaponOff      ? weaponMoves[weaponOff]            : null,
    covenantName   ? covenantMoves[covenantName]       : null,
    lostScrollName ? lostScrollMoves[lostScrollName]   : null,
    scroll1Name    ? scrollMoves[scroll1Name]          : null,
    scroll2Name    ? scrollMoves[scroll2Name]          : null,
    ...gearSlots.map(name => gearMoves[name] || null),
  ].filter(Boolean);

  const rawEntries = [];
  const seen = new Set();

  function tryAdd(name, text, kind) {
    const bonus = parseDmgBonus(text);
    const key = kind + ":" + name;
    if (bonus !== null && !seen.has(key)) {
      seen.add(key);
      rawEntries.push({ key, name, bonus, kind, desc: text });
    }
  }

  // Patterns that indicate a buff granted TO the user (not just attack damage)
  const buffGrantPatterns = [
    /grants?\s+(?:a\s+)?(?:you\s+)?(?:the\s+)?(?:user\s+)?\d+/i,
    /gives?\s+(?:a\s+)?\d+/i,
    /gain\s+(?:a\s+)?\d+/i,
    /you\s+gain\s+\d+/i,
    /\d+.*?damage\s+buff/i,
    /\d+.*?dmg\s+buff/i,
    /\d+.*?damage\s+bonus/i,
    /damage\s+buff.*?\d+/i,
  ];

  // Build/class/weapon/gear/mark passives & buff moves
  allData.forEach(d => {
    (d.innatePassives || []).forEach(p => tryAdd(p.name, p.description || p.effect || "", "passive"));
    (d.learns || []).forEach(m => {
      if (m.type === "Passive") tryAdd(m.name, m.effect || "", "passive");
      if (m.type === "Active") {
        const text = m.effect || "";
        // Buff-category moves always checked for dmg bonus (they ARE the buff)
        // Other active moves only if they explicitly grant a damage buff to the user
        if (m.category === "Buff" || buffGrantPatterns.some(pat => pat.test(text))) {
          tryAdd(m.name, text, "buff");
        }
      }
    });
  });

  // Active mastery move nodes (lm1/lm2/cm1/cm2/rm1/rm2 — type:"mastery" only)
  const classData = getActiveMasteryData();
  if (classData?.nodes) {
    masteryNodes
      .filter(n => n.type === "mastery" && masteryState[n.id])
      .forEach(n => {
        const override = classData.nodes[n.id] || {};
        const desc = override.desc || "";
        if (desc) {
          // If this mastery upgrades a specific buff/move, register under that name so it merges
          const name = override.upgrades || override.name || n.name;
          tryAdd(name, desc, "mastery");
        }
      });
  }

  // Ranked soul tree nodes
  Object.values(soulTreeData).flat().forEach(node => {
    const rank = soulTreeRanks[node.id] || 0;
    if (!rank) return;
    const val = +(rank * node.perRank).toFixed(node.decimals ?? 1);
    const desc = node.desc.replace("{v}", val);
    if (node.dmgBonus) {
      const key = "soultree:" + node.id;
      if (!seen.has(key)) {
        seen.add(key);
        rawEntries.push({ key, name: node.name, bonus: val, kind: "passive", desc });
      }
    } else {
      tryAdd(node.name, desc, "mastery");
    }
  });

  // --- Merge pass ---
  // Mastery entries that are "[X] Proficiency" get merged into the base "[X]" entry if it exists.
  // Any two entries sharing the same display-name get merged too.
  const merged = [];
  const nameIdx = new Map(); // displayName (lowercase) → index in merged

  rawEntries.forEach(e => {
    const baseName = (e.kind === "mastery" && e.name.endsWith(" Proficiency"))
      ? e.name.slice(0, -" Proficiency".length)
      : null;
    const lookupKey = (baseName ?? e.name).toLowerCase();
    const existingIdx = nameIdx.get(lookupKey);

    if (existingIdx !== undefined) {
      const ex = merged[existingIdx];
      if (!ex.kinds.includes(e.kind)) {
        if (e.kind === "mastery") {
          // Mastery upgrades the base entry — put it first so it's the "primary" version
          ex.kinds.unshift("mastery");
          ex.descs.unshift({ kind: "mastery", text: e.desc });
          ex.bonus = e.bonus; // mastery overrides base bonus
        } else {
          ex.kinds.push(e.kind);
          ex.descs.push({ kind: e.kind, text: e.desc });
          ex.bonus = Math.max(ex.bonus, e.bonus);
        }
      }
    } else {
      const displayName = baseName ?? e.name;
      const idx = merged.length;
      nameIdx.set(displayName.toLowerCase(), idx);
      merged.push({
        key:   e.key,
        name:  displayName,
        bonus: e.bonus,
        kinds: [e.kind],
        descs: [{ kind: e.kind, text: e.desc }],
      });
    }
  });

  return merged;
}

function getActiveDmgBonus() {
  let total = dmgBonusPassives.filter(p => dmgBonusActive[p.key]).reduce((sum, p) => {
    if (p.name === "Rage Empower") return sum + 30 + rageEmpHpConsumed;
    if (p.name === "Absolute Radiance") return sum + ABS_RAD_BONUSES[absRadTurn - 1];
    if (p.name === "Bulk Up") return sum + bulkUpStacks * 20;
    if (p.name === "Sands Of Time") return sum + hourglassStacks * 20;
    if (p.name === "Oppression") return sum + oppressionCount * 5;
    return sum + p.bonus;
  }, 0);
  if (statusEffectsActive.overheat) total += overheatStacks * 8;
  return total;
}

let _dmgBonusFilter = "";
let _dcTooltip = null;

function ensureDcTooltip() {
  if (!_dcTooltip) {
    _dcTooltip = document.createElement("div");
    _dcTooltip.className = "dc-bonus-tooltip";
    _dcTooltip.style.display = "none";
    document.body.appendChild(_dcTooltip);
  }
  return _dcTooltip;
}

const KIND_COLORS = { passive: "#9b7ae8", buff: "#4ade80", mastery: "#fbbf24" };

function showDcTooltip(rowEl, p) {
  const descs = p.descs || [{ kind: p.kind || "passive", text: p.desc || "" }];
  if (!descs.some(d => d.text)) return;
  const tip = ensureDcTooltip();
  tip.innerHTML = descs.map((d, i) => {
    const col = KIND_COLORS[d.kind] || "#ccc";
    const label = d.kind.charAt(0).toUpperCase() + d.kind.slice(1);
    return (i > 0 ? `<div class="dc-tip-divider"></div>` : "")
      + `<div class="dc-tip-section">
           <span class="dc-tip-kind" style="color:${col}">${label}</span>
           <span class="dc-tip-body">${d.text.replace(/\n/g, "<br>")}</span>
         </div>`;
  }).join("");

  const rect = rowEl.getBoundingClientRect();
  const tipW = 290;
  let left = rect.right + 10;
  if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 10;
  tip.style.left = Math.max(8, left) + "px";
  tip.style.top  = rect.top + "px";
  tip.style.display = "block";
}

function hideDcTooltip() {
  if (_dcTooltip) _dcTooltip.style.display = "none";
}

function changeEnergy(delta) {
  energyCount = Math.min(6, Math.max(0, energyCount + delta));
  renderDmgBonusSection();
}

function changeAbsRadTurn(delta) {
  absRadTurn = Math.min(5, Math.max(1, absRadTurn + delta));
  renderDmgBonusSection();
}

function changeBulkUpStacks(delta) {
  bulkUpStacks = Math.min(10, Math.max(1, bulkUpStacks + delta));
  renderDmgBonusSection();
}

function changeHourglassStacks(delta) {
  hourglassStacks = Math.min(5, Math.max(1, hourglassStacks + delta));
  renderDmgBonusSection();
}

function toggleStatusEffect(name) {
  statusEffectsActive[name] = !statusEffectsActive[name];
  renderDmgBonusSection();
}

function changeOverheatStacks(delta) {
  overheatStacks = Math.min(10, Math.max(1, overheatStacks + delta));
  renderDmgBonusSection();
}

function changeOppressionCount(delta) {
  oppressionCount = Math.min(5, Math.max(1, oppressionCount + delta));
  renderDmgBonusSection();
}

function getStatusMultiplier(moveType) {
  let mult = 1;
  const labels = [];
  if (statusEffectsActive.vulnerable) { mult *= 1.20; labels.push("Vuln ×1.20"); }
  if (statusEffectsActive.hexed)      { mult *= 2.00; labels.push("Hexed ×2"); }
  if (statusEffectsActive.fractured && (moveType === "Physical" || moveType === "Magic")) {
    mult *= 1.35; labels.push("Frac ×1.35");
  }
  return { mult, label: labels.join(", ") };
}

function setRageEmpHp(val) {
  rageEmpHpConsumed = +val;
  const valEl = document.getElementById("dc-rage-hp-val");
  const pctEl = document.querySelector(".dc-bonus-row[data-rage-emp] .dc-bonus-pct");
  if (valEl) valEl.textContent = val + "%";
  if (pctEl) pctEl.textContent = `+${30 + rageEmpHpConsumed}%`;
}

function renderDmgBonusSection() {
  const container = document.getElementById("dmg-bonus-section");
  if (!container) return;

  dmgBonusPassives = collectDmgBonusPassives();

  // Energy counter — always shown
  let html = `<div class="dc-energy-section">
    <span class="dc-energy-label">Energy</span>
    <div class="dc-energy-counter">
      <button class="dc-energy-btn" onclick="changeEnergy(-1)">−</button>
      <span class="dc-energy-val" id="dc-energy-val">${energyCount}</span>
      <button class="dc-energy-btn" onclick="changeEnergy(1)">+</button>
    </div>
  </div>`;

  if (dmgBonusPassives.length) {
  // Init toggle state for any new passives
  dmgBonusPassives.forEach(p => { if (!(p.key in dmgBonusActive)) dmgBonusActive[p.key] = false; });

  html += `<h3 class="dc-bonus-title">Dmg Bonus</h3>
    <input type="text" id="dmg-bonus-search" class="dc-bonus-search" placeholder="Search..." value="${_dmgBonusFilter.replace(/"/g, "&quot;")}">
    <div class="dc-bonus-list">`;

  function kindBadge(k) {
    if (k === "buff")    return `<span class="dc-bonus-kind dc-bonus-kind-buff">Buff</span>`;
    if (k === "mastery") return `<span class="dc-bonus-kind dc-bonus-kind-mastery">Mastery</span>`;
    return `<span class="dc-bonus-kind dc-bonus-kind-passive">Passive</span>`;
  }

  dmgBonusPassives.forEach((p, fullIdx) => {
    if (_dmgBonusFilter && !p.name.toLowerCase().includes(_dmgBonusFilter)) return;
    const on = dmgBonusActive[p.key];
    const badges = (p.kinds || [p.kind]).map(kindBadge).join("");
    const isRageEmp      = p.name === "Rage Empower";
    const isAbsRad       = p.name === "Absolute Radiance";
    const isBulkUp       = p.name === "Bulk Up";
    const isHourglass    = p.name === "Sands Of Time";
    const isOppression   = p.name === "Oppression";
    const displayBonus   = isRageEmp     ? 30 + rageEmpHpConsumed
                         : isAbsRad      ? ABS_RAD_BONUSES[absRadTurn - 1]
                         : isBulkUp      ? bulkUpStacks * 20
                         : isHourglass   ? hourglassStacks * 20
                         : isOppression  ? oppressionCount * 5
                         : p.bonus;
    html += `<div class="dc-bonus-row${on ? " dc-bonus-on" : ""}" data-bidx="${fullIdx}"${isRageEmp ? ' data-rage-emp' : ''}>
      <div class="dc-bonus-check">${on ? "✓" : ""}</div>
      <span class="dc-bonus-name">${p.name}</span>
      <span class="dc-bonus-badges">${badges}</span>
      <span class="dc-bonus-pct">+${displayBonus}%</span>
    </div>`;
    if (isRageEmp) {
      html += `<div class="dc-rage-slider-row">
        <span class="dc-rage-slider-label">HP Consumed: <span id="dc-rage-hp-val">${rageEmpHpConsumed}%</span></span>
        <input type="range" class="dc-rage-slider" min="0" max="65" value="${rageEmpHpConsumed}" oninput="setRageEmpHp(this.value)">
        <span class="dc-rage-slider-hint">0% → 65% dmg</span>
      </div>`;
    }
    if (isAbsRad) {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Turn</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeAbsRadTurn(-1)">−</button>
          <span class="dc-energy-val">${absRadTurn}</span>
          <button class="dc-energy-btn" onclick="changeAbsRadTurn(1)">+</button>
        </div>
      </div>`;
    }
    if (isBulkUp) {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Stacks</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeBulkUpStacks(-1)">−</button>
          <span class="dc-energy-val">${bulkUpStacks}</span>
          <button class="dc-energy-btn" onclick="changeBulkUpStacks(1)">+</button>
        </div>
      </div>`;
    }
    if (isHourglass) {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Stacks</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeHourglassStacks(-1)">−</button>
          <span class="dc-energy-val">${hourglassStacks}</span>
          <button class="dc-energy-btn" onclick="changeHourglassStacks(1)">+</button>
        </div>
      </div>`;
    }
    if (isOppression) {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Effects</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeOppressionCount(-1)">−</button>
          <span class="dc-energy-val">${oppressionCount}</span>
          <button class="dc-energy-btn" onclick="changeOppressionCount(1)">+</button>
        </div>
      </div>`;
    }
  });

  html += `</div>`;
  } // end if (dmgBonusPassives.length)

  // --- Status Effects (always shown) ---
  const hasYarthul = ["gear-1","gear-2","gear-3","gear-4"].some(id => document.getElementById(id)?.value === "Yar'thul's Wrath");
  if (!hasYarthul && statusEffectsActive.overheat) { statusEffectsActive.overheat = false; }
  const statusDefs = [
    { key: "vulnerable", label: "Vulnerable",  tag: "×1.20",            desc: "Afflicted unit takes 20% more damage." },
    { key: "hexed",      label: "Hexed",        tag: "×2.00",            desc: "Incoming attack(s) deal double damage, removing one stack per hit." },
    { key: "sundered",   label: "Sundered",     tag: "ignores resist",   desc: "Afflicted unit's incoming attacks ignore resistances." },
    { key: "fractured",  label: "Fractured",    tag: "×1.35 Phys/Magic", desc: "Afflicted unit takes 35%+ Physical/Magic damage." },
    ...(hasYarthul ? [{ key: "overheat", label: "Overheat", tag: `+${overheatStacks * 8}%`, desc: "Increases damage by 8% and speed by 7.5% per stack. Capped at 10 stacks." }] : []),
  ];
  html += `<h3 class="dc-bonus-title" style="margin-top:12px">Status Effects</h3><div class="dc-bonus-list">`;
  statusDefs.forEach(s => {
    const on = statusEffectsActive[s.key];
    html += `<div class="dc-bonus-row${on ? " dc-bonus-on" : ""}" data-skey="${s.key}" title="${s.desc}">
      <div class="dc-bonus-check">${on ? "✓" : ""}</div>
      <span class="dc-bonus-name">${s.label}</span>
      <span class="dc-bonus-pct">${s.tag}</span>
    </div>`;
    if (s.key === "overheat") {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Stacks</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeOverheatStacks(-1)">−</button>
          <span class="dc-energy-val">${overheatStacks}</span>
          <button class="dc-energy-btn" onclick="changeOverheatStacks(1)">+</button>
        </div>
      </div>`;
    }
  });
  html += `</div>`;

  container.innerHTML = html;

  document.getElementById("dmg-bonus-search")?.addEventListener("input", e => {
    _dmgBonusFilter = e.target.value.toLowerCase();
    renderDmgBonusSection();
  });

  container.querySelectorAll(".dc-bonus-row").forEach(row => {
    if (row.dataset.skey) {
      row.addEventListener("click", () => toggleStatusEffect(row.dataset.skey));
      return;
    }
    const p = dmgBonusPassives[+row.dataset.bidx];
    if (!p) return;
    row.addEventListener("click", () => {
      dmgBonusActive[p.key] = !dmgBonusActive[p.key];
      renderDmgBonusSection();
    });
    row.addEventListener("mouseenter", () => showDcTooltip(row, p));
    row.addEventListener("mouseleave", hideDcTooltip);
  });
}

// --- Dmg Calc move list ---
const MOVE_TYPE_COLORS = {
  "Physical": "#f4a460",
  "Magic":    "#9b7ae8",
  "Holy":     "#ffd700",
  "Dark":     "#c084fc",
  "Fire":     "#ff6b35",
  "Ice":      "#7dd3fc",
  "Nature":   "#4ade80",
  "Poison":   "#a3e635",
  "Hex":      "#f472b6",
  "N/A":      "#888888",
};

function renderDmgCalc() {
  const container = document.getElementById("dmg-calc-moves");
  if (!container) return;

  const raceName     = racePicker.value;
  const baseClass    = classPicker.value;
  const superClass   = superPicker.value;
  const subClass     = subPicker.value;
  const markName     = markPicker.value;
  const artifactName = artifactPicker.value;
  const weaponMain   = document.getElementById("weapon-main").value;
  const weaponOff    = document.getElementById("weapon-offhand").value;
  const covenantName = covenantPicker.value;
  const gearSlots    = ["gear-1","gear-2","gear-3","gear-4"].map(id => document.getElementById(id)?.value || "").filter(Boolean);

  const raceData       = raceName     ? raceMoves[raceName]          : null;
  const baseData       = baseClass    ? classMoves[baseClass]        : null;
  const superData      = superClass   ? classMoves[superClass]       : null;
  const subData        = subClass     ? classMoves[subClass]         : null;
  const markData       = markName     ? markMoves[markName]          : null;
  const artifactData   = artifactName ? artifactMoves[artifactName]  : null;
  const weaponMainData = weaponMain   ? weaponMoves[weaponMain]      : null;
  const weaponOffData  = weaponOff    ? weaponMoves[weaponOff]       : null;
  const covenantData   = covenantName ? covenantMoves[covenantName]  : null;
  const lostScrollName = lostScrollPicker.value;
  const lostScrollData = lostScrollName ? lostScrollMoves[lostScrollName] : null;
  const scroll1Name    = scroll1Picker.value;
  const scroll1Data    = scroll1Name ? scrollMoves[scroll1Name] : null;
  const scroll2Name    = scroll2Picker.value;
  const scroll2Data    = scroll2Name ? scrollMoves[scroll2Name] : null;
  const gearDataList   = gearSlots.map(name => ({ name, data: gearMoves[name] || null })).filter(g => g.data);

  const allData = [raceData, baseData, superData, subData, markData, artifactData, weaponMainData, weaponOffData, covenantData, lostScrollData, scroll1Data, scroll2Data, ...gearDataList.map(g => g.data)].filter(Boolean);
  const allMoves = allData.flatMap(d => (d.learns || []).filter(m =>
    m.type === "Active" &&
    m.category !== "Buff" &&
    m.damage !== undefined &&
    /^\d/.test(String(m.damage)) &&
    !isSummonMove(m)
  ));

  if (!allMoves.length) {
    container.innerHTML = `<p class="moves-placeholder">Make a selection to view moves.</p>`;
    renderDmgBonusSection();
    return;
  }

  dmgCalcMoveList = allMoves;
  let html = `<div class="dmg-calc-move-list">`;
  allMoves.forEach((m, i) => {
    const color = MOVE_TYPE_COLORS[m.moveType] || "#cccccc";
    const canCalc = m.damage !== undefined && /^\d/.test(String(m.damage));
    const dmgStr  = m.damage   !== undefined ? `<span class="dc-stat">Dmg: <b>${m.damage}</b></span>` : "";
    const sclStr  = m.scaling  ? `<span class="dc-stat">Scl: ${m.scaling}</span>` : "";
    const costStr = m.cost     !== undefined ? `<span class="dc-stat">Cost: ${m.cost}</span>` : "";
    const cdStr   = m.cooldown !== undefined ? `<span class="dc-stat">CD: ${m.cooldown}</span>` : "";
    const eneStr  = m.energyScaling ? `<span class="dc-stat dc-energy-badge">+${m.energyScaling.perEnergy}%/E (past ${m.energyScaling.past})</span>` : "";
    html += `<div class="dc-row${canCalc ? " dc-row-clickable" : ""}" style="border-left:3px solid ${color}" ${canCalc ? `onclick="toggleDmgDetail(this,${i})"` : ""}>
      <span class="dc-name" style="color:${color}">${m.name}</span>
      <span class="dc-type" style="color:${color}">[${m.moveType || "—"}]</span>
      <span class="dc-stats">${dmgStr}${sclStr}${costStr}${cdStr}${eneStr}</span>
      ${canCalc ? `<span class="dc-hint">click to calculate</span>` : ""}
    </div>
    <div class="dc-detail" style="display:none"></div>`;
  });
  html += `</div>`;
  container.innerHTML = html;
  renderDmgBonusSection();
}

racePicker.addEventListener("change", renderMoves);
classPicker.addEventListener("change", renderMoves);
classPicker.addEventListener("change", () => { resetMastery(); renderMastery(); renderMasteryInfoSection(); });
superPicker.addEventListener("change", () => {
  const selected = superPicker.value;
  updateGold(prevSuperSelection, selected);
  prevSuperSelection = selected;
  resetSubPicker();
  renderMoves();
  resetMastery(); renderMastery(); renderMasteryInfoSection();
});

subPicker.addEventListener("change", () => {
  const selected = subPicker.value;
  updateGold(prevSubSelection, selected);
  prevSubSelection = selected;
  renderMoves();
});

// --- Soul Tree ---
const ROMAN = ["—", "I", "II", "III", "IV", "V"];

const soulTreeData = {
  "Path of Destruction": [
    { id: "denature",      name: "Denature",                 desc: "DoT Damage +{v}%",                                               perRank: 2,   maxRank: 5, costs: [25,50,75,100,125],                              dmgBonus: true },
    { id: "crit_point",   name: "Critical Point",            desc: "Base crit damage +{v}%",                                         perRank: 5,   maxRank: 5, costs: [50,100,150,200,250],  bonus: {"crit-dmg": 0.05} },
    { id: "strike_first", name: "Strike First, No Mercy",    desc: "First attack +{v}% damage (expires after 2 turns)",              perRank: 5,   maxRank: 5, costs: [100,200,300,400,500],                                       dmgBonus: true },
    { id: "lil_crit",     name: "Lil Bit of Crit",           desc: "Base crit chance +{v}%",                                         perRank: 1,   maxRank: 5, costs: [50,100,150,200,250],  bonus: {"crit-chance": 1} },
    { id: "com_focus",    name: "Combat Focus",               desc: "After meditating, +{v}% damage for 2 turns",                    perRank: 2,   maxRank: 5, costs: [50,100,150,200,250],                                       dmgBonus: true }
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
      const val  = +(rank * node.perRank).toFixed(node.decimals ?? 1);
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
  renderDmgBonusSection();
}

renderSoulTree();

// === MASTERY TREE ===

const MASTERY_TOTAL_POINTS = 35;

// Class-specific mastery node names/descriptions, keyed by base class name.
const masteryClassData = {
  "Warrior": {
    branches: { red: "Speed", green: "Strength", blue: "Endurance" },
    branchStats: { shared: "lck", red: "spd", green: "str", blue: "end" },
    nodes: {
      s1:  { name: "Luck Node" }, s2:  { name: "Luck Node" },
      s3:  { name: "Luck Node" }, s4:  { name: "Luck Node" },
      l1:  { name: "Speed Node" }, l2:  { name: "Speed Node" },
      l3:  { name: "Speed Node" }, l4:  { name: "Speed Node" },
      l5:  { name: "Speed Node" }, l6:  { name: "Speed Node" },
      l7:  { name: "Speed Node" }, l8:  { name: "Speed Node" },
      l9:  { name: "Speed Node" },
      lm1: { name: "Holy Shield",               desc: "Guarding for someone will now grant an additional 15% TDR.\nTDR = True Damage Resistance (defense)." },
      lm2: { name: "Holy Crash Proficiency",    desc: "Taunt is now guaranteed on all targets hit — both main and adjacent.\nAdditionally raise base DMG to 15 and adjacent DMG to 10." },
      c1:  { name: "Strength Node" }, c2a: { name: "Strength Node" },
      c2b: { name: "Strength Node" }, c3a: { name: "Strength Node" },
      c4:  { name: "Strength Node" }, c5a: { name: "Strength Node" },
      c5b: { name: "Strength Node" },
      cm1: { name: "High Endurance",            desc: "Removes the dodge window penalty when you have a shield equipped.\nNote: Still has old effect — while below 30% HP, gain 30% DR (bypasses DR ignorance)." },
      cm2: { name: "Pure Resonation Proficiency", desc: "Now grants Shield HP equal to 5% of your max HP for Pure Resonation's duration.\nShield HP also scales on Endurance at a rate of END/200." },
      r1:  { name: "Endurance Node" }, r2:  { name: "Endurance Node" },
      r3:  { name: "Endurance Node" }, r4:  { name: "Endurance Node" },
      r5:  { name: "Endurance Node" }, r6:  { name: "Endurance Node" },
      r7:  { name: "Endurance Node" }, r8:  { name: "Endurance Node" },
      r9:  { name: "Endurance Node" },
      rm1: { name: "Runic Shield",              desc: "Blocking or dodging attacks will raise your ATKP +.25 for (3T). This cannot stack.\nNote: +.25 ATKP = 25% dmg buff. Buff lasts 1 turn, only affects holy type moves." },
      rm2: { name: "Sacred Call Proficiency",   desc: "Grants the target of Sacred Call 5 Energized.\nNote: Buff lasts 4 turns." },
    }
  },
  "Blade Dancer (N)": {
    branches: { red: "Strength", green: "Endurance", blue: "Speed" },
    branchStats: { shared: "lck", red: "str", green: "end", blue: "spd" },
    branchMultipliers: { red: 1.15 },
    nodes: {
      s1:  { name: "Luck Node" }, s2:  { name: "Luck Node" },
      s3:  { name: "Luck Node" }, s4:  { name: "Luck Node" },
      l1:  { name: "Strength Node" }, l2:  { name: "Strength Node" },
      l3:  { name: "Strength Node" }, l4:  { name: "Strength Node" },
      l5:  { name: "Strength Node" }, l6:  { name: "Strength Node" },
      l7:  { name: "Strength Node" }, l8:  { name: "Strength Node" },
      l9:  { name: "Strength Node" },
      lm1: { name: "Unending Flow",              desc: "Deal increasing damage for every consecutive hit you deal; if you don't deal damage for a turn then it resets.\nGain a 5% damage buff before attacking per attack you use. This caps at 50% after 10 turns.\nCan occasionally randomly reset (bugged)." },
      lm2: { name: "Impaling Strike Proficiency", desc: "Bleeds for longer, now applies 2 vulnerable as well.\nNow applies 3 bleeding and 2 vulnerable. The vulnerable is applied before you deal damage, meaning you receive the vulnerable bonus if the enemy doesn't have the status." },
      c1:  { name: "Endurance Node" }, c2a: { name: "Endurance Node" },
      c2b: { name: "Endurance Node" }, c3a: { name: "Endurance Node" },
      c4:  { name: "Endurance Node" }, c5a: { name: "Endurance Node" },
      c5b: { name: "Endurance Node" },
      cm1: { name: "Deep Focus",                 desc: "Increased proc chance for enchantments passively.\nThis increases their chance by approximately 25%." },
      cm2: { name: "Simple Domain Proficiency",  desc: "Now allows Simple Domain to parry ranged attacks, excluding ultimate moves (e.g. Obliteration, Styx, Justice, Oblivion, etc.). No changes to scaling.\nThis lets you counter Justice or Styx regardless of the description." },
      r1:  { name: "Speed Node" }, r2:  { name: "Speed Node" },
      r3:  { name: "Speed Node" }, r4:  { name: "Speed Node" },
      r5:  { name: "Speed Node" }, r6:  { name: "Speed Node" },
      r7:  { name: "Speed Node" }, r8:  { name: "Speed Node" },
      r9:  { name: "Speed Node" },
      rm1: { name: "Parry Master",               desc: "Increases parry chance to 100%. Damage on parry slightly reduced.\nBase damage appears to be reduced by around 1 base damage. (Need more testing)" },
      rm2: { name: "Flowing Dance Proficiency",  desc: "Increased speed scaling, now deals bonus damage and turns a tinge of red against bleeding targets.\nChanges scaling to SPD/50. The bleeding buff does not work." },
    }
  },
  "Berserker (Ch)": {
    branches: { red: "Speed", green: "Strength", blue: "Endurance" },
    branchStats: { shared: "lck", red: "spd", green: "str", blue: "end" },
    branchMultipliers: { green: 1.15 },
    nodes: {
      s1:  { name: "Luck Node" }, s2:  { name: "Luck Node" },
      s3:  { name: "Luck Node" }, s4:  { name: "Luck Node" },
      l1:  { name: "Speed Node" }, l2:  { name: "Speed Node" },
      l3:  { name: "Speed Node" }, l4:  { name: "Speed Node" },
      l5:  { name: "Speed Node" }, l6:  { name: "Speed Node" },
      l7:  { name: "Speed Node" }, l8:  { name: "Speed Node" },
      l9:  { name: "Speed Node" },
      lm1: { name: "The Big Sword",             desc: "Increased strike damage from 20% to 40% and get lifesteal on strikes.\nThe lifesteal is 7.5%. You are required to have a greatsword to get the damage buff, the lifesteal is always active on strikes." },
      lm2: { name: "Carnage Proficiency",        desc: "Now applies 2 weakened at the end, deals 20% more damage if the target is weakened and gives a 15% dmg buff for 2 turns if you are below 40%.\nThis applies 2 weakened on the first hit, if the opponent is weakened you gain no extra damage.\nIf you are under 40% you will gain a 15% damage buff before carnage deals damage, however this only lasts 1 turn after carnage is used." },
      c1:  { name: "Strength Node" }, c2a: { name: "Strength Node" },
      c2b: { name: "Strength Node" }, c3a: { name: "Strength Node" },
      c4:  { name: "Strength Node" }, c5a: { name: "Strength Node" },
      c5b: { name: "Strength Node" },
      cm1: { name: "Berserkin Time",             desc: "Increased bloodlust's dmg increase per stack from 10% to 15% and makes it give a damage resistance and regen buff per stack.\nEvery stack of bloodlust now grants 5% DR, this stacks additively up to 16 times totaling 80% DR.\nYou additionally get +1 regen per bloodlust stack, capping at +10 passive regen at 10 stacks.\nYour bloodlust damage now diminishes after 5+ stacks and remains this way indefinitely for the fight. This heal can be affected by outgoing healing and Blessing of Life from Way of Life." },
      cm2: { name: "Head Splitter Proficiency",  desc: "Now deals adjacent damage and deals 30% extra damage to low health targets. Adjacent enemies now take damage. Grants 1 Bloodlust stack on use.\nThis attack becomes fully AoE, dealing full damage to all other enemies and applying 2 vulnerable to all enemies.\nOther enemies hit can be crit or have factors such as inferno triggered on them.\nThis grants you a permanent Bloodlust stack." },
      r1:  { name: "Endurance Node" }, r2:  { name: "Endurance Node" },
      r3:  { name: "Endurance Node" }, r4:  { name: "Endurance Node" },
      r5:  { name: "Endurance Node" }, r6:  { name: "Endurance Node" },
      r7:  { name: "Endurance Node" }, r8:  { name: "Endurance Node" },
      r9:  { name: "Endurance Node" },
      rm1: { name: "Intense Rage",               desc: "Increased the damage buff at low hp from 40% to 60% and now it also gives an energy gain buff.\nThe low HP buff comes from reaching 30% hp. The energy gain buff is granted when you attack while below 30% but is lost if you attack while above 30% hp." },
      rm2: { name: "Rage Empower Proficiency",   desc: "Buffed dmg buff lasts 1 turn longer. Now gives an energy buff as well.\nThe ingame description is outdated — this move now grants an extra 10% damage multiplicative with the base rage empower buff and Death Defy. The Death Defy effect can only activate once per fight.\nIMPORTANT: Currently this move makes the health consumption damage buff worse than base Rage Empower (~10% instead of the intended 65%).\nDeath Defy: If you ever take fatal damage, instead survive at low hp. This lasts until Rage Empower ends — if triggered on turn 1, it can still trigger on turn 2. After used, future casts of Rage Empower will not grant Death Defy for the duration of the fight." },
    }
  },
  "Elementalist (Or)": {
    branches: { red: "Speed", green: "Arcane", blue: "Endurance" },
    branchStats: { shared: "lck", red: "spd", green: "arc", blue: "end" },
    nodes: {
      s1:  { name: "Luck Node" }, s2:  { name: "Luck Node" },
      s3:  { name: "Luck Node" }, s4:  { name: "Luck Node" },
      l1:  { name: "Speed Node" }, l2:  { name: "Speed Node" },
      l3:  { name: "Speed Node" }, l4:  { name: "Speed Node" },
      l5:  { name: "Speed Node" }, l6:  { name: "Speed Node" },
      l7:  { name: "Speed Node" }, l8:  { name: "Speed Node" },
      l9:  { name: "Speed Node" },
      lm1: { name: "Energy Manipulator",         desc: "Add +.0375 / 3.75% to your ATKP per energy you have, up to .225 / 22.5% ATKP at 6 energy.\nThis buff is based on your current energy, not the energy you had before casting a move." },
      lm2: { name: "Blaze Proficiency",           desc: "Guarantees Burning (6T), additionally applying Vulnerable (3T) and also doubles the ATKP bonus if you attack a burning enemy.\nThis move now always deals 15% extra damage. It gains an additional 15% damage buff against burning opponents, totaling 30%.\nYour move becomes fully AoE, hitting all opponents, and has a new animation with blue fires." },
      c1:  { name: "Arcane Node" }, c2a: { name: "Arcane Node" },
      c2b: { name: "Arcane Node" }, c3a: { name: "Arcane Node" },
      c4:  { name: "Arcane Node" }, c5a: { name: "Arcane Node" },
      c5b: { name: "Arcane Node" },
      cm1: { name: "Elemental Defense",           desc: "When hit by an Arcane, Nature or Fire attack, you have a 50% chance to gain +1 NRG. This can only happen once per attack.\nActually triggers on Holy, Fire, Magic or Nature type attacks. This can happen more than once per attack." },
      cm2: { name: "Lightning Crash Proficiency", desc: "Your lightning turns purple, guaranteed stuns and becomes more violent and damaging if the target is burning.\nGrants a 20% damage increase against burning opponents." },
      r1:  { name: "Endurance Node" }, r2:  { name: "Endurance Node" },
      r3:  { name: "Endurance Node" }, r4:  { name: "Endurance Node" },
      r5:  { name: "Endurance Node" }, r6:  { name: "Endurance Node" },
      r7:  { name: "Endurance Node" }, r8:  { name: "Endurance Node" },
      r9:  { name: "Endurance Node" },
      rm1: { name: "Element Mastery",             desc: "When you use an Arcane, Nature or Fire attack, raise your ATKP by .15 before attacking.\nActually grants a 15% damage buff to all magic, fire, nature, holy, dark and ice type attacks." },
      rm2: { name: "Gale Uplift Proficiency",     desc: "Dodging an attack while Gale Uplift is active grants you 1 NRG. You can only gain 2 NRG max from dodging per round.\nThis only grants energy on the autododge." },
    }
  },
  "Hexer (N)": {
    branches: { red: "Speed", green: "Arcane", blue: "Luck" },
    branchStats: { shared: "end", red: "spd", green: "arc", blue: "lck" },
    nodes: {
      s1:  { name: "Endurance Node" }, s2:  { name: "Endurance Node" },
      s3:  { name: "Endurance Node" }, s4:  { name: "Endurance Node" },
      l1:  { name: "Speed Node" }, l2:  { name: "Speed Node" },
      l3:  { name: "Speed Node" }, l4:  { name: "Speed Node" },
      l5:  { name: "Speed Node" }, l6:  { name: "Speed Node" },
      l7:  { name: "Speed Node" }, l8:  { name: "Speed Node" },
      l9:  { name: "Speed Node" },
      lm1: { name: "Strategist",                  desc: "Gain 5% DR per negative effect status applied to you at all times.\nThe defense buff is per unique status effect and can stack." },
      lm2: { name: "Abyss Anchor Proficiency",    desc: "Abyss Anchor is now AoE.\nApplies 5 vulnerable and 4 weakened on cast onto the target." },
      c1:  { name: "Arcane Node" }, c2a: { name: "Arcane Node" },
      c2b: { name: "Arcane Node" }, c3a: { name: "Arcane Node" },
      c4:  { name: "Arcane Node" }, c5a: { name: "Arcane Node" },
      c5b: { name: "Arcane Node" },
      cm1: { name: "Status Master",               desc: "Grants you 10X% chance to gain energy on the start of your turn, X is equal to how many statuses you have on yourself currently." },
      cm2: { name: "Dark Glare Proficiency",      desc: "Decreases Dark Glare energy cost by 1." },
      r1:  { name: "Luck Node" }, r2:  { name: "Luck Node" },
      r3:  { name: "Luck Node" }, r4:  { name: "Luck Node" },
      r5:  { name: "Luck Node" }, r6:  { name: "Luck Node" },
      r7:  { name: "Luck Node" }, r8:  { name: "Luck Node" },
      r9:  { name: "Luck Node" },
      rm1: { name: "Delayed Hex",                 desc: "When an ally/summon dies, the attacker that did it gets 2 hexed.\nThe effects won't apply to other teammates' summons, only applies hex to the person who kills the summon." },
      rm2: { name: "Inverse Abyss Proficiency",   desc: "When proc'd the caster gains +1 energy and the enemy team is given bonus debuffs.\nApplies 3 statuses with 3 stacks on proc onto whoever attempts to debuff the player, can apply any player-based status excluding hex, stun and heavy stun. It won't bypass boss immunities to statuses." },
    }
  },
  "Necromancer (Ch)": {
    branches: { red: "Speed", green: "Arcane", blue: "Speed" },
    branchStats: { shared: "lck", red: "spd", green: "arc", blue: "spd" },
    nodes: {
      s1:  { name: "Luck Node" }, s2:  { name: "Luck Node" },
      s3:  { name: "Luck Node" }, s4:  { name: "Luck Node" },
      l1:  { name: "Speed Node" }, l2:  { name: "Speed Node" },
      l3:  { name: "Speed Node" }, l4:  { name: "Speed Node" },
      l5:  { name: "Speed Node" }, l6:  { name: "Speed Node" },
      l7:  { name: "Speed Node" }, l8:  { name: "Speed Node" },
      l9:  { name: "Speed Node" },
      lm1: { name: "Death Edge",                  desc: "-1 CD on Darklight Drain when anything on field dies (allies, summons, enemies)." },
      lm2: { name: "Call Skeleton Proficiency",   desc: "Cost reduced to 0 energy. When your skeleton dies, the energy left over gives your next skeleton 30% more damage, 50% more HP, 2% HP regen, 20% DR, and turns it black.\nThis effect does not apply to an already-buffed skeleton." },
      c1:  { name: "Arcane Node" }, c2a: { name: "Arcane Node" },
      c2b: { name: "Arcane Node" }, c3a: { name: "Arcane Node" },
      c4:  { name: "Arcane Node" }, c5a: { name: "Arcane Node" },
      c5b: { name: "Arcane Node" },
      cm1: { name: "Life Absorption",             desc: "Gain 2.5% regen per summon slot filled by you.\n10% total for 4 summons." },
      cm2: { name: "Darklight Drain Proficiency", desc: "Now gives all summons a 15% damage and damage reduction buff for 4 turns. Adds a 20% passive regen buff to everyone for 3 turns." },
      r1:  { name: "Speed Node" }, r2:  { name: "Speed Node" },
      r3:  { name: "Speed Node" }, r4:  { name: "Speed Node" },
      r5:  { name: "Speed Node" }, r6:  { name: "Speed Node" },
      r7:  { name: "Speed Node" }, r8:  { name: "Speed Node" },
      r9:  { name: "Speed Node" },
      rm1: { name: "Final Goodbye",               desc: "When a summon dies, remnants of its power remain in your hands, granting a stack of Arcane buff (up to 15% max, at 5% per summon death)." },
      rm2: { name: "Raise Death Proficiency",     desc: "Revived ally HP increased from 60% to 80%. Revived ally cannot die until their next turn begins (but their turn is skipped upon revival). Cooldown reduced from 16 turns to 11 turns." },
    }
  },
  "Ranger (Or)": {
    branches: { red: "Arcane", green: "Speed", blue: "Luck" },
    branchStats: { shared: "end", red: "arc", green: "spd", blue: "lck" },
    branchMultipliers: { red: 1.15 },
    nodes: {
      s1:  { name: "Endurance Node" }, s2:  { name: "Endurance Node" },
      s3:  { name: "Endurance Node" }, s4:  { name: "Endurance Node" },
      l1:  { name: "Arcane Node" }, l2:  { name: "Arcane Node" },
      l3:  { name: "Arcane Node" }, l4:  { name: "Arcane Node" },
      l5:  { name: "Arcane Node" }, l6:  { name: "Arcane Node" },
      l7:  { name: "Arcane Node" }, l8:  { name: "Arcane Node" },
      l9:  { name: "Arcane Node" },
      lm1: { name: "Nature's Wrath",              desc: "Verdant Archer's damage buff is increased.\nDoubles the damage buffs from Verdant Archer from 7.5% to 15%." },
      lm2: { name: "Flourish Proficiency",        desc: "Increase aggro buff to 100% and increases speed buff.\nAggro buff is currently bugged. Speed is increased by a flat 48 while using Flourish instead of the previous 25." },
      c1:  { name: "Speed Node" }, c2a: { name: "Speed Node" },
      c2b: { name: "Speed Node" }, c3a: { name: "Speed Node" },
      c4:  { name: "Speed Node" }, c5a: { name: "Speed Node" },
      c5b: { name: "Speed Node" },
      cm1: { name: "Lightspeed",                  desc: "Dodging / Scoring a critical hit for Verdant Archer now grants a stacking 10% autododge chance.\nThere is no stack limit, meaning you can achieve 100%+ autododge chance." },
      cm2: { name: "Stinger Proficiency",         desc: "Initial stab now applies Sundered.\nThe vulnerable/poison is replaced with sundered. The sunder is applied on the opening stab of the attack." },
      r1:  { name: "Luck Node" }, r2:  { name: "Luck Node" },
      r3:  { name: "Luck Node" }, r4:  { name: "Luck Node" },
      r5:  { name: "Luck Node" }, r6:  { name: "Luck Node" },
      r7:  { name: "Luck Node" }, r8:  { name: "Luck Node" },
      r9:  { name: "Luck Node" },
      rm1: { name: "Enrichment Proficiency",      desc: "Now additionally heals the target with the heal scaling on ARC and SPD.\nInitial heal only scales off ARC; target will now heal an extra 15% of their total HP per turn." },
      rm2: { name: "Perennial Canopy Proficiency", desc: "Increases its duration to 6 turns." },
    }
  },
  "Rogue (N)": {
    branches: { red: "Strength", green: "Speed", blue: "Endurance" },
    branchStats: { shared: "end", red: "str", green: "spd", blue: "end" },
    nodes: {
      s1:  { name: "Endurance Node" }, s2:  { name: "Endurance Node" },
      s3:  { name: "Endurance Node" }, s4:  { name: "Endurance Node" },
      l1:  { name: "Strength Node" }, l2:  { name: "Strength Node" },
      l3:  { name: "Strength Node" }, l4:  { name: "Strength Node" },
      l5:  { name: "Strength Node" }, l6:  { name: "Strength Node" },
      l7:  { name: "Strength Node" }, l8:  { name: "Strength Node" },
      l9:  { name: "Strength Node" },
      lm1: { name: "Trapper",                     desc: "You can now place poison traps on allies. Poison trap now inflicts half the poison to the entire enemy team, normal amount to the person it proc'd on." },
      lm2: { name: "Poison Trap Proficiency",     desc: "The final proc of poison trap now creates a more violent burst of poison, dealing more damage and applying 2 weakened and 2 vulnerable." },
      c1:  { name: "Speed Node" }, c2a: { name: "Speed Node" },
      c2b: { name: "Speed Node" }, c3a: { name: "Speed Node" },
      c4:  { name: "Speed Node" }, c5a: { name: "Speed Node" },
      c5b: { name: "Speed Node" },
      cm1: { name: "Vital Strike",                desc: "Attacks against bleeding enemies deal 20% more damage." },
      cm2: { name: "Dagger Spread Proficiency",   desc: "Your daggers are now poison tipped and inflict 2 poisoned. Enemies killed by Dagger Spread create a burst of poison, dealing small damage to the entire enemy team." },
      r1:  { name: "Endurance Node" }, r2:  { name: "Endurance Node" },
      r3:  { name: "Endurance Node" }, r4:  { name: "Endurance Node" },
      r5:  { name: "Endurance Node" }, r6:  { name: "Endurance Node" },
      r7:  { name: "Endurance Node" }, r8:  { name: "Endurance Node" },
      r9:  { name: "Endurance Node" },
      rm1: { name: "Looter",                      desc: "Killing an enemy now gives you stacking luck and speed buffs for the rest of the battle." },
      rm2: { name: "Slash Barrage Proficiency",   desc: "If the target is poisoned, it deals extra damage and inflicts 2 sundered." },
    }
  },
  "Assassin (Ch)": {
    branches: { red: "Luck", green: "Endurance", blue: "Strength" },
    branchStats: { shared: "spd", red: "lck", green: "end", blue: "str" },
    nodes: {
      s1:  { name: "Speed Node" }, s2:  { name: "Speed Node" },
      s3:  { name: "Speed Node" }, s4:  { name: "Speed Node" },
      l1:  { name: "Luck Node" }, l2:  { name: "Luck Node" },
      l3:  { name: "Luck Node" }, l4:  { name: "Luck Node" },
      l5:  { name: "Luck Node" }, l6:  { name: "Luck Node" },
      l7:  { name: "Luck Node" }, l8:  { name: "Luck Node" },
      l9:  { name: "Luck Node" },
      lm1: { name: "Shadow Master",               desc: "All attacks dealt while invisible now deal 30% more damage. (Doesn't stack with Stealth Strike's buff)\nActually works with Stealth Strike's buff despite the description. Also stacks multiplicatively with Shadow Form's innate damage buff.", upgrades: "Shadow Form" },
      lm2: { name: "Shadow Form Proficiency",     desc: "Now makes your next attack apply 2 sundered and 3 poison.\nThese statuses are applied before the damage is dealt." },
      c1:  { name: "Endurance Node" }, c2a: { name: "Endurance Node" },
      c2b: { name: "Endurance Node" }, c3a: { name: "Endurance Node" },
      c4:  { name: "Endurance Node" }, c5a: { name: "Endurance Node" },
      c5b: { name: "Endurance Node" },
      cm1: { name: "Toxic Vitality",              desc: "Auto dodging an attack now causes you to fire off a poison dagger at your attacker, dealing a small amount of damage and inflicting 3 poisoned." },
      cm2: { name: "Poison Fan Proficiency",      desc: "If the target is already poisoned, it deals 10% more damage and applies 10 poison." },
      r1:  { name: "Strength Node" }, r2:  { name: "Strength Node" },
      r3:  { name: "Strength Node" }, r4:  { name: "Strength Node" },
      r5:  { name: "Strength Node" }, r6:  { name: "Strength Node" },
      r7:  { name: "Strength Node" }, r8:  { name: "Strength Node" },
      r9:  { name: "Strength Node" },
      rm1: { name: "Risk Taker",                  desc: "Increases the chance to auto dodge with shadow while below 40% max health." },
      rm2: { name: "Stealth Strike Proficiency",  desc: "Be able to trigger the first 40 poison stacks of an enemy from using Stealth Strike, and remove the last 40 stacks of poison." },
    }
  },
  "Monk (Or)": {
    branches: { red: "Speed", green: "Strength", blue: "Endurance" },
    branchStats: { shared: "lck", red: "spd", green: "str", blue: "end" },
    nodes: {
      s1:  { name: "Luck Node" }, s2:  { name: "Luck Node" },
      s3:  { name: "Luck Node" }, s4:  { name: "Luck Node" },
      l1:  { name: "Speed Node" }, l2:  { name: "Speed Node" },
      l3:  { name: "Speed Node" }, l4:  { name: "Speed Node" },
      l5:  { name: "Speed Node" }, l6:  { name: "Speed Node" },
      l7:  { name: "Speed Node" }, l8:  { name: "Speed Node" },
      l9:  { name: "Speed Node" },
      lm1: { name: "Holy Protection",             desc: "Blocking melee attacks while over 90% HP creates a pulse of light that deals 5 damage (scales with STR) to the attacker." },
      lm2: { name: "Blazing Barrage Proficiency", desc: "The attack now deals 20% increased damage and applies 2 blinded if the target is burning." },
      c1:  { name: "Strength Node" }, c2a: { name: "Strength Node" },
      c2b: { name: "Strength Node" }, c3a: { name: "Strength Node" },
      c4:  { name: "Strength Node" }, c5a: { name: "Strength Node" },
      c5b: { name: "Strength Node" },
      cm1: { name: "Heated Recovery",             desc: "Attacks against burning enemies have 5% lifesteal." },
      cm2: { name: "Flame Drop Proficiency",      desc: "Base damage increased by 25%. Gains another 25% based on absorbed flame stacks (max 10)." },
      r1:  { name: "Endurance Node" }, r2:  { name: "Endurance Node" },
      r3:  { name: "Endurance Node" }, r4:  { name: "Endurance Node" },
      r5:  { name: "Endurance Node" }, r6:  { name: "Endurance Node" },
      r7:  { name: "Endurance Node" }, r8:  { name: "Endurance Node" },
      r9:  { name: "Endurance Node" },
      rm1: { name: "Holy Mantra Proficiency",     desc: "If the 1 resist from Holy Mantra is proc'd while the defense buff is active, it creates a pulse of healing on the target that recovers 15% HP." },
      rm2: { name: "Fire Sutra Proficiency",      desc: "Targets buffed with Fire Sutra now have immunity to the effects of burning, ghostflame, and inferno, and increased chance to proc burning." },
    }
  },
  "Brawler (N)": {
    branches: { red: "Speed", green: "Strength", blue: "Luck" },
    branchStats: { shared: "end", red: "spd", green: "str", blue: "lck" },
    branchMultipliers: { green: 1.15 },
    nodes: {
      s1:  { name: "Endurance Node" }, s2:  { name: "Endurance Node" },
      s3:  { name: "Endurance Node" }, s4:  { name: "Endurance Node" },
      l1:  { name: "Speed Node" }, l2:  { name: "Speed Node" },
      l3:  { name: "Speed Node" }, l4:  { name: "Speed Node" },
      l5:  { name: "Speed Node" }, l6:  { name: "Speed Node" },
      l7:  { name: "Speed Node" }, l8:  { name: "Speed Node" },
      l9:  { name: "Speed Node" },
      lm1: { name: "Oppression",                  desc: "Passively deal 5% more damage per status effect on the target.\nFor each unique status effect on the opponent, increase your damage by 5%. Caps at 5 unique statuses, totaling a 25% damage buff." },
      lm2: { name: "Burst Combo Proficiency",     desc: "Now inflicts 2 sundered if the target is vulnerable.\nThe 2 turns of Sunder are applied even on dodge (?)." },
      c1:  { name: "Strength Node" }, c2a: { name: "Strength Node" },
      c2b: { name: "Strength Node" }, c3a: { name: "Strength Node" },
      c4:  { name: "Strength Node" }, c5a: { name: "Strength Node" },
      c5b: { name: "Strength Node" },
      cm1: { name: "Impact Variance",             desc: "The Crusher passive now also applies to weakened, blinded and/or hexed enemies.\nCrusher's bonus damage towards Vulnerable enemies now applies to these statuses as well. Does not stack with the base Crusher Vulnerable damage bonus." },
      cm2: { name: "Crushing Strike Proficiency", desc: "If the target has vulnerable or weakened, the blow is more devastating, dealing 20% more damage and applying 2 bleeding and 2 blinded.\nIf blocked, still applies 2 turns of Bleeding and Blinded." },
      r1:  { name: "Luck Node" }, r2:  { name: "Luck Node" },
      r3:  { name: "Luck Node" }, r4:  { name: "Luck Node" },
      r5:  { name: "Luck Node" }, r6:  { name: "Luck Node" },
      r7:  { name: "Luck Node" }, r8:  { name: "Luck Node" },
      r9:  { name: "Luck Node" },
      rm1: { name: "Adrenaline",                  desc: "While below 50% HP, gain 10% DR.\nThis DR is removed if you are above 50% MaxHP. This buff is non-visual, similar to Bruiser." },
      rm2: { name: "Party Table Proficiency",     desc: "Now hits adjacent targets.\nDeals full damage to all targets rather than just a single target. Damage to adjacent targets can critically strike and trigger special effects such as Inferno's burn application." },
    }
  },
  "Darkwraith (Ch)": {
    branches: { red: "Luck", green: "Endurance", blue: "Arcane" },
    branchStats: { shared: "spd", red: "lck", green: "end", blue: "arc" },
    branchMultipliers: { green: 1.15 },
    nodes: {
      s1:  { name: "Speed Node" }, s2:  { name: "Speed Node" },
      s3:  { name: "Speed Node" }, s4:  { name: "Speed Node" },
      l1:  { name: "Luck Node" }, l2:  { name: "Luck Node" },
      l3:  { name: "Luck Node" }, l4:  { name: "Luck Node" },
      l5:  { name: "Luck Node" }, l6:  { name: "Luck Node" },
      l7:  { name: "Luck Node" }, l8:  { name: "Luck Node" },
      l9:  { name: "Luck Node" },
      lm1: { name: "Dark Generation",             desc: "While below 75% HP, gain 2 orbs when you would normally get 1." },
      lm2: { name: "Dark Smite Proficiency",      desc: "Increases bonus crit chance to +50%, gives an extra orb if the enemy is stunned, hexed or cursed.\nThe 50% crit chance increase adds to the base 25%, leading to a 75% total crit chance increase with Dark Smite. Applies 1 cursed stack per hit, totaling 4 cursed stacks." },
      c1:  { name: "Endurance Node" }, c2a: { name: "Endurance Node" },
      c2b: { name: "Endurance Node" }, c3a: { name: "Endurance Node" },
      c4:  { name: "Endurance Node" }, c5a: { name: "Endurance Node" },
      c5b: { name: "Endurance Node" },
      cm1: { name: "Cursed Fists",                desc: "Your strikes now have +20% increased crit chance and apply 1 cursed. All Darkwraith and Darkbeast skills do 10% more damage.\nThe strikes mentioned refer to Gilded Strike and Strike. Other moves may also be included but are mostly unknown." },
      cm2: { name: "Darkcore Eruption Proficiency", desc: "At max stacks it now inflicts 2 hexed and recovers 10% HP to the user.\nMax stacks refers to having 6 darkcores." },
      r1:  { name: "Arcane Node" }, r2:  { name: "Arcane Node" },
      r3:  { name: "Arcane Node" }, r4:  { name: "Arcane Node" },
      r5:  { name: "Arcane Node" }, r6:  { name: "Arcane Node" },
      r7:  { name: "Arcane Node" }, r8:  { name: "Arcane Node" },
      r9:  { name: "Arcane Node" },
      rm1: { name: "Overcore",                    desc: "Whenever you land a critical hit at max Darkcores (6), empower your Darkbeast's next attack.\nAt max Darkcores, critical hits are upgraded to the next tier (visible by the crit colour) — crit damage multiplies by itself (e.g. 2x crit → 4x).\nYour Darkbeast's next move is enhanced:\nPounce: Applies 2 bleed, base damage → 8.\nVoid Bite: Lifesteal → 40%, base damage → 14.\nShade Roar: Applies 2 sunder, base damage → 12." },
      rm2: { name: "Call Darkbeast Proficiency",  desc: "Your Darkbeast's Void Bite now inflicts 2 weakened and 2 vulnerable and gets a damage buff and energy gain buff at 5+ orbs.\nThe statuses are always applied regardless of darkcores consumed. Energy gain and damage buff are suspected to be bugged." },
    }
  },
  "Saint (Or)": {
    branches: { red: "Endurance", green: "Arcane", blue: "Speed" },
    branchStats: { shared: "lck", red: "end", green: "arc", blue: "spd" },
    nodes: {
      s1:  { name: "Luck Node" }, s2:  { name: "Luck Node" },
      s3:  { name: "Luck Node" }, s4:  { name: "Luck Node" },
      l1:  { name: "Endurance Node" }, l2:  { name: "Endurance Node" },
      l3:  { name: "Endurance Node" }, l4:  { name: "Endurance Node" },
      l5:  { name: "Endurance Node" }, l6:  { name: "Endurance Node" },
      l7:  { name: "Endurance Node" }, l8:  { name: "Endurance Node" },
      l9:  { name: "Endurance Node" },
      lm1: { name: "Piercing Grace",              desc: "Cursed only negates 75% of your healing instead of 100%.\nA larger heal value results in less heal received — different healing moves vary in how much % is negated." },
      lm2: { name: "Holy Grace Proficiency",      desc: "Now grants a 25% buff to regen for 3 turns." },
      c1:  { name: "Arcane Node" }, c2a: { name: "Arcane Node" },
      c2b: { name: "Arcane Node" }, c3a: { name: "Arcane Node" },
      c4:  { name: "Arcane Node" }, c5a: { name: "Arcane Node" },
      c5b: { name: "Arcane Node" },
      cm1: { name: "All For One",                 desc: "Increases HP Regen (doubled), increases incoming healing by 40%, gain 20% lifesteal on attacks." },
      cm2: { name: "Light Burst Proficiency",     desc: "Damage increased by 30%, now inflicts 2 weakened and 2 vulnerable and gives you 2% regeneration for 2 turns.\nRegen increases by 0.75×(base regen)×(enemies hit), stacking on top of base regen. Persists through encounters but resets on reset/leave." },
      r1:  { name: "Speed Node" }, r2:  { name: "Speed Node" },
      r3:  { name: "Speed Node" }, r4:  { name: "Speed Node" },
      r5:  { name: "Speed Node" }, r6:  { name: "Speed Node" },
      r7:  { name: "Speed Node" }, r8:  { name: "Speed Node" },
      r9:  { name: "Speed Node" },
      rm1: { name: "One For All",                 desc: "Reduced damage by 30%, increased outgoing healing by 50%, increased regen buff on Graceful Returns.\nOutgoing healing increase is multiplicative and affects all outgoing healing. Graceful Returns regen boost is doubled from 7.5% to 15%." },
      rm2: { name: "Cleansing Prayer Proficiency", desc: "Now gives 1 resist and a 5% DR buff for 2 turns." },
    }
  },
  "Lancer (N)": {
    branches: { red: "Speed", green: "Endurance", blue: "Strength" },
    branchStats: { shared: "lck", red: "spd", green: "end", blue: "str" },
    nodes: {
      s1:  { name: "Luck Node" }, s2:  { name: "Luck Node" },
      s3:  { name: "Luck Node" }, s4:  { name: "Luck Node" },
      l1:  { name: "Speed Node" }, l2:  { name: "Speed Node" },
      l3:  { name: "Speed Node" }, l4:  { name: "Speed Node" },
      l5:  { name: "Speed Node" }, l6:  { name: "Speed Node" },
      l7:  { name: "Speed Node" }, l8:  { name: "Speed Node" },
      l9:  { name: "Speed Node" },
      lm1: { name: "Jolting Dodges",              desc: "Now fires a shockwave when dodging ranged attacks." },
      lm2: { name: "Rallying Shout Proficiency",  desc: "Increased aggro chance (currently bugged). Gives all allies 10% HP Regen for 3 turns." },
      c1:  { name: "Endurance Node" }, c2a: { name: "Endurance Node" },
      c2b: { name: "Endurance Node" }, c3a: { name: "Endurance Node" },
      c4:  { name: "Endurance Node" }, c5a: { name: "Endurance Node" },
      c5b: { name: "Endurance Node" },
      cm1: { name: "Overload",                    desc: "Attacks against stunned enemies deal 100% more damage." },
      cm2: { name: "Discharge Proficiency",       desc: "Fires 4 smaller lightning projectiles that can hit the same target. First hit at full damage, second at 38%, subsequent hits at 1/3 damage.\nAlso applies 2 Weakened per hit." },
      r1:  { name: "Strength Node" }, r2:  { name: "Strength Node" },
      r3:  { name: "Strength Node" }, r4:  { name: "Strength Node" },
      r5:  { name: "Strength Node" }, r6:  { name: "Strength Node" },
      r7:  { name: "Strength Node" }, r8:  { name: "Strength Node" },
      r9:  { name: "Strength Node" },
      rm1: { name: "Cell Charge",                 desc: "Blocking/Dodging now charges the 50% damage boost. Blocking gives more charge, requiring 10 blocks or 20 dodges.\nMeditating/Blocking/Dodging builds stacks. Use Discharge and Empowered Pierce to consume stacks for up to 50% more damage. 3 Meditates to max stacks." },
      rm2: { name: "Empowering Pierce Proficiency", desc: "Landing the attack now buffs you with a 25% speed buff and 10% DR for 2 turns." },
    }
  },
  "Impaler (Ch)": {
    branches: { red: "Strength", green: "Arcane", blue: "Endurance" },
    branchStats: { shared: "spd", red: "str", green: "arc", blue: "end" },
    nodes: {
      s1:  { name: "Speed Node" }, s2:  { name: "Speed Node" },
      s3:  { name: "Speed Node" }, s4:  { name: "Speed Node" },
      l1:  { name: "Strength Node" }, l2:  { name: "Strength Node" },
      l3:  { name: "Strength Node" }, l4:  { name: "Strength Node" },
      l5:  { name: "Strength Node" }, l6:  { name: "Strength Node" },
      l7:  { name: "Strength Node" }, l8:  { name: "Strength Node" },
      l9:  { name: "Strength Node" },
      lm1: { name: "Blood Mastery",               desc: "Increases the cap of Bloody Berserker's buff to 20 stacks.\nCaps at 5 statuses for a total 25% damage bonus. (Currently does nothing due to passive revert.)" },
      lm2: { name: "Rending Barrage Proficiency", desc: "Increases your ATKP based on combined Bleeding stacks on both you and your target: +0.025 / 2.5% per stack, up to +0.25 / 25% at 10 stacks." },
      c1:  { name: "Arcane Node" }, c2a: { name: "Arcane Node" },
      c2b: { name: "Arcane Node" }, c3a: { name: "Arcane Node" },
      c4:  { name: "Arcane Node" }, c5a: { name: "Arcane Node" },
      c5b: { name: "Arcane Node" },
      cm1: { name: "Lasting Life",                desc: "Increases Deranged Fighter's incoming healing buff to 2.5%." },
      cm2: { name: "Bloody Burst Proficiency",    desc: "Fires 3 shards instead of 2.\nReduces self-damage from 8.25% to 5.5% HP, increases self-applied bleed from 2 to 3 turns, and increases shard damage by 50%. The extra hit does not work." },
      r1:  { name: "Endurance Node" }, r2:  { name: "Endurance Node" },
      r3:  { name: "Endurance Node" }, r4:  { name: "Endurance Node" },
      r5:  { name: "Endurance Node" }, r6:  { name: "Endurance Node" },
      r7:  { name: "Endurance Node" }, r8:  { name: "Endurance Node" },
      r9:  { name: "Endurance Node" },
      rm1: { name: "Siphoning",                   desc: "Attacks against bleeding enemies have 5% lifesteal." },
      rm2: { name: "Blood Eruption Proficiency",  desc: "Increases Blood Eruption's scaling to STR/65 + ARC/65. Additionally increases your ATKP by 0.2 / 20% for 3 turns. All enemies that attack you will also have their ATKP increased by 0.2 / 20% for 3 turns.\nYou gain a 20% damage buff while also taking 20% more damage." },
    }
  },
  "Lionheart (N)": {
    branches: { red: "Strength", green: "Endurance", blue: "Speed" },
    branchStats: { shared: "lck", red: "str", green: "end", blue: "spd" },
    nodes: {
      s1:  { name: "Luck Node" }, s2:  { name: "Luck Node" },
      s3:  { name: "Luck Node" }, s4:  { name: "Luck Node" },
      l1:  { name: "Strength Node" }, l2:  { name: "Strength Node" },
      l3:  { name: "Strength Node" }, l4:  { name: "Strength Node" },
      l5:  { name: "Strength Node" }, l6:  { name: "Strength Node" },
      l7:  { name: "Strength Node" }, l8:  { name: "Strength Node" },
      l9:  { name: "Strength Node" },
      lm1: { name: "Prideful Heart",              desc: "Torrefy will now allow you to select an ally to take an additional 20% of the damage they would have taken until your next turn. This stacks with Torrefy's base mechanics." },
      lm2: { name: "Daybreak Proficiency",        desc: "Gain 10 temporary Courage stacks which last for 3 turns. These can go over the Courage cap." },
      c1:  { name: "Endurance Node" }, c2a: { name: "Endurance Node" },
      c2b: { name: "Endurance Node" }, c3a: { name: "Endurance Node" },
      c4:  { name: "Endurance Node" }, c5a: { name: "Endurance Node" },
      c5b: { name: "Endurance Node" },
      cm1: { name: "Courageous Heart",            desc: "You now permanently have 5 Courage stacks for the entire fight. These are still affected by Courage scaling." },
      cm2: { name: "Benumb Proficiency",          desc: "If an ally would receive a status effect while this move is active, redirect it towards you instead (once per ally for the duration). Every unique status effect on you as this move ends grants 2% of MaxHP as Regeneration for 4 turns. This regen does not scale." },
      r1:  { name: "Speed Node" }, r2:  { name: "Speed Node" },
      r3:  { name: "Speed Node" }, r4:  { name: "Speed Node" },
      r5:  { name: "Speed Node" }, r6:  { name: "Speed Node" },
      r7:  { name: "Speed Node" }, r8:  { name: "Speed Node" },
      r9:  { name: "Speed Node" },
      rm1: { name: "Puristic Heart",              desc: "Activating Torrefy will decrease the effectiveness of your defense buffs by 50% and convert a portion of that defense into a MaxHP regen buff. Lasts 3 turns and stacks multiplicatively with itself." },
      rm2: { name: "Cauterisation Proficiency",   desc: "Sets the duration of all stored damage from Vulcanised Vigor back to 3 turns when this move ends. Gaining DR while this move is active will now heal you for 3% of MaxHP immediately instead of being nullified. This heal does not scale." },
    }
  },
  "Arbiter (N)": {
    branches: { red: "Arcane", green: "Endurance", blue: "Luck" },
    branchStats: { shared: "spd", red: "arc", green: "end", blue: "lck" },
    nodes: {
      s1:  { name: "Speed Node" }, s2:  { name: "Speed Node" },
      s3:  { name: "Speed Node" }, s4:  { name: "Speed Node" },
      l1:  { name: "Arcane Node" }, l2:  { name: "Arcane Node" },
      l3:  { name: "Arcane Node" }, l4:  { name: "Arcane Node" },
      l5:  { name: "Arcane Node" }, l6:  { name: "Arcane Node" },
      l7:  { name: "Arcane Node" }, l8:  { name: "Arcane Node" },
      l9:  { name: "Arcane Node" },
      lm1: { name: "Weight of Sin",               desc: "When you trigger Karma, inflict Pressure stacks equal to half of the stacks consumed by Karma's activation." },
      lm2: { name: "Litigate Proficiency",        desc: "Will now force trigger Karma if there is any on the opponent regardless of base damage. When triggering Karma with this move, do not consume stacks. Instead, apply 1 weakened and 1 vulnerable for every stack of Karma that would have been consumed." },
      c1:  { name: "Endurance Node" }, c2a: { name: "Endurance Node" },
      c2b: { name: "Endurance Node" }, c3a: { name: "Endurance Node" },
      c4:  { name: "Endurance Node" }, c5a: { name: "Endurance Node" },
      c5b: { name: "Endurance Node" },
      cm1: { name: "Tetradeath",                  desc: "Every 4 negative status effects you inflict onto an enemy will additionally curse them, inflicting 1 Karma." },
      cm2: { name: "Injunction Proficiency",      desc: "Now has a base damage of 5. If this move applies over 4 negative status effects, it does not consume Karma." },
      r1:  { name: "Luck Node" }, r2:  { name: "Luck Node" },
      r3:  { name: "Luck Node" }, r4:  { name: "Luck Node" },
      r5:  { name: "Luck Node" }, r6:  { name: "Luck Node" },
      r7:  { name: "Luck Node" }, r8:  { name: "Luck Node" },
      r9:  { name: "Luck Node" },
      rm1: { name: "The Bell Tolls",              desc: "When you activate Karma, it lasts an additional 2 turns." },
      rm2: { name: "Pronouncement Proficiency",   desc: "Decrease this move's CD by 1 for every 5 stacks of Karma on the target." },
    }
  }
};

function getActiveMasteryData() {
  const sup = document.getElementById("super-picker")?.value;
  if (sup && masteryClassData[sup]) return masteryClassData[sup];
  const cls = document.getElementById("class-picker")?.value;
  return cls ? masteryClassData[cls] ?? null : null;
}

function getMasteryStatBonuses() {
  const classData = getActiveMasteryData();
  if (!classData?.branchStats) return {};
  const bonuses = {};
  const multipliers = classData.branchMultipliers ?? {};
  masteryNodes.forEach(n => {
    if (!masteryState[n.id] || n.type === "breakthrough" || n.type === "mastery") return;
    const stat = classData.branchStats[n.branch];
    const mult = multipliers[n.branch] ?? 1;
    if (stat) bonuses[stat] = (bonuses[stat] || 0) + mult;
  });
  return bonuses;
}

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
  { id: "l3",   name: "Node",         type: "node",         branch: "red",   parent: "l2"    },
  { id: "l4",   name: "Node",         type: "node",         branch: "red",   parent: "l2"    },
  { id: "l5",   name: "Node",         type: "node",         branch: "red",   parent: ["l3", "l4"]  },
  { id: "lbt1", name: "Breakthrough", type: "breakthrough", branch: "red",   parent: "l5",   shardCost: 1 },
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
  { id: "c3a", name: "Node",         type: "node",         branch: "green",  parent: ["c2a", "c2b"]  },
  { id: "cb1", name: "Breakthrough", type: "breakthrough", branch: "green",  parent: "c3a", shardCost: 1 },
  { id: "cm1", name: "Mastery",      type: "mastery",      branch: "green",  parent: "cb1"  },
  { id: "c4",  name: "Node",         type: "node",         branch: "green",  parent: "cm1"  },
  { id: "c5a", name: "Node",         type: "node",         branch: "green",  parent: "c4"   },
  { id: "c5b", name: "Node",         type: "node",         branch: "green",  parent: "c4"   },
  { id: "cb2", name: "Breakthrough", type: "breakthrough", branch: "green",  parent: ["c5a", "c5b"], shardCost: 1 },
  { id: "cm2", name: "Mastery",      type: "mastery",      branch: "green",  parent: "cb2"  },
  // Blue (right) branch — mirrored structure, Mastery is to the RIGHT of the node
  //   node → [node | node] → [node | node] → breakthrough → [node LEFT | ◆Mastery RIGHT] → 2 nodes → breakthrough → node → ◆Mastery
  { id: "r1",   name: "Node",         type: "node",         branch: "blue",  parent: "s4"    },
  { id: "r2",   name: "Node",         type: "node",         branch: "blue",  parent: "r1"    },
  { id: "r3",   name: "Node",         type: "node",         branch: "blue",  parent: "r2"    },
  { id: "r4",   name: "Node",         type: "node",         branch: "blue",  parent: "r2"    },
  { id: "r5",   name: "Node",         type: "node",         branch: "blue",  parent: ["r3", "r4"] },
  { id: "rbt1", name: "Breakthrough", type: "breakthrough", branch: "blue",  parent: "r5",   shardCost: 1 },
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
    ["l1"],            // node 1 — root of red branch
    ["l2"],      // fork: l2 (left), l3 (right) — both children of l1
    ["l3", "l4"],      // l4=child of l2 (main path left), l5=child of l3 (dead end right)
    ["l5"],
    ["lbt1"],          // breakthrough 1 — child of l4
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
    ["r1"],            // node 1 — root of blue branch
    ["r2"],      // fork: r2 (left), r3 (right) — both children of r1
    ["r3", "r4"],      // r4=child of r2 (main path left), r5=child of r3 (dead end right)
    ["r5"],
    ["rbt1"],          // breakthrough 1 — child of r4
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
  return masteryNodes.some(n => [].concat(n.parent ?? []).includes(id) && masteryState[n.id]);
}

function renderMasteryInfoSection() {
  const section = document.getElementById("mastery-info-section");
  const content = document.getElementById("mastery-info-content");
  if (!section || !content) return;

  const classData = getActiveMasteryData();
  const active = masteryNodes.filter(n => n.type === "mastery" && masteryState[n.id]);

  if (!active.length) {
    section.style.display = "none";
    return;
  }

  section.style.display = "";
  content.innerHTML = active.map(n => {
    const override = classData?.nodes?.[n.id] || {};
    const name = override.name || n.name;
    const desc = override.desc || "";
    return `<div class="mastery-passive-card">
      <div class="mastery-passive-name">${name}</div>
      ${desc ? `<div class="mastery-passive-desc">${desc.replace(/\n/g, "<br>")}</div>` : ""}
    </div>`;
  }).join("");
}

let _masteryModalTarget = null;

function openMasteryModal(id) {
  const node = masteryNodeMap[id];
  if (!node) return;
  const classData = getActiveMasteryData();
  if (!classData) return;

  const override = classData?.nodes?.[id] || {};
  const displayName = override.name || node.name;
  const desc = override.desc || "";
  const active = masteryState[id];
  const parentOk = !node.parent || [].concat(node.parent).every(p => masteryState[p]);
  const locked = !parentOk;
  const childLocked = active && hasMasteryActiveChild(id);

  if (locked || childLocked) return; // can't interact, do nothing

  const costLabel = node.type === "mastery" ? "5 pts"
                  : node.type === "breakthrough" ? "1 echo shard"
                  : "1 pt";

  _masteryModalTarget = id;

  document.getElementById("mastery-modal-name").textContent = displayName;
  document.getElementById("mastery-modal-cost").textContent = active ? "Active" : costLabel;
  document.getElementById("mastery-modal-desc").textContent = desc || "No description.";

  const confirmBtn = document.getElementById("mastery-modal-confirm");
  if (active) {
    confirmBtn.textContent = "Deactivate";
    confirmBtn.classList.add("deactivate");
  } else {
    confirmBtn.textContent = "Confirm";
    confirmBtn.classList.remove("deactivate");
  }

  document.getElementById("mastery-modal").style.display = "flex";
}

function confirmMasteryNode() {
  if (_masteryModalTarget !== null) {
    toggleMasteryNode(_masteryModalTarget);
    _masteryModalTarget = null;
  }
  document.getElementById("mastery-modal").style.display = "none";
}

function closeMasteryModal(event) {
  if (event.target === document.getElementById("mastery-modal")) {
    document.getElementById("mastery-modal").style.display = "none";
    _masteryModalTarget = null;
  }
}

function toggleMasteryNode(id) {
  const node = masteryNodeMap[id];
  if (!node) return;
  if (!getActiveMasteryData()) return;

  if (masteryState[id]) {
    // Deactivate only if no active children depend on it
    if (hasMasteryActiveChild(id)) return;
    masteryState[id] = false;
  } else {
    // Require ALL parents to be active
    if (node.parent && ![].concat(node.parent).every(p => masteryState[p])) return;
    // Check point budget (breakthroughs cost shards, not points)
    if (node.type !== "breakthrough") {
      const cost = node.type === "mastery" ? 5 : 1;
      if (masteryPointsSpent() + cost > MASTERY_TOTAL_POINTS) return;
    }
    masteryState[id] = true;
  }

  updateMasteryDisplay();
  renderMasteryInfoSection();
  updatePecents();
  renderDmgBonusSection();
}

function resetMastery() {
  masteryNodes.forEach(n => masteryState[n.id] = false);
  updateMasteryDisplay();
  renderMasteryInfoSection();
  updatePecents();
}

function masteryNodeHtml(id) {
  const node = masteryNodeMap[id];
  const classData = getActiveMasteryData();
  const override = classData?.nodes?.[id] || {};
  const displayName = override.name || node.name;
  const desc = override.desc || "";

  const active = masteryState[id];
  const parentOk = !node.parent || [].concat(node.parent).every(p => masteryState[p]);
  const locked = !parentOk;
  const childLocked = active && hasMasteryActiveChild(id);

  const costLabel = node.type === "mastery" ? "5 pts"
                  : node.type === "breakthrough" ? "1 echo shard"
                  : "1 pt";

  const stat = classData?.branchStats?.[node.branch] || 'lck';
  let cls = `mn-node mn-${node.branch} mn-type-${node.type} mn-stat-${stat}`;
  if (active) cls += " mn-active";
  if (locked) cls += " mn-locked";
  if (childLocked) cls += " mn-child-locked";

  const cursor = locked || childLocked ? "not-allowed" : "pointer";
  const tooltip = desc ? `${displayName} — ${costLabel}\n\n${desc}` : `${displayName} — ${costLabel}`;
  const clickFn = node.type === "mastery" ? `openMasteryModal('${id}')` : `toggleMasteryNode('${id}')`;
  return `<div class="${cls}" id="mn-${id}" onclick="${clickFn}" title="${tooltip}" style="cursor:${cursor}"></div>`;
}

function masteryBranchHtml(branch) {
  const rows = masteryBranchRows[branch];
  const classData = getActiveMasteryData();
  const branchLabel = classData?.branches?.[branch] || "";
  let html = `<div class="mastery-branch mastery-branch-${branch}">`;
  if (branchLabel) html += `<div class="mastery-branch-label">${branchLabel}</div>`;
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

  if (!getActiveMasteryData()) {
    container.innerHTML = `<div class="mastery-locked-msg">Select a class to unlock mastery</div>`;
    return;
  }

  let html = `<div class="mastery-trunk">`;
  ["s1","s2","s3","s4"].forEach(id => {
    html += `<div class="mastery-row"><div class="mn-wrap">${masteryNodeHtml(id)}</div></div>`;
  });
  html += `</div>`;

  html += `<div class="mastery-branches">`;
  html += masteryBranchHtml("red");
  html += masteryBranchHtml("green");
  html += masteryBranchHtml("blue");
  html += `</div>`;

  container.innerHTML = html;
  updateMasteryDisplay();
  drawMasteryLines();
}

function updateMasteryDisplay() {
  masteryNodes.forEach(n => {
    const el = document.getElementById(`mn-${n.id}`);
    if (!el) return;
    const active = masteryState[n.id];
    const parentOk = !n.parent || [].concat(n.parent).every(p => masteryState[p]);
    const locked = !parentOk;
    const childLocked = active && hasMasteryActiveChild(n.id);

    const classData2 = getActiveMasteryData();
    const stat2 = classData2?.branchStats?.[n.branch] || 'lck';
    el.className = `mn-node mn-${n.branch} mn-type-${n.type} mn-stat-${stat2}`;
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

function getLineColor(branch) {
  return branch === "red"    ? "#553333"
       : branch === "green"  ? "#335533"
       : branch === "blue"   ? "#334488"
       : "#444444";
}

function drawSvgLine(svg, x1, y1, x2, y2, color) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", Math.round(x1));
  line.setAttribute("y1", Math.round(y1));
  line.setAttribute("x2", Math.round(x2));
  line.setAttribute("y2", Math.round(y2));
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-linecap", "round");
  svg.appendChild(line);
}

function drawMasteryLines() {
  const container = document.getElementById("mastery-tree-container");
  if (!container) return;

  container.querySelectorAll(".mastery-lines-svg").forEach(e => e.remove());

  const cRect = container.getBoundingClientRect();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("mastery-lines-svg");
  svg.setAttribute("width", cRect.width);
  svg.setAttribute("height", cRect.height);

  // Separate same-row (side-mastery) connections from vertical connections
  const verticalChildren = {}; // parentId → [childId]
  const sameRowPairs = [];     // [{parentId, childId}]

  masteryNodes.forEach(n => {
    if (!n.parent) return;
    const parents = [].concat(n.parent);
    const cEl = document.getElementById(`mn-${n.id}`);
    if (!cEl) return;
    const cR = cEl.getBoundingClientRect();
    const cCY = cR.top + cR.height / 2;

    parents.forEach(pid => {
      const pEl = document.getElementById(`mn-${pid}`);
      if (!pEl) return;
      const pR = pEl.getBoundingClientRect();
      const pCY = pR.top + pR.height / 2;

      if (Math.abs(pCY - cCY) < 15) {
        sameRowPairs.push({ parentId: pid, childId: n.id, branch: n.branch });
      } else {
        if (!verticalChildren[pid]) verticalChildren[pid] = [];
        if (!verticalChildren[pid].includes(n.id)) verticalChildren[pid].push(n.id);
      }
    });
  });

  // Draw vertical / elbow connectors
  Object.entries(verticalChildren).forEach(([parentId, childIds]) => {
    const pEl = document.getElementById(`mn-${parentId}`);
    if (!pEl) return;
    const pR = pEl.getBoundingClientRect();
    const px = pR.left + pR.width / 2 - cRect.left;
    const py = pR.bottom - cRect.top;
    const color = getLineColor(masteryNodeMap[parentId]?.branch);

    const children = childIds.map(id => {
      const el = document.getElementById(`mn-${id}`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - cRect.left, y: r.top - cRect.top };
    }).filter(Boolean);

    if (children.length === 1) {
      drawSvgLine(svg, px, py, children[0].x, children[0].y, color);
    } else {
      const minX = Math.min(...children.map(c => c.x));
      const maxX = Math.max(...children.map(c => c.x));
      const minY = Math.min(...children.map(c => c.y));
      const midY = py + (minY - py) / 2;
      drawSvgLine(svg, px, py, px, midY, color);
      drawSvgLine(svg, minX, midY, maxX, midY, color);
      children.forEach(c => drawSvgLine(svg, c.x, midY, c.x, c.y, color));
    }
  });

  // Draw horizontal same-row connections (side mastery nodes)
  sameRowPairs.forEach(({ parentId, childId, branch }) => {
    const pEl = document.getElementById(`mn-${parentId}`);
    const cEl = document.getElementById(`mn-${childId}`);
    if (!pEl || !cEl) return;
    const pR = pEl.getBoundingClientRect();
    const cR = cEl.getBoundingClientRect();
    const y  = (pR.top + pR.bottom) / 2 - cRect.top;
    const x1 = pR.left + pR.width / 2 - cRect.left;
    const x2 = cR.left + cR.width / 2 - cRect.left;
    drawSvgLine(svg, x1, y, x2, y, getLineColor(branch));
  });

  container.insertBefore(svg, container.firstChild);
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
    if (target === "dmg-calc") renderDmgCalc();

  });
});

// === BUILD SHARE ===

function setPickerDisplay(picker, name) {
  picker.value = name;
  const wrap = picker.previousElementSibling;
  if (wrap && wrap.classList.contains('wpick-wrap')) {
    const display = wrap.querySelector('.wpick-display');
    if (display) display.textContent = name || '— None —';
  }
}

// --- Compact lookup tables (built once) ---
function _buildLists() {
  const flatList = obj => Object.keys(obj);
  const flatWeapons = series => Object.values(series).flatMap(w => Object.keys(w));
  const flatGears   = series => Object.values(series).flat();
  return {
    race:  flatList(races),
    cls:   flatList(classes),
    sub:   subClasses,
    mark:  flatList(markItems),
    cov:   flatList(covenantItems),
    ench:  flatList(enchantItems),
    art:   flatList(artifactItems),
    shard: flatList(shardItems),
    gear:  flatGears(gearSeries),
    wm:    flatWeapons(mainWeaponSeries),
    wo:    flatWeapons(offhandSeries),
    arm:   flatList(armourItems),
  };
}
const _L = _buildLists();

function _i(list, val) { return val ? list.indexOf(val) : -1; }
function _v(list, idx) { return (idx >= 0 && idx < list.length) ? list[idx] : ''; }

function getBuildState() {
  const stats = {};
  ['str','arc','end','spd','lck'].forEach(s => {
    stats[s] = +document.querySelector(`.stat-row[data-stat="${s}"] .stat-val`).value || 0;
  });
  const shards  = [...document.querySelectorAll('.shard-picker')].map(p => p.value);
  const gears   = [...document.querySelectorAll('.gear-picker')].map(p => p.value);
  const mastery = masteryNodes.filter(n => masteryState[n.id]).map(n => n.id);
  const soul    = {};
  Object.entries(soulTreeRanks).forEach(([id, rank]) => { if (rank > 0) soul[id] = rank; });
  return {
    v:    1,
    lvl:  +lvlInput.value || 1,
    race: racePicker.value,
    cls:  classPicker.value,
    sup:  superPicker.value,
    sub:  subPicker.value,
    ...stats,
    mark: markPicker.value,
    cov:  covenantPicker.value,
    covR: +(document.getElementById('covenant-rank').value) || 1,
    ench: enchantPicker.value,
    art:  artifactPicker.value,
    sh:   shards,
    g:    gears,
    wm:   mainWeaponPicker.value,
    wo:   offhandWeaponPicker.value,
    arm:  armourPicker.value,
    msty: mastery,
    soul
  };
}

// --- Binary bit-packing encoder ---
class _BitWriter {
  constructor() { this._buf = []; this._cur = 0; this._bits = 0; }
  write(val, width) {
    for (let i = width - 1; i >= 0; i--) {
      this._cur = (this._cur << 1) | ((val >>> i) & 1);
      if (++this._bits === 8) { this._buf.push(this._cur); this._cur = 0; this._bits = 0; }
    }
  }
  toB64url() {
    const buf = [...this._buf];
    if (this._bits > 0) buf.push(this._cur << (8 - this._bits));
    return btoa(String.fromCharCode(...buf)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  }
}

class _BitReader {
  constructor(b64url) {
    const b64 = b64url.replace(/-/g,'+').replace(/_/g,'/');
    const pad = b64.length % 4 ? '===='.slice(b64.length % 4) : '';
    const bin = atob(b64 + pad);
    this._bytes = Array.from(bin, c => c.charCodeAt(0));
    this._pos = 0; this._cur = 0; this._bits = 0;
  }
  read(width) {
    let val = 0;
    for (let i = 0; i < width; i++) {
      if (!this._bits) { this._cur = this._bytes[this._pos++] || 0; this._bits = 8; }
      val = (val << 1) | ((this._cur >> --this._bits) & 1);
    }
    return val >>> 0;
  }
}

// bits needed to store values 0..n  (n+1 distinct values)
function _wb(n) { let b = 1; while ((1 << b) <= n) b++; return b; }

// Scramble a base64url string so it doesn't look like AAAAAAA when the build is empty.
// Works directly on characters — no atob/btoa, no padding issues.
// Each position rotates by a different amount so the same char → different output at each position.
const _B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function _scrambleBlob(s) {
  return s.split('').map((c, i) => {
    const idx = _B64U.indexOf(c);
    return idx < 0 ? c : _B64U[(idx + 13 + i * 7) % 64];
  }).join('');
}
function _unscrambleBlob(s) {
  return s.split('').map((c, i) => {
    const idx = _B64U.indexOf(c);
    return idx < 0 ? c : _B64U[((idx - 13 - i * 7) % 64 + 640) % 64];
  }).join('');
}

// Pack build data into binary build (base64url), no name included
function _packState(state) {
  const bw = new _BitWriter();
  const supList = classes[state.cls] || [];
  const wi = (list, val) => {
    const idx = val ? list.indexOf(val) : -1;
    bw.write(idx < 0 ? 0 : idx + 1, _wb(list.length));
  };
  bw.write(state.lvl - 1, 6);
  wi(_L.race, state.race);
  wi(_L.cls,  state.cls);
  const supIdx = supList.indexOf(state.sup);
  bw.write(supIdx < 0 ? 0 : supIdx + 1, 4);
  wi(_L.sub,  state.sub);
  ['str','arc','end','spd','lck'].forEach(s => bw.write(state[s] || 0, 8));
  wi(_L.mark, state.mark);
  wi(_L.cov,  state.cov);
  bw.write((state.covR || 1) - 1, 5);
  wi(_L.ench, state.ench);
  wi(_L.art,  state.art);
  (state.sh || []).forEach(s => wi(_L.shard, s));
  (state.g  || []).forEach(g => wi(_L.gear,  g));
  wi(_L.wm,  state.wm);
  wi(_L.wo,  state.wo);
  wi(_L.arm, state.arm);
  masteryNodes.forEach(nd => bw.write(state.msty.includes(nd.id) ? 1 : 0, 1));
  Object.keys(soulTreeRanks).forEach(id => bw.write(state.soul[id] || 0, 3));
  return bw.toB64url();
}

// Unpack binary build back into state fields (no name — caller supplies it)
function _unpackState(blob, name) {
  const br = new _BitReader(blob);
  const ri = list => { const v = br.read(_wb(list.length)); return v === 0 ? '' : (list[v - 1] || ''); };
  const lvl     = br.read(6) + 1;
  const race    = ri(_L.race);
  const cls     = ri(_L.cls);
  const supList = classes[cls] || [];
  const supIdx  = br.read(4) - 1;
  const sup     = supIdx < 0 ? '' : (supList[supIdx] || '');
  const sub     = ri(_L.sub);
  const [str, arc, end, spd, lck] = [0,0,0,0,0].map(() => br.read(8));
  const mark    = ri(_L.mark);
  const cov     = ri(_L.cov);
  const covR    = br.read(5) + 1;
  const ench    = ri(_L.ench);
  const art     = ri(_L.art);
  const sh      = [...document.querySelectorAll('.shard-picker')].map(() => ri(_L.shard));
  const g       = [...document.querySelectorAll('.gear-picker')].map(()  => ri(_L.gear));
  const wm      = ri(_L.wm);
  const wo      = ri(_L.wo);
  const arm     = ri(_L.arm);
  const msty    = masteryNodes.filter(nd => br.read(1) === 1).map(nd => nd.id);
  const soul    = {};
  Object.keys(soulTreeRanks).forEach(id => { const r = br.read(3); if (r > 0) soul[id] = r; });
  return { v: 1, lvl, race, cls, sup, sub, str, arc, end, spd, lck,
           mark, cov, covR, ench, art, sh, g, wm, wo, arm, msty, soul, name };
}

const _CLOUD = 'https://jsonblob.com/api/jsonBlob';

// Save to JSONBlob (cross-device) + localStorage (local cache)
// Returns the share URL
async function encodeState(state) {
  const blob    = _packState(state);
  const name    = state.name || 'Untitled';
  const payload = JSON.stringify({ d: blob, n: name });
  const base    = window.location.origin +
                  window.location.pathname.replace(/\/[^/]*$/, '/');
  let id;
  try {
    const res = await fetch(_CLOUD, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: payload
    });
    if (!res.ok) throw new Error();
    const loc = res.headers.get('Location') || '';
    id = loc.split('/').pop();
  } catch (e) { id = ''; }

  if (id) {
    localStorage.setItem('alb:' + id, payload);
    return base + '?id=' + id;
  }
  // Fallback: encode build state directly into the id param (no external service needed)
  return base + '?id=b_' + _scrambleBlob(blob);
}

// Load payload by ID — handles b_ (direct-encoded), localStorage, then JSONBlob
async function _loadById(id) {
  // b_ prefix = build state encoded directly in the id param (scrambled)
  if (id.startsWith('b_')) {
    return { d: _unscrambleBlob(id.slice(2)), n: 'Untitled' };
  }
  const cached = localStorage.getItem('alb:' + id);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {
      // old format was raw blob string
      return { d: cached, n: 'Untitled' };
    }
  }
  try {
    const res = await fetch(_CLOUD + '/' + id);
    if (!res.ok) throw new Error();
    const json = await res.json();
    localStorage.setItem('alb:' + id, JSON.stringify(json));
    return json;
  } catch (e) { return null; }
}

function loadBuildState(state) {
  if (!state || state.v !== 1) return;

  // Level
  lvlInput.value = state.lvl || 1;
  lvlInput.dispatchEvent(new Event('change'));

  // Race
  racePicker.value = state.race || '';
  racePicker.dispatchEvent(new Event('change'));

  // Stats — dispatch change so `spent` is updated correctly
  ['str','arc','end','spd','lck'].forEach(s => {
    const input = document.querySelector(`.stat-row[data-stat="${s}"] .stat-val`);
    if (!input) return;
    input.dataset.prev = 0;
    input.value = state[s] || 0;
    input.dispatchEvent(new Event('change'));
  });

  // Class (populates super options, resets mastery)
  classPicker.value = state.cls || '';
  classPicker.dispatchEvent(new Event('change'));

  // Super
  superPicker.value = state.sup || '';
  superPicker.dispatchEvent(new Event('change'));

  // Sub
  subPicker.value = state.sub || '';
  subPicker.dispatchEvent(new Event('change'));

  // Mark
  markPicker.value = state.mark || '';
  markPicker.dispatchEvent(new Event('change'));

  // Covenant
  covenantPicker.value = state.cov || '';
  const covRankEl = document.getElementById('covenant-rank');
  if (covRankEl) covRankEl.value = state.covR || 1;
  covenantPicker.dispatchEvent(new Event('change'));

  // Enchant
  setPickerDisplay(enchantPicker, state.ench || '');
  updateEnchantDesc();

  // Artifact
  setPickerDisplay(artifactPicker, state.art || '');
  renderArtifactDesc();

  // Shards
  const shards = state.sh || [];
  document.querySelectorAll('.shard-picker').forEach((p, i) => setPickerDisplay(p, shards[i] || ''));

  // Gears
  const gears = state.g || [];
  document.querySelectorAll('.gear-picker').forEach((p, i) => setPickerDisplay(p, gears[i] || ''));

  // Weapons
  setPickerDisplay(mainWeaponPicker, state.wm || '');
  setPickerDisplay(offhandWeaponPicker, state.wo || '');

  // Armour
  setPickerDisplay(armourPicker, state.arm || '');
  updateArmourGold(prevArmourSelection, state.arm || '');
  prevArmourSelection = state.arm || '';

  // Mastery (set after class/super dispatch so resets don't clobber)
  masteryNodes.forEach(n => { masteryState[n.id] = false; });
  (state.msty || []).forEach(id => { if (Object.prototype.hasOwnProperty.call(masteryState, id)) masteryState[id] = true; });

  // Soul tree
  Object.keys(soulTreeRanks).forEach(id => { soulTreeRanks[id] = 0; });
  Object.entries(state.soul || {}).forEach(([id, rank]) => {
    if (Object.prototype.hasOwnProperty.call(soulTreeRanks, id)) soulTreeRanks[id] = rank;
  });
  recalcSoulTreeBonuses();

  // Build name
  const buildNameInput = document.getElementById('build-name-input');
  if (buildNameInput && state.name && state.name !== 'Untitled') buildNameInput.value = state.name;

  // Final renders
  updatePoints();
  updatePecents();
  renderMoves();
  renderGearInfo();
  renderSoulTree();
  renderMastery();
  renderMasteryInfoSection();
}

// Share button
const shareBuildBtn   = document.getElementById('share-build-btn');
const buildNameInput  = document.getElementById('build-name-input');

if (shareBuildBtn) {
  shareBuildBtn.addEventListener('click', async () => {
    const state = getBuildState();
    state.name = (buildNameInput ? buildNameInput.value.trim() : '') || 'Untitled';
    shareBuildBtn.textContent = 'Saving...';
    shareBuildBtn.disabled = true;
    const url = await encodeState(state);
    shareBuildBtn.disabled = false;
    navigator.clipboard.writeText(url).then(() => {
      shareBuildBtn.textContent = 'Copied!';
      setTimeout(() => { shareBuildBtn.textContent = 'Share'; }, 2000);
    }).catch(() => {
      prompt('Copy this link:', url);
      shareBuildBtn.textContent = 'Share';
    });
  });
}

// Load build on page start
(async function () {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (id) {
    const payload = await _loadById(id);
    if (payload) {
      const nameInput = document.getElementById('build-name-input');
      if (nameInput && payload.n && payload.n !== 'Untitled') nameInput.value = payload.n;
      const state = _unpackState(payload.d, payload.n || 'Untitled');
      if (state) loadBuildState(state);
    }
    return;
  }

  // Legacy hash-based links
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  try {
    if (hash.includes('/')) {
      const parts = hash.split('/');
      if (parts.length === 2) {
        const state = _unpackState(parts[1], decodeURIComponent(parts[0]));
        if (state) loadBuildState(state);
      }
      return;
    }
    const state = JSON.parse(atob(hash));
    if (state && state.v === 1) loadBuildState(state);
  } catch (e) {}
})();
