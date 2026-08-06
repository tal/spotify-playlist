# Undo Identity, Demote Bookkeeping, and the Inbox Planner

Fixes the MED findings from the adversarial review of the
`action-tests` branch (plan: `plans/2026-08-04_action-testability-and-bugfixes.md`,
phases 0–2). LOW findings are listed at the bottom as known polish; none were fixed.

## 1. Undo reverses the row's track, not whatever is playing

**The bug.** `UndoAction.gather` built
`{ trackID, trackURI }` from the stored `action_history` row and handed it to
`new MagicPromoteAction(this.client, identity)` — then took its snapshot from
`gatherDemote`, which opened with `await client.currentTrack` and never looked at the
identity. So `/undo?action-id=…`, whose lookback is a full **24 hours**, removed the
*currently playing* track from Current and Inbox, unsaved it from the library, and logged a
`'remove'` triage action against it, while `MarkActionUndoneMutation` stamped the original
row. Pre-existing (the old `undoableAction.undo()` → `demoteTrack()` path read the player the
same way), but the refactor threaded the identity through explicitly and commented it as if
the stored track were targeted.

**The fix.** `gatherDemote` resolves through a new `demoteTarget()`:

| Caller | Resolution |
|---|---|
| Named a track (`trackID`, i.e. undo replaying a row) | `this.track()` → `getTrack(id)` |
| Meant "whatever is playing" (uri only, or nothing) | the live player, with the existing one-shot `__mem_player` + `delay(85)` retry |

`gatherPromote` already worked this way, so the two directions are now symmetric.

`playingFrom` is gated on the same condition. Where the player sits says nothing about a
track named by id, and `demotePlan` acts on it twice over: it adds a removal from the
playing playlist, and if that playlist is **Starred** it short-circuits to a single
Starred removal — an undo that happened to run while Starred was playing would have skipped
the demote entirely. Live demote behavior is unchanged.

## 2. A demote could land and then fail to record itself

**The bug.** `currentTrackIdentity()` returns `{}` when its one retry still reads an empty
player, so `DemoteAction` gets built with `trackURI` undefined. `DemoteAction` has no
`idThrottleMs`, so nothing calls `getID()` before `perform()`. `gatherDemote`'s own rescue —
clear the memoized player, wait 85ms, read again — then routinely *found* the track the
identity read missed, and the remove/unsave mutations ran. Only afterwards did
`performAction` call `forStorage` → `getID()`, which threw `'no track provided 1'`: the
demote had happened, no `action_history` row was written (so it could never be undone), and
the handler returned 400.

**The fix.** `demoteTarget()` adopts the identity it resolves (`this.trackURI ??=
currentTrack?.uri`; `trackURI` is no longer `readonly`). `??=` rather than `=` on purpose —
a uri supplied at construction stays authoritative, so an id the throttle check already
queried on cannot change underneath `forStorage`.

## 3. `AddPlaylistToInbox` gets a planner and tests

The last planner-shaped surface in the branch with no exported planner and no test. Its
decision logic — dedup against the `track` table, the optional `trackFilter`, skipping
tracks already in Inbox, and the paired `AddTrackMutation` + per-track `'inboxed'`
`TriageActionMutation` — is now `inboxPlan(snapshot)`:

```ts
interface InboxSnapshot {
  playlistTracks: PlaylistTrack[]
  seenTrackIds: string[]
  inboxTrackIds: string[]
  inbox: PlaylistID
  now: number
  trackFilter?: (track: PlaylistTrack) => boolean
}
```

Behavior notes:

- The per-track `trackInPlaylist` loop is gone; `gather` reads Inbox once and passes ids.
  Same number of Spotify calls (`tracksForPlaylist` was already cached), one obvious read.
- The filter now runs **inside** the planner, so `gather` queries `getSeenTracks` for the
  unfiltered playlist. No prod caller passes a filter today, so this costs nothing now.
- Added tracks carry their id alongside their uri. The uri was previously re-parsed with a
  regex to recover the id for the triage action, with a throw on the else branch; that is
  gone.
- Duplicates within one source playlist collapse to a single add + single `'inboxed'`, which
  `getSeenTracks` used to do incidentally by keying its result on id.
- An empty plan is still `[]`, never `[[]]` — an empty set would store an `action_history`
  row claiming an inbox pass that added nothing.

## 4. Tests

- `src/__tests__/undo-plan.test.ts` — `undoPlan` had zero coverage. Pins the trailing
  mark-undone set (one mutation, carrying `{ action: { id, created_at }, undone_at }`), that
  the reversal sets come first, direction dispatch both ways, and the `state === 'undone'`
  throw — which is unreachable through the shell (`gather` throws first and hardcodes
  `'undoable'`), so a test is the only thing that can execute it.
- `src/__tests__/inbox-plan.test.ts` — dedup against seen tracks, against Inbox membership
  and within the source playlist; filter application; empty plan; `action_at` stamping.
- `src/__tests__/promote-plan.test.ts` — corrected the comment on *"writes the add before the
  remove"*. It claimed the order was crash-safety ("reversed, a failure between the two would
  drop the track entirely"), but both mutations sit in one set and `performAction` fires a set
  as a single `Promise.all`, which the same file says two hundred lines further down. The
  assertion pins the order serialized into `action_history` for undo, and now says so; a
  failed add to Current can still race a successful remove from Inbox.

## Known polish (not fixed)

- `AGENTS.md` still lists `SkipToNextTrack` among clock-derived action ids; this branch made
  it the constant `'skip-to-next-track'`.
- `ArchiveAction.gatherInbox` returns `{ listing: 'unavailable' }` both when Inbox could not
  be read and when the read was deliberately skipped, which `InboxEvidence`'s doc comment
  says are opposite meanings. Unobservable today.
- `UndoState`'s `'undone'` member is only reachable from tests: `gather` throws on
  `targetAction.undone` itself and then hardcodes `'undoable'`. One of the two checks should
  own the rule.
- `MagicPromoteAction.undo()` / `DemoteAction.undo()` are dead — nothing calls them since
  `UndoAction` inlined gather + `undoPlan` — and they bypass `MarkActionUndoneMutation`.
- `getRandomSlice` in `rule-playlist.ts` is still untested despite the injected `pick`.
- `archive-plan.test.ts` and `action-runner.test.ts` each enshrine one known-bad behavior as
  the expected value; fixing either bug will read as a broken test.

## Not fixed, and why

The gather shells stay untested. Reaching `gatherDemote` needs a fake `Spotify` *and* a fake
`settings()`/`getTriageInfo`, which is exactly the mock-heavy shape the plan exists to get
away from — the runner test remains the one place a fake legitimately survives.
