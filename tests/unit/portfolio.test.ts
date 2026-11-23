import { describe, expect, it, vi } from 'vitest';

import { KashClient, KashValidationError } from '../../src/index.js';

import { META } from './_test-utils.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const SUMMARY = {
  smartAccountAddress: '0xabc',
  activePositions: 3,
  totalCostBasisAtomic: '12345678',
};

describe('PortfolioClient', () => {
  it('get — returns portfolio summary', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ portfolio: SUMMARY, data: SUMMARY, _meta: META })
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const summary = await kash.portfolio.get();
    expect(summary).toEqual(SUMMARY);
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('/v1/portfolio');
  });

  it('positions — passes optional marketId filter', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ data: [], _meta: META }));
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    await kash.portfolio.positions({ marketId: '00000000-0000-0000-0000-000000000001' });
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('/portfolio/positions');
    expect(url).toContain('marketId=00000000-0000-0000-0000-000000000001');
  });

  it('positions — returns the data array', async () => {
    const position = {
      marketId: '00000000-0000-0000-0000-000000000001',
      outcomeIndex: 0,
      shares: '1000000000000000000',
      costBasisAtomic: '50000000',
      tradeCount: 1,
      firstTradeAt: '2026-04-30T12:00:00.000Z',
      lastTradeAt: '2026-04-30T12:00:00.000Z',
    };
    const fetchSpy = vi.fn(async () => jsonResponse({ data: [position], _meta: META }));
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const positions = await kash.portfolio.positions();
    expect(positions).toEqual([position]);
  });

  describe('claimable', () => {
    const MARKET = '00000000-0000-0000-0000-000000000001';
    const ITEM = {
      marketId: MARKET,
      outcomeIndex: 1,
      kind: 'resolved',
      shares: '1817600000000000000',
      quotedAmountAtomic: '1680305',
      quoteStatus: 'quoted',
      claimStatus: 'claimable',
    };
    const UNQUOTED = {
      ...ITEM,
      outcomeIndex: 2,
      quotedAmountAtomic: null,
      quoteStatus: 'unavailable',
    };

    function client(body: unknown) {
      const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(body));
      const kash = new KashClient({
        apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        baseUrl: 'https://api.test.local/v1',
        fetch: fetchSpy as unknown as typeof fetch,
        maxRetries: 0,
      });
      return { kash, fetchSpy };
    }

    it('reads GET /portfolio/claimable and returns the data array, an unread quote as null', async () => {
      const { kash, fetchSpy } = client({ data: [ITEM, UNQUOTED], _meta: META });

      const items = await kash.portfolio.claimable();

      expect(items).toEqual([ITEM, UNQUOTED]);
      const url = new URL(fetchSpy.mock.calls[0]![0]);
      expect(url.pathname).toBe('/v1/portfolio/claimable');
      expect(url.searchParams.has('marketId')).toBe(false);
    });

    it('passes the optional marketId filter', async () => {
      const { kash, fetchSpy } = client({ data: [], _meta: META });

      await kash.portfolio.claimable({ marketId: MARKET });

      expect(new URL(fetchSpy.mock.calls[0]![0]).searchParams.get('marketId')).toBe(MARKET);
    });

    it('refuses a response whose quote is a number rather than a string', async () => {
      const { kash } = client({ data: [{ ...ITEM, quotedAmountAtomic: 1680305 }], _meta: META });

      await expect(kash.portfolio.claimable()).rejects.toThrow(KashValidationError);
    });
  });
});
