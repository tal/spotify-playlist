# 2025-08-07 - Bun CLI Runtime Support

## Overview
Added support for running Lambda functions locally using Bun runtime without compilation, replacing the lambda-local dependency for faster development.

## Changes Made

### New Features
- **Created `src/cli-bun.ts`**: New CLI implementation that uses Bun's native TypeScript execution
  - Runs TypeScript directly without compilation step
  - Includes optional server mode with `--server` flag for interactive testing
  - Provides same functionality as original CLI but with instant startup

### Updated Files
- **Modified `src/cli.ts`**: Added Bun runtime detection
  - Automatically uses direct handler import when running with Bun
  - Falls back to lambda-local with compiled code when using Node.js
  - Maintains backward compatibility with existing workflows

- **Fixed `src/aws.ts`**: Corrected global variable access
  - Changed `dev.isDev` to `(globalThis as any).dev?.isDev` to handle uninitialized globals
  - Prevents runtime errors when globals aren't set

### Package Scripts
Added new npm scripts for Bun CLI:
- `npm run cli:bun [action]` - Run specific action with Bun (no compilation)
- `npm run cli:bun:server` - Start interactive server mode on port 3001

## Benefits
- **No compilation needed**: Run TypeScript directly with Bun
- **Faster iteration**: Instant startup compared to tsc + lambda-local
- **Server mode**: Test Lambda functions via HTTP requests
- **Backward compatible**: Original CLI still works with Node.js

## Usage Examples
```bash
# Run with Bun (no compilation)
bun run src/cli-bun.ts user
bun run src/cli-bun.ts promote
bun run src/cli-bun.ts archive

# Or use npm scripts
npm run cli:bun user
npm run cli:bun:server  # Starts server on http://localhost:3001

# Original CLI still works
npm run build && npm run cli user
```

## Technical Notes
- Bun natively executes TypeScript without transpilation
- Server mode uses `Bun.serve()` for HTTP handling
- Requires `require('./-run-this-first')` to initialize global variables
- Uses path `/action.lambda` to bypass static file serving in handler