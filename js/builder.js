// § RACE SYSTEM
// Base stat bonuses granted by each race. Values are added on top of the
// player's invested points before percentage formulas are applied.
// Rarity percentages are approximate in-game encounter rates.
// Ob = Obscure (rare/event races).
// To add a race: "RaceName (X%)": { str, arc, end, spd, lck }
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
});

// § STAT SYSTEM
// Manages the level input and the six stat counters (STR, ARC, END, SPD, LCK).
// Total allocatable points = (level − 1) × 5, plus a racial bonus for Dullahan.
// When level decreases or race changes, excess spent points are trimmed automatically.
const Max_Lvl = 40;
const Min_Lvl = 1;
let spent = 0; // total stat points currently allocated across all stat rows

const lvlInput = document.getElementById("Lvl");

// Returns the total number of stat points the player can allocate at the current level.
// Dullahan gets an extra +3 points every 10 levels on top of the base formula.
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

// Enables/disables the class, superclass, subclass, and covenant pickers based on level.
// Thresholds: base class at 5, covenant at 10, superclass at 15.
// Resets and removes gold costs for any selections that fall below their unlock level.
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
    renderDmgBonusSection();
    recalcOpenDetails();
  });

  minus.addEventListener("click", () => {
    if (+val.value <= 0) return;
    val.value = +val.value - 1;
    val.dataset.prev = val.value;
    spent--;
    updatePoints();
    updatePecents();
    renderDmgBonusSection();
    recalcOpenDetails();
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
    renderDmgBonusSection();
    recalcOpenDetails();
  });
});

// § EQUIPMENT DATA
// Armour items — total cost = 750 (craft fee) + item.cost (material/purchase price).
// pct values add directly to the displayed percentage output, not to the raw stat.
// Flat stat keys (str, arc, end, spd, lck, endFlat) are added before the formula runs.
// To add armour: "Item Name": { cost, str, arc, end, spd, lck, endFlat, pct: { ... } }
const armourItems = {
  "Paladin Cuirass": {
    cost: 250,
    endFlat: 20,
    pct: { end: 17.5 }
    // Also grants: +10% Physical Armor, -5% Run Speed, +5% Holy Armor, +5% Magic Armor, +5% Fire Armor
  },
  "Adept Warrior": {
    cost: 250,
    endFlat: 15,
    pct: { end: 10, str: 5, energy: 16.6 }
    // Also grants: +5% Physical Armor, +20% Fall Resistance, +10% Dark Armor
  },
  "Raging Warrior": {
    cost: 250,
    endFlat: 16,
    pct: { end: 10, "inc-heal": 10, energy: 10 }
    // Also grants: +5% Physical Armor, +10% Hex Armor, +5% Fire Armor
  },
  "Arcane Robes": {
    cost: 250,
    arc: 4,
    endFlat: 15,
    pct: { arc: 7.5 }
    // Also grants: +10% Magic Armor, +10% Poison Armor, +10% Holy Armor, +10% Fire Armor
  },
  "Magister Apprentice": {
    cost: 250,
    arc: 3,
    endFlat: 15,
    pct: { arc: 5 }
    // Also grants: +15% Magic Armor, +10% Poison Armor, +10% Fire Armor, +1 HP Regen
  },
  "Corrupt Caster": {
    cost: 250,
    arc: 2,
    endFlat: 16,
    pct: { end: 5, arc: 5, energy: 10 }
    // Also grants: +15% Magic Armor, +10% Poison Armor, +10% Holy Armor
  },
  "Lifebound Archer": {
    cost: 250,
    arc: 3,
    endFlat: 15,
    pct: { end: 5, arc: 5 }
    // Also grants: +10% Magic Armor, +10% Poison Armor, +10% Nature Armor, +1 HP Regen, +15% Run Speed
  },
  "Rogue Hunter": {
    cost: 250,
    endFlat: 15,
    pct: { end: 7.5, spd: 10, energy: 10 }
    // Also grants: +5% Physical Armor, +20% Run Speed, +5% Fire Armor, +1 HP Regen, +25% Fall Resistance
  },
  "Shadow Cloak": {
    cost: 250,
    endFlat: 13,
    pct: { end: 7.5, energy: 12.5 }
    // Also grants: +5% Physical Armor, +30% Run Speed, +5% Dark Armor, +1 HP Regen, +30% Fall Resistance
  },
  "Traveling Pasmark": {
    cost: 250,
    str: 5,
    endFlat: 16,
    pct: { end: 7.5, str: 5 }
    // Also grants: +5% Physical Armor, +5% Holy Armor, +1 HP Regen, +10% Fall Resistance, +5% Fire Armor, +5% Dark Armor
  },
  "Wandering Practitioner": {
    cost: 250,
    endFlat: 18,
    pct: { end: 7.5, str: 10, energy: 16.6 }
    // Also grants: +5% Physical Armor, +10% Fall Damage Resistance, +10% Fire Armor
  },
  "Shade Walker": {
    cost: 250,
    endFlat: 18,
    pct: { end: 7.5, arc: 5 }
    // Also grants: +5% Physical Armor, +10% Hex Armor, +10% Fall Resistance, +20% Dark Armor
  },
  "Pathfinder Martyr": {
    cost: 250,
    arc: 3,
    spd: 1,
    endFlat: 20,
    pct: { end: 7.5 }
    // Also grants: +5% Physical Armor, +15% Holy Armor, +1 HP Regen
  },
  "Armored Lancer": {
    cost: 250,
    endFlat: 20,
    pct: { end: 15, energy: 12.5 }
    // Also grants: +10% Physical Armor, -5% Run Speed, +10% Magic Armor, +5% Fire Armor
  },
  "Bloody Menace": {
    cost: 250,
    endFlat: 22,
    pct: { end: 10, "inc-heal": 20 }
    // Also grants: +10% Physical Armor, +5% Hex Armor, +5% Poison Armor
  },
  "Venerated Legionnaire": {
    cost: 250,
    endFlat: 17,
    pct: { end: 12.5 }
    // Also grants: +15% Physical Armor, +15% Fire Armor, +10% Ice Armor, +10% Nature Armor, +5% Dark Armor, +5% Magic Armor
  },
  "Fortified Seer": {
    cost: 250,
    endFlat: 35,
    pct: { end: 5 }
    // Also grants: +15% Dark Armor, +15% Hex Armor, +10% Holy Armor, +10% Ice Armor, +10% Fire Armor, +10% Physical Armor
  },
  "Deathmantle": {
    cost: 3000,
    endFlat: 25,
    pct: { end: 2.5, arc: 10 }
    // Also grants: +10% Magic Armor, +5% Physical Armor, +10% Ice Armor, +15% Holy Armor, +20% Dark Armor
  }
};
const soulTreeBonuses = { "crit-dmg": 0, "crit-chance": 0, endFlat: 0 };

// Flat percentage bonuses granted by specific equipped weapons.
// Applied on top of the base stat percentage inside updatePecents().
// Key format: { "stat-key": percentageValue }
const weaponBonuses = {
  "Jade Broadsword":  { "out-heal": 30, "inc-heal": 30 },
  "Jade Prayerstaff": { "out-heal": 30, "inc-heal": 30 },
  "Ivory Sword":      { "crit-chance": 15 },
  "Ivory Dagger":     { "crit-chance": 15 },
  "Ivory Spear":      { "crit-chance": 15 },
  "Ivory Axe":        { "crit-chance": 15 },
  "Ivory Hammer":     { "crit-chance": 15 },
  "Ivory Greatsword": { "crit-chance": 15 },
};

// Rank-gated percentage bonuses unlocked at specific covenant ranks.
// Structure: { "Covenant Name": [{ minRank, bonuses: { "stat-key": value } }, ...] }
// Multiple threshold entries per covenant are supported and stack additively.
const covenantBonuses = {
  "Way of Life": [
    { minRank: 5, bonuses: { "out-heal": 15 } }
  ]
};

// § STAT FORMULAS
// Converts a raw stat total into its displayed percentage value.
// Each stat uses a distinct formula derived from in-game data:
//   str / arc  — linear scaling
//   end        — linear with a fixed base offset (finalized)
//   spd        — linear at 2× rate
//   crit-chance — linear with a fixed base, capped at 100% by the caller
//   crit-dmg   — quartic polynomial fitted to observed game values
//   out-heal / inc-heal — always base 100% (additive bonuses applied separately)
//   energy     — formula unused; handled entirely via pct bonuses
function calcPercentage(stat, val){
  const formulas = {
    str:           v => v * 1.65,
    arc:           v => v * 1.65,
    end:           v => 45 + v * 1.00248, //finalized
    spd:           v => v * 2,
    "crit-chance": v => 19.8 + v * 0.25,
    "crit-dmg":    v => -2.01492e-10 * v**4 + 7.19885e-8 * v**3 - 7.82057e-6 * v**2 + 0.00694835 * v + 1.5,
    "out-heal":    () => 100,
    "inc-heal":    () => 100,
    "energy":      () => 0,
  };
  return formulas[stat] ? formulas[stat](val).toFixed(stat === "crit-dmg" ? 2 : 1) : "—";
}

const _gearSlotIds = ["gear-1","gear-2","gear-3","gear-4"];

// Returns true if the named gear item is equipped in any of the four gear slots.
function hasGearEquipped(name) {
  return _gearSlotIds.some(id => document.getElementById(id)?.value === name);
}

// Updates the "points remaining" counter displayed below the stat rows.
function updatePoints() {
  document.getElementById("points-left").textContent = getEffectiveTotal() - spent;
}

// DOM references built once at startup and reused on every updatePecents() call
// to avoid repeated querySelectorAll hits during stat recalculation.
const _pctCache = (() => {
  const items = [...document.querySelectorAll(".percent-item")].map(el => ({
    el,
    stat: el.dataset.stat,
    valEl: el.querySelector(".percent-val"),
    statInput: document.querySelector(`.stat-row[data-stat="${el.dataset.stat}"] .stat-val`)
  }));
  const statRows = [...document.querySelectorAll(".stat-row[data-stat]")].map(rowEl => ({
    rowEl,
    stat: rowEl.dataset.stat,
    input: rowEl.querySelector(".stat-val"),
    totalEl: rowEl.querySelector(".stat-total"),
    investedEl: rowEl.querySelector(".stat-invested-n"),
    bonusEl: rowEl.querySelector(".stat-bonus-n")
  }));
  const spdInput = document.querySelector('.stat-row[data-stat="spd"] .stat-val');
  const lckInput = document.querySelector('.stat-row[data-stat="lck"] .stat-val');
  const artifactPicker = document.getElementById("artifact-picker");
  return { items, statRows, spdInput, lckInput, artifactPicker };
})();

// Main stat recalculation engine — called whenever any stat, equipment, or level changes.
// Aggregation order:
//   1. Armour flat stats + pct bonuses
//   2. Weapon pct bonuses
//   3. Covenant rank-gated pct bonuses
//   4. Gear flat stats + pct bonuses
//   5. Race base stats + level bonus (these are the pct-multiplied portion)
//   6. Mastery stat bonuses
//   7. Special-case bonuses (Stultus speed→crit, Frozen Diadem, Vastic proc, Paranoxian Crux HP split)
// Results are written directly to the .percent-val elements in the UI.
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
  _gearSlotIds.forEach(id => {
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
  const lckRow = _pctCache.lckInput;
  const totalLck = (lckRow ? +lckRow.value : 0) + (raceBase.lck ?? 0) + (masteryStats.lck ?? 0) + lvlStatBonus + crystalStarStacks * 10;

  // Armour stat pct keys that boost the actual stat (not a direct % output bonus)
  const STAT_PCT_KEYS = new Set(["str", "arc", "spd"]);
  // Innate stat % bonuses applied to (invested + race base + level bonus) portion only
  const INNATE_STAT_PCT = { str: 15, arc: 15 };

  const isStultus = racePicker.value === "Stultus (20%)";
  let stultusBonus = 0;
  if (isStultus) {
    // Use getTotalStat so active SPD buffs (Focus Step, Rallying, etc.) are included
    stultusBonus = getTotalStat("spd") / 10;
  }

  _pctCache.items.forEach(({ el, stat, valEl, statInput }) => {
    const allocated = statInput ? +statInput.value : 0;
    const otherFlat = (armour[stat] ?? 0) + (masteryStats[stat] ?? 0) + (gearStatBonuses[stat] ?? 0);
    const levelBonus = statInput ? lvlStatBonus : 0;
    const isCritStat = stat === "crit-chance" || stat === "crit-dmg";
    // Combined pct for this stat: innate + armour. Applied only to (invested + race base + level bonus).
    const totalStatPct = (INNATE_STAT_PCT[stat] ?? 0) + (STAT_PCT_KEYS.has(stat) ? (armourPct[stat] ?? 0) : 0);
    const isStatMult = !isCritStat && totalStatPct > 0;
    let val;
    if (isCritStat) {
      val = totalLck;
    } else if (isStatMult) {
      const pctBase = allocated + (raceBase[stat] ?? 0) + levelBonus;
      val = pctBase * (1 + totalStatPct / 100) + otherFlat;
    } else {
      val = allocated + (raceBase[stat] ?? 0) + otherFlat + levelBonus;
    }
    const base = calcPercentage(stat, val);
    const armourStatPct = isStatMult ? 0 : (armourPct[stat] ?? 0); // pct already in val for stat-mult stats
    const pctBonus = armourStatPct + (soulTreeBonuses[stat] ?? 0) + (weaponPct[stat] ?? 0) + (covPct[stat] ?? 0) + (gearPct[stat] ?? 0);
    let display;
    if (base === "—") {
      display = "—";
    } else if (stat === "end") {
      const hpBase = parseFloat(base);
      const flatHP = (soulTreeBonuses.endFlat ?? 0) + (armour.endFlat ?? 0) + (gearStatBonuses.endFlat ?? 0);
      const hpPct = (armourPct.end ?? 0) + (gearPct.end ?? 0);
      display = (hpBase * (1 + hpPct / 100) + flatHP).toFixed(1);
      if (_pctCache.artifactPicker?.value === "Paranoxian Crux") {
        const fullHP = parseFloat(display);
        const currentHP = (fullHP * 0.15).toFixed(1);
        const shieldHP = (fullHP - fullHP * 0.15).toFixed(1);
        display = `${currentHP} (${shieldHP} Shield)`;
      }
    } else if (stat === "energy") {
      display = pctBonus > 0 ? pctBonus.toFixed(1) : "—";
    } else {
      display = (parseFloat(base) + pctBonus).toFixed(stat === "crit-dmg" ? 2 : 1);
    }
    if (stat === "crit-chance" && isStultus) {
      display = (parseFloat(display) + Math.min(100, stultusBonus)).toFixed(1);
    }
    if (stat === "crit-chance" && frozenDiademIceActive && hasGearEquipped("Frozen Diadem")) {
      display = (parseFloat(display) + 15).toFixed(1);
    }
    if (stat === "crit-chance" && vasticLckProcActive) {
      display = (parseFloat(display) + 80).toFixed(1);
    }
    if (stat === "crit-chance" && _pctCache.artifactPicker?.value === "Stellian Core" && dmgBonusActive["passive:Stellian Core"]) {
      display = (parseFloat(display) + 15).toFixed(1);
    }
    const suffix = stat === "end" ? "" : stat === "crit-dmg" ? "x" : stat === "energy" && display === "—" ? "" : "%";
    valEl.textContent = display + suffix;
  });

  // Update stat total display (merged, uses same cached stat rows)
  _pctCache.statRows.forEach(({ stat, input, totalEl, investedEl, bonusEl }) => {
    const allocated = input ? +input.value : 0;
    const crystalBonus = stat === "lck" ? crystalStarStacks * 10 : 0;
    const otherFlat = (armour[stat] ?? 0) + (masteryStats[stat] ?? 0) + (gearStatBonuses[stat] ?? 0) + crystalBonus;
    const totalStatPct = (INNATE_STAT_PCT[stat] ?? 0) + (STAT_PCT_KEYS.has(stat) ? (armourPct[stat] ?? 0) : 0);
    // pct only boosts: invested + race base + level bonus
    const pctBase = allocated + (raceBase[stat] ?? 0) + lvlStatBonus;
    const displayTotal = Math.round(pctBase * (1 + totalStatPct / 100)) + otherFlat;
    if (totalEl) totalEl.textContent = displayTotal || "";
    if (investedEl) investedEl.textContent = allocated;
    if (bonusEl) {
      const bonus = displayTotal - allocated;
      bonusEl.textContent = bonus > 0 ? `(+${bonus})` : bonus < 0 ? `(${bonus})` : "";
    }
    // Refresh any open detail panel for this stat
    const panel = document.querySelector(`.stat-detail-panel[data-stat="${stat}"]`);
    if (panel && panel.style.display !== 'none') panel.innerHTML = _buildStatDetail(stat);
  });
  autoSave();
}

// Build breakdown HTML for the stat detail panel
function _buildStatDetail(statKey) {
  const row = document.querySelector(`.stat-row[data-stat="${statKey}"] .stat-val`);
  const allocated = row ? +row.value : 0;
  const lvl = Math.min(Max_Lvl, Math.max(Min_Lvl, +lvlInput.value || Min_Lvl));
  const lvlBonus = Math.floor(lvl / 5);
  const masteryStats = getMasteryStatBonuses();
  const armourEl = document.getElementById("armour-main");
  const armourData = armourItems?.[armourEl?.value] || {};
  const armourPct = armourData.pct || {};
  const gearStatBonuses = {};
  ["gear-1","gear-2","gear-3","gear-4"].forEach(id => {
    const g = gearItems?.[document.getElementById(id)?.value];
    if (g) Object.entries(g).forEach(([k, v]) => { if (v) gearStatBonuses[k] = (gearStatBonuses[k] || 0) + v; });
  });
  const crystalBonus = statKey === "lck" ? crystalStarStacks * 10 : 0;
  const STAT_PCT_SET = new Set(["str", "arc", "spd"]);
  const INNATE = { str: 15, arc: 15 };
  const innatePct   = INNATE[statKey] ?? 0;
  const armourSPct  = STAT_PCT_SET.has(statKey) ? (armourPct[statKey] ?? 0) : 0;
  const totalPct    = innatePct + armourSPct;
  const pctBase     = allocated + (raceBase[statKey] ?? 0) + lvlBonus;
  const pctEffect   = totalPct > 0 ? Math.round(pctBase * (1 + totalPct / 100)) - pctBase : 0;

  const sources = [];
  const race = raceBase[statKey] ?? 0;
  if (race)        sources.push({ label: "Race",         val: race });
  if (lvlBonus)    sources.push({ label: "Level",        val: lvlBonus });
  if (pctEffect)   sources.push({ label: `Stat % (${totalPct}%)`, val: pctEffect });
  const mastery = masteryStats[statKey] ?? 0;
  if (mastery)     sources.push({ label: "Mastery",      val: mastery });
  const armFlat = armourData[statKey] ?? 0;
  if (armFlat)     sources.push({ label: "Armour",       val: armFlat });
  const gear = gearStatBonuses[statKey] ?? 0;
  if (gear)        sources.push({ label: "Gear",         val: gear });
  if (crystalBonus) sources.push({ label: "Crystal Stars", val: crystalBonus });

  const displayTotal = Math.round(pctBase * (1 + totalPct / 100)) +
    (armourData[statKey] ?? 0) + (masteryStats[statKey] ?? 0) +
    (gearStatBonuses[statKey] ?? 0) + crystalBonus;

  const rows = sources.length
    ? sources.map(s => `<div class="stat-detail-row"><span class="stat-detail-label">${s.label}</span><span class="stat-detail-val">+${s.val}</span></div>`).join('')
    : '<div class="stat-detail-empty">No active bonuses</div>';

  return rows + `<div class="stat-detail-row stat-detail-total"><span class="stat-detail-label">Total</span><span class="stat-detail-val stat-detail-total-val">${displayTotal}</span></div>`;
}

// Details button click handler (event delegation on stat-list)
document.querySelector('.stat-list').addEventListener('click', e => {
  const btn = e.target.closest('.stat-details-btn');
  if (!btn) return;
  const stat = btn.closest('.stat-row')?.dataset.stat;
  if (!stat) return;
  const panel = document.querySelector(`.stat-detail-panel[data-stat="${stat}"]`);
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  btn.textContent = open ? 'Details \u25be' : 'Details \u25b4';
  if (!open) panel.innerHTML = _buildStatDetail(stat);
});

// Run the initial stat render on page load so all percentage displays are populated.
updatePecents();

// § MARKS
// Mark items available in the picker. No stat data needed — marks are informational only.
// To add a mark: "Mark Name": {}
const markItems = {
  "Venia": {},
  "Astra": {},
  "Petent": {}
};

// Move and passive definitions for each mark, shown in the Info tab.
// To add mark abilities: "Mark Name": { innatePassives: [...], learns: [...] }
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

markPicker.addEventListener("change", () => {
  if (markPicker.value !== 'Venia') permuthStat = '';
  renderMoves();
});

// § ENCHANTS
// Weapon enchant data shown in the picker description panel.
// level: minimum player level required (null = no requirement).
// To add an enchant: "Enchant Name": { level: N | null, effect: "..." }
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
        category: "Summon",
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
const shardItems = {
  "Striking (R)":    { effect: "Hitting an enemy above 80% of their max HP will increase the damage of your hit.\n\nRadiant: ~8.2%", rVal: 8.2,  pVal: null, bonusType: "conditional-hp-above" },
  "Striking (P)":    { effect: "Hitting an enemy above 80% of their max HP will increase the damage of your hit.\n\nPure: ~7.5%",    rVal: null, pVal: 7.5,  bonusType: "conditional-hp-above" },
  "Shattering (R)":  { effect: "Increases your damage for every negative status effect currently applied to your target.\n\nRadiant: ~3% per debuff",  rVal: 3.0,  pVal: null, bonusType: "per-debuff-target" },
  "Shattering (P)":  { effect: "Increases your damage for every negative status effect currently applied to your target.\n\nPure: ~2.5% per debuff",    rVal: null, pVal: 2.5,  bonusType: "per-debuff-target" },
  "Regenerative (R)":{ effect: "Grants lifesteal to all your attacks.\n\nRadiant: 0.75%", rVal: 0.75, pVal: null, bonusType: "lifesteal" },
  "Regenerative (P)":{ effect: "Grants lifesteal to all your attacks.\n\nPure: 0.7%",     rVal: null, pVal: 0.7,  bonusType: "lifesteal" },
  "Voltaic (R)":     { effect: "Hitting an enemy has a small chance of granting you one energy.\n\nRadiant: Unknown", rVal: null, pVal: null, bonusType: "energy-chance" },
  "Voltaic (P)":     { effect: "Hitting an enemy has a small chance of granting you one energy.\n\nPure: ~10% chance", rVal: null, pVal: null, bonusType: "energy-chance" },
  "Executing (R)":   { effect: "Hitting an enemy below ~25% of their max HP increases the damage of your hit.\n\nRadiant: ~10%", rVal: 10.0, pVal: null, bonusType: "conditional-hp-below" },
  "Executing (P)":   { effect: "Hitting an enemy below ~25% of their max HP increases the damage of your hit.\n\nPure: Unknown",  rVal: null, pVal: null, bonusType: "conditional-hp-below" },
  "Reversing (R)":   { effect: "Increases your damage for each negative status effect currently applied to you.\n\nRadiant: ~5.12% per debuff", rVal: 5.12, pVal: null, bonusType: "per-debuff-self" },
  "Reversing (P)":   { effect: "Increases your damage for each negative status effect currently applied to you.\n\nPure: ~4.5% per debuff",  rVal: null, pVal: 4.5,  bonusType: "per-debuff-self" },
  "Empowering (R)":  { effect: "Passively increases the damage of your attacks.\n\nRadiant: ~4.1%", rVal: 4.1, pVal: null, bonusType: "passive-dmg" },
  "Empowering (P)":  { effect: "Passively increases the damage of your attacks.\n\nPure: ~3.5%",   rVal: null, pVal: 3.5, bonusType: "passive-dmg" },
};

const shardPickers = document.querySelectorAll(".shard-picker");

function getShardBonusEntries() {
  const typeCounts = {};
  const entries = [];
  document.querySelectorAll('.shard-picker').forEach(p => {
    const name = p.value;
    if (!name || !shardItems[name]) return;
    const baseType = name.replace(/ \([RP]\)$/, '');
    typeCounts[baseType] = (typeCounts[baseType] || 0) + 1;
    const drMult = typeCounts[baseType] <= 2 ? 1.0 : 0.25;
    const shard = shardItems[name];
    const rawVal = name.endsWith('(R)') ? shard.rVal : shard.pVal;
    entries.push({ name, baseType, drMult, rawVal, bonusType: shard.bonusType });
  });
  return entries;
}

function updateShardDRDisplay() {
  const typeCounts = {};
  document.querySelectorAll('.shard-picker').forEach(p => {
    const name = p.value;
    const slot = p.closest('.shard-slot');
    if (!slot) return;
    if (!name) { slot.classList.remove('shard-dr'); return; }
    const baseType = name.replace(/ \([RP]\)$/, '');
    typeCounts[baseType] = (typeCounts[baseType] || 0) + 1;
    slot.classList.toggle('shard-dr', typeCounts[baseType] > 2);
  });
}

shardPickers.forEach(picker => {
  buildSimpleDropdown(picker, Object.keys(shardItems), () => {
    renderMoves();
    collectDmgBonusPassives();
    renderDmgBonusSection();
    updateShardDRDisplay();
  });
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

buildSimpleDropdown(enchantPicker, Object.keys(enchantItems), () => {
  updateEnchantDesc();
  Object.keys(enchantCondActive).forEach(k => { enchantCondActive[k] = false; });
  enchantReaperEnemyHp = 100;
  renderDmgBonusSection(); recalcOpenDetails();
});
buildSimpleDropdown(artifactPicker, Object.keys(artifactItems), () => { renderArtifactDesc(); renderMoves(); updatePecents(); renderDmgBonusSection(); recalcOpenDetails(); });

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
  // Frozen Diadem crit (+5% vs Cold, +10% after applying Cold) is conditional — handled by frozenDiademIceActive toggle (+15 total)
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
const primordialWepPassive = mkPassive("Primordial", "Allows the use of weapon locked skills in respect to their weapon type.\n\nGrants a 20% damage buff.\n\nHas a chance to apply the Soulless status effect on hit. (currently does nothing)");
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

// § DROPDOWN BUILDER
// Replaces a native <select> with a searchable, keyboard-navigable custom dropdown.
// The original <select> is hidden but kept in the DOM so form logic still reads its .value.
// Parameters:
//   picker     — the <select> element to replace
//   names      — array of option name strings to populate
//   onSelect   — callback fired whenever the selection changes
//   isDisabled — (optional) whether the picker starts disabled
//   isHidden   — (optional) whether the picker starts hidden
function buildSimpleDropdown(picker, names, onSelect, isDisabled, isHidden) {
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
      .filter(name => !isHidden || !isHidden(name))
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
  renderDmgBonusSection();
  recalcOpenDetails();
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
      { level: 1, type: "Active", name: "Metrom's Grasp", quote: "", cost: 5, cooldown: 18, moveType: "Magic", category: "Buff", duration: 5, effect: "Decreases opponents' defense by 40%, makes them harder to block/dodge. Grants 40% more damage for DoT effects over 5 turns." }
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

const scrollClassRestrictions = {
  "Lights Out":      null,
  "Immolation":      null,
  "Bulk Up":         null,
  "Self Cure":       null,
  "Steel Body":      null,
  "Ice Shards":      ["Wizard", "Thief", "Slayer"],
  "Simple Curse":    ["Wizard", "Slayer", "Martial Artist"],
  "Wind Reflect":    ["Wizard", "Slayer"],
  "Fireball":        ["Wizard"],
  "Blizzard":        ["Wizard"],
  "Dark Slash":      ["Thief", "Warrior"],
  "Lesser Absorb":   ["Thief", "Warrior", "Slayer"],
  "Surprise Package":["Thief", "Martial Artist"],
  "Torching Soul":   ["Warrior", "Martial Artist"],
  "Lesser Empower":  ["Warrior", "Slayer"],
};

const lostScrollClassRestrictions = {
  "Absolute Radiance": null,
  "Wild Impulse":      null,
  "Metrom's Grasp":    null,
  "Permafrost Curse":  ["Wizard"],
  "Breath of Fungyir": ["Slayer", "Warrior"],
  "Heavenly Prayer":   ["Slayer", "Warrior", "Wizard"],
};

function isScrollHidden(name) {
  const allowed = scrollClassRestrictions[name];
  if (!allowed) return false;
  const cls = classPicker.value;
  if (!cls) return false;
  return !allowed.includes(cls);
}

function isLostScrollHidden(name) {
  const allowed = lostScrollClassRestrictions[name];
  if (!allowed) return false;
  const cls = classPicker.value;
  if (!cls) return false;
  return !allowed.includes(cls);
}

function clearRestrictedScrolls() {
  [
    { picker: scroll1Picker,    hidden: isScrollHidden },
    { picker: scroll2Picker,    hidden: isScrollHidden },
    { picker: lostScrollPicker, hidden: isLostScrollHidden },
  ].forEach(({ picker, hidden }) => {
    if (picker.value && hidden(picker.value)) {
      picker.value = "";
      const wrap = picker.previousElementSibling;
      if (wrap?.classList.contains('wpick-wrap'))
        wrap.querySelector('.wpick-display').textContent = '— None —';
    }
  });
  renderMoves();
  updatePecents();
}

const lostScrollPicker = document.getElementById("scroll-lost");
buildSimpleDropdown(lostScrollPicker, Object.keys(lostScrollItems), () => { renderMoves(); updatePecents(); }, null, isLostScrollHidden);

const scroll1Picker = document.getElementById("scroll-1");
const scroll2Picker = document.getElementById("scroll-2");
buildSimpleDropdown(scroll1Picker, Object.keys(scrollItems), () => {
  if (scroll1Picker.value && scroll1Picker.value === scroll2Picker.value) {
    setPickerDisplay(scroll2Picker, '');
  }
  renderMoves(); updatePecents();
}, null, isScrollHidden);
buildSimpleDropdown(scroll2Picker, Object.keys(scrollItems), () => {
  if (scroll2Picker.value && scroll2Picker.value === scroll1Picker.value) {
    setPickerDisplay(scroll1Picker, '');
  }
  renderMoves(); updatePecents();
}, null, isScrollHidden);

// --- Covenants ---
// To add a covenant: "Name": { learns: [...] }
// learns entry: { level: <rank_req>, type: "Active"|"Passive", name, quote, effect, [cost, cooldown, moveType, category, damage, scaling] }
const covenantItems = {
  "Blades of the World": {},
  "Way of Life": {},
  "Church of Raphion": {},
  "Cult of Thanasius": {}
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
  "Cult of Thanasius": {
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


// § CLASS SYSTEM
// Class progression: Base Class (lvl 5) → Super Class (lvl 15) → Sub Class (independent).
// Suffixes: (Or) = Order, (N) = Neutral, (Ch) = Chaotic.
// To add a base class:  "ClassName": ["SuperClass1 (Or)", "SuperClass2 (N)", ...]
// To add a sub-class:   push the name into the subClasses array below.
const subClasses = ["Bard", "Beastmaster", "Alchemist", "Blacksmith", "Miner"];

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

const ARMOUR_CRAFT_COST = 750;

function _armourTotalCost(name) {
  return ARMOUR_CRAFT_COST + (armourItems[name]?.cost || 0);
}

// Updates the gold total when the armour selection changes.
// Total armour cost = craft fee (750g) + item material cost.
function updateArmourGold(oldArmour, newArmour) {
  if (oldArmour) totalGold -= _armourTotalCost(oldArmour);
  if (newArmour) totalGold += _armourTotalCost(newArmour);
  goldDisplay.textContent = totalGold;
}

// Updates the gold total when a class, superclass, or subclass selection changes.
// Pass an empty string as newClass to remove the previous cost without adding a new one.
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


// § DMGCALC ENGINE
// State variables and helper functions used by the damage calculator.
// All of these are toggled or adjusted via the UI in renderDmgBonusSection().

let dmgCalcMoveList = [];
let energyCount = 0;
let rageEmpHpConsumed = 0; // 0-65: % of max HP consumed → up to 65% dmg bonus
let bloodyBersHp = 100; // 1-100: current HP% → (100 - bloodyBersHp)% dmg bonus
let absRadTurn = 1; // 1-5: current turn for Absolute Radiance buff
const ABS_RAD_BONUSES = [7.5, 10, 12.5, 15, 22.5];
let bulkUpStacks = 1; // 1-10: number of Bulk Up uses (additive 20% per stack)
let hourglassStacks = 1; // 1-5: Sands Of Time stacks (20% per stack, capped at 5)
let boreasStacks = 1; // 1-10: Boreas Frost Stacks (20% dmg per stack, max 10)
const statusEffectsActive = { vulnerable: false, hexed: false, sundered: false, fractured: false, overheat: false };
const teamBuffsActive = { mg: false, rallying: false, lesserEmp: false, castAmplify: false, blizzard: false, arcaneRitual: false };
const summonBuffsActive = { spiritAwakening: false };
const statBuffsActive = { rallyingSpd: false, empPierceSpd: false, flourishSpd: false, focusStepSpd: false };
let _flourishSpdAmt = 25; // 25 normally, 48 with Flourish Proficiency mastery
let ramiIdolStacks = 1;    // 1-5: Ramizcan Idol block/parry stacks (×15% each)
let vaingLocketTurn = 1;   // 1-3: Vainglorious Locket current turn (10%→5%→0%)
let sinisterGazeReflect = false; // Sinister Gaze: enemy has your Bulk Up defense debuff
let unendingFlowStacks = 1;    // 1-10: Blade Dancer Unending Flow consecutive hits (5% additive per stack, max 50%)
let rendingBarrageStacks = 1;  // 1-10: Impaler Rending Barrage Prof combined bleed stacks (2.5% per stack)
let demonicPresenceStacks = 1; // 1-5: Demonic Presence stacks (5% dmg per stack)
let permuthStat = ''; // chosen stat for Permuth (Venia mark) +40% buff: 'str'|'arc'|'end'|'spd'|'lck'|''
const TEAM_BUFFS = [
  { key: 'mg',          label: "MG",            mult: 1.40, desc: "Metrom's Grasp: +40% damage for DoT effects." },
  { key: 'rallying',    label: "Rallying Shout", mult: 1.15, desc: "Give all allies a 15% damage buff for 4 turns." },
  { key: 'lesserEmp',  label: "Lesser Empower", mult: 1.15, desc: "+15% damage buff for 2 turns." },
  { key: 'castAmplify',label: "Cast Amplify",   mult: 1.20, desc: "+20% damage buff to magic/holy/fire/nature/ice/dark moves for 3 turns." },
  { key: 'blizzard',   label: "Blizzard",       mult: 1.20, desc: "+20% ice damage for the team for 4 turns." },
  { key: 'arcaneRitual',label: "Arcane Ritual", mult: 1.40, desc: "~40% damage buff to magic/holy/fire/nature/ice/dark moves for 5 turns." },
];
let overheatStacks = 1; // 1-10: Overheat stacks (+8% dmg each)
const enchantCondActive = { cursed: false, inferno: false, midasProc: false, reaperProc: false };
let enchantReaperEnemyHp = 100; // 0-100: enemy HP% for Reaper proc damage calc
let crusherStacks = 1; // 1-3: Crusher buff stacks (+7% each)
let coagNailStacks = 1; // 1-10: Coagulated Finger Nail turns (+1.5 to all base stats per stack)
let oppressionCount = 1; // 1-5: unique status effects on target for Oppression (+5% each)
let shatteringDebuffCount = 1; // debuffs on target for Shattering
let reversingDebuffCount  = 1; // debuffs on self for Reversing
const shardToggleActive = { striking: false, executing: false };
let selectedBoss = null;
let bossCorrupted = false;

const BOSS_DATA = {
  "Yar'Thul, The Blazing Dragon": {
    hp: 1200,
    hpVariants: { "Corrupted": 1800 },
    res: { Physical: 0.85, Fire: 0.50, Hex: 1.10 },
  },
  "Thorian, The Rotten": {
    hp: 2600,
    hpVariants: { "Corrupted": 3900 },
    res: { Dark: 0.70, Physical: 0.70, Hex: 0.70, Poison: 0.75, Nature: 0.90, Fire: 1.10, Holy: 1.35 },
  },
  "Seraphon": {
    hp: 4500,
    hpVariants: { "Corrupted": 6750 },
    res: { Physical: 0.80, Holy: 0.90, Dark: 1.20 },
  },
  "Arkhaia": {
    hp: 7000,
    hpVariants: { "Corrupted": 10500 },
    res: { Dark: 0.80, Physical: 0.80, Holy: 1.20 },
  },
  "Metrom's Vessel": {
    hp: 10000,
    hpVariants: { "Corrupted": 15000 },
    res: { Hex: 0.90, Dark: 0.90, Nature: 1.10, Holy: 1.20 },
  },
  "Pterathanaian": {
    hp: 2500,
    hpVariants: { "Corrupted": 3750 },
    res: { Hex: 0.75, Dark: 0.75, Holy: 1.20, Fire: 1.20, Nature: 1.20 },
  },
  "Handaconda": {
    hp: 9000,
    hpVariants: { "Corrupted": 13500 },
    res: { Physical: 0.50, Magic: 0.50, Fire: 1.25 },
  },
};

const STAT_LABEL_MAP = { STR: "str", ARC: "arc", END: "end", SPD: "spd", LCK: "lck" };

// Parses a move scaling string (e.g. "STR/75 + ARC/100") into a structured array.
// Returns [{ stat, scaling, label }, ...], or null if the string is missing or unparseable.
// Strings containing "?", "*", or "%" are treated as unknown and return null.
function parseScaling(scalingStr) {
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

// Returns the fully-calculated total for a given stat key (e.g. "str", "arc"),
// combining allocated points, race base, level bonus, armour, mastery, gear,
// and innate percentage multipliers — the same value used in damage formulas.
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
  const crystalBonus = statKey === "lck" ? crystalStarStacks * 10 : 0;
  // Combined pct: innate (str/arc +15%) + armour stat pct. Applied only to (invested + race base + level bonus).
  const INNATE_PCT = { str: 15, arc: 15 };
  const armourStatPct = (armourData.pct || {})[statKey] ?? 0;
  const totalStatPct  = (INNATE_PCT[statKey] ?? 0) + armourStatPct;
  const pctBase   = allocated + (raceBase[statKey] ?? 0) + lvlBonus;
  const otherFlat = (armourData[statKey] ?? 0) + (masteryStats[statKey] ?? 0) + (gearBonuses[statKey] ?? 0) + crystalBonus;
  let total = Math.round(pctBase * (1 + totalStatPct / 100)) + otherFlat;
  if (hasGearEquipped("Coagulated Finger Nail") && dmgBonusActive["passive:Coagulated Finger Nail"]) {
    total += coagNailStacks * 1.5;
  }
  if (permuthStat === statKey && markPicker.value === 'Venia') total = Math.round(total * 1.4);
  if (statKey === "spd") {
    const spdPct = ((statBuffsActive.rallyingSpd || teamBuffsActive.rallying) ? 25 : 0) + (statBuffsActive.empPierceSpd ? 25 : 0);
    const spdFlat = (statBuffsActive.flourishSpd ? _flourishSpdAmt : 0)
                  + (statBuffsActive.focusStepSpd ? Math.max(1, +lvlInput.value || 1) * 2 : 0);
    if (spdPct || spdFlat) total = Math.round(total * (1 + spdPct / 100)) + spdFlat;
  }
  return total;
}

function recalcOpenDetails() {
  document.querySelectorAll(".dc-detail").forEach(detail => {
    if (detail.style.display === "none") return;
    const rowEl = detail.previousElementSibling;
    if (!rowEl) return;
    const idx = rowEl.dataset.idx;
    if (idx === undefined) return;
    // Close then reopen to recalculate
    detail.style.display = "none";
    rowEl.classList.remove("dc-row-open");
    toggleDmgDetail(rowEl, +idx);
  });
}

function getCritDmgMult() {
  const el = document.getElementById("crit-dmg-pct");
  const v = el ? parseFloat(el.textContent) : NaN;
  return isNaN(v) ? null : v;
}

function getCritChancePct() {
  const el = document.getElementById("crit-chance-pct");
  if (!el) return null;
  const v = parseFloat(el.textContent);
  return isNaN(v) ? null : Math.max(0, v);
}

// Returns overcrit tiers (0 = no overcrit, 1 = orange, 2 = red, ...)
// and the overflow chance for the next tier.
function getOvercritInfo() {
  const cc = getCritChancePct();
  if (cc === null || cc <= 100) return null;
  const tier     = Math.floor(cc / 100);     // guaranteed exponent level (1 = normal, 2 = orange...)
  const overflow = cc % 100;                  // % chance of going one tier higher
  return { tier, overflow, cc };
}

function buildOvercritLines(finalDmg, critMult, ccOverride = null) {
  if (critMult === null) return '';
  let info;
  if (ccOverride !== null) {
    if (ccOverride <= 100) return '';
    const cc = ccOverride;
    info = { cc, tier: Math.floor(cc / 100), overflow: cc % 100 };
  } else {
    info = getOvercritInfo();
    if (!info) return '';
  }
  let out = '';
  const orangeMult = Math.pow(critMult, 2);
  const orangeLabel = info.tier >= 2 ? 'guaranteed' : `${Math.round(info.overflow)}% chance`;
  out += `<br><span class="dc-overcrit-line dc-overcrit-orange">🟠 Orange crit [${orangeLabel}] (×${critMult.toFixed(2)}²): <b>${(finalDmg * orangeMult).toFixed(1)}</b></span>`;
  if (info.cc > 200) {
    const redMult = Math.pow(critMult, 3);
    const redLabel = info.tier >= 3 ? 'guaranteed' : `${Math.round(info.overflow)}% chance`;
    out += `<br><span class="dc-overcrit-line dc-overcrit-red">🔴 Red crit [${redLabel}] (×${critMult.toFixed(2)}³): <b>${(finalDmg * redMult).toFixed(1)}</b></span>`;
  }
  if (info.cc > 300) {
    const purpleMult = Math.pow(critMult, 4);
    const purpleLabel = info.tier >= 4 ? 'guaranteed' : `${Math.round(info.overflow)}% chance`;
    out += `<br><span class="dc-overcrit-line dc-overcrit-purple">🟣 Purple crit [${purpleLabel}] (×${critMult.toFixed(2)}⁴): <b>${(finalDmg * purpleMult).toFixed(1)}</b></span>`;
  }
  return out;
}

// Expected total damage for a multi-hit move using binomial expectation:
//   E[dmg] = totalDmg × (1 + p × (critMult − 1))
// where p = crit chance fraction. Requires Crystal Sphere (no crit fatigue).
function getExpectedMultiHitDmg(totalDmg, critMult, critChancePct) {
  const p = critChancePct / 100;
  return totalDmg * (1 + p * (critMult - 1));
}

function getArmourDmgTypePct(_moveType) {
  // Armour stat pcts (str/arc/spd) are now applied as stat multipliers in getTotalStat.
  return 0;
}

function getEffectiveMoveType(moveType) {
  if (moveType === 'Physical' && hasGearEquipped('Wicked Crown')) return 'Dark';
  return moveType;
}

function getShardOfBlightMult(effectiveMoveType) {
  if (effectiveMoveType !== 'Dark') return 1;
  return hasGearEquipped('Shard of Blight') ? 1.25 : 1;
}

// Returns true if the move's effect text describes applying a status effect to the target.
function moveAppliesStatusEffect(m) {
  const text = m.effect || '';
  return /\b(?:apply|applies|inflict|inflicts|applying)\b[^.]*?\b(?:bleed|blind|poison|vulnerable|hex|weakened|cursed|crippled|burn|cold|sundered|fractured|ghostflame|stun(?:ned)?|karma|overheat|plague|inferno)\b/i.test(text)
    || /\bguaranteed[^.]*?\b(?:poison|bleed|blind|vulnerable|hex|weakened|cursed|crippled|burn|cold)\b/i.test(text)
    || /\bchance to (?:apply|inflict)\b/i.test(text);
}

function toggleDmgDetail(rowEl, idx) {
  const detail = rowEl.nextElementSibling;
  if (!detail || !detail.classList.contains("dc-detail")) return;
  if (detail.style.display !== "none") { detail.style.display = "none"; rowEl.classList.remove("dc-row-open"); return; }

  const m = dmgCalcMoveList[idx];
  const scalings = parseScaling(m.scaling);

  // Move-specific crit chance bonus (e.g. Dark Smite +25%, or +50% with Dark Smite Proficiency lm2)
  const moveCritBonus = (() => {
    if (!m.critBonus) return 0;
    if (m.name === "Dark Smite" && superPicker.value === "Darkwraith (Ch)" && masteryState["lm2"]) return 50;
    return m.critBonus;
  })();
  const getMoveCritChancePct = () => { const b = getCritChancePct(); return b !== null ? b + moveCritBonus : null; };

  // Parse base damage — handle "6x2" style
  let baseDmgNum = null;
  let hitCount = 1;
  if (m.damage !== undefined) {
    const dmgStr = String(m.damage);
    const multiHit = dmgStr.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+)$/i);
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

  function buildBonusTag(activeMult, energyMult) {
    if (activeMult > 1 && energyMult > 1)
      return `[×${activeMult.toFixed(2)} bonus, ×${energyMult.toFixed(2)} energy (${energyCount}E)]`;
    if (energyMult > 1)
      return `[×${energyMult.toFixed(2)} energy (${energyCount}E)]`;
    return `[×${activeMult.toFixed(2)} bonus]`;
  }

  if (!scalings) {
    const effectiveMoveType = getEffectiveMoveType(m.moveType);
    const activeMult        = getActiveDmgMult(effectiveMoveType);
    const energyBonus       = getEnergyBonusPct(m);
    const armourDmgPct      = getArmourDmgTypePct(effectiveMoveType);
    const darkMult          = getShardOfBlightMult(effectiveMoveType);
    const blizzardMult      = getBlizzardMult(effectiveMoveType);
    const enchantMult       = getEnchantMult();
    const energyMult        = 1 + energyBonus / 100;
    const armourMult        = 1 + armourDmgPct / 100;
    const totalMult         = activeMult * energyMult * armourMult * darkMult * blizzardMult * enchantMult;
    const typeTag           = effectiveMoveType !== m.moveType ? `<span class="dc-bonus-tag">[Physical → Dark]</span> ` : '';
    let formula; let currentDmg;
    if (totalMult > 1) {
      const boosted = baseDmgNum * totalMult;
      currentDmg = hitCount > 1 ? boosted * hitCount : boosted;
      formula = `${typeTag}${baseDmgNum} × ${totalMult.toFixed(2)} <span class="dc-bonus-tag">${buildBonusTag(activeMult * armourMult * darkMult, energyMult)}</span> = <b>${boosted.toFixed(1)}</b>`;
      if (hitCount > 1) formula += ` × ${hitCount} hits = <b>${currentDmg.toFixed(1)}</b>`;
    } else {
      currentDmg = hitCount > 1 ? baseDmgNum * hitCount : baseDmgNum;
      formula = hitCount > 1
        ? `${baseDmgNum} × ${hitCount} hits = <b>${currentDmg}</b>`
        : `Base damage: <b>${baseDmgNum}</b>`;
    }
    const { mult: sMult, label: sLabel } = getStatusMultiplier(m.moveType);
    if (sMult !== 1) formula += ` × ${sMult.toFixed(2)} <span class="dc-bonus-tag">[${sLabel}]</span> = <b>${(currentDmg * sMult).toFixed(1)}</b>`;
    const _finalDmg0 = sMult !== 1 ? currentDmg * sMult : currentDmg;
    const { mult: bMult0, label: bLabel0 } = getBossResMult(effectiveMoveType);
    if (bMult0 !== 1) formula += ` × ${bMult0.toFixed(2)} <span class="dc-bonus-tag">[${bLabel0}]</span> = <b>${(_finalDmg0 * bMult0).toFixed(1)}</b>`;
    else if (selectedBoss) formula += ` <span class="dc-bonus-tag" style="color:#555">[neutral vs boss]</span>`;
    const _resFinalDmg0 = _finalDmg0 * bMult0;
    const _critMult0 = getCritDmgMult();
    if (hitCount > 1) {
      const _avgHit0 = _resFinalDmg0 / hitCount;
      formula += `<br><span class="dc-avg-line">Avg per hit: <b>${_avgHit0.toFixed(1)}</b>`;
      if (_critMult0 !== null) formula += ` &nbsp;|&nbsp; Crit avg: <b style="color:#ff4444">${(_avgHit0 * _critMult0).toFixed(1)}</b>`;
      formula += `</span>`;
    }
    if (moveCritBonus > 0 && _critMult0 !== null) formula += `<br><span class="dc-avg-line" style="color:#ffcc44">Move crit bonus: +${moveCritBonus}%</span>`;
    if (_critMult0 !== null) formula += `<br><span class="dc-crit-line">All crits: <b>${_resFinalDmg0.toFixed(1)}</b> × ${_critMult0.toFixed(2)}x = <b>${(_resFinalDmg0 * _critMult0).toFixed(1)}</b></span>`;
    formula += buildOvercritLines(_resFinalDmg0, _critMult0, getMoveCritChancePct());
    if (hitCount > 1 && _critMult0 !== null) {
      const _cc0 = getMoveCritChancePct();
      if (_cc0 !== null) {
        const _exp0 = getExpectedMultiHitDmg(_resFinalDmg0, _critMult0, _cc0);
        formula += `<br><span class="dc-expected-line">Expected <span class="dc-expected-note">(${_cc0.toFixed(0)}% crit, binomial)</span>: <b style="color:#66ddaa">${_exp0.toFixed(1)}</b></span>`;
      }
    }
    if (hasGearEquipped("DeathBeak Dagger") && _critMult0 !== null) {
      const _beakCoef0 = moveAppliesStatusEffect(m) ? 0.25 : 0.15;
      const _beakDmgPer0 = baseDmgNum * _critMult0 * _beakCoef0 * enchantMult;
      if (hitCount === 1) {
        const _critDmg0 = _resFinalDmg0 * _critMult0;
        formula += `<br><span class="dc-beak-line">Crit + Beak: ${_critDmg0.toFixed(1)} + ${_beakDmgPer0.toFixed(1)} = <b>${(_critDmg0 + _beakDmgPer0).toFixed(1)}</b></span>`;
      } else {
        const _cc0b = getMoveCritChancePct();
        if (_cc0b !== null) {
          const _exp0b = getExpectedMultiHitDmg(_resFinalDmg0, _critMult0, _cc0b);
          const _eCrits0 = hitCount * (_cc0b / 100);
          formula += `<br><span class="dc-beak-line">+ Beak (${_eCrits0.toFixed(1)} exp. crits × ${_beakDmgPer0.toFixed(1)}): <b>${(_exp0b + _eCrits0 * _beakDmgPer0).toFixed(1)}</b></span>`;
        }
      }
    }
    detail.innerHTML = `<div class="dc-calc">${formula}</div>`;
    detail.style.display = "block"; rowEl.classList.add("dc-row-open"); return;
  }

  // Full formula: BaseDMG(1 + stat1/scl1 + stat2/scl2 ...)
  // Flowing Dance Proficiency (Blade Dancer rm2): override scaling to SPD/50
  let _activeScalings = scalings;
  if (m.name === "Flowing Dance" && masteryState["rm2"] && superPicker.value === "Blade Dancer (N)") {
    _activeScalings = [{ stat: "spd", scaling: 50, label: "SPD" }];
  }
  const statParts = _activeScalings.map(({ stat, scaling, label }) => {
    const val = getTotalStat(stat);
    return { label, val, scaling, contrib: val / scaling };
  });
  const totalContrib = statParts.reduce((sum, p) => sum + p.contrib, 0);
  const dmgPerHit = baseDmgNum * (1 + totalContrib);
  const totalDmg  = dmgPerHit * hitCount;

  const effectiveMoveType = getEffectiveMoveType(m.moveType);
  const activeMult        = getActiveDmgMult(effectiveMoveType);
  const energyBonus       = getEnergyBonusPct(m);
  const armourDmgPct      = getArmourDmgTypePct(effectiveMoveType);
  const darkMult          = getShardOfBlightMult(effectiveMoveType);
  const blizzardMult      = getBlizzardMult(effectiveMoveType);
  const enchantMult       = getEnchantMult();
  const energyMult        = 1 + energyBonus / 100;
  const armourMult        = 1 + armourDmgPct / 100;
  const totalMult         = activeMult * energyMult * armourMult * darkMult * blizzardMult * enchantMult;
  const typeTag           = effectiveMoveType !== m.moveType ? `<span class="dc-bonus-tag">[Physical → Dark]</span> ` : '';
  const scalingStr        = statParts.map(p => `${p.label}(${p.val})/${p.scaling}`).join(" + ");
  let formula = `${typeTag}${baseDmgNum}(1 + ${scalingStr}) = <b>${dmgPerHit.toFixed(1)}</b>`;

  // Discharge Proficiency (Lancer cm2): 4 hits [1.0, 0.38, 1/3, 1/3]
  if (m.name === "Discharge" && masteryState["cm2"] && superPicker.value === "Lancer (N)") {
    const _dMults = [1.0, 0.38, 1/3, 1/3];
    const _dLabels = ["Full", "38%", "33%", "33%"];
    const _dBase = totalMult > 1 ? dmgPerHit * totalMult : dmgPerHit;
    if (totalMult > 1) formula += ` × ${totalMult.toFixed(2)} <span class="dc-bonus-tag">${buildBonusTag(activeMult * armourMult * darkMult, energyMult)}</span> = <b>${_dBase.toFixed(1)}</b>`;
    const _dHitStrs = _dMults.map((r, i) => `${_dLabels[i]}: <b>${(_dBase * r).toFixed(1)}</b>`);
    const _dTotal = _dMults.reduce((s, r) => s + _dBase * r, 0);
    formula += `<br><span class="dc-avg-line">4 hits — ${_dHitStrs.join(' | ')} = <b>${_dTotal.toFixed(1)}</b></span>`;
    const { mult: _dsMult, label: _dsLabel } = getStatusMultiplier(m.moveType);
    const _dCurDmg = _dsMult !== 1 ? _dTotal * _dsMult : _dTotal;
    if (_dsMult !== 1) formula += ` × ${_dsMult.toFixed(2)} <span class="dc-bonus-tag">[${_dsLabel}]</span> = <b>${_dCurDmg.toFixed(1)}</b>`;
    const { mult: _dbMult, label: _dbLabel } = getBossResMult(effectiveMoveType);
    if (_dbMult !== 1) formula += ` × ${_dbMult.toFixed(2)} <span class="dc-bonus-tag">[${_dbLabel}]</span> = <b>${(_dCurDmg * _dbMult).toFixed(1)}</b>`;
    else if (selectedBoss) formula += ` <span class="dc-bonus-tag" style="color:#555">[neutral vs boss]</span>`;
    const _dResFinal = _dCurDmg * _dbMult;
    const _dCritMult = getCritDmgMult();
    if (_dCritMult !== null) {
      if (moveCritBonus > 0) formula += `<br><span class="dc-avg-line" style="color:#ffcc44">Move crit bonus: +${moveCritBonus}%</span>`;
      formula += `<br><span class="dc-crit-line">All crits: <b>${_dResFinal.toFixed(1)}</b> × ${_dCritMult.toFixed(2)}x = <b>${(_dResFinal * _dCritMult).toFixed(1)}</b></span>`;
      formula += buildOvercritLines(_dResFinal, _dCritMult, getMoveCritChancePct());
      const _dCc = getMoveCritChancePct();
      if (_dCc !== null) {
        const _dExp = getExpectedMultiHitDmg(_dResFinal, _dCritMult, _dCc);
        formula += `<br><span class="dc-expected-line">Expected <span class="dc-expected-note">(${_dCc.toFixed(0)}% crit, binomial)</span>: <b style="color:#66ddaa">${_dExp.toFixed(1)}</b></span>`;
      }
    }
    detail.innerHTML = `<div class="dc-calc">${formula}</div>`;
    detail.style.display = "block"; rowEl.classList.add("dc-row-open"); return;
  }

  let currentDmg;
  if (totalMult > 1) {
    const boosted = dmgPerHit * totalMult;
    formula += ` × ${totalMult.toFixed(2)} <span class="dc-bonus-tag">${buildBonusTag(activeMult * armourMult * darkMult, energyMult)}</span> = <b>${boosted.toFixed(1)}</b>`;
    currentDmg = hitCount > 1 ? boosted * hitCount : boosted;
    if (hitCount > 1) formula += ` × ${hitCount} hits = <b>${currentDmg.toFixed(1)}</b>`;
  } else if (hitCount > 1) {
    currentDmg = totalDmg;
    formula += ` × ${hitCount} hits = <b>${totalDmg.toFixed(1)}</b>`;
  } else {
    currentDmg = dmgPerHit;
  }
  const { mult: sMult, label: sLabel } = getStatusMultiplier(m.moveType);
  if (sMult !== 1) formula += ` × ${sMult.toFixed(2)} <span class="dc-bonus-tag">[${sLabel}]</span> = <b>${(currentDmg * sMult).toFixed(1)}</b>`;
  const _finalDmg = sMult !== 1 ? currentDmg * sMult : currentDmg;
  const { mult: bMult, label: bLabel } = getBossResMult(effectiveMoveType);
  if (bMult !== 1) formula += ` × ${bMult.toFixed(2)} <span class="dc-bonus-tag">[${bLabel}]</span> = <b>${(_finalDmg * bMult).toFixed(1)}</b>`;
  else if (selectedBoss) formula += ` <span class="dc-bonus-tag" style="color:#555">[neutral vs boss]</span>`;
  const _resFinalDmg = _finalDmg * bMult;
  const _critMult = getCritDmgMult();
  if (hitCount > 1) {
    const _avgHit = _resFinalDmg / hitCount;
    formula += `<br><span class="dc-avg-line">Avg per hit: <b>${_avgHit.toFixed(1)}</b>`;
    if (_critMult !== null) formula += ` &nbsp;|&nbsp; Crit avg: <b style="color:#ff4444">${(_avgHit * _critMult).toFixed(1)}</b>`;
    formula += `</span>`;
  }
  if (moveCritBonus > 0 && _critMult !== null) formula += `<br><span class="dc-avg-line" style="color:#ffcc44">Move crit bonus: +${moveCritBonus}%</span>`;
  if (_critMult !== null) formula += `<br><span class="dc-crit-line">All crits: <b>${_resFinalDmg.toFixed(1)}</b> × ${_critMult.toFixed(2)}x = <b>${(_resFinalDmg * _critMult).toFixed(1)}</b></span>`;
  formula += buildOvercritLines(_resFinalDmg, _critMult, getMoveCritChancePct());
  if (hitCount > 1 && _critMult !== null) {
    const _cc = getMoveCritChancePct();
    if (_cc !== null) {
      const _exp = getExpectedMultiHitDmg(_resFinalDmg, _critMult, _cc);
      formula += `<br><span class="dc-expected-line">Expected <span class="dc-expected-note">(${_cc.toFixed(0)}% crit, binomial)</span>: <b style="color:#66ddaa">${_exp.toFixed(1)}</b></span>`;
    }
  }
  if (hasGearEquipped("DeathBeak Dagger") && _critMult !== null) {
    const _beakCoef = moveAppliesStatusEffect(m) ? 0.25 : 0.15;
    const _beakDmgPer = baseDmgNum * _critMult * _beakCoef * enchantMult;
    if (hitCount === 1) {
      const _critDmg = _resFinalDmg * _critMult;
      formula += `<br><span class="dc-beak-line">Crit + Beak: ${_critDmg.toFixed(1)} + ${_beakDmgPer.toFixed(1)} = <b>${(_critDmg + _beakDmgPer).toFixed(1)}</b></span>`;
    } else {
      const _ccB = getMoveCritChancePct();
      if (_ccB !== null) {
        const _expB = getExpectedMultiHitDmg(_resFinalDmg, _critMult, _ccB);
        const _eCrits = hitCount * (_ccB / 100);
        formula += `<br><span class="dc-beak-line">+ Beak (${_eCrits.toFixed(1)} exp. crits × ${_beakDmgPer.toFixed(1)}): <b>${(_expB + _eCrits * _beakDmgPer).toFixed(1)}</b></span>`;
      }
    }
  }

  detail.innerHTML = `<div class="dc-calc">${formula}</div>`;
  detail.style.display = "block"; rowEl.classList.add("dc-row-open");
}

// § DMGCALC UI
// Collects damage bonus passives from all equipped moves, then renders the
// interactive toggle/slider panel in the Dmg Calculator tab.
let dmgBonusPassives = [];
const dmgBonusActive = {};

function parseDmgBonus(text) {
  if (!text) return null;
  // Exclude damage bonuses that apply only to DoT (poison/bleed/burn ticks, not hits)
  if (/\bfor\s+do[t]\b|\bdo[t]\s+(?:effects?|damage)\b|\bdamage\s+over\s+time\b/i.test(text)) return null;
  // Exclude per-energy bonuses (Corealloy, Lightning Crash) — handled separately by energy system
  if (/\bper\s+energy\b/i.test(text)) return null;
  if (/\bfor\s+each\s+energy\s+consumed\b/i.test(text)) return null;
  // Exclude damage reduction (defensive effect, not a dmg buff)
  if (/\bdamage\s+reduction\b/i.test(text)) return null;
  // Exclude "more damage to you" — enemy deals more to the player, not a player dmg buff
  if (/\bmore\s+damage\s+to\s+you\b/i.test(text)) return null;
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
  // Multiplier format: "Deals 1.25x damage" → 25% bonus
  const mxPat = text.match(/deals?\s+(\d+(?:\.\d+)?)\s*[x×]\s*(?:more\s+)?damage/i);
  if (mxPat) return Math.round((+mxPat[1] - 1) * 100);
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

  // Boreas Frost Stacks — manually added (bypasses Damage Reduction exclusion in parseDmgBonus)
  if (raceName === "Boreas (1%)") {
    const fsKey = "passive:Frost Stacks";
    if (!seen.has(fsKey)) {
      seen.add(fsKey);
      rawEntries.push({ key: fsKey, name: "Frost Stacks", bonus: 20, kind: "passive", desc: "Each Ice move grants 1 stack (20% dmg + 10% DR). Max 10 stacks = 200% dmg." });
    }
  }

  // Spirit Awakening — manually added (bypasses Damage Reduction exclusion in parseDmgBonus)
  if (raceName === "Vastayan (9%)") {
    const saKey = "buff:Spirit Awakening";
    if (!seen.has(saKey)) {
      seen.add(saKey);
      rawEntries.push({ key: saKey, name: "Spirit Awakening", bonus: 15, kind: "buff", desc: "Grants the user a 15% buff to all stats for 4 turns. (50% summon damage buff in Summon Buffs section)" });
    }
  }

  // Rending Barrage Proficiency (Impaler lm2) — per-bleed-stack scaling, bypasses parseDmgBonus
  if (superClass === "Impaler (Ch)" && masteryState["lm2"]) {
    const rbKey = "mastery:Rending Barrage Proficiency";
    if (!seen.has(rbKey)) {
      seen.add(rbKey);
      rawEntries.push({ key: rbKey, name: "Rending Barrage Proficiency", bonus: 2.5, kind: "mastery", desc: "+2.5% dmg per combined bleed stack (yours + target), up to 25% at 10 stacks." });
    }
  }

  // Metrom's Grasp — show in dmg bonus when equipped (bypasses DoT filter)
  if (lostScrollName === "Metrom's Grasp") {
    const mgKey = "scroll-mg:Metrom's Grasp";
    if (!seen.has(mgKey)) {
      seen.add(mgKey);
      rawEntries.push({ key: mgKey, name: "Metrom's Grasp", bonus: 40, kind: "buff", desc: "Grants 40% more damage for DoT effects over 5 turns." });
    }
  }

  // Coagulated Finger Nail — manually added (stat buff per turn, handled via getTotalStat)
  if (gearSlots.includes("Coagulated Finger Nail")) {
    const cnKey = "passive:Coagulated Finger Nail";
    if (!seen.has(cnKey)) {
      seen.add(cnKey);
      rawEntries.push({ key: cnKey, name: "Coagulated Finger Nail", bonus: coagNailStacks * 1.5, kind: "passive", desc: `+${(coagNailStacks * 1.5).toFixed(1)} to all base stats per stack (max 10 stacks = +15).`, isCoagNail: true });
    }
  }

  // Shards — passive-dmg and conditional with DR applied
  getShardBonusEntries().forEach(entry => {
    const { name, drMult, rawVal, bonusType } = entry;
    if (bonusType === 'energy-chance' || bonusType === 'lifesteal') return;
    if (rawVal === null) return;
    const key = `shard:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const drTag = drMult < 1 ? ' (DR 25%)' : '';
    // For per-debuff types, store rawVal per debuff; actual total computed in getActiveDmgBonus
    rawEntries.push({ key, name: name + drTag, bonus: rawVal * drMult, kind: 'shard', bonusType, drMult, perDebuffVal: rawVal * drMult });
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
          ex.bonus = Math.max(ex.bonus, e.bonus); // keep higher value — mastery should never reduce
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
      const entry = {
        key:   e.key,
        name:  displayName,
        bonus: e.bonus,
        kinds: [e.kind],
        descs: [{ kind: e.kind, text: e.desc }],
      };
      // Standalone mastery proficiency (no base entry to merge with)
      if (baseName !== null) entry.isProficiency = true;
      // Preserve shard-specific fields so getActiveDmgBonus can use them
      if (e.bonusType !== undefined) entry.bonusType = e.bonusType;
      if (e.perDebuffVal !== undefined) entry.perDebuffVal = e.perDebuffVal;
      if (e.drMult !== undefined) entry.drMult = e.drMult;
      merged.push(entry);
    }
  });

  // Nature's Wrath (Ranger (Or) lm1): doubles Verdant Archer bonus from 7.5% to 15%
  const _rangerActive = superClass === "Ranger (Or)" || baseClass === "Ranger (Or)";
  if (_rangerActive && masteryState["lm1"]) {
    const vaEntry = merged.find(e => e.name === "Verdant Archer");
    if (vaEntry) vaEntry.bonus = 15;
  }

  return merged;
}

function getActiveDmgMult(moveType = null) {
  // Passives that only apply to specific move types
  const _affinityRestricted = {
    "Affinity Mastery":  ["Holy", "Magic"],
    "Affinity Boost":    ["Magic", "Hex"],
    "Magically Charged": ["Fire", "Magic"],
    "Cast Amplify":      ["Magic", "Holy", "Fire", "Nature", "Ice", "Dark"],
    "Elemental Master":  ["Fire", "Magic", "Nature", "Dark"],
    "Forest Charm":      ["Nature"],
  };
  let mult = 1;
  dmgBonusPassives.filter(p => dmgBonusActive[p.key]).forEach(p => {
    let bonus = null;
    if      (p.name === "Rage Empower")          bonus = 30 + rageEmpHpConsumed;
    else if (p.name === "Bloody Berserker")      bonus = 100 - bloodyBersHp;
    else if (p.name === "Absolute Radiance")     bonus = ABS_RAD_BONUSES[absRadTurn - 1];
    else if (p.name === "Bulk Up")               { mult *= (1 + 0.20 * bulkUpStacks); return; }
    else if (p.name === "Frost Stacks")          { mult *= Math.pow(1.20, boreasStacks); return; }
    else if (p.name === "Unending Flow")               { mult *= (1 + 0.05 * unendingFlowStacks); return; }
    else if (p.name === "Rending Barrage Proficiency") { bonus = 2.5 * rendingBarrageStacks; }
    else if (p.name === "Demonic Presence")            { bonus = 5 * demonicPresenceStacks; }
    else if (p.name === "Ramizcan Idol")         { mult *= (1 + 0.15 * ramiIdolStacks); return; }
    else if (p.name === "Vainglorious Locket")   { bonus = Math.max(0, 10 - 5 * (vaingLocketTurn - 1)); if (!bonus) return; }
    else if (p.name === "Flaming Overdrive")     bonus = flamingOverdriveStacks;
    else if (p.name === "Spirit Awakening")     bonus = 15; // 15% to all stats → ~15% dmg; 50% summon buff handled separately
    else if (p.name === "Sands Of Time")         { mult *= Math.pow(1.20, hourglassStacks); return; }
    else if (p.name === "Crusher")               { mult *= Math.pow(1.07, crusherStacks); return; }
    else if (p.name === "Oppression")            { mult *= Math.pow(1.05, oppressionCount); return; }
    else if (p.bonusType === 'per-debuff-target') bonus = p.perDebuffVal * shatteringDebuffCount;
    else if (p.bonusType === 'per-debuff-self')   bonus = p.perDebuffVal * reversingDebuffCount;
    else if (p.bonusType === 'conditional-hp-above') { if (shardToggleActive.striking)  bonus = p.bonus; else return; }
    else if (p.bonusType === 'conditional-hp-below') { if (shardToggleActive.executing) bonus = p.bonus; else return; }
    else {
      const _restr = _affinityRestricted[p.name];
      if (_restr && moveType && !_restr.includes(moveType)) return;
      bonus = p.bonus;
    }
    if (bonus !== null) mult *= (1 + bonus / 100);
  });
  if (statusEffectsActive.overheat) mult *= Math.pow(1.08, overheatStacks);
  const _amplifyTypes = ["Magic", "Holy", "Fire", "Nature", "Ice", "Dark"];
  TEAM_BUFFS.forEach(b => {
    if (!teamBuffsActive[b.key]) return;
    if (b.key === 'blizzard') return; // handled per-move in getBlizzardMult()
    if ((b.key === 'castAmplify' || b.key === 'arcaneRitual') && moveType && !_amplifyTypes.includes(moveType)) return;
    mult *= b.mult;
  });
  if (summonBuffsActive.spiritAwakening) mult *= 1.50;
  // Sinister Gaze: enemy received your Bulk Up defense debuff → they take more damage (multiplicative)
  if (sinisterGazeReflect) {
    const bulkUpOn = dmgBonusPassives.some(p => p.name === "Bulk Up" && dmgBonusActive[p.key]);
    if (bulkUpOn) mult *= Math.pow(1.20, bulkUpStacks);
  }
  return mult;
}

function getBlizzardMult(effectiveMoveType) {
  return (teamBuffsActive.blizzard && effectiveMoveType === 'Ice') ? 1.20 : 1;
}

function getEnchantMult() {
  const ench = enchantPicker.value;
  if (ench === 'Cursed'  && enchantCondActive.cursed)    return 1.30;
  if (ench === 'Inferno' && enchantCondActive.inferno)   return 1.20;
  if (ench === 'Midas'   && enchantCondActive.midasProc) return 1.15;
  if (ench === 'Reaper'  && enchantCondActive.reaperProc) return 1 + 0.25 * enchantReaperEnemyHp / 100;
  return 1;
}

function toggleTeamBuff(key) {
  teamBuffsActive[key] = !teamBuffsActive[key];
  renderDmgBonusSection(); recalcOpenDetails();
  updatePecents();
}

function toggleStatBuff(key) {
  statBuffsActive[key] = !statBuffsActive[key];
  renderDmgBonusSection(); recalcOpenDetails();
  updatePecents();
}

function changeRamiIdolStacks(delta) {
  ramiIdolStacks = Math.min(5, Math.max(1, ramiIdolStacks + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeVaingLocketTurn(delta) {
  vaingLocketTurn = Math.min(3, Math.max(1, vaingLocketTurn + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function toggleSinisterGaze() {
  sinisterGazeReflect = !sinisterGazeReflect;
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeUnendingFlowStacks(delta) {
  unendingFlowStacks = Math.min(10, Math.max(1, unendingFlowStacks + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeRendingBarrageStacks(delta) {
  rendingBarrageStacks = Math.min(10, Math.max(1, rendingBarrageStacks + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeDemonicPresenceStacks(delta) {
  demonicPresenceStacks = Math.min(5, Math.max(1, demonicPresenceStacks + delta));
  renderDmgBonusSection(); recalcOpenDetails();
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

// On mobile, mouseleave never fires so the tooltip gets stuck.
// Close it whenever the user taps/clicks anywhere outside it.
document.addEventListener('pointerdown', e => {
  if (!_dcTooltip || _dcTooltip.style.display === 'none') return;
  if (!_dcTooltip.contains(e.target)) hideDcTooltip();
}, { capture: true });

function changeEnergy(delta) {
  energyCount = Math.min(6, Math.max(0, energyCount + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeAbsRadTurn(delta) {
  absRadTurn = Math.min(5, Math.max(1, absRadTurn + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeBulkUpStacks(delta) {
  bulkUpStacks = Math.min(10, Math.max(1, bulkUpStacks + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeBoreasStacks(delta) {
  boreasStacks = Math.min(10, Math.max(1, boreasStacks + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeFlamingOverdriveStacks(delta) {
  flamingOverdriveStacks = Math.min(15, Math.max(0, flamingOverdriveStacks + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeHourglassStacks(delta) {
  hourglassStacks = Math.min(5, Math.max(1, hourglassStacks + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeCoagNailStacks(delta) {
  coagNailStacks = Math.min(10, Math.max(1, coagNailStacks + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function toggleStatusEffect(name) {
  statusEffectsActive[name] = !statusEffectsActive[name];
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeOverheatStacks(delta) {
  overheatStacks = Math.min(10, Math.max(1, overheatStacks + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeCrusherStacks(delta) {
  crusherStacks = Math.min(3, Math.max(1, crusherStacks + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeOppressionCount(delta) {
  oppressionCount = Math.min(5, Math.max(1, oppressionCount + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeShatteringDebuffs(delta) {
  shatteringDebuffCount = Math.min(15, Math.max(1, shatteringDebuffCount + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeReversingDebuffs(delta) {
  reversingDebuffCount = Math.min(10, Math.max(1, reversingDebuffCount + delta));
  renderDmgBonusSection(); recalcOpenDetails();
}

function changeCrystalStarStacks(delta) {
  crystalStarStacks = Math.min(5, Math.max(0, crystalStarStacks + delta));
  renderDmgBonusSection(); recalcOpenDetails();
  updatePecents();
}

function toggleFrozenDiademIce() {
  frozenDiademIceActive = !frozenDiademIceActive;
  renderDmgBonusSection(); recalcOpenDetails();
  updatePecents();
}

function toggleShardCondition(key) {
  shardToggleActive[key] = !shardToggleActive[key];
  renderDmgBonusSection(); recalcOpenDetails();
}

function toggleEnchantCond(key) {
  enchantCondActive[key] = !enchantCondActive[key];
  renderDmgBonusSection(); recalcOpenDetails();
}

function setEnchantReaperHp(val) {
  enchantReaperEnemyHp = +val;
  renderDmgBonusSection(); recalcOpenDetails();
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

function getBossResMult(moveType) {
  if (!selectedBoss) return { mult: 1, label: "" };
  const boss = BOSS_DATA[selectedBoss];
  if (!boss) return { mult: 1, label: "" };
  const mult = boss.res[moveType] ?? 1;
  const resPct = Math.round((1 - mult) * 100);
  return { mult, label: `${resPct}% res` };
}

function setRageEmpHp(val) {
  rageEmpHpConsumed = +val;
  const valEl = document.getElementById("dc-rage-hp-val");
  const pctEl = document.querySelector(".dc-bonus-row[data-rage-emp] .dc-bonus-pct");
  if (valEl) valEl.textContent = val + "%";
  if (pctEl) pctEl.textContent = `+${30 + rageEmpHpConsumed}%`;
  recalcOpenDetails();
}

function setBloodyBersHp(val) {
  bloodyBersHp = +val;
  const valEl = document.getElementById("dc-bloody-bers-hp-val");
  const bonus = 100 - bloodyBersHp;
  const pctEl = document.querySelector(".dc-bonus-row[data-bloody-bers] .dc-bonus-pct");
  if (valEl) valEl.textContent = val + "%";
  if (pctEl) pctEl.textContent = `×${(1 + bonus / 100).toFixed(2)}`;
  recalcOpenDetails();
}

function renderDmgBonusSection() {
  const container = document.getElementById("dmg-bonus-section");
  if (!container) return;

  dmgBonusPassives = collectDmgBonusPassives();

  const hasCrystalStar = ["gear-1","gear-2","gear-3","gear-4"].some(id => document.getElementById(id)?.value === "Crystallized Star");

  // Energy counter — always shown
  let html = `<div class="dc-energy-section">
    <span class="dc-energy-label">Energy</span>
    <div class="dc-energy-counter">
      <button class="dc-energy-btn" onclick="changeEnergy(-1)">−</button>
      <span class="dc-energy-val" id="dc-energy-val">${energyCount}</span>
      <button class="dc-energy-btn" onclick="changeEnergy(1)">+</button>
    </div>
  </div>`;

  if (hasCrystalStar) {
    html += `<div class="dc-energy-section">
      <span class="dc-energy-label">Crystal Star LCK stacks <span style="color:#aaa;font-size:11px">(+10 LCK each)</span></span>
      <div class="dc-energy-counter">
        <button class="dc-energy-btn" onclick="changeCrystalStarStacks(-1)">−</button>
        <span class="dc-energy-val">${crystalStarStacks}</span>
        <button class="dc-energy-btn" onclick="changeCrystalStarStacks(1)">+</button>
      </div>
    </div>`;
  } else if (crystalStarStacks > 0) {
    crystalStarStacks = 0;
  }

  const hasFrozenDiadem = ["gear-1","gear-2","gear-3","gear-4"].some(id => document.getElementById(id)?.value === "Frozen Diadem");
  if (hasFrozenDiadem) {
    html += `<div class="dc-energy-section">
      <span class="dc-energy-label">Target has Cold/Ice <span style="color:#aaa;font-size:11px">(+15% crit chance)</span></span>
      <div class="dc-bonus-check dc-toggle-btn${frozenDiademIceActive ? " dc-bonus-on" : ""}" onclick="toggleFrozenDiademIce()" style="cursor:pointer;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border:1px solid #555;border-radius:3px;">${frozenDiademIceActive ? "✓" : ""}</div>
    </div>`;
  } else if (frozenDiademIceActive) {
    frozenDiademIceActive = false;
    updatePecents();
  }

  if (dmgBonusPassives.length) {
  // Init toggle state for any new passives
  dmgBonusPassives.forEach(p => { if (!(p.key in dmgBonusActive)) dmgBonusActive[p.key] = false; });

  html += `<h3 class="dc-bonus-title">Dmg Bonus</h3>
    <input type="text" id="dmg-bonus-search" class="dc-bonus-search" placeholder="Search..." value="${_dmgBonusFilter.replace(/"/g, "&quot;")}">
    <div class="dc-bonus-list">`;

  function kindBadge(k) {
    if (k === "buff")    return `<span class="dc-bonus-kind dc-bonus-kind-buff">Buff</span>`;
    if (k === "mastery") return `<span class="dc-bonus-kind dc-bonus-kind-mastery">Mastery</span>`;
    if (k === "shard")   return `<span class="dc-bonus-kind dc-bonus-kind-passive">Shard</span>`;
    return `<span class="dc-bonus-kind dc-bonus-kind-passive">Passive</span>`;
  }

  const _nonShardPassives = dmgBonusPassives.filter(p => !p.kinds?.includes('shard'));
  const _shardPassives    = dmgBonusPassives.filter(p =>  p.kinds?.includes('shard'));

  function renderBonusEntry(p, fullIdx) {
    if (_dmgBonusFilter && !p.name.toLowerCase().includes(_dmgBonusFilter)) return;
    // MG passive locked when team buff MG is active
    if (p.key === "scroll-mg:Metrom's Grasp" && teamBuffsActive.mg) {
      const badges = (p.kinds || [p.kind]).map(kindBadge).join("");
      html += `<div class="dc-bonus-row" style="opacity:0.4;cursor:not-allowed" data-mg-locked title="Locked — team buff MG is active">
        <div class="dc-bonus-check"></div>
        <span class="dc-bonus-name">${p.name} <span style="font-size:11px">(team buff active)</span></span>
        <span class="dc-bonus-badges">${badges}</span>
        <span class="dc-bonus-pct">×1.40</span>
      </div>`;
      return;
    }
    const on = dmgBonusActive[p.key];
    const badges = (p.kinds || [p.kind]).map(kindBadge).join("");
    const isBloodyBers   = p.name === "Bloody Berserker";
    const isRageEmp      = p.name === "Rage Empower";
    const isAbsRad       = p.name === "Absolute Radiance";
    const isBulkUp           = p.name === "Bulk Up";
    const isHourglass        = p.name === "Sands Of Time";
    const isOppression       = p.name === "Oppression";
    const isBoreas           = p.name === "Frost Stacks";
    const isCrusher          = p.name === "Crusher";
    const isFlamingOverdrive  = p.name === "Flaming Overdrive";
    const isSpiritAwakening   = p.name === "Spirit Awakening";
    const isRamiIdol          = p.name === "Ramizcan Idol";
    const isVaingLocket       = p.name === "Vainglorious Locket";
    const isStellianCore      = p.name === "Stellian Core";
    const isCoagNail          = p.name === "Coagulated Finger Nail";
    const isUnendingFlow      = p.name === "Unending Flow";
    const isRendingBarrage    = p.name === "Rending Barrage Proficiency";
    const isDemonicPresence   = p.name === "Demonic Presence";
    const displayBonus   = isBloodyBers      ? 100 - bloodyBersHp
                         : isRageEmp         ? 30 + rageEmpHpConsumed
                         : isAbsRad          ? ABS_RAD_BONUSES[absRadTurn - 1]
                         : isHourglass       ? hourglassStacks * 20
                         : isOppression      ? oppressionCount * 5
                         : isCrusher         ? crusherStacks * 7
                         : isBoreas          ? boreasStacks * 20
                         : isFlamingOverdrive? flamingOverdriveStacks
                         : isSpiritAwakening ? 15
                         : isVaingLocket     ? Math.max(0, 10 - 5 * (vaingLocketTurn - 1))
                         : p.bonusType === 'per-debuff-target' ? (p.perDebuffVal ?? p.bonus) * shatteringDebuffCount
                         : p.bonusType === 'per-debuff-self'   ? (p.perDebuffVal ?? p.bonus) * reversingDebuffCount
                         : p.bonus;
    const displayBonusStr = isBulkUp          ? `×${(1 + 0.20 * bulkUpStacks).toFixed(2)}`
                         : isBoreas           ? `×${Math.pow(1.20, boreasStacks).toFixed(2)}`
                         : isHourglass        ? `×${Math.pow(1.20, hourglassStacks).toFixed(2)}`
                         : isOppression       ? `×${Math.pow(1.05, oppressionCount).toFixed(2)}`
                         : isCrusher          ? `×${Math.pow(1.07, crusherStacks).toFixed(2)}`
                         : isRamiIdol         ? `×${(1 + 0.15 * ramiIdolStacks).toFixed(2)}`
                         : isUnendingFlow     ? `×${(1 + 0.05 * unendingFlowStacks).toFixed(2)}`
                         : isRendingBarrage   ? `×${(1 + 0.025 * rendingBarrageStacks).toFixed(3)}`
                         : isDemonicPresence  ? `×${(1 + 0.05 * demonicPresenceStacks).toFixed(2)}`
                         : isCoagNail         ? `+${(coagNailStacks * 1.5).toFixed(1)} stats`
                         : `×${(1 + displayBonus / 100).toFixed(2)}`;
    const profTag = p.isProficiency ? ` <span style="color:#888;font-size:11px">(Prof.)</span>` : '';
    html += `<div class="dc-bonus-row${on ? " dc-bonus-on" : ""}" data-bidx="${fullIdx}"${isRageEmp ? ' data-rage-emp' : ''}${isBloodyBers ? ' data-bloody-bers' : ''}>
      <div class="dc-bonus-check">${on ? "✓" : ""}</div>
      <span class="dc-bonus-name">${p.name}${profTag}</span>
      <span class="dc-bonus-badges">${badges}</span>
      <span class="dc-bonus-pct">${displayBonusStr}</span>
    </div>`;
    if (isStellianCore) {
      html += `<div class="dc-rage-slider-row" style="font-size:11px;color:#aaa;padding:2px 0 4px 24px;">Also grants <span style="color:#e0c97a">+15% Crit chance</span> while active (above 95% HP)</div>`;
    }
    if (isCoagNail) {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Turns / Stacks <span style="color:#aaa;font-size:11px">(max 10 = +15 stats)</span></span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeCoagNailStacks(-1)">−</button>
          <span class="dc-energy-val">${coagNailStacks}</span>
          <button class="dc-energy-btn" onclick="changeCoagNailStacks(1)">+</button>
        </div>
      </div>`;
    }
    if (isRageEmp) {
      html += `<div class="dc-rage-slider-row">
        <span class="dc-rage-slider-label">HP Consumed: <span id="dc-rage-hp-val">${rageEmpHpConsumed}%</span></span>
        <input type="range" class="dc-rage-slider" min="0" max="65" value="${rageEmpHpConsumed}" oninput="setRageEmpHp(this.value)">
        <span class="dc-rage-slider-hint">0% → 65% dmg</span>
      </div>`;
    }
    if (isBloodyBers) {
      html += `<div class="dc-rage-slider-row">
        <span class="dc-rage-slider-label">Current HP: <span id="dc-bloody-bers-hp-val">${bloodyBersHp}%</span></span>
        <input type="range" class="dc-rage-slider" min="1" max="100" value="${bloodyBersHp}" oninput="setBloodyBersHp(this.value)">
        <span class="dc-rage-slider-hint">100% HP → 0% dmg | 1% HP → 99% dmg</span>
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
    if (isBoreas) {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Frost Stacks (max 10)</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeBoreasStacks(-1)">−</button>
          <span class="dc-energy-val">${boreasStacks}</span>
          <button class="dc-energy-btn" onclick="changeBoreasStacks(1)">+</button>
        </div>
      </div>`;
    }
    if (isFlamingOverdrive) {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Burn Stacks on Enemy (max 15)</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeFlamingOverdriveStacks(-1)">−</button>
          <span class="dc-energy-val">${flamingOverdriveStacks}</span>
          <button class="dc-energy-btn" onclick="changeFlamingOverdriveStacks(1)">+</button>
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
    if (isCrusher) {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Stacks (max 3)</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeCrusherStacks(-1)">−</button>
          <span class="dc-energy-val">${crusherStacks}</span>
          <button class="dc-energy-btn" onclick="changeCrusherStacks(1)">+</button>
        </div>
      </div>`;
    }
    if (isRamiIdol) {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Blocks/Parries (max 5)</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeRamiIdolStacks(-1)">−</button>
          <span class="dc-energy-val">${ramiIdolStacks}</span>
          <button class="dc-energy-btn" onclick="changeRamiIdolStacks(1)">+</button>
        </div>
      </div>`;
    }
    if (isVaingLocket) {
      const _vaingBonus = Math.max(0, 10 - 5 * (vaingLocketTurn - 1));
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Turn <span style="color:#aaa;font-size:11px">(+${_vaingBonus}% dmg)</span></span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeVaingLocketTurn(-1)">−</button>
          <span class="dc-energy-val">${vaingLocketTurn}</span>
          <button class="dc-energy-btn" onclick="changeVaingLocketTurn(1)">+</button>
        </div>
      </div>`;
    }
    if (isUnendingFlow) {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Consecutive Hits (max 10)</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeUnendingFlowStacks(-1)">−</button>
          <span class="dc-energy-val">${unendingFlowStacks}</span>
          <button class="dc-energy-btn" onclick="changeUnendingFlowStacks(1)">+</button>
        </div>
      </div>`;
    }
    if (isRendingBarrage) {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Combined Bleed Stacks (max 10)</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeRendingBarrageStacks(-1)">−</button>
          <span class="dc-energy-val">${rendingBarrageStacks}</span>
          <button class="dc-energy-btn" onclick="changeRendingBarrageStacks(1)">+</button>
        </div>
      </div>`;
    }
    if (isDemonicPresence) {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Stacks (max 5)</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeDemonicPresenceStacks(-1)">−</button>
          <span class="dc-energy-val">${demonicPresenceStacks}</span>
          <button class="dc-energy-btn" onclick="changeDemonicPresenceStacks(1)">+</button>
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
    if (p.bonusType === 'per-debuff-target') {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Debuffs on target</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeShatteringDebuffs(-1)">−</button>
          <span class="dc-energy-val">${shatteringDebuffCount}</span>
          <button class="dc-energy-btn" onclick="changeShatteringDebuffs(1)">+</button>
        </div>
      </div>`;
    }
    if (p.bonusType === 'per-debuff-self') {
      html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
        <span class="dc-energy-label">Debuffs on self</span>
        <div class="dc-energy-counter">
          <button class="dc-energy-btn" onclick="changeReversingDebuffs(-1)">−</button>
          <span class="dc-energy-val">${reversingDebuffCount}</span>
          <button class="dc-energy-btn" onclick="changeReversingDebuffs(1)">+</button>
        </div>
      </div>`;
    }
    if (p.bonusType === 'conditional-hp-above') {
      const active = shardToggleActive.striking;
      html += `<div class="dc-bonus-row${active ? " dc-bonus-on" : ""}" data-shard-toggle="striking" style="margin:2px 0 6px 0" title="Toggle: enemy above 80% HP">
        <div class="dc-bonus-check">${active ? "✓" : ""}</div>
        <span class="dc-bonus-name">Enemy &gt; 80% HP</span>
        <span class="dc-bonus-pct">${active ? "ON" : "OFF"}</span>
      </div>`;
    }
    if (p.bonusType === 'conditional-hp-below') {
      const active = shardToggleActive.executing;
      html += `<div class="dc-bonus-row${active ? " dc-bonus-on" : ""}" data-shard-toggle="executing" style="margin:2px 0 6px 0" title="Toggle: enemy below 25% HP">
        <div class="dc-bonus-check">${active ? "✓" : ""}</div>
        <span class="dc-bonus-name">Enemy &lt; 25% HP</span>
        <span class="dc-bonus-pct">${active ? "ON" : "OFF"}</span>
      </div>`;
    }
  }

  _nonShardPassives.forEach((p, i) => renderBonusEntry(p, dmgBonusPassives.indexOf(p)));
  html += `</div>`;

  if (_shardPassives.length) {
    html += `<h3 class="dc-bonus-title" style="margin-top:12px">Shards</h3><div class="dc-bonus-list">`;
    _shardPassives.forEach(p => renderBonusEntry(p, dmgBonusPassives.indexOf(p)));
    html += `</div>`;
  }
  } // end if (dmgBonusPassives.length)

  // --- Status Effects (always shown) ---
  const hasYarthul = ["gear-1","gear-2","gear-3","gear-4"].some(id => document.getElementById(id)?.value === "Yar'thul's Wrath");
  if (!hasYarthul && statusEffectsActive.overheat) { statusEffectsActive.overheat = false; }
  const statusDefs = [
    { key: "vulnerable", label: "Vulnerable",  tag: "×1.20",            desc: "Afflicted unit takes 20% more damage." },
    { key: "hexed",      label: "Hexed",        tag: "×2.00",            desc: "Incoming attack(s) deal double damage, removing one stack per hit." },
    { key: "sundered",   label: "Sundered",     tag: "ignores resist",   desc: "Afflicted unit's incoming attacks ignore resistances." },
    { key: "fractured",  label: "Fractured",    tag: "×1.35 Phys/Magic", desc: "Afflicted unit takes 35%+ Physical/Magic damage." },
    ...(hasYarthul ? [{ key: "overheat", label: "Overheat", tag: `×${Math.pow(1.08, overheatStacks).toFixed(2)} dmg, +${overheatStacks * 7.5}% spd`, desc: "Increases damage by 8% and speed by 7.5% per stack. Capped at 10 stacks." }] : []),
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


  // --- Enchant (shown only when a damage-boosting enchant is equipped) ---
  const _enchantName = enchantPicker.value;
  const _enchantDefs = {
    'Cursed':  [{ key: 'cursed',    label: 'Enemy is Cursed',  desc: '+30% damage against Cursed enemies.' }],
    'Inferno': [{ key: 'inferno',   label: 'Enemy is Burning', desc: '+20% damage when Burn is applied.' }],
    'Midas':   [{ key: 'midasProc', label: 'Midas Proc',       desc: '16.6% chance — +15% extra damage.' }],
    'Reaper':  [{ key: 'reaperProc',label: 'Reaper Proc',      desc: 'On proc: up to +25% damage based on enemy current HP.' }],
  };
  const _enchTogs = _enchantDefs[_enchantName];
  if (_enchTogs) {
    // Reset inactive enchant conditions when enchant changes
    ['cursed','inferno','midasProc','reaperProc'].forEach(k => {
      if (!_enchantDefs[_enchantName].find(t => t.key === k)) enchantCondActive[k] = false;
    });
    html += `<h3 class="dc-bonus-title" style="margin-top:12px">Enchant</h3><div class="dc-bonus-list">`;
    _enchTogs.forEach(tog => {
      const on = enchantCondActive[tog.key];
      const multVal = tog.key === 'reaperProc'
        ? (1 + 0.25 * enchantReaperEnemyHp / 100).toFixed(2)
        : tog.key === 'cursed' ? '1.30' : tog.key === 'inferno' ? '1.20' : '1.15';
      html += `<div class="dc-bonus-row${on ? " dc-bonus-on" : ""}" data-ench-key="${tog.key}" title="${tog.desc}">
        <div class="dc-bonus-check">${on ? "✓" : ""}</div>
        <span class="dc-bonus-name">${tog.label}</span>
        <span class="dc-bonus-pct">×${multVal}</span>
      </div>`;
      if (tog.key === 'reaperProc') {
        html += `<div class="dc-energy-section" style="margin:4px 0 6px 0">
          <span class="dc-energy-label">Enemy HP%: <span>${enchantReaperEnemyHp}</span></span>
          <input type="range" class="dc-rage-slider" min="0" max="100" value="${enchantReaperEnemyHp}" oninput="setEnchantReaperHp(this.value)">
          <span class="dc-rage-slider-hint">0% → 25% bonus</span>
        </div>`;
      }
    });
    html += `</div>`;
  }

  // --- Vastic Procs (shown when Vastic Glaive equipped & STR/ARC/LCK is highest stat) ---
  const _hasVasticGlaive = document.getElementById("weapon-main")?.value === "Vastic Glaive";
  if (!_hasVasticGlaive && vasticLckProcActive) { vasticLckProcActive = false; }
  if (_hasVasticGlaive) {
    const _vStr = getTotalStat("str");
    const _vArc = getTotalStat("arc");
    const _vEnd = getTotalStat("end");
    const _vSpd = getTotalStat("spd");
    const _vLck = getTotalStat("lck");
    // Which buff activates is determined by: invested points + race base + level bonus only
    const _vasticLvl = Math.min(Max_Lvl, Math.max(Min_Lvl, +lvlInput.value || Min_Lvl));
    const _vasticLvlBonus = Math.floor(_vasticLvl / 5);
    const _getVasticBase = stat => {
      const inv = +(document.querySelector(`.stat-row[data-stat="${stat}"] .stat-val`)?.value || 0);
      return inv + (raceBase[stat] ?? 0) + _vasticLvlBonus;
    };
    const _iStr = _getVasticBase("str");
    const _iArc = _getVasticBase("arc");
    const _iEnd = _getVasticBase("end");
    const _iSpd = _getVasticBase("spd");
    const _iLck = _getVasticBase("lck");
    const _vMax = Math.max(_iStr, _iArc, _iEnd, _iSpd, _iLck);
    const _strMajor = _iStr === _vMax;
    const _arcMajor = _iArc === _vMax;

    const _lckMajor = _iLck === _vMax;
    // Reset LCK proc toggle if LCK is no longer the highest stat
    if (!_lckMajor && vasticLckProcActive) { vasticLckProcActive = false; }

    if (_strMajor || _arcMajor || _lckMajor) {
      const _strBomb = 10 + Math.floor(_vStr / 40);
      const _arcBomb = 10 + Math.floor(_vArc / 20);
      html += `<h3 class="dc-bonus-title" style="margin-top:12px">Vastic Procs</h3>
      <div class="dc-bonus-list">`;

      if (_strMajor) {
        html += `<div class="dc-bonus-row dc-vastic-active" style="cursor:default">
          <span class="dc-bonus-name" style="color:#f4a460">STR Bomb</span>
          <span class="dc-bonus-pct" style="color:#f4a460"><b>${_strBomb}</b></span>
        </div>
        <div class="dc-vastic-formula">Base 10 + STR (${_vStr}) / 40</div>`;
      }
      if (_arcMajor) {
        html += `<div class="dc-bonus-row dc-vastic-active" style="cursor:default">
          <span class="dc-bonus-name" style="color:#9b7ae8">ARC Bomb</span>
          <span class="dc-bonus-pct" style="color:#9b7ae8"><b>${_arcBomb}</b></span>
        </div>
        <div class="dc-vastic-formula">Base 10 + ARC (${_vArc}) / 20</div>`;
      }
      if (_lckMajor) {
        html += `<div class="dc-bonus-row${vasticLckProcActive ? " dc-bonus-on" : ""}" data-vastic-lck style="cursor:pointer" title="Grants 80% crit chance on your next attack">
          <div class="dc-bonus-check">${vasticLckProcActive ? "✓" : ""}</div>
          <span class="dc-bonus-name" style="color:#ffd700">LCK Proc</span>
          <span class="dc-bonus-pct" style="color:#ffd700">+80% Crit</span>
        </div>
        <div class="dc-vastic-formula">Adds 80% to crit chance for next attack</div>`;
      }

      html += `</div>`;
    }
  }

  // --- Stat Buffs (shown only when relevant moves/masteries are in the build) ---
  {
    const _superClass = document.getElementById("super-picker")?.value || "";
    const _hasRallyingShout = dmgCalcMoveList.some(m => m.name === "Rallying Shout");
    const _hasEmpPierce = dmgCalcMoveList.some(m => m.name === "Empowered Pierce");
    const _hasEmpPierceProf = _hasEmpPierce && masteryState["rm2"] && _superClass === "Impaler (Ch)";
    const _hasFlourish = dmgCalcMoveList.some(m => m.name === "Flourish");
    const _hasFlourishProf = _hasFlourish && masteryState["lm2"] && _superClass === "Verdant Archer (Ch)";
    _flourishSpdAmt = _hasFlourishProf ? 48 : 25;
    const _hasFocusStep = racePicker.value === "Stultus (20%)" && (+lvlInput.value || 0) >= 10;
    const _focusStepAmt = Math.max(1, +lvlInput.value || 1) * 2;
    // Auto-reset if no longer available
    if (!_hasRallyingShout && statBuffsActive.rallyingSpd) statBuffsActive.rallyingSpd = false;
    if (!_hasEmpPierceProf && statBuffsActive.empPierceSpd) statBuffsActive.empPierceSpd = false;
    if (!_hasFlourish && statBuffsActive.flourishSpd) statBuffsActive.flourishSpd = false;
    if (!_hasFocusStep && statBuffsActive.focusStepSpd) statBuffsActive.focusStepSpd = false;
    const _statBuffDefs = [
      _hasRallyingShout && { key: 'rallyingSpd', label: "Rallying Shout SPD",   val: "+25% SPD", desc: "+25% SPD buff for 4 turns" },
      _hasEmpPierceProf && { key: 'empPierceSpd', label: "Emp. Pierce Prof. SPD", val: "+25% SPD", desc: "+25% SPD buff for 2 turns (Empowering Pierce Proficiency)" },
      _hasFlourish      && { key: 'flourishSpd',  label: `Flourish SPD${_hasFlourishProf ? " (Prof.)" : ""}`, val: `+${_flourishSpdAmt} flat SPD`, desc: `+${_flourishSpdAmt} flat SPD while in Flourish stance` },
      _hasFocusStep     && { key: 'focusStepSpd', label: "Focus Step SPD", val: `+${_focusStepAmt} flat SPD`, desc: `+LVL×2 flat SPD (${_focusStepAmt} at current level) for 4 turns` },
    ].filter(Boolean);
    const _hasPermuth = markPicker.value === 'Venia';
    if (_statBuffDefs.length || _hasPermuth) {
      html += `<h3 class="dc-bonus-title" style="margin-top:12px">Stat Buffs</h3><div class="dc-bonus-list">`;
      _statBuffDefs.forEach(b => {
        const on = statBuffsActive[b.key];
        html += `<div class="dc-bonus-row${on ? " dc-bonus-on" : ""}" data-stat-buff-key="${b.key}" title="${b.desc}">
          <div class="dc-bonus-check">${on ? "✓" : ""}</div>
          <span class="dc-bonus-name">${b.label}</span>
          <span class="dc-bonus-pct">${b.val}</span>
        </div>`;
      });
      if (_hasPermuth) {
        const _pStats = [['str','STR'],['arc','ARC'],['end','END'],['spd','SPD'],['lck','LCK']];
        html += `<div class="dc-permuth-wrap"><span class="dc-bonus-name" style="flex:0;white-space:nowrap">Permuth</span><div class="dc-permuth-chips">`;
        _pStats.forEach(([k, label]) => {
          html += `<button class="dc-permuth-chip${permuthStat === k ? ' dc-permuth-active' : ''}" data-permuth-stat="${k}">${label}</button>`;
        });
        html += `</div><span class="dc-bonus-pct" style="color:#c9b8ff">+40%</span></div>`;
      }
      html += `</div>`;
    }
  }

  // --- Team Buffs (always shown) ---
  const _mgPassiveActive = !!dmgBonusActive["scroll-mg:Metrom's Grasp"];
  // If MG passive is active, ensure team buff MG stays off (and vice versa)
  if (_mgPassiveActive && teamBuffsActive.mg) { teamBuffsActive.mg = false; }
  html += `<h3 class="dc-bonus-title" style="margin-top:12px">Team Buffs</h3><div class="dc-bonus-list">`;
  TEAM_BUFFS.forEach(b => {
    const blockedByPassive = b.key === 'mg' && _mgPassiveActive;
    if (blockedByPassive) {
      html += `<div class="dc-bonus-row" style="opacity:0.4;cursor:not-allowed" title="Locked — your scroll is already active">
        <div class="dc-bonus-check"></div>
        <span class="dc-bonus-name">${b.label} <span style="font-size:11px">(scroll active)</span></span>
        <span class="dc-bonus-pct">×${b.mult.toFixed(2)}</span>
      </div>`;
      return;
    }
    const on = teamBuffsActive[b.key];
    html += `<div class="dc-bonus-row${on ? " dc-bonus-on" : ""}" data-team-key="${b.key}" title="${b.desc}">
      <div class="dc-bonus-check">${on ? "✓" : ""}</div>
      <span class="dc-bonus-name">${b.label}</span>
      <span class="dc-bonus-pct">×${b.mult.toFixed(2)}</span>
    </div>`;
  });
  html += `</div>`;

  // --- Summon Buffs ---
  html += `<h3 class="dc-bonus-title" style="margin-top:12px">Summon Buffs</h3><div class="dc-bonus-list">`;
  const _summonBufDefs = [
    { key: 'spiritAwakening', label: "Spirit Awakening", mult: 1.50, desc: "Vastayan racial active: +50% damage buff to summons for 4 turns." },
  ];
  _summonBufDefs.forEach(b => {
    const on = summonBuffsActive[b.key];
    html += `<div class="dc-bonus-row${on ? " dc-bonus-on" : ""}" data-summon-key="${b.key}" title="${b.desc}">
      <div class="dc-bonus-check">${on ? "✓" : ""}</div>
      <span class="dc-bonus-name">${b.label}</span>
      <span class="dc-bonus-pct">×${b.mult.toFixed(2)}</span>
    </div>`;
  });
  html += `</div>`;

  // --- Sinister Gaze (Amorus racial — shown when Bulk Up is active) ---
  {
    const _isAmorus = racePicker.value === "Amorus (Ob)";
    const _bulkUpOn = dmgBonusPassives.some(p => p.name === "Bulk Up" && dmgBonusActive[p.key]);
    if (!_isAmorus && sinisterGazeReflect) sinisterGazeReflect = false;
    if (_isAmorus && _bulkUpOn) {
      const _sgMult = Math.pow(1.20, bulkUpStacks).toFixed(2);
      html += `<h3 class="dc-bonus-title" style="margin-top:12px">Sinister Gaze</h3><div class="dc-bonus-list">
        <div class="dc-bonus-row${sinisterGazeReflect ? " dc-bonus-on" : ""}" data-sinister-gaze title="You shared your Bulk Up defense debuff(s) to the enemy via Sinister Gaze — enemy takes more damage.">
          <div class="dc-bonus-check">${sinisterGazeReflect ? "✓" : ""}</div>
          <span class="dc-bonus-name">Defense debuff reflected</span>
          <span class="dc-bonus-pct">×${_sgMult}</span>
        </div>
      </div>`;
    }
  }

  const _searchWasFocused = document.activeElement?.id === "dmg-bonus-search";
  const _searchCaret = _searchWasFocused ? document.activeElement.selectionStart : null;
  container.innerHTML = html;

  // --- Boss Target (separate column) ---
  const bossContainer = document.getElementById("dmg-boss-section");
  if (bossContainer) {
    let bossHtml = `<h3 class="dc-bonus-title">Boss Target</h3><div class="dc-boss-list">`;
    Object.entries(BOSS_DATA).forEach(([name, boss]) => {
      const active = selectedBoss === name;
      const corruptedHp = boss.hpVariants?.['Corrupted'];
      const displayHp = (active && bossCorrupted && corruptedHp) ? corruptedHp : boss.hp;
      bossHtml += `<div class="dc-boss-btn${active ? ' dc-boss-selected' : ''}" data-boss-name="${name.replace(/"/g, '&quot;')}">
        <span class="dc-boss-btn-name">${name}</span>
        <span class="dc-boss-btn-hp">${displayHp} HP${corruptedHp ? ` <span style="color:#666">/ ${corruptedHp} corrupted</span>` : ''}</span>
      </div>`;
      if (active) {
        if (corruptedHp) {
          bossHtml += `<div class="dc-boss-corrupt-row">
            <span class="dc-boss-corrupt-label">Corrupted</span>
            <div class="dc-boss-corrupt-toggle${bossCorrupted ? ' dc-boss-corrupt-on' : ''}" data-boss-corrupt>
              <span class="dc-boss-corrupt-knob"></span>
            </div>
          </div>`;
        }
        const resEntries = Object.entries(boss.res);
        bossHtml += `<div class="dc-boss-res">`;
        resEntries.forEach(([type, pct]) => {
          const col = MOVE_TYPE_COLORS[type] || '#aaa';
          const pctNum = Math.round(pct * 100);
          const tag = pctNum > 100 ? `<span style="color:#88ff88">+${pctNum - 100}%</span>` : pctNum < 100 ? `<span style="color:#ff8888">-${100 - pctNum}%</span>` : `<span style="color:#aaa">—</span>`;
          bossHtml += `<span class="dc-boss-res-row"><span style="color:${col}">${type}</span> ${tag}</span>`;
        });
        bossHtml += `</div>`;
      }
    });
    bossHtml += `</div>`;
    bossContainer.innerHTML = bossHtml;
  }
  if (_searchWasFocused) {
    const _searchEl = document.getElementById("dmg-bonus-search");
    if (_searchEl) { _searchEl.focus(); if (_searchCaret !== null) _searchEl.setSelectionRange(_searchCaret, _searchCaret); }
  }

  document.getElementById("dmg-bonus-search")?.addEventListener("input", e => {
    _dmgBonusFilter = e.target.value.toLowerCase();
    renderDmgBonusSection();
  });

  (bossContainer || container).querySelectorAll(".dc-boss-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.bossName;
      if (selectedBoss !== name) bossCorrupted = false;
      selectedBoss = selectedBoss === name ? null : name;
      renderDmgBonusSection();
      recalcOpenDetails();
    });
  });

  (bossContainer || container).querySelector("[data-boss-corrupt]")?.addEventListener("click", e => {
    e.stopPropagation();
    bossCorrupted = !bossCorrupted;
    renderDmgBonusSection();
  });

  container.querySelectorAll(".dc-bonus-row").forEach(row => {
    if (row.dataset.skey) {
      row.addEventListener("click", () => toggleStatusEffect(row.dataset.skey));
      return;
    }
    if (row.dataset.shardToggle) {
      row.addEventListener("click", () => toggleShardCondition(row.dataset.shardToggle));
      return;
    }
    if ('vasticLck' in row.dataset) {
      row.addEventListener("click", () => {
        vasticLckProcActive = !vasticLckProcActive;
        renderDmgBonusSection();
        updatePecents();
      });
      return;
    }
    if (row.dataset.enchKey) {
      row.addEventListener("click", () => toggleEnchantCond(row.dataset.enchKey));
      return;
    }
    if (row.dataset.statBuffKey) {
      row.addEventListener("click", () => toggleStatBuff(row.dataset.statBuffKey));
      return;
    }
    if ('sinisterGaze' in row.dataset) {
      row.addEventListener("click", () => toggleSinisterGaze());
      return;
    }
    if (row.dataset.teamKey) {
      row.addEventListener("click", () => toggleTeamBuff(row.dataset.teamKey));
      return;
    }
    if (row.dataset.summonKey) {
      row.addEventListener("click", () => {
        summonBuffsActive[row.dataset.summonKey] = !summonBuffsActive[row.dataset.summonKey];
        renderDmgBonusSection(); recalcOpenDetails();
      });
      return;
    }
    const p = dmgBonusPassives[+row.dataset.bidx];
    if (!p) return;
    row.addEventListener("click", () => {
      if ('mgLocked' in row.dataset) return; // locked by team buff MG
      dmgBonusActive[p.key] = !dmgBonusActive[p.key];
      renderDmgBonusSection();
      recalcOpenDetails();
      if (p.name === "Stellian Core") updatePecents();
    });
    row.addEventListener("mouseenter", () => showDcTooltip(row, p));
    row.addEventListener("mouseleave", hideDcTooltip);
  });
  container.querySelectorAll('[data-permuth-stat]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const s = btn.dataset.permuthStat;
      permuthStat = (permuthStat === s) ? '' : s;
      renderDmgBonusSection(); recalcOpenDetails(); updatePecents();
    });
  });
}

// --- Dmg Calc move list---
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
  const _sheeaClassMap = [
    { key: "Saint (Or)",        label: "Sheea (Saint)" },
    { key: "Paladin (Or)",      label: "Sheea (Paladin)" },
    { key: "Elementalist (Or)", label: "Sheea (Elementalist)" },
  ];
  const _sheeaExtraMoves = artifactName === "Heaven's Authority"
    ? _sheeaClassMap.flatMap(({ key, label }) => {
        const d = classMoves[key];
        const classMoveList = d ? (d.learns || []).filter(m => m.type === "Active" && !isSummonMove(m)).map(m => ({ ...m, slot: label })) : [];
        const skywardBolt = {
          slot: label, level: 1, type: "Active", name: "Skyward Bolt",
          quote: "Condense your light into a bolt of shocking energy, has a chance to blind.",
          cost: 2, cooldown: 6, moveType: "Holy", category: "Attack", damage: 10, scaling: "STR/ARC",
          effect: "Shoots a bolt to a target, deals damage and has a chance to apply 2 blind.",
          image: "https://trello.com/1/cards/67c264d96e98da9ed20197c1/attachments/69761167850a7e2c6c96117b/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125174933.png"
        };
        return [skywardBolt, ...classMoveList];
      })
    : [];
  const allMoves = [
    ...allData.flatMap(d => (d.learns || []).filter(m =>
      m.type === "Active" &&
      (
        (m.category === "Summon" && (m.damage !== undefined || m.scaling) && m.name !== "Calling Light" && m.name !== "Call Sylph") ||
        (m.category !== "Buff" && m.damage !== undefined && /^\d/.test(String(m.damage)))
      )
    )),
    ..._sheeaExtraMoves.filter(m => m.damage !== undefined && /^\d/.test(String(m.damage)))
  ];

  const healMoves = allData.flatMap(d => (d.learns || []).filter(m =>
    m.type === "Active" && m.healing !== undefined
  ));

  if (!allMoves.length && !healMoves.length) {
    container.innerHTML = `<p class="moves-placeholder">Make a selection to view moves.</p>`;
    renderDmgBonusSection();
    return;
  }

  dmgCalcMoveList = allMoves;
  let html = `<div class="dmg-calc-move-list">`;
  allMoves.forEach((m, i) => {
    const effectiveMoveType = getEffectiveMoveType(m.moveType);
    const color = MOVE_TYPE_COLORS[effectiveMoveType] || "#cccccc";
    const canCalc = m.damage !== undefined && /^\d/.test(String(m.damage));
    const dmgStr  = m.damage   !== undefined ? `<span class="dc-stat">Dmg: <b>${m.damage}</b></span>` : "";
    const sclStr  = m.scaling  ? `<span class="dc-stat">Scl: ${m.scaling}</span>` : "";
    const costStr = m.cost     !== undefined ? `<span class="dc-stat">Cost: ${m.cost}</span>` : "";
    const cdStr   = m.cooldown !== undefined ? `<span class="dc-stat">CD: ${m.cooldown}</span>` : "";
    const eneStr  = m.energyScaling ? `<span class="dc-stat dc-energy-badge">+${m.energyScaling.perEnergy}%/E (past ${m.energyScaling.past})</span>` : "";
    const summonLabel = m.category === "Summon"
      ? `<span class="dc-stat" style="color:#888">[Summon]</span>`
      : isSummonMove(m) ? `<span class="dc-stat" style="color:#888">[${m.slot}]</span>` : "";
    html += `<div class="dc-row${canCalc ? " dc-row-clickable" : ""}" style="border-left:3px solid ${color}" ${canCalc ? `data-idx="${i}" onclick="toggleDmgDetail(this,${i})"` : ""}>
      <span class="dc-name" style="color:${color}">${m.name}</span>
      <span class="dc-type" style="color:${color}">[${effectiveMoveType || "—"}]</span>${summonLabel}
      <span class="dc-stats">${dmgStr}${sclStr}${costStr}${cdStr}${eneStr}</span>
      ${canCalc ? `<span class="dc-hint">click to calculate</span>` : ""}
    </div>
    <div class="dc-detail" style="display:none"></div>`;
  });

  if (healMoves.length) {
    html += `<h3 class="dc-support-title">Support</h3>`;
    healMoves.forEach(m => {
      const effectiveMoveType = getEffectiveMoveType(m.moveType);
      const color = MOVE_TYPE_COLORS[effectiveMoveType] || "#cccccc";
      const healStr  = `<span class="dc-stat dc-heal-val">Heal: <b>${m.healing}</b></span>`;
      const sclStr   = m.scaling  ? `<span class="dc-stat">Scl: ${m.scaling}</span>` : "";
      const costStr  = m.cost     !== undefined ? `<span class="dc-stat">Cost: ${m.cost}</span>` : "";
      const cdStr    = m.cooldown !== undefined ? `<span class="dc-stat">CD: ${m.cooldown}</span>` : "";
      html += `<div class="dc-row" style="border-left:3px solid ${color}">
        <span class="dc-name" style="color:${color}">${m.name}</span>
        <span class="dc-type" style="color:${color}">[${effectiveMoveType || "—"}]</span>
        <span class="dc-stats">${healStr}${sclStr}${costStr}${cdStr}</span>
      </div>`;
    });
  }

  html += `</div>`;
  container.innerHTML = html;
  renderDmgBonusSection();
}

racePicker.addEventListener("change", renderMoves);
classPicker.addEventListener("change", renderMoves);
classPicker.addEventListener("change", clearRestrictedScrolls);
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

// § SOUL TREE
// Two mutually exclusive progression paths. Selecting a node on one path
// locks the other path. Each node has up to 5 ranks with escalating costs.
// Bonuses from soulTreeBonuses are applied inside updatePecents() and getTotalStat().
// Node structure: { id, name, desc, perRank, maxRank, costs[], bonus?, dmgBonus? }
const ROMAN = ["—", "I", "II", "III", "IV", "V"];

const soulTreeData = {
  "Path of Destruction": [
    { id: "denature",      name: "Denature",                 desc: "DoT Damage +{v}%",                                               perRank: 2,   maxRank: 5, costs: [25,50,75,100,125] },
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

function maxSoulTree() {
  Object.values(soulTreeData).flat().forEach(node => {
    soulTreeRanks[node.id] = node.maxRank;
  });
  recalcSoulTreeBonuses();
  renderSoulTree();
  updatePecents();
  renderDmgBonusSection();
}

function resetSoulTree() {
  Object.values(soulTreeData).flat().forEach(node => {
    soulTreeRanks[node.id] = 0;
  });
  recalcSoulTreeBonuses();
  renderSoulTree();
  updatePecents();
  renderDmgBonusSection();
}

function renderSoulTree() {
  const container = document.getElementById("soul-tree-content");
  let html = `<div class="soul-tree-actions">
    <button class="soul-tree-btn soul-tree-btn-max" onclick="maxSoulTree()">Max All</button>
    <button class="soul-tree-btn soul-tree-btn-reset" onclick="resetSoulTree()">Reset All</button>
  </div>`;
  html += `<div class="soul-tree-columns">`;

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

// § MASTERY TREE
// 35-point mastery system with three branches per class (red / green / blue).
// Breakthrough gates at node 5 cost 3 Echo Shards each.
// Spent points are tracked globally; investing above MASTERY_TOTAL_POINTS is blocked.
// getMasteryStatBonuses() computes the cumulative stat bonuses for use in updatePecents().
const MASTERY_TOTAL_POINTS = 35;

// Class-specific branch names and node descriptions, keyed by base class name.
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
      lm2: { name: "Holy Crash Proficiency",    desc: "Taunt is now guaranteed on all targets hit — both main and adjacent. Deals 1.25x damage." },
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
      rm1: { name: "Parry Master",               desc: "Parry is now guaranteed at base, so this mastery no longer changes the proc chance. Mastery damage increased to 12 base damage on parry." },
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
      lm2: { name: "Blaze Proficiency",           desc: "Guarantees Burning (6T), additionally applying Vulnerable (3T) and also doubles the ATKP bonus if you attack a burning enemy.\nThis move now always deals 15% extra damage. It gains an additional 15% damage buff against burning opponents, totaling 30%.\nYour move becomes fully AoE (all opponents), and has a new animation with blue fires." },
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

  if (childLocked) return; // can't deactivate while children are active

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
  const id = _masteryModalTarget;
  _masteryModalTarget = null;
  document.getElementById("mastery-modal").style.display = "none";

  if (id === null || !masteryNodeMap[id] || !getActiveMasteryData()) return;

  // If deactivating, just toggle normally
  if (masteryState[id]) {
    toggleMasteryNode(id);
    return;
  }

  // Collect all inactive ancestors in top-down order, skipping mastery-type nodes
  const toActivate = [];
  const visited = new Set();
  function collectAncestors(nodeId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const n = masteryNodeMap[nodeId];
    if (!n) return;
    [].concat(n.parent ?? []).forEach(p => collectAncestors(p));
    if (!masteryState[nodeId]) toActivate.push(nodeId);
  }
  [].concat(masteryNodeMap[id].parent ?? []).forEach(p => collectAncestors(p));
  toActivate.push(id); // always include the target itself

  // Check we have enough mastery points for all non-breakthrough nodes
  const extraCost = toActivate
    .filter(nid => masteryNodeMap[nid].type !== "breakthrough")
    .reduce((sum, nid) => sum + (masteryNodeMap[nid].type === "mastery" ? 5 : 1), 0);
  if (masteryPointsSpent() + extraCost > MASTERY_TOTAL_POINTS) return;

  // Activate ancestors (non-mastery) then the target
  toActivate.forEach(nid => { masteryState[nid] = true; });

  updateMasteryDisplay();
  renderMasteryInfoSection();
  updatePecents();
  renderDmgBonusSection();
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
    // Collect all inactive non-mastery ancestors in top-down order
    const toActivate = [];
    const _visited = new Set();
    function _collectAncestors(nodeId) {
      if (_visited.has(nodeId)) return;
      _visited.add(nodeId);
      const n = masteryNodeMap[nodeId];
      if (!n) return;
      [].concat(n.parent ?? []).forEach(p => _collectAncestors(p));
      if (!masteryState[nodeId]) toActivate.push(nodeId);
    }
    [].concat(node.parent ?? []).forEach(p => _collectAncestors(p));
    toActivate.push(id);

    // Check point budget for everything being activated
    const cost = toActivate
      .filter(nid => masteryNodeMap[nid].type !== "breakthrough")
      .reduce((sum, nid) => sum + (masteryNodeMap[nid].type === "mastery" ? 5 : 1), 0);
    if (masteryPointsSpent() + cost > MASTERY_TOTAL_POINTS) return;

    toActivate.forEach(nid => { masteryState[nid] = true; });
  }

  updateMasteryDisplay();
  renderMasteryInfoSection();
  updatePecents();
  renderDmgBonusSection();
  recalcOpenDetails();
}

function resetMastery() {
  masteryNodes.forEach(n => masteryState[n.id] = false);
  updateMasteryDisplay();
  renderMasteryInfoSection();
  updatePecents();
  renderDmgBonusSection();
  recalcOpenDetails();
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

  const cursor = childLocked ? "not-allowed" : "pointer";
  const tooltip = desc ? `${displayName} — ${costLabel}\n\n${desc}` : `${displayName} — ${costLabel}`;
  const clickFn = node.type === "mastery" ? `openMasteryModal('${id}')` : `toggleMasteryNode('${id}')`;
  const tipAttr = `data-tip="${tooltip.replace(/"/g, '&quot;')}"`;
  return `<div class="${cls}" id="mn-${id}" onclick="${clickFn}" ${tipAttr} style="cursor:${cursor}"></div>`;
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

function scaleMasteryTree() {
  const container = document.getElementById("mastery-tree-container");
  if (!container) return;
  const trunk = container.querySelector(".mastery-trunk");
  const branches = container.querySelector(".mastery-branches");
  if (!trunk || !branches) return;

  // Remove zoom to measure natural (unscaled) height
  trunk.style.zoom = '';
  branches.style.zoom = '';

  const availH = container.clientHeight;
  const trunkR = trunk.getBoundingClientRect();
  const branchR = branches.getBoundingClientRect();
  const naturalH = branchR.bottom - trunkR.top;

  if (availH <= 0 || naturalH <= 0) return;

  const scale = Math.min(0.92, availH / naturalH);
  trunk.style.zoom = scale;
  branches.style.zoom = scale;
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
  requestAnimationFrame(() => requestAnimationFrame(() => { scaleMasteryTree(); drawMasteryLines(); }));
}

// Re-scale whenever the mastery panel changes size (banner shown/hidden, window resize)
{
  const _masteryPanel = document.getElementById("mastery");
  if (_masteryPanel && typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => {
      const container = document.getElementById("mastery-tree-container");
      if (!container || !container.querySelector(".mastery-trunk")) return;
      scaleMasteryTree();
      drawMasteryLines();
    }).observe(_masteryPanel);
  }
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
    el.style.cursor = childLocked ? "not-allowed" : "pointer";
  });

  const ptsEl = document.getElementById("mastery-pts-used");
  const shardsEl = document.getElementById("mastery-shards-used");
  if (ptsEl) ptsEl.textContent = masteryPointsSpent();
  if (shardsEl) shardsEl.textContent = masteryShardsSpent();

  // Color pts red if over budget
  if (ptsEl) ptsEl.style.color = masteryPointsSpent() >= MASTERY_TOTAL_POINTS ? "#ff5555" : "white";
}

// --- Mastery node instant tooltip ---
(function () {
  const tip = document.getElementById("mastery-tip");
  if (!tip) return;
  const OFFSET = 12;
  document.getElementById("mastery")?.addEventListener("mouseover", e => {
    const node = e.target.closest("[data-tip]");
    if (!node) { tip.style.display = "none"; return; }
    tip.textContent = node.dataset.tip;
    tip.style.display = "block";
  });
  document.getElementById("mastery")?.addEventListener("mouseout", e => {
    const node = e.target.closest("[data-tip]");
    if (node && node.contains(e.relatedTarget)) return;
    tip.style.display = "none";
  });
  document.addEventListener("mousemove", e => {
    if (tip.style.display === "none") return;
    let x = e.clientX + OFFSET;
    let y = e.clientY + OFFSET;
    if (x + 240 > window.innerWidth)  x = e.clientX - 240 - OFFSET;
    if (y + tip.offsetHeight + 8 > window.innerHeight) y = e.clientY - tip.offsetHeight - OFFSET;
    tip.style.left = x + "px";
    tip.style.top  = y + "px";
  });
})();

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

// § TAB SWITCHING
// Controls which builder panel is visible. Each tab button maps to a panel ID.
// Panels are shown/hidden via inline display style to avoid CSS specificity conflicts.
const tabs      = document.querySelectorAll("#page-builder .tabbar .tab");
const panelIds  = ["stats", "mastery", "Moves", "sould-tree", "dmg-calc", "summary", "saved-builds"];

function _switchBuilderTab(target) {
  if (!target) return;

  // Hide every panel by inline style — no CSS class fighting
  panelIds.forEach(id => {
    const p = document.getElementById(id);
    if (p) p.style.display = "none";
  });

  // Show only the target
  const targetPanel = document.getElementById(target);
  if (targetPanel) targetPanel.style.display = "flex";

  // Reset content scroll so the new panel is visible from the top-left
  const content = document.querySelector("#page-builder .content");
  if (content) { content.scrollLeft = 0; content.scrollTop = 0; }

  // Tab button highlight
  tabs.forEach(t => t.classList.remove("active"));
  const clickedTab = [...tabs].find(t => t.dataset.tab === target);
  if (clickedTab) clickedTab.classList.add("active");

  // Contenteditable toggle
  const summaryTA = document.getElementById('summary-textarea');
  if (summaryTA) summaryTA.contentEditable = target === 'summary' ? 'true' : 'false';

  if (target === "mastery") renderMastery();
  if (target === "dmg-calc") renderDmgCalc();
  if (target === "saved-builds") renderSavedBuilds();
}

tabs.forEach(tab => {
  const target = tab.dataset.tab;
  if (!target) return;

  tab.addEventListener("touchend", e => {
    e.preventDefault();
    _switchBuilderTab(target);
  }, { passive: false });

  tab.addEventListener("click", () => _switchBuilderTab(target));
});

// Init: hide all panels, show only the active one
_switchBuilderTab("stats");

// § BUILD SHARE
// Generates and parses shareable build URLs.
// Three formats are supported (detected by prefix):
//   "bz_..." — bit-packed binary, deflate-compressed, base64url-encoded (current default)
//   "b_..."  — plain base64url JSON (legacy, kept for backward compatibility)
//   JSONBlob cloud URL — fallback for very long builds that exceeded URL limits
// setPickerDisplay() syncs both the hidden <select> value and the custom dropdown label.

function setPickerDisplay(picker, name) {
  picker.value = name;
  const wrap = picker.previousElementSibling;
  if (wrap && wrap.classList.contains('wpick-wrap')) {
    const display = wrap.querySelector('.wpick-display');
    if (display) display.textContent = name || '— None —';
  }
}

// § BUILD ENCODING
// Compact lookup tables built once at startup.
// Each list maps an item name to a numeric index for bit-packing.
// _i(list, val) → index (-1 if not found), _v(list, idx) → name.
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
    ls:    flatList(lostScrollItems),
    sc:    flatList(scrollItems),
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
    pStat: permuthStat,
    cov:  covenantPicker.value,
    covR: +(document.getElementById('covenant-rank').value) || 1,
    ench: enchantPicker.value,
    art:  artifactPicker.value,
    sh:   shards,
    g:    gears,
    wm:   mainWeaponPicker.value,
    wo:   offhandWeaponPicker.value,
    arm:  armourPicker.value,
    ls:   lostScrollPicker.value,
    sc1:  scroll1Picker.value,
    sc2:  scroll2Picker.value,
    msty: mastery,
    soul,
    summ:  (document.getElementById('summary-textarea')?.innerHTML || ''),
    summc: (document.getElementById('summary-color-picker')?.value || '#dddddd'),
    name:  (document.getElementById('build-name-input')?.value.trim() || '')
  };
}

// Binary bit-packing encoder.
// Writes values of arbitrary bit-widths into a packed byte buffer,
// then exports the buffer as a URL-safe base64 string (no padding).
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

// Binary bit-packing decoder — mirror of _BitWriter.
// Reads values of arbitrary bit-widths from a URL-safe base64 string.
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

// Returns the minimum number of bits needed to represent values 0..n (n+1 distinct values).
function _wb(n) { let b = 1; while ((1 << b) <= n) b++; return b; }

// Position-dependent Caesar cipher over the base64url alphabet.
// Each character is rotated by a different offset so repeated input values
// produce visually distinct output strings (e.g. an empty build won't look like "AAAAAAA").
// _unscrambleBlob() is the exact inverse — apply to reverse.
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
// UTF-8-safe base64url encode/decode.
// Kept for backward compatibility with the old "b_~" share URL format.
function _b64uEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function _b64uDecode(str) {
  const b64 = str.replace(/-/g,'+').replace(/_/g,'/');
  const pad = b64.length % 4 ? '===='.slice(b64.length % 4) : '';
  return decodeURIComponent(escape(atob(b64 + pad)));
}
// Raw byte helpers used by the "bz_" deflate-compressed share format.
function _b64uToBytes(b64url) {
  const b64 = b64url.replace(/-/g,'+').replace(/_/g,'/');
  const pad = b64.length % 4 ? '===='.slice(b64.length % 4) : '';
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function _bytesToB64u(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
// Compresses a string with deflate-raw and returns ":<base64url>" (shorter for long strings).
// Falls back to plain _b64uEncode if CompressionStream is unavailable or the compressed
// output is longer than the uncompressed version.
// The leading ":" is not a valid base64url character, so it unambiguously flags compression.
async function _compressB64u(str) {
  if (typeof CompressionStream === 'undefined') return _b64uEncode(str);
  try {
    const input = new TextEncoder().encode(str);
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter(); w.write(input); w.close();
    const reader = cs.readable.getReader();
    const chunks = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
    let len = 0; for (const c of chunks) len += c.length;
    const buf = new Uint8Array(len); let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    const cmp = ':' + btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const raw = _b64uEncode(str);
    return cmp.length < raw.length ? cmp : raw;
  } catch (e) { return _b64uEncode(str); }
}
async function _decompressB64u(s) {
  if (!s.startsWith(':')) return _b64uDecode(s);
  if (typeof DecompressionStream === 'undefined') return '';
  try {
    const b64 = s.slice(1).replace(/-/g,'+').replace(/_/g,'/');
    const pad = b64.length % 4 ? '===='.slice(b64.length % 4) : '';
    const bin = atob(b64 + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(bytes); w.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
    let len = 0; for (const c of chunks) len += c.length;
    const buf = new Uint8Array(len); let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    return new TextDecoder().decode(buf);
  } catch (e) { return ''; }
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
  const mstySet = new Set(state.msty);
  masteryNodes.forEach(nd => bw.write(mstySet.has(nd.id) ? 1 : 0, 1));
  Object.keys(soulTreeRanks).forEach(id => bw.write(state.soul[id] || 0, 3));
  // Scrolls appended at end so old links still decode correctly (trailing zeros = empty)
  wi(_L.ls,  state.ls  || '');
  wi(_L.sc,  state.sc1 || '');
  wi(_L.sc,  state.sc2 || '');
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
  const ls  = ri(_L.ls);
  const sc1 = ri(_L.sc);
  const sc2 = ri(_L.sc);
  return { v: 1, lvl, race, cls, sup, sub, str, arc, end, spd, lck,
           mark, cov, covR, ench, art, sh, g, wm, wo, arm, ls, sc1, sc2, msty, soul, name };
}

const _CLOUD = 'https://jsonblob.com/api/jsonBlob';

// Save build to Supabase — returns short share URL or null on failure
async function encodeState(state) {
  if (typeof window._saveSharedBuild !== 'function') return null;
  const blob       = _packState(state);
  const payloadObj = { d: blob, n: state.name || 'Untitled', summ: state.summ || '', summc: state.summc || '#dddddd' };
  const base       = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
  try {
    const id = await window._saveSharedBuild(payloadObj);
    return id ? base + '?id=' + id : null;
  } catch (e) { return null; }
}

// Load payload by ID — handles b_ (direct-encoded), localStorage, then JSONBlob
async function _loadById(id) {
  // bz_ = deflate-raw compressed binary: [uint16 summLen][uint8 nameLen][uint8 r,g,b][summ][name][build]
  if (id.startsWith('bz_')) {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
      const compressed = _b64uToBytes(id.slice(3));
      const ds = new DecompressionStream('deflate-raw');
      const w = ds.writable.getWriter(); w.write(compressed); w.close();
      const reader = ds.readable.getReader();
      const chunks = []; for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
      let len = 0; for (const c of chunks) len += c.length;
      const buf = new Uint8Array(len); let bOff = 0;
      for (const c of chunks) { buf.set(c, bOff); bOff += c.length; }
      let p = 0;
      const summLen = buf[p] | (buf[p+1] << 8); p += 2;
      const nameLen = buf[p++];
      const r = buf[p++], g = buf[p++], b = buf[p++];
      const dec = new TextDecoder();
      const summ  = summLen ? dec.decode(buf.slice(p, p + summLen)) : ''; p += summLen;
      const n     = nameLen ? dec.decode(buf.slice(p, p + nameLen)) : 'Untitled'; p += nameLen;
      const summc = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
      const d     = _bytesToB64u(buf.slice(p));
      return { d, n, summ, summc };
    } catch (e) { return null; }
  }
  // b_ prefix = build state encoded directly in the id param (scrambled)
  // New format: b_<blob>~<b64summ>~<colorHex>~<b64name>  (extra parts optional)
  // Old format: b_<blob>  (no ~)
  if (id.startsWith('b_')) {
    const tIdx = id.indexOf('~');
    if (tIdx === -1) return { d: _unscrambleBlob(id.slice(2)), n: 'Untitled' };
    const parts = id.slice(2).split('~');
    const d = _unscrambleBlob(parts[0]);
    let summ = '', summc = '#dddddd', n = 'Untitled';
    if (parts.length >= 4) {
      try { summ  = parts[1] ? await _decompressB64u(parts[1]) : ''; } catch (e) {}
      summc = parts[2] ? '#' + parts[2] : '#dddddd';
      try { n     = parts[3] ? _b64uDecode(parts[3]) : 'Untitled'; } catch (e) {}
    }
    return { d, n, summ, summc };
  }
  const cached = localStorage.getItem('alb:' + id);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {
      // old format was raw blob string
      return { d: cached, n: 'Untitled' };
    }
  }
  // Try Supabase (short 6-char IDs)
  if (typeof window._loadSharedBuild === 'function') {
    try {
      const data = await window._loadSharedBuild(id);
      if (data) {
        localStorage.setItem('alb:' + id, JSON.stringify(data));
        return data;
      }
    } catch (e) {}
  }
  // Fall back to JSONBlob
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

  // Reset spent so stale values don't cause negative clamping when stats are re-loaded
  spent = 0;

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
  permuthStat = (state.mark === 'Venia' && state.pStat) ? state.pStat : '';
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

  // Scrolls
  setPickerDisplay(lostScrollPicker, state.ls  || '');
  setPickerDisplay(scroll1Picker,    state.sc1 || '');
  setPickerDisplay(scroll2Picker,    state.sc2 || '');

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

  // Summary
  const summaryTA = document.getElementById('summary-textarea');
  const summaryCP = document.getElementById('summary-color-picker');
  if (summaryTA) summaryTA.innerHTML = state.summ || '';
  if (summaryCP) summaryCP.value = state.summc || '#dddddd';

  // Reset dmg-calc state so loaded builds start clean
  energyCount = 0;
  rageEmpHpConsumed = 0;
  bloodyBersHp = 100;
  absRadTurn = 1;
  bulkUpStacks = 1;
  hourglassStacks = 1;
  boreasStacks = 1;
  unendingFlowStacks = 1;
  rendingBarrageStacks = 1;
  demonicPresenceStacks = 1;
  ramiIdolStacks = 1;
  vaingLocketTurn = 1;
  sinisterGazeReflect = false;
  overheatStacks = 1;
  crusherStacks = 1;
  oppressionCount = 1;
  shatteringDebuffCount = 1;
  reversingDebuffCount = 1;
  crystalStarStacks = 0;
  frozenDiademIceActive = false;
  flamingOverdriveStacks = 0;
  selectedBoss = null;
  bossCorrupted = false;
  Object.keys(statusEffectsActive).forEach(k => { statusEffectsActive[k] = false; });
  Object.keys(teamBuffsActive).forEach(k => { teamBuffsActive[k] = false; });
  Object.keys(summonBuffsActive).forEach(k => { summonBuffsActive[k] = false; });
  Object.keys(enchantCondActive).forEach(k => { enchantCondActive[k] = false; });
  enchantReaperEnemyHp = 100;
  coagNailStacks = 1;
  Object.keys(dmgBonusActive).forEach(k => { dmgBonusActive[k] = false; });
  Object.keys(shardToggleActive).forEach(k => { shardToggleActive[k] = false; });

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

const resetBuildBtn = document.getElementById('reset-build-btn');
if (resetBuildBtn) {
  resetBuildBtn.addEventListener('click', () => {
    if (!confirm('Reset build? This will clear everything.')) return;
    try { localStorage.removeItem(_AUTO_SAVE_KEY); } catch (e) {}
    loadBuildState({ v: 1, lvl: 1, race: '', cls: '', sup: '', sub: '',
      str: 0, arc: 0, end: 0, spd: 0, lck: 0,
      mark: '', cov: '', covR: 1, ench: '', art: '',
      sh: [], g: [], wm: '', wo: '', arm: '', ls: '', sc1: '', sc2: '',
      msty: [], soul: {}, summ: '', summc: '#dddddd' });
    if (buildNameInput) buildNameInput.value = '';
  });
}

if (shareBuildBtn) {
  shareBuildBtn.addEventListener('click', async () => {
    const state = getBuildState();
    state.name = (buildNameInput ? buildNameInput.value.trim() : '') || 'Untitled';
    shareBuildBtn.textContent = 'Saving...';
    shareBuildBtn.disabled = true;
    const url = await encodeState(state);
    shareBuildBtn.disabled = false;
    if (!url) {
      shareBuildBtn.textContent = 'Error!';
      setTimeout(() => { shareBuildBtn.textContent = 'Share'; }, 2000);
      return;
    }
    navigator.clipboard.writeText(url).then(() => {
      shareBuildBtn.textContent = 'Copied!';
      setTimeout(() => { shareBuildBtn.textContent = 'Share'; }, 2000);
    }).catch(() => {
      prompt('Copy this link:', url);
      shareBuildBtn.textContent = 'Share';
    });
  });
}

// === SUMMARY COLOR PICKER ===
(function () {
  const picker = document.getElementById('summary-color-picker');
  const editor = document.getElementById('summary-textarea');
  if (!picker || !editor) return;
  let savedRange = null;

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed &&
        editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
    // else keep last savedRange so keyboard/drag scenarios still work
  }

  function applyColor() {
    // Prefer a live non-collapsed selection inside the editor
    const sel = window.getSelection();
    let rangeToUse = null;
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed &&
        editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      rangeToUse = sel.getRangeAt(0);
    } else if (savedRange) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
      rangeToUse = savedRange;
    }
    if (!rangeToUse) return;
    document.execCommand('foreColor', false, picker.value);
    savedRange = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  }

  // Save selection whenever it might be about to be lost
  editor.addEventListener('mouseup', saveSelection);
  editor.addEventListener('keyup', saveSelection);
  picker.addEventListener('mousedown', saveSelection);
  picker.addEventListener('focus', saveSelection);

  // Apply on both input (dragging color wheel) and change (committing)
  picker.addEventListener('input', applyColor);
  picker.addEventListener('change', applyColor);

  // Persist changes
  editor.addEventListener('input', autoSave);
  picker.addEventListener('change', autoSave);
})();

// === AUTO-SAVE ===
// _AUTO_SAVE_KEY and _autoSaveTimer declared at top of file (see below autoSave fn is hoisted)
function autoSave() {
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => {
    try { localStorage.setItem(_AUTO_SAVE_KEY, JSON.stringify(getBuildState())); } catch (e) {}
  }, 600);
}

// Load build on page start
(async function () {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (id) {
    const payload = await _loadById(id);
    if (payload) {
      const nameInput = document.getElementById('build-name-input');
      const resolvedN = (payload.n && payload.n !== 'Untitled') ? payload.n : (params.get('n') || 'Untitled');
      if (nameInput && resolvedN !== 'Untitled') nameInput.value = resolvedN;
      const state = _unpackState(payload.d, resolvedN);
      if (state) {
        state.summ  = payload.summ  != null ? payload.summ  : (params.get('sm')  || '');
        state.summc = payload.summc != null ? payload.summc : (params.get('sc') || '#dddddd');
        loadBuildState(state);
        setTimeout(() => { if (typeof switchPage === 'function') switchPage('builder'); }, 0);
      }
    }
    return;
  }

  // Legacy hash-based links
  const hash = window.location.hash.slice(1);
  const hashPages = ['home', 'builder', 'qte', 'leaderboards'];
  if (hash && !hashPages.includes(hash)) {
    try {
      if (hash.includes('/')) {
        const parts = hash.split('/');
        if (parts.length === 2) {
          const state = _unpackState(parts[1], decodeURIComponent(parts[0]));
          if (state) { loadBuildState(state); setTimeout(() => { if (typeof switchPage === 'function') switchPage('builder'); }, 0); }
        }
        return;
      }
      const state = JSON.parse(atob(hash));
      if (state && state.v === 1) { loadBuildState(state); setTimeout(() => { if (typeof switchPage === 'function') switchPage('builder'); }, 0); return; }
    } catch (e) {}
  }

  // Auto-restore last session from localStorage
  try {
    const saved = localStorage.getItem(_AUTO_SAVE_KEY);
    if (saved) {
      const state = JSON.parse(saved);
      if (state && state.v === 1) loadBuildState(state);
    }
  } catch (e) {}
})();

