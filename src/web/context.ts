import { getDynamo } from '../db/dynamo'
import { Spotify } from '../spotify'
import { settings } from '../settings'

export async function koalemosContext() {
  const dynamo = await getDynamo('koalemos')
  if (!dynamo) throw 'cannot find user'
  const client = await Spotify.get(dynamo)
  return { dynamo, client, settings: await settings(), now: Date.now() }
}
