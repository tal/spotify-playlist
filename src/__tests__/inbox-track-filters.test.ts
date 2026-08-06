import { describe, it, expect } from 'bun:test'
import { Artist, PlaylistTrack, Track } from 'spotify-web-api-node'
import {
  noRemixes,
  noLive,
  onlyOriginals,
} from '../actions/scan-playlists-for-inbox'

/**
 * These are the predicates ScanPlaylistsForInbox defines for Discover Weekly
 * and Release Radar. Both read `track.track.name` only — never an artist
 * name — via a bare case-insensitive substring match, so a marker landing
 * inside an unrelated word (or inside the artist field) behaves exactly as
 * blindly as that implies. Pinned here, not fixed.
 *
 * Each predicate matches exactly one marker word ("remix" / "live"); a
 * "Remaster", "Radio Edit", or "Acoustic Version" tag trips neither one, even
 * under `onlyOriginals`. Pinned below.
 *
 * `ScanPlaylistsForInbox.addActions()` is the only place these get wired to a
 * source playlist, and it is not reachable here: it awaits `getTriageInfo`,
 * which calls out to Spotify and the settings store. As written today it also
 * never passes a filter to either `AddPlaylistToInbox` call — Discover Weekly
 * and Release Radar both go through unfiltered. (Before the refactor in
 * f9d6303, Release Radar's `AddPlaylistToInbox` was constructed with
 * `onlyOriginals` as its third argument; that argument was dropped when the
 * constructor-time filter list became the async `addActions()` above, and
 * nothing since has restored it.)
 */

function artist(id: string, name = id): Artist {
  return {
    type: 'artist',
    uri: `spotify:artist:${id}`,
    id,
    href: '',
    external_urls: {},
    name,
  }
}

function track(
  id: string,
  name: string,
  artists: Artist[] = [artist('a')],
): Track {
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
      artists,
      available_markets: [],
      external_urls: {},
      images: [],
      name: `${name} album`,
      release_date: '2020-01-01',
      release_date_precision: 'day',
      total_tracks: 1,
    },
    artists,
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

function playlistTrack(
  id: string,
  name: string,
  artists?: Artist[],
): PlaylistTrack {
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
    track: track(id, name, artists),
  }
}

describe('noRemixes', () => {
  it('rejects a parenthetical remix marker', () => {
    expect(noRemixes(playlistTrack('a', 'Xtal (Remix)'))).toBe(false)
  })

  it('rejects a dash-separated remixer credit', () => {
    expect(noRemixes(playlistTrack('a', 'Xtal - Boards of Canada Remix'))).toBe(
      false,
    )
  })

  it('rejects regardless of casing', () => {
    expect(noRemixes(playlistTrack('a', 'Xtal (REMIX)'))).toBe(false)
    expect(noRemixes(playlistTrack('a', 'Xtal (ReMiX)'))).toBe(false)
  })

  it('rejects the marker at the start of the title', () => {
    expect(noRemixes(playlistTrack('a', 'Remix of Xtal'))).toBe(false)
  })

  it('passes a clean title with no remix marker', () => {
    expect(noRemixes(playlistTrack('a', 'Xtal'))).toBe(true)
  })

  it('is a bare substring match: an unrelated word containing "remix" is also rejected', () => {
    expect(noRemixes(playlistTrack('a', 'Premixed Thoughts'))).toBe(false)
  })

  it('reads only the track name, not the artist: "Remix" in the artist is ignored', () => {
    const withRemixArtist = playlistTrack('a', 'Xtal', [
      artist('r', 'DJ Remix'),
    ])
    expect(noRemixes(withRemixArtist)).toBe(true)
  })

  it('does not match a remaster marker: "remaster" contains no "remix"', () => {
    expect(noRemixes(playlistTrack('a', 'Xtal - 2011 Remaster'))).toBe(true)
  })
})

describe('noLive', () => {
  it('rejects a parenthetical live marker', () => {
    expect(noLive(playlistTrack('a', 'Xtal (Live)'))).toBe(false)
  })

  it('rejects a "Live at <venue>" style title', () => {
    expect(noLive(playlistTrack('a', 'Xtal - Live at Wembley'))).toBe(false)
  })

  it('rejects regardless of casing', () => {
    expect(noLive(playlistTrack('a', 'XTAL LIVE'))).toBe(false)
    expect(noLive(playlistTrack('a', 'Xtal lIvE'))).toBe(false)
  })

  it('passes a clean title with no live marker', () => {
    expect(noLive(playlistTrack('a', 'Xtal'))).toBe(true)
  })

  it('rejects a song legitimately titled "Alive": "live" is a substring of it', () => {
    expect(noLive(playlistTrack('a', 'Alive'))).toBe(false)
  })

  it('rejects "Delivery" too, for the same substring reason', () => {
    expect(noLive(playlistTrack('a', 'Delivery'))).toBe(false)
  })

  it('reads only the track name, not the artist: "Live" in the artist is ignored', () => {
    const withLiveArtist = playlistTrack('a', 'Xtal', [
      artist('l', 'Live Nation Artists'),
    ])
    expect(noLive(withLiveArtist)).toBe(true)
  })

  it('rejects the marker at the start of the title', () => {
    expect(noLive(playlistTrack('a', 'Live from Tokyo'))).toBe(false)
  })

  it('does not match a radio-edit or acoustic-version marker', () => {
    expect(noLive(playlistTrack('a', 'Xtal (Radio Edit)'))).toBe(true)
    expect(noLive(playlistTrack('a', 'Xtal - Acoustic Version'))).toBe(true)
  })
})

describe('onlyOriginals', () => {
  it('passes a clean title that trips neither filter', () => {
    expect(onlyOriginals(playlistTrack('a', 'Xtal'))).toBe(true)
  })

  it('rejects a remix even when it has no live marker', () => {
    expect(onlyOriginals(playlistTrack('a', 'Xtal (Remix)'))).toBe(false)
  })

  it('rejects a live recording even when it has no remix marker', () => {
    expect(onlyOriginals(playlistTrack('a', 'Xtal (Live)'))).toBe(false)
  })

  it('rejects a title carrying both markers', () => {
    expect(onlyOriginals(playlistTrack('a', 'Xtal (Live Remix)'))).toBe(false)
  })

  it('is exactly noRemixes && noLive, not an independent check', () => {
    const track = playlistTrack('a', 'Alive')
    expect(onlyOriginals(track)).toBe(noRemixes(track) && noLive(track))
    expect(onlyOriginals(track)).toBe(false)
  })

  it('passes a remaster or radio-edit title: neither marker it checks for is present', () => {
    expect(onlyOriginals(playlistTrack('a', 'Xtal - 2011 Remaster'))).toBe(true)
    expect(onlyOriginals(playlistTrack('a', 'Xtal (Radio Edit)'))).toBe(true)
  })
})
