import { chunk } from 'lodash'
import { DocumentClient } from 'aws-sdk/clients/dynamodb'
import { AWS } from '../aws'

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

  async addTrackTriageAction(
    { id: trackId }: { id: string },
    action: TrackTriageAction,
  ) {
    const id = this.gId(trackId)

    const params: DocumentClient.UpdateItemInput = {
      TableName: 'track',
      Key: {
        id,
      },
      UpdateExpression:
        'SET #triage_actions = list_append(if_not_exists(#triage_actions, :empty_list), :location)',
      ExpressionAttributeNames: {
        '#triage_actions': 'triage_actions',
      },
      ExpressionAttributeValues: {
        ':location': [action],
        ':empty_list': [],
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

  async updateTrack(
    { id: trackId }: { id: string },
    { seen, increment_by, triageActions }: UpdateTrackParams,
  ) {
    const id = this.gId(trackId)

    const ExpressionAttributeValues: DocumentClient.UpdateItemInput['ExpressionAttributeValues'] =
      {}

    const expressionParts = []

    if (typeof increment_by === 'number' && increment_by > 0) {
      expressionParts.push(
        `play_count = if_not_exists(play_count, :zero) + :incr`,
      )
      ExpressionAttributeValues[':zero'] = 0
      ExpressionAttributeValues[':incr'] = increment_by
    }

    if (seen) {
      expressionParts.push(`first_seen = if_not_exists(first_seen, :seen)`)
      ExpressionAttributeValues[':seen'] = seen
      if (seen.exactness === 'played') {
        expressionParts.push(`last_seen = :seen`)
      }
    }

    if (triageActions) {
      expressionParts.push(
        'triage_actions = list_append(if_not_exists(triage_actions, :empty_list), :app_actions)',
      )
      ExpressionAttributeValues[':empty_list'] = []
      ExpressionAttributeValues[':app_actions'] = triageActions
    }

    const params: DocumentClient.UpdateItemInput = {
      TableName: 'track',
      Key: {
        id,
      },
      UpdateExpression: 'SET ' + expressionParts.join(', '),
      ExpressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    }

    if (expressionParts.length === 0) {
      throw `Must have at least one action given`
    }

    const docs = await AWS.docs
    const response = await docs.update(params).promise()

    if (response.Attributes) {
      return response.Attributes
    } else {
      throw 'no data returned from update for some reason'
    }
  }

  async getTracks(ids: string[]) {
    const trackMap: Record<string, TrackItem | undefined> = {}

    const chunked = chunk(ids, 100)
    for (let ids of chunked) {
      const Keys = ids.map((id) => ({ id: this.gId(id) }))
      const response = await AWS.docs
        .batchGet({
          RequestItems: {
            track: {
              Keys,
            },
          },
        })
        .promise()

      if (response.Responses) {
        const tracks = response.Responses.track as TrackItem[]

        for (let track of tracks) {
          const m = track.id.match(/:(.+)/)
          trackMap[m![1]] = track
        }
      }
    }

    if (Object.keys(trackMap).length > 0) {
      return trackMap
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

export type UpdateTrackParams = {
  seen?: TrackSeenContext
  increment_by?: number
  triageActions?: TrackTriageAction[]
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
