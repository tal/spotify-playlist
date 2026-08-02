import { Mutation, MutationTypes } from './mutation'
import { Dynamo } from '../db/dynamo'

export type SetTrackStatusData = {
  track: { id: string }
  status: TrackStatus
  changed_at: number
}

/**
 * Sets the denormalized status directly, without appending to `triage_actions`.
 *
 * That asymmetry is deliberate: `triage_actions` stays a log of *explicit* user
 * actions, so a track demoted on purpose (has a 'remove' entry) is still
 * distinguishable from one that quietly vanished from its playlist (status is
 * 'removed' with no matching entry).
 */
export class SetTrackStatusMutation extends Mutation<SetTrackStatusData> {
  mutationType: MutationTypes = 'set-track-status'

  transformData(data: SetTrackStatusData): SetTrackStatusData {
    return {
      ...data,
      track: { id: data.track.id },
    }
  }

  protected async mutate({ dynamo }: { dynamo: Dynamo }) {
    await dynamo.setTrackStatus(
      this.data.track,
      this.data.status,
      this.data.changed_at,
    )
  }
}
