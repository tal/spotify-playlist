import SpotifyWebApi, {
  Playlist,
  PlayBackContext,
  Track,
} from 'spotify-web-api-node'
import * as WebApiRequest from 'spotify-web-api-node/src/webapi-request'
import * as HttpManager from 'spotify-web-api-node/src/http-manager'
import { updateAccessToken } from './db/update'

export interface SpotifyPesonalCreds {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

type TrackForMove = { uri: string; type?: 'track' }
type PlaylistID = { id: string; type?: 'playlist' }

import { getEnv } from './env'

const env = getEnv().then(env => env.spotify)

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
  static async get(u: UserData) {
    const client = await getClient(u)

    return new Spotify(client)
  }

  private constructor(private client: SpotifyWebApi) {}

  private _allPlaylists?: Playlist[]
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

  private _tracks: { [k: string]: Track[] } = {}
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
    { id: trackId }: { id: string },
    playlist: { id?: string; name?: string },
  ) {
    const tracks = await this.tracksForPlaylist(playlist)

    return !!tracks.find(track => track.id === trackId)
  }

  private _player?: Promise<PlayBackContext>
  get player() {
    if (this._player) {
      return this._player
    }

    const player = Promise.resolve(this.client)
      .then(client => client.getMyCurrentPlaybackState())
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

  saveTrack(...ids: string[]) {
    return Promise.resolve(this.client)
      .then(client => client.addToMySavedTracks(ids))
      .then(({ body }) => body)
  }

  unsaveTrack(...ids: string[]) {
    return Promise.resolve(this.client)
      .then(client => client.removeFromMySavedTracks(ids))
      .then(({ body }) => body)
  }

  async trackIsSaved({ id }: { id: string }) {
    const client = this.client
    const response = await client.containsMySavedTracks([id])
    return response.body[0]
  }

  async addTrackToPlaylist(
    track: TrackForMove,
    { id: playlistId }: PlaylistID,
  ) {
    const client = this.client
    const response = await WebApiRequest.builder(client.getAccessToken())
      .withPath(`/v1/playlists/${encodeURIComponent(playlistId)}/track`)
      .withHeaders({ 'Content-Type': 'application/json' })
      .withBodyParameters({
        uris: [track.uri],
      })
      .build()
      .execute(HttpManager.post)

    return response.body
  }

  async removeTrackFromPlaylist(
    track: TrackForMove,
    { id: playlistId }: PlaylistID,
  ) {
    const client = this.client
    const response = await WebApiRequest.builder(client.getAccessToken())
      .withPath(`/v1/playlists/${encodeURIComponent(playlistId)}/track`)
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

  async getTrack(id: string) {
    const client = this.client
    const resp = await client.getTrack(id)

    return resp.body
  }
}
