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
