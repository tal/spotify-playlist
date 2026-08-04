import { describe, expect, it } from 'bun:test'
import { chunkArray } from '../utils/array'

describe('chunkArray', () => {
  it('preserves order across full and partial batches', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('handles external API boundaries without an empty trailing batch', () => {
    const values = Array.from({ length: 200 }, (_, index) => index)

    expect(chunkArray(values, 100).map((batch) => batch.length)).toEqual([
      100, 100,
    ])
    expect(
      chunkArray([...values, 200], 100).map((batch) => batch.length),
    ).toEqual([100, 100, 1])
  })

  it('returns new arrays and leaves its input untouched', () => {
    const values = [1, 2, 3]
    const chunks = chunkArray(values, 2)

    chunks[0].push(99)

    expect(values).toEqual([1, 2, 3])
    expect(chunks).toEqual([[1, 2, 99], [3]])
  })

  it('returns no batches for an empty input', () => {
    expect(chunkArray([], 25)).toEqual([])
  })

  it('rejects invalid batch sizes', () => {
    for (const size of [0, -1, 1.5, Number.NaN]) {
      expect(() => chunkArray([1], size)).toThrow(
        'chunk size must be a positive integer',
      )
    }
  })
})
