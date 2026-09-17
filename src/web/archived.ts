import type { PerformContext } from '../actions/action'
import { archiveMonthOrder, buildArchiveMatcher } from '../settings'
import { albumArt } from '../album-art'

export type ArchiveEntry = {
  playlistId: string
  playlist: string
  addedAt: string
  track: (BasicTrackData & { image?: string | null }) | null
}

export function archivedPlan(
  entries: ArchiveEntry[],
  records: Record<string, TrackItem | undefined>,
  now: number,
  limit = 20,
) {
  const tracks = entries
    .filter(
      (entry) => entry.track?.id && Number.isFinite(Date.parse(entry.addedAt)),
    )
    .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt))
    .slice(0, limit)
    .map((entry) => ({
      ...entry.track!,
      archivedAt: entry.addedAt,
      playlist: entry.playlist,
      playlistId: entry.playlistId,
      status: records[entry.track!.id]?.status ?? null,
      playsFromCurrent: records[entry.track!.id]?.play_count_current ?? 0,
    }))
  return {
    tracks,
    trackCount: tracks.length,
    generatedAt: new Date(now).toISOString(),
  }
}

export async function gatherArchived(ctx: PerformContext, limit = 20) {
  const matches = buildArchiveMatcher(
    ctx.settings.current === 'Current Test' ? '[Test]' : undefined,
  )
  const playlists = (await ctx.client.allPlaylists())
    .filter((p) => matches(p.name))
    // allPlaylists() returns library order, not date order — sort by month so we
    // can read the most recent archives first.
    .sort((a, b) => archiveMonthOrder(b.name) - archiveMonthOrder(a.name))
  // Read the newest months first and stop once we have enough additions to fill
  // the display limit. This deliberately gives up catching a manual addition to
  // an *older* month: once the limit is met the older archives are never read.
  // We break only after finishing a whole playlist, so a month is never read in
  // part — every addition within a read month is included before we stop.
  const entries: ArchiveEntry[] = []
  for (const playlist of playlists) {
    const items = await ctx.client.tracksForPlaylist(playlist)
    for (const { track, added_at } of items) {
      if (!track?.id) continue
      entries.push({
        playlistId: playlist.id,
        playlist: playlist.name,
        addedAt: added_at,
        track: {
          id: track.id,
          uri: track.uri,
          name: track.name,
          artist: track.artists.map((a) => a.name).join(', '),
          album: track.album.name,
          image: albumArt(track.album.images),
        },
      })
    }
    if (entries.length >= limit) break
  }
  const recent = archivedPlan(entries, {}, ctx.now, limit)
  const ids = [...new Set(recent.tracks.map((t) => t.id))]
  const records = ids.length ? await ctx.dynamo.getTracks(ids) : {}
  return archivedPlan(entries, records, Date.now(), limit)
}
