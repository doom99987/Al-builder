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
