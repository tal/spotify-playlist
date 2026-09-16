import type { PerformContext } from '../actions/action'
import { buildArchiveMatcher } from '../settings'

export type ArchiveEntry = {
  playlistId: string
  playlist: string
  addedAt: string
  track: BasicTrackData | null
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
  const playlists = (await ctx.client.allPlaylists()).filter((p) =>
    matches(p.name),
  )
  // Every archive can receive a manual addition today, regardless of its month.
  // Read each one; stopping at the newest named month would silently miss events.
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
        },
      })
    }
  }
  const recent = archivedPlan(entries, {}, ctx.now, limit)
  const ids = [...new Set(recent.tracks.map((t) => t.id))]
  const records = ids.length ? await ctx.dynamo.getTracks(ids) : {}
  return archivedPlan(entries, records, Date.now(), limit)
}
