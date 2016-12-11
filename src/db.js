import _ from 'lodash'
import path from 'path'
import Promise from 'bluebird'
import jsonfile from 'jsonfile'

const CONFIG_PATH = path.resolve(__dirname, '../config.json')

const readFile = Promise.promisify(jsonfile.readFile)
const writeFile = Promise.promisify(jsonfile.writeFile)

let cache

export async function getKey(key) {
  let config
  if (cache) {
    config = cache
  } else {
    config = await readFile(CONFIG_PATH)
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

export function getKeySync(key) {
  return _.get(getConfigSync(), key)
}

export function setKeySync(key, value) {
  const config = getConfigSync()

  _.set(config, key, value)

  jsonfile.writeFileSync(CONFIG_PATH, config, {spaces: 2})
  cache = null

  return config
}

export async function setKey(key, value) {
  count += 1
  let localCount = count
  console.log(`starting: ${localCount}`)
  try {
    await setPromise
    console.log(`waited for previous: ${localCount}`)
  } catch (e) {
    throw 'previous write failed, so this one is'
  }

  const config = await readFile(CONFIG_PATH)

  console.log(`read config: ${localCount}`)

  _.set(config, key, value)

  console.log(`start write config: ${localCount}`)
  setPromise = writeFile(CONFIG_PATH, config, {spaces: 2})
  cache = null

  await setPromise

  console.log(`complete write config: ${localCount}`)

  return config
}
