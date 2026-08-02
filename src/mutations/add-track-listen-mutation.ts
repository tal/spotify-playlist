import { Mutation, MutationIntent, MutationTypes } from './mutation'
import { Dynamo, UpdateTrackParams } from '../db/dynamo'
import { ListenSequence } from './listen-sequence'

export type AddTrackListenData = {
  track: { id: string }
} & UpdateTrackParams

export class AddTrackListenMutation extends Mutation<AddTrackListenData> {
  mutationType: MutationTypes = 'add-track-listen'

  /**
   * `sequence` is only passed by the playback pass, where these writes advance a
   * watermark. There, a failure must not unwind the action — the watermark
   * mutation runs last and has to survive to record how far the pass actually
   * got, or every listen already written gets counted again on the next run.
   * Without a sequence (manual triage, `increment_by: 0`) nothing downstream
   * cares, so failures abort as usual.
   */
  constructor(data: AddTrackListenData, private sequence?: ListenSequence) {
    super(data)

    if (sequence) this.failureMode = 'record-and-continue'
  }

  transformData(data: AddTrackListenData): AddTrackListenData {
    return {
      ...data,
      track: { id: data.track.id }, // so you can pass in a whole track object but it'll only save out the ID
    }
  }

  protected intent(): MutationIntent {
    return this.sequence?.status === 'halted' ? 'skip' : 'run'
  }

  protected async mutate({ dynamo }: { dynamo: Dynamo }) {
    try {
      await dynamo.updateTrack(this.data.track, this.data)
    } catch (error) {
      this.sequence?.halt()
      throw error
    }

    const playedAt = this.data.seen?.played_at
    if (typeof playedAt === 'number') this.sequence?.recordSuccess(playedAt)
  }
}
