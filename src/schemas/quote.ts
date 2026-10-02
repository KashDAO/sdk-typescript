/**
 * Quote schemas — the wire shape for `GET /v1/markets/{id}/quote`.
 *
 * Returns an on-chain price quote for buying or selling outcome
 * tokens. All bigint contract values are surfaced as decimal strings
 * — JSON has no native bigint, so the API uses strings to round-trip
 * losslessly. The SDK's `quotes` client exposes them as-is; consumers
 * typically pass them straight into `BigInt(…)` at the call site.
 *
 * Units (echoed in the response `units` block):
 *   - USDC fields (`amountIn`, `usdcOut`): atomic, 6 decimals
 *     (1 USDC = 1_000_000)
 *   - Token fields (`tokensOut`, `tokensIn`, `grossRelease`,
 *     `reserveAfter`, `c`, `pAfter[]`, `qAfter[]`): WAD, 18 decimals
 *     (1.0 = 1_000_000_000_000_000_000)
 */

import { z } from 'zod';

import { publicChainIdSchema } from './_chain.js';
import { MetaSchema } from './common.js';

const wadIntegerString = z.string().regex(/^\d+$/, 'Must be a non-negative integer string');
const usdcIntegerString = z.string().regex(/^\d+$/, 'Must be a non-negative integer string');

export const QuoteActionSchema = z.enum(['buy', 'sell']);
export type QuoteAction = z.infer<typeof QuoteActionSchema>;

export const QuoteMarketSummarySchema = z.object({
  id: z.string().uuid(),
  contractAddress: z.string(),
  /**
   * EVM chain id. **Required on the 0.1.x line**, exactly as 0.1.3 typed it.
   * The API version this line pins (`2026-04-29`) refuses a non-EVM quote with
   * 400 CHAIN_NOT_SUPPORTED, so every quote it returns carries one. 0.2.0 makes
   * it optional, because `2026-08-19` serves Solana quotes without it.
   */
  chainId: publicChainIdSchema,
  /**
   * Self-describing chain identity — `evm:8453`, `solana:devnet`.
   *
   * Sent by the API from version `2026-08-19` onward and absent on the
   * version this release pins, so it is optional: the key is missing, not
   * empty.
   */
  chainRef: z.string().optional(),
  outcomes: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      label: z.string(),
      probability: z.number().min(0).max(1),
    })
  ),
  status: z.enum(['UNSEEDED', 'ACTIVE', 'RESOLVED', 'ABANDONED']).nullable(),
});

export type QuoteMarketSummary = z.infer<typeof QuoteMarketSummarySchema>;

const sharedQuoteFieldsSchema = z.object({
  outcomeIndex: z.number().int().nonnegative(),
  reserveAfter: wadIntegerString,
  c: wadIntegerString,
  pAfter: z.array(wadIntegerString),
  qAfter: z.array(wadIntegerString),
  effectivePrice: z.number(),
  impliedProbability: z.number().min(0).max(1).nullable(),
});

export const QuoteBuyDetailSchema = sharedQuoteFieldsSchema.extend({
  action: z.literal('buy'),
  amountIn: usdcIntegerString,
  tokensOut: wadIntegerString,
});

export const QuoteSellDetailSchema = sharedQuoteFieldsSchema.extend({
  action: z.literal('sell'),
  tokensIn: wadIntegerString,
  usdcOut: usdcIntegerString,
  grossRelease: wadIntegerString,
});

export const QuoteDetailSchema = z.discriminatedUnion('action', [
  QuoteBuyDetailSchema,
  QuoteSellDetailSchema,
]);

export type QuoteDetail = z.infer<typeof QuoteDetailSchema>;
export type QuoteBuyDetail = z.infer<typeof QuoteBuyDetailSchema>;
export type QuoteSellDetail = z.infer<typeof QuoteSellDetailSchema>;

export const QuoteResponseSchema = z.object({
  quote: QuoteDetailSchema,
  market: QuoteMarketSummarySchema,
  units: z.object({
    usdc: z.literal('atomic-6'),
    token: z.literal('wad-18'),
  }),
  _meta: MetaSchema,
});

export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

/**
 * Result returned by `kash.quotes.buy()` / `kash.quotes.sell()` —
 * the quote detail with the embedded market summary attached as a
 * sibling. Flat shape (no `_meta` envelope) consistent with every
 * other resource method in the SDK.
 */
export type Quote = QuoteDetail & { readonly market: QuoteMarketSummary };
