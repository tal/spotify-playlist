interface Env {
  spotify: {
    clientId: string
    clientSecret: string
  }
}

async function getKey(key: string) {
  const val = process.env[key]

  if (!val) throw `couldn't get required env var ${key}`

  return val
}

let env: Promise<Env> | null = null

async function genEnv(): Promise<Env> {
  const [clientId, clientSecret] = await Promise.all([
    getKey('SPOTIFY_CLIENT_ID'),
    getKey('SPOTIFY_CLIENT_SECRET'),
  ])

  return { spotify: { clientId, clientSecret } }
}

export function getEnv(): Promise<Env> {
  if (env) return env

  env = genEnv()

  return env
}
