/**
 * Trade schemas — the wire shapes for the `/v1/trades` resource.
 *
 * The trade resource is the most important type in the SDK — every
 * consumer mutation path produces it. `status` is the discriminated
 * union the consumer branches on for pollers and UI:
 * `pending_confirmation` | `pending` | `validating` | `executing` |
 * `completed` | `failed` | `rejected`.
 */

import { z } from 'zod';

import { MetaSchema, PaginationSchema } from './common.js';

/**
 * USDC amount as a human-readable decimal string. Mirrors the regex
 * the server enforces via `usdcAmountSchema` so consumers fail fast
 * client-side rather than waiting for a 400.
 */
export const UsdcAmountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, 'Must be a USDC decimal with up to 6 fractional digits');

export type UsdcAmount = z.infer<typeof UsdcAmountSchema>;

/** Optional consumer-supplied idempotency token at the body level. */
export const ClientRequestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_\-:.]+$/, 'Allowed: letters, digits, _ - : .');

export type ClientRequestId = z.infer<typeof ClientRequestIdSchema>;

export const TradeStatusSchema = z.enum([
  'pending_confirmation',
  'pending',
  'validating',
  'executing',
  'completed',
  'failed',
  'rejected',
]);
export type TradeStatus = z.infer<typeof TradeStatusSchema>;

/** The terminal statuses for a trade — `waitForCompletion` polls for these. */
export const TERMINAL_TRADE_STATUSES: readonly TradeStatus[] = [
  'completed',
  'failed',
  'rejected',
] as const;

export const TradeSideSchema = z.enum(['buy', 'sell']);
export type TradeSide = z.infer<typeof TradeSideSchema>;

/**
 * Customer-supplied tags attached to a trade (DX #1, Stripe-pattern).
 *
 * Constraints (mirror the server-side schema):
 *   - Max 10 keys.
 *   - Keys: 1-64 chars, `[a-zA-Z0-9_\-.]` only.
 *   - Values: strings, max 500 chars.
 *
 * Echoed back through every webhook payload so customer handlers can
 * branch (`strategy=momentum-v2`, `cohort=beta`, …) without refetching.
 */
export const TradeMetadataSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_\-.]+$/, 'Allowed: letters, digits, _ - .'),
    z.string().max(500)
  )
  .refine((m) => Object.keys(m).length <= 10, { message: 'metadata: max 10 keys' });

export type TradeMetadata = z.infer<typeof TradeMetadataSchema>;

// -----------------------------------------------------------------
// POST /v1/trades — create
// -----------------------------------------------------------------

export const CreateTradeBodySchema = z
  .object({
    marketId: z.string().uuid(),
    outcomeIndex: z.number().int().nonnegative(),
    amount: UsdcAmountSchema,
    side: TradeSideSchema,
    clientRequestId: ClientRequestIdSchema.optional(),
    /** DX #1: customer-supplied tags echoed in the trade row + every webhook. */
    metadata: TradeMetadataSchema.optional(),
  })
  .strict();

export type CreateTradeBody = z.infer<typeof CreateTradeBodySchema>;

export const TradeResourceSchema = z.object({
  id: z.string().uuid(),
  marketId: z.string().uuid(),
  outcomeIndex: z.number().int().nonnegative(),
  amount: UsdcAmountSchema,
  side: TradeSideSchema,
  status: TradeStatusSchema,
  correlationId: z.string().uuid(),
  clientRequestId: ClientRequestIdSchema.nullable(),
  /**
   * Self-describing chain identity of the trade's market — `"evm:8453"`,
   * `"solana:mainnet-beta"`.
   *
   * Sent from API version `2026-08-19` onward and ABSENT on earlier versions,
   * which is why it is optional rather than nullable: an older-version
   * response does not carry the key at all. This resource never had a numeric
   * `chainId`, so nothing is replaced.
   */
  chainRef: z.string().optional(),
  /**
   * An EVM hash OR a base58 Solana signature. See the note on
   * `webhook-event.ts`; the alphabet is checked, the length deliberately not.
   *
   * **`null` for every Solana trade, on every API version, even once
   * `completed`.** The trade resource publishes only EVM transaction hashes
   * today. The `trade.completed` webhook carries the real Solana signature, so
   * a consumer that needs it should read it there.
   *
   * The response IS parsed through this schema, so the old `0x`-only pattern
   * was inert only because the API sends `null` here for Solana trades. It
   * still described a wire shape the API does not have: measured 2026-09-13,
   * `api_trade_requests` held 83 completed Solana trades.
   */
  txHash: z
    .string()
    .regex(
      /^(?:0x[a-fA-F0-9]{64}|[1-9A-HJ-NP-Za-km-z]+)$/,
      'must be an EVM transaction hash or a base58 Solana signature'
    )
    .nullable(),
  tokensOut: z.string().regex(/^\d+$/).nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /**
   * Coarse webhook-delivery state for this trade. `null` when no
   * webhook subscription exists for the API key that placed the trade.
   *
   * Status meanings:
   *   - `none`           — no webhook event was staged for this trade.
   *   - `pending`        — staged, no delivery attempt yet.
   *   - `delivered`      — at least one attempt returned 2xx.
   *   - `retrying`       — attempts so far failed; more are scheduled.
   *   - `failed`         — terminal failure. Use `webhooks.redeliver()`
   *                        after fixing the endpoint or rotating its URL.
   */
  webhookDelivery: z
    .object({
      status: z.enum(['none', 'pending', 'delivered', 'retrying', 'failed']),
      /** Total attempts (success + failure) so far. */
      attempts: z.number().int().nonnegative(),
      /** ISO 8601 timestamp of the most recent attempt; `null` if none. */
      lastAttemptedAt: z.string().datetime().nullable(),
      /** Last HTTP status from the customer endpoint; `null` on network errors. */
      lastStatusCode: z.number().int().nullable(),
      /**
       * Stable token describing the most recent failure (`http_4xx`,
       * `http_5xx`, `circuit_open`, `timeout`, `url_validation_failed`,
       * `terminal_client_error`, …). `null` when the last attempt
       * succeeded or no attempt has run.
       */
      lastFailureCode: z.string().nullable(),
      /** ISO 8601 timestamp of terminal failure; `null` until terminal. */
      terminalFailureAt: z.string().datetime().nullable(),
    })
    .nullable(),
  /**
   * DX #1: customer-supplied tags. Always present (defaults to `{}`
   * server-side); echoed on every read and through every webhook payload.
   *
   * Uses the plain record shape (not `TradeMetadataSchema`) for the
   * read side — the size + key-format constraints are write-only; reads
   * trust whatever the API returned.
   */
  metadata: z.record(z.string(), z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TradeResource = z.infer<typeof TradeResourceSchema>;

/** Response envelope returned by the public API on `201 Created`. */
export const CreateTradeCreatedResponseSchema = z.object({
  trade: TradeResourceSchema,
  /**
   * Cross-endpoint dual-key alias: identical to `trade` when present.
   * Optional in the SDK schema for forward/backward compatibility;
   * the drift gate enforces server-side parity.
   */
  data: TradeResourceSchema.optional(),
  _meta: MetaSchema.extend({ idempotent: z.boolean() }),
});

export type CreateTradeCreatedResponse = z.infer<typeof CreateTradeCreatedResponseSchema>;

/** Response envelope returned for high-value trades on `202 Accepted`. */
export const CreateTradeAcceptedResponseSchema = z.object({
  trade: TradeResourceSchema,
  /** Dual-key alias — see `CreateTradeCreatedResponseSchema`. */
  data: TradeResourceSchema.optional(),
  confirmation: z.object({
    token: z.string().min(40).max(64),
    expiresAt: z.string().datetime(),
  }),
  _meta: MetaSchema.extend({ idempotent: z.boolean() }),
});

export type CreateTradeAcceptedResponse = z.infer<typeof CreateTradeAcceptedResponseSchema>;

/**
 * The SDK exposes `trades.create()` returning a discriminated union —
 * the response either has `confirmation` (high-value gate) or it
 * doesn't (immediate execution). Consumers branch on the presence of
 * `confirmation`, NOT on a separate type tag.
 */
export const CreateTradeResponseSchema = z.union([
  CreateTradeAcceptedResponseSchema,
  CreateTradeCreatedResponseSchema,
]);

export type CreateTradeResponse = z.infer<typeof CreateTradeResponseSchema>;

// -----------------------------------------------------------------
// POST /v1/trades/{id}/confirm
// -----------------------------------------------------------------

export const ConfirmTradeBodySchema = z
  .object({
    token: z.string().min(40).max(64),
  })
  .strict();

export type ConfirmTradeBody = z.infer<typeof ConfirmTradeBodySchema>;

export const ConfirmTradeResponseSchema = z.object({
  trade: TradeResourceSchema,
  /** Dual-key alias — see `CreateTradeCreatedResponseSchema`. */
  data: TradeResourceSchema.optional(),
  _meta: MetaSchema,
});

export type ConfirmTradeResponse = z.infer<typeof ConfirmTradeResponseSchema>;

// -----------------------------------------------------------------
// GET /v1/trades — list
// -----------------------------------------------------------------

export type ListTradesParams = {
  readonly cursor?: string;
  readonly limit?: number;
  /** Comma-separated status filter, e.g. `'pending,completed'`. */
  readonly status?: string;
  readonly marketId?: string;
};

export const ListTradesResponseSchema = z.object({
  data: z.array(TradeResourceSchema),
  pagination: PaginationSchema,
  _meta: MetaSchema,
});

export type ListTradesResponse = z.infer<typeof ListTradesResponseSchema>;

// -----------------------------------------------------------------
// GET /v1/trades/{id}
// -----------------------------------------------------------------

export const GetTradeResponseSchema = z.object({
  trade: TradeResourceSchema,
  /** Dual-key alias — see `CreateTradeCreatedResponseSchema`. */
  data: TradeResourceSchema.optional(),
  _meta: MetaSchema,
});

export type GetTradeResponse = z.infer<typeof GetTradeResponseSchema>;
