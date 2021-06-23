import { Dynamo } from '../db/dynamo'
import { AddTrackMutation } from '../mutations/add-track-mutation'
import { Mutation } from '../mutations/mutation'
import { Spotify } from '../spotify'
import { Action } from './action'
import { getTriageInfo } from './actionable-type'

export class AddPlaylistToInbox implements Action {
  // readonly idThrottleMs = 20 * minutes
  readonly playlistID: string
  readonly created_at: number
  readonly tracks: Promise<import('spotify-web-api-node').PlaylistTrack[]>
  spotify: Spotify

  constructor(
    client: Spotify,
    { id: playlistID }: { id: string; type?: 'playlist' },
  ) {
    this.spotify = client
    this.playlistID = playlistID
    this.created_at = new Date().getTime()

    this.tracks = client.tracksForPlaylist({ id: playlistID })
  }

  async getID() {
    return `inbox-playlist:${this.playlistID}`
  }

  async perform({ dynamo }: { dynamo: Dynamo }) {
    const tracks = await this.tracks
    const trackIDs = tracks.map((t) => t.track.id)
    const seenTracks = await dynamo.getSeenTracks(trackIDs)

    const idsToAdd = seenTracks
      .map((t) => {
        if (!t.found) {
          return `spotify:track:${t.id}`
        }
      })
      .filter((id): id is string => !!id)
      .map((uri) => ({ uri }))

    const { inbox } = await getTriageInfo(this.spotify)

    const idsNotSeen: typeof idsToAdd = []
    for (let id of idsToAdd) {
      const trackInPlaylist = await this.spotify.trackInPlaylist(id, inbox)
      if (!trackInPlaylist) {
        idsNotSeen.push(id)
      }
    }

    if (idsNotSeen.length === 0) {
      return []
    }

    const addTracks = new AddTrackMutation({
      tracks: idsNotSeen,
      playlist: inbox,
    })

    return [[addTracks]]
  }

  async forStorage(mutations: Mutation<any>[]): Promise<ActionHistoryItemData> {
    const mutationData = mutations.map((m) => m.storage)
    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'add-playlist-to-inbox' as const,
      mutations: mutationData,
    }
  }
}
