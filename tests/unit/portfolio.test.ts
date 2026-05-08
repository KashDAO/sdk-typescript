import { describe, expect, it, vi } from 'vitest';

import { KashClient } from '../../src/index.js';

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
});
