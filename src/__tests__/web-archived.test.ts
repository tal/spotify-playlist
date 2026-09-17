import { expect, test } from 'bun:test'
import { archivedPlan, type ArchiveEntry } from '../web/archived'
const entry = (
  id: string,
  addedAt: string,
  playlist = '2025 - January',
): ArchiveEntry => ({
  playlistId: playlist,
  playlist,
  addedAt,
  track: {
    id,
    uri: `spotify:track:${id}`,
    name: id,
    artist: 'Artist',
    album: 'Album',
  },
})

test('archives order by actual addition date, include repeated tracks and older month additions', () => {
  const result = archivedPlan(
    [
      entry('a', '2026-09-10', '2026 - September'),
      entry('a', '2026-09-15'),
      entry('b', '2026-09-12'),
      { ...entry('c', '2026-09-16'), track: null },
      entry('d', 'invalid'),
    ],
    { a: { status: 'removed', play_count_current: 7 } as TrackItem },
    0,
    3,
  )
  expect(result.tracks.map((t) => t.id)).toEqual(['a', 'b', 'a'])
  expect(result.tracks[0]).toMatchObject({
    playlist: '2025 - January',
    archivedAt: '2026-09-15',
    status: 'removed',
    playsFromCurrent: 7,
  })
  expect(result.tracks[1]).toMatchObject({ status: null, playsFromCurrent: 0 })
  expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z')
})

test('archive limit is applied after sorting and empty results are valid', () => {
  expect(
    archivedPlan(
      [entry('a', '2026-09-01'), entry('b', '2026-09-02')],
      {},
      0,
      1,
    ).tracks.map((t) => t.id),
  ).toEqual(['b'])
  expect(archivedPlan([], {}, 0).tracks).toEqual([])
})

const item = (id: string, added_at: string) => ({
  added_at,
  track: {
    id,
    uri: `spotify:track:${id}`,
    name: id,
    artists: [{ name: 'Artist' }],
    album: { name: 'Album' },
  },
})

// allPlaylists() returns library order, not month order; the newest archive is
// deliberately buried and the older months come before it, so a naive read
// would visit them first. Non-archive and dev-prefixed names must be skipped.
const archiveCtx = (
  visited: string[],
  joined: string[][],
  tracks: Record<string, ReturnType<typeof item>[]>,
) =>
  ({
    now: 0,
    settings: { current: 'Current' },
    client: {
      allPlaylists: async () => [
        { id: 'old', name: '2012 - May' },
        { id: 'mid', name: '2026 - August' },
        { id: 'new', name: '2026 - September' },
        { id: 'other', name: 'Starred' },
        { id: 'test', name: '[Test] 2026 - September' },
      ],
      tracksForPlaylist: async ({ id }: { id: string }) => {
        visited.push(id)
        return tracks[id] ?? []
      },
    },
    dynamo: {
      getTracks: async (ids: string[]) => {
        joined.push(ids)
        return {}
      },
    },
  }) as unknown as import('../actions/action').PerformContext

test('gather reads the newest month first and stops once the limit is filled', async () => {
  const { gatherArchived } = await import('../web/archived')
  const visited: string[] = []
  const joined: string[][] = []
  const ctx = archiveCtx(visited, joined, {
    new: [item('s1', '2026-09-10'), item('s2', '2026-09-11')],
    mid: [item('a1', '2026-08-01')],
    old: [item('o1', '2012-05-01')],
  })
  const result = await gatherArchived(ctx, 2)
  // Only the newest month is read; August and May are never visited.
  expect(visited).toEqual(['new'])
  // Newest added_at first, and only the selected ids are joined against Dynamo.
  expect(result.tracks.map((t) => t.id)).toEqual(['s2', 's1'])
  expect(joined).toEqual([['s2', 's1']])
})

test('gather keeps reading older months until the display limit is filled', async () => {
  const { gatherArchived } = await import('../web/archived')
  const visited: string[] = []
  const joined: string[][] = []
  const ctx = archiveCtx(visited, joined, {
    new: [item('s1', '2026-09-10')],
    mid: [item('a1', '2026-08-01')],
    old: [item('o1', '2012-05-01')],
  })
  const result = await gatherArchived(ctx, 3)
  // One addition per month, so it walks newest → oldest until it has three.
  expect(visited).toEqual(['new', 'mid', 'old'])
  expect(result.tracks.map((t) => t.id)).toEqual(['s1', 'a1', 'o1'])
})
