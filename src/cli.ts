#!/usr/bin/env node
import notifier from 'node-notifier'
import path from 'path'
import { exit } from 'process'

if (require.main !== module) {
  throw 'Cannot require this module, must call directly'
}

var jsonPayload = {
  path: '/test/hello',
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
}

let action = process.argv[process.argv.length - 1]

if (!action || action.match(/\/.+\.[tj]s/)) {
  action = 'instant'
}

if (!(action in options)) {
  throw `"${action}" cannot be run`
}

const event = {
  ...jsonPayload,
  ...(options as any)[action],
}

import lambdaLocal = require('lambda-local')

async function main() {
  try {
    const result = (await lambdaLocal.execute({
      event,
      lambdaPath: path.join(__dirname, '../dist/index.js'),
      profilePath: '~/.aws/credentials',
      profileName: 'default',
      verboseLevel: 0,
      timeoutMs: 150000,
      envfile: path.join(__dirname, '../.env'),
      lambdaHandler: 'handler',
    })) as { body: string; statusCode: number }

    const body = JSON.parse(result.body)
    const results = body.result

    console.log(result)

    notifier.notify({
      title: `Success for ${action}`,
      message: results[0].reason,
    })
  } catch (err) {
    console.error(err)
    notifier.notify({
      title: `Error for ${action}`,
      message: `${JSON.stringify(err)}`,
    })
  }
}

main()
