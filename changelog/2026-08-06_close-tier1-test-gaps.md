# Close Tier 1 Test-Coverage Gaps

Follow-up to `2026-08-04_action-testability-and-bugfixes.md`. That wave gave every
action a pure `xPlan(snapshot)` and a mock-free `*-plan.test.ts` (baseline: **210
tests / 13 files**). A two-agent coverage audit then read that suite against the
production code it claims to pin, split by area, and ranked what it found by how
quietly a regression would ship: **Tier 1** = a plausible one-line change that the
green mock-free suite would not catch. This wave closes every Tier 1 gap the audit
raised, with production changes limited to exports, one assigned extraction, and
one dead-import removal — no behavior changes.

## Coverage-audit context

- The audit worked area by area rather than file by file: one pass covered the
  `action-runner`/`undo`/`archive` sequencing surface, the other covered the
  smaller pure helpers (`rule-playlist`, `actionable-type`, `action-for-playlist`,
  the `index.ts` handler, and the Discover Weekly / Release Radar name filters).
- Two audit findings turned out not to hold up under implementation:
  - `noRemixes`/`noLive`/`onlyOriginals` were flagged as under-tested filters; they
    are, but they also have **zero production callers** — `git show HEAD:src/actions/scan-playlists-for-inbox.ts`
    confirms this predates this wave (Release Radar lost its `onlyOriginals` argument
    in `f9d6303`). The new tests pin functions nothing currently calls; the coverage
    is real but notional until something rewires a filter in.
  - The audit's dead-code premise for `undoneMembership` did not pan out —
    `grep -rn undoneMembership src/` returns nothing. There was nothing to delete.
- Everything else in Tier 1 held up and is closed below.

## Tier 1 gaps closed

| Gap                                                                     | What was unpinned                                                                                                                                                      | Test file                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `undoDirectionFor` promote/demote could swap silently                   | No table-driven check over every `ActionTypes` member                                                                                                                  | `undo-plan.test.ts`           |
| `archivePeriod` assumed process TZ = UTC                                | Local-vs-UTC accessor swap invisible unless the zone is behind UTC                                                                                                     | `archive-id.test.ts`          |
| `ArchiveAction.getID()` stability                                       | A regression back to `archive:${created_at}` had nothing pinning the stable `archive:<YYYY-MM>` form                                                                   | `archive-id.test.ts`          |
| `forStorage`'s `ttl`                                                    | Seconds-vs-milliseconds mixup, and the empty-mutations expiry branch, both untested                                                                                    | `archive-id.test.ts`          |
| `idsIn` id-less-entry admission                                         | Nothing stopped a `{ id: undefined }` row from being read as a real member                                                                                             | `archive-plan.test.ts`        |
| `buildArchiveNamer` (`src/settings.ts`) month bucketing                 | Local-vs-UTC swap at month/year edges (midnight UTC, New Year UTC)                                                                                                     | `archive-plan.test.ts`        |
| `performActions` sequencing                                             | Nothing proved mutation _sets_ run sequentially rather than as `Promise.all` — the one item the action-runner audit pass flagged as structurally argued but unverified | `action-runner.test.ts`       |
| `MarkActionUndoneMutation.mutate`                                       | Nothing proved it actually calls `dynamo.markActionAsUndone` with the row's real key                                                                                   | `action-runner.test.ts`       |
| `ProcessManualTriage` backfill vs. a missing `triage_actions` attribute | A row with the attribute entirely absent was silently read as "already triaged" (both the inbox-half and current-half backfills)                                       | `manual-triage-plan.test.ts`  |
| `isCurrentlyPlayingInTriage`                                            | No test on Current-membership matching, and the `currently_playing_type` guard was unpinned                                                                            | `actionable-type.test.ts`     |
| `actionForPlaylist` routing regex                                       | `/\[A\]$/` (trailing) vs `/\[A\]/` (anywhere) was untested — the non-trailing case                                                                                     | `action-for-playlist.test.ts` |
| `getRandomSlice` candidate window                                       | Off-by-one on the window size offered to `pick`                                                                                                                        | `rule-playlist-pick.test.ts`  |
| `rulePlaylistPlan` set boundary                                         | The empty-then-fill split could collapse into one set without anything failing                                                                                         | `rule-playlist-pick.test.ts`  |
| `noRemixes` / `noLive` case sensitivity                                 | Casing could be dropped from the `RegExp` with nothing to catch it                                                                                                     | `inbox-track-filters.test.ts` |
| `normalizeActionError`'s 400 ladder                                     | `'no track'` could drop out of the business-error substring list without a 500-vs-400 test failing                                                                     | `handler-routing.test.ts`     |
| `actionNameFromEvent` source precedence                                 | Path-parameter vs. query-parameter precedence was unpinned                                                                                                             | `handler-routing.test.ts`     |
| `trackToData` projection                                                | No planner test builds `BasicTrackData` through the real function — every other test hand-builds it                                                                    | `track-data.test.ts`          |

Six brand-new files came out of this (`action-for-playlist`, `actionable-type`,
`archive-id`, `handler-routing`, `inbox-track-filters`, `track-data`); the rest
extend files the prior wave created (`action-runner`, `archive-plan`,
`manual-triage-plan`, `rule-playlist-pick`) with the specific case each gap needed.

## Sanctioned production changes

Every change below is either an `export` keyword on an existing pure function, the
one extraction explicitly assigned, or a dead-import deletion — no logic changed.

| File                                      | Change                                                                                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/actions/actionable-type.ts`          | `export` added to `isCurrentlyPlayingInTriage`                                                                                                                                                                                   |
| `src/actions/scan-playlists-for-inbox.ts` | `export` added to `noRemixes`, `noLive`, `onlyOriginals`                                                                                                                                                                         |
| `src/actions/undo-action.ts`              | `export` added to `undoDirectionFor`                                                                                                                                                                                             |
| `src/actions/archive-action.ts`           | `export` added to `idsIn` and `archivePeriod`                                                                                                                                                                                    |
| `src/actions/rule-playlist.ts`            | **Assigned extraction:** `perform()` split into a new exported `rulePlaylistPlan(snapshot)` pure planner; `getRandomSlice` exported and given an injected `pick` parameter alongside the existing `pick` on `RulePlaylistAction` |
| `src/index.ts`                            | Error-mapping ladder extracted into an exported `normalizeActionError()`; `afterCurrentTrack`, `doAfterCurrentTrack`, and `actionNameFromEvent` all gained `export`                                                              |
| `src/mutations/remove-track-mutation.ts`  | Deleted an unused `trackToData` import                                                                                                                                                                                           |

`undoneMembership` was not deleted — it does not exist anywhere in `src/`, confirming
the audit's dead-code finding was already moot.

## New test totals

|                  | Before this wave | After this wave |
| ---------------- | ---------------- | --------------- |
| Test files       | 13               | **19** (+6)     |
| Tests            | 210              | **351** (+141)  |
| `expect()` calls | —                | 608             |
| Failures         | 0                | **0**           |
| `tsc --noEmit`   | clean            | clean           |

`rm -rf dist && bun test` — 351 pass / 0 fail / 608 expect() calls / 19 files. No
`dist/` directory left behind.

## Timezone determinism

The full suite (351/0) was run clean under four zones, not just the two required:

- `TZ=UTC`
- `TZ=Pacific/Auckland` — the zone `archive-id`/`archive-plan` are pinned against
- `TZ=Asia/Kolkata` — half-hour offset, extra confidence
- `TZ=America/New_York` — extra confidence

No flakes across any zone. The `process.env.TZ` pin in the archive test files
(`archive-id.test.ts`, `archive-plan.test.ts`) restores the ambient zone in
`afterAll`, and that restore does not leak into other files sharing the process —
confirmed by running the full suite, not just the pinned files, in each zone.

## Verification

Confirmed by mutation testing, not by reading: 19 hand-applied regressions (one per
row above, restored after each run) were applied to production and re-run against
only the owning test file — 19 caught, 0 escaped, 0 anchor misses. Full method and
per-mutation results are in the verify report from this wave; not reproduced here.

## Report files written

- `changelog/2026-08-06_close-tier1-test-gaps.md` (this file)
- `AGENTS.md` — matching summary added to the top of the Changelog section
