import { TrackAction, trackToData } from './track-action'
import { Mutation } from '../mutations/mutation'

export class MagicPromoteAction extends TrackAction {
  idThrottleMs = 5 * (dev.isDev ? minutes : hours)

  async forStorage(
    mutations: Mutation<any>[],
  ): Promise<PromoteActionHistoryItemData> {
    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'promote-track',
      item: trackToData(await this.track()),
      mutations: mutations.map(m => m.storage),
    }
  }

  async getID() {
    const currentTrack = await this.track()
    if (!currentTrack) throw 'no track provided 1'

    return `promote:${currentTrack.uri}`
  }

  perform(): Promise<Mutation<any>[][]> {
    return this.promoteTrack()
  }
  undo(): Promise<Mutation<any>[][]> {
    return this.demoteTrack()
  }
}
