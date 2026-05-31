# Spotify OAuth Scopes - Complete Reference

Request only the scopes needed for the application. Users see all requested scopes during authorization.

## Images

| Scope | Description |
|-------|-------------|
| `ugc-image-upload` | Upload images to Spotify (playlist covers) |

**Endpoints:**
- `PUT /playlists/{id}/images`

---

## Spotify Connect

| Scope | Description |
|-------|-------------|
| `user-read-playback-state` | Read current playback state (device, track, shuffle, repeat) |
| `user-modify-playback-state` | Control playback (play, pause, seek, skip, volume, transfer) |
| `user-read-currently-playing` | Read currently playing track |

**Endpoints (user-read-playback-state):**
- `GET /me/player`
- `GET /me/player/devices`
- `GET /me/player/queue`

**Endpoints (user-modify-playback-state):**
- `PUT /me/player`
- `PUT /me/player/play`
- `PUT /me/player/pause`
- `POST /me/player/next`
- `POST /me/player/previous`
- `PUT /me/player/seek`
- `PUT /me/player/repeat`
- `PUT /me/player/volume`
- `PUT /me/player/shuffle`
- `POST /me/player/queue`

**Endpoints (user-read-currently-playing):**
- `GET /me/player/currently-playing`

---

## Playback

| Scope | Description |
|-------|-------------|
| `app-remote-control` | Remote control Spotify on user's devices via Spotify mobile app |
| `streaming` | Play content and control playback via Web Playback SDK (Premium required) |

**Note:** `streaming` scope is specifically for the Web Playback SDK, not general API access.

---

## Playlists

| Scope | Description |
|-------|-------------|
| `playlist-read-private` | Read user's private playlists |
| `playlist-read-collaborative` | Include collaborative playlists in user's playlist list |
| `playlist-modify-private` | Create, modify, delete user's private playlists |
| `playlist-modify-public` | Create, modify, delete user's public playlists |

**Endpoints (playlist-read-private):**
- `GET /me/playlists`
- `GET /users/{user_id}/playlists`
- `GET /playlists/{id}` (private playlists)
- `GET /playlists/{id}/tracks` (private playlists)

**Endpoints (playlist-read-collaborative):**
- Same as playlist-read-private, includes collaborative playlists

**Endpoints (playlist-modify-private/public):**
- `POST /users/{user_id}/playlists`
- `PUT /playlists/{id}`
- `POST /playlists/{id}/tracks`
- `PUT /playlists/{id}/tracks`
- `DELETE /playlists/{id}/tracks`
- `PUT /playlists/{id}/followers`
- `DELETE /playlists/{id}/followers`

---

## Follow

| Scope | Description |
|-------|-------------|
| `user-follow-modify` | Follow and unfollow artists and users |
| `user-follow-read` | Read list of followed artists and users |

**Endpoints (user-follow-read):**
- `GET /me/following`
- `GET /me/following/contains`

**Endpoints (user-follow-modify):**
- `PUT /me/following`
- `DELETE /me/following`

---

## Listening History

| Scope | Description |
|-------|-------------|
| `user-read-playback-position` | Read playback position in audiobooks and podcasts |
| `user-top-read` | Read user's top artists and tracks |
| `user-read-recently-played` | Read user's recently played tracks |

**Endpoints (user-top-read):**
- `GET /me/top/artists`
- `GET /me/top/tracks`

**Endpoints (user-read-recently-played):**
- `GET /me/player/recently-played`

**Endpoints (user-read-playback-position):**
- Episode and chapter objects include `resume_point` with playback position

---

## Library

| Scope | Description |
|-------|-------------|
| `user-library-modify` | Save and remove content from user's library |
| `user-library-read` | Read user's saved content |

**Endpoints (user-library-read):**
- `GET /me/tracks`
- `GET /me/tracks/contains`
- `GET /me/albums`
- `GET /me/albums/contains`
- `GET /me/episodes`
- `GET /me/episodes/contains`
- `GET /me/shows`
- `GET /me/shows/contains`
- `GET /me/audiobooks`
- `GET /me/audiobooks/contains`

**Endpoints (user-library-modify):**
- `PUT /me/tracks`
- `DELETE /me/tracks`
- `PUT /me/albums`
- `DELETE /me/albums`
- `PUT /me/episodes`
- `DELETE /me/episodes`
- `PUT /me/shows`
- `DELETE /me/shows`
- `PUT /me/audiobooks`
- `DELETE /me/audiobooks`

---

## Users

| Scope | Description |
|-------|-------------|
| `user-read-email` | Read user's email address |
| `user-read-private` | Read user's subscription details (country, product) |

**Endpoints:**
- `GET /me` (returns additional fields with these scopes)

**Fields returned with user-read-email:**
- `email`

**Fields returned with user-read-private:**
- `country`
- `product` (free, premium, etc.)
- `explicit_content` preferences

---

## Open Access (Partner Accounts)

These scopes are for Spotify partner integrations:

| Scope | Description |
|-------|-------------|
| `user-soa-link` | Link Spotify account to partner service |
| `user-soa-unlink` | Unlink Spotify account from partner service |
| `soa-manage-entitlements` | Manage partner service entitlements |
| `soa-manage-partner` | Manage partner service settings |
| `soa-create-partner` | Create partner service accounts |

**Note:** These scopes require partnership agreement with Spotify.

---

## Scope Combinations

### Music Player App

```
user-read-playback-state
user-modify-playback-state
user-read-currently-playing
user-library-read
playlist-read-private
```

### Playlist Manager

```
playlist-read-private
playlist-read-collaborative
playlist-modify-public
playlist-modify-private
ugc-image-upload
```

### Music Statistics/Analytics

```
user-top-read
user-read-recently-played
user-library-read
user-follow-read
```

### Social Music App

```
user-read-private
user-read-email
user-follow-read
user-follow-modify
playlist-read-private
```

### Full Access (Request Only What You Need)

```
ugc-image-upload
user-read-playback-state
user-modify-playback-state
user-read-currently-playing
streaming
playlist-read-private
playlist-read-collaborative
playlist-modify-private
playlist-modify-public
user-follow-modify
user-follow-read
user-read-playback-position
user-top-read
user-read-recently-played
user-library-modify
user-library-read
user-read-email
user-read-private
```

---

## No Scope Required

These endpoints work without user authorization (Client Credentials flow):

- `GET /albums/{id}`
- `GET /albums`
- `GET /albums/{id}/tracks`
- `GET /artists/{id}`
- `GET /artists`
- `GET /artists/{id}/albums`
- `GET /artists/{id}/top-tracks`
- `GET /artists/{id}/related-artists`
- `GET /tracks/{id}`
- `GET /tracks`
- `GET /audio-features/{id}`
- `GET /audio-features`
- `GET /audio-analysis/{id}`
- `GET /search`
- `GET /recommendations`
- `GET /recommendations/available-genre-seeds`
- `GET /browse/new-releases`
- `GET /browse/featured-playlists`
- `GET /browse/categories`
- `GET /browse/categories/{id}`
- `GET /browse/categories/{id}/playlists`
- `GET /markets`
- `GET /users/{user_id}` (public profile only)
- `GET /playlists/{id}` (public playlists only)
- `GET /playlists/{id}/tracks` (public playlists only)

---

## Best Practices

1. **Request minimum scopes** - Only request what your app actually needs
2. **Explain why** - Users are more likely to grant access if they understand the purpose
3. **Progressive consent** - Request additional scopes later when needed
4. **Handle denial gracefully** - App should work (with reduced functionality) if user denies some scopes
5. **Review periodically** - Remove scopes you no longer need
