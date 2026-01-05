# Fix HTTP API and DynamoDB Credentials Issues

**Date:** 2025-10-04

## Problems Identified

### 1. No HTTP Endpoint Configured
- Lambda function `spotify-playlist-dev` existed but had no way to receive HTTP requests
- No Lambda Function URL or API Gateway was configured
- Web frontend and API endpoints were inaccessible

### 2. DynamoDB Authentication Failure
- Lambda logs showed: `UnrecognizedClientException: The security token included in the request is invalid`
- Root cause: AWS SDK v3 credentials configuration was interfering with Lambda execution role

## Solutions Implemented

### 1. Created Lambda Function URL
- Created Function URL: `https://d5vtfkftttoinc6cy7apdt2tom0hujfb.lambda-url.us-east-1.on.aws/`
- Configured with `AUTH_TYPE=NONE` for public access
- Added CORS configuration to allow web frontend access:
  - AllowOrigins: `["*"]`
  - AllowMethods: `["*"]`
  - AllowHeaders: `["*"]`
  - MaxAge: 86400 seconds
- Added resource policy permission for public invocation

### 2. Fixed Lambda Function URL Event Handling
**Files modified:** `src/index.ts`, `src/web-api.ts`

Lambda Function URLs use a different event structure than API Gateway:
- Function URLs use `rawPath` instead of `path`
- Function URLs use `requestContext.http.method` instead of `httpMethod`

Updated handlers to support both event formats:
```typescript
// Lambda Function URLs use rawPath, API Gateway uses path
const requestPath = (ev as any).rawPath || ev.path
const httpMethod = (ev as any).requestContext?.http?.method || ev.httpMethod
```

### 3. Fixed DynamoDB Credentials Configuration
**File modified:** `src/aws.ts`

**The Problem:**
- In Lambda, AWS automatically sets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables with temporary session credentials
- Original code checked for these env vars and explicitly passed them to DynamoDBClient
- AWS SDK v3 behavior: explicitly passing credentials (even if they're from env vars) prevents the SDK from properly using the Lambda execution role's credential refresh mechanism
- This caused "invalid security token" errors when credentials expired

**The Solution:**
- Only set explicit credentials when using local DynamoDB (endpoint is set)
- For Lambda environment (no endpoint), omit credentials configuration entirely
- This allows AWS SDK v3 to use its default credential provider chain, which properly handles Lambda execution role credentials with automatic refresh

```typescript
// Only add endpoint and credentials for local development
if (endpoint) {
  config.endpoint = endpoint

  // Only use explicit credentials for local DynamoDB (when endpoint is set)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
  }
}
// For Lambda (no endpoint), omit credentials entirely to use execution role
```

### 4. Fixed Action Routing for Lambda Function URLs
**Files modified:** `src/index.ts`

Lambda Function URLs don't support API Gateway's path parameter extraction (e.g., `/{action}`), requiring custom routing logic.

**Changes:**
1. Reordered routing to check for actions before falling back to React app
2. Enhanced `actionNameFromEvent()` to extract actions from path for Function URLs
3. Added support for both query parameter (`?action=promote`) and path-based (`/promote`) action invocation

**Routing order:**
1. `/api/*` → Web API handler
2. Static files (`.js`, `.css`, `/assets/*`)
3. Root `/` → React app
4. Extract action from path or query params
5. Execute action or fall back to React app

```typescript
// Lambda Function URL: extract action from path (e.g., /promote -> promote)
const path = (ev as any).rawPath || ev.path
if (path && path !== '/' && !path.startsWith('/api/') && !path.includes('.')) {
  actionName = path.substring(1)
}
```

## Testing Results

All endpoints now working correctly:

### Web Dashboard API
1. **Health Check:** `/api/health` - Returns status OK
2. **Dashboard:** `/api/dashboard` - Returns user info, playlists, and stats
3. **Playlists:** `/api/playlists` - Returns all 249 playlists
4. **Current Track:** `/api/tracks/current` - Returns currently playing track
5. **React Frontend:** `/` - Serves web UI

### Action API
1. **User Info:** `/user` or `/?action=user` - Returns user data with Spotify tokens
2. **Archive:** `/archive` - Archives confirmed tracks by month
3. **Promote:** `/promote` - Promotes current track
4. **Demote:** `/demote` - Demotes current track
5. **Undo:** `/undo-last` - Undos last action
6. **Recent Actions:** `/api/actions/recent?limit=5` - Returns action history

See `HTTP_API_GUIDE.md` for complete API documentation.

## Key Learnings

1. **AWS SDK v3 Credentials:** Never explicitly pass credentials from environment variables in Lambda - let the SDK use the execution role automatically
2. **Lambda Function URLs vs API Gateway:** They use different event structures and both need to be supported for flexibility
3. **Local Development:** Explicit credentials are only needed when using local DynamoDB with a custom endpoint

## Related Files

- `src/aws.ts` - DynamoDB client initialization with proper credentials handling
- `src/index.ts` - Main Lambda handler with Function URL event support
- `src/web-api.ts` - Web API handler with Function URL event support
- `scripts/publish.rb` - Deployment script (unchanged)
