import { describe, expect, it } from 'bun:test'

import {
  classifyPlaylists,
  decodeFolderName,
  findHistoryFolder,
  formatMovePlan,
  parseRootlist,
  parseRootlistEntryUri,
  planHistoryMoves,
  RootlistPlannerError,
  type PlannerFailureKind,
} from '../planner'
import type {
  RootlistItem,
  RootlistMetaItem,
  RootlistSnapshot,
} from '../rootlist'

import sampleRootlist from './fixtures/rootlist.sample.json'

const sample = sampleRootlist as unknown as RootlistSnapshot

// ---------------------------------------------------------------------------
// Snapshot builder — keeps the synthetic cases readable
// ---------------------------------------------------------------------------

type Entry = { uri: string; name?: string; statusCode?: number }

function snapshotOf(entries: readonly Entry[]): RootlistSnapshot {
  const items: RootlistItem[] = entries.map((entry) => ({
    uri: entry.uri,
  }))
  const metaItems: RootlistMetaItem[] = entries.map((entry) => {
    if (entry.name === undefined && entry.statusCode === undefined) return {}
    const meta: RootlistMetaItem = {}
    if (entry.name !== undefined) meta.attributes = { name: entry.name }
    if (entry.statusCode !== undefined) meta.statusCode = entry.statusCode
    else meta.statusCode = 200
    return meta
  })

  return {
    revision: 'SYNTHETICREVISION0000000000000AA',
    length: entries.length,
    attributes: {},
    contents: { pos: 0, truncated: false, items, metaItems },
    timestamp: '1700000000000',
  }
}

let playlistCounter = 0
function playlist(name: string, statusCode?: number): Entry {
  playlistCounter += 1
  return {
    uri: `spotify:playlist:synthetic${playlistCounter}`,
    name,
    statusCode,
  }
}

function startGroup(id: string, name?: string): Entry {
  return {
    uri:
      name === undefined
        ? `spotify:start-group:${id}`
        : `spotify:start-group:${id}:${name}`,
  }
}

function endGroup(id: string): Entry {
  return { uri: `spotify:end-group:${id}` }
}

function expectPlannerFailure(fn: () => unknown, kind: PlannerFailureKind) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(RootlistPlannerError)
    expect((error as RootlistPlannerError).kind).toBe(kind)
    return error as RootlistPlannerError
  }
  throw new Error(`expected a RootlistPlannerError of kind ${kind}, got none`)
}

// ---------------------------------------------------------------------------

describe('parseRootlistEntryUri', () => {
  it('parses a playlist URI', () => {
    expect(
      parseRootlistEntryUri('spotify:playlist:5kKYkjvUCvNvjgtlNzfdEr'),
    ).toEqual({
      kind: 'playlist',
      id: '5kKYkjvUCvNvjgtlNzfdEr',
    })
  })

  it('parses a named start-group', () => {
    expect(
      parseRootlistEntryUri('spotify:start-group:46758b97bb37b942:History'),
    ).toEqual({
      kind: 'start-group',
      id: '46758b97bb37b942',
      name: 'History',
    })
  })

  it('parses a start-group with no name segment as name null', () => {
    expect(
      parseRootlistEntryUri('spotify:start-group:46758b97bb37b942'),
    ).toEqual({
      kind: 'start-group',
      id: '46758b97bb37b942',
      name: null,
    })
  })

  it('accepts a 15-char folder id (leading zero dropped)', () => {
    const parsed = parseRootlistEntryUri(
      'spotify:start-group:a6bbaa776ad1344:Current',
    )
    expect(parsed).toEqual({
      kind: 'start-group',
      id: 'a6bbaa776ad1344',
      name: 'Current',
    })
  })

  it('parses an end-group', () => {
    expect(parseRootlistEntryUri('spotify:end-group:e4c4d8863c6daee1')).toEqual(
      {
        kind: 'end-group',
        id: 'e4c4d8863c6daee1',
      },
    )
  })

  it('treats an unrecognised URI type as unknown rather than failing', () => {
    expect(parseRootlistEntryUri('spotify:album:abc')).toEqual({
      kind: 'unknown',
    })
    expect(parseRootlistEntryUri('not-a-uri')).toEqual({ kind: 'unknown' })
  })

  it('fails hard on a malformed marker', () => {
    expectPlannerFailure(
      () => parseRootlistEntryUri('spotify:start-group:'),
      'malformed-marker',
    )
    expectPlannerFailure(
      () => parseRootlistEntryUri('spotify:end-group:abc:extra'),
      'malformed-marker',
    )
  })
})

describe('decodeFolderName', () => {
  it('decodes plus as space and percent escapes', () => {
    expect(decodeFolderName('Rock+%26+Roll')).toBe('Rock & Roll')
  })

  it('returns the raw segment when the escape is malformed', () => {
    expect(decodeFolderName('100%bad')).toBe('100%bad')
  })
})

describe('parseRootlist folder stack', () => {
  it('records depth, parent and path for nested folders', () => {
    const parsed = parseRootlist(
      snapshotOf([
        startGroup('outer', 'Outer'),
        startGroup('inner', 'Inner'),
        playlist('Deep'),
        endGroup('inner'),
        endGroup('outer'),
      ]),
    )

    expect(parsed.folders.map((folder) => [folder.id, folder.depth])).toEqual([
      ['outer', 0],
      ['inner', 1],
    ])
    expect(parsed.folders[1].path).toEqual(['Outer', 'Inner'])
    expect(parsed.playlists[0].depth).toBe(2)
    expect(parsed.playlists[0].parentFolderId).toBe('inner')
    expect(parsed.playlists[0].folderPath).toEqual(['Outer', 'Inner'])
  })

  it('preserves the original entry index for every playlist', () => {
    const parsed = parseRootlist(
      snapshotOf([
        playlist('A'),
        startGroup('f', 'F'),
        playlist('B'),
        endGroup('f'),
        playlist('C'),
      ]),
    )
    expect(parsed.playlists.map((p) => p.index)).toEqual([0, 2, 4])
  })

  it('reads a missing name as null instead of crashing', () => {
    const parsed = parseRootlist(
      snapshotOf([{ uri: 'spotify:playlist:gone', statusCode: 404 }]),
    )
    expect(parsed.playlists[0].name).toBeNull()
    expect(parsed.playlists[0].statusCode).toBe(404)
  })

  it('collects unknown entries instead of failing', () => {
    const parsed = parseRootlist(snapshotOf([{ uri: 'spotify:album:xyz' }]))
    expect(parsed.unknownEntries).toEqual([
      { index: 0, uri: 'spotify:album:xyz' },
    ])
  })

  it('fails hard on an unbalanced end-group', () => {
    expectPlannerFailure(
      () => parseRootlist(snapshotOf([endGroup('nope')])),
      'unbalanced-end-group',
    )
  })

  it('fails hard on a mismatched end-group', () => {
    expectPlannerFailure(
      () => parseRootlist(snapshotOf([startGroup('a', 'A'), endGroup('b')])),
      'mismatched-end-group',
    )
  })

  it('fails hard on a duplicate folder id', () => {
    const error = expectPlannerFailure(
      () =>
        parseRootlist(
          snapshotOf([
            startGroup('dup', 'One'),
            endGroup('dup'),
            startGroup('dup', 'Two'),
            endGroup('dup'),
          ]),
        ),
      'duplicate-folder-id',
    )
    expect(error.details.folderId).toBe('dup')
  })

  it('fails hard on an unclosed folder', () => {
    const error = expectPlannerFailure(
      () =>
        parseRootlist(snapshotOf([startGroup('open', 'Open'), playlist('X')])),
      'unclosed-folder',
    )
    expect(error.details.folderIds).toEqual(['open'])
  })
})

describe('findHistoryFolder', () => {
  it('finds the single root-level History folder in the fixture', () => {
    const history = findHistoryFolder(parseRootlist(sample))
    expect(history.id).toBe('46758b97bb37b942')
    expect(history.startIndex).toBe(3)
    expect(history.endIndex).toBe(10)
    expect(history.depth).toBe(0)
  })

  it('ignores a PLAYLIST named History — only start-group markers count', () => {
    const parsed = parseRootlist(
      snapshotOf([
        playlist('History'),
        startGroup('h', 'History'),
        endGroup('h'),
      ]),
    )
    expect(findHistoryFolder(parsed).id).toBe('h')
  })

  it('rejects zero matches and names the root folders it did see', () => {
    const error = expectPlannerFailure(
      () =>
        findHistoryFolder(
          parseRootlist(snapshotOf([startGroup('o', 'Others'), endGroup('o')])),
        ),
      'history-folder-missing',
    )
    expect(error.details.rootFolderNames).toEqual(['Others'])
  })

  it('rejects two root-level History folders and reports both ids', () => {
    const error = expectPlannerFailure(
      () =>
        findHistoryFolder(
          parseRootlist(
            snapshotOf([
              startGroup('h1', 'History'),
              endGroup('h1'),
              startGroup('h2', 'History'),
              endGroup('h2'),
            ]),
          ),
        ),
      'history-folder-ambiguous',
    )
    expect(error.details.folderIds).toEqual(['h1', 'h2'])
  })

  it('rejects a History folder that exists only nested', () => {
    const error = expectPlannerFailure(
      () =>
        findHistoryFolder(
          parseRootlist(
            snapshotOf([
              startGroup('outer', 'Outer'),
              startGroup('h', 'History'),
              endGroup('h'),
              endGroup('outer'),
            ]),
          ),
        ),
      'history-folder-nested',
    )
    expect(error.details.paths).toEqual(['Outer / History'])
  })
})

describe('classifyPlaylists', () => {
  const parsed = parseRootlist(
    snapshotOf([
      playlist('2026 - July'), //            0 root production archive
      playlist('All Easy Starred'), //       1 root, not an archive
      playlist('[Test] 2026 - June'), //     2 root, test archive
      startGroup('h', 'History'), //         3
      playlist('2026 - May'), //             4 already in history
      playlist('Your Top Songs 2025'), //    5 unrelated in history
      endGroup('h'), //                      6
      startGroup('o', 'Others'), //          7
      playlist('2020 - March'), //           8 archive in another folder
      endGroup('o'), //                      9
    ]),
  )
  const history = findHistoryFolder(parsed)
  const classified = classifyPlaylists(parsed, history)
  const byName = new Map(
    classified.map((entry) => [entry.playlist.name, entry]),
  )

  it('marks a root production archive eligible', () => {
    expect(byName.get('2026 - July')!.disposition).toBe(
      'root-production-archive',
    )
    expect(byName.get('2026 - July')!.location).toBe('root')
  })

  it('marks a non-archive as not-an-archive', () => {
    expect(byName.get('All Easy Starred')!.disposition).toBe('not-an-archive')
  })

  it('marks a test archive as test-archive regardless of location', () => {
    expect(byName.get('[Test] 2026 - June')!.disposition).toBe('test-archive')
  })

  it('marks a History child as already-in-history', () => {
    expect(byName.get('2026 - May')!.disposition).toBe('already-in-history')
    expect(byName.get('2026 - May')!.location).toBe('history-direct-child')
  })

  it('marks an archive in another folder as archive-in-other-folder', () => {
    expect(byName.get('2020 - March')!.disposition).toBe(
      'archive-in-other-folder',
    )
    expect(byName.get('2020 - March')!.location).toBe('other-folder')
  })

  it('parses zero-based months, matching Date#getMonth', () => {
    expect(byName.get('2026 - July')!.archive).toEqual({
      year: 2026,
      month: 6,
      kind: 'production',
    })
  })
})

/**
 * The captured fixture mirrors the real account, whose History holds Spotify
 * editorial playlists and legacy hand-named archives. Those are expected and
 * tolerated by default now (revision 5), so planning against it needs no flags.
 */
describe('planHistoryMoves against the captured fixture', () => {
  const plan = planHistoryMoves(sample)

  it('plans the single eligible root archive', () => {
    expect(plan.outcome).toBe('plan')
    expect(plan.moves).toEqual([
      {
        uri: 'spotify:playlist:5kKYkjvUCvNvjgtlNzfdEr',
        name: '2026 - July',
        fromIndex: 0,
        year: 2026,
        month: 6,
      },
    ])
  })

  it('reports the History folder it resolved', () => {
    expect(plan.historyFolder).toEqual({
      id: '46758b97bb37b942',
      name: 'History',
      startIndex: 3,
      endIndex: 10,
    })
  })

  it('counts root playlists, History archives and untouched categories', () => {
    // `PlanCounts` keeps only the two counters not derivable from a plan array;
    // the rest are asserted directly off those arrays' lengths.
    expect(plan.counts).toEqual({
      scannedRootPlaylists: 6,
      alreadyInHistory: 2,
    })
    expect(plan.moves).toHaveLength(1)
    expect(plan.archivesInOtherFolders).toHaveLength(0)
    expect(plan.testArchives).toHaveLength(0)
    expect(plan.unrelatedHistoryChildren).toHaveLength(4)
    expect(plan.inaccessiblePlaylists).toHaveLength(1)
  })

  it('lists current History contents in wire order, informational only', () => {
    expect(plan.historyContents.map((entry) => entry.name)).toEqual([
      '2026 - June',
      '2026 - May',
      'Your Top Songs 2025',
      '2015 - Sept',
      '2013 - Oct (CMJ)',
      '2012 - Feb',
    ])
  })

  it('reports the inaccessible playlist without touching it', () => {
    expect(plan.inaccessiblePlaylists).toHaveLength(1)
    expect(plan.inaccessiblePlaylists[0].name).toBeNull()
    expect(plan.inaccessiblePlaylists[0].location).toBe('other-folder')
  })

  it('carries the rootlist revision through for the (disabled) write path', () => {
    expect(plan.rootlistRevision).toBe(sample.revision)
  })
})

describe('planHistoryMoves — additive prepend behaviour', () => {
  const mixedHistory = snapshotOf([
    playlist('2026 - July'),
    startGroup('h', 'History'),
    playlist('2026 - June'),
    playlist('Your Top Songs 2025'),
    endGroup('h'),
  ])

  // Revision 5: unrelated content in History is expected and tolerated by
  // default. It is reported, left untouched, and never blocks the plan.
  it('tolerates unrelated History children by default and leaves them out of the plan', () => {
    const plan = planHistoryMoves(mixedHistory)
    expect(plan.unrelatedHistoryChildren).toHaveLength(1)
    expect(plan.unrelatedHistoryChildren[0].name).toBe('Your Top Songs 2025')
    expect(plan.moves.map((move) => move.name)).toEqual(['2026 - July'])
    expect(plan.moves.some((move) => move.name === 'Your Top Songs 2025')).toBe(
      false,
    )
  })

  it('tolerates a nested folder inside History and never touches its contents', () => {
    const nested = snapshotOf([
      playlist('2026 - July'),
      startGroup('h', 'History'),
      startGroup('n', 'Nested'),
      playlist('2020 - March'),
      endGroup('n'),
      endGroup('h'),
    ])
    const plan = planHistoryMoves(nested)
    // The only move is the root archive; an archive nested inside a subfolder of
    // History is not a direct child, so it is reported elsewhere and left alone.
    expect(plan.moves.map((move) => move.name)).toEqual(['2026 - July'])
    expect(plan.archivesInOtherFolders.map((entry) => entry.name)).toEqual([
      '2020 - March',
    ])
  })

  it('skips and reports a root archive whose year/month is already filed in History', () => {
    const plan = planHistoryMoves(
      snapshotOf([
        playlist('2026 - July'),
        startGroup('h', 'History'),
        playlist('2026 - July'),
        endGroup('h'),
      ]),
    )
    // Not moved, not duplicated — reported as already-filed.
    expect(plan.moves).toHaveLength(0)
    expect(plan.outcome).toBe('empty')
    expect(plan.skippedAlreadyFiled).toHaveLength(1)
    expect(plan.skippedAlreadyFiled[0].name).toBe('2026 - July')
    expect(plan.skippedAlreadyFiled[0].reason).toBe('already-filed')
  })

  it('skips and reports BOTH root archives that share a year/month', () => {
    const plan = planHistoryMoves(
      snapshotOf([
        playlist('2026 - July'),
        playlist('2026 - July'),
        startGroup('h', 'History'),
        endGroup('h'),
      ]),
    )
    expect(plan.moves).toHaveLength(0)
    expect(plan.skippedAmbiguous).toHaveLength(2)
    expect(plan.skippedAmbiguous.map((entry) => entry.reason)).toEqual([
      'ambiguous-root-duplicate',
      'ambiguous-root-duplicate',
    ])
  })

  it('does NOT let an archive in another folder veto the run', () => {
    const plan = planHistoryMoves(
      snapshotOf([
        playlist('2026 - July'),
        startGroup('h', 'History'),
        endGroup('h'),
        startGroup('o', 'Others'),
        playlist('2026 - July'),
        endGroup('o'),
      ]),
    )
    expect(plan.moves).toHaveLength(1)
    expect(plan.archivesInOtherFolders).toHaveLength(1)
    expect(plan.skippedAlreadyFiled).toHaveLength(0)
    expect(plan.skippedAmbiguous).toHaveLength(0)
  })

  it('emits an empty plan when nothing is eligible', () => {
    const plan = planHistoryMoves(
      snapshotOf([
        playlist('Inbox'),
        startGroup('h', 'History'),
        playlist('2026 - June'),
        endGroup('h'),
      ]),
    )
    expect(plan.outcome).toBe('empty')
    expect(plan.moves).toEqual([])
  })

  it('honours a custom folder name', () => {
    const plan = planHistoryMoves(
      snapshotOf([
        playlist('2026 - July'),
        startGroup('a', 'Archive'),
        endGroup('a'),
      ]),
      { historyFolderName: 'Archive' },
    )
    expect(plan.historyFolder.name).toBe('Archive')
  })

  it('orders moves newest-first (reverse-chronological prepend order)', () => {
    const plan = planHistoryMoves(
      snapshotOf([
        playlist('2026 - July'),
        playlist('2020 - March'),
        playlist('2023 - May'),
        startGroup('h', 'History'),
        endGroup('h'),
      ]),
    )
    // Final top-to-bottom order: newest on top.
    expect(plan.moves.map((move) => move.name)).toEqual([
      '2026 - July',
      '2023 - May',
      '2020 - March',
    ])
  })

  it('never puts existing History entries in the move plan or changes their order', () => {
    const plan = planHistoryMoves(
      snapshotOf([
        playlist('2026 - July'),
        startGroup('h', 'History'),
        playlist('2020 - March'),
        playlist('2026 - May'),
        endGroup('h'),
      ]),
    )
    // Existing History entries are never candidates to move...
    expect(plan.moves.map((move) => move.name)).toEqual(['2026 - July'])
    // ...and they are reported verbatim in wire order, untouched.
    expect(plan.historyContents.map((entry) => entry.name)).toEqual([
      '2020 - March',
      '2026 - May',
    ])
  })
})

describe('formatMovePlan', () => {
  it('renders the fixture plan as an additive newest-first prepend', () => {
    const output = formatMovePlan(planHistoryMoves(sample))
    expect(output).toContain('History folder found (id: 46758b97bb37b942)')
    expect(output).toContain('Scanned 6 root-level playlists')
    expect(output).toContain('Would prepend into History (1), newest first:')
    expect(output).toContain('2026 - July')
    expect(output).toContain('are never reordered or removed')
    expect(output).toContain(
      'Dry run. Re-run with --apply to perform these changes.',
    )
  })

  it('switches the footer to an applying message in apply mode', () => {
    const output = formatMovePlan(planHistoryMoves(sample), 'apply')
    expect(output).toContain('Applying these changes now (--apply)')
    expect(output).not.toContain('Dry run.')
  })

  it('says so plainly when there is nothing to prepend', () => {
    const output = formatMovePlan(
      planHistoryMoves(
        snapshotOf([
          startGroup('h', 'History'),
          playlist('2026 - June'),
          endGroup('h'),
        ]),
      ),
    )
    expect(output).toContain('Nothing to prepend')
    expect(output).toContain('Nothing would change')
    expect(output).not.toContain('Would prepend into History')
  })

  // An entry the parser doesn't recognise (an old-style
  // `spotify:user:<u>:playlist:<id>` URI, or a shape Spotify adds later) is
  // ignored by the planner. It must still be VISIBLE in the report — a silently
  // dropped entry is how a parser gap goes unnoticed.
  it('renders unrecognised rootlist entries with index and URI', () => {
    const output = formatMovePlan(
      planHistoryMoves(
        snapshotOf([
          { uri: 'spotify:user:koalemos:playlist:legacyid' },
          playlist('2026 - July'),
          startGroup('h', 'History'),
          endGroup('h'),
        ]),
      ),
    )
    expect(output).toContain('Unrecognised rootlist entries')
    expect(output).toContain('@0  spotify:user:koalemos:playlist:legacyid')
  })

  it('omits the unrecognised-entries section entirely when there are none', () => {
    const output = formatMovePlan(
      planHistoryMoves(
        snapshotOf([
          playlist('2026 - July'),
          startGroup('h', 'History'),
          endGroup('h'),
        ]),
      ),
    )
    expect(output).not.toContain('Unrecognised')
  })
})
