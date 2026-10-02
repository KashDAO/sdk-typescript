/**
 * Portfolio schemas — the wire shapes for `GET /v1/portfolio` and
 * `GET /v1/portfolio/positions`. Validated end-to-end via Zod.
 */

import { z } from 'zod';

import { MetaSchema } from './common.js';

export const PositionResourceSchema = z.object({
  marketId: z.string().uuid(),
  outcomeIndex: z.number().int().nonnegative(),
  /** WAD-encoded outcome-token balance (integer string). */
  shares: z.string().regex(/^\d+$/),
  /** Cost basis paid in atomic USDC (integer string). */
  costBasisAtomic: z.string().regex(/^\d+$/),
  tradeCount: z.number().int().nonnegative(),
  firstTradeAt: z.string().datetime(),
  lastTradeAt: z.string().datetime(),
});

export type PositionResource = z.infer<typeof PositionResourceSchema>;

export const PositionsResponseSchema = z.object({
  data: z.array(PositionResourceSchema),
  _meta: MetaSchema,
});

export type PositionsResponse = z.infer<typeof PositionsResponseSchema>;

export const PortfolioSummarySchema = z.object({
  /**
   * The address that holds the key owner's funds. Despite the name it is not
   * always an EVM smart account: for a user whose funds live on Solana it is
   * their base58 Solana wallet address. Treat it as an opaque chain address
   * and do not assume a `0x` prefix.
   */
  smartAccountAddress: z.string(),
  activePositions: z.number().int().nonnegative(),
  totalCostBasisAtomic: z.string().regex(/^\d+$/),
});

export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;

export const PortfolioSummaryResponseSchema = z.object({
  portfolio: PortfolioSummarySchema,
  /**
   * Cross-endpoint dual-key alias: identical to `portfolio` when present.
   * Optional in the SDK schema for forward/backward compatibility; the
   * drift gate enforces server-side parity.
   */
  data: PortfolioSummarySchema.optional(),
  _meta: MetaSchema,
});

export type PortfolioSummaryResponse = z.infer<typeof PortfolioSummaryResponseSchema>;
