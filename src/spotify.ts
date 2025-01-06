import SpotifyWebApi, {
  Track,
  PlaylistTrack,
  User,
  RecentlyPlayedItem,
} from 'spotify-web-api-node'

function hasID(obj: { id: string } | { uri: string }): obj is { id: string } {
  if ('id' in obj) {
    return !!obj.id
  } else {
    return false
  }
}

function hasURI(obj: { id: string } | { uri: string }): obj is { uri: string } {
  if ('uri' in obj) {
    return !!obj.uri
  } else {
    return false
  }
}

function groupArrayBy<T>(array: T[], count: number): T[][] {
  let grouped: T[][] = []

  for (let i = 0, j = array.length; i < j; i += count) {
    let temparray = array.slice(i, i + count)
    grouped.push(temparray)
  }

  return grouped
}

function asyncMemoize<T>(
  target: T,
  propertyKey: string,
  descriptor: PropertyDescriptor,
) {
  const { value, get } = descriptor

  const memkey = `__mem_${propertyKey}`

  if (typeof value === 'function') {
    descriptor.value = function (this: any, ...args: any[]) {
      if (this[memkey]) {
        console.log(`👯‍♀️ Cached ${propertyKey}`)
        return this[memkey]
      }

      console.log(`🔈 Executing ${propertyKey}`)

      const promise = value.apply(this, args)

      promise.then(() => console.log(`📥 Returned ${propertyKey}`))
      promise.catch((error: any) =>
        console.error(`🧨 Error in ${propertyKey}`, error),
      )

      this[memkey] = promise

      return promise
    }

    descriptor.value.reset = function () {
      this[memkey] = null
    }
  }

  if (typeof get === 'function') {
    descriptor.get = function (this: any) {
      if (this[memkey]) {
        console.log(`👯‍♀️ Cached ${propertyKey}`)
        return this[memkey]
      }

      console.log(`🔈 Executing ${propertyKey}`)

      const promise = get.call(this)

      promise.then(() => console.log(`📥 Returned ${propertyKey}`))
      promise.catch((error: any) =>
        console.error(`🧨 Error in ${propertyKey}`, error),
      )

      this[memkey] = promise

      return promise
    }
  }
}

function logError<T>(
  target: T,
  propertyKey: string,
  descriptor: PropertyDescriptor,
) {
  const { value, get, set } = descriptor

  if (typeof value === 'function') {
    descriptor.value = async function (...args: any[]) {
      try {
        console.log(`🔈 Executing ${propertyKey}`)
        const promise = value.apply(this, args)
        promise.then(() => console.log(`📥 Returned ${propertyKey}`))
        return promise
      } catch (error) {
        console.error(`🧨 Error in ${propertyKey}`, error)
        throw error
      }
    }
  }
  if (typeof get === 'function') {
    descriptor.get = async function () {
      try {
        console.log(`🔈 Executing get ${propertyKey}`)
        const promise = get.call(this)
        promise.then(() => console.log(`📥 Returned get ${propertyKey}`))
        return promise
      } catch (error) {
        console.error(`🧨 Error in ${propertyKey}`, error)
        throw error
      }
    }
  }

  if (typeof set === 'function') {
    descriptor.set = async function (val: any) {
      try {
        console.log(`🔈 Executing set ${propertyKey}`)
        set.call(this, val)
      } catch (error) {
        console.error(`🧨 Error in ${propertyKey}`, error)
        throw error
      }
    }
  }
}

export interface SpotifyPesonalCreds {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export type TrackForMove = { uri: string; type?: 'track'; id?: string }
export type PlaylistID = { id: string; type?: 'playlist' }

import { getEnv } from './env'
import { Dynamo } from './db/dynamo'
import { delay } from './utils/delay'

const env = getEnv().then((env) => env.spotify)

export function displayTrack(track: Track): string {
  return `🎵 ${track.album.artists[0].name} - ${track.name}`
}

async function getClient(dynamo: Dynamo) {
  const { clientId, clientSecret } = await env

  let u = dynamo.user

  if (u.spotifyAuth.expiresAt < new Date().getTime()) {
    const { accessToken, refreshToken } = u.spotifyAuth
    const client = new SpotifyWebApi({
      accessToken,
      refreshToken,
      clientId,
      clientSecret,
    })

    const refreshed = await client.refreshAccessToken()

    const expiresAt = refreshed.body.expires_in * 1000 + new Date().getTime()

    u = await dynamo.updateAccessToken(
      u.id,
      refreshed.body.access_token,
      expiresAt,
    )
  }

  const { accessToken, refreshToken } = u.spotifyAuth

  return new SpotifyWebApi({
    accessToken,
    refreshToken,
    clientId,
    clientSecret,
  })
}

export class Spotify {
  static async get(dynamo: Dynamo) {
    const client = await getClient(dynamo)

    return new Spotify(client)
  }

  private constructor(readonly client: SpotifyWebApi) {}

  private _meData?: User
  async myID() {
    if (this._meData) {
      return this._meData.id
    }

    const me = await this.client.getMe()

    this._meData = me.body

    return me.body.id
  }

  @asyncMemoize
  async allPlaylists() {
    const client = this.client

    let response = await client.getUserPlaylists({ limit: 50 })
    let items = response.body.items

    while (response.body.next) {
      response = await client.getUserPlaylists({
        limit: response.body.limit,
        offset: response.body.limit + response.body.offset,
      })

      items = [...items, ...response.body.items]
    }

    return items
  }

  async optionalPlaylist(named: string) {
    const playlists = await this.allPlaylists()

    console.log(named, playlists)

    const playlist = playlists.find((p) => p?.name === named)

    return playlist
  }

  async playlist(named: string) {
    const playlist = await this.optionalPlaylist(named)

    if (!playlist) throw `cannot find playlist named ${named}`

    return playlist
  }

  @logError
  private async createPlaylist(named: string) {
    const result = await this.client.createPlaylist(named)
    ;(this.allPlaylists as any).reset()

    return result.body
  }

  async getOrCreatePlaylist(named: string) {
    let playlist = await this.optionalPlaylist(named)
    if (playlist) {
      return playlist
    }

    return this.createPlaylist(named)
  }

  private _tracks: { [k: string]: PlaylistTrack[] } = {}
  @logError
  async tracksForPlaylist({ id, name }: { id?: string; name?: string }) {
    if (!id && name) {
      const playlist = await this.playlist(name)
      id = playlist.id
    }

    if (!id) throw 'must provide id or name'

    if (id in this._tracks) {
      console.log(`👯‍♀️ Cached read of playlist ${name ?? id}`)
      return this._tracks[id]
    }

    const client = this.client

    let response = await client.getPlaylistTracks(id, { limit: 100 })
    let items = response.body.items

    while (response.body.next) {
      response = await client.getPlaylistTracks(id, {
        limit: response.body.limit,
        offset: response.body.limit + response.body.offset,
      })

      items = [...items, ...response.body.items]
    }

    console.log(`📥 Writing cache of playlist ${name ?? id}`)
    this._tracks[id] = items

    return items
  }

  async trackInPlaylist(
    srcTrack: { id: string } | { uri: string },
    playlist: { id?: string; name?: string },
  ) {
    const tracks = await this.tracksForPlaylist(playlist)

    let track: PlaylistTrack | undefined
    if (hasID(srcTrack)) {
      track = tracks.find(({ track }) => srcTrack.id === track.id)
    } else if (hasURI(srcTrack)) {
      track = tracks.find(({ track }) => srcTrack.uri === track.uri)
    } else {
      throw `somehow a bad value got in`
    }

    return track
  }

  @asyncMemoize
  get player() {
    const player = Promise.resolve(this.client)
      .then((client) => client.getMyCurrentPlaybackState())
      .then(({ body }) => body)

    return player
  }

  get currentTrack() {
    return this.player.then((player) => {
      if (
        player.currently_playing_type === 'track' &&
        player.item &&
        player.item.type == 'track'
      ) {
        return player.item
      }
    })
  }

  get currentlyPlayingPlaylist() {
    return this.player.then(async (player) => {
      if (!player.context) return
      if (player.context.type !== 'playlist') return

      const { uri } = player.context
      const playlists = await this.allPlaylists()
      return playlists.find((playlist) => playlist.uri === uri)
    })
  }

  @logError
  saveTrack(...ids: string[]) {
    if (dev.drySpotify) {
      console.log('save track')
      return Promise.resolve({})
    }

    return Promise.resolve(this.client)
      .then((client) => client.addToMySavedTracks(ids))
      .then(({ body }) => body)
  }

  @logError
  unsaveTrack(...ids: string[]) {
    if (dev.drySpotify) {
      console.log('unsave track')
      return Promise.resolve({})
    }

    return Promise.resolve(this.client)
      .then((client) => client.removeFromMySavedTracks(ids))
      .then(({ body }) => body)
  }

  @logError
  async trackIsSaved({ id }: { id: string }) {
    const client = this.client
    const response = await client.containsMySavedTracks([id])
    return response.body[0]
  }

  @logError
  async addTrackToPlaylist(
    { id: playlistId }: PlaylistID,
    ...tracks: TrackForMove[]
  ): Promise<{ snapshot_id: string }[]> {
    if (dev.drySpotify) {
      console.log('add track to playlist')
      return Promise.resolve([{ snapshot_id: 'fake' }])
    }

    // Warning the track in playlist cache could cause issues if you try to add the same track multiple times
    const tracksToAdd: TrackForMove[] = []
    for (let track of tracks) {
      const trackInPlaylist = await this.trackInPlaylist(track, {
        id: playlistId,
      })

      if (!trackInPlaylist) {
        tracksToAdd.push(track)
      }
    }

    if (tracksToAdd.length === 0) {
      return []
    }

    const uris = tracksToAdd.map((tr) => tr.uri)
    const uriSets = groupArrayBy(uris, 100)

    const client = this.client

    // const promises = uriSets.map((uris) =>
    //   WebApiRequest.builder(client.getAccessToken())
    //     .withPath(`/v1/playlists/${encodeURIComponent(playlistId)}/tracks`)
    //     .withHeaders({ 'Content-Type': 'application/json' })
    //     .withBodyParameters({
    //       uris,
    //     })
    //     .build()
    //     .execute(HttpManager.post)
    //     .then((r: any) => r.body),
    // )

    const promises = uriSets.map((uris) =>
      client.addTracksToPlaylist(playlistId, uris),
    )

    const responses = await Promise.all(promises)
    return responses.map((r) => r.body)
  }

  @logError
  async removeTrackFromPlaylist(
    { id: playlistId }: PlaylistID,
    ...tracksData: TrackForMove[]
  ) {
    if (dev.drySpotify) {
      console.log('remove track from playlist')
      return Promise.resolve({})
    }

    const tracks: { uri: string }[] = tracksData.map(({ uri }) => {
      return { uri }
    })

    const client = this.client
    const response = await client.removeTracksFromPlaylist(playlistId, tracks)
    // const response = await WebApiRequest.builder(client.getAccessToken())
    //   .withPath(`/v1/playlists/${encodeURIComponent(playlistId)}/tracks`)
    //   .withHeaders({ 'Content-Type': 'application/json' })
    //   .withBodyParameters({
    //     tracks,
    //   })
    //   .build()
    //   .execute(HttpManager.del)

    return response.body
  }

  @logError
  async emptyPlaylist(playlistId: string) {
    const tracks = await this.tracksForPlaylist({ id: playlistId })
    const trackUris = tracks.map((track) => ({ uri: track.track.uri }))

    if (trackUris.length > 0) {
      await this.client.removeTracksFromPlaylist(playlistId, trackUris)
    }
  }

  async moveTracks(
    from: PlaylistID,
    to: PlaylistID,
    ...tracks: TrackForMove[]
  ) {
    const remP = this.removeTrackFromPlaylist(from, ...tracks)
    const addP = this.addTrackToPlaylist(to, ...tracks)

    await remP
    await addP
  }

  @logError
  async getTrack(id: string) {
    const client = this.client
    const resp = await client.getTrack(id)

    return resp.body
  }

  private _savedTracks?: Promise<Track[]>
  @logError
  mySavedTracks() {
    if (this._savedTracks) {
      return this._savedTracks
    }

    // Did an async function call because going straight to a promise felt like a pita
    const run = async () => {
      let response = await this.client.getMySavedTracks({ limit: 50 })
      let items = response.body.items.map((st) => st.track)

      let i = 1

      while (response.body.next) {
        try {
          const offset = response.body.limit + response.body.offset

          console.log(`🛫 mySavedTracks page ${i} offset:${offset}`)

          response = await this.client.getMySavedTracks({
            limit: response.body.limit,
            offset,
          })

          i += 1

          items = [...items, ...response.body.items.map((st) => st.track)]
        } catch (error: any) {
          console.error(error)
          const retryAfterStr: string | undefined =
            error.response?.headers?.['retry-after'] ??
            error.headers?.['retry-after']

          if (retryAfterStr) {
            const retryAfter = parseInt(retryAfterStr, 10)
            const delayFor = retryAfter * 1000 + 100
            console.log(`⏲ mySavedTracks delaying page ${i} for ${delayFor}ms`)
            await delay(delayFor)
            continue
          } else {
            throw error
          }
        }
      }
      return items
    }

    this._savedTracks = run()

    return this._savedTracks
  }

  @logError
  async skipToNextTrack() {
    const context = await this.player
    if (!context.is_playing) {
      return
    }

    return this.client.skipToNext({ device_id: context.device.id })
  }

  @logError
  async recentlyPlayed(untilTS?: number) {
    const maxLoops = 5

    let items: RecentlyPlayedItem[] = []
    //api.spotify.com/v1/me/player/recently-played?before=1631066767955&limit=50

    let before: string | undefined | number

    for (let loopCount = 0; loopCount < maxLoops; loopCount += 1) {
      const r = await this.client.getMyRecentlyPlayedTracks({
        limit: 50,
        before,
      })

      before = r.body.cursors?.before

      const relevantItems = r.body.items.filter(
        (i) => Date.parse(i.played_at) > (untilTS || 0),
      )

      if (relevantItems.length) {
        items = [...items, ...relevantItems]
      } else {
        break
      }
    }

    return items
  }
}
