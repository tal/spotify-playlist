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
    const song = element('div', 'song')
    const link = element('a', '', track.name)
    link.href = `https://open.spotify.com/track/${encodeURIComponent(track.id)}`
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    song.append(link, element('div', 'artist', track.artist))
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
    const song = element('div', 'song')
    const link = element('a', '', track.name)
    link.href = `https://open.spotify.com/track/${encodeURIComponent(track.id)}`
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    song.append(link, element('div', 'artist', track.artist))
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
    const song = element('div', 'song')
    const link = element('a', '', track.name)
    link.href = `https://open.spotify.com/track/${encodeURIComponent(track.id)}`
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    song.append(link, element('div', 'artist', track.artist))
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
async function refresh() {
  $('refresh').disabled = true
  $('updated').textContent = 'Refreshing…'
  try {
    const current = await load('/api/current')
    renderTracks('current', current.tracks, current.playsToArchive, false)
    $('total').textContent = current.trackCount
    $('unplayed').textContent = current.neverPlayedFromCurrent
    $('threshold').textContent = `${current.playsToArchive} plays`
    $('age').textContent = `or ${current.archivesAfterDays} days in Current`
    $('updated').textContent =
      `Current · ${new Date(current.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  } catch (error) {
    showError('current', error)
    for (const id of ['total', 'unplayed', 'threshold']) $(id).textContent = '—'
    $('updated').textContent = 'Current unavailable'
  }
  // The Lambda has reserved concurrency 1. Never overlap requests — inbox,
  // then archives, each after the previous resolves.
  $('inbox').replaceChildren(element('p', 'message', 'Loading your Inbox…'))
  try {
    const inbox = await load('/api/inbox')
    renderInbox('inbox', inbox.tracks)
  } catch (error) {
    showError('inbox', error)
  }
  $('promotes').replaceChildren(
    element('p', 'message', 'Loading recent promotes…'),
  )
  try {
    const promotes = await load('/api/promotes')
    renderPromotes('promotes', promotes.tracks)
  } catch (error) {
    showError('promotes', error)
  }
  $('archived').replaceChildren(
    element(
      'p',
      'message',
      'Reading the latest monthly archives…',
    ),
  )
  try {
    const archived = await load('/api/archived?limit=20')
    renderTracks('archived', archived.tracks, 1, true)
    $('archive-updated').textContent =
      `Archives updated ${new Date(archived.generatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · live`
  } catch (error) {
    showError('archived', error)
    $('archive-updated').textContent = 'Archives unavailable'
  } finally {
    $('refresh').disabled = false
  }
}
// Tabs: pure show/hide over the four sections. They all still load up-front in
// refresh() (the Lambda is concurrency-1), so switching a tab only changes which
// panel is visible — it never fetches. Always starts on Current.
const tabs = [...document.querySelectorAll('[role="tab"]')]
function selectTab(tab) {
  for (const other of tabs) {
    const selected = other === tab
    other.setAttribute('aria-selected', String(selected))
    other.tabIndex = selected ? 0 : -1
    $(other.getAttribute('aria-controls')).hidden = !selected
  }
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab))
  // Roving tabindex + automatic activation: arrows/Home/End move focus and the
  // panel together, since the target content is already loaded.
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
    selectTab(next)
    next.focus()
  })
})
// Normalize to whatever the markup marks selected (Current), so exactly one
// panel is ever visible even if the HTML drifts.
selectTab(tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs[0])

$('refresh').addEventListener('click', refresh)
refresh()
