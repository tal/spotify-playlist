const ambientTimeZone =
  process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone
process.env.TZ = 'America/New_York'

import { describe, it, expect, afterAll } from 'bun:test'
import {
  archivePlan,
  ArchiveCandidate,
  ArchiveSnapshot,
  CurrentEvidence,
  idsIn,
  InboxEvidence,
} from '../actions/archive-action'
import { buildArchiveNamer } from '../settings'
import { DYNAMO_WRITE_CHUNK, TrackStatusRow } from '../db/dynamo'
import { Mutation } from '../mutations/mutation'
import { PlaylistID } from '../spotify'

/**
 * Two decisions live in this planner and both are destructive when wrong:
 * whether a track has aged out of Current, and whether a row the table claims is
 * live has quietly stopped being live. The first moves tracks between playlists,
 * the second rewrites their status — so the tests below pin the exact boundary
 * of each rather than sampling either side of it from a distance.
 *
 * The zone is pinned because the second decision — which monthly archive an
 * aged track belongs to — is read off local accessors, and `bun test` resolves
 * to UTC, where local and UTC agree about everything. It is restored afterwards
 * so the pin does not follow the shared process into the next test file.
 */

afterAll(() => {
  process.env.TZ = ambientTimeZone
})

const DAY = 1000 * 60 * 60 * 24
const NOW = Date.UTC(2026, 7, 4, 12)
const CHANGED_AT = NOW - 90_000
const TIME_TO_ARCHIVE = 30 * DAY
const CURRENT: PlaylistID = { id: 'playlist-current' }

const archiveNamer = buildArchiveNamer()

function candidate(id: string, addedAt: number): ArchiveCandidate {
  return {
    added_at: new Date(addedAt).toISOString(),
    track: { uri: `spotify:track:${id}`, id },
  }
}

/**
 * Stands in for `gatherCurrent`'s resolution step. Every name the namer produces
 * gets a playlist, which is what a pass whose lookups all succeeded looks like;
 * tests about an unresolved name pass their own map.
 */
function archivePlaylistsFor(tracks: ArchiveCandidate[]) {
  const resolved = new Map<string, PlaylistID>()

  for (let track of tracks) {
    const name = archiveNamer(track)
    if (!resolved.has(name)) resolved.set(name, { id: `playlist-${name}` })
  }

  return resolved
}

function currentRead(
  tracks: ArchiveCandidate[],
  archivePlaylists = archivePlaylistsFor(tracks),
): CurrentEvidence {
  return {
    listing: 'read',
    name: 'Current',
    playlist: CURRENT,
    tracks,
    archivePlaylists,
  }
}

function inboxRead(...trackIds: string[]): InboxEvidence {
  return { listing: 'read', name: 'Inbox', trackIds: new Set(trackIds) }
}

function row(id: string, status: TrackStatusRow['status']): TrackStatusRow {
  return { id, status }
}

/**
 * Defaults are deliberately inert — no tracks, no rows, no evidence — so each
 * test's overrides are the only thing that can produce a mutation.
 */
function snapshot(overrides: Partial<ArchiveSnapshot> = {}): ArchiveSnapshot {
  return {
    now: NOW,
    changed_at: CHANGED_AT,
    timeToArchive: TIME_TO_ARCHIVE,
    archiveNamer,
    current: currentRead([]),
    inbox: { listing: 'unavailable', name: 'Inbox' },
    savedTrackIds: new Set<string>(),
    liveStatusRows: [],
    ...overrides,
  }
}

const storage = (plan: Mutation<any>[][]) => plan.flat().map((m) => m.storage)

const moves = (plan: Mutation<any>[][]) =>
  storage(plan).filter((m) => m.mutationType === 'move-track')

const statuses = (plan: Mutation<any>[][]) =>
  storage(plan).filter((m) => m.mutationType === 'set-track-status')

const statusIds = (plan: Mutation<any>[][]) =>
  statuses(plan).map((m) => m.data.track.id)

describe('archivePlan age boundary', () => {
  it('leaves a track that has been in Current for exactly timeToArchive', () => {
    const track = candidate('exactly', NOW - TIME_TO_ARCHIVE)

    const plan = archivePlan(snapshot({ current: currentRead([track]) }))

    expect(storage(plan)).toEqual([])
  })

  it('archives a track one millisecond past timeToArchive', () => {
    const track = candidate('just-over', NOW - TIME_TO_ARCHIVE - 1)

    const plan = archivePlan(snapshot({ current: currentRead([track]) }))

    expect(storage(plan)).toEqual([
      {
        type: 'mutation',
        mutationType: 'move-track',
        data: {
          tracks: [{ uri: 'spotify:track:just-over', id: 'just-over' }],
          from: { id: 'playlist-current' },
          to: { id: `playlist-${archiveNamer(track)}` },
        },
      },
    ])
  })

  it('leaves a track one millisecond short of timeToArchive', () => {
    const track = candidate('just-under', NOW - TIME_TO_ARCHIVE + 1)

    const plan = archivePlan(snapshot({ current: currentRead([track]) }))

    expect(storage(plan)).toEqual([])
  })

  it('files a track under the month it landed in, not the month the pass runs', () => {
    const track = candidate('may-track', Date.UTC(2026, 4, 10, 12))

    const plan = archivePlan(snapshot({ current: currentRead([track]) }))

    expect(archiveNamer(track)).toBe('2026 - May')
    expect(moves(plan)[0].data.to).toEqual({ id: 'playlist-2026 - May' })
  })

  it('sends each month of aged tracks to its own archive playlist', () => {
    const may = candidate('may-track', Date.UTC(2026, 4, 10, 12))
    const alsoMay = candidate('may-other', Date.UTC(2026, 4, 20, 12))
    const june = candidate('june-track', Date.UTC(2026, 5, 10, 12))

    const plan = archivePlan(
      snapshot({ current: currentRead([may, alsoMay, june]) }),
    )

    expect(moves(plan).map((m) => m.data)).toEqual([
      {
        tracks: [
          { uri: 'spotify:track:may-track', id: 'may-track' },
          { uri: 'spotify:track:may-other', id: 'may-other' },
        ],
        from: CURRENT,
        to: { id: 'playlist-2026 - May' },
      },
      {
        tracks: [{ uri: 'spotify:track:june-track', id: 'june-track' }],
        from: CURRENT,
        to: { id: 'playlist-2026 - June' },
      },
    ])
  })

  it('leaves aged tracks in Current when their archive playlist never resolved', () => {
    const track = candidate('orphan', NOW - TIME_TO_ARCHIVE - DAY)

    const plan = archivePlan(
      snapshot({ current: currentRead([track], new Map()) }),
    )

    expect(storage(plan)).toEqual([])
  })

  it('archives nothing when Current could not be read', () => {
    const plan = archivePlan(
      snapshot({ current: { listing: 'unavailable', name: 'Current' } }),
    )

    expect(storage(plan)).toEqual([])
  })

  /**
   * Documents current behavior, not desired behavior. `new Date(garbage)` is
   * NaN, `now - NaN <= timeToArchive` is false, and false means "old enough" —
   * so an unparseable added_at archives on the spot, into a playlist the namer
   * builds out of two NaNs.
   */
  it('treats an unparseable added_at as aged out', () => {
    const track: ArchiveCandidate = {
      added_at: 'sometime last spring',
      track: { uri: 'spotify:track:bad-date', id: 'bad-date' },
    }

    const plan = archivePlan(snapshot({ current: currentRead([track]) }))

    expect(moves(plan)[0].data.to).toEqual({ id: 'playlist-NaN - undefined' })
  })
})

/**
 * Every fixture above sits mid-month at noon, where the month is the same
 * however it is read. These sit inside one timezone offset of an edge, so the
 * archive a track lands in depends on whether the namer reads local or UTC —
 * the pinned zone runs five (four in summer) hours behind, and each of these
 * would file one month or one year later under UTC accessors.
 *
 * Which of the two is correct is not what these pin: they pin the answer, so a
 * change of accessor has to be a deliberate one.
 */
describe('archivePlan month bucketing at the edges', () => {
  const SEPTEMBER = Date.UTC(2026, 8, 15, 12)

  it('files a track added just after midnight UTC under the previous month', () => {
    // 2026-08-01T02:00Z is 2026-07-31 22:00 in the pinned zone
    const track = candidate('month-edge', Date.UTC(2026, 7, 1, 2))

    const plan = archivePlan(
      snapshot({ now: SEPTEMBER, current: currentRead([track]) }),
    )

    expect(moves(plan)[0].data.to).toEqual({ id: 'playlist-2026 - July' })
  })

  it('splits two tracks added hours apart across a month edge', () => {
    const july = candidate('july-side', Date.UTC(2026, 7, 1, 2))
    const august = candidate('august-side', Date.UTC(2026, 7, 1, 5))

    const plan = archivePlan(
      snapshot({ now: SEPTEMBER, current: currentRead([july, august]) }),
    )

    expect(moves(plan).map((m) => m.data)).toEqual([
      {
        tracks: [{ uri: 'spotify:track:july-side', id: 'july-side' }],
        from: CURRENT,
        to: { id: 'playlist-2026 - July' },
      },
      {
        tracks: [{ uri: 'spotify:track:august-side', id: 'august-side' }],
        from: CURRENT,
        to: { id: 'playlist-2026 - August' },
      },
    ])
  })

  it('files a track added just after New Year UTC under the previous year', () => {
    // 2026-01-01T03:00Z is 2025-12-31 22:00 in the pinned zone
    const track = candidate('year-edge', Date.UTC(2026, 0, 1, 3))

    const plan = archivePlan(snapshot({ current: currentRead([track]) }))

    expect(moves(plan)[0].data.to).toEqual({ id: 'playlist-2025 - December' })
  })

  it('splits two tracks added hours apart across the year rollover', () => {
    const december = candidate('december-side', Date.UTC(2026, 0, 1, 3))
    const january = candidate('january-side', Date.UTC(2026, 0, 1, 6))

    const plan = archivePlan(
      snapshot({ current: currentRead([december, january]) }),
    )

    expect(moves(plan).map((m) => m.data.to)).toEqual([
      { id: 'playlist-2025 - December' },
      { id: 'playlist-2026 - January' },
    ])
  })
})

describe('archivePlan status reconciliation', () => {
  it('marks an inbox row that is no longer in Inbox as removed', () => {
    const plan = archivePlan(
      snapshot({
        inbox: inboxRead('kept'),
        liveStatusRows: [row('kept', 'inbox'), row('gone', 'inbox')],
      }),
    )

    expect(statuses(plan)).toEqual([
      {
        type: 'mutation',
        mutationType: 'set-track-status',
        data: {
          track: { id: 'gone' },
          status: 'removed',
          changed_at: CHANGED_AT,
        },
      },
    ])
  })

  it('stamps the sweep with the snapshot changed_at rather than the read time', () => {
    const plan = archivePlan(
      snapshot({
        changed_at: 1_234_567,
        inbox: inboxRead(),
        liveStatusRows: [row('gone', 'inbox')],
      }),
    )

    expect(statuses(plan).map((m) => m.data.changed_at)).toEqual([1_234_567])
  })

  /**
   * The distinction the whole 2026-08-02 fix turns on. Current is a place tracks
   * leave legitimately — this very pass archives them out of it — so membership
   * there says nothing, and liked status is the only signal that a promoted
   * track was actually dropped.
   */
  it('reconciles promoted rows against liked status, not Current membership', () => {
    const stillInCurrent = candidate('unliked', NOW)

    const plan = archivePlan(
      snapshot({
        current: currentRead([stillInCurrent]),
        savedTrackIds: new Set(['still-liked']),
        liveStatusRows: [
          row('unliked', 'promoted'),
          row('still-liked', 'promoted'),
        ],
      }),
    )

    expect(statusIds(plan)).toEqual(['unliked'])
  })

  it('leaves a promoted row alone when this same pass archives it out of Current', () => {
    const track = candidate('archived', NOW - TIME_TO_ARCHIVE - DAY)

    const plan = archivePlan(
      snapshot({
        current: currentRead([track]),
        savedTrackIds: new Set(['archived']),
        liveStatusRows: [row('archived', 'promoted')],
      }),
    )

    expect(moves(plan)).toHaveLength(1)
    expect(statuses(plan)).toEqual([])
  })

  it('never touches a row whose status is missing or null', () => {
    const plan = archivePlan(
      snapshot({
        inbox: inboxRead(),
        savedTrackIds: new Set(['somebody-else']),
        liveStatusRows: [
          row('gone', 'inbox'),
          { id: 'no-status' } as TrackStatusRow,
          { id: 'null-status', status: null } as unknown as TrackStatusRow,
        ],
      }),
    )

    expect(statusIds(plan)).toEqual(['gone'])
  })

  it('emits status writes only, never a triage action', () => {
    const plan = archivePlan(
      snapshot({
        inbox: inboxRead(),
        savedTrackIds: new Set(['liked']),
        liveStatusRows: [row('gone', 'inbox'), row('dropped', 'promoted')],
      }),
    )

    expect(storage(plan).map((m) => m.mutationType)).toEqual([
      'set-track-status',
      'set-track-status',
    ])
  })

  it('marks nothing removed from the inbox half when Inbox could not be read', () => {
    const plan = archivePlan(
      snapshot({
        inbox: { listing: 'unavailable', name: 'Inbox' },
        savedTrackIds: new Set(['liked']),
        liveStatusRows: [
          row('inbox-row', 'inbox'),
          row('dropped', 'promoted'),
          row('liked', 'promoted'),
        ],
      }),
    )

    expect(statusIds(plan)).toEqual(['dropped'])
  })

  /**
   * An empty library is far likelier to be a read that failed than a user who
   * unliked everything, and acting on it would rewrite every promoted row in a
   * single pass.
   */
  it('marks nothing removed from the promoted half when liked songs came back empty', () => {
    const plan = archivePlan(
      snapshot({
        inbox: inboxRead(),
        savedTrackIds: new Set<string>(),
        liveStatusRows: [row('gone', 'inbox'), row('promoted-row', 'promoted')],
      }),
    )

    expect(statusIds(plan)).toEqual(['gone'])
  })

  it('still reconciles the inbox half when Current could not be read', () => {
    const plan = archivePlan(
      snapshot({
        current: { listing: 'unavailable', name: 'Current' },
        inbox: inboxRead(),
        liveStatusRows: [row('gone', 'inbox')],
      }),
    )

    expect(moves(plan)).toEqual([])
    expect(statusIds(plan)).toEqual(['gone'])
  })
})

describe('archivePlan write chunking', () => {
  const goneRows = (count: number) =>
    Array.from({ length: count }, (_, i) => row(`gone-${i}`, 'inbox'))

  it('splits status writes past DYNAMO_WRITE_CHUNK into sequential sets', () => {
    const plan = archivePlan(
      snapshot({
        inbox: inboxRead(),
        liveStatusRows: goneRows(DYNAMO_WRITE_CHUNK * 2 + 10),
      }),
    )

    // The leading empty set is the archive set — always present, even with
    // nothing aged out.
    expect(plan.map((set) => set.length)).toEqual([
      0,
      DYNAMO_WRITE_CHUNK,
      DYNAMO_WRITE_CHUNK,
      10,
    ])
  })

  it('keeps archive moves in one set ahead of the status writes', () => {
    const track = candidate('old', NOW - TIME_TO_ARCHIVE - DAY)

    const plan = archivePlan(
      snapshot({
        current: currentRead([track]),
        inbox: inboxRead(),
        liveStatusRows: goneRows(DYNAMO_WRITE_CHUNK + 1),
      }),
    )

    expect(plan.map((set) => set.map((m) => m.storage.mutationType))).toEqual([
      ['move-track'],
      Array(DYNAMO_WRITE_CHUNK).fill('set-track-status'),
      ['set-track-status'],
    ])
  })

  it('writes every removed row exactly once across the sets', () => {
    const rows = goneRows(DYNAMO_WRITE_CHUNK * 3 + 7)

    const plan = archivePlan(
      snapshot({ inbox: inboxRead(), liveStatusRows: rows }),
    )

    expect(statusIds(plan)).toEqual(rows.map((r) => r.id))
  })

  it('never fans out more than DYNAMO_WRITE_CHUNK writes in a set', () => {
    const plan = archivePlan(
      snapshot({ inbox: inboxRead(), liveStatusRows: goneRows(200) }),
    )

    for (let set of plan) {
      expect(set.length).toBeLessThanOrEqual(DYNAMO_WRITE_CHUNK)
    }
  })
})

/**
 * Both sets the reconciliation reads — Inbox membership and the liked library —
 * are built by this, from listings Spotify pads with `{ track: null }` for
 * anything it can no longer resolve. Reaching through one of those holes throws
 * and takes the pass down; keeping it as a member would put `undefined` in a set
 * that is only ever asked whether it contains a real id.
 */
describe('idsIn', () => {
  it('collects the id of every item that has one', () => {
    expect([...idsIn([{ id: 'first' }, { id: 'second' }])]).toEqual([
      'first',
      'second',
    ])
  })

  it('drops the null Spotify hands back for an unresolvable item', () => {
    const items = [{ track: { id: 'kept' } }, { track: null }]

    expect([...idsIn(items.map((item) => item.track))]).toEqual(['kept'])
  })

  it('drops undefined, id-less and blank-id entries', () => {
    const items = [undefined, {}, { id: undefined }, { id: '' }, { id: 'kept' }]

    expect([...idsIn(items)]).toEqual(['kept'])
  })

  it('never admits an id-less entry as a member', () => {
    expect(idsIn([null, undefined, {}, { id: 'kept' }]).size).toBe(1)
  })

  it('collapses a repeated id', () => {
    expect([...idsIn([{ id: 'dupe' }, { id: 'dupe' }])]).toEqual(['dupe'])
  })

  it('reads an all-null batch as empty rather than throwing', () => {
    expect([...idsIn([null, undefined])]).toEqual([])
  })
})
