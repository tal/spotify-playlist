---
name: Spotify Web API
description: This skill should be used when the user asks about "Spotify API", "Spotify Web API", "Spotify authentication", "Spotify OAuth", "Spotify access token", "get Spotify playlists", "control Spotify playback", "search Spotify", "Spotify rate limits", "Spotify scopes", or needs to interact with Spotify programmatically via REST API.
version: 0.1.0
---

# Spotify Web API Integration Guide

This skill provides comprehensive guidance for interacting with Spotify's Web API to retrieve content metadata, manage playlists, control playback, and access user data.

## Overview

The Spotify Web API enables programmatic access to Spotify's streaming service through a RESTful interface.

| Aspect | Details |
|--------|---------|
| Base URL | `https://api.spotify.com/v1` |
| Format | JSON request/response |
| Auth | OAuth 2.0 Bearer tokens |
| Rate Limits | Rolling 30-second window |

## Authentication

All API requests require an OAuth 2.0 access token in the Authorization header:

```
Authorization: Bearer <access_token>
```

### Authorization Flows

| Flow | Use Case | User Data | Refresh |
|------|----------|-----------|---------|
| Authorization Code | Server-side apps | Yes | Yes |
| Authorization Code + PKCE | Mobile/desktop/browser apps | Yes | Yes |
| Client Credentials | Backend services, no user context | No | No |

**Authorization Code Flow** - For server-side applications where client secret can be stored securely. User grants permission once.

**Authorization Code + PKCE** - For client-side applications where storing secrets is unsafe. Protects against authorization code interception.

**Client Credentials Flow** - For backend services accessing non-user endpoints only (search, public playlists, track metadata).

### Token Management

- Access tokens expire (typically 1 hour)
- Use refresh tokens to obtain new access tokens without user re-authorization
- Store tokens securely; never expose in client-side code or logs

## Core Endpoint Categories

### Content Metadata

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/albums/{id}` | GET | Get album details |
| `/artists/{id}` | GET | Get artist details |
| `/tracks/{id}` | GET | Get track details |
| `/search` | GET | Search across all content types |
| `/browse/categories` | GET | Get browse categories |
| `/browse/featured-playlists` | GET | Get featured playlists |

### User Library

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/me/tracks` | GET | Get user's saved tracks |
| `/me/tracks` | PUT | Save tracks to library |
| `/me/tracks` | DELETE | Remove tracks from library |
| `/me/albums` | GET | Get user's saved albums |
| `/me/playlists` | GET | Get user's playlists |

### Playlists

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/playlists/{id}` | GET | Get playlist details |
| `/playlists/{id}/tracks` | GET | Get playlist tracks |
| `/playlists/{id}/tracks` | POST | Add tracks to playlist |
| `/playlists/{id}/tracks` | DELETE | Remove tracks from playlist |
| `/users/{user_id}/playlists` | POST | Create playlist |

### Playback Control (Premium Required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/me/player` | GET | Get current playback state |
| `/me/player/currently-playing` | GET | Get currently playing track |
| `/me/player/play` | PUT | Start/resume playback |
| `/me/player/pause` | PUT | Pause playback |
| `/me/player/next` | POST | Skip to next track |
| `/me/player/previous` | POST | Skip to previous track |
| `/me/player/seek` | PUT | Seek to position |
| `/me/player/volume` | PUT | Set volume |
| `/me/player/shuffle` | PUT | Toggle shuffle |
| `/me/player/repeat` | PUT | Set repeat mode |
| `/me/player/queue` | POST | Add item to queue |

### User Profile

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/me` | GET | Get current user profile |
| `/me/top/artists` | GET | Get user's top artists |
| `/me/top/tracks` | GET | Get user's top tracks |
| `/me/player/recently-played` | GET | Get recently played tracks |

## OAuth Scopes

Request only the scopes needed for the application's functionality:

### Playback Scopes
- `user-read-playback-state` - Read player state
- `user-modify-playback-state` - Control playback
- `user-read-currently-playing` - Read current track
- `streaming` - Web Playback SDK (Premium)

### Library Scopes
- `user-library-read` - Read saved content
- `user-library-modify` - Save/remove content

### Playlist Scopes
- `playlist-read-private` - Read private playlists
- `playlist-read-collaborative` - Read collaborative playlists
- `playlist-modify-public` - Modify public playlists
- `playlist-modify-private` - Modify private playlists

### User Scopes
- `user-read-private` - Read subscription details
- `user-read-email` - Read email address
- `user-top-read` - Read top artists/tracks
- `user-read-recently-played` - Read listening history
- `user-follow-read` - Read followed artists
- `user-follow-modify` - Follow/unfollow artists

### Other Scopes
- `ugc-image-upload` - Upload playlist images

## Request/Response Patterns

### Pagination

Endpoints returning collections support offset-based pagination:

```
GET /me/tracks?offset=20&limit=50
```

- `offset` - Starting position (default: 0)
- `limit` - Number of items (default varies, max typically 50)

Response includes `next` and `previous` URLs for navigation.

### Timestamps

All timestamps use ISO 8601 format in UTC: `YYYY-MM-DDTHH:MM:SSZ`

### Error Handling

| Status | Meaning |
|--------|---------|
| 200 | Success with response body |
| 201 | Resource created |
| 204 | Success, no content |
| 400 | Bad request (malformed syntax) |
| 401 | Invalid/expired token |
| 403 | Request forbidden |
| 404 | Resource not found |
| 429 | Rate limited |
| 500-503 | Server errors |

Error response format:
```json
{
  "error": {
    "status": 401,
    "message": "The access token expired"
  }
}
```

## Rate Limits

Rate limits are calculated per rolling 30-second window. When exceeded, receive 429 response with `Retry-After` header.

### Best Practices

1. **Implement backoff-retry** - Use `Retry-After` header value
2. **Use batch endpoints** - `GET /albums?ids=id1,id2,id3` instead of multiple single requests
3. **Cache responses** - Use `ETag` and `If-None-Match` headers
4. **Use snapshot_id** - Reference playlist snapshots to avoid refetching unchanged data
5. **Lazy load** - Fetch data on user interaction, not upfront

### Extended Quota Mode

For applications with many concurrent users, apply for extended quota mode via the Spotify Developer Dashboard.

## Common Operations

### Search

```
GET /search?q=artist:radiohead&type=track&limit=10
```

Query modifiers: `album:`, `artist:`, `track:`, `year:`, `genre:`

### Get Multiple Items

```
GET /tracks?ids=id1,id2,id3
GET /albums?ids=id1,id2,id3
GET /artists?ids=id1,id2,id3
```

### Playlist Management

Add tracks (position optional):
```json
POST /playlists/{id}/tracks
{
  "uris": ["spotify:track:id1", "spotify:track:id2"],
  "position": 0
}
```

Remove tracks:
```json
DELETE /playlists/{id}/tracks
{
  "tracks": [{"uri": "spotify:track:id1"}]
}
```

Reorder tracks:
```json
PUT /playlists/{id}/tracks
{
  "range_start": 0,
  "range_length": 1,
  "insert_before": 5
}
```

## Spotify URIs and IDs

Resources are identified by:
- **Spotify URI**: `spotify:track:6rqhFgbbKwnb9MLmUQDhG6`
- **Spotify ID**: `6rqhFgbbKwnb9MLmUQDhG6`
- **HTTP URL**: `https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6`

Extract ID from URL: last path segment before query parameters.

## Additional Resources

### Reference Files

For detailed documentation, consult:
- **`references/endpoints-complete.md`** - Full endpoint reference with parameters
- **`references/authentication-flows.md`** - Step-by-step OAuth implementation
- **`references/scopes-complete.md`** - Complete scope descriptions

### Example Files

Working examples in `examples/`:
- **`curl-examples.sh`** - Common operations with curl
- **`auth-flow.md`** - Authorization code flow walkthrough

## Usage Policies

Per Spotify's terms:
- Content may not be downloaded or stored permanently
- Attribution required with links back to Spotify
- Commercial streaming applications prohibited without partnership
- AI model training on Spotify content prohibited
