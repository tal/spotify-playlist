export type NormalizedActionError = {
  statusCode: number
  errorMessage: string
}

export function normalizeActionError(err: unknown): NormalizedActionError {
  if (typeof err === 'string') {
    // Business logic errors (like "cannot promote if confirmed") should be 400
    return {
      statusCode:
        err.includes('cannot') ||
        err.includes('no track') ||
        err.includes('not found')
          ? 400
          : 500,
      errorMessage: err,
    }
  }

  if (err instanceof Error) {
    return { statusCode: 500, errorMessage: err.message }
  }

  if (err && typeof err === 'object') {
    return { statusCode: 500, errorMessage: JSON.stringify(err) }
  }

  return { statusCode: 500, errorMessage: 'Unknown error occurred' }
}
