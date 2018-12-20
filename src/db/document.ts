import { AWS } from '../aws'

export async function document(
  TableName: 'user',
  Key: { [k: string]: string },
): Promise<UserData | undefined>
export async function document<T>(
  TableName: string,
  Key: { [k: string]: string },
): Promise<T | undefined> {
  const docs = await AWS.docs
  const resp = await docs.get({ TableName, Key }).promise()

  return resp.Item as T | undefined
}
