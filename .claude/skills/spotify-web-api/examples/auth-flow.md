# Spotify Authorization Code Flow - Reference Implementation

A complete, runnable Express + TypeScript server implementing the Authorization Code flow: building the authorization URL, handling the callback, exchanging the code for tokens, and refreshing an expired access token.

For the conceptual walkthrough — parameter meanings, the token response shape, error codes, redirect URI requirements, refresh token lifetime, and security best practices — see `references/authentication-flows.md`.

## Contents

- Complete TypeScript Implementation

## Complete TypeScript Implementation

```typescript
import express from 'express';
import crypto from 'crypto';

const app = express();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;
const REDIRECT_URI = 'http://127.0.0.1:3000/callback';

// Store state for CSRF verification (use proper session in production)
const stateStore = new Map<string, number>();

// Initiate authorization
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

// Handle callback and exchange code for tokens
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

// Refresh token endpoint
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
  console.log('Server running at http://127.0.0.1:3000');
  console.log('Visit http://127.0.0.1:3000/login to start authorization');
});
```
