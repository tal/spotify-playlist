# Plan: Mutation Bugfixes + Mock-Free Unit Testability for Actions

Goal: `perform()` becomes a pure planner — tests construct a plain snapshot, call the
planner, and assert on the returned mutation sets via `.storage`. No mocks, no fakes
cast through `as unknown as Dynamo`. The mutation layer already has this shape; this
plan brings the action layer up to it, fixing the four live bugs found during the
audit along the way.

Each phase is independently shippable. Verify every phase with `bunx tsc && bun test`.

---

## Phase 0 — Bug fixes (standalone, ship first)

No architecture changes; every fix is small and self-contained.

### 0.1 `UnsaveTrackMutation` records itself as a save

- `src/mutations/unsave-track-mutation.ts:9` declares `mutationType: MutationTypes = 'save-track'`.
- Fix: `'unsave-track'` — the member already exists in the `MutationTypes` union
  (`src/mutations/mutation.ts:31`), so this is a one-line change.
- Note: rows already stored in `action_history` keep the wrong label. Nothing
  currently replays stored mutations (undo goes through `action.undo()`, not stored
  data), so no backfill — but call it out in the changelog.

### 0.2 Floating promises in save/unsave `mutate()`

- `src/mutations/save-track-mutation.ts:12` and `src/mutations/unsave-track-mutation.ts:12`
  call the client without `await`. The mutation reports `'success'` even when the
  Spotify call fails, and `failureMode: 'abort-action'` never fires.
- Fix: add `await` to both calls.

### 0.3 `TriageActionMutation` stamps wall-clock-at-execution

- `src/mutations/triage-action-mutation.ts:15` calls `new Date().getTime()` inside
  `mutate()`. The recorded `action_at` feeds `statusForTriageActions`
  (`src/db/dynamo.ts:939`) ordering.
- Fix: `action_at` becomes part of the mutation's data, supplied by the action at
  plan time (the actions already carry `created_at`). `mutate()` reads
  `this.data.action_at` and stops touching the clock. This is also a prerequisite
  for Phase 2 — a pure planner cannot emit mutations that invent timestamps later.

### 0.4 `ScanPlaylistsForInbox` constructor race

- `src/actions/scan-playlists-for-inbox.ts:35` fires `this.addActions()` un-awaited
  from the constructor; `perform()` iterates `this.playlistActions` and silently
  returns `[]` if the promise hasn't settled.
- Fix: delete the constructor call; `perform()` builds the child actions itself
  (await `addActions()` at the top). Removes both the race and one of the three
  constructor-I/O sites in one move.

---

## Phase 1 — Foundation seams

The shared changes every later phase leans on.

### 1.1 Unify dependency injection on the `Action` interface

- `src/actions/action.ts:8` — widen the perform context:
  `perform(ctx: PerformContext)` where
  `PerformContext = { client: Spotify; dynamo: Dynamo; now: number; settings: Settings }`.
- `performAction` (`src/actions/action.ts:18`) already holds `client` and `dynamo`;
  it additionally computes `now` once per invocation and awaits `settings()` once,
  then passes all four.
- Actions drop their `private client` fields as they migrate (Phase 2); until then
  the wider context is additive and non-breaking.

### 1.2 Kill ambient-global reads at class-evaluation time

- `src/actions/magic-promote-action.ts:6` reads `dev`/`minutes`/`hours` in a field
  initializer — constructing the class in a bare test file throws `ReferenceError`.
- Fix: throttle durations become plain numeric constants resolved at construction
  from an injected settings value, or move into the settings object. Same sweep for
  `days` reads in `archive-action.ts:44` and
  `process-playback-history-action.ts:32`.
- `settings()` (`src/settings.ts:58`) branches on `dev.isDev` — keep the branch, but
  actions receive the resolved settings **value** via `PerformContext` instead of
  calling `settings()` themselves.

### 1.3 Make `getID()` pure over constructor data

- `MagicPromoteAction.getID()` (`src/actions/magic-promote-action.ts:21`) and
  `DemoteAction` await `this.track()` — a Spotify call the runner makes up to three
  times per invocation, and the throttle check depends on it.
- Fix: pass the track uri (or `trackID`) at construction where the caller has it;
  where only "currently playing" is known, resolve the track once in the shell and
  hand the id to the planner/action.
- `ArchiveAction.getID()` (`src/actions/archive-action.ts:36`) — key on the period
  being archived (`archive:<YYYY-MM>`), fixing the known dead throttle from
  AGENTS.md. Handle the documented collision: with a stable id, `forStorage`'s `ttl`
  and the `action_history` row now recur across runs — store `created_at` in the
  row body and make the id stable, letting the throttle window (not the id) decide
  freshness.

### 1.4 Remove remaining constructor I/O

- `src/actions/add-playlist-to-inbox.ts:28` — the `tracks` fetch moves into
  `perform()` (or the Phase 2 gather step). `created_at` stays.
- `src/actions/auto-artist-playlist.ts:20-21` — same: both fetches move out of the
  constructor.
- (`ScanPlaylistsForInbox` handled in 0.4.)

---

## Phase 2 — The gather/plan split, per action

Pattern for every action:

```ts
// Shell: thin, does I/O, integration-covered at best
async gather(ctx: PerformContext): Promise<XSnapshot>

// Core: pure, exported, THE unit-test target
export function xPlan(snapshot: XSnapshot): Mutation<any>[][]

// perform() is just: plan(await gather(ctx))
```

Snapshot types are plain data and use string-literal unions, not booleans
(house preference), e.g.:

```ts
type Membership = 'present' | 'absent'
type PlayerState = 'playing' | 'not-playing'
```

Migration order, cheapest first:

### 2.1 `ProcessPlaybackHistoryAction`

- Snapshot: `{ playedItems, stageByPlaylistId, watermark, userId }` — the body of
  `perform()` (`src/actions/process-playback-history-action.ts:63-122`) is already a
  pure function of exactly these.
- `ListenSequence` stays as-is (the documented exception; see Phase 4).

### 2.2 `AutoArtistPlaylist`

- Snapshot: `{ playlistTracks, savedTracks, playlist }`. The set math at
  `auto-artist-playlist.ts:38-81` is already pure.

### 2.3 `ProcessManualTriage`

- Snapshot: `{ inboxTracks, currentTracks, trackRows }` (playlist contents + the
  `dynamo.getTracks` result).

### 2.4 `ArchiveAction`

- Snapshot: `{ now, timeToArchive, currentTracks, inboxTracks, liveStatusRows, savedTrackIds, archiveNamer }`.
- The `now - addedAt > timeToArchive` decision (`archive-action.ts:86`) becomes
  testable the moment `now` is a parameter.

### 2.5 `TrackAction` family (`MagicPromoteAction`, `DemoteAction`)

- Biggest surgery. Snapshot:

  ```ts
  interface TriageSnapshot {
    player: PlayerState
    track: BasicTrackData
    membership: { inbox: Membership; current: Membership; saved: Membership }
    playlists: { inbox: PlaylistID; current: PlaylistID; starred?: PlaylistID }
    playingFrom?: PlaylistID
    starredMembership: Membership
    now: number
  }
  ```

- `promoteTrack()`/`demoteTrack()` (`src/actions/track-action.ts:172-314`) become
  exported `promotePlan(snapshot)` / `demotePlan(snapshot)`; the existing
  `TriageState` booleans (`track-action.ts:27`) convert to the `Membership` union in
  the same pass.
- The `(client as any).__mem_player = null` + `delay(85)` retry
  (`track-action.ts:248-249`) moves into the gather step — retry choreography is
  shell work.
- `description()` I/O stays in the shell; the planner never reads the player.

### 2.6 `SkipToNextTrack`

- `perform()` currently writes inline (`skip-to-next-track.ts:15`) and returns `[]`.
- New `SkipToNextTrackMutation` (add `'skip-to-next-track'` to `MutationTypes`);
  `perform()` returns `[[new SkipToNextTrackMutation({})]]`.
- `getID()` stops minting a fresh timestamp per call.

### 2.7 `UndoAction` (last — it constructs other actions)

- `markActionAsUndone` (`undo-action.ts:109`) becomes a mutation.
- `findActionToUndo()` gets memoized so one invocation stops re-querying Dynamo
  from `getID()`, `forStorage()`, `perform()`, and `description()` independently.
- Its planner takes the found history row + the target action's snapshot; done
  after 2.5 so `undo()` paths are already pure.

### 2.8 `RulePlaylistAction`

- Inject the chooser: `pick: (n: number) => number` replaces the two direct
  `Math.random()` sites (`rule-playlist.ts:18,23`). Tests pass a deterministic
  chooser; prod passes the random one.

---

## Phase 3 — Tests

- One `*.plan.test.ts` per planner, mock-free, in the `archive-playlist-name.test.ts`
  style: build snapshot → call planner → `expect(plan.flat().map(m => m.storage)).toEqual(...)`.
- Priority cases: every `promotePlan`/`demotePlan` triage transition (unheard→liked,
  liked→confirmed, demote-from-starred, demote-from-foreign-playlist), archive
  age-boundary and status-reconciliation cases, playback attribution
  (context/no-context, inbox vs current), inbox dedup/filtering.
- One runner test for `performAction` using an in-memory fake — the single place a
  fake legitimately survives. This closes the AGENTS.md gap: `listen-sequence.test.ts`
  hand-rolls the mutation loop and cannot catch a `Promise.all`-within-a-set
  ordering break; the runner test drives the real loop.

---

## Phase 4 — Optional endgame (defer freely)

- Move failure sequencing from `ListenSequence` into `performAction` (the fix
  AGENTS.md already gestures at), making the last two mutation constructors pure
  plain-data and un-special-casing the playback path.
- Alternatively (also from AGENTS.md): make listen writes idempotent via
  `ConditionExpression` on `last_seen.played_at`, so ordering stops being
  load-bearing entirely.

## Non-goals / risks

- No backfill of mislabeled `'save-track'` history rows (nothing replays them).
- `settings()` stays async and dev-branched — only its call sites move.
- `PerformContext` widening is additive; unmigrated actions keep working mid-flight,
  so the phases can land as separate PRs.
