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
    '/api/inbox',
    '/api/promotes',
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
const inbox = { tracks: [], trackCount: 0, likedCount: 0, generatedAt: 'now' }
const archived = { tracks: [], trackCount: 0, generatedAt: 'now' }
const promotes = { tracks: [], trackCount: 0, generatedAt: 'now' }

test('Hono serves assets and APIs, validates limits, and never falls through', async () => {
  const limits: number[] = []
  const app = buildWebApp({
    current: async () => current,
    inbox: async () => inbox,
    archived: async (limit) => {
      limits.push(limit)
      return archived
    },
    promotes: async () => promotes,
  })
  expect(await (await app.request('/api/current')).json()).toEqual(current)
  expect(await (await app.request('/api/inbox')).json()).toEqual(inbox)
  expect(await (await app.request('/api/promotes')).json()).toEqual(promotes)
  expect(await (await app.request('/api/archived')).json()).toEqual(archived)
  await app.request('/api/archived?limit=3')
  expect(limits).toEqual([20, 3])
  for (const value of ['0', '21', '-1', '1.5', 'abc', ''])
    expect((await app.request(`/api/archived?limit=${value}`)).status).toBe(400)
  expect((await app.request('/api/missing')).status).toBe(404)
  const html = await app.request('/')
  expect(html.headers.get('content-type')).toContain('text/html')
  const page = await html.text()
  expect(page).toContain('Recently archived')
  expect(page).toContain('Recently promoted')
  const js = await app.request('/app.js')
  expect(js.headers.get('content-type')).toContain('text/javascript')
  expect(js.headers.get('cache-control')).toBe('no-store')
})

test('dashboard renders the four sections as an ARIA tab set wired to the render targets', async () => {
  const app = buildWebApp({
    current: async () => current,
    inbox: async () => inbox,
    archived: async () => archived,
    promotes: async () => promotes,
  })
  const page = await (await app.request('/')).text()
  expect(page).toContain('role="tablist"')
  // Automatic activation starts on Current, and exactly one tab is selected.
  expect(page.match(/aria-selected="true"/g)).toHaveLength(1)
  expect(page).toMatch(/id="tab-current"[^>]*aria-selected="true"/)
  for (const key of ['current', 'inbox', 'promotes', 'archived']) {
    // Each tab controls its panel, and each panel holds the id app.js renders
    // into — selectTab() toggles `hidden` on the aria-controls target, so this
    // wiring is what makes tab switching reveal the right list.
    expect(page).toContain(`id="tab-${key}"`)
    expect(page).toContain(`aria-controls="panel-${key}"`)
    expect(page).toContain(`id="panel-${key}"`)
    expect(page).toContain(`id="${key}"`)
  }
  // The three inactive panels start hidden; Current does not.
  for (const key of ['inbox', 'promotes', 'archived'])
    expect(page).toMatch(new RegExp(`id="panel-${key}"[^>]*hidden`))
  expect(page).not.toMatch(/id="panel-current"[^>]*hidden/)
})

test('loader errors return JSON with the shared normalization', async () => {
  const app = buildWebApp({
    current: async () => {
      throw new Error('unavailable')
    },
    inbox: async () => {
      throw 'cannot find playlist named Inbox'
    },
    archived: async () => {
      throw 'cannot find playlist'
    },
    promotes: async () => promotes,
  })
  const failure = await app.request('/api/current')
  expect(failure.status).toBe(500)
  expect(await failure.json()).toEqual({ error: 'unavailable' })
  expect((await app.request('/api/inbox')).status).toBe(400)
  expect((await app.request('/api/archived')).status).toBe(400)
})
