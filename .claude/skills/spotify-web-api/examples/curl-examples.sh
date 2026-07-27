#!/bin/bash
# Spotify Web API - Common curl Examples
# Replace ACCESS_TOKEN with your actual token

TOKEN="ACCESS_TOKEN"
BASE="https://api.spotify.com/v1"

# =============================================================================
# USER PROFILE
# =============================================================================

# Get current user profile
curl -s "$BASE/me" \
  -H "Authorization: Bearer $TOKEN"

# Get user's top artists (medium term)
curl -s "$BASE/me/top/artists?time_range=medium_term&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# Get user's top tracks (short term - last 4 weeks)
curl -s "$BASE/me/top/tracks?time_range=short_term&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Get recently played tracks
curl -s "$BASE/me/player/recently-played?limit=50" \
  -H "Authorization: Bearer $TOKEN"

# =============================================================================
# SEARCH
# =============================================================================

# Search for tracks
curl -s "$BASE/search?q=bohemian+rhapsody&type=track&limit=5" \
  -H "Authorization: Bearer $TOKEN"

# Search for artist
curl -s "$BASE/search?q=artist:radiohead&type=artist&limit=5" \
  -H "Authorization: Bearer $TOKEN"

# Search with filters (year range, genre)
curl -s "$BASE/search?q=genre:rock+year:2020-2024&type=track&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# =============================================================================
# TRACKS
# =============================================================================

# Get track by ID
curl -s "$BASE/tracks/6rqhFgbbKwnb9MLmUQDhG6" \
  -H "Authorization: Bearer $TOKEN"

# Get multiple tracks by ID (batch fetch)
# Requires Extended Quota Mode - Development Mode apps must fetch tracks one
# at a time instead (see "Get track by ID" above).
curl -s "$BASE/tracks?ids=6rqhFgbbKwnb9MLmUQDhG6,4iV5W9uYEdYUVa79Axb7Rh" \
  -H "Authorization: Bearer $TOKEN"

# Get audio features for track
# Restricted - only available to apps with pre-existing Extended Quota Mode
# access; unavailable to Development Mode apps and newly registered apps.
curl -s "$BASE/audio-features/6rqhFgbbKwnb9MLmUQDhG6" \
  -H "Authorization: Bearer $TOKEN"

# Get recommendations based on seed tracks
# Restricted - same access requirement as audio features above.
curl -s "$BASE/recommendations?seed_tracks=6rqhFgbbKwnb9MLmUQDhG6&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# =============================================================================
# LIBRARY (SAVED TRACKS)
# =============================================================================

# Get user's saved tracks
curl -s "$BASE/me/tracks?limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Save items to library (generic endpoint - accepts track/album/episode/show/
# audiobook/user/playlist URIs, max 40 per request; `uris` is a query param,
# not a JSON body). Artist URIs are used below to follow artists, but Spotify's
# PUT/DELETE reference pages omit artist from this list while the February 2026
# migration guide shows it - see the Library section of
# references/endpoints-complete.md.
curl -s -X PUT "$BASE/me/library?uris=spotify%3Atrack%3A6rqhFgbbKwnb9MLmUQDhG6,spotify%3Atrack%3A4iV5W9uYEdYUVa79Axb7Rh" \
  -H "Authorization: Bearer $TOKEN"

# Remove items from library
curl -s -X DELETE "$BASE/me/library?uris=spotify%3Atrack%3A6rqhFgbbKwnb9MLmUQDhG6" \
  -H "Authorization: Bearer $TOKEN"

# Check if items are saved (returns a bare boolean array, e.g. [false,true])
curl -s "$BASE/me/library/contains?uris=spotify%3Atrack%3A6rqhFgbbKwnb9MLmUQDhG6,spotify%3Atrack%3A4iV5W9uYEdYUVa79Axb7Rh" \
  -H "Authorization: Bearer $TOKEN"

# Old pattern: PUT/DELETE /me/tracks and GET /me/tracks/contains (ids=, max 50)
# are the deprecated per-type predecessors of /me/library above. They still
# work for apps with Extended Quota Mode access; Development Mode apps must
# use /me/library. The same replacement applies to /me/albums, /me/shows,
# /me/episodes, and /me/audiobooks.

# =============================================================================
# PLAYLISTS
# =============================================================================
# Note: /playlists/{id}/tracks (and the "tracks" request/response key) is the
# deprecated predecessor of /playlists/{id}/items (and "items"). Development
# Mode apps must use /items; apps with Extended Quota Mode access may still
# use the old /tracks paths.

# Get user's playlists
curl -s "$BASE/me/playlists?limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Get playlist by ID
curl -s "$BASE/playlists/PLAYLIST_ID" \
  -H "Authorization: Bearer $TOKEN"

# Get playlist items
curl -s "$BASE/playlists/PLAYLIST_ID/items?limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Create playlist (for the current user)
curl -s -X POST "$BASE/me/playlists" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Playlist",
    "description": "Created via API",
    "public": false
  }'

# Add items to playlist (max 100 URIs per request)
curl -s -X POST "$BASE/playlists/PLAYLIST_ID/items" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "uris": [
      "spotify:track:6rqhFgbbKwnb9MLmUQDhG6",
      "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"
    ],
    "position": 0
  }'

# Remove items from playlist
curl -s -X DELETE "$BASE/playlists/PLAYLIST_ID/items" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"uri": "spotify:track:6rqhFgbbKwnb9MLmUQDhG6"}
    ]
  }'

# Reorder items in playlist
curl -s -X PUT "$BASE/playlists/PLAYLIST_ID/items" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "range_start": 0,
    "range_length": 2,
    "insert_before": 5
  }'

# Update playlist details
curl -s -X PUT "$BASE/playlists/PLAYLIST_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Name",
    "description": "Updated description",
    "public": true
  }'

# =============================================================================
# PLAYBACK CONTROL (Premium Required)
# =============================================================================

# Get current playback state
curl -s "$BASE/me/player" \
  -H "Authorization: Bearer $TOKEN"

# Get currently playing track
curl -s "$BASE/me/player/currently-playing" \
  -H "Authorization: Bearer $TOKEN"

# Get available devices
curl -s "$BASE/me/player/devices" \
  -H "Authorization: Bearer $TOKEN"

# Start/resume playback
curl -s -X PUT "$BASE/me/player/play" \
  -H "Authorization: Bearer $TOKEN"

# Start playback with context (playlist/album)
curl -s -X PUT "$BASE/me/player/play" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "context_uri": "spotify:playlist:PLAYLIST_ID",
    "offset": {"position": 0}
  }'

# Play specific tracks
curl -s -X PUT "$BASE/me/player/play" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "uris": [
      "spotify:track:6rqhFgbbKwnb9MLmUQDhG6",
      "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"
    ]
  }'

# Pause playback
curl -s -X PUT "$BASE/me/player/pause" \
  -H "Authorization: Bearer $TOKEN"

# Skip to next track
curl -s -X POST "$BASE/me/player/next" \
  -H "Authorization: Bearer $TOKEN"

# Skip to previous track
curl -s -X POST "$BASE/me/player/previous" \
  -H "Authorization: Bearer $TOKEN"

# Seek to position (ms)
curl -s -X PUT "$BASE/me/player/seek?position_ms=60000" \
  -H "Authorization: Bearer $TOKEN"

# Set volume (0-100)
curl -s -X PUT "$BASE/me/player/volume?volume_percent=50" \
  -H "Authorization: Bearer $TOKEN"

# Toggle shuffle
curl -s -X PUT "$BASE/me/player/shuffle?state=true" \
  -H "Authorization: Bearer $TOKEN"

# Set repeat mode (track, context, off)
curl -s -X PUT "$BASE/me/player/repeat?state=track" \
  -H "Authorization: Bearer $TOKEN"

# Add to queue
curl -s -X POST "$BASE/me/player/queue?uri=spotify:track:6rqhFgbbKwnb9MLmUQDhG6" \
  -H "Authorization: Bearer $TOKEN"

# Transfer playback to device
curl -s -X PUT "$BASE/me/player" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_ids": ["DEVICE_ID"],
    "play": true
  }'

# =============================================================================
# ARTISTS
# =============================================================================

# Get artist
curl -s "$BASE/artists/0OdUWJ0sBjDrqHygGUXeCF" \
  -H "Authorization: Bearer $TOKEN"

# Get artist's albums
curl -s "$BASE/artists/0OdUWJ0sBjDrqHygGUXeCF/albums?include_groups=album,single&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Get artist's top tracks
# Requires Extended Quota Mode - unavailable to Development Mode apps.
curl -s "$BASE/artists/0OdUWJ0sBjDrqHygGUXeCF/top-tracks?market=US" \
  -H "Authorization: Bearer $TOKEN"

# Get related artists
# Restricted - only available to apps with pre-existing Extended Quota Mode
# access; unavailable to Development Mode apps and newly registered apps.
curl -s "$BASE/artists/0OdUWJ0sBjDrqHygGUXeCF/related-artists" \
  -H "Authorization: Bearer $TOKEN"

# =============================================================================
# ALBUMS
# =============================================================================

# Get album
curl -s "$BASE/albums/4aawyAB9vmqN3uQ7FjRGTy" \
  -H "Authorization: Bearer $TOKEN"

# Get album tracks
curl -s "$BASE/albums/4aawyAB9vmqN3uQ7FjRGTy/tracks?limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Get new releases
# Requires Extended Quota Mode - unavailable to Development Mode apps.
curl -s "$BASE/browse/new-releases?limit=20" \
  -H "Authorization: Bearer $TOKEN"

# =============================================================================
# FOLLOWING
# =============================================================================

# Get followed artists
curl -s "$BASE/me/following?type=artist&limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Follow artists (generic library endpoint - accepts Spotify URIs)
# Handle a 400 here: the PUT /me/library reference page does not list artist
# among its accepted URI types, though the migration guide's own before/after
# example follows an artist exactly this way.
curl -s -X PUT "$BASE/me/library?uris=spotify%3Aartist%3A0OdUWJ0sBjDrqHygGUXeCF" \
  -H "Authorization: Bearer $TOKEN"

# Unfollow artists
curl -s -X DELETE "$BASE/me/library?uris=spotify%3Aartist%3A0OdUWJ0sBjDrqHygGUXeCF" \
  -H "Authorization: Bearer $TOKEN"

# Check if following artists
curl -s "$BASE/me/library/contains?uris=spotify%3Aartist%3A0OdUWJ0sBjDrqHygGUXeCF" \
  -H "Authorization: Bearer $TOKEN"

# Old pattern: PUT/DELETE /me/following and GET /me/following/contains (type=,
# ids=, max 50) are the deprecated per-type predecessors of /me/library above.
# They still work for apps with Extended Quota Mode access; Development Mode
# apps must use /me/library.

# =============================================================================
# BROWSE
# =============================================================================

# Get browse categories
# Requires Extended Quota Mode - unavailable to Development Mode apps.
curl -s "$BASE/browse/categories?limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Get category playlists
# Restricted - only available to apps with pre-existing Extended Quota Mode
# access; unavailable to Development Mode apps and newly registered apps.
curl -s "$BASE/browse/categories/party/playlists?limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Get featured playlists
# Restricted - same access requirement as category playlists above.
curl -s "$BASE/browse/featured-playlists?limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Get available genre seeds
# Restricted - same access requirement as category playlists above.
curl -s "$BASE/recommendations/available-genre-seeds" \
  -H "Authorization: Bearer $TOKEN"
