import { expect, test } from 'bun:test'
import { shouldRouteToWeb } from '../lambda-bun'
import { buildWebApp } from '../web/app'

function request(path: string, event?: unknown, method = 'GET') {
  const req = new Request(`http://localhost${path}`, { method })
  if (event !== undefined) Object.assign(req, { aws: event })
  return req
}

test('gate accepts only the intended local GET routes', () => {
  for (const path of [
    '/',
    '/app.js',
    '/api/current',
    '/api/archived',
    '/api/missing',
  ])
    expect(shouldRouteToWeb(request(path))).toBe(true)
  for (const path of [
    '/?action=promote',
    '/?action=',
    '/promote',
    '/undo-last',
    '/favicon.ico',
    '/api',
  ])
    expect(shouldRouteToWeb(request(path))).toBe(false)
  for (const method of ['POST', 'HEAD', 'PUT', 'DELETE'])
    expect(shouldRouteToWeb(request('/', undefined, method))).toBe(false)
})

test('gate uses attached v1/v2 event paths and action presence, not the runtime URL', () => {
  for (const shape of [
    { httpMethod: 'GET', path: '/' },
    { requestContext: { http: { method: 'GET' } }, rawPath: '/' },
  ]) {
    expect(shouldRouteToWeb(request('/?action=promote', shape))).toBe(true)
    expect(
      shouldRouteToWeb(
        request('/', { ...shape, queryStringParameters: { action: '' } }),
      ),
    ).toBe(false)
    expect(
      shouldRouteToWeb(
        request('/', { ...shape, queryStringParameters: { action: 'user' } }),
      ),
    ).toBe(false)
  }
})

test('scheduled events and wrappers stay on legacy handler', () => {
  const event = { queryStringParameters: { action: 'frequent-crawling' } }
  expect(shouldRouteToWeb(request('/', event))).toBe(false)
  expect(shouldRouteToWeb(request('/', { requestId: 'id', event }))).toBe(false)
  expect(shouldRouteToWeb(request('/', null))).toBe(false)
})

const current = {
  playlist: 'Current',
  trackCount: 0,
  archivesAfterDays: 45,
  neverPlayedFromCurrent: 0,
  tracks: [],
  playsToArchive: 5,
  generatedAt: 'now',
}
const archived = { tracks: [], trackCount: 0, generatedAt: 'now' }

test('Hono serves assets and APIs, validates limits, and never falls through', async () => {
  const limits: number[] = []
  const app = buildWebApp({
    current: async () => current,
    archived: async (limit) => {
      limits.push(limit)
      return archived
    },
  })
  expect(await (await app.request('/api/current')).json()).toEqual(current)
  expect(await (await app.request('/api/archived')).json()).toEqual(archived)
  await app.request('/api/archived?limit=3')
  expect(limits).toEqual([20, 3])
  for (const value of ['0', '21', '-1', '1.5', 'abc', ''])
    expect((await app.request(`/api/archived?limit=${value}`)).status).toBe(400)
  expect((await app.request('/api/missing')).status).toBe(404)
  const html = await app.request('/')
  expect(html.headers.get('content-type')).toContain('text/html')
  expect(await html.text()).toContain('Recently archived')
  const js = await app.request('/app.js')
  expect(js.headers.get('content-type')).toContain('text/javascript')
  expect(js.headers.get('cache-control')).toBe('no-store')
})

test('loader errors return JSON with the shared normalization', async () => {
  const app = buildWebApp({
    current: async () => {
      throw new Error('unavailable')
    },
    archived: async () => {
      throw 'cannot find playlist'
    },
  })
  const failure = await app.request('/api/current')
  expect(failure.status).toBe(500)
  expect(await failure.json()).toEqual({ error: 'unavailable' })
  expect((await app.request('/api/archived')).status).toBe(400)
})
