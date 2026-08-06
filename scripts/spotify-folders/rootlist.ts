/**
 * Private-API rootlist transport for the History-folder tool.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WRITES ARE ENABLED. `WRITE_MODE` (below) is `'enabled'`, and the write   │
 * │ path in the sibling `apply.ts` is live, gated at the CLI by the          │
 * │ `--apply` flag (a bare invocation is still a read-only dry run). The     │
 * │ `rootlist/changes` protocol `apply.ts` speaks was transcribed from two   │
 * │ real DevTools captures on 2026-08-06 — but `spclient.wg.spotify.com` is  │
 * │ still an UNOFFICIAL, unversioned, private endpoint that can break at any │
 * │ time. `WRITE_MODE` and `RootlistWritesDisabledError` remain as a         │
 * │ defence-in-depth kill switch: flip the constant back to `'disabled'`     │
 * │ and every write path throws before it builds a request.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `spclient.wg.spotify.com` is an undocumented, unsupported endpoint. Every
 * type and header in this file is transcribed from a real capture against the
 * live account on 2026-08-04 (see `__tests__/fixtures/rootlist.sample.json`
 * and `docs/rootlist-capture.md`), NOT from the plan's illustrative sketch and
 * NOT from third-party blog posts.
 *
 * What the capture proved about the GET:
 *
 * - `Authorization: Bearer <token>` is REQUIRED. Omitting it returns 401 with
 *   an empty body and no content-type.
 * - `Accept: application/json` is REQUIRED to get JSON. With `*​/*`, with
 *   `application/protobuf`, or with no Accept header at all, the same URL
 *   returns 200 `application/octet-stream` carrying protobuf. Decoding that is
 *   explicitly out of scope, so a non-JSON content-type is a hard failure here.
 * - `client-token` and `app-platform` are NOT required. `client-token` is sent
 *   when supplied because the eventual write path is expected to want it.
 * - The user id must be URL-encoded into the path.
 * - `contents.truncated` is the authoritative partial-read signal. Paging on
 *   `&from=&length=` works, but pagination is NOT implemented in this pass, so
 *   any truncation signal is a loud failure rather than silent partial data.
 *
 * Secret handling: no function here ever logs, attaches, or serializes request
 * headers, the bearer, the client-token, or a raw `Request`. Response excerpts
 * in errors are bounded and run through a redactor that is seeded with the live
 * credential values, so an echoed token cannot escape into a log line.
 */

import { retryWithBackoff } from '../../src/utils/retry'

// ---------------------------------------------------------------------------
// Wire types — a faithful mirror of the captured JSON
// ---------------------------------------------------------------------------
//
// The project prefers string-literal unions over booleans for OUR OWN state.
// The `truncated` / `public` / `collaborative` fields below are the exception
// on purpose: they are a transcription of Spotify's JSON, and re-modelling a
// wire boolean as a union would misrepresent the payload. Every union in this
// file that describes tool behaviour is a string-literal union.

/**
 * One rootlist entry. `uri` is either a playlist URI or a folder marker:
 *
 *   spotify:playlist:<base62>
 *   spotify:start-group:<hex id>:<encoded name>   (name segment is OPTIONAL)
 *   spotify:end-group:<hex id>
 *
 * Marker parsing belongs to the planner, not the transport.
 */
export type RootlistItem = {
  uri: string
}

/** `metaItems[i].attributes` — only the fields the tool reads are named. */
export type RootlistMetaItemAttributes = {
  name?: string
  description?: string
  collaborative?: boolean
  [key: string]: unknown
}

/**
 * Decoration for `items[i]`, POSITIONALLY PARALLEL to it.
 *
 * Two captured traps the planner must survive, which is why almost everything
 * here is optional:
 *
 * 1. Folder markers get `{}` — an empty object with no keys at all. A folder's
 *    name therefore exists ONLY inside the start-group URI.
 * 2. An inaccessible playlist gets a metaItem with NO `attributes` and NO
 *    `revision`, just a `statusCode` of 404 or 403. Two such entries existed in
 *    the live capture. Code that assumes `attributes.name` exists will crash or
 *    silently produce a null name.
 */
export type RootlistMetaItem = {
  revision?: string
  attributes?: RootlistMetaItemAttributes
  length?: number
  ownerUsername?: string
  capabilities?: Record<string, unknown>
  statusCode?: number
}

export type RootlistContents = {
  /** Offset of the first returned entry. `0` for a complete read. */
  pos: number
  /** Authoritative partial-read signal. */
  truncated: boolean
  items: RootlistItem[]
  /** Parallel to `items`; present only because `decorate=` is supplied. */
  metaItems: RootlistMetaItem[]
}

/**
 * The validated GET response body.
 *
 * `revision` is base64 of 24 bytes: a 4-byte big-endian change counter followed
 * by a 20-byte digest. It is NOT a credential and is safe to log and snapshot.
 *
 * `length` is the TOTAL library size, not the number of entries returned —
 * comparing it against `contents.items.length` is one of the completeness
 * checks below.
 */
export type RootlistSnapshot = {
  revision: string
  length: number
  attributes: Record<string, unknown>
  contents: RootlistContents
  /** Milliseconds epoch, as a string. */
  timestamp?: string
}

// ---------------------------------------------------------------------------
// Credentials and request options
// ---------------------------------------------------------------------------

/**
 * Short-lived web-player credentials, captured from DevTools.
 *
 * These values are secrets. They are held in memory, placed into request
 * headers, and fed to the excerpt redactor — and never anywhere else.
 */
export type RootlistCredentials = {
  /** Raw bearer, WITHOUT the "Bearer " prefix. */
  accessToken: string
  /** Optional: proven unnecessary for the GET, kept for the write path. */
  clientToken?: string
}

/** A structurally minimal `fetch`, so tests can drive the transport offline. */
export type RootlistFetch = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: string
    signal?: AbortSignal
  },
) => Promise<Response>

export type RootlistRequestOptions = {
  /** Per-attempt bound, enforced with `AbortSignal.timeout()`. */
  timeoutMs?: number
  /**
   * TOTAL attempts, not retries-after-the-first. `retryWithBackoff` loops
   * `for (attempt = 1; attempt <= maxRetries; attempt++)`
   * (`src/utils/retry.ts:66`), so its `maxRetries: 5` means five attempts.
   */
  maxAttempts?: number
  initialDelayMs?: number
  /** Injection seam for tests. Defaults to global `fetch`. */
  fetch?: RootlistFetch
}

export const DEFAULT_ROOTLIST_TIMEOUT_MS = 15_000
export const DEFAULT_ROOTLIST_MAX_ATTEMPTS = 3
export const DEFAULT_ROOTLIST_INITIAL_DELAY_MS = 1_000

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

export const SPCLIENT_ORIGIN = 'https://spclient.wg.spotify.com'

/**
 * Verbatim from the capture. Deliberately a literal rather than
 * `URLSearchParams`, which would percent-encode the commas in `decorate` into
 * `%2C` and change the request the server actually sees.
 */
const ROOTLIST_QUERY =
  '?decorate=revision,attributes,length,owner,capabilities,status_code&market=from_token'

export function buildRootlistUrl(userId: string): string {
  return `${SPCLIENT_ORIGIN}/playlist/v2/user/${encodeURIComponent(
    userId,
  )}/rootlist${ROOTLIST_QUERY}`
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type RootlistOperation = 'get-rootlist' | 'post-rootlist-changes'

export type RootlistFailureKind =
  /** Connection refused, DNS, reset, TLS — the request never completed. */
  | 'network'
  /** The per-attempt `AbortSignal.timeout()` fired. */
  | 'timeout'
  /** 401 or 403. FATAL — recapture credentials. Never retried. */
  | 'unauthorized'
  /** 429. */
  | 'rate-limited'
  /** Any 5xx. Only 503 is retried. */
  | 'server-error'
  /** Any other non-2xx. */
  | 'http-error'
  /** Wrong content-type, or a body that is not parseable JSON. */
  | 'not-json'
  /** Parsed, but failed the runtime shape check. */
  | 'invalid-shape'
  /** A complete read was not returned and pagination is not implemented. */
  | 'truncated'

export type RootlistRetryDisposition = 'retryable' | 'fatal'

/**
 * The complete set of fields that may ever leave this module in a log or an
 * error report. Notably absent: request headers, credentials, URLs carrying a
 * user id, raw `Request`/`Response` objects, and cURL reproductions.
 */
export type RootlistSafeErrorFields = {
  operation: RootlistOperation
  kind: RootlistFailureKind
  disposition: RootlistRetryDisposition
  message: string
  status?: number
  requestId?: string
  contentType?: string
  /** Bounded and redacted. See `redactExcerpt`. */
  excerpt?: string
}

export type RootlistRetryEvent = {
  attempt: number
  nextDelayMs: number
  error: RootlistSafeErrorFields
}

export class RootlistTransportError extends Error {
  readonly details: Omit<RootlistSafeErrorFields, 'message'>

  constructor(
    message: string,
    details: Omit<RootlistSafeErrorFields, 'message'>,
  ) {
    super(message)
    this.name = 'RootlistTransportError'
    this.details = details
  }

  /** The only sanctioned way to serialize this error. */
  toSafeFields = (): RootlistSafeErrorFields => ({
    ...this.details,
    message: this.message,
  })
}

/**
 * Thrown by `postRootlistChanges()` as its very first statement while this
 * build is read-only. Not a `RootlistTransportError`: no request was made, so
 * there is no status, no response, and nothing to redact.
 */
export class RootlistWritesDisabledError extends Error {
  readonly operation: RootlistOperation = 'post-rootlist-changes'

  constructor(message: string) {
    super(message)
    this.name = 'RootlistWritesDisabledError'
  }
}

export const RECAPTURE_INSTRUCTIONS =
  'Recapture them in Chrome: open.spotify.com → DevTools → Network → any spclient.wg.spotify.com request → Request Headers → copy `authorization` (without the leading "Bearer ") and `client-token`, then re-export SPOTIFY_SPCLIENT_TOKEN and SPOTIFY_CLIENT_TOKEN and re-run. This is fatal and is never retried.'

// ---------------------------------------------------------------------------
// Retry ownership
// ---------------------------------------------------------------------------
//
// `retryWithBackoff` merges `{ ...DEFAULT_CONFIG, ...config }`
// (`src/utils/retry.ts:63`), so supplying an option cleanly REPLACES the
// default. Both overrides below are mandatory, not stylistic:
//
//  - The default `shouldRetry` returns true on `statusCode === 401`
//    (`src/utils/retry.ts:23-27`) AND on messages containing 'access token
//    expired' / 'invalid_token' (`:35-40`). Left alone it would hammer a dead
//    bearer, which is the exact opposite of what this tool needs. Only network
//    errors, 429 and 503 are retried here; 401/403 are fatal.
//  - The default `onRetry` logs `error.message || error` (`:54`), dumping the
//    whole error object whenever `message` is falsy. Ours logs only the
//    normalized safe fields.
//
// One default is NOT overridable and is worth knowing: a `retry-after` response
// header is honoured for the delay regardless of `shouldRetry`
// (`src/utils/retry.ts:89-95`). That is harmless — these errors never carry one
// in the shape that code looks for.

/**
 * The retry decision, as a string union. `retryWithBackoff` needs a boolean
 * predicate, so the call site adapts this; the union is the public contract.
 *
 * Anything that is not a `RootlistTransportError` — a programming error, a
 * validation bug — is fatal. Only failures this module deliberately normalized
 * are eligible.
 */
export function classifyRootlistRetry(
  error: unknown,
): RootlistRetryDisposition {
  if (!(error instanceof RootlistTransportError)) return 'fatal'
  return error.details.disposition
}

function dispositionFor(
  kind: RootlistFailureKind,
  status?: number,
): RootlistRetryDisposition {
  switch (kind) {
    case 'network':
    case 'timeout':
    case 'rate-limited':
      return 'retryable'
    case 'server-error':
      // Only 503. A 500 from an undocumented endpoint is far more likely to be
      // a rejected request than a transient blip, and replaying it is noise.
      return status === 503 ? 'retryable' : 'fatal'
    default:
      return 'fatal'
  }
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const MAX_EXCERPT_LENGTH = 400

/**
 * The non-empty credential values held on a `RootlistCredentials`.
 *
 * The single source of truth for "which literal strings must be scrubbed",
 * shared by the redactor and by the backup credential-free assertion so the two
 * can never disagree. The threshold is `length > 0`, deliberately the SAFER of
 * the two former thresholds: a short secret is still a secret, so it is still
 * redacted.
 */
export function credentialLiterals(credentials: RootlistCredentials): string[] {
  return [credentials.accessToken, credentials.clientToken].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
}

/**
 * Build a redactor seeded with the live credential values.
 *
 * Belt and braces, in order:
 *  1. Literal replacement of the actual bearer / client-token, so a body that
 *     echoes a credential back cannot leak it.
 *  2. Structural scrubbing of token-ish JSON fields and `Bearer <...>` runs,
 *     for credentials this call does not know about (cookies, a refresh token
 *     in an error envelope).
 *  3. Whitespace collapse, control-character stripping, and a hard length cap.
 */
export function buildRedactor(credentials: RootlistCredentials) {
  const literals = credentialLiterals(credentials)

  return function redactExcerpt(raw: string): string {
    let text = raw

    for (const literal of literals) {
      text = text.split(literal).join('[redacted]')
    }

    text = text
      .replace(/Bearer\s+[\w.\-+/=]+/gi, 'Bearer [redacted]')
      .replace(
        /("(?:[\w-]*(?:token|authorization|cookie|secret|password)[\w-]*)"\s*:\s*)"[^"]*"/gi,
        '$1"[redacted]"',
      )
      // Strip C0/C1 control characters so an excerpt can never inject
      // escape sequences or newlines into a log line.
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return text.length > MAX_EXCERPT_LENGTH
      ? `${text.slice(0, MAX_EXCERPT_LENGTH)}…[truncated]`
      : text
  }
}

/**
 * Not proven by the capture — the 200 responses carried no obvious correlation
 * header. Probed defensively so a support-worthy failure has an id if one
 * exists, and simply absent otherwise.
 */
const REQUEST_ID_HEADERS = [
  'x-request-id',
  'x-spotify-request-id',
  'spotify-request-id',
  'x-correlation-id',
]

export function requestIdFrom(response: Response): string | undefined {
  for (const header of REQUEST_ID_HEADERS) {
    const value = response.headers.get(header)
    if (value) return value
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------
//
// TypeScript interfaces do not validate private-API data. Everything the
// planner dereferences is checked here, at the boundary, once.

export type RootlistValidation =
  | { outcome: 'valid'; snapshot: RootlistSnapshot }
  | { outcome: 'invalid'; reason: string }

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Minimum runtime shape check. Pure and exported so fixtures and the planner's
 * tests can exercise it without a network.
 *
 * Unknown extra keys are tolerated deliberately — the live response carries
 * decoration fields this tool never reads, and rejecting them would make the
 * transport brittle against a harmless Spotify-side addition.
 */
export function validateRootlistSnapshot(body: unknown): RootlistValidation {
  if (!isPlainObject(body))
    return { outcome: 'invalid', reason: 'body is not a JSON object' }

  if (typeof body.revision !== 'string' || body.revision.length === 0) {
    return { outcome: 'invalid', reason: 'missing or empty `revision`' }
  }

  if (
    typeof body.length !== 'number' ||
    !Number.isFinite(body.length) ||
    body.length < 0
  ) {
    return {
      outcome: 'invalid',
      reason: '`length` is not a non-negative number',
    }
  }

  const contents = body.contents
  if (!isPlainObject(contents)) {
    return { outcome: 'invalid', reason: 'missing `contents` object' }
  }

  if (typeof contents.pos !== 'number' || !Number.isFinite(contents.pos)) {
    return { outcome: 'invalid', reason: '`contents.pos` is not a number' }
  }

  if (typeof contents.truncated !== 'boolean') {
    // The completeness gate below depends on this field. A missing `truncated`
    // is worse than a `true` one: it means the tool cannot tell.
    return {
      outcome: 'invalid',
      reason: '`contents.truncated` is not a boolean',
    }
  }

  if (!Array.isArray(contents.items)) {
    return { outcome: 'invalid', reason: '`contents.items` is not an array' }
  }

  if (!Array.isArray(contents.metaItems)) {
    return {
      outcome: 'invalid',
      reason: '`contents.metaItems` is not an array',
    }
  }

  // The planner reads folder names from `items[i].uri` and playlist names from
  // `metaItems[i].attributes.name` by INDEX. If the arrays ever drift apart,
  // every name is silently attached to the wrong URI.
  if (contents.metaItems.length !== contents.items.length) {
    return {
      outcome: 'invalid',
      reason: `parallel arrays disagree: ${contents.items.length} items vs ${contents.metaItems.length} metaItems`,
    }
  }

  for (let index = 0; index < contents.items.length; index++) {
    const item: unknown = contents.items[index]
    if (!isPlainObject(item)) {
      return { outcome: 'invalid', reason: `items[${index}] is not an object` }
    }
    if (typeof item.uri !== 'string' || item.uri.length === 0) {
      return {
        outcome: 'invalid',
        reason: `items[${index}].uri is missing or empty`,
      }
    }
  }

  for (let index = 0; index < contents.metaItems.length; index++) {
    const meta: unknown = contents.metaItems[index]
    // `{}` is expected at every folder marker, and a `statusCode`-only object is
    // expected for inaccessible playlists. Only a non-object is a violation.
    if (!isPlainObject(meta)) {
      return {
        outcome: 'invalid',
        reason: `metaItems[${index}] is not an object`,
      }
    }
  }

  return {
    outcome: 'valid',
    snapshot: {
      revision: body.revision,
      length: body.length,
      attributes: isPlainObject(body.attributes) ? body.attributes : {},
      contents: contents as unknown as RootlistContents,
      timestamp:
        typeof body.timestamp === 'string' ? body.timestamp : undefined,
    },
  }
}

export type RootlistCompleteness =
  | { outcome: 'complete' }
  | { outcome: 'partial'; reason: string }

/**
 * Full pagination is NOT implemented in this pass. A partial read must
 * therefore be a hard, loud failure — silently planning against two-thirds of a
 * library would compute moves from a false picture of where playlists live.
 *
 * Three independent signals, all treated as fatal:
 *  - `contents.truncated` — the authoritative one.
 *  - `contents.pos !== 0` — the response starts partway through.
 *  - `items.length !== length` — `length` is the TOTAL library size.
 *
 * The fix, if this ever fires, is to page on `&from=&length=` (proven to work:
 * `from=0&length=5` returned five items with `truncated: true`, `pos: 0`) and
 * concatenate — not to relax this check.
 */
export function checkRootlistCompleteness(
  snapshot: RootlistSnapshot,
): RootlistCompleteness {
  const { contents } = snapshot

  if (contents.truncated) {
    return {
      outcome: 'partial',
      reason: `server set contents.truncated (returned ${contents.items.length} of ${snapshot.length} entries from offset ${contents.pos})`,
    }
  }

  if (contents.pos !== 0) {
    return {
      outcome: 'partial',
      reason: `response starts at offset ${contents.pos}, not 0`,
    }
  }

  if (contents.items.length !== snapshot.length) {
    return {
      outcome: 'partial',
      reason: `returned ${contents.items.length} entries but the library holds ${snapshot.length}`,
    }
  }

  return { outcome: 'complete' }
}

// ---------------------------------------------------------------------------
// GET — the only request this build ever sends
// ---------------------------------------------------------------------------

/**
 * Read the complete rootlist for `userId`.
 *
 * Safe GET, so it goes through `retryWithBackoff` with both overrides supplied.
 * Throws `RootlistTransportError` on every failure path; the thrown error is
 * always safe to serialize with `toSafeFields()`.
 */
export async function getRootlist(
  userId: string,
  credentials: RootlistCredentials,
  options: RootlistRequestOptions = {},
): Promise<RootlistSnapshot> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_ROOTLIST_TIMEOUT_MS
  const maxAttempts = options.maxAttempts ?? DEFAULT_ROOTLIST_MAX_ATTEMPTS
  const doFetch =
    options.fetch ?? (globalThis.fetch as unknown as RootlistFetch)
  const redact = buildRedactor(credentials)

  const url = buildRootlistUrl(userId)

  const headers: Record<string, string> = {
    // Proven required. Omitting it returns 401 with an empty body.
    authorization: `Bearer ${credentials.accessToken}`,
    // Proven required for JSON. Without it the same URL returns protobuf as
    // application/octet-stream, which this tool cannot decode.
    accept: 'application/json',
  }
  if (credentials.clientToken) {
    headers['client-token'] = credentials.clientToken
  }

  const attempt = async (): Promise<RootlistSnapshot> => {
    let response: Response
    try {
      response = await doFetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (cause: unknown) {
      const name = (cause as { name?: string })?.name
      const kind: RootlistFailureKind =
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
      throw new RootlistTransportError(
        kind === 'timeout'
          ? `rootlist GET exceeded its ${timeoutMs}ms timeout`
          : 'rootlist GET failed before a response was received',
        {
          operation: 'get-rootlist',
          kind,
          disposition: dispositionFor(kind),
        },
      )
    }

    const contentType = response.headers.get('content-type') ?? undefined
    const requestId = requestIdFrom(response)

    // Read once and keep the text: it is both the JSON source and the only
    // material available for a redacted excerpt on the failure paths.
    let bodyText: string
    try {
      bodyText = await response.text()
    } catch {
      throw new RootlistTransportError(
        'rootlist GET response body could not be read to completion',
        {
          operation: 'get-rootlist',
          kind: 'network',
          disposition: 'retryable',
          status: response.status,
          requestId,
          contentType,
        },
      )
    }

    // Redaction runs only when a failure branch actually needs an excerpt, so
    // the success path never pays for it. Never slices the body before
    // redacting: the redactor must see the whole text or a credential straddling
    // a slice boundary would survive.
    const excerptOf = () => (bodyText.length > 0 ? redact(bodyText) : undefined)

    // Native fetch does NOT throw on HTTP errors.
    if (!response.ok) {
      const kind = httpFailureKind(response.status)
      throw new RootlistTransportError(
        messageForHttpFailure(kind, response.status),
        {
          operation: 'get-rootlist',
          kind,
          disposition: dispositionFor(kind, response.status),
          status: response.status,
          requestId,
          contentType,
          excerpt: excerptOf(),
        },
      )
    }

    if (
      !contentType ||
      !contentType.toLowerCase().includes('application/json')
    ) {
      throw new RootlistTransportError(
        `rootlist GET returned ${contentType ?? 'no content-type'} instead of application/json — the Accept header was dropped or Spotify changed the endpoint; protobuf decoding is out of scope`,
        {
          operation: 'get-rootlist',
          kind: 'not-json',
          disposition: 'fatal',
          status: response.status,
          requestId,
          contentType,
          excerpt: excerptOf(),
        },
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(bodyText)
    } catch {
      throw new RootlistTransportError(
        'rootlist GET returned a JSON content-type with an unparseable body',
        {
          operation: 'get-rootlist',
          kind: 'not-json',
          disposition: 'fatal',
          status: response.status,
          requestId,
          contentType,
          excerpt: excerptOf(),
        },
      )
    }

    const validation = validateRootlistSnapshot(parsed)
    if (validation.outcome === 'invalid') {
      throw new RootlistTransportError(
        `rootlist GET response failed validation: ${validation.reason}`,
        {
          operation: 'get-rootlist',
          kind: 'invalid-shape',
          disposition: 'fatal',
          status: response.status,
          requestId,
          contentType,
          excerpt: excerptOf(),
        },
      )
    }

    const completeness = checkRootlistCompleteness(validation.snapshot)
    if (completeness.outcome === 'partial') {
      throw new RootlistTransportError(
        `rootlist GET returned a partial library and pagination is not implemented: ${completeness.reason}`,
        {
          operation: 'get-rootlist',
          kind: 'truncated',
          disposition: 'fatal',
          status: response.status,
          requestId,
          contentType,
        },
      )
    }

    return validation.snapshot
  }

  return retryWithBackoff(attempt, {
    maxRetries: maxAttempts,
    initialDelay: options.initialDelayMs ?? DEFAULT_ROOTLIST_INITIAL_DELAY_MS,
    // MANDATORY override — see the retry-ownership note above.
    shouldRetry: (error: unknown) =>
      classifyRootlistRetry(error) === 'retryable',
    // MANDATORY override — the default dumps the raw error object.
    onRetry: (error: unknown, attemptNumber: number, nextDelayMs: number) => {
      defaultRetryLog({
        attempt: attemptNumber,
        nextDelayMs,
        error:
          error instanceof RootlistTransportError
            ? error.toSafeFields()
            : {
                operation: 'get-rootlist',
                kind: 'network',
                disposition: 'fatal',
                message: 'unclassified error (not raised by this transport)',
              },
      })
    },
  })
}

export function httpFailureKind(status: number): RootlistFailureKind {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'server-error'
  return 'http-error'
}

function messageForHttpFailure(
  kind: RootlistFailureKind,
  status: number,
): string {
  if (kind === 'unauthorized') {
    return `Spotify rejected the rootlist request with HTTP ${status}. The web-player bearer and/or client-token is expired or invalid. ${RECAPTURE_INSTRUCTIONS}`
  }
  if (kind === 'rate-limited') {
    return `rootlist GET was rate limited (HTTP ${status})`
  }
  // 'server-error' and any other non-2xx share the same generic message.
  return `rootlist GET failed with HTTP ${status}`
}

function defaultRetryLog(event: RootlistRetryEvent): void {
  // Only normalized safe fields. The raw error never reaches a log line.
  console.warn(
    `[rootlist] retry ${event.attempt} in ${event.nextDelayMs}ms —`,
    JSON.stringify(event.error),
  )
}

// ===========================================================================
// WRITE GATE
// ===========================================================================
//
// `WRITE_MODE` is the single module-level constant that gates every write, and
// `RootlistWritesDisabledError` (declared in the Errors section above) is what a
// would-be writer hits when it is `'disabled'`.
//
// Writes are now ENABLED. The write path — `postRootlistChanges`, the pure
// request builder, and the convergence loop — lives in the sibling `apply.ts`,
// which imports `WRITE_MODE` and `RootlistWritesDisabledError` from here. The
// CLI's `--apply` flag is the primary gate; this constant is the defence-in-depth
// kill switch beneath it. Setting it back to `'disabled'` makes
// `postRootlistChanges` (and `convergeMovePlan`) throw before constructing a
// request, with no other code change required.
//
// The type stays the union `'disabled' | 'enabled'` (NOT narrowed with
// `as const`) so the gated code in `apply.ts` still typechecks both arms.

export const WRITE_MODE: 'disabled' | 'enabled' = 'enabled'
