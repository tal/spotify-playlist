import { Dynamo } from '../db/dynamo'
import { Mutation } from '../mutations/mutation'
import { Spotify } from '../spotify'
import { Action } from './action'
import { getTriageInfo } from './actionable-type'
import { AddPlaylistToInbox } from './add-playlist-to-inbox'

type PlaylistTrack = import('spotify-web-api-node').PlaylistTrack

function noRemixes(track: PlaylistTrack) {
  const name = track.track.name
  return !/remix/i.test(name)
}

function onlyOriginals(track: PlaylistTrack) {
  return noRemixes(track)
}

export class ScanPlaylistsForInbox implements Action {
  readonly idThrottleMs = undefined
  readonly created_at: number

  readonly playlistActions: Promise<AddPlaylistToInbox>[] = []

  constructor(private spotify: Spotify) {
    this.created_at = new Date().getTime()

    this.playlistActions.push(
      getTriageInfo(spotify).then(
        ({ discoverWeekly }) =>
          new AddPlaylistToInbox(this.spotify, discoverWeekly),
      ),
    )
    this.playlistActions.push(
      getTriageInfo(spotify).then(
        ({ releaseRadar }) =>
          new AddPlaylistToInbox(this.spotify, releaseRadar, onlyOriginals),
      ),
    )
  }

  async getID() {
    return `scan-playlists-for-inbox:${this.created_at}`
  }

  async perform({ dynamo }: { dynamo: Dynamo }) {
    let mutations: Mutation<any>[][] = []

    for (let actionPromise of this.playlistActions) {
      const action = await actionPromise
      const result = await action.perform({ dynamo })
      mutations = [...mutations, ...result]
    }

    return mutations
  }

  async forStorage(mutations: Mutation<any>[]): Promise<ActionHistoryItemData> {
    const mutationData = mutations.map((m) => m.storage)
    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'scan-playlists-for-inbox' as const,
      mutations: mutationData,
    }
  }
}
