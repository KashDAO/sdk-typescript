/**
 * `portfolio` sub-client — wraps `GET /v1/portfolio` and
 * `GET /v1/portfolio/positions`.
 */

import {
  PortfolioSummaryResponseSchema,
  PositionsResponseSchema,
  type PortfolioSummary,
  type PositionResource,
} from '../schemas/portfolio.js';

import type { KashHttpClient, RequestOverrides } from '../internal/http.js';

export type ListPositionsParams = {
  /** Optional single-market filter. */
  readonly marketId?: string;
};

export class PortfolioClient {
  constructor(private readonly http: KashHttpClient) {}

  /** Aggregate portfolio summary for the authenticated user. */
  async get(opts: RequestOverrides = {}): Promise<PortfolioSummary> {
    const result = await this.http.request({
      path: '/portfolio',
      method: 'GET',
      schema: PortfolioSummaryResponseSchema,
      ...opts,
    });
    return result.portfolio;
  }

  /** Per-position breakdown. */
  async positions(
    params: ListPositionsParams = {},
    opts: RequestOverrides = {}
  ): Promise<readonly PositionResource[]> {
    const result = await this.http.request({
      path: '/portfolio/positions',
      method: 'GET',
      schema: PositionsResponseSchema,
      query: { marketId: params.marketId },
      ...opts,
    });
    return result.data;
  }
}
