# Changelog

All notable changes to `@kashdao/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the package is `0.x`, minor versions may include breaking changes —
breaking changes are explicitly called out in the entry.

## [Unreleased]

## [0.2.1] - 2026-10-02

**0.2.0 was tagged but never published to npm.** 0.2.1 is its first published
form: its source is the `sdk-v0.2.0` tag's apart from the version constant
(`SDK_VERSION`, and so `USER_AGENT`), so everything listed under
0.2.0 below — including its breaking changes and
[`MIGRATION-0.2.md`](./MIGRATION-0.2.md) — ships here. Upgrading from 0.1.x
means reading the 0.2.0 entry.

### Changed

- **Release gate: `size-limit` is the only bundle-size check.** The publish
  script also measured the unminified ESM entry with `gzip -9` against a
  24,576-byte cap, a legacy duplicate of the `size-limit` gate that refused
  0.2.0 although every entry was well inside its real cap. It is removed.
  `size-limit` measures each entry as a consumer's bundler ships it
  (minified, then brotli-compressed) against per-entry caps in
  `package.json#size-limit`: 24 KB for `@kashdao/sdk`, 8 KB for
  `@kashdao/sdk/testing`. No library code changed.

### Documentation

- README and CONTRIBUTING describe the `size-limit` caps and `pnpm size`
  instead of the retired raw-gzip figure.

## [0.2.0] - 2026-10-01

Solana is Kash's canonical chain from 2026-10-01. This release makes the SDK
see it by default. **Breaking** (a `0.x` minor) — read
[`MIGRATION-0.2.md`](./MIGRATION-0.2.md) before upgrading.

### Changed

- **BREAKING: `MarketResource.chainId` and `QuoteMarketSummary.chainId` are
  `number | undefined`** (required `number` through 0.1.5). Under
  `2026-08-19` a Solana market or quote omits the key and names its chain with
  `chainRef`. Under strict TypeScript, reads that assumed a number stop
  compiling; that is the point — guard them or switch to `chainRef`.
- **BREAKING: `SDK_API_VERSION` is now `2026-08-19`** (was `2026-04-29`).
  Every request pins the newer version unless you pass `apiVersion`. Under it,
  `markets.list()` includes Solana markets, `markets.get()` and the quotes
  endpoints serve them instead of answering `400 CHAIN_NOT_SUPPORTED`, every
  market, quote and trade carries `chainRef`, and **`chainId` is absent on a
  Solana market or quote**. Code that reads `market.chainId` unconditionally
  must switch to `chainRef`.
- `@kashdao/sdk/testing` defaults now describe a Solana mainnet market in the
  `2026-08-19` shape: `DEFAULT_MARKET` and the quote fixtures carry
  `chainRef: 'solana:mainnet-beta'` and a base58 `contractAddress` and no
  `chainId`; `DEFAULT_TRADE` carries `chainRef`; `DEFAULT_COMPLETED_TRADE`
  has a `null` `txHash`; `DEFAULT_PORTFOLIO_SUMMARY` holds a base58 wallet.
  Tests asserting on the old Base values need updating.

### Added

- **`kash.redemptions.create({ marketId, outcomeIndex })`** — redeem a settled
  position (`POST /v1/redemptions`), on Solana or Base. Returns the redemption
  resource plus `idempotent`. Exports `RedemptionsClient`,
  `CreateRedemptionBodySchema`, `CreateRedemptionResponseSchema`,
  `RedemptionResourceSchema`, `RedemptionKindSchema` and their types; the mock
  client gains `redemptions.create` and `DEFAULT_REDEMPTION`.
- **Typed chain references**: `parseChainRef`, `tryParseChainRef`,
  `formatChainRef`, `SOLANA_CLUSTERS`, and the `ChainRef` / `SolanaCluster`
  types. Parses `solana:<cluster>` and `evm:<chainId>`, and accepts the CAIP-2
  `eip155:<chainId>` spelling as an alias. The wire fields stay plain strings,
  so an unfamiliar chain never fails a response.
- `MIGRATION-0.2.md`, shipped in the npm package.

### Documentation

- README rewritten Solana-first: live keys trade on Solana mainnet, test keys
  on Solana devnet, and Base is documented as supported while its pre-cutover
  markets resolve. New **Chains** and **Redemptions** sections.

## [0.1.5] - 2026-10-01

Solana-cutover hotfix. `SDK_API_VERSION` is unchanged (`2026-04-29`), so a
`^0.1.3` consumer picks this up with no code change. **Exported types are
unchanged for every field below except one** — `PredictionResource.logIndex`,
called out under _Changed_ because keeping it strict would make this release
reject real responses on the pinned version.

0.1.4 was prepared in the monorepo but never published to npm. Everything it
contained ships here, so this entry lists all of it.

### Fixed

- **A Solana `trade.completed` webhook no longer throws in your handler.**
  `TradeCompletedPayload.txHash` accepted only an EVM hash (`0x` + 64 hex) in
  0.1.3, so `WebhookEventSchema.parse` and `webhooks.constructEvent` rejected
  every Solana delivery, whose transaction id is a base58 signature. It now
  accepts either form. `TradeResource.txHash` accepts the same two forms.
  (The type is `string` either way.)
- **An unkeyed `POST` can no longer be duplicated by a retry.** In 0.1.3 a
  `trades.create()` without an `Idempotency-Key` or `clientRequestId` was
  retried up to `maxRetries` times on a transport error, and a reset after the
  server had accepted it placed a second real trade. Every `POST` without a
  caller-supplied key now gets one generated by the SDK, once per call and
  shared by all its retry attempts (`crypto.randomUUID()`, falling back to
  `crypto.getRandomValues()`). A key you pass always wins; `GET`s are
  unaffected. **When the runtime has no `crypto` source at all, that `POST` is
  sent once and not retried** (`maxRetries` is treated as 0 for it) rather than
  repeating an unprotected write. If you relied on retries in such a runtime,
  pass your own `idempotencyKey`.

### Added

- `chainRef` on the trade resource (`trades.create/get/list/confirm`), on every
  trade webhook payload, on `MarketResource` and on `QuoteMarketSummary` —
  `"evm:8453"`, `"solana:mainnet-beta"`. Optional everywhere. Webhooks carry it
  on every delivery whatever version your key pins; the resources carry it from
  API version `2026-08-19`.
- `MarketResource.resolution` — the dispute-window settlement state
  (`proposedOutcomeIndex`, `proposedAt`, `finalizableAt`, `settlementStatus`,
  `disputeOpen`), or `null` when the market has no pending proposal. Optional:
  an API deployment that predates it omits the key.
- `MarketResource.resolutionState` — the market's coarse resolution state
  (`resolving`, `proposed`, `settling`, `resolved`, `cancelled`), or `null`
  before expiry. It never says who is resolving the market. Optional. Its enum
  is exported as `MarketResolutionStateSchema` / `MarketResolutionState`.

### Changed

- **`PredictionResource.logIndex` is `number | null`** (was `number`). A log
  index is an EVM concept; for a Solana trade the API sends `null`. The
  predictions endpoint is not version-gated, so `markets.predictions()` on a
  Solana market returns these rows on `2026-04-29` too — and 0.1.3 throws
  `Response schema mismatch: data.0.logIndex: Expected number, received null`
  on them. Keeping the old type would keep that crash, so this is the one type
  change in a patch release. Handle `null` where you read `logIndex`.
- Runtime guard: `chainId` on markets, quotes and trace events now refuses
  Kash's internal Solana surrogate ids (9,000,000–9,999,999). The API no longer
  emits them on any version. The type is unchanged.

### Unchanged on purpose

- `MarketResource.chainId` and `QuoteMarketSummary.chainId` stay **required
  `number`**, as in 0.1.3. The pinned `2026-04-29` never serves a non-EVM market
  or quote (`/v1/markets` filters them out; `/v1/markets/{id}` and the quote
  endpoints answer `400 CHAIN_NOT_SUPPORTED`), so every response it sends
  carries one. Passing `apiVersion: '2026-08-19'` to a 0.1.x client makes Solana
  markets fail to parse; upgrade to 0.2.0 for that version.

### Documentation

- `PortfolioSummary.smartAccountAddress` may be a **base58 Solana wallet
  address**, not a `0x` smart account, for a user whose funds live on Solana.
- `TradeResource.txHash` is **`null` for every Solana trade**, on every API
  version, even once `completed`. Read the signature from the
  `trade.completed` webhook instead.

## [0.1.2] — 2026-07-29

### Added

- **`freezeAt` on the market resource.** `MarketResource` now carries
  `freezeAt`, the moment trading closes on a market. It is distinct from
  `expiresAt`, which is the on-chain resolve time — for a typical market
  `freezeAt` is 300 seconds earlier. Consumers that need the real
  last-tradable instant should read `freezeAt` and stop deriving it.

  The field is **optional**, not merely nullable: an API deployment that
  predates it omits the key entirely, so a client on this version keeps
  working against an older environment and simply sees `undefined`.
  Non-breaking — no action required.

## [0.1.1] — 2026-06-18

### Changed

- **Mainnet GA.** The production API (`api.kash.bot`) is live and
  `kash_live_*` keys are issued self-service under **Settings → API
  Keys** in the app. Documentation refreshed accordingly — removed the
  "staging release / email for a key / ships at v1.0" framing. No
  runtime change: the SDK already defaults to production and auto-routes
  `kash_live_*` → production, `kash_test_*` → staging by key prefix.

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
