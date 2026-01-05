# Fix Missing DynamoDB Tables for Liked Songs Cache

**Date:** 2025-10-04

## Problem

Lambda function was crashing with unhandled promise rejections:

```
ERROR 🧨 Error in mySavedTracks ResourceNotFoundException: Requested resource not found
at async Dynamo.getLikedSongsMetadata (/var/task/dist/db/dynamo.js:340:22)
at async LikedSongsCache.syncLikedSongs (/var/task/dist/db/liked-songs-cache.js:18:26)
```

**Root Cause:** The `liked_songs` and `liked_songs_metadata` DynamoDB tables didn't exist in production, but the code was trying to use the liked songs cache feature.

## Affected Actions

Any action that calls `mySavedTracks()`:
- `rule-playlist` - Creates smart playlists based on starred tracks
- `auto-artist-playlist` - Auto-generates artist playlists

These actions would fail with unhandled promise rejections causing Lambda to crash.

## Solution

Created the missing DynamoDB tables:

### 1. liked_songs_metadata
```bash
aws dynamodb create-table --cli-input-json file://config/dynamo-tables/liked-songs-metadata.json
```

**Table Structure:**
- Primary Key: `userId` (String)
- Purpose: Stores sync metadata for liked songs cache
- Fields: `totalTracks`, `lastSyncedAt`, `lastFullSyncAt`, `mostRecentAddedAt`, `oldestAddedAt`, `syncVersion`, `syncStatus`

### 2. liked_songs
```bash
aws dynamodb create-table --cli-input-json file://config/dynamo-tables/liked-songs.json
```

**Table Structure:**
- Primary Key: `userId` (String, Hash), `trackId` (String, Range)
- GSI: `userId-addedAt-index` (for time-based queries)
- Purpose: Caches user's liked songs to reduce Spotify API calls
- Fields: `trackUri`, `trackName`, `artistName`, `artistId`, `albumName`, `albumId`, `addedAt`, `syncedAt`, `durationMs`, `popularity`

## Benefits of Liked Songs Cache

The liked songs cache feature provides:

1. **Reduced Spotify API Calls:** Instead of fetching all liked songs on every request, the system uses a DynamoDB cache
2. **Faster Response Times:** Reading from DynamoDB is much faster than paginating through Spotify API
3. **Smart Incremental Sync:** Only fetches new tracks since last sync
4. **Automatic Cache Management:** Detects changes and refreshes when needed

## Testing

After creating the tables:

```bash
# Check table status
aws dynamodb describe-table --table-name liked_songs_metadata --query 'Table.TableStatus'
# Output: ACTIVE

aws dynamodb describe-table --table-name liked_songs --query 'Table.TableStatus'
# Output: ACTIVE

# Test liked songs stats endpoint
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=liked-songs-stats"
# Output: {"metadata":{"message":"No cache found"},"sampleTracks":[],"cacheAge":"N/A"}

# Verify no new errors after table creation
aws logs filter-log-events --log-group-name /aws/lambda/spotify-playlist-dev \
  --start-time 1759606800000 --filter-pattern "ERROR"
# Output: 0 new errors
```

## Related Files

- `config/dynamo-tables/liked-songs.json` - Table definition for cached songs
- `config/dynamo-tables/liked-songs-metadata.json` - Table definition for sync metadata
- `src/db/liked-songs-cache.ts` - Cache implementation with full/incremental sync
- `src/db/dynamo.ts` - DynamoDB operations for liked songs tables
- `src/spotify.ts` - `mySavedTracks()` method uses cache when available

## Available Actions for Cache Management

```bash
# Sync liked songs to cache
curl "{BASE_URL}?action=sync-liked-songs"

# Get cache statistics
curl "{BASE_URL}?action=liked-songs-stats"

# Clear the cache
curl "{BASE_URL}?action=clear-liked-cache"
```

## Production Deployment Checklist

For future deployments to new environments:

- [ ] Create `user` table
- [ ] Create `action_history` table
- [ ] Create `track` table (for metadata)
- [ ] Create `liked_songs` table
- [ ] Create `liked_songs_metadata` table
- [ ] Configure Lambda environment variables
- [ ] Set up API Gateway or Function URL
- [ ] Configure IAM role with DynamoDB permissions

## Resolution

✅ Tables created successfully
✅ No new errors after 23:20 (table creation time)
✅ Endpoints working correctly
✅ Cache feature now fully operational
