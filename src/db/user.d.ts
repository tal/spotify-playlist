declare interface UserSpotifyAuthData {
  refreshToken: string
  accessToken: string
  expiresAt: number
}

declare interface UserData {
  id: string
  spotifyAuth: UserSpotifyAuthData
  lastPlayedAtProcessedTimestamp: number
}
