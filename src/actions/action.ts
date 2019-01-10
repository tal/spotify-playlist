import { document, getActionHistory } from '../db/document'
import { put } from '../db/put'

export interface Action {
  forStorage: () => Promise<ActionHistoryItemData>
  getID: () => Promise<string>
  perform: () => Promise<void>
  idThrottleMs?: number
}

function shouldThrottle(
  { idThrottleMs }: { idThrottleMs: number },
  history?: ActionHistoryItemData,
): boolean {
  if (history) {
    const expirationDate = history.created_at + idThrottleMs
    const now = new Date().getTime()
    if (now < expirationDate) {
      return true
    }
  }

  return false
}

type PerformActionReason = 'throttled' | 'shouldnt-act' | 'success'

async function performAction<T>(
  action: Action,
): Promise<Result<T, PerformActionReason>> {
  // const shouldAct = action.shouldAct()
  const id = action.getID()
  // if (!(await shouldAct)) {
  //   return {
  //     reason: 'shouldnt-act',
  //   }
  // }

  const { idThrottleMs } = action

  if (idThrottleMs) {
    const now = new Date().getTime()
    const since = now - idThrottleMs
    const history = await getActionHistory(await id, since)

    if (history) {
      return {
        reason: 'throttled',
      }
    }
  }

  await action.perform()
  const data = await action.forStorage()

  await put('action_history', data)

  return { reason: 'success' }
}

export async function performActions<T>(
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
    results.push(await performAction(action))
  }

  return results
}
