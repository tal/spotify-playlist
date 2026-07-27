# 2026-07-27 - Extract spotify-web-api Skill into the tal-marketplace Plugin

The `spotify-web-api` skill no longer lives in this repo. It moved to `tal/plugin-marketplace` as a standalone plugin (`plugins/spotify-web-api/`) and is pulled back in here via project settings, so the same reference is now usable from any repo instead of only this one.

## Files removed

- `.claude/skills/spotify-web-api/SKILL.md`
- `.claude/skills/spotify-web-api/references/authentication-flows.md`
- `.claude/skills/spotify-web-api/references/endpoints-complete.md`
- `.claude/skills/spotify-web-api/references/scopes-complete.md`
- `.claude/skills/spotify-web-api/examples/auth-flow.md`
- `.claude/skills/spotify-web-api/examples/curl-examples.sh`

Content moved byte-for-byte — nothing was rewritten in the process, including the 2026-07-27 reconciliation work.

## Files added

- `.claude/settings.json` — enables the plugin for this repo only:

```json
{
  "enabledPlugins": {
    "spotify-web-api@tal-marketplace": true
  }
}
```

Checked in rather than put in `.claude/settings.local.json`, since `**.local*` is gitignored and the skill was previously tracked.

## Prerequisite

The `tal-marketplace` marketplace has to be known to the client for the enable to resolve:

```
/plugin marketplace add tal/plugin-marketplace
```
