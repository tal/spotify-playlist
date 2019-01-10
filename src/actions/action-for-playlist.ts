import { Playlist } from 'spotify-web-api-node'
import { AutoArtistPlaylist } from './auto-artist-playlist'
import { Spotify } from '../spotify'
import { Action } from './action'

export function actionForPlaylist(
  playlist: Playlist,
  spotify: Spotify,
): Action | void {
  if (playlist.name.match(/\[A\]$/)) {
    return new AutoArtistPlaylist(spotify, playlist)
  }
}
