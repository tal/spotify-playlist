import { Mutation, MutationTypes } from './mutation'
import { TrackForMove, PlaylistID, Spotify } from '../spotify'

export interface MoveMutationData {
  track: TrackForMove
  from: PlaylistID
  to: PlaylistID
}

type D = MoveMutationData

export class MoveTrackMutation extends Mutation<MoveMutationData> {
  mutationType: MutationTypes = 'move-track'

  transformData({ track, to, from }: D): D {
    return {
      track: {
        uri: track.uri,
        id: track.id,
      },
      to: {
        id: to.id,
      },
      from: {
        id: from.id,
      },
    }
  }

  protected async mutate(client: Spotify) {
    const { track, from, to } = this.data
    await client.moveCurrentTrack(track, from, to)
  }
}
