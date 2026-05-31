# Spotify OAuth Authentication Flows

## Prerequisites

1. Create application at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Note your Client ID and Client Secret
3. Configure Redirect URI(s) in app settings

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
| `redirect_uri` | URL-encoded redirect URI (must match dashboard) |
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

Base64 encode: `client_id:client_secret`

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

---

## Token Storage Best Practices

1. **Never expose tokens in client-side code** - Use backend proxy
2. **Store refresh tokens securely** - Encrypted database, secure keychain
3. **Never log tokens** - Mask in logs
4. **Use HTTPS only** - Never transmit over HTTP
5. **Set short access token lifetimes** - Refresh frequently
6. **Validate state parameter** - Prevent CSRF attacks
7. **Handle token expiration gracefully** - Auto-refresh before expiry

---

## Error Handling

### Authorization Errors

User denies access or error occurs:

```
YOUR_REDIRECT_URI?error=access_denied&state=STATE
```

### Token Errors

```json
{
  "error": "invalid_grant",
  "error_description": "Authorization code expired"
}
```

| Error | Description |
|-------|-------------|
| `invalid_request` | Missing required parameter |
| `invalid_client` | Invalid client credentials |
| `invalid_grant` | Invalid/expired code or refresh token |
| `unauthorized_client` | Client not authorized for this grant type |
| `unsupported_grant_type` | Invalid grant_type value |

### API Errors (401)

```json
{
  "error": {
    "status": 401,
    "message": "The access token expired"
  }
}
```

Handle by refreshing token and retrying request.

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

## Complete Node.js Example (Authorization Code)

```javascript
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/callback';

// Step 1: Redirect to Spotify
app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const scopes = 'user-read-private playlist-read-private';

  res.redirect('https://accounts.spotify.com/authorize?' +
    new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: scopes,
      redirect_uri: REDIRECT_URI,
      state: state
    })
  );
});

// Step 2: Handle callback
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.send(`Error: ${error}`);
  }

  // Step 3: Exchange code for token
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI
    }),
    {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  const { access_token, refresh_token, expires_in } = response.data;

  // Store tokens securely, then use access_token for API calls
  res.json({ access_token, refresh_token, expires_in });
});

// Refresh token endpoint
app.get('/refresh', async (req, res) => {
  const refresh_token = req.query.refresh_token;
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh_token
    }),
    {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  res.json(response.data);
});

app.listen(3000);
```
