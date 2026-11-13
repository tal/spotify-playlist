import { Dynamo } from '../db/dynamo'
import { Mutation, MutationTypes } from './mutation'

interface TriageActionData {
  track: { id: string }
  actionType: TrackTriageActionType
  action_at: number
  context_playlist_id?: string
  action_ref?: ActionHistoryRef
}

export class TriageActionMutation extends Mutation<TriageActionData> {
  mutationType: MutationTypes = 'triage-action'

  protected async mutate({ dynamo }: { dynamo: Dynamo }) {
    const { actionType, action_at, context_playlist_id, action_ref } = this.data
    // Optional fields are only written when set — never as explicit undefined.
    await dynamo.addTrackTriageAction(this.data.track, {
      action_type: actionType,
      action_at,
      ...(context_playlist_id ? { context_playlist_id } : {}),
      ...(action_ref ? { action_ref } : {}),
    })
  }
}
