const $ = (id) => document.getElementById(id)
const date = (value) =>
  new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
// The song cell is identical across every feed: an album-art thumbnail (when
// the track has one) beside the track name (a link to Spotify) and its artist.
function songCell(track) {
  const song = element('div', 'song')
  if (track.image) {
    const art = element('img', 'art')
    art.src = track.image
    art.alt = '' // decorative — the track name link is the accessible label
    art.loading = 'lazy'
    art.width = 44
    art.height = 44
    song.append(art)
  }
  const text = element('div', 'song-text')
  const link = element('a', '', track.name)
  link.href = `https://open.spotify.com/track/${encodeURIComponent(track.id)}`
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  text.append(link, element('div', 'artist', track.artist))
  song.append(text)
  return song
}
async function load(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Refresh failed (${response.status})`)
      return await response.json()
    } catch (error) {
      if (attempt === 1) throw error
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
}
function renderTracks(target, tracks, threshold, archived) {
  const fragment = document.createDocumentFragment()
  for (const [index, track] of tracks.entries()) {
    const row = element('div', 'row')
    row.append(element('span', 'number', String(index + 1).padStart(2, '0')))
    const song = songCell(track)
    const plays = element(
      'div',
      'metric',
      `${track.playsFromCurrent} ${track.playsFromCurrent === 1 ? 'play' : 'plays'}`,
    )
    plays.append(element('small', '', 'from Current'))
    if (!archived) {
      const bar = element('div', 'bar')
      const fill = element('span')
      fill.style.width = `${Math.min(100, Math.max(0, (track.playsFromCurrent / threshold) * 100))}%`
      bar.append(fill)
      plays.append(bar)
    }
    const secondary = element(
      'div',
      'metric secondary',
      archived ? date(track.archivedAt) : `${track.daysInCurrent} days`,
    )
    secondary.append(
      element('small', '', archived ? track.playlist : 'in Current'),
    )
    row.append(song, plays, secondary)
    fragment.append(row)
  }
  if (!tracks.length)
    fragment.append(
      element(
        'p',
        'message',
        archived
          ? 'No archive additions yet.'
          : 'Your Current playlist is empty.',
      ),
    )
  $(target).replaceChildren(fragment)
}
function renderInbox(target, tracks) {
  const fragment = document.createDocumentFragment()
  for (const track of tracks) {
    const row = element('div', 'row')
    // The real Spotify playlist position, so it jumps where unavailable tracks
    // were dropped rather than renumbering from 1.
    row.append(element('span', 'number', String(track.position).padStart(2, '0')))
    const song = songCell(track)
    const liked = track.likeStatus === 'liked'
    const like = element('div', 'metric')
    like.append(
      element('span', liked ? 'heart liked' : 'heart', liked ? '♥' : '♡'),
      element('small', '', liked ? 'Liked' : 'Unheard'),
    )
    const plays = element(
      'div',
      'metric secondary',
      `${track.playsFromInbox} ${track.playsFromInbox === 1 ? 'play' : 'plays'}`,
    )
    plays.append(element('small', '', 'in Inbox'))
    row.append(song, like, plays)
    fragment.append(row)
  }
  if (!tracks.length)
    fragment.append(element('p', 'message', 'Your Inbox is empty.'))
  $(target).replaceChildren(fragment)
}
const stageLabel = (stage) =>
  stage ? stage[0].toUpperCase() + stage.slice(1) : '—'
function transition(before, after, key) {
  // "unheard → current" style, degrading to "—" on either missing side.
  const span = element('span')
  span.append(element('span', 'stage', before ? before[key] ?? '' : '—'))
  span.append(element('span', 'arrow', '→'))
  span.append(element('span', 'stage', after ? after[key] ?? '' : '—'))
  return span
}
function renderPromotes(target, tracks) {
  const fragment = document.createDocumentFragment()
  for (const [index, track] of tracks.entries()) {
    const row = element('div', 'row')
    row.append(element('span', 'number', String(index + 1).padStart(2, '0')))
    const song = songCell(track)
    // The stage transition this event represents, e.g. "unheard → current".
    const move = element('div', 'metric')
    const [from, to] = String(track.transition).split(' → ')
    const stages = element('span')
    stages.append(
      element('span', 'stage', from ?? '—'),
      element('span', 'arrow', '→'),
      element('span', 'stage', to ?? '—'),
    )
    move.append(stages)
    // When it was promoted, and where the track lives now. Show the play count
    // that matches the stage: Current plays for a Current promote, Inbox for a
    // like.
    const plays =
      track.stage === 'current' ? track.playsFromCurrent : track.playsFromInbox
    const when = element('div', 'metric secondary', date(track.promotedAt))
    // Full ISO timestamp for debugging — the human date above hides the time, so
    // same-day promotes look identical without it.
    when.append(element('small', 'timestamp', track.promotedAt))
    when.append(
      element(
        'small',
        '',
        `now: ${track.liveStatus ?? 'unknown'} · ${plays} ${plays === 1 ? 'play' : 'plays'}`,
      ),
    )
    row.append(song, move, when)
    fragment.append(row)
  }
  if (!tracks.length)
    fragment.append(element('p', 'message', 'No promotions found.'))
  $(target).replaceChildren(fragment)
}
function showError(target, error) {
  $(target).replaceChildren(
    element(
      'p',
      'message error',
      `${error.message}. Try Refresh again shortly.`,
    ),
  )
}
// Time-of-day stamp for the "updated" line. Falls back to the client clock when
// a feed carries no server timestamp (inbox/promotes don't).
const clock = (value) =>
  new Date(value ?? Date.now()).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
// One entry per tab. `load()` fetches + renders into its own panel and returns
// an optional server timestamp for the "updated" line. `reload: true` means
// never cache — re-fetch every time the tab is shown (Recently promoted is a
// debug view, so it must always reflect live state).
const feeds = {
  current: {
    label: 'Current',
    placeholder: 'Loading your rotation…',
    loaded: false,
    reload: false,
    async load() {
      const current = await load('/api/current')
      renderTracks('current', current.tracks, current.playsToArchive, false)
      $('total').textContent = current.trackCount
      $('unplayed').textContent = current.neverPlayedFromCurrent
      $('threshold').textContent = `${current.playsToArchive} plays`
      $('age').textContent = `or ${current.archivesAfterDays} days in Current`
      return current.generatedAt
    },
    onError() {
      for (const id of ['total', 'unplayed', 'threshold'])
        $(id).textContent = '—'
    },
  },
  inbox: {
    label: 'Inbox',
    placeholder: 'Loading your Inbox…',
    loaded: false,
    reload: false,
    async load() {
      const inbox = await load('/api/inbox')
      renderInbox('inbox', inbox.tracks)
    },
  },
  promotes: {
    label: 'Recently promoted',
    placeholder: 'Loading recent promotes…',
    loaded: false,
    // Debug view: always re-fetch when shown or refreshed, never cache.
    reload: true,
    async load() {
      const promotes = await load('/api/promotes')
      renderPromotes('promotes', promotes.tracks)
    },
  },
  archived: {
    label: 'Recently archived',
    placeholder: 'Reading the latest monthly archives…',
    loaded: false,
    reload: false,
    async load() {
      const archived = await load('/api/archived?limit=20')
      renderTracks('archived', archived.tracks, 1, true)
      $('archive-updated').textContent =
        `Archives updated ${new Date(archived.generatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · live`
      return archived.generatedAt
    },
    onError() {
      $('archive-updated').textContent = 'Archives unavailable'
    },
  },
}
// The Lambda has reserved concurrency 1 — never overlap requests. Every feed
// load is serialized through this single chain, and a feed already queued/in
// flight is not enqueued twice.
let chain = Promise.resolve()
let loadingCount = 0
function queueFeed(key, force) {
  const feed = feeds[key]
  if (!feed || feed.loading) return
  // Lazy: skip a feed that's already loaded, unless it's a reload-always feed
  // (promotes) or an explicit Refresh.
  if (!force && feed.loaded && !feed.reload) return
  feed.loading = true
  loadingCount++
  // Show the placeholder now, even while an earlier load is still in the chain,
  // so the freshly-selected panel never sits on stale content.
  $(key).replaceChildren(element('p', 'message', feed.placeholder))
  $('updated').textContent = 'Refreshing…'
  $('refresh').disabled = true
  chain = chain
    .then(() => runFeed(key))
    .finally(() => {
      feed.loading = false
      if (--loadingCount === 0) $('refresh').disabled = false
    })
}
async function runFeed(key) {
  const feed = feeds[key]
  try {
    const at = await feed.load()
    feed.loaded = true
    $('updated').textContent = `${feed.label} · ${clock(at)}`
  } catch (error) {
    // Leave it unloaded so the next visit re-fetches rather than caching the error.
    feed.loaded = false
    feed.onError?.()
    showError(key, error)
    $('updated').textContent = `${feed.label} unavailable`
  }
}
// Tabs. The URL hash is the single source of truth for which tab is active, so
// the choice survives reload and can be deep-linked (e.g. #promotes). Clicks and
// arrow keys set the hash; the hashchange handler does the show + lazy-load.
const tabs = [...document.querySelectorAll('[role="tab"]')]
const keyOf = (tab) => tab.getAttribute('aria-controls').replace('panel-', '')
const tabByKey = (key) => tabs.find((tab) => keyOf(tab) === key)
function showTab(tab) {
  for (const other of tabs) {
    const selected = other === tab
    other.setAttribute('aria-selected', String(selected))
    other.tabIndex = selected ? 0 : -1
    $(other.getAttribute('aria-controls')).hidden = !selected
  }
}
// A hash naming a real tab wins; anything else falls back to Current.
const hashKey = () =>
  feeds[location.hash.slice(1)] ? location.hash.slice(1) : 'current'
function syncFromHash() {
  const key = hashKey()
  showTab(tabByKey(key))
  queueFeed(key, false)
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    const key = keyOf(tab)
    // Clicking the already-active tab won't fire hashchange; re-trigger directly
    // so a reload-always feed (promotes) still re-fetches on re-click.
    if (location.hash.slice(1) === key) queueFeed(key, false)
    else location.hash = key
  })
  // Roving tabindex + automatic activation: arrows/Home/End move focus and the
  // active tab together, via the hash.
  tab.addEventListener('keydown', (event) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    let next
    if (step) next = tabs[(index + step + tabs.length) % tabs.length]
    else if (event.key === 'Home') next = tabs[0]
    else if (event.key === 'End') next = tabs[tabs.length - 1]
    else return
    event.preventDefault()
    next.focus()
    location.hash = keyOf(next)
  })
})
window.addEventListener('hashchange', syncFromHash)
// Refresh re-fetches whatever tab is visible — that doubles as the Recently
// promoted refresh button, since it always acts on the active tab.
$('refresh').addEventListener('click', () => queueFeed(hashKey(), true))
syncFromHash()
