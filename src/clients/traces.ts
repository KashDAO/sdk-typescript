/**
 * `traces` sub-client — wraps `GET /v1/traces/:correlationId`.
 *
 * Trace fetches are read-only and idempotent. The server returns the
 * full event timeline in a single response (capped at 200 events
 * server-side); pagination isn't exposed because correlation chains
 * almost never approach the cap under normal operation.
 *
 * **404 on missing correlation OR access denial.** The server collapses
 * "correlation_id never existed" and "you don't own the trade behind
 * this correlation_id" into the same `RESOURCE_NOT_FOUND` response —
 * by design, to prevent enumeration. Callers see `KashNotFoundError`
 * for both.
 */

import { GetTraceResponseSchema, type TraceResource } from '../schemas/trace.js';

import type { KashHttpClient, RequestOverrides } from '../internal/http.js';

export class TracesClient {
  constructor(private readonly http: KashHttpClient) {}

  /**
   * Fetch the curated event timeline for a correlation id.
   *
   * @example
   * ```ts
   * const trace = await kash.traces.get(trade.correlationId);
   * for (const event of trace.events) {
   *   console.log(event.occurredAt, event.type, event.data);
   * }
   * ```
   *
   * Throws {@link KashNotFoundError} if the correlation id is unknown
   * OR the API key does not own the trade behind it (same response —
   * server prevents enumeration).
   */
  async get(correlationId: string, opts: RequestOverrides = {}): Promise<TraceResource> {
    const result = await this.http.request({
      path: `/traces/${encodeURIComponent(correlationId)}`,
      method: 'GET',
      schema: GetTraceResponseSchema,
      ...opts,
    });
    return result.trace;
  }
}
