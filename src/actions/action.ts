import { Dynamo } from '../db/dynamo'
import { Mutation } from '../mutations/mutation'
import { Spotify } from '../spotify'

export interface Action {
  forStorage: (mutations: Mutation<any>[]) => Promise<ActionHistoryItemData>
  getID: () => Promise<string>
  perform: ({ dynamo }: { dynamo: Dynamo }) => Promise<Mutation<any>[][]>
  idThrottleMs?: number
}

type PerformActionReason = 'throttled' | 'shouldnt-act' | 'success'

async function performAction<T>(
  dynamo: Dynamo,
  client: Spotify,
  action: Action,
): Promise<Result<T, PerformActionReason>> {
  const id = action.getID()

  const { idThrottleMs } = action

  if (idThrottleMs) {
    const now = new Date().getTime()
    const since = now - idThrottleMs
    const history = await dynamo.getActionHistory(await id, since)

    if (history) {
      return {
        reason: 'throttled',
      }
    }
  }

  const mutationSets = await action.perform({ dynamo })
  let allMutations: Mutation<any>[] = []

  for (let mutations of mutationSets) {
    await Promise.all(mutations.map(f => f.run({ client, dynamo })))
    allMutations = allMutations.concat(mutations)
  }

  const data = await action.forStorage(allMutations)

  await dynamo.putActionHistory(data)

  return { reason: 'success' }
}

function arrayify<T>(val: T | T[]): T[] {
  if (val instanceof Array) {
    return val
  } else {
    return [val]
  }
}

export async function performActions<T>(
  dynamo: Dynamo,
  client: Spotify,
  action: Action | Action[],
): Promise<Result<T, PerformActionReason>[]> {
  const actions = arrayify(action)

  const results: Result<T, PerformActionReason>[] = []
  for (let action of actions) {
    results.push(await performAction(dynamo, client, action))
  }

  return results
}
