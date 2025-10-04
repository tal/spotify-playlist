declare interface LikedSongItem {
  userId: string
  trackId: string
  trackUri: string
  trackName: string
  artistName: string
  artistId: string
  albumName: string
  albumId: string
  addedAt: number // Timestamp when track was added to liked songs
  syncedAt: number // Timestamp when this record was synced to cache
  durationMs: number
  popularity?: number
}

declare interface LikedSongsMetadata {
  userId: string
  totalTracks: number
  lastSyncedAt: number // Timestamp of last sync
  lastFullSyncAt: number // Timestamp of last full sync
  mostRecentAddedAt: number // Timestamp of most recently added track
  oldestAddedAt: number // Timestamp of oldest track
  syncVersion: number // Incremented on each sync to detect changes
  syncStatus: 'synced' | 'syncing' | 'error' | 'never_synced'
  lastError?: string
}

declare type SyncResult = {
  type: 'full' | 'incremental' | 'cached'
  tracksAdded: number
  tracksRemoved: number
  totalTracks: number
  fromCache: boolean
  syncDuration: number
}

declare type SyncOptions = {
  forceRefresh?: boolean // Force a full sync regardless of cache state
  incrementalOnly?: boolean // Only sync new tracks, don't check for removals
  maxAge?: number // Maximum cache age in milliseconds (default 24 hours)
}