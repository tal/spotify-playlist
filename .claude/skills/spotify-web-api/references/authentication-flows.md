# Spotify OAuth Authentication Flows

## Contents

- Prerequisites
- Authorization Code Flow
- Authorization Code with PKCE
- Client Credentials Flow
- Using Access Tokens
- Token Storage Best Practices
- Error Handling
- Flow Selection Guide
- Runnable Implementation

## Prerequisites

1. Create application at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Note your Client ID and Client Secret
3. Configure Redirect URI(s) in app settings

**Redirect URI requirements:** All redirect URIs must use HTTPS, except loopback addresses which may use HTTP. The hostname `localhost` is rejected — use the explicit IP literal `http://127.0.0.1:PORT/callback` or `http://[::1]:PORT/callback`. Loopback URIs — and only loopback URIs — may be registered without a port and supply the port dynamically at authorization time. Matching is exact, including case and trailing slash; the `redirect_uri` sent to the token endpoint is validated against the one used to obtain the code (no redirect occurs) and must match it exactly.

## Authorization Code Flow

Best for: Server-side applications where client secret can be stored securely.

### Step 1: Request Authorization

Redirect user to:

```
https://accounts.spotify.com/authorize?
  client_id=YOUR_CLIENT_ID
  &response_type=code
  &redirect_uri=YOUR_REDIRECT_URI
  &scope=user-read-private%20playlist-read-private
  &state=RANDOM_STATE_STRING
```

| Parameter | Description |
|-----------|-------------|
| `client_id` | Your app's client ID |
| `response_type` | Must be `code` |
| `redirect_uri` | URL-encoded redirect URI (must match a dashboard entry exactly — case and trailing slash included) |
| `scope` | Space-separated list of scopes (URL-encoded) |
| `state` | Random string for CSRF protection |
| `show_dialog` | Optional: `true` to force consent dialog |

### Step 2: User Authorizes

User logs in and grants permissions. Spotify redirects to your `redirect_uri`:

```
YOUR_REDIRECT_URI?code=AUTHORIZATION_CODE&state=STATE_STRING
```

Verify `state` matches what you sent.

### Step 3: Exchange Code for Token

```bash
curl -X POST https://accounts.spotify.com/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic BASE64_ENCODED_CLIENT_ID_AND_SECRET" \
  -d "grant_type=authorization_code" \
  -d "code=AUTHORIZATION_CODE" \
  -d "redirect_uri=YOUR_REDIRECT_URI"
```

Base64 encode `client_id:client_secret` for the `Authorization: Basic` header:

```bash
echo -n "your_client_id:your_client_secret" | base64
# Result example: eW91cl9jbGllbnRfaWQ6eW91cl9jbGllbnRfc2VjcmV0
```

### Step 4: Receive Tokens

```json
{
  "access_token": "BQD...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "AQD...",
  "scope": "user-read-private playlist-read-private"
}
```

| Field | Description |
|-------|-------------|
| `access_token` | Use this for API requests |
| `token_type` | Always "Bearer" |
| `expires_in` | Seconds until the **access token** expires (typically 3600 = 1 hour); does not describe the refresh token |
| `refresh_token` | Use to obtain a new access token without re-authorization; expires 6 months after the user's authorization (see Step 5) |
| `scope` | Granted scopes (may differ from requested) |

### Step 5: Refresh Token

When access token expires:

```bash
curl -X POST https://accounts.spotify.com/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic BASE64_ENCODED_CLIENT_ID_AND_SECRET" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=REFRESH_TOKEN"
```

Response includes new `access_token` (and possibly new `refresh_token`).

Persist the returned `refresh_token` when present (Spotify may rotate it); otherwise keep the existing one. The refresh token itself expires 6 months after the user's authorization, and refreshing an access token does not extend that window — track the original authorization timestamp and re-authorize the user before the deadline. When the refresh token has expired, the token endpoint returns `400` with `invalid_grant`; do not retry, send the user through Step 1 again.

---

## Authorization Code with PKCE

Best for: Mobile apps, desktop apps, single-page apps where client secret cannot be stored securely.

### Step 1: Generate Code Verifier and Challenge

```javascript
// Generate random 43-128 character string
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

// SHA256 hash, then base64url encode
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64URLEncode(new Uint8Array(hash));
}

function base64URLEncode(buffer) {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
```

### Step 2: Request Authorization

```
https://accounts.spotify.com/authorize?
  client_id=YOUR_CLIENT_ID
  &response_type=code
  &redirect_uri=YOUR_REDIRECT_URI
  &scope=user-read-private
  &state=RANDOM_STATE
  &code_challenge_method=S256
  &code_challenge=CODE_CHALLENGE
```

### Step 3: Exchange Code for Token

```bash
curl -X POST https://accounts.spotify.com/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "grant_type=authorization_code" \
  -d "code=AUTHORIZATION_CODE" \
  -d "redirect_uri=YOUR_REDIRECT_URI" \
  -d "code_verifier=CODE_VERIFIER"
```

No client secret required - code verifier proves ownership.

### Step 4: Refresh Token

```bash
curl -X POST https://accounts.spotify.com/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=REFRESH_TOKEN"
```

---

## Client Credentials Flow

Best for: Server-to-server authentication, accessing non-user resources.

**Note:** Cannot access user-specific endpoints (no user context).

### Request Token

```bash
curl -X POST https://accounts.spotify.com/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic BASE64_ENCODED_CLIENT_ID_AND_SECRET" \
  -d "grant_type=client_credentials"
```

### Response

```json
{
  "access_token": "BQD...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

No refresh token - request new token when expired.

---

## Using Access Tokens

Include in all API requests:

```bash
curl https://api.spotify.com/v1/me \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

Example response:

```json
{
  "id": "user_id",
  "display_name": "User Name"
}
```

See `references/endpoints-complete.md` for the full User object schema.

---

## Token Storage Best Practices

1. **Never expose tokens or the client secret in client-side code** - Use a backend proxy; keep the client secret server-side only
2. **Store tokens securely** - Encrypted database, secure keychain, or secure cookies
3. **Never log tokens** - Mask in logs
4. **Use HTTPS only** - Never transmit tokens, or make token requests, over HTTP
5. **Validate the `state` parameter** - Prevents CSRF attacks; use a short state TTL (delete after ~10 minutes)
6. **Handle token expiration gracefully** - Refresh access tokens proactively before they expire
7. **Implement token revocation** - Clear stored tokens on logout
8. **Track authorization age** - Store the original authorization timestamp and re-authorize the user before the refresh token's 6-month deadline
9. **Set short access token lifetimes where configurable** - Otherwise rely on the default 1-hour expiry and refresh frequently

---

## Error Handling

### Authorization Errors

User denies access or an error occurs during authorization. Spotify redirects to your `redirect_uri` with an `error` parameter:

```
YOUR_REDIRECT_URI?error=access_denied&state=STATE
```

### Authorization and Token Errors

| Error | Description |
|-------|-------------|
| `access_denied` | User clicked "Cancel" on the consent screen |
| `invalid_request` | Missing required parameter |
| `invalid_client` | Invalid client credentials |
| `invalid_grant` | Authorization code or refresh token is invalid, revoked, or expired. Refresh tokens expire 6 months after user authorization — do not retry; discard the token and restart the authorization flow. |
| `invalid_scope` | Invalid scope requested |
| `unauthorized_client` | Client not authorized for this grant type |
| `unsupported_grant_type` | Invalid grant_type value |

Example token error response:

```json
{
  "error": "invalid_grant",
  "error_description": "Authorization code expired"
}
```

### API Errors

| Status | Cause | Action |
|--------|-------|--------|
| 401 | Access token expired or invalid | Refresh the token and retry |
| 403 | Insufficient scope | Re-authorize with the needed scope |
| 429 | Rate limited | Wait for the `Retry-After` duration and retry |

Example 401 response:

```json
{
  "error": {
    "status": 401,
    "message": "The access token expired"
  }
}
```

---

## Flow Selection Guide

| Scenario | Recommended Flow |
|----------|-----------------|
| Web app with backend | Authorization Code |
| Mobile app | Authorization Code + PKCE |
| Desktop app | Authorization Code + PKCE |
| Single-page app (SPA) | Authorization Code + PKCE |
| Backend service (no user) | Client Credentials |
| CLI tool (local user) | Authorization Code + PKCE |

---

## Runnable Implementation

For a complete, runnable server implementation of the Authorization Code flow (Express + TypeScript, including login/callback/refresh routes), see `examples/auth-flow.md`.
