import { Mutation, MutationTypes } from './mutation'
import { Spotify, TrackForMove } from '../spotify'

export class ReplacePlaylistMutation extends Mutation<{
  name: string
  tracks: TrackForMove[]
}> {
  mutationType: MutationTypes = 'replace-playlist'

  protected async mutate({ client }: { client: Spotify }) {
    if (dev.drySpotify) return
    const playlist = await client.getOrCreatePlaylist(this.data.name, true)
    await client.replacePlaylistTracks(playlist.id, this.data.tracks)
  }
}
