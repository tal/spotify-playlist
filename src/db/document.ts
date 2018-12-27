import { AWS } from '../aws'

// export async function document(
//   TableName: 'action_history',
//   Key: { [k: string]: string },
// ): Promise<ActionHistoryItemData | undefined>
// export async function document(
//   TableName: 'user',
//   Key: { [k: string]: string },
// ): Promise<UserData | undefined>
export async function document<T>(
  TableName: string,
  Key: { [k: string]: string },
): Promise<T | undefined> {
  const docs = await AWS.docs
  const resp = await docs.get({ TableName, Key }).promise()

  return resp.Item as T | undefined
}

export async function getActionHistory(id: string, since: number) {
  const docs = await AWS.docs
  const resp = await docs
    .query({
      TableName: 'action_history',
      KeyConditionExpression: 'id = :id AND created_at > :limit',
      ExpressionAttributeValues: {
        ':id': id,
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
