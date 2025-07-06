import { Action } from './action'
import { Spotify } from '../spotify'
import { Dynamo } from '../db/dynamo'
import { Mutation } from '../mutations/mutation'
import { MagicPromoteAction } from './magic-promote-action'
import { DemoteAction } from './demote-action'

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

  private async findActionToUndo(): Promise<ActionHistoryItemData | undefined> {
    if (this.options.actionId) {
      const since = this.created_at - (this.options.lookbackMs || 24 * 60 * 60 * 1000)
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
        1
      )
      if (recentActions && recentActions.length > 0) {
        return recentActions[0]
      }
    }

    return undefined
  }

  async perform({ dynamo }: { dynamo: Dynamo }): Promise<Mutation<any>[][]> {
    const targetAction = await this.findActionToUndo()
    
    if (!targetAction) {
      throw new Error('No action found to undo')
    }

    if (targetAction.undone) {
      throw new Error('Action has already been undone')
    }

    const trackData = (targetAction as PromoteActionHistoryItemData).item
    if (!trackData) {
      throw new Error('No track data found in action history')
    }

    let undoableAction: MagicPromoteAction | DemoteAction | undefined

    if (targetAction.action === 'promote-track') {
      undoableAction = new MagicPromoteAction(this.client, { 
        trackID: trackData.id 
      })
    } else if (targetAction.action === 'demote-track') {
      undoableAction = new DemoteAction(this.client, { 
        trackID: trackData.id 
      })
    }

    if (!undoableAction) {
      throw new Error(`Cannot undo action type: ${targetAction.action}`)
    }

    if (!('undo' in undoableAction)) {
      throw new Error(`Action ${targetAction.action} does not support undo`)
    }

    console.log(`🔄 Undoing ${targetAction.action} for track: ${trackData.name} by ${trackData.artist}`)

    await this.dynamo.markActionAsUndone(targetAction.id)

    return await undoableAction.undo()
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