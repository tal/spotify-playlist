# API Gateway URL Reference

## Your Working API Gateway URL

```
https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=${actionName}
```

## Status: ✅ WORKING

All fixes applied to support both:
- ✅ API Gateway (your existing URL)
- ✅ Lambda Function URL (new alternative)

## Usage Examples

### Track Triage Actions

```bash
# Promote current track
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=promote"

# Demote current track
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=demote"

# Promote and skip to next track
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=promotes"

# Promote with optional skip parameter
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=promote&and-skip=true"
```

### Undo Actions

```bash
# Undo last promote/demote (within 5 minutes)
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=undo-last"

# Undo specific action by ID
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=undo&action-id=koalemos:promote-track:1759597419732"

# Undo most recent promote (within 24 hours)
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=undo&action-type=promote"
```

### Playlist Management

```bash
# Archive confirmed tracks by month
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=archive"

# Process playback history
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=playback"

# Auto inbox (playback + scan playlists)
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=auto-inbox"

# Create rule playlists (starred tracks, etc)
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=rule-playlist"

# Handle specific playlist
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=handle-playlist&playlist-name=Modern%20Funk%3F%20%5BA%5D"

# Run all maintenance tasks
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=frequent-crawling"
```

### User & System Info

```bash
# Get user info and Spotify tokens
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=user"

# Sync liked songs to cache
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=sync-liked-songs"

# Get liked songs cache stats
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=liked-songs-stats"

# Clear liked songs cache
curl "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=clear-liked-cache"
```

## Available Actions

All 20 actions work with your API Gateway URL:

**Track Triage:**
- `promote` - Promote current track to next stage
- `demote` - Demote current track to previous stage
- `promotes` - Promote and skip to next track
- `demotes` - Demote and skip to next track
- `undo` - Undo specific action by ID or type
- `undo-last` - Undo most recent promote/demote

**Playlist Management:**
- `archive` - Archive confirmed tracks by month
- `playback` - Process playback history
- `auto-inbox` - Auto inbox scan and playback processing
- `rule-playlist` - Create smart playlists
- `handle-playlist` - Handle specific playlist (requires `playlist-name` param)
- `handle-known-playlists` - Process predefined playlists
- `handle-playlists` - Process all playlists

**Maintenance:**
- `frequent-crawling` - Run all maintenance tasks
- `sync-liked-songs` - Sync liked songs to cache
- `liked-songs-stats` - Get cache statistics
- `clear-liked-cache` - Clear cache

**User Info:**
- `user` - Get user info and Spotify tokens

## Tested and Working ✅

**Verified Actions:**
- ✅ `action=user` - Returns user data with Spotify tokens
- ✅ `action=archive` - Successfully archives tracks
- ✅ `action=playback` - Processes playback history

**Response Format:**
```json
{
  "result": [
    {
      "reason": "success",
      "value": {
        "action_name": "archive:1759602059566",
        "action_type": "archive"
      }
    }
  ]
}
```

## Error Responses

### No Currently Playing Track (for promote/demote)
```json
{
  "message": "Internal server error"
}
```
*Note: Check CloudWatch logs for specific error details*

### Invalid Action
```json
{
  "error": "no action for invalid-action",
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

## Alternative Access Methods

Your Lambda function now supports **two** URL formats:

### 1. API Gateway (Your Existing URL) ✅
```bash
# Query parameter format
https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev?action=${actionName}
```

### 2. Lambda Function URL (New Alternative)
```bash
# Query parameter format
https://d5vtfkftttoinc6cy7apdt2tom0hujfb.lambda-url.us-east-1.on.aws/?action=${actionName}

# Path-based format (Function URL only)
https://d5vtfkftttoinc6cy7apdt2tom0hujfb.lambda-url.us-east-1.on.aws/${actionName}
```

Both URLs access the same Lambda function and work identically.

## Implementation Details

The Lambda handler (`src/index.ts`) automatically detects the event source:
- API Gateway events use `event.path` and `event.httpMethod`
- Lambda Function URL events use `event.rawPath` and `event.requestContext.http.method`

The code handles both transparently:
```typescript
const requestPath = (ev as any).rawPath || ev.path
const httpMethod = (ev as any).requestContext?.http?.method || ev.httpMethod
```

## Integration Examples

### Shell Script
```bash
#!/bin/bash
BASE_URL="https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev"

# Promote current track
curl -s "$BASE_URL?action=promote"

# Archive tracks
curl -s "$BASE_URL?action=archive"

# Process playback history
curl -s "$BASE_URL?action=playback"
```

### Python
```python
import requests

BASE_URL = "https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev"

def call_action(action_name, **params):
    params['action'] = action_name
    response = requests.get(BASE_URL, params=params)
    return response.json()

# Examples
user_data = call_action('user')
archive_result = call_action('archive')
promote_result = call_action('promote', **{'and-skip': 'true'})
```

### JavaScript/Node.js
```javascript
const BASE_URL = 'https://ovgepxasb9.execute-api.us-east-1.amazonaws.com/dev/spotify-playlist-dev';

async function callAction(actionName, params = {}) {
  const url = new URL(BASE_URL);
  url.searchParams.set('action', actionName);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url);
  return response.json();
}

// Examples
const userData = await callAction('user');
const archiveResult = await callAction('archive');
const promoteResult = await callAction('promote', { 'and-skip': 'true' });
```

## Notes

- All actions use the same query parameter format: `?action=${actionName}`
- Additional parameters can be added: `?action=promote&and-skip=true`
- No authentication required (uses hardcoded user: `koalemos`)
- Action throttling prevents duplicate operations within 5 minutes
- All operations are logged to CloudWatch: `/aws/lambda/spotify-playlist-dev`
