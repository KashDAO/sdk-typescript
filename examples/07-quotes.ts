/**
 * Get an on-chain price quote before placing a trade.
 *
 * `kash.quotes.buy({ amountUsdcAtomic })` and
 * `kash.quotes.sell({ tokensInWad })` call the AMM contract's view
 * functions and return the projected outcome of the trade — tokens
 * out, USDC out, slippage, post-trade implied probability — without
 * actually placing it.
 *
 * Use this to:
 *   - Show users a "you'll get ~X tokens for $Y USDC" preview.
 *   - Reject trades client-side that exceed a slippage threshold.
 *   - Build a market depth chart by quoting at multiple sizes.
 *
 * The endpoint requires the `markets:quote` scope and is cached for 10s
 * server-side. All bigint contract values are returned as decimal strings
 * so JSON parses them losslessly — pass them straight into `BigInt(...)`
 * if you need to do math.
 */

import { KashClient } from '@kashdao/sdk';

const kash = new KashClient({ apiKey: process.env.KASH_API_KEY });

// === Buy quote: 100 USDC into outcome 0 ===
const buy = await kash.quotes.buy({
  marketId: '00000000-0000-0000-0000-000000000001',
  outcomeIndex: 0,
  amountUsdcAtomic: 100n * 1_000_000n, // 100 USDC * 1e6
});

console.log(`Buying 100 USDC of "${buy.market.outcomes[0]?.label}" gets:`);
console.log(`  Tokens: ${BigInt(buy.tokensOut) / 10n ** 18n} (~${buy.tokensOut} WAD)`);
console.log(`  Effective USDC/token: ${buy.effectivePrice}`);
console.log(`  Implied probability after trade: ${buy.impliedProbability}`);

// === Sell quote: 1 outcome-0 token ===
const sell = await kash.quotes.sell({
  marketId: '00000000-0000-0000-0000-000000000001',
  outcomeIndex: 0,
  tokensInWad: 1n * 10n ** 18n, // 1 token in WAD
});

console.log(`\nSelling 1 token of outcome 0 gets:`);
console.log(`  USDC: ${BigInt(sell.usdcOut) / 1_000_000n} (~${sell.usdcOut} atomic)`);
console.log(`  Effective USDC/token: ${sell.effectivePrice}`);

// === Slippage check before placing the actual trade ===
const minTokensOut = (BigInt(buy.tokensOut) * 99n) / 100n; // 1% slippage tolerance
console.log(`\nWill only proceed if we get >= ${minTokensOut} WAD tokens.`);
