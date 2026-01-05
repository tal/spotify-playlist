import { chunk } from 'lodash'
import {
  QueryCommand,
  UpdateCommand,
  GetCommand,
  BatchGetCommand,
  BatchWriteCommand,
  PutCommand,
  DeleteCommand,
  QueryCommandInput,
  UpdateCommandInput,
  GetCommandInput,
  BatchGetCommandInput,
  BatchWriteCommandInput,
  PutCommandInput,
  DeleteCommandInput,
} from '@aws-sdk/lib-dynamodb'
import { AWS } from '../aws'
import { retryWithBackoff } from '../utils/retry'
import { delay } from '../utils/delay'

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

  async getRecentActionsOfType(actionType: string, since: number, limit: number = 10) {
    // Use Scan with filter since we can't query by partial partition key
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb')
    
    // If actionType is empty, search for all actions for this user
    const prefix = actionType ? `${this.user.id}:${actionType}:` : `${this.user.id}:`
    
    console.log('Scanning for actions with prefix:', prefix, 'since:', new Date(since).toISOString())
    
    const allItems: ActionHistoryItemData[] = []
    let lastEvaluatedKey: any = undefined
    let totalScanned = 0
    let scanAttempts = 0
    const maxScanAttempts = 10 // Prevent infinite loops
    
    // Continue scanning until we have enough items or no more data
    while (scanAttempts < maxScanAttempts) {
      scanAttempts++
      
      const params: any = {
        TableName: 'action_history',
        FilterExpression: 'begins_with(id, :prefix) AND created_at > :since AND attribute_not_exists(undone)',
        ExpressionAttributeValues: {
          ':prefix': prefix,
          ':since': since,
        },
        Limit: 500, // Scan 500 items per request
      }
      
      if (lastEvaluatedKey) {
        params.ExclusiveStartKey = lastEvaluatedKey
      }
      
      try {
        const resp = await AWS.docs.send(new ScanCommand(params))
        
        if (resp.Items && resp.Items.length > 0) {
          allItems.push(...(resp.Items as ActionHistoryItemData[]))
          console.log(`Scan attempt ${scanAttempts}: found ${resp.Items.length} matching items out of ${resp.ScannedCount} scanned`)
        }
        
        totalScanned += resp.ScannedCount || 0
        lastEvaluatedKey = resp.LastEvaluatedKey
        
        // If we have enough items for the requested limit (with some buffer), stop scanning
        if (allItems.length >= limit * 2) {
          console.log('Found enough items, stopping scan')
          break
        }
        
        // If no more items to scan, stop
        if (!lastEvaluatedKey) {
          console.log('No more items to scan')
          break
        }
        
        // Add a small delay to avoid throughput issues
        if (scanAttempts > 1) {
          await new Promise(resolve => setTimeout(resolve, 100 * scanAttempts))
        }
        
      } catch (error: any) {
        console.error(`Error on scan attempt ${scanAttempts}:`, error.message)
        
        // Handle throughput errors with exponential backoff
        if (error.name === 'ProvisionedThroughputExceededException') {
          const backoffMs = Math.min(1000 * Math.pow(2, scanAttempts), 10000)
          console.log(`Throughput exceeded, backing off for ${backoffMs}ms`)
          await new Promise(resolve => setTimeout(resolve, backoffMs))
          continue
        }
        
        // For other errors, throw
        throw error
      }
    }
    
    console.log(`Total scanned: ${totalScanned} items, found ${allItems.length} matching items`)
    
    // Sort by created_at descending and return requested limit
    const sortedItems = allItems.sort((a, b) => b.created_at - a.created_at)
    
    // Log the first few items for debugging
    if (sortedItems.length > 0) {
      console.log('Most recent actions:')
      sortedItems.slice(0, 3).forEach((item, i) => {
        console.log(`  ${i + 1}. ${item.id} - ${new Date(item.created_at).toISOString()}`)
      })
    }
    
    return sortedItems.slice(0, limit)
  }

  async markActionAsUndone(actionId: string) {
    const params: UpdateCommandInput = {
      TableName: 'action_history',
      Key: {
        id: this.gId(actionId),
      },
      UpdateExpression: 'SET undone = :true, undone_at = :timestamp',
      ExpressionAttributeValues: {
        ':true': true,
        ':timestamp': new Date().getTime(),
      },
    }

    await AWS.docs.send(new UpdateCommand(params))
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
      Item: { 
        ...history, 
        id: this.gId(history.id),
        userId: this.user.id // Add userId for GSI queries
      },
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

  // Liked Songs Cache Methods
  
  async getLikedSongsMetadata(userId: string): Promise<LikedSongsMetadata | undefined> {
    const params: GetCommandInput = {
      TableName: 'liked_songs_metadata',
      Key: { userId },
    }
    
    const resp = await AWS.docs.send(new GetCommand(params))
    return resp.Item as LikedSongsMetadata | undefined
  }
  
  async updateLikedSongsMetadata(metadata: Partial<LikedSongsMetadata> & { userId: string }) {
    const updateExpressions: string[] = []
    const expressionAttributeNames: Record<string, string> = {}
    const expressionAttributeValues: Record<string, any> = {}

    // Build update expression dynamically based on provided fields
    const fields = [
      'totalTracks', 'lastSyncedAt', 'lastFullSyncAt',
      'mostRecentAddedAt', 'oldestAddedAt', 'syncVersion',
      'syncStatus', 'lastError',
      'firstPageTrackIds', 'firstPageHash' // For smart change detection
    ]

    fields.forEach(field => {
      if (field in metadata && metadata[field as keyof LikedSongsMetadata] !== undefined) {
        updateExpressions.push(`#${field} = :${field}`)
        expressionAttributeNames[`#${field}`] = field
        expressionAttributeValues[`:${field}`] = metadata[field as keyof LikedSongsMetadata]
      }
    })
    
    if (updateExpressions.length === 0) {
      throw new Error('No fields to update in metadata')
    }
    
    const params: UpdateCommandInput = {
      TableName: 'liked_songs_metadata',
      Key: { userId: metadata.userId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    }
    
    const response = await AWS.docs.send(new UpdateCommand(params))
    return response.Attributes as LikedSongsMetadata
  }
  
  async batchPutLikedSongs(songs: LikedSongItem[]) {
    // DynamoDB BatchWrite has a limit of 25 items per request
    const batches = chunk(songs, 25)

    // Helper to check if error is a DynamoDB throughput error
    const isDynamoThroughputError = (error: any): boolean => {
      const errorName = error.name || error.__type || ''
      return (
        errorName.includes('ProvisionedThroughputExceededException') ||
        errorName.includes('ThrottlingException') ||
        error.$metadata?.httpStatusCode === 400 && error.ThrottlingReasons
      )
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const params: BatchWriteCommandInput = {
        RequestItems: {
          liked_songs: batch.map(song => ({
            PutRequest: {
              Item: song,
            },
          })),
        },
      }

      await retryWithBackoff(
        () => AWS.docs.send(new BatchWriteCommand(params)),
        {
          maxRetries: 8,
          initialDelay: 500,
          maxDelay: 30000,
          backoffMultiplier: 2,
          shouldRetry: isDynamoThroughputError,
          onRetry: (error, attempt, nextDelay) => {
            console.log(
              `⚠️ DynamoDB throughput exceeded, retrying batch ${i + 1}/${batches.length} (attempt ${attempt}) after ${nextDelay}ms`,
            )
          },
        },
      )
      console.log(`✅ Wrote batch of ${batch.length} liked songs to cache`)

      // Add delay between batches to avoid overwhelming DynamoDB
      // Larger delay reduces throttling but slows overall throughput
      if (i < batches.length - 1) {
        await delay(500)
      }
    }
  }
  
  async getLikedSongs(userId: string, limit?: number): Promise<LikedSongItem[]> {
    // Query using the GSI to get songs sorted by addedAt
    const params: QueryCommandInput = {
      TableName: 'liked_songs',
      IndexName: 'userId-addedAt-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      ScanIndexForward: false, // Sort descending (newest first)
      Limit: limit,
    }

    // Helper to check if error is a DynamoDB throughput error
    const isDynamoThroughputError = (error: any): boolean => {
      const errorName = error.name || error.__type || ''
      return (
        errorName.includes('ProvisionedThroughputExceededException') ||
        errorName.includes('ThrottlingException') ||
        error.$metadata?.httpStatusCode === 400 && error.ThrottlingReasons
      )
    }

    const items: LikedSongItem[] = []
    let lastEvaluatedKey: any = undefined
    let pageNum = 0

    do {
      if (lastEvaluatedKey) {
        params.ExclusiveStartKey = lastEvaluatedKey
      }

      const resp = await retryWithBackoff(
        () => AWS.docs.send(new QueryCommand(params)),
        {
          maxRetries: 8,
          initialDelay: 500,
          maxDelay: 30000,
          backoffMultiplier: 2,
          shouldRetry: isDynamoThroughputError,
          onRetry: (error, attempt, nextDelay) => {
            console.log(
              `⚠️ DynamoDB throughput exceeded reading liked songs page ${pageNum + 1} (attempt ${attempt}) after ${nextDelay}ms`,
            )
          },
        },
      )

      if (resp.Items) {
        items.push(...(resp.Items as LikedSongItem[]))
      }

      lastEvaluatedKey = resp.LastEvaluatedKey
      pageNum++

      // Add small delay between pages to avoid overwhelming DynamoDB
      if (lastEvaluatedKey) {
        await delay(100)
      }

      // If we have a limit and reached it, stop
      if (limit && items.length >= limit) {
        return items.slice(0, limit)
      }
    } while (lastEvaluatedKey)

    return items
  }
  
  async queryLikedSongsSince(userId: string, since: number): Promise<LikedSongItem[]> {
    const params: QueryCommandInput = {
      TableName: 'liked_songs',
      IndexName: 'userId-addedAt-index',
      KeyConditionExpression: 'userId = :userId AND addedAt > :since',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':since': since,
      },
      ScanIndexForward: false, // Sort descending
    }
    
    const resp = await AWS.docs.send(new QueryCommand(params))
    return (resp.Items || []) as LikedSongItem[]
  }
  
  async clearLikedSongs(userId: string) {
    // First, get all songs for this user
    const songs = await this.getLikedSongs(userId)

    // Delete in batches of 25
    const batches = chunk(songs, 25)

    // Helper to check if error is a DynamoDB throughput error
    const isDynamoThroughputError = (error: any): boolean => {
      const errorName = error.name || error.__type || ''
      return (
        errorName.includes('ProvisionedThroughputExceededException') ||
        errorName.includes('ThrottlingException') ||
        error.$metadata?.httpStatusCode === 400 && error.ThrottlingReasons
      )
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const params: BatchWriteCommandInput = {
        RequestItems: {
          liked_songs: batch.map(song => ({
            DeleteRequest: {
              Key: {
                userId: song.userId,
                trackId: song.trackId,
              },
            },
          })),
        },
      }

      await retryWithBackoff(
        () => AWS.docs.send(new BatchWriteCommand(params)),
        {
          maxRetries: 8,
          initialDelay: 500,
          maxDelay: 30000,
          backoffMultiplier: 2,
          shouldRetry: isDynamoThroughputError,
          onRetry: (error, attempt, nextDelay) => {
            console.log(
              `⚠️ DynamoDB throughput exceeded, retrying delete batch ${i + 1}/${batches.length} (attempt ${attempt}) after ${nextDelay}ms`,
            )
          },
        },
      )
      console.log(`🗑️ Deleted batch of ${batch.length} liked songs from cache`)

      // Add delay between batches to avoid overwhelming DynamoDB
      if (i < batches.length - 1) {
        await delay(500)
      }
    }
  }

  /**
   * Delete specific liked songs by their track IDs.
   * More efficient than clearing all songs when only a few were removed.
   * @param userId The user's ID
   * @param trackIds Array of track IDs to delete
   * @returns Number of tracks deleted
   */
  async deleteLikedSongsByIds(userId: string, trackIds: string[]): Promise<number> {
    if (trackIds.length === 0) {
      return 0
    }

    // Helper to check if error is a DynamoDB throughput error
    const isDynamoThroughputError = (error: any): boolean => {
      const errorName = error.name || error.__type || ''
      return (
        errorName.includes('ProvisionedThroughputExceededException') ||
        errorName.includes('ThrottlingException') ||
        error.$metadata?.httpStatusCode === 400 && error.ThrottlingReasons
      )
    }

    // Create key objects for deletion
    const keysToDelete = trackIds.map(trackId => ({
      userId,
      trackId,
    }))

    // DynamoDB BatchWrite has a limit of 25 items per request
    const batches = chunk(keysToDelete, 25)
    let totalDeleted = 0

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const params: BatchWriteCommandInput = {
        RequestItems: {
          liked_songs: batch.map(key => ({
            DeleteRequest: {
              Key: key,
            },
          })),
        },
      }

      await retryWithBackoff(
        () => AWS.docs.send(new BatchWriteCommand(params)),
        {
          maxRetries: 8,
          initialDelay: 500,
          maxDelay: 30000,
          backoffMultiplier: 2,
          shouldRetry: isDynamoThroughputError,
          onRetry: (error, attempt, nextDelay) => {
            console.log(
              `Warning: DynamoDB throughput exceeded, retrying delete batch ${i + 1}/${batches.length} (attempt ${attempt}) after ${nextDelay}ms`,
            )
          },
        },
      )

      totalDeleted += batch.length
      console.log(`Deleted batch of ${batch.length} liked songs from cache`)

      // Add delay between batches to avoid overwhelming DynamoDB
      if (i < batches.length - 1) {
        await delay(500)
      }
    }

    return totalDeleted
  }

  async putLikedSong(song: LikedSongItem) {
    const params: PutCommandInput = {
      TableName: 'liked_songs',
      Item: song,
    }
    
    await AWS.docs.send(new PutCommand(params))
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
    Key: { id: userName },
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
