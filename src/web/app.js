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
function spotifyLink(id, text) {
  const link = element('a', '', text)
  link.href = `https://open.spotify.com/track/${encodeURIComponent(id)}`
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  return link
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
  // The name opens the in-dashboard track detail; the ↗ goes to Spotify.
  const link = element('a', '', track.name)
  link.href = `/track/${encodeURIComponent(track.id)}`
  const out = spotifyLink(track.id, '↗')
  out.className = 'out'
  out.setAttribute('aria-label', `Open ${track.name} in Spotify`)
  const title = element('div', 'title')
  title.append(link, out)
  text.append(title, element('div', 'artist', track.artist))
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
    row.append(
      element('span', 'number', String(track.position).padStart(2, '0')),
    )
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
  span.append(element('span', 'stage', before ? (before[key] ?? '') : '—'))
  span.append(element('span', 'arrow', '→'))
  span.append(element('span', 'stage', after ? (after[key] ?? '') : '—'))
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
// ── Track detail (/track/<id>) ─────────────────────────────────────────────
// Not a tab: a full view that replaces the stats + tab set. Loads through the
// same serialized chain as the feeds (the Lambda is concurrency-1) and caches
// per track id until Refresh forces a re-fetch.
const trackRoute = () => {
  const match = /^\/track\/([0-9A-Za-z]{22})$/.exec(location.pathname)
  return match ? match[1] : null
}
let lastTab = 'current'
const trackCache = new Map()
const trackLoading = new Set()
const STAGES = [
  ['unheard', 'Unheard'],
  ['liked', 'Liked'],
  ['current', 'Current'],
  ['archived', 'Archived'],
  ['removed', 'Removed'],
]
const stageName = (stage) =>
  (STAGES.find(([key]) => key === stage) ?? [stage, 'Unknown'])[1]
const EVENT_LABELS = {
  inboxed: 'Added to Inbox',
  liked: 'Liked',
  promoted: 'Promoted to Current',
  archived: 'Archived',
  removed: 'Demoted',
  dropped: 'Dropped from triage',
}
// Sources written by our own actions (filled dots) vs. inferred from live
// Spotify state (hollow dots).
const RECORDED = new Set(['triage-log', 'action-history'])
const SOURCE_LABELS = {
  'action-history': 'archive run history',
  'triage-log': 'triage log',
  playlist: 'playlist added_at',
  status: 'status reconciliation',
}
const dateTime = (value) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
const DAY = 86_400_000
function span(ms) {
  const days = ms / DAY
  if (days < 1) return `${Math.max(1, Math.round(ms / 3_600_000))}h`
  return `${Math.round(days)}d`
}

function queueTrack(id, force) {
  const view = $('track-view')
  $('track-back').href = `/${lastTab}`
  $('track-back').textContent = `← Back to ${feeds[lastTab].label}`
  if (!force && trackCache.has(id)) {
    renderTrack(trackCache.get(id))
    return
  }
  if (trackLoading.has(id)) return
  trackLoading.add(id)
  loadingCount++
  view.replaceChildren(element('p', 'message', 'Tracing this track’s journey…'))
  $('updated').textContent = 'Refreshing…'
  $('refresh').disabled = true
  chain = chain
    .then(async () => {
      try {
        const detail = await load(`/api/track/${id}`)
        trackCache.set(id, detail)
        // Only paint if the user is still looking at this track.
        if (trackRoute() === id) renderTrack(detail)
        $('updated').textContent = `Track · ${clock(detail.generatedAt)}`
      } catch (error) {
        if (trackRoute() === id) showError('track-view', error)
        $('updated').textContent = 'Track unavailable'
      }
    })
    .finally(() => {
      trackLoading.delete(id)
      if (--loadingCount === 0) $('refresh').disabled = false
    })
}

function renderTrack(detail) {
  const { track } = detail
  const view = $('track-view')
  const fragment = document.createDocumentFragment()

  const head = element('header', 'track-head')
  if (track.cover) {
    const cover = element('img', 'cover')
    cover.src = track.cover
    cover.alt = `${track.album} cover`
    cover.width = 120
    cover.height = 120
    head.append(cover)
  }
  const meta = element('div', 'track-meta')
  const chip = element(
    'span',
    `chip stage-${detail.stage ?? 'unknown'}`,
    detail.stage ? `Now: ${stageName(detail.stage)}` : 'Now: unknown',
  )
  meta.append(chip, element('h2', '', track.name))
  meta.append(
    element(
      'p',
      'artist',
      [track.artist, track.album].filter(Boolean).join(' · '),
    ),
  )
  const out = spotifyLink(track.id, 'Open in Spotify ↗')
  out.className = 'spotify'
  meta.append(out)
  if (detail.tracked === 'untracked')
    meta.append(
      element(
        'p',
        'note',
        'No DynamoDB row for this track — it has never been triaged or played.',
      ),
    )
  head.append(meta)
  fragment.append(head)

  // Listen counts — totals only, never an individual-listen log.
  const stats = element('div', 'stats track-stats')
  const { plays, archiveRule } = detail
  const card = (label, value, small) => {
    const node = element('div', 'stat')
    node.append(
      element('span', 'label', label),
      element('strong', '', String(value)),
    )
    if (small) node.append(small)
    return node
  }
  const currentSmall = element(
    'small',
    '',
    `of ${archiveRule.playsToArchive} to archive`,
  )
  const bar = element('div', 'bar')
  const fill = element('span')
  fill.style.width = `${Math.min(100, (plays.fromCurrent / archiveRule.playsToArchive) * 100)}%`
  bar.append(fill)
  currentSmall.append(bar)
  stats.append(
    card('TOTAL PLAYS', plays.total, element('small', '', 'Every context')),
    card(
      'FROM INBOX',
      plays.fromInbox,
      element('small', '', 'Started from Inbox'),
    ),
    card('FROM CURRENT', plays.fromCurrent, currentSmall),
    card(
      'ELSEWHERE',
      plays.elsewhere,
      element('small', '', 'Liked Songs, search, albums…'),
    ),
  )
  fragment.append(stats)

  const seen = element('p', 'seen')
  const seenText = (label, value) =>
    value
      ? `${label} ${dateTime(value.at)}${value.exactness === 'playlist-addition' ? ' (playlist addition, not a play)' : ''}`
      : `${label} —`
  seen.textContent = [
    seenText('First seen', detail.firstSeen),
    seenText('Last seen', detail.lastSeen),
    detail.archiveRule.archiveBy
      ? `Archives by ${date(detail.archiveRule.archiveBy)} or at ${archiveRule.playsToArchive} Current plays`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
  fragment.append(seen)

  const chartHead = element('div', 'section-head')
  chartHead.append(element('span', 'tag', 'Journey'))
  fragment.append(chartHead)
  const chart = element('div', 'swimlane')
  chart.id = 'swimlane'
  fragment.append(chart)
  const legend = element('p', 'description legend')
  legend.textContent =
    'Filled dots come from our own records (triage log, archive run history); hollow dots are inferred from playlist added_at or status reconciliation. Faded dots are stored claims that live playlists contradict.'
  fragment.append(legend)

  const listHead = element('div', 'section-head')
  listHead.append(element('span', 'tag', `${detail.events.length} events`))
  fragment.append(listHead)
  const list = element('div', 'list')
  let previous = null
  for (const event of detail.events) {
    const contradicted = event.standing === 'contradicted'
    const row = element(
      'div',
      contradicted ? 'row event-row contradicted' : 'row event-row',
    )
    row.append(
      element(
        'span',
        `dot stage-${event.stage}${RECORDED.has(event.source) ? '' : ' hollow'}`,
      ),
    )
    const what = element('div', 'song-text')
    const label =
      event.kind === 'archived' && event.playlist
        ? `Archived to ${event.playlist}`
        : (EVENT_LABELS[event.kind] ?? event.kind)
    what.append(element('div', 'event-label', label))
    what.append(
      element(
        'div',
        'artist',
        contradicted
          ? `${SOURCE_LABELS[event.source] ?? event.source} · contradicted by live playlists — not charted`
          : (SOURCE_LABELS[event.source] ?? event.source),
      ),
    )
    const move = element('div', 'metric')
    move.append(
      element('span', 'stage', previous ? stageName(previous) : '—'),
      element('span', 'arrow', '→'),
      element('span', 'stage', stageName(event.stage)),
    )
    const when = element('div', 'metric secondary', date(event.at))
    when.append(
      element(
        'small',
        'timestamp',
        new Date(event.at).toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        }),
      ),
    )
    row.append(what, move, when)
    list.append(row)
    if (!contradicted) previous = event.stage
  }
  if (!detail.events.length)
    list.append(
      element('p', 'message', 'No lifecycle events recorded for this track.'),
    )
  fragment.append(list)

  view.replaceChildren(fragment)
  renderSwimlane(detail)
}

const SVG = 'http://www.w3.org/2000/svg'
function svgEl(tag, attrs, text) {
  const node = document.createElementNS(SVG, tag)
  for (const [key, value] of Object.entries(attrs ?? {}))
    node.setAttribute(key, String(value))
  if (text !== undefined) node.textContent = text
  return node
}

// Swimlane: time on x, one lane per stage on y. Bars are the time spent in each
// stage, elbows connect consecutive stages, dots mark the events themselves.
function renderSwimlane(detail) {
  const box = $('swimlane')
  if (!box) return
  if (!detail.events.length) {
    box.replaceChildren(element('p', 'message', 'Nothing to chart yet.'))
    return
  }
  const width = Math.max(320, box.clientWidth || 800)
  const narrow = width < 560
  const labelW = narrow ? 66 : 92
  const padR = 22
  const laneH = narrow ? 34 : 40
  const top = 26
  const height = top + laneH * STAGES.length + 30
  const now = Date.parse(detail.generatedAt)
  const times = detail.events.map((e) => Date.parse(e.at)).concat(now)
  if (detail.archiveRule.archiveBy && detail.stage === 'current')
    times.push(Date.parse(detail.archiveRule.archiveBy))
  let t0 = Math.min(...times)
  let t1 = Math.max(...times)
  if (t1 - t0 < DAY) t0 = t1 - DAY
  const pad = (t1 - t0) * 0.03
  t0 -= pad
  t1 += pad
  const x = (t) => labelW + ((t - t0) / (t1 - t0)) * (width - labelW - padR)
  const laneIndex = (stage) => STAGES.findIndex(([key]) => key === stage)
  const y = (stage) => top + laneIndex(stage) * laneH + laneH / 2

  const root = svgEl('svg', {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': `Journey: ${detail.segments.map((s) => stageName(s.stage)).join(' → ')}`,
  })
  const visited = new Set(detail.segments.map((s) => s.stage))
  STAGES.forEach(([key, label], index) => {
    const laneTop = top + index * laneH
    root.append(
      svgEl('rect', {
        x: 0,
        y: laneTop,
        width,
        height: laneH,
        class: index % 2 ? 'lane alt' : 'lane',
      }),
      svgEl(
        'text',
        {
          x: 4,
          y: laneTop + laneH / 2 + 4,
          class: visited.has(key) ? 'lane-label on' : 'lane-label',
        },
        label,
      ),
    )
  })

  // Date ticks.
  const ticks = Math.max(2, Math.floor((width - labelW) / 130))
  const withYear = t1 - t0 > 300 * DAY
  for (let i = 0; i <= ticks; i++) {
    const t = t0 + pad + ((t1 - t0 - 2 * pad) * i) / ticks
    const tx = x(t)
    root.append(
      svgEl('line', {
        x1: tx,
        x2: tx,
        y1: top,
        y2: top + laneH * STAGES.length,
        class: 'grid',
      }),
      svgEl(
        'text',
        {
          x: tx,
          y: height - 8,
          class: 'tick',
          'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle',
        },
        new Date(t).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          ...(withYear ? { year: '2-digit' } : {}),
        }),
      ),
    )
  }

  // Projected archive date while in Current.
  if (detail.archiveRule.archiveBy && detail.stage === 'current') {
    const ax = x(Date.parse(detail.archiveRule.archiveBy))
    const cy = y('current')
    root.append(
      svgEl('line', {
        x1: ax,
        x2: ax,
        y1: cy - 14,
        y2: cy + 14,
        class: 'archive-by',
      }),
      svgEl(
        'text',
        { x: ax, y: cy - 17, class: 'marker-label', 'text-anchor': 'end' },
        'archive by',
      ),
    )
  }

  // Elbows between consecutive stages, drawn first so bars sit on top.
  detail.segments.forEach((segment, index) => {
    const next = detail.segments[index + 1]
    if (!next) return
    const cx = x(Date.parse(next.start))
    root.append(
      svgEl('path', {
        d: `M ${cx} ${y(segment.stage)} L ${cx} ${y(next.stage)}`,
        class: 'elbow',
      }),
    )
  })

  for (const segment of detail.segments) {
    const start = Date.parse(segment.start)
    const end = segment.end ? Date.parse(segment.end) : now
    const sx = x(start)
    const w = Math.max(6, x(end) - sx)
    const bar = svgEl('rect', {
      x: sx,
      y: y(segment.stage) - 6,
      width: w,
      height: 12,
      rx: 6,
      class: `seg stage-${segment.stage}${segment.end ? '' : ' open'}`,
    })
    bar.append(
      svgEl(
        'title',
        {},
        `${stageName(segment.stage)}: ${span(end - start)}${segment.end ? '' : ' so far'}`,
      ),
    )
    root.append(bar)
    if (!narrow && w > 46)
      root.append(
        svgEl(
          'text',
          {
            x: sx + w / 2,
            y: y(segment.stage) + 20,
            class: 'dwell',
            'text-anchor': 'middle',
          },
          span(end - start),
        ),
      )
  }

  for (const event of detail.events) {
    const dot = svgEl('circle', {
      cx: x(Date.parse(event.at)),
      cy: y(event.stage),
      r: 6,
      class: `event stage-${event.stage}${RECORDED.has(event.source) ? '' : ' hollow'}${event.standing === 'contradicted' ? ' contradicted' : ''}`,
    })
    dot.append(
      svgEl(
        'title',
        {},
        `${EVENT_LABELS[event.kind] ?? event.kind} · ${dateTime(event.at)} · ${SOURCE_LABELS[event.source]}${event.standing === 'contradicted' ? ' · contradicted by live playlists' : ''}`,
      ),
    )
    root.append(dot)
  }

  // "Now" line.
  const nx = x(now)
  root.append(
    svgEl('line', {
      x1: nx,
      x2: nx,
      y1: top - 6,
      y2: top + laneH * STAGES.length,
      class: 'now',
    }),
    svgEl(
      'text',
      { x: nx, y: top - 10, class: 'marker-label', 'text-anchor': 'end' },
      'now',
    ),
  )
  box.replaceChildren(root)
}

// The pathname selects the view. pushState handles navigation; popstate restores
// the view on Back/Forward without reloading the page.
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
const routeKey = () =>
  Object.hasOwn(feeds, location.pathname.slice(1))
    ? location.pathname.slice(1)
    : 'current'
function navigate(path) {
  if (location.pathname !== path) history.pushState(null, '', path)
  syncFromPath()
}
function syncFromPath() {
  const id = trackRoute()
  document.body.dataset.view = id ? 'track' : 'tabs'
  if (id) {
    window.scrollTo(0, 0)
    queueTrack(id, false)
    return
  }
  const key = routeKey()
  lastTab = key
  showTab(tabByKey(key))
  queueFeed(key, false)
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    const key = keyOf(tab)
    // Re-clicks still refresh reload-always feeds without adding history entries.
    navigate(`/${key}`)
  })
  // Roving tabindex + automatic activation: arrows/Home/End move focus and the
  // active tab together, via browser history.
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
    navigate(`/${keyOf(next)}`)
  })
})
window.addEventListener('popstate', syncFromPath)
// Keep native link behavior for new tabs, downloads, and external destinations.
document.addEventListener('click', (event) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return
  const link = event.target.closest?.('a[href]')
  if (
    !link ||
    link.hasAttribute('download') ||
    (link.target && link.target !== '_self')
  )
    return
  const url = new URL(link.href, location.href)
  if (url.origin !== location.origin || url.search || url.hash) return
  if (
    !/^\/(current|inbox|promotes|archived)$/.test(url.pathname) &&
    !/^\/track\/[0-9A-Za-z]{22}$/.test(url.pathname)
  )
    return
  event.preventDefault()
  navigate(url.pathname)
})
// Refresh re-fetches whatever tab is visible — that doubles as the Recently
// promoted refresh button, since it always acts on the active tab.
$('refresh').addEventListener('click', () => {
  const id = trackRoute()
  if (id) queueTrack(id, true)
  else queueFeed(routeKey(), true)
})
let resizeTimer
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    const id = trackRoute()
    const detail = id && trackCache.get(id)
    if (detail) renderSwimlane(detail)
  }, 150)
})
// Upgrade old bookmarks without leaving a hash URL in browser history.
const legacyPath = `/${location.hash.slice(1)}`
if (
  location.pathname === '/' &&
  (/^\/(current|inbox|promotes|archived)$/.test(legacyPath) ||
    /^\/track\/[0-9A-Za-z]{22}$/.test(legacyPath))
) {
  history.replaceState(null, '', legacyPath + location.search)
}
syncFromPath()
