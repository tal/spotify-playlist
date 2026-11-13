import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

// Exercise the actual browser router with a minimal DOM and history surface.
async function browser(path: string) {
  const source = await Bun.file(`${__dirname}/../web/app.js`).text()
  const nodes = new Map<string, any>()
  const listeners: Record<string, Function> = {}
  const loads: string[] = []
  function node(id: string) {
    if (!nodes.has(id))
      nodes.set(id, {
        attrs: { 'aria-controls': id.replace('tab-', 'panel-') },
        handlers: {} as Record<string, Function>,
        getAttribute(key: string) {
          return this.attrs[key]
        },
        setAttribute(key: string, value: string) {
          this.attrs[key] = value
        },
        addEventListener(key: string, fn: Function) {
          this.handlers[key] = fn
        },
        focus() {},
      })
    return nodes.get(id)
  }
  const keys = ['current', 'inbox', 'promotes', 'archived']
  const location = new URL(path, 'https://spotify.example')
  const entries = [location.href]
  let position = 0
  const context = {
    location,
    history: {
      pushState(_state: unknown, _unused: string, path: string) {
        location.href = new URL(path, location).href
        entries.splice(++position, entries.length, location.href)
      },
      replaceState(_state: unknown, _unused: string, path: string) {
        location.href = new URL(path, location).href
        entries[position] = location.href
      },
    },
    document: {
      body: { dataset: {} },
      querySelectorAll: () => keys.map((key) => node(`tab-${key}`)),
      addEventListener: (key: string, fn: Function) => {
        listeners[key] = fn
      },
    },
    window: {
      addEventListener: (key: string, fn: Function) => {
        listeners[key] = fn
      },
      scrollTo() {},
    },
    $: node,
    feeds: Object.fromEntries(keys.map((key) => [key, {}])),
    queueFeed: (key: string) => loads.push(key),
    queueTrack: (id: string) => loads.push(`track/${id}`),
    trackRoute: () =>
      /^\/track\/([0-9A-Za-z]{22})$/.exec(location.pathname)?.[1],
    lastTab: 'current',
    URL,
  }
  runInNewContext(
    source.slice(source.indexOf('// The pathname selects')),
    context,
  )
  return {
    context,
    location,
    entries,
    loads,
    node,
    listeners,
    go(delta: number) {
      position += delta
      location.href = entries[position]
      listeners.popstate()
    },
  }
}

test('path navigation, keyboard activation, and Back/Forward restore the active panel', async () => {
  const b = await browser('/inbox')
  expect(b.loads).toEqual(['inbox'])
  b.node('tab-promotes').handlers.click()
  expect(b.location.pathname).toBe('/promotes')
  expect(b.node('panel-inbox').hidden).toBe(true)
  b.node('tab-promotes').handlers.click()
  expect(b.entries).toHaveLength(2)
  b.node('tab-promotes').handlers.keydown({ key: 'End', preventDefault() {} })
  expect(b.location.pathname).toBe('/archived')
  b.go(-1)
  expect(b.node('tab-promotes').attrs['aria-selected']).toBe('true')
  b.go(1)
  expect(b.loads.at(-1)).toBe('archived')
})

test('internal track links use pushState and preserve modified clicks', async () => {
  const b = await browser('/current')
  const id = '4uLU6hMCjMI75M1A2tKUQC'
  let prevented = false
  const link = {
    href: `https://spotify.example/track/${id}`,
    hasAttribute: () => false,
  }
  const click = {
    button: 0,
    target: { closest: () => link },
    preventDefault() {
      prevented = true
    },
  }
  b.listeners.click({ ...click, metaKey: true })
  expect(b.entries).toHaveLength(1)
  b.listeners.click(click)
  expect(prevented).toBe(true)
  expect(b.location.pathname).toBe(`/track/${id}`)
  expect(b.context.document.body.dataset).toEqual({ view: 'track' })
  b.go(-1)
  expect(b.loads.at(-1)).toBe('current')
})

test('direct track routes load and legacy bookmarks replace the hash entry', async () => {
  const id = '4uLU6hMCjMI75M1A2tKUQC'
  expect((await browser(`/track/${id}`)).loads).toEqual([`track/${id}`])
  const b = await browser('/#promotes')
  expect(b.location.pathname).toBe('/promotes')
  expect(b.location.hash).toBe('')
  expect(b.entries).toHaveLength(1)
  expect(b.loads).toEqual(['promotes'])
})
