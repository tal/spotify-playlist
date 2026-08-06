/**
 * Pure marker parser + desired-state planner for the History-folder tool.
 *
 * Everything in this file is a pure function of a captured `RootlistSnapshot`.
 * There is no network, no clock, no filesystem and no global state, so the
 * committed fixture in `__tests__/fixtures/rootlist.sample.json` exercises the
 * whole thing offline.
 *
 * Scope note (revision 5 — additive prepend model): this tool is PURELY
 * ADDITIVE. It never reorders or removes anything already in History. The only
 * action it plans is prepending eligible root-level production archives to the
 * FRONT of History (immediately after the `start-group` marker), newest first,
 * so a fresh archive lands on top and everything already filed keeps its exact
 * position below. It deliberately contains NO desired-URI-sequence comparison
 * and NO corrective-reorder planner: existing History order is never compared
 * against a target and never touched.
 *
 * Like `archive-name.ts`, this imports nothing from `src/` — it is a script
 * outside the Lambda package.
 */

import {
  parseArchivePlaylistName,
  type ParsedArchivePlaylistName,
} from './archive-name'
import type { RootlistSnapshot } from './rootlist'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PlannerFailureKind =
  /** A rootlist entry used the marker scheme but not a shape the client emits. */
  | 'malformed-marker'
  /** `end-group` with no folder open. */
  | 'unbalanced-end-group'
  /** `end-group` whose id is not the innermost open folder's id. */
  | 'mismatched-end-group'
  /** The same folder id opened twice anywhere in the rootlist. */
  | 'duplicate-folder-id'
  /** The item list ended with folders still open. */
  | 'unclosed-folder'
  /** No root-level folder with the requested name. */
  | 'history-folder-missing'
  /** More than one root-level folder with the requested name. */
  | 'history-folder-ambiguous'
  /** The only matches were nested inside another folder. */
  | 'history-folder-nested'

export type PlannerErrorDetails = Readonly<
  Record<string, string | number | readonly string[]>
>

export type PlannerSafeErrorFields = {
  kind: PlannerFailureKind
  message: string
  details: PlannerErrorDetails
}

/**
 * A hard planning failure.
 *
 * `details` carries only rootlist-derived data — folder ids, playlist names,
 * entry indices. None of it is credential-bearing, so the whole object is safe
 * to print. (Credentials never reach this file at all: the planner sees a
 * decoded snapshot, never a request.)
 */
export class RootlistPlannerError extends Error {
  readonly kind: PlannerFailureKind
  readonly details: PlannerErrorDetails

  constructor(
    kind: PlannerFailureKind,
    message: string,
    details: PlannerErrorDetails = {},
  ) {
    super(message)
    this.name = 'RootlistPlannerError'
    this.kind = kind
    this.details = details
  }

  toSafeFields(): PlannerSafeErrorFields {
    return { kind: this.kind, message: this.message, details: this.details }
  }
}

// ---------------------------------------------------------------------------
// URI parsing
// ---------------------------------------------------------------------------

export type RootlistEntryUri =
  | { kind: 'playlist'; id: string }
  | { kind: 'start-group'; id: string; name: string | null }
  | { kind: 'end-group'; id: string }
  | { kind: 'unknown' }

/**
 * Inverse of the web player's folder-name encoder.
 *
 * The client encodes with `encodeURIComponent(name.replace(/\s+/g, ' '))` and
 * then `%20` → `+`, so decoding is `+` → `%20` followed by
 * `decodeURIComponent` (bundle module 41473, functions `s` / `Z`).
 *
 * A malformed percent-escape makes `decodeURIComponent` throw. That is a
 * cosmetic problem — the folder's identity is its id, not its name — so the raw
 * segment is returned rather than failing the whole parse.
 */
export function decodeFolderName(segment: string): string {
  try {
    return decodeURIComponent(segment.replace(/\+/g, '%20'))
  } catch {
    return segment
  }
}

/**
 * Classify one rootlist entry URI.
 *
 * Shapes the client is known to emit:
 *
 *   spotify:playlist:<base62>
 *   spotify:start-group:<hex id>:<encoded name>
 *   spotify:start-group:<hex id>              ← legal, name segment omitted
 *   spotify:end-group:<hex id>
 *
 * A URI that uses `start-group`/`end-group` but matches none of those is a
 * `malformed-marker` failure rather than an `unknown` entry: markers are
 * structural, and guessing at a broken one risks mis-nesting the tree.
 * Non-marker URIs the tool does not understand (e.g. a future entry type) are
 * `unknown` and get collected and ignored.
 *
 * Folder ids are NOT fixed width — the live account has both 15- and 16-char
 * ids because leading zeroes are dropped — so the id is never length-checked.
 */
export function parseRootlistEntryUri(uri: string): RootlistEntryUri {
  const parts = uri.split(':')
  if (parts[0] !== 'spotify' || parts.length < 3) return { kind: 'unknown' }

  const type = parts[1]
  const id = parts[2]

  if (type === 'playlist') {
    return id && parts.length === 3
      ? { kind: 'playlist', id }
      : { kind: 'unknown' }
  }

  if (type === 'start-group') {
    if (!id) {
      throw new RootlistPlannerError(
        'malformed-marker',
        'start-group marker has an empty folder id',
        { uri },
      )
    }
    // `encodeURIComponent` turns ':' into '%3A', so a well-formed name segment
    // never contains a raw colon — but rejoining the tail is free insurance
    // against an unencoded one arriving from somewhere else.
    const nameSegment = parts.length > 3 ? parts.slice(3).join(':') : null
    return {
      kind: 'start-group',
      id,
      name: nameSegment === null ? null : decodeFolderName(nameSegment),
    }
  }

  if (type === 'end-group') {
    if (!id || parts.length !== 3) {
      throw new RootlistPlannerError(
        'malformed-marker',
        'end-group marker is not exactly spotify:end-group:<id>',
        { uri },
      )
    }
    return { kind: 'end-group', id }
  }

  return { kind: 'unknown' }
}

// ---------------------------------------------------------------------------
// Folder-stack parse
// ---------------------------------------------------------------------------

export type ParsedFolder = {
  id: string
  /** `null` when the start-group marker carried no name segment. */
  name: string | null
  /** Index of the start-group entry in `contents.items`. */
  startIndex: number
  /** Index of the matching end-group entry. */
  endIndex: number
  parentFolderId: string | null
  /** 0 = root level. */
  depth: number
  /** Folder names from the root down to and including this folder. */
  path: readonly string[]
}

export type ParsedPlaylist = {
  uri: string
  /** The base62 id from `spotify:playlist:<id>`. */
  id: string
  /**
   * `null` when the entry is undecorated or inaccessible. The live capture has
   * two entries with a `statusCode` of 404/403 and no `attributes` at all.
   */
  name: string | null
  /** Index in `contents.items`. */
  index: number
  parentFolderId: string | null
  /** 0 = root level. */
  depth: number
  folderPath: readonly string[]
  statusCode: number | null
}

export type ParsedRootlist = {
  revision: string
  folders: readonly ParsedFolder[]
  playlists: readonly ParsedPlaylist[]
  /** Entries whose URI is neither a playlist nor a folder marker. */
  unknownEntries: readonly { index: number; uri: string }[]
}

type OpenFolder = {
  id: string
  name: string | null
  startIndex: number
  parentFolderId: string | null
  depth: number
  path: readonly string[]
}

/**
 * Walk `contents.items` once, maintaining a folder stack.
 *
 * Every structural anomaly is a hard failure. The real web client is laxer —
 * it pops with `stack.findIndex(f => f.hash === id)` and truncates, tolerating
 * unbalanced markers — but a tool that plans MOVES against index positions
 * cannot afford a tree it had to guess at. This strictness is deliberate.
 */
export function parseRootlist(snapshot: RootlistSnapshot): ParsedRootlist {
  const items = snapshot.contents.items
  const metaItems = snapshot.contents.metaItems

  const folders: ParsedFolder[] = []
  const playlists: ParsedPlaylist[] = []
  const unknownEntries: { index: number; uri: string }[] = []

  const stack: OpenFolder[] = []
  const seenFolderIds = new Map<string, number>()

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const parsed = parseRootlistEntryUri(item.uri)
    const parent = stack.length > 0 ? stack[stack.length - 1] : null

    if (parsed.kind === 'start-group') {
      const previousIndex = seenFolderIds.get(parsed.id)
      if (previousIndex !== undefined) {
        throw new RootlistPlannerError(
          'duplicate-folder-id',
          `folder id ${parsed.id} is opened more than once`,
          {
            folderId: parsed.id,
            firstIndex: previousIndex,
            secondIndex: index,
          },
        )
      }
      seenFolderIds.set(parsed.id, index)
      stack.push({
        id: parsed.id,
        name: parsed.name,
        startIndex: index,
        parentFolderId: parent ? parent.id : null,
        depth: stack.length,
        path: [
          ...(parent ? parent.path : []),
          parsed.name ?? `<unnamed:${parsed.id}>`,
        ],
      })
      continue
    }

    if (parsed.kind === 'end-group') {
      if (!parent) {
        throw new RootlistPlannerError(
          'unbalanced-end-group',
          `end-group for folder id ${parsed.id} with no folder open`,
          { folderId: parsed.id, index },
        )
      }
      if (parent.id !== parsed.id) {
        throw new RootlistPlannerError(
          'mismatched-end-group',
          `end-group for folder id ${parsed.id} while folder id ${parent.id} is open`,
          {
            closingFolderId: parsed.id,
            openFolderId: parent.id,
            openFolderPath: parent.path,
            index,
          },
        )
      }
      stack.pop()
      folders.push({
        id: parent.id,
        name: parent.name,
        startIndex: parent.startIndex,
        endIndex: index,
        parentFolderId: parent.parentFolderId,
        depth: parent.depth,
        path: parent.path,
      })
      continue
    }

    if (parsed.kind === 'playlist') {
      const meta = metaItems[index]
      const name = meta?.attributes?.name
      playlists.push({
        uri: item.uri,
        id: parsed.id,
        name: typeof name === 'string' ? name : null,
        index,
        parentFolderId: parent ? parent.id : null,
        depth: stack.length,
        folderPath: parent ? parent.path : [],
        statusCode:
          typeof meta?.statusCode === 'number' ? meta.statusCode : null,
      })
      continue
    }

    unknownEntries.push({ index, uri: item.uri })
  }

  if (stack.length > 0) {
    throw new RootlistPlannerError(
      'unclosed-folder',
      `${stack.length} folder(s) were never closed`,
      {
        folderIds: stack.map((folder) => folder.id),
        folderPaths: stack.map((folder) => folder.path.join(' / ')),
      },
    )
  }

  // `folders` is built on pop, so it comes out innermost-first. Sort by start
  // index so callers see document order.
  folders.sort((a, b) => a.startIndex - b.startIndex)

  return {
    revision: snapshot.revision,
    folders,
    playlists,
    unknownEntries,
  }
}

// ---------------------------------------------------------------------------
// Locating History
// ---------------------------------------------------------------------------

export const HISTORY_FOLDER_NAME = 'History'

/**
 * Return the one root-level folder with the given name.
 *
 * Only depth-0 folders are eligible. Both the miss and the ambiguity cases
 * throw with the candidate ids and paths attached, because "History not found"
 * with no context is useless when the account has six folders. Note that this
 * MUST be restricted to start-group markers: the live account has both a
 * folder named `Current` and a playlist named `Current`.
 */
export function findHistoryFolder(
  parsed: ParsedRootlist,
  folderName: string = HISTORY_FOLDER_NAME,
): ParsedFolder {
  const matches = parsed.folders.filter((folder) => folder.name === folderName)
  const rootMatches = matches.filter((folder) => folder.depth === 0)

  if (rootMatches.length === 1) return rootMatches[0]

  if (rootMatches.length > 1) {
    throw new RootlistPlannerError(
      'history-folder-ambiguous',
      `found ${rootMatches.length} root-level folders named ${folderName}`,
      {
        folderName,
        folderIds: rootMatches.map((folder) => folder.id),
        startIndices: rootMatches.map((folder) => String(folder.startIndex)),
      },
    )
  }

  if (matches.length > 0) {
    throw new RootlistPlannerError(
      'history-folder-nested',
      `folder ${folderName} exists but only nested inside another folder`,
      {
        folderName,
        folderIds: matches.map((folder) => folder.id),
        paths: matches.map((folder) => folder.path.join(' / ')),
      },
    )
  }

  throw new RootlistPlannerError(
    'history-folder-missing',
    `no root-level folder named ${folderName}`,
    {
      folderName,
      rootFolderNames: parsed.folders
        .filter((folder) => folder.depth === 0)
        .map((folder) => folder.name ?? `<unnamed:${folder.id}>`),
    },
  )
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type PlaylistLocation = 'root' | 'history-direct-child' | 'other-folder'

export type PlaylistDisposition =
  /** The only thing eligible to move. */
  | 'root-production-archive'
  | 'already-in-history'
  /** Reported, untouched. */
  | 'archive-in-other-folder'
  /** Reported, untouched. */
  | 'test-archive'
  | 'not-an-archive'

export type ClassifiedPlaylist = {
  playlist: ParsedPlaylist
  location: PlaylistLocation
  /** `null` when the name is missing or is not an archive name. */
  archive: ParsedArchivePlaylistName | null
  disposition: PlaylistDisposition
}

/**
 * Disposition precedence, applied in this order:
 *
 *   1. no parseable archive name (including a missing name) → not-an-archive
 *   2. `[Test] ` prefix, wherever it lives                  → test-archive
 *   3. production archive anywhere under History            → already-in-history
 *   4. production archive at root level                     → root-production-archive
 *   5. production archive in any other folder               → archive-in-other-folder
 *
 * Test archives outrank location on purpose: a `[Test] ` playlist is dev debris
 * and the tool leaves it exactly where it is, inside History or not.
 */
export function classifyPlaylists(
  parsed: ParsedRootlist,
  historyFolder: ParsedFolder,
): readonly ClassifiedPlaylist[] {
  return parsed.playlists.map((playlist) => {
    const location = locate(playlist, historyFolder)
    const archive =
      playlist.name === null ? null : parseArchivePlaylistName(playlist.name)

    return {
      playlist,
      location,
      archive,
      disposition: dispose(location, archive),
    }
  })
}

function dispose(
  location: PlaylistLocation,
  archive: ParsedArchivePlaylistName | null,
): PlaylistDisposition {
  if (archive === null) return 'not-an-archive'
  if (archive.kind === 'test') return 'test-archive'
  if (location === 'history-direct-child') return 'already-in-history'
  if (location === 'root') return 'root-production-archive'
  return 'archive-in-other-folder'
}

/**
 * Classify a playlist's location relative to History by its immediate parent.
 *
 * A playlist nested inside a folder that itself sits inside History has that
 * inner folder as its `parentFolderId`, so it reads as `'other-folder'`, never
 * a History child — and is therefore never eligible and never touched. The tool
 * no longer validates History's contents (revision 5), so a nested folder in
 * History is tolerated: it simply contributes no eligible archives.
 */
function locate(
  playlist: ParsedPlaylist,
  historyFolder: ParsedFolder,
): PlaylistLocation {
  if (playlist.parentFolderId === null) return 'root'
  if (playlist.parentFolderId === historyFolder.id)
    return 'history-direct-child'
  return 'other-folder'
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type PlanOptions = {
  historyFolderName?: string
}

export type PlannedMove = {
  uri: string
  name: string
  /** Index in the snapshot's `contents.items`. */
  fromIndex: number
  /** Parsed archive year — carried so the prepend batch can be sorted. */
  year: number
  /** Parsed archive month, zero-based (0 = January), for the same reason. */
  month: number
}

/**
 * A root-level production archive that is eligible by classification but is
 * deliberately not moved, because filing it can't be done without guessing.
 *
 * - `'already-filed'`: an archive with the same (year, month) is already in
 *   History. A second copy would duplicate it, so it stays at root, reported.
 * - `'ambiguous-root-duplicate'`: two or more ROOT archives share one (year,
 *   month). The tool never picks which to file, so all of them are skipped.
 *
 * Both are safe, non-fatal, and consistent with "only add, never touch what is
 * already there" — the old invariant-8 hard failure is relaxed to this.
 */
export type SkippedRootArchive = {
  uri: string
  name: string
  index: number
  year: number
  month: number
  reason: 'already-filed' | 'ambiguous-root-duplicate'
}

/** A playlist reported but never touched. */
export type UntouchedPlaylist = {
  uri: string
  name: string | null
  index: number
  location: PlaylistLocation
  folderPath: readonly string[]
}

/**
 * Only the counters that are NOT already the `.length` of an array carried on
 * the plan. Everything derivable — eligible moves, archives in other folders,
 * test archives, unrelated History children, inaccessible playlists — is read
 * straight off `plan.moves` / `plan.archivesInOtherFolders` / etc. by
 * `formatMovePlan`, so it is not duplicated here as a hand-synced count.
 */
export type PlanCounts = {
  scannedRootPlaylists: number
  alreadyInHistory: number
}

export type MovePlan = {
  /** `'empty'` when there is nothing eligible to prepend. */
  outcome: 'plan' | 'empty'
  rootlistRevision: string
  /**
   * The History folder's id, hoisted to the top level so the apply path can
   * build the front-of-folder anchor `spotify:start-group:${historyFolderId}`
   * without reaching into `historyFolder`. Same value as `historyFolder.id`;
   * duplicated here because it is the single field the write path needs.
   */
  historyFolderId: string
  historyFolder: {
    id: string
    name: string
    startIndex: number
    endIndex: number
  }
  /**
   * The archives to prepend, in FINAL top-to-bottom order: newest first. The
   * apply path inserts this block at History's front, so this is the order they
   * end up in — newest on top, existing content untouched below.
   */
  moves: readonly PlannedMove[]
  counts: PlanCounts
  /** Current direct children of History, in wire order. Never reordered or removed. */
  historyContents: readonly { uri: string; name: string | null }[]
  /** Root archives skipped because their (year, month) is already in History. */
  skippedAlreadyFiled: readonly SkippedRootArchive[]
  /** Root archives skipped because two or more of them claim one (year, month). */
  skippedAmbiguous: readonly SkippedRootArchive[]
  unrelatedHistoryChildren: readonly UntouchedPlaylist[]
  archivesInOtherFolders: readonly UntouchedPlaylist[]
  testArchives: readonly UntouchedPlaylist[]
  inaccessiblePlaylists: readonly UntouchedPlaylist[]
  unknownEntries: readonly { index: number; uri: string }[]
}

/**
 * Produce the dry-run plan for one captured rootlist.
 *
 * Steps:
 *
 *   1. parse the marker tree (structural anomalies are fatal)
 *   2. locate exactly one root-level History folder (zero, multiple, or
 *      nested-only are the ONLY remaining hard failures — that is the target
 *      folder and it must be unambiguous)
 *   3. classify every playlist
 *   4. compute the prepend batch: eligible root production archives, minus the
 *      ones whose (year, month) is already filed in History (reported as
 *      already-filed) and minus root archives that collide with one another
 *      (reported as ambiguous), sorted newest-first
 *
 * The tool never validates History's contents beyond locating the folder, and
 * never reorders or removes anything already inside it. Duplicates are reported
 * and skipped, never fatal.
 */
export function planHistoryMoves(
  snapshot: RootlistSnapshot,
  options: PlanOptions = {},
): MovePlan {
  const parsed = parseRootlist(snapshot)
  const historyFolder = findHistoryFolder(parsed, options.historyFolderName)

  const classified = classifyPlaylists(parsed, historyFolder)

  // One pass, bucketed by disposition, so every "how many X" below is an index
  // into this record rather than a fresh `classified.filter(...)` sweep.
  const byDisposition: Record<PlaylistDisposition, ClassifiedPlaylist[]> = {
    'root-production-archive': [],
    'already-in-history': [],
    'archive-in-other-folder': [],
    'test-archive': [],
    'not-an-archive': [],
  }
  for (const entry of classified) byDisposition[entry.disposition].push(entry)

  const historyChildren = classified.filter(
    (entry) => entry.location === 'history-direct-child',
  )
  // A History direct child can only be already-in-history, test-archive, or
  // not-an-archive (see `dispose`), so "unrelated" is exactly not-an-archive.
  // These are informational only now: they are expected on the real account and
  // left exactly where they are.
  const unrelatedHistoryChildren = historyChildren.filter(
    (entry) => entry.disposition === 'not-an-archive',
  )

  const candidates = byDisposition['root-production-archive']
  const inHistory = byDisposition['already-in-history']
  const archivesInOtherFolders = byDisposition['archive-in-other-folder']
  const testArchives = byDisposition['test-archive']

  // Split the root candidates into what is safe to prepend and what must be
  // reported and skipped. Neither skip case is fatal.
  const { eligible, skippedAlreadyFiled, skippedAmbiguous } =
    partitionCandidates(candidates, inHistory)

  // FINAL top-to-bottom order: newest first. The apply path inserts this block
  // at History's front, so this is literally the order it will appear in.
  const moves: PlannedMove[] = eligible
    .slice()
    .sort(byReverseChronology)
    .map((entry) => {
      // `archive` and `name` are non-null by the 'root-production-archive'
      // disposition; the assertions narrow, they do not assume.
      const archive = entry.archive as ParsedArchivePlaylistName
      return {
        uri: entry.playlist.uri,
        name: entry.playlist.name as string,
        fromIndex: entry.playlist.index,
        year: archive.year,
        month: archive.month,
      }
    })

  const inaccessible = classified.filter(
    (entry) =>
      entry.playlist.name === null &&
      entry.playlist.statusCode !== null &&
      entry.playlist.statusCode !== 200,
  )

  const scannedRootPlaylists = classified.filter(
    (entry) => entry.location === 'root',
  ).length

  return {
    outcome: moves.length > 0 ? 'plan' : 'empty',
    rootlistRevision: parsed.revision,
    historyFolderId: historyFolder.id,
    historyFolder: {
      id: historyFolder.id,
      name: historyFolder.name ?? `<unnamed:${historyFolder.id}>`,
      startIndex: historyFolder.startIndex,
      endIndex: historyFolder.endIndex,
    },
    moves,
    counts: {
      scannedRootPlaylists,
      alreadyInHistory: inHistory.length,
    },
    historyContents: historyChildren.map((entry) => ({
      uri: entry.playlist.uri,
      name: entry.playlist.name,
    })),
    skippedAlreadyFiled: skippedAlreadyFiled.map(toSkipped('already-filed')),
    skippedAmbiguous: skippedAmbiguous.map(
      toSkipped('ambiguous-root-duplicate'),
    ),
    unrelatedHistoryChildren: unrelatedHistoryChildren.map(toUntouched),
    archivesInOtherFolders: archivesInOtherFolders.map(toUntouched),
    testArchives: testArchives.map(toUntouched),
    inaccessiblePlaylists: inaccessible.map(toUntouched),
    unknownEntries: parsed.unknownEntries,
  }
}

/** A stable `YYYY-MM` grouping key (zero-based month, matching `archive.month`). */
function archiveKey(archive: ParsedArchivePlaylistName): string {
  return `${archive.year}-${String(archive.month).padStart(2, '0')}`
}

type CandidatePartition = {
  eligible: ClassifiedPlaylist[]
  skippedAlreadyFiled: ClassifiedPlaylist[]
  skippedAmbiguous: ClassifiedPlaylist[]
}

/**
 * Split root production-archive candidates into what is safe to prepend and
 * what must be reported and skipped (relaxes the old invariant-8 hard failure):
 *
 *  - Two or more ROOT candidates sharing a (year, month) key are all ambiguous —
 *    the tool never guesses which to file — so every candidate in that bucket
 *    is skipped.
 *  - A lone candidate whose key already exists among History's production
 *    archives is already filed; a second copy would duplicate it, so it is
 *    skipped rather than moved.
 *  - Everything else is eligible.
 *
 * Archives in OTHER folders are intentionally not considered here: the tool
 * never touches them, so they can neither be filed nor veto anything.
 */
function partitionCandidates(
  candidates: readonly ClassifiedPlaylist[],
  inHistory: readonly ClassifiedPlaylist[],
): CandidatePartition {
  const historyKeys = new Set<string>()
  for (const entry of inHistory) {
    if (entry.archive?.kind === 'production') {
      historyKeys.add(archiveKey(entry.archive))
    }
  }

  const byKey = new Map<string, ClassifiedPlaylist[]>()
  for (const entry of candidates) {
    // Every 'root-production-archive' has a production archive parse by
    // construction, so the assertion narrows rather than assumes.
    const key = archiveKey(entry.archive as ParsedArchivePlaylistName)
    const bucket = byKey.get(key)
    if (bucket) bucket.push(entry)
    else byKey.set(key, [entry])
  }

  const eligible: ClassifiedPlaylist[] = []
  const skippedAlreadyFiled: ClassifiedPlaylist[] = []
  const skippedAmbiguous: ClassifiedPlaylist[] = []

  for (const [key, bucket] of byKey) {
    if (bucket.length > 1) {
      skippedAmbiguous.push(...bucket)
      continue
    }
    const [entry] = bucket
    if (historyKeys.has(key)) {
      skippedAlreadyFiled.push(entry)
      continue
    }
    eligible.push(entry)
  }

  return { eligible, skippedAlreadyFiled, skippedAmbiguous }
}

/** Newest first: year descending, then month descending. */
function byReverseChronology(
  a: ClassifiedPlaylist,
  b: ClassifiedPlaylist,
): number {
  const aa = a.archive as ParsedArchivePlaylistName
  const bb = b.archive as ParsedArchivePlaylistName
  if (aa.year !== bb.year) return bb.year - aa.year
  return bb.month - aa.month
}

function toSkipped(
  reason: SkippedRootArchive['reason'],
): (entry: ClassifiedPlaylist) => SkippedRootArchive {
  return (entry) => {
    const archive = entry.archive as ParsedArchivePlaylistName
    return {
      uri: entry.playlist.uri,
      name: entry.playlist.name as string,
      index: entry.playlist.index,
      year: archive.year,
      month: archive.month,
      reason,
    }
  }
}

function toUntouched(entry: ClassifiedPlaylist): UntouchedPlaylist {
  return {
    uri: entry.playlist.uri,
    name: entry.playlist.name,
    index: entry.playlist.index,
    location: entry.location,
    folderPath: entry.playlist.folderPath,
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const COUNT_LABEL_WIDTH = 31

/**
 * Render a plan as the dry-run report.
 *
 * Pure — returns a string and prints nothing, so the CLI owns all I/O. The
 * report states plainly that the tool is additive: it prepends the eligible
 * archives to History's front, newest first, and never reorders or removes
 * anything already there (see the file header).
 */
export function formatMovePlan(
  plan: MovePlan,
  mode: 'dry-run' | 'apply' = 'dry-run',
): string {
  const lines: string[] = []

  lines.push(`History folder found (id: ${plan.historyFolder.id})`)
  lines.push(`Scanned ${plan.counts.scannedRootPlaylists} root-level playlists`)
  lines.push('')

  const count = (label: string, value: number, suffix = '') =>
    `${`${label}:`.padEnd(COUNT_LABEL_WIDTH)}${String(value).padStart(4)}${suffix}`

  // The derived counts are read straight off the plan's arrays — one source of
  // truth, no hand-synced `PlanCounts` fields to drift.
  lines.push(count('Eligible root archives', plan.moves.length))
  lines.push(count('Already in History', plan.counts.alreadyInHistory))
  if (plan.skippedAlreadyFiled.length > 0) {
    lines.push(
      count(
        'Skipped (already in History)',
        plan.skippedAlreadyFiled.length,
        ' (left untouched)',
      ),
    )
  }
  if (plan.skippedAmbiguous.length > 0) {
    lines.push(
      count(
        'Skipped (ambiguous duplicates)',
        plan.skippedAmbiguous.length,
        ' (left untouched)',
      ),
    )
  }
  lines.push(
    count(
      'Archives in other folders',
      plan.archivesInOtherFolders.length,
      ' (left untouched)',
    ),
  )
  lines.push(
    count('Test archives', plan.testArchives.length, ' (left untouched)'),
  )
  lines.push(
    count(
      'Unrelated playlists in History',
      plan.unrelatedHistoryChildren.length,
      ' (left untouched)',
    ),
  )
  if (plan.inaccessiblePlaylists.length > 0) {
    lines.push(
      count(
        'Inaccessible playlists',
        plan.inaccessiblePlaylists.length,
        ' (left untouched)',
      ),
    )
  }
  // Rootlist entries that are neither a playlist nor a folder marker — an
  // old-style `spotify:user:<u>:playlist:<id>` URI, or a shape Spotify added
  // after this parser was written. The planner ignores them, so they must be
  // visible here; a silently-dropped entry is how a parser gap stays invisible.
  if (plan.unknownEntries.length > 0) {
    lines.push(
      count(
        'Unrecognised rootlist entries',
        plan.unknownEntries.length,
        ' (ignored)',
      ),
    )
    for (const entry of plan.unknownEntries) {
      lines.push(`    @${entry.index}  ${entry.uri}`)
    }
  }
  lines.push('')

  if (plan.outcome === 'empty') {
    lines.push(
      'Nothing to prepend: no eligible root-level archive playlists. Nothing would change.',
    )
  } else {
    lines.push(
      `Would prepend into History (${plan.moves.length}), newest first:`,
    )
    const width = Math.max(...plan.moves.map((move) => move.name.length))
    for (const move of plan.moves) {
      lines.push(`  ${move.name.padEnd(width)}  from root`)
    }
  }
  lines.push('')

  // The skip reasons are shown in full, not just counted — an operator needs
  // the names to reconcile a duplicate by hand.
  if (plan.skippedAlreadyFiled.length > 0) {
    lines.push(
      `Skipped — already filed in History (${plan.skippedAlreadyFiled.length}):`,
    )
    for (const entry of plan.skippedAlreadyFiled) {
      lines.push(`  ${entry.name}  (root @${entry.index})`)
    }
    lines.push('')
  }
  if (plan.skippedAmbiguous.length > 0) {
    lines.push(
      `Skipped — ambiguous root duplicates (${plan.skippedAmbiguous.length}):`,
    )
    for (const entry of plan.skippedAmbiguous) {
      lines.push(`  ${entry.name}  (root @${entry.index})`)
    }
    lines.push('')
  }

  lines.push(
    `Existing History contents (${plan.historyContents.length}) are never reordered or removed.`,
  )
  lines.push(
    'New archives are inserted at the front of History, above everything already filed.',
  )
  lines.push('')

  lines.push(
    mode === 'apply'
      ? 'Applying these changes now (--apply). A backup is written before the first change.'
      : 'Dry run. Re-run with --apply to perform these changes.',
  )

  return lines.join('\n')
}
