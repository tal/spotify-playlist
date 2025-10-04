import React from 'react'
import { useDashboard, useProcessPlayback, useArchiveTracks } from '../hooks/useSpotifyData'

// Dashboard component showing overview of playlists and quick actions
function Dashboard() {
  const { data, isLoading, error } = useDashboard()
  const processPlayback = useProcessPlayback()
  const archiveTracks = useArchiveTracks()

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
        Error loading dashboard: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      {/* User Info */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">User Information</h2>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-gray-500">Display Name</dt>
            <dd className="mt-1 text-sm text-gray-900">{data.user.display_name}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Email</dt>
            <dd className="mt-1 text-sm text-gray-900">{data.user.email}</dd>
          </div>
        </dl>
      </div>

      {/* Playlist Stats */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Playlist Overview</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="bg-gray-50 rounded-lg p-4">
            <dt className="text-sm font-medium text-gray-500">Inbox</dt>
            <dd className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-semibold text-gray-900">
                {data.playlists.inbox?.tracks.total || 0}
              </span>
              <span className="text-sm text-gray-500">tracks</span>
            </dd>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <dt className="text-sm font-medium text-gray-500">Current</dt>
            <dd className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-semibold text-gray-900">
                {data.playlists.current?.tracks.total || 0}
              </span>
              <span className="text-sm text-gray-500">tracks</span>
            </dd>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <dt className="text-sm font-medium text-gray-500">Starred</dt>
            <dd className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-semibold text-gray-900">
                {data.playlists.starred?.tracks.total || 0}
              </span>
              <span className="text-sm text-gray-500">tracks</span>
            </dd>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => processPlayback.mutate()}
            disabled={processPlayback.isPending}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processPlayback.isPending ? 'Processing...' : 'Process Playback History'}
          </button>
          <button
            onClick={() => archiveTracks.mutate()}
            disabled={archiveTracks.isPending}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {archiveTracks.isPending ? 'Archiving...' : 'Archive Old Tracks'}
          </button>
        </div>
        {(processPlayback.isSuccess || archiveTracks.isSuccess) && (
          <div className="mt-3 text-sm text-green-600">
            Action completed successfully!
          </div>
        )}
        {(processPlayback.isError || archiveTracks.isError) && (
          <div className="mt-3 text-sm text-red-600">
            Error executing action. Please try again.
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Configuration</h2>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-gray-500">Archive After</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {Math.round(data.config.timeToArchive / (24 * 60 * 60 * 1000))} days
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Total Playlists</dt>
            <dd className="mt-1 text-sm text-gray-900">{data.stats.totalPlaylists}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

export default Dashboard