import { describe, expect, it, vi } from 'vitest';

import { KashClient } from '../../src/index.js';

import { META } from './_test-utils.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const USAGE = {
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

describe('AccountClient', () => {
  it('usage — calls GET /account/usage and unwraps the data envelope', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ data: USAGE, _meta: META }));
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const result = await kash.account.usage();
    expect(result).toEqual(USAGE);

    const url = fetchSpy.mock.calls[0]![0] as string;
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(url).toContain('/v1/account/usage');
    expect(init.method).toBe('GET');
  });

  it('usage — surfaces successRate: null when total === 0 (no division by zero)', async () => {
    const empty = {
      ...USAGE,
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
    };
    const fetchSpy = vi.fn(async () => jsonResponse({ data: empty, _meta: META }));
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });
    const result = await kash.account.usage();
    expect(result.trades['24h'].successRate).toBeNull();
    expect(result.trades['24h'].latencyMs.p99).toBeNull();
  });
});
