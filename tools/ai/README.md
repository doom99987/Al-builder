# Build AI

Ask for a build in plain English, get an optimised one back. No API, no network,
no token cost — it computes builds with the same maths `js/builder.js` uses.

It is **not** wired into the site. Nothing in `index.html` references it.

```bash
node tools/ai/extract-data.js                      # once, and after game updates
node tools/ai/build-ai.js "max damage crit lancer"
node tools/ai/build-ai.js "tanky build"
node tools/ai/build-ai.js                          # no request — still answers
```

Or open `tools/build-ai.html` in a browser. It works straight off disk.

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

## After a game update

```bash
node tools/ai/extract-data.js     # re-read the data
```

Then re-verify the maths — serve the repo, open the builder, and paste
`verify.js` into the console. It drives the real builder through 100 randomised
configurations and diffs every stat against the model. Anything other than
`mismatches: 0` means the model drifted and its numbers cannot be trusted until
it is fixed.

## What it does not model

Being explicit here matters more than the feature list, because a confident
wrong answer is worse than an admitted gap:

- **Mastery trees.** Not modelled at all. Real builds gain a lot here.
- **Conditional buffs.** Focus Step's flat Speed, Rallying Shout, stance effects
  — the model has hooks for them but the optimiser does not assume they are
  active, so damage figures are pre-buff.
- **Move proficiencies.** Multi-hit moves like `"1x20"` are scored correctly, but
  mastery proficiencies that add hits are not.
- **Most class and race passives.** The ones in `PASSIVES` are counted; every
  build lists the rest explicitly under "Passives NOT counted".
- **Shards, scrolls, soul tree, covenants.** Extracted and encoded into share
  links, but not yet searched over.

Numbers are therefore a floor and a fair basis for *comparison*, not a
prediction of your damage in game.
