require('./-run-this-first')
import { Spotify } from './spotify'
import { document } from './db/document'
import { ensuareAllTablesCreated } from './db/table-definition'
import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda'
import { MagicPromoteAction } from './actions/magic-promote-action'
import { performAction, Action } from './actions/action'
import { AfterTrackActionAction } from './actions/track-action'
import { ArchiveAction } from './actions/archive-action'

export const setupTables: APIGatewayProxyHandler = async () => {
  await ensuareAllTablesCreated()

  return {
    statusCode: 200,
    body: JSON.stringify({}),
  }
}

async function handleAction(action: Action): Promise<APIGatewayProxyResult> {
  const result = await performAction(action)

  return {
    statusCode: 200,
    body: JSON.stringify({ result }),
  }
}

export const archive: APIGatewayProxyHandler = async () => {
  const u = await document<UserData>('user', { id: 'koalemos' })
  const spotify = await Spotify.get(u)
  const archive = new ArchiveAction(spotify)
  return handleAction(archive)
}

export const promote: APIGatewayProxyHandler = async ev => {
  const u = await document<UserData>('user', { id: 'koalemos' })

  const shouldSkip =
    ev.queryStringParameters && ev.queryStringParameters['and-skip']

  const afterCurrentTrack: AfterTrackActionAction = shouldSkip
    ? 'skip-track'
    : 'nothing'

  const spotify = await Spotify.get(u)
  const promote = new MagicPromoteAction(spotify, {
    afterCurrentTrack,
  })

  return handleAction(promote)
}
