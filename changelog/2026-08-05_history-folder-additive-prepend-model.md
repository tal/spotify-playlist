# 2026-08-05 — History-folder tool: additive prepend model

Behavior change to the local, read-only `scripts/spotify-folders/` tool. The
account owner clarified that the `History` folder legitimately holds non-archive
playlists (Spotify "Your Top Songs 20XX", "Your Summer Rewind") and legacy
archives with non-standard names ("2016 - Feb/Mar", "2015 - CMJ",
"2013 - July/Aug"). Those are intentional and arrive only by manual drag, so the
tool must stop policing History's contents and become **purely additive**.

Writes stay **hard-disabled** — `WRITE_MODE = 'disabled'`, no live module imports
`./apply`, the CLI still refuses `--apply` with a non-zero exit, and the
`rootlist/changes` wire format remains an UNPROVEN hypothesis.

## What changed

| Area | Before | After |
|---|---|---|
| Unrelated content in History | Hard failure by default; opt out with `--tolerate-unrelated-history` | **Tolerated by default.** Reported, left untouched, never blocks the plan |
| Nested folder in History | Hard failure under every policy (`assertNoNestedFolderInHistory`) | **Tolerated.** The tool no longer validates History's contents at all |
| History validation kept | Full content validation | **Only** "exactly one root-level `History` folder exists" (zero/multiple still fatal) |
| New archive placement | Appended at History's end, order report-only | **Prepended at History's front, newest first** (reverse-chronological) |
| Existing History order | Report-only comparison machinery | Never compared, reordered, or removed — purely additive |
| Duplicate year/month | Hard failure (`duplicate-archive-key`) | **Reported skip**, non-fatal (relaxed invariant 8) |

## Duplicate handling (safe, non-fatal)

- A root archive whose `(year, month)` already exists in History → reported as
  **already-filed** and left at root (no second copy).
- Two root archives sharing a `(year, month)` → **both** reported as **ambiguous**
  and skipped (the tool never guesses which to file).

## Code

- **`planner.ts`**
  - Removed `HistoryContentPolicy` type, the `historyContentPolicy` option,
    `assertNoNestedFolderInHistory`, `assertNoDuplicateArchiveKeys`, and the three
    now-dead `PlannerFailureKind`s (`history-contains-nested-folder`,
    `history-contains-unrelated-playlist`, `duplicate-archive-key`).
  - Re-added `PlannedMove.year` / `.month` (needed to sort the prepend batch);
    did **not** revive the desired-sequence-comparison machinery.
  - New `SkippedRootArchive` type + `skippedAlreadyFiled` / `skippedAmbiguous` on
    `MovePlan`. New `partitionCandidates`, `byReverseChronology`, `toSkipped`,
    `archiveKey` helpers.
  - `moves` are now defined in FINAL top-to-bottom order (newest first).
  - `formatMovePlan` rewritten: "Would prepend into History (N), newest first:",
    skip sections, an explicit "existing History contents are never reordered or
    removed" line, and the empty-plan case says nothing would change.
- **`move-archives-to-folder.ts`** — dropped the `--tolerate-unrelated-history`
  flag, the `HistoryContentPolicy` import, and the policy field on the `run`
  parse; `parseArgv` now has no behavior flags. Usage text updated.
- **`apply.ts`** (dormant) — `toRootlistOp` now targets `historyFolder.startIndex
  + 1` (prepend at front) instead of `endIndex` (append); the convergence loop
  sends the oldest remaining move so a repeated front-prepend ends newest-on-top.
  Still UNPROVEN; still unreachable. No change to the no-write gate or redaction.

## Tests

`bun test scripts/spotify-folders` → **106 pass / 0 fail**. Updated the policy
tests to the default-tolerate behavior and removed the `--tolerate-unrelated-history`
flag test. Added coverage for:

- unrelated History content tolerated by default and kept out of the move plan
- nested folder in History tolerated (its contents left untouched)
- eligible root archives planned newest-first (reverse-chron prepend order)
- existing History entries never in the move plan; their relative order unchanged
- a root archive already filed in History → skipped + reported (not moved)
- two root archives sharing a `(year, month)` → both skipped + reported

Every no-write / redaction / marker-parser test was kept. The load-bearing
no-write test still passes: `postRootlistChanges` throws
`RootlistWritesDisabledError` without issuing any `fetch`.

## Docs

- `docs/archive-to-history-folder-plan.md` — added "Revision 5 — additive prepend
  model" near the top (invariant 6 reversed, 7 replaced, 8 relaxed).
- `docs/rootlist-capture.md` and `AGENTS.md` — removed the
  `--tolerate-unrelated-history` invocation.
