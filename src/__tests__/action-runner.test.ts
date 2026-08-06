import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { performActions } from '../actions/action'
import type { Action, PerformContext, ThrottleWindow } from '../actions/action'
import { Mutation } from '../mutations/mutation'
import type {
  CompletionStates,
  MutationFailureMode,
  MutationIntent,
  MutationTypes,
} from '../mutations/mutation'
import { AddTrackListenMutation } from '../mutations/add-track-listen-mutation'
import { ListenSequence } from '../mutations/listen-sequence'
import { UpdateLastPlayedProcessedMutation } from '../mutations/update-last-played-processed-mutation'
import { processPlaybackHistoryPlan } from '../actions/process-playback-history-action'
import { UndoAction } from '../actions/undo-action'
import type { RecentlyPlayedItem } from 'spotify-web-api-node'
import type { Dynamo } from '../db/dynamo'
import type { Settings } from '../settings'
import type { Spotify } from '../spotify'

/**
 * Everything here goes through the real `performActions` loop. That is the
 * point: the ordering rules the playback pass depends on — sets sequential,
 * mutations within a set concurrent, the watermark set last — live in this loop
 * and nowhere else, so a test that hand-rolls the loop cannot catch a break in
 * them.
 */

const client = {} as Spotify

/** Stands in for `-run-this-first.ts`, which the runner never imports itself. */
const ambient = globalThis as { dev?: unknown }
let priorDev: unknown

beforeAll(() => {
  priorDev = ambient.dev
  // Pinned to the production branch so `settings()`-derived throttle windows
  // are a known 5 hours rather than whatever NODE_ENV happens to say.
  ambient.dev = { isDev: false, dryAWS: false, drySpotify: false }
})

afterAll(() => {
  ambient.dev = priorDev
})

type HistoryRow = { id: string; created_at: number }

type DynamoScript = {
  rows?: HistoryRow[]
  recent?: PromoteActionHistoryItemData[]
  trackWrite?: (id: string) => Promise<void>
}

/**
 * `getActionHistory` mirrors the real KeyConditionExpression — exact match on
 * id, `created_at` strictly greater than `since` — because the throttle's whole
 * behavior falls out of those two clauses. `getRecentActionsOfType` mirrors the
 * real scan filter for the same reason: the action type lives in the id prefix,
 * and a row already stamped undone is invisible to the next undo.
 */
function fakeDynamo({ rows = [], recent = [], trackWrite }: DynamoScript = {}) {
  const queries: { id: string; since: number }[] = []
  const stored: ActionHistoryItemData[] = []
  const written: { id: string; playedAt: number }[] = []
  const triaged: { id: string; actionType: TrackTriageActionType }[] = []
  const undone: { id: string; created_at: number; undone_at: number }[] = []
  let lastPlayedAt: number | undefined

  const dynamo = {
    user: { id: 'test-user' },
    ungId(id: string) {
      return id.replace(/^test-user:/, '')
    },
    async getActionHistory(id: string, since: number) {
      queries.push({ id, since })
      return rows.find((row) => row.id === id && row.created_at > since)
    },
    async getRecentActionsOfType(
      actionType: string,
      since: number,
      limit: number,
    ) {
      return recent
        .filter(
          (row) =>
            row.id.startsWith(`test-user:${actionType}:`) &&
            row.created_at > since &&
            !row.undone,
        )
        .slice(0, limit)
    },
    async putActionHistory(history: ActionHistoryItemData) {
      stored.push(history)
      rows.push({ id: history.id, created_at: history.created_at })
      return history
    },
    async markActionAsUndone(
      { id, created_at }: { id: string; created_at: number },
      undoneAt: number,
    ) {
      undone.push({ id, created_at, undone_at: undoneAt })
    },
    async addTrackTriageAction(
      { id }: { id: string },
      { action_type }: TrackTriageAction,
    ) {
      triaged.push({ id, actionType: action_type })
    },
    async updateTrack(
      { id }: { id: string },
      { seen }: { seen?: { played_at: number } },
    ) {
      await trackWrite?.(id)
      written.push({ id, playedAt: seen!.played_at })
      return {}
    },
    async updateLastPlayedAtProcessedTimestamp(_userId: string, ts: number) {
      lastPlayedAt = ts
    },
  }

  return {
    dynamo: dynamo as unknown as Dynamo,
    queries,
    stored,
    written,
    triaged,
    undone,
    get lastPlayedAt() {
      return lastPlayedAt
    },
  }
}

type ScriptedBehavior = () => Promise<void>

class ScriptedMutation extends Mutation<{ label: string }> {
  mutationType: MutationTypes = 'triage-action'
  private plannedIntent: MutationIntent

  constructor(
    label: string,
    private behavior: ScriptedBehavior = async () => {},
    {
      failureMode,
      intent = 'run',
    }: { failureMode?: MutationFailureMode; intent?: MutationIntent } = {},
  ) {
    super({ label })
    if (failureMode) this.failureMode = failureMode
    this.plannedIntent = intent
  }

  protected intent(): MutationIntent {
    return this.plannedIntent
  }

  protected async mutate() {
    await this.behavior()
  }
}

type ActionScript = {
  sets: Mutation<any>[][]
  id?: string
  idThrottleMs?: ThrottleWindow
  history?: 'record' | 'none'
  describedAs?: string
}

class ScriptedAction implements Action {
  readonly type: string = 'process-manual-triage'
  readonly performedWith: PerformContext[] = []
  readonly idThrottleMs?: ThrottleWindow
  private readonly id: string
  private readonly sets: Mutation<any>[][]
  forStorage?: (mutations: Mutation<any>[]) => Promise<ActionHistoryItemData>
  description?: () => Promise<string>
  storedMutations: Mutation<any>[] = []

  constructor({
    sets,
    id = 'scripted',
    idThrottleMs,
    history,
    describedAs,
  }: ActionScript) {
    this.sets = sets
    this.id = id
    this.idThrottleMs = idThrottleMs

    if (describedAs) {
      this.description = async () => describedAs
    }

    if (history === 'record') {
      this.forStorage = async (mutations) => {
        this.storedMutations = mutations
        return {
          id: this.id,
          created_at: new Date().getTime(),
          action: 'process-manual-triage',
          mutations: mutations.map((m) => m.storage),
        }
      }
    }
  }

  async getID() {
    return this.id
  }

  async perform(ctx: PerformContext) {
    this.performedWith.push(ctx)
    return this.sets
  }
}

/**
 * Opens once `arrivals` mutations are waiting on it, so a set that runs its
 * mutations one after another never gets past the first — the timeout turns
 * that into a named failure instead of a hung test.
 */
function overlapGate(arrivals: number, timeoutMs = 500) {
  let seen = 0
  let open!: () => void
  let giveUp!: (error: Error) => void

  const opened = new Promise<void>((resolve, reject) => {
    open = resolve
    giveUp = reject
  })

  const timer = setTimeout(
    () => giveUp(new Error('mutations in one set never overlapped')),
    timeoutMs,
  )

  return {
    async arrive() {
      seen += 1
      if (seen >= arrivals) {
        clearTimeout(timer)
        open()
      }
      await opened
    },
  }
}

/** A macrotask boundary — everything already queued as a microtask runs first. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('mutation sets', () => {
  it('runs the mutations within a set concurrently', async () => {
    const events: string[] = []
    const gate = overlapGate(2)

    const overlapping = (label: string) =>
      new ScriptedMutation(label, async () => {
        events.push(`start:${label}`)
        await gate.arrive()
        events.push(`end:${label}`)
      })

    const action = new ScriptedAction({
      sets: [[overlapping('one'), overlapping('two')]],
    })

    await performActions(fakeDynamo().dynamo, client, action)

    expect(events.slice(0, 2)).toEqual(['start:one', 'start:two'])
    expect(events.slice(2).sort()).toEqual(['end:one', 'end:two'])
  })

  it('finishes a set before starting the next one', async () => {
    const events: string[] = []
    const gate = overlapGate(2)

    const slow = (label: string) =>
      new ScriptedMutation(label, async () => {
        events.push(`start:${label}`)
        await gate.arrive()
        events.push(`end:${label}`)
      })

    const later = new ScriptedMutation('third', async () => {
      events.push('start:third')
    })

    const action = new ScriptedAction({
      sets: [[slow('first'), slow('second')], [later]],
    })

    await performActions(fakeDynamo().dynamo, client, action)

    expect(events.indexOf('start:third')).toBe(events.length - 1)
    expect(events).toContain('end:first')
    expect(events).toContain('end:second')
  })

  it('hands every mutation that ran to forStorage', async () => {
    const table = fakeDynamo()
    const action = new ScriptedAction({
      sets: [
        [new ScriptedMutation('a'), new ScriptedMutation('b')],
        [new ScriptedMutation('c')],
      ],
      history: 'record',
    })

    await performActions(table.dynamo, client, action)

    expect(action.storedMutations.map((m) => m.storage.data)).toEqual([
      { label: 'a' },
      { label: 'b' },
      { label: 'c' },
    ])
    expect(table.stored).toHaveLength(1)
  })

  it('reports the action id, type and description on success', async () => {
    const action = new ScriptedAction({
      sets: [],
      id: 'scripted:reported',
      describedAs: 'moved 3 tracks',
    })

    const [result] = await performActions(fakeDynamo().dynamo, client, action)

    expect(result.reason).toBe('success')
    expect(result.value?.action_name).toBe('scripted:reported')
    expect(result.value?.action_type).toBe('process-manual-triage')
    expect(result.value?.name).toBe('moved 3 tracks')
  })

  it('skips the nulls in a list of actions', async () => {
    const first = new ScriptedAction({ sets: [], id: 'first' })
    const second = new ScriptedAction({ sets: [], id: 'second' })

    const results = await performActions(fakeDynamo().dynamo, client, [
      first,
      null,
      second,
    ])

    expect(results.map((r) => r.value?.action_name)).toEqual([
      'first',
      'second',
    ])
  })

  /**
   * Result order alone proves nothing here — `Promise.all` over the actions
   * would keep it. What only a sequential loop gives is that the second action
   * has neither planned nor run anything while the first is still going, so
   * that is what the first action's last mutation looks for from inside its own
   * run.
   */
  it('starts an action only once the one before it has finished', async () => {
    const events: string[] = []
    let secondWhileFirstRan: {
      planned: number
      state: CompletionStates | 'never looked'
    } = { planned: -1, state: 'never looked' }

    const opener = new ScriptedMutation('b', async () => {
      events.push('start:b')
    })
    const second = new ScriptedAction({ sets: [[opener]], id: 'second' })

    const first = new ScriptedAction({
      id: 'first',
      sets: [
        [
          new ScriptedMutation('a1', async () => {
            events.push('start:a1')
          }),
        ],
        [
          new ScriptedMutation('a2', async () => {
            events.push('start:a2')
            // Three macrotask boundaries: more than enough for a concurrent
            // second action to get through settings, planning and its first
            // mutation.
            await settle()
            await settle()
            await settle()
            secondWhileFirstRan = {
              planned: second.performedWith.length,
              state: opener.completionState.state,
            }
            events.push('end:a2')
          }),
        ],
      ],
    })

    await performActions(fakeDynamo().dynamo, client, [first, second])

    expect(secondWhileFirstRan).toEqual({ planned: 0, state: 'pending' })
    expect(events).toEqual(['start:a1', 'start:a2', 'end:a2', 'start:b'])
  })
})

describe('failure modes', () => {
  const boom = () => new Error('ProvisionedThroughputExceeded')

  it("stops later sets when an 'abort-action' mutation rejects", async () => {
    const table = fakeDynamo()
    const failing = new ScriptedMutation('fails', async () => {
      throw boom()
    })
    const later = new ScriptedMutation('later')

    const action = new ScriptedAction({
      sets: [[failing], [later]],
      history: 'record',
    })

    await expect(performActions(table.dynamo, client, action)).rejects.toThrow(
      'ProvisionedThroughputExceeded',
    )

    expect(failing.completionState.state).toBe('error')
    expect(later.completionState.state).toBe('pending')
    expect(table.stored).toEqual([])
  })

  it("keeps going when a 'record-and-continue' mutation rejects", async () => {
    const table = fakeDynamo()
    const failing = new ScriptedMutation(
      'fails',
      async () => {
        throw boom()
      },
      { failureMode: 'record-and-continue' },
    )
    const sibling = new ScriptedMutation('sibling')
    const later = new ScriptedMutation('later')

    const action = new ScriptedAction({
      sets: [[failing, sibling], [later]],
      history: 'record',
    })

    const [result] = await performActions(table.dynamo, client, action)

    expect(result.reason).toBe('success')
    expect(failing.completionState.state).toBe('error')
    expect(sibling.completionState.state).toBe('success')
    expect(later.completionState.state).toBe('success')
  })

  it('still stores a mutation that failed without aborting', async () => {
    const table = fakeDynamo()
    const failing = new ScriptedMutation(
      'fails',
      async () => {
        throw boom()
      },
      { failureMode: 'record-and-continue' },
    )

    const action = new ScriptedAction({ sets: [[failing]], history: 'record' })

    await performActions(table.dynamo, client, action)

    expect(action.storedMutations).toEqual([failing])
  })

  it("resolves a 'skip' intent mutation without running or blocking its set", async () => {
    const events: string[] = []
    const skipped = new ScriptedMutation(
      'skipped',
      async () => {
        events.push('skipped ran')
      },
      { intent: 'skip' },
    )
    const sibling = new ScriptedMutation('sibling', async () => {
      events.push('sibling ran')
    })
    const later = new ScriptedMutation('later', async () => {
      events.push('later ran')
    })

    const action = new ScriptedAction({ sets: [[skipped, sibling], [later]] })

    const [result] = await performActions(fakeDynamo().dynamo, client, action)

    expect(skipped.completionState.state).toBe('skipped')
    expect(events).toEqual(['sibling ran', 'later ran'])
    expect(result.reason).toBe('success')
  })
})

describe('throttling', () => {
  const MINUTE_MS = 60 * 1000

  function tenMinuteOldRow(id: string): HistoryRow {
    return { id, created_at: new Date().getTime() - 10 * MINUTE_MS }
  }

  it('skips perform entirely when a run inside the window is on record', async () => {
    const table = fakeDynamo({ rows: [tenMinuteOldRow('throttled-action')] })
    const action = new ScriptedAction({
      sets: [[new ScriptedMutation('never')]],
      id: 'throttled-action',
      idThrottleMs: 60 * MINUTE_MS,
    })

    const [result] = await performActions(table.dynamo, client, action)

    expect(result.reason).toBe('throttled')
    expect(result.value).toBeUndefined()
    expect(action.performedWith).toEqual([])
  })

  it('runs when the recorded run is older than the window', async () => {
    const table = fakeDynamo({ rows: [tenMinuteOldRow('brief-throttle')] })
    const action = new ScriptedAction({
      sets: [],
      id: 'brief-throttle',
      idThrottleMs: 5 * MINUTE_MS,
    })

    const [result] = await performActions(table.dynamo, client, action)

    expect(result.reason).toBe('success')
    expect(action.performedWith).toHaveLength(1)
  })

  it('looks back exactly one window from now', async () => {
    const table = fakeDynamo()
    const action = new ScriptedAction({
      sets: [],
      id: 'windowed',
      idThrottleMs: 5 * MINUTE_MS,
    })

    const before = new Date().getTime()
    await performActions(table.dynamo, client, action)
    const after = new Date().getTime()

    expect(table.queries).toHaveLength(1)
    expect(table.queries[0].id).toBe('windowed')
    expect(table.queries[0].since).toBeGreaterThanOrEqual(
      before - 5 * MINUTE_MS,
    )
    expect(table.queries[0].since).toBeLessThanOrEqual(after - 5 * MINUTE_MS)
  })

  it('never queries at all when no window is declared', async () => {
    const table = fakeDynamo()
    const action = new ScriptedAction({ sets: [], id: 'unthrottled' })

    await performActions(table.dynamo, client, action)

    expect(table.queries).toEqual([])
  })

  it('resolves a window given as a function of settings', async () => {
    const table = fakeDynamo({ rows: [tenMinuteOldRow('settings-throttle')] })
    const action = new ScriptedAction({
      sets: [],
      id: 'settings-throttle',
      // 5 hours in production, so a ten-minute-old run is still inside it.
      idThrottleMs: (settings) => settings.promoteThrottleMs,
    })

    const [result] = await performActions(table.dynamo, client, action)

    expect(result.reason).toBe('throttled')
    expect(action.performedWith).toEqual([])
  })

  it('hands the resolver the same settings perform receives', async () => {
    const table = fakeDynamo()
    const seen: Settings[] = []
    const action = new ScriptedAction({
      sets: [],
      id: 'resolver-settings',
      idThrottleMs: (settings) => {
        seen.push(settings)
        return 1
      },
    })

    await performActions(table.dynamo, client, action)

    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(action.performedWith[0].settings)
  })

  it('throttles a second run of the same stable id', async () => {
    const table = fakeDynamo()
    const script = (): ActionScript => ({
      sets: [],
      id: 'stable:the-same-every-time',
      idThrottleMs: 60 * MINUTE_MS,
      history: 'record',
    })

    const first = new ScriptedAction(script())
    const second = new ScriptedAction(script())

    await performActions(table.dynamo, client, first)
    const [result] = await performActions(table.dynamo, client, second)

    expect(result.reason).toBe('throttled')
    expect(second.performedWith).toEqual([])
  })

  /**
   * Documents the ArchiveAction trap in AGENTS.md rather than a bug in the
   * runner: the lookup is an exact match on the id, so an id minted from the
   * clock can never find the row the previous run stored, and the declared
   * window is not a guardrail at all.
   */
  it('cannot throttle an action whose id changes between runs', async () => {
    const table = fakeDynamo()
    const script = (): ActionScript => ({
      sets: [],
      id: `unstable:${new Date().getTime()}:${Math.random()}`,
      idThrottleMs: 60 * MINUTE_MS,
      history: 'record',
    })

    const first = new ScriptedAction(script())
    const second = new ScriptedAction(script())

    await performActions(table.dynamo, client, first)
    const [result] = await performActions(table.dynamo, client, second)

    expect(result.reason).toBe('success')
    expect(second.performedWith).toHaveLength(1)
  })
})

/**
 * The playback pass is the one place where mutation-set *shape* is load-bearing:
 * one listen per set, ascending by played_at, watermark last. Listen writes are
 * not idempotent, so the watermark may only advance across an unbroken prefix of
 * writes that landed. These drive the real plan through the real runner.
 */
describe('the playback pass through the runner', () => {
  const STARTING_WATERMARK = 1_000

  const listens = [
    { id: 'a', playedAt: 2_000 },
    { id: 'b', playedAt: 3_000 },
    { id: 'c', playedAt: 4_000 },
    { id: 'd', playedAt: 5_000 },
  ]

  function playbackSets() {
    return processPlaybackHistoryPlan({
      playedItems: listens.map(({ id, playedAt }) => ({
        track: { id },
        played_at: new Date(playedAt).toISOString(),
      })) as unknown as RecentlyPlayedItem[],
      stageByPlaylistId: new Map(),
      watermark: STARTING_WATERMARK,
      userId: 'test-user',
    })
  }

  function failWriteFor(id: string) {
    return async (writing: string) => {
      if (writing === id)
        throw new Error(`ProvisionedThroughputExceeded: ${id}`)
    }
  }

  it('plans one listen per set with the watermark last', () => {
    const sets = playbackSets()

    expect(sets.map((set) => set.length)).toEqual([1, 1, 1, 1, 1])
    expect(sets.map((set) => set[0].storage.mutationType)).toEqual([
      'add-track-listen',
      'add-track-listen',
      'add-track-listen',
      'add-track-listen',
      'update-last-played-processed',
    ])
  })

  it('advances the watermark to the newest listen when every write lands', async () => {
    const table = fakeDynamo()
    const action = new ScriptedAction({ sets: playbackSets() })

    await performActions(table.dynamo, client, action)

    expect(table.written.map((w) => w.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(table.lastPlayedAt).toBe(5_000)
  })

  it('stops the watermark at the last write that landed', async () => {
    const table = fakeDynamo({ trackWrite: failWriteFor('c') })
    const action = new ScriptedAction({ sets: playbackSets() })

    const [result] = await performActions(table.dynamo, client, action)

    expect(result.reason).toBe('success')
    expect(table.written.map((w) => w.id)).toEqual(['a', 'b'])
    expect(table.lastPlayedAt).toBe(3_000)
  })

  it('leaves the watermark alone when the very first write fails', async () => {
    const table = fakeDynamo({ trackWrite: failWriteFor('a') })
    const action = new ScriptedAction({ sets: playbackSets() })

    await performActions(table.dynamo, client, action)

    expect(table.written).toEqual([])
    expect(table.lastPlayedAt).toBe(STARTING_WATERMARK)
  })

  it('stores the watermark it wrote rather than the one it planned', async () => {
    const table = fakeDynamo({ trackWrite: failWriteFor('c') })
    const action = new ScriptedAction({
      sets: playbackSets(),
      history: 'record',
    })

    await performActions(table.dynamo, client, action)

    const watermark = action.storedMutations.at(-1)!
    expect(watermark.storage.mutationType).toBe('update-last-played-processed')
    expect((watermark.storage.data as { ts: number }).ts).toBe(3_000)
  })

  it('records the whole pass, including the write that failed and the ones it skipped', async () => {
    const table = fakeDynamo({ trackWrite: failWriteFor('c') })
    const sets = playbackSets()
    const action = new ScriptedAction({ sets, history: 'record' })

    await performActions(table.dynamo, client, action)

    expect(sets.flat().map((m) => m.completionState.state)).toEqual([
      'success',
      'success',
      'error',
      'skipped',
      'success',
    ])
    expect(action.storedMutations).toHaveLength(5)
  })

  /**
   * The invariant above is enforced by nothing but the plan's shape. This is
   * what chunking the listen writes for throughput would buy — the way
   * ProcessManualTriage and ArchiveAction already chunk theirs — because the
   * runner fires a whole set as one Promise.all, so a later write can land, and
   * move the watermark, before an earlier one has failed.
   *
   * Not a bug in anything shipping today: the real plan never puts two listens
   * in one set. It fails the moment someone changes that.
   */
  it('lets the watermark pass a failed write when listens share a set', async () => {
    const sequence = new ListenSequence(STARTING_WATERMARK)
    let releaseTheFailure: () => void
    const laterWriteLanded = new Promise<void>((resolve) => {
      releaseTheFailure = resolve
    })

    const table = fakeDynamo({
      trackWrite: async (id) => {
        if (id === 'd') {
          releaseTheFailure()
          return
        }
        await laterWriteLanded
        await settle()
        throw new Error('ProvisionedThroughputExceeded: c')
      },
    })

    const chunked = [
      { id: 'c', playedAt: 4_000 },
      { id: 'd', playedAt: 5_000 },
    ].map(
      ({ id, playedAt }) =>
        new AddTrackListenMutation(
          {
            track: { id },
            increment_by: 1,
            seen: { played_at: playedAt, exactness: 'played' },
          },
          sequence,
        ),
    )

    const action = new ScriptedAction({
      sets: [
        chunked,
        [
          new UpdateLastPlayedProcessedMutation(
            { userId: 'test-user' },
            sequence,
          ),
        ],
      ],
    })

    await performActions(table.dynamo, client, action)

    expect(table.written.map((w) => w.id)).toEqual(['d'])
    expect(chunked[0].completionState.state).toBe('error')
    // 4_000 never landed, and the watermark now claims it did.
    expect(table.lastPlayedAt).toBe(5_000)
  })
})

/**
 * Undo writes to `action_history` twice — once as itself through `forStorage`,
 * once by stamping the row it reversed — and neither write is the plan's doing:
 * `undoPlan` only positions the stamp in a trailing set. Whether the stamp ever
 * reaches Dynamo, and whether it reaches it *after* the reversal landed, is the
 * runner's, so it takes a real `UndoAction` driven through `performActions`.
 */
describe('an undo through the runner', () => {
  const PROMOTED_AT = new Date().getTime() - 60 * 1000

  const xtal: BasicTrackData = {
    id: 'track-xtal',
    uri: 'spotify:track:track-xtal',
    name: 'Xtal',
    artist: 'Aphex Twin',
    album: 'Selected Ambient Works 85-92',
  }

  /** As `getRecentActionsOfType` hands it back: id already carrying the user. */
  const promoted: PromoteActionHistoryItemData = {
    id: `test-user:promote:${xtal.uri}`,
    created_at: PROMOTED_AT,
    action: 'promote-track',
    item: xtal,
    mutations: [],
  }

  const inbox = { id: 'playlist-inbox', name: 'Inbox' }
  const current = { id: 'playlist-current', name: 'Current' }
  const starred = { id: 'playlist-starred', name: 'Starred' }

  type SpotifyScript = { removeWrite?: (playlistId: string) => Promise<void> }

  /**
   * No player is faked, deliberately: an undo names its track by id, so every
   * read it takes is `getTrack` plus the triage playlists. A gather that
   * reached for the player instead would reverse whatever is playing now, and
   * here it would throw rather than pass.
   *
   * The track sits outside Starred, so the demote unsaves it rather than just
   * pulling it out of Starred.
   */
  function fakeSpotify({ removeWrite }: SpotifyScript = {}) {
    const removed: { playlist: string; track: string }[] = []
    const unsaved: string[] = []
    const named = (name: string) =>
      [inbox, current, starred].find((playlist) => playlist.name === name)

    const client = {
      async getTrack(id: string) {
        return {
          id,
          uri: xtal.uri,
          name: xtal.name,
          artists: [{ name: xtal.artist }],
          album: { name: xtal.album },
        }
      },
      async optionalPlaylist(name: string) {
        return named(name)
      },
      async playlist(name: string) {
        const playlist = named(name)
        if (!playlist) throw `cannot find playlist named ${name}`
        return playlist
      },
      async trackInPlaylist() {
        return undefined
      },
      async removeTrackFromPlaylist(
        { id }: { id: string },
        ...tracks: { uri: string }[]
      ) {
        await removeWrite?.(id)
        for (const track of tracks)
          removed.push({ playlist: id, track: track.uri })
      },
      async unsaveTrack(...ids: string[]) {
        unsaved.push(...ids)
      },
    }

    return { client: client as unknown as Spotify, removed, unsaved }
  }

  it('reverses the promote the stored row describes', async () => {
    const table = fakeDynamo({ recent: [promoted] })
    const spotify = fakeSpotify()
    const action = new UndoAction(spotify.client, table.dynamo)

    const [result] = await performActions(table.dynamo, spotify.client, action)

    expect(spotify.removed).toEqual([
      { playlist: current.id, track: xtal.uri },
      { playlist: inbox.id, track: xtal.uri },
    ])
    expect(spotify.unsaved).toEqual([xtal.id])
    expect(table.triaged).toEqual([{ id: xtal.id, actionType: 'remove' }])
    expect(result.reason).toBe('success')
  })

  it('stamps the reversed row under the key dynamo stored it by', async () => {
    const table = fakeDynamo({ recent: [promoted] })
    const spotify = fakeSpotify()
    const action = new UndoAction(spotify.client, table.dynamo)

    const before = new Date().getTime()
    await performActions(table.dynamo, spotify.client, action)
    const after = new Date().getTime()

    // The bare id, not the stored one: `markActionAsUndone` prefixes the user
    // back on, so handing it the row's own id would look for `test-user:test-
    // user:promote:…` and stamp nothing.
    expect(table.undone).toHaveLength(1)
    expect(table.undone[0].id).toBe(`promote:${xtal.uri}`)
    expect(table.undone[0].created_at).toBe(PROMOTED_AT)
    expect(table.undone[0].undone_at).toBeGreaterThanOrEqual(before)
    expect(table.undone[0].undone_at).toBeLessThanOrEqual(after)
  })

  it('records the undo as an action of its own', async () => {
    const table = fakeDynamo({ recent: [promoted] })
    const spotify = fakeSpotify()
    const action = new UndoAction(spotify.client, table.dynamo)

    const [result] = await performActions(table.dynamo, spotify.client, action)

    expect(table.stored).toHaveLength(1)
    const [row] = table.stored
    expect(row.id).toBe(`undo:${promoted.id}:${action.created_at}`)
    expect(row.created_at).toBe(action.created_at)
    expect(row.action as string).toBe('undo')
    expect(row.originalActionId).toBe(promoted.id)
    // The stamp is in there too: the row an undo stores is the whole run,
    // including the write that recorded the run.
    expect(row.mutations.map((m) => m.mutationType)).toEqual([
      'remove-track',
      'remove-track',
      'unsave-track',
      'triage-action',
      'mark-action-undone',
    ])
    expect(result.value).toEqual({
      action_name: row.id,
      action_type: 'undo',
      name: 'undo promote-track: Aphex Twin — Xtal',
    })
  })

  it('leaves the row unstamped when the reversal fails', async () => {
    const table = fakeDynamo({ recent: [promoted] })
    const spotify = fakeSpotify({
      removeWrite: async (playlistId) => {
        if (playlistId === current.id) throw new Error('502 Bad Gateway')
      },
    })
    const action = new UndoAction(spotify.client, table.dynamo)

    await expect(
      performActions(table.dynamo, spotify.client, action),
    ).rejects.toThrow('502 Bad Gateway')

    // Nothing marked it undone, so `/undo-last` can still find it and try again.
    expect(table.undone).toEqual([])
    expect(table.stored).toEqual([])
  })
})
