import { Dynamo } from '../db/dynamo'
import { AddTrackListenMutation } from '../mutations/add-track-listen-mutation'
import { Mutation } from '../mutations/mutation'
import { Spotify } from '../spotify'
import { Action } from './action'
import { getTriageInfo } from './actionable-type'

export class ProcessManualTriage implements Action {
  readonly idThrottleMs = undefined
  readonly created_at: number

  constructor(private spotify: Spotify) {
    this.created_at = new Date().getTime()
  }

  async getID() {
    return `process-manual-triage:${this.created_at}`
  }

  private async performCurrent({
    dynamo,
  }: {
    dynamo: Dynamo
  }): Promise<Mutation<any>[][]> {
    const { current } = await getTriageInfo(this.spotify)
    const playlistTracks = await this.spotify.tracksForPlaylist({
      id: current.id,
    })

    const ids = playlistTracks.map((track) => track.track.id)
    const trackRecords = await dynamo.getTracks(ids)

    const uninboxedTracks = playlistTracks.filter((data) => {
      const trackRecord = trackRecords[data.track.id]

      if (trackRecord?.triage_actions) {
        for (let action of trackRecord.triage_actions) {
          if (action.action_type === 'promote') {
            return false
          }
        }
      }

      return true
    })

    const mutations = uninboxedTracks.map((track) => {
      const date = new Date(track.added_at)
      const played_at = date.getTime()
      const uri = track.track.uri

      return new AddTrackListenMutation({
        track: { id: track.track.id },
        increment_by: 0,
        triageActions: [{ action_at: played_at, action_type: 'promote' }],
        seen: {
          uri,
          played_at,
          exactness: 'playlist-addition' as const,
        },
      })
    })
    return []
  }

  private async performInbox({
    dynamo,
  }: {
    dynamo: Dynamo
  }): Promise<Mutation<any>[][]> {
    const { inbox } = await getTriageInfo(this.spotify)
    const playlistTracks = await this.spotify.tracksForPlaylist({
      id: inbox.id,
    })

    const ids = playlistTracks.map((track) => track.track.id)
    const trackRecords = await dynamo.getTracks(ids)

    const uninboxedTracks = playlistTracks.filter((data) => {
      const trackRecord = trackRecords[data.track.id]

      if (trackRecord?.triage_actions) {
        for (let action of trackRecord.triage_actions) {
          if (action.action_type === 'inboxed') {
            return false
          }
        }
      }

      return true
    })

    const mutations = uninboxedTracks.map((track) => {
      const date = new Date(track.added_at)
      const played_at = date.getTime()
      const uri = track.track.uri

      return new AddTrackListenMutation({
        track: { id: track.track.id },
        increment_by: 0,
        triageActions: [{ action_at: played_at, action_type: 'inboxed' }],
        seen: {
          uri,
          played_at,
          exactness: 'playlist-addition' as const,
        },
      })
    })

    return [mutations]
  }

  async perform({ dynamo }: { dynamo: Dynamo }): Promise<Mutation<any>[][]> {
    const performInbox = this.performInbox({ dynamo })
    const performCurrent = this.performCurrent({ dynamo })

    return [...(await performInbox), ...(await performCurrent)]
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
