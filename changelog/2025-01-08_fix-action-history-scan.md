# Fix Action History DynamoDB Scan

## Date: 2025-01-08

## Summary
Fixed the action history retrieval to properly scan DynamoDB and find recent actions by implementing pagination and better error handling.

## Problem
The action history was not showing recent actions because:
1. The DynamoDB scan was limited to only 100 items
2. With many items in the table, the scan would not find recent actions
3. Throughput errors were causing the scan to fail completely

## Changes Made

### Updated DynamoDB Scan Logic (`src/db/dynamo.ts`)

1. **Implemented proper pagination**:
   - Continues scanning until enough items are found or no more data exists
   - Scans up to 500 items per request (up from 100)
   - Supports up to 10 scan attempts to prevent infinite loops

2. **Added exponential backoff for throughput errors**:
   - Detects `ProvisionedThroughputExceededException` errors
   - Implements exponential backoff starting at 1 second
   - Maximum backoff of 10 seconds

3. **Improved debugging**:
   - Logs scan progress including items found vs scanned
   - Shows the most recent 3 actions found for verification
   - Tracks total items scanned across all attempts

4. **Added progressive delays**:
   - Small delays between scan attempts to avoid throughput issues
   - Delay increases with each attempt (100ms * attempt number)

### Enhanced Debug Endpoint (`src/web-api.ts`)

1. **Added filtering capabilities**:
   - Can filter by user with `?user=username` parameter
   - Configurable limit with `?limit=N` parameter
   - Defaults to user 'koalemos' and limit 20

2. **Improved response format**:
   - Shows both matched items count and total scanned count
   - Includes formatted date strings for easier debugging
   - Sorts results by created_at descending

## Technical Details

The scan operation now:
- Uses pagination via `ExclusiveStartKey` to continue where previous scans left off
- Collects all matching items before sorting and limiting
- Handles throughput errors gracefully with retries
- Provides detailed logging for troubleshooting

## User Impact

Users should now see their recent actions in the action history, even if the DynamoDB table contains many items. The system is more resilient to throughput errors and provides better visibility into what's happening during the scan process.