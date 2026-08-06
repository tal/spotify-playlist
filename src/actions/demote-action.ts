import {
  TrackAction,
  demotePlan,
  promotePlan,
  trackToData,
} from './track-action'
import { Mutation } from '../mutations/mutation'
import { Action, PerformContext } from './action'

export class DemoteAction extends TrackAction implements Action {
  readonly type: string = 'demote'
  async forStorage(mutations: Mutation<any>[]) {
    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'demote-track' as 'demote-track',
      item: trackToData(await this.track()),
      mutations: mutations.map((m) => m.storage),
    }
  }

  async getID(): Promise<string> {
    if (!this.trackURI) throw 'no track provided 1'

    return `demote:${this.trackURI}`
  }

  async perform(ctx: PerformContext): Promise<Mutation<any>[][]> {
    return demotePlan(await this.gatherDemote(ctx.client))
  }

  async undo(): Promise<Mutation<any>[][]> {
    return promotePlan(await this.gatherPromote())
  }
}
