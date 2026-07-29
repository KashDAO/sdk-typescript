/**
 * Default sample resources used by the mock client.
 *
 * Every fixture passes the corresponding wire-shape Zod schema in
 * `tests/contract/wire-shape.test.ts` — so an unconfigured mock client
 * returns data that's structurally indistinguishable from a real
 * production response.
 *
 * Fixtures are deliberately deterministic (fixed UUIDs, fixed
 * timestamps) so tests using them stay reproducible.
 */

import type { AccountUsage } from '../schemas/account.js';
import type { MarketResource, PredictionResource } from '../schemas/market.js';
import type { PortfolioSummary, PositionResource } from '../schemas/portfolio.js';
import type {
  Quote,
  QuoteBuyDetail,
  QuoteMarketSummary,
  QuoteSellDetail,
} from '../schemas/quote.js';
import type { TraceResource } from '../schemas/trace.js';
import type { TradeResource } from '../schemas/trade.js';
import type { RedeliverWebhookEvent, WebhookEventResource } from '../schemas/webhook.js';

const ISO_FIXED = '2026-04-30T12:00:00.000Z';
const MARKET_ID = '11111111-1111-4111-8111-111111111111';
const TRADE_ID = '22222222-2222-4222-8222-222222222222';
const CORRELATION_ID = '33333333-3333-4333-8333-333333333333';

/** Default {@link MarketResource} — a 2-outcome ACTIVE market. */
export const DEFAULT_MARKET: MarketResource = {
  id: MARKET_ID,
  contractAddress: '0x0000000000000000000000000000000000000001',
  chainId: 8453,
  title: 'Will the price of ETH exceed $5,000 by year end?',
  description: 'Resolves YES if ETH closes above $5,000 on Dec 31.',
  status: 'ACTIVE',
  outcomeCount: 2,
  outcomes: [
    { index: 0, label: 'Yes', probability: 0.42 },
    { index: 1, label: 'No', probability: 0.58 },
  ],
  imageUrl: null,
  createdAt: ISO_FIXED,
  expiresAt: '2026-12-31T23:59:59.000Z',
  freezeAt: '2026-12-31T23:54:59.000Z',
  resolvedAt: null,
};

/** Default {@link PredictionResource} — a 100-USDC buy on outcome 0. */
export const DEFAULT_PREDICTION: PredictionResource = {
  id: '44444444-4444-4444-8444-444444444444',
  marketId: MARKET_ID,
  outcomeIndex: 0,
  side: 'buy',
  usdcIn: '100000000',
  usdcOut: null,
  tokensIn: null,
  tokensOut: '237340124711760000000',
  price: '0.42',
  probability: '0.42',
  timestamp: ISO_FIXED,
  blockNumber: '12345678',
  transactionHash: `0x${'a'.repeat(64)}`,
  logIndex: 0,
};

/** Default {@link TradeResource} — a `pending` 100-USDC buy. */
export const DEFAULT_TRADE: TradeResource = {
  id: TRADE_ID,
  marketId: MARKET_ID,
  outcomeIndex: 0,
  amount: '100',
  side: 'buy',
  status: 'pending',
  correlationId: CORRELATION_ID,
  clientRequestId: null,
  txHash: null,
  tokensOut: null,
  errorCode: null,
  errorMessage: null,
  webhookDelivery: null,
  metadata: {},
  createdAt: ISO_FIXED,
  updatedAt: ISO_FIXED,
};

/** Convenience — a {@link TradeResource} in the `completed` terminal state. */
export const DEFAULT_COMPLETED_TRADE: TradeResource = {
  ...DEFAULT_TRADE,
  status: 'completed',
  txHash: `0x${'b'.repeat(64)}`,
  tokensOut: '237340124711760000000',
};

/** Default {@link PortfolioSummary} — three active positions. */
export const DEFAULT_PORTFOLIO_SUMMARY: PortfolioSummary = {
  smartAccountAddress: '0x0000000000000000000000000000000000000abc',
  activePositions: 3,
  totalCostBasisAtomic: '300000000',
};

/** Default {@link PositionResource} — 100-USDC cost basis on outcome 0. */
export const DEFAULT_POSITION: PositionResource = {
  marketId: MARKET_ID,
  outcomeIndex: 0,
  shares: '237340124711760000000',
  costBasisAtomic: '100000000',
  tradeCount: 1,
  firstTradeAt: ISO_FIXED,
  lastTradeAt: ISO_FIXED,
};

const DEFAULT_QUOTE_MARKET_SUMMARY: QuoteMarketSummary = {
  id: MARKET_ID,
  contractAddress: '0x0000000000000000000000000000000000000001',
  chainId: 8453,
  outcomes: [
    { index: 0, label: 'Yes', probability: 0.42 },
    { index: 1, label: 'No', probability: 0.58 },
  ],
  status: 'ACTIVE',
};

const DEFAULT_QUOTE_BUY_DETAIL: QuoteBuyDetail = {
  action: 'buy',
  outcomeIndex: 0,
  amountIn: '100000000',
  tokensOut: '237340124711760000000',
  reserveAfter: '500000000000000000000',
  c: '1000000000000000000',
  pAfter: ['440000000000000000', '560000000000000000'],
  qAfter: ['737340124711760000000', '500000000000000000000'],
  effectivePrice: 0.421,
  impliedProbability: 0.44,
};

const DEFAULT_QUOTE_SELL_DETAIL: QuoteSellDetail = {
  action: 'sell',
  outcomeIndex: 0,
  tokensIn: '1000000000000000000',
  usdcOut: '420000',
  grossRelease: '1000000000000000000',
  reserveAfter: '499000000000000000000',
  c: '1000000000000000000',
  pAfter: ['418000000000000000', '582000000000000000'],
  qAfter: ['736340124711760000000', '500000000000000000000'],
  effectivePrice: 0.42,
  impliedProbability: 0.418,
};

/** Default buy {@link Quote} — projected outcome of a 100-USDC buy on outcome 0. */
export const DEFAULT_QUOTE_BUY: Quote & QuoteBuyDetail = {
  ...DEFAULT_QUOTE_BUY_DETAIL,
  market: DEFAULT_QUOTE_MARKET_SUMMARY,
};

/** Default sell {@link Quote} — projected outcome of a 1-token sell on outcome 0. */
export const DEFAULT_QUOTE_SELL: Quote & QuoteSellDetail = {
  ...DEFAULT_QUOTE_SELL_DETAIL,
  market: DEFAULT_QUOTE_MARKET_SUMMARY,
};

/** Default {@link RedeliverWebhookEvent} — the result of an event redeliver. */
export const DEFAULT_REDELIVER_EVENT: RedeliverWebhookEvent = {
  id: '55555555-5555-4555-8555-555555555555',
  eventType: 'trade.completed',
  apiKeyId: '66666666-6666-4666-8666-666666666666',
  tradeRequestId: TRADE_ID,
  emittedAt: ISO_FIXED,
  lastDeliveredAt: ISO_FIXED,
  deliveryAttempts: 1,
};

/** Default {@link WebhookEventResource} — one row of `kash.webhooks.list()`. */
export const DEFAULT_WEBHOOK_EVENT: WebhookEventResource = {
  id: '77777777-7777-4777-8777-777777777777',
  eventType: 'trade.completed',
  tradeRequestId: TRADE_ID,
  emittedAt: ISO_FIXED,
  outboxEmittedAt: ISO_FIXED,
  replayCount: 0,
  status: 'delivered',
  delivery: {
    attempts: 1,
    lastAttemptedAt: ISO_FIXED,
    lastDeliveredAt: ISO_FIXED,
    lastStatusCode: 200,
    lastFailureCode: null,
    lastErrorMessage: null,
    terminalFailureAt: null,
  },
};

/** Default {@link AccountUsage} — non-zero, mid-volume profile. */
export const DEFAULT_ACCOUNT_USAGE: AccountUsage = {
  apiKeyId: '88888888-8888-4888-8888-888888888888',
  generatedAt: ISO_FIXED,
  trades: {
    '24h': {
      total: 12,
      completed: 11,
      failed: 1,
      successRate: 0.9166666666666667,
      latencyMs: { p50: 850, p99: 4_200 },
    },
    '7d': { total: 87, completed: 84, failed: 3, successRate: 0.9655172413793104 },
    '30d': { total: 350, completed: 335, failed: 15, successRate: 0.9571428571428572 },
  },
  webhooks: {
    '7d': { emitted: 84, delivered: 82, failed: 2, successRate: 0.9761904761904762 },
  },
  auth: {
    '24h': { failures: 0, rateLimitRejections: 0 },
  },
};

/** Default {@link TraceResource} — a 2-event timeline (intent + executed). */
export const DEFAULT_TRACE: TraceResource = {
  correlationId: '99999999-9999-4999-8999-999999999999',
  events: [
    {
      type: 'com.kash.intent.parsed.v1',
      occurredAt: ISO_FIXED,
      sequenceNumber: 0,
      data: {
        tradeId: TRADE_ID,
        marketId: MARKET_ID,
        outcomeIndex: 0,
        side: 'buy',
        amount: '100',
      },
    },
    {
      type: 'com.kash.trade.executed.v1',
      occurredAt: ISO_FIXED,
      sequenceNumber: 3,
      data: {
        tradeId: TRADE_ID,
        txHash: `0x${'b'.repeat(64)}`,
        tokensOut: '237340124711760000000',
      },
    },
  ],
};
