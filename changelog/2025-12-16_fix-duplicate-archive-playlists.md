# Fix Duplicate Archive Playlist Creation

## Problem

Archive actions were creating 2-4 playlists with the same name (e.g., "2025 - January") instead of one.

## Root Cause

The `@asyncMemoize` decorator's `reset()` function had a broken `this` binding.

When `(this.allPlaylists as any).reset()` was called:
- `this.allPlaylists` returns the memoized wrapper function
- `.reset()` is called with `this` bound to the **function object**, not the Spotify instance
- Inside reset: `this[memkey] = null` sets a property on the function, not on the instance
- The actual cache (`__mem_allPlaylists` on the Spotify instance) was never cleared

This meant `forceRefresh=true` in `getOrCreatePlaylist()` did nothing - the cache was never actually cleared.

Within a single archive action run:
1. Track 1 needs "2025 - January": `forceRefresh` fails to clear cache → fetches playlists → not found → creates playlist
2. Track 2 needs "2025 - January": `forceRefresh` fails to clear cache → **returns stale cached list** → not found → creates duplicate
3. Repeat for tracks 3, 4, etc.

## Solution

Instead of calling the broken `reset()` method, directly clear the cache on the instance:

```typescript
// Before (broken)
;(this.allPlaylists as any).reset()

// After (working)
;(this as any).__mem_allPlaylists = null
```

## Files Changed

- `src/spotify.ts` - Fixed cache reset in `getOrCreatePlaylist()` and `createPlaylist()`
