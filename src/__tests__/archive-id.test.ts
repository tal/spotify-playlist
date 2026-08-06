const ambientTimeZone =
  process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone
process.env.TZ = 'America/New_York'

import { describe, it, expect, afterAll } from 'bun:test'
import { ArchiveAction, archivePeriod } from '../actions/archive-action'
import { SetTrackStatusMutation } from '../mutations/set-track-status-mutation'
import { Spotify } from '../spotify'

/**
 * `bun test` resolves to UTC unless a zone is set, so every timestamp reads the
 * same through local and UTC accessors and a swap between them is invisible.
 * A zone behind UTC makes the two disagree either side of midnight, which is
 * where `archivePeriod` decides which month a pass belongs to.
 *
 * The zone is restored afterwards: test files share a process, so the pin would
 * otherwise follow the run into every file that loads after this one.
 */
afterAll(() => {
  process.env.TZ = ambientTimeZone
})

const CREATED_AT = Date.UTC(2026, 7, 4, 12)
const LATER_IN_AUGUST = Date.UTC(2026, 7, 27, 18)

/**
 * The constructor takes a client only to hold onto it for `gather`, and neither
 * it nor `getID`/`forStorage` ever calls through — so a bare cast is the whole
 * fixture these need.
 */
function archiveActionAt(created_at: number) {
  const action = new ArchiveAction({} as Spotify)
  action.created_at = created_at

  return action
}

describe('archivePeriod', () => {
  it('renders a timestamp as its year and month', () => {
    expect(archivePeriod(CREATED_AT)).toBe('2026-08')
  })

  it('pads single-digit months to two characters', () => {
    const januaryThroughSeptember = Array.from({ length: 9 }, (_, month) =>
      archivePeriod(Date.UTC(2026, month, 15, 12)),
    )

    expect(januaryThroughSeptember).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ])
  })

  it('leaves the two-digit months alone', () => {
    const octoberThroughDecember = Array.from({ length: 3 }, (_, offset) =>
      archivePeriod(Date.UTC(2026, 9 + offset, 15, 12)),
    )

    expect(octoberThroughDecember).toEqual(['2026-10', '2026-11', '2026-12'])
  })

  it('rolls the year over between December and January', () => {
    expect(archivePeriod(Date.UTC(2025, 11, 31, 12))).toBe('2025-12')
    expect(archivePeriod(Date.UTC(2026, 0, 1, 12))).toBe('2026-01')
  })

  /**
   * 2026-08-01T02:00Z is 2026-07-31 22:00 in the pinned zone: a pass that fires
   * just after midnight UTC still belongs to the month the operator is living
   * in. UTC accessors would answer '2026-08' to both of these.
   */
  it('reads the month in local time', () => {
    expect(archivePeriod(Date.UTC(2026, 7, 1, 2))).toBe('2026-07')
  })

  it('reads the year in local time', () => {
    expect(archivePeriod(Date.UTC(2026, 0, 1, 3))).toBe('2025-12')
  })
})

/**
 * `performAction` throttles by handing this id to `getActionHistory`, an
 * exact-match query — so an id carrying the construction clock can never match
 * a stored one and the declared throttle silently stops being one. That matters
 * here more than anywhere else: the pass it guards opens with a full table scan.
 */
describe('ArchiveAction.getID', () => {
  it('gives two passes in the same month the same id', async () => {
    const early = archiveActionAt(CREATED_AT)
    const late = archiveActionAt(LATER_IN_AUGUST)

    expect(await early.getID()).toBe(await late.getID())
  })

  it('keys the id on the month rather than the clock', async () => {
    expect(await archiveActionAt(CREATED_AT).getID()).toBe('archive:2026-08')
  })

  it('never embeds created_at in the id', async () => {
    const id = await archiveActionAt(CREATED_AT).getID()

    expect(id).not.toContain(String(CREATED_AT))
  })

  it('separates one month from the next', async () => {
    expect(await archiveActionAt(Date.UTC(2026, 8, 2, 12)).getID()).toBe(
      'archive:2026-09',
    )
  })

  it('stamps a freshly constructed action with a period-shaped id', async () => {
    const id = await new ArchiveAction({} as Spotify).getID()

    expect(id).toMatch(/^archive:\d{4}-\d{2}$/)
  })
})

/**
 * A stable id means every run writes an `action_history` row under the same
 * partition, so the rows that recorded nothing are the ones worth expiring.
 * `ttl` is epoch *seconds*, not milliseconds — a row written in milliseconds
 * expires around the year 58,000.
 */
describe('ArchiveAction.forStorage', () => {
  it('expires a pass that produced no mutations after two days', async () => {
    const stored = await archiveActionAt(CREATED_AT).forStorage([])

    expect(stored).toEqual({
      id: 'archive:2026-08',
      created_at: CREATED_AT,
      action: 'archive',
      mutations: [],
      ttl: 1786017600,
    })

    expect(new Date(stored.ttl! * 1000).toISOString()).toBe(
      '2026-08-06T12:00:00.000Z',
    )
  })

  it('keeps a pass that ran mutations, and stores their data', async () => {
    const mutation = new SetTrackStatusMutation({
      track: { id: 'gone' },
      status: 'removed',
      changed_at: CREATED_AT,
    })

    const stored = await archiveActionAt(CREATED_AT).forStorage([mutation])

    expect(stored).toEqual({
      id: 'archive:2026-08',
      created_at: CREATED_AT,
      action: 'archive',
      mutations: [
        {
          type: 'mutation',
          mutationType: 'set-track-status',
          data: {
            track: { id: 'gone' },
            status: 'removed',
            changed_at: CREATED_AT,
          },
        },
      ],
      ttl: undefined,
    })

    expect(stored.ttl).toBeUndefined()
  })
})
