/**
 * Every response and webhook value set the SDK parses is open: a value the
 * API adds later parses and is KEPT, so a new server value never fails a read
 * or a webhook. One case per opened field. What stays closed, and why, is
 * listed in `src/schemas/_open-enum.ts`.
 */

import { describe, expect, it, vi } from 'vitest';

import { isCompletedTrade, isPendingTrade, isTerminalTrade } from '../../src/guards.js';
import { KashClient } from '../../src/index.js';
import { PredictionResourceSchema, MarketResourceSchema } from '../../src/schemas/market.js';
import { QuoteMarketSummarySchema } from '../../src/schemas/quote.js';
import { RedemptionResourceSchema } from '../../src/schemas/redemption.js';
import { TraceEventSchema } from '../../src/schemas/trace.js';
import { TradeResourceSchema } from '../../src/schemas/trade.js';
import { WebhookEventSchema } from '../../src/schemas/webhook-event.js';
import { WebhookEventResourceSchema } from '../../src/schemas/webhook.js';
import { DEFAULT_REDEMPTION } from '../../src/testing/fixtures.js';
import {
  FIXTURE_MARKET,
  FIXTURE_PREDICTION,
  FIXTURE_QUOTE_MARKET_SUMMARY,
  FIXTURE_TRACE_EVENT_INTENT,
  FIXTURE_TRADE,
  FIXTURE_WEBHOOK_EVENT,
  FIXTURE_WEBHOOK_EVENT_TRADE_COMPLETED,
} from '../contract/wire-shape.test.js';

const NEW = 'a_value_added_later';

describe('open response enums: an unknown value parses and is kept', () => {
  it('market status, resolutionState, notTradeableReason, chain, settlementStatus', () => {
    const market = MarketResourceSchema.parse({
      ...FIXTURE_MARKET,
      status: NEW,
      resolutionState: NEW,
      tradeable: false,
      notTradeableReason: NEW,
      chain: NEW,
      resolution: {
        proposedOutcomeIndex: 0,
        proposedAt: null,
        finalizableAt: null,
        settlementStatus: NEW,
        disputeOpen: false,
      },
    });

    expect([
      market.status,
      market.resolutionState,
      market.notTradeableReason,
      market.chain,
      market.resolution?.settlementStatus,
    ]).toEqual([NEW, NEW, NEW, NEW, NEW]);
  });

  it('prediction side', () => {
    expect(PredictionResourceSchema.parse({ ...FIXTURE_PREDICTION, side: NEW }).side).toBe(NEW);
  });

  it('quote market status', () => {
    expect(
      QuoteMarketSummarySchema.parse({ ...FIXTURE_QUOTE_MARKET_SUMMARY, status: NEW }).status
    ).toBe(NEW);
  });

  it('trade status, side and webhookDelivery status', () => {
    const trade = TradeResourceSchema.parse({
      ...FIXTURE_TRADE,
      status: NEW,
      side: NEW,
      webhookDelivery: { ...FIXTURE_TRADE.webhookDelivery, status: NEW },
    });

    expect([trade.status, trade.side, trade.webhookDelivery?.status]).toEqual([NEW, NEW, NEW]);
  });

  it('trace event side', () => {
    const event = TraceEventSchema.parse({
      ...FIXTURE_TRACE_EVENT_INTENT,
      data: { ...FIXTURE_TRACE_EVENT_INTENT.data, side: NEW },
    });
    expect(event.data.side).toBe(NEW);
  });

  it('redemption kind', () => {
    expect(RedemptionResourceSchema.parse({ ...DEFAULT_REDEMPTION, kind: NEW }).kind).toBe(NEW);
  });

  it('webhook event resource status', () => {
    expect(WebhookEventResourceSchema.parse({ ...FIXTURE_WEBHOOK_EVENT, status: NEW }).status).toBe(
      NEW
    );
  });

  it('trade webhook side', () => {
    const event = WebhookEventSchema.parse({
      ...FIXTURE_WEBHOOK_EVENT_TRADE_COMPLETED,
      data: { ...FIXTURE_WEBHOOK_EVENT_TRADE_COMPLETED.data, side: NEW },
    });
    expect(event.type === 'trade.completed' && event.data.side).toBe(NEW);
  });

  it('healthCheck: an unknown server status is still ok, and is reported', async () => {
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ status: NEW, version: 'v' }), {
            headers: { 'content-type': 'application/json' },
          })
      ) as typeof fetch,
    });

    await expect(kash.healthCheck()).resolves.toMatchObject({ ok: true, status: NEW });
  });
});

describe('open response enums: what stays strict', () => {
  it('an empty value is refused: absent is not a new value', () => {
    expect(TradeResourceSchema.safeParse({ ...FIXTURE_TRADE, status: '' }).success).toBe(false);
  });

  it('a trade webhook whose status contradicts its type is still refused', () => {
    expect(
      WebhookEventSchema.safeParse({
        ...FIXTURE_WEBHOOK_EVENT_TRADE_COMPLETED,
        data: { ...FIXTURE_WEBHOOK_EVENT_TRADE_COMPLETED.data, status: 'failed' },
      }).success
    ).toBe(false);
  });

  it('an unknown trade status is neither terminal, pending nor completed', () => {
    const trade = TradeResourceSchema.parse({ ...FIXTURE_TRADE, status: NEW });

    expect([isTerminalTrade(trade), isPendingTrade(trade), isCompletedTrade(trade)]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('opened 0.3.x schemas: the runtime break and its migration, as the CHANGELOG states', () => {
  it('keeps .options, loses .enum, and z.enum(Schema.options) restores strict validation', async () => {
    const { z } = await import('zod');
    const { TradeStatusSchema } = await import('../../src/schemas/trade.js');

    expect(TradeStatusSchema.options).toContain('completed');
    expect((TradeStatusSchema as unknown as { enum?: unknown }).enum).toBeUndefined();
    expect(TradeStatusSchema.safeParse(NEW).success).toBe(true);
    const strict = z.enum(TradeStatusSchema.options);
    expect(strict.safeParse(NEW).success).toBe(false);
    expect(strict.safeParse('completed').success).toBe(true);
  });
});
