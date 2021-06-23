import { Mutation, MutationTypes } from './mutation'
import { Spotify } from '../spotify'

interface SaveTrackMutationData {
  tracks: { id: string }[]
}

export class SaveTrackMutation extends Mutation<SaveTrackMutationData> {
  mutationType: MutationTypes = 'save-track'

  protected async mutate({ client }: { client: Spotify }) {
    client.saveTrack(...this.data.tracks.map((t) => t.id))
  }
}
