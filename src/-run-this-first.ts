const dryAll =
  process.env['DRY_ALL'] === '1' || process.env['DRY_ALL'] === 'true'

global.dev = {
  isDev:
    process.env['NODE_ENV'] === 'dev' ||
    process.env['NODE_ENV'] === 'development',
  dryAWS: dryAll,
  drySpotify:
    dryAll ||
    process.env['DRY_SPOTIFY'] === '1' ||
    process.env['DRY_SPOTIFY'] === 'true',
}

global.seconds = 1000
global.minutes = 1000 * 60
global.hours = 1000 * 60 * 60
global.days = 1000 * 60 * 60 * 24

const AWSXRay = require('aws-xray-sdk')
AWSXRay.captureHTTPsGlobal(require('http'))
