import { describe, it, expect } from 'bun:test'
import { Playlist } from 'spotify-web-api-node'
import { actionForPlaylist } from '../actions/action-for-playlist'
import { AutoArtistPlaylist } from '../actions/auto-artist-playlist'
import { Spotify } from '../spotify'

/**
 * Construction does no I/O, so a stub client cast is enough to exercise the
 * routing decision itself.
 */
const stubClient = {} as unknown as Spotify

function playlist(id: string, name: string): Playlist {
  return {
    type: 'playlist',
    uri: `spotify:playlist:${id}`,
    id,
    href: '',
    collaborative: false,
    external_urls: {},
    name,
    images: [],
    owner: {
      type: 'user',
      uri: 'spotify:user:u',
      id: 'u',
      href: '',
      display_name: 'u',
    },
    public: false,
    snapshot_id: 's',
  }
}

describe('actionForPlaylist', () => {
  it('routes a playlist named with a trailing "[A]" to AutoArtistPlaylist', () => {
    const action = actionForPlaylist(
      playlist('p1', 'Something [A]'),
      stubClient,
    )

    expect(action).toBeInstanceOf(AutoArtistPlaylist)
  })

  it('returns nothing for a playlist name without a trailing "[A]"', () => {
    const action = actionForPlaylist(
      playlist('p2', 'Something Else'),
      stubClient,
    )

    expect(action).toBeUndefined()
  })

  it('returns nothing when "[A]" appears but not at the end of the name', () => {
    const action = actionForPlaylist(
      playlist('p3', '[A] Something'),
      stubClient,
    )

    expect(action).toBeUndefined()
  })
})
