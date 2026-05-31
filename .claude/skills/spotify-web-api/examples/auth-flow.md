# Spotify Authorization Code Flow - Step-by-Step Walkthrough

This example demonstrates the complete Authorization Code flow for a web application.

## Prerequisites

1. Spotify Developer account
2. Registered application at https://developer.spotify.com/dashboard
3. Redirect URI configured (e.g., `http://localhost:3000/callback`)

## Step 1: Construct Authorization URL

Build the authorization URL with required parameters:

```
https://accounts.spotify.com/authorize?
  client_id=YOUR_CLIENT_ID
  &response_type=code
  &redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback
  &scope=user-read-private%20playlist-read-private%20user-library-read
  &state=abc123randomstate
```

### Parameters Explained

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `client_id` | Your app's client ID | Identifies your application |
| `response_type` | `code` | Request authorization code |
| `redirect_uri` | URL-encoded callback URL | Where Spotify redirects after auth |
| `scope` | Space-separated scopes | Permissions being requested |
| `state` | Random string | CSRF protection |

## Step 2: User Authorization

1. Redirect user to the authorization URL
2. User sees Spotify login (if not logged in)
3. User sees consent screen with requested permissions
4. User clicks "Agree" or "Cancel"

## Step 3: Handle Callback

Spotify redirects to your `redirect_uri` with:

**Success:**
```
http://localhost:3000/callback?code=AQD...long_auth_code...&state=abc123randomstate
```

**Error (user denied):**
```
http://localhost:3000/callback?error=access_denied&state=abc123randomstate
```

### Verify State

Always verify the `state` parameter matches what you sent to prevent CSRF attacks.

## Step 4: Exchange Code for Tokens

Make a POST request to the token endpoint:

```bash
curl -X POST https://accounts.spotify.com/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n 'CLIENT_ID:CLIENT_SECRET' | base64)" \
  -d "grant_type=authorization_code" \
  -d "code=AQD...the_auth_code_from_callback..." \
  -d "redirect_uri=http://localhost:3000/callback"
```

### Base64 Authorization Header

The `Authorization` header must be Base64-encoded `client_id:client_secret`:

```bash
# In bash
echo -n "your_client_id:your_client_secret" | base64

# Result example: eW91cl9jbGllbnRfaWQ6eW91cl9jbGllbnRfc2VjcmV0
```

## Step 5: Receive Token Response

Successful response:

```json
{
  "access_token": "BQD...very_long_access_token...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "AQD...refresh_token...",
  "scope": "user-read-private playlist-read-private user-library-read"
}
```

### Token Details

| Field | Description |
|-------|-------------|
| `access_token` | Use this for API requests |
| `token_type` | Always "Bearer" |
| `expires_in` | Seconds until expiration (usually 3600 = 1 hour) |
| `refresh_token` | Use to get new access token without re-auth |
| `scope` | Granted scopes (may differ from requested) |

## Step 6: Make API Requests

Use the access token in the Authorization header:

```bash
curl https://api.spotify.com/v1/me \
  -H "Authorization: Bearer BQD...access_token..."
```

Response:

```json
{
  "display_name": "User Name",
  "email": "user@example.com",
  "id": "user_id",
  "product": "premium",
  "country": "US"
}
```

## Step 7: Refresh Expired Tokens

When access token expires (1 hour), use refresh token:

```bash
curl -X POST https://accounts.spotify.com/api/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n 'CLIENT_ID:CLIENT_SECRET' | base64)" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=AQD...your_refresh_token..."
```

Response:

```json
{
  "access_token": "BQD...new_access_token...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "user-read-private playlist-read-private user-library-read"
}
```

**Note:** Response may include a new `refresh_token`. If so, store and use the new one.

## Complete TypeScript Implementation

```typescript
import express from 'express';
import crypto from 'crypto';

const app = express();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;
const REDIRECT_URI = 'http://localhost:3000/callback';

// Store state for CSRF verification (use proper session in production)
const stateStore = new Map<string, number>();

// Step 1: Initiate authorization
app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, Date.now());

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'user-read-private playlist-read-private user-library-read',
    state: state,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// Step 3 & 4: Handle callback and exchange code
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // Check for errors
  if (error) {
    return res.status(400).json({ error: error });
  }

  // Verify state (CSRF protection)
  if (!state || !stateStore.has(state as string)) {
    return res.status(400).json({ error: 'Invalid state' });
  }
  stateStore.delete(state as string);

  // Exchange code for tokens
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code as string,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    return res.status(400).json(error);
  }

  const tokens = await response.json();

  // Store tokens securely (database, encrypted cookies, etc.)
  // For demo, just return them
  res.json({
    message: 'Authorization successful!',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
  });
});

// Step 7: Refresh token endpoint
app.post('/refresh', async (req, res) => {
  const refreshToken = req.body.refresh_token;

  if (!refreshToken) {
    return res.status(400).json({ error: 'refresh_token required' });
  }

  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const tokens = await response.json();
  res.json(tokens);
});

// Helper: Make authenticated API request
async function spotifyRequest(
  accessToken: string,
  endpoint: string
): Promise<any> {
  const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (response.status === 401) {
    throw new Error('Token expired - refresh required');
  }

  return response.json();
}

// Example: Get user profile
app.get('/me', async (req, res) => {
  const accessToken = req.headers.authorization?.replace('Bearer ', '');

  if (!accessToken) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const profile = await spotifyRequest(accessToken, '/me');
    res.json(profile);
  } catch (error) {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
});

app.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
  console.log('Visit http://localhost:3000/login to start authorization');
});
```

## Error Handling

### Authorization Errors

| Error | Cause |
|-------|-------|
| `access_denied` | User clicked "Cancel" |
| `invalid_request` | Missing required parameter |
| `invalid_scope` | Invalid scope requested |

### Token Exchange Errors

| Error | Cause |
|-------|-------|
| `invalid_grant` | Code expired or already used |
| `invalid_client` | Wrong client credentials |
| `invalid_request` | Missing parameter |

### API Errors

| Status | Cause | Action |
|--------|-------|--------|
| 401 | Token expired | Refresh token |
| 403 | Insufficient scope | Re-authorize with needed scope |
| 429 | Rate limited | Wait and retry |

## Security Best Practices

1. **Always verify state** - Prevents CSRF attacks
2. **Use HTTPS in production** - Never transmit tokens over HTTP
3. **Store tokens securely** - Encrypted database or secure cookies
4. **Never expose client secret** - Keep server-side only
5. **Handle token refresh proactively** - Refresh before expiration
6. **Implement token revocation** - Clear tokens on logout
7. **Use short state TTL** - Delete state after ~10 minutes
