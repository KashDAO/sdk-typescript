/**
 * Cross-resource schema fragments — shared shapes used across
 * multiple endpoints (problem responses, pagination envelopes, the
 * `_meta` block).
 *
 * These are the SDK's authoritative copies of the wire shapes. The
 * `tests/contract/wire-shape.test.ts` suite asserts that the SDK
 * schemas accept the API's actual response shapes; any drift fails
 * CI before it reaches a customer.
 */

import { z } from 'zod';

/**
 * RFC 7807 problem response shape. The HTTP layer parses these into
 * typed `KashError` subclasses; the schema is exported for consumers
 * who want to surface the raw fields (e.g. structured logging).
 */
export const ProblemDetailsSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  status: z.number().int().optional(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().optional(),
  requestId: z.string().optional(),
});

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/**
 * Cursor-pagination envelope. Same shape on `GET /v1/markets` and
 * `GET /v1/trades`.
 */
export const PaginationSchema = z.object({
  cursor: z.string().nullable(),
  hasMore: z.boolean(),
  limit: z.number().int().positive(),
});

export type Pagination = z.infer<typeof PaginationSchema>;

/**
 * `_meta` envelope returned by mutation routes. Extensible — routes
 * may add fields (e.g. `idempotent: boolean`); consumers should not
 * pin to an exact shape.
 */
export const MetaSchema = z
  .object({
    requestId: z.string(),
    timestamp: z.string().datetime(),
  })
  .passthrough();

export type Meta = z.infer<typeof MetaSchema>;
