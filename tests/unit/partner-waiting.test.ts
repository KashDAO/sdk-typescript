/**
 * `partnerAccounts.waitUntilActive` and `partnerAccounts.withdrawals
 * .waitForCompletion`: poll on the trades.waitForCompletion idiom (first read
 * at once, then every `pollIntervalMs`, bounded by `timeoutMs`). The clock is
 * faked, so no test waits in real time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KashAbortedError, KashConflictError, KashTimeoutError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';
import {
  FIXTURE_PARTNER_ACCOUNT,
  FIXTURE_PARTNER_ACCOUNT_PROVISIONING,
  FIXTURE_PARTNER_WITHDRAWAL,
  FIXTURE_PARTNER_WITHDRAWAL_COMPLETED,
} from '../contract/wire-shape.test.js';

import { META } from './_test-utils.js';

const ACCOUNT_ID = FIXTURE_PARTNER_ACCOUNT.accountId;
const WITHDRAWAL_ID = FIXTURE_PARTNER_WITHDRAWAL.withdrawalId;

/** A client whose GETs answer each body in turn, repeating the last. */
function clientAnswering(bodies: readonly unknown[]): { kash: KashClient; gets: () => number } {
  let n = 0;
  const kash = new KashClient({
    apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    baseUrl: 'https://api.test.local/v1',
    maxRetries: 0,
    conditionalRequests: false,
    fetch: (async () => {
      const body = bodies[Math.min(n, bodies.length - 1)];
      n += 1;
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  });
  return { kash, gets: () => n };
}

const accountBody = (account: unknown) => ({ account, _meta: META });
const withdrawalBody = (withdrawal: unknown) => ({ withdrawal, _meta: META });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('partnerAccounts.waitUntilActive', () => {
  it('polls through provisioning and resolves with the active account', async () => {
    const { kash, gets } = clientAnswering([
      accountBody(FIXTURE_PARTNER_ACCOUNT_PROVISIONING),
      accountBody(FIXTURE_PARTNER_ACCOUNT_PROVISIONING),
      accountBody(FIXTURE_PARTNER_ACCOUNT),
    ]);
    const seen: string[] = [];

    const done = kash.partnerAccounts.waitUntilActive(ACCOUNT_ID, {
      pollIntervalMs: 1_000,
      onStatus: (a) => seen.push(a.status),
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(done).resolves.toEqual(FIXTURE_PARTNER_ACCOUNT);
    expect(gets()).toBe(3);
    expect(seen).toEqual(['provisioning', 'provisioning', 'active']);
  });

  it('keeps waiting through a status this SDK does not know', async () => {
    const { kash } = clientAnswering([
      accountBody({ ...FIXTURE_PARTNER_ACCOUNT, status: 'verifying' }),
      accountBody(FIXTURE_PARTNER_ACCOUNT),
    ]);

    const done = kash.partnerAccounts.waitUntilActive(ACCOUNT_ID, { pollIntervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(done).resolves.toMatchObject({ status: 'active' });
  });

  it.each(['provisioning_failed', 'released', 'suspended'])(
    'rejects with ACCOUNT_NOT_ACTIVE once the account is %s, without waiting further',
    async (status) => {
      const { kash, gets } = clientAnswering([
        accountBody(FIXTURE_PARTNER_ACCOUNT_PROVISIONING),
        accountBody({ ...FIXTURE_PARTNER_ACCOUNT_PROVISIONING, status }),
      ]);

      const done = kash.partnerAccounts
        .waitUntilActive(ACCOUNT_ID, { pollIntervalMs: 1_000 })
        .catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(5_000);
      const err = await done;

      expect(err).toBeInstanceOf(KashConflictError);
      expect((err as KashConflictError).code).toBe('ACCOUNT_NOT_ACTIVE');
      expect((err as KashConflictError).extensions).toEqual({ status });
      expect(gets()).toBe(2);
    }
  );

  it('rejects with SDK_POLL_TIMEOUT when the account stays provisioning', async () => {
    const { kash } = clientAnswering([accountBody(FIXTURE_PARTNER_ACCOUNT_PROVISIONING)]);

    const done = kash.partnerAccounts
      .waitUntilActive(ACCOUNT_ID, { timeoutMs: 10_000, pollIntervalMs: 2_000 })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await done;

    expect(err).toBeInstanceOf(KashTimeoutError);
    expect((err as KashTimeoutError).code).toBe('SDK_POLL_TIMEOUT');
  });

  it('stops on the caller signal', async () => {
    const { kash } = clientAnswering([accountBody(FIXTURE_PARTNER_ACCOUNT_PROVISIONING)]);
    const controller = new AbortController();

    const done = kash.partnerAccounts
      .waitUntilActive(ACCOUNT_ID, { signal: controller.signal })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(await done).toBeInstanceOf(KashAbortedError);
  });

  it('refuses a malformed accountId before polling', async () => {
    const { kash, gets } = clientAnswering([accountBody(FIXTURE_PARTNER_ACCOUNT)]);

    await expect(kash.partnerAccounts.waitUntilActive('nope')).rejects.toThrow(
      /accountId must be a UUID/
    );
    expect(gets()).toBe(0);
  });
});

describe('partnerAccounts.withdrawals.waitForCompletion', () => {
  it('polls until a final status and returns the withdrawal', async () => {
    const { kash, gets } = clientAnswering([
      withdrawalBody(FIXTURE_PARTNER_WITHDRAWAL),
      withdrawalBody({ ...FIXTURE_PARTNER_WITHDRAWAL, status: 'bridging' }),
      withdrawalBody(FIXTURE_PARTNER_WITHDRAWAL_COMPLETED),
    ]);

    const done = kash.partnerAccounts.withdrawals.waitForCompletion(ACCOUNT_ID, WITHDRAWAL_ID, {
      pollIntervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(done).resolves.toEqual(FIXTURE_PARTNER_WITHDRAWAL_COMPLETED);
    expect(gets()).toBe(3);
  });

  it.each(['failed', 'cancelled'])(
    'resolves on %s too: the caller reads status',
    async (status) => {
      const { kash } = clientAnswering([withdrawalBody({ ...FIXTURE_PARTNER_WITHDRAWAL, status })]);

      await expect(
        kash.partnerAccounts.withdrawals.waitForCompletion(ACCOUNT_ID, WITHDRAWAL_ID)
      ).resolves.toMatchObject({ status });
    }
  );

  it('keeps waiting through a status this SDK does not know, and times out', async () => {
    const { kash, gets } = clientAnswering([
      withdrawalBody({ ...FIXTURE_PARTNER_WITHDRAWAL, status: 'reversing' }),
    ]);

    const done = kash.partnerAccounts.withdrawals
      .waitForCompletion(ACCOUNT_ID, WITHDRAWAL_ID, { timeoutMs: 15_000 })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await done).toBeInstanceOf(KashTimeoutError);
    expect(gets()).toBe(4);
  });
});
