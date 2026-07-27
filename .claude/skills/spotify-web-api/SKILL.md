---
name: spotify-web-api
description: This skill should be used when the user asks about "Spotify API", "Spotify Web API", "Spotify authentication", "Spotify OAuth", "Spotify access token", "get Spotify playlists", "control Spotify playback", "search Spotify", "Spotify rate limits", "Spotify scopes", or needs to interact with Spotify programmatically via REST API.
---

# Spotify Web API Integration Guide

This skill provides comprehensive guidance for interacting with Spotify's Web API to retrieve content metadata, manage playlists, control playback, and access user data.

## Contents

- Overview
- Authentication
- Core Endpoint Categories
- OAuth Scopes
- Request/Response Patterns
- Rate Limits
- Common Operations
- Spotify URIs and IDs
- Additional Resources
- Usage Policies

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

**Redirect URI requirements** - All redirect URIs must use HTTPS, except loopback addresses, which may use HTTP. The hostname `localhost` is rejected; use the IP literal `http://127.0.0.1:PORT/callback` or `http://[::1]:PORT/callback`. Loopback URIs may be registered without a port and supply it at authorization time. Matching is exact, including case and trailing slash.

### Token Management

- Access tokens expire (typically 1 hour); refresh them with `grant_type=refresh_token`
- Refresh tokens also expire: tokens issued to Developer Dashboard apps have a 6-month lifetime (Authorization Code and PKCE flows; Client Credentials issues no refresh token)
- Refreshing an access token does NOT extend the refresh token's lifetime — the clock runs from the user's original authorization, and only a fresh user authorization resets it
- Refresh tokens carry no issuance timestamp, so record the authorization time and schedule re-authorization before the 6-month deadline
- On expiry or revocation the token endpoint returns `400` with `{"error": "invalid_grant"}`. Do not retry — discard the stored token and send the user through the authorization flow again
- A refresh response may include a rotated `refresh_token`; persist it when present, otherwise keep the existing one
- Store tokens securely; never expose in client-side code or logs

## Core Endpoint Categories

`references/endpoints-complete.md` holds the full tables — exact path, method, query parameters, and the required OAuth scope for every endpoint (only that file carries the scope column). Use this map to jump to the right section of it.

| Area | Common endpoints | Section |
|------|------------------|---------|
| Albums | `/albums/{id}`, `/albums/{id}/tracks`, `GET /me/albums` | Albums |
| Artists | `/artists/{id}`, `/artists/{id}/albums` | Artists |
| Tracks | `/tracks/{id}`, `GET /me/tracks` | Tracks |
| Playlists | `/playlists/{id}`, `/playlists/{id}/items`, `GET`/`POST /me/playlists`, `/playlists/{id}/images` | Playlists |
| Search | `/search` | Search |
| Player (Premium) | `/me/player`, `/me/player/currently-playing`, `/me/player/{play,pause,next,previous,seek,volume,shuffle,repeat,queue}`, `/me/player/recently-played` | Player |
| User profile | `/me`, `/me/top/artists`, `/me/top/tracks`, `GET /me/following` | Users |
| Library writes | `PUT`/`DELETE /me/library`, `GET /me/library/contains` (saves and follows for every content type) | Library |
| Shows & podcasts | `/shows/{id}`, `/shows/{id}/episodes`, `/episodes/{id}`, `GET /me/shows` | Shows & Episodes (Podcasts) |
| Audiobooks | `/audiobooks/{id}`, `/audiobooks/{id}/chapters`, `/chapters/{id}` | Audiobooks |
| Browse | `/browse/categories`, `/browse/categories/{id}`, `/browse/new-releases` (Extended Quota Mode) | Categories |
| Genres | `/recommendations/available-genre-seeds` (legacy, restricted) | Genres |
| Markets | `/markets` (Extended Quota Mode) | Markets |

See Quota Modes below for which of these an app can actually call.

## OAuth Scopes

Request only the scopes needed for the application's functionality.

Scopes fall into families: playback and Spotify Connect (read player state, control playback, `streaming` for the Web Playback SDK), library (read and modify saved content), playlists (read private and collaborative, modify public and private), follow (read and modify followed artists and users), listening history (top items, recently played), user profile (subscription details, email), and image upload for playlist covers.

`references/scopes-complete.md` maps each scope to the exact endpoints it unlocks, covers the partner-only `soa-*` scopes, and lists ready-made scope bundles for common app types in its "Scope Combinations" section. Read it when picking a minimal scope set or diagnosing a 403.

## Request/Response Patterns

### Pagination

Most collection endpoints use offset-based pagination:

```
GET /me/tracks?offset=20&limit=50
```

- `offset` - Starting position (default: 0)
- `limit` - Number of items (default varies, max typically 50; `/search` is capped lower — see Search below)

Response includes `next` and `previous` URLs for navigation.

A few endpoints are **cursor-based** instead: they reject `offset` and return a `cursors` object rather than `offset`/`previous`.

| Endpoint | Cursor params |
|----------|---------------|
| `GET /me/player/recently-played` | `before` / `after` (Unix ms timestamps; mutually exclusive) |
| `GET /me/following?type=artist` | `after` (last artist ID from the previous page) |

Paginate these by feeding `cursors.before` (or `cursors.after`) from the response into the next request, or by following `next` until it is `null`. `total` is absent or unreliable on cursor endpoints, so bound the loop.

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

A 429 raised by quota exhaustion (rather than burst rate limiting) carries an extra `reason`
field — branch on it instead of blindly honouring `Retry-After`, since a quota refusal will not
clear within the window:

```json
{
  "error": {
    "status": 429,
    "message": "Too many requests",
    "reason": "QUOTA_EXCEEDED"
  }
}
```

## Rate Limits

Rate limits are calculated per rolling 30-second window. When exceeded, receive 429 response with `Retry-After` header.

### Best Practices

1. **Implement backoff-retry** - Use `Retry-After` header value
2. **Batch where available (Extended Quota Mode)** - `GET /albums?ids=id1,id2,id3` collapses many requests into one. Development Mode apps do not have the multi-get endpoints and must fetch per ID (`GET /albums/{id}`) with bounded concurrency plus caching to stay inside the window
3. **Cache responses** - Use `ETag` and `If-None-Match` headers
4. **Use snapshot_id** - Reference playlist snapshots to avoid refetching unchanged data
5. **Lazy load** - Fetch data on user interaction, not upfront

### Quota Modes

Every app starts in **development mode**, which is where almost all developers stay. Development mode constraints:

| Constraint | Value |
|---|---|
| Authenticated users per app | 5, explicitly allowlisted in the Developer Dashboard |
| App owner account | Must hold Spotify Premium, or the app does not function |
| Client IDs per developer | 25 (raised from 1 in July 2026; apps already over the old limit are grandfathered) |
| Quota accounting | Counted per developer account across all its Client IDs, not per Client ID — extra apps do not buy extra quota. Exhaustion returns `429` with `"reason": "QUOTA_EXCEEDED"` |
| Rate limit | Lower than extended quota mode (Spotify publishes no numbers for either) |
| `/search` `limit` | Max 10, default 5 |
| Batch multi-ID fetch (`GET /tracks?ids=`, `/albums?ids=`, `/artists?ids=`, and the show/episode/audiobook/chapter equivalents) | Unavailable — fetch individually |
| Browse (`/browse/new-releases`, `/browse/categories`), `/artists/{id}/top-tracks`, `/markets`, other users' profiles and playlists | Unavailable |
| Playlist contents | `/playlists/{id}/items` only, and readable only for playlists the user owns or collaborates on — anything else returns `403` |
| Library saves and follows | `PUT`/`DELETE /me/library` only; the per-type `/me/tracks`, `/me/albums`, `/me/following` writes are unavailable |

**Extended quota mode** lifts the user cap and raises the rate limit, and every endpoint, field, and behavior above remains available to it unchanged. Spotify accepts applications only from organizations — a legally registered business entity, an active launched service, availability in key Spotify markets, and at least 250,000 monthly active users, applied for from a company email address. Individual and hobbyist developers cannot obtain it, so design against the development-mode limits.

Extended quota does **not** restore the legacy restricted endpoints and content — audio features, audio analysis, recommendations and genre seeds, related artists, featured playlists, category playlists, 30-second `preview_url`s, and algorithmic or Spotify-owned editorial playlists. That access is grandfathered to apps that already held it and cannot be obtained by applying now. Restricted content is filtered as if it did not exist, so the symptom is `404 Resource not found`, not `401`/`403`.

## Common Operations

### Search

```
GET /search?q=artist:radiohead&type=track&limit=10
```

Query modifiers: `album:`, `artist:`, `track:`, `year:`, `genre:`

`limit` is capped at 10 (default 5) for Development Mode apps; Extended Quota Mode apps are documented as unaffected by that reduction (max 50, default 20). Retrieve more results by paginating with `offset` (max 1000), not by raising `limit`.

### Get Multiple Items

Extended Quota Mode:
```
GET /tracks?ids=id1,id2,id3
GET /albums?ids=id1,id2,id3
GET /artists?ids=id1,id2,id3
```

Development Mode — fetch individually, bounding concurrency:
```
GET /tracks/{id}
GET /albums/{id}
GET /artists/{id}
```

### Playlist Management

`/playlists/{id}/items` is the path for reading and mutating playlist contents (`GET`, `POST` to add, `PUT` to reorder or replace, `DELETE` to remove). A maximum of 100 items may be sent in one add or remove request — split larger sets into sequential batches. The request-body samples (`uris`/`position` to add, an `items` array to remove, `range_start`/`range_length`/`insert_before` to reorder, plus the optional `snapshot_id` for conflict-safe edits) are in the "Playlists" section of `references/endpoints-complete.md`. Create playlists with `POST /me/playlists`.

**Old patterns:** `/playlists/{id}/tracks` is the deprecated predecessor of `/playlists/{id}/items`, and its `DELETE` body used a `tracks` array where `/items` uses `items`. It is unavailable to Development Mode apps and still functional for Extended Quota Mode apps; new integrations should use `/items`. On the playlist object the same rename applies: `tracks` → `items`, `tracks.tracks` → `items.items`, `tracks.tracks.track` → `items.items.item`.

## Spotify URIs and IDs

Resources are identified by:
- **Spotify URI**: `spotify:track:6rqhFgbbKwnb9MLmUQDhG6`
- **Spotify ID**: `6rqhFgbbKwnb9MLmUQDhG6`
- **HTTP URL**: `https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6`

Extract ID from URL: last path segment before query parameters.

## Additional Resources

### Reference Files

For detailed documentation, consult:
- **`references/endpoints-complete.md`** - Read when you need an endpoint's exact path, HTTP method, query parameters, request/response shape, or required scope. Its "Endpoint Availability" section is the authoritative per-endpoint quota-mode matrix (**EQM only** / **Deprecated** / **Restricted** markers) behind the summary in Quota Modes above
- **`references/authentication-flows.md`** - Read when implementing or debugging OAuth (Authorization Code, PKCE, Client Credentials, token refresh and storage)
- **`references/scopes-complete.md`** - Read when choosing the minimal scope set for a group of endpoints or diagnosing a 403

### Example Files

Working examples in `examples/`:
- **`curl-examples.sh`** - Common operations with curl
- **`auth-flow.md`** - Read when writing the actual auth server: a runnable Express/TypeScript implementation of the Authorization Code flow

## Usage Policies

Per Spotify's terms:
- Content may not be downloaded or stored permanently
- Attribution required with links back to Spotify
- Commercial streaming applications prohibited without partnership
- AI model training on Spotify content prohibited
