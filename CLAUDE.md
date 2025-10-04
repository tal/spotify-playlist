# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Spotify playlist management automation system that runs as an AWS Lambda function. It automates playlist operations including managing inbox/current playlists, archiving tracks by month, processing playback history, and promoting/demoting tracks based on listening patterns.

## Common Development Commands

### Build & Compile

```bash
# Compile TypeScript to JavaScript
npx tsc

# Run the CLI locally
yarn cli
```

### Web Frontend Development

```bash
# Start the React development server (uses Bun and Vite)
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
# Start local DynamoDB (required for local development)
java -Djava.library.path=./dynamodb_local_latest/DynamoDBLocal_lib -jar dynamodb_local_latest/DynamoDBLocal.jar -sharedDb

# Run specific actions locally via CLI
yarn cli --action <action-name>
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

   - Extends the base `Action` class
   - Implements `getRequiredPermissions()` and `getMutations()` methods
   - Returns an array of mutations to be executed
   - Can be run in dry-run mode for testing

2. **Mutations** (`src/mutations/`) - Atomic state changes that:
   - Extend the base `Mutation` class
   - Implement `executeInternal()` for the actual state change
   - Support rollback operations
   - Are executed in sequence with automatic retry logic

### Core Components

**Spotify Integration** (`src/spotify.ts`, `src/spotify-api.ts`):

- Wraps the Spotify Web API with caching and automatic token refresh
- Uses memoization decorators to cache API responses for 4 minutes
- Provides high-level operations like `getTrackFromPlaylist()`, `moveTrack()`, etc.

**Database Layer** (`src/db/dynamo.ts`):

- DynamoDB integration with multi-tenant support (user partition keys)
- Tables: User settings, Action history, Track metadata
- Local DynamoDB for development

**Track Triage Workflow**:

- Tracks progress through three states: Unheard → Liked → Confirmed
- Archives are created monthly from confirmed tracks
- Smart playlist features use starred tracks and artist preferences

### Key Actions

- `ActionForPlaylist` - Main entry point that routes to specific playlist actions
- `ProcessPlaybackHistoryAction` - Processes Spotify listening history
- `AddPlaylistToInbox` - Adds new tracks to inbox
- `ArchiveAction` - Archives old tracks by month
- `PromoteAction`/`DemoteAction` - Moves tracks between playlists
- `RulePlaylistAction` - Creates smart playlists based on rules

### Important Patterns

1. **Action Throttling**: Actions are throttled to prevent duplicate operations within 5 minutes
2. **Dry Run Support**: All actions support `dryRun` mode for safe testing
3. **Permission System**: Actions declare required permissions (read/write) for playlists
4. **Error Handling**: Comprehensive error handling with detailed logging
5. **User Context**: Multi-tenant support with user-specific settings and data

## Development Tips

- The `-run-this-first.ts` file contains setup code for initializing DynamoDB tables
- Use `yarn cli --help` to see available CLI options
- Actions can be tested locally with `--dryRun` flag before deployment
- The system uses AWS X-Ray for distributed tracing in production
- Settings are managed per-user in DynamoDB, not in config files

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
