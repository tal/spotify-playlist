import { Track } from 'spotify-web-api-node'
import { Dynamo } from './dynamo'
import { Spotify } from '../spotify'

export class LikedSongsCache {
  constructor(
    private dynamo: Dynamo,
    private spotify: Spotify,
  ) {}

  /**
   * Main sync orchestrator - determines the best sync strategy and executes it
   */
  async syncLikedSongs(options: SyncOptions = {}): Promise<SyncResult> {
    const startTime = Date.now()
    const userId = this.dynamo.user.id
    
    // Get current metadata to determine sync strategy
    const metadata = await this.dynamo.getLikedSongsMetadata(userId)
    
    // Determine if we need a full sync
    const needsFullSync = this.shouldDoFullSync(metadata, options)
    
    if (needsFullSync) {
      console.log('🔄 Performing full sync of liked songs')
      return this.fullSync(startTime)
    }
    
    // Try incremental sync
    const changes = await this.detectChanges(metadata)
    
    if (changes.hasChanges && metadata) {
      console.log(`🔄 Performing incremental sync (${changes.estimatedNewTracks} new tracks detected)`)
      return this.incrementalSync(metadata, startTime)
    }
    
    // No changes detected, return cached data
    console.log('✅ No changes detected, using cached liked songs')
    return {
      type: 'cached',
      tracksAdded: 0,
      tracksRemoved: 0,
      totalTracks: metadata?.totalTracks || 0,
      fromCache: true,
      syncDuration: Date.now() - startTime,
    }
  }
  
  /**
   * Determines if a full sync is needed based on metadata and options
   */
  private shouldDoFullSync(
    metadata: LikedSongsMetadata | undefined,
    options: SyncOptions,
  ): boolean {
    // Force refresh requested
    if (options.forceRefresh) return true
    
    // No metadata means never synced
    if (!metadata) return true
    
    // Check cache age (default 24 hours)
    const maxAge = options.maxAge || 24 * 60 * 60 * 1000
    const cacheAge = Date.now() - metadata.lastSyncedAt
    if (cacheAge > maxAge) return true
    
    // If last sync had an error, try full sync
    if (metadata.syncStatus === 'error') return true
    
    return false
  }
  
  /**
   * Quick change detection by fetching first page and comparing with metadata
   */
  async detectChanges(
    metadata: LikedSongsMetadata | undefined,
  ): Promise<{ hasChanges: boolean; estimatedNewTracks: number }> {
    if (!metadata) return { hasChanges: true, estimatedNewTracks: 0 }
    
    // Fetch first page of liked songs
    const firstPageResponse = await this.spotify.client.getMySavedTracks({ limit: 50 })
    const currentTotal = firstPageResponse.body.total
    
    // Check if total count changed (tracks added or removed)
    if (currentTotal !== metadata.totalTracks) {
      const diff = currentTotal - metadata.totalTracks
      return { 
        hasChanges: true, 
        estimatedNewTracks: diff > 0 ? diff : 0 
      }
    }
    
    // Check if newest track is newer than our cache
    if (firstPageResponse.body.items.length > 0) {
      const newestTrack = firstPageResponse.body.items[0]
      const newestAddedAt = new Date(newestTrack.added_at).getTime()
      
      if (newestAddedAt > metadata.mostRecentAddedAt) {
        // New tracks have been added
        return { hasChanges: true, estimatedNewTracks: 1 }
      }
    }
    
    return { hasChanges: false, estimatedNewTracks: 0 }
  }
  
  /**
   * Performs a complete sync of all liked songs
   */
  async fullSync(startTime: number): Promise<SyncResult> {
    const userId = this.dynamo.user.id
    
    // Mark sync as in progress
    await this.dynamo.updateLikedSongsMetadata({
      userId,
      syncStatus: 'syncing',
      lastSyncedAt: Date.now(),
      syncVersion: 0,
    } as LikedSongsMetadata)
    
    try {
      // Fetch all liked songs from Spotify
      let allTracks: LikedSongItem[] = []
      let offset = 0
      let total = 0
      let mostRecentAddedAt = 0
      let oldestAddedAt = Date.now()
      
      while (true) {
        const response = await this.spotify.client.getMySavedTracks({ 
          limit: 50, 
          offset 
        })
        
        total = response.body.total
        
        // Convert Spotify tracks to our cache format
        const tracks = response.body.items.map(item => {
          const addedAt = new Date(item.added_at).getTime()
          mostRecentAddedAt = Math.max(mostRecentAddedAt, addedAt)
          oldestAddedAt = Math.min(oldestAddedAt, addedAt)
          
          return this.convertToLikedSongItem(item.track, item.added_at, userId)
        })
        
        allTracks = allTracks.concat(tracks)
        
        if (!response.body.next) break
        offset += 50
        
        console.log(`📥 Synced ${allTracks.length}/${total} liked songs`)
      }
      
      // Clear existing cache and write new data
      await this.dynamo.clearLikedSongs(userId)
      await this.dynamo.batchPutLikedSongs(allTracks)
      
      // Update metadata
      const metadata: LikedSongsMetadata = {
        userId,
        totalTracks: total,
        lastSyncedAt: Date.now(),
        lastFullSyncAt: Date.now(),
        mostRecentAddedAt,
        oldestAddedAt,
        syncVersion: 1,
        syncStatus: 'synced',
      }
      
      await this.dynamo.updateLikedSongsMetadata(metadata)
      
      return {
        type: 'full',
        tracksAdded: total,
        tracksRemoved: 0,
        totalTracks: total,
        fromCache: false,
        syncDuration: Date.now() - startTime,
      }
    } catch (error: any) {
      // Mark sync as failed
      await this.dynamo.updateLikedSongsMetadata({
        userId,
        syncStatus: 'error',
        lastError: error.message,
      } as LikedSongsMetadata)
      
      throw error
    }
  }
  
  /**
   * Performs an incremental sync, fetching only new tracks
   */
  async incrementalSync(
    metadata: LikedSongsMetadata,
    startTime: number,
  ): Promise<SyncResult> {
    const userId = this.dynamo.user.id
    
    // Mark sync as in progress
    await this.dynamo.updateLikedSongsMetadata({
      ...metadata,
      syncStatus: 'syncing',
    })
    
    try {
      // Fetch tracks until we reach ones we've already seen
      let newTracks: LikedSongItem[] = []
      let offset = 0
      let total = 0
      let foundExisting = false
      let mostRecentAddedAt = metadata.mostRecentAddedAt
      
      while (!foundExisting) {
        const response = await this.spotify.client.getMySavedTracks({ 
          limit: 50, 
          offset 
        })
        
        total = response.body.total
        
        for (const item of response.body.items) {
          const addedAt = new Date(item.added_at).getTime()
          
          // Check if we've reached tracks we already have
          if (addedAt <= metadata.mostRecentAddedAt) {
            foundExisting = true
            break
          }
          
          mostRecentAddedAt = Math.max(mostRecentAddedAt, addedAt)
          newTracks.push(this.convertToLikedSongItem(item.track, item.added_at, userId))
        }
        
        if (!response.body.next || foundExisting) break
        offset += 50
        
        console.log(`📥 Found ${newTracks.length} new liked songs`)
      }
      
      // Add new tracks to cache
      if (newTracks.length > 0) {
        await this.dynamo.batchPutLikedSongs(newTracks)
      }
      
      // Calculate tracks removed (if total decreased)
      const tracksRemoved = Math.max(0, metadata.totalTracks - total + newTracks.length)
      
      // Update metadata
      const updatedMetadata: LikedSongsMetadata = {
        ...metadata,
        totalTracks: total,
        lastSyncedAt: Date.now(),
        mostRecentAddedAt,
        syncVersion: metadata.syncVersion + 1,
        syncStatus: 'synced',
      }
      
      await this.dynamo.updateLikedSongsMetadata(updatedMetadata)
      
      return {
        type: 'incremental',
        tracksAdded: newTracks.length,
        tracksRemoved,
        totalTracks: total,
        fromCache: false,
        syncDuration: Date.now() - startTime,
      }
    } catch (error: any) {
      // Mark sync as failed
      await this.dynamo.updateLikedSongsMetadata({
        ...metadata,
        syncStatus: 'error',
        lastError: error.message,
      })
      
      throw error
    }
  }
  
  /**
   * Retrieves cached liked songs for a user
   */
  async getCachedLikedSongs(): Promise<Track[]> {
    const userId = this.dynamo.user.id
    const items = await this.dynamo.getLikedSongs(userId)
    
    // Convert cache items back to Spotify Track format
    return items.map(item => this.convertToSpotifyTrack(item))
  }
  
  /**
   * Gets liked songs with smart caching
   */
  async getLikedSongsWithCache(options: SyncOptions = {}): Promise<Track[]> {
    // Sync if needed
    const syncResult = await this.syncLikedSongs(options)
    
    console.log(`📊 Sync result: ${syncResult.type}, ${syncResult.tracksAdded} added, from cache: ${syncResult.fromCache}`)
    
    // Return cached songs
    return this.getCachedLikedSongs()
  }
  
  /**
   * Converts a Spotify track to our cache format
   */
  private convertToLikedSongItem(
    track: Track,
    addedAt: string,
    userId: string,
  ): LikedSongItem {
    return {
      userId,
      trackId: track.id,
      trackUri: track.uri,
      trackName: track.name,
      artistName: track.artists[0]?.name || 'Unknown Artist',
      artistId: track.artists[0]?.id || '',
      albumName: track.album.name,
      albumId: track.album.id,
      addedAt: new Date(addedAt).getTime(),
      syncedAt: Date.now(),
      durationMs: track.duration_ms,
      popularity: track.popularity,
    }
  }
  
  /**
   * Converts a cached item back to Spotify Track format
   */
  private convertToSpotifyTrack(item: LikedSongItem): Track {
    // Create a minimal Track object that matches the Spotify API structure
    // This is a simplified version - add more fields as needed
    return {
      id: item.trackId,
      uri: item.trackUri,
      name: item.trackName,
      duration_ms: item.durationMs,
      popularity: item.popularity || 0,
      artists: [{
        id: item.artistId,
        name: item.artistName,
        uri: `spotify:artist:${item.artistId}`,
      }],
      album: {
        id: item.albumId,
        name: item.albumName,
        uri: `spotify:album:${item.albumId}`,
      },
    } as Track
  }
}