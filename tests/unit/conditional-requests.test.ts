/**
 * Conditional GETs and `portfolio.watchPositions`.
 *
 * The server answers a matching `If-None-Match` on `/v1/portfolio/positions`
 * with a body-less `304`, before it runs the list query. These tests pin the
 * client half of that contract:
 *
 *   - the client remembers an ETag per URL and sends it back;
 *   - a 304 resolves to the remembered value, re-validated and as a FRESH
 *     object (mutating one result cannot change the next);
 *   - nothing is remembered for writes, for a different URL, or when the
 *     option is off, and a 304 the client did not ask for is an error;
 *   - `watchPositions` yields on change only and backs off while unchanged.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * The watch's inter-poll sleep, replaced: it records the interval and returns
 * at once, and after `limit` sleeps it throws to end the iteration.
 */
const sleepState = vi.hoisted(() => ({
  sleeps: [] as number[],
  limit: Number.POSITIVE_INFINITY,
  /** Runs inside each sleep — i.e. between two polls of the watch. */
  between: undefined as (() => Promise<void>) | undefined,
}));

vi.mock('../../src/internal/sleep.js', () => ({
  sleepWithAbort: async (ms: number): Promise<void> => {
    sleepState.sleeps.push(ms);
    if (sleepState.between) await sleepState.between();
    if (sleepState.sleeps.length >= sleepState.limit) {
      throw Object.assign(new Error('stop'), { code: 'TEST_STOP' });
    }
  },
}));

import {
  KashClient,
  KashValidationError,
  WATCH_POSITIONS_DEFAULTS,
  type ResponseHookEvent,
} from '../../src/index.js';

import { kashClientConfigSchema } from '../../src/internal/config.js';
import { KashHttpClient } from '../../src/internal/http.js';

import { META } from './_test-utils.js';

const API_KEY = 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const BASE_URL = 'https://api.test.local/v1';
const ETAG_A = 'W/"pos1.2026-08-19.aaaa"';
const ETAG_B = 'W/"pos1.2026-08-19.bbbb"';

const POSITION = {
  marketId: '00000000-0000-0000-0000-000000000001',
  outcomeIndex: 0,
  shares: '1000000000000000000',
  costBasisAtomic: '50000000',
  tradeCount: 1,
  firstTradeAt: '2026-04-30T12:00:00.000Z',
  lastTradeAt: '2026-04-30T12:00:00.000Z',
};

function ok(body: unknown, etag?: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(etag ? { etag } : {}) },
  });
}

function notModified(etag: string): Response {
  return new Response(null, { status: 304, headers: { etag } });
}

function sentHeader(call: unknown[], name: string): string | undefined {
  const init = call[1] as RequestInit;
  const headers = init.headers as Record<string, string>;
  return headers[name];
}

function client(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}): KashClient {
  return new KashClient({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    fetch: fetchImpl,
    maxRetries: 0,
    ...extra,
  });
}

describe('conditional GETs', () => {
  it('sends no validator the first time, then the remembered ETag', async () => {
    const fetchSpy = vi.fn(async () => ok({ data: [POSITION], _meta: META }, ETAG_A));
    const kash = client(fetchSpy as typeof fetch);
    await kash.portfolio.positions();
    await kash.portfolio.positions();
    expect(sentHeader(fetchSpy.mock.calls[0]!, 'If-None-Match')).toBeUndefined();
    expect(sentHeader(fetchSpy.mock.calls[1]!, 'If-None-Match')).toBe(ETAG_A);
  });

  it('a 304 resolves to the remembered value, as a fresh object each time', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [POSITION], _meta: META }, ETAG_A))
      .mockResolvedValueOnce(notModified(ETAG_A))
      .mockResolvedValueOnce(notModified(ETAG_A));
    const kash = client(fetchSpy as unknown as typeof fetch);
    const first = await kash.portfolio.positions();
    const second = await kash.portfolio.positions();
    expect(second).toEqual([POSITION]);
    // Mutating a returned value must not leak into the next resolution.
    (second as Array<{ shares: string }>)[0]!.shares = 'tampered';
    const third = await kash.portfolio.positions();
    expect(third).toEqual([POSITION]);
    expect(third).not.toBe(first);
  });

  it('a changed resource replaces the remembered ETag', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [], _meta: META }, ETAG_A))
      .mockResolvedValueOnce(ok({ data: [POSITION], _meta: META }, ETAG_B))
      .mockResolvedValueOnce(notModified(ETAG_B));
    const kash = client(fetchSpy as unknown as typeof fetch);
    await kash.portfolio.positions();
    await kash.portfolio.positions();
    expect(await kash.portfolio.positions()).toEqual([POSITION]);
    expect(sentHeader(fetchSpy.mock.calls[2]!, 'If-None-Match')).toBe(ETAG_B);
  });

  it('remembers per URL — a different query string is a different resource', async () => {
    const fetchSpy = vi.fn(async () => ok({ data: [], _meta: META }, ETAG_A));
    const kash = client(fetchSpy as typeof fetch);
    await kash.portfolio.positions({ marketId: POSITION.marketId });
    await kash.portfolio.positions();
    expect(sentHeader(fetchSpy.mock.calls[1]!, 'If-None-Match')).toBeUndefined();
  });

  it('a response without an ETag forgets the URL', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [], _meta: META }, ETAG_A))
      .mockResolvedValueOnce(ok({ data: [], _meta: META }))
      .mockResolvedValueOnce(ok({ data: [], _meta: META }));
    const kash = client(fetchSpy as unknown as typeof fetch);
    await kash.portfolio.positions();
    await kash.portfolio.positions();
    await kash.portfolio.positions();
    expect(sentHeader(fetchSpy.mock.calls[2]!, 'If-None-Match')).toBeUndefined();
  });

  it('`conditionalRequests: false` never sends a validator', async () => {
    const fetchSpy = vi.fn(async () => ok({ data: [], _meta: META }, ETAG_A));
    const kash = client(fetchSpy as typeof fetch, { conditionalRequests: false });
    await kash.portfolio.positions();
    await kash.portfolio.positions();
    expect(sentHeader(fetchSpy.mock.calls[1]!, 'If-None-Match')).toBeUndefined();
  });

  it('a caller cannot inject If-None-Match — a 304 it caused would have no body', async () => {
    const fetchSpy = vi.fn(async () => ok({ data: [], _meta: META }, ETAG_A));
    const kash = client(fetchSpy as typeof fetch, { headers: { 'If-None-Match': '*' } });
    await kash.portfolio.positions({}, { headers: { 'if-none-match': '*' } });
    expect(sentHeader(fetchSpy.mock.calls[0]!, 'If-None-Match')).toBeUndefined();
    expect(sentHeader(fetchSpy.mock.calls[0]!, 'if-none-match')).toBeUndefined();
  });

  it('an unsolicited 304 is a typed error, never an empty value', async () => {
    const fetchSpy = vi.fn(async () => notModified(ETAG_A));
    const kash = client(fetchSpy as typeof fetch);
    await expect(kash.portfolio.positions()).rejects.toMatchObject({
      code: 'SDK_UNEXPECTED_NOT_MODIFIED',
    });
    await expect(kash.portfolio.positions()).rejects.toBeInstanceOf(KashValidationError);
  });

  it('the onResponse hook reports status 304 and notModified', async () => {
    const events: ResponseHookEvent[] = [];
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [], _meta: META }, ETAG_A))
      .mockResolvedValueOnce(notModified(ETAG_A));
    const kash = client(fetchSpy as unknown as typeof fetch, {
      hooks: { onResponse: (e: ResponseHookEvent) => events.push(e) },
    });
    await kash.portfolio.positions();
    await kash.portfolio.positions();
    expect(events.map((e) => [e.status, e.notModified])).toEqual([
      [200, false],
      [304, true],
    ]);
  });

  it('a 304 resolves from the entry captured at send time, even if evicted meanwhile', async () => {
    // Review finding: resolving the 304 by a FRESH cache lookup turned a valid
    // 304 into SDK_UNEXPECTED_NOT_MODIFIED when another URL evicted the entry
    // while the request was in flight.
    let releaseConditional: (r: Response) => void = () => {};
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [POSITION], _meta: META }, ETAG_A)) // prime /positions
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseConditional = resolve;
          })
      ) // conditional /positions, held open
      .mockResolvedValueOnce(ok({ data: [], _meta: META }, ETAG_B)); // other URL evicts it
    const kash = client(fetchSpy as unknown as typeof fetch, { conditionalCacheMaxEntries: 1 });
    await kash.portfolio.positions();
    const pending = kash.portfolio.positions();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await kash.portfolio.positions({ marketId: POSITION.marketId });
    releaseConditional(notModified(ETAG_A));
    expect(await pending).toEqual([POSITION]);
  });

  it('the cache is bounded — the least recently used URL is evicted', async () => {
    const fetchSpy = vi.fn(async () => ok({ data: [], _meta: META }, ETAG_A));
    const kash = client(fetchSpy as typeof fetch, { conditionalCacheMaxEntries: 1 });
    await kash.portfolio.positions({ marketId: POSITION.marketId });
    await kash.portfolio.positions();
    await kash.portfolio.positions({ marketId: POSITION.marketId });
    expect(sentHeader(fetchSpy.mock.calls[2]!, 'If-None-Match')).toBeUndefined();
  });

  it('POST requests are never conditional, even to a URL with a remembered ETag', async () => {
    const fetchSpy = vi.fn(async () => ok({ ok: true }, ETAG_A));
    const http = new KashHttpClient(
      kashClientConfigSchema.parse({
        apiKey: API_KEY,
        baseUrl: BASE_URL,
        fetch: fetchSpy,
        maxRetries: 0,
      })
    );
    const schema = z.object({ ok: z.boolean() });
    await http.request({ path: '/things', method: 'GET', schema });
    await http.request({ path: '/things', method: 'POST', schema, body: {} });
    await http.request({ path: '/things', method: 'POST', schema, body: {} });
    expect(sentHeader(fetchSpy.mock.calls[1]!, 'If-None-Match')).toBeUndefined();
    expect(sentHeader(fetchSpy.mock.calls[2]!, 'If-None-Match')).toBeUndefined();
  });
});

describe('portfolio.watchPositions', () => {
  afterEach(() => {
    sleepState.sleeps.length = 0;
    sleepState.limit = Number.POSITIVE_INFINITY;
    sleepState.between = undefined;
  });

  it('does not miss a change another call on the same client revalidated first', async () => {
    // Review finding: the cache is per CLIENT. A `positions()` call between two
    // polls stores the new body and ETag; the watch's next poll then gets a
    // 304 that already carries the change. Reading that 304 as "unchanged"
    // would hold the stale view until the NEXT change.
    const changed = { ...POSITION, tradeCount: 2 };
    sleepState.limit = 2;
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [POSITION], _meta: META }, ETAG_A)) // watch poll 1
      .mockResolvedValueOnce(ok({ data: [changed], _meta: META }, ETAG_B)) // the other call
      .mockResolvedValueOnce(notModified(ETAG_B)); // watch poll 2
    const kash = client(fetchSpy as unknown as typeof fetch);
    let primed = false;
    sleepState.between = async () => {
      if (primed) return;
      primed = true;
      expect(await kash.portfolio.positions()).toEqual([changed]);
    };
    const yields: unknown[] = [];
    await expect(
      (async () => {
        for await (const value of kash.portfolio.watchPositions()) yields.push(value);
      })()
    ).rejects.toMatchObject({ code: 'TEST_STOP' });
    expect(sentHeader(fetchSpy.mock.calls[2]!, 'If-None-Match')).toBe(ETAG_B);
    expect(yields).toEqual([[POSITION], [changed]]);
  });

  /**
   * Run the watch until it has asked to sleep `polls` times. The sleep is
   * mocked (see `sleepState`), so the loop runs without real time and the
   * test reads exactly the intervals the backoff chose.
   */
  async function drive(responses: Response[], polls: number, params = {}) {
    sleepState.limit = polls;
    const fetchSpy = vi.fn();
    for (const r of responses) fetchSpy.mockResolvedValueOnce(r);
    const kash = client(fetchSpy as unknown as typeof fetch);
    const yields: unknown[] = [];
    await expect(
      (async () => {
        for await (const value of kash.portfolio.watchPositions(params)) yields.push(value);
      })()
    ).rejects.toMatchObject({ code: 'TEST_STOP' });
    return { yields, sleeps: [...sleepState.sleeps], fetchSpy };
  }

  it('yields once at start, not on 304s, again on change; backs off then snaps back', async () => {
    const changed = { ...POSITION, tradeCount: 2 };
    const { yields, sleeps, fetchSpy } = await drive(
      [
        ok({ data: [POSITION], _meta: META }, ETAG_A),
        notModified(ETAG_A),
        notModified(ETAG_A),
        ok({ data: [changed], _meta: META }, ETAG_B),
        notModified(ETAG_B),
      ],
      5
    );
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(yields).toEqual([[POSITION], [changed]]);
    const { minIntervalMs, backoffFactor } = WATCH_POSITIONS_DEFAULTS;
    expect(sleeps).toEqual([
      minIntervalMs,
      minIntervalMs * backoffFactor,
      minIntervalMs * backoffFactor ** 2,
      minIntervalMs,
      minIntervalMs * backoffFactor,
    ]);
  });

  it('never backs off past maxIntervalMs', async () => {
    const { sleeps } = await drive(
      [
        ok({ data: [], _meta: META }, ETAG_A),
        ...Array.from({ length: 6 }, () => notModified(ETAG_A)),
      ],
      7,
      { minIntervalMs: 1_000, maxIntervalMs: 3_000 }
    );
    expect(sleeps).toEqual([1_000, 2_000, 3_000, 3_000, 3_000, 3_000, 3_000]);
  });

  it('yields on its first poll even when that poll is a 304 (a primed client)', async () => {
    sleepState.limit = 2;
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [POSITION], _meta: META }, ETAG_A))
      .mockResolvedValueOnce(notModified(ETAG_A))
      .mockResolvedValueOnce(notModified(ETAG_A));
    const kash = client(fetchSpy as unknown as typeof fetch);
    await kash.portfolio.positions();
    const yields: unknown[] = [];
    await expect(
      (async () => {
        for await (const value of kash.portfolio.watchPositions()) yields.push(value);
      })()
    ).rejects.toMatchObject({ code: 'TEST_STOP' });
    expect(yields).toEqual([[POSITION]]);
  });

  it('without conditional requests it still yields only on change', async () => {
    sleepState.limit = 3;
    const fetchSpy = vi.fn(async () => ok({ data: [POSITION], _meta: META }, ETAG_A));
    const kash = client(fetchSpy as typeof fetch, { conditionalRequests: false });
    const yields: unknown[] = [];
    await expect(
      (async () => {
        for await (const value of kash.portfolio.watchPositions()) yields.push(value);
      })()
    ).rejects.toMatchObject({ code: 'TEST_STOP' });
    expect(yields).toHaveLength(1);
  });

  it('refuses a busy-loop interval', async () => {
    const kash = client(vi.fn() as unknown as typeof fetch);
    await expect(kash.portfolio.watchPositions({ minIntervalMs: 10 }).next()).rejects.toMatchObject(
      { code: 'SDK_CONFIGURATION' }
    );
  });
});
