# lambda release 57b7fa07bb0f (production)

| Field | Value |
|---|---|
| Version | 57b7fa07bb0f |
| Channel | production (spotify-playlist-dev, us-east-1, https://spotify.tal.by) |
| Artifact | CodeSha256 `8YCWpvvRcD6NahTkJd9tHTmhNr+pQwULCJSugSvsNmI=` (was `F4SLzmaM7xg1almE5/MNzu8Uvhx0ehwbFje4eNpCfMU=`) |
| Bump commit / tag | none (git-sha, no-op bump) / `builds/lambda/production/57b7fa07bb0f` |
| Previous production release | 1def67b13ef8 |
| Status | shipped |

## What's New
- Track pages now show when a song was archived using the archive job's own records, so automatically archived songs get an exact Archived step.
- From now on, each archive is also recorded on the song itself, with a link back to the archive run that moved it.
- Songs re-promoted while already in Current no longer show a false step back to Liked.

## Pipeline notes
- Changes the six-hourly `frequent-crawling` write path: `ArchiveAction` now appends an `'archive'` triage action (with `action_ref`) per archived track. First live write happens on the next run that archives something; nothing was backfilled.
- Verified: `LastUpdateStatus: Successful`, new CodeSha256; `/` and `/track/<id>` 200; `/api/track/6oFYok4fAYh2Llciy3NA2x` ("Madhouse") now reads unheard → liked → current → archived with the archive from `action-history`.
- Preflight: typecheck clean, 596 pass / 0 fail.
- Rollback: redeploy `builds/lambda/production/1def67b13ef8`. Any `'archive'` triage entries already written stay on track rows; older code ignores unknown action types in status mapping only if the map lookup tolerates them (it returns undefined → status-neutral).
