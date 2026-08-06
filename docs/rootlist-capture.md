# Rootlist Capture — Proven Wire Contract

**Date:** 2026-08-04 (§9 write protocol added 2026-08-06)
**Branch:** `move-to-folder`
**Status:** GET proven read-only 2026-08-04. **Write protocol (`rootlist/changes`)
transcribed from real captures 2026-08-06 — see §9.** As of that date `--apply`
performs writes; a bare invocation remains a dry run.
**Tool it documents:** `scripts/spotify-folders/` (see `rootlist.ts`, which cites this file)

This is the redacted evidence record for the private-API transport used by the
History-folder tool. Everything below was established against the live account
with real requests, except where explicitly marked *read out of the shipped
client bundle* or *not tested*.

**No credential appears in this file, and none may ever be added to it.** The
bearer, the `client-token`, and the `sp_dc` / `sp_key` cookies are secrets. So is
a full rootlist capture — it is a map of a private library — so no snapshot is
stored here either. The only committed capture is the trimmed, redacted fixture
at `scripts/spotify-folders/__tests__/fixtures/rootlist.sample.json`.

---

## 1. Why this file exists

The transport in `rootlist.ts` looks over-specified: an exact `Accept` header, a
`truncated` check on a request that returned everything, a 401 that is fatal
rather than retried. Each of those is a response to something observed here. A
future maintainer chasing a Spotify-side breakage should read this before
concluding the code is paranoid.

---

## 2. Credentials — how they are obtained

Three values, two of them secret:

| Value | Secret? | What it is |
|---|---|---|
| `SPOTIFY_SPCLIENT_TOKEN` | **yes** | web-player bearer, *without* the `Bearer ` prefix. ~60 min lifetime |
| `SPOTIFY_CLIENT_TOKEN` | **yes** | anti-abuse `client-token` request header value |
| `SPOTIFY_USER_ID` | no | the user id embedded in the rootlist path |

Export them into an ephemeral shell. **Never** write them into `.env`: a
`.env` in this worktree is auto-loaded into every future agent session in this
directory by a `SessionStart` hook, which turns a one-hour secret into a
long-lived one sitting on disk. The tool deliberately has no `dotenv` call.

### 2a. Manual capture (robust path — prefer this)

DevTools → Network → filter `spclient` → click any request to
`spclient.wg.spotify.com` → copy `authorization` (drop `Bearer `) and
`client-token` from Request Headers. The user id is in the request path:
`/playlist/v2/user/<USER-ID>/rootlist`. The tool prints these instructions on
its missing-credentials path.

### 2b. Automated mint (fragile — best-effort only)

Recorded because it was what actually worked in this session, not because it is
recommended.

- **The documented cookie-only GET is dead.** With a valid cookie jar,
  `GET https://open.spotify.com/api/token?reason=transport&productType=web_player`
  returns **HTTP 400** `{"error":{"code":400,"message":"Unauthorized request"}}`.
  `reason=init` is identical. `https://open.spotify.com/get_access_token?...`
  returns **403 URL Blocked** at the CDN.
- Spotify now requires TOTP anti-bot parameters. The algorithm was **derived from
  the live client**, not hardcoded: fetch the web-player bundle referenced by
  `open.spotify.com` (at the time, `https://open.spotifycdn.com/cdn/build/web-player/web-player.<hash>.js`)
  and read it out. The bundle ships a table of secret/version pairs — **versions
  rotate**; at capture time they were 61, 60, 59 and the *first* entry is used.
  Each secret is a JS string transformed as
  `chars.map((c, i) => c.charCodeAt(0) ^ (i % 33 + 9))`, joined, then hex-encoded
  into the HMAC key. TOTP is **SHA1, 6 digits, period 30**.
- Server time comes from an unauthenticated
  `GET https://open.spotify.com/api/server-time` → `{"serverTime": <epoch seconds>}`.
- The mint is then
  `GET https://open.spotify.com/api/token?reason=transport&productType=web_player&totp=<code(Date.now())>&totpServer=<code(serverTime*1000)>&totpVer=<version>`
  with the cookie jar. Result: **HTTP 200**, `application/json`, keys
  `clientId, accessToken, accessTokenExpirationTimestampMs, isAnonymous, _notes`,
  with `isAnonymous: false` (the cookie authenticated), lifetime ~60 min.
- The `client-token` is minted by the **only POST issued in the entire run**, and
  it is a read-only token exchange that mutates nothing in the account:
  `POST https://clienttoken.spotify.com/v1/clienttoken`, headers
  `Accept: application/json` + `Content-Type: application/json`, body
  `{"client_data":{"client_version":"<web player version>","client_id":"<clientId from the token mint>","js_sdk_data":{"device_brand":"unknown","device_model":"unknown","os":"macos","os_version":"unknown","device_id":"<random hex>","device_type":"computer"}}}`
  → **HTTP 200**,
  `{"response_type":"RESPONSE_GRANTED_TOKEN_RESPONSE","granted_token":{token, expires_after_seconds: 1216800, refresh_after_seconds, domains:[...]}}`.

This path is **version-pinned to a rotating secret table** and will break without
notice. Treat 2a as the supported ritual and 2b as an archaeology note.

### 2c. `GET /v1/me` was unavailable

The user id could **not** be resolved the documented way.
`GET https://api.spotify.com/v1/me` returned **HTTP 429 `API rate limit
exceeded` on 12 consecutive attempts over ~6 minutes** (Retry-After 5s, then a
steady 57s), with and without the `client-token` header.
`GET /me/playlists?limit=50` likewise returned 429 six times and never yielded
page 1. Two read-only fallbacks were probed and rejected:
`spclient.wg.spotify.com/user-profile/v3/profile` (404) and
`/user-profile-view/v3/profile` (404).

Resolved instead by taking the repo's hardcoded partition key `koalemos`
(`src/index.ts:87`, `src/reauth.ts:85`) as a *candidate* and **confirming it with
a successful authenticated read**: the rootlist GET for that id returns 200 with
`ownerUsername: "koalemos"` on the user's own playlists. That is proof by
successful read, not by `/v1/me` — recorded as such rather than claimed as the
check the plan wrote.

---

## 3. The rootlist GET

```
GET https://spclient.wg.spotify.com/playlist/v2/user/<URL-ENCODED-USER-ID>/rootlist
    ?decorate=revision,attributes,length,owner,capabilities,status_code
    &market=from_token
```

**HTTP 200**, `Content-Type: application/json`, `content-encoding: zstd`,
`cache-control: private, max-age=0`. 561KB decoded, 307 entries on this account.

**JSON is genuinely available — the Phase 0 protobuf gate is cleared.** No
protobuf decoder is needed, *provided* the `Accept` header is right.

### 3a. Header matrix (determined empirically, 4 cases)

| Header | Required? | What happens without it |
|---|---|---|
| `Authorization: Bearer <token>` | **REQUIRED** | 401 with an **empty body and no content-type** |
| `Accept: application/json` | **REQUIRED for JSON** | 200 with `Content-Type: application/octet-stream` and a ~110KB **protobuf** body (first bytes `0a 18 00 00 07 57 …`). Same for `Accept: */*`, `application/protobuf`, or no `Accept` at all |
| `client-token` | not required | request still returns 200 |
| `app-platform: WebPlayer` | not required | request still returns 200 |

The minimal working set is therefore just `Authorization` + `Accept`. The tool
sends `client-token` anyway, because it is cheap and Spotify may start enforcing
it. **`Accept: application/json` is load-bearing** — dropping it silently swaps
the response format rather than erroring, which is exactly the kind of failure
that looks like a parser bug.

`decorate` is also load-bearing: **with no query params at all the response drops
`metaItems` entirely** and shrinks from 561KB to 32KB. Playlist names live only
in `metaItems`.

---

## 4. Response body shape

Top level has exactly five keys:

| Key | Type | Meaning |
|---|---|---|
| `revision` | string | rootlist revision (see §5) |
| `length` | number | **TOTAL library size (307), not the count returned** |
| `attributes` | object | `{}` on this account |
| `contents` | object | see below |
| `timestamp` | string | ms epoch, as a string |

`contents` has exactly four keys: `pos` (offset of the first returned entry),
`truncated` (boolean), `items` (array), `metaItems` (array).

- `items[i]` is `{ uri: string, attributes: { timestamp: string, public?: boolean } }`.
  The key union across all 307 entries is exactly `attributes, uri`.
- `metaItems[i]` is **positionally parallel** to `items[i]`. Key union:
  `attributes, capabilities, length, ownerUsername, revision, statusCode`.
- The playlist name lives at `metaItems[i].attributes.name`.

### Two traps a naive parser falls into

1. **`metaItems[i]` is `{}` for every start-group and end-group marker.** Folder
   names exist **only in the URI**. There is no decorated name field for a
   folder.
2. **An inaccessible playlist yields a metaItem with no `attributes` and no
   `revision`, but a `statusCode` of 404 or 403** (2 such entries on this
   account). A parser that assumes `attributes.name` exists will crash or produce
   a silent `null` name. The tool reads a missing name as `null` and reports
   those entries as untouched rather than guessing.

---

## 5. Revision

There are two independent `revision` values: the top-level rootlist revision, and
a per-playlist `revision` on each `metaItems[i]` (that playlist's own revision,
not the rootlist's).

The rootlist revision is base64 of 24 bytes: a **4-byte big-endian change
counter** (1879 at capture time) followed by a 20-byte digest — 32 base64 chars.

**It is not a credential** and is safe to log or snapshot. The tool carries it
through the plan for the (disabled) write path, where it would be the
optimistic-concurrency token.

---

## 6. Truncation and paging

`contents.truncated` is the **authoritative** signal, cross-checked against
`length` (total) vs `contents.items.length` (returned) vs `contents.pos`
(offset).

With no paging params this account returned all 307 entries with
`truncated: false`, so no server-side cap was hit at 307. **Paging is proven and
explicit:**

- `&from=0&length=5` → 5 items, `truncated: true`, `pos: 0`, `length: 307`
- `&from=5&length=5` → the next 5, `pos: 5`

A transport must therefore still check `truncated` rather than trusting a single
unbounded GET. `rootlist.ts` rejects a truncated snapshot instead of planning
against a partial library — planning against a partial rootlist could mistake a
playlist that simply wasn't returned for one that isn't in History.

---

## 7. Folder markers

```
spotify:start-group:<id>:<encodedName>
spotify:end-group:<id>
```

Captured verbatim from this account:
`spotify:start-group:46758b97bb37b942:History` /
`spotify:end-group:46758b97bb37b942`.

- Ids are lowercase hex of 8 random bytes rendered **without leading-zero
  padding** — observed lengths 15 *and* 16 (`a6bbaa776ad1344` is 15). A
  fixed-width id regex is wrong.
- **A start-group URI is legal with 2 OR 3 colon-separated args.**
  `spotify:start-group:<id>` with no name segment is valid and the client emits
  it. An end-group is always exactly 2 args.

### Name encoding — read out of the bundle, NOT observed

None of this account's six folder names (History, Others, Curated, Current,
Events, Artists) contains a space or a reserved character, so every observed name
segment is a bare token. The rules below come from the shipped web-player bundle,
not the wire:

- **Encode:** `encodeURIComponent(name.replace(/\s+/g, ' '))` then
  `.replace(/%20/g, '+')` — percent-encoding with **spaces as `+`** and
  whitespace runs collapsed to a single space. The general URI-component encoder
  additionally maps `[!'()]` via `escape()` and `*` → `%2A`.
- **Decode:** `decodeURIComponent(segment.replace(/\+/g, '%20'))`.

`decodeFolderName` in `planner.ts` implements the decode side and falls back to
the raw segment on a malformed escape.

### Deliberate tightening

The client's own stack parser pops with `stack.findIndex(f => f.hash === id)` and
truncates — it **tolerates unbalanced markers** rather than erroring. The tool
treats a mismatched or unbalanced marker as a hard failure instead. That is a
conscious divergence: the client is rendering a sidebar, the tool is deciding
what to move.

---

## 8. Ordering — REPORT-ONLY (user override)

Order on the wire is **meaningful and stable**. Two identical back-to-back GETs
returned byte-identical URI sequences (307 entries, deep-equal), the same
`revision`, and the same `timestamp`. It is insertion/custom order, definitively
**not** sorted: History's children run *descending* by month (2026 - June,
2026 - May, 2026 - April, …) with `Your Top Songs 20XX` interleaved at
semantically meaningless positions.

**Plan invariant 7 (chronological ordering inside History) is REPORT-ONLY by
explicit user decision.** The desired-sequence comparison, the corrective-reorder
planner, and the ordering tests were **not built**. The dry run prints current
History order labelled "order informational only", and the plan is "append
eligible candidates, order unspecified".

Phase 0A-3 (whether the Spotify *client* even displays wire order, vs. a sidebar
sort mode) was **not tested** — it needs the desktop/web UI, not a terminal. Moot
under the override.

---

## 9. The `rootlist/changes` write protocol (transcribed 2026-08-06)

> **Supersedes the prior "Apply strategy (Phase 0E) — NOT DETERMINED" note.**
> That note recorded that `POST .../rootlist/changes` had never been called and
> the apply strategy was unchosen. Both are now resolved by evidence: the
> protocol below was **transcribed from two real DevTools captures** of the web
> player on 2026-08-06 — a plain in-folder drag and a drag **onto** a folder.
> `WRITE_MODE` in `rootlist.ts` is now `'enabled'` and `--apply` performs writes.

This is evidence, not a sketch. Every field below appears in a captured request.
No credential is recorded here; playlist/user ids are placeholders.

### 9a. Endpoint and headers

```
POST https://spclient.wg.spotify.com/playlist/v2/user/<userId>/rootlist/changes
```

Same host/path base as the rootlist GET, with `/changes` appended. Headers are
the GET's auth set **plus** a content type:

| Header | Value |
|---|---|
| `authorization` | `Bearer <token>` |
| `client-token` | `<client-token>` |
| `app-platform` | `WebPlayer` |
| `accept` | `application/json` |
| `content-type` | `application/json` |

### 9b. Body shape — no `baseRevision`

```json
{"deltas":[{"ops":[{"kind":"MOV","mov":{"items":[{"uri":"<playlist>","attributes":{}}],"addAfterItem":{"uri":"<anchor>","attributes":{}}}}],"info":{"source":{"client":"WEBPLAYER"}}}]}
```

- `deltas[].ops[]` is a list of `MOV` ops; `mov.items` are placed immediately
  **after** `mov.addAfterItem`.
- `attributes` is captured as an **empty `{}`** for both the moved item and the
  anchor — even though the GET (§4) decorates items with `timestamp`/`public`.
- `info.source.client` is the literal `"WEBPLAYER"`.
- **No `baseRevision` is present.** The captures carry none. Optimistic
  concurrency is therefore *not* used; see §9d.

### 9c. Prepend-to-front-of-folder — the id-only start-group anchor

To land a playlist as a folder's **first child** (top of the folder), the
`addAfterItem.uri` is the folder's **start-group marker in ID-ONLY form**:

| Context | Marker form |
|---|---|
| Rootlist **GET** renders (§7) | `spotify:start-group:<folderId>:<name>` (with the name) |
| The **write** must send | `spotify:start-group:<folderId>` (name segment stripped) |

Dragging a playlist **onto** the folder in the web player produces exactly this
id-only anchor. **Subtlety worth stating loudly:** the GET's marker for the same
folder carries the `:<name>` suffix (§7 confirms a 3-arg start-group is legal),
so a writer that reuses the GET's URI verbatim sends the wrong anchor. Build the
anchor from the folder id, never by echoing the GET's marker string.

### 9d. Concurrency — convergence, not `baseRevision`

Because no `baseRevision` is sent, the tool does not attempt optimistic
concurrency at all. Instead:

- **One `MOV` op per POST** (sequential convergence).
- After every write the tool **re-reads live state** and recomputes, rather than
  batching or chaining anchors across ops.
- Ordering: **oldest archive first**, so the newest is prepended last and ends
  up on top.

### 9e. Still unproven, stated honestly

- The protocol is **transcribed**, and the tool is **verified only in dry-run**.
  The first real `--apply` will be the first live `POST .../rootlist/changes`
  against the account. It is protected by a pre-write credential-free backup
  (`~/Library/Application Support/spotify-playlist/rootlist-backups/<timestamp>.json`)
  and by the per-iteration re-read.
- Multi-op batching and chained-anchor behaviour were **not** exercised — the
  tool deliberately sends one op per POST, so it never depends on them.
- This remains an **unofficial, private, unversioned** endpoint that can change
  or break without notice.

---

## 10. Live account preconditions (as of 2026-08-04)

| Check | Result |
|---|---|
| `History` folder | Exactly one, root level, `spotify:start-group:46758b97bb37b942:History` at item index 11, closed at index 192 |
| Root-level folders | Six, none nested: History, Others, Curated, Current, Events, Artists |
| Nested folders inside History | **Zero.** The marker tree under History is flat |
| History direct children | 180 |
| Eligible root-level production archives | **One:** `2026 - July` |
| Root-level `[Test] ` archives | Zero. Zero anywhere |
| Duplicate production year/month keys | **Zero** across all 307 entries (130 names parse as `YYYY - MonthName`, 130 distinct keys) |

### Precondition failure: plan invariant 6

**History does not contain only production archive playlists.** Of its 180 direct
children, 51 are not:

- 11 Spotify editorial playlists (`Your Top Songs 2016`–`2025`, `Your Summer Rewind`)
- 40 legacy hand-named archives the production naming rule cannot parse:
  `2015 - Sept`, `2016 - Feb/Mar`, `2013 - Oct (CMJ)`, `2017 - April/May`,
  `2015 - CMJ`, `2012 - Apr`, …

The plan originally said to stop and re-plan here. **As of revision 5
(2026-08-05) the tool does neither — it tolerates this by default.** Unrelated
content in History is expected: those 51 are reported ("left untouched") and
never moved. A nested folder inside History is tolerated too; the tool no longer
validates History's contents at all, only that exactly one root-level `History`
folder exists. See "Revision 5 — additive prepend model" in
`docs/archive-to-history-folder-plan.md`.

Related hazard for any future looser parser: the 40 legacy names are invisible to
the strict parser, so loosening it could surface new collisions — e.g.
`2012 - Apr` (legacy, in History) against a hypothetical `2012 - April`.

### Scope collapse

**The entire backfill is one move.** 129 production archives are already in
History; exactly one (`2026 - July`) sits at root. The ongoing case is one move
per month. The plan's dry-run sketch assumed 19 eligible root archives.

### Caveat on the duplicate check

The duplicate grouping was computed from the **private rootlist capture**, not
from `GET /me/playlists` as plan step 0A-4 specifies, because the public API was
429-blocked (§2c). The rootlist is a superset of the sidebar library so it is
arguably the stronger source — but it is not the check the plan wrote, and is
reported as such.

---

## 11. Redaction rules for anyone extending this file

- Never paste a bearer, a `client-token`, a cookie, or a "Copy as cURL" command
  containing them. Reference the env var (`$SPOTIFY_SPCLIENT_TOKEN`), never the
  literal.
- Never commit a full rootlist capture. It is a private library map. `.gitignore`
  does **not** cover `docs/*.json` or `scripts/**/*.json`.
- Placeholders must be angle-bracketed descriptions (`<paste the bearer here>`),
  never a plausible-looking string that could be mistaken for a real value.
- Revisions, folder ids, and playlist names are rootlist-derived and safe.

---

## Appendix — text applied to `AGENTS.md`

This section was drafted here first, before `AGENTS.md` itself was updated, so
the exact wording could be reviewed against the evidence above before landing
in the project's primary agent-guidance file. It has since been applied
(2026-08-04, Phase 7) — see `AGENTS.md`'s "Local-only tool:
`scripts/spotify-folders/`" section and its Changelog entry. Left here
verbatim as a record of what was proposed and what shipped; the two should
match.

> ### Local-only tool: `scripts/spotify-folders/`
>
> Moves root-level `YYYY - MonthName` archive playlists into the `History`
> folder. **Local-only, never deployed** — top-level `scripts/` is not in
> `publish.rb`'s `PAYLOAD` allowlist, so it is never staged into `build/lambda`.
> It uses Spotify's **private** `spclient` rootlist API, which is undocumented,
> unversioned, and unsupported. Expect it to break without notice.
>
> ```bash
> # dry run — purely additive: prepends eligible root archives to History's
> # front (newest first) and never reorders or removes anything already there.
> # Unrelated and legacy-named playlists in History are expected, left untouched.
> bun run scripts/spotify-folders/move-archives-to-folder.ts
>
> # typecheck the tool (it is outside the root tsconfig's rootDir)
> bunx tsc -p scripts/spotify-folders/tsconfig.json
> ```
>
> _(Updated 2026-08-05: the old `--tolerate-unrelated-history` flag is gone — see
> "Revision 5 — additive prepend model" in the plan doc.)_
>
> `--apply` is **hard-disabled** and exits non-zero. This build is read-only by
> construction: `WRITE_MODE = 'disabled'` in `rootlist.ts` gates every write path,
> and the CLI refuses `--apply` before it reads credentials or touches the
> network.
>
> Environment: `SPOTIFY_SPCLIENT_TOKEN` and `SPOTIFY_CLIENT_TOKEN` are
> **short-lived secrets** (~1 hour); `SPOTIFY_USER_ID` is not secret. Export them
> in an ephemeral shell — **never** in `.env`, because a `SessionStart` hook
> auto-loads `.env` into every future agent session in this directory. Capture,
> redaction, and the full wire contract are in `docs/rootlist-capture.md`.
>
> `tsconfig.json`'s `exclude` now lists `scripts` so that a `.ts` file under
> top-level `scripts/` cannot break `bun run typecheck` with TS6059 (`rootDir` is
> `./src`). The tool has its own `scripts/spotify-folders/tsconfig.json`.
