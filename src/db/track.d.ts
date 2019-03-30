declare interface TrackSeenContext {
  uri?: string
  played_at: number
  exactness: 'played' | 'playlist-addition'
}

declare interface TrackItem {
  id: string
  play_count: number
  first_seen: TrackSeenContext
  last_seen: TrackSeenContext
}
