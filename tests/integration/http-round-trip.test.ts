/**
 * HTTP round-trip integration tests.
 *
 * Spins up a real `http.createServer` on an ephemeral port for each
 * test group, points a `KashClient` at it, and verifies the SDK's
 * full request/response pipeline — header injection, retry logic,
 * idempotency replay, rate-limit backoff, error classification, and
 * caller-driven abort — without any `fetch` mocking.
 *
 * No testcontainers, no undici, no supertest. Pure Node `http` module.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KashAbortedError, KashServerError, KashTimeoutError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';

// ---------------------------------------------------------------------------
// Stub server helpers
// ---------------------------------------------------------------------------

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
type RouteMap = Map<string, RouteHandler>;

function buildServer(routes: RouteMap): Server {
  return createServer(async (req, res) => {
    const key = `${req.method} ${req.url?.split('?')[0] ?? '/'}`;
    const handler = routes.get(key);
    if (handler) {
      try {
        await handler(req, res);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', detail: String(err) }));
        }
      }
    } else {
      res.writeHead(404, { 'content-type': 'application/problem+json' });
      res.end(
        JSON.stringify({
          status: 404,
          code: 'RESOURCE_NOT_FOUND',
          detail: `No stub for ${key}`,
        })
      );
    }
  });
}

function listenOnEphemeralPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      } else {
        reject(new Error('Could not determine ephemeral port'));
      }
    });
    server.once('error', reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections?.();
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function jsonReply(
  res: ServerResponse,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload).toString(),
    ...extraHeaders,
  });
  res.end(payload);
}

function problemReply(
  res: ServerResponse,
  body: Record<string, unknown>,
  status: number,
  extraHeaders: Record<string, string> = {}
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/problem+json',
    'content-length': Buffer.byteLength(payload).toString(),
    ...extraHeaders,
  });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// Canonical fixture data
// ---------------------------------------------------------------------------

const HEALTH_PAYLOAD = { status: 'ok', service: 'kash-api', version: '0.1.0' };

const MARKET = {
  id: '00000000-0000-0000-0000-000000000001',
  contractAddress: '0xabc',
  chainId: 8453,
  title: 'Will it rain?',
  description: null,
  status: 'ACTIVE',
  outcomeCount: 2,
  outcomes: [
    { index: 0, label: 'Yes', probability: 0.5 },
    { index: 1, label: 'No', probability: 0.5 },
  ],
  imageUrl: null,
  createdAt: '2026-04-30T12:00:00.000Z',
  expiresAt: null,
  resolvedAt: null,
};

const TRADE = {
  id: '00000000-0000-0000-0000-000000000010',
  marketId: '00000000-0000-0000-0000-000000000001',
  outcomeIndex: 0,
  amount: '100',
  side: 'buy',
  status: 'pending',
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('http-round-trip', () => {
  let server: Server;
  let baseUrl: string;

  // Each test in this suite sees the routes configured in beforeEach. Tests
  // that need different behaviour create their own server inline.
  beforeEach(async () => {
    const routes: RouteMap = new Map();

    // GET /v1/health
    routes.set('GET /v1/health', (_req, res) => {
      const requestId = (_req.headers['x-request-id'] as string | undefined) ?? 'stub-req-1';
      jsonReply(res, HEALTH_PAYLOAD, 200, { 'x-request-id': requestId });
    });

    // GET /v1/markets
    routes.set('GET /v1/markets', (req, res) => {
      const requestId = (req.headers['x-request-id'] as string | undefined) ?? 'stub-req-2';
      const apiKey = req.headers['x-api-key'] as string | undefined;
      const kashVersion = req.headers['kash-version'] as string | undefined;
      // Echo the key + version into the response body so test can assert on them.
      jsonReply(
        res,
        {
          data: [MARKET],
          pagination: { cursor: null, hasMore: false, limit: 20 },
          _meta: {
            requestId,
            timestamp: '2026-04-30T12:00:00.000Z',
            // Echo back SDK headers for assertion
            _echo: { apiKey, kashVersion, xRequestId: requestId },
          },
        },
        200,
        { 'x-request-id': requestId }
      );
    });

    // POST /v1/trades — first call fresh, second call with same Idempotency-Key is replay
    const seenIdempotencyKeys = new Set<string>();
    routes.set('POST /v1/trades', async (req, res) => {
      await readBody(req);
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
      const requestId = (req.headers['x-request-id'] as string | undefined) ?? 'stub-req-3';
      const isReplay = idempotencyKey !== undefined && seenIdempotencyKeys.has(idempotencyKey);
      if (idempotencyKey) seenIdempotencyKeys.add(idempotencyKey);

      const status = isReplay ? 200 : 201;
      jsonReply(
        res,
        {
          trade: TRADE,
          data: TRADE,
          _meta: {
            requestId,
            timestamp: '2026-04-30T12:00:00.000Z',
            idempotent: isReplay,
          },
        },
        status,
        {
          'x-request-id': requestId,
          ...(isReplay ? { 'idempotent-replay': 'true' } : {}),
        }
      );
    });

    server = buildServer(routes);
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}/v1`;
  });

  afterEach(async () => {
    await closeServer(server);
  });

  // -------------------------------------------------------------------------
  // 1. healthCheck() reaches the server and returns a structured result
  // -------------------------------------------------------------------------
  it('healthCheck — real HTTP call returns ok=true with latency', async () => {
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl,
      maxRetries: 0,
    });

    const result = await kash.healthCheck();

    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(result.status).toBe('ok');
    expect(result.version).toBe('0.1.0');
  });

  // -------------------------------------------------------------------------
  // 2. markets.list() sends X-API-Key, Kash-Version, X-Request-ID
  // -------------------------------------------------------------------------
  it('markets.list — sends X-API-Key, Kash-Version, and X-Request-ID headers', async () => {
    // Capture raw requests on the server side to verify headers.
    const capturedHeaders: Record<string, string | string[] | undefined> = {};

    // Override the markets route for this test to capture headers.
    const routes: RouteMap = new Map();
    routes.set('GET /v1/markets', (req, res) => {
      Object.assign(capturedHeaders, req.headers);
      const requestId = (req.headers['x-request-id'] as string | undefined) ?? 'generated-by-stub';
      jsonReply(
        res,
        {
          data: [MARKET],
          pagination: { cursor: null, hasMore: false, limit: 20 },
          _meta: { requestId, timestamp: '2026-04-30T12:00:00.000Z' },
        },
        200,
        { 'x-request-id': requestId }
      );
    });

    const localServer = buildServer(routes);
    const port = await listenOnEphemeralPort(localServer);

    try {
      const kash = new KashClient({
        apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        maxRetries: 0,
      });

      const page = await kash.markets.list();
      expect(page.data).toHaveLength(1);
      expect(page.data[0]!.id).toBe(MARKET.id);

      // SDK must inject X-API-Key on every request.
      expect(capturedHeaders['x-api-key']).toBe('kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');

      // SDK must inject a Kash-Version (ISO date format).
      expect(typeof capturedHeaders['kash-version']).toBe('string');
      expect(capturedHeaders['kash-version'] as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // SDK must inject a User-Agent.
      expect(capturedHeaders['user-agent'] as string).toContain('@kashdao/sdk');
    } finally {
      await closeServer(localServer);
    }
  });

  // -------------------------------------------------------------------------
  // 3. Idempotency replay — second call with same key returns idempotent:true
  // -------------------------------------------------------------------------
  it('idempotency replay — onResponse hook fires with idempotentReplay=true on second call', async () => {
    const responseEvents: Array<{ idempotentReplay: boolean }> = [];

    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl,
      maxRetries: 0,
      hooks: {
        onResponse: (e) => responseEvents.push({ idempotentReplay: e.idempotentReplay }),
      },
    });

    const body = {
      marketId: TRADE.marketId,
      outcomeIndex: 0,
      amount: '100',
      side: 'buy' as const,
    };
    const key = 'idem-round-trip-key-001';

    const first = await kash.trades.create(body, { idempotencyKey: key });
    const second = await kash.trades.create(body, { idempotencyKey: key });

    // SDK surfaces idempotent flag from the response body's _meta.idempotent.
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);

    // onResponse hook must reflect the server's Idempotent-Replay header.
    expect(responseEvents).toHaveLength(2);
    expect(responseEvents[0]!.idempotentReplay).toBe(false);
    expect(responseEvents[1]!.idempotentReplay).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. 429 rate-limit — SDK retries after Retry-After, onRetry hook fires
  // -------------------------------------------------------------------------
  it('rate-limit 429 — SDK retries once after Retry-After and succeeds; onRetry fires', async () => {
    const retryEvents: Array<{ reason: string; delayMs: number }> = [];
    let callCount = 0;

    const routes: RouteMap = new Map();
    routes.set('POST /v1/trades', async (req, res) => {
      await readBody(req);
      callCount += 1;
      if (callCount === 1) {
        problemReply(
          res,
          {
            status: 429,
            code: 'RATE_LIMIT_EXCEEDED',
            detail: 'Too many requests.',
          },
          429,
          {
            'retry-after': '1',
            'x-ratelimit-limit': '100',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1',
          }
        );
      } else {
        jsonReply(
          res,
          {
            trade: TRADE,
            data: TRADE,
            _meta: {
              requestId: 'r-retry',
              timestamp: '2026-04-30T12:00:00.000Z',
              idempotent: false,
            },
          },
          201
        );
      }
    });

    const localServer = buildServer(routes);
    const port = await listenOnEphemeralPort(localServer);

    try {
      const kash = new KashClient({
        apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        // 1 retry allowed; Retry-After of 1s is within the default retryAfterMaxMs (60s).
        maxRetries: 1,
        // Keep the test fast by capping the max wait.
        retryAfterMaxMs: 5_000,
        hooks: {
          onRetry: (e) => retryEvents.push({ reason: e.reason, delayMs: e.delayMs }),
        },
      });

      const trade = await kash.trades.create({
        marketId: TRADE.marketId,
        outcomeIndex: 0,
        amount: '100',
        side: 'buy',
      });

      expect(trade.id).toBe(TRADE.id);
      expect(callCount).toBe(2);

      // onRetry must have fired exactly once (the 429 → retry).
      expect(retryEvents).toHaveLength(1);
      expect(retryEvents[0]!.reason).toBe('rate_limit');
      // Retry-After: 1 → 1000 ms delay.
      expect(retryEvents[0]!.delayMs).toBe(1_000);
    } finally {
      await closeServer(localServer);
    }
  });

  // -------------------------------------------------------------------------
  // 5. 500 server error → KashServerError with requestId from response
  // -------------------------------------------------------------------------
  it('500 server error — throws KashServerError carrying requestId', async () => {
    const sentRequestId = 'req-id-from-server-500';
    const routes: RouteMap = new Map();
    routes.set('GET /v1/trades/bad-id', (_req, res) => {
      problemReply(
        res,
        {
          status: 500,
          code: 'INTERNAL_ERROR',
          detail: 'Something went wrong.',
          requestId: sentRequestId,
        },
        500,
        { 'x-request-id': sentRequestId }
      );
    });

    const localServer = buildServer(routes);
    const port = await listenOnEphemeralPort(localServer);

    try {
      const kash = new KashClient({
        apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        maxRetries: 0,
      });

      await expect(kash.trades.get('bad-id')).rejects.toSatisfy((err: unknown) => {
        if (!(err instanceof KashServerError)) return false;
        expect(err.statusCode).toBe(500);
        expect(err.requestId).toBe(sentRequestId);
        return true;
      });
    } finally {
      await closeServer(localServer);
    }
  });

  // -------------------------------------------------------------------------
  // 6. Timeout — server delays 200 ms, caller passes AbortSignal.timeout(50)
  // -------------------------------------------------------------------------
  it('timeout — AbortSignal.timeout(50) against a slow server rejects with abort/timeout error', async () => {
    const routes: RouteMap = new Map();
    routes.set('GET /v1/health', (_req, res) => {
      // Delay response beyond the abort signal timeout.
      setTimeout(() => {
        if (!res.destroyed) jsonReply(res, HEALTH_PAYLOAD);
      }, 300);
    });

    const localServer = buildServer(routes);
    const port = await listenOnEphemeralPort(localServer);

    try {
      const kash = new KashClient({
        apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        maxRetries: 0,
        // Give the SDK itself a generous timeout — the caller's signal fires first.
        timeoutMs: 5_000,
      });

      await expect(kash.healthCheck({ signal: AbortSignal.timeout(50) })).rejects.toSatisfy(
        (err: unknown) => {
          // The SDK classifies a caller-driven abort as KashAbortedError.
          // When AbortSignal.timeout() fires it may surface as KashAbortedError
          // or KashTimeoutError depending on whether the signal reason is
          // DOMException(TimeoutError) vs the SDK's own timeout sentinel.
          // Both are acceptable for this assertion.
          return err instanceof KashAbortedError || err instanceof KashTimeoutError;
        }
      );
    } finally {
      await closeServer(localServer);
    }
  });

  // -------------------------------------------------------------------------
  // 7. Webhook signature forwarding — X-Kash-Signature round-trip
  // -------------------------------------------------------------------------
  it('webhook signature — server-generated signature header verifies correctly via SDK', async () => {
    const secret = 'whsec_integration_test_secret';
    const event = {
      id: '00000000-0000-0000-0000-000000000099',
      type: 'trade.completed',
      apiVersion: '2026-05-02',
      createdAt: '2026-05-02T12:00:00.000Z',
      data: {
        tradeId: '00000000-0000-0000-0000-000000000010',
        marketId: '00000000-0000-0000-0000-000000000001',
        outcomeIndex: 0,
        amount: '100',
        side: 'buy',
        metadata: {},
        status: 'completed',
        txHash: '0x' + 'a'.repeat(64),
        tokensOut: '149231587123456789012',
      },
    };
    const body = JSON.stringify(event);
    const ts = Date.now();
    const sigHex = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    const signatureHeader = `t=${ts},v1=${sigHex}`;

    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl,
      maxRetries: 0,
    });

    // verifySignature should pass when we compute the HMAC server-side
    // with a fresh timestamp and verify with the same secret.
    const result = await kash.webhooks.verifySignature(body, signatureHeader, secret, {
      nowMs: ts,
      toleranceMs: 60_000,
    });

    expect(result.valid).toBe(true);
  });
});
