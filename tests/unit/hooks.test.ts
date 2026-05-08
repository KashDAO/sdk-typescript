import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KashClient } from '../../src/index.js';
import type {
  ErrorHookEvent,
  RequestHookEvent,
  ResponseHookEvent,
  RetryHookEvent,
} from '../../src/internal/config.js';

import { META } from './_test-utils.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function problemResponse(
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json', ...extraHeaders },
  });
}

const TRADE = {
  id: '00000000-0000-0000-0000-000000000010',
  marketId: '00000000-0000-0000-0000-000000000001',
  outcomeIndex: 0,
  amount: '100',
  side: 'buy' as const,
  status: 'pending' as const,
  correlationId: '00000000-0000-0000-0000-000000000099',
  clientRequestId: null,
  txHash: null,
  tokensOut: null,
  errorCode: null,
  errorMessage: null,
  webhookDelivery: null,
  metadata: {},
  createdAt: '2026-04-30T12:00:00.000Z',
  updatedAt: '2026-04-30T12:00:00.000Z',
};

describe('lifecycle hooks', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires onRequest + onResponse on success', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        {
          trade: TRADE,
          data: TRADE,
          _meta: { requestId: 'r-1', timestamp: '2026-04-30T12:00:00.000Z', idempotent: false },
        },
        { status: 201, headers: { 'x-request-id': 'r-1' } }
      )
    );
    const reqEvents: RequestHookEvent[] = [];
    const resEvents: ResponseHookEvent[] = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
      hooks: {
        onRequest: (e) => reqEvents.push(e),
        onResponse: (e) => resEvents.push(e),
      },
    });
    await kash.trades.create({
      marketId: TRADE.marketId,
      outcomeIndex: 0,
      amount: '100',
      side: 'buy',
    });
    expect(reqEvents).toHaveLength(1);
    expect(reqEvents[0]!.method).toBe('POST');
    expect(reqEvents[0]!.url).toContain('/v1/trades');
    expect(reqEvents[0]!.attempt).toBe(1);

    expect(resEvents).toHaveLength(1);
    expect(resEvents[0]!.status).toBe(200);
    expect(resEvents[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('fires onRetry between attempts and onError when retries exhaust', async () => {
    const fetchSpy = vi.fn(async () => problemResponse(500, { code: 'INTERNAL_ERROR' }));
    const retryEvents: RetryHookEvent[] = [];
    const errorEvents: ErrorHookEvent[] = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 2,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 4,
      hooks: {
        onRetry: (e) => retryEvents.push(e),
        onError: (e) => errorEvents.push(e),
      },
    });
    await kash.trades.get(TRADE.id).catch(() => undefined);
    expect(retryEvents).toHaveLength(2); // before retry 1, before retry 2
    expect(retryEvents[0]!.reason).toBe('server_error');
    expect(retryEvents[0]!.attempt).toBe(1);
    expect(retryEvents[1]!.attempt).toBe(2);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.code).toBe('INTERNAL_ERROR');
    expect(errorEvents[0]!.attempt).toBe(3);
  });

  it('onResponse carries apiVersion from the X-API-Version response header on success', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        { trade: TRADE, data: TRADE, _meta: META },
        { status: 200, headers: { 'x-api-version': '2026-04-29' } }
      )
    );
    const events: ResponseHookEvent[] = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
      hooks: { onResponse: (e) => events.push(e) },
    });
    await kash.trades.get(TRADE.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.apiVersion).toBe('2026-04-29');
  });

  it('onResponse apiVersion is undefined when the response omits X-API-Version', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ trade: TRADE, data: TRADE, _meta: META }));
    const events: ResponseHookEvent[] = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
      hooks: { onResponse: (e) => events.push(e) },
    });
    await kash.trades.get(TRADE.id);
    expect(events[0]!.apiVersion).toBeUndefined();
  });

  it('error path carries apiVersion on KashError when the failure response includes X-API-Version', async () => {
    const fetchSpy = vi.fn(async () =>
      problemResponse(500, { code: 'INTERNAL_ERROR' }, { 'x-api-version': '2026-04-29' })
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const err = await kash.trades.get(TRADE.id).catch((e: unknown) => e);
    expect((err as { apiVersion?: unknown }).apiVersion).toBe('2026-04-29');
  });

  it('onResponse surfaces idempotentReplay=true when the server emits Idempotent-Replay: true', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        { trade: TRADE, data: TRADE, _meta: META },
        { status: 200, headers: { 'idempotent-replay': 'true' } }
      )
    );
    const events: ResponseHookEvent[] = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
      hooks: { onResponse: (e) => events.push(e) },
    });
    await kash.trades.get(TRADE.id);
    expect(events[0]!.idempotentReplay).toBe(true);
  });

  it('onResponse defaults idempotentReplay to false when the header is absent', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ trade: TRADE, data: TRADE, _meta: META }));
    const events: ResponseHookEvent[] = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
      hooks: { onResponse: (e) => events.push(e) },
    });
    await kash.trades.get(TRADE.id);
    expect(events[0]!.idempotentReplay).toBe(false);
  });

  it('Link parser extracts the sunset URL when rel is a multi-token set ("preload sunset")', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        { trade: TRADE, data: TRADE, _meta: META },
        {
          status: 200,
          headers: {
            link: '<https://docs.kash.bot/migration>; rel="preload sunset"; type="text/html"',
          },
        }
      )
    );
    const events: ResponseHookEvent[] = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
      hooks: { onResponse: (e) => events.push(e) },
    });
    await kash.trades.get(TRADE.id);
    expect(events[0]!.deprecation?.link).toBe('https://docs.kash.bot/migration');
  });

  it('Link parser handles unquoted rel ("rel=sunset")', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        { trade: TRADE, data: TRADE, _meta: META },
        {
          status: 200,
          headers: {
            link: '<https://docs.kash.bot/migration>; rel=sunset',
          },
        }
      )
    );
    const events: ResponseHookEvent[] = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
      hooks: { onResponse: (e) => events.push(e) },
    });
    await kash.trades.get(TRADE.id);
    expect(events[0]!.deprecation?.link).toBe('https://docs.kash.bot/migration');
  });

  it('Link parser ignores non-sunset rel values ("rel=next" → no link)', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        { trade: TRADE, data: TRADE, _meta: META },
        {
          status: 200,
          headers: {
            sunset: 'Sun, 29 Apr 2027 00:00:00 GMT',
            link: '<https://docs.kash.bot/next-page>; rel="next"',
          },
        }
      )
    );
    const events: ResponseHookEvent[] = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
      hooks: { onResponse: (e) => events.push(e) },
    });
    await kash.trades.get(TRADE.id);
    expect(events[0]!.deprecation?.link).toBeUndefined();
    // Sunset header still surfaces; only the link relation didn't match.
    expect(events[0]!.deprecation?.sunset).toBe('Sun, 29 Apr 2027 00:00:00 GMT');
  });

  it('idempotentReplay returns false for non-"true" header values', async () => {
    for (const value of ['false', '1', 'True', 'TRUE', '']) {
      const fetchSpy = vi.fn(async () =>
        jsonResponse(
          { trade: TRADE, data: TRADE, _meta: META },
          { status: 200, headers: { 'idempotent-replay': value } }
        )
      );
      const events: ResponseHookEvent[] = [];
      const kash = new KashClient({
        apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        baseUrl: 'https://api.test.local/v1',
        fetch: fetchSpy as typeof fetch,
        maxRetries: 0,
        hooks: { onResponse: (e) => events.push(e) },
      });
      await kash.trades.get(TRADE.id);
      expect(events[0]!.idempotentReplay).toBe(false);
    }
  });

  it('onResponse parses Sunset/Deprecation/Link headers into a structured advisory', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        { trade: TRADE, data: TRADE, _meta: META },
        {
          status: 200,
          headers: {
            sunset: 'Sun, 29 Apr 2027 00:00:00 GMT',
            deprecation: 'true',
            link: '<https://docs.kash.bot/api/migration/2026-04-29>; rel="sunset"; type="text/html"',
          },
        }
      )
    );
    const events: ResponseHookEvent[] = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
      hooks: { onResponse: (e) => events.push(e) },
    });
    await kash.trades.get(TRADE.id);
    expect(events[0]!.deprecation).toEqual({
      sunset: 'Sun, 29 Apr 2027 00:00:00 GMT',
      deprecation: 'true',
      link: 'https://docs.kash.bot/api/migration/2026-04-29',
    });
  });

  it('onResponse deprecation is null when the response carries none of the headers', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ trade: TRADE, data: TRADE, _meta: META }));
    const events: ResponseHookEvent[] = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
      hooks: { onResponse: (e) => events.push(e) },
    });
    await kash.trades.get(TRADE.id);
    expect(events[0]!.deprecation).toBeNull();
  });

  it('error path carries idempotentReplay and deprecation on KashError', async () => {
    const fetchSpy = vi.fn(async () =>
      problemResponse(
        500,
        { code: 'INTERNAL_ERROR' },
        {
          'idempotent-replay': 'true',
          sunset: 'Sun, 29 Apr 2027 00:00:00 GMT',
          deprecation: 'true',
        }
      )
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const err = await kash.trades.get(TRADE.id).catch((e: unknown) => e);
    expect((err as { idempotentReplay?: unknown }).idempotentReplay).toBe(true);
    expect((err as { deprecation?: unknown }).deprecation).toEqual({
      sunset: 'Sun, 29 Apr 2027 00:00:00 GMT',
      deprecation: 'true',
      link: undefined,
    });
  });

  it('a hook that throws does NOT break the request', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ trade: TRADE, data: TRADE, _meta: META }));
    const onRequest = vi.fn(() => {
      throw new Error('logger explosion');
    });
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
      hooks: { onRequest },
    });
    const trade = await kash.trades.get(TRADE.id);
    expect(trade.id).toBe(TRADE.id);
    expect(onRequest).toHaveBeenCalledOnce();
  });
});
