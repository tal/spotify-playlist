# 2026-08-26 — Archive on Play Count, and 30 → 45 Days

`ArchiveAction` gets a second trigger. A track now leaves Current when **either**
it has aged out **or** it has been played out — the two are alternatives, never a
conjunction — and both file it in exactly the same monthly archive.

| Setting          | Before  | After (prod) | After (dev)       |
| ---------------- | ------- | ------------ | ----------------- |
| `timeToArchive`  | 30 days | **45 days**  | 1 day (unchanged) |
| `playsToArchive` | —       | **5**        | **2**             |

## Where the numbers came from

Read off live `listen-stats` for the real account on 2026-08-26. The whole
Current playlist (18 tracks) spanned `play_count_current` 0–5, so 5 is the
current ceiling, not an arbitrary round number. Two tracks sit there:

```
5 plays / 24d  BlindLife — YDE
5 plays / 24d  Night at the Opera — Emei
```

Those two are what the next `frequent-crawling` pass archives, into
`2026 - August`. Nothing archives on age: the oldest track in Current is 24 days
in, and the window just widened to 45.

The threshold considered first was 2 — the count on _Smoking Gun_ (Inpatient,
Ren, Chris Webby), the track that prompted this. At 2 the rule would have moved
**13 of 18** tracks on the first pass, so 5 was chosen instead.

## Boundary shapes are deliberately different

- **Age is exclusive (`>`).** A track sitting at exactly `timeToArchive` stays.
  Unchanged, and still pinned to the millisecond either side.
- **Plays are inclusive (`>=`).** `play_count_current` counts things that have
  already happened, so the 5th play is the one that ends the rotation.

## What the rule inherits and does not fix

- `play_count_current` only counts plays whose Spotify **playback context was
  the Current playlist**. A listen from Liked Songs, search, an album, or
  contextless autoplay bumps the global `play_count` and moves a track no closer
  to being archived. The threshold is therefore an undercount of real listening.
- The counter is cumulative and never reset by a promote, so a track re-promoted
  into Current after an archive arrives already over the threshold and leaves
  again on the next pass. Known consequence, not handled here.

## Behavior change worth flagging: unparseable `added_at`

The age test was `now - addedAt <= timeToArchive → keep`. `new Date(garbage)` is
NaN, every comparison against NaN is false, so an unreadable date fell through to
"old enough" and the track archived immediately into a playlist the namer built
out of two NaNs — literally `NaN - undefined`. The previous suite pinned that
explicitly as _current, not desired_ behavior.

Restating the rule as `> timeToArchive → aged-out` inverts which way NaN falls:
the track now stays in Current, which is the recoverable answer. This was not
requested; it is a consequence of the condition being rewritten, and it is an
improvement, so it was kept rather than preserved with a double negative. Both
directions are pinned:

- unreadable date, 0 plays → stays in Current
- unreadable date, played out → still archives, still into `NaN - undefined`
  (the play trigger does not need a readable date; the namer still does)

## Code

- **`settings.ts`** — `playsToArchive` added to both branches; prod
  `timeToArchive` 30 → 45 days. Dev gets the fast variant (2), for the same
  reason dev's `timeToArchive` is a day: a test run has to reach the boundary.
- **`archive-action.ts`**
  - new exported `ArchiveVerdict = 'keep' | 'aged-out' | 'played-out'` and
    `archiveVerdict()` — the whole decision, pure, one call per track
  - `archiveBuckets` returns `{ byArchiveName, verdicts }`; the counts are for
    the log line only. Bucketing is untouched: destination is a function of the
    month the track was **promoted**, never of which trigger fired
  - `ArchiveCandidate` gains a **required** `play_count_current` and a required
    `track.id`. Required, not optional, so a gather shell that forgets to
    populate it fails to compile instead of silently reverting the pass to the
    age rule
  - new `archiveCandidates()` gather step does one keyed `getTracks` over
    exactly what Current holds. `tracksWithLiveStatus()` cannot supply the
    counters — that scan projects `id` and `status` only
  - id-less items (`{ track: null }`, region-blocked, pulled from the catalog)
    are now dropped in the gather rather than reaching the planner as candidates
    that could never be archived anyway
  - `ArchiveSnapshot` gains `playsToArchive`

## Verification

- **577 pass / 0 fail**, 1378 `expect()` calls, across `UTC`,
  `Pacific/Auckland`, `Asia/Kolkata`, `America/New_York`
- `tsc` clean on `src/`. One pre-existing error survives in
  `undo-plan.test.ts:137` (a `bun:test` `it.each` tuple-widening quirk); it is
  present on a clean tree and is untouched by this change
- Mutation tested, 5 hand-applied regressions, 5 caught:

  | Regression                                     | Caught by  |
  | ---------------------------------------------- | ---------- |
  | `>=` → `>` on the play threshold               | 2 failures |
  | play trigger deleted entirely                  | 3 failures |
  | age trigger reverted to the NaN-archiving form | 1 failure  |
  | played-out routed to its own playlist          | 3 failures |
  | gather stops reading counters (always 0)       | 1 failure  |

## Not done

Nothing deployed — this is working-tree only. `ruby scripts/publish.rb` still has
to run for the six-hour `frequent-crawling` rule to pick it up.
