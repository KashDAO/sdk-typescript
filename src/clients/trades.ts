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

import { KashConflictError, KashError } from '../errors.js';
import { autoIdempotencyKey } from '../internal/idempotency-key.js';
import { buildPage, type Page } from '../internal/pagination.js';
import { pollUntil } from '../internal/polling.js';
import { parseRequestBody } from '../internal/request-body.js';
import { accountOverrides, type AccountRequestOverrides } from '../internal/request-options.js';
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

import type { KashHttpClient } from '../internal/http.js';
import type { Pagination } from '../schemas/envelope.js';

/**
 * Options for {@link TradesClient.create}. `account` names the partner
 * account the trade is for (see {@link AccountRequestOverrides}).
 */
export type CreateTradeOptions = AccountRequestOverrides & {
  /**
   * Forwarded as the `Idempotency-Key` HTTP header. When omitted, the SDK
   * generates one for this call.
   */
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
  /**
   * True iff this response is the API's replay of a trade already recorded
   * under this `Idempotency-Key` or `clientRequestId`. That includes this
   * call's own retries: when an earlier attempt of the same call recorded
   * the trade but its response was lost (a timeout, a reset, a 503), the
   * retry returns that trade with `idempotent: true`. It is still the one
   * trade this call asked for.
   */
  readonly idempotent: boolean;
  /**
   * The token to release a trade held at the high-value confirmation gate
   * (`status: 'pending_confirmation'`), for {@link TradesClient.confirm}.
   * Present whenever such a trade can still be confirmed by this API key:
   * on the first answer, and on a repeat of the call inside the confirmation
   * window (the API then issues a new token and the earlier one stops
   * working). Absent for a trade that did not hit the gate, and for a held
   * trade whose window has passed or that another API key placed.
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
  /** The partner account the trade belongs to, sent on every poll as `Kash-Account`. */
  readonly account?: string;
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
   * When `body.clientRequestId` is omitted the SDK sends one it generates,
   * once per call and the same on every retry, so the API deduplicates the
   * call's retries in the database (see the README, "Trades are
   * deduplicated in the database"). The result's `clientRequestId` carries
   * the id that was sent.
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
    parseRequestBody(CreateTradeBodySchema, body, 'trades.create');
    const { idempotencyKey: callerKey, ...rest } = opts;
    // One clientRequestId and one Idempotency-Key per call, resolved here,
    // before the transport's retry loop, so every attempt of this call sends
    // the same pair and distinct calls never share one. The caller's values
    // always win.
    //
    // The key alone does not stop a second trade: the server holds a key's
    // claim for 60 s, fails open when it cannot take one, and releases it on
    // any non-2xx (the 503 "trade recorded, event pipeline unavailable"
    // included), after which the same key runs the handler again. The
    // clientRequestId is checked against a unique `(user_id,
    // client_request_id)` in the database instead, where `user_id` is the
    // account the trade acts for, so a repeat of this call returns the
    // trade it already recorded (200, `idempotent: true`) at any age.
    //
    // No randomness source: both stay unset, and the transport sends this
    // unkeyed POST once, without retries (`autoIdempotencyKey`).
    const generatedId = body.clientRequestId === undefined ? autoIdempotencyKey() : undefined;
    const sent: CreateTradeBody =
      generatedId === undefined ? body : { ...body, clientRequestId: generatedId };
    const idempotencyKey = callerKey ?? autoIdempotencyKey();
    const send = () =>
      this.http.request({
        path: '/trades',
        method: 'POST',
        schema: CreateTradeResponseSchema,
        body: sent,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        ...accountOverrides(rest),
      });
    const usedId = sent.clientRequestId;
    let response: Awaited<ReturnType<typeof send>>;
    try {
      response = await this.sendResolvingRace(send, generatedId !== undefined);
      // A held high-value trade answered without its token: the API's replay
      // of a 202 under the same Idempotency-Key, which never stores the token
      // (this call's retry after its first 202 was lost). Ask once more under
      // a FRESH key with the same clientRequestId: the database dedupes on
      // the id, so nothing is placed twice, and the API answers the repeat
      // with a new token for the key that placed the trade.
      const heldWithoutToken =
        response.trade.status === 'pending_confirmation' && !('confirmation' in response);
      const freshKey = heldWithoutToken && usedId !== undefined ? autoIdempotencyKey() : undefined;
      if (freshKey !== undefined) {
        response = await this.http.request({
          path: '/trades',
          method: 'POST',
          schema: CreateTradeResponseSchema,
          body: sent,
          idempotencyKey: freshKey,
          ...accountOverrides(rest),
        });
      }
    } catch (err) {
      // Every error carries the id this call sent, so the caller can repeat
      // the call with it (the generated one is otherwise unknowable).
      if (KashError.isKashError(err)) err.clientRequestId = usedId;
      throw err;
    }
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
   * Send, and on `CLIENT_REQUEST_ID_CONFLICT` for an id the SDK generated,
   * send the identical request once more. That conflict means "this id
   * already names a trade with a different body", but a generated id exists
   * only in this call, so the body cannot differ: a concurrent attempt of
   * this same call recorded the trade (the server answers the losing insert
   * this way when its key claim failed open). The repeat returns that trade
   * through the server's replay.
   */
  private async sendResolvingRace<T>(send: () => Promise<T>, generated: boolean): Promise<T> {
    try {
      return await send();
    } catch (err) {
      if (
        !generated ||
        !(err instanceof KashConflictError) ||
        err.code !== 'CLIENT_REQUEST_ID_CONFLICT'
      ) {
        throw err;
      }
      return await send();
    }
  }

  /**
   * Confirm a high-value trade by submitting the one-time token from
   * `trade.confirmation.token` returned by {@link create}.
   */
  async confirm(
    id: string,
    body: { token: string },
    opts: AccountRequestOverrides = {}
  ): Promise<TradeResource> {
    const result = await this.http.request({
      path: `/trades/${encodeURIComponent(id)}/confirm`,
      method: 'POST',
      schema: ConfirmTradeResponseSchema,
      body,
      ...accountOverrides(opts),
    });
    return result.trade;
  }

  /** Fetch a single trade by id. */
  async get(id: string, opts: AccountRequestOverrides = {}): Promise<TradeResource> {
    const result = await this.http.request({
      path: `/trades/${encodeURIComponent(id)}`,
      method: 'GET',
      schema: GetTradeResponseSchema,
      ...accountOverrides(opts),
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
    opts: AccountRequestOverrides = {}
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
        ...accountOverrides(opts),
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
   *
   * That refusal is a {@link KashConflictError} with code
   * `TRADE_NOT_AWAITING_CONFIRMATION` (raised by the SDK, `statusCode`
   * 409). The name reads backwards here: the trade IS awaiting
   * confirmation, which is why it cannot be waited on. The code is kept as
   * published in 0.3.x so existing handlers keep matching; branch on it as
   * "confirm this trade first".
   */
  async waitForCompletion(id: string, opts: WaitForCompletionOptions = {}): Promise<TradeResource> {
    // Forward the caller's signal to every inner GET so an abort
    // during an in-flight poll cancels the request itself, not just
    // the polling loop's next iteration.
    const inner: AccountRequestOverrides = {
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      ...(opts.account === undefined ? {} : { account: opts.account }),
    };
    const initial = await this.get(id, inner);
    if (initial.status === 'pending_confirmation') {
      throw new KashConflictError(
        `trades.waitForCompletion: trade ${id} is pending_confirmation and will not progress ` +
          'until it is confirmed. Call trades.confirm(id, { token }) with the token from ' +
          'trades.create, then wait.',
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
