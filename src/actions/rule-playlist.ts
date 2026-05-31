import { Dynamo } from '../db/dynamo'
import { Mutation } from '../mutations/mutation'
import { AddTrackMutation } from '../mutations/add-track-mutation'
import { RenamePlaylistMutation } from '../mutations/rename-playlist-mutation'
import { Spotify, TrackForMove } from '../spotify'
import { Action } from './action'
import { EmptyPlaylistMutation } from '../mutations/empty-playlist-mutation'
import { PlaylistTrack } from 'spotify-web-api-node'
import { getTriageInfo } from './actionable-type'

// The smart playlist is matched by this name prefix rather than a hardcoded id,
// because the action rewrites the trailing part of the name to show whose
// saved tracks were mixed in this round.
const SMART_PLAYLIST_PREFIX = 'Smart Playlist'

function getRandomSlice<T>(arr: T[], n: number): T[] {
  if (n > arr.length) return arr
  const start = Math.floor(Math.random() * (arr.length - n + 1))
  return arr.slice(start, start + n)
}

function getRandomElement<T>(arr: T[]): T {
  const offset = Math.floor(Math.random() * arr.length)
  return arr[offset]
}

export class RulePlaylistAction implements Action {
  type: string = 'rule-playlist'

  constructor(
    readonly client: Spotify,
    readonly options: { rule: string },
  ) {}

  description?: (() => Promise<string>) | undefined

  async getID() {
    return `${this.type}:${this.options.rule}`
  }

  forStorage = undefined

  async randomStarredArtistTracks(tracks: PlaylistTrack[]) {
    const artist = getRandomElement(tracks).track.artists[0]
    const savedTracks = await this.client.mySavedTracks()
    const artistTracks = savedTracks.filter(
      (track) =>
        track.artists[0].id === artist.id &&
        track.uri &&
        !track.uri.startsWith('spotify:local:'),
    )
    return { artist, tracks: artistTracks }
  }

  async perform({ dynamo }: { dynamo: Dynamo }) {
    this.client.mySavedTracks() // Prime the cache

    const playlist = await this.client.playlistByPrefix(SMART_PLAYLIST_PREFIX)
    if (!playlist) {
      console.error(
        `No playlist found with prefix "${SMART_PLAYLIST_PREFIX}"`,
      )
      return []
    }
    const playlistId = { id: playlist.id }

    const { starred } = await getTriageInfo(this.client)
    if (!starred) {
      console.error('No starred playlist')
      return []
    }
    const tracks = await this.client.tracksForPlaylist(starred)

    // Filter out local tracks (spotify:local:) which can't be added via API
    const isStreamableTrack = (track: PlaylistTrack) =>
      track.track.uri && !track.track.uri.startsWith('spotify:local:')

    const streamableTracks = tracks.filter(isStreamableTrack)

    const randomTracks = getRandomSlice(streamableTracks, 40).map((track) => ({
      uri: track.track.uri,
    }))

    const addTracksMutation = new AddTrackMutation({
      tracks: randomTracks,
      playlist: playlistId,
    })

    const { artist, tracks: likedTracks } =
      await this.randomStarredArtistTracks(streamableTracks)

    const likedTracksMutation = new AddTrackMutation({
      tracks: likedTracks,
      playlist: playlistId,
    })

    // Rewrite the trailing part of the name to show whose saved tracks are mixed in
    const renameMutation = new RenamePlaylistMutation({
      playlist: playlistId,
      name: `${SMART_PLAYLIST_PREFIX} — ${artist.name}`,
    })

    return [
      [
        new EmptyPlaylistMutation({
          playlist: playlistId,
        }),
      ],
      [addTracksMutation, likedTracksMutation, renameMutation],
    ]
  }

  idThrottleMs?: number | undefined
}
