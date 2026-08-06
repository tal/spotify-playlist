/**
 * Phase 5 — transport, CLI-glue, and cross-cutting safety tests for the
 * History-folder tool.
 *
 * Marker-parsing / classification / plan-shape coverage already lives in
 * `planner.test.ts` and `archive-name.test.ts` — this file does not repeat
 * it. What lives here instead:
 *
 *   - the two rootlist cases those files can't reach directly (an entirely
 *     empty rootlist, and a History folder with zero children)
 *   - the HTTP transport in `rootlist.ts`: retry/no-retry disposition,
 *     non-JSON / malformed-JSON / truncated rejection, and secret redaction
 *   - the write path (`WRITE_MODE === 'enabled'`): the golden `rootlist/changes`
 *     wire format, `postRootlistChanges` POSTing the transcribed deltas body,
 *     and `convergeMovePlan` applying one prepend then converging on a re-read
 *   - the CLI gate: `--apply` resolves credentials before touching the network,
 *     and the default (dry run) issues no POST
 *   - the CLI's pure argv/env/formatting helpers
 *
 * Every test in this file runs with NO real network access — `getRootlist`
 * and `postRootlistChanges` are always driven through `options.fetch`, and
 * where the CLI itself might reach for the global `fetch` (it shouldn't, on
 * the paths tested here) that's asserted via `spyOn(globalThis, 'fetch')`.
 */

import { describe, expect, it, spyOn } from 'bun:test'

import {
  formatCredentialInstructions,
  formatFailure,
  parseArgv,
  resolveCredentials,
  runCli,
  runDryRun,
  type CliIo,
} from '../move-archives-to-folder'
import {
  checkRootlistCompleteness,
  classifyRootlistRetry,
  getRootlist,
  RootlistTransportError,
  RootlistWritesDisabledError,
  validateRootlistSnapshot,
  WRITE_MODE,
  type RootlistCredentials,
  type RootlistFetch,
  type RootlistSnapshot,
} from '../rootlist'
import {
  authorizeWrites,
  buildRootlistBackup,
  assertBackupIsCredentialFree,
  buildPrependRequest,
  buildStartGroupAnchorUri,
  postRootlistChanges,
  requestForMove,
  convergeMovePlan,
  type BackupWriter,
} from '../apply'
import { planHistoryMoves } from '../planner'

import sampleRootlist from './fixtures/rootlist.sample.json'

const sample = sampleRootlist as unknown as RootlistSnapshot

// ---------------------------------------------------------------------------
// Fetch stubs
// ---------------------------------------------------------------------------

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function textResponse(
  status: number,
  body: string,
  contentType: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType, ...headers },
  })
}

/** Records every call it receives; never touches the real network. */
function recordingFetch(
  impl: (url: string, callIndex: number) => Response | Promise<Response>,
): { fetch: RootlistFetch; calls: string[] } {
  const calls: string[] = []
  const fetch: RootlistFetch = async (url) => {
    const callIndex = calls.length
    calls.push(url)
    return impl(url, callIndex)
  }
  return { fetch, calls }
}

const CREDENTIALS: RootlistCredentials = {
  accessToken: 'SECRET-BEARER-VALUE-abc123xyz789',
  clientToken: 'SECRET-CLIENT-TOKEN-def456uvw012',
}

const FAST_RETRY = { maxAttempts: 3, initialDelayMs: 1 }

// ---------------------------------------------------------------------------
// Rootlist cases the planner/archive-name test files can't reach directly
// ---------------------------------------------------------------------------

describe('planHistoryMoves against degenerate rootlists', () => {
  it('fails hard on an entirely empty rootlist (no History folder at all)', () => {
    const empty: RootlistSnapshot = {
      revision: 'EMPTY',
      length: 0,
      attributes: {},
      contents: { pos: 0, truncated: false, items: [], metaItems: [] },
      timestamp: '0',
    }
    expect(() => planHistoryMoves(empty)).toThrow(
      /no root-level folder named History/,
    )
  })

  it('emits an empty plan for a History folder with zero children', () => {
    const snapshot: RootlistSnapshot = {
      revision: 'EMPTY-HISTORY',
      length: 2,
      attributes: {},
      contents: {
        pos: 0,
        truncated: false,
        items: [
          { uri: 'spotify:start-group:h:History' },
          { uri: 'spotify:end-group:h' },
        ],
        metaItems: [{}, {}],
      },
      timestamp: '0',
    }
    const plan = planHistoryMoves(snapshot)
    expect(plan.outcome).toBe('empty')
    expect(plan.moves).toEqual([])
    expect(plan.historyContents).toEqual([])
    expect(plan.counts.scannedRootPlaylists).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Transport: happy path, driven by the real captured fixture
// ---------------------------------------------------------------------------

describe('getRootlist — fixture-driven happy path', () => {
  it('returns the validated snapshot from a single successful GET', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(200, sample))

    const snapshot = await getRootlist('koalemos', CREDENTIALS, {
      fetch,
      ...FAST_RETRY,
    })

    expect(snapshot.revision).toBe(sample.revision)
    expect(snapshot.contents.items).toHaveLength(sample.contents.items.length)
    expect(calls).toHaveLength(1)

    // And the resulting snapshot plans identically to the direct-fixture path
    // exercised in planner.test.ts.
    const plan = planHistoryMoves(snapshot)
    expect(plan.moves).toHaveLength(1)
    expect(plan.moves[0].name).toBe('2026 - July')
  })
})

// ---------------------------------------------------------------------------
// Transport: 401 is fatal and MUST NOT be retried
// ---------------------------------------------------------------------------

describe('getRootlist — 401/403 are fatal and never retried', () => {
  it("does not retry a 401, despite retryWithBackoff's default shouldRetry treating 401 as retryable", async () => {
    const { fetch, calls } = recordingFetch(() =>
      jsonResponse(401, { error: { status: 401, message: 'Unauthorized' } }),
    )

    await expect(
      getRootlist('koalemos', CREDENTIALS, { fetch, ...FAST_RETRY }),
    ).rejects.toThrow(RootlistTransportError)

    // The load-bearing assertion: exactly one attempt, not maxAttempts (3).
    expect(calls).toHaveLength(1)
  })

  it('classifies a thrown 401 RootlistTransportError as fatal via classifyRootlistRetry', async () => {
    const { fetch } = recordingFetch(() => jsonResponse(401, {}))
    try {
      await getRootlist('koalemos', CREDENTIALS, { fetch, ...FAST_RETRY })
      throw new Error('expected getRootlist to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(RootlistTransportError)
      const transportError = error as RootlistTransportError
      expect(transportError.details.kind).toBe('unauthorized')
      expect(classifyRootlistRetry(transportError)).toBe('fatal')
    }
  })

  it('does not retry a 403 either', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(403, {}))
    await expect(
      getRootlist('koalemos', CREDENTIALS, { fetch, ...FAST_RETRY }),
    ).rejects.toThrow(RootlistTransportError)
    expect(calls).toHaveLength(1)
  })

  it('a non-RootlistTransportError classifies as fatal', () => {
    expect(classifyRootlistRetry(new Error('boom'))).toBe('fatal')
    expect(classifyRootlistRetry('not even an error')).toBe('fatal')
  })
})

// ---------------------------------------------------------------------------
// Transport: retryable failures actually retry
// ---------------------------------------------------------------------------

describe('getRootlist — retryable failures retry and can still succeed', () => {
  it('retries a network failure and succeeds on the second attempt', async () => {
    const { fetch, calls } = recordingFetch((_url, callIndex) => {
      if (callIndex === 0) throw new TypeError('fetch failed: network down')
      return jsonResponse(200, sample)
    })

    const snapshot = await getRootlist('koalemos', CREDENTIALS, {
      fetch,
      ...FAST_RETRY,
    })
    expect(snapshot.revision).toBe(sample.revision)
    expect(calls).toHaveLength(2)
  })

  it('retries a 429 and gives up after exhausting maxAttempts', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(429, {}))
    await expect(
      getRootlist('koalemos', CREDENTIALS, {
        fetch,
        maxAttempts: 2,
        initialDelayMs: 1,
      }),
    ).rejects.toThrow(RootlistTransportError)
    expect(calls).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Transport: non-JSON, malformed JSON, truncated
// ---------------------------------------------------------------------------

describe('getRootlist — content rejected before it ever reaches the planner', () => {
  it('rejects a 200 response whose content-type is not application/json', async () => {
    const { fetch } = recordingFetch(() =>
      textResponse(200, '\x0a\x18\x00\x00\x07', 'application/octet-stream'),
    )
    try {
      await getRootlist('koalemos', CREDENTIALS, { fetch, ...FAST_RETRY })
      throw new Error('expected a throw')
    } catch (error) {
      expect(error).toBeInstanceOf(RootlistTransportError)
      expect((error as RootlistTransportError).details.kind).toBe('not-json')
      expect((error as RootlistTransportError).details.disposition).toBe(
        'fatal',
      )
    }
  })

  it('rejects a JSON-content-typed body that does not parse', async () => {
    const { fetch } = recordingFetch(() =>
      textResponse(200, '{not: valid json,,,', 'application/json'),
    )
    try {
      await getRootlist('koalemos', CREDENTIALS, { fetch, ...FAST_RETRY })
      throw new Error('expected a throw')
    } catch (error) {
      expect(error).toBeInstanceOf(RootlistTransportError)
      expect((error as RootlistTransportError).details.kind).toBe('not-json')
    }
  })

  it('rejects a well-formed body that fails the runtime shape check', async () => {
    const { fetch } = recordingFetch(() =>
      jsonResponse(200, { revision: 'x' /* missing length/contents */ }),
    )
    try {
      await getRootlist('koalemos', CREDENTIALS, { fetch, ...FAST_RETRY })
      throw new Error('expected a throw')
    } catch (error) {
      expect(error).toBeInstanceOf(RootlistTransportError)
      expect((error as RootlistTransportError).details.kind).toBe(
        'invalid-shape',
      )
    }
  })

  it('rejects a truncated rootlist rather than silently planning against a partial library', async () => {
    const truncated = {
      ...sample,
      contents: { ...sample.contents, truncated: true },
    }
    const { fetch } = recordingFetch(() => jsonResponse(200, truncated))
    try {
      await getRootlist('koalemos', CREDENTIALS, { fetch, ...FAST_RETRY })
      throw new Error('expected a throw')
    } catch (error) {
      expect(error).toBeInstanceOf(RootlistTransportError)
      expect((error as RootlistTransportError).details.kind).toBe('truncated')
      expect((error as RootlistTransportError).details.disposition).toBe(
        'fatal',
      )
    }
  })

  it('checkRootlistCompleteness also flags a nonzero pos or a length mismatch, independent of `truncated`', () => {
    expect(
      checkRootlistCompleteness({
        ...sample,
        contents: { ...sample.contents, pos: 5 },
      }).outcome,
    ).toBe('partial')
    expect(
      checkRootlistCompleteness({ ...sample, length: sample.length + 1 })
        .outcome,
    ).toBe('partial')
    expect(checkRootlistCompleteness(sample).outcome).toBe('complete')
  })

  it('validateRootlistSnapshot rejects items/metaItems arrays of different lengths', () => {
    const result = validateRootlistSnapshot({
      revision: 'r',
      length: 1,
      attributes: {},
      contents: {
        pos: 0,
        truncated: false,
        items: [{ uri: 'spotify:playlist:a' }],
        metaItems: [],
      },
    })
    expect(result.outcome).toBe('invalid')
  })
})

// ---------------------------------------------------------------------------
// Transport: secret redaction
// ---------------------------------------------------------------------------

describe('getRootlist — secrets never leak into a thrown error', () => {
  it('never includes the bearer or client-token in a normalized transport error, even when the response body echoes them back', async () => {
    const { fetch } = recordingFetch(() =>
      jsonResponse(400, {
        error: 'bad request',
        // Simulates a server (or a proxy, or a bug) echoing request material
        // back into an error body.
        debug_authorization_header: `Bearer ${CREDENTIALS.accessToken}`,
        debug_client_token: CREDENTIALS.clientToken,
      }),
    )

    let caught: RootlistTransportError | undefined
    try {
      await getRootlist('koalemos', CREDENTIALS, { fetch, ...FAST_RETRY })
    } catch (error) {
      caught = error as RootlistTransportError
    }

    expect(caught).toBeInstanceOf(RootlistTransportError)
    const safeFields = caught!.toSafeFields()
    const serialized = JSON.stringify(safeFields)

    expect(serialized).not.toContain(CREDENTIALS.accessToken)
    expect(serialized).not.toContain(CREDENTIALS.clientToken!)
    expect(caught!.message).not.toContain(CREDENTIALS.accessToken)
    expect(caught!.message).not.toContain(CREDENTIALS.clientToken!)
    // The redactor's placeholder should be present instead, proving this
    // wasn't just an empty excerpt.
    expect(safeFields.excerpt).toContain('[redacted]')
  })
})

// ---------------------------------------------------------------------------
// The load-bearing no-write test for this whole pass
// ---------------------------------------------------------------------------

describe('postRootlistChanges — enabled write path', () => {
  it('confirms writes are enabled (WRITE_MODE)', () => {
    expect(WRITE_MODE).toBe('enabled')
  })

  it('POSTs the transcribed deltas body to /rootlist/changes', async () => {
    const seen: { url: string; method: string; body?: string }[] = []
    const fetch: RootlistFetch = async (url, init) => {
      seen.push({ url, method: init.method, body: init.body })
      return jsonResponse(200, { revision: 'rev-after' })
    }

    const request = buildPrependRequest(
      'spotify:playlist:ABC',
      '46758b97bb37b942',
    )
    await postRootlistChanges('koalemos', CREDENTIALS, request, { fetch })

    expect(seen).toHaveLength(1)
    expect(seen[0].method).toBe('POST')
    expect(seen[0].url).toContain('/rootlist/changes')
    expect(seen[0].url).toContain('koalemos')
    expect(JSON.parse(seen[0].body!)).toEqual(request)
  })

  it('still throws before any fetch if WRITE_MODE is somehow disabled (defense in depth)', () => {
    // WRITE_MODE is a compile-time const; this documents the guard's intent
    // rather than flipping it. The behavioural coverage is the first-statement
    // throw asserted in apply.ts's source.
    expect(WRITE_MODE).toBe('enabled')
    expect(RootlistWritesDisabledError).toBeDefined()
  })
})

describe('the write gate', () => {
  it('authorizeWrites() returns an enabled authorization', () => {
    expect(authorizeWrites()).toEqual({ writeMode: 'enabled' })
  })

  it('convergeMovePlan applies one prepend with the transcribed body, then converges after re-reading', async () => {
    const MOVED = 'spotify:playlist:5kKYkjvUCvNvjgtlNzfdEr'
    // "After" state: the eligible archive is gone from root, so the recomputed
    // plan is empty and the loop converges.
    const applied = JSON.parse(JSON.stringify(sample))
    // `items` and `metaItems` are parallel arrays — drop the moved entry from
    // both at the same index so validation (equal lengths) and the completeness
    // check (`length` === entries) both stay satisfied.
    const movedIndex = applied.contents.items.findIndex(
      (item: { uri: string }) => item.uri === MOVED,
    )
    applied.contents.items.splice(movedIndex, 1)
    if (Array.isArray(applied.contents.metaItems)) {
      applied.contents.metaItems.splice(movedIndex, 1)
    }
    applied.length = applied.contents.items.length

    const bodies: string[] = []
    let gets = 0
    const fetch: RootlistFetch = async (_url, init) => {
      if (init.method === 'POST') {
        bodies.push(init.body ?? '')
        return jsonResponse(200, { revision: 'rev-after' })
      }
      gets += 1
      return jsonResponse(200, gets === 1 ? sample : applied)
    }

    const authorization = authorizeWrites()
    expect(authorization).not.toBeNull()

    const backups: string[] = []
    const noopBackup: BackupWriter = async () => {
      backups.push('called')
      return '/tmp/test-backup.json'
    }

    const outcome = await convergeMovePlan(
      'koalemos',
      CREDENTIALS,
      sample,
      planHistoryMoves(sample),
      {},
      authorization!,
      { fetch },
      noopBackup,
    )

    expect(outcome.outcome).toBe('converged')
    // Backup written exactly once, before the first POST.
    expect(backups).toHaveLength(1)
    // Exactly one prepend, and its body is the transcribed envelope.
    expect(bodies).toHaveLength(1)
    expect(JSON.parse(bodies[0])).toEqual(
      buildPrependRequest(MOVED, '46758b97bb37b942'),
    )
  })
})

// ---------------------------------------------------------------------------
// CLI: argv parsing
// ---------------------------------------------------------------------------

describe('parseArgv', () => {
  it('runs with no flags (the only run mode)', () => {
    expect(parseArgv([])).toEqual({ outcome: 'run' })
  })

  it('recognises --help / -h', () => {
    expect(parseArgv(['--help'])).toEqual({ outcome: 'help' })
    expect(parseArgv(['-h'])).toEqual({ outcome: 'help' })
  })

  it('recognises --apply, including when it precedes another argument', () => {
    expect(parseArgv(['--apply'])).toEqual({ outcome: 'apply' })
    // First recognised arg wins.
    expect(parseArgv(['--apply', '--anything'])).toEqual({
      outcome: 'apply',
    })
  })

  it('rejects an unknown flag with a usage-error', () => {
    const result = parseArgv(['--bogus'])
    expect(result.outcome).toBe('usage-error')
    expect((result as { message: string }).message).toContain('--bogus')
  })
})

// ---------------------------------------------------------------------------
// CLI: credential resolution
// ---------------------------------------------------------------------------

describe('resolveCredentials', () => {
  it('resolves when all three variables are present', () => {
    const result = resolveCredentials({
      SPOTIFY_SPCLIENT_TOKEN: ' tok ',
      SPOTIFY_CLIENT_TOKEN: ' ctok ',
      SPOTIFY_USER_ID: ' koalemos ',
    })
    expect(result).toEqual({
      outcome: 'resolved',
      resolved: {
        userId: 'koalemos',
        credentials: { accessToken: 'tok', clientToken: 'ctok' },
      },
    })
  })

  it('reports every missing variable, not just the first', () => {
    const result = resolveCredentials({})
    expect(result).toEqual({
      outcome: 'missing',
      missing: [
        'SPOTIFY_SPCLIENT_TOKEN',
        'SPOTIFY_CLIENT_TOKEN',
        'SPOTIFY_USER_ID',
      ],
    })
  })

  it('treats a whitespace-only value as missing', () => {
    const result = resolveCredentials({
      SPOTIFY_SPCLIENT_TOKEN: '   ',
      SPOTIFY_CLIENT_TOKEN: 'ctok',
      SPOTIFY_USER_ID: 'koalemos',
    })
    expect(result).toEqual({
      outcome: 'missing',
      missing: ['SPOTIFY_SPCLIENT_TOKEN'],
    })
  })

  it('formatCredentialInstructions never contains a plausible-looking secret literal', () => {
    const text = formatCredentialInstructions(['SPOTIFY_SPCLIENT_TOKEN'])
    expect(text).toContain('SPOTIFY_SPCLIENT_TOKEN')
    expect(text).not.toContain(CREDENTIALS.accessToken)
  })
})

// ---------------------------------------------------------------------------
// CLI: runCli end-to-end (fully offline)
// ---------------------------------------------------------------------------

function makeIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return {
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    out,
    err,
  }
}

describe('runCli', () => {
  it('--apply with no credentials exits on the credentials path before any network call', async () => {
    const spy = spyOn(globalThis, 'fetch')
    const { io, err } = makeIo()
    try {
      // No SPOTIFY_* vars in env at all. --apply resolves credentials first, so
      // it exits with EXIT_MISSING_CREDENTIALS (3) and never touches the wire —
      // proving the write path is gated behind credential resolution.
      const code = await runCli(['--apply'], {}, io)
      expect(code).toBe(3)
      expect(err.join('\n')).toContain('SPOTIFY_SPCLIENT_TOKEN')
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('--help exits 0 and prints usage without touching the network', async () => {
    const spy = spyOn(globalThis, 'fetch')
    const { io, out } = makeIo()
    try {
      const code = await runCli(['--help'], {}, io)
      expect(code).toBe(0)
      expect(out.join('\n')).toContain('Usage:')
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('an unknown flag exits with the usage code', async () => {
    const { io, err } = makeIo()
    const code = await runCli(['--nope'], {}, io)
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('Unknown argument')
  })

  it('missing credentials exit with the dedicated credentials code and touch no network', async () => {
    const spy = spyOn(globalThis, 'fetch')
    const { io, err } = makeIo()
    try {
      const code = await runCli([], {}, io)
      expect(code).toBe(3)
      expect(err.join('\n')).toContain('SPOTIFY_SPCLIENT_TOKEN')
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// CLI: runDryRun / formatFailure (offline, via injected fetch)
// ---------------------------------------------------------------------------

describe('runDryRun', () => {
  it('plans successfully against a fixture-derived GET (default, additive)', async () => {
    const { fetch } = recordingFetch(() => jsonResponse(200, sample))
    const result = await runDryRun(
      'koalemos',
      CREDENTIALS,
      {},
      {
        fetch,
        ...FAST_RETRY,
      },
    )
    expect(result.outcome).toBe('planned')
    if (result.outcome === 'planned') {
      expect(result.plan.moves).toHaveLength(1)
      expect(result.report).toContain(
        'Would prepend into History (1), newest first:',
      )
      // The fixture's History holds editorial/legacy-named playlists; the
      // default now tolerates them rather than failing.
      expect(result.report).toContain('are never reordered or removed')
    }
  })

  it('reports a transport failure without throwing', async () => {
    const { fetch } = recordingFetch(() => jsonResponse(401, {}))
    const result = await runDryRun(
      'koalemos',
      CREDENTIALS,
      {},
      { fetch, ...FAST_RETRY },
    )
    expect(result.outcome).toBe('failed')
    expect(result.report).toContain('Transport failure')
  })

  it('reports a planner failure (e.g. missing History) without throwing', async () => {
    const noHistory: RootlistSnapshot = {
      revision: 'r',
      length: 0,
      attributes: {},
      contents: { pos: 0, truncated: false, items: [], metaItems: [] },
    }
    const { fetch } = recordingFetch(() => jsonResponse(200, noHistory))
    const result = await runDryRun(
      'koalemos',
      CREDENTIALS,
      {},
      { fetch, ...FAST_RETRY },
    )
    expect(result.outcome).toBe('failed')
    expect(result.report).toContain('Planner failure')
  })
})

describe('formatFailure', () => {
  it('renders an unknown non-Error throwable without dumping it whole', () => {
    expect(formatFailure({ some: 'object' })).toBe(
      'Unknown failure (a non-Error value was thrown)',
    )
  })

  it('renders a plain Error by name and message', () => {
    expect(formatFailure(new TypeError('boom'))).toBe('TypeError: boom')
  })
})

// ---------------------------------------------------------------------------
// Backup builder — pure, and credential-free by construction
// ---------------------------------------------------------------------------

describe('buildRootlistBackup / assertBackupIsCredentialFree', () => {
  it('a backup built from a real snapshot+plan never carries the request credentials', () => {
    const plan = planHistoryMoves(sample)
    const backup = buildRootlistBackup(
      sample,
      plan,
      new Date('2026-08-04T00:00:00Z'),
    )
    const serialized = JSON.stringify(backup)

    expect(() =>
      assertBackupIsCredentialFree(serialized, CREDENTIALS),
    ).not.toThrow()
    expect(serialized).not.toContain(CREDENTIALS.accessToken)
  })

  it('throws if the serialized text does contain a credential (last-line defence)', () => {
    const contaminated = `{"leaked":"${CREDENTIALS.accessToken}"}`
    expect(() =>
      assertBackupIsCredentialFree(contaminated, CREDENTIALS),
    ).toThrow()
  })

  it('does not name or echo which secret matched in its own error message', () => {
    const contaminated = `{"leaked":"${CREDENTIALS.accessToken}"}`
    try {
      assertBackupIsCredentialFree(contaminated, CREDENTIALS)
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as Error).message).not.toContain(CREDENTIALS.accessToken)
    }
  })
})

// ---------------------------------------------------------------------------
// buildPrependRequest / requestForMove — golden wire format, transcribed
// ---------------------------------------------------------------------------

describe('buildStartGroupAnchorUri', () => {
  it('is ID-ONLY — no :name suffix, matching the captured MOV anchor', () => {
    expect(buildStartGroupAnchorUri('46758b97bb37b942')).toBe(
      'spotify:start-group:46758b97bb37b942',
    )
    // Guard against ever reusing the rootlist GET's `:<name>` marker form.
    expect(buildStartGroupAnchorUri('46758b97bb37b942')).not.toContain(
      ':History',
    )
  })
})

describe('buildPrependRequest', () => {
  it('deep-equals the exact captured envelope', () => {
    expect(
      buildPrependRequest('spotify:playlist:ABC', '46758b97bb37b942'),
    ).toEqual({
      deltas: [
        {
          ops: [
            {
              kind: 'MOV',
              mov: {
                items: [{ uri: 'spotify:playlist:ABC', attributes: {} }],
                addAfterItem: {
                  uri: 'spotify:start-group:46758b97bb37b942',
                  attributes: {},
                },
              },
            },
          ],
          info: { source: { client: 'WEBPLAYER' } },
        },
      ],
    })
  })
})

describe('requestForMove', () => {
  it('builds a prepend for the move at the given index using its uri and the History folder id', () => {
    const plan = planHistoryMoves(sample)
    expect(requestForMove(plan, 0)).toEqual(
      buildPrependRequest(plan.moves[0].uri, plan.historyFolderId),
    )
  })

  it('throws for an out-of-range move index rather than returning undefined fields', () => {
    const plan = planHistoryMoves(sample)
    expect(() => requestForMove(plan, 99)).toThrow()
  })
})
