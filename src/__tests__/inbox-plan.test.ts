import { describe, it, expect } from 'bun:test'
import { Artist, PlaylistTrack, Track } from 'spotify-web-api-node'
import type { Mutation, MutationData } from '../mutations/mutation'
import { InboxSnapshot, inboxPlan } from '../actions/add-playlist-to-inbox'

/**
 * The inbox pass is the only action that runs unattended against playlists
 * Spotify rewrites weekly, so the whole of it is dedup: a track that has been
 * triaged once must never come back, and Discover Weekly reprinting last week's
 * track must not produce a second `'inboxed'` action for it.
 */

const NOW = 1_767_225_600_000

const inbox = { id: 'playlist-inbox' }

function artist(id: string): Artist {
  return {
    type: 'artist',
    uri: `spotify:artist:${id}`,
    id,
    href: '',
    external_urls: {},
    name: id,
  }
}

function track(id: string, name = id): Track {
  return {
    type: 'track',
    uri: `spotify:track:${id}`,
    id,
    href: '',
    album: {
      type: 'album',
      uri: `spotify:album:${id}-album`,
      id: `${id}-album`,
      href: '',
      album_type: 'album',
      artists: [artist('a')],
      available_markets: [],
      external_urls: {},
      images: [],
      name: `${id} album`,
      release_date: '2020-01-01',
      release_date_precision: 'day',
      total_tracks: 1,
    },
    artists: [artist('a')],
    disc_number: 1,
    is_playable: true,
    explicit: false,
    duration_ms: 200000,
    external_urls: {},
    external_ids: {},
    is_local: false,
    name,
    popularity: 0,
    preview_url: '',
    track_number: '1',
  }
}

function playlistTrack(id: string, name = id): PlaylistTrack {
  return {
    added_at: '2026-01-01T00:00:00Z',
    is_local: false,
    added_by: {
      type: 'user',
      uri: 'spotify:user:u',
      id: 'u',
      href: '',
      display_name: 'u',
    },
    track: track(id, name),
  }
}

function snapshot(overrides: Partial<InboxSnapshot> = {}): InboxSnapshot {
  return {
    playlistTracks: [playlistTrack('a'), playlistTrack('b')],
    seenTrackIds: [],
    inboxTrackIds: [],
    inbox,
    now: NOW,
    ...overrides,
  }
}

function storageOf(plan: Mutation<any>[][]) {
  return plan.flat().map((mutation) => mutation.storage)
}

const addTracks = (...ids: string[]): MutationData<any> => ({
  type: 'mutation',
  mutationType: 'add-tracks',
  data: {
    tracks: ids.map((id) => ({ uri: `spotify:track:${id}`, id })),
    playlist: { id: inbox.id },
  },
})

const inboxed = (id: string, at = NOW): MutationData<any> => ({
  type: 'mutation',
  mutationType: 'triage-action',
  data: { track: { id }, actionType: 'inboxed', action_at: at },
})

function addedIds(plan: Mutation<any>[][]) {
  const add = storageOf(plan).find((m) => m.mutationType === 'add-tracks')

  return (add?.data as { tracks: { id: string }[] } | undefined)?.tracks.map(
    (t) => t.id,
  )
}

describe('inboxPlan with a playlist of new tracks', () => {
  const plan = inboxPlan(snapshot())

  it('adds every track once and logs an inboxed action for each', () => {
    expect(storageOf(plan)).toEqual([
      addTracks('a', 'b'),
      inboxed('a'),
      inboxed('b'),
    ])
  })

  it('plans one add for the whole playlist rather than one per track', () => {
    expect(
      storageOf(plan).filter((m) => m.mutationType === 'add-tracks'),
    ).toHaveLength(1)
  })

  it('plans a single mutation set', () => {
    expect(plan).toHaveLength(1)
  })
})

describe('inboxPlan dedup', () => {
  it('skips tracks the track table has already seen', () => {
    // A seen track has been triaged before — possibly demoted straight back
    // out — so re-adding it would put a rejected track back in front of the
    // user every week.
    const plan = inboxPlan(snapshot({ seenTrackIds: ['a'] }))

    expect(storageOf(plan)).toEqual([addTracks('b'), inboxed('b')])
  })

  it('skips tracks already sitting in Inbox', () => {
    const plan = inboxPlan(snapshot({ inboxTrackIds: ['b'] }))

    expect(storageOf(plan)).toEqual([addTracks('a'), inboxed('a')])
  })

  it('collapses a track the source playlist lists twice', () => {
    const plan = inboxPlan(
      snapshot({
        playlistTracks: [playlistTrack('a'), playlistTrack('a')],
      }),
    )

    expect(storageOf(plan)).toEqual([addTracks('a'), inboxed('a')])
  })

  it('plans nothing when every track is known', () => {
    // Not an empty mutation set: `performAction` would fire it, store an
    // `action_history` row, and claim an inbox pass that added nothing.
    const plan = inboxPlan(
      snapshot({ seenTrackIds: ['a'], inboxTrackIds: ['b'] }),
    )

    expect(plan).toEqual([])
  })

  it.failing('ignores a source item whose track is unavailable', () => {
    const plan = inboxPlan(
      snapshot({
        playlistTracks: [{ track: null }] as unknown as PlaylistTrack[],
      }),
    )

    expect(plan).toEqual([])
  })
})

describe('inboxPlan with a track filter', () => {
  const playlistTracks = [
    playlistTrack('a', 'Xtal'),
    playlistTrack('b', 'Xtal - Boards of Canada Remix'),
  ]

  it('drops the tracks the filter rejects', () => {
    const plan = inboxPlan(
      snapshot({
        playlistTracks,
        trackFilter: (t) => !/remix/i.test(t.track.name),
      }),
    )

    expect(addedIds(plan)).toEqual(['a'])
  })

  it('keeps everything when no filter is given', () => {
    expect(addedIds(inboxPlan(snapshot({ playlistTracks })))).toEqual([
      'a',
      'b',
    ])
  })

  it('plans nothing when the filter rejects everything', () => {
    expect(
      inboxPlan(snapshot({ playlistTracks, trackFilter: () => false })),
    ).toEqual([])
  })
})

describe('inboxPlan storage', () => {
  it('stamps every inboxed action with the snapshot clock', () => {
    const at = 1_234_567_890
    const plan = inboxPlan(snapshot({ now: at }))

    const triageActions = storageOf(plan).filter(
      (m) => m.mutationType === 'triage-action',
    )

    expect(triageActions).toEqual([inboxed('a', at), inboxed('b', at)])
  })

  it('pairs one inboxed action with every added track', () => {
    const plan = inboxPlan(
      snapshot({
        playlistTracks: ['a', 'b', 'c', 'd'].map((id) => playlistTrack(id)),
        seenTrackIds: ['c'],
      }),
    )

    const triaged = storageOf(plan)
      .filter((m) => m.mutationType === 'triage-action')
      .map((m) => (m.data as { track: { id: string } }).track.id)

    expect(addedIds(plan)).toEqual(triaged)
    expect(triaged).toEqual(['a', 'b', 'd'])
  })
})
