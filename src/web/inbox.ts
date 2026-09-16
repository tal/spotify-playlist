import type { PerformContext } from '../actions/action'

export type InboxEntry = {
  /**
   * 1-based position in the full Spotify playlist, counting the unavailable
   * items we never show. Kept so a dropped track leaves a gap in the numbering
   * instead of renumbering everything below it.
   */
  position: number
  addedAt: string
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
    .filter((entry) => entry.track?.id)
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
  const items = await ctx.client.tracksForPlaylist(playlist)
  // Position is the item's index in the full list — unavailable (null) items
  // stay counted so the numbering matches Spotify even though we drop them next.
  const entries: InboxEntry[] = items.map(({ track, added_at }, index) => ({
    position: index + 1,
    addedAt: added_at,
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
