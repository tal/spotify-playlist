# HTTP API Guide

## Base URL
```
https://d5vtfkftttoinc6cy7apdt2tom0hujfb.lambda-url.us-east-1.on.aws
```

## Action Endpoints

Actions can be invoked in two ways:
1. **Path-based**: `/{action-name}`
2. **Query parameter**: `/?action={action-name}`

Both methods work identically.

## Available Actions

### Track Triage Actions

#### Promote Current Track
Promotes the currently playing track to the next stage (Inbox → Current → Confirmed).

**Endpoints:**
- `GET /promote`
- `GET /?action=promote`

**Query Parameters:**
- `and-skip` (optional): Skip to next track after promoting

**Response:**
```json
{
  "result": [
    {
      "reason": "success",
      "value": {
        "action_name": "promote-track:1759597419732",
        "action_type": "promote-track"
      }
    }
  ]
}
```

#### Demote Current Track
Demotes the currently playing track to the previous stage.

**Endpoints:**
- `GET /demote`
- `GET /?action=demote`

**Query Parameters:**
- `and-skip` (optional): Skip to next track after demoting

#### Promote and Skip
Promotes current track and immediately skips to the next track.

**Endpoint:** `GET /promotes`

#### Demote and Skip
Demotes current track and immediately skips to the next track.

**Endpoint:** `GET /demotes`

### Undo Actions

#### Undo Last Action
Undos the most recent promote or demote action (within last 5 minutes).

**Endpoints:**
- `GET /undo-last`
- `GET /?action=undo-last`

**Response:**
```json
{
  "result": [
    {
      "reason": "success",
      "value": {
        "action_name": "undo:1759597500000",
        "action_type": "undo",
        "undid_action_id": "koalemos:promote-track:1759597400000"
      }
    }
  ]
}
```

#### Undo Specific Action
Undos a specific action by ID or type.

**Endpoints:**
- `GET /undo?action-id={action-id}`
- `GET /undo?action-type=promote` (finds most recent promote within 24 hours)
- `GET /undo?action-type=demote` (finds most recent demote within 24 hours)

### Playlist Management Actions

#### Archive Confirmed Tracks
Archives confirmed tracks by month (e.g., "Archive 2025-01").

**Endpoints:**
- `GET /archive`
- `GET /?action=archive`

**Response:**
```json
{
  "result": [
    {
      "reason": "success",
      "value": {
        "action_name": "archive:1759597419732",
        "action_type": "archive"
      }
    }
  ]
}
```

#### Process Playback History
Processes Spotify listening history and updates track metadata.

**Endpoint:** `GET /playback`

#### Auto Inbox
Scans playlists for inbox and processes playback history.

**Endpoint:** `GET /auto-inbox`

#### Rule Playlist
Creates smart playlists based on rules (e.g., starred tracks).

**Endpoint:** `GET /rule-playlist`

#### Handle Specific Playlist
Performs actions on a specific playlist.

**Endpoint:** `GET /handle-playlist?playlist-name={name}`

**Example:**
```
GET /handle-playlist?playlist-name=Modern%20Funk%3F%20%5BA%5D
```

#### Handle Known Playlists
Processes a predefined set of playlists.

**Endpoint:** `GET /handle-known-playlists`

#### Handle All Playlists
Processes all user playlists.

**Endpoint:** `GET /handle-playlists`

### Maintenance Actions

#### Frequent Crawling
Runs multiple maintenance tasks: archive, playback history, manual triage, inbox scan, rule playlists.

**Endpoint:** `GET /frequent-crawling`

#### Sync Liked Songs
Syncs Spotify liked songs to cache.

**Endpoint:** `GET /sync-liked-songs`

**Response:**
```json
{
  "message": "Liked songs synced successfully",
  "result": {
    "cached": 1234,
    "syncTime": 5000
  }
}
```

#### Liked Songs Stats
Gets cache statistics for liked songs.

**Endpoint:** `GET /liked-songs-stats`

**Response:**
```json
{
  "metadata": {
    "totalTracks": 1234,
    "lastSyncedAt": 1759597419732
  },
  "sampleTracks": [...],
  "cacheAge": "15 minutes"
}
```

#### Clear Liked Cache
Clears the liked songs cache.

**Endpoint:** `GET /clear-liked-cache`

### User Information

#### Get User Info
Returns current user information including Spotify auth tokens.

**Endpoints:**
- `GET /user`
- `GET /?action=user`

**Response:**
```json
{
  "user": {
    "id": "koalemos",
    "lastPlayedAtProcessedTimestamp": 1759543868844,
    "spotifyAuth": {
      "accessToken": "BQBah4mh...",
      "expiresAt": 1759586191353,
      "refreshToken": "AQBV..."
    }
  }
}
```

## Web Dashboard API

The following endpoints provide data for the web frontend.

### Health Check
**Endpoint:** `GET /api/health`

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-04T17:00:00.000Z"
}
```

### Dashboard
**Endpoint:** `GET /api/dashboard`

**Response:**
```json
{
  "user": {
    "id": "koalemos",
    "display_name": "koalemos",
    "email": "koalemos@spotify.com"
  },
  "playlists": {
    "inbox": {
      "id": "60kSUJpjpMy48yHxTR5w8a",
      "name": "Inbox",
      "tracks": { "total": 149 }
    },
    "current": {
      "id": "4Hdywzi2hPE6RLa71kx227",
      "name": "Current",
      "tracks": { "total": 33 }
    },
    "starred": {
      "id": "64MuRHbFDWUWr41UYfTOf5",
      "name": "Starred",
      "tracks": { "total": 1672 }
    }
  },
  "stats": {
    "totalPlaylists": 249,
    "recentActionsCount": 5
  },
  "config": {
    "inbox": "Inbox",
    "current": "Current",
    "starred": "Starred",
    "timeToArchive": 2592000000
  }
}
```

### All Playlists
**Endpoint:** `GET /api/playlists`

**Response:**
```json
{
  "playlists": [
    {
      "id": "477x9GOlZFvcEUAqcVOKhL",
      "name": "Child Indoctrination",
      "tracks": { "total": 12 },
      "description": "Public playlist",
      "owner": { "id": "koalemos", "display_name": "Tal Atlas" }
    },
    ...
  ]
}
```

### Current Track
**Endpoint:** `GET /api/tracks/current`

**Response (when playing):**
```json
{
  "playing": true,
  "track": {
    "id": "07UhkkoVZLfX0khL5UzpoZ",
    "name": "A Little Too High",
    "artists": "The Black Keys",
    "album": "No Rain, No Flowers",
    "uri": "spotify:track:07UhkkoVZLfX0khL5UzpoZ"
  },
  "progress_ms": 45000,
  "is_playing": true
}
```

**Response (when not playing):**
```json
{
  "playing": false
}
```

### Recent Actions
**Endpoint:** `GET /api/actions/recent?limit={limit}`

**Parameters:**
- `limit` (optional, default: 20): Number of actions to return

**Response:**
```json
{
  "actions": [
    {
      "id": "koalemos:archive:1759585507178",
      "action": "archive",
      "created_at": 1759585507178,
      "mutations": []
    },
    {
      "id": "koalemos:promote-track:1759434250000",
      "action": "promote-track",
      "created_at": 1759434250000,
      "mutations": [
        {
          "type": "mutation",
          "mutationType": "add-tracks",
          "data": { ... }
        }
      ]
    }
  ]
}
```

### Trigger Actions via POST
**Endpoint:** `POST /api/actions/{action}`

**Available actions:**
- `promote`
- `demote`
- `archive`
- `process-playback`
- `undo`

**Request Body (for undo):**
```json
{
  "actionId": "koalemos:promote-track:1759434250000",
  "actionType": "promote"
}
```

**Response:**
```json
{
  "result": [
    {
      "reason": "success",
      "value": { ... }
    }
  ]
}
```

## Debug Endpoints

### Environment Info
**Endpoint:** `GET /api/debug/env`

**Response:**
```json
{
  "nodeEnv": "prod",
  "awsRegion": "us-east-1",
  "hasAccessKey": true,
  "hasSecretKey": true,
  "accessKeyPrefix": "ASIAXG"
}
```

### Event Structure
**Endpoint:** `GET /api/debug/event`

Shows the raw Lambda event structure for debugging.

### DynamoDB Scan
**Endpoint:** `GET /api/debug/scan?user={userId}&limit={limit}`

**Parameters:**
- `user` (optional, default: "koalemos"): User ID to filter
- `limit` (optional, default: 20): Number of items to return

Scans the action_history table for debugging.

## Error Responses

### Action Not Found
```json
{
  "error": "no action for archive-invalid",
  "statusCode": 404
}
```

### Missing Required Parameter
```json
{
  "error": "must provide playlist-name",
  "statusCode": 400
}
```

### Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "The security token included in the request is invalid.",
  "statusCode": 500
}
```

## CORS

All API endpoints support CORS with the following configuration:
- **AllowOrigins**: `*`
- **AllowMethods**: `*`
- **AllowHeaders**: `*`
- **MaxAge**: 86400 seconds

## Authentication

Currently, all endpoints are publicly accessible with no authentication. The system uses a hardcoded user ID (`koalemos`) for all operations.

## Rate Limiting

No explicit rate limiting is configured. AWS Lambda concurrency limits apply.

## Notes

- All timestamps are in Unix milliseconds
- Action throttling prevents duplicate operations within 5 minutes for promote/demote
- The system maintains action history in DynamoDB for undo support
- Spotify API rate limits may apply to some operations
