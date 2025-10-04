import React from 'react'
import Modal from './Modal'
import { usePlaylists } from '../hooks/useSpotifyData'

interface MutationData {
  type: string
  mutationType: string
  data?: any
}

interface MutationsModalProps {
  isOpen: boolean
  onClose: () => void
  mutations: MutationData[]
  actionType: string
  actionTime: number
}

// Format mutation type into human-readable text
const getMutationDisplay = (mutation: MutationData) => {
  const displays: Record<string, { label: string; icon: string; color: string }> = {
    'remove-track': { label: 'Removed from playlist', icon: '➖', color: 'text-red-600' },
    'add-track': { label: 'Added to playlist', icon: '➕', color: 'text-green-600' },
    'save-track': { label: 'Saved to library', icon: '💚', color: 'text-green-600' },
    'unsave-track': { label: 'Removed from library', icon: '💔', color: 'text-red-600' },
    'triage-action': { label: 'Track triaged', icon: '🏷️', color: 'text-blue-600' },
    'move-track': { label: 'Moved between playlists', icon: '↔️', color: 'text-purple-600' },
    'add-track-listen': { label: 'Track listened', icon: '🎧', color: 'text-indigo-600' },
  }
  
  return displays[mutation.mutationType] || { 
    label: mutation.mutationType, 
    icon: '📝', 
    color: 'text-gray-600' 
  }
}

// Extract relevant information from mutation data
const getMutationDetails = (mutation: MutationData, playlistMap: Record<string, string>) => {
  const details: string[] = []
  
  if (mutation.data?.playlist?.id) {
    const playlistName = playlistMap[mutation.data.playlist.id] || 'Unknown Playlist'
    details.push(`Playlist: ${playlistName}`)
  }
  
  if (mutation.data?.track) {
    const track = mutation.data.track
    if (track.name) {
      details.push(`Track: ${track.name}`)
    }
    if (track.artists && track.artists[0]) {
      details.push(`Artist: ${track.artists[0].name}`)
    }
    if (track.album?.name) {
      details.push(`Album: ${track.album.name}`)
    }
  }
  
  if (mutation.data?.tracks && Array.isArray(mutation.data.tracks)) {
    const track = mutation.data.tracks[0]
    if (track?.name) {
      details.push(`Track: ${track.name}`)
      if (track.artists && track.artists[0]) {
        details.push(`Artist: ${track.artists[0].name}`)
      }
      if (track.album?.name) {
        details.push(`Album: ${track.album.name}`)
      }
    }
  }
  
  if (mutation.data?.actionType) {
    details.push(`Action: ${mutation.data.actionType}`)
  }
  
  // Handle add-track-listen mutation
  if (mutation.mutationType === 'add-track-listen' && mutation.data) {
    // Track info - note that the track object only contains the ID
    if (mutation.data.track?.id) {
      details.push(`Track ID: ${mutation.data.track.id}`)
    }
    
    // Context info (where the track was played from)
    if (mutation.data.context) {
      // Extract playlist ID from context URI
      if (mutation.data.context.uri && mutation.data.context.uri.includes('playlist:')) {
        const playlistId = mutation.data.context.uri.split(':').pop()
        const playlistName = playlistMap[playlistId || '']
        if (playlistName) {
          details.push(`Played from: ${playlistName}`)
        } else if (playlistId) {
          details.push(`Played from playlist: ${playlistId}`)
        }
      } else if (mutation.data.context.uri) {
        // Non-playlist context (album, artist radio, etc.)
        details.push(`Context: ${mutation.data.context.uri}`)
      }
      
      // Played at time
      if (mutation.data.context.played_at) {
        const playedAt = new Date(mutation.data.context.played_at).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
        details.push(`Played at: ${playedAt}`)
      }
    }
    
    // Increment info
    if (mutation.data.increment_by) {
      details.push(`Play count +${mutation.data.increment_by}`)
    }
  }
  
  return details
}

function MutationsModal({ isOpen, onClose, mutations, actionType, actionTime }: MutationsModalProps) {
  const { data: playlistsData } = usePlaylists()
  
  // Create a map of playlist ID to name
  const playlistMap = React.useMemo(() => {
    const map: Record<string, string> = {}
    if (playlistsData?.playlists) {
      playlistsData.playlists.forEach(playlist => {
        map[playlist.id] = playlist.name
      })
    }
    return map
  }, [playlistsData])
  
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title="Mutation Details"
    >
      <div className="space-y-4">
        {/* Action summary */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="text-sm text-gray-600">
            <div>Action: <span className="font-medium text-gray-900">{actionType}</span></div>
            <div>Time: <span className="font-medium text-gray-900">{formatDate(actionTime)}</span></div>
            <div>Total mutations: <span className="font-medium text-gray-900">{mutations.length}</span></div>
          </div>
        </div>

        {/* Mutations list */}
        <div className="space-y-3">
          {mutations.map((mutation, index) => {
            const display = getMutationDisplay(mutation)
            const details = getMutationDetails(mutation, playlistMap)
            
            return (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start">
                  <span className="text-2xl mr-3">{display.icon}</span>
                  <div className="flex-1">
                    <h4 className={`font-medium ${display.color}`}>
                      {display.label}
                    </h4>
                    {details.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {details.map((detail, idx) => (
                          <div key={idx} className="text-sm text-gray-600">
                            {detail}
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Show raw data in collapsible section for debugging */}
                    {mutation.data && (
                      <details className="mt-3">
                        <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                          View raw data
                        </summary>
                        <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                          {JSON.stringify(mutation.data, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

export default MutationsModal