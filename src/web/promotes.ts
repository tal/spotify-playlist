import type { PerformContext } from '../actions/action'

/** Composite key for one stored promote row, matching the table's (id, created_at). */
function keyOf(ref: { id: string; created_at: number }): string {
  return `${ref.id} ${ref.created_at}`
}

export type PromoteRow = {
  id: string
  uri: string
  name: string
  artist: string
  album: string
  promotedAt: string
  before: PromoteLocationSnapshotData | null
  after: PromoteLocationSnapshotData | null
  /** Whether the promote was later undone — an enum, not a boolean. */
  state: 'active' | 'undone'
  /** Where the track sits now, joined live from the track table. */
  liveStatus: TrackStatus | null
  plays: number
  playsFromInbox: number
  playsFromCurrent: number
}

/**
 * Shape the recent promotes into the feed, newest-first in `refs` order. A ref
 * whose row is missing (deleted from the table) is dropped rather than shown as
 * a blank; the surplus in the capped list is what keeps 20 real rows available.
 * Rows without an `item` (nothing to name) are dropped for the same reason.
 */
export function promotesPlan(
  refs: RecentPromoteRef[],
  rows: PromoteActionHistoryItemData[],
  records: Record<string, TrackItem | undefined>,
  now: number,
  limit = 20,
) {
  const byKey = new Map(rows.map((row) => [keyOf(row), row]))

  const tracks = refs
    .map((ref) => byKey.get(keyOf(ref)))
    .flatMap((row): PromoteRow[] => {
      if (!row?.item) return []
      const record = records[row.item.id]
      return [
        {
          ...row.item,
          promotedAt: new Date(row.created_at).toISOString(),
          before: row.before ?? null,
          after: row.after ?? null,
          state: row.undone ? 'undone' : 'active',
          liveStatus: record?.status ?? null,
          plays: record?.play_count ?? 0,
          playsFromInbox: record?.play_count_inbox ?? 0,
          playsFromCurrent: record?.play_count_current ?? 0,
        },
      ]
    })
    .slice(0, limit)

  return {
    tracks,
    trackCount: tracks.length,
    generatedAt: new Date(now).toISOString(),
  }
}

export async function gatherPromotes(ctx: PerformContext, limit = 20) {
  const refs = await ctx.dynamo.getRecentPromoteRefs(limit)
  const rows = await ctx.dynamo.getActionHistoryByRefs(refs)
  const ids = [
    ...new Set(rows.flatMap((row) => (row.item ? [row.item.id] : []))),
  ]
  const records = ids.length ? await ctx.dynamo.getTracks(ids) : {}
  return promotesPlan(refs, rows, records, Date.now(), limit)
}
