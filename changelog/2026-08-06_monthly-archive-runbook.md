# Monthly archive runbook

**Date:** 2026-08-06

Added `docs/monthly-archive-runbook.md` — an operator runbook for the recurring
task of filing each month's new archive playlist into the History folder.

- Centres on the **manual credential-capture** path (DevTools → ephemeral shell
  export), recommended over stored/minted creds for a ~monthly one-shot: it
  stores no long-lived secret and avoids the anti-abuse-bypass mint path.
- Covers: the three credentials and their lifetimes, capture steps, dry-run
  checks (what "only the new month" looks like before applying), `--apply`,
  verification, and cleanup.
- Includes a troubleshooting table (401, missing vars, ambiguous/duplicate
  skips, zero/multiple History folders, inaccessible playlists) and the
  convergent-recovery / backup-restore posture.
- Notes the not-built **Keychain + `sp_dc` mint** alternative and its trade-offs,
  and the standing hygiene rule: `.env` holds only `SPOTIFY_USER_ID`, never the
  two token secrets.
- Linked from `AGENTS.md`'s tool section.

No code changed.
