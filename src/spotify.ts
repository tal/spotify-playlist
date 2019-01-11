import SpotifyWebApi, { Track, PlaylistTrack, User } from 'spotify-web-api-node'
import * as WebApiRequest from 'spotify-web-api-node/src/webapi-request'
import * as HttpManager from 'spotify-web-api-node/src/http-manager'
import { updateAccessToken } from './db/update'
import AWSXRay from 'aws-xray-sdk-core'

function hasID(obj: { id: string } | { uri: string }): obj is { id: string } {
  return 'id' in obj
}

function hasURI(obj: { id: string } | { uri: string }): obj is { uri: string } {
  return 'uri' in obj
}

function asyncMemoize<T>(
  target: T,
  propertyKey: string,
  descriptor: PropertyDescriptor,
) {
  const { value, get } = descriptor

  const memkey = `__mem_${propertyKey}`

  if (typeof value === 'function') {
    descriptor.value = function(this: any, ...args: any[]) {
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

    descriptor.value.reset = function() {
      this[memkey] = null
    }
  }

  if (typeof get === 'function') {
    descriptor.get = function(this: any) {
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
    descriptor.value = async function(...args: any[]) {
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
    descriptor.get = async function() {
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
    descriptor.set = async function(val: any) {
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

const env = getEnv().then(env => env.spotify)

export function displayTrack(track: Track): string {
  return `🎵 ${track.album.artists[0].name} - ${track.name}`
}

async function getClient(u: UserData) {
  const { clientId, clientSecret } = await env

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

    u = await updateAccessToken(u.id, refreshed.body.access_token, expiresAt)
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
  static async get(u?: UserData) {
    if (!u) throw 'user required to initialize spotify'
    const client = await getClient(u)

    return new Spotify(client)
  }

  private constructor(private client: SpotifyWebApi) {}

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

    const playlist = playlists.find(p => p.name === named)

    return playlist
  }

  async playlist(named: string) {
    const playlist = await this.optionalPlaylist(named)

    if (!playlist) throw `cannot find playlist named ${named}`

    return playlist
  }

  @logError
  private async createPlaylist(named: string) {
    const result = await this.client.createPlaylist(await this.myID(), named)
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

    this._tracks[id] = items

    return items
  }

  async trackInPlaylist(
    srcTrack: { id: string } | { uri: string },
    playlist: { id?: string; name?: string },
  ) {
    const tracks = await this.tracksForPlaylist(playlist)

    if (hasID(srcTrack)) {
      return !!tracks.find(({ track }) => srcTrack.id === track.id)
    } else if (hasURI(srcTrack)) {
      return !!tracks.find(({ track }) => srcTrack.uri === track.uri)
    } else {
      throw `somehow a bad value got in`
    }
  }

  @asyncMemoize
  get player() {
    const player = Promise.resolve(this.client)
      .then(client => client.getMyCurrentPlaybackState())
      .then(({ body }) => body)

    return player
  }

  get currentTrack() {
    return this.player.then(player => {
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
    return this.player.then(async player => {
      if (!player.context) return
      if (player.context.type !== 'playlist') return

      const { uri } = player.context
      const playlists = await this.allPlaylists()
      return playlists.find(playlist => playlist.uri === uri)
    })
  }

  @logError
  saveTrack(...ids: string[]) {
    if (dev.drySpotify) {
      console.log('save track')
      return Promise.resolve({})
    }

    return Promise.resolve(this.client)
      .then(client => client.addToMySavedTracks(ids))
      .then(({ body }) => body)
  }

  @logError
  unsaveTrack(...ids: string[]) {
    if (dev.drySpotify) {
      console.log('unsave track')
      return Promise.resolve({})
    }

    return Promise.resolve(this.client)
      .then(client => client.removeFromMySavedTracks(ids))
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
  ): Promise<{ snapshot_id: string } | undefined> {
    if (dev.drySpotify) {
      console.log('add track to playlist')
      return Promise.resolve({ snapshot_id: 'fake' })
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
      return
    }

    const uris = tracksToAdd.map(tr => tr.uri)

    const client = this.client
    const response = await WebApiRequest.builder(client.getAccessToken())
      .withPath(`/v1/playlists/${encodeURIComponent(playlistId)}/tracks`)
      .withHeaders({ 'Content-Type': 'application/json' })
      .withBodyParameters({
        uris,
      })
      .build()
      .execute(HttpManager.post)

    return response.body
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
    const response = await WebApiRequest.builder(client.getAccessToken())
      .withPath(`/v1/playlists/${encodeURIComponent(playlistId)}/tracks`)
      .withHeaders({ 'Content-Type': 'application/json' })
      .withBodyParameters({
        tracks,
      })
      .build()
      .execute(HttpManager.del)

    return response.body
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

  private _savedTracks?: Track[]
  @logError
  async mySavedTracks() {
    if (this._savedTracks) {
      return this._savedTracks
    }

    const subsegment = AWSXRay.getSegment().addNewSubsegment('Get Saved Tracks')

    try {
      let response = await this.client.getMySavedTracks({ limit: 50 })
      let items = response.body.items.map(st => st.track)

      while (response.body.next) {
        response = await this.client.getMySavedTracks({
          limit: response.body.limit,
          offset: response.body.limit + response.body.offset,
        })

        items = [...items, ...response.body.items.map(st => st.track)]
      }

      this._savedTracks = items

      return items
    } catch (err) {
      subsegment.addError(err)
      throw err
    } finally {
      subsegment.close()
    }
  }

  @logError
  async skipToNextTrack() {
    const context = await this.player
    if (!context.is_playing) {
      return
    }

    return WebApiRequest.builder(this.client.getAccessToken())
      .withPath('/v1/me/player/next')
      .withHeaders({ 'Content-Type': 'application/json' })
      .withQueryParameters({ device_id: context.device.id })
      .build()
      .execute(HttpManager.post)
  }
}
