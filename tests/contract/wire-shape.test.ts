/**
 * Wire-shape contract test — runs in both the monorepo AND the public
 * mirror repo's CI.
 *
 * Asserts that the SDK's local schemas parse the canonical wire shapes
 * the public API emits. The fixtures below are hand-written and
 * cross-checked against the API's Zod source by the **separate**
 * `api-drift.private.test.ts` file (monorepo-only — excluded from the
 * public mirror so it can run without monorepo access).
 *
 * If the API ever changes a response shape:
 *   1. The drift test fails first inside the monorepo CI (the API
 *      Zod schema rejects the SDK fixture, OR a structural diff).
 *   2. The fix is to update both the SDK schema AND the fixture in
 *      this file.
 *   3. The public mirror sync picks up the new fixture + schema and
 *      its CI re-validates the parity.
 *
 * This split is the standard "public client, private server" pattern
 * — the SDK can be open-sourced without exposing the server-side
 * Zod definitions.
 */

import { describe, expect, it } from 'vitest';

// SDK schemas — the consumer-facing copy.
import { AccountUsageResponseSchema, AccountUsageSchema } from '../../src/schemas/account.js';
import {
  GetMarketResponseSchema,
  ListMarketsResponseSchema,
  ListPredictionsResponseSchema,
  MarketResourceSchema,
  PredictionResourceSchema,
} from '../../src/schemas/market.js';
import {
  PortfolioSummaryResponseSchema,
  PositionResourceSchema,
  PositionsResponseSchema,
} from '../../src/schemas/portfolio.js';
import { QuoteResponseSchema } from '../../src/schemas/quote.js';
import {
  GetTraceResponseSchema,
  TraceEventSchema,
  TraceResourceSchema,
} from '../../src/schemas/trace.js';
import {
  ConfirmTradeBodySchema,
  ConfirmTradeResponseSchema,
  CreateTradeAcceptedResponseSchema,
  CreateTradeBodySchema,
  CreateTradeCreatedResponseSchema,
  GetTradeResponseSchema,
  ListTradesResponseSchema,
  TradeResourceSchema,
} from '../../src/schemas/trade.js';
import {
  ListWebhookEventsResponseSchema,
  RedeliverWebhookResponseSchema,
  RotateWebhookSecretResponseSchema,
  WebhookEventResourceSchema,
} from '../../src/schemas/webhook.js';
import {
  TradeCompletedPayloadSchema,
  TradeConfirmationRequiredPayloadSchema,
  TradeFailedPayloadSchema,
  WebhookEventSchema,
} from '../../src/schemas/webhook-event.js';

import type { z } from 'zod';

// -----------------------------------------------------------------
// Canonical wire-shape fixtures.
//
// These are the SOURCE OF TRUTH for what the public API emits as of
// the SDK version at the top of `package.json`. They MUST match the
// server-side Zod schemas — `api-drift.private.test.ts` (monorepo-
// only) verifies that side.
// -----------------------------------------------------------------

export const FIXTURE_MARKET = {
  id: '00000000-0000-0000-0000-000000000001',
  contractAddress: '0xabc',
  chainId: 8453,
  title: 'Will it rain?',
  description: 'A market about weather.',
  status: 'ACTIVE' as const,
  outcomeCount: 2,
  outcomes: [
    { index: 0, label: 'Yes', probability: 0.6 },
    { index: 1, label: 'No', probability: 0.4 },
  ],
  imageUrl: null,
  createdAt: '2026-04-30T12:00:00.000Z',
  expiresAt: '2026-05-30T12:00:00.000Z',
  freezeAt: '2026-05-30T11:55:00.000Z',
  resolvedAt: null,
  resolution: null,
  resolutionState: null,
};

export const FIXTURE_TRADE = {
  id: '00000000-0000-0000-0000-000000000010',
  marketId: '00000000-0000-0000-0000-000000000001',
  outcomeIndex: 0,
  amount: '100.500000',
  side: 'buy' as const,
  status: 'completed' as const,
  correlationId: '00000000-0000-0000-0000-000000000099',
  clientRequestId: null,
  txHash: '0x' + 'a'.repeat(64),
  tokensOut: '1234567890123456789',
  errorCode: null,
  errorMessage: null,
  webhookDelivery: {
    status: 'delivered' as const,
    attempts: 1,
    lastAttemptedAt: '2026-04-30T12:01:00.500Z',
    lastStatusCode: 200,
    lastFailureCode: null,
    terminalFailureAt: null,
  },
  metadata: { strategy: 'momentum-v2' },
  createdAt: '2026-04-30T12:00:00.000Z',
  updatedAt: '2026-04-30T12:01:00.000Z',
};

export const FIXTURE_POSITION = {
  marketId: '00000000-0000-0000-0000-000000000001',
  outcomeIndex: 0,
  shares: '1000000000000000000',
  costBasisAtomic: '50000000',
  tradeCount: 1,
  firstTradeAt: '2026-04-30T12:00:00.000Z',
  lastTradeAt: '2026-04-30T12:00:00.000Z',
};

export const FIXTURE_META = {
  requestId: 'req-1',
  timestamp: '2026-04-30T12:00:00.000Z',
};

export const FIXTURE_QUOTE_MARKET_SUMMARY = {
  id: '00000000-0000-0000-0000-000000000001',
  contractAddress: '0xabc',
  chainId: 8453,
  outcomes: [
    { index: 0, label: 'Yes', probability: 0.62 },
    { index: 1, label: 'No', probability: 0.38 },
  ],
  status: 'ACTIVE' as const,
};

export const FIXTURE_QUOTE_BUY = {
  action: 'buy' as const,
  outcomeIndex: 0,
  amountIn: '100000000', // 100 USDC atomic
  tokensOut: '149231587123456789012',
  reserveAfter: '500000000000000000000',
  c: '987654321987654321',
  pAfter: ['620000000000000000', '380000000000000000'],
  qAfter: ['1500000000000000000000', '1000000000000000000000'],
  effectivePrice: 0.6701234,
  impliedProbability: 0.62,
};

export const FIXTURE_QUOTE_SELL = {
  action: 'sell' as const,
  outcomeIndex: 0,
  tokensIn: '1000000000000000000', // 1 token WAD
  usdcOut: '618000',
  grossRelease: '620000000000000000',
  reserveAfter: '500000000000000000000',
  c: '987654321987654321',
  pAfter: ['620000000000000000', '380000000000000000'],
  qAfter: ['1499000000000000000000', '1000000000000000000000'],
  effectivePrice: 0.000000000000618,
  impliedProbability: 0.62,
};

export const FIXTURE_UNITS = { usdc: 'atomic-6' as const, token: 'wad-18' as const };

export const FIXTURE_TRACE_EVENT_INTENT = {
  type: 'com.kash.intent.parsed.v1',
  occurredAt: '2026-05-02T12:00:00.000Z',
  sequenceNumber: 0,
  data: {
    tradeId: '00000000-0000-0000-0000-000000000010',
    marketId: '00000000-0000-0000-0000-000000000001',
    outcomeIndex: 0,
    side: 'buy' as const,
    amount: '100',
  },
};

export const FIXTURE_TRACE_EVENT_EXECUTED = {
  type: 'com.kash.trade.executed.v1',
  occurredAt: '2026-05-02T12:00:03.000Z',
  sequenceNumber: 3,
  data: {
    tradeId: '00000000-0000-0000-0000-000000000010',
    txHash: '0x' + 'a'.repeat(64),
    tokensOut: '149231587123456789012',
  },
};

export const FIXTURE_TRACE = {
  correlationId: '33333333-3333-3333-3333-333333333333',
  events: [FIXTURE_TRACE_EVENT_INTENT, FIXTURE_TRACE_EVENT_EXECUTED],
};

export const FIXTURE_PREDICTION = {
  id: 'pred-01',
  marketId: '00000000-0000-0000-0000-000000000001',
  outcomeIndex: 0,
  side: 'buy' as const,
  usdcIn: '100000000',
  usdcOut: null,
  tokensIn: null,
  tokensOut: '149231587123456789012',
  price: '0.6701234',
  probability: '0.62',
  timestamp: '2026-04-30T12:00:00.000Z',
  blockNumber: '12345678',
  transactionHash: '0x' + 'a'.repeat(64),
  logIndex: 0,
};

export const FIXTURE_ACCOUNT_USAGE = {
  apiKeyId: '00000000-0000-0000-0000-000000000099',
  generatedAt: '2026-04-30T12:00:00.000Z',
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

export const FIXTURE_WEBHOOK_EVENT = {
  id: '00000000-0000-0000-0000-000000000020',
  eventType: 'trade.completed',
  tradeRequestId: '00000000-0000-0000-0000-000000000010',
  emittedAt: '2026-04-30T12:00:00.000Z',
  outboxEmittedAt: '2026-04-30T12:00:00.500Z',
  replayCount: 0,
  status: 'delivered' as const,
  delivery: {
    attempts: 1,
    lastAttemptedAt: '2026-04-30T12:00:01.000Z',
    lastDeliveredAt: '2026-04-30T12:00:01.000Z',
    lastStatusCode: 200,
    lastFailureCode: null,
    lastErrorMessage: null,
    terminalFailureAt: null,
  },
};

// Webhook delivery payloads — the JSON body the customer's endpoint
// receives. `data` shape per `event.type`.

export const FIXTURE_TRADE_COMPLETED_PAYLOAD = {
  status: 'completed' as const,
  tradeId: '00000000-0000-0000-0000-000000000010',
  marketId: '00000000-0000-0000-0000-000000000001',
  outcomeIndex: 0,
  amount: '100',
  side: 'buy' as const,
  metadata: { strategy: 'momentum-v2' },
  txHash: '0x' + 'a'.repeat(64),
  tokensOut: '149231587123456789012',
};

export const FIXTURE_TRADE_FAILED_PAYLOAD = {
  status: 'failed' as const,
  tradeId: '00000000-0000-0000-0000-000000000010',
  marketId: '00000000-0000-0000-0000-000000000001',
  outcomeIndex: 0,
  amount: '100',
  side: 'buy' as const,
  metadata: {},
  errorCode: 'INSUFFICIENT_BALANCE',
  errorMessage: 'Smart account balance is below the trade amount.',
};

export const FIXTURE_TRADE_CONFIRMATION_REQUIRED_PAYLOAD = {
  status: 'pending_confirmation' as const,
  tradeId: '00000000-0000-0000-0000-000000000010',
  marketId: '00000000-0000-0000-0000-000000000001',
  outcomeIndex: 0,
  amount: '5000',
  side: 'buy' as const,
  metadata: {},
  confirmationExpiresAt: '2026-04-30T12:30:00.000Z',
};

export const FIXTURE_WEBHOOK_EVENT_TRADE_COMPLETED = {
  id: '00000000-0000-0000-0000-000000000050',
  type: 'trade.completed' as const,
  apiVersion: '2026-05-02',
  createdAt: '2026-04-30T12:00:00.000Z',
  data: FIXTURE_TRADE_COMPLETED_PAYLOAD,
};

export const FIXTURE_WEBHOOK_EVENT_TRADE_FAILED = {
  id: '00000000-0000-0000-0000-000000000051',
  type: 'trade.failed' as const,
  apiVersion: '2026-05-02',
  createdAt: '2026-04-30T12:00:00.000Z',
  data: FIXTURE_TRADE_FAILED_PAYLOAD,
};

export const FIXTURE_WEBHOOK_EVENT_TRADE_CONFIRMATION_REQUIRED = {
  id: '00000000-0000-0000-0000-000000000052',
  type: 'trade.confirmation-required' as const,
  apiVersion: '2026-05-02',
  createdAt: '2026-04-30T12:00:00.000Z',
  data: FIXTURE_TRADE_CONFIRMATION_REQUIRED_PAYLOAD,
};

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function expectAccepts<T>(schema: z.ZodType<T>, sample: unknown, label: string): void {
  const result = schema.safeParse(sample);
  expect(
    result.success,
    `${label} schema rejected the canonical fixture:\n${formatErr(result)}`
  ).toBe(true);
}

function formatErr(result: ReturnType<z.ZodType['safeParse']>): string {
  if (result.success) return '';
  return result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
}

// -----------------------------------------------------------------
// Tests
// -----------------------------------------------------------------

describe('wire-shape parity: SDK schemas accept canonical API responses', () => {
  it('MarketResource', () => {
    expectAccepts(MarketResourceSchema, FIXTURE_MARKET, 'MarketResource');
  });

  it('ListMarketsResponse', () => {
    expectAccepts(
      ListMarketsResponseSchema,
      {
        data: [FIXTURE_MARKET],
        pagination: { cursor: null, hasMore: false, limit: 20 },
        _meta: FIXTURE_META,
      },
      'ListMarketsResponse'
    );
  });

  it('GetMarketResponse', () => {
    expectAccepts(
      GetMarketResponseSchema,
      { market: FIXTURE_MARKET, data: FIXTURE_MARKET, _meta: FIXTURE_META },
      'GetMarketResponse'
    );
  });

  it('PredictionResource', () => {
    expectAccepts(PredictionResourceSchema, FIXTURE_PREDICTION, 'PredictionResource');
  });

  it('ListPredictionsResponse', () => {
    expectAccepts(
      ListPredictionsResponseSchema,
      {
        data: [FIXTURE_PREDICTION],
        pagination: { cursor: 'cur-1', hasMore: true, limit: 50 },
        _meta: FIXTURE_META,
      },
      'ListPredictionsResponse'
    );
  });

  it('CreateTradeBody', () => {
    expectAccepts(
      CreateTradeBodySchema,
      {
        marketId: FIXTURE_TRADE.marketId,
        outcomeIndex: 0,
        amount: '100',
        side: 'buy' as const,
      },
      'CreateTradeBody'
    );
  });

  it('TradeResource', () => {
    expectAccepts(TradeResourceSchema, FIXTURE_TRADE, 'TradeResource');
  });

  it('CreateTradeCreatedResponse (201 envelope)', () => {
    expectAccepts(
      CreateTradeCreatedResponseSchema,
      {
        trade: FIXTURE_TRADE,
        data: FIXTURE_TRADE,
        _meta: { ...FIXTURE_META, idempotent: false },
      },
      'CreateTradeCreatedResponse'
    );
  });

  it('CreateTradeAcceptedResponse (202 confirmation envelope)', () => {
    const t = { ...FIXTURE_TRADE, status: 'pending_confirmation' as const };
    expectAccepts(
      CreateTradeAcceptedResponseSchema,
      {
        trade: t,
        data: t,
        confirmation: { token: 'a'.repeat(48), expiresAt: '2026-04-30T12:30:00.000Z' },
        _meta: { ...FIXTURE_META, idempotent: false },
      },
      'CreateTradeAcceptedResponse'
    );
  });

  it('ConfirmTradeResponse', () => {
    expectAccepts(
      ConfirmTradeResponseSchema,
      { trade: FIXTURE_TRADE, data: FIXTURE_TRADE, _meta: FIXTURE_META },
      'ConfirmTradeResponse'
    );
  });

  it('GetTradeResponse', () => {
    expectAccepts(
      GetTradeResponseSchema,
      { trade: FIXTURE_TRADE, data: FIXTURE_TRADE, _meta: FIXTURE_META },
      'GetTradeResponse'
    );
  });

  it('ListTradesResponse', () => {
    expectAccepts(
      ListTradesResponseSchema,
      {
        data: [FIXTURE_TRADE],
        pagination: { cursor: 'opaque', hasMore: true, limit: 20 },
        _meta: FIXTURE_META,
      },
      'ListTradesResponse'
    );
  });

  it('TraceEvent (intent)', () => {
    expectAccepts(TraceEventSchema, FIXTURE_TRACE_EVENT_INTENT, 'TraceEvent');
  });

  it('TraceEvent (executed)', () => {
    expectAccepts(TraceEventSchema, FIXTURE_TRACE_EVENT_EXECUTED, 'TraceEvent');
  });

  it('TraceResource', () => {
    expectAccepts(TraceResourceSchema, FIXTURE_TRACE, 'TraceResource');
  });

  it('GetTraceResponse', () => {
    expectAccepts(
      GetTraceResponseSchema,
      { trace: FIXTURE_TRACE, data: FIXTURE_TRACE, _meta: FIXTURE_META },
      'GetTraceResponse'
    );
  });

  it('PositionResource', () => {
    expectAccepts(PositionResourceSchema, FIXTURE_POSITION, 'PositionResource');
  });

  it('PositionsResponse', () => {
    expectAccepts(
      PositionsResponseSchema,
      { data: [FIXTURE_POSITION], _meta: FIXTURE_META },
      'PositionsResponse'
    );
  });

  it('PortfolioSummaryResponse', () => {
    const summary = {
      smartAccountAddress: '0xabc',
      activePositions: 3,
      totalCostBasisAtomic: '12345678',
    };
    expectAccepts(
      PortfolioSummaryResponseSchema,
      { portfolio: summary, data: summary, _meta: FIXTURE_META },
      'PortfolioSummaryResponse'
    );
  });

  it('QuoteResponse (buy)', () => {
    expectAccepts(
      QuoteResponseSchema,
      {
        quote: FIXTURE_QUOTE_BUY,
        market: FIXTURE_QUOTE_MARKET_SUMMARY,
        units: FIXTURE_UNITS,
        _meta: FIXTURE_META,
      },
      'QuoteResponse (buy)'
    );
  });

  it('QuoteResponse (sell)', () => {
    expectAccepts(
      QuoteResponseSchema,
      {
        quote: FIXTURE_QUOTE_SELL,
        market: FIXTURE_QUOTE_MARKET_SUMMARY,
        units: FIXTURE_UNITS,
        _meta: FIXTURE_META,
      },
      'QuoteResponse (sell)'
    );
  });

  it('AccountUsage', () => {
    expectAccepts(AccountUsageSchema, FIXTURE_ACCOUNT_USAGE, 'AccountUsage');
  });

  it('AccountUsageResponse', () => {
    expectAccepts(
      AccountUsageResponseSchema,
      { data: FIXTURE_ACCOUNT_USAGE, _meta: FIXTURE_META },
      'AccountUsageResponse'
    );
  });

  it('WebhookEventResource', () => {
    expectAccepts(WebhookEventResourceSchema, FIXTURE_WEBHOOK_EVENT, 'WebhookEventResource');
  });

  it('ListWebhookEventsResponse', () => {
    expectAccepts(
      ListWebhookEventsResponseSchema,
      {
        data: [FIXTURE_WEBHOOK_EVENT],
        pagination: { cursor: 'cur-1', hasMore: true, limit: 25 },
        _meta: FIXTURE_META,
      },
      'ListWebhookEventsResponse'
    );
  });

  it('TradeCompletedPayload', () => {
    expectAccepts(
      TradeCompletedPayloadSchema,
      FIXTURE_TRADE_COMPLETED_PAYLOAD,
      'TradeCompletedPayload'
    );
  });

  it('TradeFailedPayload', () => {
    expectAccepts(TradeFailedPayloadSchema, FIXTURE_TRADE_FAILED_PAYLOAD, 'TradeFailedPayload');
  });

  it('TradeConfirmationRequiredPayload', () => {
    expectAccepts(
      TradeConfirmationRequiredPayloadSchema,
      FIXTURE_TRADE_CONFIRMATION_REQUIRED_PAYLOAD,
      'TradeConfirmationRequiredPayload'
    );
  });

  it('WebhookEvent (trade.completed envelope)', () => {
    expectAccepts(
      WebhookEventSchema,
      FIXTURE_WEBHOOK_EVENT_TRADE_COMPLETED,
      'WebhookEvent (trade.completed)'
    );
  });

  it('WebhookEvent (trade.failed envelope)', () => {
    expectAccepts(
      WebhookEventSchema,
      FIXTURE_WEBHOOK_EVENT_TRADE_FAILED,
      'WebhookEvent (trade.failed)'
    );
  });

  it('WebhookEvent (trade.confirmation-required envelope)', () => {
    expectAccepts(
      WebhookEventSchema,
      FIXTURE_WEBHOOK_EVENT_TRADE_CONFIRMATION_REQUIRED,
      'WebhookEvent (trade.confirmation-required)'
    );
  });

  it('ConfirmTradeBody', () => {
    expectAccepts(ConfirmTradeBodySchema, { token: 'a'.repeat(48) }, 'ConfirmTradeBody');
  });

  it('RedeliverWebhookResponse (full envelope)', () => {
    const ev = {
      id: '00000000-0000-0000-0000-000000000050',
      eventType: 'trade.completed',
      apiKeyId: '00000000-0000-0000-0000-000000000060',
      tradeRequestId: '00000000-0000-0000-0000-000000000010',
      emittedAt: '2026-04-30T12:00:00.000Z',
      lastDeliveredAt: '2026-04-30T12:01:00.000Z',
      deliveryAttempts: 1,
    };
    expectAccepts(
      RedeliverWebhookResponseSchema,
      { event: ev, data: ev, _meta: { ...FIXTURE_META, message: 'Replay queued.' } },
      'RedeliverWebhookResponse'
    );
  });

  it('RotateWebhookSecretResponse (full envelope)', () => {
    const secret = {
      secret: `whsec_${'a'.repeat(32)}`,
      rotatedAt: '2026-04-30T12:00:00.000Z',
      previousRetainedUntil: '2026-05-07T12:00:00.000Z',
    };
    expectAccepts(
      RotateWebhookSecretResponseSchema,
      {
        webhookSecret: secret,
        data: secret,
        _meta: { ...FIXTURE_META, message: 'Webhook secret rotated.' },
      },
      'RotateWebhookSecretResponse'
    );
  });
});
