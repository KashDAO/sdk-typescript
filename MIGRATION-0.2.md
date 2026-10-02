# Migrating to `@kashdao/sdk` 0.2.0

Kash moved its canonical chain from Base to **Solana mainnet** on 2026-10-01.
Every new market is created on Solana. Markets created on Base before that date
keep trading and resolving on Base until they settle.

0.2.0 exists so the SDK sees the Solana markets. It changes one default, and
that default changes what responses look like.

## Do you need to do anything?

| If your code…                                        | Then                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| reads `market.chainId` or `quote.market.chainId`     | switch to `chainRef` (section 1) — the type is now `number \| undefined` |
| assumes addresses or tx hashes are `0x` hex          | allow base58 (section 2)                                                 |
| asserts on `@kashdao/sdk/testing` fixture values     | update to the Solana defaults (section 3)                                |
| needs to keep the old EVM-only behaviour for a while | pin `apiVersion: '2026-04-29'` (section 4)                               |

Nothing else in the public surface was removed or renamed.

## 1. The default API version is now `2026-08-19`

`SDK_API_VERSION` moved from `2026-04-29` to `2026-08-19`, and every request
sends it unless you pass `apiVersion`. Under the newer version:

- `markets.list()` includes Solana markets. (`2026-04-29` filters them out.)
- `markets.get()` and `quotes.buy/sell()` serve Solana markets. (`2026-04-29`
  answers `400 CHAIN_NOT_SUPPORTED`.)
- Every market, quote and trade carries **`chainRef`** — `"solana:mainnet-beta"`,
  `"evm:8453"`.
- **`chainId` is absent on a Solana market or quote.** It is still present on a
  Base one.

```ts
// before
if (market.chainId === 8453) { … }

// after
import { tryParseChainRef } from '@kashdao/sdk';

const chain = market.chainRef ? tryParseChainRef(market.chainRef) : undefined;
if (chain?.type === 'solana') { … }
if (chain?.type === 'evm' && chain.chainId === 8453) { … }
```

**This is a type change.** Through 0.1.5 `MarketResource.chainId` and
`QuoteMarketSummary.chainId` are typed as a required `number`; in 0.2.0 they
are `number | undefined`. Under strict TypeScript every unguarded read stops
compiling, which is how you find the places to change.

If you are coming straight from 0.1.3, note one type change that already
landed in 0.1.5: `PredictionResource.logIndex` is `number | null` (it is `null`
for a Solana trade).

## 2. Solana values are base58

- `market.contractAddress` and `quote.market.contractAddress` are base58
  Solana addresses for Solana markets.
- `portfolio.smartAccountAddress` is a base58 Solana wallet for a user whose
  funds live on Solana.
- `trade.txHash` is **`null`** for a Solana trade, even once `completed`. The
  `trade.completed` webhook's `data.txHash` carries the base58 signature
  (accepted since 0.1.5), alongside `data.chainRef`.

If you validate any of these with a `0x` regex, or pass them to an EVM library,
branch on `chainRef` first.

## 3. Testing fixtures describe a Solana market

`@kashdao/sdk/testing` defaults now match a `2026-08-19` response from a Solana
mainnet market: `DEFAULT_MARKET` has `chainRef: 'solana:mainnet-beta'`, a
base58 `contractAddress` and no `chainId`; `DEFAULT_COMPLETED_TRADE.txHash` is
`null`; `DEFAULT_PORTFOLIO_SUMMARY.smartAccountAddress` is base58. To test a
Base path, spread an override:

```ts
const baseMarket = { ...DEFAULT_MARKET, chainId: 8453, chainRef: 'evm:8453' };
```

## 4. Keeping the old behaviour

Pin the previous version per client:

```ts
const kash = new KashClient({ apiKey, apiVersion: '2026-04-29' });
```

You will see only Base markets, and Solana markets will answer
`CHAIN_NOT_SUPPORTED`. That is only useful if you trade residual Base markets
exclusively — since 2026-10-01 they are the only markets you would see.

## New in 0.2.0

- `kash.redemptions.create({ marketId, outcomeIndex })` redeems a settled
  position. Winning tokens are not claimed automatically. See
  [`examples/08-redeem.ts`](./examples/08-redeem.ts).
- `parseChainRef` / `tryParseChainRef` / `formatChainRef` give a typed view of
  `chainRef`, and accept the CAIP-2 `eip155:<chainId>` spelling.

## Staying on 0.1.x

If you cannot migrate yet, `^0.1.3` resolves to **0.1.5**, which keeps
`2026-04-29` and fixes the one live break on that line: a Solana
`trade.completed` webhook no longer fails to parse.
