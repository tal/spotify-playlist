import { Dynamo } from '../db/dynamo'
import { Mutation } from '../mutations/mutation'
import { AddTrackMutation } from '../mutations/add-track-mutation'
import { Spotify, TrackForMove } from '../spotify'
import { Action } from './action'
import { EmptyPlaylistMutation } from '../mutations/empty-playlist-mutation'
import { PlaylistTrack } from 'spotify-web-api-node'
import { getTriageInfo } from './actionable-type'

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

  constructor(readonly client: Spotify, readonly options: { rule: string }) {}

  description?: (() => Promise<string>) | undefined

  async getID() {
    return `${this.type}:${this.options.rule}`
  }

  forStorage = undefined

  async randomStarredArtistTracks(tracks: PlaylistTrack[]) {
    const artistId = getRandomElement(tracks).track.artists[0].id
    const savedTracks = await this.client.mySavedTracks()
    return savedTracks.filter((track) => track.artists[0].id === artistId)
  }

  async perform({ dynamo }: { dynamo: Dynamo }) {
    this.client.mySavedTracks() // Prime the cache
    const { starred } = await getTriageInfo(this.client)
    if (!starred) {
      console.error('No starred playlist')
      return []
    }
    const tracks = await this.client.tracksForPlaylist(starred)

    const randomTracks = getRandomSlice(tracks, 40).map((track) => ({
      uri: track.track.uri,
    }))

    const addTracksMutation = new AddTrackMutation({
      tracks: randomTracks,
      playlist: {
        id: '6Yr80pdznzQdnCExCsqTTb',
      },
    })

    const likedTracks = await this.randomStarredArtistTracks(tracks)

    const likedTracksMutation = new AddTrackMutation({
      tracks: likedTracks,
      playlist: {
        id: '6Yr80pdznzQdnCExCsqTTb',
      },
    })

    return [
      [
        new EmptyPlaylistMutation({
          playlist: { id: '6Yr80pdznzQdnCExCsqTTb' },
        }),
      ],
      [addTracksMutation, likedTracksMutation],
    ]
  }

  idThrottleMs?: number | undefined
}
