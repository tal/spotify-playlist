import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { Action, PerformContext } from '../actions/action'
import { performActions } from '../actions/action'
import { inboxPlan } from '../actions/add-playlist-to-inbox'
import type { Dynamo } from '../db/dynamo'
import type { Spotify } from '../spotify'

/**
 * Correlated writes currently share one Promise.all mutation set. This test
 * records the retryability invariant we want: a failed Spotify add must not let
 * a successful Dynamo log make the track ineligible on the next pass.
 */

const ambient = globalThis as { dev?: unknown }
let priorDev: unknown

beforeAll(() => {
  priorDev = ambient.dev
  ambient.dev = { isDev: false, dryAWS: false, drySpotify: false }
})

afterAll(() => {
  ambient.dev = priorDev
})

test.failing(
  'a failed Inbox add remains eligible after a sibling triage write lands',
  async () => {
    const triaged: string[] = []
    const client = {
      async addTrackToPlaylist() {
        throw new Error('Spotify add failed')
      },
    } as unknown as Spotify
    const dynamo = {
      user: { id: 'test-user' },
      async addTrackTriageAction({ id }: { id: string }) {
        triaged.push(id)
      },
    } as unknown as Dynamo
    const snapshot = {
      playlistTracks: [
        {
          track: { id: 'a', uri: 'spotify:track:a' },
        },
      ] as any,
      seenTrackIds: [],
      inboxTrackIds: [],
      inbox: { id: 'playlist-inbox' },
      now: 123,
    }
    const action: Action = {
      type: 'add-playlist-to-inbox',
      async getID() {
        return 'inbox-playlist:source'
      },
      async perform(_ctx: PerformContext) {
        return inboxPlan(snapshot)
      },
    }

    await expect(performActions(dynamo, client, action)).rejects.toThrow(
      'Spotify add failed',
    )

    expect(triaged).toEqual(['a'])
    const retry = inboxPlan({ ...snapshot, seenTrackIds: triaged })
    expect(retry).not.toEqual([])
  },
)
