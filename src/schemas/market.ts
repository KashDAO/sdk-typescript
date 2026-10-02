/**
 * Market schemas — the wire shapes for `GET /v1/markets` and
 * `GET /v1/markets/{id}`.
 *
 * Validated end-to-end via Zod. The contract test in
 * `tests/contract/wire-shape.test.ts` asserts these schemas accept
 * the API's actual response payloads; drift fails CI.
 */

import { z } from 'zod';

import { publicChainIdSchema } from './_chain.js';
import { MetaSchema, PaginationSchema } from './common.js';

export const MarketStatusSchema = z.enum(['UNSEEDED', 'ACTIVE', 'RESOLVED', 'ABANDONED']);
export type MarketStatus = z.infer<typeof MarketStatusSchema>;

export const MarketOutcomeSchema = z.object({
  index: z.number().int().nonnegative(),
  label: z.string(),
  probability: z.number().min(0).max(1),
});

export type MarketOutcome = z.infer<typeof MarketOutcomeSchema>;

export const MarketResolutionStateSchema = z.enum([
  'resolving',
  'proposed',
  'settling',
  'resolved',
  'cancelled',
]);
export type MarketResolutionState = z.infer<typeof MarketResolutionStateSchema>;

export const MarketResourceSchema = z.object({
  id: z.string().uuid(),
  contractAddress: z.string(),
  /**
   * OPTIONAL from 0.2.0 (a required `number` through 0.1.5).
   *
   * From API version 2026-08-19 the market resource omits `chainId` for a
   * non-EVM market and carries {@link chainRef} instead: a surrogate chain id
   * has no meaning to an external consumer, so the key is ABSENT rather than
   * holding a number that lies. 0.2.0 pins that version, so a Solana market
   * arrives without `chainId`. The older `2026-04-29` never serves such a
   * market, which is why the 0.1.x line could keep the field required.
   *
   * `publicChainIdSchema` still refuses the internal surrogate ids.
   */
  chainId: publicChainIdSchema.optional(),
  /**
   * Chain-neutral identifier (`evm:8453`, `solana:devnet`). Present from API
   * version 2026-08-19 onward on every market, whatever its family. Optional
   * for the same reason `chainId` is: on the canonical version the key is
   * missing, not empty.
   */
  chainRef: z.string().optional(),
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
  // Dispute-window settlement state ("Ended — proposed outcome X — dispute
  // window ends at T"). Null when the market has no pending proposal.
  // Optional for the same forward-compat reason as `freezeAt`: an API
  // deployment older than the dispute-window feature omits the key entirely.
  resolution: z
    .object({
      proposedOutcomeIndex: z.number().int().nonnegative(),
      proposedAt: z.string().datetime().nullable(),
      finalizableAt: z.string().datetime().nullable(),
      settlementStatus: z.enum(['proposed', 'disputed', 'finalized', 'cancelled']),
      disputeOpen: z.boolean(),
    })
    .nullable()
    .optional(),
  /**
   * The market's coarse, user-facing resolution state: `resolving` means the
   * market has ended and its outcome is being determined, `proposed` that an
   * outcome is proposed and the dispute window is open, `settling` that the
   * outcome is decided and being written on-chain. It never says who is
   * resolving the market. Null before expiry. Optional for the same forward-compat reason as
   * `freezeAt`: an API deployment older than the field omits the key.
   */
  resolutionState: MarketResolutionStateSchema.nullable().optional(),
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
  /**
   * EVM log index within the transaction. **NULL ON A NON-EVM CHAIN**, because
   * there is no such thing to report.
   *
   * Measured on staging 2026-09-13, the same market feed on both lanes:
   *
   * | field | evm:84532 | solana:devnet |
   * | --- | --- | --- |
   * | `transactionHash` | `0x952c…cd49` | `4PuVtUZx…86rRQ` (base58 signature) |
   * | `logIndex` | `91` | **`null`** |
   * | `id` | `0x952c…cd49-91` | `4PuVtUZx…86rRQ-2-1` |
   *
   * A Solana trade is located by (signature, instruction index, inner index),
   * which the row `id` already carries; an EVM log index has no counterpart, so
   * the honest answer is null rather than a fabricated zero. **Zero would be
   * WORSE than null**: it is a legal EVM log index, so it would collide with a
   * real first-log-in-transaction trade and be indistinguishable from one.
   *
   * This was REQUIRED on both the API and the SDK until 2026-09-13 while the
   * API served null anyway, so the contract was already violated by its own
   * data and only the SDK's parse ever said so — `Response schema mismatch:
   * data.0.logIndex: Expected number, received null`, which stopped the
   * trading fleet from building a snapshot for either Solana market.
   */
  logIndex: z.number().int().nonnegative().nullable(),
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
