import { RetryConfig } from './retry'

export interface SpotifyRetryOptions {
  savedTracks?: RetryConfig
  default?: RetryConfig
}

// Default configurations for different Spotify operations
export const SPOTIFY_RETRY_DEFAULTS: SpotifyRetryOptions = {
  savedTracks: {
    maxRetries: 5,
    initialDelay: 2000, // Start with 2 seconds
    maxDelay: 120000, // Cap at 2 minutes
    backoffMultiplier: 2.5, // More aggressive backoff for large operations
  },
  default: {
    maxRetries: 3,
    initialDelay: 1000, // Start with 1 second
    maxDelay: 30000, // Cap at 30 seconds
    backoffMultiplier: 2,
  },
}

// Allow overriding via environment variables
export function getSpotifyRetryConfig(): SpotifyRetryOptions {
  const config = { ...SPOTIFY_RETRY_DEFAULTS }

  // Override from environment if present
  if (process.env.SPOTIFY_RETRY_MAX_RETRIES) {
    const maxRetries = parseInt(process.env.SPOTIFY_RETRY_MAX_RETRIES, 10)
    if (!isNaN(maxRetries)) {
      config.default!.maxRetries = maxRetries
      config.savedTracks!.maxRetries = maxRetries
    }
  }

  if (process.env.SPOTIFY_RETRY_INITIAL_DELAY) {
    const initialDelay = parseInt(process.env.SPOTIFY_RETRY_INITIAL_DELAY, 10)
    if (!isNaN(initialDelay)) {
      config.default!.initialDelay = initialDelay
      config.savedTracks!.initialDelay = initialDelay * 2 // Saved tracks get double initial delay
    }
  }

  if (process.env.SPOTIFY_RETRY_MAX_DELAY) {
    const maxDelay = parseInt(process.env.SPOTIFY_RETRY_MAX_DELAY, 10)
    if (!isNaN(maxDelay)) {
      config.default!.maxDelay = maxDelay
      config.savedTracks!.maxDelay = maxDelay * 4 // Saved tracks get 4x max delay
    }
  }

  if (process.env.SPOTIFY_RETRY_BACKOFF_MULTIPLIER) {
    const backoffMultiplier = parseFloat(
      process.env.SPOTIFY_RETRY_BACKOFF_MULTIPLIER,
    )
    if (!isNaN(backoffMultiplier)) {
      config.default!.backoffMultiplier = backoffMultiplier
      config.savedTracks!.backoffMultiplier = Math.min(
        backoffMultiplier * 1.25,
        3,
      ) // Slightly more aggressive for saved tracks
    }
  }

  return config
}
