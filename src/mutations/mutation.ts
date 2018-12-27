import { Spotify } from '../spotify'

export type CompletionStates = 'pending' | 'running' | 'success' | 'error'

export type MutationTypes =
  | 'move-track'
  | 'add-track'
  | 'remove-track'
  | 'save-track'
  | 'unsave-track'

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
  data: T
  constructor(data: T) {
    this.data = this.transformData(data)
  }
  public transformData(data: T): T {
    return data
  }
  public completionState: Result = { state: 'pending' }

  async run(client: Spotify): Promise<void> {
    if (this.completionState.state !== 'pending') {
      throw `cannot run when in state ${this.completionState}`
    }
    this.completionState.state = 'running'

    try {
      await this.mutate(client)
      this.completionState = { state: 'success' } as SuccessResult
    } catch (error) {
      this.completionState = { state: 'error', error } as ErrorResult
      throw error
    }
  }

  get storage(): MutationData<T> {
    return {
      type: 'mutation',
      mutationType: this.mutationType,
      data: this.data,
    }
  }

  abstract mutationType: MutationTypes
  protected abstract mutate(client: Spotify): Promise<void>
}
