/**
 * `trades` sub-client — wraps the most-used route surface of the
 * public API: create, confirm, get, list, plus the
 * `waitForCompletion` polling helper customers will reach for first.
 *
 * Return-shape policy (consistent across the SDK): every method
 * returns the resource itself (or a {@link Page} for lists). The
 * server's `_meta` envelope is unwrapped — request-level metadata is
 * surfaced via lifecycle hooks and `KashError.requestId` instead.
 *
 * For `create()`, two pieces of metadata ride along on the trade:
 *   - `idempotent: boolean` — true when this response is the cached
 *     result of a duplicate idempotent request (server told us so).
 *   - `confirmation?: { token, expiresAt }` — present when the trade
 *     hit the high-value gate. The token is returned ONCE here.
 */

import { KashConflictError, KashValidationError } from '../errors.js';
import { buildPage, type Page } from '../internal/pagination.js';
import { pollUntil } from '../internal/polling.js';
import {
  ConfirmTradeResponseSchema,
  CreateTradeBodySchema,
  CreateTradeResponseSchema,
  GetTradeResponseSchema,
  ListTradesResponseSchema,
  TERMINAL_TRADE_STATUSES,
  type CreateTradeBody,
  type ListTradesParams,
  type TradeResource,
} from '../schemas/trade.js';

import type { KashHttpClient, RequestOverrides } from '../internal/http.js';
import type { Pagination } from '../schemas/common.js';

export type CreateTradeOptions = RequestOverrides & {
  /** Forwarded as the `Idempotency-Key` HTTP header. */
  readonly idempotencyKey?: string;
};

/**
 * Embedded confirmation requirement returned with `trades.create()`
 * when the trade hits the high-value gate. The `token` is shown
 * ONCE — capture it from the result and pass to {@link TradesClient.confirm}.
 */
export type TradeConfirmation = {
  readonly token: string;
  readonly expiresAt: string;
};

/**
 * Return type of {@link TradesClient.create}. Flat: every field of
 * the `Trade` resource is directly accessible. The two SDK-managed
 * extras (`idempotent`, `confirmation`) are attached as siblings, NOT
 * nested in a separate envelope.
 *
 * @example
 * ```ts
 * const trade = await kash.trades.create({...});
 * trade.id          // works directly — no .trade.id awkwardness
 * trade.idempotent  // true if this was a duplicate idempotent request
 * if (trade.confirmation) {
 *   await kash.trades.confirm(trade.id, { token: trade.confirmation.token });
 * }
 * ```
 */
export type TradeCreateResult = TradeResource & {
  /** True iff this response is the cached result of a duplicate `Idempotency-Key`/`clientRequestId`. */
  readonly idempotent: boolean;
  /**
   * Present iff the trade hit the high-value confirmation gate. The
   * token is returned once — capture it and call {@link TradesClient.confirm}
   * before the trade can enter the pipeline.
   */
  readonly confirmation?: TradeConfirmation;
};

export type WaitForCompletionOptions = {
  /** Total time budget across all polls. Default 60s. */
  readonly timeoutMs?: number;
  /** Delay between polls. Default 2s. */
  readonly pollIntervalMs?: number;
  /** Invoked with each fetched trade — useful for status logs. */
  readonly onStatus?: (trade: TradeResource) => void;
  /** Caller-driven abort. */
  readonly signal?: AbortSignal;
};

export class TradesClient {
  constructor(private readonly http: KashHttpClient) {}

  /**
   * Create a trade.
   *
   * The result is the {@link TradeResource} itself — every field is
   * accessible directly (`trade.id`, `trade.status`, …). When the
   * trade hits the high-value gate, the result also carries
   * `confirmation.token` (returned ONCE); when it's a duplicate
   * idempotent request, `idempotent: true`.
   *
   * @example
   * ```ts
   * const trade = await kash.trades.create({
   *   marketId, outcomeIndex: 0, amount: '100', side: 'buy',
   * }, { idempotencyKey: crypto.randomUUID() });
   *
   * if (trade.confirmation) {
   *   await kash.trades.confirm(trade.id, { token: trade.confirmation.token });
   * }
   * ```
   */
  async create(body: CreateTradeBody, opts: CreateTradeOptions = {}): Promise<TradeCreateResult> {
    // Fail-fast on the client. Mirror of the server's body schema —
    // catches the bug at the call site rather than after a 400 round trip.
    const parsed = CreateTradeBodySchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      }));
      const lead = issues[0];
      const summary = lead ? `${lead.path || '(root)'}: ${lead.message}` : 'invalid trade body';
      throw new KashValidationError(`trades.create: ${summary}`, {
        code: 'VALIDATION_FAILED',
        issues,
      });
    }
    const { idempotencyKey, ...rest } = opts;
    const response = await this.http.request({
      path: '/trades',
      method: 'POST',
      schema: CreateTradeResponseSchema,
      body,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ...rest,
    });
    // Flatten the envelope. `idempotent` always rides on `_meta`;
    // `confirmation` is only present in the 202 (high-value) shape.
    const result: TradeCreateResult = {
      ...response.trade,
      idempotent: response._meta.idempotent,
      ...('confirmation' in response ? { confirmation: response.confirmation } : {}),
    };
    return result;
  }

  /**
   * Confirm a high-value trade by submitting the one-time token from
   * `trade.confirmation.token` returned by {@link create}.
   */
  async confirm(
    id: string,
    body: { token: string },
    opts: RequestOverrides = {}
  ): Promise<TradeResource> {
    const result = await this.http.request({
      path: `/trades/${encodeURIComponent(id)}/confirm`,
      method: 'POST',
      schema: ConfirmTradeResponseSchema,
      body,
      ...opts,
    });
    return result.trade;
  }

  /** Fetch a single trade by id. */
  async get(id: string, opts: RequestOverrides = {}): Promise<TradeResource> {
    const result = await this.http.request({
      path: `/trades/${encodeURIComponent(id)}`,
      method: 'GET',
      schema: GetTradeResponseSchema,
      ...opts,
    });
    return result.trade;
  }

  /**
   * List trades. Returns a {@link Page} — usable as both the first
   * page (data + cursor) and an `AsyncIterable<TradeResource>` for
   * walking every page lazily.
   */
  async list(
    params: ListTradesParams = {},
    opts: RequestOverrides = {}
  ): Promise<Page<TradeResource>> {
    const limit = params.limit ?? 20;
    const fetchPage = async (
      cursor: string | undefined
    ): Promise<{
      data: readonly TradeResource[];
      pagination: Pagination;
    }> => {
      const result = await this.http.request({
        path: '/trades',
        method: 'GET',
        schema: ListTradesResponseSchema,
        query: {
          cursor,
          limit,
          status: params.status,
          marketId: params.marketId,
        },
        ...opts,
      });
      return result;
    };
    return buildPage<TradeResource>(fetchPage, params.cursor, { limit });
  }

  /**
   * Poll the trade until it reaches a terminal status (`completed`,
   * `failed`, or `rejected`). Refuses to poll a trade that is still
   * `pending_confirmation` — the consumer must call {@link confirm}
   * first.
   */
  async waitForCompletion(id: string, opts: WaitForCompletionOptions = {}): Promise<TradeResource> {
    // Forward the caller's signal to every inner GET so an abort
    // during an in-flight poll cancels the request itself, not just
    // the polling loop's next iteration.
    const inner: RequestOverrides = {
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    };
    const initial = await this.get(id, inner);
    if (initial.status === 'pending_confirmation') {
      throw new KashConflictError(
        'Trade is awaiting high-value confirmation; call trades.confirm(id, { token }) first.',
        { code: 'TRADE_NOT_AWAITING_CONFIRMATION', statusCode: 409 }
      );
    }
    if (TERMINAL_TRADE_STATUSES.includes(initial.status)) {
      opts.onStatus?.(initial);
      return initial;
    }
    return pollUntil(
      (): Promise<TradeResource> => this.get(id, inner),
      (trade) => TERMINAL_TRADE_STATUSES.includes(trade.status),
      {
        timeoutMs: opts.timeoutMs ?? 60_000,
        pollIntervalMs: opts.pollIntervalMs ?? 2_000,
        ...(opts.onStatus === undefined ? {} : { onStatus: opts.onStatus }),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      }
    );
  }
}
