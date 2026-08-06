/**
 * Self-contained archive-playlist-name parser for the History-folder tool.
 *
 * Deliberately imports NOTHING from `src/` — this is a standalone script
 * outside the Lambda package (see AGENTS.md / the archive-to-history-folder
 * plan for why `scripts/` never ships), so it carries its own copy of the
 * month list instead of reaching into `src/settings.ts`'s private
 * `MONTH_NAMES`.
 *
 * The format itself is NOT reinvented here: it is pinned against the real
 * `buildArchiveNamer` in `src/settings.ts` by the round-trip test in
 * `__tests__/archive-name.test.ts`, so a change to the production naming
 * scheme fails this file's tests rather than silently drifting.
 */

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
] as const

export type ParsedArchivePlaylistName = {
  year: number
  month: number
  kind: 'production' | 'test'
}

/**
 * Anchored both ends: optional exact `[Test] ` prefix, then `YYYY - MonthName`.
 *
 * - The year group is `[1-9]\d{3}`, not `\d{4}` — a leading-zero or short year
 *   (`0026`, `026`) is rejected rather than silently parsed as year 26.
 * - Months are matched against the literal `MONTH_NAMES` list, never `\w+`,
 *   so `2026 - Smarch` or `2026 - Julyish` cannot match.
 * - The trailing `$` immediately after the month alternation means any
 *   trailing text (`2026 - July (old)`) fails the match rather than being
 *   ignored.
 */
const ARCHIVE_PLAYLIST_NAME_PATTERN = new RegExp(
  `^(\\[Test\\] )?([1-9]\\d{3}) - (${MONTH_NAMES.join('|')})$`,
)

/**
 * Parse a playlist name as an archive name, or return null if it isn't one.
 *
 * `month` is zero-based (0 = January, 11 = December), matching both
 * `Date#getMonth()` and `buildArchiveNamer`'s `addedAt.getMonth()` in
 * `src/settings.ts` — callers can compare a parsed month directly against a
 * `Date` without an off-by-one adjustment.
 */
export function parseArchivePlaylistName(
  name: string,
): ParsedArchivePlaylistName | null {
  const match = name.match(ARCHIVE_PLAYLIST_NAME_PATTERN)
  if (!match) return null

  const [, testPrefix, yearText, monthName] = match

  return {
    year: Number(yearText),
    month: MONTH_NAMES.indexOf(monthName as (typeof MONTH_NAMES)[number]),
    kind: testPrefix ? 'test' : 'production',
  }
}

/** Convenience boolean-shaped predicate built on top of the parser above. */
export function isArchivePlaylistName(name: string): boolean {
  return parseArchivePlaylistName(name) !== null
}
