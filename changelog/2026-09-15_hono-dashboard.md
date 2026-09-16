# Read-only Hono listening dashboard

Implemented the plan in `docs/hono-frontend-plan.md`, with the user's subsequent
corrections: **archived**, not promoted; dark Spotify-inspired UI; include manual
archive additions; one row per archive event rather than distinct tracks.

## Changes

- `/` serves the dashboard and `/app.js` its small vanilla client. No build step.
- `/api/current` shows Current membership, Current play counts, time in rotation,
  and configured archive thresholds. `/api/archived?limit=20` shows the latest
  additions still present in monthly archive playlists (limits 1–20).
- Archive ordering uses Spotify `added_at`, not the month in the playlist name.
  Every matching monthly playlist is read to include manual additions to old
  months. Duplicate tracks remain separate events; deleted entries cannot be
  recovered. DynamoDB joins only the selected unique track ids.
- The proposed action-history index became unnecessary after the archive
  correction. No new GSI, table configuration, or feed Query was added.
- `listen-stats` shares the Current planner and retains its original JSON shape.
  Null/id-less tracks are skipped, and day arithmetic uses exported `DAY_MS`.
- Shared error normalization moved out of the action handler. Hono handles both
  Error instances and the existing code's string throws.
- An exported gate preserves existing action paths, any root `action` query key,
  non-GET calls, and EventBridge invocations. Attached AWS event fields take
  precedence over the layer's URL for HTTP identity, method, path, and queries.
- UI requests are sequential, retry once, and render track text with textContent.
  Spotify links derive from encoded track ids. Empty/error states are independent.
- The archive feed is persisted for 12 hours in a versioned cache attribute on
  the existing user row. Hits are one projected, consistent GetItem with no
  Spotify/token bootstrap; only a miss/expiry gathers Spotify data. The cache
  contains all 20 entries regardless of requested limit. Concurrent refreshes
  within an instance share the load; errors are not cached. Development uses a
  separate attribute. Writes update only the cache and require an existing user.
- Cache tests pin expiry at exactly 12 hours, preservation of generatedAt,
  different limits, persisted reads after loader recreation, concurrent refreshes,
  failure retries, and the one-GetItem wire contract.
- Local Bun idle timeout is 90 seconds; Lambda's timeout is unchanged at 80 seconds.

## Validation

- Typecheck passes; full suite passes (601 tests).
- Planner tests cover old-month manual additions, duplicates, sorting, limits,
  missing records, and unavailable tracks. Gather test checks all matching months
  and deduplicated BatchGet ids. Gate tests cover local, v1, v2 and scheduled events.
- Hono route tests cover assets, injected loaders, JSON errors, unknown endpoints,
  and query validation.
- Local handler with real read-only data: Current HTTP 200, 23 tracks, about 1.5s;
  archive HTTP 200, 20 entries in descending date order, about 41s.
- Chrome desktop and 390px mobile inspected; no horizontal overflow on mobile,
  and all 20 archive rows rendered.

## Release state

Deployed on 2026-09-16 using `ruby scripts/publish.rb`, after user approval of
persistent 12-hour caching and the simpler full deployment bundle. This also
ships the existing 45-day OR 5-Current-play archive triggers, status-GSI Query,
and parallel Spotify playlist paging.

Live verification:

- Page, JavaScript, Current API, archive API, and `/?action=user`: HTTP 200.
- First live archive rebuild: 34.39s; subsequent cached request: 0.080s with the
  same generatedAt. Local cache miss/hit: 45.19s / 0.020s.
- Returned 23 Current tracks and 20 archive entries. The cached joined status and
  play counts share the same 12-hour snapshot; Current is read fresh.
- Exact live `Archive-Trigger` payload: 5/5 actions succeeded on retry in 4.39s.
  An initial overlapping invoke was rejected by reserved concurrency 1. The first
  executed workflow then hit a `track` read throttle; retry after capacity
  recovered succeeded. The live `track` table is currently **1 RCU**, despite
  older documentation describing 5 RCU. Capacity was not changed.
- Peak memory in verification: 360 MB of 512 MB; the archive rebuild itself
  reported 342 MB. Runtime, layer, handler and memory are unchanged.
- Pre-deploy code/config snapshot:
  `~/Library/Application Support/spotify-playlist/deploy-backups/20260916-074927-hono/`.

No new table, GSI, scheduled trigger, or provisioning change was required. The
cache is rebuilt on the first request after expiry, not by a 12-hour timer.
