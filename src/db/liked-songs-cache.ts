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
      console.log('Performing full sync of liked songs')
      return this.fullSync(startTime)
    }

    // Detect what changed
    const changes = await this.detectChanges(metadata)

    // Handle based on change type
    switch (changes.changeType) {
      case 'none':
        console.log('No changes detected, using cached liked songs')
        return {
          type: 'cached',
          tracksAdded: 0,
          tracksRemoved: 0,
          totalTracks: metadata?.totalTracks || 0,
          fromCache: true,
          syncDuration: Date.now() - startTime,
        }

      case 'additions':
        console.log(`Performing incremental sync (${changes.estimatedNewTracks} new tracks detected)`)
        // Pass current first page IDs to avoid re-fetching
        return this.incrementalSync(metadata!, startTime, changes.currentFirstPageIds)

      case 'removals':
        if (options.incrementalOnly) {
          // Skip removal detection if incremental-only mode
          console.log('Skipping removal detection (incrementalOnly mode)')
          return {
            type: 'cached',
            tracksAdded: 0,
            tracksRemoved: 0,
            totalTracks: metadata?.totalTracks || 0,
            fromCache: true,
            syncDuration: Date.now() - startTime,
          }
        }

        // Log if removals were detected in first page (likely to be found quickly)
        if (changes.removalsInFirstPage && changes.removalsInFirstPage > 0) {
          console.log(`Performing removal detection (${changes.estimatedRemovals} removed, ${changes.removalsInFirstPage} likely in first page)`)
        } else {
          console.log(`Performing removal detection (${changes.estimatedRemovals} tracks removed)`)
        }

        const removalResult = await this.detectAndRemoveDeletedTracks(
          metadata!,
          changes.estimatedRemovals,
        )

        if (removalResult.status === 'needs_full_sync') {
          console.log('Removal detection suggests full sync needed')
          return this.fullSync(startTime)
        }

        // Update metadata with new total and first page IDs
        await this.dynamo.updateLikedSongsMetadata({
          userId,
          totalTracks: changes.currentTotal!,
          lastSyncedAt: Date.now(),
          syncStatus: 'synced',
          firstPageTrackIds: changes.currentFirstPageIds,
        })

        return {
          type: 'removal_detection',
          tracksAdded: 0,
          tracksRemoved: removalResult.removalsFound,
          totalTracks: changes.currentTotal!,
          fromCache: false,
          syncDuration: Date.now() - startTime,
        }

      case 'additions_and_removals':
        // Both additions and removals detected - do incremental sync first
        console.log('Performing incremental sync with removal detection')
        // Pass current first page IDs to avoid re-fetching
        const incrementalResult = await this.incrementalSync(metadata!, startTime, changes.currentFirstPageIds)

        // After incremental sync, check for removals if not in incremental-only mode
        if (!options.incrementalOnly && changes.estimatedRemovals > 0) {
          const updatedMetadata = await this.dynamo.getLikedSongsMetadata(userId)
          if (updatedMetadata) {
            const removalAfterIncremental = await this.detectAndRemoveDeletedTracks(
              updatedMetadata,
              changes.estimatedRemovals,
            )
            incrementalResult.tracksRemoved = removalAfterIncremental.removalsFound

            // Update total and first page if removals were found
            if (removalAfterIncremental.removalsFound > 0) {
              await this.dynamo.updateLikedSongsMetadata({
                userId,
                totalTracks: updatedMetadata.totalTracks - removalAfterIncremental.removalsFound,
                lastSyncedAt: Date.now(),
                firstPageTrackIds: changes.currentFirstPageIds,
              })
            }
          }
        }

        return incrementalResult

      case 'unknown':
      default:
        // Fallback: full sync
        console.log('Unknown change state, falling back to full sync')
        return this.fullSync(startTime)
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
   * Quick change detection by fetching first page and comparing with metadata.
   * Compares both total count AND first page track IDs for accurate detection.
   * Returns structured result indicating type of change detected.
   */
  async detectChanges(
    metadata: LikedSongsMetadata | undefined,
  ): Promise<ChangeDetectionResult> {
    if (!metadata) {
      return { changeType: 'unknown', estimatedNewTracks: 0, estimatedRemovals: 0 }
    }

    // Fetch first page to get total count AND track IDs for comparison
    const firstPageResponse = await this.spotify.client.getMySavedTracks({ limit: 50 })
    const currentTotal = firstPageResponse.body.total
    const currentFirstPageIds = firstPageResponse.body.items.map(item => item.track.id)

    // Check if total count changed
    const diff = currentTotal - metadata.totalTracks

    if (diff > 0) {
      // Tracks were added
      return {
        changeType: 'additions',
        estimatedNewTracks: diff,
        estimatedRemovals: 0,
        currentTotal,
        currentFirstPageIds,
      }
    } else if (diff < 0) {
      // Tracks were removed - compare first pages to see if removal is recent
      const removalsInFirstPage = this.countFirstPageRemovals(
        metadata.firstPageTrackIds,
        currentFirstPageIds,
      )

      return {
        changeType: 'removals',
        estimatedNewTracks: 0,
        estimatedRemovals: Math.abs(diff),
        currentTotal,
        currentFirstPageIds,
        removalsInFirstPage,
      }
    }

    // Total is same - compare first page to detect churn (equal adds + removes)
    const storedFirstPageIds = metadata.firstPageTrackIds || []

    if (storedFirstPageIds.length > 0 && currentFirstPageIds.length > 0) {
      // Check if first page content changed
      const firstPageChanged = !this.arraysEqual(storedFirstPageIds, currentFirstPageIds)

      if (firstPageChanged) {
        // Count how many tracks from stored first page are missing
        const missingFromFirstPage = storedFirstPageIds.filter(
          id => !currentFirstPageIds.includes(id)
        ).length

        // Count how many new tracks appeared in first page
        const newInFirstPage = currentFirstPageIds.filter(
          id => !storedFirstPageIds.includes(id)
        ).length

        if (missingFromFirstPage > 0 || newInFirstPage > 0) {
          return {
            changeType: 'additions_and_removals',
            estimatedNewTracks: newInFirstPage,
            estimatedRemovals: missingFromFirstPage,
            currentTotal,
            currentFirstPageIds,
            removalsInFirstPage: missingFromFirstPage,
          }
        }
      }
    } else {
      // No stored first page - fall back to timestamp check
      if (firstPageResponse.body.items.length > 0) {
        const newestTrack = firstPageResponse.body.items[0]
        const newestAddedAt = new Date(newestTrack.added_at).getTime()

        if (newestAddedAt > metadata.mostRecentAddedAt) {
          return {
            changeType: 'additions_and_removals',
            estimatedNewTracks: 1,
            estimatedRemovals: 1,
            currentTotal,
            currentFirstPageIds,
          }
        }
      }
    }

    return {
      changeType: 'none',
      estimatedNewTracks: 0,
      estimatedRemovals: 0,
      currentTotal,
      currentFirstPageIds,
    }
  }

  /**
   * Count how many tracks from stored first page are missing in current first page.
   * This helps determine if removals happened in recent tracks.
   */
  private countFirstPageRemovals(
    storedFirstPageIds: string[] | undefined,
    currentFirstPageIds: string[],
  ): number {
    if (!storedFirstPageIds || storedFirstPageIds.length === 0) {
      return 0
    }

    // Count how many stored IDs are NOT in the current first page
    // Note: This is an approximation - a track could have moved out of first page
    // due to new additions pushing it down
    return storedFirstPageIds.filter(id => !currentFirstPageIds.includes(id)).length
  }

  /**
   * Simple array equality check for track IDs
   */
  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    return a.every((val, idx) => val === b[idx])
  }

  /**
   * Efficiently detect and remove tracks that have been unliked by the user.
   * Uses Spotify's containsMySavedTracks endpoint to check batches of 50 tracks,
   * starting with the most recently added (since removals tend to be recent).
   *
   * @param metadata Current cache metadata
   * @param expectedRemovals Number of tracks expected to have been removed
   * @returns Object with status and counts of removals found and processed
   */
  async detectAndRemoveDeletedTracks(
    metadata: LikedSongsMetadata,
    expectedRemovals: number,
  ): Promise<RemovalDetectionResult> {
    const userId = this.dynamo.user.id
    const startTime = Date.now()

    console.log(`Detecting removed tracks. Expected removals: ${expectedRemovals}`)

    // Get cached tracks sorted by addedAt (newest first)
    const cachedTracks = await this.dynamo.getLikedSongs(userId)

    if (cachedTracks.length === 0) {
      console.log('No cached tracks to check for removals')
      return {
        status: 'no_cached_tracks',
        removalsFound: 0,
        tracksChecked: 0,
        duration: Date.now() - startTime,
      }
    }

    let removalsFound = 0
    let tracksChecked = 0
    const removedTrackIds: string[] = []
    const batchSize = 50
    const maxBatches = Math.ceil(cachedTracks.length / batchSize)

    // Check batches of 50 tracks, starting with most recent
    for (let batchIndex = 0; batchIndex < maxBatches; batchIndex++) {
      const startIdx = batchIndex * batchSize
      const batch = cachedTracks.slice(startIdx, startIdx + batchSize)
      const trackIds = batch.map(t => t.trackId)

      console.log(`Checking batch ${batchIndex + 1}: tracks ${startIdx + 1}-${startIdx + batch.length}`)

      const result = await this.spotify.tracksAreSaved(trackIds)
      tracksChecked += trackIds.length

      if (result.removed.length > 0) {
        console.log(`Found ${result.removed.length} removed tracks in batch ${batchIndex + 1}`)
        removedTrackIds.push(...result.removed)
        removalsFound += result.removed.length
      }

      // Early exit: if we found all expected removals, stop checking
      if (removalsFound >= expectedRemovals) {
        console.log(`Found all ${expectedRemovals} expected removals. Early exit.`)
        break
      }

      // Safety: If we've checked 200 tracks (4 batches) without finding all removals,
      // and we haven't found any, consider falling back to full sync
      if (batchIndex >= 3 && removalsFound === 0 && expectedRemovals > 0) {
        console.log('Checked 4 batches without finding removals, may need full sync')
        return {
          status: 'needs_full_sync',
          removalsFound: 0,
          tracksChecked,
          duration: Date.now() - startTime,
        }
      }
    }

    // Delete removed tracks from cache
    if (removedTrackIds.length > 0) {
      await this.dynamo.deleteLikedSongsByIds(userId, removedTrackIds)
      console.log(`Deleted ${removedTrackIds.length} removed tracks from cache`)
    }

    return {
      status: 'completed',
      removalsFound,
      tracksChecked,
      duration: Date.now() - startTime,
      removedTrackIds,
    }
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
      let firstPageTrackIds: string[] = []

      while (true) {
        const response = await this.spotify.client.getMySavedTracks({
          limit: 50,
          offset
        })

        total = response.body.total

        // Capture first page track IDs for future comparison
        if (offset === 0) {
          firstPageTrackIds = response.body.items.map(item => item.track.id)
        }

        // Convert Spotify tracks to our cache format
        const tracks = response.body.items.map(item => {
          const addedAt = new Date(item.added_at).getTime()
          // Only update timestamps if addedAt is a valid number (not NaN)
          if (!isNaN(addedAt)) {
            mostRecentAddedAt = Math.max(mostRecentAddedAt, addedAt)
            oldestAddedAt = Math.min(oldestAddedAt, addedAt)
          }

          return this.convertToLikedSongItem(item.track, item.added_at, userId)
        })

        allTracks = allTracks.concat(tracks)

        if (!response.body.next) break
        offset += 50

        console.log(`Synced ${allTracks.length}/${total} liked songs`)
      }

      // Clear existing cache and write new data
      await this.dynamo.clearLikedSongs(userId)
      await this.dynamo.batchPutLikedSongs(allTracks)

      // Update metadata - ensure no NaN values
      const now = Date.now()
      const metadata: LikedSongsMetadata = {
        userId,
        totalTracks: total,
        lastSyncedAt: now,
        lastFullSyncAt: now,
        mostRecentAddedAt: isNaN(mostRecentAddedAt) ? now : mostRecentAddedAt,
        oldestAddedAt: isNaN(oldestAddedAt) ? now : oldestAddedAt,
        syncVersion: 1,
        syncStatus: 'synced',
        firstPageTrackIds, // Store for future change detection
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
   * @param metadata Current metadata
   * @param startTime Start time for duration calculation
   * @param currentFirstPageIds Optional first page IDs from change detection (to avoid re-fetching)
   */
  async incrementalSync(
    metadata: LikedSongsMetadata,
    startTime: number,
    currentFirstPageIds?: string[],
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
      let firstPageTrackIds: string[] = currentFirstPageIds || []
      // Sanitize incoming metadata value - use 0 if NaN so all tracks appear "new"
      let mostRecentAddedAt = isNaN(metadata.mostRecentAddedAt) ? 0 : metadata.mostRecentAddedAt

      while (!foundExisting) {
        const response = await this.spotify.client.getMySavedTracks({
          limit: 50,
          offset
        })

        total = response.body.total

        // Capture first page track IDs if not already provided
        if (offset === 0 && firstPageTrackIds.length === 0) {
          firstPageTrackIds = response.body.items.map(item => item.track.id)
        }

        for (const item of response.body.items) {
          const addedAt = new Date(item.added_at).getTime()

          // Skip tracks with invalid dates
          if (isNaN(addedAt)) {
            newTracks.push(this.convertToLikedSongItem(item.track, item.added_at, userId))
            continue
          }

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

        console.log(`Found ${newTracks.length} new liked songs`)
      }

      // Add new tracks to cache
      if (newTracks.length > 0) {
        await this.dynamo.batchPutLikedSongs(newTracks)
      }

      // Calculate tracks removed (if total decreased)
      const tracksRemoved = Math.max(0, metadata.totalTracks - total + newTracks.length)

      // Update metadata - ensure no NaN values
      const now = Date.now()
      const updatedMetadata: LikedSongsMetadata = {
        ...metadata,
        totalTracks: total,
        lastSyncedAt: now,
        mostRecentAddedAt: isNaN(mostRecentAddedAt) ? now : mostRecentAddedAt,
        oldestAddedAt: isNaN(metadata.oldestAddedAt) ? now : metadata.oldestAddedAt,
        syncVersion: (metadata.syncVersion || 0) + 1,
        syncStatus: 'synced',
        firstPageTrackIds, // Store for future change detection
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
    const addedAtTimestamp = new Date(addedAt).getTime()
    // Use current time as fallback if addedAt is invalid (NaN)
    const safeAddedAt = isNaN(addedAtTimestamp) ? Date.now() : addedAtTimestamp

    return {
      userId,
      trackId: track.id,
      trackUri: track.uri,
      trackName: track.name,
      artistName: track.artists[0]?.name || 'Unknown Artist',
      artistId: track.artists[0]?.id || '',
      albumName: track.album.name,
      albumId: track.album.id,
      addedAt: safeAddedAt,
      syncedAt: Date.now(),
      durationMs: track.duration_ms,
      popularity: track.popularity ?? 0,
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