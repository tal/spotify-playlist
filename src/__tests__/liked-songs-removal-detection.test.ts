import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test'

// Types for our mocks
type MockTrack = {
  trackId: string
  userId: string
  trackUri: string
  trackName: string
  artistName: string
  artistId: string
  albumName: string
  albumId: string
  addedAt: number
  syncedAt: number
  durationMs: number
  popularity: number
}

type ApiCallLog = {
  method: string
  args?: any
}

// Helper to create mock tracks
function createMockTracks(count: number, userId: string = 'test-user'): MockTrack[] {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => ({
    trackId: `track-${i}`,
    userId,
    trackUri: `spotify:track:track-${i}`,
    trackName: `Track ${i}`,
    artistName: `Artist ${i}`,
    artistId: `artist-${i}`,
    albumName: `Album ${i}`,
    albumId: `album-${i}`,
    addedAt: now - i * 1000, // Newest first, 1 second apart
    syncedAt: now,
    durationMs: 180000,
    popularity: 50,
  }))
}

// Mock classes that track API calls
class MockSpotify {
  apiCalls: ApiCallLog[] = []
  private savedTrackIds: Set<string>
  private _getMySavedTracksOverride: ((args: { limit: number }) => Promise<any>) | null = null

  constructor(savedTrackIds: string[] = []) {
    this.savedTrackIds = new Set(savedTrackIds)
  }

  // Simulate removing tracks (user unlikes them)
  removeTracks(trackIds: string[]) {
    trackIds.forEach(id => this.savedTrackIds.delete(id))
  }

  // Simulate adding tracks (user likes them)
  addTracks(trackIds: string[]) {
    trackIds.forEach(id => this.savedTrackIds.add(id))
  }

  // Allow overriding getMySavedTracks for specific tests
  setGetMySavedTracksResponse(handler: (args: { limit: number }) => Promise<any>) {
    this._getMySavedTracksOverride = handler
  }

  async tracksAreSaved(trackIds: string[]): Promise<{ saved: string[]; removed: string[] }> {
    this.apiCalls.push({ method: 'tracksAreSaved', args: { count: trackIds.length } })

    const saved: string[] = []
    const removed: string[] = []

    trackIds.forEach(id => {
      if (this.savedTrackIds.has(id)) {
        saved.push(id)
      } else {
        removed.push(id)
      }
    })

    return { saved, removed }
  }

  get client() {
    const self = this
    return {
      getMySavedTracks: async (args: { limit: number }) => {
        self.apiCalls.push({ method: 'getMySavedTracks', args })
        if (self._getMySavedTracksOverride) {
          return self._getMySavedTracksOverride(args)
        }
        return {
          body: {
            total: self.savedTrackIds.size,
            items: [],
            next: null,
          },
        }
      },
    }
  }

  resetCallLog() {
    this.apiCalls = []
  }
}

class MockDynamo {
  apiCalls: ApiCallLog[] = []
  private likedSongs: MockTrack[] = []
  private metadata: any = null
  user = { id: 'test-user' }

  setLikedSongs(tracks: MockTrack[]) {
    this.likedSongs = [...tracks]
  }

  setMetadata(metadata: any) {
    this.metadata = metadata
  }

  async getLikedSongs(userId: string): Promise<MockTrack[]> {
    this.apiCalls.push({ method: 'getLikedSongs', args: { userId } })
    return this.likedSongs
  }

  async getLikedSongsMetadata(userId: string) {
    this.apiCalls.push({ method: 'getLikedSongsMetadata', args: { userId } })
    return this.metadata
  }

  async deleteLikedSongsByIds(userId: string, trackIds: string[]): Promise<number> {
    this.apiCalls.push({ method: 'deleteLikedSongsByIds', args: { userId, count: trackIds.length } })
    this.likedSongs = this.likedSongs.filter(t => !trackIds.includes(t.trackId))
    return trackIds.length
  }

  async updateLikedSongsMetadata(metadata: any) {
    this.apiCalls.push({ method: 'updateLikedSongsMetadata', args: metadata })
    this.metadata = { ...this.metadata, ...metadata }
  }

  resetCallLog() {
    this.apiCalls = []
  }
}

// The actual class under test (simplified version for testing)
class LikedSongsCacheTestable {
  constructor(
    private dynamo: MockDynamo,
    private spotify: MockSpotify,
  ) {}

  async detectAndRemoveDeletedTracks(
    metadata: { totalTracks: number },
    expectedRemovals: number,
  ): Promise<{
    status: 'completed' | 'needs_full_sync' | 'no_cached_tracks'
    removalsFound: number
    tracksChecked: number
    duration: number
    removedTrackIds?: string[]
  }> {
    const userId = this.dynamo.user.id
    const startTime = Date.now()

    const cachedTracks = await this.dynamo.getLikedSongs(userId)

    if (cachedTracks.length === 0) {
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

    for (let batchIndex = 0; batchIndex < maxBatches; batchIndex++) {
      const startIdx = batchIndex * batchSize
      const batch = cachedTracks.slice(startIdx, startIdx + batchSize)
      const trackIds = batch.map(t => t.trackId)

      const result = await this.spotify.tracksAreSaved(trackIds)
      tracksChecked += trackIds.length

      if (result.removed.length > 0) {
        removedTrackIds.push(...result.removed)
        removalsFound += result.removed.length
      }

      // Early exit: if we found all expected removals, stop checking
      if (removalsFound >= expectedRemovals) {
        break
      }

      // Safety: If we've checked 200 tracks (4 batches) without finding all removals,
      // and we haven't found any, consider falling back to full sync
      if (batchIndex >= 3 && removalsFound === 0 && expectedRemovals > 0) {
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
    }

    return {
      status: 'completed',
      removalsFound,
      tracksChecked,
      duration: Date.now() - startTime,
      removedTrackIds,
    }
  }

  async detectChanges(metadata: { totalTracks: number; mostRecentAddedAt: number; firstPageTrackIds?: string[] } | undefined): Promise<{
    changeType: 'none' | 'additions' | 'removals' | 'additions_and_removals' | 'unknown'
    estimatedNewTracks: number
    estimatedRemovals: number
    currentTotal?: number
    currentFirstPageIds?: string[]
    removalsInFirstPage?: number
  }> {
    if (!metadata) {
      return { changeType: 'unknown', estimatedNewTracks: 0, estimatedRemovals: 0 }
    }

    const countResponse = await this.spotify.client.getMySavedTracks({ limit: 1 })
    const currentTotal = countResponse.body.total

    // Extract current first page IDs from the response
    const currentFirstPageIds = countResponse.body.items?.map((item: any) => item.track.id) || []

    const diff = currentTotal - metadata.totalTracks

    // Count how many stored first page IDs are NOT in the current first page
    const removalsInFirstPage = this.countFirstPageRemovals(
      metadata.firstPageTrackIds,
      currentFirstPageIds
    )

    if (diff > 0) {
      return {
        changeType: 'additions',
        estimatedNewTracks: diff,
        estimatedRemovals: 0,
        currentTotal,
        currentFirstPageIds,
        removalsInFirstPage,
      }
    } else if (diff < 0) {
      return {
        changeType: 'removals',
        estimatedNewTracks: 0,
        estimatedRemovals: Math.abs(diff),
        currentTotal,
        currentFirstPageIds,
        removalsInFirstPage,
      }
    }

    // Total is the same - check if first page has changed (indicates churn)
    if (metadata.firstPageTrackIds && currentFirstPageIds.length > 0) {
      if (!this.arraysEqual(metadata.firstPageTrackIds, currentFirstPageIds)) {
        // First page changed but total same = additions and removals cancelled out
        return {
          changeType: 'additions_and_removals',
          estimatedNewTracks: removalsInFirstPage, // At least as many additions as removals in first page
          estimatedRemovals: removalsInFirstPage,
          currentTotal,
          currentFirstPageIds,
          removalsInFirstPage,
        }
      }
    }

    return {
      changeType: 'none',
      estimatedNewTracks: 0,
      estimatedRemovals: 0,
      currentTotal,
      currentFirstPageIds,
      removalsInFirstPage: 0,
    }
  }

  private countFirstPageRemovals(
    storedFirstPageIds: string[] | undefined,
    currentFirstPageIds: string[]
  ): number {
    if (!storedFirstPageIds || storedFirstPageIds.length === 0) {
      return 0
    }
    const currentSet = new Set(currentFirstPageIds)
    return storedFirstPageIds.filter(id => !currentSet.has(id)).length
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    return a.every((val, idx) => val === b[idx])
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('LikedSongsCache Removal Detection', () => {
  let mockSpotify: MockSpotify
  let mockDynamo: MockDynamo
  let cache: LikedSongsCacheTestable

  beforeEach(() => {
    mockDynamo = new MockDynamo()
    // Will be set up per test
  })

  describe('Small library scenarios (< 100 tracks)', () => {
    it('should detect 1 removal in first batch with 1 API call', async () => {
      const tracks = createMockTracks(50)
      const allTrackIds = tracks.map(t => t.trackId)

      // Remove track-5 from Spotify
      const savedIds = allTrackIds.filter(id => id !== 'track-5')
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 50 }, 1)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(1)
      expect(result.removedTrackIds).toContain('track-5')

      // Should only need 1 tracksAreSaved call (50 tracks in first batch)
      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(1)
    })

    it('should detect 3 removals in first batch with 1 API call', async () => {
      const tracks = createMockTracks(50)
      const allTrackIds = tracks.map(t => t.trackId)

      // Remove 3 tracks
      const removedIds = ['track-2', 'track-10', 'track-25']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 50 }, 3)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(3)
      expect(result.removedTrackIds).toEqual(expect.arrayContaining(removedIds))

      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(1)
    })

    it('should detect 0 removals when none exist', async () => {
      const tracks = createMockTracks(50)
      const allTrackIds = tracks.map(t => t.trackId)

      mockSpotify = new MockSpotify(allTrackIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      // Pass 0 expected removals
      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 50 }, 0)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(0)

      // Still checks first batch to be sure
      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(1)
    })
  })

  describe('Medium library scenarios (100-500 tracks)', () => {
    it('should detect 2 removals in first batch and early exit', async () => {
      const tracks = createMockTracks(200)
      const allTrackIds = tracks.map(t => t.trackId)

      // Remove 2 recent tracks (they're in the first batch)
      const removedIds = ['track-3', 'track-15']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 200 }, 2)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(2)

      // Early exit after first batch since we found all 2 expected removals
      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(1)
    })

    it('should check 2 batches when removal is in second batch', async () => {
      const tracks = createMockTracks(200)
      const allTrackIds = tracks.map(t => t.trackId)

      // Remove track from second batch (index 60)
      const removedIds = ['track-60']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 200 }, 1)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(1)

      // First batch: 0 found, second batch: 1 found = 2 calls total
      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(2)
    })

    it('should check 3 batches when removal is in third batch', async () => {
      const tracks = createMockTracks(300)
      const allTrackIds = tracks.map(t => t.trackId)

      // Remove track from third batch (index 120)
      const removedIds = ['track-120']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 300 }, 1)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(1)

      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(3)
    })
  })

  describe('Large library scenarios (7000+ tracks)', () => {
    it('should detect 5 recent removals with only 1 API call (7500 tracks)', async () => {
      const tracks = createMockTracks(7500)
      const allTrackIds = tracks.map(t => t.trackId)

      // Remove 5 recent tracks (in first batch)
      const removedIds = ['track-1', 'track-10', 'track-20', 'track-30', 'track-40']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 7500 }, 5)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(5)

      // Early exit - found all 5 in first batch
      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(1)

      // Verify we only checked 50 tracks, not all 7500
      expect(result.tracksChecked).toBe(50)
    })

    it('should detect 3 removals spread across first 2 batches with 2 API calls (7000 tracks)', async () => {
      const tracks = createMockTracks(7000)
      const allTrackIds = tracks.map(t => t.trackId)

      // Remove 1 from first batch, 2 from second batch
      const removedIds = ['track-25', 'track-55', 'track-75']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 7000 }, 3)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(3)

      // 1 found in batch 1, 2 more found in batch 2 = 3 total, exit
      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(2)

      expect(result.tracksChecked).toBe(100) // 2 batches of 50
    })

    it('should trigger full sync fallback when no removals found in first 4 batches (7000 tracks)', async () => {
      const tracks = createMockTracks(7000)
      const allTrackIds = tracks.map(t => t.trackId)

      // Remove tracks that are way deep (index 500+, outside first 4 batches)
      const removedIds = ['track-500', 'track-600', 'track-700']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 7000 }, 3)

      // Should fallback to full sync after 4 batches with no hits
      expect(result.status).toBe('needs_full_sync')
      expect(result.removalsFound).toBe(0)

      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(4) // Checked 4 batches then gave up

      expect(result.tracksChecked).toBe(200) // 4 batches of 50
    })

    it('should handle maximum efficiency case: 1 recent removal in 10000 track library', async () => {
      const tracks = createMockTracks(10000)
      const allTrackIds = tracks.map(t => t.trackId)

      // Remove the most recent track
      const removedIds = ['track-0']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 10000 }, 1)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(1)

      // Only 1 API call needed!
      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(1)

      // Only checked 50 tracks out of 10000
      expect(result.tracksChecked).toBe(50)
    })
  })

  describe('Large library with random/middle removals (realistic scenarios)', () => {
    it('should need 4 batches for removal at index 150 in 7000 track library', async () => {
      const tracks = createMockTracks(7000)
      const allTrackIds = tracks.map(t => t.trackId)

      // Removal in batch 4 (index 150-199)
      const removedIds = ['track-175']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 7000 }, 1)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(1)

      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(4)
      expect(result.tracksChecked).toBe(200)
    })

    it('should fallback to full sync for removal at index 250 in 10000 track library', async () => {
      const tracks = createMockTracks(10000)
      const allTrackIds = tracks.map(t => t.trackId)

      // Removal outside first 4 batches (index 250)
      const removedIds = ['track-250']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 10000 }, 1)

      // Falls back after 4 batches with no hits
      expect(result.status).toBe('needs_full_sync')

      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(4)
    })

    it('should fallback to full sync for removal in middle of 7000 track library (index 3500)', async () => {
      const tracks = createMockTracks(7000)
      const allTrackIds = tracks.map(t => t.trackId)

      // Removal right in the middle
      const removedIds = ['track-3500']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 7000 }, 1)

      expect(result.status).toBe('needs_full_sync')
      expect(result.tracksChecked).toBe(200) // Only checked 4 batches before giving up
    })

    it('should fallback for removal near end of 10000 track library (index 9500)', async () => {
      const tracks = createMockTracks(10000)
      const allTrackIds = tracks.map(t => t.trackId)

      // Removal near the end (very old track)
      const removedIds = ['track-9500']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 10000 }, 1)

      expect(result.status).toBe('needs_full_sync')

      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(4) // Gives up after 4 batches
    })

    it('should scan deep into library when looking for expected removals (mixed scenario)', async () => {
      const tracks = createMockTracks(7000)
      const allTrackIds = tracks.map(t => t.trackId)

      // One removal in batch 2, one deep in the library (batch 71)
      const removedIds = ['track-75', 'track-3500']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      // Expect 2 removals - algorithm will keep looking until it finds both
      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 7000 }, 2)

      // Will find BOTH because it keeps scanning after finding first one
      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(2)

      // Had to scan 71 batches to find both (3500/50 = 70, so batch 71)
      // This is a WORST CASE scenario - way more calls than a full sync would be
      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(71) // track-3500 is in batch 71
    })

    it('should early exit when all expected removals found in recent batches', async () => {
      const tracks = createMockTracks(7000)
      const allTrackIds = tracks.map(t => t.trackId)

      // Both removals in first 2 batches
      const removedIds = ['track-25', 'track-75']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 7000 }, 2)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(2)

      // Early exit after batch 2 since we found all 2 expected
      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(2)
    })

    it('should handle random removal positions with statistical distribution', async () => {
      type RemovalStatus = 'completed' | 'needs_full_sync' | 'no_cached_tracks'

      // Simulate different random removal positions
      const testCases: { index: number; expectedBatches: number; description: string; expectedStatus?: RemovalStatus }[] = [
        { index: 25, expectedBatches: 1, description: 'batch 1' },
        { index: 75, expectedBatches: 2, description: 'batch 2' },
        { index: 125, expectedBatches: 3, description: 'batch 3' },
        { index: 175, expectedBatches: 4, description: 'batch 4' },
        { index: 225, expectedBatches: 4, description: 'beyond batch 4 (fallback)', expectedStatus: 'needs_full_sync' },
        { index: 500, expectedBatches: 4, description: 'index 500 (fallback)', expectedStatus: 'needs_full_sync' },
        { index: 3500, expectedBatches: 4, description: 'middle (fallback)', expectedStatus: 'needs_full_sync' },
        { index: 6999, expectedBatches: 4, description: 'last track (fallback)', expectedStatus: 'needs_full_sync' },
      ]

      for (const tc of testCases) {
        const tracks = createMockTracks(7000)
        const allTrackIds = tracks.map(t => t.trackId)
        const removedIds = [`track-${tc.index}`]
        const savedIds = allTrackIds.filter(id => !removedIds.includes(id))

        mockSpotify = new MockSpotify(savedIds)
        mockDynamo = new MockDynamo()
        mockDynamo.setLikedSongs(tracks)

        cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

        const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 7000 }, 1)

        const expectedStatus: RemovalStatus = tc.expectedStatus || 'completed'
        expect(result.status).toBe(expectedStatus)

        const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
        expect(spotifyCalls.length).toBe(tc.expectedBatches)
      }
    })
  })

  describe('Edge cases', () => {
    it('should handle empty cache', async () => {
      mockSpotify = new MockSpotify([])
      mockDynamo.setLikedSongs([])

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 0 }, 0)

      expect(result.status).toBe('no_cached_tracks')
      expect(result.removalsFound).toBe(0)

      // No Spotify API calls needed
      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(0)
    })

    it('should handle more removals found than expected', async () => {
      const tracks = createMockTracks(100)
      const allTrackIds = tracks.map(t => t.trackId)

      // Remove 5 tracks but only expect 2
      const removedIds = ['track-5', 'track-10', 'track-15', 'track-20', 'track-25']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      // Only expect 2, but will find 5 in first batch
      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 100 }, 2)

      expect(result.status).toBe('completed')
      // Should still exit after finding >= expected (2), but reports actual found (5)
      expect(result.removalsFound).toBe(5)

      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(1)
    })

    it('should handle fewer removals found than expected (continue checking)', async () => {
      const tracks = createMockTracks(150)
      const allTrackIds = tracks.map(t => t.trackId)

      // Remove only 1 track but expect 3
      const removedIds = ['track-5']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 150 }, 3)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(1)

      // Will check all 3 batches looking for the expected 3
      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(3)
    })

    it('should handle partial last batch correctly', async () => {
      // 75 tracks = 1 full batch (50) + 1 partial batch (25)
      const tracks = createMockTracks(75)
      const allTrackIds = tracks.map(t => t.trackId)

      // Remove track from second (partial) batch
      const removedIds = ['track-60']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 75 }, 1)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(1)

      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(2)

      // First batch: 50 tracks, second batch: 25 tracks
      expect(result.tracksChecked).toBe(75)
    })

    it('should handle exactly 50 tracks (single batch)', async () => {
      const tracks = createMockTracks(50)
      const allTrackIds = tracks.map(t => t.trackId)

      const removedIds = ['track-25']
      const savedIds = allTrackIds.filter(id => !removedIds.includes(id))
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectAndRemoveDeletedTracks({ totalTracks: 50 }, 1)

      expect(result.status).toBe('completed')
      expect(result.removalsFound).toBe(1)

      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved')
      expect(spotifyCalls.length).toBe(1)
    })
  })

  describe('First page comparison for smart detection', () => {
    it('should detect churn when total same but first page changed', async () => {
      const tracks = createMockTracks(100)
      const allTrackIds = tracks.map(t => t.trackId)

      // Stored first page: [track-0 through track-49]
      const storedFirstPageIds = allTrackIds.slice(0, 50)

      // Current state: removed track-10, added new-track-1 (total same)
      // New first page would be: [new-track-1, track-0, track-1, ..., track-9, track-11, ...]
      const currentFirstPage = ['new-track-1', ...allTrackIds.slice(0, 10), ...allTrackIds.slice(11, 50)]

      mockSpotify = new MockSpotify([...allTrackIds.filter(id => id !== 'track-10'), 'new-track-1'])
      mockDynamo.setLikedSongs(tracks)
      mockDynamo.setMetadata({
        userId: 'test-user',
        totalTracks: 100, // Same as before
        mostRecentAddedAt: Date.now() - 1000,
        firstPageTrackIds: storedFirstPageIds, // Stored from last sync
      })

      // Set up mock BEFORE creating cache
      mockSpotify.setGetMySavedTracksResponse(async () => ({
        body: {
          total: 100, // Total unchanged
          items: currentFirstPage.map(id => ({
            track: { id },
            added_at: new Date().toISOString(),
          })),
          next: null,
        },
      }))

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectChanges({
        totalTracks: 100,
        mostRecentAddedAt: Date.now() - 1000,
        firstPageTrackIds: storedFirstPageIds,
      } as any)

      expect(result.changeType).toBe('additions_and_removals')
      expect(result.estimatedNewTracks).toBeGreaterThan(0)
      expect(result.estimatedRemovals).toBeGreaterThan(0)
    })

    it('should detect no changes when first page matches exactly', async () => {
      const tracks = createMockTracks(100)
      const firstPageIds = tracks.slice(0, 50).map(t => t.trackId)

      mockSpotify = new MockSpotify(tracks.map(t => t.trackId))
      mockDynamo.setLikedSongs(tracks)

      // Set up mock to return same first page
      mockSpotify.setGetMySavedTracksResponse(async () => ({
        body: {
          total: 100,
          items: firstPageIds.map(id => ({
            track: { id },
            added_at: new Date().toISOString(),
          })),
          next: null,
        },
      }))

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectChanges({
        totalTracks: 100,
        mostRecentAddedAt: Date.now(),
        firstPageTrackIds: firstPageIds,
      } as any)

      expect(result.changeType).toBe('none')
    })

    it('should identify removals in first page for optimized detection', async () => {
      const tracks = createMockTracks(100)
      const allTrackIds = tracks.map(t => t.trackId)

      // Stored: [track-0 through track-49]
      const storedFirstPageIds = allTrackIds.slice(0, 50)

      // Current: track-5 and track-10 removed, so track-50 and track-51 moved up
      // But total decreased by 2
      const currentFirstPageIds = [
        ...allTrackIds.slice(0, 5),
        ...allTrackIds.slice(6, 10),
        ...allTrackIds.slice(11, 50),
        'track-50', 'track-51'
      ]

      mockSpotify = new MockSpotify(allTrackIds.filter(id => id !== 'track-5' && id !== 'track-10'))
      mockDynamo.setLikedSongs(tracks)

      // Set up mock BEFORE creating cache
      mockSpotify.setGetMySavedTracksResponse(async () => ({
        body: {
          total: 98, // 2 removed
          items: currentFirstPageIds.map(id => ({
            track: { id },
            added_at: new Date().toISOString(),
          })),
          next: null,
        },
      }))

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectChanges({
        totalTracks: 100,
        mostRecentAddedAt: Date.now(),
        firstPageTrackIds: storedFirstPageIds,
      } as any)

      expect(result.changeType).toBe('removals')
      expect(result.estimatedRemovals).toBe(2)
      // Should detect that track-5 and track-10 are missing from first page
      expect(result.removalsInFirstPage).toBe(2)
    })
  })

  describe('Change detection', () => {
    it('should detect removals when total decreases', async () => {
      const tracks = createMockTracks(100)
      const allTrackIds = tracks.map(t => t.trackId)

      // 95 tracks saved (5 removed)
      const savedIds = allTrackIds.slice(0, 95)
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectChanges({
        totalTracks: 100,
        mostRecentAddedAt: Date.now(),
      })

      expect(result.changeType).toBe('removals')
      expect(result.estimatedRemovals).toBe(5)
      expect(result.currentTotal).toBe(95)

      // Only 1 API call needed for count check
      const spotifyCalls = mockSpotify.apiCalls.filter(c => c.method === 'getMySavedTracks')
      expect(spotifyCalls.length).toBe(1)
    })

    it('should detect additions when total increases', async () => {
      const tracks = createMockTracks(100)
      const allTrackIds = tracks.map(t => t.trackId)

      // 105 tracks saved (5 added)
      const savedIds = [...allTrackIds, 'new-1', 'new-2', 'new-3', 'new-4', 'new-5']
      mockSpotify = new MockSpotify(savedIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectChanges({
        totalTracks: 100,
        mostRecentAddedAt: Date.now(),
      })

      expect(result.changeType).toBe('additions')
      expect(result.estimatedNewTracks).toBe(5)
      expect(result.currentTotal).toBe(105)
    })

    it('should detect no changes when total is same', async () => {
      const tracks = createMockTracks(100)
      const allTrackIds = tracks.map(t => t.trackId)

      mockSpotify = new MockSpotify(allTrackIds)
      mockDynamo.setLikedSongs(tracks)

      cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

      const result = await cache.detectChanges({
        totalTracks: 100,
        mostRecentAddedAt: Date.now(),
      })

      expect(result.changeType).toBe('none')
      expect(result.estimatedNewTracks).toBe(0)
      expect(result.estimatedRemovals).toBe(0)
    })
  })

  describe('API call counting summary', () => {
    it('SUMMARY: API calls for various scenarios with recent removals', async () => {
      // All scenarios assume removals happen in the FIRST batch (most common case)
      const scenarios = [
        { librarySize: 50, removals: 1, expectedCalls: 1 },
        { librarySize: 100, removals: 2, expectedCalls: 1 },
        { librarySize: 200, removals: 1, expectedCalls: 1 },
        { librarySize: 500, removals: 3, expectedCalls: 1 },
        { librarySize: 1000, removals: 1, expectedCalls: 1 },
        { librarySize: 5000, removals: 5, expectedCalls: 1 },
        { librarySize: 7000, removals: 1, expectedCalls: 1 },
        { librarySize: 7500, removals: 5, expectedCalls: 1 },
        { librarySize: 10000, removals: 1, expectedCalls: 1 },
      ]

      const results: { scenario: string; expected: number; actual: number; pass: boolean }[] = []

      for (const scenario of scenarios) {
        const tracks = createMockTracks(scenario.librarySize)
        const allTrackIds = tracks.map(t => t.trackId)

        // Remove tracks from first batch (most recent)
        const removedIds = allTrackIds.slice(0, scenario.removals)
        const savedIds = allTrackIds.filter(id => !removedIds.includes(id))

        mockSpotify = new MockSpotify(savedIds)
        mockDynamo = new MockDynamo()
        mockDynamo.setLikedSongs(tracks)

        cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

        await cache.detectAndRemoveDeletedTracks({ totalTracks: scenario.librarySize }, scenario.removals)

        const actualCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved').length

        results.push({
          scenario: `${scenario.librarySize} tracks, ${scenario.removals} recent removals`,
          expected: scenario.expectedCalls,
          actual: actualCalls,
          pass: actualCalls === scenario.expectedCalls,
        })

        expect(actualCalls).toBe(scenario.expectedCalls)
      }

      // Log summary for visibility
      console.log('\n📊 API Call Summary (Recent Removals - Best Case):')
      console.log('='.repeat(70))
      results.forEach(r => {
        const status = r.pass ? '✅' : '❌'
        console.log(`${status} ${r.scenario}: ${r.actual} call(s)`)
      })
      console.log('='.repeat(70))
    })

    it('SUMMARY: API calls when removals are deeper in library', async () => {
      // Scenarios where removals are NOT in the first batch
      const scenarios = [
        { librarySize: 200, removalIndex: 60, expectedCalls: 2, description: 'removal in batch 2' },
        { librarySize: 300, removalIndex: 120, expectedCalls: 3, description: 'removal in batch 3' },
        { librarySize: 500, removalIndex: 180, expectedCalls: 4, description: 'removal in batch 4' },
        { librarySize: 7000, removalIndex: 25, expectedCalls: 1, description: 'removal in batch 1' },
        { librarySize: 7000, removalIndex: 75, expectedCalls: 2, description: 'removal in batch 2' },
      ]

      const results: { scenario: string; expected: number; actual: number; pass: boolean }[] = []

      for (const scenario of scenarios) {
        const tracks = createMockTracks(scenario.librarySize)
        const allTrackIds = tracks.map(t => t.trackId)

        // Remove specific track by index
        const removedIds = [`track-${scenario.removalIndex}`]
        const savedIds = allTrackIds.filter(id => !removedIds.includes(id))

        mockSpotify = new MockSpotify(savedIds)
        mockDynamo = new MockDynamo()
        mockDynamo.setLikedSongs(tracks)

        cache = new LikedSongsCacheTestable(mockDynamo, mockSpotify)

        await cache.detectAndRemoveDeletedTracks({ totalTracks: scenario.librarySize }, 1)

        const actualCalls = mockSpotify.apiCalls.filter(c => c.method === 'tracksAreSaved').length

        results.push({
          scenario: `${scenario.librarySize} tracks, ${scenario.description}`,
          expected: scenario.expectedCalls,
          actual: actualCalls,
          pass: actualCalls === scenario.expectedCalls,
        })

        expect(actualCalls).toBe(scenario.expectedCalls)
      }

      // Log summary for visibility
      console.log('\n📊 API Call Summary (Deeper Removals):')
      console.log('='.repeat(70))
      results.forEach(r => {
        const status = r.pass ? '✅' : '❌'
        console.log(`${status} ${r.scenario}: ${r.actual} call(s)`)
      })
      console.log('='.repeat(70))
    })

    it('SUMMARY: Comparison with full sync approach', async () => {
      // Compare API calls: removal detection vs full sync
      const librarySizes = [100, 500, 1000, 5000, 7000, 10000]

      console.log('\n📊 Efficiency Comparison: Removal Detection vs Full Sync')
      console.log('='.repeat(80))
      console.log('Library Size | Full Sync | Best Case | Worst Case* | Random Middle**')
      console.log('-'.repeat(80))

      for (const size of librarySizes) {
        const fullSyncCalls = Math.ceil(size / 50)
        const bestCase = 1 // Recent removal
        const worstCase = 4 // Falls back to full sync after 4 batches
        const randomMiddle = '4 + full' // Fallback triggers full sync

        console.log(
          `${size.toString().padStart(12)} | ${fullSyncCalls.toString().padStart(9)} | ${bestCase.toString().padStart(9)} | ${worstCase.toString().padStart(11)} | ${randomMiddle.padStart(14)}`
        )
      }
      console.log('-'.repeat(80))
      console.log('* Worst case: removal beyond first 200 tracks, triggers 4 calls then full sync')
      console.log('** Random middle: removal in middle of library triggers fallback')
      console.log('='.repeat(80))

      expect(true).toBe(true)
    })

    it('SUMMARY: Realistic scenario outcomes for 7000 track library', async () => {
      console.log('\n📊 Realistic Outcomes for 7000 Track Library')
      console.log('='.repeat(80))
      console.log('Removal Location     | Index Range | API Calls | Outcome')
      console.log('-'.repeat(80))

      const scenarios = [
        { location: 'Very recent', range: '0-49', calls: 1, outcome: 'SUCCESS' },
        { location: 'Recent', range: '50-99', calls: 2, outcome: 'SUCCESS' },
        { location: 'Fairly recent', range: '100-149', calls: 3, outcome: 'SUCCESS' },
        { location: 'Somewhat recent', range: '150-199', calls: 4, outcome: 'SUCCESS' },
        { location: 'Not recent', range: '200-499', calls: 4, outcome: 'FALLBACK → full sync' },
        { location: 'Middle', range: '500-3500', calls: 4, outcome: 'FALLBACK → full sync' },
        { location: 'Old', range: '3500-6999', calls: 4, outcome: 'FALLBACK → full sync' },
      ]

      scenarios.forEach(s => {
        console.log(
          `${s.location.padEnd(20)} | ${s.range.padEnd(11)} | ${s.calls.toString().padEnd(9)} | ${s.outcome}`
        )
      })

      console.log('-'.repeat(80))
      console.log('Full sync for 7000 tracks = 140 API calls')
      console.log('Removal detection best case = 1 API call (99.3% savings)')
      console.log('Removal detection worst case = 4 API calls + 140 for full sync')
      console.log('='.repeat(80))

      expect(true).toBe(true)
    })

    it('SUMMARY: When removal detection wins vs loses', async () => {
      console.log('\n📊 When to Use Removal Detection vs Full Sync')
      console.log('='.repeat(80))

      console.log('\n✅ REMOVAL DETECTION WINS when:')
      console.log('   - User unlikes something they JUST liked (most common)')
      console.log('   - Removal is in first 200 tracks (first 4 batches)')
      console.log('   - Multiple removals but at least one is recent')

      console.log('\n❌ REMOVAL DETECTION LOSES when:')
      console.log('   - User unlikes an old track from months/years ago')
      console.log('   - Removal is beyond index 200')
      console.log('   - Results in 4 wasted calls + full sync anyway')

      console.log('\n📈 PROBABILITY ANALYSIS (assuming uniform random unliking):')
      console.log('   - 7000 track library: 200/7000 = 2.9% chance of success')
      console.log('   - 1000 track library: 200/1000 = 20% chance of success')
      console.log('   - 200 track library: 200/200 = 100% chance of success')

      console.log('\n💡 RECOMMENDATION:')
      console.log('   - For libraries < 500 tracks: Always use removal detection')
      console.log('   - For libraries > 2000 tracks: Consider user behavior')
      console.log('   - If users typically unlike recent tracks: Use removal detection')
      console.log('   - If users unlike random old tracks: Consider full sync')
      console.log('='.repeat(80))

      expect(true).toBe(true)
    })
  })
})
