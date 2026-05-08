import { describe, expect, it, vi } from 'vitest';

import { KashClient } from '../../src/index.js';

import { META } from './_test-utils.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const TRACE = {
  correlationId: '33333333-3333-3333-3333-333333333333',
  events: [
    {
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
    },
    {
      type: 'com.kash.trade.executed.v1',
      occurredAt: '2026-05-02T12:00:03.000Z',
      sequenceNumber: 3,
      data: {
        tradeId: '00000000-0000-0000-0000-000000000010',
        txHash: '0x' + 'a'.repeat(64),
        tokensOut: '149231587123456789012',
      },
    },
  ],
};

describe('TracesClient', () => {
  it('get — fetches a trace by correlationId and unwraps the envelope', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ trace: TRACE, _meta: META }));
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const result = await kash.traces.get(TRACE.correlationId);
    expect(result).toEqual(TRACE);

    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain(`/v1/traces/${TRACE.correlationId}`);
  });

  it('get — URL-encodes the correlationId path segment', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ trace: TRACE, _meta: META }));
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    // Pathological input — not a real UUID but the SDK must still
    // safely encode it rather than allowing path injection.
    await kash.traces.get('weird id/with slashes').catch(() => {
      /* schema rejection is expected; we only care about the URL */
    });
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('/traces/weird%20id%2Fwith%20slashes');
  });
});
