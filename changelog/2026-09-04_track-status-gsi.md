# 2026-09-04 — `track` table: sparse `status` GSI replaces the reconciliation scan, reads raised to 5 RCU

## Why

A DynamoDB cost/throttle audit against the live account found that the
`ArchiveAction` reconciliation sweep (`Dynamo.tracksWithLiveStatus`) was a
full-table `Scan` of `track` on every 6-hourly `frequent-crawling` run:

- `track` is 15,808 rows / 2.27 MB and is never pruned, so the scan cost
  ~283 RCU in a single burst, plus ~80 RCU from the rest of the run.
- The table was provisioned at 1 RCU, whose burst bucket caps at 300 RCU.
  370 > 300, so **every scheduled run throttled** (299 `ReadThrottleEvents`
  in 30 days, all in the `:45` cron buckets).
- `retryWithBackoff`'s schedule (0.5 s doubling to a 30 s cap) sums to ~61 s
  across 8 attempts, inside an 80 s Lambda timeout, while a throttled 1 MB page
  needs ~125 s of refill at 1 RCU/s. So a throttle became a timeout:
  **13 of ~56 runs in 14 days died at 80.8–81 s**, and EventBridge's async
  retry a minute later landed on a drained bucket and often died too.
- The scan read ~16k rows to find **1–73** with a live status (the
  `scanned N rows with a live status` log lines). Filters do not reduce RCU.

The dollar cost was never the issue: all four provisioned tables sit inside the
25 RCU / 25 WCU always-free tier and DynamoDB billed $0.02 total in August, all
of it on-demand writes to `liked_songs`. The cost was the failed maintenance
runs.

## What changed

### Live AWS (applied, one `update-table` call each)

- `track` provisioned reads **1 → 5 RCU** (writes unchanged at 1). Burst bucket
  is now 1,500 RCU. Account-wide provisioned total goes 4 → 9 RCU including the
  new index, still inside the free tier, so this costs $0.
- New GSI **`status-id-index`**: HASH `status`, RANGE `id`, **KEYS_ONLY**,
  1 RCU / 1 WCU. It is sparse — only rows carrying a `status` attribute exist in
  it. Backfill took ~3 minutes. Verified live after ACTIVE:

  | Query | Count | RCU |
  |---|---|---|
  | `status = inbox AND begins_with(id, "koalemos:")` | 62 | 0.5 |
  | `status = promoted AND …` | 6 | 0.5 |
  | (`removed`, not read by the sweep) | 133 | 1.0 |

  68 live rows for 1 RCU, matching the most recent scan-based runs' `scanned 68
  rows with a live status`. The old scan paid ~283 RCU for the same answer.

### Code (`src/db/dynamo.ts`)

- `tracksWithLiveStatus()` now issues one paginated `QueryCommand` per status in
  `LIVE_TRACK_STATUSES` (`'inbox'`, `'promoted'`) against `TRACK_STATUS_INDEX`,
  keyed `#status = :status AND begins_with(id, :prefix)` so it stays scoped to
  the user prefix. Same `retryWithBackoff` wrapper and the same return shape
  (`TrackStatusRow[]` with the user prefix stripped), so `ArchiveAction` and
  its planner are untouched.
- New exports: `TRACK_STATUS_INDEX`, `LIVE_TRACK_STATUSES`, and a pure
  `liveStatusQuery(status, idPrefix, cursor?)` builder so the wire shape is
  testable without DynamoDB, following the repo's planner/shell split.
- Removed the now-unused `ScanCommandInput` import and the redundant dynamic
  `import('@aws-sdk/lib-dynamodb')` of `ScanCommand` inside
  `getRecentActionsOfType` (the static import already covered it). That method
  still scans `action_history`; it is the `undo-last` path and is unchanged.
- KEYS_ONLY means listen writes (`updateTrack`, which touch neither `id` nor
  `status`) cost nothing on the index. Only status-changing writes
  (`addTrackTriageAction`, `setTrackStatus`) pay 1 extra WCU.

### Config and docs

- `config/dynamo-tables/track.json` added. The table previously had no
  definition file at all (its schema was implied by call sites and by
  `docs/aws-infrastructure.md`), so nothing could create it locally.
- `docs/aws-infrastructure.md` `track` section now carries the GSI in its
  `create-table` example, the two `update-table` commands that were run, and
  the reasoning above.

### Tests

- New `src/__tests__/dynamo-live-status.test.ts` (7 tests): the query builder's
  exact wire shape, one Query per live status and never a Scan, prefix
  stripping, `LastEvaluatedKey` pagination to completion, and that a throttled
  page is retried rather than truncating the sweep.
- Full suite: **584 pass / 0 fail across 34 files**.
- `bun run typecheck` reports one pre-existing error in
  `src/__tests__/undo-plan.test.ts:137` that is also present on a clean checkout
  of `HEAD`; it is unrelated to this change and was left alone.

## Not done / follow-ups

- **Not deployed.** The Lambda still runs the scan until `ruby scripts/publish.rb`
  ships this. The index is ACTIVE, so deploying is safe at any time; the 5 RCU
  bump already stops the throttling in the meantime.
- The rest of the audit's findings are untouched: `getSeenTracks` fires ~60
  parallel single Gets per inbox scan (should be one BatchGet), `ArchiveAction`
  and `ProcessManualTriage` BatchGet the same Current rows twice per run,
  `undo-last` full-scans the 96 MB `action_history` table (a `userId` +
  `created_at` GSI would fix it; the attribute is already written), most
  `action_history` rows have no `ttl`, and the liked-songs cache does a full
  delete-and-rewrite daily and silently drops deep removals in the
  churn branch. None of these throttle the cron today.
- `DescribeTable` will report the index's `ItemCount` as 0 for up to six hours
  after creation; that counter is lazily updated. The Query counts above are the
  truth.
