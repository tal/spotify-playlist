import {
  TrackAction,
  TriageMembership,
  demotePlan,
  locationSnapshot,
  promotePlan,
  readTriageMembership,
  trackToData,
} from './track-action'
import { Mutation } from '../mutations/mutation'
import { Action, PerformContext, ThrottleWindow } from './action'

export class MagicPromoteAction extends TrackAction implements Action {
  idThrottleMs: ThrottleWindow = (settings) => settings.promoteThrottleMs
  type: string = 'magic-promote'

  /**
   * The before-state, captured during `perform()` from the same gather the
   * planner reads, and the track it acted on. Both are set only on a run that
   * was not throttled — a throttled promote never reaches `perform()`, so it
   * records nothing, which is exactly the "without throttling" contract.
   */
  private beforeMembership?: TriageMembership
  private promotedTrack?: BasicTrackData

  async forStorage(
    mutations: Mutation<any>[],
  ): Promise<PromoteActionHistoryItemData> {
    const item = trackToData(await this.track())
    const before = this.beforeMembership
      ? locationSnapshot(this.beforeMembership)
      : undefined

    // Measure the after-state by re-reading Spotify now that the mutations have
    // run. A failed re-read must never abort the history write — the promote
    // already happened — so it degrades to an absent `after`.
    let after: PromoteLocationSnapshotData | undefined
    const target = this.promotedTrack ?? item
    if (target) {
      try {
        after = locationSnapshot(await readTriageMembership(this.client, target))
      } catch (error) {
        console.error('⚠️ Promote after-state re-read failed', error)
      }
    }

    const data: PromoteActionHistoryItemData = {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'promote-track',
      item,
      mutations: mutations.map((m) => m.storage),
    }
    // Only present when actually captured, so a forStorage without a prior
    // perform() (or a failed after-read) writes the pre-existing shape exactly.
    if (before) data.before = before
    if (after) data.after = after
    return data
  }

  async getID() {
    if (!this.trackURI) throw 'no track provided 1'

    return `promote:${this.trackURI}`
  }

  async perform(ctx: PerformContext): Promise<Mutation<any>[][]> {
    const snapshot = await this.gatherPromote(ctx.client)
    // Capture the before-state (and the track) before the plan's mutations run.
    this.beforeMembership = snapshot.membership
    this.promotedTrack = snapshot.track
    return promotePlan(snapshot)
  }

  async undo(): Promise<Mutation<any>[][]> {
    return demotePlan(await this.gatherDemote())
  }
}
