/**
 * `@kashdao/sdk/testing`: the mock client's `balance` and `partnerAccounts`
 * surface. Defaults are wire-shape-valid, every method the real client has
 * exists on the mock, overrides receive the call's arguments, and the
 * client-side checks match the real client's.
 */

import { describe, expect, it } from 'vitest';

import { KashValidationError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';
import { BalanceResourceSchema } from '../../src/schemas/balance.js';
import { PartnerAccountResourceSchema } from '../../src/schemas/partner-account.js';
import {
  PartnerWithdrawalQuoteSchema,
  PartnerWithdrawalResourceSchema,
} from '../../src/schemas/partner-withdrawal.js';
import {
  createMockKashClient,
  DEFAULT_BALANCE,
  DEFAULT_PARTNER_ACCOUNT,
  DEFAULT_PARTNER_WITHDRAWAL,
  DEFAULT_PARTNER_WITHDRAWAL_QUOTE,
} from '../../src/testing/index.js';
import { FIXTURE_CREATE_PARTNER_ACCOUNT_BODY } from '../contract/wire-shape.test.js';

const ACCOUNT_ID = DEFAULT_PARTNER_ACCOUNT.accountId;

/** Own method names of a sub-client instance, constructor excluded. */
function methodsOf(instance: object): string[] {
  return Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
    .filter((name) => name !== 'constructor')
    .filter((name) => typeof (instance as Record<string, unknown>)[name] === 'function')
    .filter((name) => !name.startsWith('write'))
    .sort();
}

describe('testing fixtures: partner defaults are wire-shape-valid', () => {
  it.each([
    ['DEFAULT_PARTNER_ACCOUNT', PartnerAccountResourceSchema, DEFAULT_PARTNER_ACCOUNT],
    ['DEFAULT_PARTNER_WITHDRAWAL', PartnerWithdrawalResourceSchema, DEFAULT_PARTNER_WITHDRAWAL],
    [
      'DEFAULT_PARTNER_WITHDRAWAL_QUOTE',
      PartnerWithdrawalQuoteSchema,
      DEFAULT_PARTNER_WITHDRAWAL_QUOTE,
    ],
    ['DEFAULT_BALANCE', BalanceResourceSchema, DEFAULT_BALANCE],
  ] as const)('%s parses', (_name, schema, fixture) => {
    expect(schema.safeParse(fixture).success).toBe(true);
  });
});

describe('createMockKashClient: partner surface parity', () => {
  const real = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
  const mock = createMockKashClient();

  it.each([
    ['balance', real.balance, mock.balance],
    ['partnerAccounts', real.partnerAccounts, mock.partnerAccounts],
    [
      'partnerAccounts.withdrawals',
      real.partnerAccounts.withdrawals,
      mock.partnerAccounts.withdrawals,
    ],
  ] as const)('the mock has every public method of %s', (_name, realClient, mockClient) => {
    const names = methodsOf(realClient);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(typeof (mockClient as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('calibration: the real partnerAccounts methods are read', () => {
    expect(methodsOf(real.partnerAccounts)).toEqual([
      'create',
      'findByExternalId',
      'get',
      'list',
      'reactivate',
      'release',
      'suspend',
      'update',
      'waitUntilActive',
    ]);
  });
});

describe('createMockKashClient: partner defaults', () => {
  const kash = createMockKashClient();

  it('balance.get returns the default balance', async () => {
    await expect(kash.balance.get({ account: ACCOUNT_ID })).resolves.toEqual(DEFAULT_BALANCE);
  });

  it('create returns a provisioning account built from the body, outcome created', async () => {
    const result = await kash.partnerAccounts.create(FIXTURE_CREATE_PARTNER_ACCOUNT_BODY);

    expect(PartnerAccountResourceSchema.safeParse(result.account).success).toBe(true);
    expect(result).toMatchObject({
      account: {
        externalId: FIXTURE_CREATE_PARTNER_ACCOUNT_BODY.externalId,
        destination: FIXTURE_CREATE_PARTNER_ACCOUNT_BODY.destination,
        status: 'provisioning',
        depositAddress: null,
      },
      outcome: 'created',
      idempotentReplay: false,
    });
  });

  it('suspend, reactivate and release answer the status each moves to', async () => {
    expect((await kash.partnerAccounts.suspend(ACCOUNT_ID)).status).toBe('suspended');
    expect((await kash.partnerAccounts.reactivate(ACCOUNT_ID)).status).toBe('active');
    expect((await kash.partnerAccounts.release(ACCOUNT_ID)).status).toBe('released');
  });

  it('withdrawals.create echoes the account and amount, not a replay', async () => {
    const result = await kash.partnerAccounts.withdrawals.create(
      ACCOUNT_ID,
      { amountAtomic: '1000000' },
      { idempotencyKey: 'w-1' }
    );

    expect(PartnerWithdrawalResourceSchema.safeParse(result.withdrawal).success).toBe(true);
    expect(result).toMatchObject({
      withdrawal: { accountId: ACCOUNT_ID, amountAtomic: '1000000' },
      outcome: 'created',
      idempotentReplay: false,
    });
  });

  it('list methods return an iterable Page', async () => {
    const ids: string[] = [];
    for await (const w of await kash.partnerAccounts.withdrawals.list(ACCOUNT_ID)) {
      ids.push(w.withdrawalId);
    }
    expect(ids).toEqual([DEFAULT_PARTNER_WITHDRAWAL.withdrawalId]);
  });
});

describe('createMockKashClient: partner overrides and checks', () => {
  it('balance.get hands the account to the override, so tests can answer per account', async () => {
    const kash = createMockKashClient({
      balance: {
        get: (opts) => ({ ...DEFAULT_BALANCE, availableAtomic: opts?.account ? '1' : '0' }),
      },
    });

    expect((await kash.balance.get({ account: ACCOUNT_ID })).availableAtomic).toBe('1');
    expect((await kash.balance.get()).availableAtomic).toBe('0');
  });

  it('findByExternalId override may answer null', async () => {
    const kash = createMockKashClient({ partnerAccounts: { findByExternalId: () => null } });

    await expect(kash.partnerAccounts.findByExternalId('user-0000')).resolves.toBeNull();
  });

  it('withdrawals.create override receives the key', async () => {
    const seen: string[] = [];
    const kash = createMockKashClient({
      partnerAccounts: {
        withdrawals: {
          create: (accountId, body, opts) => {
            seen.push(`${accountId}:${body.amountAtomic}:${opts.idempotencyKey}`);
            return {
              withdrawal: DEFAULT_PARTNER_WITHDRAWAL,
              outcome: 'existing',
              idempotentReplay: false,
            };
          },
        },
      },
    });

    const w = await kash.partnerAccounts.withdrawals.create(
      ACCOUNT_ID,
      { amountAtomic: '5' },
      { idempotencyKey: 'k-9' }
    );

    expect(seen).toEqual([`${ACCOUNT_ID}:5:k-9`]);
    expect(w.outcome).toBe('existing');
  });

  it('applies the real client checks: key required, UUID ids, strict bodies', async () => {
    const kash = createMockKashClient();

    await expect(
      kash.partnerAccounts.withdrawals.create(ACCOUNT_ID, { amountAtomic: '5' }, {} as never)
    ).rejects.toThrow(/idempotencyKey is required/);
    await expect(kash.partnerAccounts.get('user-8841')).rejects.toThrow(/accountId must be a UUID/);
    await expect(kash.balance.get({ account: 'nope' })).rejects.toThrow(/account must be a UUID/);
    await expect(
      kash.partnerAccounts.create({ ...FIXTURE_CREATE_PARTNER_ACCOUNT_BODY, country: 'gb' })
    ).rejects.toBeInstanceOf(KashValidationError);
    await expect(kash.partnerAccounts.findByExternalId('')).rejects.toBeInstanceOf(
      KashValidationError
    );
  });
});

describe('createMockKashClient: the real client checks, on every account-scoped method', () => {
  const kash = createMockKashClient();
  const bad = { account: 'user-8841' };

  it.each([
    ['trades.get', () => kash.trades.get('t', bad)],
    ['trades.list', () => kash.trades.list({}, bad)],
    ['trades.confirm', () => kash.trades.confirm('t', { token: 'x'.repeat(48) }, bad)],
    ['trades.waitForCompletion', () => kash.trades.waitForCompletion('t', bad)],
    ['portfolio.get', () => kash.portfolio.get(bad)],
    ['portfolio.positions', () => kash.portfolio.positions({}, bad)],
    ['traces.get', () => kash.traces.get('c', bad)],
    ['balance.get', () => kash.balance.get(bad)],
  ] as const)('%s refuses an account that is not a UUID', async (_label, call) => {
    await expect(call()).rejects.toThrow(/account must be a UUID/);
  });

  it('refuses a malformed idempotency key as the real client does', async () => {
    await expect(
      kash.partnerAccounts.withdrawals.create(
        ACCOUNT_ID,
        { amountAtomic: '5' },
        { idempotencyKey: 'my key' }
      )
    ).rejects.toThrow(/idempotencyKey contains/);
    await expect(
      kash.partnerAccounts.create(FIXTURE_CREATE_PARTNER_ACCOUNT_BODY, { idempotencyKey: 'a/b' })
    ).rejects.toThrow(/idempotencyKey contains/);
  });

  it('hands the options, account included, to the override', async () => {
    const seen: Array<string | undefined> = [];
    const mock = createMockKashClient({
      portfolio: {
        get: (opts) => {
          seen.push(opts?.account);
          return { smartAccountAddress: 'x', activePositions: 0, totalCostBasisAtomic: '0' };
        },
      },
      traces: {
        get: (correlationId, opts) => {
          seen.push(opts?.account);
          return { correlationId, events: [] };
        },
      },
    });

    await mock.portfolio.get({ account: ACCOUNT_ID });
    await mock.traces.get('33333333-3333-4333-8333-333333333333', { account: ACCOUNT_ID });

    expect(seen).toEqual([ACCOUNT_ID, ACCOUNT_ID]);
  });

  it('waitUntilActive and withdrawals.waitForCompletion resolve at once with final defaults', async () => {
    await expect(kash.partnerAccounts.waitUntilActive(ACCOUNT_ID)).resolves.toMatchObject({
      status: 'active',
    });
    await expect(
      kash.partnerAccounts.withdrawals.waitForCompletion(
        ACCOUNT_ID,
        DEFAULT_PARTNER_WITHDRAWAL.withdrawalId
      )
    ).resolves.toMatchObject({ status: 'completed' });
  });
});

describe('createMockKashClient: partner list limits match the real client', () => {
  it('refuses a limit outside 1..100', async () => {
    const kash = createMockKashClient();
    await expect(kash.partnerAccounts.list({ limit: 0 })).rejects.toThrow(/limit must be/);
    await expect(kash.partnerAccounts.withdrawals.list(ACCOUNT_ID, { limit: 101 })).rejects.toThrow(
      /limit must be/
    );
  });
});
