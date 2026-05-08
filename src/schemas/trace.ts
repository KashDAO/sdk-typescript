/**
 * Trace schemas — the wire shapes for `GET /v1/traces/:correlationId`.
 *
 * A trace is the curated event timeline tied to a correlation id —
 * the identifier that links every event a trade emits across the
 * pipeline (intent parsing → funding → bridge → execution → webhook
 * delivery). Server-side sanitizers produce this shape from raw
 * event-store rows; the SDK validates the wire payload against this
 * schema before handing it to the consumer.
 *
 * **Stability.** `TraceEvent.type` is `z.string()` (not a literal
 * union) on purpose — adding a new event type to the trace surface
 * is additive (minor bump). Removing one is major.
 */

import { z } from 'zod';

import { MetaSchema } from './common.js';

/**
 * Curated, sanitized subset of the originating event payload. Every
 * field is optional — only the fields the originating event actually
 * produced are present. Mirrors `traceEventDataSchema` in the
 * public-api.
 */
export const TraceEventDataSchema = z
  .object({
    /** UUID of the trade this event belongs to (most events). */
    tradeId: z.string().uuid().optional(),
    /** Market UUID the trade targets (most events). */
    marketId: z.string().uuid().optional(),
    /** Outcome index (0..N-1). */
    outcomeIndex: z.number().int().nonnegative().optional(),
    /** `buy` | `sell`. */
    side: z.enum(['buy', 'sell']).optional(),
    /** Human USDC decimal amount. */
    amount: z.string().optional(),
    /** Source-chain id when the event involves a chain-specific op. */
    chainId: z.number().int().positive().optional(),
    /** On-chain tx hash (executed/funding/bridge events). */
    txHash: z.string().optional(),
    /** Outcome tokens received (executed events). */
    tokensOut: z.string().optional(),
    /** Failure code (failed/rejected events). */
    errorCode: z.string().optional(),
    /** Failure message (failed/rejected events). */
    errorMessage: z.string().optional(),
    /** Free-text reason (rejected/compensated events). */
    reason: z.string().optional(),
  })
  .strict();

export type TraceEventData = z.infer<typeof TraceEventDataSchema>;

/**
 * A single event in a correlation trace. Server orders by
 * `(occurredAt, sequenceNumber)` ascending — consumers can render
 * timelines without re-sorting.
 */
export const TraceEventSchema = z.object({
  /** CloudEvents v1.0 type — e.g. `com.kash.trade.executed.v1`. */
  type: z.string().min(1),
  /** ISO-8601 timestamp the event was appended to the store. */
  occurredAt: z.string().datetime(),
  /** Per-aggregate ordering within the same correlation. */
  sequenceNumber: z.number().int().nonnegative(),
  /** Curated, sanitized subset of the original event payload. */
  data: TraceEventDataSchema,
});

export type TraceEvent = z.infer<typeof TraceEventSchema>;

/** The trace resource itself. */
export const TraceResourceSchema = z.object({
  correlationId: z.string().uuid(),
  events: z.array(TraceEventSchema),
});

export type TraceResource = z.infer<typeof TraceResourceSchema>;

/** Wire envelope for `GET /v1/traces/:correlationId`. */
export const GetTraceResponseSchema = z.object({
  trace: TraceResourceSchema,
  /**
   * Cross-endpoint dual-key alias: identical to `trace` when present.
   * Optional in the SDK schema for forward/backward compatibility;
   * the drift gate enforces server-side parity.
   */
  data: TraceResourceSchema.optional(),
  _meta: MetaSchema,
});

export type GetTraceResponse = z.infer<typeof GetTraceResponseSchema>;
