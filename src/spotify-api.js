import SpotifyWebAPI from 'spotify-web-api-node'

import { getCallbackURL } from './spotify-auth'
import { getKey, setKeySync } from './db'
import CONFIG from '../config.json'

let spotifyApi = new SpotifyWebAPI({
  ...CONFIG.api,
})

export default spotifyApi

async function getExpiresAt() {
  const ts = await getKey('api.expiresAt')

  if (ts) {
    return new Date(ts)
  }
}

async function apiIsExpired() {
  const now = new Date().getTime()
  const expiresAt = await getExpiresAt()

  return now > expiresAt
}

export async function getAPI({shouldRefresh = false} = {}) {
  if (shouldRefresh || await apiIsExpired) {
    await refresh()
  }

  const api = await getKey('api')

  spotifyApi = new SpotifyWebAPI(api)

  return spotifyApi
}

const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'streaming',
  'user-follow-modify',
  'user-follow-read',
  'user-library-modify',
  'user-read-private',
  'user-read-birthdate',
  'user-read-email',
  'user-top-read',
  'user-library-read',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-recently-played',
  'user-read-currently-playing',
]

export function getAuthUrl() {
  const url = getCallbackURL()

  spotifyApi.setRedirectURI(url)
  return spotifyApi.createAuthorizeURL(SCOPES, 'my-state');
}

export async function refresh() {
  const data = await spotifyApi.refreshAccessToken()

  spotifyApi.setAccessToken(data.body['access_token'])

  setKeySync('api.accessToken', data.body['access_token'])
}
