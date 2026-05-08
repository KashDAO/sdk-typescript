/**
 * `markets` sub-client — wraps `GET /v1/markets` and
 * `GET /v1/markets/{id}`.
 *
 * `list()` returns a {@link Page} — at once the first page (data +
 * cursor) and an `AsyncIterable` walking every subsequent page on
 * demand. Callers who only need the first 20 markets read `.data`;
 * callers who want every market iterate.
 */

import { buildPage, type Page } from '../internal/pagination.js';
import {
  GetMarketResponseSchema,
  ListMarketsResponseSchema,
  ListPredictionsResponseSchema,
  type ListMarketsParams,
  type ListPredictionsParams,
  type MarketResource,
  type PredictionResource,
} from '../schemas/market.js';

import type { KashHttpClient, RequestOverrides } from '../internal/http.js';
import type { Pagination } from '../schemas/common.js';

export class MarketsClient {
  constructor(private readonly http: KashHttpClient) {}

  /**
   * List markets, newest first.
   *
   * @example
   * ```ts
   * // Just the first page:
   * const page = await kash.markets.list({ limit: 50 });
   * console.log(page.data, page.hasMore);
   *
   * // Walk every market across pages:
   * for await (const market of await kash.markets.list({ status: 'ACTIVE' })) {
   *   console.log(market.id);
   * }
   *
   * // Per-call timeout + custom header (e.g. distributed tracing):
   * await kash.markets.list({ status: 'ACTIVE' }, {
   *   timeoutMs: 60_000,
   *   headers: { traceparent: '00-<trace-id>-<span-id>-01' },
   * });
   * ```
   */
  async list(
    params: ListMarketsParams = {},
    opts: RequestOverrides = {}
  ): Promise<Page<MarketResource>> {
    const limit = params.limit ?? 20;
    const fetchPage = async (
      cursor: string | undefined
    ): Promise<{
      data: readonly MarketResource[];
      pagination: Pagination;
    }> => {
      const result = await this.http.request({
        path: '/markets',
        method: 'GET',
        schema: ListMarketsResponseSchema,
        query: { cursor, limit, status: params.status },
        ...opts,
      });
      return result;
    };
    return buildPage<MarketResource>(fetchPage, params.cursor, { limit });
  }

  /** Fetch a single market by id. */
  async get(id: string, opts: RequestOverrides = {}): Promise<MarketResource> {
    const result = await this.http.request({
      path: `/markets/${encodeURIComponent(id)}`,
      method: 'GET',
      schema: GetMarketResponseSchema,
      ...opts,
    });
    return result.market;
  }

  /**
   * Recent trades against a market — newest first, cursor-paginated.
   * Requires API key with `markets:read` scope (granted by default on
   * every tier).
   *
   * Returns a {@link Page} — the first page synchronously, plus an
   * `AsyncIterable` to walk every subsequent page on demand.
   *
   * @example
   * ```ts
   * // Latest 50 trades on a market:
   * const feed = await kash.markets.predictions(marketId);
   * for (const trade of feed.data) {
   *   console.log(trade.side, trade.outcomeIndex, trade.price);
   * }
   *
   * // Stream every buy on outcome 0:
   * for await (const trade of await kash.markets.predictions(marketId, {
   *   side: 'buy',
   *   outcomeIndex: 0,
   * })) {
   *   console.log(trade.timestamp, trade.usdcIn, trade.tokensOut);
   * }
   * ```
   */
  async predictions(
    id: string,
    params: ListPredictionsParams = {},
    opts: RequestOverrides = {}
  ): Promise<Page<PredictionResource>> {
    const limit = params.limit ?? 50;
    const fetchPage = async (
      cursor: string | undefined
    ): Promise<{
      data: readonly PredictionResource[];
      pagination: Pagination;
    }> => {
      const result = await this.http.request({
        path: `/markets/${encodeURIComponent(id)}/predictions`,
        method: 'GET',
        schema: ListPredictionsResponseSchema,
        query: {
          cursor,
          limit,
          side: params.side,
          outcomeIndex: params.outcomeIndex,
        },
        ...opts,
      });
      return result;
    };
    return buildPage<PredictionResource>(fetchPage, params.cursor, { limit });
  }
}
