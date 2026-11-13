import type { PerformContext } from '../actions/action'
import { albumArt } from '../album-art'
import { DAY_MS } from '../settings'
import { archivePeriod } from '../actions/archive-action'

/**
 * A lane on the track-detail swimlane: the user-facing triage progression
 * `Unheard → Liked → Current → Archived`, plus `Removed` as the exit.
 */
export type TrackStage =
  'unheard' | 'liked' | 'current' | 'archived' | 'removed'

/** Where the event's evidence came from, so the UI can say how sure it is. */
export type EventSource =
  'triage-log' | 'action-history' | 'playlist' | 'status'

/**
 * One archiving of the track. `action-history` = an `ArchiveAction` run's
 * stored `move-track` mutation (the run's `created_at`); `playlist` = the
 * archive playlist's `added_at`, the fallback for hand-filed tracks.
 */
export type ArchiveEvidence = {
  playlist: string
  at: string
  source: 'action-history' | 'playlist'
}

export type TrackEventKind =
  'inboxed' | 'liked' | 'promoted' | 'archived' | 'removed' | 'dropped'

/**
 * `contradicted` = the stored evidence disagrees with live Spotify state (a
 * `status: 'removed'` row for a track that is still in Inbox/Current/an
 * archive). Shown in the list, but never drawn as a stage transition.
 */
export type EventStanding = 'consistent' | 'contradicted'

export type TrackEvent = {
  kind: TrackEventKind
  standing: EventStanding
  /** ISO timestamp. */
  at: string
  /** The stage this event moves the track into. */
  stage: TrackStage
  source: EventSource
  /** Archive playlist name, for `archived`. */
  playlist?: string
}

export type StageSegment = {
  stage: TrackStage
  start: string
  /** null = still in this stage now. */
  end: string | null
}

/** Membership of one playlist, with Spotify's `added_at` for that item. */
export type PlaylistPresence = { addedAt: string } | null

export type TrackSnapshot = {
  track: {
    id: string
    uri: string
    name: string
    artist: string
    album: string
    image: string | null
    cover: string | null
  }
  record: TrackItem | undefined
  inbox: PlaylistPresence
  current: PlaylistPresence
  archives: ArchiveEvidence[]
  /** Spotify playlist id → name, for `'archive'` log entries. */
  playlistNames: Record<string, string>
  saved: 'saved' | 'unsaved'
  now: number
  timeToArchive: number
  playsToArchive: number
}

const iso = (ms: number) => new Date(ms).toISOString()

/**
 * The triage log, plus live playlist state, as an ordered list of stage
 * transitions. Rules, mirroring how the write paths record things:
 *
 * - `'promote'` → Current. `promotePlan()` pushes `'upvote'` on *every* promote
 *   with the same `action_at`, so an `'upvote'` with a matching `'promote'` is
 *   not a separate like. A lone `'upvote'` is the Unheard → Liked step.
 * - `'inboxed'` → Unheard, `'remove'` → Removed.
 * - Live playlists fill gaps the log can't: a Current/Inbox item with no
 *   matching log entry (hand-edited in Spotify and not yet backfilled) and the
 *   archive playlist addition (archiving writes no triage action at all).
 * - `status: 'removed'` with no `'remove'` entry after it is a reconciliation
 *   drop — the track vanished without an explicit demote.
 */
export function trackEvents(snapshot: TrackSnapshot): TrackEvent[] {
  const actions = [...(snapshot.record?.triage_actions ?? [])].sort(
    (a, b) => a.action_at - b.action_at,
  )
  const promoteTimes = new Set(
    actions.filter((a) => a.action_type === 'promote').map((a) => a.action_at),
  )
  const events: TrackEvent[] = []
  for (const action of actions) {
    const at = iso(action.action_at)
    switch (action.action_type) {
      case 'inboxed':
        events.push({
          kind: 'inboxed',
          at,
          stage: 'unheard',
          source: 'triage-log',
          standing: 'consistent',
        })
        break
      case 'promote':
        events.push({
          kind: 'promoted',
          at,
          stage: 'current',
          source: 'triage-log',
          standing: 'consistent',
        })
        break
      case 'upvote': {
        // A lone upvote is the Unheard → Liked step only while the track is
        // still before Liked. Promoting a track already in Current changes no
        // membership, so promotePlan logs just the upvote — not a step back.
        const before = events.at(-1)?.stage
        const advances =
          before === undefined || before === 'unheard' || before === 'removed'
        if (advances && !promoteTimes.has(action.action_at))
          events.push({
            kind: 'liked',
            at,
            stage: 'liked',
            source: 'triage-log',
            standing: 'consistent',
          })
        break
      }
      case 'archive':
        events.push({
          kind: 'archived',
          at,
          stage: 'archived',
          source: 'triage-log',
          standing: 'consistent',
          ...(action.context_playlist_id
            ? {
                playlist:
                  snapshot.playlistNames[action.context_playlist_id] ??
                  action.context_playlist_id,
              }
            : {}),
        })
        break
      case 'remove':
        events.push({
          kind: 'removed',
          at,
          stage: 'removed',
          source: 'triage-log',
          standing: 'consistent',
        })
        break
    }
  }

  const latestOf = (kind: TrackEventKind) =>
    events.filter((e) => e.kind === kind).at(-1)

  // Live membership the log hasn't caught up with yet. Only add it when the
  // log's latest matching event predates the playlist addition.
  const { current, inbox, archives } = snapshot
  if (current) {
    const logged = latestOf('promoted')
    if (!logged || Date.parse(logged.at) < Date.parse(current.addedAt) - 60_000)
      events.push({
        kind: 'promoted',
        at: current.addedAt,
        stage: 'current',
        source: 'playlist',
        standing: 'consistent',
      })
  }
  if (inbox) {
    const logged = latestOf('inboxed')
    if (!logged || Date.parse(logged.at) < Date.parse(inbox.addedAt) - 60_000)
      events.push({
        kind: 'inboxed',
        at: inbox.addedAt,
        stage: 'unheard',
        source: 'playlist',
        standing: 'consistent',
      })
  }
  // History/playlist evidence for an archive the log already has is the same
  // archive — the log entry carries the run's created_at as its action_at.
  const loggedArchives = events
    .filter((e) => e.kind === 'archived')
    .map((e) => Date.parse(e.at))
  for (const archive of archives) {
    const at = Date.parse(archive.at)
    if (loggedArchives.some((logged) => Math.abs(logged - at) < 60_000))
      continue
    events.push({
      kind: 'archived',
      at: archive.at,
      stage: 'archived',
      source: archive.source,
      standing: 'consistent',
      playlist: archive.playlist,
    })
  }

  const record = snapshot.record
  if (record?.status === 'removed' && record.status_changed_at) {
    const removed = latestOf('removed')
    if (!removed || Date.parse(removed.at) < record.status_changed_at)
      events.push({
        kind: 'dropped',
        at: iso(record.status_changed_at),
        stage: 'removed',
        source: 'status',
        // Status is a claim about *now*; live membership beats it.
        standing: liveStage(snapshot) ? 'contradicted' : 'consistent',
      })
  }

  return events
    .filter((e) => Number.isFinite(Date.parse(e.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/** Stage from live Spotify playlists alone, ignoring the stored status. */
function liveStage(snapshot: TrackSnapshot): TrackStage | null {
  if (snapshot.current) return 'current'
  if (snapshot.inbox) return snapshot.saved === 'saved' ? 'liked' : 'unheard'
  if (snapshot.archives.length) return 'archived'
  return null
}

/** Where the track sits right now, from live Spotify state first. */
export function currentStage(snapshot: TrackSnapshot): TrackStage | null {
  const live = liveStage(snapshot)
  if (live) return live
  const status = snapshot.record?.status
  if (status === 'removed') return 'removed'
  return null
}

/**
 * Consecutive time spans per stage for the swimlane. Each event opens a span
 * that runs until the next event. The final span stays open (`end: null`)
 * only when it matches where the track is now; otherwise it is closed at the
 * last event so the chart never claims a stage the live state contradicts.
 */
export function stageSegments(
  events: TrackEvent[],
  now: TrackStage | null,
): StageSegment[] {
  const segments: StageSegment[] = []
  events = events.filter((event) => event.standing === 'consistent')
  events.forEach((event, index) => {
    const next = events[index + 1]
    const previous = segments.at(-1)
    // Repeated evidence for the same stage (e.g. log + playlist) extends the span.
    if (previous && previous.stage === event.stage) {
      previous.end = next ? next.at : null
      return
    }
    segments.push({
      stage: event.stage,
      start: event.at,
      end: next ? next.at : null,
    })
  })
  const last = segments.at(-1)
  if (last && last.end === null && last.stage !== now) last.end = last.start
  return segments
}

export function trackPlan(snapshot: TrackSnapshot) {
  const record = snapshot.record
  const events = trackEvents(snapshot)
  const stage = currentStage(snapshot)
  const plays = record?.play_count ?? 0
  const playsFromInbox = record?.play_count_inbox ?? 0
  const playsFromCurrent = record?.play_count_current ?? 0
  const seen = (context: TrackSeenContext | undefined) =>
    context && Number.isFinite(context.played_at)
      ? { at: iso(context.played_at), exactness: context.exactness }
      : null
  const currentSince = snapshot.current
    ? Date.parse(snapshot.current.addedAt)
    : null
  return {
    track: snapshot.track,
    tracked: record ? ('tracked' as const) : ('untracked' as const),
    stage,
    status: record?.status ?? null,
    saved: snapshot.saved,
    plays: {
      total: plays,
      fromInbox: playsFromInbox,
      fromCurrent: playsFromCurrent,
      // Liked Songs, search, albums, contextless autoplay — anything that
      // isn't an Inbox/Current playback context.
      elsewhere: Math.max(0, plays - playsFromInbox - playsFromCurrent),
    },
    firstSeen: seen(record?.first_seen),
    lastSeen: seen(record?.last_seen),
    archiveRule: {
      playsToArchive: snapshot.playsToArchive,
      daysToArchive: Math.floor(snapshot.timeToArchive / DAY_MS),
      // Only meaningful while the track is in Current.
      archiveBy:
        currentSince !== null && Number.isFinite(currentSince)
          ? iso(currentSince + snapshot.timeToArchive)
          : null,
    },
    events,
    segments: stageSegments(events, stage),
    generatedAt: iso(snapshot.now),
  }
}

export type TrackDetail = ReturnType<typeof trackPlan>

/** Spotify track ids are 22 base-62 characters. */
export const isTrackId = (id: string) => /^[0-9A-Za-z]{22}$/.test(id)

function presence(
  items: Array<{ added_at: string; track: { id?: string } | null }>,
  id: string,
): PlaylistPresence {
  // A track can appear more than once; the latest addition is the live one.
  const hits = items.filter((item) => item.track?.id === id)
  return hits.length ? { addedAt: hits.at(-1)!.added_at } : null
}

/** Pick the image closest to 300px for the detail header. */
function cover(images?: Array<{ url: string; width?: number | null }>) {
  if (!images?.length) return null
  const sized = [...images].sort(
    (a, b) => Math.abs((a.width ?? 0) - 300) - Math.abs((b.width ?? 0) - 300),
  )
  return sized[0].url
}

/** A `move-track` mutation as `ArchiveAction.forStorage()` stores it. */
type StoredMove = {
  mutationType?: string
  data?: { tracks?: Array<{ id?: string }>; to?: { id?: string } }
}

/**
 * The archive moves of one track found in `archive:<YYYY-MM>` history rows:
 * each `move-track` mutation whose tracks include `trackId`, dated by the
 * run's `created_at`. Pure, so the row shape is pinned by a test.
 */
export function archiveMovesFor(
  rows: Array<{ created_at: number; mutations?: unknown[] }>,
  trackId: string,
) {
  return rows
    .flatMap((row) =>
      ((row.mutations ?? []) as StoredMove[])
        .filter(
          (m) =>
            m?.mutationType === 'move-track' &&
            m.data?.tracks?.some((t) => t?.id === trackId) &&
            m.data.to?.id,
        )
        .map((m) => ({ at: row.created_at, playlistId: m.data!.to!.id! })),
    )
    .filter((move) => Number.isFinite(move.at))
    .sort((a, b) => a.at - b.at)
}

/**
 * `archive:<YYYY-MM>` ids are keyed on the month the *run* happened (not the
 * archive playlist's month), so every month from `from` through `to` must be
 * read. Uses `archivePeriod` so the bucketing matches the writer exactly.
 */
export function archiveRunMonths(from: number, to: number) {
  const months: string[] = []
  const cursor = new Date(from)
  cursor.setDate(1)
  cursor.setHours(12, 0, 0, 0)
  const last = archivePeriod(to)
  for (let guard = 0; guard < 240; guard++) {
    const month = archivePeriod(cursor.getTime())
    months.push(month)
    if (month >= last) break
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return months
}

/** Earliest moment the track could have entered Current. */
function archiveSearchStart(record: TrackItem | undefined) {
  const promotes = (record?.triage_actions ?? [])
    .filter((a) => a.action_type === 'promote')
    .map((a) => a.action_at)
  if (promotes.length) return Math.min(...promotes)
  return null
}

async function playlistNames(ctx: PerformContext) {
  return Object.fromEntries(
    (await ctx.client.allPlaylists()).map((p) => [p.id, p.name]),
  ) as Record<string, string>
}

async function archivesFromHistory(
  ctx: PerformContext,
  id: string,
  record: TrackItem | undefined,
): Promise<ArchiveEvidence[]> {
  const start = archiveSearchStart(record)
  if (start === null) return []
  const rows = (
    await Promise.all(
      archiveRunMonths(start, ctx.now).map((month) =>
        ctx.dynamo.allActionHistory(`archive:${month}`),
      ),
    )
  ).flat()
  const moves = archiveMovesFor(rows, id)
  if (!moves.length) return []
  const names = await playlistNames(ctx)
  return moves.map((move) => ({
    playlist: names[move.playlistId] ?? move.playlistId,
    at: iso(move.at),
    source: 'action-history' as const,
  }))
}

/**
 * Archive history first. Only when it has nothing (a hand-filed track, or an
 * archive from before the rows were kept) fall back to the one monthly archive
 * the latest promote date names, dated by that playlist's `added_at`.
 */
async function archivesFor(
  ctx: PerformContext,
  id: string,
  record: TrackItem | undefined,
): Promise<ArchiveEvidence[]> {
  const fromHistory = await archivesFromHistory(ctx, id, record)
  if (fromHistory.length) return fromHistory
  const lastPromote = (record?.triage_actions ?? [])
    .filter((a) => a.action_type === 'promote')
    .sort((a, b) => a.action_at - b.action_at)
    .at(-1)
  if (!lastPromote) return []
  const name = ctx.settings.archivePlaylistNameFor({
    added_at: iso(lastPromote.action_at),
  })
  const playlist = await ctx.client.optionalPlaylist(name)
  if (!playlist) return []
  const hit = presence(await ctx.client.tracksForPlaylist(playlist), id)
  return hit
    ? [{ playlist: playlist.name, at: hit.addedAt, source: 'playlist' }]
    : []
}

/**
 * Reads only existing state: the `track` row, the track's Spotify metadata and
 * saved status, the Inbox and Current playlists, and the `archive:<YYYY-MM>`
 * action-history rows from its first promote onward (falling back to the one
 * monthly archive its promote date names). No archive crawl, no per-listen log.
 */
export async function gatherTrack(ctx: PerformContext, id: string) {
  const [spotifyTrack, records, savedResult, inboxPlaylist, currentPlaylist] =
    await Promise.all([
      ctx.client.getTrack(id),
      ctx.dynamo.getTracks([id]),
      ctx.client.tracksAreSaved([id]),
      ctx.client.optionalPlaylist(ctx.settings.inbox),
      ctx.client.optionalPlaylist(ctx.settings.current),
    ])
  if (!spotifyTrack?.id) throw new Error(`Track ${id} not found`)
  const [inboxItems, currentItems] = await Promise.all([
    inboxPlaylist ? ctx.client.tracksForPlaylist(inboxPlaylist) : [],
    currentPlaylist ? ctx.client.tracksForPlaylist(currentPlaylist) : [],
  ])
  const record = records[id]
  const current = presence(currentItems, id)

  const archives = current
    ? // Still in Current: any earlier archiving is history, but keep it.
      await archivesFromHistory(ctx, id, record)
    : await archivesFor(ctx, id, record)

  return trackPlan({
    track: {
      id: spotifyTrack.id,
      uri: spotifyTrack.uri,
      name: spotifyTrack.name,
      artist: spotifyTrack.artists.map((a) => a.name).join(', '),
      album: spotifyTrack.album?.name ?? '',
      image: albumArt(spotifyTrack.album?.images),
      cover: cover(spotifyTrack.album?.images),
    },
    record,
    inbox: presence(inboxItems, id),
    current,
    archives,
    playlistNames: (record?.triage_actions ?? []).some(
      (a) => a.action_type === 'archive',
    )
      ? await playlistNames(ctx)
      : {},
    saved: savedResult.saved.includes(id) ? 'saved' : 'unsaved',
    now: Date.now(),
    timeToArchive: ctx.settings.timeToArchive,
    playsToArchive: ctx.settings.playsToArchive,
  })
}
