const dryAll =
  process.env['DRY_ALL'] === '1' || process.env['DRY_ALL'] === 'true'

const g = globalThis as any

g.dev = {
  isDev:
    process.env['NODE_ENV'] === 'dev' ||
    process.env['NODE_ENV'] === 'development',
  dryAWS: dryAll,
  drySpotify:
    dryAll ||
    process.env['DRY_SPOTIFY'] === '1' ||
    process.env['DRY_SPOTIFY'] === 'true',
}

g.seconds = 1000
g.minutes = 1000 * 60
g.hours = 1000 * 60 * 60
g.days = 1000 * 60 * 60 * 24

if (process.env._X_AMZN_TRACE_ID) {
  const AWSXRay = require('aws-xray-sdk')
  AWSXRay.captureHTTPsGlobal(require('http'))
}
