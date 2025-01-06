import { Dynamo } from '../db/dynamo'
import { Mutation } from '../mutations/mutation'
import { AddTrackMutation } from '../mutations/add-track-mutation'
import { Spotify, TrackForMove } from '../spotify'
import { Action } from './action'
import { EmptyPlaylistMutation } from '../mutations/empty-playlist-mutation'

function getRandomSlice<T>(arr: T[], n: number): T[] {
  if (n > arr.length) return arr
  const start = Math.floor(Math.random() * (arr.length - n + 1))
  return arr.slice(start, start + n)
}

export class RulePlaylistAction implements Action {
  type: string = 'rule-playlist'

  constructor(readonly client: Spotify, readonly options: { rule: string }) {}

  description?: (() => Promise<string>) | undefined

  getID = async () => {
    return `${this.type}:${this.options.rule}`
  }

  forStorage = undefined

  perform = async ({ dynamo }: { dynamo: Dynamo }) => {
    const tracks = await this.client.tracksForPlaylist({ name: 'Starred' })
    const randomTracks = getRandomSlice(tracks, 40).map((track) => ({
      uri: track.track.uri,
    }))

    const addTracksMutation = new AddTrackMutation({
      tracks: randomTracks,
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
      [addTracksMutation],
    ]
  }

  idThrottleMs?: number | undefined
}
