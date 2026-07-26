# Fix Lambda Deployment Package Leaking Nested `.env` Files

## What happened

`scripts/publish.rb` excluded `.env` from the Lambda deployment zip with the pattern `-x".env"`, which only matches a `.env` file at the repository root. It did not match `.env` files in subdirectories.

A `spotify-api/.env` file (credentials for a local Bruno API-client collection, containing `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `ANTHROPIC_API_KEY`) was gitignored and never committed, but was **not** excluded from the zip. It was bundled into the `spotify-playlist-dev` Lambda function code and uploaded to AWS during a deploy on 2026-07-25.

## Fix

Changed the exclude pattern from `-x".env"` to `-x"*.env"` in `scripts/publish.rb`, which correctly matches `.env` files at any depth (verified locally: `zip -r ... -x"*.env"` excludes both `./.env` and `sub/.env`, whereas `-x".env"` only excluded the root-level file).

## Follow-up (not done as part of this change)

- The Lambda function was **not** redeployed with this fix yet — the leaked package is still the live deployment as of this commit.
- Consider rotating `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` / `ANTHROPIC_API_KEY` that were present in `spotify-api/.env`, since they were uploaded to AWS and are retrievable via `lambda:GetFunction` by anyone with access to that account.
