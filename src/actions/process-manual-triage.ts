import { PlaylistTrack } from 'spotify-web-api-node'
import { DYNAMO_WRITE_CHUNK } from '../db/dynamo'
import { AddTrackListenMutation } from '../mutations/add-track-listen-mutation'
import { Mutation } from '../mutations/mutation'
import { Spotify } from '../spotify'
import { Action, PerformContext } from './action'
import { getTriageInfo } from './actionable-type'
import { chunkArray } from '../utils/array'

export interface ManualTriageSnapshot {
  inboxTracks: PlaylistTrack[]
  currentTracks: PlaylistTrack[]
  trackRows: Record<string, TrackItem | undefined>
}

/**
 * Backfills the triage log for tracks that reached a playlist without going
 * through the app — dragged in by hand, so nothing ever recorded them.
 *
 * Inbox and Current are the same job twice: the action that marks a track as
 * already accounted for is also the one written for those that aren't.
 */
function backfillPlan(
  playlistTracks: PlaylistTrack[],
  trackRows: Record<string, TrackItem | undefined>,
  action_type: TrackTriageActionType,
): Mutation<any>[][] {
  const untriaged = playlistTracks.filter(
    (data) =>
      !trackRows[data.track.id]?.triage_actions?.some(
        (action) => action.action_type === action_type,
      ),
  )

  const mutations = untriaged.map((track) => {
    const played_at = new Date(track.added_at).getTime()

    return new AddTrackListenMutation({
      track: { id: track.track.id },
      increment_by: 0,
      triageActions: [{ action_at: played_at, action_type }],
      seen: {
        uri: track.track.uri,
        played_at,
        exactness: 'playlist-addition' as const,
      },
    })
  })

  return chunkArray(mutations, DYNAMO_WRITE_CHUNK)
}

export function manualTriagePlan(
  snapshot: ManualTriageSnapshot,
): Mutation<any>[][] {
  const inboxSets = backfillPlan(
    snapshot.inboxTracks,
    snapshot.trackRows,
    'inboxed',
  )
  const currentSets = backfillPlan(
    snapshot.currentTracks,
    snapshot.trackRows,
    'promote',
  )

  return [...inboxSets, ...currentSets]
}

export class ProcessManualTriage implements Action {
  readonly idThrottleMs: number | undefined = undefined
  readonly created_at: number
  readonly type: string = 'process-manual-triage'

  constructor(private spotify: Spotify) {
    this.created_at = new Date().getTime()
  }

  async getID() {
    return `process-manual-triage:${this.created_at}`
  }

  async gather({ dynamo }: PerformContext): Promise<ManualTriageSnapshot> {
    const { inbox, current } = await getTriageInfo(this.spotify)

    const [inboxTracks, currentTracks] = await Promise.all([
      this.spotify.tracksForPlaylist({ id: inbox.id }),
      this.spotify.tracksForPlaylist({ id: current.id }),
    ])

    const trackIds = Array.from(
      new Set(
        [...inboxTracks, ...currentTracks].map((track) => track.track.id),
      ),
    )
    const trackRows = await dynamo.getTracks(trackIds)

    return { inboxTracks, currentTracks, trackRows }
  }

  async perform(ctx: PerformContext): Promise<Mutation<any>[][]> {
    return manualTriagePlan(await this.gather(ctx))
  }

  async forStorage(mutations: Mutation<any>[]): Promise<ActionHistoryItemData> {
    const mutationData = mutations.map((m) => m.storage)

    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'process-manual-triage' as const,
      mutations: mutationData,
    }
  }
}
