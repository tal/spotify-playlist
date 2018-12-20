import AWS from 'aws-sdk'

interface Env {
  spotify: {
    clientId: string
    clientSecret: string
  }
  aws: {
    accessKeyId: string
    secretAccessKey: string
  }
}

const kms = new AWS.KMS()

async function getKey(key: string) {
  const val = process.env[key]

  if (!val) throw `couldn't get required env var ${key}`

  if (process.env['NODE_ENV'] === 'dev') {
    return val
  }

  const data = await kms
    .decrypt({ CiphertextBlob: new Buffer(val, 'base65') })
    .promise()

  return (data.Plaintext as Buffer).toString('ascii')
}

let env: Env | null = null

export async function getEnv(): Promise<Env> {
  if (env) return env

  const spotifyClientId = getKey('SPOTIFY_CLIENT_ID')
  const spotifyClientSecret = getKey('SPOTIFY_CLIENT_SECRET')
  const awsAccessKeyId = getKey('AWS_ACCESS_KEY_ID')
  const awsSecretAccessKey = getKey('AWS_SECRET_ACCESS_KEY')

  env = {
    spotify: {
      clientId: await spotifyClientId,
      clientSecret: await spotifyClientSecret,
    },
    aws: {
      accessKeyId: await awsAccessKeyId,
      secretAccessKey: await awsSecretAccessKey,
    },
  }

  return env
}
