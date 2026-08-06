# 2026-08-04 - Archive Playlists to History Folder (read-only tool)

Implementation record for `scripts/spotify-folders/`, plus the Phase 7
documentation and the audit fixes that followed. This is the entry the plan
(`docs/archive-to-history-folder-plan.md`) calls for; the two earlier 2026-08-04
entries cover the plan's shipped-footprint minimization and the Phase 5 test
suite respectively.

## Summary

- New **local-only, read-only** CLI that reads Spotify's private `spclient`
  rootlist, parses the flat folder-marker list into a tree, and prints which
  root-level `YYYY - MonthName` archive playlists *would* move into `History`.
- **Nothing is ever written.** `POST .../rootlist/changes` has never been issued
  against this account, in this work or before it.
- **Nothing is ever deployed.** Top-level `scripts/` is not in `publish.rb`'s
  `PAYLOAD` allowlist, so it is never staged into `build/lambda`.
- `src/` was not modified and no file was added to it. `ArchiveAction` still
  creates archive playlists at library root through the public API — moving a
  playlist changes neither its ID nor its tracks.

## Files

| Path | |
|---|---|
| `scripts/spotify-folders/rootlist.ts` | NEW — HTTP transport, retry disposition, validation, redaction, `WRITE_MODE` |
| `scripts/spotify-folders/planner.ts` | NEW — URI/marker parsing, folder tree, classification, plan, report formatting |
| `scripts/spotify-folders/archive-name.ts` | NEW — self-contained archive-name parser |
| `scripts/spotify-folders/move-archives-to-folder.ts` | NEW — CLI entrypoint, credentials, backup, refused apply path |
| `scripts/spotify-folders/tsconfig.json` | NEW — the tool's own typecheck target |
| `scripts/spotify-folders/__tests__/*.test.ts` | NEW — 3 files |
| `scripts/spotify-folders/__tests__/fixtures/rootlist.sample.json` | NEW — trimmed, redacted capture |
| `docs/rootlist-capture.md` | NEW — redacted wire contract and Phase 0 evidence |
| `docs/playlist-folders-research.md` | ADDED from the main worktree, then corrected and extended |
| `tsconfig.json` | MODIFIED — one line: `"scripts"` appended to `exclude` |

## Writes are disabled by construction, not by convention

Four independent gates, in the order a request would have to pass them:

1. `--apply` returns `apply-rejected` from `parseArgv` and `runCli` exits 2
   **before** reading credentials or building any request.
2. `authorizeWrites()` returns `null` while `WRITE_MODE === 'disabled'`.
3. `convergeMovePlan` refuses even when handed a **forged** `WriteAuthorization`,
   and issues zero fetches doing so.
4. `postRootlistChanges()` throws `RootlistWritesDisabledError` before touching
   the network at all.

Each of these is pinned by a test that asserts on the **fetch call count**, not
merely on the thrown error.

## Invariant 6: strict by default

The plan's invariant 6 says a `History` folder containing anything other than
production archives means *stop and re-plan instead of guessing*. The live
account fails it: 51 of History's 180 children are not production archives (11
Spotify editorial playlists, 40 legacy hand-named archives like `2015 - Sept`
and `2013 - Oct (CMJ)`).

The tool's default is therefore `historyContentPolicy: 'strict'` — it stops,
exactly as the plan demands. Proceeding is an explicit per-run operator decision:

```bash
bun run scripts/spotify-folders/move-archives-to-folder.ts --tolerate-unrelated-history
```

which reports those 51 and never touches them. A **nested folder** inside History
is fatal under *both* policies; that is the part of invariant 6 that actually
protects an append-only plan.

An earlier build had this backwards — it defaulted to tolerating, with
`--strict-history` as the opt-in. That silently relaxed a plan invariant on the
tool's behalf. Harmless in a write-disabled build, materially not harmless the
day writes are enabled.

## Invariant 7: report-only, by explicit user decision

Chronological ordering inside History is **not** enforced. The
desired-sequence comparison, the corrective-reorder planner, and the ordering
tests were not built. The dry run prints current History order labelled "order
informational only"; the plan is "append eligible candidates, order unspecified".

Current live order is stable but *descending* (newest first) and interleaved with
`Your Top Songs 20XX`, so ordering work would be a full reorder, not an append.

## Scope reality

**The entire backfill is one move.** 129 production archives are already in
History; exactly one (`2026 - July`) sits at root. There are zero `[Test] `
archives anywhere and zero duplicate production year/month keys across all 307
rootlist entries. The ongoing case is one move per month.

## What Phase 0 proved (full detail in `docs/rootlist-capture.md`)

- JSON **is** available — the protobuf gate is cleared — but only with
  `Accept: application/json`. Any other `Accept` returns HTTP 200 with a protobuf
  `octet-stream` body. Silent format swap, not an error.
- Minimal working headers are `Authorization` + `Accept`. `client-token` and
  `app-platform` are **not** required for the read.
- `contents.truncated` plus `from`/`length` paging is real; a single unbounded
  GET returning everything is luck, not contract.
- Folder ids are unpadded hex (15 *or* 16 chars); `spotify:start-group:<id>` with
  no name segment is legal; `metaItems` at marker positions are `{}`, so folder
  names live only in the URI.
- An inaccessible playlist has a metaItem with `statusCode` 404/403 and **no**
  `attributes` — assuming `attributes.name` exists will crash or fabricate nulls.
- `GET /v1/me` was **429-blocked on 12 consecutive attempts**; the user id was
  confirmed instead by a successful authenticated rootlist read returning
  `ownerUsername`. Reported as proof-by-read, not as the check the plan wrote.
- **Phase 0D and 0E were not performed.** Batch/atomicity, anchor chaining, and
  stale-revision behavior are all unknown. Anyone enabling writes must run 0D
  first.

## Secrets

- The two credentials (`SPOTIFY_SPCLIENT_TOKEN`, `SPOTIFY_CLIENT_TOKEN`) are
  read from the real environment only. There is deliberately **no `dotenv`
  call** — a `.env` in this worktree is auto-loaded into every future agent
  session in this directory by a `SessionStart` hook, which would turn a
  one-hour secret into a long-lived on-disk one.
- Transport errors redact both tokens from messages and from `toSafeFields()`,
  and a test feeds a response body that echoes them back to prove it.
- `assertBackupIsCredentialFree` throws on contaminated input **without naming
  the matched secret**.
- No token, cookie, or full rootlist capture was written into the repo. The only
  committed capture is the trimmed, redacted test fixture.

## `tsconfig.json`

One line: `"scripts"` appended to `exclude`. The root config has `rootDir:
"./src"` and **no `include` key**, so it matches `**/*` by default — a `.ts` file
under top-level `scripts/` breaks `bun run typecheck` with TS6059 (confirmed
empirically with a throwaway probe). `tsconfig.json` *is* in `publish.rb`'s
`PAYLOAD` and does ship, so this is not a literally zero-footprint edit, but the
added entry is inert at runtime.

## Audit fixes applied on top

1. **Invariant 6 default flipped to strict** (above). `--strict-history` became
   `--tolerate-unrelated-history`; the planner error now carries a `remedy` field
   naming the flag.
2. **Phase 7 docs written** — `docs/rootlist-capture.md` (which `rootlist.ts:14`
   already cited), `docs/playlist-folders-research.md` copied in and corrected,
   and this entry.
3. `unknownEntries` — rootlist URIs that are neither playlist nor marker — are
   now **rendered** in the dry-run report with index and URI, instead of being
   collected on `MovePlan` and never shown.
4. The drift test now pins the tool's parser against **both** exported factories,
   not just `buildArchiveNamer`. Doing so surfaced a real, deliberate divergence:
   `buildArchiveMatcher` uses `\d{4}` and accepts a leading-zero year, while
   `archive-name.ts` uses `[1-9]\d{3}` and rejects it. Unreachable in practice
   (`Date#getFullYear()` cannot produce `0026`), and the tool errs toward *not*
   classifying something as an archive, which is the safe direction. Asserted
   explicitly rather than papered over.
5. The Phase 5 test file was reformatted to satisfy prettier.

## Known gaps, stated plainly

- **`AGENTS.md` was not updated**, though Phase 7 calls for it — this change was
  held to a budget of `scripts/spotify-folders/`, `docs/`, `changelog/`, and one
  `tsconfig.json` line. The intended text is parked verbatim in the appendix of
  `docs/rootlist-capture.md` for a one-paste application.
- **`bun run format:check` fails repo-wide**, and did before this work: 40+
  tracked files under `src/`, `changelog/`, and the repo root are unformatted at
  HEAD. Everything under `scripts/spotify-folders/` passes
  `bunx prettier --check scripts/spotify-folders`.
- **`bun test` reports more files than exist in source.** A stale, gitignored
  `dist/` tree from before the Bun migration still sits on disk and re-runs
  `dist/__tests__/liked-songs-removal-detection.test.js`, double-counting 33
  tests. Deleting `dist/` is safe but was left alone as out of scope.
- The write path (`convergeMovePlan`, `toRootlistOp`) is written and reviewed but
  **unproven**; its index semantics are marked UNPROVEN in the source.
