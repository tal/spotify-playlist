import { Mutation } from '../mutations/mutation'
import { AddTrackMutation } from '../mutations/add-track-mutation'
import { RenamePlaylistMutation } from '../mutations/rename-playlist-mutation'
import { PlaylistID, Spotify, TrackForMove } from '../spotify'
import { Action, PerformContext } from './action'
import { EmptyPlaylistMutation } from '../mutations/empty-playlist-mutation'
import { PlaylistTrack } from 'spotify-web-api-node'
import { getTriageInfo } from './actionable-type'

// The smart playlist is matched by this name prefix rather than a hardcoded id,
// because the action rewrites the trailing part of the name to show whose
// saved tracks were mixed in this round.
const SMART_PLAYLIST_PREFIX = 'Smart Playlist'

export function getRandomSlice<T>(
  arr: T[],
  n: number,
  pick: (n: number) => number,
): T[] {
  if (n > arr.length) return arr
  const start = pick(arr.length - n + 1)
  return arr.slice(start, start + n)
}

function getRandomElement<T>(arr: T[], pick: (n: number) => number): T {
  const offset = pick(arr.length)
  return arr[offset]
}

export interface RulePlaylistSnapshot {
  playlist: PlaylistID
  tracks: TrackForMove[]
  likedTracks: TrackForMove[]
  artistName: string
}

export function rulePlaylistPlan(
  snapshot: RulePlaylistSnapshot,
): Mutation<any>[][] {
  const playlist = { id: snapshot.playlist.id }

  const addTracksMutation = new AddTrackMutation({
    tracks: snapshot.tracks,
    playlist,
  })

  const likedTracksMutation = new AddTrackMutation({
    tracks: snapshot.likedTracks,
    playlist,
  })

  // Rewrite the trailing part of the name to show whose saved tracks are mixed in
  const renameMutation = new RenamePlaylistMutation({
    playlist,
    name: `${SMART_PLAYLIST_PREFIX} — ${snapshot.artistName}`,
  })

  return [
    [
      new EmptyPlaylistMutation({
        playlist,
      }),
    ],
    [addTracksMutation, likedTracksMutation, renameMutation],
  ]
}

export class RulePlaylistAction implements Action {
  type: string = 'rule-playlist'

  constructor(
    readonly client: Spotify,
    readonly options: { rule: string },
    readonly pick: (n: number) => number = (n) => Math.floor(Math.random() * n),
  ) {}

  description?: (() => Promise<string>) | undefined

  async getID() {
    return `${this.type}:${this.options.rule}`
  }

  forStorage = undefined

  async randomStarredArtistTracks(tracks: PlaylistTrack[]) {
    const artist = getRandomElement(tracks, this.pick).track.artists[0]
    const savedTracks = await this.client.mySavedTracks()
    // Match on ANY credited artist, not just the primary one — otherwise every
    // collab / feature where the artist is billed second gets dropped.
    const artistTracks = savedTracks.filter(
      (track) =>
        track.artists.some((trackArtist) => trackArtist.id === artist.id) &&
        track.uri &&
        !track.uri.startsWith('spotify:local:'),
    )
    return { artist, tracks: artistTracks }
  }

  async perform(_ctx: PerformContext) {
    this.client.mySavedTracks() // Prime the cache

    const playlist = await this.client.playlistByPrefix(SMART_PLAYLIST_PREFIX)
    if (!playlist) {
      console.error(`No playlist found with prefix "${SMART_PLAYLIST_PREFIX}"`)
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

    const randomTracks = getRandomSlice(streamableTracks, 40, this.pick).map(
      (track) => ({
        uri: track.track.uri,
      }),
    )

    const { artist, tracks: likedTracks } =
      await this.randomStarredArtistTracks(streamableTracks)

    return rulePlaylistPlan({
      playlist: playlistId,
      tracks: randomTracks,
      likedTracks,
      artistName: artist.name,
    })
  }

  idThrottleMs?: number | undefined
}
