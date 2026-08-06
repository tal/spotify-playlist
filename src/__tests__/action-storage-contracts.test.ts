import { describe, expect, it } from 'bun:test'
import type { Track } from 'spotify-web-api-node'
import type { Spotify } from '../spotify'
import { AddPlaylistToInbox } from '../actions/add-playlist-to-inbox'
import { AutoArtistPlaylist } from '../actions/auto-artist-playlist'
import { DemoteAction } from '../actions/demote-action'
import { MagicPromoteAction } from '../actions/magic-promote-action'
import { ProcessManualTriage } from '../actions/process-manual-triage'
import { RulePlaylistAction } from '../actions/rule-playlist'
import { ScanPlaylistsForInbox } from '../actions/scan-playlists-for-inbox'
import { SetTrackStatusMutation } from '../mutations/set-track-status-mutation'

/**
 * Action history is an operational contract: throttling and undo query these
 * ids and action labels later. Planner tests inspect mutation storage, but they
 * do not instantiate most concrete actions or serialize their history rows.
 */

const CREATED_AT = 1_234_567_890

function track(id: string): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: 'Xtal',
    artists: [{ name: 'Aphex Twin' }],
    album: { name: 'Selected Ambient Works 85-92' },
  } as Track
}

function clientWithTrack(id = 'a') {
  return {
    currentTrack: Promise.resolve(track(id)),
  } as unknown as Spotify
}

const mutation = new SetTrackStatusMutation({
  track: { id: 'a' },
  status: 'removed',
  changed_at: CREATED_AT,
})

describe('track action history', () => {
  it('stores a promote under its stable track-uri id with trimmed track data', async () => {
    const client = clientWithTrack()
    const action = new MagicPromoteAction(client, {
      trackURI: 'spotify:track:a',
    })
    action.created_at = CREATED_AT

    expect(await action.forStorage([mutation])).toEqual({
      id: 'promote:spotify:track:a',
      created_at: CREATED_AT,
      action: 'promote-track',
      item: {
        id: 'a',
        uri: 'spotify:track:a',
        name: 'Xtal',
        artist: 'Aphex Twin',
        album: 'Selected Ambient Works 85-92',
      },
      mutations: [mutation.storage],
    })
  })

  it('stores a demote under its stable track-uri id with trimmed track data', async () => {
    const client = clientWithTrack()
    const action = new DemoteAction(client, { trackURI: 'spotify:track:a' })
    action.created_at = CREATED_AT

    expect(await action.forStorage([mutation])).toEqual({
      id: 'demote:spotify:track:a',
      created_at: CREATED_AT,
      action: 'demote-track',
      item: {
        id: 'a',
        uri: 'spotify:track:a',
        name: 'Xtal',
        artist: 'Aphex Twin',
        album: 'Selected Ambient Works 85-92',
      },
      mutations: [mutation.storage],
    })
  })
})

describe('non-track action history', () => {
  it('stores an inbox scan under the source playlist id', async () => {
    const action = new AddPlaylistToInbox({} as Spotify, { id: 'source' })
    ;(action as any).created_at = CREATED_AT

    expect(await action.forStorage([mutation])).toEqual({
      id: 'inbox-playlist:source',
      created_at: CREATED_AT,
      action: 'add-playlist-to-inbox',
      mutations: [mutation.storage],
    })
  })

  it('stores an auto-artist run under the target playlist id', async () => {
    const action = new AutoArtistPlaylist({} as Spotify, { id: 'auto' })
    ;(action as any).created_at = CREATED_AT

    expect(await action.forStorage([mutation])).toEqual({
      id: 'auto-artist:auto',
      created_at: CREATED_AT,
      action: 'auto-artist-playlist',
      mutations: [mutation.storage],
    })
  })

  it('stores a manual-triage pass under its invocation id', async () => {
    const action = new ProcessManualTriage({} as Spotify)
    ;(action as any).created_at = CREATED_AT

    expect(await action.forStorage([mutation])).toEqual({
      id: `process-manual-triage:${CREATED_AT}`,
      created_at: CREATED_AT,
      action: 'process-manual-triage',
      mutations: [mutation.storage],
    })
  })

  it('stores a source-playlist scan under its invocation id', async () => {
    const action = new ScanPlaylistsForInbox({} as Spotify)
    ;(action as any).created_at = CREATED_AT

    expect(await action.forStorage([mutation])).toEqual({
      id: `scan-playlists-for-inbox:${CREATED_AT}`,
      created_at: CREATED_AT,
      action: 'scan-playlists-for-inbox',
      mutations: [mutation.storage],
    })
  })

  it('keys a rule playlist action on the requested rule', async () => {
    const action = new RulePlaylistAction({} as Spotify, { rule: 'smart' })

    expect(await action.getID()).toBe('rule-playlist:smart')
    expect(action.forStorage).toBeUndefined()
  })
})
