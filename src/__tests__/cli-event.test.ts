import { describe, expect, it } from 'bun:test'
import { buildCliEvent, cliActionNames, parseCliArgs } from '../cli-event'

describe('Bun CLI event construction', () => {
  it('keeps every supported maintenance action available after CLI consolidation', () => {
    expect(cliActionNames).toEqual(
      expect.arrayContaining([
        'promote',
        'demote',
        'archive',
        'playback',
        'auto-inbox',
        'undo',
        'undo-last',
        'rule-playlist',
        'sync-liked-songs',
        'liked-songs-stats',
        'clear-liked-cache',
        'listen-stats',
      ]),
    )
  })

  it('preserves the promote-and-skip alias', () => {
    expect(buildCliEvent('promotes')).toMatchObject({
      pathParameters: { action: 'promote' },
      queryStringParameters: { 'and-skip': 'true' },
    })
  })

  it('starts the server without mistaking the flag for an action', () => {
    expect(parseCliArgs(['--server'])).toEqual({
      action: 'instant',
      useServer: true,
    })
  })

  it('defaults a command invocation to instant and rejects unknown actions', () => {
    expect(parseCliArgs([])).toEqual({ action: 'instant', useServer: false })
    expect(() => parseCliArgs(['not-an-action'])).toThrow(
      '"not-an-action" cannot be run',
    )
  })
})
