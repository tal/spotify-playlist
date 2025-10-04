import React, { useState } from 'react'
import { usePlaylists } from '../hooks/useSpotifyData'

// PlaylistViewer component for browsing user playlists
function PlaylistViewer() {
  const { data, isLoading, error } = usePlaylists()
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'tracks'>('name')

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading playlists...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
        Error loading playlists: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    )
  }

  if (!data || data.playlists.length === 0) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Playlists</h2>
        <p className="text-gray-500">No playlists found.</p>
      </div>
    )
  }

  // Filter and sort playlists
  const filteredPlaylists = data.playlists
    .filter(playlist => 
      playlist.name.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name)
      } else {
        return b.tracks.total - a.tracks.total
      }
    })

  return (
    <div className="space-y-4">
      {/* Header with search and sort */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-3 sm:space-y-0">
          <h2 className="text-lg font-medium text-gray-900">Playlists</h2>
          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
            <input
              type="text"
              placeholder="Search playlists..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'tracks')}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="name">Sort by Name</option>
              <option value="tracks">Sort by Track Count</option>
            </select>
          </div>
        </div>
      </div>

      {/* Playlist grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredPlaylists.map((playlist) => (
          <div key={playlist.id} className="bg-white shadow rounded-lg p-6 hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-start">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-gray-900 truncate">
                  {playlist.name}
                </h3>
                {playlist.description && (
                  <p className="mt-1 text-sm text-gray-500 line-clamp-2">
                    {playlist.description}
                  </p>
                )}
              </div>
              <div className="ml-4 flex-shrink-0">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  {playlist.tracks.total} tracks
                </span>
              </div>
            </div>
            <div className="mt-4 text-xs text-gray-500">
              Owner: {playlist.owner.display_name || playlist.owner.id}
            </div>
            <div className="mt-4 flex space-x-2">
              <a
                href={`https://open.spotify.com/playlist/${playlist.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-600 hover:text-indigo-900"
              >
                Open in Spotify →
              </a>
            </div>
          </div>
        ))}
      </div>

      {filteredPlaylists.length === 0 && searchTerm && (
        <div className="bg-white shadow rounded-lg p-6 text-center text-gray-500">
          No playlists found matching "{searchTerm}"
        </div>
      )}
    </div>
  )
}

export default PlaylistViewer