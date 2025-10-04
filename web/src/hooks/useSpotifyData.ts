import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

// Custom hooks for fetching and mutating Spotify data
// Uses React Query for caching, background refetching, and optimistic updates

// Hook to fetch dashboard data
export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboard,
    refetchInterval: 30000, // Refetch every 30 seconds
  })
}

// Hook to fetch action history
export function useActionHistory(limit = 20) {
  return useQuery({
    queryKey: ['actionHistory', limit],
    queryFn: () => api.getActionHistory(limit),
    refetchInterval: 10000, // Refetch every 10 seconds
  })
}

// Hook to fetch playlists
export function usePlaylists() {
  return useQuery({
    queryKey: ['playlists'],
    queryFn: api.getPlaylists,
  })
}

// Hook to fetch current playing track
export function useCurrentTrack() {
  return useQuery({
    queryKey: ['currentTrack'],
    queryFn: api.getCurrentTrack,
    refetchInterval: 5000, // Refetch every 5 seconds
  })
}

// Hook to promote current track
export function usePromoteTrack() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: api.promoteTrack,
    onSuccess: () => {
      // Invalidate relevant queries after success
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['actionHistory'] })
      queryClient.invalidateQueries({ queryKey: ['currentTrack'] })
    },
  })
}

// Hook to demote current track
export function useDemoteTrack() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: api.demoteTrack,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['actionHistory'] })
      queryClient.invalidateQueries({ queryKey: ['currentTrack'] })
    },
  })
}

// Hook to archive tracks
export function useArchiveTracks() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: api.archiveTracks,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['actionHistory'] })
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
    },
  })
}

// Hook to process playback history
export function useProcessPlayback() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: api.processPlayback,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['actionHistory'] })
    },
  })
}

// Hook to undo an action
export function useUndoAction() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ actionId, actionType }: { actionId?: string; actionType?: 'promote' | 'demote' }) =>
      api.undoAction(actionId, actionType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['actionHistory'] })
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
    },
  })
}