# Adversarial-Review Fixes — High Priority

Fixes findings #1–#5 from `handoffs/2026-08-02_adversarial-review-findings.md`, the audit of
the `listen-limit-before-archiving` branch. Findings #6–#13 (MED and below) are untouched.

## 1. Listen writes no longer double-count on a transient failure — HIGH

**The bug.** `AddTrackListenMutation` awaits its Dynamo write. Awaiting was correct, but it
made a single failed write (a throttle, say) reject up through `Mutation.run()` into
`performAction()`, which rethrows — so the watermark mutation set, deliberately last, never
ran. `lastPlayedAtProcessed` stayed put, and every listen written before the failure was
re-processed on the next run, incrementing `play_count` and `play_count_current` a second
time. It repeated every run until the failure cleared, silently corrupting the exact data
this branch exists to collect.

**The fix.** A run-scoped `ListenSequence` (`src/mutations/listen-sequence.ts`) shared by the
listen writes and the watermark write:

| Rule | Why |
|---|---|
| Listens go out one per mutation set, ascending by `played_at` | Sets run sequentially, so "the writes that landed" is a prefix, not a scattered subset |
| Only a successful write advances the sequence's watermark | The watermark is the sole guard against reprocessing, so it may never claim a write that didn't happen |
| The first failure **halts** the pass; later listens are skipped, not written | A write landing *above* the watermark is precisely what gets counted twice |
| The watermark mutation resolves its `ts` at mutate time, not construction time | It has to report where the pass actually stopped |

Two supporting changes in `src/mutations/mutation.ts`:

- `MutationFailureMode = 'abort-action' | 'record-and-continue'`. Default is `'abort-action'`,
  which is what every existing mutation had and still has. `AddTrackListenMutation` opts into
  `'record-and-continue'` **only** when it has a sequence, so the watermark mutation survives
  to record the truth. The failure is still recorded on the mutation, still lands in
  `action_history`, and now logs at `console.error`.
- `MutationIntent = 'run' | 'skip'` plus a `'skipped'` completion state, so a halted listen is
  visibly skipped rather than falsely reported as a success.

Net effect: each listen is counted exactly once. A failure defers the tail of the batch to the
next run, which is what the watermark is for.

**Also corrected:** the 2026-08-01 changelog's claim that awaiting these writes *prevents*
double-counting. It's inverted for the listen writes; a correction note is in that file.

## 2. `buildArchiveNamer` no longer mutates its captured prefix — HIGH (dev-only)

`buildMyFn` normalized onto the closed-over `prefix` parameter *inside* the returned function.
Every call shared that closure, so each call appended another space:

```
call 1 → "[Test] 2026 - July"
call 2 → "[Test]  2026 - July"
call 3 → "[Test]   2026 - July"
```

In dev that forked a fresh archive playlist per aged track, and none of the multi-space names
matched `buildArchiveMatcher`, so the sweep then marked those tracks `'removed'`. Production
was unaffected — the empty prefix normalizes to `''` idempotently.

- Derived once into a `const namePrefix` outside the returned function.
- Renamed `buildMyFn` → `buildArchiveNamer` and exported it, so it pairs visibly with
  `buildArchiveMatcher` and can be tested.
- New round-trip tests feed the **real output of a repeatedly-called namer** into the matcher,
  for both prefixes, plus a stability check that the same month always yields the same name.
  The pre-existing tests only fed the matcher hand-written strings, which is exactly why a
  drifting namer went unnoticed.

## 3. A missing playlist no longer takes the whole archive pass down — HIGH

`client.playlist()` throws when the playlist doesn't exist, and both `archiveAgedTracks()` and
`reconcileTrackStatus()` called it. Because `perform()` completes all reads before any mutation
runs, a missing Inbox threw before returning — so even the already-computed archive moves never
executed.

Both now use `optionalPlaylist` and degrade to the part they can still do:

| Missing | Before | After |
|---|---|---|
| Current | Whole action throws | Nothing to archive; reconciliation still runs |
| Inbox | Whole action throws | Inbox half of the sweep skipped; archiving and the promoted half still run |

"No evidence" must never read as "everything disappeared", so a skipped half marks nothing.

## 4. `'promoted'` rows reconcile against liked status, not Current membership — MED-HIGH

**Tal's design decision.** The bug as found: `present` was Inbox ∪ Current, so a promoted track
hand-moved to Starred — a first-class playlist that `demoteTrack()` treats as curation — got
marked `'removed'` while being deliberately kept.

Adding Starred to the presence set would have been the narrow fix. Instead the promoted branch
is rebased on what the status actually means:

- Reaching Current always implies the track was saved to the library (`triageStates.confirmed`
  is `{ current: true, saved: true }`).
- A promoted track leaves Current legitimately all the time — archived by this very pass, or
  moved to Starred.
- Being **unliked** is what actually marks it dropped. `demoteTrack()` unsaves, unless the
  track is in Starred, in which case it stays liked and stays promoted. Correct on both paths.

`reconcileTrackStatus()` now splits by status:

| Status | Reconciles against | Source |
|---|---|---|
| `'inbox'` | Inbox membership | `tracksForPlaylist` |
| `'promoted'` | liked status | `mySavedTracks()` (liked-songs cache, syncs on read) |
| `null` / missing | nothing — unknown is not a state | — |

Two refusals to guess, both erring toward *not* marking anything removed:

- Inbox playlist missing → skip the inbox half.
- Liked songs come back empty → skip the promoted half. An empty library is far likelier to be
  a cache that failed to populate than a real state, and acting on it would mark every promoted
  track removed in a single pass.

**Side benefit taken:** `archivedTrackIds()` is deleted. A still-liked archived track is no
longer a removal candidate, so walking every archive playlist every run — the cost flagged in
the 2026-08-02 changelog — is unnecessary. `isArchivePlaylistName` came off the settings object
with it; `buildArchiveMatcher` stays exported as the test oracle for #2.

`{ track: null }` items (unavailable / region-blocked, most likely in old archives) no longer
crash the pass either — `trackIdsIn()` filters them. That is a partial fix for finding #9; the
`gId(null)` → `"null"` half of #9 is untouched.

## 5. Write storms and the throttle spiral — MED-HIGH

A self-reinforcing loop: every mutation in a set fires at once via `Promise.all`, the first run
against a legacy playlist queues one write per untriaged track (unbounded), that throttles
DynamoDB, and `getTracks()` reported throttled reads as *missing rows* — which
`ProcessManualTriage` reads as "never triaged" and answers with a **spurious** `'promote'` +
`status: 'promoted'`. The storm caused the throttle that caused the bad writes.

- **`getTracks()` retries `UnprocessedKeys`** (`src/db/dynamo.ts`). BatchGet succeeds while
  handing back keys it didn't read; those were silently dropped. Now retried with exponential
  backoff (5 attempts, ~50ms → 800ms), and **throws** if any remain unread. Reporting a key as
  missing when it was merely unread is the bug — failing loudly is the only safe alternative.
- **Unbounded sets are chunked into sequential sets of 25** — `ProcessManualTriage`'s two halves
  and `ArchiveAction`'s reconciliation sweep. Bounds the fan-out without serializing a backfill
  one write at a time.

**Not fixed here:** a rejection inside a chunk still aborts the action, loses the
`action_history` record, and leaves sibling writes applied. Chunking shrinks the blast radius;
the history-loss shape is findings #6/#8.

## Verification

- `bunx tsc --noEmit` — clean.
- `bun test` — **48 pass / 0 fail** (baseline 37; 11 new).
  - 7 in `src/__tests__/listen-sequence.test.ts` covering #1 against a fake Dynamo: full
    success, failure mid-batch, skip-the-tail, failure-on-first-listen, error recorded without
    aborting, and the stored `ts` matching what was written.
  - 4 in `src/__tests__/archive-playlist-name.test.ts` covering #2's round trip.
- No migration. No DynamoDB schema change.

## Open, and deliberately not decided here

- **Manual Current → Inbox is still undetected**, and #4 does not change that: a hand-moved
  track stays liked, so it stays `'promoted'` while sitting in Inbox. No regression, no fix.
  It interacts with the deferred item in the 2026-08-02 changelog's "Still open" section —
  worth a decision alongside it rather than in isolation.
- Findings #6–#13 are untouched: `action_history` TTL inversion, `status_changed_at` mixing
  three clocks, the 400KB `forStorage` ceiling, `gId(null)`, legacy playback context URIs,
  the `cli-bun.ts` output change, and the remaining doc corrections.
