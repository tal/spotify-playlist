import {run as runScript} from '../scripts/run'
import { createServer } from './spotify-auth'

import {
  promoteCurrentlyPlayingTrack,
  removeCurrentlyPlayingTrack,
} from './spotify/promote-currently-playing-track'

import { moveTracksFromPlaylistToPlaylist } from './spotify/playlists'

let promise

switch (process.argv[2]) {
  case 'promote-skip':
    runScript('next_track')
  case 'promote':
    promise = promoteCurrentlyPlayingTrack()
    break
  case 'remove':
    promise = removeCurrentlyPlayingTrack()
    break
  case 'current-track':
    promise = runScript('get_track')
    promise = promise.then(track => {
      console.log(`Current track: ${track.name} - ${track.artist}`)
    })
    break
  case 'auth':
    promise = createServer()
    break;
  case 'archive-tracks':
    promise = moveTracksFromPlaylistToPlaylist()
    break;
}

promise
  .catch((err) => console.error('Error:', err))
