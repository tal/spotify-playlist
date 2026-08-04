# 2026-08-04 — Redact OAuth tokens from the `user` endpoint

## What was wrong

`case 'user'` in `src/index.ts` returned `dynamo.user` wholesale:

```ts
case 'user':
  return { statusCode: 200, body: JSON.stringify({ user: dynamo.user }) }
```

`UserData.spotifyAuth` carries `accessToken` **and** `refreshToken`, so both
went out in the response body verbatim.

This was not merely a noisy CLI dump. The handler has **no authentication of
any kind** — there is no authorizer, no shared secret, no header check
anywhere in `src/index.ts` — and the Lambda Function URL is configured
`AuthType: NONE` with CORS `AllowOrigins: *`. So:

```
GET https://<function-url>/user
```

returned a live Spotify access token (375 chars) and refresh token (131 chars)
to any unauthenticated caller who knew the URL, from any origin. Verified
against the deployed function on 2026-08-04 before the fix.

The access token expires hourly; **the refresh token does not**. It is the
durable credential and it was the one most exposed.

## The change

`src/index.ts` — the `user` case now destructures `spotifyAuth` off and rebuilds
it with the two token fields replaced by `` `[redacted for ${dynamo.user.id}]` ``.

- The user id goes in the token's place so the response still identifies *whose*
  auth row was read, which is the only reason the field was ever useful in this
  output.
- `expiresAt` is kept — it is the actually-useful field when debugging a token
  refresh, and it is not a credential.
- The surviving fields are **listed explicitly** rather than spread-and-
  overridden. If a new secret is added to `UserSpotifyAuthData`, this fails to
  typecheck instead of silently leaking it.

Response shape is otherwise unchanged; `id` and `lastPlayedAtProcessedTimestamp`
still come through, so anything parsing this endpoint keeps working.

## Scope check

`/user` was the only place that serialized the whole user object into a
response. Every other reference (`src/spotify.ts`, `src/db/liked-songs-cache.ts`,
`src/actions/process-playback-history-action.ts`, the other `src/index.ts`
cases) touches `.user.id` only, or reads the tokens internally to call Spotify.
`src/reauth.ts` logs the user id and table name, never the tokens.

`bun run typecheck` passes.

## Still open — not addressed here

1. **The deployed function still leaks until `ruby scripts/publish.rb` runs.**
   This fix is source-only.
2. **The refresh token should be rotated** (`bun run reauth`). It was reachable
   unauthenticated on a public URL for an unknown period, and it was printed to
   a terminal transcript during the 2026-08-04 playback verification session.
   Redacting the endpoint does not un-expose a credential that was already
   served.
3. **The root cause is unfixed.** Redacting one field narrows the blast radius
   of one endpoint; it does not authenticate the function. `AuthType: NONE` +
   CORS `*` + zero handler-side auth means every other action — `promote`,
   `demote`, `archive`, `undo`, `clear-liked-cache` — is also callable by
   anyone with the URL. Those mutate playlists and DynamoDB. Moving the Function
   URL to `AWS_IAM`, or adding a shared-secret header check in the handler,
   is the actual fix; it needs a decision about how the URL is currently
   triggered (phone shortcut, etc.) before it can be changed safely.
