import { expect, test } from 'bun:test'
import {
  promotesPlan,
  gatherPromotes,
  type PromoteEvent,
} from '../web/promotes'
import type { PerformContext } from '../actions/action'

function ev(
  id: string,
  at: number,
  stage: PromoteEvent['stage'],
): PromoteEvent {
  return { id, uri: `spotify:track:${id}`, name: id, artist: 'Artist', at, stage }
}

test('merges both stages newest-first and labels each transition', () => {
  const result = promotesPlan(
    [ev('a', 100, 'current'), ev('b', 300, 'liked'), ev('c', 200, 'current')],
    {},
    0,
  )
  expect(result.tracks.map((t) => t.id)).toEqual(['b', 'c', 'a'])
  expect(result.tracks.map((t) => t.transition)).toEqual([
    'unheard → liked',
    'liked → current',
    'liked → current',
  ])
  expect(result.tracks[0].promotedAt).toBe('1970-01-01T00:00:00.300Z')
})

test('a track promoted through both stages appears once per stage', () => {
  const result = promotesPlan(
    [ev('a', 500, 'current'), ev('a', 100, 'liked')],
    {},
    0,
  )
  expect(result.tracks).toHaveLength(2)
  expect(result.tracks.map((t) => t.stage)).toEqual(['current', 'liked'])
  expect(result.tracks.map((t) => t.id)).toEqual(['a', 'a'])
})

test('joins live status and play counts by id', () => {
  const result = promotesPlan(
    [ev('a', 200, 'current')],
    {
      a: {
        status: 'promoted',
        play_count: 4,
        play_count_current: 3,
        play_count_inbox: 1,
      } as TrackItem,
    },
    0,
  )
  expect(result.tracks[0]).toMatchObject({
    liveStatus: 'promoted',
    plays: 4,
    playsFromCurrent: 3,
    playsFromInbox: 1,
  })
})

test('a missing track record surfaces as null status / zero plays', () => {
  const result = promotesPlan([ev('a', 200, 'liked')], {}, 0)
  expect(result.tracks[0]).toMatchObject({
    liveStatus: null,
    plays: 0,
    playsFromInbox: 0,
    playsFromCurrent: 0,
  })
})

test('limit is applied after the merge is ordered', () => {
  const result = promotesPlan(
    [ev('a', 300, 'current'), ev('b', 200, 'liked'), ev('c', 100, 'current')],
    {},
    0,
    2,
  )
  expect(result.tracks.map((t) => t.id)).toEqual(['a', 'b'])
  expect(result.trackCount).toBe(2)
})

test('gather merges Current added_at and recent saves, then joins only shown ids', async () => {
  const asked: { ids?: string[] } = {}
  const ctx = {
    now: 0,
    settings: { current: 'Current' },
    client: {
      playlist: async () => ({ id: 'pl-current', name: 'Current' }),
      tracksForPlaylist: async () => [
        {
          added_at: '1970-01-01T00:00:00.300Z',
          track: {
            id: 'c1',
            uri: 'spotify:track:c1',
            name: 'C1',
            artists: [{ name: 'Artist' }],
          },
        },
        // A null track (unavailable) is dropped.
        { added_at: '1970-01-01T00:00:00.250Z', track: null },
      ],
      recentSavedTracks: async () => [
        {
          id: 'l1',
          uri: 'spotify:track:l1',
          name: 'L1',
          artist: 'Artist',
          addedAt: '1970-01-01T00:00:00.400Z',
        },
      ],
    },
    dynamo: {
      getTracks: async (ids: string[]) => {
        asked.ids = ids
        return {}
      },
    },
  } as unknown as PerformContext

  const result = await gatherPromotes(ctx, 20)
  // Newest-first across both sources: the like (400) then the Current add (300).
  expect(result.tracks.map((t) => t.id)).toEqual(['l1', 'c1'])
  expect(result.tracks.map((t) => t.stage)).toEqual(['liked', 'current'])
  expect(asked.ids?.sort()).toEqual(['c1', 'l1'])
})
