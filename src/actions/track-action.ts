import { Action } from './action'
import { Spotify, displayTrack } from '../spotify'
import { Track } from 'spotify-web-api-node'
import { getTriageInfo } from './actionable-type'

export function trackToData(track?: Track): undefined | TrackData {
  if (!track) return undefined

  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artist: track.artists[0].name,
    album: track.album.name,
  }
}

type TriageStates = 'unheard' | 'liked' | 'confirmed'

interface TriageState {
  inbox: boolean
  current: boolean
  saved: boolean
}

function triageStatesEqual(t1: TriageState, t2: TriageState): boolean {
  return (
    t1.current === t2.current && t1.inbox === t2.inbox && t1.saved === t2.saved
  )
}

function isTriageState(key: string): key is TriageStates {
  return key === 'unheard' || key === 'liked' || key === 'confirmed'
}

const triageStates: { [k in TriageStates]: TriageState } = {
  unheard: {
    inbox: true,
    current: false,
    saved: false,
  },
  liked: {
    inbox: true,
    current: false,
    saved: true,
  },
  confirmed: {
    inbox: false,
    current: true,
    saved: true,
  },
}

function triageStateName(state: TriageState): TriageStates {
  for (let key in triageStates) {
    if (isTriageState(key)) {
      const compState = triageStates[key]
      if (triageStatesEqual(compState, state)) {
        return key
      }
    }
  }

  if (state.saved) {
    return 'liked'
  } else {
    return 'unheard'
  }
}

export type AfterTrackActionAction = 'nothing' | 'skip-track'

export abstract class TrackAction implements Action {
  abstract forStorage(): Promise<ActionHistoryItemData>
  abstract getID(): Promise<string>
  abstract perform(): Promise<void>

  idThrottleMs?: number | undefined
  private trackID?: string
  private afterCurrentTrack: AfterTrackActionAction = 'nothing'
  public created_at: number

  constructor(
    private client: Spotify,
    {
      trackID,
      afterCurrentTrack,
    }: { trackID?: string; afterCurrentTrack?: AfterTrackActionAction } = {},
  ) {
    this.trackID = trackID
    this.afterCurrentTrack = afterCurrentTrack || 'nothing'
    this.created_at = new Date().getTime()
  }

  async shouldAct() {
    return true
  }

  private trackPromise?: Promise<Track | undefined>
  track() {
    if (this.trackID) {
      const track = this.trackPromise || this.client.getTrack(this.trackID)

      this.trackPromise = track

      return track
    } else {
      return this.client.currentTrack
    }
  }

  async currentState(): Promise<TriageState> {
    const { client } = this
    const currentTrack = await this.track()
    if (!currentTrack) throw 'no track provided 4'
    const { inbox, current } = await getTriageInfo(client)

    const trackInInbox = client.trackInPlaylist(currentTrack, inbox)
    const trackInCurrent = client.trackInPlaylist(currentTrack, current)
    const trackIsSaved = client.trackIsSaved(currentTrack)

    return {
      saved: await trackIsSaved,
      current: await trackInCurrent,
      inbox: await trackInInbox,
    }
  }

  async promotedState(): Promise<TriageState> {
    const currentState = await this.currentState()
    const name = triageStateName(currentState)

    if (!name) {
      throw `cannot find triage state for ${JSON.stringify(currentState)}`
    }

    if (name === 'confirmed') {
      throw 'cannot promote if confirmed'
    } else if (name === 'liked') {
      return triageStates.confirmed
    } else if (name === 'unheard') {
      return triageStates.liked
    } else {
      return triageStates.liked
    }
  }

  async undoneState(): Promise<TriageState> {
    const currentState = await this.currentState()
    const name = triageStateName(currentState)

    if (!name) {
      throw `cannot find triage state for ${JSON.stringify(currentState)}`
    }

    if (name === 'confirmed') {
      return triageStates.liked
    } else {
      return triageStates.unheard
    }
  }

  async promoteTrack() {
    if (this.afterCurrentTrack === 'skip-track') {
      this.track().then(() => {
        this.client.skipToNextTrack()
      })
    }
    const currentStateP = this.currentState()
    const promotedStateP = this.promotedState()

    const { client } = this

    const player = await client.player
    if (!player.is_playing) throw `player must be playing`

    const currentTrack = await this.track()
    if (!currentTrack) throw 'no track provided 2'
    console.log(`🏃 Magic Promote: ${displayTrack(currentTrack)}`)

    const currentState = await currentStateP
    const promotedState = await promotedStateP
    const { inbox, current } = await getTriageInfo(client)

    const promises: Promise<any>[] = []

    if (currentState.current !== promotedState.current) {
      if (promotedState.current) {
        promises.push(client.addTrackToPlaylist(current, currentTrack))
      } else {
        promises.push(client.removeTrackFromPlaylist(current, currentTrack))
      }
    }

    if (currentState.inbox !== promotedState.inbox) {
      if (promotedState.inbox) {
        promises.push(client.addTrackToPlaylist(inbox, currentTrack))
      } else {
        promises.push(client.removeTrackFromPlaylist(inbox, currentTrack))
      }
    }

    if (currentState.saved !== promotedState.saved) {
      if (promotedState.saved) {
        promises.push(client.saveTrack(currentTrack.id))
      } else {
        promises.push(client.unsaveTrack(currentTrack.id))
      }
    }

    await Promise.all(promises)
  }

  async demoteTrack() {
    const { client } = this
    const currentTrack = await client.currentTrack
    if (!currentTrack) throw 'no track provided 3'

    const { inbox, current } = await getTriageInfo(client)
    const currentlyPlayingPlaylistP = client.currentlyPlayingPlaylist

    const promises: Promise<any>[] = []

    promises.push(client.removeTrackFromPlaylist(current, currentTrack))
    promises.push(client.removeTrackFromPlaylist(inbox, currentTrack))

    const currentlyPlayingPlaylist = await currentlyPlayingPlaylistP
    if (
      currentlyPlayingPlaylist &&
      currentlyPlayingPlaylist.id !== current.id &&
      currentlyPlayingPlaylist.id !== inbox.id
    ) {
      promises.push(
        client.removeTrackFromPlaylist(currentlyPlayingPlaylist, currentTrack),
      )
    }

    promises.push(client.unsaveTrack(currentTrack.id))

    await Promise.all(promises)
  }
}
