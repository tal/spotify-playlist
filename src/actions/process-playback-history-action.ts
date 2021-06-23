import { Action } from './action'
import { Spotify } from '../spotify'
import { AddTrackListenMutation } from '../mutations/add-track-listen-mutation'
import { Mutation } from '../mutations/mutation'
import { UpdateLastPlayedProcessedMutation } from '../mutations/update-last-played-processed-mutation'
import { Dynamo } from '../db/dynamo'

export class ProcessPlaybackHistoryAction implements Action {
  public created_at: number

  constructor(private client: Spotify, private user: UserData) {
    this.created_at = new Date().getTime()
  }

  async getID() {
    return `process-playback-history:${this.created_at}`
  }

  async forStorage(mutations: Mutation<any>[]) {
    const ttl = Math.floor((this.created_at + 183 * days) / 1000)

    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'process-playback-history' as const,
      mutations: mutations.map((m) => m.storage),
      ttl,
    }
  }

  async perform({ dynamo }: { dynamo: Dynamo }) {
    let playedItems = await this.client.recentlyPlayed(
      this.user.lastPlayedAtProcessedTimestamp,
    )

    let mostRecentPlayedAt: number = 0

    playedItems = playedItems
      .sort((a, b) => Date.parse(a.played_at) - Date.parse(b.played_at))
      .filter(
        (pi) =>
          Date.parse(pi.played_at) > this.user.lastPlayedAtProcessedTimestamp,
      )

    if (!playedItems.length) return []

    const trackSeenArgs = playedItems.map((pi) => {
      const playedAt = Date.parse(pi.played_at)
      if (playedAt > mostRecentPlayedAt) mostRecentPlayedAt = playedAt

      return {
        track: pi.track,
        context: {
          uri: pi.context && pi.context.uri,
          played_at: playedAt,
          exactness: 'played' as const,
        },
      }
    })

    const mutations: Mutation<any>[][] = trackSeenArgs.map((args) => [
      new AddTrackListenMutation(args),
    ])

    mutations.push([
      new UpdateLastPlayedProcessedMutation({
        userId: dynamo.user.id,
        ts: mostRecentPlayedAt,
      }),
    ])

    return mutations
  }
}
