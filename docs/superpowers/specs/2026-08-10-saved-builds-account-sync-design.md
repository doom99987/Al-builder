# Saved Builds — Account Sync Design

**Date:** 2026-08-10
**Status:** Implemented

## Summary

Saved builds follow the account across devices, the way the bank already does.
The account's row in `player_builds` is the cross-device source of truth;
`localStorage` remains the working copy so the builder still functions logged
out. The two reconcile last-writer-wins on `updated_at`.

This mirrors `js/bank.js` / `player_vaults_full` deliberately — same dirty flag,
same debounce, same `alb-auth-changed` trigger — so there is one sync pattern in
the codebase rather than two.

## Storage

| Key | Holds |
|---|---|
| `alb:saved-builds` | The builds array. Shape unchanged, so existing data needs no migration. |
| `alb:saved-builds-meta` | `{ owner, syncedAt }` — which account these builds belong to, and the server timestamp this browser last agreed with. |
| `alb:saved-builds-dirty` | Set when this browser holds edits the server has not seen. |

Sync bookkeeping lives in a sibling key rather than wrapping the builds array,
which avoids migrating data already in users' browsers.

## Table

`supabase/builds.sql` creates `player_builds`: `user_id` primary key, `builds`
jsonb, `updated_at` timestamptz. Owner-only RLS on all four operations, each
targeting the `authenticated` role, with `auth.uid()` wrapped in a subselect so
it is evaluated once per query rather than once per row.

There is **no world-readable projection**. `player_vaults` has one because the
Banks browser shows other people's public slots; saved builds are private, and
community sharing already goes through `shared_builds`.

A check constraint caps the array at 50 server-side. It is a backstop against a
buggy client writing an unbounded blob, and must be changed in step with
`_MAX_SAVED_BUILDS` in `js/saved-builds.js`.

## Reconciliation

Three cases. Conflating them loses or leaks data, which is the whole reason this
section exists.

**First claim** — `meta.owner` unset. The builds in this browser are unclaimed,
so they are *merged* into the account rather than overwritten. Logging in for the
first time must never silently bin local work. The merged result is then pushed.

**Account switch** — `meta.owner` set but different. These builds belong to
someone else's account; merging would leak one user's builds into another's, so
the new account's builds replace them outright. The previous account's builds
remain safe in its own server row.

**Steady state** — same owner. The server copy is adopted only when it is newer
than `meta.syncedAt`. A browser holding unpushed edits pushes instead of pulling,
so a build deleted on one device does not come back from another.

### Merge rule

Union by build `id`; where the same id exists on both sides the later `ts` wins.
Sort favourites first, then newest, and keep the first 50.

When a merge overflows the cap the surplus is dropped and the panel shows a
dismissible notice naming the count. Dropping builds silently is exactly the
failure this design exists to avoid, so the overflow is surfaced rather than
swallowed.

## Triggers

- `_setSavedBuilds` marks dirty and schedules a push, debounced 1.2s.
- `alb-auth-changed` re-syncs whenever auth settles — session restore, login,
  account switch.
- A 4s fallback timer covers the auth event firing before this script loads.
- A `storage` listener re-renders and pushes when another tab edits builds.

The pull path writes through `_writeSavedBuildsRaw`, which deliberately does not
mark the browser dirty — otherwise adopting server data would immediately queue a
push of what was just received.

Logged out, `_scheduleBuildsSync` returns immediately and nothing touches the
network.

## Verification

Reconciliation was exercised against a stubbed Supabase client:

| Case | Expected | Result |
|---|---|---|
| First claim, 2 local + 2 server | all 4 kept and uploaded | pass |
| Account switch, account A local + account B server | only B's build; nothing uploaded | pass |
| Delete a build, sync twice | stays deleted locally and on the server | pass |
| Merge overflow, 40 local (2 fav) + 30 server | 50 kept, favourites retained, notice shows "20 builds…" | pass |
| Logged out | saves locally, no network request | pass |

The real authenticated round-trip against Supabase has not been exercised and
needs a manual check with an account on two devices.
