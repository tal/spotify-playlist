import { escapeRegExp } from './utils/regex'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function buildArchiveNamer(prefix?: string) {
  // Derived once, out here. Every call shares this closure, so normalizing onto
  // the captured `prefix` appended another space per call ("[Test] 2026 - July",
  // "[Test]  2026 - July", …) — a fresh archive playlist per aged track, none of
  // which `buildArchiveMatcher` would then recognize.
  const namePrefix = prefix ? `${prefix} ` : ''

  return function archivePlaylistNameFor({
    added_at,
  }: {
    added_at: string
  }): string {
    const addedAt = new Date(added_at)
    const month = addedAt.getMonth()
    const year = addedAt.getFullYear()

    return `${namePrefix}${year} - ${MONTH_NAMES[month]}`
  }
}

/**
 * The inverse of buildArchiveNamer, and the only machine-readable statement of
 * the archive name format.
 *
 * No longer on the settings object: ArchiveAction used to exclude archived
 * tracks from its sweep by walking every archive playlist, and reconciling
 * 'promoted' rows against liked status instead made that walk unnecessary. It
 * stays exported because the round-trip test pins the namer against it — that
 * pairing is what catches a namer whose output drifts.
 */
export function buildArchiveMatcher(prefix?: string) {
  const pattern = new RegExp(
    `^${escapeRegExp(prefix ? `${prefix} ` : '')}\\d{4} - (${MONTH_NAMES.join('|')})$`,
  )

  return function isArchivePlaylistName(name: string): boolean {
    return pattern.test(name)
  }
}

const MINUTE_MS = 1000 * 60
const HOUR_MS = MINUTE_MS * 60
const DAY_MS = HOUR_MS * 24

/**
 * A track leaves Current when *either* trigger fires — they are alternatives,
 * not a conjunction:
 *
 * - `timeToArchive`  — it has sat in Current this long without being played out
 * - `playsToArchive` — it has been played from Current this many times, so its
 *                      rotation is done no matter how recently it arrived
 *
 * Both file the track in the same monthly archive. The dev values are the fast
 * variants, matching why dev's `timeToArchive` is a day rather than a month:
 * a test run has to be able to reach the boundary.
 *
 * `playsToArchive` counts `play_count_current` only, which Spotify increments
 * solely when the playback context *is* the Current playlist. Playing a track
 * from Liked Songs, search, an album or contextless autoplay bumps the global
 * `play_count` and moves it no closer to being archived.
 */
export async function settings() {
  if (dev.isDev) {
    return {
      inbox: 'Inbox Test',
      current: 'Current Test',
      releaseRadar: 'Release Radar',
      discoverWeekly: 'Discover Weekly',
      starred: 'Starred',
      timeToArchive: 1 * DAY_MS,
      playsToArchive: 2,
      promoteThrottleMs: 5 * MINUTE_MS,
      archivePlaylistNameFor: buildArchiveNamer('[Test]'),
    }
  } else {
    return {
      inbox: 'Inbox',
      current: 'Current',
      releaseRadar: 'Release Radar',
      discoverWeekly: 'Discover Weekly',
      starred: 'Starred',
      timeToArchive: 45 * DAY_MS,
      playsToArchive: 5,
      promoteThrottleMs: 5 * HOUR_MS,
      archivePlaylistNameFor: buildArchiveNamer(),
    }
  }
}

export type Settings = Awaited<ReturnType<typeof settings>>
