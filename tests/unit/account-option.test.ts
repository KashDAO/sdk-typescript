/**
 * The `account` option: on every method of a route that accepts
 * `Kash-Account`, the header is sent exactly when `account` is given, with
 * that value; it is validated client-side; and it cannot be smuggled onto
 * other routes through `headers`. `kash.balance.get` is covered here too, as
 * the route a partner reads first.
 *
 * The type-level half (no `account` on markets, quotes, webhooks, account
 * usage or the partner routes) is `tests/types/account-option.test-d.ts`.
 */

import { describe, expect, it, vi } from 'vitest';

import { KashServerError, KashValidationError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';
import { DEFAULT_REDEMPTION } from '../../src/testing/fixtures.js';
import {
  FIXTURE_BALANCE,
  FIXTURE_MARKET,
  FIXTURE_PARTNER_ACCOUNT,
  FIXTURE_POSITION,
  FIXTURE_TRACE,
  FIXTURE_TRADE,
} from '../contract/wire-shape.test.js';

import { META } from './_test-utils.js';

const ACCOUNT = FIXTURE_PARTNER_ACCOUNT.accountId;
const OTHER_ACCOUNT = '00000000-0000-0000-0000-000000000079';
const PAGE = { cursor: null, hasMore: false, limit: 20 };

type Call = { url: URL; method: string; headers: Headers };

/** A valid body for each route this file calls, chosen by method and path. */
function bodyFor(method: string, path: string): unknown {
  if (path === '/v1/balance') return { balance: FIXTURE_BALANCE, _meta: META };
  if (path === '/v1/portfolio') {
    const portfolio = {
      smartAccountAddress: '8yYpcE7Jx9NmXNMGR6NGumBUu4UBpMTVQW44P9hwikyh',
      activePositions: 1,
      totalCostBasisAtomic: '1000000',
    };
    return { portfolio, _meta: META };
  }
  if (path === '/v1/portfolio/positions') return { data: [FIXTURE_POSITION], _meta: META };
  if (path === '/v1/redemptions') {
    return { redemption: DEFAULT_REDEMPTION, _meta: { ...META, idempotent: false } };
  }
  if (path.startsWith('/v1/traces/')) return { trace: FIXTURE_TRACE, _meta: META };
  if (path === '/v1/trades' && method === 'POST') {
    return { trade: FIXTURE_TRADE, _meta: { ...META, idempotent: false } };
  }
  if (path === '/v1/trades') return { data: [FIXTURE_TRADE], pagination: PAGE, _meta: META };
  if (path.startsWith('/v1/trades/')) return { trade: FIXTURE_TRADE, _meta: META };
  if (path === '/v1/markets') return { data: [FIXTURE_MARKET], pagination: PAGE, _meta: META };
  throw new Error(`no body for ${method} ${path}`);
}

function setup(config: Record<string, unknown> = {}): { kash: KashClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push({ url, method, headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(bodyFor(method, url.pathname)), {
      status: method === 'POST' ? 201 : 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const kash = new KashClient({
    apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    baseUrl: 'https://api.test.local/v1',
    fetch: fetchImpl as typeof fetch,
    maxRetries: 0,
    ...config,
  });
  return { kash, calls };
}

const TRADE_BODY = {
  marketId: FIXTURE_MARKET.id,
  outcomeIndex: 0,
  amount: '10',
  side: 'buy' as const,
};

/**
 * Every account-scoped method, called with `opts` (which may carry
 * `account`). Each entry names the route it must reach.
 */
const ACCOUNT_SCOPED: ReadonlyArray<
  readonly [
    label: string,
    method: string,
    path: string,
    call: (kash: KashClient, opts: { account?: string }) => Promise<unknown>,
  ]
> = [
  ['balance.get', 'GET', '/v1/balance', (k, o) => k.balance.get(o)],
  ['trades.create', 'POST', '/v1/trades', (k, o) => k.trades.create(TRADE_BODY, o)],
  [
    'trades.confirm',
    'POST',
    `/v1/trades/${FIXTURE_TRADE.id}/confirm`,
    (k, o) => k.trades.confirm(FIXTURE_TRADE.id, { token: 'a'.repeat(48) }, o),
  ],
  [
    'trades.get',
    'GET',
    `/v1/trades/${FIXTURE_TRADE.id}`,
    (k, o) => k.trades.get(FIXTURE_TRADE.id, o),
  ],
  ['trades.list', 'GET', '/v1/trades', (k, o) => k.trades.list({}, o)],
  [
    'trades.waitForCompletion',
    'GET',
    `/v1/trades/${FIXTURE_TRADE.id}`,
    (k, o) => k.trades.waitForCompletion(FIXTURE_TRADE.id, o),
  ],
  ['portfolio.get', 'GET', '/v1/portfolio', (k, o) => k.portfolio.get(o)],
  ['portfolio.positions', 'GET', '/v1/portfolio/positions', (k, o) => k.portfolio.positions({}, o)],
  [
    'portfolio.watchPositions',
    'GET',
    '/v1/portfolio/positions',
    async (k, o) => {
      const watch = k.portfolio.watchPositions({}, o);
      const first = await watch.next();
      await watch.return(undefined as never);
      return first;
    },
  ],
  [
    'redemptions.create',
    'POST',
    '/v1/redemptions',
    (k, o) => k.redemptions.create({ marketId: FIXTURE_MARKET.id, outcomeIndex: 0 }, o),
  ],
  [
    'traces.get',
    'GET',
    `/v1/traces/${FIXTURE_TRACE.correlationId}`,
    (k, o) => k.traces.get(FIXTURE_TRACE.correlationId, o),
  ],
];

describe('account option: sent as Kash-Account on every account-scoped method', () => {
  it.each(ACCOUNT_SCOPED)('%s sends Kash-Account: <account>', async (_l, method, path, call) => {
    const { kash, calls } = setup();

    await call(kash, { account: ACCOUNT });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.method).toBe(method);
    expect(calls[0]!.url.pathname).toBe(path);
    for (const c of calls) expect(c.headers.get('kash-account')).toBe(ACCOUNT);
  });

  it.each(ACCOUNT_SCOPED)('%s sends no Kash-Account without account', async (_l, _m, _p, call) => {
    const { kash, calls } = setup();

    await call(kash, {});

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.headers.has('kash-account')).toBe(false);
  });

  it.each(ACCOUNT_SCOPED)(
    '%s refuses an account that is not a UUID, before any request',
    async (_l, _m, _p, call) => {
      const { kash, calls } = setup();

      const err = await call(kash, { account: 'user-8841' }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(KashValidationError);
      expect((err as KashValidationError).code).toBe('SDK_VALIDATION');
      expect((err as KashValidationError).message).toMatch(/^account must be a UUID/);
      expect(calls).toHaveLength(0);
    }
  );

  it('trades.list sends the account on every page it walks', async () => {
    const pages = [
      { data: [FIXTURE_TRADE], pagination: { cursor: 'c2', hasMore: true, limit: 1 }, _meta: META },
      {
        data: [FIXTURE_TRADE],
        pagination: { cursor: null, hasMore: false, limit: 1 },
        _meta: META,
      },
    ];
    const seen: Array<string | null> = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      maxRetries: 0,
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get('kash-account'));
        return new Response(JSON.stringify(pages.shift()), {
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    });

    let count = 0;
    for await (const _t of await kash.trades.list({ limit: 1 }, { account: ACCOUNT })) count += 1;

    expect(count).toBe(2);
    expect(seen).toEqual([ACCOUNT, ACCOUNT]);
  });
});

describe('options bags cannot override the request a method builds', () => {
  // An options object that reaches a method in a variable can carry any key.
  // The method forwards only transport fields (and `account` where allowed),
  // never `path`, `method`, `body`, `query` or `schema`.
  const hostile = {
    account: ACCOUNT,
    path: '/partner/accounts',
    method: 'DELETE',
    body: { amountAtomic: '999' },
    query: { injected: '1' },
    schema: { safeParse: () => ({ success: true, data: 'forged' }) },
  } as unknown as { account: string };

  it.each(ACCOUNT_SCOPED)(
    '%s keeps its own path, method, query and schema',
    async (_l, method, path, call) => {
      const { kash, calls } = setup();

      const result = await call(kash, hostile);

      expect(calls[0]!.method).toBe(method);
      expect(calls[0]!.url.pathname).toBe(path);
      expect(calls[0]!.url.searchParams.has('injected')).toBe(false);
      expect(calls[0]!.headers.get('kash-account')).toBe(ACCOUNT);
      expect(result).not.toBe('forged');
    }
  );

  it('a transport-only method keeps its own path and method too', async () => {
    const { kash, calls } = setup();

    await kash.markets.list({}, hostile);

    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url.pathname).toBe('/v1/markets');
    expect(calls[0]!.url.searchParams.has('injected')).toBe(false);
    expect(calls[0]!.headers.has('kash-account')).toBe(false);
  });
});

describe('account option: cannot reach routes that refuse it', () => {
  it('a Kash-Account in client-level headers is dropped, so markets never sends it', async () => {
    const { kash, calls } = setup({ headers: { 'Kash-Account': ACCOUNT, 'X-Tenant': 'acme' } });

    await kash.markets.list();

    expect(calls[0]!.headers.has('kash-account')).toBe(false);
    expect(calls[0]!.headers.get('x-tenant')).toBe('acme');
  });

  it('a Kash-Account in per-call headers is dropped, in any casing', async () => {
    const { kash, calls } = setup();

    await kash.markets.list({}, { headers: { 'kash-account': ACCOUNT } });
    await kash.balance.get({ headers: { 'KASH-ACCOUNT': OTHER_ACCOUNT } });

    expect(calls[0]!.headers.has('kash-account')).toBe(false);
    expect(calls[1]!.headers.has('kash-account')).toBe(false);
  });

  it('the typed option wins over a header of the same name', async () => {
    const { kash, calls } = setup();

    await kash.balance.get({ account: ACCOUNT, headers: { 'Kash-Account': OTHER_ACCOUNT } });

    expect(calls[0]!.headers.get('kash-account')).toBe(ACCOUNT);
  });
});

describe('account option: an account in a variable never reaches routes that refuse it', () => {
  // The types refuse `account` on these methods only in an object literal; a
  // wider object passed through a variable compiles. The method must drop it.
  const withAccount: { account: string } = { account: ACCOUNT };

  it.each([
    ['markets.list', (k: KashClient) => k.markets.list({}, withAccount)],
    ['markets.get', (k: KashClient) => k.markets.get(FIXTURE_MARKET.id, withAccount)],
    ['partnerAccounts.get', (k: KashClient) => k.partnerAccounts.get(ACCOUNT, withAccount)],
    [
      'partnerAccounts.withdrawals.create',
      (k: KashClient) =>
        k.partnerAccounts.withdrawals.create(
          ACCOUNT,
          { amountAtomic: '1' },
          { ...withAccount, idempotencyKey: 'k-1' }
        ),
    ],
  ] as const)('%s sends no Kash-Account', async (_label, call) => {
    const sent: Array<string | null> = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      maxRetries: 0,
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        sent.push(new Headers(init?.headers).get('kash-account'));
        return new Response('{}', { status: 400, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    });

    await call(kash).catch(() => undefined);

    expect(sent).toEqual([null]);
  });
});

describe('account option: the conditional-GET cache is per account', () => {
  it('a GET for one account never revalidates with the ETag stored for another', async () => {
    const sent: Array<{ account: string | null; ifNoneMatch: string | null }> = [];
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      maxRetries: 0,
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        const account = headers.get('kash-account');
        sent.push({ account, ifNoneMatch: headers.get('if-none-match') });
        return new Response(JSON.stringify({ data: [FIXTURE_POSITION], _meta: META }), {
          headers: { 'content-type': 'application/json', etag: `"etag-${account}"` },
        });
      }) as typeof fetch,
    });

    await kash.portfolio.positions({}, { account: ACCOUNT });
    await kash.portfolio.positions({}, { account: OTHER_ACCOUNT });
    await kash.portfolio.positions({}, { account: ACCOUNT });
    await kash.portfolio.positions({}, { account: OTHER_ACCOUNT.toUpperCase() });

    expect(sent).toEqual([
      { account: ACCOUNT, ifNoneMatch: null },
      { account: OTHER_ACCOUNT, ifNoneMatch: null },
      { account: ACCOUNT, ifNoneMatch: `"etag-${ACCOUNT}"` },
      { account: OTHER_ACCOUNT.toUpperCase(), ifNoneMatch: `"etag-${OTHER_ACCOUNT}"` },
    ]);
  });
});

describe('balance.get', () => {
  it('GETs /v1/balance and unwraps the balance, amounts as strings', async () => {
    const { kash, calls } = setup();

    const balance = await kash.balance.get();

    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url.pathname).toBe('/v1/balance');
    expect([...calls[0]!.url.searchParams.keys()]).toEqual([]);
    expect(balance).toEqual(FIXTURE_BALANCE);
    expect(typeof balance.availableAtomic).toBe('string');
  });

  it('a balance the API cannot read is an error, never a zero', async () => {
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      maxRetries: 0,
      fetch: (async () =>
        new Response(
          JSON.stringify({ status: 503, code: 'DEPENDENCY_UNAVAILABLE', detail: 'Retry shortly.' }),
          { status: 503, headers: { 'content-type': 'application/problem+json' } }
        )) as typeof fetch,
    });

    await expect(kash.balance.get({ account: ACCOUNT })).rejects.toBeInstanceOf(KashServerError);
  });

  it('refuses an amount that is not an integer string', async () => {
    const kash = new KashClient({
      apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      baseUrl: 'https://api.test.local/v1',
      maxRetries: 0,
      fetch: (async () =>
        new Response(
          JSON.stringify({ balance: { ...FIXTURE_BALANCE, availableAtomic: 22.5 }, _meta: META }),
          { headers: { 'content-type': 'application/json' } }
        )) as typeof fetch,
    });

    await expect(kash.balance.get()).rejects.toThrow(/availableAtomic/);
  });
});
