import { describe, it, expect } from 'bun:test'
import { Artist, PlaylistTrack, Track } from 'spotify-web-api-node'
import {
  getRandomSlice,
  rulePlaylistPlan,
  RulePlaylistAction,
} from '../actions/rule-playlist'
import { Spotify } from '../spotify'

/**
 * `RulePlaylistAction.perform()` still does its own I/O end to end (settings,
 * triage playlists, `playlistByPrefix`), so the artist chooser is exercised
 * through the public `randomStarredArtistTracks()` method, which needs nothing
 * but a saved-tracks stub. `getRandomSlice` and `rulePlaylistPlan` are pure and
 * are exercised directly.
 */

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

function track(id: string, artistIds: string[], uri?: string): Track {
  return {
    type: 'track',
    uri: uri === undefined ? `spotify:track:${id}` : uri,
    id,
    href: '',
    album: {
      type: 'album',
      uri: `spotify:album:${id}-album`,
      id: `${id}-album`,
      href: '',
      album_type: 'album',
      artists: artistIds.map(artist),
      available_markets: [],
      external_urls: {},
      images: [],
      name: `${id} album`,
      release_date: '2020-01-01',
      release_date_precision: 'day',
      total_tracks: 1,
    },
    artists: artistIds.map(artist),
    disc_number: 1,
    is_playable: true,
    explicit: false,
    duration_ms: 200000,
    external_urls: {},
    external_ids: {},
    is_local: false,
    name: id,
    popularity: 0,
    preview_url: '',
    track_number: '1',
  }
}

function playlistTrack(id: string, artistIds: string[]): PlaylistTrack {
  return {
    added_at: '2026-01-01T00:00:00.000Z',
    is_local: false,
    added_by: {
      type: 'user',
      uri: 'spotify:user:u',
      id: 'u',
      href: '',
      display_name: 'u',
    },
    track: track(id, artistIds),
  }
}

function fakeClient(savedTracks: Track[]): Spotify {
  return {
    mySavedTracks: async () => savedTracks,
  } as unknown as Spotify
}

describe('RulePlaylistAction chooser injection (randomStarredArtistTracks)', () => {
  it('selects the artist at the offset the injected pick returns', async () => {
    const tracks = [
      playlistTrack('t0', ['artist-0']),
      playlistTrack('t1', ['artist-1']),
      playlistTrack('t2', ['artist-2']),
    ]
    const action = new RulePlaylistAction(
      fakeClient([]),
      { rule: 'test' },
      () => 1,
    )

    const { artist: chosen } = await action.randomStarredArtistTracks(tracks)

    expect(chosen.id).toBe('artist-1')
  })

  it('passes the candidate count to the injected pick', async () => {
    const tracks = [
      playlistTrack('t0', ['artist-0']),
      playlistTrack('t1', ['artist-1']),
    ]
    const seen: number[] = []
    const pick = (n: number) => {
      seen.push(n)
      return 0
    }
    const action = new RulePlaylistAction(
      fakeClient([]),
      { rule: 'test' },
      pick,
    )

    await action.randomStarredArtistTracks(tracks)

    expect(seen).toEqual([tracks.length])
  })

  it('is reproducible: the same pick and input produce the same selection every time', async () => {
    const tracks = [
      playlistTrack('t0', ['artist-0']),
      playlistTrack('t1', ['artist-1']),
      playlistTrack('t2', ['artist-2']),
    ]
    const savedTracks = [track('s1', ['artist-2'])]
    const action = new RulePlaylistAction(
      fakeClient(savedTracks),
      { rule: 'test' },
      () => 2,
    )

    const first = await action.randomStarredArtistTracks(tracks)
    const second = await action.randomStarredArtistTracks(tracks)

    expect(first).toEqual(second)
  })

  it('a different pick offset can select a different artist for the same input', async () => {
    const tracks = [
      playlistTrack('t0', ['artist-0']),
      playlistTrack('t1', ['artist-1']),
    ]
    const first = new RulePlaylistAction(
      fakeClient([]),
      { rule: 'test' },
      () => 0,
    )
    const second = new RulePlaylistAction(
      fakeClient([]),
      { rule: 'test' },
      () => 1,
    )

    const a = await first.randomStarredArtistTracks(tracks)
    const b = await second.randomStarredArtistTracks(tracks)

    expect(a.artist.id).toBe('artist-0')
    expect(b.artist.id).toBe('artist-1')
  })

  it('matches a saved track by any credited artist, not just the primary one', async () => {
    const tracks = [playlistTrack('t0', ['artist-a'])]
    const savedTracks = [track('feat', ['artist-x', 'artist-a'])]
    const action = new RulePlaylistAction(
      fakeClient(savedTracks),
      { rule: 'test' },
      () => 0,
    )

    const { tracks: matched } = await action.randomStarredArtistTracks(tracks)

    expect(matched.map((t) => t.id)).toEqual(['feat'])
  })

  it('excludes a local track even when its artist matches', async () => {
    const tracks = [playlistTrack('t0', ['artist-a'])]
    const savedTracks = [
      track('local1', ['artist-a'], 'spotify:local:artist-a:x:1'),
    ]
    const action = new RulePlaylistAction(
      fakeClient(savedTracks),
      { rule: 'test' },
      () => 0,
    )

    const { tracks: matched } = await action.randomStarredArtistTracks(tracks)

    expect(matched).toEqual([])
  })

  it('excludes a saved track with no uri', async () => {
    const tracks = [playlistTrack('t0', ['artist-a'])]
    const savedTracks = [track('no-uri', ['artist-a'], '')]
    const action = new RulePlaylistAction(
      fakeClient(savedTracks),
      { rule: 'test' },
      () => 0,
    )

    const { tracks: matched } = await action.randomStarredArtistTracks(tracks)

    expect(matched).toEqual([])
  })
})

describe('getRandomSlice', () => {
  const letters = ['a', 'b', 'c', 'd', 'e']

  it('starts the window at the offset the injected pick returns', () => {
    expect(getRandomSlice(letters, 2, () => 3)).toEqual(['d', 'e'])
  })

  it('offers the pick one candidate per window: arr.length - n + 1', () => {
    const seen: number[] = []
    const pick = (n: number) => {
      seen.push(n)
      return 0
    }

    getRandomSlice(letters, 2, pick)

    expect(seen).toEqual([4])
  })

  it('can reach the final window, ending at the last element', () => {
    const pick = (n: number) => n - 1

    expect(getRandomSlice(letters, 3, pick)).toEqual(['c', 'd', 'e'])
  })

  it('returns exactly n elements for every reachable offset', () => {
    for (let start = 0; start <= letters.length - 3; start++) {
      expect(getRandomSlice(letters, 3, () => start).length).toBe(3)
    }
  })

  it('passes the array straight through, without consulting pick, when n exceeds its length', () => {
    let calls = 0
    const pick = () => {
      calls++
      return 0
    }

    const result = getRandomSlice(letters, letters.length + 1, pick)

    expect(result).toBe(letters)
    expect(calls).toBe(0)
  })

  it('still slices — and still consults pick with a single candidate — when n equals the array length', () => {
    const seen: number[] = []
    const pick = (n: number) => {
      seen.push(n)
      return 0
    }

    const result = getRandomSlice(letters, letters.length, pick)

    expect(seen).toEqual([1])
    expect(result).toEqual(letters)
    expect(result).not.toBe(letters)
  })

  it('offers exactly two windows when the array is one longer than n', () => {
    const seen: number[] = []
    const pick = (n: number) => {
      seen.push(n)
      return 0
    }

    const first = getRandomSlice(letters, letters.length - 1, pick)
    const last = getRandomSlice(letters, letters.length - 1, (n) => n - 1)

    expect(seen).toEqual([2])
    expect(first).toEqual(['a', 'b', 'c', 'd'])
    expect(last).toEqual(['b', 'c', 'd', 'e'])
  })

  it('returns an empty slice for n = 0 without reaching past the array', () => {
    expect(getRandomSlice(letters, 0, () => 0)).toEqual([])
  })

  it('leaves the input array untouched', () => {
    const input = [...letters]

    getRandomSlice(input, 2, () => 1)

    expect(input).toEqual(letters)
  })
})

describe('rulePlaylistPlan', () => {
  const snapshot = {
    playlist: { id: 'smart-1' },
    tracks: [{ uri: 'spotify:track:t1' }, { uri: 'spotify:track:t2' }],
    likedTracks: [{ uri: 'spotify:track:s1', id: 's1' }],
    artistName: 'Artist Zero',
  }

  it('empties first, then fills and renames, as two separate mutation sets', () => {
    const plan = rulePlaylistPlan(snapshot)

    expect(plan.map((set) => set.map((m) => m.storage))).toEqual([
      [
        {
          type: 'mutation',
          mutationType: 'empty-playlist',
          data: { playlist: { id: 'smart-1' } },
        },
      ],
      [
        {
          type: 'mutation',
          mutationType: 'add-tracks',
          data: {
            tracks: [
              { uri: 'spotify:track:t1', id: undefined },
              { uri: 'spotify:track:t2', id: undefined },
            ],
            playlist: { id: 'smart-1' },
          },
        },
        {
          type: 'mutation',
          mutationType: 'add-tracks',
          data: {
            tracks: [{ uri: 'spotify:track:s1', id: 's1' }],
            playlist: { id: 'smart-1' },
          },
        },
        {
          type: 'mutation',
          mutationType: 'rename-playlist',
          data: {
            playlist: { id: 'smart-1' },
            name: 'Smart Playlist — Artist Zero',
          },
        },
      ],
    ])
  })

  it('leaves the empty alone in the first set, so no fill can run alongside it', () => {
    const plan = rulePlaylistPlan(snapshot)

    expect(plan[0].map((m) => m.storage.mutationType)).toEqual([
      'empty-playlist',
    ])
  })

  it('puts every fill and the rename in a strictly later set than the empty', () => {
    const plan = rulePlaylistPlan(snapshot)

    const later = plan.slice(1).flatMap((set) => set.map((m) => m.storage))

    expect(later.map((m) => m.mutationType)).toEqual([
      'add-tracks',
      'add-tracks',
      'rename-playlist',
    ])
  })

  it('empties exactly once across the whole plan', () => {
    const plan = rulePlaylistPlan(snapshot)

    const empties = plan
      .flat()
      .filter((m) => m.storage.mutationType === 'empty-playlist')

    expect(empties.length).toBe(1)
  })

  it('still empties first when there is nothing to add back', () => {
    const plan = rulePlaylistPlan({
      playlist: { id: 'smart-1' },
      tracks: [],
      likedTracks: [],
      artistName: 'Artist Zero',
    })

    expect(plan.map((set) => set.map((m) => m.storage))).toEqual([
      [
        {
          type: 'mutation',
          mutationType: 'empty-playlist',
          data: { playlist: { id: 'smart-1' } },
        },
      ],
      [
        {
          type: 'mutation',
          mutationType: 'add-tracks',
          data: { tracks: [], playlist: { id: 'smart-1' } },
        },
        {
          type: 'mutation',
          mutationType: 'add-tracks',
          data: { tracks: [], playlist: { id: 'smart-1' } },
        },
        {
          type: 'mutation',
          mutationType: 'rename-playlist',
          data: {
            playlist: { id: 'smart-1' },
            name: 'Smart Playlist — Artist Zero',
          },
        },
      ],
    ])
  })

  it('targets the snapshot playlist with every mutation in the plan', () => {
    const plan = rulePlaylistPlan({ ...snapshot, playlist: { id: 'other-9' } })

    const targets = plan
      .flat()
      .map((m) => (m.storage.data as { playlist: { id: string } }).playlist.id)

    expect(targets).toEqual(['other-9', 'other-9', 'other-9', 'other-9'])
  })
})
