# Changelog

All notable changes to `@kashdao/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the package is `0.x`, minor versions may include breaking changes —
breaking changes are explicitly called out in the entry.

## [Unreleased]

## [0.1.0] — 2026-05-20

Initial public release.

### Added

- **Resources** — fluent client for every public API surface:
  - `kash.markets` — `list()`, `get(id)`
  - `kash.quotes` — `buy(...)`, `sell(...)` (price simulation, no funds moved)
  - `kash.trades` — `create(...)`, `confirm(id, { token })`, `get(id)`,
    `waitForCompletion(id)`, `list(...)`
  - `kash.portfolio` — `get()`, `positions()`
  - `kash.account` — `usage()`
  - `kash.webhooks` — `list(...)`, `redeliver(eventId)`, `rotateSecret()`,
    `verifySignature(...)`
  - `kash.traces` — `get(correlationId)` for end-to-end request tracing
  - `kash.healthCheck()` — non-throwing API liveness probe
- **Auto-routing** — a `kash_test_*` API key targets staging
  (`api-staging.kash.bot`); a `kash_live_*` key targets production
  (`api.kash.bot`). Explicit `baseUrl` or `KASH_BASE_URL` always wins.
- **Typed errors** — `KashAuthenticationError`, `KashValidationError`,
  `KashRateLimitError`, `KashServerError`, `KashNetworkError`,
  `KashTimeoutError`, `KashAbortedError`, `KashConflictError`,
  `KashNotFoundError`, `KashConfigurationError`. Each carries `code`,
  `statusCode`, `requestId` where available; `KashError` is the common
  base for `instanceof` checks.
- **Production-grade retries** — exponential backoff with jitter on
  429 / 5xx / network / timeout. Honors server-supplied `Retry-After`
  with a configurable cap. Tunable via `maxRetries`,
  `retryBaseDelayMs`, `retryMaxDelayMs`, `maxRetryAfterMs`.
- **Idempotency** — pass `idempotencyKey` to `trades.create()` to make
  it safe to retry. Replays return the cached response.
- **Observability hooks** — `onRequest`, `onResponse`, `onRetry`,
  `onError` for tracing / metrics. No mutation; logging only.
- **Webhook signature verification** — `kash.webhooks.verifySignature(...)`
  reconstructs the Stripe-style `t=<ms>,v1=<hex-hmac>` header against
  the raw body using the customer's webhook secret. Tolerates multiple
  `v1=` entries (7-day rotation overlap window).
- **`@kashdao/sdk/testing`** — mock client + builders for integration
  tests; no real HTTP calls.
- **`Page<T>`** iterator — webhooks and trades listing returns a
  page-aware iterator with `.cursor`, `.hasMore`, and `for await`
  support.
- **Native fetch** — zero deps beyond Zod. Works in Node 22+, Bun,
  Deno, Cloudflare Workers, Vercel Edge.
- **Full TypeScript types + JSDoc** on every public symbol; `tsdoc`
  comments render in IDEs.

### Server-side behavior (no SDK code changes; documented for awareness)

- The public API now returns `503 RATE_LIMIT_UNAVAILABLE` when the
  rate-limit subsystem (Redis-backed) is momentarily unreachable
  AND the per-task circuit breaker is still closed. SDK consumers
  see this as a regular `KashServerError` with `err.code ===
'RATE_LIMIT_UNAVAILABLE'`, `err.statusCode === 503`, and
  `err.retryAfterSeconds === 1`. The default retry policy
  (`maxRetries: 3`, honours `Retry-After`) auto-retries these so
  most transient blips are invisible to application code.
  Distinct from `RATE_LIMIT_EXCEEDED` (429, you went over your
  quota) and `DEPENDENCY_UNAVAILABLE` (503, sustained infra
  outage). Consumers building dashboards / metrics that want to
  count rate-limit-subsystem failures separately can branch on
  `err.code === 'RATE_LIMIT_UNAVAILABLE'`. See
  https://docs.kash.bot/developer-docs/api-errors/RATE_LIMIT_UNAVAILABLE
  for the full contract.
