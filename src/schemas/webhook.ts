/**
 * Webhook endpoint schemas — mirror the response shapes of
 * `POST /v1/webhooks/events/{id}/redeliver` and
 * `POST /v1/auth/api-keys/me/webhook-secret/rotate`.
 */

import { z } from 'zod';

import { MetaSchema, PaginationSchema } from './common.js';

export const RedeliverWebhookEventSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  apiKeyId: z.string().uuid(),
  tradeRequestId: z.string().uuid().nullable(),
  emittedAt: z.string().datetime(),
  lastDeliveredAt: z.string().datetime().nullable(),
  deliveryAttempts: z.number().int().nonnegative(),
});

export type RedeliverWebhookEvent = z.infer<typeof RedeliverWebhookEventSchema>;

export const RedeliverWebhookResponseSchema = z.object({
  event: RedeliverWebhookEventSchema,
  /**
   * Cross-endpoint dual-key alias: identical to `event` when present.
   * Optional in the SDK schema for forward/backward compatibility;
   * the drift gate enforces server-side parity.
   */
  data: RedeliverWebhookEventSchema.optional(),
  _meta: MetaSchema.extend({ message: z.string() }),
});

export type RedeliverWebhookResponse = z.infer<typeof RedeliverWebhookResponseSchema>;

const WebhookSecretSchema = z.object({
  secret: z.string(),
  rotatedAt: z.string().datetime(),
  previousRetainedUntil: z.string().datetime(),
});

export const RotateWebhookSecretResponseSchema = z.object({
  webhookSecret: WebhookSecretSchema,
  /**
   * Cross-endpoint dual-key alias: identical to `webhookSecret` when
   * present. Optional in the SDK schema for forward/backward
   * compatibility; the drift gate enforces server-side parity.
   */
  data: WebhookSecretSchema.optional(),
  _meta: MetaSchema.extend({ message: z.string() }),
});

export type RotateWebhookSecretResponse = z.infer<typeof RotateWebhookSecretResponseSchema>;

/**
 * One row of the webhook-events feed served by `GET /v1/webhooks/events`
 * (DX6 — customer inspector). The `delivery` block carries the same
 * shape the SDK already exposes on a trade resource's `webhookDelivery`
 * field, so consumers can render either source through one component.
 *
 * `status` is a coarse derivation of the underlying delivery columns:
 *   - `none`       — outbox emit hasn't landed yet (orphan candidate)
 *   - `pending`    — staged, no attempt yet
 *   - `retrying`   — attempts > 0, no terminal failure, no success
 *   - `delivered`  — at least one attempt returned 2xx
 *   - `failed`     — terminal failure; no further auto-retry
 */
export const WebhookEventResourceSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  tradeRequestId: z.string().uuid().nullable(),
  emittedAt: z.string().datetime(),
  outboxEmittedAt: z.string().datetime().nullable(),
  replayCount: z.number().int().nonnegative(),
  status: z.enum(['none', 'pending', 'delivered', 'retrying', 'failed']),
  delivery: z.object({
    attempts: z.number().int().nonnegative(),
    lastAttemptedAt: z.string().datetime().nullable(),
    lastDeliveredAt: z.string().datetime().nullable(),
    lastStatusCode: z.number().int().nullable(),
    lastFailureCode: z.string().nullable(),
    lastErrorMessage: z.string().nullable(),
    terminalFailureAt: z.string().datetime().nullable(),
  }),
});

export type WebhookEventResource = z.infer<typeof WebhookEventResourceSchema>;

export const ListWebhookEventsResponseSchema = z.object({
  data: z.array(WebhookEventResourceSchema),
  pagination: PaginationSchema,
  _meta: MetaSchema,
});

export type ListWebhookEventsResponse = z.infer<typeof ListWebhookEventsResponseSchema>;
