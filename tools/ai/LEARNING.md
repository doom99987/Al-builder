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
- STR 110 is +20% damage on Physical moves and ARC 110 +20% on every other
  type (2026-09-16 patch; they used to cut cooldowns). The patch notes said
  "melee" and "ranged"; the owner corrected it from play (2026-09-17). The
  move's converted type decides. Summon attacks get neither. A Saint no
  longer needs 110 Arc (owner). SPD 110 is 15% autododge (was 5%).
- Damage reduction is an armour formula (owner, 2026-09-17): DR sums as
  points; a total takes 100 / (100 + DR) of a hit, or 2 - 100 / (100 - DR)
  below zero. `K.drDamageTakenMult` = site `drDamageTakenMult` (tested). The
  survival archetypes read it as 1 / drDamageTakenMult(DR) effective HP
  ((100 + DR) / 100 when DR >= 0), uncapped - the
  old `DR_CAP = 80` belonged to the linear reading and is gone.
- Cursed halves outgoing and incoming healing. Poison loses 20% of its stacks
  each turn [rounding unstated]. Paranoxian Crux cuts max HP by 75% (no x1.5
  any more) and the removed HP becomes Shield HP [assumed].
- Heaven's Authority: Calling Light costs 3 energy; its Sheeas have 50 base HP
  and scale like Skeletons (text only).
- 1 energy a turn flat; the energy-gain stat is a percent chance, counted as
  its average per turn. You open a fight with a full pool (assumed).
- Blasphemy's Notch pays only a move costing 3+ energy. Ice Shards (scroll, 3)
  and The Right Angle (Miner, 3) are dumps; Poison Fan (2) never is.
- Heresy: you enter in Dark Wing; Force builds in the wing you stand in, so
  Light Force costs a Meditate turn first. Force per hit is unstated.
- Ages Pages: +5 crit flat (already in `gearPctBonuses`); Corrupt Power stacks
  +10 more in Blasphemy/Tyranny, capped at 2 by a bug; nothing in Heresy
  (Corrupt Power bugged there). Patch 2026-09: the spend's crit bonus went
  45 -> 35 (the site's DMG calc toggle now adds +30 over the standing +5).
- Crystal Sphere: +5 crit flat and, since the 2026-09 patch, +5% crit damage
  (+0.05 on the multiplier) — both in `gearPctBonuses`, so `onSite`;
  "removes crit fatigue" is dead text — the mechanic went away in the Section 9
  rework.
- Wicked Crown converts *Physical* moves to Dark (site: `getEffectiveMoveType`);
  Shard of Blight is +25% to Dark moves only. Poison Fan is Poison — untouched.
- Boreas (2026-09 patch) turns *Physical* and *Magic* moves into Ice (site:
  `getEffectiveMoveType`; engine: `typeOf`), checked after Wicked Crown
  [assumed]; a summon's own attacks keep their type. Frost Stacks: +10% damage
  and +4% DR per Ice move, capped at +50% / 20% (5 stacks).
- Arborivia: Overgrowth +10 crit/+10% DR/+20 SPD when cast at max HP; Leaf
  Thrust is 2×3 hits with +50 crit; Foliage is level 15; base 1/3/2/3/1.
- Boreas's Inner Frost heavy-stuns *you* for one turn before it lands (two
  before the 2026-09 patch).
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
| The Shadow Form toggle gave ×1.30, not ×1.56, and no crit | the DMG calc merged a mastery into its base entry with `max`, so Shadow Master's ×1.3 replaced the form's own ×1.2 | a mastery marked multiplicative now multiplies into its base (1.2 × 1.3 = 1.56); an Assassin with Shadow Form on gets +20 crit chance in the readout. **Superseded 2026-09-21:** the two are added, +20 + 30 = +50 (§12, "Additive damage" below) |
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

**Settled 2026-09-21** (was open, for the owner): whether Invisible's +100%
multiplies the final hit. It does not: it is +100 in Stealth Strike's Multi sum
(§12), so it scales `(Base + Flat)` together with every other percentage - see
"Additive damage" below.

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

**Fixed (2026-09-14): 'cold' had the same gap.** 'chilled' and 'frozen' folded to
it, but "applies 3 Cold" (Ice Shards) and Boreas's Cold Application never
registered, so Frozen Diadem's and Icerind's Cold-gated bonuses never paid on an
Ice kit. 'cold' is now a status word. No boss in the data is immune to Cold, so
no fit penalty moved, and golden builds are unchanged. Yar'Thul's "Immune to the
Inferno status" is deliberately still unread: Inferno folds to Burn here, and
reading it would penalise every Burn kit for an immunity to a different status.

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

## Balance patch (2026-09-16)

**Source:** the game's balance patch notes, pasted by the owner on 2026-09-16,
and the owner's answers on five points: what Rage Empower still does (a pure
Rage toggle), how Bloodlust stacks add up (they add), whether buffed stat
totals reach a milestone (they do), and - correcting the notes' "melee" and
"ranged" on 2026-09-17 - that the STR / ARC 110 perks go by type (Physical /
everything else) and that a Saint no longer needs 110 Arc.
Wherever the notes leave a point open, the reviewers' default was used; those
defaults are listed under **Assumed**. `ai-data.*` has been regenerated and the
suite run (see **Suite results**); the standing requests, the dated README and
`knowledge.js` figures and the golden soft misses are still to be re-measured
(see **Not modelled / open**).

**Berserker**

| Where | Change |
|---|---|
| `js/data-class-moves.js` | Bloodlust is a status: +5% damage a stack, gained by attacking or being attacked, heals you below half health, lost every turn unless you are in Rage, where each stack is +10%. Rage Empower only toggles Rage, which raises aggro and lowers Defense. Its 30%/65% HP-spend buff, 40% DR and 2-turn duration are gone; cost 1 and cooldown 5 are kept |
| `js/data-race-moves.js` | Calvariae's Frail Body no longer names Rage Empower as a TrueDMG move |
| DMG calc | Bloodlust row: a 1-20 stack counter and an "In Rage" switch, x(1 + 0.05 x stacks), or x(1 + 0.10 x stacks) in Rage, as one factor that multiplies with every other buff. Rage Empower is no longer its own toggle or an HP-slider readout. The old "x1.40 below 30% HP" was only ever tooltip text |
| `knowledge.js` | Bloodlust 50 at 0.5 uptime, `source: 'patch'`, no HP gate (was 65 with `hpGate: 'low'`: +52% effective on a committed Berserker, now +25%). Berserker keeps its low-HP stance with a new reason: the heal fires only below half, and Rage lowers Defense. Bloodlust is deliberately not in `STATUS_WORDS`, because `buildDoes` would file it as an enemy status |

Drauga's Enhanced Bloodlust is separate code and did not change. One side effect
of keeping the stance: a committed Berserker is still denied Stellian Core's
opener crit, although the toggle no longer costs HP before the first hit.

**Classes**

| Where | Change |
|---|---|
| Elementalist | Lightning Crash 20 (was 18), cooldown 8, Stun guaranteed when 6+ energy is spent; Blaze cooldown 4; Gale Uplift 7x2, cooldown 10 |
| Impaler | Blood Eruption 18 (was 15.6), cooldown 8; Bloody Burst 4.5x2 |
| Assassin | Poison Fan STR/75 + ARC/80 (was STR/200 + ARC/80 + LCK/100). The standing Assassin nuke below is therefore pre-patch |
| Arbiter, Darkwraith | Pronouncement costs 3 (was 5); Call Darkbeast costs 0 |
| Brawler | Crusher counts re-applied statuses and caps at +75%. The DMG calc kept x1.07 per status, capped at x1.75 (counter 1-9) - since 2026-09-21 it is +7 a status added to the sum, capped at +75 (counter 1-11; "Additive damage" below). Party Table hits Adjacent, and its Proficiency hits every enemy (Full AoE) |
| Monk | Flame Drop hits every enemy (Full AoE). Flame Drop Proficiency: 4% per absorbed burn stack, up to 40% (was 2.5% / 25%); its +25% base part and the calc's x1.25 toggle stay |
| Ranger | Verdant Archer: +15% damage a stack (was 7.5%), up to +150%, and +10% outgoing healing in place of the Speed buff; Nature's Wrath doubles the stack to 30%. Perennial Canopy and Stinger's arrows scale on SPD/80. Lightspeed: every Verdant Archer proc gives Speed equal to 10% of Arcane for 3T; its stacking autododge is gone |
| Lancer | Empowered Pierce costs 3 and deals x1.5 on a crit (`critDmgBonus: 50`, applied at the call sites `moveCritDmgMult` / `moveCritMult`; the pinned crit bodies are untouched). Discharge costs 2, cooldown 4, and stuns only on a crit. Poised Slayer: +10% damage per dodge, up to +50%, and it keeps its heal. Swift Fighter's Speed caps at +30%. Overload: +10% STR and LCK for 3T after a move costing 2+ energy. Not in the patch: the Empowering Pierce Proficiency toggle is now gated on Lancer, not Impaler |
| Build AI (Ranger, Lancer) | New PASSIVES entries: Poised Slayer (10 at 0.5) and Verdant Archer (15 at 0.6). New mastery kinds `statPct` (Overload, +10% STR and LCK at 0.8) and `statFromStat` (Lightspeed, Speed from 10% of Arcane at 0.6), with renderers in `explain.js` and `js/build-ai.js`. No mastery grants `dodge` any more. Overload's Luck reaches crit through the stat-row Luck, not the site's `rawLuck` |
| Site Luck and Speed | Overload's +10% LCK and Midas's stacks feed crit chance (`updatePecents`, in the order coag -> Overload -> Permuth -> Midas) and `getTotalStat`. Swift Fighter, Lightspeed and Overload are Stat Buffs toggles |
| Paladin | Holy Crash 18, STR/75 + END/150 (was 13, END/100). Holy Crash Proficiency is now a move rewrite to 20 base: the `builder.js` override and `MOVE_OVERRIDES['Holy Crash']` ship together, and `MASTERY_ABILITIES` lists it as `onSite` instead of +25% on every move. The 2026-09-13 audit rejected this rewrite only because the engine had no rewrites yet |
| Citadel, Lionheart, Blade Dancer | Blinding Vow cooldown 6; Sanctified Protection cooldown 6, and the link never breaks; Cauterisation 1 Taunt per hit (was 2); Simple Domain Taunts every enemy for 2T. Simple Domain Proficiency is now: Taunt lasts 5T, cooldown 6 -> 4 (text only) |
| Necromancer | Raise Dead also summons a Skeleton for every death this combat; Skeletons have 30 base HP. The Raise Death Proficiency note no longer says it "does nothing solo" |
| Soul tree, Midas, scrolls | Critical Point is +2% crit damage a rank (was 5%; site only). Midas: each proc also gives +5% LCK for 2T, up to 4 stacks. The DMG calc has a 0-4 counter; the engine does not price it (about +1.7% Luck on average). Marauder can use the Dark Slash scroll |

**Systems**

| Where | Change |
|---|---|
| Milestones (`statMilestones`, `MILESTONES`) | STR 110 "Physical damage increased by 20%." and ARC 110 "Magic damage (every non-Physical type) increased by 20%." (were cooldown cuts; site wording, owner's reading); SPD 110 "15% chance to auto-dodge attacks." (was 5%) |
| DMG calc | `getMilestoneDmgMult` joins the outside-multiplier chain: x1.20 on a Physical move at 110 STR and on any other type at 110 ARC, by the move's effective type (`getMilestoneDmgStat`), read from the buffed `getTotalStat`. Stinger's Physical stab and Poison arrows take their own perks. Summon attacks (`isSummonAttack`) get nothing. The milestone panel notes that a buff switched on in the calc can reach a milestone its total does not show |
| Build AI | `MILESTONE_CD_AFFINITY` is gone. New: `K.milestoneDmgStat`, `K.MILESTONE_DMG_TYPE`, `K.isSummonSlot`, and `optimize.js` `effectiveTypeOf` (the converted type, shared by `evaluate` and the stat line). `milestonesFor` returns `typeDmg[]`, which is added to a move's `pct` (additive here; the site multiplies). Milestones are read on the buff-down totals and on the buff-up totals (Overload / Lightspeed at full strength); a perk only the buffed total reaches is paid at the buff's uptime. The stat line names the moves the perk buffs. `verify.js` skips moves the milestone multiplies. Sheea's flat cut is now the only cooldown cut |
| Cursed status | Halves outgoing and incoming healing. The heal calculator gets "You are Cursed" and "Target is Cursed", x0.5 each (x0.25 together). The Seraphon tactic and the Self Cure and Piercing Grace notes are updated. Piercing Grace's game text, His Incandescence and the Cursed enchant are unchanged |
| Poison | Loses 20% of its stacks each turn (encyclopedia text). Open Hand's note is updated; the Open Hand, Ecdysis and Ophimar row texts are unchanged |
| Heaven's Authority | Calling Light costs 3 (was 2). Sheeas have 50 base HP and scale like Skeletons (text only). The move name, cooldown 9 and the Sheea attacks are unchanged, and the encyclopedia now lists it as a Summon (was Buff) |
| Paranoxian Crux | Max HP -75% into Shield HP (was x1.5, then -90%). The site's HP split and the `verify.js` examples are updated; the engine still treats it as a note |

**Races**

| Where | Change |
|---|---|
| Boreas | Physical and Magic moves become Ice: on the site `getEffectiveMoveType(type, m)`, in the engine `typeOf` and `buildDoes`. Wicked Crown is checked first, and summon attacks are skipped. Frost Stacks: +10% damage and +4% DR a stack, capped at +50% / 20% (was 20% / 10% a stack, capped at 200% / 70%); the calc counter stops at 5. Inner Frost heavy-stuns you for 1 turn (`SELF_STUN` 1) |
| Vydeer | Gains one Sense per dodge, at most once a turn; a hit taken above 4 Sense costs 4 Sense and is autododged. Sense Expansion: an extra Sense per dodge for 3T (no longer +3 Sense). Soul Reversal spends all your Sense for +10% damage per Sense (plus autododge) to all allies until your next turn: DMG calc x(1 + 0.10 x Sense spent), counter 1-10 |
| Vastayan | Gale Pulse 10 (was 7); the Lesser Sylph learns Nature's Embrace; Spirit Awakening no longer stuns you afterwards (setup note updated) |
| Ophimar, Amorus | Blacktongue lasts 3T; Sinister Gaze cooldown 12 |
| Build AI smoke | `O.evaluate(b, { goal: 'damage', dmg: 'average', boss })`, Impaler (Ch), level 50, STR total 110 (`investedForTotal`): Calvariae 78.25 (39.12 against Handaconda), Boreas 78.72 either way (Blood Eruption). The Ice conversion bypasses Handaconda's 0.5 Physical/Arcane resistance, and no boss resists Ice |

**Gears**

| Where | Change |
|---|---|
| Ages Pages | The spend raises crit to +35 (was +45); the DMG calc toggle adds +30 on top of the standing +5. `FORM_GEAR` is unchanged |
| Crystal Sphere | +5% crit damage: `gearPctBonuses` `"crit-dmg": 0.05`, mirrored by `model.js`, still `onSite` |
| Shadow Gauntlets, Infected Skin | Lifesteal 3% (was 5%); DR +10 (was 15), with the +165 spend unchanged |
| Stone Brand | Stone Skin cooldown 999, and its DR is permanent |
| Tainted Quiver | The first hit always applies 3 Sundered; later hits have a 15% chance to drain 1 energy (not priced) |
| Grain Of Balance | Grants half of the points lost, not a quarter; the "BUGGED" labels are gone |
| Frostburned Rune | +7.5% damage against a target that has both Cold and Burn: a toggle in the DMG calc, only a note in the engine, which cannot gate on two statuses |
| Encyclopedia | Crit Fatigue is described as removed |

**Bosses**

| Where | Change |
|---|---|
| `BOSS_DATA` HP (normal / Corrupted) | Sentient Darkness 250 / 375, Yar'Thul 800 / 1200, Thorian 2000 / 3000, Seraphon 3500 / 5250, Arkhaia 4000 / 6000, Handaconda 6000 / 18000; Metrom's Vessel unchanged at 10000 / 15000. HP changes only the reported kill turns, never the score |
| Seraphon | No longer immune to Cursed. `bossProfile` stops reading that immunity, so a Cursed kit is no longer charged for it there; `punishesDebuffs` is unchanged |
| Handaconda | No longer immune to Poison, and `BOSS_TACTICS.immuneStatuses` is removed, so no boss has an immunity known only from players any more. The `explain.js` line for such immunities is now tested with a throwaway entry. Thousand Screams 12.5%, One More Time cooldown 6, regen 10 |
| Yar'Thul, Thorian, Metrom's Vessel | Inferno bypasses Resist. Overflowing Curse applies 2 Plague when the QTE is failed (its cooldown stays 4). Oblivion is true damage again: 75% of max HP when Corrupted, and the same for Shadow |
| Thief, Grass Spirit, Zombie Mushroom | Can no longer dodge (text only) |

The bosses changes should leave the goldens as they are: the Impaler kit never
applies Poison, and an immunity charge is the same factor for every build of a
class, so it cannot reorder them.

**Suite results.** The hard `arc >= 110` in `golden/saint-healer.json` failed.
Without the ARC 110 cooldown cut, the Saint healer line moves from STR 33 /
ARC 110 / END 102 / LCK 10 to STR 60 / ARC 25 / END 102 / LCK 61, taking LCK 60
for its +35% healing. The owner confirmed (2026-09-17) that a Saint no longer
needs 110 Arc, so the golden no longer expects it; END 60 stays hard.

The patch also exposed a scorer weakness: once the Berserker was repriced, the
Support role went to a Saint on 96 HP (Endurance 19, Speed 154) - a build the
engine had always made for a forced Saint Support, just never picked. The
`party` archetype read half of raw HP; it now reads effective HP through the
damage reduction formula like the tank and healer do, and Support builds a
Blade Dancer on about 200 HP.

The "two roles produce a build between the two" bar went from 0.4 to 0.35 of a
pure tank: the lifesteal nerf cut the DPS+Tank blend's sustain (1832 -> 1284 on
the tank score) while the pure Paladin tank got tougher once it priced its
Warrior-tree capstones (2950 -> 3213). The blend is still 13x a pure DPS build's
toughness and 74% of its damage.

Two tests were re-pinned for intended changes: the Corvolus "opens on the
covenant move" check uses a Slayer (Empowered Pierce's x1.5 crits now rightly
out-burst Death Curtain on a Lancer), and the Critical Point source check
matches within a line (its desc holds `{v}`).

**Assumed** (reviewers' defaults, all [assumed]):

- Summons: summon attacks get neither the STR/ARC perk nor the Boreas conversion. Heaven's Authority's Sheea rows count as summons; Arbiter's Base Move does not.
- The patch's "Arcane" means the site's Magic.
- Boreas: Wicked Crown converts first. Element-gated buffs follow the converted type, so Blizzard, Cast Amplify and Arcane Ritual now reach converted moves, while Elemental Master, Surprise Package and Fractured stop reaching them. No boss resists Ice (Handaconda has no Ice column, so x1.0). Big Sword lifesteal still reads the written type.
- Bloodlust: counted as 5 stacks in Rage at 0.5 uptime. Berserker stays in the low-HP stance. The Bloodlust quote is a paraphrase, not the in-game one. Rage Empower keeps cost 1 and cooldown 5.
- Crusher: stacks multiply (x1.07 each), capped at x1.75 (9 applications), and re-applied statuses count. Superseded 2026-09-21: +7 each, added, capped at +75 (11 applications).
- Poison Fan keeps ARC/80.
- Flame Drop Proficiency keeps its +25% base part.
- Nature's Wrath gives 30% a stack under the 150% cap.
- Lancer: Poised Slayer +10% per dodge, capped at +50%, counted as one stack at 0.5. Swift Fighter +20% per dodge, capped at 30%. Discharge stuns on crits only. Empowered Pierce keeps its stun chance.
- Lightspeed and Overload: Lightspeed is one refreshed buff, `Math.round(10% of ARC)`, at 0.6 uptime. Verdant Archer is one stack at 0.6. Overload's uptime is 0.8.
- Midas: the damage proc stays, and each proc adds one Luck stack. The notes do not say whether a new proc refreshes the 2T timer, or whether Deep Focus affects the proc.
- Skeletons and Heaven's Authority: only the text and cost changed. Call Skeleton keeps its ARC/4 HP scaling, Calling Light keeps its name and cooldown 9, and the Sheea attacks are not rescaled.
- Cursed: x0.5 each way. Handaconda's regen counts as healing, so Cursed halves it (plan line).
- Poison: removes 20% of the stacks.
- Bosses: Corrupted HP is 1.5x the new HP, and Handaconda's is 3x (18000). Neither was checked in game. Arkhaia's Malfeasance summon keeps 360 HP, now more than a normal Sentient Darkness (250); not checked in game. Corrupted Oblivion is 75% (the repo had 60%). Inferno's Resist bypass is written for the status, so it covers Magma Pillar too. Handaconda's regen of 10 is HP a turn. One More Time has only its cooldown (6) and the Thousand Screams link.
- Ages Pages: +30 per spend on the site; `FORM_GEAR` is kept.
- Grain Of Balance: the patch wording is used; how the points are split is unconfirmed.
- Tainted Quiver's 0.3 uptime is a descriptive estimate.
- Simple Domain Proficiency replaces the ranged parry. Holy Crash Proficiency keeps its Taunt clause.
- "The Axe class" is Marauder.
- Paranoxian Crux: the removed 75% still becomes Shield HP.
- Lesser Sylph's Nature's Embrace uses the Grass Spirit's figures (cost 2, cooldown 4, heals 40% of max HP). Sinister Gaze is 12; the repo had 7, though the patch says it was 8. "Blinding Vow" keeps the site's spelling.
- Vydeer: "10X%" means 10% per Sense spent. The "above 4 Sense" wording is kept as written. The 1-10 Sense counter is a UI limit, not a game cap.

**Not modelled / open:**

- Berserker capstones: Berserkin Time, Intense Rage, Head Splitter Proficiency and Rage Empower Proficiency still describe the old Bloodlust and Rage Empower, with their texts and prices unchanged. Heavy Training, Carnage and Head Splitter are treated as unchanged.
- Berserker unknowns: Bloodlust's heal amount, stack gain rate and stack cap; how much Rage raises aggro and lowers Defense; and the turn spent casting Rage Empower.
- Ophimar "Chaos Orb: ?!": the notes give no effect, so nothing changed.
- Boss drop-rate increase, and the dodge chances of Thief, Grass Spirit and Zombie Mushroom: neither is held anywhere in the data. VydeerScale is not in the repo.
- The "new poison gears" the patch cites are not in the data.
- Poison decay rounding is unstated, including whether 1 stack ever reaches 0. Poison damage over time is priced nowhere.
- Skeleton and Sheea scaling: nothing computes summon HP, the ARC/4 string is never evaluated, and the DMG calc does not apply "Sheea damage scales like Skeletons". The patch says Heaven's Authority has its own move now, but gives no name or cooldown for it.
- Corrupted HP scaling (1.5x, Handaconda 3x) is a reviewer default. Check it in game.
- `index.html` race recommendation cards (Boreas, Vydeer, Stultus) still describe pre-patch reasoning.
- Vydeer's Mind's Eye, settled (dev post, owner-corrected 2026-09-21): the reflected hit's base damage is capped at 20, and Sense adds 10% a stack up to **+40%** (the post said 50%; the owner says 40%). Text only - the reflect is not priced anywhere, since its size depends on the hit it answers. Verdant Archer's quote still mentions the removed Speed buff.
- Not priced by the engine: Soul Reversal's autododge; Frost Stacks (Boreas `RACE_ROLES` are still status/tank); Verdant Archer's healing; Poised Slayer's heal; Crusher; Midas's Luck stacks; Tainted Quiver's energy drain. The engine fights a single target, so Party Table's Adjacent hits and Flame Drop's AoE do not register either.
- `STAT_DECAY.pastRate` was tuned on "60 End, 110 Arc, rest Str" beating a higher-End Saint line. The removed ARC 110 cooldown cut justified that line, so re-check the rate along with the Saint golden.
- Existing gap this patch makes more visible: `optimize.js` `resFor` maps Magic to 'Arcane', a column only Handaconda has.
- Re-measure after `extract-data.js`:
  - the four standing requests;
  - the dated figures in README.md and `knowledge.js`;
  - the ~150 heal a turn in the test.js Shadow Gauntlets comment, now about 90;
  - every golden soft miss (berserker-crit, impaler-handa, paladin-tank), each recorded here with its reason.

## Additive damage (Withered Grove §12, 2026-09-21)

**The rule** (game changelog §12, "Part2 New Damage Formula"): `beforeDR = (Base +
Flat - Defense.Flat) * Multi * Affinity`, `finalDamage = afterDR + TrueFlat * TrueDR *
TrueMulti`. "Multi is the additive multiplier bus: every gear, enchant, race passive
or buff that says '+X% damage' adds X directly into Multi ... five different +10%
sources gives you Multi = 1.5, not 1.10^5." Owner (forwarded from players,
accepted): status effects on the target and crit damage stay multiplicative. So a
hit is

    main = (Base + Flat) × (1 + ΣMulti / 100) × Affinity × ΠTargetStatus × Crit
    hit  = main + TrueFlat

**Where it lives (site, done 2026-09-21).** `js/builder.js` `getDmgMulti(m, effType,
energyAfter, isCrit)` is the only place a hit's sum is totalled and returns
`{ pct, terms: [{ label, pct }], mult }`; `getOutsideDmgMult(m)` wraps it for every
damage path (ordinary, no-scaling, multi-hit, Stinger's parts, Crucible,
Discharge, Rending Barrage's extra hit, summons, Self Destruct) and adds the
crit-only ratio. `dmgRowPct` prices one DMG BONUS row, `getActiveDmgTerms` the
switches that are on. The working prints the sum with its terms, largest first,
`× 3.08 [+207.5%: Stealth Strike +100, Stellian Core +30, Cursed +30, …]`; the
statuses as their own multiplied step; True Flat as the last step. The panel rows
print `+X%`; target statuses keep `×`. The "additive damage (Withered Grove §12)"
test group runs this code.

**Where it lives (Build AI, done 2026-09-21).** `optimize.js` `evaluate` prices every
move's figures as `raw × M.dmgMulti(P) × crit + True Flat`, with `raw` =
`moveDamage` × the boss's resistance and P ONE sum: traits, passives, shards, the
enchant, gear, mastery abilities, STR / ARC 110, a move's energy scaling (Carnage,
Lightning Crash) and the move's own conditional term (`K.MOVE_CONDITIONAL_DMG`); the opener adds the setup
buffs and `openerDmgPct` to that same sum, the sustained figure their uptime
share. `model.js` holds the composition (`dmgMulti`, `critOnlyRatio`,
`trueFlatDmg`, `trueFlatHits`). What changed, and why:

| Engine term | Before | Now |
|---|---|---|
| Setup buffs (Shadow Form, Cast Amplify, Absolute Radiance, Lesser Empower, Blizzard, From Sky to Soul), `openerDmgPct` | `(1 + P) × (1 + openPct)` "so the buffs compound" | terms of P |
| Carnage's energy (+20 an energy past the first) | a separate factor, and DROPPED by the ramp-free and stat-setup openers (Crystalized Star, Flourish) | a term of P on every figure |
| Lightning Crash's energy (+12.5 an energy past the third) | not priced at all: `ENERGY.scalingMoves` listed only Carnage, although the site scales every move whose data carries `energyScaling` | a term of P, read from the move's own `energyScaling` (`K.energyScalingOf`, `optimize.js energyScalingPct`) like the site's `getEnergyBonusPct`; a test runs both at every pool size (follow-up, ENGINE_V 54) |
| Stealth Strike | `MOVE_OVERRIDES` base 10 → 20 for an Assassin at 17+ | +100 in P while Shadow Form is in the kit: `INVISIBLE_UPTIME` (0.5, shared with Shadow Master) of it on the plain and sustained figures, all of it on the opener; said in the write-up |
| Shadow Master | 15 in P and 15 in `openPct`, which multiplied | the same split, now both in one sum: +30 beside Shadow Form's +20 on the opener |
| Devastating (`critDmgPct`) | `critDmg × (1 + %)` | `critDmg + %/100`: +16% crit damage is +0.16 on the multiplier |
| Stat-setup crit (`buffedCrit`) | missed the mastery crit and paid an unmet gear crit | the same terms as `critChance` |
| Empowered Pierce (`moveCritMult`) | ×1.5 on the crit share | +50 in the crit sum: the crit share × `critOnlyRatio(P, 50)`, priced at each figure's own sum |
| Blooming Eye | not modelled | +5 True Flat a hit (`trueFlatHits`: a two-part move's second part counts its own hits), after the crit; `onSite` in `GEAR_PASSIVES`; the +35 spend priced on the form nuke (`FORM_GEAR`) |
| Blasphemy's Notch | the dump × 1.30 | +30 in the dump's sum (`notchedDump`, from `ctx.dumpTerms`); True Flat gains nothing |
| `verify.js` damage gate | every old multiplier exactly 1; Stealth Strike skipped | `getDmgMulti(...).pct === 0` for the move (both Stinger parts); a missing accessor is a harness error and "0 compared" is a failure. The site's old multiplier wrappers (`getActiveDmgMult`, `getShardOfBlightMult`, `getBlizzardMult`, `getMilestoneDmgMult`), kept only for this gate, are removed |
| One-move masteries (Blaze, Carnage, Poison Fan, Crushing Strike, Lightning Crash, Head Splitter, Light Burst, Bloody Burst, Flame Drop, Blazing Barrage Proficiency; The Big Sword on Strike) | in `ma.dmgPct`, so in EVERY move's sum (Blaze Proficiency put +24 on Lightning Crash) | a `move:` gate: a term of that move's sum only (`ma.moveDmg`), as the site's `getMoveInnateTerms` (follow-up) |
| Stinger | one sum on its written type (Poison): ARC 110 reached the Physical stab, STR 110 never could | each part takes the sum, setups and resistance of its own type (`MOVE_OVERRIDES` `partTypes`, `K.movePartTypes`), as the site's per-part `getDmgMulti` (follow-up) |
| Discharge Proficiency (Lancer cm2) | a note; the single hit priced | `MOVE_OVERRIDES` `ratios` 1 / 0.38 / 1/3 / 1/3 (×2.05), True Flat on each of the four; `verify.js` reads the site's "4 hits — … = N" total. A Lancer now nukes with Discharge (Magic), so the element-gate test moved to a Rogue (follow-up) |
| The `potential` burst with an opener or stat-setup crit | the AVERAGE crit, so a prepared burst could score under the plain crit hit | the landed crit, as the plain hit (follow-up) |
| Blasphemy's Notch on the site | a switch that reached every move | a term of a 3+ energy move's sum only (`notchPctFor`; Self Destruct, cost 2, none), as the engine prices it (follow-up) |
| Corruption forms and True Flat | Heresy's crit ratio, Tyranny's Condemned, the Ages Pages crit ratio and (after the Notch) Blooming Eye's own spend multiplied the whole figure, True Flat included: a Blooming Eye Berserker's Heresy line read +69% for +34% | each factor scales the figure WITHOUT its True Flat (`ctx.hitTrueFlat` / `sustTrueFlat`, the terms' `trueFlat`; `K.formBaseTrueFlat`), the Eye's spend is added after (`formGearCrit` `trueFlatAdd`), and `corruptionDamage` composes those parts, never their products (follow-up) |
| Devastating in the write-up | "Crit damage" printed the engine figure only | also the site's, which leaves Devastating out (the engine scores it, the site does not wire it) (follow-up) |

Effects worth knowing: every crit build's damage figure fell, mostly because ten
Devastating orbs used to double the crit multiplier (a crit Berserker went 5.2x →
3.6x) and because the setups and Carnage's energy no longer compound. The Amorus
Assassin no longer reaches crit tier 1 on its own (it parks on LCK 110 at 82%);
the tier-crossing test moved to a Blade Dancer. The golden hard keys still pass.
Every corruption-form factor - Tyranny's Condemned, Heresy's crit, the Ages Pages
crit ratio, the Spike's +40 - scales the nuke WITHOUT its True Flat, and Blooming
Eye's spend is added after them (the table's last rows). The parity group "the Build AI
composes damage the way the site does" runs the site's composition on the
engine's own terms for a Berserker, a Lancer, an Assassin and an Elementalist
(Lightning Crash, whose energy term is checked against the site's); for the
Assassin and the Elementalists the site's OWN sum, nothing injected, must equal
the engine's.

Each decision and its source:

| Term | Decision | Source |
|---|---|---|
| Every parsed "+X% damage" row, soul tree, type-gated passives (gates kept), shards, race / gear / weapon / scroll / mark buffs | one Multi term each | §12 "every gear, ... race passive or buff" |
| Enchants: Cursed +30 / +20 vs Sundered (the higher only), Inferno +20, Midas +15, Reaper up to +25 | Multi | §12 names enchants |
| Self statuses and buffs: Bloodlust, Overheat **8n** (was 1.08^n), Enhanced Bloodlust, Frost Stacks, Soul Reversal, Bulk Up 20n, Absolute Radiance, Stellian Core, Blood Eruption Prof, Blight, Darkbeast cores, Blasphemy Notch ... | Multi | the owner's exception covers the TARGET's statuses only |
| Team buffs: Rallying Shout, Lesser Empower, Arcane Ritual, Surprise Package, **Cast Amplify 20n** (was 1.2^n), Blizzard (Ice) | Multi | §12 |
| Internal stacks: Sands Of Time 20n (was 1.2^n), **Crusher min(75, 7n)** (was min(1.75, 1.07^n); counter now reaches 11), Oppression min(25, 5n) | summed, never compounded | §12 "adds X directly" |
| STR / ARC 110 (+20), energy scaling (Carnage, Lightning Crash), Shard of Blight (+25 Dark) | Multi | §12 |
| Move-innate %: Blaze Prof 15 (30 vs burning), Blaze +25 vs burning, Blazing Barrage Prof +20 vs burning, Slash Barrage +30 vs bleeding | that move's sum, on the same condition as before: the vs-burning terms only on the "vs burning" side line; Slash Barrage always, as it always applied | §12; spec |
| Shadow Form +20, Shadow Master +30 | **+50, two terms** (`MASTERY_ADDS_TO_BASE`), not ×1.56. The `/multiplicative/` text test is gone: stale wording must not flip a buff's class | §12 has no multiplicative bus for buffs on normal damage (TrueMulti only scales TrueFlat); the play report proved both apply, and 1.5 is within its noise |
| Stealth Strike from Invisible | **+100 in that move's sum** (new switch), not a doubled base | its text is an ordinary "increases damage dealt by 100%" |
| Empowered Pierce's "+50% on a Critical Hit" | +50 in the sum of the crit figures only | spec; "more damage" is ordinary buff wording, the crit multiplier is its own stat |
| Spirit Awakening +50 | summon attacks only (`isSummonAttack`) | its text: "damage buff to summons"; it used to reach every move |
| Metrom's Grasp +40 | never a direct hit; its rows say "DoT only" | its text: "for DoT effects" |
| Vulnerable (×1.25 with Crusher), Hexed, Fractured, Crucible's forced Vulnerable, Tyranny's Condemned, both Sinister Gaze reflections (Bulk Up keeps 1.2^n) | target statuses: multipliers, with each other and with the sum. Condemned and the Gaze reflections moved OUT of the buff product | owner; Bulk Up's own text "Defense decrease is multiplicative"; Crusher's text "now deal 25%" |
| Crit (2 + adds, +1 a tier, Overcore +1) | unchanged, on `main` only | owner |
| Crystalline Spike | Flat, unchanged placement | §12 |
| Blooming Eye | **True Flat**: +5 a hit, +35 on its 100 Corrupt Power spend (new switch), added after the crit and statuses | §12: "a separate channel that skips DR and Affinity" |
| One For All −30 | not modelled on the site, so nothing | spec |
| `armourMult` | removed (it was always 1) | dead code |

**Settled:** the open question from 2026-09-13, whether Invisible's +100% multiplies
the final hit - it does not. Stealth Strike's +100 is a Multi term like any other
buff, so it scales `(Base + Flat)` together with the rest of the sum; the Spike's
+5 rides it exactly as far as every other percentage does.

**Kept as they were** (odd, not covered by the spec): Frosted AOE takes the switches'
sum, Condemned and the Gaze reflections but not Vulnerable/Hexed/Fractured;
DeathBeak's proc takes the enchant alone; Rending Barrage's extra hit has no Flat
and no crit; Aspect of Maladaptation (+30, an incoming-damage effect) and
Coagulated Finger Nail (stats and +1.5n damage) still count as damage rows; the
personal and team Cast Amplify rows can both be on. True Flat (new) lands on
every hit the working prices - Stinger's two parts, Crucible's three hits,
Discharge's four, Rending Barrage's extra hit, Parry Counter and summon attacks
included - and not on Self Destruct (no Flat either) or the side procs (Frosted
AOE, DeathBeak, Vastic bombs). Whether Blooming Eye reaches a summon's hits is
unstated; it follows Flat there.

## When the game updates

`node tools/ai/extract-data.js` → `node tools/check-data.js` → full suite →
`--strict-golden` → `verify.js` in the browser → re-run the standing requests
(Saint healer, Impaler Handaconda, Berserker Carnage, Assassin nuke) and diff
the write-ups. For every new item: is it in `gearPctBonuses` (then `onSite`)?
Does its text gate on a status, an element, full health, or your own crits?
For every new move: does it cost *you* anything — HP, turns, a stun?

## Standing reference: the Assassin nuke

**(pre-patch; re-measure)** The line and figures below date from 2026-09-13.
They also predate the §12 additive damage (2026-09-21), which lowers every
Assassin figure: Devastating now adds to the crit multiplier, Shadow Form and
Shadow Master are +50 in the sum, and Stealth Strike is +100 in its sum rather
than a doubled base (Poison Fan stays the nuke on "assassin nuke biggest single
hit": 464 cold, 672 prepared on 2026-09-21).
In the 2026-09-16 patch, Poison Fan lost its Luck scaling (it is now STR/75 +
ARC/80), and STR/ARC 110 became +20% damage perks. So the pure-Luck line and
these numbers may no longer hold. Re-run "assassin nuke biggest single hit"
after `extract-data.js`, write the new line and figures here, and keep these
as history.

Arborivia, 150 Luck (210 on the site row), Primordial Dagger, Stellian Core,
Crystalline Spike / Yar'thul's Wrath / Band of Crushing Force / Coagulated Finger Nail,
Arcane Robes,
Traveling Pasmark, Miner, Absolute Radiance, Cursed, 3 Reversing + 2 Empowering
+ 2 Striking, mastery 2-0-0, Cult of Thanasius. Shadow Form → Absolute Radiance
→ Poison Fan: 946 cold, 1,411 prepared (pre-patch; re-measure), at 110% crit, with Crystalline Spike's flat
damage per hit and crit tiers adding +1 (2026-09-13). It read 1,283 before the
Spike was counted, 1,266 before the Luck 25 crit bonus, and 1,392 when every item
was priced at T6. Permuth on Luck
(not counted) is +68% and a coin flip. Every hybrid line loses to pure Luck.
