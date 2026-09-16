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

test('gather reads every matching month including old ones, then joins only selected ids', async () => {
  const { gatherArchived } = await import('../web/archived')
  const { buildArchiveNamer } = await import('../settings')
  const visited: string[] = []
  const joined: string[][] = []
  const ctx = {
    now: 0,
    settings: {
      current: 'Current',
      archivePlaylistNameFor: buildArchiveNamer(),
    },
    client: {
      allPlaylists: async () => [
        { id: 'new', name: '2026 - September' },
        { id: 'old', name: '2012 - May' },
        { id: 'other', name: 'Starred' },
        { id: 'test', name: '[Test] 2026 - September' },
      ],
      tracksForPlaylist: async ({ id }: { id: string }) => {
        visited.push(id)
        return [
          {
            added_at: id === 'old' ? '2026-09-15' : '2026-09-10',
            track: {
              id: 'same',
              uri: 'spotify:track:same',
              name: 'Track',
              artists: [{ name: 'Artist' }],
              album: { name: 'Album' },
            },
          },
        ]
      },
    },
    dynamo: {
      getTracks: async (ids: string[]) => {
        joined.push(ids)
        return {}
      },
    },
  } as unknown as import('../actions/action').PerformContext
  const result = await gatherArchived(ctx)
  expect(visited).toEqual(['new', 'old'])
  expect(joined).toEqual([['same']])
  expect(result.tracks.map((t) => t.playlistId)).toEqual(['old', 'new'])
})
