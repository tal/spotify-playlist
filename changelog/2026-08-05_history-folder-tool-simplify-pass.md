# Simplify pass — `scripts/spotify-folders/` (History-folder tool)

**Date:** 2026-08-05
**Branch:** `move-to-folder`
**Scope:** quality-only cleanup of the read-only History-folder tool. No behavior change, no new features, no writes enabled.

Ran `/simplify` (4 parallel review agents: reuse, simplification, efficiency, altitude), deduped their findings, applied the safe high-value set, and independently re-verified every gate and the no-write invariant.

## Headline: the dormant write path is now fenced, not interleaved

The single biggest structural change. The apply/write machinery — which is deliberately dormant in this build (`--apply` is hard-disabled) — was interleaved into the live CLI and transport modules, its dormancy asserted only by runtime belts and prose.

- **New `apply.ts` (565 lines)** now holds the entire write path: `postRootlistChanges` + `buildRootlistChangesUrl` + the write-only wire types (`RootlistOp`, `RootlistChangeRequest`, `RootlistChangeResponse`), the backup subsystem (`BACKUP_DIR`, `RootlistBackup`, `buildRootlistBackup`, `assertBackupIsCredentialFree`, `writeRootlistBackup`), `WriteAuthorization`/`authorizeWrites`, `toRootlistOp`, and `convergeMovePlan`.
- **The no-write invariant got *stronger*, not weaker.** The dormancy proof is now a one-line grep — **no live/reachable module imports `./apply`** — instead of three runtime belts. `WRITE_MODE` (`'disabled'`) and `RootlistWritesDisabledError` stay in `rootlist.ts` as the named gate; `apply.ts` imports them. `postRootlistChanges` still throws as its literal first statement before constructing any URL/headers/body. The CLI's `--apply` refusal is a standalone branch that imports nothing from `apply.ts`.
- Enabling writes later is now: flip `WRITE_MODE` **and** wire `apply.ts` into the CLI — or delete `apply.ts` to remove the capability entirely.

## Line counts

| File | Before | After | Δ |
|---|---|---|---|
| `planner.ts` | 968 | 888 | −80 |
| `rootlist.ts` | 1015 | 824 | −191 |
| `move-archives-to-folder.ts` | 734 | 394 | −340 |
| `apply.ts` | — | 565 | +565 (new, quarantined) |
| `archive-name.ts` | 78 | 78 | — |
| **Total** | 2795 | 2749 | −46 |

The net is only −46 because the write path was **moved, not deleted** (an explicit product decision — ship the apply loop as reviewable-but-dormant code, removable later). The meaningful number is the **live read-only surface**: `planner + rootlist + CLI + archive-name` dropped ~611 lines, with all dormant code isolated in one deletable file.

## Other changes applied

| Area | Change | Flagged by |
|---|---|---|
| `planner.ts` | Deleted `collectDescendantFolderIds` + the `'history-descendant'` disposition — a quadratic fixed-point loop whose result is provably always empty (the nested-folder assert makes any History-nested folder fatal). Hoisted the assert above `classifyPlaylists`; behavior identical. | **all 4 agents** |
| `planner.ts` | Dropped vestigial ordering fields left from the cut chronological-ordering machinery: `MovePlan.orderingMode`/`writeMode`, `PlannedMove.{year,month,source}`, `HistoryEntry.*` + `toHistoryEntry` + `HistoryEntryKind`. Zero non-test readers. | simplification + altitude |
| `planner.ts` | Collapsed `PlanCounts` to `{scannedRootPlaylists, alreadyInHistory}`; `formatMovePlan` reads `.length` off the plan arrays. Removes a hand-synced parallel-count drift class. | simplification + efficiency |
| `planner.ts` | Fused ~8 `classified.filter()` passes into one `Record<PlaylistDisposition, …>` bucketing pass. Simplified the `unrelatedHistoryChildren` predicate to `=== 'not-an-archive'` (verified sound). | efficiency + simplification |
| `planner.ts` / `rootlist.ts` | Removed write-only parse fields with no readers: `ParsedPlaylist.timestamp` (+ the `RootlistItemAttributes` type and its validation), `ParsedRootlist.totalLength`, `ParsedFolder.uri`/`OpenFolder.uri`. | simplification |
| `rootlist.ts` | **Lazy redaction** — the full-body redactor no longer runs on the success path where its output is unused; it's a thunk invoked only in failure branches. Body is never pre-sliced, so redaction stays byte-identical. | efficiency |
| `rootlist.ts` | Collapsed `RootlistTransportError`'s 7-field-in/7-field-out copy to a single `details` object + spread. Deduped identical `messageForHttpFailure` arms. Removed the dead `onRetryLog` injection seam. | simplification + altitude |
| `rootlist.ts` / `apply.ts` | Unified one `credentialLiterals(credentials)` helper across the log redactor and the backup gate — with the **safer** threshold (`length > 0`, so short secrets are still redacted; the two sites previously disagreed at `>= 8` vs `> 0`). | reuse |
| `move-archives-to-folder.ts` / `apply.ts` | Reused `src/utils/delay` instead of a local `setTimeout` wrapper. Simplified a redundant credential-narrowing belt. | reuse |

## Explicitly skipped (with reasons)

- **Delete the write path entirely** — contradicts the locked product decision to keep it as reviewable dormant code. Fenced instead.
- **Replace `retryWithBackoff` with a local loop** — the plan mandates reusing `src/utils/retry.ts`, and the reuse reviewer endorsed it. The two mandatory overrides (`shouldRetry`, `onRetry`) stay.
- **Distinct process exit codes / typed `DryRunResult` failure arm** — changes observable behavior; out of scope for a behavior-preserving pass.
- **Split `rootlist-schema.ts`; make `parseRootlistEntryUri` a total function** — good ideas, deferred to keep this pass reviewable.

## Verification (independently re-run, not taken on trust)

| Gate | Result |
|---|---|
| `bun test scripts/spotify-folders` | **109 pass, 0 fail** (was 110; the one removed asserted the deleted `plan.writeMode` constant) |
| `npx tsc --noEmit` (root) | exit **0**, still 61 project files |
| `bunx tsc -p scripts/spotify-folders/tsconfig.json` | exit **0** |
| `bunx prettier --check scripts/spotify-folders` | clean |
| No live module imports `./apply` | confirmed by grep |
| `--apply` (no creds) | refused, **exit 2**, no network |
| unknown flag | refused, **exit 2** |
