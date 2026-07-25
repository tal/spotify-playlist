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
