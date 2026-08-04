import { describe, it, expect } from 'bun:test'
import { buildArchiveMatcher, buildArchiveNamer } from '../settings'

/**
 * ArchiveAction uses this to decide which playlists count as archives when
 * excluding archived tracks from the "quietly disappeared" sweep. A false
 * negative here marks legitimately archived tracks as 'removed', so the
 * matcher has to stay exactly in step with `archivePlaylistNameFor`.
 */
describe('buildArchiveMatcher', () => {
  const isArchive = buildArchiveMatcher()
  const isTestArchive = buildArchiveMatcher('[Test]')

  it('matches every month of a production archive name', () => {
    const months = [
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

    for (let month of months) {
      expect(isArchive(`2026 - ${month}`)).toBe(true)
    }
  })

  it('escapes the dev prefix rather than treating it as a character class', () => {
    expect(isTestArchive('[Test] 2026 - July')).toBe(true)
    // '[Test] ' as an unescaped regex would let any of those letters match
    expect(isTestArchive('T 2026 - July')).toBe(false)
  })

  it('treats every regular-expression metacharacter in a prefix literally', () => {
    const prefix = String.raw`.[Monthly](+)?^$|{archive}\\`
    const isPrefixedArchive = buildArchiveMatcher(prefix)

    expect(isPrefixedArchive(`${prefix} 2026 - July`)).toBe(true)
    expect(isPrefixedArchive('anything 2026 - July')).toBe(false)
  })

  it('keeps the two prefixes from matching each other', () => {
    expect(isArchive('[Test] 2026 - July')).toBe(false)
    expect(isTestArchive('2026 - July')).toBe(false)
  })

  it('does not match the triage or smart playlists', () => {
    const notArchives = [
      'Inbox',
      'Current',
      'Starred',
      'Release Radar',
      'Discover Weekly',
      'Smart Playlist - Starred',
      'Modern Funk? [A]',
      '2026 - Julyish',
      'best of 2026 - July',
      '26 - July',
      '2026 - Smarch',
      '2026-July',
    ]

    for (let name of notArchives) {
      expect(isArchive(name)).toBe(false)
    }
  })
})

/**
 * The tests above feed the matcher hand-written strings, which is exactly how a
 * namer that produced *different* strings went unnoticed: `buildArchiveNamer`
 * used to normalize onto its captured `prefix`, so the second call onward grew
 * an extra space and forked a new archive playlist per aged track.
 *
 * ArchiveAction calls the namer once per track, so these round-trip through the
 * real output of a repeatedly-called namer instead.
 */
describe('buildArchiveNamer round-trips through buildArchiveMatcher', () => {
  const januaryThroughDecember = Array.from({ length: 12 }, (_, month) =>
    new Date(Date.UTC(2026, month, 15, 12)).toISOString(),
  )

  for (let [label, prefix] of [
    ['production', undefined],
    ['dev', '[Test]'],
  ] as const) {
    it(`survives repeated calls with the ${label} prefix`, () => {
      const nameFor = buildArchiveNamer(prefix)
      const isArchive = buildArchiveMatcher(prefix)

      const names = januaryThroughDecember.map((added_at) =>
        nameFor({ added_at }),
      )

      for (let name of names) {
        expect(isArchive(name)).toBe(true)
      }
    })

    it(`returns a stable name for the same month with the ${label} prefix`, () => {
      const nameFor = buildArchiveNamer(prefix)
      const added_at = januaryThroughDecember[6]

      const repeated = Array.from({ length: 5 }, () => nameFor({ added_at }))

      expect(new Set(repeated).size).toBe(1)
    })
  }
})
