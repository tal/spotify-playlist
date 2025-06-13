import { chunk } from 'lodash'
import { 
  QueryCommand,
  UpdateCommand,
  GetCommand,
  BatchGetCommand,
  PutCommand,
  QueryCommandInput,
  UpdateCommandInput,
  GetCommandInput,
  BatchGetCommandInput,
  PutCommandInput
} from '@aws-sdk/lib-dynamodb'
import { AWS } from '../aws'

export class Dynamo {
  constructor(public readonly user: UserData) {}

  gId(suffix: string) {
    return `${this.user.id}:${suffix}`
  }

  async getActionHistory(id: string, since: number) {
    const params: QueryCommandInput = {
      TableName: 'action_history',
      KeyConditionExpression: 'id = :id AND created_at > :limit',
      ExpressionAttributeValues: {
        ':id': this.gId(id),
        ':limit': since,
      },
      Limit: 1,
    }

    const resp = await AWS.docs.send(new QueryCommand(params))

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

    const params: UpdateCommandInput = {
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

    const response = await AWS.docs.send(new UpdateCommand(params))

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

    const ExpressionAttributeValues: UpdateCommandInput['ExpressionAttributeValues'] =
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

    const params: UpdateCommandInput = {
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

    const response = await AWS.docs.send(new UpdateCommand(params))

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
      const params: BatchGetCommandInput = {
        RequestItems: {
          track: {
            Keys,
          },
        },
      }
      const response = await AWS.docs.send(new BatchGetCommand(params))

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
    const responses = await Promise.all(
      ids.map(async (id) => {
        const key = this.gId(id)
        const params: GetCommandInput = {
          TableName: 'track',
          Key: { id: key },
        }
        const resp = await AWS.docs.send(new GetCommand(params))

        return { id, item: resp.Item }
      }),
    )

    const result: {
      [k: string]:
        | { id: string; found: false }
        | { id: string; found: true; item: Record<string, any> }
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
    var params: UpdateCommandInput = {
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

    const response = await AWS.docs.send(new UpdateCommand(params))

    if (response.Attributes) {
      return response.Attributes as UserData
    } else {
      throw 'no data returned from update for some reason'
    }
  }

  async updateLastPlayedAtProcessedTimestamp(id: string, ts: number) {
    var params: UpdateCommandInput = {
      TableName: 'user',
      Key: { id },
      UpdateExpression: 'set lastPlayedAtProcessedTimestamp = :ts',
      ExpressionAttributeValues: {
        ':ts': ts,
      },
      ReturnValues: 'ALL_NEW',
    }

    const response = await AWS.docs.send(new UpdateCommand(params))

    if (response.Attributes) {
      return response.Attributes as UserData
    } else {
      throw 'no data returned from update for some reason'
    }
  }

  async putActionHistory(history: ActionHistoryItemData) {
    const params: PutCommandInput = {
      TableName: 'action_history',
      Item: { ...history, id: this.gId(history.id) },
    }

    await AWS.docs.send(new PutCommand(params))

    return history
  }

  async putUser(user: UserData) {
    var params: PutCommandInput = {
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
    await AWS.docs.send(new PutCommand(params))

    return user
  }
}

export type UpdateTrackParams = {
  seen?: TrackSeenContext
  increment_by?: number
  triageActions?: TrackTriageAction[]
}

async function getUser(userName: string) {
  const params: GetCommandInput = {
    TableName: 'user',
    Key: { id: userName }
  }
  const resp = await AWS.docs.send(new GetCommand(params))

  return resp.Item as UserData | undefined
}

export async function getDynamo(userName?: string) {
  if (!userName) return

  const user = await getUser(userName)

  if (!user) return

  return new Dynamo(user)
}
