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

/**
 * Denormalized view of where a track currently sits, so triage questions are a
 * field read instead of a walk over `triage_actions`.
 *
 * - 'inbox'    — in the Inbox playlist, awaiting triage
 * - 'promoted' — made it to Current. Stays 'promoted' after archiving; filing a
 *                track away is not a lifecycle change
 * - 'removed'  — demoted, or found missing from every tracked playlist
 *
 * Never written as null. Reads may still see null/undefined on rows that
 * predate the field or carry an unrecognized action, and consumers must treat
 * that as "unknown" rather than defaulting to a state.
 */
declare type TrackStatus = 'inbox' | 'promoted' | 'removed'

/**
 * The triage playlists a listen can be attributed to. A play only counts
 * toward a stage when Spotify reports that playlist as the playback context,
 * so these are "listens started from" counts, not "listens while it lived here".
 */
declare type TriageStage = 'inbox' | 'current'

declare type StagePlayCountAttribute = `play_count_${TriageStage}`

declare interface TrackItem {
  id: string
  play_count: number
  play_count_inbox?: number
  play_count_current?: number
  first_seen: TrackSeenContext
  last_seen: TrackSeenContext
  triage_actions?: TrackTriageAction[]
  status?: TrackStatus | null
  status_changed_at?: number
}
