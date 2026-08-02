/**
 * Shared gate for the listen writes of a single playback pass.
 *
 * Listen writes are *not* idempotent — each one increments `play_count` and a
 * per-stage counter — while the `lastPlayedAtProcessed` watermark is the only
 * thing stopping a listen from being processed twice. So the watermark may only
 * ever advance across an unbroken prefix of writes that actually landed.
 *
 * Two rules keep that true:
 *
 * 1. Listens are handed to this object in ascending `played_at` order, and only
 *    a success moves the watermark.
 * 2. The first failure halts the pass. Later listens are skipped rather than
 *    written, because a write that lands *above* the watermark gets counted
 *    again on the next run.
 *
 * The cost is that a failure defers the tail of the batch to the next run,
 * which is exactly what the watermark is for.
 */
export class ListenSequence {
  private state: 'open' | 'halted' = 'open'
  private highWaterMark: number

  constructor(startingWatermark: number) {
    this.highWaterMark = startingWatermark
  }

  get status() {
    return this.state
  }

  /** The latest `played_at` whose write, and every write before it, succeeded. */
  get watermark() {
    return this.highWaterMark
  }

  recordSuccess(playedAt: number) {
    if (this.state === 'halted') return
    if (playedAt > this.highWaterMark) this.highWaterMark = playedAt
  }

  halt() {
    this.state = 'halted'
  }
}
