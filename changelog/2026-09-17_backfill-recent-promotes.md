# 2026-09-17 — Backfill the "Recently promoted" feed from action_history

## Why

The dashboard's **Recently promoted** section was empty. Diagnosis (confirmed
against live prod, `GET https://spotify.tal.by/api/promotes` → `trackCount: 0`):

- The feed's source, `recentPromotesV1` on the user row, is **forward-only** — a
  pointer is appended only when a *new* promote is recorded, after the feature
  shipped (`8f38d09`). Nothing had been promoted since, so the list was empty.
- It was **not** because promotes lack the new `before`/`after` snapshots.
  `promotesPlan` drops a row only when it has no `item`; a missing snapshot just
  renders blank. A bounded-Scan probe of the live table found **271 promotes in
  the first 4 pages, all nameable, and 0 with before/after** — even the newest
  (2026-09-15). So snapshot capture isn't producing data yet, but that never
  blocked the feed.

## What shipped

A one-time, idempotent backfill that seeds `recentPromotesV1` from
`action_history` — the **only** sanctioned Scan of that table, and never on a
page-load path (the feed still never Scans).

- `src/db/dynamo.ts`:
  - `planBackfillList(existing, scanned, cap)` — pure: merge, dedupe on
    `(id, created_at)`, sort newest-first, trim to cap. Forward-appended refs are
    newer and survive the sort.
  - `Dynamo.backfillRecentPromotes({ target, pageLimit })` — **lazily** pages a
    filtered Scan (`action = 'promote-track'`, projecting only the composite
    key): reads one page, fetches the next **only if** it still holds fewer than
    `target` pointers. Each page examines at most `pageLimit` rows. Merges with
    the existing list and writes it back under `attribute_exists(id)`.
  - Constants: `PROMOTE_BACKFILL_TARGET = RECENT_PROMOTES_CAP` (50),
    `PROMOTE_BACKFILL_PAGE_LIMIT = 400` (promotes are ~14–18% of rows, so ~400
    examined reliably clears 50 in one burst-affordable page ≈ 110 RCU).
- `src/index.ts`: `backfill-promotes` action returning the run summary; optional
  `?target=` / `?page-limit=` overrides. Run via `bun run cli backfill-promotes`.
- `src/__tests__/backfill-promotes.test.ts`: 6 tests pinning ordering, dedupe,
  same-track-different-time, cap, custom cap, and undefined-existing.

## Ran it against prod

One lazy page: `examined: 400, found: 67, stored: 50` in ~1s. The feed now serves
20 rows. **Known caveat, working as designed:** because Scan is hash-order, the
single page missed the genuinely newest promotes — the stored set tops out at
**2026-05-14**, though promotes from Aug/Sep 2026 exist in unread pages. Raising
`?target=` reads more pages (drains the burst bucket → throttle backoff, but
one-time) for a closer approximation; a full-table pass would guarantee true
newest-first. New promotes append correctly going forward, so the feed
self-corrects over time.

## Verification

- `bun run typecheck` clean.
- `bun test` — 580 pass / 0 fail (38 files), including the 6 new tests.
- Live `GET /api/promotes` → `trackCount: 20` after the backfill (was 0).
