import { Spotify } from '../spotify'
import { Dynamo } from '../db/dynamo'

export type CompletionStates = 'pending' | 'running' | 'success' | 'error'

export type MutationTypes =
  | 'move-track'
  | 'add-tracks'
  | 'remove-track'
  | 'save-track'
  | 'unsave-track'
  | 'add-track-listen'
  | 'update-last-played-processed'

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
      throw error
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
