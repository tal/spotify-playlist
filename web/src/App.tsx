import React from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './components/Dashboard'
import ActionHistory from './components/ActionHistory'
import PlaylistViewer from './components/PlaylistViewer'
import TrackControls from './components/TrackControls'

// Main App component that sets up routing and layout
function App() {
  return (
    <div className="min-h-screen bg-gray-100">
      {/* Navigation Header */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-bold text-gray-900">Spotify Playlist Manager</h1>
              </div>
              <div className="ml-6 flex space-x-8">
                <NavLink
                  to="/"
                  className={({ isActive }) =>
                    `inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                      isActive
                        ? 'border-indigo-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    }`
                  }
                >
                  Dashboard
                </NavLink>
                <NavLink
                  to="/playlists"
                  className={({ isActive }) =>
                    `inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                      isActive
                        ? 'border-indigo-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    }`
                  }
                >
                  Playlists
                </NavLink>
                <NavLink
                  to="/history"
                  className={({ isActive }) =>
                    `inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                      isActive
                        ? 'border-indigo-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    }`
                  }
                >
                  Action History
                </NavLink>
              </div>
            </div>
            <div className="flex items-center">
              <TrackControls />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/playlists" element={<PlaylistViewer />} />
          <Route path="/history" element={<ActionHistory />} />
        </Routes>
      </main>
    </div>
  )
}

export default App