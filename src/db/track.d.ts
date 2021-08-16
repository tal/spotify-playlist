declare interface TrackSeenContext {
  uri?: string
  played_at: number
  exactness: 'played' | 'playlist-addition'
}

declare type TrackTriageAction = {
  action_type: 'inboxed' | 'upvote' | 'promote' | 'remove'
  action_at: number
  context_playlist_id?: string
}

declare type TrackTriageActionType = TrackTriageAction['action_type']

declare interface TrackItem {
  id: string
  play_count: number
  first_seen: TrackSeenContext
  last_seen: TrackSeenContext
  triage_actions?: TrackTriageAction[]
}
