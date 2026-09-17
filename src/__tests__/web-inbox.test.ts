import { describe, expect, test } from 'bun:test'
import { inboxPlan, trackAvailability, type InboxEntry } from '../web/inbox'

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

test('drops a region-locked track and leaves a gap in the numbering', () => {
  const locked: InboxEntry[] = [
    { position: 1, addedAt: '', track: entries[0].track, availability: 'available' },
    // Same shape as an available track, but greyed out for the operator.
    { position: 2, addedAt: '', track: entries[2].track, availability: 'unavailable' },
    { position: 3, addedAt: '', track: entries[3].track, availability: 'available' },
  ]
  const result = inboxPlan(locked, records, ['a'], 0)
  expect(result.tracks.map((t) => t.id)).toEqual(['a', 'c'])
  // Position 2 is gone, so the numbering jumps 1 -> 3 rather than renumbering.
  expect(result.tracks.map((t) => t.position)).toEqual([1, 3])
  expect(result.trackCount).toBe(2)
})

test('an entry with no availability is treated as available (backward compatible)', () => {
  const result = inboxPlan(entries, records, [], 0)
  expect(result.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c'])
})

describe('trackAvailability', () => {
  const playable = { available_markets: ['US', 'GB'], is_playable: true }

  test('available when the country is in available_markets', () => {
    expect(trackAvailability(playable, 'US')).toBe('available')
  })

  test('unavailable when the country is absent from available_markets', () => {
    expect(trackAvailability(playable, 'DE')).toBe('unavailable')
  })

  test('unavailable on an empty market list', () => {
    expect(trackAvailability({ available_markets: [] }, 'US')).toBe('unavailable')
  })

  test('unavailable when Spotify flags is_playable false', () => {
    expect(trackAvailability({ is_playable: false }, 'US')).toBe('unavailable')
  })

  test('available when the country is unknown, even with a market list', () => {
    // Never blank the whole feed just because the profile lacked a country.
    expect(trackAvailability(playable, undefined)).toBe('available')
  })

  test('available when available_markets is missing', () => {
    expect(trackAvailability({ is_playable: true }, 'US')).toBe('available')
  })

  test('unavailable for a null track', () => {
    expect(trackAvailability(null, 'US')).toBe('unavailable')
  })
})
