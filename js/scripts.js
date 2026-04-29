// --- Stat counters ---
const TOTAL_POINTS = 200;
const Max_Lvl = 40;
let spent = 0;
document.getElementById("points-left").textContent = TOTAL_POINTS;
document.getElementById("Lvl").textContent = Math.floor(spent / 5);

document.querySelectorAll(".stat-row").forEach(row => {
  const plus = row.querySelector(".plus");
  const minus = row.querySelector(".minus");
  const val = row.querySelector(".stat-val");

  plus.addEventListener("click", () => {
    if (spent >= TOTAL_POINTS) return;
    val.textContent = +val.textContent + 1;
    spent++;
    updatePoints();
    updateLvl();
  });

  minus.addEventListener("click", () => {
    if (+val.textContent <= 0) return;
    val.textContent = +val.textContent - 1;
    spent--;
    updatePoints();
    updateLvl();
  });
});

function updatePoints() {
  document.getElementById("points-left").textContent = TOTAL_POINTS - spent;
}

function updateLvl(){
    document.getElementById("Lvl").textContent = Math.floor(spent / 5);
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

  });
});