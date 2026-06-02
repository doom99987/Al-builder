// § MOVE RENDERER
// HTML card generators and the main renderMoves() orchestrator.
// Reads from classMoves, raceMoves, markMoves, gearMoves, artifactMoves, and scrollMoves
// to build the side-by-side move display in the Info tab.
// Depends on: data-class-moves.js, data-race-moves.js, builder.js (for picker values).

function activeCardHtml(m, opts) {
  const isAll = opts && typeof opts === 'object' && opts.isAll;
  const slug = _moveSlug(m.name);
  const idAttr = isAll ? ` id="allmv-${slug}"` : ` id="colmv-${slug}"`;
  const clickAttr = isAll
    ? ` onclick="scrollToCol('${slug}')" style="cursor:pointer"`
    : ` onclick="scrollToMove('${slug}')" style="cursor:pointer"`;
  return `
    <div class="move-learn-header">${m.slot} <span class="move-learn-level">(Lv${m.level})</span></div>
    <div class="move-card active-move"${idAttr}${clickAttr}>
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

function innateCardHtml(p, opts) {
  const isAll = opts && typeof opts === 'object' && opts.isAll;
  const slug = _moveSlug(p.name);
  const idAttr = isAll ? ` id="allmv-${slug}"` : ` id="colmv-${slug}"`;
  const clickAttr = isAll
    ? ` onclick="scrollToCol('${slug}')" style="cursor:pointer"`
    : ` onclick="scrollToMove('${slug}')" style="cursor:pointer"`;
  return `
    <div class="move-card passive"${idAttr}${clickAttr}>
      <div class="move-header">
        <span class="move-badge passive-badge">Innate</span>
        <span class="move-level">Lv${p.level}</span>
      </div>
      <div class="move-name">${p.name}</div>
      <div class="move-desc">${p.description}</div>
    </div>`;
}

function passiveCardHtml(m, opts) {
  const isAll = opts && typeof opts === 'object' && opts.isAll;
  const slug = _moveSlug(m.name);
  const idAttr = isAll ? ` id="allmv-${slug}"` : ` id="colmv-${slug}"`;
  const clickAttr = isAll
    ? ` onclick="scrollToCol('${slug}')" style="cursor:pointer"`
    : ` onclick="scrollToMove('${slug}')" style="cursor:pointer"`;
  return `
    <div class="move-learn-header">${m.slot} <span class="move-learn-level">(Lv${m.level})</span></div>
    <div class="move-card passive"${idAttr}${clickAttr}>
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
  if (/^\d+$/.test(s)) return false; // plain numeric slot = ordering, not a summon
  return !/^\d+(st|nd|rd|th)\s+Learn$/i.test(s)
      && !/^Class\s+Active$/i.test(s)
      && !/^Tier\s+\d+$/i.test(s)
      && !/^Level\s+\d+$/i.test(s);
}

function _moveSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function scrollToMove(slug) {
  const el = document.getElementById('allmv-' + slug);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('move-card-ping');
  void el.offsetWidth; // force reflow to restart animation
  el.classList.add('move-card-ping');
  setTimeout(() => el.classList.remove('move-card-ping'), 1400);
}
window.scrollToMove = scrollToMove;

function scrollToCol(slug) {
  const el = document.getElementById('colmv-' + slug);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('move-card-ping');
  void el.offsetWidth;
  el.classList.add('move-card-ping');
  setTimeout(() => el.classList.remove('move-card-ping'), 1400);
}
window.scrollToCol = scrollToCol;

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

  const equippedShards = [...document.querySelectorAll('.shard-picker')]
    .map(p => p.value).filter(Boolean);
  if (equippedShards.length) {
    html += `<div class="moves-col">`;
    html += `<div class="moves-entity-label">Shards</div>`;
    equippedShards.forEach((name, i) => {
      const shard = shardItems[name];
      if (!shard) return;
      html += `<h2 class="moves-race-title">S${i+1}: ${name}</h2>`;
      html += `<div class="move-card passive-card"><div class="move-effect">${shard.effect.replace(/\n/g, '<br>')}</div></div>`;
    });
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

  // --- Heaven's Authority: Sheea Summons ---
  if (artifactName === "Heaven's Authority") {
    const skywardBolt = {
      slot: "", level: 1, type: "Active", name: "Skyward Bolt",
      quote: "Condense your light into a bolt of shocking energy, has a chance to blind.",
      cost: 2, cooldown: 6, moveType: "Holy", category: "Attack", damage: 10, scaling: "STR/ARC",
      effect: "Shoots a bolt to a target, deals damage and has a chance to apply 2 blind.",
      image: "https://trello.com/1/cards/67c264d96e98da9ed20197c1/attachments/69761167850a7e2c6c96117b/download/%D0%91%D0%B5%D0%B7%2B%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F31_20260125174933.png"
    };
    const sheeas = [
      { label: "Saint Sheea",        key: "Saint (Or)" },
      { label: "Paladin Sheea",      key: "Paladin (Or)" },
      { label: "Elementalist Sheea", key: "Elementalist (Or)" },
    ];
    html += `<div class="moves-combined-row">`;
    html += `<h2 class="moves-combined-title">Sheea Summons</h2>`;
    html += `<div class="moves-columns">`;
    sheeas.forEach(({ label, key }) => {
      const data = classMoves[key];
      if (!data) return;
      const moves = [skywardBolt, ...(data.learns || []).filter(m => m.type === "Active" && !isSummonMove(m))];
      html += `<div class="moves-col">`;
      html += `<h2 class="moves-race-title">${label}</h2>`;
      moves.forEach(m => html += activeCardHtml(m, lvl));
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
      allActives.forEach(m => html += activeCardHtml(m, {isAll: true}));
      html += `</div>`;
    }

    const allInnates  = allData.flatMap(d => (d.innatePassives || []));
    const allPassives = allData.flatMap(d => (d.learns || []).filter(m => m.type === "Passive" && !isSummonMove(m)));
    if (allInnates.length || allPassives.length) {
      html += `<div class="moves-combined-section">`;
      html += `<h2 class="moves-combined-title">All Passives</h2>`;
      allInnates.forEach(p => html += innateCardHtml(p, {isAll: true}));
      allPassives.forEach(m => html += passiveCardHtml(m, {isAll: true}));
      html += `</div>`;
    }

    html += `</div>`;
  }

  container.innerHTML = html;
  renderDmgCalc();
}

