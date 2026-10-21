import '../-run-this-first'
import { describe, expect, it } from 'bun:test'
import type { PlaylistTrack } from 'spotify-web-api-node'
import type { PerformContext } from '../actions/action'
import {
  SLICE_OF_STARRED_NAME,
  SliceOfStarredAction,
} from '../actions/slice-of-starred'
import type { Spotify } from '../spotify'

const context = { settings: { starred: 'Starred' } } as PerformContext
const entry = (uri: string | null) =>
  ({ track: uri === null ? null : { uri } }) as PlaylistTrack

function clientFor(tracks: PlaylistTrack[], found = true) {
  return {
    optionalPlaylist: async (name: string) => {
      expect(name).toBe('Starred')
      return found ? { id: 'source' } : undefined
    },
    tracksForPlaylist: async () => tracks,
  } as unknown as Spotify
}

describe('Slice of Starred', () => {
  it('selects a consecutive 45-track window, including the last possible window', async () => {
    const tracks = Array.from({ length: 60 }, (_, i) =>
      entry(`spotify:track:${i}`),
    )
    const action = new SliceOfStarredAction(clientFor(tracks), (n) => n - 1)
    const plan = await action.perform(context)
    expect(plan[0][0].storage.data).toEqual({
      name: SLICE_OF_STARRED_NAME,
      tracks: tracks.slice(15).map(({ track }) => ({ uri: track.uri })),
    })

    const writes: unknown[] = []
    await plan[0][0].run({
      client: {
        getOrCreatePlaylist: async (name: string, refresh: boolean) => {
          writes.push([name, refresh])
          return { id: 'slice' }
        },
        replacePlaylistTracks: async (id: string, tracks: unknown) => {
          writes.push([id, tracks])
        },
      } as unknown as Spotify,
      dynamo: {} as PerformContext['dynamo'],
    })
    expect(writes).toEqual([
      ['Slice of Starred 🦦', true],
      ['slice', tracks.slice(15).map(({ track }) => ({ uri: track.uri }))],
    ])
  })

  it('uses all tracks when fewer than 45 are addable, filtering null and local entries', async () => {
    const action = new SliceOfStarredAction(
      clientFor([
        entry('spotify:track:a'),
        entry(null),
        entry('spotify:local:b'),
        entry('spotify:track:c'),
      ]),
      () => {
        throw new Error('No random choice needed')
      },
    )
    const plan = await action.perform(context)
    expect(plan[0][0].storage.data.tracks).toEqual([
      { uri: 'spotify:track:a' },
      { uri: 'spotify:track:c' },
    ])
  })

  it('clears a stale slice when Starred is empty', async () => {
    const plan = await new SliceOfStarredAction(clientFor([])).perform(context)
    expect(plan[0][0].storage.data.tracks).toEqual([])
  })

  it('leaves the destination alone when the source is missing', async () => {
    const plan = await new SliceOfStarredAction(clientFor([], false)).perform(
      context,
    )
    expect(plan).toEqual([])
  })
})
