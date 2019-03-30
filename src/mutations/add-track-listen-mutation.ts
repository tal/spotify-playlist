import { Mutation, MutationTypes } from './mutation'
import { Dynamo } from '../db/dynamo'

export interface AddTrackListenData {
  track: { id: string }
  context: TrackSeenContext
}

export class AddTrackListenMutation extends Mutation<AddTrackListenData> {
  mutationType: MutationTypes = 'add-track-listen'

  transformData({ track, context }: AddTrackListenData): AddTrackListenData {
    return {
      track: { id: track.id },
      context,
    }
  }

  protected async mutate({ dynamo }: { dynamo: Dynamo }) {
    dynamo.setTrackRead(this.data.track, this.data.context)
  }
}
