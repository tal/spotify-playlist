import { Action } from './action'
import { Spotify, displayTrack } from '../spotify'
import { Track } from 'spotify-web-api-node'
import { getTriageInfo } from './actionable-type'
import { Mutation } from '../mutations/mutation'
import { AddTrackMutation } from '../mutations/add-track-mutation'
import { RemoveTrackMutation } from '../mutations/remove-track-mutation'
import { SaveTrackMutation } from '../mutations/save-track-mutation'
import { UnsaveTrackMutation } from '../mutations/unsave-track-mutation'
import { TriageActionMutation } from '../mutations/triage-action-mutation'
import { delay } from '../utils/delay'

export function trackToData(track?: Track): undefined | BasicTrackData {
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
  abstract forStorage(
    mutations: Mutation<any>[],
  ): Promise<ActionHistoryItemData>
  abstract getID(): Promise<string>
  abstract perform(): Promise<Mutation<any>[][]>

  idThrottleMs?: number | undefined
  private trackID?: string
  public created_at: number
  abstract type: string

  constructor(private client: Spotify, { trackID }: { trackID?: string } = {}) {
    this.trackID = trackID
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

    const trackInInbox = client
      .trackInPlaylist(currentTrack, inbox)
      .then((t) => !!t)
    const trackInCurrent = client
      .trackInPlaylist(currentTrack, current)
      .then((t) => !!t)
    const trackIsSaved = client.trackIsSaved(currentTrack).then((t) => !!t)

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

  async promoteTrack(): Promise<Mutation<any>[][]> {
    const currentStateP = this.currentState()
    const promotedStateP = this.promotedState()

    const { client } = this

    const player = await client.player
    if (!player.is_playing) throw `player must be playing`

    const currentTrack = await this.track()
    if (!currentTrack) throw 'no track provided 2'
    console.log(`🏃 Magic Promote: ${displayTrack(currentTrack)}`)

    const { inbox, current } = await getTriageInfo(client)
    const currentState = await currentStateP
    const promotedState = await promotedStateP

    const mutations: Mutation<any>[] = []

    if (currentState.current !== promotedState.current) {
      if (promotedState.current) {
        mutations.push(
          new AddTrackMutation({ tracks: [currentTrack], playlist: current }),
        )
        mutations.push(
          new TriageActionMutation({
            track: currentTrack,
            actionType: 'promote',
          }),
        )
      } else {
        mutations.push(
          new RemoveTrackMutation({ track: currentTrack, playlist: current }),
        )
      }
    }

    if (currentState.inbox !== promotedState.inbox) {
      if (promotedState.inbox) {
        mutations.push(
          new AddTrackMutation({ tracks: [currentTrack], playlist: inbox }),
        )
        mutations.push(
          new TriageActionMutation({
            track: currentTrack,
            actionType: 'inboxed',
          }),
        )
      } else {
        mutations.push(
          new RemoveTrackMutation({ track: currentTrack, playlist: inbox }),
        )
      }
    }

    if (currentState.saved !== promotedState.saved) {
      if (promotedState.saved) {
        mutations.push(new SaveTrackMutation({ tracks: [currentTrack] }))
      } else {
        mutations.push(new UnsaveTrackMutation({ tracks: [currentTrack] }))
      }
    }

    mutations.push(
      new TriageActionMutation({
        track: currentTrack,
        actionType: 'upvote',
      }),
    )

    return [mutations]
  }

  async demoteTrack(): Promise<Mutation<any>[][]> {
    const { client } = this
    let currentTrack = await client.currentTrack
    if (!currentTrack) {
      ;(client.player as any).reset()
      await delay(85)
      currentTrack = await client.currentTrack
    }
    if (!currentTrack) throw 'no track provided 3'

    const { inbox, current, starred } = await getTriageInfo(client)
    const currentlyPlayingPlaylist = await client.currentlyPlayingPlaylist

    if (
      currentlyPlayingPlaylist &&
      currentlyPlayingPlaylist.id === starred?.id
    ) {
      return [
        [
          new RemoveTrackMutation({
            playlist: currentlyPlayingPlaylist,
            track: currentTrack,
          }),
        ],
      ]
    }

    const mutations: Mutation<any>[] = []

    mutations.push(
      new RemoveTrackMutation({ playlist: current, track: currentTrack }),
    )
    mutations.push(
      new RemoveTrackMutation({ playlist: inbox, track: currentTrack }),
    )

    if (
      currentlyPlayingPlaylist &&
      currentlyPlayingPlaylist.id !== current.id &&
      currentlyPlayingPlaylist.id !== inbox.id
    ) {
      mutations.push(
        new RemoveTrackMutation({
          playlist: currentlyPlayingPlaylist,
          track: currentTrack,
        }),
      )
    }

    mutations.push(new UnsaveTrackMutation({ tracks: [currentTrack] }))
    mutations.push(
      new TriageActionMutation({
        track: currentTrack,
        actionType: 'remove',
      }),
    )

    return [mutations]
  }

  async description() {
    const player = await this.client.player
    const currentPlaylist = await this.client.currentlyPlayingPlaylist

    return `${this.type}: ${player.item?.artists[0].name} — ${
      player.item?.name
    } in ${currentPlaylist?.name ?? player.context?.type}`
  }
}
