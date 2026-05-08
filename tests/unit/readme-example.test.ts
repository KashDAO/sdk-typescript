/**
 * Readme example smoke test.
 *
 * Pastes the README's quick-start verbatim against a mocked fetch so
 * (a) it actually compiles under the published `.d.ts`, and (b) the
 * documented snippet is exercised on every CI run — drift between
 * README and reality fails the suite.
 */

import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { KashClient } from '../../src/index.js';
import type { TradeResource } from '../../src/index.js';

import { META } from './_test-utils.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

const TRADE_PENDING = {
  id: '00000000-0000-0000-0000-000000000010',
  marketId: '11111111-1111-1111-1111-111111111111',
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

const TRADE_DONE = {
  ...TRADE_PENDING,
  status: 'completed' as const,
  txHash: '0x' + 'a'.repeat(64),
  tokensOut: '1234567890',
};

describe('README quick-start example', () => {
  it('compiles and runs with the documented shape', async () => {
    let polls = 0;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/trades') && polls === 0) {
        return jsonResponse(
          {
            trade: TRADE_PENDING,
            data: TRADE_PENDING,
            _meta: { requestId: 'r1', timestamp: '2026-04-30T12:00:00.000Z', idempotent: false },
          },
          { status: 201 }
        );
      }
      polls += 1;
      // First read = pending; second = completed.
      const t = polls >= 2 ? TRADE_DONE : TRADE_PENDING;
      return jsonResponse({ trade: t, data: t, _meta: META });
    });

    // === verbatim from README, with the mocked fetch injected ===
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      fetch: fetchSpy as typeof fetch,
      maxRetries: 0,
    });

    const trade = await kash.trades.create({
      marketId: '11111111-1111-1111-1111-111111111111',
      outcomeIndex: 0,
      amount: '100',
      side: 'buy',
    });

    const completed = await kash.trades.waitForCompletion(trade.id, {
      timeoutMs: 5_000,
      pollIntervalMs: 1,
      onStatus: (t) => void t.status,
    });
    // === end of README snippet ===

    expect(trade.id).toBe(TRADE_PENDING.id);
    expect(completed.status).toBe('completed');
    expect(completed.txHash).toBe(TRADE_DONE.txHash);

    // Type-level assertion: the destructured `trade` is a TradeResource
    // and `completed` is too. If either drifts, this fails at typecheck.
    expectTypeOf(trade).toMatchTypeOf<TradeResource>();
    expectTypeOf(completed).toMatchTypeOf<TradeResource>();
  });
});
