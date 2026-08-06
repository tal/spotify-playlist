import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'
import type { APIGatewayProxyEvent } from 'aws-lambda'
import type { Action } from '../actions/action'
import * as actionModule from '../actions/action'
import { ArchiveAction } from '../actions/archive-action'
import { DemoteAction } from '../actions/demote-action'
import { MagicPromoteAction } from '../actions/magic-promote-action'
import { ProcessManualTriage } from '../actions/process-manual-triage'
import { ProcessPlaybackHistoryAction } from '../actions/process-playback-history-action'
import { RulePlaylistAction } from '../actions/rule-playlist'
import { ScanPlaylistsForInbox } from '../actions/scan-playlists-for-inbox'
import { SkipToNextTrack } from '../actions/skip-to-next-track'
import { UndoAction } from '../actions/undo-action'
import type { Dynamo } from '../db/dynamo'
import * as dynamoModule from '../db/dynamo'
import { handler } from '../index'
import { Spotify } from '../spotify'

/**
 * Routing-helper tests prove how an action name is extracted. These tests pin
 * the next boundary: the action list that each operational endpoint hands to
 * the real sequential runner. The dependencies are spied only at their public
 * factories, so the handler switch itself is executed unchanged.
 */

const user: UserData = {
  id: 'test-user',
  spotifyAuth: { accessToken: '', refreshToken: '', expiresAt: 0 },
  lastPlayedAtProcessedTimestamp: 0,
}

const dynamo = { user } as Dynamo
const playing = {
  id: 'track-a',
  uri: 'spotify:track:track-a',
} as any
const spotify = {
  currentTrack: Promise.resolve(playing),
} as Spotify

let dispatched: Action | (Action | null)[] | undefined

function event(
  action: string,
  queryStringParameters: Record<string, string> = {},
): APIGatewayProxyEvent {
  return {
    path: `/${action}`,
    rawPath: `/${action}`,
    pathParameters: { action },
    queryStringParameters,
  } as unknown as APIGatewayProxyEvent
}

beforeEach(() => {
  dispatched = undefined
  spyOn(dynamoModule, 'getDynamo').mockResolvedValue(dynamo)
  spyOn(Spotify, 'get').mockResolvedValue(spotify)
  spyOn(actionModule, 'performActions').mockImplementation(
    async (_dynamo, _spotify, actions) => {
      dispatched = actions
      return []
    },
  )
})

afterEach(() => {
  mock.restore()
})

async function dispatch(
  action: string,
  queryStringParameters: Record<string, string> = {},
) {
  const response = (await handler(
    event(action, queryStringParameters),
    {} as any,
    (() => {}) as any,
  )) as { statusCode: number; body: string }

  expect(response.statusCode).toBe(200)
  expect(JSON.parse(response.body)).toEqual({ result: [] })
  return dispatched
}

describe('handler action dispatch', () => {
  it('keeps frequent-crawling in its dependency-sensitive order', async () => {
    const actions = (await dispatch('frequent-crawling')) as Action[]

    expect(actions.map((action) => action.constructor)).toEqual([
      ProcessPlaybackHistoryAction,
      ArchiveAction,
      ProcessManualTriage,
      ScanPlaylistsForInbox,
      RulePlaylistAction,
    ])
  })

  it('runs playback history before manual-triage reconciliation', async () => {
    const actions = (await dispatch('playback')) as Action[]

    expect(actions.map((action) => action.constructor)).toEqual([
      ProcessPlaybackHistoryAction,
      ProcessManualTriage,
    ])
  })

  it('runs playback history before scanning the automatic inbox sources', async () => {
    const actions = (await dispatch('auto-inbox')) as Action[]

    expect(actions.map((action) => action.constructor)).toEqual([
      ProcessPlaybackHistoryAction,
      ScanPlaylistsForInbox,
    ])
  })

  it('captures the current identity before dispatching skip then promote', async () => {
    const actions = (await dispatch('promotes')) as Action[]

    expect(actions[0]).toBeInstanceOf(SkipToNextTrack)
    expect(actions[1]).toBeInstanceOf(MagicPromoteAction)
    expect(await actions[1].getID()).toBe('promote:spotify:track:track-a')
  })

  it('builds an optional skip ahead of a demote without losing its identity', async () => {
    const actions = (await dispatch('demote', { 'and-skip': '1' })) as Action[]

    expect(actions[0]).toBeInstanceOf(SkipToNextTrack)
    expect(actions[1]).toBeInstanceOf(DemoteAction)
    expect(await actions[1].getID()).toBe('demote:spotify:track:track-a')
  })

  it('passes explicit undo query parameters into UndoAction', async () => {
    const action = (await dispatch('undo', {
      'action-id': 'promote:spotify:track:a',
      'action-type': 'promote',
    })) as UndoAction

    expect(action).toBeInstanceOf(UndoAction)
    expect((action as any).options).toEqual({
      actionId: 'promote:spotify:track:a',
      actionType: 'promote',
    })
  })
})
