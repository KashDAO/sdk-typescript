/**
 * Account-scoped endpoints — currently just `GET /v1/account/usage`.
 * Per-key telemetry summary the webapp Settings page renders inline
 * (DX7).
 */

import { z } from 'zod';

import { MetaSchema } from './common.js';

const tradeWindowSchema = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Completed / total. `null` when `total === 0` (no division by zero in JSON). */
  successRate: z.number().min(0).max(1).nullable(),
});

const tradeWindowWithLatencySchema = tradeWindowSchema.extend({
  latencyMs: z.object({
    p50: z.number().int().nullable(),
    p99: z.number().int().nullable(),
  }),
});

export const AccountUsageSchema = z.object({
  apiKeyId: z.string().uuid(),
  /** Server timestamp at query time. */
  generatedAt: z.string().datetime(),
  trades: z.object({
    '24h': tradeWindowWithLatencySchema,
    '7d': tradeWindowSchema,
    '30d': tradeWindowSchema,
  }),
  webhooks: z.object({
    '7d': z.object({
      emitted: z.number().int().nonnegative(),
      delivered: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      successRate: z.number().min(0).max(1).nullable(),
    }),
  }),
  auth: z.object({
    '24h': z.object({
      failures: z.number().int().nonnegative(),
      rateLimitRejections: z.number().int().nonnegative(),
    }),
  }),
});

export type AccountUsage = z.infer<typeof AccountUsageSchema>;

export const AccountUsageResponseSchema = z.object({
  data: AccountUsageSchema,
  _meta: MetaSchema,
});

export type AccountUsageResponse = z.infer<typeof AccountUsageResponseSchema>;
