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
import type { BalanceResource } from '../schemas/balance.js';
import type { MarketResource, PredictionResource } from '../schemas/market.js';
import type { PartnerAccountResource } from '../schemas/partner-account.js';
import type {
  PartnerWithdrawalQuote,
  PartnerWithdrawalResource,
} from '../schemas/partner-withdrawal.js';
import type { PortfolioSummary, PositionResource } from '../schemas/portfolio.js';
import type {
  Quote,
  QuoteBuyDetail,
  QuoteMarketSummary,
  QuoteSellDetail,
} from '../schemas/quote.js';
import type { RedemptionResource } from '../schemas/redemption.js';
import type { TraceResource } from '../schemas/trace.js';
import type { TradeResource } from '../schemas/trade.js';
import type { RedeliverWebhookEvent, WebhookEventResource } from '../schemas/webhook.js';

const ISO_FIXED = '2026-04-30T12:00:00.000Z';
const MARKET_ID = '11111111-1111-4111-8111-111111111111';
const TRADE_ID = '22222222-2222-4222-8222-222222222222';
const CORRELATION_ID = '33333333-3333-4333-8333-333333333333';
/** Kash's canonical chain since 2026-10-01, as the API names it. */
const CHAIN_REF = 'solana:mainnet-beta';
/** A base58 Solana market account — synthetic, but in the real alphabet. */
const MARKET_ADDRESS = 'KashMarket11111111111111111111111111111111';

/**
 * Default {@link MarketResource} — a 2-outcome ACTIVE Solana mainnet market,
 * in the API version `2026-08-19` shape: `chainRef`, and no `chainId`.
 */
export const DEFAULT_MARKET: MarketResource = {
  id: MARKET_ID,
  contractAddress: MARKET_ADDRESS,
  chainRef: CHAIN_REF,
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
  resolution: null,
  resolutionState: null,
  tradeable: true,
  notTradeableReason: null,
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
  chainRef: CHAIN_REF,
  txHash: null,
  tokensOut: null,
  errorCode: null,
  errorMessage: null,
  webhookDelivery: null,
  metadata: {},
  createdAt: ISO_FIXED,
  updatedAt: ISO_FIXED,
};

/**
 * Convenience — a {@link TradeResource} in the `completed` terminal state.
 * `txHash` stays `null`: the API publishes no transaction hash for a Solana
 * trade on the trade resource.
 */
export const DEFAULT_COMPLETED_TRADE: TradeResource = {
  ...DEFAULT_TRADE,
  status: 'completed',
  tokensOut: '237340124711760000000',
};

/** Default {@link PortfolioSummary} — three active positions held by a Solana wallet. */
export const DEFAULT_PORTFOLIO_SUMMARY: PortfolioSummary = {
  smartAccountAddress: 'KashUser111111111111111111111111111111111111',
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
  contractAddress: MARKET_ADDRESS,
  chainRef: CHAIN_REF,
  outcomes: [
    { index: 0, label: 'Yes', probability: 0.42 },
    { index: 1, label: 'No', probability: 0.58 },
  ],
  status: 'ACTIVE',
  tradeable: true,
  notTradeableReason: null,
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
  // Raw units, as the API computes it: amountIn / tokensOut, atomic USDC per WAD token.
  effectivePrice: 100_000_000 / 237_340_124_711_760_000_000,
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
  // Raw units: usdcOut / tokensIn, atomic USDC per WAD token.
  effectivePrice: 420_000 / 1_000_000_000_000_000_000,
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

/** Default {@link RedemptionResource} — a pending redemption of the resolved outcome 0. */
export const DEFAULT_REDEMPTION: RedemptionResource = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  marketId: MARKET_ID,
  outcomeIndex: 0,
  kind: 'resolved',
  sharesWad: '237340124711760000000',
  status: 'pending',
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
        txHash:
          '3C7V6ugFiyv4Kq7VRWQHAA9qHcfGRosKP8WEyM9Lv2Uqa3SJkuT26t9YjhPzTKnvqZguVG3jjuUg2UHfqRKoLP97',
        tokensOut: '237340124711760000000',
      },
    },
  ],
};

// ---- Partner accounts, withdrawals and balance ------------------------

const PARTNER_ACCOUNT_ID = '66666666-6666-4666-8666-666666666666';
const PARTNER_WITHDRAWAL_ID = '77777777-7777-4777-8777-777777777777';
/** A synthetic base58 Solana wallet, in the real alphabet. */
const PARTNER_DEPOSIT_ADDRESS = 'KashPartnerWa11et1111111111111111111111111';
/** A synthetic Arc (EVM) address, lower case as the API stores it. */
const PARTNER_ARC_DESTINATION = {
  network: 'arc',
  address: '0x2c7536e3605d9c16a7a3d7b1898e529396a65c23',
} as const;

/** Default {@link PartnerAccountResource}: an active account withdrawing to Arc. */
export const DEFAULT_PARTNER_ACCOUNT: PartnerAccountResource = {
  accountId: PARTNER_ACCOUNT_ID,
  externalId: 'user-8841',
  status: 'active',
  depositAddress: PARTNER_DEPOSIT_ADDRESS,
  destination: PARTNER_ARC_DESTINATION,
  country: 'GB',
  createdAt: ISO_FIXED,
};

/** Default {@link PartnerWithdrawalResource}: a pending 2.5 USDC withdrawal to Arc. */
export const DEFAULT_PARTNER_WITHDRAWAL: PartnerWithdrawalResource = {
  withdrawalId: PARTNER_WITHDRAWAL_ID,
  accountId: PARTNER_ACCOUNT_ID,
  amountAtomic: '2500000',
  deliveredAmountAtomic: null,
  minimumDeliveredAtomic: null,
  status: 'pending',
  destination: PARTNER_ARC_DESTINATION,
  transactionHash: null,
  destinationTransactionHash: null,
  networkFeeAtomic: null,
  createdAt: ISO_FIXED,
  updatedAt: ISO_FIXED,
};

/** Default {@link PartnerWithdrawalQuote}: 2.5 USDC to Arc, a bridge minimum and estimate. */
export const DEFAULT_PARTNER_WITHDRAWAL_QUOTE: PartnerWithdrawalQuote = {
  amountAtomic: '2500000',
  destination: PARTNER_ARC_DESTINATION,
  receiveAtomic: '2490000',
  receiveEstimated: true,
  estimatedSeconds: 45,
  maxAmountAtomic: '24990000',
  // To Arc the fee is charged on top, so the debit is the amount plus the fee.
  networkFeeAtomic: '10000',
  networkFeeEstimated: true,
  totalDebitAtomic: '2510000',
};

/** Default {@link BalanceResource}: 25 USDC, 2.5 of it held by a pending withdrawal. */
export const DEFAULT_BALANCE: BalanceResource = {
  usdcAtomic: '25000000',
  pendingWithdrawalsAtomic: '2500000',
  availableAtomic: '22500000',
  observedAt: ISO_FIXED,
};
