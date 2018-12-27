import AWS from 'aws-sdk'

interface Env {
  spotify: {
    clientId: string
    clientSecret: string
  }
  aws: {
    region: string
    accessKeyId: string
    secretAccessKey: string
  }
}

const kms = new AWS.KMS()

type Encoding = 'none' | 'encrypted'

async function getKey(key: string, encoding: Encoding) {
  const val = process.env[key]

  if (!val) throw `couldn't get required env var ${key}`

  if (encoding === 'none' || dev.isDev) {
    return val
  }

  const data = await kms
    .decrypt({ CiphertextBlob: new Buffer(val, 'base64') })
    .promise()

  return (data.Plaintext as Buffer).toString('ascii')
}

let env: Env | null = null

export async function getEnv(): Promise<Env> {
  if (env) return env

  const spotifyClientId = getKey('SPOTIFY_CLIENT_ID', 'none')
  const spotifyClientSecret = getKey('SPOTIFY_CLIENT_SECRET', 'none')
  const awsAccessKeyId = getKey('AWS_ACCESS_KEY_ID', 'none')
  const awsSecretAccessKey = getKey('AWS_SECRET_ACCESS_KEY', 'none')
  const awsRegion = getKey('AWS_REGION', 'none')

  env = {
    spotify: {
      clientId: await spotifyClientId,
      clientSecret: await spotifyClientSecret,
    },
    aws: {
      accessKeyId: await awsAccessKeyId,
      secretAccessKey: await awsSecretAccessKey,
      region: await awsRegion,
    },
  }

  return env
}
