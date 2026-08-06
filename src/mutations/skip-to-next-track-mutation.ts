import { Spotify } from '../spotify'
import { Dynamo } from '../db/dynamo'
import { Mutation, MutationTypes } from './mutation'

export interface SkipToNextTrackData {}

export class SkipToNextTrackMutation extends Mutation<SkipToNextTrackData> {
  mutationType: MutationTypes = 'skip-to-next-track'

  protected async mutate({ client }: { client: Spotify; dynamo: Dynamo }) {
    await client.skipToNextTrack()
  }
}
