import type { PerformContext } from '../actions/action'

/** Whether the track can be played in the operator's market. */
export type Availability = 'available' | 'unavailable'

export type InboxEntry = {
  /**
   * 1-based position in the full Spotify playlist, counting the unavailable
   * items we never show. Kept so a dropped track leaves a gap in the numbering
   * instead of renumbering everything below it.
   */
  position: number
  addedAt: string
  /**
   * Region availability for the operator. Omitted entries are treated as
   * available, so existing callers and tests keep their meaning. `gatherInbox`
   * sets this explicitly from Spotify's `available_markets`.
   */
  availability?: Availability
  track: {
    id: string
    uri: string
    name: string
    artist: string
  } | null
}

/** Saved in the user's library = the operator's "Liked" (3-star) tier. */
export type LikeStatus = 'liked' | 'unheard'

/**
 * Region availability for a raw Spotify track. We read the Inbox without a
 * `market` param — so ids stay un-relinked for the play-count / liked lookups —
 * which means Spotify returns each track's full `available_markets`. A track is
 * unavailable when that list is present but excludes the user's country (an
 * empty list counts), or when Spotify explicitly flags `is_playable: false`. An
 * unknown country or a missing `available_markets` stays available, so we never
 * blank the whole feed on incomplete data.
 */
export function trackAvailability(
  track:
    | { available_markets?: string[]; is_playable?: boolean }
    | null
    | undefined,
  country: string | undefined,
): Availability {
  if (!track) return 'unavailable'
  if (track.is_playable === false) return 'unavailable'
  if (country && Array.isArray(track.available_markets)) {
    return track.available_markets.includes(country) ? 'available' : 'unavailable'
  }
  return 'available'
}

/**
 * Pure planner for the dashboard's Inbox feed: the front of the funnel, in the
 * Inbox playlist's own order. Unavailable tracks are dropped, then the first
 * `limit` remain. `savedTrackIds` (a raw containsMySavedTracks result) decides
 * each track's like status; `records` supplies its Inbox listen count.
 */
export function inboxPlan(
  entries: InboxEntry[],
  records: Record<string, TrackItem | undefined>,
  savedTrackIds: string[],
  now: number,
  limit = 20,
) {
  const saved = new Set(savedTrackIds)
  const tracks = entries
    .filter((entry) => entry.track?.id && entry.availability !== 'unavailable')
    .slice(0, limit)
    .map((entry) => {
      const track = entry.track!
      const likeStatus: LikeStatus = saved.has(track.id) ? 'liked' : 'unheard'
      return {
        position: entry.position,
        id: track.id,
        uri: track.uri,
        name: track.name,
        artist: track.artist,
        likeStatus,
        status: records[track.id]?.status ?? null,
        playsFromInbox: records[track.id]?.play_count_inbox ?? 0,
      }
    })
  return {
    trackCount: tracks.length,
    likedCount: tracks.filter((t) => t.likeStatus === 'liked').length,
    tracks,
    generatedAt: new Date(now).toISOString(),
  }
}

export async function gatherInbox(ctx: PerformContext, limit = 20) {
  const playlist = await ctx.client.playlist(ctx.settings.inbox)
  const [items, country] = await Promise.all([
    ctx.client.tracksForPlaylist(playlist),
    ctx.client.myCountry(),
  ])
  // Position is the item's index in the full list — unavailable items (null, or
  // region-locked for the operator) stay counted so the numbering matches
  // Spotify even though we drop them next.
  const entries: InboxEntry[] = items.map(({ track, added_at }, index) => ({
    position: index + 1,
    addedAt: added_at,
    availability: trackAvailability(track, country),
    track: track?.id
      ? {
          id: track.id,
          uri: track.uri,
          name: track.name,
          artist: track.artists.map((a) => a.name).join(', '),
        }
      : null,
  }))
  // Plan once with no records to learn which ids the top `limit` actually needs,
  // then fetch listen counts and saved status for exactly those (≤ 50, one call).
  const ids = inboxPlan(entries, {}, [], ctx.now, limit).tracks.map((t) => t.id)
  const records = ids.length ? await ctx.dynamo.getTracks(ids) : {}
  const savedTrackIds = ids.length
    ? (await ctx.client.tracksAreSaved(ids)).saved
    : []
  return inboxPlan(entries, records, savedTrackIds, Date.now(), limit)
}
