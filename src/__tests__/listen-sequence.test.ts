import { describe, it, expect } from 'bun:test'
import { ListenSequence } from '../mutations/listen-sequence'
import { AddTrackListenMutation } from '../mutations/add-track-listen-mutation'
import { UpdateLastPlayedProcessedMutation } from '../mutations/update-last-played-processed-mutation'
import type { Dynamo } from '../db/dynamo'
import type { Spotify } from '../spotify'

/**
 * Listen writes increment counters, so processing one twice permanently inflates
 * the data. The watermark is the only thing preventing that, which makes "how
 * far may the watermark advance after a partial failure" the whole ballgame.
 */

const STARTING_WATERMARK = 1_000

type Attempt = { id: string; playedAt: number }

/**
 * Stands in for Dynamo, recording which listens actually reached the table and
 * failing whichever track the test names.
 */
function fakeDynamo(failFor?: string) {
  const written: Attempt[] = []
  let lastPlayedAt: number | undefined

  const dynamo = {
    user: { id: 'test-user' },
    async updateTrack(
      { id }: { id: string },
      { seen }: { seen?: { played_at: number } },
    ) {
      if (id === failFor)
        throw new Error(`ProvisionedThroughputExceeded: ${id}`)
      written.push({ id, playedAt: seen!.played_at })
      return {}
    },
    async updateLastPlayedAtProcessedTimestamp(_userId: string, ts: number) {
      lastPlayedAt = ts
    },
  }

  return {
    dynamo: dynamo as unknown as Dynamo,
    written,
    get lastPlayedAt() {
      return lastPlayedAt
    },
  }
}

/**
 * Mirrors ProcessPlaybackHistoryAction: listens ascending by played_at, one per
 * mutation set, watermark mutation last.
 */
async function runPass(listens: Attempt[], failFor?: string) {
  const table = fakeDynamo(failFor)
  const client = {} as Spotify
  const sequence = new ListenSequence(STARTING_WATERMARK)

  const listenMutations = listens.map(
    ({ id, playedAt }) =>
      new AddTrackListenMutation(
        {
          track: { id },
          increment_by: 1,
          seen: { played_at: playedAt, exactness: 'played' },
        },
        sequence,
      ),
  )

  const watermark = new UpdateLastPlayedProcessedMutation(
    { userId: 'test-user' },
    sequence,
  )

  for (let mutation of [...listenMutations, watermark]) {
    await mutation.run({ client, dynamo: table.dynamo })
  }

  return { ...table, listenMutations, watermark, sequence }
}

describe('listen writes and the played-at watermark', () => {
  const listens: Attempt[] = [
    { id: 'a', playedAt: 2_000 },
    { id: 'b', playedAt: 3_000 },
    { id: 'c', playedAt: 4_000 },
    { id: 'd', playedAt: 5_000 },
  ]

  it('advances to the newest listen when every write lands', async () => {
    const pass = await runPass(listens)

    expect(pass.written.map((w) => w.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(pass.lastPlayedAt).toBe(5_000)
  })

  it('stops the watermark at the last write that landed', async () => {
    const pass = await runPass(listens, 'c')

    expect(pass.lastPlayedAt).toBe(3_000)
  })

  it('skips the listens after a failure rather than writing past the watermark', async () => {
    const pass = await runPass(listens, 'c')

    // 'd' would land above the watermark and be counted again on the next run.
    expect(pass.written.map((w) => w.id)).toEqual(['a', 'b'])
    expect(pass.listenMutations[3].completionState.state).toBe('skipped')
  })

  it('records the failure without aborting the pass', async () => {
    const pass = await runPass(listens, 'c')

    expect(pass.listenMutations[2].completionState.state).toBe('error')
    // The watermark mutation is the point — it has to survive to run at all.
    expect(pass.watermark.completionState.state).toBe('success')
  })

  it('leaves the watermark where it was when the first write fails', async () => {
    const pass = await runPass(listens, 'a')

    expect(pass.written).toEqual([])
    expect(pass.lastPlayedAt).toBe(STARTING_WATERMARK)
  })

  it('stores the watermark it actually wrote, not the one it hoped for', async () => {
    const pass = await runPass(listens, 'c')

    // forStorage serializes mutations after the run, so action_history has to
    // show where the pass stopped rather than the optimistic target.
    expect((pass.watermark.storage.data as { ts: number }).ts).toBe(3_000)
  })
})

describe('AddTrackListenMutation without a sequence', () => {
  it('still aborts its action on failure', async () => {
    const table = fakeDynamo('a')
    const mutation = new AddTrackListenMutation({
      track: { id: 'a' },
      increment_by: 0,
      seen: { played_at: 2_000, exactness: 'playlist-addition' },
    })

    expect(
      mutation.run({ client: {} as Spotify, dynamo: table.dynamo }),
    ).rejects.toThrow('ProvisionedThroughputExceeded')
  })
})
