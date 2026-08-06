import { describe, it, expect } from 'bun:test'
import type { Mutation, MutationData } from '../mutations/mutation'
import {
  UndoDirection,
  UndoSnapshot,
  undoDirectionFor,
  undoPlan,
} from '../actions/undo-action'
import type {
  DemoteSnapshot,
  PromoteSnapshot,
  TriageMembership,
} from '../actions/track-action'

/**
 * Undo is the only action that writes to `action_history` twice — once as
 * itself, once by stamping the row it reversed — and the stamp is what stops a
 * second `/undo-last` from reversing the same promote again. The rule the plan
 * exists to hold is that the stamp lands in its own trailing set, after the
 * reversal it claims to record: sets run sequentially, so a reversal that
 * throws leaves the row unstamped and the undo retryable.
 */

const REVERSED_AT = 1_767_225_600_000
const ORIGINALLY_AT = 1_767_139_200_000

const track: BasicTrackData = {
  id: 'track-xtal',
  uri: 'spotify:track:track-xtal',
  name: 'Xtal',
  artist: 'Aphex Twin',
  album: 'Selected Ambient Works 85-92',
}

const inbox = { id: 'playlist-inbox' }
const current = { id: 'playlist-current' }

const liked: TriageMembership = {
  inbox: 'present',
  current: 'absent',
  saved: 'present',
}

const demoteSnapshot: DemoteSnapshot = {
  track,
  playlists: { inbox, current },
  starredMembership: 'absent',
  now: REVERSED_AT,
}

const promoteSnapshot: PromoteSnapshot = {
  player: 'playing',
  track,
  membership: liked,
  playlists: { inbox, current },
  now: REVERSED_AT,
}

function snapshot(overrides: Partial<UndoSnapshot> = {}): UndoSnapshot {
  return {
    target: {
      id: 'promote:spotify:track:track-xtal',
      created_at: ORIGINALLY_AT,
      state: 'undoable',
    },
    undo: { direction: 'demote', snapshot: demoteSnapshot },
    now: REVERSED_AT,
    ...overrides,
  }
}

function storageOf(mutations: Mutation<any>[]) {
  return mutations.map((mutation) => mutation.storage)
}

function thrownBy(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected the plan to throw, it returned')
}

const removeTrack = (playlist: { id: string }): MutationData<any> => ({
  type: 'mutation',
  mutationType: 'remove-track',
  data: {
    track: { uri: track.uri, id: track.id },
    playlist: { id: playlist.id },
  },
})

const unsaveTrack: MutationData<any> = {
  type: 'mutation',
  mutationType: 'unsave-track',
  data: { tracks: [track] },
}

const triageAction = (
  actionType: TrackTriageActionType,
  at = REVERSED_AT,
): MutationData<any> => ({
  type: 'mutation',
  mutationType: 'triage-action',
  data: { track, actionType, action_at: at },
})

const markUndone = (
  id: string,
  created_at = ORIGINALLY_AT,
  undone_at = REVERSED_AT,
): MutationData<any> => ({
  type: 'mutation',
  mutationType: 'mark-action-undone',
  data: { action: { id, created_at }, undone_at },
})

describe('undoDirectionFor', () => {
  // Table-driven over the full `ActionTypes` union so a member added without a
  // mapping decision fails here instead of silently falling through to
  // `undefined`. Undoing a promote reverses it with a demote, and undoing a
  // demote reverses it with a promote — pinned each to the direction that
  // actually reverses it, not the direction that would replay it.
  const cases: Array<[ActionTypes, UndoDirection['direction'] | undefined]> = [
    ['promote-track', 'demote'],
    ['demote-track', 'promote'],
    ['archive', undefined],
    ['auto-artist-playlist', undefined],
    ['process-playback-history', undefined],
    ['add-playlist-to-inbox', undefined],
    ['scan-playlists-for-inbox', undefined],
    ['process-manual-triage', undefined],
  ]

  it.each(cases)('%s -> %s', (action, direction) => {
    expect(undoDirectionFor(action)).toBe(direction)
  })
})

describe('undoPlan reversing a promote', () => {
  const plan = undoPlan(snapshot())

  it('plans the demote first and the stamp last', () => {
    expect(plan.map(storageOf)).toEqual([
      [
        removeTrack(current),
        removeTrack(inbox),
        unsaveTrack,
        triageAction('remove'),
      ],
      [markUndone('promote:spotify:track:track-xtal')],
    ])
  })

  it('keeps the stamp in a set of its own', () => {
    // Sets run sequentially, mutations inside one run concurrently — the split
    // is the only thing keeping the row from being marked undone by an undo
    // whose reversal threw.
    expect(plan).toHaveLength(2)
    expect(plan[plan.length - 1]).toHaveLength(1)
  })
})

describe('undoPlan reversing a demote', () => {
  const plan = undoPlan(
    snapshot({
      target: {
        id: 'demote:spotify:track:track-xtal',
        created_at: ORIGINALLY_AT,
        state: 'undoable',
      },
      undo: { direction: 'promote', snapshot: promoteSnapshot },
    }),
  )

  it('plans the promote first and the stamp last', () => {
    expect(plan.map(storageOf)).toEqual([
      [
        {
          type: 'mutation',
          mutationType: 'add-tracks',
          data: {
            tracks: [{ uri: track.uri, id: track.id }],
            playlist: { id: current.id },
          },
        },
        triageAction('promote'),
        removeTrack(inbox),
        triageAction('upvote'),
      ],
      [markUndone('demote:spotify:track:track-xtal')],
    ])
  })

  it('never plans the reversal the other direction would', () => {
    const types = plan.flat().map((m) => m.storage.mutationType)

    expect(types).not.toContain('unsave-track')
  })
})

describe('undoPlan stamping the target row', () => {
  it('carries the row key the mutation needs to find it again', () => {
    // `action_history` is keyed on id + created_at, so the stamp needs both,
    // and `undone_at` is the undo's own clock rather than the row's.
    const at = 1_234_567_890
    const plan = undoPlan(
      snapshot({
        target: { id: 'promote:abc', created_at: 42, state: 'undoable' },
        now: at,
      }),
    )

    expect(storageOf(plan[plan.length - 1])).toEqual([
      markUndone('promote:abc', 42, at),
    ])
  })

  it('refuses to re-reverse a row already stamped undone', () => {
    const undone = snapshot({
      target: {
        id: 'promote:spotify:track:track-xtal',
        created_at: ORIGINALLY_AT,
        state: 'undone',
      },
    })

    expect(thrownBy(() => undoPlan(undone))).toEqual(
      new Error('Action has already been undone'),
    )
  })

  it('plans nothing at all for a row already stamped undone', () => {
    // The throw has to come before the reversal is built, not after — an undo
    // that reversed first and checked second would double-demote.
    const undone = snapshot({
      target: {
        id: 'promote:spotify:track:track-xtal',
        created_at: ORIGINALLY_AT,
        state: 'undone',
      },
      undo: {
        direction: 'demote',
        snapshot: {
          ...demoteSnapshot,
          get track(): BasicTrackData {
            throw new Error('the reversal must not be planned')
          },
        },
      },
    })

    expect(thrownBy(() => undoPlan(undone))).toEqual(
      new Error('Action has already been undone'),
    )
  })
})
