# Playlist Folders: Research Report

**Date:** 2026-08-02
**Updated:** 2026-08-04 — Option D is now **partially implemented, local-only,
write-disabled**. See §8.
**Status:** Research, plus one shipped read-only tool
**Question:** Can we create archive playlists directly inside a Spotify folder?

> **2026-08-04 corrections.** Two claims below were true when written and are now
> stale:
>
> - **§1 — the matcher exists.** This report says the naming convention is
>   detected by `isArchivePlaylistName()` "in `src/settings.ts`". That function is
>   no longer a property of the settings object. `src/settings.ts` today exports
>   two factories: `buildArchiveNamer(prefix?)` and `buildArchiveMatcher(prefix?)`.
>   The matcher's own docstring designates it "the only machine-readable statement
>   of the archive name format". The namer returns an inner function still
>   literally named `archivePlaylistNameFor`, taking a destructured
>   `{ added_at }` ISO string — not a bare string or `Date`.
> - **§3 — a headless browser is not required.** This report asserts that "every
>   project that automates this drives a headless browser" and that "there is no
>   machine-to-machine path". Both credentials were obtained from a **terminal**
>   with `curl` and a cookie jar, no browser process — see
>   `docs/rootlist-capture.md` §2b. The path is fragile and version-pinned, but
>   it exists. The §3 conclusion (this is the entire cost of the feature) still
>   holds for a *Lambda-resident* implementation; it does not hold for a local
>   one-shot tool.

---

## TL;DR

- The **public Web API has zero folder support.** Not a quota-mode restriction — folders are simply not modeled anywhere in the public API.
- A **private API does exist and is well documented by reverse-engineering projects**: `spclient.wg.spotify.com/playlist/v2/user/{userId}/rootlist`.
- Folders there are **not containers** — they are marker entries in a flat ordered list.
- The blocker is **not** the API shape, it is **authentication**: `spclient` requires a web-player access token plus an anti-abuse `client-token`, neither obtainable through normal OAuth.
- **Recommendation: do not build on this.** The cost is a headless browser in Lambda; the benefit is cosmetic. Options are laid out below if we decide otherwise.

---

## 1. Public Web API — confirmed dead end

| Capability | Status |
|---|---|
| `POST /me/playlists` | Creates at the **root** of the library. No `folder_id` / `parent` parameter exists |
| Read a user's folders | No endpoint |
| Create / rename / delete a folder | No endpoint |
| Move a playlist into a folder | No endpoint |
| Folder field on the playlist object | Absent — `GET /me/playlists` returns a flat list |

Extended Quota Mode does **not** unlock any of this; it is not a permissions issue. `spotify/web-api#38`
("Retrieve Playlists' Folders") has been open since the API's early days.

**Consequence for this repo:** `ArchiveAction` creates `2026 - July` style playlists at library root, and
that is the only thing the public API will ever do. The current naming-convention approach
(`isArchivePlaylistName()` in `src/settings.ts`) is the sanctioned workaround, not a stopgap.

---

## 2. Private API — what actually exists

Host is `spclient.wg.spotify.com` — Spotify's internal client backend, distinct from `api.spotify.com`.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/playlist/v2/user/{userId}/rootlist` | Entire library as a flat ordered list, plus a `revision` |
| `POST` | `/playlist/v2/user/{userId}/rootlist/changes` | Apply a `deltas` array of ops against that `revision` |

The `revision` is an optimistic-concurrency token: read it, submit changes against it, and a stale
revision is rejected. Same pattern as `snapshot_id` on the public playlist endpoints.

### Operations

Delta ops are `ADD`, `MOV`, `REM`. `MOV` is `kind: 4` and accepts either form:

- `{ items: [uri], addAfterItem: <uri> }` — positional relative to another entry
- `{ fromIndex, length, toIndex }` — index-based

### How folders are represented

This is the important part. **The rootlist is flat.** A folder is a *pair of marker entries*:

```
spotify:start-group:{folderId}:{Name}
  spotify:playlist:...          <- "inside" the folder
  spotify:playlist:...
spotify:end-group:{folderId}
```

Membership is purely positional — a playlist is "in" a folder because it sits between that folder's
`start-group` and `end-group` markers. Nesting works by nesting marker pairs.

So the operation we actually want decomposes into two calls:

1. `POST /me/playlists` on the **public** API — creates the playlist, returns its ID
2. One `MOV` on the **private** API — position its URI after the folder's `start-group` marker

There is no "create playlist in folder" primitive. There does not need to be.

---

## 3. The blocker: authentication

Our existing OAuth token is worthless against `spclient`. It requires two credentials:

| Credential | Source | Notes |
|---|---|---|
| Web-player access token | `open.spotify.com` internal token endpoint | Different issuance path from developer OAuth; carries broad internal scopes |
| `client-token` | `clienttoken.spotify.com/v1/clienttoken` | Anti-abuse token derived from a client ID + device blob |

Every project that automates this drives a **headless browser**, logs in as the user, and scrapes both
values out of the network log. There is no machine-to-machine path. Tokens carry short expiries and
must be re-scraped on refresh.

**This is the entire cost of the feature.** The API calls themselves are trivial.

---

## 4. Prior art

| Project | What it does | Useful for |
|---|---|---|
| [mirrorfm/unofficial-spotify-api](https://pkg.go.dev/github.com/mirrorfm/unofficial-spotify-api) | Go client for `rootlist` + `rootlist/changes` with `DeltaOps` | Cleanest reference for request/response shapes |
| [Skyler Asher — Spotify Folder Tools](https://skylerasher.com/spotify-folder-tools/) | Moves playlists into folders; uses ChromeDriver to capture tokens | Reference for the `MOV` + `addAfterItem` payload and the token dance |
| [mikez/spotify-folders](https://github.com/mikez/spotify-folders) | Reads folder hierarchy from the **local desktop cache** — no network, no tokens | Read-only introspection; see below |
| [librespot-org/librespot#734](https://github.com/librespot-org/librespot/discussions/734) | Protobuf definitions for the internal client protocol | Evidence of how much these definitions churn |

### Read-only alternative

`spotify-folders` parses the desktop client's LevelDB cache directly:

- macOS: `~/Library/Application Support/Spotify/PersistentCache/Users/<user>-user/`
- Key prefix: `!pl#slc#`

Outputs the folder hierarchy as JSON. **Local machine only** — no help in Lambda, but useful if we ever
want to answer "what folder is this playlist in" during local CLI runs.

---

## 5. How to capture the traffic ourselves

If we want to verify the payload shape firsthand rather than trusting the write-ups:

1. **Web player + Chrome DevTools** — easiest by a wide margin. Open `open.spotify.com`, DevTools →
   Network, filter on `spclient`, drag a playlist into a folder. The `rootlist/changes` POST gives us
   the exact body, the `Authorization` bearer, and the `client-token` header in one shot.
2. **Desktop app** — launch with `--remote-debugging-port=9222` and attach Chrome's inspector (the
   client is CEF, so CDP applies). macOS/Linux generally also need developer mode enabled in prefs.
   Spotify breaks this between releases; expect friction. Not worth it given option 1 exists.
3. **Local cache read** — `spotify-folders`, for structure only, no interception.

---

## 6. Options and recommendation

### Option A — Do nothing (recommended)

Keep the naming convention. `2026 - July`, detected by `isArchivePlaylistName()`. Folders stay a manual,
one-time drag in the client — and critically, **the playlist keeps its ID**, so all our automation keeps
working on it forever after. The folder is pure client-side cosmetics.

### Option B — Create via API, drag manually once

Same as A, but we consciously accept a one-time manual step per new archive folder (i.e. yearly, not
monthly, if we nest by year). Near-zero engineering cost.

### Option C — Sort-order trickery

Prefix archive playlists so alphabetical sort groups them visually (`ARC · 2026-07`). Gets grouping
without folders. Costs a rename migration and churns `isArchivePlaylistName()`.

### Option D — Implement the private API *(now partially done — see §8)*

Requires, in rough order of pain:

- Headless Chromium in the Lambda bundle (Playwright/Puppeteer + a Lambda-compatible Chromium layer),
  which balloons the deploy artifact well past what `scripts/publish.rb` currently produces
- Storing Spotify **account credentials** (not just a refresh token) to drive the login — a materially
  worse security posture than what we have today
- Token scrape + cache + refresh logic for two short-lived credentials
- Rootlist read → locate `start-group` marker for the target folder → `MOV` against current revision,
  with retry on stale revision
- Ongoing maintenance against an unversioned API whose protobuf definitions have churned repeatedly

### Recommendation

**Option A**, with **Option B** as the pragmatic escape hatch if the root-level clutter becomes annoying.

Option D is a genuinely working technique, not vapor — but it trades a headless browser, stored account
credentials, and unbounded maintenance for a visual nicety. The trade does not clear the bar. Revisit
only if folder placement becomes functionally load-bearing rather than cosmetic.

---

## 7. Open questions if we pursue Option D

Status as of 2026-08-04, after the Phase 0 capture in `docs/rootlist-capture.md`:

| Question | Answer |
|---|---|
| Does `POST /me/playlists` then a rootlist read reliably show the new playlist, or is there a propagation delay? | **Still open.** Not probed — the tool never creates a playlist |
| Can a `start-group` marker be created via `ADD` (i.e. create folders programmatically)? | **Still open.** No write of any kind was attempted |
| What is the failure mode on a stale `revision` — error, or silent no-op? | **Still open.** Requires a real write to find out |
| Does `client-token` bind to a device fingerprint in a way that breaks it outside a browser? | **Answered: no, not for reads.** A terminal-minted `client-token` worked. Better still, `client-token` turned out **not to be required at all** for the rootlist GET — only `Authorization` + `Accept: application/json` are |

Newly answered, which the original list did not think to ask:

- **Is the response JSON or protobuf?** Both. `Accept: application/json` gets
  JSON; *any* other `Accept` silently returns a protobuf `octet-stream` with
  HTTP 200. This is the single most dangerous detail in the protocol.
- **Is wire order meaningful?** Yes, and stable across identical GETs. It is
  insertion order, not sorted.
- **Is the rootlist paged?** Yes — `from`/`length` with a `contents.truncated`
  flag. A single unbounded GET happened to return all 307 entries, but that is
  not contractual.

The three still-open questions are all **write-path** questions, and all three
must be answered by a real reversible probe (plan Phase 0D) before writes are
enabled. None of them block the read-only tool.

---

## 8. What was actually built (2026-08-04)

`scripts/spotify-folders/` — a **local-only, read-only** implementation of the
Option D read half.

- Reads the rootlist over the private `spclient` API, parses the flat
  marker list into a folder tree, and plans which root-level
  `YYYY - MonthName` archives would move into `History`.
- **Writes are disabled by construction.** `WRITE_MODE = 'disabled'` gates every
  write path, `--apply` is refused before credentials are read or the network is
  touched, and `POST .../rootlist/changes` has never been issued against this
  account. The apply code exists to be reviewable, not to be run.
- **Never deployed.** Top-level `scripts/` is not in `publish.rb`'s `PAYLOAD`
  allowlist, so it is never staged into the Lambda package.
- **`ArchiveAction` is unchanged.** It still creates archive playlists at library
  root through the public API. Moving a playlist changes neither its ID nor its
  tracks, so nothing downstream cares.

This does **not** overturn the Option A recommendation for the *Lambda*. It
concedes the narrower point that a one-shot **local** reconciler is cheap enough
to be worth having, because it needs no headless browser, no stored account
credentials, and no Lambda footprint.

**The maintenance warning in §6 stands undiminished.** The private API is
unversioned and unsupported; §2b of `docs/rootlist-capture.md` documents a token
mint that depends on a secret table embedded in the web-player JS bundle, which
Spotify rotates. Anything built on this should be assumed broken until proven
otherwise on the day it is run.

---

## Sources

- [Spotify Folder Tools — Skyler Asher](https://skylerasher.com/spotify-folder-tools/)
- [mirrorfm/unofficial-spotify-api](https://pkg.go.dev/github.com/mirrorfm/unofficial-spotify-api)
- [mikez/spotify-folders](https://github.com/mikez/spotify-folders)
- [Retrieve Playlists' Folders — spotify/web-api#38](https://github.com/spotify/web-api/issues/38)
- [librespot protobuf/endpoint discussion](https://github.com/librespot-org/librespot/discussions/734)
- [Usage of spclient API — Spotify Community](https://community.spotify.com/t5/Spotify-for-Developers/Usage-of-guc-spclient-spotify-com-API/td-p/6366746)
- [Enable devtools for Spotify desktop (gist)](https://gist.github.com/jetfir3/d66f491d0683e2bdbdf9f60068e9984b)
