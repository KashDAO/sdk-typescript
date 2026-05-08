import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { kashClientConfigSchema } from '../../src/internal/config.js';
import { KashHttpClient } from '../../src/internal/http.js';
import {
  KashAbortedError,
  KashAuthenticationError,
  KashConflictError,
  KashNetworkError,
  KashRateLimitError,
  KashServerError,
  KashTimeoutError,
  KashValidationError,
} from '../../src/errors.js';

const responseSchema = z.object({ ok: z.boolean() });

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers,
  });
}

function problemResponse(
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json', ...extraHeaders },
  });
}

function makeClient(
  fetchImpl: typeof fetch,
  overrides: Record<string, unknown> = {}
): KashHttpClient {
  const config = kashClientConfigSchema.parse({
    apiKey: 'kash_test_abcabcabcabcabcabcabcabcabcabcab',
    baseUrl: 'https://api.test.local/v1',
    timeoutMs: 1_000,
    maxRetries: 0,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 4,
    fetch: fetchImpl,
    ...overrides,
  });
  return new KashHttpClient(config);
}

describe('KashHttpClient.request', () => {
  beforeEach(() => {
    vi.useRealTimers();
    // Disable jitter randomness for deterministic backoff timing.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets X-API-Key header when apiKey present', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    const client = makeClient(fetchSpy as typeof fetch);
    await client.request({ path: '/ping', method: 'GET', schema: responseSchema });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe(
      'kash_test_abcabcabcabcabcabcabcabcabcabcab'
    );
  });

  it('omits X-API-Key when apiKey is undefined', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    const client = makeClient(fetchSpy as typeof fetch, { apiKey: undefined });
    await client.request({ path: '/markets', method: 'GET', schema: responseSchema });
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-API-Key']).toBeUndefined();
  });

  it('sets X-Kash-Api-Version header from the SDK default', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    const client = makeClient(fetchSpy as typeof fetch);
    await client.request({ path: '/ping', method: 'GET', schema: responseSchema });
    const headers = fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['X-Kash-Api-Version']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('honours an explicit apiVersion override', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    const client = makeClient(fetchSpy as typeof fetch, { apiVersion: '2026-08-15' });
    await client.request({ path: '/ping', method: 'GET', schema: responseSchema });
    const headers = fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['X-Kash-Api-Version']).toBe('2026-08-15');
  });

  it('X-Kash-Api-Version cannot be overridden via per-call headers', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    const client = makeClient(fetchSpy as typeof fetch, { apiVersion: '2026-05-02' });
    await client.request({
      path: '/ping',
      method: 'GET',
      schema: responseSchema,
      headers: { 'X-Kash-Api-Version': '1999-01-01' },
    });
    const headers = fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['X-Kash-Api-Version']).toBe('2026-05-02');
  });

  it('onResponse — exposes parsed X-RateLimit-* state on success', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-limit': '100',
            'x-ratelimit-remaining': '42',
            'x-ratelimit-reset': '17',
          },
        })
    );
    const events: Array<{ rateLimit: unknown }> = [];
    const client = makeClient(fetchSpy as typeof fetch, {
      hooks: { onResponse: (e: { rateLimit: unknown }) => events.push({ rateLimit: e.rateLimit }) },
    });
    await client.request({ path: '/ping', method: 'GET', schema: responseSchema });
    expect(events[0]?.rateLimit).toEqual({ limit: 100, remaining: 42, resetSeconds: 17 });
  });

  it('onResponse — rateLimit is null when headers are missing', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    const events: Array<{ rateLimit: unknown }> = [];
    const client = makeClient(fetchSpy as typeof fetch, {
      hooks: { onResponse: (e: { rateLimit: unknown }) => events.push({ rateLimit: e.rateLimit }) },
    });
    await client.request({ path: '/ping', method: 'GET', schema: responseSchema });
    expect(events[0]?.rateLimit).toBeNull();
  });

  it('error path — surfaces rateLimit on the thrown KashError', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'RATE_LIMITED', detail: 'slow down' }), {
          status: 429,
          headers: {
            'content-type': 'application/problem+json',
            'x-ratelimit-limit': '10',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '5',
            'retry-after': '5',
          },
        })
    );
    const client = makeClient(fetchSpy as typeof fetch);
    try {
      await client.request({ path: '/trades', method: 'POST', schema: responseSchema, body: {} });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as KashRateLimitError).rateLimit).toEqual({
        limit: 10,
        remaining: 0,
        resetSeconds: 5,
      });
    }
  });

  it('cross-mode 401 — appends a hint when a kash_test_* key targets production', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'API_KEY_INVALID', detail: 'invalid key' }), {
          status: 401,
          headers: { 'content-type': 'application/problem+json' },
        })
    );
    const client = makeClient(fetchSpy as typeof fetch, {
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      // Explicit production base URL — the prefix-vs-baseUrl mismatch
      // is what triggers the hint.
      baseUrl: 'https://api.kash.bot/v1',
    });
    try {
      await client.request({ path: '/trades', method: 'GET', schema: responseSchema });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as KashAuthenticationError).message).toMatch(/kash_test_/);
      expect((err as KashAuthenticationError).message).toMatch(/production URL/);
    }
  });

  it('cross-mode 401 — appends a hint when a kash_live_* key targets staging', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'API_KEY_INVALID' }), {
          status: 401,
          headers: { 'content-type': 'application/problem+json' },
        })
    );
    const client = makeClient(fetchSpy as typeof fetch, {
      apiKey: 'kash_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api-staging.kash.bot/v1',
    });
    try {
      await client.request({ path: '/trades', method: 'GET', schema: responseSchema });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as KashAuthenticationError).message).toMatch(/kash_live_/);
      expect((err as KashAuthenticationError).message).toMatch(/staging URL/);
    }
  });

  it('cross-mode 401 — does NOT add a hint when key prefix matches base URL', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'API_KEY_INVALID', detail: 'revoked' }), {
          status: 401,
          headers: { 'content-type': 'application/problem+json' },
        })
    );
    const client = makeClient(fetchSpy as typeof fetch, {
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api-staging.kash.bot/v1',
    });
    try {
      await client.request({ path: '/trades', method: 'GET', schema: responseSchema });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as KashAuthenticationError).message).toBe('revoked');
    }
  });

  it('sets Idempotency-Key when supplied', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    const client = makeClient(fetchSpy as typeof fetch);
    await client.request({
      path: '/trades',
      method: 'POST',
      schema: responseSchema,
      body: { hello: 'world' },
      idempotencyKey: 'idem-1',
    });
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-1');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ hello: 'world' }));
  });

  it('serialises query params (skips undefined and null)', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    const client = makeClient(fetchSpy as typeof fetch);
    await client.request({
      path: '/trades',
      method: 'GET',
      schema: responseSchema,
      query: { cursor: 'abc', limit: 20, status: undefined, marketId: null },
    });
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toBe('https://api.test.local/v1/trades?cursor=abc&limit=20');
  });

  it('returns the parsed response on 200', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    const client = makeClient(fetchSpy as typeof fetch);
    const result = await client.request({
      path: '/ping',
      method: 'GET',
      schema: responseSchema,
    });
    expect(result).toEqual({ ok: true });
  });

  it('throws KashValidationError on non-JSON 200 content-type', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response('plain', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
    );
    const client = makeClient(fetchSpy as typeof fetch);
    await expect(
      client.request({ path: '/x', method: 'GET', schema: responseSchema })
    ).rejects.toBeInstanceOf(KashValidationError);
  });

  it('throws KashValidationError when response body fails Zod parse', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: 'not-a-boolean' }));
    const client = makeClient(fetchSpy as typeof fetch);
    await expect(
      client.request({ path: '/x', method: 'GET', schema: responseSchema })
    ).rejects.toBeInstanceOf(KashValidationError);
  });

  it('classifies 401 with API_KEY_MISSING → KashAuthenticationError, no retry', async () => {
    const fetchSpy = vi.fn(async () =>
      problemResponse(401, { code: 'API_KEY_MISSING', detail: 'No key' })
    );
    const client = makeClient(fetchSpy as typeof fetch, { maxRetries: 3 });
    await expect(
      client.request({ path: '/x', method: 'GET', schema: responseSchema })
    ).rejects.toBeInstanceOf(KashAuthenticationError);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('classifies 409 IDEMPOTENCY_KEY_CONFLICT → KashConflictError, no retry', async () => {
    const fetchSpy = vi.fn(async () => problemResponse(409, { code: 'IDEMPOTENCY_KEY_CONFLICT' }));
    const client = makeClient(fetchSpy as typeof fetch, { maxRetries: 3 });
    await expect(
      client.request({ path: '/x', method: 'POST', schema: responseSchema, body: {} })
    ).rejects.toBeInstanceOf(KashConflictError);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('retries on 500 then succeeds', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(problemResponse(500, { code: 'INTERNAL_ERROR' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = makeClient(fetchSpy as typeof fetch, { maxRetries: 3 });
    const result = await client.request({
      path: '/x',
      method: 'GET',
      schema: responseSchema,
    });
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws KashServerError after exhausting retries on 500', async () => {
    const fetchSpy = vi.fn(async () => problemResponse(500, { code: 'INTERNAL_ERROR' }));
    const client = makeClient(fetchSpy as typeof fetch, { maxRetries: 2 });
    await expect(
      client.request({ path: '/x', method: 'GET', schema: responseSchema })
    ).rejects.toBeInstanceOf(KashServerError);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('retries on 429 with Retry-After and reads value from header', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        problemResponse(429, { code: 'RATE_LIMIT_EXCEEDED' }, { 'retry-after': '0' })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = makeClient(fetchSpy as typeof fetch, { maxRetries: 3 });
    const result = await client.request({
      path: '/x',
      method: 'GET',
      schema: responseSchema,
    });
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('after exhausting retries on 429, throws KashRateLimitError with retryAfterSeconds', async () => {
    const fetchSpy = vi.fn(async () =>
      problemResponse(429, { code: 'RATE_LIMIT_EXCEEDED' }, { 'retry-after': '0' })
    );
    const client = makeClient(fetchSpy as typeof fetch, { maxRetries: 1 });
    const err = await client
      .request({ path: '/x', method: 'GET', schema: responseSchema })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashRateLimitError);
    expect((err as KashRateLimitError).retryAfterSeconds).toBe(0);
  });

  it('throws KashTimeoutError when fetch never resolves before timeout', async () => {
    const fetchSpy = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        })
    );
    const client = makeClient(fetchSpy as typeof fetch, { timeoutMs: 30, maxRetries: 0 });
    await expect(
      client.request({ path: '/x', method: 'GET', schema: responseSchema })
    ).rejects.toBeInstanceOf(KashTimeoutError);
  });

  it('wraps fetch throws into KashNetworkError with cause set', async () => {
    const root = new Error('connect ECONNREFUSED');
    const fetchSpy = vi.fn(async () => {
      throw root;
    });
    const client = makeClient(fetchSpy as typeof fetch, { maxRetries: 0 });
    const err = await client
      .request({ path: '/x', method: 'GET', schema: responseSchema })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashNetworkError);
    expect((err as KashNetworkError).cause).toBe(root);
  });

  it('populates requestId from X-Request-ID header', async () => {
    const fetchSpy = vi.fn(async () =>
      problemResponse(400, { code: 'VALIDATION_FAILED' }, { 'x-request-id': 'req-xyz' })
    );
    const client = makeClient(fetchSpy as typeof fetch, { maxRetries: 0 });
    const err = await client
      .request({ path: '/x', method: 'GET', schema: responseSchema })
      .catch((e: unknown) => e);
    expect((err as KashValidationError).requestId).toBe('req-xyz');
  });

  it('caller-driven abort BEFORE send → KashAbortedError, no retry', async () => {
    const fetchSpy = vi.fn();
    const client = makeClient(fetchSpy as typeof fetch, { maxRetries: 3 });
    const controller = new AbortController();
    controller.abort(new Error('user cancelled'));
    const err = await client
      .request({
        path: '/x',
        method: 'GET',
        schema: responseSchema,
        signal: controller.signal,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashAbortedError);
    // Critical: the retry loop must NOT have invoked fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('caller-driven abort MID-FLIGHT → KashAbortedError, no retry', async () => {
    let abortHandler: (() => void) | undefined;
    const fetchSpy = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          abortHandler = (): void => reject(new DOMException('aborted', 'AbortError'));
          init?.signal?.addEventListener('abort', abortHandler);
        })
    );
    const client = makeClient(fetchSpy as typeof fetch, { maxRetries: 3 });
    const controller = new AbortController();
    const promise = client.request({
      path: '/x',
      method: 'GET',
      schema: responseSchema,
      signal: controller.signal,
    });
    // Wait one microtask for the request to start, then abort.
    await Promise.resolve();
    controller.abort();
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashAbortedError);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('caller abort during retry backoff → KashAbortedError, stops the loop', async () => {
    // The first attempt fails retryably; we abort during the sleep
    // before the second attempt fires.
    let firstResolved = false;
    const fetchSpy = vi.fn(async () => {
      firstResolved = true;
      return problemResponse(500, { code: 'INTERNAL_ERROR' });
    });
    const client = makeClient(fetchSpy as typeof fetch, {
      maxRetries: 3,
      retryBaseDelayMs: 50,
      retryMaxDelayMs: 50,
    });
    // Ensure the backoff actually waits — disable the random-zero
    // override for this test by spying at full delay.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const controller = new AbortController();
    const promise = client.request({
      path: '/x',
      method: 'GET',
      schema: responseSchema,
      signal: controller.signal,
    });
    // Wait until the first attempt's response has been consumed and
    // the loop has entered the backoff sleep.
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        if (firstResolved) resolve();
        else setTimeout(tick, 1);
      };
      tick();
    });
    controller.abort();
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashAbortedError);
    // Only the first attempt fired; the abort short-circuited the
    // backoff before the retry could run.
    expect(fetchSpy).toHaveBeenCalledOnce();
    // The abort surfaces decorated with the same context as the
    // top-of-loop abort path: method, path, and 1-indexed attempt number.
    expect((err as KashAbortedError).context).toMatchObject({
      method: 'GET',
      path: '/x',
      attempt: 1,
    });
  });

  it('Retry-After exceeding retryAfterMaxMs → throws immediately, no retry', async () => {
    // Server says wait 120 seconds; configured cap is 5 seconds.
    // We respect the server's intent (don't retry sooner) and
    // surface KashRateLimitError so the consumer can app-level back off.
    const fetchSpy = vi.fn(async () =>
      problemResponse(429, { code: 'RATE_LIMIT_EXCEEDED' }, { 'retry-after': '120' })
    );
    const client = makeClient(fetchSpy as typeof fetch, {
      maxRetries: 5,
      retryAfterMaxMs: 5_000,
    });
    const err = await client
      .request({ path: '/x', method: 'GET', schema: responseSchema })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashRateLimitError);
    expect((err as KashRateLimitError).retryAfterSeconds).toBe(120);
    // Critical: exactly one fetch — no silent "retry too soon."
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('Retry-After within cap → does retry', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        problemResponse(429, { code: 'RATE_LIMIT_EXCEEDED' }, { 'retry-after': '0' })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = makeClient(fetchSpy as typeof fetch, {
      maxRetries: 3,
      retryAfterMaxMs: 60_000,
    });
    const result = await client.request({ path: '/x', method: 'GET', schema: responseSchema });
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('errors carry method/path/attempt context after retry', async () => {
    const fetchSpy = vi.fn(async () => problemResponse(500, { code: 'INTERNAL_ERROR' }));
    const client = makeClient(fetchSpy as typeof fetch, { maxRetries: 2 });
    const err = await client
      .request({ path: '/trades/abc', method: 'POST', schema: responseSchema, body: {} })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashServerError);
    const ctx = (err as KashServerError).context;
    expect(ctx).toBeDefined();
    expect(ctx!.method).toBe('POST');
    expect(ctx!.path).toBe('/trades/abc');
    expect(ctx!.attempt).toBe(3); // initial + 2 retries
  });

  it('error.toJSON() returns a serialisable shape with no cause/stack', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'IDEMPOTENCY_KEY_CONFLICT' }), {
          status: 409,
          headers: {
            'content-type': 'application/problem+json',
            'x-request-id': 'req-99',
            'x-api-version': '2026-04-29',
            'idempotent-replay': 'true',
            sunset: 'Sun, 29 Apr 2027 00:00:00 GMT',
            'x-ratelimit-limit': '60',
            'x-ratelimit-remaining': '12',
            'x-ratelimit-reset': '7',
          },
        })
    );
    const client = makeClient(fetchSpy as typeof fetch, { maxRetries: 0 });
    const err = await client
      .request({ path: '/trades', method: 'POST', schema: responseSchema, body: {} })
      .catch((e: unknown) => e);
    const json = (err as KashConflictError).toJSON();
    expect(json).toMatchObject({
      name: 'KashConflictError',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      statusCode: 409,
      requestId: 'req-99',
      isRetryable: false,
      // rateLimit field is preserved so structured loggers see it.
      rateLimit: { limit: 60, remaining: 12, resetSeconds: 7 },
      // apiVersion field is preserved so consumers can correlate
      // failures with a specific server-side rollout.
      apiVersion: '2026-04-29',
      // idempotentReplay + deprecation fields are preserved so
      // consumers can detect cached failures and sunset advisories
      // through their structured logging surface.
      idempotentReplay: true,
      deprecation: {
        sunset: 'Sun, 29 Apr 2027 00:00:00 GMT',
        deprecation: undefined,
        link: undefined,
      },
    });
    // RFC 7807 extensions roundtrip — body had no extension members,
    // so toJSON's extensions field is present and undefined.
    expect(json).toHaveProperty('extensions');
    expect(json['extensions']).toBeUndefined();
    expect(json).not.toHaveProperty('cause');
    expect(json).not.toHaveProperty('stack');
  });

  it('retries on network errors (cause-chained)', async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = makeClient(fetchSpy as typeof fetch, { maxRetries: 3 });
    const result = await client.request({
      path: '/x',
      method: 'GET',
      schema: responseSchema,
    });
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
