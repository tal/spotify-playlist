import { Spotify } from '../spotify'
import { getTriageInfo } from './actionable-type'
import { Track } from 'spotify-web-api-node'

function trackToData(track?: Track): undefined | TrackData {
  if (!track) return undefined

  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artist: track.artists[0].name,
    album: track.album.name,
  }
}

export class PromoteAction {
  constructor(private client: Spotify, private trackID?: string) {}

  private trackPromise?: Promise<Track | undefined>
  track() {
    if (this.trackID) {
      if (this.trackPromise) {
        this.trackPromise = this.client.getTrack(this.trackID)
      }
      return this.trackPromise
    } else {
      return this.client.currentTrack
    }
  }

  async forStorage(): Promise<PromoteActionHistoryItemData> {
    return {
      id: await this.getID(),
      action: 'promote-track',
      item: trackToData(await this.track()),
    }
  }

  async getID(): Promise<string> {
    const currentTrack = await this.track()
    if (!currentTrack) throw 'no track provided'

    return `promote:${currentTrack.uri}`
  }

  async perform() {
    const { client } = this
    const currentTrack = await this.track()
    if (!currentTrack) throw 'no track provided'

    const { inbox, current } = await getTriageInfo(client)

    const player = await client.player

    let isPlayingInInbox = false
    if (player.context && player.context.type === 'playlist') {
      isPlayingInInbox = player.context.uri === inbox.uri
    }

    if (isPlayingInInbox && (await client.trackIsSaved(currentTrack))) {
      await client.moveCurrentTrack(currentTrack, inbox, current)
    } else {
      let addTrackDone: Promise<any> = Promise.resolve()
      if (!isPlayingInInbox) {
        addTrackDone = client.addTrackToPlaylist(currentTrack, inbox)
      }
      const saveDone = client.saveTrack(currentTrack.id)

      await saveDone
      await addTrackDone
    }
  }

  async undo() {
    const { client } = this
    const currentTrack = await client.currentTrack
    if (!currentTrack) throw 'no track provided'

    const { inbox, current } = await getTriageInfo(client)

    const trackInInbox = client.trackInPlaylist(currentTrack, inbox)
    const trackInCurrent = client.trackInPlaylist(currentTrack, current)
    const trackIsSaved = client.trackIsSaved(currentTrack)

    if (await trackInCurrent) {
      await client.moveCurrentTrack(currentTrack, current, inbox)
    } else if ((await trackInInbox) && (await trackIsSaved)) {
      await client.unsaveTrack(currentTrack.id)
    } else {
      throw 'cannot undo if track isnt in current or saved in the inbox'
    }
  }
}
