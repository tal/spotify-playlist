import { expect, test } from 'bun:test'
import { inboxPlan, type InboxEntry } from '../web/inbox'

const entries: InboxEntry[] = [
  {
    position: 1,
    addedAt: '2026-09-10T12:00:00Z',
    track: { id: 'a', uri: 'spotify:track:a', name: 'A', artist: 'One, Two' },
  },
  { position: 2, addedAt: '2026-09-11T12:00:00Z', track: null },
  {
    position: 3,
    addedAt: '2026-09-12T12:00:00Z',
    track: { id: 'b', uri: 'spotify:track:b', name: 'B', artist: '' },
  },
  {
    position: 4,
    addedAt: '2026-09-13T12:00:00Z',
    track: { id: 'c', uri: 'spotify:track:c', name: 'C', artist: 'Three' },
  },
]

const records: Record<string, TrackItem | undefined> = {
  a: {
    id: 'a',
    play_count: 9,
    play_count_inbox: 4,
    status: 'inbox',
  } as TrackItem,
  c: {
    id: 'c',
    play_count: 1,
    play_count_inbox: 0,
    status: 'inbox',
  } as TrackItem,
}

test('inbox feed keeps playlist order, drops unavailable, and derives like status', () => {
  const result = inboxPlan(
    entries,
    records,
    ['a'],
    Date.parse('2026-09-15T12:00:00Z'),
  )
  // Playlist order preserved; the null entry is dropped between 'a' and 'b'.
  expect(result.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  // The dropped position 2 leaves a gap: numbering stays true to the playlist.
  expect(result.tracks.map((t) => t.position)).toEqual([1, 3, 4])
  expect(result.trackCount).toBe(3)
  expect(result.likedCount).toBe(1)
  expect(result.generatedAt).toBe('2026-09-15T12:00:00.000Z')
  expect(result.tracks[0]).toMatchObject({
    id: 'a',
    artist: 'One, Two',
    likeStatus: 'liked',
    playsFromInbox: 4,
    status: 'inbox',
  })
  // No record and not saved: unheard, zero plays, unknown status.
  expect(result.tracks[1]).toMatchObject({
    id: 'b',
    likeStatus: 'unheard',
    playsFromInbox: 0,
    status: null,
  })
  expect(result.tracks[2]).toMatchObject({
    id: 'c',
    likeStatus: 'unheard',
    playsFromInbox: 0,
  })
})

test('inbox feed respects the limit after dropping unavailable tracks', () => {
  const result = inboxPlan(entries, records, [], 0, 2)
  expect(result.tracks.map((t) => t.id)).toEqual(['a', 'b'])
  expect(result.tracks.map((t) => t.position)).toEqual([1, 3])
  expect(result.trackCount).toBe(2)
})

test('empty inbox yields an empty report', () => {
  expect(inboxPlan([], {}, [], 0)).toMatchObject({
    trackCount: 0,
    likedCount: 0,
    tracks: [],
  })
})
