import { Mutation, MutationTypes } from './mutation'
import { Spotify } from '../spotify'

interface UnsaveTrackData {
  tracks: { id: string }[]
}

export class UnsaveTrackMutation extends Mutation<UnsaveTrackData> {
  mutationType: MutationTypes = 'save-track'

  protected async mutate({ client }: { client: Spotify }) {
    client.unsaveTrack(...this.data.tracks.map(t => t.id))
  }
}
