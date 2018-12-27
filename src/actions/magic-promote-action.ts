import { TrackAction, trackToData } from './track-action'

export class MagicPromoteAction extends TrackAction {
  idThrottleMs = 5 * 60 * 1000

  async forStorage(): Promise<PromoteActionHistoryItemData> {
    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'promote-track',
      item: trackToData(await this.track()),
    }
  }

  async getID(): Promise<string> {
    const currentTrack = await this.track()
    if (!currentTrack) throw 'no track provided 1'

    return `promote:${currentTrack.uri}`
  }

  perform(): Promise<void> {
    return this.promoteTrack()
  }
  undo(): Promise<void> {
    return this.demoteTrack()
  }
}
