import { Action } from './action'
import { Spotify, TrackForMove } from '../spotify'
import { MoveTrackMutation } from '../mutations/move-track-mutation'
import { settings } from '../settings'
import { Mutation } from '../mutations/mutation'

export class ArchiveAction implements Action {
  type = 'archive'
  // idThrottleMs = 30 * 1000
  public created_at: number

  constructor(private client: Spotify) {
    this.created_at = new Date().getTime()
  }

  async getID() {
    return `archive:${this.created_at}`
  }

  async forStorage(mutations: Mutation<any>[]) {
    const mutationData = mutations.map((m) => m.storage)
    const ttl = mutationData.length
      ? undefined
      : Math.floor((this.created_at + 2 * days) / 1000)

    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'archive' as ActionTypes,
      mutations: mutationData,
      ttl,
    }
  }

  async perform() {
    const client = this.client
    const { current, timeToArchive, archivePlaylistNameFor } = await settings()
    const now = new Date().getTime()

    const currentPlaylist = await client.playlist(current)
    const tracks = await client.tracksForPlaylist(currentPlaylist)
    const mutations: MoveTrackMutation[] = []

    const foo: { [k: string]: TrackForMove[] } = {}

    for (let track of tracks) {
      const addedAt = new Date(track.added_at).getTime()
      const timeSinceAdded = now - addedAt
      if (timeSinceAdded > timeToArchive) {
        const targetPlaylistName = archivePlaylistNameFor(track)
        const targetPlaylist = await client.getOrCreatePlaylist(
          targetPlaylistName,
        )

        if (!foo[targetPlaylist.id]) {
          foo[targetPlaylist.id] = []
        }

        foo[targetPlaylist.id].push(track.track)
      }
    }

    for (let playlistID in foo) {
      const tracks = foo[playlistID]

      mutations.push(
        new MoveTrackMutation({
          tracks,
          from: currentPlaylist,
          to: { id: playlistID },
        }),
      )
    }

    return [mutations]
  }
}
