import { Mutation, MutationTypes } from './mutation'
import { TrackForMove, PlaylistID, Spotify } from '../spotify'

export interface AddTrackMoveMutationData {
  tracks: TrackForMove[]
  playlist: PlaylistID
}

type D = AddTrackMoveMutationData

export class AddTrackMutation extends Mutation<D> {
  mutationType: MutationTypes = 'add-tracks'

  transformData({ tracks, playlist }: D): D {
    return {
      tracks: tracks.map(track => ({
        uri: track.uri,
        id: track.id,
      })),
      playlist: {
        id: playlist.id,
      },
    }
  }

  protected async mutate({ client }: { client: Spotify }) {
    const { tracks, playlist } = this.data

    await client.addTrackToPlaylist(playlist, ...tracks)
  }
}
