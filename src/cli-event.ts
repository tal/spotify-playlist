type CliActionConfig = {
  action: string
  query?: Record<string, string>
}

const CLI_ACTIONS = {
  archive: { action: 'archive' },
  promote: { action: 'promote' },
  promotes: { action: 'promote', query: { 'and-skip': 'true' } },
  demote: { action: 'demote' },
  demotes: { action: 'demote', query: { 'and-skip': 'true' } },
  'rule-playlist': { action: 'rule-playlist', query: { rule: 'smart' } },
  'neo-tribal': {
    action: 'handle-playlist',
    query: { 'playlist-name': 'Neo Tribal [A]' },
  },
  scandinavian: {
    action: 'handle-playlist',
    query: { 'playlist-name': 'Scandanavian Women [A]' },
  },
  'known-playlists': { action: 'handle-known-playlists' },
  'all-playlists': { action: 'handle-playlists' },
  instant: { action: 'instant' },
  playback: { action: 'playback' },
  'listen-stats': { action: 'listen-stats' },
  'auto-inbox': { action: 'auto-inbox' },
  user: { action: 'user' },
  undo: { action: 'undo' },
  'undo-last': { action: 'undo-last' },
  'sync-liked-songs': { action: 'sync-liked-songs' },
  'liked-songs-stats': { action: 'liked-songs-stats' },
  'clear-liked-cache': { action: 'clear-liked-cache' },
} as const satisfies Record<string, CliActionConfig>

export type CliAction = keyof typeof CLI_ACTIONS

export const cliActionNames = Object.keys(CLI_ACTIONS) as CliAction[]

function isCliAction(value: string): value is CliAction {
  return value in CLI_ACTIONS
}

export function parseCliArgs(args: readonly string[]) {
  const useServer = args.includes('--server')
  const candidate = args.find((arg) => !arg.startsWith('--')) ?? 'instant'

  if (!isCliAction(candidate)) {
    throw new Error(`"${candidate}" cannot be run`)
  }

  return { action: candidate, useServer }
}

export function buildCliEvent(action: CliAction) {
  const config = CLI_ACTIONS[action]

  return {
    // A dotted path is never interpreted as an action name; pathParameters wins.
    path: '/action.lambda',
    headers: {},
    requestContext: {},
    resource: '/action.lambda',
    httpMethod: 'GET',
    pathParameters: { action: config.action },
    queryStringParameters: 'query' in config ? config.query : {},
  }
}
