# 2026-07-27 - Reconcile spotify-web-api Skill with Current Spotify Web API Behavior

Reconciled all 6 files in `.claude/skills/spotify-web-api/` against current, verified Spotify
Web API behavior (including the February 2026 migration guide) and fixed skill frontmatter
that previously failed validation.

## Files changed

| File | Role |
|---|---|
| `SKILL.md` | Entry point |
| `examples/auth-flow.md` | Runnable Authorization Code flow implementation |
| `examples/curl-examples.sh` | Copy-pasteable curl examples |
| `references/authentication-flows.md` | Canonical OAuth spec (all flows, errors, storage) |
| `references/endpoints-complete.md` | Full endpoint reference |
| `references/scopes-complete.md` | Scope-to-endpoint mapping |

## Frontmatter fixes

- `name: Spotify Web API` → `name: spotify-web-api` — frontmatter `name` must be kebab-case; the space-cased value previously failed validation
- Removed the `version: 0.1.0` key — `version` is not a supported frontmatter field

## Structural fixes

- **SKILL.md de-duplication** — replaced the fully-inlined endpoint tables (Content Metadata, User Library, Playlists, Playback Control, User Profile) and fully-inlined scope lists with short summary tables that point into `references/endpoints-complete.md` and `references/scopes-complete.md`, which now hold the single source of truth. Same treatment for the OAuth Scopes section.
- **`## Contents` blocks added** to the three files that had grown past a comfortable single-read length: `references/authentication-flows.md`, `references/endpoints-complete.md`, `references/scopes-complete.md`.
- **`examples/auth-flow.md` reduced to a runnable implementation** — stripped the step-by-step conceptual walkthrough (parameter tables, error tables, security best practices) that duplicated `references/authentication-flows.md`, keeping only the Express/TypeScript server implementation plus a pointer to the reference doc for concepts. `references/authentication-flows.md` is now the canonical spec and gained the runnable-implementation content that used to live only in the example (base64 header derivation, token field table, error tables, storage best practices) so it stands alone.

## API accuracy fixes

| Area | Before | After |
|---|---|---|
| Availability markers | No system for flagging quota-mode-limited endpoints | New three-marker scheme applied throughout: **EQM only** (Extended Quota Mode required), **Deprecated** (superseded, still works for EQM apps), **Restricted** (only apps with pre-2024-11-27 extended access) |
| Playlist items | `GET/POST/PUT/DELETE /playlists/{id}/tracks`, remove-body key `tracks` | `/playlists/{id}/items`, remove-body key `items`; old `/tracks` path marked Deprecated, still functional for EQM apps |
| Create playlist | `POST /users/{user_id}/playlists` | `POST /me/playlists`; old path marked Deprecated |
| Library save/remove/check | Per-type `PUT/DELETE /me/tracks` (+ albums/shows/episodes/audiobooks), `GET /me/*/contains` (`ids=`, type-specific max) | Generic `PUT/DELETE /me/library`, `GET /me/library/contains` (`uris=` query param, max 40, covers every content type incl. artists/users/playlists); per-type endpoints marked Deprecated, still valid for EQM apps |
| Follow/unfollow | `PUT/DELETE /me/following`, `GET /me/following/contains` (`type=`, `ids=`) | Generic `/me/library` equivalents using `spotify:artist:`/`spotify:user:` URIs; old endpoints marked Deprecated. `GET /me/following` (read) untouched — never removed |
| Search `limit` | Documented as 1-50, default 20, with no mode split | Development Mode: 0-10, default 5; Extended Quota Mode: 0-50, default 20 (unaffected). Paginate with `offset` instead of raising `limit` |
| Refresh tokens | No expiry documented | Expire 6 months after the user's original authorization (Authorization Code / PKCE); refreshing an access token does not reset this clock; expiry/revocation returns `400 invalid_grant` — discard and re-authorize, don't retry |
| Redirect URIs | `http://localhost:3000/callback` used throughout | `localhost` hostname is rejected; loopback must use the IP literal `http://127.0.0.1:PORT/callback` or `http://[::1]:PORT/callback`; HTTPS required for all non-loopback URIs; matching is exact (case, trailing slash) |
| Quota modes | Single "Extended Quota Mode" paragraph, no concrete constraints | New Quota Modes section: Development Mode defaults (5 allowlisted users, Premium-holding owner, 25 Client IDs per developer, quota counted per developer not per Client ID, `429` with `reason: QUOTA_EXCEEDED` on exhaustion) vs. Extended Quota Mode (organizations only — registered business, 250k+ MAU, applied from a company email) |
| Batch multi-get | `GET /tracks|albums|artists?ids=...` presented as universally available | Marked **EQM only**; Development Mode apps must fetch singly (`GET /tracks/{id}`, etc.) with bounded concurrency |
| Restricted/legacy endpoints | Presented as universally available | audio-features, audio-analysis, recommendations, available-genre-seeds, related-artists, featured-playlists, category-playlists now marked **Restricted** — grandfathered to apps with pre-2024-11-27 extended access only; failure mode is `404`, not `401`/`403` |
| Pagination | Documented as uniformly offset-based | New cursor-pagination note: `GET /me/player/recently-played` (`before`/`after`) and `GET /me/following?type=artist` (`after`) reject `offset` and return a `cursors` object instead |
| Rate-limit 429s | `Retry-After` header only | Noted that quota-exhaustion `429`s carry `"reason": "QUOTA_EXCEEDED"` and won't clear within the `Retry-After` window — branch on `reason` rather than blindly retrying |
| User object | `id` used as the general-purpose identifier | Noted new `account_id` field as the stable, public, pseudoanonymous identifier to use when linking a Spotify user to an external service |
| Editorial playlist ID in curl examples | Hardcoded `37i9dQZF1DXcBWIGoYBM5M` (inaccessible to apps registered after 2024-11-27) | Replaced with the existing `PLAYLIST_ID` placeholder convention at all load-bearing sites |

## Before/after line counts

| File | Before | After | Delta |
|---|---:|---:|---:|
| `SKILL.md` | 275 | 261 | -14 |
| `examples/auth-flow.md` | 332 | 154 | -178 |
| `examples/curl-examples.sh` | 307 | 344 | +37 |
| `references/authentication-flows.md` | 346 | 316 | -30 |
| `references/endpoints-complete.md` | 430 | 603 | +173 |
| `references/scopes-complete.md` | 296 | 333 | +37 |

Net effect is a redistribution, not a net cut: `auth-flow.md` shrank because its conceptual
content moved into `authentication-flows.md` and SKILL.md shrank because its inlined tables
moved into the two `references/*.md` files, while `endpoints-complete.md` grew to become the
authoritative availability matrix all three other files now point back to.

## What was NOT removed

No content was deleted on the grounds of being unavailable in Development Mode. Every
endpoint, field, and behavior that still works for Extended Quota Mode apps (the deprecated
per-type library/follow/playlist-tracks endpoints, batch multi-ID fetches, browse/new-releases,
browse/categories, etc.) remains documented — it is now annotated with an **EQM only** or
**Deprecated** marker rather than removed, since the skill has to serve both Development Mode
and Extended Quota Mode callers.

Only the legacy **Restricted** endpoints (audio-features, audio-analysis, recommendations,
available-genre-seeds, related-artists, featured-playlists, category-playlists) are flagged as
effectively unobtainable going forward — and even those are kept in the docs with the marker
and a `404` failure-mode note, not deleted, because apps with pre-2024-11-27 grandfathered
access can still call them.

## Known documentation conflict (left unresolved, flagged for callers)

Spotify's own `PUT`/`DELETE /me/library` ("save-library-items"/"remove-library-items")
reference pages list accepted URI types as track/album/episode/show/audiobook/user/playlist —
**omitting artist** — while `GET /me/library/contains` does list artist, and the February 2026
migration guide's own before/after example follows an artist via
`PUT /me/library` with a `spotify:artist:...` URI. The skill:

- Documents both sources rather than picking one silently
- Treats artist URIs as accepted on all three verbs (matching the migration guide's example)
- Instructs callers to handle a `400` on artist saves/removes rather than assume success, since the reference pages disagree with the migration guide
