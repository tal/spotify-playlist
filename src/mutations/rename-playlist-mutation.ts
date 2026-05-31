import { Mutation, MutationTypes } from './mutation'
import { PlaylistID, Spotify } from '../spotify'

export interface RenamePlaylistMutationData {
  playlist: PlaylistID
  name: string
}

type D = RenamePlaylistMutationData

export class RenamePlaylistMutation extends Mutation<RenamePlaylistMutationData> {
  mutationType: MutationTypes = 'rename-playlist'

  transformData({ playlist, name }: D): D {
    return {
      playlist: {
        id: playlist.id,
      },
      name,
    }
  }

  protected async mutate({ client }: { client: Spotify }) {
    const { playlist, name } = this.data
    await client.renamePlaylist(playlist.id, name)
  }
}
