import { Spotify } from '../spotify'

import { Playlist, PlayBackContext } from 'spotify-web-api-node'
import { settings as getSettings } from '../settings'

interface TriageWorkflowSettings {
  inbox: string
  current: string
}

export async function getTriageInfo(client: Spotify) {
  const settings = await getSettings()
  const inboxP = client.playlist(settings.inbox)
  const currentP = client.playlist(settings.current)
  const releaseRadarP = client.optionalPlaylist(settings.releaseRadar)
  const discoverWeeklyP = client.optionalPlaylist(settings.discoverWeekly)
  const starredP = client.optionalPlaylist(settings.starred)

  return {
    inbox: await inboxP,
    current: await currentP,
    releaseRadar: await releaseRadarP,
    discoverWeekly: await discoverWeeklyP,
    starred: await starredP,
  }
}

export type ActableType =
  | 'none'
  | 'triage_source'
  | 'triage_destination'
  | 'auto_playlist'
  | 'generic_track'

type TriagePlaylists = { [k in keyof TriageWorkflowSettings]: Playlist }

export async function currentlyPlayingActableType(
  client: Spotify,
): Promise<ActableType> {
  const triage = getTriageInfo(client)
  const currentTrack = await client.currentTrack

  if (!currentTrack) {
    return 'none'
  }

  if (await isCurrentlyPlayingInTriage(await client.player, await triage)) {
    return 'triage_source'
  }

  return 'generic_track'
}

async function isCurrentlyPlayingInTriage(
  player: PlayBackContext,
  triage: TriagePlaylists,
) {
  if (player.currently_playing_type !== 'track') {
    return false
  }

  if (!player.context) {
    return false
  }

  if (
    player.context.uri === triage.inbox.uri ||
    player.context.uri === triage.current.uri
  ) {
    return true
  } else {
    return false
  }
}
