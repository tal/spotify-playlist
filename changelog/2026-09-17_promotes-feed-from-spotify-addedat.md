# 2026-09-17 — Rebuild "Recently promoted" from Spotify `added_at` (both stages)

**Supersedes** `2026-09-17_backfill-recent-promotes.md` from earlier today. That
approach (backfill `recentPromotesV1` from an `action_history` Scan) worked but
was fundamentally **hash-order**, so a single lazy page missed the genuinely
newest promotes (topped out at May 2026 while Aug/Sep 2026 sat in unread pages).
DynamoDB has no insertion/FIFO order and no time order without an index, so a
Scan can only ever approximate "recent." Replaced with a source that is *exactly*
time-ordered: Spotify's own `added_at`.

## What "Recently promoted" now means

The feed lists the 20 most recent **promotion events**, merging **both** promote
stages by time (a track promoted through both appears **twice**, one row per
stage — intended):

| Stage | Source | Dated by |
|---|---|---|
| Liked → Current | every track in the **Current** playlist | that item's `added_at` |
| Unheard → Liked | newest **saved (liked)** tracks, `recentSavedTracks(50)` | the save's `added_at` |

Spotify returns saves newest-first and playlist items carry per-track `added_at`,
so ordering is reliable, not approximate. The Inbox playlist is deliberately not
a source — its `added_at` is *inboxing* time, not a promote time (the like
timestamp lives in Liked Songs).

## Changes

- `src/spotify.ts`: `recentSavedTracks(limit=50)` — newest-first saved tracks
  (`getMySavedTracks`, token-refresh retry), mapped to `{id, uri, name, artist,
  addedAt}`.
- `src/web/promotes.ts`: rewritten. `PromoteEvent` (`stage: 'liked' | 'current'`),
  pure `promotesPlan(events, records, now, limit)` (merge newest-first, slice,
  join live status/plays, label `transition`), and `gatherPromotes` reading
  Current + recent saves in parallel then double-planning the `getTracks` join.
- `src/web/app.js`: `renderPromotes` shows the `transition` arrow, `promotedAt`,
  live status, and the stage-appropriate play count. Dropped the before/after +
  undone rendering.
- `src/__tests__/web-promotes.test.ts`: rewritten for the merge/order/slice/join
  and the both-stages-twice invariant, plus a `gatherPromotes` fake-ctx test.

## Verified

- `bun run typecheck` clean; `bun test` 581 pass / 0 fail.
- Ran `gatherPromotes` against **live prod** (read-only): 20 rows, newest-first
  from **2026-09-16** down, both stages present, and tracks like *Stereoqueen*,
  *33*, *Canyon Nights* each showing their like row **and** their Current row.
  Live `status` joined correctly (`promoted` / `inbox` / `removed` / `unknown`).

## Old machinery removed (same day, follow-up commit)

The now-dead DynamoDB machinery was deleted rather than left vestigial:
`recentPromotesV1` + `recordRecentPromote` (and its `putActionHistory` call),
`getRecentPromoteRefs` / `getActionHistoryByRefs`, `RecentPromoteRef`, the
`backfill-promotes` action + `backfillRecentPromotes` / `planBackfillList` /
`nextRecentPromotes` / `PROMOTE_BACKFILL_*` / `RECENT_PROMOTES_CAP`, and the
`before`/`after` snapshot capture in `MagicPromoteAction` (plus `locationSnapshot`
/ `readTriageMembership` / `stageFor` and `PromoteLocationSnapshotData`).
`backfill-promotes.test.ts` and `promote-snapshot.test.ts` were deleted.
`putActionHistory` still writes the row; `forStorage` now stores just
`{ id, created_at, action, item, mutations }`. Verified: typecheck clean, 570
pass / 0 fail. The `recentPromotesV1` value backfilled into the prod user row
earlier today is now orphaned/dead data on the row.
