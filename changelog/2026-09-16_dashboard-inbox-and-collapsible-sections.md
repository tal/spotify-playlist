# 2026-09-16 — Dashboard Inbox feed + collapsible sections

## What changed

Two additions to the read-only Hono dashboard.

### New Inbox section

A third feed between **Current** and **Recently archived**: the top 20 tracks in
the Inbox playlist, **in playlist order**, each showing its **like status** and
its **Inbox listen count**.

| Piece | Detail |
|---|---|
| Endpoint | New `GET /api/inbox` (fixed top 20; no `limit` query param) |
| Planner | `src/web/inbox.ts` — `inboxPlan(entries, records, savedTrackIds, now, limit=20)`, pure. `gatherInbox(ctx)` does the I/O |
| Order | Inbox playlist order, unavailable/null tracks dropped, then first 20 |
| Numbering | Each row shows its **true Spotify playlist position**, not a 1..N sequence. A dropped unavailable track leaves a **gap** (e.g. `…8, 10…`) instead of renumbering below it. `position` = the item's 1-based index in the full playlist (unavailable items stay counted) |
| Like status | `likeStatus: 'liked' \| 'unheard'` (string union, not a boolean) — derived from `Spotify.tracksAreSaved()` (saved = the operator's "Liked"/3-star tier) |
| Listen count | `playsFromInbox` = the track record's `play_count_inbox` (plays *started from* Inbox), default 0 |
| UI | Filled green ♥ + "Liked" vs. hollow grey ♡ + "Unheard"; right-hand metric is `N plays / in Inbox` |

`gatherInbox` follows `archived.ts`'s double-plan pattern: it runs `inboxPlan`
once with empty records to learn which ≤20 ids the top of the feed needs, then
fetches DynamoDB records **and** saved status for exactly those ids (one
`containsMySavedTracks` call, well under the 50-id cap), and re-plans.

### Collapsible sections

All three sections (Current, Inbox, Recently archived) are now **collapsible and
start open**. Implemented with native `<details class="panel" open>` /
`<summary class="section-head">` — no JS, keyboard-accessible, and it announces
expanded/collapsed for free. A CSS chevron (`.chev`) rotates -90° when closed.
The old `<section aria-labelledby>` wrappers and the `.section-head` `<div>`s were
converted in place; `.list` ids and the `app.js` render targets are unchanged.

## Frontend

- `app.js`: new `renderInbox(target, tracks)` (heart + inbox play count). `refresh()`
  loads `/api/inbox` **sequentially** between Current and archives — the Lambda has
  reserved concurrency 1, so requests must never overlap.
- `index.html`: new Inbox `<details>` block, `.heart` / `.heart.liked` styles, and
  the `summary`/`.chev`/`.panel` collapsible styles. `summary:focus-visible` gets
  the same green focus ring as buttons and links.

## Tests

- New `web-inbox.test.ts` (3 tests): playlist order preserved, unavailable dropped,
  `likeStatus` derived from `savedTrackIds`, `playsFromInbox` from records, `limit`
  respected after the drop, empty-inbox report. Position preservation is pinned by
  dropping position 2 and asserting the remaining rows read `[1, 3, 4]`, not `[1, 2, 3]`.
- `web-routing.test.ts`: `buildWebApp` now requires an `inbox` loader (both call
  sites updated); `/api/inbox` added to the accepted-route list and asserted to
  return its loader payload and to normalize a loader error (a `cannot find`
  string → 400, same ladder as the others).
- Full suite: **604 pass / 0 fail** (was 601), `tsc` clean.

## Deploy

Shipped to `spotify-playlist-dev` via `ruby scripts/publish.rb`
(`provided.al2023` / arm64 / Bun layer 2). Verified live at the Function URL:
`/api/inbox` returns 20 tracks in playlist order (7 liked / 13 unheard,
`playsFromInbox` 0–3), and the dashboard renders the Inbox feed with hearts +
counts. Confirmed each section collapses and re-opens.
