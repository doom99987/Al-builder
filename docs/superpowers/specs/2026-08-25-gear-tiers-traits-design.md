# Gear Tiers, Stat Allocation, and Traits — Design

Date: 2026-08-25
Status: **superseded in part by the developer changelog** — see "Corrections"

## Corrections from the changelog

The developer's changelog arrived after this spec was written and overrides it
on three points. The implementation follows the changelog.

1. **Tiers grant fixed shapes, not loose points.** This spec described free
   allocation with stacking. The real model is Mono / Duo (and Quad at T6) with
   fixed values — `T4 {5}|{2,2}`, `T6 {9}|{5,3}|{2,2,2,2}` — and the stats in a
   shape must be distinct. The argument this spec rested on ("T6's 9 points
   across 5 stats forces stacking") was wrong: T6 Mono puts all 9 on one stat.
2. **Trait tiers are 1–2**, not 1–4. The changelog: T1 and T2 "are the final
   values".
3. **Artifacts also carry 2 trait slots** ("four gear slots plus one artifact.
   So ten copies is the absolute ceiling"). Not yet implemented.

Everything below stands except where those three points contradict it.

## Summary

Arcane Lineage gear now carries a **tier** (0–6) granting stat points the player
allocates freely, and **trait slots** (3 shown, 2 currently unlockable) whose
traits carry their own tier (1–4). AL Builder must let a user describe a specific
copy of a gear, keep that description in shared builds, and record it in the bank
so two copies of the same gear are no longer indistinguishable.

## The core idea: a gear instance

Tier, allocation, and traits are properties of *a player's copy* of an item, not
of the item. `gearItems` therefore does not change — it stays the base stat table.
Everything new lives in a single shape:

```js
{
  name:   "Wicked Crown",
  tier:   4,                                   // 0–6
  alloc:  { str: 2, arc: 0, end: 3, spd: 0, lck: 0 },
  traits: [ { id: "…", tier: 2 }, { id: "…", tier: 1 }, null ]
}
```

This one shape is consumed by the builder (four of them, one per gear slot), the
share-link encoder, and the bank (where a gear row *is* one instance). Defining it
once is what stops the three features drifting apart as the game changes.

## Tier points

```js
const GEAR_TIER_POINTS = [0, 1, 2, 3, 5, 6, 9];  // index = tier
```

The curve is non-linear by design (T4 skips 4, T6 skips 7–8); it is game data, so
it lives in exactly one table and is edited there when the game rebalances.

**Allocation is free, and stacking is allowed** — `+9 END` on a single T6 gear is
legal. This is forced, not chosen: T6 grants 9 points and there are only 5 stats,
so a one-point-per-stat rule cannot reach T6.

The only rule is `sum(alloc) ≤ GEAR_TIER_POINTS[tier]`. Under-spending is allowed
(a partly-planned build is still a valid build).

Eligible stats are the five the builder already tracks: STR, ARC, END, SPD, LCK.

## Traits

```js
const TRAIT_SLOTS          = 3;   // rendered
const TRAIT_SLOTS_UNLOCKED = 2;   // fillable
```

Slot index 2 (the third) renders greyed with a lock affordance and refuses input.
Two constants rather than a hardcoded `2` so that when the game unlocks the third
slot, it is a one-number change — no markup, encoding, or storage work.

Each filled slot holds `{ id, tier }` with tier 1–4. A trait that is present is at
least T1; absence is represented by `null`, not by tier 0.

### Trait effects are deferred, not blocked

The trait list has not been provided yet. Trait *effects* are therefore data-driven
through a table keyed by id:

```js
const gearTraits = { /* id: { name, series, effect… } */ };
```

Until that table is populated, traits are **recorded, displayed, encoded, and
stored** — they simply contribute nothing to computed stats. No other part of this
design waits on the list. When it arrives, populating `gearTraits` and teaching the
stat pipeline to read it is an additive change.

## Builder UI

Under each of the four gear pickers:

- A tier stepper (`− T4 +`) with a budget readout (`3 of 5 left`).
- A row of five mini steppers (STR/ARC/END/SPD/LCK), shown only when tier > 0.
  `+` disables at zero remaining.
- Three trait slots, the third locked.

Lowering a tier re-clamps allocation down to the new budget rather than rejecting
the change. Changing which gear occupies a slot resets that slot's tier,
allocation, and traits — it is a different physical item.

Allocation is displayed inline rather than behind a click-to-open popover. The
builder is already a dense form, and hiding the numbers makes a build harder to
read at a glance; the popover also costs positioning, outside-click, and mobile
handling for no gain.

## Stat wiring

`updatePecents()` already accumulates gear contributions at
[builder.js:469](../../../js/builder.js) — `_gearSlotIds.forEach` sums
`gearItems[name]` into `gearStatBonuses`. Adding each slot's `alloc` into that
same accumulator is the whole integration: `gearStatBonuses[stat]` is already part
of `otherFlat`, so the stat rows, the percentage math, and the damage calculator
pick the points up with no further changes.

Allocation from a slot with no gear selected is ignored.

## Persistence

### Share links

`_packState` is a positional bit-stream. New fields **must be appended at the very
end**, the same trick the scrolls already use ("trailing zeros = empty"). Old links
then decode as tier 0 with no traits and render exactly as they do today.

Per gear slot: tier (3 bits) + 5 × alloc (4 bits each, values 0–9) + 3 × trait
(8-bit id + 3-bit tier) = 56 bits. Four slots = 224 bits ≈ 28 bytes.

The locked third trait slot **is** encoded. Reserving it costs ~5 bytes total and
means unlocking it later requires no encoding change and invalidates no existing
link.

### The bit-width trap

Field widths are derived from list length: `wi(list, val)` writes with
`_wb(list.length)`. Growing a list past a power of two silently changes the width
and **invalidates every share link ever generated**. This is latent in the codebase
today, not live.

Measured: 70 gears → 7 bits, and the width holds until 128. Withered Grove has
roughly 57 gears of headroom.

Two consequences for this design:

1. **Trait ids use a fixed 8-bit width**, not a derived one. The trait list is
   expected to grow repeatedly, which would otherwise walk straight into this.
2. `tools/check-data.js` gains a **bit-width headroom check** that fails when any
   encoded list comes within a small margin of its next power-of-two boundary. A
   silent break of every shared build is not something to discover from a bug
   report.

### Autosave and account sync

Both route through `getBuildState`/`applyBuildState`, so they inherit the new
fields with no dedicated work. `getBuildState` gains the per-slot instances;
`applyBuildState` restores and clamps them.

## Bank

Gear entries become **per-instance**. Adding a gear creates its own row; gear rows
do not stack by quantity. A row is labelled with its full spec:

```
Wicked Crown · T4 · +2 STR +3 END · Trait A T2, Trait B T1
```

This extends an existing pattern rather than inventing one: sharded weapons are
already stored as separate entries keyed on their shard stats
([bank.js:727](../../../js/bank.js)), and rendered with a variation suffix by
`bkShardLabel`.

**One deliberate departure.** `sameEntry` identifies a row by deep-comparing
`name + sharded + JSON.stringify(shards)`. Applied to gears, two genuinely separate
but identically-specced copies would collapse into one row — exactly the behaviour
this change is meant to end. Gear entries therefore carry a stable `uid`, and rows
are addressed by it. Entries without a `uid` (everything currently in every user's
bank) keep the existing comparison path, so no stored bank breaks.

## Withered Grove

A new area is adding gears. That is ordinary content work under the existing
"Adding a new item" checklist in `CLAUDE.md` — `gearItems`, `gearSeries`,
`ENC_ITEMS`, `VL_ITEMS` if tradeable, the bank's `BANK_ITEMS` pool, and a `?v=`
bump — plus `node tools/check-data.js` to confirm the spellings agree across all
of them.

This design adds no per-item work: a new gear needs no tier or trait data, because
tiers and traits belong to the player's copy, not to the item.

Nothing in this spec should be implemented in a way that requires touching each
gear individually.

## Validation

Tier, allocation, and traits arrive from share links (any stranger's URL) and from
the account-sync row, so all of it is clamped on load rather than trusted:

- tier → integer, 0–6
- each alloc value → integer, 0–9
- `sum(alloc)` → truncated to `GEAR_TIER_POINTS[tier]` if it exceeds it
- trait tier → integer, 1–4
- unknown trait ids → dropped
- trait in a locked slot → dropped
- bank `uid` → treated as an opaque string, never interpolated into HTML unescaped

## Files touched

| File | Change |
|---|---|
| `js/builder.js` | gear-instance model, tier/alloc/trait state, UI render + wiring, stat accumulation, `getBuildState`, `applyBuildState`, `_packState`, `_unpackState` |
| `index.html` | tier + allocation + trait markup for the 4 gear slots, **and a `?v=` bump on every file below** |
| `css/builder.css` | stepper, budget readout, trait slot, locked-slot styling |
| `css/mobile.css` | touch target sizing for the steppers |
| `js/bank.js` | per-instance gear entries, `uid`, gear row label, add flow |
| `tools/check-data.js` | bit-width headroom check |

## Out of scope

- Equipping a gear directly from the bank into the builder.
- Tiers or traits on armour, weapons, shards, marks, or artifacts.
- Trait effect calculations (deferred until the trait list arrives — structure only).
- Backfilling tiers onto items already in users' banks.

## As built — deviations from the design above

Three things changed during implementation:

1. **The trait slots collapse to one line while `gearTraits` is empty.** Rendered
   in full, three unusable pickers cost ~65px in a 180px-wide gear column
   (measured: 174px per slot, down to 109px collapsed). The slots return
   automatically once the table is populated.
2. **A shared spec editor was extracted** (`renderGearSpec`, exposed as
   `window._gearSpecRender`) rather than reimplementing the controls in
   `bank.js`. The bank popout runs without `builder.js`, so `bank.js` treats it
   as optional and formats its own row labels.
3. **`<meta charset="utf-8">` was added to `index.html`**, which had none. The
   page was being parsed as windows-1252 and every em-dash rendered as mojibake.
   Unrelated to gear, but found while verifying this work and fixed in place.

The headroom check found a live problem rather than a future one: **marks have
room for exactly one more entry** before every existing share link breaks, and
shards two. Gears — the list this change was concerned with — have ~57. Fixing
that is separate work, not covered here.

## Assumptions

Recorded so they are easy to correct:

1. Scope is the four Gear slots only.
2. The **third** trait slot is the locked one.
3. Trait tiers run 1–4, with absence as `null` rather than tier 0.
4. Bank gear rows record full tier + allocation + traits, not merely separate lines.
5. Eligible stats for allocation are STR/ARC/END/SPD/LCK.
