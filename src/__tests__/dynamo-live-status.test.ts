import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { AWS } from '../aws'
import {
  Dynamo,
  LIVE_TRACK_STATUSES,
  TRACK_STATUS_INDEX,
  liveStatusQuery,
} from '../db/dynamo'

/**
 * `tracksWithLiveStatus` used to be a full-table Scan that throttled every
 * 6-hourly run. These tests pin the replacement: a Query per live status
 * against the sparse `status-id-index` GSI, paginated to completion, with the
 * user prefix stripped from the ids it hands back. Same spy-at-the-boundary
 * approach as `dynamo-track-updates.test.ts`; no DynamoDB Local needed.
 */

const user: UserData = {
  id: 'test-user',
  spotifyAuth: { accessToken: '', refreshToken: '', expiresAt: 0 },
  lastPlayedAtProcessedTimestamp: 0,
}

type SentQuery = { input: QueryCommand['input'] }

function sentQueries(send: ReturnType<typeof spyOn>): QueryCommand['input'][] {
  return send.mock.calls.map(([command]: [unknown]) => {
    expect(command).toBeInstanceOf(QueryCommand)
    return (command as SentQuery).input
  })
}

afterEach(() => {
  ;(AWS.docs.send as any).mockRestore?.()
})

describe('liveStatusQuery', () => {
  it('targets the sparse status index, keyed on status and scoped to the user prefix', () => {
    expect(liveStatusQuery('inbox', 'test-user:')).toEqual({
      TableName: 'track',
      IndexName: TRACK_STATUS_INDEX,
      KeyConditionExpression: '#status = :status AND begins_with(id, :prefix)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'inbox', ':prefix': 'test-user:' },
      ExclusiveStartKey: undefined,
    })
  })

  it('threads the pagination cursor through unchanged', () => {
    const cursor = { id: 'test-user:abc', status: 'promoted' }

    expect(liveStatusQuery('promoted', 'test-user:', cursor)).toMatchObject({
      IndexName: TRACK_STATUS_INDEX,
      ExpressionAttributeValues: { ':status': 'promoted' },
      ExclusiveStartKey: cursor,
    })
  })

  it('names the index the live table was given', () => {
    expect(TRACK_STATUS_INDEX).toBe('status-id-index')
  })
})

describe('Dynamo.tracksWithLiveStatus', () => {
  it('queries the index once per live status and never scans', async () => {
    const send = spyOn(AWS.docs, 'send').mockImplementation(
      async (command: any) => {
        const status = command.input.ExpressionAttributeValues[':status']
        return { Items: [{ id: `test-user:${status}-a`, status }] }
      },
    )

    const rows = await new Dynamo(user).tracksWithLiveStatus()

    const queries = sentQueries(send)
    expect(queries).toHaveLength(LIVE_TRACK_STATUSES.length)
    expect(
      queries.map((query) => query.ExpressionAttributeValues?.[':status']),
    ).toEqual([...LIVE_TRACK_STATUSES])
    expect(
      queries.every((query) => query.IndexName === TRACK_STATUS_INDEX),
    ).toBe(true)
    expect(
      queries.every(
        (query) => query.ExpressionAttributeValues?.[':prefix'] === 'test-user:',
      ),
    ).toBe(true)
  })

  it('strips the user prefix so ids match getTracks()', async () => {
    spyOn(AWS.docs, 'send').mockImplementation(async (command: any) => {
      const status = command.input.ExpressionAttributeValues[':status']
      return status === 'inbox'
        ? { Items: [{ id: 'test-user:spotify-a', status }] }
        : { Items: [] }
    })

    expect(await new Dynamo(user).tracksWithLiveStatus()).toEqual([
      { id: 'spotify-a', status: 'inbox' },
    ])
  })

  it('follows LastEvaluatedKey until a page has none', async () => {
    const firstPageKey = { id: 'test-user:one', status: 'inbox' }
    const send = spyOn(AWS.docs, 'send').mockImplementation(
      async (command: any) => {
        const { ':status': status } = command.input.ExpressionAttributeValues
        const cursor = command.input.ExclusiveStartKey

        if (status !== 'inbox') return { Items: [] }
        if (!cursor) {
          return {
            Items: [{ id: 'test-user:one', status }],
            LastEvaluatedKey: firstPageKey,
          }
        }

        expect(cursor).toEqual(firstPageKey)
        return { Items: [{ id: 'test-user:two', status }] }
      },
    )

    const rows = await new Dynamo(user).tracksWithLiveStatus()

    // two inbox pages + one promoted page
    expect(sentQueries(send)).toHaveLength(3)
    expect(rows.map((row) => row.id)).toEqual(['one', 'two'])
  })

  it('retries a throttled page instead of truncating the sweep', async () => {
    let attempts = 0
    const send = spyOn(AWS.docs, 'send').mockImplementation(
      async (command: any) => {
        const status = command.input.ExpressionAttributeValues[':status']
        if (status !== 'inbox') return { Items: [] }

        attempts += 1
        if (attempts === 1) {
          throw Object.assign(new Error('throttled'), {
            name: 'ProvisionedThroughputExceededException',
          })
        }
        return { Items: [{ id: 'test-user:survivor', status }] }
      },
    )

    const rows = await new Dynamo(user).tracksWithLiveStatus()

    expect(attempts).toBe(2)
    expect(sentQueries(send)).toHaveLength(3)
    expect(rows).toEqual([{ id: 'survivor', status: 'inbox' }])
  })
})
