import { afterEach, expect, spyOn, test } from 'bun:test'
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { AWS } from '../aws'
import { dynamoArchiveCacheStore } from '../db/archive-cache'
import { cachedArchiveLoader } from '../web/archive-cache'

afterEach(() => {
  ;(AWS.docs.send as any).mockRestore?.()
})

test('a persisted hit is exactly one projected GetItem without invoking the source', async () => {
  const feed = { tracks: [], trackCount: 0, generatedAt: 'original' }
  const send = spyOn(AWS.docs, 'send').mockResolvedValue({
    Item: { archiveDashboardCacheV1: { feed, expiresAt: 10 } },
  } as never)
  const load = cachedArchiveLoader(
    async () => {
      throw new Error('must not gather')
    },
    dynamoArchiveCacheStore('koalemos', 'production'),
    () => 0,
  )
  expect(await load(20)).toEqual(feed)
  expect(send.mock.calls).toHaveLength(1)
  const command = send.mock.calls[0][0] as unknown as GetCommand
  expect(command).toBeInstanceOf(GetCommand)
  expect(command.input).toEqual({
    TableName: 'user',
    Key: { id: 'koalemos' },
    ProjectionExpression: '#cache',
    ExpressionAttributeNames: { '#cache': 'archiveDashboardCacheV1' },
    ConsistentRead: true,
  })
})

test('cache writes only its own field, keeps dev separate, and requires an existing user', async () => {
  const send = spyOn(AWS.docs, 'send').mockResolvedValue({} as never)
  const entry = {
    expiresAt: 100,
    feed: { tracks: [], trackCount: 0, generatedAt: 'now' },
  }
  await dynamoArchiveCacheStore('koalemos', 'development').write(entry)
  const command = send.mock.calls[0][0] as unknown as UpdateCommand
  expect(command).toBeInstanceOf(UpdateCommand)
  expect(command.input).toEqual({
    TableName: 'user',
    Key: { id: 'koalemos' },
    UpdateExpression: 'SET #cache = :cache',
    ConditionExpression: 'attribute_exists(id)',
    ExpressionAttributeNames: { '#cache': 'archiveDashboardTestCacheV1' },
    ExpressionAttributeValues: { ':cache': entry },
  })
})
