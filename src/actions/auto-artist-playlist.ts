import { Action, PerformContext } from './action'
import { Spotify, TrackForMove, PlaylistID } from '../spotify'
import { PlaylistTrack, Track } from 'spotify-web-api-node'
import { AddTrackMutation } from '../mutations/add-track-mutation'
import { Mutation } from '../mutations/mutation'

export interface AutoArtistPlaylistSnapshot {
  playlistTracks: PlaylistTrack[]
  savedTracks: Track[]
  playlist: PlaylistID
}

function artists(tracks: PlaylistTrack[]) {
  const artistIDs: Set<string> = new Set()

  for (let track of tracks) {
    artistIDs.add(track.track.artists[0].id)
  }

  return artistIDs
}

function savedTracksForArtists(tracks: PlaylistTrack[], savedTracks: Track[]) {
  const artistIDs = artists(tracks)

  const forArtists: Track[] = []
  for (let savedTrack of savedTracks) {
    if (artistIDs.has(savedTrack.artists[0].id)) {
      forArtists.push(savedTrack)
    }
  }

  return forArtists
}

function tracksToAdd(tracks: PlaylistTrack[], savedTracks: Track[]) {
  const forArtists = savedTracksForArtists(tracks, savedTracks)

  const existingTrackIDs: Set<string> = new Set()
  for (let track of tracks) {
    existingTrackIDs.add(track.track.id)
  }

  const toAdd: TrackForMove[] = []
  for (let track of forArtists) {
    if (!existingTrackIDs.has(track.id)) {
      toAdd.push(track)
    }
  }

  return toAdd
}

export function autoArtistPlaylistPlan(
  snapshot: AutoArtistPlaylistSnapshot,
): Mutation<any>[][] {
  const toAdd = tracksToAdd(snapshot.playlistTracks, snapshot.savedTracks)

  if (toAdd.length === 0) {
    console.error(`No tracks to be added to playlist:${snapshot.playlist.id}`)
    return []
  }

  const mutation = new AddTrackMutation({
    tracks: toAdd,
    playlist: snapshot.playlist,
  })

  return [[mutation]]
}

export class AutoArtistPlaylist implements Action {
  type: string = 'auto-artist-playlist'
  private playlistID: string
  private created_at: number
  constructor(
    private client: Spotify,
    { id: playlistID }: { id: string; type?: 'playlist' },
  ) {
    this.playlistID = playlistID
    this.created_at = new Date().getTime()
  }

  async getID() {
    return `auto-artist:${this.playlistID}`
  }

  async forStorage(mutations: Mutation<any>[]) {
    const mutationData = mutations.map((m) => m.storage)
    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'auto-artist-playlist' as ActionTypes,
      mutations: mutationData,
    }
  }

  async gather(_ctx: PerformContext): Promise<AutoArtistPlaylistSnapshot> {
    const [playlistTracks, savedTracks] = await Promise.all([
      this.client.tracksForPlaylist({ id: this.playlistID }),
      this.client.mySavedTracks(),
    ])

    return {
      playlistTracks,
      savedTracks,
      playlist: { id: this.playlistID },
    }
  }

  async perform(ctx: PerformContext) {
    return autoArtistPlaylistPlan(await this.gather(ctx))
  }
}
