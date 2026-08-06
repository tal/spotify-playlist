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

export async function settings() {
  if (dev.isDev) {
    return {
      inbox: 'Inbox Test',
      current: 'Current Test',
      releaseRadar: 'Release Radar',
      discoverWeekly: 'Discover Weekly',
      starred: 'Starred',
      timeToArchive: 1 * DAY_MS,
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
      timeToArchive: 30 * DAY_MS,
      promoteThrottleMs: 5 * HOUR_MS,
      archivePlaylistNameFor: buildArchiveNamer(),
    }
  }
}

export type Settings = Awaited<ReturnType<typeof settings>>
