import React, { useState } from 'react'
import { useActionHistory, useUndoAction } from '../hooks/useSpotifyData'
import { useQueryClient } from '@tanstack/react-query'
import MutationsModal from './MutationsModal'

// ActionHistory component showing recent actions with undo capability
function ActionHistory() {
  const { data, isLoading, error, refetch, isRefetching } = useActionHistory(50)
  const undoAction = useUndoAction()
  const queryClient = useQueryClient()
  
  // State for modal
  const [selectedAction, setSelectedAction] = useState<any>(null)
  const [showMutationsModal, setShowMutationsModal] = useState(false)

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading action history...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
        Error loading action history: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    )
  }

  if (!data || data.actions.length === 0) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Action History</h2>
        <div className="text-center py-12">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No actions yet</h3>
          <p className="mt-1 text-sm text-gray-500">
            Start by promoting or demoting tracks to see your action history.
          </p>
        </div>
      </div>
    )
  }

  // Format timestamp to readable date/time
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = diffMs / (1000 * 60 * 60)
    
    // If less than 24 hours ago, show relative time
    if (diffHours < 1) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60))
      if (diffMinutes < 1) return 'Just now'
      return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`
    } else if (diffHours < 24) {
      const hours = Math.floor(diffHours)
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`
    }
    
    // Otherwise show full date
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Get action display name and icon
  const getActionDisplay = (action: string) => {
    const displays: Record<string, { name: string; icon: string; color: string }> = {
      'promote-track': { 
        name: 'Promoted Track', 
        icon: '⬆️',
        color: 'text-green-600'
      },
      'demote-track': { 
        name: 'Demoted Track', 
        icon: '⬇️',
        color: 'text-red-600'
      },
      'archive': { 
        name: 'Archived Tracks', 
        icon: '📦',
        color: 'text-purple-600'
      },
      'process-playback-history': { 
        name: 'Processed Playback', 
        icon: '🎵',
        color: 'text-blue-600'
      },
      'add-playlist-to-inbox': { 
        name: 'Added to Inbox', 
        icon: '📥',
        color: 'text-indigo-600'
      },
      'scan-playlists-for-inbox': { 
        name: 'Scanned for Inbox', 
        icon: '🔍',
        color: 'text-gray-600'
      },
      'process-manual-triage': { 
        name: 'Manual Triage', 
        icon: '🏷️',
        color: 'text-yellow-600'
      },
    }
    return displays[action] || { name: action, icon: '📝', color: 'text-gray-600' }
  }

  // Check if action can be undone
  const canUndo = (action: any) => {
    return (action.action === 'promote-track' || action.action === 'demote-track') && 
           !action.undone &&
           action.item
  }

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
        <h2 className="text-lg font-medium text-gray-900">Action History</h2>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {isRefetching ? (
            <>
              <svg className="animate-spin -ml-0.5 mr-2 h-4 w-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Refreshing...
            </>
          ) : (
            <>
              <svg className="-ml-0.5 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </>
          )}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Time
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Action
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Details
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.actions.map((action) => (
              <tr key={action.id + action.created_at} className={action.undone ? 'bg-gray-50' : ''}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatDate(action.created_at)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <div className="flex items-center">
                    <span className="mr-2">{getActionDisplay(action.action).icon}</span>
                    <span className={getActionDisplay(action.action).color}>
                      {getActionDisplay(action.action).name}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-900">
                  {action.item && (
                    <div>
                      <div className="font-medium">{action.item.name}</div>
                      <div className="text-gray-500">
                        {action.item.artist} - {action.item.album}
                      </div>
                    </div>
                  )}
                  {action.mutations && action.mutations.length > 0 && (
                    <button
                      onClick={() => {
                        setSelectedAction(action)
                        setShowMutationsModal(true)
                      }}
                      className="text-sm text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none"
                    >
                      {action.mutations.length} mutation{action.mutations.length !== 1 ? 's' : ''}
                    </button>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {action.undone ? (
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                      Undone
                    </span>
                  ) : (
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                      Completed
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  {canUndo(action) && (
                    <button
                      onClick={() => {
                        const [actionType, actionId] = action.id.split(':').slice(1)
                        undoAction.mutate({ 
                          actionId: `${actionType}:${actionId}`,
                          actionType: action.action === 'promote-track' ? 'promote' : 'demote'
                        }, {
                          onSuccess: () => {
                            // Refresh the action history after undo
                            queryClient.invalidateQueries({ queryKey: ['actionHistory'] })
                          }
                        })
                      }}
                      disabled={undoAction.isPending}
                      className="text-indigo-600 hover:text-indigo-900 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Undo
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Mutations Modal */}
      {selectedAction && (
        <MutationsModal
          isOpen={showMutationsModal}
          onClose={() => {
            setShowMutationsModal(false)
            setSelectedAction(null)
          }}
          mutations={selectedAction.mutations || []}
          actionType={selectedAction.action}
          actionTime={selectedAction.created_at}
        />
      )}
    </div>
  )
}

export default ActionHistory