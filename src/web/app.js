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
  $('archived').replaceChildren(
    element(
      'p',
      'message',
      'Checking monthly archives… This can take about a minute.',
    ),
  )
  // The Lambda has reserved concurrency 1. Never overlap the two requests.
  try {
    const archived = await load('/api/archived?limit=20')
    renderTracks('archived', archived.tracks, 1, true)
    $('archive-updated').textContent =
      `Archives updated ${new Date(archived.generatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · cached for 12 hours`
  } catch (error) {
    showError('archived', error)
    $('archive-updated').textContent = 'Archives unavailable'
  } finally {
    $('refresh').disabled = false
  }
}
$('refresh').addEventListener('click', refresh)
refresh()
