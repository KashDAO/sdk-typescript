/**
 * Market schemas — the wire shapes for `GET /v1/markets` and
 * `GET /v1/markets/{id}`.
 *
 * Validated end-to-end via Zod. The contract test in
 * `tests/contract/wire-shape.test.ts` asserts these schemas accept
 * the API's actual response payloads; drift fails CI.
 */

import { z } from 'zod';

import { MetaSchema, PaginationSchema } from './common.js';

export const MarketStatusSchema = z.enum(['UNSEEDED', 'ACTIVE', 'RESOLVED']);
export type MarketStatus = z.infer<typeof MarketStatusSchema>;

export const MarketOutcomeSchema = z.object({
  index: z.number().int().nonnegative(),
  label: z.string(),
  probability: z.number().min(0).max(1),
});

export type MarketOutcome = z.infer<typeof MarketOutcomeSchema>;

export const MarketResourceSchema = z.object({
  id: z.string().uuid(),
  contractAddress: z.string(),
  chainId: z.number().int().positive(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  status: MarketStatusSchema.nullable(),
  outcomeCount: z.number().int().positive(),
  outcomes: z.array(MarketOutcomeSchema),
  imageUrl: z.string().nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  // Optional, not merely nullable: an API deployment older than the field
  // omits the key entirely. Requiring it would make every market fetch throw
  // KashValidationError against any environment that has not deployed it yet.
  freezeAt: z.string().datetime().nullable().optional(),
  resolvedAt: z.string().datetime().nullable(),
});

export type MarketResource = z.infer<typeof MarketResourceSchema>;

/** Query params for `GET /v1/markets`. */
export type ListMarketsParams = {
  readonly cursor?: string;
  readonly limit?: number;
  readonly status?: MarketStatus;
};

export const ListMarketsResponseSchema = z.object({
  data: z.array(MarketResourceSchema),
  pagination: PaginationSchema,
  _meta: MetaSchema,
});

export type ListMarketsResponse = z.infer<typeof ListMarketsResponseSchema>;

export const GetMarketResponseSchema = z.object({
  market: MarketResourceSchema,
  /**
   * Cross-endpoint dual-key alias: identical to `market` when present.
   * Optional in the SDK schema so the parser is forward-compatible with
   * proxies that strip unknown extras and backward-compatible with the
   * pre-alias wire shape. The drift gate enforces server-side parity:
   * the public API emits this on every response.
   */
  data: MarketResourceSchema.optional(),
  _meta: MetaSchema,
});

export type GetMarketResponse = z.infer<typeof GetMarketResponseSchema>;

// -----------------------------------------------------------------
// GET /v1/markets/{id}/predictions — recent trades against a market
// -----------------------------------------------------------------

/**
 * One row in a market's recent-trade feed. Surfaces enough signal to
 * render a "live activity" UI without a second call:
 *
 *   - `side` + `outcomeIndex` — what was traded
 *   - `usdcIn` / `usdcOut` — exactly one is non-null (atomic USDC, 6dp)
 *   - `tokensIn` / `tokensOut` — exactly one is non-null (WAD, 18dp)
 *   - `price` — spot price after the trade (decimal string)
 *   - `probability` — outcome probability after the trade (0..1, decimal)
 *   - `timestamp`, `blockNumber`, `transactionHash`, `logIndex` — chain locator
 *
 * Trader / org metadata is intentionally omitted — the v1 endpoint
 * doesn't surface cross-tenant identity.
 */
export const PredictionResourceSchema = z.object({
  /** Trade row id. Stable; opaque to consumers. */
  id: z.string(),
  marketId: z.string().uuid(),
  outcomeIndex: z.number().int().nonnegative(),
  side: z.enum(['buy', 'sell']),
  /** Atomic USDC paid in (buys only); null on sells. */
  usdcIn: z.string().nullable(),
  /** Atomic USDC paid out (sells only); null on buys. */
  usdcOut: z.string().nullable(),
  /** WAD outcome tokens spent (sells only); null on buys. */
  tokensIn: z.string().nullable(),
  /** WAD outcome tokens received (buys only); null on sells. */
  tokensOut: z.string().nullable(),
  /** Spot price per outcome token after the trade (decimal string). */
  price: z.string(),
  /** Outcome probability after the trade — `[0, 1]` decimal string. */
  probability: z.string(),
  /** Block timestamp in ISO 8601. */
  timestamp: z.string().datetime(),
  blockNumber: z.string(),
  transactionHash: z.string(),
  logIndex: z.number().int().nonnegative(),
});

export type PredictionResource = z.infer<typeof PredictionResourceSchema>;

/** Query params for `GET /v1/markets/{id}/predictions`. */
export type ListPredictionsParams = {
  readonly cursor?: string;
  /** Page size; capped at 100. Default 50. */
  readonly limit?: number;
  /** Filter to a single side. */
  readonly side?: 'buy' | 'sell';
  /** Filter to a single outcome. */
  readonly outcomeIndex?: number;
};

export const ListPredictionsResponseSchema = z.object({
  data: z.array(PredictionResourceSchema),
  pagination: PaginationSchema,
  _meta: MetaSchema,
});

export type ListPredictionsResponse = z.infer<typeof ListPredictionsResponseSchema>;
