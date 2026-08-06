# Action Testability: Pure Planners, Foundation Seams, and Four Bugfixes

Implements `plans/2026-08-04_action-testability-and-bugfixes.md` (Phases 0–3, all landed).
Goal: `perform()` becomes a pure planner — construct a plain snapshot, call the planner,
assert on the returned mutation sets via `.storage`. No mocks, no fakes cast through
`as unknown as Dynamo`. The mutation layer already had this shape; this closes the gap on
the action layer, fixing four live bugs found during the audit along the way.

## Phase 0 — Four standalone bugs

| Bug | File | Fix |
|---|---|---|
| `UnsaveTrackMutation` recorded itself as a save | `src/mutations/unsave-track-mutation.ts` | `mutationType` was `'save-track'`; now `'unsave-track'`. **No backfill** of rows already stored with the wrong label — nothing replays stored `action_history` data (undo goes through `action.undo()`, not stored mutations), so this was a non-goal by design |
| Floating promises in save/unsave `mutate()` | `src/mutations/save-track-mutation.ts`, `unsave-track-mutation.ts` | Both called `client.saveTrack(...)`/`client.unsaveTrack(...)` without `await`. A failed Spotify call still reported `'success'`, and `failureMode: 'abort-action'` never had a chance to fire. Added `await` to both |
| `TriageActionMutation` stamped wall-clock-at-execution | `src/mutations/triage-action-mutation.ts` | `mutate()` called `new Date().getTime()` internally; `action_at` feeds ordering in `statusForTriageActions` (`src/db/dynamo.ts`). Now `action_at` is plan-time data on `TriageActionData`, supplied by the action when it builds the mutation (`this.created_at` / `snapshot.now`) — a prerequisite for Phase 2, since a pure planner cannot emit mutations that invent timestamps later |
| `ScanPlaylistsForInbox` constructor race | `src/actions/scan-playlists-for-inbox.ts` | The constructor fired `this.addActions()` un-awaited; `perform()` read `this.playlistActions` and silently returned `[]` if the promise hadn't settled yet. `addActions()` is now called (and awaited) at the top of `perform()`; the constructor does no I/O |

## Phase 1 — Foundation seams

**`PerformContext` + a throttle resolver.** `Action.perform` now takes one argument:

```ts
interface PerformContext { client: Spotify; dynamo: Dynamo; now: number; settings: Settings }
```

`performAction` (`src/actions/action.ts`) computes `now` and awaits `settings()` exactly
once per invocation, then hands all four down. `idThrottleMs` widened to
`ThrottleWindow = number | ((settings: Settings) => number)` so a throttle window that
depends on dev/prod no longer has to read the dev/prod branch itself —
`MagicPromoteAction.idThrottleMs = (settings) => settings.promoteThrottleMs` replaces the
old `5 * (dev.isDev ? minutes : hours)` field initializer.

**Ambient globals gone from `src/actions/`.** `dev`, `minutes`, `hours`, `days` were read at
class-evaluation time (field initializers), which throws `ReferenceError` the moment a bare
test file constructs one of these classes outside the Lambda's `-run-this-first.ts` bootstrap.
Fixed by moving the branched values into `settings()` (`promoteThrottleMs`, `timeToArchive`)
and replacing `days` with a local `DAY_MS` constant in `archive-action.ts` and
`process-playback-history-action.ts`. `settings()` itself is unchanged — still async,
still dev-branched — only the call sites moved, from inside each action to once in
`performAction`.

**Pure `getID()`s.** `MagicPromoteAction.getID()` and `DemoteAction.getID()` used to
`await this.track()` — a Spotify call, made up to three times per invocation, that the
throttle check depended on. Both now read `this.trackURI` directly, resolved once at
construction (see `currentTrackIdentity()` below) or adopted during `gatherDemote`'s rescue
path. `RulePlaylistAction.getID()` was already pure (`` `${this.type}:${this.options.rule}` ``).

**`ArchiveAction`'s dead throttle is revived.** `getID()` was `` `archive:${this.created_at}` ``
— a fresh timestamp per construction, so the exact-match `KeyConditionExpression` in
`getActionHistory` could never find a previous run and `idThrottleMs = 60 * 1000` was pure
decoration (documented in AGENTS.md's Known Issues). Now:

- `getID()` returns `` `archive:${archivePeriod(this.created_at)}` ``, e.g. `archive:2026-08` —
  stable for the whole month, one id per period.
- `action_history` is keyed `(id HASH, created_at RANGE)`, so a stable id does **not** collide
  runs against each other — each pass still writes its own row and keeps its own `ttl`;
  the throttle *window* decides freshness, not id uniqueness. This was the collision the plan
  flagged as the reason the fix "isn't a one-liner," resolved by leaning on the existing sort key
  rather than working around it.
- `archivePeriod()` is exported as a small pure function, independently testable.

## Phase 2 — The gather/plan split

Six actions got the split (`gather(ctx)` does I/O and returns a plain snapshot;
the exported `xPlan(snapshot)` is a pure function; `perform()` is just `plan(await gather(ctx))`):

| Action | Exported planner | Snapshot |
|---|---|---|
| `MagicPromoteAction` / `DemoteAction` | `promotePlan`, `demotePlan` (`track-action.ts`) | `PromoteSnapshot`, `DemoteSnapshot` — `Membership = 'present' \| 'absent'` replaces the old `TriageState` booleans throughout |
| `ProcessPlaybackHistoryAction` | `processPlaybackHistoryPlan` | `{ playedItems, stageByPlaylistId, watermark, userId }` |
| `AutoArtistPlaylist` | `autoArtistPlaylistPlan` | `{ playlistTracks, savedTracks, playlist }` |
| `ProcessManualTriage` | `manualTriagePlan` | `{ inboxTracks, currentTracks, trackRows }` — one shared `backfillPlan()` helper does both the Inbox and Current halves |
| `ArchiveAction` | `archivePlan` | `ArchiveSnapshot` — `CurrentEvidence`/`InboxEvidence` are `'unavailable' | 'read'` unions so "couldn't read the playlist" stays distinct from "read it and it's empty" |

Two more planners — `inboxPlan` and `undoPlan` — were added during the review pass below,
bringing the total to eight; see that section for what they cover.

Also in this phase, but not gather/plan-shaped:

- **`RulePlaylistAction`** (2.8) — `pick: (n: number) => number` injected via the constructor,
  replacing two direct `Math.random()` sites in `getRandomSlice`/`getRandomElement`. Production
  passes `(n) => Math.floor(Math.random() * n)`; tests pass a deterministic chooser.
  `getRandomElement`'s caller (`randomStarredArtistTracks`) is tested via
  `rule-playlist-pick.test.ts`; `getRandomSlice` itself remains untested (flagged in the
  review pass below).
- **`SkipToNextTrack`** (2.6) — `perform()` used to call `client.skipToNextTrack()` inline and
  return `[]`, so a skip was invisible to `action_history` and to the mutation-run/error
  machinery. New `SkipToNextTrackMutation` (`'skip-to-next-track'` added to `MutationTypes`);
  `perform()` now returns `[[new SkipToNextTrackMutation({})]]`. `getID()` also stopped minting
  a fresh timestamp (`` `skip-to-next-track:${Date.now()}` `` → the constant
  `'skip-to-next-track'`).
- `index.ts` / `test.ts` now call the new `currentTrackIdentity(spotify)` once, before
  constructing `MagicPromoteAction`/`DemoteAction`, so the id each one throttles on is fixed
  data rather than another player read — and a leading `SkipToNextTrack` in the same action
  list cannot change what gets promoted or demoted underneath it.

## Storage-shape delta: `BasicTrackData` instead of full `Track` blobs

`promotePlan`/`demotePlan` pass the snapshot's `track: BasicTrackData`
(`{ id, uri, name, artist, album }`, via the existing `trackToData()`) into
`SaveTrackMutation`, `UnsaveTrackMutation`, and `TriageActionMutation`. Previously these were
constructed with the raw `spotify-web-api-node` `Track` object fetched from
`this.track()`/`client.currentTrack`. The mutation data types (`{ tracks: { id: string }[] }`,
etc.) only ever *declared* an `id` field and `mutate()` only ever *read* `.id` — but JS doesn't
strip excess properties, so the object actually stored on `this.data` (and serialized into
`action_history` via `Mutation.storage`) was the entire Spotify blob: full album art array,
every credited artist's full object, `duration_ms`, `popularity`, `external_urls`, etc.
`action_history` rows for save-track/unsave-track/triage-action mutations coming out of
promote/demote are now the trimmed five-field shape. No behavior change — `mutate()` never read
the extra fields — just smaller rows going forward. Rows already stored keep the old shape.

## Lazy env resolution (`src/env.ts`, `src/spotify.ts`)

`spotify.ts` used to eagerly resolve environment config at **module-evaluation time**:

```ts
const env = getEnv().then((env) => env.spotify)
```

Since `getKey()` throws (as a rejected promise, being `async`) when a required env var is
missing, merely *importing* `spotify.ts` — which every gather shell does, if only for the
`Spotify`/`PlaylistID`/`TrackForMove` types — created a floating, potentially-rejected promise
before any test ever ran. Fixed by turning the eager binding into a function,
`const spotifyEnv = () => getEnv().then((env) => env.spotify)`, called lazily from
`getClient()` and the token-refresh path — the two places that actually need it. Importing
`spotify.ts` is now side-effect-free. `env.ts`'s `genEnv()` also switched its two sequential
`await`s to `Promise.all`, a minor incidental cleanup in the same diff.

## Tests

13 files, 210 pass / 0 fail, 430 `expect()` calls (`bunx tsc --noEmit` clean). New files added
by this effort:

| File | Covers |
|---|---|
| `promote-plan.test.ts` | Every `promotePlan` triage transition (unheard→liked, liked→confirmed) |
| `demote-plan.test.ts` | `demotePlan` incl. demote-from-Starred short-circuit, demote-from-foreign-playlist |
| `archive-plan.test.ts` | `archivePlan` age-boundary decisions and both reconciliation branches (Inbox membership, liked status) |
| `playback-plan.test.ts` | `processPlaybackHistoryPlan` attribution — context vs. no context, Inbox vs. Current |
| `auto-artist-plan.test.ts` | `autoArtistPlaylistPlan` set math |
| `manual-triage-plan.test.ts` | `manualTriagePlan` backfill for both stages |
| `rule-playlist-pick.test.ts` | Injected `pick` determinism through `randomStarredArtistTracks` |
| `inbox-plan.test.ts` | `inboxPlan` — added in the review pass, see below |
| `undo-plan.test.ts` | `undoPlan` — added in the review pass, see below |
| `action-runner.test.ts` | The runner test called for by Phase 3, see below |

**The runner test closes the gap AGENTS.md flags under "`ListenSequence`'s ordering invariant is
enforced by nothing."** `listen-sequence.test.ts` (pre-existing) drives mutations by hand in a
loop and cannot catch a break in `performAction`'s actual sequencing rules — sets run
sequentially, mutations *within* a set run concurrently via `Promise.all`, and the watermark
mutation is deliberately last. `action-runner.test.ts` drives the real `performActions()` loop
instead: it asserts sets run one after another while mutations inside a set genuinely overlap
(a gate that only opens once both arrive), covers both `MutationFailureMode`s and the `'skip'`
intent end to end, covers the `ThrottleWindow` resolver (including that a settings-derived
window gets the same `Settings` object `perform()` received), and — the AGENTS.md-flagged case —
drives the real `processPlaybackHistoryPlan()` output through the real runner to show the
watermark stops exactly at the last write that landed, not the newest listen. It also includes a
deliberately-red-if-changed test: if the playback plan ever put two listens in one mutation set
(e.g. to chunk it for throughput, the way `ProcessManualTriage`/`ArchiveAction` already chunk
theirs), the watermark can advance past a failed write — the test constructs that scenario by
hand against the real `ListenSequence` to document the trap precisely, not to assert it's fixed.

## Review pass — adversarial review of this branch

A follow-up review found 6 actionable findings against the phases above (1 HIGH pair, counted
as one bug reached two ways; the rest MED). All 6 were fixed; full detail and rationale is in
`changelog/2026-08-05_undo-identity-and-inbox-planner.md`. Summary:

- **Undo now reverses the row's track, not whatever is playing.** `UndoAction.gather` built an
  identity from the stored `action_history` row but `gatherDemote` opened by reading the live
  player and ignored it — so `/undo?action-id=…` (a 24-hour lookback) could remove the
  *currently playing* track instead of the one the row named. Fixed via a new private
  `demoteTarget(client)`: a caller that named a track (`trackID`, i.e. undo replaying a row)
  resolves through `this.track()`; a caller that meant "whatever is playing" (uri-only or no
  identity) falls back to the live player + the existing `__mem_player`/`delay(85)` rescue.
  `gatherPromote` already worked this way; both directions are now symmetric. `playingFrom` is
  gated on the same `trackID` check, since acting on the live player's playlist context for a
  track named by id could silently short-circuit the whole demote if that context is Starred.
- **A demote could land and then fail to record itself.** When the player-read rescue in
  `gatherDemote` found a track the shell's initial identity read had missed, the
  remove/unsave mutations ran and only *then* did `forStorage → getID()` throw on an
  undefined `trackURI` — a completed demote with no `action_history` row, so it could never be
  undone. Fixed: `trackURI` is no longer `readonly`, and `demoteTarget()` adopts what it
  resolves via `this.trackURI ??= currentTrack?.uri` — `??=`, not `=`, so a uri supplied at
  construction (which a throttle check may already have queried on) stays authoritative.
- **`AddPlaylistToInbox` gets a planner and tests** — the last planner-shaped surface in the
  branch with neither. New `inboxPlan(snapshot)` in `add-playlist-to-inbox.ts`; the per-track
  `trackInPlaylist` loop collapses into one Inbox read in `gather`; the uri-regex re-parse (with
  its "everything should be a valid uri" throw) is gone because added tracks now carry `id`
  alongside `uri`.
- **`undo-action.ts`'s `undoPlan`** gets the same treatment as the `track-action.ts` planners:
  the trailing `MarkActionUndoneMutation` set runs only after the reversal it records, so a
  half-failed undo leaves the row unstamped and retryable.
- Corrected a contradictory comment in `promote-plan.test.ts` ("writes the add before the
  remove" implied crash-safety; both mutations are in one set fired as one `Promise.all`, so the
  order is what's serialized into `action_history` for undo, not execution order).

**Still open, deliberately not fixed:**

- AGENTS.md's "Action ids must be stable across invocations" section (Known Issues) lists
  `ProcessManualTriage`, `ScanPlaylistsForInbox`, `ProcessPlaybackHistoryAction`, and
  `UndoAction` as clock-derived; none of them declare a throttle today so nothing is broken, but
  none can grow one without a stable id first. (`SkipToNextTrack` is *not* still clock-derived —
  this same effort gave it the constant id `'skip-to-next-track'`; see Phase 2 above.)
- `ArchiveAction.gatherInbox` returns `{ listing: 'unavailable' }` both when Inbox genuinely
  couldn't be read and when the read was skipped as a deliberate optimization (nothing in the
  rows claims `'inbox'`) — the same value for two situations `InboxEvidence`'s doc comment calls
  opposite. Unobservable today.
- `undoPlan`'s own `if (target.state === 'undone') throw` is unreachable through the production
  path — `UndoAction.gather` already throws on `targetAction.undone` and hardcodes
  `state: 'undoable'` on everything that survives. Only a unit test can exercise the branch.
- `MagicPromoteAction.undo()` / `DemoteAction.undo()` are now dead code — `UndoAction.perform`
  goes through `undoPlan` directly and never calls them.
- `getRandomSlice` in `rule-playlist.ts` remains untested despite the injected `pick`; only
  `getRandomElement` is reached through `randomStarredArtistTracks`.
- Two tests in this effort pin a known-bad behavior as the expected value rather than fixing it:
  `archive-plan.test.ts` asserts an unparseable `added_at` ages a track into a
  `"NaN - undefined"` playlist, and `action-runner.test.ts`'s last test documents (rather than
  fixes) the listen-chunking trap described above. Fixing either will read as a broken test.
- Manual Current → Inbox is still undetected (carried over from the 2026-08-02 track-status
  work): a hand-moved track stays liked, so it stays `'promoted'` while sitting back in Inbox.

## Non-goals confirmed

- No backfill of the mislabeled `'save-track'` history rows from Phase 0.1 — nothing replays
  stored mutation data.
- `settings()` stays async and dev-branched; only its call sites moved into `performAction`.
- `PerformContext` widening was additive throughout — no action broke mid-migration.

## Verification

- `bunx tsc --noEmit` — clean.
- `bun test` — **210 pass / 0 fail**, 430 `expect()` calls, across 13 files (no `dist/` present
  during the run — `bunx tsc` output would otherwise get double-counted by `bun test`).
- No DynamoDB schema change. No migration.
