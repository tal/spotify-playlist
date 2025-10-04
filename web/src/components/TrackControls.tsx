import React from 'react'
import { useCurrentTrack, usePromoteTrack, useDemoteTrack } from '../hooks/useSpotifyData'

// TrackControls component for quick promote/demote actions on current track
function TrackControls() {
  const { data: currentTrack } = useCurrentTrack()
  const promoteTrack = usePromoteTrack()
  const demoteTrack = useDemoteTrack()

  // Don't show controls if no track is playing
  if (!currentTrack?.playing || !currentTrack.track) {
    return null
  }

  return (
    <div className="flex items-center space-x-4">
      <div className="text-sm text-gray-600 max-w-xs truncate">
        <span className="font-medium">{currentTrack.track.name}</span>
        <span className="text-gray-500"> • {currentTrack.track.artists}</span>
      </div>
      <div className="flex space-x-2">
        <button
          onClick={() => promoteTrack.mutate()}
          disabled={promoteTrack.isPending}
          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Promote current track"
        >
          {promoteTrack.isPending ? (
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          )}
        </button>
        <button
          onClick={() => demoteTrack.mutate()}
          disabled={demoteTrack.isPending}
          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Demote current track"
        >
          {demoteTrack.isPending ? (
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}

export default TrackControls