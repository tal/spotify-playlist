# Monthly runbook — file the new archive into the History folder

**What this does:** moves the newest root-level `YYYY - MonthName` archive playlist
into the root-level **History** folder, at the **top** (newest-first). It never
reorders or removes anything already in History.

**When to run:** about once a month, after the automation has created the new
month's archive playlist at the root of your library. Takes ~2 minutes.

**Where to run:** from the repo root on your Mac:
`/Users/tal/Projects/spotify-playlist.move-to-folder`

> ⚠️ This uses Spotify's **private** web-player endpoint (folders aren't in the
> official API). It is unofficial and can break at any time. If a step behaves
> unexpectedly, stop and re-capture the wire format (see
> `docs/rootlist-capture.md`) rather than forcing it.

---

## The three credentials

| Variable | What | Lifetime | Secret? |
|---|---|---|---|
| `SPOTIFY_USER_ID` | your Spotify user id | forever | no — already in `.env` |
| `SPOTIFY_CLIENT_TOKEN` | the `client-token` header | ~14 days | yes |
| `SPOTIFY_SPCLIENT_TOKEN` | the web-player bearer | **~1 hour** | yes |

Because the bearer dies within an hour, **you capture both token values fresh
each month.** `SPOTIFY_USER_ID` is stable and lives in `.env` — you never touch
it.

---

## Step 1 — Capture the two tokens from DevTools (~60s)

1. Open **https://open.spotify.com** in Chrome, signed in.
2. Open **DevTools → Network**. In the filter box type `spclient`.
3. Click any playlist in the left sidebar (this fires a request). Click a
   request to `spclient.wg.spotify.com` in the Network list.
4. In **Headers → Request Headers**, copy two values:
   - `authorization` → drop the leading `Bearer ` → this is `SPOTIFY_SPCLIENT_TOKEN`
   - `client-token` → copy verbatim → this is `SPOTIFY_CLIENT_TOKEN`

> Do **not** paste these into `.env` or any file. They go into the shell only
> (next step). A `.env` here is auto-loaded into other tooling sessions.

## Step 2 — Export them into your terminal (this shell only)

```bash
cd /Users/tal/Projects/spotify-playlist.move-to-folder
export SPOTIFY_SPCLIENT_TOKEN='<paste bearer, no "Bearer " prefix>'
export SPOTIFY_CLIENT_TOKEN='<paste client-token>'
# SPOTIFY_USER_ID is already loaded from .env — nothing to do.
```

## Step 3 — Dry run (changes nothing)

```bash
bun run scripts/spotify-folders/move-archives-to-folder.ts
```

**Read the output before applying.** A healthy run looks like:

```
History folder found (id: ...)
Eligible root archives:           1
...
Would prepend into History (1), newest first:
  2026 - August  from root          ← the new month, and ONLY it
...
Dry run. Re-run with --apply to perform these changes.
```

Confirm all of these before continuing:

- ✅ **Eligible root archives: 1**, and the prepend list shows **only the new
  month** you expect.
- ✅ No `Skipped — ambiguous` lines and no `Skipped — already filed` for the
  month you're filing.
- ✅ It found exactly one History folder (no error about zero/multiple).

If any of those is off, **stop** — see Troubleshooting.

## Step 4 — Apply (the write)

```bash
bun run scripts/spotify-folders/move-archives-to-folder.ts --apply
```

There is no confirmation prompt — it applies the plan it just printed. Success
looks like:

```
Applying these changes now (--apply). A backup is written before the first change.
Applied. History is up to date after 2 iteration(s).
Backup: ~/Library/Application Support/spotify-playlist/rootlist-backups/<timestamp>.json
```

Note the **backup path** — it's a credential-free snapshot of the rootlist from
just before the write, kept as restore evidence.

## Step 5 — Verify

```bash
bun run scripts/spotify-folders/move-archives-to-folder.ts
```

Should now report **`Eligible root archives: 0`** and **`Nothing to prepend`**
(the archive is now counted under *Already in History*). Optionally, open Spotify
with the sidebar in **Custom order** and confirm the new month sits at the top of
History, above last month.

## Step 6 — Clean up

```bash
unset SPOTIFY_SPCLIENT_TOKEN SPOTIFY_CLIENT_TOKEN
```

Or just close the terminal window. The bearer expires within the hour regardless.
`SPOTIFY_USER_ID` is not a secret and can stay.

---

## Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| `Transport failure (unauthorized ... HTTP 401)` | bearer/client-token expired | Re-capture both (Step 1) and re-run. Never retried automatically — this is intentional. |
| `Missing required environment variables` | a token isn't exported | Re-do Step 2. Check for typos in the variable names. |
| `Eligible root archives: 0` when you expected a new month | the month isn't at root, or isn't named `YYYY - MonthName` | Confirm the archive automation created it and it's at root, not already filed. |
| `Skipped — ambiguous root duplicates` | two root playlists share a year/month | Resolve by hand in Spotify (delete/rename one). The tool never guesses. Re-run. |
| `Skipped — already filed in History` | that month already exists in History | Expected if it's already filed; the root copy is left alone (not duplicated). |
| Error about **zero or multiple** History folders | can't identify the target | Ensure exactly one root-level folder named `History` exists. |
| `Inaccessible playlists: N (left untouched)` | some playlists couldn't be read (deleted/private) | Informational only — they're never touched. |

## If something went wrong (recovery)

- **The tool is convergent — re-running is the primary recovery.** A partial or
  interrupted apply is just an intermediate state; run `--apply` again and it
  recomputes from a fresh read and finishes. Safe for timeouts, stalls, and
  bounded aborts alike.
- Manual restore is only needed if the *desired state itself* was wrong (e.g. it
  moved the wrong playlist). In that case: **don't re-run** (it would re-apply the
  same wrong plan), open the printed backup JSON, and restore by hand in the
  Spotify client using it as the source of truth.
- There is no `--restore` command by design.

---

## Notes

- **`.env` should ideally hold only `SPOTIFY_USER_ID`** — the two token values
  are short-lived secrets and the shell-export path keeps them off disk. If old
  token values are left in `.env`, they're harmless: a shell `export` overrides
  them (Bun: real environment variables beat `.env`). The one gotcha — export
  **both** tokens in Step 2; if you export only one, a leftover stale value for
  the other would be used and you'd get a confusing 401.
- **Don't automate this on a schedule.** It needs fresh session creds and hits an
  unofficial endpoint that can break silently — you want to watch it run.
- **Zero-manual-capture option (not built):** store the long-lived `sp_dc` cookie
  in the macOS **Keychain** and have a wrapper mint fresh tokens on each run. This
  stores a full-account credential and uses an anti-abuse-bypass mint path, so
  it's a real security trade-off — ask if you want it built, otherwise the manual
  capture above is the lower-footprint choice for a monthly task.
- Command reference:
  - dry run: `bun run scripts/spotify-folders/move-archives-to-folder.ts`
  - apply:   `bun run scripts/spotify-folders/move-archives-to-folder.ts --apply`
  - `WRITE_MODE` in `scripts/spotify-folders/rootlist.ts` is the kill switch: set
    it to `'disabled'` to make the tool refuse all writes.
