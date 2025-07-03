import { run as runScript } from '../../scripts/run'
import { getAPI } from '../spotify-api'

export function extractTrackId(id) {
  const [, type, foundId] = id.match(/^spotify:(\w+?):(.+)$/)

  if (foundId) {
    id = type === 'track' ? foundId : null
  }

  return id
}

export async function getTrack({ id }) {
  id = extractTrackId(id)

  const spotifyAPI = await getAPI()

  return await spotifyAPI.getTrack(id)
}

export async function currentTrackIsSaved(track = null) {
  if (!track) {
    track = await runScript('get_track')
  }

  const id = extractTrackId(track.id)

  const spotifyAPI = await getAPI()

  const { body } = await spotifyAPI.containsMySavedTracks([id])
  const [isSaved] = body

  return isSaved
}
