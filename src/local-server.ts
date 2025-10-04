import * as dotenv from 'dotenv'
dotenv.config()

// Force production DynamoDB usage
process.env.NODE_ENV = 'production'

import * as http from 'http'
import * as url from 'url'
import { handler } from './index'
import type { APIGatewayProxyEvent, Context } from 'aws-lambda'

const PORT = 3001

// Helper to convert Node.js request to Lambda event
async function nodeRequestToLambdaEvent(req: http.IncomingMessage): Promise<APIGatewayProxyEvent> {
  const parsedUrl = url.parse(req.url || '', true)
  
  // Read body if present
  let body = ''
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    body = await new Promise<string>((resolve) => {
      let data = ''
      req.on('data', chunk => data += chunk)
      req.on('end', () => resolve(data))
    })
  }

  return {
    httpMethod: req.method || 'GET',
    path: parsedUrl.pathname || '/',
    queryStringParameters: parsedUrl.query as any,
    headers: req.headers as any,
    body,
    isBase64Encoded: false,
    pathParameters: null,
    stageVariables: null,
    requestContext: null as any,
    resource: '',
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
  }
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  try {
    // Convert request to Lambda event
    const event = await nodeRequestToLambdaEvent(req)
    
    // Mock Lambda context
    const context: Context = {
      callbackWaitsForEmptyEventLoop: true,
      functionName: 'local',
      functionVersion: '1',
      invokedFunctionArn: 'local',
      memoryLimitInMB: '128',
      awsRequestId: Date.now().toString(),
      logGroupName: 'local',
      logStreamName: 'local',
      getRemainingTimeInMillis: () => 300000,
      done: () => {},
      fail: () => {},
      succeed: () => {},
    }

    // Call Lambda handler
    const result = await handler(event, context, () => {})
    
    if (!result) {
      res.writeHead(500)
      res.end('No response from handler')
      return
    }

    // Set CORS headers
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...result.headers,
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(200, headers)
      res.end()
      return
    }

    // Send response
    res.writeHead(result.statusCode, headers)
    
    if (result.isBase64Encoded && result.body) {
      res.end(Buffer.from(result.body, 'base64'))
    } else {
      res.end(result.body)
    }
  } catch (error) {
    console.error('Server error:', error)
    res.writeHead(500, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify({ error: 'Internal server error' }))
  }
})

server.listen(PORT, () => {
  console.log(`🚀 Local Lambda server running at http://localhost:${PORT}`)
  console.log(`   API endpoints available at http://localhost:${PORT}/api/*`)
  console.log(`   Make sure to start DynamoDB local if needed`)
})