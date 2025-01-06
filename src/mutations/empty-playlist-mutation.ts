import { Mutation, MutationTypes } from './mutation'
import { PlaylistID, Spotify } from '../spotify'
import { Dynamo } from '../db/dynamo'

export interface EmptyPlaylistMutationData {
  playlist: PlaylistID
}

type D = EmptyPlaylistMutationData

export class EmptyPlaylistMutation extends Mutation<EmptyPlaylistMutationData> {
  mutationType: MutationTypes = 'empty-playlist'

  transformData({ playlist }: D): D {
    return {
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
    const { playlist } = this.data
    await client.emptyPlaylist(playlist.id)
  }
}
