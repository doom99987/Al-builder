# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**AL Builder** (arcanelineagebuilder.com) — a fan-made planner for the Roblox game *Arcane Lineage*: stat/gear/soul-tree builder, damage calculator, QTE trainers with leaderboards, trading, parties, an encyclopedia, and a shared bank.

## Running it

There is **no build step, no bundler, no package.json, and no test framework.** Files are served exactly as they sit on disk, deployed via GitHub Pages (`CNAME` → arcanelineagebuilder.com).

```bash
python -m http.server 8000
```

Verification is browser-based. There is nothing to `npm test`.

**Every asset is cache-busted by hand.** `index.html` references `js/foo.js?v=12`. If you edit a JS or CSS file and do not bump its `?v=`, returning users keep the stale copy. This is the single easiest thing to forget.

## Architecture

Vanilla ES2015+ browser JS. No modules, no imports — every file is a `<script>` tag and an IIFE, and **all cross-file communication happens through `window.*` globals.** Load order in `index.html` is therefore load-bearing; the comment blocks above the `<link>` and `<script>` lists document it and should be kept accurate.

Two files hold most of the mass: `builder.js` (~7.3k lines) and `encyclopedia.js` (~5.9k). Do not read them whole — jump by section header (below).

### Finding things fast

Each module owns a `window._` prefix. To find a feature, grep the prefix rather than reading files — `grep -rn "window\._bank" js/` beats opening `bank.js`. Hits split two ways: the **definition** (`window._x =`) is in the owning file below; every other hit is a caller. `overlay.js` shows up across many prefixes because the picture-in-picture window re-invokes other modules' renderers.

| Prefix | Owner | Examples |
|---|---|---|
| `_sb*`, `_admin*`, `_lb*` | `sb.js` | `_sbClient`, `_sbSubmitScore`, `_sbGetUserId`, `_openLeaderboard` |
| `_on*QteShow` / `_on*QteHide` | `qte.js` | one pair per trainer, called by `switchQteTab` |
| `_bank*`, `_bk*`, `_banks*` | `bank.js` | `_bankOpen`, `_bkRender` |
| `_trd*` | `trades.js` | |
| `_party*` | `party.js` | |
| `_enc*` | `encyclopedia.js` | |
| `_builds*` | `builds.js` (community builds) | not to be confused with `saved-builds.js` |
| `_mm*`, `_qteMatch` | `matchmaking.js` | |
| `_don*` | `donation.js` | |
| `_qte*` (mode/ping/guard) | `core.js`, `qte-guard.js` | `_qteCompMode`, `_albPing`, `_qteGuard` |

Inline `onclick="_someGlobal()"` in `index.html` is the normal wiring style, so a global with no JS caller is probably called from markup — grep `index.html` too.

### Section headers

Files are internally divided by a header comment, but **the style varies per file** — grep for the right one or you will find nothing:

- `// § NAME` — `builder.js`, `core.js`, `saved-builds.js`, `move-renderer.js`
- `// === NAME ===` — `qte.js`, `sb.js`, `trades.js`, `matchmaking.js`, `party.js`, `reports.js`, `donation.js`
- `/* ── name ──` — `encyclopedia.js`, `bank.js`, `overlay.js`

### Page and panel switching

`switchPage(name)` toggles `.site-page.active` on `#page-<name>`. Within the QTE page, `switchQteTab(name)` shows `#qte-panel-<name>` and calls that trainer's show/hide hooks. Both live in the inline `<script>` at the bottom of `index.html`, not in a JS file.

## Supabase

Client is created in `sb.js` and shared as `window._sbClient`; other modules must reuse it rather than constructing their own. The anon key is committed in several files by design (it is a public key; RLS is the actual boundary).

SQL lives in `supabase/*.sql`, but **only some tables are checked in** — `banks.sql`, `builds.sql`, `matchmaking.sql`, `reports.sql`. The leaderboard, profile, trade, and party tables exist only in the dashboard. If a change needs schema you cannot see, ask rather than guess.

| Table | Owner |
|---|---|
| `profiles`, `banned_usernames`, `perma_banned_usernames`, `avatars` | `sb.js` |
| `leaderboard`, `leaderboard_records`, `personal_bests` | `sb.js` |
| `player_vaults` (public slots), `player_vaults_full` (all slots) | `bank.js` |
| `player_builds` | `saved-builds.js` |
| `shared_builds` | `builds.js` |
| `trade_listings`, `direct_messages` | `trades.js` |
| `party_listings`, `party_members`, `party_requests`, `party_messages` | `party.js` |
| `mm_queue`, `mm_matches`, `mm_ratings` | `matchmaking.js` |
| `notifications`, `reports` | `reports.js` |
| `donations` | `donation.js` + `supabase/functions/` (Stripe) |

RPCs: `start_qte_session`, `submit_score`, `mm_create_match`, `mm_apply_result`, `mm_abandon_match`, `soft_delete_conversation`, `delete_own_account`, `purge_expired_listings`, `admin_*`.

## QTE trainers

Twelve trainers, all in `js/qte.js`, one IIFE each. `thorian-new`, `dagger-new`, and `yarthul-new` are the "New" tab group; the rest are "Old".

**Scores are rejected without a session.** `submitScore` ([sb.js](js/sb.js)) drops any score whose `qteType` has no armed session, logging only a console warning — the trainer looks fine and the leaderboard silently never updates. Every trainer must call `_sbStartQteSession(type)` at the top of its start function, with the **same** type string it later submits, comp suffix included.

### Adding a trainer — every touchpoint

Missing any one of these fails quietly:

1. `index.html` — tab button in `#qte-group-old`/`#qte-group-new`, panel `#qte-panel-<id>`, and two hook lines in `switchQteTab`
2. `js/qte.js` — the IIFE, including `_sbStartQteSession('<id>' + (window._qteCompMode ? '-comp' : ''))`
3. `css/qte.css` — panel styles; `css/mobile.css` for any touch controls
4. `js/sb.js` — add the id to `QTE_TYPES`, `_ALL_QTE_TYPES` (both plain and `-comp`), and a `QTE_LABELS` entry if the label differs from the id
5. `js/matchmaking.js` — an entry in `QTES` with `{ id, label, group, hook }`
6. Bump the `?v=` on every file touched

Shared trainer contract: separate casual/competitive bests (`alb:<id>-hs` / `-hs-comp`), `updateHs` routing to `window._qteMatch.report()` during a match, failures routing to `_qteMatch.fail()`, and listeners for `alb-scores-reset` / `alb-mode-changed`.

### Two systems every trainer gets for free

- **`core.js` ping sim** intercepts QTE keys in the capture phase and re-dispatches them after `window._albPing` ms.
- **`qte-guard.js`** inspects the same events for macro signatures (synthetic, robotic rhythm, impossible burst, identical hold times) and withholds leaderboard submissions while flagged.

Both work on any trainer that listens for real `keydown`/`keyup` on `document`. A consequence worth knowing: **synthetic `KeyboardEvent`s are blocked by design**, so trainer input cannot be tested programmatically — it needs a human at a keyboard.

## Game data — where content lives

Arcane Lineage updates mean bulk content edits. The expensive part is not editing, it is finding every place one item ripples to. **Game data is not in one place**, and some of it is not even in a `js/` file:

### Gear instances (tier / stat points / traits)

A gear's tier, allocated stat points, and traits describe **a player's copy** of
an item, not the item — so none of it lives in `gearItems`, which stays the base
stat table. A new gear needs no tier data at all.

The shape is `{ tier, shape, stats:[…], traits:[…] }`, defined once in
`js/builder.js` under `§ GEAR TIERS & TRAITS` and consumed in three places: the
builder's four slots, the share-link encoder, and `bank.js` gear rows.

**A tier does not grant loose points.** It grants one of a fixed set of shapes,
and you choose which stats receive the shape's fixed values (`GEAR_TIER_SHAPES`):

```
T0 {0}   T1 {2}   T2 {3}|{1,1}   T3 {4}|{2,1}
T4 {5}|{2,2}      T5 {6}|{3,2}   T6 {9}|{5,3}|{2,2,2,2}
```

Mono puts everything on one stat, Duo splits across two, T6 alone offers a Quad.
The stats in a shape must be **distinct** — the changelog is explicit that a Duo
cannot be `{Strength, Strength}` — so no stat receives more than one value. In
game the stats are rolled at random; here the user picks them, because this is a
planner. `inst.stats[i]` names the stat receiving `shape[i]`.

**Artifacts and weapons use the same model.** `SPEC_GEAR`, `SPEC_ARTIFACT` and
`SPEC_WEAPON` are the only place the kinds differ: gear renders 3 trait slots
with the third locked, artifacts render 2 with both usable and filter out
`gearOnly` traits, and weapons render **none** and stop at **T4**. Pass the
config to `makeGearInstance` / `clampGearInstance` / `renderGearSpec` /
`specSetTier` / `specSetTrait`; omitting it defaults to gear. The changelog's
"ten copies is the absolute ceiling" is 4 gears x 2 + 1 artifact x 2 — weapons
add none, having no traits.

### Fixed gear (no tier, no traits)

Some gears are exactly what they are: they grant their **base stat block** from
`gearItems` and nothing else — no tier roll, no traits. `FIXED_GEAR` lists them
by name; currently just **Narthana's Leaf**, so adding another is a one-line
change.

`SPEC_GEAR_FIXED` is `slots: 0` plus `maxTier: 0, hideTier: true`, which leaves
the editor with nothing to draw at all. `renderGearTierBox()` therefore prefixes
the box with a "Fixed item — no tier or traits" note, so an empty box reads as
intentional rather than as controls that failed to render.

Stale values are cleared in **two** places, because either alone leaves a hole:
`setGearInstances()` clamps against `specForGearName()` on load, and
`renderGearTierBox()` re-normalises tier, shape, stats and traits when the slot
is drawn — that second one catches switching an already-rolled gear into a fixed
one, which would otherwise keep its values alive and pack them into a share link.
`gearStatContributions()` independently zeroes the allocation rather than
trusting the instance. Verified: a payload claiming T6 **and** two traits on
Narthana's Leaf is stripped to base `arc 2 / end 2`.

Its Details row is labelled by name alone, with no `· T0`.

`bank.js` mirrors the list as `BK_FIXED_GEAR` for the same reason it mirrors
`BK_TIER_SHAPES` — the standalone popout runs without `builder.js`. A fixed gear
keeps its per-instance row and delete button but gets no Edit toggle; note the
guard sits on the *button*, not the `bkIsGearEntry` branch, or the row would fall
through to the quantity stepper that gear must never have.

### Weapon tiers

Only five weapon families roll tiers: **Dragon, Blight, Sun, Sandstone,
Primordial** (`TIERED_WEAPON_SERIES`), plus the three shields from those same
families (`TIERED_OFFHAND_NAMES`, listed by name because `offhandSeries` groups
everything under a flat `"Shields"` key). Every other weapon shows no tier box
at all — `.gt-hidden` removes it from the layout, unlike a gear slot, which keeps
its empty box so the four rows don't jump.

- `MAX_WEAPON_TIER` is **4**, so no weapon ever offers the T5 or T6 shapes.
  `specMaxTier(cfg)` is the ceiling lookup; only weapons override it.
- Weapons have **no base stat block** — `weaponBonuses` is percentage-only and is
  applied separately in `updatePecents()`. Everything a weapon adds to the stat
  rows comes from its tier roll, so `baseFor` on a weapon entry returns 0.
- `tieredWeaponNames()` builds its set **lazily**, because `mainWeaponSeries` is
  declared far below `updatePecents()` and is still in its temporal dead zone on
  the first pass at load. It catches the TDZ throw and returns an uncached empty
  set until the data exists — correct, since nothing is equipped that early.

- `TRAIT_SLOTS` / `TRAIT_SLOTS_UNLOCKED` (3 / 2) — the third gear slot renders
  locked. Unlocking it is a one-number change; the encoding already reserves it.
- `gearTraits` holds all 25 traits, five per family (Strength/Endurance/Arcane/
  Speed/Luck). **Trait tiers are 1–2 only** — the changelog says T1 and T2 "are
  the final values". `gearOnly` traits cannot roll onto an artifact.
- The table is **append only** — reordering or removing a trait repoints every
  existing share link, because `_L.trait` is positional.
- `window._gearSpecRender/_gearSpecNew/_gearSpecClamp` are how `bank.js` reuses
  the editor. The bank popout runs without `builder.js`, so it treats them as
  optional and formats its own row labels.
- `gearStatContributions()` is the **only** place gear stats are summed. It
  returns per-item contributions (base stats and tier values separately, plus the
  artifact and any tiered weapons) and has three consumers: `updatePecents()` for
  the total, `_buildStatDetail()` for the Details breakdown, and `getTotalStat()`.
  All three once summed gear independently and silently disagreed the moment tier
  values existed — do not reintroduce a fourth accumulator. Adding a new kind of
  tiered item here makes it reach all three at once; that is the point.
  Entries are tagged `artifact: true` / `weapon: true`, with `slot` `-1` for the
  artifact and `-2 - i` for weapons.
- Bank gear entries are **per-instance**: one row per physical copy, `qty` always
  1, addressed by a `uid`. Entries without a `uid` keep the old name+shard
  identity, so existing banks are untouched.
### What the changelog content does and does not compute

Reference data and stat maths are two different things here. Gear base stats,
gear/artifact/weapon tier values and the crit rework **do** feed the damage
calculator through the stat rows. The following are recorded and displayed but compute
nothing: the 25 gear traits, the stat milestones, `block-dr`/`nrg-chance`/
`initiative`, Corruption Forms, the Corrupt Power gears' spend effects, and the
new races' and enchants' passives. Wiring any of them up depends on the §12
damage-formula rewrite, which is not implemented — the calculator still uses the
old multiplicative model, not `Base/Flat/Multi/TrueMulti/TrueFlat` with
`DRMultiplier = 100 / (100 + Reduc)`.

`races` entries for **Arborivia and Calvariae carry placeholder zero stat
blocks** — the changelog documents their passives and actives in full but never
publishes base stats. Builds using them under-count until the real numbers land.

### Corruption Forms

`corruptionForms` (Tyranny / Heresy / Blasphemy) plus `CORRUPTION_GENERAL` hold
the mechanics as **reference text only**. The forms are turn-by-turn combat state
— Notch, Mandate, Dark/Light Force, Recoil, Corrupt Power — that this planner
does not simulate, so none of it feeds the stat maths. It renders in the Info tab
beside Gear/Enchant/Artifact, reached by the ⓘ next to the Form picker.

`corruptionPhase` is a display-only what-if: it drives `corruptionStackCap()`
(2 at Phase 0-2, 3 at 3-4, 4 at 5) and nothing else, so it is deliberately kept
out of the build state. In game there is currently no way to raise it — Corrupt
Essence Shards were cut from the update.

### Levelling (changelog §9)

`Max_Lvl` 50, `POINTS_PER_LEVEL` 3 — `getEffectiveTotal()` is `lvl * 3`, counting
from level 1, because the changelog states a level-50 character has exactly 150
allocatable points. Dullahan's extra `floor(lvl/10)*3` still layers on top.

`LEVEL_STAT_BONUS_EVERY` is **10**, via the `levelStatBonus()` helper. This file
previously hardcoded `Math.floor(lvl / 5)` in six places. The changelog puts the
+1-to-all at every 10 levels ("~7 in every stat" at level 50 = racial base plus
5), so the interval changed as well as the cap. One constant now, so going back
is a one-line edit rather than six.

Note the stat inputs listen for **`change`, not `input`** — the running `spent`
total only updates on `change`, so scripted tests that dispatch `input` will
silently leave "Points Remaining" stale.

### Stat rework (changelog §9)

`statMilestones` + `STAT_MILESTONE_TIERS` (25 / 60 / 110) render at the bottom of
each stat's Details panel, measured against the total that panel just derived.
The developer notes the **Strength and Arcane final milestones are swapped in
game** relative to intent; they are listed as they behave.

Each stat also gained an identity, all at `STAT_IDENTITY_RATIO` (10%) of their
source stat and shown as new items in the derived panel: `block-dr` from STR,
`nrg-chance` from ARC, `initiative` from SPD. Endurance additionally grants
`END / END_HEAL_DIVISOR` (4) to both healing stats. Luck now grants Crit Chance
1:1 and **no longer scales Crit Damage**, which is a flat `CRIT_DMG_BASE` (2x)
plus 1 per higher crit tier; Crit Fatigue is gone.

**Load-order hazard, learned the hard way:** `updatePecents()` runs at file load,
long before `dmgBonusActive` and friends are declared. Anything it calls must not
touch them — `getTotalStat()` does, so calling it from inside the percent loop
throws a TDZ `ReferenceError` and silently aborts the whole render. The identity
stats therefore reuse values cached in `_statVals` during the same pass (relying
on DOM order: str/arc/end/spd render before the items that read them).

### Share-link bit widths — the silent killer

`_packState` writes each item index at a width derived from its list's length
(`_wb(list.length)`). Growing a list past a power of two widens the field, shifts
every field after it, and **invalidates every share link ever generated.** Nothing
fails loudly; users just find old links decode to the wrong build.

`node tools/check-data.js` now reports headroom. As of 2026-08-25 the tight ones
are **marks (1 entry of room)** and **enchants (1)** — Polaris/Octantis/Skyblaze
took enchants from 12 to 15, so a 16th widens the field. Shards have 2,
artifacts 4. Gears sit at 80 with room to 128; races at 19 with room to 32. Adding a single new Mark breaks every existing
link — check before any content update that adds to those lists.

**`gearSeries` is append-only for the same reason.** `_L.gear` is
`Object.values(gearSeries).flat()`, so a gear's position in that structure *is*
its share-link id. Inserting into an existing series shifts every gear after it.
New gears go at the end of the last series, or in a new series appended last —
that is why Withered Grove is at the bottom. Renaming in place is safe (the
index is unchanged), which is how `Crystallized Star` → `Crystalized Star` was
fixed without breaking links.

New appended fields must go at the **end** of the bit stream (the scrolls, gear
instances, corruption form, artifact instance and weapon instances all do, in
that order) so short old blobs read back as zeros. Trait ids deliberately use a
**fixed 8-bit width**, not a derived one, because that list is expected to keep
growing.

The weapon block is next-to-last: 17 bits per slot (tier 3 + shape 2 + four stat
picks x 3), two slots, no trait fields — about 7 base64 chars. Links written
before weapons had tiers run out of bytes there and decode to T0 with nothing
picked, which is exactly what those builds meant. Verified: an old-format blob
decodes byte-identical for every field ahead of the weapon block. Note
`getBuildState()` calls the field **`wti`**, not `wi` — `_packState` already has
a local helper named `wi`.

**`pStat` (Permuth / Venia +40%) is packed last**, 3 bits. It had been produced by
`getBuildState()` and consumed by `loadBuildState()` since Venia was added but was
never written to the blob, so every shared Venia build silently arrived without
its +40% stat buff — a large, invisible discrepancy between the builder and the
link. Old links read 0 = none, which matches what they actually carried.

| Data | Location |
|---|---|
| `races` (name → stat block) | `js/builder.js` |
| `armourItems`, `gearItems`, `markItems`, `enchantItems`, `artifactItems`, `shardItems` | `js/builder.js` |
| `gearSeries`, `gearPctBonuses`, `markMoves`, `artifactMoves` | `js/builder.js` |
| `classMoves` (30 classes, per-move records) | `js/data-class-moves.js` |
| `raceMoves` | `js/data-race-moves.js` |
| `ENC_ITEMS` (495 entries: `[name, type, description]`) | `js/encyclopedia.js` |
| `GEAR_NAME_MAP`, `WEAPON_NAME_MAP` (encyclopedia name → moves key) | `js/encyclopedia.js` |
| `VL_ITEMS` (value list: `[name, category, value, demand]`) | **inline `<script>` in `index.html`** |

The same item is therefore named in up to four places, and **nothing enforces that the spellings agree**. Real drift already in the tree includes `Crystallized Star` vs `Crystalized Star` and `Focussed Mind` vs `Focused Mind` — the item silently loses its moves or its encyclopedia link.

### Before and after any content update

```bash
node tools/check-data.js
```

Cross-references every list and reports items present in one source but missing from another, duplicate entries, races with no move set, and alias-map keys resolving to nothing. Exits non-zero on drift. Run it before starting (to see pre-existing noise) and after (to confirm you added no new drift).

It reads sources by extracting each data literal and evaluating it in isolation — the files touch the DOM at load, so they cannot be `require`d. If a rename breaks extraction the script reports `unreadable` rather than silently passing, so treat that as a failure, not a skip.

### Adding a new item

1. `js/builder.js` — the right `*Items` object, with its stat block
2. `js/encyclopedia.js` — an `ENC_ITEMS` row; add a `GEAR_NAME_MAP` entry **only** if the encyclopedia spelling must differ from the builder's
3. `index.html` — `VL_ITEMS`, if it is tradeable
4. `js/data-class-moves.js` / `data-race-moves.js` — if it grants moves
5. Bump `?v=` on every file touched
6. `node tools/check-data.js`

New class or race additionally needs a `classMoves`/`raceMoves` key and an `ENC_ITEMS` entry; the checker catches both if missed.

## Storage conventions

- `alb:*` — builder and QTE state (`alb:autosave`, `alb:<qte>-hs`, `alb:saved-builds`)
- `al-*` — bank and encyclopedia trackers (`al-bank`, `al-venia-tracker`)
- `alb_*` — visitor/consent (`alb_visitor`, `alb_consent_version`)

### Cloud sync pattern

`bank.js` and `saved-builds.js` both sync localStorage to an owner-only Supabase row, last-writer-wins on `updated_at`. Copy this pattern rather than inventing another: a `-meta` key holding `{ owner, syncedAt }`, a `-dirty` flag, a 1.2s debounced push, a pull that adopts only when the server row is newer, re-sync on `alb-auth-changed`, and a ~4s fallback timer for when auth settles before the script loads.

The `owner` field matters: a *different* account logging in must **replace** local data, never merge it, or one user's data leaks into another's account.

## Custom events

`alb-auth-changed` (auth settled — login, logout, session restore), `alb-mode-changed` (casual/competitive toggled), `alb-scores-reset` (admin cleared scores).

## Gotchas

- `player_vaults` is deliberately not named `banks` — ad blockers block REST URLs containing `/banks`. Avoid blockable words in new table names.
- `images/Logo.png` is white-on-transparent and disappears on light backgrounds; the `favicon-*.png` set has black baked in. Use those for anything that renders on an unknown background.
- The load-order comment blocks in `index.html` carry counts ("all 12 QTE trainer IIFEs") that drift as trainers are added. Update them alongside the code.
- Sending user text into `innerHTML` needs `_escHtml` (`saved-builds.js`) or `_sanitizeSummHtml` (`core.js`).
- `index.html` declares `<meta charset="utf-8">` and it must stay first in `<head>`. Without it browsers fall back to windows-1252 and every em-dash in the UI renders as mojibake. GitHub Pages sends the charset in its header, which masks the problem in production while breaking `python -m http.server` locally.
