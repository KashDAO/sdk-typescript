/**
 * `portfolio` sub-client — wraps `GET /v1/portfolio` and
 * `GET /v1/portfolio/positions`, plus `watchPositions`, the polling loop
 * the API is built to serve cheaply.
 */

import { KashConfigurationError } from '../errors.js';
import { sleepWithAbort } from '../internal/sleep.js';
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

export type WatchPositionsParams = ListPositionsParams & {
  /**
   * Poll interval right after a change (and for the first poll). Default
   * 5 000 ms; at least 1 000 ms.
   */
  readonly minIntervalMs?: number;
  /**
   * The ceiling the interval backs off to while nothing changes. Default
   * 60 000 ms.
   */
  readonly maxIntervalMs?: number;
  /** Multiplier applied to the interval after each unchanged poll. Default 2. */
  readonly backoffFactor?: number;
  /** Stops the watch. The iterator then ends by throwing `KashAbortedError`. */
  readonly signal?: AbortSignal;
};

/** Defaults for `watchPositions`, exported so docs and tests cite one source. */
export const WATCH_POSITIONS_DEFAULTS = Object.freeze({
  minIntervalMs: 5_000,
  maxIntervalMs: 60_000,
  backoffFactor: 2,
});

/** Below this the watch would be a busy loop against a rate-limited API. */
const WATCH_POSITIONS_FLOOR_MS = 1_000;

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

  /**
   * Watch the authenticated user's positions. Yields the current positions
   * once, then again each time they change.
   *
   * Built for the API's cost model rather than against it:
   *
   *   - every poll is a conditional GET, so an unchanged position set comes
   *     back as a body-less `304` the server answers without running the list
   *     query (requires `conditionalRequests`, on by default);
   *   - the interval starts at `minIntervalMs`, multiplies by `backoffFactor`
   *     after every unchanged poll up to `maxIntervalMs`, and snaps back to
   *     `minIntervalMs` when something changes — a quiet account costs about
   *     one request a minute instead of one every few seconds;
   *   - 429 and 5xx are retried with the client's normal backoff and
   *     `Retry-After`; anything that survives that ends the iteration with the
   *     typed error.
   *
   * If every position change you care about comes from your own trades,
   * webhooks are cheaper still: subscribe to `trade.completed` and call
   * `positions()` once per event instead of watching.
   *
   * @example
   * ```ts
   * const controller = new AbortController();
   * for await (const positions of kash.portfolio.watchPositions({ signal: controller.signal })) {
   *   rebalance(positions);
   * }
   * ```
   */
  async *watchPositions(
    params: WatchPositionsParams = {},
    opts: RequestOverrides = {}
  ): AsyncGenerator<readonly PositionResource[], never, undefined> {
    const minIntervalMs = params.minIntervalMs ?? WATCH_POSITIONS_DEFAULTS.minIntervalMs;
    const maxIntervalMs = params.maxIntervalMs ?? WATCH_POSITIONS_DEFAULTS.maxIntervalMs;
    const backoffFactor = params.backoffFactor ?? WATCH_POSITIONS_DEFAULTS.backoffFactor;
    validateWatchOptions(minIntervalMs, maxIntervalMs, backoffFactor);
    const signal = params.signal ?? opts.signal;

    let intervalMs = minIntervalMs;
    let last: string | undefined;
    while (true) {
      const data = await this.http.request({
        path: '/portfolio/positions',
        method: 'GET',
        schema: PositionsResponseSchema,
        query: { marketId: params.marketId },
        ...opts,
        ...(signal === undefined ? {} : { signal }),
      });
      // Always compare CONTENT against what this watch last yielded. A 304
      // only says "unchanged since the ETag this CLIENT last stored", and the
      // conditional cache is shared by every call on the client: a
      // `positions()` call between two polls can store the new body first,
      // so the next poll's 304 already carries a change this watch has not
      // yielded. On a 304 `data` IS that newest remembered body, so comparing
      // it is correct and costs no extra request.
      const fingerprint = JSON.stringify(data.data);
      if (fingerprint !== last) {
        last = fingerprint;
        intervalMs = minIntervalMs;
        yield data.data;
      } else {
        intervalMs = Math.min(maxIntervalMs, Math.ceil(intervalMs * backoffFactor));
      }
      await sleepWithAbort(intervalMs, signal);
    }
  }
}

function validateWatchOptions(
  minIntervalMs: number,
  maxIntervalMs: number,
  backoffFactor: number
): void {
  const problems: string[] = [];
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < WATCH_POSITIONS_FLOOR_MS) {
    problems.push(`minIntervalMs must be at least ${WATCH_POSITIONS_FLOOR_MS}`);
  }
  if (!Number.isFinite(maxIntervalMs) || maxIntervalMs < minIntervalMs) {
    problems.push('maxIntervalMs must be at least minIntervalMs');
  }
  if (!Number.isFinite(backoffFactor) || backoffFactor < 1) {
    problems.push('backoffFactor must be at least 1');
  }
  if (problems.length > 0) {
    throw new KashConfigurationError(`watchPositions: ${problems.join('; ')}.`, {
      code: 'SDK_CONFIGURATION',
    });
  }
}
