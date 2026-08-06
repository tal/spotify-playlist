import { describe, it, expect } from 'bun:test'
import { Artist, PlaylistTrack, Track } from 'spotify-web-api-node'
import { autoArtistPlaylistPlan } from '../actions/auto-artist-playlist'

function artist(id: string): Artist {
  return {
    type: 'artist',
    uri: `spotify:artist:${id}`,
    id,
    href: `https://api.spotify.com/v1/artists/${id}`,
    external_urls: {},
    name: id,
  }
}

function track(id: string, artistIds: string[]): Track {
  return {
    type: 'track',
    uri: `spotify:track:${id}`,
    id,
    href: `https://api.spotify.com/v1/tracks/${id}`,
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

function playlistTrack(
  id: string,
  artistIds: string[],
  added_at = '2026-01-01T00:00:00.000Z',
): PlaylistTrack {
  return {
    added_at,
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

describe('autoArtistPlaylistPlan', () => {
  it('adds a saved track whose primary artist matches a playlist track present in the playlist', () => {
    const plan = autoArtistPlaylistPlan({
      playlistTracks: [playlistTrack('t1', ['artist-a'])],
      savedTracks: [track('t2', ['artist-a'])],
      playlist: { id: 'p1' },
    })

    expect(plan.map((set) => set.map((m) => m.storage))).toEqual([
      [
        {
          type: 'mutation',
          mutationType: 'add-tracks',
          data: {
            tracks: [{ uri: 'spotify:track:t2', id: 't2' }],
            playlist: { id: 'p1' },
          },
        },
      ],
    ])
  })

  it('dedupes out a saved track already present in the playlist by id', () => {
    const plan = autoArtistPlaylistPlan({
      playlistTracks: [playlistTrack('t1', ['artist-a'])],
      savedTracks: [track('t1', ['artist-a'])],
      playlist: { id: 'p1' },
    })

    expect(plan).toEqual([])
  })

  it('excludes a saved track whose artist is not represented in the playlist', () => {
    const plan = autoArtistPlaylistPlan({
      playlistTracks: [playlistTrack('t1', ['artist-a'])],
      savedTracks: [track('t2', ['artist-b'])],
      playlist: { id: 'p1' },
    })

    expect(plan).toEqual([])
  })

  it('returns an empty plan, not an empty mutation set, when there is nothing to add', () => {
    const plan = autoArtistPlaylistPlan({
      playlistTracks: [],
      savedTracks: [],
      playlist: { id: 'p1' },
    })

    expect(plan).toEqual([])
  })

  it('bundles every qualifying track into a single add-tracks mutation', () => {
    const plan = autoArtistPlaylistPlan({
      playlistTracks: [
        playlistTrack('t1', ['artist-a']),
        playlistTrack('t2', ['artist-b']),
      ],
      savedTracks: [
        track('t3', ['artist-a']),
        track('t4', ['artist-b']),
        track('t5', ['artist-c']),
      ],
      playlist: { id: 'p1' },
    })

    expect(plan.length).toBe(1)
    expect(plan[0].length).toBe(1)
    expect(
      plan[0][0].storage.data.tracks.map((t: { id: string }) => t.id).sort(),
    ).toEqual(['t3', 't4'])
  })

  it("only considers a playlist track's primary (first) artist when building the match set", () => {
    // artist-b is only a secondary credit on the playlist track, so it should
    // not qualify a saved track whose primary artist is artist-b.
    const plan = autoArtistPlaylistPlan({
      playlistTracks: [playlistTrack('t1', ['artist-a', 'artist-b'])],
      savedTracks: [track('t2', ['artist-b'])],
      playlist: { id: 'p1' },
    })

    expect(plan).toEqual([])
  })

  it("only considers a saved track's primary (first) artist when matching", () => {
    // artist-a is only a secondary credit on the saved track, so it should not
    // match even though artist-a is the playlist's matched artist.
    const plan = autoArtistPlaylistPlan({
      playlistTracks: [playlistTrack('t1', ['artist-a'])],
      savedTracks: [track('t2', ['artist-x', 'artist-a'])],
      playlist: { id: 'p1' },
    })

    expect(plan).toEqual([])
  })
})
