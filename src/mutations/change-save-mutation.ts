import { SaveTrackMutation } from './save-track-mutation'
import { UnsaveTrackMutation } from './unsave-track-mutation'

export type ChangeSaveMutation = SaveTrackMutation | UnsaveTrackMutation
