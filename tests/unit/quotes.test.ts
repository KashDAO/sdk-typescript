import { describe, expect, it, vi } from 'vitest';

import { KashClient } from '../../src/index.js';
import { QuoteMarketSummarySchema } from '../../src/schemas/quote.js';

import { META } from './_test-utils.js';

const MARKET_ID = '00000000-0000-0000-0000-000000000001';

const QUOTE_BUY_RESPONSE = {
  quote: {
    action: 'buy' as const,
    outcomeIndex: 0,
    amountIn: '100000000',
    tokensOut: '149231587123456789012',
    reserveAfter: '500000000000000000000',
    c: '987654321987654321',
    pAfter: ['620000000000000000', '380000000000000000'],
    qAfter: ['1500000000000000000000', '1000000000000000000000'],
    effectivePrice: 0.6701234,
    impliedProbability: 0.62,
  },
  market: {
    id: MARKET_ID,
    contractAddress: '0xabc',
    chainId: 8453,
    outcomes: [
      { index: 0, label: 'Yes', probability: 0.62 },
      { index: 1, label: 'No', probability: 0.38 },
    ],
    status: 'ACTIVE' as const,
  },
  units: { usdc: 'atomic-6' as const, token: 'wad-18' as const },
  _meta: META,
};

const QUOTE_SELL_RESPONSE = {
  ...QUOTE_BUY_RESPONSE,
  quote: {
    action: 'sell' as const,
    outcomeIndex: 0,
    tokensIn: '1000000000000000000',
    usdcOut: '618000',
    grossRelease: '620000000000000000',
    reserveAfter: QUOTE_BUY_RESPONSE.quote.reserveAfter,
    c: QUOTE_BUY_RESPONSE.quote.c,
    pAfter: QUOTE_BUY_RESPONSE.quote.pAfter,
    qAfter: QUOTE_BUY_RESPONSE.quote.qAfter,
    effectivePrice: 0.000000000000618,
    impliedProbability: 0.62,
  },
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeKash(fetchImpl: typeof fetch): KashClient {
  return new KashClient({
    apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    baseUrl: 'https://api.test.local/v1',
    fetch: fetchImpl,
    maxRetries: 0,
  });
}

describe('QuotesClient', () => {
  it('buy — calls /v1/markets/:id/quote with action=buy and stringified amount', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(QUOTE_BUY_RESPONSE));
    const kash = makeKash(fetchSpy as typeof fetch);
    const quote = await kash.quotes.buy({
      marketId: MARKET_ID,
      outcomeIndex: 0,
      amountUsdcAtomic: '100000000',
    });
    expect(quote.action).toBe('buy');
    expect(quote.tokensOut).toBe('149231587123456789012');
    expect(quote.market.id).toBe(MARKET_ID);
    expect(quote.market.outcomes).toHaveLength(2);

    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain(`/markets/${MARKET_ID}/quote`);
    expect(url).toContain('action=buy');
    expect(url).toContain('outcomeIndex=0');
    expect(url).toContain('amount=100000000');
  });

  it('buy — accepts bigint amountUsdcAtomic', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(QUOTE_BUY_RESPONSE));
    const kash = makeKash(fetchSpy as typeof fetch);
    await kash.quotes.buy({
      marketId: MARKET_ID,
      outcomeIndex: 0,
      amountUsdcAtomic: 100_000_000n,
    });
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('amount=100000000');
  });

  it('sell — calls /v1/markets/:id/quote with action=sell', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(QUOTE_SELL_RESPONSE));
    const kash = makeKash(fetchSpy as typeof fetch);
    const quote = await kash.quotes.sell({
      marketId: MARKET_ID,
      outcomeIndex: 0,
      tokensInWad: '1000000000000000000',
    });
    expect(quote.action).toBe('sell');
    expect(quote.usdcOut).toBe('618000');
    expect(quote.tokensIn).toBe('1000000000000000000');
    expect(quote.market.id).toBe(MARKET_ID);

    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('action=sell');
  });

  it('throws if server returns wrong action discriminator', async () => {
    // Defence-in-depth: server bug where buy returns sell shape.
    const fetchSpy = vi.fn(async () => jsonResponse(QUOTE_SELL_RESPONSE));
    const kash = makeKash(fetchSpy as typeof fetch);
    await expect(
      kash.quotes.buy({
        marketId: MARKET_ID,
        outcomeIndex: 0,
        amountUsdcAtomic: '100000000',
      })
    ).rejects.toThrow(/buy.*sell/);
  });
});

/*
 * THE 0.2.0 WIDENING — `chainId` optional (required through 0.1.5), `chainRef` added.
 *
 * Asserted against the SCHEMA directly rather than through a mocked transport,
 * because what changed is what the wire shape is allowed to be, and a transport
 * test would pass just as well against a schema that accepted anything.
 */
describe('QuoteMarketSummarySchema: chain identity across both API versions', () => {
  const base = {
    id: '11111111-1111-1111-1111-111111111111',
    contractAddress: '0x1111111111111111111111111111111111111111',
    outcomes: [{ index: 0, label: 'Yes', probability: 0.5 }],
    status: 'ACTIVE' as const,
  };

  it('accepts the EVM shape unchanged — chainId present, no chainRef', () => {
    const r = QuoteMarketSummarySchema.safeParse({ ...base, chainId: 8453 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.chainId).toBe(8453);
  });

  it('accepts an EVM quote that ALSO carries chainRef (the newer API version)', () => {
    const r = QuoteMarketSummarySchema.safeParse({
      ...base,
      chainId: 8453,
      chainRef: 'evm:8453',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.chainRef).toBe('evm:8453');
  });

  it('accepts a Solana quote: chainRef present, chainId ABSENT', () => {
    // The shape 0.1.3 rejected, and the whole reason for this release.
    const r = QuoteMarketSummarySchema.safeParse({
      ...base,
      contractAddress: 'So11111111111111111111111111111111111111112',
      chainRef: 'solana:devnet',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.chainRef).toBe('solana:devnet');
      expect(r.data.chainId).toBeUndefined();
    }
  });

  it('STILL refuses a surrogate chain id, so the widening did not open that door', () => {
    /*
     * The discriminating case. `chainId` became optional, NOT permissive —
     * `publicChainIdSchema`'s refusal of surrogates has to survive being made
     * optional, and `.optional()` wrapping a refinement is exactly the spot
     * where that could have been lost.
     */
    const r = QuoteMarketSummarySchema.safeParse({ ...base, chainId: 9000002 });
    expect(r.success).toBe(false);
  });
});
