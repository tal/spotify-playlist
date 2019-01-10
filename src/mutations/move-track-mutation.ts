import { Mutation, MutationTypes } from './mutation'
import { TrackForMove, PlaylistID, Spotify } from '../spotify'

export interface MoveMutationData {
  tracks: TrackForMove[]
  from: PlaylistID
  to: PlaylistID
}

type D = MoveMutationData

export class MoveTrackMutation extends Mutation<MoveMutationData> {
  mutationType: MutationTypes = 'move-track'

  transformData({ tracks, to, from }: D): D {
    return {
      tracks: tracks.map(({ uri, id }) => {
        return {
          uri,
          id,
        }
      }),
      to: {
        id: to.id,
      },
      from: {
        id: from.id,
      },
    }
  }

  protected async mutate(client: Spotify) {
    const { tracks, from, to } = this.data
    await client.moveTracks(from, to, ...tracks)
  }
}
