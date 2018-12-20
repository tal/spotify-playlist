import { AWS } from '../aws'
import { DocumentClient } from 'aws-sdk/lib/dynamodb/document_client'

export async function updateAccessToken(
  id: string,
  token: string,
  expiresAt: number,
) {
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
