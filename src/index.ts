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

export const handler: APIGatewayProxyHandler = async (ev, ctx) => {
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
