declare interface TrackSeenContext {
  uri?: string
  played_at: number
  exactness: 'played' | 'playlist-addition'
}

/** Key of the `action_history` row that performed a triage action. */
declare type ActionHistoryRef = {
  /** Unprefixed action id, e.g. `archive:2026-11` (no `<user>:` prefix). */
  id: string
  created_at: number
}

declare type TrackTriageAction = {
  /**
   * `'archive'` = moved from Current into a monthly archive by `ArchiveAction`
   * (written since 2026-11-13; older archives are only in `action_history`).
   * Status-neutral: an archived track stays `'promoted'`.
   */
  action_type: 'inboxed' | 'upvote' | 'promote' | 'remove' | 'archive'
  action_at: number
  /** For `'archive'`: the archive playlist the track was moved into. */
  context_playlist_id?: string
  /** For `'archive'`: the `action_history` row of the run that moved it. */
  action_ref?: ActionHistoryRef
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
