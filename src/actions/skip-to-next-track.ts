import { Dynamo } from '../db/dynamo'
import { Mutation } from '../mutations/mutation'
import { Spotify } from '../spotify'
import { Action } from './action'

export class SkipToNextTrack implements Action {
  type = 'skip-to-next-track'
  constructor(private client: Spotify) {}

  async getID() {
    return `skip-to-next-track:${new Date().getTime()}`
  }

  async perform() {
    await this.client.skipToNextTrack()
    return []
  }

  async name() {
    const player = await this.client.player
    const currentPlaylist = await this.client.currentlyPlayingPlaylist

    return `Skip to next track: ${player.item?.name} in ${
      currentPlaylist?.name ?? player.context?.type
    }`
  }
}
