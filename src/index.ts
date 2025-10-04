require('./-run-this-first')
import { Spotify } from './spotify'
import { APIGatewayProxyHandler, APIGatewayProxyEvent } from 'aws-lambda'
import { MagicPromoteAction } from './actions/magic-promote-action'
import { performActions, Action } from './actions/action'
import { AfterTrackActionAction } from './actions/track-action'
import { ArchiveAction } from './actions/archive-action'
import { DemoteAction } from './actions/demote-action'
import { actionForPlaylist } from './actions/action-for-playlist'
import { getDynamo } from './db/dynamo'
import { ProcessPlaybackHistoryAction } from './actions/process-playback-history-action'
import { ScanPlaylistsForInbox } from './actions/scan-playlists-for-inbox'
import { ProcessManualTriage } from './actions/process-manual-triage'
import { SkipToNextTrack } from './actions/skip-to-next-track'
import { RulePlaylistAction } from './actions/rule-playlist'
import { UndoAction } from './actions/undo-action'
import { webApiHandler } from './web-api'
import * as fs from 'fs'
import * as path from 'path'

function notEmpty<TValue>(
  value: TValue | null | undefined | void,
): value is TValue {
  return value !== null && value !== undefined
}

function afterCurrentTrack(ev: APIGatewayProxyEvent) {
  const shouldSkip =
    ev.queryStringParameters && ev.queryStringParameters['and-skip']

  const afterCurrentTrack: AfterTrackActionAction = shouldSkip
    ? 'skip-track'
    : 'nothing'

  return afterCurrentTrack
}

function doAfterCurrentTrack(client: Spotify, ev: APIGatewayProxyEvent) {
  const foo = afterCurrentTrack(ev)

  switch (foo) {
    case 'nothing':
      return null
    case 'skip-track':
      return new SkipToNextTrack(client)
  }
}

export const instant: APIGatewayProxyHandler = async (ev) => {
  const { queryStringParameters, pathParameters, path } = ev

  throw 'omg'
  return {
    statusCode: 200,
    body: JSON.stringify({
      isDev: dev.isDev,
      queryStringParameters,
      path,
      pathParameters,
    }),
  }
}

// Helper to serve static files
const serveStaticFile = async (filePath: string): Promise<any> => {
  const webRoot = path.join(__dirname, '../web/dist')
  const fullPath = path.join(webRoot, filePath)
  
  // Security: prevent directory traversal
  if (!fullPath.startsWith(webRoot)) {
    return {
      statusCode: 403,
      body: 'Forbidden',
    }
  }
  
  try {
    const content = fs.readFileSync(fullPath)
    const ext = path.extname(filePath).toLowerCase()
    
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    }
    
    const contentType = mimeTypes[ext] || 'application/octet-stream'
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
      },
      body: content.toString('base64'),
      isBase64Encoded: true,
    }
  } catch (err) {
    return {
      statusCode: 404,
      body: 'Not Found',
    }
  }
}

export const handler: APIGatewayProxyHandler = async (ev, ctx) => {
  const { path: requestPath, httpMethod } = ev
  
  // Handle API routes
  if (requestPath && requestPath.startsWith('/api/')) {
    return webApiHandler(ev, ctx, () => {})
  }
  
  // Handle static file serving for web UI
  if (requestPath && (requestPath === '/' || requestPath.startsWith('/assets/') || requestPath.match(/\.(js|css|html|ico|png|jpg|jpeg|gif|svg)$/))) {
    const filePath = requestPath === '/' ? 'index.html' : requestPath.slice(1)
    return serveStaticFile(filePath)
  }
  
  // For all other routes, serve index.html (for React Router)
  if (requestPath && !requestPath.includes('.')) {
    return serveStaticFile('index.html')
  }
  
  let actionName: string | null = actionNameFromEvent(ev)

  if (!actionName) {
    return {
      statusCode: 404,
      body: JSON.stringify({
        error: 'no action name given',
        request: {
          pathParameters: ev.pathParameters,
          queryStringParameters: ev.queryStringParameters,
        },
      }),
    }
  }

  if (actionName === 'instant') {
    return (instant as any)(ev, ctx)
  }

  const dynamo = await getDynamo('koalemos')

  if (!dynamo) throw 'cannot find user'

  const spotify = await Spotify.get(dynamo)

  let actions: Action | (Action | null)[]
  switch (actionName) {
    case 'rule-playlist':
      actions = [new RulePlaylistAction(spotify, { rule: 'smart' })]
      break
    case 'frequent-crawling':
      actions = [
        new ArchiveAction(spotify),
        new ProcessPlaybackHistoryAction(spotify, dynamo.user),
        new ProcessManualTriage(spotify),
        new ScanPlaylistsForInbox(spotify),
        new RulePlaylistAction(spotify, { rule: 'smart' }),
      ]
      break
    case 'user':
      return {
        statusCode: 200,
        body: JSON.stringify({ user: dynamo.user }),
      }
    case 'archive':
      const archive = new ArchiveAction(spotify)
      actions = archive
      break
    case 'promotes':
      actions = [new SkipToNextTrack(spotify), new MagicPromoteAction(spotify)]
      break
    case 'promote':
      actions = [
        doAfterCurrentTrack(spotify, ev),
        new MagicPromoteAction(spotify),
      ]
      break
    case 'demotes':
      actions = [new SkipToNextTrack(spotify), new DemoteAction(spotify)]
      break
    case 'demote':
      actions = [doAfterCurrentTrack(spotify, ev), new DemoteAction(spotify)]
      break
    case 'undo':
      const actionId = ev.queryStringParameters?.['action-id']
      const actionType = ev.queryStringParameters?.['action-type'] as 'promote' | 'demote' | undefined
      actions = new UndoAction(spotify, dynamo, { actionId, actionType })
      break
    case 'undo-last':
      actions = new UndoAction(spotify, dynamo)
      break
    case 'handle-playlist':
      const playlistName = ev.queryStringParameters?.['playlist-name']

      if (!playlistName) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: 'must provide playlist-name',
          }),
        }
      }

      const playlist = await spotify.playlist(playlistName)

      const foo = actionForPlaylist(playlist, spotify)
      if (!foo) {
        throw `no action for playlist ${playlistName}`
      }
      actions = foo
      break
    case 'handle-known-playlists':
      const playlistNames = [
        'Modern Funk? [A]',
        'Neo Tribal [A]',
        'Scandanavian Women [A]',
        'California Girls [A]',
      ] as const

      actions = await Promise.all(
        playlistNames.map(async (playlistName) => {
          const playlist = await spotify.playlist(playlistName)

          const foo = actionForPlaylist(playlist, spotify)
          if (!foo) {
            throw `no action for playlist ${playlistName}`
          }
          return foo
        }),
      )
      break
    case 'handle-playlists':
      const playlists = await spotify.allPlaylists()
      actions = playlists
        .map((playlist) => actionForPlaylist(playlist, spotify))
        .filter(notEmpty)

      break
    case 'playback':
      actions = [
        new ProcessPlaybackHistoryAction(spotify, dynamo.user),
        new ProcessManualTriage(spotify),
      ]

      break
    case 'auto-inbox':
      actions = [
        new ProcessPlaybackHistoryAction(spotify, dynamo.user),
        new ScanPlaylistsForInbox(spotify),
      ]
      break
    case 'sync-liked-songs':
      // Sync liked songs to cache
      const syncResult = await spotify.syncLikedSongs({ forceRefresh: true })
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Liked songs synced successfully',
          result: syncResult,
        }),
      }
    case 'liked-songs-stats':
      // Get cache statistics
      const metadata = await dynamo.getLikedSongsMetadata(dynamo.user.id)
      const cachedSongs = await dynamo.getLikedSongs(dynamo.user.id, 10) // Get first 10 as sample
      return {
        statusCode: 200,
        body: JSON.stringify({
          metadata: metadata || { message: 'No cache found' },
          sampleTracks: cachedSongs.map(s => ({
            name: s.trackName,
            artist: s.artistName,
            addedAt: new Date(s.addedAt).toISOString(),
          })),
          cacheAge: metadata ? `${Math.floor((Date.now() - metadata.lastSyncedAt) / 1000 / 60)} minutes` : 'N/A',
        }),
      }
    case 'clear-liked-cache':
      // Clear the cache for current user
      await spotify.clearLikedSongsCache()
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Liked songs cache cleared successfully',
        }),
      }
    default:
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: `no action for ${actionName}`,
        }),
      }
  }

  try {
    const result = await performActions(dynamo, spotify, actions)
    return {
      statusCode: 200,
      body: JSON.stringify({ result }),
    }
  } catch (err) {
    if (!err) {
      err = 'unknown error'
    }
    return {
      statusCode: 500,
      error: JSON.stringify(err),
    }
  }
}

function actionNameFromEvent(ev: APIGatewayProxyEvent) {
  let actionName: string | null = null
  if (ev.pathParameters && ev.pathParameters['action']) {
    actionName = ev.pathParameters['action']
  } else if (ev.queryStringParameters && ev.queryStringParameters['action']) {
    actionName = ev.queryStringParameters['action']
  }
  return actionName
}
