/**
 * `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`: the server is still running an earlier
 * attempt with the same `Idempotency-Key`. The SDK's own loop produces it: an
 * attempt times out on the client (30 s by default) while the server keeps
 * its claim (60 s), and the retry, carrying the same key, finds it running.
 *
 * On a keyed request it is retried with the same key inside the normal retry
 * budget, so the caller receives the first attempt's answer and nothing is
 * done twice. Without a key it is never retried.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { KashConflictError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';
import { kashClientConfigSchema } from '../../src/internal/config.js';
import { KashHttpClient } from '../../src/internal/http.js';
import {
  IDEMPOTENCY_CLAIM_LIFETIME_MS,
  IN_PROGRESS_RETRY_CUTOFF_MS,
} from '../../src/internal/idempotency-key.js';
import {
  FIXTURE_PARTNER_ACCOUNT,
  FIXTURE_PARTNER_WITHDRAWAL,
} from '../contract/wire-shape.test.js';

import { META } from './_test-utils.js';

import type { RetryHookEvent } from '../../src/internal/config.js';

const ACCOUNT_ID = FIXTURE_PARTNER_ACCOUNT.accountId;

function inProgress(headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({
      status: 409,
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      detail: 'A request with this Idempotency-Key is still being processed.',
    }),
    { status: 409, headers: { 'content-type': 'application/problem+json', ...headers } }
  );
}

function created(replay: boolean): Response {
  return new Response(
    JSON.stringify({
      withdrawal: FIXTURE_PARTNER_WITHDRAWAL,
      _meta: { ...META, idempotent: false },
    }),
    {
      status: 202,
      headers: {
        'content-type': 'application/json',
        ...(replay ? { 'idempotent-replay': 'true' } : {}),
      },
    }
  );
}

/** A fetch that hangs until aborted: the SDK's timeout fires on it. */
function hangUntilAborted(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError'))
    );
  });
}

describe('IDEMPOTENCY_REQUEST_IN_PROGRESS', () => {
  it('timeout, then in progress, then the replayed answer: one withdrawal, one key throughout', async () => {
    const keys: Array<string | null> = [];
    const reasons: Array<RetryHookEvent['reason']> = [];
    const steps = [
      (init?: RequestInit) => hangUntilAborted(init),
      () => Promise.resolve(inProgress()),
      () => Promise.resolve(created(true)),
    ];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      timeoutMs: 20,
      maxRetries: 2,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
      hooks: { onRetry: (e) => reasons.push(e.reason) },
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        keys.push(new Headers(init?.headers).get('idempotency-key'));
        const step = steps.shift();
        if (!step) throw new Error('unexpected extra attempt');
        return step(init);
      }) as typeof fetch,
    });

    const result = await kash.partnerAccounts.withdrawals.create(
      ACCOUNT_ID,
      { amountAtomic: '2500000' },
      { idempotencyKey: 'withdraw-7f3a' }
    );

    expect(result).toEqual({
      withdrawal: FIXTURE_PARTNER_WITHDRAWAL,
      outcome: 'created',
      idempotentReplay: true,
    });
    expect(keys).toEqual(['withdraw-7f3a', 'withdraw-7f3a', 'withdraw-7f3a']);
    expect(reasons).toEqual(['timeout', 'idempotency_in_progress']);
  });

  it('honours a Retry-After the server sends with it', async () => {
    const delays: number[] = [];
    const responses = [inProgress({ 'retry-after': '0' }), created(true)];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      maxRetries: 2,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 2_000,
      hooks: { onRetry: (e) => delays.push(e.delayMs) },
      fetch: vi.fn(async () => responses.shift()!) as typeof fetch,
    });

    await kash.partnerAccounts.withdrawals.create(
      ACCOUNT_ID,
      { amountAtomic: '2500000' },
      { idempotencyKey: 'withdraw-7f3a' }
    );

    expect(delays).toEqual([0]);
  });

  it('still in progress when the retry budget runs out: KashConflictError with the code', async () => {
    const fetchSpy = vi.fn(async () => inProgress());
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      maxRetries: 2,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
      fetch: fetchSpy as typeof fetch,
    });

    const err = await kash.partnerAccounts.withdrawals
      .create(ACCOUNT_ID, { amountAtomic: '2500000' }, { idempotencyKey: 'withdraw-7f3a' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KashConflictError);
    expect((err as KashConflictError).code).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('a request without an Idempotency-Key is never retried on it', async () => {
    const fetchSpy = vi.fn(async () => inProgress());
    const http = new KashHttpClient(
      kashClientConfigSchema.parse({
        apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        baseUrl: 'https://api.test.local/v1',
        maxRetries: 2,
        retryBaseDelayMs: 1,
        retryMaxDelayMs: 2,
        fetch: fetchSpy,
      })
    );

    // PATCH is not auto-keyed, so this request carries no key at all.
    await expect(
      http.request({ path: '/x', method: 'PATCH', schema: z.object({}), body: {} })
    ).rejects.toBeInstanceOf(KashConflictError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchSpy.mock.calls[0]![1]?.headers).has('idempotency-key')).toBe(false);
  });

  it('any other conflict on a keyed request is still not retried', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ status: 409, code: 'IDEMPOTENCY_KEY_CONFLICT', detail: 'x' }),
          { status: 409, headers: { 'content-type': 'application/problem+json' } }
        )
    );
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      maxRetries: 2,
      fetch: fetchSpy as typeof fetch,
    });

    await expect(
      kash.partnerAccounts.withdrawals.create(
        ACCOUNT_ID,
        { amountAtomic: '2500000' },
        { idempotencyKey: 'withdraw-7f3a' }
      )
    ).rejects.toBeInstanceOf(KashConflictError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * The API sends `Retry-After` with the claim's time left. The SDK honours it,
 * but its waits on in-progress for one call add up to at most the claim's
 * lifetime (60 s, the API's `IN_FLIGHT_SECONDS`): past that the claim has
 * lapsed and waiting longer cannot produce the first attempt's answer.
 */
describe('IDEMPOTENCY_REQUEST_IN_PROGRESS with the server Retry-After, cut off before the claim can lapse', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function clientAnswering(responses: Response[]): {
    kash: KashClient;
    calls: () => number;
    delays: number[];
  } {
    let n = 0;
    const delays: number[] = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      maxRetries: 5,
      hooks: { onRetry: (e) => delays.push(e.delayMs) },
      fetch: (async () => {
        n += 1;
        const next = responses.shift();
        if (!next) throw new Error('unexpected extra attempt');
        return next;
      }) as typeof fetch,
    });
    return { kash, calls: () => n, delays };
  }

  const create = (kash: KashClient) =>
    kash.partnerAccounts.withdrawals.create(
      ACCOUNT_ID,
      { amountAtomic: '2500000' },
      { idempotencyKey: 'withdraw-7f3a' }
    );

  it("waits the time the server names, then returns the first attempt's answer", async () => {
    vi.useFakeTimers();
    const { kash, calls, delays } = clientAnswering([
      inProgress({ 'retry-after': '40' }),
      created(true),
    ]);

    const done = create(kash);
    await vi.advanceTimersByTimeAsync(40_000);

    await expect(done).resolves.toMatchObject({ idempotentReplay: true });
    expect(delays).toEqual([40_000]);
    expect(calls()).toBe(2);
  });

  it('polling every 5 s never sends a retry at or after 45 s (claim lifetime 60 s less the margin)', async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const sentAt: number[] = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      maxRetries: 10,
      fetch: (async () => {
        sentAt.push(Date.now() - start);
        return inProgress({ 'retry-after': '5' });
      }) as typeof fetch,
    });

    const done = create(kash).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    const err = await done;

    expect((err as KashConflictError).code).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    expect(sentAt).toEqual([0, 5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000]);
    expect(Math.max(...sentAt)).toBeLessThan(IN_PROGRESS_RETRY_CUTOFF_MS);
  });

  it('a slow first attempt counts: after a 30 s timeout the retries stop before 45 s', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const start = Date.now();
    const sentAt: number[] = [];
    let first = true;
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      maxRetries: 10,
      timeoutMs: 30_000,
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        sentAt.push(Date.now() - start);
        if (first) {
          first = false;
          return hangUntilAborted(init);
        }
        return inProgress({ 'retry-after': '5' });
      }) as typeof fetch,
    });

    const done = create(kash).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    const err = await done;

    expect((err as KashConflictError).code).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    expect(sentAt).toEqual([0, 30_000, 35_000, 40_000]);
    vi.restoreAllMocks();
  });

  it('the cutoff is the claim lifetime less a 15 s margin', () => {
    expect(IDEMPOTENCY_CLAIM_LIFETIME_MS).toBe(60_000);
    expect(IN_PROGRESS_RETRY_CUTOFF_MS).toBe(45_000);
  });

  it('a wait that would pass the claim lifetime is not taken: the conflict surfaces', async () => {
    vi.useFakeTimers();
    const { kash, calls, delays } = clientAnswering([
      inProgress({ 'retry-after': '40' }),
      inProgress({ 'retry-after': '40' }),
    ]);

    const done = create(kash).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(40_000);
    const err = await done;

    expect(err).toBeInstanceOf(KashConflictError);
    expect((err as KashConflictError).code).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    expect((err as KashConflictError).retryAfterSeconds).toBe(40);
    expect(delays).toEqual([40_000]);
    expect(calls()).toBe(2);
  });
});
