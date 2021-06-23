require('./-run-this-first')
import { release } from 'os'
import { performActions } from './actions/action'
import { getTriageInfo } from './actions/actionable-type'
import { AddPlaylistToInbox } from './actions/add-playlist-to-inbox'
import { ProcessPlaybackHistoryAction } from './actions/process-playback-history-action'
import { getDynamo } from './db/dynamo'
import { Spotify } from './spotify'

async function main() {
  const dynamo = await getDynamo('koalemos')

  if (!dynamo) throw 'cannot find user'

  const spotify = await Spotify.get(dynamo)
  // const action = new ProcessPlaybackHistoryAction(spotify, dynamo.user)
  // const result = await performActions(dynamo, spotify, action)

  const playlistId = '37i9dQZEVXcLJIJwErmB6c'
  const { discoverWeekly } = await getTriageInfo(spotify)
  const playlist = await spotify
    .allPlaylists()
    .then((playlists) =>
      playlists.find((playlist) => playlist.id === discoverWeekly.id),
    )
  const tracks = await spotify.tracksForPlaylist(discoverWeekly)
  const trackIds = tracks.map((track) => track.track.id)

  const result = await dynamo.getSeenTracks(trackIds)

  const action = new AddPlaylistToInbox(spotify, { id: playlistId })

  const [[mutation]] = await action.perform({ dynamo })

  console.log(JSON.stringify(result, null, 2))
}

main()
