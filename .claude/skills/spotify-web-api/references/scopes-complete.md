# Spotify OAuth Scopes - Complete Reference

Request only the scopes needed for the application. Users see all requested scopes during authorization.

## Contents

- Images
- Spotify Connect
- Playback
- Playlists
- Follow
- Listening History
- Library
- Users
- Open Access (Partner Accounts)
- Scope Combinations
- No Scope Required
- Best Practices

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
- `GET /users/{user_id}/playlists` (Extended Quota Mode only)
- `GET /playlists/{id}` (private playlists)
- `GET /playlists/{id}/items` (private playlists)

**Endpoints (playlist-read-collaborative):**
- Same as playlist-read-private, includes collaborative playlists

**Endpoints (playlist-modify-private/public):**
- `POST /me/playlists`
- `POST /users/{user_id}/playlists` (deprecated — see below)
- `PUT /playlists/{id}`
- `POST /playlists/{id}/items`
- `PUT /playlists/{id}/items`
- `DELETE /playlists/{id}/items`
- `PUT /playlists/{id}/followers`
- `DELETE /playlists/{id}/followers`

**Old patterns:** `/playlists/{id}/tracks` is the deprecated predecessor of `/playlists/{id}/items` (same four verbs; the DELETE body's `tracks` array is now `items`), and `POST /users/{user_id}/playlists` is the deprecated predecessor of `POST /me/playlists`. `PUT /playlists/{id}/followers` / `DELETE /playlists/{id}/followers` are likewise deprecated in favor of the generic `PUT /me/library` / `DELETE /me/library` (see Library section). Development Mode apps do not have the deprecated forms; apps in Extended Quota Mode are unaffected and can keep using them. Also note: `GET /playlists/{id}/items` is documented as accessible only for playlists the current user owns or collaborates on — for any other playlist (including Spotify-owned editorial playlists) it returns `403 Forbidden`, not a metadata-only body. The metadata-only fallback belongs to `GET /playlists/{id}`, whose response simply omits the `items` object for third-party playlists. The `/items` reference page states the restriction with no quota-mode qualifier; the February 2026 migration guide scopes it to Development Mode apps.

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

**Note:** `PUT /me/following` / `DELETE /me/following` and `GET /me/following/contains` are deprecated in favor of the generic `PUT /me/library` / `DELETE /me/library` and `GET /me/library/contains` (see Library section), using `spotify:artist:...` / `spotify:user:...` URIs. Development Mode apps do not have the per-type follow endpoints; apps in Extended Quota Mode are unaffected.

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
- `GET /me/library/contains` (generic check across all content types, incl. artists/users/playlists; query param `uris`, max 40)

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
- `PUT /me/library` / `DELETE /me/library` (generic save/remove across all content types, incl. artists/users/playlists; query param `uris`, max 40 — also the replacement for the follow/unfollow endpoints under Follow, below)

**Note:** The per-type endpoints above take comma-separated `ids` — max 50 for tracks, shows, episodes and audiobooks, but max 20 for albums (`GET /me/albums/contains`). The generic `/me/library` endpoints take full Spotify `uris` instead (max 40, uniform across every type) and are the only library endpoints available to Development Mode apps; apps in Extended Quota Mode can keep using either form. See the Library section of `references/endpoints-complete.md` for the per-endpoint caps and for the unresolved conflict in Spotify's docs over whether `spotify:artist:` URIs are accepted by `PUT`/`DELETE /me/library` (they are listed for `GET /me/library/contains`).

---

## Users

| Scope | Description |
|-------|-------------|
| `user-read-email` | Read user's email address |
| `user-read-private` | Read user's subscription details (country, product) |
| `user-personalized` | Access personalized content/recommendations for the user |

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

These endpoints need no user authorization (Client Credentials flow). Needing no scope is not
the same as being callable — several are restricted by quota mode or by app registration
date. Markers below match the "Endpoint Availability" section of
`references/endpoints-complete.md`, which is authoritative.

Callable in both quota modes:

- `GET /albums/{id}`
- `GET /albums/{id}/tracks`
- `GET /artists/{id}`
- `GET /artists/{id}/albums`
- `GET /tracks/{id}`
- `GET /search`
- `GET /playlists/{id}` (public playlists only)

`GET /playlists/{id}/items` is **not** in this list: its reference page requires
`playlist-read-private` and returns `403` unless the caller owns or collaborates on the
playlist, so a Client Credentials token cannot read it. Use `GET /playlists/{id}` for public
playlist metadata.

Extended Quota Mode only (unavailable to Development Mode apps):

- `GET /albums`, `GET /artists`, `GET /tracks` (batch multi-ID — fetch singly instead)
- `GET /artists/{id}/top-tracks`
- `GET /browse/new-releases`
- `GET /browse/categories`, `GET /browse/categories/{id}`
- `GET /markets`
- `GET /users/{user_id}` (public profile only)

Restricted (only apps whose extended access predates the 2024-11-27 cutoff; applying for
extended quota today does not restore access, and the failure surfaces as `404`):

- `GET /artists/{id}/related-artists`
- `GET /audio-features/{id}`, `GET /audio-features`
- `GET /audio-analysis/{id}`
- `GET /recommendations`
- `GET /recommendations/available-genre-seeds`
- `GET /browse/featured-playlists`
- `GET /browse/categories/{id}/playlists`

---

## Best Practices

1. **Request minimum scopes** - Only request what your app actually needs
2. **Explain why** - Users are more likely to grant access if they understand the purpose
3. **Progressive consent** - Request additional scopes later when needed
4. **Handle denial gracefully** - App should work (with reduced functionality) if user denies some scopes
5. **Review periodically** - Remove scopes you no longer need
