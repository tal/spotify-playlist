/**
 * One-off Spotify re-authorization script.
 *
 * Why this exists: Spotify revoked the refresh token stored in DynamoDB, so the
 * Lambda can no longer refresh its access token — every invocation dies with
 * `invalid_grant / Refresh token revoked`. There is no way to un-revoke a token;
 * you have to run the OAuth Authorization Code flow again to mint a brand new
 * refresh token, then store it where the Lambda reads it.
 *
 * This script does exactly that:
 *   1. Starts a tiny local HTTP server on the redirect URI's host/port.
 *   2. Prints an authorize URL — you open it, log in, approve.
 *   3. Exchanges the returned code for { access_token, refresh_token, expires_in }.
 *   4. Writes those into the PRODUCTION DynamoDB `user` table's spotifyAuth,
 *      preserving the item's other fields.
 *
 * Run it:
 *   bun run src/reauth.ts
 *   # or, via package.json:
 *   bun run reauth
 *
 * Environment (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET load from .env):
 *   SPOTIFY_CLIENT_ID       required
 *   SPOTIFY_CLIENT_SECRET   required
 *   SPOTIFY_REDIRECT_URI    optional, default http://127.0.0.1:8888/callback
 *   SPOTIFY_USER            optional, default koalemos
 *   AWS_REGION              optional, default us-east-1
 *
 * IMPORTANT: SPOTIFY_REDIRECT_URI must be registered EXACTLY in your Spotify app
 * (developer.spotify.com → your app → Settings → Redirect URIs). Spotify requires
 * loopback URIs to use 127.0.0.1 (not localhost) and https for non-loopback.
 */

import http from 'http'
import url from 'url'
import SpotifyWebApi from 'spotify-web-api-node'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'

// Scopes must be a superset of the endpoints used by src/spotify.ts.
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
  'user-read-email',
  'user-top-read',
  'user-library-read',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-recently-played',
  'user-read-currently-playing',
]

function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val) {
    console.error(`❌ Missing required env var: ${key}`)
    process.exit(1)
  }
  return val
}

function mask(token: string): string {
  if (token.length <= 12) return '***'
  return `${token.slice(0, 6)}…${token.slice(-4)} (len ${token.length})`
}

const clientId = requireEnv('SPOTIFY_CLIENT_ID')
const clientSecret = requireEnv('SPOTIFY_CLIENT_SECRET')
// Spotify (2025 policy) rejects `http://localhost` as insecure and requires
// loopback redirect URIs to use the IP literal 127.0.0.1. This must also be
// registered verbatim in the Spotify app dashboard.
const redirectUri =
  process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback'
const userId = process.env.SPOTIFY_USER || 'koalemos'
const region = process.env.AWS_REGION || 'us-east-1'

// Dedicated DynamoDB client pinned to prod — deliberately NOT the shared
// src/aws.ts singleton, so this can never accidentally point at a local
// dev endpoint. This writes to the real table.
const docs = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
})

const parsed = new url.URL(redirectUri)
const port = parsed.port ? parseInt(parsed.port, 10) : 80
const callbackPath = parsed.pathname

async function writeTokens(tokens: {
  accessToken: string
  refreshToken: string
  expiresAt: number
}) {
  // Verify the user item exists first so we UPDATE (preserving other fields)
  // rather than silently creating a half-populated item.
  const existing = await docs.send(
    new GetCommand({ TableName: 'user', Key: { id: userId } }),
  )
  if (!existing.Item) {
    throw new Error(
      `user "${userId}" not found in table "user" (region ${region}). ` +
        `Set SPOTIFY_USER to the correct id.`,
    )
  }

  await docs.send(
    new UpdateCommand({
      TableName: 'user',
      Key: { id: userId },
      UpdateExpression:
        'set spotifyAuth.accessToken = :at, spotifyAuth.refreshToken = :rt, spotifyAuth.expiresAt = :exp',
      ExpressionAttributeValues: {
        ':at': tokens.accessToken,
        ':rt': tokens.refreshToken,
        ':exp': tokens.expiresAt,
      },
    }),
  )
}

async function handleCode(code: string) {
  const api = new SpotifyWebApi({ clientId, clientSecret, redirectUri })
  const data = await api.authorizationCodeGrant(code)

  const accessToken = data.body['access_token'] as string
  const refreshToken = data.body['refresh_token'] as string
  const expiresIn = data.body['expires_in'] as number
  const expiresAt = Date.now() + expiresIn * 1000

  if (!refreshToken) {
    throw new Error(
      'Spotify did not return a refresh_token. Make sure you approved the ' +
        'consent screen fresh (the URL uses show_dialog=true).',
    )
  }

  await writeTokens({ accessToken, refreshToken, expiresAt })

  console.log('')
  console.log('✅ Wrote fresh tokens to DynamoDB:')
  console.log(`   table:        user  (region ${region})`)
  console.log(`   user id:      ${userId}`)
  console.log(`   accessToken:  ${mask(accessToken)}`)
  console.log(`   refreshToken: ${mask(refreshToken)}`)
  console.log(`   expiresAt:    ${new Date(expiresAt).toISOString()}`)
  console.log('')
  console.log('🎉 The Lambda should be able to reach Spotify again on its next run.')
}

const server = http.createServer((req, resp) => {
  const { query, pathname } = url.parse(req.url || '', true)

  if (pathname !== callbackPath) {
    resp.writeHead(404)
    resp.end('not found')
    return
  }

  const code = query.code as string | undefined
  const error = query.error as string | undefined

  if (error) {
    resp.writeHead(400, { 'Content-Type': 'text/html' })
    resp.end(`<h1>Auth failed</h1><p>${error}</p>`)
    console.error(`❌ Spotify returned an error: ${error}`)
    server.close(() => process.exit(1))
    return
  }

  if (!code) {
    resp.writeHead(400, { 'Content-Type': 'text/html' })
    resp.end('<h1>No code present</h1>')
    return
  }

  handleCode(code)
    .then(() => {
      resp.writeHead(200, { 'Content-Type': 'text/html' })
      resp.end(
        '<h1>✅ Re-authorized</h1><p>Tokens written to DynamoDB. You can close this tab.</p>',
      )
      server.close(() => process.exit(0))
    })
    .catch((err) => {
      resp.writeHead(500, { 'Content-Type': 'text/html' })
      resp.end(`<h1>Failed to store tokens</h1><pre>${err}</pre>`)
      console.error('❌ Failed to exchange/store tokens:', err)
      server.close(() => process.exit(1))
    })
})

// Bind without an explicit host so we accept the callback whether the browser
// resolves `localhost` to 127.0.0.1 (IPv4) or ::1 (IPv6).
server.listen(port, () => {
  const api = new SpotifyWebApi({ clientId, clientSecret, redirectUri })
  // show_dialog=true forces a fresh consent screen so Spotify always mints a new
  // refresh token (otherwise a silent re-auth may skip returning one).
  const authorizeUrl =
    api.createAuthorizeURL(SCOPES, 'reauth') + '&show_dialog=true'

  console.log('🔐 Spotify re-authorization')
  console.log(`   listening at ${redirectUri}`)
  console.log(`   target:      user "${userId}" in DynamoDB table "user" (${region})`)
  console.log('')
  console.log('👉 Make sure this redirect URI is registered in your Spotify app:')
  console.log(`   ${redirectUri}`)
  console.log('')
  console.log('👉 Open this URL in your browser, log in, and approve:')
  console.log('')
  console.log(`   ${authorizeUrl}`)
  console.log('')
  console.log('Waiting for the callback…')
})
