import { Action } from './action'
import { Spotify, TrackForMove } from '../spotify'
import { PlaylistTrack, Track } from 'spotify-web-api-node'
import { AddTrackMutation } from '../mutations/add-track-mutation'
import { Mutation } from '../mutations/mutation'

export class AutoArtistPlaylist implements Action {
  private playlistID: string
  private tracks: Promise<PlaylistTrack[]>
  private savedTracks: Promise<Track[]>
  private created_at: number
  constructor(
    client: Spotify,
    { id: playlistID }: { id: string; type?: 'playlist' },
  ) {
    this.playlistID = playlistID
    this.created_at = new Date().getTime()

    this.tracks = client.tracksForPlaylist({ id: playlistID })
    this.savedTracks = client.mySavedTracks()
  }

  async getID() {
    return `auto-artist:${this.playlistID}`
  }

  async forStorage(mutations: Mutation<any>[]) {
    const mutationData = mutations.map(m => m.storage)
    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'auto-artist-playlist' as ActionTypes,
      mutations: mutationData,
    }
  }

  async artists() {
    const tracks = await this.tracks

    const artistIDs: Set<string> = new Set()

    for (let track of tracks) {
      artistIDs.add(track.track.artists[0].id)
    }

    return artistIDs
  }

  async savedTracksForArtists() {
    const savedTracks = await this.savedTracks
    const artistIDs = await this.artists()

    const tracks: Track[] = []
    for (let savedTrack of savedTracks) {
      if (artistIDs.has(savedTrack.artists[0].id)) {
        tracks.push(savedTrack)
      }
    }

    return tracks
  }

  async tracksToAdd() {
    const savedTracks = await this.savedTracksForArtists()
    const existingTracks = (await this.tracks).map(t => t.track)

    const existingTrackIDs: Set<string> = new Set()
    for (let track of existingTracks) {
      existingTrackIDs.add(track.id)
    }

    const tracksToAdd: TrackForMove[] = []
    for (let track of savedTracks) {
      if (!existingTrackIDs.has(track.id)) {
        tracksToAdd.push(track)
      }
    }

    return tracksToAdd
  }

  async perform() {
    const tracksToAdd = await this.tracksToAdd()

    if (tracksToAdd.length === 0) {
      throw `No tracks to be added to ${this.playlistID}`
    }

    const mutation = new AddTrackMutation({
      tracks: tracksToAdd,
      playlist: { id: this.playlistID },
    })

    return [[mutation]]
  }
}
