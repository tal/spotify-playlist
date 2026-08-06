import { AddTrackMutation } from '../mutations/add-track-mutation'
import { Mutation } from '../mutations/mutation'
import { TriageActionMutation } from '../mutations/triage-action-mutation'
import { PlaylistID, Spotify } from '../spotify'
import { Action, PerformContext } from './action'
import { getTriageInfo } from './actionable-type'

type PlaylistTrack = import('spotify-web-api-node').PlaylistTrack

/**
 * Everything `inboxPlan` decides from. `seenTrackIds` are the tracks the `track`
 * table already knows — the record of "this has been triaged before", which
 * survives the track leaving every playlist — and `inboxTrackIds` is Inbox as it
 * stands right now.
 */
export interface InboxSnapshot {
  playlistTracks: PlaylistTrack[]
  seenTrackIds: string[]
  inboxTrackIds: string[]
  inbox: PlaylistID
  now: number
  trackFilter?: (track: PlaylistTrack) => boolean
}

/**
 * A track earns a place in Inbox only if the filter keeps it, nothing in the
 * `track` table has seen it, and Inbox does not already hold it. Each survivor
 * gets an `'inboxed'` triage action so the next run counts it as seen.
 */
export function inboxPlan(snapshot: InboxSnapshot): Mutation<any>[][] {
  const { playlistTracks, inbox, now, trackFilter } = snapshot

  const skip = new Set([...snapshot.seenTrackIds, ...snapshot.inboxTrackIds])

  const candidates = trackFilter
    ? playlistTracks.filter(trackFilter)
    : playlistTracks

  const tracks: { id: string; uri: string }[] = []
  for (let { track } of candidates) {
    // A source playlist can list the same track twice; adding to `skip` as we
    // go keeps the second copy from earning its own pair of mutations.
    if (skip.has(track.id)) continue
    skip.add(track.id)

    tracks.push({ id: track.id, uri: track.uri })
  }

  if (tracks.length === 0) return []

  return [
    [
      new AddTrackMutation({ tracks, playlist: inbox }),
      ...tracks.map(
        ({ id }) =>
          new TriageActionMutation({
            track: { id },
            actionType: 'inboxed',
            action_at: now,
          }),
      ),
    ],
  ]
}

export class AddPlaylistToInbox implements Action {
  type: string = 'add-playlist-to-inbox'
  // readonly idThrottleMs = 20 * minutes
  readonly playlistID: string
  readonly created_at: number
  spotify: Spotify

  constructor(
    client: Spotify,
    { id: playlistID }: { id: string; type?: 'playlist' },
    readonly trackFilter?: (track: PlaylistTrack) => boolean,
  ) {
    this.spotify = client
    this.playlistID = playlistID
    this.created_at = new Date().getTime()
  }

  async getID() {
    return `inbox-playlist:${this.playlistID}`
  }

  async gather({ dynamo }: PerformContext): Promise<InboxSnapshot> {
    const playlistTracks = await this.spotify.tracksForPlaylist({
      id: this.playlistID,
    })

    const seenTracks = await dynamo.getSeenTracks(
      playlistTracks.map((t) => t.track.id),
    )

    const { inbox } = await getTriageInfo(this.spotify)
    const inboxTracks = await this.spotify.tracksForPlaylist({ id: inbox.id })

    return {
      playlistTracks,
      seenTrackIds: seenTracks.filter((t) => t.found).map((t) => t.id),
      inboxTrackIds: inboxTracks.map((t) => t.track.id),
      inbox,
      now: this.created_at,
      trackFilter: this.trackFilter,
    }
  }

  async perform(ctx: PerformContext): Promise<Mutation<any>[][]> {
    return inboxPlan(await this.gather(ctx))
  }

  async forStorage(mutations: Mutation<any>[]): Promise<ActionHistoryItemData> {
    const mutationData = mutations.map((m) => m.storage)
    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'add-playlist-to-inbox' as const,
      mutations: mutationData,
    }
  }
}
