import SpotifyWebApi, {
  Playlist,
  PlayBackContext,
  Track,
  PlaylistTrack,
  User,
} from 'spotify-web-api-node'
import * as WebApiRequest from 'spotify-web-api-node/src/webapi-request'
import * as HttpManager from 'spotify-web-api-node/src/http-manager'
import { updateAccessToken } from './db/update'

function hasID(obj: { id: string } | { uri: string }): obj is { id: string } {
  return 'id' in obj
}

function hasURI(obj: { id: string } | { uri: string }): obj is { uri: string } {
  return 'uri' in obj
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

  // throw `Cannot log ${propertyKey} because it's an unsupported type`
}

export interface SpotifyPesonalCreds {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export type TrackForMove = { uri: string; type?: 'track'; id?: string }
export type PlaylistID = { id: string; type?: 'playlist' }

import { getEnv } from './env'
import { type } from 'os'
import { put } from './db/put'

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

  private _allPlaylists?: Playlist[]
  @logError
  async allPlaylists() {
    if (this._allPlaylists) {
      return this._allPlaylists
    }

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

    this._allPlaylists = items

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

    if (this._allPlaylists) {
      this._allPlaylists.push(result.body)
    } else {
      throw 'cannot create a playlist if you havent first tried to find all them'
    }

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

  private _player?: Promise<PlayBackContext>
  @logError
  get player() {
    if (this._player) {
      return this._player
    }

    const player = Promise.resolve(this.client)
      .then(client => client.getMyCurrentPlaybackState())
      // .then(resp => {
      //   console.log('state', resp)
      //   return resp
      // })
      .then(({ body }) => body)

    setTimeout(() => (this._player = undefined), 10 * 1000)
    this._player = player

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
    track: TrackForMove,
    { id: playlistId }: PlaylistID,
  ): Promise<{ snapshot_id: string } | undefined> {
    if (dev.drySpotify) {
      console.log('add track to playlist')
      return Promise.resolve({ snapshot_id: 'fake' })
    }

    // Warning the track in playlist cache could cause issues if you try to add the same track multiple times
    if (track.id) {
      const trackInPlaylist = await this.trackInPlaylist(
        { id: track.id },
        { id: playlistId },
      )
      if (trackInPlaylist) return
    }

    const client = this.client
    const response = await WebApiRequest.builder(client.getAccessToken())
      .withPath(`/v1/playlists/${encodeURIComponent(playlistId)}/tracks`)
      .withHeaders({ 'Content-Type': 'application/json' })
      .withBodyParameters({
        uris: [track.uri],
      })
      .build()
      .execute(HttpManager.post)

    return response.body
  }

  @logError
  async removeTrackFromPlaylist(
    track: TrackForMove,
    { id: playlistId }: PlaylistID,
  ) {
    if (dev.drySpotify) {
      console.log('remove track from playlist')
      return Promise.resolve({})
    }

    const client = this.client
    const response = await WebApiRequest.builder(client.getAccessToken())
      .withPath(`/v1/playlists/${encodeURIComponent(playlistId)}/tracks`)
      .withHeaders({ 'Content-Type': 'application/json' })
      .withBodyParameters({
        tracks: [{ uri: track.uri }],
      })
      .build()
      .execute(HttpManager.del)

    return response.body
  }

  async moveCurrentTrack(
    track: TrackForMove,
    from: PlaylistID,
    to: PlaylistID,
  ) {
    const remP = this.removeTrackFromPlaylist(track, from)
    const addP = this.addTrackToPlaylist(track, to)

    await remP
    await addP
  }

  @logError
  async getTrack(id: string) {
    const client = this.client
    const resp = await client.getTrack(id)

    return resp.body
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
