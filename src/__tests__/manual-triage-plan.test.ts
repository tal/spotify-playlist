import { describe, it, expect } from 'bun:test'
import { Artist, PlaylistTrack, Track } from 'spotify-web-api-node'
import { DYNAMO_WRITE_CHUNK } from '../db/dynamo'
import {
  ManualTriageSnapshot,
  manualTriagePlan,
} from '../actions/process-manual-triage'

function artist(id: string): Artist {
  return {
    type: 'artist',
    uri: `spotify:artist:${id}`,
    id,
    href: '',
    external_urls: {},
    name: id,
  }
}

function track(id: string): Track {
  return {
    type: 'track',
    uri: `spotify:track:${id}`,
    id,
    href: '',
    album: {
      type: 'album',
      uri: `spotify:album:${id}-album`,
      id: `${id}-album`,
      href: '',
      album_type: 'album',
      artists: [artist('a')],
      available_markets: [],
      external_urls: {},
      images: [],
      name: `${id} album`,
      release_date: '2020-01-01',
      release_date_precision: 'day',
      total_tracks: 1,
    },
    artists: [artist('a')],
    disc_number: 1,
    is_playable: true,
    explicit: false,
    duration_ms: 200000,
    external_urls: {},
    external_ids: {},
    is_local: false,
    name: id,
    popularity: 0,
    preview_url: '',
    track_number: '1',
  }
}

function playlistTrack(id: string, added_at: string): PlaylistTrack {
  return {
    added_at,
    is_local: false,
    added_by: {
      type: 'user',
      uri: 'spotify:user:u',
      id: 'u',
      href: '',
      display_name: 'u',
    },
    track: track(id),
  }
}

function trackRow(
  id: string,
  triage_actions: TrackTriageAction[] = [],
): TrackItem {
  return {
    id,
    play_count: 0,
    first_seen: { played_at: 0, exactness: 'played' },
    last_seen: { played_at: 0, exactness: 'played' },
    triage_actions,
  }
}

function storagePlan(plan: ReturnType<typeof manualTriagePlan>) {
  return plan.map((set) => set.map((m) => m.storage))
}

function playbackOnlyRow(id: string): TrackItem {
  return {
    id,
    play_count: 3,
    first_seen: { played_at: 1, exactness: 'played' },
    last_seen: { played_at: 2, exactness: 'played' },
  }
}

describe('manualTriagePlan', () => {
  it('backfills an "inboxed" action for an inbox track with no track row at all', () => {
    const added_at = '2026-01-15T00:00:00.000Z'
    const snapshot: ManualTriageSnapshot = {
      inboxTracks: [playlistTrack('t1', added_at)],
      currentTracks: [],
      trackRows: {},
    }

    expect(storagePlan(manualTriagePlan(snapshot))).toEqual([
      [
        {
          type: 'mutation',
          mutationType: 'add-track-listen',
          data: {
            track: { id: 't1' },
            increment_by: 0,
            triageActions: [
              {
                action_at: new Date(added_at).getTime(),
                action_type: 'inboxed',
              },
            ],
            seen: {
              uri: 'spotify:track:t1',
              played_at: new Date(added_at).getTime(),
              exactness: 'playlist-addition',
            },
          },
        },
      ],
    ])
  })

  it('backfills a "promote" action for a current track with no track row at all', () => {
    const added_at = '2026-02-01T00:00:00.000Z'
    const snapshot: ManualTriageSnapshot = {
      inboxTracks: [],
      currentTracks: [playlistTrack('t2', added_at)],
      trackRows: {},
    }

    expect(storagePlan(manualTriagePlan(snapshot))).toEqual([
      [
        {
          type: 'mutation',
          mutationType: 'add-track-listen',
          data: {
            track: { id: 't2' },
            increment_by: 0,
            triageActions: [
              {
                action_at: new Date(added_at).getTime(),
                action_type: 'promote',
              },
            ],
            seen: {
              uri: 'spotify:track:t2',
              played_at: new Date(added_at).getTime(),
              exactness: 'playlist-addition',
            },
          },
        },
      ],
    ])
  })

  it('leaves an inbox track untouched when its row already has an "inboxed" entry', () => {
    const snapshot: ManualTriageSnapshot = {
      inboxTracks: [playlistTrack('t1', '2026-01-01T00:00:00.000Z')],
      currentTracks: [],
      trackRows: {
        t1: trackRow('t1', [{ action_type: 'inboxed', action_at: 1 }]),
      },
    }

    expect(manualTriagePlan(snapshot)).toEqual([])
  })

  it('leaves a current track untouched when its row already has a "promote" entry', () => {
    const snapshot: ManualTriageSnapshot = {
      inboxTracks: [],
      currentTracks: [playlistTrack('t2', '2026-01-01T00:00:00.000Z')],
      trackRows: {
        t2: trackRow('t2', [{ action_type: 'promote', action_at: 1 }]),
      },
    }

    expect(manualTriagePlan(snapshot)).toEqual([])
  })

  it('backfills "inboxed" for a row that has been triaged, but not with an "inboxed" entry', () => {
    const added_at = '2026-03-01T00:00:00.000Z'
    const snapshot: ManualTriageSnapshot = {
      inboxTracks: [playlistTrack('t1', added_at)],
      currentTracks: [],
      trackRows: {
        t1: trackRow('t1', [{ action_type: 'upvote', action_at: 1 }]),
      },
    }

    const plan = storagePlan(manualTriagePlan(snapshot))
    expect(plan.length).toBe(1)
    expect(plan[0][0].data.triageActions).toEqual([
      { action_at: new Date(added_at).getTime(), action_type: 'inboxed' },
    ])
  })

  it('backfills "promote" for a current row that was triaged into Inbox but never promoted', () => {
    const added_at = '2026-03-05T00:00:00.000Z'
    const snapshot: ManualTriageSnapshot = {
      inboxTracks: [],
      currentTracks: [playlistTrack('t2', added_at)],
      trackRows: {
        t2: trackRow('t2', [{ action_type: 'inboxed', action_at: 1 }]),
      },
    }

    const plan = storagePlan(manualTriagePlan(snapshot))
    expect(plan.length).toBe(1)
    expect(plan[0][0].data.triageActions).toEqual([
      { action_at: new Date(added_at).getTime(), action_type: 'promote' },
    ])
  })

  it('backfills "inboxed" for an inbox row whose triage_actions attribute is entirely absent', () => {
    const added_at = '2026-04-01T00:00:00.000Z'
    expect('triage_actions' in playbackOnlyRow('t1')).toBe(false)

    const snapshot: ManualTriageSnapshot = {
      inboxTracks: [playlistTrack('t1', added_at)],
      currentTracks: [],
      trackRows: { t1: playbackOnlyRow('t1') },
    }

    const plan = storagePlan(manualTriagePlan(snapshot))
    expect(plan.length).toBe(1)
    expect(plan[0][0].data.triageActions).toEqual([
      { action_at: new Date(added_at).getTime(), action_type: 'inboxed' },
    ])
  })

  it('backfills "promote" for a current row whose triage_actions attribute is entirely absent', () => {
    const added_at = '2026-04-02T00:00:00.000Z'
    expect('triage_actions' in playbackOnlyRow('t2')).toBe(false)

    const snapshot: ManualTriageSnapshot = {
      inboxTracks: [],
      currentTracks: [playlistTrack('t2', added_at)],
      trackRows: { t2: playbackOnlyRow('t2') },
    }

    const plan = storagePlan(manualTriagePlan(snapshot))
    expect(plan.length).toBe(1)
    expect(plan[0][0].data.triageActions).toEqual([
      { action_at: new Date(added_at).getTime(), action_type: 'promote' },
    ])
  })

  it('chunks a large inbox backfill into sets of DYNAMO_WRITE_CHUNK', () => {
    const inboxTracks = Array.from({ length: 30 }, (_, i) =>
      playlistTrack(`t${i}`, '2026-01-01T00:00:00.000Z'),
    )
    const plan = manualTriagePlan({
      inboxTracks,
      currentTracks: [],
      trackRows: {},
    })

    expect(plan.length).toBe(2)
    expect(plan[0].length).toBe(DYNAMO_WRITE_CHUNK)
    expect(plan[1].length).toBe(30 - DYNAMO_WRITE_CHUNK)
  })

  it('orders every inbox backfill set before every current backfill set', () => {
    const inboxTracks = [playlistTrack('in1', '2026-01-01T00:00:00.000Z')]
    const currentTracks = [playlistTrack('cur1', '2026-01-02T00:00:00.000Z')]

    const plan = manualTriagePlan({
      inboxTracks,
      currentTracks,
      trackRows: {},
    })

    expect(plan.map((set) => set.map((m) => m.storage.data.track.id))).toEqual([
      ['in1'],
      ['cur1'],
    ])
  })

  it('returns no mutation sets when neither playlist has anything to backfill', () => {
    const snapshot: ManualTriageSnapshot = {
      inboxTracks: [playlistTrack('t1', '2026-01-01T00:00:00.000Z')],
      currentTracks: [playlistTrack('t2', '2026-01-01T00:00:00.000Z')],
      trackRows: {
        t1: trackRow('t1', [{ action_type: 'inboxed', action_at: 1 }]),
        t2: trackRow('t2', [{ action_type: 'promote', action_at: 1 }]),
      },
    }

    expect(manualTriagePlan(snapshot)).toEqual([])
  })
})
