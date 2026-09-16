# 2026-09-16 — Dashboard Current feed mirrors Current playlist order

## What changed

The read-only Hono dashboard's **Current** section now lists tracks in the same
order as the actual Current Spotify playlist, instead of sorting them
least-played-from-Current first.

- `currentPlan()` in `src/web/current.ts` no longer applies
  `.sort((a, b) => a.playsFromCurrent - b.playsFromCurrent)`. Because
  `snapshot.playlistTracks` already arrives from Spotify in playlist order and
  `flatMap` preserves it, dropping the sort yields playlist order for
  `/api/current` (and therefore the dashboard).
- The dashboard subtitle copy in `src/web/index.html` changed from
  "Plays started from Current. Least played first." to
  "Plays started from Current. In Current playlist order."

## What was preserved

- **`listen-stats` is unchanged.** `listenStatsPlan()` reuses `currentPlan()`'s
  tracks, so to keep the action's original JSON contract (least-played-first)
  it now re-applies the same `playsFromCurrent` sort locally. The
  `listen-stats preserves its original JSON contract exactly` test still passes
  untouched.

## Tests

- `web-current.test.ts`: the `currentPlan` case now asserts playlist order
  (`['a', 'b']` — `a` is first in `playlistTracks`, the `null` entry is dropped,
  `b` follows) and its `tracks[0]`/`tracks[1]` expectations were swapped to
  match. Renamed to `…mirrors Current playlist order`.
- Full suite: **601 pass / 0 fail**, `tsc` clean.

## Deploy

Shipped to `spotify-playlist-dev` via `ruby scripts/publish.rb`
(`provided.al2023` / arm64 / Bun layer 2). Verified live at the Function URL —
the Current feed's play counts are no longer monotonic, confirming playlist
order rather than a play-count sort.
