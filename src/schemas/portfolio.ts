/**
 * Portfolio schemas — the wire shapes for `GET /v1/portfolio`,
 * `GET /v1/portfolio/positions` and `GET /v1/portfolio/claimable`. Validated
 * end-to-end via Zod.
 */

import { z } from 'zod';

import { openEnum } from './_open-enum.js';
import { MetaSchema } from './envelope.js';

export const PositionResourceSchema = z.object({
  marketId: z.guid(),
  outcomeIndex: z.number().int().nonnegative(),
  /** WAD-encoded outcome-token balance (integer string). */
  shares: z.string().regex(/^\d+$/),
  /** Cost basis paid in atomic USDC (integer string). */
  costBasisAtomic: z.string().regex(/^\d+$/),
  tradeCount: z.number().int().nonnegative(),
  firstTradeAt: z.iso.datetime(),
  lastTradeAt: z.iso.datetime(),
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

/**
 * One position the account can claim now with `POST /v1/redemptions`
 * (`redemptions.create`): a winning outcome of a resolved market, or a
 * holding in a cancelled market refunded at the cancel price.
 */
export const ClaimablePositionResourceSchema = z.object({
  /** With `outcomeIndex`, what to send to `redemptions.create`. */
  marketId: z.guid(),
  outcomeIndex: z.number().int().nonnegative(),
  /** `resolved`: a winning outcome. `cancelled`: a refund at the cancel price. */
  kind: openEnum(['resolved', 'cancelled']),
  /**
   * Outcome tokens the claim redeems, WAD-encoded (18 decimals) integer
   * string: the on-chain balance when it was read, else the indexed holding.
   */
  shares: z.string().regex(/^\d+$/),
  /**
   * USDC atomic units (6 decimals): the chain's quote for the claim, a minimum
   * of what it pays before the network fee, so show it as "about". `null`
   * when the quote could not be read (`quoteStatus: 'unavailable'`), never 0.
   */
  quotedAmountAtomic: z.string().regex(/^\d+$/).nullable(),
  quoteStatus: openEnum(['quoted', 'unavailable']),
  /**
   * `claimable`; `claim_failed` when an earlier claim for this position
   * failed in a way a new claim cannot replace: send the user to support
   * rather than offering a claim; or `claims_paused` when Kash has paused
   * claiming, so `redemptions.create` would refuse every claim now: show the
   * amount, offer no claim, and list again later. `claims_paused` takes
   * precedence over the other two.
   */
  claimStatus: openEnum(['claimable', 'claim_failed', 'claims_paused']),
});

export type ClaimablePositionResource = z.infer<typeof ClaimablePositionResourceSchema>;

export const ClaimablePositionsResponseSchema = z.object({
  data: z.array(ClaimablePositionResourceSchema),
  _meta: MetaSchema,
});

export type ClaimablePositionsResponse = z.infer<typeof ClaimablePositionsResponseSchema>;
