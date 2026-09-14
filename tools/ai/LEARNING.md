# Build AI — learning index

The running record of what the engine has learned from real builds, what it
still gets wrong, and how to keep learning. `knowledge.js` is where a fact
becomes a number; this file is where the fact came from, what it changed, and
what is next. Read it before pricing anything new.

## The loop: how a build teaches the engine

1. **Extract claims.** Every line of an owner post is a testable statement
   ("60 End is enough on a Saint", "Blasphemy never buffs a 0-2 energy move").
2. **Check each claim against the game data** (`js/builder.js`,
   `js/data-*-moves.js`). When they disagree, ask for the pasted text — the
   paste wins. Overgrowth was stated as +20 crit; the text says +10 crit and
   +20 *Speed*.
3. **Encode with provenance.** `source: 'owner' | 'data' | 'assumed'`; gates
   (`elements`, `needsStatus`, `fullHp`, `rampsFromZero`, `party`) explicit;
   uptime explicit. A number the text does not support is a note, not a value.
4. **Measure, never assert.** A/B with the optimizer itself. Traps that have
   bitten: a bare `Model(data)` has no `K.QUIRKS` registered (move rewrites do
   nothing); `gearPassiveTotals` is memoised on worn items (mutating the table
   mid-script changes nothing); handing every race Dullahan's point budget rigs a
   race comparison; `r.build.permuth` is set *after* scoring.
5. **Guard, then mutation-test** (`node tools/ai/test.js --only=<text>` with the
   fix reverted must fail). The golden corpus is the arbiter: a golden that moves
   gets a reason in the test comment, never a weaker assertion.
6. **Ship.** `ENGINE_V` + `tools/build-ai.html` stamps + `index.html`
   `SITE_VERSION`/`version.json` together; push only when asked.

## Verified facts (September 2026)

- Stat decay past ~100; go to 110 only for the perk, else sit on 25/60/110.
- ARC 110 cuts every non-Physical cooldown; STR 110 cuts Physical.
- 1 energy a turn flat; the energy-gain stat is a percent chance, counted as
  its average per turn. You open a fight with a full pool (assumed).
- Blasphemy's Notch pays only a move costing 3+ energy. Ice Shards (scroll, 3)
  and The Right Angle (Miner, 3) are dumps; Poison Fan (2) never is.
- Heresy: you enter in Dark Wing; Force builds in the wing you stand in, so
  Light Force costs a Meditate turn first. Force per hit is unstated.
- Ages Pages: +5 crit flat (already in `gearPctBonuses`); Corrupt Power stacks
  +10 more in Blasphemy/Tyranny, capped at 2 by a bug; nothing in Heresy
  (Corrupt Power bugged there).
- Crystal Sphere: +5 crit flat (in `gearPctBonuses`); "removes crit fatigue" is
  dead text — the mechanic went away in the Section 9 rework.
- Wicked Crown converts *Physical* moves to Dark (site: `builder.js:4487`);
  Shard of Blight is +25% to Dark moves only. Poison Fan is Poison — untouched.
- Arborivia: Overgrowth +10 crit/+10% DR/+20 SPD when cast at max HP; Leaf
  Thrust is 2×3 hits with +50 crit; Foliage is level 15; base 1/3/2/3/1.
- Boreas's Inner Frost heavy-stuns *you* for two turns before it lands.
- Absolute Radiance ramps 7.5/10/12.5/15/22.5 over five turns (cost 4, cd 18).
- A Saint needs 60 End, or ~102 total with Astra to pop Narthana's Sigil.
- Community builds assume maxed soul-tree health nodes.

## Corrections made, and what each taught

| Symptom | Cause | Lesson |
|---|---|---|
| Blasphemy +30% on a 2-energy nuke | form multiplier applied to the best hit, not the dump | price a bonus on the move that earns it |
| Crystal Sphere/Ages Pages worth +10 crit | priced in `GEAR_PASSIVES` *and* `gearPctBonuses` | anything in `gearPctBonuses` is `onSite` |
| Shard of Blight paid every build | flat 25% at guessed uptime | element-gated bonuses need `elements` |
| Corvolus buffs never reached a crowned kit | type read raw, not converted | read `typeOf(mv)` everywhere a type is read |
| Permuth on STR (+1%) not Luck (+68%) | pick is a default, not a measurement | unmeasured picks are guesses; say so |
| Race picked Dullahan over Arborivia | full-HP crit averaged to 40% on an opener | openers happen at full health |
| Inner Frost was the best nuke in the game | self-stun had no cost | any move that spends *your* turns is priced per turn |
| Crystalized Star invisible | no entry → 4-Luck stat stick | ramps are zero on an opener, real over a fight |
| Radiance at 13.5% on a turn-3 hit | five-turn average used everywhere | a ramp is worth the tick it has reached |
| Impaler flipped Calvariae → Inferion | race attacks priced, race defence not | never switch on half a package |

## Open gaps, ranked by likely damage impact

1. **Race actives are not in the scored kit** (parked in `kitFor`, one-line
   switch). Blocked on pricing race *defensive* kits first — Calvariae's Broken
   Bones/Frail Body/Brittle Cure HP cost, Inferion's package — so Inferno Rift
   cannot outvote the community's Calvariae ≫ Inferion. Unlocks Leaf Thrust.
2. **Per-hit stacking.** Leaf Thrust's 3 hits at 100%+ crit put 3 Crystalized
   Star stacks (+30 Luck) up in one turn; Poisoner applies poison per crit.
   Needs stacks-per-hit and a rotation that can spend a turn stacking — and the
   trade against Shadow Form, which a stacking attack breaks.
3. **Party play.** Owner: many damage buffs are AoE (Absolute Radiance among
   them). `SETUP_MOVES` entries need `party: true` so `partyScale(spec)` counts
   them across the team; combos across players land in fewer turns; energy gain
   and Tyranny's Condemned are team multipliers. Today only `partyDr`/party
   capstones scale.
4. **Energy gating sustained output** — the ledger costs the opener only.
5. **Tyranny's Condemned** is a 10% placeholder (`CORRUPTION_ASSUMED`).
6. **Two-item gear combos** (crown enabling Blight) — greedy per-slot search.
7. **Level gating** — every level is handed every class/race move.
8. **Stat decay vs crit tier** — Strength-scaling crit builds park at 110 Luck.
9. **Self-stun catalogue** — only Inner Frost named; text fallback assumes 2.
10. **Mastery stat nodes** are not steered onto the build's stat.
11. **Permuth stat pick** is unmeasured (measure like `permuth_value` did).

## The price-everything audit (2026-09-13)

Every priceable thing in the game — 76 gears, 12 artifacts, 19 races, 19
armours, 15 enchants, 13 weapon series, 3 marks, 4 covenants, 108 capstones —
read against its game text by agents, one batch at a time, under the rules
above. The raw findings (gates, notes, synergies, party value, reasoning) are
kept in `tools/ai/audit/2026-09-13.json`: that file is the tandem map, and the
first place to look before pricing a combo.

**Applied:** 78 entries — GEAR_PASSIVES 33, MASTERY_ABILITIES 31, ENCHANTS 7,
WEAPON_PASSIVES 5, ARTIFACT_ABILITIES 1, MARK_ABILITIES 1 — as one
`Object.assign` block marked `AUDIT 2026-09-13` just above `knowledge.js`'s
`return`. A key there overrides the hand-written entry above it; deleting the
block reverts the whole audit.

**Rejected at review, and why** (each is a class of error to catch next time):

| Entry | Why not |
|---|---|
| Stellian Core | nested a `multi` inside artifact effects — the scorer silently zeroes it |
| Coagulated Finger Nail | `stat: 'all'` — the ramp writes to a stat that does not exist |
| Cursed | `needsStatus` on an enchant (enchants ignore gates) and uptime 0.5 → 0.85 |
| Shifting Hourglass | dropped its self-stun cost and its DR |
| Lifesong | un-priced a community pick that sits under the Saint golden |
| Frostburned Rune | `status` kinds ignore element gates, so every kit would "apply" Cold |
| Pathfinder Mark, Dark Glare Proficiency | the stager emitted a junk `when` regex |
| Elemental Infuser | "bugged" with no game text behind it |
| Ramizcan Idol | a 1-turn buff after a block, counted at 50% uptime |
| Holy Crash / Flame Drop / Light Burst Proficiency | replaced a priced value with a move rewrite the engine does not have |

**Engine bug the audit exposed:** the `needsStatus` gate subtracted every unmet
entry from *crit*; an unmet +20% damage would have read as −20 crit. It is per
kind now (crit, damage, DR).

**Process lessons:** stage from structured proposals and never hand-splice;
when verifier agents are expensive, verify by rule (`value in text`,
`onSiteAlready → onSite`, implied gates) and review only what the rules flag;
a re-applied block must be removed as whole lines; load-check after writing.

**Missing engine kinds, by how many items need them:** incoming/elemental DR
(8 armours), energy % and energy chance (5 armours, Eroded Blade, Status
Master), per-move damage % (5 capstones), stat-% ramps (3), corruption-form
enchants (Polaris, Octantis, Skyblaze), dodge on gear (Dust Storm, Desert
Escutcheon), damage ramps (Yar'thul's Wrath, Unending Flow), cheat-death (2),
summon damage (2), party DR (2) — then about 55 singletons, among them crit
procs (DeathBeak Dagger), flat and true flat damage (Crystalline Spike, Blooming
Eye), starting energy (Traveler's Lamp), crit lifesteal (Drauga), energy on a
timer (Nisse), multiplicative outgoing healing (One For All), per-status healing
(Lasting Life) and crit tier +1 (Overcore). Until those exist the items are
notes: listed, never scored.

**Most-cited tandem partners:** Ptera's Heart, Crystalized Star, Corvolus's Cast
Amplify, Snorb, the Cursed enchant, Frozen Diadem, Oppression, Energy
Manipulator, Wicked Crown, Imbuement Reliquary, Verdant Archer, Vital Strike,
Parasitic Leech, Spore Root. Roughly 90 synergy lines are *anti*-synergies —
read those before recommending a pairing.

**Party value (50 items):** Traveler's Lamp opens with 3 Vulnerable on every
enemy — a team-wide ×1.20 on the opening turns; Divine Promise keeps one ally on
+1 energy and 10% DR permanently; Parasitic Leech heals every ally 2% of your
damage; Dragon Memoir, Blazing Brand and Ptera's Heart put statuses on enemies
that allies' gated bonuses read; Narthana's Leaf multiplies heals on allies.
None of this reaches a party score yet — it waits on `party: true` setups
scaling through `partyScale(spec)` (open gap 3).

**Still by hand:** race entries (ability names plus SETUP_MOVES), Daminos,
Way of Life and Church of Raphion setup moves, armours and covenants (no table).

## Real tiers, and finishing the search properly (2026-09-13)

**Owner fact: every item has its own max tier.** The site lets any gear be set
to T6 and any tiered weapon to T4, and the engine used those caps for
everything — so Crystal Sphere (max T3, 4 points) was priced at T6 (9 points),
Yar'thul's Wrath (max T4) the same, and every low-tier item was handed stat
points no player can put on it. `K.MAX_TIER` (161 items) and `K.maxTierFor`
now set each item's tier; `bestTierAlloc` reads it. Tier points per tier:
T1 2 · T2 3 · T3 4 · T4 5 · T5 6 · T6 9 (a tier's other shapes total one
less). Primordial reaches T5 in game, but the site stops weapons at T4, and
only the tiered series (Dragon, Blight, Sun, Sandstone, Primordial) carry tier
points at all — Icerind, Blacksteel, Corealloy and Ivory are listed to T3 by
the owner but are untiered on the site. Shields are not searched. Named by the
owner but missing from the site data: Soul and Heart, The Hand of Thuriaz,
Darkblight Sword/Cestus/Spear, Overgrowth Axe, Curseblood Knife, Maul of
Brotherhood, and the shields Dragonflame, Icerind, Ivory, Sandstone, Targe,
Slimy Buckler, Ferrus Towershield.

With honest tiers the standing Assassin nuke reads **1,266 prepared, 208
Luck** (it was an inflated 1,392 on 224).

**Three search fixes the honest numbers forced:**

| Symptom | Cause | Fix |
|---|---|---|
| Berserker golden wore DeathBeak Dagger (a stat stick) though Shard of Blight scored 2% higher | gear is picked before capstones, tiers and traits settle | `refineGear`: re-check each slot's recorded runners-up against the settled build, carrying the slot's trait orbs |
| Healer picked Calvariae (71 heal/turn) over Sheea (93) | only the winner was finished, after winning on an unfinished score | finish every finalist within 5% of the lead; choose among finished builds only |
| A solo boss build sat on 31 Speed | the 40-Speed floor was only a score penalty, met by phantom tier points | a hard floor inside `goPerfect`: raise Speed to it first, and `legal()` refuses any step below |

**Against the community references** (`--strict-golden`, pre-audit baseline
first): soft misses 62 → 58. The Impaler now reaches STR 110 and wears 2 of its
4 reference gears (was 1); the Paladin is END-dominant (was LCK); the Berserker
wears 1 of its reference gears (was 0). One new soft miss to look at: the
Saint's tier priority now starts with END, where the post says Str ≥ Arc ≥ End.

Order matters: gear is re-checked **before** the stat line is perfected, or the
swapped item's stats slide the totals off their breakpoints. And a ramp item
(Crystalized Star) raises the *in-fight* Luck total, not the stat line — a test
that reads `ctx.stats` for a stat-line rule should read `ctx.siteStats`.

## Tester feedback: Shadow Form, Luck 25, finalist seats (2026-09-13)

From a tester's report (SeedDev), what each problem was and the fix:

| Report | Cause | Fix |
|---|---|---|
| The Shadow Form toggle gave ×1.30, not ×1.56, and no crit | the DMG calc merged a mastery into its base entry with `max`, so Shadow Master's ×1.3 replaced the form's own ×1.2 | a mastery marked multiplicative now multiplies into its base (1.2 × 1.3 = 1.56); an Assassin with Shadow Form on gets +20 crit chance in the readout |
| 25 Luck gave no crit damage | the milestone was a note only | +0.1 on the crit multiplier at 25 total Luck, in the site readout (`_lckMsCritDmg`) and in `model.js` `critMultiplier` — run `verify.js` in the browser |
| Surprise Package missing from the DMG calc | not listed | team buff ×1.35, only on the Physical or Magic hit that detonates it |
| Estella (+25% below 40% HP) paired with Stellian Core (needs 95% HP) | the HP-gate check only fired for classes that commit to a health side | `hpStance.raceSide`: a low-health race sets the side, and an item gated the other way is priced at conflict uptime (0.05) |
| Race reason didn't apply ("highest base Arcane" on a STR Berserker) | the line was a fixed blurb per race | `K.raceReasonFor` names only race abilities that fire for this kit, setups that pay, and base stats the best move scales with; otherwise it says none apply and gives the measured margin |
| Elemental Infuser has no icon | its entry has no `image` URL | **open** — needs the image URL |

**What the Luck fix knocked loose.** Two builds moved; both are explained.

- **Support flipped from Saint (132 HP) to Blade Dancer (92 HP)** and failed the fragility test. Saint was never built: the coarse pass gave seven of eight finalist seats to Paladin races, and Saint came ninth. Built and finished, Saint beats Blade Dancer by 4%. Fix: the best pair of each of the top 4 classes is seated first, and the other 4 seats go by coarse score. With 0 class seats the test fails again.
- **The Impaler golden now wears Ages Pages instead of Coagulated Finger Nail** (reference gears 2 → 1 of 4). An engine copy with the Luck bonus switched off reproduces the old build exactly, so the bonus is the cause: more crit damage makes Ages Pages' +5 crit worth slightly more. The two items score within 0.2%, with the Nail's ramp counted at an assumed 5 stacks. Not a bug — a longer fight tips it back.

**Checked in the browser** on a local server: Shadow Form reads +20%, and +56%
with Shadow Master; crit chance goes 2.5 to 22.5 with the toggle on; crit
damage steps 2.0 to 2.1 exactly when total Luck reaches 25 (not at 24).

**The engine needed no Shadow Form change.** The site multiplies every active
buff; the engine adds them. For this pair it lands close anyway: Shadow Master's
opener half is held back and compounds with the setup buff, 1.15 × 1.35 = ×1.55
against the game's ×1.56. The add-versus-multiply gap grows with other damage
bonuses on the build — a known simplification, not new. The stale note that
called Shadow Form's crit unpriced is fixed: `openerCrit` pays it on the opener.

Every other soft golden miss is unchanged against be16ac9.

## Crystalline Spike flat damage, and the Infuser toggle (2026-09-13)

**Elemental Infuser.** The tester's "no icon" meant From Sky to Soul never showed
up in the DMG calc as a buff to switch on. The calculator adds a gear Active only
when it has the Buff category or its text matches a "grants N" pattern, and then
only if `parseDmgBonus` finds a number — "(10% / 20% / 30%)" matches nothing. It
is now a manual entry (+10%, gated to Magic, Fire, Ice and Hex). The game text
says the buff is bugged and does not scale; 10% is the assumed reading. The
engine prices it as a setup (`SETUP_MOVES['From Sky to Soul']`).

**Crystalline Spike.** `verify.js` found the model 5 short per hit on every move
when the Spike was worn: the site adds flat damage to the scaled base of each hit,
before any multiplier (`dmgPerHit = base × (1 + contrib) + flat`). `model.js` now
does the same — not on the two-part attacks (Stinger, Crucible), whose site
branches add none, and not on moves with no damage. The site's own no-scaling
branch left the hit out (it gave the Frosted proc the bonus but not the hit
itself); the item says it *always* grants +5, so that branch now adds it, and
`verify.js` compares no-scaling moves too.

**Why the search never found it.** `rankGear` values gear by stat block and
priced passives; flat damage is neither, so the Spike (4 STR) never made the
14-item shortlist. Swapped into the crit Berserker it scored 3,998 against 1,406.
Gear the model prices inside its own maths (`GEAR_PASSIVES` kind `onSite`) now
gets a guaranteed seat, as percentage gear already did.

**What it changed.** On many-hit kits the flat damage outweighs Strength: Carnage
is 1 × 20 hits, so +5 a hit is +100 before crits. Crit builds with the Spike go
full Luck — the owner's Berserker reference ("Full Luck", Crystalline Spike), now
matched: its dominant-stat miss is gone and it wears the Spike. The Impaler
reference now takes the Spike and 14 STR (soft miss STR 110) but gains its
Lasting Life capstone.

**A review workflow over the change** (4 diagnosticians, 4 review lenses, a
skeptic per finding) confirmed 9 of 12 findings. Fixed:

| Finding | Fix |
|---|---|
| The Spike's one-attack +40 was applied to every sustained turn in a form | `formGearCrit` returns `critMult` and `flatMult`; flat touches the nuke only |
| Blasphemy nukes with its 3+ energy dump, but the +40 was measured on the best hit | `CORRUPTION_DAMAGE.Blasphemy` returns `nuke: 'dump'`; evaluate reports `dumpPerHit` |
| One cap over form gain and gear gain: a shared Spike bonus filled it for Blasphemy and Tyranny, flipping the pick to a form whose lines said "Pick another form" | form and gear gains capped separately (gear at half); a form chosen for its gear says so |
| Per-hit figure taken on different stats from the hit it scales | recorded per burst/dump (ramp-free or buffed) |
| A crit tier the scorer rated 4% higher was unreachable: allocateStats snaps before shards and tier shapes exist, goPerfect only walks 25/60/110 | `critSnapFinished` retries tiers on the finished line |

Four tests had outdated assumptions, rewritten to keep their intent: the element
gate pins scrolls (Ice Shards' 4 hits out-gain Death Curtain's 2) and proves the
gain is gated; Stealth Strike's doubling is measured without flat damage (flat is
added after the base doubles); Healer+DPS and DPS+Tank compare the heal and tank
archetype scores (Luck 60's +35% healing tied heal per turn; lifesteal made raw HP
meaningless), the tank bar set against a pure tank; the Lancer and crit-wizard
tier tests now require the chosen line to beat the nearest line on the other side
of the tier. Every new guard was mutation-tested.

**Owner-confirmed (2026-09-13):** flat damage lands on every hit of a many-hit
move. Keep it per hit.

**Open, for the owner:** whether Invisible's +100% multiplies the final hit (it
would then double the Spike's +5 too).

## Crit tiers add +1, not a multiple (2026-09-13)

**Owner fact, from the Withered Grove patch notes:** base Crit Damage is 2x and
no longer grows with Luck; "getting a higher tier of critical hit will increase
the Crit Damage multiplier by 1". At 2.25x crit damage a normal crit is 2.25x,
orange 3.25x, red 4.25x, purple 5.25x. The site showed 4.50x, 6.75x and 9.00x.

| Where | Was | Now |
|---|---|---|
| DMG calc overcrit lines | crit × 2, × 3, × 4 | crit + 1, + 2, + 3 |
| Expected multi-hit damage | 1 + p × (crit − 1) with p past 1 | `getExpectedCritMult`: blend below 100%, crit + (tier − 1) + overflow above |
| Overcore ("upgraded to the next tier") | crit squared | crit + 1 |
| `model.js` `expectedMultiplier` | crit × (tier + p) | crit + (tier − 1) + p |
| DeathBeak expected crits | hits × crit chance, past the hit count | capped at every hit |

A parity test evaluates the site's `getExpectedCritMult` from `builder.js` and
compares it with the model across crit damage and crit chance.

**What it exposed in the search.** Past 100% crit, Luck now buys +1 per 100 rather
than a whole multiple, so a crit tier is a small step, and three search gaps that
the old, bigger tiers had hidden started losing real score:

| Symptom | Cause | Fix |
|---|---|---|
| A crit Assassin sat at 99% crit; Crystal Sphere with its points in Luck crossed the tier for +6% | `tierOrder` caches its stat ranking on the invested points alone, so after a gear swap the order is stale and tier points went to Strength | the cache is cleared whenever `refineGear` swaps an item and before the finishing tier pass; a crit tier within 9 Luck counts as a breakpoint, like a stat milestone |
| Finishing a finished build again lowered it by 10% | `bestTierAlloc` tries only the top two stat orders and never kept the allocation already on the slot | the incumbent allocation is a candidate: re-running can never make a slot worse |
| A swap only the finished line makes worth it was never tried | gear is re-checked before the stat line settles | `run()` re-checks gear once more on the finished line, re-finishes, keeps it only if it scores higher |

The crit Assassin now finishes at 104.75% crit and 1,067 (it was 965 at 99%).
Golden builds: unchanged. Every new guard was mutation-tested.

## Blazing Barrage is STR/75; Monk's unlisted x1.2 against Burning (2026-09-13)

**Owner fact:** Blazing Barrage scales on STR/75. It had been entered as STR/55
to match observed hits, but those hits carried a Monk passive the game states
nowhere: **20% more damage (x1.2) against a Burning enemy.** Two errors that
cancelled on the hits someone happened to measure.

| Where | Change |
|---|---|
| `js/data-class-moves.js` | Blazing Barrage `STR/55` back to `STR/75` |
| DMG calc | a Monk gets a **Burning Target** toggle, x1.2 on every move while on |
| `knowledge.js` `PASSIVES['Monk (Or)']` | `Burning Target`, +20% at an assumed 0.5 uptime, `needsStatus: /burn/`, `innate: true`, `source: 'owner'` |
| `optimize.js` `passivesFor` | lists `innate` class passives, which have no game-data name to match |
| `optimize.js` `evaluate` | a passive gated on an enemy status comes back out (`ctx.inertPassiveDmg`) when the build applies none |
| `knowledge.js` `STATUS_WORDS` | **'burn' was missing** |

**The missing status word was the bigger bug.** "a 25% chance to apply Burn" never
registered, so no kit whose text says Burn read as applying it. 'burning' and
'inferno' were listed and already folded to 'burn'; the word itself was not.
With it in, a Monk's Fire Sutra and Blazing Barrage apply Burn, and the gated
passive pays. It also made a stated boss immunity count: Arkhaia's "Immune to
Ghostflame and Burn" had been filed as a non-status immunity and never priced,
so a Monk against Arkhaia now takes the 12% immunity penalty that names those
two moves. Golden builds are unchanged against the pushed commit.

The test that no unmodelled boss moves a number was rewritten: a penalty is
allowed only when it names moves the kit has, and at least one probe class must
come out untouched.

**Open:** 'cold' has the same gap - 'chilled' and 'frozen' fold to it, but "apply
Cold" is not a status word, so Frozen Diadem's Cold gate and any Cold immunity
never see an Ice kit.

## Enhanced Bloodlust stacks, Stab's crit, per-move crit (2026-09-14)

**Owner facts:** Drauga's Enhanced Bloodlust grants **+15% damage and +15% Speed per
kill** for the rest of the fight, stacking with each kill (the game text said
"12.5-15%" and nothing about stacking). **Stab has an innate +40% crit chance**
("This has a 40% extra chance to crit").

| Where | Change |
|---|---|
| DMG calc | Enhanced Bloodlust keeps its toggle and gains a 1-10 kill counter: x(1 + 0.15 per kill) damage and +15% Speed per kill in `getTotalStat`. Kills are added together, like Bloodlust's stacks - **additive is an assumption** |
| `js/data-race-moves.js` | Enhanced Bloodlust text now states 15% damage and Speed per kill, stacking |
| `js/data-class-moves.js` | Stab gets `critBonus: 40`, which the DMG calc's `moveCritBonus` already reads |
| `knowledge.js` | Enhanced Bloodlust +15% (was 13.75), one kill for half the fight [assumed]; Speed not priced |
| `optimize.js` `moveCritMult` | a move's own `critBonus` is added to the build's crit chance for that move - the engine used one crit figure for every move, so Stab's +40 and Dark Smite's +25 were never counted |

**What per-move crit exposed.** With Dark Smite's +25 counted, the damage
Darkwraith picks Corvolus, whose Cast Amplify and Arcane Ritual are setups. The
in-form write-up listed the out-of-form buffs on turns 1-2, *before* the 7-turn
Soul Ignition, so a 3-turn buff had expired long before the turn-10 finisher.
The in-form rotation is now: form steps that cost turns, then the buffs, then
bonus actions, then the finisher. The test checks every buff is cast after the
entry and still covers the finisher's turn.

**Open:** Dark Smite Proficiency is priced as +50 crit on *every* move at 0.3
uptime; in the DMG calc it replaces Dark Smite's own +25 with +50 on that move
alone. Now that per-move crit exists, it belongs there.

## When the game updates

`node tools/ai/extract-data.js` → `node tools/check-data.js` → full suite →
`--strict-golden` → `verify.js` in the browser → re-run the standing requests
(Saint healer, Impaler Handaconda, Berserker Carnage, Assassin nuke) and diff
the write-ups. For every new item: is it in `gearPctBonuses` (then `onSite`)?
Does its text gate on a status, an element, full health, or your own crits?
For every new move: does it cost *you* anything — HP, turns, a stun?

## Standing reference: the Assassin nuke

Arborivia, 150 Luck (210 on the site row), Primordial Dagger, Stellian Core,
Crystalline Spike / Yar'thul's Wrath / Band of Crushing Force / Coagulated Finger Nail,
Arcane Robes,
Traveling Pasmark, Miner, Absolute Radiance, Cursed, 3 Reversing + 2 Empowering
+ 2 Striking, mastery 2-0-0, Cult of Thanasius. Shadow Form → Absolute Radiance
→ Poison Fan: 946 cold, 1,411 prepared, at 110% crit, with Crystalline Spike's flat
damage per hit and crit tiers adding +1 (2026-09-13). It read 1,283 before the
Spike was counted, 1,266 before the Luck 25 crit bonus, and 1,392 when every item
was priced at T6. Permuth on Luck
(not counted) is +68% and a coin flip. Every hybrid line loses to pure Luck.
