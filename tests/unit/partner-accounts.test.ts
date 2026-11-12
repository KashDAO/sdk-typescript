/**
 * `kash.partnerAccounts`: the request each method sends (method, path, query,
 * headers, body) and what it makes of the response, including the two
 * outcomes of `create` and the client-side refusals that keep a bad id from
 * reaching the API.
 */

import { describe, expect, it, vi } from 'vitest';

import { KashConflictError, KashNotFoundError, KashValidationError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';
import {
  FIXTURE_CREATE_PARTNER_ACCOUNT_BODY,
  FIXTURE_PARTNER_ACCOUNT,
  FIXTURE_PARTNER_ACCOUNT_PROVISIONING,
} from '../contract/wire-shape.test.js';

import { META } from './_test-utils.js';

const ACCOUNT_ID = FIXTURE_PARTNER_ACCOUNT.accountId;

type Call = { url: URL; init: RequestInit; headers: Headers; body: unknown };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function writeBody(account: unknown, idempotent: boolean): unknown {
  return { account, data: account, _meta: { ...META, idempotent } };
}

/** A client whose fetch answers with `responses` in turn and records every call. */
function setup(...responses: Response[]): { kash: KashClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: new URL(String(input)),
      init: init ?? {},
      headers,
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
    maxRetries: 0,
  });
  return { kash, calls };
}

describe('partnerAccounts.create', () => {
  it('POSTs the body to /v1/partner/accounts and reports a new account as created', async () => {
    const { kash, calls } = setup(
      jsonResponse(writeBody(FIXTURE_PARTNER_ACCOUNT_PROVISIONING, false), 202)
    );

    const account = await kash.partnerAccounts.create(FIXTURE_CREATE_PARTNER_ACCOUNT_BODY, {
      idempotencyKey: 'onboard-user-8841',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.url.pathname).toBe('/v1/partner/accounts');
    expect(calls[0]!.body).toEqual(FIXTURE_CREATE_PARTNER_ACCOUNT_BODY);
    expect(calls[0]!.headers.get('idempotency-key')).toBe('onboard-user-8841');
    expect(calls[0]!.headers.get('content-type')).toBe('application/json');
    expect(calls[0]!.headers.has('kash-account')).toBe(false);
    expect(account).toEqual({
      account: FIXTURE_PARTNER_ACCOUNT_PROVISIONING,
      outcome: 'created',
      idempotentReplay: false,
    });
  });

  it('reports the account already held for the externalId as existing', async () => {
    const { kash } = setup(jsonResponse(writeBody(FIXTURE_PARTNER_ACCOUNT, true), 200));

    const account = await kash.partnerAccounts.create(FIXTURE_CREATE_PARTNER_ACCOUNT_BODY);

    expect(account.outcome).toBe('existing');
    expect(account.idempotentReplay).toBe(false);
    expect(account.account.status).toBe('active');
  });

  it('reports an Idempotent-Replay of the first answer: created, and a replay', async () => {
    const { kash } = setup(
      jsonResponse(writeBody(FIXTURE_PARTNER_ACCOUNT_PROVISIONING, false), 202, {
        'idempotent-replay': 'true',
      })
    );

    const account = await kash.partnerAccounts.create(FIXTURE_CREATE_PARTNER_ACCOUNT_BODY, {
      idempotencyKey: 'onboard-user-8841',
    });

    expect(account.outcome).toBe('created');
    expect(account.idempotentReplay).toBe(true);
  });

  it('keys the request itself when the caller passes no idempotencyKey', async () => {
    const { kash, calls } = setup(
      jsonResponse(writeBody(FIXTURE_PARTNER_ACCOUNT_PROVISIONING, false), 202)
    );

    await kash.partnerAccounts.create(FIXTURE_CREATE_PARTNER_ACCOUNT_BODY);

    expect(calls[0]!.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ['a lower-case country', { country: 'gb' }, 'country'],
    ['an externalId with surrounding whitespace', { externalId: ' user-8841' }, 'externalId'],
    ['an unknown key', { emial: 'x@example.com' }, '(root)'],
    [
      'a consent time without a zone',
      { consent: { acceptedAt: '2026-11-07 09:57', termsVersion: 'v1' } },
      'consent.acceptedAt',
    ],
  ])('refuses %s client-side, before any request', async (_label, patch, path) => {
    const { kash, calls } = setup();

    const err = await kash.partnerAccounts
      .create({ ...FIXTURE_CREATE_PARTNER_ACCOUNT_BODY, ...patch } as never)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KashValidationError);
    expect((err as KashValidationError).code).toBe('VALIDATION_FAILED');
    expect((err as KashValidationError).message).toContain(`partnerAccounts.create: ${path}`);
    expect(calls).toHaveLength(0);
  });

  it('sends a destination network the SDK does not know, for the API to judge', async () => {
    const { kash, calls } = setup(
      jsonResponse(
        {
          type: 'about:blank',
          status: 422,
          code: 'DESTINATION_NOT_SUPPORTED',
          detail: "destination.network 'base' is not supported. Supported: solana, arc.",
        },
        422
      )
    );

    const err = await kash.partnerAccounts
      .create({
        ...FIXTURE_CREATE_PARTNER_ACCOUNT_BODY,
        destination: { network: 'base', address: '0x' + 'c'.repeat(40) },
      })
      .catch((e: unknown) => e);

    expect((calls[0]!.body as { destination: { network: string } }).destination.network).toBe(
      'base'
    );
    expect(err).toBeInstanceOf(KashValidationError);
    expect((err as KashValidationError).code).toBe('DESTINATION_NOT_SUPPORTED');
    expect((err as KashValidationError).statusCode).toBe(422);
  });
});

describe('partnerAccounts.get', () => {
  it('GETs /v1/partner/accounts/{accountId} and unwraps the account', async () => {
    const { kash, calls } = setup(
      jsonResponse({ account: FIXTURE_PARTNER_ACCOUNT, data: FIXTURE_PARTNER_ACCOUNT, _meta: META })
    );

    const account = await kash.partnerAccounts.get(ACCOUNT_ID);

    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.url.pathname).toBe(`/v1/partner/accounts/${ACCOUNT_ID}`);
    expect(calls[0]!.headers.has('kash-account')).toBe(false);
    expect(account).toEqual(FIXTURE_PARTNER_ACCOUNT);
  });

  it('maps ACCOUNT_NOT_FOUND to KashNotFoundError', async () => {
    const { kash } = setup(
      jsonResponse({ status: 404, code: 'ACCOUNT_NOT_FOUND', detail: 'No such account.' }, 404)
    );

    const err = await kash.partnerAccounts.get(ACCOUNT_ID).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KashNotFoundError);
    expect((err as KashNotFoundError).code).toBe('ACCOUNT_NOT_FOUND');
  });

  it.each(['', 'user-8841', `${ACCOUNT_ID}/release`])(
    'refuses accountId %j client-side, before any request',
    async (bad) => {
      const { kash, calls } = setup();

      await expect(kash.partnerAccounts.get(bad)).rejects.toThrow(/accountId must be a UUID/);
      expect(calls).toHaveLength(0);
    }
  );
});

describe('partnerAccounts.findByExternalId', () => {
  it('GETs ?externalId= and returns the one account', async () => {
    const { kash, calls } = setup(
      jsonResponse({
        data: [FIXTURE_PARTNER_ACCOUNT],
        pagination: { cursor: null, hasMore: false, limit: 20 },
        _meta: META,
      })
    );

    const account = await kash.partnerAccounts.findByExternalId('user 8841/a&b');

    expect(calls[0]!.url.pathname).toBe('/v1/partner/accounts');
    expect(calls[0]!.url.searchParams.get('externalId')).toBe('user 8841/a&b');
    expect([...calls[0]!.url.searchParams.keys()]).toEqual(['externalId']);
    expect(account).toEqual(FIXTURE_PARTNER_ACCOUNT);
  });

  it('returns null on the empty page the API answers when there is no account', async () => {
    const { kash } = setup(
      jsonResponse({
        data: [],
        pagination: { cursor: null, hasMore: false, limit: 20 },
        _meta: META,
      })
    );

    await expect(kash.partnerAccounts.findByExternalId('user-0000')).resolves.toBeNull();
  });

  it('refuses an empty externalId rather than listing every account', async () => {
    const { kash, calls } = setup();

    await expect(kash.partnerAccounts.findByExternalId('')).rejects.toBeInstanceOf(
      KashValidationError
    );
    await expect(
      kash.partnerAccounts.findByExternalId(undefined as unknown as string)
    ).rejects.toBeInstanceOf(KashValidationError);
    expect(calls).toHaveLength(0);
  });

  it('refuses to pick one when the API returns two accounts for one externalId', async () => {
    const other = { ...FIXTURE_PARTNER_ACCOUNT, accountId: '00000000-0000-0000-0000-000000000079' };
    const { kash } = setup(
      jsonResponse({
        data: [FIXTURE_PARTNER_ACCOUNT, other],
        pagination: { cursor: null, hasMore: false, limit: 20 },
        _meta: META,
      })
    );

    const err = await kash.partnerAccounts.findByExternalId('user-8841').catch((e: unknown) => e);
    expect((err as KashValidationError).message).toMatch(/2 accounts for one externalId/);
    // A server contract breach, told apart from the caller's own bad input.
    expect((err as KashValidationError).code).toBe('SDK_RESPONSE_INVALID');
  });
});

describe('partnerAccounts.list', () => {
  it('pages with cursor and limit, and iterates across pages', async () => {
    const second = {
      ...FIXTURE_PARTNER_ACCOUNT,
      accountId: '00000000-0000-0000-0000-000000000079',
    };
    const { kash, calls } = setup(
      jsonResponse({
        data: [FIXTURE_PARTNER_ACCOUNT],
        pagination: { cursor: 'cur-2', hasMore: true, limit: 1 },
        _meta: META,
      }),
      jsonResponse({
        data: [second],
        pagination: { cursor: null, hasMore: false, limit: 1 },
        _meta: META,
      })
    );

    const page = await kash.partnerAccounts.list({ limit: 1, cursor: 'cur-1' });
    const all = [];
    for await (const account of page) all.push(account.accountId);

    expect(calls[0]!.url.pathname).toBe('/v1/partner/accounts');
    expect(calls[0]!.url.searchParams.get('cursor')).toBe('cur-1');
    expect(calls[0]!.url.searchParams.get('limit')).toBe('1');
    expect(calls[1]!.url.searchParams.get('cursor')).toBe('cur-2');
    expect(all).toEqual([ACCOUNT_ID, second.accountId]);
  });

  it('sends the default limit of 20 and no cursor on the first page', async () => {
    const { kash, calls } = setup(
      jsonResponse({
        data: [],
        pagination: { cursor: null, hasMore: false, limit: 20 },
        _meta: META,
      })
    );

    await kash.partnerAccounts.list();

    expect(calls[0]!.url.searchParams.get('limit')).toBe('20');
    expect(calls[0]!.url.searchParams.has('cursor')).toBe(false);
  });
});

describe('partnerAccounts.update', () => {
  it('PATCHes the destination and returns the account', async () => {
    const moved = {
      ...FIXTURE_PARTNER_ACCOUNT,
      destination: {
        network: 'solana' as const,
        address: '8yYpcE7Jx9NmXNMGR6NGumBUu4UBpMTVQW44P9hwikyh',
      },
    };
    const { kash, calls } = setup(jsonResponse(writeBody(moved, false)));

    const account = await kash.partnerAccounts.update(
      ACCOUNT_ID,
      { destination: moved.destination },
      { idempotencyKey: 'move-1' }
    );

    expect(calls[0]!.init.method).toBe('PATCH');
    expect(calls[0]!.url.pathname).toBe(`/v1/partner/accounts/${ACCOUNT_ID}`);
    expect(calls[0]!.body).toEqual({ destination: moved.destination });
    expect(calls[0]!.headers.get('idempotency-key')).toBe('move-1');
    expect(account).toEqual(moved);
  });

  it('sends a country-only change', async () => {
    const { kash, calls } = setup(jsonResponse(writeBody(FIXTURE_PARTNER_ACCOUNT, false)));

    await kash.partnerAccounts.update(ACCOUNT_ID, { country: 'FR' });

    expect(calls[0]!.body).toEqual({ country: 'FR' });
  });

  it('refuses an empty change client-side', async () => {
    const { kash, calls } = setup();

    await expect(kash.partnerAccounts.update(ACCOUNT_ID, {})).rejects.toThrow(
      /send destination, country or both/
    );
    expect(calls).toHaveLength(0);
  });
});

describe('partnerAccounts.suspend / reactivate / release', () => {
  it.each([
    ['suspend', 'suspended'],
    ['reactivate', 'active'],
    ['release', 'released'],
  ] as const)(
    '%s POSTs an empty JSON object to its path and returns the account',
    async (method, status) => {
      const answered = { ...FIXTURE_PARTNER_ACCOUNT, status };
      const { kash, calls } = setup(jsonResponse(writeBody(answered, false)));

      const account = await kash.partnerAccounts[method](ACCOUNT_ID, {
        idempotencyKey: `${method}-1`,
      });

      expect(calls[0]!.init.method).toBe('POST');
      expect(calls[0]!.url.pathname).toBe(`/v1/partner/accounts/${ACCOUNT_ID}/${method}`);
      // The API refuses a POST with no body and no content type (415, before
      // routing; measured on staging 2026-11-12), so these send `{}` as the
      // redeliver and rotate-secret calls do.
      expect(calls[0]!.init.body).toBe('{}');
      expect(calls[0]!.headers.get('content-type')).toBe('application/json');
      expect(calls[0]!.headers.get('idempotency-key')).toBe(`${method}-1`);
      expect(calls[0]!.headers.has('kash-account')).toBe(false);
      expect(account).toEqual(answered);
    }
  );

  it('maps RELEASE_REQUIRES_EMPTY_ACCOUNT to KashConflictError with the detail', async () => {
    const detail = 'This account still holds USDC. Withdraw it, then release.';
    const { kash } = setup(
      jsonResponse({ status: 409, code: 'RELEASE_REQUIRES_EMPTY_ACCOUNT', detail }, 409)
    );

    const err = await kash.partnerAccounts.release(ACCOUNT_ID).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KashConflictError);
    expect((err as KashConflictError).code).toBe('RELEASE_REQUIRES_EMPTY_ACCOUNT');
    expect((err as KashConflictError).message).toBe(detail);
  });

  it('maps ACCOUNT_NOT_ACTIVE on suspend to KashConflictError', async () => {
    const { kash } = setup(
      jsonResponse(
        { status: 409, code: 'ACCOUNT_NOT_ACTIVE', detail: 'This account is provisioning.' },
        409
      )
    );

    const err = await kash.partnerAccounts.suspend(ACCOUNT_ID).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KashConflictError);
    expect((err as KashConflictError).code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('refuses a malformed accountId on every write, before any request', async () => {
    const { kash, calls } = setup();

    for (const call of [
      () => kash.partnerAccounts.suspend('nope'),
      () => kash.partnerAccounts.reactivate('nope'),
      () => kash.partnerAccounts.release('nope'),
      () => kash.partnerAccounts.update('nope', { country: 'FR' }),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(KashValidationError);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('partner list limits', () => {
  it.each([0, 101, 1.5, Number.NaN])('refuses limit %s before any request', async (limit) => {
    const { kash, calls } = setup();

    await expect(kash.partnerAccounts.list({ limit })).rejects.toThrow(/limit must be/);
    await expect(kash.partnerAccounts.withdrawals.list(ACCOUNT_ID, { limit })).rejects.toThrow(
      /limit must be/
    );
    expect(calls).toHaveLength(0);
  });
});
