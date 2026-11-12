/**
 * `balance` sub-client: wraps `GET /v1/balance`.
 *
 * Requires the `portfolio:read` scope. A user key reads its own user's
 * balance; a partner key names the account with `account`.
 */

import { accountOverrides, type AccountRequestOverrides } from '../internal/request-options.js';
import { GetBalanceResponseSchema, type BalanceResource } from '../schemas/balance.js';

import type { KashHttpClient } from '../internal/http.js';

export class BalanceClient {
  constructor(private readonly http: KashHttpClient) {}

  /**
   * The acting account's USDC on Solana: on chain (`usdcAtomic`), held by
   * withdrawals not yet final (`pendingWithdrawalsAtomic`) and free to trade
   * or withdraw (`availableAtomic`), as integer strings in USDC atomic units.
   *
   * A balance the API cannot read throws `KashServerError`
   * (`DEPENDENCY_UNAVAILABLE`); it is never reported as zero.
   *
   * @example
   * ```ts
   * const { availableAtomic } = await kash.balance.get({ account: accountId });
   * ```
   */
  async get(opts: AccountRequestOverrides = {}): Promise<BalanceResource> {
    const result = await this.http.request({
      path: '/balance',
      method: 'GET',
      schema: GetBalanceResponseSchema,
      ...accountOverrides(opts),
    });
    return result.balance;
  }
}
