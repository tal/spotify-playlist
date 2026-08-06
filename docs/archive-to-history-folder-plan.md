# Plan: Move Archive Playlists into the "History" Folder

**Date:** 2026-08-02
**Last revised:** 2026-08-04 (revision 4 — reconciled against the completed Bun migration)
**Branch:** `move-to-folder`
**Status:** Revised plan — ready for Phase 0, no implementation code written
**Depends on:** `playlist-folders-research.md`, currently untracked in the main worktree at `/Users/tal/Projects/spotify-playlist/docs/`. Copy it into this branch before updating it; do not edit the other worktree in place.

---

## Revision 6 — writes enabled, protocol transcribed (2026-08-06)

The `rootlist/changes` write protocol, left **unproven** through revisions 1–5,
was **transcribed from two real DevTools captures** (a plain in-folder drag and a
drag onto a folder). Key facts, now evidence rather than assumption:

- **URI-anchored `MOV`.** The body is `{deltas:[{ops:[{kind:'MOV', mov:{items,
  addAfterItem}}], info:{source:{client:'WEBPLAYER'}}}]}`, `attributes` empty
  `{}` on both the moved item and the anchor.
- **Id-only start-group anchor.** Prepending to a folder anchors to
  `spotify:start-group:<folderId>` with the `:<name>` suffix **stripped** — the
  GET renders the same marker *with* the name, so reusing the GET's URI verbatim
  would be the wrong anchor.
- **No `baseRevision`.** Concurrency is handled by the convergence loop
  re-reading live state after every write (one `MOV` per POST, oldest first).

Consequences for this plan:

- `WRITE_MODE` is now `'enabled'` and **`--apply` performs writes**. The default
  is still a dry run, and there is **no confirmation prompt** — `--apply` applies
  the plan it prints.
- Safety is as the plan specified: a credential-free backup before the first
  POST, per-iteration re-read (no blind replay), 401/403 fatal, and the two
  loop bounds. Recovery is re-running the command.
- Still honest: verified only in dry-run; the first real `--apply` is the first
  live write. Full redacted protocol in `docs/rootlist-capture.md §9`; details in
  `changelog/2026-08-06_history-folder-enable-apply.md`.

---

## Revision 5 — additive prepend model (2026-08-05)

The account owner clarified that History legitimately holds non-archive playlists
(Spotify "Your Top Songs 20XX", "Your Summer Rewind") and legacy archives with
non-standard names ("2016 - Feb/Mar", "2015 - CMJ"). Those are intentional and
arrive only by manual drag. The tool is now **purely additive**: it prepends
eligible root archives into History and never touches anything already there.
Three invariants change accordingly (the rest stand):

| Invariant | Before | Now |
|---|---|---|
| **6** — History content | Must contain only production archives; unrelated content is a hard failure (opt out with `--tolerate-unrelated-history`). | **Reversed.** Unrelated content in History is expected and tolerated **by default**. The flag, the `HistoryContentPolicy` type, and the `historyContentPolicy` option are removed, along with the nested-folder-in-History hard failure. The tool no longer validates History's contents at all — it only still requires exactly one root-level `History` folder to exist (zero/multiple remains fatal). |
| **7** — ordering | Union of filed + eligible archives in ascending order; a full corrective reorder (already downgraded to report-only). | **Replaced.** No reorder of any kind. New archives are **prepended** to History's front in **reverse-chronological** order (newest on top); everything already in History keeps its exact position below and is never moved or removed. |
| **8** — duplicates | Duplicate production year/month is a hard failure. | **Relaxed to reported skip.** A root archive whose (year, month) is already in History is reported as already-filed and left at root. Two root archives sharing a (year, month) are both reported as ambiguous and skipped. Neither crashes the tool. |

The write path stays hard-disabled (`WRITE_MODE = 'disabled'`); the dormant apply
loop's intent is now "insert at History's front" rather than "append at its end",
but the `rootlist/changes` wire format remains **unproven** and untested.

---

## Revision 4 — what the Bun migration invalidated

Revisions 1–3 were written against the repo as it stood *before* commit `40387ec`
("Move Lambda off managed Node runtime onto Bun custom-runtime layer") landed. Six
load-bearing factual claims were stale. All six are corrected in place below; this
section exists so a reader who remembers the old text knows what moved.

| Claim in revisions 1–3 | Verified reality, 2026-08-04 | Consequence |
|---|---|---|
| `archivePlaylistNameFor` is an unexported inner function of a closure factory `buildMyFn`; **"there is no matcher anywhere in the repo"** | `buildArchiveNamer` (`src/settings.ts:18`) **and** `buildArchiveMatcher` (`src/settings.ts:48`) are both top-level exports. `buildMyFn` does not exist. | The *rationale* for duplicating the parser into the tool is void. The decision survives on different grounds — see "Corrections to the research doc". |
| `bun run build` is the project's only typecheck gate | There is **no `build` script**. `bun run typecheck` (= `bunx tsc --noEmit`) is the gate. | Invariant 13 as written was unsatisfiable. |
| `npx tsc` compiles **57** project files | **61**. `npx tsc --noEmit` currently exits 0 on this branch. | Every "must still be 57" acceptance check would have failed a correct implementation. |
| `publish.rb` excludes the tool via `-x "scripts/*"`, and Info-ZIP's `*` matches `/` | No such expression exists. The only excludes are `-x "*.DS_Store" -x "**/.env"`, run from inside `build/lambda`. Exclusion is an **allowlist**: `PAYLOAD = ['src', 'package.json', 'bun.lock', 'tsconfig.json']` (`scripts/publish.rb:36`). | Conclusion (invariant 12) still holds and is now *stronger*, but the stated proof was invalid and the Phase 4 procedure had to be rewritten. |
| Top-level `scripts/` holds `publish.rb`, `run.js`, `get_track.scpt`, `next_track.scpt` | It holds **`publish.rb` only**. | The `allowJs`-is-off sub-argument is moot. The conclusion it supported still holds. |
| `bun test` reports "66 tests across 2 files" because of `dist/__tests__` | It reports **91 across 6**. The honest source baseline is **58 across 5**; a stale, gitignored, pre-migration `dist/` tree re-runs 33 of them. | Any before/after test-count assertion must use 58/5. Deleting `dist/` is safe and recommended. |

Two further Bun-era facts that change instructions rather than claims:

- **`dotenv` is gone.** Direct dependencies dropped from 22 to 8; the runtime three are
  `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `spotify-web-api-node`. Bun loads
  `.env` natively, so the entrypoint must **not** call `dotenv.config()` — there is nothing
  to import.
- **X-Ray is gone from `src/-run-this-first.ts`.** It is now 21 lines of pure `globalThis`
  assignment reading `process.env`. Importing it is side-effect-safe for a stronger reason
  than revision 3 gave.

### Safety hazard discovered while verifying the above

`src/test.ts` calls `main()` **at module scope** (`src/test.ts:45`), and that `main()` runs
a real `SkipToNextTrack` + `DemoteAction` against the live Spotify account
(`src/test.ts:19-22`). It escapes `bun test` today only because its filename lacks a
`.test.` infix. Nothing in this plan may glob it into a runner, and no phase may
`bun run src/test.ts`. This matters disproportionately for a tool whose entire premise is
"touch nothing".

---

## Decisions locked in

| Question | Answer |
|---|---|
| Where it runs | **Local CLI one-shot** on the Mac. The private-API tool lives under top-level `scripts/`, which the Lambda package excludes. |
| Auth | **Manual DevTools paste** — web-player bearer, `client-token`, and the stable user ID from the captured rootlist URL. No stored Spotify password or browser automation. |
| Scope | **Backfill + ongoing** — reconcile root-level production archive playlists into one existing, root-level `History` folder. |
| Safety | **Dry run by default.** Applying requires `--apply`, writes a local pre-apply snapshot, and verifies live state afterward. |
| Unsupported protocol | Phase 0 must prove the exact request contract from the terminal before implementation continues. No payload or batching shape is assumed in advance. |
| Language | **TypeScript only.** The Lambda now runs Bun and executes `.ts` directly; the project has no hand-written JavaScript and will not gain any here. |

This is the research doc's Option D, narrowed to the cheap part: no headless Chromium, no stored account password, and no private-API code in the Lambda package. "Ongoing" is the same command run again; no daemon or scheduled production work is added.

The reconciler is intended to be **convergent and idempotent**:

- It computes a desired rootlist state from a fresh read.
- It applies only the moves needed to reach that state.
- After every successful or uncertain write, it reads live state again.
- A second dry run must report no moves **and** confirm the complete target ordering, not merely that no archives remain at root.

---

## Change budget

This feature is optional, unsupported, and local-only. Its blast radius into shipped code must be proportional to that. Ranked preference, cheapest first:

1. **Code inside `scripts/spotify-folders/`** — preferred. Excluded from the Lambda package, excluded from the production program, cannot affect the deployed function.
2. **New code in `src/`** — avoid. It ships, it compiles, it becomes maintenance surface for a tool Spotify may break at any time.
3. **Changes to currently-used code** — last resort, and only when provably inert.

**Resulting budget:**

| Tier | Count | Detail |
|---|---|---|
| Changes to currently-used code | **1 file, 1 line** | `tsconfig.json` — one entry appended to the existing `exclude` array. Proven to change zero compiled files (below). Note it is not a *zero-footprint* edit: `tsconfig.json` is in `publish.rb`'s `PAYLOAD`, so the modified file does ship to Lambda. It is inert there — Bun never reads it. |
| New code in `src/` | **0** | The archive-name parser lives in the tool, not the app. |
| Code in `scripts/spotify-folders/` | 7 new files | Everything else. |
| Documentation | 4 paths | No executable impact. |

Read-only **imports** of existing app code are tier 0 and are used freely — importing `src/utils/retry.ts` or `src/settings.ts` changes nothing about them.

---

## Success invariants

Implementation is not complete unless all of these hold:

1. Playlist IDs, names, tracks, and archive automation remain unchanged.
2. Only production archive playlists at root are eligible to move.
3. Archive playlists already in another folder are reported and left untouched.
4. `[Test] YYYY - Month` playlists are recognized by the parser but are reported and left untouched by this command.
5. `History` resolves to exactly one root-level folder. Zero or multiple matches are a hard failure.
6. For v1, `History` must contain only direct-child production archive playlists—no nested folders or unrelated playlists. Otherwise stop and re-plan instead of guessing how to preserve mixed content.
7. *(Conditional — see Phase 0A-3.)* The final History sequence contains the union of already-filed and root-level production archives in ascending year/month order. **If Phase 0A-3 shows rootlist order is not observable in the client, this invariant is downgraded to report-only and the ordering machinery is cut from Phases 3–5.**
8. Duplicate production archives for the same year/month are a hard failure requiring manual cleanup; the tool never chooses between them.
9. Dry run performs no writes.
10. A 401 is fatal and never retried. A stale revision or uncertain POST result causes a fresh read and recomputation, never blind replay.
11. Logs, errors, captures, and snapshots never contain bearer or `client-token` values.
12. The local tool and its tests are absent from the Lambda ZIP. *(Pre-verified — see Phase 4.)*
13. **`bun run typecheck` still exits 0 and still compiles exactly the same 61 project files as before this branch.** Since Bun strips types without checking them and executes `src/*.ts` directly with no compile step, `bunx tsc --noEmit` is now the project's *only* static check on the deployed function; breaking it removes the last one. There is no `bun run build` — the Bun migration deleted it along with `dist/`.

---

## Corrections to the research doc

### The claimed matcher's *name* is wrong; a matcher does exist

The research doc says the naming convention is "detected by `isArchivePlaylistName()` in `src/settings.ts`."

That is half right, and revisions 1–3 of this plan over-corrected it into "there is no matcher anywhere in the repo." **There is.**

| Symbol | Location | Status |
|---|---|---|
| `buildArchiveNamer(prefix?: string)` | `src/settings.ts:18` | **Exported.** Returns an inner function still literally named `archivePlaylistNameFor` (`src/settings.ts:25`) |
| `buildArchiveMatcher(prefix?: string)` | `src/settings.ts:48` | **Exported.** Returns `isArchivePlaylistName(name: string): boolean` (`src/settings.ts:53`) |
| `MONTH_NAMES` | `src/settings.ts:3-16` | Module-private, **not** exported |
| `buildMyFn` | — | Does not exist. Renamed to `buildArchiveNamer` on 2026-08-02 |
| `settings().isArchivePlaylistName` | — | Removed from the settings object on 2026-08-02 |

Three details the earlier revisions got wrong or missed, all of which affect Phase 1:

- The namer's signature is `({ added_at }: { added_at: string }) => string` — a **destructured object** carrying an ISO string, not a bare string or `Date`.
- The prefix space is derived **once in the closure** (`src/settings.ts:23`), deliberately outside the returned function. That placement is the fix for the append-a-space-per-call bug recorded in `AGENTS.md` on 2026-08-02; the comment at `src/settings.ts:19-22` documents it. Do not "tidy" it.
- Naming uses **local time** (`getMonth()`/`getFullYear()`, `src/settings.ts:31-32`), not UTC. The existing tests dodge timezone flake by building dates at noon UTC (`Date.UTC(2026, month, 15, 12)`, `src/__tests__/archive-playlist-name.test.ts:87`). Any new date-driven test must do the same.

`buildArchiveMatcher`'s own docstring (`src/settings.ts:38-47`) calls it *"the only machine-readable statement of the archive name format"* and says it is kept exported precisely so a round-trip test can pin the namer against it.

### Consequence for this plan

The original argument for duplicating the parser into the tool was "nothing importable exists." **That argument is dead** — both factories are importable, and the scout verified they are pure and globals-free: `buildArchiveNamer()({ added_at })` works with no `-run-this-first` bootstrap at all. Only `settings()` needs the `dev` global (it reads `dev.isDev` at `src/settings.ts:59` and throws `ReferenceError` without it).

The duplication decision **survives, on narrower grounds**:

- `MONTH_NAMES` is still genuinely private, so a tool that wants to *parse* (not merely match) a name into `{ year, month }` cannot reuse the month list regardless.
- The matcher answers "is this an archive name?"; the planner needs "**which** year and month?" to sort and to detect duplicates. That is a different function, not a re-export.
- Keeping the tool free of `src/` coupling in its runtime path means a Spotify-side breakage never drags production code into scope.

But the duplication is now a *deliberate second copy of a module that explicitly designates itself canonical*, which is exactly the drift that docstring warns about. So the pin gets stronger, not weaker: the Phase 1 drift test asserts round-trip agreement against **both** exported factories, and it can do so with a plain direct import. See Phase 1.

---

## Architecture and complete file map

### Changes to currently-used code — one line

```text
tsconfig.json
  MODIFY  exclude: append "scripts"
```

`tsconfig.json` declares `rootDir: "./src"` and no `include`, so TypeScript falls back to the default `**/*` pattern. Its `exclude` array lists `src/scripts` but **not** top-level `scripts`. Adding the first `.ts` file under `scripts/` therefore fails the build:

```
error TS6059: File '.../scripts/spotify-folders/rootlist.ts' is not under 'rootDir' '.../src'.
  The file is in the program because:
    Matched by default include pattern '**/*'
```

This is unavoidable — a nested `tsconfig.json` does not stop the root program from claiming those files.

**Empirically confirmed 2026-08-04.** A throwaway `scripts/__tsprobe.ts` reproduced TS6059 verbatim, and the diagnostic's own explanation (`Matched by default include pattern '**/*'`) independently proves `include` is absent. `tsc` exited 2. The probe was deleted and `npx tsc --noEmit` exits 0 again. The current `exclude` array is exactly `["node_modules", "dist", "dynamodb_local_latest", "src/scripts"]` (`tsconfig.json:55-60`).

**Proof the fix is inert.** Capture `npx tsc --noEmit --listFiles` before and after appending `"scripts"`. The two lists must be byte-identical at **61 project files** — not the 57 claimed in revisions 1–3, which predates the Bun migration's file deletions. Measure the baseline yourself rather than trusting either number:

```bash
npx tsc --noEmit --listFiles | grep -v node_modules | sort > /tmp/before.txt
```

Top-level `scripts/` currently holds **`publish.rb` and nothing else** — the `run.js` and `.scpt` files cited in earlier revisions are gone, so the "`allowJs` is off, so none of them were ever in the program" sub-argument is now moot. The conclusion it supported still holds by a simpler route: `scripts/` contains no TypeScript today, so the new entry changes what *would* be compiled, never what *is*. Re-run this diff as the acceptance check.

### Local-only tool

```text
scripts/spotify-folders/archive-name.ts
  NEW  parseArchivePlaylistName() + isArchivePlaylistName(), self-contained

scripts/spotify-folders/rootlist.ts
  NEW  private HTTP transport + captured wire types

scripts/spotify-folders/planner.ts
  NEW  marker-tree parser + desired-state/move planner

scripts/spotify-folders/move-archives-to-folder.ts
  NEW  CLI, credentials, dry run, apply loop, backups, output

scripts/spotify-folders/tsconfig.json
  NEW  no-emit typecheck config, scoped to the tool

scripts/spotify-folders/__tests__/archive-name.test.ts
  NEW  parser/predicate tests + drift test against the real builder

scripts/spotify-folders/__tests__/spotify-folders.test.ts
  NEW  fixture-driven parser/planner/transport tests
```

The tool's tsconfig lives **inside** the tool directory rather than at the repo root. It is therefore excluded from the Lambda ZIP by the same `scripts/*` rule as everything else, and adds no root-level file.

### Documentation

```text
AGENTS.md
  ADD  command, env variables, token ritual, local-only warning

docs/rootlist-capture.md
  NEW  redacted Phase 0 findings and protocol decisions

docs/playlist-folders-research.md
  ADD  from main worktree, then update Option D/open questions

changelog/2026-08-02_archive-playlists-to-history-folder.md
  NEW  implementation and operational notes
```

**12 tracked paths: 2 modified, 10 added.** Only one modified path contains executable configuration, and its change is provably inert.

### Explicitly not touched

- **`src/settings.ts`** — not modified, not extended. Imported read-only by one test.
- **`package.json`** — no new scripts. The tool is invoked by its full path (below), which costs nothing and avoids editing a file every deploy depends on.
- **`scripts/publish.rb`** — verified unnecessary (Phase 4).
- **`ArchiveAction`** — it keeps creating playlists at root through the public API. Moving a playlist changes neither its ID nor its tracks.
- **The `Action`/`Mutation` framework** — this local reconciler observes live rootlist state and converges it. It should not create DynamoDB action history or pretend to be undoable through the production action system.
- **`src/cli-bun.ts`** — the Lambda-event shim, and the only CLI left after the Bun migration deleted the duplicate compiled Node path (`src/cli.ts` no longer exists; `bun run cli` maps to `bun run src/cli-bun.ts`). This command has its own entrypoint and does not route through `src/index.ts`.
- **`src/test.ts`** — never run it, never glob it. It performs live Spotify writes at module scope. See the revision 4 safety note.
- **The public `Spotify` wrapper and DynamoDB** — the user ID is copied from the captured rootlist URL, avoiding unrelated AWS/public-OAuth coupling.

### Invocation

```bash
# dry run
bun run scripts/spotify-folders/move-archives-to-folder.ts

# apply
bun run scripts/spotify-folders/move-archives-to-folder.ts --apply

# typecheck the tool
bunx tsc -p scripts/spotify-folders/tsconfig.json
```

Document these verbatim in `AGENTS.md`. Do not alias them into `package.json`.

---

## Phase 0 — Prove the wire contract from the terminal

Do this before writing TypeScript. The goal is not merely to observe the web player; it is to prove that a non-browser client can safely perform the exact operations the tool needs.

### 0A — Cheap preconditions first

These four checks cost minutes, need no tokens and no private API, and **any one of them can cancel or reshape the project**. Do them before any capture work.

1. **Confirm `History` exists and is a root-level folder.**

2. **Confirm `History` contains only direct-child production archive playlists.** If it contains a nested folder or unrelated playlist, stop and revise the v1 planner rules (invariant 6).

3. **Confirm rootlist order is observable at all.** The Spotify sidebar sorts by a user-selected mode — Recents, Recently Added, Alphabetical, Creator, or Custom Order — and rootlist order only surfaces under Custom Order. Set the sidebar to Custom Order, drag two playlists inside `History`, and confirm the new order persists across a client restart.
   - **If order persists and is visible:** invariant 7 stands; build the ordering machinery.
   - **If it does not:** ordering is unobservable, invariant 7 drops to report-only, and Phases 3–5 lose the desired-sequence comparison, the corrective-reorder plan, and three test cases. This removes roughly 1.5–2 hours of the estimate.

   Record the outcome in `docs/rootlist-capture.md` before Phase 3 begins. Do not build a full ordering planner against an unverified premise.

4. **Check for duplicate production archives now, via the public API.** This is a plain read of `/me/playlists` — no private endpoint, no captured tokens. Group names by parsed year/month and look for collisions.

   This is not a hypothetical. `AGENTS.md` records a 2025-01-06 fix titled *"Fix Duplicate Archive Playlist Creation"*, and `optionalPlaylist` (`src/spotify.ts:346`) resolves names with `playlists.find((p) => p?.name === named)` — **first match wins**. Production has been silently tolerating duplicates by design. Invariant 8 turns that tolerated condition into a hard failure, so it is materially likely to block the entire backfill.

   If duplicates exist, resolve them by hand in the Spotify client before continuing. Discovering this on minute one costs nothing; discovering it after the capture work wastes the whole phase.

### 0B — Prepare reversible test state

1. Pick two harmless playlists whose temporary movement and restoration can be verified. Prefer existing archive candidates if that matches the real operation.
2. Capture a complete pre-test rootlist response without auth headers. Keep a private local copy outside the repo for restoration evidence.

### 0C — Capture browser traffic

In `open.spotify.com` → DevTools → Network → filter `rootlist`:

1. Capture a plain `GET .../rootlist`:
   - exact URL/query parameters
   - response `Content-Type`
   - response body shape
   - `revision` location, if any
   - `contents.truncated` or equivalent pagination signal
   - exact `start-group` / `end-group` URI and folder-name fields
   - the user ID embedded in the URL
2. Drag one test playlist into `History` and capture the `rootlist/changes` request:
   - required headers besides credentials, such as `app-platform`, `origin`, or app version
   - exact `MOV` representation
   - whether `baseRevision` is present
   - whether the request asks for resulting revisions or sync results
   - response status, headers, body, and new revision behavior
3. Save a redacted description and representative JSON to `docs/rootlist-capture.md`. Never save the bearer, `client-token`, cookies, or Copy-as-cURL command containing them.

### 0D — Prove terminal execution and ordering

Export credentials into the shell for this phase; do not write them to `.env` yet (see the credential handling note in Phase 4).

1. Reconstruct the captured one-item request with `curl` and execute it from Terminal.
2. GET the rootlist again and verify the move by URI and surrounding anchors.
3. Restore the playlist through the Spotify UI, then verify restoration with another GET.
4. Test a reversible **two-item** move in the exact form the implementation would use:
   - If multiple `MOV` ops can be sent together, verify whether a later op may anchor to an item moved by an earlier op.
   - Verify the final order, not only membership.
   - Determine whether the request is all-or-nothing.
5. If the captured form uses a base revision, deliberately make that revision stale using a harmless UI reorder, submit the stale test request, and record the exact status/body. Restore the test state afterward.

**Token expiry during this phase.** The web-player bearer is short-lived (roughly an hour) and these steps involve several UI round-trips. A 401 here means *recapture and restart the current step* — it is a manual-workflow interruption, not the fatal condition of invariant 10, which governs the tool's runtime behavior only.

### 0E — Choose the apply strategy

Record one of these in `docs/rootlist-capture.md`:

- **Proven batch:** one request may apply the complete ordered move plan atomically, and chained URI anchors behave as expected.
- **Sequential convergence:** batch/chained behavior is not proven, so apply one move, GET a fresh rootlist, recompute, and repeat.

Sequential convergence is an acceptable result. Do not force batching for performance; this is a one-shot tool moving tens of playlists.

### Phase 0 gate

Stop and re-plan if any of these is true:

- Terminal execution is rejected even with fresh captured credentials.
- JSON cannot be requested and decoding requires an unplanned protobuf implementation.
- Folder markers or `MOV` semantics differ materially from the model above.
- The response can be truncated and no safe full-read mechanism is identified.
- The History folder does not satisfy the dedicated-folder invariant (0A-2).
- Duplicate production archives exist and cannot be resolved by hand (0A-4).

If Phase 0 fails, restore the test state, delete/overwrite the captured tokens, and use manual drag instead.

---

## Phase 1 — Archive playlist detection, inside the tool

Create `scripts/spotify-folders/archive-name.ts`. It is self-contained and imports nothing from `src/`.

```ts
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const TEST_PREFIX = '[Test] '

export type ParsedArchivePlaylistName = {
  year: number
  month: number
  kind: 'production' | 'test'
}

export function parseArchivePlaylistName(
  name: string,
): ParsedArchivePlaylistName | null

export function isArchivePlaylistName(name: string): boolean
```

Rules:

- Pattern: optional exact `[Test] ` prefix, then `YYYY - MonthName`.
- Anchor both ends; `2026 - July (old)` and `2026 - Julyish` do not match.
- Match months against the local `MONTH_NAMES`, not `\w+`.
- Return a **zero-based** month index, matching `Date#getMonth()` and the production builder.
- Return `kind: 'production' | 'test'` so the reconciler can report test archives without moving them. A two-valued string union rather than a boolean, per the project's standing preference for enums over booleans — apply that to every type in the tool, including `PlaylistDisposition` and the transport's mode flags.
- Keep it pure. No dependency on `dev`, `days`, DynamoDB, or environment initialization.

### Guarding the duplicated literals

The month list and `[Test] ` prefix are copied from `src/settings.ts`. Copying is acceptable **because the copy is pinned by a test, not by convention.**

`scripts/spotify-folders/__tests__/archive-name.test.ts` imports the real production factories and asserts round-trip agreement.

**Revisions 1–3 prescribed a `settings()` + global-flipping dance here. Do not do that.** It was necessary only under the pre-Bun belief that the namer was unreachable except through `settings()`. Both factories are now exported and pure, so the test is a plain direct import with no bootstrap:

```ts
import { buildArchiveNamer, buildArchiveMatcher } from '../../../src/settings'
import { parseArchivePlaylistName } from '../archive-name'

// noon UTC — the production namer reads getMonth()/getFullYear() in LOCAL time,
// so a midnight-anchored date is timezone-flaky. Mirrors src/__tests__/archive-playlist-name.test.ts:87.
const isoFor = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 15, 12)).toISOString()

for (const [prefix, kind] of [[undefined, 'production'], ['[Test]', 'test']] as const) {
  const name = buildArchiveNamer(prefix)({ added_at: isoFor(2026, month) })
  // -> "2026 - July" / "[Test] 2026 - July"

  // 1. our parser recovers { year, month, kind } from the real builder's real output
  // 2. our predicate agrees with the real matcher on that output
  expect(buildArchiveMatcher(prefix)(name)).toBe(true)
}
```

Note `buildArchiveNamer` takes `{ added_at: string }`, not a `Date` or a bare string — pass the destructured object shape.

Pinning against **both** factories matters more than revision 3 assumed. `buildArchiveMatcher`'s docstring designates it the canonical statement of the format, so the tool's copy is knowingly a second definition of something that declares itself singular. The test is what keeps that honest: if anyone renames a month, changes the prefix, or adjusts the regex in `src/settings.ts`, it fails immediately and points at the tool. That is still a strictly better outcome than exporting a shared parser, because the production module stays untouched.

`src/__tests__/archive-playlist-name.test.ts` (117 lines, 9 tests) already performs exactly this namer→matcher round trip and is the closest template to copy from.

Remaining cases to cover:

- all 12 production month names, both branches, via the round-trip above
- representative years including leading-zero rejection and the chosen four-digit-year rule
- `Current`, `Inbox`, `2026 - Julyish`, `2026 - July (old)`, `Archive 2026-07`
- whitespace and casing variants that must not match

---

## Phase 2 — Local rootlist transport

Create `scripts/spotify-folders/rootlist.ts`. Types and payloads come from the redacted Phase 0 capture, not from old third-party examples.

Illustrative API—the final signatures follow the captured protocol:

```ts
export type RootlistCredentials = {
  accessToken: string
  clientToken: string
}

export async function getRootlist(
  userId: string,
  credentials: RootlistCredentials,
): Promise<RootlistSnapshot>

export async function postRootlistChanges(
  userId: string,
  credentials: RootlistCredentials,
  request: RootlistChangeRequest,
): Promise<RootlistChangeResponse>
```

Transport responsibilities:

- URL-encode the user ID.
- Send exactly the required captured headers.
- Use `Accept: application/json` only if Phase 0 proves JSON is supported.
- Set a bounded request timeout with `AbortSignal`.
- Check `response.ok`; native `fetch` does not throw on HTTP errors.
- Validate the minimum runtime response shape before returning it. TypeScript interfaces alone do not validate private API data.
- Reject a truncated/partial rootlist unless the complete pagination/read mechanism is implemented and tested.
- Normalize failures into an error containing only safe fields: operation, status, request ID if present, content type, and a bounded redacted response excerpt.
- Never attach or log request headers, credential values, raw `Request` objects, or Copy-as-cURL output.

### Retry ownership

Safe GET failures reuse `retryWithBackoff()` from `src/utils/retry.ts` — a read-only import, no change to that file. Its real signature is `retryWithBackoff<T>(operation: () => Promise<T>, config?: RetryConfig)` (`src/utils/retry.ts:59`), and the options type is named **`RetryConfig`**, not `RetryOptions`. Merging is `{ ...DEFAULT_CONFIG, ...config }` (`:63`), so a supplied override cleanly replaces the default.

**Both overrides below are mandatory, not optional.** Both were re-verified against today's file:

- **`shouldRetry` must be supplied.** The default predicate returns `true` on `statusCode === 401` (`src/utils/retry.ts:23-27`) — the exact opposite of invariant 10. Left at its default it retries a dead bearer five times. Supply a predicate that retries only network errors, 429, and 503. **Additional trap the earlier revisions missed:** the default *also* returns `true` when `error.message` contains `'access token expired'` or `'invalid_token'` (`src/utils/retry.ts:35-40`). A replacement predicate must refuse both the status code and the message forms, not just the status code.
- **`onRetry` must be supplied.** The default (`src/utils/retry.ts:51-56`) logs `error.message || error` at `:54`, dumping the entire error object whenever `message` is falsy — a direct risk to invariant 11. Supply a handler that logs only the normalized safe fields.

Two further behaviours to account for:

- `maxRetries: 5` means **5 total attempts** (1 initial + 4 retries), not 6 — the loop is `for (attempt = 1; attempt <= maxRetries; attempt++)` (`src/utils/retry.ts:66`).
- A `retry-after` header is honoured for the delay regardless of which `shouldRetry` you pass (`src/utils/retry.ts:89-95`).

Further:

- 401/403 are fatal with instructions to recapture credentials.
- `postRootlistChanges()` performs **one HTTP attempt**. It never blindly retries a write, and never passes through `retryWithBackoff()`.
- Stale-revision and uncertain-write recovery belong to the Phase 4 reconciliation loop, which can observe live state and recompute.

---

## Phase 3 — Pure marker parser and desired-state planner

Create `scripts/spotify-folders/planner.ts`. Keep all hierarchy, classification, ordering, and delta construction pure so captured fixtures can exercise it without network access.

### Rootlist parsing

Parse the flat marker stream with a folder stack:

- `start-group` pushes a folder with its ID, name, URI, index, parent, and depth.
- `end-group` must match the active folder ID before popping.
- Unbalanced, mismatched, or duplicate marker IDs are hard failures.
- Preserve original entry index and parent folder for every playlist.
- Distinguish root-level playlists, direct History children, History descendants, and playlists in other folders.

`findHistoryFolder()` must return exactly one root-level folder named `History`. Reject zero, multiple, or nested-only matches with the matching IDs/paths in the safe error.

### Classification

```ts
type PlaylistDisposition =
  | 'root-production-archive'
  | 'already-in-history'
  | 'archive-in-other-folder'
  | 'test-archive'
  | 'not-an-archive'
```

- Only `root-production-archive` is eligible to enter History.
- `already-in-history` participates in desired-order computation; it is not blindly skipped.
- `archive-in-other-folder` and `test-archive` are reported and left untouched.

### Desired state

1. Validate that History contains only direct-child production archive playlists.
2. Combine its existing playlists with eligible root-level candidates.
3. Parse every name and reject duplicate production year/month keys.
4. Sort ascending by year then month.
5. Compare the complete current History URI sequence with the desired sequence.
6. If the sequences already match and there are no root candidates, emit an empty plan.
7. Otherwise emit a plan that, when applied using the Phase 0-selected strategy, produces the exact desired URI sequence.

**If Phase 0A-3 found ordering unobservable**, steps 4–7 collapse to "append eligible candidates to History in any order"; the ordering tests in Phase 5 are dropped, and the dry-run output reports order as informational only.

The dry-run output must show both membership and final order:

```text
History folder found (id: abc123)
Scanned 87 root-level playlists

Eligible root archives:       19
Already in History:            4
Archives in other folders:     1 (left untouched)
Test archives:                 2 (left untouched)

Desired History order (23):
  01. 2024 - February          already in History
  02. 2024 - March             move from root
  03. 2024 - April             move from root
  ...

Dry run. Re-run with --apply to write this plan.
```

---

## Phase 4 — CLI, apply loop, and local-only wiring

Create `scripts/spotify-folders/move-archives-to-folder.ts`.

### Runtime bootstrap and credential handling

Required values:

```text
SPOTIFY_SPCLIENT_TOKEN   raw bearer token, without the "Bearer " prefix
SPOTIFY_CLIENT_TOKEN     raw client-token value
SPOTIFY_USER_ID          stable user ID copied from the captured rootlist URL
```

**Prefer exporting the two secrets in an ephemeral shell over writing them to `.env`.** Two reasons:

- This worktree has no `.env` at all — only `/Users/tal/Projects/spotify-playlist/.env` exists — so using one here means creating a new secret-bearing file.
- A `SessionStart` hook in `~/.claude/settings.json` auto-loads `.env` from the working directory into the environment, so a live bearer pasted there becomes visible to every subsequent agent session in this directory. That works against invariant 11's intent even though `.env` is gitignored (`.gitignore:3`).

`SPOTIFY_USER_ID` is not a credential and may live in `.env` safely.

**`dotenv` no longer exists in this project.** The Bun migration cut direct dependencies from 22 to 8, and `dotenv` was one of the casualties — Bun loads `.env` natively at startup. So the entrypoint must **not** call `dotenv.config()`; there is nothing to import and adding the dependency back for a local tool would violate the change budget. Read `process.env` directly, treat real environment variables as authoritative, and do not require a `.env` file to exist.

There is no project runtime called "SessionStart" to inherit from — that is a Claude Code hook, not application infrastructure.

Verified 2026-08-04: this worktree has **no `.env`** (`.gitignore:3` covers it). The main worktree's `.env` holds `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` — **public-API OAuth app credentials, a different credential type entirely** from the web-player bearer this tool needs. Three distinct credentials are in play and conflating them wastes an hour:

| Credential | Where it lives | What it opens |
|---|---|---|
| `SPOTIFY_CLIENT_ID` / `_SECRET` | main worktree `.env` | OAuth app identity for the public API |
| User OAuth access/refresh token | DynamoDB `users` table | `api.spotify.com` on the user's behalf |
| Web-player bearer + `client-token` | **nowhere — must be captured** | `spclient.wg.spotify.com` private endpoints |

Missing values print exact DevTools instructions and exit non-zero. The command does not initialize DynamoDB or the public `Spotify` wrapper.

### CLI behavior

- Accept only the documented flags: no flag for dry run, or `--apply`.
- Reject unknown flags.
- Dry run: GET → parse → compute → print; no POST and no backup required.
- Apply: GET → parse → compute → print → write private backup → apply → GET → verify.
- If the plan is empty, print the verified final order and exit 0 without a POST.

### Backup

Immediately before the first POST, save the credential-free rootlist snapshot and computed plan to:

```text
~/Library/Application Support/spotify-playlist/rootlist-backups/<timestamp>.json
```

- Create the directory/file with user-only permissions where practical.
- Store no auth headers, cookies, bearer, or `client-token`.
- Print the backup path.
- The backup is restoration evidence and an exact record of original anchors. Automatic restore is out of scope for v1; do not claim otherwise.

### Reconciliation loop

Use a small explicit convergence loop rather than wrapping a stale POST in generic retry logic:

1. GET a fresh rootlist.
2. Parse and recompute the complete desired state.
3. If live state matches the desired state, succeed.
4. Otherwise send the next write selected by the Phase 0 strategy.
5. On a confirmed stale revision, return to step 1 after backoff.
6. On timeout, connection reset, aborted response, or retryable 5xx after request dispatch, treat the result as **unknown** and return to step 1. Do not claim nothing changed.
7. On 401/403, stop immediately and instruct the operator to recapture tokens.

### Loop bounds — two separate counters

Under sequential convergence, a 19-archive backfill needs at least 19 successful iterations. A single "stop after 5 attempts" bound would abort the run two-thirds short and leave the rootlist partially applied. Track two distinct counters:

| Counter | Bound | Meaning |
|---|---|---|
| `consecutiveNoProgress` | 5 | Iterations in a row where the live state did not move closer to desired. This is the stall detector. Resets to zero on any observed progress. |
| `totalIterations` | `3 × plannedMoves + 10` | Runaway backstop only. Should never be reached in a healthy run. |

Exceeding either bound prints a redacted error plus the backup path and exits non-zero.

After the final GET, assert every success invariant: exact History URI order (if invariant 7 is active), no eligible root archive remains, and no out-of-scope playlist moved according to the before/after snapshot.

### Typecheck config

`scripts/spotify-folders/tsconfig.json` extends `../../tsconfig.json`, sets `noEmit: true`, overrides `rootDir` to the tool directory, and includes the tool, its tests, and the global declarations required to type-check `src/` imports.

**Include `src/global.d.ts` explicitly.** It declares the ambient `dev`, `seconds`, `minutes`, `hours`, and `days` consts (`src/global.d.ts:31-40`); a tool tsconfig that omits it fails to type-check anything transitively touching them. The tool's own runtime path should not need those globals — `buildArchiveNamer`/`buildArchiveMatcher` are globals-free — but the declaration file is cheap insurance against a transitive import.

Run it with `bunx tsc -p scripts/spotify-folders/tsconfig.json`. The production `bun run typecheck` continues to exit 0 over exactly its previous **61** files.

New files under `scripts/` are covered by `bun run format:check`, which runs Prettier over the whole repo. Match `.prettierrc`: **no semicolons**, single quotes, 2-space tabs, trailing commas everywhere.

### Prove the deployment boundary — conclusion holds, proof was wrong

**Revisions 1–3 proved this against an expression that does not exist.** They claimed `publish.rb` carries `-x"scripts/*"`, `-x"*.md"`, and `-x"*.env"`, and reasoned about Info-ZIP glob semantics. Post-Bun `publish.rb` works completely differently.

What it actually does:

| Step | Location | Detail |
|---|---|---|
| Stage | `scripts/publish.rb:36`, `:55-58` | Copies an **allowlist** into `build/lambda`: `PAYLOAD = ['src', 'package.json', 'bun.lock', 'tsconfig.json']` |
| Prune | `:39`, `:59` | Removes `src/__tests__`, `src/scripts`, `src/migrations` from the staged copy |
| Zip | `:68-69` | `Dir.chdir(STAGE)` then `zip -r -q "#{ZIP}" . -x "*.DS_Store" -x "**/.env"` |

So the only zip-level excludes are `.DS_Store` and `.env`, and they run from **inside** the staging directory.

**Invariant 12 still holds, and now holds more strongly.** Top-level `scripts/` is simply never copied into `build/lambda` at all — the tool cannot ship because it is not on the allowlist, not because a glob catches it. There is no exclusion rule to get wrong, and `scripts/publish.rb` still needs no change. The nested-tool contingency from earlier revisions stays removed.

Two corollaries the old proof obscured:

- Root `tsconfig.json` **is** in `PAYLOAD` and does ship. The one-line `exclude` edit therefore modifies a deployed file. It is inert there — the Bun runtime never reads `tsconfig.json` — but "zero shipped footprint" is not quite accurate and the change budget now says so.
- A nested `scripts/spotify-folders/tsconfig.json` does **not** ship, which is the whole reason the tool's tsconfig lives there rather than at the root.

Run this check once before calling the feature complete, against the real tree. Note there is no compile step to run first — Bun executes `src/*.ts` directly:

1. Reproduce the staging faithfully: copy only `PAYLOAD` into a scratch directory, then delete the `PRUNE` paths.
2. Zip it with the same expression, writing **outside the repo**, and do **not** deploy.
3. Inspect with `zipinfo -1`.
4. Assert no path under `scripts/`, no rootlist capture Markdown, and no `.env` is present.
5. Independently assert that `'scripts'` is absent from `PAYLOAD` in `scripts/publish.rb` — that single line is the actual guarantee, and a future edit to it is what would break invariant 12.

---

## Phase 5 — Tests

All tests live under `scripts/spotify-folders/__tests__/` and are picked up by the project's existing bare `bun test`.

### Name parser and drift

Run the Phase 1 cases in `archive-name.test.ts`, including the round-trip drift test against the real production builder for all 12 months in both branches.

### Fixture-driven planner and transport tests

Build fixtures from the redacted Phase 0 captures. Synthetic fixtures may extend them for edge cases, but the base shape must match live data.

Cover at least:

- empty rootlist and empty History
- balanced root folder with direct playlist children
- nested folders and correct depth/parent classification
- mismatched/unbalanced group markers
- zero, duplicate, and nested-only `History` matches
- History containing unrelated playlists or nested folders → hard failure
- root archive vs History archive vs archive in another folder
- `[Test]` archives left untouched
- existing + new archives merged into one ascending desired sequence *(skip if invariant 7 was dropped)*
- already-correct state emits no moves
- incorrectly ordered existing History archives produce a corrective plan *(skip if invariant 7 was dropped)*
- duplicate production year/month archives → hard failure
- exact payload generation for the Phase 0-selected batch or sequential strategy
- 401/403 fatal behavior, including that the custom `shouldRetry` does not retry 401
- stale revision → fresh GET and recomputation
- non-JSON, malformed JSON, and truncated rootlist rejection
- timeout/connection reset after POST → fresh GET before any further write
- uncertain POST that actually committed → next GET observes success and does not duplicate the write
- secret redaction in normalized errors
- **`consecutiveNoProgress` does not fire during a healthy 19-move sequential run**

### Verification commands

```bash
bun test
bun run typecheck                                # = bunx tsc --noEmit; must exit 0 — see invariant 13
bunx tsc -p scripts/spotify-folders/tsconfig.json
bun run format:check
npx tsc --noEmit --listFiles | grep -v node_modules | wc -l   # must still be 61
```

`bun run build` appeared in revisions 1–3 and **does not exist** — the Bun migration deleted it along with the compile step. The full script list is `cli`, `cli:server`, `reauth`, `typecheck`, `format`, `format:check`, `test`, `test:watch`.

**Note on `bun test` counts.** Bare `bun test` today reports *"91 pass / Ran 91 tests across 6 files."* Only **58 tests across 5 files** are real. The sixth file is `dist/__tests__/liked-songs-removal-detection.test.js`, a stale pre-migration compiled artifact re-running 33 of the same tests. `dist/` is gitignored and no longer produced by anything, but it is still sitting on disk and `bun test` does not exclude it (tsc does).

- Use **58 / 5 files** as the honest baseline for any before/after assertion.
- Deleting the stale `dist/` tree is safe and recommended — it is untracked, gitignored, absent from the deploy path, and nothing regenerates it. Doing so makes `bun test` report the truth. This is out of scope for the plan but costs one command.
- Revisions 1–3 described this as "doubled counts after any build." There is no build anymore; the duplication is a fossil, not a recurring effect.

---

## Phase 6 — Execute and verify on the real account

1. Close or pause Spotify clients that might reorder the library during the run.
2. Export fresh tokens into the shell; confirm `SPOTIFY_USER_ID`.
3. `bun run scripts/spotify-folders/move-archives-to-folder.ts` — inspect candidates, out-of-scope reports, and the complete desired History order.
4. If the dry run reports duplicate year/month archives, stop. Resolve them by hand in the Spotify client and re-run the dry run. Do not apply.
5. `bun run scripts/spotify-folders/move-archives-to-folder.ts --apply` — note the printed backup path.
6. Verify in the Spotify client, with the sidebar set to the sort mode established in Phase 0A-3:
   - all expected production archives are direct children of History
   - chronological order matches the printed desired order *(only if invariant 7 is active)*
   - `[Test]` archives and playlists in other folders are unchanged
7. Run the dry run again. It must report zero moves and print the same verified complete order.
8. Run `bun run cli archive` (there is no `cli:bun` script — `cli` maps to `bun run src/cli-bun.ts`) and confirm the public automation still finds/writes the moved archive playlist by unchanged ID.
9. Run the four verification commands from Phase 5 again.
10. Unset `SPOTIFY_SPCLIENT_TOKEN` and `SPOTIFY_CLIENT_TOKEN` from the shell after the run. `SPOTIFY_USER_ID` is not a credential and may be kept.

If the client view and rootlist verification disagree, stop. Preserve the backup, do not run another apply blindly, and compare live rootlist URIs/anchors with the saved snapshot.

---

## Phase 7 — Document

- Add `changelog/2026-08-02_archive-playlists-to-history-folder.md`.
- Update `AGENTS.md` with:
  - the three full `bun run scripts/spotify-folders/...` invocations
  - the three environment values and which two are short-lived secrets
  - the recommendation to export secrets in an ephemeral shell rather than `.env`, and why
  - capture, redaction, token-removal, backup, and recovery instructions
  - explicit statement that the tool is local-only and unsupported by Spotify
  - a note that `tsconfig.json`'s `exclude` now covers `scripts`, and why
- Copy `playlist-folders-research.md` from the main worktree into this branch, then:
  - correct the nonexistent matcher claim, noting that `archivePlaylistNameFor` is an unexported closure
  - mark Option D as partially implemented, local-only
  - record the Phase 0 protocol answers, including the ordering-observability finding
  - keep the private API maintenance warning
- Ensure `docs/rootlist-capture.md` contains only redacted protocol evidence and no private rootlist backup.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `spclient` rejects terminal requests or binds `client-token` to browser/device state | **Kills the approach** | Phase 0D executes a real reversible request from Terminal. Fall back to manual drag if rejected. |
| Captured rootlist is protobuf or otherwise not safely decodable as JSON | **Kills the scoped approach** | Stop at Phase 0 rather than adding an unplanned decoder. |
| **Duplicate production archives already exist on the account** | **High — documented history, not hypothetical** | Public-API check in 0A-4, before any capture work. `AGENTS.md` records a prior duplicate-archive fix and `optionalPlaylist` resolves by first match, so production tolerates duplicates that this tool refuses. Resolve by hand before proceeding. |
| Adding the tool breaks `bun run typecheck`, the project's only static gate | **High — empirically confirmed (TS6059)** | One inert `exclude` entry, validated by a before/after `--listFiles` diff showing **61** identical files. Bun strips types without checking and there is no compile step, so this gate must keep working. |
| Sequential convergence aborts mid-backfill on a too-small attempt bound | High | Separate `consecutiveNoProgress` stall detector from the `totalIterations` runaway backstop; test a healthy 19-move run. |
| Multi-op/chained `MOV` behavior is different from expected | High for batching, low for feature | Phase 0D tests two items. Fall back to one move per fresh read/recompute cycle. |
| Planner misreads nested folder markers and moves an archive from another folder | High | Stack-based parser, hard marker validation, root-only eligibility, captured fixtures, and before/after invariant checks. |
| POST times out after Spotify committed it | High | Treat outcome as unknown; GET and recompute before any further write. |
| Credentials leak through docs, raw errors, or the default `onRetry` handler | High | Redacted captures, normalized safe errors, mandatory `onRetry` override, ephemeral shell exports, no raw request logging. |
| Default `retryWithBackoff` predicate retries 401 five times | Medium | Mandatory explicit `shouldRetry`; covered by a dedicated test. |
| Ordering effort spent on a property the client never displays | Medium | 0A-3 validates observability in minutes; invariant 7 is explicitly conditional and its machinery is cut if the check fails. |
| History contains duplicate months, nested folders, or unrelated playlists | Medium | Hard fail with a clear report; v1 does not guess. |
| Private tool enters the Lambda package | **Resolved** | Post-Bun `publish.rb` stages an **allowlist** (`PAYLOAD = ['src', 'package.json', 'bun.lock', 'tsconfig.json']`, `scripts/publish.rb:36`) into `build/lambda`. Top-level `scripts/` is never copied, so there is no exclusion rule to get wrong. The revision 1–3 proof cited a `-x"scripts/*"` expression that does not exist. Re-checked once in Phase 4. |
| Spotify changes the endpoint later | Certain eventually | Local unsupported tool, zero production coupling; fail closed on response validation and refresh Phase 0 evidence before maintenance. |

---

## Rollback and recovery posture

This operation does not create, delete, rename, or modify tracks in a playlist. Playlist IDs remain unchanged. It **does** mutate the ordered rootlist, so calling it "non-destructive" without qualification would be misleading.

**The primary recovery mechanism is the tool's own convergence, not manual restoration.** Because the reconciler recomputes desired state from a fresh read on every iteration, a partially applied run is not a corrupted state — it is simply an intermediate one. Re-running the command drives it the rest of the way. This is the whole point of the convergent design, and it applies to timeouts, stalls, and bounded-abort exits alike.

Manual restoration is needed only when the *desired state itself* is wrong — a misparsed folder tree, a wrong History match, or an out-of-scope playlist moved. In that case:

1. Stop automated retries. Do not re-run the tool, since it would re-apply the same wrong plan.
2. Preserve the backup and current GET response.
3. Compare original and current URI adjacency/folder markers.
4. Restore manually in the Spotify client using the backup as the source of truth.
5. Verify the restored rootlist with another GET.

An automatic `--restore` or `--to-root` mode is explicitly out of scope for v1. Add it only if manual recovery proves insufficient and after its own captured/proven plan.

---

## Effort

| Phase | Estimate |
|---|---|
| 0A — cheap preconditions (folder shape, ordering observability, duplicate scan) | 20 min |
| 0B–0E — reversible capture and terminal protocol proof | 2 hrs |
| 1 — tool-local parser + drift test | 30 min |
| 2 — typed transport and safe errors | 1.5–2.5 hrs |
| 3 — marker parser, desired-state planner, fixtures | 2–3 hrs |
| 4 — CLI, convergence loop, backup, tsconfig | 1.5–2.5 hrs |
| 5–7 — tests, real run, package proof, docs | 1.5–2 hrs |

**Estimated total: 9.5–12.5 hours**, gated on Phase 0 proving terminal access and the usable wire format.

- If 0A-3 shows ordering is unobservable, subtract roughly 1.5–2 hours from Phases 3 and 5.
- If 0A-4 finds duplicates, add manual cleanup time before anything else proceeds.
- If Phase 0 fails outright, sunk cost is about two hours and the correct outcome is manual drag.

Phase 1 dropped from 45 to 30 minutes because there is no longer a production module to refactor — only a self-contained parser and a test that pins it to the real builder.

---

## Post-implementation corrections (added 2026-08-04, Phase 7)

Revision 4 above already corrected the claims that predated implementation
(57→61 files, `buildMyFn`→`buildArchiveNamer`, the nonexistent `bun run build`,
the `dist/__tests__` doubled-count fossil). This section is different: it
records what actually *running* the tool — Phase 0's capture and the live dry
run against the real account — proved, where that differs from what the plan
assumed going in. The plan text above is left intact as a record; nothing in
it was rewritten.

### Invariant 6 fails on the live account — the plan's own escape hatch was used

Phase 0A-2 says: if `History` contains a nested folder or unrelated playlist,
*"stop and revise the v1 planner rules."* On the real account it does — 51 of
`History`'s 180 direct children are not production archives (11 `Your Top Songs
20XX` editorial playlists, 40 legacy hand-named archives like `2015 - Sept` and
`2013 - Oct (CMJ)` that predate the current naming convention).

Rather than stopping the whole project, the shipped tool turns this into a
runtime choice: `historyContentPolicy` defaults to `'strict'` (matches the
plan's default expectation — refuse and report) with an explicit
`--tolerate-unrelated-history` opt-in that proceeds, reporting the 51 and
leaving them untouched. A nested folder inside `History` remains a hard failure
under both policies, since that is the part of invariant 6 that actually
protects an append-only plan. This is a reading of "stop and re-plan" as
"stop by default, and require an explicit operator decision to proceed" rather
than "abandon the feature" — consistent with the plan's own framing that
invariant 6 exists so the tool doesn't *guess* at mixed content, not so it
refuses to ever touch a `History` folder that has any non-archive playlist in
it.

### Scope is one move, not nineteen

The plan's Phase 3 dry-run illustration (`Eligible root archives: 19`) was a
sketch, not a measurement. The real number, measured via a live capture: **1**
eligible root-level production archive (`2026 - July`); 129 are already filed
in `History`. The 9.5–12.5 hour effort estimate in this document was sized
around building the tool, which did not change — but the backfill itself, once
built, is a single move. The ongoing steady-state case (one archive created
per month by `ArchiveAction`) is one move per month going forward.

### 0A-4 (duplicate check) ran against a different source than specified

The plan requires checking for duplicate production archives via the public
API (`GET /me/playlists`) *"no private endpoint, no captured tokens."* In
practice `GET /v1/me` and `GET /me/playlists` both returned HTTP 429 on every
attempt across several minutes on this account, so the duplicate scan was
computed from the private rootlist capture instead. That capture is a superset
of the sidebar library, so the check is arguably stronger, not weaker — but it
is not the check as specified, and required tokens the plan says this step
shouldn't need. Result either way: zero duplicate production year/month keys
found across all 307 rootlist entries.

### 0A-3 (ordering observability) was never tested

The plan's Phase 0A-3 calls for a manual Spotify-client UI test (set sidebar to
Custom Order, drag two playlists, confirm persistence). This requires the
desktop/web UI and cannot be driven from a terminal. It was not attempted. This
is moot in practice only because the user separately overrode invariant 7 to
report-only regardless of what 0A-3 would have found — but the plan's own gate
was never actually cleared, only bypassed by a decision made above the plan.

### Test file count: three, not two

Phase 5's file map lists two new test files
(`archive-name.test.ts`, `spotify-folders.test.ts`). The shipped tool has
three: `planner.test.ts` was split out to cover the pure marker-parser/planner
fixtures separately from `spotify-folders.test.ts`'s transport and CLI tests.
No planned coverage is missing; the split is finer-grained than the file map
anticipated. 102 tests total across the three files.

### The write path (Phase 0D/0E) remains completely unproven

Worth stating plainly since it is easy to lose in the read-only framing: this
implementation pass proved the **GET** side of the private API in full, but
never attempted the **POST**. `POST .../rootlist/changes` was not called even
once, not with a throwaway test playlist, not reversibly. Phase 0D (reversible
one-item and two-item moves, stale-revision probe) and Phase 0E (choosing a
batch vs. sequential-convergence apply strategy) are both still open. The
`convergeMovePlan` code in `move-archives-to-folder.ts` implements the
sequential-convergence design this plan describes, written out in full for
review purposes, but it has never been exercised against a real write and
should not be trusted as validated until Phase 0D actually runs.
