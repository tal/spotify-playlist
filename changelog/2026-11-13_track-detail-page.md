# Track detail page with workflow swimlane

## What
- New dashboard view at `#track/<id>` (hash route, not a tab) backed by `GET /api/track/:id` (`src/web/track.ts`).
- Every track row's name now opens the detail view; a small `↗` beside it still opens Spotify.
- View shows: cover + current stage chip, all listen counts (total / from Inbox / from Current with archive-threshold bar / elsewhere), first/last seen, projected archive date, a **swimlane timeline** (SVG, one lane per stage Unheard/Liked/Current/Archived/Removed, bars = dwell time, dashed elbows between stages, dots = events, "now" and "archive by" markers) and a chronological event list.

## Data (existing only, no per-listen log)
- `track` row: `triage_actions`, play counts, `first_seen`/`last_seen`, `status`/`status_changed_at`.
- Live Spotify: track metadata, saved status, Inbox + Current membership (`added_at`), and the **one** monthly archive named from the latest `'promote'` date (no archive crawl — a hand-filed archive in another month is not found).
- An `'upvote'` sharing its `action_at` with a `'promote'` is the promote's own bookkeeping; a lone `'upvote'` is the Unheard → Liked step.
- Playlist `added_at` fills gaps the triage log hasn't caught (hand edits, archiving — which writes no triage action). Each event carries `source: 'triage-log' | 'playlist' | 'status'`.

## Found along the way
- **Production status drift:** tracks still in Current and saved (e.g. `5eulksXER6kgEb7VnXf5me`) have `status: 'removed'` with a `status_changed_at` days after their promote. An archived track showed the same pattern before it was archived. Likely the `ArchiveAction` reconciliation sweep; not investigated or fixed here.
- Because of that, a `'dropped'` event (status `removed` with no later explicit `'remove'`) is marked `standing: 'contradicted'` whenever live playlists place the track somewhere — it is listed (faded) but excluded from the swimlane segments. The first version plotted it and wrongly cut the Current bar short.

## Tests
- `src/__tests__/web-track.test.ts` (8 tests): event derivation, upvote/promote pairing, playlist gap-filling without duplicates, demote vs. drop, contradiction handling, open/closed final segment, id validation + route. 587 pass, typecheck clean.
- Verified against live data via the local server and in Chrome.

Not deployed.
