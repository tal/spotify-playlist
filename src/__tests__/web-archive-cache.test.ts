import { expect, test } from 'bun:test'
import {
  ARCHIVE_CACHE_MS,
  cachedArchiveLoader,
  type ArchiveCacheEntry,
  type ArchiveFeed,
} from '../web/archive-cache'

function fixture() {
  let time = 0
  let entry: ArchiveCacheEntry | undefined
  let reads = 0
  const feed: ArchiveFeed = {
    generatedAt: 'original',
    trackCount: 2,
    tracks: ['a', 'b'].map((id) => ({
      id,
      uri: `spotify:track:${id}`,
      name: id,
      artist: 'Artist',
      album: 'Album',
      archivedAt: '2026-09-15',
      playlist: '2026 - September',
      playlistId: 'p',
      status: null,
      playsFromCurrent: 5,
    })),
  }
  const store = {
    read: async () => entry,
    write: async (value: ArchiveCacheEntry) => {
      entry = value
    },
  }
  const load = async () => {
    reads++
    return feed
  }
  return {
    store,
    load,
    loader: cachedArchiveLoader(load, store, () => time),
    setTime: (value: number) => {
      time = value
    },
    reads: () => reads,
  }
}

test('twelve-hour cache preserves generation time, shares limits, and expires at the boundary', async () => {
  const f = fixture()
  expect((await f.loader(1)).trackCount).toBe(1)
  f.setTime(ARCHIVE_CACHE_MS - 1)
  const cached = await f.loader(20)
  expect(cached.trackCount).toBe(2)
  expect(cached.generatedAt).toBe('original')
  expect(f.reads()).toBe(1)
  f.setTime(ARCHIVE_CACHE_MS)
  await f.loader(20)
  expect(f.reads()).toBe(2)
})

test('a new loader can reuse a stored result without gathering archives', async () => {
  const f = fixture()
  await f.loader(20)
  await cachedArchiveLoader(f.load, f.store, () => 1)(20)
  expect(f.reads()).toBe(1)
})

test('concurrent requests share one refresh', async () => {
  const f = fixture()
  const results = await Promise.all([f.loader(1), f.loader(20)])
  expect(results.map((result) => result.trackCount)).toEqual([1, 2])
  expect(f.reads()).toBe(1)
})

test('failed refreshes are not cached and can be retried', async () => {
  let attempts = 0
  let writes = 0
  const loader = cachedArchiveLoader(
    async () => {
      if (++attempts === 1) throw new Error('Spotify unavailable')
      return { generatedAt: 'new', tracks: [], trackCount: 0 }
    },
    {
      read: async () => undefined,
      write: async () => {
        writes++
      },
    },
  )
  await expect(loader(20)).rejects.toThrow('Spotify unavailable')
  expect(writes).toBe(0)
  expect((await loader(20)).tracks).toEqual([])
  expect(writes).toBe(1)
})
