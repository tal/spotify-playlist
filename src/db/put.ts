import { AWS } from '../aws'
import { DocumentClient } from 'aws-sdk/lib/dynamodb/document_client'

type TableNames = 'user' | 'action_history'

const converers = {
  action_history: (
    TableName: string,
    history: ActionHistoryItemData,
  ): DocumentClient.PutItemInput => {
    return {
      TableName,
      Item: history,
    }
  },
  user: (TableName: string, user: UserData): DocumentClient.PutItemInput => {
    return {
      TableName,
      Item: {
        id: user.id,
        spotifyAuth: {
          refreshToken: user.spotifyAuth.refreshToken,
          accessToken: user.spotifyAuth.accessToken,
          expiresAt: user.spotifyAuth.expiresAt,
        },
      },
    }
  },
}

export async function put<T>(TableName: TableNames, model: T): Promise<T> {
  var params = (converers[TableName] as any)(TableName, model as any)
  const docs = await AWS.docs
  await docs.put(params).promise()

  return model
}
