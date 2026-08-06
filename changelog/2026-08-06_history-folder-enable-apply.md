# 2026-08-06 — History-folder tool: `--apply` enabled, write protocol transcribed

The History-folder tool (`scripts/spotify-folders/`) gains a working write
path. It was read-only by construction until now
(`2026-08-04_archive-to-history-folder-read-only.md`); this entry records
enabling `--apply` after the `rootlist/changes` protocol was **transcribed from
two real DevTools captures**, not guessed. No `.ts` behaviour beyond the tool
itself changed, and nothing in `src/` or the Lambda package was touched.

## What changed

| Change | Detail |
|---|---|
| `--apply` now writes | The flag drives the convergence loop in `apply.ts`: GET → prepend one archive → GET → recompute, until History is up to date. **No confirmation prompt** — it applies the plan it just printed. |
| Default is still a dry run | A bare invocation prints the prepend plan and issues **no POST**. Unchanged from the read-only build. |
| `WRITE_MODE` flipped | `'disabled'` → `'enabled'` in `rootlist.ts`. It is now defence-in-depth beneath the CLI flag, not the primary gate. |
| Write path isolated | The entire write capability lives in `scripts/spotify-folders/apply.ts`, imported **only** on the `--apply` branch of the CLI. The dry-run path never imports it. |

## The transcribed protocol

Transcribed from two real captures — a plain in-folder drag and a drag-onto-folder.
Recorded in full (redacted) in `docs/rootlist-capture.md §9`. Redacted essentials:

- **Endpoint:** `POST https://spclient.wg.spotify.com/playlist/v2/user/<userId>/rootlist/changes`
  — same host/path base as the rootlist GET, with `/changes` appended.
- **Headers:** the same auth set as the GET (`authorization: Bearer …`,
  `client-token: …`, `app-platform: WebPlayer`, `accept: application/json`)
  **plus `content-type: application/json`**.
- **Body (no `baseRevision`):**

  ```json
  {"deltas":[{"ops":[{"kind":"MOV","mov":{"items":[{"uri":"<playlist>","attributes":{}}],"addAfterItem":{"uri":"<anchor>","attributes":{}}}}],"info":{"source":{"client":"WEBPLAYER"}}}]}
  ```

- **`attributes` is sent as empty `{}`** for both the moved item and the anchor,
  even though the GET decorates items with `timestamp`/`public`.

### The id-only start-group anchor — the subtlety, and the bug it prevents

Prepending to the **front of a folder** means anchoring the move `addAfterItem`
to the folder's start-group marker in **ID-ONLY** form:

| Where | Marker form |
|---|---|
| Rootlist **GET** renders | `spotify:start-group:<folderId>:<name>` (with the name) |
| The **write** must send | `spotify:start-group:<folderId>` (name stripped) |

Dragging a playlist **onto** a folder in the web player produces exactly this,
and the moved item becomes the folder's first child (top of the folder). The
trap: reusing the GET's marker URI verbatim carries the `:<name>` suffix, which
is the wrong anchor. The tool builds the anchor from the id
(`buildStartGroupAnchorUri`) rather than echoing the GET's URI, so the write is
well-formed by construction and a golden test pins the exact bytes.

## Concurrency and convergence

- **No `baseRevision` is sent.** The captures carry none; optimistic-concurrency
  is replaced by re-reading live state after every write.
- **One `MOV` per POST** (sequential convergence), **oldest archive first** so
  the newest is prepended last and ends up on top.
- The convergence loop recomputes the plan from a fresh GET each iteration —
  **never a blind replay**.

## Safety scaffolding on the write path

| Guard | Behaviour |
|---|---|
| Pre-write backup | A **credential-free** snapshot + plan is written to `~/Library/Application Support/spotify-playlist/rootlist-backups/<timestamp>.json` before the **first** POST; the path is printed. Owner-only file/dir modes. |
| Per-iteration verify | Every iteration re-reads live state before deciding the next move — no blind replay after an uncertain write. |
| 401/403 fatal | A dead bearer stops the run immediately; it is never a retry case. |
| Two bounds | Stall detector = **5** consecutive no-progress iterations; runaway backstop = **3 × moves + 10**. |
| `WRITE_MODE` kill switch | Set it back to `'disabled'` and `postRootlistChanges` throws before building any request, and `authorizeWrites()` returns `null` so the loop cannot be entered. |

**Re-running after any interruption is safe.** The reconciler recomputes desired
state from a fresh read, so a partially-applied run is an intermediate state, not
a corrupt one — running the command again drives it the rest of the way.

## How to run it

```bash
# dry run — prints the prepend plan, issues no POST (default)
bun run scripts/spotify-folders/move-archives-to-folder.ts

# apply — performs the writes, no confirmation prompt
bun run scripts/spotify-folders/move-archives-to-folder.ts --apply
```

Credentials (`SPOTIFY_SPCLIENT_TOKEN`, `SPOTIFY_CLIENT_TOKEN`, `SPOTIFY_USER_ID`)
are exported into an ephemeral shell, never `.env` — see `AGENTS.md`.

## Recovery

- **Re-run the command.** It converges from wherever it stopped.
- The backup file is **manual-restore evidence** — an exact record of original
  anchors. There is no automatic `--restore`; that is deliberately out of scope.

## Live status — stated honestly

- The protocol is transcribed from real captures, and the tool has been
  **verified only in dry-run**.
- **The first real `--apply` will be the first live write** against the account.
  No live apply has been performed. That first write is protected by the
  pre-write backup and per-iteration verify above.
- `spclient.wg.spotify.com` remains an **unofficial, private, unversioned**
  endpoint. It can change or break at any time; the transport validates
  responses and the loop fails closed.

## Code touch points

| Area | Change |
|---|---|
| `apply.ts` | New/updated wire types (`RootlistItemRef`, `RootlistMovOp`, `RootlistDelta`, `RootlistChangeRequest`), `buildStartGroupAnchorUri`, `buildPrependRequest`, `requestForMove`, and the live `postRootlistChanges` + `convergeMovePlan` + backup writer + `authorizeWrites`. |
| `planner.ts` | Exposes `historyFolderId` on the plan (so the anchor can be built from it) and adds a `mode: 'dry-run' \| 'apply'` parameter to `formatMovePlan`. |
| `move-archives-to-folder.ts` | New `runApply` write path and `--apply` wiring; imports `authorizeWrites`/`convergeMovePlan` from `apply.ts` only on the apply branch. |
| `rootlist.ts` | `WRITE_MODE` flipped `'disabled'` → `'enabled'`; header comments updated to match. |
| Tests | Golden wire-format assertions (`buildPrependRequest`/`requestForMove` emit the transcribed envelope with the id-only anchor), a convergence test (one prepend, then a re-read that converges), and confirmation that the dry run issues no POST. |

## Gates

| Check | Result |
|---|---|
| `bun test scripts/spotify-folders` | **109 pass** |
| `bun run typecheck` (root) + tool tsc | both exit **0** |
| `bunx prettier --check scripts/spotify-folders` | clean |
| Root program file count (`tsc --listFiles`) | **61 project files, unchanged** |

## Documentation updated alongside

- `docs/rootlist-capture.md` — §9 rewritten from "apply strategy not determined /
  never called" to the transcribed `rootlist/changes` protocol (redacted).
- `AGENTS.md` — the local-only-tool section now documents `--apply` as writing.
- `docs/archive-to-history-folder-plan.md` — Revision 6 note added.
