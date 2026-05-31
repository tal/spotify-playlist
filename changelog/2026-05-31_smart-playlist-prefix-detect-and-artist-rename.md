# 2026-05-31 — Smart playlist: detect by prefix + rename with featured artist

## Summary

The `rule-playlist` action no longer targets the smart playlist by a hardcoded
id (`6Yr80pdznzQdnCExCsqTTb`). It now finds the playlist by a **name prefix** and
**rewrites the trailing part of the name** to show which artist's saved tracks
were mixed into the playlist this round (e.g. `Smart Playlist — K.Flay`).

## Changes

### `src/actions/rule-playlist.ts`

- Added a `SMART_PLAYLIST_PREFIX = 'Smart Playlist'` constant.
- `perform()` now resolves the target playlist via `client.playlistByPrefix(SMART_PLAYLIST_PREFIX)`
  and bails out gracefully (returns `[]`) if no matching playlist is found.
- All mutations (`EmptyPlaylistMutation`, both `AddTrackMutation`s) now use the
  detected playlist id instead of the literal id.
- `randomStarredArtistTracks()` now returns `{ artist, tracks }` so the chosen
  artist is known to the caller (previously only the track list was returned).
- Added a `RenamePlaylistMutation` to the final mutation set that renames the
  playlist to `${SMART_PLAYLIST_PREFIX} — ${artist.name}`. Because the new name
  still starts with the prefix, subsequent runs continue to detect it.

### `src/spotify.ts`

- Added `renamePlaylist(playlistId, name)` — wraps the underlying SDK
  `changePlaylistDetails` (cast to `any`, since it's missing from the bundled
  types) and resets the cached `allPlaylists` so the new name is picked up.
- Added `playlistByPrefix(prefix)` — returns the first playlist whose name starts
  with the given prefix.

### `src/mutations/rename-playlist-mutation.ts` (new)

- `RenamePlaylistMutation` extends `Mutation`, calling `client.renamePlaylist()`.

### `src/mutations/mutation.ts`

- Added `'rename-playlist'` to the `MutationTypes` union.

## Verification

- `npx tsc --noEmit` passes clean.
- `yarn cli:bun rule-playlist` ran end-to-end: detected the playlist by prefix,
  emptied + refilled it, and renamed it to `Smart Playlist — K.Flay`
  (`statusCode: 200`, `reason: success`).
