# 2026-04-28 — Fix demote crash and unhandled rejections in promote/demote

## Problems

1. Running `demote` when the Spotify player's `currentTrack` was momentarily
   unavailable produced a 500 from the API:

   ```
   {"error":"client.player.reset is not a function","action":"demote"}
   ```

2. Both `promote` and `demote` flows could surface `UnhandledPromiseRejection`
   errors in the CLI/server logs, e.g.:

   ```
   UnhandledPromiseRejection: "no track provided 1"
   UnhandledPromiseRejection: "cannot promote if confirmed"
   ```

## Root causes

### Broken player cache reset

Commit `8ee472f` removed the `.reset()` helper from the `@asyncMemoize`
decorator in `src/spotify.ts` (its `this` binding wrote the cache key onto the
function object instead of the instance) and updated `spotify.ts` call sites to
use `(this as any).__mem_<prop> = null` directly. It missed
`src/actions/track-action.ts:250`, where `demoteTrack()`'s no-current-track
retry path was still calling `(client.player as any).reset()`.

### Eager-fired promises that weren't always awaited

Two places kicked off promises eagerly to overlap with later work, then awaited
them only on the success path:

- `src/actions/track-action.ts` `promoteTrack()` started `currentState()` and
  `promotedState()` before the `await client.player` / `await this.track()` /
  `await getTriageInfo(...)` calls. If `promotedState()` rejected (e.g.
  `"cannot promote if confirmed"`) before the explicit `await promotedStateP`
  ran, Node's microtask scheduler flagged it as unhandled.
- `src/actions/action.ts` `performAction()` started `action.getID()` before the
  throttling block to overlap the lookup. If `action.perform()` then threw
  before any path awaited `id`, the `getID` rejection was unhandled.

## Fixes

- `src/actions/track-action.ts`: replace `(client.player as any).reset()` with
  `(client as any).__mem_player = null` (matches the pattern in `spotify.ts`).
- `src/actions/track-action.ts`: in `promoteTrack()`, validate
  `player.is_playing` and `currentTrack` first, then fan out
  `currentState()` / `promotedState()` / `getTriageInfo()` via `Promise.all`
  so any rejection propagates immediately through the awaited combinator
  instead of leaking from a dangling promise.
- `src/actions/action.ts`: drop the eager `action.getID()` call. Resolve the
  ID lazily inside the throttling block and the success path; in the 401 error
  log fall back to `'<unknown>'` if `getID()` itself rejects, since the real
  signal there is the original error being logged.
