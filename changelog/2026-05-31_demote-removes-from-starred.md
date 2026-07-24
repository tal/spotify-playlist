# Demote removes from Starred instead of unliking

**Date:** 2026-05-31

## Change

Updated `demoteTrack()` in `src/actions/track-action.ts` so that demoting a track
that lives in the **Starred** playlist removes it from Starred rather than
unsaving it from the user's liked songs.

### Behavior

- During a normal demote (not already playing from the Starred playlist), the
  action now checks whether the current track is in the Starred playlist via
  `client.trackInPlaylist(currentTrack, starred)`.
- **If the track is in Starred:** a `RemoveTrackMutation` for the Starred
  playlist is added, and the `UnsaveTrackMutation` is skipped. The track stays
  liked.
- **If the track is not in Starred:** behavior is unchanged — the track is
  unsaved from the library via `UnsaveTrackMutation`.
- The existing early-return path (when the *currently playing* context already
  is the Starred playlist) is untouched; that case already removes from Starred
  and never unsaves.

## Files Touched

- `src/actions/track-action.ts` — `demoteTrack()`
