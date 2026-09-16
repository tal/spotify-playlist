import type { archivedPlan } from './archived'

export const ARCHIVE_CACHE_MS = 12 * 60 * 60 * 1000
export type ArchiveFeed = ReturnType<typeof archivedPlan>
export type ArchiveCacheEntry = { expiresAt: number; feed: ArchiveFeed }
export type ArchiveCacheStore = {
  read: () => Promise<ArchiveCacheEntry | undefined>
  write: (entry: ArchiveCacheEntry) => Promise<void>
}

/** Cache the full twenty entries, so smaller limits cannot truncate later reads. */
export function cachedArchiveLoader(
  load: () => Promise<ArchiveFeed>,
  store: ArchiveCacheStore,
  now: () => number = Date.now,
) {
  let pending: Promise<ArchiveFeed> | undefined
  async function refreshOrRead() {
    const cached = await store.read()
    if (cached && cached.expiresAt > now()) return cached.feed
    const feed = await load()
    await store.write({ feed, expiresAt: now() + ARCHIVE_CACHE_MS })
    return feed
  }
  return async (limit: number): Promise<ArchiveFeed> => {
    pending ??= refreshOrRead().finally(() => {
      pending = undefined
    })
    const feed = await pending
    const tracks = feed.tracks.slice(0, limit)
    return { ...feed, tracks, trackCount: tracks.length }
  }
}
