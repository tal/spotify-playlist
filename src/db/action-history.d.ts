declare type ActionTypes =
  | 'promote-track'
  | 'demote-track'
  | 'archive'
  | 'auto-artist-playlist'

declare interface ActionHistoryItemData {
  id: string
  created_at: number
  action: ActionTypes
  ttl?: number
}

declare interface BasicTrackData {
  id: string
  uri: string
  name: string
  artist: string
  album: string
}

declare interface PromoteActionHistoryItemData extends ActionHistoryItemData {
  action: 'promote-track' | 'demote-track'
  item?: BasicTrackData
}
