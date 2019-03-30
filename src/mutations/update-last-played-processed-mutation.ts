import { Mutation, MutationTypes } from './mutation'
import { Dynamo } from '../db/dynamo'

interface UpdateLastPlayedProcessedData {
  ts: number
  userId: string
}

export class UpdateLastPlayedProcessedMutation extends Mutation<
  UpdateLastPlayedProcessedData
> {
  mutationType: MutationTypes = 'update-last-played-processed'

  protected async mutate({ dynamo }: { dynamo: Dynamo }) {
    dynamo.updateLastPlayedAtProcessedTimestamp(this.data.userId, this.data.ts)
  }
}
