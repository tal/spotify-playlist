# Handoff: Fix adversarial-review findings on `listen-limit-before-archiving`

**Repo:** `/Users/tal/Projects/spotify-playlist.listen-limit-before-archiving`
**Branch:** `listen-limit-before-archiving` — all work is **uncommitted** working-tree changes vs HEAD (`301a124`). Nothing has been committed or pushed.
**Next session's job:** fix the remaining findings below, in priority order.

## Status — updated 2026-08-02

**#1–#5 are fixed.** See `changelog/2026-08-02_adversarial-review-high-priority-fixes.md` for the full write-up. Verified `bunx tsc --noEmit` clean and `bun test` at **48 pass / 0 fail** (baseline was 37; 11 new tests). Still uncommitted.

| # | Sev | Status |
|---|---|---|
| 1 | HIGH | ✅ Fixed — `ListenSequence` gates the watermark |
| 2 | HIGH | ✅ Fixed — `buildArchiveNamer`, prefix no longer mutated, round-trip tested |
| 3 | HIGH | ✅ Fixed — `optionalPlaylist` on both archive paths |
| 4 | MED-HIGH | ✅ Fixed — `'promoted'` reconciles on liked status; archive walk deleted |
| 5 | MED-HIGH | ✅ Fixed — `UnprocessedKeys` retried; unbounded sets chunked |
| 6 | MED | ⬜ Open — `action_history` TTL inversion |
| 7 | MED | ⬜ Open — `status_changed_at` mixes three clocks |
| 8 | MED | ⬜ Open — `forStorage` 400KB ceiling |
| 9 | LOW | 🟡 Partial — null-`track` crash fixed; `gId(null)` → `"null"` still open |
| 10 | LOW-MED | ⬜ Open — legacy playback context URIs |
| 11 | LOW | ⬜ Open — CLI output change + dead line |
| 12 | INFO | ⬜ Open — document the cache the sweep rests on (**re-read it — #4 changed what the sweep depends on**) |
| 13 | DOCS | 🟡 Partial — changelog corrections for #1–#5 landed; the `'upvote'` mechanism and undisclosed-changes items are still open |

**Start at #6.** Note that #12 and parts of #13 were written against the pre-#4 sweep and need re-reading before acting on them.

## Context in one paragraph

The branch adds per-stage listen counters (`play_count_inbox`/`play_count_current`) and a denormalized `status: 'inbox' | 'promoted' | 'removed'` field to `TrackItem`, plus a reconciliation sweep in `ArchiveAction` that marks tracks `'removed'` when they've quietly left the tracked playlists. Full intent and design rationale are in `changelog/2026-08-01_per-stage-listen-counts.md` and `changelog/2026-08-02_track-status-field.md` (both untracked, in the working tree) — read them first; do not duplicate their content here. Three adversarial review subagents then audited the diff. **Every headline changelog claim was confirmed** (tsc clean, 37/0 tests, all 7 "bugs fixed along the way" real, archiving still gates purely on `timeToArchive`). The findings below are what the review surfaced *beyond* the changelogs.

## Verified-good — do NOT re-review these

- Status is written in the same `UpdateCommand` as the triage-log append on both write paths (`dynamo.ts:182-191`, `:258-266`); exactly two `triage_actions` append sites exist; `#status` aliasing complete.
- Stage counter rides the same `UpdateCommand` as global `play_count` (`dynamo.ts:226-239`); no name/value collisions.
- `allTracks()` pagination (`LastEvaluatedKey` loop) and user isolation (`begins_with(id, '<user>:')`) are correct.
- Reads-before-mutations ordering holds: `action.ts:37` awaits `perform()` fully before running mutation sets at `:40-42`.
- All previously missing `await`s are fixed; no un-awaited Dynamo/Spotify writes remain in changed code.
- Production archive-name matching is correct (the bug in finding #2 is dev-prefix-only).

> **Line numbers drifted after the #1–#5 fixes (2026-08-02)** — the claims above still hold, but re-locate by symbol rather than by line. `archive-action.ts` in particular was substantially rewritten, and `dynamo.ts:226-239`/`:258-266` shifted when `getTracks()` grew its retry loop.

## Findings to fix, in priority order

### 1. ✅ FIXED — HIGH — awaited listen write now causes repeated double-counting on transient failure

> **Fixed 2026-08-02.** New run-scoped `ListenSequence` (`src/mutations/listen-sequence.ts`) shared by the listen writes and the watermark write. The watermark advances only across an unbroken prefix of successful writes, and the first failure *halts* the pass so later listens are skipped rather than written above the watermark — which is what would get double-counted. Took the "collect failures without aborting" direction via a new `MutationFailureMode = 'abort-action' | 'record-and-continue'` on the `Mutation` base class (default unchanged for every existing mutation), plus `MutationIntent = 'run' | 'skip'` and a `'skipped'` completion state. `UpdateLastPlayedProcessedMutation` resolves its `ts` at mutate time and writes it back into `data` so `action_history` shows where the pass actually stopped. Net: each listen counted exactly once; a failure defers the tail to the next run. Changelog claim corrected. 7 new tests in `src/__tests__/listen-sequence.test.ts`.

- `add-track-listen-mutation.ts:19` is now awaited, so a single failed Dynamo write (e.g. throttle) rejects through `mutation.ts:76` → `action.ts:54` rethrow → the watermark mutation set (`process-playback-history-action.ts:110-115`, deliberately last) **never runs**.
- Already-committed listen writes then get re-processed next run: `play_count` and `play_count_current` re-increment for every track that succeeded before the failure. Repeats every run until the failure clears. This silently corrupts the exact data this branch exists to collect.
- Note the changelog's claim (2026-08-01, "Bugs fixed" table) that the awaits *prevent* double-counting is inverted for the listen writes; correct the changelog when fixing.
- Fix direction: keep at-least-once for listens but make the watermark advance resilient — e.g. collect listen-write failures without aborting the action, or advance the watermark to the last *contiguous* successfully processed `played_at`.

### 2. ✅ FIXED — HIGH (dev-only) — `buildMyFn` mutates its captured `prefix`

> **Fixed 2026-08-02.** Prefix derived once into a `const namePrefix` outside the returned function. Also renamed `buildMyFn` → `buildArchiveNamer` and exported it, so it pairs visibly with `buildArchiveMatcher` and is testable. Added the round-trip tests exactly as specified — the real output of a repeatedly-called namer fed into the matcher, both prefixes — plus a stability check that the same month always yields the same name. 4 new tests.

- `settings.ts:28` reassigns the closure variable: each call with a prefix appends another space (`"[Test] 2026 - July"`, `"[Test]  2026 - July"`, …). Verified by execution.
- In dev this forks one archive playlist per aged track, and `buildArchiveMatcher` rejects the multi-space names, so the sweep then marks those tracks `'removed'`.
- Fix: use a local `const` instead of reassigning the parameter. Also add a round-trip test that feeds `archivePlaylistNameFor`'s real output (called repeatedly) into `isArchivePlaylistName` — the existing `src/__tests__/archive-playlist-name.test.ts` only tests hand-written strings, so it misses exactly this.

### 3. ✅ FIXED — HIGH — missing Inbox playlist is fatal to all archiving

> **Fixed 2026-08-02.** Both playlist reads use `optionalPlaylist` now, and each half of the pass degrades independently: a missing Current means nothing to archive (reconciliation still runs), a missing Inbox skips only the inbox half of the sweep. Scope note — the finding named `archive-action.ts:107`, but `archiveAgedTracks()` had the same throw one function earlier and would have defeated the fix, so it was guarded too. A skipped half marks *nothing* removed: "no evidence" must never read as "everything disappeared".

- `archive-action.ts:107` uses `client.playlist(inbox)` which throws (`spotify.ts:379`). `perform()` throws before returning, so even the already-computed archive mutations never run.
- Fix: use `optionalPlaylist` (same pattern and rationale as `process-playback-history-action.ts:51-52`) and skip/degrade the sweep gracefully.

### 4. ✅ FIXED — MED-HIGH — Starred sweep. ⚠️ DESIGN DECISION FROM TAL

> **Fixed 2026-08-02, following Tal's decision.** `reconcileTrackStatus()` splits by status: `'inbox'` rows reconcile against Inbox membership (unchanged), `'promoted'` rows against liked status via `mySavedTracks()` (the liked-songs cache, which syncs on read and is memoized per Lambda invocation — already shared with `RulePlaylistAction`). Starred was *not* added to a presence set; the promoted branch was rebased as instructed.
>
> Cache-freshness call: the cache's failure mode is missing an equal-count add+remove, which leaves a track looking liked — the safe direction, since it declines to mark something removed. The dangerous direction is guarded explicitly: an empty liked set skips the promoted half entirely rather than marking every promoted track removed.
>
> **Side benefit taken:** `archivedTrackIds()` deleted, along with the per-run walk over every archive playlist. `isArchivePlaylistName` came off the settings object; `buildArchiveMatcher` stays exported as the test oracle for #2. Verified nothing else referenced either.
>
> **Interaction flagged, not decided:** liked-status reconciliation does *not* close the deferred manual Current → Inbox gap — a hand-moved track stays liked, so it stays `'promoted'` while sitting in Inbox. No regression, but the proper fix (compare `status` against physical location in `ProcessManualTriage`) remains the only thing that catches it. Tal's call.

- Bug as found: `present` (`archive-action.ts:116-119`) = Inbox ∪ Current only. A promoted track hand-moved to Starred (a first-class playlist: `settings.ts:56,66`, special-cased in `track-action.ts:295-302`) gets marked `'removed'` while deliberately curated.
- **Tal's decision: for `'promoted'` rows, status should be derived from the track's *liked status*, not from presence in the Current playlist.** I.e. reconciliation for a `'promoted'` track asks "is this track still liked?" — if yes it stays `'promoted'`, if no it becomes `'removed'`. Do not just add Starred to the `present` set; rebase the promoted-branch of the sweep on liked status.
- Implementation notes: the repo already caches liked songs (`liked_songs` / `liked_songs_metadata` tables, `sync-liked-songs` action, `mySavedTracks` in `src/spotify-api.ts`). Check cache freshness semantics before trusting it in the sweep. `'inbox'` rows presumably still reconcile against Inbox membership — confirm with Tal only if the code makes that ambiguous.
- Side benefit worth taking: if `'promoted'` no longer reconciles against Current ∪ archives, the expensive `archivedTrackIds()` walk over every archive playlist (flagged as a known cost in the 2026-08-02 changelog) may become removable. Verify nothing else needs it before deleting.

### 5. ✅ FIXED — MED-HIGH — write storms + throttle spiral (self-reinforcing)

> **Fixed 2026-08-02.** Both halves. `getTracks()` now retries `UnprocessedKeys` with exponential backoff (5 attempts, ~50ms → 800ms) and **throws** if any remain unread — reporting a merely-unread key as a missing row is the bug, so failing loudly is the only safe alternative to retrying. `ProcessManualTriage`'s two halves and `ArchiveAction`'s sweep now return chunked sequential sets of 25 instead of one unbounded set.
>
> **Deliberately not fixed:** a rejection inside a chunk still aborts the action, loses the `action_history` record, and leaves sibling writes applied. Chunking shrinks the blast radius only — the history-loss shape is #6/#8.

- `performCurrent` returns ONE mutation set (`process-manual-triage.ts:65`), and sets run via `Promise.all` (`action.ts:42`): first run after this change fires one concurrent `UpdateCommand` per Current track lacking a `'promote'` entry (every legacy/manual track, unbounded). Stacks with `performInbox`'s pre-existing storm; both halves start concurrently (`:116-119`).
- Same shape in the sweep: `reconcileTrackStatus` returns one unbounded set (`archive-action.ts:147-154`). A single rejection in `Promise.all` aborts the action, loses the history record, and leaves sibling writes applied.
- `getTracks()` ignores `UnprocessedKeys` (`dynamo.ts:310-320`) — under throttle, tracks look like "no record" and `performCurrent` writes a **spurious** `'promote'` + `status: 'promoted'`. The storm causes the throttle that causes the bad writes.
- Fix direction: retry `UnprocessedKeys` in `getTracks()`; split the big sets into chunked sequential sets (see `process-playback-history-action.ts:106-108` for the one-mutation-per-set pattern).

### 6. MED — `action_history` TTL inversion

- `archive-action.ts:29-42`: `ttl` is set only when `mutationData` is empty. Sweep mutations now make almost every run non-empty → history rows kept **forever**. Archive isn't undoable, so these are pure growth. Decide the intended retention (probably: TTL unless there are *archive move* mutations, or TTL everything since undo never applies).

### 7. MED — `status_changed_at` mixes three clocks and can move backwards

- Sources: `statusForTriageActions` returns the action's `action_at` (`dynamo.ts:874`); `ProcessManualTriage` stamps `action_at = new Date(track.added_at).getTime()` (`process-manual-triage.ts:49-50`, `:96-97`) — a playlist-add time possibly months/years old; `SetTrackStatusMutation` uses `ArchiveAction.created_at` (`archive-action.ts:152`); `TriageActionMutation` stamps `new Date().getTime()` at mutate time (`triage-action-mutation.ts:15`).
- No `ConditionExpression` guards ordering, so an older-stamped write can overwrite a newer status. The field is unusable as "time entered current state" until this is unified.

### 8. MED — `forStorage` can breach DynamoDB's 400KB item limit

- One `action_history` item packs every mutation's storage (`archive-action.ts:29-42`); ~3000 sweep mutations overflow, failing *after* the status writes landed. Masked today by no-backfill. Cap/segment it, or moot it via #6.

### 9. 🟡 PARTIALLY FIXED — LOW — `t.track.id` null crashes and `"null"` desync

- `archive-action.ts:117-118` and `:176` dereference `t.track.id` unconditionally; Spotify returns `{ track: null }` items (unavailable/region-blocked), most likely in old archives — one null aborts the whole `frequent-crawling` chain (everything after `ArchiveAction` in `index.ts:98-108`).
- Also: `gId(null)` → `"koalemos:null"` comes back from `allTracks()` as the string `"null"`, never matching real `null` in `present` — such a row would be re-marked `'removed'` every run.

> **Half fixed 2026-08-02, as a side effect of #4.** The crash is gone: the only remaining playlist read in the sweep goes through a new `trackIdsIn()` helper that filters `{ track: null }` items, and the `:176` site went away with `archivedTrackIds()`. **Still open:** the `gId(null)` → `"null"` desync in `Dynamo`. Note the blast radius shrank — a `"null"` row now only matters to the inbox half of the sweep, since the promoted half no longer uses a presence set.

### 10. LOW-MED — legacy playback context URIs unattributed

- `playlistIdFromContextUri` (`process-playback-history-action.ts:11-13`) misses `spotify:user:<userid>:playlist:<id>`. Those plays bump `play_count` only and are indistinguishable from no-context plays in the attribution log. Extend the regex.

### 11. LOW — CLI output change + dead code

- `cli-bun.ts:324` now prints parsed `body` instead of `result` — `statusCode` vanished from CLI output (changelog describes this as formatting-only; decide if intended and update changelog). Dead line: `const results = body.result` (`:320`).

### 12. ⬜ OPEN (but re-read first) — INFO — document the cache the sweep's safety rests on

- The sweep sees pre-archive Current *partly* because `tracksForPlaylist` memoizes into `this._tracks` (`spotify.ts:433,443-446,463`) and nothing ever invalidates it. If anyone adds invalidation-on-write, the sweep silently starts marking freshly archived tracks as removed. Add a comment at the cache and/or in `reconcileTrackStatus`.
- Related latent trap: `stage` is honored only when `increment_by > 0` (`dynamo.ts:226-239`); `ProcessManualTriage` already passes `increment_by: 0`. Dormant, worth a comment.

> ⚠️ **Stale as written — #4 moved the ground under this.** The first bullet's danger is largely gone: the sweep no longer reads Current at all, so cache invalidation can no longer make it mark freshly archived tracks as removed. What the promoted half now rests on is the **liked-songs cache** instead (`mySavedTracks()` → `LikedSongsCache`), whose failure mode is different — it misses an equal-count add+remove, which is the safe direction, and an empty result is explicitly guarded. The inbox half still reads Inbox through `_tracks`, but Inbox is not mutated by this pass. Re-derive what actually needs documenting before writing comments. The second bullet is unaffected and still worth a comment.

### 13. 🟡 PARTIALLY DONE — DOCS — correct the changelogs / AGENTS.md

> **Done 2026-08-02:** the 2026-08-01 changelog's inverted double-counting claim is corrected in place; the 2026-08-02 changelog's sweep and archive-exclusion sections are marked superseded/removed with the cost item struck; AGENTS.md has a new entry and the old sweep bullet is marked superseded. New file: `changelog/2026-08-02_adversarial-review-high-priority-fixes.md`.
>
> **Still open:** everything below except the parts about the sweep — the `'upvote'` clobber mechanism, the `triage_actions` ordering note, the undisclosed-changes list (the TTL behavior change and the `cli-bun.ts` printed-object change are still undisclosed; the sweep's Inbox playlist read is now documented), and the overstated Current → Inbox coverage row. Note the sweep no longer reads Current, so re-check each item against current code rather than against the finding text.

- The `'upvote'` clobber reasoning (2026-08-02 changelog lines 35-38, mirrored in AGENTS.md) argues from write *order*, but mutation sets run via `Promise.all` (`action.ts:42`) — the writes race concurrently; the design survives only because `'upvote'` maps to `null` and emits no `#status` clause. Fix the stated mechanism. Also note `triage_actions` array order is nondeterministic and `action_at` can invert relative to array position.
- Disclose the previously undisclosed changes: the sweep's new Inbox playlist read, the TTL behavior change (#6), the `cli-bun.ts` printed-object change (#11), and that the `performCurrent` fix also writes `first_seen` with `exactness: 'playlist-addition'` (benign).
- The "manual Current → Inbox not caught" gap is real but overstated: a track with no `'inboxed'` entry *would* be caught by `performInbox`. Soften the flat ❌ in the coverage table.
- Per user preference: no new booleans were introduced as data (only predicate return types) — keep it that way when fixing.

## Also known but deliberately deferred (do not "fix" without asking)

- Manual Current → Inbox detection (changelog "Still open" section) — the proper fix (compare `status` against physical location in `ProcessManualTriage`) was deliberately left alone. Finding #4's liked-status decision may partially supersede this; flag the interaction to Tal rather than deciding unilaterally.
  - **2026-08-02: it does not supersede it.** A hand-moved track stays liked, so it stays `'promoted'` while sitting in Inbox — no regression, no fix, and the physical-location comparison is still the only thing that would catch it. Flagged to Tal; awaiting a decision.
- `Dynamo.allTracks()` full-table scan cost — accepted and logged. **Still true.**
- `performCurrent` reads a stale (pre-archive) Current inside `frequent-crawling` due to the same never-invalidated cache — currently benign and arguably desirable; noted, not a fix target.
- **New as of 2026-08-02:** a rejection inside one of the now-chunked mutation sets still aborts the action, loses the `action_history` record, and leaves sibling writes applied. Chunking (#5) only bounded the blast radius. Belongs with #6/#8.

## Working agreements for this repo/user

- Tal prefers string-literal unions over booleans, bullets/tables over prose, `jq` for JSON, changelog entries (`changelog/YYYY-MM-DD_name.md`) after significant changes, and AskUserQuestion for clarifications.
- Verify with `bunx tsc --noEmit` and `bun test` (baseline: clean, ~~37~~ **48 pass / 0 fail** as of the #1–#5 fixes). Local DynamoDB is NOT running by default (port 8000 refused during review).
- When done, update both changelog files and the AGENTS.md changelog section; commit only if asked (branch is intentionally uncommitted so far).

## Suggested skills for the next session

- ~~`spotify-web-api` — for the liked-status check in finding #4.~~ Done; #4 used the existing `mySavedTracks()` cache rather than a new endpoint.
- `bun-docs` — if writing new `bun:test` tests. Two test files exist now: `archive-playlist-name.test.ts` and `listen-sequence.test.ts`; match their fake-Dynamo style rather than inventing a new one.
- `tal:git:commit:atomic` — if/when Tal asks to commit, these fixes group naturally into atomic commits. **Nothing is committed yet, including the #1–#5 fixes.**
