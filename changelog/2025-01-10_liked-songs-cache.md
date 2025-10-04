# 2025-01-10 - DynamoDB Cache for Liked Songs

## Overview
Implemented a DynamoDB-based caching system for Spotify liked songs to minimize API calls and improve performance. The system intelligently detects changes and performs incremental syncs when possible.

## Changes Made

### New Tables
- **liked_songs**: Stores individual liked songs with user partitioning
  - Partition key: `userId` (String)
  - Sort key: `trackId` (String)
  - GSI: `userId-addedAt-index` for chronological queries
  - Attributes: track metadata, timestamps, popularity

- **liked_songs_metadata**: Tracks sync state per user
  - Partition key: `userId` (String)
  - Attributes: total tracks, sync timestamps, sync version, status

### New Files Created
1. `config/dynamo-tables/liked-songs.json` - Table definition for liked songs
2. `config/dynamo-tables/liked-songs-metadata.json` - Table definition for metadata
3. `src/db/liked-songs.d.ts` - TypeScript type definitions
4. `src/db/liked-songs-cache.ts` - Cache manager implementation
5. `src/migrations/001-create-liked-songs-tables.ts` - Migration script
6. `src/migrations/rollback-001-liked-songs.ts` - Rollback script

### Modified Files
1. `src/db/dynamo.ts` - Added cache-related methods:
   - `getLikedSongsMetadata()` - Retrieve sync metadata
   - `updateLikedSongsMetadata()` - Update sync state
   - `batchPutLikedSongs()` - Efficient batch writes
   - `getLikedSongs()` - Query cached songs
   - `queryLikedSongsSince()` - Get tracks added after timestamp
   - `clearLikedSongs()` - Clear user's cache
   - `putLikedSong()` - Store individual track

2. `src/spotify.ts` - Integrated caching:
   - Modified `mySavedTracks()` to use cache when available
   - Added `syncLikedSongs()` for manual sync
   - Added `clearLikedSongsCache()` for cache management
   - Cache automatically used when Dynamo instance available

3. `src/index.ts` - Added new action handlers:
   - `sync-liked-songs` - Force sync of liked songs
   - `liked-songs-stats` - Display cache statistics
   - `clear-liked-cache` - Clear cache for testing

4. `src/cli.ts` - Added CLI command definitions

## Sync Strategy

The cache implements a multi-layered sync strategy:

1. **Quick Check**: Compare total track count from API with cached count
2. **New Track Detection**: Fetch first page and check for newer tracks
3. **Incremental Sync**: When new tracks detected, paginate until reaching known tracks
4. **Full Sync Triggers**:
   - No existing cache
   - Total count decreased (tracks removed)
   - Cache older than 24 hours (configurable)
   - Manual force refresh requested
   - Previous sync error

## Usage

### Run Migration
```bash
# Create the new tables
npx ts-node src/migrations/001-create-liked-songs-tables.ts

# Rollback if needed
npx ts-node src/migrations/rollback-001-liked-songs.ts --force
```

### CLI Commands
```bash
# Force sync liked songs to cache
yarn cli sync-liked-songs

# View cache statistics
yarn cli liked-songs-stats

# Clear cache (for testing)
yarn cli clear-liked-cache
```

### Programmatic Usage
```typescript
// Automatically uses cache when available
const tracks = await spotify.mySavedTracks()

// Force refresh from Spotify API
const tracks = await spotify.mySavedTracks({ forceRefresh: true })

// Incremental sync only
const tracks = await spotify.mySavedTracks({ incrementalOnly: true })

// Custom cache age (12 hours)
const tracks = await spotify.mySavedTracks({ maxAge: 12 * 60 * 60 * 1000 })
```

## Benefits

1. **Reduced API Calls**: Caches liked songs locally, only syncing when changes detected
2. **Intelligent Sync**: Detects new additions without full resync
3. **Performance**: Queries from DynamoDB are much faster than Spotify API pagination
4. **Reliability**: Reduces chance of hitting Spotify rate limits
5. **Flexibility**: Configurable cache age and sync strategies

## Technical Details

- **Batch Operations**: Uses DynamoDB batch writes (25 items per batch) for efficiency
- **GSI Usage**: Leverages Global Secondary Index for chronological queries
- **Error Handling**: Tracks sync status and errors in metadata
- **Incremental Updates**: Only fetches new tracks when possible
- **Migration Support**: Includes both migration and rollback scripts

## Future Enhancements

- Add TTL to automatically expire old cache entries
- Implement webhook support if Spotify adds it
- Add cache warming on Lambda cold start
- Track removal detection without full sync
- Add metrics for cache hit/miss rates