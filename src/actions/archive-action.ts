import { Action, PerformContext } from './action'
import { PlaylistID, Spotify, TrackForMove } from '../spotify'
import { MoveTrackMutation } from '../mutations/move-track-mutation'
import { SetTrackStatusMutation } from '../mutations/set-track-status-mutation'
import { Settings } from '../settings'
import { Mutation } from '../mutations/mutation'
import { Dynamo, DYNAMO_WRITE_CHUNK, TrackStatusRow } from '../db/dynamo'
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

/**
 * `play_count_current` rides along on the candidate because the archive
 * decision needs it and Spotify carries it nowhere — it is read off the track
 * row in `gatherCurrent`. Required rather than optional so a gather shell that
 * forgets to populate it fails to compile, instead of quietly reading 0 and
 * silently reverting the whole pass to the age rule.
 *
 * `track.id` is required for the same reason: an item Spotify could not resolve
 * has no row to look up and no uri to move, so `gatherCurrent` drops it rather
 * than letting it reach the planner.
 */
export type ArchiveCandidate = {
  added_at: string
  track: TrackForMove & { id: string }
  play_count_current: number
}

/**
 * Why a track leaves Current, or that it stays.
 *
 * - 'aged-out'   — it has sat in Current longer than `timeToArchive`
 * - 'played-out' — it has been played from Current at least `playsToArchive`
 *                  times, so its rotation is done however recently it arrived
 *
 * The two are alternatives, and both file the track in exactly the same monthly
 * archive: the destination is a function of when the track was promoted, never
 * of what ended its run. This distinction exists to explain a pass in the log,
 * not to route anything.
 *
 * The boundaries are deliberately different shapes. Age is continuous, so it is
 * a strict `>` and a track sitting at exactly `timeToArchive` stays for now.
 * Plays are a discrete count of things that already happened, so the Nth play
 * is the one that triggers: `>=`.
 *
 * Two properties of `play_count_current` this rule inherits rather than fixes:
 * it only counts plays whose Spotify playback context *was* the Current
 * playlist — a listen from Liked Songs or search moves a track no closer to
 * archiving — and it is cumulative and never reset, so a track re-promoted into
 * Current after an archive arrives already over the threshold and leaves again
 * on the next pass.
 */
export type ArchiveVerdict = 'keep' | 'aged-out' | 'played-out'

export function archiveVerdict({
  now,
  timeToArchive,
  playsToArchive,
  candidate,
}: {
  now: number
  timeToArchive: number
  playsToArchive: number
  candidate: ArchiveCandidate
}): ArchiveVerdict {
  if (now - new Date(candidate.added_at).getTime() > timeToArchive) {
    return 'aged-out'
  }

  if (candidate.play_count_current >= playsToArchive) return 'played-out'

  return 'keep'
}

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
  playsToArchive: number
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
  playsToArchive,
  tracks,
  archiveNamer,
}: {
  now: number
  timeToArchive: number
  playsToArchive: number
  tracks: ArchiveCandidate[]
  archiveNamer: Settings['archivePlaylistNameFor']
}) {
  const byArchiveName = new Map<string, TrackForMove[]>()
  const verdicts: Record<Exclude<ArchiveVerdict, 'keep'>, number> = {
    'aged-out': 0,
    'played-out': 0,
  }

  for (let track of tracks) {
    const verdict = archiveVerdict({
      now,
      timeToArchive,
      playsToArchive,
      candidate: track,
    })

    if (verdict === 'keep') continue

    verdicts[verdict] += 1

    // Bucketed by when the track landed in Current, i.e. the month it was
    // promoted — not the month the archive pass happens to run, and not by
    // which of the two triggers ended its run. A played-out track and an aged
    // -out one promoted in the same month share a destination.
    const targetPlaylistName = archiveNamer(track)
    const bucket = byArchiveName.get(targetPlaylistName)

    if (bucket) {
      bucket.push(track.track)
    } else {
      byArchiveName.set(targetPlaylistName, [track.track])
    }
  }

  return { byArchiveName, verdicts }
}

function archiveAgedTracks({
  now,
  timeToArchive,
  playsToArchive,
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

  const { byArchiveName, verdicts } = archiveBuckets({
    now,
    timeToArchive,
    playsToArchive,
    tracks: current.tracks,
    archiveNamer,
  })

  console.log(
    `[ArchiveAction] ${verdicts['aged-out']} aged out (> ${timeToArchive}ms in ${current.name}), ${verdicts['played-out']} played out (>= ${playsToArchive} plays from ${current.name})`,
  )

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
    dynamo,
    name,
    now,
    timeToArchive,
    playsToArchive,
    archiveNamer,
  }: {
    dynamo: Dynamo
    name: string
    now: number
    timeToArchive: number
    playsToArchive: number
    archiveNamer: Settings['archivePlaylistNameFor']
  }): Promise<CurrentEvidence> {
    // Optional rather than required: the reconciliation below has its own
    // evidence and runs whether or not Current resolves.
    const currentPlaylist = await this.client.optionalPlaylist(name)

    if (!currentPlaylist) return { listing: 'unavailable', name }

    const tracks = await this.archiveCandidates(
      dynamo,
      await this.client.tracksForPlaylist(currentPlaylist),
    )

    return {
      listing: 'read',
      name: currentPlaylist.name,
      playlist: { id: currentPlaylist.id },
      tracks,
      archivePlaylists: await this.archivePlaylists(
        archiveBuckets({
          now,
          timeToArchive,
          playsToArchive,
          tracks,
          archiveNamer,
        }).byArchiveName.keys(),
      ),
    }
  }

  /**
   * The play-count trigger reads `play_count_current`, which lives on the track
   * row and on nothing Spotify returns. `tracksWithLiveStatus` cannot supply it
   * either — that scan projects `id` and `status` only — so this is a separate
   * keyed read over exactly the tracks currently in Current.
   *
   * An item Spotify could not resolve (`{ track: null }`, region-blocked,
   * pulled from the catalog) has no id to look a row up by and no uri to move,
   * so it is dropped here rather than carried into the planner as a candidate
   * that could never be archived anyway.
   */
  private async archiveCandidates(
    dynamo: Dynamo,
    items: Awaited<ReturnType<Spotify['tracksForPlaylist']>>,
  ): Promise<ArchiveCandidate[]> {
    const resolvable: {
      added_at: string
      track: TrackForMove & { id: string }
    }[] = []

    for (let item of items) {
      const track = item?.track

      if (!track?.id || !track.uri) continue

      resolvable.push({
        added_at: item.added_at,
        track: { uri: track.uri, id: track.id },
      })
    }

    const rows = await dynamo.getTracks(
      resolvable.map((candidate) => candidate.track.id),
    )

    return resolvable.map(({ added_at, track }) => ({
      added_at,
      track,
      // No row, or a row predating the per-stage counters, means no listen has
      // ever been attributed to Current — which is 0, not unknown.
      play_count_current: rows[track.id]?.play_count_current ?? 0,
    }))
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
    const {
      inbox,
      current,
      timeToArchive,
      playsToArchive,
      archivePlaylistNameFor,
    } = settings

    // The two slowest reads of this pass hit different services — a full table
    // scan and a walk of Current — so they overlap. The reconciliation's own
    // Spotify reads stay after the archive reads rather than racing them for the
    // playlist cache that `getOrCreatePlaylist(_, forceRefresh)` resets.
    const [currentEvidence, liveStatusRows] = await Promise.all([
      this.gatherCurrent({
        dynamo,
        name: current,
        now,
        timeToArchive,
        playsToArchive,
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
      playsToArchive,
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
