declare type ActionTypes = 'promote-track'

declare interface ActionHistoryItemData {
  id: string
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
  action: 'promote-track'
  item?: TrackData
}
