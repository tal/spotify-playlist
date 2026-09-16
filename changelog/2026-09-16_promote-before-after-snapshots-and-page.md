# 2026-09-16 — Promote before/after snapshots + "Recently promoted" page

## What this adds

Two things the operator asked for:

1. **Every non-throttled promote now records where the track sat and whether it
   was saved, before and after the action.** The snapshot is a lifecycle
   `stage` label (`unheard` → `liked` → `current`, plus `removed`) with a
   `saved` enum and the raw Inbox/Current membership it was derived from.
2. **A new dashboard page — "Recently promoted"** — shows the 20 most recent
   promote actions with those before/after snapshots and the track's live
   status today.

## Why "without throttling" comes for free

`performAction` (`src/actions/action.ts`) only reaches `action.perform()` and
`action.forStorage()` when the throttle check misses — a throttled promote
returns `{reason:'throttled'}` before either runs. The capture lives in those
two methods, so a throttled (duplicate) promote records nothing, which is
exactly the contract asked for. No extra throttle plumbing was needed.

## How the snapshot is captured

- **Before** is the same `TriageMembership` the planner already reads in
  `gatherPromote`. `MagicPromoteAction.perform()` now stashes it (and the track)
  on the instance before returning the plan.
- **After** is *measured*, not computed: `forStorage()` (which runs after the
  mutation loop) calls the new `readTriageMembership()`, which drops the two
  relevant playlists from the client's per-playlist track cache and re-reads
  Inbox/Current membership + saved status for the promoted track. Spotify is
  eventually consistent, so this is the measured state, not a guarantee.
- A failed after-read is swallowed — it must never stop the history row from
  being written, since the promote already happened. `before`/`after` are
  conditional keys, absent when not captured, so a `forStorage` with no prior
  `perform` writes the exact pre-existing row shape (the storage-contract test
  is unchanged).
- New exported helpers in `src/actions/track-action.ts`: `stageFor` (private),
  `locationSnapshot`, `readTriageMembership`. Row types extended in
  `src/db/action-history.d.ts` (`PromoteLocationSnapshotData`, `before?`/
  `after?` on `PromoteActionHistoryItemData`).

## How the feed avoids the forbidden Scan

The 2026-09-15 dashboard plan (`docs/hono-frontend-plan.md`) forbids sourcing a
"recently promoted" feed from `getRecentActionsOfType` — that is a filtered
Scan on a 96 MB / ~38k-row / 1-RCU table, and on that table it cannot even
reliably return the *newest* promotes (Scan order is arbitrary and it bails
after ~5000 rows). The plan's answer was a new GSI; the operator chose **not**
to create the GSI now.

Instead, a **materialized list on the user row** (`recentPromotesV1`, capped at
`RECENT_PROMOTES_CAP = 50`, newest-first) is maintained by `putActionHistory`
whenever it writes a `promote-track` row (demote/undo rows are skipped). The
feed reads that small list with one projected `GetItem`, `BatchGet`s exactly
those `action_history` rows, and joins the track ids against `track` for live
`status`/play counts. No Scan, no GSI, always the true newest — and because the
list only fills going forward, it naturally contains only promotes that carry
the new before/after snapshots. The list write is best-effort: a failure there
never undoes a promote that already ran.

- New in `src/db/dynamo.ts`: `nextRecentPromotes` (pure cap/prepend/dedupe),
  `recordRecentPromote` (read-modify-write on the user row, guarded by
  `attribute_exists(id)`), `getRecentPromoteRefs`, `getActionHistoryByRefs`
  (BatchGet with unprocessed-key retries).

## The page

- `src/web/promotes.ts` — `promotesPlan` (pure) + `gatherPromotes` (I/O),
  following the repo's `perform() = plan(await gather(ctx))` convention.
- `/api/promotes` route in `src/web/app.ts`; loader wired in
  `src/lambda-bun.ts` (**fresh every load, no cache** — the source is a tiny
  user-row list, nothing worth caching). `/api/*` GETs already route to Hono,
  so `shouldRouteToWeb` needed no change.
- A new collapsible "Recently promoted" `<details>` panel in
  `src/web/index.html` (between Inbox and Archived) and a `renderPromotes` in
  `src/web/app.js`, fetched sequentially (reserved concurrency is 1). Each row
  shows `stage → stage`, the saved change, when it was promoted, and where the
  track lives now (`now: <status> · N plays`). Undone promotes render dimmed and
  struck through.

## Verification

- `bun run typecheck` clean.
- `bun test`: **566 pass / 0 fail** across 39 files (after removing a stale,
  gitignored `dist/` that was making `bun test` also run old compiled `.js`
  copies — 42 "files" / 614 before).
- New tests: `src/__tests__/web-promotes.test.ts` (plan order, live-status join,
  before/after passthrough, missing-row/no-item drop, limit, gather I/O),
  `src/__tests__/promote-snapshot.test.ts` (`locationSnapshot`/`stageFor`,
  `nextRecentPromotes`, `readTriageMembership` cache-drop + fresh read,
  `MagicPromoteAction` before/after capture, failed-after-read tolerance).
  `web-routing.test.ts` extended for the new loader/route/panel.
- Local smoke test (`bun run src/lambda-bun.ts` against prod AWS): `/api/promotes`
  returns an empty feed (nothing captured yet — forward-only), `/` shows the
  panel, `/app.js` ships `renderPromotes`.

## Notes / limits

- **Forward-only.** Promotes made before this shipped are not in the feed and
  have no before/after — by design; the whole page is about the new snapshots.
- **After-state is best-effort** against Spotify's eventual consistency; a
  read taken immediately after add/remove can lag. Chosen deliberately over the
  computed transition target.
- The GSI remains uncreated; if the feed ever needs promotes older than the
  50-entry list, that is the follow-up (per the dashboard plan).
