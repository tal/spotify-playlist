# Per-Stage Listen Counts (Inbox / Current)

Adds playlist-scoped listen counters alongside the existing global `play_count`, so
archiving can eventually be gated on "how many times have I actually played this from
Current" instead of only "how long has it sat there".

**Archiving behaviour is unchanged.** `ArchiveAction` still gates purely on
`timeToArchive` (30 days). This change only starts collecting the data.

## What was added

- `TriageStage` — a `'inbox' | 'current'` union in `src/db/track.d.ts`, plus
  `StagePlayCountAttribute` (`` `play_count_${TriageStage}` ``).
- Two new optional attributes on `TrackItem`: `play_count_inbox`, `play_count_current`.
- `UpdateTrackParams.stage` — when set, `Dynamo.updateTrack()` appends a second
  `if_not_exists(...) + :incr` clause to the **same** `UpdateCommand` as the global
  counter, so a stage-attributed listen still costs exactly one write.
  `playCountAttributeFor(stage)` derives the attribute name.
- `ProcessPlaybackHistoryAction` now resolves the Inbox/Current playlist ids
  (`optionalPlaylist`, memoized — one playlist fetch) and attributes each played item by
  matching `pi.context?.uri` against them. `playlistIdFromContextUri()` matches the
  trailing id so both `spotify:playlist:<id>` and `spotify:playlist_v2:<id>` work.
- `listen-stats` action + CLI command (`bun run cli:bun listen-stats`) — dumps every track
  in Current with global / inbox / current play counts and days-since-added, sorted by
  plays-from-Current ascending, plus a `neverPlayedFromCurrent` tally.

### Counter semantics

- **Cumulative forever.** Promoting Inbox → Current does not reset anything;
  `play_count_inbox` stays as history while `play_count_current` grows.
- **"Listens started from"**, not "listens while it lived there". A play only counts toward
  a stage when Spotify reports that playlist as the playback context. Plays from Liked
  Songs, an album, search, or autoplay past the end of a playlist have no (or a different)
  context and increment `play_count` only.
- **No backfill is possible** — Spotify only exposes the last ~50 plays — so every existing
  track starts at 0 for both stage counters.

## Bugs fixed along the way

| Location | Bug |
|---|---|
| `src/actions/process-playback-history-action.ts` | Payload used key `context` where `UpdateTrackParams` expects `seen`. Type-checked silently (mapped variable, so no excess-property check) and was dropped at runtime — `first_seen`/`last_seen` had **never** been written by playback processing. |
| `src/mutations/add-track-listen-mutation.ts` | `dynamo.updateTrack()` was not awaited — fire-and-forget writes can be truncated when the Lambda handler returns. |
| `src/mutations/update-last-played-processed-mutation.ts` | Same missing `await` on the watermark write. A truncated write would re-process the same plays next run and double-count them. |
| `src/db/dynamo.ts` | `getTracks()` threw a bare string when *none* of the requested ids had rows yet. Now returns the (possibly empty) map; callers already handle `undefined` lookups. |
| `src/actions/process-manual-triage.ts` | `performCurrent()` built its `promote` mutations and then `return []`, so they never executed. Now returns `[mutations]`. |

> **Correction (2026-08-02).** The `add-track-listen-mutation.ts` row above is only half the
> story, and the framing that awaiting these writes *prevents* double-counting is inverted for
> the listen writes specifically. Awaiting them made a single failed listen write abort the
> action before the watermark mutation — deliberately last — ever ran, so every listen already
> written that pass got re-counted on the next run, and again on every run until the failure
> cleared. Fixed in `2026-08-02_adversarial-review-high-priority-fixes.md`. The watermark row is
> accurate as written.
| `src/index.ts` | `frequent-crawling` ran `ArchiveAction` before `ProcessPlaybackHistoryAction`, so any listen-based gate would read counts up to 6 hours stale. Playback history now runs first. |
| `src/cli-bun.ts` | Result was printed as one escaped line; now pretty-printed. |

## Verification

- `bunx tsc --noEmit` — clean across 57 source files.
- `bun test` — 33 pass / 0 fail.
- No DynamoDB schema migration required; the new attributes are created lazily by
  `if_not_exists`.

## Follow-ups (not done)

- Wiring `ArchiveAction` to a `listensBeforeArchive` threshold — deliberately deferred until
  there is real data to pick a number from.
- If `listen-stats` shows most listens landing uncredited, consider either attributing
  context-less plays by current playlist membership, or adding a
  `play_count_uncontexted` counter to measure the gap first.
- `getTracks()` ignores `UnprocessedKeys` from `BatchGetCommand` — a throttled batch
  silently returns partial results.
