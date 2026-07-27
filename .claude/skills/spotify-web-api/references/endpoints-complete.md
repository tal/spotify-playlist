# Spotify Web API - Complete Endpoint Reference

Base URL: `https://api.spotify.com/v1`

## Contents

- Endpoint Availability
- Albums
- Artists
- Tracks
- Library
- Playlists
- Search
- Player
- Users
- Shows & Episodes (Podcasts)
- Audiobooks
- Categories
- Genres
- Markets
- Pagination

## Endpoint Availability

Availability depends on how the calling app is registered. Development Mode is the default
for every newly registered app: up to 5 allowlisted users, and the app owner must hold
Spotify Premium. Extended Quota Mode is granted only to organizations, so design against the
Development Mode restrictions unless the app already holds extended quota.

Markers used in the Description column of the tables below:

| Marker | Meaning |
|--------|---------|
| **EQM only** | Unavailable to Development Mode apps. Extended Quota Mode apps call it unchanged. Where a replacement exists it is named in the row. |
| **Deprecated** | Superseded by the endpoint named in the row. The replacement works in both quota modes, so prefer it. The deprecated path is unavailable to Development Mode apps and still functional for Extended Quota Mode apps. |
| **Restricted** | Fails for apps registered on or after 2024-11-27 and for development-mode apps that had no pending extension request at that date. Apps with extended access predating that date are unaffected — applying for extended quota today does not restore access. Restricted *content* (editorial playlists, preview URLs) is filtered as if it does not exist, so the failure surfaces as `404`, not `401`/`403`. |

### Not available to Development Mode apps

| Endpoint(s) | Use instead |
|-------------|-------------|
| `GET`/`POST`/`PUT`/`DELETE` `/playlists/{id}/tracks` | `/playlists/{id}/items` |
| `PUT`/`DELETE` `/me/tracks`, `/me/albums`, `/me/shows`, `/me/episodes`, `/me/audiobooks` | `PUT`/`DELETE /me/library` |
| `GET /me/{type}/contains`, `GET /me/following/contains`, `GET /playlists/{id}/followers/contains` | `GET /me/library/contains` |
| `PUT`/`DELETE` `/me/following`, `PUT`/`DELETE` `/playlists/{id}/followers` | `PUT`/`DELETE /me/library` |
| Batch `GET /albums`, `/artists`, `/tracks`, `/shows`, `/episodes`, `/audiobooks`, `/chapters` | Fetch singly: `GET /albums/{id}`, `GET /artists/{id}`, etc. |
| `POST /users/{user_id}/playlists` | `POST /me/playlists` |
| `GET /users/{id}`, `GET /users/{id}/playlists` | `GET /me`, `GET /me/playlists` (current user only) |
| `GET /artists/{id}/top-tracks`, `GET /markets`, `GET /browse/new-releases`, `GET /browse/categories`, `GET /browse/categories/{id}` | No replacement |

`GET /search` is capped at `limit` 10 (default 5) for Development Mode apps. Response fields
also absent for those apps: `popularity`, `available_markets`, `linked_from` (track);
`followers`, `popularity` (artist); `album_group`, `available_markets`, `label`,
`popularity` (album); `country`, `email`, `explicit_content`, `followers`, `product` (user);
`available_markets`, `publisher` (show, audiobook); `available_markets` (chapter — `publisher`
is not removed there). `external_ids` remains available on tracks and albums.

### Restricted for apps registered on or after 2024-11-27

`GET /audio-features`, `GET /audio-features/{id}`, `GET /audio-analysis/{id}`,
`GET /recommendations`, `GET /recommendations/available-genre-seeds`,
`GET /artists/{id}/related-artists`, `GET /browse/featured-playlists`,
`GET /browse/categories/{id}/playlists`, plus 30-second `preview_url` values and
algorithmic/Spotify-owned editorial playlists.

## Albums

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/albums/{id}` | Get album by ID | - |
| GET | `/albums` | Get multiple albums by IDs (max 20 IDs) — **EQM only**, otherwise fetch singly | - |
| GET | `/albums/{id}/tracks` | Get album's tracks | - |
| GET | `/me/albums` | Get user's saved albums | `user-library-read` |
| PUT | `/me/albums` | Save albums to library — **Deprecated**, use `PUT /me/library` | `user-library-modify` |
| DELETE | `/me/albums` | Remove albums from library — **Deprecated**, use `DELETE /me/library` | `user-library-modify` |
| GET | `/me/albums/contains` | Check if albums are saved (max 20 IDs) — **Deprecated**, use `GET /me/library/contains` | `user-library-read` |
| GET | `/browse/new-releases` | Get new album releases — **EQM only** | - |

### Album Object

```json
{
  "album_type": "album",
  "total_tracks": 12,
  "available_markets": ["US", "GB"],  // Deprecated
  "external_urls": {
    "spotify": "https://open.spotify.com/album/..."
  },
  "href": "https://api.spotify.com/v1/albums/...",
  "id": "4aawyAB9vmqN3uQ7FjRGTy",
  "images": [
    {"url": "...", "height": 640, "width": 640}
  ],
  "name": "Album Name",
  "release_date": "2021-01-15",
  "release_date_precision": "day",
  "type": "album",
  "uri": "spotify:album:4aawyAB9vmqN3uQ7FjRGTy",
  "artists": [...],
  "tracks": {...}
}
```

## Artists

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/artists/{id}` | Get artist by ID | - |
| GET | `/artists` | Get multiple artists (max 50 IDs) — **EQM only**, otherwise fetch singly | - |
| GET | `/artists/{id}/albums` | Get artist's albums | - |
| GET | `/artists/{id}/top-tracks` | Get artist's top tracks — **EQM only** | - |
| GET | `/artists/{id}/related-artists` | Get related artists — **Restricted** | - |

### Artist Object

```json
{
  "external_urls": {...},
  "followers": {"total": 1234567},   // Deprecated
  "genres": ["rock", "alternative"], // Deprecated
  "href": "https://api.spotify.com/v1/artists/...",
  "id": "0OdUWJ0sBjDrqHygGUXeCF",
  "images": [...],
  "name": "Artist Name",
  "popularity": 85,                  // Deprecated
  "type": "artist",
  "uri": "spotify:artist:0OdUWJ0sBjDrqHygGUXeCF"
}
```

## Tracks

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/tracks/{id}` | Get track by ID | - |
| GET | `/tracks` | Get multiple tracks (max 50 IDs) — **EQM only**, otherwise fetch singly | - |
| GET | `/me/tracks` | Get user's saved tracks | `user-library-read` |
| PUT | `/me/tracks` | Save tracks to library — **Deprecated**, use `PUT /me/library` | `user-library-modify` |
| DELETE | `/me/tracks` | Remove tracks from library — **Deprecated**, use `DELETE /me/library` | `user-library-modify` |
| GET | `/me/tracks/contains` | Check if tracks are saved (max 50 IDs) — **Deprecated**, use `GET /me/library/contains` | `user-library-read` |
| GET | `/audio-features/{id}` | Get track audio features — **Restricted** | - |
| GET | `/audio-features` | Get multiple audio features — **Restricted** | - |
| GET | `/audio-analysis/{id}` | Get track audio analysis — **Restricted** | - |
| GET | `/recommendations` | Get recommendations — **Restricted** | - |

### Track Object

```json
{
  "album": {...},
  "artists": [...],
  "available_markets": ["US", "GB"],  // Deprecated
  "disc_number": 1,
  "duration_ms": 210000,
  "explicit": false,
  "external_ids": {"isrc": "USRC11234567"},
  "external_urls": {...},
  "href": "https://api.spotify.com/v1/tracks/...",
  "id": "6rqhFgbbKwnb9MLmUQDhG6",
  "is_local": false,
  "name": "Track Name",
  "popularity": 75,                   // Deprecated
  "preview_url": "https://p.scdn.co/mp3-preview/...",  // Deprecated; null for Restricted apps
  "track_number": 1,
  "type": "track",
  "uri": "spotify:track:6rqhFgbbKwnb9MLmUQDhG6"
}
```

### Audio Features Object (restricted — see Endpoint Availability)

```json
{
  "acousticness": 0.5,
  "danceability": 0.7,
  "duration_ms": 210000,
  "energy": 0.8,
  "instrumentalness": 0.0,
  "key": 5,
  "liveness": 0.2,
  "loudness": -5.0,
  "mode": 1,
  "speechiness": 0.1,
  "tempo": 120.0,
  "time_signature": 4,
  "valence": 0.6
}
```

## Library

Generic save/follow operations covering every content type. These replace the per-type
save/remove/contains and follow/unfollow paths and work in both quota modes, so they are the
safe default.

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| PUT | `/me/library?uris=...` | Save/follow items (max 40 URIs) | one of `user-library-modify`, `user-follow-modify`, `playlist-modify-public` |
| DELETE | `/me/library?uris=...` | Remove/unfollow items (max 40 URIs) | one of `user-library-modify`, `user-follow-modify`, `playlist-modify-public` |
| GET | `/me/library/contains?uris=...` | Check saved/followed (max 40 URIs) | one of `user-library-read`, `user-follow-read`, `playlist-read-private` |

- `uris` is a **required query parameter** — a comma-separated list of URL-encoded Spotify
  URIs (e.g. `spotify%3Atrack%3A7a3LWj5xSFhFRYmztS8wgK`), **max 40 per request**. It is not a
  JSON body, and IDs are not accepted — pass full URIs.
- Accepted URI types: track, album, episode, show, audiobook, artist, user, playlist. Artist
  and user URIs are how `PUT`/`DELETE /me/library` replaces follow/unfollow. Spotify's docs
  conflict here and the conflict is unresolved: the `PUT`/`DELETE /me/library` reference pages
  enumerate track/album/episode/show/audiobook/user/playlist **without** artist, while
  `GET /me/library/contains` does list artist, and the February 2026 migration guide gives this
  before/after for following an artist —
  `await spotify.put('/me/following', { ids: ['artistId1'], type: 'artist' })` becomes
  `await spotify.put('/me/library', { uris: ['spotify:artist:artistId1'] })`. Treat artist as
  accepted on all three verbs, but handle a `400` on artist saves rather than assuming success.
- `PUT` and `DELETE` return `200` with an empty body.
- `GET /me/library/contains` returns a bare boolean array, e.g. `[false, true]`.

## Playlists

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/playlists/{id}` | Get playlist | - or `playlist-read-private` |
| PUT | `/playlists/{id}` | Update playlist details | `playlist-modify-*` |
| GET | `/playlists/{id}/items` | Get playlist items — `403` unless the user owns or collaborates on the playlist | `playlist-read-private` |
| POST | `/playlists/{id}/items` | Add items to playlist (max 100 URIs) | `playlist-modify-*` |
| PUT | `/playlists/{id}/items` | Reorder/replace items | `playlist-modify-*` |
| DELETE | `/playlists/{id}/items` | Remove items (max 100 objects) | `playlist-modify-*` |
| GET | `/me/playlists` | Get current user's playlists | `playlist-read-private` |
| POST | `/me/playlists` | Create playlist for current user | `playlist-modify-*` |
| GET | `/users/{user_id}/playlists` | Get another user's playlists — **EQM only** | `playlist-read-*` |
| POST | `/users/{user_id}/playlists` | Create playlist for a user — **Deprecated**, use `POST /me/playlists` | `playlist-modify-*` |
| PUT | `/playlists/{id}/followers` | Follow playlist — **Deprecated**, use `PUT /me/library` | `playlist-modify-*` |
| DELETE | `/playlists/{id}/followers` | Unfollow playlist — **Deprecated**, use `DELETE /me/library` | `playlist-modify-*` |
| GET | `/playlists/{id}/followers/contains` | Check if users follow (max 1 ID) — **Deprecated**, use `GET /me/library/contains` | - |
| PUT | `/playlists/{id}/images` | Upload playlist image | `ugc-image-upload` |
| GET | `/browse/featured-playlists` | Get featured playlists — **Restricted** | - |
| GET | `/browse/categories/{id}/playlists` | Get category's playlists — **Restricted** | - |

`GET /playlists/{id}/items` accepts `market`, `fields`, `limit` (default 20, range 1-50),
`offset`, and `additional_types` (`track`, `episode`). Its reference page states the scope as
`playlist-read-private` and adds: "This endpoint is only accessible for playlists owned by the
current user or playlists the user is a collaborator of. A `403 Forbidden` status code will be
returned if the user is neither the owner nor a collaborator." That page carries no quota-mode
qualifier; the February 2026 migration guide scopes the ownership restriction to Development
Mode apps. Do not expect a metadata-only body here — a third-party playlist yields `403`, not a
partial response. (The metadata-only fallback applies to `GET /playlists/{id}`, where the
`items` object is simply absent.)

`/playlists/{id}/tracks` is the deprecated predecessor of `/playlists/{id}/items` on all four
verbs. It is unavailable to Development Mode apps and still functional for Extended Quota
Mode apps, where the `DELETE` body array is named `tracks` instead of `items`. Use `/items`
for new integrations.

### Playlist Object

```json
{
  "collaborative": false,
  "description": "Playlist description",
  "external_urls": {...},
  "followers": {"total": 1000},
  "href": "https://api.spotify.com/v1/playlists/...",
  "id": "37i9dQZF1DXcBWIGoYBM5M",
  "images": [...],
  "name": "Playlist Name",
  "owner": {...},
  "public": true,
  "snapshot_id": "MTY3NjQw...",
  "items": {
    "href": "...",
    "total": 50,
    "items": [
      {"added_at": "...", "added_by": {...}, "item": {...}}
    ]
  },
  "tracks": { "...": "Deprecated: use items instead" },
  "type": "playlist",
  "uri": "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"
}
```

`items` is only returned for playlists owned by the current user or playlists the user is a
collaborator of. For third-party playlists (including Spotify-owned editorial playlists) the
response carries playlist metadata only — do not assume item data is present. The nested
shape renamed alongside it: `tracks.tracks` -> `items.items` and `tracks.tracks.track` ->
`items.items.item`. `tracks` is deprecated but still present.

### Create Playlist Request

`POST /me/playlists`, `application/json` body:

```json
{
  "name": "New Playlist",
  "public": false,
  "collaborative": false,
  "description": "Created via API"
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `name` | string | — | **Required**. Not unique — several playlists may share a name |
| `public` | boolean | `true` | Omitting it creates a **public** playlist |
| `collaborative` | boolean | `false` | Requires `public: false`; also needs `playlist-modify-private` |
| `description` | string | — | Shown in Spotify clients |

Returns `201` with the created Playlist object. Each user is generally limited to a maximum of
11000 playlists.

### Add Items Request

```json
{
  "uris": [
    "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
    "spotify:track:1301WleyT98MSxVHPZCA6M"
  ],
  "position": 0
}
```

Max 100 URIs per request — split larger sets into batches of 100 and issue sequential
requests. `position` is a zero-based index; omit it to append. `uris` may also be sent as a
comma-separated query parameter, which takes precedence over the body when present.

### Remove Items Request

```json
{
  "items": [
    {"uri": "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"},
    {"uri": "spotify:track:1301WleyT98MSxVHPZCA6M"}
  ],
  "snapshot_id": "optional_snapshot_id"
}
```

Max 100 objects per request.

### Reorder Items Request

```json
{
  "range_start": 0,
  "range_length": 2,
  "insert_before": 5,
  "snapshot_id": "optional_snapshot_id"
}
```

## Search

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/search` | Search catalog | - |

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `q` | Search query (**required**) |
| `type` | Comma-separated: album, artist, playlist, track, show, episode, audiobook (**required** — omitting it returns `400`) |
| `market` | ISO 3166-1 alpha-2 country code |
| `limit` | Max results per type — Development Mode: 0-10, default 5; Extended Quota Mode: 0-50, default 20 |
| `offset` | Index of first result (0-1000, default 0) |
| `include_external` | Include external audio (audio) |

Search returns at most 10 items per type per request for Development Mode apps (default 5).
Extended Quota Mode apps are documented as unaffected by that reduction and retain the wider
0-50 range with a default of 20. Retrieve more results by paginating with `offset` (max
1000), not by raising `limit`.

### Query Modifiers

```
album:name
artist:name
track:name
year:2024
year:2020-2024
genre:rock
isrc:code
upc:code
tag:hipster (low popularity)
tag:new (recent releases)
```

### Search Response

```json
{
  "tracks": {
    "href": "...",
    "items": [...],
    "limit": 5,
    "next": "...",
    "offset": 0,
    "previous": null,
    "total": 1000
  },
  "artists": {...},
  "albums": {...},
  "playlists": {...}
}
```

## Player

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/me/player` | Get playback state | `user-read-playback-state` |
| PUT | `/me/player` | Transfer playback | `user-modify-playback-state` |
| GET | `/me/player/devices` | Get available devices | `user-read-playback-state` |
| GET | `/me/player/currently-playing` | Get current track | `user-read-currently-playing` |
| PUT | `/me/player/play` | Start/resume playback | `user-modify-playback-state` |
| PUT | `/me/player/pause` | Pause playback | `user-modify-playback-state` |
| POST | `/me/player/next` | Skip to next | `user-modify-playback-state` |
| POST | `/me/player/previous` | Skip to previous | `user-modify-playback-state` |
| PUT | `/me/player/seek` | Seek to position | `user-modify-playback-state` |
| PUT | `/me/player/repeat` | Set repeat mode | `user-modify-playback-state` |
| PUT | `/me/player/volume` | Set volume | `user-modify-playback-state` |
| PUT | `/me/player/shuffle` | Toggle shuffle | `user-modify-playback-state` |
| GET | `/me/player/recently-played` | Get recently played (cursor-paginated: `before`/`after`/`limit` only) | `user-read-recently-played` |
| GET | `/me/player/queue` | Get queue (no query parameters, not paginated) | `user-read-playback-state` |
| POST | `/me/player/queue` | Add to queue | `user-modify-playback-state` |

### Play Request

```json
{
  "context_uri": "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
  "offset": {"position": 5},
  "position_ms": 0
}
```

Or play specific tracks:

```json
{
  "uris": [
    "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
    "spotify:track:1301WleyT98MSxVHPZCA6M"
  ]
}
```

### Playback State Response

```json
{
  "device": {
    "id": "device_id",
    "is_active": true,
    "name": "My Device",
    "type": "Computer",
    "volume_percent": 50
  },
  "shuffle_state": false,
  "repeat_state": "off",
  "timestamp": 1638450000000,
  "context": {...},
  "progress_ms": 60000,
  "item": {...},
  "is_playing": true
}
```

## Users

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/me` | Get current user | `user-read-private` |
| GET | `/users/{user_id}` | Get another user's profile — **EQM only** | - |
| GET | `/me/top/artists` | Get top artists | `user-top-read` |
| GET | `/me/top/tracks` | Get top tracks | `user-top-read` |
| GET | `/me/following` | Get followed artists (cursor-paginated: `after`) | `user-follow-read` |
| PUT | `/me/following` | Follow artists/users — **Deprecated**, use `PUT /me/library` | `user-follow-modify` |
| DELETE | `/me/following` | Unfollow artists/users — **Deprecated**, use `DELETE /me/library` | `user-follow-modify` |
| GET | `/me/following/contains` | Check if following — **Deprecated**, use `GET /me/library/contains` | `user-follow-read` |

### User Object

```json
{
  "account_id": "aB3dE5fG7h",
  "country": "US",                    // Deprecated
  "display_name": "User Name",
  "email": "user@example.com",        // Deprecated
  "explicit_content": {               // Deprecated
    "filter_enabled": false,
    "filter_locked": false
  },
  "external_urls": {...},
  "followers": {"total": 100},        // Deprecated
  "href": "https://api.spotify.com/v1/users/...",
  "id": "user_id",
  "images": [...],
  "product": "premium",               // Deprecated
  "type": "user",
  "uri": "spotify:user:user_id"
}
```

Use `account_id`, not `id`, when linking a Spotify user to an external service — it is a
public, immutable, pseudoanonymous identifier for the account's lifetime.

### Top Items Parameters

| Parameter | Description |
|-----------|-------------|
| `time_range` | `short_term` (approximately last 4 weeks), `medium_term` (approximately last 6 months), `long_term` (calculated from ~1 year of data, including all new data as it becomes available). Default: `medium_term` |
| `limit` | 1-50 (default 20) |
| `offset` | Index of the first item (default 0) |

## Shows & Episodes (Podcasts)

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/shows/{id}` | Get show | - |
| GET | `/shows` | Get multiple shows — **EQM only**, otherwise fetch singly | - |
| GET | `/shows/{id}/episodes` | Get show episodes | - |
| GET | `/me/shows` | Get saved shows | `user-library-read` |
| PUT | `/me/shows` | Save shows — **Deprecated**, use `PUT /me/library` | `user-library-modify` |
| DELETE | `/me/shows` | Remove shows — **Deprecated**, use `DELETE /me/library` | `user-library-modify` |
| GET | `/episodes/{id}` | Get episode | - |
| GET | `/episodes` | Get multiple episodes — **EQM only**, otherwise fetch singly | - |
| GET | `/me/episodes` | Get saved episodes | `user-library-read` |
| PUT | `/me/episodes` | Save episodes — **Deprecated**, use `PUT /me/library` | `user-library-modify` |
| DELETE | `/me/episodes` | Remove episodes — **Deprecated**, use `DELETE /me/library` | `user-library-modify` |

## Audiobooks

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/audiobooks/{id}` | Get audiobook | - |
| GET | `/audiobooks` | Get multiple audiobooks — **EQM only**, otherwise fetch singly | - |
| GET | `/audiobooks/{id}/chapters` | Get chapters | - |
| GET | `/me/audiobooks` | Get saved audiobooks | `user-library-read` |
| PUT | `/me/audiobooks` | Save audiobooks — **Deprecated**, use `PUT /me/library` | `user-library-modify` |
| DELETE | `/me/audiobooks` | Remove audiobooks — **Deprecated**, use `DELETE /me/library` | `user-library-modify` |
| GET | `/chapters/{id}` | Get chapter | - |
| GET | `/chapters` | Get multiple chapters — **EQM only**, otherwise fetch singly | - |

## Categories

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/browse/categories` | Get all categories — **EQM only** | - |
| GET | `/browse/categories/{id}` | Get single category — **EQM only** | - |
| GET | `/browse/categories/{id}/playlists` | Get category playlists — **Restricted** | - |

## Genres

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/recommendations/available-genre-seeds` | Get available genres — **Restricted** | - |

## Markets

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/markets` | Get available markets — **EQM only** | - |

## Pagination

Most list endpoints return offset-paginated results:

```json
{
  "href": "https://api.spotify.com/v1/...",
  "items": [...],
  "limit": 20,
  "next": "https://api.spotify.com/v1/...?offset=20",
  "offset": 0,
  "previous": null,
  "total": 100
}
```

Use `next` URL for subsequent pages until `next` is `null`.

A few endpoints are **cursor-paginated** instead — they reject `offset` and return a
`cursors` object rather than `offset`/`previous`:

| Endpoint | Cursor params |
|----------|---------------|
| `GET /me/player/recently-played` | `before` / `after` (Unix ms timestamps; mutually exclusive) |
| `GET /me/following?type=artist` | `after` (last artist ID from the previous page) |

```json
{
  "href": "https://api.spotify.com/v1/me/player/recently-played",
  "items": [...],
  "limit": 50,
  "next": "https://api.spotify.com/v1/me/player/recently-played?before=1631066767955&limit=50",
  "cursors": {"after": "1631066767955", "before": "1631060000000"}
}
```

Paginate these by feeding `cursors.before` (or `cursors.after`) from the response into the
next request, or by following `next` until it is `null`. `total` is absent or unreliable on
cursor endpoints, so bound the loop.
