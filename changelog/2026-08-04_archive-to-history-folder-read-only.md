# 2026-08-04 — Archive-to-History folder tool (read-only)

Phase 7 (documentation) of `docs/archive-to-history-folder-plan.md`. This entry
is the plan's own changelog deliverable; it complements — does not replace —
the two other 2026-08-04 entries already in this folder:
`2026-08-04_archive-to-history-plan-minimize-shipped-footprint.md` (the plan
rewrite) and `2026-08-04_history-folder-tool-phase5-tests.md` (the Phase 5 test
suite). This entry covers the tool as a whole and the live dry run against the
real account.

## What was built

A local-only CLI, `scripts/spotify-folders/`, that reads Spotify's private
`spclient` rootlist API and reports which root-level `YYYY - MonthName` archive
playlists would move into a `History` folder. It never leaves this Mac and
never enters the Lambda package.

| File | Role |
|---|---|
| `scripts/spotify-folders/archive-name.ts` | Self-contained archive-name parser, pinned by a round-trip test against `src/settings.ts`'s real `buildArchiveNamer`/`buildArchiveMatcher` |
| `scripts/spotify-folders/rootlist.ts` | HTTP transport, retry disposition, response validation, secret redaction, the `WRITE_MODE` gate |
| `scripts/spotify-folders/planner.ts` | Marker-tree parser, folder classification, desired-state planner, report formatting |
| `scripts/spotify-folders/move-archives-to-folder.ts` | CLI entrypoint: argv parsing, credential handling, dry run, the (dormant) apply loop |
| `scripts/spotify-folders/tsconfig.json` | The tool's own typecheck target (root `tsconfig.json` excludes `scripts` from its program) |
| `scripts/spotify-folders/__tests__/*.test.ts` (3 files) | `archive-name.test.ts`, `planner.test.ts`, `spotify-folders.test.ts` — 102 tests |
| `scripts/spotify-folders/__tests__/fixtures/rootlist.sample.json` | Trimmed, redacted capture used by the fixture-driven tests |
| `docs/rootlist-capture.md` | Redacted Phase 0 wire-contract evidence (already existed before this entry — see below) |
| `docs/playlist-folders-research.md` | Copied in from the main worktree and corrected (already existed before this entry — see below) |
| `tsconfig.json` | MODIFIED — one line: `"scripts"` appended to `exclude` |

**Change budget held:** one modified line in currently-shipped configuration
(`tsconfig.json`, proven inert — see Regression gates below), zero new files
in `src/`, everything else inside `scripts/spotify-folders/` or `docs/`.

## This pass is read-only by construction

Not by convention, by construction — four independent gates, in the order a
write would have to clear them:

1. `--apply` is rejected by `parseArgv`/`runCli` before credentials are read or
   any network call is made. Exit code 2.
2. `authorizeWrites()` returns `null` while `rootlist.ts`'s `WRITE_MODE` constant
   reads `'disabled'`.
3. `convergeMovePlan` (the apply loop) refuses even when handed a **forged**
   `WriteAuthorization` object, and does so with zero fetch calls.
4. `postRootlistChanges()` throws `RootlistWritesDisabledError` as its first
   statement — before building a URL, headers, or a body.

Each gate is pinned by a test asserting on the actual fetch call count, not
merely on the thrown error type. `POST .../rootlist/changes` has never been
issued against this account — not in this session, not before it.

## The proven wire contract, in brief

Full detail, all of it redacted, lives in `docs/rootlist-capture.md`. Headline
findings:

| Question | Answer |
|---|---|
| Can a non-browser client read the rootlist? | **Yes.** `GET spclient.wg.spotify.com/playlist/v2/user/<id>/rootlist` returns clean JSON |
| What headers are actually required? | Just `Authorization: Bearer <token>` and `Accept: application/json`. Wrong/missing `Accept` silently returns protobuf with HTTP 200 — not an error, a format swap |
| Is `client-token` required? | No, for the GET. Sent anyway because it's cheap and the write path would likely want it |
| Is truncation handled? | Yes — `contents.truncated` plus `from`/`length` paging is proven; the tool rejects a truncated snapshot rather than planning against a partial library |
| Is the write (`POST .../rootlist/changes`) path proven? | **No.** Never attempted. Phase 0D (the reversible one-item/two-item POST test) was not run. Batching semantics, chained-anchor behavior, and stale-revision response shape are all unknown |
| How was the token minted? | The documented cookie-only GET is dead (Spotify added TOTP anti-bot params). A working mint was derived from the shipped web-player bundle — version-pinned, best-effort, fully documented in §2b of the capture doc. Manual DevTools paste (§2a) is the supported ritual |

## What the live dry run found about the account

| Metric | Value |
|---|---|
| `History` folder | Exactly one, root level, flat (zero nested folders) |
| Direct children of `History` | 180 |
| Of those, production `YYYY - MonthName` archives | 129 |
| Of those, **not** production archives | 51 (11 Spotify editorial `Your Top Songs 20XX` playlists, 40 legacy hand-named archives like `2015 - Sept`, `2013 - Oct (CMJ)`) |
| Eligible root-level production archives | **1** — `2026 - July` |
| `[Test] ` archives anywhere | 0 |
| Duplicate production year/month keys | 0 across all 307 rootlist entries |

Two consequences worth being explicit about:

- **Plan invariant 6 fails on the live account.** The plan says a `History`
  folder containing anything besides production archives means *stop and
  re-plan*. This one does. The tool's default (`historyContentPolicy: 'strict'`)
  does exactly that — it throws `history-contains-unrelated-playlist` and
  refuses to plan. Proceeding anyway is an explicit per-run opt-in via
  `--tolerate-unrelated-history`, which reports the 51 non-archives and leaves
  them untouched. A nested folder inside `History` remains fatal under either
  policy.
- **The backfill is one move, not nineteen.** The plan's illustrative dry-run
  sketch assumed ~19 eligible root archives; the real account has 129 already
  filed and exactly 1 left at root. The ongoing steady-state case going forward
  is one move per month.

## The two user overrides, applied

| Plan invariant | Override | What was (not) built |
|---|---|---|
| 7 — chronological order inside `History` | **Report-only.** No desired-sequence comparison, no corrective-reorder planner, no ordering tests | The dry run prints current `History` order labelled "order informational only." Wire order is real, stable, and reproducible (byte-identical across two GETs) — but it runs *descending* and is interleaved with `Your Top Songs 20XX`, so honoring it would be a full reorder, not an append |
| — | **`--apply` hard-disabled**, not anticipated by the plan | Covered above — four independent gates, all dormant |

## Deviations from the plan the run forced

- **0A-4 (duplicate check via the public API) could not run as written.**
  `GET /v1/me` and `GET /me/playlists` both returned HTTP 429 on every attempt
  across several minutes. The duplicate scan was computed from the private
  rootlist capture instead — a superset of the sidebar library, arguably a
  stronger source, but not the check the plan specified. Reported as such in
  `docs/rootlist-capture.md` §10.
- **0A-3 (sidebar ordering observability) was not tested.** It requires the
  desktop/web UI, not a terminal. Moot under the invariant-7 override.
- **Phase 5's file map listed two new test files; the tool shipped three**
  (`archive-name.test.ts`, `planner.test.ts`, `spotify-folders.test.ts`). The
  extra file separates pure-planner fixture tests from transport/CLI tests;
  no functionality is untested, the split is just finer-grained than planned.

## What remains before a real apply is possible

None of this was done, and doing it was explicitly out of scope for this pass:

1. **Phase 0D** — a real, reversible one-item move and two-item move through
   `POST .../rootlist/changes`, executed from the terminal against test
   playlists, with restoration verified by a follow-up GET.
2. **Phase 0E** — choosing an apply strategy (proven batch vs. sequential
   convergence) based on what 0D shows.
3. Wiring `convergeMovePlan` to something real — today it is complete,
   reviewable code that no code path can reach.
4. Flipping `WRITE_MODE` in `rootlist.ts` from `'disabled'` to `'enabled'`,
   and re-reviewing `move-archives-to-folder.ts`'s dispatch logic at the same
   time — the plan (and the tool's own comments) are explicit that this is not
   a one-flag change.

## Regression gates, verified this session

| Check | Result |
|---|---|
| `bun run typecheck` (root) | exit 0 |
| `bunx tsc --noEmit -p scripts/spotify-folders/tsconfig.json` | exit 0 |
| `npx tsc --noEmit --listFiles \| grep -v node_modules \| wc -l` | **61** — identical to the scouted pre-change baseline; the `tsconfig.json` edit compiles zero additional files |
| `bun test` (whole repo) | 193 pass, 0 fail, 9 files |
| `bun test scripts/spotify-folders` | 102 pass, 0 fail, 3 files |
| `bunx prettier --check scripts/spotify-folders` | clean |
| `git diff tsconfig.json` | exactly one line added (`"scripts"` in `exclude`) |
| Secret-leak scan (full/partial token values, across all captured stdout/stderr and `grep -r` over the repo) | clean |
| `--apply` under a runtime `fetch` audit | 0 requests issued |
| dry run under the same audit | 1 GET, to `spclient.wg.spotify.com/playlist/v2/user/koalemos/rootlist`, 0 non-GET requests |
| Independent `curl` re-GET after the whole session, diffed against the pre-session capture | rootlist `revision` unchanged, all 307 entry URIs identical in order |

## Files this entry's session actually wrote

Everything else listed above (`docs/rootlist-capture.md`,
`docs/playlist-folders-research.md`, the tool source, its tests, the two other
2026-08-04 changelog entries) already existed on disk before this Phase 7 pass
started — this session found them already written by earlier work in the same
branch and verified rather than recreated them. What this session added:

- This file.
- `AGENTS.md` — the local-only-tool section (see below).
- The "Post-implementation corrections" section appended to
  `docs/archive-to-history-folder-plan.md`.

### `AGENTS.md`

Added a `Local-only tool: scripts/spotify-folders/` subsection with the
invocation commands, the three environment values (which two are short-lived
secrets and why they belong in an ephemeral shell rather than `.env`), the
unsupported/local-only warning, the current disabled-write state and what
flipping it would require, and a note on why `tsconfig.json`'s `exclude` now
covers `scripts`. The content was drafted in advance in
`docs/rootlist-capture.md`'s "Appendix — text for AGENTS.md" (that file
explicitly said `AGENTS.md` had not yet been touched); this session applied it
verbatim rather than duplicating a second edition of the same text, and
removed the appendix's "not yet applied" caveat now that it has been.

### `docs/playlist-folders-research.md`

Not copied by this session — it was already present, and already carried a
2026-08-04 correction block at the top fixing the exact stale claim the task
flagged (the nonexistent `isArchivePlaylistName()` reference, replaced with
the real `buildArchiveNamer`/`buildArchiveMatcher` split). No further action
was needed or taken.

## Honesty notes

- This session ran no new Spotify requests beyond the one dry-run GET and one
  independent verification GET, both read-only, both against the already-tested
  transport. No token was minted fresh; the existing scratchpad credentials
  were reused.
- The plan's Phase 6 ("execute and verify on the real account", including
  running `--apply`) was **not** performed and cannot be, since writes are
  hard-disabled by design in this build.
- Nothing was committed and nothing was pushed.
