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

### Deployment

```bash
# Deploy to AWS Lambda (dev environment)
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
