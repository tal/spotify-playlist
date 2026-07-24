# 2026-07-25 — Fix revoked Spotify refresh token + add re-auth script

## Diagnosis

The Lambda (`spotify-playlist-dev`, `us-east-1`) was failing every invocation when
talking to Spotify. CloudWatch showed 36/36 recent errors were identical:

```
WebapiAuthenticationError
Details: invalid_grant — Refresh token revoked
statusCode: 400
```

- **Root cause:** the refresh token stored in the DynamoDB `user` table was revoked
  by Spotify. `getClient()` (`src/spotify.ts`) sees the access token is expired,
  calls `client.refreshAccessToken()`, and Spotify rejects the revoked token — so
  every downstream call fails.
- **Timeline:** last successful refresh stored an access token expiring
  `2026-07-20 08:45 UTC`; first failure `2026-07-22 07:45 UTC`, failing continuously
  since.
- **Contributing bug:** `updateAccessToken()` only persisted `accessToken` +
  `expiresAt`, never a rotated `refresh_token`. Both refresh call sites in
  `src/spotify.ts` read `refreshed.body.access_token` and discarded
  `refreshed.body.refresh_token`. If Spotify ever rotates the refresh token, the
  stale one is kept until it is revoked. (Also note: local OAuth re-auth mints a new
  refresh token and revokes older ones — and the local flow wrote to a keychain JSON,
  not DynamoDB, so a local re-auth could silently kill the Lambda's token.)

## Changes

### Persist rotated refresh tokens (prevent recurrence)

- `src/db/dynamo.ts` — `updateAccessToken()` now takes an optional `refreshToken`
  and, when present, writes `spotifyAuth.refreshToken` alongside the access token
  and expiry. When Spotify omits it, the stored value is left untouched.
- `src/spotify.ts` — both refresh call sites (`getClient()` and
  `Spotify.refreshAccessToken()`) now pass `refreshed.body.refresh_token` through to
  `updateAccessToken()`. `refreshAccessToken()` also updates the in-memory client via
  `setRefreshToken()` when a rotated token is returned.

### New re-auth → DynamoDB script (fix the immediate outage)

- `src/reauth.ts` — standalone script that runs the OAuth Authorization Code flow
  locally and writes fresh `{ accessToken, refreshToken, expiresAt }` into the
  production DynamoDB `user` table's `spotifyAuth`. Uses its own DynamoDB client
  pinned to `us-east-1` (not the shared `src/aws.ts` singleton) so it cannot
  accidentally target a local dev endpoint. Verifies the user item exists before
  updating, and forces a fresh consent screen (`show_dialog=true`) so Spotify always
  returns a new refresh token.
- `package.json` — added `cli:bun:reauth` script (`bun run src/reauth.ts`).

## How to recover

1. Register the redirect URI in the Spotify app dashboard
   (developer.spotify.com → app → Settings → Redirect URIs). Default is
   `http://127.0.0.1:8888/callback` (override with `SPOTIFY_REDIRECT_URI`).
2. Run `yarn cli:bun:reauth` (or `bun run src/reauth.ts`).
3. Open the printed URL, log in, approve. Tokens are written to DynamoDB.
4. The Lambda reaches Spotify again on its next run.

Environment: `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` (from `.env`),
optional `SPOTIFY_REDIRECT_URI`, `SPOTIFY_USER` (default `koalemos`), `AWS_REGION`
(default `us-east-1`).
