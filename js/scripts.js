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
  updatePoints();
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