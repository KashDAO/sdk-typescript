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
import { validateIdempotencyKey } from '../internal/idempotency-key.js';
import { Page } from '../internal/pagination.js';
import { parseRequestBody, requireIdempotencyKey } from '../internal/request-body.js';
import { pageLimit, validateUuid } from '../internal/request-options.js';
import { parseWebhookEvent } from '../internal/webhook-event-parse.js';
import {
  CreatePartnerAccountBodySchema,
  PartnerExternalIdSchema,
  UpdatePartnerAccountBodySchema,
  type CreatePartnerAccountBody,
  type PartnerAccountResource,
  type UpdatePartnerAccountBody,
} from '../schemas/partner-account.js';
import {
  CreatePartnerWithdrawalBodySchema,
  type CreatePartnerWithdrawalBody,
  type PartnerWithdrawalQuote,
  type PartnerWithdrawalResource,
} from '../schemas/partner-withdrawal.js';
import { CreateRedemptionBodySchema, type CreateRedemptionBody } from '../schemas/redemption.js';
import {
  CreateTradeBodySchema,
  type CreateTradeBody,
  type ListTradesParams,
  type TradeResource,
} from '../schemas/trade.js';

import {
  DEFAULT_ACCOUNT_USAGE,
  DEFAULT_BALANCE,
  DEFAULT_COMPLETED_TRADE,
  DEFAULT_MARKET,
  DEFAULT_PARTNER_ACCOUNT,
  DEFAULT_PARTNER_WITHDRAWAL,
  DEFAULT_PARTNER_WITHDRAWAL_QUOTE,
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
import type { AccountClient } from '../clients/account.js';
import type { BalanceClient } from '../clients/balance.js';
import type { MarketsClient } from '../clients/markets.js';
import type {
  PartnerAccountsClient,
  ListPartnerAccountsParams,
  PartnerAccountCreateResult,
  PartnerAccountWriteOptions,
  WaitUntilActiveOptions,
} from '../clients/partner-accounts.js';
import type {
  PartnerWithdrawalsClient,
  CreatePartnerWithdrawalOptions,
  ListPartnerWithdrawalsParams,
  PartnerWithdrawalCreateResult,
  PartnerWithdrawalQuoteParams,
  WaitForWithdrawalOptions,
} from '../clients/partner-withdrawals.js';
import type { PortfolioClient, ListPositionsParams } from '../clients/portfolio.js';
import type { QuotesClient, BuyQuoteParams, SellQuoteParams } from '../clients/quotes.js';
import type {
  RedemptionsClient,
  CreateRedemptionOptions,
  RedemptionCreateResult,
} from '../clients/redemptions.js';
import type { TracesClient } from '../clients/traces.js';
import type {
  TradesClient,
  CreateTradeOptions,
  TradeConfirmation,
  TradeCreateResult,
  WaitForCompletionOptions,
} from '../clients/trades.js';
import type {
  WebhooksClient,
  ListWebhookEventsParams,
  RotatedWebhookSecret,
  VerifySignatureOptions,
  VerifySignatureResult,
} from '../clients/webhooks.js';
import type { AccountRequestOverrides } from '../internal/request-options.js';
import type { AccountUsage } from '../schemas/account.js';
import type { BalanceResource } from '../schemas/balance.js';
import type {
  ListMarketsParams,
  ListPredictionsParams,
  MarketResource,
  PredictionResource,
} from '../schemas/market.js';
import type { PortfolioSummary, PositionResource } from '../schemas/portfolio.js';
import type { Quote, QuoteBuyDetail, QuoteSellDetail } from '../schemas/quote.js';
import type { TraceResource } from '../schemas/trace.js';
import type { ConstructedWebhookEvent } from '../schemas/webhook-event.js';
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
    body: { token: string },
    opts?: AccountRequestOverrides
  ) => TradeResource | Promise<TradeResource>;
  readonly get?: (
    id: string,
    opts?: AccountRequestOverrides
  ) => TradeResource | Promise<TradeResource>;
  readonly list?: (
    params?: ListTradesParams,
    opts?: AccountRequestOverrides
  ) => MockListResult<TradeResource>;
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
  readonly get?: (opts?: AccountRequestOverrides) => PortfolioSummary | Promise<PortfolioSummary>;
  readonly positions?: (
    params?: ListPositionsParams,
    opts?: AccountRequestOverrides
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
  ) => ConstructedWebhookEvent | Promise<ConstructedWebhookEvent>;
};

export type MockAccountOverrides = {
  readonly usage?: () => AccountUsage | Promise<AccountUsage>;
};

export type MockTracesOverrides = {
  readonly get?: (
    correlationId: string,
    opts?: AccountRequestOverrides
  ) => TraceResource | Promise<TraceResource>;
};

/**
 * `balance.get` receives the call's options, so a handler can answer per
 * `account`.
 */
export type MockBalanceOverrides = {
  readonly get?: (opts?: AccountRequestOverrides) => BalanceResource | Promise<BalanceResource>;
};

export type MockPartnerWithdrawalsOverrides = {
  readonly quote?: (
    accountId: string,
    params: PartnerWithdrawalQuoteParams
  ) => PartnerWithdrawalQuote | Promise<PartnerWithdrawalQuote>;
  readonly create?: (
    accountId: string,
    body: CreatePartnerWithdrawalBody,
    opts: CreatePartnerWithdrawalOptions
  ) => PartnerWithdrawalCreateResult | Promise<PartnerWithdrawalCreateResult>;
  readonly get?: (
    accountId: string,
    withdrawalId: string
  ) => PartnerWithdrawalResource | Promise<PartnerWithdrawalResource>;
  readonly list?: (
    accountId: string,
    params?: ListPartnerWithdrawalsParams
  ) => MockListResult<PartnerWithdrawalResource>;
  readonly waitForCompletion?: (
    accountId: string,
    withdrawalId: string,
    opts?: WaitForWithdrawalOptions
  ) => PartnerWithdrawalResource | Promise<PartnerWithdrawalResource>;
};

export type MockPartnerAccountsOverrides = {
  readonly create?: (
    body: CreatePartnerAccountBody,
    opts?: PartnerAccountWriteOptions
  ) => PartnerAccountCreateResult | Promise<PartnerAccountCreateResult>;
  readonly get?: (accountId: string) => PartnerAccountResource | Promise<PartnerAccountResource>;
  readonly findByExternalId?: (
    externalId: string
  ) => PartnerAccountResource | null | Promise<PartnerAccountResource | null>;
  readonly list?: (params?: ListPartnerAccountsParams) => MockListResult<PartnerAccountResource>;
  readonly update?: (
    accountId: string,
    body: UpdatePartnerAccountBody,
    opts?: PartnerAccountWriteOptions
  ) => PartnerAccountResource | Promise<PartnerAccountResource>;
  readonly suspend?: (
    accountId: string,
    opts?: PartnerAccountWriteOptions
  ) => PartnerAccountResource | Promise<PartnerAccountResource>;
  readonly reactivate?: (
    accountId: string,
    opts?: PartnerAccountWriteOptions
  ) => PartnerAccountResource | Promise<PartnerAccountResource>;
  readonly release?: (
    accountId: string,
    opts?: PartnerAccountWriteOptions
  ) => PartnerAccountResource | Promise<PartnerAccountResource>;
  readonly waitUntilActive?: (
    accountId: string,
    opts?: WaitUntilActiveOptions
  ) => PartnerAccountResource | Promise<PartnerAccountResource>;
  readonly withdrawals?: MockPartnerWithdrawalsOverrides;
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
  readonly balance?: MockBalanceOverrides;
  readonly partnerAccounts?: MockPartnerAccountsOverrides;
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
 * The mock client surface: the real sub-client methods, picked by name, so
 * every mocked method takes exactly the real method's parameters (options
 * included) and returns its type. List methods return a {@link Page};
 * consumers can iterate or read `.data`.
 */
export type MockKashClient = {
  readonly markets: Pick<MarketsClient, 'list' | 'get' | 'predictions'>;
  readonly trades: Pick<TradesClient, 'create' | 'confirm' | 'get' | 'list' | 'waitForCompletion'>;
  readonly redemptions: Pick<RedemptionsClient, 'create'>;
  /** Every public quote method (`keyof` excludes the private transport). */
  readonly quotes: Pick<QuotesClient, keyof QuotesClient>;
  /** `watchPositions` is not mocked: it polls forever by design; stub it in the test that needs it. */
  readonly portfolio: Pick<PortfolioClient, 'get' | 'positions'>;
  readonly webhooks: Pick<
    WebhooksClient,
    'list' | 'redeliver' | 'rotateSecret' | 'verifySignature' | 'constructEvent'
  >;
  readonly account: Pick<AccountClient, 'usage'>;
  readonly traces: Pick<TracesClient, 'get'>;
  readonly balance: Pick<BalanceClient, 'get'>;
  readonly partnerAccounts: Pick<
    PartnerAccountsClient,
    | 'create'
    | 'get'
    | 'findByExternalId'
    | 'list'
    | 'update'
    | 'suspend'
    | 'reactivate'
    | 'release'
    | 'waitUntilActive'
  > & {
    readonly withdrawals: Pick<
      PartnerWithdrawalsClient,
      'quote' | 'create' | 'get' | 'list' | 'waitForCompletion'
    >;
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
  const b = overrides.balance ?? {};
  const pa = overrides.partnerAccounts ?? {};
  const pw = pa.withdrawals ?? {};

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
        parseRequestBody(CreateTradeBodySchema, body, 'trades.create');
        checkOptions(opts);
        return t.create ? t.create(body, opts) : defaultTradeCreate(body);
      },
      confirm: async (id: string, body: { token: string }, opts?: AccountRequestOverrides) => {
        checkOptions(opts);
        return t.confirm
          ? t.confirm(id, body, opts)
          : { ...DEFAULT_TRADE, id, status: 'pending' as const };
      },
      get: async (id: string, opts?: AccountRequestOverrides) => {
        checkOptions(opts);
        return t.get ? t.get(id, opts) : { ...DEFAULT_TRADE, id };
      },
      list: async (params?: ListTradesParams, opts?: AccountRequestOverrides) => {
        checkOptions(opts);
        const limit = params?.limit ?? 20;
        const result = t.list ? await t.list(params, opts) : [DEFAULT_TRADE];
        return toMockPage(result, limit);
      },
      waitForCompletion: async (id: string, opts?: WaitForCompletionOptions) => {
        checkOptions(opts);
        const result = t.waitForCompletion
          ? await t.waitForCompletion(id, opts)
          : { ...DEFAULT_COMPLETED_TRADE, id };
        opts?.onStatus?.(result);
        return result;
      },
    },
    redemptions: {
      create: async (body: CreateRedemptionBody, opts?: CreateRedemptionOptions) => {
        // Same fail-fast checks as the real client.
        parseRequestBody(CreateRedemptionBodySchema, body, 'redemptions.create');
        checkOptions(opts);
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
      get: async (opts?: AccountRequestOverrides) => {
        checkOptions(opts);
        return p.get ? p.get(opts) : DEFAULT_PORTFOLIO_SUMMARY;
      },
      positions: async (params?: ListPositionsParams, opts?: AccountRequestOverrides) => {
        checkOptions(opts);
        return p.positions ? p.positions(params, opts) : [DEFAULT_POSITION];
      },
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
        return parseWebhookEvent(body);
      },
    },
    account: {
      usage: async () => (a.usage ? a.usage() : DEFAULT_ACCOUNT_USAGE),
    },
    traces: {
      get: async (correlationId: string, opts?: AccountRequestOverrides) => {
        checkOptions(opts);
        return tr.get ? tr.get(correlationId, opts) : { ...DEFAULT_TRACE, correlationId };
      },
    },
    balance: {
      get: async (opts?: AccountRequestOverrides) => {
        checkOptions(opts);
        return b.get ? b.get(opts) : DEFAULT_BALANCE;
      },
    },
    // The partner methods mirror the real client's client-side checks (body
    // schemas, UUID ids, the required withdrawal key), so a test of the bad
    // input path sees the same throw it would in production.
    partnerAccounts: {
      create: async (body: CreatePartnerAccountBody, opts?: PartnerAccountWriteOptions) => {
        const parsed = parseRequestBody(
          CreatePartnerAccountBodySchema,
          body,
          'partnerAccounts.create'
        );
        checkOptions(opts);
        if (pa.create) return pa.create(body, opts);
        return {
          account: {
            ...DEFAULT_PARTNER_ACCOUNT,
            externalId: parsed.externalId,
            destination: parsed.destination,
            country: parsed.country,
            status: 'provisioning',
            depositAddress: null,
          },
          outcome: 'created',
          idempotentReplay: false,
        } satisfies PartnerAccountCreateResult;
      },
      get: async (accountId: string) => {
        validateUuid(accountId, 'accountId');
        return pa.get ? pa.get(accountId) : { ...DEFAULT_PARTNER_ACCOUNT, accountId };
      },
      findByExternalId: async (externalId: string) => {
        const id = parseRequestBody(
          PartnerExternalIdSchema,
          externalId,
          'partnerAccounts.findByExternalId: externalId'
        );
        return pa.findByExternalId
          ? pa.findByExternalId(id)
          : { ...DEFAULT_PARTNER_ACCOUNT, externalId: id };
      },
      list: async (params?: ListPartnerAccountsParams) => {
        const limit = pageLimit(params?.limit, 'partnerAccounts.list');
        const result = pa.list ? await pa.list(params) : [DEFAULT_PARTNER_ACCOUNT];
        return toMockPage(result, limit);
      },
      update: async (
        accountId: string,
        body: UpdatePartnerAccountBody,
        opts?: PartnerAccountWriteOptions
      ) => {
        validateUuid(accountId, 'accountId');
        checkOptions(opts);
        const parsed = parseRequestBody(
          UpdatePartnerAccountBodySchema,
          body,
          'partnerAccounts.update'
        );
        if (pa.update) return pa.update(accountId, body, opts);
        return {
          ...DEFAULT_PARTNER_ACCOUNT,
          accountId,
          ...(parsed.destination === undefined ? {} : { destination: parsed.destination }),
          ...(parsed.country === undefined ? {} : { country: parsed.country }),
        };
      },
      suspend: async (accountId: string, opts?: PartnerAccountWriteOptions) => {
        validateUuid(accountId, 'accountId');
        checkOptions(opts);
        return pa.suspend
          ? pa.suspend(accountId, opts)
          : { ...DEFAULT_PARTNER_ACCOUNT, accountId, status: 'suspended' };
      },
      reactivate: async (accountId: string, opts?: PartnerAccountWriteOptions) => {
        validateUuid(accountId, 'accountId');
        checkOptions(opts);
        return pa.reactivate
          ? pa.reactivate(accountId, opts)
          : { ...DEFAULT_PARTNER_ACCOUNT, accountId, status: 'active' };
      },
      release: async (accountId: string, opts?: PartnerAccountWriteOptions) => {
        validateUuid(accountId, 'accountId');
        checkOptions(opts);
        return pa.release
          ? pa.release(accountId, opts)
          : { ...DEFAULT_PARTNER_ACCOUNT, accountId, status: 'released' };
      },
      waitUntilActive: async (accountId: string, opts?: WaitUntilActiveOptions) => {
        validateUuid(accountId, 'accountId');
        const result = pa.waitUntilActive
          ? await pa.waitUntilActive(accountId, opts)
          : { ...DEFAULT_PARTNER_ACCOUNT, accountId };
        opts?.onStatus?.(result);
        return result;
      },
      withdrawals: {
        quote: async (accountId: string, params: PartnerWithdrawalQuoteParams) => {
          validateUuid(accountId, 'accountId');
          const parsed = parseRequestBody(
            CreatePartnerWithdrawalBodySchema,
            params,
            'partnerAccounts.withdrawals.quote'
          );
          return pw.quote
            ? pw.quote(accountId, params)
            : defaultWithdrawalQuote(parsed.amountAtomic);
        },
        create: async (
          accountId: string,
          body: CreatePartnerWithdrawalBody,
          opts: CreatePartnerWithdrawalOptions
        ) => {
          validateUuid(accountId, 'accountId');
          const parsed = parseRequestBody(
            CreatePartnerWithdrawalBodySchema,
            body,
            'partnerAccounts.withdrawals.create'
          );
          requireIdempotencyKey(
            (opts as Partial<CreatePartnerWithdrawalOptions> | undefined)?.idempotencyKey,
            'partnerAccounts.withdrawals.create'
          );
          checkOptions(opts);
          if (pw.create) return pw.create(accountId, body, opts);
          return {
            withdrawal: {
              ...DEFAULT_PARTNER_WITHDRAWAL,
              accountId,
              amountAtomic: parsed.amountAtomic,
            },
            outcome: 'created',
            idempotentReplay: false,
          } satisfies PartnerWithdrawalCreateResult;
        },
        get: async (accountId: string, withdrawalId: string) => {
          validateUuid(accountId, 'accountId');
          validateUuid(withdrawalId, 'withdrawalId');
          return pw.get
            ? pw.get(accountId, withdrawalId)
            : { ...DEFAULT_PARTNER_WITHDRAWAL, accountId, withdrawalId };
        },
        list: async (accountId: string, params?: ListPartnerWithdrawalsParams) => {
          validateUuid(accountId, 'accountId');
          const limit = pageLimit(params?.limit, 'partnerAccounts.withdrawals.list');
          const result = pw.list
            ? await pw.list(accountId, params)
            : [{ ...DEFAULT_PARTNER_WITHDRAWAL, accountId }];
          return toMockPage(result, limit);
        },
        waitForCompletion: async (
          accountId: string,
          withdrawalId: string,
          opts?: WaitForWithdrawalOptions
        ) => {
          validateUuid(accountId, 'accountId');
          validateUuid(withdrawalId, 'withdrawalId');
          const result = pw.waitForCompletion
            ? await pw.waitForCompletion(accountId, withdrawalId, opts)
            : { ...DEFAULT_PARTNER_WITHDRAWAL, accountId, withdrawalId, status: 'completed' };
          opts?.onStatus?.(result);
          return result;
        },
      },
    },
    healthCheck: async () =>
      overrides.healthCheck
        ? overrides.healthCheck()
        : ({ ok: true, latencyMs: 1, status: 'ok', version: 'mock' } satisfies HealthCheckResult),
  };
}

// ---- Internals --------------------------------------------------------

/**
 * The default quote for `amountAtomic`: the fixture's Arc destination, which
 * charges the network fee on top, so the debit is the amount plus the fee.
 */
function defaultWithdrawalQuote(amountAtomic: string): PartnerWithdrawalQuote {
  const fee = DEFAULT_PARTNER_WITHDRAWAL_QUOTE.networkFeeAtomic;
  return {
    ...DEFAULT_PARTNER_WITHDRAWAL_QUOTE,
    amountAtomic,
    ...(fee === undefined
      ? {}
      : { totalDebitAtomic: (BigInt(amountAtomic) + BigInt(fee)).toString() }),
  };
}

/** The real client's option checks: a UUID `account`, a well-formed `Idempotency-Key`. */
function checkOptions(opts?: {
  readonly account?: string | undefined;
  readonly idempotencyKey?: string | undefined;
}): void {
  if (opts?.account !== undefined) validateUuid(opts.account, 'account');
  if (opts?.idempotencyKey !== undefined) validateIdempotencyKey(opts.idempotencyKey);
}

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
  DEFAULT_BALANCE,
  DEFAULT_COMPLETED_TRADE,
  DEFAULT_MARKET,
  DEFAULT_PARTNER_ACCOUNT,
  DEFAULT_PARTNER_WITHDRAWAL,
  DEFAULT_PARTNER_WITHDRAWAL_QUOTE,
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

export { generateTestWebhookSignature } from './webhook-signature.js';
export type { GenerateTestWebhookSignatureInput } from './webhook-signature.js';

// Re-export the confirmation-flag helper type — handy for callers
// constructing an awaiting-confirmation TradeCreateResult.
export type { TradeConfirmation };
