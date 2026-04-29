// --- Race data ---
const races = {
  // example: "Human": { str: 5, arc: 0, end: 3, spd: 2, lck: 1 },
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
  updatePecents();
});

// --- Stat counters ---
const TOTAL_POINTS = 195;
const Max_Lvl = 40;
const Min_Lvl =1;
let spent = 0;
document.getElementById("points-left").textContent = TOTAL_POINTS;
document.getElementById("Lvl").textContent = Min_Lvl + Math.floor(spent / 5);

document.querySelectorAll(".stat-row").forEach(row => {
  const plus = row.querySelector(".plus");
  const minus = row.querySelector(".minus");
  const val = row.querySelector(".stat-val");

  plus.addEventListener("click", () => {
    if (spent >= TOTAL_POINTS) return;
    val.value = +val.value + 1;
    spent++;
    updatePoints();
    updateLvl();
    updatePecents();
  });

  minus.addEventListener("click", () => {
    if (+val.value <= 0) return;
    val.value = +val.value - 1;
    spent--;
    updatePoints();
    updateLvl();
    updatePecents();
  });

  val.dataset.prev = 0;
  val.addEventListener("change", () => {
    const prev = +val.dataset.prev;
    let newVal = Math.max(0, Math.floor(+val.value || 0));
    const diff = newVal - prev;
    if (spent + diff > TOTAL_POINTS) {
      newVal = prev + (TOTAL_POINTS - spent);
    }
    val.value = newVal;
    spent += newVal - prev;
    val.dataset.prev = newVal;
    updatePoints();
    updateLvl();
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
  };
  return formulas[stat] ? formulas[stat](val).toFixed(1) : "—";
}

function updatePoints() {
  document.getElementById("points-left").textContent = TOTAL_POINTS - spent;
}

function updateLvl(){
    document.getElementById("Lvl").textContent = Min_Lvl + Math.floor(spent / 5);
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