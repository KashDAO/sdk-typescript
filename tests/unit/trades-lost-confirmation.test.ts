/**
 * `trades.create` recovers the confirmation token of a high-value trade whose
 * first answer (the 202 carrying the token) was lost.
 *
 * The API never stores the token for an `Idempotency-Key` replay
 * (`replayOmits: ['confirmation']` on POST /v1/trades), so the SDK's retry
 * under the same key gets the stored 202 without `confirmation`. A repeat
 * with the same `clientRequestId` under a FRESH key reaches the route, which
 * re-issues the token to the key that placed the trade
 * (`replaceConfirmationTokenHash`). The fake server below does all three.
 */

import { describe, expect, it, vi } from 'vitest';

import { KashClient } from '../../src/index.js';

const MARKET_ID = '00000000-0000-0000-0000-000000000001';
const BODY = { marketId: MARKET_ID, outcomeIndex: 0, amount: '5000', side: 'buy' } as const;
const TOKEN_1 = 'a'.repeat(43);
const TOKEN_2 = 'b'.repeat(43);
const EXPIRES = '2026-11-11T12:01:00.000Z';

const ROW = {
  id: '00000000-0000-0000-0000-000000000010',
  marketId: MARKET_ID,
  outcomeIndex: 0,
  amount: '5000',
  side: 'buy',
  status: 'pending_confirmation',
  correlationId: '00000000-0000-0000-0000-000000000099',
  clientRequestId: 'set-below',
  txHash: null,
  tokensOut: null,
  errorCode: null,
  errorMessage: null,
  webhookDelivery: null,
  metadata: {},
  createdAt: '2026-11-11T12:00:00.000Z',
  updatedAt: '2026-11-11T12:00:00.000Z',
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * The first attempt records the held trade and drops the connection; the
 * same key then replays the stored 202 without its token; a new key with the
 * same id reaches the route, which answers 200 and, when `reissues`, a new
 * token.
 */
function server(opts: { readonly firstAnswerArrives: boolean; readonly reissues: boolean }) {
  const sent: Array<{ key: string | undefined; clientRequestId: string | undefined }> = [];
  const keysSeen = new Set<string>();
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init?.body)) as { clientRequestId?: string };
    const key = headers['Idempotency-Key'];
    sent.push({ key, clientRequestId: body.clientRequestId });
    const row = { ...ROW, clientRequestId: body.clientRequestId ?? null };
    const meta = (idempotent: boolean) => ({
      requestId: 'req',
      timestamp: '2026-11-11T12:00:00.000Z',
      idempotent,
    });
    if (sent.length === 1) {
      if (key !== undefined) keysSeen.add(key);
      if (!opts.firstAnswerArrives) throw new TypeError('fetch failed');
      return json(202, {
        trade: row,
        data: row,
        confirmation: { token: TOKEN_1, expiresAt: EXPIRES },
        _meta: meta(false),
      });
    }
    if (key !== undefined && keysSeen.has(key)) {
      // The Idempotency-Key replay: the stored 202, its confirmation omitted.
      return json(
        202,
        { trade: row, data: row, _meta: meta(false) },
        { 'Idempotent-Replay': 'true' }
      );
    }
    return json(200, {
      trade: row,
      data: row,
      ...(opts.reissues ? { confirmation: { token: TOKEN_2, expiresAt: EXPIRES } } : {}),
      _meta: meta(true),
    });
  });
  return { fetchImpl, sent };
}

function client(fetchImpl: typeof fetch): KashClient {
  return new KashClient({
    apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    baseUrl: 'https://api.test.local/v1',
    fetch: fetchImpl,
    maxRetries: 2,
  });
}

describe('trades.create: a high-value trade whose 202 was lost', () => {
  it('recovers a fresh token with one more call: same clientRequestId, new key', async () => {
    const s = server({ firstAnswerArrives: false, reissues: true });

    const result = await client(s.fetchImpl as typeof fetch).trades.create({ ...BODY });

    expect(result.status).toBe('pending_confirmation');
    expect(result.confirmation).toEqual({ token: TOKEN_2, expiresAt: EXPIRES });
    expect(result.idempotent).toBe(true);
    expect(s.sent).toHaveLength(3);
    const [first, retry, recovery] = s.sent;
    expect(retry?.key).toBe(first?.key);
    expect(recovery?.key).not.toBe(first?.key);
    expect(recovery?.clientRequestId).toBe(first?.clientRequestId);
    expect(first?.clientRequestId).toBeDefined();
  });

  it('asks only once: no token on the repeat (window passed, other key) is the answer', async () => {
    const s = server({ firstAnswerArrives: false, reissues: false });

    const result = await client(s.fetchImpl as typeof fetch).trades.create({ ...BODY });

    expect(result.confirmation).toBeUndefined();
    expect(s.sent).toHaveLength(3);
  });

  it('never asks again when the first answer carried the token', async () => {
    const s = server({ firstAnswerArrives: true, reissues: true });

    const result = await client(s.fetchImpl as typeof fetch).trades.create({ ...BODY });

    expect(result.confirmation).toEqual({ token: TOKEN_1, expiresAt: EXPIRES });
    expect(s.sent).toHaveLength(1);
  });

  it('a trade that did not hit the gate (201, pending) sends exactly one request', async () => {
    const sent: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { clientRequestId?: string };
      sent.push(body);
      const row = { ...ROW, status: 'pending', clientRequestId: body.clientRequestId ?? null };
      return json(201, {
        trade: row,
        data: row,
        _meta: { requestId: 'req', timestamp: '2026-11-11T12:00:00.000Z', idempotent: false },
      });
    });

    const result = await client(fetchImpl as typeof fetch).trades.create({ ...BODY });

    expect(result.status).toBe('pending');
    expect(result.confirmation).toBeUndefined();
    expect(sent).toHaveLength(1);
  });
});
