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
 *   // event.data.txHash, event.data.tokensOut — both typed string
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
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
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
