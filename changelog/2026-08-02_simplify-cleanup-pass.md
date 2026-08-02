# 2026-08-02 — Cleanup pass over the listen-limit branch

Quality-only pass (`/simplify`, four review angles) over the uncommitted diff on
`listen-limit-before-archiving`. No behavior changes intended; 48/48 tests pass
and `tsc --noEmit` is clean.

## Applied

### Reuse

| Fix | Before | After |
| --- | --- | --- |
| Chunk size | `STATUS_WRITE_CHUNK = 25` + `TRIAGE_WRITE_CHUNK = 25` + three bare `25`s in `dynamo.ts` | one exported `DYNAMO_WRITE_CHUNK`, where the BatchWrite constraint originates |
| Throughput predicate | `isDynamoThroughputError` copy-pasted verbatim **4×** inside `dynamo.ts` methods, with the new scan about to add a differently-shaped 5th | one module-level function, five call sites |
| Key de-prefixing | `id.match(/:(.+)/)` open-coded twice, plus an inline `${this.user.id}:` prefix rebuild | `ungId()` beside `gId()`; prefix from `gId('')` |

### Simplification

- **Status clause written out three times** — `addTrackTriageAction`,
  `updateTrack`, and `setTrackStatus` each hand-built `#status = :status`,
  `status_changed_at = :status_changed_at`, the reserved-word alias, and the same
  comment. → one private `appendStatusClause()`. The status and its
  `changed_at` can no longer be written apart from each other.
- **`performInbox` / `performCurrent` were two ~45-line near-identical methods**
  differing in exactly two tokens (which playlist, which `action_type`). This
  diff is what made both live — `performCurrent` previously discarded its
  mutations — so the duplication was newly load-bearing. → one
  `backfillStage(dynamo, playlist, action_type)`, called twice. Also collapses
  two `getTriageInfo()` awaits into one.
- **`mostRecentPlayedAt` was write-only state** — computed by side effect inside
  a `.map()`, threaded through as `ts`, then unconditionally overwritten by
  `UpdateLastPlayedProcessedMutation.mutate()`, since the sole construction site
  always passes a sequence. Two variables tracked "how far did we get".
  → `sequence` is now a required constructor param, the mutation takes
  `{ userId }` only, and `data.ts` is seeded from `sequence.watermark` so it is
  never a lie. The accumulator is gone.
- **`trackIdsIn` was called once while the identical shape sat inlined 20 lines
  below it**, so the "a null track must not kill the pass" comment guarded only
  half the places that needed it. → generalized to `idsIn()`, used by both. Drops
  the odd inline `type PlaylistTrack = import(...)` alias.

### Efficiency

- **`ArchiveAction.perform` ran its two slowest reads back to back** — the table
  scan and the walk of Current hit *different services* and share no state.
  → overlapped via `Promise.all`. `reconcileTrackStatus` takes `rows` instead of
  `dynamo`; its own Spotify reads deliberately stay *after* the archive pass
  rather than racing it for the playlist cache that
  `getOrCreatePlaylist(_, forceRefresh)` resets.
- **`allTracks()` had no throughput backoff at all** — an unbounded scan on a
  per-minute path is what trips DynamoDB limits, and a throttled page would have
  silently truncated the sweep into "these rows vanished", i.e. spurious
  `'removed'` writes. → same `retryWithBackoff` + `isDynamoThroughputError`
  pairing every other retried call in the file uses.
- **`getOrCreatePlaylist(name, forceRefresh: true)` ran inside the per-track
  loop** (pre-existing, fixed on request). `forceRefresh` nulls the playlist
  memo, and `_createdPlaylists` only shortcuts playlists created *this run* — so
  every aged track targeting an already-existing archive playlist re-paginated
  every playlist the account owns. This account accrues one archive playlist per
  month, so a few hundred playlists means 4–8 `getUserPlaylists` calls per
  refresh; 20 aged tracks ≈ 80–160 redundant calls against a rate-limited API,
  for a mapping that changes at most once per pass.
  → tracks are bucketed by target *name* first, then one `getOrCreatePlaylist`
  per distinct month (typically one). Only the first lookup forces a refresh —
  that's what catches a playlist another Lambda instance created since this one
  cached its list; later months read the memo it just populated. The dead `foo`
  map went with it.
- **`allTracks()` → `tracksWithLiveStatus()`** — it pulled *every* track row ever
  written, deserialized each one including its append-only `triage_actions`
  array, shallow-copied all of them, then discarded the majority in two filter
  passes. → `FilterExpression` narrows to `status IN ('inbox', 'promoted')` and
  `ProjectionExpression` fetches only `id, status`. Rows with no status are
  excluded, which is what the caller already did by hand. Does **not** cut RCU
  (a scan bills on pre-filter item size) — it buys payload, unmarshalling, and
  Lambda memory.

## Skipped, with reasons

- **Reuse `getTriageInfo()` for the new Inbox/Current resolutions.** It resolves
  five playlists, not two, and uses `client.playlist` (throws) where the new code
  deliberately chose `optionalPlaylist`. Adapting it means touching four
  unrelated callers and undoing an intended behavior of this branch.
- **Route `getTracks`' `UnprocessedKeys` loop through `retryWithBackoff`.**
  `UnprocessedKeys` arrives on a *successful* response, so it needs a sentinel
  throw, and the loop retries only the unread subset — state `retryWithBackoff`
  can't carry. The explicit loop is the clearer form.
- **Consolidate `playlistIdFromContextUri` with `isCurrentlyPlayingInTriage`.**
  Real duplication, but the new parser handles `playlist_v2` and the two existing
  sites don't. Unifying them changes existing behavior — a correctness fix for
  `/code-review`, not a cleanup.
- **Delete `buildArchiveMatcher` and most of its test.** It is dead shipped code
  with no production caller, and the author's comment defends it as the oracle
  the round-trip test pins the namer against. Overriding an explicit, documented
  authorial decision isn't cleanup.
- **`ListenSequence.recordSuccess`'s halted guard is unreachable today**
  (`intent()` skips first). It's the class's own invariant, correctly placed, and
  it survives someone batching listens into one mutation set.
- **`MutationIntent` / `intent()` / `'skipped'` on the base `Mutation` class serve
  one subclass.** Four lines, defaults to `'run'`, zero cost to every other
  subclass — a general mechanism, not a special case.
- **Whole-file prettier run on `dynamo.ts`.** It already failed at `HEAD`;
  reformatting would bury the review in unrelated noise.

## Raised by review, deliberately deferred (design calls, not cleanups)

These are real and worth a decision, but each changes behavior or structure well
beyond the reviewed diff:

- **`ListenSequence` puts set-ordering orchestration in the mutation layer.** The
  invariant it depends on — one listen per set, ascending `played_at`, watermark
  last — is stated only in a comment and enforced by nothing. Chunk the playback
  path for throughput the way three other sites in this same diff already do, and
  `Promise.all`-within-a-set silently lets the watermark advance past a failed
  write. `performAction` in `actions/action.ts` already owns "iterate sets, abort
  on throw" and is where the concept belongs. The tests don't catch this because
  they drive mutations by hand rather than through the real runner.
- **`ArchiveAction` now does two unrelated jobs sharing only a schedule.** The
  sweep inherits `idThrottleMs = 60 * 1000`; `forStorage`'s ttl heuristic keys on
  `mutations.length`, so one reconcile mutation flips ttl to `undefined` and
  archive history rows that used to expire in 2 days are kept forever; one
  `action_history` row conflates "moved 12 tracks" with "marked 40 removed".
  Wants its own `ReconcileTrackStatusAction` with its own throttle.
- **`ArchiveAction.getID()` returns `archive:${this.created_at}`**, and
  `getActionHistory` is an exact-match key query on it — so `idThrottleMs` can
  never actually fire. Pre-existing, but it's the only apparent guardrail on the
  new scan.
- **`UpdateLastPlayedProcessedMutation` writes its result over its own input.**
  `SuccessResult { data }` exists on the base class for exactly this and is never
  populated; `storage` therefore means one thing before `run()` and another after.
  Skipped mutations also land in `action_history` indistinguishable from ones
  that wrote.
- **The three `BatchWriteCommand` sites never inspect `UnprocessedItems`** —
  writes still drop silently under the same throttling that motivated the
  `getTracks` fix. The reasoning was applied to the one call site that hurt, not
  to the primitive.
- **`{ track: null }` is guarded at one call site, not in `tracksForPlaylist`.**
  `archive-action.ts`, `process-manual-triage.ts`, and `index.ts` all still
  dereference `t.track.id` bare.

## Flagged, not fixed (pre-existing, outside this diff)

- `tracksWithLiveStatus()` is still a full table scan on every
  `frequent-crawling` run. A sparse GSI on `status` would make it two small
  Querys, since only live rows carry a status.
