/**
 * Webhook endpoint schemas — mirror the response shapes of
 * `POST /v1/webhooks/events/{id}/redeliver` and
 * `POST /v1/auth/api-keys/me/webhook-secret/rotate`.
 */

import { z } from 'zod';

import { openEnum } from './_open-enum.js';
import { MetaSchema, PaginationSchema } from './envelope.js';

export const RedeliverWebhookEventSchema = z.object({
  id: z.guid(),
  eventType: z.string(),
  apiKeyId: z.guid(),
  tradeRequestId: z.guid().nullable(),
  emittedAt: z.iso.datetime(),
  lastDeliveredAt: z.iso.datetime().nullable(),
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
  rotatedAt: z.iso.datetime(),
  previousRetainedUntil: z.iso.datetime(),
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
 * (the customer webhook inspector). The `delivery` block carries the same
 * shape the SDK already exposes on a trade resource's `webhookDelivery`
 * field, so consumers can render either source through one component.
 *
 * `status` is a coarse derivation of the underlying delivery columns:
 *   - `none`       — the event has not been staged for delivery yet
 *   - `pending`    — staged, no attempt yet
 *   - `retrying`   — attempts > 0, no terminal failure, no success
 *   - `delivered`  — at least one attempt returned 2xx
 *   - `failed`     — terminal failure; no further auto-retry
 */
export const WebhookEventResourceSchema = z.object({
  id: z.guid(),
  eventType: z.string(),
  tradeRequestId: z.guid().nullable(),
  emittedAt: z.iso.datetime(),
  outboxEmittedAt: z.iso.datetime().nullable(),
  replayCount: z.number().int().nonnegative(),
  status: openEnum(['none', 'pending', 'delivered', 'retrying', 'failed']),
  delivery: z.object({
    attempts: z.number().int().nonnegative(),
    lastAttemptedAt: z.iso.datetime().nullable(),
    lastDeliveredAt: z.iso.datetime().nullable(),
    lastStatusCode: z.number().int().nullable(),
    lastFailureCode: z.string().nullable(),
    lastErrorMessage: z.string().nullable(),
    terminalFailureAt: z.iso.datetime().nullable(),
  }),
});

export type WebhookEventResource = z.infer<typeof WebhookEventResourceSchema>;

export const ListWebhookEventsResponseSchema = z.object({
  data: z.array(WebhookEventResourceSchema),
  pagination: PaginationSchema,
  _meta: MetaSchema,
});

export type ListWebhookEventsResponse = z.infer<typeof ListWebhookEventsResponseSchema>;
