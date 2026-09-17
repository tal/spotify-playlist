# 2026-09-17 — Archive dashboard feed reads only the newest months, cache dropped

## What changed

The read-only dashboard's **archive feed** (`/api/archived`) no longer crawls
*every* `YYYY - MonthName` archive playlist. It now reads the newest months
first and stops as soon as it has collected enough additions to fill the
display limit. The 12-hour DynamoDB cache that papered over the old full crawl
is gone.

## Why

The old `gatherArchived` fetched the tracks of **every** matching archive
playlist on every rebuild, purely so a manual addition to an ancient month
couldn't be missed. That is the slow part of the dashboard (the UI even warned
"this can take about a minute"), and it only got slower as archive months
accumulate. The operator decided that catching a manual add to an *old* month
isn't worth that cost — reading just the last few months is plenty.

## Behavior now

- `gatherArchived` filters `allPlaylists()` to archive names, sorts them
  **month-descending** with the new `archiveMonthOrder(name)` helper (in
  `settings.ts`; tolerates the dev `[Test] ` prefix, sinks non-archive names to
  `-Infinity`), then reads newest-month-first.
- It **breaks after the first playlist that brings the collected additions to
  the requested limit**. The break is checked only *between* whole playlists, so
  every addition inside a read month is included before it stops. `archivedPlan`
  still sorts by `added_at` descending and slices to the limit, so the result is
  the newest `limit` additions among the months that were read.
- Because months are chronological, the newest `limit` additions overall are
  guaranteed to be within the months read — **except** a manual addition to an
  older month, which is the deliberately-accepted blind spot.
- The `/api/archived` API contract is unchanged: still an integer `limit` of
  1–20, default 20. (The "30" from the original ask was dropped in favor of
  keeping the existing limit; smaller limits now read *fewer* months.)

## Cache removed

- Deleted `src/web/archive-cache.ts` (`cachedArchiveLoader`, `ARCHIVE_CACHE_MS`,
  cache types) and `src/db/archive-cache.ts` (`dynamoArchiveCacheStore`).
- `src/lambda-bun.ts` now wires `archived` directly:
  `async (limit) => gatherArchived(await koalemosContext(), limit)`. Fresh every
  load, like Current / Inbox / Promotes.
- The `archiveDashboardCacheV1` / `archiveDashboardTestCacheV1` user-row
  attributes are **no longer written or read**. Any value left there from before
  is dead data; it was **not** migrated away (harmless, and cheaper to leave).

## Frontend copy

`src/web/app.js`: "Checking monthly archives… This can take about a minute." →
"Reading the latest monthly archives…", and the "Archives updated … · cached
for 12 hours" footer → "… · live".

## Tests

- `web-archived.test.ts`: replaced the old "reads every matching month including
  old ones" test with two — one proving it reads the newest month first and
  **stops** (older months never visited), one proving it **keeps reading** older
  months until the limit is filled. Both also confirm only selected ids are
  joined against Dynamo and dev-prefixed / non-archive playlists are skipped.
- `archive-playlist-name.test.ts`: added an `archiveMonthOrder` block (strict
  year-then-month ordering, dev-prefix tolerance, non-archive names sink last).
- Deleted `web-archive-cache.test.ts` and `dynamo-archive-cache.test.ts`.
- `web-routing.test.ts` unchanged and still green (API contract untouched).

Full suite: **573 pass / 0 fail**, `tsc` clean.

## Docs

Updated the "Read-only Hono dashboard" section of `AGENTS.md`: the archive-feed
paragraph now describes the newest-first / stop-when-filled read and its
trade-off, and the caching paragraph records that the archive cache and its
DynamoDB attributes were removed.

## Not deployed

Ships on the next `ruby scripts/publish.rb`. The Lambda keeps the full crawl +
cache until then.
