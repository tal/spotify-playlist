import { Hono } from 'hono'
import { join } from 'node:path'
import { normalizeActionError } from '../action-error'
import type { currentPlan } from './current'
import type { archivedPlan } from './archived'
import type { inboxPlan } from './inbox'

type Loaders = {
  current: () => Promise<ReturnType<typeof currentPlan>>
  inbox: () => Promise<ReturnType<typeof inboxPlan>>
  archived: (limit: number) => Promise<ReturnType<typeof archivedPlan>>
}

const assets = new Map<string, Promise<string>>()
function asset(name: string) {
  let text = assets.get(name)
  if (!text) {
    text = Bun.file(join(__dirname, name))
      .text()
      .catch((error) => {
        assets.delete(name)
        throw error
      })
    assets.set(name, text)
  }
  return text
}

export function buildWebApp(loaders: Loaders) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
    try {
      await next()
    } catch (error) {
      // Hono only sends Error instances to onError; legacy code also throws strings.
      const normalized = normalizeActionError(error)
      return c.json(
        { error: normalized.errorMessage },
        normalized.statusCode === 400 ? 400 : 500,
      )
    }
  })
  app.get('/', async (c) => c.html(await asset('index.html')))
  // text/* avoids the Bun Lambda layer's binary response encoding.
  app.get('/app.js', async (c) =>
    c.body(await asset('app.js'), 200, {
      'Content-Type': 'text/javascript; charset=utf-8',
    }),
  )
  app.get('/api/current', async (c) => c.json(await loaders.current()))
  app.get('/api/inbox', async (c) => c.json(await loaders.inbox()))
  app.get('/api/archived', async (c) => {
    const raw = c.req.query('limit') ?? '20'
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 20) {
      return c.json({ error: 'limit must be an integer from 1 to 20' }, 400)
    }
    return c.json(await loaders.archived(Number(raw)))
  })
  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  app.onError((error, c) => {
    const normalized = normalizeActionError(error)
    return c.json(
      { error: normalized.errorMessage },
      normalized.statusCode === 400 ? 400 : 500,
    )
  })
  return app
}
