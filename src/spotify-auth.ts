import detect from 'detect-port'
import http from 'http'
import url from 'url'

import spotifyApi, { getAuthUrl } from './spotify-api'
import { setKeySync } from './db'

const CALLBACK_PATH = '/auth/spotify/callback'
const START_PATH = '/auth/spotify'

async function handleCallback({ code }: { code: string }) {
  const data = await spotifyApi.authorizationCodeGrant(code)

  const expiresAt: number =
    new Date().getTime() + data.body['expires_in'] * 1000

  setKeySync('api.expiresAt', expiresAt)

  console.log('The token expires in ' + data.body['expires_in'])
  console.log('The token expires at ' + new Date(expiresAt))
  console.log('The access token is  ' + data.body['access_token'])
  console.log('The refresh token is ' + data.body['refresh_token'])

  setKeySync('api.accessToken', data.body['access_token'])
  setKeySync('api.refreshToken', data.body['refresh_token'])

  close()
}

function handleRequest(req: any, resp: any) {
  const { query, pathname } = url.parse(req.url, true)
  const code = query.code as string | undefined

  if (!code) {
    throw 'no code present in response'
  }

  let respText = ''

  switch (pathname) {
    case CALLBACK_PATH:
      respText = `Query: ${JSON.stringify(query)}`
      handleCallback({ code }).catch((err) => {
        console.error(`Callback error: `, err)
      })
      break
    case START_PATH:
    case '/':
    case '':
      respText = `<a href=${getAuthUrl()}>Go along and auth</a>`
      break
    default:
      resp.writeHead(404)
      respText = 'not found'
  }

  // resp.writeHead(200, { 'Content-Type': 'text/plain'});
  // response.setHeader('Content-Type', 'text/html');
  resp.end(respText)
}

let currentServer: http.Server | null
let port: number | null

export async function createServer() {
  if (!currentServer) {
    currentServer = http.createServer(handleRequest)
    port = await detect(3050)
    currentServer.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`)
    })
  }
}

export function close() {
  if (currentServer) {
    currentServer.close(() => {
      currentServer = null
      port = null
    })
  }
}

export function getPort() {
  return port
}

export function getCallbackURL() {
  if (port) {
    return `http://localhost:${port}${CALLBACK_PATH}`
  } else {
    return null
  }
}
