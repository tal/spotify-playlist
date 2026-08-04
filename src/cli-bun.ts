#!/usr/bin/env bun

require('./-run-this-first')

import { exit } from 'process'
import { buildCliEvent, parseCliArgs } from './cli-event'
import { handler } from './index'

const { action, useServer } = parseCliArgs(process.argv.slice(2))
const event = buildCliEvent(action)

const context = {
  callbackWaitsForEmptyEventLoop: true,
  functionName: 'spotify-playlist-local',
  functionVersion: '$LATEST',
  invokedFunctionArn:
    'arn:aws:lambda:us-east-1:123456789012:function:spotify-playlist-local',
  memoryLimitInMB: '512',
  awsRequestId: 'local-request-id-' + Date.now(),
  logGroupName: '/aws/lambda/spotify-playlist-local',
  logStreamName: '2024/01/01/[$LATEST]abcdef1234567890',
  getRemainingTimeInMillis: () => 150000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
}

if (useServer) {
  const server = Bun.serve({
    port: 3001,
    async fetch(req: Request) {
      const url = new URL(req.url)

      // Dotted paths (for example /favicon.ico) are never actions.
      if (url.pathname.includes('.')) {
        return Response.json({ error: 'not found' }, { status: 404 })
      }

      const queryStringParameters = Object.fromEntries(url.searchParams)
      const requestEvent = {
        ...buildCliEvent('instant'),
        path: url.pathname,
        rawPath: url.pathname,
        httpMethod: req.method,
        queryStringParameters,
        pathParameters: {
          action: url.pathname.slice(1) || 'instant',
        },
      }

      try {
        console.log(`[Server] Handling ${req.method} ${url.pathname}`)
        const result = await handler(
          requestEvent as any,
          context as any,
          () => {},
        )

        if (!result) {
          return Response.json({ message: 'No response' })
        }

        return new Response(result.body, {
          status: result.statusCode,
          headers: {
            'Content-Type': 'application/json',
            ...result.headers,
          },
        })
      } catch (error) {
        console.error('[Server] Error:', error)
        return Response.json({ error: String(error) }, { status: 500 })
      }
    },
  })

  console.log(`Bun server running at http://localhost:${server.port}`)
  console.log(`
Available endpoints:
  http://localhost:${server.port}/promote
  http://localhost:${server.port}/demote
  http://localhost:${server.port}/archive
  http://localhost:${server.port}/playback
  http://localhost:${server.port}/undo

Add query parameters as needed, for example:
  http://localhost:${server.port}/promote?and-skip=true
  `)
} else {
  async function main() {
    try {
      console.log(`Running action: ${action}`)
      const startTime = Date.now()
      const result = await handler(event as any, context as any, () => {})

      console.log(`Execution time: ${Date.now() - startTime}ms`)

      if (!result) {
        console.log('No response from handler')
        return
      }

      if (result.statusCode !== 200) {
        throw new Error(JSON.stringify(result))
      }

      // Pretty-print read-only reports such as listen-stats and user.
      console.log(JSON.stringify(JSON.parse(result.body), null, 2))
    } catch (error) {
      console.error(error)
      exit(1)
    }
  }

  main().catch((error) => {
    console.error(`error in main ${error}`)
    exit(1)
  })
}
