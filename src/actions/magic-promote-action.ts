import {
  TrackAction,
  demotePlan,
  promotePlan,
  trackToData,
} from './track-action'
import { Mutation } from '../mutations/mutation'
import { Action, PerformContext, ThrottleWindow } from './action'

export class MagicPromoteAction extends TrackAction implements Action {
  idThrottleMs: ThrottleWindow = (settings) => settings.promoteThrottleMs
  type: string = 'magic-promote'

  async forStorage(
    mutations: Mutation<any>[],
  ): Promise<PromoteActionHistoryItemData> {
    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'promote-track',
      item: trackToData(await this.track()),
      mutations: mutations.map((m) => m.storage),
    }
  }

  async getID() {
    if (!this.trackURI) throw 'no track provided 1'

    return `promote:${this.trackURI}`
  }

  async perform(ctx: PerformContext): Promise<Mutation<any>[][]> {
    return promotePlan(await this.gatherPromote(ctx.client))
  }

  async undo(): Promise<Mutation<any>[][]> {
    return demotePlan(await this.gatherDemote())
  }
}
