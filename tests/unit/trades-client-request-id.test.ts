/**
 * `trades.create` sends a `clientRequestId` the SDK generates when the caller
 * gives none: one per call, the same on every retry of that call.
 *
 * The fake server below dedupes the way the API does
 * (`apps/public-api/src/routes/trades/create.ts`): a unique
 * `(user_id, client_request_id)` in the database, where `user_id` is the
 * account the trade acts for. A repeat with the same id and body answers 200
 * with the existing trade and `_meta.idempotent: true`; a repeat whose insert
 * loses the unique race answers 409 `CLIENT_REQUEST_ID_CONFLICT`. Unlike the
 * `Idempotency-Key` claim, this check has no time limit, so it is what stops a
 * second trade once the claim has lapsed, failed open or been released by a
 * non-2xx.
 */

import { describe, expect, it, vi } from 'vitest';

import { KashConflictError, KashError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';
import { ClientRequestIdSchema } from '../../src/schemas/trade.js';

const MARKET_ID = '00000000-0000-0000-0000-000000000001';
const ACCOUNT = '3f2b8c1e-5d4a-4f6b-9c8d-7e6f5a4b3c2d';
const BODY = { marketId: MARKET_ID, outcomeIndex: 0, amount: '100', side: 'buy' } as const;

type Sent = {
  readonly clientRequestId: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly account: string | undefined;
};

/** One trade row as the API's replay path shapes it (`shapeExistingTrade`). */
function tradeRow(n: number, clientRequestId: string | null): Record<string, unknown> {
  return {
    id: `00000000-0000-0000-0000-0000000000${String(10 + n)}`,
    marketId: MARKET_ID,
    outcomeIndex: 0,
    amount: '100',
    side: 'buy',
    status: 'pending',
    correlationId: '00000000-0000-0000-0000-000000000099',
    clientRequestId,
    txHash: null,
    tokensOut: null,
    errorCode: null,
    errorMessage: null,
    webhookDelivery: null,
    metadata: {},
    createdAt: '2026-11-11T12:00:00.000Z',
    updatedAt: '2026-11-11T12:00:00.000Z',
  };
}

function json(status: number, body: unknown): Response {
  const type = status >= 400 ? 'application/problem+json' : 'application/json';
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
}

function trade(status: number, row: Record<string, unknown>, idempotent: boolean): Response {
  return json(status, {
    trade: row,
    data: row,
    _meta: { requestId: 'req_1', timestamp: '2026-11-11T12:00:00.000Z', idempotent },
  });
}

function problem(status: number, code: string): Response {
  return json(status, { status, code, detail: `${code} (test)` });
}

/**
 * A server that records trades and dedupes on (account, clientRequestId).
 * `script` decides, per attempt, what happens after the database step:
 * `'ok'` answers normally, `'reset'` records the trade and then drops the
 * connection, `'stranded'` records it and answers the 503 the API sends when
 * the event pipeline is down, `'race'` answers the losing insert's 409,
 * `'down'` answers 503 before reaching the database.
 */
function fakeServer(script: readonly ('ok' | 'reset' | 'stranded' | 'race' | 'down')[]) {
  const rows = new Map<string, Record<string, unknown>>();
  const sent: Sent[] = [];
  let attempt = 0;
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init?.body)) as { clientRequestId?: string };
    const account = headers['Kash-Account'];
    sent.push({
      clientRequestId: body.clientRequestId,
      idempotencyKey: headers['Idempotency-Key'],
      account,
    });
    const step = script[attempt] ?? 'ok';
    attempt += 1;
    if (step === 'race') return problem(409, 'CLIENT_REQUEST_ID_CONFLICT');
    if (step === 'down') return problem(503, 'DEPENDENCY_UNAVAILABLE');
    const scope = `${account ?? 'self'}|${body.clientRequestId ?? `none-${String(attempt)}`}`;
    const existing = body.clientRequestId === undefined ? undefined : rows.get(scope);
    if (existing) return trade(200, existing, true);
    const row = tradeRow(rows.size, body.clientRequestId ?? null);
    rows.set(scope, row);
    if (step === 'reset') throw new TypeError('fetch failed');
    if (step === 'stranded') return problem(503, 'DEPENDENCY_UNAVAILABLE');
    return trade(201, row, false);
  });
  return { fetchImpl, rows, sent };
}

function client(fetchImpl: typeof fetch, maxRetries = 2): KashClient {
  return new KashClient({
    apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    baseUrl: 'https://api.test.local/v1',
    fetch: fetchImpl,
    maxRetries,
  });
}

describe('trades.create clientRequestId', () => {
  it('sends a generated id the API accepts when the caller gives none', async () => {
    const server = fakeServer(['ok']);
    const result = await client(server.fetchImpl as typeof fetch).trades.create({ ...BODY });
    const id = server.sent[0]?.clientRequestId;
    expect(ClientRequestIdSchema.safeParse(id).success).toBe(true);
    expect(result.clientRequestId).toBe(id);
  });

  it("never replaces the caller's own id", async () => {
    const server = fakeServer(['ok']);
    await client(server.fetchImpl as typeof fetch).trades.create({
      ...BODY,
      clientRequestId: 'order-2026-11-11-001',
    });
    expect(server.sent[0]?.clientRequestId).toBe('order-2026-11-11-001');
  });

  it('gives two calls two ids, so two identical trades stay two trades', async () => {
    const server = fakeServer(['ok', 'ok']);
    const kash = client(server.fetchImpl as typeof fetch);
    await kash.trades.create({ ...BODY });
    await kash.trades.create({ ...BODY });
    expect(new Set(server.sent.map((s) => s.clientRequestId)).size).toBe(2);
    expect(server.rows.size).toBe(2);
  });

  it('a reset after the trade was recorded, then a retry past the claim: one trade, returned as a replay', async () => {
    // The retry reaches the handler as it would once the key's claim lapsed
    // or failed open; only the clientRequestId stands between it and a
    // second trade.
    const server = fakeServer(['reset', 'ok']);
    const result = await client(server.fetchImpl as typeof fetch).trades.create({ ...BODY });
    expect(server.sent).toHaveLength(2);
    expect(server.sent[1]?.clientRequestId).toBe(server.sent[0]?.clientRequestId);
    expect(server.sent[1]?.idempotencyKey).toBe(server.sent[0]?.idempotencyKey);
    expect(server.rows.size).toBe(1);
    expect(result.idempotent).toBe(true);
    expect(result.id).toBe(tradeRow(0, null)['id']);
  });

  it('a 503 after the trade was recorded is retried into the replay, not a second trade', async () => {
    // The API releases the key's claim on any non-2xx, so the retry runs the
    // handler again; with the same clientRequestId it re-emits the stranded
    // trade instead of recording another.
    const server = fakeServer(['stranded', 'ok']);
    const result = await client(server.fetchImpl as typeof fetch).trades.create({ ...BODY });
    expect(server.rows.size).toBe(1);
    expect(result.idempotent).toBe(true);
  });

  it('dedupes per account: the same call for an account repeats under that account', async () => {
    const server = fakeServer(['reset', 'ok']);
    const result = await client(server.fetchImpl as typeof fetch).trades.create(
      { ...BODY },
      { account: ACCOUNT }
    );
    expect(server.sent.map((s) => s.account)).toEqual([ACCOUNT, ACCOUNT]);
    expect(server.rows.size).toBe(1);
    expect(result.idempotent).toBe(true);
  });

  it('a lost insert race on a generated id is sent once more and returns the recorded trade', async () => {
    // The first attempt recorded the trade; a concurrent attempt of the same
    // call lost the unique race. The body cannot differ, so the SDK repeats
    // the identical request and receives the replay.
    const server = fakeServer(['reset', 'race', 'ok']);
    const result = await client(server.fetchImpl as typeof fetch).trades.create({ ...BODY });
    expect(server.sent).toHaveLength(3);
    expect(new Set(server.sent.map((s) => s.clientRequestId)).size).toBe(1);
    expect(new Set(server.sent.map((s) => s.idempotencyKey)).size).toBe(1);
    expect(server.rows.size).toBe(1);
    expect(result.idempotent).toBe(true);
  });

  it('the race re-send happens once: a second conflict surfaces', async () => {
    const server = fakeServer(['race', 'race']);
    const err = await client(server.fetchImpl as typeof fetch)
      .trades.create({ ...BODY })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashConflictError);
    expect((err as KashConflictError).code).toBe('CLIENT_REQUEST_ID_CONFLICT');
    expect(server.sent).toHaveLength(2);
  });

  it('every error carries the id the call sent, so the call can be repeated', async () => {
    // The first attempt records the trade and loses its response; the API
    // is then unavailable for the retries, so the call fails.
    const server = fakeServer(['reset', 'down', 'down']);
    const err = await client(server.fetchImpl as typeof fetch)
      .trades.create({ ...BODY })
      .catch((e: unknown) => e);
    expect(KashError.isKashError(err)).toBe(true);
    const sentId = server.sent[0]?.clientRequestId;
    expect(sentId).toBeTypeOf('string');
    expect((err as KashError).clientRequestId).toBe(sentId);
    expect((err as KashError).toJSON()['clientRequestId']).toBe(sentId);
    // Repeating with that id returns the recorded trade, not a second one.
    const again = await client(server.fetchImpl as typeof fetch).trades.create({
      ...BODY,
      clientRequestId: (err as KashError).clientRequestId,
    });
    expect(again.idempotent).toBe(true);
    expect(server.rows.size).toBe(1);
  });

  it("an error carries the caller's own id too, and other methods carry none", async () => {
    const server = fakeServer(['race']);
    const kash = client(server.fetchImpl as typeof fetch);
    const err = await kash.trades
      .create({ ...BODY, clientRequestId: 'order-2026-11-11-003' })
      .catch((e: unknown) => e);
    expect((err as KashError).clientRequestId).toBe('order-2026-11-11-003');
    const other = await client((async () =>
      problem(404, 'TRADE_NOT_FOUND')) as unknown as typeof fetch)
      .trades.get('00000000-0000-0000-0000-000000000042')
      .catch((e: unknown) => e);
    expect(KashError.isKashError(other)).toBe(true);
    expect((other as KashError).clientRequestId).toBeUndefined();
  });

  it("a conflict on the caller's own id is theirs to resolve: surfaced, not re-sent", async () => {
    const server = fakeServer(['race']);
    const err = await client(server.fetchImpl as typeof fetch)
      .trades.create({ ...BODY, clientRequestId: 'order-2026-11-11-002' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashConflictError);
    expect(server.sent).toHaveLength(1);
  });

  it('with no randomness source: no id, no key, one attempt', async () => {
    const realCrypto = globalThis.crypto;
    Reflect.deleteProperty(globalThis, 'crypto');
    try {
      const server = fakeServer(['reset']);
      await expect(
        client(server.fetchImpl as typeof fetch, 3).trades.create({ ...BODY })
      ).rejects.toThrow();
      expect(server.sent).toEqual([
        { clientRequestId: undefined, idempotencyKey: undefined, account: undefined },
      ]);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: realCrypto,
        configurable: true,
        writable: true,
      });
    }
  });
});
