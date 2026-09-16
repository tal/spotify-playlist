declare type ActionTypes =
  | 'promote-track'
  | 'demote-track'
  | 'archive'
  | 'auto-artist-playlist'
  | 'process-playback-history'
  | 'add-playlist-to-inbox'
  | 'scan-playlists-for-inbox'
  | 'process-manual-triage'

declare interface ActionHistoryItemData {
  id: string
  created_at: number
  action: ActionTypes
  mutations: any[]
  ttl?: number
  undone?: boolean
  undone_at?: number
  originalActionId?: string
}

declare interface BasicTrackData {
  id: string
  uri: string
  name: string
  artist: string
  album: string
}

/**
 * Where a track sat and whether it was saved, captured either side of a
 * promote. `stage` is the lifecycle label the operator thinks in
 * (Unheard → Liked → Current, plus Removed for a track in neither playlist);
 * `inbox`/`current` are the raw playlist membership it was derived from, kept
 * so an odd combination is never lost behind the label. `saved` is an enum, not
 * a boolean, matching the codebase's `'liked' | 'unheard'` style.
 */
declare interface PromoteLocationSnapshotData {
  stage: 'unheard' | 'liked' | 'current' | 'removed'
  saved: 'saved' | 'unsaved'
  inbox: 'present' | 'absent'
  current: 'present' | 'absent'
}

declare interface PromoteActionHistoryItemData extends ActionHistoryItemData {
  action: 'promote-track' | 'demote-track'
  item?: BasicTrackData
  /** The track's location + saved status read just before the promote ran. */
  before?: PromoteLocationSnapshotData
  /**
   * The location + saved status measured by re-reading Spotify after the
   * promote's mutations ran. Absent when that re-read failed — a failed
   * after-read must never stop the history row from being written.
   */
  after?: PromoteLocationSnapshotData
}

/**
 * A pointer into `action_history` for one recorded promote, stored newest-first
 * in a capped list on the user row (`recentPromotesV1`) so the promotes feed
 * can read the true most-recent promotes without the forbidden 96 MB Scan.
 * `id` is the already-`gId`-wrapped partition key, so it BatchGets directly.
 */
declare interface RecentPromoteRef {
  id: string
  created_at: number
}
