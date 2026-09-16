# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Overview

This is a Spotify playlist management automation system that runs as an AWS Lambda function. It manages Inbox/Current playlists, archives tracks by month, processes playback history, and supports explicit promote/demote decisions. Current archiving uses per-stage play counts or elapsed time; automatic Inbox removal remains a future transition.

## Common Development Commands

### Typecheck

The deployed Lambda runs on Bun and executes `src/*.ts` directly, so `tsc` is
**not** part of deployment. It is still the typechecker.

```bash
# Typecheck (no emit)
bun run typecheck

# Run the Bun CLI locally
bun run cli <action-name>

# Start local API server with Bun
bun run cli:server

# Re-authorize Spotify and store the new token in DynamoDB
bun run reauth

# Serve the real Lambda handler locally over HTTP (no Lambda, no compile)
bun run src/lambda-bun.ts
```

### Read-only Hono dashboard

`src/web/` serves a dark dashboard at `/`, JavaScript at `/app.js`, and JSON
at `/api/current` and `/api/archived?limit=20` (integer limits 1–20).
The archive feed includes automatic and manual additions still present in
monthly `YYYY - MonthName` playlists, newest Spotify `added_at` first, with
one row per addition. Repeated tracks are intentional. It reads every matching
archive because an older month can receive a new manual addition. It does not
use an action-history Scan or require a new GSI.

The `/api/inbox` feed (`src/web/inbox.ts`) lists the top 20 Inbox tracks in
playlist order (unavailable dropped, then sliced), each with a `likeStatus`
(`'liked' | 'unheard'`, from `tracksAreSaved()` — saved = the operator's Liked
tier) and `playsFromInbox` (`play_count_inbox`). Each row carries its true
Spotify `position` (1-based index in the full playlist, unavailable items still
counted), so dropping an unavailable track leaves a gap in the numbering rather
than renumbering from 1. `gatherInbox` reuses
`archived.ts`'s double-plan trick: plan once to learn the ≤20 ids, then fetch
records + saved status for exactly those (one `containsMySavedTracks` call,
under the 50-id cap) and re-plan. No cache — Inbox is fetched fresh like Current.

`shouldRouteToWeb()` in `src/lambda-bun.ts` gates only HTTP GET requests. Root
requests with any `action` query key, existing action paths, and scheduled
invocations retain the legacy handler. Attached AWS event fields are authoritative.
The UI reads the two APIs sequentially and retries each once; concurrency remains 1.
Archive responses are cached for 12 hours in the user's `archiveDashboardCacheV1`
DynamoDB attribute (development uses `archiveDashboardTestCacheV1`). A cache hit
uses exactly one projected GetItem, with no Spotify/token bootstrap. After expiry,
the next request rebuilds all 20 entries and updates only that cache attribute.
The original `generatedAt` remains visible; Current is fetched fresh every time.
No timer or scheduled cache rebuild is added. Failures are not cached.
The Function URL remains unauthenticated, as specified by the plan.

`listen-stats` shares the Current gather/planner but preserves its original JSON
fields. Null/unresolvable Spotify tracks are omitted. Page loaders are injected
for Hono tests. HTML/JS are lazily read with `Bun.file`; no frontend build is needed.
The local Bun server has a 90-second idle timeout to allow the archive read.

### Local-only tool: `scripts/spotify-folders/`

Moves root-level `YYYY - MonthName` archive playlists into a `History` folder.
**Local-only, never deployed** — top-level `scripts/` is not in `publish.rb`'s
`PAYLOAD` allowlist, so it is never staged into `build/lambda`. It talks to
Spotify's **private** `spclient` rootlist API, which is undocumented,
unversioned, and unsupported — expect it to break without notice.

```bash
# dry run (default) — purely additive: prints the plan to prepend eligible root
# archives to History's front (newest first). Issues NO POST. Never reorders or
# removes anything already there. Unrelated playlists and legacy-named archives
# in History are expected and left untouched.
bun run scripts/spotify-folders/move-archives-to-folder.ts

# apply — performs the writes. No confirmation prompt: it applies the plan it
# prints. Backs up live state before the first write, then converges.
bun run scripts/spotify-folders/move-archives-to-folder.ts --apply

# typecheck the tool (it lives outside the root tsconfig's rootDir)
bunx tsc -p scripts/spotify-folders/tsconfig.json
```

**Monthly operator steps** (credential capture → dry run → apply → verify →
recovery) are in `docs/monthly-archive-runbook.md`.

As of 2026-08-05 the tool tolerates unrelated History content by default; the
old `--tolerate-unrelated-history` flag is gone. See "Revision 5 — additive
prepend model" in `docs/archive-to-history-folder-plan.md`.

`--apply` **performs writes** (as of 2026-08-06). The default (no flag) is still
a dry run that issues no POST. There is **no confirmation prompt** — `--apply`
runs the plan it prints. The `rootlist/changes` protocol it speaks was
transcribed from two real DevTools captures (see `docs/rootlist-capture.md §9`);
it sends one `MOV` per POST, anchoring each archive to History's **id-only**
start-group marker, and carries no `baseRevision`.

Write-path safety, and how to stop it:

- **Backup before the first POST** — a credential-free snapshot + plan is written
  to `~/Library/Application Support/spotify-playlist/rootlist-backups/<timestamp>.json`
  (path is printed).
- **Recovery is re-running the command.** The loop recomputes from a fresh read
  every iteration, so a partial run is intermediate, not corrupt — re-run to
  converge. The backup is manual-restore evidence; there is no `--restore`.
- `WRITE_MODE` in `scripts/spotify-folders/rootlist.ts` is the **kill switch**:
  set it back to `'disabled'` and every write path throws before building a
  request (`authorizeWrites()` returns `null`, `postRootlistChanges()` refuses as
  its first statement).
- **Verified only in dry-run so far** — the first real `--apply` will be the
  first live write. `spclient.wg.spotify.com` remains unofficial and unversioned;
  it can break at any time.

Three environment values, two of them short-lived secrets:

| Value | Secret? | Notes |
|---|---|---|
| `SPOTIFY_SPCLIENT_TOKEN` | **yes** | web-player bearer, without the `Bearer ` prefix. ~1 hour lifetime |
| `SPOTIFY_CLIENT_TOKEN` | **yes** | anti-abuse `client-token` header value |
| `SPOTIFY_USER_ID` | no | the user id embedded in the rootlist path |

**Export the two secrets into an ephemeral shell — never into `.env`.** A
`SessionStart` hook in `~/.claude/settings.json` auto-loads any `.env` in this
directory into every future agent session, so a bearer pasted there stops
being a one-hour secret. `SPOTIFY_USER_ID` is not a credential and may live in
`.env` safely. The tool has no `dotenv` call — Bun loads `.env` natively — so
there is nothing to configure either way.

Capture instructions (DevTools ritual, plus a documented but fragile
terminal-only token mint), the full proven wire contract, and the live
account's precondition failures are all in `docs/rootlist-capture.md`.

`tsconfig.json`'s `exclude` now lists `"scripts"` so that a `.ts` file under
top-level `scripts/` cannot break `bun run typecheck` with TS6059
(`rootDir` is `./src`, and the file has no `include`, so it falls back to
`**/*` by default). The tool has its own `scripts/spotify-folders/tsconfig.json`
for its local typecheck target; this line is confirmed inert — it does not
change which files the root `bun run typecheck` compiles.

### Deployment

```bash
# Deploy to AWS Lambda
ruby scripts/publish.rb
```

The function runs on the **Bun custom-runtime layer**, not a managed Node
runtime: `provided.al2023` / `arm64` / handler `src/lambda-bun.fetch` / layer
`arn:aws:lambda:us-east-1:495671805917:layer:bun:2` (Bun v1.3.14). `publish.rb`
asserts all of that on every deploy, stages the package in `build/lambda`, and
installs production dependencies only.

Two things to know before changing anything here:

- **Memory cannot go back to 128MB.** Bun's baseline is much heavier than
  Node's — the read-only `user` action peaks at 115MB, and a full
  `frequent-crawling` run peaks at 289MB. The function is set to 512MB.
- **X-Ray subsegments are off under Bun** and this is deliberate, not broken.
  The X-Ray SDK packages are not installed; Lambda service-level tracing remains
  controlled by `TracingConfig`.

### Local Development

```bash
# Start local DynamoDB (required for local development with NODE_ENV=development)
java -Djava.library.path=./dynamodb_local_latest/DynamoDBLocal_lib -jar dynamodb_local_latest/DynamoDBLocal.jar -sharedDb

# Run specific actions locally via CLI
# Available actions: promote, demote, archive, playback, auto-inbox, undo, undo-last,
#                    rule-playlist, sync-liked-songs, liked-songs-stats, clear-liked-cache,
#                    listen-stats
bun run cli <action-name>

# Examples:
bun run cli promote    # Promote current track
bun run cli demote     # Demote current track
bun run cli archive    # Archive old tracks
bun run cli undo-last  # Undo last promote/demote action
```

## Architecture

### Action-Mutation Pattern

The codebase follows a two-layer architecture:

1. **Actions** (`src/actions/`) - High-level business logic that orchestrates operations. Each action:
   - Implements the `Action` interface with `getID()`, `perform()`, and optional `forStorage()` methods
   - Returns an array of mutation arrays (mutation sets) to be executed
   - Supports throttling via `idThrottleMs` to prevent duplicate operations
   - Can implement `undo()` method for reversible actions (like promote/demote)
   - Stores action history in DynamoDB for tracking and undo functionality

2. **Mutations** (`src/mutations/`) - Atomic state changes that:
   - Extend the base `Mutation` class
   - Implement `mutate()` for the actual state change (Spotify API calls)
   - Track completion state (pending → running → success/error)
   - Are executed in sequence with automatic error handling
   - Store mutation data that can be serialized to DynamoDB

### Core Components

**Runtime Adapter** (`src/lambda-bun.ts`):

- The Bun layer never passes a Lambda event to the handler — it turns every
  invocation into a `Request` and expects a `Response` back. This file
  translates both ways so `src/index.ts` keeps its `APIGatewayProxyHandler`
  shape
- **The request body is not the event.** For non-HTTP events (the EventBridge
  `frequent-crawling` trigger) the body is a `{requestId, traceId, functionArn,
  deadlineMs, event}` wrapper; the real event hangs off the request as `.aws`
- Responses default to `Content-Type: application/json` because the layer
  base64-encodes anything that is not `text/*` or `application/json`
- Because the export is a Bun server object, `bun run src/lambda-bun.ts` serves
  the handler locally with no Lambda involved

**Spotify Integration** (`src/spotify.ts`):

- Wraps the Spotify Web API with caching and automatic token refresh
- Uses `@asyncMemoize` decorator to cache API responses and reduce API calls
- Provides high-level operations like `getTrackFromPlaylist()`, `moveTrack()`, etc.
- Implements progressive backoff retry logic for rate limiting and timeouts
- OAuth token management stored in DynamoDB with automatic refresh

**Database Layer** (`src/db/dynamo.ts`):

- DynamoDB integration with multi-tenant support (user partition keys via `gId()` method)
- Uses AWS SDK v3 with command pattern (`send(new QueryCommand(...))`)
- Tables:
  - `users` - User settings and OAuth tokens
  - `action_history` - History of all actions with mutations for undo support
  - `track_metadata` - Track listen counts and metadata
  - `liked_songs` and `liked_songs_metadata` - Cached Spotify liked songs
- Supports local DynamoDB for development (when NODE_ENV=development)

### Track Triage Workflow

This section describes the intended product workflow. Keep the distinction
between **current implementation** and **desired behavior** explicit when
changing it; do not silently turn a future rule into a claim about production.

#### Concepts that must not be conflated

- The user-facing progression is `Unheard → Liked → Current → Archived`,
  with `Removed` as an exit from triage.
- Spotify playlist/library state is the source of operational truth:
  - **Unheard** — in Inbox, not in Current, not saved.
  - **Liked** — in Inbox, not in Current, saved.
  - **Current** (also called confirmed/promoted in older code) — not in Inbox,
    in Current, saved.
  - **Archived** — moved out of Current into the monthly archive and normally
    still saved.
  - **Removed** — no longer in the active triage flow. Whether an automatic
    Inbox removal should preserve a manually saved/liked track is still TBD.
- `TrackStatus` is the denormalized DynamoDB lifecycle view:
  `'inbox' | 'promoted' | 'removed'`. Archived tracks currently remain
  `'promoted'`; whether Archived eventually gets its own status is TBD.
- `TriageStage` is only playback attribution: `'inbox' | 'current'`. It answers
  where a listen started, not the track's lifecycle status.
- `play_count_inbox` and `play_count_current` are cumulative counters. They are
  incremented only when Spotify's playback context is the corresponding
  playlist. A play from Liked Songs, Search, an album, or contextless autoplay
  increments `play_count` only, even if the track belongs to Inbox or Current.

#### Operator's star-rating mental model

The user's own organizational system layers a star rating on top of the
lifecycle above. It is how the operator *thinks about* the library, not a field
stored in DynamoDB:

- **Liked = 3 stars** — a saved track (the `Liked` lifecycle state / Spotify's
  saved-track library).
- **starred = 4 stars** — a **playlist**. Membership here is the 4-star tier.
- **all time = 5 stars** — a **playlist**. Membership here is the 5-star tier.
- **1–2 stars = the `Removed` state** — the operator does not want to hear these
  again and they carry no curated tier. This is the *intent* behind
  Demote/`Removed`. Mind the tracking distinction: the system still keeps a
  `status: 'removed'` row as a tombstone so `ScanPlaylistsForInbox` won't
  re-import the track from Discover Weekly / Release Radar. "Not worth tracking"
  is about curation, not about deleting the dedup record.

`starred` and `all time` are real Spotify playlists, so a track's star rating is
read from playlist membership, not from `TrackStatus` or `triage_actions`. The
lowercase `starred` here is the operator's playlist and the same one the code's
`Starred` special-casing (`demoteTrack()`, `RulePlaylistAction`) refers to; do
not conflate the star rating with the lifecycle `status`.

#### Entry and explicit triage

- `ScanPlaylistsForInbox` checks Discover Weekly and Release Radar. A track with
  no existing DynamoDB row is added to Inbox and gets an `'inboxed'` triage
  action / `status: 'inbox'`.
- Promote is a two-step positive decision:
  1. Unheard → Liked saves the track and leaves it in Inbox.
  2. Liked → Current adds it to Current, removes it from Inbox, keeps it
     saved, and records `'promote'` / `status: 'promoted'`.
- The existing Demote action is an explicit rejection: it removes the track
  from Inbox and Current, normally unsaves it, and records `'remove'` /
  `status: 'removed'`. Starred has special handling; inspect `demoteTrack()`
  before changing its semantics.
- Promote and Demote are undoable for a short window through `action_history`.
  Manual Spotify edits and maintenance reconciliation do not currently have the
  same undo path.

#### Playback-driven transitions: desired behavior

- A track repeatedly played from **Inbox** without being promoted is an
  implicit negative decision. After it has been listened to enough in Inbox,
  the workflow should support Inbox → Removed automatically.
- A track repeatedly played from **Current** has completed its active rotation.
  After it has been listened to enough in Current, the workflow should support
  Current → Archived automatically.
- The Current archive threshold is now 5 Current-context plays in production,
  as configured in `settings.ts` and deployed on 2026-09-16. The automatic Inbox
  removal threshold remains unspecified; do not invent it.
- It is also still TBD whether Inbox → Removed applies only to unliked tracks
  or can remove a track that was manually saved while still in Inbox.
- Current production behavior (deployed 2026-09-16): `ArchiveAction` moves a
  track after more than 45 days in Current OR at least 5 Current-context plays.
  Age uses the Current playlist item's `added_at`; the destination month is
  still based on that date. Development uses 1 day OR 2 Current-context plays.
- Manual-triage backfills use `increment_by: 0`. Playlist placement is evidence
  of a lifecycle transition, never evidence that a listen happened; no manual
  move may synthesize, transfer, or reset play counts.

#### Manual equivalence and reconciliation: desired invariant

Every automatic transition must also be available as a deliberate manual
transition. Whether initiated through an action endpoint or by editing Spotify
directly, reconciliation should rectify the whole state: playlist membership,
saved/liked state where the transition defines it, the triage log, and the
denormalized DynamoDB status. It must not merely notice a playlist membership
change while leaving contradictory state elsewhere.

In particular, future reconciliation must handle repeated and reverse
transitions, not ask only whether a track has *ever* had a matching action.
Re-adding a removed track, moving Current back to Inbox, manually moving Inbox
to Current, and manually requesting Current → Archived or Inbox → Removed
must converge on the same result as their automatic equivalents. Exact saved
state for the still-TBD Inbox removal rule must be settled before implementing
that transition.

Current `ProcessManualTriage` is narrower than this desired invariant:

- It observes Inbox and Current membership and backfills `'inboxed'` or
  `'promote'` only when that action type has never appeared for the track.
- It uses the playlist item's `added_at` as the action time and may establish
  `first_seen`, but it writes `increment_by: 0` and never counts a listen.
- It does not move tracks, save/unsave them, skip playback, or archive them.
- Manual Inbox → Current is usually detected, but Current → Inbox and
  re-entry after removal can be missed because the historical action already
  exists. Treat these as implementation gaps, not desired behavior.
- `ArchiveAction` currently reconciles an `'inbox'` row against Inbox membership
  and a `'promoted'` row against liked status. Absence from Current alone is not
  removal because archived and Starred tracks legitimately leave Current.
- A reconciliation-only disappearance sets `status: 'removed'` without adding
  a `'remove'` triage action, preserving the distinction from explicit Demote.

#### Recurring production workflow

The confirmed live recurring caller is EventBridge rule `Archive-Trigger`; it
invokes `frequent-crawling` every six hours. Re-check AWS before changing the
schedule or target, and keep the action order deliberate:

1. `ProcessPlaybackHistoryAction` records new plays and advances the playback
   watermark. It runs first so later transition decisions can see this run's
   counts.
2. `ArchiveAction` applies the current time-based archive rule and reconciles
   live statuses.
3. `ProcessManualTriage` backfills changes made directly in Spotify.
4. `ScanPlaylistsForInbox` imports unseen Discover Weekly / Release Radar
   tracks.
5. `RulePlaylistAction` rebuilds the Smart Playlist from Starred and saved-track
   data; it does not consume triage status.

The standalone `playback` action runs playback-history processing followed by
manual-triage backfill. The EventBridge target payload selects
`action=frequent-crawling`; changing the action name or event adapter without
updating that target breaks scheduled maintenance.

#### Checklist for workflow changes

Before changing a lifecycle transition, status mapping, or stage listen count,
trace all of these paths together:

- the explicit Promote, Demote, Undo, and future manual-transition actions;
- direct Spotify edits observed by `ProcessManualTriage` and `ArchiveAction`;
- playback attribution and watermark ordering;
- the six-hour `frequent-crawling` action order;
- playlist membership, saved/liked state, `triage_actions`, `status`, and action
  history after both the automatic and manual form of the transition.

A workflow change is incomplete if only the main action works while the manual
reconciliation path leaves the track in a contradictory state.

### Key Actions

- `actionForPlaylist()` - Routes playlist-specific actions based on playlist name/type
- `MagicPromoteAction` - Advances the current track from Unheard → Liked or Liked → Current
- `DemoteAction` - Explicitly rejects the current track, removing it from active triage rather than stepping back one stage
- `ProcessPlaybackHistoryAction` - Processes Spotify listening history and updates track metadata
- `ProcessManualTriage` - Backfills lifecycle metadata for direct Spotify playlist edits; it records no listens and does not perform the full transition
- `AddPlaylistToInbox` - Adds new tracks from source playlists to inbox
- `ArchiveAction` - Moves aged Current tracks into playlists such as `2026 - July` and reconciles live statuses
- `RulePlaylistAction` - Creates smart playlists based on rules (e.g., starred tracks)
- `UndoAction` - Reverses previous promote/demote actions
- `SkipToNextTrack` - Skips to next track in current playback

### Important Patterns

1. **Action Throttling**: Actions use `idThrottleMs` to prevent duplicate operations (e.g., 5 minutes for promote/demote)
2. **Memoization with Decorators**: `@asyncMemoize` decorator caches method results with `.reset()` method to clear cache
3. **Mutation Sets**: Actions return arrays of mutation arrays. Sets execute sequentially; mutations within one set execute concurrently via `Promise.all`
4. **Error Handling**: Comprehensive error handling with detailed logging; special handling for token expiration (401 errors)
5. **User Context**: Multi-tenant support with user-specific settings and data; currently hardcoded to 'koalemos' user
6. **Undo Support**: Actions can implement `undo()` to reverse their operations (tracked in DynamoDB)

## Development Tips

- The `-run-this-first.ts` file initializes global variables (like `dev`, `minutes`, `hours`)
- Run migrations in `src/migrations/` to set up DynamoDB tables for local development
- Lambda service-level X-Ray tracing remains active, but the Bun runtime does not create HTTP or DynamoDB subsegments
- Settings are managed per-user in DynamoDB, not in config files
- To reset memoized caches, use `(method as any).reset()` on decorated methods
- The Lambda handler in `src/index.ts` routes requests to action handlers based on the path, path parameters, or `action` query parameter
- Environment variables are loaded from `.env` file (not committed to git)

## Known Issues

Latent traps that are **not** visible from the code they affect. Kept here rather
than in a dated changelog entry so they don't scroll out of sight.

### Action ids must be stable across invocations

The throttle check in `performAction` (`src/actions/action.ts`) calls
`dynamo.getActionHistory(await action.getID(), since)`, an **exact-match
`KeyConditionExpression` on that id**. An id minted from the clock can never
match a stored one, so the lookup always misses and `idThrottleMs` is decorative.

- `getID()` must be a pure function of constructor data. `MagicPromoteAction`
  keys on the track uri, `ArchiveAction` on `archive:<YYYY-MM>`.
- Recurring rows are not a reason to reach for a fresh id: `action_history` is
  keyed `(id HASH, created_at RANGE)` (`config/dynamo-tables/action-history.json`),
  so repeated runs under one id still write their own rows and keep their own
  `ttl`. Freshness is the throttle window's job, not the id's.
- Several ids are still clock-derived — `ProcessManualTriage`,
  `ScanPlaylistsForInbox`, `ProcessPlaybackHistoryAction`, `SkipToNextTrack`,
  `UndoAction`. None of them declare a throttle, so nothing is broken today, but
  none of them can grow one without changing the id first.

### `ListenSequence`'s ordering invariant is enforced by nothing

The watermark is only correct if the playback pass keeps **one listen per
mutation set, ascending by `played_at`, watermark set last**. That is stated in a
comment in `ProcessPlaybackHistoryAction` and nowhere else.

`performAction` runs mutation _sets_ sequentially but fires everything **within**
a set as one `Promise.all`. So chunking the playback path for throughput — the
way `ProcessManualTriage` and `ArchiveAction` already do via
`DYNAMO_WRITE_CHUNK` — would silently let the watermark advance past a failed
write, and re-count those listens on the next run. `src/__tests__/listen-sequence.test.ts`
would not catch it: it drives mutations by hand in a loop rather than through the
real runner.

The durable fix is to move "which sets still run after an earlier failure" into
`performAction`, or to make the listen write idempotent
(`ConditionExpression` on `last_seen.played_at`) so ordering stops being
load-bearing at all.

## Changelog

### 2026-09-04 - `track` Sparse Status GSI + 5 RCU

- The `ArchiveAction` reconciliation sweep (`Dynamo.tracksWithLiveStatus`) no
  longer scans `track`. It queries the new sparse GSI **`status-id-index`**
  (HASH `status`, RANGE `id`, KEYS_ONLY) once per live status. Only rows with a
  `status` attribute exist in the index, so the read is ~1 RCU instead of ~283
- Why: the scan throttled **every** 6-hourly run at 1 provisioned RCU
  (370 RCU needed vs. a 300-RCU burst bucket) and about one run in four died in
  retry backoff against the 80 s Lambda timeout. Dollar cost was never the
  problem — everything is inside the free tier
- Live changes applied with `update-table`: `track` reads 1 → 5 RCU and the
  GSI created at 1/1. Verified after backfill: 62 `inbox` + 6 `promoted` rows
  for 1 RCU. `config/dynamo-tables/track.json` now exists and carries both
- New exports `TRACK_STATUS_INDEX`, `LIVE_TRACK_STATUSES`, `liveStatusQuery`;
  new `dynamo-live-status.test.ts` (7 tests). 584 pass / 0 fail
- **Not deployed yet** — the Lambda runs the scan until `publish.rb` ships this
- See `changelog/2026-09-04_track-status-gsi.md`

### 2026-08-06 - Close Tier 1 Test-Coverage Gaps

- A two-agent coverage audit read the mock-free suite (210 tests / 13 files) against
  the production code it claims to pin and ranked gaps by how quietly a regression
  would ship. **Tier 1** = a plausible one-line change the green suite would not
  catch. This wave closes every Tier 1 gap raised
- 16 gaps closed, one test each: `undoDirectionFor`'s promote/demote direction;
  `archivePeriod` and `buildArchiveNamer`'s local-vs-UTC month bucketing;
  `ArchiveAction.getID()` stability; `forStorage`'s `ttl` (seconds vs. ms, and the
  empty-mutations branch); `idsIn`'s id-less-entry admission; `performActions`
  sequential-set ordering; `MarkActionUndoneMutation.mutate`'s Dynamo call;
  `ProcessManualTriage`'s backfill when `triage_actions` is entirely absent;
  `isCurrentlyPlayingInTriage`'s Current-membership and type-guard branches;
  `actionForPlaylist`'s trailing-vs-anywhere `[A]` regex; `getRandomSlice`'s
  candidate-window math and `rulePlaylistPlan`'s empty-then-fill set boundary;
  `noRemixes`/`noLive` case-insensitivity; `normalizeActionError`'s 400 ladder and
  `actionNameFromEvent`'s source precedence; `trackToData`'s projection
- Two audit findings didn't hold up: `noRemixes`/`noLive`/`onlyOriginals` have zero
  production callers (pre-existing, not a regression — the new tests pin functions
  nothing currently calls) and the `undoneMembership` dead-code premise was moot —
  it doesn't exist anywhere in `src/`
- Production changes stayed inside the sanctioned set: `export` added to
  `isCurrentlyPlayingInTriage`, `noRemixes`/`noLive`/`onlyOriginals`,
  `undoDirectionFor`, and `idsIn`/`archivePeriod`; the assigned extraction pulled
  `rule-playlist.ts`'s `perform()` apart into an exported `rulePlaylistPlan`
  planner plus an exported, `pick`-injected `getRandomSlice`; `src/index.ts`'s
  inline error ladder became an exported `normalizeActionError()` alongside
  `export` on `afterCurrentTrack`/`doAfterCurrentTrack`/`actionNameFromEvent`; and
  an unused `trackToData` import was dropped from `remove-track-mutation.ts`. No
  behavior changed
- Six new test files (`action-for-playlist`, `actionable-type`, `archive-id`,
  `handler-routing`, `inbox-track-filters`, `track-data`); the rest of the gaps
  extended files the prior wave already created
- **210 → 351 tests, 13 → 19 files, 608 `expect()` calls, 0 failures**, `tsc`
  clean, no `dist/` left behind. Every Tier 1 fix was confirmed by mutation
  testing (19 hand-applied regressions, 19 caught, 0 escaped), and the full suite
  ran clean under four timezones (`UTC`, `Pacific/Auckland`, `Asia/Kolkata`,
  `America/New_York`), not just the two the archive tests pin against
- See `changelog/2026-08-06_close-tier1-test-gaps.md`

### 2026-08-06 - History-Folder Tool: `--apply` Enabled

- `--apply` now **performs writes** on the local-only `scripts/spotify-folders/` tool; the default (no flag) is still a dry run that issues no POST, and there is no confirmation prompt
- The `rootlist/changes` protocol was **transcribed from two real DevTools captures** (URI-anchored `MOV`, **id-only** `spotify:start-group:<folderId>` anchor with the name stripped, no `baseRevision`); the tool sends one `MOV` per POST and converges by re-reading live state
- Safety: credential-free backup before the first POST, per-iteration re-read (no blind replay), 401/403 fatal, stall + runaway bounds. `WRITE_MODE = 'enabled'` in `rootlist.ts` is the defence-in-depth kill switch; re-running is the recovery path
- Verified only in dry-run — the first real `--apply` will be the first live write
- See "Local-only tool: `scripts/spotify-folders/`" above and `changelog/2026-08-06_history-folder-enable-apply.md`

### 2026-08-04 - Archive-to-History Folder Tool (Read-Only)

- New local-only CLI under `scripts/spotify-folders/` reads Spotify's private `spclient` rootlist API and reports which root-level archive playlists would move into a `History` folder. Never deployed (`scripts/` is outside `publish.rb`'s `PAYLOAD` allowlist) and read-only by construction: `--apply` is hard-disabled and no write has ever been issued
- See "Local-only tool: `scripts/spotify-folders/`" above for invocation, credentials, and the disabled-write gate
- See `changelog/2026-08-04_archive-to-history-folder-read-only.md` for the live dry-run findings against the real account and what remains before writes can be enabled

### 2026-08-04 - Bun on Lambda

- The function moved off the managed Node runtime onto a **Bun custom-runtime layer**: `nodejs20.x` / `x86_64` / `dist/index.handler` → `provided.al2023` / `arm64` / `src/lambda-bun.fetch`, layer `arn:aws:lambda:us-east-1:495671805917:layer:bun:2` (Bun v1.3.14, built from `oven-sh/bun` `packages/bun-lambda` — the standalone `oven-sh/bun-lambda` repo no longer exists)
- **No `tsc` in the deploy path.** Bun runs `src/*.ts` directly; the duplicate compiled Node CLI and `dist/` path are gone. `bun run typecheck` remains the typechecker
- New `src/lambda-bun.ts` adapts the layer's `Request`/`Response` contract onto the existing `APIGatewayProxyHandler`. **No action or mutation code changed.** Its two non-obvious contracts (the event lives on `.aws`, not in the body; Content-Type decides base64) are documented in Core Components above
- **Memory 128MB → 512MB, forced.** The read-only `user` action peaks at 115MB on Bun; a full `frequent-crawling` run peaks at 289MB. This is not tunable back down
- **X-Ray subsegments are deliberately off under Bun** — `_X_AMZN_TRACE_ID` is set by the layer per invocation, after module initialization, so the old module-scope capture could never run. The unused X-Ray SDK packages and branches are gone. Service-level traces still record; `TracingConfig` is still `Active` and could be dropped to `PassThrough`
- Direct dependencies were reduced from 22 to 8: the Bun CLI replaced the duplicate Node/`lambda-local` path, dead pre-Lambda Spotify modules were removed, and small native helpers replaced Lodash
- `scripts/publish.rb` rewritten: stages into `build/lambda`, production-only install, prunes tests/scripts/migrations, and asserts runtime + handler + arch + layer + memory on every deploy instead of trusting console state
- Verified live on all three invoke paths (EventBridge with the exact `Archive-Trigger` payload — 5/5 actions `success`; Function URL over HTTPS; API Gateway proxy v1). The dependency cleanup passes 58 tests
- Pre-change code zip + config were snapshotted; rollback commands are in the changelog entry
- See `changelog/2026-08-04_bun-on-lambda.md`

### 2026-08-04 - Action Testability: Pure Planners, Foundation Seams, and Four Bugfixes

- **`perform()` is now a pure planner for eight actions.** Each gets a `gather(ctx)` shell (I/O)
  and an exported `xPlan(snapshot)` (pure, the unit-test target): `promotePlan`/`demotePlan`,
  `processPlaybackHistoryPlan`, `autoArtistPlaylistPlan`, `manualTriagePlan`, `archivePlan`,
  `inboxPlan`, `undoPlan`. `RulePlaylistAction` instead gets an injected `pick` in place of two
  `Math.random()` sites; `SkipToNextTrack` now goes through a real `SkipToNextTrackMutation`
  instead of mutating inline and returning `[]`
- New `PerformContext = { client, dynamo, now, settings }` replaces the old `{ dynamo }`
  perform signature; `idThrottleMs` widens to accept `(settings) => number` so throttle windows
  that depend on dev/prod stop reading the ambient `dev` global directly. Ambient `dev`/
  `minutes`/`hours`/`days` reads are gone from `src/actions/` field initializers, which used to
  throw `ReferenceError` when constructing an action outside the Lambda bootstrap
- **`ArchiveAction`'s dead throttle is revived.** `getID()` was `` `archive:${this.created_at}` ``
  — a fresh id every run, so the exact-match throttle lookup could never find a previous pass.
  Now `` `archive:<YYYY-MM>` ``; `action_history`'s `(id, created_at)` key means the stable id
  does not collide runs against each other
- Four standalone bugs fixed: `UnsaveTrackMutation` recorded itself as `'save-track'` (no
  backfill of already-stored rows — nothing replays them); missing `await`s in save/unsave
  `mutate()` let a failed Spotify call report `'success'`; `TriageActionMutation` stamped
  `action_at` from the clock at execution time instead of plan time; `ScanPlaylistsForInbox`'s
  constructor fired unawaited I/O that `perform()` could race
- `action_history` rows for save-track/unsave-track/triage-action mutations coming out of
  promote/demote now store the trimmed `BasicTrackData` (5 fields) instead of the full
  `spotify-web-api-node` `Track` blob that was landing there incidentally — TS only declared
  `{ id }` but JS doesn't strip the rest
- `spotify.ts` no longer resolves environment config at module-evaluation time — importing it
  (for its types alone, which every gather shell does) used to create a floating, possibly-
  rejected promise before any test ran
- New test suite: `promote-plan`, `demote-plan`, `archive-plan`, `playback-plan`,
  `auto-artist-plan`, `manual-triage-plan`, `rule-playlist-pick`, `inbox-plan`, `undo-plan`, and
  `action-runner` — the last drives real `performActions()` end to end and is what closes the
  gap flagged above under "`ListenSequence`'s ordering invariant is enforced by nothing." 210
  pass / 0 fail, `tsc` clean
- A follow-up review found and fixed 6 more issues on top of this — most notably, undo was
  reversing whatever track was currently playing instead of the one named in the
  `action_history` row it was replaying — see `changelog/2026-08-05_undo-identity-and-inbox-planner.md`
- Still open: several action ids remain clock-derived (harmless today, since none of them
  declare a throttle); manual Current → Inbox is still undetected; see the changelog for the
  full list
- See `changelog/2026-08-04_action-testability-and-bugfixes.md`

### 2026-08-02 - Adversarial-Review Fixes (High Priority)

- **Listen writes are counted exactly once again.** A single failed listen write used to abort the action before the (deliberately last) watermark mutation ran, so every listen already written that pass was re-counted on the next run, and every run after, until the failure cleared. A run-scoped `ListenSequence` now advances the watermark only across an unbroken prefix of successful writes and skips the rest of the batch after a failure — the tail is deferred to the next run, which is what the watermark is for
- Supporting: `MutationFailureMode = 'abort-action' | 'record-and-continue'` (default `'abort-action'`, unchanged for every existing mutation) and `MutationIntent = 'run' | 'skip'` plus a `'skipped'` completion state, both on the `Mutation` base class
- **`'promoted'` rows now reconcile against liked status, not Current membership.** Reaching Current always implies the track was saved, and it leaves Current legitimately (archived, or hand-moved to Starred) — being unliked is what actually marks it dropped. `'inbox'` rows still reconcile against Inbox membership; `null` status still means unknown
- That deleted `archivedTrackIds()` and the per-run walk over every archive playlist. `isArchivePlaylistName` is off the settings object; `buildArchiveMatcher` stays exported as a test oracle
- **`buildMyFn` → `buildArchiveNamer`**, exported, and no longer normalizing onto its captured `prefix` — each call used to append another space, forking a dev archive playlist per aged track and then marking those tracks `'removed'`. Round-trip tests now feed the namer's real repeated output into the matcher
- **A missing Inbox or Current no longer kills the whole pass** — both paths use `optionalPlaylist` and skip only the half that lost its evidence. Skipping marks nothing removed
- **`getTracks()` retries `UnprocessedKeys`** and throws rather than reporting unread keys as missing rows — `ProcessManualTriage` reads "no row" as "never triaged" and would write a spurious `'promote'`. Unbounded mutation sets in `ProcessManualTriage` and the reconciliation sweep are chunked into sequential sets of 25
- Still open: manual Current → Inbox remains undetected (a hand-moved track stays liked, so it stays `'promoted'`), and findings #6–#13 from the handoff are untouched
- See `changelog/2026-08-02_adversarial-review-high-priority-fixes.md`

### 2026-08-02 - Track Status Field + Manual-Change Detection

- Added `status: 'inbox' | 'promoted' | 'removed'` and `status_changed_at` to `TrackItem`, denormalizing the triage lifecycle out of the `triage_actions` log
- Archiving does **not** change status — a track filed into `2026 - July` stays `'promoted'`
- `null`/missing means **unknown** and must never be defaulted to a state; no backfill was run
- Maintained by `STATUS_BY_TRIAGE_ACTION` in both write paths within the same `UpdateCommand` as the log append, so it cannot drift and costs no extra write. `'upvote'` is status-neutral by necessity — `promoteTrack()` pushes it last on every promote and it would otherwise clobber `'promoted'`
- `ArchiveAction` now also detects manual changes: any row claiming `'inbox'`/`'promoted'` present in neither playlist is marked `'removed'`, after excluding tracks found in archive playlists (`isArchivePlaylistName` in `settings.ts`, tested) — **superseded 2026-08-02**, see above: `'promoted'` reconciles on liked status and the archive exclusion is gone
- The sweep sets `status` only and never appends a triage action, so an explicit demote (has a `'remove'` entry) stays distinguishable from a silent disappearance
- Costs: the reconciliation scan is a full table scan (still true, still deferred). Now `Dynamo.tracksWithLiveStatus()` — filtered and projected, but still a scan. The archive-exclusion walk is gone as of 2026-08-02
- **Known gap:** manual Inbox → Current _is_ caught (the Current backfill filters on `'promote'`, which a hand-dragged track lacks), but manual Current → Inbox is **not** (the Inbox backfill filters on `'inboxed'`, which a returning track already has) — status stays `'promoted'` while the track sits in Inbox. Both are `ProcessManualTriage.backfillStage()`. Deliberately deferred; see the changelog
- See `changelog/2026-08-02_track-status-field.md`

### 2026-08-01 - Per-Stage Listen Counts

- Added `play_count_inbox` / `play_count_current` to the `track` table alongside the existing global `play_count`, keyed off a new `TriageStage = 'inbox' | 'current'` union
- `ProcessPlaybackHistoryAction` attributes each played item by matching Spotify's playback `context.uri` against the Inbox/Current playlists; plays with no playlist context still bump `play_count` only
- Counters are cumulative and never reset on promote/demote; both cost one write via a second clause on the same `UpdateCommand`
- New `listen-stats` action/CLI command reports play counts and days-in-Current per track
- **Archiving still gates on `timeToArchive` only** — this change just starts collecting the data
- Fixed along the way: the `context`→`seen` key mismatch that meant playback never wrote `first_seen`/`last_seen`, two un-awaited Dynamo writes, `getTracks()` throwing on an all-miss batch, `performCurrent()` discarding its mutations, and the `frequent-crawling` action ordering
- See `changelog/2026-08-01_per-stage-listen-counts.md`

### 2026-07-25 - Remove Web Frontend

- Excised the React web frontend entirely: deleted `web/`, `src/web-api.ts` (all `/api/*` endpoints), `src/local-server.ts`, and `dev.sh`
- The Lambda handler now serves only action endpoints — no more `/api/*` routing, static file serving, or SPA fallback
- Removed `dev`, `dev:api`, and `dev:web` npm scripts and the `concurrently` dependency
- `scripts/publish.rb` no longer builds a React app before packaging the Lambda zip

### 2025-07-03 - Implement Undo Functionality for Promote/Demote Actions

- Added undo support for track triage operations (promote and demote):
  - Added `undo()` method to `DemoteAction` class that calls `promoteTrack()` to reverse the demotion
  - Created new `UndoAction` class that retrieves previous actions from history and executes their undo methods
  - Supports undoing by specific action ID or finding the most recent promote/demote action
  - Configurable lookback window (defaults to 5 minutes for recent actions, 24 hours for specific IDs)
- Enhanced DynamoDB integration for undo support:
  - Added `getRecentActionsOfType()` to query recent actions by type with filtering for undone actions
  - Added `markActionAsUndone()` to track which actions have been undone
  - Extended `ActionHistoryItemData` type with `undone`, `undone_at`, and `originalActionId` fields
- Added Lambda handler routes:
  - `/undo` - Undo a specific action with optional `action-id` and `action-type` query parameters
  - `/undo-last` - Undo the most recent promote or demote action
- Extended CLI with new commands:
  - `bun run cli undo` - Undo operations via CLI
  - `bun run cli undo-last` - Undo the most recent action
- Note: Currently requires a DynamoDB GSI named 'user-action-index' for the `getRecentActionsOfType` query to work properly

### 2025-01-06 - Progressive Backoff for Spotify API Calls

- Added retry utility with exponential backoff to handle timeouts and rate limits
- Updated `mySavedTracks` method to use progressive backoff strategy:
  - Initial delay: 2 seconds (configurable via SPOTIFY_RETRY_INITIAL_DELAY)
  - Max delay: 2 minutes (configurable via SPOTIFY_RETRY_MAX_DELAY)
  - Backoff multiplier: 2.5x (configurable via SPOTIFY_RETRY_BACKOFF_MULTIPLIER)
  - Max retries: 5 (configurable via SPOTIFY_RETRY_MAX_RETRIES)
- Automatic detection and handling of Spotify's retry-after headers
- Better logging for retry attempts with clear indication of timeout vs rate limit issues
- Configuration can be overridden via environment variables for different deployment scenarios

### 2025-01-06 - TypeScript Decorator Typing Investigation

- Investigated multiple approaches for properly typing methods augmented by decorators
- Explored TypeScript patterns including interface augmentation, declaration merging, and type helpers
- Discovered that TypeScript's experimental decorator support doesn't handle method signature modifications well
- Kept the pragmatic `(this.allPlaylists as any).reset()` approach as it's the clearest solution
- Fixed TypeScript compilation errors by adding missing semicolons after console.log statements
- Added explanatory comments where decorator-enhanced methods are used

### 2025-01-06 - Fix Duplicate Archive Playlist Creation

- Identified issue with archive playlists being created multiple times for the same month
- Root cause: Playlist cache was not being refreshed between Lambda invocations, causing the system to not find existing archive playlists
- Solution implemented:
  - Modified `getOrCreatePlaylist()` in src/spotify.ts to accept optional `forceRefresh` parameter
  - When `forceRefresh` is true, the playlist cache is cleared before checking for existing playlists
  - Updated `ArchiveAction` in src/actions/archive-action.ts to use `forceRefresh: true` when creating archive playlists
  - Added detailed logging throughout the playlist creation flow to track when playlists are found vs created
- This ensures that archive playlists are properly deduplicated even across different Lambda instances

### 2025-01-06 - Dependency Updates and AWS SDK v3 Migration

- Updated all npm dependencies to latest stable versions:
  - TypeScript: 5.0.4 → 5.8.3
  - @types/node: 20.2.3 → 22.10.6
  - dotenv: 7.0 → 16.5.0
  - node-notifier: 5.3.0 → 10.0.1
  - aws-xray-sdk: 2.1.0 → 3.10.3
  - aws-xray-sdk-core: 2.1.0 → 3.10.3
  - prettier: 2.3.1 → 3.4.2
  - lambda-local: 2.0.3 → 2.2.0
  - Updated all @types packages to latest versions
- **Major Migration: AWS SDK v2 to v3**
  - Replaced `aws-sdk` with modular AWS SDK v3 packages:
    - `@aws-sdk/client-dynamodb`: ^3.695.0
    - `@aws-sdk/client-xray`: ^3.695.0
    - `@aws-sdk/lib-dynamodb`: ^3.695.0
  - Updated all DynamoDB operations to use v3 command pattern:
    - Migrated from `.promise()` calls to `send(new Command())`
    - Updated imports to use specific commands (QueryCommand, UpdateCommand, etc.)
  - Updated X-Ray integration to use `captureAWSv3Client` for v3 compatibility
  - Fixed TypeScript type issues related to optional TableName property
- **Note on Spotify SDK**: spotify-web-api-node (5.0.2) hasn't been updated since 2020. Consider migrating to Spotify's official TypeScript SDK in future updates

### 2025-01-06 - React Web Frontend

- Created a modern React web frontend for the Spotify playlist management system:
  - Uses **Bun** as the runtime, package manager, and build tool
  - Built with **React 19**, **TypeScript**, and **Vite** for fast development
  - Styled with **Tailwind CSS** for responsive design
  - **React Query** for efficient server state management and caching
  - **React Router** for client-side navigation
- Implemented key features:
  - **Dashboard**: Overview of playlists, user info, and quick actions
  - **Action History**: View recent actions with undo capability for promote/demote
  - **Playlist Browser**: Search and sort all playlists with links to Spotify
  - **Track Controls**: Real-time promote/demote buttons for currently playing track
- Created API endpoints in `src/web-api.ts` for frontend communication
- Updated Lambda handler to serve both API routes and static files
- Modified deployment script to build React app before deploying to Lambda
- Frontend is accessible at the Lambda function's root URL (`/`)
