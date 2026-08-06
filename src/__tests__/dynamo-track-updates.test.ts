import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { AWS } from '../aws'
import {
  Dynamo,
  playCountAttributeFor,
  statusForTriageActions,
} from '../db/dynamo'

/**
 * Action and mutation tests use an in-memory Dynamo-shaped object. These tests
 * stop that fake at the real persistence boundary and inspect the UpdateCommand
 * the production Dynamo implementation sends, without requiring DynamoDB Local.
 */

const user: UserData = {
  id: 'test-user',
  spotifyAuth: { accessToken: '', refreshToken: '', expiresAt: 0 },
  lastPlayedAtProcessedTimestamp: 0,
}

function commandInput(send: ReturnType<typeof spyOn>) {
  const command = send.mock.calls[0][0]
  expect(command).toBeInstanceOf(UpdateCommand)
  return (command as UpdateCommand).input
}

afterEach(() => {
  ;(AWS.docs.send as any).mockRestore?.()
})

describe('statusForTriageActions', () => {
  it.each([
    ['inboxed', 'inbox'],
    ['promote', 'promoted'],
    ['remove', 'removed'],
  ] as const)('%s maps to %s', (action_type, status) => {
    expect(statusForTriageActions([{ action_type, action_at: 42 }])).toEqual({
      status,
      changed_at: 42,
    })
  })

  it('keeps upvote status-neutral', () => {
    expect(
      statusForTriageActions([{ action_type: 'upvote', action_at: 42 }]),
    ).toBeUndefined()
  })

  it('uses the last status-bearing action rather than a trailing upvote', () => {
    expect(
      statusForTriageActions([
        { action_type: 'inboxed', action_at: 10 },
        { action_type: 'promote', action_at: 20 },
        { action_type: 'upvote', action_at: 30 },
      ]),
    ).toEqual({ status: 'promoted', changed_at: 20 })
  })
})

describe('Dynamo track UpdateCommands', () => {
  it('appends a triage action and its denormalized status atomically', async () => {
    const send = spyOn(AWS.docs, 'send').mockResolvedValue({
      Attributes: { id: 'test-user:track-a' },
    } as never)
    const table = new Dynamo(user)

    await table.addTrackTriageAction(
      { id: 'track-a' },
      { action_type: 'promote', action_at: 123 },
    )

    expect(commandInput(send)).toEqual({
      TableName: 'track',
      Key: { id: 'test-user:track-a' },
      UpdateExpression:
        'SET #triage_actions = list_append(if_not_exists(#triage_actions, :empty_list), :location), #status = :status, status_changed_at = :status_changed_at',
      ExpressionAttributeNames: {
        '#triage_actions': 'triage_actions',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':location': [{ action_type: 'promote', action_at: 123 }],
        ':empty_list': [],
        ':status': 'promoted',
        ':status_changed_at': 123,
      },
      ReturnValues: 'ALL_NEW',
    })
  })

  it('does not overwrite status for an upvote-only write', async () => {
    const send = spyOn(AWS.docs, 'send').mockResolvedValue({
      Attributes: { id: 'test-user:track-a' },
    } as never)
    const table = new Dynamo(user)

    await table.addTrackTriageAction(
      { id: 'track-a' },
      { action_type: 'upvote', action_at: 123 },
    )

    const input = commandInput(send)
    expect(input.UpdateExpression).not.toContain('#status')
    expect(input.ExpressionAttributeNames).toEqual({
      '#triage_actions': 'triage_actions',
    })
    expect(input.ExpressionAttributeValues).not.toHaveProperty(':status')
    expect(input.ExpressionAttributeValues).not.toHaveProperty(
      ':status_changed_at',
    )
  })

  it('increments global and stage counts in the same write', async () => {
    const send = spyOn(AWS.docs, 'send').mockResolvedValue({
      Attributes: { id: 'test-user:track-a' },
    } as never)
    const table = new Dynamo(user)

    await table.updateTrack(
      { id: 'track-a' },
      {
        increment_by: 1,
        stage: 'current',
        seen: {
          uri: 'spotify:playlist:current',
          played_at: 123,
          exactness: 'played',
        },
      },
    )

    const input = commandInput(send)
    expect(input.Key).toEqual({ id: 'test-user:track-a' })
    expect(input.UpdateExpression).toContain(
      'play_count = if_not_exists(play_count, :zero) + :incr',
    )
    expect(input.UpdateExpression).toContain(
      'play_count_current = if_not_exists(play_count_current, :zero) + :incr',
    )
    expect(input.UpdateExpression).toContain(
      'first_seen = if_not_exists(first_seen, :seen)',
    )
    expect(input.UpdateExpression).toContain('last_seen = :seen')
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':zero': 0,
      ':incr': 1,
      ':seen': {
        uri: 'spotify:playlist:current',
        played_at: 123,
        exactness: 'played',
      },
    })
    expect(input.ExpressionAttributeNames).toBeUndefined()
  })

  it('does not increment a stage counter for a manual placement', async () => {
    const send = spyOn(AWS.docs, 'send').mockResolvedValue({
      Attributes: { id: 'test-user:track-a' },
    } as never)
    const table = new Dynamo(user)

    await table.updateTrack(
      { id: 'track-a' },
      {
        increment_by: 0,
        stage: 'inbox',
        triageActions: [{ action_type: 'inboxed', action_at: 123 }],
      },
    )

    const input = commandInput(send)
    expect(input.UpdateExpression).not.toContain('play_count')
    expect(input.UpdateExpression).toContain('triage_actions')
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':status': 'inbox',
      ':status_changed_at': 123,
    })
  })
})

describe('playCountAttributeFor', () => {
  it('maps both triage stages to their persisted attributes', () => {
    expect(playCountAttributeFor('inbox')).toBe('play_count_inbox')
    expect(playCountAttributeFor('current')).toBe('play_count_current')
  })
})
