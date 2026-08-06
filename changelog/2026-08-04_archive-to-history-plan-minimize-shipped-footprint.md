# 2026-08-04 — Rewrite archive-to-History plan to minimize its footprint in shipped code

Adversarial review of `docs/archive-to-history-folder-plan.md`, followed by a rewrite that reorders the plan around an explicit change budget: code in `scripts/` > new code in `src/` > changes to currently-used code.

No implementation code was written. Only the plan document changed.

## Change budget, before and after

| Tier | Revision 2 | Revision 3 |
|---|---|---|
| Changes to currently-used code | `src/settings.ts` refactor, `package.json` scripts | **`tsconfig.json`, one `exclude` entry, proven inert** |
| New code in `src/` | `src/__tests__/archive-playlist-name.test.ts` | **none** |
| Code in `scripts/spotify-folders/` | 4 files | 7 files |
| Root-level new files | `tsconfig.folders.json` | none — moved into the tool directory |

Still 12 tracked paths, but only one modified file now contains executable configuration.

## Findings that drove the rewrite

**`bun run build` would have broken on the first tool file.** `tsconfig.json` has no `include`, declares `rootDir: "./src"`, and excludes `src/scripts` but not top-level `scripts`. Verified by dropping a probe file into `scripts/spotify-folders/` and running `npx tsc`:

```
error TS6059: File '.../scripts/spotify-folders/__probe.ts' is not under 'rootDir' '.../src'.
  Matched by default include pattern '**/*'
```

Because the Lambda now runs Bun and executes `.ts` directly, Bun strips types without checking them — `npx tsc` is the project's only remaining typecheck gate, which makes this worse than a build annoyance. Added as invariant 13.

The fix is one entry appended to the existing `exclude` array, proven inert by diffing `npx tsc --noEmit --listFiles` before and after: **57 project files, byte-identical**. Top-level `scripts/` holds `publish.rb`, `run.js`, and two `.scpt` files — no TypeScript, and `allowJs` is off, so nothing there was ever in the program.

**The parser no longer touches `src/settings.ts`.** Previous revisions proposed exporting a shared `MONTH_NAMES` and adding `parseArchivePlaylistName()` to the production module. The tool now owns private copies of the month list and the `[Test] ` prefix, with drift caught by a test rather than prevented by a shared export.

Verified that a test under `scripts/` can reach the real production builder with zero changes to `src/`. `settings()` reads `dev.isDev` at call time, so one file can exercise both branches:

```
PROD: "2026 - July"   TEST: "[Test] 2026 - July"
1 pass, 0 fail
```

`src/-run-this-first.ts` only assigns globals and conditionally loads X-Ray, so importing it locally is side-effect-free.

**Corrected the plan's own correction.** The research doc claims `isArchivePlaylistName()` exists in `src/settings.ts`; it does not. But the prior revision overstated the replacement — `archivePlaylistNameFor` is an *unexported inner function* returned by the `buildMyFn` closure factory (`src/settings.ts:16-17`), reachable only as `(await settings()).archivePlaylistNameFor`.

**Sequential convergence could have aborted mid-backfill.** The loop bound read "stop after a small bounded number of non-converging attempts (for example, 5)" while the sample plan moves 19 playlists. Split into two counters: `consecutiveNoProgress` (5, resets on progress) as the stall detector, and `totalIterations` (`3 × plannedMoves + 10`) as a runaway backstop.

**Ordering was the most complex requirement and the least validated.** The Spotify sidebar sorts by a user-selected mode and rootlist order only surfaces under Custom Order, so invariant 7 may be unobservable. Made it explicitly conditional on a new minutes-long check in Phase 0A; if it fails, the desired-sequence machinery is cut from Phases 3–5 for roughly 1.5–2 hours saved.

**Duplicate archives were underrated at Medium.** `AGENTS.md` records a 2025-01-06 *"Fix Duplicate Archive Playlist Creation"*, and `optionalPlaylist` (`src/spotify.ts:363`) resolves names with `.find()` — first match wins, so production silently tolerates duplicates that this tool hard-fails on. Moved the check to Phase 0A as a plain `/me/playlists` read requiring no captured tokens, and raised it to High.

**`retryWithBackoff` defaults are hostile to two invariants.** The default `shouldRetry` returns `true` on `statusCode === 401` (`src/utils/retry.ts:24-27`), inverting invariant 10. The default `onRetry` logs `error.message || error` (`src/utils/retry.ts:51-56`), dumping whole error objects when `message` is falsy, against invariant 11. Both overrides are now mandatory rather than implied.

**Invariant 12 was verified in advance, removing a Phase 4 contingency.** Ran the exact `zip` expression from `scripts/publish.rb` against a mock tree: `-x"scripts/*"` excludes nested paths because Info-ZIP's `*` matches `/`, `-x"*.md"` excludes the capture doc, `-x"*.env"` excludes `.env`. `scripts/publish.rb` needs no change.

**Secrets should not go in `.env`.** This worktree has none, and a `SessionStart` hook auto-loads `.env` into the environment, making a pasted bearer visible to later agent sessions. Switched to ephemeral shell exports for the two secrets; `SPOTIFY_USER_ID` is not a credential.

**The rollback section contradicted the design, in the plan's favor.** A convergent, idempotent reconciler recovers from a partial apply by being re-run, not by manual restoration in the Spotify client. Manual restore is now scoped to the only case that needs it: when the desired state itself is wrong.

## Other adjustments

- Dropped the `package.json` script aliases; the tool is invoked by full path.
- Moved `tsconfig.folders.json` to `scripts/spotify-folders/tsconfig.json`, inside the ZIP-excluded directory.
- Noted that bare `bun test` already discovers `dist/__tests__/*.test.js`, so one source test currently reports as "66 tests across 2 files" — pre-existing, but expect doubled counts.
- Added `npx tsc --noEmit --listFiles | grep -v node_modules | wc -l` (must stay 57) as a fourth verification command.
- Effort re-estimated 8–12 → 9.5–12.5 hours, with the ordering check as an explicit subtract.
