import { afterAll, beforeAll, describe, expect, it, test } from 'bun:test'
import type {
  Playlist,
  PlaylistTrack,
  RecentlyPlayedItem,
  Track,
} from 'spotify-web-api-node'
import type { Dynamo, TrackStatusRow } from '../db/dynamo'
import type { Settings } from '../settings'
import { buildArchiveNamer } from '../settings'
import type { Spotify } from '../spotify'
import type { PerformContext } from '../actions/action'
import { AddPlaylistToInbox } from '../actions/add-playlist-to-inbox'
import { ArchiveAction } from '../actions/archive-action'
import { AutoArtistPlaylist } from '../actions/auto-artist-playlist'
import { DemoteAction } from '../actions/demote-action'
import { MagicPromoteAction } from '../actions/magic-promote-action'
import { ProcessManualTriage } from '../actions/process-manual-triage'
import { ProcessPlaybackHistoryAction } from '../actions/process-playback-history-action'
import { RulePlaylistAction } from '../actions/rule-playlist'
import {
  ScanPlaylistsForInbox,
  onlyOriginals,
} from '../actions/scan-playlists-for-inbox'
import { SkipToNextTrack } from '../actions/skip-to-next-track'
import { currentTrackIdentity } from '../actions/track-action'

/**
 * The planner tests deliberately start from plain snapshots. These focused
 * fakes test the I/O shells that build those snapshots: playlist names must map
 * to the right ids, live Spotify state must become the right membership, and
 * conditional reads must not silently disappear during a refactor.
 */

const NOW = Date.UTC(2026, 7, 6, 12)
const ambient = globalThis as { dev?: unknown }
let priorDev: unknown

beforeAll(() => {
  priorDev = ambient.dev
  ambient.dev = { isDev: false, dryAWS: false, drySpotify: false }
})

afterAll(() => {
  ambient.dev = priorDev
})

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    inbox: 'Inbox',
    current: 'Current',
    releaseRadar: 'Release Radar',
    discoverWeekly: 'Discover Weekly',
    starred: 'Starred',
    timeToArchive: 30 * 24 * 60 * 60 * 1000,
    playsToArchive: 5,
    promoteThrottleMs: 5 * 60 * 60 * 1000,
    archivePlaylistNameFor: buildArchiveNamer(),
    ...overrides,
  }
}

function user(id = 'test-user'): UserData {
  return {
    id,
    spotifyAuth: { accessToken: '', refreshToken: '', expiresAt: 0 },
    lastPlayedAtProcessedTimestamp: 1_000,
  }
}

function context(
  client: Spotify,
  dynamo: Dynamo = { user: user() } as Dynamo,
  resolvedSettings = settings(),
): PerformContext {
  return { client, dynamo, now: NOW, settings: resolvedSettings }
}

function playlist(id: string, name: string): Playlist {
  return {
    id,
    name,
    uri: `spotify:playlist:${id}`,
  } as Playlist
}

function track(id: string, artistId = 'artist-a'): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: id,
    type: 'track',
    artists: [{ id: artistId, name: artistId }],
    album: { name: `${id} album`, artists: [{ id: artistId, name: artistId }] },
  } as Track
}

function playlistTrack(
  id: string,
  added_at = '2026-01-01T00:00:00.000Z',
  artistId = 'artist-a',
): PlaylistTrack {
  return {
    added_at,
    is_local: false,
    track: track(id, artistId),
  } as PlaylistTrack
}

function triagePlaylists() {
  return {
    Inbox: playlist('playlist-inbox', 'Inbox'),
    Current: playlist('playlist-current', 'Current'),
    'Release Radar': playlist('playlist-release', 'Release Radar'),
    'Discover Weekly': playlist('playlist-discover', 'Discover Weekly'),
    Starred: playlist('playlist-starred', 'Starred'),
  }
}

function namedPlaylistClient(extra: Record<string, unknown> = {}): Spotify {
  const byName = triagePlaylists()
  const client = {
    async playlist(name: keyof typeof byName) {
      const found = byName[name]
      if (!found) throw `cannot find playlist named ${name}`
      return found
    },
    async optionalPlaylist(name: keyof typeof byName) {
      return byName[name]
    },
  }

  Object.defineProperties(client, Object.getOwnPropertyDescriptors(extra))

  return client as unknown as Spotify
}

function mutationTypes(
  sets: Awaited<ReturnType<MagicPromoteAction['perform']>>,
) {
  return sets.flat().map((mutation) => mutation.storage.mutationType)
}

describe('live track identity and triage gathers', () => {
  it('returns the current track uri without inventing a track id', async () => {
    const client = {
      currentTrack: Promise.resolve(track('a')),
    } as unknown as Spotify

    await expect(currentTrackIdentity(client)).resolves.toEqual({
      trackURI: 'spotify:track:a',
    })
  })

  it('clears the player memo and retries one empty current-track read', async () => {
    let reads = 0
    const client = {
      __mem_player: 'stale',
      get currentTrack() {
        reads += 1
        return Promise.resolve(reads === 1 ? undefined : track('rescued'))
      },
    } as unknown as Spotify

    const identity = await currentTrackIdentity(client)

    expect(identity).toEqual({ trackURI: 'spotify:track:rescued' })
    expect(reads).toBe(2)
    expect((client as any).__mem_player).toBeNull()
  })

  it('maps live Spotify state into the promote snapshot and real plan', async () => {
    const playing = track('a')
    const calls: string[] = []
    const client = namedPlaylistClient({
      player: Promise.resolve({ is_playing: true }),
      currentTrack: Promise.resolve(playing),
      async trackInPlaylist(_track: Track, target: Playlist) {
        calls.push(target.id)
        return target.id === 'playlist-inbox' ? playlistTrack('a') : undefined
      },
      async trackIsSaved() {
        return true
      },
    })
    const action = new MagicPromoteAction(client, {
      trackURI: playing.uri,
    })
    action.created_at = 123

    const snapshot = await action.gatherPromote(client)
    const plan = await action.perform(context(client))

    expect(snapshot).toEqual({
      player: 'playing',
      track: {
        id: 'a',
        uri: 'spotify:track:a',
        name: 'a',
        artist: 'artist-a',
        album: 'a album',
      },
      membership: {
        saved: 'present',
        current: 'absent',
        inbox: 'present',
      },
      playlists: {
        inbox: triagePlaylists().Inbox,
        current: triagePlaylists().Current,
      },
      now: 123,
    })
    expect(calls).toEqual([
      'playlist-inbox',
      'playlist-current',
      'playlist-inbox',
      'playlist-current',
    ])
    expect(mutationTypes(plan)).toEqual([
      'add-tracks',
      'triage-action',
      'remove-track',
      'triage-action',
    ])
    expect(await action.getID()).toBe('promote:spotify:track:a')
    expect(
      typeof action.idThrottleMs === 'function'
        ? action.idThrottleMs(settings())
        : action.idThrottleMs,
    ).toBe(settings().promoteThrottleMs)
  })

  it('adopts the rescued live track uri so a completed demote can be stored', async () => {
    let reads = 0
    const playing = track('rescued')
    const client = namedPlaylistClient({
      __mem_player: 'stale',
      get currentTrack() {
        reads += 1
        return Promise.resolve(reads === 1 ? undefined : playing)
      },
      currentlyPlayingPlaylist: Promise.resolve(
        playlist('playlist-foreign', 'Foreign'),
      ),
      async trackInPlaylist(_track: Track, target: Playlist) {
        return target.id === 'playlist-starred'
          ? playlistTrack('rescued')
          : undefined
      },
    })
    const action = new DemoteAction(client)
    action.created_at = 456

    const snapshot = await action.gatherDemote(client)

    expect(snapshot.playingFrom).toEqual(
      playlist('playlist-foreign', 'Foreign'),
    )
    expect(snapshot.starredMembership).toBe('present')
    expect(snapshot.track.id).toBe('rescued')
    expect(snapshot.now).toBe(456)
    expect(reads).toBe(2)
    expect((client as any).__mem_player).toBeNull()
    expect(await action.getID()).toBe('demote:spotify:track:rescued')
  })
})

describe('playlist and table gathers', () => {
  it('gathers seen-table and live Inbox membership for inbox planning', async () => {
    const source = [playlistTrack('a'), playlistTrack('b'), playlistTrack('c')]
    const queried: string[][] = []
    const client = namedPlaylistClient({
      async tracksForPlaylist({ id }: { id: string }) {
        if (id === 'source') return source
        if (id === 'playlist-inbox') return [playlistTrack('b')]
        throw new Error(`unexpected playlist ${id}`)
      },
    })
    const dynamo = {
      user: user(),
      async getSeenTracks(ids: string[]) {
        queried.push(ids)
        return ids.map((id) => ({ id, found: id === 'a' }))
      },
    } as unknown as Dynamo
    const filter = (item: PlaylistTrack) => item.track.id !== 'filtered'
    const action = new AddPlaylistToInbox(client, { id: 'source' }, filter)
    ;(action as any).created_at = 789

    const snapshot = await action.gather(context(client, dynamo))
    const plan = await action.perform(context(client, dynamo))

    expect(queried).toEqual([
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
    ])
    expect(snapshot.seenTrackIds).toEqual(['a'])
    expect(snapshot.inboxTrackIds).toEqual(['b'])
    expect(snapshot.inbox.id).toBe('playlist-inbox')
    expect(snapshot.now).toBe(789)
    expect(snapshot.trackFilter).toBe(filter)
    expect(plan.flat().map((m) => m.storage.data)).toEqual([
      {
        tracks: [{ id: 'c', uri: 'spotify:track:c' }],
        playlist: { id: 'playlist-inbox' },
      },
      { track: { id: 'c' }, actionType: 'inboxed', action_at: 789 },
    ])
  })

  it('deduplicates Inbox and Current ids before the manual-triage table read', async () => {
    const inboxTracks = [playlistTrack('a'), playlistTrack('shared')]
    const currentTracks = [playlistTrack('shared'), playlistTrack('b')]
    const queried: string[][] = []
    const rows = { a: { id: 'a' } as TrackItem }
    const client = namedPlaylistClient({
      async tracksForPlaylist({ id }: { id: string }) {
        return id === 'playlist-inbox' ? inboxTracks : currentTracks
      },
    })
    const dynamo = {
      user: user(),
      async getTracks(ids: string[]) {
        queried.push(ids)
        return rows
      },
    } as unknown as Dynamo

    const snapshot = await new ProcessManualTriage(client).gather(
      context(client, dynamo),
    )

    expect(queried).toEqual([['a', 'shared', 'b']])
    expect(snapshot).toEqual({ inboxTracks, currentTracks, trackRows: rows })
  })

  it('maps resolved triage playlist ids onto playback stages', async () => {
    const playedItems = [
      {
        track: track('a'),
        played_at: new Date(2_000).toISOString(),
        context: { uri: 'spotify:playlist:playlist-inbox' },
      },
    ] as RecentlyPlayedItem[]
    const optionalReads: string[] = []
    const client = namedPlaylistClient({
      async recentlyPlayed(since: number) {
        expect(since).toBe(1_000)
        return playedItems
      },
      async optionalPlaylist(name: string) {
        optionalReads.push(name)
        return (triagePlaylists() as Record<string, Playlist>)[name]
      },
    })
    const dynamo = { user: user('dynamo-user') } as Dynamo
    const action = new ProcessPlaybackHistoryAction(client, user('input-user'))

    const snapshot = await action.gather(context(client, dynamo))

    expect(optionalReads).toEqual(['Inbox', 'Current'])
    expect(snapshot.playedItems).toBe(playedItems)
    expect(Array.from(snapshot.stageByPlaylistId.entries())).toEqual([
      ['playlist-inbox', 'inbox'],
      ['playlist-current', 'current'],
    ])
    expect(snapshot.watermark).toBe(1_000)
    expect(snapshot.userId).toBe('dynamo-user')
  })

  it('skips the two triage-playlist reads when playback returned nothing', async () => {
    let optionalReads = 0
    const client = namedPlaylistClient({
      async recentlyPlayed() {
        return []
      },
      async optionalPlaylist() {
        optionalReads += 1
        return undefined
      },
    })

    const snapshot = await new ProcessPlaybackHistoryAction(
      client,
      user(),
    ).gather(context(client))

    expect(optionalReads).toBe(0)
    expect(snapshot.stageByPlaylistId.size).toBe(0)
  })

  it('gathers the auto-artist source playlist and saved library together', async () => {
    const playlistTracks = [playlistTrack('source')]
    const savedTracks = [track('saved')]
    const client = {
      async tracksForPlaylist({ id }: { id: string }) {
        expect(id).toBe('auto')
        return playlistTracks
      },
      async mySavedTracks() {
        return savedTracks
      },
    } as unknown as Spotify

    const snapshot = await new AutoArtistPlaylist(client, {
      id: 'auto',
    }).gather(context(client))

    expect(snapshot).toEqual({
      playlistTracks,
      savedTracks,
      playlist: { id: 'auto' },
    })
  })
})

describe('ArchiveAction gather', () => {
  it('resolves archive buckets once and force-refreshes only the first name', async () => {
    const currentTracks = [
      playlistTrack('january', '2026-01-10T12:00:00.000Z'),
      playlistTrack('february', '2026-02-10T12:00:00.000Z'),
    ]
    const rows: TrackStatusRow[] = [
      { id: 'inbox-kept', status: 'inbox' },
      { id: 'saved-kept', status: 'promoted' },
    ]
    const resolutions: Array<{ name: string; forceRefresh: boolean }> = []
    const playlistReads: string[] = []
    const client = {
      async optionalPlaylist(name: string) {
        if (name === 'Current') return playlist('playlist-current', 'Current')
        if (name === 'Inbox') return playlist('playlist-inbox', 'Inbox')
        return undefined
      },
      async tracksForPlaylist({ id }: { id: string }) {
        playlistReads.push(id)
        return id === 'playlist-current'
          ? currentTracks
          : [playlistTrack('inbox-kept')]
      },
      async getOrCreatePlaylist(name: string, forceRefresh: boolean) {
        resolutions.push({ name, forceRefresh })
        return playlist(`archive-${name}`, name)
      },
      async mySavedTracks() {
        return [track('saved-kept')]
      },
    } as unknown as Spotify
    const trackReads: string[][] = []
    const dynamo = {
      user: user(),
      async tracksWithLiveStatus() {
        return rows
      },
      async getTracks(ids: string[]) {
        trackReads.push(ids)
        return { february: { play_count_current: 3 } }
      },
    } as unknown as Dynamo
    const action = new ArchiveAction(client)
    action.created_at = 99
    const resolvedSettings = settings({
      timeToArchive: 0,
      archivePlaylistNameFor: buildArchiveNamer(),
    })

    const snapshot = await action.gather(
      context(client, dynamo, resolvedSettings),
    )

    expect(resolutions).toEqual([
      { name: '2026 - January', forceRefresh: true },
      { name: '2026 - February', forceRefresh: false },
    ])
    expect(playlistReads).toEqual(['playlist-current', 'playlist-inbox'])
    // Counters come off the track rows, keyed to exactly what Current holds —
    // the status scan projects id and status only and cannot supply them.
    expect(trackReads).toEqual([['january', 'february']])
    expect(snapshot.changed_at).toBe(99)
    expect(snapshot.liveStatusRows).toBe(rows)
    expect(snapshot.inbox).toEqual({
      listing: 'read',
      name: 'Inbox',
      trackIds: new Set(['inbox-kept']),
    })
    expect(snapshot.savedTrackIds).toEqual(new Set(['saved-kept']))
    expect(snapshot.current.listing).toBe('read')
    if (snapshot.current.listing === 'read') {
      expect(Array.from(snapshot.current.archivePlaylists.keys())).toEqual([
        '2026 - January',
        '2026 - February',
      ])
      expect(snapshot.current.tracks).toEqual([
        {
          added_at: '2026-01-10T12:00:00.000Z',
          track: { uri: 'spotify:track:january', id: 'january' },
          play_count_current: 0,
        },
        {
          added_at: '2026-02-10T12:00:00.000Z',
          track: { uri: 'spotify:track:february', id: 'february' },
          play_count_current: 3,
        },
      ])
    }
    expect(snapshot.playsToArchive).toBe(5)
  })
})

describe('scan and smart-playlist wiring', () => {
  it('builds one inbox action for each configured source that exists', async () => {
    const client = namedPlaylistClient()
    const actions = await new ScanPlaylistsForInbox(client).addActions()

    expect(actions.map((action) => action.playlistID)).toEqual([
      'playlist-discover',
      'playlist-release',
    ])
  })

  test.failing(
    'wires onlyOriginals into the Release Radar inbox action',
    async () => {
      const client = namedPlaylistClient()
      const actions = await new ScanPlaylistsForInbox(client).addActions()
      const releaseRadar = actions.find(
        (action) => action.playlistID === 'playlist-release',
      )

      expect(releaseRadar?.trackFilter).toBe(onlyOriginals)
    },
  )

  it('gathers the smart playlist, streamable Starred tracks, and chosen artist', async () => {
    const starredTracks = [
      playlistTrack('starred-a', undefined, 'artist-a'),
      {
        ...playlistTrack('local', undefined, 'artist-local'),
        track: {
          ...track('local', 'artist-local'),
          uri: 'spotify:local:artist:album:track',
        },
      } as PlaylistTrack,
    ]
    const savedTracks = [track('liked-a', 'artist-a')]
    let savedReads = 0
    const client = namedPlaylistClient({
      async mySavedTracks() {
        savedReads += 1
        return savedTracks
      },
      async playlistByPrefix(prefix: string) {
        expect(prefix).toBe('Smart Playlist')
        return playlist('playlist-smart', 'Smart Playlist')
      },
      async tracksForPlaylist(target: Playlist) {
        expect(target.id).toBe('playlist-starred')
        return starredTracks
      },
    })
    const action = new RulePlaylistAction(client, { rule: 'smart' }, () => 0)

    const plan = await action.perform(context(client))
    const storage = plan.flat().map((mutation) => mutation.storage)

    expect(savedReads).toBe(2)
    expect(storage.map((mutation) => mutation.mutationType)).toEqual([
      'empty-playlist',
      'add-tracks',
      'add-tracks',
      'rename-playlist',
    ])
    expect(storage[1].data).toEqual({
      tracks: [{ uri: 'spotify:track:starred-a', id: undefined }],
      playlist: { id: 'playlist-smart' },
    })
    expect(storage[2].data).toEqual({
      tracks: [{ uri: 'spotify:track:liked-a', id: 'liked-a' }],
      playlist: { id: 'playlist-smart' },
    })
    expect(storage[3].data).toEqual({
      playlist: { id: 'playlist-smart' },
      name: 'Smart Playlist — artist-a',
    })
  })

  test.failing('returns an empty plan when Starred has no tracks', async () => {
    const client = namedPlaylistClient({
      async mySavedTracks() {
        return []
      },
      async playlistByPrefix() {
        return playlist('playlist-smart', 'Smart Playlist')
      },
      async tracksForPlaylist() {
        return []
      },
    })
    const action = new RulePlaylistAction(client, { rule: 'smart' }, () => 0)

    await expect(action.perform(context(client))).resolves.toEqual([])
  })
})

describe('concrete action ids and storage', () => {
  it('keeps skip id stable and plans its mutation', async () => {
    const client = {} as Spotify
    const action = new SkipToNextTrack(client)

    expect(await action.getID()).toBe('skip-to-next-track')
    expect((await action.perform(context(client)))[0][0].storage).toEqual({
      type: 'mutation',
      mutationType: 'skip-to-next-track',
      data: {},
    })
  })

  it('stores playback history with a 183-day epoch-seconds ttl', async () => {
    const action = new ProcessPlaybackHistoryAction({} as Spotify, user())
    ;(action as any).created_at = NOW

    const stored = await action.forStorage([])

    expect(stored).toEqual({
      id: `process-playback-history:${NOW}`,
      created_at: NOW,
      action: 'process-playback-history',
      mutations: [],
      ttl: Math.floor((NOW + 183 * 24 * 60 * 60 * 1000) / 1000),
    })
  })
})
