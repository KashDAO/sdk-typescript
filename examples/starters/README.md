# Kash SDK starter projects

Each subdirectory is a runnable example wiring `@kashdao/sdk` into a
specific framework or runtime. Pick the one that matches your stack:

| Starter | Framework | Use case |
|---|---|---|
| [`nextjs-app-router/`](./nextjs-app-router) | Next.js 15 (App Router) | Full-stack web app — server components for authenticated reads, server actions for authenticated trades |
| [`express/`](./express) | Node + Express | Backend API service — webhooks, server-to-server integration |
| [`cloudflare-worker/`](./cloudflare-worker) | Cloudflare Workers | Edge runtime — rate-limited proxy or webhook receiver at the edge |

## How to run any of them

```sh
cd <starter>
cp .env.example .env.local        # Then edit .env.local with your KASH_API_KEY
pnpm install
pnpm dev
```

Each starter pulls `@kashdao/sdk` from npm (no local linking) so the
exact `pnpm install` flow your customers will run is what we test.

## The security model these starters demonstrate

Kash API keys are server-side secrets. **Never put `kash_live_…` or
`kash_test_…` in browser-shipped code** (no `NEXT_PUBLIC_*`,
`VITE_*`, or any other build-time public env var prefix).

Each starter follows the right pattern:

- **All API calls run server-side.** The `api.kash.bot` REST API
  requires an API key on every data route (markets list, market detail,
  predictions, quotes, trades, portfolio, webhooks). Never ship the key
  to the browser; proxy via a server route, server action, or worker.
- **Browser-safe reads** (anonymous market browsing, embedded market
  cards) belong on the **webapp's** `app.kash.bot/api` surface, not on
  this SDK.
- **Authenticated mutations + webhooks** (trades, portfolio, webhook
  signature verification) run server-side only:
  - In Next.js: behind a **server action** or **route handler**.
  - In Express: a normal route handler.
  - In Cloudflare Workers: the worker itself acts as the server.

Each starter's `README.md` walks through which calls happen where.
