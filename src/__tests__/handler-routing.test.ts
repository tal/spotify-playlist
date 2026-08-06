import { describe, it, expect } from 'bun:test'
import type { APIGatewayProxyEvent } from 'aws-lambda'
import type { Spotify } from '../spotify'
import type { AfterTrackActionAction } from '../actions/track-action'
import { SkipToNextTrack } from '../actions/skip-to-next-track'
import {
  actionNameFromEvent,
  afterCurrentTrack,
  doAfterCurrentTrack,
  handler,
  normalizeActionError,
} from '../index'

/**
 * The handler is the only place a request turns into an action name, an
 * and-skip decision, and a status code, and all three are decided by pure
 * functions surrounded by I/O. This pins those three decisions directly, so a
 * change to routing precedence, to the `and-skip` truthiness, or to the
 * 400-vs-500 mapping fails here rather than in production only for the one
 * caller shape nobody tried by hand.
 */

type EventShape = {
  path?: string
  rawPath?: string
  pathParameters?: Record<string, string> | null
  queryStringParameters?: Record<string, string> | null
}

function event(shape: EventShape = {}): APIGatewayProxyEvent {
  return {
    path: shape.path ?? '/',
    pathParameters: shape.pathParameters ?? null,
    queryStringParameters: shape.queryStringParameters ?? null,
    ...(shape.rawPath === undefined ? {} : { rawPath: shape.rawPath }),
  } as APIGatewayProxyEvent
}

describe('actionNameFromEvent source precedence', () => {
  // Three transports reach the same handler — API Gateway path parameters,
  // a query string, and a Lambda Function URL's raw path — and they can all
  // carry a name at once. The order is what decides which one wins.
  const cases: Array<[string, EventShape, string | null]> = [
    [
      'pathParameters beats both a query string and a path',
      {
        pathParameters: { action: 'promote' },
        queryStringParameters: { action: 'demote' },
        rawPath: '/archive',
      },
      'promote',
    ],
    [
      'query string beats the path',
      { queryStringParameters: { action: 'demote' }, rawPath: '/archive' },
      'demote',
    ],
    ['the path is the last resort', { rawPath: '/archive' }, 'archive'],
    [
      'an empty pathParameters.action falls through to the query string',
      {
        pathParameters: { action: '' },
        queryStringParameters: { action: 'demote' },
      },
      'demote',
    ],
    [
      'an empty query-string action falls through to the path',
      { queryStringParameters: { action: '' }, rawPath: '/archive' },
      'archive',
    ],
    [
      'pathParameters without an action key falls through',
      { pathParameters: { proxy: 'promote' }, rawPath: '/archive' },
      'archive',
    ],
    [
      'a query string without an action key falls through',
      { queryStringParameters: { 'and-skip': '1' }, rawPath: '/archive' },
      'archive',
    ],
    [
      'a null pathParameters is not dereferenced',
      { pathParameters: null, queryStringParameters: { action: 'promote' } },
      'promote',
    ],
  ]

  it.each(cases)('%s', (_name, shape, expected) => {
    expect(actionNameFromEvent(event(shape))).toBe(expected)
  })
})

describe('actionNameFromEvent path fallback', () => {
  // `rawPath` is the Function URL field and `path` the API Gateway one; the
  // dot guard is what stops a browser's /favicon.ico from being routed as an
  // action name and 404-ing with a misleading body.
  const cases: Array<[string, EventShape, string | null]> = [
    [
      'rawPath wins over path',
      { rawPath: '/promote', path: '/demote' },
      'promote',
    ],
    ['path is used when rawPath is absent', { path: '/demote' }, 'demote'],
    [
      'an empty rawPath falls back to path',
      { rawPath: '', path: '/demote' },
      'demote',
    ],
    ['the root path is not an action', { rawPath: '/' }, null],
    ['an empty path is not an action', { path: '' }, null],
    ['a dotted path is not an action', { rawPath: '/favicon.ico' }, null],
    [
      'a dot anywhere disqualifies the whole path',
      { rawPath: '/promote.json' },
      null,
    ],
    [
      'a nested path keeps its inner slashes',
      { rawPath: '/handle/playlists' },
      'handle/playlists',
    ],
    [
      'only the leading slash is stripped',
      { rawPath: '/promote/' },
      'promote/',
    ],
    [
      'a path without a leading slash loses its first character',
      { rawPath: 'promote' },
      'romote',
    ],
    ['a missing path is not an action', {}, null],
  ]

  it.each(cases)('%s', (_name, shape, expected) => {
    expect(actionNameFromEvent(event(shape))).toBe(expected)
  })
})

describe('afterCurrentTrack', () => {
  // The decision is a bare truthiness check on the raw query-string value, so
  // every present-and-non-empty value skips — including the ones a caller
  // would write to mean "do not skip".
  const cases: Array<
    [string, EventShape['queryStringParameters'], AfterTrackActionAction]
  > = [
    ['and-skip=1 skips', { 'and-skip': '1' }, 'skip-track'],
    ['and-skip=true skips', { 'and-skip': 'true' }, 'skip-track'],
    ['and-skip=false also skips', { 'and-skip': 'false' }, 'skip-track'],
    ['and-skip=0 also skips', { 'and-skip': '0' }, 'skip-track'],
    ['an empty and-skip does nothing', { 'and-skip': '' }, 'nothing'],
    ['a missing and-skip does nothing', { action: 'promote' }, 'nothing'],
    ['no query string at all does nothing', null, 'nothing'],
  ]

  it.each(cases)('%s', (_name, queryStringParameters, expected) => {
    expect(afterCurrentTrack(event({ queryStringParameters }))).toBe(expected)
  })
})

describe('doAfterCurrentTrack', () => {
  const client = {} as Spotify

  it('builds a skip action when and-skip is set', () => {
    const action = doAfterCurrentTrack(
      client,
      event({ queryStringParameters: { 'and-skip': '1' } }),
    )

    expect(action).toBeInstanceOf(SkipToNextTrack)
  })

  it('builds nothing when and-skip is absent', () => {
    // `null` is what the promote/demote arrays carry into `performActions`,
    // which drops it — so the absent case must stay null rather than become
    // some other falsy placeholder.
    expect(doAfterCurrentTrack(client, event())).toBeNull()
  })

  it('never reads the client while deciding', () => {
    // The decision is query-string only; touching the client here would mean a
    // player read before the track identity is resolved.
    const exploding = new Proxy(
      {},
      {
        get() {
          throw new Error('the client must not be read')
        },
      },
    ) as Spotify

    expect(
      doAfterCurrentTrack(
        exploding,
        event({ queryStringParameters: { 'and-skip': '1' } }),
      ),
    ).toBeInstanceOf(SkipToNextTrack)
  })
})

describe('normalizeActionError on the planners real throws', () => {
  // Planners throw bare strings, and the substring check is the only thing
  // separating "the caller asked for something impossible" from "we broke".
  const cases: Array<[unknown, number, string]> = [
    ['cannot promote if confirmed', 400, 'cannot promote if confirmed'],
    ['no track provided 1', 400, 'no track provided 1'],
    ['no track provided 2', 400, 'no track provided 2'],
    [
      'cannot find playlist named Inbox',
      400,
      'cannot find playlist named Inbox',
    ],
    ['player must be playing', 500, 'player must be playing'],
    [
      'no action for playlist Modern Funk? [A]',
      500,
      'no action for playlist Modern Funk? [A]',
    ],
  ]

  it.each(cases)('%s -> %s', (err, statusCode, errorMessage) => {
    expect(normalizeActionError(err)).toEqual({ statusCode, errorMessage })
  })

  it('leaves a business failure the check does not name as a 500', () => {
    // `player must be playing` is as much a caller error as
    // `cannot promote if confirmed`, and still reports as ours.
    expect(normalizeActionError('player must be playing').statusCode).toBe(500)
  })
})

describe('normalizeActionError substring matching', () => {
  // The check is a plain `String.includes` over three fragments: case
  // sensitive, unanchored, and blind to whether the sentence is about the
  // caller at all.
  const cases: Array<[unknown, number, string]> = [
    ['not found', 400, 'not found'],
    ['playlist not found', 400, 'playlist not found'],
    ['Cannot find user', 500, 'Cannot find user'],
    [
      'cannot run when in state success',
      400,
      'cannot run when in state success',
    ],
    ['', 500, ''],
  ]

  it.each(cases)('%s -> %s', (err, statusCode, errorMessage) => {
    expect(normalizeActionError(err)).toEqual({ statusCode, errorMessage })
  })
})

describe('normalizeActionError on non-string throws', () => {
  // Anything that is not a string reports 500 no matter what it says — an
  // `Error` carrying the very message that would have been a 400 as a string
  // still comes back 500.
  const cases: Array<[string, unknown, number, string]> = [
    ['an Error keeps its message', new Error('boom'), 500, 'boom'],
    [
      'an Error is never downgraded to 400',
      new Error('cannot promote if confirmed'),
      500,
      'cannot promote if confirmed',
    ],
    [
      'a TypeError is still just an Error',
      new TypeError('x is not a function'),
      500,
      'x is not a function',
    ],
    [
      'a plain object is serialized whole',
      { statusCode: 429, message: 'rate limited' },
      500,
      '{"statusCode":429,"message":"rate limited"}',
    ],
    ['an array is serialized whole', ['a', 'b'], 500, '["a","b"]'],
    ['null falls through to the default', null, 500, 'Unknown error occurred'],
    [
      'undefined falls through to the default',
      undefined,
      500,
      'Unknown error occurred',
    ],
    [
      'a number falls through to the default',
      42,
      500,
      'Unknown error occurred',
    ],
  ]

  it.each(cases)('%s', (_name, err, statusCode, errorMessage) => {
    expect(normalizeActionError(err)).toEqual({ statusCode, errorMessage })
  })

  it('throws on a self-referential object rather than reporting it', () => {
    // `JSON.stringify` is unguarded, so a cyclic throw escapes the catch block
    // that exists to turn throws into responses.
    const cyclic: Record<string, unknown> = { action: 'promote' }
    cyclic.self = cyclic

    expect(() => normalizeActionError(cyclic)).toThrow()
  })
})

describe('handler with no action name', () => {
  // The 404 is decided from the event alone, before any Dynamo or Spotify
  // client is built — an unroutable request must never cost a network call.
  const respond = async (shape: EventShape) =>
    (await handler(event(shape), {} as any, (() => {}) as any)) as {
      statusCode: number
      body: string
    }

  it('404s a request carrying no action anywhere', async () => {
    const response = await respond({ rawPath: '/' })

    expect(response.statusCode).toBe(404)
    expect(JSON.parse(response.body)).toEqual({
      error: 'no action name given',
      request: {
        pathParameters: null,
        queryStringParameters: null,
        path: '/',
      },
    })
  })

  it('404s a dotted path and echoes it back', async () => {
    const response = await respond({ rawPath: '/favicon.ico' })

    expect(response.statusCode).toBe(404)
    expect(JSON.parse(response.body).request.path).toBe('/favicon.ico')
  })
})
