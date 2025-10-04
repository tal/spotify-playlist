# Fix Token Expiration During Lambda Execution

**Date**: 2025-10-03

## Problem

The Spotify playlist management system was experiencing unhandled promise rejections when the Spotify access token expired during Lambda execution. Specifically:

- The access token was checked and refreshed only once at Lambda startup (in `getClient()`)
- If the token expired mid-execution (e.g., during a long-running promote action), subsequent API calls would fail with 401 "The access token expired" errors
- These 401 errors were not caught or handled, resulting in unhandled promise rejections and failed operations
- The retry logic didn't include 401 errors as retryable

This issue was discovered when a promote action for "Of Monsters and Men - Dream Team" failed at 2025-10-03 20:34:05 with:
```
WebapiRegularError: An error occurred while communicating with Spotify's Web API.
Details: The access token expired.
```

## Solution

Implemented automatic token refresh capability that detects 401 errors mid-execution, refreshes the token, and retries the failed operation. The solution includes multiple layers of protection:

### 1. Token Refresh Method (`src/spotify.ts`)

Added `refreshAccessToken()` method to the Spotify class that:
- Calls `client.refreshAccessToken()` to get a new token from Spotify
- Updates the token in DynamoDB via `dynamo.updateAccessToken()`
- Updates the client's access token using `client.setAccessToken()`
- Logs the refresh operation with timestamps for debugging

### 2. Enhanced Retry Logic (`src/utils/retry.ts`)

Updated the retry logic to detect and handle 401 errors:
- Added detection for `statusCode === 401`
- Added detection for error messages containing "access token expired" or "invalid_token"
- Created new `retrySpotifyCallWithTokenRefresh()` function that:
  - Catches 401 errors specifically
  - Calls `refreshAccessToken()` when detected
  - Retries the operation immediately after refresh
  - Prevents infinite loops by limiting token refresh to once per operation

### 3. Updated @logError Decorator (`src/spotify.ts`)

Modified the `@logError` decorator to automatically handle token refresh:
- Catches 401/token expiration errors in try/catch blocks
- Checks if `this._dynamo` exists (required for refresh)
- Calls `this.refreshAccessToken()` on 401 errors
- Retries the operation once after token refresh
- Applies to all methods decorated with `@logError` (12+ methods)

This provides automatic token refresh for methods like:
- `saveTrack()` / `unsaveTrack()`
- `trackIsSaved()`
- `addTrackToPlaylist()` / `removeTrackFromPlaylist()`
- `emptyPlaylist()`
- `getTrack()`
- `skipToNextTrack()`
- `recentlyPlayed()`

### 4. Enhanced Long-Running Operations (`src/spotify.ts`)

Updated `mySavedTracks()` to use `retrySpotifyCallWithTokenRefresh()`:
- Replaced `retrySpotifyCall` with token-aware version
- Ensures token refresh during pagination of large saved track libraries (6000+ tracks)
- Prevents timeouts in long-running operations

### 5. Improved Error Logging (`src/actions/action.ts`)

Added specific error logging for 401 errors during action execution:
- Logs action ID, action type, and error details
- Helps identify which actions encounter token issues
- Maintains existing error handling behavior while providing better visibility

## Benefits

1. **Automatic Recovery**: Operations automatically recover from expired tokens without manual intervention
2. **Comprehensive Coverage**: Token refresh applies to all Spotify API methods via the decorator pattern
3. **Prevents Unhandled Rejections**: Errors are caught and handled properly throughout the execution chain
4. **Clear Logging**: Detailed logs with emoji markers (🔑 🔄 ✅) make token refresh operations easy to identify
5. **Minimal Code Changes**: Uses existing decorator pattern, requiring minimal modifications to method implementations

## Testing Recommendations

After deployment:
1. Monitor CloudWatch logs for token refresh operations (look for 🔄 and 🔑 emoji)
2. Test with operations that run close to token expiration time
3. Verify that long-running operations (like fetching 6000+ saved tracks) complete successfully
4. Check that promote/demote actions no longer fail with 401 errors
5. Confirm that action history is properly recorded even when token refresh occurs

## Technical Details

### Token Refresh Flow

1. API call is made using Spotify client
2. If token is expired, Spotify returns 401 error
3. Error is caught by `@logError` decorator or retry wrapper
4. Token is detected as expired (401 or error message)
5. `refreshAccessToken()` is called
6. New token is fetched from Spotify OAuth
7. New token is stored in DynamoDB
8. Client's access token is updated via `setAccessToken()`
9. Operation is retried with new token
10. Success (or error if retry also fails)

### Log Messages to Look For

- `🔄 Access token expired, refreshing...` - Token refresh initiated
- `✅ Access token refreshed, expires at [timestamp]` - Token refresh successful
- `🔑 [method]: Caught token error, refreshing and retrying` - Decorator caught 401
- `🔑 [operation]: Refreshing expired token before retry` - Retry wrapper caught 401
- `❌ Token expiration error during action execution` - 401 during mutation execution

## Files Modified

- `src/spotify.ts` - Added `refreshAccessToken()` method and updated `@logError` decorator
- `src/utils/retry.ts` - Added 401 detection and `retrySpotifyCallWithTokenRefresh()` function
- `src/actions/action.ts` - Added error handling and logging for 401 errors during action execution
