# lambda release 1def67b13ef8 (production)

| Field | Value |
|---|---|
| Version | 1def67b13ef8 |
| Channel | production (spotify-playlist-dev, us-east-1, https://spotify.tal.by) |
| Artifact | CodeSha256 `F4SLzmaM7xg1almE5/MNzu8Uvhx0ehwbFje4eNpCfMU=` (was `CyhYCqOTvbI5tah4fg0OIOTXx/AX+OQT8jy6DLtt7oI=`) |
| Bump commit / tag | none (git-sha, no-op bump) / `builds/lambda/production/1def67b13ef8` |
| Previous production release | none (first tagged release) |
| Status | shipped |

## What's New
- Every track on the dashboard now opens its own detail page, with a timeline of its trip through Inbox, Liked, Current and Archive, every listen count, and a list of events.
- Dashboard sections and track pages now have their own real URLs (/current, /inbox, /track/<id>…).
- A new "Slice of Starred 🦦" playlist is refreshed every six hours with a random 45-song run from Starred.

## Pipeline notes
- First tagged lambda release, so `since-last-tag.sh` had no base and listed 31 commits. The previous live code was last modified 2026-09-17 23:14 UTC, matching `ecddbe3`, so the notes cover only the two commits after it (`24d44de`, `1def67b`).
- `1def67b` was committed without tests; preflight ran `bun run typecheck` (clean) and `bun test` (590 pass / 0 fail) before shipping.
- Verified after deploy: `LastUpdateStatus: Successful`, new CodeSha256; `/`, `/current`, `/track/<id>`, `/app.js` all 200; `/api/track/<id>` returns a full plan.
- Rollback: redeploy `ecddbe3` (untagged) via a worktree + `ruby scripts/publish.rb`.
