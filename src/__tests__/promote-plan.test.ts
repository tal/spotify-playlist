import { describe, it, expect } from 'bun:test'
import type { Mutation, MutationData } from '../mutations/mutation'
import {
  promotePlan,
  PromoteSnapshot,
  TriageMembership,
} from '../actions/track-action'

/**
 * Promotion is the one action a human triggers by hand dozens of times a day,
 * and it is the only writer of the 'promote' triage action that
 * `STATUS_BY_TRIAGE_ACTION` turns into `status: 'promoted'`. Every assertion
 * here is on the exact mutation storage, because the mutation *set* is what
 * `performAction` fires as one `Promise.all` and what `forStorage` writes to
 * `action_history` for undo.
 */

const NOW = 1_767_225_600_000

const track: BasicTrackData = {
  id: 'track-windowlicker',
  uri: 'spotify:track:track-windowlicker',
  name: 'Windowlicker',
  artist: 'Aphex Twin',
  album: 'Windowlicker',
}

const inbox = { id: 'playlist-inbox' }
const current = { id: 'playlist-current' }

const unheard: TriageMembership = {
  inbox: 'present',
  current: 'absent',
  saved: 'absent',
}
const liked: TriageMembership = {
  inbox: 'present',
  current: 'absent',
  saved: 'present',
}
const confirmed: TriageMembership = {
  inbox: 'absent',
  current: 'present',
  saved: 'present',
}

function snapshot(
  membership: TriageMembership,
  overrides: Partial<PromoteSnapshot> = {},
): PromoteSnapshot {
  return {
    player: 'playing',
    track,
    membership,
    playlists: { inbox, current },
    now: NOW,
    ...overrides,
  }
}

function storageOf(plan: Mutation<any>[][]) {
  return plan.flat().map((mutation) => mutation.storage)
}

function thrownBy(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected the plan to throw, it returned')
}

const addTracks = (playlist: { id: string }): MutationData<any> => ({
  type: 'mutation',
  mutationType: 'add-tracks',
  data: {
    tracks: [{ uri: track.uri, id: track.id }],
    playlist: { id: playlist.id },
  },
})

const removeTrack = (playlist: { id: string }): MutationData<any> => ({
  type: 'mutation',
  mutationType: 'remove-track',
  data: {
    track: { uri: track.uri, id: track.id },
    playlist: { id: playlist.id },
  },
})

const saveTrack: MutationData<any> = {
  type: 'mutation',
  mutationType: 'save-track',
  data: { tracks: [track] },
}

const triageAction = (
  actionType: TrackTriageActionType,
  at = NOW,
): MutationData<any> => ({
  type: 'mutation',
  mutationType: 'triage-action',
  data: { track, actionType, action_at: at },
})

describe('promotePlan: unheard → liked', () => {
  const plan = promotePlan(snapshot(unheard))

  it('saves the track to the library and logs the upvote', () => {
    expect(storageOf(plan)).toEqual([saveTrack, triageAction('upvote')])
  })

  it('leaves the track sitting in Inbox', () => {
    // The first promote is "I like this", not "I am done with this" — the
    // track has to stay in Inbox to be promoted a second time.
    expect(storageOf(plan).map((m) => m.mutationType)).not.toContain(
      'remove-track',
    )
  })
})

describe('promotePlan: liked → confirmed', () => {
  const plan = promotePlan(snapshot(liked))

  it('adds to Current, logs the promote, then clears Inbox', () => {
    expect(storageOf(plan)).toEqual([
      addTracks(current),
      triageAction('promote'),
      removeTrack(inbox),
      triageAction('upvote'),
    ])
  })

  it('does not re-save a track that is already saved', () => {
    expect(storageOf(plan).map((m) => m.mutationType)).not.toContain(
      'save-track',
    )
  })

  it('records the add ahead of the remove', () => {
    // Both sit in one set, which `performAction` fires as a single
    // `Promise.all`, so this pins the order they are serialized into
    // `action_history` for undo — not the order they execute. A failed add to
    // Current can still race a successful remove from Inbox; separating them
    // into sequential sets is the only thing that would close that window.
    const types = storageOf(plan).map((m) => m.mutationType)

    expect(types.indexOf('add-tracks')).toBeLessThan(
      types.indexOf('remove-track'),
    )
  })
})

describe('promotePlan: confirmed', () => {
  it('refuses to promote past the last stage', () => {
    expect(thrownBy(() => promotePlan(snapshot(confirmed)))).toBe(
      'cannot promote if confirmed',
    )
  })
})

describe('promotePlan without playback', () => {
  it('refuses to plan anything when the player is stopped', () => {
    expect(
      thrownBy(() => promotePlan(snapshot(liked, { player: 'not-playing' }))),
    ).toBe('player must be playing')
  })

  it('checks the player before the triage state', () => {
    // Confirmed would throw on its own; the player message is the one that
    // tells the user what to actually do about it.
    expect(
      thrownBy(() =>
        promotePlan(snapshot(confirmed, { player: 'not-playing' })),
      ),
    ).toBe('player must be playing')
  })
})

/**
 * `triageStateName` falls back to 'liked'/'unheard' on the strength of `saved`
 * alone whenever a membership matches none of the three canonical states, which
 * every one of these does. They are all reachable from real playlists — hand
 * drags, a track saved outside the system, a stale playlist cache — so the plan
 * each produces is behavior, not a hypothetical.
 */
describe('promotePlan off the canonical triage grid', () => {
  it('inboxes and saves a track that is nowhere at all', () => {
    const nowhere: TriageMembership = {
      inbox: 'absent',
      current: 'absent',
      saved: 'absent',
    }

    expect(storageOf(promotePlan(snapshot(nowhere)))).toEqual([
      addTracks(inbox),
      triageAction('inboxed'),
      saveTrack,
      triageAction('upvote'),
    ])
  })

  it('promotes a saved track that never passed through Inbox', () => {
    const savedOnly: TriageMembership = {
      inbox: 'absent',
      current: 'absent',
      saved: 'present',
    }

    expect(storageOf(promotePlan(snapshot(savedOnly)))).toEqual([
      addTracks(current),
      triageAction('promote'),
      triageAction('upvote'),
    ])
  })

  it('sends an unsaved track in Current back to Inbox', () => {
    const unsavedInCurrent: TriageMembership = {
      inbox: 'absent',
      current: 'present',
      saved: 'absent',
    }

    expect(storageOf(promotePlan(snapshot(unsavedInCurrent)))).toEqual([
      removeTrack(current),
      addTracks(inbox),
      triageAction('inboxed'),
      saveTrack,
      triageAction('upvote'),
    ])
  })

  it('pulls an unsaved track out of Current and leaves it in Inbox', () => {
    const unsavedInBoth: TriageMembership = {
      inbox: 'present',
      current: 'present',
      saved: 'absent',
    }

    expect(storageOf(promotePlan(snapshot(unsavedInBoth)))).toEqual([
      removeTrack(current),
      saveTrack,
      triageAction('upvote'),
    ])
  })

  it('clears Inbox without logging a promote when the track is already in both', () => {
    // Documents current behavior: the 'promote' TriageAction only fires when
    // Current membership *changes*, so a track already in Current reaches the
    // confirmed state without anything writing status: 'promoted'.
    const savedInBoth: TriageMembership = {
      inbox: 'present',
      current: 'present',
      saved: 'present',
    }

    expect(storageOf(promotePlan(snapshot(savedInBoth)))).toEqual([
      removeTrack(inbox),
      triageAction('upvote'),
    ])
  })
})

describe('promotePlan invariants across every promotable membership', () => {
  const promotable: [string, TriageMembership][] = [
    ['unheard', unheard],
    ['liked', liked],
    ['nowhere', { inbox: 'absent', current: 'absent', saved: 'absent' }],
    ['saved only', { inbox: 'absent', current: 'absent', saved: 'present' }],
    [
      'unsaved in Current',
      { inbox: 'absent', current: 'present', saved: 'absent' },
    ],
    [
      'unsaved in both',
      { inbox: 'present', current: 'present', saved: 'absent' },
    ],
    [
      'saved in both',
      { inbox: 'present', current: 'present', saved: 'present' },
    ],
  ]

  for (let [label, membership] of promotable) {
    it(`ends in an upvote from ${label}`, () => {
      const storage = storageOf(promotePlan(snapshot(membership)))

      expect(storage[storage.length - 1]).toEqual(triageAction('upvote'))
    })

    it(`plans a single mutation set from ${label}`, () => {
      // One set means `performAction` fires the whole promote as one
      // `Promise.all` — nothing here is ordered against anything else at
      // runtime, so nothing may depend on an earlier mutation having landed.
      expect(promotePlan(snapshot(membership))).toHaveLength(1)
    })

    it(`never unsaves the track from ${label}`, () => {
      const types = storageOf(promotePlan(snapshot(membership))).map(
        (m) => m.mutationType,
      )

      expect(types).not.toContain('unsave-track')
    })
  }

  it('stamps every triage action with the snapshot clock', () => {
    const at = 1_234_567_890
    const plan = promotePlan(snapshot(liked, { now: at }))

    const triageActions = storageOf(plan).filter(
      (m) => m.mutationType === 'triage-action',
    )

    expect(triageActions).toHaveLength(2)
    for (let mutation of triageActions) {
      expect((mutation.data as { action_at: number }).action_at).toBe(at)
    }
  })
})
