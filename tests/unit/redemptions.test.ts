import { describe, expect, it, vi } from 'vitest';

import { KashConflictError, KashValidationError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';

import { META } from './_test-utils.js';

const MARKET_ID = '00000000-0000-0000-0000-000000000001';

const REDEMPTION = {
  id: '00000000-0000-0000-0000-000000000020',
  marketId: MARKET_ID,
  outcomeIndex: 1,
  kind: 'resolved' as const,
  sharesWad: '125000000000000000000',
  status: 'pending',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
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

describe('RedemptionsClient', () => {
  it('create — POSTs /v1/redemptions with the body and an auto Idempotency-Key', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(
        { redemption: REDEMPTION, data: REDEMPTION, _meta: { ...META, idempotent: false } },
        201
      )
    );
    const kash = makeKash(fetchSpy as typeof fetch);

    const redemption = await kash.redemptions.create({ marketId: MARKET_ID, outcomeIndex: 1 });

    expect(redemption).toEqual({ ...REDEMPTION, idempotent: false });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test.local/v1/redemptions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ marketId: MARKET_ID, outcomeIndex: 1 });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTypeOf('string');
  });

  it('create — surfaces idempotent: true when the position already has a request', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ redemption: REDEMPTION, _meta: { ...META, idempotent: true } })
    );
    const kash = makeKash(fetchSpy as typeof fetch);

    const redemption = await kash.redemptions.create({ marketId: MARKET_ID, outcomeIndex: 1 });

    expect(redemption.idempotent).toBe(true);
  });

  it('create — forwards a caller-supplied Idempotency-Key unchanged', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ redemption: REDEMPTION, _meta: { ...META, idempotent: false } }, 201)
    );
    const kash = makeKash(fetchSpy as typeof fetch);

    await kash.redemptions.create(
      { marketId: MARKET_ID, outcomeIndex: 1 },
      { idempotencyKey: 'claim-1' }
    );

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('claim-1');
  });

  it('create — refuses a malformed body before any request is made', async () => {
    const fetchSpy = vi.fn();
    const kash = makeKash(fetchSpy as typeof fetch);

    await expect(
      kash.redemptions.create({ marketId: 'not-a-uuid', outcomeIndex: 1 })
    ).rejects.toBeInstanceOf(KashValidationError);
    await expect(
      kash.redemptions.create({ marketId: MARKET_ID, outcomeIndex: 256 })
    ).rejects.toBeInstanceOf(KashValidationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('create — maps POSITION_NOT_CLAIMABLE to KashConflictError', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            type: 'https://docs.kash.bot/errors/position-not-claimable',
            title: 'Position not claimable',
            status: 409,
            code: 'POSITION_NOT_CLAIMABLE',
            detail: 'Nothing to redeem for this outcome.',
          }),
          { status: 409, headers: { 'content-type': 'application/problem+json' } }
        )
    );
    const kash = makeKash(fetchSpy as typeof fetch);

    const err = await kash.redemptions
      .create({ marketId: MARKET_ID, outcomeIndex: 1 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KashConflictError);
    expect((err as KashConflictError).code).toBe('POSITION_NOT_CLAIMABLE');
  });
});
