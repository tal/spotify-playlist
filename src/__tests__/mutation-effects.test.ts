import { describe, expect, it } from 'bun:test'
import type { Dynamo } from '../db/dynamo'
import type { Spotify } from '../spotify'
import { AddTrackMutation } from '../mutations/add-track-mutation'
import { EmptyPlaylistMutation } from '../mutations/empty-playlist-mutation'
import { MoveTrackMutation } from '../mutations/move-track-mutation'
import { RenamePlaylistMutation } from '../mutations/rename-playlist-mutation'
import { SaveTrackMutation } from '../mutations/save-track-mutation'
import { SetTrackStatusMutation } from '../mutations/set-track-status-mutation'
import { SkipToNextTrackMutation } from '../mutations/skip-to-next-track-mutation'

/**
 * Planner tests prove which mutations an action emits by reading `.storage`.
 * These tests close the other half of that contract: each emitted mutation must
 * actually call the intended Spotify or Dynamo operation with its normalized
 * data. A mutation whose `mutate()` became a no-op would otherwise leave every
 * planner test green.
 */

const dynamo = {} as Dynamo

describe('Spotify mutation effects', () => {
  it('adds every normalized track to the target playlist', async () => {
    const calls: unknown[][] = []
    const client = {
      async addTrackToPlaylist(...args: unknown[]) {
        calls.push(args)
      },
    } as unknown as Spotify
    const mutation = new AddTrackMutation({
      playlist: { id: 'playlist-inbox', name: 'ignored by storage' } as any,
      tracks: [
        { id: 'a', uri: 'spotify:track:a', name: 'ignored' } as any,
        { id: 'b', uri: 'spotify:track:b' },
      ],
    })

    await mutation.run({ client, dynamo })

    expect(calls).toEqual([
      [
        { id: 'playlist-inbox' },
        { id: 'a', uri: 'spotify:track:a' },
        { id: 'b', uri: 'spotify:track:b' },
      ],
    ])
    expect(mutation.completionState.state).toBe('success')
  })

  it('moves normalized tracks between the exact source and destination', async () => {
    const calls: unknown[][] = []
    const client = {
      async moveTracks(...args: unknown[]) {
        calls.push(args)
      },
    } as unknown as Spotify
    const mutation = new MoveTrackMutation({
      from: { id: 'current', name: 'Current' } as any,
      to: { id: 'archive', name: '2026 - August' } as any,
      tracks: [{ id: 'a', uri: 'spotify:track:a', name: 'ignored' } as any],
    })

    await mutation.run({ client, dynamo })

    expect(calls).toEqual([
      [
        { id: 'current' },
        { id: 'archive' },
        { id: 'a', uri: 'spotify:track:a' },
      ],
    ])
  })

  it('saves only the Spotify ids carried by the mutation', async () => {
    const calls: string[][] = []
    const client = {
      async saveTrack(...ids: string[]) {
        calls.push(ids)
      },
    } as unknown as Spotify
    const mutation = new SaveTrackMutation({
      tracks: [{ id: 'a' }, { id: 'b' }],
    })

    await mutation.run({ client, dynamo })

    expect(calls).toEqual([['a', 'b']])
  })

  it('reports a rejected save as an error instead of completing early', async () => {
    const client = {
      async saveTrack() {
        throw new Error('save failed')
      },
    } as unknown as Spotify
    const mutation = new SaveTrackMutation({ tracks: [{ id: 'a' }] })

    await expect(mutation.run({ client, dynamo })).rejects.toThrow(
      'save failed',
    )
    expect(mutation.completionState.state).toBe('error')
  })

  it('empties the target playlist by id', async () => {
    const calls: string[] = []
    const client = {
      async emptyPlaylist(id: string) {
        calls.push(id)
      },
    } as unknown as Spotify
    const mutation = new EmptyPlaylistMutation({
      playlist: { id: 'smart', name: 'ignored by storage' } as any,
    })

    await mutation.run({ client, dynamo })

    expect(calls).toEqual(['smart'])
  })

  it('renames the target playlist by id', async () => {
    const calls: Array<{ id: string; name: string }> = []
    const client = {
      async renamePlaylist(id: string, name: string) {
        calls.push({ id, name })
      },
    } as unknown as Spotify
    const mutation = new RenamePlaylistMutation({
      playlist: { id: 'smart', name: 'old name' } as any,
      name: 'Smart Playlist — Aphex Twin',
    })

    await mutation.run({ client, dynamo })

    expect(calls).toEqual([
      { id: 'smart', name: 'Smart Playlist — Aphex Twin' },
    ])
  })

  it('skips through the mutation runner rather than inline in the action', async () => {
    let calls = 0
    const client = {
      async skipToNextTrack() {
        calls += 1
      },
    } as unknown as Spotify
    const mutation = new SkipToNextTrackMutation({})

    await mutation.run({ client, dynamo })

    expect(calls).toBe(1)
    expect(mutation.completionState.state).toBe('success')
  })
})

describe('Dynamo mutation effects', () => {
  it('sets status with the track id and the plan-time clock', async () => {
    const calls: unknown[][] = []
    const table = {
      async setTrackStatus(...args: unknown[]) {
        calls.push(args)
      },
    } as unknown as Dynamo
    const mutation = new SetTrackStatusMutation({
      track: { id: 'a', uri: 'spotify:track:a' } as { id: string },
      status: 'removed',
      changed_at: 123_456,
    })

    await mutation.run({ client: {} as Spotify, dynamo: table })

    expect(calls).toEqual([[{ id: 'a' }, 'removed', 123_456]])
  })
})
