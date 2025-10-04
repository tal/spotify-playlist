#!/usr/bin/env bun
// Initialize globals first (sets up dev, minutes, hours, etc.)
require('./-run-this-first')

import notifier from 'node-notifier'
import path from 'path'
import { exit } from 'process'
import dotenv from 'dotenv'

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') })

// Import the handler directly - no compilation needed with Bun!
import { handler } from './index'

// Default Lambda event structure  
const jsonPayload = {
  path: '/action.lambda',  // Path with dot to skip static file serving
  headers: {
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, lzma, sdch, br',
    'Accept-Language': 'en-US,en;q=0.8',
    'CloudFront-Forwarded-Proto': 'https',
    'CloudFront-Is-Desktop-Viewer': 'true',
    'CloudFront-Is-Mobile-Viewer': 'false',
    'CloudFront-Is-SmartTV-Viewer': 'false',
    'CloudFront-Is-Tablet-Viewer': 'false',
    'CloudFront-Viewer-Country': 'US',
    Host: 'wt6mne2s9k.execute-api.us-west-2.amazonaws.com',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.82 Safari/537.36 OPR/39.0.2256.48',
    Via: '1.1 fb7cca60f0ecd82ce07790c9c5eef16c.cloudfront.net (CloudFront)',
    'X-Amz-Cf-Id': 'nBsWBOrSHMgnaROZJK1wGCZ9PcRcSpq_oSXZNQwQ10OTZL4cimZo3g==',
    'X-Forwarded-For': '192.168.100.1, 192.168.1.1',
    'X-Forwarded-Port': '443',
    'X-Forwarded-Proto': 'https',
  },
  pathParameters: {
    proxy: 'hello',
  },
  requestContext: {
    accountId: '123456789012',
    resourceId: 'us4z18',
    stage: 'test',
    requestId: '41b45ea3-70b5-11e6-b7bd-69b5aaebc7d9',
    identity: {
      cognitoIdentityPoolId: '',
      accountId: '',
      cognitoIdentityId: '',
      caller: '',
      apiKey: '',
      sourceIp: '192.168.100.1',
      cognitoAuthenticationType: '',
      cognitoAuthenticationProvider: '',
      userArn: '',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.82 Safari/537.36 OPR/39.0.2256.48',
      user: '',
    },
    resourcePath: '/{proxy+}',
    httpMethod: 'GET',
    apiId: 'wt6mne2s9k',
  },
  resource: '/{proxy+}',
  httpMethod: 'GET',
  queryStringParameters: {},
  stageVariables: {
    stageVarName: 'stageVarValue',
  },
}

const options = {
  archive: {
    pathParameters: {
      action: 'archive',
    },
    queryStringParameters: {},
  },
  promote: {
    pathParameters: {
      action: 'promote',
    },
  },
  promotes: {
    pathParameters: {
      action: 'promote',
    },
    queryStringParameters: {
      'and-skip': 'true',
    },
  },
  demote: {
    pathParameters: {
      action: 'demote',
    },
  },
  'rule-playlist': {
    pathParameters: {
      action: 'rule-playlist',
    },
    queryStringParameters: {
      rule: 'smart',
    },
  },
  demotes: {
    pathParameters: {
      action: 'demote',
    },
    queryStringParameters: {
      'and-skip': 'true',
    },
  },
  'neo-tribal': {
    pathParameters: {
      action: 'handle-playlist',
    },
    queryStringParameters: {
      'playlist-name': 'Neo Tribal [A]',
    },
  },
  scandinavian: {
    pathParameters: {
      action: 'handle-playlist',
    },
    queryStringParameters: {
      'playlist-name': 'Scandanavian Women [A]',
    },
  },
  'known-playlists': {
    pathParameters: {
      action: 'handle-known-playlists',
    },
    queryStringParameters: {},
  },
  'all-playlists': {
    pathParameters: {
      action: 'handle-playlists',
    },
    queryStringParameters: {},
  },
  instant: {
    pathParameters: {
      action: 'instant',
    },
  },
  playback: {
    pathParameters: {
      action: 'playback',
    },
  },
  'auto-inbox': {
    pathParameters: {
      action: 'auto-inbox',
    },
  },
  user: {
    pathParameters: {
      action: 'user',
    },
  },
  undo: {
    pathParameters: {
      action: 'undo',
    },
    queryStringParameters: {},
  },
  'undo-last': {
    pathParameters: {
      action: 'undo-last',
    },
    queryStringParameters: {},
  },
}

// Parse command line arguments
let action = process.argv[process.argv.length - 1]

if (!action || action.match(/\/.+\.[tj]s/)) {
  action = 'instant'
}

if (!(action in options)) {
  throw `"${action}" cannot be run`
}

// Build the Lambda event
const event = {
  ...jsonPayload,
  ...(options as any)[action],
}

// Mock Lambda context
const context = {
  callbackWaitsForEmptyEventLoop: true,
  functionName: 'spotify-playlist-local',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:spotify-playlist-local',
  memoryLimitInMB: '128',
  awsRequestId: 'local-request-id-' + Date.now(),
  logGroupName: '/aws/lambda/spotify-playlist-local',
  logStreamName: '2024/01/01/[$LATEST]abcdef1234567890',
  getRemainingTimeInMillis: () => 150000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
}

// Option to run with Bun server for interactive testing
const useServer = process.argv.includes('--server')

if (useServer) {
  // Run as a local server for interactive testing
  const server = Bun.serve({
    port: 3001,
    async fetch(req: Request) {
      const url = new URL(req.url)
      
      // Parse action from URL path
      const actionFromPath = url.pathname.slice(1) || 'instant'
      
      // Parse query parameters
      const queryParams: Record<string, string> = {}
      url.searchParams.forEach((value, key) => {
        queryParams[key] = value
      })
      
      // Build event for this request
      const requestEvent = {
        ...jsonPayload,
        path: url.pathname,
        queryStringParameters: Object.keys(queryParams).length > 0 ? queryParams : {},
        pathParameters: {
          action: actionFromPath,
        },
        httpMethod: req.method,
      }
      
      try {
        console.log(`[Server] Handling ${req.method} ${url.pathname}`)
        const result = await handler(requestEvent as any, context as any, () => {})
        
        if (!result) {
          return new Response(JSON.stringify({ message: 'No response' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
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
        return new Response(JSON.stringify({ error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    },
  })
  
  console.log(`🚀 Bun server running at http://localhost:${server.port}`)
  console.log(`
Available endpoints:
  http://localhost:${server.port}/instant
  http://localhost:${server.port}/promote
  http://localhost:${server.port}/demote
  http://localhost:${server.port}/archive
  http://localhost:${server.port}/playback
  http://localhost:${server.port}/undo
  
Add query parameters as needed, e.g.:
  http://localhost:${server.port}/promote?and-skip=true
  `)
} else {
  // Run as a single command execution
  async function main() {
    try {
      console.log(`Running action: ${action}`)
      console.log('Event path:', event.path)
      console.log('Event pathParameters:', event.pathParameters)
      const startTime = Date.now()
      
      // Call the handler directly - no compilation needed!
      const result = await handler(event as any, context as any, () => {})
      
      const duration = Date.now() - startTime
      console.log(`\nExecution time: ${duration}ms`)
      
      if (!result) {
        console.log('No response from handler')
        return
      }
      
      if (result.statusCode != 200) {
        throw `error2 ${JSON.stringify(result)}`
      }
      
      const body = JSON.parse(result.body)
      const results = body.result
      
      console.log(JSON.stringify(result))
      
      // Uncomment to enable notifications
      // notifier.notify({
      //   title: `Success for ${JSON.stringify(action)}`,
      //   message: results[0].reason,
      // })
    } catch (err) {
      console.error(err)
      // notifier.notify({
      //   title: `Error for ${action}`,
      //   message: `${JSON.stringify(err)}`,
      // })
      exit(1)
    }
  }
  
  main().catch((err) => {
    console.error(`error in main ${err}`)
    exit(1)
  })
}