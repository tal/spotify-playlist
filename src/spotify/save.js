import { run as runScript } from '../../scripts/run'
import { getAPI } from '../spotify-api'

import { extractTrackId } from './track'

export async function saveCurrentTrack(track = null) {
  if (!track) {
    track = await runScript('get_track')
  }

  const id = extractTrackId(track.id)

  const spotifyAPI = await getAPI()
  const { body } = await spotifyAPI.addToMySavedTracks([id])

  return body
}

export async function unsaveCurrentTrack(track = null) {
  if (!track) {
    track = await runScript('get_track')
  }

  const id = extractTrackId(track.id)

  const spotifyAPI = await getAPI()
  const { body } = await spotifyAPI.removeFromMySavedTracks([id])

  return body
}
