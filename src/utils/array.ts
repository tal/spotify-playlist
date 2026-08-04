/**
 * Split an array into ordered, non-overlapping batches without mutating it.
 *
 * Every caller uses this to stay within an external API's batch limit, so an
 * invalid size is a programming error rather than something to normalize.
 */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError('chunk size must be a positive integer')
  }

  const chunks: T[][] = []

  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size))
  }

  return chunks
}
