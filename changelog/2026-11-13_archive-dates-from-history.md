# Archive dates from action history + archive triage log entry

## What
- **Track page reads archive dates from `action_history`.** `gatherTrack` queries every `archive:<YYYY-MM>` row from the track's first `'promote'` month to now (new `Dynamo.allActionHistory(id)`, paged Query, no Scan), and the pure `archiveMovesFor(rows, id)` pulls out each `move-track` mutation containing the track, dated by the run's `created_at`. Playlist names come from `allPlaylists()` (only the destination id is stored). New event source `'action-history'`, drawn as a filled (recorded) dot.
- Fallback when history has nothing (hand-filed archive, or pre-history archive): the old one-playlist `added_at` lookup, source `'playlist'`.
- **`ArchiveAction` now writes an `'archive'` triage action on each archived track**, with `context_playlist_id` (the archive playlist) and a new `action_ref: { id: 'archive:<YYYY-MM>', created_at }` pointing at the run's `action_history` row. `action_at` = the run's `created_at`, so the pointer and the date agree. Status-neutral (`STATUS_BY_TRIAGE_ACTION.archive = null`): archived tracks stay `'promoted'`.
- The log writes run in their own chunked sets **after** the move set, so a failed move (which aborts the action) never leaves a track claiming an archive.
- Track page prefers the `'archive'` log entry and drops history/playlist evidence within 60 s of it (same run).

## Learned / corrected
- I first said archives leave no record. Wrong: every `ArchiveAction` run with moves keeps an `action_history` row (no TTL) whose `move-track` mutations hold the track ids. Only the track row had nothing.
- `archive:<YYYY-MM>` is the month of the **run**, not the archive playlist's month (e.g. `archive:2026-11` holds moves into `2026 - September`), so lookups must scan every run month since the promote.
- Bug found in the track planner: a lone `'upvote'` after a promote (re-promoting a track already in Current logs only an upvote) was drawn as a step back to Liked (seen on "Madhouse"). A lone upvote now counts as Liked only before the track has reached Liked.

## Not covered
- Archives filed by hand in Spotify still have only the playlist `added_at`, and only for the promote month.
- The new `'archive'` log entry is written only by runs after this deploys; no backfill of earlier archives (history covers those).

## Tests
- `web-track.test.ts`: `archiveMovesFor`, `archiveRunMonths` (year rollover), history archive, log-vs-history dedupe, lone-upvote fix. `archive-plan.test.ts` pins the new triage write and set order; `dynamo-track-updates.test.ts` pins `archive` as status-neutral. 596 pass, typecheck clean. Verified on live data locally.

Not deployed.
