import { Action } from './action'
import { Spotify, TrackForMove } from '../spotify'
import { MoveTrackMutation } from '../mutations/move-track-mutation'
import { SetTrackStatusMutation } from '../mutations/set-track-status-mutation'
import { settings } from '../settings'
import { Mutation } from '../mutations/mutation'
import { Dynamo, DYNAMO_WRITE_CHUNK, TrackStatusRow } from '../db/dynamo'
import { chunkArray } from '../utils/array'

/**
 * Spotify hands back `{ track: null }` for items it can no longer resolve
 * (unavailable, region-blocked, removed from the catalog), and `mySavedTracks`
 * can carry the same holes. One of those must not take the whole pass down, and
 * an id-less entry must never widen into "everything else disappeared".
 */
function idsIn(items: ({ id?: string } | null | undefined)[]) {
  return new Set(items.map((item) => item?.id).filter(Boolean))
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
    return `archive:${this.created_at}`
  }

  async forStorage(mutations: Mutation<any>[]) {
    const mutationData = mutations.map((m) => m.storage)
    const ttl = mutationData.length
      ? undefined
      : Math.floor((this.created_at + 2 * days) / 1000)

    return {
      id: await this.getID(),
      created_at: this.created_at,
      action: 'archive' as ActionTypes,
      mutations: mutationData,
      ttl,
    }
  }

  private async archiveAgedTracks(): Promise<MoveTrackMutation[]> {
    const client = this.client
    const { current, timeToArchive, archivePlaylistNameFor } = await settings()
    const now = new Date().getTime()

    // Optional rather than required: a missing Current means nothing to archive,
    // which is not a reason to take the status reconciliation down with it.
    const currentPlaylist = await client.optionalPlaylist(current)

    if (!currentPlaylist) {
      console.log(
        `[ArchiveAction] no "${current}" playlist — nothing to archive`,
      )
      return []
    }

    const tracks = await client.tracksForPlaylist(currentPlaylist)

    console.log(
      `[ArchiveAction] Processing ${tracks.length} tracks from ${currentPlaylist.name} for archiving`,
    )

    // Bucket by target *name* before resolving anything. Resolving inside the
    // loop meant one `getOrCreatePlaylist` per aged track, and `forceRefresh`
    // nulls the playlist memo — so every track after the first re-paginated
    // every playlist the account owns, for a mapping that changes at most once
    // per pass.
    const byArchiveName = new Map<string, TrackForMove[]>()

    for (let track of tracks) {
      const addedAt = new Date(track.added_at).getTime()
      if (now - addedAt <= timeToArchive) continue

      // Bucketed by when the track landed in Current, i.e. the month it was
      // promoted — not the month the archive pass happens to run.
      const targetPlaylistName = archivePlaylistNameFor(track)
      const bucket = byArchiveName.get(targetPlaylistName)

      if (bucket) {
        bucket.push(track.track)
      } else {
        byArchiveName.set(targetPlaylistName, [track.track])
      }
    }

    if (!byArchiveName.size) return []

    const mutations: MoveTrackMutation[] = []

    // Only the first lookup forces a refresh. Its job is catching an archive
    // playlist another Lambda instance created since this one cached its list,
    // and one refresh re-reads that whole list — later months then read the memo
    // it just populated.
    let listing: 'stale' | 'fresh' = 'stale'

    for (let [targetPlaylistName, archivedTracks] of byArchiveName) {
      const targetPlaylist = await client.getOrCreatePlaylist(
        targetPlaylistName,
        listing === 'stale',
      )
      listing = 'fresh'

      console.log(
        `[ArchiveAction] ${archivedTracks.length} tracks → "${targetPlaylistName}"`,
      )

      mutations.push(
        new MoveTrackMutation({
          tracks: archivedTracks,
          from: currentPlaylist,
          to: { id: targetPlaylist.id },
        }),
      )
    }

    return mutations
  }

  /**
   * Reads run before any mutation executes, so this sees the playlists as they
   * were *before* this pass archives anything.
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
  private async reconcileTrackStatus(
    rows: TrackStatusRow[],
  ): Promise<SetTrackStatusMutation[]> {
    const [inboxGone, promotedGone] = await Promise.all([
      this.inboxRowsGone(rows),
      this.promotedRowsGone(rows),
    ])

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
          changed_at: this.created_at,
        }),
    )
  }

  private async inboxRowsGone(rows: TrackStatusRow[]) {
    const claimed = rows.filter((row) => row.status === 'inbox')
    if (!claimed.length) return []

    const { inbox } = await settings()
    const inboxPlaylist = await this.client.optionalPlaylist(inbox)

    // Without the playlist there is no evidence either way, and "no evidence"
    // must not read as "every inbox track disappeared".
    if (!inboxPlaylist) {
      console.log(
        `[ArchiveAction] no "${inbox}" playlist — skipping inbox reconciliation`,
      )
      return []
    }

    const present = idsIn(
      (await this.client.tracksForPlaylist({ id: inboxPlaylist.id })).map(
        (item) => item.track,
      ),
    )

    return claimed.filter((row) => !present.has(row.id))
  }

  private async promotedRowsGone(rows: TrackStatusRow[]) {
    const claimed = rows.filter((row) => row.status === 'promoted')
    if (!claimed.length) return []

    const liked = idsIn(await this.client.mySavedTracks())

    // Same reasoning as the missing playlist above. An empty library is far more
    // likely to be a cache that failed to populate than a real state, and acting
    // on it would mark every promoted track removed in one pass.
    if (!liked.size) {
      console.log(
        '[ArchiveAction] liked songs came back empty — skipping promoted reconciliation',
      )
      return []
    }

    return claimed.filter((row) => !liked.has(row.id))
  }

  async perform({ dynamo }: { dynamo: Dynamo }) {
    // The two slowest reads of this pass hit different services — a full table
    // scan and a walk of Current — so they overlap. The reconciliation's own
    // Spotify reads stay after the archive pass rather than racing it for the
    // playlist cache that `getOrCreatePlaylist(_, forceRefresh)` resets.
    const [archiveMutations, rows] = await Promise.all([
      this.archiveAgedTracks(),
      dynamo.tracksWithLiveStatus(),
    ])

    const statusMutations = await this.reconcileTrackStatus(rows)

    // The sweep can touch an unbounded number of rows and every set runs as one
    // Promise.all, so it goes out in chunks rather than as a single fan-out that
    // throttles itself. Archive moves stay in one set — they are few and each
    // one is already a batched playlist call.
    return [
      archiveMutations,
      ...chunkArray(statusMutations, DYNAMO_WRITE_CHUNK),
    ]
  }
}
