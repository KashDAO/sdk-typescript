/**
 * Type-level guarantees of the partner surface, checked by `pnpm test:types`.
 *
 * - `account` (sent as `Kash-Account`) compiles only on methods whose routes
 *   accept the header. On markets, quotes, webhooks, account usage and the
 *   partner routes the API answers `400 ACCOUNT_HEADER_NOT_ALLOWED`, so the
 *   types refuse it there. Each `@ts-expect-error` below fails the run if the
 *   line it guards ever compiles.
 * - `idempotencyKey` is required on `partnerAccounts.withdrawals.create`.
 * - Amounts are strings, never numbers.
 * - Open enums keep their known members visible in the type.
 */

import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { KashClient, type KashErrorCode, type RequestOverrides } from '../../src/index.js';
import {
  MarketStatusSchema,
  RedemptionKindSchema,
  TradeStatusSchema,
} from '../../src/schemas/index.js';
import type {
  AccountRequestOverrides,
  CreatePartnerWithdrawalOptions,
  PartnerAccountCreateResult,
  PartnerAccountResource,
  PartnerAccountStatus,
  PartnerDestinationNetwork,
  PartnerWithdrawalCreateResult,
  PartnerWithdrawalResource,
  PartnerWithdrawalStatus,
} from '../../src/partner.js';

// Type-checked only, never run: a declared client is all these assertions need.
declare const kash: KashClient;
const account = '3f2b8c1e-5d4a-4f6b-9c8d-7e6f5a4b3c2d';
const marketId = '3f2b8c1e-5d4a-4f6b-9c8d-7e6f5a4b3c2e';

describe('account option: accepted where the route takes Kash-Account', () => {
  it('compiles on balance, trades, portfolio, redemptions and traces', () => {
    void kash.balance.get({ account });
    void kash.trades.create(
      { marketId, outcomeIndex: 0, amount: '10', side: 'buy' },
      { account, idempotencyKey: 'k' }
    );
    void kash.trades.confirm('t', { token: 'x' }, { account });
    void kash.trades.get('t', { account });
    void kash.trades.list({}, { account });
    void kash.trades.waitForCompletion('t', { account });
    void kash.portfolio.get({ account });
    void kash.portfolio.positions({}, { account });
    void kash.portfolio.watchPositions({}, { account });
    void kash.redemptions.create({ marketId, outcomeIndex: 0 }, { account });
    void kash.traces.get('c', { account });
  });

  it('AccountRequestOverrides extends RequestOverrides with an optional account', () => {
    expectTypeOf<AccountRequestOverrides>().toMatchTypeOf<RequestOverrides>();
    expectTypeOf<AccountRequestOverrides['account']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<RequestOverrides>().not.toHaveProperty('account');
  });
});

describe('account option: refused where the route answers ACCOUNT_HEADER_NOT_ALLOWED', () => {
  it('does not compile on markets, quotes, webhooks or account usage', () => {
    // @ts-expect-error markets act for no account
    void kash.markets.list({}, { account });
    // @ts-expect-error markets act for no account
    void kash.markets.get(marketId, { account });
    // @ts-expect-error markets act for no account
    void kash.markets.predictions(marketId, {}, { account });
    // @ts-expect-error quotes act for no account
    void kash.quotes.buy({ marketId, outcomeIndex: 0, amountUsdcAtomic: '1' }, { account });
    // @ts-expect-error quotes act for no account
    void kash.quotes.sell({ marketId, outcomeIndex: 0, tokensInWad: '1' }, { account });
    // @ts-expect-error webhooks belong to the key
    void kash.webhooks.list({}, { account });
    // @ts-expect-error usage belongs to the key
    void kash.account.usage({ account });
  });

  it('does not compile on the partner routes, which name the account in the path', () => {
    // @ts-expect-error the path names the account
    void kash.partnerAccounts.get(account, { account });
    // @ts-expect-error the path names the account
    void kash.partnerAccounts.list({}, { account });
    // @ts-expect-error the path names the account
    void kash.partnerAccounts.findByExternalId('user-8841', { account });
    // @ts-expect-error the path names the account
    void kash.partnerAccounts.suspend(account, { account });
    // @ts-expect-error the path names the account
    void kash.partnerAccounts.withdrawals.quote(account, { amountAtomic: '1' }, { account });
    void kash.partnerAccounts.withdrawals.create(
      account,
      { amountAtomic: '1' },
      // @ts-expect-error the path names the account
      { idempotencyKey: 'k', account }
    );
    // @ts-expect-error the path names the account
    void kash.partnerAccounts.withdrawals.list(account, {}, { account });
  });

  it('has no client-level default', () => {
    // @ts-expect-error a default would leak into routes that refuse the header
    void new KashClient({ account });
  });
});

describe('partnerAccounts.withdrawals.create: the idempotency key is required', () => {
  it('does not compile without options or without the key', () => {
    // @ts-expect-error options carrying idempotencyKey are required
    void kash.partnerAccounts.withdrawals.create(account, { amountAtomic: '1' });
    // @ts-expect-error idempotencyKey is required
    void kash.partnerAccounts.withdrawals.create(account, { amountAtomic: '1' }, {});
    void kash.partnerAccounts.withdrawals.create(
      account,
      { amountAtomic: '1' },
      { idempotencyKey: 'withdraw-1' }
    );
  });

  it('types the key as a required string', () => {
    expectTypeOf<CreatePartnerWithdrawalOptions['idempotencyKey']>().toEqualTypeOf<string>();
  });
});

describe('amounts are strings, never numbers', () => {
  it('refuses a number amount at compile time', () => {
    // @ts-expect-error atomic amounts are strings
    void kash.partnerAccounts.withdrawals.quote(account, { amountAtomic: 2_500_000 });
  });

  it('types every balance and withdrawal amount as string', () => {
    type Balance = Awaited<ReturnType<KashClient['balance']['get']>>;
    expectTypeOf<Balance['availableAtomic']>().toEqualTypeOf<string>();
    expectTypeOf<
      PartnerWithdrawalCreateResult['withdrawal']['amountAtomic']
    >().toEqualTypeOf<string>();
    expectTypeOf<
      PartnerWithdrawalCreateResult['withdrawal']['deliveredAmountAtomic']
    >().toEqualTypeOf<string | null>();
  });
});

describe('create results and open enums', () => {
  it('both creates share one result shape: the resource, outcome and the replay flag', () => {
    expectTypeOf<PartnerAccountCreateResult['account']>().toEqualTypeOf<PartnerAccountResource>();
    expectTypeOf<
      PartnerWithdrawalCreateResult['withdrawal']
    >().toEqualTypeOf<PartnerWithdrawalResource>();
    expectTypeOf<PartnerAccountCreateResult['outcome']>().toEqualTypeOf<'created' | 'existing'>();
    expectTypeOf<PartnerWithdrawalCreateResult['outcome']>().toEqualTypeOf<
      'created' | 'existing'
    >();
    expectTypeOf<PartnerAccountCreateResult['idempotentReplay']>().toEqualTypeOf<boolean>();
    expectTypeOf<PartnerWithdrawalCreateResult['idempotentReplay']>().toEqualTypeOf<boolean>();
    expectTypeOf<keyof PartnerAccountCreateResult>().toEqualTypeOf<
      'account' | 'outcome' | 'idempotentReplay'
    >();
    expectTypeOf<keyof PartnerWithdrawalCreateResult>().toEqualTypeOf<
      'withdrawal' | 'outcome' | 'idempotentReplay'
    >();
  });

  it('keeps the known members of each open enum, and accepts any string', () => {
    expectTypeOf<'active'>().toMatchTypeOf<PartnerAccountStatus>();
    expectTypeOf<'bridging'>().toMatchTypeOf<PartnerWithdrawalStatus>();
    expectTypeOf<'arc'>().toMatchTypeOf<PartnerDestinationNetwork>();
    expectTypeOf<'not-yet-invented'>().toMatchTypeOf<PartnerDestinationNetwork>();
    // The known members survive as a distinct union arm: extracting the
    // literal members yields them, rather than collapsing to `string`.
    expectTypeOf<Extract<PartnerDestinationNetwork, 'solana' | 'arc'>>().toEqualTypeOf<
      'solana' | 'arc'
    >();
    expectTypeOf<Extract<KashErrorCode, 'WITHDRAWALS_HELD'>>().toEqualTypeOf<'WITHDRAWALS_HELD'>();
  });
});

describe('opened 0.3.x schemas: the documented migration', () => {
  it('z.enum(Schema.options) rebuilds the closed enum over the known values', () => {
    const strict = z.enum(TradeStatusSchema.options);
    expectTypeOf<z.infer<typeof strict>>().toEqualTypeOf<
      | 'pending_confirmation'
      | 'pending'
      | 'validating'
      | 'executing'
      | 'completed'
      | 'failed'
      | 'rejected'
    >();
    expectTypeOf(MarketStatusSchema.options).toMatchTypeOf<readonly string[]>();
    expectTypeOf(RedemptionKindSchema.options).toEqualTypeOf<readonly ['resolved', 'cancelled']>();
  });
});

describe('withdrawal fee disclosure: optional in the types', () => {
  it('quote and resource carry the fee fields as optional: absent means not disclosed', () => {
    type Quote = Awaited<ReturnType<KashClient['partnerAccounts']['withdrawals']['quote']>>;
    expectTypeOf<Quote['networkFeeAtomic']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Quote['networkFeeEstimated']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Quote['totalDebitAtomic']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<PartnerWithdrawalResource['networkFeeAtomic']>().toEqualTypeOf<
      string | null | undefined
    >();
  });
});
