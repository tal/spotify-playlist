import { Action, PerformContext } from './action'
import { PlaylistID, Spotify, TrackForMove } from '../spotify'
import { MoveTrackMutation } from '../mutations/move-track-mutation'
import { SetTrackStatusMutation } from '../mutations/set-track-status-mutation'
import { Settings } from '../settings'
import { Mutation } from '../mutations/mutation'
import { DYNAMO_WRITE_CHUNK, TrackStatusRow } from '../db/dynamo'
import { chunkArray } from '../utils/array'

/**
 * Spotify hands back `{ track: null }` for items it can no longer resolve
 * (unavailable, region-blocked, removed from the catalog), and `mySavedTracks`
 * can carry the same holes. One of those must not take the whole pass down, and
 * an id-less entry must never widen into "everything else disappeared".
 */
export function idsIn(items: ({ id?: string } | null | undefined)[]) {
  return new Set(items.flatMap((item) => (item?.id ? [item.id] : [])))
}

const DAY_MS = 1000 * 60 * 60 * 24

/**
 * The id has to be the same string on every run for `getActionHistory` — an
 * exact-match query on it — to ever find the previous pass, which is what the
 * throttle is. Keyed on the month rather than the clock: `action_history` is
 * (id, created_at), so repeated runs still write their own rows, and the
 * throttle window decides freshness instead of id uniqueness.
 */
export function archivePeriod(at: number) {
  const date = new Date(at)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')

  return `${date.getFullYear()}-${month}`
}

export type ArchiveCandidate = { added_at: string; track: TrackForMove }

/**
 * "Could not read" is kept distinct from "read and found nothing", because the
 * two mean opposite things to the reconciliation: a playlist that failed to
 * resolve is no evidence at all about the rows claiming to live in it, while
 * one that came back empty is evidence that every one of them is gone.
 *
 * `archivePlaylists` maps target name → the playlist that name resolved to.
 * Deciding which names a pass needs is planning; creating or looking them up is
 * I/O, so the ids arrive already resolved and the planner only pairs them up.
 */
export type CurrentEvidence =
  | { listing: 'unavailable'; name: string }
  | {
      listing: 'read'
      name: string
      playlist: PlaylistID
      tracks: ArchiveCandidate[]
      archivePlaylists: Map<string, PlaylistID>
    }

export type InboxEvidence =
  | { listing: 'unavailable'; name: string }
  | { listing: 'read'; name: string; trackIds: Set<string> }

export interface ArchiveSnapshot {
  now: number
  changed_at: number
  timeToArchive: number
  archiveNamer: Settings['archivePlaylistNameFor']
  current: CurrentEvidence
  inbox: InboxEvidence
  savedTrackIds: Set<string>
  liveStatusRows: TrackStatusRow[]
}

/**
 * Bucket by target *name*, never by resolved playlist. Resolving inside the
 * loop meant one `getOrCreatePlaylist` per aged track, and `forceRefresh` nulls
 * the playlist memo — so every track after the first re-paginated every
 * playlist the account owns, for a mapping that changes at most once per pass.
 */
function archiveBuckets({
  now,
  timeToArchive,
  tracks,
  archiveNamer,
}: {
  now: number
  timeToArchive: number
  tracks: ArchiveCandidate[]
  archiveNamer: Settings['archivePlaylistNameFor']
}) {
  const byArchiveName = new Map<string, TrackForMove[]>()

  for (let track of tracks) {
    const addedAt = new Date(track.added_at).getTime()
    if (now - addedAt <= timeToArchive) continue

    // Bucketed by when the track landed in Current, i.e. the month it was
    // promoted — not the month the archive pass happens to run.
    const targetPlaylistName = archiveNamer(track)
    const bucket = byArchiveName.get(targetPlaylistName)

    if (bucket) {
      bucket.push(track.track)
    } else {
      byArchiveName.set(targetPlaylistName, [track.track])
    }
  }

  return byArchiveName
}

function archiveAgedTracks({
  now,
  timeToArchive,
  archiveNamer,
  current,
}: ArchiveSnapshot): MoveTrackMutation[] {
  // A missing Current means nothing to archive, which is not a reason to take
  // the status reconciliation down with it.
  if (current.listing === 'unavailable') {
    console.log(
      `[ArchiveAction] no "${current.name}" playlist — nothing to archive`,
    )
    return []
  }

  console.log(
    `[ArchiveAction] Processing ${current.tracks.length} tracks from ${current.name} for archiving`,
  )

  const byArchiveName = archiveBuckets({
    now,
    timeToArchive,
    tracks: current.tracks,
    archiveNamer,
  })

  const mutations: MoveTrackMutation[] = []

  for (let [targetPlaylistName, archivedTracks] of byArchiveName) {
    const targetPlaylist = current.archivePlaylists.get(targetPlaylistName)

    // A name with no playlist behind it is a resolution that never happened.
    // The tracks stay in Current and age out again next pass, which is the
    // recoverable half of that failure — moving them nowhere is not.
    if (!targetPlaylist) continue

    console.log(
      `[ArchiveAction] ${archivedTracks.length} tracks → "${targetPlaylistName}"`,
    )

    mutations.push(
      new MoveTrackMutation({
        tracks: archivedTracks,
        from: current.playlist,
        to: targetPlaylist,
      }),
    )
  }

  return mutations
}

function inboxRowsGone(rows: TrackStatusRow[], inbox: InboxEvidence) {
  const claimed = rows.filter((row) => row.status === 'inbox')
  if (!claimed.length) return []

  // Without the playlist there is no evidence either way, and "no evidence"
  // must not read as "every inbox track disappeared".
  if (inbox.listing === 'unavailable') {
    console.log(
      `[ArchiveAction] no "${inbox.name}" playlist — skipping inbox reconciliation`,
    )
    return []
  }

  return claimed.filter((row) => !inbox.trackIds.has(row.id))
}

function promotedRowsGone(rows: TrackStatusRow[], savedTrackIds: Set<string>) {
  const claimed = rows.filter((row) => row.status === 'promoted')
  if (!claimed.length) return []

  // Same reasoning as the missing playlist above. An empty library is far more
  // likely to be a cache that failed to populate than a real state, and acting
  // on it would mark every promoted track removed in one pass.
  if (!savedTrackIds.size) {
    console.log(
      '[ArchiveAction] liked songs came back empty — skipping promoted reconciliation',
    )
    return []
  }

  return claimed.filter((row) => !savedTrackIds.has(row.id))
}

/**
 * The snapshot is read before any mutation executes, so this sees the playlists
 * as they were *before* this pass archives anything.
 *
 * The two live statuses reconcile against different things:
 *
 * - 'inbox'    — Inbox membership. An inbox track absent from Inbox is gone.
 * - 'promoted' — liked status, *not* presence in Current. Reaching Current
 *                always means the track was saved to the library, and it
 *                leaves Current legitimately all the time — archived by this
 *                very pass, or hand-moved to Starred, which is curation, not
 *                deletion. Being unliked is what actually marks it dropped.
 *
 * Rows with no status predate the field; leave them alone rather than guess.
 */
function reconcileTrackStatus({
  liveStatusRows,
  inbox,
  savedTrackIds,
  changed_at,
}: ArchiveSnapshot): SetTrackStatusMutation[] {
  const inboxGone = inboxRowsGone(liveStatusRows, inbox)
  const promotedGone = promotedRowsGone(liveStatusRows, savedTrackIds)

  const removed = [...inboxGone, ...promotedGone]

  if (!removed.length) {
    console.log('[ArchiveAction] no track statuses to reconcile')
    return []
  }

  console.log(
    `[ArchiveAction] marking ${removed.length} rows removed (${inboxGone.length} gone from Inbox, ${promotedGone.length} no longer liked)`,
  )

  return removed.map(
    (row) =>
      new SetTrackStatusMutation({
        track: { id: row.id },
        status: 'removed',
        changed_at,
      }),
  )
}

export function archivePlan(snapshot: ArchiveSnapshot): Mutation<any>[][] {
  const archiveMutations = archiveAgedTracks(snapshot)
  const statusMutations = reconcileTrackStatus(snapshot)

  // The sweep can touch an unbounded number of rows and every set runs as one
  // Promise.all, so it goes out in chunks rather than as a single fan-out that
  // throttles itself. Archive moves stay in one set — they are few and each
  // one is already a batched playlist call.
  return [archiveMutations, ...chunkArray(statusMutations, DYNAMO_WRITE_CHUNK)]
}

/**
 * Two jobs, both keyed to the same pass:
 *
 * 1. Move tracks that have aged out of Current into their monthly archive.
 * 2. Detect triage changes made outside the official actions — anything we have
 *    a row for that has quietly stopped being tracked gets marked 'removed'.
 */
export class ArchiveAction implements Action {
  type: string = 'archive'
  idThrottleMs: number = 60 * 1000
  public created_at: number

  constructor(private client: Spotify) {
    this.created_at = new Date().getTime()
  }

  async getID() {
    return `archive:${archivePeriod(this.created_at)}`
  }

  async forStorage(mutations: Mutation<any>[]) {
    const mutationData = mutations.map((m) => m.storage)
    const ttl = mutationData.length
      ? undefined
      : Math.floor((this.created_at + 2 * DAY_MS) / 1000)

    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'archive' as ActionTypes,
      mutations: mutationData,
      ttl,
    }
  }

  private async gatherCurrent({
    name,
    now,
    timeToArchive,
    archiveNamer,
  }: {
    name: string
    now: number
    timeToArchive: number
    archiveNamer: Settings['archivePlaylistNameFor']
  }): Promise<CurrentEvidence> {
    // Optional rather than required: the reconciliation below has its own
    // evidence and runs whether or not Current resolves.
    const currentPlaylist = await this.client.optionalPlaylist(name)

    if (!currentPlaylist) return { listing: 'unavailable', name }

    const tracks = await this.client.tracksForPlaylist(currentPlaylist)

    return {
      listing: 'read',
      name: currentPlaylist.name,
      playlist: { id: currentPlaylist.id },
      tracks,
      archivePlaylists: await this.archivePlaylists(
        archiveBuckets({ now, timeToArchive, tracks, archiveNamer }).keys(),
      ),
    }
  }

  private async archivePlaylists(names: Iterable<string>) {
    const resolved = new Map<string, PlaylistID>()

    // Only the first lookup forces a refresh. Its job is catching an archive
    // playlist another Lambda instance created since this one cached its list,
    // and one refresh re-reads that whole list — later months then read the memo
    // it just populated.
    let listing: 'stale' | 'fresh' = 'stale'

    for (let name of names) {
      const playlist = await this.client.getOrCreatePlaylist(
        name,
        listing === 'stale',
      )
      listing = 'fresh'

      resolved.set(name, { id: playlist.id })
    }

    return resolved
  }

  /**
   * Nothing claiming 'inbox' means the planner reaches its answer from the rows
   * alone, so the playlist read is worth skipping entirely — and an unread
   * playlist is exactly what 'unavailable' says.
   */
  private async gatherInbox(
    name: string,
    rows: TrackStatusRow[],
  ): Promise<InboxEvidence> {
    if (!rows.some((row) => row.status === 'inbox')) {
      return { listing: 'unavailable', name }
    }

    const inboxPlaylist = await this.client.optionalPlaylist(name)

    if (!inboxPlaylist) return { listing: 'unavailable', name }

    const tracks = await this.client.tracksForPlaylist({ id: inboxPlaylist.id })

    return {
      listing: 'read',
      name,
      trackIds: idsIn(tracks.map((item) => item.track)),
    }
  }

  private async gatherSavedTrackIds(rows: TrackStatusRow[]) {
    if (!rows.some((row) => row.status === 'promoted')) return new Set<string>()

    return idsIn(await this.client.mySavedTracks())
  }

  async gather({
    dynamo,
    now,
    settings,
  }: PerformContext): Promise<ArchiveSnapshot> {
    const { inbox, current, timeToArchive, archivePlaylistNameFor } = settings

    // The two slowest reads of this pass hit different services — a full table
    // scan and a walk of Current — so they overlap. The reconciliation's own
    // Spotify reads stay after the archive reads rather than racing them for the
    // playlist cache that `getOrCreatePlaylist(_, forceRefresh)` resets.
    const [currentEvidence, liveStatusRows] = await Promise.all([
      this.gatherCurrent({
        name: current,
        now,
        timeToArchive,
        archiveNamer: archivePlaylistNameFor,
      }),
      dynamo.tracksWithLiveStatus(),
    ])

    const [inboxEvidence, savedTrackIds] = await Promise.all([
      this.gatherInbox(inbox, liveStatusRows),
      this.gatherSavedTrackIds(liveStatusRows),
    ])

    return {
      now,
      changed_at: this.created_at,
      timeToArchive,
      archiveNamer: archivePlaylistNameFor,
      current: currentEvidence,
      inbox: inboxEvidence,
      savedTrackIds,
      liveStatusRows,
    }
  }

  async perform(ctx: PerformContext) {
    return archivePlan(await this.gather(ctx))
  }
}
