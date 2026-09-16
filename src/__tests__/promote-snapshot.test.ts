import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { Playlist, PlaylistTrack, Track } from 'spotify-web-api-node'
import type { Spotify } from '../spotify'
import type { PerformContext } from '../actions/action'
import type { Dynamo } from '../db/dynamo'
import { nextRecentPromotes } from '../db/dynamo'
import {
  TriageMembership,
  locationSnapshot,
  readTriageMembership,
} from '../actions/track-action'
import { MagicPromoteAction } from '../actions/magic-promote-action'

const ambient = globalThis as { dev?: unknown }
let priorDev: unknown
beforeAll(() => {
  priorDev = ambient.dev
  ambient.dev = { isDev: false, dryAWS: false, drySpotify: false }
})
afterAll(() => {
  ambient.dev = priorDev
})

// --- locationSnapshot / stageFor ------------------------------------------

const m = (
  inbox: 'present' | 'absent',
  current: 'present' | 'absent',
  saved: 'present' | 'absent',
): TriageMembership => ({ inbox, current, saved })

test('locationSnapshot derives the lifecycle stage and keeps raw membership', () => {
  expect(locationSnapshot(m('present', 'absent', 'absent'))).toEqual({
    stage: 'unheard',
    saved: 'unsaved',
    inbox: 'present',
    current: 'absent',
  })
  expect(locationSnapshot(m('present', 'absent', 'present')).stage).toBe('liked')
  expect(locationSnapshot(m('absent', 'present', 'present')).stage).toBe(
    'current',
  )
  // Current wins even when a track somehow also still sits in Inbox.
  expect(locationSnapshot(m('present', 'present', 'present')).stage).toBe(
    'current',
  )
  // In neither playlist: saved reads as Liked, unsaved as Removed.
  expect(locationSnapshot(m('absent', 'absent', 'present')).stage).toBe('liked')
  expect(locationSnapshot(m('absent', 'absent', 'absent')).stage).toBe('removed')
})

// --- nextRecentPromotes ----------------------------------------------------

test('nextRecentPromotes prepends newest, caps, and collapses duplicates', () => {
  const a = { id: 'x:a', created_at: 1 }
  const b = { id: 'x:b', created_at: 2 }
  expect(nextRecentPromotes([a], b)).toEqual([b, a])
  expect(nextRecentPromotes(undefined, a)).toEqual([a])
  // Cap keeps the newest.
  expect(
    nextRecentPromotes([a, a, a, a], b, 3).length,
  ).toBe(3)
  // A repeat of the same key does not duplicate — it moves to the front.
  expect(nextRecentPromotes([a, b], a)).toEqual([a, b])
})

// --- readTriageMembership + MagicPromoteAction capture ---------------------

function playlist(id: string, name: string): Playlist {
  return { id, name, uri: `spotify:playlist:${id}` } as Playlist
}
function track(id: string): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: id,
    type: 'track',
    artists: [{ id: 'artist', name: 'Artist' }],
    album: { name: 'Album', artists: [{ id: 'artist', name: 'Artist' }] },
  } as Track
}
function playlistTrack(id: string): PlaylistTrack {
  return { added_at: '2026-01-01T00:00:00.000Z', track: track(id) } as PlaylistTrack
}

const byName: Record<string, Playlist> = {
  Inbox: playlist('playlist-inbox', 'Inbox'),
  Current: playlist('playlist-current', 'Current'),
  'Release Radar': playlist('playlist-release', 'Release Radar'),
  'Discover Weekly': playlist('playlist-discover', 'Discover Weekly'),
  Starred: playlist('playlist-starred', 'Starred'),
}

/** A client whose membership can be flipped to simulate the promote's effect. */
function statefulClient() {
  const state = { inbox: true, current: false, saved: false }
  const cache: Record<string, unknown> = {
    'playlist-inbox': ['stale'],
    'playlist-current': ['stale'],
  }
  const client = {
    _tracks: cache,
    player: Promise.resolve({ is_playing: true }),
    currentTrack: Promise.resolve(track('a')),
    async playlist(name: string) {
      const p = byName[name]
      if (!p) throw `cannot find playlist named ${name}`
      return p
    },
    async optionalPlaylist(name: string) {
      return byName[name]
    },
    async trackInPlaylist(_t: unknown, target: Playlist) {
      if (target.id === 'playlist-inbox')
        return state.inbox ? playlistTrack('a') : undefined
      if (target.id === 'playlist-current')
        return state.current ? playlistTrack('a') : undefined
      return undefined
    },
    async trackIsSaved() {
      return state.saved
    },
  }
  return { client: client as unknown as Spotify, state, cache }
}

test('readTriageMembership drops the two cached playlists and reads fresh', async () => {
  const { client, state, cache } = statefulClient()
  state.inbox = false
  state.current = true
  state.saved = true

  const membership = await readTriageMembership(client, {
    id: 'a',
    uri: 'spotify:track:a',
    name: 'a',
    artist: 'Artist',
    album: 'Album',
  })

  expect(membership).toEqual({
    inbox: 'absent',
    current: 'present',
    saved: 'present',
  })
  // The stale per-playlist cache entries were dropped so the read was fresh.
  expect('playlist-inbox' in cache).toBe(false)
  expect('playlist-current' in cache).toBe(false)
})

test('promote forStorage captures before from perform and measured after', async () => {
  const { client, state } = statefulClient()
  const action = new MagicPromoteAction(client, { trackURI: 'spotify:track:a' })
  action.created_at = 123

  // perform() reads the before-state (unheard: in Inbox, unsaved)...
  await action.perform({ client } as unknown as PerformContext)
  // ...then the promote's mutations move it to Current and save it.
  state.inbox = false
  state.current = true
  state.saved = true

  const stored = await action.forStorage([])
  expect(stored.before).toEqual({
    stage: 'unheard',
    saved: 'unsaved',
    inbox: 'present',
    current: 'absent',
  })
  expect(stored.after).toEqual({
    stage: 'current',
    saved: 'saved',
    inbox: 'absent',
    current: 'present',
  })
  expect(stored.item?.id).toBe('a')
})

test('a failed after-read leaves before/after absent, not the whole row', async () => {
  // Only currentTrack is provided, so the after re-read throws and is swallowed.
  const client = {
    currentTrack: Promise.resolve(track('a')),
  } as unknown as Spotify
  const action = new MagicPromoteAction(client, { trackURI: 'spotify:track:a' })
  action.created_at = 123

  const stored = await action.forStorage([])
  expect(stored).not.toHaveProperty('before')
  expect(stored).not.toHaveProperty('after')
  expect(stored.item?.id).toBe('a')
})
