/**
 * Redemption schemas — the wire shapes for `POST /v1/redemptions`.
 *
 * Redeeming is how a settled position turns back into USDC. When a market
 * resolves (or is cancelled), the holder's outcome tokens stay where they are
 * until a redemption is requested; nothing claims them automatically. One
 * request redeems one (market, outcome) position, Base or Solana alike.
 */

import { z } from 'zod';

import { MetaSchema } from './common.js';

/**
 * Body for `redemptions.create()`. Mirrors the server's strict schema, so a
 * typo'd key fails client-side instead of after a round trip.
 *
 * `outcomeIndex` is required: a resolved market has one winning outcome, but a
 * cancelled market may refund several, and one request means one redemption.
 */
export const CreateRedemptionBodySchema = z
  .object({
    marketId: z.string().uuid(),
    outcomeIndex: z.number().int().min(0).max(255),
  })
  .strict();

export type CreateRedemptionBody = z.infer<typeof CreateRedemptionBodySchema>;

/** `resolved` redeems a winning outcome; `cancelled` refunds a cancelled market. */
export const RedemptionKindSchema = z.enum(['resolved', 'cancelled']);

export type RedemptionKind = z.infer<typeof RedemptionKindSchema>;

export const RedemptionResourceSchema = z.object({
  id: z.string().uuid(),
  marketId: z.string().uuid(),
  outcomeIndex: z.number().int().min(0).max(255),
  kind: RedemptionKindSchema,
  /** WAD-encoded (18-decimal) outcome-token balance being redeemed, as an integer string. */
  sharesWad: z.string(),
  /**
   * Pipeline status of the request — `pending` on creation. The payout is
   * executed asynchronously after the request is accepted.
   */
  status: z.string(),
});

export type RedemptionResource = z.infer<typeof RedemptionResourceSchema>;

/**
 * Response envelope for `POST /v1/redemptions` — `201` for a new request,
 * `200` with `_meta.idempotent: true` when the position already has one.
 */
export const CreateRedemptionResponseSchema = z.object({
  redemption: RedemptionResourceSchema,
  /** Cross-endpoint dual-key alias: identical to `redemption` when present. */
  data: RedemptionResourceSchema.optional(),
  _meta: MetaSchema.extend({ idempotent: z.boolean() }),
});

export type CreateRedemptionResponse = z.infer<typeof CreateRedemptionResponseSchema>;
