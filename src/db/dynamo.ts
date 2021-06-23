import { AWS } from '../aws'
import { DocumentClient } from 'aws-sdk/clients/dynamodb'

export class Dynamo {
  constructor(public readonly user: UserData) {}

  gId(suffix: string) {
    return `${this.user.id}:${suffix}`
  }

  async getActionHistory(id: string, since: number) {
    const docs = await AWS.docs
    const resp = await docs
      .query({
        TableName: 'action_history',
        KeyConditionExpression: 'id = :id AND created_at > :limit',
        ExpressionAttributeValues: {
          ':id': this.gId(id),
          ':limit': since,
        },
        Limit: 1,
      })
      .promise()

    if (resp.Items) {
      return resp.Items[0] as ActionHistoryItemData | undefined
    } else {
      return undefined
    }
  }

  async setTrackRead({ id: trackId }: { id: string }, seen: TrackSeenContext) {
    const id = this.gId(trackId)
    const params: DocumentClient.UpdateItemInput = {
      TableName: 'track',
      Key: {
        id,
      },
      UpdateExpression: `SET first_seen = if_not_exists(first_seen, :seen),
        last_seen = :seen,
        play_count = if_not_exists(play_count, :zero) + :incr`,
      ExpressionAttributeValues: {
        ':seen': seen,
        ':incr': 1,
        ':zero': 0,
      },
      ReturnValues: 'ALL_NEW',
    }

    const docs = await AWS.docs
    const response = await docs.update(params).promise()

    if (response.Attributes) {
      return response.Attributes
    } else {
      throw 'no data returned from update for some reason'
    }
  }

  async getSeenTracks(ids: string[]) {
    const docs = await AWS.docs
    const responses = await Promise.all(
      ids.map(async (id) => {
        const key = this.gId(id)
        const resp = await docs
          .get({
            TableName: 'track',
            Key: { id: key },
          })
          .promise()

        return { id, item: resp.Item }
      }),
    )

    const result: {
      [k: string]:
        | { id: string; found: false }
        | { id: string; found: true; item: DocumentClient.AttributeMap }
    } = {}

    for (let id of ids) {
      result[id] = { id, found: false }
    }

    for (let { id, item } of responses) {
      if (item) {
        result[id] = { id, found: true, item }
      }
    }

    return Object.values(result)
  }

  async updateAccessToken(id: string, token: string, expiresAt: number) {
    var params: DocumentClient.UpdateItemInput = {
      TableName: 'user',
      Key: { id },
      UpdateExpression:
        'set spotifyAuth.accessToken = :at, spotifyAuth.expiresAt = :exp',
      ExpressionAttributeValues: {
        ':at': token,
        ':exp': expiresAt,
      },
      ReturnValues: 'ALL_NEW',
    }

    const docs = await AWS.docs
    const response = await docs.update(params).promise()

    if (response.Attributes) {
      return response.Attributes as UserData
    } else {
      throw 'no data returned from update for some reason'
    }
  }

  async updateLastPlayedAtProcessedTimestamp(id: string, ts: number) {
    var params: DocumentClient.UpdateItemInput = {
      TableName: 'user',
      Key: { id },
      UpdateExpression: 'set lastPlayedAtProcessedTimestamp = :ts',
      ExpressionAttributeValues: {
        ':ts': ts,
      },
      ReturnValues: 'ALL_NEW',
    }

    const docs = await AWS.docs
    const response = await docs.update(params).promise()

    if (response.Attributes) {
      return response.Attributes as UserData
    } else {
      throw 'no data returned from update for some reason'
    }
  }

  async putActionHistory(history: ActionHistoryItemData) {
    const docs = await AWS.docs

    const params = {
      TableName: 'action_history',
      Item: { ...history, id: this.gId(history.id) },
    }

    await docs.put(params).promise()

    return history
  }

  async putUser(user: UserData) {
    var params = {
      TableName: 'user',
      Item: {
        id: user.id,
        spotifyAuth: {
          refreshToken: user.spotifyAuth.refreshToken,
          accessToken: user.spotifyAuth.accessToken,
          expiresAt: user.spotifyAuth.expiresAt,
        },
      },
    }
    const docs = await AWS.docs
    await docs.put(params).promise()

    return user
  }
}

async function getUser(userName: string) {
  const docs = await AWS.docs
  const resp = await docs
    .get({ TableName: 'user', Key: { id: userName } })
    .promise()

  return resp.Item as UserData | undefined
}

export async function getDynamo(userName?: string) {
  if (!userName) return

  const user = await getUser(userName)

  if (!user) return

  return new Dynamo(user)
}
