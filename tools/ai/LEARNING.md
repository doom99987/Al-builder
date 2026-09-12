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

## When the game updates

`node tools/ai/extract-data.js` → `node tools/check-data.js` → full suite →
`--strict-golden` → `verify.js` in the browser → re-run the standing requests
(Saint healer, Impaler Handaconda, Berserker Carnage, Assassin nuke) and diff
the write-ups. For every new item: is it in `gearPctBonuses` (then `onSite`)?
Does its text gate on a status, an element, full health, or your own crits?
For every new move: does it cost *you* anything — HP, turns, a stun?

## Standing reference: the Assassin nuke

Arborivia, 150 Luck (224 on the site row), Primordial Dagger, Stellian Core,
Yar'thul's Wrath / Coagulated Finger Nail / Ages Pages / Crystal Sphere,
Traveling Pasmark, Miner, Absolute Radiance, Cursed, 3 Reversing + 2 Empowering
+ 2 Striking, mastery 2-0-0, Cult of Thanasius. Shadow Form → Absolute Radiance
→ Poison Fan: 819 cold, 1,392 prepared, 1,495 in Blasphemy. Permuth on Luck
(not counted) is +68% and a coin flip. Every hybrid line loses to pure Luck.
