/**
 * `marketConversations`: the five `/v1/market-conversations*` routes through
 * the SDK's own transport (mocked `fetch`): paths, headers, bodies, the replay
 * flag from the header, account forwarding, client-side refusals and the
 * error classes of the route codes. Scenario ids (SDK-nn) are the slice
 * plan's catalogue.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  KashClient,
  KashConflictError,
  KashMaintenanceError,
  KashNotFoundError,
  KashRateLimitError,
  KashValidationError,
} from '../../src/index.js';
import { isMarketContentRefusal } from '../../src/market-conversations.js';
import {
  FIXTURE_MARKET_CONVERSATION,
  FIXTURE_MARKET_CONVERSATION_MESSAGE,
  FIXTURE_MARKET_CONVERSATION_STATE,
  FIXTURE_MARKET_CONVERSATION_TURN,
} from '../contract/wire-shape.test.js';

import { META, WRITE_META } from './_test-utils.js';

const CONVERSATION_ID = FIXTURE_MARKET_CONVERSATION.id;
const ACCOUNT = '3f2b8c1e-5d4a-4f6b-9c8d-7e6f5a4b3c2d';
const BASE = 'https://api.test.local/v1';

type Call = { readonly url: string; readonly init: RequestInit };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function problem(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({ status, code, detail: `${code} detail`, ...extra }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

/** A client whose fetch answers from `responses` in order and records each call. */
function client(
  responses: ReadonlyArray<Response | (() => Response | Promise<Response>)>,
  config: { readonly maxRetries?: number } = {}
): { readonly kash: KashClient; readonly calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (next === undefined) throw new Error('no response scripted');
    return typeof next === 'function' ? next() : next.clone();
  });
  const kash = new KashClient({
    apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    baseUrl: BASE,
    fetch: fetchImpl as unknown as typeof fetch,
    maxRetries: config.maxRetries ?? 0,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
    conditionalRequests: false,
  });
  return { kash, calls };
}

function headersOf(call: Call | undefined): Record<string, string> {
  return (call?.init.headers ?? {}) as Record<string, string>;
}

const started = (headers: Record<string, string> = {}): Response =>
  json(
    {
      conversation: FIXTURE_MARKET_CONVERSATION,
      data: FIXTURE_MARKET_CONVERSATION,
      _meta: WRITE_META,
    },
    201,
    headers
  );

const queued = (headers: Record<string, string> = {}): Response =>
  json(
    {
      message: FIXTURE_MARKET_CONVERSATION_MESSAGE,
      data: FIXTURE_MARKET_CONVERSATION_MESSAGE,
      _meta: WRITE_META,
    },
    202,
    headers
  );

describe('marketConversations.start', () => {
  it('SDK-01: POSTs {} with a generated Idempotency-Key and reports no replay', async () => {
    const { kash, calls } = client([started()]);

    const result = await kash.marketConversations.start();

    expect(result).toEqual({ conversation: FIXTURE_MARKET_CONVERSATION, idempotentReplay: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/market-conversations`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe('{}');
    expect(headersOf(calls[0])['Idempotency-Key']).toMatch(/^[A-Za-z0-9_\-:.]+$/);
    expect(headersOf(calls[0])).not.toHaveProperty('Kash-Account');
  });

  it('SDK-02: a retry after a lost answer reuses the key, and the replay header gives idempotentReplay', async () => {
    const { kash, calls } = client(
      [
        () => {
          throw new TypeError('fetch failed: socket hang up');
        },
        // The body says idempotent: false on a replay; only the header tells.
        started({ 'idempotent-replay': 'true' }),
      ],
      { maxRetries: 2 }
    );

    const result = await kash.marketConversations.start();

    expect(calls).toHaveLength(2);
    expect(headersOf(calls[1])['Idempotency-Key']).toBe(headersOf(calls[0])['Idempotency-Key']);
    expect(result.idempotentReplay).toBe(true);
    expect(result.conversation.id).toBe(FIXTURE_MARKET_CONVERSATION.id);
  });

  it('a caller key is sent unchanged', async () => {
    const { kash, calls } = client([started()]);
    await kash.marketConversations.start({ idempotencyKey: 'start:job-41' });
    expect(headersOf(calls[0])['Idempotency-Key']).toBe('start:job-41');
  });

  it.each([
    ['a character outside the alphabet', 'bad key!', 'IDEMPOTENCY_KEY_FORMAT_INVALID'],
    ['256 characters', 'k'.repeat(256), 'IDEMPOTENCY_KEY_TOO_LONG'],
  ])('SDK-03: a caller key with %s is refused before any request', async (_l, key, code) => {
    const { kash, calls } = client([started()]);
    const err = await kash.marketConversations.start({ idempotencyKey: key }).catch((e) => e);
    expect(err).toBeInstanceOf(KashValidationError);
    expect((err as KashValidationError).code).toBe(code);
    expect(calls).toHaveLength(0);
  });
});

describe('marketConversations.sendMessage', () => {
  it('SDK-04: POSTs the strict body to the conversation path and returns the 202 message', async () => {
    const { kash, calls } = client([queued()]);

    const result = await kash.marketConversations.sendMessage(CONVERSATION_ID, {
      content: 'Snow in Calgary?',
      timezone: 'US/Mountain',
    });

    expect(result).toEqual({
      message: FIXTURE_MARKET_CONVERSATION_MESSAGE,
      idempotentReplay: false,
    });
    expect(calls[0]?.url).toBe(`${BASE}/market-conversations/${CONVERSATION_ID}/messages`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      content: 'Snow in Calgary?',
      timezone: 'US/Mountain',
    });
    expect(headersOf(calls[0])['Idempotency-Key']).toBeTypeOf('string');
  });

  it('the replay header is read even though the body says idempotent: false', async () => {
    const { kash } = client([queued({ 'idempotent-replay': 'true' })]);
    const result = await kash.marketConversations.sendMessage(CONVERSATION_ID, { content: 'hi' });
    expect(result.idempotentReplay).toBe(true);
  });

  it('SDK-05: an upper-case conversation id is sent lower-case, as the API matches it', async () => {
    const { kash, calls } = client([queued()]);
    await kash.marketConversations.sendMessage(CONVERSATION_ID.toUpperCase(), { content: 'hi' });
    expect(calls[0]?.url).toBe(`${BASE}/market-conversations/${CONVERSATION_ID}/messages`);
  });

  it.each([
    ['not a uuid', 'conversation-1'],
    ['a dot-dot segment', '../market-conversations'],
    ['an encoded slash', `a%2F${CONVERSATION_ID}`],
    ['a uuid with whitespace', ` ${CONVERSATION_ID}`],
    ['a uuid with a trailing newline', `${CONVERSATION_ID}\n`],
    ['an empty string', ''],
  ])('SDK-05: a conversation id that is %s is refused before any request', async (_l, id) => {
    const { kash, calls } = client([queued()]);
    for (const call of [
      () => kash.marketConversations.sendMessage(id, { content: 'hi' }),
      () => kash.marketConversations.get(id),
      () => kash.marketConversations.messages(id),
      () =>
        kash.marketConversations.waitForReply(id, {
          message: { ...FIXTURE_MARKET_CONVERSATION_MESSAGE, conversationId: CONVERSATION_ID },
        }),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KashValidationError);
      expect((err as KashValidationError).code).toBe('SDK_VALIDATION');
    }
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['an extra key', { content: 'hi', contnet: 'x' }],
    ['a blank message', { content: '   ' }],
    ['2001 units', { content: 'a'.repeat(2001) }],
    ['a NUL', { content: 'a\u0000' }],
    ['a lone surrogate', { content: '\uD83D' }],
    ['SDK-07: a mis-cased declared action', { content: 'hi', declaredAction: 'Create_Market' }],
  ])('SDK-06: a body with %s is refused before any request', async (_l, body) => {
    const { kash, calls } = client([queued()]);
    const err = await kash.marketConversations
      .sendMessage(CONVERSATION_ID, body as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashValidationError);
    expect((err as KashValidationError).code).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });

  it('SDK-11: a 503 then a 202 is retried with the same key, and answers once', async () => {
    const { kash, calls } = client([problem(503, 'DEPENDENCY_UNAVAILABLE'), queued()], {
      maxRetries: 2,
    });
    const result = await kash.marketConversations.sendMessage(CONVERSATION_ID, { content: 'hi' });
    expect(result.message.id).toBe(FIXTURE_MARKET_CONVERSATION_MESSAGE.id);
    expect(calls).toHaveLength(2);
    expect(headersOf(calls[1])['Idempotency-Key']).toBe(headersOf(calls[0])['Idempotency-Key']);
    expect(calls[1]?.init.body).toBe(calls[0]?.init.body);
  });

  it('SDK-12: 409 IDEMPOTENCY_REQUEST_IN_PROGRESS is retried with the same key', async () => {
    const { kash, calls } = client(
      [problem(409, 'IDEMPOTENCY_REQUEST_IN_PROGRESS', {}, { 'retry-after': '0' }), queued()],
      { maxRetries: 2 }
    );
    await kash.marketConversations.sendMessage(CONVERSATION_ID, { content: 'hi' });
    expect(calls).toHaveLength(2);
    expect(headersOf(calls[1])['Idempotency-Key']).toBe(headersOf(calls[0])['Idempotency-Key']);
  });

  it('SDK-13: IDEMPOTENCY_KEY_CONFLICT is a KashConflictError and is not retried', async () => {
    const { kash, calls } = client([problem(409, 'IDEMPOTENCY_KEY_CONFLICT'), queued()], {
      maxRetries: 2,
    });
    const err = await kash.marketConversations
      .sendMessage(CONVERSATION_ID, { content: 'hi' }, { idempotencyKey: 'msg-1' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashConflictError);
    expect((err as KashConflictError).code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(calls).toHaveLength(1);
  });

  it('SDK-14: MARKET_CONTENT_REFUSED is a KashValidationError the guard narrows, not retried', async () => {
    const { kash, calls } = client(
      [problem(422, 'MARKET_CONTENT_REFUSED', { reason: 'personal_harm' })],
      { maxRetries: 2 }
    );
    const err = await kash.marketConversations
      .sendMessage(CONVERSATION_ID, { content: 'hi' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashValidationError);
    expect(isMarketContentRefusal(err)).toBe(true);
    if (!isMarketContentRefusal(err)) throw new Error('unreachable');
    expect(err.extensions.reason).toBe('personal_harm');
    expect(err.message).toContain('MARKET_CONTENT_REFUSED detail');
    expect(calls).toHaveLength(1);
  });

  it('isMarketContentRefusal is false for other 422s, a refusal without a reason, and non-errors', async () => {
    const { kash } = client([
      problem(422, 'DESTINATION_MISMATCH'),
      problem(422, 'MARKET_CONTENT_REFUSED'),
    ]);
    const other = await kash.marketConversations
      .sendMessage(CONVERSATION_ID, { content: 'hi' })
      .catch((e: unknown) => e);
    const reasonless = await kash.marketConversations
      .sendMessage(CONVERSATION_ID, { content: 'hi' })
      .catch((e: unknown) => e);
    expect([
      isMarketContentRefusal(other),
      isMarketContentRefusal(reasonless),
      isMarketContentRefusal(new Error('MARKET_CONTENT_REFUSED')),
      isMarketContentRefusal({ code: 'MARKET_CONTENT_REFUSED', extensions: { reason: 'x' } }),
    ]).toEqual([false, false, false, false]);
  });

  it('isMarketContentRefusal answers for a refusal thrown by another copy of the SDK', () => {
    // Another bundle's KashValidationError: the SDK's cross-realm brand, but
    // not an instance of this copy's classes, as the root entry's errors are
    // to the `@kashdao/sdk/market-conversations` bundle.
    const brand = Symbol.for('@kashdao/sdk:KashError');
    const foreign = (statusCode: number, reason: unknown) => ({
      [brand]: true,
      name: 'KashValidationError',
      message: 'refused',
      code: 'MARKET_CONTENT_REFUSED',
      statusCode,
      extensions: { reason },
    });
    expect(foreign(422, 'personal_harm')).not.toBeInstanceOf(KashValidationError);
    expect([
      isMarketContentRefusal(foreign(422, 'personal_harm')),
      isMarketContentRefusal(foreign(400, 'personal_harm')),
      isMarketContentRefusal(foreign(422, '')),
    ]).toEqual([true, false, false]);
  });

  it('SDK-16: the daily limit (Retry-After to midnight) is thrown at once with retryAfterSeconds', async () => {
    const { kash, calls } = client(
      [
        problem(429, 'MARKET_CREATION_DAILY_LIMIT_REACHED', {}, { 'retry-after': '36000' }),
        queued(),
      ],
      { maxRetries: 2 }
    );
    const err = await kash.marketConversations
      .sendMessage(CONVERSATION_ID, { content: 'hi' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashRateLimitError);
    expect((err as KashRateLimitError).code).toBe('MARKET_CREATION_DAILY_LIMIT_REACHED');
    expect((err as KashRateLimitError).retryAfterSeconds).toBe(36000);
    expect(calls).toHaveLength(1);
  });

  it('SDK-17: a short per-minute 429 is waited out and retried once with the same key', async () => {
    const { kash, calls } = client(
      [problem(429, 'RATE_LIMIT_EXCEEDED', {}, { 'retry-after': '0' }), queued()],
      { maxRetries: 2 }
    );
    await kash.marketConversations.sendMessage(CONVERSATION_ID, { content: 'hi' });
    expect(calls).toHaveLength(2);
    expect(headersOf(calls[1])['Idempotency-Key']).toBe(headersOf(calls[0])['Idempotency-Key']);
  });

  it('SDK-19: MARKET_CONVERSATION_NOT_WRITABLE is a KashConflictError', async () => {
    const { kash } = client([problem(409, 'MARKET_CONVERSATION_NOT_WRITABLE')]);
    const err = await kash.marketConversations
      .sendMessage(CONVERSATION_ID, { content: 'hi' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashConflictError);
    expect((err as KashConflictError).code).toBe('MARKET_CONVERSATION_NOT_WRITABLE');
  });
});

describe('marketConversations reads', () => {
  it('get: reads the state under the conversation path', async () => {
    const { kash, calls } = client([
      json({
        conversation: FIXTURE_MARKET_CONVERSATION_STATE,
        data: FIXTURE_MARKET_CONVERSATION_STATE,
        _meta: META,
      }),
    ]);
    const state = await kash.marketConversations.get(CONVERSATION_ID);
    expect(state).toEqual(FIXTURE_MARKET_CONVERSATION_STATE);
    expect(calls[0]?.url).toBe(`${BASE}/market-conversations/${CONVERSATION_ID}`);
    expect(calls[0]?.init.method).toBe('GET');
  });

  it('a 404 MARKET_CONVERSATION_NOT_FOUND is a KashNotFoundError', async () => {
    const { kash } = client([problem(404, 'MARKET_CONVERSATION_NOT_FOUND')]);
    const err = await kash.marketConversations.get(CONVERSATION_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashNotFoundError);
    expect((err as KashNotFoundError).code).toBe('MARKET_CONVERSATION_NOT_FOUND');
  });

  it('SDK-22: list walks pages by cursor with the limit, and stops on a null cursor', async () => {
    const second = { ...FIXTURE_MARKET_CONVERSATION, id: '7d3f4e5a-6b7c-4d8e-8f9a-0b1c2d3e4f5a' };
    const { kash, calls } = client([
      json({
        data: [FIXTURE_MARKET_CONVERSATION],
        pagination: { cursor: 'c-1', hasMore: true, limit: 1 },
        _meta: META,
      }),
      json({ data: [second], pagination: { cursor: null, hasMore: false, limit: 1 }, _meta: META }),
    ]);
    const ids: string[] = [];
    for await (const c of await kash.marketConversations.list({ limit: 1 })) ids.push(c.id);
    expect(ids).toEqual([FIXTURE_MARKET_CONVERSATION.id, second.id]);
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/market-conversations?limit=1`,
      `${BASE}/market-conversations?cursor=c-1&limit=1`,
    ]);
  });

  it.each([0, 101, 1.5])(
    'SDK-22: list and messages refuse limit %s before any request',
    async (limit) => {
      const { kash, calls } = client([json({})]);
      for (const call of [
        () => kash.marketConversations.list({ limit }),
        () => kash.marketConversations.messages(CONVERSATION_ID, { limit }),
      ]) {
        const err = await call().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(KashValidationError);
      }
      expect(calls).toHaveLength(0);
    }
  );

  it('messages: sends after and the default limit of 50, and returns the transcript page', async () => {
    const { kash, calls } = client([
      json({
        data: [FIXTURE_MARKET_CONVERSATION_TURN],
        pagination: { after: 'p-2', hasMore: false, limit: 50 },
        _meta: META,
      }),
    ]);
    const page = await kash.marketConversations.messages(CONVERSATION_ID, { after: 'p-1' });
    expect(page.data).toEqual([FIXTURE_MARKET_CONVERSATION_TURN]);
    expect([page.after, page.hasMore]).toEqual(['p-2', false]);
    expect(calls[0]?.url).toBe(
      `${BASE}/market-conversations/${CONVERSATION_ID}/messages?after=p-1&limit=50`
    );
  });

  it('SDK-33: a response missing a required field is a KashValidationError naming the path', async () => {
    const { conversation: _omitted, ...broken } = {
      conversation: FIXTURE_MARKET_CONVERSATION_STATE,
      _meta: META,
    };
    const { kash } = client([json(broken)]);
    const err = await kash.marketConversations.get(CONVERSATION_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashValidationError);
    expect((err as KashValidationError).message).toContain('conversation');
  });
});

describe('marketConversations: account and the switch', () => {
  const calls = (kash: KashClient) => [
    () => kash.marketConversations.start({ account: ACCOUNT }),
    () =>
      kash.marketConversations.sendMessage(
        CONVERSATION_ID,
        { content: 'hi' },
        { account: ACCOUNT }
      ),
    () => kash.marketConversations.list({}, { account: ACCOUNT }),
    () => kash.marketConversations.get(CONVERSATION_ID, { account: ACCOUNT }),
    () => kash.marketConversations.messages(CONVERSATION_ID, {}, { account: ACCOUNT }),
  ];

  it('SDK-09: every method sends account as Kash-Account', async () => {
    const { kash, calls: seen } = client([
      problem(503, 'ROUTE_DISABLED', { flag: 'api-market-creation' }),
    ]);
    for (const call of calls(kash)) await call().catch(() => undefined);
    expect(seen).toHaveLength(5);
    expect(seen.map((c) => headersOf(c)['Kash-Account'])).toEqual(Array(5).fill(ACCOUNT));
  });

  it('SDK-09: an account that reaches a method in a variable is still forwarded, never overriding the path', async () => {
    const { kash, calls: seen } = client([queued()]);
    const opts = { account: ACCOUNT, path: '/other', method: 'DELETE' } as const;
    await kash.marketConversations.sendMessage(CONVERSATION_ID, { content: 'hi' }, opts as never);
    expect(seen[0]?.url).toBe(`${BASE}/market-conversations/${CONVERSATION_ID}/messages`);
    expect(seen[0]?.init.method).toBe('POST');
    expect(headersOf(seen[0])['Kash-Account']).toBe(ACCOUNT);
  });

  it('SDK-09: a non-UUID account is refused before any request; Kash-Account in headers is dropped', async () => {
    const { kash, calls: seen } = client([started()]);
    const err = await kash.marketConversations
      .start({ account: 'acct-1' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashValidationError);
    expect(seen).toHaveLength(0);
    await kash.marketConversations.start({ headers: { 'Kash-Account': ACCOUNT } });
    expect(headersOf(seen[0])).not.toHaveProperty('Kash-Account');
  });

  it('SDK-20: with the switch off every method throws KashMaintenanceError ROUTE_DISABLED naming the flag', async () => {
    const { kash } = client([problem(503, 'ROUTE_DISABLED', { flag: 'api-market-creation' })]);
    for (const call of calls(kash)) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KashMaintenanceError);
      expect((err as KashMaintenanceError).code).toBe('ROUTE_DISABLED');
      expect((err as KashMaintenanceError).extensions?.['flag']).toBe('api-market-creation');
    }
  });
});
