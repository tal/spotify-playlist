# Add Track Listen Mutation Display Enhancement

## Date: 2025-01-08

## Summary
Enhanced the MutationsModal component to properly display `add-track-listen` mutation details including track information and context playlist names.

## Changes Made

### Updated MutationsModal Component (`web/src/components/MutationsModal.tsx`)

1. **Added display configuration for add-track-listen mutation**:
   - Added entry to `getMutationDisplay` with label "Track listened", icon 🎧, and indigo color
   - This provides proper visual identification for track listening events

2. **Enhanced mutation details extraction**:
   - Added special handling for `add-track-listen` mutation type in `getMutationDetails`
   - Displays track ID from the mutation data
   - Extracts and displays playlist name when track was played from a playlist context
   - Shows non-playlist contexts (like album or artist radio) when applicable
   - Displays the exact time when the track was played
   - Shows play count increment information

## Technical Details

The `add-track-listen` mutation data structure contains:
- `track`: Object with just the track ID
- `context`: Object containing:
  - `uri`: Spotify URI of the playback context (playlist, album, etc.)
  - `played_at`: Timestamp when the track was played
  - `exactness`: Indicates precision of the timestamp
- `increment_by`: Number to increment the play count

The implementation properly handles both playlist and non-playlist contexts, using the existing playlist map to convert playlist IDs to human-readable names.

## User Impact

Users can now see detailed information about track listening events in the action history, including:
- Which track was played (by ID)
- Where it was played from (playlist name or other context)
- When it was played
- How it affected the play count

This provides better visibility into the track listening history processing workflow.