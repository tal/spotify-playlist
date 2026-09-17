# 2026-09-17 — Dashboard: lazy per-tab loading, hash-persisted tab, promotes always reloads

The dashboard tab set was cosmetic: all four feeds loaded up-front, sequentially,
in one `refresh()` at page load, and tabs only showed/hid already-fetched panels.
The active tab wasn't persisted. This reworks `src/web/app.js` so each tab owns
its own fetch.

## What changed (client-only — `src/web/app.js`, plus placeholder copy in `index.html`)

- **Lazy per-tab loading.** Each tab has a `feeds[key]` entry with a `load()` that
  fetches + renders into its own panel. A tab fetches only when first shown, not
  up-front. On initial load only the active tab (default Current) is fetched.
- **Active tab persisted in the URL hash.** `#current`/`#inbox`/`#promotes`/
  `#archived` is now the single source of truth — it survives reload and is
  deep-linkable. Clicks and arrow keys set `location.hash`; one `hashchange`
  handler (`syncFromHash`) does the show + lazy-load. An unknown/absent hash
  falls back to Current.
- **Recently promoted always reloads.** It's a debug view, so its feed is
  `reload: true` — never cached; it re-fetches every time it is shown (and on a
  re-click while already active). The other three cache after a successful load.
- **Refresh button acts on the active tab.** The existing hero **Refresh** button
  now force-re-fetches whichever tab is visible (bypassing the cache), so it
  doubles as the promotes refresh button the request asked for.
- **Concurrency-1 preserved.** All feed loads are serialized through a single
  promise chain, and a feed already in flight is not enqueued twice, so nothing
  overlaps against the concurrency-1 Lambda — same guarantee the old sequential
  `refresh()` gave.
- **Error handling per feed.** A failed load leaves the feed uncached (next visit
  retries), runs the feed's `onError` (Current blanks the stat cards to `—`,
  archived sets the footer to "Archives unavailable"), and shows the panel error.
- Renamed `selectTab` → `showTab` (pure show/hide); added `feeds`, `queueFeed`,
  `runFeed`, `syncFromHash`, `keyOf`/`tabByKey`/`hashKey`, and a `clock()` helper
  for the "updated" line.
- `index.html`: the three stale placeholders ("Waiting for Current/Inbox to
  load…") are now standalone ("Loading your Inbox…" etc.), since no panel waits
  on another anymore.

## Behavioral consequence, by design

The top stats block (`#total`/`#unplayed`/`#threshold`) is fed only by the
Current feed, so deep-linking straight to another tab shows `—` there until
Current is visited. Acceptable trade for strict lazy loading.

## Verified

- `node --check src/web/app.js` clean.
- Exercised the orchestration in a DOM/fetch shim (scratchpad harness): initial
  load fetches only `/api/current`; clicking Inbox fetches only `/api/inbox` and
  sets `#inbox`; returning to Current does **not** refetch; visiting promotes
  twice fetches it twice; Refresh on promotes triggers a third fetch; Refresh on
  a cached Inbox forces a refetch. All green.
