import { Mutation } from '../mutations/mutation'
import { Spotify } from '../spotify'
import { Action, PerformContext } from './action'
import { getTriageInfo } from './actionable-type'
import { AddPlaylistToInbox } from './add-playlist-to-inbox'

type PlaylistTrack = import('spotify-web-api-node').PlaylistTrack

export function noRemixes(track: PlaylistTrack) {
  const name = track.track.name
  return !/remix/i.test(name)
}

export function noLive(track: PlaylistTrack) {
  const name = track.track.name
  return !/live/i.test(name)
}

export function onlyOriginals(track: PlaylistTrack) {
  return noRemixes(track) && noLive(track)
}

export class ScanPlaylistsForInbox implements Action {
  readonly idThrottleMs: number | undefined = undefined
  readonly created_at: number
  readonly type: string = 'scan-playlists-for-inbox'

  constructor(private spotify: Spotify) {
    this.created_at = new Date().getTime()
  }

  async addActions() {
    const { discoverWeekly, releaseRadar } = await getTriageInfo(this.spotify)

    const playlistActions: AddPlaylistToInbox[] = []

    if (discoverWeekly) {
      playlistActions.push(new AddPlaylistToInbox(this.spotify, discoverWeekly))
    }

    if (releaseRadar) {
      playlistActions.push(new AddPlaylistToInbox(this.spotify, releaseRadar))
    }

    return playlistActions
  }

  async getID() {
    return `scan-playlists-for-inbox:${this.created_at}`
  }

  async perform(ctx: PerformContext) {
    const playlistActions = await this.addActions()

    let mutations: Mutation<any>[][] = []

    for (let action of playlistActions) {
      const result = await action.perform(ctx)
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
