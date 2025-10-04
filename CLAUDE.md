# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Spotify playlist management automation system that runs as an AWS Lambda function. It automates playlist operations including managing inbox/current playlists, archiving tracks by month, processing playback history, and promoting/demoting tracks based on listening patterns.

## Common Development Commands

### Build & Compile

```bash
# Compile TypeScript to JavaScript
npx tsc

# Build for production (compiles TypeScript and builds web frontend)
npm run build

# Run the CLI locally (Node.js - requires compilation first)
yarn cli <action-name>

# Run the CLI with Bun (no compilation needed)
yarn cli:bun <action-name>

# Start local API server with Bun
yarn cli:bun:server
```

### Web Frontend Development

```bash
# Start both API server and web dev server concurrently
npm run dev

# Or start them separately:
# Start the local API server (port 3001)
npm run dev:api

# Start the React development server (uses Bun and Vite, port 5173)
npm run dev:web
cd web && bun run dev

# Build the React app for production
cd web && bun run build

# Preview the production build locally
cd web && bun run preview
```

### Deployment

```bash
# Deploy to AWS Lambda (includes building React app)
ruby scripts/publish.rb
```

### Local Development

```bash
# Start local DynamoDB (required for local development with NODE_ENV=development)
java -Djava.library.path=./dynamodb_local_latest/DynamoDBLocal_lib -jar dynamodb_local_latest/DynamoDBLocal.jar -sharedDb

# Run specific actions locally via CLI
# Available actions: promote, demote, archive, playback, auto-inbox, undo, undo-last,
#                    rule-playlist, sync-liked-songs, liked-songs-stats, clear-liked-cache
yarn cli <action-name>
yarn cli:bun <action-name>

# Examples:
yarn cli promote          # Promote current track
yarn cli:bun demote       # Demote current track (with Bun)
yarn cli archive          # Archive old tracks
yarn cli undo-last        # Undo last promote/demote action
```

## Architecture

### Web Frontend

The system includes a modern React web frontend that provides a dashboard interface for managing playlists:

**Technology Stack**:
- **Bun**: Runtime, package manager, and build tool
- **React 19**: UI framework with TypeScript
- **Vite**: Fast development server and bundler
- **Tailwind CSS**: Utility-first CSS framework
- **React Query**: Server state management and caching
- **React Router**: Client-side routing

**Key Features**:
- Dashboard with playlist statistics and quick actions
- Action history viewer with undo capabilities
- Playlist browser with search and sorting
- Real-time track controls for promote/demote
- Responsive design for mobile and desktop

**API Endpoints** (`src/web-api.ts`):
- `GET /api/dashboard` - Combined dashboard data
- `GET /api/actions/recent` - Recent action history
- `GET /api/playlists` - All user playlists
- `GET /api/tracks/current` - Currently playing track
- `POST /api/actions/{action}` - Trigger actions (promote, demote, archive, etc.)

The frontend is served directly from the Lambda function, with static files built and included in the deployment package.

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
- The Lambda handler in `src/index.ts` routes requests to either web API endpoints (`/api/*`), static files, or action handlers
- Environment variables are loaded from `.env` file (not committed to git)

## Changelog

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
  - `yarn cli undo` - Undo operations via CLI
  - `yarn cli undo-last` - Undo the most recent action
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
