import { chunk } from 'lodash'
import {
  QueryCommand,
  UpdateCommand,
  GetCommand,
  BatchGetCommand,
  BatchWriteCommand,
  PutCommand,
  DeleteCommand,
  ScanCommand,
  ScanCommandInput,
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

/** Exponential from BASE, so five retries span roughly 50ms → 800ms. */
const BATCH_GET_MAX_RETRIES = 5
const BATCH_GET_RETRY_BASE_MS = 50

/**
 * DynamoDB caps BatchWrite at 25 items. The same number bounds how many
 * mutations an action puts in one set, since a set is fired as a single
 * `Promise.all` and a wider fan-out throttles itself.
 */
export const DYNAMO_WRITE_CHUNK = 25

/** All the status reconciliation sweep reads off a track row. */
export type TrackStatusRow = Pick<TrackItem, 'id' | 'status'>

/** Shared by every retried Dynamo call below. */
function isDynamoThroughputError(error: any): boolean {
  const errorName = error.name || error.__type || ''
  return (
    errorName.includes('ProvisionedThroughputExceededException') ||
    errorName.includes('ThrottlingException') ||
    (error.$metadata?.httpStatusCode === 400 && error.ThrottlingReasons)
  )
}

export class Dynamo {
  constructor(public readonly user: UserData) {}

  gId(suffix: string) {
    return `${this.user.id}:${suffix}`
  }

  /** Inverse of `gId`: the bare Spotify id back out of a stored key. */
  ungId(id: string) {
    return id.match(/:(.+)/)?.[1] ?? id
  }

  /**
   * Appends the denormalized-status clauses to an UpdateCommand being built.
   *
   * Every write of `status` routes through here, so the reserved-word alias and
   * the `status_changed_at` it must always travel with cannot drift apart
   * between the three call sites.
   */
  private appendStatusClause(
    parts: string[],
    names: NonNullable<UpdateCommandInput['ExpressionAttributeNames']>,
    values: NonNullable<UpdateCommandInput['ExpressionAttributeValues']>,
    { status, changed_at }: { status: TrackStatus; changed_at: number },
  ) {
    parts.push('#status = :status', 'status_changed_at = :status_changed_at')
    // `status` is a DynamoDB reserved word
    names['#status'] = 'status'
    values[':status'] = status
    values[':status_changed_at'] = changed_at
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

    const expressionParts = [
      '#triage_actions = list_append(if_not_exists(#triage_actions, :empty_list), :location)',
    ]
    const ExpressionAttributeNames: UpdateCommandInput['ExpressionAttributeNames'] =
      {
        '#triage_actions': 'triage_actions',
      }
    const ExpressionAttributeValues: UpdateCommandInput['ExpressionAttributeValues'] =
      {
        ':location': [action],
        ':empty_list': [],
      }

    // Written in the same UpdateCommand as the log entry it mirrors, so the
    // denormalized status cannot drift from `triage_actions`. Status-neutral
    // actions ('upvote') leave the existing value alone.
    const status = statusForTriageActions([action])

    if (status) {
      this.appendStatusClause(
        expressionParts,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        status,
      )
    }

    const params: UpdateCommandInput = {
      TableName: 'track',
      Key: {
        id,
      },
      UpdateExpression: 'SET ' + expressionParts.join(', '),
      ExpressionAttributeNames,
      ExpressionAttributeValues,
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
    { seen, increment_by, stage, triageActions }: UpdateTrackParams,
  ) {
    const id = this.gId(trackId)

    const ExpressionAttributeValues: UpdateCommandInput['ExpressionAttributeValues'] =
      {}
    const ExpressionAttributeNames: UpdateCommandInput['ExpressionAttributeNames'] =
      {}

    const expressionParts = []

    if (typeof increment_by === 'number' && increment_by > 0) {
      expressionParts.push(
        `play_count = if_not_exists(play_count, :zero) + :incr`,
      )
      ExpressionAttributeValues[':zero'] = 0
      ExpressionAttributeValues[':incr'] = increment_by

      // Rides along in the same UpdateCommand as the global counter, so a
      // stage-attributed listen still costs exactly one write.
      if (stage) {
        const attr = playCountAttributeFor(stage)
        expressionParts.push(`${attr} = if_not_exists(${attr}, :zero) + :incr`)
      }
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

      // Same reasoning as addTrackTriageAction: keep the denormalized status in
      // the same write as the log entries it is derived from.
      const status = statusForTriageActions(triageActions)
      if (status) {
        this.appendStatusClause(
          expressionParts,
          ExpressionAttributeNames,
          ExpressionAttributeValues,
          status,
        )
      }
    }

    const params: UpdateCommandInput = {
      TableName: 'track',
      Key: {
        id,
      },
      UpdateExpression: 'SET ' + expressionParts.join(', '),
      ExpressionAttributeValues,
      // DynamoDB rejects an empty ExpressionAttributeNames, so only send it
      // when the status clause actually needed a name alias.
      ...(Object.keys(ExpressionAttributeNames).length
        ? { ExpressionAttributeNames }
        : {}),
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
      let Keys: { id: string }[] = ids.map((id) => ({ id: this.gId(id) }))
      let attempt = 0

      // Under throttling BatchGet succeeds while handing back the keys it did
      // not read, and an unread key is indistinguishable from a missing row.
      // That distinction matters: ProcessManualTriage reads "no row" as "never
      // triaged" and writes a triage action, so dropping unread keys turns a
      // throttle into spurious 'promote' entries — and the write storm that
      // caused the throttle makes it likely. Retry until they come back.
      while (Keys.length) {
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
            trackMap[this.ungId(track.id)] = track
          }
        }

        Keys = (response.UnprocessedKeys?.track?.Keys ?? []) as {
          id: string
        }[]

        if (!Keys.length) break

        attempt += 1

        if (attempt > BATCH_GET_MAX_RETRIES) {
          throw `getTracks left ${Keys.length} keys unread after ${BATCH_GET_MAX_RETRIES} retries — refusing to report them as missing`
        }

        console.log(
          `[Dynamo] getTracks retrying ${Keys.length} unprocessed keys (attempt ${attempt})`,
        )

        await delay(BATCH_GET_RETRY_BASE_MS * 2 ** (attempt - 1))
      }
    }

    // Tracks with no row yet are simply absent from the map — callers already
    // handle `undefined` lookups, so an all-miss batch is not an error.
    return trackMap
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

  /**
   * The rows whose status still claims they are somewhere in the triage flow.
   *
   * Still a full table scan: the `track` table has no index on status and rows
   * are never deleted, so cost grows with every track ever seen. Index `status`
   * before adding callers.
   *
   * The filter and projection are worth having anyway — a scan is billed on
   * pre-filter item size, so they buy payload, unmarshalling and Lambda memory
   * rather than RCU. `triage_actions` is append-only and by far the fattest
   * attribute on the row; the sweep reads neither it nor anything else beyond
   * the two fields below.
   */
  async tracksWithLiveStatus() {
    const items: TrackStatusRow[] = []
    let ExclusiveStartKey: ScanCommandInput['ExclusiveStartKey']

    do {
      const params: ScanCommandInput = {
        TableName: 'track',
        FilterExpression:
          'begins_with(id, :prefix) AND #status IN (:inbox, :promoted)',
        // `status` is a DynamoDB reserved word
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':prefix': this.gId(''),
          ':inbox': 'inbox' satisfies TrackStatus,
          ':promoted': 'promoted' satisfies TrackStatus,
        },
        ProjectionExpression: 'id, #status',
        ExclusiveStartKey,
      }

      // An unbounded scan on a per-minute path is exactly what trips throughput
      // limits, and a throttled page here would silently truncate the sweep into
      // "these rows vanished". Same backoff every other scan in this file uses.
      const response = await retryWithBackoff(
        () => AWS.docs.send(new ScanCommand(params)),
        {
          maxRetries: 8,
          initialDelay: 500,
          maxDelay: 30000,
          backoffMultiplier: 2,
          shouldRetry: isDynamoThroughputError,
          onRetry: (_error, attempt, nextDelay) => {
            console.log(
              `⚠️ DynamoDB throughput exceeded scanning tracks (attempt ${attempt}) after ${nextDelay}ms`,
            )
          },
        },
      )

      if (response.Items) items.push(...(response.Items as TrackStatusRow[]))

      ExclusiveStartKey = response.LastEvaluatedKey
    } while (ExclusiveStartKey)

    console.log(`[Dynamo] scanned ${items.length} rows with a live status`)

    // Hand back bare Spotify ids, matching getTracks()
    return items.map((item) => ({ ...item, id: this.ungId(item.id) }))
  }

  async setTrackStatus(
    { id: trackId }: { id: string },
    status: TrackStatus,
    changed_at: number,
  ) {
    const id = this.gId(trackId)

    const expressionParts: string[] = []
    const ExpressionAttributeNames: UpdateCommandInput['ExpressionAttributeNames'] =
      {}
    const ExpressionAttributeValues: UpdateCommandInput['ExpressionAttributeValues'] =
      {}

    this.appendStatusClause(
      expressionParts,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      { status, changed_at },
    )

    const params: UpdateCommandInput = {
      TableName: 'track',
      Key: { id },
      UpdateExpression: 'SET ' + expressionParts.join(', '),
      ExpressionAttributeNames,
      ExpressionAttributeValues,
    }

    await AWS.docs.send(new UpdateCommand(params))
  }

  async updateAccessToken(
    id: string,
    token: string,
    expiresAt: number,
    refreshToken?: string,
  ) {
    // Spotify may hand back a NEW refresh token on refresh. When it does, we
    // have to persist it — otherwise we keep re-sending the stale one until
    // Spotify revokes it and every future refresh fails with invalid_grant
    // ("Refresh token revoked"). When Spotify omits refresh_token, keep the
    // existing stored value untouched.
    const setClauses = [
      'spotifyAuth.accessToken = :at',
      'spotifyAuth.expiresAt = :exp',
    ]
    const values: Record<string, any> = {
      ':at': token,
      ':exp': expiresAt,
    }

    if (refreshToken) {
      setClauses.push('spotifyAuth.refreshToken = :rt')
      values[':rt'] = refreshToken
    }

    var params: UpdateCommandInput = {
      TableName: 'user',
      Key: { id },
      UpdateExpression: `set ${setClauses.join(', ')}`,
      ExpressionAttributeValues: values,
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
    const batches = chunk(songs, DYNAMO_WRITE_CHUNK)

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
    const batches = chunk(songs, DYNAMO_WRITE_CHUNK)

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

    // Create key objects for deletion
    const keysToDelete = trackIds.map(trackId => ({
      userId,
      trackId,
    }))

    const batches = chunk(keysToDelete, DYNAMO_WRITE_CHUNK)
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
  stage?: TriageStage
  triageActions?: TrackTriageAction[]
}

export function playCountAttributeFor(
  stage: TriageStage,
): StagePlayCountAttribute {
  return `play_count_${stage}`
}

const STATUS_BY_TRIAGE_ACTION: Record<
  TrackTriageActionType,
  TrackStatus | null
> = {
  inboxed: 'inbox',
  promote: 'promoted',
  // Only `demoteTrack()` emits 'remove', so this is the explicit demote signal.
  remove: 'removed',
  // Status-neutral on purpose. `promoteTrack()` pushes 'upvote' last on EVERY
  // promote, after the conditional 'promote' entry — mapping it to a state
  // would clobber 'promoted' on every promotion to Current.
  upvote: null,
}

/**
 * The status implied by a batch of triage actions: the last action that maps to
 * a state wins. Returns the `action_at` alongside it so the denormalized field
 * and the log it mirrors always agree on timing. Undefined when no action in
 * the batch carries a state.
 */
export function statusForTriageActions(actions: TrackTriageAction[]) {
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const status = STATUS_BY_TRIAGE_ACTION[actions[i].action_type]

    if (status) {
      return { status, changed_at: actions[i].action_at }
    }
  }

  return
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
