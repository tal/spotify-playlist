import { Spotify } from '../spotify'
import { Action, PerformContext } from './action'
import { SkipToNextTrackMutation } from '../mutations/skip-to-next-track-mutation'

export class SkipToNextTrack implements Action {
  type = 'skip-to-next-track'
  constructor(private client: Spotify) {}

  async getID() {
    return 'skip-to-next-track'
  }

  async perform(_ctx: PerformContext) {
    return [[new SkipToNextTrackMutation({})]]
  }

  async description() {
    const player = await this.client.player
    const currentPlaylist = await this.client.currentlyPlayingPlaylist

    return `Skip to next track: ${player.item?.name} in ${
      currentPlaylist?.name ?? player.context?.type
    }`
  }
}
