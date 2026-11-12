/**
 * `partnerAccounts` sub-client: wraps `/v1/partner/accounts`.
 *
 * A partner creates one Kash account for each user it onboards, then acts
 * for that user by passing the account's `accountId` as `account` on
 * balance, trade, portfolio, redemption and trace calls. These routes name
 * the account in the path instead, so they take no `account` option.
 *
 * Requires a partner API key with the `partner:accounts` scope; a user key
 * is refused with `403 INSUFFICIENT_SCOPE`. An account that is unknown,
 * another partner's or released answers `404 ACCOUNT_NOT_FOUND`
 * ({@link KashNotFoundError}), the same for all three by design.
 *
 * Withdrawals live under {@link PartnerAccountsClient.withdrawals}.
 */

import { KashConflictError, KashValidationError } from '../errors.js';
import { buildPage, type Page } from '../internal/pagination.js';
import { pollUntil } from '../internal/polling.js';
import { parseRequestBody } from '../internal/request-body.js';
import { pageLimit, transportOverrides, validateUuid } from '../internal/request-options.js';
import {
  CreatePartnerAccountBodySchema,
  GetPartnerAccountResponseSchema,
  ListPartnerAccountsResponseSchema,
  PartnerExternalIdSchema,
  UpdatePartnerAccountBodySchema,
  WritePartnerAccountResponseSchema,
  type CreatePartnerAccountBody,
  type PartnerAccountResource,
  type UpdatePartnerAccountBody,
} from '../schemas/partner-account.js';

import { partnerCreateFacts, type PartnerCreateResult } from './partner-create-result.js';
import { PartnerWithdrawalsClient } from './partner-withdrawals.js';

import type { KashHttpClient } from '../internal/http.js';
import type { RequestOverrides } from '../internal/request-options.js';
import type { Pagination } from '../schemas/envelope.js';

/**
 * Options for the account writes. `idempotencyKey` is optional: the SDK keys
 * every POST it sends (create, suspend, reactivate, release), so its own
 * retries cannot repeat a write. Pass your own key to make a retry of the
 * whole CALL safe too, and to receive the stored first answer for it.
 * `update` is a PATCH, which the SDK does not key; it is safe to retry
 * because re-sending the current destination or country changes nothing.
 */
export type PartnerAccountWriteOptions = RequestOverrides & {
  /** Sent as `Idempotency-Key`. Up to 255 characters of `[A-Za-z0-9_\-:.]`. */
  readonly idempotencyKey?: string;
};

/** Options for {@link PartnerAccountsClient.waitUntilActive}. */
export type WaitUntilActiveOptions = {
  /** Total time budget across all polls. Default 120 s. */
  readonly timeoutMs?: number;
  /** Delay between polls. Default 2 s. */
  readonly pollIntervalMs?: number;
  /** Invoked with each fetched account, for status logs. */
  readonly onStatus?: (account: PartnerAccountResource) => void;
  /** Caller-driven abort. */
  readonly signal?: AbortSignal;
};

/**
 * Statuses from which an account does not become active on its own. Any
 * other status that is not `active` (`provisioning`, or one this SDK version
 * does not know) is waited on, bounded by the timeout.
 */
const NEVER_ACTIVE = new Set(['provisioning_failed', 'released', 'suspended']);

/** Return type of {@link PartnerAccountsClient.create}. */
export type PartnerAccountCreateResult = PartnerCreateResult<'account', PartnerAccountResource>;

/** Parameters for {@link PartnerAccountsClient.list}. */
export type ListPartnerAccountsParams = {
  /** Opaque cursor from a previous page's `nextCursor`. */
  readonly cursor?: string;
  /** Page size, 1-100. Default 20. */
  readonly limit?: number;
};

export class PartnerAccountsClient {
  /** Withdrawals from an account to its registered destination. */
  readonly withdrawals: PartnerWithdrawalsClient;

  constructor(private readonly http: KashHttpClient) {
    this.withdrawals = new PartnerWithdrawalsClient(http);
  }

  /**
   * Create an account for one of your users. The body is checked client-side
   * against the API's rules first.
   *
   * A second create for an `externalId` you already have returns that account
   * with `outcome: 'existing'` and creates nothing. Once you release an
   * account, its `externalId` is free again.
   *
   * @example
   * ```ts
   * const account = await kash.partnerAccounts.create({
   *   externalId: 'user-8841',
   *   destination: { network: 'arc', address: '0x2c7536e3605d9c16a7a3d7b1898e529396a65c23' },
   *   country: 'GB',
   *   consent: { acceptedAt: new Date().toISOString(), termsVersion: 'kash-partner-2026-11' },
   * });
   * if (account.outcome === 'created') {
   *   // status 'provisioning': wait for the account.active webhook.
   * }
   * ```
   */
  async create(
    body: CreatePartnerAccountBody,
    opts: PartnerAccountWriteOptions = {}
  ): Promise<PartnerAccountCreateResult> {
    const parsed = parseRequestBody(CreatePartnerAccountBodySchema, body, 'partnerAccounts.create');
    const { idempotencyKey, ...rest } = opts;
    const response = await this.http.request({
      withResponse: true,
      path: '/partner/accounts',
      method: 'POST',
      schema: WritePartnerAccountResponseSchema,
      body: parsed,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ...transportOverrides(rest),
    });
    return { account: response.data.account, ...partnerCreateFacts(response) };
  }

  /** Read one account. */
  async get(accountId: string, opts: RequestOverrides = {}): Promise<PartnerAccountResource> {
    validateUuid(accountId, 'accountId');
    const result = await this.http.request({
      path: accountPath(accountId),
      method: 'GET',
      schema: GetPartnerAccountResponseSchema,
      ...transportOverrides(opts),
    });
    return result.account;
  }

  /**
   * Poll the account until it is `active`, and return it. The
   * `account.active` webhook says the same without polling; this is for
   * callers that would rather wait in line.
   *
   * Rejects with {@link KashConflictError} (`ACCOUNT_NOT_ACTIVE`, the status
   * in `extensions.status`) once the account is `provisioning_failed`,
   * `released` or `suspended`, none of which becomes active by waiting, and
   * with `KashTimeoutError` (`SDK_POLL_TIMEOUT`) when `timeoutMs` passes
   * first.
   *
   * @example
   * ```ts
   * const { account } = await kash.partnerAccounts.create(body, { idempotencyKey });
   * const active = await kash.partnerAccounts.waitUntilActive(account.accountId);
   * console.log(active.depositAddress);
   * ```
   */
  async waitUntilActive(
    accountId: string,
    opts: WaitUntilActiveOptions = {}
  ): Promise<PartnerAccountResource> {
    validateUuid(accountId, 'accountId');
    const inner: RequestOverrides = opts.signal === undefined ? {} : { signal: opts.signal };
    return pollUntil(
      async () => {
        const account = await this.get(accountId, inner);
        if (NEVER_ACTIVE.has(account.status)) {
          throw new KashConflictError(
            `partnerAccounts.waitUntilActive: account ${accountId} is ${account.status} and ` +
              'will not become active by waiting.',
            { code: 'ACCOUNT_NOT_ACTIVE', extensions: { status: account.status } }
          );
        }
        return account;
      },
      (account) => account.status === 'active',
      {
        timeoutMs: opts.timeoutMs ?? 120_000,
        pollIntervalMs: opts.pollIntervalMs ?? 2_000,
        ...(opts.onStatus === undefined ? {} : { onStatus: opts.onStatus }),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      }
    );
  }

  /**
   * The account you created for `externalId`, or `null` when you have none
   * (never created, or released). An exact match, case included.
   *
   * @example
   * ```ts
   * const existing = await kash.partnerAccounts.findByExternalId('user-8841');
   * ```
   */
  async findByExternalId(
    externalId: string,
    opts: RequestOverrides = {}
  ): Promise<PartnerAccountResource | null> {
    // An absent or empty id must not become an unfiltered list, whose first
    // row would be some other user's account.
    const id = parseRequestBody(
      PartnerExternalIdSchema,
      externalId,
      'partnerAccounts.findByExternalId: externalId'
    );
    const result = await this.http.request({
      path: '/partner/accounts',
      method: 'GET',
      schema: ListPartnerAccountsResponseSchema,
      query: { externalId: id },
      ...transportOverrides(opts),
    });
    if (result.data.length > 1) {
      // The API keeps one linked account per externalId. Two would make the
      // answer arbitrary, so say so rather than pick one.
      throw new KashValidationError(
        `partnerAccounts.findByExternalId: the API returned ${result.data.length} accounts ` +
          'for one externalId; expected at most one.',
        { code: 'SDK_RESPONSE_INVALID' }
      );
    }
    return result.data[0] ?? null;
  }

  /**
   * Your accounts, newest first; released accounts are not listed. Returns a
   * {@link Page}: the first page, and an `AsyncIterable` over every page.
   *
   * @example
   * ```ts
   * for await (const account of await kash.partnerAccounts.list({ limit: 100 })) {
   *   console.log(account.externalId, account.status);
   * }
   * ```
   */
  async list(
    params: ListPartnerAccountsParams = {},
    opts: RequestOverrides = {}
  ): Promise<Page<PartnerAccountResource>> {
    const limit = pageLimit(params.limit, 'partnerAccounts.list');
    const fetchPage = async (
      cursor: string | undefined
    ): Promise<{ data: readonly PartnerAccountResource[]; pagination: Pagination }> =>
      this.http.request({
        path: '/partner/accounts',
        method: 'GET',
        schema: ListPartnerAccountsResponseSchema,
        query: { cursor, limit },
        ...transportOverrides(opts),
      });
    return buildPage<PartnerAccountResource>(fetchPage, params.cursor, { limit });
  }

  /**
   * Change the account's withdrawal destination, its country, or both. A new
   * destination holds the account's withdrawals for 24 hours
   * (`WITHDRAWALS_HELD`) and is announced by `account.destination_changed`;
   * re-sending the current destination changes nothing.
   */
  async update(
    accountId: string,
    body: UpdatePartnerAccountBody,
    opts: PartnerAccountWriteOptions = {}
  ): Promise<PartnerAccountResource> {
    validateUuid(accountId, 'accountId');
    const parsed = parseRequestBody(UpdatePartnerAccountBodySchema, body, 'partnerAccounts.update');
    return this.write(accountPath(accountId), 'PATCH', parsed, opts);
  }

  /**
   * Stop trading and withdrawals for an `active` account. Suspending a
   * suspended account answers it unchanged; any other status is refused with
   * `409 ACCOUNT_NOT_ACTIVE`.
   */
  async suspend(
    accountId: string,
    opts: PartnerAccountWriteOptions = {}
  ): Promise<PartnerAccountResource> {
    validateUuid(accountId, 'accountId');
    return this.write(`${accountPath(accountId)}/suspend`, 'POST', {}, opts);
  }

  /**
   * Resume a `suspended` account. Reactivating an active account answers it
   * unchanged; any other status is refused with `409 ACCOUNT_NOT_ACTIVE`.
   */
  async reactivate(
    accountId: string,
    opts: PartnerAccountWriteOptions = {}
  ): Promise<PartnerAccountResource> {
    validateUuid(accountId, 'accountId');
    return this.write(`${accountPath(accountId)}/reactivate`, 'POST', {}, opts);
  }

  /**
   * End your link to the account. The answer is the account in `released`;
   * after that every route answers it `404`. Refused with
   * `409 RELEASE_REQUIRES_EMPTY_ACCOUNT` while it holds USDC, a position that
   * can still pay out, or work in flight, or had any of those finish in the
   * last two minutes: sell or redeem, withdraw, then release. When its
   * holdings cannot be read the release answers `503 DEPENDENCY_UNAVAILABLE`
   * and nothing changes.
   */
  async release(
    accountId: string,
    opts: PartnerAccountWriteOptions = {}
  ): Promise<PartnerAccountResource> {
    validateUuid(accountId, 'accountId');
    return this.write(`${accountPath(accountId)}/release`, 'POST', {}, opts);
  }

  private async write(
    path: string,
    method: 'POST' | 'PATCH',
    body: unknown,
    opts: PartnerAccountWriteOptions
  ): Promise<PartnerAccountResource> {
    const { idempotencyKey, ...rest } = opts;
    const result = await this.http.request({
      path,
      method,
      schema: WritePartnerAccountResponseSchema,
      ...(body === undefined ? {} : { body }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ...transportOverrides(rest),
    });
    return result.account;
  }
}

function accountPath(accountId: string): string {
  return `/partner/accounts/${encodeURIComponent(accountId)}`;
}
