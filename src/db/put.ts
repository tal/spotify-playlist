import { AWS } from '../aws'
import { DocumentClient } from 'aws-sdk/lib/dynamodb/document_client'

type TableNames = 'user'

const converers = {
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
    } as any
  },
}

export async function put(TableName: 'user', model: UserData): Promise<UserData>
export async function put<T>(TableName: TableNames, model: T): Promise<T> {
  var params = converers[TableName](TableName, model as any)
  const docs = await AWS.docs
  await docs.put(params).promise()

  return model
}
