# 2026-09-15 — Plan for a read-only Hono dashboard inside the Bun Lambda

Plan only; no production code changed. See `docs/hono-frontend-plan.md`.

## What was decided

- A read-only page for user `koalemos` showing Current-playlist tracks with
  `play_count_current`, plus the 20 most recently promoted tracks.
- JSON API under `/api/*` + one static HTML page + one vanilla JS file. No
  build step. No auth. Function URL only.
- `src/lambda-bun.ts` gates a narrow set of GET requests to Hono; everything
  else goes to the existing handler untouched.
- The promoted feed reads a **new `action_history` GSI**
  (`userId-created_at-index`), not the `track` status index and never the
  existing Scan.

## What was learned while planning

- `/?action=<name>` is the documented canonical Function URL form. A plain
  Hono `GET /` route would have swallowed every promote/demote/undo call. The
  gate now excludes `/` when an `action` query parameter is present.
- `action_history` is **96 MB / 38,464 rows at 1 RCU with no GSI**.
  `Dynamo.getRecentActionsOfType()` is a filtered Scan over it (same failure
  class as the `track` scan fixed 2026-09-04). Its only caller is
  `undo-last`, which is probably throttling today; not fixed here.
- The live `track` status index holds **2** rows with `status = 'promoted'`,
  so a feed built on it would show 2 tracks, not 20.
- `listen-stats` throws on a `null` playlist item track (local files); the
  extraction fixes it.
- `triage_actions` array order is not timestamp order (manual-triage backfill
  appends old `added_at` values); consumers must take the max.
- Under `module: commonjs`, TypeScript rejects import attributes (TS2823),
  `import.meta` (TS1343), and top-level `await` (TS1378); Hono subpaths do
  resolve under node10 via `typesVersions`. Verified with `tsc` in a scratch
  project under the repo's tsconfig.
- Reserved concurrency on the function is 1, so page loads that overlap the
  six-hourly job are throttled rather than queued.
- The Lambda's deployed code dates from 2026-08-26; four commits on `master`
  (45-day archive window, play-count archive trigger, status-GSI query,
  parallel paging) will ship with the first dashboard deploy.
