# 2026-09-17 — Dashboard sections become JS tabs

## What changed

The read-only dashboard's four sections (Current, Inbox, Recently promoted,
Recently archived) are no longer stacked `<details class="panel" open>`
collapsibles. They are now a **JS-driven ARIA tab set**: one tab bar, one panel
visible at a time.

## Why

Requested: turn the sections into tabs, implemented in JavaScript (not a
CSS/native `<details>` approach).

## How it works

- **Markup** (`src/web/index.html`): a `role="tablist"` of four
  `<button role="tab">`s (`tab-current` / `tab-inbox` / `tab-promotes` /
  `tab-archived`) over four `<section role="tabpanel" class="panel">`s
  (`panel-*`). Each tab's `aria-controls` points at its panel; each panel keeps
  the original render-target list div (`current` / `inbox` / `promotes` /
  `archived`) so no rendering code changed. The old `<summary>`/`<h2>`/chevron
  markup and their CSS are gone.
- **Behavior** (`src/web/app.js`): a small `selectTab()` toggles the `hidden`
  attribute on the selected tab's `aria-controls` target and maintains a roving
  `tabindex` (active tab `0`, others `-1`). Click selects; ArrowLeft/Right (and
  Up/Down), Home, End move focus **and** selection together (automatic
  activation — safe because the content is already loaded). On load it
  normalizes to whichever tab the markup marks selected, so exactly one panel is
  ever visible.
- **Always starts on Current**; the active tab is **not** persisted (no URL hash
  / storage).

## Loading is unchanged

All four feeds still load **up-front and sequentially** in `refresh()` — the
Lambda has reserved concurrency 1, so requests must never overlap. Tabs are a
pure visibility layer; switching a tab never triggers a fetch. Open a tab whose
feed is still loading and you see its existing "Loading…" / "Waiting…" message,
exactly as before.

## Styling

New underline-style tab bar (`.tabs` / `.tab`, active tab gets a green
`border-bottom`). The tab bar scrolls horizontally on narrow screens rather than
wrapping. The per-section tag (e.g. "Top 20 · in playlist order") moved into the
top of each panel; the section name now lives on the tab button.

## Tests

`web-routing.test.ts` gained a test asserting the served page is a proper tab
set: a `tablist`, exactly one `aria-selected="true"` (Current), each
`tab-<key>` / `aria-controls="panel-<key>"` / `panel-<key>` / list-`<key>` id
present, and the three inactive panels `hidden` while Current is not. This pins
the tab↔panel↔render-target wiring that `selectTab()` depends on. The existing
"contains Recently promoted / Recently archived" assertions still hold (now tab
labels).

Full suite: **574 pass / 0 fail**, `tsc` clean, `node --check src/web/app.js`
clean.

## Not deployed

Ships on the next `ruby scripts/publish.rb`.
