import _ from 'lodash'
import path from 'path'
import jsonfile from 'jsonfile'

const CONFIG_PATH = path.resolve(__dirname, '../config.json')

let cache: object | undefined

export function getAllSync() {
  return jsonfile.readFileSync(CONFIG_PATH)
}

export async function getKey(key: string) {
  let config
  if (cache) {
    config = cache
  } else {
    config = await jsonfile.readFile(CONFIG_PATH)
    cache = config
  }

  return _.get(config, key)
}

let setPromise = Promise.resolve()

let count = 0

function getConfigSync() {
  let config
  if (cache) {
    config = cache
  } else {
    config = jsonfile.readFileSync(CONFIG_PATH)
    cache = config
  }

  return config
}

export function getKeySync(key: string) {
  return _.get(getConfigSync(), key)
}

export function setKeySync(key: string, value: any) {
  const config = getConfigSync()

  _.set(config, key, value)

  jsonfile.writeFileSync(CONFIG_PATH, config, { spaces: 2 })
  cache = undefined

  return config
}

export async function setKey(key: string, value: any) {
  count += 1
  let localCount = count
  console.log(`starting: ${localCount}`)
  try {
    await setPromise
    console.log(`waited for previous: ${localCount}`)
  } catch (e) {
    throw 'previous write failed, so this one is'
  }

  const config = await jsonfile.readFile(CONFIG_PATH)

  console.log(`read config: ${localCount}`)

  _.set(config, key, value)

  console.log(`start write config: ${localCount}`)
  setPromise = jsonfile.writeFile(CONFIG_PATH, config, { spaces: 2 })
  cache = undefined

  await setPromise

  console.log(`complete write config: ${localCount}`)

  return config
}
