import { Mutation, MutationTypes } from './mutation'
import { Dynamo, UpdateTrackParams } from '../db/dynamo'

export type AddTrackListenData = {
  track: { id: string }
} & UpdateTrackParams

export class AddTrackListenMutation extends Mutation<AddTrackListenData> {
  mutationType: MutationTypes = 'add-track-listen'

  transformData(data: AddTrackListenData): AddTrackListenData {
    return {
      ...data,
      track: { id: data.track.id }, // so you can pass in a whole track object but it'll only save out the ID
    }
  }

  protected async mutate({ dynamo }: { dynamo: Dynamo }) {
    dynamo.updateTrack(this.data.track, this.data)
  }
}
