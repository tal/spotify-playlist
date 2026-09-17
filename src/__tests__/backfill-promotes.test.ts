import { expect, test } from 'bun:test'
import { planBackfillList, RECENT_PROMOTES_CAP } from '../db/dynamo'

function ref(trackId: string, created_at: number): RecentPromoteRef {
  return { id: `koalemos:promote:spotify:track:${trackId}`, created_at }
}

test('orders the merged pointers newest-first', () => {
  const out = planBackfillList([], [ref('a', 100), ref('b', 300), ref('c', 200)])
  expect(out.map((r) => r.created_at)).toEqual([300, 200, 100])
})

test('merges forward-appended refs and dedupes the (id, created_at) key', () => {
  // `b@300` sits on the row already (appended live) and is also re-scanned; it
  // must survive once, keeping its newest-first position.
  const existing = [ref('b', 300)]
  const scanned = [ref('a', 100), ref('b', 300), ref('c', 200)]
  const out = planBackfillList(existing, scanned)
  expect(out.map((r) => `${r.id.split(':').pop()}@${r.created_at}`)).toEqual([
    'b@300',
    'c@200',
    'a@100',
  ])
})

test('keeps two promotes of the same track at different times apart', () => {
  const out = planBackfillList([], [ref('a', 100), ref('a', 400)])
  expect(out).toHaveLength(2)
  expect(out.map((r) => r.created_at)).toEqual([400, 100])
})

test('trims to the cap, keeping the newest', () => {
  const scanned = Array.from({ length: RECENT_PROMOTES_CAP + 10 }, (_, i) =>
    ref(`t${i}`, i),
  )
  const out = planBackfillList([], scanned)
  expect(out).toHaveLength(RECENT_PROMOTES_CAP)
  // Newest is the highest created_at; oldest kept is exactly at the cap boundary.
  expect(out[0].created_at).toBe(RECENT_PROMOTES_CAP + 9)
  expect(out[out.length - 1].created_at).toBe(10)
})

test('a smaller explicit cap is honoured', () => {
  const out = planBackfillList([], [ref('a', 1), ref('b', 2), ref('c', 3)], 2)
  expect(out.map((r) => r.created_at)).toEqual([3, 2])
})

test('undefined existing is treated as empty', () => {
  const out = planBackfillList(undefined, [ref('a', 5)])
  expect(out).toEqual([ref('a', 5)])
})
