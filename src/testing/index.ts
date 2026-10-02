/**
 * `@kashdao/sdk/testing` — fixture-driven mock client for unit tests.
 *
 * The factory returns an object that satisfies the public shape of
 * {@link KashClient}: same resource sub-clients, same method
 * signatures, same return types. Every method has a default
 * implementation that returns a wire-shape-valid sample (see
 * `./fixtures`), so an unconfigured mock client is immediately usable
 * without setup.
 *
 * Customers override per-method behaviour through the `overrides`
 * config — each handler runs *instead of* the default. Throw a
 * `KashError` subclass from any handler to simulate a server failure;
 * return the resource shape to simulate success.
 *
 * No `fetch`, no retry, no hooks, no schema parsing — pure in-memory
 * behaviour. The mock client never makes a network call.
 *
 * @example
 * ```ts
 * import { createMockKashClient } from '@kashdao/sdk/testing';
 *
 * // Unconfigured — returns wire-shape-valid defaults for every method.
 * const kash = createMockKashClient();
 * const market = await kash.markets.get('mkt_123');
 *
 * // Override per resource:
 * const kash = createMockKashClient({
 *   markets: {
 *     get: (id) => ({ ...DEFAULT_MARKET, id, title: `Mock ${id}` }),
 *     list: () => ({ data: [DEFAULT_MARKET], hasMore: false }),
 *   },
 *   trades: {
 *     create: (body) => ({
 *       ...DEFAULT_TRADE,
 *       marketId: body.marketId,
 *       idempotent: false,
 *     }),
 *   },
 * });
 *
 * // Throw to simulate a server error:
 * import { KashRateLimitError } from '@kashdao/sdk';
 * const kash = createMockKashClient({
 *   trades: {
 *     create: () => {
 *       throw new KashRateLimitError('Rate limited', {
 *         code: 'RATE_LIMITED',
 *         statusCode: 429,
 *         retryAfterSeconds: 30,
 *       });
 *     },
 *   },
 * });
 * ```
 */

import {
  KashConfigurationError,
  KashValidationError,
  KashWebhookSignatureError,
} from '../errors.js';
import { Page } from '../internal/pagination.js';
import { CreateRedemptionBodySchema, type CreateRedemptionBody } from '../schemas/redemption.js';
import {
  CreateTradeBodySchema,
  type CreateTradeBody,
  type ListTradesParams,
  type TradeResource,
} from '../schemas/trade.js';
import { WebhookEventSchema, type WebhookEvent } from '../schemas/webhook-event.js';

import {
  DEFAULT_ACCOUNT_USAGE,
  DEFAULT_COMPLETED_TRADE,
  DEFAULT_MARKET,
  DEFAULT_PORTFOLIO_SUMMARY,
  DEFAULT_POSITION,
  DEFAULT_PREDICTION,
  DEFAULT_QUOTE_BUY,
  DEFAULT_QUOTE_SELL,
  DEFAULT_REDELIVER_EVENT,
  DEFAULT_REDEMPTION,
  DEFAULT_TRACE,
  DEFAULT_TRADE,
  DEFAULT_WEBHOOK_EVENT,
} from './fixtures.js';

import type { HealthCheckResult } from '../client.js';
import type { ListPositionsParams } from '../clients/portfolio.js';
import type { BuyQuoteParams, SellQuoteParams } from '../clients/quotes.js';
import type { CreateRedemptionOptions, RedemptionCreateResult } from '../clients/redemptions.js';
import type {
  CreateTradeOptions,
  TradeConfirmation,
  TradeCreateResult,
  WaitForCompletionOptions,
} from '../clients/trades.js';
import type {
  ListWebhookEventsParams,
  RotatedWebhookSecret,
  VerifySignatureOptions,
  VerifySignatureResult,
} from '../clients/webhooks.js';
import type { AccountUsage } from '../schemas/account.js';
import type {
  ListMarketsParams,
  ListPredictionsParams,
  MarketResource,
  PredictionResource,
} from '../schemas/market.js';
import type { PortfolioSummary, PositionResource } from '../schemas/portfolio.js';
import type { Quote, QuoteBuyDetail, QuoteSellDetail } from '../schemas/quote.js';
import type { TraceResource } from '../schemas/trace.js';
import type { RedeliverWebhookEvent, WebhookEventResource } from '../schemas/webhook.js';

// ---- Override types ----------------------------------------------------
//
// Each override is OPTIONAL. The factory falls back to the default when
// the override is undefined. Handlers receive the same arguments the
// real method would, MINUS the trailing `RequestOverrides` /
// `CreateTradeOptions` envelope (mocks have no transport to override).

export type MockMarketsOverrides = {
  readonly list?: (params?: ListMarketsParams) => MockListResult<MarketResource>;
  readonly get?: (id: string) => MarketResource | Promise<MarketResource>;
  readonly predictions?: (
    id: string,
    params?: ListPredictionsParams
  ) => MockListResult<PredictionResource>;
};

export type MockTradesOverrides = {
  readonly create?: (
    body: CreateTradeBody,
    opts?: CreateTradeOptions
  ) => TradeCreateResult | Promise<TradeCreateResult>;
  readonly confirm?: (
    id: string,
    body: { token: string }
  ) => TradeResource | Promise<TradeResource>;
  readonly get?: (id: string) => TradeResource | Promise<TradeResource>;
  readonly list?: (params?: ListTradesParams) => MockListResult<TradeResource>;
  readonly waitForCompletion?: (
    id: string,
    opts?: WaitForCompletionOptions
  ) => TradeResource | Promise<TradeResource>;
};

export type MockRedemptionsOverrides = {
  readonly create?: (
    body: CreateRedemptionBody,
    opts?: CreateRedemptionOptions
  ) => RedemptionCreateResult | Promise<RedemptionCreateResult>;
};

export type MockQuotesOverrides = {
  readonly buy?: (
    params: BuyQuoteParams
  ) => (Quote & QuoteBuyDetail) | Promise<Quote & QuoteBuyDetail>;
  readonly sell?: (
    params: SellQuoteParams
  ) => (Quote & QuoteSellDetail) | Promise<Quote & QuoteSellDetail>;
};

export type MockPortfolioOverrides = {
  readonly get?: () => PortfolioSummary | Promise<PortfolioSummary>;
  readonly positions?: (
    params?: ListPositionsParams
  ) => readonly PositionResource[] | Promise<readonly PositionResource[]>;
};

export type MockWebhooksOverrides = {
  readonly list?: (params?: ListWebhookEventsParams) => MockListResult<WebhookEventResource>;
  readonly redeliver?: (eventId: string) => RedeliverWebhookEvent | Promise<RedeliverWebhookEvent>;
  readonly rotateSecret?: () => RotatedWebhookSecret | Promise<RotatedWebhookSecret>;
  readonly verifySignature?: (
    body: string,
    header: string,
    secret: string,
    opts?: VerifySignatureOptions
  ) => VerifySignatureResult | Promise<VerifySignatureResult>;
  readonly constructEvent?: (
    body: string,
    header: string,
    secret: string,
    opts?: VerifySignatureOptions
  ) => WebhookEvent | Promise<WebhookEvent>;
};

export type MockAccountOverrides = {
  readonly usage?: () => AccountUsage | Promise<AccountUsage>;
};

export type MockTracesOverrides = {
  readonly get?: (correlationId: string) => TraceResource | Promise<TraceResource>;
};

export type MockKashClientOverrides = {
  readonly markets?: MockMarketsOverrides;
  readonly trades?: MockTradesOverrides;
  readonly redemptions?: MockRedemptionsOverrides;
  readonly quotes?: MockQuotesOverrides;
  readonly portfolio?: MockPortfolioOverrides;
  readonly webhooks?: MockWebhooksOverrides;
  readonly account?: MockAccountOverrides;
  readonly traces?: MockTracesOverrides;
  readonly healthCheck?: () => HealthCheckResult | Promise<HealthCheckResult>;
};

/**
 * Convenience shape for list-method overrides — the override returns
 * either a flat array of items (which the factory wraps in a single-
 * page {@link Page}) or a `{ data, hasMore?, nextCursor? }` object.
 */
export type MockListResult<T> =
  | readonly T[]
  | Promise<readonly T[]>
  | MockPageShape<T>
  | Promise<MockPageShape<T>>;

export type MockPageShape<T> = {
  readonly data: readonly T[];
  readonly hasMore?: boolean;
  readonly nextCursor?: string | null;
};

// ---- Public mock surface ----------------------------------------------

/**
 * The mock client surface — structurally compatible with the public
 * surface of {@link KashClient}. Methods return promises like the real
 * client. List methods return a {@link Page}; consumers can iterate or
 * read `.data`.
 */
export type MockKashClient = {
  readonly markets: {
    list(params?: ListMarketsParams): Promise<Page<MarketResource>>;
    get(id: string): Promise<MarketResource>;
    predictions(id: string, params?: ListPredictionsParams): Promise<Page<PredictionResource>>;
  };
  readonly trades: {
    create(body: CreateTradeBody, opts?: CreateTradeOptions): Promise<TradeCreateResult>;
    confirm(id: string, body: { token: string }): Promise<TradeResource>;
    get(id: string): Promise<TradeResource>;
    list(params?: ListTradesParams): Promise<Page<TradeResource>>;
    waitForCompletion(id: string, opts?: WaitForCompletionOptions): Promise<TradeResource>;
  };
  readonly redemptions: {
    create(
      body: CreateRedemptionBody,
      opts?: CreateRedemptionOptions
    ): Promise<RedemptionCreateResult>;
  };
  readonly quotes: {
    buy(params: BuyQuoteParams): Promise<Quote & QuoteBuyDetail>;
    sell(params: SellQuoteParams): Promise<Quote & QuoteSellDetail>;
  };
  readonly portfolio: {
    get(): Promise<PortfolioSummary>;
    positions(params?: ListPositionsParams): Promise<readonly PositionResource[]>;
  };
  readonly webhooks: {
    list(params?: ListWebhookEventsParams): Promise<Page<WebhookEventResource>>;
    redeliver(eventId: string): Promise<RedeliverWebhookEvent>;
    rotateSecret(): Promise<RotatedWebhookSecret>;
    verifySignature(
      body: string,
      header: string,
      secret: string,
      opts?: VerifySignatureOptions
    ): Promise<VerifySignatureResult>;
    constructEvent(
      body: string,
      header: string,
      secret: string,
      opts?: VerifySignatureOptions
    ): Promise<WebhookEvent>;
  };
  readonly account: {
    usage(): Promise<AccountUsage>;
  };
  readonly traces: {
    get(correlationId: string): Promise<TraceResource>;
  };
  healthCheck(): Promise<HealthCheckResult>;
};

// ---- Factory ----------------------------------------------------------

/**
 * Construct a mock client for unit tests.
 *
 * @param overrides Per-method override handlers. Anything omitted falls
 * back to a wire-shape-valid default.
 */
export function createMockKashClient(overrides: MockKashClientOverrides = {}): MockKashClient {
  const m = overrides.markets ?? {};
  const t = overrides.trades ?? {};
  const r = overrides.redemptions ?? {};
  const q = overrides.quotes ?? {};
  const p = overrides.portfolio ?? {};
  const w = overrides.webhooks ?? {};
  const a = overrides.account ?? {};
  const tr = overrides.traces ?? {};

  return {
    markets: {
      list: async (params?: ListMarketsParams) => {
        const limit = params?.limit ?? 20;
        const result = m.list ? await m.list(params) : [DEFAULT_MARKET];
        return toMockPage(result, limit);
      },
      get: async (id: string) => (m.get ? m.get(id) : { ...DEFAULT_MARKET, id }),
      predictions: async (id: string, params?: ListPredictionsParams) => {
        const limit = params?.limit ?? 50;
        const result = m.predictions
          ? await m.predictions(id, params)
          : [{ ...DEFAULT_PREDICTION, marketId: id }];
        return toMockPage(result, limit);
      },
    },
    trades: {
      create: async (body: CreateTradeBody, opts?: CreateTradeOptions) => {
        // Mirror the real client's fail-fast body pre-validation so
        // tests that exercise the bad-input path see the same throw
        // they'd get in production.
        const parsed = CreateTradeBodySchema.safeParse(body);
        if (!parsed.success) {
          const issues = parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
            code: i.code,
          }));
          const lead = issues[0];
          throw new KashValidationError(
            `trades.create: ${lead ? `${lead.path || '(root)'}: ${lead.message}` : 'invalid trade body'}`,
            { code: 'VALIDATION_FAILED', issues }
          );
        }
        return t.create ? t.create(body, opts) : defaultTradeCreate(body);
      },
      confirm: async (id: string, body: { token: string }) =>
        t.confirm ? t.confirm(id, body) : { ...DEFAULT_TRADE, id, status: 'pending' as const },
      get: async (id: string) => (t.get ? t.get(id) : { ...DEFAULT_TRADE, id }),
      list: async (params?: ListTradesParams) => {
        const limit = params?.limit ?? 20;
        const result = t.list ? await t.list(params) : [DEFAULT_TRADE];
        return toMockPage(result, limit);
      },
      waitForCompletion: async (id: string, opts?: WaitForCompletionOptions) => {
        const result = t.waitForCompletion
          ? await t.waitForCompletion(id, opts)
          : { ...DEFAULT_COMPLETED_TRADE, id };
        opts?.onStatus?.(result);
        return result;
      },
    },
    redemptions: {
      create: async (body: CreateRedemptionBody, opts?: CreateRedemptionOptions) => {
        // Same fail-fast pre-validation as the real client.
        const parsed = CreateRedemptionBodySchema.safeParse(body);
        if (!parsed.success) {
          const issues = parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
            code: i.code,
          }));
          const lead = issues[0];
          throw new KashValidationError(
            `redemptions.create: ${lead ? `${lead.path || '(root)'}: ${lead.message}` : 'invalid redemption body'}`,
            { code: 'VALIDATION_FAILED', issues }
          );
        }
        return r.create
          ? r.create(body, opts)
          : {
              ...DEFAULT_REDEMPTION,
              marketId: body.marketId,
              outcomeIndex: body.outcomeIndex,
              idempotent: false,
            };
      },
    },
    quotes: {
      buy: async (params: BuyQuoteParams) =>
        q.buy ? q.buy(params) : { ...DEFAULT_QUOTE_BUY, outcomeIndex: params.outcomeIndex },
      sell: async (params: SellQuoteParams) =>
        q.sell ? q.sell(params) : { ...DEFAULT_QUOTE_SELL, outcomeIndex: params.outcomeIndex },
    },
    portfolio: {
      get: async () => (p.get ? p.get() : DEFAULT_PORTFOLIO_SUMMARY),
      positions: async (params?: ListPositionsParams) =>
        p.positions ? p.positions(params) : [DEFAULT_POSITION],
    },
    webhooks: {
      list: async (params?: ListWebhookEventsParams) => {
        const limit = params?.limit ?? 25;
        const result = w.list ? await w.list(params) : [DEFAULT_WEBHOOK_EVENT];
        return toMockPage(result, limit);
      },
      redeliver: async (eventId: string) =>
        w.redeliver ? w.redeliver(eventId) : { ...DEFAULT_REDELIVER_EVENT, id: eventId },
      rotateSecret: async () =>
        w.rotateSecret
          ? w.rotateSecret()
          : ({
              secret: `whsec_mock_${'a'.repeat(32)}`,
              rotatedAt: '2026-04-30T12:00:00.000Z',
              previousRetainedUntil: '2026-05-07T12:00:00.000Z',
            } satisfies RotatedWebhookSecret),
      verifySignature: async (
        body: string,
        header: string,
        secret: string,
        opts?: VerifySignatureOptions
      ) =>
        w.verifySignature
          ? w.verifySignature(body, header, secret, opts)
          : ({ valid: true } satisfies VerifySignatureResult),
      constructEvent: async (
        body: string,
        header: string,
        secret: string,
        opts?: VerifySignatureOptions
      ) => {
        if (w.constructEvent) return w.constructEvent(body, header, secret, opts);
        // Default: mirror the real client — same input guards, same
        // verify-then-parse pipeline, same error classes/codes. Handler
        // code under test sees identical semantics so consumer tests
        // that assert "missing secret throws KashConfigurationError" or
        // "non-string body throws KashValidationError" pass against
        // both the mock and the production client.
        if (typeof secret !== 'string' || secret.trim().length === 0) {
          throw new KashConfigurationError(
            '@kashdao/sdk: webhooks.constructEvent requires a non-empty `secret`. ' +
              'Check your KASH_WEBHOOK_SECRET environment variable.',
            { code: 'SDK_WEBHOOK_SECRET_MISSING' }
          );
        }
        if (typeof body !== 'string') {
          throw new KashValidationError(
            '@kashdao/sdk: webhooks.constructEvent requires the raw request body as a string. ' +
              'Pass the bytes the server signed (not a parsed JSON object).',
            { code: 'SDK_WEBHOOK_BODY_NOT_STRING' }
          );
        }
        const verify = w.verifySignature
          ? await w.verifySignature(body, header, secret, opts)
          : ({ valid: true } satisfies VerifySignatureResult);
        if (!verify.valid) {
          throw new KashWebhookSignatureError(verify.reason, {
            code: 'WEBHOOK_SIGNATURE_INVALID',
          });
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch (err) {
          throw new KashValidationError('Webhook body is not valid JSON.', {
            code: 'SDK_PARSE',
            cause: err,
          });
        }
        const eventResult = WebhookEventSchema.safeParse(parsed);
        if (!eventResult.success) {
          throw new KashValidationError(
            `Webhook body did not match any known event shape: ${eventResult.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ')}`,
            { code: 'SDK_VALIDATION' }
          );
        }
        return eventResult.data;
      },
    },
    account: {
      usage: async () => (a.usage ? a.usage() : DEFAULT_ACCOUNT_USAGE),
    },
    traces: {
      get: async (correlationId: string) =>
        tr.get ? tr.get(correlationId) : { ...DEFAULT_TRACE, correlationId },
    },
    healthCheck: async () =>
      overrides.healthCheck
        ? overrides.healthCheck()
        : ({ ok: true, latencyMs: 1, status: 'ok', version: 'mock' } satisfies HealthCheckResult),
  };
}

// ---- Internals --------------------------------------------------------

function defaultTradeCreate(body: CreateTradeBody): TradeCreateResult {
  return {
    ...DEFAULT_TRADE,
    marketId: body.marketId,
    outcomeIndex: body.outcomeIndex,
    amount: body.amount,
    side: body.side,
    clientRequestId: body.clientRequestId ?? null,
    idempotent: false,
  };
}

/**
 * Wrap an array (or a `{ data, hasMore?, nextCursor? }` shape) in a
 * {@link Page} whose iterator terminates at the end of the supplied
 * data. The fetcher is a no-op — mock clients don't paginate.
 */
function toMockPage<T>(result: readonly T[] | MockPageShape<T>, limit: number): Page<T> {
  const isArray = Array.isArray(result);
  const data = (isArray ? (result as readonly T[]) : (result as MockPageShape<T>).data) ?? [];
  const hasMore = !isArray ? ((result as MockPageShape<T>).hasMore ?? false) : false;
  const cursor = !isArray ? ((result as MockPageShape<T>).nextCursor ?? null) : null;
  return new Page<T>(
    {
      data,
      pagination: { cursor, hasMore, limit },
    },
    // No-op fetcher — if the iterator advances past this page, return
    // an empty terminal page.
    () => Promise.resolve({ data: [], pagination: { cursor: null, hasMore: false, limit } }),
    { limit }
  );
}

// Re-export fixtures so test files can import them from the same
// barrel as the factory.
export {
  DEFAULT_ACCOUNT_USAGE,
  DEFAULT_COMPLETED_TRADE,
  DEFAULT_MARKET,
  DEFAULT_PORTFOLIO_SUMMARY,
  DEFAULT_POSITION,
  DEFAULT_PREDICTION,
  DEFAULT_QUOTE_BUY,
  DEFAULT_QUOTE_SELL,
  DEFAULT_REDELIVER_EVENT,
  DEFAULT_REDEMPTION,
  DEFAULT_TRACE,
  DEFAULT_TRADE,
  DEFAULT_WEBHOOK_EVENT,
} from './fixtures.js';

// Re-export the confirmation-flag helper type — handy for callers
// constructing an awaiting-confirmation TradeCreateResult.
export type { TradeConfirmation };
