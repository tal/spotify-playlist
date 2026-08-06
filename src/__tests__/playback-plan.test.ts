import { describe, it, expect } from 'bun:test'
import type { RecentlyPlayedItem } from 'spotify-web-api-node'
import { processPlaybackHistoryPlan } from '../actions/process-playback-history-action'
import { AddTrackListenMutation } from '../mutations/add-track-listen-mutation'
import { UpdateLastPlayedProcessedMutation } from '../mutations/update-last-played-processed-mutation'

/**
 * processPlaybackHistoryPlan is the priority path for ListenSequence's
 * ordering invariant (see AGENTS.md "Known Issues"): the sets it returns are
 * only safe to run sequentially if they are one listen per set, ascending by
 * played_at, with the watermark mutation last. Nothing enforces that except
 * this function's own construction, so the ordering is asserted directly
 * against `plan`'s set boundaries rather than just the flattened contents.
 */

const INBOX_PLAYLIST_ID = 'inbox-playlist-id'
const CURRENT_PLAYLIST_ID = 'current-playlist-id'
const USER_ID = 'test-user'
const WATERMARK = 10_000

const iso = (ms: number) => new Date(ms).toISOString()

function playedItem(
  id: string,
  playedAtMs: number,
  contextUri?: string,
): RecentlyPlayedItem {
  return {
    track: { id } as RecentlyPlayedItem['track'],
    played_at: iso(playedAtMs),
    context: contextUri
      ? ({ uri: contextUri } as RecentlyPlayedItem['context'])
      : undefined,
  }
}

function stageMap() {
  return new Map<string, TriageStage>([
    [INBOX_PLAYLIST_ID, 'inbox'],
    [CURRENT_PLAYLIST_ID, 'current'],
  ])
}

function plan(
  playedItems: RecentlyPlayedItem[],
  stageByPlaylistId = new Map<string, TriageStage>(),
  watermark = WATERMARK,
) {
  return processPlaybackHistoryPlan({
    playedItems,
    stageByPlaylistId,
    watermark,
    userId: USER_ID,
  })
}

function listenAt(sets: ReturnType<typeof plan>, index: number) {
  const mutation = sets[index][0]
  expect(mutation).toBeInstanceOf(AddTrackListenMutation)
  return (mutation as AddTrackListenMutation).storage
}

describe('processPlaybackHistoryPlan', () => {
  describe('watermark', () => {
    it('excludes items at or before the watermark and keeps items after it', () => {
      const sets = plan([
        playedItem('at-watermark', WATERMARK),
        playedItem('before-watermark', WATERMARK - 1_000),
        playedItem('after-watermark', WATERMARK + 1_000),
      ])

      // Only the watermark mutation set plus the single surviving listen.
      expect(sets).toHaveLength(2)
      expect(listenAt(sets, 0).data.track).toEqual({ id: 'after-watermark' })
    })

    it('returns no mutations when every item is at or before the watermark', () => {
      const sets = plan([
        playedItem('at-watermark', WATERMARK),
        playedItem('before-watermark', WATERMARK - 500),
      ])

      expect(sets).toEqual([])
    })

    it('returns no mutations for an empty playedItems list', () => {
      expect(plan([])).toEqual([])
    })

    it('orders listens ascending by played_at, one per mutation set, watermark mutation last', () => {
      const sets = plan([
        playedItem('c', WATERMARK + 3_000),
        playedItem('a', WATERMARK + 1_000),
        playedItem('b', WATERMARK + 2_000),
      ])

      expect(sets).toHaveLength(4)
      // Every set is a single mutation — that's what lets performAction treat
      // each listen as its own sequential step instead of batching writes.
      expect(sets.every((set) => set.length === 1)).toBe(true)

      expect(listenAt(sets, 0).data.track).toEqual({ id: 'a' })
      expect(listenAt(sets, 1).data.track).toEqual({ id: 'b' })
      expect(listenAt(sets, 2).data.track).toEqual({ id: 'c' })

      const last = sets[sets.length - 1][0]
      expect(last).toBeInstanceOf(UpdateLastPlayedProcessedMutation)
    })

    it('is stable regardless of the input order of playedItems', () => {
      const sets = plan([
        playedItem('b', WATERMARK + 2_000),
        playedItem('c', WATERMARK + 3_000),
        playedItem('a', WATERMARK + 1_000),
      ])

      const ids = sets
        .slice(0, -1)
        .map((_, i) => listenAt(sets, i).data.track.id)

      expect(ids).toEqual(['a', 'b', 'c'])
    })

    it("seeds the watermark mutation with the starting watermark and this run's userId", () => {
      const sets = plan([playedItem('a', WATERMARK + 1_000)])

      const watermarkMutation = sets[sets.length - 1][0].storage
      expect((watermarkMutation.data as { ts: number }).ts).toBe(WATERMARK)
      expect((watermarkMutation.data as { userId: string }).userId).toBe(
        USER_ID,
      )
    })
  })

  describe('attribution', () => {
    it('attributes a play from the inbox playlist to the inbox stage', () => {
      const sets = plan(
        [
          playedItem(
            'a',
            WATERMARK + 1_000,
            `spotify:playlist:${INBOX_PLAYLIST_ID}`,
          ),
        ],
        stageMap(),
      )

      const listen = listenAt(sets, 0)
      expect(listen.data.stage).toBe('inbox')
      expect(listen.data.increment_by).toBe(1)
    })

    it('attributes a play from the current playlist to the current stage', () => {
      // Spotify reports some playlists as playlist_v2 — the matcher has to
      // key off the trailing id, not the literal uri prefix.
      const sets = plan(
        [
          playedItem(
            'a',
            WATERMARK + 1_000,
            `spotify:playlist_v2:${CURRENT_PLAYLIST_ID}`,
          ),
        ],
        stageMap(),
      )

      const listen = listenAt(sets, 0)
      expect(listen.data.stage).toBe('current')
    })

    it('leaves the stage undefined when the played item has no playback context', () => {
      const sets = plan([playedItem('a', WATERMARK + 1_000)], stageMap())

      const listen = listenAt(sets, 0)
      expect(listen.data.stage).toBeUndefined()
      expect(listen.data.seen?.uri).toBeUndefined()
      // Still a global listen — increment_by is unaffected by attribution.
      expect(listen.data.increment_by).toBe(1)
    })

    it('leaves the stage undefined when the context playlist is untracked', () => {
      const sets = plan(
        [
          playedItem(
            'a',
            WATERMARK + 1_000,
            'spotify:playlist:some-other-playlist',
          ),
        ],
        stageMap(),
      )

      expect(listenAt(sets, 0).data.stage).toBeUndefined()
    })

    it('leaves the stage undefined for a non-playlist context (e.g. an album)', () => {
      const sets = plan(
        [playedItem('a', WATERMARK + 1_000, 'spotify:album:some-album')],
        stageMap(),
      )

      expect(listenAt(sets, 0).data.stage).toBeUndefined()
    })

    it.failing('attributes a legacy user-scoped playlist context uri', () => {
      const sets = plan(
        [
          playedItem(
            'a',
            WATERMARK + 1_000,
            `spotify:user:test-user:playlist:${INBOX_PLAYLIST_ID}`,
          ),
        ],
        stageMap(),
      )

      expect(listenAt(sets, 0).data.stage).toBe('inbox')
    })

    it('records the raw context uri on seen regardless of attribution outcome', () => {
      const uri = `spotify:playlist:${INBOX_PLAYLIST_ID}`
      const sets = plan([playedItem('a', WATERMARK + 1_000, uri)], stageMap())

      expect(listenAt(sets, 0).data.seen?.uri).toBe(uri)
      expect(listenAt(sets, 0).data.seen?.exactness).toBe('played')
    })
  })
})
