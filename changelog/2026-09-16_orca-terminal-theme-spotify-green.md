# 2026-09-16 — Orca terminal theme: Spotify green on deep forest green

Added an Orca terminal + Claude Code theme so this repo's worktrees are
distinguishable at a glance, using Spotify's own brand colors.

## What was added

- **`design/terminal-theme.json`** — the committed, repo-scoped theme (data, not
  code). Travels with any clone/worktree of the repo.
  - Accent: **Spotify green `#1ED760`** (cursor, palette green, Claude Code
    `promptBorder`, `claude` glyph, and statusline project name).
  - Background: **deep forest green** — `#0a1f13` (night), `#0d2618` (day).
  - Foreground: near-white mint (`#e8ffef` / `#eafff2`).
  - Full 16-slot ANSI palette, green-tinted but with functional hues for the
    other colors (red/yellow/blue/magenta/cyan lifted for the dark bg).

## Contrast (WCAG-verified with the skill's `contrast.py`)

| Pair | Ratio | Verdict |
|---|---|---|
| fg `#e8ffef` on bg `#0a1f13` | 16.40:1 | PASS text (≥7) |
| accent `#1ed760` on bg | 8.98:1 | PASS text (≥7) |
| ANSI grey (idx 8) `#6f9e82` on bg | 5.65:1 | ok body (≥4.5), still dimmer than fg |
| dim/inactive `#7fae92` on bg | 6.87:1 | ok body, dim |

## How it was applied

- `orca-theme apply` — terminal OSC colors are live in the current shell.
- `orca-theme install` — wrote `~/.claude/themes/spotify-playlist-night.json`
  and set the selection in `.claude/settings.local.json` (personal/gitignored).
- `statusName` picks up live via `orca-theme statusline-color` (no install needed).

## Note

- A **full Claude Code relaunch** is needed for the theme *selection* to take
  effect (the `theme` key doesn't hot-reload). New Orca terminals get the OSC
  colors automatically.
- The selection lives in personal `settings.local.json`, not the shared/committed
  settings — re-run `orca-theme install --shared` if the whole team should get it.
