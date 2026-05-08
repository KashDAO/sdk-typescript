/**
 * Tests for the SDK's hardening features:
 *
 *   - `KashError.isKashError` cross-realm-safe brand
 *   - `KashClient.withConfig` cloning
 *   - Custom default headers + SDK headers always winning on collision
 *   - `Idempotency-Key` length validation (fail-fast)
 *   - `Page.getNextPage` memoisation
 *   - `KashClient.config` is frozen at runtime
 */

import { describe, expect, it, vi } from 'vitest';

import {
  KashClient,
  KashConfigurationError,
  KashError,
  KashServerError,
  KashValidationError,
  Page,
  USER_AGENT,
} from '../../src/index.js';

import { buildPage } from '../../src/internal/pagination.js';

import { META } from './_test-utils.js';

import type { Pagination } from '../../src/schemas/common.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

const STUB_MARKET = {
  id: '00000000-0000-0000-0000-000000000001',
  contractAddress: '0xabc',
  chainId: 8453,
  title: 'Test',
  description: null,
  status: 'ACTIVE',
  outcomeCount: 2,
  outcomes: [
    { index: 0, label: 'Yes', probability: 0.5 },
    { index: 1, label: 'No', probability: 0.5 },
  ],
  imageUrl: null,
  createdAt: '2026-04-30T12:00:00.000Z',
  expiresAt: null,
  resolvedAt: null,
};

describe('KashError.isKashError (cross-realm)', () => {
  it('returns true for a real KashError instance', () => {
    const err = new KashServerError('x', { code: 'INTERNAL_ERROR' });
    expect(KashError.isKashError(err)).toBe(true);
  });

  it('returns false for plain Error / null / undefined / primitives / objects', () => {
    expect(KashError.isKashError(new Error('plain'))).toBe(false);
    expect(KashError.isKashError(null)).toBe(false);
    expect(KashError.isKashError(undefined)).toBe(false);
    expect(KashError.isKashError(42)).toBe(false);
    expect(KashError.isKashError('string')).toBe(false);
    expect(KashError.isKashError({ code: 'X' })).toBe(false);
  });

  it('recognises a structurally-cloned twin via the Symbol.for brand', () => {
    // Simulate the cross-realm case: a serialised KashError-like object
    // with the brand symbol survives JSON serialisation when re-hydrated
    // explicitly. (Real worker postMessage uses structured-clone which
    // preserves Symbols on Errors automatically; this test simulates
    // the manual-rehydration path consumers might use.)
    const brand = Symbol.for('@kashdao/sdk:KashError');
    const sibling = { code: 'X', [brand]: true };
    expect(KashError.isKashError(sibling)).toBe(true);
  });
});

describe('KashClient.withConfig', () => {
  it('produces a new client; original is untouched', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ market: STUB_MARKET, data: STUB_MARKET, _meta: META })
    );
    const a = new KashClient({
      apiKey: 'kash_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      baseUrl: 'https://a.test/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const b = a.withConfig({
      apiKey: 'kash_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      baseUrl: 'https://b.test/v1',
    });
    expect(a).not.toBe(b);
    expect(a.config.apiKey).toBe('kash_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(b.config.apiKey).toBe('kash_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    await b.markets.get(STUB_MARKET.id);
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('https://b.test/v1');
    const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('kash_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('inherits original config for fields not overridden', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ market: STUB_MARKET, data: STUB_MARKET, _meta: META })
    );
    const a = new KashClient({
      apiKey: 'kash_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      baseUrl: 'https://a.test/v1',
      fetch: fetchSpy as typeof fetch,
      timeoutMs: 12_345,
      maxRetries: 0,
    });
    const b = a.withConfig({ apiKey: 'kash_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
    expect(b.config.timeoutMs).toBe(12_345);
    expect(b.config.baseUrl).toBe('https://a.test/v1');
  });

  it('re-validates — invalid override throws KashConfigurationError', () => {
    const a = new KashClient({ apiKey: 'kash_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(() => a.withConfig({ timeoutMs: 0 })).toThrow(KashConfigurationError);
  });
});

describe('custom default headers', () => {
  it('forwards consumer-supplied default headers on every request', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ market: STUB_MARKET, data: STUB_MARKET, _meta: META })
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test/v1',
      fetch: fetchSpy as typeof fetch,
      headers: {
        'X-Tenant': 'acme',
        traceparent: '00-abc-def-01',
      },
      maxRetries: 0,
    });
    await kash.markets.get(STUB_MARKET.id);
    const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Tenant']).toBe('acme');
    expect(headers['traceparent']).toBe('00-abc-def-01');
    // SDK-managed headers are still set:
    expect(headers['User-Agent']).toBe(USER_AGENT);
    expect(headers['X-API-Key']).toBe('kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  });

  it('SDK-reserved header names are dropped (case-insensitive) — collision attempt is safe', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ market: STUB_MARKET, data: STUB_MARKET, _meta: META })
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test/v1',
      fetch: fetchSpy as typeof fetch,
      headers: {
        // Attempt to override SDK-controlled headers via various casings:
        'x-api-key': 'attacker-controlled',
        'USER-AGENT': 'SuperEvil/1.0',
        'Content-Type': 'text/plain',
      },
      maxRetries: 0,
    });
    await kash.markets.get(STUB_MARKET.id);
    const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    // SDK values won — none of the overrides took effect.
    expect(headers['X-API-Key']).toBe('kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(headers['User-Agent']).toBe(USER_AGENT);
    // No other case-variant of api key leaked through.
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'x-api-key')
        expect(headers[k]).toBe('kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    }
  });

  it('rejects header values containing CR/LF (header injection guard)', () => {
    expect(
      () =>
        new KashClient({
          apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
          headers: { 'X-Bad': 'value\r\nset-cookie: pwned' },
        })
    ).toThrow(KashConfigurationError);
  });
});

describe('Idempotency-Key validation', () => {
  it('throws KashValidationError if key exceeds 255 chars (fail-fast, no fetch)', async () => {
    const fetchSpy = vi.fn();
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const tooLong = 'x'.repeat(256);
    await expect(
      kash.trades.create(
        {
          marketId: '00000000-0000-0000-0000-000000000001',
          outcomeIndex: 0,
          amount: '100',
          side: 'buy',
        },
        { idempotencyKey: tooLong }
      )
    ).rejects.toBeInstanceOf(KashValidationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['whitespace-internal', 'key with spaces'],
    ['leading-whitespace', ' key'],
    ['trailing-whitespace', 'key '],
    ['control-char', 'key\x00bad'],
    ['newline', 'key\nfoo'],
    ['semicolon', 'key;injected'],
    ['slash', 'key/path'],
    ['equals', 'key=value'],
    ['emoji', '💎-key'],
    ['rtl-marker', `key${'\u200f'}foo`],
  ])(
    'throws KashValidationError(IDEMPOTENCY_KEY_FORMAT_INVALID) for %s',
    async (_label, badKey) => {
      const fetchSpy = vi.fn();
      const kash = new KashClient({
        apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        baseUrl: 'https://api.test/v1',
        fetch: fetchSpy as typeof fetch,
        maxRetries: 0,
      });
      const err = await kash.trades
        .create(
          {
            marketId: '00000000-0000-0000-0000-000000000001',
            outcomeIndex: 0,
            amount: '100',
            side: 'buy',
          },
          { idempotencyKey: badKey }
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KashValidationError);
      expect((err as KashValidationError).code).toBe('IDEMPOTENCY_KEY_FORMAT_INVALID');
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['letters', 'AbCdEf'],
    ['digits', '12345'],
    ['underscore', 'order_123'],
    ['hyphen', 'order-123'],
    ['colon', 'tenant:abc:order:123'],
    ['dot', 'order.v1.123'],
  ])('accepts the server-allowed alphabet: %s', async (_label, validKey) => {
    const t = {
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
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        {
          trade: t,
          data: t,
          _meta: { requestId: 'r', timestamp: '2026-04-30T12:00:00.000Z', idempotent: false },
        },
        { status: 201 }
      )
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    await kash.trades.create(
      {
        marketId: '00000000-0000-0000-0000-000000000001',
        outcomeIndex: 0,
        amount: '100',
        side: 'buy',
      },
      { idempotencyKey: validKey }
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('accepts a valid 128-char key', async () => {
    const t = {
      id: '00000000-0000-0000-0000-000000000010',
      marketId: '00000000-0000-0000-0000-000000000001',
      outcomeIndex: 0,
      amount: '100',
      side: 'buy',
      status: 'pending',
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
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        {
          trade: t,
          data: t,
          _meta: { requestId: 'r', timestamp: '2026-04-30T12:00:00.000Z', idempotent: false },
        },
        { status: 201 }
      )
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    await kash.trades.create(
      {
        marketId: '00000000-0000-0000-0000-000000000001',
        outcomeIndex: 0,
        amount: '100',
        side: 'buy',
      },
      { idempotencyKey: 'x'.repeat(128) }
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

describe('Page.getNextPage memoisation', () => {
  it('two getNextPage calls return the same instance via one fetch', async () => {
    let calls = 0;
    const fetcher = vi.fn(async (cursor: string | undefined) => {
      calls += 1;
      if (calls === 1)
        return {
          data: [{ id: 1 }] as readonly { id: number }[],
          pagination: { cursor: 'c1', hasMore: true, limit: 1 } as Pagination,
        };
      return {
        data: [{ id: 2 }] as readonly { id: number }[],
        pagination: { cursor: null, hasMore: false, limit: 1 } as Pagination,
      };
    });
    const first = await buildPage<{ id: number }>(fetcher, undefined, { limit: 1 });
    const second1 = await first.getNextPage();
    const second2 = await first.getNextPage();
    expect(second1).toBe(second2);
    expect(fetcher).toHaveBeenCalledTimes(2); // first page + second page only
    expect(calls).toBe(2);
  });

  it('returns null cached when there is no cursor; no fetch', async () => {
    const fetcher = vi.fn(async () => ({
      data: [{ id: 1 }] as readonly { id: number }[],
      pagination: { cursor: null, hasMore: false, limit: 1 } as Pagination,
    }));
    const first = await buildPage<{ id: number }>(fetcher, undefined, { limit: 1 });
    const next = await first.getNextPage();
    expect(next).toBeNull();
    const next2 = await first.getNextPage();
    expect(next2).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce(); // just the first page
  });
});

describe('KashClient.config is frozen at runtime', () => {
  it('Object.isFrozen returns true', () => {
    const kash = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    expect(Object.isFrozen(kash.config)).toBe(true);
  });

  it('mutation throws in strict mode (TS files always run strict)', () => {
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      timeoutMs: 5_000,
    });
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (kash.config as any).timeoutMs = 99;
    }).toThrow(TypeError);
    expect(kash.config.timeoutMs).toBe(5_000);
  });
});

describe('Page is the public type', () => {
  it('exports as a class consumers can reference', () => {
    expect(typeof Page).toBe('function');
    expect(Page.name).toBe('Page');
  });
});

describe('per-call overrides', () => {
  it('per-call headers ride on top of client-config headers; SDK headers still win', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ market: STUB_MARKET, data: STUB_MARKET, _meta: META })
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
      headers: { 'X-Tenant': 'global' },
    });
    await kash.markets.get(STUB_MARKET.id, {
      headers: {
        traceparent: '00-abc-def-01',
        'X-Tenant': 'per-call-override',
        // Attempt to override SDK header at call site:
        'X-Api-Key': 'attacker',
      },
    });
    const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['traceparent']).toBe('00-abc-def-01');
    // Per-call overrides client config:
    expect(headers['X-Tenant']).toBe('per-call-override');
    // SDK still wins on collision:
    expect(headers['X-API-Key']).toBe('kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  });

  it('per-call timeoutMs takes effect for that single request', async () => {
    let aborted = false;
    const fetchSpy = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        })
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test/v1',
      fetch: fetchSpy as typeof fetch,
      timeoutMs: 60_000, // client-level: long
      maxRetries: 0,
    });
    const start = Date.now();
    await kash.markets.get(STUB_MARKET.id, { timeoutMs: 30 }).catch(() => undefined);
    expect(aborted).toBe(true);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('per-call signal short-circuits before any fetch', async () => {
    const fetchSpy = vi.fn();
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const controller = new AbortController();
    controller.abort();
    await kash.markets.get(STUB_MARKET.id, { signal: controller.signal }).catch(() => undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
