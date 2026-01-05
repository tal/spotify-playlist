# Efficient Removal Detection for Liked Songs Cache

**Date:** 2025-12-29

## Summary

Added efficient removal detection for the liked songs cache. Instead of triggering a full re-sync when tracks are unliked, the system now uses Spotify's `containsMySavedTracks` endpoint to check batches of 50 tracks, starting with the most recently added (since removals tend to be recent). This optimization reduces API calls from 40+ down to 2-3 for typical removal scenarios.

## Changes

### New Types (`src/db/liked-songs.d.ts`)

- `RemovalDetectionStatus`: `'completed' | 'needs_full_sync' | 'no_cached_tracks'`
- `RemovalDetectionResult`: Result object with status, counts, and removed track IDs
- `ChangeType`: `'none' | 'additions' | 'removals' | 'additions_and_removals' | 'unknown'`
- `ChangeDetectionResult`: Structured result from change detection
- Updated `SyncResult.type` to include `'removal_detection'`

### New Methods

**`Spotify.tracksAreSaved(trackIds: string[])`** (`src/spotify.ts`)
- Batch check up to 50 track IDs via Spotify's `containsMySavedTracks` endpoint
- Returns `{ saved: string[], removed: string[] }`
- Uses existing retry logic with token refresh

**`Dynamo.deleteLikedSongsByIds(userId, trackIds)`** (`src/db/dynamo.ts`)
- Delete specific tracks from the liked songs cache by ID
- Uses batch write with same retry/backoff pattern as existing methods
- Returns count of deleted items

**`LikedSongsCache.detectAndRemoveDeletedTracks(metadata, expectedRemovals)`** (`src/db/liked-songs-cache.ts`)
- Checks cached tracks in batches of 50, starting with most recent
- Early exits when all expected removals are found
- Falls back to full sync after 4 batches with no hits (safety heuristic)

### Updated Methods

**`LikedSongsCache.detectChanges()`**
- Now returns `ChangeDetectionResult` with structured change type
- Uses `limit=1` for count-only checks (optimization)
- Distinguishes between additions, removals, both, or no changes

**`LikedSongsCache.syncLikedSongs()`**
- Routes to appropriate sync strategy based on change type
- Handles `removals` case with efficient removal detection
- Handles `additions_and_removals` case with incremental + removal detection
- Respects `incrementalOnly` option to skip removal detection

## API Call Efficiency

| Scenario | Before | After |
|----------|--------|-------|
| 1-5 recent removals | 41+ calls | 2-3 calls |
| No changes | 1 call | 1 call |
| Additions only | N calls | N calls (unchanged) |

## Algorithm

1. Get total count from Spotify (limit=1)
2. Compare with cached total:
   - If decreased → removal detection
   - If increased → incremental sync (existing)
   - If same but newest timestamp changed → both additions and removals
3. For removal detection:
   - Check first 50 cached track IDs via `containsMySavedTracks`
   - Delete any returning false from DynamoDB
   - Early exit when `removals_found >= expected_diff`
   - Safety: after 4 batches with no hits, suggest full sync
