# Smart playlist matches all credited artists, not just primary

**Date:** 2026-05-31

## Problem

The Smart Playlist would name itself after a featured artist (e.g.
"Smart Playlist — K.Flay") but include far fewer of that artist's saved songs
than the user actually has liked.

## Cause

`randomStarredArtistTracks()` in `src/actions/rule-playlist.ts` filtered the
user's saved tracks using `track.artists[0].id === artist.id` — i.e. it only
counted songs where the artist was the **primary** (first-listed) credit. Every
collaboration or feature where the artist was billed second (or later) was
silently excluded.

## Fix

Changed the filter to `track.artists.some((a) => a.id === artist.id)` so any
song that credits the artist anywhere in its artist list is included.

## Files Touched

- `src/actions/rule-playlist.ts` — `randomStarredArtistTracks()`

## Note

If the count still looks low after this, the liked-songs cache in DynamoDB may
be stale. Run `yarn cli clear-liked-cache` to force a fresh fetch from Spotify.
