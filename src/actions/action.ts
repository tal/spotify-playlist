import { Dynamo } from '../db/dynamo'

export interface Action {
  forStorage: () => Promise<ActionHistoryItemData>
  getID: () => Promise<string>
  perform: () => Promise<void>
  idThrottleMs?: number
}

type PerformActionReason = 'throttled' | 'shouldnt-act' | 'success'

async function performAction<T>(
  dynamo: Dynamo,
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

  await action.perform()

  const data = await action.forStorage()

  await dynamo.putActionHistory(data)

  return { reason: 'success' }
}

export async function performActions<T>(
  dynamo: Dynamo,
  action: Action | Action[],
): Promise<Result<T, PerformActionReason>[]> {
  let actions: Action[]
  if (action instanceof Array) {
    actions = action
  } else {
    actions = [action]
  }

  const results: Result<T, PerformActionReason>[] = []
  for (let action of actions) {
    results.push(await performAction(dynamo, action))
  }

  return results
}
