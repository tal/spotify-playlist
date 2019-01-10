declare module 'spotify-web-api-node' {
  type SpotifyResponse<Body> = {
    statusCode: number
    headers: {}
    body: Body
  }

  type ExternalUrls = { [k: string]: string }

  interface User extends Entity {
    id: string
    display_name: string
    email?: string
    uri: string
    type: 'user'
  }

  interface Entity {
    type: string
    uri: string
    id: string
    href: string
  }

  interface Token {
    access_token: string
    expires_in: number
    scope: string
    token_type: string
  }

  export interface Playlist extends Entity {
    collaborative: boolean
    external_urls: ExternalUrls
    name: string
    images: { url: string }[]
    owner: User
    public: boolean
    snapshot_id: string
    type: 'playlist'
  }

  type PagingObject<T> = {
    /**
     * The requested data.
     */
    items: T[]
    /**
     * A link to the Web API endpoint returning the full result of the request.
     */
    href: string
    /**
     * URL to the next page of items. ( null if none)
     */
    next?: string
    /**
     * The maximum number of items in the response, max 50 (as set in the query or by default).
     */
    limit: number
    /**
     * The offset of the items returned (as set in the query or by default).
     */
    offset: number
    /**
     * URL to the previous page of items. ( null if none)
     */
    previous?: string
    /**
     * The total number of items available to return.
     */
    total: number
  }

  export interface Device {
    id: string
    is_active: boolean
    is_restricted: boolean
    name: string
    type: string
    volume_percent: number
  }

  interface Image {
    url: string
    height: number
    width: number
  }

  export interface Album extends Entity {
    album_type: 'album'
    artists: Artist[]
    available_markets: string[]
    external_urls: ExternalUrls
    images: Image[]
    name: string
    release_date: string
    release_date_precision: string
    total_tracks: number
    type: 'album'
  }

  export interface Artist extends Entity {
    external_urls: ExternalUrls
    name: string
    type: 'artist'
  }

  export interface Track extends Entity {
    album: Album
    artists: Artist[]
    disc_number: number
    explicit: boolean
    duration_ms: number
    external_urls: ExternalUrls
    external_ids: { [k: string]: string }
    is_local: boolean
    name: string
    popularity: number
    preview_url: string
    track_number: string
    type: 'track'
  }

  export interface SavedTrack {
    added_at: string
    track: Track
  }

  export interface PlayBackContext {
    timestamp: number
    device: Device
    progress_ms?: number
    is_playing: boolean
    currently_playing_type: 'track' | 'ad' | 'episode' | 'unknown'
    item?: Track
    shuffle_state: boolean
    repeat_state: 'off' | 'context' | 'track'
    context?: Context
  }

  export interface Context {
    external_urls: ExternalUrls
    uri: string
    href: string
    type: 'playlist' | 'artist' | 'album'
  }

  export interface PlaylistTrack {
    added_at: string
    is_local: boolean
    primary_color?: string
    added_by: User
    track: Track
  }

  type PlaylistsListResponse = PagingObject<Playlist>
  type PlaylistTrackListResponse = PagingObject<PlaylistTrack>
  type SavedTracksListResponse = PagingObject<SavedTrack>

  interface SpotifyWebApiConfig {
    accessToken?: string
    refreshToken?: string
    redirectUri?: string
    clientId?: string
    clientSecret?: string
  }

  export default class SpotifyWebApi {
    constructor(params?: SpotifyWebApiConfig)

    getAccessToken(): string

    /**
     * Get information about the user that has signed in (the current user).
     * @param {requestCallback} [callback] Optional callback method to be called instead of the promise.
     * @example getMe().then(...)
     * @returns {Promise|undefined} A promise that if successful, resolves to an object
     *          containing information about the user. The amount of information
     *          depends on the permissions given by the user. If the promise is
     *          rejected, it contains an error object. Not returned if a callback is given.
     */
    getMe(): Promise<SpotifyResponse<User>>

    /**
     * Get a user's playlists.
     * @param {string} userId An optional id of the user. If you know the Spotify URI it is easy
     * to find the id (e.g. spotify:user:<here_is_the_id>). If not provided, the id of the user that granted
     * the permissions will be used.
     * @param {Object} [options] The options supplied to this request.
     * @param {requestCallback} [callback] Optional callback method to be called instead of the promise.
     * @example getUserPlaylists('thelinmichael').then(...)
     * @returns {Promise|undefined} A promise that if successful, resolves to an object containing
     *          a list of playlists. If rejected, it contains an error object. Not returned if a callback is given.
     */
    getUserPlaylists(options?: {
      limit?: number
      offset?: number
      user_id?: string
    }): Promise<SpotifyResponse<PlaylistsListResponse>>
    getUserPlaylists(
      userId: string,
      options?: {
        limit?: number
        offset?: number
      },
    ): Promise<SpotifyResponse<PlaylistsListResponse>>

    /**
     * Refresh the access token given that it hasn't expired.
     * Requires that client ID, client secret and refresh token has been set previous to the call.
     * @param {requestCallback} [callback] Optional callback method to be called instead of the promise.
     * @returns {Promise|undefined} A promise that if successful, resolves to an object containing the
     *          access token, time to expiration and token type. If rejected, it contains an error object.
     *          Not returned if a callback is given.
     */
    refreshAccessToken(): Promise<SpotifyResponse<Token>>
    refreshAccessToken(
      cb: (err: any, data: SpotifyResponse<Token>) => undefined,
    ): undefined

    /**
     * Get the Current User's Current Playback State
     * @param {Object} [options] Options, being market.
     * @param {requestCallback} [callback] Optional callback method to be called instead of the promise.
     * @returns {Promise|undefined} A promise that if successful, resolves into a paging object of tracks,
     *          otherwise an error. Not returned if a callback is given.
     */
    getMyCurrentPlaybackState(): Promise<SpotifyResponse<PlayBackContext>>

    /**
     * Add a track from the authenticated user's Your Music library.
     * @param {string[]} trackIds The track IDs
     * @param {requestCallback} [callback] Optional callback method to be called instead of the promise.
     * @returns {Promise|undefined} A promise that if successful returns null, otherwise an error. Not returned if a callback is given.
     */
    addToMySavedTracks(trackIds: string[]): Promise<SpotifyResponse<{}>>

    /**
     * Remove a track from the authenticated user's Your Music library.
     * @param {string[]} trackIds The track IDs
     * @param {requestCallback} [callback] Optional callback method to be called instead of the promise.
     * @returns {Promise|undefined} A promise that if successful returns null, otherwise an error.
     * Not returned if a callback is given.
     */
    removeFromMySavedTracks(trackIds: string[]): Promise<SpotifyResponse<{}>>

    /**
     * Check if one or more tracks is already saved in the current Spotify user’s “Your Music” library.
     * @param {string[]} trackIds The track IDs
     * @param {requestCallback} [callback] Optional callback method to be called instead of the promise.
     * @returns {Promise|undefined} A promise that if successful, resolves into an array of booleans. The order
     * of the returned array's elements correspond to the track ID in the request.
     * The boolean value of true indicates that the track is part of the user's library, otherwise false.
     * Not returned if a callback is given.
     */
    containsMySavedTracks(
      trackIds: string[],
    ): Promise<SpotifyResponse<[boolean]>>

    /**
     * Add tracks to a playlist.
     * @param {string} userId The playlist's owner's user ID
     * @param {string} playlistId The playlist's ID
     * @param {string[]} tracks URIs of the tracks to add to the playlist.
     * @param {Object} [options] Options, position being the only one.
     * @param {requestCallback} [callback] Optional callback method to be called instead of the promise.
     * @example addTracksToPlaylist('thelinmichael', '3EsfV6XzCHU8SPNdbnFogK',
              '["spotify:track:4iV5W9uYEdYUVa79Axb7Rh", "spotify:track:1301WleyT98MSxVHPZCA6M"]').then(...)
     * @returns {Promise|undefined} A promise that if successful returns an object containing a snapshot_id. If rejected,
     * it contains an error object. Not returned if a callback is given.
     */
    addTracksToPlaylist(
      userId: string,
      playlistId: string,
      tracks: string[],
      options?: { position: number },
    ): Promise<SpotifyResponse<{}>>

    /**
     * Get tracks in a playlist.
     * @param {string} playlistId The playlist's ID.
     * @param {Object} [options] Optional options, such as fields.
     * @param {requestCallback} [callback] Optional callback method to be called instead of the promise.
     * @example getPlaylistTracks('thelinmichael', '3ktAYNcRHpazJ9qecm3ptn').then(...)
     * @returns {Promise|undefined} A promise that if successful, resolves to an object that containing
     * the tracks in the playlist. If rejected, it contains an error object. Not returned if a callback is given.
     */
    getPlaylistTracks(
      playlistId: string,
      options?: {
        limit?: number
        offset?: number
        fields?: string
        market?: string
      },
    ): Promise<SpotifyResponse<PlaylistTrackListResponse>>

    /**
     * Look up a track.
     * @param {string} trackId The track's ID.
     * @param {Object} [options] The possible options, currently only market.
     * @param {requestCallback} [callback] Optional callback method to be called instead of the promise.
     * @example getTrack('3Qm86XLflmIXVm1wcwkgDK').then(...)
     * @returns {Promise|undefined} A promise that if successful, returns an object containing information
     *          about the track. Not returned if a callback is given.
     */
    getTrack(trackId: string): Promise<SpotifyResponse<Track>>

    /**
     * Create a playlist.
     * @param {string} userId The playlist's owner's user ID.
     * @param {string} playlistName The name of the playlist.
     * @param {Object} [options] The possible options, currently only public.
     * @param {requestCallback} [callback] Optional callback method to be called instead of the promise.
     * @example createPlaylist('thelinmichael', 'My cool playlist!', { public : false }).then(...)
     * @returns {Promise|undefined} A promise that if successful, resolves to an object containing information about the
     *          created playlist. If rejected, it contains an error object. Not returned if a callback is given.
     */
    createPlaylist(
      userId: string,
      playlist: string,
      options?: { description?: string; public?: boolean },
    ): Promise<SpotifyResponse<Playlist>>

    /**
     * Retrieve the tracks that are saved to the authenticated users Your Music library.
     * @param {Object} [options] Options, being market, limit, and/or offset.
     * @param {requestCallback} [callback] Optional callback method to be called instead of the promise.
     * @returns {Promise|undefined} A promise that if successful, resolves to an object containing a paging object which in turn contains
     *          playlist track objects. Not returned if a callback is given.
     */
    getMySavedTracks(options: {
      limit?: number
      offset?: number
    }): Promise<SpotifyResponse<SavedTracksListResponse>>
  }
}

declare module 'spotify-web-api-node/src/webapi-request'
declare module 'spotify-web-api-node/src/http-manager'
