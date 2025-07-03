import { delay } from './delay'

export interface RetryConfig {
  maxRetries?: number
  initialDelay?: number
  maxDelay?: number
  backoffMultiplier?: number
  shouldRetry?: (error: any) => boolean
  onRetry?: (error: any, attempt: number, nextDelay: number) => void
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxRetries: 5,
  initialDelay: 1000,
  maxDelay: 60000,
  backoffMultiplier: 2,
  shouldRetry: (error) => {
    // Retry on network errors, timeouts, and rate limits
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true
    }

    // Retry on 429 (rate limit) or 503 (service unavailable)
    if (error.statusCode === 429 || error.statusCode === 503) {
      return true
    }

    // Check for Spotify API specific rate limit headers
    const retryAfter =
      error.response?.headers?.['retry-after'] ?? error.headers?.['retry-after']
    if (retryAfter) {
      return true
    }

    return false
  },
  onRetry: (error, attempt, nextDelay) => {
    console.log(
      `⚠️ Retry attempt ${attempt} after ${nextDelay}ms due to:`,
      error.message || error,
    )
  },
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config?: RetryConfig,
): Promise<T> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config }
  let lastError: any

  for (let attempt = 1; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error: any) {
      lastError = error

      // Check if we should retry
      if (!finalConfig.shouldRetry(error)) {
        throw error
      }

      // Check if we've exhausted retries
      if (attempt === finalConfig.maxRetries) {
        console.error(`❌ Failed after ${attempt} attempts`)
        throw error
      }

      // Calculate delay with exponential backoff
      let nextDelay =
        finalConfig.initialDelay *
        Math.pow(finalConfig.backoffMultiplier, attempt - 1)

      // Check for Spotify's retry-after header
      const retryAfterStr =
        error.response?.headers?.['retry-after'] ??
        error.headers?.['retry-after']
      if (retryAfterStr) {
        const retryAfterMs = parseInt(retryAfterStr, 10) * 1000
        nextDelay = Math.max(nextDelay, retryAfterMs + 100) // Add 100ms buffer
      }

      // Cap at maxDelay
      nextDelay = Math.min(nextDelay, finalConfig.maxDelay)

      // Notify about retry
      finalConfig.onRetry(error, attempt, nextDelay)

      // Wait before retrying
      await delay(nextDelay)
    }
  }

  throw lastError
}

// Specific helper for Spotify API calls with timeout handling
export async function retrySpotifyCall<T>(
  operation: () => Promise<T>,
  operationName: string,
  config?: RetryConfig,
): Promise<T> {
  return retryWithBackoff(operation, {
    ...config,
    onRetry: (error, attempt, nextDelay) => {
      const isTimeout =
        error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET'
      const isRateLimit =
        error.statusCode === 429 ||
        error.response?.headers?.['retry-after'] ||
        error.headers?.['retry-after']

      if (isTimeout) {
        console.log(
          `⏱️ ${operationName} timed out, retrying attempt ${attempt} after ${nextDelay}ms`,
        )
      } else if (isRateLimit) {
        console.log(
          `🚦 ${operationName} rate limited, retrying attempt ${attempt} after ${nextDelay}ms`,
        )
      } else {
        console.log(
          `⚠️ ${operationName} failed, retrying attempt ${attempt} after ${nextDelay}ms`,
        )
      }
    },
  })
}
