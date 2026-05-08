# Next.js 15 App Router + `@kashdao/sdk` starter

Full-stack starter showing the canonical Next.js pattern:

- **Server components** fetch public market data via the SDK
  server-side. The HTML is streamed to the browser; no API key is
  ever shipped to the client.
- **Server actions** handle authenticated mutations (place trade,
  confirm high-value trade). Client components call them; the SDK
  call happens on the server.
- **Route handlers** receive webhooks (`/api/webhooks/kash`) and
  verify signatures using the SDK's portable Web Crypto helper.

## What's where

```
.
├── app/
│   ├── page.tsx                                # Server component — lists active markets
│   ├── actions.ts                              # Server actions — placeTrade, confirmHighValueTrade
│   ├── markets/[id]/
│   │   ├── page.tsx                            # Server component — market detail + recent trades
│   │   └── place-order-button.tsx              # Client component — calls placeTrade()
│   └── api/webhooks/kash/route.ts              # Route handler — webhook receiver
└── lib/
    └── kash.ts                                 # 'server-only' KashClient singleton
```

## Run

```sh
cp .env.example .env.local                      # then fill in KASH_API_KEY + KASH_WEBHOOK_SECRET
pnpm install
pnpm dev                                        # http://localhost:3000
```

## The security model this enforces

The KashClient lives in `lib/kash.ts` which starts with
`import 'server-only'`. If a client component (anything with
`'use client'` at the top) imports that file, **the Next.js build
fails** — it's a guardrail against the API-key-in-browser leak.

Server actions in `app/actions.ts` are `'use server'` directives —
Next.js guarantees they only run on the server, even when called from
client components.

The pattern in one line: **All reads → server components (the API key
never reaches the browser). Mutations → server actions. Webhooks →
route handlers. Never client-side.**

## Production checklist

- [ ] Move `KASH_API_KEY` and `KASH_WEBHOOK_SECRET` to your hosting platform's secret manager (Vercel env, Railway, Fly secrets, etc.). Never commit `.env.local`.
- [ ] Pin `@kashdao/sdk` to a caret-major in production: `^0.1.0` while we're 0.x; tighter once we hit 1.0.
- [ ] Cache the markets list at the framework layer if it's used heavily — `unstable_cache` or `'force-cache'` work. Quote calls are 10s edge-cached server-side already; don't double-cache.
- [ ] Ship the webhook handler at the edge runtime if cold-start matters — change `runtime = 'edge'` in `app/api/webhooks/kash/route.ts`. The signature verification works on both runtimes.
