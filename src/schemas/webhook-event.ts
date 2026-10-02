/**
 * Webhook **event payload** schemas — the JSON body the
 * `apps/public-api-webhook-delivery-worker` POSTs to a customer's endpoint.
 *
 * Distinct from the schemas in `webhook.ts`:
 *
 *   - `webhook.ts` covers the *management* surface
 *     (`/v1/webhooks/events`, redeliver, rotate-secret).
 *   - This file covers the *delivery* surface — the body the customer
 *     receives + verifies + handles.
 *
 * Mirrors `apps/public-api/src/schemas/webhook-payloads.ts` exactly;
 * the API drift gate fails CI when either side moves without the
 * other.
 *
 * Stripe pattern. Use {@link WebhookEventSchema} to parse + narrow:
 *
 * @example
 * ```ts
 * import { WebhookEventSchema } from '@kashdao/sdk';
 *
 * const event = WebhookEventSchema.parse(JSON.parse(rawBody));
 * if (event.type === 'trade.completed') {
 *   // event.data.txHash — an EVM hash or a base58 Solana signature
 *   // event.data.chainRef — "evm:8453", "solana:mainnet-beta"
 * }
 * ```
 *
 * Or use {@link WebhooksClient.constructEvent} to verify + parse in
 * one call — the canonical helper.
 */

import { z } from 'zod';

// -----------------------------------------------------------------
// Common fields shared by every trade.* event payload.
// -----------------------------------------------------------------

const tradeWebhookCommonSchema = z.object({
  tradeId: z.string().uuid(),
  marketId: z.string().uuid(),
  /**
   * Self-describing chain identity of the trade's market — `"evm:8453"`,
   * `"solana:mainnet-beta"`.
   *
   * A webhook is pushed, so it carries no version header to negotiate with:
   * the server sends `chainRef` on every trade webhook whatever version the
   * key pins. Optional because an event enqueued before the field existed can
   * still be delivered after it, and a required field would reject it.
   */
  chainRef: z.string().optional(),
  outcomeIndex: z.number().int().nonnegative(),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  side: z.enum(['buy', 'sell']),
  /**
   * Customer-supplied tags from `trades.create({ metadata })`. Always
   * present (defaults to `{}` server-side); echoed on every webhook so
   * handlers can branch (`metadata.strategy === 'momentum-v2'`)
   * without re-fetching the trade.
   */
  metadata: z.record(z.string(), z.string()),
});

// -----------------------------------------------------------------
// Per-event payload shapes (the value of `event.data`).
// -----------------------------------------------------------------

export const TradeConfirmationRequiredPayloadSchema = tradeWebhookCommonSchema.extend({
  status: z.literal('pending_confirmation'),
  /** ISO 8601; the trade auto-cancels after this if confirmation isn't POST'd. */
  confirmationExpiresAt: z.string().datetime(),
});

export type TradeConfirmationRequiredPayload = z.infer<
  typeof TradeConfirmationRequiredPayloadSchema
>;

export const TradeCompletedPayloadSchema = tradeWebhookCommonSchema.extend({
  status: z.literal('completed'),
  /**
   * Chain transaction id — an EVM hash (`0x` + 64 hex) OR a base58 Solana
   * signature.
   *
   * This carried `/^0x[a-fA-F0-9]{64}$/` until 2026-09-13, which describes one
   * of the two chains the API already serves: measured that day it held 83
   * completed Solana trades, whose ids are base58 and share no character class
   * with the hex form. Since this schema PARSES the payload in the customer's
   * own process — `WebhookEventSchema.parse`, or `constructEvent` — that
   * pattern would not have mis-documented a Solana trade, it would have THROWN
   * inside their webhook handler.
   *
   * The base58 branch checks the ALPHABET and deliberately not the length. A
   * signature is 64 bytes, but base58 renders leading zero bytes as `1`s that
   * carry no magnitude, so its output length is not fixed and any bound here
   * would invent a limit the chain does not have. The alphabet alone is enough
   * to keep this a real constraint — it excludes `0`, `O`, `I` and `l`, and
   * rejects anything with a separator in it.
   *
   * A SHAPE check, not a validity one: `constructEvent` has already verified
   * the HMAC, so the bytes are authenticated before they reach this schema.
   * Verifying that a signature is well-formed 64 bytes needs a base58 decoder,
   * and this package has exactly one dependency (`zod`) by design.
   */
  txHash: z
    .string()
    .regex(
      /^(?:0x[a-fA-F0-9]{64}|[1-9A-HJ-NP-Za-km-z]+)$/,
      'must be an EVM transaction hash or a base58 Solana signature'
    ),
  /** WAD-encoded outcome tokens received (integer string). */
  tokensOut: z.string().regex(/^\d+$/),
});

export type TradeCompletedPayload = z.infer<typeof TradeCompletedPayloadSchema>;

export const TradeFailedPayloadSchema = tradeWebhookCommonSchema.extend({
  status: z.literal('failed'),
  /** Stable machine-readable code from the same catalog as route errors. */
  errorCode: z.string().min(1),
  /** Sanitised human-readable message — no stack traces, no DB strings. */
  errorMessage: z.string().min(1),
});

export type TradeFailedPayload = z.infer<typeof TradeFailedPayloadSchema>;

/**
 * `trade.rejected` — risk engine declined the trade pre-execution.
 *
 * Distinct from `trade.failed` (which covers on-chain/RPC failures
 * after submission). Rejection happens BEFORE the trade was ever
 * submitted on-chain, so there is no `txHash`. Customers can branch
 * on `status` to render rejection-specific UX. Shape mirrors
 * `trade.failed` deliberately so `errorCode` / `errorMessage`
 * rendering can be shared.
 */
export const TradeRejectedPayloadSchema = tradeWebhookCommonSchema.extend({
  status: z.literal('rejected'),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
});

export type TradeRejectedPayload = z.infer<typeof TradeRejectedPayloadSchema>;

// -----------------------------------------------------------------
// Outer envelope — every customer-facing webhook body has this shape.
// -----------------------------------------------------------------

/**
 * The discriminated union of every webhook event the SDK recognises.
 * `event.type` narrows `event.data` to the matching payload.
 *
 * The envelope's `id` field is also returned in the `X-Kash-Event-Id`
 * header — dedupe on it to make repeated deliveries (and operator-
 * triggered redeliveries) safe.
 */
export const WebhookEventSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().uuid(),
    type: z.literal('trade.confirmation-required'),
    apiVersion: z.string(),
    createdAt: z.string().datetime(),
    data: TradeConfirmationRequiredPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal('trade.completed'),
    apiVersion: z.string(),
    createdAt: z.string().datetime(),
    data: TradeCompletedPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal('trade.failed'),
    apiVersion: z.string(),
    createdAt: z.string().datetime(),
    data: TradeFailedPayloadSchema,
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal('trade.rejected'),
    apiVersion: z.string(),
    createdAt: z.string().datetime(),
    data: TradeRejectedPayloadSchema,
  }),
]);

/**
 * The wire shape of a webhook delivery body. Use the typed
 * discriminator (`event.type`) to narrow `event.data`.
 */
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

/** The string literal type of every webhook event the SDK knows about. */
export type WebhookEventType = WebhookEvent['type'];
