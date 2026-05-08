/**
 * `account` sub-client — currently a thin wrapper over
 * `GET /v1/account/usage` (per-key telemetry summary, DX7).
 *
 * The endpoint requires the `auth:manage` scope (same scope that lists
 * and revokes the calling key) — "tell me about my own account" lives
 * in the same lane as account management.
 *
 * @example
 * ```ts
 * const usage = await kash.account.usage();
 * console.log(`24h success rate: ${usage.trades['24h'].successRate}`);
 * console.log(`24h p99 latency: ${usage.trades['24h'].latencyMs.p99}ms`);
 * ```
 */

import { AccountUsageResponseSchema, type AccountUsage } from '../schemas/account.js';

import type { KashHttpClient, RequestOverrides } from '../internal/http.js';

export class AccountClient {
  constructor(private readonly http: KashHttpClient) {}

  /** Per-key telemetry summary (last 24h / 7d / 30d windows). */
  async usage(opts: RequestOverrides = {}): Promise<AccountUsage> {
    const result = await this.http.request({
      path: '/account/usage',
      method: 'GET',
      schema: AccountUsageResponseSchema,
      ...opts,
    });
    return result.data;
  }
}
