require('./-run-this-first')

import { Action, performActions } from './actions/action'
import { getDynamo } from './db/dynamo'
import { Spotify } from './spotify'
import { MagicPromoteAction } from './actions/magic-promote-action'
import { SkipToNextTrack } from './actions/skip-to-next-track'
import { DemoteAction } from './actions/demote-action'
import { currentTrackIdentity } from './actions/track-action'

async function main() {
  const dynamo = await getDynamo('koalemos')

  if (!dynamo) throw 'cannot find user'

  const spotify = await Spotify.get(dynamo)
  // const action = new ProcessPlaybackHistoryAction(spotify, dynamo.user)
  // const result = await performActions(dynamo, spotify, action)

  const skip = new SkipToNextTrack(spotify)
  const playing = await currentTrackIdentity(spotify)
  let action: Action = new MagicPromoteAction(spotify, playing)
  action = new DemoteAction(spotify, playing)
  const result = await performActions(dynamo, spotify, [skip, action])
  console.log(result)
  return

  // const playlistId = '37i9dQZEVXcLJIJwErmB6c'
  // const { discoverWeekly } = await getTriageInfo(spotify)
  // const playlist = await spotify
  //   .allPlaylists()
  //   .then((playlists) =>
  //     playlists.find((playlist) => playlist.id === discoverWeekly.id),
  //   )
  // const tracks = await spotify.tracksForPlaylist(discoverWeekly)
  // const trackIds = tracks.map((track) => track.track.id)

  // const result = await dynamo.getSeenTracks(trackIds)

  // const action = new AddPlaylistToInbox(spotify, { id: playlistId })

  // const [[mutation]] = await action.perform({ dynamo })

  // console.log(JSON.stringify(result, null, 2))
}

main()
