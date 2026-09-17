require('./-run-this-first')
import { normalizeActionError } from './action-error'
export { normalizeActionError } from './action-error'
export type { NormalizedActionError } from './action-error'
import { gatherCurrent, listenStatsPlan } from './web/current'
import { Spotify } from './spotify'
import type { APIGatewayProxyHandler, APIGatewayProxyEvent } from 'aws-lambda'
import { MagicPromoteAction } from './actions/magic-promote-action'
import { performActions, Action } from './actions/action'
import {
  AfterTrackActionAction,
  currentTrackIdentity,
} from './actions/track-action'
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
import { settings } from './settings'

function notEmpty<TValue>(
  value: TValue | null | undefined | void,
): value is TValue {
  return value !== null && value !== undefined
}

export function afterCurrentTrack(ev: APIGatewayProxyEvent) {
  const shouldSkip =
    ev.queryStringParameters && ev.queryStringParameters['and-skip']

  const afterCurrentTrack: AfterTrackActionAction = shouldSkip
    ? 'skip-track'
    : 'nothing'

  return afterCurrentTrack
}

export function doAfterCurrentTrack(client: Spotify, ev: APIGatewayProxyEvent) {
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

export const handler: APIGatewayProxyHandler = async (ev, ctx) => {
  // Lambda Function URLs use rawPath, API Gateway uses path
  const requestPath = (ev as any).rawPath || ev.path

  // Try to extract action name from the request
  let actionName: string | null = actionNameFromEvent(ev)

  if (!actionName) {
    return {
      statusCode: 404,
      body: JSON.stringify({
        error: 'no action name given',
        request: {
          pathParameters: ev.pathParameters,
          queryStringParameters: ev.queryStringParameters,
          path: requestPath,
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
        // Playback history runs first so anything downstream that reads listen
        // counts sees this run's plays rather than the previous run's.
        new ProcessPlaybackHistoryAction(spotify, dynamo.user),
        new ArchiveAction(spotify),
        new ProcessManualTriage(spotify),
        new ScanPlaylistsForInbox(spotify),
        new RulePlaylistAction(spotify, { rule: 'smart' }),
      ]
      break
    case 'user': {
      // This endpoint is reachable unauthenticated over the Function URL, so
      // the OAuth tokens must never go out in the response. The fields are
      // listed explicitly rather than spread-and-overridden so a new secret
      // added to UserSpotifyAuthData fails to compile instead of leaking.
      // `expiresAt` stays: it is what you actually want when debugging a
      // refresh, and it is not a credential.
      const { spotifyAuth, ...rest } = dynamo.user
      const redacted = `[redacted for ${dynamo.user.id}]`

      return {
        statusCode: 200,
        body: JSON.stringify({
          user: {
            ...rest,
            spotifyAuth: {
              accessToken: redacted,
              refreshToken: redacted,
              expiresAt: spotifyAuth.expiresAt,
            },
          },
        }),
      }
    }
    case 'archive':
      const archive = new ArchiveAction(spotify)
      actions = archive
      break
    // The track is resolved here, before any of these actions is built, so the
    // id each one throttles on is fixed data rather than another player read —
    // and so a leading skip cannot change what gets promoted or demoted.
    case 'promotes':
      actions = [
        new SkipToNextTrack(spotify),
        new MagicPromoteAction(spotify, await currentTrackIdentity(spotify)),
      ]
      break
    case 'promote':
      actions = [
        doAfterCurrentTrack(spotify, ev),
        new MagicPromoteAction(spotify, await currentTrackIdentity(spotify)),
      ]
      break
    case 'demotes':
      actions = [
        new SkipToNextTrack(spotify),
        new DemoteAction(spotify, await currentTrackIdentity(spotify)),
      ]
      break
    case 'demote':
      actions = [
        doAfterCurrentTrack(spotify, ev),
        new DemoteAction(spotify, await currentTrackIdentity(spotify)),
      ]
      break
    case 'undo':
      const actionId = ev.queryStringParameters?.['action-id']
      const actionType = ev.queryStringParameters?.['action-type'] as
        'promote' | 'demote' | undefined
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
          sampleTracks: cachedSongs.map((s) => ({
            name: s.trackName,
            artist: s.artistName,
            addedAt: new Date(s.addedAt).toISOString(),
          })),
          cacheAge: metadata
            ? `${Math.floor((Date.now() - metadata.lastSyncedAt) / 1000 / 60)} minutes`
            : 'N/A',
        }),
      }
    case 'listen-stats': {
      const snapshot = await gatherCurrent({
        client: spotify,
        dynamo,
        settings: await settings(),
        now: Date.now(),
      })
      return {
        statusCode: 200,
        body: JSON.stringify(listenStatsPlan(snapshot), null, 2),
      }
    }
    case 'backfill-promotes': {
      // One-time seed of the promotes feed from action_history for promotes made
      // before the forward-only recentPromotesV1 list shipped. Deliberate and
      // idempotent — the feed itself never Scans. Optional overrides:
      // ?target=<n> (how many to collect) and ?page-limit=<n> (rows examined
      // per lazy page).
      const target = Number(ev.queryStringParameters?.['target']) || undefined
      const pageLimit =
        Number(ev.queryStringParameters?.['page-limit']) || undefined
      const result = await dynamo.backfillRecentPromotes({ target, pageLimit })
      return {
        statusCode: 200,
        body: JSON.stringify(result, null, 2),
      }
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
    // Handle errors properly with descriptive messages
    console.error('Error performing action:', err)

    const { statusCode, errorMessage } = normalizeActionError(err)

    return {
      statusCode,
      body: JSON.stringify({
        error: errorMessage,
        action: actionName,
      }),
    }
  }
}

export function actionNameFromEvent(ev: APIGatewayProxyEvent) {
  let actionName: string | null = null

  // API Gateway with path parameters
  if (ev.pathParameters && ev.pathParameters['action']) {
    actionName = ev.pathParameters['action']
  }
  // Query string parameters (works for both API Gateway and Lambda Function URLs)
  else if (ev.queryStringParameters && ev.queryStringParameters['action']) {
    actionName = ev.queryStringParameters['action']
  }
  // Lambda Function URL: extract action from path (e.g., /promote -> promote)
  else {
    const path = (ev as any).rawPath || ev.path
    // Paths with dots (e.g. /favicon.ico) are never action names
    if (path && path !== '/' && !path.includes('.')) {
      // Remove leading slash and use as action name
      actionName = path.substring(1)
    }
  }

  return actionName
}
