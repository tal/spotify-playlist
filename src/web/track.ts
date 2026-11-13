import type { PerformContext } from '../actions/action'
import { albumArt } from '../album-art'
import { DAY_MS } from '../settings'

/**
 * A lane on the track-detail swimlane: the user-facing triage progression
 * `Unheard → Liked → Current → Archived`, plus `Removed` as the exit.
 */
export type TrackStage =
  'unheard' | 'liked' | 'current' | 'archived' | 'removed'

/** Where the event's evidence came from, so the UI can say how sure it is. */
export type EventSource = 'triage-log' | 'playlist' | 'status'

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
  archive: { playlist: string; addedAt: string } | null
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
      case 'upvote':
        if (!promoteTimes.has(action.action_at))
          events.push({
            kind: 'liked',
            at,
            stage: 'liked',
            source: 'triage-log',
            standing: 'consistent',
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
  const { current, inbox, archive } = snapshot
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
  if (archive)
    events.push({
      kind: 'archived',
      at: archive.addedAt,
      stage: 'archived',
      source: 'playlist',
      standing: 'consistent',
      playlist: archive.playlist,
    })

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
  if (snapshot.archive) return 'archived'
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

/**
 * Reads only existing state: the `track` row, the track's Spotify metadata and
 * saved status, the Inbox and Current playlists, and — when the track has been
 * promoted but is no longer in Current — the one monthly archive its promote
 * date points at. No archive crawl, no per-listen log.
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

  // ArchiveAction names the archive after the Current `added_at`, which the
  // promote entry shares — so the latest promote points at the one archive to
  // check. A hand-made archive addition to some other month isn't found.
  let archive: TrackSnapshot['archive'] = null
  const lastPromote = (record?.triage_actions ?? [])
    .filter((a) => a.action_type === 'promote')
    .sort((a, b) => a.action_at - b.action_at)
    .at(-1)
  if (!current && lastPromote) {
    const name = ctx.settings.archivePlaylistNameFor({
      added_at: iso(lastPromote.action_at),
    })
    const playlist = await ctx.client.optionalPlaylist(name)
    if (playlist) {
      const hit = presence(await ctx.client.tracksForPlaylist(playlist), id)
      if (hit) archive = { playlist: playlist.name, addedAt: hit.addedAt }
    }
  }

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
    archive,
    saved: savedResult.saved.includes(id) ? 'saved' : 'unsaved',
    now: Date.now(),
    timeToArchive: ctx.settings.timeToArchive,
    playsToArchive: ctx.settings.playsToArchive,
  })
}
