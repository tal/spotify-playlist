import { TrackAction, trackToData } from './track-action'
import { Mutation } from '../mutations/mutation'

export class DemoteAction extends TrackAction {
  async forStorage(mutations: Mutation<any>[]) {
    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'demote-track' as 'demote-track',
      item: trackToData(await this.track()),
      mutations: mutations.map(m => m.storage),
    }
  }

  async getID(): Promise<string> {
    const currentTrack = await this.track()
    if (!currentTrack) throw 'no track provided 1'

    return `demote:${currentTrack.uri}`
  }

  perform() {
    return this.demoteTrack()
  }
}
