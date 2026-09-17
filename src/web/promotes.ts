import type { PerformContext } from '../actions/action'

/** The lifecycle stage a promotion lands the track in. An enum, not a boolean. */
export type PromoteStage = 'liked' | 'current'

/** One promotion event before live track data is joined on. */
export type PromoteEvent = {
  id: string
  uri: string
  name: string
  artist: string
  /** ms epoch of the Spotify `added_at` that dates this promotion. */
  at: number
  stage: PromoteStage
}

export type PromoteRow = {
  id: string
  uri: string
  name: string
  artist: string
  promotedAt: string
  /** Which stage of the promote this row represents. */
  stage: PromoteStage
  /** Human transition label, e.g. `'unheard → liked'`. */
  transition: string
  /** Where the track sits now, joined live from the `track` table. */
  liveStatus: TrackStatus | null
  plays: number
  playsFromInbox: number
  playsFromCurrent: number
}

const TRANSITION: Record<PromoteStage, string> = {
  liked: 'unheard → liked',
  current: 'liked → current',
}

/**
 * Merge the two promote-event streams — Liked → Current from the Current
 * playlist's `added_at`, and Unheard → Liked from Liked Songs' `added_at` —
 * newest-first, and take the top `limit`. A track promoted through both stages
 * appears **twice**, once per stage, on purpose. Pure so the merge/order/slice
 * is pinned by a test without Spotify. Unlike the old action-history source,
 * Spotify's `added_at` is reliably time-ordered, so "newest first" is exact.
 */
export function promotesPlan(
  events: PromoteEvent[],
  records: Record<string, TrackItem | undefined>,
  now: number,
  limit = 20,
) {
  const tracks = [...events]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((event): PromoteRow => {
      const record = records[event.id]
      return {
        id: event.id,
        uri: event.uri,
        name: event.name,
        artist: event.artist,
        promotedAt: new Date(event.at).toISOString(),
        stage: event.stage,
        transition: TRANSITION[event.stage],
        liveStatus: record?.status ?? null,
        plays: record?.play_count ?? 0,
        playsFromInbox: record?.play_count_inbox ?? 0,
        playsFromCurrent: record?.play_count_current ?? 0,
      }
    })

  return {
    tracks,
    trackCount: tracks.length,
    generatedAt: new Date(now).toISOString(),
  }
}

/**
 * Build the promotes feed straight from Spotify: the Current playlist gives the
 * Liked → Current promotions (its per-track `added_at`), and the newest saved
 * tracks give the Unheard → Liked promotions (their save `added_at`). Both are
 * merged by time. No action-history Scan, no `recentPromotesV1` — Spotify's own
 * timestamps are the source, so ordering is reliable rather than approximate.
 */
export async function gatherPromotes(ctx: PerformContext, limit = 20) {
  const playlist = await ctx.client.playlist(ctx.settings.current)
  const [currentItems, saved] = await Promise.all([
    ctx.client.tracksForPlaylist(playlist),
    ctx.client.recentSavedTracks(50),
  ])

  const currentEvents: PromoteEvent[] = currentItems.flatMap(
    ({ track, added_at }) =>
      track?.id
        ? [
            {
              id: track.id,
              uri: track.uri,
              name: track.name,
              artist: track.artists.map((a) => a.name).join(', '),
              at: new Date(added_at).getTime(),
              stage: 'current' as const,
            },
          ]
        : [],
  )

  const likeEvents: PromoteEvent[] = saved.map((s) => ({
    id: s.id,
    uri: s.uri,
    name: s.name,
    artist: s.artist,
    at: new Date(s.addedAt).getTime(),
    stage: 'liked' as const,
  }))

  const events = [...currentEvents, ...likeEvents].filter(
    (e) => !Number.isNaN(e.at),
  )

  // Double-plan like inbox/archived: plan once to learn the ≤limit ids, fetch
  // records for exactly those, then re-plan with live status/plays joined.
  const ids = [
    ...new Set(
      promotesPlan(events, {}, ctx.now, limit).tracks.map((t) => t.id),
    ),
  ]
  const records = ids.length ? await ctx.dynamo.getTracks(ids) : {}
  return promotesPlan(events, records, Date.now(), limit)
}
