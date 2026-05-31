# Spotify Web API - Complete Endpoint Reference

Base URL: `https://api.spotify.com/v1`

## Albums

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/albums/{id}` | Get album by ID | - |
| GET | `/albums` | Get multiple albums by IDs | - |
| GET | `/albums/{id}/tracks` | Get album's tracks | - |
| GET | `/me/albums` | Get user's saved albums | `user-library-read` |
| PUT | `/me/albums` | Save albums to library | `user-library-modify` |
| DELETE | `/me/albums` | Remove albums from library | `user-library-modify` |
| GET | `/me/albums/contains` | Check if albums are saved | `user-library-read` |
| GET | `/browse/new-releases` | Get new album releases | - |

### Album Object

```json
{
  "album_type": "album",
  "total_tracks": 12,
  "available_markets": ["US", "GB"],
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
| GET | `/artists` | Get multiple artists | - |
| GET | `/artists/{id}/albums` | Get artist's albums | - |
| GET | `/artists/{id}/top-tracks` | Get artist's top tracks | - |
| GET | `/artists/{id}/related-artists` | Get related artists | - |

### Artist Object

```json
{
  "external_urls": {...},
  "followers": {"total": 1234567},
  "genres": ["rock", "alternative"],
  "href": "https://api.spotify.com/v1/artists/...",
  "id": "0OdUWJ0sBjDrqHygGUXeCF",
  "images": [...],
  "name": "Artist Name",
  "popularity": 85,
  "type": "artist",
  "uri": "spotify:artist:0OdUWJ0sBjDrqHygGUXeCF"
}
```

## Tracks

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/tracks/{id}` | Get track by ID | - |
| GET | `/tracks` | Get multiple tracks | - |
| GET | `/me/tracks` | Get user's saved tracks | `user-library-read` |
| PUT | `/me/tracks` | Save tracks to library | `user-library-modify` |
| DELETE | `/me/tracks` | Remove tracks from library | `user-library-modify` |
| GET | `/me/tracks/contains` | Check if tracks are saved | `user-library-read` |
| GET | `/audio-features/{id}` | Get track audio features | - |
| GET | `/audio-features` | Get multiple audio features | - |
| GET | `/audio-analysis/{id}` | Get track audio analysis | - |
| GET | `/recommendations` | Get recommendations | - |

### Track Object

```json
{
  "album": {...},
  "artists": [...],
  "available_markets": ["US", "GB"],
  "disc_number": 1,
  "duration_ms": 210000,
  "explicit": false,
  "external_ids": {"isrc": "USRC11234567"},
  "external_urls": {...},
  "href": "https://api.spotify.com/v1/tracks/...",
  "id": "6rqhFgbbKwnb9MLmUQDhG6",
  "is_local": false,
  "name": "Track Name",
  "popularity": 75,
  "preview_url": "https://p.scdn.co/mp3-preview/...",
  "track_number": 1,
  "type": "track",
  "uri": "spotify:track:6rqhFgbbKwnb9MLmUQDhG6"
}
```

### Audio Features Object

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

## Playlists

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/playlists/{id}` | Get playlist | - or `playlist-read-private` |
| PUT | `/playlists/{id}` | Update playlist details | `playlist-modify-*` |
| GET | `/playlists/{id}/tracks` | Get playlist tracks | - or `playlist-read-private` |
| POST | `/playlists/{id}/tracks` | Add tracks to playlist | `playlist-modify-*` |
| PUT | `/playlists/{id}/tracks` | Reorder/replace tracks | `playlist-modify-*` |
| DELETE | `/playlists/{id}/tracks` | Remove tracks | `playlist-modify-*` |
| GET | `/me/playlists` | Get current user's playlists | `playlist-read-private` |
| GET | `/users/{user_id}/playlists` | Get user's playlists | `playlist-read-*` |
| POST | `/users/{user_id}/playlists` | Create playlist | `playlist-modify-*` |
| PUT | `/playlists/{id}/followers` | Follow playlist | `playlist-modify-*` |
| DELETE | `/playlists/{id}/followers` | Unfollow playlist | `playlist-modify-*` |
| GET | `/playlists/{id}/followers/contains` | Check if users follow | - |
| PUT | `/playlists/{id}/images` | Upload playlist image | `ugc-image-upload` |
| GET | `/browse/featured-playlists` | Get featured playlists | - |
| GET | `/browse/categories/{id}/playlists` | Get category's playlists | - |

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
  "tracks": {
    "href": "...",
    "total": 50,
    "items": [...]
  },
  "type": "playlist",
  "uri": "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"
}
```

### Add Tracks Request

```json
{
  "uris": [
    "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
    "spotify:track:1301WleyT98MSxVHPZCA6M"
  ],
  "position": 0
}
```

### Remove Tracks Request

```json
{
  "tracks": [
    {"uri": "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"},
    {"uri": "spotify:track:1301WleyT98MSxVHPZCA6M"}
  ],
  "snapshot_id": "optional_snapshot_id"
}
```

### Reorder Tracks Request

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
| `q` | Search query (required) |
| `type` | Comma-separated: album, artist, playlist, track, show, episode, audiobook |
| `market` | ISO 3166-1 alpha-2 country code |
| `limit` | Max results per type (1-50, default 20) |
| `offset` | Index of first result (default 0) |
| `include_external` | Include external audio (audio) |

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
    "limit": 20,
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
| GET | `/me/player/recently-played` | Get recently played | `user-read-recently-played` |
| GET | `/me/player/queue` | Get queue | `user-read-playback-state` |
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
| GET | `/users/{user_id}` | Get user profile | - |
| GET | `/me/top/artists` | Get top artists | `user-top-read` |
| GET | `/me/top/tracks` | Get top tracks | `user-top-read` |
| GET | `/me/following` | Get followed artists | `user-follow-read` |
| PUT | `/me/following` | Follow artists/users | `user-follow-modify` |
| DELETE | `/me/following` | Unfollow artists/users | `user-follow-modify` |
| GET | `/me/following/contains` | Check if following | `user-follow-read` |

### User Object

```json
{
  "country": "US",
  "display_name": "User Name",
  "email": "user@example.com",
  "explicit_content": {
    "filter_enabled": false,
    "filter_locked": false
  },
  "external_urls": {...},
  "followers": {"total": 100},
  "href": "https://api.spotify.com/v1/users/...",
  "id": "user_id",
  "images": [...],
  "product": "premium",
  "type": "user",
  "uri": "spotify:user:user_id"
}
```

### Top Items Parameters

| Parameter | Description |
|-----------|-------------|
| `time_range` | `short_term` (4 weeks), `medium_term` (6 months), `long_term` (years) |
| `limit` | 1-50 (default 20) |
| `offset` | Index offset |

## Shows & Episodes (Podcasts)

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/shows/{id}` | Get show | - |
| GET | `/shows` | Get multiple shows | - |
| GET | `/shows/{id}/episodes` | Get show episodes | - |
| GET | `/me/shows` | Get saved shows | `user-library-read` |
| PUT | `/me/shows` | Save shows | `user-library-modify` |
| DELETE | `/me/shows` | Remove shows | `user-library-modify` |
| GET | `/episodes/{id}` | Get episode | - |
| GET | `/episodes` | Get multiple episodes | - |
| GET | `/me/episodes` | Get saved episodes | `user-library-read` |
| PUT | `/me/episodes` | Save episodes | `user-library-modify` |
| DELETE | `/me/episodes` | Remove episodes | `user-library-modify` |

## Audiobooks

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/audiobooks/{id}` | Get audiobook | - |
| GET | `/audiobooks` | Get multiple audiobooks | - |
| GET | `/audiobooks/{id}/chapters` | Get chapters | - |
| GET | `/me/audiobooks` | Get saved audiobooks | `user-library-read` |
| PUT | `/me/audiobooks` | Save audiobooks | `user-library-modify` |
| DELETE | `/me/audiobooks` | Remove audiobooks | `user-library-modify` |
| GET | `/chapters/{id}` | Get chapter | - |
| GET | `/chapters` | Get multiple chapters | - |

## Categories

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/browse/categories` | Get all categories | - |
| GET | `/browse/categories/{id}` | Get single category | - |
| GET | `/browse/categories/{id}/playlists` | Get category playlists | - |

## Genres

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/recommendations/available-genre-seeds` | Get available genres | - |

## Markets

| Method | Endpoint | Description | Scopes |
|--------|----------|-------------|--------|
| GET | `/markets` | Get available markets | - |

## Pagination

All list endpoints return paginated results:

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
