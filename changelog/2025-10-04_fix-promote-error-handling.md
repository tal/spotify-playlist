# Fix Promote Action Error Handling

**Date:** 2025-10-04

## Problem

When trying to promote a track that was already in the "confirmed" state, the Lambda function would crash with an unhandled promise rejection:

```
ERROR Unhandled Promise Rejection: "cannot promote if confirmed"
Runtime.UnhandledPromiseRejection: cannot promote if confirmed
    at process.processTicksAndRejections
```

The user would receive:
```json
{
  "message": "Internal server error"
}
```

## Root Cause

The Lambda handler's error handling had two issues:

### 1. Incorrect Response Format
```typescript
// OLD (incorrect)
catch (err) {
  return {
    statusCode: 500,
    error: JSON.stringify(err),  // ❌ Wrong property name
  }
}
```

The response used `error` instead of `body`, which caused API Gateway to return a generic "Internal server error" message.

### 2. No Error Classification
All errors were treated as 500 (Internal Server Error), even business logic errors like "cannot promote if confirmed" which should be 400 (Bad Request).

## Solution

### Improved Error Handler (`src/index.ts:321-347`)

```typescript
catch (err) {
  // Handle errors properly with descriptive messages
  console.error('Error performing action:', err)

  let errorMessage = 'Unknown error occurred'
  let statusCode = 500

  if (typeof err === 'string') {
    errorMessage = err
    // Business logic errors should be 400
    if (err.includes('cannot') || err.includes('no track') || err.includes('not found')) {
      statusCode = 400
    }
  } else if (err instanceof Error) {
    errorMessage = err.message
  } else if (err && typeof err === 'object') {
    errorMessage = JSON.stringify(err)
  }

  return {
    statusCode,
    body: JSON.stringify({
      error: errorMessage,
      action: actionName,
    }),
  }
}
```

### Key Improvements

1. **Correct Response Format:** Returns `body` property with JSON string
2. **Error Classification:**
   - Business logic errors → 400 Bad Request
   - System errors → 500 Internal Server Error
3. **Descriptive Messages:** Returns the actual error message to the user
4. **Proper Logging:** Logs errors for debugging while returning clean responses

## Error Types and Status Codes

| Error Message | Status Code | Type |
|--------------|-------------|------|
| "cannot promote if confirmed" | 400 | Business logic - track already in final state |
| "no track provided" | 400 | Business logic - no track playing |
| "not found" | 400 | Business logic - resource doesn't exist |
| Other errors | 500 | System error |

## Testing

### Before Fix
```bash
curl "https://API_URL?action=promote"
# Response: {"message": "Internal server error"}
# Lambda logs: Unhandled Promise Rejection
```

### After Fix
```bash
curl "https://API_URL?action=promote"
# Response when track is already confirmed:
{
  "error": "cannot promote if confirmed",
  "action": "promote"
}
# Status: 400 Bad Request
```

## Business Logic: Track Triage States

The promote action moves tracks through these states:
1. **Unheard** (Inbox playlist) → Promote → **Liked** (Current playlist)
2. **Liked** (Current playlist) → Promote → **Confirmed** (stays in Current)
3. **Confirmed** → ❌ Cannot promote further

When a track is already confirmed and you try to promote it, you now get a clear 400 error instead of a crash.

## Related Files

- `src/index.ts` - Lambda handler with improved error handling
- `src/actions/track-action.ts:147` - Where "cannot promote if confirmed" is thrown
- `src/actions/magic-promote-action.ts` - MagicPromoteAction implementation

## Resolution

✅ Error responses now use correct format (`body` property)
✅ Business logic errors return 400 instead of 500
✅ Clear error messages returned to users
✅ No more unhandled promise rejections
✅ Errors properly logged for debugging
