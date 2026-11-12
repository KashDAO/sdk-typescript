/**
 * `kash.partnerAccounts.withdrawals`: quote, create (with its REQUIRED
 * idempotency key and its two outcomes), get and list, plus the refusals a
 * partner branches on, `WITHDRAWALS_HELD`'s `retryAfterSeconds` among them.
 */

import { describe, expect, it, vi } from 'vitest';

import { KASH_ERROR_CODE } from '../../src/error-codes.js';
import { KashConflictError, KashServerError, KashValidationError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';
import {
  FIXTURE_PARTNER_ACCOUNT,
  FIXTURE_PARTNER_WITHDRAWAL,
  FIXTURE_PARTNER_WITHDRAWAL_COMPLETED,
  FIXTURE_PARTNER_WITHDRAWAL_QUOTE,
} from '../contract/wire-shape.test.js';

import { META } from './_test-utils.js';

const ACCOUNT_ID = FIXTURE_PARTNER_ACCOUNT.accountId;
const WITHDRAWAL_ID = FIXTURE_PARTNER_WITHDRAWAL.withdrawalId;
const BASE = `/v1/partner/accounts/${ACCOUNT_ID}/withdrawals`;

type Call = { url: URL; init: RequestInit; headers: Headers; body: unknown };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function problem(status: number, code: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ status, code, detail: `${code} detail` }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

function createBody(withdrawal: unknown, idempotent: boolean): unknown {
  return { withdrawal, data: withdrawal, _meta: { ...META, idempotent } };
}

function setup(...responses: Response[]): { kash: KashClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      init: init ?? {},
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error('no response queued');
    return next;
  });
  const kash = new KashClient({
    apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    baseUrl: 'https://api.test.local/v1',
    fetch: fetchImpl as typeof fetch,
    maxRetries: 2,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 2,
  });
  return { kash, calls };
}

describe('partnerAccounts.withdrawals.quote', () => {
  it('GETs .../withdrawals/quote?amountAtomic= and unwraps the quote', async () => {
    const { kash, calls } = setup(
      jsonResponse({
        quote: FIXTURE_PARTNER_WITHDRAWAL_QUOTE,
        data: FIXTURE_PARTNER_WITHDRAWAL_QUOTE,
        _meta: META,
      })
    );

    const quote = await kash.partnerAccounts.withdrawals.quote(ACCOUNT_ID, {
      amountAtomic: '2500000',
    });

    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.url.pathname).toBe(`${BASE}/quote`);
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ amountAtomic: '2500000' });
    expect(calls[0]!.headers.has('kash-account')).toBe(false);
    expect(quote).toEqual(FIXTURE_PARTNER_WITHDRAWAL_QUOTE);
  });

  it.each([['0'], ['2.5'], ['-1'], ['01']])(
    'refuses amountAtomic %j client-side, before any request',
    async (amountAtomic) => {
      const { kash, calls } = setup();

      await expect(
        kash.partnerAccounts.withdrawals.quote(ACCOUNT_ID, { amountAtomic })
      ).rejects.toThrow(/partnerAccounts\.withdrawals\.quote: amountAtomic/);
      expect(calls).toHaveLength(0);
    }
  );

  it('refuses a number, so an amount can never lose precision on the way', async () => {
    const { kash, calls } = setup();

    await expect(
      kash.partnerAccounts.withdrawals.quote(ACCOUNT_ID, {
        amountAtomic: 2_500_000 as unknown as string,
      })
    ).rejects.toBeInstanceOf(KashValidationError);
    expect(calls).toHaveLength(0);
  });
});

describe('partnerAccounts.withdrawals.create', () => {
  it('POSTs the amount with the caller key and reports a new withdrawal as created', async () => {
    const { kash, calls } = setup(jsonResponse(createBody(FIXTURE_PARTNER_WITHDRAWAL, false), 202));

    const withdrawal = await kash.partnerAccounts.withdrawals.create(
      ACCOUNT_ID,
      { amountAtomic: '2500000' },
      { idempotencyKey: 'withdraw-7f3a' }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.url.pathname).toBe(BASE);
    expect(calls[0]!.body).toEqual({ amountAtomic: '2500000' });
    expect(calls[0]!.headers.get('idempotency-key')).toBe('withdraw-7f3a');
    expect(calls[0]!.headers.has('kash-account')).toBe(false);
    expect(withdrawal).toEqual({
      withdrawal: FIXTURE_PARTNER_WITHDRAWAL,
      outcome: 'created',
      idempotentReplay: false,
    });
  });

  it('reports the withdrawal an earlier request with this key made (200, _meta.idempotent) as existing, not a replay', async () => {
    const { kash } = setup(
      jsonResponse(createBody(FIXTURE_PARTNER_WITHDRAWAL_COMPLETED, true), 200)
    );

    const withdrawal = await kash.partnerAccounts.withdrawals.create(
      ACCOUNT_ID,
      { amountAtomic: '2500000' },
      { idempotencyKey: 'withdraw-7f3a' }
    );

    expect(withdrawal.outcome).toBe('existing');
    expect(withdrawal.idempotentReplay).toBe(false);
    expect(withdrawal.withdrawal.status).toBe('completed');
  });

  it('reports an Idempotent-Replay of the stored first answer', async () => {
    const { kash } = setup(
      jsonResponse(createBody(FIXTURE_PARTNER_WITHDRAWAL, false), 202, {
        'idempotent-replay': 'true',
      })
    );

    const withdrawal = await kash.partnerAccounts.withdrawals.create(
      ACCOUNT_ID,
      { amountAtomic: '2500000' },
      { idempotencyKey: 'withdraw-7f3a' }
    );

    expect(withdrawal).toEqual({
      withdrawal: FIXTURE_PARTNER_WITHDRAWAL,
      outcome: 'created',
      idempotentReplay: true,
    });
  });

  it('retries a 503 with the SAME key, so a retry cannot withdraw twice', async () => {
    const { kash, calls } = setup(
      problem(503, 'DEPENDENCY_UNAVAILABLE'),
      jsonResponse(createBody(FIXTURE_PARTNER_WITHDRAWAL, false), 202)
    );

    await kash.partnerAccounts.withdrawals.create(
      ACCOUNT_ID,
      { amountAtomic: '2500000' },
      { idempotencyKey: 'withdraw-7f3a' }
    );

    expect(calls.map((c) => c.headers.get('idempotency-key'))).toEqual([
      'withdraw-7f3a',
      'withdraw-7f3a',
    ]);
  });

  it.each([
    ['no options', undefined],
    ['no key', {}],
    ['an empty key', { idempotencyKey: '' }],
  ])('refuses %s before any request: the key is required', async (_label, opts) => {
    const { kash, calls } = setup();

    const err = await kash.partnerAccounts.withdrawals
      .create(ACCOUNT_ID, { amountAtomic: '2500000' }, opts as never)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KashValidationError);
    expect((err as KashValidationError).message).toMatch(/idempotencyKey is required/);
    expect((err as KashValidationError).issues).toEqual([
      { path: 'idempotencyKey', message: 'required' },
    ]);
    expect(calls).toHaveLength(0);
  });

  it('refuses a malformed key with the SDK idempotency-key check', async () => {
    const { kash, calls } = setup();

    await expect(
      kash.partnerAccounts.withdrawals.create(
        ACCOUNT_ID,
        { amountAtomic: '2500000' },
        { idempotencyKey: 'has space' }
      )
    ).rejects.toThrow(/idempotencyKey contains/);
    expect(calls).toHaveLength(0);
  });

  it('WITHDRAWALS_HELD: a KashConflictError with the hold left in retryAfterSeconds, not retried', async () => {
    const { kash, calls } = setup(
      problem(409, KASH_ERROR_CODE.WITHDRAWALS_HELD, { 'retry-after': '86340' })
    );

    const err = await kash.partnerAccounts.withdrawals
      .create(ACCOUNT_ID, { amountAtomic: '2500000' }, { idempotencyKey: 'withdraw-7f3a' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KashConflictError);
    expect((err as KashConflictError).code).toBe('WITHDRAWALS_HELD');
    expect((err as KashConflictError).retryAfterSeconds).toBe(86_340);
    expect(calls).toHaveLength(1);
  });

  it.each([
    [KASH_ERROR_CODE.ACCOUNT_NOT_ACTIVE, 409, KashConflictError],
    [KASH_ERROR_CODE.INSUFFICIENT_BALANCE, 409, KashConflictError],
    [KASH_ERROR_CODE.IDEMPOTENCY_KEY_CONFLICT, 409, KashConflictError],
    [KASH_ERROR_CODE.WITHDRAWAL_BELOW_MINIMUM, 400, KashValidationError],
    [KASH_ERROR_CODE.DESTINATION_NOT_SUPPORTED, 422, KashValidationError],
  ] as const)('%s (%i) reaches the caller as %o', async (code, status, errorClass) => {
    const { kash, calls } = setup(problem(status, code));

    const err = await kash.partnerAccounts.withdrawals
      .create(ACCOUNT_ID, { amountAtomic: '2500000' }, { idempotencyKey: 'withdraw-7f3a' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(errorClass);
    expect((err as KashConflictError).code).toBe(code);
    expect(calls).toHaveLength(1);
  });

  it('DEPENDENCY_UNAVAILABLE that outlasts the retries reaches the caller as KashServerError', async () => {
    const { kash, calls } = setup(
      problem(503, 'DEPENDENCY_UNAVAILABLE', { 'retry-after': '0' }),
      problem(503, 'DEPENDENCY_UNAVAILABLE', { 'retry-after': '0' }),
      problem(503, 'DEPENDENCY_UNAVAILABLE', { 'retry-after': '0' })
    );

    const err = await kash.partnerAccounts.withdrawals
      .create(ACCOUNT_ID, { amountAtomic: '2500000' }, { idempotencyKey: 'withdraw-7f3a' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KashServerError);
    expect((err as KashServerError).code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(calls).toHaveLength(3);
  });
});

describe('partnerAccounts.withdrawals.get / list', () => {
  it('get: GETs .../withdrawals/{withdrawalId} and unwraps the withdrawal', async () => {
    const { kash, calls } = setup(
      jsonResponse({
        withdrawal: FIXTURE_PARTNER_WITHDRAWAL_COMPLETED,
        data: FIXTURE_PARTNER_WITHDRAWAL_COMPLETED,
        _meta: META,
      })
    );

    const withdrawal = await kash.partnerAccounts.withdrawals.get(ACCOUNT_ID, WITHDRAWAL_ID);

    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.url.pathname).toBe(`${BASE}/${WITHDRAWAL_ID}`);
    expect(withdrawal).toEqual(FIXTURE_PARTNER_WITHDRAWAL_COMPLETED);
  });

  it('get: refuses a malformed withdrawalId before any request', async () => {
    const { kash, calls } = setup();

    await expect(kash.partnerAccounts.withdrawals.get(ACCOUNT_ID, 'w-1')).rejects.toThrow(
      /withdrawalId must be a UUID/
    );
    expect(calls).toHaveLength(0);
  });

  it('list: pages with cursor and limit and iterates', async () => {
    const { kash, calls } = setup(
      jsonResponse({
        data: [FIXTURE_PARTNER_WITHDRAWAL_COMPLETED],
        pagination: { cursor: 'cur-2', hasMore: true, limit: 1 },
        _meta: META,
      }),
      jsonResponse({
        data: [FIXTURE_PARTNER_WITHDRAWAL],
        pagination: { cursor: null, hasMore: false, limit: 1 },
        _meta: META,
      })
    );

    const page = await kash.partnerAccounts.withdrawals.list(ACCOUNT_ID, { limit: 1 });
    const statuses = [];
    for await (const w of page) statuses.push(w.status);

    expect(calls[0]!.url.pathname).toBe(BASE);
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ limit: '1' });
    expect(Object.fromEntries(calls[1]!.url.searchParams)).toEqual({
      cursor: 'cur-2',
      limit: '1',
    });
    expect(statuses).toEqual(['completed', 'pending']);
  });

  it('every method refuses a malformed accountId before any request', async () => {
    const { kash, calls } = setup();

    for (const call of [
      () => kash.partnerAccounts.withdrawals.quote('x', { amountAtomic: '1' }),
      () =>
        kash.partnerAccounts.withdrawals.create(
          'x',
          { amountAtomic: '1' },
          { idempotencyKey: 'k' }
        ),
      () => kash.partnerAccounts.withdrawals.get('x', WITHDRAWAL_ID),
      () => kash.partnerAccounts.withdrawals.list('x'),
    ]) {
      await expect(call()).rejects.toThrow(/accountId must be a UUID/);
    }
    expect(calls).toHaveLength(0);
  });
});
