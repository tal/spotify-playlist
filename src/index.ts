require('./-run-this-first')
import { Spotify } from './spotify'
import { document } from './db/document'
import { APIGatewayProxyHandler, APIGatewayProxyEvent } from 'aws-lambda'
import { MagicPromoteAction } from './actions/magic-promote-action'
import { performActions, Action } from './actions/action'
import { AfterTrackActionAction } from './actions/track-action'
import { ArchiveAction } from './actions/archive-action'
import { DemoteAction } from './actions/demote-action'
import { actionForPlaylist } from './actions/action-for-playlist'

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
      break
    case 'skip-track':
      client.skipToNextTrack()
      break
  }
}

export const instant: APIGatewayProxyHandler = async ev => {
  const { queryStringParameters, pathParameters, path } = ev

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
  let actionName: string
  if (ev.pathParameters && ev.pathParameters['action']) {
    actionName = ev.pathParameters['action']
  } else if (ev.queryStringParameters && ev.queryStringParameters['action']) {
    actionName = ev.queryStringParameters['action']
  } else {
    return {
      statusCode: 404,
      body: JSON.stringify({
        error: 'no action name given',
      }),
    }
  }

  if (actionName === 'instant') {
    return (instant as any)(ev, ctx)
  }

  const u = await document<UserData>('user', { id: 'koalemos' })
  const spotify = await Spotify.get(u)

  let action: Action | Action[]
  switch (actionName) {
    case 'user':
      return {
        statusCode: 200,
        body: JSON.stringify({ user: u }),
      }
    case 'archive':
      const archive = new ArchiveAction(spotify)
      action = archive
      break
    case 'promote':
      doAfterCurrentTrack(spotify, ev)
      action = new MagicPromoteAction(spotify)
      break
    case 'demote':
      doAfterCurrentTrack(spotify, ev)
      action = new DemoteAction(spotify)
      break
    case 'handle-playlist':
      const playlistName =
        ev.queryStringParameters && ev.queryStringParameters['playlist-name']

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
      action = foo
      break
    case 'handle-playlists':
      const playlists = await spotify.allPlaylists()
      action = playlists
        .map(playlist => actionForPlaylist(playlist, spotify))
        .filter(notEmpty)

      break
    default:
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'no action name given',
        }),
      }
  }

  const result = await performActions(action)

  return {
    statusCode: 200,
    body: JSON.stringify({ result }),
  }
}
