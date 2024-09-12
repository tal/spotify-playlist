import { Dynamo } from '../db/dynamo'
import { AddTrackMutation } from '../mutations/add-track-mutation'
import { Mutation } from '../mutations/mutation'
import { TriageActionMutation } from '../mutations/triage-action-mutation'
import { Spotify } from '../spotify'
import { Action } from './action'
import { getTriageInfo } from './actionable-type'

type PlaylistTrack = import('spotify-web-api-node').PlaylistTrack

export class AddPlaylistToInbox implements Action {
  type: string = 'add-playlist-to-inbox'
  // readonly idThrottleMs = 20 * minutes
  readonly playlistID: string
  readonly created_at: number
  readonly tracks: Promise<PlaylistTrack[]>
  spotify: Spotify

  constructor(
    client: Spotify,
    { id: playlistID }: { id: string; type?: 'playlist' },
    readonly trackFilter?: (track: PlaylistTrack) => boolean,
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
    let tracks = await this.tracks
    if (this.trackFilter) {
      tracks = tracks.filter(this.trackFilter)
    }
    const trackIDs = tracks.map((t) => t.track.id)
    const seenTracks = await dynamo.getSeenTracks(trackIDs)

    const idsToAdd = seenTracks
      .map((t) => {
        if (!t.found) {
          return `spotify:track:${t.id}`
        }
      })
      .filter((uri): uri is string => !!uri)
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
    const inboxedMutatons = idsNotSeen.map(({ uri }) => {
      const m = uri.match(/^spotify:track:(.+)/)
      if (m) {
        const id = m[1]
        return new TriageActionMutation({
          track: { id },
          actionType: 'inboxed',
        })
      } else {
        throw 'everything should be a valid uri'
      }
    })

    return [[addTracks, ...inboxedMutatons]]
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
