import { Mutation, MutationTypes } from './mutation'
import { Spotify } from '../spotify'

interface UnsaveTrackData {
  tracks: { id: string }[]
}

export class UnsaveTrackMutation extends Mutation<UnsaveTrackData> {
  mutationType: MutationTypes = 'unsave-track'

  protected async mutate({ client }: { client: Spotify }) {
    await client.unsaveTrack(...this.data.tracks.map((t) => t.id))
  }
}
