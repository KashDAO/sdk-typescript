/**
 * @kashdao/sdk — official TypeScript client for the Kash public API.
 *
 * @example
 * ```ts
 * import { KashClient, KashRateLimitError } from '@kashdao/sdk';
 *
 * const kash = new KashClient({ apiKey: process.env.KASH_API_KEY });
 *
 * try {
 *   const trade = await kash.trades.create({
 *     marketId: 'market-uuid',
 *     outcomeIndex: 0,
 *     amount: '100',
 *     side: 'buy',
 *   });
 *   if (trade.confirmation) {
 *     await kash.trades.confirm(trade.id, { token: trade.confirmation.token });
 *   }
 *   const completed = await kash.trades.waitForCompletion(trade.id, {
 *     timeoutMs: 60_000,
 *   });
 *   console.log('done:', completed.txHash);
 * } catch (err) {
 *   if (err instanceof KashRateLimitError) {
 *     console.error(`rate limited; retry in ${err.retryAfterSeconds}s`);
 *   }
 *   throw err;
 * }
 * ```
 */

export { KashClient } from './client.js';
export type { HealthCheckResult } from './client.js';
export { SDK_API_VERSION, SDK_VERSION, USER_AGENT } from './internal/version.js';

export {
  API_KEY_SHAPE,
  PRODUCTION_BASE_URL,
  STAGING_BASE_URL,
  inferBaseUrlFromApiKey,
} from './internal/config.js';
export type { KashClientConfig, KashClientConfigInput, FetchLike } from './internal/config.js';
export type { RequestOverrides } from './internal/http.js';
export type {
  ErrorHookEvent,
  KashClientHooks,
  RateLimitState,
  RequestHookEvent,
  ResponseHookEvent,
  RetryHookEvent,
  ServerDeprecationNotice,
} from './internal/config.js';

// Errors — every consumer branches on these.
export {
  KashAbortedError,
  KashAuthenticationError,
  KashAuthorizationError,
  KashConfigurationError,
  KashConflictError,
  KashError,
  KashMaintenanceError,
  KashNetworkError,
  KashNotFoundError,
  KashRateLimitError,
  KashServerError,
  KashTimeoutError,
  KashValidationError,
  KashWebhookSignatureError,
  classifyHttpError,
} from './errors.js';
export type {
  ClassifyHttpErrorInput,
  KashConfigurationErrorInit,
  KashConfigurationIssue,
  KashErrorContext,
  KashErrorInit,
  KashRateLimitErrorInit,
  KashValidationIssue,
  ProblemDetailsLike,
} from './errors.js';

// Pagination primitive — exposed so consumers can type their own
// helpers around the `Page<T>` shape.
export { Page } from './internal/pagination.js';

// Type-narrowing helpers — saves consumers from spelling the status
// enum inline; encourages readable branching code.
export {
  isAwaitingConfirmation,
  isCompletedTrade,
  isFailedTrade,
  isPendingTrade,
  isRejectedTrade,
  isTerminalTrade,
} from './guards.js';
export type {
  AwaitingConfirmationTrade,
  CompletedTrade,
  FailedTrade,
  PendingTrade,
  RejectedTrade,
  TerminalTrade,
} from './guards.js';

// Schemas + types — exported so consumers can compose around the
// resource shapes (e.g. typing their own caches).
export { ProblemDetailsSchema, PaginationSchema, MetaSchema } from './schemas/common.js';
export type { ProblemDetails, Pagination, Meta } from './schemas/common.js';

export {
  GetMarketResponseSchema,
  ListMarketsResponseSchema,
  ListPredictionsResponseSchema,
  MarketOutcomeSchema,
  MarketResolutionStateSchema,
  MarketResourceSchema,
  MarketStatusSchema,
  PredictionResourceSchema,
} from './schemas/market.js';
export type {
  GetMarketResponse,
  ListMarketsParams,
  ListMarketsResponse,
  ListPredictionsParams,
  ListPredictionsResponse,
  MarketOutcome,
  MarketResolutionState,
  MarketResource,
  MarketStatus,
  PredictionResource,
} from './schemas/market.js';

export {
  ClientRequestIdSchema,
  ConfirmTradeBodySchema,
  ConfirmTradeResponseSchema,
  CreateTradeAcceptedResponseSchema,
  CreateTradeBodySchema,
  CreateTradeCreatedResponseSchema,
  CreateTradeResponseSchema,
  GetTradeResponseSchema,
  ListTradesResponseSchema,
  TERMINAL_TRADE_STATUSES,
  TradeMetadataSchema,
  TradeResourceSchema,
  TradeSideSchema,
  TradeStatusSchema,
  UsdcAmountSchema,
} from './schemas/trade.js';
export type {
  ClientRequestId,
  ConfirmTradeBody,
  ConfirmTradeResponse,
  CreateTradeAcceptedResponse,
  CreateTradeBody,
  CreateTradeCreatedResponse,
  CreateTradeResponse,
  GetTradeResponse,
  ListTradesParams,
  ListTradesResponse,
  TradeMetadata,
  TradeResource,
  TradeSide,
  TradeStatus,
  UsdcAmount,
} from './schemas/trade.js';

export {
  PortfolioSummaryResponseSchema,
  PortfolioSummarySchema,
  PositionResourceSchema,
  PositionsResponseSchema,
} from './schemas/portfolio.js';
export type {
  PortfolioSummary,
  PortfolioSummaryResponse,
  PositionResource,
  PositionsResponse,
} from './schemas/portfolio.js';

export {
  GetTraceResponseSchema,
  TraceEventDataSchema,
  TraceEventSchema,
  TraceResourceSchema,
} from './schemas/trace.js';
export type {
  GetTraceResponse,
  TraceEvent,
  TraceEventData,
  TraceResource,
} from './schemas/trace.js';

export {
  QuoteActionSchema,
  QuoteBuyDetailSchema,
  QuoteDetailSchema,
  QuoteMarketSummarySchema,
  QuoteResponseSchema,
  QuoteSellDetailSchema,
} from './schemas/quote.js';
export type {
  Quote,
  QuoteAction,
  QuoteBuyDetail,
  QuoteDetail,
  QuoteMarketSummary,
  QuoteResponse,
  QuoteSellDetail,
} from './schemas/quote.js';

export {
  ListWebhookEventsResponseSchema,
  RedeliverWebhookEventSchema,
  RedeliverWebhookResponseSchema,
  RotateWebhookSecretResponseSchema,
  WebhookEventResourceSchema,
} from './schemas/webhook.js';
export type {
  ListWebhookEventsResponse,
  RedeliverWebhookEvent,
  RedeliverWebhookResponse,
  RotateWebhookSecretResponse,
  WebhookEventResource,
} from './schemas/webhook.js';

// Webhook delivery payloads — the body the customer's endpoint
// receives. Distinct from the management surface above.
export {
  TradeCompletedPayloadSchema,
  TradeConfirmationRequiredPayloadSchema,
  TradeFailedPayloadSchema,
  WebhookEventSchema,
} from './schemas/webhook-event.js';
export type {
  TradeCompletedPayload,
  TradeConfirmationRequiredPayload,
  TradeFailedPayload,
  WebhookEvent,
  WebhookEventType,
} from './schemas/webhook-event.js';

export {
  CreateRedemptionBodySchema,
  CreateRedemptionResponseSchema,
  RedemptionKindSchema,
  RedemptionResourceSchema,
} from './schemas/redemption.js';
export type {
  CreateRedemptionBody,
  CreateRedemptionResponse,
  RedemptionKind,
  RedemptionResource,
} from './schemas/redemption.js';

// Typed view of the `chainRef` string every resource carries from API
// version 2026-08-19.
export { SOLANA_CLUSTERS, formatChainRef, parseChainRef, tryParseChainRef } from './chain-ref.js';
export type { ChainRef, SolanaCluster } from './chain-ref.js';

// Resource client classes — exposed so consumers can type their own
// dependency-injection helpers (and the contract test asserts they
// remain stable).
export { MarketsClient } from './clients/markets.js';
export { TradesClient } from './clients/trades.js';
export type {
  CreateTradeOptions,
  TradeConfirmation,
  TradeCreateResult,
  WaitForCompletionOptions,
} from './clients/trades.js';
export { RedemptionsClient } from './clients/redemptions.js';
export type { CreateRedemptionOptions, RedemptionCreateResult } from './clients/redemptions.js';
export { PortfolioClient } from './clients/portfolio.js';
export type { ListPositionsParams } from './clients/portfolio.js';
export { AccountClient } from './clients/account.js';
export { AccountUsageResponseSchema, AccountUsageSchema } from './schemas/account.js';
export type { AccountUsage, AccountUsageResponse } from './schemas/account.js';
export { QuotesClient } from './clients/quotes.js';
export type { BuyQuoteParams, SellQuoteParams } from './clients/quotes.js';
export { TracesClient } from './clients/traces.js';
export { WebhooksClient } from './clients/webhooks.js';
export type {
  ListWebhookEventsParams,
  RotatedWebhookSecret,
  VerifySignatureOptions,
  VerifySignatureResult,
} from './clients/webhooks.js';

// Self-orchestrated / direct-to-chain mode is intentionally NOT
// re-exported here. It lives in its own package: `@kashdao/protocol-sdk`.
// Both packages are non-custodial — user funds always live in
// Privy-managed MPC smart accounts the user controls; Kash never holds
// keys. The packages are split because the protocol-sdk path requires
// viem + an RPC + a signer, and API-only consumers shouldn't pay that
// dependency cost.
