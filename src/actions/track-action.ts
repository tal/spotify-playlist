import { Action, PerformContext, ThrottleWindow } from './action'
import { Spotify, PlaylistID, displayTrack } from '../spotify'
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

export type Membership = 'present' | 'absent'
export type PlayerState = 'playing' | 'not-playing'

function membershipOf(found: unknown): Membership {
  return found ? 'present' : 'absent'
}

type TriageStates = 'unheard' | 'liked' | 'confirmed'

export interface TriageMembership {
  inbox: Membership
  current: Membership
  saved: Membership
}

function triageStatesEqual(
  t1: TriageMembership,
  t2: TriageMembership,
): boolean {
  return (
    t1.current === t2.current && t1.inbox === t2.inbox && t1.saved === t2.saved
  )
}

function isTriageState(key: string): key is TriageStates {
  return key === 'unheard' || key === 'liked' || key === 'confirmed'
}

const triageStates: { [k in TriageStates]: TriageMembership } = {
  unheard: {
    inbox: 'present',
    current: 'absent',
    saved: 'absent',
  },
  liked: {
    inbox: 'present',
    current: 'absent',
    saved: 'present',
  },
  confirmed: {
    inbox: 'absent',
    current: 'present',
    saved: 'present',
  },
}

function triageStateName(state: TriageMembership): TriageStates {
  for (let key in triageStates) {
    if (isTriageState(key)) {
      const compState = triageStates[key]
      if (triageStatesEqual(compState, state)) {
        return key
      }
    }
  }

  if (state.saved === 'present') {
    return 'liked'
  } else {
    return 'unheard'
  }
}

export function promotedMembership(state: TriageMembership): TriageMembership {
  const name = triageStateName(state)

  if (!name) {
    throw `cannot find triage state for ${JSON.stringify(state)}`
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

/**
 * Everything `promotePlan` decides from. Gathered once by the shell so the
 * planner reads no player, no playlist and no library.
 */
export interface PromoteSnapshot {
  player: PlayerState
  track: BasicTrackData
  membership: TriageMembership
  playlists: { inbox: PlaylistID; current: PlaylistID }
  now: number
}

/**
 * Everything `demotePlan` decides from. Demoting never consults the triage
 * state — it strips the track out of wherever it is — so it carries neither
 * `player` nor `membership`.
 */
export interface DemoteSnapshot {
  track: BasicTrackData
  playlists: { inbox: PlaylistID; current: PlaylistID; starred?: PlaylistID }
  playingFrom?: PlaylistID
  starredMembership: Membership
  now: number
}

export type TriageSnapshot = PromoteSnapshot & DemoteSnapshot

export function promotePlan(snapshot: PromoteSnapshot): Mutation<any>[][] {
  const { player, track, membership, playlists, now } = snapshot

  if (player !== 'playing') throw `player must be playing`

  const promoted = promotedMembership(membership)

  const mutations: Mutation<any>[] = []

  if (membership.current !== promoted.current) {
    if (promoted.current === 'present') {
      mutations.push(
        new AddTrackMutation({ tracks: [track], playlist: playlists.current }),
      )
      mutations.push(
        new TriageActionMutation({
          track,
          actionType: 'promote',
          action_at: now,
        }),
      )
    } else {
      mutations.push(
        new RemoveTrackMutation({ track, playlist: playlists.current }),
      )
    }
  }

  if (membership.inbox !== promoted.inbox) {
    if (promoted.inbox === 'present') {
      mutations.push(
        new AddTrackMutation({ tracks: [track], playlist: playlists.inbox }),
      )
      mutations.push(
        new TriageActionMutation({
          track,
          actionType: 'inboxed',
          action_at: now,
        }),
      )
    } else {
      mutations.push(
        new RemoveTrackMutation({ track, playlist: playlists.inbox }),
      )
    }
  }

  if (membership.saved !== promoted.saved) {
    if (promoted.saved === 'present') {
      mutations.push(new SaveTrackMutation({ tracks: [track] }))
    } else {
      mutations.push(new UnsaveTrackMutation({ tracks: [track] }))
    }
  }

  mutations.push(
    new TriageActionMutation({ track, actionType: 'upvote', action_at: now }),
  )

  return [mutations]
}

export function demotePlan(snapshot: DemoteSnapshot): Mutation<any>[][] {
  const { track, playlists, playingFrom, starredMembership, now } = snapshot
  const { inbox, current, starred } = playlists

  if (playingFrom && playingFrom.id === starred?.id) {
    return [[new RemoveTrackMutation({ playlist: playingFrom, track })]]
  }

  const mutations: Mutation<any>[] = []

  mutations.push(new RemoveTrackMutation({ playlist: current, track }))
  mutations.push(new RemoveTrackMutation({ playlist: inbox, track }))

  if (
    playingFrom &&
    playingFrom.id !== current.id &&
    playingFrom.id !== inbox.id
  ) {
    mutations.push(new RemoveTrackMutation({ playlist: playingFrom, track }))
  }

  // If the track lives in the Starred playlist, demoting just pulls it out of
  // Starred and leaves it liked. Otherwise it gets unsaved from the library.
  if (starredMembership === 'present' && starred) {
    mutations.push(new RemoveTrackMutation({ playlist: starred, track }))
  } else {
    mutations.push(new UnsaveTrackMutation({ tracks: [track] }))
  }

  mutations.push(
    new TriageActionMutation({ track, actionType: 'remove', action_at: now }),
  )

  return [mutations]
}

export type AfterTrackActionAction = 'nothing' | 'skip-track'

export interface TrackIdentity {
  trackID?: string
  trackURI?: string
}

/**
 * Resolves what is playing right now, once, so the action that follows can name
 * itself without asking again — `getID()` runs up to three times per invocation
 * and must not be a Spotify call.
 *
 * Only the uri travels. A `trackID` would redirect `track()` away from the live
 * player and onto a `getTrack` fetch, which is a different track resolution,
 * not just a cheaper one — the caller here means "whatever is playing".
 *
 * The retry is the one `gatherDemote` carries: a player read taken right after a
 * track change comes back empty often enough to be worth one refetch. The
 * @asyncMemoize decorator stores its cache on `__mem_<propertyKey>`.
 */
export async function currentTrackIdentity(
  client: Spotify,
): Promise<TrackIdentity> {
  let track = await client.currentTrack

  if (!track) {
    ;(client as any).__mem_player = null
    await delay(85)
    track = await client.currentTrack
  }

  if (!track) return {}

  return { trackURI: track.uri }
}

export abstract class TrackAction implements Action {
  abstract forStorage(
    mutations: Mutation<any>[],
  ): Promise<ActionHistoryItemData>
  abstract getID(): Promise<string>
  abstract perform(ctx: PerformContext): Promise<Mutation<any>[][]>

  idThrottleMs?: ThrottleWindow | undefined
  private trackID?: string
  /**
   * The identity `getID()` reads. A caller that only knows "whatever is
   * playing" hands over the uri alone, which leaves `track()` resolving the
   * live player exactly as before; a caller acting on a specific track (undo)
   * hands over the id too.
   *
   * Not readonly: the live-player gather adopts the track it resolves when the
   * shell's own player read came back empty, so the action can always name what
   * it acted on.
   */
  protected trackURI?: string
  public created_at: number
  abstract type: string

  constructor(
    protected readonly client: Spotify,
    { trackID, trackURI }: TrackIdentity = {},
  ) {
    this.trackID = trackID
    this.trackURI =
      trackURI ?? (trackID ? `spotify:track:${trackID}` : undefined)
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

  async gatherPromote(client: Spotify = this.client): Promise<PromoteSnapshot> {
    const player = await client.player

    const currentTrack = await this.track()
    if (!currentTrack) throw 'no track provided 2'
    console.log(`🏃 Magic Promote: ${displayTrack(currentTrack)}`)

    const { inbox, current } = await getTriageInfo(client)

    const trackInInbox = client.trackInPlaylist(currentTrack, inbox)
    const trackInCurrent = client.trackInPlaylist(currentTrack, current)
    const trackIsSaved = client.trackIsSaved(currentTrack)

    return {
      player: player.is_playing ? 'playing' : 'not-playing',
      track: trackToData(currentTrack)!,
      membership: {
        saved: membershipOf(await trackIsSaved),
        current: membershipOf(await trackInCurrent),
        inbox: membershipOf(await trackInInbox),
      },
      playlists: { inbox, current },
      now: this.created_at,
    }
  }

  /**
   * A caller that named a track — undo replaying a stored `action_history` row
   * — gets that track. A caller that meant "whatever is playing" gets the
   * player, plus the one refetch a read taken right after a track change needs.
   *
   * That retry can find a track the shell's `currentTrackIdentity` missed, so
   * the identity is adopted here: without it the demote lands and then
   * `getID()` throws on a uri the action never learned, leaving no history row
   * and nothing to undo.
   */
  private async demoteTarget(client: Spotify): Promise<Track | undefined> {
    if (this.trackID) return await this.track()

    let currentTrack = await client.currentTrack
    if (!currentTrack) {
      // Clear the memoized player cache so the retry fetches fresh state.
      // The @asyncMemoize decorator stores its cache on `__mem_<propertyKey>`.
      ;(client as any).__mem_player = null
      await delay(85)
      currentTrack = await client.currentTrack
    }

    this.trackURI ??= currentTrack?.uri

    return currentTrack
  }

  async gatherDemote(client: Spotify = this.client): Promise<DemoteSnapshot> {
    const currentTrack = await this.demoteTarget(client)
    if (!currentTrack) throw 'no track provided 3'

    const { inbox, current, starred } = await getTriageInfo(client)
    // Where the player sits says nothing about a track named by id: a reversal
    // that read it would strip the row's track out of an unrelated playlist,
    // and — if that playlist were Starred — would short-circuit the demote it
    // was asked for.
    const playingFrom = this.trackID
      ? undefined
      : await client.currentlyPlayingPlaylist
    const inStarred = starred
      ? await client.trackInPlaylist(currentTrack, starred)
      : undefined

    return {
      track: trackToData(currentTrack)!,
      playlists: { inbox, current, starred },
      playingFrom,
      starredMembership: membershipOf(inStarred),
      now: this.created_at,
    }
  }

  async description() {
    const player = await this.client.player
    const currentPlaylist = await this.client.currentlyPlayingPlaylist

    return `${this.type}: ${player.item?.artists[0].name} — ${
      player.item?.name
    } in ${currentPlaylist?.name ?? player.context?.type}`
  }
}
