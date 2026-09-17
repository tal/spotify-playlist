# 2026-09-17 — Dashboard: album-art thumbnails on every track row

Each track row (Current, Inbox, Recently promoted, Recently archived) now shows
its album-art thumbnail beside the track name.

## Changes

- **`src/album-art.ts`** (new): `albumArt(images)` picks a small thumbnail URL
  from Spotify's `album.images` — the smallest image ≥ 64px, else the largest —
  and returns `null` when there's no artwork, so callers always get a
  `string | null`. Unit-tested in `src/__tests__/album-art.test.ts`.
- **`src/spotify.ts`**: `recentSavedTracks` now returns `image` (it previously
  dropped `album.images`). This is what gives the Unheard → Liked promote rows
  their art; the playlist-sourced feeds already had `album.images` on their raw
  items.
- **Feed plans** each project a new `image: string | null`:
  - `current.ts` — `currentPlan` computes it from the snapshot's
    `track.album?.images`; `listenStatsPlan` **strips** `image` to preserve its
    exact original JSON contract.
  - `inbox.ts` — `gatherInbox` computes it onto the entry; `inboxPlan` emits it.
  - `archived.ts` — `gatherArchived` computes it onto the entry (`ArchiveEntry.track`
    widened to `BasicTrackData & { image?: string | null }`, so the global
    `BasicTrackData`/action-history shape is untouched); `archivedPlan` carries it
    through its spread.
  - `promotes.ts` — both event streams set `image` (Current from
    `track.album?.images`, Liked from `recentSavedTracks`); `promotesPlan` emits it.
- **`src/web/app.js`**: extracted a shared `songCell(track)` (all three renderers
  built an identical song cell) that renders `<img class="art">` (lazy-loaded,
  decorative `alt=""`, 44×44) beside the track link, and omits it when
  `track.image` is null.
- **`src/web/index.html`**: `.song` is now a flex row; added `.art` (44px rounded
  square, `object-fit: cover`) and a `.song-text` wrapper.

## Verified

- `bun run typecheck` clean; `bun test` 575 pass / 0 fail (added 5 album-art
  tests; web feed/routing suites unchanged and green).
- `node --check src/web/app.js` clean.
- DOM/fetch shim render check: a track with `image` renders
  `<img class="art" src=… alt="" loading="lazy">`; a track with `image: null`
  renders no `<img>` and still shows the link.
