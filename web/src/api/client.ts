// API client for communicating with the Lambda backend
// Handles all HTTP requests to the API endpoints

const API_BASE_URL = import.meta.env.DEV ? '/api' : '/api'

// Generic fetch wrapper with error handling
async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `API error: ${response.status}`)
  }

  return response.json()
}

// Dashboard data
export interface DashboardData {
  user: {
    id: string
    display_name: string
    email: string
  }
  playlists: {
    inbox: PlaylistSummary | null
    current: PlaylistSummary | null
    starred: PlaylistSummary | null
  }
  stats: {
    totalPlaylists: number
    recentActionsCount: number
  }
  config: {
    inbox: string
    current: string
    releaseRadar: string
    discoverWeekly: string
    starred: string
    timeToArchive: number
  }
}

export interface PlaylistSummary {
  id: string
  name: string
  tracks: {
    total: number
  }
}

export interface ActionHistoryItem {
  id: string
  created_at: number
  action: string
  mutations: any[]
  undone?: boolean
  undone_at?: number
  item?: {
    id: string
    name: string
    artist: string
    album: string
  }
}

export interface Playlist {
  id: string
  name: string
  description: string | null
  tracks: {
    total: number
  }
  owner: {
    id: string
    display_name?: string
  }
}

export interface CurrentTrack {
  playing: boolean
  track?: {
    id: string
    name: string
    artists: string
    album: string
    uri: string
  }
  progress_ms?: number
  is_playing?: boolean
}

// API client methods
export const api = {
  // Get dashboard data
  getDashboard: () => fetchAPI<DashboardData>('/dashboard'),

  // Get recent action history
  getActionHistory: (limit = 20) => 
    fetchAPI<{ actions: ActionHistoryItem[] }>(`/actions/recent?limit=${limit}`),

  // Get all playlists
  getPlaylists: () => fetchAPI<{ playlists: Playlist[] }>('/playlists'),

  // Get current playing track
  getCurrentTrack: () => fetchAPI<CurrentTrack>('/tracks/current'),

  // Trigger actions
  promoteTrack: () => 
    fetchAPI('/actions/promote', { method: 'POST' }),

  demoteTrack: () => 
    fetchAPI('/actions/demote', { method: 'POST' }),

  archiveTracks: () => 
    fetchAPI('/actions/archive', { method: 'POST' }),

  processPlayback: () => 
    fetchAPI('/actions/process-playback', { method: 'POST' }),

  undoAction: (actionId?: string, actionType?: 'promote' | 'demote') => 
    fetchAPI('/actions/undo', {
      method: 'POST',
      body: JSON.stringify({ actionId, actionType }),
    }),
}