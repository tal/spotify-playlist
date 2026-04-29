# 2026-04-28 — Fix demote crash from broken player cache reset

## Problem

Running `demote` when the Spotify player's `currentTrack` was momentarily
unavailable produced a 500 from the API and an unhandled promise rejection in
the CLI:

```
{"error":"client.player.reset is not a function","action":"demote"}
UnhandledPromiseRejection: "no track provided 1"
```

## Root cause

Commit `8ee472f` ("Fix duplicate archive playlist creation via broken cache
reset") removed the `.reset()` helper from the `@asyncMemoize` decorator in
`src/spotify.ts` because its `this` binding wrote the cache key to the function
object instead of the instance. The fix updated `spotify.ts` call sites to use
`(this as any).__mem_<prop> = null` directly but missed
`src/actions/track-action.ts:250`, which was still calling
`(client.player as any).reset()` inside `demoteTrack()`'s no-current-track
retry path.

The unhandled rejection was a downstream effect: `performAction()` in
`src/actions/action.ts` starts `action.getID()` eagerly without `await` so it
can run in parallel with throttling lookups. When `perform()` then threw,
control left the function before any `await id` ran, leaving the rejected
promise unhandled.

## Fix

- `src/actions/track-action.ts`: replace the broken `.reset()` call with the
  same `(client as any).__mem_player = null` pattern used elsewhere in the
  codebase.
- `src/actions/action.ts`: attach a no-op `.catch(() => {})` to the eager
  `action.getID()` promise so a rejection here can't become unhandled. The
  rejection still propagates wherever `id` is explicitly awaited later.
