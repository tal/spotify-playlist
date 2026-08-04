import { Dynamo, DYNAMO_WRITE_CHUNK } from '../db/dynamo'
import { AddTrackListenMutation } from '../mutations/add-track-listen-mutation'
import { Mutation } from '../mutations/mutation'
import { Spotify } from '../spotify'
import { Action } from './action'
import { getTriageInfo } from './actionable-type'
import { chunkArray } from '../utils/array'

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

  /**
   * Backfills the triage log for tracks that reached a playlist without going
   * through the app — dragged in by hand, so nothing ever recorded them.
   *
   * Inbox and Current are the same job twice: the action that marks a track as
   * already accounted for is also the one written for those that aren't.
   */
  private async backfillStage(
    dynamo: Dynamo,
    playlist: { id: string },
    action_type: TrackTriageActionType,
  ): Promise<Mutation<any>[][]> {
    const playlistTracks = await this.spotify.tracksForPlaylist({
      id: playlist.id,
    })

    const trackRecords = await dynamo.getTracks(
      playlistTracks.map((track) => track.track.id),
    )

    const untriaged = playlistTracks.filter(
      (data) =>
        !trackRecords[data.track.id]?.triage_actions?.some(
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

  async perform({ dynamo }: { dynamo: Dynamo }): Promise<Mutation<any>[][]> {
    const { inbox, current } = await getTriageInfo(this.spotify)

    const [inboxSets, currentSets] = await Promise.all([
      this.backfillStage(dynamo, inbox, 'inboxed'),
      this.backfillStage(dynamo, current, 'promote'),
    ])

    return [...inboxSets, ...currentSets]
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
