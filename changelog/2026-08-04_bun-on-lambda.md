# 2026-08-04 - Bun on Lambda

The Lambda now runs on Bun via a custom-runtime layer instead of the managed
Node runtime. Bun executes the TypeScript in `src/` directly, so there is no
`tsc` step and no `dist/` in the deployment path.

## Configuration change

| | Before | After |
| --- | --- | --- |
| Runtime | `nodejs20.x` | `provided.al2023` |
| Handler | `dist/index.handler` | `src/lambda-bun.fetch` |
| Architecture | `x86_64` | `arm64` |
| Memory | 128 MB | 512 MB |
| Layers | none | `arn:aws:lambda:us-east-1:495671805917:layer:bun:2` |
| Timeout | 80s | 80s (unchanged) |

The layer holds Bun **v1.3.14** for aarch64, built from
`oven-sh/bun` `packages/bun-lambda` (the standalone `oven-sh/bun-lambda` repo no
longer exists — the package lives in the monorepo). The layer's own
`publish-layer` script declares `provided.al2` only; this one was published for
`provided.al2023` as well, and the function runs on al2023. The binary needs
nothing beyond glibc (max referenced symbol version 2.17, no `libstdc++`), so
either base image would work.

An unused `bun` layer **version 1** has existed in the account since
2024-10-16. Nothing references it.

## `src/lambda-bun.ts`

The layer does not hand the handler a Lambda event. It converts every
invocation into a `Request` and expects `fetch(request)` to return a `Response`.
The new adapter translates in both directions so `src/index.ts` keeps its
`APIGatewayProxyHandler` signature and no action code changed.

Two layer behaviors drive the implementation, neither of them obvious:

- **The request body is not the event.** For non-HTTP events — our EventBridge
  `frequent-crawling` trigger — the layer's `formatUnknownEvent` serializes the
  whole `{requestId, traceId, functionArn, deadlineMs, event}` wrapper as the
  body. The untouched event is attached to the request object as `.aws`, which
  is what the adapter reads. If `.aws` is ever missing, it unwraps the body
  rather than falling back to URL synthesis, which would drop the action name
  and 404 every scheduled run.
- **Content-Type decides base64.** The layer base64-encodes any response whose
  MIME type is not `text/*` or `application/json`. Every body this handler
  returns is a JSON string, so the adapter's default response Content-Type is
  `application/json`. Getting this wrong yields a base64 blob through API
  Gateway with a 200 status.

The adapter also rebuilds a `Context` from the `x-amzn-*` request headers the
layer sets, and synthesizes an API-Gateway-shaped event from the URL when there
is no Lambda event at all — so `bun run src/lambda-bun.ts` serves the whole
handler locally over HTTP as a plain Bun server.

## X-Ray is off inside the function

`_X_AMZN_TRACE_ID` is set by the layer's runtime loop **per invocation**, which
happens after module init. Both X-Ray call sites are at module scope, so on Bun
they were skipped by timing accident. The deployment no longer carries the
unreachable `aws-xray-sdk`, `aws-xray-sdk-core`, or `@aws-sdk/client-xray`
packages, and the dead module-scope instrumentation branches are gone.

Consequence: **no HTTP or DynamoDB subsegments**. The function's
`TracingConfig` is still `Active` and the Lambda service still records the
invocation-level segment, so traces exist but are far less detailed. Setting
tracing to `PassThrough` would stop paying for what is no longer collected.

## Dependencies were cut to the runtime boundary

Direct dependencies dropped from 22 to 8. The production runtime now installs
only the DynamoDB client/document client and `spotify-web-api-node`; the five
development packages are the three type packages, TypeScript, and Prettier.

- The duplicate compiled Node CLI and `lambda-local` path were removed. `cli`
  now points directly at the Bun CLI, and its action mapping has regression
  coverage — including the three cache-maintenance commands that only the old
  CLI exposed.
- Bun's built-in `.env` loading replaces `dotenv`; commented-out notifications
  and `node-notifier` are gone.
- A tested local batching helper replaces Lodash across Dynamo, archive,
  triage, and Spotify playlist calls. Archive-prefix tests pin the native regex
  escaping replacement.
- The disconnected pre-Lambda Spotify/config/AppleScript implementation was
  removed with `detect-port`, `jsonfile`, their type packages, and the unused
  Bluebird type package.
- `bun.lock` is the sole lockfile, and the AWS SDK pair was updated together.

## Memory was forced up, not tuned up

128 MB was not survivable on Bun. Measured `Max Memory Used`:

| Invocation | Peak |
| --- | --- |
| `user` (read-only, lightest action) | 115 MB / 128 MB |
| `frequent-crawling` (full run) | 289 MB |

The read-only action alone came within 13 MB of the old ceiling. 512 MB is set
explicitly in `scripts/publish.rb` with a comment, so the requirement stays
visible. Note this changes the cost profile per GB-second — partly offset by
arm64 pricing and by shorter durations.

## `scripts/publish.rb`

Rewritten. It now stages the package in `build/lambda` and runs a
**production-only** `bun install --frozen-lockfile` there, instead of zipping
the working tree. That keeps devDependencies (typescript alone is ~20 MB) out of
the upload and makes it impossible for a stray local file — `.env` included — to
ride along. `src/__tests__`, `src/scripts`, and `src/migrations` are pruned;
nothing in the runtime path imports them.

Each deploy now asserts runtime, handler, architecture, layer, and memory rather
than assuming they were set by hand. Code and configuration cannot be changed in
one API call, so the function is briefly mismatched between the two steps.

## Verified

All three invoke paths, against the live function:

| Path | Result |
| --- | --- |
| EventBridge `frequent-crawling` (exact `Archive-Trigger` payload) | 200, all 5 actions `success`, 0 failures, 11.9s |
| Function URL over HTTPS | 200, `application/json`, 2.6s cold |
| API Gateway proxy v1 event | `statusCode: 200`, `isBase64Encoded: false` |

Plus `bun run typecheck` clean and `bun test` at 58 pass / 0 fail after the
dependency cleanup.

## Rollback

The pre-change code package and full configuration were captured before the
flip. To revert, upload the old zip and restore the managed runtime:

```sh
aws lambda update-function-code --function-name spotify-playlist-dev \
  --zip-file fileb://<snapshot>/current-code.zip --architectures x86_64
aws lambda wait function-updated-v2 --function-name spotify-playlist-dev
aws lambda update-function-configuration --function-name spotify-playlist-dev \
  --runtime nodejs20.x --handler dist/index.handler --memory-size 128 --layers
```

Note the old package expects a compiled `dist/`, so a rollback that rebuilds
from source needs `bunx tsc` first.

## Unrelated things found along the way

- **The repo had no `node_modules`.** Bun had been auto-installing from its
  global cache, which resolved a broken `@smithy/core` and made the handler
  unimportable locally until a real `bun install` ran.
- **The Function URL is `AuthType: NONE`** and the `user` action returns the
  stored Spotify OAuth access token in its response body. Anyone who knows the
  URL can read it. Pre-existing, untouched here.
