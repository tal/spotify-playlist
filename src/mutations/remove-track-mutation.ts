import { Mutation, MutationTypes } from './mutation'
import { TrackForMove, PlaylistID, Spotify } from '../spotify'
import { trackToData } from '../actions/track-action'
import { Dynamo } from '../db/dynamo'

export interface RemoveTrackMoveMutationData {
  track: TrackForMove
  playlist: PlaylistID
}

type D = RemoveTrackMoveMutationData

export class RemoveTrackMutation extends Mutation<RemoveTrackMoveMutationData> {
  mutationType: MutationTypes = 'remove-track'

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

  protected async mutate({
    client,
    dynamo,
  }: {
    client: Spotify
    dynamo: Dynamo
  }) {
    const { track, playlist } = this.data
    await client.removeTrackFromPlaylist(playlist, track)
  }
}
