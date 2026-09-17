# 2026-09-17 — Inbox dashboard drops region-locked (greyed-out) tracks

## The bug

The `/api/inbox` dashboard feed was still showing "unavailable" tracks even
though the code comment (`src/web/app.js:77`) and AGENTS.md both claim
unavailable tracks are dropped. The planner filter (`src/web/inbox.ts`) only
dropped entries whose `track` was fully `null` (a track removed from Spotify).
A **region-locked** track — greyed out in the Spotify app because it isn't
available in the operator's market — still carries a valid `id`, `name`, and
`artist`, so it sailed straight through the filter.

## The fix

Detect region availability from Spotify's `available_markets`, **without**
passing a `market` param to the playlist read. That choice is deliberate:

- No `market` param → Spotify returns each track's full `available_markets` **and
  does not relink track ids**. The ids stay aligned with the DynamoDB
  `play_count_inbox` / liked-status lookups the feed does next. A `market` /
  `from_token` read would have populated `is_playable` but could swap an
  unavailable id for a playable equivalent (`linked_from`), quietly misaligning
  those lookups on this read-only feed.

### Changes

- **`src/web/inbox.ts`**
  - New exported pure helper `trackAvailability(track, country): 'available' | 'unavailable'`.
    Unavailable when `available_markets` is present but excludes the country (an
    empty list counts) or `is_playable === false`. An **unknown country** or a
    **missing `available_markets`** stays `'available'`, so incomplete data never
    blanks the whole feed.
  - New `Availability` enum and an optional `availability` field on `InboxEntry`
    (optional → omitting it means available, keeping every existing caller/test
    meaning intact).
  - `inboxPlan` filter now also drops `availability === 'unavailable'`. Position
    numbering already leaves a gap for dropped items, so a hidden region-locked
    track jumps the numbering rather than renumbering from 1 — same as a null.
  - `gatherInbox` resolves the account market via `client.myCountry()` (fetched in
    parallel with the playlist) and tags every entry through `trackAvailability`.
- **`src/spotify.ts`** — refactored `myID()` onto a shared private `me()` loader
  and added `myCountry()` (cached `getMe().country`).
- **`src/spotify-web-api-node.d.ts`** — added `country?` to `User` and
  `available_markets?` to `Track` (both already returned by the API; only the
  types lacked them).

### Enum choice

`availability` is a string-literal union (`'available' | 'unavailable'`), not a
boolean, per the repo/operator convention of preferring enums even for two-value
states.

## Tests

- `src/__tests__/web-inbox.test.ts`: region-locked entry is dropped with the
  numbering gap preserved; a no-`availability` entry stays available
  (backward-compat); plus a `trackAvailability` block covering in-market,
  out-of-market, empty list, `is_playable: false`, unknown country, missing
  `available_markets`, and null track.
- Full suite: **575 pass / 0 fail**, `bun run typecheck` clean.

## Not changed

- `/api/current` still shows all Current tracks (region-locking wasn't reported
  there; Current is the operator's own curated rotation, not weekly imports).
- No `market` param was added to the shared `tracksForPlaylist`, so the write
  paths (archive/promote/manual-triage) keep their un-relinked ids.
