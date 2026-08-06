import { describe, it, expect } from 'bun:test'
import {
  parseArchivePlaylistName,
  isArchivePlaylistName,
} from '../archive-name'
import { buildArchiveNamer, buildArchiveMatcher } from '../../../src/settings'

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

describe('parseArchivePlaylistName', () => {
  it('parses every month of a production archive name with a zero-based month index', () => {
    for (const [index, month] of MONTH_NAMES.entries()) {
      expect(parseArchivePlaylistName(`2026 - ${month}`)).toEqual({
        year: 2026,
        month: index,
        kind: 'production',
      })
    }
  })

  it('parses every month of a [Test] archive name', () => {
    for (const [index, month] of MONTH_NAMES.entries()) {
      expect(parseArchivePlaylistName(`[Test] 2026 - ${month}`)).toEqual({
        year: 2026,
        month: index,
        kind: 'test',
      })
    }
  })

  it('returns a month index matching Date#getMonth(), not one-based', () => {
    for (const [index, month] of MONTH_NAMES.entries()) {
      const parsed = parseArchivePlaylistName(`2026 - ${month}`)
      const viaDate = new Date(2026, index, 15).getMonth()

      expect(parsed?.month).toBe(viaDate)
    }
  })

  it('parses representative years, including 4-digit years starting near either boundary', () => {
    for (const year of [1000, 1999, 2000, 2025, 2026, 2099, 9999]) {
      expect(parseArchivePlaylistName(`${year} - July`)).toEqual({
        year,
        month: 6,
        kind: 'production',
      })
    }
  })

  it('rejects a leading-zero or short year rather than parsing it loosely', () => {
    const notArchives = [
      '0026 - July', // 4 digits, but leading zero
      '026 - July', // 3 digits
      '26 - July', // 2 digits
      '0000 - July', // all zeros
      '12026 - July', // 5 digits — anchoring must reject this, not just the year rule
    ]

    for (const name of notArchives) {
      expect(parseArchivePlaylistName(name)).toBeNull()
      expect(isArchivePlaylistName(name)).toBe(false)
    }
  })

  it('anchors both ends: no leading or trailing text survives', () => {
    const notArchives = [
      '2026 - July (old)',
      '2026 - Julyish',
      'best of 2026 - July',
      ' 2026 - July',
      '2026 - July ',
      '2026 - July\n',
    ]

    for (const name of notArchives) {
      expect(parseArchivePlaylistName(name)).toBeNull()
    }
  })

  it('matches months against the literal MONTH_NAMES list, never \\w+', () => {
    const notArchives = [
      '2026 - Smarch',
      '2026 - Jul', // prefix of a real month, but not the whole thing
      '2026 - Julyy',
      '2026 - july', // wrong case
      '2026 - JULY',
    ]

    for (const name of notArchives) {
      expect(parseArchivePlaylistName(name)).toBeNull()
    }
  })

  it('rejects the triage and smart playlists', () => {
    const notArchives = ['Current', 'Inbox', 'Starred', 'Archive 2026-07']

    for (const name of notArchives) {
      expect(parseArchivePlaylistName(name)).toBeNull()
    }
  })

  it('rejects whitespace and casing variants of the [Test] prefix', () => {
    const notArchives = [
      '2026 -July', // missing space before month
      '2026- July', // missing space after year
      '2026  - July', // doubled space before dash
      '[test] 2026 - July', // lowercase prefix
      '[TEST] 2026 - July',
      '[Test]2026 - July', // missing space after bracket
      '[Test]  2026 - July', // doubled space after bracket
      '(Test) 2026 - July', // wrong bracket kind
    ]

    for (const name of notArchives) {
      expect(parseArchivePlaylistName(name)).toBeNull()
    }
  })
})

describe('isArchivePlaylistName', () => {
  it('is true exactly when parseArchivePlaylistName is non-null', () => {
    const names = [
      '2026 - July',
      '[Test] 2026 - July',
      'Current',
      '2026 - Julyish',
      '026 - July',
    ]

    for (const name of names) {
      expect(isArchivePlaylistName(name)).toBe(
        parseArchivePlaylistName(name) !== null,
      )
    }
  })
})

/**
 * Drift guard. `archive-name.ts` deliberately duplicates the naming format
 * instead of importing `src/settings.ts` (this tool ships outside the Lambda
 * package and stays free of `src/` coupling — see the file header). That
 * duplication is only safe as long as it's pinned against BOTH exported
 * factories, so this feeds `buildArchiveNamer`'s actual output — for every
 * month, in both the production and `[Test]` branches — into the parser above
 * and asserts round-trip agreement, then cross-checks the parser against
 * `buildArchiveMatcher`, which `src/settings.ts:38-47` designates as the
 * canonical machine-readable statement of the archive name format.
 *
 * The matcher is prefix-scoped where the parser is not: `buildArchiveMatcher()`
 * accepts production names only, and `buildArchiveMatcher('[Test]')` accepts
 * `[Test] ` names only, while `parseArchivePlaylistName` accepts either and
 * reports which via `kind`. Agreement is therefore asserted per prefix, as
 * `matcher(name) === (parsed !== null && parsed.kind === expectedKind)`.
 *
 * `buildArchiveNamer` is globals-free (confirmed: no `dev`/`days`/DynamoDB
 * dependency), so this imports it directly with no `-run-this-first` or
 * `settings()` global-flipping needed.
 *
 * Dates are built at noon UTC, matching src/__tests__/archive-playlist-name.test.ts
 * — `archivePlaylistNameFor` reads `addedAt.getMonth()`/`getFullYear()` in
 * local time, so a midnight-UTC date would roll to the wrong month/year in
 * timezones west of UTC.
 */
describe('parseArchivePlaylistName round-trips through the real buildArchiveNamer', () => {
  const januaryThroughDecember = Array.from({ length: 12 }, (_, month) =>
    new Date(Date.UTC(2026, month, 15, 12)).toISOString(),
  )

  for (const [label, prefix, expectedKind] of [
    ['production', undefined, 'production'],
    ['dev', '[Test]', 'test'],
  ] as const) {
    it(`agrees with buildArchiveNamer for all 12 months (${label})`, () => {
      const nameFor = buildArchiveNamer(prefix)

      for (const [index, added_at] of januaryThroughDecember.entries()) {
        const name = nameFor({ added_at })
        const parsed = parseArchivePlaylistName(name)

        expect(parsed).toEqual({
          year: 2026,
          month: index,
          kind: expectedKind,
        })
        expect(isArchivePlaylistName(name)).toBe(true)
      }
    })

    it(`agrees with buildArchiveMatcher on accepts and rejects (${label})`, () => {
      const nameFor = buildArchiveNamer(prefix)
      const matches = buildArchiveMatcher(prefix)

      // Everything the real namer emits, the real matcher must accept and this
      // tool's parser must classify as `expectedKind`.
      for (const added_at of januaryThroughDecember) {
        const name = nameFor({ added_at })

        expect(matches(name)).toBe(true)
        expect(parseArchivePlaylistName(name)?.kind).toBe(expectedKind)
      }

      // And on everything else the two must still agree, so a future loosening
      // of either format definition breaks here instead of silently diverging.
      const corpus = [
        '2026 - July',
        '[Test] 2026 - July',
        '2026 - December',
        '[Test] 1999 - January',
        '2026 - Jul',
        '2026 - Smarch',
        '2026 - july',
        '2026 - July (old)',
        '026 - July',
        '12026 - July',
        ' 2026 - July',
        '2026 - July ',
        '[test] 2026 - July',
        '[Test]2026 - July',
        'Current',
        'Inbox',
        'Archive 2026-07',
      ]

      for (const name of corpus) {
        const parsed = parseArchivePlaylistName(name)

        expect(matches(name)).toBe(
          parsed !== null && parsed.kind === expectedKind,
        )
      }
    })

    /**
     * The ONE place the two definitions deliberately disagree, pinned so it
     * stays deliberate: `buildArchiveMatcher` uses `\d{4}`, which accepts a
     * leading-zero year, while this tool's parser uses `[1-9]\d{3}` and
     * rejects it (see the pattern comment in `archive-name.ts`).
     *
     * The divergence is unreachable in practice — `buildArchiveNamer` derives
     * the year from `Date#getFullYear()`, which cannot produce `0026` for any
     * `added_at` this system will ever see — and the tool errs toward NOT
     * classifying a playlist as an archive, which is the safe direction for a
     * tool that decides what to move. It is asserted rather than silently
     * excluded so a future edit to either regex has to confront it.
     */
    it(`is strictly narrower than buildArchiveMatcher on leading-zero years (${label})`, () => {
      const matches = buildArchiveMatcher(prefix)
      const namePrefix = prefix ? `${prefix} ` : ''

      for (const year of ['0026', '0000', '0999']) {
        const name = `${namePrefix}${year} - July`

        expect(matches(name)).toBe(true)
        expect(parseArchivePlaylistName(name)).toBeNull()
      }
    })
  }
})
