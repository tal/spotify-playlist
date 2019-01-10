import { Action } from './action'
import { Spotify, TrackForMove } from '../spotify'
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

    const mutationPromises = mutations.map(m => m.run(this.client))
    for (let p of mutationPromises) {
      try {
        await p
      } catch {}
    }

    this.mutationData = mutations.map(m => m.data)
  }
}
