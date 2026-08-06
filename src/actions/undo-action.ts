import { Action, PerformContext } from './action'
import { Spotify } from '../spotify'
import { Dynamo } from '../db/dynamo'
import { Mutation } from '../mutations/mutation'
import { MarkActionUndoneMutation } from '../mutations/mark-action-undone-mutation'
import { MagicPromoteAction } from './magic-promote-action'
import { DemoteAction } from './demote-action'
import {
  DemoteSnapshot,
  PromoteSnapshot,
  demotePlan,
  promotePlan,
} from './track-action'

const alreadyUndone = 'Action has already been undone'

export type UndoState = 'undoable' | 'undone'

/**
 * The `action_history` row being undone, reduced to what the planner decides
 * from: the key it has to stamp and whether it is still stampable.
 */
export interface UndoTarget {
  id: string
  created_at: number
  state: UndoState
}

/**
 * Undoing a promote *is* a demote and vice versa, so the direction picks the
 * planner and the snapshot is whatever that planner needs.
 */
export type UndoDirection =
  | { direction: 'demote'; snapshot: DemoteSnapshot }
  | { direction: 'promote'; snapshot: PromoteSnapshot }

export interface UndoSnapshot {
  target: UndoTarget
  undo: UndoDirection
  now: number
}

export function undoDirectionFor(
  action: ActionTypes,
): UndoDirection['direction'] | undefined {
  if (action === 'promote-track') return 'demote'
  if (action === 'demote-track') return 'promote'

  return undefined
}

/**
 * The mark-undone write is its own trailing mutation set, so it lands only
 * after the reversal it records actually did — a half-failed undo leaves the
 * row unstamped and retryable.
 */
export function undoPlan(snapshot: UndoSnapshot): Mutation<any>[][] {
  const { target, undo, now } = snapshot

  if (target.state === 'undone') throw new Error(alreadyUndone)

  const reversal =
    undo.direction === 'demote'
      ? demotePlan(undo.snapshot)
      : promotePlan(undo.snapshot)

  return [
    ...reversal,
    [
      new MarkActionUndoneMutation({
        action: { id: target.id, created_at: target.created_at },
        undone_at: now,
      }),
    ],
  ]
}

export class UndoAction implements Action {
  type: string = 'undo'
  idThrottleMs?: number = undefined
  created_at: number

  constructor(
    private client: Spotify,
    private dynamo: Dynamo,
    private options: {
      actionId?: string
      actionType?: 'promote' | 'demote'
      lookbackMs?: number
    } = {},
  ) {
    this.created_at = new Date().getTime()
  }

  async getID(): Promise<string> {
    const targetAction = await this.findActionToUndo()
    if (!targetAction) {
      throw new Error('No action found to undo')
    }
    return `undo:${targetAction.id}:${this.created_at}`
  }

  async forStorage(mutations: Mutation<any>[]): Promise<ActionHistoryItemData> {
    const targetAction = await this.findActionToUndo()
    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'undo' as any,
      mutations: mutations.map((m) => m.storage),
      originalActionId: targetAction?.id,
    } as ActionHistoryItemData
  }

  private lookupPromise?: Promise<ActionHistoryItemData | undefined>

  /**
   * `getID()`, `forStorage()`, `perform()` and `description()` each want the row
   * and every one of them can run inside a single invocation, so the promise —
   * not its value — is what gets held: two callers racing before the first
   * lookup settles still share the one query.
   */
  private findActionToUndo(): Promise<ActionHistoryItemData | undefined> {
    this.lookupPromise ??= this.lookupActionToUndo()

    return this.lookupPromise
  }

  private async lookupActionToUndo(): Promise<
    ActionHistoryItemData | undefined
  > {
    if (this.options.actionId) {
      const since =
        this.created_at - (this.options.lookbackMs || 24 * 60 * 60 * 1000)
      return await this.dynamo.getActionHistory(this.options.actionId, since)
    }

    const lookbackMs = this.options.lookbackMs || 5 * 60 * 1000
    const since = this.created_at - lookbackMs

    const actionTypes: Array<'promote' | 'demote'> = this.options.actionType
      ? [this.options.actionType]
      : ['promote', 'demote']

    for (const actionType of actionTypes) {
      const recentActions = await this.dynamo.getRecentActionsOfType(
        actionType,
        since,
        1,
      )
      if (recentActions && recentActions.length > 0) {
        return recentActions[0]
      }
    }

    return undefined
  }

  /**
   * The identity comes off the stored row and both gathers honor it, so an undo
   * reverses the track the row names — not whatever the player has moved on to
   * in the lookback window, which for an `action-id` undo is a full day wide.
   */
  async gather(ctx: PerformContext): Promise<UndoSnapshot> {
    const targetAction = await this.findActionToUndo()

    if (!targetAction) {
      throw new Error('No action found to undo')
    }

    if (targetAction.undone) {
      throw new Error(alreadyUndone)
    }

    const trackData = (targetAction as PromoteActionHistoryItemData).item
    if (!trackData) {
      throw new Error('No track data found in action history')
    }

    const target: UndoTarget = {
      id: this.dynamo.ungId(targetAction.id),
      created_at: targetAction.created_at,
      state: 'undoable',
    }

    const direction = undoDirectionFor(targetAction.action)
    if (!direction) {
      throw new Error(`Cannot undo action type: ${targetAction.action}`)
    }

    const identity = { trackID: trackData.id, trackURI: trackData.uri }

    console.log(
      `🔄 Undoing ${targetAction.action} for track: ${trackData.name} by ${trackData.artist}`,
    )

    if (direction === 'demote') {
      const promoted = new MagicPromoteAction(this.client, identity)

      return {
        target,
        undo: { direction, snapshot: await promoted.gatherDemote(this.client) },
        now: ctx.now,
      }
    }

    const demoted = new DemoteAction(this.client, identity)

    return {
      target,
      undo: { direction, snapshot: await demoted.gatherPromote(this.client) },
      now: ctx.now,
    }
  }

  async perform(ctx: PerformContext): Promise<Mutation<any>[][]> {
    return undoPlan(await this.gather(ctx))
  }

  async description(): Promise<string> {
    const targetAction = await this.findActionToUndo()
    if (!targetAction) {
      return 'undo: no action found'
    }

    const trackData = (targetAction as PromoteActionHistoryItemData).item
    if (trackData) {
      return `undo ${targetAction.action}: ${trackData.artist} — ${trackData.name}`
    }

    return `undo ${targetAction.action}`
  }
}
