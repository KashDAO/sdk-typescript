# `@kashdao/sdk` examples

Runnable examples covering the most common SDK use cases. Each example is a
single self-contained file you can drop into your own project.

| Example                                              | What it shows                                            |
| ---------------------------------------------------- | -------------------------------------------------------- |
| [`01-basic-trade.ts`](./01-basic-trade.ts)           | Place a trade, wait for completion, log its chain        |
| [`02-pagination.ts`](./02-pagination.ts)             | Two ways to consume `kash.markets.list()` (page vs walk) |
| [`03-error-handling.ts`](./03-error-handling.ts)     | Branching on `KashError` subclasses                      |
| [`04-webhooks.ts`](./04-webhooks.ts)                 | Verify a webhook signature in an Express handler         |
| [`05-observability.ts`](./05-observability.ts)       | Wire the lifecycle hooks to a logger                     |
| [`06-high-value-trade.ts`](./06-high-value-trade.ts) | Confirm a trade that hits the high-value gate            |
| [`07-quotes.ts`](./07-quotes.ts)                     | On-chain price quotes (buy/sell) for slippage previews   |
| [`08-redeem.ts`](./08-redeem.ts)                     | Redeem every winning position once markets settle        |

> **Direct (self-orchestrated) mode** lives in [`@kashdao/protocol-sdk`](https://www.npmjs.com/package/@kashdao/protocol-sdk),
> a separate package — see its README for examples that drop the Kash backend and sign on the consumer's own infra. Both packages are non-custodial; Kash never holds keys or funds on either path.

## Framework starters

Self-contained, runnable projects wiring the SDK into a specific
framework or runtime — see [`starters/`](./starters):

| Starter                                                       | Framework                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| [`starters/nextjs-app-router/`](./starters/nextjs-app-router) | Next.js 15 App Router (server components + server actions) |
| [`starters/express/`](./starters/express)                     | Node + Express (backend service / proxy)                   |
| [`starters/cloudflare-worker/`](./starters/cloudflare-worker) | Cloudflare Workers (edge)                                  |

## Running

```sh
pnpm install
KASH_API_KEY=kash_test_… node --experimental-strip-types examples/01-basic-trade.ts
```

Node 22's `--experimental-strip-types` flag runs TypeScript files directly,
or use `tsx`, `ts-node`, or compile first — whatever fits your workflow.
