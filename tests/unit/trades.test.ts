import { describe, expect, it, vi } from 'vitest';

import { KashConflictError, KashTimeoutError, KashValidationError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';
import type { TradeStatus } from '../../src/schemas/trade.js';

import { META } from './_test-utils.js';

const TRADE_BASE = {
  id: '00000000-0000-0000-0000-000000000010',
  marketId: '00000000-0000-0000-0000-000000000001',
  outcomeIndex: 0,
  amount: '100',
  side: 'buy' as const,
  status: 'pending' as TradeStatus,
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

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeKash(fetchImpl: typeof fetch, maxRetries = 0): KashClient {
  return new KashClient({
    apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    baseUrl: 'https://api.test.local/v1',
    fetch: fetchImpl,
    maxRetries,
  });
}

describe('TradesClient', () => {
  it('create — sends body, X-API-Key, Content-Type, no idempotency by default', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        {
          trade: TRADE_BASE,
          data: TRADE_BASE,
          _meta: { requestId: 'r1', timestamp: '2026-04-30T12:00:00.000Z', idempotent: false },
        },
        { status: 201 }
      )
    );
    const kash = makeKash(fetchSpy as typeof fetch);
    const trade = await kash.trades.create({
      marketId: TRADE_BASE.marketId,
      outcomeIndex: 0,
      amount: '100',
      side: 'buy',
    });
    // Flat shape — trade fields are direct, no envelope.
    expect(trade.id).toBe(TRADE_BASE.id);
    expect(trade.idempotent).toBe(false);
    expect(trade.confirmation).toBeUndefined();
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined();
    expect(init.body).toContain('"marketId":');
  });

  it('create — surfaces idempotent: true on duplicate replay', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        {
          trade: TRADE_BASE,
          data: TRADE_BASE,
          _meta: { requestId: 'r1', timestamp: '2026-04-30T12:00:00.000Z', idempotent: true },
        },
        { status: 200 }
      )
    );
    const kash = makeKash(fetchSpy as typeof fetch);
    const trade = await kash.trades.create(
      { marketId: TRADE_BASE.marketId, outcomeIndex: 0, amount: '100', side: 'buy' },
      { idempotencyKey: 'idem-1' }
    );
    expect(trade.idempotent).toBe(true);
  });

  it('create — sets Idempotency-Key when provided', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        {
          trade: TRADE_BASE,
          data: TRADE_BASE,
          _meta: { requestId: 'r1', timestamp: '2026-04-30T12:00:00.000Z', idempotent: false },
        },
        { status: 201 }
      )
    );
    const kash = makeKash(fetchSpy as typeof fetch);
    await kash.trades.create(
      { marketId: TRADE_BASE.marketId, outcomeIndex: 0, amount: '100', side: 'buy' },
      { idempotencyKey: 'idem-XYZ' }
    );
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-XYZ');
  });

  it('create — flattens the 202 confirmation shape onto the trade', async () => {
    const t = { ...TRADE_BASE, status: 'pending_confirmation' as TradeStatus };
    const accepted = {
      trade: t,
      data: t,
      confirmation: {
        token: 'a'.repeat(48),
        expiresAt: '2026-04-30T12:30:00.000Z',
      },
      _meta: { requestId: 'r1', timestamp: '2026-04-30T12:00:00.000Z', idempotent: false },
    };
    const fetchSpy = vi.fn(async () => jsonResponse(accepted, { status: 202 }));
    const kash = makeKash(fetchSpy as typeof fetch);
    const trade = await kash.trades.create({
      marketId: TRADE_BASE.marketId,
      outcomeIndex: 0,
      amount: '5000',
      side: 'buy',
    });
    // Trade fields and confirmation both accessible directly.
    expect(trade.id).toBe(TRADE_BASE.id);
    expect(trade.status).toBe('pending_confirmation');
    expect(trade.confirmation?.token).toHaveLength(48);
    expect(trade.confirmation?.expiresAt).toBe('2026-04-30T12:30:00.000Z');
  });

  it('confirm — POST /v1/trades/:id/confirm', async () => {
    const t = { ...TRADE_BASE, status: 'pending' as TradeStatus };
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        trade: t,
        data: t,
        _meta: { requestId: 'r1', timestamp: '2026-04-30T12:00:00.000Z' },
      })
    );
    const kash = makeKash(fetchSpy as typeof fetch);
    const trade = await kash.trades.confirm(TRADE_BASE.id, { token: 'a'.repeat(48) });
    expect(trade.id).toBe(TRADE_BASE.id);
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain(`/trades/${TRADE_BASE.id}/confirm`);
  });

  it('get — GET /v1/trades/:id', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ trade: TRADE_BASE, data: TRADE_BASE, _meta: META })
    );
    const kash = makeKash(fetchSpy as typeof fetch);
    const trade = await kash.trades.get(TRADE_BASE.id);
    expect(trade.id).toBe(TRADE_BASE.id);
  });

  it('list — async iteration walks pages', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [TRADE_BASE],
          pagination: { cursor: 'cur1', hasMore: true, limit: 1 },
          _meta: META,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ ...TRADE_BASE, id: '00000000-0000-0000-0000-000000000011' }],
          pagination: { cursor: null, hasMore: false, limit: 1 },
          _meta: META,
        })
      );
    const kash = makeKash(fetchSpy as typeof fetch);
    const ids: string[] = [];
    for await (const t of await kash.trades.list({ limit: 1 })) {
      ids.push(t.id);
    }
    expect(ids).toEqual([TRADE_BASE.id, '00000000-0000-0000-0000-000000000011']);
  });

  it('waitForCompletion — returns immediately on terminal first read', async () => {
    const completed = {
      ...TRADE_BASE,
      status: 'completed' as TradeStatus,
      txHash: '0x' + 'a'.repeat(64),
      tokensOut: '12345',
    };
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ trade: completed, data: completed, _meta: META })
    );
    const kash = makeKash(fetchSpy as typeof fetch);
    const onStatus = vi.fn();
    const trade = await kash.trades.waitForCompletion(TRADE_BASE.id, {
      pollIntervalMs: 1,
      timeoutMs: 1_000,
      onStatus,
    });
    expect(trade.status).toBe('completed');
    expect(onStatus).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('waitForCompletion — polls until terminal', async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls += 1;
      const status: TradeStatus = calls >= 3 ? 'completed' : 'executing';
      const t = { ...TRADE_BASE, status };
      return jsonResponse({
        trade: t,
        data: t,
        _meta: META,
      });
    });
    const kash = makeKash(fetchSpy as typeof fetch);
    const onStatus = vi.fn();
    const trade = await kash.trades.waitForCompletion(TRADE_BASE.id, {
      pollIntervalMs: 1,
      timeoutMs: 1_000,
      onStatus,
    });
    expect(trade.status).toBe('completed');
    expect(calls).toBe(3);
    // onStatus is invoked once per poll. The initial pre-flight `get`
    // is not exposed via onStatus (its sole purpose is the
    // pending_confirmation guard); polling fires for calls 2 and 3.
    expect(onStatus).toHaveBeenCalledTimes(2);
  });

  it('waitForCompletion — refuses pending_confirmation', async () => {
    const t = { ...TRADE_BASE, status: 'pending_confirmation' as TradeStatus };
    const fetchSpy = vi.fn(async () => jsonResponse({ trade: t, data: t, _meta: META }));
    const kash = makeKash(fetchSpy as typeof fetch);
    await expect(
      kash.trades.waitForCompletion(TRADE_BASE.id, { pollIntervalMs: 1, timeoutMs: 1_000 })
    ).rejects.toBeInstanceOf(KashConflictError);
  });

  it('waitForCompletion — throws KashTimeoutError on timeout', async () => {
    const t = { ...TRADE_BASE, status: 'pending' as TradeStatus };
    const fetchSpy = vi.fn(async () => jsonResponse({ trade: t, data: t, _meta: META }));
    const kash = makeKash(fetchSpy as typeof fetch);
    await expect(
      kash.trades.waitForCompletion(TRADE_BASE.id, { pollIntervalMs: 5, timeoutMs: 30 })
    ).rejects.toBeInstanceOf(KashTimeoutError);
  });

  it('create — pre-validates body shape and surfaces structured issues', async () => {
    const fetchSpy = vi.fn();
    const kash = makeKash(fetchSpy as typeof fetch);
    // Bad: marketId is not a UUID, outcomeIndex is negative.
    const err = await kash.trades
      .create({
        marketId: 'not-a-uuid',
        outcomeIndex: -1,
        amount: '100',
        side: 'buy',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashValidationError);
    expect((err as KashValidationError).code).toBe('VALIDATION_FAILED');
    const issues = (err as KashValidationError).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((i) => i.path)).toContain('marketId');
    // Fail-fast — no fetch was issued.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('create — pre-validation issues round-trip through toJSON()', async () => {
    const fetchSpy = vi.fn();
    const kash = makeKash(fetchSpy as typeof fetch);
    const err = (await kash.trades
      .create({
        marketId: 'bad',
        outcomeIndex: 0,
        amount: '100',
        side: 'buy',
      })
      .catch((e: unknown) => e)) as KashValidationError;
    const json = err.toJSON();
    expect(json).toHaveProperty('issues');
    expect(Array.isArray(json['issues'])).toBe(true);
    expect((json['issues'] as { path: string }[])[0]?.path).toBe('marketId');
  });
});
