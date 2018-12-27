import { Mutation, MutationTypes } from './mutation'
import { TrackForMove, PlaylistID, Spotify } from '../spotify'

export interface AddTrackMoveMutationData {
  track: TrackForMove
  playlist: PlaylistID
}

type D = AddTrackMoveMutationData

export class AddTrackMutation extends Mutation<AddTrackMoveMutationData> {
  mutationType: MutationTypes = 'add-track'

  transformData({ track, playlist }: D): D {
    return {
      track: {
        uri: track.uri,
        id: track.id,
      },
      playlist: {
        id: playlist.id,
      },
    }
  }

  protected async mutate(client: Spotify) {
    const { track, playlist } = this.data
    await client.addTrackToPlaylist(track, playlist)
  }
}
