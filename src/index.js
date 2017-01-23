import {run as runScript} from '../scripts/run'
import { createServer } from './spotify-auth'

import {
  promoteCurrentlyPlayingTrack,
  removeCurrentlyPlayingTrack,
} from './spotify/promote-currently-playing-track'

import {
  moveTracksFromPlaylistToPlaylist,
  getPlaylistByName,
  getTargetPlaylist,
} from './spotify/playlists'

let promise

switch (process.argv[2]) {
  case 'promote-skip':
    promise = promoteCurrentlyPlayingTrack()
    promise.then(() => runScript('next_track'))
    break
  case 'promote':
    promise = promoteCurrentlyPlayingTrack()
    break
  case 'remove':
    promise = removeCurrentlyPlayingTrack()
    break
  case 'test-api':
    promise = getPlaylistByName('Inbox').then((playlist) => {
      console.log("inbox playlist", playlist)
      return getTargetPlaylist()
    }).then(playlist => {
      console.log("target playlist", playlist)
    })
    break;
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
