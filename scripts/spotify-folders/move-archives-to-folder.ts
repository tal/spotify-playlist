/**
 * CLI entrypoint for the History-folder tool.
 *
 * Default (no flags) is a DRY RUN: it reads the rootlist, prints the additive
 * prepend plan, and changes nothing. `--apply` performs the writes — it drives
 * the convergence loop in the sibling `apply.ts` (GET → prepend one archive →
 * re-read → repeat), writing a credential-free backup before the first POST and
 * verifying live state as it goes. There is no confirmation prompt: `--apply`
 * runs the plan it just printed.
 *
 * The write path — the `rootlist/changes` POST, the backup, the
 * write-authorization token, and the convergence loop — lives in `apply.ts`,
 * imported ONLY on the `--apply` branch. `WRITE_MODE` in `rootlist.ts` is a
 * defense-in-depth gate: set it back to 'disabled' and the write path throws
 * before constructing a request. The `rootlist/changes` protocol was
 * transcribed from real captures (docs/rootlist-capture.md) but is an
 * unofficial Spotify endpoint that can break at any time.
 *
 * This file imports nothing from `src/` — only its sibling planner/rootlist/
 * apply modules. (`rootlist.ts` does reach into `src/utils/retry`, which is why
 * the tool's tsconfig sets `rootDir` to the repo root rather than to this
 * directory.) The tool lives outside the Lambda package — `publish.rb`'s
 * `PAYLOAD` allowlist never copies top-level `scripts/` — and it initializes no
 * DynamoDB client and never constructs the public `Spotify` wrapper.
 *
 * Run it with:
 *
 *   bun run scripts/spotify-folders/move-archives-to-folder.ts           # dry run
 *   bun run scripts/spotify-folders/move-archives-to-folder.ts --apply   # writes
 */

import {
  formatMovePlan,
  planHistoryMoves,
  RootlistPlannerError,
  type MovePlan,
  type PlanOptions,
} from './planner'
import {
  getRootlist,
  RootlistTransportError,
  RootlistWritesDisabledError,
  type RootlistCredentials,
  type RootlistRequestOptions,
  type RootlistSnapshot,
} from './rootlist'
import { authorizeWrites, convergeMovePlan } from './apply'

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------

/**
 * Distinct codes so a caller can tell "you held it wrong" from "the library is
 * in a state this tool refuses to touch".
 */
const EXIT_OK = 0
/** A hard-failure invariant, a transport failure, or an apply that did not converge. */
const EXIT_FAILURE = 1
/** Unknown flag or other usage error. */
const EXIT_USAGE = 2
/** One or more required environment variables were absent. */
const EXIT_MISSING_CREDENTIALS = 3

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const USAGE = `move-archives-to-folder — move root-level "YYYY - MonthName" archive
playlists into the History folder.

Usage:
  bun run scripts/spotify-folders/move-archives-to-folder.ts [options]

Options:
  (no flags)         Dry run: read the rootlist, print the plan, change nothing.
                     The plan is purely additive — it prepends eligible
                     root-level production archives to the FRONT of History,
                     newest first, and never reorders or removes anything
                     already there. Unrelated playlists and legacy-named
                     archives in History are expected and left untouched.
  --apply            Perform the writes: prepend each eligible archive to the
                     front of History via the convergence loop, writing a
                     credential-free backup before the first change and
                     verifying live state as it goes. No confirmation prompt.
  --help, -h         Print this message.

Required environment variables:
  SPOTIFY_SPCLIENT_TOKEN   web-player bearer, WITHOUT the "Bearer " prefix
  SPOTIFY_CLIENT_TOKEN     the client-token request header value
  SPOTIFY_USER_ID          your Spotify user id (not a secret)

Real environment variables are authoritative. A .env file is a convenience
only and is not required to exist.`

type ArgvParse =
  | { outcome: 'run' }
  | { outcome: 'apply' }
  | { outcome: 'help' }
  | { outcome: 'usage-error'; message: string }

/**
 * Pure. Exported so a test can drive every branch without a process.
 *
 * The only behaviour flag is `--apply`: with it, the tool performs the writes;
 * without it, the tool does a dry run. A bare invocation is the dry run.
 */
export function parseArgv(argv: readonly string[]): ArgvParse {
  for (const arg of argv) {
    switch (arg) {
      case '--help':
      case '-h':
        return { outcome: 'help' }
      case '--apply':
        return { outcome: 'apply' }
      default:
        return {
          outcome: 'usage-error',
          message: `Unknown argument: ${arg}`,
        }
    }
  }

  return { outcome: 'run' }
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const SPCLIENT_TOKEN_VAR = 'SPOTIFY_SPCLIENT_TOKEN'
const CLIENT_TOKEN_VAR = 'SPOTIFY_CLIENT_TOKEN'
const USER_ID_VAR = 'SPOTIFY_USER_ID'

export type ResolvedCredentials = {
  userId: string
  credentials: RootlistCredentials
}

export type CredentialResolution =
  | { outcome: 'resolved'; resolved: ResolvedCredentials }
  | { outcome: 'missing'; missing: readonly string[] }

/**
 * Read credentials straight out of the environment.
 *
 * There is deliberately no `dotenv` call: the Bun migration dropped the
 * dependency, Bun loads `.env` natively at startup, and a `.env` in this
 * worktree would be auto-loaded into every future agent session in this
 * directory. Real environment variables are the intended path.
 *
 * Pure with respect to `env`, so a test can pass a literal object.
 */
export function resolveCredentials(
  env: Record<string, string | undefined>,
): CredentialResolution {
  const accessToken = env[SPCLIENT_TOKEN_VAR]?.trim()
  const clientToken = env[CLIENT_TOKEN_VAR]?.trim()
  const userId = env[USER_ID_VAR]?.trim()

  const missing: string[] = []
  if (!accessToken) missing.push(SPCLIENT_TOKEN_VAR)
  if (!clientToken) missing.push(CLIENT_TOKEN_VAR)
  if (!userId) missing.push(USER_ID_VAR)

  // The falsy check both reports the missing set and narrows the three values
  // to `string` for the resolved branch below — `missing` is non-empty in
  // exactly these cases, so the old `missing.length > 0` disjunct was redundant.
  if (!accessToken || !clientToken || !userId) {
    return { outcome: 'missing', missing }
  }

  return {
    outcome: 'resolved',
    resolved: { userId, credentials: { accessToken, clientToken } },
  }
}

/**
 * Capture instructions.
 *
 * Contains no example value that could be mistaken for a real token — every
 * placeholder is an angle-bracketed description, never a plausible-looking
 * string. This text is printed on the failure path, so it must stay
 * copy-paste-safe into a bug report.
 */
export function formatCredentialInstructions(
  missing: readonly string[],
): string {
  return [
    `Missing required environment ${
      missing.length === 1 ? 'variable' : 'variables'
    }: ${missing.join(', ')}`,
    '',
    'Capture them from a live web-player session:',
    '',
    '  1. Open https://open.spotify.com in Chrome and sign in.',
    '  2. Open DevTools → Network, and filter on "spclient".',
    '  3. Click any request to spclient.wg.spotify.com.',
    '  4. Under Request Headers, copy:',
    `       authorization  → drop the leading "Bearer " and export the rest as ${SPCLIENT_TOKEN_VAR}`,
    `       client-token   → export verbatim as ${CLIENT_TOKEN_VAR}`,
    '  5. Read your user id out of that request path:',
    '       /playlist/v2/user/<YOUR-USER-ID>/rootlist',
    '',
    '  6. Export them into THIS shell only:',
    `       export ${SPCLIENT_TOKEN_VAR}='<paste the bearer value here>'`,
    `       export ${CLIENT_TOKEN_VAR}='<paste the client-token value here>'`,
    `       export ${USER_ID_VAR}='<paste your user id here>'`,
    '',
    `Do NOT write ${SPCLIENT_TOKEN_VAR} or ${CLIENT_TOKEN_VAR} into a .env file.`,
    'Both are short-lived secrets, and a .env in this directory is auto-loaded',
    `into unrelated tooling sessions. ${USER_ID_VAR} is not a secret.`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Dry run — the default path
// ---------------------------------------------------------------------------

export type DryRunResult =
  | { outcome: 'planned'; plan: MovePlan; report: string }
  | { outcome: 'failed'; report: string }

/**
 * GET → parse → classify → format. No backup is written (a dry run needs none)
 * and no POST is issued.
 *
 * Returns the report rather than printing it, so the caller owns all I/O and a
 * test can assert on the text.
 */
export async function runDryRun(
  userId: string,
  credentials: RootlistCredentials,
  planOptions: PlanOptions,
  requestOptions: RootlistRequestOptions = {},
): Promise<DryRunResult> {
  let snapshot: RootlistSnapshot
  try {
    snapshot = await getRootlist(userId, credentials, requestOptions)
  } catch (error: unknown) {
    return { outcome: 'failed', report: formatFailure(error) }
  }

  let plan: MovePlan
  try {
    plan = planHistoryMoves(snapshot, planOptions)
  } catch (error: unknown) {
    return { outcome: 'failed', report: formatFailure(error) }
  }

  return { outcome: 'planned', plan, report: formatMovePlan(plan) }
}

// ---------------------------------------------------------------------------
// Apply — the write path, reached only via --apply
// ---------------------------------------------------------------------------

export type ApplyRunResult =
  | { outcome: 'applied'; report: string }
  | { outcome: 'nothing'; report: string }
  | { outcome: 'failed'; report: string }

/**
 * GET → plan → print the plan → converge (prepend each archive, re-reading live
 * state and backing up before the first write) → report. No confirmation
 * prompt: it applies the plan it just printed.
 *
 * `io.out` is used to print the plan before writing so an operator sees exactly
 * what is about to happen even though nothing pauses.
 */
export async function runApply(
  userId: string,
  credentials: RootlistCredentials,
  planOptions: PlanOptions,
  io: CliIo,
  requestOptions: RootlistRequestOptions = {},
): Promise<ApplyRunResult> {
  let snapshot: RootlistSnapshot
  let plan: MovePlan
  try {
    snapshot = await getRootlist(userId, credentials, requestOptions)
    plan = planHistoryMoves(snapshot, planOptions)
  } catch (error: unknown) {
    return { outcome: 'failed', report: formatFailure(error) }
  }

  // Show what is about to happen.
  io.out(formatMovePlan(plan, 'apply'))

  if (plan.outcome === 'empty') {
    return {
      outcome: 'nothing',
      report: 'Nothing to apply — History is already up to date.',
    }
  }

  const authorization = authorizeWrites()
  if (!authorization) {
    return {
      outcome: 'failed',
      report:
        "Writes are disabled: WRITE_MODE is 'disabled' in scripts/spotify-folders/rootlist.ts. Nothing was sent.",
    }
  }

  const result = await convergeMovePlan(
    userId,
    credentials,
    snapshot,
    plan,
    planOptions,
    authorization,
    requestOptions,
  )

  if (result.outcome === 'converged') {
    return {
      outcome: 'applied',
      report: [
        `Applied. History is up to date after ${result.iterations} iteration(s).`,
        `Backup: ${result.backupPath}`,
      ].join('\n'),
    }
  }

  return {
    outcome: 'failed',
    report: [
      result.report,
      `Backup: ${result.backupPath}`,
      'Re-run to converge from wherever it stopped — the plan is recomputed from a fresh read, never blindly replayed.',
    ].join('\n'),
  }
}

/**
 * Render any thrown value as printable text.
 *
 * Both project error classes carry a `toSafeFields()` that is guaranteed
 * credential-free; anything else is reduced to its message, never dumped whole,
 * because an arbitrary object could have captured a request or a header set.
 */
export function formatFailure(error: unknown): string {
  if (error instanceof RootlistPlannerError) {
    return [
      `Planner failure (${error.kind}): ${error.message}`,
      JSON.stringify(error.details, null, 2),
    ].join('\n')
  }

  if (error instanceof RootlistTransportError) {
    return [
      `Transport failure (${error.details.kind}, ${error.details.disposition}): ${error.message}`,
      JSON.stringify(error.toSafeFields(), null, 2),
    ].join('\n')
  }

  if (error instanceof RootlistWritesDisabledError) {
    return `Writes disabled: ${error.message}`
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }

  return 'Unknown failure (a non-Error value was thrown)'
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export type CliIo = {
  out: (line: string) => void
  err: (line: string) => void
}

/**
 * The whole CLI as a function of argv + env, returning an exit code.
 *
 * Exported and I/O-injected so the dispatch table is testable without spawning
 * a process. Both `run` (dry) and `apply` resolve credentials first, so an
 * `--apply` with no credentials exits on the missing-credentials path before
 * the network is ever touched.
 */
export async function runCli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  io: CliIo,
): Promise<number> {
  const args = parseArgv(argv)

  if (args.outcome === 'help') {
    io.out(USAGE)
    return EXIT_OK
  }

  if (args.outcome === 'usage-error') {
    io.err(args.message)
    io.err('')
    io.err(USAGE)
    return EXIT_USAGE
  }

  const credentials = resolveCredentials(env)
  if (credentials.outcome === 'missing') {
    io.err(formatCredentialInstructions(credentials.missing))
    return EXIT_MISSING_CREDENTIALS
  }

  const planOptions: PlanOptions = {}

  if (args.outcome === 'apply') {
    const result = await runApply(
      credentials.resolved.userId,
      credentials.resolved.credentials,
      planOptions,
      io,
    )

    if (result.outcome === 'failed') {
      io.err(result.report)
      return EXIT_FAILURE
    }

    io.out(result.report)
    return EXIT_OK
  }

  const result = await runDryRun(
    credentials.resolved.userId,
    credentials.resolved.credentials,
    planOptions,
  )

  if (result.outcome === 'failed') {
    io.err(result.report)
    return EXIT_FAILURE
  }

  io.out(result.report)
  return EXIT_OK
}

const isDirectRun = import.meta.main

if (isDirectRun) {
  runCli(process.argv.slice(2), process.env, {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  })
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      console.error(formatFailure(error))
      process.exitCode = EXIT_FAILURE
    })
}
