# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Overview

This is a Spotify playlist management automation system that runs as an AWS Lambda function. It automates playlist operations including managing inbox/current playlists, archiving tracks by month, processing playback history, and promoting/demoting tracks based on listening patterns.

## Common Development Commands

### Build & Compile

```bash
# Compile TypeScript to JavaScript
bunx tsc

# Build for production (compiles TypeScript)
bun run build

# Run the CLI locally (Node.js - requires compilation first)
bun run cli <action-name>

# Run the CLI with Bun (no compilation needed)
bun run cli:bun <action-name>

# Start local API server with Bun
bun run cli:bun:server
```

### Deployment

```bash
# Deploy to AWS Lambda
ruby scripts/publish.rb
```

### Local Development

```bash
# Start local DynamoDB (required for local development with NODE_ENV=development)
java -Djava.library.path=./dynamodb_local_latest/DynamoDBLocal_lib -jar dynamodb_local_latest/DynamoDBLocal.jar -sharedDb

# Run specific actions locally via CLI
# Available actions: promote, demote, archive, playback, auto-inbox, undo, undo-last,
#                    rule-playlist, sync-liked-songs, liked-songs-stats, clear-liked-cache,
#                    listen-stats
bun run cli <action-name>
bun run cli:bun <action-name>

# Examples:
bun run cli promote          # Promote current track
bun run cli:bun demote       # Demote current track (with Bun)
bun run cli archive          # Archive old tracks
bun run cli undo-last        # Undo last promote/demote action
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

**Spotify Integration** (`src/spotify.ts`, `src/spotify-api.ts`):

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

**Track Triage Workflow**:

- Tracks progress through three states: Unheard → Liked → Confirmed
- Archives are created monthly from confirmed tracks
- Smart playlist features use starred tracks and artist preferences

### Key Actions

- `actionForPlaylist()` - Routes playlist-specific actions based on playlist name/type
- `MagicPromoteAction` - Promotes current track to next stage (inbox → current → confirmed)
- `DemoteAction` - Demotes current track to previous stage
- `ProcessPlaybackHistoryAction` - Processes Spotify listening history and updates track metadata
- `AddPlaylistToInbox` - Adds new tracks from source playlists to inbox
- `ArchiveAction` - Archives confirmed tracks by month (e.g., "Archive 2025-01")
- `RulePlaylistAction` - Creates smart playlists based on rules (e.g., starred tracks)
- `UndoAction` - Reverses previous promote/demote actions
- `SkipToNextTrack` - Skips to next track in current playback

### Important Patterns

1. **Action Throttling**: Actions use `idThrottleMs` to prevent duplicate operations (e.g., 5 minutes for promote/demote)
2. **Memoization with Decorators**: `@asyncMemoize` decorator caches method results with `.reset()` method to clear cache
3. **Mutation Sets**: Actions return arrays of mutation arrays, where each inner array is executed sequentially
4. **Error Handling**: Comprehensive error handling with detailed logging; special handling for token expiration (401 errors)
5. **User Context**: Multi-tenant support with user-specific settings and data; currently hardcoded to 'koalemos' user
6. **Undo Support**: Actions can implement `undo()` to reverse their operations (tracked in DynamoDB)

## Development Tips

- The `-run-this-first.ts` file initializes global variables (like `dev`, `minutes`, `hours`) and sets up AWS X-Ray tracing
- Run migrations in `src/migrations/` to set up DynamoDB tables for local development
- The system uses AWS X-Ray for distributed tracing in production (automatically disabled in development)
- Settings are managed per-user in DynamoDB, not in config files
- To reset memoized caches, use `(method as any).reset()` on decorated methods
- The Lambda handler in `src/index.ts` routes requests to action handlers based on the path, path parameters, or `action` query parameter
- Environment variables are loaded from `.env` file (not committed to git)

## Known Issues

Latent traps that are **not** visible from the code they affect. Kept here rather
than in a dated changelog entry so they don't scroll out of sight.

### `ArchiveAction`'s `idThrottleMs` can never fire

`ArchiveAction` declares `idThrottleMs = 60 * 1000`, but `getID()` returns
`archive:${this.created_at}` — a fresh timestamp per construction. The throttle
check in `performAction` (`src/actions/action.ts`) calls
`dynamo.getActionHistory(await action.getID(), since)`, which is an **exact-match
`KeyConditionExpression` on that id**. A newly minted id can never match a stored
one, so the lookup always misses and the action always runs.

- Every action id must be **stable across invocations** for throttling to work.
  `MagicPromoteAction` gets this right (`promote:${currentTrack.uri}`);
  `ArchiveAction` does not.
- This matters more than it looks: `ArchiveAction` runs on `frequent-crawling`
  and opens with `Dynamo.tracksWithLiveStatus()`, a **full table scan**. The
  declared throttle is the only apparent guardrail on it, and it isn't one.
- Fix is to key the id on the period being archived, not the clock — but note
  that a stable id also means `forStorage`'s `ttl` and the `action_history` row
  start colliding between runs, so it isn't a one-liner.

### `ListenSequence`'s ordering invariant is enforced by nothing

The watermark is only correct if the playback pass keeps **one listen per
mutation set, ascending by `played_at`, watermark set last**. That is stated in a
comment in `ProcessPlaybackHistoryAction` and nowhere else.

`performAction` runs mutation *sets* sequentially but fires everything **within**
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
- **Known gap:** manual Inbox → Current *is* caught (the Current backfill filters on `'promote'`, which a hand-dragged track lacks), but manual Current → Inbox is **not** (the Inbox backfill filters on `'inboxed'`, which a returning track already has) — status stays `'promoted'` while the track sits in Inbox. Both are `ProcessManualTriage.backfillStage()`. Deliberately deferred; see the changelog
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
