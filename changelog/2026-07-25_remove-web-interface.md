# Remove Web Interface

## Summary

Excised the React web frontend entirely. It was added in early 2025 (`feat(web): add React web frontend with Bun and Vite`, commit `8e2f656`), never saw real use, and has been dead weight in the Lambda bundle and the docs ever since. The system is now purely an action-endpoint Lambda + CLI.

## Deleted

- **`web/`** — the entire React 19 + Vite + Tailwind app (components, hooks, API client, build config, lockfiles, `dist/` output)
- **`src/web-api.ts`** — `webApiHandler` and all `/api/*` endpoints (`health`, `dashboard`, `playlists`, `tracks/current`, `actions/recent`, `POST actions/*`, and the `debug/env`, `debug/event`, `debug/scan` debug endpoints)
- **`src/local-server.ts`** — the local HTTP server on port 3001 that wrapped the Lambda handler with CORS for the Vite dev server
- **`dev.sh`** — script that ran the API server and web client concurrently
- **`dist/web-api.js(.map)`, `dist/local-server.js(.map)`** — stale compiled artifacts (`tsc` never prunes deleted sources)

## Changed

- **`src/index.ts`** — removed the `webApiHandler` import, the `serveStaticFile` helper, `/api/*` routing, static-asset routes, the root-path React app serving, and the SPA client-side-routing fallback. The handler now only resolves action names. `actionNameFromEvent` no longer special-cases `/api/` paths (the dot-path guard stays so e.g. `/favicon.ico` is never treated as an action).
- **`src/cli-bun.ts`** — updated the stale comment on the `/action.lambda` default path (it existed to dodge static file serving, which no longer exists), and added a dotted-path guard in `--server` mode so browser noise like `GET /favicon.ico` 404s immediately instead of triggering DynamoDB reads and a Spotify token load (the deleted static-file branch used to intercept those requests)
- **`API_GATEWAY_URL.md`** — Implementation Details section no longer quotes the deleted `httpMethod` extraction line
- Behavior note: `GET /?action=promote` on the Lambda Function URL now actually executes the action; previously the root-path check served the React `index.html` before the query parameter was ever consulted
- **`package.json`** — removed the `dev`, `dev:api`, and `dev:web` scripts and the `concurrently` devDependency; `bun.lock` and `yarn.lock` regenerated
- **`tsconfig.json`** — removed `"web"` from the `exclude` array
- **`scripts/publish.rb`** — no longer builds the React app before packaging; dropped the `web/node_modules/*` and `web/src/*` zip exclusions
- **`.claude/settings.local.json`** — removed the now-meaningless `Bash(yarn dev:api:*)` and `Bash(yarn dev)` permission allowlist entries

## Docs

- **`CLAUDE.md`** — removed the Web Frontend Development commands and the Web Frontend architecture section; updated the build/deploy notes and the Lambda-handler routing description
- **`HTTP_API_GUIDE.md`** — removed the `Web Dashboard API` and `Debug Endpoints` sections (all `/api/*` routes lived in `src/web-api.ts`)
- **`docs/aws-infrastructure.md`** — removed the React build step and web zip exclusions from the deployment section
- Historical `changelog/` entries mentioning the frontend were left untouched — they are records, not docs

## Kept (not web-frontend despite the name)

- `yarn cli:bun:server` / `src/cli-bun.ts --server` — Bun server exposing action endpoints locally; unrelated to the React app
- The Lambda Function URL CORS config (`AllowOrigins: *`) — infrastructure-level, applies to all endpoints
- `spotify-web-api-node` and the Spotify Web API skill — that "web" belongs to Spotify, not us
