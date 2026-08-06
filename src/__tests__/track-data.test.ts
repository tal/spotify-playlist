import { describe, it, expect } from 'bun:test'
import type { Track } from 'spotify-web-api-node'
import { trackToData } from '../actions/track-action'

/**
 * Every planner test hand-builds `BasicTrackData` instead of calling the real
 * projection. This pins `trackToData`'s actual shape and its missing-input
 * behavior directly.
 */

function baseTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-windowlicker',
    uri: 'spotify:track:track-windowlicker',
    name: 'Windowlicker',
    artists: [{ name: 'Aphex Twin' } as any],
    album: { name: 'Windowlicker' } as any,
    ...overrides,
  } as Track
}

describe('trackToData', () => {
  it('projects a full Track down to BasicTrackData', () => {
    const track = baseTrack()

    expect(trackToData(track)).toEqual({
      id: 'track-windowlicker',
      uri: 'spotify:track:track-windowlicker',
      name: 'Windowlicker',
      artist: 'Aphex Twin',
      album: 'Windowlicker',
    })
  })

  it('takes artists[0] as the sole credited artist when several exist', () => {
    const track = baseTrack({
      artists: [{ name: 'Aphex Twin' } as any, { name: 'Squarepusher' } as any],
    })

    expect(trackToData(track)!.artist).toBe('Aphex Twin')
  })

  it('returns undefined for an undefined track', () => {
    expect(trackToData(undefined)).toBeUndefined()
  })

  it('throws when artists is missing entirely', () => {
    const track = baseTrack({ artists: undefined as any })

    expect(() => trackToData(track)).toThrow()
  })

  it('throws when album is missing entirely', () => {
    const track = baseTrack({ album: undefined as any })

    expect(() => trackToData(track)).toThrow()
  })
})
