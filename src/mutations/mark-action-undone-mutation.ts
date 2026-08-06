import { Dynamo } from '../db/dynamo'
import { Mutation, MutationTypes } from './mutation'

export type MarkActionUndoneData = {
  action: { id: string; created_at: number }
  undone_at: number
}

/**
 * Stamps an `action_history` row as undone.
 *
 * `action_history` is keyed on `id` + `created_at`, so both travel. `id` is the
 * bare id the action minted, not the stored key — `markActionAsUndone` prefixes
 * it with the user, and a row read back out of Dynamo carries that prefix
 * already.
 */
export class MarkActionUndoneMutation extends Mutation<MarkActionUndoneData> {
  mutationType: MutationTypes = 'mark-action-undone'

  transformData(data: MarkActionUndoneData): MarkActionUndoneData {
    return {
      ...data,
      action: { id: data.action.id, created_at: data.action.created_at },
    }
  }

  protected async mutate({ dynamo }: { dynamo: Dynamo }) {
    await dynamo.markActionAsUndone(this.data.action, this.data.undone_at)
  }
}
