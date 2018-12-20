import { Spotify } from './spotify'
import { document } from './db/document'
import { ensuareAllTablesCreated } from './db/table-definition'
import { APIGatewayProxyHandler } from 'aws-lambda'

export async function settings() {
  return {
    inbox: 'Inbox',
    current: 'Current',
  }
}

export const promote: APIGatewayProxyHandler = async (ev, ctx) => {
  const u = await document('user', { id: 'koalemos' })

  if (u) {
    const spotify = await Spotify.get(u)
    const playlists = await spotify.allPlaylists()

    return {
      statusCode: 200,
      body: JSON.stringify({
        o: 'o',
        p: playlists[0],
        qs: ev.queryStringParameters,
        body: ev.body,
      }),
    }
  }

  return {
    statusCode: 500,
    body: JSON.stringify({
      hi: 'yo',
      qs: ev.queryStringParameters,
      body: ev.body,
    }),
  }
}
