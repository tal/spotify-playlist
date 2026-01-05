import { APIGatewayProxyHandler } from 'aws-lambda'
import { Spotify } from './spotify'
import { getDynamo } from './db/dynamo'
import { performActions } from './actions/action'
import { MagicPromoteAction } from './actions/magic-promote-action'
import { DemoteAction } from './actions/demote-action'
import { UndoAction } from './actions/undo-action'
import { ProcessPlaybackHistoryAction } from './actions/process-playback-history-action'
import { ArchiveAction } from './actions/archive-action'
import { settings } from './settings'

// Helper to create API responses with CORS headers
const createResponse = (statusCode: number, body: any) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  },
  body: JSON.stringify(body),
})

// Helper to get Spotify client for the user
async function getSpotifyClient() {
  const dynamo = await getDynamo('koalemos')
  if (!dynamo) throw new Error('User not found')

  const spotify = await Spotify.get(dynamo)
  return { spotify, dynamo }
}

// API handler for web endpoints
export const webApiHandler: APIGatewayProxyHandler = async (event) => {
  // Lambda Function URLs use rawPath, API Gateway uses path
  const path = (event as any).rawPath || event.path
  const httpMethod = (event as any).requestContext?.http?.method || event.httpMethod

  // Handle CORS preflight
  if (httpMethod === 'OPTIONS') {
    return createResponse(200, {})
  }

  try {
    // Route API requests
    if (path.startsWith('/api/')) {
      const apiPath = path.replace('/api/', '')

      switch (apiPath) {
        case 'health': {
          return createResponse(200, {
            status: 'ok',
            timestamp: new Date().toISOString(),
          })
        }

        case 'debug/env': {
          // Debug endpoint to check environment and credentials
          return createResponse(200, {
            nodeEnv: process.env.NODE_ENV,
            awsRegion: process.env.AWS_REGION,
            hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
            hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
            accessKeyPrefix: process.env.AWS_ACCESS_KEY_ID?.substring(0, 6) || 'none',
          })
        }

        case 'debug/event': {
          // Debug endpoint to inspect the event structure
          return createResponse(200, {
            path: event.path,
            rawPath: (event as any).rawPath,
            httpMethod: event.httpMethod,
            requestContext: (event as any).requestContext,
            pathParameters: event.pathParameters,
            queryStringParameters: event.queryStringParameters,
            rawQueryString: (event as any).rawQueryString,
          })
        }
        
        case 'debug/scan': {
          // Debug endpoint to scan the action_history table
          const { ScanCommand } = await import('@aws-sdk/lib-dynamodb')
          const { AWS } = await import('./aws')
          
          // Get query parameters for filtering
          const filterUser = event.queryStringParameters?.user || 'koalemos'
          const limitParam = event.queryStringParameters?.limit || '20'
          const limit = parseInt(limitParam)
          
          const params: any = {
            TableName: 'action_history',
            Limit: limit,
          }
          
          // Add filter for user if specified
          if (filterUser) {
            params.FilterExpression = 'begins_with(id, :prefix)'
            params.ExpressionAttributeValues = {
              ':prefix': filterUser + ':'
            }
          }
          
          const resp = await AWS.docs.send(new ScanCommand(params))
          
          // Sort by created_at descending
          const items = (resp.Items || []).sort((a: any, b: any) => b.created_at - a.created_at)
          
          return createResponse(200, { 
            count: items.length,
            scannedCount: resp.ScannedCount,
            items: items.map((item: any) => ({
              id: item.id,
              action: item.action,
              created_at: item.created_at,
              date: new Date(item.created_at).toISOString(),
              item: item.item,
              undone: item.undone,
            })),
          })
        }

        case 'dashboard': {
          const { spotify, dynamo } = await getSpotifyClient()
          const config = await settings()

          // Get current user and playlists
          const userId = await spotify.myID()
          const playlists = await spotify.allPlaylists()

          // // Log first playlist to see structure
          // if (playlists.length > 0) {
          //   console.log('Sample playlist structure:', JSON.stringify(playlists[0], null, 2))
          // }

          // Find key playlists
          const inbox = playlists.find((p) => p.name === config.inbox)
          const current = playlists.find((p) => p.name === config.current)
          const starred = playlists.find((p) => p.name === config.starred)

          // Get track counts (the types are incomplete, but the data is there)
          const inboxTracks = inbox ? (inbox as any).tracks?.total || 0 : 0
          const currentTracks = current
            ? (current as any).tracks?.total || 0
            : 0
          const starredTracks = starred
            ? (starred as any).tracks?.total || 0
            : 0

          // Get recent action history
          const recentActions = await dynamo.getRecentActionsOfType(
            '',
            Date.now() - 24 * 60 * 60 * 1000,
            10,
          )

          return createResponse(200, {
            user: {
              id: userId,
              display_name: userId,
              email: `${userId}@spotify.com`,
            },
            playlists: {
              inbox: inbox
                ? {
                    id: inbox.id,
                    name: inbox.name,
                    tracks: { total: inboxTracks },
                  }
                : null,
              current: current
                ? {
                    id: current.id,
                    name: current.name,
                    tracks: { total: currentTracks },
                  }
                : null,
              starred: starred
                ? {
                    id: starred.id,
                    name: starred.name,
                    tracks: { total: starredTracks },
                  }
                : null,
            },
            stats: {
              totalPlaylists: playlists.length,
              recentActionsCount: recentActions.length,
            },
            config,
          })
        }

        case 'actions/recent': {
          try {
            const { dynamo } = await getSpotifyClient()
            const limit = event.queryStringParameters?.limit
              ? parseInt(event.queryStringParameters.limit)
              : 20
            
            console.log(`Fetching recent actions with limit: ${limit}`)
            
            // Look back 7 days to avoid scanning too much data
            const lookbackMs = 7 * 24 * 60 * 60 * 1000
            const actions = await dynamo.getRecentActionsOfType(
              '',
              Date.now() - lookbackMs,
              limit,
            )
            
            console.log(`Found ${actions.length} actions`)
            
            // Log the first few actions for debugging
            if (actions.length > 0) {
              console.log('First action:', {
                id: actions[0].id,
                created_at: actions[0].created_at,
                date: new Date(actions[0].created_at).toISOString(),
                action: actions[0].action
              })
            }
            
            // If no actions found, return some sample data for demo
            if (false && actions.length === 0 && limit > 0) {
              const sampleActions = [
                {
                  id: 'koalemos:promote-track:sample1',
                  created_at: Date.now() - 1000 * 60 * 5, // 5 minutes ago
                  action: 'promote-track',
                  mutations: [],
                  item: {
                    id: '123',
                    name: 'Sample Song',
                    artist: 'Sample Artist',
                    album: 'Sample Album',
                  },
                },
                {
                  id: 'koalemos:demote-track:sample2',
                  created_at: Date.now() - 1000 * 60 * 15, // 15 minutes ago
                  action: 'demote-track',
                  mutations: [],
                  item: {
                    id: '456',
                    name: 'Another Song',
                    artist: 'Another Artist',
                    album: 'Another Album',
                  },
                },
                {
                  id: 'koalemos:archive:sample3',
                  created_at: Date.now() - 1000 * 60 * 60, // 1 hour ago
                  action: 'archive',
                  mutations: [],
                },
                {
                  id: 'koalemos:process-playback-history:sample4',
                  created_at: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
                  action: 'process-playback-history',
                  mutations: [],
                },
              ].slice(0, Math.min(limit, 4))
              
              console.log('Returning sample actions for demo')
              return createResponse(200, { actions: sampleActions })
            }

            return createResponse(200, { actions })
          } catch (error) {
            console.error('Error fetching recent actions:', error)
            return createResponse(200, { actions: [] }) // Return empty array on error
          }
        }

        case 'playlists': {
          const { spotify } = await getSpotifyClient()
          const playlists = await spotify.allPlaylists()

          return createResponse(200, {
            playlists: playlists.map((p) => ({
              id: p.id,
              name: p.name,
              tracks: { total: (p as any).tracks?.total || 0 },
              description: p.public ? 'Public playlist' : 'Private playlist',
              owner: p.owner,
            })),
          })
        }

        case 'tracks/current': {
          const { spotify } = await getSpotifyClient()

          try {
            const currentlyPlaying =
              await spotify.client.getMyCurrentPlaybackState()

            if (currentlyPlaying.body && currentlyPlaying.body.item) {
              const track = currentlyPlaying.body.item as any
              return createResponse(200, {
                playing: true,
                track: {
                  id: track.id,
                  name: track.name,
                  artists: track.artists.map((a: any) => a.name).join(', '),
                  album: track.album.name,
                  uri: track.uri,
                },
                progress_ms: currentlyPlaying.body.progress_ms,
                is_playing: currentlyPlaying.body.is_playing,
              })
            } else {
              return createResponse(200, { playing: false })
            }
          } catch (error) {
            return createResponse(200, {
              playing: false,
              error: 'Could not get current track',
            })
          }
        }

        default:
          // Handle POST actions
          if (httpMethod === 'POST' && apiPath.startsWith('actions/')) {
            const actionType = apiPath.replace('actions/', '')
            const { spotify, dynamo } = await getSpotifyClient()

            let action
            switch (actionType) {
              case 'promote':
                action = new MagicPromoteAction(spotify)
                break
              case 'demote':
                action = new DemoteAction(spotify)
                break
              case 'archive':
                action = new ArchiveAction(spotify)
                break
              case 'process-playback':
                action = new ProcessPlaybackHistoryAction(spotify, dynamo.user)
                break
              case 'undo':
                const body = event.body ? JSON.parse(event.body) : {}
                action = new UndoAction(spotify, dynamo, {
                  actionId: body.actionId,
                  actionType: body.actionType,
                })
                break
              default:
                return createResponse(400, {
                  error: `Unknown action: ${actionType}`,
                })
            }

            const result = await performActions(dynamo, spotify, action)
            return createResponse(200, { result })
          }

          return createResponse(404, { error: 'Not found' })
      }
    }

    return createResponse(404, { error: 'Not found' })
  } catch (error) {
    console.error('API error:', error)
    return createResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
