import { Mutation, MutationTypes } from './mutation'
import { Dynamo } from '../db/dynamo'
import { ListenSequence } from './listen-sequence'

interface UpdateLastPlayedProcessedData {
  ts: number
  userId: string
}

export class UpdateLastPlayedProcessedMutation extends Mutation<UpdateLastPlayedProcessedData> {
  mutationType: MutationTypes = 'update-last-played-processed'

  /**
   * The watermark is never a caller's to choose: it is wherever the listen
   * writes actually reached, which is only known once they have run. So the
   * sequence is the sole source of `ts` — seeded at construction so `data` is
   * never a lie, then re-read at mutate time for the value that counts.
   *
   * `data.ts` is rewritten rather than reported separately because the
   * `action_history` record is serialized after every mutation has run, and it
   * has to show where the pass stopped rather than where it hoped to.
   */
  constructor(
    data: { userId: string },
    private sequence: ListenSequence,
  ) {
    super({ ...data, ts: sequence.watermark })
  }

  protected async mutate({ dynamo }: { dynamo: Dynamo }) {
    this.data.ts = this.sequence.watermark

    await dynamo.updateLastPlayedAtProcessedTimestamp(
      this.data.userId,
      this.data.ts,
    )
  }
}
