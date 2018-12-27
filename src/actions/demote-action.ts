import { TrackAction, trackToData } from './track-action'

export class DemoteAction extends TrackAction {
  async forStorage(): Promise<PromoteActionHistoryItemData> {
    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'demote-track',
      item: trackToData(await this.track()),
    }
  }

  async getID(): Promise<string> {
    const currentTrack = await this.track()
    if (!currentTrack) throw 'no track provided 1'

    return `demote:${currentTrack.uri}`
  }

  perform(): Promise<void> {
    return this.demoteTrack()
  }
}
