/**
 * WRITE PATH for the History-folder tool — ENABLED.
 *
 * This module holds the ENTIRE write capability: the `rootlist/changes` POST,
 * the pre-write backup, the write-authorization token, and the convergence
 * loop. Writes are reachable ONLY through the CLI `--apply` flag; the default
 * dry-run path never imports the dispatch here. Deleting this one file removes
 * the write capability entirely.
 *
 * The `rootlist/changes` protocol below was TRANSCRIBED from two real DevTools
 * captures of the web player on 2026-08-06 — a plain in-folder drag and a
 * drag-onto-folder — not guessed (see docs/rootlist-capture.md). It is still an
 * UNOFFICIAL, private Spotify endpoint with no stability guarantee: it can
 * change or break at any time, so responses are validated and the loop fails
 * closed.
 *
 * Safety, still enforced now that writes are on:
 *
 *   1. `postRootlistChanges` performs EXACTLY ONE HTTP attempt and never passes
 *      through `retryWithBackoff`. An unknown outcome (timeout, reset, aborted
 *      response) is answered by re-reading live state, never by blind replay.
 *   2. `convergeMovePlan` re-reads live state every iteration, writes a
 *      credential-free backup before the first POST, stops on 401/403, and is
 *      bounded by a stall detector and a runaway backstop.
 *   3. `WRITE_MODE` (rootlist.ts) is defense in depth: set it back to
 *      'disabled' and `postRootlistChanges` throws before constructing anything,
 *      and `authorizeWrites` returns `null` so the loop cannot be entered.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { planHistoryMoves, type MovePlan, type PlanOptions } from './planner'
import {
  buildRedactor,
  credentialLiterals,
  DEFAULT_ROOTLIST_TIMEOUT_MS,
  getRootlist,
  httpFailureKind,
  isPlainObject,
  RECAPTURE_INSTRUCTIONS,
  requestIdFrom,
  RootlistTransportError,
  RootlistWritesDisabledError,
  SPCLIENT_ORIGIN,
  WRITE_MODE,
  type RootlistCredentials,
  type RootlistFailureKind,
  type RootlistFetch,
  type RootlistRequestOptions,
  type RootlistSnapshot,
} from './rootlist'
import { formatFailure } from './move-archives-to-folder'
import { delay } from '../../src/utils/delay'

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

/**
 * The `rootlist/changes` endpoint — same host/path base as the rootlist GET,
 * with `/changes` appended.
 */
export function buildRootlistChangesUrl(userId: string): string {
  return `${SPCLIENT_ORIGIN}/playlist/v2/user/${encodeURIComponent(
    userId,
  )}/rootlist/changes`
}

// ---------------------------------------------------------------------------
// Wire types — TRANSCRIBED from real captures (docs/rootlist-capture.md)
// ---------------------------------------------------------------------------

/**
 * A reference to a rootlist entry inside a MOV op. Both the moved item and the
 * anchor use this shape. `attributes` is sent EMPTY on the wire, even though the
 * rootlist GET decorates items with `timestamp`/`public` — the captures show
 * `{}` here.
 */
export type RootlistItemRef = { uri: string; attributes: Record<string, never> }

/**
 * A move operation. `items` are placed immediately AFTER `addAfterItem`.
 *
 * To prepend into a folder, `addAfterItem.uri` is the folder's start-group
 * marker in ID-ONLY form — `spotify:start-group:<folderId>`, WITHOUT the
 * `:<name>` suffix the rootlist GET shows. That lands the moved items as the
 * folder's first children (top). See `buildStartGroupAnchorUri`.
 */
export type RootlistMovOp = {
  kind: 'MOV'
  mov: {
    items: RootlistItemRef[]
    addAfterItem: RootlistItemRef
  }
}

/** One delta batch. `info.source.client` is the literal the web player sends. */
export type RootlistDelta = {
  ops: RootlistMovOp[]
  info: { source: { client: 'WEBPLAYER' } }
}

/**
 * The `rootlist/changes` request body. No `baseRevision` — the captures carry
 * none, and concurrency is handled by the convergence loop re-reading live
 * state after every write.
 */
export type RootlistChangeRequest = {
  deltas: RootlistDelta[]
}

export type RootlistChangeResponse = {
  /** The revision the server ended up at, if it reports one. */
  revision?: string
}

/**
 * The front-of-folder anchor. ID-ONLY: the captures anchor to
 * `spotify:start-group:e4c4d8863c6daee1` (no name), while the rootlist GET
 * renders the same marker as `spotify:start-group:<id>:<name>`. Building it from
 * the id — never by reusing the GET's marker URI verbatim — is what keeps the
 * write well-formed.
 */
export function buildStartGroupAnchorUri(folderId: string): string {
  return `spotify:start-group:${folderId}`
}

/**
 * Build the request that prepends one archive playlist to the top of History.
 * Pure, so the exact wire shape is a golden test rather than a runtime surprise.
 */
export function buildPrependRequest(
  archiveUri: string,
  historyFolderId: string,
): RootlistChangeRequest {
  return {
    deltas: [
      {
        ops: [
          {
            kind: 'MOV',
            mov: {
              items: [{ uri: archiveUri, attributes: {} }],
              addAfterItem: {
                uri: buildStartGroupAnchorUri(historyFolderId),
                attributes: {},
              },
            },
          },
        ],
        info: { source: { client: 'WEBPLAYER' } },
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// POST — one attempt, gated by WRITE_MODE
// ---------------------------------------------------------------------------

/**
 * Apply one delta batch of rootlist changes.
 *
 * Throws `RootlistWritesDisabledError` first if `WRITE_MODE` is 'disabled'
 * (defense in depth). Otherwise performs EXACTLY ONE HTTP attempt and never
 * passes through `retryWithBackoff`. A write whose outcome is unknown (timeout,
 * reset, aborted response) may have committed; replaying it could double-apply a
 * move. Recovery belongs to the caller's convergence loop, which re-reads live
 * state and recomputes, not to a generic retry wrapper.
 */
export async function postRootlistChanges(
  userId: string,
  credentials: RootlistCredentials,
  request: RootlistChangeRequest,
  options: RootlistRequestOptions = {},
): Promise<RootlistChangeResponse> {
  // FIRST STATEMENT. No URL, no headers, no body, no fetch above this line.
  if (WRITE_MODE === 'disabled') {
    throw new RootlistWritesDisabledError(
      [
        'Rootlist writes are hard-disabled in this build.',
        'WRITE_MODE is set to disabled in scripts/spotify-folders/rootlist.ts,',
        'so no URL, headers, body, or request were constructed and nothing was sent.',
        'This tool is read-only by deliberate choice; enabling writes means editing',
        'that one constant and re-reviewing the still-unproven change payload.',
      ].join(' '),
    )
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_ROOTLIST_TIMEOUT_MS
  const doFetch =
    options.fetch ?? (globalThis.fetch as unknown as RootlistFetch)
  const redact = buildRedactor(credentials)

  const headers: Record<string, string> = {
    authorization: `Bearer ${credentials.accessToken}`,
    accept: 'application/json',
    'content-type': 'application/json',
  }
  if (credentials.clientToken) {
    headers['client-token'] = credentials.clientToken
  }

  let response: Response
  try {
    response = await doFetch(buildRootlistChangesUrl(userId), {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (cause: unknown) {
    const name = (cause as { name?: string })?.name
    const kind: RootlistFailureKind =
      name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
    // Deliberately 'fatal': the request may have COMMITTED before the failure.
    // The caller must re-read live state, never replay.
    throw new RootlistTransportError(
      'rootlist changes POST produced no response; the write may or may not have committed — re-read live state before any further write',
      {
        operation: 'post-rootlist-changes',
        kind,
        disposition: 'fatal',
      },
    )
  }

  const contentType = response.headers.get('content-type') ?? undefined
  const requestId = requestIdFrom(response)
  const bodyText = await response.text().catch(() => '')
  // Lazy, so redaction runs only on the failure branches that need an excerpt.
  // Never slices the body before redacting — a credential straddling a slice
  // boundary would survive.
  const excerptOf = () => (bodyText.length > 0 ? redact(bodyText) : undefined)

  if (!response.ok) {
    const kind = httpFailureKind(response.status)
    throw new RootlistTransportError(
      kind === 'unauthorized'
        ? `Spotify rejected the rootlist write with HTTP ${response.status}. ${RECAPTURE_INSTRUCTIONS}`
        : `rootlist changes POST failed with HTTP ${response.status}`,
      {
        operation: 'post-rootlist-changes',
        kind,
        // Never retried at this layer, whatever the status.
        disposition: 'fatal',
        status: response.status,
        requestId,
        contentType,
        excerpt: excerptOf(),
      },
    )
  }

  if (bodyText.length === 0) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    throw new RootlistTransportError(
      'rootlist changes POST returned an unparseable body; the write may have committed — re-read live state',
      {
        operation: 'post-rootlist-changes',
        kind: 'not-json',
        disposition: 'fatal',
        status: response.status,
        requestId,
        contentType,
        excerpt: excerptOf(),
      },
    )
  }

  const revision =
    isPlainObject(parsed) && typeof parsed.revision === 'string'
      ? parsed.revision
      : undefined

  return { revision }
}

// ---------------------------------------------------------------------------
// Backup — written only immediately before a real write
// ---------------------------------------------------------------------------

const BACKUP_DIR = join(
  homedir(),
  'Library',
  'Application Support',
  'spotify-playlist',
  'rootlist-backups',
)

/** Owner-only, because the file records the exact shape of a private library. */
const BACKUP_DIR_MODE = 0o700
const BACKUP_FILE_MODE = 0o600

export type RootlistBackup = {
  capturedAt: string
  rootlistRevision: string
  /** The verbatim GET body. Credential-free: it is a response, never a request. */
  snapshot: RootlistSnapshot
  /** The plan computed against that exact revision. */
  plan: MovePlan
}

/**
 * Serialize the pre-write state.
 *
 * Pure and separately exported so the redaction property can be tested without
 * writing to a real home directory.
 */
export function buildRootlistBackup(
  snapshot: RootlistSnapshot,
  plan: MovePlan,
  capturedAt: Date,
): RootlistBackup {
  return {
    capturedAt: capturedAt.toISOString(),
    rootlistRevision: snapshot.revision,
    snapshot,
    plan,
  }
}

/**
 * Last-line defence, not the primary guarantee.
 *
 * The primary guarantee is structural: a `RootlistSnapshot` is a decoded
 * response body and a `MovePlan` is derived from it, so neither can contain a
 * request header. This scans the serialized text for the live secrets anyway,
 * because "cannot happen" is exactly the assumption that leaks a token.
 */
export function assertBackupIsCredentialFree(
  serialized: string,
  credentials: RootlistCredentials,
): void {
  for (const secret of credentialLiterals(credentials)) {
    if (serialized.includes(secret)) {
      // Deliberately does not name or echo which secret matched.
      throw new Error(
        'Refusing to write the rootlist backup: it contains credential material. This is a bug in the backup builder.',
      )
    }
  }
}

/**
 * DORMANT in this build — reachable only from the apply loop, which is itself
 * unreachable. Kept whole so that enabling writes does not also mean writing
 * the backup path from scratch under pressure.
 *
 * Returns the path so the caller can print it. Restoration is manual and out of
 * scope: this file is evidence, not an undo button.
 */
export async function writeRootlistBackup(
  snapshot: RootlistSnapshot,
  plan: MovePlan,
  credentials: RootlistCredentials,
  now: Date = new Date(),
): Promise<string> {
  const backup = buildRootlistBackup(snapshot, plan, now)
  const serialized = JSON.stringify(backup, null, 2)

  assertBackupIsCredentialFree(serialized, credentials)

  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const path = join(BACKUP_DIR, `${stamp}.json`)

  await mkdir(BACKUP_DIR, { recursive: true, mode: BACKUP_DIR_MODE })
  await writeFile(path, `${serialized}\n`, { mode: BACKUP_FILE_MODE })

  return path
}

// ---------------------------------------------------------------------------
// Write authorization — the type-level half of the gate
// ---------------------------------------------------------------------------

/**
 * A capability token for the apply loop.
 *
 * `convergeMovePlan` requires one, and `authorizeWrites` is the only producer.
 * While `WRITE_MODE === 'disabled'` that producer returns `null`, so there is
 * no value of this type anywhere in the program and the loop cannot be entered
 * even by a caller that ignores every comment in this file.
 */
export type WriteAuthorization = { readonly writeMode: 'enabled' }

export function authorizeWrites(): WriteAuthorization | null {
  if (WRITE_MODE === 'disabled') return null
  return { writeMode: 'enabled' }
}

// ---------------------------------------------------------------------------
// Apply loop — WRITTEN, GATED, UNREACHABLE
// ---------------------------------------------------------------------------
//
// The recovery semantics are reviewable code rather than a paragraph of intent:
//
//   - Every iteration re-reads live state. There is no blind replay, ever.
//   - A write whose outcome is UNKNOWN (timeout, reset, aborted response, 5xx
//     after dispatch) is treated as "it may have committed" and answered with a
//     fresh GET, never with "nothing changed".
//   - 401/403 stops the run immediately; a dead bearer is not a retry case.
//   - Two independent bounds, because one is not enough: a 19-move backfill
//     legitimately needs 19+ iterations, so a flat "5 attempts" cap would abort
//     it two-thirds applied.
//
// Each op front-prepends via the transcribed MOV protocol (see the wire types
// above): the archive is anchored after History's id-only start-group marker so
// it lands as the folder's first child.

/** Stall detector: iterations in a row that did not reduce the remaining work. */
const CONSECUTIVE_NO_PROGRESS_BOUND = 5

/** Runaway backstop only; a healthy run never approaches it. */
function totalIterationBound(plannedMoves: number): number {
  return 3 * plannedMoves + 10
}

const REGET_DELAY_MS = 1_000

export type ApplyOutcome =
  | { outcome: 'converged'; iterations: number; backupPath: string }
  | {
      outcome: 'stalled' | 'runaway' | 'unauthorized' | 'transport-failure'
      iterations: number
      backupPath: string
      report: string
    }

/**
 * Build the change request for one planned move. The tool is additive and
 * PREPENDS: the archive is moved to be the first child of History (anchored to
 * `spotify:start-group:<historyFolderId>`), on top of everything already filed
 * and without disturbing its order. One archive per request — no batching.
 */
export function requestForMove(
  plan: MovePlan,
  moveIndex: number,
): RootlistChangeRequest {
  const move = plan.moves[moveIndex]
  if (!move) {
    throw new Error(`No planned move at index ${moveIndex}`)
  }
  return buildPrependRequest(move.uri, plan.historyFolderId)
}

/**
 * The convergence loop. DELIBERATELY DORMANT — see the file header.
 *
 * Requires a `WriteAuthorization`, which cannot be obtained while
 * `WRITE_MODE === 'disabled'`. The runtime re-check below is redundant with
 * that and with `postRootlistChanges`'s own first statement; all three are kept.
 */
/**
 * Writes the pre-apply backup and returns its path. Injectable so a test can
 * exercise convergence without touching the real home directory; production
 * uses `writeRootlistBackup`.
 */
export type BackupWriter = (
  snapshot: RootlistSnapshot,
  plan: MovePlan,
  credentials: RootlistCredentials,
) => Promise<string>

export async function convergeMovePlan(
  userId: string,
  credentials: RootlistCredentials,
  initialSnapshot: RootlistSnapshot,
  initialPlan: MovePlan,
  planOptions: PlanOptions,
  authorization: WriteAuthorization,
  requestOptions: RootlistRequestOptions = {},
  writeBackup: BackupWriter = writeRootlistBackup,
): Promise<ApplyOutcome> {
  // Redundant belt #1. `authorization` already proves this, and it still gets
  // checked, because the cost of an extra branch is nothing next to the cost of
  // being wrong.
  if (WRITE_MODE === 'disabled' || authorization.writeMode !== 'enabled') {
    throw new RootlistWritesDisabledError(
      'convergeMovePlan was entered while WRITE_MODE is disabled in scripts/spotify-folders/rootlist.ts. Nothing was sent.',
    )
  }

  // Written once, before the first POST, against the state the plan was
  // computed from.
  const backupPath = await writeBackup(
    initialSnapshot,
    initialPlan,
    credentials,
  )

  const iterationBound = totalIterationBound(initialPlan.moves.length)
  let consecutiveNoProgress = 0
  let totalIterations = 0
  let remainingMoves = initialPlan.moves.length

  for (;;) {
    totalIterations += 1
    if (totalIterations > iterationBound) {
      return {
        outcome: 'runaway',
        iterations: totalIterations,
        backupPath,
        report: `Exceeded the runaway backstop of ${iterationBound} iterations with ${remainingMoves} move(s) still outstanding.`,
      }
    }

    // Step 1 — always re-read live state.
    let snapshot: RootlistSnapshot
    try {
      snapshot = await getRootlist(userId, credentials, requestOptions)
    } catch (error: unknown) {
      if (
        error instanceof RootlistTransportError &&
        error.details.kind === 'unauthorized'
      ) {
        return {
          outcome: 'unauthorized',
          iterations: totalIterations,
          backupPath,
          report: formatFailure(error),
        }
      }
      return {
        outcome: 'transport-failure',
        iterations: totalIterations,
        backupPath,
        report: formatFailure(error),
      }
    }

    // Step 2 — recompute from scratch. The previous plan is never reused.
    let plan: MovePlan
    try {
      plan = planHistoryMoves(snapshot, planOptions)
    } catch (error: unknown) {
      return {
        outcome: 'transport-failure',
        iterations: totalIterations,
        backupPath,
        report: formatFailure(error),
      }
    }

    // Step 3 — converged when live state has nothing left to move.
    if (plan.outcome === 'empty') {
      return { outcome: 'converged', iterations: totalIterations, backupPath }
    }

    // Progress accounting. Only a *reduction* in outstanding work counts;
    // an unchanged or larger plan is a stall, not progress.
    if (plan.moves.length < remainingMoves) {
      remainingMoves = plan.moves.length
      consecutiveNoProgress = 0
    } else {
      consecutiveNoProgress += 1
      if (consecutiveNoProgress > CONSECUTIVE_NO_PROGRESS_BOUND) {
        return {
          outcome: 'stalled',
          iterations: totalIterations,
          backupPath,
          report: `No progress in ${CONSECUTIVE_NO_PROGRESS_BOUND} consecutive iterations; ${plan.moves.length} move(s) still outstanding.`,
        }
      }
    }

    // Step 4 — send exactly one move, against the state just observed.
    // The plan lists moves in FINAL top-to-bottom order (newest first) and each
    // op front-prepends. Applying one per iteration and recomputing, the OLDEST
    // remaining (the last entry) must go first so the newest is prepended last
    // and ends up on top.
    const request = requestForMove(plan, plan.moves.length - 1)

    try {
      await postRootlistChanges(userId, credentials, request, requestOptions)
    } catch (error: unknown) {
      // Redundant belt #2: this is what actually fires in this build if the
      // loop is ever reached, because `postRootlistChanges` refuses first.
      if (error instanceof RootlistWritesDisabledError) throw error

      if (error instanceof RootlistTransportError) {
        // Step 7 — a dead credential is terminal, not retryable.
        if (error.details.kind === 'unauthorized') {
          return {
            outcome: 'unauthorized',
            iterations: totalIterations,
            backupPath,
            report: formatFailure(error),
          }
        }

        // Steps 5 and 6 — a stale revision, a timeout, a reset, an aborted
        // response, or a 5xx after dispatch all mean the SAME thing here: the
        // outcome is unknown and only a fresh GET can settle it. Fall through
        // to the next iteration rather than asserting nothing changed.
        await delay(REGET_DELAY_MS)
        continue
      }

      throw error
    }

    // The write reported success; the next iteration verifies it by reading.
    await delay(REGET_DELAY_MS)
  }
}
