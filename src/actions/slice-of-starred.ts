import { Action, PerformContext } from './action'
import { getRandomSlice } from './rule-playlist'
import { ReplacePlaylistMutation } from '../mutations/replace-playlist-mutation'
import { Spotify } from '../spotify'

export const SLICE_OF_STARRED_NAME = 'Slice of Starred 🦦'

export class SliceOfStarredAction implements Action {
  readonly type = 'slice-of-starred'

  constructor(
    readonly client: Spotify,
    readonly pick: (n: number) => number = (n) => Math.floor(Math.random() * n),
  ) {}

  async getID() {
    return this.type
  }

  async perform({ settings }: PerformContext) {
    const starred = await this.client.optionalPlaylist(settings.starred)
    if (!starred) {
      console.error('No starred playlist; leaving Slice of Starred unchanged')
      return []
    }

    const tracks = await this.client.tracksForPlaylist(starred)
    const streamable = tracks.filter(({ track }) =>
      track?.uri?.startsWith('spotify:track:'),
    )
    const slice = getRandomSlice(streamable, 45, this.pick)

    return [
      [
        new ReplacePlaylistMutation({
          name: SLICE_OF_STARRED_NAME,
          tracks: slice.map(({ track }) => ({ uri: track.uri })),
        }),
      ],
    ]
  }
}
