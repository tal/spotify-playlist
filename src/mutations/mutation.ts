import { Spotify } from '../spotify'
import { Dynamo } from '../db/dynamo'

export type CompletionStates =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'skipped'

/**
 * What a failed write does to the action running it.
 *
 * - 'abort-action'       — rethrow, so no later mutation set runs. The default,
 *                          and what every mutation wants unless a later set
 *                          exists specifically to react to the failure.
 * - 'record-and-continue' — keep the error on the mutation and let the action
 *                          finish. Only correct when something downstream reads
 *                          `completionState` and adjusts.
 */
export type MutationFailureMode = 'abort-action' | 'record-and-continue'

/** Whether a mutation still wants to run by the time its turn comes around. */
export type MutationIntent = 'run' | 'skip'

export type MutationTypes =
  | 'move-track'
  | 'add-tracks'
  | 'remove-track'
  | 'save-track'
  | 'unsave-track'
  | 'add-track-listen'
  | 'update-last-played-processed'
  | 'triage-action'
  | 'set-track-status'
  | 'empty-playlist'
  | 'rename-playlist'
  | 'skip-to-next-track'
  | 'mark-action-undone'

export interface MutationData<T> {
  type: 'mutation'
  mutationType: MutationTypes
  data: T
}

export interface Result {
  state: CompletionStates
}

export interface SuccessResult extends Result {
  state: 'success'
  data: object
}

export interface ErrorResult extends Result {
  state: 'error'
  error: Error
}

export abstract class Mutation<T> {
  protected data: T
  constructor(data: T) {
    this.data = this.transformData(data)
  }
  public transformData(data: T): T {
    return data
  }
  public completionState: Result = { state: 'pending' }

  protected failureMode: MutationFailureMode = 'abort-action'

  /**
   * Checked immediately before `mutate()`, so a mutation can bow out based on
   * what happened earlier in the same run rather than on what was true when it
   * was constructed.
   */
  protected intent(): MutationIntent {
    return 'run'
  }

  async run({
    client,
    dynamo,
  }: {
    client: Spotify
    dynamo: Dynamo
  }): Promise<void> {
    if (this.completionState.state !== 'pending') {
      throw `cannot run when in state ${this.completionState}`
    }

    if (this.intent() === 'skip') {
      console.log(
        `⏭️ ${this.mutationType} skipped - ${JSON.stringify(this.data)}`,
      )
      this.completionState = { state: 'skipped' }
      return
    }

    this.completionState.state = 'running'

    console.log(
      `🏃‍♀️ ${this.mutationType} started - ${JSON.stringify(this.data)}`,
    )

    try {
      await this.mutate({ client, dynamo })
      console.log(
        `🏃‍♀️ ${this.mutationType} complete - ${JSON.stringify(this.data)}`,
      )
      this.completionState = { state: 'success' } as SuccessResult
    } catch (error) {
      console.log(
        `🏃‍♀️ ${this.mutationType} error - ${JSON.stringify(this.data)}`,
      )
      this.completionState = { state: 'error', error } as ErrorResult

      if (this.failureMode === 'abort-action') throw error

      console.error(
        `⚠️ ${this.mutationType} failed without aborting the action`,
        error,
      )
    }
  }

  get storage() {
    return {
      type: 'mutation',
      mutationType: this.mutationType,
      data: this.data,
    }
  }

  abstract mutationType: MutationTypes
  protected abstract mutate({
    client,
    dynamo,
  }: {
    client: Spotify
    dynamo: Dynamo
  }): Promise<void>
}
