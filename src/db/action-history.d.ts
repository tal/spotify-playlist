declare type ActionTypes = 'promote-track' | 'demote-track' | 'archive'

declare interface ActionHistoryItemData {
  id: string
  created_at: number
  action: ActionTypes
}

declare interface TrackData {
  id: string
  uri: string
  name: string
  artist: string
  album: string
}

declare interface PromoteActionHistoryItemData extends ActionHistoryItemData {
  action: 'promote-track' | 'demote-track'
  item?: TrackData
}
