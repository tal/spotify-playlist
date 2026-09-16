import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { AWS } from '../aws'
import type { ArchiveCacheEntry, ArchiveCacheStore } from '../web/archive-cache'

/** One projected GetItem on a hit, with no user/token or Spotify bootstrap. */
export function dynamoArchiveCacheStore(
  userId: string,
  environment: 'production' | 'development',
): ArchiveCacheStore {
  const attribute =
    environment === 'production'
      ? 'archiveDashboardCacheV1'
      : 'archiveDashboardTestCacheV1'
  const Key = { id: userId }
  const ExpressionAttributeNames = { '#cache': attribute }
  return {
    async read() {
      const result = await AWS.docs.send(
        new GetCommand({
          TableName: 'user',
          Key,
          ProjectionExpression: '#cache',
          ExpressionAttributeNames,
          ConsistentRead: true,
        }),
      )
      return result.Item?.[attribute] as ArchiveCacheEntry | undefined
    },
    async write(entry) {
      // Update just the cache: never replace OAuth credentials or playback state.
      // Refuse to create a partial user if the account was removed mid-refresh.
      await AWS.docs.send(
        new UpdateCommand({
          TableName: 'user',
          Key,
          UpdateExpression: 'SET #cache = :cache',
          ConditionExpression: 'attribute_exists(id)',
          ExpressionAttributeNames,
          ExpressionAttributeValues: { ':cache': entry },
        }),
      )
    },
  }
}
