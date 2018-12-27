import { Action } from './action'
import { Spotify } from '../spotify'
import {
  MoveMutationData,
  MoveTrackMutation,
} from '../mutations/move-track-mutation'
import { settings } from '../settings'

export class ArchiveAction implements Action {
  idThrottleMs = 30 * 1000
  public created_at: number

  constructor(private client: Spotify) {
    this.created_at = new Date().getTime()
  }

  async getID() {
    return `archive`
  }

  private mutationData: MoveMutationData[] = []

  async forStorage() {
    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'archive' as ActionTypes,
      mutations: this.mutationData,
    }
  }

  async perform() {
    const client = this.client
    const { current, timeToArchive, archivePlaylistNameFor } = await settings()
    const now = new Date().getTime()

    const currentPlaylist = await client.playlist(current)
    const tracks = await client.tracksForPlaylist(currentPlaylist)
    const mutations: MoveTrackMutation[] = []

    for (let track of tracks) {
      const addedAt = new Date(track.added_at).getTime()
      const timeSinceAdded = now - addedAt
      if (timeSinceAdded > timeToArchive) {
        const targetPlaylistName = archivePlaylistNameFor(track)
        const targetPlaylist = await client.getOrCreatePlaylist(
          targetPlaylistName,
        )

        const mutation = new MoveTrackMutation({
          track: track.track,
          from: currentPlaylist,
          to: targetPlaylist,
        })

        mutations.push(mutation)
      }
    }

    const mutationPromises = mutations.map(m => m.run(this.client))
    for (let p of mutationPromises) {
      try {
        await p
      } catch {}
    }

    this.mutationData = mutations.map(m => m.data)
  }
}
