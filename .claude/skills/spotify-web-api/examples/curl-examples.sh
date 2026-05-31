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

# Get multiple tracks
curl -s "$BASE/tracks?ids=6rqhFgbbKwnb9MLmUQDhG6,4iV5W9uYEdYUVa79Axb7Rh" \
  -H "Authorization: Bearer $TOKEN"

# Get audio features for track
curl -s "$BASE/audio-features/6rqhFgbbKwnb9MLmUQDhG6" \
  -H "Authorization: Bearer $TOKEN"

# Get recommendations based on seed tracks
curl -s "$BASE/recommendations?seed_tracks=6rqhFgbbKwnb9MLmUQDhG6&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# =============================================================================
# LIBRARY (SAVED TRACKS)
# =============================================================================

# Get user's saved tracks
curl -s "$BASE/me/tracks?limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Save tracks to library
curl -s -X PUT "$BASE/me/tracks?ids=6rqhFgbbKwnb9MLmUQDhG6,4iV5W9uYEdYUVa79Axb7Rh" \
  -H "Authorization: Bearer $TOKEN"

# Remove tracks from library
curl -s -X DELETE "$BASE/me/tracks?ids=6rqhFgbbKwnb9MLmUQDhG6" \
  -H "Authorization: Bearer $TOKEN"

# Check if tracks are saved
curl -s "$BASE/me/tracks/contains?ids=6rqhFgbbKwnb9MLmUQDhG6,4iV5W9uYEdYUVa79Axb7Rh" \
  -H "Authorization: Bearer $TOKEN"

# =============================================================================
# PLAYLISTS
# =============================================================================

# Get user's playlists
curl -s "$BASE/me/playlists?limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Get playlist by ID
curl -s "$BASE/playlists/37i9dQZF1DXcBWIGoYBM5M" \
  -H "Authorization: Bearer $TOKEN"

# Get playlist tracks
curl -s "$BASE/playlists/37i9dQZF1DXcBWIGoYBM5M/tracks?limit=100" \
  -H "Authorization: Bearer $TOKEN"

# Create playlist
curl -s -X POST "$BASE/users/USER_ID/playlists" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Playlist",
    "description": "Created via API",
    "public": false
  }'

# Add tracks to playlist
curl -s -X POST "$BASE/playlists/PLAYLIST_ID/tracks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "uris": [
      "spotify:track:6rqhFgbbKwnb9MLmUQDhG6",
      "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"
    ],
    "position": 0
  }'

# Remove tracks from playlist
curl -s -X DELETE "$BASE/playlists/PLAYLIST_ID/tracks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tracks": [
      {"uri": "spotify:track:6rqhFgbbKwnb9MLmUQDhG6"}
    ]
  }'

# Reorder tracks in playlist
curl -s -X PUT "$BASE/playlists/PLAYLIST_ID/tracks" \
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
    "context_uri": "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
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
curl -s "$BASE/artists/0OdUWJ0sBjDrqHygGUXeCF/top-tracks?market=US" \
  -H "Authorization: Bearer $TOKEN"

# Get related artists
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
curl -s "$BASE/browse/new-releases?limit=20" \
  -H "Authorization: Bearer $TOKEN"

# =============================================================================
# FOLLOWING
# =============================================================================

# Get followed artists
curl -s "$BASE/me/following?type=artist&limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Follow artists
curl -s -X PUT "$BASE/me/following?type=artist&ids=0OdUWJ0sBjDrqHygGUXeCF" \
  -H "Authorization: Bearer $TOKEN"

# Unfollow artists
curl -s -X DELETE "$BASE/me/following?type=artist&ids=0OdUWJ0sBjDrqHygGUXeCF" \
  -H "Authorization: Bearer $TOKEN"

# Check if following artists
curl -s "$BASE/me/following/contains?type=artist&ids=0OdUWJ0sBjDrqHygGUXeCF" \
  -H "Authorization: Bearer $TOKEN"

# =============================================================================
# BROWSE
# =============================================================================

# Get browse categories
curl -s "$BASE/browse/categories?limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Get category playlists
curl -s "$BASE/browse/categories/party/playlists?limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Get featured playlists
curl -s "$BASE/browse/featured-playlists?limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Get available genre seeds
curl -s "$BASE/recommendations/available-genre-seeds" \
  -H "Authorization: Bearer $TOKEN"
