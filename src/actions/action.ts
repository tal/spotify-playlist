import { Dynamo } from '../db/dynamo'
import { Mutation } from '../mutations/mutation'
import { Spotify } from '../spotify'

export interface Action {
  forStorage?: (mutations: Mutation<any>[]) => Promise<ActionHistoryItemData>
  getID: () => Promise<string>
  perform: ({ dynamo }: { dynamo: Dynamo }) => Promise<Mutation<any>[][]>
  idThrottleMs?: number | undefined
  type: string
  name?: () => Promise<string>
}

type PerformActionReason = 'throttled' | 'shouldnt-act' | 'success'

type ActionResult = { action_name: string; action_type: string; name?: string }

async function performAction(
  dynamo: Dynamo,
  client: Spotify,
  action: Action,
): Promise<Result<ActionResult, PerformActionReason>> {
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
    await Promise.all(mutations.map((f) => f.run({ client, dynamo })))
    allMutations = allMutations.concat(mutations)
  }

  if (action.forStorage) {
    const data = await action.forStorage(allMutations)
    await dynamo.putActionHistory(data)
  }

  let name: string | undefined
  if ('name' in action && action.name) {
    name = await action.name()
  }

  return {
    reason: 'success',
    value: { action_name: await id, action_type: action.type, name },
  }
}

function arrayify<T>(val: T | T[]): T[] {
  if (val instanceof Array) {
    return val
  } else {
    return [val]
  }
}

export async function performActions(
  dynamo: Dynamo,
  client: Spotify,
  action: Action | (Action | null)[],
) {
  const actions = arrayify(action)

  const results: Result<ActionResult, PerformActionReason>[] = []
  for (let action of actions) {
    if (!action) {
      continue
    }
    results.push(await performAction(dynamo, client, action))
  }

  return results
}
