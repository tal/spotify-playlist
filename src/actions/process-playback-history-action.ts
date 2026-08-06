import { RecentlyPlayedItem } from 'spotify-web-api-node'
import { Action, PerformContext } from './action'
import { Spotify } from '../spotify'
import { AddTrackListenMutation } from '../mutations/add-track-listen-mutation'
import { ListenSequence } from '../mutations/listen-sequence'
import { Mutation } from '../mutations/mutation'
import { UpdateLastPlayedProcessedMutation } from '../mutations/update-last-played-processed-mutation'
import { Settings } from '../settings'

// Playback contexts look like `spotify:playlist:<id>`. Spotify reports some
// playlists as `playlist_v2`, so match on the trailing id rather than the uri.
function playlistIdFromContextUri(uri?: string) {
  return uri?.match(/^spotify:playlist(?:_v2)?:(.+)$/)?.[1]
}

const DAY_MS = 1000 * 60 * 60 * 24

export interface PlaybackHistorySnapshot {
  playedItems: RecentlyPlayedItem[]
  stageByPlaylistId: Map<string, TriageStage>
  watermark: number
  userId: string
}

export function processPlaybackHistoryPlan({
  playedItems,
  stageByPlaylistId,
  watermark,
  userId,
}: PlaybackHistorySnapshot): Mutation<any>[][] {
  const orderedItems = playedItems
    .slice()
    .sort((a, b) => Date.parse(a.played_at) - Date.parse(b.played_at))
    .filter((pi) => Date.parse(pi.played_at) > watermark)

  if (!orderedItems.length) return []

  const trackSeenArgs = orderedItems.map((pi) => {
    const playedAt = Date.parse(pi.played_at)
    const uri = pi.context?.uri
    const playlistId = playlistIdFromContextUri(uri)

    return {
      track: pi.track,
      increment_by: 1,
      // Undefined for anything not played out of a triage playlist (liked
      // songs, albums, search, autoplay) — those bump play_count only.
      stage: playlistId ? stageByPlaylistId.get(playlistId) : undefined,
      seen: {
        uri,
        played_at: playedAt,
        exactness: 'played' as const,
      },
    }
  })

  const attributed = trackSeenArgs.filter((a) => a.stage).length
  console.log(
    `[ProcessPlaybackHistoryAction] ${trackSeenArgs.length} listens, ${attributed} attributed to a triage stage`,
  )

  // One listen per mutation set, so the sets run strictly in ascending
  // played_at order and the watermark below can stop at the exact point the
  // writes stopped landing. See ListenSequence for why that matters.
  const sequence = new ListenSequence(watermark)

  const mutations: Mutation<any>[][] = trackSeenArgs.map((args) => [
    new AddTrackListenMutation(args, sequence),
  ])

  mutations.push([new UpdateLastPlayedProcessedMutation({ userId }, sequence)])

  return mutations
}

export class ProcessPlaybackHistoryAction implements Action {
  readonly created_at: number
  readonly type: string = 'process-playback-history'

  constructor(
    private client: Spotify,
    private user: UserData,
  ) {
    this.created_at = new Date().getTime()
  }

  async getID() {
    return `process-playback-history:${this.created_at}`
  }

  async forStorage(mutations: Mutation<any>[]) {
    const ttl = Math.floor((this.created_at + 183 * DAY_MS) / 1000)

    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'process-playback-history' as const,
      mutations: mutations.map((m) => m.storage),
      ttl,
    }
  }

  /**
   * Maps the Inbox/Current playlist ids to the stage they represent. Uses
   * `optionalPlaylist` so a missing playlist leaves those listens uncredited
   * rather than failing the whole playback run.
   */
  private async triageStagesByPlaylistId(settings: Settings) {
    const { inbox, current } = settings

    const [inboxPlaylist, currentPlaylist] = await Promise.all([
      this.client.optionalPlaylist(inbox),
      this.client.optionalPlaylist(current),
    ])

    const stages = new Map<string, TriageStage>()
    if (inboxPlaylist) stages.set(inboxPlaylist.id, 'inbox')
    if (currentPlaylist) stages.set(currentPlaylist.id, 'current')

    return stages
  }

  async gather({
    dynamo,
    settings,
  }: PerformContext): Promise<PlaybackHistorySnapshot> {
    const playedItems = await this.client.recentlyPlayed(
      this.user.lastPlayedAtProcessedTimestamp,
    )

    // Skip the two extra Spotify calls entirely when there's nothing to
    // attribute — recentlyPlayed already filtered on this same watermark, so
    // an empty result here means an empty result after the plan re-filters.
    const stageByPlaylistId = playedItems.length
      ? await this.triageStagesByPlaylistId(settings)
      : new Map<string, TriageStage>()

    return {
      playedItems,
      stageByPlaylistId,
      watermark: this.user.lastPlayedAtProcessedTimestamp,
      userId: dynamo.user.id,
    }
  }

  async perform(ctx: PerformContext) {
    return processPlaybackHistoryPlan(await this.gather(ctx))
  }
}
