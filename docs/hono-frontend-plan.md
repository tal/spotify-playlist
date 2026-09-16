# Plan — read-only Hono dashboard inside the Bun Lambda

Status: **implemented, deployed, and verified on 2026-09-16.** Written 2026-09-15.

## User corrections during implementation

The user clarified that “promoted” meant **archived** and selected a dark,
Spotify-inspired UI. The archive feed includes **manual additions** and shows
**one row per archive event**, including repeated tracks. These corrections
supersede the promoted-feed design below:

- `/api/archived?limit=20` replaces `/api/promoted`.
- Read all monthly archive playlists matching `buildArchiveMatcher`, sort their
  items by Spotify `added_at`, and take the newest 20 entries. The archive name
  is not the addition time: manual additions may land in an older month.
- Entries subsequently deleted from Spotify cannot be reconstructed by this view.
- Join the selected track ids against DynamoDB for status and Current plays.
- **No action_history GSI is needed or created.** The original GSI phase and
  promoted-only assumptions below are retained as the superseded proposal.
- Cache the completed archive feed in DynamoDB for **12 hours**, as selected by
  the user. Cache hits use one projected GetItem on the existing user row;
  expired/missing entries rebuild from Spotify on the next request. The page
  reports the snapshot's original generation time. Current remains uncached.
- The user approved the simpler full-bundle deployment on 2026-09-16.
- The page remains read-only; existing action URLs keep their original behavior.

## Original proposal (archive corrections above take precedence)

## Goal

A read-only page served by the existing `spotify-playlist-dev` Lambda,
hardcoded to user `koalemos`, showing:

1. every track in **Current** with its `play_count_current`;
2. the **20 most recently promoted** tracks.

## Decisions

| Question | Decision |
|---|---|
| Rendering | JSON API under `/api/*`, one static HTML page, one small vanilla JS file. No build step |
| Placement | Same Lambda. `src/lambda-bun.ts` hands a narrow set of GET requests to Hono; everything else goes to today's handler unchanged |
| Auth | None. The Function URL is already public |
| Entry point | The Function URL only (`https://d5vtfkftttoinc6cy7apdt2tom0hujfb.lambda-url.us-east-1.on.aws/`) |
| Promoted-list source | A new GSI on `action_history` (see below). The `track` status index is **not** enough on its own |
| Page paths | `/` (page), `/app.js`, `/api/current`, `/api/promoted` |

## Routing rule

Hono receives a request only when **all** of these hold:

- the invocation is HTTP (the attached `.aws` event has `requestContext.http`
  or `httpMethod`, or there is no `.aws` because this is the local server);
- the method is `GET`;
- the path is `/app.js`, starts with `/api/`, or is `/` **with no `action`
  query parameter**.

Everything else, including every existing action path, `/?action=<name>`,
and the EventBridge `frequent-crawling` wrapper, goes to the legacy handler
exactly as today. There is no "Hono falls through on 404" layer; the gate is
one function in `src/lambda-bun.ts`, exported and unit-tested.

Why the `action` clause: `/?action=promote` is the documented canonical
Function URL form (`HTTP_API_GUIDE.md`, `API_GATEWAY_URL.md`). A plain
`GET /` route would have swallowed every promote/demote/undo call.

Read `action` from the attached event's `queryStringParameters`, not from
`request.url`, so the gate does not depend on how the Bun layer builds the
URL.

## Data

### `/api/current`

The existing `listen-stats` block (`src/index.ts`, `case 'listen-stats'`)
extracted into a pure plan function plus a gather shell, following the
`perform() = plan(await gather(ctx))` convention. The action keeps returning
the same JSON; the API adds `id`, `uri`, `addedAt`, `playsToArchive`, and
`generatedAt`.

Two fixes ride along with the extraction:

- guard `track === null` (local files, region-blocked tracks). Today one such
  item in Current throws and 500s `listen-stats`;
- take `DAY_MS` from `settings.ts` instead of the ambient `days` global, so
  the plan function is importable from a test.

### `/api/promoted?limit=20`

**Recommended source: a new `action_history` GSI**
`userId-created_at-index` (HASH `userId`, RANGE `created_at`, projection
INCLUDE `action`, `item`, `undone`). Query newest-first for
`userId = koalemos`, filter `action = 'promote-track' AND
attribute_not_exists(undone)`, page until 20 rows. Each row's `item` already
carries `id`, `uri`, `name`, `artist`, `album`, so no Spotify call is needed
for names. Join the 20 ids against `track` with one BatchGet for current
`status` and `play_count_current`.

Why not the alternatives:

- `Dynamo.getRecentActionsOfType()` is a filtered **Scan**. `action_history`
  is 96 MB / 38,464 rows at 1 RCU with no index. That is the same failure
  class as the `track` scan fixed on 2026-09-04. Never use it for this.
- The `track` status GSI is cheap and index-backed, but `status` only exists
  on rows written since 2026-08-02 and the live index holds **2** promoted
  rows today. A "recent 20" built on it would be a "recent 2" for months.

Cost of the GSI: `putActionHistory` already writes `userId` on every row for
this purpose; the index was never created. Backfilling 38k rows consumes
the index's write capacity, so create it with raised throughput, wait for
`ACTIVE`, then drop it back to 1/1, the way the 2026-09-04 `track` change
did. Config goes in `config/dynamo-tables/action-history.json`.

Bonus, not in scope: once the index exists, `undo-last` can stop using the
Scan too.

## Shape of the code

- `src/web/` — Hono app builder that takes its two loaders as parameters
  (so tests inject fakes), the HTML and JS files, the two plan/gather
  modules, and a `koalemosContext()` that is the three bootstrap lines from
  `src/index.ts` (`getDynamo('koalemos')` → `Spotify.get(dynamo)`).
- `src/lambda-bun.ts` — the routing gate above; today's `fetch` body becomes
  the legacy branch.
- `src/db/dynamo.ts` — one new Query for the promoted feed.
- `src/index.ts` — `listen-stats` calls the extracted module.
- `package.json` — `hono` in `dependencies`. That is the whole deploy change:
  `publish.rb` already ships everything under `src/` except `__tests__`,
  `scripts`, and `migrations`, and installs production dependencies.
- Move `normalizeActionError` out of `src/index.ts` so the web module can
  reuse it without importing every action.

Tests follow the existing mock-free style: pure plan tests for both feeds,
a gate test for the four invocation shapes (v2 HTTP, v1 HTTP, local server,
EventBridge wrapper), and a Hono test via `app.request()` with fake loaders.

## Phases

1. **GSI.** Add the index to config, create it live with raised throughput,
   backfill, drop throughput. Verify with one Query. Independent of all code.
2. **Extract `listen-stats`** with the null-track guard and `DAY_MS` fix.
   No behaviour change for the action. Tests.
3. **Promoted feed** query + plan + tests.
4. **Hono app, gate, page.** `bun add hono`, tests for the gate and routes.
5. **Verify and deploy.** Local `bun run src/lambda-bun.ts`; then
   `ruby scripts/publish.rb`; then open `/`, curl `/api/promoted`, curl
   `/?action=user` (must still be the action, not the page), and invoke
   with the exact `Archive-Trigger` payload (5/5 `success`, recipe in
   `changelog/2026-08-04_bun-on-lambda.md`). Read peak memory once.
6. Docs: AGENTS.md subsection + changelog.

Run `bun install` first; `node_modules` is behind the lockfile (TS 5.8.3
installed vs 5.9.3 pinned).

## Things that will bite if forgotten

- `tsconfig.json` is `module: commonjs`. Import attributes, `import.meta`,
  and top-level `await` all fail to typecheck. Read the HTML/JS with
  `Bun.file(join(__dirname, …))` behind a lazily memoized promise. Do not
  `import` an `.html` file: bun-types types it as an `HTMLBundle`, which is
  not the file's text.
- The local `spotify-web-api-node.d.ts` has no `getTracks` declaration. Not
  needed with the GSI source, but add it if names ever have to come from
  Spotify.
- When a promote lands in `triage_actions`, the newest array element is not
  necessarily the newest timestamp (manual-triage backfill appends the
  playlist `added_at`). Any use of that array must take the max.

## Assumptions to sign off on

- **Deploying this deploys four unrelated commits.** The Lambda's code dates
  from 2026-08-26; `master` since then adds the 45-day archive window, the
  play-count archive trigger, the status-GSI query, and parallel playlist
  paging. The first `publish.rb` run changes archive behaviour.
- **Reserved concurrency is 1.** A page load that overlaps the six-hourly
  job is throttled, not queued, so expect an occasional failed refresh. The
  JS should fetch the two endpoints one after the other and retry once.
- **No auth means the URL is easy to share.** The Function URL already
  exposes `?action=promote`/`demote`/`undo-last`; the page adds no
  capability but makes the URL a bookmark and a link preview.
- **Manual promotes are not in the feed.** Dragging a track into Current by
  hand writes a `'promote'` triage entry but no `action_history` row, so the
  GSI source shows only promotes made through the action. Undone promotes
  are excluded. Demoted-after-promote tracks still appear (they were
  promoted); the joined `status` says what happened since.
- **Old `action_history` rows without `userId` are invisible to the index.**
  The attribute was added at some point for this purpose; rows older than
  that are simply not in the feed.
- **Token refresh has no lock.** Overlapping invocations can both refresh;
  concurrency 1 mostly serializes this. Pre-existing.
- **The Bun layer was read on today's `main`**, not at the commit layer `:2`
  was built from on 2026-08-04. `.aws` attachment is proven by the existing
  adapter; the gate reads the event rather than the URL for that reason.
- **Memory is inferred**, roughly the `listen-stats` figure, well under
  512 MB. Verify once after deploy.

## Out of scope

- Any write from the page.
- Inbox, Starred, archive playlists.
- Replacing `undo-last`'s Scan (easy follow-up once the GSI exists).
