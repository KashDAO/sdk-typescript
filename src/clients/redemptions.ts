/**
 * `redemptions` sub-client — wraps `POST /v1/redemptions`.
 *
 * Redeem a settled position: the winning outcome of a resolved market, or a
 * refund on a cancelled one. The request is accepted synchronously and the
 * payout executes asynchronously afterwards.
 *
 * Requires the `trades:write` scope. Errors a caller should branch on:
 *
 *   - `POSITION_NOT_CLAIMABLE` ({@link KashConflictError}) — the market has not
 *     settled, the outcome did not win, or the position was already redeemed.
 *     **Also** returned when a previous redemption for the same position
 *     FAILED: the failed request still occupies the position's slot and a new
 *     one cannot be created until it is cleared, so retrying will not help —
 *     contact support. The error message (the server's `detail`) says which
 *     case it is.
 *   - `REDEMPTIONS_NOT_ENABLED` ({@link KashNotFoundError}) — self-service
 *     redemption is switched off.
 *   - `SMART_ACCOUNT_NOT_PROVISIONED` ({@link KashConflictError}) — the key's
 *     user has no wallet yet.
 */

import { parseRequestBody } from '../internal/request-body.js';
import { accountOverrides, type AccountRequestOverrides } from '../internal/request-options.js';
import {
  CreateRedemptionBodySchema,
  CreateRedemptionResponseSchema,
  type CreateRedemptionBody,
  type RedemptionResource,
} from '../schemas/redemption.js';

import type { KashHttpClient } from '../internal/http.js';

/**
 * Options for {@link RedemptionsClient.create}. `account` names the partner
 * account whose position is redeemed (see {@link AccountRequestOverrides}).
 */
export type CreateRedemptionOptions = AccountRequestOverrides & {
  /** Forwarded as the `Idempotency-Key` HTTP header. Auto-generated when omitted. */
  readonly idempotencyKey?: string;
};

/**
 * Return type of {@link RedemptionsClient.create}: the redemption resource
 * plus `idempotent`, true when the position already had a request and this
 * response returns it rather than creating a second one.
 */
export type RedemptionCreateResult = RedemptionResource & {
  readonly idempotent: boolean;
};

export class RedemptionsClient {
  constructor(private readonly http: KashHttpClient) {}

  /**
   * Request redemption of one settled (market, outcome) position.
   *
   * @example
   * ```ts
   * const redemption = await kash.redemptions.create({ marketId, outcomeIndex: 0 });
   * console.log(redemption.kind, redemption.sharesWad, redemption.status);
   * ```
   */
  async create(
    body: CreateRedemptionBody,
    opts: CreateRedemptionOptions = {}
  ): Promise<RedemptionCreateResult> {
    const parsed = parseRequestBody(CreateRedemptionBodySchema, body, 'redemptions.create');
    const { idempotencyKey, ...rest } = opts;
    const response = await this.http.request({
      path: '/redemptions',
      method: 'POST',
      schema: CreateRedemptionResponseSchema,
      body: parsed,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ...accountOverrides(rest),
    });
    return { ...response.redemption, idempotent: response._meta.idempotent };
  }
}
