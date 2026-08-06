import { describe, it, expect } from 'bun:test'
import {
  Context,
  Device,
  PlayBackContext,
  Playlist,
} from 'spotify-web-api-node'
import { isCurrentlyPlayingInTriage } from '../actions/actionable-type'

function device(): Device {
  return {
    id: 'device-1',
    is_active: true,
    is_restricted: false,
    name: 'device',
    type: 'Computer',
    volume_percent: 100,
  }
}

function playlist(id: string): Playlist {
  return {
    type: 'playlist',
    uri: `spotify:playlist:${id}`,
    id,
    href: '',
    collaborative: false,
    external_urls: {},
    name: id,
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

function player(overrides: Partial<PlayBackContext>): PlayBackContext {
  return {
    timestamp: 0,
    device: device(),
    is_playing: true,
    currently_playing_type: 'track',
    shuffle_state: false,
    repeat_state: 'off',
    ...overrides,
  }
}

function context(uri: string): Context {
  return { type: 'playlist', uri, href: '', external_urls: {} }
}

const triage = { inbox: playlist('inbox'), current: playlist('current') }

describe('isCurrentlyPlayingInTriage', () => {
  it('is false when the currently playing type is not a track', async () => {
    const result = await isCurrentlyPlayingInTriage(
      player({
        currently_playing_type: 'episode',
        context: context(triage.inbox.uri),
      }),
      triage,
    )

    expect(result).toBe(false)
  })

  it('is false when there is no playback context', async () => {
    const result = await isCurrentlyPlayingInTriage(
      player({ currently_playing_type: 'track', context: undefined }),
      triage,
    )

    expect(result).toBe(false)
  })

  it('is true when the context uri matches the inbox playlist', async () => {
    const result = await isCurrentlyPlayingInTriage(
      player({ context: context(triage.inbox.uri) }),
      triage,
    )

    expect(result).toBe(true)
  })

  it('is true when the context uri matches the current playlist', async () => {
    const result = await isCurrentlyPlayingInTriage(
      player({ context: context(triage.current.uri) }),
      triage,
    )

    expect(result).toBe(true)
  })

  it('is false when the context uri matches neither triage playlist', async () => {
    const result = await isCurrentlyPlayingInTriage(
      player({ context: context('spotify:playlist:something-else') }),
      triage,
    )

    expect(result).toBe(false)
  })
})
