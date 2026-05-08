import { describe, expect, it, vi } from 'vitest';

import { KashClient } from '../../src/index.js';

import { META } from './_test-utils.js';

const MARKET = {
  id: '00000000-0000-0000-0000-000000000001',
  contractAddress: '0xabc',
  chainId: 8453,
  title: 'Will it rain?',
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

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('MarketsClient', () => {
  it('list — first page returned synchronously, calls right URL', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        data: [MARKET],
        pagination: { cursor: null, hasMore: false, limit: 20 },
        _meta: META,
      })
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const page = await kash.markets.list({ status: 'ACTIVE' });
    expect(page.data).toHaveLength(1);
    expect(page.pagination.hasMore).toBe(false);
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('/v1/markets');
    expect(url).toContain('status=ACTIVE');
    expect(url).toContain('limit=20');
  });

  it('list — async iteration walks every page', async () => {
    const market2 = { ...MARKET, id: '00000000-0000-0000-0000-000000000002' };
    const market3 = { ...MARKET, id: '00000000-0000-0000-0000-000000000003' };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [MARKET],
          pagination: { cursor: 'c1', hasMore: true, limit: 1 },
          _meta: META,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [market2],
          pagination: { cursor: 'c2', hasMore: true, limit: 1 },
          _meta: META,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [market3],
          pagination: { cursor: null, hasMore: false, limit: 1 },
          _meta: META,
        })
      );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const ids: string[] = [];
    for await (const m of await kash.markets.list({ limit: 1 })) {
      ids.push(m.id);
    }
    expect(ids).toEqual([MARKET.id, market2.id, market3.id]);
    // Cursors propagate: 1st call has no cursor, 2nd uses 'c1', 3rd uses 'c2'.
    const urls = fetchSpy.mock.calls.map((c) => c[0] as string);
    expect(urls[0]).not.toContain('cursor=');
    expect(urls[1]).toContain('cursor=c1');
    expect(urls[2]).toContain('cursor=c2');
  });

  it('get — returns the market resource', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ market: MARKET, data: MARKET, _meta: META }));
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const m = await kash.markets.get(MARKET.id);
    expect(m.id).toBe(MARKET.id);
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain(`/markets/${MARKET.id}`);
  });

  it('predictions — calls /v1/markets/:id/predictions with side + outcome filters', async () => {
    const PREDICTION = {
      id: 'pred-1',
      marketId: MARKET.id,
      outcomeIndex: 0,
      side: 'buy' as const,
      usdcIn: '100000000',
      usdcOut: null,
      tokensIn: null,
      tokensOut: '149231587123456789012',
      price: '0.6701',
      probability: '0.62',
      timestamp: '2026-04-30T12:00:00.000Z',
      blockNumber: '12345678',
      transactionHash: '0x' + 'a'.repeat(64),
      logIndex: 0,
    };
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        data: [PREDICTION],
        pagination: { cursor: null, hasMore: false, limit: 50 },
        _meta: META,
      })
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const page = await kash.markets.predictions(MARKET.id, {
      side: 'buy',
      outcomeIndex: 0,
    });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]!.id).toBe('pred-1');
    expect(page.data[0]!.side).toBe('buy');
    expect(page.hasMore).toBe(false);

    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain(`/markets/${MARKET.id}/predictions`);
    expect(url).toContain('side=buy');
    expect(url).toContain('outcomeIndex=0');
    expect(url).toContain('limit=50');
  });

  it('predictions — async iteration walks every page', async () => {
    const makePred = (id: string) => ({
      id,
      marketId: MARKET.id,
      outcomeIndex: 0,
      side: 'buy' as const,
      usdcIn: '100000',
      usdcOut: null,
      tokensIn: null,
      tokensOut: '1000',
      price: '0.5',
      probability: '0.5',
      timestamp: '2026-04-30T12:00:00.000Z',
      blockNumber: '12345678',
      transactionHash: '0x' + 'a'.repeat(64),
      logIndex: 0,
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [makePred('p1')],
          pagination: { cursor: 'c1', hasMore: true, limit: 1 },
          _meta: META,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [makePred('p2')],
          pagination: { cursor: null, hasMore: false, limit: 1 },
          _meta: META,
        })
      );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const ids: string[] = [];
    for await (const p of await kash.markets.predictions(MARKET.id, { limit: 1 })) {
      ids.push(p.id);
    }
    expect(ids).toEqual(['p1', 'p2']);
  });
});
