/**
 * Pick a small album-art thumbnail URL from Spotify's `album.images`.
 *
 * Spotify returns a few sizes per album (typically 640/300/64, widest-first).
 * The dashboard rows show a ~44px thumbnail, so we want the smallest image
 * that's still at least 64px wide; if every image is smaller than that we fall
 * back to the largest available (best quality for the slot). Returns `null`
 * when there is no artwork, so callers always get a `string | null`.
 */
export function albumArt(
  images:
    | ReadonlyArray<{ url: string; width?: number | null }>
    | null
    | undefined,
): string | null {
  if (!images?.length) return null
  const bySize = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  const pick = bySize.find((i) => (i.width ?? 0) >= 64) ?? bySize[bySize.length - 1]
  return pick?.url ?? null
}
