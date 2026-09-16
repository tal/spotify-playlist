import { expect, test } from 'bun:test'
import { promotesPlan, gatherPromotes } from '../web/promotes'
import type { PerformContext } from '../actions/action'

const unheard: PromoteLocationSnapshotData = {
  stage: 'unheard',
  saved: 'unsaved',
  inbox: 'present',
  current: 'absent',
}
const current: PromoteLocationSnapshotData = {
  stage: 'current',
  saved: 'saved',
  inbox: 'absent',
  current: 'present',
}

function ref(trackId: string, created_at: number): RecentPromoteRef {
  return { id: `koalemos:promote:spotify:track:${trackId}`, created_at }
}

function row(
  trackId: string,
  created_at: number,
  extra: Partial<PromoteActionHistoryItemData> = {},
): PromoteActionHistoryItemData {
  return {
    id: `koalemos:promote:spotify:track:${trackId}`,
    created_at,
    action: 'promote-track',
    item: {
      id: trackId,
      uri: `spotify:track:${trackId}`,
      name: trackId,
      artist: 'Artist',
      album: 'Album',
    },
    mutations: [],
    before: unheard,
    after: current,
    ...extra,
  }
}

test('promotes keep the ref order, join live status, and pass through before/after', () => {
  const result = promotesPlan(
    [ref('a', 200), ref('b', 100)],
    // BatchGet order is arbitrary — deliberately reversed here.
    [row('b', 100, { undone: true }), row('a', 200)],
    {
      a: {
        status: 'promoted',
        play_count: 4,
        play_count_current: 3,
        play_count_inbox: 1,
      } as TrackItem,
    },
    0,
  )
  expect(result.tracks.map((t) => t.id)).toEqual(['a', 'b'])
  expect(result.tracks[0]).toMatchObject({
    uri: 'spotify:track:a',
    promotedAt: '1970-01-01T00:00:00.200Z',
    before: unheard,
    after: current,
    state: 'active',
    liveStatus: 'promoted',
    plays: 4,
    playsFromInbox: 1,
    playsFromCurrent: 3,
  })
  // No track record for 'b' and it was undone.
  expect(result.tracks[1]).toMatchObject({
    id: 'b',
    state: 'undone',
    liveStatus: null,
    plays: 0,
    playsFromCurrent: 0,
  })
  expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z')
})

test('a ref whose row is missing or has no item is dropped, not blanked', () => {
  const result = promotesPlan(
    [ref('a', 200), ref('gone', 150), ref('nameless', 100)],
    [row('a', 200), row('nameless', 100, { item: undefined })],
    {},
    0,
  )
  expect(result.tracks.map((t) => t.id)).toEqual(['a'])
  expect(result.trackCount).toBe(1)
})

test('before/after absent on a row surface as null', () => {
  const result = promotesPlan(
    [ref('a', 200)],
    [row('a', 200, { before: undefined, after: undefined })],
    {},
    0,
  )
  expect(result.tracks[0]).toMatchObject({ before: null, after: null })
})

test('limit is applied after ordering', () => {
  const result = promotesPlan(
    [ref('a', 300), ref('b', 200), ref('c', 100)],
    [row('a', 300), row('b', 200), row('c', 100)],
    {},
    0,
    2,
  )
  expect(result.tracks.map((t) => t.id)).toEqual(['a', 'b'])
})

test('gather reads refs, BatchGets only those rows, and joins their ids', async () => {
  const asked: { refs?: RecentPromoteRef[]; ids?: string[]; limit?: number } = {}
  const ctx = {
    now: 0,
    dynamo: {
      getRecentPromoteRefs: async (limit: number) => {
        asked.limit = limit
        return [ref('a', 200), ref('b', 100)]
      },
      getActionHistoryByRefs: async (refs: RecentPromoteRef[]) => {
        asked.refs = refs
        return [row('a', 200), row('b', 100)]
      },
      getTracks: async (ids: string[]) => {
        asked.ids = ids
        return {}
      },
    },
  } as unknown as PerformContext

  const result = await gatherPromotes(ctx, 20)
  expect(asked.limit).toBe(20)
  expect(asked.refs?.map((r) => r.created_at)).toEqual([200, 100])
  expect(asked.ids).toEqual(['a', 'b'])
  expect(result.tracks.map((t) => t.id)).toEqual(['a', 'b'])
})
