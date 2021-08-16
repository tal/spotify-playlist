import { Dynamo } from '../db/dynamo'
import { Mutation, MutationTypes } from './mutation'

interface TriageActionData {
  track: { id: string }
  actionType: TrackTriageActionType
}

export class TriageActionMutation extends Mutation<TriageActionData> {
  mutationType: MutationTypes = 'triage-action'

  protected async mutate({ dynamo }: { dynamo: Dynamo }) {
    await dynamo.addTrackTriageAction(this.data.track, {
      action_type: this.data.actionType,
      action_at: new Date().getTime(),
    })
  }
}
