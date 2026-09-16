require('./-run-this-first')
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda'
import { handler } from './index'
import { buildWebApp } from './web/app'
import { koalemosContext } from './web/context'
import { currentPlan, gatherCurrent } from './web/current'
import { gatherInbox } from './web/inbox'
import { gatherArchived } from './web/archived'
import { cachedArchiveLoader } from './web/archive-cache'
import { dynamoArchiveCacheStore } from './db/archive-cache'

const archived = cachedArchiveLoader(
  async () => gatherArchived(await koalemosContext(), 20),
  dynamoArchiveCacheStore('koalemos', dev.isDev ? 'development' : 'production'),
)

const web = buildWebApp({
  current: async () =>
    currentPlan(await gatherCurrent(await koalemosContext())),
  inbox: async () => gatherInbox(await koalemosContext(), 20),
  archived,
})

/** Use the original event for HTTP identity, path and action query presence. */
export function shouldRouteToWeb(request: Request): boolean {
  const attached = (request as any).aws
  const event =
    attached === undefined ? undefined : (unwrapEvent(attached) as any)
  if (event !== undefined && !event?.requestContext?.http && !event?.httpMethod)
    return false
  const method =
    event?.requestContext?.http?.method ?? event?.httpMethod ?? request.method
  if (method !== 'GET') return false
  const url = new URL(request.url)
  const path = event?.rawPath ?? event?.path ?? url.pathname
  const hasAction =
    event === undefined
      ? url.searchParams.has('action')
      : Object.prototype.hasOwnProperty.call(
          event.queryStringParameters ?? {},
          'action',
        )
  return (
    path === '/app.js' ||
    path.startsWith('/api/') ||
    (path === '/' && !hasAction)
  )
}

function webRequest(request: Request): Request {
  const attached = (request as any).aws
  if (attached === undefined) return request
  const event = unwrapEvent(attached) as any
  const url = new URL(request.url)
  url.pathname = event.rawPath ?? event.path ?? url.pathname
  url.search = new URLSearchParams(event.queryStringParameters ?? {}).toString()
  return new Request(url, { method: 'GET', headers: request.headers })
}

/**
 * Adapter between the Bun custom-runtime layer and the existing Lambda handler.
 *
 * The layer (`/opt/runtime.ts`) does not hand the handler a Lambda event — it
 * turns every invocation into a `Request` and expects `fetch(request)` back.
 * This file translates in both directions so `src/index.ts` keeps its
 * `APIGatewayProxyHandler` shape and nothing downstream knows the runtime moved.
 *
 * Two details of the layer drive the code below:
 *
 * 1. For a non-HTTP event (our EventBridge `frequent-crawling` trigger) the
 *    request *body* is not the event — it is `{requestId, traceId, functionArn,
 *    deadlineMs, event}`. The untouched event is attached to the request as
 *    `.aws`, so that is what we read. `unwrapEvent` still handles the wrapper
 *    shape in case a future layer build drops the property.
 * 2. The layer base64-encodes any response whose Content-Type is not `text/*`
 *    or `application/json`. Every body we return is a JSON string, so the
 *    default Content-Type here is `application/json`.
 *
 * Because the export is a Bun server object, `bun run src/lambda-bun.ts` also
 * serves the handler locally over HTTP with no Lambda involved.
 */

/** Where the event we are about to run came from. */
type EventOrigin = 'lambda-runtime' | 'local-server'

type LambdaRequestWrapper = {
  readonly event: unknown
  readonly requestId?: string
  readonly traceId?: string
  readonly functionArn?: string
  readonly deadlineMs?: number | null
}

function isWrapped(value: any): value is LambdaRequestWrapper {
  return (
    value !== null &&
    typeof value === 'object' &&
    'event' in value &&
    'requestId' in value
  )
}

function unwrapEvent(value: unknown): APIGatewayProxyEvent {
  return (isWrapped(value) ? value.event : value) as APIGatewayProxyEvent
}

/**
 * Rebuilds an API Gateway-shaped event from a plain `Request`, for local
 * `bun run` use. Only the fields `src/index.ts` reads are populated.
 */
function syntheticEvent(request: Request, body: string | null) {
  const url = new URL(request.url)

  return {
    path: url.pathname,
    rawPath: url.pathname,
    httpMethod: request.method,
    queryStringParameters: Object.fromEntries(url.searchParams),
    multiValueQueryStringParameters: null,
    pathParameters: null,
    headers: Object.fromEntries(request.headers),
    multiValueHeaders: {},
    body,
    isBase64Encoded: false,
    stageVariables: null,
    resource: url.pathname,
    requestContext: {},
  } as unknown as APIGatewayProxyEvent
}

function parseJson(body: string | null): unknown {
  if (!body) return null

  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

async function eventFor(
  request: Request,
): Promise<{ origin: EventOrigin; event: APIGatewayProxyEvent }> {
  // Set by the layer's `formatRequest`, for every event type it handles.
  const attached = (request as any).aws

  if (attached !== undefined) {
    return { origin: 'lambda-runtime', event: unwrapEvent(attached) }
  }

  const body = request.method === 'GET' ? null : await request.text()
  const parsed = parseJson(body)

  // No `.aws`, but a wrapper body still means the layer sent this — recover the
  // event rather than falling through to URL synthesis, which would drop the
  // action name and 404 every scheduled run.
  if (isWrapped(parsed)) {
    return { origin: 'lambda-runtime', event: unwrapEvent(parsed) }
  }

  return { origin: 'local-server', event: syntheticEvent(request, body) }
}

/**
 * The layer exposes the invocation metadata as request headers rather than as a
 * `Context`, so we rebuild the parts of `Context` a handler could reasonably
 * read. `src/index.ts` only forwards this to `instant`, which ignores it.
 */
function contextFor(request: Request): Context {
  const deadlineMs = Number(request.headers.get('x-amzn-deadline-ms') ?? 0)

  return {
    callbackWaitsForEmptyEventLoop: false,
    awsRequestId: request.headers.get('x-amzn-requestid') ?? 'local',
    invokedFunctionArn: request.headers.get('x-amzn-function-arn') ?? 'local',
    functionName: process.env['AWS_LAMBDA_FUNCTION_NAME'] ?? 'local',
    functionVersion: process.env['AWS_LAMBDA_FUNCTION_VERSION'] ?? '$LATEST',
    memoryLimitInMB: process.env['AWS_LAMBDA_FUNCTION_MEMORY_SIZE'] ?? '0',
    logGroupName: process.env['AWS_LAMBDA_LOG_GROUP_NAME'] ?? 'local',
    logStreamName: process.env['AWS_LAMBDA_LOG_STREAM_NAME'] ?? 'local',
    getRemainingTimeInMillis: () =>
      deadlineMs ? Math.max(0, deadlineMs - Date.now()) : 0,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  } as Context
}

function responseFor(result: APIGatewayProxyResult | void): Response {
  if (!result) {
    return new Response('', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const headers = new Headers({ 'Content-Type': 'application/json' })

  for (const [name, value] of Object.entries(result.headers ?? {})) {
    headers.set(name, `${value}`)
  }

  return new Response(result.body ?? '', {
    status: result.statusCode ?? 200,
    headers,
  })
}

export default {
  // Local Bun server only; archive reads can exceed Bun's 10-second idle default.
  idleTimeout: 90,
  async fetch(request: Request): Promise<Response> {
    if (shouldRouteToWeb(request)) return web.fetch(webRequest(request))

    const { origin, event } = await eventFor(request)

    if (origin === 'local-server') {
      console.log('[lambda-bun] local invocation', request.method, request.url)
    }

    const result = await handler(event, contextFor(request), () => {})

    return responseFor(result)
  },
}
