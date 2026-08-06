# 2026-08-04 - History-Folder Tool: Phase 5 Test Suite

## Summary

- Added `scripts/spotify-folders/__tests__/spotify-folders.test.ts`, the Phase 5
  fixture-driven test file for the (still read-only) archive-to-History-folder
  CLI. It covers what `planner.test.ts` and `archive-name.test.ts` don't:
  transport-level behavior, the CLI's argv/env/formatting helpers, and the
  no-write safety guarantees.
- All new tests run fully offline — `getRootlist` / `postRootlistChanges` are
  always driven through an injected `RootlistFetch`, and `spyOn(globalThis,
  'fetch')` proves the CLI's `--apply`/missing-credentials/`--help` paths never
  touch the real network.

## Coverage added

| Area | What's tested |
|---|---|
| Degenerate rootlists | Entirely empty rootlist (no History folder), and a History folder with zero children |
| Transport happy path | `getRootlist` against the real captured fixture, round-tripped through `planHistoryMoves` |
| 401/403 | Fatal, **never retried** — asserted by exact fetch call count, not just the thrown error kind (the inherited default `shouldRetry` in `src/utils/retry.ts` treats 401 as retryable; the rootlist transport's override is what's under test) |
| Retryable failures | A network error retries and can still succeed; 429 retries and exhausts `maxAttempts` |
| Content rejection | Non-JSON content-type, malformed JSON, invalid shape, and truncated/partial rootlists are all rejected before reaching the planner |
| Secret redaction | A response body that echoes the bearer/client-token back is never present in the thrown error's `message` or `toSafeFields()` output |
| No-write guarantee | `postRootlistChanges()` throws `RootlistWritesDisabledError` with **zero** fetch calls (both via an injected fetch and via a `spyOn` on the real global `fetch`); `convergeMovePlan` refuses even given a forged `WriteAuthorization` |
| CLI | `parseArgv`, `resolveCredentials`, `formatCredentialInstructions`, and `runCli` end-to-end for `--apply` (rejected, no network), `--help`, an unknown flag, and missing credentials |
| `runDryRun` / `formatFailure` | Success, transport failure, and planner failure paths, plus non-Error throwables never getting dumped whole |
| Backup builder | `buildRootlistBackup` output is credential-free by construction; `assertBackupIsCredentialFree` throws on contaminated input without naming the matched secret |
| `toRootlistOp` | Pinned against the fixture's single eligible move (index semantics are still explicitly marked UNPROVEN in `move-archives-to-folder.ts`) |

## Explicitly out of scope (per the user's override of the plan)

- No desired-sequence / corrective-reorder tests — chronological ordering
  inside History is report-only in this build.
- No "healthy N-move sequential apply run" test — the apply loop
  (`convergeMovePlan`) is written but dormant; only its refusal path is tested.

## Verification

- `bunx tsc --noEmit -p scripts/spotify-folders` — clean.
- `bun run typecheck` (root) — still exits 0, unaffected by the new test file.
- `bun test scripts/spotify-folders` — **102 pass, 0 fail** across 3 files
  (`archive-name.test.ts`, `planner.test.ts`, `spotify-folders.test.ts`).
- `bun test` (whole repo) — **193 pass, 0 fail** across 9 files. Consistent
  with the scout's noted baseline of 91 (58 real + 33 duplicated by the stale,
  gitignored `dist/` tree) plus the 102 new tests: nothing pre-existing broke.

## Bug fixed along the way

- The first draft of `recordingFetch()` (a local test helper) incremented its
  call counter *after* awaiting the stubbed implementation, so a stub that
  `throw`s on its first call never advanced the counter and every subsequent
  call replayed the "first call" branch. Fixed by recording the call before
  invoking the implementation. Caught immediately by the network-retry test
  (`retryWithBackoff` looped 3 times instead of the expected 2) before this
  was returned as done.
