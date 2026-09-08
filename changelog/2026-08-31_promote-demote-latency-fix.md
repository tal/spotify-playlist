# 2026-08-31 — Promote/Demote Latency: Parallel Paging + Hammerspoon off the Zombie Build

## The complaint

"Sometimes when I promote/demote it does the player action but not the
playlist/liked change." Refined mid-debug to: **it does happen, just with a
huge delay** — so the player skip lands instantly and the playlist/liked change
shows up several seconds later, reading as "nothing happened."

## Diagnosis (measured against the live `koalemos` account)

Not the throttle, not a lost mutation — pure read latency. The read waterfall a
single promote/demote runs, before any mutation fires:

| Read              | Time     | Why                                              |
| ----------------- | -------- | ------------------------------------------------ |
| `player`          | ~585ms   | current playback state                           |
| **`allPlaylists`**| **~3.2s**| **264 playlists, paged 50 at a time, 6 sequential round-trips** |
| `inbox tracks`    | ~1.5s    | 122 tracks, 2 pages                              |
| `current tracks`  | ~0.4s    | 14 tracks, 1 page                                |
| **TOTAL (reads)** | **~5.8s**| before a single add/remove/save                  |

`allPlaylists()` was the whale: it walked `response.body.next` one blocking
fetch at a time just to resolve `Inbox`/`Current`/`Starred` by name — 6
back-to-back round-trips on **every** action. Node/Bun process boot was measured
at 0.06s and is a non-factor.

## What changed

### `src/spotify.ts` — parallel pagination (no behavior change)

- `allPlaylists()` and `tracksForPlaylist()` now read page 1 for `total`,
  compute every remaining offset, and fetch them with a single `Promise.all`
  instead of chasing `next` sequentially. The Spotify paging object exposes
  `total` (confirmed `total=264`), so all offsets are known after page 1.
- Result: `allPlaylists` **3213ms → 927ms**; full read waterfall **5766ms →
  3163ms** (~45% off). `tracksForPlaylist` on Inbox barely moves because it is
  only 2 pages — the win scales with page count, and `allPlaylists` is where the
  pages are.

### `src/cli-bun.ts` — piped output is now machine-readable

- The success print used to be pretty (multi-line) JSON always. Hammerspoon
  captures stdout over a pipe and its parser only decodes the **last line** that
  starts with `{`/`[`; multi-line pretty JSON left it decoding a lone `{` and
  showing "Unparsable response."
- Now: pretty JSON when `process.stdout.isTTY` (a real terminal), **compact
  single-line** JSON when piped. A throttled promote now surfaces its
  `reason: "throttled"` in the macOS notification instead of a parse error.

### `~/.hammerspoon/init.lua` — off the stale build (external file)

- The local task ran `/opt/homebrew/bin/node ./dist/cli.js` — but `dist/` is a
  **stale Aug-2 build from before the Bun-on-Lambda migration** that was supposed
  to delete it. Every keypress executed pre-migration code.
- Now runs `/Users/tal/.bun/bin/bun src/cli-bun.ts` — current source, via Bun,
  in the same working directory. `luac -p` confirms the config still parses (a
  broken `init.lua` would disable every hotkey).
- **Requires a manual Hammerspoon "Reload Config"** to take effect (`hs` IPC CLI
  is not installed).

## Notes / non-obvious findings surfaced along the way

- **It's prod, always.** Hammerspoon decides local-vs-remote by
  `dirExists(~/Projects/spotify-playlist)`; the repo exists here, so it never
  hits the remote endpoint. Local `.env` has no `NODE_ENV`, so `dev.isDev` is
  false → **prod settings / real `Inbox`/`Current`** (not the `Test`
  playlists). The remote fallback URL also points at the `NODE_ENV=prod`
  `spotify-playlist-dev` Lambda. There is no dev path.
- **Latent, not fixed here:** `MagicPromoteAction`'s throttle is `promote:<uri>`
  with `promoteThrottleMs = 5h` in prod. Promote is two-step (Unheard→Liked,
  then Liked→Current) on the same URI, so a second promote of the same track
  within 5h is **silently throttled**. `promotes`/`demotes` skip after each
  press so you rarely land on the same track twice, but a plain `promote`
  (⌥⌃↑) pressed twice on one track will no-op the second press. Left as-is.

## Verification

- `bun run typecheck` clean for the two changed source files. (A pre-existing
  error in `src/__tests__/undo-plan.test.ts` from unrelated uncommitted WIP is
  not from this change — confirmed by stashing only these two files.)
- `bun test`: **577 pass / 0 fail**.
- Read waterfall re-measured live: 5766ms → 3163ms.
- Piped `cli-bun.ts` output confirmed to be a single valid JSON line; the
  `{result:[…]}` promote/demote shape decodes to `action_type`.
- Not deployed to Lambda — `spotify.ts` parallel paging also benefits the
  remote path, but `ruby scripts/publish.rb` still has to run to ship it there.
