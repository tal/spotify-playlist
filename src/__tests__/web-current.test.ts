import { expect, test } from 'bun:test'
import {
  currentPlan,
  listenStatsPlan,
  type CurrentSnapshot,
} from '../web/current'
import { DAY_MS } from '../settings'

const snapshot: CurrentSnapshot = {
  playlist: 'Current',
  now: Date.parse('2026-09-15T12:00:00Z'),
  timeToArchive: 45 * DAY_MS,
  playsToArchive: 5,
  playlistTracks: [
    {
      added_at: '2026-09-10T12:00:00Z',
      track: {
        id: 'a',
        uri: 'spotify:track:a',
        name: 'A',
        artists: [{ name: 'One' }, { name: 'Two' }],
      },
    },
    { added_at: '2026-09-14T12:00:00Z', track: null },
    {
      added_at: '2026-09-14T12:00:00Z',
      track: { id: 'b', uri: 'spotify:track:b', name: 'B', artists: [] },
    },
  ],
  records: {
    a: {
      id: 'a',
      play_count: 8,
      play_count_current: 3,
      play_count_inbox: 2,
      status: 'promoted',
    } as TrackItem,
  },
}

test('current feed omits unavailable tracks, keeps unknown status, and mirrors Current playlist order', () => {
  const result = currentPlan(snapshot)
  expect(result.trackCount).toBe(2)
  expect(result.neverPlayedFromCurrent).toBe(1)
  expect(result.playsToArchive).toBe(5)
  expect(result.generatedAt).toBe('2026-09-15T12:00:00.000Z')
  // 'a' is first in playlistTracks, the null entry is dropped, 'b' follows.
  expect(result.tracks.map((t) => t.id)).toEqual(['a', 'b'])
  expect(result.tracks[0]).toMatchObject({
    artist: 'One, Two',
    daysInCurrent: 5,
    plays: 8,
    playsFromCurrent: 3,
    playsFromInbox: 2,
  })
  expect(result.tracks[1]).toMatchObject({
    status: null,
    plays: 0,
    playsFromCurrent: 0,
  })
})

test('listen-stats preserves its original JSON contract exactly', () => {
  expect(listenStatsPlan(snapshot)).toEqual({
    playlist: 'Current',
    trackCount: 2,
    archivesAfterDays: 45,
    neverPlayedFromCurrent: 1,
    tracks: [
      {
        name: 'B',
        artist: '',
        daysInCurrent: 1,
        status: null,
        plays: 0,
        playsFromInbox: 0,
        playsFromCurrent: 0,
      },
      {
        name: 'A',
        artist: 'One, Two',
        daysInCurrent: 5,
        status: 'promoted',
        plays: 8,
        playsFromInbox: 2,
        playsFromCurrent: 3,
      },
    ],
  })
})

test('empty Current yields an empty report', () => {
  expect(currentPlan({ ...snapshot, playlistTracks: [] })).toMatchObject({
    trackCount: 0,
    tracks: [],
    neverPlayedFromCurrent: 0,
  })
})
