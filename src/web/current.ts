import type { PerformContext } from '../actions/action'
import { DAY_MS } from '../settings'

export type CurrentSnapshot = {
  playlist: string
  playlistTracks: Array<{
    added_at: string
    track: {
      id: string
      uri: string
      name: string
      artists: Array<{ name: string }>
    } | null
  }>
  records: Record<string, TrackItem | undefined>
  now: number
  timeToArchive: number
  playsToArchive: number
}

export async function gatherCurrent(
  ctx: PerformContext,
): Promise<CurrentSnapshot> {
  const playlist = await ctx.client.playlist(ctx.settings.current)
  const playlistTracks = await ctx.client.tracksForPlaylist(playlist)
  const ids = playlistTracks.flatMap(({ track }) =>
    track?.id ? [track.id] : [],
  )
  const records = ids.length ? await ctx.dynamo.getTracks(ids) : {}
  return {
    playlist: playlist.name,
    playlistTracks,
    records,
    now: ctx.now,
    timeToArchive: ctx.settings.timeToArchive,
    playsToArchive: ctx.settings.playsToArchive,
  }
}

export function currentPlan(snapshot: CurrentSnapshot) {
  // Tracks stay in the Current playlist's own order; playlistTracks already
  // arrives in that order from Spotify.
  const tracks = snapshot.playlistTracks.flatMap(({ track, added_at }) => {
    if (!track?.id) return []
    const record = snapshot.records[track.id]
    return [
      {
        id: track.id,
        uri: track.uri,
        addedAt: added_at,
        name: track.name,
        artist: track.artists.map((a) => a.name).join(', '),
        daysInCurrent: Math.floor(
          (snapshot.now - new Date(added_at).getTime()) / DAY_MS,
        ),
        status: record?.status ?? null,
        plays: record?.play_count ?? 0,
        playsFromInbox: record?.play_count_inbox ?? 0,
        playsFromCurrent: record?.play_count_current ?? 0,
      },
    ]
  })
  return {
    playlist: snapshot.playlist,
    trackCount: tracks.length,
    archivesAfterDays: Math.floor(snapshot.timeToArchive / DAY_MS),
    neverPlayedFromCurrent: tracks.filter((t) => t.playsFromCurrent === 0)
      .length,
    tracks,
    playsToArchive: snapshot.playsToArchive,
    generatedAt: new Date(snapshot.now).toISOString(),
  }
}

/** Preserve the existing action's exact response fields and least-played-first order. */
export function listenStatsPlan(snapshot: CurrentSnapshot) {
  const { playsToArchive, generatedAt, tracks, ...summary } =
    currentPlan(snapshot)
  const ordered = [...tracks].sort(
    (a, b) => a.playsFromCurrent - b.playsFromCurrent,
  )
  return {
    ...summary,
    tracks: ordered.map(({ id, uri, addedAt, ...track }) => track),
  }
}
