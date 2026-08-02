# Track Status Field + Manual-Change Detection in the Archive Pass

Adds a denormalized lifecycle field to `TrackItem`, and teaches `ArchiveAction` its second
job: detecting triage changes made outside the official actions.

## The status field

```ts
declare type TrackStatus = 'inbox' | 'promoted' | 'removed'

interface TrackItem {
  status?: TrackStatus | null
  status_changed_at?: number
}
```

- `'inbox'` — in the Inbox playlist, awaiting triage
- `'promoted'` — made it to Current. **Stays `'promoted'` after archiving**; filing a track
  away is not a lifecycle change. (A separate `archived` flag was discussed and deferred.)
- `'removed'` — demoted, or found missing from every tracked playlist
- `null` — never written deliberately. Reads may see it on rows predating the field;
  consumers must treat it as "unknown" and **must not** default it to a state. No backfill.

### Derived from the triage log, in the same write

`STATUS_BY_TRIAGE_ACTION` in `src/db/dynamo.ts`:

| `action_type` | `status` |
|---|---|
| `inboxed` | `inbox` |
| `promote` | `promoted` |
| `remove` | `removed` |
| `upvote` | *(no change)* |

`'upvote'` is status-neutral **and that is load-bearing**. `promoteTrack()` pushes `'upvote'`
last on every promote (`track-action.ts:232-237`), after the conditional `'promote'` entry
(`:193`). Since each `TriageActionMutation` is its own write, mapping `'upvote'` to a state
would clobber `'promoted'` on every single promotion to Current.

`statusForTriageActions()` therefore scans backwards for the last action that *maps* to a
state. Both write paths (`addTrackTriageAction`, `updateTrack`) set the field in the same
`UpdateCommand` as the log append, so it cannot drift and costs no extra write. `status` is
a DynamoDB reserved word, aliased as `#status` everywhere.

## Manual-change detection

`ArchiveAction` now does two things in one pass:

1. `archiveAgedTracks()` — unchanged behaviour, moving aged-out tracks into their monthly
   archive, still bucketed by `added_at` on the Current playlist (i.e. the month the track
   was promoted, not the month the pass runs).
2. `reconcileTrackStatus()` — new. Any row claiming `'inbox'` or `'promoted'` that is
   present in **neither** Inbox nor Current gets marked `'removed'`.

Ordering is deliberate: `perform()` does all its reads before any mutation executes, so the
sweep sees Current *before* this pass archives anything. Tracks about to be moved are still
present and cannot be mistaken for deletions.

> **Superseded (2026-08-02).** Point 2 and the archive-exclusion section below describe the
> original presence-based sweep. `'promoted'` rows now reconcile against **liked status**
> instead of Current membership, which removed the archive walk entirely. See
> `2026-08-02_adversarial-review-high-priority-fixes.md`. `'inbox'` rows are unchanged.

### Archive exclusion

Because archived tracks keep `status: 'promoted'` while legitimately absent from Current,
they must be excluded or the sweep would mark every archived track as removed.
`archivedTrackIds()` resolves membership across every archive playlist, recognised by
`isArchivePlaylistName` — a new matcher in `src/settings.ts` deliberately co-located with
`archivePlaylistNameFor` so the builder and its inverse cannot drift apart. Covered by
`src/__tests__/archive-playlist-name.test.ts`, including regex-escaping of the `[Test]`
dev prefix.

The exclusion pass is skipped entirely when nothing is missing.

> **Removed (2026-08-02).** `archivedTrackIds()` is gone along with the presence-based sweep;
> a still-liked archived track is no longer a candidate for removal in the first place.
> `buildArchiveMatcher` survives as an exported test oracle and is no longer on the settings
> object.

### The sweep does not write triage actions

`SetTrackStatusMutation` sets `status` only, never appending to `triage_actions`. That
asymmetry is intentional: `triage_actions` stays a log of *explicit* user actions, so

- **explicitly demoted** = has a `'remove'` entry
- **quietly disappeared** = `status: 'removed'` with no matching entry

remain distinguishable.

## Costs, stated plainly

- `Dynamo.allTracks()` is a **full table scan** of `track`, filtered by user prefix. The
  table has no index on status and rows are never deleted, so this grows with every track
  ever seen. Accepted for now; the scanned row count is logged so it can be watched.
- ~~`archivedTrackIds()` reads **every archive playlist** (~12/year, unbounded), sequentially
  to avoid tripping Spotify's rate limit. After the first archive run there will always be
  archived tracks missing from Current, so this pays out on essentially every run. The
  deferred `archived` status would eliminate it outright.~~ **Gone as of 2026-08-02** — the
  liked-status rewrite made the walk unnecessary. The sweep now reads the liked-songs cache
  instead, which is one memoized read per Lambda invocation and shared with `RulePlaylistAction`.

## Verification

- `bunx tsc --noEmit` — clean.
- `bun test` — 37 pass / 0 fail (4 new).
- No migration; attributes appear on a row's next triage action or reconciliation.

## Still open

### Manual Current → Inbox moves are undetected

Reconciliation has three parts, and they cover three of the four cases:

| Case | Covered by | Status |
|---|---|---|
| Manual add to Inbox | `ProcessManualTriage.performInbox` | ✅ |
| Manual move Inbox → Current | `ProcessManualTriage.performCurrent` | ✅ (new — see below) |
| Manual removal from both | `ArchiveAction.reconcileTrackStatus()` | ✅ |
| **Manual move Current → Inbox** | — | ❌ |

Each half of `ProcessManualTriage` filters on the action it would write, and only one of
those is an action a returning track already owns:

- `performCurrent` filters on `'promote'` (`process-manual-triage.ts:39`). A track dragged
  into Current by hand never ran `promoteTrack()`, so it has `'inboxed'` but no `'promote'`
  → it passes the filter, gets a `'promote'` entry, and status becomes `'promoted'`.
- `performInbox` filters on `'inboxed'` (`:86`). A track *returning* to Inbox already
  carries `'inboxed'` from its original arrival → filtered out, nothing written, status
  stays `'promoted'` while the track physically sits in Inbox.

The archive sweep can't cover it either: the track is present in a tracked playlist, so it
is not missing.

Note the Inbox → Current capture is only live as of this branch — `performCurrent` built
its mutations and then `return []`, discarding them, until that was fixed to
`return [mutations]` (`:65`).

**Related edge case**, same root cause: after a demote (status `'removed'`), manually adding
the track straight back into Current is skipped too, because a `'promote'` entry already
exists from the original promotion. Status stays `'removed'` while it sits in Current.

Fix for all of it would be to change `ProcessManualTriage`'s filters from "has it ever had
this action?" to "does `status` match where the track actually is?", now that `status`
exists to compare against. Contained, but it changes behaviour in an action this work
otherwise did not touch, so it was deliberately left alone.

### Smaller items

- `'remove'` is a misleading name for something only demote emits; renaming to `'demote'`
  was discussed but not done.
- `TriageActionMutation` still never populates `context_playlist_id`.
- Demote-from-Starred (`track-action.ts:257-269`) still early-returns without logging, so
  that path writes no status. Deliberately unfixed — Starred has no standard actions today.
  The reconciliation sweep now catches it on the next archive pass as a side effect.
