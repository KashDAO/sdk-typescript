/**
 * Mock client (`@kashdao/sdk/testing`) — surface coverage + override
 * semantics. Every default fixture must round-trip through the
 * corresponding wire-shape Zod schema so consumer tests work against
 * the same shape they'd see in production.
 */

import { describe, expect, it } from 'vitest';

import {
  KashRateLimitError,
  ListMarketsResponseSchema,
  ListPredictionsResponseSchema,
  ListTradesResponseSchema,
  MarketResourceSchema,
  PortfolioSummaryResponseSchema,
  PositionsResponseSchema,
  QuoteResponseSchema,
  TradeResourceSchema,
} from '../../src/index.js';
import {
  createMockKashClient,
  DEFAULT_MARKET,
  DEFAULT_TRADE,
  DEFAULT_PREDICTION,
  DEFAULT_QUOTE_BUY,
  DEFAULT_QUOTE_SELL,
  DEFAULT_PORTFOLIO_SUMMARY,
  DEFAULT_POSITION,
  DEFAULT_REDELIVER_EVENT,
} from '../../src/testing/index.js';

const META = {
  requestId: '01HQGY8K2N3X4Z5C6D7E8F9G0H',
  timestamp: '2026-04-30T12:00:00.000Z',
} as const;

describe('createMockKashClient — defaults are wire-shape-valid', () => {
  it('DEFAULT_MARKET passes MarketResourceSchema', () => {
    expect(MarketResourceSchema.safeParse(DEFAULT_MARKET).success).toBe(true);
  });

  it('DEFAULT_TRADE passes TradeResourceSchema', () => {
    expect(TradeResourceSchema.safeParse(DEFAULT_TRADE).success).toBe(true);
  });

  it('list responses round-trip through their public schemas', () => {
    expect(
      ListMarketsResponseSchema.safeParse({
        data: [DEFAULT_MARKET],
        pagination: { cursor: null, hasMore: false, limit: 20 },
        _meta: META,
      }).success
    ).toBe(true);

    expect(
      ListPredictionsResponseSchema.safeParse({
        data: [DEFAULT_PREDICTION],
        pagination: { cursor: null, hasMore: false, limit: 50 },
        _meta: META,
      }).success
    ).toBe(true);

    expect(
      ListTradesResponseSchema.safeParse({
        data: [DEFAULT_TRADE],
        pagination: { cursor: null, hasMore: false, limit: 20 },
        _meta: META,
      }).success
    ).toBe(true);

    expect(
      PositionsResponseSchema.safeParse({ data: [DEFAULT_POSITION], _meta: META }).success
    ).toBe(true);

    expect(
      PortfolioSummaryResponseSchema.safeParse({
        portfolio: DEFAULT_PORTFOLIO_SUMMARY,
        data: DEFAULT_PORTFOLIO_SUMMARY,
        _meta: META,
      }).success
    ).toBe(true);

    expect(
      QuoteResponseSchema.safeParse({
        quote: DEFAULT_QUOTE_BUY,
        market: DEFAULT_QUOTE_BUY.market,
        units: { usdc: 'atomic-6', token: 'wad-18' },
        _meta: META,
      }).success
    ).toBe(true);

    expect(
      QuoteResponseSchema.safeParse({
        quote: DEFAULT_QUOTE_SELL,
        market: DEFAULT_QUOTE_SELL.market,
        units: { usdc: 'atomic-6', token: 'wad-18' },
        _meta: META,
      }).success
    ).toBe(true);
  });
});

describe('createMockKashClient — surface compatibility', () => {
  const kash = createMockKashClient();

  it('exposes the same resource sub-clients as KashClient', () => {
    expect(typeof kash.markets.list).toBe('function');
    expect(typeof kash.markets.get).toBe('function');
    expect(typeof kash.markets.predictions).toBe('function');
    expect(typeof kash.trades.create).toBe('function');
    expect(typeof kash.trades.confirm).toBe('function');
    expect(typeof kash.trades.get).toBe('function');
    expect(typeof kash.trades.list).toBe('function');
    expect(typeof kash.trades.waitForCompletion).toBe('function');
    expect(typeof kash.quotes.buy).toBe('function');
    expect(typeof kash.quotes.sell).toBe('function');
    expect(typeof kash.portfolio.get).toBe('function');
    expect(typeof kash.portfolio.positions).toBe('function');
    expect(typeof kash.webhooks.list).toBe('function');
    expect(typeof kash.webhooks.redeliver).toBe('function');
    expect(typeof kash.webhooks.rotateSecret).toBe('function');
    expect(typeof kash.webhooks.verifySignature).toBe('function');
    expect(typeof kash.account.usage).toBe('function');
    expect(typeof kash.traces.get).toBe('function');
    expect(typeof kash.healthCheck).toBe('function');
  });

  it('unconfigured methods return wire-shape-valid defaults', async () => {
    const marketId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const market = await kash.markets.get(marketId);
    expect(MarketResourceSchema.safeParse(market).success).toBe(true);
    expect(market.id).toBe(marketId); // caller's id propagates

    const tradeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const trade = await kash.trades.get(tradeId);
    expect(TradeResourceSchema.safeParse(trade).success).toBe(true);
    expect(trade.id).toBe(tradeId);
  });

  it('list methods return Page<T> with a usable async iterator', async () => {
    const page = await kash.markets.list();
    expect(Array.isArray(page.data)).toBe(true);
    expect(page.data.length).toBeGreaterThan(0);

    const collected: typeof page.data = [];
    for await (const market of page) {
      collected.push(market);
    }
    expect(collected.length).toBe(page.data.length);
  });

  it('healthCheck returns ok by default', async () => {
    const result = await kash.healthCheck();
    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
  });
});

describe('createMockKashClient — overrides', () => {
  it('per-method override runs instead of the default', async () => {
    const kash = createMockKashClient({
      markets: {
        get: (id) => ({ ...DEFAULT_MARKET, id, title: `Override ${id}` }),
      },
    });
    const m = await kash.markets.get('mkt_42');
    expect(m.title).toBe('Override mkt_42');
  });

  it('list override accepts a flat array', async () => {
    const kash = createMockKashClient({
      markets: {
        list: () => [DEFAULT_MARKET, { ...DEFAULT_MARKET, id: 'mkt_2' }],
      },
    });
    const page = await kash.markets.list();
    expect(page.data).toHaveLength(2);
    expect(page.data[1]?.id).toBe('mkt_2');
  });

  it('list override accepts a page-shaped object with cursor', async () => {
    const kash = createMockKashClient({
      trades: {
        list: () => ({
          data: [DEFAULT_TRADE],
          hasMore: true,
          nextCursor: 'cur-next',
        }),
      },
    });
    const page = await kash.trades.list();
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('cur-next');
  });

  it('async overrides resolve correctly', async () => {
    const kash = createMockKashClient({
      portfolio: {
        get: async () => ({
          ...DEFAULT_PORTFOLIO_SUMMARY,
          activePositions: 99,
        }),
      },
    });
    const summary = await kash.portfolio.get();
    expect(summary.activePositions).toBe(99);
  });

  it('throwing override surfaces the error to the caller', async () => {
    const kash = createMockKashClient({
      trades: {
        create: () => {
          throw new KashRateLimitError('mock 429', {
            code: 'RATE_LIMITED',
            statusCode: 429,
            retryAfterSeconds: 30,
          });
        },
      },
    });
    await expect(
      kash.trades.create({
        marketId: '11111111-1111-4111-8111-111111111111',
        outcomeIndex: 0,
        amount: '100',
        side: 'buy',
      })
    ).rejects.toBeInstanceOf(KashRateLimitError);
  });

  it('trades.create echoes body fields in the default', async () => {
    const kash = createMockKashClient();
    const t = await kash.trades.create({
      marketId: '11111111-1111-4111-8111-111111111111',
      outcomeIndex: 1,
      amount: '50',
      side: 'sell',
    });
    expect(t.outcomeIndex).toBe(1);
    expect(t.amount).toBe('50');
    expect(t.side).toBe('sell');
    expect(t.idempotent).toBe(false);
  });

  it('confirmation token can be returned from a create override', async () => {
    const kash = createMockKashClient({
      trades: {
        create: (body) => ({
          ...DEFAULT_TRADE,
          marketId: body.marketId,
          status: 'pending_confirmation' as const,
          idempotent: false,
          confirmation: {
            token: 'a'.repeat(48),
            expiresAt: '2026-04-30T12:30:00.000Z',
          },
        }),
      },
    });
    const t = await kash.trades.create({
      marketId: '11111111-1111-4111-8111-111111111111',
      outcomeIndex: 0,
      amount: '100',
      side: 'buy',
    });
    expect(t.confirmation?.token).toHaveLength(48);
    expect(t.status).toBe('pending_confirmation');
  });

  it('healthCheck override runs', async () => {
    const kash = createMockKashClient({
      healthCheck: () => ({ ok: false, latencyMs: 0 }),
    });
    const result = await kash.healthCheck();
    expect(result.ok).toBe(false);
  });

  it('waitForCompletion fires onStatus with the resolved trade', async () => {
    const kash = createMockKashClient();
    const seen: string[] = [];
    const t = await kash.trades.waitForCompletion('trd_1', {
      onStatus: (trade) => seen.push(trade.status),
    });
    expect(t.status).toBe('completed');
    expect(seen).toEqual(['completed']);
  });

  it('account.usage default is wire-shape-valid', async () => {
    const kash = createMockKashClient();
    const usage = await kash.account.usage();
    expect(usage.trades['24h'].total).toBeGreaterThan(0);
    expect(usage.webhooks['7d'].emitted).toBeGreaterThanOrEqual(0);
  });

  it('account.usage override runs', async () => {
    const kash = createMockKashClient({
      account: {
        usage: () => ({
          apiKeyId: '00000000-0000-0000-0000-000000000099',
          generatedAt: '2026-04-30T12:00:00.000Z',
          trades: {
            '24h': {
              total: 0,
              completed: 0,
              failed: 0,
              successRate: null,
              latencyMs: { p50: null, p99: null },
            },
            '7d': { total: 0, completed: 0, failed: 0, successRate: null },
            '30d': { total: 0, completed: 0, failed: 0, successRate: null },
          },
          webhooks: { '7d': { emitted: 0, delivered: 0, failed: 0, successRate: null } },
          auth: { '24h': { failures: 0, rateLimitRejections: 0 } },
        }),
      },
    });
    const usage = await kash.account.usage();
    expect(usage.trades['24h'].successRate).toBeNull();
  });

  it('traces.get default propagates the requested correlationId', async () => {
    const kash = createMockKashClient();
    const cid = '99999999-9999-4999-8999-999999999999';
    const trace = await kash.traces.get(cid);
    expect(trace.correlationId).toBe(cid);
    expect(trace.events.length).toBeGreaterThan(0);
  });

  it('webhooks.list default returns a Page<WebhookEventResource>', async () => {
    const kash = createMockKashClient();
    const page = await kash.webhooks.list();
    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data[0]?.status).toBe('delivered');
  });

  it('webhooks.list override accepts a flat array', async () => {
    const kash = createMockKashClient({
      webhooks: {
        list: () => [
          {
            id: '00000000-0000-0000-0000-000000000020',
            eventType: 'trade.failed',
            tradeRequestId: '00000000-0000-0000-0000-000000000010',
            emittedAt: '2026-04-30T12:00:00.000Z',
            outboxEmittedAt: '2026-04-30T12:00:00.500Z',
            replayCount: 1,
            status: 'failed' as const,
            delivery: {
              attempts: 5,
              lastAttemptedAt: '2026-04-30T12:05:00.000Z',
              lastDeliveredAt: null,
              lastStatusCode: 503,
              lastFailureCode: 'http_5xx',
              lastErrorMessage: 'service unavailable',
              terminalFailureAt: '2026-04-30T12:05:00.000Z',
            },
          },
        ],
      },
    });
    const page = await kash.webhooks.list({ status: 'failed' });
    expect(page.data[0]?.status).toBe('failed');
  });

  // ---- coverage for the unconfigured default paths ------------------
  // These exercise the no-override branches in the factory so the mock
  // client's wire-shape-valid defaults are tested for every method,
  // not just the handful exercised by the surface-compatibility test.

  it('markets.predictions default returns a Page<PredictionResource> with the requested marketId', async () => {
    const kash = createMockKashClient();
    const marketId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const page = await kash.markets.predictions(marketId);
    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data[0]?.marketId).toBe(marketId);
  });

  it('trades.confirm default returns a pending TradeResource with the requested id', async () => {
    const kash = createMockKashClient();
    const tradeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const trade = await kash.trades.confirm(tradeId, { token: 'a'.repeat(48) });
    expect(trade.id).toBe(tradeId);
    expect(trade.status).toBe('pending');
  });

  it('trades.list default returns a Page<TradeResource>', async () => {
    const kash = createMockKashClient();
    const page = await kash.trades.list();
    expect(page.data.length).toBeGreaterThan(0);
  });

  it('quotes.buy default echoes the requested outcomeIndex', async () => {
    const kash = createMockKashClient();
    const quote = await kash.quotes.buy({
      marketId: '11111111-1111-4111-8111-111111111111',
      outcomeIndex: 1,
      amountUsdcAtomic: '50000000',
    });
    expect(quote.outcomeIndex).toBe(1);
    expect(quote.action).toBe('buy');
  });

  it('quotes.sell default echoes the requested outcomeIndex', async () => {
    const kash = createMockKashClient();
    const quote = await kash.quotes.sell({
      marketId: '11111111-1111-4111-8111-111111111111',
      outcomeIndex: 0,
      tokensInWad: '1000000000000000000',
    });
    expect(quote.outcomeIndex).toBe(0);
    expect(quote.action).toBe('sell');
  });

  it('portfolio.positions default returns a non-empty array', async () => {
    const kash = createMockKashClient();
    const positions = await kash.portfolio.positions();
    expect(positions.length).toBeGreaterThan(0);
  });

  it('portfolio.positions default ignores filter params (returns the canonical fixture)', async () => {
    const kash = createMockKashClient();
    const positions = await kash.portfolio.positions({
      marketId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(Array.isArray(positions)).toBe(true);
  });

  it('webhooks.redeliver default propagates the requested eventId', async () => {
    const kash = createMockKashClient();
    const eventId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const event = await kash.webhooks.redeliver(eventId);
    expect(event.id).toBe(eventId);
  });

  it('webhooks.rotateSecret default returns a wire-shape-valid mock secret', async () => {
    const kash = createMockKashClient();
    const result = await kash.webhooks.rotateSecret();
    expect(result.secret).toMatch(/^whsec_/);
    expect(typeof result.rotatedAt).toBe('string');
    expect(typeof result.previousRetainedUntil).toBe('string');
  });

  it('webhooks.verifySignature default returns valid: true', async () => {
    const kash = createMockKashClient();
    const result = await kash.webhooks.verifySignature('body', 'header', 'whsec_test');
    expect(result.valid).toBe(true);
  });

  it('webhooks.constructEvent default parses a valid event body and returns a typed WebhookEvent', async () => {
    const kash = createMockKashClient();
    const event = {
      id: '00000000-0000-0000-0000-000000000001',
      type: 'trade.completed',
      apiVersion: '2026-01-01',
      createdAt: '2026-04-30T12:00:00.000Z',
      data: {
        tradeId: '00000000-0000-0000-0000-000000000010',
        marketId: '00000000-0000-0000-0000-000000000020',
        outcomeIndex: 0,
        side: 'buy' as const,
        amount: '100',
        status: 'completed' as const,
        txHash: `0x${'1'.repeat(64)}`,
        tokensOut: '237340124711760000000',
        metadata: {},
      },
    };
    const result = await kash.webhooks.constructEvent(
      JSON.stringify(event),
      't=1714478400000,v1=mock',
      'whsec_test'
    );
    expect(result.type).toBe('trade.completed');
    expect(result.id).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('webhooks.constructEvent default throws KashWebhookSignatureError when verifySignature override returns invalid', async () => {
    const kash = createMockKashClient({
      webhooks: {
        verifySignature: () => ({ valid: false, reason: 'mock invalid signature' }),
      },
    });
    await expect(kash.webhooks.constructEvent('{}', 'bad-header', 'whsec_test')).rejects.toThrow(
      'mock invalid signature'
    );
  });

  it('webhooks.constructEvent default throws KashValidationError on non-JSON body', async () => {
    const kash = createMockKashClient();
    await expect(kash.webhooks.constructEvent('not-json', 'header', 'whsec_test')).rejects.toThrow(
      /not valid JSON/
    );
  });

  it('webhooks.constructEvent default throws KashConfigurationError on empty secret', async () => {
    const kash = createMockKashClient();
    await expect(kash.webhooks.constructEvent('{}', 'header', '')).rejects.toThrow(
      /non-empty `secret`/
    );
    await expect(kash.webhooks.constructEvent('{}', 'header', '   ')).rejects.toThrow(
      /non-empty `secret`/
    );
  });

  it('webhooks.constructEvent default throws KashValidationError on non-string body', async () => {
    const kash = createMockKashClient();
    await expect(
      // Adversarial caller passing a parsed object — TypeScript blocks
      // this at compile time, but the runtime guard still fires.
      kash.webhooks.constructEvent(
        { type: 'trade.completed' } as unknown as string,
        'header',
        'whsec_test'
      )
    ).rejects.toThrow(/raw request body as a string/);
  });

  it('webhooks.constructEvent default throws KashValidationError on unknown event shape', async () => {
    const kash = createMockKashClient();
    await expect(
      kash.webhooks.constructEvent(
        JSON.stringify({ type: 'unknown.event.type', id: 'x', data: {} }),
        'header',
        'whsec_test'
      )
    ).rejects.toThrow(/did not match any known event shape/);
  });

  it('webhooks.constructEvent override is invoked when supplied', async () => {
    const customEvent = {
      id: '00000000-0000-0000-0000-000000000099',
      type: 'trade.failed' as const,
      apiVersion: '2026-01-01',
      createdAt: '2026-04-30T12:00:00.000Z',
      data: {
        tradeId: '00000000-0000-0000-0000-000000000010',
        marketId: '00000000-0000-0000-0000-000000000020',
        outcomeIndex: 0,
        side: 'buy' as const,
        amount: '100',
        status: 'failed' as const,
        errorCode: 'EXECUTION_REVERT',
        errorMessage: 'mock failure',
        metadata: {},
      },
    };
    const kash = createMockKashClient({
      webhooks: {
        constructEvent: () => customEvent,
      },
    });
    const result = await kash.webhooks.constructEvent('body', 'header', 'whsec_test');
    expect(result).toEqual(customEvent);
  });
});
