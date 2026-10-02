# `@kashdao/sdk`

Official TypeScript SDK for the [Kash](https://kash.bot) public API.

[![npm version](https://img.shields.io/npm/v/@kashdao/sdk.svg)](https://www.npmjs.com/package/@kashdao/sdk)
[![bundle size](https://img.shields.io/badge/min%2Bbrotli-≤24KB-blue)](#bundle-size)
[![types](https://img.shields.io/npm/types/@kashdao/sdk.svg)](https://www.npmjs.com/package/@kashdao/sdk)
[![license](https://img.shields.io/npm/l/@kashdao/sdk.svg)](./LICENSE)
[![Node 22+](https://img.shields.io/node/v/@kashdao/sdk.svg)](https://nodejs.org)

- **Native `fetch`** — zero runtime dependencies beyond [Zod](https://zod.dev).
- **ESM + CJS + `.d.ts`** — Node 22+, modern browsers, Deno, Bun.
- **End-to-end typed** — every response is Zod-validated; drift between API
  and SDK fails CI.
- **Stripe-style resources** — `kash.markets.list()`, `kash.trades.create()`.
- **Production-grade resilience** — bounded retries, exponential backoff with
  jitter, `Retry-After` honouring, AbortController support.
- **Observability built in** — `onRequest`/`onResponse`/`onRetry`/`onError`
  hooks for logging, tracing, metrics — without the SDK picking a logger.

## Table of contents

- [Getting started](#getting-started) — sign up, get a key, make your first call
- [Install](#install)
- [Which package do I need?](#which-package-do-i-need) — `@kashdao/sdk` vs `@kashdao/protocol-sdk`
- [API keys](#api-keys) — scopes, limits, allowlists, rotation
- [Test mode vs live mode](#test-mode-vs-live-mode)
- [Quickstart](#quickstart)
- [Configuration](#configuration)
- [API versioning](#api-versioning) — pinning behaviour to a specific dated server release
- [Chains](#chains) — Solana first, Base while its markets resolve; `chainRef`
- [Resources](#resources)
  - [Markets](#markets)
  - [Quotes](#quotes)
  - [Trades](#trades)
  - [Redemptions](#redemptions)
  - [Portfolio](#portfolio)
  - [Webhooks](#webhooks)
  - [Account](#account)
  - [Traces](#traces)
- [Pagination](#pagination)
- [Polling](#polling)
- [Errors](#errors)
- [Idempotency](#idempotency)
- [Rate limits & retries](#rate-limits-retries)
- [Timeouts and aborts](#timeouts-and-aborts)
- [Observability](#observability)
- [Webhook signature verification](#webhook-signature-verification)
- [Troubleshooting](#troubleshooting)
- [Testing your integration](#testing-your-integration) — `@kashdao/sdk/testing` mock client
- [Recipes](#recipes)
- [What's NOT in this SDK yet](#whats-not-in-this-sdk-yet)
- [Compatibility](#compatibility)
- [Bundle size](#bundle-size)
- [Versioning](#versioning)
- [Support & community](#support-community)
- [Contributing](#contributing)
- [License](#license)

---

## Getting started

A first trade in five steps. Total time: about 5 minutes.

> 🚀 **Live on mainnet.** The production API (`api.kash.bot`) is live.
> Issue a `kash_live_*` key yourself under **Settings → API Keys** in
> the [Kash app](https://app.kash.bot) — the SDK auto-routes it to
> production. Prefer to dry-run first? A `kash_test_*` key routes to
> staging (`api-staging.kash.bot`, Solana devnet, simulated USDC).

### 1. Create a Kash account

Sign up at **[https://app.kash.bot](https://app.kash.bot)**. The app walks
you through wallet provisioning — a Privy-managed smart account is created
automatically; you don't need to bring your own wallet.

### 2. Create an API key

In the [Kash app](https://app.kash.bot), go to **Settings → API Keys →
Create API Key**. Choose `Live` for real USDC on Solana mainnet or `Test`
for simulated trades on Solana devnet, set the scopes and (optionally) an
IP allowlist, and copy the plaintext secret. The key shape:

| Field            | What it does                                                                   |
| ---------------- | ------------------------------------------------------------------------------ |
| **Name**         | Free-form label, shown in audit logs (e.g. `acme-prod-trader`).                |
| **Mode**         | `Live` (real USDC on Solana mainnet) or `Test` (simulated, Solana devnet).     |
| **Scopes**       | Permission set — see [API keys](#api-keys).                                    |
| **IP allowlist** | Optional list of CIDR ranges. Empty = any IP. Recommended for production keys. |

The plaintext secret is shown **once** — copy it now. The value looks like:

```
kash_live_a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuV
kash_test_a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuV
```

The `live`/`test` prefix tells the SDK and the API which network the key
operates on. They're not interchangeable.

### 3. Set the key in your environment

```sh
# .env (or your CI / Vercel / Railway / Fly secrets store)
KASH_API_KEY=kash_test_a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuV
```

> ⚠️ **Never commit keys to source control.** Use environment variables,
> a secrets manager (AWS Secrets Manager, GCP Secret Manager, Vault, 1Password,
> Doppler), or your platform's encrypted config (Vercel/Netlify/Render).

### 4. Install the SDK

```sh
npm install @kashdao/sdk    # or pnpm add / yarn add / bun add
```

Requires **Node.js 22+**, or any modern browser, Deno 1.37+, or Bun 1.0+.
See [Compatibility](#compatibility) + the [Install](#install) section
for all install paths.

### 5. Make your first call

```ts
import { KashClient } from '@kashdao/sdk';

const kash = new KashClient({ apiKey: process.env.KASH_API_KEY });

// First call. Every resource method needs an API key — only
// `kash.healthCheck()` is fully unauthenticated.
const markets = await kash.markets.list({ status: 'ACTIVE', limit: 5 });
console.log(`Found ${markets.data.length} active markets`);
console.log(markets.data[0]?.title);
```

If that prints a market title, you're connected. Continue to
[Quickstart](#quickstart) for the full trade lifecycle.

---

## Install

### From npm

```sh
npm install @kashdao/sdk
# or
pnpm add @kashdao/sdk
# or
yarn add @kashdao/sdk
# or
bun add @kashdao/sdk
```

### Pre-release / install from source

If you're working from `main` before a tag is cut (e.g. trying a fix
before it lands on npm), install directly from the GitHub mirror:

```sh
npm install github:KashDAO/sdk-typescript#main
```

The package ships ESM + CJS dual builds with full `.d.ts`. No bundler
configuration required — works out of the box with Next.js, Remix,
Vite, esbuild, Webpack, Turbopack, Rollup, tsc.

---

## Which package do I need?

Kash ships **two independent SDKs** for two different audiences. They
have no shared package boundary — install whichever fits your use case
(or both, if you need both).

> **Every Kash SDK and the public API are non-custodial.** User funds
> always sit in Privy-managed MPC smart accounts that the user
> controls — Kash never holds keys, never custodies funds, never moves
> value, and is not a money-services business. The split below is
> about _who orchestrates execution_ (Kash backend vs. you), not
> custody. See [SECURITY.md](./SECURITY.md) § Non-custodial design
> for the full statement.

### This package — `@kashdao/sdk` (Kash-orchestrated, API-wrapping)

```ts
import { KashClient } from '@kashdao/sdk';

const kash = new KashClient({ apiKey: process.env.KASH_API_KEY });
const trade = await kash.trades.create({...});
```

- **What it wraps**: the Kash public REST API (`api.kash.bot/v1/*`).
- **Auth**: Kash API key (`kash_live_…` / `kash_test_…`) — a scoped,
  revocable delegation the user issues against their own Privy-managed
  smart account. Kash never sees signing keys; Privy MPC keeps them
  with the user.
- **Custody**: every state-changing on-chain action is signed by the
  user's smart account inside Privy MPC. Kash never holds funds,
  never moves funds, and never signs anything. See
  [SECURITY.md § Non-custodial design](./SECURITY.md#non-custodial-design)
  for the full statement.
- **Dependencies**: just [Zod](https://zod.dev). No viem, no bundler
  client, no chain RPC required.
- **Best for**: trading bots, dashboards, fintech integrations,
  anywhere you want a single REST surface over the user's smart
  account without running your own signer/RPC/bundler.

### Sibling package — [`@kashdao/protocol-sdk`](https://www.npmjs.com/package/@kashdao/protocol-sdk) (self-orchestrated, on-chain)

A standalone package for talking directly to the Kash protocol contracts
without going through the Kash API. Brings your own signer (HSM,
Fireblocks, web3signer, viem account, browser wallet), your own RPC,
your own bundler. Transactions never touch Kash servers. (Same
non-custodial model as the wrapper above; the difference is the
orchestration layer is yours, not Kash's.)

- Install separately: `npm install @kashdao/protocol-sdk viem`.
- Best for: market makers, AI-agent runners, self-custody UIs, anyone
  building infra where Kash should not be in the latency or trust path.
- See its [README](https://github.com/KashDAO/protocol-sdk-typescript#readme)
  for the full surface.

### Need both?

`npm install @kashdao/sdk @kashdao/protocol-sdk` — they coexist
cleanly. A common pattern is using `@kashdao/sdk` for fast public
reads (markets list, quotes) and `@kashdao/protocol-sdk` for the
actual on-chain trade signing.

### Prefer the terminal?

If you want a one-binary entry point that wraps both packages above
behind a single `kash …` command — with multi-profile auth, JSON
output for AI agents, shell completion, and `kash protocol …` for
the on-chain path — see [`@kashdao/cli`](https://www.npmjs.com/package/@kashdao/cli).

### Python integrator?

The on-chain protocol SDK ships a Python sibling at
[`kashdao-protocol-sdk`](https://pypi.org/project/kashdao-protocol-sdk/) —
the canonical Hummingbot integration path. Cross-language parity is
validated by byte-equal test fixtures.

---

## API keys

API keys are issued self-service under **Settings → API Keys** in the
[Kash app](https://app.kash.bot).

### Scopes

A key carries a comma-separated list of scopes. The SDK calls the right
endpoint for each operation; if your key lacks the scope, the request
returns `403 INSUFFICIENT_SCOPE` and the SDK throws
`KashAuthorizationError`.

| Scope             | Unlocks                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markets:read`    | `kash.markets.list()`, `kash.markets.get()`, `kash.markets.predictions()`. Granted by default on every tier.                                                                          |
| `markets:quote`   | `kash.quotes.buy()`, `kash.quotes.sell()`. Split from `markets:read` because quotes are RPC-heavy and customers may want to throttle quote traffic independently. Granted by default. |
| `trades:read`     | `kash.trades.list()`, `kash.trades.get()`, `kash.traces.get()`.                                                                                                                       |
| `trades:write`    | `kash.trades.create()`, `kash.trades.confirm()`, `kash.trades.waitForCompletion()`.                                                                                                   |
| `portfolio:read`  | `kash.portfolio.get()`, `kash.portfolio.positions()`.                                                                                                                                 |
| `webhooks:manage` | `kash.webhooks.list()`, `kash.webhooks.redeliver()`, `kash.webhooks.rotateSecret()`.                                                                                                  |
| `auth:manage`     | `kash.account.usage()` plus API key self-service in the app (issue / list / revoke own keys — those operations aren't exposed in the SDK yet).                                        |

> **`kash.healthCheck()` is the only fully public method** — no API
> key required. Every other resource method authenticates via API key.

> 💡 **Principle of least privilege**: a read-only dashboard should hold a
> key with only `markets:read` + `markets:quote` + `portfolio:read` +
> `trades:read`. Reserve `trades:write` for the service that actually
> places trades.

### IP allowlist

Optional `ip_allowlist` (list of CIDRs) on each key. Empty allowlist = any
IP. When configured, requests from non-allowlisted IPs return
`403 IP_NOT_ALLOWED` (the SDK throws `KashAuthorizationError`).

For production keys, set an allowlist that includes your server egress IPs.
For desktop/CLI keys, leave empty.

### Rotation

Keys never auto-rotate. To rotate:

1. Create a new key in the app with the same scopes.
2. Deploy your service with the new key.
3. Verify it's working (check the dashboard's "last used" timestamp on each key).
4. Revoke the old key.

For webhook signing secrets, the SDK ships a one-call rotation:

```ts
const { secret } = await kash.webhooks.rotateSecret();
console.log('new secret (shown once):', secret);
```

The previous secret is retained server-side for **7 days** for emergency
rollback (operator-only, via `kash-admin`). It's NOT used for signing —
deliveries are signed with the new secret immediately upon rotation.

### Revocation

Revoke a key under **Settings → API Keys → … → Revoke** in the app;
revocation is effective immediately. Subsequent requests return
`401 API_KEY_REVOKED` (`KashAuthenticationError`).

---

## Test mode vs live mode

Two parallel environments, distinguished by the API key prefix:

|                 | Test                              | Live                      |
| --------------- | --------------------------------- | ------------------------- |
| Key prefix      | `kash_test_…`                     | `kash_live_…`             |
| API base URL    | `https://api-staging.kash.bot/v1` | `https://api.kash.bot/v1` |
| Blockchain      | Solana devnet ¹                   | Solana mainnet ¹          |
| USDC            | Test USDC (faucet via the app)    | Real USDC                 |
| Markets         | Test markets only                 | Live markets only         |
| Webhook secrets | `whsec_…` (separate from live)    | `whsec_…` (separate)      |

¹ Solana has been Kash's canonical chain since 2026-10-01; every new market is
created there. Markets created on Base before the cutover (Base Sepolia on
test, Base mainnet on live) keep trading and resolving on Base and stay fully
supported until they settle. Each market says which chain it is on in its
`chainRef` — see [Chains](#chains).

### Just give the SDK a key. It picks the right URL automatically.

```ts
// kash_test_… → staging
const test = new KashClient({ apiKey: process.env.KASH_TEST_KEY });

// kash_live_… → production
const live = new KashClient({ apiKey: process.env.KASH_LIVE_KEY });

// No key → production base URL by default. Construction succeeds,
// but every resource method except `healthCheck()` will throw
// `KashAuthenticationError` until you set an apiKey or env var.
const probe = new KashClient();
await probe.healthCheck(); // ✓ unauthenticated
```

The base URL is **inferred from the key prefix**. You can still override
explicitly when you need to (private mirror, local mock, future region):

```ts
new KashClient({
  apiKey: process.env.KASH_TEST_KEY,
  baseUrl: 'https://my-private-mirror.example.com/v1',
});
```

### Resolution order for `baseUrl`

The SDK picks the first match:

1. **Explicit `baseUrl`** in the constructor config
2. **`KASH_BASE_URL`** environment variable
3. **Inferred from `apiKey` prefix** (`kash_test_*` → staging; `kash_live_*` → production)
4. **Default**: `https://api.kash.bot/v1` (production)

The mirroring constants are exported if you need them:

```ts
import { PRODUCTION_BASE_URL, STAGING_BASE_URL } from '@kashdao/sdk';
```

### Per-environment recipe

Most apps just need the auto-route. If you want to be extra explicit
(or you're switching between mock servers in CI), the manual form
still works:

```ts
const isProd = process.env.NODE_ENV === 'production';
export const kash = new KashClient({
  apiKey: isProd ? process.env.KASH_LIVE_KEY! : process.env.KASH_TEST_KEY!,
  // baseUrl is auto-routed from the key, but you can pin it:
  // baseUrl: isProd ? PRODUCTION_BASE_URL : STAGING_BASE_URL,
});
```

> ⚠️ A **live key sent to the staging URL** (or vice versa) returns
> `401 API_KEY_INVALID`. The auto-route prevents this for you, but if
> you override `baseUrl` explicitly, the prefix and URL must match.

### Pointing at a custom base URL

The auto-route covers `api.kash.bot` (production) and
`api-staging.kash.bot` (staging). For anything else — record-and-replay
tooling, a private mirror, a corporate egress proxy, or a mock HTTP
server you maintain yourself — pass `baseUrl` explicitly or set
`KASH_BASE_URL`:

```ts
new KashClient({
  apiKey: process.env.KASH_API_KEY,
  baseUrl: 'http://localhost:4010/v1', // your proxy / mock server
});
```

The cross-mode hint that fires on staging↔production key/URL mismatch
is silent for non-canonical URLs, so custom hosts work without false
warnings.

#### What this is NOT for

There's no Kash-managed local API server you can spin up — the API
itself is hosted infrastructure. If you're trying to develop your
integration without hitting a real server, you have two better
choices:

1. **Unit tests with no HTTP at all** — use the
   [`@kashdao/sdk/testing`](#testing-your-integration) mock client.
   It's structurally compatible with `KashClient`, returns
   wire-shape-valid fixtures by default, and lets you override any
   method to simulate success or error paths. Zero network, zero
   `fetch`, zero retries.

2. **Integration tests against a real server** — use a `kash_test_*`
   key. The auto-route sends every call to staging
   (`api-staging.kash.bot`), where trades execute on Solana devnet
   with simulated funds. No real money, full lifecycle. See
   [Test mode vs live mode](#test-mode-vs-live-mode).

The `baseUrl` override exists for the genuinely-custom cases above —
not as a stand-in for a local Kash environment that doesn't exist.

---

## Quickstart

```ts
import { KashClient } from '@kashdao/sdk';

const kash = new KashClient({ apiKey: process.env.KASH_API_KEY });

const trade = await kash.trades.create({
  marketId: 'market-uuid',
  outcomeIndex: 0,
  amount: '100',
  side: 'buy',
});

const completed = await kash.trades.waitForCompletion(trade.id, {
  timeoutMs: 60_000,
  onStatus: (t) => console.log('status:', t.status),
});

console.log('done:', completed.txHash);
```

That's the trade lifecycle: **create → wait → done**. For the high-value
confirmation path, see [`examples/06-high-value-trade.ts`](./examples/06-high-value-trade.ts).

## Configuration

The SDK reads `KASH_API_KEY` and `KASH_BASE_URL` from the environment
when you don't pass them explicitly:

```ts
// Auto-discovery — picks up KASH_API_KEY + KASH_BASE_URL from env
const kash = new KashClient();

// Or explicit (always wins over env):
const kash = new KashClient({ apiKey: 'kash_live_…' });

// Health probe — returns { ok, latencyMs, version } without throwing.
// Run this on app boot to verify connectivity:
const health = await kash.healthCheck();
if (!health.ok) console.error('Cannot reach Kash');
```

Full config:

```ts
new KashClient({
  apiKey: process.env.KASH_API_KEY, // required for every resource method except healthCheck()
  baseUrl: 'https://api.kash.bot/v1', // default
  timeoutMs: 30_000, // per-request timeout
  maxRetries: 3, // 0 disables retry
  retryBaseDelayMs: 200, // exponential backoff base
  retryMaxDelayMs: 10_000, // cap per attempt
  retryAfterMaxMs: 60_000, // cap on server-supplied Retry-After
  userAgentSuffix: 'acme-trader/1.4.2', // identifies your app in our logs
  headers: { traceparent: '00-…' }, // custom default headers (cannot override SDK headers)
  fetch: customFetch, // for tests / proxies
  hooks: {
    /* onRequest, onResponse, onRetry, onError — see Observability */
  },
});
```

Misconfiguration throws `KashConfigurationError` — every issue is exposed via
`.issues` so structured loggers can render the full list. The returned
`kash.config` is `Object.freeze`-d; mutations throw at runtime.

The `apiKey` is shape-validated (`kash_(live|test)_<32 alphanumeric>`)
at construction. If you accidentally paste your `whsec_…` webhook secret
in place of your API key, the constructor catches it within microseconds
and explains the difference instead of letting the server return a 401.

### Recognised environment variables

| Variable        | Default                        | Purpose                               |
| --------------- | ------------------------------ | ------------------------------------- |
| `KASH_API_KEY`  | (none — required at call time) | Used when `apiKey` config is omitted  |
| `KASH_BASE_URL` | `https://api.kash.bot/v1`      | Used when `baseUrl` config is omitted |

Explicit config always wins over env. Browsers and edge runtimes
without `process.env` simply skip the auto-discovery — no error.

### Cloning with overrides

```ts
const tenantA = kash.withConfig({ apiKey: tenantAKey });
const slow = kash.withConfig({ timeoutMs: 120_000 });
```

`withConfig` returns a brand-new client — the original is untouched.
Validation runs again, so invalid overrides throw `KashConfigurationError`.

## API versioning

The Kash API uses **dated versioning** (Stripe-style): every breaking
server-side change ships under a new dated version (`YYYY-MM-DD`).
Older dated versions keep working — your code only sees the new
behaviour when you opt in.

Every SDK release **pins a default API version** — the dated version
the SDK was tested against. When the server ships a newer dated
version with breaking behaviour, your existing SDK install keeps
working unchanged.

```ts
import { KashClient, SDK_API_VERSION } from '@kashdao/sdk';

// Sends `X-Kash-Api-Version: <SDK_API_VERSION>` on every request:
const kash = new KashClient({ apiKey });

// Override to opt into newer behaviour ahead of an SDK upgrade:
const kash = new KashClient({ apiKey, apiVersion: '2026-08-15' });

// Or pin a specific older version for compatibility testing:
const kash = new KashClient({ apiKey, apiVersion: '2026-01-01' });
```

**This release pins `2026-08-19`.** That version serves Solana markets, names
every market's chain with `chainRef`, and omits `chainId` for a Solana market.
Pinning the older `2026-04-29` keeps the EVM-only behaviour — Solana markets are
filtered out of `markets.list()` and `markets.get()` refuses them with
`CHAIN_NOT_SUPPORTED` — so only do that if you trade residual Base markets
exclusively. See [`MIGRATION-0.2.md`](./MIGRATION-0.2.md).

The constant `SDK_API_VERSION` is exported so consumers can log it
alongside their error reports:

```ts
import { SDK_API_VERSION, SDK_VERSION } from '@kashdao/sdk';

logger.info(`kash sdk@${SDK_VERSION} api=${SDK_API_VERSION}`);
```

### Upgrading

To pick up newer server-side behaviour:

1. Read the **API version policy** at [docs.kash.bot/developer-docs/rest-api/overview](https://docs.kash.bot/developer-docs/rest-api/overview#api-version) — every dated version's lifecycle (Sunset / Deprecation headers) is documented there.
2. Upgrade `@kashdao/sdk` (which bumps `SDK_API_VERSION` and runs the contract tests against the new version). Set `apiVersion: 'YYYY-MM-DD'` to declare the version your client is built against.

**Server behaviour:** the public API reads the `X-Kash-Api-Version`
request header (sent automatically by the SDK from your
`apiVersion` config) and routes the request through a
version-appropriate code path. Header absent → server uses its
canonical `PUBLIC_API_VERSION`. Header present and recognised →
request honours the pin. Header present but unrecognised → `410
API_VERSION_UNSUPPORTED` with `metadata.supported` listing every
accepted version. The server's canonical version is also emitted
as the `X-API-Version` response header on every request — surfaced
on the SDK's `onResponse` hook as `apiVersion` so you can detect
server-side rollouts:

```ts
const kash = new KashClient({
  apiKey,
  hooks: {
    onResponse: ({ apiVersion }) => {
      if (apiVersion && apiVersion !== SDK_API_VERSION) {
        log.warn('server.api-version drift', { server: apiVersion, sdk: SDK_API_VERSION });
      }
    },
  },
});
```

The full list of currently-accepted versions is surfaced in every
`410 API_VERSION_UNSUPPORTED` response body under
`metadata.supported`, and listed at
[`api.kash.bot/v1/openapi/index.json`](https://api.kash.bot/v1/openapi/index.json).
The hosted error-catalogue page at
[`docs.kash.bot/developer-docs/api-errors/API_VERSION_UNSUPPORTED`](https://docs.kash.bot/developer-docs/api-errors/API_VERSION_UNSUPPORTED)
documents the full negotiation contract.

### Format and validation

Versions are strict ISO dates: `YYYY-MM-DD`. The SDK rejects malformed
values at construction with `KashConfigurationError`.

## Chains

**Solana is Kash's canonical chain** — production cut over on 2026-10-01, and
every new market is created on Solana mainnet (staging: Solana devnet).
**Base is still supported**: markets created on Base before the cutover keep
trading and resolving there, and this SDK serves both side by side. You do not
choose a chain per call; each market lives on one, and trades, quotes and
redemptions route to it.

Every market, quote, trade and trade webhook names its chain with `chainRef`:

| `chainRef`            | Chain                            |
| --------------------- | -------------------------------- |
| `solana:mainnet-beta` | Solana mainnet (live, canonical) |
| `solana:devnet`       | Solana devnet (test, canonical)  |
| `evm:8453`            | Base mainnet (live, pre-cutover) |
| `evm:84532`           | Base Sepolia (test, pre-cutover) |

The wire field is a plain string, so a chain added later never makes a response
fail to parse. For a typed view, parse it:

```ts
import { parseChainRef, tryParseChainRef, formatChainRef } from '@kashdao/sdk';

const market = await kash.markets.get(id);
const chain = market.chainRef ? tryParseChainRef(market.chainRef) : undefined;
if (chain?.type === 'solana') {
  console.log('Solana cluster', chain.cluster); // 'mainnet-beta'
} else if (chain?.type === 'evm') {
  console.log('EVM chain', chain.chainId); // 8453
}

parseChainRef('eip155:8453'); // CAIP-2 alias → { type: 'evm', chainId: 8453 }
formatChainRef({ type: 'solana', cluster: 'devnet' }); // 'solana:devnet'
```

`parseChainRef` throws `KashValidationError` on anything else;
`tryParseChainRef` returns `undefined`.

What differs on Solana:

- **Addresses are base58.** `market.contractAddress` and
  `portfolio.smartAccountAddress` may be base58 Solana addresses, not `0x` hex.
- **`chainId` is absent** on a Solana market or quote. Use `chainRef`.
- **`trade.txHash` is `null`** for a Solana trade, even once `completed`. The
  `trade.completed` webhook carries the base58 transaction signature.

## Resources

### Markets

```ts
const market = await kash.markets.get('market-uuid');
const page = await kash.markets.list({ status: 'ACTIVE', limit: 50 });

// Recent trades feed (live activity). Cursor-paginated; needs `markets:read` scope.
const feed = await kash.markets.predictions('market-uuid', {
  side: 'buy', // optional filter
  outcomeIndex: 0, // optional filter
  limit: 50, // default 50, max 100
});
for (const t of feed.data) console.log(t.side, t.price, t.timestamp);

// Or stream every trade across pages:
for await (const t of await kash.markets.predictions('market-uuid')) {
  // newest first; break early to stop
}
```

### Quotes

On-chain price quotes — calls the AMM's view functions via the public
API and returns the projected outcome of a buy or sell without actually
executing it. Requires an API key with the `markets:quote` scope
(granted by default on every tier; split from `markets:read` because
quotes are RPC-heavy).

```ts
// Buy quote: 100 USDC into outcome 0
const buy = await kash.quotes.buy({
  marketId,
  outcomeIndex: 0,
  amountUsdcAtomic: 100n * 1_000_000n, // 100 USDC * 1e6
});
console.log(`tokens out: ${buy.tokensOut} (WAD)`);
console.log(`implied probability after trade: ${buy.impliedProbability}`);

// Sell quote: 1 outcome-0 token
const sell = await kash.quotes.sell({
  marketId,
  outcomeIndex: 0,
  tokensInWad: 1n * 10n ** 18n,
});
console.log(`USDC out (atomic): ${sell.usdcOut}`);
```

All bigint contract returns surface as **decimal strings** — JSON has no
native bigint, so the API uses strings to round-trip losslessly. Cast to
`BigInt(...)` for math. The response also carries the embedded market
summary (id, contract, outcomes, status) so a single quote call gives
you everything you need to render a trade preview.

The endpoint is **cached 10 seconds** server-side. Quote at the size you
want to trade — slippage scales non-linearly with size, so don't extrapolate
from a 1-USDC quote.

### Trades

```ts
// Place a trade. Returns the trade itself with `idempotent` flag and
// optional `confirmation` (set when the high-value gate fires).
const trade = await kash.trades.create(body, { idempotencyKey: 'order-1' });

if (trade.confirmation) {
  await kash.trades.confirm(trade.id, { token: trade.confirmation.token });
}

// Fetch one.
const t = await kash.trades.get(id);

// List with cursor pagination.
const trades = await kash.trades.list({ status: 'pending,completed', limit: 50 });

// Block until terminal status.
const done = await kash.trades.waitForCompletion(id);
```

**Solana trades.** `trade.txHash` is `null` for every Solana trade, even once
`completed`: the trade resource publishes EVM hashes only. The
`trade.completed` webhook carries the real base58 signature. `trade.chainRef`
(`"solana:mainnet-beta"`, `"evm:8453"`) names the chain, on API version
`2026-08-19` and later.

#### Metadata

Every `kash.trades.create()` call accepts an optional `metadata` map —
Stripe-pattern customer-supplied tags that ride through to the trade
row and every webhook payload's `data.metadata` field. Use it to
correlate trades with your own order ids, strategy names, tenant
identifiers, A/B-test cohorts, etc.

```ts
const trade = await kash.trades.create({
  marketId,
  outcomeIndex: 0,
  amount: '100',
  side: 'buy',
  metadata: {
    orderId: 'order_2026_05_02_001',
    strategy: 'momentum-v2',
    tenantId: 'acme-corp',
  },
});

// Always present on read (defaults to `{}` when none supplied).
console.log(trade.metadata.strategy); // → 'momentum-v2'
```

Constraints (enforced server-side; the SDK validates client-side via
`TradeMetadataSchema`):

- ≤ 10 keys per trade
- Keys: 1–64 chars, `[a-zA-Z0-9_\-.]` only
- Values: strings only, ≤ 500 chars

```ts
import { TradeMetadataSchema } from '@kashdao/sdk';

// Validate before sending — surfaces a typed Zod issue rather than a 400.
const result = TradeMetadataSchema.safeParse({ orderId: 'order_1' });
if (!result.success) console.error(result.error.issues);
```

#### Type-narrowing helpers

Avoid spelling status enum literals at every branch — use the typed
guards:

```ts
import {
  isAwaitingConfirmation,
  isCompletedTrade,
  isFailedTrade,
  isPendingTrade,
  isRejectedTrade,
  isTerminalTrade,
} from '@kashdao/sdk';

const t = await kash.trades.get(id);

if (isAwaitingConfirmation(t)) {
  // t.status is narrowed to 'pending_confirmation'
} else if (isPendingTrade(t)) {
  // t.status is narrowed to 'pending' | 'validating' | 'executing'
} else if (isTerminalTrade(t)) {
  // t.status is narrowed to 'completed' | 'failed' | 'rejected'
  if (isCompletedTrade(t)) console.log('tx:', t.txHash);
  if (isFailedTrade(t) || isRejectedTrade(t)) console.error(t.errorCode, t.errorMessage);
}
```

The three top-level guards (`isAwaitingConfirmation`, `isPendingTrade`,
`isTerminalTrade`) are mutually exclusive and exhaustive over every
trade status — the `else` chain above never falls through.

### Redemptions

When a market resolves (or is cancelled), winning tokens stay in your wallet
until you redeem them — nothing claims them for you. One call redeems one
(market, outcome) position, on Solana or Base:

```ts
const redemption = await kash.redemptions.create({ marketId, outcomeIndex: 0 });
// { id, marketId, outcomeIndex, kind: 'resolved' | 'cancelled', sharesWad, status: 'pending', idempotent }
```

Requires the `trades:write` scope. The payout executes asynchronously after
the request is accepted. Calling it again for a position that already has a
request returns that request with `idempotent: true`. A position that cannot be
redeemed (unresolved market, losing outcome, already redeemed) throws
`KashConflictError` with code `POSITION_NOT_CLAIMABLE`. The same code is
returned when a **previous redemption for that position failed**: the failed
request still holds the position's slot, so retrying will not help — contact
support. The error message (the server's `detail`) says which case applies.

### Portfolio

```ts
const summary = await kash.portfolio.get();
const positions = await kash.portfolio.positions({ marketId });
```

`summary.smartAccountAddress` is the address holding your funds. For a user
whose funds live on Solana it is a **base58 Solana wallet address**, not a
`0x` smart account, so treat it as an opaque chain address.

### Webhooks

```ts
// Verify the signature AND parse into a typed event in one call
// (Stripe pattern). Throws KashWebhookSignatureError on bad signature.
const event = await kash.webhooks.constructEvent(rawBody, header, secret);

// Browse recent deliveries — newest first; cursor-paginated.
// Filter by status to find stuck or failed events:
const page = await kash.webhooks.list({ status: 'failed', limit: 50 });
for (const event of page.data) {
  console.log(event.id, event.status, event.delivery.lastFailureCode);
}

// Async-iterate every retrying event across pages:
for await (const event of await kash.webhooks.list({ status: 'retrying' })) {
  // newest first; break early to stop
}

// Replay a previously-shipped event.
await kash.webhooks.redeliver(eventId);

// Rotate the signing secret. Returns the new secret ONCE.
const { secret } = await kash.webhooks.rotateSecret();
```

### Account

```ts
// Per-key telemetry: trade volume + success rate + p50/p99 latency
// (24h / 7d / 30d windows), webhook delivery success rate (7d), and
// auth-failure / rate-limit-rejection counts (24h). Same data the
// app's API Keys settings page renders inline.
const usage = await kash.account.usage();
console.log(`24h success rate: ${usage.trades['24h'].successRate}`);
console.log(`24h p99 latency:  ${usage.trades['24h'].latencyMs.p99}ms`);
```

Requires the `auth:manage` scope (the same scope that issues + revokes
your own keys — "tell me about my own account" lives in the same lane).

### Traces

Every trade emits a stream of events as it moves through the pipeline
(intent parsing → funding → bridge → execution → webhook delivery).
The `traces` endpoint returns the curated, sanitized event timeline
for a given correlation id — enough signal to reconstruct what
happened without exposing internal pipeline state.

```ts
// trade.correlationId is on every TradeResource.
const trace = await kash.traces.get(trade.correlationId);
for (const event of trace.events) {
  console.log(event.occurredAt, event.type, event.data);
}
```

Requires the `trades:read` scope. **404 covers both "unknown
correlation id" AND "you don't own the trade behind it"** — the server
collapses the two by design to prevent enumeration. Both surface as
`KashNotFoundError`.

## Pagination

`markets.list()` and `trades.list()` return a `Page<T>` — at once the first
page (with `.data`, `.hasMore`, `.nextCursor`) and an `AsyncIterable<T>` that
walks every subsequent page on demand.

```ts
// Just the first page:
const page = await kash.markets.list({ limit: 50 });
console.log(page.data, page.hasMore);

// Walk explicitly:
const next = await page.getNextPage(); // null if there's no next page

// Stream every market across pages:
for await (const market of await kash.markets.list({ status: 'ACTIVE' })) {
  console.log(market.id);
}
```

The iterator terminates when `pagination.cursor === null`, when the server
returns a short page, or after 1,000 pages (safety cap against an upstream
cursor bug).

## Polling

`trades.waitForCompletion(id)` polls until the trade reaches a terminal
status (`completed`, `failed`, or `rejected`).

```ts
const done = await kash.trades.waitForCompletion(tradeId, {
  timeoutMs: 60_000, // default
  pollIntervalMs: 2_000, // default
  onStatus: (t) => console.log(t.status),
  signal: abortController.signal,
});
```

The helper refuses to poll a trade that is `pending_confirmation` — call
`kash.trades.confirm(id, { token })` first with the token from the 202
response of `trades.create()`.

## Errors

Every failure throws a typed subclass of `KashError`. Branch on `instanceof`
or on the stable `code` string.

```ts
import {
  KashAuthenticationError,
  KashConfigurationError,
  KashConflictError,
  KashRateLimitError,
  KashServerError,
  KashTimeoutError,
  KashValidationError,
} from '@kashdao/sdk';

try {
  await kash.trades.create({ ...body });
} catch (err) {
  if (err instanceof KashRateLimitError) {
    console.error(`Rate limited; retry after ${err.retryAfterSeconds}s`);
  } else if (err instanceof KashConflictError) {
    console.error('Conflict:', err.code, err.message);
  } else if (err instanceof KashAuthenticationError) {
    console.error('Bad API key:', err.code);
  } else if (err instanceof KashServerError) {
    console.error('Server error:', err.code, err.requestId);
  }
  throw err;
}
```

| Subclass                    | When                                         | `isRetryable` |
| --------------------------- | -------------------------------------------- | ------------- |
| `KashAuthenticationError`   | 401 — bad / missing / revoked key            | false         |
| `KashAuthorizationError`    | 403 — missing scope, IP not allowed          | false         |
| `KashNotFoundError`         | 404                                          | false         |
| `KashConflictError`         | 409 / 410 — idempotency, account state       | false         |
| `KashRateLimitError`        | 429, exposes `retryAfterSeconds`             | **true**      |
| `KashValidationError`       | 400 / 422 + SDK-side schema mismatch         | false         |
| `KashServerError`           | 5xx, optional `retryAfterSeconds`            | **true**      |
| `KashMaintenanceError`      | 503 kill switch                              | **true**      |
| `KashTimeoutError`          | SDK timeout fired                            | **true**      |
| `KashNetworkError`          | `fetch` threw (DNS, TLS, refused)            | **true**      |
| `KashAbortedError`          | Caller aborted (`AbortSignal`)               | false         |
| `KashConfigurationError`    | Constructor validation failure               | false         |
| `KashWebhookSignatureError` | `webhooks.constructEvent` signature mismatch | false         |

`isRetryable: true` errors only escape the SDK after `maxRetries` is exhausted.

### Cross-realm `instanceof` safety

When errors travel between realms (worker ↔ main thread, iframe ↔ parent,
or a hoisted-monorepo with two SDK copies), plain `instanceof KashError`
returns `false` because each realm has its own class identity. Use the
static helper:

```ts
if (KashError.isKashError(err)) {
  // err.code, err.statusCode, err.requestId all typed
}
```

The check is implemented via a `Symbol.for('@kashdao/sdk:KashError')`
brand that survives realm boundaries.

Every error carries:

- `code` — stable, machine-readable string (e.g. `MARKET_NOT_TRADEABLE`)
- `statusCode` — HTTP status (when applicable)
- `requestId` — `X-Request-ID` from the response, for support tickets
- `context: { method, path, attempt }` — the failing call + how many tries
- `cause` — the underlying error, if any
- `.toJSON()` — structured payload safe for production logs (no `cause`/`stack`)

## Idempotency

Two independent mechanisms — pick one or both:

```ts
// Header-level — generic across all POST routes (24h TTL).
await kash.trades.create(body, { idempotencyKey: crypto.randomUUID() });

// Body-level — survives missing headers; tied to (user_id, client_request_id).
await kash.trades.create({ ...body, clientRequestId: 'order-2026-04-30-001' });
```

Replays of the same idempotent request return the original response with
`_meta.idempotent: true`. Replays with a different body return `409
IDEMPOTENCY_KEY_CONFLICT` (or `409 CLIENT_REQUEST_ID_CONFLICT`). The SDK
does **not** auto-retry these — they signal a logical conflict the caller
must resolve.

### POSTs are auto-keyed

If you supply neither, the SDK generates an `Idempotency-Key` for every POST
itself, once per call, and sends the same one on every retry of that call.

This is not a convenience — it is what makes the SDK's own retries safe. A
connection reset or timeout is **not** evidence the server did nothing: it can
drop the response to a trade that was already created, and an unkeyed retry
would then place a second real trade. Two separate `create()` calls always get
two distinct keys, so auto-keying never collapses two intended trades into one.

Supply your own key when you want idempotency to span more than one SDK call —
a retry after a process restart, or a job that may run twice. The SDK never
overwrites a key you passed.

In the rare runtime with no `crypto` at all, no key can be generated; the SDK
then sends the POST **once** and surfaces the error rather than repeating an
unprotected write.

## Rate limits & retries

The SDK retries 429 / 5xx / network errors / timeouts with exponential
backoff and full jitter, bounded by `maxRetries` (default 3).

`Retry-After` is parsed in both delta-seconds and HTTP-date forms. If the
server says "wait longer than `retryAfterMaxMs`," the SDK surfaces the error
immediately rather than retrying too soon — that respects the server's
intent and lets your application decide whether to back off further.

```ts
new KashClient({
  apiKey,
  maxRetries: 5,
  retryAfterMaxMs: 30_000, // server says wait > 30s? throw, don't sleep + retry
});
```

After `maxRetries` is exhausted, the final error exposes
`retryAfterSeconds` so application-level backoff can pick up where the SDK
left off.

## Timeouts and aborts

Default per-request timeout is 30 seconds. Override globally via `timeoutMs`
or pass an `AbortSignal` to honour caller cancellations:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

await kash.trades.waitForCompletion(id, { signal: controller.signal });
// → throws KashAbortedError if it doesn't terminate first
```

`KashAbortedError` is **not** retryable — the consumer asked us to stop, so
we honour that even mid-backoff.

## Observability

Wire the lifecycle hooks to your logger:

```ts
const kash = new KashClient({
  apiKey,
  hooks: {
    onRequest: (e) => log.info({ msg: 'kash.request', ...e }),
    onResponse: (e) => log.info({ msg: 'kash.response', ...e, ms: e.durationMs }),
    onRetry: (e) => log.warn({ msg: 'kash.retry', ...e }),
    onError: (e) => log.error({ msg: 'kash.error', ...e }),
  },
});
```

Hook payloads include `method`, `url`, `attempt`, `idempotencyKey`,
`durationMs`, `status`, `requestId`, `code`, `reason`. **A throwing hook
cannot break the request path** — exceptions in handlers are intentionally
swallowed.

### Rate-limit telemetry

`onResponse` and every `KashError` carry a `rateLimit` field parsed
from the server's `X-RateLimit-Limit` / `X-RateLimit-Remaining` /
`X-RateLimit-Reset` headers. Use it for client-side throttling:

```ts
const kash = new KashClient({
  apiKey,
  hooks: {
    onResponse: (e) => {
      if (e.rateLimit && e.rateLimit.remaining < 5) {
        // ~5 calls left in the bucket — pause issuing requests.
        scheduler.pauseFor(e.rateLimit.resetSeconds * 1000);
      }
    },
  },
});

// And on the catch path:
try {
  await kash.trades.create(body);
} catch (err) {
  if (err instanceof KashRateLimitError && err.rateLimit) {
    console.warn(`Rate limited; ${err.rateLimit.resetSeconds}s until reset.`);
  }
}
```

`rateLimit` is `null` when the response carried no rate-limit headers
(network errors, timeouts, upstream proxy failures), and `undefined`
when the error originated before any HTTP exchange (configuration
errors).

## Webhook signature verification

The recommended one-call helper is `kash.webhooks.constructEvent`
(Stripe pattern) — it verifies the `X-Kash-Signature` header AND
parses the body into a typed, narrowable `WebhookEvent`:

```ts
import express from 'express';
import { KashClient, KashWebhookSignatureError } from '@kashdao/sdk';

const kash = new KashClient({ apiKey: process.env.KASH_API_KEY! });

app.post('/webhooks/kash', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await kash.webhooks.constructEvent(
      req.body.toString('utf8'),
      req.headers['x-kash-signature'] as string,
      process.env.KASH_WEBHOOK_SECRET!
    );
    // event.type narrows event.data:
    if (event.type === 'trade.completed') {
      await markOrderShipped(event.data.tradeId, event.data.txHash);
    } else if (event.type === 'trade.failed') {
      await flagOrder(event.data.tradeId, event.data.errorCode);
    } else if (event.type === 'trade.confirmation-required') {
      await notifyOperator(event.data.tradeId, event.data.confirmationExpiresAt);
    }
    return res.status(204).end();
  } catch (err) {
    if (err instanceof KashWebhookSignatureError) {
      return res.status(400).send(err.message);
    }
    throw err;
  }
});
```

Customer-supplied `metadata` from the original `trades.create()`
call is echoed on every payload's `data.metadata`, so handlers can
branch (`event.data.metadata.strategy === 'momentum-v2'`) without
re-fetching the trade.

Dedupe on `event.id` (also returned in the `X-Kash-Event-Id` header)
to make repeated deliveries safe — operator-triggered redeliveries
reuse the same id.

### Lower-level: `verifySignature`

If you want to handle parsing yourself (e.g. you serialise the body
into a queue for downstream processing and the schema parse happens
elsewhere), use `verifySignature` directly:

The webhook delivery worker signs payloads with `X-Kash-Signature`:

```
X-Kash-Signature: t=1730000000000,v1=<hex-hmac-sha256>
```

Verify with:

```ts
import express from 'express';
import { KashClient } from '@kashdao/sdk';

const kash = new KashClient({ apiKey: process.env.KASH_API_KEY! });

app.post('/webhooks/kash', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = req.body.toString('utf8');
  const header = req.headers['x-kash-signature'] as string;

  const result = await kash.webhooks.verifySignature(
    rawBody,
    header,
    process.env.KASH_WEBHOOK_SECRET!
  );
  if (!result.valid) {
    console.warn('bad signature:', result.reason);
    return res.status(400).end();
  }

  // …process the event…
  return res.status(204).end();
});
```

> ⚠️ **Pass the raw bytes**, not a parsed JSON object. `JSON.stringify`-ing
> a parsed object will not produce the same bytes (key order and whitespace
> differ) and the signature will silently fail.

> ⚠️ **The verifier rejects empty secrets** — fail-fast so a missing
> environment variable doesn't silently produce a "valid" signature against
> an empty key.

Replays carry the same `X-Kash-Event-Id`; dedupe on that to make repeated
deliveries (and operator-triggered redeliveries) safe.

## Troubleshooting

### `KashAuthenticationError: API_KEY_INVALID`

Three usual causes:

1. **Mode mismatch.** A `kash_test_…` key sent to `https://api.kash.bot/v1`
   (live URL) is rejected, and vice versa. Check the table in
   [Test mode vs live mode](#test-mode-vs-live-mode).
2. **The key was revoked.** Check its status under **Settings → API Keys** in the app.
3. **The env var isn't loaded.** `console.log(process.env.KASH_API_KEY?.slice(0, 10))`
   should print `kash_live_` or `kash_test_` — if it prints `undefined`,
   your dotenv loader isn't running.

### `KashAuthorizationError: INSUFFICIENT_SCOPE`

The endpoint you're calling needs a scope your key doesn't have. Check the
[scopes table](#scopes). Add the missing scope in the app, then either
rotate the key or revoke + reissue.

### `Module not found: @kashdao/sdk` after install

You're likely on Node ≤ 18. The SDK requires Node 22+ (or modern browser /
Deno / Bun). Check `node --version`.

### `expected application/json response, received "text/html"`

Your `baseUrl` is pointed at something that isn't the API (a load balancer
default page, an HTML error page, etc.). Verify you're hitting
`https://api.kash.bot/v1` (live) or `https://api-staging.kash.bot/v1` (test).

### Webhook signature always invalid

Three usual causes:

1. **You parsed the body before verifying.** Use `express.raw()` /
   Fastify's raw-body parser / `await request.text()` in Next.js.
2. **The wrong secret.** Confirm the value in `KASH_WEBHOOK_SECRET` matches
   the one rotated most recently for this API key.
3. **Clock skew > 5 minutes.** The SDK rejects timestamps outside a
   5-minute tolerance by default. Tighten or relax via `toleranceMs`.

### Lots of `KashTimeoutError` in production

Either raise `timeoutMs` or check for upstream issues. The default 30s
matches the server-side timeout cap — `KashTimeoutError` past 30s usually
means transport-layer trouble (DNS, TLS).

### `KashConfigurationError: Invalid KashClient configuration — apiKey: …`

Inspect `.issues` for the precise field. Most common: `apiKey` is `''`
because the env var wasn't set.

### Trades stuck in `pending_confirmation`

The trade hit the high-value confirmation gate. Capture the `confirmation.token`
from the 202 response and call `kash.trades.confirm(id, { token })`.
`waitForCompletion` refuses to poll until you do.

### `KashConflictError: SMART_ACCOUNT_NOT_PROVISIONED`

Your account's smart-wallet provisioning hasn't completed. New accounts
take a few seconds to fully provision; the app shows a "wallet ready"
indicator. Wait for that, then retry.

### `KashConflictError: INSUFFICIENT_BALANCE`

Your smart account doesn't have enough USDC to cover the trade. Top up via
the on-ramp in the Kash app (production) or the test-USDC faucet (staging).

## Testing your integration

`@kashdao/sdk/testing` ships a fixture-driven mock client that satisfies
the same public surface as `KashClient` — no fetch, no retry, no
network. Use it in unit tests to assert behaviour without mocking the
HTTP layer:

```ts
import { createMockKashClient, DEFAULT_MARKET, DEFAULT_TRADE } from '@kashdao/sdk/testing';
import { KashRateLimitError } from '@kashdao/sdk';

// Unconfigured — every method returns a wire-shape-valid default:
const kash = createMockKashClient();
const market = await kash.markets.get('mkt-uuid'); // → DEFAULT_MARKET (with id='mkt-uuid')
const trade = await kash.trades.get('trd-uuid'); // → DEFAULT_TRADE
const page = await kash.markets.list(); // → Page<MarketResource>

// Override per resource:
const kash = createMockKashClient({
  markets: {
    get: (id) => ({ ...DEFAULT_MARKET, id, title: `Mock ${id}` }),
    list: () => [DEFAULT_MARKET, { ...DEFAULT_MARKET, id: 'mkt-2' }],
  },
  trades: {
    create: (body) => ({ ...DEFAULT_TRADE, marketId: body.marketId, idempotent: false }),
  },
});

// Throw to simulate a server error (any KashError subclass works):
const kash = createMockKashClient({
  trades: {
    create: () => {
      throw new KashRateLimitError('mock 429', {
        code: 'RATE_LIMITED',
        statusCode: 429,
        retryAfterSeconds: 30,
      });
    },
  },
});
```

The mock is structurally compatible with `KashClient` — your code under
test takes a `KashClient`-shaped dependency and the mock plugs in
without any cast. Imports come from the `testing` subpath only, so
production bundles never pull in fixtures or factory code.

## Recipes

### Logging every request to a structured logger

See [`examples/05-observability.ts`](./examples/05-observability.ts).

### Custom retry policy

Disable the SDK's retry and roll your own:

```ts
const kash = new KashClient({ apiKey, maxRetries: 0 });

async function withMyRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof KashError) || !err.isRetryable) throw err;
      await sleep(myBackoff(attempt));
    }
  }
  throw new Error('exhausted');
}
```

### Per-environment client (test vs live)

```ts
const isProd = process.env.NODE_ENV === 'production';
export const kash = new KashClient({
  apiKey: isProd ? process.env.KASH_LIVE_KEY! : process.env.KASH_TEST_KEY!,
  baseUrl: isProd ? 'https://api.kash.bot/v1' : 'https://api-staging.kash.bot/v1',
});
```

### Multi-tenant client cache

```ts
const clients = new Map<string, KashClient>();
function clientFor(apiKey: string): KashClient {
  let c = clients.get(apiKey);
  if (!c) {
    c = new KashClient({ apiKey });
    clients.set(apiKey, c);
  }
  return c;
}
```

### High-value confirmation, end-to-end

The high-value gate fires before the trade enters the pipeline. Capture
the token from the create response, confirm, then poll:

```ts
const trade = await kash.trades.create(body, { idempotencyKey: 'order-1' });

if (trade.confirmation) {
  // Show a UI / log / require human approval — token is shown ONCE.
  await kash.trades.confirm(trade.id, { token: trade.confirmation.token });
}

const done = await kash.trades.waitForCompletion(trade.id, { timeoutMs: 60_000 });
if (isCompletedTrade(done)) console.log('tx:', done.txHash);
```

### Idempotency-conflict resolution

A `409 IDEMPOTENCY_KEY_CONFLICT` means _the same key was reused with a
different body_. Don't retry — fix the caller. A `409 CLIENT_REQUEST_ID_CONFLICT`
means the same client-request-id was reused; same rule.

```ts
try {
  await kash.trades.create(body, { idempotencyKey: 'order-1' });
} catch (err) {
  if (err instanceof KashConflictError && err.code === 'IDEMPOTENCY_KEY_CONFLICT') {
    // The body changed since the first call. Either generate a new key
    // (treating this as a different logical request) or fetch the
    // original by id to inspect the prior result. NEVER auto-retry.
    throw err;
  }
  throw err;
}
```

### Distributed tracing (W3C `traceparent`)

Inject a `traceparent` per call so the API request shows up in your
trace alongside upstream spans:

```ts
const traceparent = `00-${traceId}-${spanId}-01`;
await kash.trades.create(body, {
  idempotencyKey: orderId,
  headers: { traceparent },
});
```

Or set it as a default for every request from one logical scope:

```ts
const tenantClient = kash.withConfig({
  headers: { traceparent: req.headers['traceparent'] },
});
```

### Webhook handler with secret rotation

Rotation publishes a new secret immediately. The previous one is retained
for 7 days for emergency rollback (operator-only) — not used for signing.
Store both values during the rollover and try them in order. This is
one of the few cases where you want the lower-level `verifySignature`
primitive instead of `constructEvent` — `constructEvent` throws on the
first bad signature and short-circuits the fallback.

```ts
import { createHash } from 'node:crypto';

let active: string = process.env.KASH_WEBHOOK_SECRET!;
let previous: string | undefined;

app.post('/webhooks/kash', express.raw({ type: 'application/json' }), async (req, res) => {
  const body = req.body.toString('utf8');
  const sig = req.headers['x-kash-signature'] as string;

  for (const secret of [active, previous].filter(Boolean) as string[]) {
    const result = await kash.webhooks.verifySignature(body, sig, secret);
    if (result.valid) return res.status(204).end();
  }
  return res.status(400).end();
});

// Rotate from a CLI / cron — in-memory swap is the simple version;
// distributed deployments need a shared store (Redis, KMS, secret manager):
async function rotate() {
  const { secret } = await kash.webhooks.rotateSecret();
  previous = active;
  active = secret;
  // Persist + notify the rest of the fleet via your secret store.
}
```

### Live market activity feed

`kash.markets.predictions(id)` is cursor-paginated newest-first. For a
live feed, poll the head every few seconds and stop once you reach the
last id you've already seen:

```ts
async function pollMarketTrades(marketId: string, lastSeen: string | null) {
  const page = await kash.markets.predictions(marketId, { limit: 50 });
  const fresh = lastSeen ? page.data.takeWhile((t) => t.id !== lastSeen) : page.data;
  return { fresh, newLastSeen: page.data[0]?.id ?? lastSeen };
}

setInterval(async () => {
  const { fresh, newLastSeen } = await pollMarketTrades(marketId, lastSeenId);
  fresh.forEach(renderTrade);
  lastSeenId = newLastSeen;
}, 3_000);
```

### Backfilling historical trades

For exporting / ETL, walk every page lazily — the iterator stops the
moment your `break` fires, so you never fetch beyond what you consume:

```ts
const cutoff = new Date('2026-01-01').toISOString();
const out: TradeResource[] = [];

for await (const trade of await kash.trades.list({ status: 'completed', limit: 100 })) {
  if (trade.createdAt < cutoff) break;
  out.push(trade);
}
```

### Distinguishing "trade reverted" from "network blip"

Both `KashServerError` and `KashTimeoutError` are retryable, but they
mean different things — the server saying "try again later" versus the
SDK giving up on a stuck socket. The error class is the discriminator:

```ts
try {
  await kash.trades.waitForCompletion(id);
} catch (err) {
  if (err instanceof KashTimeoutError) {
    // SDK gave up; the trade may still complete — fetch it to find out.
    const t = await kash.trades.get(id);
    if (isTerminalTrade(t)) return t;
  }
  if (err instanceof KashServerError) {
    // Server signalled an outage — back off and retry the get.
  }
  if (err instanceof KashConflictError && err.code === 'TRADE_NOT_AWAITING_CONFIRMATION') {
    // You called waitForCompletion on a trade still at pending_confirmation.
  }
  throw err;
}
```

## What's NOT in this SDK yet

For full transparency on the v0.2 surface — the following capabilities exist
on the Kash platform but are **not** wrapped by this SDK release. They're
either accessible via the API directly or planned for a future version:

- **Market disputes and competitions** — `/v1/markets/{id}/disputes` and
  `/v1/competitions*` are served by the API but not yet wrapped as SDK methods.

- **API key self-service** (`auth:manage` scope) — issue/list/revoke keys
  programmatically. Available today in the app under **Settings → API
  Keys**; not yet wrapped as SDK methods.
- **Streaming / WebSocket subscriptions** — the API doesn't expose a
  streaming endpoint yet. For now, poll with `waitForCompletion()` for
  trade status and consume webhook deliveries for events.
- **Bridge / on-ramp / off-ramp flows** — these go through the Kash app
  UI in v1, not the public API.

If any of these matter to you, [open a discussion](https://github.com/KashDAO/sdk-typescript/discussions)
— prioritisation is driven by what real consumers need.

## Compatibility

| Runtime             | Status |
| ------------------- | ------ |
| Node.js 22+         | ✅     |
| Chrome 110+         | ✅     |
| Firefox 110+        | ✅     |
| Safari 16+          | ✅     |
| Deno 1.37+          | ✅     |
| Bun 1.0+            | ✅     |
| Cloudflare Workers  | ✅     |
| Vercel Edge runtime | ✅     |
| Node.js ≤ 18        | ❌     |

The SDK uses native `fetch`, `URL`, `AbortController`, `crypto.subtle`, and
`TextEncoder` — all standard in modern runtimes.

## Bundle size

Every release is gated by [`size-limit`](https://github.com/ai/size-limit),
which measures each entry the way your bundler ships it — minified, then
brotli-compressed:

| Entry                  | Cap   |
| ---------------------- | ----- |
| `@kashdao/sdk`         | 24 KB |
| `@kashdao/sdk/testing` | 8 KB  |

Verify locally with `pnpm build && pnpm size`.

Zod is the only runtime dependency; it is **not** bundled (it's a peer
dependency-style external).

## Versioning

`0.x.y` — pre-1.0; minor versions may include breaking changes. All
breaking changes are documented in [`CHANGELOG.md`](./CHANGELOG.md).

After 1.0:

- Major version: breaking change to public types or runtime behaviour.
- Minor version: new methods, new error subclasses, new config options.
- Patch version: bug fixes, doc improvements, internal refactors.

## Support & community

| Need                         | Where to go                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create an API key**        | **Settings → API Keys → Create API Key** in the [Kash app](https://app.kash.bot) — `Live` (Solana mainnet) or `Test` (Solana devnet)               |
| **Bug reports**              | [GitHub issues](https://github.com/KashDAO/sdk-typescript/issues) — please include the SDK version, runtime, and `requestId` from the failing call |
| **Feature requests**         | [GitHub discussions](https://github.com/KashDAO/sdk-typescript/discussions)                                                                        |
| **Security vulnerabilities** | `security@kash.bot` — see [SECURITY.md](./SECURITY.md). **Do NOT file public issues.**                                                             |
| **Examples**                 | [`examples/`](./examples) — runnable end-to-end scripts + framework [`starters/`](./examples/starters) (Next.js, Express, Cloudflare)              |

When you file a bug, the most useful piece of context is the `requestId`
on the error you saw — it lets us pull server logs for the failing call
in seconds:

```ts
catch (err) {
  if (KashError.isKashError(err)) {
    console.error({
      code: err.code,
      requestId: err.requestId,   // ← include this when reporting
      context: err.context,       // method/path/attempt
    });
  }
}
```

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Security disclosures: see
[`SECURITY.md`](./SECURITY.md).

## License

MIT — see [LICENSE](./LICENSE).
