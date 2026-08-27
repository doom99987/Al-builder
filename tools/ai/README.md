# Build AI

Ask for a build in plain English, get an optimised one back. No API, no network,
no token cost — it computes builds with the same maths `js/builder.js` uses.

Three front ends, one engine:

- **On the site**, admin only — profile menu → **AI**. See "Site integration".
- **CLI** — `node tools/ai/build-ai.js "..."`
- **Standalone page** — `tools/build-ai.html`, works straight off disk.

```bash
node tools/ai/extract-data.js                      # once, and after game updates
node tools/ai/build-ai.js "max damage crit lancer"
node tools/ai/build-ai.js "tanky build"
node tools/ai/build-ai.js                          # no request — still answers
```

Or open `tools/build-ai.html` in a browser. It works straight off disk.

## Site integration

`js/build-ai.js` adds an **AI** entry to the profile menu, shown only when
`window._sbIsAdmin()` is true — the same gate the Admin Panel uses. The check is
repeated inside `_openBuildAI()`, because the menu is rendered once and the
function is reachable from the console.

That gate is a client-side gate on a client-side tool. It keeps the entry point
out of the menu; it is not a security boundary and does not need to be, since the
engine only reads game data that is already public in `builder.js`.

**The engine is lazy loaded.** It is ~180KB with its data snapshot, and almost
nobody can use it, so nothing is fetched until an admin actually opens the panel.
Putting the files in `index.html` would have charged every visitor for it.

Because those files are injected at runtime, `index.html`'s `?v=` convention
cannot reach them — `ENGINE_V` in `js/build-ai.js` cache-busts them instead.
**Bump it whenever you change anything in `tools/ai/`**, and keep
`tools/build-ai.html`'s `?v=` stamps in step.

This has bitten three times, in all three front ends. The failure mode is nasty
because it does not look like a cache problem: the page loads fine and then dies
on the first call into a function the stale copy does not have. `test.js` now
guards it — it checks every engine script is stamped and that the two versions
agree.

The panel's **Load into builder** button goes through the site's own
`_unpackState` + `loadBuildState` rather than poking the DOM, so it can never
produce a state the builder would not accept itself.

## Checking a build you already have

Tick **Check my current build** and the AI reads whatever is in the builder right
now, scores it, and suggests a better version of the same build.

It reads through `getBuildState()` — builder.js's own serialiser, the one the
share links already use — so it sees exactly what you have, gear tiers, traits
and mastery included, with no separate DOM scraping to drift out of step.
`Share.fromState()` is the inverse of the packer.

Two decisions worth knowing:

**It keeps your class and race.** "Your build would be better as a different
class" is not advice anyone can act on. Set them in Advanced if you do want to
compare across classes.

**It infers what your build is FOR** from where your points went — an END-heavy
build is optimised as a tank, a LCK-heavy one for crit, an ARC-heavy one as
summons or as a caster depending on whether the class has summons in its kit.
Optimising an obvious tank as "balanced" hands back a squishier build and calls
it an upgrade. The inferred goal is shown, and Advanced overrides it.

The result is a **Now vs improved** table, a **What to change** list, and — when
the "improvement" costs something — a **Trade-offs** callout naming it:

> This build is stronger for Maximum damage, but it costs you something: HP drops
> from 447.7 to 69. If that matters more than the gain, set a different Goal.

An optimiser maximises one number; that can cost something you were relying on,
and colouring a cell red is not good enough.

## Mastery: the points and the abilities

A mastery tree gives two different things and the engine used to see only one.

**The stat points** — 29 nodes at 1 point each — were always counted.

**The six capstones** cost 5 points apiece out of 35 and their entire value is a
written ability. That text was invisible to the engine, so it bought a capstone
on branch colour: a damage Elementalist paid 5 points for an energy proc it could
not read, while `Element Mastery` (+15% to its whole elemental kit) sat unbought
on the other side of the tree.

Two layers feed it now:

1. `extract-data.js` runs **builder.js's own `parseDmgBonus`** over all 108
   ability descriptions and stores what it finds. The site already does this for
   its damage calculator; running the same function means the two agree by
   construction instead of by a replica somebody has to keep in step. 23 of the
   108 come out with a number for free.
2. `MASTERY_ABILITIES` in knowledge.js overrides and extends. A parsed number is
   only half an answer — `Overload` (+100%) and `Element Mastery` (+15%) both
   read as a percentage, and only one is close to always on. **`uptime` is the
   point of the table.** Without it the optimiser buys the +100% and never
   notices it needs the target stunned first.

Anything neither layer can read is reported under "Mastery abilities NOT counted"
rather than scored as zero, the same as gear passives.

## Damage: the formula, and why stats looked worthless

`model.js` computed, for each scaling term:

```
base + floor(stat / div)
```

The site computes (`builder.js:4080`, and its own printout says so):

```
base x (1 + SUM(stat / div))
```

Multiplicative, unfloored, summed before it is applied. Three differences, and
the worst of them lands exactly where it matters most: **Carnage is `1x20`**, so
`floor(STR/100)` on a base of 1 threw away the entire Strength contribution below
100 STR and most of it above. A Berserker's damage did not move when you gave it
Strength, so the optimiser learned to put nothing there and pour everything into
crit instead.

Every stat total agreed with the site perfectly the whole time. **Stats are not
damage**, and nothing here had ever compared a damage number. `verify.js` now
does, on every configuration it generates.

A few moves also do not use the damage and scaling printed on them — some
masteries replace both outright. Those live in `MOVE_OVERRIDES`, registered
through the ordinary QUIRKS mechanism so every consumer of the model picks them
up, `verify.js` included.

## Mastery pricing, by measurement

Stat nodes and capstones used to be priced in different units, which made the
comparison between them meaningless: a stat node was scored by the goal's WEIGHT
for that stat (0 to about 10), a capstone by its ability's PERCENTAGE. Stat nodes
won roughly three to one regardless of what was true.

What is true, measured on real builds: **five mastery stat points move a damage
build about 2.8%, and the capstone those same five points could have bought is
worth 7% to 24%.** It was pricing them almost exactly backwards.

Both are now measured with the real scorer, in one unit — percent of this build's
score. Eleven extra `evaluate()` calls per build, which is nothing next to the
thousands the search already runs, and it removes a whole class of "the weights
say X but the maths says Y" disagreement.

## Solo or party — asked, never inferred

Whether you are in a party decides whether an ability that protects four other
people is worth five mastery points. It is a required choice in the panel, and
the Build button refuses without it.

It is deliberately not inferred from the goal. Guessing was wrong in both
directions: plenty of people solo a tank to survive content they cannot
out-damage, and plenty take a damage build into a five-stack. A request that
reaches the engine without an answer is treated as solo **and told so**.

`PARTY_SPREAD` discounts team effects to the fraction of the group actually in
range — you cannot guard everyone at once.

## Bias audits

Two silent biases, both found by counting what the engine actually picks rather
than by reading the code:

**Weapon passives were never counted at all.** `gearPassiveTotals` looked at gear
and the artifact and nothing else. Five weapon series roll tier points and are
otherwise identical to the model, so the choice between them fell to whichever
one `bestOfSlot` saw first — **Dragon won 81% of builds**, while Primordial's
flat +20%, the largest unconditional weapon bonus in the game, was invisible.
They live in `WEAPON_PASSIVES`, keyed by series because that is how the game data
writes them (`itemPassives['Primordial']`, not `'Primordial Spear'`).

**Base classes were being rolled at max level.** About one build in ten. A
superclass needs level 15 and is roughly four times stronger — measured, Warrior
scores 552 against Berserker's 2279 — so those were not close calls. The class
pool now follows the level, an explicitly named class is still honoured, and
asking for a superclass below 15 gets a warning rather than a silent yes.

A third is inherent and reported rather than fixed: **33 of the 52 gears that
carry a passive are still unmodelled**, so gear whose value is its passive is
undervalued. `rankGear` at least scores the ones knowledge.js knows about — the
fourteen-item shortlist was previously cut on stat blocks alone, which dropped
Molten Carapace's +30% defence before the real scorer ever saw it.

## The WIP notice

The panel opens with an amber **WIP** banner above everything else, dismissible
with an ×. It is deliberately *not* remembered in `localStorage`: dismissing it
lasts the visit and it returns on the next page load. A warning nobody sees again
after one click stops being a warning the moment what it warns about changes —
and what it warns about is exactly the list under "Passives NOT counted" and
"What it does not model", which grows and shrinks with every edit to this repo.

## Advanced options

The panel has an **Advanced** section with dropdowns for goal, class, race,
weapon type, weapon, armour, enchant and level. Everything defaults to **Auto**,
meaning the optimiser keeps deciding it; anything you set becomes a hard
constraint that **beats the text**, and the answer lists it under "You chose"
rather than pretending it guessed.

Every list is built from the data snapshot, so a new class, race, weapon or
armour appears automatically after `extract-data.js` runs — there is no second
list to keep in step. Goals come from `ARCHETYPES`, so a new archetype shows up
there too.

Programmatically it is the second argument to `ask`:

```js
engine.ask('max damage', { klass: 'Impaler (Ch)', race: 'Nisse (20%)', level: 35 });
```

`Intent.applyOverrides` drops the assumption an override replaces, so a build
never claims to have guessed a level you typed in.

## Understanding what people type

Free text is matched in this order, and each step is there because the previous
one got something wrong:

1. **Vocabulary first.** Goal, stat and modifier words are matched on word
   boundaries and the words they consume are recorded. Names are matched
   afterwards and skip those words — otherwise "hit really hard" fuzzy-matches
   "hard" to **Bard** and silently builds the wrong class.
2. **Aliases.** Community shorthand — `necro`, `zerk`, `pally`, `sin`, `bd`,
   `ele`, `wraith`. These deliberately ignore the exclusion set above: `necro` is
   both a summon keyword and a class name and should set both. Add a line to
   `ALIASES` whenever the engine shrugs at something.
3. **Verbatim**, then **prefix** (`necroman` → Necromancer), then **fuzzy**.
4. **Fuzzy is Damerau-Levenshtein**, so a transposition costs 1 edit rather than
   2 — that alone is what lets `rouge` find **Rogue**. The edit budget scales
   with length (0 for ≤3 characters, 1 for 4–6, 2 for 7+), because short words
   collide and long ones do not.

Candidates are **scored**, not first-past-the-post, so a long verbatim match
always beats a short fuzzy guess. Adjacent word pairs are matched too, so
`blade dncer` resolves to Blade Dancer.

All of these currently resolve correctly: `necromancr`, `assasin`, `berzerker`,
`paladdin`, `wizzard`, `elementlist`, `blade dncer`, `martial artis`,
`darkwrath`, `impalor`, `lionhart`, `citdel`, `arbitor`, `brawlr`, `monkk`,
`hexr`, `rouge`, `vastyan`, `stultis`, `dulahan`, `estela`.

## Are the builds actually good?

The search is checked against a **fully-kitted random build of the same class and
race** — max-tier gear, all seven shards, full mastery, a mark, an enchant. The
optimiser wins in every archetype by 1.5x to 5.4x, and `test.js` asserts it.

It also independently rediscovers builds worked out by hand: asked for a max-damage
crit Lancer it lands on Stultus with the Vastic Glaive at 317.6% crit, against
312.9% for the hand-built version.

**Ties are not coin flips.** Weapons tie constantly, because a class whose moves
carry no stat scaling — Berserker is the clearest case — gets nothing *measurable*
from a weapon's 5 tier points. They are still 5 real stat points in game, so on an
equal score the tiered weapon wins. Left to list order the answer was a Ferrus
Sword, which reads as a mistake whether or not it scores the same. A non-tiered
weapon now only survives if it genuinely scores higher, which Jade's +30% healing
does for a tank; `test.js` asserts that across every request.

The real limit is not the search, it is **what the knowledge layer knows**. 51 of
the 80 gears carry a passive and those are often the whole reason to wear the
thing — `GEAR_PASSIVES` transcribes the clearly-numeric ones and everything else
is reported under "Gear passives NOT counted". Adding an entry there is the
highest-value edit in the repo: before it existed, a tank build never picked
Molten Carapace (+30% defence) or Egg Shelmet (a 10% max-HP shield), because it
could only see stat blocks.

## Races

`RACE_ROLES` says what each race is actually FOR, which the stat blocks do not
say and the engine cannot infer — most racial passives are prose.

This matters most for **random rolls**. Left to base stats alone the engine will
happily roll Daminos for a damage build: four lives and outgoing healing, which
is excellent and completely beside the point. Nobody min-maxing damage takes it.
So a rolled goal only draws from races whose roles suit it — `GOAL_RACE_ROLES`
maps which to which, and `test.js` asserts that 120 damage rolls never produce a
support or utility race.

Two races are marked `placeholder: true`: **Arborivia** and **Calvariae** have no
stat block in the data yet (all zeroes). They are excluded from every search,
because recommending one is recommending an unfinished entry rather than a build.
Asking for one explicitly still works.

Adding a race? Give it a `RACE_ROLES` entry — a test fails if any race in the
data is unclassified, so it cannot be forgotten.

### Niche tech

`RACE_TECH` is the exception list: a race that is off-role for a goal but
genuinely good at it because of a specific combo. A tech entry re-admits the race
for those goals **and pins the item that makes it work**, so the build really is
running the combo rather than wearing the race and telling a story. The build
always prints the reasoning — an unusual race with no explanation reads as a bug.

The one entry so far is **Permafrost**: Boreas applies Cold innately, and Frozen
Diadem pays +5% crit against Cold targets plus 10% for applying it. On most races
that gear is conditional and mostly dead; on Boreas the condition is always true,
so it behaves like flat crit chance. Both halves are in the game data.

**The table is deliberately sparse.** Most racial innate passives have NO text in
the data — only the names — so for most races there is nothing to reason from.
If you cannot point at the text, do not add the entry.

### Rotations and setup moves

Scoring a build by its best move in isolation throws away the idea of a setup
turn, and badly undervalues any race whose contribution is a *castable buff*
rather than a stat. `SETUP_MOVES` fixes that.

Corvolus is the case that prompted it. Nisse has a permanent +15% to Fire and
Magic; Corvolus has **Cast Amplify** (+20% to six elements, 1 energy, 9 turn
cooldown, 3 turn duration), **Arcane Ritual** (a chance at ~40%), and the best
base Arcane in the game. Judged on passives alone Nisse wins. Judged on an actual
turn sequence they split, and the engine now reflects that:

| Elementalist | opener | sustained |
|---|---|---|
| Corvolus | **679** | 527 |
| Nisse | 531 | **423** vs 423 |

So `burst` picks Corvolus and `damage` picks Nisse — which is the right answer to
two different questions rather than one blanket ruling.

Each entry carries `duration` and `cd`, and **uptime is duration/cooldown**: a
3-turn buff on a 9-turn cooldown is up about a third of the time. That is what
separates an opener from a permanent bonus. `reliability` discounts chance-based
effects, and `elements` gates the buff to matching move types — verified
behaviourally, since a physical kit must gain nothing from a magic-only buff.

`statBuff` entries route through model.js's existing **verified** buff flags
rather than a second implementation of the same arithmetic. That is how **Focus
Step** finally counts: LVL x 2 flat Speed is +100 at level 50, which is enormous
on anything scaling with Speed, and it had been unmodelled until now.

Builds with an opener print it turn by turn, and it goes into the Summary box.

## The build's reasoning goes into the Summary box

When a build is loaded into the builder, the panel writes a summary into the
builder's own Summary field: the build's name and one-liner, what it was built
for, its headline numbers, **why it works** (tech, race note, Overflow, gear
passives doing work, the corruption choice), what it is **weak to**, and what the
numbers do not count.

That means the reasoning travels *with* the build — into saved builds and into
any share link made from it afterwards, verified to round-trip byte-identical. A
build with no explanation is just a list of items.

**A limitation worth knowing:** for a *named* request the maths still decides,
and it usually lands on Dullahan, because +3 stat points every 10 levels is a
real quantified effect while most racial passives are not modelled at all. That
is honest rather than ideal. Each build now prints why its race was chosen, so a
wrong-looking pick is at least legible.

## Random builds

Two modes, and they are genuinely different rather than one relabelled:

| | rolls `balanced`? | says what it gave up |
|---|---|---|
| **Random** — "surprise me", "anything", "idk", "yolo" | yes | no |
| **Random min-max** — the checkbox, or "random min max" | **never** | yes |

That refusal is the whole distinction. A plain surprise may hand back something
merely sensible; a min-max roll commits to one specialisation and pushes it, then
names the cost:

> Min-maxed for speed / initiative, so it is deliberately bad at everything else:
> almost no health (71), barely crits, no meaningful block reduction.

A min-maxed build is *supposed* to have weaknesses — the useful thing is naming
them rather than letting someone find out in a fight. The checkbox also gets a
**Reroll** button, since the point is to try a few.

The two checkboxes ("Check my current build" and "Random min-max") untick each
other: they are different questions — improve what I have, versus invent me
something — and there is no sensible third behaviour.

It rolls a **goal first, then a class that actually suits it**. Rolling both
independently produced things like a speed Wizard: a valid build, a bad one, and
exactly what "surprise me" should not hand someone. Pass `{ seed }` to reproduce
a roll.

`FLAVOUR` in knowledge.js names the finished build. Entries are checked in order
and read the **computed** build, never the request — so the name can never
contradict what it is naming, and a build called Glass Cannon really does have no
health. `test.js` asserts that: a Glass Cannon must be under 200 HP, an Immovable
Object over 450. Add entries freely; it is the cheapest personality in the
codebase and costs nothing when nothing matches.

## The one rule

**It never dead-ends.** Every request returns a build. An empty string, gibberish,
a class that does not exist — all produce a real answer plus an honest list of
what had to be assumed. There is no "did you mean".

## How it fits together

| File | Job |
|---|---|
| `extract-data.js` | Pulls game data out of `js/builder.js` into `ai-data.json` / `.js` |
| `model.js` | The maths. A headless replica of the builder's stat pipeline |
| `knowledge.js` | **Everything you will want to edit.** Vocabulary, archetypes, traits, passives |
| `intent.js` | Text → structured request |
| `optimize.js` | The search |
| `explain.js` | Turns a build into readable reasoning |
| `share.js` | Encodes a build as a real arcanelineagebuilder.com link |
| `engine.js` | Wires it together, `ask(text)` and `link(build)` |
| `verify.js` | Proves `model.js` agrees with the real builder |

Data flows one way: `intent → optimize → (model + knowledge) → explain`.

## Share links

Every build comes with a URL that opens it in the real builder. `share.js` is a
replica of the site's `_packState`, wrapped in the same `bz_` container
`_loadById` expects.

The format is a **positional bit stream** — each id is an index into a list whose
order *is* the encoding. Appending to `races`, `gearSeries`, `enchantItems` or
`gearTraits` upstream is safe; reordering or removing entries breaks every link
ever produced, by this engine and by the site alike.

Because it is positional there is no "nearly right", so correctness is checked by
round-tripping a generated link back through the site's own `_loadById` +
`_unpackState` and comparing every field.

## Extending it

Almost everything lives in `knowledge.js` as a plain table.

**Teach it a word.** `VOCAB` maps what players type to what the engine
understands. Slang and misspellings welcome.

```js
tank: [..., 'unkillable', 'wall', 'juggernaut'],
```

**Teach it a goal.** `ARCHETYPES` defines what "good" means. `score` gets the
computed stats and returns a number to maximise; `statWeights` seeds the search;
`kitWords` breaks ties between classes.

**Teach it an item.** `QUIRKS` hooks into the maths. `model.js` never learns the
item exists.

```js
{ name: 'Frozen Diadem', hook: 'critChance',
  apply: (build, val) => /* … */ }
```

**Correct a class's weapon.** `CLASS_WEAPONS` overrides the inference. Add a line
whenever you see a class handed the wrong weapon.

**Warn about a mistake.** `TRAPS` attaches a caveat to any build it matches.

**Retire an item the game has taken away.** `UNAVAILABLE` lists what exists in
the data but cannot be used right now. The builder deliberately keeps those
items — it doubles as a reference, and old saved builds still have to load — but
nothing the engine *recommends* is allowed to be one.

```js
weaponSeries: { 'Ivory': 'an Easter 2026 event weapon, and the event has ended' },
items:        { 'Dread Fang': 'not in the game yet' },
```

A series entry covers every weapon in it, including ones added later. One line
removes an item from every search, from the Advanced dropdowns, and from any
build somebody loads for analysis; deleting the line brings it straight back.

Nothing is dropped silently. Ask for an Ivory Sword and the answer carries a
**"Couldn't use"** section saying what was left out and why; analyse a build
that already has one and the panel leads with **"Not usable in game"**.

`test.js` checks every name here still resolves against the game data, so a typo
fails loudly instead of quietly excluding nothing.

**Teach it a passive.** `PASSIVES` is keyed by race or class name and is
deliberately incomplete. Every build prints a **"Passives NOT counted"** section
listing the real passives on it that nothing scores — that list is the to-do for
this table. Add an entry and the next build uses it.

```js
'Slayer': [
  { name: 'Spear Training', kind: 'dmgPct', value: 10, whenWeapon: 'Spear' },
],
```

`uptime` discounts anything conditional, so "+25% below half health" competes
fairly against a bonus that always applies instead of dominating it.

## Traits and energy

The site stores traits and shows their labels but **does not apply them to any
stat** (`traitValue` is display-only). So the engine scores them as an overlay on
top of the verified base maths, and says so: the linked build will show lower
numbers than the engine reports, while being the identical build.

`knowledge.js TRAITS` says what each trait feeds, honouring the data's own `cap`,
`noStack` and `gearOnly` rules. The optimiser fills all ten copies (4 gears × 2 +
artifact × 2).

**Overflow** raises your maximum energy, which matters far more than it reads.
Any move that consumes the whole pool scales with the cap — Berserker's Carnage
gains 20% damage per energy past the first, so going from 5 to 7 max energy is
+40% on it. `ENERGY.scalingMoves` is where such moves are declared; `ENERGY.base`
is the assumed starting cap and **is not recorded anywhere in the site's data**,
so correct it there if the game disagrees.

### Adding gear, races, weapons

Nothing to do. Add them to `js/builder.js` as normal, re-run `extract-data.js`,
and the engine scores them immediately from their stat block. A `QUIRKS` entry
only matters if the item does something a stat block cannot express.

## Testing

Two suites, and they answer different questions. Run both after touching the
engine.

```bash
node tools/ai/test.js             # offline: parser, search, invariants, encoding
node tools/ai/test.js --verbose
```

121 checks, no dependencies, exit code 1 on failure so it can gate a release. It
covers intent parsing (including every misspelling and alias), build invariants
across 27 request styles, reading and improving an existing build, determinism,
the share container, model arithmetic, and cache-bust consistency.

It deliberately does **not** check `model.js` against `builder.js` — only the
real page can answer that:

```
serve the repo → open index.html → paste tools/ai/verify.js into the console
```

`verify.js` diffs 13 values per config against the live builder AND round-trips
generated share links through the site's own `_loadById` + `_unpackState`.
Anything other than `mismatches: 0` and `0 bad` means the engine's numbers cannot
be trusted.

### The tests are mutation-tested

Every invariant test was checked by deliberately breaking the code to confirm it
fails. Two did not, and both were fixed:

- the `endFlat` test only covered armour, because **no gear currently has
  `endFlat`** — the gear branch was unexercised by real data, so it now runs
  against a synthetic gear
- the duplicate-shard test passed for the wrong reason (`shardTotals` de-dupes
  too, so a duplicate scores identically and greedy never picks it) — it does
  catch a real regression, but only when both guards are removed

A test that cannot fail is worse than no test, because it reads as coverage.

The `analyse` tests were mutation-checked the same way — reintroducing the
null-override bug, breaking goal inference, dropping traits in `fromState`, and
ignoring the superclass all produce failures.

## After a game update

```bash
node tools/ai/extract-data.js     # re-read the data
node tools/ai/test.js             # will fail loudly if you forget the line above
```

A stale `ai-data.json` is the quietest failure this tool has — the engine keeps
answering, just with last week's game data. Three things catch it now: the test
suite re-extracts and diffs, and the **site panel compares the snapshot against
the live `builder.js` tables at runtime** and prints an "Out of date" warning
above the build.

Then re-verify the maths — serve the repo, open the builder, and paste
`verify.js` into the console. It drives the real builder through randomised
configurations and diffs **thirteen values** per config against the model: the
five stats plus HP, crit chance, crit damage, block DR, energy chance,
initiative and both heal stats. Anything other than `mismatches: 0` means the
model drifted and its numbers cannot be trusted until it is fixed.

### Two stat pipelines, not one

The single most important thing to know about `builder.js`: it computes stats
**twice**, and the two do not agree.

| | `getTotalStat()` | `updatePecents()` |
|---|---|---|
| feeds | the stat rows | HP, heals, block DR, initiative |
| rounding | `Math.round` on the percentage part, and again after Permuth | none |
| armour % | applied to every stat | `str`/`arc`/`spd` only (`STAT_PCT_KEYS`) |

So the END behind your HP bar is **not** the END on your stat row whenever you
wear armour with an `end%`. That is the site's behaviour, and `model.js`
replicates both paths — `totalStat()` for stat rows, `rawStat()` for everything
derived. Using the wrong one is silent: the stat check still passes while HP and
both heal stats sit a few points out.

The site also rounds **twice** on display — `calcPercentage()` returns an
already-`toFixed(1)` string that then gets rounded again — and every extra crit
source (Stultus, Frozen Diadem, the Vastic proc) is applied with its own
`toFixed(1)`. `round1()` uses `toFixed`, not `Math.round`, because the two
disagree on binary halfway values.

## Corruption forms have numbers, not just names

Picking a form is half an answer. The other half is what it does to your damage,
so all three are worked out and shown side by side:

```
Blasphemy  ←   1,644 prepared  ·  1,020 per turn  (+30%)
Heresy         1,264 prepared  ·    983 per turn  (+16% if Force covers 41 crit)
Tyranny        1,391 prepared  ·  1,081 per turn  (+10%, assumed)
```

Every figure traces back to the mechanics text in the game data:

- **Blasphemy** is fully derivable. Notch caps at your energy cap, a full stack
  spent on a damaging move is +30%, and banking one takes `cap` turns — so the
  sustained figure is deliberately much smaller than the burst one. This is also
  where Overflow shows up twice: it raises the ceiling *and* lengthens the bank.
- **Heresy** converts Light Force to Crit Rate 1:1, but the game never says how
  much Force a hit grants. So no crit is added. Instead it reports the gap to
  your next crit tier and what crossing it would be worth, which is the actual
  question a crit build has.
- **Tyranny**'s Condemned has no stated figure anywhere in the data.
  `CORRUPTION_ASSUMED.condemnedPct` is a **placeholder, not a measurement** —
  every number derived from it is labelled "assumed" in the table itself, not
  just in a footnote. Measure it in game and correct the one constant.

Two rules hold this together. Where the game states no number, none is invented
— it goes in `unknown` and stays out of the maths. And **none of it feeds the
optimiser's score**: the build is settled first and the form chosen afterwards,
so an assumed figure can never quietly change which gear you were told to wear.
A test asserts exactly that by deleting the model and checking the build is
byte-identical.

### Two rotations, not one number

Every headline figure stays **out of form**, because that is the ordinary case
and the one the build was optimised for. The form gets its own rotation instead:

```
Opening rotation — out of form
  Turn 1 — Cast Amplify.        Turn 2 — Arcane Ritual.
  Turn 3 — Carnage for about 1,264, against 903 with no setup.

Opening rotation — in Blasphemy
  Turn 1 — Cast Amplify.        Turn 2 — Arcane Ritual.
  Turn 3 — Soul Ignition.       Turns 4–10 — Bank Notch.
  Turn 11 — Carnage for about 1,644, against 1,264 out of form.
```

Presenting that as the first rotation with a bigger number on the end would be a
lie by omission: entering the form costs 100 Corrupt Energy, the payoff costs
seven more turns of banking, and Recoil backlashes for a share of your max health
when the form ends. Eight turns for +30% is a real trade, and it should look like
one.

Each form supplies its own steps from `CORRUPTION_DAMAGE[form].steps`. A step can
carry `turns` when it spans several (the Notch bank spans your whole energy cap)
and `isFinisher` when the step *is* the payoff move rather than setup for it —
without that flag Blasphemy printed Carnage on two consecutive turns. Heresy's
Light Force spend is `turns: 0`, so it renders as **Bonus action** rather than
being numbered as a turn it does not cost.

### In the builder itself

The site's damage calculator has a **Corruption** group next to Team Buffs,
showing only the form selected in the Corruption picker and off by default:

- **Blasphemy** — a Notch-spend toggle with steppers for Notch spent and your
  cap, interpolating the game's own 10% → 30%
- **Tyranny** — a Condemned toggle whose percentage is a *slider you set*,
  labelled untested, because the game never states the figure
- **Heresy** — a Light Force slider that adds Crit Rate 1:1, so it feeds crit
  chance rather than damage and moves the overcrit tiers along with it

The AI and the builder read the same mechanics text but are deliberately
separate: knowledge.js models what a form is worth so a build can be *explained*,
and the calculator lets you turn each piece on and *check* it.

## What it does not model

Being explicit here matters more than the feature list, because a confident
wrong answer is worse than an admitted gap:

- **Capstone abilities.** Mastery *stats* are modelled; the 5-point capstones
  grant abilities that are not scored, so the capstone is chosen by branch.
- **Conditional buffs.** Focus Step's flat Speed, Rallying Shout, stance effects
  — the model has hooks for them but the optimiser does not assume they are
  active, so damage figures are pre-buff.
- **Move proficiencies.** Multi-hit moves like `"1x20"` are scored correctly, but
  mastery proficiencies that add hits are not.
- **Most class and race passives.** The ones in `PASSIVES` are counted; every
  build lists the rest explicitly under "Passives NOT counted".
- **The defensive half of every corruption form.** Blasphemy's Shield and
  lifesteal, Tyranny's Mandate shield and party damage reduction, Heresy's
  Daybreak — all listed per form under "Not counted", none of it scored.
- **Recoil.** Every form builds it and it backlashes for a share of your max
  health when the form ends. Nothing here charges you for that.
- **Conversion damage.** Heresy detonates for a percentage of the *enemy's* max
  health, which is not comparable to the flat numbers everywhere else.

### Mastery IS a knapsack — the tree is not flat

An earlier version of this assumed every stat node was affordable and the only
choice was which capstone to buy with the change. That is wrong, and it produced
builds nobody could enter into the game.

Two constraints make it a real budget problem:

**The middle runs through the capstone.** Continuing down the centre of a branch
passes through the 5-point "mastery" node, so the nodes past it cannot be taken
without paying for it — unlike the side nodes, which branch around. In the
current tree `c4`, `c5a` and `c5b` all sit behind `cm1`. Taking every stat node
and then buying an arbitrary capstone left those three nodes illegal.

**Some parents are a LIST, and all of them are required.** `l5`, `c3a`, `cb2` and
`r5` are convergence points where two side nodes join back into the middle, and
`builder.js:7326` uses `.every` on the parent list. A single-link parent walk
misses this entirely.

So selection is greedy on stat value per point, where a node's cost includes
every unpaid ancestor it drags in, followed by a pass that spends whatever is
left — a stat point is never worse than an unspent point. `masteryLegal()` checks
the result and `test.js` asserts it on every request.

Costs are node 1, capstone 5, breakthrough 0 (paid in echo shards). Some classes
carry a 1.15 branch multiplier, which makes mastery bonuses *fractional* — stat
totals are not always integers, and that is the site's behaviour too.
- **Scrolls, soul tree, covenants.** Extracted and encoded into share links, but
  not yet searched over.
- **Most enchants.** Only those in `ENCHANTS` with a stated number are scored.
- **Mastery trees.** The biggest remaining lever.

Numbers are therefore a floor and a fair basis for *comparison*, not a
prediction of your damage in game.


## Performance

A request takes ~150ms and searches every class/race pairing, a 14-gear
shortlist, all armours, the legal weapons, artifacts, 7 shard slots and 10 trait
slots.

It was ~1000ms before profiling showed the cost was not the search at all but
recomputation: `moveDamage()` rebuilt all five stat totals for **every move**,
and each rebuild re-derived the gear contribution tables from scratch — roughly
20,000 rebuilds per request. `statContext()` now builds that snapshot once and
threads it through, which cut the time ~7x with byte-identical results.

If you add to the search, keep that shape: compute the context once per
evaluation and pass it down. A context is only valid while the build is
unchanged, so anything that mutates a build must take a fresh one.

The second stat-allocation pass after traits and shards is **conditional** on the
overcrit tier having changed. Running it unconditionally cost ~40% more time and
improved the score on none of the builds measured.
