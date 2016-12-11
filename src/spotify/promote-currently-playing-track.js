import {run as runScript} from '../../scripts/run'
import { getKey } from '../db'
import { getAPI } from '../spotify-api'
import { unsaveCurrentTrack } from './save'

import {
  getPlaylistByName,
  getTargetPlaylist,
} from './playlists'

import {
  currentTrackIsSaved,
} from './track'

import {
  saveCurrentTrack,
} from './save'

export async function promoteCurrentlyPlayingTrack() {
  const track = await runScript('get_track')
  const inboxPlaylist = await getKey('inboxPlaylist')
  const playlist = await getPlaylistByName(inboxPlaylist)
  const targetPlaylist = await getTargetPlaylist()

  const spotifyAPI = await getAPI()
  if (await currentTrackIsSaved(track)) {
    console.log(`Promoting '${track.name} - ${track.artist}' (${track.uri}) from '${playlist.name}' -> '${targetPlaylist.name}'`)

    const username = await getKey('username')
    await spotifyAPI.addTracksToPlaylist(username, targetPlaylist.id, [track.uri])
    await spotifyAPI.removeTracksFromPlaylist(username, playlist.id, [{uri: track.uri}])
  } else {
    console.log(`Promoting '${track.name} - ${track.artist}' (${track.uri}) from by saving`)

    await saveCurrentTrack(track)
  }
}

export async function removeCurrentlyPlayingTrack() {
  const track = await runScript('get_track')
  const inboxPlaylist = await getKey('inboxPlaylist')

  const playlist = await getPlaylistByName(inboxPlaylist)

  console.log(`Removing '${track.name} - ${track.artist}' (${track.uri}) from ${playlist.name}`)

  runScript('next_track')
  const username = await getKey('username')
  const spotifyAPI = await getAPI()
  await spotifyAPI.removeTracksFromPlaylist(username, playlist.id, [{uri: track.uri}])
  await unsaveCurrentTrack(track)
}
