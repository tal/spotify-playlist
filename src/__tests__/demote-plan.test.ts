import { describe, it, expect } from 'bun:test'
import type { Mutation, MutationData } from '../mutations/mutation'
import { demotePlan, DemoteSnapshot } from '../actions/track-action'

/**
 * Demote is destructive in a way promote is not: it unsaves from the library,
 * which is unrecoverable outside `UndoAction`. It also never reads the triage
 * state — it strips the track out of wherever it currently is — so the whole
 * plan turns on `playingFrom` and `starredMembership`, and those two are the
 * only inputs worth varying.
 */

const NOW = 1_767_225_600_000

const track: BasicTrackData = {
  id: 'track-avril-14th',
  uri: 'spotify:track:track-avril-14th',
  name: 'Avril 14th',
  artist: 'Aphex Twin',
  album: 'Drukqs',
}

const inbox = { id: 'playlist-inbox' }
const current = { id: 'playlist-current' }
const starred = { id: 'playlist-starred' }
const foreign = { id: 'playlist-release-radar' }

function snapshot(overrides: Partial<DemoteSnapshot> = {}): DemoteSnapshot {
  return {
    track,
    playlists: { inbox, current, starred },
    starredMembership: 'absent',
    now: NOW,
    ...overrides,
  }
}

function storageOf(plan: Mutation<any>[][]) {
  return plan.flat().map((mutation) => mutation.storage)
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

const removeTriageAction = (at = NOW): MutationData<any> => ({
  type: 'mutation',
  mutationType: 'triage-action',
  data: { track, actionType: 'remove', action_at: at },
})

function removedPlaylistIds(plan: Mutation<any>[][]) {
  return storageOf(plan)
    .filter((m) => m.mutationType === 'remove-track')
    .map((m) => (m.data as { playlist: { id: string } }).playlist.id)
}

describe('demotePlan while playing from Starred', () => {
  const plan = demotePlan(
    snapshot({ playingFrom: starred, starredMembership: 'present' }),
  )

  it('only pulls the track out of Starred', () => {
    // Starred is a curated shelf, not a triage stage. Demoting off it means
    // "not a favorite", which must not touch Inbox, Current or the library.
    expect(storageOf(plan)).toEqual([removeTrack(starred)])
  })

  it('logs no triage action', () => {
    expect(storageOf(plan).map((m) => m.mutationType)).not.toContain(
      'triage-action',
    )
  })

  it('matches Starred by id rather than by object identity', () => {
    const samePlaylistDifferentObject = demotePlan(
      snapshot({
        playingFrom: { id: starred.id, type: 'playlist' },
        starredMembership: 'present',
      }),
    )

    expect(storageOf(samePlaylistDifferentObject)).toEqual([
      removeTrack(starred),
    ])
  })

  it('short-circuits even when the track is not recorded in Starred', () => {
    const notInStarred = demotePlan(
      snapshot({ playingFrom: starred, starredMembership: 'absent' }),
    )

    expect(storageOf(notInStarred)).toEqual([removeTrack(starred)])
  })
})

describe('demotePlan from the triage playlists', () => {
  const plan = demotePlan(snapshot())

  it('clears both playlists, unsaves, then logs the removal', () => {
    expect(storageOf(plan)).toEqual([
      removeTrack(current),
      removeTrack(inbox),
      unsaveTrack,
      removeTriageAction(),
    ])
  })

  it('removes from Current before Inbox', () => {
    expect(removedPlaylistIds(plan)).toEqual([current.id, inbox.id])
  })

  it('removes from both playlists without knowing where the track lives', () => {
    // There is no membership on the snapshot at all — demote removes blind and
    // relies on the Spotify calls being no-ops where the track is absent.
    expect(
      storageOf(demotePlan(snapshot({ playlists: { inbox, current } }))),
    ).toEqual([
      removeTrack(current),
      removeTrack(inbox),
      unsaveTrack,
      removeTriageAction(),
    ])
  })
})

describe('demotePlan while playing from a third playlist', () => {
  it('also removes the track from wherever it was playing', () => {
    const plan = demotePlan(snapshot({ playingFrom: foreign }))

    expect(storageOf(plan)).toEqual([
      removeTrack(current),
      removeTrack(inbox),
      removeTrack(foreign),
      unsaveTrack,
      removeTriageAction(),
    ])
  })

  it('does not remove from Current twice when playing from Current', () => {
    const plan = demotePlan(snapshot({ playingFrom: current }))

    expect(removedPlaylistIds(plan)).toEqual([current.id, inbox.id])
  })

  it('does not remove from Inbox twice when playing from Inbox', () => {
    const plan = demotePlan(snapshot({ playingFrom: inbox }))

    expect(removedPlaylistIds(plan)).toEqual([current.id, inbox.id])
  })
})

describe('demotePlan for a starred track', () => {
  it('pulls it out of Starred instead of unsaving it', () => {
    // A starred track is one the user already decided they love; demoting it
    // out of Current must leave it in the library.
    const plan = demotePlan(snapshot({ starredMembership: 'present' }))

    expect(storageOf(plan)).toEqual([
      removeTrack(current),
      removeTrack(inbox),
      removeTrack(starred),
      removeTriageAction(),
    ])
  })

  it('unsaves when the track is not starred', () => {
    const plan = demotePlan(snapshot({ starredMembership: 'absent' }))

    expect(storageOf(plan).map((m) => m.mutationType)).toContain('unsave-track')
  })

  it('falls back to unsaving when no Starred playlist is configured', () => {
    const plan = demotePlan(
      snapshot({
        playlists: { inbox, current },
        starredMembership: 'present',
      }),
    )

    expect(storageOf(plan)).toEqual([
      removeTrack(current),
      removeTrack(inbox),
      unsaveTrack,
      removeTriageAction(),
    ])
  })

  it('keeps the third-playlist removal alongside the Starred removal', () => {
    const plan = demotePlan(
      snapshot({ playingFrom: foreign, starredMembership: 'present' }),
    )

    expect(removedPlaylistIds(plan)).toEqual([
      current.id,
      inbox.id,
      foreign.id,
      starred.id,
    ])
  })
})

describe('demotePlan invariants', () => {
  const variants: [string, Partial<DemoteSnapshot>][] = [
    ['the baseline', {}],
    ['a starred track', { starredMembership: 'present' }],
    ['a third playlist', { playingFrom: foreign }],
    ['Current', { playingFrom: current }],
    ['Starred', { playingFrom: starred, starredMembership: 'present' }],
  ]

  for (let [label, overrides] of variants) {
    it(`plans a single mutation set for ${label}`, () => {
      expect(demotePlan(snapshot(overrides))).toHaveLength(1)
    })
  }

  for (let [label, overrides] of variants.slice(0, 4)) {
    it(`ends in a 'remove' triage action for ${label}`, () => {
      const storage = storageOf(demotePlan(snapshot(overrides)))

      expect(storage[storage.length - 1]).toEqual(removeTriageAction())
    })

    it(`never adds the track anywhere for ${label}`, () => {
      const types = storageOf(demotePlan(snapshot(overrides))).map(
        (m) => m.mutationType,
      )

      expect(types).not.toContain('add-tracks')
      expect(types).not.toContain('save-track')
    })
  }

  it('stamps the triage action with the snapshot clock', () => {
    const at = 1_234_567_890
    const plan = demotePlan(snapshot({ now: at }))

    const triageActions = storageOf(plan).filter(
      (m) => m.mutationType === 'triage-action',
    )

    expect(triageActions).toEqual([removeTriageAction(at)])
  })
})
