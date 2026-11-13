import { expect, test } from 'bun:test'
import { buildWebApp } from '../web/app'
import {
  archiveMovesFor,
  archiveRunMonths,
  isTrackId,
  trackPlan,
  type TrackSnapshot,
} from '../web/track'

const DAY = 86_400_000
const t = (day: number) => Date.UTC(2026, 7, 1) + day * DAY
const iso = (ms: number) => new Date(ms).toISOString()
const ID = '4uLU6hMCjMI75M1A2tKUQC'

function snapshot(overrides: Partial<TrackSnapshot> = {}): TrackSnapshot {
  return {
    track: {
      id: ID,
      uri: `spotify:track:${ID}`,
      name: 'Song',
      artist: 'Artist',
      album: 'Album',
      image: null,
      cover: null,
    },
    record: undefined,
    inbox: null,
    current: null,
    archives: [],
    playlistNames: {},
    saved: 'unsaved',
    now: t(60),
    timeToArchive: 45 * DAY,
    playsToArchive: 5,
    ...overrides,
  }
}

function record(
  triage_actions: TrackTriageAction[],
  extra: Partial<TrackItem> = {},
): TrackItem {
  return {
    id: ID,
    play_count: 9,
    play_count_inbox: 2,
    play_count_current: 5,
    first_seen: { played_at: t(0), exactness: 'playlist-addition' },
    last_seen: { played_at: t(40), exactness: 'played' },
    triage_actions,
    ...extra,
  }
}

test('full journey: inboxed → liked → promoted → archived, with dwell segments', () => {
  const plan = trackPlan(
    snapshot({
      record: record([
        { action_type: 'inboxed', action_at: t(0) },
        { action_type: 'upvote', action_at: t(3) },
        // promotePlan pushes 'promote' and 'upvote' with the same action_at.
        { action_type: 'promote', action_at: t(5) },
        { action_type: 'upvote', action_at: t(5) },
      ]),
      archives: [
        { playlist: '2026 - August', at: iso(t(30)), source: 'action-history' },
      ],
      saved: 'saved',
    }),
  )
  expect(plan.events.map((e) => e.kind)).toEqual([
    'inboxed',
    'liked',
    'promoted',
    'archived',
  ])
  expect(plan.stage).toBe('archived')
  expect(plan.segments).toEqual([
    { stage: 'unheard', start: iso(t(0)), end: iso(t(3)) },
    { stage: 'liked', start: iso(t(3)), end: iso(t(5)) },
    { stage: 'current', start: iso(t(5)), end: iso(t(30)) },
    { stage: 'archived', start: iso(t(30)), end: null },
  ])
  expect(plan.plays).toEqual({
    total: 9,
    fromInbox: 2,
    fromCurrent: 5,
    elsewhere: 2,
  })
  expect(plan.archiveRule.archiveBy).toBeNull()
})

test('live playlist membership fills log gaps but does not duplicate logged events', () => {
  const logged = trackPlan(
    snapshot({
      record: record([{ action_type: 'promote', action_at: t(5) }]),
      current: { addedAt: iso(t(5)) },
    }),
  )
  expect(logged.events).toHaveLength(1)
  expect(logged.events[0].source).toBe('triage-log')
  expect(logged.archiveRule.archiveBy).toBe(iso(t(50)))

  // Hand-dragged into Current, not yet backfilled by ProcessManualTriage.
  const manual = trackPlan(
    snapshot({
      record: record([{ action_type: 'inboxed', action_at: t(0) }]),
      current: { addedAt: iso(t(8)) },
    }),
  )
  expect(manual.events.map((e) => [e.kind, e.source])).toEqual([
    ['inboxed', 'triage-log'],
    ['promoted', 'playlist'],
  ])
  expect(manual.segments.at(-1)).toEqual({
    stage: 'current',
    start: iso(t(8)),
    end: null,
  })
})

test('explicit demote vs. silent reconciliation drop', () => {
  const demoted = trackPlan(
    snapshot({
      record: record(
        [
          { action_type: 'inboxed', action_at: t(0) },
          { action_type: 'remove', action_at: t(2) },
        ],
        { status: 'removed', status_changed_at: t(2) },
      ),
    }),
  )
  expect(demoted.events.map((e) => e.kind)).toEqual(['inboxed', 'removed'])
  expect(demoted.stage).toBe('removed')

  const dropped = trackPlan(
    snapshot({
      record: record([{ action_type: 'inboxed', action_at: t(0) }], {
        status: 'removed',
        status_changed_at: t(9),
      }),
    }),
  )
  expect(dropped.events.at(-1)).toMatchObject({
    kind: 'dropped',
    source: 'status',
    stage: 'removed',
  })
})

test('a removed status contradicted by live membership is listed but not charted', () => {
  const plan = trackPlan(
    snapshot({
      record: record(
        [
          { action_type: 'inboxed', action_at: t(0) },
          { action_type: 'promote', action_at: t(5) },
        ],
        { status: 'removed', status_changed_at: t(9) },
      ),
      current: { addedAt: iso(t(5)) },
      saved: 'saved',
    }),
  )
  expect(plan.stage).toBe('current')
  expect(plan.events.at(-1)).toMatchObject({
    kind: 'dropped',
    standing: 'contradicted',
  })
  expect(plan.segments.at(-1)).toEqual({
    stage: 'current',
    start: iso(t(5)),
    end: null,
  })
})

test('the last segment stays open only when it matches the live stage', () => {
  // Promoted, but no longer in Current and no archive found (e.g. moved to Starred).
  const plan = trackPlan(
    snapshot({ record: record([{ action_type: 'promote', action_at: t(5) }]) }),
  )
  expect(plan.stage).toBeNull()
  expect(plan.segments).toEqual([
    { stage: 'current', start: iso(t(5)), end: iso(t(5)) },
  ])
})

test('inbox stage reflects saved status; untracked tracks are flagged', () => {
  const liked = trackPlan(
    snapshot({ inbox: { addedAt: iso(t(1)) }, saved: 'saved' }),
  )
  expect(liked.stage).toBe('liked')
  expect(liked.tracked).toBe('untracked')
  expect(liked.plays.total).toBe(0)
  expect(liked.firstSeen).toBeNull()
})

test('isTrackId accepts only 22-char base62 ids', () => {
  expect(isTrackId(ID)).toBe(true)
  for (const bad of ['', 'abc', `${ID}x`, '4uLU6hMCjMI75M1A2tKU-C'])
    expect(isTrackId(bad)).toBe(false)
})

test('/api/track/:id validates the id and calls the loader', async () => {
  const seen: string[] = []
  const app = buildWebApp({
    current: async () => {
      throw new Error('unused')
    },
    inbox: async () => {
      throw new Error('unused')
    },
    archived: async () => {
      throw new Error('unused')
    },
    promotes: async () => {
      throw new Error('unused')
    },
    track: async (id) => {
      seen.push(id)
      return trackPlan(snapshot())
    },
  })
  expect((await app.request('/api/track/nope')).status).toBe(400)
  const ok = await app.request(`/api/track/${ID}`)
  expect(ok.status).toBe(200)
  expect((await ok.json()).track.id).toBe(ID)
  expect(seen).toEqual([ID])
})

test('archiveMovesFor reads stored move-track mutations, dated by the run', () => {
  const move = (ids: string[], to: string) => ({
    type: 'mutation',
    mutationType: 'move-track',
    data: {
      tracks: ids.map((id) => ({ id, uri: `spotify:track:${id}` })),
      from: { id: 'current' },
      to: { id: to },
    },
  })
  const rows = [
    { created_at: t(40), mutations: [move(['other'], 'oct')] },
    {
      created_at: t(30),
      mutations: [
        move(['x', ID], 'aug'),
        {
          type: 'mutation',
          mutationType: 'set-track-status',
          data: { id: ID },
        },
      ],
    },
    { created_at: t(50), mutations: [] },
    { created_at: t(55) },
    { created_at: t(20), mutations: [move([ID], 'jul')] },
  ]
  expect(archiveMovesFor(rows, ID)).toEqual([
    { at: t(20), playlistId: 'jul' },
    { at: t(30), playlistId: 'aug' },
  ])
  expect(archiveMovesFor(rows, 'missing')).toEqual([])
})

test('archiveRunMonths spans every run month inclusive, across a year end', () => {
  const at = (y: number, m: number, d: number) =>
    new Date(y, m - 1, d).getTime()
  expect(archiveRunMonths(at(2026, 11, 28), at(2027, 2, 3))).toEqual([
    '2026-11',
    '2026-12',
    '2027-01',
    '2027-02',
  ])
  expect(archiveRunMonths(at(2026, 9, 1), at(2026, 9, 30))).toEqual(['2026-09'])
})

test('a history archive marks the track archived and is a recorded (filled) event', () => {
  const plan = trackPlan(
    snapshot({
      record: record([{ action_type: 'promote', action_at: t(5) }]),
      archives: [
        { playlist: '2026 - August', at: iso(t(20)), source: 'action-history' },
      ],
    }),
  )
  expect(plan.stage).toBe('archived')
  expect(plan.events.at(-1)).toMatchObject({
    kind: 'archived',
    source: 'action-history',
    playlist: '2026 - August',
  })
  expect(plan.segments).toEqual([
    { stage: 'current', start: iso(t(5)), end: iso(t(20)) },
    { stage: 'archived', start: iso(t(20)), end: null },
  ])
})

test('an archive log entry (with action_ref) wins over the same run in history', () => {
  const plan = trackPlan(
    snapshot({
      record: record([
        { action_type: 'promote', action_at: t(5) },
        {
          action_type: 'archive',
          action_at: t(20),
          context_playlist_id: 'pl-aug',
          action_ref: { id: 'archive:2026-08', created_at: t(20) },
        },
      ]),
      archives: [
        { playlist: '2026 - August', at: iso(t(20)), source: 'action-history' },
      ],
      playlistNames: { 'pl-aug': '2026 - August' },
    }),
  )
  const archived = plan.events.filter((e) => e.kind === 'archived')
  expect(archived).toEqual([
    {
      kind: 'archived',
      at: iso(t(20)),
      stage: 'archived',
      source: 'triage-log',
      standing: 'consistent',
      playlist: '2026 - August',
    },
  ])
  expect(plan.stage).toBe('archived')
})

test('a lone upvote after a promote is not a step back to Liked', () => {
  const plan = trackPlan(
    snapshot({
      record: record([
        { action_type: 'inboxed', action_at: t(0) },
        { action_type: 'upvote', action_at: t(2) },
        { action_type: 'promote', action_at: t(4) },
        { action_type: 'upvote', action_at: t(4) },
        // Re-promoting while already in Current logs only an upvote.
        { action_type: 'upvote', action_at: t(9) },
      ]),
      current: { addedAt: iso(t(4)) },
      saved: 'saved',
    }),
  )
  expect(plan.events.map((e) => e.kind)).toEqual([
    'inboxed',
    'liked',
    'promoted',
  ])
  expect(plan.segments.map((s) => s.stage)).toEqual([
    'unheard',
    'liked',
    'current',
  ])
})
