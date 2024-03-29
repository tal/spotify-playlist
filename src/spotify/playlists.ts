import { getAPI } from '../spotify-api'
import { getKey } from '../db'

let playlists: any

async function allPlaylists() {
  let body

  if (playlists) {
    body = playlists
  } else {
    const username = await getKey('username')
    const spotifyAPI = await getAPI()
    const resp = await spotifyAPI.getUserPlaylists(username)
    body = resp.body
  }

  return body.items
}

export async function getPlaylistByName(name: string) {
  const playlists = await allPlaylists()

  for (let playlist of playlists) {
    if (playlist.name === name) {
      return playlist
    }
  }

  throw 'no playlist found'
}

export async function getTargetPlaylist() {
  const playlists = await allPlaylists()
  const name = await getKey('currentPlaylist')

  for (let playlist of playlists) {
    if (playlist.name === name) {
      return playlist
    }
  }

  throw 'no playlist found'
}

const MONTH_NAME = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function playlistNameForDate(added_at: Date) {
  return `${added_at.getFullYear()} - ${MONTH_NAME[added_at.getMonth()]}`
}

type MoveTrack = {
  trackId: string
  sourcePlaylistId: string
  track: any
  diff?: number
  targetPlaylistName: string
}

async function createPlaylist(name: string, options = { public: true }) {
  const spotifyAPI = await getAPI()
  const username = await getKey('username')

  const playlist = await spotifyAPI.createPlaylist(username, name, options)

  if (playlists) {
    playlists.unshift(playlist)
  }

  return playlist
}

async function tracksToArchive(): Promise<MoveTrack[]> {
  const spotifyAPI = await getAPI()
  const username = await getKey('username')
  const currentPlaylist = await getTargetPlaylist()

  const tracksData = await spotifyAPI.getPlaylistTracks(
    username,
    currentPlaylist.id,
  )

  const items = tracksData.body.items

  return items
    .map(
      ({
        track,
        added_at,
      }: {
        track: { id: string }
        added_at: string | Date
      }) => {
        added_at = new Date(added_at)

        let diff = new Date().getTime() - added_at.getTime()

        return {
          trackId: track.id,
          track,
          diff: Math.floor(diff / 1000 / 60 / 60 / 24),
          targetPlaylistName: playlistNameForDate(added_at),
          sourcePlaylistId: currentPlaylist.id,
        } satisfies MoveTrack
      },
    )
    .filter(({ diff }: { diff: number }) => diff >= 30)
}

type PlaylistTrackList = {
  [key: string]: {
    playlistName: string
    tracks: string[]
  }
}

class TrackMoveSet {
  toAdd: PlaylistTrackList
  toRemove: PlaylistTrackList
  locked: boolean

  constructor() {
    this.toAdd = {}
    this.toRemove = {}

    this.locked = false
  }

  add(item: MoveTrack) {
    if (this.locked) {
      throw 'locked cannot proceed'
    }

    console.log(`moving ${item.track.name} - ${item.track.uri}`)

    const { targetPlaylistName, trackId, sourcePlaylistId } = item

    this.ensureAddPlaylist(targetPlaylistName)
    this.ensureRemovePlaylist(sourcePlaylistId)

    const uri = `spotify:track:${trackId}`

    this.toAdd[targetPlaylistName].tracks.push(uri)
    this.toRemove[sourcePlaylistId].tracks.push(uri)
  }

  ensureAddPlaylist(name: string) {
    if (!(name in this.toAdd)) {
      this.toAdd[name] = {
        playlistName: name,
        tracks: [],
      }
    }
  }

  ensureRemovePlaylist(name: string) {
    if (!(name in this.toRemove)) {
      this.toRemove[name] = {
        playlistName: name,
        tracks: [],
      }
    }
  }

  async process() {
    if (this.locked) {
      return
    }

    this.locked = true

    const spotifyAPI = await getAPI()
    const username = await getKey('username')

    let promises: any[] = []

    for (let playlistName in this.toAdd) {
      let targetPlaylist

      try {
        targetPlaylist = await getPlaylistByName(playlistName)
      } catch (err) {
        const createResponse = await createPlaylist(playlistName)
        targetPlaylist = createResponse.body
      }

      const targetPlaylistId = targetPlaylist.id

      const { tracks } = this.toAdd[playlistName]

      promises.push(
        spotifyAPI.addTracksToPlaylist(
          username,
          targetPlaylistId,
          tracks as any,
        ),
      )
    }

    for (let playlistName in this.toRemove) {
      const { tracks } = this.toRemove[playlistName]

      const uris = tracks.map((uri) => {
        return { uri }
      })

      promises.push(
        spotifyAPI.removeTracksFromPlaylist(
          username,
          playlistName as any,
          uris as any,
        ),
      )
    }

    return Promise.all(promises)
  }
}

export async function moveTracksFromPlaylistToPlaylist() {
  let moveSet = new TrackMoveSet()

  for (let item of await tracksToArchive()) {
    moveSet.add(item)
  }

  return moveSet.process()
}
